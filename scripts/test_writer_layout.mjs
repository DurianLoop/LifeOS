import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../app/writer-layout.js', import.meta.url), 'utf8');

class Events {
  listeners = new Map();
  addEventListener(name, fn, options = {}) {
    if (options.signal?.aborted) return;
    const list = this.listeners.get(name) || [];list.push(fn);this.listeners.set(name, list);
    options.signal?.addEventListener('abort', () => this.listeners.set(name, (this.listeners.get(name) || []).filter(item => item !== fn)), {once:true});
  }
  dispatch(name, fields = {}) {
    const event = {preventDefault(){this.prevented = true;}, stopPropagation(){this.stopped = true;}, ...fields};
    for (const fn of [...(this.listeners.get(name) || [])]) fn(event);
    return event;
  }
  count(name) {return this.listeners.get(name)?.length || 0;}
}

function style() {
  return new Proxy({setProperty(key, value){this[key] = value;}, getPropertyValue(key){return this[key] || '';}, removeProperty(key){delete this[key];}},
    {get(target, key){return target[key] ?? '';}});
}

function matches(node, selector) {
  if (selector.includes(',')) return selector.split(',').some(part => matches(node, part));
  if (selector.endsWith(':not([hidden])')) return !node.hidden && matches(node, selector.slice(0, -14));
  if (selector.startsWith('.')) return node.classList.contains(selector.slice(1));
  const attribute = selector.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);
  if (attribute) return node.attributes.has(attribute[1]) && (attribute[2] === undefined || node.attributes.get(attribute[1]) === attribute[2]);
  return node.tagName.toLowerCase() === selector;
}

class Node extends Events {
  children = [];attributes = new Map();dataset = {};style = style();classes = new Set();hidden = false;
  clientWidth = 0;clientHeight = 0;scrollTop = 0;scrollLeft = 0;scrollHeight = 0;
  constructor(tag, doc) {
    super();this.tagName = tag.toUpperCase();this.ownerDocument = doc;
    this.classList = {contains:value => this.classes.has(value), add:(...values) => values.forEach(value => this.classes.add(value)),
      remove:(...values) => values.forEach(value => this.classes.delete(value)),
      toggle:(value, force) => {const yes = force ?? !this.classes.has(value);if (yes) this.classes.add(value);else this.classes.delete(value);return yes;}};
  }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = String(value);
  }
  append(node) {node.remove();this.children.push(node);node.parentElement = this;}
  prepend(node) {node.remove();this.children.unshift(node);node.parentElement = this;}
  remove() {if (!this.parentElement) return;this.parentElement.children = this.parentElement.children.filter(child => child !== this);this.parentElement = null;}
  closest(selector) {for (let node = this; node; node = node.parentElement) if (matches(node, selector)) return node;return null;}
  querySelectorAll(selector) {return this.children.flatMap(child => [...(matches(child, selector) ? [child] : []), ...child.querySelectorAll(selector)]);}
  querySelector(selector) {return this.querySelectorAll(selector)[0] || null;}
  contains(node) {return this === node || this.children.some(child => child.contains(node));}
  get isConnected() {return this.ownerDocument.documentElement.contains(this);}
  getBoundingClientRect() {
    const left = this.rectLeft || 0, top = (this.rectTop || 0) - this.ownerDocument.scrollingElement.scrollTop;
    const width = this.clientWidth || parseFloat(this.style.width) || 0, height = parseFloat(this.style.height) || this.clientHeight || 0;
    return {left, top, width, height, right:left + width, bottom:top + height};
  }
  focus() {this.ownerDocument.activeElement = this;}
  setPointerCapture() {} releasePointerCapture() {}
}

