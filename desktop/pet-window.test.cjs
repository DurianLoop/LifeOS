'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {updatePetWindow} = require('./pet-window.cjs');
const {EventEmitter}=require('node:events');
const path=require('node:path');
const fs=require('node:fs'),vm=require('node:vm');
const {createPetController,normalizeSettings,SETTINGS_KEY}=require('./pet-controller.cjs');
const {loadPetActions}=require('./shared-pet-actions.cjs');

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

function controllerFixture(settings){
  const windows=[],trays=[],items=new Map(),events=[],actionEvents=[],writes=[],fetches=[];
  if(settings)items.set(SETTINGS_KEY,JSON.stringify(settings));
  const store={operation({op,key,value}){if(op==='get')return items.get(key)??null;if(op==='set'){writes.push({key,value});items.set(key,value)}}};
  class Window extends EventEmitter{
    constructor(options){super();this.options=options;this.visible=false;this.dead=false;this.bounds={x:options.x,y:options.y,width:options.width,height:options.height};this.boundsCalls=0;this.positionCalls=0;this.topCalls=0;this.loads=[];this.messages=[];this.webContents=new EventEmitter();this.webContents.setWindowOpenHandler=()=>{};this.webContents.send=(...args)=>this.messages.push(args);windows.push(this)}
    isDestroyed(){return this.dead}isVisible(){return this.visible}showInactive(){this.visible=true}hide(){this.visible=false}setAlwaysOnTop(value){this.top=value;this.topCalls++}setBounds(value){this.bounds={...value};this.boundsCalls++}getBounds(){return {...this.bounds}}getPosition(){return[this.bounds.x,this.bounds.y]}setPosition(x,y){this.bounds.x=x;this.bounds.y=y;this.positionCalls++}async loadFile(...args){this.loads.push(args)}destroy(){this.dead=true;this.visible=false;this.emit('closed')}
  }
  class Tray extends EventEmitter{constructor(){super();trays.push(this)}isDestroyed(){return Boolean(this.dead)}setToolTip(){}setContextMenu(menu){this.menu=menu}destroy(){this.dead=true}}
  const screen=new EventEmitter(),workArea={x:0,y:0,width:1200,height:800};screen.getPrimaryDisplay=screen.getDisplayNearestPoint=()=>({workArea});
  let pet={id:'fixture',name:'Fixture',sprite:path.resolve('fixture/pets/spritesheet.webp'),version:2},manifest={};
  const options={BrowserWindow:Window,Tray,Menu:{buildFromTemplate:template=>({template,popup(){}})},nativeImage:{createFromBitmap:()=>({})},screen,store,resourceRoot:path.resolve(__dirname,'..'),desktopDir:__dirname,base:()=> 'http://127.0.0.1:8878',actions:loadPetActions(path.resolve(__dirname,'..')),onOpen:async()=>{},onQuit(){},onSettings:event=>events.push(event),onAction:event=>actionEvents.push(event),fetchJSON:async url=>{fetches.push(url);return url.endsWith('/api/pets/desktop')?{pet}:manifest}};
  const controller=createPetController(options);
  return {controller,windows,trays,store,items,events,actionEvents,writes,fetches,options,setPet:value=>{pet=value},setManifest:value=>{manifest=value}};
}
test('desktop settings normalize unsafe values and share the shipped action contract',()=>{
  assert.deepEqual(normalizeSettings(null),normalizeSettings());assert.equal(normalizeSettings({scale:100}).scale,1.8);assert.equal(normalizeSettings({mode:'web',keepOnClose:'true'}).mode,'in_app');assert.equal(normalizeSettings({vivi:{dragAction:'unknown'}}).vivi.dragAction,'fly');assert.equal(loadPetActions(path.resolve(__dirname,'..')).length,9);
});
test('desktop mode persists, waits for decoded sprites, and reuses its window for settings and actions',async()=>{
  const f=controllerFixture();await f.controller.start();assert.equal(f.windows.length,0);assert.equal(f.trays.length,0);
  await f.controller.setSettings({mode:'desktop'});const pet=f.windows[0];assert.equal(pet.visible,false);assert.equal(f.controller.keepAlive(),true);f.controller.onReady();assert.equal(pet.visible,true);
  await f.controller.setSettings({scale:1.4,alwaysOnTop:false,motion:false});assert.equal(f.windows.length,1);assert.equal(pet.loads.length,1);assert.equal(pet.bounds.width,269);assert.equal(pet.top,false);assert.equal(f.controller.snapshot().settings.motion,false);
  assert.equal(f.controller.selectAction({slug:'fixture',action:'waving'}).ok,true);assert.equal(f.controller.selectAction({slug:'fixture',action:'unknown'}).ok,false);assert.equal(pet.messages.at(-1)[0],'pet:action');assert.equal(f.actionEvents.at(-1).action,'waving');
  await f.controller.setSettings({visible:false});assert.equal(pet.visible,false);assert.equal(f.controller.keepAlive(),true);await f.controller.setSettings({visible:true});assert.equal(pet.visible,true);
  const saved=JSON.parse(f.items.get(SETTINGS_KEY));assert.equal(saved.scale,1.4);assert.equal(saved.alwaysOnTop,false);f.controller.stop();assert.equal(pet.dead,true);assert.equal(f.trays[0].dead,true);assert.equal(f.controller.keepAlive(),false);
});
test('turning desktop mode off and removing the active pet destroy the native view without corrupting settings',async()=>{
  const f=controllerFixture({mode:'desktop'});await f.controller.start();const pet=f.windows[0];f.controller.onReady();f.setPet(null);await f.controller.refresh();assert.equal(pet.dead,true);assert.equal(f.controller.keepAlive(),true);assert.equal(f.controller.snapshot().status.ready,false);
  await f.controller.setSettings({mode:'in_app'});assert.equal(f.controller.keepAlive(),false);assert.equal(f.trays[0].dead,true);f.controller.stop();
});
test('native drag clamps to screen work area and persists independently from browser position',async()=>{
  const f=controllerFixture({mode:'desktop'});await f.controller.start();f.controller.dragStart({x:100,y:100});f.controller.dragMove({x:-9999,y:9999});f.controller.dragEnd();assert.deepEqual(f.windows[0].getPosition(),[0,592]);assert.equal(JSON.parse(f.items.get('lifeos.desktop.pet.position.v1')).y,592);f.controller.stop();
});
test('ViVi retains its own action names and local GIF assets instead of the nine-row atlas contract',async()=>{
  const f=controllerFixture();f.setPet({id:'vivi',name:'ViVi',renderer:'vivi-gif',sprite:path.resolve('fixture/vivi/sit.gif'),manifest_url:'/assets/pets/vivi/pet.json',actions:[['sit','坐下'],['fly','飞行']]});f.setManifest({actions:[{id:'sit',label:'坐下',asset:'sit.gif'},{id:'fly',label:'飞行',asset:'fly.gif'}]});
  await f.controller.setSettings({mode:'desktop'});const config=JSON.parse(f.windows[0].loads[0][1].query.pet);assert.equal(config.viviActions.length,2);assert.match(config.viviActions[1].asset_url,/^file:/);assert.equal(f.controller.selectAction({slug:'vivi',action:'fly'}).ok,true);assert.equal(f.controller.selectAction({slug:'vivi',action:'waving'}).ok,false);f.controller.stop();
});
test('desktop preferences survive recreation while old looping actions never resume',async()=>{
  const f=controllerFixture();assert.equal(f.controller.selectAction({slug:'vivi--durianloop',action:'fly'}).ok,true);assert.equal(f.controller.selectAction({slug:'vivi--durianloop',action:'waving'}).ok,false);
  f.items.set('lifeos.desktop.pet.actions.v1',JSON.stringify({'vivi--durianloop':'fly',fixture:'review'}));
  await f.controller.setSettings({mode:'desktop',keepOnClose:false,motion:false,vivi:{dragAction:'jump',autoBehavior:false,edgeHide:false}});f.controller.selectAction({slug:'fixture',action:'review'});f.controller.stop();
  const restored=createPetController(f.options);await restored.start();assert.equal(restored.snapshot().settings.keepOnClose,false);assert.equal(restored.snapshot().settings.vivi.dragAction,'jump');assert.deepEqual(restored.snapshot().choices,{});assert.deepEqual(restored.snapshot().commands,{});assert.equal(JSON.parse(f.windows.at(-1).loads[0][1].query.pet).command,null);assert.equal(f.writes.some(row=>row.key==='lifeos.desktop.pet.actions.v1'),false);restored.stop();
});

