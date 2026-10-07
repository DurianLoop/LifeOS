const {app,BrowserWindow,ipcMain,shell,Menu,dialog,Notification,Tray,nativeImage,screen}=require('electron');
const path=require('path');const fs=require('fs');
const runtime=require('./runtime.cjs');
const {createStore}=require('./workspace-store.cjs');
const {recoverLegacyStorage}=require('./storage-migration.cjs');
const {createCloseGuard}=require('./close-guard.cjs');
const {createUpdateController}=require('./update-controller.cjs');
const {startBottleReminders}=require('./bottle-reminders.cjs');
const {createPetController}=require('./pet-controller.cjs');
const {loadPetActions}=require('./shared-pet-actions.cjs');
const {CancellationToken}=require('builder-util-runtime');
const http=require('node:http');
let autoUpdater=null;try{autoUpdater=require('electron-updater').autoUpdater}catch{}
app.setName('LifeOS');
app.setPath('userData',path.join(app.getPath('appData'),'LifeOS'));
const paths=runtime.runtimePaths({isPackaged:app.isPackaged,resourcesPath:process.resourcesPath,desktopDir:__dirname,userData:app.getPath('userData')});
let backend=null,mainWindow=null,quitting=false,quitRequested=false,creating=null,opening=null,store=null,updates=null,closeGuard=null,reminders=null,pets=null,stopped=false;
let BACKEND_URL=process.env.LIFEOS_BACKEND_URL||'http://127.0.0.1:8787';

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
  backend=runtime.startBackend(launch,{...paths,port,onExit:error=>{if(error&&!quitting)startupFailure(error)}});
  await runtime.waitForServer(BACKEND_URL+'/api/health',{failure:backend.failure});
}
async function createMainWindow(){mainWindow=new BrowserWindow({width:1320,height:880,minWidth:900,minHeight:650,title:'LifeOS · Private Journal',backgroundColor:'#eee8ed',frame:false,show:false,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});const target=mainWindow;closeGuard=createCloseGuard({window:target,dialog,onCancelled:()=>{quitRequested=false}});target.on('close',closeGuard.onClose);target.once('ready-to-show',()=>target.show());target.on('closed',()=>{if(mainWindow===target){mainWindow=null;closeGuard=null}if(!quitting&&(quitRequested||!pets?.keepAlive()))app.quit()});target.webContents.setWindowOpenHandler(({url})=>{if(/^https?:/.test(url))shell.openExternal(url);return {action:'deny'}});const origin=new URL(BACKEND_URL).origin;const session=target.webContents.session;
if(session){session.setPermissionCheckHandler((contents,permission,requestingOrigin)=>contents===mainWindow?.webContents&&permission==='media'&&requestingOrigin===origin);session.setPermissionRequestHandler((contents,permission,callback,details)=>callback(contents===mainWindow?.webContents&&permission==='media'&&new URL(details.requestingUrl||'about:blank').origin===origin))}
await target.loadURL(BACKEND_URL);return target;}
async function openMain(options={}){
  if(quitting)return;
  if(!mainWindow||mainWindow.isDestroyed()){
    if(!opening)opening=createMainWindow().finally(()=>{opening=null});
    await opening;
  }
  if(mainWindow.isMinimized())mainWindow.restore();mainWindow.show();mainWindow.focus();
  if(options.chat||options.settings)mainWindow.webContents.send('lifeos:pet-open',{chat:options.chat===true,settings:options.settings===true});
  return {ok:true};
}
function fetchJSON(url){return new Promise((resolve,reject)=>{const req=http.get(url,res=>{let body='';res.setEncoding('utf8');res.on('data',chunk=>{body+=chunk;if(body.length>2*1024*1024)req.destroy(new Error('桌宠配置过大'))});res.on('end',()=>{try{if(res.statusCode!==200)throw new Error('桌宠服务暂不可用');resolve(JSON.parse(body))}catch(error){reject(error)}});res.on('error',reject)});req.setTimeout(10000,()=>req.destroy(new Error('桌宠服务响应超时')));req.on('error',reject)})}
function safetyBackup(){return new Promise((resolve,reject)=>{const body=JSON.stringify({reason:'pre-update safety backup',include_derived:false});const req=http.request(BACKEND_URL+'/api/backups/create',{method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}},res=>{let text='';res.on('data',chunk=>{text+=chunk});res.on('end',()=>{try{const value=JSON.parse(text);if(res.statusCode!==200||!value.backup_id)throw new Error();resolve(value)}catch{reject(new Error('安全备份未完成'))}});res.on('error',reject)});req.setTimeout(60000,()=>req.destroy(new Error('安全备份超时')));req.on('error',reject);req.end(body)})}
function setupAutoUpdate(){updates=createUpdateController({updater:autoUpdater,isPackaged:app.isPackaged,send:value=>mainWindow?.webContents.send('lifeos:update',value),prepare:()=>closeGuard?.prepare()??Promise.resolve(true),backup:safetyBackup,lock:()=>mainWindow?.webContents.executeJavaScript('document.body.inert=true'),unlock:()=>mainWindow?.webContents.executeJavaScript('document.body.inert=false'),install:()=>{quitRequested=true;closeGuard?.allow();setImmediate(()=>autoUpdater.quitAndInstall(false,true))},CancellationToken});if(autoUpdater&&app.isPackaged)setTimeout(()=>updates.check(),3500);}
function create(){if(creating)return creating;creating=(async()=>{store=createStore(paths.dataRoot);await recoverLegacyStorage({userData:app.getPath('userData'),store,BrowserWindow});await startBackend();pets=createPetController({BrowserWindow,Tray,Menu,nativeImage,screen,store,resourceRoot:paths.resourceRoot,desktopDir:__dirname,base:()=>BACKEND_URL,actions:loadPetActions(paths.resourceRoot),fetchJSON,onOpen:openMain,onQuit:()=>app.quit(),onSettings:value=>mainWindow?.webContents.send('lifeos:pet-settings',value),onAction:value=>mainWindow?.webContents.send('lifeos:pet-action',value)});await createMainWindow();await pets.start();setupAutoUpdate();reminders?.stop();reminders=startBottleReminders({base:BACKEND_URL,Notification,onOpen:async id=>{try{await openMain();mainWindow?.webContents.send('lifeos:bottle-arrival',id)}catch(error){startupFailure(error)}}})})();creating.finally(()=>{creating=null}).catch(()=>{});return creating;}

