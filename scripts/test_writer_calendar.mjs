import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../app/writer-calendar.js', import.meta.url), 'utf8');
const flush = async () => {await new Promise(setImmediate);await new Promise(setImmediate);};
const deferred = () => {let resolve, reject;const promise = new Promise((a,b) => {resolve = a;reject = b;});return {promise, resolve, reject};};

class Events {
  listeners = new Map();
  addEventListener(name, callback, options = {}) {
    if (options.signal?.aborted) return;
    const rows = this.listeners.get(name) || [];rows.push(callback);this.listeners.set(name, rows);
    options.signal?.addEventListener('abort', () => this.listeners.set(name, (this.listeners.get(name) || []).filter(fn => fn !== callback)), {once:true});
  }
  dispatch(name, fields = {}) {
    const event = {preventDefault(){this.prevented = true;},stopPropagation(){this.stopped = true;},...fields};
    for (const callback of [...(this.listeners.get(name) || [])]) callback(event);
    return event;
  }
  count(name) {return this.listeners.get(name)?.length || 0;}
}

function matches(node, selector) {
  if (selector.startsWith('.')) return node.classList.contains(selector.slice(1));
  const attribute = selector.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);
  if (attribute) {
    const value = node.getAttribute(attribute[1]);return value !== null && (attribute[2] === undefined || value === attribute[2]);
  }
  return node.tagName.toLowerCase() === selector;
}
class Node extends Events {
  children = [];attributes = new Map();dataset = {};style = {};classes = new Set();hidden = false;disabled = false;
  constructor(tag, doc) {
    super();this.tagName = tag.toUpperCase();this.ownerDocument = doc;
    this.classList = {contains:value => this.classes.has(value),add:(...values) => values.forEach(value => this.classes.add(value)),
      remove:(...values) => values.forEach(value => this.classes.delete(value)),
      toggle:(value, force) => {const yes = force ?? !this.classes.has(value);if (yes) this.classes.add(value);else this.classes.delete(value);return yes;}};
  }
  set className(value) {this.classes = new Set(value.split(/\s+/).filter(Boolean));}
  get className() {return [...this.classes].join(' ');}
  set tabIndex(value) {this.attributes.set('tabindex', String(value));}
  get tabIndex() {return Number(this.attributes.get('tabindex') ?? -1);}
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_,letter) => letter.toUpperCase())] = String(value);
  }
  getAttribute(name) {
    if (name.startsWith('data-')) return this.dataset[name.slice(5).replace(/-([a-z])/g, (_,letter) => letter.toUpperCase())] ?? null;
    return this.attributes.get(name) ?? null;
  }
  removeAttribute(name) {this.attributes.delete(name);}
  append(node) {node.remove();this.children.push(node);node.parentElement = this;}
  replaceChildren(...nodes) {for (const node of [...this.children]) node.remove();for (const node of nodes) this.append(node);}
  remove() {if (!this.parentElement) return;this.parentElement.children = this.parentElement.children.filter(node => node !== this);this.parentElement = null;}
  closest(selector) {for (let node = this;node;node = node.parentElement) if (matches(node, selector)) return node;return null;}
  querySelectorAll(selector) {return this.children.flatMap(child => [...(matches(child, selector) ? [child] : []), ...child.querySelectorAll(selector)]);}
  querySelector(selector) {return this.querySelectorAll(selector)[0] || null;}
  contains(node) {return this === node || this.children.some(child => child.contains(node));}
  get isConnected() {return this.ownerDocument.documentElement.contains(this);}
  getBoundingClientRect() {
    const left = this.rect?.left ?? parseFloat(this.style.left) ?? 0, top = this.rect?.top ?? parseFloat(this.style.top) ?? 0;
    const width = this.rect?.width ?? parseFloat(this.style.width) ?? 308, height = this.rect?.height ?? Math.min(365, parseFloat(this.style.maxHeight) || 365);
    return {left, top, width, height, right:left + width, bottom:top + height};
  }
  focus() {this.ownerDocument.activeElement = this;this.ownerDocument.dispatch('focusin', {target:this});}
}

