import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const settingsCode=readFileSync(new URL('../app/pet-settings.js',import.meta.url),'utf8');
const floatCode=readFileSync(new URL('../app/v012-pet-float.js',import.meta.url),'utf8');
const renderersCode=readFileSync(new URL('../app/pet-renderers.js',import.meta.url),'utf8');
const actionsCode=readFileSync(new URL('../app/pet-actions.js',import.meta.url),'utf8');
const defaults={mode:'in_app',keepOnClose:true,alwaysOnTop:true,scale:1,visible:true,motion:true,
  vivi:{dragAction:'fly',autoBehavior:true,edgeHide:true}};
const clone=value=>JSON.parse(JSON.stringify(value));
const merge=(base,patch)=>({...base,...patch,vivi:{...base.vivi,...patch.vivi}});
const settle=()=>new Promise(setImmediate);
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}

function scheduler(){
  let sequence=0;const timers=new Map(),frames=new Map();
  return {
    setTimeout(fn,ms){timers.set(++sequence,{fn,ms});return sequence;},clearTimeout(id){timers.delete(id);},
    requestAnimationFrame(fn){frames.set(++sequence,fn);return sequence;},cancelAnimationFrame(id){frames.delete(id);},
    runTimer(ms){const pair=[...timers].find(([,task])=>task.ms===ms);assert.ok(pair,`scheduled timer ${ms}`);timers.delete(pair[0]);pair[1].fn();},
    flushFrames(){for(const [id,fn] of [...frames]){frames.delete(id);fn();}},timers,frames
  };
}

function node(){
  const events={},attributes=new Map();
  return {dataset:{},attributes,style:{setProperty(key,value){this[key]=value;},removeProperty(key){delete this[key];}},
    type:'',value:'',checked:false,hidden:false,disabled:false,textContent:'',children:[],
    classList:{add(){},remove(){},toggle(){}},setAttribute(name,value){attributes.set(name,value);},
    addEventListener(name,fn){(events[name]??=[]).push(fn);},fire(name,event={}){for(const fn of events[name]||[])fn(event);},
    append(child){this.children.push(child);},remove(){},querySelector(){return null;},querySelectorAll(){return[];},
    closest(selector){if(selector==='[data-pet-setting]'&&this.dataset.petSetting)return this;if(selector==='[data-vivi-setting]'&&this.dataset.viviSetting)return this;return null;}
  };
}

