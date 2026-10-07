const {contextBridge,ipcRenderer}=require('electron');
const pending=new Map(),sent=new Map();let positionFrame=null;
function flushPositions(){
  if(positionFrame!==null)cancelAnimationFrame(positionFrame);positionFrame=null;
  for(const [channel,point] of pending){const key=point.x+','+point.y+','+(point.hiddenEdge||'');if(sent.get(channel)!==key){ipcRenderer.send(channel,point);sent.set(channel,key)}}pending.clear();
}
function queuePosition(channel,point){
  if(!Number.isFinite(point?.x)||!Number.isFinite(point?.y))return;
  const next={x:Math.round(point.x),y:Math.round(point.y),hiddenEdge:point.hiddenEdge||null},key=next.x+','+next.y+','+(next.hiddenEdge||'');
  if(!pending.has(channel)&&sent.get(channel)===key)return;
  pending.set(channel,next);if(positionFrame===null)positionFrame=requestAnimationFrame(flushPositions);
}
function resetPositions(){if(positionFrame!==null)cancelAnimationFrame(positionFrame);positionFrame=null;pending.clear();sent.clear();}

contextBridge.exposeInMainWorld('lifeosPet',{
  event:(type,detail)=>ipcRenderer.send('lifeos:pet-event',{type,detail}),
  dragStart:point=>{flushPositions();ipcRenderer.send('lifeos:pet-drag-start',point)},
  dragMove:point=>queuePosition('lifeos:pet-drag-move',point),
  dragEnd:()=>{flushPositions();ipcRenderer.send('lifeos:pet-drag-end')},
  position:point=>queuePosition('lifeos:pet-position',point),
  openMenu:()=>ipcRenderer.send('lifeos:pet-menu'),
  openChat:()=>ipcRenderer.send('lifeos:pet-chat'),
  ready:()=>ipcRenderer.send('lifeos:pet-ready'),
  failed:message=>ipcRenderer.send('lifeos:pet-failed',String(message).slice(0,300)),
  selectAction:value=>ipcRenderer.invoke('lifeos:pet-action',value),
  actionComplete:value=>ipcRenderer.send('lifeos:pet-action-complete',value),
  onAction:fn=>{const h=(_,value)=>fn(value);ipcRenderer.on('pet:action',h);return()=>ipcRenderer.removeListener('pet:action',h)},
  onConfig:fn=>{const handler=(_,pet)=>{resetPositions();fn(pet)};ipcRenderer.on('pet:config',handler);return()=>ipcRenderer.removeListener('pet:config',handler)},
  onSettings:fn=>{const handler=(_,settings)=>fn(settings);ipcRenderer.on('pet:settings',handler);return()=>ipcRenderer.removeListener('pet:settings',handler)},
  onEvent:fn=>{const handler=(_,event)=>fn(event);ipcRenderer.on('pet:event',handler);return()=>ipcRenderer.removeListener('pet:event',handler)}
});
