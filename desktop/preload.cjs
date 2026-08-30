const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('lifeosDesktop',{
  event:(type,detail)=>ipcRenderer.send('lifeos:event',{type,detail}),
  pet:(cmd)=>ipcRenderer.send('lifeos:pet',cmd),
  refreshPet:()=>ipcRenderer.send('lifeos:pet-reload'),
  onPetChat:(fn)=>{const h=()=>fn();ipcRenderer.on('lifeos:open-pet-chat',h);return()=>ipcRenderer.removeListener('lifeos:open-pet-chat',h)},
  windowControl:(action)=>ipcRenderer.invoke('lifeos:window-control',action),
  onUpdate:(fn)=>{const h=(_,v)=>fn(v);ipcRenderer.on('lifeos:update',h);return()=>ipcRenderer.removeListener('lifeos:update',h)},
  checkForUpdates:()=>ipcRenderer.invoke('lifeos:update-check'),
  downloadUpdate:()=>ipcRenderer.invoke('lifeos:update-download'),
  installUpdate:()=>ipcRenderer.invoke('lifeos:update-install'),
  platform:process.platform
});
