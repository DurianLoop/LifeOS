const {app,BrowserWindow,ipcMain,screen,shell,Menu,dialog}=require('electron');
const path=require('path');const {pathToFileURL}=require('url');const fs=require('fs');const os=require('os');const http=require('http');
const runtime=require('./runtime.cjs');
let autoUpdater=null;try{autoUpdater=require('electron-updater').autoUpdater}catch{}
app.setName('LifeOS');
app.setPath('userData',path.join(app.getPath('appData'),'LifeOS'));
const paths=runtime.runtimePaths({isPackaged:app.isPackaged,resourcesPath:process.resourcesPath,desktopDir:__dirname,userData:app.getPath('userData')});
const ROOT=paths.resourceRoot;let backend=null,mainWindow=null,petWindow=null,petDrag=null,quitting=false,creating=null;
let BACKEND_URL=process.env.LIFEOS_BACKEND_URL||'http://127.0.0.1:8787';
const DENSE_FEATURES=new Set(['Memory Graph','Analytics','Topology Atlas','Footprint Atlas','Lineage Atlas','Trajectory Observatory']);
const PET_ALLOWED_DETAIL=new Set(['feature','title','count','status','kind','date','reason','conflicts','source']);
const PET_BLOCKED_KEYS=/content|body|text|excerpt|markdown|evidence|answer|question|prompt|raw|sections/i;