function fixture({native=true,delayRead=false}={}){
  const clock=scheduler(),nodes=new Map(),events={},broadcasts=[],storage=new Map(),writes=[],calls=[],read=deferred();
  let server=clone(defaults),incoming;
  const inputs=new Map(),specials=new Map(),page=node(),header=node();
  page.querySelector=selector=>selector==='.petPageHero'?header:null;
  nodes.set('.petPage',page);
  header.insertAdjacentHTML=(_where,html)=>{
    for(const match of html.matchAll(/\bid="([^"]+)"/g))if(!nodes.has('#'+match[1]))nodes.set('#'+match[1],node());
    for(const match of html.matchAll(/<(input|select)\b([^>]*data-(pet|vivi)-setting="([^"]+)"[^>]*)>/g)){
      const control=node(),attributes=match[2];control.type=attributes.match(/\btype="([^"]+)"/)?.[1]||'select';
      control.dataset[match[3]==='pet'?'petSetting':'viviSetting']=match[4];
      if(attributes.includes('data-native="true"'))control.dataset.native='true';
      control.setAttribute('min',attributes.match(/\bmin="([^"]+)"/)?.[1]);
      control.setAttribute('max',attributes.match(/\bmax="([^"]+)"/)?.[1]);
      control.setAttribute('step',attributes.match(/\bstep="([^"]+)"/)?.[1]);
      (match[3]==='pet'?inputs:specials).set(match[4],control);
    }
    if(nodes.has('#petSettingsPanel')){
      nodes.get('#petSettingsPanel').querySelectorAll=selector=>selector==='[data-pet-setting]'?[...inputs.values()]:[];
      nodes.get('#petSettingsPanel').querySelector=selector=>selector==='[data-pet-setting="scale"]'?inputs.get('scale'):null;
      nodes.get('#petExtraSettings').querySelectorAll=selector=>selector==='[data-vivi-setting]'?[...specials.values()]:[];
    }
  };
  const bridge={
    petGetSettings:()=>delayRead?read.promise:Promise.resolve({ok:true,settings:clone(server),choices:{}}),
    petSetSettings:patch=>{const task=deferred();calls.push({patch:clone(patch),...task});return task.promise;},
    onPetSettings(fn){incoming=fn;},petRefresh:async()=>({ok:true})
  };
  const window={...(native?{lifeosDesktop:bridge}:{}),
    addEventListener(name,fn){(events[name]??=[]).push(fn);},
    dispatchEvent(event){if(event.type==='lifeos:pet-settings')broadcasts.push(clone(event.detail));for(const fn of events[event.type]||[])fn(event);}}
  const context={window,...clock,document:{body:{},querySelector:selector=>nodes.get(selector)??null},
    localStorage:{getItem:key=>storage.get(key)??null,setItem(key,value){storage.set(key,value);writes.push([key,value]);}},
    MutationObserver:class{observe(){}},Event:class{constructor(type){this.type=type;}},
    CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}},uiIcon:()=>''};
  vm.createContext(context);vm.runInContext(settingsCode,context);
  const panel=nodes.get('#petSettingsPanel');
  function inputScale(value){inputs.get('scale').value=String(value);panel.oninput({target:inputs.get('scale')});}
  function commitScale(){panel.onchange({target:inputs.get('scale')});}
  function change(name,value){const input=inputs.get(name);if(input.type==='checkbox')input.checked=value;else input.value=value;panel.onchange({target:input});}
  function accept(index){const call=calls[index];assert.ok(call,`native write ${index} exists`);const {commit,...patch}=call.patch;
    server=merge(server,patch);call.resolve({ok:true,settings:clone(server),choices:{}});}
  function push(settings){assert.ok(incoming);incoming({ok:true,settings:merge(defaults,settings),choices:{}});}
  function resolveRead(settings=defaults){read.resolve({ok:true,settings:clone(settings),choices:{}});}
  return {window,clock,nodes,inputs,panel,calls,broadcasts,storage,writes,inputScale,commitScale,change,accept,push,resolveRead,
    get:()=>clone(window.lifeosPetSettings.get()),get server(){return clone(server);}};
}

test('rapid continuous scale previews remain current while native writes are slow and final commit is saved once',async()=>{
  const app=fixture();await settle();
  assert.equal(app.inputs.get('scale').attributes.get('step'),'0.01');
  app.inputScale(1.13);app.clock.flushFrames();
  assert.equal(app.get().scale,1.13);assert.equal(app.calls.length,0,'preview does not flood IPC each input');
  app.clock.runTimer(60);await settle();assert.equal(app.calls.length,1);assert.equal(app.calls[0].patch.scale,1.13);
  app.inputScale(.97);app.window.dispatchEvent({type:'lifeos:pet-motion',detail:{enabled:false}});app.change('visible',false);app.inputScale(1.37);app.clock.flushFrames();
  app.push({scale:1.13,motion:true,visible:true});
  assert.equal(app.get().scale,1.37);assert.equal(app.get().motion,false);assert.equal(app.get().visible,false);
  app.commitScale();assert.equal(app.calls.length,1,'later changes queue behind the only native request');
  app.accept(0);await settle();
  assert.equal(app.calls.length,2);assert.equal(app.calls[1].patch.scale,1.37);assert.equal(app.calls[1].patch.commit,true);
  assert.equal(app.calls[1].patch.motion,false);assert.equal(app.calls[1].patch.visible,false);
  assert.equal(app.get().scale,1.37,'older success does not move the slider backwards');
  app.accept(1);await settle();
  assert.equal(app.server.scale,1.37);assert.equal(app.get().scale,1.37);assert.equal(app.calls.length,2);
  assert.equal(app.get().commit,undefined);assert.equal(app.nodes.get('#petScaleValue').textContent,'137%');
  assert.equal(app.inputs.get('scale').attributes.get('aria-valuetext'),'137%');
});

test('pending changes to nested ViVi options survive incoming native snapshots and preserve their siblings',async()=>{
  const app=fixture();await settle();
  const first=app.window.lifeosPetSettings.update({vivi:{dragAction:'jump'}});await settle();
  app.window.lifeosPetSettings.update({vivi:{edgeHide:false}});
  app.window.lifeosPetSettings.update({vivi:{autoBehavior:false}});
  app.push({vivi:{dragAction:'fly',autoBehavior:true,edgeHide:true}});
  assert.deepEqual(app.get().vivi,{dragAction:'jump',autoBehavior:false,edgeHide:false});
  app.accept(0);await settle();assert.equal(app.calls.length,2);
  app.accept(1);await first;
  assert.deepEqual(app.server.vivi,{dragAction:'jump',autoBehavior:false,edgeHide:false});
});

