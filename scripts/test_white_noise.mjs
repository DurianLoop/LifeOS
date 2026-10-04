import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const code = readFileSync(new URL('../app/white-noise.js', import.meta.url), 'utf8');
const manifest = JSON.parse(readFileSync(new URL('../app/assets/audio/SOURCES.json', import.meta.url), 'utf8'));
const kinds = ['rain', 'fire', 'ocean', 'forest', 'stream', 'night'];
const tick = () => new Promise(resolve => setImmediate(resolve));

function setup({ supported = true, saved = null, deferResume = false, deferFetch = false, deferDecode = false } = {}) {
  const ids = ['Toggle', 'Kind', 'Volume', 'VolumeText', 'Status'];
  const elements = Object.fromEntries(ids.map(name => [`whiteNoise${name}`, {
    value: '', textContent: '', disabled: false, handlers: {}, attributes: {},
    addEventListener(name, handler) { this.handlers[name] = handler; },
    setAttribute(name, value) { this.attributes[name] = value; },
  }]));
  const contexts = [];
  const lifecycle = {};
  const timers = new Map();
  const requests = [];
  const failures = new Set();
  let timerId = 0;
  let stored = saved;
  class AudioParam {
    value = 0;
    events = [];
    cancelScheduledValues(time) { this.events = this.events.filter(event => event.time < time); }
    setValueAtTime(value, time) { this.value = value; this.events.push({ type: 'set', value, time }); }
    linearRampToValueAtTime(value, time) { this.events.push({ type: 'ramp', value, time }); }
  }
  class AudioNode {
    connected = false;
    connect() { this.connected = true; }
    disconnect() { this.connected = false; }
  }
  class AudioContext {
    currentTime = 0;
    state = 'suspended';
    sources = [];
    gains = [];
    decodes = [];
    constructor(options) { this.sampleRate = options.sampleRate; contexts.push(this); }
    async resume() {
      if (deferResume) await new Promise(resolve => { this.finishResume = resolve; });
      if (this.state !== 'closed') this.state = 'running';
    }
    async suspend() { this.state = 'suspended'; }
    async close() { this.state = 'closed'; }
    createGain() { const node = new AudioNode(); node.gain = new AudioParam(); this.gains.push(node); return node; }
    async decodeAudioData(bytes) {
      assert.ok(bytes.byteLength > 0);
      const decode = {};
      this.decodes.push(decode);
      if (deferDecode) await new Promise((resolve, reject) => { decode.finish = resolve; decode.fail = reject; });
      return { duration: 60, sampleRate: 32000, numberOfChannels: 2 };
    }
    createBufferSource() {
      const node = new AudioNode();
      node.start = () => { node.started = true; };
      node.stop = time => { node.stopTime = time; node.stopped = true; node.onended?.(); };
      this.sources.push(node);
      return node;
    }
  }
  const sandbox = {
    document: { getElementById(id) { return elements[id]; } },
    window: { AudioContext: supported ? AudioContext : undefined, addEventListener(name, handler) { lifecycle[name] = handler; } },
    localStorage: { getItem() { return stored; }, setItem(_key, value) { stored = value; } },
    setTimeout(callback) { timers.set(++timerId, callback); return timerId; },
    clearTimeout(id) { timers.delete(id); },
    AbortController,
    fetch(url, options) {
      assert.match(url, /^\/assets\/audio\/(rain|fire|ocean|forest|stream|night)\.ogg\?v=1$/);
      const kind = /audio\/(\w+)/.exec(url)[1];
      const record = { url, kind, options };
      requests.push(record);
      return new Promise((resolve, reject) => {
        record.finish = () => resolve({ ok: !failures.has(kind), arrayBuffer: async () => new ArrayBuffer(128) });
        options.signal.addEventListener('abort', () => { record.aborted = true; reject(Object.assign(new Error('aborted'), { name: 'AbortError' })); });
        if (!deferFetch) record.finish();
      });
    },
  };
  vm.runInNewContext(code, sandbox, { filename: 'white-noise.js' });
  return {
    elements, contexts, lifecycle, requests, failures,
    stored: () => JSON.parse(stored),
    async event(name, type, value) {
      const element = elements[`whiteNoise${name}`];
      if (value !== undefined) element.value = value;
      element.handlers[type]();
      await tick();
    },
    flushTimers() { for (const callback of timers.values()) callback(); timers.clear(); },
  };
}