test('one-shot requests deduplicate tokens, allow same-action replay, and ignore stale completion',async()=>{
  const f=controllerFixture({mode:'desktop'});await f.controller.start();const pet=f.windows[0];
  const first=f.controller.selectAction({slug:'fixture',action:'waving',requestId:'first'});assert.equal(first.active,true);
  const sent=pet.messages.length;assert.equal(f.controller.selectAction({slug:'fixture',action:'waving',requestId:'first'}).duplicate,true);assert.equal(pet.messages.length,sent);
  await f.controller.refresh();assert.equal(pet.messages.at(-1)[1].command.requestId,'first');
  f.controller.selectAction({slug:'fixture',action:'waving',requestId:'second'});assert.equal(f.controller.completeAction({slug:'fixture',requestId:'first'}).ignored,true);assert.equal(f.controller.snapshot().commands.fixture.requestId,'second');assert.equal(f.controller.snapshot().commands.fixture.active,true);
  assert.equal(f.controller.completeAction({slug:'fixture',requestId:'second'}).completed,true);assert.equal(f.controller.snapshot().commands.fixture.active,false);assert.equal(f.actionEvents.at(-1).action,null);assert.equal(f.actionEvents.at(-1).requestId,'second');
  assert.equal(f.controller.selectAction({slug:'fixture',action:'waving',requestId:'second'}).duplicate,true);await f.controller.refresh();assert.equal(pet.messages.at(-1)[1].command,null);
  const next=f.controller.selectAction({slug:'fixture',action:'waving'});assert.notEqual(next.requestId,'second');await f.controller.setSettings({mode:'in_app'});assert.equal(f.controller.snapshot().commands.fixture.active,false);assert.equal(f.writes.some(row=>row.key==='lifeos.desktop.pet.actions.v1'),false);f.controller.stop();
});

