import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const code = readFileSync(new URL('../app/memory-draw.js', import.meta.url), 'utf8');
const KEY = 'lifeos.memory.draw.v1';
const path = suffix => `memories/daily/2026/${suffix}.md`;
const result = (suffix, drawId = `memory:${suffix}`) => ({
  type: 'memory', draw_id: drawId, sources: [{source_path: path(suffix), title: suffix, excerpt: suffix}],
});

function app({data = {paths: [], recent: []}, failRead = false, failWrite = false, mounted = false} = {}) {
  let disk = JSON.stringify(data), readsFail = failRead, writesFail = failWrite, writes = 0;
  const events = {}, clicks = {}, toasts = [], requests = [];
  const nodes = mounted ? {
    memoryDrawStage: {innerHTML: '', isConnected: true, attributes: {}, setAttribute(name, value) {this.attributes[name] = value;}},
    memoryDrawFeedback: {textContent: ''}, memoryDrawMarkCount: {textContent: ''},
  } : {};
  const context = {
    window: {addEventListener(name, fn) {events[name] = fn;}},
    document: {getElementById: id => nodes[id] || null, querySelector: () => null,
      querySelectorAll: () => [], addEventListener(name, fn) {clicks[name] = fn;}},
    localStorage: {getItem() {if (readsFail) throw Error('storage read failed'); return disk;},
      setItem(key, value) {assert.equal(key, KEY); if (writesFail) throw Error('storage write failed'); disk = value; writes++;}},
    STATE: {feature: 'Serendipity'}, RENDERERS: {}, pageWrap: text => text,
    toast: text => toasts.push(text), AbortController, URLSearchParams,
    api(url, options) {return new Promise((resolve, reject) => requests.push({url, options, resolve, reject}));},
  };
  vm.runInNewContext(code, context, {filename: 'memory-draw.js'});
  return {
    api: context.window.lifeosMemoryDraw, context, nodes, toasts, requests,
    disk: () => JSON.parse(disk), marks: () => Array.from(context.window.lifeosMemoryDraw.marks()),
    writes: () => writes, readFails(value) {readsFail = value;}, writeFails(value) {writesFail = value;},
    external(data) {disk = JSON.stringify(data);}, storage(key = KEY) {events.storage({key});},
    mode(mode) {clicks.click({target: {closest: () => ({dataset: {memoryMode: mode}})}});},
  };
}

test('bookmarks persist across reload and cancellation persists independently of diary content', () => {
  const first = app();
  assert.equal(first.api.mark(path('old'), true), true);
  const reopened = app({data: first.disk()});
  assert.deepEqual(reopened.marks(), [path('old')]);
  assert.equal(reopened.api.mark(path('old'), false), true);
  assert.deepEqual(app({data: reopened.disk()}).marks(), []);
});

test('capacity rejects the next bookmark without losing old marks or diverging from disk', () => {
  const paths = Array.from({length: 5000}, (_, index) => path(index));
  const current = app({data: {paths, recent: ['memory:old']}});
  assert.equal(current.api.mark(path('new'), true), false);
  assert.equal(current.writes(), 0);
  assert.deepEqual(current.marks(), paths);
  assert.deepEqual(current.disk().paths, paths);
  assert.match(current.toasts.at(-1), /彩笺已满/);
  assert.equal(current.api.mark(path(0), true), true);
  assert.equal(current.api.mark(path(0), false), true);
  assert.equal(current.api.mark(path('new'), true), true);
  assert.equal(current.marks().length, 5000);
  assert.deepEqual(current.marks(), current.disk().paths);
});

test('older oversized bookmark collections remain intact and can be reduced safely', () => {
  const paths = Array.from({length: 5001}, (_, index) => path(index));
  const current = app({data: {paths, recent: []}});
  assert.equal(current.marks().length, 5001);
  assert.equal(current.api.mark(path('new'), true), false);
  assert.deepEqual(current.disk().paths, paths);
  assert.equal(current.api.mark(path(0), false), true);
  assert.equal(current.marks().length, 5000);
  assert.deepEqual(current.marks(), current.disk().paths);
});

test('temporary startup read failure recovers existing bookmarks before adding a new one', () => {
  const current = app({data: {paths: [path('old')], recent: ['memory:old']}, failRead: true});
  current.readFails(false);
  assert.equal(current.api.mark(path('new'), true), true);
  assert.deepEqual(current.disk().paths, [path('old'), path('new')]);
  assert.deepEqual(current.disk().recent, ['memory:old']);
});