function fixture(options = {}) {
  const doc = new Events(), view = new Events(), rafs = new Map(), resizeObservers = [], lifecycleObservers = [];
  let nextRaf = 0;
  Object.assign(view, {innerWidth:1024,innerHeight:800,
    requestAnimationFrame:fn => {rafs.set(++nextRaf, fn);return nextRaf;},cancelAnimationFrame:key => rafs.delete(key),
    ResizeObserver:class {constructor(fn){this.fn = fn;resizeObservers.push(this);}observe(){}disconnect(){this.disconnected = true;}},
    MutationObserver:class {constructor(fn){this.fn = fn;lifecycleObservers.push(this);}observe(){}disconnect(){this.disconnected = true;}}});
  doc.defaultView = view;doc.createElement = tag => new Node(tag, doc);doc.documentElement = new Node('html', doc);doc.documentElement.lang = 'zh-CN';
  doc.body = new Node('body', doc);doc.documentElement.append(doc.body);doc.activeElement = doc.body;
  const anchor = new Node('button', doc);anchor.rect = {left:410,top:25,width:190,height:32};doc.body.append(anchor);
  const input = new Node('input', doc);input.value = options.value || '2024-02-29';doc.body.append(input);
  vm.runInNewContext(source, {window:view,document:doc,AbortController,Date,Intl,Map,Set,console});
  const controller = view.lifeosWriterCalendar.mount({anchor,input,today:'2024-03-02',...options});
  const panel = doc.body.querySelector('.i2WriterCalendar'), grid = panel.querySelector('.i2CalendarDays');
  const day = value => panel.querySelector(`[data-calendar-date="${value}"]`);
  const click = node => node.closest('[data-calendar-date]') ? panel.dispatch('click', {target:node}) : node.dispatch('click', {target:node});
  const keyboard = (value, key, extra = {}) => doc.dispatch('keydown', {target:day(value),key,...extra});
  const runRaf = () => {for (const [key, fn] of [...rafs]) {rafs.delete(key);fn();}};
  return {controller,doc,view,anchor,input,panel,grid,day,click,keyboard,runRaf,rafs,resizeObservers,lifecycleObservers};
}

test('saved days and local drafts highlight while invalid and empty dates do not', () => {
  const app = fixture({dates:[{date:'2024-02-10',saved:true},{date:'2024-02-11',saved:false,draft:true},
    {date:'2024-02-12',saved:true,draft:true},{date:'2024-02-13',saved:false,draft:false},'2024-02-30']});
  app.controller.open();
  assert.ok(app.day('2024-02-10').classList.contains('has-content'));
  assert.ok(app.day('2024-02-11').classList.contains('has-draft'));
  assert.match(app.day('2024-02-12').getAttribute('aria-label'), /有日记.*有草稿/);
  assert.equal(app.day('2024-02-13').classList.contains('has-content'), false);
  assert.equal(app.day('2024-02-29').getAttribute('aria-selected'), 'true');
  assert.equal(app.day('2024-03-02').getAttribute('aria-current'), 'date');
  assert.equal(app.grid.children.length, 6);assert.equal(app.grid.querySelectorAll('[data-calendar-date]').length, 42);
});

test('date-keyed Maps and objects can replace and remove stale markers', async () => {
  const app = fixture({dates:new Map([['2024-02-20',true],['2024-02-21',{draft:true,saved:false}],['2024-02-22',false]])});
  app.controller.open();assert.ok(app.day('2024-02-20').classList.contains('has-content'));
  await app.controller.setDates({'2024-02-21':{saved:true},'2024-02-25':true});
  assert.equal(app.day('2024-02-20').classList.contains('has-content'), false);assert.equal(app.day('2024-02-21').classList.contains('has-draft'), false);
  assert.ok(app.day('2024-02-25').classList.contains('has-content'));
});

test('pending navigation retains the selected day and prevents duplicate navigation until success', async () => {
  const pending = deferred(), calls = [];
  const app = fixture({dates:[{date:'2024-03-02',draft:true,saved:false}],onSelect:(value, marker) => {calls.push({value,marker});return pending.promise;}});
  app.controller.open();app.click(app.day('2024-03-02'));app.click(app.day('2024-02-20'));
  assert.equal(calls.length, 1);assert.equal(calls[0].value, '2024-03-02');assert.equal(calls[0].marker.draft, true);
  assert.equal(app.input.value, '2024-02-29');assert.equal(app.panel.getAttribute('aria-busy'), 'true');
  pending.resolve();await flush();assert.equal(app.input.value, '2024-03-02');assert.equal(app.controller.isOpen(), false);
  app.controller.open();assert.equal(app.day('2024-03-02').getAttribute('aria-selected'), 'true');
});