test('in-app completion reaches the controller and a mode switch never revives an old command',async()=>{
  const f=controllerFixture(),sent=[];let incomingAction;
  const bridge={petGetSettings:async()=>f.controller.snapshot(),petSetSettings:value=>f.controller.setSettings(value),onPetSettings(){},onPetAction(fn){incomingAction=fn},petAction:async value=>{sent.push({...value});const result=f.controller.selectAction(value);incomingAction?.(result);return result}};
  const window={lifeosDesktop:bridge,addEventListener(){},dispatchEvent(){}};
  const context=vm.createContext({window,document:{body:{},querySelector:()=>null},localStorage:{getItem:()=>null},MutationObserver:class{observe(){}},Event:class{constructor(type){this.type=type}},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail}},setTimeout,clearTimeout});
  for(const name of ['pet-actions.js','pet-settings.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..','app',name),'utf8'),context);
  await new Promise(setImmediate);
  const actions=window.lifeosPetActions,settings=window.lifeosPetSettings;
  actions.select('fixture','waving',{requestId:'finished-in-app'});assert.equal(f.controller.snapshot().commands.fixture.active,true);
  actions.finish('fixture','finished-in-app');assert.equal(f.controller.snapshot().commands.fixture.active,false);assert.equal(sent.at(-1).completed,true);
  await settings.update({mode:'desktop'});assert.equal(JSON.parse(f.windows.at(-1).loads[0][1].query.pet).command,null);
  const native=f.controller.selectAction({slug:'fixture',action:'jumping',requestId:'native-still-playing'});incomingAction(native);const count=sent.length;
  actions.finish('fixture','native-still-playing');assert.equal(sent.length,count,'main preview completion does not finish the desktop companion');assert.equal(f.controller.snapshot().commands.fixture.active,true);
  f.controller.completeAction({slug:'fixture',requestId:'native-still-playing'});assert.equal(f.controller.snapshot().commands.fixture.active,false);
  await settings.update({mode:'in_app'});actions.select('fixture','review',{requestId:'mode-switch-race'});await settings.update({scale:1.17});assert.equal(f.controller.snapshot().commands.fixture.active,true,'in-app size changes do not finish an ongoing command');
  const switching=settings.update({mode:'desktop'});actions.finish('fixture','mode-switch-race');await switching;
  assert.equal(f.controller.snapshot().commands.fixture.active,false);assert.equal(JSON.parse(f.windows.at(-1).loads[0][1].query.pet).command,null,'completion concurrent with a mode change cannot restart the old action');f.controller.stop();
});