test('recordings load only on demand, loop locally, and stop with a fade', async () => {
  const app = setup();
  assert.equal(app.contexts.length, 0);
  assert.equal(app.requests.length, 0);
  assert.equal(app.elements.whiteNoiseToggle.attributes['aria-pressed'], 'false');
  await app.event('Toggle', 'click');
  const context = app.contexts[0];
  assert.equal(context.sources[0].loop, true);
  assert.equal(context.sources[0].started, true);
  assert.equal(app.elements.whiteNoiseToggle.textContent, '暂停');
  await app.event('Toggle', 'click');
  assert.ok(context.sources[0].stopTime > context.currentTime);
  app.flushTimers();
  assert.equal(context.state, 'suspended');
  assert.equal(app.elements.whiteNoiseToggle.attributes['aria-pressed'], 'false');
  await app.event('Toggle', 'click');
  assert.equal(context.state, 'running');
  assert.equal(context.sources.length, 2);
  assert.equal(app.requests.length, 1, 'resume reuses the decoded recording');
});

test('all six scenes crossfade and the decoded cache retains only two recordings', async () => {
  const app = setup();
  await app.event('Toggle', 'click');
  const context = app.contexts[0];
  for (const kind of kinds.slice(1)) {
    const previous = context.sources.at(-1);
    await app.event('Kind', 'change', kind);
    assert.equal(previous.stopped, true);
    assert.equal(previous.connected, false);
    assert.ok(previous.stopTime >= .45);
    assert.equal(context.sources.at(-1).connected, true);
  }
  assert.equal(app.requests.length, 6);
  await app.event('Kind', 'change', 'stream');
  assert.equal(app.requests.length, 6, 'recent recording stays cached');
  await app.event('Kind', 'change', 'rain');
  assert.equal(app.requests.length, 7, 'old decoded recordings are released');
});

test('volume and scene persist without auto-playing or retaining a pending ramp', async () => {
  const app = setup();
  await app.event('Toggle', 'click');
  await app.event('Volume', 'input', '0');
  const events = app.contexts[0].gains[0].gain.events;
  assert.equal(events.filter(event => event.type === 'ramp').length, 1);
  assert.equal(events.at(-1).value, 0);
  await app.event('Kind', 'change', 'ocean');
  await app.event('Volume', 'input', '42');
  const restored = setup({ saved: JSON.stringify(app.stored()) });
  assert.equal(restored.elements.whiteNoiseKind.value, 'ocean');
  assert.equal(restored.elements.whiteNoiseVolume.value, '42');
  assert.equal(restored.contexts.length, 0);
});

test('changing scene during download aborts the old request; cancel prevents late playback', async () => {
  const app = setup({ deferFetch: true });
  await app.event('Toggle', 'click');
  assert.equal(app.elements.whiteNoiseToggle.textContent, '取消');
  assert.equal(app.elements.whiteNoiseToggle.disabled, false);
  await app.event('Kind', 'change', 'ocean');
  assert.equal(app.requests[0].aborted, true);
  assert.equal(app.requests[1].kind, 'ocean');
  await app.event('Toggle', 'click');
  app.requests[1].finish();
  await tick();
  assert.equal(app.contexts[0].sources.length, 0);
  assert.equal(app.elements.whiteNoiseToggle.textContent, '播放');
});

test('decodes are serialized and stale results never start a source or fill the cache', async () => {
  const app = setup({ deferDecode: true });
  await app.event('Toggle', 'click');
  const context = app.contexts[0];
  await app.event('Kind', 'change', 'ocean');
  await app.event('Kind', 'change', 'forest');
  assert.equal(app.requests.length, 1);
  context.decodes[0].finish();
  await tick();
  assert.equal(app.requests.length, 2);
  assert.equal(app.requests[1].kind, 'forest');
  assert.equal(context.sources.length, 0);
  context.decodes[1].finish();
  await tick();
  assert.equal(context.sources.length, 1);
  await app.event('Kind', 'change', 'rain');
  assert.equal(app.requests.length, 3, 'superseded rain decode was discarded');
  context.decodes[2].finish();
  await tick();
});