test('continued read failure blocks both additions and cancellations without clearing known marks', () => {
  const current = app({data: {paths: [path('old')], recent: []}});
  current.readFails(true);
  assert.equal(current.api.mark(path('new'), true), false);
  assert.equal(current.api.mark(path('old'), false), false);
  assert.deepEqual(current.marks(), [path('old')]);
  assert.deepEqual(current.disk().paths, [path('old')]);
  assert.equal(current.writes(), 0);
  assert.match(current.toasts.at(-1), /无法读取/);
});

test('write failures leave both persisted marks and visible marks unchanged, then allow retry', () => {
  const current = app({data: {paths: [path('old')], recent: []}, failWrite: true});
  assert.equal(current.api.mark(path('new'), true), false);
  assert.equal(current.api.mark(path('old'), false), false);
  assert.deepEqual(current.marks(), [path('old')]);
  assert.deepEqual(current.disk().paths, [path('old')]);
  assert.match(current.toasts.at(-1), /未能保存/);
  current.writeFails(false);
  assert.equal(current.api.mark(path('old'), false), true);
  assert.deepEqual(current.marks(), []);
});

test('storage events retain known marks on read failure and adopt recovered external changes', () => {
  const current = app({data: {paths: [path('old')], recent: []}});
  current.external({paths: [path('external')], recent: []});
  current.readFails(true);
  current.storage();
  assert.deepEqual(current.marks(), [path('old')]);
  current.readFails(false);
  current.storage();
  assert.deepEqual(current.marks(), [path('external')]);
});

test('draw completion merges history into the latest storage without erasing concurrent bookmarks', async () => {
  const current = app({data: {paths: [path('old')], recent: ['echo:old']}, mounted: true});
  const pending = current.api.draw();
  current.external({paths: [path('old'), path('external')], recent: ['echo:old', 'memory:external']});
  current.requests[0].resolve(result('fresh'));
  assert.equal(await pending, true);
  assert.deepEqual(current.disk().paths, [path('old'), path('external')]);
  assert.deepEqual(current.disk().recent, ['echo:old', 'memory:external', 'memory:fresh']);
  assert.equal(current.nodes.memoryDrawStage.attributes['aria-busy'], 'false');
});

test('draw remains readable when history cannot be read or written and preserves stored bookmarks', async () => {
  for (const failure of ['read', 'write']) {
    const current = app({data: {paths: [path('old')], recent: []}, mounted: true});
    const pending = current.api.draw();
    if (failure === 'read') current.readFails(true); else current.writeFails(true);
    current.requests[0].resolve(result('fresh'));
    assert.equal(await pending, true);
    assert.match(current.nodes.memoryDrawStage.innerHTML, /fresh/);
    assert.equal(current.nodes.memoryDrawStage.attributes['aria-busy'], 'false');
    assert.deepEqual(current.disk().paths, [path('old')]);
    assert.deepEqual(current.marks(), [path('old')]);
    assert.equal(current.writes(), 0);
    assert.ok(current.toasts.length);
  }
});

test('switching modes aborts an old draw and a late response cannot replace the new result', async () => {
  const current = app({mounted: true});
  const oldDraw = current.api.draw();
  current.mode('echo');
  assert.equal(current.requests[0].options.signal.aborted, true);
  const newDraw = current.api.draw();
  current.requests[1].resolve(result('new-mode', 'echo:fresh'));
  assert.equal(await newDraw, true);
  current.requests[0].resolve(result('old-mode'));
  assert.equal(await oldDraw, false);
  assert.match(current.nodes.memoryDrawStage.innerHTML, /new-mode/);
  assert.doesNotMatch(current.nodes.memoryDrawStage.innerHTML, /old-mode/);
  assert.deepEqual(current.disk().recent, ['echo:fresh']);
});

test('leaving the page before a response completes cannot change history or paint a hidden result', async () => {
  const current = app({mounted: true});
  const pending = current.api.draw();
  current.context.STATE.feature = 'Home';
  current.nodes.memoryDrawStage.isConnected = false;
  current.requests[0].resolve(result('late'));
  assert.equal(await pending, false);
  assert.equal(current.writes(), 0);
  assert.deepEqual(current.disk().recent, []);
});
