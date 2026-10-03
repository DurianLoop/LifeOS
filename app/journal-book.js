(() => {
  'use strict';

  const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[character]));
  const copy = (locale, zh, en) => String(locale || '').startsWith('en') ? en : zh;
  function week(item) {
    const path = String(item?.source_path || '').replace(/\\/g, '/');
    const pathMatch = path.match(/(?:^|\/)memories\/weekly\/\d{4}\/(\d{4})_(\d{1,2})\.md$/i);
    const labelMatch = String(item?.journal_date || item?.date || '').match(/^(\d{4})[-_]W(\d{1,2})$/i);
    const year = Number(pathMatch?.[1] || labelMatch?.[1] || (item?.kind === 'weekly' ? item.year : 0));
    const number = Number(pathMatch?.[2] || labelMatch?.[2] || (item?.kind === 'weekly' ? item.week : 0));
    return Number.isInteger(year) && year >= 1 && year <= 9999 && Number.isInteger(number) && number >= 1 && number <= 53 ? {year, number} : null;
  }
  const day = item => {const value = week(item);return value ? `${String(value.year).padStart(4, '0')}-W${String(value.number).padStart(2, '0')}` : String(item?.journal_date || item?.date || '');};
  const readingKind = config => ['daily', 'weekly'].includes(config.kind) ? config.kind : config.j?.memory?.kind === 'weekly' || week({source_path:config.path || config.j?.memory?.source_path}) ? 'weekly' : 'daily';
  const availableKinds = config => [...new Set((config.kinds || []).filter(value => value === 'daily' || value === 'weekly'))];

  function indexItems(items = []) {
    const paths = new Set();
    return items.filter(item => item?.source_path && item.deleted_at == null).map(item => ({...item, journal_date:day(item)}))
      .sort((a, b) => {const first = week(a), second = week(b);return (first && second ? first.year - second.year || first.number - second.number : a.journal_date.localeCompare(b.journal_date)) || String(a.source_path).localeCompare(String(b.source_path));})
      .filter(item => {if (paths.has(item.source_path)) return false;paths.add(item.source_path);return true;})
      .map((item, index) => ({...item, page:index + 1}));
  }

  function filterItems(items, {year = '', month = '', query = ''} = {}) {
    const needle = String(query).trim().toLocaleLowerCase();
    return items.filter(item => (!year || day(item).slice(0, 4) === year) && (!month || day(item).slice(5, 7) === month)
      && (!needle || `${item.title || ''} ${day(item)}`.toLocaleLowerCase().includes(needle))).slice().reverse();
  }

  function pagePath(items, number) {
    return Number.isInteger(number) && number >= 1 && number <= items.length ? items[number - 1].source_path : null;
  }

  function datePath(items, value, currentPath) {
    const matches = items.filter(item => day(item) === value);
    return matches.find(item => item.source_path === currentPath)?.source_path || matches[0]?.source_path || null;
  }

  function pageNeighbors(items, path, context = {}) {
    const index = items.findIndex(item => item.source_path === path);
    if (index < 0) return {previous:context.previous || null, next:context.next || null};
    return {previous:items[index - 1] || null, next:items[index + 1] || null};
  }

  function currentPage(config, items) {
    const path = config.path || config.j?.memory?.source_path || '';
    const item = items.find(value => value.source_path === path);
    return {path, item, number:item?.page || 1, total:Math.max(items.length, 1)};
  }

  function entryMarkup(item, path, locale) {
    const date = day(item), title = item.title || date || copy(locale, '未命名', 'Untitled');
    return `<button type="button" class="jbIndexEntry${item.source_path === path ? ' is-current' : ''}" data-i2-journal-page="${esc(item.source_path)}"${item.source_path === path ? ' aria-current="page"' : ''}><span class="jbEntryDate">${esc(date.slice(5) || date)}</span><span class="jbEntryTitle">${esc(title)}</span><span class="jbEntryNumber">${item.page}</span></button>`;
  }

  function directoryMarkup(items, path, locale) {
    let previous = '';
    return items.map(item => {
      const month = day(item).slice(0, week(item) ? 4 : 7), heading = month !== previous ? `<h3 class="jbIndexMonth">${esc(month)}</h3>` : '';
      previous = month;
      return heading + entryMarkup(item, path, locale);
    }).join('');
  }

  // paperSections is the host's existing, sanitized rich-text rendering.
  // Directory items contain dates and titles only; the reader never requests other diary bodies.
  function render(config = {}) {
    const {j = {}, locale = 'zh-CN', backSearch = false} = config;
    const items = indexItems(config.items), current = currentPage(config, items), memory = j.memory || {}, kind = readingKind(config), kinds = availableKinds(config);
    const ctx = pageNeighbors(items, current.path, config.ctx || j.context || {});
    const date = day(current.item || {...memory, source_path:current.path, kind}), validDate = kind !== 'weekly' && /^\d{4}-\d{2}-\d{2}$/.test(date);
    const title = config.title || j.product_entry?.title || current.item?.title || date || `${memory.year || ''}_W${String(memory.week || 0).padStart(2, '0')}`;
    const years = [...new Set(items.map(item => day(item).slice(0, 4)).filter(Boolean))].sort().reverse();
    const year = years.includes(date.slice(0, 4)) ? date.slice(0, 4) : '';
    const filtered = filterItems(items, {year});
    const sections = config.paperSections || Object.entries(j.sections || {}).filter(([, value]) => String(value || '').trim())
      .map(([name, value]) => `<section class="i2ReadingSection"><h2>${esc(name)}</h2><div class="jbSectionText">${esc(value).replace(/\n/g, '<br>')}</div></section>`).join('');
    const attachments = (j.attachments || []).map(value => `<a href="/api/attachment?attachment_id=${encodeURIComponent(value.attachment_id || '')}" target="_blank" rel="noopener">${esc(value.original_name || copy(locale, '附件', 'Attachment'))}</a>`).join('');
    const turn = ['next', 'previous'].includes(config.turn) ? config.turn : 'idle';
    return `<article class="i2JournalVolume" data-path="${esc(current.path)}" data-turn="${turn}" data-kind="${kind}">
      <header class="jbToolbar"><div class="jbToolbarTitle"><h1>${esc(copy(locale, '流年', 'Journal'))}</h1>${kinds.includes('daily') && kinds.includes('weekly') ? `<select class="jbKindSelect" data-jb-kind aria-label="${esc(copy(locale, '日记或周记', 'Daily or weekly journals'))}"><option value="daily"${kind === 'daily' ? ' selected' : ''}>${esc(copy(locale, '日记', 'Daily'))}</option><option value="weekly"${kind === 'weekly' ? ' selected' : ''}>${esc(copy(locale, '周记', 'Weekly'))}</option></select>` : ''}</div><div class="jbToolbarActions"><button type="button" class="jbQuietButton" id="journalBackSearch"${backSearch ? '' : ' hidden'}>← ${esc(copy(locale, '搜索', 'Search'))}</button><button type="button" class="jbQuietButton jbIndexToggle" data-jb-index aria-expanded="false">${esc(copy(locale, '目录', 'Contents'))}</button>${kind === 'weekly' ? '' : `<button type="button" class="jbQuietButton" id="journalEdit">${esc(copy(locale, '编辑', 'Edit'))}</button>`}</div></header>
      <div class="jbSpread"><button type="button" class="jbIndexShade" data-jb-close-index tabindex="-1" aria-label="${esc(copy(locale, '关闭目录', 'Close contents'))}" hidden></button>
        <aside class="jbIndexPage" aria-label="${esc(copy(locale, kind === 'weekly' ? '周记目录' : '日记目录', 'Journal contents'))}"><header class="jbIndexHeading"><h2>${esc(copy(locale, '目录', 'Contents'))}</h2><button type="button" class="jbIndexClose" data-jb-close-index aria-label="${esc(copy(locale, '关闭目录', 'Close contents'))}">×</button><span>${items.length}</span></header>
          <div class="jbIndexFilters"><input type="search" class="jbIndexSearch" data-jb-search placeholder="${esc(copy(locale, kind === 'weekly' ? '题名或周次' : '题名或日期', kind === 'weekly' ? 'Title or week' : 'Title or date'))}" aria-label="${esc(copy(locale, kind === 'weekly' ? '查找周记' : '查找日记', 'Find a journal page'))}"><div><select data-jb-year aria-label="${esc(copy(locale, '年份', 'Year'))}"><option value="">${esc(copy(locale, '全部年份', 'All years'))}</option>${years.map(value => `<option value="${esc(value)}"${value === year ? ' selected' : ''}>${esc(value)}</option>`).join('')}</select>${kind === 'weekly' ? '' : `<select data-jb-month aria-label="${esc(copy(locale, '月份', 'Month'))}"><option value="">${esc(copy(locale, '全部月份', 'All months'))}</option>${Array.from({length:12}, (_, index) => `<option value="${String(index + 1).padStart(2, '0')}">${esc(copy(locale, `${index + 1} 月`, new Intl.DateTimeFormat('en', {month:'short'}).format(new Date(2024, index, 1))))}</option>`).join('')}</select>`}</div></div>
          <div class="jbIndexScroll" tabindex="0" aria-label="${esc(copy(locale, '目录列表', 'Contents list'))}">${directoryMarkup(filtered.slice(0, 80), current.path, locale)}</div><div class="jbIndexStatus" role="status"></div><footer class="jbIndexFoot"><span>${esc(items[0] ? day(items[0]) : '')}</span><span>${esc(items.length ? day(items[items.length - 1]) : '')}</span></footer>
        </aside>
        <section class="jbReadingPage" aria-label="${esc(copy(locale, kind === 'weekly' ? '周记正文' : '日记正文', 'Journal text'))}" data-page-index="${current.number - 1}" data-page-total="${current.total}"><div class="jbReadingHead">${validDate ? `<button type="button" class="jbDateJump" data-jb-date>${esc(date)}<span aria-hidden="true">⌄</span></button><input type="hidden" data-jb-date-value value="${esc(date)}">` : `<span class="jbPlainDate">${esc(date)}</span>`}<span class="jbBookmark" aria-hidden="true"></span></div>
          <div class="jbTextScroll" tabindex="0" aria-label="${esc(copy(locale, '阅读此页', 'Read this page'))}"><h2 class="jbPageTitle">${esc(title)}</h2><div class="jbPageBody">${sections || `<p class="jbEmptyText">${esc(copy(locale, '这一页尚未落字', 'This page is empty'))}</p>`}</div>${attachments ? `<div class="jbAttachments">${attachments}</div>` : ''}<details class="jbPageDetails"><summary>${esc(copy(locale, '页面信息', 'Page details'))}</summary><div><span>${esc(memory.source_path || current.path)}</span>${kind === 'weekly' ? `<span>${esc(copy(locale, `${(j.revisions || []).length} 个版本`, `${(j.revisions || []).length} revisions`))}</span>` : `<button type="button" class="jbVersionsButton" data-jb-versions>${esc(copy(locale, `${(j.revisions || []).length} 个版本`, `${(j.revisions || []).length} revisions`))}</button>`}</div></details></div>
          <footer class="jbPageFoot"><div class="jbReadingProgress" aria-hidden="true"><i></i></div><button type="button" data-journal-turn="previous"${ctx.previous?.source_path ? '' : ' disabled'} aria-label="${esc(copy(locale, '上一页', 'Previous page'))}">←</button><form class="jbPageJump"><input type="number" data-jb-page min="1" max="${current.total}" value="${current.number}" aria-label="${esc(copy(locale, '跳转页码', 'Jump to page'))}"><span>/ ${current.total}</span></form><button type="button" data-journal-turn="next"${ctx.next?.source_path ? '' : ' disabled'} aria-label="${esc(copy(locale, '下一页', 'Next page'))}">→</button></footer>
        </section>
      </div><div class="jbNavigationStatus" role="status" aria-live="polite"></div>
    </article>`;
  }

  function mount(config = {}) {
    const root = config.root || document.querySelector('.i2JournalVolume');
    if (!root) return {destroy() {}, closeIndex() {}};
    const doc = root.ownerDocument, view = doc.defaultView || window, owner = new AbortController(), signal = owner.signal;
    const locale = config.locale || 'zh-CN', items = indexItems(config.items), kind = readingKind(config), kinds = availableKinds(config);
    const current = currentPage({...config, path:config.path || root.dataset.path}, items);
    const ctx = pageNeighbors(items, current.path, config.ctx || config.j?.context || {});
    const query = selector => root.querySelector(selector), text = query('.jbTextScroll'), directory = query('.jbIndexScroll');
    const status = query('.jbNavigationStatus'), indexStatus = query('.jbIndexStatus'), shade = query('.jbIndexShade'), indexPage = query('.jbIndexPage');
    let dead = false, pending = false, calendar = null, frame = 0, filtered = [], shown = 0, indexExpanded = false, observer = null, lifecycle = null;
    const buttonStates = new Map();
    const on = (node, event, handler, options = {}) => node?.addEventListener(event, handler, {...options, signal});

    function fail(error) {
      if (dead) return;
      status.textContent = error?.message || copy(locale, '此页暂时无法打开', 'This page could not be opened');
      config.onError?.(error);
    }

    function setPending(value) {
      pending = value;root.setAttribute('aria-busy', String(value));root.classList.toggle('is-turning', value);
      if (value) {
        status.textContent = '';
        root.querySelectorAll('[data-journal-turn], [data-i2-journal-page], [data-jb-kind]').forEach(button => {buttonStates.set(button, button.disabled);button.disabled = true;});
      } else {
        buttonStates.forEach((disabled, button) => {if (button.isConnected) button.disabled = disabled;});buttonStates.clear();
      }
    }

    async function navigate(path, direction = 'next') {
      if (dead || pending || !path) return false;
      if (path === current.path) {status.textContent = '';return true;}
      setPending(true);
      try {
        const result = await config.onOpen?.(path, direction);
        if (dead) return true;
        if (result === false) return false;
        text.scrollTop = 0;return true;
      } catch (error) {fail(error);return false;}
      finally {if (!dead) setPending(false);}
    }

    function jumpPage(input) {
      const value = Number(input.value), path = pagePath(items, value);
      if (!path) {input.value = String(current.number);return;}
      return navigate(path, value < current.number ? 'previous' : 'next');
    }

    async function changeKind(select) {
      const next = select.value;
      if (dead || pending || !kinds.includes(next) || next === kind || typeof config.onKind !== 'function') {select.value = kind;return;}
      setPending(true);
      try {if (await config.onKind(next) === false && !dead) select.value = kind;}
      catch (error) {if (!dead) select.value = kind;fail(error);}
      finally {if (!dead) setPending(false);}
    }

    function closeIndex(restoreFocus = false) {
      indexExpanded = false;root.classList.remove('is-index-open');shade.hidden = true;
      query('[data-jb-index]')?.setAttribute('aria-expanded', 'false');
      if (restoreFocus) query('[data-jb-index]')?.focus({preventScroll:true});
    }

    function openIndex() {
      indexExpanded = true;root.classList.add('is-index-open');shade.hidden = false;
      query('[data-jb-index]')?.setAttribute('aria-expanded', 'true');query('[data-jb-search]')?.focus({preventScroll:true});
    }

    function appendDirectory() {
      if (dead || pending || shown >= filtered.length) return;
      const next = Math.min(shown + 80, filtered.length);
      const batch = directoryMarkup(filtered.slice(shown, next), current.path, locale);
      directory.insertAdjacentHTML('beforeend', batch);shown = next;
    }

    function filterDirectory() {
      filtered = filterItems(items, {year:query('[data-jb-year]').value, month:kind === 'weekly' ? '' : query('[data-jb-month]')?.value || '', query:query('[data-jb-search]').value});
      shown = 0;directory.innerHTML = '';directory.scrollTop = 0;appendDirectory();
      indexStatus.textContent = filtered.length ? '' : copy(locale, '没有找到这一页', 'No matching pages');
    }

    function progress() {
      if (dead) return;
      const maximum = Math.max(0, text.scrollHeight - text.clientHeight), amount = maximum ? text.scrollTop / maximum : 1;
      root.style.setProperty('--jb-reading-progress', `${Math.max(0, Math.min(100, amount * 100))}%`);
    }

    function fit() {
      if (dead || !root.isConnected) return;
      const viewport = view.visualViewport, height = viewport?.height || view.innerHeight;
      const rail = doc.querySelector('.rail'), railRect = rail?.getBoundingClientRect();
      const bottom = railRect && railRect.width > railRect.height * 2 && railRect.top > height / 2 ? height - railRect.top : 0;
      root.style.setProperty('--journal-height', `${Math.max(160, height - root.getBoundingClientRect().top - bottom)}px`);
      progress();
    }

    function scheduleFit() {if (!frame) frame = view.requestAnimationFrame(() => {frame = 0;fit();});}

    on(root, 'click', event => {
      const target = event.target.closest?.('button');if (!target || !root.contains(target)) return;
      if (target.matches('[data-jb-index]')) {if (indexExpanded) closeIndex(true);else openIndex();}
      else if (target.matches('[data-jb-close-index]')) closeIndex(true);
      else if (target.matches('[data-journal-turn]')) navigate(ctx[target.dataset.journalTurn]?.source_path, target.dataset.journalTurn);
      else if (target.matches('[data-i2-journal-page]')) {const selected = items.find(item => item.source_path === target.dataset.i2JournalPage);navigate(selected?.source_path, selected?.page < current.number ? 'previous' : 'next');}
      else if (target.id === 'journalEdit' && kind !== 'weekly') config.onEdit?.();
      else if (target.id === 'journalBackSearch') config.onBackSearch?.();
      else if (target.matches('[data-jb-versions]') && kind !== 'weekly') config.onVersions?.();
    });
    on(query('[data-jb-search]'), 'input', filterDirectory);
    on(query('[data-jb-kind]'), 'change', event => changeKind(event.target));
    on(query('[data-jb-year]'), 'change', filterDirectory);on(query('[data-jb-month]'), 'change', filterDirectory);
    on(directory, 'scroll', () => {if (directory.scrollTop + directory.clientHeight >= directory.scrollHeight - 100) appendDirectory();}, {passive:true});
    on(text, 'scroll', progress, {passive:true});
    on(query('.jbPageJump'), 'submit', event => {event.preventDefault();jumpPage(query('[data-jb-page]'));});
    on(query('[data-jb-page]'), 'change', event => jumpPage(event.target));
    on(query('[data-jb-page]'), 'keydown', event => {
      if (event.key === 'Enter') {event.preventDefault();event.stopPropagation();jumpPage(event.target);}
      else if (event.key === 'Escape') {event.preventDefault();event.stopPropagation();event.target.value = String(current.number);}
    });
    on(view, 'keydown', event => {
      if (dead || !root.isConnected || event.defaultPrevented || doc.body.classList.contains('writerImmersive') || doc.body.classList.contains('productDockOpen') || doc.querySelector('#productDock.open') || event.ctrlKey || event.metaKey || event.altKey || calendar?.isOpen()) return;
      if (event.key === 'Escape' && indexExpanded) {event.preventDefault();closeIndex(true);return;}
      if (indexExpanded && event.key === 'Tab') {
        const controls = [...indexPage.querySelectorAll('button:not(:disabled), input, select, [tabindex="0"]')].filter(node => node.getClientRects().length);
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && doc.activeElement === first) {event.preventDefault();last?.focus();}
        else if (!event.shiftKey && doc.activeElement === last) {event.preventDefault();first?.focus();}
        return;
      }
      if (indexExpanded || doc.activeElement?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT', 'SUMMARY'].includes(doc.activeElement?.tagName)) return;
      if (event.key.toLowerCase() === 'f') {event.preventDefault();event.stopImmediatePropagation();text.focus({preventScroll:true});return;}
      if ((event.key === 'PageUp' || event.key === 'PageDown') && !doc.activeElement?.closest?.('.jbIndexPage')) {
        event.preventDefault();event.stopImmediatePropagation();text.focus({preventScroll:true});
        const distance = Math.max(80, text.clientHeight * .85) * (event.key === 'PageUp' ? -1 : 1);
        if (typeof text.scrollBy === 'function') text.scrollBy({top:distance, behavior:'auto'});
        else text.scrollTop = Math.max(0, Math.min(text.scrollHeight - text.clientHeight, text.scrollTop + distance));
        progress();return;
      }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {event.preventDefault();event.stopImmediatePropagation();const direction = event.key === 'ArrowLeft' ? 'previous' : 'next';navigate(ctx[direction]?.source_path, direction);}
    }, {capture:true});
    on(view, 'resize', scheduleFit);on(view.visualViewport, 'resize', scheduleFit);
    on(root, 'load', progress, {capture:true});
    observer = typeof view.ResizeObserver === 'function' ? new view.ResizeObserver(progress) : null;observer?.observe(text);
    const anchor = query('[data-jb-date]');
    if (kind !== 'weekly' && anchor && view.lifeosWriterCalendar) {
      calendar = view.lifeosWriterCalendar.mount({anchor, input:query('[data-jb-date-value]'), locale,
        dates:config.dates || [...new Set(items.map(day).filter(value => /^\d{4}-\d{2}-\d{2}$/.test(value)))],
        onSelect:value => {const path = datePath(items, value, current.path);if (!path) {status.textContent = copy(locale, '这一天没有日记', 'No journal on this date');return false;}const selected = items.find(item => item.source_path === path);return navigate(path, selected?.page < current.number ? 'previous' : 'next');}});
    }
    function destroy() {if (dead) return;dead = true;owner.abort();observer?.disconnect();lifecycle?.disconnect();calendar?.destroy();if (frame) view.cancelAnimationFrame(frame);buttonStates.clear();}
    lifecycle = typeof view.MutationObserver === 'function' ? new view.MutationObserver(() => {if (!root.isConnected) destroy();}) : null;
    lifecycle?.observe(doc.documentElement, {childList:true, subtree:true});
    filterDirectory();
    const currentIndex = filtered.findIndex(item => item.source_path === current.path);
    while (currentIndex >= shown && shown < filtered.length) appendDirectory();
    text.scrollTop = 0;fit();scheduleFit();
    const active = directory.querySelector('[aria-current="page"]');if (active) directory.scrollTop = Math.max(0, active.offsetTop - directory.offsetTop - directory.clientHeight / 2);
    return {closeIndex, destroy};
  }

  window.lifeosJournalBook = Object.freeze({render, mount, indexItems, filterItems, pagePath, datePath, pageNeighbors});
})();
