import {normalizeEntry,validateId,createId,identity,stamp,nextTimestamp,MAX,fail,validateBottle,bottleState} from './domain.js';

// Preserve the v0.1 database and its object stores. Upgrade in one IDB transaction.
const DB='lifeos-mobile', VERSION=2;
let opening, queue=Promise.resolve();
const changed=()=>{globalThis.dispatchEvent?.(new Event('lifeos:workspace'));};
function explain(error){
  if(error?.name==='QuotaExceededError')return Error('设备空间不足，未完成保存。请保留当前文字，导出备份后释放空间再试。');
  if(['SecurityError','InvalidStateError'].includes(error?.name))return Error('本机存储不可用，请使用普通浏览模式。当前内容尚未保存。');
  return error;
}
export function openWorkspace(){
  if(!opening)opening=new Promise((resolve,reject)=>{
    if(!globalThis.indexedDB)return reject(Error('当前浏览器不支持本机数据库，请使用最新版 Safari 或 Chrome。'));
    const request=indexedDB.open(DB,VERSION);let blocked=false;
    request.onupgradeneeded=()=>{
      const db=request.result,tx=request.transaction;
      if(!db.objectStoreNames.contains('entries'))db.createObjectStore('entries',{keyPath:'id'});
      if(!db.objectStoreNames.contains('meta'))db.createObjectStore('meta',{keyPath:'key'});
      for(const name of ['assets','items','drafts'])if(!db.objectStoreNames.contains(name))db.createObjectStore(name,{keyPath:'id'});
      const legacy=tx.objectStore('meta').get('draft');
      legacy.onsuccess=()=>{if(legacy.result?.value){const d=legacy.result.value;tx.objectStore('drafts').put({...d,id:d.id||createId(),kind:'daily',attachments:[],tags:[],migrated:true});}};
    };
    request.onblocked=()=>{blocked=true;reject(Error('旧版 LifeOS 页面仍在使用数据库。请收笔并关闭其他 LifeOS 标签页，再刷新这里；旧记录会保留。'));};
    request.onerror=()=>reject(explain(request.error));
    request.onsuccess=()=>{const db=request.result;if(blocked){db.close();return;}db.onversionchange=()=>{db.close();opening=null;window.dispatchEvent(new Event('lifeos:store-version'));};db.onclose=()=>{opening=null;};resolve(db);};
  }).catch(e=>{opening=null;throw explain(e);});return opening;
}
function serial(operation){const result=queue.then(operation);queue=result.catch(()=>{});return result.then(value=>{changed();return value;});}
async function transact(names,mode,operation){
  const db=await openWorkspace();return new Promise((resolve,reject)=>{
    let result,failure;const tx=db.transaction(names,mode);
    tx.oncomplete=()=>resolve(result);tx.onabort=()=>reject(explain(failure||tx.error));tx.onerror=()=>{failure||=tx.error;};
    const take=(request,callback)=>{request.onsuccess=()=>{try{callback(request.result);}catch(e){failure=e;tx.abort();}};request.onerror=()=>{failure||=request.error;};};
    try{operation(tx,take,value=>{result=value;});}catch(e){failure=e;tx.abort();}
  });
}
function version(current,expected){if(expected!==undefined&&(current?.updatedAt||null)!==expected)fail('另一页面已修改这份内容。你的草稿仍保留，请先阅读最新记录，再决定如何合并。');}
export async function all(name){await queue;return transact([name],'readonly',(tx,take,done)=>take(tx.objectStore(name).getAll(),done));}
export async function get(name,id){await queue;return transact([name],'readonly',(tx,take,done)=>take(tx.objectStore(name).get(id),r=>done(r||null)));}
export const getMeta=async(key,fallback=null)=>(await get('meta',key))?.value??fallback;
export const setMeta=(key,value)=>serial(()=>transact(['meta'],'readwrite',(tx,take,done)=>{tx.objectStore('meta').put({key,value});done(value);}));
export async function entries({deleted=false}={}){return (await all('entries')).filter(e=>deleted||!e.deletedAt).map(e=>({...e,kind:e.kind||'daily',tags:e.tags||[],attachments:e.attachments||[],blocks:e.blocks||null,bookmarked:!!e.bookmarked})).sort((a,b)=>b.date.localeCompare(a.date));}
export function saveEntry(raw,{expectedUpdatedAt,draftId,draftUpdatedAt}={}){
  return serial(()=>transact(['entries','drafts','assets'],'readwrite',(tx,take,done)=>{
    const store=tx.objectStore('entries');take(store.getAll(),records=>{
      const previous=raw.id?records.find(r=>r.id===raw.id):null;if(raw.id&&!previous)fail('原记录不存在，草稿已保留。');
      version(previous,expectedUpdatedAt);if(previous?.deletedAt)fail('原记录已进入回收站，请先恢复。');
      if(!previous&&records.length>=MAX.records)fail('本机档案已达 20,000 页，请先导出整理；当前草稿仍保留。');
      const entry=normalizeEntry(raw,previous);if(records.some(e=>!e.deletedAt&&e.id!==entry.id&&identity(e)===identity(entry)))fail(`${entry.date} 已有${entry.kind==='weekly'?'周记':'日记'}。请继续编辑原页；当前草稿仍保留。`);
      for(const assetId of entry.attachments)take(tx.objectStore('assets').get(assetId),asset=>{if(!asset)fail('有附件尚未保存，请重新选择后再收笔。');});
      store.put(entry);
      if(draftId)take(tx.objectStore('drafts').get(draftId),draft=>{version(draft,draftUpdatedAt);tx.objectStore('drafts').delete(draftId);});
      done(entry);
    });
  }));
}
export function updateEntry(id,patch,{expectedUpdatedAt}={}){
  return serial(()=>transact(['entries'],'readwrite',(tx,take,done)=>{const store=tx.objectStore('entries');take(store.getAll(),records=>{
    const old=records.find(e=>e.id===validateId(id));if(!old)fail('未找到这份记录。');version(old,expectedUpdatedAt);
    if(patch.deletedAt===null&&records.some(e=>e.id!==id&&!e.deletedAt&&identity(e)===identity(old)))fail('当天已有另一份记录。先导出或调整日期，再恢复这份原文。');
    const allowed={};if('bookmarked'in patch)allowed.bookmarked=Boolean(patch.bookmarked);if('deletedAt'in patch)allowed.deletedAt=patch.deletedAt?stamp():null;
    const updated={...old,...allowed,updatedAt:nextTimestamp(old.updatedAt)};store.put(updated);done(updated);
  });}));
}
export function saveDraft(raw,{expectedUpdatedAt}={}){
  return serial(()=>transact(['drafts'],'readwrite',(tx,take,done)=>{const store=tx.objectStore('drafts'),id=raw.id||createId();take(store.get(id),old=>{
    version(old,expectedUpdatedAt);const fields=normalizeEntry({...raw,id},null,{draft:true});
    const draft={...fields,entryId:raw.entryId||null,baseUpdatedAt:raw.baseUpdatedAt||null,updatedAt:nextTimestamp(old?.updatedAt)};store.put(draft);done(draft);
  });}));
}
export function deleteDraft(id,expectedUpdatedAt){return serial(()=>transact(['drafts'],'readwrite',(tx,take,done)=>{const store=tx.objectStore('drafts');take(store.get(id),old=>{version(old,expectedUpdatedAt);store.delete(id);done();});}));}
export const bytesToBase64=bytes=>{let text='';for(let i=0;i<bytes.length;i+=32768)text+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(text);};
export function base64ToBytes(value){if(typeof value!=='string'||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))fail('附件编码损坏，未导入。');const s=atob(value);return Uint8Array.from(s,c=>c.charCodeAt(0));}
export async function hash(bytes){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');}
export async function addAsset(file){
  if(file.size>MAX.attachment)fail('单个附件最多 50 MB。');
  const data=await file.arrayBuffer(),asset={id:createId(),name:String(file.name||'附件').replace(/[\\/\u0000-\u001f]/g,'_').slice(0,200),type:String(file.type||'application/octet-stream').slice(0,100),size:data.byteLength,sha256:await hash(data),data,createdAt:stamp()};
  return serial(()=>transact(['assets'],'readwrite',(tx,take,done)=>{tx.objectStore('assets').put(asset);done(asset);}));
}
export function saveItem(raw,{expectedUpdatedAt,clearBottleDraft=false}={}){
  return serial(()=>transact(['items','assets','meta'],'readwrite',(tx,take,done)=>{const store=tx.objectStore('items');const item=raw.type==='bottle'?validateBottle(raw):{...raw,id:raw.id?validateId(raw.id):createId()};
    for(const id of item.attachments||[])take(tx.objectStore('assets').get(id),asset=>{if(!asset)fail('附件尚未保存，信件未封存。');});
    take(store.get(item.id),old=>{version(old,expectedUpdatedAt);if(old?.type==='bottle'&&bottleState(old)==='sealed')fail('已封存的信件不能改写。');item.updatedAt=nextTimestamp(old?.updatedAt);store.put(item);if(item.type==='bottle'&&clearBottleDraft)tx.objectStore('meta').put({key:'bottle-draft',value:null});done(item);});
  }));
}
export async function openBottle(id){
  return serial(()=>transact(['items'],'readwrite',(tx,take,done)=>{const store=tx.objectStore('items');take(store.get(validateId(id)),old=>{
    if(!old||old.type!=='bottle')fail('没有找到这封信。');if(bottleState(old)==='sealed')fail('还没有到约定的开启时间。');const item={...old,openedAt:old.openedAt||stamp(),updatedAt:nextTimestamp(old.updatedAt)};store.put(item);done(item);
  });}));
}
export async function snapshot(){
  await queue;return transact(['entries','drafts','assets','items','meta'],'readonly',(tx,take,done)=>{const out={format:'lifeos-pocket',version:2,createdAt:stamp()};let n=0;
    for(const name of ['entries','drafts','assets','items','meta'])take(tx.objectStore(name).getAll(),value=>{out[name]=name==='meta'?value.filter(x=>['appearance','draw-history','poem-favorites','companion','sound','bottle-draft'].includes(x.key)):value;if(++n===5)done(out);});
  });
}
export async function exportWorkspace(){
  const data=await snapshot();data.assets=data.assets.map(asset=>({...asset,data:bytesToBase64(new Uint8Array(asset.data))}));return data;
}
export function importPlan(incoming,existing,strategy='keep'){
  const known=new Map(existing.map(e=>[identity(e),e])),ids=new Map(existing.map(e=>[e.id,e]));const additions=[],replacements=[],conflicts=[];let skipped=0;
  for(const entry of incoming){
    const match=ids.get(entry.id)||(!entry.deletedAt?known.get(identity(entry)):null);
    if(match){const same=['date','body','title','kind','tags','attachments','deletedAt','revisions','bookmarked'].every(k=>JSON.stringify(match[k]??(k==='kind'?'daily':k==='attachments'||k==='tags'||k==='revisions'?[]:k==='bookmarked'?false:null))===JSON.stringify(entry[k]??(k==='kind'?'daily':k==='attachments'||k==='tags'||k==='revisions'?[]:k==='bookmarked'?false:null)));
      if(same){skipped++;continue;}conflicts.push({incoming:entry,local:match});
      if(strategy==='replace'&&!match.deletedAt){const history=[...(entry.revisions||[]),...(match.revisions||[]),((({revisions,...rest})=>rest)(match))];const next={...entry,id:match.id,createdAt:match.createdAt,updatedAt:nextTimestamp(match.updatedAt),revisions:history.slice(-MAX.revisions)};replacements.push(next);known.delete(identity(match));known.set(identity(next),next);ids.set(next.id,next);}else skipped++;
    }else{additions.push(entry);ids.set(entry.id,entry);if(!entry.deletedAt)known.set(identity(entry),entry);}
  }return {additions,replacements,conflicts,skipped};
}
export async function applyImport(incoming,{strategy='keep',expectedFingerprint}={}){
  return serial(()=>transact(['entries','assets','drafts','items','meta'],'readwrite',(tx,take,done)=>{const store=tx.objectStore('entries');take(store.getAll(),existing=>{
    if(expectedFingerprint&&fingerprint(existing)!==expectedFingerprint)fail('预览后本机记录发生变化，请重新预览导入。');
    const plan=importPlan(incoming.entries||[],existing,strategy);
    const result={imported:plan.additions.length,replaced:plan.replacements.length,skipped:plan.skipped,conflicts:plan.conflicts.length,extraImported:0,extraKept:0};
    const final=new Map(existing.map(e=>[e.id,e]));for(const e of [...plan.additions,...plan.replacements])final.set(e.id,e);
    const dates=new Set();for(const e of final.values())if(!e.deletedAt){const key=identity(e);if(dates.has(key))fail('导入会造成同日同类型重复，请选择保留本机原文。');dates.add(key);}
    if(final.size>MAX.records)fail('本机档案超过 20,000 页，本次未导入。');
    // Asset IDs are immutable. A collision aborts every change, including entries.
    for(const asset of incoming.assets||[])take(tx.objectStore('assets').get(asset.id),old=>{if(old&&old.sha256!==asset.sha256)fail('附件标识冲突，未导入任何内容。');if(!old)tx.objectStore('assets').put(asset);});
    for(const entry of [...plan.additions,...plan.replacements])store.put(entry);
    for(const name of ['drafts','items'])for(const original of incoming[name]||[]){let item=original;
      if(name==='drafts'&&item.entryId){const restored=final.get(item.entryId);if(!restored||restored.deletedAt||restored.updatedAt!==item.baseUpdatedAt)item={...item,entryId:null,baseUpdatedAt:null};}
      take(tx.objectStore(name).get(item.id),old=>{if(!old){tx.objectStore(name).put(item);result.extraImported++;}else result.extraKept++;});}
    for(const pref of incoming.meta||[])take(tx.objectStore('meta').get(pref.key),old=>{if(!old)tx.objectStore('meta').put(pref);});
    done(result);
  });}));
}
export const fingerprint=records=>records.map(e=>`${e.id}:${e.updatedAt}`).sort().join('|');