function startupFailure(error){
  if(quitting)return;
  const message=String(error?.stack||error);
  try{fs.mkdirSync(path.dirname(paths.logFile),{recursive:true});fs.appendFileSync(paths.logFile,`\n[${new Date().toISOString()}] ${message}\n`)}catch{}
  dialog.showErrorBox('LifeOS 无法启动',`本地服务无法启动或已停止。\n\n${String(error?.message||error).slice(-3000)}\n\n诊断日志：${paths.logFile}\n日记目录：${paths.dataRoot}\n\n重新安装不会覆盖上述日记目录。`);
  app.quit();
}
async function startBackend(){
  if(process.env.LIFEOS_EXTERNAL_BACKEND==='1'){await runtime.waitForServer(BACKEND_URL+'/api/health');return}
  if(backend)return;
  runtime.prepareWorkspace(paths);
  const port=await runtime.availablePort(process.env.LIFEOS_PORT||0);
  BACKEND_URL=`http://127.0.0.1:${port}`;
  const launch=runtime.backendLaunch({...paths,isPackaged:app.isPackaged});
  backend=runtime.startBackend(launch,{...paths,port,onExit:error=>{if(error&&!quitting&&mainWindow&&!mainWindow.isDestroyed())startupFailure(error)}});
  await runtime.waitForServer(BACKEND_URL+'/api/health',{failure:backend.failure});
}
function petRoots(){return [path.join(paths.dataRoot,'app','assets','pets'),path.join(ROOT,'app','assets','pets'),path.join(os.homedir(),'.codex','pets'),path.join(ROOT,'pets')].filter((p,index,items)=>items.indexOf(p)===index&&fs.existsSync(p));}
function findPets(){const out=[];for(const base of petRoots()){for(const ent of fs.readdirSync(base,{withFileTypes:true})){if(!ent.isDirectory())continue;const dir=path.join(base,ent.name),meta=path.join(dir,'pet.json'),sprite=path.join(dir,'spritesheet.webp');if(fs.existsSync(meta)&&fs.existsSync(sprite)){try{const j=JSON.parse(fs.readFileSync(meta,'utf8'));out.push({id:j.id||ent.name,name:j.displayName||j.name||ent.name,version:Number(j.spriteVersionNumber||1),sprite});}catch{}}}}return out;}
function activePet(){return new Promise(resolve=>{const request=http.get(BACKEND_URL+'/api/pets/desktop',r=>{let raw='';r.on('data',c=>raw+=c);r.on('end',()=>{try{resolve(JSON.parse(raw).pet||null)}catch{resolve(null)}})});request.setTimeout(3000,()=>request.destroy());request.on('error',()=>resolve(null));});}
async function loadPetWindow(){const pet=await activePet()||findPets()[0]||null;const viewPet=pet?{...pet,sprite:pathToFileURL(pet.sprite).href}:null;const q=encodeURIComponent(JSON.stringify(viewPet));if(petWindow&&!petWindow.isDestroyed())return petWindow.loadFile(path.join(__dirname,'pet.html'),{query:{pet:q}});}
async function createPet(){const area=screen.getPrimaryDisplay().workArea;petWindow=new BrowserWindow({width:192,height:208,x:area.x+area.width-220,y:area.y+area.height-236,transparent:true,frame:false,alwaysOnTop:true,skipTaskbar:true,resizable:false,hasShadow:false,show:true,webPreferences:{contextIsolation:true,sandbox:true,preload:path.join(__dirname,'pet-preload.cjs')}});petWindow.setIgnoreMouseEvents(false);await loadPetWindow();}
function sanitizePetEvent(evt){if(!evt||typeof evt!=='object')return {type:'idle'};const type=String(evt.type||'idle').slice(0,80);const detail={};const src=(evt.detail&&typeof evt.detail==='object')?evt.detail:{};for(const [k,v] of Object.entries(src)){if(PET_BLOCKED_KEYS.test(k)||!PET_ALLOWED_DETAIL.has(k))continue;if(['string','number','boolean'].includes(typeof v))detail[k]=typeof v==='string'?v.slice(0,160):v;}return {type,detail};}
function routePetEvent(evt){const clean=sanitizePetEvent(evt);if(clean.type==='navigate'){
  const f=clean.detail.feature;if(DENSE_FEATURES.has(f)){petWindow?.hide()}else if(petWindow&&!petWindow.isDestroyed()){petWindow.showInactive()}
 }
 if(petWindow&&!petWindow.isDestroyed())petWindow.webContents.send('pet:event',clean);
}
async function createMainWindow(){mainWindow=new BrowserWindow({width:1320,height:880,minWidth:900,minHeight:650,title:'LifeOS · Private Journal',backgroundColor:'#eee8ed',frame:false,show:false,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});mainWindow.once('ready-to-show',()=>mainWindow?.show());mainWindow.on('closed',()=>{mainWindow=null;if(!quitting)app.quit()});mainWindow.webContents.setWindowOpenHandler(({url})=>{if(/^https?:/.test(url))shell.openExternal(url);return {action:'deny'}});await mainWindow.loadURL(BACKEND_URL);}
function setupAutoUpdate(){if(!autoUpdater||!app.isPackaged)return;autoUpdater.autoDownload=false;autoUpdater.on('checking-for-update',()=>mainWindow?.webContents.send('lifeos:update',{status:'checking'}));autoUpdater.on('update-available',info=>mainWindow?.webContents.send('lifeos:update',{status:'available',version:info.version}));autoUpdater.on('update-not-available',()=>mainWindow?.webContents.send('lifeos:update',{status:'current'}));autoUpdater.on('download-progress',p=>mainWindow?.webContents.send('lifeos:update',{status:'downloading',percent:Math.round(p.percent||0)}));autoUpdater.on('update-downloaded',info=>mainWindow?.webContents.send('lifeos:update',{status:'ready',version:info.version}));autoUpdater.on('error',e=>mainWindow?.webContents.send('lifeos:update',{status:'error',message:String(e.message||e)}));setTimeout(()=>autoUpdater.checkForUpdates().catch(()=>{}),3500);}
function create(){if(creating)return creating;creating=(async()=>{await startBackend();await createMainWindow();try{await createPet()}catch(error){console.error('Desktop pet could not open:',error)}setupAutoUpdate()})();creating.finally(()=>{creating=null}).catch(()=>{});return creating;}

