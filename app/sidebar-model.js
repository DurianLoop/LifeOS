/* Persist stable IDs, so labels and future releases can change independently. */
((root, factory) => {
  const model = factory();
  if (typeof module === 'object' && module.exports) module.exports = model;
  else root.lifeosSidebarModel = model;
})(typeof window === 'object' ? window : globalThis, () => {
  'use strict';
  const DEFAULT_MAIN = ['today','write','journal','search','poetry','memory','bottle','pet'];
  const DEFAULT_ATTIC = ['overview','review','organize','observe'];
  const IDS = [...DEFAULT_MAIN, ...DEFAULT_ATTIC];
  const defaults = () => ({version:1, main:[...DEFAULT_MAIN], attic:[...DEFAULT_ATTIC]});
  function normalize(value) {
    if (!value || value.version !== 1 || !Array.isArray(value.main) || !Array.isArray(value.attic)) return defaults();
    const seen = new Set(), result = {version:1, main:[], attic:[]};
    for (const zone of ['main','attic']) for (const id of value[zone]) {
      if (IDS.includes(id) && !seen.has(id)) { result[zone].push(id); seen.add(id); }
    }
    // Newly added features inherit their default home; existing choices stay intact.
    for (const zone of ['main','attic']) for (const id of zone === 'main' ? DEFAULT_MAIN : DEFAULT_ATTIC) {
      if (!seen.has(id)) result[zone].push(id);
    }
    return result;
  }
  function move(value, id, zone, before = null) {
    const next = normalize(value);
    if (!IDS.includes(id) || !['main','attic'].includes(zone) || before === id) return next;
    for (const list of [next.main,next.attic]) { const index = list.indexOf(id); if (index >= 0) list.splice(index,1); }
    const index = next[zone].indexOf(before);
    next[zone].splice(index < 0 ? next[zone].length : index,0,id);
    return next;
  }
  function keyboard(value, id, key) {
    const next = normalize(value), zone = next.main.includes(id) ? 'main' : 'attic', list = next[zone], index = list.indexOf(id);
    if (index < 0) return next;
    if (key === 'ArrowLeft') return move(next,id,'main');
    if (key === 'ArrowRight') return move(next,id,'attic');
    if (key === 'ArrowUp' && index > 0) return move(next,id,zone,list[index-1]);
    if (key === 'ArrowDown' && index < list.length-1) return move(next,id,zone,list[index+2] || null);
    return next;
  }
  function read(storage, key) {
    try {
      const raw = storage.getItem(key);
      if (raw === null) return {value:defaults(), error:false};
      const value = JSON.parse(raw);
      if (value?.version !== 1 || !Array.isArray(value.main) || !Array.isArray(value.attic)) throw new Error();
      return {value:normalize(value), error:false};
    } catch { return {value:defaults(), error:true}; }
  }
  return {IDS, defaults, normalize, move, keyboard, read};
});
