import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../app/journal-book.js', import.meta.url), 'utf8');
const flush = async () => {await new Promise(setImmediate);await new Promise(setImmediate);};
const deferred = () => {let resolve, reject;const promise = new Promise((a, b) => {resolve = a;reject = b;});return {promise, resolve, reject};};

class Events {
  listeners = new Map();
  addEventListener(name, callback, options = {}) {
    if (options.signal?.aborted) return;
    const list = this.listeners.get(name) || [];list.push(callback);this.listeners.set(name, list);
    options.signal?.addEventListener('abort', () => this.listeners.set(name, (this.listeners.get(name) || []).filter(value => value !== callback)), {once:true});
  }
  dispatch(name, value = {}) {
    const event = {preventDefault() {this.prevented = true;}, stopPropagation() {this.propagationStopped = true;}, stopImmediatePropagation() {this.stopped = true;}, ...value};
    for (const callback of [...(this.listeners.get(name) || [])]) {callback(event);if (event.stopped) break;}
    return event;
  }
  count(name) {return this.listeners.get(name)?.length || 0;}
}

class Element extends Events {
  classes = new Set();attributes = new Map();properties = new Map();dataset = {};value = '';hidden = false;disabled = false;isConnected = true;
  textContent = '';innerHTML = '';scrollTop = 0;scrollHeight = 2000;clientHeight = 300;offsetTop = 0;
  classList = {contains:value => this.classes.has(value), add:value => this.classes.add(value), remove:value => this.classes.delete(value),
    toggle:(value, force) => {if (force ?? !this.classes.has(value)) this.classes.add(value);else this.classes.delete(value);}};
  style = {setProperty:(key, value) => this.properties.set(key, value)};
  setAttribute(key, value) {this.attributes.set(key, value);}
  getBoundingClientRect() {return {top:76, left:0, width:1000, height:600};}
  getClientRects() {return [this.getBoundingClientRect()];}
  focus() {this.focused = true;}
  querySelector() {return null;}
  querySelectorAll() {return [];}
  insertAdjacentHTML(_, value) {this.innerHTML += value;}
  closest() {return this;}
  matches(selector) {return this.selectors?.includes(selector) || false;}
}

const small = [
  {source_path:'a.md',journal_date:'2026-01-01',title:'早页'},
  {source_path:'b.md',journal_date:'2026-02-03',title:'晚风'},
  {source_path:'c.md',journal_date:'2026-10-03',title:'书籍测试'}
];
const weekly = [
  {source_path:'memories/weekly/2025/2025_52.md',kind:'weekly',journal_date:null,title:''},
  {source_path:'memories/weekly/2026/2026_2.md',kind:'weekly',journal_date:null,title:''},
  {source_path:'memories/weekly/2026/2026_10.md',kind:'weekly',journal_date:null,title:'第十周回看'}
];

function fixture(options = {}) {
  const view = new Events(), doc = {body:new Element(), documentElement:new Element(), activeElement:null};
  const root = new Element(), selectors = new Map();root.dataset.path = 'c.md';root.ownerDocument = doc;
  for (const name of ['.jbTextScroll','.jbIndexScroll','.jbNavigationStatus','.jbIndexStatus','.jbIndexShade','.jbIndexPage','[data-jb-search]','[data-jb-year]','[data-jb-month]','[data-jb-page]','[data-jb-index]','.jbPageJump']) selectors.set(name, new Element());
  selectors.get('[data-jb-year]').value = '2026';selectors.get('[data-jb-page]').value = '3';
  if (options.config?.kind === 'weekly') selectors.delete('[data-jb-month]');
  if (options.config?.kinds?.includes('daily') && options.config?.kinds?.includes('weekly')) {selectors.set('[data-jb-kind]',new Element());selectors.get('[data-jb-kind]').value = options.config.kind || 'daily';}
  const previous = new Element(), next = new Element();previous.dataset.journalTurn = 'previous';next.dataset.journalTurn = 'next';next.disabled = true;
  previous.selectors = next.selectors = ['[data-journal-turn]'];
  root.contains = () => true;root.querySelector = key => selectors.get(key) || null;root.querySelectorAll = () => [previous,next,...(selectors.has('[data-jb-kind]') ? [selectors.get('[data-jb-kind]')] : [])];
  doc.querySelector = key => key === '#productDock.open' ? (options.overlay ? {} : null) : null;
  doc.defaultView = view;view.innerHeight = 800;view.requestAnimationFrame = () => 1;view.cancelAnimationFrame = () => {};
  let lifecycle;
  view.MutationObserver = class {constructor(callback) {this.callback = callback;lifecycle = this;}observe() {}disconnect() {this.disconnected = true;}};
  if (options.calendar) {selectors.set('[data-jb-date]', new Element());selectors.set('[data-jb-date-value]', new Element());view.lifeosWriterCalendar = {mount(config) {options.calendar.config = config;return {destroy() {},isOpen:() => Boolean(options.calendar.open)};}};}
  const window = view;vm.runInNewContext(source, {window, AbortController, Intl, ResizeObserver:undefined});
  const calls = [], errors = [], api = window.lifeosJournalBook;
  const control = api.mount({root,items:small,path:'c.md',ctx:{previous:{source_path:'b.md'},next:null},onOpen:(...args) => {calls.push(args);return options.onOpen?.(...args);},onError:error => errors.push(error), ...options.config});
  return {api, root, view, doc, control, calls, errors, selectors, previous, next, lifecycle:() => lifecycle};
}

