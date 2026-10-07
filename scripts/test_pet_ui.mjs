import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const shelfCode=readFileSync(new URL('../app/v012-pet-rail.js',import.meta.url),'utf8');
const spriteCode=readFileSync(new URL('../app/pet-sprite.js',import.meta.url),'utf8');
const actionsCode=readFileSync(new URL('../app/pet-actions.js',import.meta.url),'utf8');
const floatCode=readFileSync(new URL('../app/v012-pet-float.js',import.meta.url),'utf8');
const desktopCode=readFileSync(new URL('../desktop/pet.html',import.meta.url),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
const cells=[0,1,2,3,4,5];
const pet={slug:'fixture',name:'Fixture',asset_url:'/fixture.webp',spriteVersionNumber:1,
  author:'Fixture',license:'MIT',frame_map:Array.from({length:9},()=>[0,1,2,3,4,5,6,7])};
function canvas(){return {getContext(){return {drawImage(){},getImageData(column,row){return {data:new Uint8ClampedArray([0,0,0,cells.includes(column)?255:0])};}};}};}

function element() {
  const writes=[],listeners={};
  return {writes,listeners,dataset:{},style:new Proxy({setProperty(key,value){this[key]=value;},removeProperty(key){delete this[key];}}, {set(target,key,value){writes.push([key,value]);target[key]=value;return true;}}),
    textContent:'',innerHTML:'',value:'',children:[],classList:{add(){},remove(){},toggle(){}},
    addEventListener(name,fn){(listeners[name]??=[]).push(fn);},trigger(name,event={}){for(const fn of listeners[name]||[])fn(event);},querySelector(){return element();},append(node){this.children.push(node);},focus(){this.focused=true;},getBoundingClientRect(){return {left:0,top:0,width:192,height:208};}};
}
function timers() {
  let id=0;
  const tasks=new Map();
  return {setTimeout(fn,ms){tasks.set(++id,{fn,ms});return id;},clearTimeout(key){tasks.delete(key);},
    run(ms){const pair=[...tasks].find(([,task])=>task.ms===ms);assert.ok(pair,`timer ${ms} is scheduled`);tasks.delete(pair[0]);pair[1].fn();},tasks};
}
async function shelf({delayedShell=false}={}) {
  const clock=timers(),nodes=new Map(),events={};
  const getNode=selector=>{if(!nodes.has(selector))nodes.set(selector,element());return nodes.get(selector);};
  const context={...clock,STATE:{feature:'Pet Shelf'},DREAM_META:{},RENDERERS:{},bindSpecific(){},pageWrap:x=>x,
    localStorage:{getItem:()=>null,setItem(){}},Image:class{naturalWidth=8;naturalHeight=9;decode(){return Promise.resolve();}},
    fetch:async()=>({ok:true,json:async()=>({installed:[pet],active_slug:'fixture',catalog:[{...pet,preview_url:'/animated.webp'}]})}),
    document:{hidden:false,querySelector:getNode,querySelectorAll:()=>[],createElement:canvas},
    window:{addEventListener(name,fn){events[name]=fn;},dispatchEvent(){}},CustomEvent:class{},Event:class{}};
  vm.createContext(context);vm.runInContext(spriteCode,context);vm.runInContext(actionsCode,context);vm.runInContext(shelfCode,context);
  const registeredEarly=typeof events['lifeos:open-pet']==='function'&&typeof context.RENDERERS['Pet Shelf']==='function';
  let shellCalls=0;
  if(delayedShell){context.bindSpecific=()=>shellCalls++;events['lifeos:i2-ready']();}
  clock.run(1050);
  const html=await context.RENDERERS['Pet Shelf']();
  context.bindSpecific();
  return {context,clock,nodes,html,registeredEarly,get shellCalls(){return shellCalls}};
}

test('shelf is available immediately and controls survive delayed shell replacement',async()=>{
  const app=await shelf({delayedShell:true});
  assert.equal(app.registeredEarly,true);
  assert.equal(app.shellCalls,1);
  const sprite=app.nodes.get('#petPageSprite');
  const before=sprite.style.backgroundPosition;
  app.clock.run(155);
  assert.notEqual(sprite.style.backgroundPosition,before);
  assert.equal(typeof app.nodes.get('#petPageMotion').onchange,'function');
});

test('floating pet mounts survive shell replacement before or after fallback setup',()=>{
  const start=floatCode.indexOf('  function bind(){'),end=floatCode.lastIndexOf('\n})();');
  assert.ok(start>0&&end>start);
  for(const delayedShell of [false,true]){
    const clock=timers(),events={};let mounts=0,examples=0,shellCalls=0;
    const context={...clock,STATE:{feature:'Pet Shelf'},bindSpecific(){},mount(){mounts++},example(){examples++},position(){},drag:null,refresh(){return Promise.resolve()},
      window:{addEventListener(name,fn){events[name]=fn;}}};
    vm.createContext(context);vm.runInContext(floatCode.slice(start,end),context);
    if(delayedShell)clock.run(1300);
    context.bindSpecific=()=>shellCalls++;
    events['lifeos:i2-ready']();
    if(!delayedShell)clock.run(1300);
    context.bindSpecific();
    assert.equal(shellCalls,1);assert.equal(examples,0);assert.ok(mounts>=1);
  }
});

function floating({desktopMode=false,previouslyVisible=true,width=1000,height=700,installed=[pet],prepare=async value=>value,fetchFailure=false,savedPosition=null,readerFooter=null}={}) {
  const clock=timers(),nodes=new Map(),events={},storage=new Map();
  if(previouslyVisible!==null)storage.set('lifeos.pet.float.visible',String(previouslyVisible));
  if(savedPosition)storage.set('lifeos.pet.float.position',JSON.stringify(savedPosition));
  let catalog=installed;
  let nativeCalls=0;
  const register=(name,fn)=>{const previous=events[name];events[name]=event=>{previous?.(event);return fn(event);};};
  const insert=html=>{
    for(const tag of html.matchAll(/<\w+[^>]*\bid="([^"]+)"[^>]*>/g)){
      const node=element();node.hidden=/\bhidden(?:\s|>)/.test(tag[0]);
      const dimensions=tag[1]==='lifePetChat'?[Math.min(390,width-24),440]:tag[1]==='lifePetMenu'?[166,100]:[144,156];
      Object.defineProperties(node,{
        offsetLeft:{get:()=>Number.parseFloat(node.style.left)||0},offsetTop:{get:()=>Number.parseFloat(node.style.top)||0},
        offsetWidth:{get:()=>dimensions[0]},offsetHeight:{get:()=>Math.min(dimensions[1],node.style['--pet-panel-max-height']===undefined?Infinity:Number.parseFloat(node.style['--pet-panel-max-height']))}
      });
      node.getBoundingClientRect=()=>({left:node.offsetLeft,top:node.offsetTop,right:node.offsetLeft+node.offsetWidth,bottom:node.offsetTop+node.offsetHeight,width:node.offsetWidth,height:node.offsetHeight});
      node.insertAdjacentHTML=(_,markup)=>insert(markup);nodes.set('#'+tag[1],node);
    }
  };
  for(const selector of ['.petPageButtons','.petPage']){
    const node=element();node.insertAdjacentHTML=(_,markup)=>insert(markup);nodes.set(selector,node);
  }
  const footer=rect=>{if(!rect){nodes.delete('.jbPageFoot');return}const node=element();node.getBoundingClientRect=()=>({...rect,right:rect.left+rect.width,bottom:rect.top+rect.height});nodes.set('.jbPageFoot',node);};
  footer(readerFooter);
  const window={lifeosPetSprites:{prepare},addEventListener:register};
  if(desktopMode)window.lifeosDesktop={onPetChat(){nativeCalls++;},refreshPet(){nativeCalls++;}};
  const context={...clock,STATE:{feature:'Pet Shelf'},bindSpecific(){},window,innerWidth:width,innerHeight:height,
    localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)},
    requestAnimationFrame:fn=>fn(),addEventListener:register,
    fetch:async()=>{if(fetchFailure)throw new Error('fixture catalog unavailable');return{json:async()=>({installed:catalog,active_slug:catalog[0]?.slug})}},
    document:{querySelector:selector=>nodes.get(selector)??null,addEventListener(){},createElement:element,
      body:{insertAdjacentHTML:(_,html)=>insert(html)}}};
  vm.createContext(context);vm.runInContext(actionsCode,context);vm.runInContext(floatCode,context);clock.run(1300);context.bindSpecific();
  return {clock,nodes,events,storage,context,footer,setCatalog(value){catalog=value;},get nativeCalls(){return nativeCalls;}};
}
const settle=()=>new Promise(setImmediate);

