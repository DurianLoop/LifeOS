import test from 'node:test';
import assert from 'node:assert/strict';
import {indexedDB} from 'fake-indexeddb';
import {deflateRawSync} from 'node:zlib';
import * as db from '../promo/app/workspace.js';
import * as domain from '../promo/app/domain.js';
import {normalizeBackup,parseFiles,encryptBackup,decryptBackup,portable,markdown,readZip,parseCSV} from '../promo/app/transfer.js';
globalThis.indexedDB=indexedDB;
const at='2026-10-01T12:00:00.000Z';
const uid=()=>crypto.randomUUID();
const entry=(date,body='合成验收文字')=>domain.normalizeEntry({date,body,tags:['测试']});
const backup=changes=>({format:'lifeos-pocket',version:2,entries:[],drafts:[],items:[],assets:[],meta:[],...changes});

test('v1 records and the unsaved draft survive the database upgrade',async()=>{
  const old=await new Promise((resolve,reject)=>{const r=indexedDB.open('lifeos-mobile',1);r.onupgradeneeded=()=>{r.result.createObjectStore('entries',{keyPath:'id'});r.result.createObjectStore('meta',{keyPath:'key'});};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  const legacy=entry('2026-01-01');await new Promise((resolve,reject)=>{const t=old.transaction(['entries','meta'],'readwrite');t.objectStore('entries').put(legacy);t.objectStore('meta').put({key:'draft',value:{date:'2026-01-02',title:'旧版草稿',body:'没有收笔的原文'}});t.oncomplete=resolve;t.onabort=()=>reject(t.error);});old.close();
  await db.openWorkspace();assert.equal((await db.get('entries',legacy.id)).body,legacy.body);assert.equal((await db.all('drafts'))[0].body,'没有收笔的原文');
});

test('daily and weekly are separate; duplicate saves abort and retain exact drafts',async()=>{
  const d=await db.saveDraft({date:'2026-02-03',body:'即刻写下'});
  const saved=await db.saveEntry({...d,id:undefined},{draftId:d.id,draftUpdatedAt:d.updatedAt,expectedUpdatedAt:null});
  assert.equal(await db.get('drafts',d.id),null);
  const conflict=await db.saveDraft({date:'2026-02-03',body:'另一页'});
  await assert.rejects(db.saveEntry({...conflict,id:undefined},{draftId:conflict.id,draftUpdatedAt:conflict.updatedAt}),/已有/);
  assert.equal((await db.get('drafts',conflict.id)).body,'另一页');
  const weekly=await db.saveEntry({date:saved.date,kind:'weekly',body:'本周'});assert.equal(weekly.date,'2026-02-02');
});

test('optimistic concurrency prevents stale edits and draft deletion',async()=>{
  const original=await db.saveEntry({date:'2026-03-01',body:'原文'});
  const changed=await db.saveEntry({...original,body:'另一标签的新文字'},{expectedUpdatedAt:original.updatedAt});
  await assert.rejects(db.saveEntry({...original,body:'旧页面提交'},{expectedUpdatedAt:original.updatedAt}),/另一页面/);
  assert.equal((await db.get('entries',original.id)).body,changed.body);
  const draft=await db.saveDraft({date:'2026-03-02',body:'草稿'});const latest=await db.saveDraft({...draft,body:'刚刚又写了一句'},{expectedUpdatedAt:draft.updatedAt});
  await assert.rejects(db.saveEntry({date:'2026-03-02',body:'过时草稿'},{draftId:draft.id,draftUpdatedAt:draft.updatedAt}),/另一页面/);
  assert.equal((await db.get('drafts',draft.id)).body,latest.body);assert.equal((await db.entries()).some(e=>e.date==='2026-03-02'),false);
});

test('missing attachment aborts the entire save; revision restore keeps both versions',async()=>{
  await assert.rejects(db.saveEntry({date:'2026-03-03',body:'图片',attachments:[uid()]}),/附件/);
  assert.equal((await db.entries()).some(e=>e.date==='2026-03-03'),false);
  const asset=await db.addAsset(new File([new Uint8Array([0,1,2,255])],'合成.bin'));
  const original=await db.saveEntry({date:'2026-03-04',body:'有附件的原版',attachments:[asset.id]});
  const edit=await db.saveEntry({...original,body:'第二版',attachments:[]},{expectedUpdatedAt:original.updatedAt});
  const restored=await db.saveEntry({...edit.revisions[0],id:edit.id},{expectedUpdatedAt:edit.updatedAt});
  assert.equal(restored.body,original.body);assert.deepEqual(restored.attachments,[asset.id]);assert.equal(restored.revisions.at(-1).body,'第二版');
});

test('full backup roundtrips bytes, blocks, history, drafts, bottle media and preferences',async()=>{
  const asset=await db.addAsset(new File(['录音合成数据'],'声音.webm',{type:'audio/webm'}));
  await db.saveItem({type:'bottle',title:'未来',body:'以后读',opensAt:'2099-01-01T00:00:00Z',attachments:[asset.id]});
  await db.setMeta('bottle-draft',{title:'未封存',body:'还在写',opensAt:'',attachments:[asset.id],scene:'moon'});
  await db.setMeta('ai-provider',{provider:'deepseek',model:'test'});await db.setMeta('poem-favorites',['quiet-night']);
  const raw=await db.exportWorkspace(),restored=await normalizeBackup(JSON.parse(JSON.stringify(raw)));
  assert.equal(raw.meta.some(p=>p.key==='ai-provider'),false);assert.deepEqual(restored.assets.map(a=>[a.id,a.sha256,a.size]),raw.assets.map(a=>[a.id,a.sha256,a.size]));
  assert.equal(restored.meta.find(x=>x.key==='bottle-draft').value.body,'还在写');assert.ok(restored.drafts.length);assert.ok(restored.entries.some(e=>e.revisions.length));
  for(const a of restored.assets)assert.equal(await db.hash(a.data),a.sha256);
  const broken=structuredClone(raw);broken.assets[0].data='eA==';await assert.rejects(normalizeBackup(broken),/校验/);
  const missing=structuredClone(raw);missing.assets=[];await assert.rejects(normalizeBackup(missing),/缺少.*附件/);
});

test('import replace retains original history; conflicts and stale previews never silently overwrite',async()=>{
  const local=await db.saveEntry({date:'2026-04-01',body:'本机原文'}),incoming=entry(local.date,'导入文字');
  let plan=db.importPlan([incoming],await db.entries());assert.equal(plan.skipped,1);
  const fp=db.fingerprint(await db.all('entries'));await db.updateEntry(local.id,{bookmarked:true});
  await assert.rejects(db.applyImport({entries:[incoming]},{strategy:'replace',expectedFingerprint:fp}),/重新预览/);
  await db.applyImport({entries:[incoming],drafts:[{...entry('2026-04-02','导入未收笔'),entryId:incoming.id,baseUpdatedAt:incoming.updatedAt}]},{strategy:'replace'});
  const restored=await db.get('entries',local.id);assert.equal(restored.body,incoming.body);assert.equal(restored.revisions.at(-1).body,'本机原文');
  const draft=(await db.all('drafts')).find(x=>x.body==='导入未收笔');assert.equal(draft.entryId,null);
});

test('reimporting an unchanged full backup skips identical history but detects changed historical text',async()=>{
  const original=await db.saveEntry({date:'2026-04-03',body:'需要逐字保留的第一版'});
  const revised=await db.saveEntry({...original,body:'目前的第二版'},{expectedUpdatedAt:original.updatedAt});
  const restored=await normalizeBackup(JSON.parse(JSON.stringify(await db.exportWorkspace())));
  const local=await db.entries({deleted:true});
  const same=db.importPlan(restored.entries,local);
  assert.equal(same.conflicts.length,0);
  assert.equal(same.additions.length,0);
  assert.equal(same.skipped,local.length);
  const incoming=restored.entries.find(e=>e.id===revised.id);
  incoming.revisions[0]=Object.fromEntries(Object.entries(incoming.revisions[0]).reverse());
  assert.equal(db.importPlan([incoming],local).conflicts.length,0);
  incoming.revisions[0].body='另一份备份中不同的历史原文';
  assert.equal(db.importPlan([incoming],local).conflicts.length,1);
});

test('asset collision rolls back imported records and never replaces existing bytes',async()=>{
  const asset=(await db.all('assets'))[0],incoming=entry('2026-05-01');
  await assert.rejects(db.applyImport({entries:[incoming],assets:[{...asset,sha256:'other'}]}),/标识冲突/);
  assert.equal(await db.get('entries',incoming.id),null);assert.equal((await db.get('assets',asset.id)).sha256,asset.sha256);
});

test('AES backup authenticates password and ciphertext before any import',async()=>{
  const original=await db.exportWorkspace(),encrypted=await encryptBackup(original,'only-a-test-password');
  assert.deepEqual(await decryptBackup(encrypted,'only-a-test-password'),original);
  await assert.rejects(decryptBackup(encrypted,'wrong-password'),/密码不正确/);
  encrypted.data='AAAA'+encrypted.data.slice(4);await assert.rejects(decryptBackup(encrypted,'only-a-test-password'),/损坏/);
});

test('weekly dates honor ISO year boundaries and desktop paths instead of import time',async()=>{
  assert.equal(domain.weekDate(2020,53),'2020-12-28');assert.throws(()=>domain.weekDate(2021,53));
  const data=await normalizeBackup({entries:[{kind:'weekly',source_path:'weekly/2020-W53.md',created_at:at,content:'跨年周记'}]});assert.equal(data.entries[0].date,'2020-12-28');
  const exchanged=await normalizeBackup(portable(data.entries));assert.equal(exchanged.entries[0].date,'2020-12-28');
  const file=new File([markdown(data.entries[0])],'2020-W53.md');const parsed=await parseFiles([file]);assert.equal(parsed.entries[0].body,'跨年周记');
});

test('literal text, section blocks, CSV multiline quotes and invalid inputs',()=>{
  const blocks={journal:'一段\n原文',habits:'- [x] 散步'};assert.deepEqual(domain.splitPaper(domain.paperBody(blocks)),blocks);
  const body='<script>example only</script>';assert.equal(domain.normalizeEntry({date:'2026-05-02',body}).body,body);
  for(const change of [{body:12},{title:{}},{attachments:'oops'},{blocks:{journal:12}}])assert.throws(()=>domain.normalizeEntry({date:'2026-05-02',body:'原文',...change}));
  assert.deepEqual(parseCSV('date,title,body\r\n2026-01-01,"a,b","第一行\n""第二行"""')[0],{date:'2026-01-01',title:'a,b',body:'第一行\n"第二行"'});
});

function zip(name,text,compressed=false){const bytes=Buffer.from(text),packed=compressed?deflateRawSync(bytes):bytes,n=Buffer.from(name);let crc=0xffffffff;for(const b of bytes){crc^=b;for(let k=0;k<8;k++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}crc=(crc^0xffffffff)>>>0;
  const h=Buffer.alloc(30);h.writeUInt32LE(0x04034b50);h.writeUInt16LE(compressed?8:0,8);h.writeUInt32LE(crc,14);h.writeUInt32LE(packed.length,18);h.writeUInt32LE(bytes.length,22);h.writeUInt16LE(n.length,26);
  const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(compressed?8:0,10);c.writeUInt32LE(crc,16);c.writeUInt32LE(packed.length,20);c.writeUInt32LE(bytes.length,24);c.writeUInt16LE(n.length,28);const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(c.length+n.length,12);end.writeUInt32LE(h.length+n.length+packed.length,16);return Buffer.concat([h,n,packed,c,n,end]);}
test('ZIP validates deflate, CRC, truncation and path traversal before importing',async()=>{
  for(const deflate of [false,true]){const bytes=zip('entries/2026-06-01.md','# 合成日记\n完整内容',deflate);const parsed=await parseFiles([new File([bytes],'export.zip')]);assert.equal(parsed.entries[0].date,'2026-06-01');assert.match(parsed.entries[0].body,/完整内容/);}
  await assert.rejects(readZip(zip('../private.txt','text')),/路径/);
  const corrupt=zip('entries/2026-06-01.md','完整内容');corrupt[60]^=0xff;await assert.rejects(readZip(corrupt));
  await assert.rejects(readZip(corrupt.subarray(0,40)),/不完整/);
});

test('sealed bottles cannot be opened early or rewritten and missing media aborts',async()=>{
  const bottle=await db.saveItem({type:'bottle',body:'合成信件',opensAt:'2099-01-01T00:00:00Z'});
  await assert.rejects(db.openBottle(bottle.id),/约定/);await assert.rejects(db.saveItem({...bottle,body:'改写'}),/不能改写/);
  await assert.rejects(db.saveItem({type:'bottle',body:'有附件',opensAt:'2099-01-01T00:00:00Z',attachments:[uid()]}),/附件/);
});


test('sealing a letter clears precisely its draft in the same durable transaction',async()=>{
  const draft={title:'封存事务',body:'完整原文',opensAt:'2099-02-01T00:00:00Z',attachments:[]};
  await db.setMeta('bottle-draft',draft);
  await assert.rejects(db.saveItem({...draft,type:'bottle',attachments:[uid()]},{clearBottleDraft:true}),/附件/);
  assert.equal((await db.getMeta('bottle-draft')).body,draft.body);
  const sealed=await db.saveItem({...draft,type:'bottle'},{clearBottleDraft:true});
  assert.equal((await db.get('items',sealed.id)).body,draft.body);
  assert.equal(await db.getMeta('bottle-draft'),null);
});

test('overlapping backup files are rejected before the import preview can discard data',async()=>{
  const record=entry('2026-09-21','同一份备份');
  const file=new File([JSON.stringify(backup({entries:[record]}))],'backup.json');
  await assert.rejects(parseFiles([file,file]),/重复资料标识/);
});
