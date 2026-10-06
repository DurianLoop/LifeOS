import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source=readFileSync(new URL('../app/v012.js',import.meta.url),'utf8');
const install=source.slice(source.indexOf('  function installI2Surface(){'),source.indexOf('  window.lifeosRegisterPetFeature='));

function fixture(){
  const calls=[],classes=new Set(['writerImmersive']),dock={classList:{contains:()=>true}};
  const state={flushDraft:()=>calls.push('draft'),layout:{destroy:()=>calls.push('layout')},
    calendar:{destroy:()=>calls.push('calendar')},renderSequence:7,editing:true,chapterOpen:true};
  const context={I2:state,PRODUCT:{tab:'writer'},RENDERERS:{},saved:{bindSpecific(){}},bindSpecific(){},
    renderProductWriter(){},renderWriterExpanded(){},renderJournalI2(){},renderSearchI2(){},bindI2(){},updateLanguageControl(){},
    render(){},buildRail:()=>calls.push('rail'),$:selector=>selector==='#productDock'?dock:null,
    renderProductTab:async tab=>{calls.push('render:'+tab);return tab},
    document:{body:{classList:{toggle:(name,on)=>on?classes.add(name):classes.delete(name)}}},
    window:{dispatchEvent(){}},Event:class{}};
  vm.createContext(context);vm.runInContext(install+'\ninstallI2Surface();',context);
  return {context,state,calls,classes};
}

test('leaving the writer flushes its draft and restores workflow navigation',async()=>{
  const f=fixture();f.calls.length=0;
  assert.equal(await f.context.renderProductTab('export'),'export');
  assert.deepEqual(f.calls.slice(0,4),['draft','layout','calendar','rail']);
  assert.equal(f.classes.has('writerImmersive'),false);
  assert.equal(f.state.renderSequence,8);assert.equal(f.state.editing,false);
  assert.equal(f.state.layout,null);assert.equal(f.state.calendar,null);
  assert.equal(f.state.flushDraft,null);
  await f.context.renderProductTab('backup');
  assert.equal(f.calls.filter(x=>x==='draft').length,1);
  await f.context.renderProductTab('writer');
  assert.equal(f.classes.has('writerImmersive'),true);
});

test('a failed durable draft write keeps the writer open for recovery',async()=>{
  const f=fixture();f.state.flushDraft=()=>false;f.calls.length=0;
  await f.context.renderProductTab('backup');
  assert.equal(f.context.PRODUCT.tab,'writer');assert.equal(f.classes.has('writerImmersive'),true);
  assert.equal(f.state.renderSequence,7);assert.ok(f.state.layout);assert.deepEqual(f.calls,[]);
});

test('an export failure still leaves the close button and navigation available',async()=>{
  const f=fixture();
  // Install another isolated surface whose underlying tool renderer rejects.
  f.state.installed=false;f.context.renderProductTab=async()=>{throw new Error('offline')};
  vm.runInContext('installI2Surface();',f.context);
  await assert.rejects(f.context.renderProductTab('versions'),/offline/);
  assert.equal(f.classes.has('writerImmersive'),false);
});

test('a late tool render cannot re-enable writer mode after the dock closes',async()=>{
  const f=fixture();let finish;let opened=true;
  f.context.$=()=>({classList:{contains:()=>opened}});
  f.state.installed=false;f.context.renderProductTab=()=>new Promise(resolve=>{finish=resolve});
  vm.runInContext('installI2Surface();',f.context);
  const rendering=f.context.renderProductTab('writer');
  opened=false;finish();await rendering;
  assert.equal(f.classes.has('writerImmersive'),false);
});
