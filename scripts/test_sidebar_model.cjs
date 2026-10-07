const test=require('node:test'),assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs'),context={};vm.runInNewContext(fs.readFileSync(require.resolve('../app/sidebar-model.js'),'utf8'),context);const raw=context.lifeosSidebarModel;const model=Object.fromEntries(Object.entries(raw).map(([k,v])=>[k,typeof v==='function'?(...args)=>JSON.parse(JSON.stringify(v(...args))):JSON.parse(JSON.stringify(v))]));
const KEY='lifeos.nav.layout';
test('every feature has exactly one home after an older or malformed layout is normalized',()=>{
  const value=model.normalize({version:1,main:['poetry','poetry','unknown'],attic:['poetry','journal']});
  assert.equal(value.main[0],'poetry');assert.ok(value.attic.includes('journal'));
  assert.deepEqual([...value.main,...value.attic].sort(),[...model.IDS].sort());
});
test('reordering does not alter the input or move other features out of their group',()=>{
  const original=model.defaults(),before=JSON.stringify(original),value=model.move(original,'bottle','main','today');
  assert.equal(JSON.stringify(original),before);assert.equal(value.main[0],'bottle');assert.deepEqual(value.attic,original.attic);
});
test('poetry can move into Attic and back without duplication',()=>{
  const tucked=model.move(model.defaults(),'poetry','attic','overview');
  assert.equal(tucked.main.includes('poetry'),false);assert.equal(tucked.attic[0],'poetry');
  const back=model.move(tucked,'poetry','main','journal');assert.equal(back.attic.includes('poetry'),false);assert.equal(back.main[2],'poetry');
});
test('a deliberately empty sidebar remains empty when reloaded',()=>{
  let value=model.defaults();for(const id of [...value.main])value=model.move(value,id,'attic');
  assert.deepEqual(model.normalize(JSON.parse(JSON.stringify(value))).main,[]);
});
test('keyboard arrows reorder and change groups with stable boundaries',()=>{
  let value=model.keyboard(model.defaults(),'today','ArrowUp');assert.deepEqual(value,model.defaults());
  value=model.keyboard(value,'today','ArrowDown');assert.equal(value.main[1],'today');
  value=model.keyboard(value,'today','ArrowRight');assert.equal(value.main.includes('today'),false);
  value=model.keyboard(value,'today','ArrowLeft');assert.equal(value.main.at(-1),'today');
});
test('self drops and unsupported drag payloads cannot remove features',()=>{
  const value=model.defaults();assert.deepEqual(model.move(value,'poetry','main','poetry'),value);
  assert.deepEqual(model.move(value,'unknown','attic'),value);assert.deepEqual(model.move(value,'poetry','unknown'),value);
});
test('saved layouts survive deserialization while unreadable storage is reported',()=>{
  const value=model.move(model.defaults(),'pet','attic');
  assert.deepEqual(model.read({getItem:()=>JSON.stringify(value)},KEY),{value,error:false});
  assert.equal(model.read({getItem:()=>'{broken'},KEY).error,true);
  assert.equal(model.read({getItem(){throw Error('unavailable');}},KEY).error,true);
  assert.equal(model.read({getItem:()=>null},KEY).error,false);
});