function fixture(cells, width = 900) {
  const doc = new Events(), rafs = new Map(), resizeObservers = [], mutationObservers = [], saved = [], reasons = [];let rafId = 0;
  const observerClass = list => class {constructor(fn){this.fn = fn;list.push(this);}observe(node){this.target = node;}disconnect(){this.disconnected = true;}};
  const view = {innerHeight:800, ResizeObserver:observerClass(resizeObservers), MutationObserver:observerClass(mutationObservers),
    requestAnimationFrame:fn => {rafs.set(++rafId, fn);return rafId;}, cancelAnimationFrame:id => rafs.delete(id),
    getComputedStyle:node => ({overflowY:node.overflowY || 'visible'})};
  doc.defaultView = view;doc.createElement = tag => new Node(tag, doc);doc.documentElement = new Node('html', doc);
  doc.documentElement.lang = 'zh';doc.documentElement.clientHeight = 800;doc.documentElement.scrollHeight = 10000;
  doc.scrollingElement = doc.documentElement;doc.activeElement = doc.documentElement;
  const grid = new Node('main', doc);grid.clientWidth = width;grid.clientHeight = 600;grid.rectTop = 100;
  doc.documentElement.append(grid);
  for (const cell of cells) {
    const card = new Node('section', doc);card.classList.add('i2WriterCell');card.dataset.key = cell.key;
    if (cell.visible === false) card.classList.add('i2Hidden');
    const head = new Node('div', doc);head.classList.add('i2CellHead');
    const title = new Node('span', doc);title.setAttribute('data-cell-title', '');head.append(title);
    const input = new Node('input', doc);head.append(input);card.append(head);grid.append(card);
  }
  const context = {window:view, document:doc, AbortController, console, Date};vm.createContext(context);vm.runInContext(source, context);
  const controller = view.lifeosWriterLayout.mount(grid, {cells, onChange:(frames, metadata) => {saved.push(JSON.parse(JSON.stringify(frames)));reasons.push(metadata.reason);}});
  const card = key => grid.children.find(node => node.dataset.key === key);
  const runRaf = () => {const [id, fn] = [...rafs].at(-1) || [];if (fn) {rafs.delete(id);fn();}};
  const resize = next => {grid.clientWidth = next;resizeObservers[0].fn();runRaf();};
  const mutation = () => mutationObservers.filter(item => !item.disconnected).forEach(item => item.fn());
  const pointer = (target, x, y) => grid.dispatch('pointerdown', {target, button:0, pointerId:7, clientX:x, clientY:y});
  const move = (x, y) => doc.dispatch('pointermove', {pointerId:7, clientX:x, clientY:y});
  const end = () => doc.dispatch('pointerup', {pointerId:7});
  return {doc, grid, card, saved, reasons, controller, resize, mutation, pointer, move, end, rafs, runRaf, resizeObservers, mutationObservers};
}

const frame = (x, y, width, height, basis = 900) => ({x, y, width, height, basis});
const cell = (key, geometry, extra = {}) => ({key, label:key, visible:true, frame:geometry, ...extra});
const geometry = node => Object.fromEntries(['left', 'top', 'width', 'height'].map(field => [field, Number.parseFloat(node.style[field])]));
const resizeHandle = (app, key, direction = 'se') => app.card(key).querySelector(`[data-writer-resize="${direction}"]`);
const moveHandle = (app, key) => app.card(key).querySelector('[data-writer-move]');
const cards = app => app.grid.children.filter(node => node.classList.contains('i2WriterCell'));
const noOverlaps = frames => {
  const all = Object.values(frames);
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
    const a = all[i], b = all[j];assert.ok(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y, 'saved cards never cover each other');
  }
};

test('legacy cards migrate once into usable positions without altering their content or options', () => {
  const cells = [cell('diary', undefined, {size:'wide', text:'Keep this paragraph'}), ...['a', 'b', 'c', 'd', 'e'].map(key => cell(key, undefined, {size:'standard'}))];
  const app = fixture(cells, 850);
  assert.equal(app.saved.length, 1);const stored = app.saved[0];
  assert.equal(stored.diary.width, 850);assert.ok(stored.a.x !== stored.b.x);
  for (const value of Object.values(stored)) {assert.equal(value.basis, 850);assert.ok(value.width >= 220 && value.height >= 160);}
  noOverlaps(stored);assert.ok(parseFloat(app.grid.style.height) >= Math.max(...Object.values(stored).map(value => value.y + value.height)));
  assert.equal(cells[0].text, 'Keep this paragraph');assert.equal(cells[0].frame, undefined);assert.equal(cells[0].size, 'wide');
  app.mutation();assert.equal(app.saved.length, 1, 'control insertion does not repeatedly migrate');
});

