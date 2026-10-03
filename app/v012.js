/* LifeOS V0.1 · Iteration 2
   A small surface layer: Writer, Journal, Search and copy share one calm
   reading/writing language without moving or removing the existing systems. */
(() => {
  'use strict';

  const PRESETS={poetic:{locale:'zh-CN',copyMode:'poetic'},bilingual:{locale:'zh-CN',copyMode:'bilingual'},en:{locale:'en-US',copyMode:'clear'}};
  const SECTION_EN={'日记':'Journal','自我探索':'Self-reflection','体系构建':'System building','日程':'Schedule','心得与摘录':'Notes & excerpts','习惯打卡':'Habits'};
  const SECTIONS=['日程','日记','自我探索','心得与摘录','体系构建','习惯打卡'];
  const TEMPLATES={blank:['日记'],daily:['日程','日记','自我探索','心得与摘录','体系构建','习惯打卡'],review:['日记','自我探索','心得与摘录','体系构建'],custom:['日记']};
  const I2={session:null,search:null,preset:null,journalSequence:0};
  const DESK_CELL_STORAGE='lifeos.writer.cells.v1';
  const DESK_TEMPLATE_STORAGE='lifeos.writer.desk.templates.v1';
  const HABIT_STORAGE='lifeos.writer.habits.v1';
  const DEFAULT_DESK_CELLS=[
    {key:'日记',label:'日记',helper:'',placeholder:'',essential:true,size:'wide',style:'paper'},
    {key:'日程',label:'日程',helper:'',placeholder:'',size:'standard',style:'paper'},
    {key:'自我探索',label:'自我探索',helper:'',placeholder:'',size:'standard',style:'wash'},
    {key:'心得与摘录',label:'心得与摘录',helper:'',placeholder:'',size:'standard',style:'paper'},
    {key:'体系构建',label:'体系构建',helper:'',placeholder:'',size:'standard',style:'wash'},
    {key:'习惯打卡',label:'习惯打卡',helper:'',placeholder:'',special:'habit',size:'standard',style:'wash'}
  ];
  const saved={openJournal,openProductDock,setProductDock,renderProductWriter,bindSpecific,onThisDay:RENDERERS['On This Day']};

  function prefKey(){return 'lifeos.pref.languagePreset'}
  function storedPreset(){
    const raw=localStorage.getItem(prefKey())||'poetic';
    try{const decoded=JSON.parse(raw);return typeof decoded==='string'?decoded:raw}catch(_){return raw}
  }
  function rememberPreset(value){
    // Use the shared preference writer when available. This prevents the
    // v01 compatibility surface from discarding a plain-text selection.
    if(typeof remember==='function')remember('languagePreset',value);
    else localStorage.setItem(prefKey(),JSON.stringify(value));
  }
  function preset(){const p=I2.preset||storedPreset();return PRESETS[p]?p:'poetic'}
  function en(){return preset()==='en'}
  function poetic(){return preset()==='poetic'}
  function bilingual(){return preset()==='bilingual'}
  function c(zh,enText,poem){return en()?enText:(poetic()?(poem||zh):(bilingual()&&enText?`${zh} / ${enText}`:zh))}
  function sectionName(k){return en()?(SECTION_EN[k]||k):k}
  function stateText(name){return ({clean:c('尚未改动','No changes yet'),drafting:c('草稿已留在这台设备','Draft saved on this device'),saving:c('正在落定新版本…','Saving a new revision…'),saved:c('已保存 · Revision 已落定','Saved · revision committed'),offline:c('服务暂不可用 · 草稿仍安全','Service unavailable · draft is safe'),error:c('未保存 · 草稿仍在本机','Not saved · local draft is safe')})[name]||name}
  function copy(){return {
    write:c('写下今天','Write today','落笔'),
    continue:c('继续这一页','Continue this page','续写此页'),
    searchTitle:c('在日记里找回一段过去','Find a moment in your journals','循字寻回一段过去'),
    searchPlaceholder:c('一句话、一个人、一个地方，或某一年…','A phrase, person, place, or year…','一句旧话、一个人、一个地方…')
  }}
  function draftKey(date){return `lifeos.writer.draft.${date||localDateISO()}`}
  function readDraft(date){try{return JSON.parse(localStorage.getItem(draftKey(date))||'null')}catch(_){return null}}
  function writerDraftRecord(form=$('#writerForm'),session=I2.session){
    if(!form)return null;
    const scope=form.closest('.i2Writer')||form,sections={...(session?.preservedSections||{})};
    form.querySelectorAll('[data-wsec]').forEach(field=>sections[field.dataset.wsec]=field.value);
    return {date:session?.date||scope.querySelector('#writerDate')?.value||localDateISO(),title:scope.querySelector('#writerTitle')?.value||'',tags:scope.querySelector('#writerTags')?.value||'',template:form.dataset.template||'blank',sections};
  }
  function draftContentHash(record){
    if(!record)return '';
    return JSON.stringify([record.date||'',record.title||'',record.tags||'',record.template||'blank',Object.entries(record.sections||{}).sort(([a],[b])=>a.localeCompare(b))]);
  }
  function draftHash(form=$('#writerForm'),session=I2.session){
    if(!form)return '';
    const scope=form.closest('.i2Writer')||form,files=[...(scope.querySelector('#writerAttachments')?.files||[])];
    return JSON.stringify([draftContentHash(writerDraftRecord(form,session)),files.map(file=>[file.name,file.size,file.lastModified])]);
  }
  function setWriterState(name,text){const el=$('#writerDraftState');if(el){el.dataset.state=name;el.textContent=text||stateText(name)}}
  function saveDraft(){
    const form=$('#writerForm'),rec=writerDraftRecord(form);if(!rec)return;
    if(!I2.session?.restoredDraft&&['clean','saved'].includes(I2.session?.saveState)&&draftHash(form)===I2.session?.persistedHash)return;
    rec.savedAt=new Date().toISOString();
    I2.session={...(I2.session||{}),preservedSections:{...rec.sections},saveState:'drafting'};
    try{localStorage.setItem(draftKey(rec.date),JSON.stringify(rec));setWriterState('drafting',`${stateText('drafting')} · ${new Intl.DateTimeFormat(PRESETS[preset()].locale,{hour:'2-digit',minute:'2-digit'}).format(new Date())}`)}catch(_){}
  }
  function clearCommittedDraft(record){
    if(draftContentHash(readDraft(record.date))===draftContentHash(record))localStorage.removeItem(draftKey(record.date));
  }
  function applyTemplate(template,keep=true){const form=$('#writerForm');if(!form)return;form.dataset.template=template;localStorage.setItem('lifeos.writer.template',template);const wanted=new Set(TEMPLATES[template]||TEMPLATES.blank);if(template==='custom')$$('[data-section-choice]').forEach(x=>{if(x.checked)wanted.add(x.value)});const deskLayout=loadDeskCells();$$('[data-wsec]').forEach(x=>{const row=x.closest('.i2WriterSection')||x.closest('.i2WriterCell'),layout=row?.matches('.i2WriterCell')?deskLayout.find(cell=>cell.key===x.dataset.wsec):null,hiddenByLayout=layout?.visible===false,layoutOwnsVisibility=row?.matches('.i2WriterCell')&&layout&&layout.visible!==false;row?.classList.toggle('i2Hidden',!!hiddenByLayout||(!layoutOwnsVisibility&&!wanted.has(x.dataset.wsec)&&(keep&&!x.value.trim())))});$$('[data-template]').forEach(x=>x.classList.toggle('active',x.dataset.template===template));const chooser=$('#writerCustomChooser');if(chooser)chooser.hidden=template!=='custom'}

  function updateLanguageControl(){
    document.documentElement.lang=PRESETS[preset()].locale;
    const old=$('#languagePreset');if(!old)return;
    old.innerHTML='<option value="poetic">诗文</option><option value="bilingual">中英文结合</option><option value="en">English</option>';
    old.value=preset();
    $('#languageHint')?.remove();
    old.onchange=async e=>{
      I2.preset=PRESETS[e.target.value]?e.target.value:'poetic';rememberPreset(I2.preset);document.documentElement.lang=PRESETS[I2.preset].locale;
      window.dispatchEvent(new CustomEvent('lifeos:language-change',{detail:{preset:I2.preset}}));
      try{await post('/api/product/settings',{items:{'ui.locale':PRESETS[I2.preset].locale,'ui.copy_mode':PRESETS[I2.preset].copyMode,'ui.language_preset':I2.preset}})}catch(_){toast(c('设置只在本次打开期间生效，未能保存到本机。','The choice is active for this session but could not be saved locally.'))}
      await render();if($('#productDock')?.classList.contains('open'))await renderProductTab(PRODUCT.tab||'writer');updateLanguageControl();
    };
  }

  function installWriterChrome(){
    const back=$('#writerBack');
    if(back){const spacer=document.createElement('span');spacer.id='writerBack';spacer.className='i2WriterHeadSpacer';spacer.setAttribute('aria-hidden','true');back.replaceWith(spacer)}
    $('#writerRead')?.addEventListener('click',()=>setProductDock(false),true);
    $$('[data-writer-view]').forEach(button=>button.addEventListener('click',()=>setTimeout(()=>{const view=button.dataset.writerView;$$('[data-writer-view]').forEach(item=>{const active=item.dataset.writerView===view;item.classList.toggle('active',active);item.setAttribute('aria-pressed',String(active))})},0),true));
  }

  async function renderWriter(){
    const j=await loadWriterSource(),existing=j?.product_entry||null,date=existing?.journal_date||j?.memory?.date||PRODUCT.context.date||localDateISO(),draft=!existing?readDraft(date):null,sections={};
    for(const key of SECTIONS)sections[key]=j?.sections?.[key]??draft?.sections?.[key]??'';
    const template=existing?(SECTIONS.filter(x=>sections[x].trim()).length>1?'daily':'blank'):(draft?.template||localStorage.getItem('lifeos.writer.template')||'blank'),revCount=(j?.revisions||[]).length,cp=copy();
    I2.session={entryId:existing?.entry_id||null,revisionId:existing?.current_revision_id||null,sourcePath:existing?.source_path||PRODUCT.context.path||null,openedFrom:PRODUCT.context.openedFrom||'home',returnContext:PRODUCT.context.returnContext||null,persistedHash:'',saveState:existing?'clean':'drafting'};
    $('#productPanel').innerHTML=`<div class="i2Writer" data-session="${esc(existing?.entry_id||'new')}"><header class="i2WriterHead"><button id="writerBack" type="button" class="i2Back">← ${esc(c('返回','Back','归页'))}</button><div class="i2WriterIdentity"><b>${esc(existing?cp.continue:cp.write)}</b></div><div class="i2WriterCommands"><span id="writerDraftState" class="i2WriterState" data-state="${existing?'clean':'drafting'}" aria-live="polite">${esc(existing?stateText('clean'):stateText('drafting'))}</span><button class="productAction" id="writerRead" type="button" ${existing?'':'hidden'}>${esc(c('读这一页','Read this page','读此页'))}</button><button class="productAction primary" id="writerSave" type="submit" form="writerForm">${esc(existing?c('保存为新版本','Save new revision','收笔 · 保存'):c('留下这一页','Save this page','收笔 · 留页'))}</button></div></header><form id="writerForm" data-entry-id="${esc(existing?.entry_id||'')}" data-source="${esc(existing?.source_path||'')}" data-template="${esc(template)}"><div class="i2WriterMeta"><label>${esc(c('日期','Date','日期'))}<input id="writerDate" class="input" type="date" value="${esc(date)}" required></label><label>${esc(c('标题 · 可选','Title · optional','题名 · 可选'))}<input id="writerTitle" class="input" value="${esc(existing?.title||draft?.title||'')}"></label></div><main class="i2WriterCanvas">${SECTIONS.map(key=>`<section class="i2WriterSection ${key==='日记'?'main':''}" data-key="${esc(key)}"><label for="w-${esc(key)}">${esc(sectionName(key))}</label><textarea id="w-${esc(key)}" data-wsec="${esc(key)}" aria-label="${esc(sectionName(key))}">${esc(sections[key])}</textarea></section>`).join('')}</main><details class="i2WriterMore"><summary>${esc(c('更多','More','更多'))}<small>${esc(c('标签、模板、附件与版本','Tags, templates, attachments & versions','题签、章法、附件与旧版'))}</small></summary><div class="i2MoreBody"><label>${esc(c('标签 · 逗号分隔','Tags · comma separated','题签 · 以逗号分隔'))}<input class="input" id="writerTags" value="${esc((existing?.tags||[]).join(', ')||draft?.tags||'')}"></label><div class="i2TemplateRow"><span>${esc(c('模板','Template','章法'))}</span>${[['blank',c('空白页','Blank','空白')],['daily',c('六段式','Six-part','六段')],['review',c('周复盘','Weekly review','周省')],['custom',c('自定义','Custom','自定')]].map(([id,label])=>`<button type="button" data-template="${id}">${esc(label)}</button>`).join('')}</div><div id="writerCustomChooser" hidden class="i2SectionChoices">${SECTIONS.filter(x=>x!=='日记').map(x=>`<label><input type="checkbox" data-section-choice value="${esc(x)}" ${sections[x].trim()?'checked':''}> ${esc(sectionName(x))}</label>`).join('')}</div><div class="i2MoreGrid"><section><h4>${esc(c('照片与附件','Attachments','附件'))}</h4>${(j?.attachments||[]).map(a=>`<a class="attachmentChip" href="/api/attachment?attachment_id=${encodeURIComponent(a.attachment_id)}" target="_blank" rel="noopener">${esc(a.original_name)}</a>`).join('')}<input id="writerAttachments" class="input" type="file" multiple></section><section><h4>${esc(c('历史版本','Revision history','旧版'))}</h4><p>${esc(c(`${revCount} 个可见版本；恢复旧版会新建 Revision。`,`${revCount} visible revisions; restoring one adds another revision.`,`已有 ${revCount} 版；复旧亦会添一新痕。`))}</p>${existing?`<button type="button" class="productAction" id="writerVersions">${esc(c('查看历史版本','Open revisions','看旧版'))}</button>`:''}</section></div><button id="writerClearDraft" type="button" class="i2QuietDanger">${esc(c('清除本地草稿','Clear local draft','清除本地草稿'))}</button></div></details></form></div>`;
    installWriterChrome(); applyTemplate(template,true); I2.session.persistedHash=draftHash();
    let timer;const changed=()=>{clearTimeout(timer);setWriterState('drafting');timer=setTimeout(saveDraft,420)};
    $('#writerForm').addEventListener('input',changed);$('#writerDate').onchange=changed;
    $$('[data-template]').forEach(x=>x.onclick=()=>{applyTemplate(x.dataset.template,true);changed()});$$('[data-section-choice]').forEach(x=>x.onchange=()=>{applyTemplate('custom',true);changed()});
    $('#writerClearDraft').onclick=()=>{localStorage.removeItem(draftKey($('#writerDate').value));if(!I2.session.entryId){$$('[data-wsec]').forEach(x=>x.value='');$('#writerTitle').value='';$('#writerTags').value=''}setWriterState('clean',c('本地草稿已清除','Local draft cleared'))};
    $('#writerVersions')?.addEventListener('click',()=>renderProductTab('versions'));
    $('#writerBack').onclick=()=>writerReturn();$('#writerRead').onclick=()=>I2.session.sourcePath&&openJournal(I2.session.sourcePath);
    const form=$('#writerForm');form.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&(e.key.toLowerCase()==='s'||e.key==='Enter')){e.preventDefault();form.requestSubmit()}if(e.key==='Escape'){saveDraft();writerReturn()}});
    form.onsubmit=async e=>{e.preventDefault();const btn=$('#writerSave'),wasExisting=!!form.dataset.entryId;btn.disabled=true;setWriterState('saving');try{const payload={entry_id:form.dataset.entryId||null,journal_date:$('#writerDate').value,title:$('#writerTitle').value.trim(),tags:$('#writerTags').value.split(/[,，]/).map(x=>x.trim()).filter(Boolean),timezone:Intl.DateTimeFormat().resolvedOptions().timeZone||'',sections:{}};$$('[data-wsec]').forEach(x=>payload.sections[x.dataset.wsec]=x.value);clearTimeout(timer);const out=await post('/api/entries/save',payload),result=out.result;for(const file of [...($('#writerAttachments')?.files||[])]){if(file.size>25_000_000)throw new Error(`${file.name} ${c('超过 25MB','is over 25MB')}`);await post('/api/attachments',{entry_id:result.entry_id,revision_id:result.revision_id,name:file.name,mime_type:file.type||'application/octet-stream',data_base64:await fileToBase64(file)})}localStorage.removeItem(draftKey(payload.journal_date));form.dataset.entryId=result.entry_id;form.dataset.source=result.source_path;I2.session={...I2.session,entryId:result.entry_id,revisionId:result.revision_id,sourcePath:result.source_path,persistedHash:draftHash(),saveState:'saved'};$('#writerRead').hidden=false;setWriterState('saved');btn.textContent=c('保存为新版本','Save new revision','收笔 · 保存');lifeEvent(wasExisting?'entry-updated':'entry-created',{date:payload.journal_date,status:'saved'});}catch(err){const offline=/fetch|network|failed/i.test(err.message||'');setWriterState(offline?'offline':'error');toast(err.message)}finally{btn.disabled=false}};
    setTimeout(()=>$('#w-日记')?.focus(),40);
  }

  function writerReturn(){const finish=()=>{saveDraft();const target=I2.session?.returnContext?.sourcePath||I2.session?.sourcePath;if(I2.session?.openedFrom==='journal'&&target){setProductDock(false);openJournal(target);return}setProductDock(false);if(typeof buildRail==='function')buildRail()};if(typeof window.lifeosWriterLeave==='function'&&window.lifeosWriterIsDirty?.()){window.lifeosWriterLeave(finish);return}finish()}
  window.lifeosWriterSaveDraft=saveDraft;

  // Expanded desktop writer: a structured page remains a single ordinary
  // daily entry, so its save path keeps the established append-only revision
  // semantics. The extra structure is intentionally a writing surface, not
  // a second hidden data model.
  const DEFAULT_WRITER_HABITS=['阅读 / 学习 / 输出','散步 / 吉他 / 运动','电影 / 影评 / 辩论','照顾好自己'];
  function cleanDeskText(value,fallback,max=80){return String(value||'').replace(/[\r\n]+/g,' ').trim().slice(0,max)||fallback}
  function cleanDeskFrame(value){
    if(!value||typeof value!=='object')return undefined;
    const fields=['x','y','width','height','basis'];
    if(!fields.every(key=>typeof value[key]==='number'&&Number.isFinite(value[key])))return undefined;
    if(value.width<=0||value.height<=0||value.basis<=0)return undefined;
    return {x:Math.max(0,value.x),y:Math.max(0,Math.min(100000,value.y)),width:Math.min(value.basis,value.width),height:Math.min(4000,value.height),basis:value.basis};
  }
  function loadDeskCells(){
    let savedCells=[];try{const raw=JSON.parse(localStorage.getItem(DESK_CELL_STORAGE)||'[]');savedCells=Array.isArray(raw)?raw:[]}catch(_){}
    const defaults=new Map(DEFAULT_DESK_CELLS.map(cell=>[cell.key,cell])),seen=new Set(),cells=[];
    let customCount=0;
    for(const cell of savedCells){
      if(!cell||typeof cell.key!=='string'||seen.has(cell.key))continue;
      const base=defaults.get(cell.key),custom=!base&&cell.custom&&/^自定义-\d+$/.test(cell.key);
      if(!base&&(!custom||customCount>=12))continue;
      if(custom)customCount++;
      seen.add(cell.key);
      cells.push({...base,key:cell.key,...(custom?{custom:true}:{}),label:cleanDeskText(cell.label,base?.label||'未命名格子',28),helper:cleanDeskText(cell.helper,base?.helper||''),placeholder:cleanDeskText(cell.placeholder,base?.placeholder||''),visible:base?.essential?true:cell.visible!==false,size:['compact','standard','tall','wide','large'].includes(cell.size)?cell.size:(base?.size||'standard'),style:['paper','wash','ink'].includes(cell.style)?cell.style:(base?.style||'paper'),frame:cleanDeskFrame(cell.frame)});
    }
    DEFAULT_DESK_CELLS.forEach(cell=>{if(!seen.has(cell.key))cells.push({...cell,visible:true})});
    return cells;
  }
  function saveDeskCells(cells){try{localStorage.setItem(DESK_CELL_STORAGE,JSON.stringify(cells))}catch(_){toast(c('格子布局未能保存在本机。','The cell layout could not be saved locally.'))}}
  function cloneDeskCells(cells){return cells.map(cell=>({...cell,...(cell.frame?{frame:{...cell.frame}}:{})}))}
  function loadDeskTemplates(){try{const raw=JSON.parse(localStorage.getItem(DESK_TEMPLATE_STORAGE)||'[]');return Array.isArray(raw)?raw.filter(item=>item&&typeof item.name==='string'&&Array.isArray(item.cells)).slice(0,8):[]}catch(_){return []}}
  function saveDeskTemplates(items){try{localStorage.setItem(DESK_TEMPLATE_STORAGE,JSON.stringify(items.slice(0,8)))}catch(_){toast(c('模板未能保存在本机。','The template could not be saved locally.'))}}
  function storeDeskTemplate(name,cells){const clean=cleanDeskText(name,'未命名模板',24),items=loadDeskTemplates().filter(item=>item.name!==clean);items.unshift({id:`模板-${Date.now()}`,name:clean,cells:cloneDeskCells(cells),savedAt:new Date().toISOString()});saveDeskTemplates(items)}
  function loadWriterHabits(){try{const raw=JSON.parse(localStorage.getItem(HABIT_STORAGE)||'[]');if(Array.isArray(raw)){const next=raw.map(item=>cleanDeskText(item,'',32)).filter(Boolean).slice(0,8);if(next.length)return next}}catch(_){}return DEFAULT_WRITER_HABITS.slice()}
  function saveWriterHabits(items){const next=[...new Set(items.map(item=>cleanDeskText(item,'',32)).filter(Boolean))].slice(0,8);try{localStorage.setItem(HABIT_STORAGE,JSON.stringify(next))}catch(_){toast(c('习惯未能保存在本机。','Habits could not be saved locally.'))}return next}
  function habitEditorRow(label){return `<label class="i2HabitEditorRow"><input class="input" data-habit-name value="${esc(label)}" maxlength="32" aria-label="${esc(c('习惯名称','Habit name','习惯名'))}"><button type="button" class="i2HabitEditRemove" data-habit-remove aria-label="${esc(c('删除习惯','Remove habit','删习惯'))}">×</button></label>`}
  function makeDeskCell(){const stamp=Date.now();return {key:`自定义-${stamp}`,custom:true,label:c('新格子','New cell','新格'),helper:'',placeholder:'',visible:true,size:'standard',style:'paper'}}
  function normalizeRichHtml(value){const holder=document.createElement('template');holder.innerHTML=String(value||'');const allowed=new Set(['BR','STRONG','B','U','S','EM','I','MARK','SPAN','DIV','P']);const walk=node=>{[...node.childNodes].forEach(child=>{if(child.nodeType===1){if(!allowed.has(child.tagName)){child.replaceWith(document.createTextNode(child.textContent||''));return}for(const attr of [...child.attributes]){if(child.tagName==='SPAN'&&attr.name==='class'&&attr.value==='i2InlineTag')continue;child.removeAttribute(attr.name)}walk(child)}})};walk(holder.content);return holder.innerHTML}
  function richHtml(value){const source=String(value||'');return /<\/?(strong|b|u|s|em|i|mark|span|div|p|br)\b/i.test(source)?normalizeRichHtml(source):esc(source).replace(/\r?\n/g,'<br>')}
  function richPlainText(value){const holder=document.createElement('div');holder.innerHTML=normalizeRichHtml(value);return (holder.innerText||holder.textContent||'').replace(/\u00a0/g,' ')}
  function cellEditorMarkup(cell,sections){const value=sections?.[cell.key]||'';return `<div class="i2CellEditor" contenteditable="true" role="textbox" aria-multiline="true" data-rich-wsec="${esc(cell.key)}" aria-label="${esc(cell.label)}">${richHtml(value)}</div><textarea id="w-${esc(cell.key)}" data-wsec="${esc(cell.key)}" hidden>${esc(value)}</textarea>`}
  function cellFormatMarkup(cell){const styles=[['paper',c('纸张','Paper','纸张')],['wash',c('暖洗','Warm wash','暖洗')],['ink',c('墨色','Ink','墨色')]];return `<div class="i2CellFormatBar" data-cell-formatbar hidden><button type="button" data-cell-format="bold" aria-label="${esc(c('加粗','Bold','加粗'))}"><b>B</b></button><button type="button" data-cell-format="underline" aria-label="${esc(c('下划线','Underline','划线'))}"><u>U</u></button><button type="button" data-cell-format="tag" aria-label="${esc(c('标签','Tag','标签'))}">#</button><label>${esc(c('样式','Style','样式'))}<select data-cell-style>${styles.map(([id,label])=>`<option value="${id}" ${id===cell.style?'selected':''}>${esc(label)}</option>`).join('')}</select></label></div>`}
  function deskCellHeadMarkup(cell){return `<div class="i2CellHead"><div class="i2CellTitle" role="button" tabindex="0" aria-label="${esc(c('修改格子标题','Edit cell title','改标题'))}"><span data-cell-title>${esc(cell.label)}</span><input class="i2CellTitleInput" data-cell-title-input hidden maxlength="28" value="${esc(cell.label)}" aria-label="${esc(cell.label)}"></div><span data-cell-helper ${cell.helper?'':'hidden'}>${esc(cell.helper||'')}</span><div class="i2CellActions">${cell.special==='habit'?`<button type="button" id="writerHabitEdit" class="i2CellTune" aria-pressed="false">${esc(c('编辑','Edit','编辑'))}</button>`:''}<button type="button" class="i2CellRemove" data-cell-remove ${cell.essential?'disabled':''} aria-label="${esc(cell.essential?c('日记格不可隐藏','Journal cell cannot be hidden','日记格不可收起'):c('隐藏格子','Hide cell','收起格子'))}">×</button></div></div>`}
  function deskCellInnerMarkup(cell,sections,habits,habitSource){if(cell.special==='habit'){return `${deskCellHeadMarkup(cell)}${cellFormatMarkup(cell)}<div class="i2HabitList" data-habit-list>${(habits||[]).map(label=>`<label><input type="checkbox" data-writer-habit value="${esc(label)}" ${habitIsDone(habitSource,label)?'checked':''}><i aria-hidden="true"></i><span>${esc(label)}</span></label>`).join('')}</div><div id="writerHabitNote" class="i2CellEditor i2HabitNote" contenteditable="true" role="textbox" aria-multiline="true" data-habit-note aria-label="${esc(c('习惯补充','Habit note','习惯补充'))}">${richHtml(habitRemainder(habitSource,habits||[]))}</div><textarea id="w-${esc(cell.key)}" data-wsec="${esc(cell.key)}" hidden>${esc(habitSource||'')}</textarea><div id="writerHabitEditor" class="i2HabitEditor" hidden><p>${esc(c('把你的习惯写成固定的节奏；保存后会出现在每一天。','Name the rhythms you want to keep; they will appear on every day.','把要守的节奏写下来；保存后会在每一日出现。'))}</p><div id="writerHabitEditorRows" class="i2HabitEditorRows">${(habits||[]).map(habitEditorRow).join('')}</div><div class="i2HabitEditorActions"><button type="button" id="writerHabitAdd">＋ ${esc(c('添加习惯','Add habit','添习惯'))}</button><button type="button" class="primary" id="writerHabitSave">${esc(c('保存习惯','Save habits','收好习惯'))}</button></div></div>`}return `${deskCellHeadMarkup(cell)}${cellFormatMarkup(cell)}${cellEditorMarkup(cell,sections)}`}
  function deskGridCellMarkup(cell,sections,habits,habitSource){const size=cell.size||'standard',style=cell.style||'paper';return `<section class="i2WriterCell ${cell.key==='日记'?'i2DiaryCell ':''}${cell.special==='habit'?'i2HabitCell ':''}i2CellSize-${esc(size)} i2CellStyle-${esc(style)}" data-key="${esc(cell.key)}" draggable="false" tabindex="0">${deskCellInnerMarkup(cell,sections,habits,habitSource)}</section>`}
  function deskCellEditor(){return '<section class="i2DeskCellEditor" id="writerCellEditor" hidden></section>'}
  function updateDeskCellNode(node,cell,sections,hydrate=false){if(!node)return;['compact','standard','tall','wide','large'].forEach(size=>node.classList.toggle(`i2CellSize-${size}`,cell.size===size));['paper','wash','ink'].forEach(style=>node.classList.toggle(`i2CellStyle-${style}`,cell.style===style));node.classList.toggle('i2Hidden',!cell.visible);const label=node.querySelector('[data-cell-title]'),titleInput=node.querySelector('[data-cell-title-input]'),helper=node.querySelector('[data-cell-helper]'),editor=node.querySelector('[data-rich-wsec]'),area=node.querySelector('[data-wsec]');if(label)label.textContent=cell.label;if(titleInput){titleInput.value=cell.label;titleInput.setAttribute('aria-label',cell.label)}if(helper){helper.textContent=cell.helper||'';helper.hidden=!cell.helper}if(editor){editor.setAttribute('aria-label',cell.label);if(hydrate)editor.innerHTML=richHtml(sections?.[cell.key]??'')}if(area){area.setAttribute('aria-label',cell.label);if(hydrate)area.value=sections?.[cell.key]??''}}
  function applyDeskCellConfig(grid,cells,sections){
    if(!grid)return;
    const existing=new Map([...grid.querySelectorAll('.i2WriterCell')].map(node=>[node.dataset.key,node]));
    cells.forEach(cell=>{
      let node=existing.get(cell.key);
      if(!node){node=document.createElement('section');node.className='i2WriterCell i2CustomCell';node.dataset.key=cell.key;node.draggable=false;node.tabIndex=0;node.innerHTML=deskCellInnerMarkup(cell,sections,[], '');grid.append(node)}
      updateDeskCellNode(node,cell,sections,true);
      grid.append(node);
    });
  }
  function dateObject(value){return new Date(`${value}T12:00:00`)}
  function shiftDate(value,delta){const d=dateObject(value);d.setDate(d.getDate()+delta);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
  function writerDateName(value){return new Intl.DateTimeFormat(PRESETS[preset()].locale,{month:'long',day:'numeric',weekday:'long'}).format(dateObject(value))}
  function writerWeekday(value){return new Intl.DateTimeFormat(PRESETS[preset()].locale,{weekday:'long'}).format(dateObject(value))}
  async function writerDates(range={}){
    const dates=new Map();let failure=null;
    try{const params=new URLSearchParams({content:'1'});if(range.start)params.set('from',range.start);if(range.end)params.set('to',range.end);const data=await api('/api/writer/dates?'+params,{noCache:true});for(const item of data.items||[])dates.set(item.date,{...item})}catch(error){failure=error}
    for(let index=0;index<localStorage.length;index++){
      const key=localStorage.key(index);if(!/^lifeos\.writer\.draft\.\d{4}-\d{2}-\d{2}$/.test(key||''))continue;
      try{const draft=JSON.parse(localStorage.getItem(key)||'null');if(!draft)continue;const hasText=String(draft.title||'').trim()||Object.values(draft.sections||{}).some(value=>richPlainText(value).trim());if(hasText){const date=key.slice(-10);dates.set(date,{...(dates.get(date)||{}),date,draft:true})}}catch(_){}
    }
    if(failure)throw failure;
    return [...dates.values()];
  }
  async function loadWriterForDate(date){
    let path=PRODUCT.context.path||null;
    if(!path&&PRODUCT.context.entryId){const entry=await api('/api/entry?entry_id='+encodeURIComponent(PRODUCT.context.entryId),{noCache:true});path=entry.entry?.source_path||null}
    if(!path){const entries=await api('/api/writer/dates',{noCache:true});path=(entries.items||[]).find(item=>item.date===date)?.source_path||null}
    return path?api('/api/journal?path='+encodeURIComponent(path),{noCache:true}):null;
  }
  function habitIsDone(source,label){return new RegExp(`[-*]\\s*\\[x\\][^\\n]*${label.replace(/[.*+?^${}()|[\\]\\\\]/g,'\\$&')}`,'i').test(source||'')}
  function habitRemainder(source,habits=DEFAULT_WRITER_HABITS){return String(source||'').split(/\n/).filter(line=>!habits.some(label=>line.includes(label))).join('\n').trim()}
  function syncWriterHabits(){
    const target=$('#w-习惯打卡');if(!target)return;
    const checks=$$('[data-writer-habit]').map(box=>`- [${box.checked?'x':' '}] ${box.value}`);
    const extra=normalizeRichHtml($('#writerHabitNote')?.innerHTML||'').trim();target.value=[...checks,extra].filter(Boolean).join('\n');target.dispatchEvent(new Event('input',{bubbles:true}));
  }
  function refreshWriterPreview(){
    const panel=$('#writerPreviewPanel');if(!panel)return;
    const rows=$$('[data-wsec]').map(field=>({label:field.closest('.i2WriterCell')?.querySelector('[data-cell-title]')?.textContent||sectionName(field.dataset.wsec),value:field.value.trim()})).filter(item=>richPlainText(item.value).trim());
    panel.innerHTML=rows.length?rows.map(item=>`<section><span>${esc(item.label)}</span><p>${richHtml(item.value)}</p></section>`).join(''):`<p>${esc(c('这里会安静地呈现这一页。','This is where this page will be read back.','此页将于此静静显现。'))}</p>`;
  }
  function updateWriterLiveStats(){
    const fields=$$('[data-wsec]'),primary=fields.filter(item=>item.dataset.wsec!=='习惯打卡'),characters=fields.reduce((total,item)=>total+richPlainText(item.value).trim().length,0),filled=primary.filter(item=>richPlainText(item.value).trim()).length;
    const count=$('#writerCharacterCount'),sections=$('#writerSectionCount');if(count)count.textContent=characters.toLocaleString();if(sections)sections.textContent=`${filled} / ${primary.length}`;
  }
  async function renderWriterExpanded(){
    const renderSequence=I2.renderSequence=(I2.renderSequence||0)+1;
    const requestedDate=PRODUCT.context.date||localDateISO(),j=await loadWriterForDate(requestedDate);
    if(renderSequence!==I2.renderSequence||PRODUCT.tab!=='writer'||!$('#productDock')?.classList.contains('open'))return;
    I2.flushDraft?.();I2.flushDraft=null;
    I2.layout?.destroy();I2.layout=null;I2.calendar?.destroy();I2.calendar=null;
    const existing=j?.product_entry||null,date=existing?.journal_date||j?.memory?.date||requestedDate,draft=readDraft(date),sections={},deskCells=loadDeskCells(),writerHabits=loadWriterHabits();
    for(const key of new Set([...SECTIONS,...deskCells.map(cell=>cell.key),...Object.keys(j?.sections||{}),...Object.keys(draft?.sections||{})]))sections[key]=draft?.sections?.[key]??j?.sections?.[key]??'';
    const template=localStorage.getItem('lifeos.writer.template')||draft?.template||'daily',revCount=(j?.revisions||[]).length,cp=copy(),habitSource=sections['习惯打卡'];
    I2.session={date,entryId:existing?.entry_id||null,revisionId:existing?.current_revision_id||null,sourcePath:existing?.source_path||PRODUCT.context.path||null,openedFrom:PRODUCT.context.openedFrom||'writer',returnContext:PRODUCT.context.returnContext||null,preservedSections:{...sections},habits:writerHabits,persistedHash:'',restoredDraft:!!draft,saveState:existing?'clean':'drafting'};
    const card=key=>deskGridCellMarkup(deskCells.find(item=>item.key===key)||DEFAULT_DESK_CELLS.find(item=>item.key===key),sections,writerHabits,habitSource);
    if(window.lifeosWriterDrawerHandler)document.removeEventListener('click',window.lifeosWriterDrawerHandler,true);
    window.lifeosWriterDrawerHandler=null;
    $('#productPanel').innerHTML=`<div class="i2Writer i2Desk" data-session="${esc(existing?.entry_id||'new')}"><header class="i2WriterHead i2DeskHead"><button id="writerBack" type="button" class="i2Back">← ${esc(c('返回','Back','归页'))}</button><div class="i2DateNavigator"><button id="writerPrevDay" type="button" aria-label="${esc(c('前一天','Previous day','前日'))}">←</button><div class="i2WriterDateCommand"><input id="writerDate" type="hidden" value="${esc(date)}" form="writerForm"><button id="writerDateJump" type="button" aria-haspopup="dialog" aria-expanded="false"><span>${esc(date)}</span><b>${esc(writerWeekday(date))}</b><i aria-hidden="true">⌄</i></button></div><button id="writerNextDay" type="button" aria-label="${esc(c('后一天','Next day','次日'))}">→</button><button id="writerToday" type="button">${esc(c('今天','Today','今朝'))}</button></div><div class="i2WriterCommands"><span id="writerDraftState" class="i2WriterState" data-state="${existing?'clean':'drafting'}" aria-live="polite">${esc(existing?stateText('clean'):stateText('drafting'))}</span><button class="productAction" id="writerRead" type="button" ${existing?'':'hidden'}>${esc(c('读这一页','Read','读页'))}</button><button class="productAction primary" id="writerSave" type="submit" form="writerForm">${esc(existing?c('保存为新版本','Save revision','收笔 · 保存'):c('留下这一页','Save page','收笔 · 留页'))}</button></div></header><form id="writerForm" data-entry-id="${esc(existing?.entry_id||'')}" data-source="${esc(existing?.source_path||'')}" data-template="${esc(template)}"><aside class="i2WriterAside"><div class="i2WriterAsideDate"><span>${esc(c('今天的页面','TODAY\'S PAGE','今页'))}</span><b>${esc(date.slice(8))}</b><p>${esc(writerDateName(date))}</p></div><label class="i2WriterTitle">${esc(c('题名 · 可选','TITLE · OPTIONAL','题名 · 可选'))}<input id="writerTitle" class="input" value="${esc(draft?draft.title||'':existing?.title||'')}" placeholder="${esc(c('给今天一个很轻的名字','A light name for today','为此页题一轻名'))}"></label><div class="i2WriterAsideRule"></div><div class="i2WriterView"><span>${esc(c('写作视图','WRITING VIEW','写作视图'))}</span><div>${[['day',c('日','Day','日')],['week',c('周','Week','周')],['month',c('月','Month','月')],['year',c('年','Year','年')]].map(([id,label])=>`<button type="button" data-writer-view="${id}" class="${id==='day'?'active':''}" aria-pressed="${id==='day'}">${esc(label)}</button>`).join('')}</div></div><div class="i2WriterAsideRule"></div><div class="i2WriterQuick"><span>${esc(c('快捷工具','QUICK TOOLS','便捷工具'))}</span><button type="button" id="writerFocus">${esc(c('聚焦写作','Focus writing','聚焦写作'))}</button><button type="button" id="writerPreview">${esc(c('预览这一页','Preview page','预览此页'))}</button><button type="button" id="writerAttachTrigger">${esc(c('添加附件','Add attachment','添附件'))}</button></div><details class="i2WriterMore"><summary>${esc(c('标签与历史','Tags & history','题签与旧版'))}</summary><div class="i2MoreBody"><label>${esc(c('标签 · 逗号分隔','Tags · comma separated','题签 · 以逗号分隔'))}<input class="input" id="writerTags" value="${esc(draft?draft.tags||'':(existing?.tags||[]).join(', '))}"></label><div class="i2TemplateRow"><span>${esc(c('模板','Template','章法'))}</span>${[['blank',c('空白页','Blank','空白')],['daily',c('六段式','Six-part','六段')],['review',c('周复盘','Weekly review','周省')],['custom',c('自定义','Custom','自定')]].map(([id,label])=>`<button type="button" data-template="${id}">${esc(label)}</button>`).join('')}</div><div id="writerCustomChooser" hidden class="i2SectionChoices">${SECTIONS.filter(key=>key!=='日记').map(key=>`<label><input type="checkbox" data-section-choice value="${esc(key)}" ${sections[key].trim()?'checked':''}> ${esc(sectionName(key))}</label>`).join('')}</div><div class="i2MoreGrid"><section><h4>${esc(c('照片与附件','Attachments','附件'))}</h4><p>${esc(c('附件留在正文之外，仍与此页相连。','Attachments remain outside the body and linked to this page.','附件不入正文，仍系于此页。'))}</p>${(j?.attachments||[]).map(item=>`<a class="attachmentChip" href="/api/attachment?attachment_id=${encodeURIComponent(item.attachment_id)}" target="_blank" rel="noopener">${esc(item.original_name)}</a>`).join('')}<input id="writerAttachments" class="input" type="file" multiple></section><section><h4>${esc(c('历史版本','Revision history','旧版'))}</h4><p>${esc(c(`${revCount} 个可见版本；恢复旧版会新建 Revision。`,`${revCount} visible revisions; restoring one adds another revision.`,`已有 ${revCount} 版；复旧亦会添一新痕。`))}</p>${existing?`<button type="button" class="productAction" id="writerVersions">${esc(c('查看历史版本','Open revisions','看旧版'))}</button>`:''}</section></div><button id="writerClearDraft" type="button" class="i2QuietDanger">${esc(c('清除本地草稿','Clear local draft','清除本地草稿'))}</button></div></details></aside><main class="i2WriterStage"><div class="i2WriterStageTop"><div class="i2WriterStageIntro"><button id="writerGridBack" type="button" hidden>← ${esc(c('格子总览','Back to grid','归格子总览'))}</button><p>${esc(c('写下即存本机。','Saved locally as you write.','写下即存本机。'))}</p><small class="i2ArrangeHint" id="writerArrangeHint" hidden>${esc(c('拖动标题栏，拖动边缘调整大小','Drag the header to move; drag an edge to resize','拖动标题栏，拖动边缘调整大小'))}</small></div><div class="i2WriterTools"><button type="button" id="writerAddQuick">＋ ${esc(c('新增格子','Add cell','添格'))}</button><button type="button" id="writerCustomizeCells">▦ ${esc(c('编辑布局','Edit layout','编辑布局'))}</button><button type="button" id="writerSaveTemplate">▤ ${esc(c('模板','Templates','章法'))}</button><button type="button" data-template="daily">▦ ${esc(c('六段','Six parts','六段'))}</button><button type="button" id="writerDrawerToggle">☰ ${esc(c('工具','Tools','工具'))}</button><span>${esc(c('自动草稿在本机','LOCAL DRAFT','本机草稿'))}</span></div></div><div class="i2WriterGrid">${SECTIONS.map(card).join('')}</div><div class="i2FocusToolbar" id="writerFocusToolbar" hidden><div class="i2FocusToolbarLead">${esc(c('正在写这一格','Writing this cell','正在写这一格'))}</div><div class="i2FocusToolbarActions"><button type="button" data-focus-command="bold" aria-label="${esc(c('加粗','Bold','加粗'))}"><b>B</b></button><button type="button" data-focus-command="underline" aria-label="${esc(c('下划线','Underline','划线'))}"><u>U</u></button><button type="button" data-focus-command="tag" aria-label="${esc(c('标签','Tag','标签'))}>#</button><button type="button" data-focus-command="heading" aria-label="${esc(c('小标题','Heading','小标题'))}">H</button><button type="button" data-focus-command="quote" aria-label="${esc(c('引用','Quote','引用'))}">❝</button><button type="button" data-focus-command="check" aria-label="${esc(c('待办','Checklist','待办'))}">☑</button><button type="button" data-focus-command="image" aria-label="${esc(c('图片','Image','图片'))}">▧</button><button type="button" data-focus-command="time" aria-label="${esc(c('时间','Time','时间'))}">◷</button><button type="button" data-focus-command="attach" aria-label="${esc(c('附件','Attachment','附件'))}">▱</button><span></span><button type="button" data-focus-command="undo" aria-label="${esc(c('撤销','Undo','撤销'))}">↶</button><button type="button" data-focus-command="redo" aria-label="${esc(c('重做','Redo','重做'))}">↷</button><button type="button" data-focus-command="previous" aria-label="${esc(c('上一个格子','Previous cell','上一格'))}">←</button><button type="button" data-focus-command="next" aria-label="${esc(c('下一个格子','Next cell','下一格'))}">→</button></div></div><article id="writerPreviewPanel" class="i2WriterPreviewPanel" hidden></article></main></form></div>`;
    const writerForm=$('#writerForm'),writerGrid=$('.i2WriterGrid'),writerStage=$('.i2WriterStage');applyDeskCellConfig(writerGrid,deskCells,sections);Object.entries(sections).forEach(([key,value])=>{if(writerForm?.querySelector(`[data-wsec="${CSS.escape(key)}"]`))return;const field=document.createElement('textarea');field.hidden=true;field.dataset.wsec=key;field.value=value;writerForm?.append(field)});const restoreHiddenButton=document.createElement('button');restoreHiddenButton.type='button';restoreHiddenButton.id='writerRestoreHidden';restoreHiddenButton.className='i2ArrangeRestore';restoreHiddenButton.textContent=c('显示已收起格子','Show hidden cells','显示已收起格子');restoreHiddenButton.hidden=true;document.querySelector('#writerArrangeHint')?.after(restoreHiddenButton);const diaryCell=writerGrid?.querySelector('.i2DiaryCell'),habitCell=writerGrid?.querySelector('.i2HabitCell'),previewPanel=$('#writerPreviewPanel'),quickTools=$('.i2WriterQuick'),morePanel=$('.i2WriterMore');
    const writerTitleField=$('#writerTitle');writerTitleField?.removeAttribute('placeholder');
    const titleRow=writerTitleField?.closest('label');
    if(titleRow){[...titleRow.childNodes].filter(node=>node.nodeType===Node.TEXT_NODE).forEach(node=>node.remove());const titleLabel=document.createElement('span');titleLabel.textContent=c('题名','Title','题名');titleRow.prepend(titleLabel);titleRow.classList.add('i2WriterPageTitle');writerStage?.querySelector('.i2WriterStageTop')?.prepend(titleRow)}
    writerStage?.querySelector('.i2WriterStageIntro > p')?.remove();
    writerStage?.querySelector('[data-template="daily"]')?.remove();
    writerStage?.querySelector('.i2WriterTools > span')?.remove();
    document.querySelector('.i2WriterView')?.remove();
    const oldTemplateRow=document.querySelector('.i2TemplateRow');oldTemplateRow?.remove();
    document.querySelector('#writerCustomChooser')?.remove();
    writerGrid?.setAttribute('data-view','day');
    if(quickTools){const importButton=document.createElement('button');importButton.type='button';importButton.id='writerImport';importButton.textContent=c('导入旧日记','Import old journals','导入旧日记');quickTools.append(importButton);importButton.onclick=()=>openProductDock('import',{openedFrom:'writer'});const exportButton=document.createElement('button');exportButton.type='button';exportButton.id='writerExport';exportButton.textContent=c('导出这一页','Export this page','导出此页');quickTools.append(exportButton);exportButton.onclick=()=>{const entryId=writerForm?.dataset.entryId||I2.session.entryId;if(!entryId)return toast(c('先保存这一页，再带走副本。','Save this page before exporting it.','先收笔，方可带走副本。'));PRODUCT.context={entryId};renderProductTab('export')}}
    const right=document.createElement('aside');right.className='i2WriterAsideRight';right.innerHTML=`<section class="i2WriterLive"><span>${esc(c('这一页正在长大','PAGE IN PROGRESS','此页正在生长'))}</span><strong id="writerCharacterCount">0</strong><small>${esc(c('个字','characters','字'))}</small><p id="writerSectionCount">0 / 5</p></section>`;
    if(previewPanel)right.append(previewPanel);if(quickTools)right.append(quickTools);if(morePanel)right.append(morePanel);right.id='writerToolDrawer';right.setAttribute('aria-label',c('工具抽屉','Tools drawer','工具抽屉'));right.insertAdjacentHTML('afterbegin',`<header class="i2ToolDrawerHead"><h3>${esc(c('工具','Tools','工具'))}</h3><button type="button" id="writerDrawerClose" aria-label="${esc(c('收起工具抽屉','Close tools drawer','收起工具抽屉'))}">×</button></header>`);right.hidden=true;document.querySelector('.i2Desk')?.append(right);if(writerStage){writerStage.insertAdjacentHTML('beforeend',deskCellEditor(deskCells));const deskEditor=$('#writerCellEditor');if(deskEditor){deskEditor.hidden=true;deskEditor.setAttribute('aria-hidden','true')}}
    document.querySelector('.i2WriterAside')?.remove();
    installWriterChrome(); applyTemplate(template,true);I2.session.persistedHash=draftHash();updateWriterLiveStats();
    const readDeskDirect=()=>[...(writerGrid?.children||[])].filter(node=>node.matches?.('.i2WriterCell[data-key]')).map(node=>{const current=deskCells.find(cell=>cell.key===node.dataset.key);if(!current)return null;return {...current,visible:current.essential?true:!node.classList.contains('i2Hidden'),label:cleanDeskText(node.querySelector('[data-cell-title-input]')?.value||node.querySelector('[data-cell-title]')?.textContent,current.label,28),style:['paper','wash','ink'].includes(node.querySelector('[data-cell-style]')?.value)?node.querySelector('[data-cell-style]').value:current.style}}).filter(Boolean);
    const refreshRestoreHidden=()=>{if(!restoreHiddenButton)return;const arranging=document.querySelector('.i2Desk')?.classList.contains('i2DeskInlineEdit');restoreHiddenButton.hidden=!arranging||!deskCells.some(cell=>!cell.essential&&cell.visible===false)};
    const syncDeskDirect=()=>{const next=readDeskDirect();deskCells.splice(0,deskCells.length,...next);saveDeskCells(next);I2.layout?.update(next);refreshRestoreHidden();templateArea?.querySelectorAll('[data-chapter-cell]').forEach(box=>{const cell=deskCells.find(cell=>cell.key===box.dataset.chapterCell);if(cell){box.checked=cell.visible!==false;const label=box.closest('label')?.querySelector('span');if(label)label.textContent=cell.label}});return next};
    const reflowDesk=next=>{saveDraft();saveDeskCells(next);I2.chapterOpen=templateArea?!templateArea.hidden:false;return renderProductWriter()};
    let templateArea=null;
    const deskEditor=$('#writerCellEditor');
    const layoutPreview=cells=>{
      const visible=cells.filter(cell=>cell.visible!==false).map((cell,index)=>({...cell,frame:cleanDeskFrame(cell.frame)||{x:(index%2)*458,y:Math.floor(index/2)*246,width:442,height:230,basis:900}})),basis=visible.find(cell=>cell.frame)?.frame.basis||900;
      const height=Math.max(1,...visible.map(cell=>(cell.frame?.y||0)+(cell.frame?.height||230)));
      return `<svg class="i2LayoutThumbnail" viewBox="0 0 ${basis} ${height}" preserveAspectRatio="xMidYMin meet" aria-hidden="true">${visible.map((cell,index)=>{const f=cell.frame||{x:(index%2)*458,y:Math.floor(index/2)*246,width:442,height:230};return `<rect x="${Number(f.x)||0}" y="${Number(f.y)||0}" width="${Math.max(1,Number(f.width)||230)}" height="${Math.max(1,Number(f.height)||230)}" rx="2"/>`}).join('')}</svg>`;
    };
    const builtInCells=mode=>{
      const basis=Math.max(600,writerGrid?.clientWidth||900),wanted=new Set(TEMPLATES[mode]||TEMPLATES.daily);
      const next=readDeskDirect().map(cell=>({...cell,visible:cell.essential||wanted.has(cell.key)}));
      const main=next.find(cell=>cell.essential),others=next.filter(cell=>cell.visible&&!cell.essential),gap=16;
      const columns=basis>=820?3:2,unit=(basis-gap*(columns-1))/columns;
      if(main)main.frame={x:0,y:0,width:mode==='blank'?basis:unit*(columns-1)+gap*(columns-2),height:mode==='review'?380:340,basis};
      const rightX=(main?.frame.width||unit)+gap;
      others.forEach((cell,index)=>{
        let x,y,width=unit;
        if(index===0){x=rightX;y=0}else{const slot=index-1;x=(slot%columns)*(unit+gap);y=(main?.frame.height||340)+gap+Math.floor(slot/columns)*246}
        cell.frame={x,y,width,height:230,basis};
      });
      return next;
    };
    const applyChapter=mode=>{
      saveDraft();writerForm.dataset.template=mode;localStorage.setItem('lifeos.writer.template',mode);
      reflowDesk(builtInCells(mode));
    };
    if(deskEditor){
      templateArea=document.createElement('section');templateArea.className='i2DeskTemplateArea';
      const templateItems=loadDeskTemplates();
      templateArea.innerHTML=`<div class="i2DeskTemplateHead"><h3>${esc(c('布局','Layout','章法'))}</h3><button type="button" id="writerResetCells">${esc(c('恢复默认','Reset','恢复默认'))}</button></div><div class="i2ChapterPresets">${[['blank',c('空白','Blank','空白')],['daily',c('日常','Daily','日常')],['review',c('复盘','Review','复盘')]].map(([id,label])=>`<button type="button" data-chapter="${id}" aria-pressed="${template===id}">${layoutPreview(builtInCells(id))}<span>${esc(label)}</span></button>`).join('')}</div><details class="i2ChapterCustom" open><summary>${esc(c('自定义','Customize','自定义'))}</summary><div class="i2ChapterCells">${deskCells.map(cell=>`<label><input type="checkbox" data-chapter-cell="${esc(cell.key)}" ${cell.visible!==false?'checked':''} ${cell.essential?'disabled':''}><span>${esc(cell.label)}</span></label>`).join('')}</div></details><div class="i2DeskTemplateSave"><input id="writerDeskTemplateName" class="input" maxlength="24" placeholder="${esc(c('布局名称','Layout name','章法名称'))}" aria-label="${esc(c('布局名称','Layout name','章法名称'))}"><button type="button" id="writerSaveDeskTemplate">${esc(c('保存布局','Save layout','存为章法'))}</button></div><div id="writerDeskTemplates" class="i2DeskTemplates">${templateItems.map(item=>`<div class="i2DeskTemplateCard" data-desk-template-card="${esc(item.id)}">${layoutPreview(item.cells)}<strong>${esc(item.name)}</strong><button type="button" data-desk-template="${esc(item.id)}">${esc(c('套用','Apply','套用'))}</button><button type="button" data-desk-template-remove="${esc(item.id)}" aria-label="${esc(c('删除布局','Delete layout','删除章法'))}">×</button></div>`).join('')}</div>`;
      templateArea.hidden=true;
      (document.querySelector('.i2WriterAsideRight')||writerStage||deskEditor).append(templateArea);
      right.querySelector('.i2ToolDrawerHead')?.insertBefore($('#writerResetCells'),$('#writerDrawerClose'));
      templateArea.querySelector('.i2DeskTemplateHead')?.remove();
      templateArea.addEventListener('click',event=>{const preset=event.target.closest('[data-chapter]');if(preset)applyChapter(preset.dataset.chapter)});
      templateArea.addEventListener('change',event=>{
        const box=event.target.closest('[data-chapter-cell]');if(!box)return;
        const cell=deskCells.find(cell=>cell.key===box.dataset.chapterCell);if(!cell||cell.essential)return;
        cell.visible=box.checked;updateDeskCellNode(writerGrid.querySelector(`[data-key="${CSS.escape(cell.key)}"]`),cell,null,false);
        writerForm.dataset.template='custom';localStorage.setItem('lifeos.writer.template','custom');syncDeskDirect();
        templateArea.querySelectorAll('[data-chapter]').forEach(button=>button.setAttribute('aria-pressed','false'));
      });
      $('#writerSaveDeskTemplate')?.addEventListener('click',()=>{const name=$('#writerDeskTemplateName')?.value.trim();if(!name){$('#writerDeskTemplateName')?.focus();return}saveDraft();I2.layout?.compact();storeDeskTemplate(name,syncDeskDirect());I2.chapterOpen=true;renderProductWriter()});
      $('#writerDeskTemplates')?.addEventListener('click',event=>{const apply=event.target.closest('[data-desk-template]'),remove=event.target.closest('[data-desk-template-remove]');if(apply){const item=loadDeskTemplates().find(x=>x.id===apply.dataset.deskTemplate);if(item){writerForm.dataset.template='custom';localStorage.setItem('lifeos.writer.template','custom');const keys=new Set(item.cells.map(cell=>cell.key));reflowDesk([...cloneDeskCells(item.cells),...readDeskDirect().filter(cell=>!keys.has(cell.key)).map(cell=>({...cell,visible:!!cell.essential}))])}}if(remove){saveDraft();saveDeskTemplates(loadDeskTemplates().filter(x=>x.id!==remove.dataset.deskTemplateRemove));I2.chapterOpen=true;renderProductWriter()}});
    }
    const setDeskInlineMode=(open=true)=>{I2.editing=open;const desk=document.querySelector('.i2Desk');if(open){writerGrid?.classList.remove('is-focused-cell');$$('.i2WriterGrid .i2WriterCell').forEach(node=>node.classList.remove('is-active-cell'));if($('#writerGridBack'))$('#writerGridBack').hidden=true}desk?.classList.toggle('i2DeskInlineEdit',open);writerGrid?.classList.toggle('is-arranging',open);I2.layout?.setEditing(open);const button=$('#writerCustomizeCells');if(button){button.setAttribute('aria-pressed',String(open));button.textContent=open?c('完成','Done','完成'):c('编辑布局','Edit layout','编辑布局')}const hint=$('#writerArrangeHint');if(hint)hint.hidden=!open;$$('[data-cell-title-input]').forEach(input=>{input.hidden=true;input.closest('.i2WriterCell')?.classList.remove('is-renaming')});$$('[data-cell-formatbar]').forEach(bar=>{bar.hidden=true});refreshRestoreHidden()};
    const toggleTemplateArea=open=>{if(!templateArea)return;I2.chapterOpen=open;templateArea.hidden=!open;document.querySelector('.i2Desk')?.classList.toggle('i2ChapterOpen',open);const title=$('#writerToolDrawer h3');if(title)title.textContent=open?c('布局','Layouts','章法'):c('工具','Tools','工具');if(open){const drawer=$('#writerToolDrawer');if(drawer){drawer.hidden=false;document.querySelector('.i2Desk')?.classList.add('i2DrawerOpen')}setDeskInlineMode(true);templateArea.scrollIntoView({behavior:'smooth',block:'nearest'});setTimeout(()=>$('#writerDeskTemplateName')?.focus(),80)}};
    $('#writerAddCell')?.addEventListener('click',()=>reflowDesk([...readDeskDirect(),makeDeskCell()]));
    $('#writerAddQuick')?.addEventListener('click',()=>reflowDesk([...readDeskDirect(),makeDeskCell()]));
    $('#writerCustomizeCells')?.addEventListener('click',()=>setDeskInlineMode(!document.querySelector('.i2Desk')?.classList.contains('i2DeskInlineEdit')));
    restoreHiddenButton.addEventListener('click',()=>{const next=readDeskDirect().map(cell=>({...cell,visible:true}));reflowDesk(next,c('已显示收起的格子。','Hidden cells are visible again.','已把收起的格子显出来。'))});
    $('#writerSaveTemplate')?.addEventListener('click',()=>toggleTemplateArea(true));
    $('#writerResetCells')?.addEventListener('click',()=>applyChapter('daily'));
    const syncRichMirror=editor=>{if(!editor)return;if(editor.matches('[data-rich-wsec]')){const mirror=document.querySelector(`[data-wsec="${CSS.escape(editor.dataset.richWsec)}"]`);if(mirror)mirror.value=normalizeRichHtml(editor.innerHTML)}else if(editor.matches('[data-habit-note]'))syncWriterHabits()};
    $$('[data-rich-wsec],[data-habit-note]').forEach(editor=>editor.addEventListener('input',()=>syncRichMirror(editor)));
    writerGrid?.addEventListener('mousedown',event=>{if(event.target.closest('[data-cell-format]'))event.preventDefault()});
    writerGrid?.addEventListener('focusin',event=>{const cell=event.target.closest('.i2WriterCell'),bar=cell?.querySelector('[data-cell-formatbar]');if(bar)bar.hidden=!event.target.closest('[data-rich-wsec],[data-habit-note],[data-cell-formatbar]')});
    writerGrid?.addEventListener('focusout',event=>{const cell=event.target.closest('.i2WriterCell');if(!cell)return;setTimeout(()=>{if(!cell.contains(document.activeElement)&&!document.querySelector('.i2Desk')?.classList.contains('i2DeskInlineEdit')){const bar=cell.querySelector('[data-cell-formatbar]');if(bar)bar.hidden=true}},0)});
    writerGrid?.addEventListener('input',event=>{const input=event.target.closest('[data-cell-title-input]');if(!input)return;const cellNode=input.closest('.i2WriterCell'),cell=deskCells.find(item=>item.key===cellNode?.dataset.key);if(!cell)return;const label=cleanDeskText(input.value,cell.label,28);cell.label=label;const title=cellNode.querySelector('[data-cell-title]');if(title)title.textContent=label;input.setAttribute('aria-label',label);syncDeskDirect()});
    writerGrid?.addEventListener('change',event=>{const control=event.target.closest('[data-cell-style]');if(!control)return;const cellNode=control.closest('.i2WriterCell'),cell=deskCells.find(item=>item.key===cellNode?.dataset.key);if(!cell)return;if(control.matches('[data-cell-style]')&&['paper','wash','ink'].includes(control.value))cell.style=control.value;updateDeskCellNode(cellNode,cell,null,false);syncDeskDirect()});
    writerGrid?.addEventListener('click',event=>{const formatButton=event.target.closest('[data-cell-format]');if(formatButton){const cell=formatButton.closest('.i2WriterCell'),editor=cell?.querySelector('[data-rich-wsec],[data-habit-note]');if(!editor)return;const selection=window.getSelection(),savedRange=selection?.rangeCount&&editor.contains(selection.anchorNode)?selection.getRangeAt(0).cloneRange():null;editor.focus();if(savedRange&&selection){selection.removeAllRanges();selection.addRange(savedRange)}if(formatButton.dataset.cellFormat==='tag'){const tagSelection=window.getSelection();if(tagSelection?.rangeCount&&editor.contains(tagSelection.anchorNode)&&String(tagSelection).trim()){const range=tagSelection.getRangeAt(0),mark=document.createElement('span');mark.className='i2InlineTag';mark.appendChild(range.extractContents());range.insertNode(mark);tagSelection.removeAllRanges();const next=document.createRange();next.selectNodeContents(mark);tagSelection.addRange(next)}}else document.execCommand(formatButton.dataset.cellFormat==='underline'?'underline':'bold',false,null);syncRichMirror(editor);editor.dispatchEvent(new Event('input',{bubbles:true}));return}const edit=event.target.closest('[data-cell-edit]');if(edit){const cell=edit.closest('.i2WriterCell'),input=cell?.querySelector('[data-cell-title-input]');if(input){input.dataset.originalTitle=input.value;input.hidden=false;cell.classList.add('is-renaming');input.focus();input.select()}return}const remove=event.target.closest('[data-cell-remove]');if(remove){const cellNode=remove.closest('.i2WriterCell'),cell=deskCells.find(item=>item.key===cellNode?.dataset.key);if(cell&&!cell.essential){cell.visible=false;updateDeskCellNode(cellNode,cell,null,false);syncDeskDirect()}return}});
    const focusToolbar=$('#writerFocusToolbar');
    const activeDeskCells=()=>[...(writerGrid?.querySelectorAll('.i2WriterCell:not(.i2Hidden)')||[])];
    const focusDeskCell=(offset=0)=>{const cells=activeDeskCells();if(!cells.length)return;const current=writerGrid?.querySelector('.i2WriterCell.is-active-cell'),index=Math.max(0,cells.indexOf(current)),next=cells[(index+offset+cells.length)%cells.length]||cells[0];writerGrid?.classList.add('is-focused-cell');cells.forEach(cell=>cell.classList.toggle('is-active-cell',cell===next));const back=$('#writerGridBack');if(back)back.hidden=false;next.querySelector('[data-rich-wsec],[data-habit-note],[data-wsec]')?.focus()};
    const syncFocusToolbar=()=>{if(!focusToolbar||!writerGrid)return;focusToolbar.hidden=!writerGrid.classList.contains('is-focused-cell');const actions=focusToolbar.querySelector('.i2FocusToolbarActions');if(actions&&!actions.querySelector('[data-focus-command="tag"]'))actions.insertAdjacentHTML('afterbegin',`<button type="button" data-focus-command="tag" aria-label="${esc(c('标签','Tag','标签'))}">#</button>`) };
    if(writerGrid){new MutationObserver(syncFocusToolbar).observe(writerGrid,{attributes:true,attributeFilter:['class']});syncFocusToolbar();const malformedTag=focusToolbar?.querySelector('[data-focus-command="tag"]');if(malformedTag)malformedTag.outerHTML=`<button type="button" data-focus-command="tag" aria-label="${esc(c('标签','Tag','标签'))}">#</button>`}
    const syncCellFocusShell=()=>document.querySelector('.i2Desk')?.classList.toggle('i2CellFocus',!!writerGrid?.classList.contains('is-focused-cell'));
    if(writerGrid){new MutationObserver(syncCellFocusShell).observe(writerGrid,{attributes:true,attributeFilter:['class']});syncCellFocusShell()}
    writerGrid?.addEventListener('click',event=>{if(event.defaultPrevented||writerGrid.classList.contains('is-arranging')||writerGrid.classList.contains('is-focused-cell')||event.target.closest('button,input,select,a,textarea,.i2HabitList label'))return;const cell=event.target.closest('.i2WriterCell');if(!cell||cell.parentElement!==writerGrid||cell.classList.contains('i2Hidden'))return;writerGrid.classList.add('is-focused-cell');$$('.i2WriterGrid .i2WriterCell').forEach(item=>item.classList.toggle('is-active-cell',item===cell));const back=$('#writerGridBack');if(back)back.hidden=false;if(!event.target.closest('[data-rich-wsec],[data-habit-note]'))cell.querySelector('[data-rich-wsec],[data-habit-note]')?.focus({preventScroll:true})});
    focusToolbar?.addEventListener('mousedown',event=>{if(event.target.closest('button'))event.preventDefault()});
    focusToolbar?.addEventListener('click',event=>{const button=event.target.closest('[data-focus-command]');if(!button)return;const command=button.dataset.focusCommand;if(command==='previous'){focusDeskCell(-1);return}if(command==='next'){focusDeskCell(1);return}if(command==='image'||command==='attach'){$('#writerAttachments')?.click();return}const cell=writerGrid?.querySelector('.i2WriterCell.is-active-cell'),editor=cell?.querySelector('[data-rich-wsec],[data-habit-note]');if(!editor)return;const selection=window.getSelection(),savedRange=selection?.rangeCount&&editor.contains(selection.anchorNode)?selection.getRangeAt(0).cloneRange():null;editor.focus();if(savedRange&&selection){selection.removeAllRanges();selection.addRange(savedRange)}if(command==='tag'){const tagSelection=window.getSelection();if(tagSelection?.rangeCount&&editor.contains(tagSelection.anchorNode)&&String(tagSelection).trim()){const range=tagSelection.getRangeAt(0),mark=document.createElement('span');mark.className='i2InlineTag';mark.appendChild(range.extractContents());range.insertNode(mark);tagSelection.removeAllRanges();const next=document.createRange();next.selectNodeContents(mark);tagSelection.addRange(next)}}else if(command==='undo'||command==='redo')document.execCommand(command,false,null);else if(command==='bold'||command==='underline'||command==='heading'||command==='quote')document.execCommand(command==='heading'?'bold':command==='quote'?'italic':command,false,null);else if(command==='check')document.execCommand('insertText',false,'☐ ');else if(command==='time')document.execCommand('insertText',false,new Intl.DateTimeFormat(PRESETS[preset()].locale,{hour:'2-digit',minute:'2-digit'}).format(new Date()));syncRichMirror(editor);editor.dispatchEvent(new Event('input',{bubbles:true}))});
    if(window.lifeosWriterKeyHandler)window.removeEventListener('keydown',window.lifeosWriterKeyHandler,true);
    window.lifeosWriterKeyHandler=event=>{if(!document.body.classList.contains('writerImmersive'))return;const grid=document.querySelector('.i2Desk .i2WriterGrid');if(!grid)return;const modifier=event.ctrlKey||event.metaKey;if(event.key==='Escape'&&grid.classList.contains('is-focused-cell')){event.preventDefault();event.stopImmediatePropagation();$('#writerGridBack')?.click();return}if(!modifier)return;if(event.key==='ArrowLeft'){event.preventDefault();focusDeskCell(-1)}else if(event.key==='ArrowRight'){event.preventDefault();focusDeskCell(1)}else if(event.key==='Enter'&&event.shiftKey){event.preventDefault();event.stopImmediatePropagation();$('#writerAddQuick')?.click()}else if(event.key==='.') {event.preventDefault();$('#writerDrawerToggle')?.click()}};
    window.addEventListener('keydown',window.lifeosWriterKeyHandler,true);
    writerGrid?.addEventListener('click',event=>{
      if(!document.querySelector('.i2Desk')?.classList.contains('i2DeskInlineEdit'))return;
      const title=event.target.closest('[data-cell-title]');
      if(title&&!event.target.closest('button,input,select,a')){
        event.preventDefault();event.stopImmediatePropagation();
        const cell=title.closest('.i2WriterCell'),input=cell?.querySelector('[data-cell-title-input]');
        if(input){input.dataset.originalTitle=input.value;input.hidden=false;cell.classList.add('is-renaming');input.focus();input.select()}
        return;
      }
      if(!event.target.closest('.i2CellHead')||event.target.closest('button,input,select,a,label'))return;
      event.preventDefault();event.stopImmediatePropagation();
    },true);
    writerGrid?.addEventListener('keydown',event=>{
      const titleInput=event.target.closest('[data-cell-title-input]');
      if(titleInput&&['Enter','Escape'].includes(event.key)){event.preventDefault();event.stopPropagation();if(event.key==='Escape'&&titleInput.dataset.originalTitle){titleInput.value=titleInput.dataset.originalTitle;titleInput.dispatchEvent(new Event('input',{bubbles:true}))}titleInput.blur();return}
      if(document.querySelector('.i2Desk')?.classList.contains('i2DeskInlineEdit')){if(event.key==='Enter'&&event.target.closest('.i2CellTitle')){event.preventDefault();event.target.closest('.i2CellTitle').querySelector('[data-cell-title]')?.click()}return;}
      if(event.key!=='Enter'&&event.key!==' ')return;
      const cell=event.target.closest?.('.i2WriterCell[data-key]');
      if(!cell||cell.classList.contains('i2Hidden')||event.target.closest('[data-rich-wsec],[data-habit-note],button,input,select,a,textarea'))return;
      event.preventDefault();
      writerGrid.classList.add('is-focused-cell');
      $$('.i2WriterGrid .i2WriterCell').forEach(item=>item.classList.toggle('is-active-cell',item===cell));
      const back=$('#writerGridBack');if(back)back.hidden=false;
      cell.querySelector('[data-rich-wsec],[data-habit-note],[data-wsec]')?.focus();
    });
    writerGrid?.addEventListener('focusout',event=>{const input=event.target.closest('[data-cell-title-input]');if(input){input.hidden=true;input.closest('.i2WriterCell')?.classList.remove('is-renaming');syncDeskDirect()}});
    $('#writerGridBack')?.addEventListener('click',()=>{writerGrid?.classList.remove('is-focused-cell');$$('.i2WriterGrid .i2WriterCell').forEach(item=>item.classList.remove('is-active-cell'));$('#writerGridBack').hidden=true});
    const setHabitEditMode=open=>{const editor=$('#writerHabitEditor'),cell=editor?.closest('.i2HabitCell'),button=$('#writerHabitEdit');if(!editor||!cell||!button)return;editor.hidden=!open;editor.setAttribute('aria-hidden',String(!open));cell.classList.toggle('is-habit-editing',open);button.classList.toggle('is-active',open);button.setAttribute('aria-pressed',String(open));if(open)setTimeout(()=>editor.scrollIntoView({block:'nearest',inline:'nearest'}),0)};
    $('#writerHabitEdit')?.addEventListener('click',()=>{const button=$('#writerHabitEdit');setHabitEditMode(button?.getAttribute('aria-pressed')!=='true')});
    $('#writerHabitAdd')?.addEventListener('click',()=>{$('#writerHabitEditorRows')?.insertAdjacentHTML('beforeend',habitEditorRow(c('新习惯','New habit','新习惯')));$('#writerHabitEditorRows input:last-of-type')?.focus()});
    $('#writerHabitEditor')?.addEventListener('click',event=>{const remove=event.target.closest('[data-habit-remove]');if(remove){const rows=$$('#writerHabitEditorRows [data-habit-name]');if(rows.length>1)remove.closest('.i2HabitEditorRow')?.remove()}});
    $('#writerHabitSave')?.addEventListener('click',()=>{const next=saveWriterHabits($$('#writerHabitEditorRows [data-habit-name]').map(input=>input.value));if(!next.length)return;const button=$('#writerHabitSave');button?.classList.add('is-confirmed');if(button)button.textContent=c('已更新','Updated','已更新');saveDraft();I2.session.habits=next;setTimeout(()=>renderProductWriter(),160)});
    let timer;I2.flushDraft=()=>{clearTimeout(timer);saveDraft()};const changed=()=>{updateWriterLiveStats();clearTimeout(timer);setWriterState('drafting');timer=setTimeout(saveDraft,420)};
    $('#writerForm').addEventListener('input',changed);$$('[data-template]').forEach(button=>button.onclick=()=>{applyTemplate(button.dataset.template,true);changed()});$$('[data-section-choice]').forEach(box=>box.onchange=()=>{applyTemplate('custom',true);changed()});$$('[data-writer-habit]').forEach(box=>box.onchange=()=>{syncWriterHabits();changed()});$('#writerHabitNote')?.addEventListener('input',()=>{syncWriterHabits();changed()});
    let changingDay=false;
    const changeDay=async next=>{
      if(changingDay||!/^\d{4}-\d{2}-\d{2}$/.test(next)||next===date)return;
      changingDay=true;clearTimeout(timer);$('#writerDate').value=date;saveDraft();
      const previousContext=PRODUCT.context;PRODUCT.context={date:next,openedFrom:'writer'};
      try{await renderProductWriter()}catch(error){PRODUCT.context=previousContext;changingDay=false;throw error}
    };
    const requestDay=next=>changeDay(next).catch(error=>toast(error.message));
    $('#writerPrevDay').onclick=()=>requestDay(shiftDate(date,-1));$('#writerNextDay').onclick=()=>requestDay(shiftDate(date,1));$('#writerToday').onclick=()=>requestDay(localDateISO());$('#writerDate').onchange=event=>requestDay(event.target.value);
    I2.calendar=window.lifeosWriterCalendar?.mount({anchor:$('#writerDateJump'),input:$('#writerDate'),locale:PRESETS[preset()].locale,today:localDateISO(),dates:async range=>{clearTimeout(timer);saveDraft();return writerDates(range)},onSelect:changeDay});
    $$('[data-writer-view]').forEach(button=>button.onclick=()=>{$$('[data-writer-view]').forEach(item=>{const active=item===button;item.classList.toggle('active',active);item.setAttribute('aria-pressed',String(active))});document.querySelector('.i2WriterGrid')?.setAttribute('data-view',button.dataset.writerView)});
    $('#writerFocus').onclick=()=>{const desk=document.querySelector('.i2Desk');const focused=desk?.classList.toggle('i2DeskFocus');if(focused)document.querySelector('#productPanel')?.scrollTo({top:0,behavior:'smooth'})};$('#writerPreview').onclick=()=>{const panel=$('#writerPreviewPanel');refreshWriterPreview();panel.hidden=!panel.hidden;document.querySelector('.i2Desk')?.classList.toggle('i2DeskPreview',!panel.hidden)};$('#writerAttachTrigger').onclick=()=>$('#writerAttachments')?.click();const closeDrawer=()=>{const drawer=$('#writerToolDrawer');if(drawer){drawer.hidden=true;document.querySelector('.i2Desk')?.classList.remove('i2DrawerOpen')}toggleTemplateArea(false)};$('#writerDrawerToggle').onclick=()=>{const chapterOpen=I2.chapterOpen;toggleTemplateArea(false);const drawer=$('#writerToolDrawer');if(drawer){const open=drawer.hidden||chapterOpen;drawer.hidden=!open;document.querySelector('.i2Desk')?.classList.toggle('i2DrawerOpen',open);if(open)$('#writerDrawerClose')?.focus()}};$('#writerDrawerClose').onclick=closeDrawer;
    $('#writerClearDraft').onclick=()=>{clearTimeout(timer);localStorage.removeItem(draftKey($('#writerDate').value));if(!I2.session.entryId){$$('[data-wsec]').forEach(item=>{item.value='';const editor=document.querySelector(`[data-rich-wsec="${CSS.escape(item.dataset.wsec)}"]`);if(editor)editor.innerHTML=''});$('#writerTitle').value='';$('#writerTags').value='';$$('[data-writer-habit]').forEach(item=>item.checked=false);if($('#writerHabitNote'))$('#writerHabitNote').innerHTML=''}I2.session={...I2.session,persistedHash:draftHash(),restoredDraft:false,saveState:'clean'};setWriterState('clean',c('本地草稿已清除','Local draft cleared'))};$('#writerVersions')?.addEventListener('click',()=>renderProductTab('versions'));$('#writerBack').onclick=()=>writerReturn();$('#writerRead').onclick=()=>I2.session.sourcePath&&openJournal(I2.session.sourcePath);
    const form=$('#writerForm');form.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&(event.key.toLowerCase()==='s'||event.key==='Enter')){event.preventDefault();form.requestSubmit()}if(event.key==='Escape'&&!event.defaultPrevented){if(writerGrid?.dataset.layoutGesture)return;if(document.querySelector('.i2DeskInlineEdit')){event.preventDefault();setDeskInlineMode(false);return}saveDraft();writerReturn()}});
    form.onsubmit=async event=>{
      event.preventDefault();
      const button=writerForm.closest('.i2Writer')?.querySelector('#writerSave'),wasExisting=!!form.dataset.entryId;
      const saveKey=form.dataset.entryId||`daily:${date}`;
      const pendingSaves=I2.pendingSaves||(I2.pendingSaves=new Set());
      if(pendingSaves.has(saveKey)||!button||!form.isConnected||(I2.session?.saveState==='saved'&&draftHash(form)===I2.session.persistedHash))return;
      pendingSaves.add(saveKey);button.disabled=true;
      const sessionSnapshot={...I2.session},sequenceSnapshot=renderSequence;
      const isCurrent=()=>I2.renderSequence===sequenceSnapshot&&$('#writerForm')===form&&form.isConnected&&PRODUCT.tab==='writer'&&$('#productDock')?.classList.contains('open')&&I2.session?.date===sessionSnapshot.date;
      try{
        syncWriterHabits();clearTimeout(timer);saveDraft();
        const snapshot=writerDraftRecord(form,sessionSnapshot),submittedHash=draftHash(form,sessionSnapshot);
        const files=[...(form.closest('.i2Writer')?.querySelector('#writerAttachments')?.files||[])];
        for(const file of files)if(file.size>25_000_000)throw new Error(`${file.name} ${c('超过 25MB','is over 25MB')}`);
        const payload={entry_id:form.dataset.entryId||null,journal_date:snapshot.date,title:snapshot.title.trim(),tags:snapshot.tags.split(/[,，]/).map(item=>item.trim()).filter(Boolean),timezone:Intl.DateTimeFormat().resolvedOptions().timeZone||'',sections:{...snapshot.sections}};
        setWriterState('saving');
        const out=await post('/api/entries/save',payload),result=out.result;
        for(const file of files)await post('/api/attachments',{entry_id:result.entry_id,revision_id:result.revision_id,name:file.name,mime_type:file.type||'application/octet-stream',data_base64:await fileToBase64(file)});
        clearCommittedDraft(snapshot);
        lifeEvent(wasExisting?'entry-updated':'entry-created',{date:payload.journal_date,status:'saved'});
        if(!isCurrent())return;
        const unchanged=draftHash(form)===submittedHash;
        form.dataset.entryId=result.entry_id;form.dataset.source=result.source_path;
        if(unchanged)form.dataset.v02Dirty='';
        I2.session={...I2.session,entryId:result.entry_id,revisionId:result.revision_id,sourcePath:result.source_path,persistedHash:submittedHash,restoredDraft:false,saveState:unchanged?'saved':'drafting'};
        form.closest('.i2Writer')?.querySelector('#writerRead')?.removeAttribute('hidden');
        button.textContent=c('保存为新版本','Save revision','收笔 · 保存');
        if(!unchanged){saveDraft();return;}
        setWriterState('saved');
        setTimeout(()=>{if(isCurrent()&&draftHash(form)===submittedHash)writerReturn();},140);
      }catch(error){
        if(isCurrent()){const offline=/fetch|network|failed/i.test(error.message||'');setWriterState(offline?'offline':'error');toast(error.message);}
      }finally{pendingSaves.delete(saveKey);button.disabled=false;}
    };
    if(!localStorage.getItem(DESK_CELL_STORAGE)){const initial=builtInCells(['blank','daily','review'].includes(template)?template:'daily');deskCells.splice(0,deskCells.length,...initial);initial.forEach(cell=>updateDeskCellNode(writerGrid.querySelector(`[data-key="${CSS.escape(cell.key)}"]`),cell,null,false))}
    I2.layout=window.lifeosWriterLayout?.mount(writerGrid,{cells:deskCells,onChange:(frames,meta)=>{for(const cell of deskCells)if(frames[cell.key])cell.frame={...frames[cell.key]};saveDeskCells(deskCells);if(meta?.reason==='edit'){writerForm.dataset.template='custom';localStorage.setItem('lifeos.writer.template','custom');templateArea?.querySelectorAll('[data-chapter]').forEach(button=>button.setAttribute('aria-pressed','false'))}}});
    setDeskInlineMode(I2.editing===true);
    if(I2.chapterOpen)toggleTemplateArea(true);
    // Writing stays in place; expansion is optional.
  }

  function journalStartI2(){return `<section class="i2JournalStart emptyState"><h3>${esc(c('还没有日记','No journal yet','流年尚未落字'))}</h3><p>${esc(c('从今天写下一页，或把旧日记带进来。','Start today, or bring in your past pages.','可从今日落笔，亦可携旧页归来。'))}</p><div class="i2JournalStartActions"><button class="btn primary" id="journalStartWrite" type="button">${esc(c('写日记','Write today','落笔写今天'))}</button><button class="btn" id="journalStartImport" type="button">${esc(c('导入日记','Import journals','导入旧日记'))}</button></div></section>`}
  async function renderJournalI2(){
    if(document.body.classList.contains('journalFocusMode'))setJournalFocus(false,{silent:true});
    const sequence=++I2.journalSequence,originPath=STATE.journalPath||'',kind=STATE.journalKind==='weekly'?'weekly':'daily',turn=I2.journalTurn||'idle';
    I2.journalTurn='idle';
    const current=()=>sequence===I2.journalSequence&&STATE.feature==='Journal'&&(STATE.journalPath||'')===originPath;
    const entries=await api('/api/entries?limit=-1',{noCache:true});
    if(!current())return '';
    const catalog=(entries.items||[]).filter(item=>item&&item.deleted_at==null&&item.source_path),kinds=['daily','weekly'].filter(value=>catalog.some(item=>item.kind===value));
    const items=window.lifeosJournalBook.indexItems(catalog.filter(item=>item.kind===kind));
    const remembered=pref('lastJournal'),path=originPath||(items.some(item=>item.source_path===remembered)?remembered:null)||items.at(-1)?.source_path;
    if(!path){I2.journalData=null;return pageWrap(journalStartI2())}
    const j=await api('/api/journal?path='+encodeURIComponent(path),{noCache:true});
    if(!current())return '';
    STATE.journalPath=path;
    const title=j.product_entry?.title||'';
    const sections=Object.entries(j.sections||{}).filter(([,value])=>richPlainText(value).trim());
    const paperSections=sections.map(([name,value])=>`<section class="i2ReadingSection"><h2>${esc(sectionName(name))}</h2><div class="jbSectionText">${richHtml(value)}</div></section>`).join('')||`<div class="i2ReadingEmpty">${esc(c('这一页还没有正文','No text on this page yet','此页暂无正文'))}</div>`;
    I2.journalData={j,ctx:j.context||{},items,path,kind,kinds,locale:PRESETS[preset()].locale,title,paperSections,turn,backSearch:!!I2.search};
    return pageWrap(window.lifeosJournalBook.render(I2.journalData));
  }

  function highlight(text,query){const clean=String(text||'').replace(/<[^>]*>/g,'');const re=new RegExp(`(${String(query||'').replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})`,'ig');return esc(clean).replace(re,'<mark>$1</mark>')}
  async function renderSearchI2(){const cp=copy(),q=STATE.searchQ||'',kind=STATE.searchKind||'all',year=STATE.searchYear||'',section=STATE.searchSection||'',sort=STATE.searchSort||'relevance';return pageWrap(`<section class="i2Search"><header><h1>${esc(cp.searchTitle)}</h1></header><div class="i2SearchBar"><input id="searchQ" class="input" value="${esc(q)}" placeholder="${esc(cp.searchPlaceholder)}"><button id="searchFilterToggle" class="btn" aria-expanded="false">${esc(c('筛选','Filters','筛选'))}</button><button id="searchClear" class="btn">${esc(c('清空','Clear','清空'))}</button></div><section id="i2Filters" class="i2Filters" hidden><label>${esc(c('来源','Source type','来源'))}<select id="searchKind" class="input"><option value="all">${esc(c('日记 + 周记','Daily + weekly','日记 + 周记'))}</option><option value="daily">${esc(c('仅日记','Daily only','仅日记'))}</option><option value="weekly">${esc(c('仅周记','Weekly only','仅周记'))}</option></select></label><label>${esc(c('年份','Year','年份'))}<select id="searchYear" class="input"><option value="">${esc(c('全部年份','All years','全部年份'))}</option><option>2025</option><option>2026</option></select></label><label>${esc(c('段落','Section','篇章'))}<select id="searchSection" class="input"><option value="">${esc(c('全部段落','All sections','全部篇章'))}</option>${SECTIONS.slice(0,5).map(x=>`<option value="${esc(x)}">${esc(sectionName(x))}</option>`).join('')}</select></label><label>${esc(c('排序','Sort','排序'))}<select id="searchSort" class="input"><option value="relevance">${esc(c('相关度','Relevance','相关'))}</option><option value="date_desc">${esc(c('最新优先','Newest first','最新'))}</option><option value="date_asc">${esc(c('最早优先','Oldest first','最早'))}</option></select></label></section><div id="i2SearchResults" class="i2SearchResults"><p class="muted">${esc(q?c('正在查找原文…','Finding source passages…','正在寻页…'):c('输入一个词开始寻找。','Type something to start.','写下一字，便可寻迹。'))}</p></div><div id="searchOut" hidden></div><div id="searchFacets" hidden></div><button id="searchDeepRead" hidden></button><button id="searchAsk" hidden></button></section>`)}

  async function runI2Search(){const q=$('#searchQ')?.value.trim()||'',kind=$('#searchKind')?.value||'all',year=$('#searchYear')?.value||'',section=$('#searchSection')?.value||'',sort=$('#searchSort')?.value||'relevance';Object.assign(STATE,{searchQ:q,searchKind:kind,searchYear:year,searchSection:section,searchSort:sort});const out=$('#i2SearchResults');if(!q){out.innerHTML=`<p class="muted">${esc(c('输入一个词开始寻找。','Type something to start.','写下一字，便可寻迹。'))}</p>`;return}out.innerHTML=`<p class="muted">${esc(c('正在查找原文…','Finding source passages…','正在寻页…'))}</p>`;const d=await api(`/api/search?q=${encodeURIComponent(q)}&section=${encodeURIComponent(section)}&kind=${encodeURIComponent(kind)}&year=${encodeURIComponent(year)}&sort=${encodeURIComponent(sort)}&limit=80`,{noCache:true});out.innerHTML=`<div class="i2SearchSummary">${esc(c(`${d.total_matches||0} 个匹配段落`,`${d.total_matches||0} matching sections`,`${d.total_matches||0} 处相应`))}</div>`+(d.items||[]).map(x=>`<article class="i2Result" data-i2-source="${esc(x.source_path)}" tabindex="-1"><time>${esc(x.date)}</time><div><span>${esc(x.kind==='weekly'?c('周记','Weekly','周记'):c('日记','Daily','日记'))}</span><span>${esc(sectionName(x.section||''))}</span><p>${highlight(x.snippet,q)}</p></div><button class="source" data-i2-source="${esc(x.source_path)}">${esc(c('打开原页','Open source','展开原页'))} →</button></article>`).join('')||`<p class="muted">${esc(c('没有找到。换一个更接近原文的词试试。','No match. Try wording closer to the original source.','未寻得此字。试试更近原句的说法。'))}</p>`;$$('[data-i2-source]').forEach(x=>x.onclick=()=>{captureSearch();openJournal(x.dataset.i2Source)});if(I2.search?.selectedSourcePath){document.querySelector(`[data-i2-source="${CSS.escape(I2.search.selectedSourcePath)}"]`)?.focus()}}
  function captureSearch(){I2.search={query:$('#searchQ')?.value||STATE.searchQ||'',kind:$('#searchKind')?.value||'all',year:$('#searchYear')?.value||'',section:$('#searchSection')?.value||'',sort:$('#searchSort')?.value||'relevance',scrollY:window.scrollY,selectedSourcePath:null};try{sessionStorage.setItem('lifeos.i2.search',JSON.stringify(I2.search))}catch(_){}}
  function restoreSearch(){try{I2.search=I2.search||JSON.parse(sessionStorage.getItem('lifeos.i2.search')||'null')}catch(_){}if(!I2.search)return;Object.assign(STATE,{searchQ:I2.search.query,searchKind:I2.search.kind,searchYear:I2.search.year,searchSection:I2.search.section,searchSort:I2.search.sort});setTimeout(()=>{const x=I2.search;if($('#searchQ')){$('#searchQ').value=x.query;$('#searchKind').value=x.kind;$('#searchYear').value=x.year;$('#searchSection').value=x.section;$('#searchSort').value=x.sort;runI2Search().then(()=>window.scrollTo({top:x.scrollY||0,behavior:'auto'}))}},0)}
  function bindI2(){
    updateLanguageControl();
    if(STATE.feature==='Universal Search'){
      $('#searchKind').value=STATE.searchKind||'all';$('#searchYear').value=STATE.searchYear||'';$('#searchSection').value=STATE.searchSection||'';$('#searchSort').value=STATE.searchSort||'relevance';let timer;$('#searchQ').oninput=()=>{clearTimeout(timer);timer=setTimeout(runI2Search,170)};['#searchKind','#searchYear','#searchSection','#searchSort'].forEach(s=>$(s).onchange=runI2Search);$('#searchClear').onclick=()=>{Object.assign(STATE,{searchQ:'',searchKind:'all',searchYear:'',searchSection:'',searchSort:'relevance'});render()};$('#searchFilterToggle').onclick=()=>{const p=$('#i2Filters'),open=p.hidden;p.hidden=!open;$('#searchFilterToggle').setAttribute('aria-expanded',String(open))};runI2Search();
    }
    if(STATE.feature==='Journal'){
      $('#journalStartWrite')?.addEventListener('click',()=>openProductDock('writer',{date:localDateISO(),openedFrom:'journal'}));
      $('#journalStartImport')?.addEventListener('click',()=>openProductDock('import',{openedFrom:'journal'}));
      const root=document.querySelector('.i2JournalVolume');
      if(root&&I2.journalData){
        const data=I2.journalData;
        if($('#journalEdit'))$('#journalEdit').onclick=null;
        I2.journalBook=window.lifeosJournalBook.mount({...data,root,
          onOpen:(path,direction)=>{I2.journalTurn=direction||'idle';return openJournal(path)},
          onKind:kind=>{if(!['daily','weekly'].includes(kind))return;STATE.journalKind=kind;STATE.journalPath=null;syncHistory('replace');return render()},
          onEdit:()=>{if(data.kind==='weekly'||data.j?.memory?.kind==='weekly')return;return openProductDock('writer',{path:data.path,openedFrom:'journal',returnContext:{sourcePath:data.path}})},
          onVersions:()=>{if(data.kind==='weekly'||data.j?.memory?.kind==='weekly')return;return openProductDock('versions',{path:data.path})},
          onBackSearch:()=>{openFeature('Universal Search');restoreSearch()},onError:error=>toast(error.message||String(error)),
          dates:async range=>{const params=new URLSearchParams({content:'1'});if(range.start)params.set('from',range.start);if(range.end)params.set('to',range.end);const result=await api('/api/writer/dates?'+params,{noCache:true});return (result.items||[]).filter(item=>item.saved)}
        });
      }
    }
  }

  openJournal=async function(path){if(STATE.feature==='Universal Search'){captureSearch();I2.search.selectedSourcePath=path;try{sessionStorage.setItem('lifeos.i2.search',JSON.stringify(I2.search))}catch(_){}}return saved.openJournal(path)};
  openProductDock=async function(tab='writer',context={}){const result=await saved.openProductDock(tab,context);document.body.classList.toggle('writerImmersive',PRODUCT.tab==='writer'&&$('#productDock')?.classList.contains('open'));if(typeof buildRail==='function')buildRail();return result};
  setProductDock=function(open){if(!open){I2.flushDraft?.();I2.flushDraft=null}saved.setProductDock(open);if(!open){I2.layout?.destroy();I2.layout=null;I2.calendar?.destroy();I2.calendar=null;I2.renderSequence=(I2.renderSequence||0)+1;I2.editing=false;I2.chapterOpen=false;document.body.classList.remove('writerImmersive')};if(typeof buildRail==='function')buildRail()};
  function installI2Surface(){
    if(I2.installed)return;I2.installed=true;
    // v01 boot loads its copydeck asynchronously, so install after it has
    // finished assigning its compatibility renderers.
    renderProductWriter=renderWriterExpanded;RENDERERS['Journal']=renderJournalI2;RENDERERS['Universal Search']=renderSearchI2;
    bindSpecific=function(){saved.bindSpecific();bindI2()};
    const previousRender=render;render=async function(){I2.journalBook?.destroy();I2.journalBook=null;I2.journalSequence=(I2.journalSequence||0)+1;await previousRender();updateLanguageControl()};
    if($('#productDock')?.classList.contains('open')&&PRODUCT.tab==='writer')renderProductWriter();
    window.dispatchEvent(new Event('lifeos:i2-ready'));
  }
  window.lifeosRegisterPetFeature=function(renderPets,bindPets){
    if(FEATURES.some(item=>item.name==='Pets'))return;
    FEATURES.push({name:'Pets',room:'NOW',desc:'本地宠物库、动作与陪伴角色',no:'PET'});
    ROOMS.NOW.features.splice(2,0,'Pets');
    USER_NAV.splice(USER_NAV.findIndex(item=>item.feature==='On This Day')+1,0,{id:'pet',icon:'✦',label:'灵犀',feature:'Pets'});
    FRONT_FEATURES.add('Pets');DREAM_META.Pets=['陪伴角色','在本机选择、下载并照看你的桌宠。'];RENDERERS.Pets=renderPets;
    const priorBind=bindSpecific;bindSpecific=function(){priorBind();bindPets()};
  };
  I2.preset=preset();
  window.lifeosI2Renderers={journal:renderJournalI2,search:renderSearchI2};
  window.addEventListener('keydown',e=>{if(e.key==='Escape'&&I2.calendar?.isOpen?.()){e.preventDefault();e.stopImmediatePropagation();I2.calendar.close();return}if(e.key==='Escape'&&document.body.classList.contains('writerImmersive')){if(e.defaultPrevented)return;if(document.querySelector('.i2WriterGrid')?.dataset.layoutGesture||e.target.closest?.('[data-cell-title-input]'))return;if(document.querySelector('.i2DeskInlineEdit')){e.preventDefault();e.stopImmediatePropagation();$('#writerCustomizeCells')?.click();return}if(document.querySelector('.i2WriterGrid.is-focused-cell'))return;e.preventDefault();saveDraft();writerReturn()}},true);
  if(window.lifeosV01Ready)installI2Surface();
  else window.addEventListener('lifeos:v01-ready',installI2Surface,{once:true});
  setTimeout(updateLanguageControl,800);
  const stripWriterPlaceholders=()=>{$$('[placeholder],[data-placeholder]').forEach(node=>{node.removeAttribute('placeholder');node.removeAttribute('data-placeholder')})};
  new MutationObserver(stripWriterPlaceholders).observe(document.body,{childList:true,subtree:true});
  stripWriterPlaceholders();
})();