test('index excludes deleted pages and duplicates, assigning chronological page numbers', () => {
  const {api,control} = fixture();
  const result = api.indexItems([small[2],small[0],{...small[1],deleted_at:'now'},small[0],{title:'missing path'}]);
  assert.equal(result.length,2);assert.equal(result[0].source_path,'a.md');assert.equal(result[1].page,2);control.destroy();
});

test('weekly paths supply year and numeric week ordering when product dates are null', () => {
  const {api,control} = fixture();
  const index = api.indexItems([weekly[2],weekly[1],weekly[0]]);
  assert.deepEqual(Array.from(index,item => item.journal_date),['2025-W52','2026-W02','2026-W10']);
  assert.deepEqual(Array.from(index,item => item.page),[1,2,3]);
  assert.equal(api.filterItems(index,{year:'2026',query:'W02'})[0].source_path,weekly[1].source_path);control.destroy();
});

test('weekly paths accept single and double digit weeks and Windows separators', () => {
  const {api,control} = fixture();
  const values = [weekly[1],{source_path:'memories\\weekly\\2026\\2026_03.md',kind:'weekly',journal_date:null}];
  const index = api.indexItems(values);assert.equal(index[0].journal_date,'2026-W02');assert.equal(index[1].journal_date,'2026-W03');control.destroy();
});

test('weekly rendering groups by year and uses the week identifier without calendar or month filters', () => {
  const {api,control} = fixture();
  const html = api.render({kind:'weekly',items:weekly,path:weekly[1].source_path});
  assert.match(html,/value="2026" selected/);assert.match(html,/<h3 class="jbIndexMonth">2026<\/h3>/);
  assert.match(html,/<h2 class="jbPageTitle">2026-W02<\/h2>/);assert.ok(!html.includes('data-jb-month'));assert.ok(!html.includes('data-jb-date'));control.destroy();
});

test('legacy weekly source outside product directory still shows metadata year and week', () => {
  const {api,control} = fixture();
  const html = api.render({kind:'weekly',j:{memory:{source_path:'legacy-week.md',kind:'weekly',year:2026,week:2}}});
  assert.match(html,/<h2 class="jbPageTitle">2026-W02<\/h2>/);assert.match(html,/<span class="jbPlainDate">2026-W02<\/span>/);control.destroy();
});

test('weekly mounting works without a month selector and turns to numeric adjacent weeks', async () => {
  const calendar = {}, state = fixture({calendar,config:{kind:'weekly',items:[weekly[2],weekly[1],weekly[0]],path:weekly[1].source_path}});
  assert.ok(state.selectors.get('.jbIndexScroll').innerHTML.includes('2026-W02'));assert.equal(calendar.config,undefined);
  state.root.dispatch('click',{target:state.next});await flush();assert.equal(state.calls[0][0],weekly[2].source_path);state.control.destroy();
});

