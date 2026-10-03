(() => {
  'use strict';
  const pad = value => String(value).padStart(2, '0');
  function date(value) {
    const match = typeof value === 'string' && value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match || +match[1] < 1) return null;
    const result = new Date(0);result.setHours(12, 0, 0, 0);result.setFullYear(+match[1], +match[2] - 1, +match[3]);
    return result.getFullYear() === +match[1] && result.getMonth() === +match[2] - 1 && result.getDate() === +match[3] ? result : null;
  }
  const iso = value => `${String(value.getFullYear()).padStart(4, '0')}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  const dayAfter = (value, amount) => {const result = new Date(value);result.setDate(result.getDate() + amount);return result;};
  function monthAfter(value, amount) {
    const result = new Date(value), day = result.getDate();result.setDate(1);result.setMonth(result.getMonth() + amount);
    const last = new Date(result);last.setMonth(last.getMonth() + 1);last.setDate(0);
    result.setDate(Math.min(day, last.getDate()));return result;
  }
  const valid = value => value && value.getFullYear() >= 1 && value.getFullYear() <= 9999;

  // mount({anchor, input, locale?, today?, dates?, onSelect?}), or mount(anchor, options).
  // dates: ISO strings, Map/date-keyed object, [{date, saved, draft}], or async ({month,start,end}) => any of these.
  // Only supply dates with content; {saved:false,draft:false} removes a marker. No diary text is needed.
  // onSelect(isoDate, {saved,draft}) may return false to cancel; input updates only after success.
  // The returned open/close/toggle/setDate/setDates/refresh/destroy methods are safe after destroy.
  function mount(anchorOrOptions, options = {}) {
    const config = anchorOrOptions?.anchor ? anchorOrOptions : {...options, anchor:anchorOrOptions};
    const {anchor, input, onSelect = () => {}} = config;
    if (!anchor || typeof anchor.addEventListener !== 'function') throw new TypeError('A date button is required.');
    const doc = anchor.ownerDocument || document, view = doc.defaultView || window;
    const owner = new AbortController(), markers = new Map();
    let locale = config.locale || doc.documentElement?.lang || 'zh-CN';
    try {new Intl.DateTimeFormat(locale);} catch (_) {locale = 'zh-CN';}
    const english = locale.startsWith('en'), copy = (zh, en) => english ? en : zh;
    const today = date(config.today) || new Date(), initial = date(input?.value) || date(config.value) || today;
    let selected = iso(initial), focused = selected, month = new Date(initial), source = config.dates || [];
    let opened = false, destroyed = false, choosing = false, loading = false, loadToken = 0, selectToken = 0, positioning = 0, error = null;
    month.setDate(1);today.setHours(12, 0, 0, 0);
    const previousAttributes = Object.fromEntries(['aria-expanded', 'aria-haspopup', 'aria-controls', 'aria-label'].map(key => [key, anchor.getAttribute(key)]));
    const panel = doc.createElement('section');panel.className = 'i2WriterCalendar';panel.hidden = true;
    panel.tabIndex = -1;
    panel.id = `writer-calendar-${Math.random().toString(36).slice(2, 10)}`;
    panel.setAttribute('role', 'dialog');panel.setAttribute('aria-label', copy('选择日记日期', 'Choose journal date'));
    anchor.setAttribute('aria-haspopup', 'dialog');anchor.setAttribute('aria-expanded', 'false');anchor.setAttribute('aria-controls', panel.id);
    if (!previousAttributes['aria-label']) anchor.setAttribute('aria-label', config.label || copy('选择日记日期', 'Choose journal date'));
    const element = (tag, className, parent, text) => {
      const node = doc.createElement(tag);if (className) node.className = className;if (text !== undefined) node.textContent = text;
      if (parent) parent.append(node);return node;
    };
    const button = (className, parent, text, label) => {
      const node = element('button', className, parent, text);node.type = 'button';if (label) node.setAttribute('aria-label', label);return node;
    };
    const head = element('header', 'i2CalendarHead', panel);
    const previous = button('i2CalendarMonthStep', head, '‹', copy('上个月', 'Previous month'));
    const jump = element('div', 'i2CalendarJump', head);
    const yearInput = element('input', 'i2CalendarYear', jump);yearInput.type = 'number';yearInput.min = '1';yearInput.max = '9999';yearInput.step = '1';
    yearInput.setAttribute('aria-label', copy('年份', 'Year'));
    const monthInput = element('select', 'i2CalendarMonth', jump);monthInput.setAttribute('aria-label', copy('月份', 'Month'));
    for (let value = 0; value < 12; value++) {
      const option = element('option', '', monthInput, new Intl.DateTimeFormat(locale, {month:english ? 'short' : 'long'}).format(new Date(2024, value, 1)));
      option.value = String(value);
    }
    const next = button('i2CalendarMonthStep', head, '›', copy('下个月', 'Next month'));
    const weekdays = element('div', 'i2CalendarWeekdays', panel);weekdays.setAttribute('aria-hidden', 'true');
    for (let offset = 0; offset < 7; offset++) element('span', '', weekdays,
      new Intl.DateTimeFormat(locale, {weekday:'narrow'}).format(new Date(2024, 0, 1 + offset)));
    const grid = element('div', 'i2CalendarDays', panel);grid.setAttribute('role', 'grid');grid.setAttribute('aria-label', copy('日期', 'Dates'));
    const status = element('div', 'i2CalendarStatus', panel);status.hidden = true;status.setAttribute('role', 'status');
    const retry = button('', status, copy('重新加载', 'Retry'));
    const footer = element('footer', 'i2CalendarFoot', panel);
    const todayButton = button('i2CalendarToday', footer, copy('今朝', 'Today'));
    const closeButton = button('i2CalendarClose', footer, copy('收起', 'Close'));
    (doc.body || doc.documentElement).append(panel);

    function normalDates(values) {
      const result = new Map();
      const add = (key, value) => {
        const name = typeof key === 'string' ? key : value?.date || value?.journal_date;
        if (!date(name) || value === false || value === null) return;
        const draft = Boolean(value?.draft), saved = typeof value === 'object' ? (value.saved === undefined ? !draft : Boolean(value.saved)) : true;
        if (saved || draft) result.set(name, {saved, draft});
      };
      if (values && typeof values.entries === 'function' && !Array.isArray(values) && !(values instanceof Set)) for (const [key, value] of values.entries()) add(key, value);
      else if (Array.isArray(values) || values instanceof Set) for (const value of values) add(typeof value === 'string' ? value : value?.date || value?.journal_date, value);
      else if (values && typeof values === 'object') for (const [key, value] of Object.entries(values)) add(key, value);
      return result;
    }

    function range() {
      const start = dayAfter(month, -(month.getDay() + 6) % 7), end = dayAfter(start, 41);
      return {month:iso(month).slice(0, 7), start:iso(start), end:iso(end)};
    }

    function schedulePosition() {
      if (!opened || destroyed || positioning) return;
      positioning = view.requestAnimationFrame(() => {positioning = 0;position();});
    }

    function position() {
      if (!opened || destroyed) return;if (anchor.isConnected === false) {destroy();return;}
      const viewport = view.visualViewport, width = viewport?.width || view.innerWidth || doc.documentElement.clientWidth;
      const height = viewport?.height || view.innerHeight || doc.documentElement.clientHeight;
      const offsetLeft = viewport?.offsetLeft || 0, offsetTop = viewport?.offsetTop || 0, margin = 12;
      panel.style.width = `${Math.max(1, Math.min(308, width - margin * 2))}px`;
      panel.style.maxHeight = `${Math.max(1, height - margin * 2)}px`;
      const rect = anchor.getBoundingClientRect(), bounds = panel.getBoundingClientRect();
      const left = Math.min(Math.max(offsetLeft + margin, rect.left + rect.width / 2 - bounds.width / 2), offsetLeft + width - bounds.width - margin);
      const below = rect.bottom + 9, above = rect.top - bounds.height - 9;
      const preferred = below + bounds.height <= offsetTop + height - margin ? below : above >= offsetTop + margin ? above : below;
      const top = Math.max(offsetTop + margin, Math.min(preferred, offsetTop + height - bounds.height - margin));
      panel.style.left = `${left}px`;panel.style.top = `${top}px`;
    }

    function paint(focusDate = false) {
      if (destroyed) return;
      const activeDate = doc.activeElement?.dataset?.calendarDate;
      yearInput.value = String(month.getFullYear());monthInput.value = String(month.getMonth());
      previous.disabled = choosing || !valid(monthAfter(month, -1));next.disabled = choosing || !valid(monthAfter(month, 1));
      yearInput.disabled = choosing;monthInput.disabled = choosing;todayButton.disabled = choosing;
      panel.setAttribute('aria-busy', String(choosing || loading));
      grid.replaceChildren();
      const startDate = dayAfter(month, -(month.getDay() + 6) % 7);
      let row;
      for (let index = 0; index < 42; index++) {
        if (index % 7 === 0) {row = element('div', 'i2CalendarWeek', grid);row.setAttribute('role', 'row');}
        const value = dayAfter(startDate, index), key = iso(value), marker = markers.get(key), isSelected = key === selected, isToday = key === iso(today);
        const cell = button('i2CalendarDay', row, String(value.getDate()));cell.dataset.calendarDate = key;
        cell.setAttribute('role', 'gridcell');cell.setAttribute('aria-selected', String(isSelected));cell.tabIndex = key === focused ? 0 : -1;
        cell.disabled = choosing || !valid(value);
        cell.classList.toggle('is-adjacent', value.getMonth() !== month.getMonth());cell.classList.toggle('is-selected', isSelected);
        cell.classList.toggle('is-today', isToday);cell.classList.toggle('has-content', Boolean(marker));cell.classList.toggle('has-draft', Boolean(marker?.draft));
        if (isToday) cell.setAttribute('aria-current', 'date');
        const name = new Intl.DateTimeFormat(locale, {year:'numeric', month:'long', day:'numeric', weekday:'long'}).format(value);
        const label = name + (marker?.saved ? copy('，有日记', ', saved entry') : '') + (marker?.draft ? copy('，有草稿', ', local draft') : '');
        cell.setAttribute('aria-label', label);cell.title = label;
      }
      if (!grid.querySelector('[tabindex="0"]')) {
        const first = [...grid.querySelectorAll('[data-calendar-date]')].find(node => !node.classList.contains('is-adjacent') && !node.disabled);
        if (first) {focused = first.dataset.calendarDate;first.tabIndex = 0;}
      }
      status.hidden = !error;retry.disabled = choosing || loading;retry.textContent = error?.type === 'select' ? copy('重试跳转', 'Try again') : copy('重新加载', 'Retry');
      if (opened && (focusDate || activeDate)) {
        const target = grid.querySelector(`[data-calendar-date="${focusDate ? focused : activeDate}"]`);
        if (target?.disabled) panel.focus({preventScroll:true});else target?.focus({preventScroll:true});
      }
      schedulePosition();
    }

    async function refresh() {
      if (destroyed) return;
      const token = ++loadToken;
      if (typeof source !== 'function') {markers.clear();for (const [key, marker] of normalDates(source)) markers.set(key, marker);loading = false;error = null;paint();return;}
      const request = range();loading = true;error = null;paint();
      try {
        const result = await source(request);
        if (destroyed || token !== loadToken) return;
        for (const key of markers.keys()) if (key >= request.start && key <= request.end) markers.delete(key);
        for (const [key, marker] of normalDates(result)) markers.set(key, marker);
      } catch (_) {if (!destroyed && token === loadToken) error = {type:'load'};}
      finally {if (!destroyed && token === loadToken) {loading = false;paint();}}
    }

    function open() {
      if (destroyed || opened || anchor.isConnected === false) return;
      opened = true;month = date(selected);month.setDate(1);focused = selected;
      panel.hidden = false;anchor.setAttribute('aria-expanded', 'true');paint(true);position();refresh();
    }

    function close(restoreFocus = true) {
      if (destroyed || !opened) return;
      opened = false;panel.hidden = true;anchor.setAttribute('aria-expanded', 'false');
      if (restoreFocus && anchor.isConnected !== false) anchor.focus({preventScroll:true});
    }
    function toggle() {if (opened) close();else open();}

    function setDate(value) {
      const nextDate = date(value);if (destroyed || !nextDate) return false;
      selected = iso(nextDate);focused = selected;month = nextDate;month.setDate(1);
      if (input) input.value = selected;
      paint();if (opened) refresh();return true;
    }

    async function choose(value) {
      if (destroyed || choosing || !date(value)) return;
      if (value === selected) {close();return;}
      const token = ++selectToken;choosing = true;focused = value;error = null;paint();
      try {
        const result = await onSelect(value, {...(markers.get(value) || {saved:false, draft:false})});
        if (destroyed || token !== selectToken) return;
        if (result !== false) {selected = value;focused = value;if (input) input.value = value;close(false);}
      } catch (_) {if (!destroyed && token === selectToken) error = {type:'select', date:value};}
      finally {if (!destroyed && token === selectToken) {choosing = false;paint(opened);}}
    }

    function showMonth(value, restoreFocus = false) {
      if (destroyed || choosing || !valid(value)) return;
      month = new Date(value);month.setDate(1);focused = iso(value);paint(restoreFocus);refresh();
    }

    function keyboard(event) {
      if (!opened || destroyed) return;
      if (event.key === 'Escape') {event.preventDefault();event.stopPropagation();close();return;}
      const cell = event.target.closest?.('[data-calendar-date]');if (!cell || !panel.contains(cell) || choosing) return;
      const value = date(cell.dataset.calendarDate), vectors = {ArrowLeft:-1, ArrowRight:1, ArrowUp:-7, ArrowDown:7};
      let target;
      if (event.key in vectors) target = dayAfter(value, vectors[event.key]);
      else if (event.key === 'Home') target = dayAfter(value, -(value.getDay() + 6) % 7);
      else if (event.key === 'End') target = dayAfter(value, 6 - (value.getDay() + 6) % 7);
      else if (event.key === 'PageUp' || event.key === 'PageDown') target = monthAfter(value, (event.key === 'PageUp' ? -1 : 1) * (event.shiftKey ? 12 : 1));
      else if (event.key === 'Enter' || event.key === ' ') {event.preventDefault();event.stopPropagation();choose(cell.dataset.calendarDate);return;}
      else return;
      event.preventDefault();event.stopPropagation();if (!valid(target)) return;
      focused = iso(target);
      if (target.getMonth() !== month.getMonth() || target.getFullYear() !== month.getFullYear()) showMonth(target, true);
      else paint(true);
    }

    function setDates(values) {if (destroyed) return;source = values || [];if (opened || typeof source !== 'function') return refresh();}

    function destroy() {
      if (destroyed) return;destroyed = true;opened = false;loadToken++;selectToken++;
      owner.abort();resizeObserver?.disconnect();lifecycle?.disconnect();view.cancelAnimationFrame(positioning);panel.remove();
      for (const [key, value] of Object.entries(previousAttributes)) {if (value === null) anchor.removeAttribute(key);else anchor.setAttribute(key, value);}
    }

    anchor.addEventListener('click', event => {event.preventDefault();toggle();}, {signal:owner.signal});
    anchor.addEventListener('keydown', event => {if (event.key === 'ArrowDown') {event.preventDefault();open();}}, {signal:owner.signal});
    panel.addEventListener('click', event => {
      const day = event.target.closest?.('[data-calendar-date]');if (day && panel.contains(day) && !day.disabled) choose(day.dataset.calendarDate);
    }, {signal:owner.signal});
    previous.addEventListener('click', () => showMonth(monthAfter(month, -1)), {signal:owner.signal});
    next.addEventListener('click', () => showMonth(monthAfter(month, 1)), {signal:owner.signal});
    const changeMonth = () => {
      const year = Number(yearInput.value), index = Number(monthInput.value);
      if (!Number.isInteger(year) || year < 1 || year > 9999 || !Number.isInteger(index) || index < 0 || index > 11) {paint();return;}
      const value = new Date(month);value.setFullYear(year, index, 1);showMonth(value);
    };
    yearInput.addEventListener('change', changeMonth, {signal:owner.signal});monthInput.addEventListener('change', changeMonth, {signal:owner.signal});
    todayButton.addEventListener('click', () => choose(iso(today)), {signal:owner.signal});
    closeButton.addEventListener('click', () => close(), {signal:owner.signal});
    retry.addEventListener('click', () => {if (error?.type === 'select') choose(error.date);else refresh();}, {signal:owner.signal});
    doc.addEventListener('keydown', keyboard, {signal:owner.signal, capture:true});
    doc.addEventListener('pointerdown', event => {if (opened && !panel.contains(event.target) && !anchor.contains(event.target)) close(false);}, {signal:owner.signal, capture:true});
    doc.addEventListener('focusin', event => {if (opened && !panel.contains(event.target) && !anchor.contains(event.target)) close(false);}, {signal:owner.signal});
    doc.addEventListener('scroll', schedulePosition, {signal:owner.signal, capture:true, passive:true});
    view.addEventListener('resize', schedulePosition, {signal:owner.signal});
    view.visualViewport?.addEventListener('resize', schedulePosition, {signal:owner.signal});view.visualViewport?.addEventListener('scroll', schedulePosition, {signal:owner.signal});
    const resizeObserver = typeof view.ResizeObserver === 'function' ? new view.ResizeObserver(schedulePosition) : null;
    resizeObserver?.observe(anchor);resizeObserver?.observe(panel);
    const lifecycle = typeof view.MutationObserver === 'function' ? new view.MutationObserver(() => {if (anchor.isConnected === false) destroy();}) : null;
    lifecycle?.observe(doc.documentElement, {childList:true, subtree:true});
    if (typeof source !== 'function') refresh();
    return {open, close, toggle, setDate, setDates, refresh, destroy, isOpen:() => opened};
  }

  window.lifeosWriterCalendar = {mount};
})();