test('invalid stored frames become finite bounded geometry', () => {
  const app = fixture([cell('broken', {x:Infinity, y:-500, width:NaN, height:-1, basis:0}), cell('huge', frame(1e30, 1e30, 1e30, 1e30, 1e30))]);
  assert.equal(app.saved.length, 1);
  for (const value of Object.values(app.saved[0])) {
    assert.ok(Object.values(value).every(Number.isFinite));assert.ok(value.x >= 0 && value.y >= 0);
    assert.ok(value.width >= 220 && value.width <= value.basis && value.x + value.width <= value.basis);
    assert.ok(value.height >= 160 && value.height <= 4000);assert.ok(value.y <= 100000);
  }
});

test('pointer resizing preserves continuous dimensions and moves colliding neighbours down', () => {
  const app = fixture([cell('a', frame(0, 0, 300, 200)), cell('b', frame(320, 0, 300, 200)), cell('c', frame(320, 216, 300, 200))]);
  app.controller.setEditing(true);app.pointer(resizeHandle(app, 'a'), 300, 300);
  app.move(347.25, 337.5);assert.equal(app.grid.dataset.layoutGesture, 'resize');app.end();
  assert.equal(app.saved.length, 1);const stored = app.saved[0];
  assert.equal(stored.a.width, 347.25);assert.equal(stored.a.height, 237.5);assert.equal(stored.a.x, 0);assert.equal(stored.a.y, 0);
  assert.ok(stored.b.y >= stored.a.height + 16);assert.ok(stored.c.y >= stored.b.y + stored.b.height + 16);
  noOverlaps(stored);assert.equal(app.grid.dataset.layoutGesture, undefined);
});

test('Escape restores every card after a collision preview and removes gesture listeners', () => {
  const app = fixture([cell('a', frame(0, 0, 300, 200)), cell('b', frame(320, 0, 300, 200))]);
  app.controller.setEditing(true);const before = cards(app).map(geometry);
  app.pointer(resizeHandle(app, 'a'), 300, 300);app.move(420, 360);
  assert.ok(geometry(app.card('b')).top > 0);
  const escape = app.doc.dispatch('keydown', {key:'Escape'});
  assert.equal(escape.prevented, true);assert.deepEqual(cards(app).map(geometry), before);assert.equal(app.saved.length, 0);
  assert.equal(app.doc.count('pointermove'), 0);assert.equal(app.doc.count('pointerup'), 0);assert.equal(app.doc.count('keydown'), 0);
  assert.equal(app.grid.dataset.layoutGesture, undefined);assert.ok(!app.card('a').classList.contains('is-resizing'));
});

test('title clicks remain available for rename, while independent handles drag continuously', () => {
  const app = fixture([cell('a', frame(0, 0, 300, 200))]);app.controller.setEditing(true);
  app.pointer(app.card('a').querySelector('[data-cell-title]'), 10, 120);assert.equal(app.grid.dataset.layoutGesture, undefined);
  app.pointer(app.card('a').querySelector('input'), 10, 120);assert.equal(app.grid.dataset.layoutGesture, undefined);
  app.pointer(moveHandle(app, 'a'), 10, 120);app.move(28.75, 137.25);app.end();
  assert.equal(app.saved[0].a.x, 18.75);assert.equal(app.saved[0].a.y, 0, 'isolated cards settle at the top');
});

