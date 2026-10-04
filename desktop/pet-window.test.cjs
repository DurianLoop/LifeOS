'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {updatePetWindow} = require('./pet-window.cjs');

function fakeWindow() {
  const loads = [], messages = [];
  return {loads, messages, isDestroyed: () => false,
    async loadFile(...args) { loads.push(args); },
    webContents: {send(...args) { messages.push(args); }}};
}

test('initial pet survives Electron query encoding including spaces and Unicode', async () => {
  const window = fakeWindow();
  const pet = {id: 'fixture', name: '桌宠', sprite: 'file:///C:/Pet%20Assets/spritesheet.webp'};
  await updatePetWindow(window, pet, 'pet.html');
  const url = new URL('file:///pet.html');
  url.search = new URLSearchParams(window.loads[0][1].query).toString();
  assert.deepEqual(JSON.parse(url.searchParams.get('pet')), pet);
});

test('repeated or concurrent refreshes preserve the already loaded transparent window', async () => {
  const window = fakeWindow(), pet = {sprite: 'file:///first.webp', version: 1};
  await Promise.all(Array.from({length: 4}, () => updatePetWindow(window, pet, 'pet.html')));
  assert.equal(window.loads.length, 1);
  assert.equal(window.messages.length, 0);
  const next = {...pet, sprite: 'file:///second.webp'};
  await updatePetWindow(window, next, 'pet.html');
  assert.equal(window.loads.length, 1);
  assert.deepEqual(window.messages, [['pet:config', next]]);
});

test('a failed initial load can retry without pretending the renderer is ready', async () => {
  const window = fakeWindow();
  window.loadFile = async () => { throw new Error('fixture load failure'); };
  await assert.rejects(updatePetWindow(window, {sprite: 'file:///pet.webp'}, 'pet.html'));
  window.loadFile = async (...args) => window.loads.push(args);
  await updatePetWindow(window, {sprite: 'file:///pet.webp'}, 'pet.html');
  assert.equal(window.loads.length, 1);
  assert.equal(window.messages.length, 0);
});