test('cancelled navigation leaves the current date and calendar available', async () => {
  const app = fixture({onSelect:() => false});app.controller.open();app.click(app.day('2024-02-20'));await flush();
  assert.equal(app.input.value, '2024-02-29');assert.equal(app.controller.isOpen(), true);assert.equal(app.panel.getAttribute('aria-busy'), 'false');
  assert.equal(app.day('2024-02-20').disabled, false);
});

test('failed date navigation preserves the current page and retries the intended date', async () => {
  const calls = [];const app = fixture({onSelect:value => {calls.push(value);if (calls.length === 1) throw new Error('offline');}});
  app.controller.open();app.click(app.day('2024-02-20'));await flush();
  assert.equal(app.input.value, '2024-02-29');const status = app.panel.querySelector('.i2CalendarStatus');assert.equal(status.hidden, false);
  app.click(status.querySelector('button'));await flush();assert.deepEqual(calls, ['2024-02-20','2024-02-20']);assert.equal(app.input.value, '2024-02-20');
});

test('async calendar data uses visible-month ranges and discards stale responses', async () => {
  const calls = [], february = deferred(), march = deferred();
  const app = fixture({dates:request => {calls.push(request);return request.month === '2024-02' ? february.promise : march.promise;}});
  app.controller.open();app.click(app.panel.querySelectorAll('.i2CalendarMonthStep')[1]);
  assert.equal(calls[0].month, '2024-02');assert.equal(calls[0].start, '2024-01-29');assert.equal(calls[0].end, '2024-03-10');
  assert.equal(calls[1].month, '2024-03');march.resolve(['2024-03-10']);await flush();assert.ok(app.day('2024-03-10').classList.contains('has-content'));
  february.resolve(['2024-03-11']);await flush();assert.equal(app.day('2024-03-11').classList.contains('has-content'), false);
});

test('date-index loading failure supports retry without preventing navigation', async () => {
  let attempts = 0;const app = fixture({dates:async () => {attempts++;if (attempts === 1) throw new Error('offline');return ['2024-02-16'];}});
  app.controller.open();await flush();const status = app.panel.querySelector('.i2CalendarStatus');assert.equal(status.hidden, false);
  assert.equal(app.day('2024-02-16').disabled, false);app.click(status.querySelector('button'));await flush();
  assert.equal(status.hidden, true);assert.equal(attempts, 2);assert.ok(app.day('2024-02-16').classList.contains('has-content'));
});

test('arrow and page keys cross month boundaries while retaining leap-day correctness', async () => {
  const app = fixture();app.controller.open();const next = app.keyboard('2024-02-29', 'ArrowRight');
  assert.equal(next.prevented, true);assert.equal(app.doc.activeElement.dataset.calendarDate, '2024-03-01');
  assert.equal(app.input.value, '2024-02-29');app.keyboard('2024-03-01', 'PageUp');assert.equal(app.doc.activeElement.dataset.calendarDate, '2024-02-01');
  app.controller.setDate('2024-03-31');app.keyboard('2024-03-31', 'PageUp');assert.equal(app.doc.activeElement.dataset.calendarDate, '2024-02-29');
  app.keyboard('2024-02-29', 'PageUp', {shiftKey:true});assert.equal(app.doc.activeElement.dataset.calendarDate, '2023-02-28');
  app.keyboard('2023-02-28', 'Home');assert.equal(app.doc.activeElement.dataset.calendarDate, '2023-02-27');
  app.keyboard('2023-02-27', 'End');assert.equal(app.doc.activeElement.dataset.calendarDate, '2023-03-05');await flush();
});

test('year and month controls jump directly without navigating or changing the selected date', () => {
  const app = fixture();app.controller.open();const year = app.panel.querySelector('.i2CalendarYear'), month = app.panel.querySelector('.i2CalendarMonth');
  year.value = '2010';year.dispatch('change');assert.ok(app.day('2010-02-01'));assert.equal(app.input.value, '2024-02-29');
  month.value = '11';month.dispatch('change');assert.ok(app.day('2010-12-01'));assert.equal(year.value, '2010');
  year.value = '0';year.dispatch('change');assert.equal(year.value, '2010');
});

