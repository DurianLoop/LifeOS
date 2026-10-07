const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('lifeosDesktop',{
  windowControl:(action)=>ipcRenderer.invoke('lifeos:window-control',action),
  petGetSettings:()=>ipcRenderer.invoke('lifeos:pet-settings-get'),
  petSetSettings:patch=>ipcRenderer.invoke('lifeos:pet-settings-set',patch),
  petRefresh:()=>ipcRenderer.invoke('lifeos:pet-refresh'),
  petAction:value=>ipcRenderer.invoke('lifeos:pet-action',value),
  petOpenMain:options=>ipcRenderer.invoke('lifeos:pet-open-main',options),
  onPetSettings:fn=>{const h=(_,value)=>fn(value);ipcRenderer.on('lifeos:pet-settings',h);return()=>ipcRenderer.removeListener('lifeos:pet-settings',h)},
  onPetAction:fn=>{const h=(_,value)=>fn(value);ipcRenderer.on('lifeos:pet-action',h);return()=>ipcRenderer.removeListener('lifeos:pet-action',h)},
  onPetOpen:fn=>{const h=(_,value)=>fn(value);ipcRenderer.on('lifeos:pet-open',h);return()=>ipcRenderer.removeListener('lifeos:pet-open',h)},
  petEvent:value=>ipcRenderer.send('lifeos:pet-event',value),
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