test('desktop uses the same internal floating pet and welcomes once across chat entry points',async()=>{
  const app=floating({desktopMode:true,previouslyVisible:null});
  assert.equal(app.nodes.get('#lifePetFloat').hidden,true,'loading never creates a transparent click target');
  await settle();
  assert.equal(app.nodes.get('#lifePetFloat').hidden,false);
  assert.ok(app.nodes.has('#lifePetFloatSprite'));
  assert.equal(app.nodes.has('#petFloatToggle'),false,'visibility belongs to the room settings');
  assert.equal(app.nodes.get('#lifePetChat').hidden,true);
  await app.events['lifeos:open-pet-chat']();
  assert.equal(app.nodes.get('#lifePetChat').hidden,false);
  assert.equal(app.nodes.get('#petChatInput').focused,true);
  await app.events['lifeos:open-pet-chat']();
  await app.events['lifeos:open-pet-chat']();
  assert.equal(app.nodes.get('#petChatFeed').children.length,1,'application and pet menu entry points share one welcome');
  assert.ok(app.nodes.get('#petChatFeed').children[0].textContent.includes('想聊点什么'));
  assert.equal([...app.nodes.keys()].filter(selector=>selector==='#lifePetFloat').length,1);
  assert.equal(app.storage.get('lifeos.pet.float.visible'),'true');
  await new Promise(setImmediate);
  assert.equal(app.nativeCalls,0,'floating pet never opens or refreshes a native pet window');
});