test('continuous scale updates avoid catalog fetches, full renderer config and repeated disk writes',async()=>{
  const f=controllerFixture({mode:'desktop'});await f.controller.start();const pet=f.windows[0];f.controller.onReady();
  pet.setPosition(300,250);const fetchCount=f.fetches.length;
  for(let scale=110;scale<=140;scale++)await f.controller.setSettings({scale:scale/100});
  assert.equal(f.fetches.length,fetchCount);assert.equal(pet.loads.length,1);assert.equal(pet.topCalls,0);
  assert.ok(pet.messages.length>0);assert.ok(pet.messages.every(([name])=>name==='pet:settings'));
  assert.deepEqual(pet.getPosition(),[300,250]);assert.equal(pet.bounds.width,269);
  assert.equal(f.writes.filter(row=>row.key===SETTINGS_KEY).length,0);
  await f.controller.setSettings({scale:1.4,commit:true});
  assert.equal(f.writes.filter(row=>row.key===SETTINGS_KEY).length,1);assert.equal(JSON.parse(f.items.get(SETTINGS_KEY)).scale,1.4);
  const messageCount=pet.messages.length,boundsCalls=pet.boundsCalls;await f.controller.setSettings({scale:1.4,commit:true});
  assert.equal(pet.messages.length,messageCount);assert.equal(pet.boundsCalls,boundsCalls);assert.equal(f.writes.filter(row=>row.key===SETTINGS_KEY).length,1);
  await f.controller.setSettings({scale:1.47});f.controller.stop();assert.equal(JSON.parse(f.items.get(SETTINGS_KEY)).scale,1.47);
});
test('interrupted scale gesture persists after inactivity',async()=>{
  const f=controllerFixture();await f.controller.setSettings({scale:1.33});
  assert.equal(f.items.has(SETTINGS_KEY),false);await new Promise(resolve=>setTimeout(resolve,250));
  assert.equal(JSON.parse(f.items.get(SETTINGS_KEY)).scale,1.33);f.controller.stop();
});
test('ViVi uses catalog action data and deduplicates unchanged native coordinates',async()=>{
  const f=controllerFixture({mode:'desktop'});f.setPet({id:'vivi',name:'ViVi',renderer:'vivi-gif',sprite:path.resolve('fixture/vivi/sit.gif'),actions:[['sit','坐下']],viviActions:[{id:'sit',label:'坐下',asset:'sit.gif'}]});
  await f.controller.start();const pet=f.windows[0];assert.equal(f.fetches.length,1);
  f.controller.moveCompanion({x:300.1,y:240.1});for(let i=0;i<100;i++)f.controller.moveCompanion({x:300.2,y:240.2});
  assert.equal(pet.positionCalls,1);assert.deepEqual(pet.getPosition(),[300,240]);
  await f.controller.setSettings({scale:1.25});assert.deepEqual(pet.getPosition(),[300,240]);assert.equal(f.fetches.length,1);
  f.controller.moveCompanion({x:-(240-52),y:240,hiddenEdge:'left'});await f.controller.setSettings({scale:1.4});
  assert.ok(pet.getPosition()[0]<0);assert.ok(pet.getPosition()[0]+pet.bounds.width>=24);
  f.controller.moveCompanion({x:1200-58,y:240,hiddenEdge:'right'});await f.controller.setSettings({scale:1.5});
  assert.ok(pet.getPosition()[0]>1200-pet.bounds.width);assert.ok(pet.getPosition()[0]<=1176);
  f.setPet({id:'atlas',sprite:path.resolve('fixture/pets/spritesheet.webp'),version:2});await f.controller.refresh();
  assert.ok(pet.getPosition()[0]<=1200-pet.bounds.width,'switching away from a hidden pet brings the next pet fully into view');f.controller.stop();
});

function preloadFixture(){
  let bridge,nextFrame=0;const frames=new Map(),messages=[],ipcRenderer=new EventEmitter();
  ipcRenderer.send=(...args)=>messages.push(args);ipcRenderer.invoke=async()=>({ok:true});
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'pet-preload.cjs'),'utf8'),{
    require:()=>({contextBridge:{exposeInMainWorld(_name,value){bridge=value}},ipcRenderer}),
    requestAnimationFrame:callback=>{const id=++nextFrame;frames.set(id,callback);return id},cancelAnimationFrame:id=>frames.delete(id)
  });
  return {bridge,messages,ipcRenderer,frames,frame(){const current=[...frames.values()];frames.clear();for(const callback of current)callback()}};
}
test('preload coalesces same-frame movement and sends the newest drag point before drag end',()=>{
  const f=preloadFixture();for(let x=0;x<100;x++)f.bridge.position({x,y:200});
  assert.equal(f.messages.length,0);assert.equal(f.frames.size,1);f.frame();
  assert.equal(f.messages.length,1);assert.equal(f.messages[0][1].x,99);
  for(let i=0;i<100;i++)f.bridge.position({x:99.1,y:200.2});f.frame();assert.equal(f.messages.length,1);
  f.bridge.dragStart({x:99,y:200});f.bridge.dragMove({x:120,y:210});f.bridge.dragMove({x:150,y:230});f.bridge.dragEnd();
  assert.deepEqual(f.messages.slice(-3).map(row=>row[0]),['lifeos:pet-drag-start','lifeos:pet-drag-move','lifeos:pet-drag-end']);
  assert.equal(f.messages.at(-2)[1].x,150);assert.equal(f.frames.size,0);
});
test('preload drops outdated queued movement when a new pet configuration arrives',()=>{
  const f=preloadFixture();let configs=0;f.bridge.onConfig(()=>configs++);
  f.bridge.position({x:20,y:30});f.ipcRenderer.emit('pet:config',{},{});f.frame();assert.equal(f.messages.length,0);assert.equal(configs,1);
  f.bridge.position({x:20,y:30});f.frame();assert.equal(f.messages.length,1);
});
