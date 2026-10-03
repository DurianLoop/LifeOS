'use strict';

// Keep the transparent window alive when settings refresh. Navigating it again
// discards the decoded atlas and presents an empty compositor frame.
const windows = new WeakMap();
function updatePetWindow(window, pet, pagePath) {
  if (!window || window.isDestroyed()) return Promise.resolve(false);
  let state = windows.get(window);
  if (!state) {
    state = {key: null, loaded: false, pending: Promise.resolve()};
    windows.set(window, state);
  }
  const key = JSON.stringify(pet);
  const update = state.pending.catch(() => {}).then(async () => {
    if (window.isDestroyed() || state.key === key) return false;
    if (state.loaded) window.webContents.send('pet:config', pet);
    else {
      // Electron encodes query values itself. Pre-encoding breaks JSON.parse.
      await window.loadFile(pagePath, {query: {pet: key}});
      state.loaded = true;
    }
    state.key = key;
    return true;
  });
  state.pending = update;
  return update;
}

module.exports = {updatePetWindow};