test('desktop keeps an explicit hidden preference until the user opens chat',async()=>{
  const app=floating({desktopMode:true,previouslyVisible:false}),float=app.nodes.get('#lifePetFloat');
  await settle();
  assert.equal(float.hidden,true);
  assert.equal(app.storage.get('lifeos.pet.float.visible'),'false');
  await app.events['lifeos:open-pet-chat']();
  assert.equal(float.hidden,false);
  assert.equal(app.storage.get('lifeos.pet.float.visible'),'true');
});

test('browser keeps the floating pet preference and its visibility controls',async()=>{
  const app=floating({previouslyVisible:true}),float=app.nodes.get('#lifePetFloat');
  await settle();
  assert.equal(float.hidden,false);
  assert.equal(app.nodes.has('#petPageExamples'),false,'obsolete example section is removed');
  assert.ok([...app.clock.tasks.values()].some(task=>task.ms===140));
  app.events['lifeos:pet-settings']({detail:{mode:'in_app',visible:false,motion:true,scale:1}});
  assert.equal(float.hidden,true);
  assert.equal(app.storage.get('lifeos.pet.float.visible'),'false');
  assert.equal([...app.clock.tasks.values()].some(task=>task.ms===140),false);
});

test('desktop placement suppresses the internal pet through chat and restores it when changed back',async()=>{
  const app=floating({desktopMode:true,previouslyVisible:true}),float=app.nodes.get('#lifePetFloat');await settle();
  app.events['lifeos:pet-settings']({detail:{mode:'desktop',visible:true,motion:true,scale:1.2}});
  assert.equal(float.hidden,true);assert.equal(float.inert,true);
  assert.equal(app.nodes.get('#lifePetFloatSprite').style.width,'173px');
  await app.events['lifeos:open-pet-chat']();assert.equal(float.hidden,true);
  assert.equal(app.nodes.get('#lifePetChat').hidden,false,'desktop chat remains available in the main window');
  app.events['lifeos:pet-settings']({detail:{mode:'in_app',visible:true,motion:true,scale:1}});
  assert.equal(float.hidden,false);assert.equal(float.inert,false);
});

