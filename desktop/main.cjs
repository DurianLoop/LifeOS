const {app,BrowserWindow,ipcMain,shell,Menu,dialog,Notification}=require('electron');
const path=require('path');const fs=require('fs');
const runtime=require('./runtime.cjs');
const {createStore}=require('./workspace-store.cjs');
const {recoverLegacyStorage}=require('./storage-migration.cjs');
const {createCloseGuard}=require('./close-guard.cjs');
const {createUpdateController}=require('./update-controller.cjs');
const {startBottleReminders}=require('./bottle-reminders.cjs');
const {CancellationToken}=require('builder-util-runtime');
const http=require('node:http');
let autoUpdater=null;try{autoUpdater=require('electron-updater').autoUpdater}catch{}
app.setName('LifeOS');
app.setPath('userData',path.join(app.getPath('appData'),'LifeOS'));
const paths=runtime.runtimePaths({isPackaged:app.isPackaged,resourcesPath:process.resourcesPath,desktopDir:__dirname,userData:app.getPath('userData')});
let backend=null,mainWindow=null,quitting=false,creating=null,store=null,updates=null,closeGuard=null,reminders=null;
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
  backend=runtime.startBackend(launch,{...paths,port,onExit:error=>{if(error&&!quitting&&mainWindow&&!mainWindow.isDestroyed())startupFailure(error)}});
  await runtime.waitForServer(BACKEND_URL+'/api/health',{failure:backend.failure});
}
async function createMainWindow(){mainWindow=new BrowserWindow({width:1320,height:880,minWidth:900,minHeight:650,title:'LifeOS · Private Journal',backgroundColor:'#eee8ed',frame:false,show:false,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});closeGuard=createCloseGuard({window:mainWindow,dialog});mainWindow.on('close',closeGuard.onClose);mainWindow.once('ready-to-show',()=>mainWindow?.show());mainWindow.on('closed',()=>{mainWindow=null;if(!quitting)app.quit()});mainWindow.webContents.setWindowOpenHandler(({url})=>{if(/^https?:/.test(url))shell.openExternal(url);return {action:'deny'}});const origin=new URL(BACKEND_URL).origin;const session=mainWindow.webContents.session;
if(session){session.setPermissionCheckHandler((contents,permission,requestingOrigin)=>contents===mainWindow?.webContents&&permission==='media'&&requestingOrigin===origin);session.setPermissionRequestHandler((contents,permission,callback,details)=>callback(contents===mainWindow?.webContents&&permission==='media'&&new URL(details.requestingUrl||'about:blank').origin===origin))}
await mainWindow.loadURL(BACKEND_URL);}
function safetyBackup(){return new Promise((resolve,reject)=>{const body=JSON.stringify({reason:'pre-update safety backup',include_derived:false});const req=http.request(BACKEND_URL+'/api/backups/create',{method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}},res=>{let text='';res.on('data',chunk=>{text+=chunk});res.on('end',()=>{try{const value=JSON.parse(text);if(res.statusCode!==200||!value.backup_id)throw new Error();resolve(value)}catch{reject(new Error('安全备份未完成'))}});res.on('error',reject)});req.setTimeout(60000,()=>req.destroy(new Error('安全备份超时')));req.on('error',reject);req.end(body)})}
function setupAutoUpdate(){updates=createUpdateController({updater:autoUpdater,isPackaged:app.isPackaged,send:value=>mainWindow?.webContents.send('lifeos:update',value),prepare:()=>closeGuard.prepare(),backup:safetyBackup,lock:()=>mainWindow.webContents.executeJavaScript('document.body.inert=true'),unlock:()=>mainWindow.webContents.executeJavaScript('document.body.inert=false'),install:()=>{closeGuard.allow();setImmediate(()=>autoUpdater.quitAndInstall(false,true))},CancellationToken});if(autoUpdater&&app.isPackaged)setTimeout(()=>updates.check(),3500);}
function create(){if(creating)return creating;creating=(async()=>{store=createStore(paths.dataRoot);await recoverLegacyStorage({userData:app.getPath('userData'),store,BrowserWindow});await startBackend();await createMainWindow();setupAutoUpdate();reminders?.stop();reminders=startBottleReminders({base:BACKEND_URL,Notification,onOpen:id=>{if(!mainWindow||mainWindow.isDestroyed())return;if(mainWindow.isMinimized())mainWindow.restore();mainWindow.show();mainWindow.focus();mainWindow.webContents.send('lifeos:bottle-arrival',id)}})})();creating.finally(()=>{creating=null}).catch(()=>{});return creating;}

const gotLock=app.requestSingleInstanceLock();if(!gotLock){app.quit()}else{app.on('second-instance',()=>{if(mainWindow){if(mainWindow.isMinimized())mainWindow.restore();mainWindow.show();mainWindow.focus()}});app.whenReady().then(()=>{Menu.setApplicationMenu(null);return create()}).catch(startupFailure);}

ipcMain.handle('lifeos:window-control',(event,action)=>{const target=BrowserWindow.fromWebContents(event.sender);if(!target||target!==mainWindow)return {ok:false};if(action==='minimize')target.minimize();if(action==='toggle-maximize'){target.isMaximized()?target.unmaximize():target.maximize()}if(action==='close')target.close();return {ok:true,maximized:target.isMaximized()};});
const trusted=event=>mainWindow&&!mainWindow.isDestroyed()&&event.sender===mainWindow.webContents;
ipcMain.on('lifeos:storage',(event,command)=>{try{if(!trusted(event)||!store)throw new Error('存储不可用');event.returnValue={ok:true,value:store.operation(command)}}catch(error){event.returnValue={ok:false,error:String(error.message||'本地存储不可用')}}});
for(const [channel,method] of [['check','check'],['download','download'],['cancel','cancel'],['install','install'],['status','snapshot']])ipcMain.handle('lifeos:update-'+channel,async event=>trusted(event)&&updates?updates[method]():{ok:false,error:'更新服务未就绪'});
app.on('activate',()=>{if(!mainWindow)create().catch(startupFailure);else mainWindow.show()});
app.on('window-all-closed',()=>{if(!creating&&process.platform!=='darwin')app.quit()});
app.on('before-quit',event=>{if(event&&mainWindow&&!mainWindow.isDestroyed()&&!closeGuard?.isAllowed()){event.preventDefault();mainWindow.close();return}quitting=true;reminders?.stop();try{backend?.stop()}catch{}});
