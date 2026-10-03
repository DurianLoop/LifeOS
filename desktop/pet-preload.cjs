const {contextBridge,ipcRenderer}=require('electron');

contextBridge.exposeInMainWorld('lifeosPet',{
  event:(type,detail)=>ipcRenderer.send('lifeos:event',{type,detail}),
  dragStart:point=>ipcRenderer.send('lifeos:pet-drag-start',point),
  dragMove:point=>ipcRenderer.send('lifeos:pet-drag-move',point),
  dragEnd:()=>ipcRenderer.send('lifeos:pet-drag-end'),
  openMenu:()=>ipcRenderer.send('lifeos:pet-menu'),
  openChat:()=>ipcRenderer.send('lifeos:pet-chat'),
  ready:()=>ipcRenderer.send('lifeos:pet-ready'),
  onConfig:fn=>{const handler=(_,pet)=>fn(pet);ipcRenderer.on('pet:config',handler);return()=>ipcRenderer.removeListener('pet:config',handler)},
  onEvent:fn=>{const handler=(_,event)=>fn(event);ipcRenderer.on('pet:event',handler);return()=>ipcRenderer.removeListener('pet:event',handler)}
});
