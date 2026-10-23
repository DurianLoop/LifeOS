import { localDate, validateDate, createId, validateId, LifeOSError, nextTimestamp } from './model.js';
export { localDate, validateDate, createId, validateId, LifeOSError, nextTimestamp };

export const BLOCKS = [
  ['journal','日记','留几行给此刻的自己。'], ['schedule','日程','今天的约定与待办。'],
  ['notes','心得与摘录','一句话，一个新的想法。'], ['reflection','自我探索','觉察、困惑，或一次小小的理解。'],
  ['systems','体系构建','让经验慢慢长成自己的方法。'], ['habits','习惯打卡','用 - [ ] 和 - [x] 记录小小的坚持。'],
];
export const DEFAULT_PREFS = { font:'serif', size:18, leading:2, theme:'paper', motion:true, writerMode:'paper' };
export const MAX = { records:20000, body:200000, attachment:50*1024*1024, backup:300*1024*1024, revisions:30 };
export const fail = message => { throw new LifeOSError(message); };
export const stamp = () => new Date().toISOString();
export function stringField(value,label,fallback='') {if(value==null)return fallback;if(typeof value!=='string')fail(`${label}须为文字。`);return value;}
export function attachmentIds(value=[]) {if(!Array.isArray(value)||value.length>200)fail('附件列表无效或超过 200 个。');return [...new Set(value.map(x=>validateId(typeof x==='string'?x:x?.id)))];}
export const countWords = text => [...String(text || '').replace(/\s/g,'')].length;
export function weekStart(date) {
  validateDate(date); const d=new Date(date+'T12:00:00'); d.setDate(d.getDate()-((d.getDay()+6)%7)); return localDate(d);
}
export function isoWeek(date) {
  const d=new Date(date+'T12:00:00Z'); d.setUTCDate(d.getUTCDate()+4-(d.getUTCDay()||7));
  const year=d.getUTCFullYear(); return {year,week:Math.ceil((((d-new Date(Date.UTC(year,0,1)))/86400000)+1)/7)};
}
export function weekDate(year,week) {
  if(!Number.isInteger(year)||year<1||year>9999||!Number.isInteger(week)||week<1||week>53) fail('周记日期无效。');
  const d=new Date(`${String(year).padStart(4,'0')}-01-04T12:00:00`); d.setDate(d.getDate()-((d.getDay()+6)%7)+(week-1)*7);
  const date=localDate(d); if(isoWeek(date).year!==year||isoWeek(date).week!==week) fail('这一年没有该周，请核对周记日期。'); return date;
}
export const identity = entry => `${entry.kind==='weekly'?'weekly':'daily'}:${entry.kind==='weekly'?weekStart(entry.date):entry.date}`;
export function tags(value) {
  const values=Array.isArray(value)?value:String(value||'').split(/[,，、#\n]+/);
  return [...new Set(values.map(x=>String(x).trim()).filter(Boolean))].slice(0,30).map(x=>x.slice(0,40));
}
export function paperBody(blocks) {
  return BLOCKS.filter(([id])=>String(blocks?.[id]||'').trim()).map(([id,label])=>`## ${label}\n\n${blocks[id].trim()}`).join('\n\n');
}
export function splitPaper(body) {
  const blocks={}; let current=null; const intro=[];
  for(const line of String(body||'').split('\n')) {
    const heading=/^#{2,3}\s+(.+?)\s*$/.exec(line); const found=heading&&BLOCKS.find(([,label])=>label===heading[1]);
    if(found){current=found[0];blocks[current]||='';} else if(current)blocks[current]+=line+'\n'; else intro.push(line);
  }
  if(!Object.keys(blocks).length)return {journal:String(body||'')};
  if(intro.join('\n').trim())blocks.journal=[intro.join('\n').trim(),blocks.journal].filter(Boolean).join('\n\n');
  return Object.fromEntries(Object.entries(blocks).map(([k,v])=>[k,v.trim()]));
}
export function normalizeEntry(raw, previous=null, {draft=false, now=stamp()}={}) {
  if(!raw||typeof raw!=='object'||Array.isArray(raw))fail('记录格式不正确。');
  const kind=raw.kind||'daily'; if(!['daily','weekly'].includes(kind))fail('记录类型须为日记或周记。');
  let date=validateDate(raw.date||raw.journal_date); if(kind==='weekly')date=weekStart(date);
  const title=stringField(raw.title,'标题').trim(); if(title.length>200)fail('标题最多 200 字。');
  if(raw.blocks&&(typeof raw.blocks!=='object'||Array.isArray(raw.blocks)))fail('分格写作内容无效。');
  const blocks=raw.blocks?Object.fromEntries(BLOCKS.map(([id])=>[id,stringField(raw.blocks[id],'正文')])):null;
  const body=blocks?paperBody(blocks):stringField(raw.body??raw.content??raw.text,'正文');
  if(blocks&&Object.values(blocks).reduce((n,s)=>n+s.length,0)>MAX.body)fail('单篇内容最多 200,000 字，请拆成多篇。');
  const attachments=attachmentIds(raw.attachments);
  if(body.length>MAX.body)fail('单篇内容最多 200,000 字，请拆成多篇。');
  if(!draft&&!body.trim()&&!attachments.length)fail('写下一点内容，或添加附件，再收笔保存。');
  const result={ id:raw.id?validateId(raw.id):createId(), kind,date,title,body,blocks,
    tags:tags(raw.tags), attachments, bookmarked:Boolean(raw.bookmarked),
    createdAt:previous?.createdAt||raw.createdAt||now, updatedAt:nextTimestamp(previous?.updatedAt,now),
    deletedAt:raw.deletedAt||null, revisions:previous?.revisions?[...previous.revisions]:(raw.revisions||[]),
  };
  if(previous){
    result.id=previous.id;
    if(['kind','date','title','body','tags','attachments'].some(k=>JSON.stringify(result[k])!==JSON.stringify(previous[k]??(k==='kind'?'daily':k==='tags'||k==='attachments'?[]:null)))){
      const {revisions,...snapshot}=previous;result.revisions.push(snapshot);
    }
  }
  result.revisions=result.revisions.slice(-MAX.revisions);return result;
}
export function preferences(raw={}) {
  return {font:['serif','sans'].includes(raw.font)?raw.font:'serif',size:Math.max(16,Math.min(24,Number(raw.size)||18)),
    leading:Math.max(1.6,Math.min(2.4,Number(raw.leading)||2)),theme:['paper','night','mist'].includes(raw.theme)?raw.theme:'paper',
    motion:raw.motion!==false,writerMode:raw.writerMode==='plain'?'plain':'paper'};
}
export function filterEntries(entries,{term='',kind='',month='',tag='',bookmarked=false,order='newest'}={}) {
  const terms=term.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return entries.filter(e=>!e.deletedAt&&(!kind||(e.kind||'daily')===kind)&&(!month||e.date.startsWith(month))&&(!tag||(e.tags||[]).includes(tag))&&(!bookmarked||e.bookmarked)
    &&terms.every(word=>`${e.title}\n${e.body}\n${e.date}\n${(e.tags||[]).join(' ')}`.toLocaleLowerCase().includes(word)))
    .sort((a,b)=>(order==='oldest'?1:-1)*(a.date.localeCompare(b.date)||a.updatedAt.localeCompare(b.updatedAt)));
}
export function archiveStats(entries, year=new Date().getFullYear()) {
  const active=entries.filter(e=>!e.deletedAt), daily=active.filter(e=>(e.kind||'daily')==='daily');
  const months=Array.from({length:12},()=>({count:0,words:0})),dates=new Set(daily.map(e=>e.date)),tagCounts=new Map();
  for(const e of active){if(Number(e.date.slice(0,4))===Number(year)){const m=months[Number(e.date.slice(5,7))-1];m.count++;m.words+=countWords(e.body);}for(const tag of e.tags||[])tagCounts.set(tag,(tagCounts.get(tag)||0)+1);}
  let longest=0,current=0,prior=null;
  for(const date of [...dates].sort()){const day=Date.parse(date+'T00:00:00Z')/86400000;current=day===prior+1?current+1:1;longest=Math.max(longest,current);prior=day;}
  return {total:active.length,daily:daily.length,weekly:active.length-daily.length,words:active.reduce((n,e)=>n+countWords(e.body),0),longest,
    months,tags:[...tagCounts].sort((a,b)=>b[1]-a[1]),first:active.map(e=>e.date).sort()[0]||null};
}
export function drawMemory(entries, mode='page', recent=[], random=Math.random) {
  const all=entries.filter(e=>!e.deletedAt&&e.body.trim());if(!all.length) return null;
  let pool=all.filter(e=>!recent.slice(-Math.min(7,all.length-1)).includes(e.id));if(!pool.length)pool=all;
  const entry=pool[Math.min(pool.length-1,Math.floor(random()*pool.length))];
  const lines=entry.body.split(/\n+/).map(x=>x.replace(/^#+\s*/, '').trim()).filter(x=>x.length>=8&&!/^[-*]\s*\[[ x]\]/i.test(x));
  const quote=lines[Math.min(lines.length-1,Math.floor(random()*lines.length))]||entry.body.slice(0,200);
  const related=mode==='thread'?all.filter(e=>e.id!==entry.id&&(e.tags||[]).some(t=>(entry.tags||[]).includes(t))).slice(0,4):[];
  return {entry,quote:mode==='page'?entry.body.slice(0,280):quote.slice(0,280),related};
}
export function validateBottle(raw, now=stamp()) {
  const title=stringField(raw.title,'信件标题'),body=stringField(raw.body,'信件正文');if(title.length>200)fail('标题最多 200 字。');
  const opensAt=new Date(raw.opensAt); if(!Number.isFinite(opensAt.getTime()))fail('请选择有效的开启时间。');
  if(!body.trim()&&!(raw.attachments||[]).length)fail('先写一封信，或放入照片、录音、视频。');
  if(body.length>MAX.body)fail('信件内容过长。');
  if(!raw.id&&opensAt.getTime()<=Date.parse(now))fail('开启时间需要晚于现在。');
  return {id:raw.id?validateId(raw.id):createId(),type:'bottle',title,body,opensAt:opensAt.toISOString(),createdAt:raw.createdAt||now,
    openedAt:raw.openedAt||null,attachments:attachmentIds(raw.attachments),scene:['moon','dawn','dusk'].includes(raw.scene)?raw.scene:'moon'};
}
export function bottleState(bottle,now=Date.now()) {return bottle.openedAt?'opened':Date.parse(bottle.opensAt)<=Number(now)?'ready':'sealed';}

export const POEMS = [
  {id:'mountain-evening',title:'山居秋暝',author:'王维',era:'唐',tags:['山林','秋天','宁静'],body:'空山新雨后，天气晚来秋。\n明月松间照，清泉石上流。\n竹喧归浣女，莲动下渔舟。\n随意春芳歇，王孙自可留。'},
  {id:'drinking-five',title:'饮酒·其五',author:'陶渊明',era:'东晋',tags:['日常','田园','独处'],body:'结庐在人境，而无车马喧。\n问君何能尔？心远地自偏。\n采菊东篱下，悠然见南山。\n山气日夕佳，飞鸟相与还。\n此中有真意，欲辨已忘言。'},
  {id:'rain-calm',title:'定风波·莫听穿林打叶声',author:'苏轼',era:'宋',tags:['风雨','从容','远行'],body:'莫听穿林打叶声，何妨吟啸且徐行。\n竹杖芒鞋轻胜马，谁怕？一蓑烟雨任平生。\n料峭春风吹酒醒，微冷，山头斜照却相迎。\n回首向来萧瑟处，归去，也无风雨也无晴。'},
  {id:'spring-night',title:'春夜喜雨',author:'杜甫',era:'唐',tags:['春天','雨','生长'],body:'好雨知时节，当春乃发生。\n随风潜入夜，润物细无声。\n野径云俱黑，江船火独明。\n晓看红湿处，花重锦官城。'},
  {id:'bamboo',title:'竹里馆',author:'王维',era:'唐',tags:['独处','月光','宁静'],body:'独坐幽篁里，弹琴复长啸。\n深林人不知，明月来相照。'},
  {id:'river-snow',title:'江雪',author:'柳宗元',era:'唐',tags:['冬天','雪','独处'],body:'千山鸟飞绝，万径人踪灭。\n孤舟蓑笠翁，独钓寒江雪。'},
  {id:'west-lake',title:'钱塘湖春行',author:'白居易',era:'唐',tags:['春天','散步','湖'],body:'孤山寺北贾亭西，水面初平云脚低。\n几处早莺争暖树，谁家新燕啄春泥。\n乱花渐欲迷人眼，浅草才能没马蹄。\n最爱湖东行不足，绿杨阴里白沙堤。'},
  {id:'snow-evening',title:'问刘十九',author:'白居易',era:'唐',tags:['朋友','冬天','日常'],body:'绿蚁新醅酒，红泥小火炉。\n晚来天欲雪，能饮一杯无？'},
  {id:'autumn-words',title:'秋词·其一',author:'刘禹锡',era:'唐',tags:['秋天','希望','晴空'],body:'自古逢秋悲寂寥，我言秋日胜春朝。\n晴空一鹤排云上，便引诗情到碧霄。'},
  {id:'spring-hill',title:'游山西村',author:'陆游',era:'宋',tags:['田园','希望','远行'],body:'莫笑农家腊酒浑，丰年留客足鸡豚。\n山重水复疑无路，柳暗花明又一村。\n箫鼓追随春社近，衣冠简朴古风存。\n从今若许闲乘月，拄杖无时夜叩门。'},
  {id:'quiet-night',title:'静夜思',author:'李白',era:'唐',tags:['故乡','月光','思念'],body:'床前明月光，疑是地上霜。\n举头望明月，低头思故乡。'},
  {id:'riverside',title:'江畔独步寻花·其六',author:'杜甫',era:'唐',tags:['花','春天','散步'],body:'黄四娘家花满蹊，千朵万朵压枝低。\n留连戏蝶时时舞，自在娇莺恰恰啼。'},
];
