'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const MAX_VALUE=4*1024*1024, MAX_TOTAL=32*1024*1024;
const allowed=key=>typeof key==='string'&&/^lifeos[.:][^\x00-\x1f]{1,240}$/.test(key);

function createStore(root){
  const file=path.join(root,'.lifeos','ui-state.json'),previous=file+'.previous';
  function read(){
    const decode=name=>{const data=JSON.parse(fs.readFileSync(name,'utf8'));if(data.format!==1||!data.items||typeof data.items!=='object'||Array.isArray(data.items))throw new Error('草稿存储格式损坏');for(const [key,value] of Object.entries(data.items))validate(key,value);data.migratedOrigins=Array.isArray(data.migratedOrigins)?data.migratedOrigins.filter(origin=>/^http:\/\/127\.0\.0\.1:\d{1,5}$/.test(origin)):[];data.removed=data.removed||{};return data};
    if(!fs.existsSync(file)&&!fs.existsSync(previous))return {format:1,items:{},migratedOrigins:[],removed:{}};
    try{return decode(file)}catch(error){
      if(!fs.existsSync(previous))throw new Error('无法读取本地草稿，请先保留工作区并恢复备份');
      const data=decode(previous);
      if(fs.existsSync(file))fs.copyFileSync(file,file+'.damaged-'+Date.now());
      fs.copyFileSync(previous,file);
      return data;
    }
  }
  function write(data){
    const text=JSON.stringify(data);
    if(Buffer.byteLength(text)>MAX_TOTAL)throw new Error('本地草稿空间已满，请保存或清理旧草稿');
    fs.mkdirSync(path.dirname(file),{recursive:true});
    const temporary=file+'.'+crypto.randomUUID()+'.tmp';let descriptor;
    try{
      descriptor=fs.openSync(temporary,'wx',0o600);fs.writeFileSync(descriptor,text,'utf8');fs.fsyncSync(descriptor);fs.closeSync(descriptor);descriptor=null;
      if(fs.existsSync(file))fs.copyFileSync(file,previous);
      fs.renameSync(temporary,file);
    }finally{if(descriptor!==null&&descriptor!==undefined)fs.closeSync(descriptor);if(fs.existsSync(temporary))fs.unlinkSync(temporary)}
  }
  function validate(key,value){if(!allowed(key)||typeof value!=='string'||Buffer.byteLength(value)>MAX_VALUE)throw new Error('本地存储内容无效或过长')}
  function operation(command){
    const data=read(),{op,key,value}=command||{};
    if(op==='snapshot')return {...data.items};
    if(op==='get'){if(!allowed(key))throw new Error('无效存储键');return data.items[key]??null}
    if(op==='set'){validate(key,value);data.items[key]=value;delete data.removed[key];write(data);return null}
    if(op==='remove'){if(!allowed(key))throw new Error('无效存储键');delete data.items[key];data.removed[key]=true;write(data);return null}
    if(op==='import'){
      if(!command.items||typeof command.items!=='object'||Array.isArray(command.items))throw new Error('无效迁移内容');
      for(const [k,v] of Object.entries(command.items)){
        if(!allowed(k))continue;validate(k,v);
        if(data.removed[k])continue;
        if(data.items[k]===undefined)data.items[k]=v;
        else if(k.startsWith('lifeos.writer.draft.')){
          try{if(Date.parse(JSON.parse(v).savedAt)>Date.parse(JSON.parse(data.items[k]).savedAt))data.items[k]=v}catch{}
        }
      }
      if(command.origin&&!data.migratedOrigins.includes(command.origin))data.migratedOrigins.push(command.origin);
      write(data);return {...data.items};
    }
    throw new Error('不支持的存储操作');
  }
  return {operation,file,read};
}
module.exports={createStore,allowed};
