import * as db from './workspace.js';
import {BLOCKS,localDate,createId,weekStart,isoWeek,splitPaper,paperBody,normalizeEntry,tags,countWords,filterEntries,archiveStats,drawMemory,bottleState,preferences,POEMS,stamp} from './domain.js';
import {parseFiles,encryptBackup} from './transfer.js';
import {saveFile,portable,markdown} from './transfer.js';
import {mountViews,svg} from './views.js';
import {initCompanion} from './companion.js';
import {initAI} from './questions.js';

mountViews();
const $=selector=>document.querySelector(selector),$$=selector=>[...document.querySelectorAll(selector)];
const text=(selector,value)=>{$(selector).textContent=value;};
export const el=(tag,cls='',value='')=>{const n=document.createElement(tag);n.className=cls;n.textContent=value;return n;};
const icon=name=>{const span=el('span','inline-icon');span.innerHTML=svg(name);return span;};
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const err=error=>error?.message||'操作未完成，请保留当前内容后重试。';
const size=bytes=>bytes<1024*1024?`${Math.max(1,Math.round(bytes/1024))} KB`:`${(bytes/1024/1024).toFixed(1)} MB`;
let toastTimer;
export function notify(message){text('#toast',message);$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>{$('#toast').hidden=true;},4800);}
export const safe=operation=>async event=>{try{await operation(event);}catch(error){notify(err(error));}};
const on=(selector,event,operation)=>$(selector).addEventListener(event,safe(operation));
export function action(title,copy,{password=false,repeat=false,yes='确认'}={}){
  const dialog=$('#action-dialog');text('#action-title',title);text('#action-copy',copy);text('#action-yes',yes);text('#action-error','');
  for(const id of ['action-input','action-label'])$('#'+id).hidden=!password;
  for(const id of ['action-repeat','action-repeat-label'])$('#'+id).hidden=!repeat;
  $('#action-input').value=$('#action-repeat').value='';dialog.showModal();
  return new Promise(resolve=>{
    const finish=value=>{dialog.close();$('#action-form').onsubmit=null;$('#action-no').onclick=null;dialog.oncancel=null;resolve(value);};
    $('#action-form').onsubmit=event=>{event.preventDefault();if(repeat&&$('#action-input').value!==$('#action-repeat').value){text('#action-error','两次密码不一致，请重新输入。');return;}if(repeat&&$('#action-input').value.length<8){text('#action-error','密码至少 8 个字符。');return;}finish(password?$('#action-input').value:true);};
    $('#action-no').onclick=()=>finish(null);dialog.oncancel=event=>{event.preventDefault();finish(null);};
    if(password)$('#action-input').focus();else $('#action-no').focus();
  });
}
const state={entries:[],drafts:[],items:[],prefs:preferences(),history:[],favoritePoems:[],route:'today',ready:false};
let channel,currentEntry=null,archiveKind='',archiveTag='',archiveLimit=30,calendarDate='',atticTab='overview',bottleFilter='',drawMode='page',poemIndex=0,importData=null,importFingerprint='';
const scrolled=new Map();
function critical(message){text('#storage-error',message);$('#storage-error').hidden=false;}
function empty(title,copy){const n=el('div','empty');n.append(el('h3','',title),el('p','',copy));return n;}
function button(label,operation,cls='text-button'){const n=el('button',cls,label);n.type='button';n.onclick=safe(operation);return n;}
function card(entry){
  const n=el('button','entry-card');n.type='button';n.setAttribute('aria-label',`阅读 ${entry.date} ${entry.kind==='weekly'?'周记 ':''}${entry.title||'无题'}`);
  const date=el('span','entry-calendar');date.append(el('strong','',String(Number(entry.date.slice(8)))),el('small','',entry.date.slice(0,7).replace('-',' / ')));
  const content=el('span'),title=el('strong','entry-title');if(entry.kind==='weekly')title.append(el('span','entry-kind','周记'));title.append(document.createTextNode(entry.title||'无题'));if(entry.bookmarked)title.append(el('span','bookmark-mark',' · 彩笺'));
  const excerpt=entry.body.replace(/^---\n[\s\S]*?\n---\n/,'').replace(/^#+\s*/gm,'').replace(/\n/g,' ').slice(0,140);content.append(title,el('span','entry-excerpt',excerpt||`${entry.attachments.length} 个附件`));n.append(date,content,icon('arrow'));n.onclick=safe(()=>openReader(entry.id));return n;
}
function broadcast(){channel?.postMessage('changed');}
async function refresh(){
  [state.entries,state.drafts,state.items,state.history,state.favoritePoems]=await Promise.all([db.entries({deleted:true}),db.all('drafts'),db.all('items'),db.getMeta('draw-history',[]),db.getMeta('poem-favorites',[])]);
  renderToday();renderArchive();renderBottles();renderDrawHistory();renderPoem();renderAttic();renderTrash();ai?.refresh();
  const assets=await db.all('assets');text('#storage-summary',`${active().length} 页 · ${assets.length} 个附件 · ${size(assets.reduce((n,a)=>n+a.size,0))}`);
}
const active=()=>state.entries.filter(e=>!e.deletedAt);
function renderToday(){
  const records=active();text('#entry-count',String(records.length).padStart(2,'0'));text('#write-today span',records.some(e=>e.kind==='daily'&&e.date===localDate())?'继续写今天':'写今天');
  $('#recent-list').replaceChildren(...(records.length?records.slice(0,4).map(card):[empty('第一篇，还在等你。','写一件小事，或从「设置」带入已有的日记。')]));
  $('#draft-list').replaceChildren(...state.drafts.filter(d=>d.body||d.title||d.attachments?.length).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).map(d=>{
    const n=button('',()=>openWriter(null,d),'draft-card'),content=el('span');content.append(el('small','',`一页未完 · ${d.kind==='weekly'?'周记':'日记'} · ${d.date}`),el('strong','',d.title||'继续上次的草稿'));n.append(content,icon('arrow'));return n;
  }));
  const anniversary=records.filter(e=>e.kind==='daily'&&e.date.slice(5)===localDate().slice(5)&&e.date<localDate());
  $('#anniversary-list').replaceChildren(...(anniversary.length?anniversary.slice(0,3).map(card):[empty('时间慢慢走，旧日慢慢来。','往年同一天写下的记录，会在这里与你重逢。')]));
  const due=state.items.filter(i=>i.type==='bottle'&&bottleState(i)==='ready').length;text('#bottle-due',due?`${due} 封来信，等你开启`:'把此刻交给时间');
}
function archiveQuery(){return {term:$('#archive-search').value,kind:archiveKind==='bookmarked'?'':archiveKind,bookmarked:archiveKind==='bookmarked',month:$('#archive-month').value,tag:archiveTag,order:$('#archive-order').value};}
function renderArchive(){
  let matches=filterEntries(state.entries,archiveQuery());if(calendarDate)matches=matches.filter(e=>e.date===calendarDate);
  text('#archive-count',`${matches.length} 页${calendarDate?' · '+calendarDate:''}`);$('#archive-list').replaceChildren(...(matches.length?matches.slice(0,archiveLimit).map(card):[empty('这一处，暂时没有旧页。','换个日期或关键词，或者为今天写一页。')]));$('#more-entries').hidden=matches.length<=archiveLimit;
  const allTags=archiveStats(state.entries).tags;$('#archive-tags').replaceChildren(...allTags.slice(0,12).map(([tag,count])=>{const b=button(`${tag} ${count}`,()=>{archiveTag=archiveTag===tag?'':tag;archiveLimit=30;renderArchive();},'');b.setAttribute('aria-pressed',String(tag===archiveTag));return b;}));
  if(!$('#archive-calendar').hidden)renderCalendar();
}
function renderCalendar(){
  const month=$('#archive-month').value||localDate().slice(0,7),[year,number]=month.split('-').map(Number),count=new Date(year,number,0).getDate(),first=(new Date(year,number-1,1).getDay()+6)%7;
  const root=$('#archive-calendar');root.replaceChildren();const head=el('div','calendar-heading');head.append(button('‹',()=>shiftMonth(-1),'icon-button'),el('strong','',`${year} 年 ${number} 月`),button('›',()=>shiftMonth(1),'icon-button'));root.append(head);const grid=el('div','calendar-grid');for(const day of ['一','二','三','四','五','六','日'])grid.append(el('span','',day));for(let i=0;i<first;i++)grid.append(el('span'));
  for(let day=1;day<=count;day++){const date=`${month}-${String(day).padStart(2,'0')}`,saved=active().some(e=>e.date===date);const b=button(String(day),()=>{calendarDate=calendarDate===date?'':date;renderArchive();},`${saved?'has-entry ':''}${date===localDate()?'today ':''}${date===calendarDate?'selected':''}`);b.setAttribute('aria-label',`${date}${saved?'，有记录':''}`);b.setAttribute('aria-pressed',String(calendarDate===date));grid.append(b);}root.append(grid);
}
function shiftMonth(delta){const [year,month]=($('#archive-month').value||localDate().slice(0,7)).split('-').map(Number);$('#archive-month').value=localDate(new Date(year,month-1+delta,1)).slice(0,7);calendarDate='';renderArchive();}
function route(){
  const next=location.hash.slice(1)||'today';if(!$('#view-'+next)){location.hash='today';return;}
  scrolled.set(state.route,scrollY);state.route=next;$$('.view').forEach(v=>{v.hidden=v.id!=='view-'+next;});
  const tab=['today','archive','companion'].includes(next)?next:'explore';$$('.tabbar [data-tab]').forEach(a=>{if(a.dataset.tab===tab)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
  document.title=`LifeOS · ${$('#view-'+next+' h1')?.textContent||'随身档案'}`;window.scrollTo(0,scrolled.get(next)||0);if(next==='attic')renderAttic();if(next==='bottles')renderBottles();
}
window.addEventListener('hashchange',route);

// Writer: several independent durable drafts; a save atomically commits the entry
// and removes precisely the draft version being saved. Cross-tab edits conflict.
let writer=null,draftToken=null,writerEpoch=0,savedEpoch=0,writerTimer,writerQueue=Promise.resolve(),writerBusy=false,attachmentBusy=false,paperMode=true,activeCell='journal';
function writerInput(){return {id:writer.id,kind:$('#entry-kind').value,date:$('#entry-date').value,title:$('#entry-title').value,
  blocks:paperMode?Object.fromEntries(BLOCKS.map(([id])=>[id,$('#cell-'+id).value])):null,body:$('#entry-body').value,tags:tags($('#entry-tags').value),attachments:[...writer.attachments],entryId:writer.entryId,baseUpdatedAt:writer.baseUpdatedAt};}
function lockWriter(locked){writerBusy=locked;for(const n of $$('#writer-form input,#writer-form textarea,#writer-form select,#writer-form button'))n.disabled=locked;}
function updateWriterCount(){const raw=writerInput();text('#word-count',`${countWords(raw.blocks?paperBody(raw.blocks):raw.body).toLocaleString('zh-CN')} 字 · ${raw.kind==='weekly'?'第 '+isoWeek(raw.date||localDate()).week+' 周':'日记'}`);}
function dirty(){writerEpoch++;text('#draft-status','正在保存草稿…');text('#writer-error','');updateWriterCount();clearTimeout(writerTimer);writerTimer=setTimeout(()=>persistDraft().catch(error=>{text('#draft-status','草稿尚未保存');text('#writer-error',err(error));}),350);}
function persistDraft(){
  clearTimeout(writerTimer);if(!writer)return Promise.resolve();const payload=writerInput(),epoch=writerEpoch;
  writerQueue=writerQueue.catch(()=>{}).then(async()=>{const draft=await db.saveDraft(payload,{expectedUpdatedAt:draftToken});draftToken=draft.updatedAt;savedEpoch=epoch;if(epoch===writerEpoch)text('#draft-status','草稿已保存在本机');return draft;});return writerQueue;
}
async function flushDraft(){clearTimeout(writerTimer);if(writerEpoch!==savedEpoch)await persistDraft();else await writerQueue;}
function drawPaperTabs(){
  $('#paper-tabs').replaceChildren(...BLOCKS.map(([id,label])=>{const b=button(label,()=>{activeCell=id;showCell();},'');b.dataset.cell=id;b.setAttribute('aria-pressed',String(activeCell===id));return b;}));
}
function showCell(){for(const [id]of BLOCKS){$('#paper-'+id).hidden=id!==activeCell;}$$('#paper-tabs button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.cell===activeCell)));}
function applyWriterMode(){
  $('#paper-tabs').hidden=$('#paper-cells').hidden=!paperMode;$('#entry-body').hidden=paperMode;text('#writer-mode',paperMode?'整页写作':'分格写作');$('#writer-mode').setAttribute('aria-pressed',String(!paperMode));
}
async function openWriter(entry=null,draft=null,kind='daily'){
  if(!state.ready)return notify('本机存储尚未准备好。请查看页面顶部提示。');
  if(!draft&&entry)draft=state.drafts.find(d=>d.entryId===entry.id)||null;
  const source=draft||entry||{kind,date:kind==='weekly'?weekStart(localDate()):localDate(),title:'',body:'',attachments:[],tags:[]};
  writer={...source,id:draft?.id||createId(),entryId:draft?.entryId||entry?.id||null,baseUpdatedAt:draft?.baseUpdatedAt||entry?.updatedAt||null,attachments:[...source.attachments||[]]};
  draftToken=draft?.updatedAt||null;writerEpoch=savedEpoch=0;writerQueue=Promise.resolve();paperMode=source.blocks!==null&&(!!source.blocks||!source.body||state.prefs.writerMode==='paper');activeCell='journal';
  $('#entry-kind').value=source.kind||'daily';$('#entry-date').value=source.date;$('#entry-title').value=source.title;$('#entry-body').value=source.body;$('#entry-tags').value=(source.tags||[]).join('，');
  const blocks=source.blocks||splitPaper(source.body);$('#paper-cells').replaceChildren(...BLOCKS.map(([id,label,placeholder],i)=>{
    const cell=el('section','paper-cell');cell.id='paper-'+id;const name=el('label','',label);name.htmlFor='cell-'+id;name.append(el('small','',`0${i+1} / PAPER`));const area=el('textarea');area.id='cell-'+id;area.placeholder=placeholder;area.maxLength=200000;area.value=blocks[id]||'';area.addEventListener('input',dirty);cell.append(name,area);return cell;
  }));drawPaperTabs();showCell();applyWriterMode();updateWriterCount();text('#writer-error','');text('#draft-status',draft?'已恢复本机草稿':'草稿自动保存在本机');await renderAttachments('#writer-attachments',writer.attachments,{remove:id=>{writer.attachments=writer.attachments.filter(x=>x!==id);dirty();renderAttachments('#writer-attachments',writer.attachments,{remove:removeWriterAsset}).catch(e=>notify(err(e)));}});$('#writer').showModal();
}
function removeWriterAsset(id){writer.attachments=writer.attachments.filter(x=>x!==id);dirty();return renderAttachments('#writer-attachments',writer.attachments,{remove:removeWriterAsset});}
async function closeWriter(){if(writerBusy||attachmentBusy)return notify('正在保存，请稍候。');try{lockWriter(true);await flushDraft();$('#writer').close();writer=null;await refresh();broadcast();}catch(error){text('#writer-error',err(error));text('#draft-status','草稿尚未保存');}finally{lockWriter(false);}}
for(const selector of ['#entry-kind','#entry-date','#entry-title','#entry-body','#entry-tags'])on(selector,'input',dirty);
on('#writer-mode','click',()=>{if(paperMode)$('#entry-body').value=paperBody(writerInput().blocks);else{const blocks=splitPaper($('#entry-body').value);for(const [id]of BLOCKS)$('#cell-'+id).value=blocks[id]||'';}paperMode=!paperMode;applyWriterMode();dirty();});
on('#close-writer','click',closeWriter);$('#writer').addEventListener('cancel',event=>{event.preventDefault();void closeWriter();});
on('#writer-form','submit',async event=>{
  event.preventDefault();if(writerBusy||attachmentBusy)return;lockWriter(true);
  try{await flushDraft();const input=writerInput();const saved=await db.saveEntry({...input,id:writer.entryId||undefined},{expectedUpdatedAt:writer.baseUpdatedAt,draftId:writer.id,draftUpdatedAt:draftToken});$('#writer').close();writer=null;await refresh();broadcast();notify('这一页，已好好收下。');}
  catch(error){text('#writer-error',err(error));}finally{lockWriter(false);}
});
on('#discard-draft','click',async()=>{if(writerBusy||attachmentBusy)return;if(!await action('舍弃这次草稿？','已收笔的原文不受影响，这份草稿的未保存文字会移除。',{yes:'舍弃'}))return;await writerQueue.catch(()=>{});clearTimeout(writerTimer);if(draftToken)await db.deleteDraft(writer.id,draftToken);writer=null;$('#writer').close();await refresh();broadcast();});
on('#write-today','click',()=>openWriter(active().find(e=>e.kind==='daily'&&e.date===localDate())));on('#nav-write','click',()=>openWriter(active().find(e=>e.kind==='daily'&&e.date===localDate())));
on('#write-week','click',()=>openWriter(active().find(e=>e.kind==='weekly'&&weekStart(e.date)===weekStart(localDate())),null,'weekly'));on('#write-another','click',()=>openWriter());
on('#add-attachment','click',()=>$('#attachment-file').click());on('#attachment-file','change',async event=>{attachmentBusy=true;$('#add-attachment').disabled=true;try{for(const file of event.target.files){const asset=await db.addAsset(file);writer.attachments.push(asset.id);dirty();await persistDraft();}await renderAttachments('#writer-attachments',writer.attachments,{remove:removeWriterAsset});}finally{attachmentBusy=false;$('#add-attachment').disabled=false;event.target.value='';}});

// Markdown is rendered as DOM text nodes; imported HTML can never execute.
function renderProse(target,body){
  const root=typeof target==='string'?$(target):target;root.replaceChildren();let paragraph=[],code=[],inCode=false,list=null;
  const flush=()=>{if(paragraph.length){root.append(el('p','',paragraph.join('\n')));paragraph=[];}list=null;};
  for(const line of String(body||'').split('\n')){
    if(/^```/.test(line)){flush();if(inCode){root.append(el('pre','',code.join('\n')));code=[];}inCode=!inCode;continue;}
    if(inCode){code.push(line);continue;}const title=/^(#{1,6})\s+(.+)$/.exec(line),task=/^\s*[-*]\s+\[([ xX])\]\s*(.*)$/.exec(line),bullet=/^\s*[-*]\s+(.+)$/.exec(line);
    if(title){flush();root.append(el(title[1].length<=2?'h2':'h3','',title[2]));}
    else if(task){flush();const p=el('p','task-line'),mark=el('span','task-mark',task[1].toLowerCase()==='x'?'✓':'');mark.setAttribute('aria-label',task[1].toLowerCase()==='x'?'已完成':'未完成');p.append(mark,document.createTextNode(task[2]));root.append(p);}
    else if(bullet){if(paragraph.length)flush();if(!list){list=el('ul');root.append(list);}list.append(el('li','',bullet[1]));}
    else if(/^>\s?/.test(line)){flush();root.append(el('blockquote','',line.replace(/^>\s?/,'')));}
    else if(!line.trim())flush();else paragraph.push(line);
  }flush();if(code.length)root.append(el('pre','',code.join('\n')));
}
const objectUrls=new Map();
export async function renderAttachments(selector,ids,{remove}={}){
  const root=$(selector);for(const url of objectUrls.get(selector)||[])URL.revokeObjectURL(url);const urls=[];objectUrls.set(selector,urls);root.replaceChildren();
  for(const id of ids||[]){const asset=await db.get('assets',id);if(!asset){root.append(el('p','error','附件暂不可读，请从完整备份恢复。'));continue;}
    const url=URL.createObjectURL(new Blob([asset.data],{type:asset.type}));urls.push(url);const item=el('div','attachment-card');
    const image=/^image\/(png|jpeg|webp|gif|avif|heic)$/.test(asset.type),audio=asset.type.startsWith('audio/'),video=asset.type.startsWith('video/');
    if(image||audio||video){const media=el(image?'img':audio?'audio':'video');media.src=url;if(image){media.alt=asset.name;media.loading='lazy';}else{media.controls=true;media.preload='metadata';if(video)media.playsInline=true;}item.append(media);}
    const caption=el('div','attachment-caption'),name=el('span','',asset.name);name.append(el('small','',size(asset.size)));caption.append(name,button(remove?'移除':'保存',()=>remove?remove(id):saveFile(new File([asset.data],asset.name,{type:asset.type})),remove?'danger':''));item.append(caption);root.append(item);
  }
}
async function openReader(id){
  const entry=await db.get('entries',id);if(!entry||entry.deletedAt)return notify('这页暂不在档案中，可到回收站查看。');currentEntry={...entry,kind:entry.kind||'daily',attachments:entry.attachments||[],tags:entry.tags||[]};
  text('#reader-date',entry.date+(entry.kind==='weekly'?` · 第 ${isoWeek(entry.date).week} 周`:' · 日记'));text('#reader-title',entry.title||'无题');text('#reader-word-count',`${countWords(entry.body).toLocaleString('zh-CN')} 字`);renderProse('#reader-body',entry.body);
  $('#reader-tags').replaceChildren(...currentEntry.tags.map(t=>el('span','tag-pill',t)));$('#bookmark-entry').setAttribute('aria-pressed',String(!!entry.bookmarked));$('#bookmark-entry').setAttribute('aria-label',entry.bookmarked?'移除这页彩笺':'为这页留一枚彩笺');await renderAttachments('#reader-attachments',currentEntry.attachments);
  const revisions=entry.revisions||[];$('#history-details').hidden=!revisions.length;$('#history-details').open=false;text('#revision-count',`· ${revisions.length} 个版本`);
  $('#history-list').replaceChildren(...[...revisions].reverse().map(revision=>{const block=el('div','revision');block.append(el('small','meta',new Date(revision.updatedAt).toLocaleString('zh-CN')),el('h3','',revision.title||'无题'),el('pre','',revision.body),button('恢复这一版',async()=>{
    if(!await action('恢复这份原文？','恢复会创建一个新版本；当前内容和附件引用仍保留在历史中。'))return;
    await db.saveEntry({...revision,id:currentEntry.id},{expectedUpdatedAt:currentEntry.updatedAt});await refresh();broadcast();await openReader(currentEntry.id);notify('已恢复原文，当前版本也留在历史中。');
  }));return block;}));
  const index=active().findIndex(e=>e.id===entry.id);$('#previous-entry').disabled=index<=0;$('#next-entry').disabled=index<0||index>=active().length-1;
  if(!$('#reader').open)$('#reader').showModal();$('#reader').scrollTop=0;
}
on('#close-reader','click',()=>$('#reader').close());on('#edit-entry','click',()=>{const e=currentEntry;$('#reader').close();return openWriter(e);});
on('#bookmark-entry','click',async()=>{await db.updateEntry(currentEntry.id,{bookmarked:!currentEntry.bookmarked},{expectedUpdatedAt:currentEntry.updatedAt});await refresh();broadcast();await openReader(currentEntry.id);});
on('#delete-entry','click',async()=>{if(!await action('将这页收进回收站？','原文、附件与版本会保留，可在「设置 → 回收站」恢复。',{yes:'移到回收站'}))return;await db.updateEntry(currentEntry.id,{deletedAt:stamp()},{expectedUpdatedAt:currentEntry.updatedAt});$('#reader').close();await refresh();broadcast();notify('已收进回收站，可以恢复。');});
for(const [id,offset]of [['previous-entry',-1],['next-entry',1]])on('#'+id,'click',()=>{const list=active(),index=list.findIndex(e=>e.id===currentEntry.id);if(list[index+offset])return openReader(list[index+offset].id);});
on('#export-entry','click',()=>saveFile(new File([markdown(currentEntry)],`${currentEntry.date}-${currentEntry.kind==='weekly'?'周记':'日记'}.md`,{type:'text/markdown'})));
on('#ask-from-entry','click',()=>{ai.select(currentEntry.id);$('#reader').close();location.hash='ask';});
function renderTrash(){const trash=state.entries.filter(e=>e.deletedAt);$('#trash-list').replaceChildren(...(trash.length?trash.map(e=>{const row=el('div','trash-row'),name=el('div');name.append(el('strong','',e.title||'无题'),el('small','',e.date+(e.kind==='weekly'?' · 周记':'')));row.append(name,button('恢复',async()=>{await db.updateEntry(e.id,{deletedAt:null},{expectedUpdatedAt:e.updatedAt});await refresh();broadcast();notify('原文、附件与版本已恢复。');}));return row;}):[empty('这里空空的。','移入回收站的原文，会保留在这里。')]));}

for(const id of ['archive-search','archive-month','archive-order'])on('#'+id,'input',()=>{archiveLimit=30;calendarDate='';renderArchive();});
on('#archive-kinds','click',event=>{const b=event.target.closest('[data-kind]');if(!b)return;archiveKind=b.dataset.kind;archiveLimit=30;$$('#archive-kinds button').forEach(n=>n.setAttribute('aria-pressed',String(n===b)));renderArchive();});
on('#clear-filter','click',()=>{archiveKind=archiveTag=calendarDate='';$('#archive-search').value=$('#archive-month').value='';$$('#archive-kinds button').forEach(b=>b.setAttribute('aria-pressed',String(!b.dataset.kind)));renderArchive();});
on('#show-calendar','click',()=>{const node=$('#archive-calendar');node.hidden=!node.hidden;$('#show-calendar').setAttribute('aria-expanded',String(!node.hidden));text('#show-calendar',node.hidden?'展开日历':'收起日历');renderCalendar();});on('#more-entries','click',()=>{archiveLimit+=30;renderArchive();});

function renderAttic(){
  const root=$('#attic-content'),stats=archiveStats(state.entries);root.replaceChildren();
  if(atticTab==='overview'){
    const grid=el('div','stats-grid');for(const [value,label]of [[stats.daily,'页日记'],[stats.weekly,'篇周记'],[stats.words.toLocaleString('zh-CN'),'字原文'],[stats.longest,'天最长连续记录']]){const n=el('div','stat');n.append(el('strong','',String(value)),el('span','',label));grid.append(n);}root.append(grid);
    root.append(el('p','meta',stats.first?`最初一页，写在 ${stats.first}。统计只依据当前未删除的原文。`:'还没有原文。从第一篇日记开始，档案会慢慢有自己的形状。'));
    const h=el('div','section-head');h.append(el('h2','',`${new Date().getFullYear()} · 月度书写`));root.append(h,monthChart(stats.months));
    const years=[...new Set(active().map(e=>e.date.slice(0,4)))].sort().reverse();for(const year of years){const line=el('div','coverage-line');line.append(el('span','',year),button(`${active().filter(e=>e.date.startsWith(year)).length} 页原文 ↗`,()=>{location.hash='archive';$('#archive-search').value=year;renderArchive();}));root.append(line);}
  }else if(atticTab==='review'){
    for(const month of [...new Set(active().map(e=>e.date.slice(0,7)))].sort().reverse()){const group=el('section','timeline-group');group.append(el('h3','',`${month} · ${active().filter(e=>e.date.startsWith(month)).length} 页`),...active().filter(e=>e.date.startsWith(month)).slice(0,5).map(card),button('翻阅这个月 ↗',()=>{location.hash='archive';$('#archive-month').value=month;renderArchive();}));root.append(group);}
  }else if(atticTab==='organize'){
    root.append(el('p','notice','标签和纸格保留原文位置。这里整理线索，不替你给生活下结论。'));
    for(const [tag,count]of stats.tags){const group=el('section','organize-tag');group.append(el('h3','',tag),el('p','meta',`${count} 页有这个标签`),...active().filter(e=>e.tags.includes(tag)).slice(0,3).map(card),button('查看全部原文 ↗',()=>{archiveTag=tag;location.hash='archive';renderArchive();}));root.append(group);}
    if(!stats.tags.length)root.append(empty('线索，可以从一个标签开始。','写作时为原文加上「工作」「散步」之类的标签，这里就有了回去的路径。'));
  }else{
    const heading=el('div','section-head');heading.append(el('h2','',`${new Date().getFullYear()} · 写作字数`));root.append(heading,monthChart(stats.months,true),el('p','meta','柱状图对应每月原文字数。点某个月，可回到当月全部日记与周记。'));
    const days=Array.from({length:7},()=>0);for(const e of active())days[(new Date(e.date+'T12:00:00').getDay()+6)%7]++;
    for(const [i,label]of ['周一','周二','周三','周四','周五','周六','周日'].entries()){const row=el('div','coverage-line');row.append(el('span','',label),el('span','',`${days[i]} 页`));root.append(row);}root.append(el('p','quiet-note','记录不是考核。\n空白的日子，也是真实生活的一部分。'));
  }
  if(!active().length&&atticTab==='review')root.append(empty('阁楼，还等着第一卷。','保存日记或导入旧记录后，就能沿时间回看。'));
}
function monthChart(months,words=false){const chart=el('div','month-chart'),max=Math.max(1,...months.map(m=>words?m.words:m.count));months.forEach((m,index)=>{const value=words?m.words:m.count,b=button('',()=>{location.hash='archive';$('#archive-month').value=`${new Date().getFullYear()}-${String(index+1).padStart(2,'0')}`;renderArchive();},'');b.setAttribute('aria-label',`${index+1} 月 ${value}${words?'字':'页'}`);const bar=el('i');bar.style.height=Math.max(3,110*value/max)+'px';b.append(el('b','',value?String(value):''),bar,el('span','',String(index+1)));chart.append(b);});return chart;}
on('#attic-tabs','click',event=>{const b=event.target.closest('[data-attic]');if(!b)return;atticTab=b.dataset.attic;$$('#attic-tabs button').forEach(n=>n.setAttribute('aria-pressed',String(n===b)));renderAttic();});

on('#draw-modes','click',event=>{const b=event.target.closest('[data-mode]');if(!b)return;drawMode=b.dataset.mode;$$('#draw-modes button').forEach(n=>n.setAttribute('aria-pressed',String(n===b)));text('#draw-mode-note',({page:'从本机日记和周记中，重逢一篇原文。',echo:'从真实文字里，抽出一句旧日的回声。',thread:'遇见一页，再循共同标签找到相关的几页。'})[drawMode]);});
on('#draw-memory','click',async()=>{
  const result=drawMemory(active(),drawMode,state.history.map(x=>x.id));if(!result)return notify('先写一篇日记，或导入旧记录，旧日才能来相遇。');
  const root=$('#draw-stage');root.replaceChildren(el('span','draw-seal','遇'),el('p','eyebrow',result.entry.date),el('h2','',result.entry.title||'那一日'),el('blockquote','',result.quote),button('回到完整原文 ↗',()=>openReader(result.entry.id)));
  for(const related of result.related)root.append(button(`${related.date} · ${related.title||'无题'} ↗`,()=>openReader(related.id)));
  if(drawMode==='thread'&&!result.related.length)root.append(el('p','meta','这一页还没有共同标签的相关原文，可以在写作时补上标签。'));
  state.history=[...state.history,{id:result.entry.id,mode:drawMode,at:stamp()}].slice(-40);await db.setMeta('draw-history',state.history);renderDrawHistory();broadcast();
});
function renderDrawHistory(){const matches=[...state.history].reverse().slice(0,8).map(h=>active().find(e=>e.id===h.id)).filter(Boolean);$('#draw-history').replaceChildren(...(matches.length?matches.map(card):[empty('还没有重逢的足迹。','每次抽到的原页，都会在这里留一条回去的路。')]));}
on('#clear-draw-history','click',async()=>{await db.setMeta('draw-history',[]);state.history=[];renderDrawHistory();});
let poems=POEMS;
function renderPoem(){const poem=poems[poemIndex%poems.length];$('#poem-stage').replaceChildren(el('p','eyebrow','A VERSE, KEPT CLOSE.'),el('h2','',poem.title),el('p','meta',[poem.era,poem.author].filter(Boolean).join(' · ')),el('div','poem-lines',poem.body),el('span','poem-seal','诗'));text('#favorite-poem',state.favoritePoems.includes(poem.id)?'已收藏 · 点此取消':'收藏这首');text('#poem-count',`${state.favoritePoems.length} 首`);
  $('#poem-favorites').replaceChildren(...state.favoritePoems.map(id=>poems.find(p=>p.id===id)).filter(Boolean).map(p=>{const row=el('div','poem-favorite'),name=el('div');name.append(el('strong','',p.title),el('small','',p.author));row.append(name,button('读全篇',()=>{poemIndex=poems.indexOf(p);renderPoem();$('#poem-stage').scrollIntoView({block:'start'});}));return row;}));
}
on('#another-poem','click',()=>{poemIndex=(poemIndex+1+Math.floor(Math.random()*(poems.length-1)))%poems.length;renderPoem();});on('#favorite-poem','click',async()=>{const id=poems[poemIndex%poems.length].id;state.favoritePoems=state.favoritePoems.includes(id)?state.favoritePoems.filter(x=>x!==id):[...state.favoritePoems,id];await db.setMeta('poem-favorites',state.favoritePoems);renderPoem();broadcast();});
on('#poem-for-journal','click',()=>{const today=active().find(e=>e.kind==='daily'&&e.date===localDate());if(today)ai.select(today.id);$('#question').value='请根据本次选定日记，为我推荐一首真实存在的古诗词，给出准确的标题、作者、全篇和与你所引用日记相连的缘由。材料不足时请直说，不要编造诗句。';location.hash='ask';notify(today?'已带上今天的日记，请核对选材后发送。':'请先选择一两页日记，再预览本次发送内容。');});

function applyPrefs(){const p=state.prefs;document.documentElement.dataset.theme=p.theme;document.documentElement.dataset.motion=p.motion?'on':'off';document.documentElement.style.setProperty('--reading-font',p.font==='sans'?'var(--sans)':'var(--serif)');document.documentElement.style.setProperty('--reading-size',p.size+'px');document.documentElement.style.setProperty('--leading',p.leading);for(const key of ['font','theme','size','leading'])$('#pref-'+key).value=p[key];$('#pref-motion').checked=p.motion;text('#pref-size-value',p.size);text('#pref-leading-value',p.leading);}
for(const key of ['font','theme','size','leading','motion'])on('#pref-'+key,'input',async()=>{state.prefs=preferences({...state.prefs,[key]:key==='motion'?$('#pref-motion').checked:$('#pref-'+key).value});applyPrefs();text('#appearance-status','正在收下外观设置…');try{await db.setMeta('appearance',state.prefs);text('#appearance-status','外观已保存在本机。');}catch(error){text('#appearance-status',err(error));}});
async function exportBackup(encrypted=false){
  const password=encrypted?await action('为完整备份设一个密码','至少 8 个字符。请把密码妥善保管，LifeOS 无法代为找回。',{password:true,repeat:true,yes:'生成加密备份'}):null;if(encrypted&&password===null)return;
  text('#data-status','正在读取原文与附件…');let data=await db.exportWorkspace();if(encrypted){text('#data-status','正在加密备份…');data=await encryptBackup(data,password);}await saveFile(new File([JSON.stringify(data)],`LifeOS-完整备份-${localDate()}${encrypted?'.lifeos':'.json'}`,{type:'application/json'}));text('#data-status','备份已生成，请确认文件已保存并可读取。');
}
on('#export-backup','click',()=>exportBackup());on('#export-encrypted','click',()=>exportBackup(true));on('#export-portable','click',async()=>{await saveFile(new File([JSON.stringify(portable(active()),null,2)],`LifeOS-日记导出-${localDate()}.json`,{type:'application/json'}));text('#data-status','文字日记与周记已导出；附件、草稿和漂流瓶请使用完整备份。');});
on('#import-backup','click',()=>$('#import-file').click());
on('#import-file','change',async event=>{
  const files=[...event.target.files];if(!files.length)return;$('#import-backup').disabled=true;text('#data-status','正在校验文件…');
  try{let password='';for(const file of files.filter(f=>/\.(lifeos|json)$/i.test(f.name))){const head=await file.slice(0,200).text();if(head.includes('lifeos-encrypted')){password=await action('打开密码备份','请输入这份备份创建时的密码。错误密码不会改变本机内容。',{password:true,yes:'解密并预览'});if(password===null)return;break;}}
    importData=await parseFiles(files,password);const existing=await db.entries({deleted:true});importFingerprint=db.fingerprint(existing);const plan=db.importPlan(importData.entries,existing);text('#import-summary',`${importData.entries.length} 页记录 · ${importData.assets.length} 个附件 · ${importData.drafts.length} 份草稿 · ${importData.items.filter(i=>i.type==='bottle').length} 封信。${plan.conflicts.length?`其中 ${plan.conflicts.length} 页与本机内容不同。`:'没有发现内容冲突。'}`);text('#import-warnings',[...new Set([...importData.warnings,...(importData.drafts.length||importData.items.length?['已有相同标识的草稿、信件或 AI 资料会保留本机版本；偏好设置也优先保留本机。请妥善保存原备份文件。']:[])])].join('\n'));text('#import-error','');$('#import-strategy').value='keep';
    const conflictIds=new Set(plan.conflicts.map(c=>c.incoming.id));$('#import-list').replaceChildren(...importData.entries.slice(0,100).map(entry=>{const row=el('article','import-row'+(conflictIds.has(entry.id)?' is-conflict':''));row.append(el('p','meta',`${entry.date} · ${entry.kind==='weekly'?'周记':'日记'}${conflictIds.has(entry.id)?' · 内容冲突':''}`),el('h3','',entry.title||'无题'),el('pre','',entry.body.slice(0,500)));return row;}));if(importData.entries.length>100)$('#import-list').append(el('p','meta',`仅展示前 100 页预览；确认后处理全部 ${importData.entries.length} 页。`));$('#import-preview').showModal();text('#data-status','校验完成，请核对导入预览。');
  }catch(error){text('#data-status',err(error));}finally{$('#import-backup').disabled=false;event.target.value='';}
});
on('#confirm-import','click',async()=>{if(!importData)return;const b=$('#confirm-import');b.disabled=true;try{const result=await db.applyImport(importData,{strategy:$('#import-strategy').value,expectedFingerprint:importFingerprint});$('#import-preview').close();importData=null;await refresh();broadcast();text('#data-status',`已导入 ${result.imported} 页，更新 ${result.replaced} 页，跳过 ${result.skipped} 页；导入 ${result.extraImported} 项草稿/信件/AI 资料，${result.extraKept} 项保留本机版本。`);notify('导入完成，原文已收进流年。');}catch(error){text('#import-error',err(error));}finally{b.disabled=false;}});
on('#close-import','click',()=>{$('#import-preview').close();importData=null;});
on('#persist-storage','click',async()=>{const allowed=await navigator.storage?.persist?.();text('#persist-result',allowed?'已获准保留本机存储。主动清理仍会删除数据，请继续定期备份。':'浏览器未授予持久存储，仍可正常保存，请定期导出完整备份。');});

let bottleBusy=false,recordPending=false;
function lockBottle(locked){bottleBusy=locked;for(const n of $$('#bottle-form input,#bottle-form textarea,#bottle-form select,#bottle-form button'))n.disabled=locked;}
let bottleAssets=[],bottleDraftTimer,recorder=null,recordStream=null,recordChunks=[],recordStart=0,recordLimit;
function bottleInput(){return {title:$('#bottle-subject').value,body:$('#bottle-body').value,opensAt:$('#bottle-opens').value,scene:$('#bottle-scene').value,attachments:[...bottleAssets]};}
async function keepBottleDraft(){await db.setMeta('bottle-draft',bottleInput());}
function bottleChanged(){clearTimeout(bottleDraftTimer);bottleDraftTimer=setTimeout(()=>keepBottleDraft().catch(e=>notify(err(e))),350);}
function renderBottles(){
  const bottles=state.items.filter(i=>i.type==='bottle'&&(!bottleFilter||bottleState(i)===bottleFilter)).sort((a,b)=>a.opensAt.localeCompare(b.opensAt));
  $('#bottle-list').replaceChildren(...(bottles.length?bottles.map(b=>{const status=bottleState(b),root=el('article','bottle-card');root.dataset.scene=b.scene;const badge=el('span','bottle-badge');badge.append(icon(status==='sealed'?'lock':'bottle'),document.createTextNode(({sealed:'交给时间',ready:'来信已到',opened:'已经重逢'})[status]));root.append(badge,el('h3','',b.title||'给未来的自己'),el('p','meta',`${status==='sealed'?'约定开启：':'开启时间：'}${new Date(b.opensAt).toLocaleString('zh-CN')}`),el('p','meta',`封存于 ${new Date(b.createdAt).toLocaleDateString('zh-CN')} · ${b.attachments.length} 个附件`));if(status!=='sealed')root.append(button(status==='ready'?'开启来信 ↗':'再读一次 ↗',async()=>{const opened=await db.openBottle(b.id);text('#bottle-reader-date',`封存于 ${new Date(opened.createdAt).toLocaleDateString('zh-CN')} · 重逢于 ${new Date(opened.openedAt).toLocaleDateString('zh-CN')}`);text('#bottle-reader-title',opened.title||'给未来的自己');renderProse('#bottle-reader-body',opened.body);await renderAttachments('#bottle-reader-files',opened.attachments);$('#bottle-reader').showModal();await refresh();broadcast();}));return root;}):[empty('未来，等一封你的信。','写下此刻的期待，或放进一段声音，在约定的时间再见。')]));
}
on('#new-bottle','click',async()=>{const draft=await db.getMeta('bottle-draft',{});const next=new Date(Date.now()+86400000*30);next.setMinutes(next.getMinutes()-next.getTimezoneOffset());$('#bottle-opens').value=draft.opensAt||next.toISOString().slice(0,16);$('#bottle-subject').value=draft.title||'';$('#bottle-body').value=draft.body||'';$('#bottle-scene').value=draft.scene||'moon';bottleAssets=[...draft.attachments||[]];await renderAttachments('#bottle-attachments',bottleAssets,{remove:removeBottleAsset});text('#bottle-error','');$('#bottle-writer').showModal();});
function removeBottleAsset(id){bottleAssets=bottleAssets.filter(x=>x!==id);bottleChanged();return renderAttachments('#bottle-attachments',bottleAssets,{remove:removeBottleAsset});}
for(const id of ['bottle-opens','bottle-subject','bottle-body','bottle-scene'])on('#'+id,'input',bottleChanged);
async function closeBottleWriter(){if(bottleBusy||recordPending)return notify('正在收下附件，请稍候。');if(recorder?.state==='recording')return notify('请先停止录音，声音会保留为附件。');clearTimeout(bottleDraftTimer);await keepBottleDraft();$('#bottle-writer').close();}
on('#close-bottle-writer','click',closeBottleWriter);$('#bottle-writer').addEventListener('cancel',e=>{e.preventDefault();void closeBottleWriter();});
on('#bottle-form','submit',async event=>{event.preventDefault();if(bottleBusy||recordPending)return notify('正在收下附件，请稍候。');if(recorder?.state==='recording')return notify('先停止录音，再封存信件。');lockBottle(true);try{clearTimeout(bottleDraftTimer);await db.saveItem({...bottleInput(),type:'bottle'},{clearBottleDraft:true});$('#bottle-writer').close();await refresh();broadcast();notify('信件已封存，约定的那天再见。');}catch(error){text('#bottle-error',err(error));}finally{lockBottle(false);}});
on('#bottle-filter','click',event=>{const b=event.target.closest('[data-state]');if(!b)return;bottleFilter=b.dataset.state;$$('#bottle-filter button').forEach(n=>n.setAttribute('aria-pressed',String(n===b)));renderBottles();});
on('#bottle-attach','click',()=>$('#bottle-file').click());on('#bottle-file','change',async event=>{if(bottleBusy||recordPending)return;lockBottle(true);try{for(const file of event.target.files){const asset=await db.addAsset(file);bottleAssets.push(asset.id);}await keepBottleDraft();await renderAttachments('#bottle-attachments',bottleAssets,{remove:removeBottleAsset});}finally{lockBottle(false);event.target.value='';}});
on('#record-bottle','click',async()=>{
  if(bottleBusy||recordPending)return;if(recorder?.state==='recording'){recordPending=true;recorder.stop();return;}
  if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder)return notify('此浏览器暂不支持直接录音，可以先用录音应用录好，再添加音频文件。');
  recordPending=true;try{recordStream=await navigator.mediaDevices.getUserMedia({audio:true});recordChunks=[];recordStart=Date.now();recorder=new MediaRecorder(recordStream);recorder.ondataavailable=event=>{if(event.data.size)recordChunks.push(event.data);};
    recorder.onstop=async()=>{recordPending=true;lockBottle(true);clearTimeout(recordLimit);recordStream.getTracks().forEach(t=>t.stop());text('#record-bottle','录一段声音');try{const mime=recorder.mimeType||'audio/webm',blob=new Blob(recordChunks,{type:mime});const asset=await db.addAsset(new File([blob],`给未来的声音-${localDate()}.${mime.includes('mp4')?'m4a':'webm'}`,{type:mime}));bottleAssets.push(asset.id);await keepBottleDraft();await renderAttachments('#bottle-attachments',bottleAssets,{remove:removeBottleAsset});text('#record-status',`已收下 ${Math.max(1,Math.round((Date.now()-recordStart)/1000))} 秒声音。`);}catch(error){text('#record-status',err(error));}finally{recordPending=false;lockBottle(false);}};
    recorder.start(1000);recordPending=false;text('#record-bottle','停止录音');text('#record-status','正在录音…再次点击停止。单次最多 5 分钟。');recordLimit=setTimeout(()=>{if(recorder.state==='recording'){recordPending=true;recorder.stop();}},300000);
  }catch(error){recordPending=false;recordStream?.getTracks().forEach(t=>t.stop());text('#record-status','未能开启麦克风。可以在浏览器设置中允许，或直接添加已有音频。');}
});
on('#close-bottle-reader','click',()=>$('#bottle-reader').close());

let ai;
ai=initAI({db,$,$$,el,button,notify,action,safe,entries:active,items:()=>state.items,openReader,refresh,broadcast});
const companion=initCompanion({db,$,el,button,notify,safe,ai});
let installPrompt;
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;$('#native-install').hidden=false;});on('#native-install','click',async()=>{await installPrompt?.prompt();installPrompt=null;$('#native-install').hidden=true;});
function connection(){text('#connection',navigator.onLine?'本机保存':'离线 · 本机保存');}
window.addEventListener('online',connection);window.addEventListener('offline',connection);
document.addEventListener('visibilitychange',()=>{if(document.hidden){if(writer)void flushDraft().catch(e=>notify(err(e)));if($('#bottle-writer').open)void keepBottleDraft().catch(e=>notify(err(e)));if(recorder?.state==='recording'){recordPending=true;recorder.stop();}}else{renderBottles();renderToday();}});
window.addEventListener('beforeunload',event=>{if(writer&&writerEpoch!==savedEpoch){event.preventDefault();event.returnValue='';}});
window.addEventListener('lifeos:store-version',()=>critical('档案数据库已升级。请保留当前未收笔内容，然后刷新本页以使用新版本。'));
async function offline(){
  if(new URLSearchParams(location.search).get('preview')==='1'){text('#offline-ready','本机保存 · 开发预览');return;}
  if(!('serviceWorker'in navigator)){text('#offline-ready','请联网使用，并定期备份');return;}
  try{const registration=await navigator.serviceWorker.register('./sw.js',{scope:'./',updateViaCache:'none'});await Promise.race([navigator.serviceWorker.ready,new Promise((_,reject)=>setTimeout(()=>reject(Error('offline timeout')),15000))]);text('#offline-ready','离线已就绪 · 只保存在本机');const update=()=>{$('#update-notice').hidden=!registration.waiting;};update();registration.addEventListener('updatefound',()=>registration.installing?.addEventListener('statechange',update));}
  catch{text('#offline-ready','本机可保存 · 离线缓存待重试');}
}
async function start(){
  text('#today-date',new Date().toLocaleDateString('zh-CN',{month:'long',day:'numeric',weekday:'long'}));connection();route();
  const installed=matchMedia('(display-mode: standalone)').matches||navigator.standalone; text('#install-state',installed?'正在主屏幕应用中使用。':'当前在浏览器中。添加主屏幕后可独立打开。');
  try{await db.openWorkspace();state.ready=true;state.prefs=preferences(await db.getMeta('appearance',{}));applyPrefs();await refresh();await ai.load();await companion.load();
    try{const response=await fetch('./media/poems.json');if(response.ok){const value=await response.json();if(Array.isArray(value)&&value.length)poems=value.map(p=>({...p,body:p.lines.join('\n')}));renderPoem();}}catch{}
    if('BroadcastChannel'in window){channel=new BroadcastChannel('lifeos-pocket-changes-v2');channel.onmessage=()=>{refresh().catch(e=>notify(err(e)));};}
  }catch(error){critical(err(error));}void offline();
}
void start();