test('narrow screens keep desktop frames and user height without persisting temporary stacking', () => {
  const cells = [cell('a', frame(0, 0, 300, 280)), cell('b', frame(330, 0, 300, 360))], app = fixture(cells);
  const desktop = cards(app).map(geometry);app.controller.setEditing(true);app.resize(390);
  assert.equal(app.saved.length, 0);assert.equal(geometry(app.card('a')).width, 390);assert.equal(geometry(app.card('a')).height, 280);
  assert.equal(geometry(app.card('b')).top, 296);assert.equal(geometry(app.card('b')).height, 360);
  assert.equal(moveHandle(app, 'a').hidden, true);assert.equal(resizeHandle(app, 'a').disabled, true);
  app.pointer(moveHandle(app, 'a'), 10, 120);app.move(30, 140);app.end();assert.equal(app.saved.length, 0);
  app.resize(900);assert.deepEqual(cards(app).map(geometry), desktop);assert.equal(moveHandle(app, 'a').hidden, false);
});

test('focus mode temporarily clears absolute geometry and restores edits on returning to overview', () => {
  const app = fixture([cell('a', frame(0, 0, 300, 200))]);app.controller.setEditing(true);
  app.pointer(moveHandle(app, 'a'), 10, 120);app.move(47, 161);app.end();
  const edited = geometry(app.card('a'));app.grid.classList.add('is-focused-cell');app.mutation();
  assert.equal(app.card('a').style.position, '');assert.equal(app.card('a').style.width, '');assert.equal(app.grid.style.height, '');
  app.grid.classList.remove('is-focused-cell');app.mutation();assert.deepEqual(geometry(app.card('a')), edited);
  assert.equal(app.saved.length, 1);
});

test('saved geometry survives update, reopening and proportional width changes', () => {
  const app = fixture([cell('a', frame(0, 0, 300, 240))]);app.controller.setEditing(true);
  app.pointer(resizeHandle(app, 'a'), 300, 340);app.move(355.5, 390.5);app.end();
  const stored = app.saved[0].a;app.controller.update([cell('a', stored, {label:'Renamed'})]);
  assert.equal(geometry(app.card('a')).width, 355.5);const reopened = fixture([cell('a', stored)], 750);
  assert.ok(Math.abs(geometry(reopened.card('a')).width - stored.width * 750 / stored.basis) < .01);
  assert.equal(geometry(reopened.card('a')).height, stored.height);assert.equal(reopened.saved.length, 0);
});

test('fractional canvas widths keep two neighbouring cards on the same row', () => {
  const app = fixture([cell('a', frame(0, 0, 469.57, 230, 955)), cell('b', frame(485.42, 0, 469.57, 230, 955))], 954.72);
  assert.equal(geometry(app.card('a')).top, 0);assert.equal(geometry(app.card('b')).top, 0);
  app.resize(955);assert.equal(geometry(app.card('b')).top, 0);assert.equal(app.saved.length, 0);
});

test('responsive width scaling preserves neighbouring rows instead of treating a smaller gutter as overlap', () => {
  const app = fixture([cell('a', frame(0, 0, 440, 230)), cell('b', frame(456, 0, 440, 230))]);
  app.resize(750);assert.equal(geometry(app.card('a')).top, 0);assert.equal(geometry(app.card('b')).top, 0);
  assert.ok(geometry(app.card('a')).width < geometry(app.card('b')).left);assert.equal(app.saved.length, 0);
});

test('ResizeObserver waits until the next frame and uses the latest width', () => {
  const app = fixture([cell('a', frame(0, 0, 300, 230))]);
  app.grid.clientWidth = 810;app.resizeObservers[0].fn();
  app.grid.clientWidth = 750;app.resizeObservers[0].fn();
  assert.equal(app.rafs.size, 1);assert.equal(geometry(app.card('a')).width, 300);
  app.runRaf();assert.equal(geometry(app.card('a')).width, 250);assert.equal(app.rafs.size, 0);
  app.resizeObservers[0].fn();app.controller.destroy();assert.equal(app.rafs.size, 0);
});