function separatePetAndChat(app){
  const petBox=app.nodes.get('#lifePetFloat').getBoundingClientRect(),chatBox=app.nodes.get('#lifePetChat').getBoundingClientRect();
  assert.ok(chatBox.right<=petBox.left-12||chatBox.left>=petBox.right+12||chatBox.bottom<=petBox.top-12||chatBox.top>=petBox.bottom+12,'chat stays beside the pet with a gap');
  assert.ok(chatBox.left>=12&&chatBox.top>=12&&chatBox.right<=app.context.innerWidth-12&&chatBox.bottom<=app.context.innerHeight-12,'chat stays inside the viewport');
}

test('chat chooses a clear side and switches sides near either screen edge',async()=>{
  for(const x of [0,180,780,856]){
    const app=floating({desktopMode:true}),float=app.nodes.get('#lifePetFloat');
    await settle();
    float.style.left=x+'px';float.style.top='320px';
    await app.events['lifeos:open-pet-chat']();
    assert.equal(app.nodes.get('#lifePetChat').dataset.anchor,x<500?'right':'left');
    separatePetAndChat(app);
  }
});

test('chat stays open and follows dragging and resizing without duplicating its greeting',async()=>{
  const app=floating({desktopMode:true}),sprite=app.nodes.get('#lifePetFloatSprite'),chat=app.nodes.get('#lifePetChat');
  await settle();
  await app.events['lifeos:open-pet-chat']();
  const startLeft=app.nodes.get('#lifePetFloat').offsetLeft,startTop=app.nodes.get('#lifePetFloat').offsetTop;
  const pointer=(x,y)=>({button:0,pointerId:1,clientX:x,clientY:y,preventDefault(){}});
  sprite.trigger('pointerdown',pointer(startLeft+20,startTop+20));
  sprite.trigger('pointermove',pointer(30,340));sprite.trigger('pointerup');
  assert.equal(chat.hidden,false);assert.equal(chat.dataset.anchor,'right');separatePetAndChat(app);
  app.context.innerWidth=620;app.context.innerHeight=640;app.events.resize();
  assert.equal(chat.hidden,false);separatePetAndChat(app);
  assert.equal(app.nodes.get('#petChatFeed').children.length,1);
});

test('narrow windows use the space above or below the pet without overlap',async()=>{
  for(const y of [24,250,580]){
    const app=floating({desktopMode:true,width:390,height:760}),float=app.nodes.get('#lifePetFloat');
    await settle();
    float.style.left='200px';float.style.top=y+'px';
    await app.events['lifeos:open-pet-chat']();
    assert.ok(['above','below'].includes(app.nodes.get('#lifePetChat').dataset.anchor));
    separatePetAndChat(app);
  }
});

test('no pet, missing assets and failed decoding leave no invisible click target while keeping the preference',async()=>{
  const variants=[{installed:[]},{installed:[{...pet,asset_url:''}]},{prepare:async()=>{throw new Error('fixture image decode failed')}},{fetchFailure:true}];
  for(const variant of variants){
    const app=floating({desktopMode:true,previouslyVisible:true,...variant});await settle();
    const float=app.nodes.get('#lifePetFloat');
    assert.equal(float.hidden,true);assert.equal(float.inert,true);assert.equal(float.style.pointerEvents,'none');
    assert.equal(float.dataset.spriteReady,'false');assert.equal(app.storage.get('lifeos.pet.float.visible'),'true');
    assert.equal([...app.clock.tasks.values()].some(task=>[140,240].includes(task.ms)),false);
  }
});

