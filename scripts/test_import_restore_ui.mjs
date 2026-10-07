import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source=readFileSync(new URL('../app/index.html',import.meta.url),'utf8');
const helper=source.slice(source.indexOf('function showRestoreRestart('),source.indexOf('async function renderProductImport(){'));
const renderLine=source.split('\n').find(line=>line.startsWith('renderProductImport=async function(){'));
const flush=async()=>{await new Promise(setImmediate);await new Promise(setImmediate)};
function fixture({status='committed',desktop=true,restartResult={ok:true},response={ok:true,restart_required:true},draftSafe=true}={}){
  const nodes=Object.fromEntries(['productPanel','importPreview','importCommit','importClear','importRollback','restoreRestart','restoreRestartFeedback'].map(id=>[id,{id,disabled:false,innerHTML:'',textContent:''}]));
  const calls=[],messages=[];
  let renders=0,restarts=0;
  const context={PRODUCT:{importJob:{job_id:'import_fixture',status},importFiles:['synthetic']},esc:value=>String(value),productIntro:()=>'',importJobHtml:()=>'',readImportFiles:async()=>[],
    enhanceImportInteraction(){renders++},refreshProductDockStatus(){},lifeEvent:(...values)=>calls.push({event:values}),dreamBubble(){},
    $:selector=>{const id=selector.slice(1);if(id==='restoreRestart'&&!nodes.productPanel.innerHTML.includes('id="restoreRestart"'))return null;return nodes[id]},
    $$:()=>[],confirm:()=>true,toast:value=>messages.push(value),api:async()=>({}),
    post:async(url,payload)=>{calls.push({url,payload});return response},
    window:{lifeosPrepareToClose:async()=>draftSafe,...(desktop?{lifeosDesktop:{restart:async()=>{restarts++;return restartResult}}}:{})},
  };
  vm.createContext(context);vm.runInContext(helper+'\n'+renderLine,context);
  return {context,nodes,calls,messages,get renders(){return renders},get restarts(){return restarts},
    async render(){await context.renderProductImport()},async click(id){await nodes[id].onclick();await flush()}};
}

test('committed clear waits for restart and the actual restart control invokes the desktop bridge',async()=>{
  const app=fixture();await app.render();await app.click('importClear');
  assert.equal(app.calls.find(row=>row.url)?.url,'/api/import/clear');
  assert.match(app.nodes.productPanel.innerHTML,/重启后完成恢复/);assert.match(app.nodes.productPanel.innerHTML,/重启并完成/);
  assert.equal(app.renders,1,'the original import UI is not rendered as if recovery had already completed');
  assert.equal(app.context.PRODUCT.importJob,null);assert.equal(app.restarts,0);
  await app.click('restoreRestart');assert.equal(app.restarts,1);assert.equal(app.nodes.restoreRestart.disabled,true);
  assert.doesNotMatch(app.messages.join(' '),/已恢复并清除/);
});

test('rollback reports pending recovery and retains a cancellable restart when draft saving fails',async()=>{
  const app=fixture({restartResult:{ok:false,error:'草稿尚未保存，请保存后重试'}});await app.render();await app.click('importRollback');
  assert.equal(app.calls.find(row=>row.url)?.url,'/api/import/rollback');
  assert.match(app.nodes.productPanel.innerHTML,/导入前快照已准备/);
  await app.click('restoreRestart');assert.equal(app.nodes.restoreRestart.disabled,false);
  assert.match(app.nodes.restoreRestartFeedback.textContent,/草稿尚未保存/);
});

test('browser recovery has a real service restart instruction and no fictitious desktop button',async()=>{
  const app=fixture({desktop:false});await app.render();await app.click('importClear');
  assert.match(app.nodes.productPanel.innerHTML,/请关闭并重新启动本机服务/);
  assert.doesNotMatch(app.nodes.productPanel.innerHTML,/id="restoreRestart"/);
  assert.equal(app.restarts,0);
});

test('preview-only clearing remains immediate and reopens an empty import view',async()=>{
  const app=fixture({status:'preview',response:{ok:true,restored:false}});await app.render();await app.click('importClear');
  assert.equal(app.renders,2);assert.equal(app.context.PRODUCT.importJob,null);
  assert.equal(app.messages.at(-1),'已清除这次导入');assert.doesNotMatch(app.nodes.productPanel.innerHTML,/重启并完成/);
});

test('failed durable draft preparation prevents both destructive restore requests',async()=>{
  for(const action of ['importClear','importRollback']){
    const app=fixture({draftSafe:false});await app.render();await app.click(action);
    assert.equal(app.calls.filter(row=>row.url).length,0);assert.equal(app.context.PRODUCT.importJob.job_id,'import_fixture');
    assert.equal(app.messages.at(-1),'草稿尚未保存');assert.equal(app.restarts,0);
  }
});