test('weekly book cannot enter daily edit or revision restore flows', () => {
  let edits = 0, versions = 0;
  const state = fixture({config:{kind:'weekly',items:weekly,path:weekly[1].source_path,onEdit:() => edits++,onVersions:() => versions++}});
  const html = state.api.render({kind:'weekly',items:weekly,path:weekly[1].source_path,j:{revisions:[{},{}]}});
  assert.ok(!html.includes('id="journalEdit"'));assert.ok(!html.includes('data-jb-versions'));assert.ok(html.includes('2 个版本'));
  const edit = new Element();edit.id = 'journalEdit';state.root.dispatch('click',{target:edit});
  const revision = new Element();revision.selectors = ['[data-jb-versions]'];state.root.dispatch('click',{target:revision});
  assert.equal(edits,0);assert.equal(versions,0);state.control.destroy();
});

test('daily pages keep edit and revision callbacks', () => {
  let edits = 0, versions = 0;
  const state = fixture({config:{kind:'daily',onEdit:() => edits++,onVersions:() => versions++}});
  const html = state.api.render({kind:'daily',items:small,path:'c.md'});assert.ok(html.includes('id="journalEdit"'));assert.ok(html.includes('data-jb-versions'));
  const edit = new Element();edit.id = 'journalEdit';state.root.dispatch('click',{target:edit});
  const revision = new Element();revision.selectors = ['[data-jb-versions]'];state.root.dispatch('click',{target:revision});
  assert.equal(edits,1);assert.equal(versions,1);state.control.destroy();
});

test('kind selector is shown only when both daily and weekly entries are available', () => {
  const {api,control} = fixture();
  const both = api.render({kind:'weekly',kinds:['daily','weekly'],items:weekly,path:weekly[1].source_path});
  assert.ok(both.includes('data-jb-kind'));assert.match(both,/<option value="weekly" selected>周记<\/option>/);
  assert.ok(!api.render({kinds:['daily'],items:small,path:'c.md'}).includes('data-jb-kind'));control.destroy();
});

test('kind changes call the host once and revert the selector when switching fails', async () => {
  const pending = deferred(), changes = [], state = fixture({config:{kind:'daily',kinds:['daily','weekly'],onKind:kind => {changes.push(kind);return pending.promise;}}});
  const select = state.selectors.get('[data-jb-kind]');select.value = 'weekly';select.dispatch('change',{target:select});select.dispatch('change',{target:select});
  assert.deepEqual(changes,['weekly']);assert.equal(select.disabled,true);pending.reject(new Error('无法打开周记'));await flush();
  assert.equal(select.value,'daily');assert.equal(select.disabled,false);assert.equal(state.errors.length,1);state.control.destroy();
});

test('year, month, and title filters combine without changing chronological page numbers', () => {
  const {api,control} = fixture();
  const result = api.filterItems(api.indexItems(small),{year:'2026',month:'02',query:'晚'});
  assert.equal(result.length,1);assert.equal(result[0].page,2);assert.equal(result[0].source_path,'b.md');control.destroy();
});

test('directory search includes early pages beyond 2200 records', () => {
  const {api,control} = fixture();
  const values = Array.from({length:2400}, (_,i) => {const date = new Date(Date.UTC(2010,0,i+1)).toISOString().slice(0,10);return {source_path:`page-${i}`,journal_date:date,title:i===0?'早年记录':`日记 ${i}`};});
  const items = api.indexItems(values);assert.equal(items.length,2400);assert.equal(api.filterItems(items,{query:'早年记录'})[0].source_path,'page-0');
  assert.equal(api.pagePath(items,1),'page-0');assert.equal(api.pagePath(items,2400),'page-2399');control.destroy();
});

test('invalid page jumps cannot request pages outside the index', () => {
  const {api,control} = fixture(), items = api.indexItems(small);
  for (const number of [0,-1,4,1.5,NaN]) assert.equal(api.pagePath(items,number),null);control.destroy();
});

test('date jumps keep current source when several pages have the same date', () => {
  const {api,control} = fixture();
  const items = api.indexItems([small[0],{...small[0],source_path:'a-copy.md'}]);
  assert.equal(api.datePath(items,'2026-01-01','a-copy.md'),'a-copy.md');assert.equal(api.datePath(items,'2026-09-01'),null);control.destroy();
});