const gotLock=app.requestSingleInstanceLock();if(!gotLock){app.quit()}else{app.on('second-instance',()=>{if(mainWindow){if(mainWindow.isMinimized())mainWindow.restore();mainWindow.show();mainWindow.focus()}});app.whenReady().then(()=>{Menu.setApplicationMenu(null);return create()}).catch(startupFailure);}

ipcMain.on('lifeos:event',(_,evt)=>routePetEvent(evt));
ipcMain.on('lifeos:pet',(_,cmd)=>routePetEvent({type:String(cmd||'idle')}));
ipcMain.on('lifeos:pet-reload',()=>loadPetWindow().catch(()=>{}));
function openPetChat(){if(mainWindow&&!mainWindow.isDestroyed()){mainWindow.show();mainWindow.focus();mainWindow.webContents.send('lifeos:open-pet-chat')}}
ipcMain.on('lifeos:pet-chat',event=>{if(!petWindow||event.sender!==petWindow.webContents)return;openPetChat()});
ipcMain.on('lifeos:pet-menu',event=>{if(!petWindow||event.sender!==petWindow.webContents)return;Menu.buildFromTemplate([{label:'和它聊聊',click:openPetChat},{label:'挥挥手',click:()=>routePetEvent({type:'pet-action',detail:{state:'waving'}})}]).popup({window:petWindow})});
ipcMain.on('lifeos:pet-drag-start',(event,point)=>{if(!petWindow||event.sender!==petWindow.webContents||!point)return;const x=Number(point.x),y=Number(point.y);if(!Number.isFinite(x)||!Number.isFinite(y))return;const [left,top]=petWindow.getPosition();petDrag={x,y,left,top,direction:'right'};routePetEvent({type:'pet-drag',detail:{direction:'right'}});});
ipcMain.on('lifeos:pet-drag-move',(event,point)=>{if(!petWindow||event.sender!==petWindow.webContents||!petDrag||!point)return;const x=Number(point.x),y=Number(point.y);if(!Number.isFinite(x)||!Number.isFinite(y))return;const dx=x-petDrag.x,dy=y-petDrag.y;if(Math.abs(dx)+Math.abs(dy)<1)return;const direction=dx<0?'left':'right';petWindow.setPosition(Math.round(petDrag.left+dx),Math.round(petDrag.top+dy));if(direction!==petDrag.direction){petDrag.direction=direction;routePetEvent({type:'pet-drag',detail:{direction}});}});
ipcMain.on('lifeos:pet-drag-end',event=>{if(!petWindow||event.sender!==petWindow.webContents)return;petDrag=null;routePetEvent({type:'pet-drag-end'});});
ipcMain.handle('lifeos:window-control',(event,action)=>{const target=BrowserWindow.fromWebContents(event.sender);if(!target||target!==mainWindow)return {ok:false};if(action==='minimize')target.minimize();if(action==='toggle-maximize'){target.isMaximized()?target.unmaximize():target.maximize()}if(action==='close')target.close();return {ok:true,maximized:target.isMaximized()};});
ipcMain.handle('lifeos:update-check',async()=>{if(!autoUpdater||!app.isPackaged)return {ok:false,reason:'updates only run in packaged builds'};try{const r=await autoUpdater.checkForUpdates();return {ok:true,version:r?.updateInfo?.version}}catch(e){return {ok:false,error:String(e.message||e)}}});
ipcMain.handle('lifeos:update-download',async()=>{if(!autoUpdater)return {ok:false};try{await autoUpdater.downloadUpdate();return {ok:true}}catch(e){return {ok:false,error:String(e.message||e)}}});
ipcMain.handle('lifeos:update-install',async()=>{if(!autoUpdater)return {ok:false};setImmediate(()=>autoUpdater.quitAndInstall(false,true));return {ok:true}});
app.on('activate',()=>{if(!mainWindow)create().catch(startupFailure);else mainWindow.show()});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit()});
app.on('before-quit',()=>{quitting=true;try{backend?.stop()}catch{}});
