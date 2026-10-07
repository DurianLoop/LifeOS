const {contextBridge,ipcRenderer}=require('electron');

contextBridge.exposeInMainWorld('lifeosPet',{
  event:(type,detail)=>ipcRenderer.send('lifeos:pet-event',{type,detail}),
  dragStart:point=>ipcRenderer.send('lifeos:pet-drag-start',point),
  dragMove:point=>ipcRenderer.send('lifeos:pet-drag-move',point),
  dragEnd:()=>ipcRenderer.send('lifeos:pet-drag-end'),
  position:point=>ipcRenderer.send('lifeos:pet-position',point),
  openMenu:()=>ipcRenderer.send('lifeos:pet-menu'),
  openChat:()=>ipcRenderer.send('lifeos:pet-chat'),
  ready:()=>ipcRenderer.send('lifeos:pet-ready'),
  failed:message=>ipcRenderer.send('lifeos:pet-failed',String(message).slice(0,300)),
  selectAction:value=>ipcRenderer.invoke('lifeos:pet-action',value),
  onAction:fn=>{const h=(_,value)=>fn(value);ipcRenderer.on('pet:action',h);return()=>ipcRenderer.removeListener('pet:action',h)},
  onConfig:fn=>{const handler=(_,pet)=>fn(pet);ipcRenderer.on('pet:config',handler);return()=>ipcRenderer.removeListener('pet:config',handler)},
  onEvent:fn=>{const handler=(_,event)=>fn(event);ipcRenderer.on('pet:event',handler);return()=>ipcRenderer.removeListener('pet:event',handler)}
});
