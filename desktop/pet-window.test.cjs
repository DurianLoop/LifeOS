'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {updatePetWindow} = require('./pet-window.cjs');
const {EventEmitter}=require('node:events');
const path=require('node:path');
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
  const windows=[],trays=[],items=new Map(),events=[],actionEvents=[];
  if(settings)items.set(SETTINGS_KEY,JSON.stringify(settings));
  const store={operation({op,key,value}){if(op==='get')return items.get(key)??null;if(op==='set')items.set(key,value)}};
  class Window extends EventEmitter{
    constructor(options){super();this.options=options;this.visible=false;this.dead=false;this.bounds={x:options.x,y:options.y,width:options.width,height:options.height};this.loads=[];this.messages=[];this.webContents=new EventEmitter();this.webContents.setWindowOpenHandler=()=>{};this.webContents.send=(...args)=>this.messages.push(args);windows.push(this)}
    isDestroyed(){return this.dead}isVisible(){return this.visible}showInactive(){this.visible=true}hide(){this.visible=false}setAlwaysOnTop(value){this.top=value}setBounds(value){this.bounds={...value}}getPosition(){return[this.bounds.x,this.bounds.y]}setPosition(x,y){this.bounds.x=x;this.bounds.y=y}async loadFile(...args){this.loads.push(args)}destroy(){this.dead=true;this.visible=false;this.emit('closed')}
  }
  class Tray extends EventEmitter{constructor(){super();trays.push(this)}isDestroyed(){return Boolean(this.dead)}setToolTip(){}setContextMenu(menu){this.menu=menu}destroy(){this.dead=true}}
  const screen=new EventEmitter(),workArea={x:0,y:0,width:1200,height:800};screen.getPrimaryDisplay=screen.getDisplayNearestPoint=()=>({workArea});
  let pet={id:'fixture',name:'Fixture',sprite:path.resolve('fixture/pets/spritesheet.webp'),version:2},manifest={};
  const options={BrowserWindow:Window,Tray,Menu:{buildFromTemplate:template=>({template,popup(){}})},nativeImage:{createFromBitmap:()=>({})},screen,store,resourceRoot:path.resolve(__dirname,'..'),desktopDir:__dirname,base:()=> 'http://127.0.0.1:8878',actions:loadPetActions(path.resolve(__dirname,'..')),onOpen:async()=>{},onQuit(){},onSettings:event=>events.push(event),onAction:event=>actionEvents.push(event),fetchJSON:async url=>url.endsWith('/api/pets/desktop')?{pet}:manifest};
  const controller=createPetController(options);
  return {controller,windows,trays,store,items,events,actionEvents,options,setPet:value=>{pet=value},setManifest:value=>{manifest=value}};
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
test('inactive ViVi actions and desktop preferences survive controller recreation in the workspace store',async()=>{
  const f=controllerFixture();assert.equal(f.controller.selectAction({slug:'vivi--durianloop',action:'fly'}).ok,true);assert.equal(f.controller.selectAction({slug:'vivi--durianloop',action:'waving'}).ok,false);
  await f.controller.setSettings({mode:'desktop',keepOnClose:false,motion:false,vivi:{dragAction:'jump',autoBehavior:false,edgeHide:false}});f.controller.selectAction({slug:'fixture',action:'review'});f.controller.stop();
  const restored=createPetController(f.options);await restored.start();assert.equal(restored.snapshot().settings.keepOnClose,false);assert.equal(restored.snapshot().settings.vivi.dragAction,'jump');assert.equal(restored.snapshot().choices['vivi--durianloop'],'fly');assert.equal(JSON.parse(f.windows.at(-1).loads[0][1].query.pet).action,'review');restored.stop();
});