test('move and resize handles support bounded keyboard changes with a larger Shift step', () => {
  const app = fixture([cell('a', frame(0, 0, 300, 200))]);app.controller.setEditing(true);
  assert.equal(app.doc.activeElement, moveHandle(app, 'a'));
  app.grid.dispatch('keydown', {target:moveHandle(app, 'a'), key:'ArrowRight', shiftKey:true});
  app.grid.dispatch('keydown', {target:resizeHandle(app, 'a', 'se'), key:'ArrowDown'});
  assert.equal(app.saved.at(-1).a.x, 20);assert.equal(app.saved.at(-1).a.height, 201);
  const left = app.grid.dispatch('keydown', {target:resizeHandle(app, 'a', 'w'), key:'ArrowLeft', shiftKey:true});
  assert.equal(left.prevented, true);assert.equal(app.saved.at(-1).a.x, 0);assert.equal(app.saved.at(-1).a.width, 320);
});

test('edge scrolling starts after an actual drag and stops on release', () => {
  const app = fixture([cell('a', frame(0, 0, 300, 200))]);app.controller.setEditing(true);
  app.pointer(moveHandle(app, 'a'), 10, 785);app.runRaf();
  assert.equal(app.doc.scrollingElement.scrollTop, 0, 'holding a handle without dragging does not scroll');
  app.move(15, 785);app.runRaf();assert.ok(app.doc.scrollingElement.scrollTop > 0);
  assert.ok(geometry(app.card('a')).top > 0, 'gesture may move vertically before settling');
  app.end();assert.equal(app.saved[0].a.y, 0);assert.equal(app.rafs.size, 0);
});

test('natural scrolling updates the drag offset, and detached grids leave no active listeners', () => {
  const app = fixture([cell('a', frame(0, 0, 300, 200))]);app.controller.setEditing(true);
  app.pointer(moveHandle(app, 'a'), 10, 120);app.doc.scrollingElement.scrollTop = 75;app.doc.dispatch('scroll');
  assert.equal(geometry(app.card('a')).top, 75);app.end();assert.equal(app.saved[0].a.y, 0);
  app.pointer(moveHandle(app, 'a'), 10, 120);app.move(50, 160);app.grid.remove();app.mutation();
  assert.equal(app.doc.count('pointermove'), 0);assert.equal(app.doc.count('keydown'), 0);assert.equal(app.grid.count('pointerdown'), 0);
  assert.equal(app.rafs.size, 0);assert.ok(app.resizeObservers.every(observer => observer.disconnected));
  app.controller.destroy();assert.equal(app.saved.length, 1);
});

test('loading a sparse layout fills top and column holes without changing card sizes or horizontal positions', () => {
  const original = [cell('left', frame(24, 300, 280, 200)), cell('right', frame(340, 400, 300, 400)),
    cell('left-note', frame(24, 1100, 280, 160)), cell('right-note', frame(340, 1800, 300, 160)),
    cell('bridge', frame(24, 2400, 616, 190))];
  const app = fixture(original), stored = app.saved[0];
  assert.equal(app.reasons[0], 'hydrate');
  assert.equal(stored.left.y, 0);assert.equal(stored.right.y, 0);
  assert.equal(stored['left-note'].y, 216);assert.equal(stored['right-note'].y, 416);assert.equal(stored.bridge.y, 592);
  for (const item of original) for (const dimension of ['x', 'width', 'height']) assert.equal(stored[item.key][dimension], item.frame[dimension]);
  noOverlaps(stored);assert.equal(app.controller.compact(), false);assert.equal(app.saved.length, 1, 'already compact layouts do not emit again');
  app.controller.update(original.map(item => cell(item.key, stored[item.key])));
  assert.equal(app.saved.length, 1, 'saved compact geometry is stable on update');
});

test('moving between columns fills the vacated column and never pins the gesture preview', () => {
  const app = fixture([cell('a', frame(0, 0, 280, 200)), cell('b', frame(0, 216, 280, 180)), cell('c', frame(340, 0, 280, 260))]);
  app.controller.setEditing(true);app.pointer(moveHandle(app, 'a'), 10, 120);app.move(353, 547);
  assert.equal(geometry(app.card('a')).left, 340, 'nearby column edge snaps');
  assert.equal(geometry(app.card('a')).top, 427, 'preview still follows vertical dragging');
  app.end();const stored = app.saved[0];
  assert.equal(stored.b.y, 0);assert.equal(stored.c.y, 0);assert.equal(stored.a.y, 276);assert.equal(app.reasons[0], 'edit');noOverlaps(stored);
});

