const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('lifeosDesktop',{
  windowControl:(action)=>ipcRenderer.invoke('lifeos:window-control',action),
  onBottleArrival:(fn)=>{const h=(_,id)=>fn(id);ipcRenderer.on('lifeos:bottle-arrival',h);return()=>ipcRenderer.removeListener('lifeos:bottle-arrival',h)},
  onUpdate:(fn)=>{const h=(_,v)=>fn(v);ipcRenderer.on('lifeos:update',h);return()=>ipcRenderer.removeListener('lifeos:update',h)},
  checkForUpdates:()=>ipcRenderer.invoke('lifeos:update-check'),
  downloadUpdate:()=>ipcRenderer.invoke('lifeos:update-download'),
  installUpdate:()=>ipcRenderer.invoke('lifeos:update-install'),
  cancelUpdate:()=>ipcRenderer.invoke('lifeos:update-cancel'),
  updateStatus:()=>ipcRenderer.invoke('lifeos:update-status'),
  storage:command=>ipcRenderer.sendSync('lifeos:storage',command),
  platform:process.platform
});