test('page turns include distinct source pages from the same date, following page numbering', async () => {
  const items = [small[0],{...small[0],source_path:'z-second.md',title:'同日另一页'},small[1]];
  const state = fixture({config:{items,path:'z-second.md',ctx:{previous:{source_path:'old-context.md'},next:{source_path:'wrong-context.md'}}}});
  const indexed = state.api.indexItems(items), neighbors = state.api.pageNeighbors(indexed,'z-second.md');
  assert.equal(neighbors.previous.source_path,'a.md');assert.equal(neighbors.next.source_path,'b.md');
  state.root.dispatch('click',{target:state.previous});await flush();assert.equal(state.calls[0][0],'a.md');state.control.destroy();
});

test('deleted source pages and stale backend context cannot be reached with book turns', async () => {
  const state = fixture({config:{items:[small[0],{...small[1],deleted_at:'removed'},small[2]],ctx:{previous:{source_path:'b.md'},next:{source_path:'deleted-next.md'}}}});
  state.root.dispatch('click',{target:state.previous});await flush();assert.equal(state.calls[0][0],'a.md');
  const neighbors = state.api.pageNeighbors(state.api.indexItems([small[0],small[2]]),'c.md',{next:{source_path:'deleted-next.md'}});assert.equal(neighbors.next,null);
  const html = state.api.render({items:[small[0],small[2]],path:'c.md',ctx:{next:{source_path:'deleted-next.md'}}});assert.match(html,/data-journal-turn="next" disabled/);state.control.destroy();
});

test('context neighbors remain available for a source page absent from the entries index', async () => {
  const state = fixture({config:{path:'legacy.md',ctx:{previous:{source_path:'older.md'},next:{source_path:'newer.md'}}}});
  state.root.dispatch('click',{target:state.previous});await flush();assert.equal(state.calls[0][0],'older.md');state.control.destroy();
});

test('render escapes user title and directory strings while retaining host rich text', () => {
  const {api,control} = fixture();
  const html = api.render({j:{memory:{date:'2026-10-03'}},items:[{...small[2],title:'<img src=x onerror=alert(1)>'}],path:'c.md',paperSections:'<section><strong>原文</strong></section>'});
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));assert.ok(html.includes('<strong>原文</strong>'));assert.ok(!html.includes('<img src=x'));control.destroy();
});

test('turning a page uses context paths and blocks duplicate requests while pending', async () => {
  const pending = deferred(), state = fixture({onOpen:() => pending.promise});
  state.root.dispatch('click',{target:state.previous});state.root.dispatch('click',{target:state.previous});
  assert.equal(state.calls.length,1);assert.deepEqual(state.calls[0],['b.md','previous']);assert.equal(state.root.attributes.get('aria-busy'),'true');
  pending.resolve();await flush();assert.equal(state.root.attributes.get('aria-busy'),'false');assert.equal(state.next.disabled,true);state.control.destroy();
});

test('navigation errors keep the readable page position and reenable controls', async () => {
  const state = fixture({onOpen:async () => {throw new Error('暂时无法打开');}});state.selectors.get('.jbTextScroll').scrollTop = 670;
  state.root.dispatch('click',{target:state.previous});await flush();
  assert.equal(state.selectors.get('.jbTextScroll').scrollTop,670);assert.equal(state.errors.length,1);assert.equal(state.previous.disabled,false);
  assert.equal(state.selectors.get('.jbNavigationStatus').textContent,'暂时无法打开');state.control.destroy();
});

test('destroyed reader ignores completion and error from an outstanding navigation', async () => {
  const pending = deferred(), state = fixture({onOpen:() => pending.promise});state.root.dispatch('click',{target:state.previous});state.control.destroy();
  pending.reject(new Error('late'));await flush();assert.equal(state.errors.length,0);assert.equal(state.view.count('keydown'),0);
});

test('arrow keys turn pages while F focuses the book without activating legacy focus mode', async () => {
  const state = fixture();const f = state.view.dispatch('keydown',{key:'f'});assert.equal(f.prevented,true);assert.equal(f.stopped,true);assert.equal(state.selectors.get('.jbTextScroll').focused,true);
  const arrow = state.view.dispatch('keydown',{key:'ArrowLeft'});await flush();assert.equal(arrow.prevented,true);assert.equal(state.calls.length,1);state.control.destroy();
});