test('a native failure rolls back the failed value, reports it and allows a fresh attempt',async()=>{
  const app=fixture();await settle();
  const failed=app.window.lifeosPetSettings.update({mode:'desktop'});await settle();
  app.calls[0].resolve({ok:false,error:'fixture native write failed'});await failed;
  assert.equal(app.get().mode,'in_app');assert.equal(app.nodes.get('#petSettingsHint').textContent,'fixture native write failed');
  const retry=app.window.lifeosPetSettings.update({mode:'desktop'});await settle();assert.equal(app.calls.length,2);
  app.accept(1);await retry;assert.equal(app.get().mode,'desktop');assert.equal(app.nodes.get('#petSettingsHint').textContent,'');
});

test('a queued final scale still saves after an earlier preview request rejects',async()=>{
  const app=fixture();await settle();
  app.inputScale(.83);app.clock.runTimer(60);await settle();
  app.inputScale(1.46);app.commitScale();app.calls[0].reject(new Error('fixture temporary native failure'));await settle();
  assert.equal(app.get().scale,1.46);assert.equal(app.calls.length,2);assert.equal(app.calls[1].patch.commit,true);
  app.accept(1);await settle();assert.equal(app.server.scale,1.46);assert.equal(app.get().scale,1.46);
  assert.equal(app.nodes.get('#petSettingsHint').textContent,'');
});

test('pointer cancellation, focus exit and page exit commit the last preview without an extra delayed write',async()=>{
  for(const exit of ['pointercancel','focusout','pagehide']){
    const app=fixture();await settle();app.inputScale(1.28);
    if(exit==='pagehide')app.window.dispatchEvent({type:exit});else app.panel.fire(exit);
    await settle();assert.equal(app.calls.length,1);assert.equal(app.calls[0].patch.scale,1.28);assert.equal(app.calls[0].patch.commit,true);
    assert.equal([...app.clock.timers.values()].some(task=>task.ms===60),false);
    app.accept(0);await settle();assert.equal(app.server.scale,1.28);
  }
});

test('browser settings save the final continuous scale without persisting the commit transport flag',async()=>{
  const app=fixture({native:false});app.inputScale(.91);app.commitScale();await settle();
  const saved=JSON.parse(app.storage.get('lifeos.pet.settings'));
  assert.equal(saved.scale,.91);assert.equal(saved.commit,undefined);assert.equal(app.get().scale,.91);
  assert.equal(app.calls.length,0);assert.equal(app.inputs.get('mode').disabled,true);
});

test('a delayed initial native read cannot overwrite a newer confirmed user setting',async()=>{
  const app=fixture({delayRead:true});
  const save=app.window.lifeosPetSettings.update({scale:1.41,commit:true});await settle();app.accept(0);await save;
  assert.equal(app.get().scale,1.41);app.resolveRead({...defaults,scale:1});await settle();
  assert.equal(app.get().scale,1.41,'late startup settings are older than the completed user write');
});

test('a new change made as the previous native request completes starts another save',async()=>{
  const app=fixture();await settle();
  const first=app.window.lifeosPetSettings.update({mode:'desktop'});await settle();
  app.calls[0].promise.then(()=>queueMicrotask(()=>app.window.lifeosPetSettings.update({scale:1.31,commit:true})));
  app.accept(0);await settle();
  assert.equal(app.calls.length,2,'the finishing writer does not strand a newly queued setting');
  app.accept(1);await first;await settle();assert.equal(app.server.scale,1.31);
});

