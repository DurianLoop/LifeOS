import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const code = readFileSync(new URL('../app/poetry.js', import.meta.url), 'utf8');

function setup() {
  const events = {};
  const timers = [];
  const panel = { hidden: true };
  const why = { attributes: {}, setAttribute(name, value) { this.attributes[name] = value; } };
  const context = {
    FEATURES: [], ROOMS: { NOW: { features: [] } }, FRONT_FEATURES: new Set(), DREAM_META: {},
    STATE: { feature: 'Daily Poetry' }, RENDERERS: {},
    render() {}, bindSpecific() {},
    document: {
      querySelectorAll() { return []; },
      querySelector(selector) { return { '#poetryWhy': why, '#poetryReason': panel }[selector]; },
    },
    window: { addEventListener(name, handler) { events[name] = handler; } },
    setTimeout(callback) { timers.push(callback); },
  };
  vm.runInNewContext(code, context, { filename: 'poetry.js' });
  return { context, events, timers, why, panel };
}

for (const slowStartup of [false, true]) {
  test(`poetry controls bind after ${slowStartup ? 'delayed' : 'normal'} shell startup`, () => {
    const app = setup();
    if (slowStartup) app.timers[0]();
    // v012's copydeck boot replaces this global hook when its request finishes.
    let shellCalls = 0;
    app.context.bindSpecific = () => { shellCalls += 1; };
    app.events['lifeos:i2-ready']();
    if (!slowStartup) app.timers[0]();
    app.context.bindSpecific();
    assert.equal(shellCalls, 1);
    assert.equal(typeof app.why.onclick, 'function');
    app.why.onclick();
    assert.equal(app.panel.hidden, false);
    assert.equal(app.why.attributes['aria-expanded'], 'true');
    app.why.onclick();
    assert.equal(app.panel.hidden, true);
    assert.equal(app.why.attributes['aria-expanded'], 'false');
  });
}
