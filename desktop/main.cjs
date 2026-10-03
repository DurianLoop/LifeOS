const {app,BrowserWindow,ipcMain,shell,Menu,dialog}=require('electron');
const path=require('path');const fs=require('fs');
const runtime=require('./runtime.cjs');
let autoUpdater=null;try{autoUpdater=require('electron-updater').autoUpdater}catch{}
app.setName('LifeOS');
app.setPath('userData',path.join(app.getPath('appData'),'LifeOS'));
const paths=runtime.runtimePaths({isPackaged:app.isPackaged,resourcesPath:process.resourcesPath,desktopDir:__dirname,userData:app.getPath('userData')});
let backend=null,mainWindow=null,quitting=false,creating=null;
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
async function createMainWindow(){mainWindow=new BrowserWindow({width:1320,height:880,minWidth:900,minHeight:650,title:'LifeOS · Private Journal',backgroundColor:'#eee8ed',frame:false,show:false,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});mainWindow.once('ready-to-show',()=>mainWindow?.show());mainWindow.on('closed',()=>{mainWindow=null;if(!quitting)app.quit()});mainWindow.webContents.setWindowOpenHandler(({url})=>{if(/^https?:/.test(url))shell.openExternal(url);return {action:'deny'}});await mainWindow.loadURL(BACKEND_URL);}
function setupAutoUpdate(){if(!autoUpdater||!app.isPackaged)return;autoUpdater.autoDownload=false;autoUpdater.on('checking-for-update',()=>mainWindow?.webContents.send('lifeos:update',{status:'checking'}));autoUpdater.on('update-available',info=>mainWindow?.webContents.send('lifeos:update',{status:'available',version:info.version}));autoUpdater.on('update-not-available',()=>mainWindow?.webContents.send('lifeos:update',{status:'current'}));autoUpdater.on('download-progress',p=>mainWindow?.webContents.send('lifeos:update',{status:'downloading',percent:Math.round(p.percent||0)}));autoUpdater.on('update-downloaded',info=>mainWindow?.webContents.send('lifeos:update',{status:'ready',version:info.version}));autoUpdater.on('error',e=>mainWindow?.webContents.send('lifeos:update',{status:'error',message:String(e.message||e)}));setTimeout(()=>autoUpdater.checkForUpdates().catch(()=>{}),3500);}
function create(){if(creating)return creating;creating=(async()=>{await startBackend();await createMainWindow();setupAutoUpdate()})();creating.finally(()=>{creating=null}).catch(()=>{});return creating;}

const gotLock=app.requestSingleInstanceLock();if(!gotLock){app.quit()}else{app.on('second-instance',()=>{if(mainWindow){if(mainWindow.isMinimized())mainWindow.restore();mainWindow.show();mainWindow.focus()}});app.whenReady().then(()=>{Menu.setApplicationMenu(null);return create()}).catch(startupFailure);}

ipcMain.handle('lifeos:window-control',(event,action)=>{const target=BrowserWindow.fromWebContents(event.sender);if(!target||target!==mainWindow)return {ok:false};if(action==='minimize')target.minimize();if(action==='toggle-maximize'){target.isMaximized()?target.unmaximize():target.maximize()}if(action==='close')target.close();return {ok:true,maximized:target.isMaximized()};});
ipcMain.handle('lifeos:update-check',async()=>{if(!autoUpdater||!app.isPackaged)return {ok:false,reason:'updates only run in packaged builds'};try{const r=await autoUpdater.checkForUpdates();return {ok:true,version:r?.updateInfo?.version}}catch(e){return {ok:false,error:String(e.message||e)}}});
ipcMain.handle('lifeos:update-download',async()=>{if(!autoUpdater)return {ok:false};try{await autoUpdater.downloadUpdate();return {ok:true}}catch(e){return {ok:false,error:String(e.message||e)}}});
ipcMain.handle('lifeos:update-install',async()=>{if(!autoUpdater)return {ok:false};setImmediate(()=>autoUpdater.quitAndInstall(false,true));return {ok:true}});
app.on('activate',()=>{if(!mainWindow)create().catch(startupFailure);else mainWindow.show()});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit()});
app.on('before-quit',()=>{quitting=true;try{backend?.stop()}catch{}});
