'use strict';
const http=require('node:http');
function request(base,path,body){return new Promise((resolve,reject)=>{
  const data=body?JSON.stringify(body):null;
  const req=http.request(base+path,{method:data?'POST':'GET',headers:data?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(data)}:{}},res=>{
    let raw='';res.on('data',chunk=>{raw+=chunk;if(raw.length>2_000_000)req.destroy(new Error('Response too large'))});
    res.on('end',()=>{try{if(res.statusCode!==200)throw new Error('Reminder unavailable');resolve(JSON.parse(raw))}catch(error){reject(error)}});
  });req.setTimeout(10000,()=>req.destroy(new Error('Reminder timeout')));req.on('error',reject);req.end(data);
})}
function startBottleReminders({base,Notification,onOpen,requestJSON=request,interval=15000}){
  let busy=false,stopped=false;const notices=new Set(),shown=new Set(),pending=new Set();
  async function poll(){
    if(busy||stopped||!Notification?.isSupported())return;
    busy=true;
    try{
      const data=await requestJSON(base,'/api/bottles/arrivals');
      const ids=data.native_pending||[];
      if(stopped||!ids.length)return;
      const fresh=ids.filter(id=>!shown.has(id)&&!pending.has(id));
      if(!fresh.length){const confirmed=ids.filter(id=>shown.has(id));if(confirmed.length)await requestJSON(base,'/api/bottles/reminders/ack',{ids:confirmed.slice(0,100)});return}
      const batch=fresh.slice(0,100);
      const note=new Notification({title:'漂流瓶抵达了',body:batch.length===1?'过去的你，留了一份礼物':'有 '+batch.length+' 份来自过去的礼物',silent:false});
      notices.add(note);
      batch.forEach(id=>pending.add(id));
      note.on('click',()=>onOpen(batch[0]));note.on('close',()=>notices.delete(note));
      note.once('show',()=>{batch.forEach(id=>{shown.add(id);pending.delete(id)});requestJSON(base,'/api/bottles/reminders/ack',{ids:batch}).catch(()=>{})});
      note.once('failed',()=>{notices.delete(note);batch.forEach(id=>pending.delete(id))});note.show();
    }catch{ /* The next poll catches up after a temporary backend failure. */ }
    finally{busy=false}
  }
  const timer=setInterval(poll,interval);timer.unref?.();poll();
  return {poll,stop(){stopped=true;clearInterval(timer);notices.forEach(note=>note.close());notices.clear()}};
}
module.exports={startBottleReminders};
