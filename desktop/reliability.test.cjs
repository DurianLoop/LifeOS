'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const {EventEmitter}=require('node:events');
const {createStore}=require('./workspace-store.cjs');
const {createUpdateController}=require('./update-controller.cjs');
const {createCloseGuard}=require('./close-guard.cjs');
const temp=t=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'lifeos-state-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root};

function adapter(store,initial={}){
  const legacy={...initial};const native={get length(){return Object.keys(legacy).length},key:i=>Object.keys(legacy)[i],getItem:k=>legacy[k]??null,removeItem:k=>delete legacy[k]};
  const window={localStorage:native,lifeosDesktop:{storage:command=>{try{return {ok:true,value:store.operation(command)}}catch(error){return {ok:false,error:error.message}}}}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../app/workspace-storage.js'),'utf8'),{window});return window.localStorage;
}
test('draft, font and layout survive independent browser origins and process store recreation',t=>{
  const root=temp(t),first=adapter(createStore(root));
  for(const [key,value] of Object.entries({'lifeos.writer.draft.2026-10-06':'{"sections":{"日记":"test"}}','lifeos.writer.cells.v1':'[{"width":420}]','lifeos.pref.font':'serif'}))first.setItem(key,value);
  const second=adapter(createStore(root));assert.equal(second.getItem('lifeos.pref.font'),'serif');assert.equal(second.length,3);assert.match(second.getItem('lifeos.writer.draft.2026-10-06'),/test/);
});
test('legacy imports preserve newer drafts and removed drafts never reappear',t=>{
  const store=createStore(temp(t)),key='lifeos.writer.draft.2026-10-06';
  store.operation({op:'set',key,value:'{"savedAt":"2026-10-06T10:00:00Z"}'});
  adapter(store,{[key]:'{"savedAt":"2026-10-06T09:00:00Z"}'});assert.match(store.operation({op:'get',key}),/10:00/);
  store.operation({op:'remove',key});adapter(store,{[key]:'{"savedAt":"2026-10-06T09:00:00Z"}'});assert.equal(store.operation({op:'get',key}),null);
});
test('failed writes leave old state and reach the caller; corrupted primary recovers previous snapshot',t=>{
  const store=createStore(temp(t));store.operation({op:'set',key:'lifeos.test',value:'old'});
  const rename=fs.renameSync;try{fs.renameSync=()=>{throw Error('ENOSPC')};assert.throws(()=>adapter(store).setItem('lifeos.test','new'),/ENOSPC/)}finally{fs.renameSync=rename}
  assert.equal(store.operation({op:'get',key:'lifeos.test'}),'old');store.operation({op:'set',key:'lifeos.test',value:'new'});fs.writeFileSync(store.file,'broken');assert.equal(createStore(path.dirname(path.dirname(store.file))).operation({op:'get',key:'lifeos.test'}),'old');
});
test('native state rejects foreign keys and oversized values',t=>{const store=createStore(temp(t));assert.throws(()=>store.operation({op:'set',key:'auth-token',value:'x'}));assert.throws(()=>store.operation({op:'set',key:'lifeos.test',value:'x'.repeat(4*1024*1024+1)}))});

function updaterFixture(options={}){
  const updater=new EventEmitter(),events=[],order=[];let finish;
  updater.checkForUpdates=async()=>{updater.emit('update-available',{version:'0.4.3'})};
  updater.downloadUpdate=token=>new Promise((resolve,reject)=>{finish=()=>{if(token.cancelled)reject(Error('cancelled'));else{updater.emit('update-downloaded',{version:'0.4.3'});resolve(['fixture'])}}});
  class Token{cancelled=false;cancel(){this.cancelled=true}}
  const controller=createUpdateController({updater,isPackaged:true,send:s=>events.push(s),CancellationToken:Token,
    lock:async()=>order.push('lock'),unlock:async()=>order.push('unlock'),prepare:async()=>{order.push('save');return true},backup:async()=>order.push('backup'),install:()=>order.push('install'),...options});
  return{controller,updater,events,order,finish:()=>finish()};
}
test('download cancellation can retry and concurrent operations are blocked',async()=>{
  const f=updaterFixture();await f.controller.check();const work=f.controller.download();assert.equal((await f.controller.check()).ok,false);f.controller.cancel();f.finish();assert.equal((await work).cancelled,true);assert.equal(f.controller.snapshot().status,'available');const retry=f.controller.download();f.finish();await retry;assert.equal(f.controller.snapshot().status,'ready');
});
test('installation saves and backs up before quit; checking does not discard a ready installer',async()=>{
  const f=updaterFixture();await f.controller.check();const work=f.controller.download();f.finish();await work;await f.controller.check();assert.equal(f.controller.snapshot().status,'ready');assert.equal((await f.controller.install()).ok,true);assert.deepEqual(f.order,['lock','save','backup','install']);assert.equal(f.updater.autoInstallOnAppQuit,false);
});
test('save failure and safety backup failure leave current application available',async()=>{
  for(const options of [{prepare:async()=>false},{backup:async()=>{throw Error('ENOSPC')}}]){const f=updaterFixture(options);await f.controller.check();const work=f.controller.download();f.finish();await work;assert.equal((await f.controller.install()).ok,false);assert.equal(f.controller.snapshot().status,'ready');assert.ok(!f.order.includes('install'));assert.ok(f.order.includes('unlock'))}
});
test('a rejected download, including digest failure, never becomes installable',async()=>{
  const f=updaterFixture();f.updater.downloadUpdate=async()=>{throw Error('sha512 mismatch')};await f.controller.check();assert.equal((await f.controller.download()).ok,false);assert.equal((await f.controller.install()).ok,false);
});
test('close waits for persisted draft; failed save can return to the editor',async()=>{
  for(const safe of [true,false]){let closed=0,prompted=0,prevented=0;const window={webContents:{executeJavaScript:async()=>safe},close(){closed++}};const guard=createCloseGuard({window,dialog:{showMessageBox:async()=>{prompted++;return{response:0}}}});guard.onClose({preventDefault(){prevented++}});await new Promise(setImmediate);assert.equal(prevented,1);assert.equal(closed,safe?1:0);assert.equal(prompted,safe?0:1)}
});
