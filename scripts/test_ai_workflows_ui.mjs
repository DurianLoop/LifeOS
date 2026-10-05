import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source=readFileSync(new URL('../app/index.html',import.meta.url),'utf8');
const code=source.slice(source.indexOf('function askControls('),source.indexOf('/* ===== Core IX',source.indexOf('function askControls(')));

function fixture(){
  const nodes={},calls=[],toasts=[],rows={ask:[],past:[]};
  const node=()=>({value:'产品',disabled:false,dataset:{},style:{},innerHTML:'',
    querySelectorAll:()=>[],insertAdjacentHTML(where,html){this.innerHTML=html+this.innerHTML}});
  for(const name of ['askInput','askRun','askInterpret','askAnswer','pastQ','pastRun','pastInterpret','pastOut','pastCutoff'])nodes['#'+name]=node();
  nodes['#pastCutoff'].value='2024-12-31';
  const pack={evidence_token:'reviewed-token',evidence:[{evidence_id:'E1'}],count:1,payload_preview_enabled:true,answer:{mode:'grounded_llm',text:'线索[E1]',citation_status:'verified'}};
  rows.ask=[{checked:true,dataset:{evkey:'a||日记',evchars:10}}];rows.past=[{checked:true,dataset:{evkey:'p||日记',evchars:10}}];
  let reply=()=>structuredClone(pack);
  const context={STATE:{askPack:pack,askRequest:{question:'产品',cutoff:null,limit:12},pastPack:pack,pastRequest:{question:'产品',cutoff:'2024-12-31',limit:12}},
    $:s=>nodes[s]||null,$$:s=>s.includes('.askEvidenceCheck')?rows[s.startsWith('#past')?'past':'ask']:[],
    post:async(path,body)=>{calls.push(body);return reply(body)},toast:s=>toasts.push(s),
    saveAskHistory(){},bindCommon(){},fmt:String,esc:String,answerWithEvidenceLinks:String,
    evidenceHtml:d=>{context.renderedEvidence=d.evidence;return 'evidence'}};
  vm.createContext(context);vm.runInContext(code,context);
  return{context,nodes,calls,rows,toasts,pack,setReply(fn){reply=fn}};
}

test('retrieval transport failure restores controls and clears the stale pack',async()=>{
  const f=fixture();f.setReply(()=>{throw Error('offline')});
  await f.context.retrieveAskEvidence();
  assert.equal(f.nodes['#askRun'].disabled,false);
  assert.equal(f.nodes['#askInterpret'].style.display,'none');
  assert.equal(f.context.STATE.askPack,null);assert.match(f.nodes['#askAnswer'].innerHTML,/offline/);
});

test('interpretation failure restores both buttons and allows a real retry',async()=>{
  const f=fixture();f.setReply(()=>{throw Error('offline')});
  await f.context.interpretAskEvidence();
  assert.equal(f.nodes['#askRun'].disabled,false);assert.equal(f.nodes['#askInterpret'].disabled,false);
  assert.equal(f.nodes['#askInterpret'].dataset.busy,'false');
  f.setReply(()=>f.pack);await f.context.interpretAskEvidence();
  assert.equal(f.calls.length,2);assert.equal(f.calls[1].evidence_token,'reviewed-token');
});

test('changed question retrieves fresh evidence instead of silently sending a new question',async()=>{
  const f=fixture();f.nodes['#askInput'].value='新问题';
  await f.context.interpretAskEvidence();
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].stage,'retrieve');
  assert.equal(f.context.STATE.askRequest.question,'新问题');
});

test('Past Me shares the review flow while retaining its cutoff and independent selection',async()=>{
  const f=fixture();await f.context.retrieveAskEvidence('past');await f.context.interpretAskEvidence(true,'past');
  assert.deepEqual(f.calls.map(x=>[x.stage,x.cutoff]),[['retrieve','2024-12-31'],['answer','2024-12-31']]);
  assert.deepEqual(Array.from(f.calls[1].selected_keys),['p||日记']);
});

test('zero selected evidence never sends a model request',async()=>{
  const f=fixture();f.rows.ask[0].checked=false;
  await f.context.interpretAskEvidence(true);assert.equal(f.calls.length,0);
  f.context.syncAskSelection();assert.equal(f.nodes['#askInterpret'].disabled,true);
});

test('double interpretation click sends once and displays the same IDs as the returned citations',async()=>{
  const f=fixture();let complete;f.setReply(()=>new Promise(resolve=>{complete=resolve}));
  const pending=f.context.interpretAskEvidence(true);await f.context.interpretAskEvidence(true);
  assert.equal(f.calls.length,1);
  complete({...f.pack,evidence:[{evidence_id:'E1',source_path:'selected-second-source'}]});await pending;
  assert.equal(f.context.renderedEvidence[0].source_path,'selected-second-source');
});

test('freshness banner requires an actual stale AI artifact',async()=>{
  const code=source.split('\n').find(x=>x.startsWith('async function decorateFeatureFreshness('));
  const head={insertAdjacentElement:()=>{count++}},artifacts=[];let count=0;
  const context={RENDER_EPOCH:1,STATE:{feature:'文言化'},$:()=>head,
    api:async()=>({items:[{feature_id:'文言化',status:'stale'}],artifact:{artifacts}}),
    document:{createElement:()=>({dataset:{}})}};
  vm.createContext(context);vm.runInContext(code,context);
  await context.decorateFeatureFreshness(1,'文言化');assert.equal(count,0);
  artifacts.push({status:'stale'});await context.decorateFeatureFreshness(1,'文言化');assert.equal(count,1);
});