test('dragging shows matching edge and centre guides and removes them on release', () => {
  const app = fixture([cell('a', frame(0, 0, 280, 200)), cell('b', frame(340, 0, 280, 260))]);
  app.controller.setEditing(true);app.pointer(moveHandle(app, 'a'), 10, 120);app.move(353, 125);
  assert.equal(geometry(app.card('a')).left, 340);assert.equal(geometry(app.card('a')).top, 0);
  const vertical = app.grid.querySelector('.i2WriterGuide--x'), horizontal = app.grid.querySelector('.i2WriterGuide--y');
  assert.equal(vertical.hidden, false);assert.equal(vertical.style.left, '340px');assert.equal(horizontal.hidden, false);
  app.end();assert.equal(vertical.hidden, true);assert.equal(horizontal.hidden, true);
  app.controller.destroy();assert.equal(app.grid.querySelector('.i2WriterGuide'), null, 'guide nodes are cleaned up with controller');
});

test('resize edges snap to card edges while non-nearby dimensions stay continuous', () => {
  const app = fixture([cell('a', frame(0, 0, 280, 200)), cell('b', frame(340, 0, 300, 300))]);
  app.controller.setEditing(true);app.pointer(resizeHandle(app, 'a'), 280, 300);app.move(295, 398);
  assert.equal(geometry(app.card('a')).width, 295);assert.equal(geometry(app.card('a')).height, 300);
  assert.equal(app.grid.querySelector('.i2WriterGuide--y').style.top, '300px');app.end();
  assert.equal(app.saved[0].a.width, 295);assert.equal(app.saved[0].a.height, 300);
  app.pointer(resizeHandle(app, 'b', 'e'), 640, 400);app.move(896, 400);app.end();
  assert.equal(app.saved.at(-1).b.width, 560, 'right canvas boundary snaps without overshooting');noOverlaps(app.saved.at(-1));
});

test('hiding and restoring cards compacts the remaining column and saves update metadata', () => {
  const original = [cell('a', frame(0, 0, 280, 200)), cell('b', frame(0, 216, 280, 180)), cell('c', frame(340, 0, 280, 260))];
  const app = fixture(original);app.card('a').classList.add('i2Hidden');
  app.controller.update(original.map(item => item.key === 'a' ? {...item, visible:false} : item));
  assert.equal(app.saved[0].b.y, 0);assert.equal(app.reasons[0], 'update');assert.equal(geometry(app.card('c')).top, 0);
  app.card('a').classList.remove('i2Hidden');
  app.controller.update(original.map(item => cell(item.key, app.saved[0][item.key])));
  assert.equal(app.saved.at(-1).b.y, 216);noOverlaps(app.saved.at(-1));
});

test('keyboard vertical movement reorders packed cards instead of introducing a blank row', () => {
  const app = fixture([cell('a', frame(0, 0, 280, 200)), cell('b', frame(0, 216, 280, 180)), cell('c', frame(0, 412, 280, 160))]);
  app.controller.setEditing(true);app.grid.dispatch('keydown', {target:moveHandle(app, 'a'), key:'ArrowDown'});
  assert.equal(app.saved.at(-1).b.y, 0);assert.equal(app.saved.at(-1).a.y, 196);assert.equal(app.saved.at(-1).c.y, 412);
  app.grid.dispatch('keydown', {target:moveHandle(app, 'c'), key:'ArrowUp', shiftKey:true});
  assert.equal(app.saved.at(-1).b.y, 0);assert.equal(app.saved.at(-1).c.y, 196);assert.equal(app.saved.at(-1).a.y, 372);noOverlaps(app.saved.at(-1));
});