test('a delayed asset becomes interactive only after successful preparation and honours a hidden preference',async()=>{
  for(const preference of [true,false]){
    let complete;
    const app=floating({previouslyVisible:preference,prepare:()=>new Promise(resolve=>{complete=resolve;})});
    await settle();const float=app.nodes.get('#lifePetFloat');
    assert.equal(float.hidden,true);assert.equal(float.inert,true);assert.equal(float.style.pointerEvents,'none');
    complete(pet);await settle();
    assert.equal(float.dataset.spriteReady,'true');assert.equal(float.hidden,!preference);assert.equal(float.inert,!preference);
    assert.equal(float.style.pointerEvents,preference?'':'none');
    assert.equal(app.nodes.get('#lifePetFloatSprite').style.backgroundImage,'url("/fixture.webp")');
    assert.equal(app.storage.get('lifeos.pet.float.visible'),String(preference));
  }
});

test('a failed replacement keeps the already decoded pet instead of creating a ghost or losing the preference',async()=>{
  const app=floating({prepare:async item=>{if(item.asset_url==='/missing.webp')throw new Error('fixture replacement decode failed');return item}});await settle();
  const float=app.nodes.get('#lifePetFloat'),sprite=app.nodes.get('#lifePetFloatSprite');
  app.setCatalog([{...pet,asset_url:'/missing.webp'}]);await app.events['lifeos:pets-changed']();await settle();
  assert.equal(float.hidden,false);assert.equal(float.inert,false);assert.equal(float.dataset.spriteReady,'true');
  assert.equal(sprite.style.backgroundImage,'url("/fixture.webp")');assert.equal(app.storage.get('lifeos.pet.float.visible'),'true');
  app.setCatalog([]);await app.events['lifeos:pets-changed']();await settle();
  assert.equal(float.hidden,true);assert.equal(float.inert,true);assert.equal(float.style.pointerEvents,'none');
});

test('reader footer avoidance is temporary and restores the saved position on leaving the reader',async()=>{
  const saved={x:820,y:520},app=floating({desktopMode:true,savedPosition:saved,readerFooter:{left:200,top:620,width:780,height:60}});
  await settle();const float=app.nodes.get('#lifePetFloat');
  assert.ok(float.offsetTop+float.offsetHeight<=608,'pet sits above the page-turn controls with a gap');
  assert.deepEqual(JSON.parse(app.storage.get('lifeos.pet.float.position')),saved);
  app.footer(null);app.context.STATE.feature='Home';app.context.bindSpecific();
  assert.equal(float.offsetLeft,saved.x);assert.equal(float.offsetTop,saved.y);
  app.footer({left:200,top:580,width:780,height:60});app.context.STATE.feature='Journal';app.context.bindSpecific();
  assert.ok(float.offsetTop+float.offsetHeight<=568);
  app.footer({left:200,top:530,width:780,height:60});app.context.innerHeight=610;app.events.resize();
  assert.ok(float.offsetTop+float.offsetHeight<=518,'resize recalculates against the current footer');
  assert.deepEqual(JSON.parse(app.storage.get('lifeos.pet.float.position')),saved);
});

test('drag release avoids reader buttons but retains the intended user position for other pages',async()=>{
  const app=floating({desktopMode:true,savedPosition:{x:820,y:520},readerFooter:{left:200,top:620,width:780,height:60}});await settle();
  const float=app.nodes.get('#lifePetFloat'),sprite=app.nodes.get('#lifePetFloatSprite');
  const pointer=(x,y)=>({button:0,pointerId:1,clientX:x,clientY:y,preventDefault(){}});
  sprite.trigger('pointerdown',pointer(float.offsetLeft+20,float.offsetTop+20));
  sprite.trigger('pointermove',pointer(870,540));sprite.trigger('pointerup');
  assert.ok(float.offsetTop+float.offsetHeight<=608);
  assert.deepEqual(JSON.parse(app.storage.get('lifeos.pet.float.position')),{x:850,y:520});
  app.footer(null);app.context.bindSpecific();assert.equal(float.offsetLeft,850);assert.equal(float.offsetTop,520);
});