const gotLock=app.requestSingleInstanceLock();if(!gotLock){app.quit()}else{app.on('second-instance',()=>{if(creating)creating.then(()=>openMain()).catch(startupFailure);else openMain().catch(startupFailure)});app.whenReady().then(()=>{Menu.setApplicationMenu(null);return create()}).catch(startupFailure);}

ipcMain.handle('lifeos:window-control',(event,action)=>{const target=BrowserWindow.fromWebContents(event.sender);if(!target||target!==mainWindow)return {ok:false};if(action==='minimize')target.minimize();if(action==='toggle-maximize'){target.isMaximized()?target.unmaximize():target.maximize()}if(action==='close')target.close();return {ok:true,maximized:target.isMaximized()};});
const trusted=event=>mainWindow&&!mainWindow.isDestroyed()&&event.sender===mainWindow.webContents;
let restarting=false;
ipcMain.handle('lifeos:restart',async event=>{
  if(!trusted(event)||restarting)return {ok:false};
  if(process.env.LIFEOS_EXTERNAL_BACKEND==='1')return {ok:false,error:'请重启本机服务后重新打开 LifeOS'};
  restarting=true;
  try{
    if(!await closeGuard?.prepare()){restarting=false;return {ok:false,error:'草稿尚未保存，请保存后重试'};}
    closeGuard.allow();quitRequested=true;quitting=true;
    pets?.stop();reminders?.stop();
    const child=backend?.child;
    if(child&&child.exitCode===null&&child.signalCode===null){
      await new Promise(resolve=>{child.once('close',resolve);backend.stop()});
    }else backend?.stop();
    stopped=true;
    app.relaunch();setImmediate(()=>app.quit());
    return {ok:true};
  }catch{restarting=false;return {ok:false,error:'重启未完成，请关闭并重新打开 LifeOS'};}
});
ipcMain.on('lifeos:storage',(event,command)=>{try{if(!trusted(event)||!store)throw new Error('存储不可用');event.returnValue={ok:true,value:store.operation(command)}}catch(error){event.returnValue={ok:false,error:String(error.message||'本地存储不可用')}}});
for(const [channel,method] of [['check','check'],['download','download'],['cancel','cancel'],['install','install'],['status','snapshot']])ipcMain.handle('lifeos:update-'+channel,async event=>trusted(event)&&updates?updates[method]():{ok:false,error:'更新服务未就绪'});
const petTrusted=event=>trusted(event)||pets?.isSender(event.sender);
for(const [channel,method] of [['settings-get','snapshot'],['settings-set','setSettings'],['refresh','refresh'],['action','selectAction']])ipcMain.handle('lifeos:pet-'+channel,async(event,value)=>{if(!pets||!(method==='selectAction'?petTrusted(event):trusted(event)))return {ok:false,error:'桌宠服务未就绪'};try{return await pets[method](value)}catch(error){return {ok:false,error:String(error.message||'桌宠设置未保存')}}});
ipcMain.handle('lifeos:pet-open-main',async(event,value)=>petTrusted(event)?openMain(value||{}):{ok:false});
for(const [channel,method] of [['ready','onReady'],['failed','onFailed'],['menu','openMenu'],['drag-start','dragStart'],['drag-move','dragMove'],['drag-end','dragEnd'],['position','moveCompanion']])ipcMain.on('lifeos:pet-'+channel,(event,value)=>{if(pets?.isSender(event.sender))try{pets[method](value)}catch{}});
ipcMain.on('lifeos:pet-chat',event=>{if(pets?.isSender(event.sender))openMain({chat:true}).catch(startupFailure)});
ipcMain.on('lifeos:pet-action-complete',(event,value)=>{if(pets?.isSender(event.sender))pets.completeAction(value)});
ipcMain.on('lifeos:pet-event',(event,value)=>{if(petTrusted(event)&&typeof value?.type==='string'&&value.type.length<100)pets?.sendEvent({type:value.type,detail:value.detail})});
app.on('activate',()=>{if(creating)creating.then(()=>openMain()).catch(startupFailure);else openMain().catch(startupFailure)});
app.on('window-all-closed',()=>{if(!creating&&!quitting&&!pets?.keepAlive()&&process.platform!=='darwin')app.quit()});
app.on('before-quit',event=>{quitRequested=true;if(event&&mainWindow&&!mainWindow.isDestroyed()&&!closeGuard?.isAllowed()){event.preventDefault();mainWindow.close();return}quitting=true;if(stopped)return;stopped=true;pets?.stop();reminders?.stop();try{backend?.stop()}catch{}});