function floatingFixture({vivi=true,savedPosition={x:780,y:530}}={}){
  const clock=scheduler(),nodes=new Map(),events={},storage=new Map(),storageWrites=[],styleWrites=[],trace=[];
  storage.set('lifeos.pet.float.position',JSON.stringify(savedPosition));
  const register=(name,fn)=>{(events[name]??=[]).push(fn);};
  const dispatch=event=>{for(const fn of events[event.type]||[])fn(event);};
  const item={slug:'fixture',name:'Fixture',asset_url:vivi?'/fixture-manifest.json':'/fixture.webp',
    ...(vivi?{renderer:'vivi-gif',actions:[{id:'waving',label:'Wave'}]}:{}),spriteVersionNumber:2,
    frame_map:Array.from({length:11},()=>[0,2,4])};
  let actions;
  let fetches=0,prepares=0,mounts=0,runtime=null;
  const insert=html=>{
    for(const tag of html.matchAll(/<\w+[^>]*\bid="([^"]+)"[^>]*>/g)){
      const id=tag[1],element=node(),fallback=id==='lifePetChat'?[390,440]:[144,156];
      element.hidden=/\bhidden(?:\s|>)/.test(tag[0]);element.isConnected=true;element.focus=()=>{};
      element.style=new Proxy(element.style,{set(target,key,value){styleWrites.push([id,key,value]);target[key]=value;return true;}});
      Object.defineProperties(element,{
        offsetLeft:{get:()=>Number.parseFloat(element.style.left)||0},offsetTop:{get:()=>Number.parseFloat(element.style.top)||0},
        offsetWidth:{get:()=>Number.parseFloat(element.style.width)||fallback[0]},
        offsetHeight:{get:()=>Number.parseFloat(element.style.height)||fallback[1]},
        clientWidth:{get:()=>element.offsetWidth},clientHeight:{get:()=>element.offsetHeight}
      });
      element.getBoundingClientRect=()=>({left:element.offsetLeft,top:element.offsetTop,width:element.offsetWidth,height:element.offsetHeight,
        right:element.offsetLeft+element.offsetWidth,bottom:element.offsetTop+element.offsetHeight});
      nodes.set('#'+id,element);
    }
  };
  const document={hidden:false,documentElement:{clientWidth:1000,clientHeight:700},querySelector:selector=>nodes.get(selector)||null,
    body:{insertAdjacentHTML:(_where,html)=>insert(html)},addEventListener:register,createElement:node};
  const window={addEventListener:register,dispatchEvent:dispatch,lifeosPetActions:actions,
    lifeosPetSettings:{get:()=>clone(defaults),restoreChoices(){}},lifeosViViSettings:{get:()=>clone(defaults.vivi)},
    lifeosPetSprites:{prepare:async pet=>{prepares++;return pet;}},
    lifeosViVi:{mount(element,pet,options){
      mounts++;
      const state={x:options.position.x,y:options.position.y,width:options.width,height:options.height,action:'idle',visible:true,motion:true};
      runtime={state,ready:Promise.resolve(),getState:()=>({...state}),
        select(action){trace.push(['select',action]);state.action=action||'idle';return Promise.resolve();},
        playOnce(action){trace.push(['playOnce',action]);state.action=action;return Promise.resolve();},
        setSettings(settings){trace.push(['settings',clone(settings)]);},
        setMotion(motion){trace.push(['motion',motion]);state.motion=motion;},
        setVisible(visible){trace.push(['visible',visible]);state.visible=visible;},
        resize(width,height){trace.push(['resize',width,height]);state.width=width;state.height=height;return {...state};},
        destroy(){trace.push(['destroy']);}};
      return runtime;
    }}};
  const context={...clock,window,document,innerWidth:1000,innerHeight:700,addEventListener:register,bindSpecific(){},
    MutationObserver:class{observe(){}},
    localStorage:{getItem:key=>storage.get(key)??null,setItem(key,value){storage.set(key,value);storageWrites.push([key,value]);}},
    fetch:async()=>{fetches++;return {ok:true,json:async()=>({installed:[item],active_slug:item.slug})};}};
  vm.createContext(context);vm.runInContext(actionsCode,context);actions=window.lifeosPetActions;vm.runInContext(renderersCode,context);
  const paint=window.lifeosPetRenderers.paint;
  window.lifeosPetRenderers.paint=(...args)=>{trace.push(['paint']);return paint(...args);};
  vm.runInContext(floatCode,context);clock.runTimer(1300);
  const settings=patch=>dispatch({type:'lifeos:pet-settings',detail:merge(defaults,patch)});
  function clearTrace(){trace.length=0;styleWrites.length=0;storageWrites.length=0;}
  return {window,nodes,clock,actions,storage,storageWrites,styleWrites,trace,settings,clearTrace,
    get runtime(){return runtime;},get counts(){return {fetches,prepares,mounts};}};
}