test('shelf loops a six-frame action evenly without resetting or reloading its image',async()=>{
  const app=await shelf(),sprite=app.nodes.get('#petPageSprite'),columns=[];
  for(let i=0;i<12;i++){columns.push(Math.round(parseFloat(sprite.style.backgroundPosition)*7/100));app.clock.run(155);}
  assert.deepEqual(columns,[0,1,2,3,4,5,0,1,2,3,4,5]);
  assert.equal(sprite.writes.filter(([key])=>key==='backgroundImage').length,1);
  const catalog=app.nodes.get('#petPageCatalog').innerHTML;
  assert.ok(catalog.includes('data-pet-catalog-mini="fixture"'));
  assert.ok(!catalog.includes('src="/animated.webp"'));
});

test('shelf animation stops when leaving the pet page and obeys its motion switch',async()=>{
  const app=await shelf(),sprite=app.nodes.get('#petPageSprite');
  app.nodes.get('#petPageMotion').onchange({target:{checked:false}});
  const before=sprite.style.backgroundPosition;
  app.clock.run(155);
  assert.equal(sprite.style.backgroundPosition,before);
  app.context.STATE.feature='Home';
  app.clock.run(155);
  assert.equal([...app.clock.tasks.values()].filter(task=>task.ms===155).length,0);
});

test('each pet keeps a looping action and the active pet does not inherit another pet choice',async()=>{
  const app=await shelf(),sprite=app.nodes.get('#petPageSprite'),actions=app.context.window.lifeosPetActions;
  assert.ok(app.html.includes('data-columns="2"'));
  assert.equal(app.html.includes('互动动作'),false);
  actions.select('another-pet','jumping');assert.equal(sprite.dataset.petAction,'idle');
  actions.select('fixture','waving');assert.equal(sprite.dataset.petAction,'waving');
  const columns=[];for(let i=0;i<12;i++){columns.push(Math.round(parseFloat(sprite.style.backgroundPosition)*7/100));app.clock.run(155);}
  assert.deepEqual(columns,[0,1,2,3,4,5,0,1,2,3,4,5]);
  assert.equal(sprite.style.backgroundPosition.split(' ')[1],'37.5%');
  assert.equal(actions.selected('another-pet'),'jumping');
  actions.select('fixture',null);assert.equal(sprite.dataset.petAction,'idle');assert.equal(actions.selected('another-pet'),'jumping');
});

test('floating v2 pet repeats an explicit action through navigation, pointer gaze and drag release',async()=>{
  const app=floating({installed:[{...pet,spriteVersionNumber:2,frame_map:Array.from({length:11},()=>[0,2,4])}]});await settle();
  const sprite=app.nodes.get('#lifePetFloatSprite'),actions=app.context.window.lifeosPetActions;
  actions.select('fixture','jumping');assert.equal(sprite.dataset.petAction,'jumping');
  app.events['lifeos:event']({detail:{type:'navigate'}});assert.equal(sprite.dataset.petAction,'jumping');
  sprite.trigger('pointermove',{clientX:900,clientY:30});assert.equal(sprite.dataset.petAction,'jumping');assert.equal(sprite.style.backgroundPosition.split(' ')[1],'-624px');
  const columns=[];for(let i=0;i<9;i++){columns.push(-parseFloat(sprite.style.backgroundPosition)/144||0);app.clock.run(140);}
  assert.deepEqual(columns,[0,2,4,0,2,4,0,2,4]);
  const float=app.nodes.get('#lifePetFloat'),pointer=(x,y)=>({button:0,pointerId:1,clientX:x,clientY:y,preventDefault(){}});
  sprite.trigger('pointerdown',pointer(float.offsetLeft+20,float.offsetTop+20));sprite.trigger('pointermove',pointer(50,380));sprite.trigger('pointerup');assert.equal(sprite.dataset.petAction,'jumping');
  actions.select('fixture',null);app.events['lifeos:event']({detail:{type:'journal-open'}});assert.equal(sprite.dataset.petAction,'review');
});

