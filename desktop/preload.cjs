const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('lifeosDesktop',{
  windowControl:(action)=>ipcRenderer.invoke('lifeos:window-control',action),
  onUpdate:(fn)=>{const h=(_,v)=>fn(v);ipcRenderer.on('lifeos:update',h);return()=>ipcRenderer.removeListener('lifeos:update',h)},
  checkForUpdates:()=>ipcRenderer.invoke('lifeos:update-check'),
  downloadUpdate:()=>ipcRenderer.invoke('lifeos:update-download'),
  installUpdate:()=>ipcRenderer.invoke('lifeos:update-install'),
  platform:process.platform
});
