import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const code = readFileSync(new URL('../app/white-noise.js', import.meta.url), 'utf8');

function setup({ supported = true, saved = null, deferResume = false } = {}) {
  const ids = ['Toggle', 'Kind', 'Volume', 'VolumeText', 'Status'];
  const elements = Object.fromEntries(ids.map(name => [`whiteNoise${name}`, {
    value: '', textContent: '', disabled: false, handlers: {}, attributes: {},
    addEventListener(name, handler) { this.handlers[name] = handler; },
    setAttribute(name, value) { this.attributes[name] = value; },
  }]));
  const contexts = [];
  const lifecycle = {};
  const timers = new Map();
  let timerId = 0;
  let stored = saved;
  class AudioParam {
    value = 0;
    events = [];
    cancelScheduledValues(time) { this.events = this.events.filter(event => event.time < time); }
    setValueAtTime(value, time) { this.value = value; this.events.push({ type: 'set', value, time }); }
    linearRampToValueAtTime(value, time) { this.events.push({ type: 'ramp', value, time }); }
    setTargetAtTime(value, time) { this.events.push({ type: 'target', value, time }); }
  }
  class AudioNode {
    connected = false;
    connect() { this.connected = true; }
    disconnect() { this.connected = false; }
  }
  class AudioContext {
    currentTime = 0;
    sampleRate = 8000;
    state = 'suspended';
    sources = [];
    gains = [];
    constructor() { contexts.push(this); }
    async resume() {
      if (deferResume) await new Promise(resolve => { this.finishResume = resolve; });
      if (this.state !== 'closed') this.state = 'running';
    }
    async suspend() { this.state = 'suspended'; }
    async close() { this.state = 'closed'; }
    createGain() { const node = new AudioNode(); node.gain = new AudioParam(); this.gains.push(node); return node; }
    createBuffer(channels, length, sampleRate) {
      const arrays = Array.from({ length: channels }, () => new Float32Array(length));
      return { sampleRate, length, getChannelData(channel) { return arrays[channel]; } };
    }
    createBufferSource() {
      const node = new AudioNode();
      node.start = () => { node.started = true; };
      node.stop = () => { node.stopped = true; node.onended?.(); };
      this.sources.push(node);
      return node;
    }
  }
  const sandbox = {
    document: { getElementById(id) { return elements[id]; } },
    window: {
      AudioContext: supported ? AudioContext : undefined,
      addEventListener(name, handler) { lifecycle[name] = handler; },
    },
    localStorage: { getItem() { return stored; }, setItem(_key, value) { stored = value; } },
    setTimeout(callback) { timers.set(++timerId, callback); return timerId; },
    clearTimeout(id) { timers.delete(id); },
    // A request here would break the promise that the sounds work offline.
    fetch() { assert.fail('White noise must not require a network request'); },
  };
  vm.runInNewContext(code, sandbox, { filename: 'white-noise.js' });
  return {
    elements, contexts, lifecycle,
    stored: () => JSON.parse(stored),
    async event(name, type, value) {
      const element = elements[`whiteNoise${name}`];
      if (value !== undefined) element.value = value;
      element.handlers[type]();
      await new Promise(resolve => setImmediate(resolve));
    },
    flushTimers() { for (const callback of timers.values()) callback(); timers.clear(); },
  };
}

test('sounds remain paused on load, play offline, and suspend after pausing', async () => {
  const app = setup();
  assert.equal(app.contexts.length, 0);
  assert.equal(app.elements.whiteNoiseToggle.attributes['aria-pressed'], 'false');
  await app.event('Toggle', 'click');
  const context = app.contexts[0];
  assert.equal(context.sources[0].loop, true);
  assert.equal(context.sources[0].started, true);
  assert.equal(app.elements.whiteNoiseToggle.textContent, '暂停');
  await app.event('Toggle', 'click');
  app.flushTimers();
  assert.equal(context.state, 'suspended');
  assert.equal(app.elements.whiteNoiseToggle.attributes['aria-pressed'], 'false');
  await app.event('Toggle', 'click');
  assert.equal(context.state, 'running');
  assert.equal(context.sources.length, 1);
});

test('all ten scenes produce bounded audio and switching releases the old graph', async () => {
  const app = setup();
  await app.event('Toggle', 'click');
  const context = app.contexts[0];
  for (const kind of ['rain', 'fire', 'city', 'country', 'ocean', 'forest', 'stream', 'storm', 'train', 'night']) {
    const previous = context.sources.at(-1);
    await app.event('Kind', 'change', kind);
    assert.equal(previous.stopped, true);
    assert.equal(previous.connected, false);
    assert.equal(context.gains.at(-2).connected, false);
    const current = context.sources.at(-1);
    assert.equal(current.connected, true);
    for (let channel = 0; channel < 2; channel += 1) {
      const samples = current.buffer.getChannelData(channel);
      assert.equal(Math.abs(samples[0]), 0);
      assert.equal(Math.abs(samples.at(-1)), 0);
      let energy = 0;
      for (const sample of samples) {
        assert.ok(Number.isFinite(sample) && Math.abs(sample) <= 0.901);
        energy += sample * sample;
      }
      assert.ok(energy > 1, `${kind} must contain audible audio`);
    }
  }
});

test('volume changes replace a pending fade and persist without auto-playing', async () => {
  const app = setup();
  await app.event('Toggle', 'click');
  await app.event('Volume', 'input', '0');
  const events = app.contexts[0].gains[0].gain.events;
  assert.equal(events.some(event => event.type === 'ramp'), false);
  assert.equal(events.at(-1).value, 0);
  await app.event('Kind', 'change', 'ocean');
  await app.event('Volume', 'input', '42');
  const restored = setup({ saved: JSON.stringify(app.stored()) });
  assert.equal(restored.elements.whiteNoiseKind.value, 'ocean');
  assert.equal(restored.elements.whiteNoiseVolume.value, '42');
  assert.equal(restored.contexts.length, 0);
});

test('leaving during audio resume cancels playback and permits a fresh play', async () => {
  const app = setup({ deferResume: true });
  await app.event('Toggle', 'click');
  const first = app.contexts[0];
  app.lifecycle.pagehide();
  assert.equal(first.state, 'closed');
  assert.equal(app.elements.whiteNoiseToggle.disabled, false);
  await app.event('Toggle', 'click');
  const second = app.contexts[1];
  first.finishResume();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(second.sources.length, 0);
  assert.equal(app.elements.whiteNoiseToggle.disabled, true);
  second.finishResume();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(second.sources.length, 1);
  assert.equal(app.elements.whiteNoiseToggle.textContent, '暂停');
});

test('unsupported audio and corrupt preferences have usable feedback', () => {
  const app = setup({ supported: false, saved: '{broken' });
  assert.equal(app.elements.whiteNoiseToggle.disabled, true);
  assert.match(app.elements.whiteNoiseStatus.textContent, /不支持/);
  assert.equal(app.elements.whiteNoiseKind.value, 'rain');
  assert.equal(app.elements.whiteNoiseVolume.value, '25');
});