test('keyboard navigation ignores input focus, calendar, and writing overlay', () => {
  const state = fixture({calendar:{open:true}});state.view.dispatch('keydown',{key:'ArrowLeft'});assert.equal(state.calls.length,0);state.control.destroy();
  for (const tagName of ['INPUT','TEXTAREA','SELECT']) {const input = fixture();input.doc.activeElement = {tagName};input.view.dispatch('keydown',{key:'ArrowLeft'});assert.equal(input.calls.length,0);input.control.destroy();}
  const overlay = fixture({overlay:true});overlay.view.dispatch('keydown',{key:'ArrowLeft'});assert.equal(overlay.calls.length,0);overlay.control.destroy();
});

test('PageDown and PageUp scroll within the book without changing diary pages', () => {
  const state = fixture(), text = state.selectors.get('.jbTextScroll');
  const down = state.view.dispatch('keydown',{key:'PageDown'});assert.equal(down.prevented,true);assert.equal(text.scrollTop,255);assert.equal(state.calls.length,0);
  state.view.dispatch('keydown',{key:'PageUp'});assert.equal(text.scrollTop,0);state.control.destroy();
});

test('blank calendar dates do not create pages, selected current date is a successful no-op', async () => {
  const calendar = {}, state = fixture({calendar});
  assert.equal(await calendar.config.onSelect('2026-10-02'),false);assert.equal(state.calls.length,0);
  assert.equal(await calendar.config.onSelect('2026-10-03'),true);assert.equal(state.calls.length,0);
  assert.equal(await calendar.config.onSelect('2026-02-03'),true);assert.equal(state.calls[0][0],'b.md');state.control.destroy();
});

test('page number input navigates and rejects empty or fractional input', async () => {
  const state = fixture(), input = state.selectors.get('[data-jb-page]');input.value = '';input.dispatch('change',{target:input});assert.equal(input.value,'3');assert.equal(state.calls.length,0);
  input.value = '1.5';input.dispatch('change',{target:input});assert.equal(state.calls.length,0);
  input.value = '1';input.dispatch('change',{target:input});await flush();assert.equal(state.calls[0][0],'a.md');state.control.destroy();
});

test('Enter submits a page jump explicitly and a concurrent form submit cannot duplicate navigation', async () => {
  const pending = deferred(), state = fixture({onOpen:() => pending.promise}), input = state.selectors.get('[data-jb-page]');
  input.value = '1';const enter = input.dispatch('keydown',{target:input,key:'Enter'});
  assert.equal(enter.prevented,true);assert.equal(enter.propagationStopped,true);assert.equal(state.calls.length,1);assert.equal(state.calls[0][0],'a.md');
  state.selectors.get('.jbPageJump').dispatch('submit');assert.equal(state.calls.length,1);
  pending.resolve();await flush();state.control.destroy();
});

test('Enter rejects invalid page numbers and Escape restores the current number', () => {
  const state = fixture(), input = state.selectors.get('[data-jb-page]');
  for (const value of ['', '0', '4', '1.5', 'invalid']) {
    input.value = value;const enter = input.dispatch('keydown',{target:input,key:'Enter'});
    assert.equal(enter.prevented,true);assert.equal(input.value,'3');assert.equal(state.calls.length,0);
  }
  input.value = '1';const escape = input.dispatch('keydown',{target:input,key:'Escape'});assert.equal(escape.prevented,true);assert.equal(input.value,'3');assert.equal(state.calls.length,0);state.control.destroy();
});

test('reader height excludes topbar and inner progress reflects hidden scroll position', () => {
  const state = fixture(), text = state.selectors.get('.jbTextScroll');assert.equal(state.root.properties.get('--journal-height'),'724px');
  text.scrollTop = 850;text.dispatch('scroll');assert.equal(state.root.properties.get('--jb-reading-progress'),'50%');state.control.destroy();
});

test('removing reader DOM releases window handlers and lifecycle observer', () => {
  const state = fixture();state.root.isConnected = false;state.lifecycle().callback();
  assert.equal(state.view.count('keydown'),0);assert.equal(state.lifecycle().disconnected,true);state.control.destroy();
});
