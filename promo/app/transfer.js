import {normalizeEntry,validateId,createId,weekDate,validateBottle,MAX,fail,tags,stamp,validateDate,preferences,attachmentIds,stringField} from './domain.js';
import {bytesToBase64,base64ToBytes,hash} from './workspace.js';
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const dateTime=value=>{if(!value)return stamp();const d=new Date(value);if(!Number.isFinite(+d))fail('备份中的时间无效，未导入。');return d.toISOString();};
export function portable(entries){return {manifest:{format:'lifeos-portable-export-v1',created_at:stamp(),entry_count:entries.length,attachments_included:false},entries:entries.map(e=>({entry_id:e.id,kind:e.kind,journal_date:e.date,title:e.title,tags:e.tags,content:e.body,created_at:e.createdAt,updated_at:e.updatedAt,source_path:e.kind==='weekly'?`weekly/${weekName(e.date)}.md`:`journal/${e.date}.md`}))};}
function weekName(date){const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+4-(d.getUTCDay()||7));const year=d.getUTCFullYear(),week=Math.ceil((((d-new Date(Date.UTC(year,0,1)))/86400000)+1)/7);return `${year}-W${String(week).padStart(2,'0')}`;}
export function markdown(entry){return `---\ndate: ${entry.date}\nkind: ${entry.kind||'daily'}\ntitle: ${JSON.stringify(entry.title)}\ntags: ${JSON.stringify(entry.tags||[])}\n---\n\n${entry.body}`;}
export function parseCSV(text){
  const rows=[];let row=[],field='',quoted=false;for(let i=0;i<text.length;i++){
    const ch=text[i];if(ch==='"'){if(quoted&&text[i+1]==='"'){field+='"';i++;}else if(quoted||!field)quoted=!quoted;else field+=ch;}
    else if(ch===','&&!quoted){row.push(field);field='';}else if((ch==='\n'||ch==='\r')&&!quoted){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(field);if(row.some(x=>x))rows.push(row);row=[];field='';}else field+=ch;
  }if(quoted)fail('CSV 引号未闭合，请保留原文件并修正后再试。');row.push(field);if(row.some(x=>x))rows.push(row);if(rows.length<2)fail('CSV 没有可导入的记录。');
  const header=rows.shift().map(x=>x.replace(/^\ufeff/,'').trim().toLowerCase());return rows.map(values=>Object.fromEntries(header.map((key,i)=>[key,values[i]||''])));
}
function detectDate(raw,name,body){
  const weekly=(raw.source_path||name).match(/(\d{4})[-_]?W(\d{1,2})/i);if(weekly&&(!raw.kind||raw.kind==='weekly'))return weekDate(Number(weekly[1]),Number(weekly[2]));
  const explicit=raw.date||raw.journal_date||raw.creationDate||raw.created_at||raw['日期'];
  const date=explicit?.match(/\d{4}-\d{2}-\d{2}/)?.[0]||name.match(/\d{4}-\d{2}-\d{2}/)?.[0]||body.slice(0,2000).match(/(?:date|日期):\s*["']?(\d{4}-\d{2}-\d{2})/)?.[1];
  if(date)return validateDate(date);
  const week=(raw.source_path||name).match(/(\d{4})[-_]?W(\d{1,2})/i);if(week)return weekDate(Number(week[1]),Number(week[2]));
  fail(`${name} 没有可识别的日期。请在文件名或 JSON 的 date 字段中填写 YYYY-MM-DD；未导入任何内容。`);
}
function fromRaw(raw,name){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))fail(`${name} 记录格式不正确。`);
  let body=raw.text??raw.content??raw.body??raw.journal??raw.markdown??raw['正文']??raw['日记']??'';if(typeof body!=='string')fail(`${name} 正文不是文字。`);
  const kind=raw.kind||((raw.source_path||name).match(/\d{4}[-_]?W\d{1,2}/i)?'weekly':'daily');
  const id=raw.id||raw.entry_id;const normalized=normalizeEntry({id:uuid.test(id||'')?id:createId(),date:detectDate(raw,name,body),kind,
    body,title:raw.title||raw['标题']||'',tags:tags(raw.tags),bookmarked:raw.bookmarked,createdAt:dateTime(raw.createdAt||raw.created_at||raw.creationDate),
    deletedAt:raw.deletedAt||raw.deleted_at||null,attachments:[]},null,{draft:true});
  normalized.updatedAt=dateTime(raw.updatedAt||raw.updated_at||raw.createdAt||raw.created_at||raw.creationDate);
  return normalized;
}
export async function normalizeBackup(data,name='备份'){
  const output={entries:[],assets:[],drafts:[],items:[],meta:[],warnings:[]};
  if(data?.format==='lifeos-pocket'){
    if(data.version!==2)fail('备份版本不受支持，请保留原文件。');
    for(const field of ['entries','assets','drafts','items','meta'])if(!Array.isArray(data[field]))fail(`备份缺少 ${field}，未导入。`);
    let total=0;const ids=new Set();
    for(const raw of data.assets){
      const id=validateId(raw.id);if(ids.has(id))fail('备份中有重复附件标识。');ids.add(id);
      const bytes=base64ToBytes(raw.data);total+=bytes.length;if(bytes.length>MAX.attachment||total>MAX.backup)fail('附件总量超过本次导入限制。');
      if(raw.size!==bytes.length||await hash(bytes)!==raw.sha256)fail('附件校验失败，整份备份未导入。');
      output.assets.push({...raw,id,name:String(raw.name||'附件').replace(/[\\/\u0000-\u001f]/g,'_').slice(0,200),type:String(raw.type||'application/octet-stream').slice(0,100),data:bytes.buffer});
    }
    const checkAssets=list=>{for(const id of attachmentIds(list))if(!ids.has(id))fail('备份缺少被引用的附件，未导入任何内容。');};
    for(const raw of data.entries){
      checkAssets(raw.attachments);const entry=normalizeEntry(raw,null,{draft:true});entry.updatedAt=dateTime(raw.updatedAt);entry.createdAt=dateTime(raw.createdAt);entry.deletedAt=raw.deletedAt?dateTime(raw.deletedAt):null;
      if(!Array.isArray(raw.revisions)||raw.revisions.length>MAX.revisions)fail('历史版本结构损坏。');
      entry.revisions=raw.revisions.map(rev=>{checkAssets(rev.attachments);const r=normalizeEntry({...rev,id:entry.id,revisions:[]},null,{draft:true});r.updatedAt=dateTime(rev.updatedAt);return r;});output.entries.push(entry);
    }
    for(const raw of data.drafts){checkAssets(raw.attachments);const draft=normalizeEntry(raw,null,{draft:true});output.drafts.push({...draft,updatedAt:dateTime(raw.updatedAt),entryId:raw.entryId?validateId(raw.entryId):null,baseUpdatedAt:raw.baseUpdatedAt?dateTime(raw.baseUpdatedAt):null});}
    for(const raw of data.items){
      if(raw.type==='bottle'){checkAssets(raw.attachments);output.items.push({...validateBottle(raw),createdAt:dateTime(raw.createdAt),openedAt:raw.openedAt?dateTime(raw.openedAt):null,updatedAt:dateTime(raw.updatedAt)});}
      else if(['answer','chat','poem'].includes(raw.type)&&typeof raw.body==='string'&&raw.body.length<=MAX.body){
        const item={...raw,id:validateId(raw.id),createdAt:dateTime(raw.createdAt),updatedAt:dateTime(raw.updatedAt)};
        if(raw.type==='chat'&&(typeof raw.answer!=='string'||raw.answer.length>MAX.body))fail('聊天备份结构损坏。');
        if(raw.sources&&(!Array.isArray(raw.sources)||raw.sources.some(s=>!s||!uuid.test(s.id)||typeof s.date!=='string'||typeof s.title!=='string')))fail('回答来源结构损坏。');
        output.items.push(item);
      }else fail('备份包含无法识别的资料类型，请保留原文件。');
    }
    const keys=new Set();for(const pref of data.meta){
      if(!pref||typeof pref.key!=='string'||keys.has(pref.key))fail('备份偏好结构损坏。');keys.add(pref.key);const value=pref.value;let clean;
      switch(pref.key){
        case 'appearance':clean=preferences(value||{});break;
        case 'draw-history':if(!Array.isArray(value)||value.length>1000||value.some(x=>!x||!uuid.test(x.id)||!Number.isFinite(Date.parse(x.at))))fail('抽签历史损坏。');clean=value;break;
        case 'poem-favorites':if(!Array.isArray(value)||value.some(x=>typeof x!=='string'||x.length>200))fail('诗选收藏损坏。');clean=[...new Set(value)];break;
        case 'companion':clean={character:value?.character==='dsh'?'dsh':'vivi',action:stringField(value?.action,'伙伴动作','sit'),auto:value?.auto!==false};break;
        case 'sound':clean={volume:Math.max(0,Math.min(100,Number(value?.volume)||0)),timer:[0,15,30,60].includes(value?.timer)?value.timer:0};break;
        case 'bottle-draft':if(value==null){clean=null;break;}checkAssets(value.attachments);clean={title:stringField(value.title,'信件标题'),body:stringField(value.body,'信件正文'),opensAt:stringField(value.opensAt,'开启时间'),scene:['moon','dawn','dusk'].includes(value.scene)?value.scene:'moon',attachments:attachmentIds(value.attachments)};if(clean.title.length>200||clean.body.length>MAX.body)fail('信件草稿过长。');break;
        default:continue;
      }output.meta.push({key:pref.key,value:clean});
    }
  }else{
    const own=data?.format==='lifeos-mobile';if(data?.format&&!['lifeos-mobile','lifeos-portable-export-v1'].includes(data.format))fail('无法识别这份数据文件。');
    if(own&&data.version!==1)fail('旧版手机备份版本不受支持，请保留原文件。');
    const records=Array.isArray(data)?data:Array.isArray(data?.entries)?data.entries:[data];
    for(const [i,raw]of records.entries()){
      const entry=fromRaw(raw,`${name}#${i+1}`);
      if(own)entry.revisions=(raw.revisions||[]).map(rev=>fromRaw({...rev,id:entry.id},name)).slice(-MAX.revisions);
      output.entries.push(entry);
      if(raw.attachments?.length)output.warnings.push(`${entry.date} 的 JSON 只有附件目录，没有附件字节。请从电脑导出包含附件的 Markdown ZIP，再导入。`);
    }
    if(own){
      for(const raw of data.trash||[]){const entry={...fromRaw(raw,name),deletedAt:dateTime(raw.deleted_at||raw.deletedAt)};entry.revisions=(raw.revisions||[]).map(rev=>fromRaw({...rev,id:entry.id},name)).slice(-MAX.revisions);output.entries.push(entry);}
      if(data.draft){const d=fromRaw(data.draft,name);output.drafts.push({...d,entryId:data.draft.entryId||null,baseUpdatedAt:data.draft.baseUpdatedAt||null});}
    }
  }
  if(output.entries.length>MAX.records)fail('一次最多导入 20,000 条记录。');
  for(const name of ['entries','drafts','items']){const seen=new Set();for(const e of output[name]){if(seen.has(e.id))fail('文件内有重复资料标识，请核对后再导入。');seen.add(e.id);}}
  return output;
}
function parseText(text,name){
  let body=text.replace(/^\ufeff/,'').replace(/\r\n/g,'\n'),raw={};
  const front=/^---\n([\s\S]*?)\n---(?:\n|$)/.exec(body);
  if(front){for(const line of front[1].split('\n')){const match=/^([\w-]+):\s*(.*)$/.exec(line);if(match){let value=match[2];try{value=JSON.parse(value);}catch{}raw[match[1]]=value;}}body=body.slice(front[0].length).replace(/^\n/,'');}
  raw.title||=body.match(/^#\s+(.+)$/m)?.[1]||name.replace(/\.[^.]+$/,'').replace(/^\d{4}-\d{2}-\d{2}[-_ ]?/,'');
  if(/\.html?$/i.test(name)){if(typeof DOMParser==='undefined')fail('当前环境不能读取 HTML。');const doc=new DOMParser().parseFromString(body,'text/html');doc.querySelectorAll('script,style,iframe,object').forEach(x=>x.remove());doc.querySelectorAll('br').forEach(x=>x.replaceWith('\n'));doc.querySelectorAll('p,div,h1,h2,h3,li').forEach(x=>x.append('\n'));body=doc.body.textContent||'';}
  return fromRaw({...raw,body},name);
}
const crcTable=Uint32Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=(n&1)?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function crc32(bytes){let value=0xffffffff;for(const byte of bytes)value=crcTable[(value^byte)&255]^(value>>>8);return (value^0xffffffff)>>>0;}
export async function readZip(buffer){
  const data=new Uint8Array(buffer),view=new DataView(data.buffer,data.byteOffset,data.byteLength),files=new Map();let end=-1;
  for(let i=data.length-22;i>=Math.max(0,data.length-65557);i--)if(view.getUint32(i,true)===0x06054b50){end=i;break;}
  if(end<0)fail('ZIP 文件不完整。');const count=view.getUint16(end+10,true),offset=view.getUint32(end+16,true);if(count>25000)fail('ZIP 文件数量过多。');
  let cursor=offset,total=0;for(let i=0;i<count;i++){
    if(cursor+46>data.length||view.getUint32(cursor,true)!==0x02014b50)fail('ZIP 目录损坏。');
    const flags=view.getUint16(cursor+8,true),method=view.getUint16(cursor+10,true),crc=view.getUint32(cursor+16,true),compressed=view.getUint32(cursor+20,true),size=view.getUint32(cursor+24,true),len=view.getUint16(cursor+28,true),extra=view.getUint16(cursor+30,true),comment=view.getUint16(cursor+32,true),local=view.getUint32(cursor+42,true);
    const name=decoder.decode(data.subarray(cursor+46,cursor+46+len));cursor+=46+len+extra+comment;
    if(name.endsWith('/'))continue;if(name.includes('\\')||name.startsWith('/')||name.split('/').some(x=>x==='..')||files.has(name))fail('ZIP 中有不安全或重复的路径。');
    total+=size;if(size>MAX.attachment||total>MAX.backup)fail('解压后的文件过大。');if(flags&1)fail('请先在电脑解密 ZIP，或使用 LifeOS 密码备份。');
    if(local+30>data.length||view.getUint32(local,true)!==0x04034b50)fail('ZIP 文件结构损坏。');const start=local+30+view.getUint16(local+26,true)+view.getUint16(local+28,true);if(start+compressed>data.length)fail('ZIP 文件内容截断。');
    let bytes=data.slice(start,start+compressed);
    if(method===8){try{const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));const reader=stream.getReader(),chunks=[];let n=0;while(true){const chunk=await reader.read();if(chunk.done)break;n+=chunk.value.length;if(n>size||n>MAX.attachment){await reader.cancel();fail('ZIP 解压大小异常。');}chunks.push(chunk.value);}bytes=new Uint8Array(n);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}}catch(e){fail(e.message.includes('ZIP')?e.message:'当前浏览器无法解压此 ZIP，请升级浏览器，或导入 JSON/Markdown 文件。');}}
    else if(method!==0)fail('此 ZIP 压缩格式暂不支持。');
    if(bytes.length!==size||crc32(bytes)!==crc)fail('ZIP 内容校验失败，未导入。');files.set(name,bytes);
  }return files;
}
export async function parseFiles(files,password=''){
  const combined={entries:[],assets:[],drafts:[],items:[],meta:[],warnings:[]};
  const merge=data=>{for(const key of Object.keys(combined))combined[key].push(...data[key]||[]);};
  let total=0;for(const file of files){total+=file.size;if(total>MAX.backup)fail('一次导入文件总量最多 300 MB。');
    if(/\.zip$/i.test(file.name)){
      const zipped=await readZip(await file.arrayBuffer());const paths=[...zipped.keys()];let found=false;
      for(const name of paths.filter(x=>x.startsWith('entries/')&&/\.md$/i.test(x))){
        const entry=parseText(decoder.decode(zipped.get(name)),name);const stem=name.replace(/^entries\//,'').replace(/\.md$/i,'');
        for(const path of paths.filter(x=>x.startsWith('attachments/'+stem+'/'))){const bytes=zipped.get(path);const asset={id:createId(),name:path.split('/').at(-1),type:mime(path),size:bytes.length,sha256:await hash(bytes),data:bytes.buffer,createdAt:stamp()};combined.assets.push(asset);entry.attachments.push(asset.id);}
        combined.entries.push(entry);found=true;
      }
      if(!found)fail('请选择电脑端「导出 → Markdown → 包含附件」生成的 ZIP。数据库恢复备份应在原生客户端恢复。');
    }else if(/\.json$|\.lifeos$/i.test(file.name)){
      let data;try{data=JSON.parse(await file.text());}catch{fail('JSON 文件不完整或编码错误。');}
      if(data.format==='lifeos-encrypted'){if(!password)fail('这是密码备份，请输入备份密码。');data=await decryptBackup(data,password);}
      merge(await normalizeBackup(data,file.name));
    }else if(/\.csv$/i.test(file.name))merge(await normalizeBackup(parseCSV(await file.text()),file.name));
    else if(/\.(md|markdown|txt|html|htm)$/i.test(file.name))combined.entries.push(parseText(await file.text(),file.name));
    else fail(`${file.name} 不是支持的日记文件。请选择 JSON、Markdown、TXT、HTML、CSV 或电脑导出 ZIP。`);
  }if(combined.entries.length>MAX.records)fail('记录数量超过单次导入限制。');
  for(const key of ['entries','drafts','items','assets']){const seen=new Set();for(const value of combined[key]){if(seen.has(value.id))fail('所选文件包含重复资料标识，请每次恢复一份备份；未导入任何内容。');seen.add(value.id);}}return combined;
}
function mime(name){const ext=name.split('.').at(-1).toLowerCase();return ({png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',gif:'image/gif',mp3:'audio/mpeg',ogg:'audio/ogg',m4a:'audio/mp4',mp4:'video/mp4',mov:'video/quicktime',pdf:'application/pdf',txt:'text/plain'})[ext]||'application/octet-stream';}
async function derive(password,salt,iterations){
  const material=await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveKey']);return crypto.subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',salt,iterations},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
export async function encryptBackup(data,password){
  if(password.length<8)fail('备份密码至少 8 个字符。请保管密码，无法代为找回。');
  const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12)),iterations=310000;
  const key=await derive(password,salt,iterations),bytes=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode('lifeos-pocket-v2')},key,encoder.encode(JSON.stringify(data)));
  return {format:'lifeos-encrypted',version:1,algorithm:'AES-256-GCM',kdf:'PBKDF2-SHA256',iterations,salt:bytesToBase64(salt),iv:bytesToBase64(iv),data:bytesToBase64(new Uint8Array(bytes))};
}
export async function decryptBackup(data,password){
  if(data.version!==1||data.algorithm!=='AES-256-GCM'||data.kdf!=='PBKDF2-SHA256'||data.iterations!==310000)fail('备份加密格式不受支持。');
  const salt=base64ToBytes(data.salt),iv=base64ToBytes(data.iv);if(salt.length!==16||iv.length!==12)fail('备份加密头损坏。');
  try{const key=await derive(password,salt,data.iterations),plain=await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:encoder.encode('lifeos-pocket-v2')},key,base64ToBytes(data.data));return JSON.parse(decoder.decode(plain));}
  catch{fail('密码不正确，或备份内容已损坏。本机记录没有改变。');}
}
export async function saveFile(file){
  const apple=/iPhone|iPad|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
  if(apple&&navigator.canShare?.({files:[file]})){await navigator.share({files:[file],title:file.name});return;}
  const url=URL.createObjectURL(file),link=document.createElement('a');link.href=url;link.download=file.name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
}