test('Escape restores date-button focus and stops propagation while outside clicks close without stealing focus', () => {
  const app = fixture();app.controller.open();const escape = app.doc.dispatch('keydown', {target:app.day('2024-02-29'),key:'Escape'});
  assert.equal(escape.prevented, true);assert.equal(escape.stopped, true);assert.equal(app.doc.activeElement, app.anchor);
  assert.equal(app.anchor.getAttribute('aria-expanded'), 'false');app.controller.open();
  app.doc.dispatch('pointerdown', {target:app.panel});assert.equal(app.controller.isOpen(), true);
  app.doc.dispatch('pointerdown', {target:app.doc.body});assert.equal(app.controller.isOpen(), false);
  app.controller.open();app.doc.body.focus();assert.equal(app.controller.isOpen(), false);assert.equal(app.doc.activeElement, app.doc.body);
});

test('keyboard selection and Today use the same async navigation path', async () => {
  const calls = [];const app = fixture({onSelect:value => calls.push(value)});app.controller.open();
  app.keyboard('2024-02-20', 'Enter');await flush();assert.equal(app.input.value, '2024-02-20');
  app.controller.open();app.click(app.panel.querySelector('.i2CalendarToday'));await flush();assert.equal(app.input.value, '2024-03-02');
  assert.deepEqual(calls, ['2024-02-20','2024-03-02']);
});

test('popover stays inside narrow and short viewports and flips above a low date button', () => {
  const app = fixture();app.view.innerWidth = 280;app.view.innerHeight = 450;app.anchor.rect = {left:230,top:410,width:40,height:30};app.controller.open();
  let rect = app.panel.getBoundingClientRect();assert.ok(rect.left >= 12);assert.ok(rect.right <= 268);assert.ok(rect.top >= 12);assert.ok(rect.bottom <= 438);
  assert.ok(rect.bottom < app.anchor.rect.top);
  app.view.innerHeight = 200;app.view.dispatch('resize');app.runRaf();rect = app.panel.getBoundingClientRect();assert.ok(rect.bottom <= 188);
  app.controller.destroy();
});

test('destroy removes the portal and all listeners, restores existing ARIA, and ignores late asynchronous results', async () => {
  const pending = deferred(), app = fixture({onSelect:() => pending.promise});
  app.controller.open();app.click(app.day('2024-02-20'));app.controller.destroy();app.controller.destroy();pending.resolve();await flush();
  assert.equal(app.input.value, '2024-02-29');assert.equal(app.doc.body.querySelector('.i2WriterCalendar'), null);
  assert.equal(app.anchor.getAttribute('aria-controls'), null);assert.equal(app.anchor.count('click'), 0);assert.equal(app.doc.count('keydown'), 0);
  assert.equal(app.view.count('resize'), 0);assert.equal(app.rafs.size, 0);
  assert.ok(app.resizeObservers.every(observer => observer.disconnected));assert.ok(app.lifecycleObservers.every(observer => observer.disconnected));
  app.controller.open();assert.equal(app.controller.isOpen(), false);assert.equal(app.controller.setDate('2024-01-01'), false);
});

test('a removed writer date button destroys its portal and English labels remain accessible', () => {
  const app = fixture({locale:'en-US',dates:['2024-02-20']});app.controller.open();
  assert.equal(app.panel.getAttribute('aria-label'), 'Choose journal date');assert.match(app.day('2024-02-20').getAttribute('aria-label'), /saved entry/);
  app.anchor.remove();app.lifecycleObservers.forEach(observer => observer.fn());assert.equal(app.doc.body.querySelector('.i2WriterCalendar'), null);
});

test('dates at supported year boundaries stay selectable and invalid input is refused', () => {
  const app = fixture();app.controller.open();assert.equal(app.controller.setDate('2024-02-30'), false);
  assert.equal(app.controller.setDate('0001-01-01'), true);assert.equal(app.day('0001-01-01').getAttribute('aria-selected'), 'true');
  assert.equal(app.panel.querySelectorAll('.i2CalendarMonthStep')[0].disabled, true);
  app.controller.setDate('9999-12-31');assert.equal(app.day('9999-12-31').getAttribute('aria-selected'), 'true');
  assert.equal(app.panel.querySelectorAll('.i2CalendarMonthStep')[1].disabled, true);
});