test('empty v2 action rows fall back to a populated action while motion pause keeps a visible companion',async()=>{
  const frames=Array.from({length:11},(_,row)=>row===4?[]:[1,3]);
  const app=floating({installed:[{...pet,spriteVersionNumber:2,frame_map:frames}]});await settle();const sprite=app.nodes.get('#lifePetFloatSprite');
  app.context.window.lifeosPetActions.select('fixture','jumping');assert.equal(sprite.style.backgroundPosition.split(' ')[1],'-0px');
  app.events['lifeos:pet-motion']({detail:{enabled:false}});assert.equal(app.nodes.get('#lifePetFloat').hidden,false);assert.equal([...app.clock.tasks.values()].some(task=>task.ms===140),false);
  app.events['lifeos:pet-motion']({detail:{enabled:true}});assert.equal([...app.clock.tasks.values()].some(task=>task.ms===140),true);
});

function desktop() {
  const clock=timers(),root=element(),images=[];
  let ready=0;
  root.clientWidth=192;root.clientHeight=208;root.replaceChildren=()=>{root.children=[]};
  const initial={id:'fixture',version:1,sprite:'file:///first.webp',frameMap:pet.frame_map,motion:true,visible:true};
  const context={...clock,URLSearchParams,addEventListener(){},location:{search:'?'+new URLSearchParams({pet:JSON.stringify(initial)})},
    Image:class {naturalWidth=8;naturalHeight=9;decode(){return new Promise((resolve,reject)=>images.push({resolve,reject}));}},
    document:{getElementById:()=>root,createElement:canvas},window:{lifeosPet:{ready(){ready++;},failed(){},onEvent(){},onAction(){},onConfig(){}}}};
  vm.createContext(context);vm.runInContext(actionsCode,context);vm.runInContext(desktopCode,context);
  return {context,clock,root,images,initial,get ready(){return ready;}};
}

test('desktop waits for decode and preserves the old pet while its replacement loads or fails',async()=>{
  const app=desktop();
  assert.equal(app.ready,0);assert.equal(app.root.style.backgroundImage,undefined);
  app.images.shift().resolve();await new Promise(setImmediate);
  assert.equal(app.ready,1);assert.equal(app.root.style.backgroundImage,'url("file:///first.webp")');
  const pending=app.context.applyConfig({...app.initial,sprite:'file:///second.webp'});
  assert.equal(app.root.style.backgroundImage,'url("file:///first.webp")');
  app.images.shift().resolve();await pending;
  assert.equal(app.root.style.backgroundImage,'url("file:///second.webp")');
  const failing=app.context.applyConfig({...app.initial,sprite:'file:///missing.webp'});
  app.images.shift().reject(new Error('fixture decode failure'));await failing;
  assert.equal(app.root.style.backgroundImage,'url("file:///second.webp")');
});

test('desktop plays all populated cells in sequence over multiple short cycles',async()=>{
  const app=desktop();app.images.shift().resolve();await new Promise(setImmediate);
  const columns=[];
  for(let i=0;i<12;i++){columns.push(-parseFloat(app.root.style.backgroundPosition)/192||0);app.clock.run(140);}
  assert.deepEqual(columns,[0,1,2,3,4,5,0,1,2,3,4,5]);
  assert.equal(app.root.writes.filter(([key])=>key==='backgroundImage').length,1);
});