test('a failed switch keeps the previous recording and can be retried', async () => {
  const app = setup();
  await app.event('Toggle', 'click');
  const previous = app.contexts[0].sources[0];
  app.failures.add('fire');
  await app.event('Kind', 'change', 'fire');
  assert.equal(previous.stopped, undefined);
  assert.equal(app.elements.whiteNoiseKind.value, 'rain');
  assert.match(app.elements.whiteNoiseStatus.textContent, /继续播放/);
  assert.equal(app.elements.whiteNoiseToggle.attributes['aria-busy'], 'false');
  app.failures.delete('fire');
  await app.event('Kind', 'change', 'fire');
  assert.equal(previous.stopped, true);
  assert.equal(app.elements.whiteNoiseKind.value, 'fire');
});

test('decode failure returns usable feedback and retry succeeds', async () => {
  const app = setup({ deferDecode: true });
  await app.event('Toggle', 'click');
  app.contexts[0].decodes[0].fail(new Error('bad recording'));
  await tick();
  assert.equal(app.elements.whiteNoiseToggle.textContent, '播放');
  assert.match(app.elements.whiteNoiseStatus.textContent, /无法播放/);
  await app.event('Toggle', 'click');
  app.contexts[0].decodes[1].finish();
  await tick();
  assert.equal(app.contexts[0].sources.length, 1);
});

test('pausing while audio resume is pending leaves the context suspended', async () => {
  const app = setup({ deferResume: true });
  await app.event('Toggle', 'click');
  await app.event('Toggle', 'click');
  app.flushTimers();
  app.contexts[0].finishResume();
  await tick();
  assert.equal(app.contexts[0].state, 'suspended');
  assert.equal(app.requests.length, 0);
});

test('pagehide during decode closes the old context and a fresh play stays isolated', async () => {
  const app = setup({ deferDecode: true });
  await app.event('Toggle', 'click');
  const first = app.contexts[0];
  app.lifecycle.pagehide();
  assert.equal(first.state, 'closed');
  await app.event('Toggle', 'click');
  const second = app.contexts[1];
  first.decodes[0].finish();
  await tick();
  assert.equal(second.sources.length, 0);
  second.decodes[0].finish();
  await tick();
  assert.equal(second.sources.length, 1);
  assert.equal(app.elements.whiteNoiseToggle.textContent, '暂停');
});

test('unsupported audio, corrupt settings and retired scenes recover safely', () => {
  const app = setup({ supported: false, saved: '{broken' });
  assert.equal(app.elements.whiteNoiseToggle.disabled, true);
  assert.match(app.elements.whiteNoiseStatus.textContent, /不支持/);
  assert.equal(app.elements.whiteNoiseKind.value, 'rain');
  assert.equal(app.elements.whiteNoiseVolume.value, '25');
  assert.equal(setup({ saved: '{"kind":"train","volume":900}' }).elements.whiteNoiseKind.value, 'rain');
});

test('all packaged recordings match their licensed source manifest and size budget', () => {
  assert.deepEqual(manifest.tracks.map(track => track.id), kinds);
  let total = 0;
  for (const track of manifest.tracks) {
    const bytes = readFileSync(new URL(`../app/assets/audio/${track.file}`, import.meta.url));
    assert.equal(bytes.subarray(0, 4).toString(), 'OggS');
    assert.equal(bytes.length, track.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), track.sha256);
    assert.ok(track.duration_seconds > 20 && track.duration_seconds <= 65);
    assert.ok(track.bytes < 2 * 1024 * 1024);
    assert.ok(track.author && track.original_url.startsWith('https://'));
    assert.ok(['CC BY 4.0', 'CC0 1.0', 'Public Domain'].includes(track.license));
    assert.ok(track.source_url.includes(manifest.upstream_commit));
    assert.ok(track.true_peak_dbtp < -3);
    assert.ok(track.minimum_quarter_second_rms > .001, 'loops must not contain a silent fade');
    total += bytes.length;
  }
  assert.ok(total < 5 * 1024 * 1024, 'ambient audio should stay below 5 MiB');
});
