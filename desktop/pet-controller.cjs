'use strict';
const path=require('node:path');
const fs=require('node:fs');
const {pathToFileURL}=require('node:url');
const {updatePetWindow}=require('./pet-window.cjs');

const SETTINGS_KEY='lifeos.desktop.pet.v1',POSITION_KEY='lifeos.desktop.pet.position.v1',ACTIONS_KEY='lifeos.desktop.pet.actions.v1';
const DEFAULTS=Object.freeze({mode:'in_app',keepOnClose:true,alwaysOnTop:true,scale:1,visible:true,motion:true,vivi:Object.freeze({dragAction:'fly',autoBehavior:true,edgeHide:true})});
function normalizeSettings(value={},previous=DEFAULTS){
  if(!value||typeof value!=='object'||Array.isArray(value))value={};
  const next={...previous,vivi:{...DEFAULTS.vivi,...previous.vivi}};
  if(value.mode==='in_app'||value.mode==='desktop')next.mode=value.mode;
  for(const key of ['keepOnClose','alwaysOnTop','visible','motion'])if(typeof value[key]==='boolean')next[key]=value[key];
  if(typeof value.scale==='number'&&Number.isFinite(value.scale))next.scale=Math.round(Math.max(.6,Math.min(1.8,value.scale))*100)/100;
  if(value.vivi&&typeof value.vivi==='object'){
    if(['fly','interact','jump','sweat'].includes(value.vivi.dragAction))next.vivi.dragAction=value.vivi.dragAction;
    for(const key of ['autoBehavior','edgeHide'])if(typeof value.vivi[key]==='boolean')next.vivi[key]=value.vivi[key];
  }
  return next;
}
function createPetController({BrowserWindow,Tray,Menu,nativeImage,screen,store,resourceRoot,desktopDir,base,actions,onOpen,onQuit,onSettings=()=>{},onAction=()=>{},fetchJSON}){
  const read=(key,fallback)=>{const raw=store.operation({op:'get',key});if(!raw)return fallback;try{return JSON.parse(raw)}catch{return fallback}};
  const save=(key,value)=>store.operation({op:'set',key,value:JSON.stringify(value)});
  let settings=normalizeSettings(read(SETTINGS_KEY,{})),position=read(POSITION_KEY,null),choices=read(ACTIONS_KEY,{});
  if(!choices||typeof choices!=='object'||Array.isArray(choices))choices={};
  let petWindow=null,tray=null,meta=null,ready=false,error='',drag=null,stopped=false,sequence=0,refreshing=null;
  const actionChoices=()=>Array.isArray(meta?.actions)&&meta.actions.length?meta.actions:actions;
  const actionIds=slug=>{
    if(slug===meta?.id)return new Set(actionChoices().map(([id])=>id));
    if(slug==='vivi--durianloop')try{return new Set(JSON.parse(fs.readFileSync(path.join(resourceRoot,'app','assets','pets','vivi','pet.json'),'utf8')).actions.map(row=>row.id))}catch{}
    return new Set(actions.map(([id])=>id));
  };
  const snapshot=()=>({ok:true,settings:{...settings,vivi:{...settings.vivi}},choices:{...choices},status:{visible:Boolean(petWindow&&!petWindow.isDestroyed()&&petWindow.isVisible()),ready,error,slug:meta?.id||null}});
  const notify=()=>{const state=snapshot();onSettings(state);return state};
  const isSender=sender=>Boolean(petWindow&&!petWindow.isDestroyed()&&petWindow.webContents===sender);
  const keepAlive=()=>!stopped&&settings.mode==='desktop'&&settings.keepOnClose&&Boolean(tray&&!tray.isDestroyed());
  const dimensions=()=>({width:Math.round(192*settings.scale),height:Math.round(208*settings.scale)});
  function bounded(point){
    const size=dimensions(),display=point&&Number.isFinite(point.x)&&Number.isFinite(point.y)?screen.getDisplayNearestPoint({x:Math.round(point.x),y:Math.round(point.y)}):screen.getPrimaryDisplay();
    const area=display.workArea;
    return {...size,x:Math.round(Math.max(area.x,Math.min(area.x+area.width-size.width,Number.isFinite(point?.x)?point.x:area.x+area.width-size.width-24))),y:Math.round(Math.max(area.y,Math.min(area.y+area.height-size.height,Number.isFinite(point?.y)?point.y:area.y+area.height-size.height-24)))};
  }
  function trayIcon(){
    const width=32,pixels=Buffer.alloc(width*width*4);
    for(let y=0;y<width;y++)for(let x=0;x<width;x++){
      const offset=(y*width+x)*4,inside=Math.hypot(x-15.5,y-15.5)<14.5,letter=(x>=10&&x<=13&&y>=8&&y<=23)||(x>=10&&x<=22&&y>=20&&y<=23);
      if(inside){pixels[offset]=letter?248:104;pixels[offset+1]=letter?242:89;pixels[offset+2]=letter?232:126;pixels[offset+3]=255;}
    }
    return nativeImage.createFromBitmap(pixels,{width,height:width,scaleFactor:1});
  }
  const safely=task=>Promise.resolve().then(task).catch(reason=>{error=String(reason?.message||reason);notify()});
  function rebuildTray(){
    if(!tray||tray.isDestroyed())return;
    tray.setContextMenu(Menu.buildFromTemplate([
      {label:'打开 LifeOS',click:()=>safely(()=>onOpen({}))},
      {label:settings.visible?'隐藏桌宠':'显示桌宠',click:()=>safely(()=>setSettings({visible:!settings.visible}))},
      {label:'桌宠设置',click:()=>safely(()=>onOpen({settings:true}))},
      {type:'separator'},{label:'退出 LifeOS',click:onQuit}
    ]));
  }
  function ensureTray(){
    if(tray&&!tray.isDestroyed())return;
    tray=new Tray(trayIcon());tray.setToolTip('LifeOS · 桌面陪伴');
    tray.on('double-click',()=>safely(()=>onOpen({})));rebuildTray();
  }
  function disposeWindow(){
    ready=false;drag=null;const previous=petWindow;petWindow=null;
    if(previous&&!previous.isDestroyed())previous.destroy();
  }
  function destroyTray(){if(tray&&!tray.isDestroyed())tray.destroy();tray=null;}
  function sendConfig(){
    if(!meta||!petWindow||petWindow.isDestroyed())return Promise.resolve();
    const action=actionIds(meta.id).has(choices[meta.id])?choices[meta.id]:null;
    const [x,y]=petWindow.getPosition(),workArea=screen.getDisplayNearestPoint({x,y}).workArea;
    return updatePetWindow(petWindow,{...meta,slug:meta.id,scale:settings.scale,vivi:settings.vivi,visible:settings.visible,action,actions:actionChoices(),workArea,position:{x:x-workArea.x,y:y-workArea.y},motion:settings.motion,actionsScript:pathToFileURL(path.join(resourceRoot,'app','pet-actions.js')).href},path.join(desktopDir,'pet.html'));
  }
  async function refresh(){
    if(stopped||settings.mode!=='desktop')return snapshot();
    if(refreshing){await refreshing;return !stopped&&settings.mode==='desktop'&&!petWindow?refresh():snapshot()}
    const request=++sequence;
    refreshing=(async()=>{
      try{
        const result=await fetchJSON(base()+'/api/pets/desktop');
        if(stopped||request!==sequence||settings.mode!=='desktop')return snapshot();
        if(!result?.pet?.sprite){meta=null;disposeWindow();error='尚未选择桌宠';return notify();}
        const item=result.pet;
        if(!path.isAbsolute(item.sprite))throw new Error('桌宠图片路径无效');
        const metadataActions=Array.isArray(item.actions)?item.actions.filter(row=>Array.isArray(row)&&typeof row[0]==='string'&&typeof row[1]==='string').slice(0,50):null;
        let viviActions=null;
        if(item.renderer==='vivi-gif'){
          const manifest=await fetchJSON(new URL(item.manifest_url,base()).href);
          viviActions=(manifest.actions||[]).filter(row=>/^[a-z0-9_-]+$/.test(row.id)&&/^[a-z0-9]+\.gif$/.test(row.asset)).map(row=>({...row,asset_url:pathToFileURL(path.join(path.dirname(item.sprite),row.asset)).href}));
          if(stopped||request!==sequence||settings.mode!=='desktop')return snapshot();
        }
        meta={...item,actions:metadataActions,viviActions,viviScript:pathToFileURL(path.join(resourceRoot,'app','vivi-pet.js')).href,viviCSS:pathToFileURL(path.join(resourceRoot,'app','vivi-pet.css')).href,sprite:pathToFileURL(item.sprite).href,backendOrigin:base(),manifest_url:item.manifest_url?new URL(item.manifest_url,base()).href:undefined,asset_url:item.asset_url?new URL(item.asset_url,base()).href:undefined};
        if(!petWindow||petWindow.isDestroyed()){
          ready=false;const target=new BrowserWindow({...bounded(position),title:'LifeOS 桌宠',transparent:true,frame:false,resizable:false,skipTaskbar:true,alwaysOnTop:settings.alwaysOnTop,show:false,hasShadow:false,webPreferences:{preload:path.join(desktopDir,'pet-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});
          petWindow=target;target.webContents.setWindowOpenHandler(()=>({action:'deny'}));
          target.webContents.on('will-navigate',event=>event.preventDefault());
          target.webContents.on('render-process-gone',()=>{if(petWindow===target){ready=false;error='桌宠已暂停，请重新显示桌宠';target.hide();notify()}});
          target.on('closed',()=>{if(petWindow===target){petWindow=null;ready=false;notify()}});
        }
        petWindow.setAlwaysOnTop(settings.alwaysOnTop);petWindow.setBounds(bounded(position),false);
        await sendConfig();error='';if(ready&&settings.visible)petWindow.showInactive();else if(!settings.visible)petWindow.hide();onAction({slug:meta.id,action:actionIds(meta.id).has(choices[meta.id])?choices[meta.id]:null});
        return notify();
      }catch(reason){error=String(reason?.message||reason);return notify()}
      finally{refreshing=null}
    })();
    return refreshing;
  }
  async function setSettings(patch){
    if(!patch||typeof patch!=='object'||Array.isArray(patch))return {ok:false,error:'桌宠设置无效'};
    const next=normalizeSettings(patch,settings),previous=settings;
    // Ensure a recovery entry point exists before allowing the app to stay in the background.
    if(next.mode==='desktop')ensureTray();
    try{save(SETTINGS_KEY,next)}catch(reason){if(previous.mode!=='desktop')destroyTray();throw reason}
    settings=next;error='';rebuildTray();
    if(settings.mode!=='desktop'){sequence++;disposeWindow();destroyTray();}
    else{
      if(petWindow&&!petWindow.isDestroyed()){
        petWindow.setAlwaysOnTop(settings.alwaysOnTop);petWindow.setBounds(bounded(position),false);
        await sendConfig();if(settings.visible&&ready)petWindow.showInactive();else petWindow.hide();
      }
      await refresh();
    }
    return notify();
  }
  function selectAction(value){
    const {slug,action}=value||{};
    if(typeof slug!=='string'||slug.length>180||!slug||['__proto__','constructor','prototype'].includes(slug)||!(action===null||actionIds(slug).has(action)))return {ok:false,error:'桌宠动作无效'};
    const next={...choices};if(action===null)delete next[slug];else next[slug]=action;
    if(Object.keys(next).length>300)return {ok:false,error:'桌宠动作记录已满'};
    save(ACTIONS_KEY,next);choices=next;
    if(slug===meta?.id)petWindow?.webContents.send('pet:action',{slug,action});
    onAction({slug,action});return {ok:true,slug,action};
  }
  function openMenu(){
    const slug=meta?.id,selected=choices[slug]||null;
    const template=[{label:meta?.name||'桌宠',enabled:false},{label:'和它聊聊',click:()=>safely(()=>onOpen({chat:true}))},{type:'separator'},
      ...[...actionChoices(),[null,'恢复自动']].map(([id,label],index)=>({label,type:'radio',checked:selected===id,enabled:id===null||meta?.renderer==='vivi-gif'||meta?.frameMap?.[index]?.length!==0,click:()=>safely(()=>selectAction({slug,action:id}))})),
      {type:'separator'},{label:'打开 LifeOS',click:()=>safely(()=>onOpen({}))},{label:'桌宠设置',click:()=>safely(()=>onOpen({settings:true}))},{label:'隐藏桌宠',click:()=>safely(()=>setSettings({visible:false}))},{label:'退出 LifeOS',click:onQuit}];
    Menu.buildFromTemplate(template).popup({window:petWindow});
  }
  function onReady(){ready=true;error='';if(settings.mode==='desktop'&&settings.visible&&!stopped)petWindow?.showInactive();notify();}
  function onFailed(message){error=String(message||'桌宠图片加载失败').slice(0,300);if(!ready)petWindow?.hide();notify();}
  function dragStart(point){if(!petWindow||!Number.isFinite(point?.x)||!Number.isFinite(point?.y))return;const [x,y]=petWindow.getPosition();drag={x,y,screenX:point.x,screenY:point.y};}
  function dragMove(point){if(!drag||!Number.isFinite(point?.x)||!Number.isFinite(point?.y))return;const bounds=bounded({x:drag.x+point.x-drag.screenX,y:drag.y+point.y-drag.screenY});petWindow?.setPosition(bounds.x,bounds.y,false);}
  function dragEnd(){if(!drag||!petWindow)return;drag=null;const [x,y]=petWindow.getPosition();position={x,y};save(POSITION_KEY,position);}
  function moveCompanion(point){
    if(!petWindow||meta?.renderer!=='vivi-gif'||!Number.isFinite(point?.x)||!Number.isFinite(point?.y))return;
    const [x,y]=petWindow.getPosition(),area=screen.getDisplayNearestPoint({x,y}).workArea,size=dimensions();
    const minX=point.hiddenEdge?-size.width+24:0,maxX=point.hiddenEdge?area.width-24:area.width-size.width;
    petWindow.setPosition(Math.round(area.x+Math.max(minX,Math.min(maxX,point.x))),Math.round(area.y+Math.max(0,Math.min(area.height-size.height,point.y))),false);
  }
  function displayChanged(){if(petWindow&&!petWindow.isDestroyed()){const [x,y]=petWindow.getPosition();petWindow.setBounds(bounded({x,y}),false);safely(sendConfig)}}
  screen.on('display-removed',displayChanged);screen.on('display-metrics-changed',displayChanged);
  function stop(){stopped=true;sequence++;disposeWindow();destroyTray();screen.removeListener('display-removed',displayChanged);screen.removeListener('display-metrics-changed',displayChanged);}
  async function start(){if(settings.mode==='desktop'){ensureTray();await refresh()}return notify()}
  return {start,stop,snapshot,setSettings,refresh,selectAction,isSender,keepAlive,onReady,onFailed,openMenu,dragStart,dragMove,dragEnd,moveCompanion,sendEvent:event=>petWindow?.webContents.send('pet:event',event)};
}
module.exports={createPetController,normalizeSettings,DEFAULTS,SETTINGS_KEY};
