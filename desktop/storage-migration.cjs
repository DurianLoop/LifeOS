'use strict';
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const crypto=require('node:crypto');

async function recoverLegacyStorage({userData,store,BrowserWindow}){
  const directory=path.join(userData,'Local Storage','leveldb');
  if(!fs.existsSync(directory))return {recovered:0};
  const origins=new Set();
  for(const name of fs.readdirSync(directory)){
    if(!/\.(?:log|ldb)$/.test(name))continue;
    const file=path.join(directory,name);if(fs.statSync(file).size>64*1024*1024)continue;
    const text=fs.readFileSync(file).toString('latin1');
    for(const match of text.matchAll(/http:\/\/127\.0\.0\.1:(\d{1,5})(?!\d)/g)){
      const port=Number(match[1]);if(port>0&&port<=65535)origins.add('http://127.0.0.1:'+port);
    }
  }
  const migrated=new Set(store.read().migratedOrigins||[]);let recovered=0;
  for(const origin of origins){
    if(migrated.has(origin))continue;
    const route='/'+crypto.randomUUID(),server=http.createServer((req,res)=>{
      if(req.url!==route){res.writeHead(404);res.end();return}
      res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>LifeOS</title>');
    });
    let window;
    try{
      await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(Number(new URL(origin).port),'127.0.0.1',resolve)});
      window=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
      await window.loadURL(origin+route);
      const items=await window.webContents.executeJavaScript(`Object.fromEntries(Object.keys(localStorage).filter(k=>/^lifeos[.:]/.test(k)).map(k=>[k,localStorage.getItem(k)]))`);
      const folder=path.join(path.dirname(store.file),'recovered-browser-state');fs.mkdirSync(folder,{recursive:true});
      const archive=path.join(folder,crypto.createHash('sha256').update(origin).digest('hex').slice(0,16)+'.json');
      if(Object.keys(items).length)fs.writeFileSync(archive,JSON.stringify({origin,items}),{mode:0o600});
      store.operation({op:'import',items,origin});recovered+=Object.keys(items).filter(k=>k.startsWith('lifeos.writer.draft.')).length;
    }catch(error){
      // An occupied old port is retried next launch; never navigate its server.
      if(error.code!=='EADDRINUSE')throw error;
    }finally{window?.destroy();await new Promise(resolve=>server.listening?server.close(resolve):resolve())}
  }
  return {recovered};
}
module.exports={recoverLegacyStorage};