test('continuous ViVi scale updates resize the existing renderer without replaying its action or resetting its position',async()=>{
  const app=floatingFixture();await settle();app.clock.flushFrames();
  const sprite=app.nodes.get('#lifePetFloatSprite'),host=app.nodes.get('#lifePetFloat');
  app.actions.select('fixture','waving');app.runtime.state.x=310;app.runtime.state.y=225;
  host.style.left='310px';host.style.top='225px';app.clearTrace();
  const original=app.runtime;
  for(const scale of [.91,1.03,1.37,1.19]){
    app.settings({scale});app.clock.flushFrames();
    assert.equal(app.runtime,original);assert.equal(app.runtime.state.action,'waving');
    assert.equal(host.offsetLeft,310);assert.equal(host.offsetTop,225);
    assert.equal(app.runtime.state.x,310);assert.equal(app.runtime.state.y,225);
    assert.equal(sprite.clientWidth,Math.round(144*scale));assert.equal(sprite.clientHeight,Math.round(156*scale));
    assert.equal(host.offsetWidth,sprite.clientWidth);assert.equal(host.offsetHeight,sprite.clientHeight);
    assert.equal(host.hidden,false);assert.equal(host.inert,false);
  }
  assert.deepEqual(app.trace.filter(([name])=>name==='resize'),[
    ['resize',131,142],['resize',148,161],['resize',197,214],['resize',171,186]
  ]);
  assert.deepEqual(app.counts,{fetches:1,prepares:0,mounts:1});
  assert.equal(app.trace.some(([name])=>['paint','select','playOnce','destroy','visible'].includes(name)),false);
  assert.equal(app.styleWrites.some(([,key])=>['left','top','backgroundImage','backgroundPosition'].includes(key)),false);
  assert.equal(app.storageWrites.some(([key])=>key==='lifeos.pet.float.position'),false);
  assert.deepEqual(JSON.parse(app.storage.get('lifeos.pet.float.position')),{x:780,y:530});
  app.clearTrace();app.settings({scale:1.19});app.settings({scale:1.1901});app.clock.flushFrames();
  assert.equal(app.trace.some(([name])=>name==='resize'),false,'unchanged rounded dimensions do not restart resizing');
});

test('ViVi autonomous movement survives scale-only updates after an explicit action is cleared',async()=>{
  const app=floatingFixture();await settle();app.clock.flushFrames();
  app.actions.select('fixture','waving');app.actions.select('fixture',null);
  const host=app.nodes.get('#lifePetFloat');
  app.runtime.state.action='running-left';app.runtime.state.x=412;app.runtime.state.y=283;
  host.style.left='412px';host.style.top='283px';app.clearTrace();
  app.settings({scale:1.28});app.clock.flushFrames();
  assert.equal(app.runtime.state.action,'running-left');assert.equal(app.runtime.state.x,412);assert.equal(app.runtime.state.y,283);
  assert.equal(host.offsetLeft,412);assert.equal(host.offsetTop,283);assert.equal(app.actions.selected('fixture'),null);
  assert.equal(app.trace.some(([name])=>['paint','select','playOnce','destroy','visible'].includes(name)),false);
});

test('atlas scale updates preserve the current animation frame, action and prepared asset while clamping the larger hit box',async()=>{
  const app=floatingFixture({vivi:false,savedPosition:{x:820,y:530}});await settle();app.clock.flushFrames();
  const sprite=app.nodes.get('#lifePetFloatSprite'),host=app.nodes.get('#lifePetFloat');
  app.actions.select('fixture','jumping');app.clock.runTimer(140);
  const animationId=[...app.clock.timers].find(([,task])=>task.ms===140)[0];
  assert.equal(sprite.style.backgroundPosition,'-288px -624px');app.clearTrace();
  app.settings({scale:1.37});app.clock.flushFrames();
  assert.equal(sprite.style.backgroundPosition,'-394px -856px');assert.equal(sprite.dataset.petAction,'jumping');
  assert.equal(host.offsetWidth,197);assert.equal(host.offsetHeight,214);
  assert.ok(host.offsetLeft+host.offsetWidth<=1000);assert.ok(host.offsetTop+host.offsetHeight<=700);
  assert.ok(app.clock.timers.has(animationId),'resizing keeps the current animation timer');
  assert.equal([...app.clock.timers.values()].filter(task=>task.ms===140).length,1);
  assert.deepEqual(app.counts,{fetches:1,prepares:1,mounts:0});
  assert.deepEqual(JSON.parse(app.storage.get('lifeos.pet.float.position')),{x:820,y:530});
  app.clock.runTimer(140);assert.equal(sprite.style.backgroundPosition,'-788px -856px');
  assert.equal(sprite.dataset.petAction,'jumping');
});
