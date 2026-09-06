/* LifeOS V0.1 · product direction implementation
   Scope: core journey, Writer first, local search first, locale + copyMode.
   Existing 142 systems remain accessible through the system palette. */
(() => {
  'use strict';

  const PRESETS = {
    poetic: {locale:'zh-CN', copyMode:'poetic'},
    bilingual: {locale:'zh-CN', copyMode:'bilingual'},
    en: {locale:'en-US', copyMode:'clear'}
  };
  const EN_THEME = {
    moon:'Moonlit Study', candy:'Peach Bloom', rain:'Rainy Window', pixel:'River Diagram',
    greenhouse:'Orchid Greenhouse', abyss:'Night Sea', post:'Letter Post', hotel:"Traveler's Inn",
    oracle:'Star Observatory', film:'Summer Film'
  };
  const CLEAR = {
    zh: {
      nav:{today:'今天',write:'写日记',journal:'日记',search:'搜索',memory:'旧日来信',pet:'灵犀',more:'更多'},
      top:{write:'写下来',search:'搜日记',ask:'问过去',tune:'微调'},
      home:{kicker:'LOCAL-FIRST · PRIVATE JOURNAL',titleA:'把今天',titleB:'写下来。',lead:'先把写、存、找、重读做得可靠。分析与 AI 都退到第二层，需要时再出现。',write:'写今天',continue:'继续写',journal:'翻日记',search:'搜一句话',memory:'看看旧日'},
      journey:[['01 · WRITE','写','空白页先出现，结构化模板以后再选。'],['02 · FIND','找','从一句话、一个人、一个地方回到原页。'],['03 · REREAD','重读','按日期翻阅，所有解释都能回到正文。'],['04 · RESURFACE','重逢','同一天的旧页偶尔回来，不制造打卡压力。']],
      writer:{kicker:'WRITE · REVISION SAFE',newTitle:'写下今天。',editTitle:'继续这一页。',note:'每次正式保存都会形成可恢复的 Revision；自动草稿只保存在这台设备。',date:'日期',title:'标题 · 可选',tags:'标签 · 逗号分隔',blank:'空白页',daily:'六段式',review:'周复盘',custom:'自定义',focus:'专注写作',exitFocus:'退出专注',saveNew:'留下这一页',saveEdit:'保存为新版本',clear:'清掉本地草稿',extras:'更多选项 · 结构 / 附件 / 版本',mainPlaceholder:'从今天真正发生的一件小事写起……',optionalPlaceholder:'留空也没关系。',draft:'草稿已留存在这台设备',saving:'正在保存正式版本…',saved:'已保存 · 此页已落定',failed:'未保存 · 请重试；草稿仍在本机',offline:'本地服务暂不可用 · 草稿仍在本机',templateHelp:'空白页是默认入口。模板只决定显示哪些段落，不会删除已经写过的内容。'},
      search:{title:'在日记里找回一段过去。',lead:'优先搜索你的原始日记与周记；结果永远可以回到那一页。',placeholder:'一句话、一个人、一个地方，或某一年…',go:'去找',empty:'输入一个词开始寻找。',none:'这一回没有找到相合的文字。换个说法，或去流年里看看。'},
      themeLabel:'视觉世界', languageLabel:'语言与文案', languageHint:'中文 / English / 诗文只改变界面文案，不改动日记正文。', advanced:'其他'
    },
    en: {
      nav:{today:'Today',write:'Write',journal:'Journal',search:'Search',memory:'On this day',pet:'Companion',more:'More'},
      top:{write:'Write',search:'Search journals',ask:'Ask the past',tune:'Tune'},
      home:{kicker:'LOCAL-FIRST · PRIVATE JOURNAL',titleA:'Write down',titleB:'today.',lead:'Make writing, saving, finding, and rereading reliable first. Analysis and AI stay in the second layer until you ask for them.',write:'Write today',continue:'Continue writing',journal:'Open journal',search:'Find a phrase',memory:'On this day'},
      journey:[['01 · WRITE','Write','Start from a blank page. Templates stay optional.'],['02 · FIND','Find','Return to the source from a phrase, person, place, or year.'],['03 · REREAD','Reread','Browse by date. Every interpretation can return to the original page.'],['04 · RESURFACE','Resurface','Old pages can come back gently, without streak pressure.']],
      writer:{kicker:'WRITE · REVISION SAFE',newTitle:'Write today.',editTitle:'Continue this page.',note:'Every committed save creates a recoverable Revision. Autosaved drafts stay on this device.',date:'Date',title:'Title · optional',tags:'Tags · comma separated',blank:'Blank',daily:'Six-part',review:'Weekly review',custom:'Custom',focus:'Focus',exitFocus:'Exit focus',saveNew:'Save this page',saveEdit:'Save new revision',clear:'Clear local draft',extras:'More options · structure / attachments / versions',mainPlaceholder:'Start with one small thing that actually happened today…',optionalPlaceholder:'Optional.',draft:'Draft saved on this device',saving:'Saving committed revision…',saved:'Saved · revision committed',failed:'Save failed · local draft is still safe',offline:'Local service unavailable · draft is still safe',templateHelp:'Blank is the default. Templates only change which sections are visible; existing content is never removed.'},
      search:{title:'Find a moment in your journals.',lead:'Search your original daily and weekly sources first. Every result returns to its source page.',placeholder:'A phrase, person, place, or year…',go:'Search',empty:'Type something to start.',none:'Nothing matched this time. Try another phrase or browse the journal.'},
      themeLabel:'Visual world', languageLabel:'Language & copy', languageHint:'Language presets change interface copy only. Your journal text is never translated automatically.', advanced:'Other'
    }
  };

  const state = {preset:'poetic', deck:null};
  const getPreset = () => {
    // Earlier Iteration 2 builds wrote this preference as plain text while
    // the shared preference helper writes JSON. Accept both so an existing
    // choice survives an upgrade and a reload.
    const parsed = typeof pref === 'function' ? pref('languagePreset',null) : null;
    const raw = parsed || localStorage.getItem('lifeos.pref.languagePreset');
    const p = typeof raw === 'string' ? raw.replace(/^"|"$/g,'') : raw;
    return PRESETS[p] ? p : 'poetic';
  };
  const baseCopy = () => CLEAR[state.preset === 'en' ? 'en' : 'zh'];
  const deckSurface = key => (state.deck?.core_surfaces || []).find(x => x.key === key) || null;
  const t = () => {
    const c = JSON.parse(JSON.stringify(baseCopy()));
    if (state.preset === 'poetic' && state.deck) {
      const home = deckSurface('home'), writer = deckSurface('writer'), journal = deckSurface('journal'), search = deckSurface('search'), on = deckSurface('on_this_day'), ask = deckSurface('ask');
      c.nav.today = home?.display_name || '今朝'; c.nav.write = writer?.display_name || '落笔'; c.nav.journal = journal?.display_name || '流年'; c.nav.search = search?.display_name || '寻迹'; c.nav.memory = on?.display_name || '旧信';
      c.top.write = writer?.display_name || '落笔'; c.top.search = search?.display_name || '寻迹'; c.top.ask = ask?.display_name || '近思'; c.home.kicker='LIFEOS · 浮生书'; c.home.titleA='把今日写下，'; c.home.titleB='让来日重逢。'; c.home.lead=home?.subtitle || state.deck.brand?.body || c.home.lead;
      c.home.write = home?.primary || '落笔 · 写今天'; c.home.journal = '翻一页 · 流年'; c.home.search='寻迹 · 找一句话'; c.home.memory='旧日来信 · 昔日今朝';
      c.writer.kicker='落笔 · WRITE'; c.writer.newTitle=writer?.display_name || '落笔'; c.writer.editTitle='续写这一页。'; c.writer.note=writer?.subtitle || c.writer.note; c.writer.mainPlaceholder=writer?.placeholder || c.writer.mainPlaceholder; c.writer.saveNew=writer?.primary || '收笔 · 保存'; c.writer.saveEdit=writer?.primary || '收笔 · 保存';
      c.writer.draft=writer?.states?.autosaved || c.writer.draft; c.writer.saving=writer?.states?.saving || c.writer.saving; c.writer.saved=writer?.states?.saved || c.writer.saved; c.writer.failed=writer?.states?.failed || c.writer.failed; c.writer.offline=writer?.states?.offline || c.writer.offline;
      c.search.title=search?.subtitle || c.search.title; c.search.placeholder=search?.placeholder || c.search.placeholder; c.search.go=search?.primary || '去寻'; c.search.none=search?.empty || c.search.none;
      c.journey=[['01 · 落笔','写','今日这一页，从空白开始。'],['02 · 寻迹','找','从一句话，寻回一段已经远去的日子。'],['03 · 展卷','重读','旧页重开，所有路最终回到原文。'],['04 · 旧信','重逢','同一个今日，隔着不同年岁重新相逢。']];
      c.themeLabel='视觉世界';c.languageLabel='语言与文案';c.languageHint='诗意负责情绪，功能词负责无歧义；正文永不被自动改写。';c.advanced='其他';
    }
    if (state.preset === 'bilingual') {
      c.nav={today:'今天 / Today',write:'写日记 / Write',journal:'日记 / Journal',search:'搜索 / Search',memory:'旧日 / On this day',pet:'灵犀 / Companion',more:'更多 / More'};
      c.top={write:'写下来 / Write',search:'搜日记 / Search',ask:'问过去 / Ask',tune:'微调 / Tune'};
      c.themeLabel='视觉世界 / Theme';c.languageLabel='语言与文案 / Language';c.languageHint='仅切换界面语言，不会改动日记正文。';c.advanced='其他';
    }
    return c;
  };

  async function loadDeck(){
    try { state.deck = await api('/api/copydeck',{noCache:true}); } catch (_) { state.deck = null; }
  }

  function presetOptionLabel(p){ return p==='bilingual'?'中英文结合':p==='en'?'English':'诗文'; }

  function ensureLanguageControl(){
    const theme = document.querySelector('#themeSelect')?.closest('.tweakField');
    if (!theme || document.querySelector('#languagePreset')) return;
    const label=document.createElement('label');label.className='tweakField v01LangField';
    label.innerHTML=`<span>${esc(t().languageLabel)}</span><div><select id="languagePreset"><option value="poetic">诗文</option><option value="bilingual">中英文结合</option><option value="en">English</option></select><small id="languageHint">${esc(t().languageHint)}</small></div>`;
    theme.parentNode.insertBefore(label,theme);
    const select=label.querySelector('select');select.value=state.preset;
    select.onchange=async e=>{
      state.preset=e.target.value; if(typeof remember==='function') remember('languagePreset',state.preset); else localStorage.setItem('lifeos.pref.languagePreset',state.preset);
      const p=PRESETS[state.preset];
      try{await post('/api/product/settings',{items:{'ui.locale':p.locale,'ui.copy_mode':p.copyMode,'ui.language_preset':state.preset}})}catch(_){ }
      applyCoreCopy();
      if(typeof render==='function') await render();
      if(document.querySelector('#productDock')?.classList.contains('open')) await renderProductTab(PRODUCT.tab||'writer');
      if(typeof dreamBubble==='function') dreamBubble(state.preset==='en'?'Language updated.':state.preset==='poetic'?'换作诗文一窗。':'已切换中英文结合。');
    };
  }

  function updateThemeLabels(){
    const c=t(); const themes=state.deck?.themes || [];
    document.querySelectorAll('#themeSelect option').forEach(opt=>{
      const id=opt.value; if(!id)return;
      if(state.preset==='en') opt.textContent=EN_THEME[id] || opt.textContent;
      else if(state.preset==='poetic') opt.textContent=themes.find(x=>x.id===id)?.display_name || opt.textContent;
      else {
        const zh={moon:'月光档案馆',candy:'蜜桃梦境',rain:'雨夜录像厅',pixel:'像素卧室',greenhouse:'玻璃温室',abyss:'深海电台',post:'星际邮局',hotel:'无尽旅馆',oracle:'黑猫占星室',film:'胶片夏日'};
        opt.textContent=zh[id]||opt.textContent;
      }
    });
    const themeLabel=document.querySelector('#themeSelect')?.closest('label')?.querySelector(':scope > span');if(themeLabel)themeLabel.textContent=c.themeLabel;
  }

  function reprioritizeProductTabs(){
    const nav=$('.productTabs'); if(!nav || $('#v01DeferredTabs')) return;
    const deferred=['sync','inbox','platform'].map(id=>nav.querySelector(`[data-producttab="${id}"]`)).filter(Boolean);
    if(!deferred.length)return;
    const details=document.createElement('details');details.id='v01DeferredTabs';details.className='v01DeferredTabs';
    const summary=document.createElement('summary');summary.textContent=state.preset==='en'?'Later / platform':'以后再做 · 多端能力';details.appendChild(summary);
    deferred.forEach(b=>details.appendChild(b));nav.appendChild(details);
  }

  function rebuildAttic(){
    const grid=$('#atticGrid');if(!grid)return;
    const core=new Set(['Home','Journal','On This Day','Universal Search']);
    const rest=FEATURES.filter(f=>!core.has(f.name));
    grid.innerHTML=rest.map(f=>`<button class="atticItem" data-atticfeature="${esc(f.name)}"><b>${esc(dreamMeta(f.name).title)}</b><span>${String(f.no).padStart(3,'0')} · ${esc(f.name)} · ${esc(f.room)}</span></button>`).join('');
    $$('[data-atticfeature]').forEach(x=>x.onclick=()=>{$('#atticPanel').classList.remove('open');$('#atticPanel').setAttribute('aria-hidden','true');openFeature(x.dataset.atticfeature)});
    const p=$('#atticPanel .small');if(p)p.textContent=state.preset==='en'?`${rest.length} existing capabilities are preserved here and kept outside the daily path.`:`${rest.length} 个现有能力完整保留在这里，不占用日常主链路。`;
  }

  function applyCoreCopy(){
    const c=t(); document.documentElement.lang=PRESETS[state.preset].locale;
    const dockTitle=$('#productDockTitle');if(dockTitle)dockTitle.textContent=state.preset==='en'?'Write and keep every version.':state.preset==='poetic'?'文字有安处，从落笔开始。':'先把写作与数据安全做好。';
    const dockNote=$('#productDockTitle')?.parentElement?.querySelector('p');if(dockNote)dockNote.textContent=state.preset==='en'?'Writing, import, revisions, backup and privacy first. Sync and platform work are deferred.':'优先写作、导入、版本、备份与隐私；同步和平台能力继续保留，但放到后面。';
    const tabLabels={writer:state.preset==='en'?'Write':'写日记',import:state.preset==='en'?'Import':'导入',export:state.preset==='en'?'Export':'导出',versions:state.preset==='en'?'Revisions':'版本',backup:state.preset==='en'?'Backup':'备份',privacy:state.preset==='en'?'Privacy / AI':'隐私 / AI',sync:state.preset==='en'?'Sync':'同步',inbox:state.preset==='en'?'Inbox':'收件箱',platform:state.preset==='en'?'Platform':'P2 / 多端'};
    $$('[data-producttab]').forEach(b=>{const n=b.querySelector('span')?.outerHTML||'';b.innerHTML=n+esc(tabLabels[b.dataset.producttab]||b.textContent)});
    const w=document.querySelector('#memoryDockOpen');if(w)w.innerHTML=`${esc(c.top.write)} <span aria-hidden="true">＋</span>`;
    const s=document.querySelector('#searchTop');if(s){s.setAttribute('aria-label',c.top.search);s.innerHTML=`<span class="desktopOnly">${esc(c.top.search)}</span><span class="kbd">⌘ K</span>`;}
    const a=document.querySelector('#askTop');if(a)a.innerHTML=`${esc(c.top.ask)} <span aria-hidden="true">↗</span>`;
    const tw=document.querySelector('#allRail');if(tw)tw.textContent=c.top.tune;
    const attic=document.querySelector('#atticOpen');if(attic)attic.innerHTML=`${esc(c.advanced)} <span aria-hidden="true">→</span>`;
    const lp=document.querySelector('#languagePreset');if(lp){lp.value=state.preset;const hint=document.querySelector('#languageHint');if(hint)hint.textContent=c.languageHint;const l=lp.closest('label')?.querySelector(':scope > span');if(l)l.textContent=c.languageLabel;}
    updateThemeLabels();reprioritizeProductTabs();rebuildAttic();
    const deferred=$('#v01DeferredTabs summary');if(deferred)deferred.textContent=state.preset==='en'?'Later / platform':'以后再做 · 多端能力';
    if(typeof buildRail==='function') buildRail();
  }

  // v012 owns the visible selector, while this layer owns the home and
  // navigation copy. Keep the two render layers on one explicit state change.
  window.addEventListener('lifeos:language-change',event=>{
    const next=event.detail?.preset;
    if(!PRESETS[next])return;
    state.preset=next;
    applyCoreCopy();
  });

  function v01BuildRail(){
    const c=t(), el=$('#rooms'); if(!el) return;
    const items=[
      {id:'today',icon:'today',label:c.nav.today,feature:'Home'},
      {id:'write',icon:'write',label:c.nav.write,action:'write'},
      {id:'journal',icon:'journal',label:c.nav.journal,feature:'Journal'},
      {id:'search',icon:'search',label:c.nav.search,feature:'Universal Search'},
      {id:'memory',icon:'memory',label:c.nav.memory,feature:'On This Day'},
      {id:'pet',icon:'magic',label:c.nav.pet,feature:'Pet Shelf',pet:true},
      {id:'other',icon:'attic',label:c.advanced.split(' · ')[0],feature:'Other'}
    ];
    el.innerHTML=items.map(v=>{const active=(v.feature&&STATE.feature===v.feature);return `<button class="roomBtn ${active?'active':''}" type="button" data-nav-id="${esc(v.id)}" ${v.pet?'data-petpage="true"':v.feature?`data-frontfeature="${esc(v.feature)}"`:''} ${v.action?`data-coreaction="${esc(v.action)}"`:''} aria-current="${active?'page':'false'}">${uiIcon(v.icon)}<span class="navText">${esc(v.label)}</span></button>`}).join('')+`<button class="roomBtn mobileMoreButton" id="mobileMoreBtn" type="button" aria-haspopup="dialog" aria-controls="mobileMorePanel" aria-expanded="false">${uiIcon('more')}<span class="navText">${esc(c.nav.more)}</span></button>`;
    $$('[data-frontfeature]').forEach(b=>b.onclick=()=>{closeMobileMore();openFeature(b.dataset.frontfeature)});
    $$('[data-petpage]').forEach(b=>b.onclick=()=>{closeMobileMore();window.dispatchEvent(new CustomEvent('lifeos:open-pet'))});
    $$('[data-coreaction="write"]').forEach(b=>b.onclick=()=>{closeMobileMore();openProductDock('writer',{date:localDateISO()})});
    $$('[data-coreaction="attic"]').forEach(b=>b.onclick=()=>{closeMobileMore();openFeature('Other')});
    const mb=$('#mobileMoreBtn');if(mb)mb.onclick=()=>toggleMobileMore();
  }

  async function renderV01Home(){
    const [d,core]=await Promise.all([api('/api/home',{noCache:true}),api('/api/core/status',{noCache:true})]);
    const c=t(), latest=d.latest||[], recent=latest[0], p=core.core||{}, today=localDateISO();
    const todayEntry=latest.find(x=>x.date===today); const on=(d.on_this_day||[])[0];
    return `<div class="page homePage"><section class="v01HomeHero"><div><div class="kicker">${esc(c.home.kicker)}</div><h1>${esc(c.home.titleA)}<br><em>${esc(c.home.titleB)}</em></h1><p>${esc(c.home.lead)}</p><div class="v01HomePrimary"><button class="primary" id="homeWrite">${esc(todayEntry?c.home.continue:c.home.write)}</button><button data-feature="Journal">${esc(c.home.journal)}</button><button data-feature="Universal Search">${esc(c.home.search)}</button><button data-feature="On This Day">${esc(c.home.memory)}</button></div></div><aside class="v01ArchiveCard"><h3>${state.preset==='en'?'Your archive, as it is.':'你的档案，就按真实样子在这里。'}</h3><dl><div><dt>${state.preset==='en'?'Entries':'日记与周记'}</dt><dd>${fmt(p.entries??0)}</dd></div><div><dt>${state.preset==='en'?'Revisions':'历史版本'}</dt><dd>${fmt(p.revisions??0)}</dd></div><div><dt>${state.preset==='en'?'Today':'今天'}</dt><dd>${todayEntry?(state.preset==='en'?'saved':'已写'):(state.preset==='en'?'blank':'未写')}</dd></div></dl>${recent?`<div class="small" style="margin-top:16px">${state.preset==='en'?'Latest source':'最近一页'} · ${esc(recent.date)}</div>`:''}</aside></section><section class="v01Journey">${c.journey.map((x,i)=>`<button type="button" ${i===0?'id="homeWriteJourney"':i===1?'data-feature="Universal Search"':i===2?'data-feature="Journal"':'data-feature="On This Day"'}><span>${esc(x[0])}</span><b>${esc(x[1])}</b><small>${esc(x[2])}</small></button>`).join('')}</section>${on?`<section class="homeResume"><button type="button" data-source="${esc(on.source_path)}"><span>${state.preset==='en'?'ON THIS DAY':'旧日来信'}</span><b>${esc(on.date)}</b><small>${state.preset==='en'?'Open the original page.':'打开原页，不生成额外结论。'}</small></button></section>`:''}</div>`;
  }

  const TEMPLATE_SECTIONS={
    blank:['日记'],
    daily:['日程','日记','自我探索','心得与摘录','体系构建','习惯打卡'],
    review:['日记','自我探索','心得与摘录','体系构建'],
    custom:['日记']
  };
  const ALL_SECTIONS=['日程','日记','自我探索','心得与摘录','体系构建','习惯打卡'];
  function writerTemplateKey(){return 'lifeos.writer.template'}
  function readTemplate(){return localStorage.getItem(writerTemplateKey())||'blank'}
  function writeTemplate(v){localStorage.setItem(writerTemplateKey(),v)}
  function writerState(stateName,text){const el=$('#writerDraftState');if(!el)return;el.dataset.state=stateName;el.textContent=text}
  function saveV01Draft(){
    const form=$('#writerForm');if(!form)return;const c=t(),date=$('#writerDate')?.value||localDateISO(),rec={date,title:$('#writerTitle')?.value||'',tags:$('#writerTags')?.value||'',template:form.dataset.template||'blank',visible:[],sections:{},savedAt:new Date().toISOString()};
    $$('[data-wsec]').forEach(x=>{rec.sections[x.dataset.wsec]=x.value;if(!x.closest('.writerSection')?.classList.contains('isHidden'))rec.visible.push(x.dataset.wsec)});
    try{localStorage.setItem(writerDraftKey(date),JSON.stringify(rec));writerState('draft',`${c.writer.draft} · ${new Intl.DateTimeFormat(PRESETS[state.preset].locale,{hour:'2-digit',minute:'2-digit'}).format(new Date())}`)}catch(_){ }
  }
  function applyWriterTemplate(template,keepNonEmpty=true){
    const form=$('#writerForm');if(!form)return;form.dataset.template=template;writeTemplate(template);
    const wanted=new Set(TEMPLATE_SECTIONS[template]||['日记']);
    if(template==='custom')$$('[data-section-choice]').forEach(cb=>{if(cb.checked)wanted.add(cb.value)});
    $$('[data-wsec]').forEach(x=>{const row=x.closest('.writerSection');const show=wanted.has(x.dataset.wsec)||(keepNonEmpty&&x.value.trim());row?.classList.toggle('isHidden',!show)});
    $$('[data-template]').forEach(b=>b.classList.toggle('active',b.dataset.template===template));
    if($('#writerCustomChooser'))$('#writerCustomChooser').hidden=template!=='custom';
  }
  async function renderV01Writer(){
    const c=t(),j=await loadWriterSource(),existing=j?.product_entry||null,date=existing?.journal_date||j?.memory?.date||PRODUCT.context.date||localDateISO(),draft=!existing?readWriterDraft(date):null,sections={};
    for(const k of ALL_SECTIONS)sections[k]=j?.sections?.[k]??draft?.sections?.[k]??'';
    const nonEmpty=ALL_SECTIONS.filter(k=>String(sections[k]||'').trim()),template=existing?(nonEmpty.length>1?'daily':'blank'):(draft?.template||readTemplate()),att=j?.attachments||[],revs=j?.revisions||[];
    $('#productPanel').innerHTML=`<div class="productPanelInner">${productIntro(c.writer.kicker,existing?c.writer.editTitle:c.writer.newTitle,c.writer.note)}<form id="writerForm" data-entry-id="${esc(existing?.entry_id||'')}" data-source="${esc(existing?.source_path||'')}" data-template="${esc(template)}"><div class="writerModeBar"><div class="writerTemplateGroup"><div class="segmented"><button type="button" data-template="blank">${esc(c.writer.blank)}</button><button type="button" data-template="daily">${esc(c.writer.daily)}</button><button type="button" data-template="review">${esc(c.writer.review)}</button><button type="button" data-template="custom">${esc(c.writer.custom)}</button></div><div class="writerTemplateHelp">${esc(c.writer.templateHelp)}</div></div><button class="productAction writerFocusToggle" id="writerFocus" type="button">${esc(document.body.classList.contains('writerFocusMode')?c.writer.exitFocus:c.writer.focus)}</button></div><div class="writerMeta writerMetaCollapsible"><label class="fieldLabel">${esc(c.writer.date)}<input class="input" id="writerDate" type="date" value="${esc(date)}" required></label><label class="fieldLabel">${esc(c.writer.title)}<input class="input" id="writerTitle" value="${esc(existing?.title||draft?.title||'')}" placeholder="${state.preset==='en'?'A light name for today':'给今天一个很轻的名字'}"></label><label class="fieldLabel">${esc(c.writer.tags)}<input class="input" id="writerTags" value="${esc((existing?.tags||[]).join(', ')||draft?.tags||'')}" placeholder="${state.preset==='en'?'product, friends, night':'产品, 朋友, 夜晚'}"></label></div><div class="writerSheet">${ALL_SECTIONS.map(k=>`<div class="writerSection ${k==='日记'?'main':''}" data-optional="${k==='日记'?'false':'true'}"><label for="w-${esc(k)}">${esc(k)}</label><textarea id="w-${esc(k)}" data-wsec="${esc(k)}" placeholder="${esc(k==='日记'?c.writer.mainPlaceholder:c.writer.optionalPlaceholder)}">${esc(sections[k])}</textarea></div>`).join('')}</div><details class="writerExtras"><summary>${esc(c.writer.extras)}</summary><div class="writerExtrasBody"><div id="writerCustomChooser" hidden><div class="writerSectionChooser">${ALL_SECTIONS.filter(k=>k!=='日记').map(k=>`<label><input type="checkbox" data-section-choice value="${esc(k)}" ${String(sections[k]||'').trim()?'checked':''}>${esc(k)}</label>`).join('')}</div></div><div class="settingCard"><h4>${state.preset==='en'?'Attachments':'照片与附件'}</h4><p>${state.preset==='en'?'Attachments stay outside Markdown and remain linked to this entry.':'附件继续保存在正文之外，不把二进制内容塞进 Markdown。'}</p>${att.length?`<div class="attachmentList">${att.map(a=>`<a class="attachmentChip" href="/api/attachment?attachment_id=${encodeURIComponent(a.attachment_id)}" target="_blank" rel="noopener">${esc(a.original_name)} · ${fmt(a.bytes)}B</a>`).join('')}</div>`:''}<input class="input" id="writerAttachments" type="file" multiple style="margin-top:12px"></div><div class="settingCard" style="margin-top:10px"><h4>${state.preset==='en'?'Revision history':'历史版本'}</h4><p>${fmt(revs.length)} ${state.preset==='en'?'visible revisions. Restoring an old version creates another revision instead of deleting history.':'个可见版本。恢复旧版也会产生一个新 Revision，不删除历史。'}</p>${existing?`<button class="productAction" type="button" id="writerVersions">${state.preset==='en'?'Open revisions':'查看历史版本'}</button>`:''}</div></div></details><div class="writerFoot"><span class="writerDraft writerState" id="writerDraftState" data-state="${draft?'draft':existing?'saved':'draft'}">${existing?`${revs.length} ${state.preset==='en'?'revisions':'个版本'} · ${esc((existing.current_revision_id||'').slice(-8))}`:draft?c.writer.draft:c.writer.draft}</span><div class="actions"><button class="productAction" type="button" id="writerClearDraft">${esc(c.writer.clear)}</button><button class="productAction primary" type="submit" id="writerSave">${esc(existing?c.writer.saveEdit:c.writer.saveNew)}</button></div></div></form></div>`;
    const form=$('#writerForm');applyWriterTemplate(template,true);
    let timer=null;form.addEventListener('input',()=>{clearTimeout(timer);writerState('draft',c.writer.draft);timer=setTimeout(saveV01Draft,420)});$('#writerDate').addEventListener('change',saveV01Draft);
    $$('[data-template]').forEach(b=>b.onclick=()=>{applyWriterTemplate(b.dataset.template,true);saveV01Draft()});
    $$('[data-section-choice]').forEach(cb=>cb.onchange=()=>{applyWriterTemplate('custom',true);saveV01Draft()});
    $('#writerFocus').onclick=()=>{document.body.classList.toggle('writerFocusMode');$('#writerFocus').textContent=document.body.classList.contains('writerFocusMode')?c.writer.exitFocus:c.writer.focus;$('#w-日记')?.focus()};
    if($('#writerVersions'))$('#writerVersions').onclick=()=>renderProductTab('versions');
    $('#writerClearDraft').onclick=()=>{localStorage.removeItem(writerDraftKey($('#writerDate').value));if(!existing){$$('[data-wsec]').forEach(x=>x.value='');$('#writerTitle').value='';$('#writerTags').value=''}writerState('draft',state.preset==='en'?'Local draft cleared':'本地草稿已清除')};
    form.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='s'){e.preventDefault();form.requestSubmit()}if((e.metaKey||e.ctrlKey)&&e.key==='Enter'){e.preventDefault();form.requestSubmit()}});
    form.onsubmit=async e=>{e.preventDefault();const btn=$('#writerSave'),wasExisting=!!form.dataset.entryId,saveLabel=wasExisting?c.writer.saveEdit:c.writer.saveNew;btn.disabled=true;btn.textContent=c.writer.saving;writerState('saving',c.writer.saving);try{const tags=$('#writerTags').value.split(/[,，]/).map(x=>x.trim()).filter(Boolean),payload={entry_id:form.dataset.entryId||null,journal_date:$('#writerDate').value,title:$('#writerTitle').value.trim(),tags,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone||'',sections:{}};$$('[data-wsec]').forEach(x=>payload.sections[x.dataset.wsec]=x.value);const d=await post('/api/entries/save',payload),input=$('#writerAttachments'),files=input?[...(input.files||[])]:[];for(const file of files){if(file.size>25_000_000)throw new Error(`${file.name} ${state.preset==='en'?'is over 25MB':'超过 25MB'}`);await post('/api/attachments',{entry_id:d.result.entry_id,revision_id:d.result.revision_id,name:file.name,mime_type:file.type||'application/octet-stream',data_base64:await fileToBase64(file)})}localStorage.removeItem(writerDraftKey(payload.journal_date));writerState('saved',c.writer.saved);lifeEvent(wasExisting?'entry-updated':'entry-created',{date:payload.journal_date,status:'saved'});dreamBubble(state.preset==='en'?(wasExisting?'A new revision was added.':'Today is in the archive.'):state.preset==='poetic'?(wasExisting?'旧页未被抹去，只添一笔新痕。':'此页已落定。'):(wasExisting?'已增加一个新版本，没有覆盖过去。':'今天已经留在档案里了。'));STATE.journalPath=d.result.source_path;STATE.journalKind='daily';setTimeout(async()=>{document.body.classList.remove('writerFocusMode');setProductDock(false);await openJournal(d.result.source_path)},280)}catch(err){const offline=/fetch|network|failed/i.test(err.message||'');writerState(offline?'offline':'error',offline?c.writer.offline:c.writer.failed);toast(err.message)}finally{btn.disabled=false;btn.textContent=saveLabel}};
  }

  async function renderV01Search(){
    const c=t(),q=STATE.searchQ||'',kind=STATE.searchKind||'all',year=STATE.searchYear||'',section=STATE.searchSection||'',sort=STATE.searchSort||'relevance';
    const years=['2025','2026'];
    return pageWrap(`<section><div class="kicker">UNIVERSAL SEARCH · SOURCE FIRST</div><h2 class="v01SearchPrompt">${esc(c.search.title)}</h2><p class="v01SearchLead">${esc(c.search.lead)}</p><div class="searchWorkspace"><aside class="searchFilters"><div class="kicker">${state.preset==='en'?'SEARCH SCOPE':'搜索范围'}</div><div class="filterField"><label class="kicker">${state.preset==='en'?'Source type':'来源'}</label><select class="input" id="searchKind"><option value="all" ${kind==='all'?'selected':''}>${state.preset==='en'?'Daily + Weekly':'日记 + 周记'}</option><option value="daily" ${kind==='daily'?'selected':''}>${state.preset==='en'?'Daily only':'仅日记'}</option><option value="weekly" ${kind==='weekly'?'selected':''}>${state.preset==='en'?'Weekly only':'仅周记'}</option></select></div><div class="filterField"><label class="kicker">${state.preset==='en'?'Year':'年份'}</label><select class="input" id="searchYear"><option value="">${state.preset==='en'?'All years':'全部年份'}</option>${years.map(y=>`<option ${year===y?'selected':''}>${y}</option>`).join('')}</select></div><div class="filterField"><label class="kicker">${state.preset==='en'?'Section':'段落'}</label><select class="input" id="searchSection"><option value="">${state.preset==='en'?'All sections':'全部段落'}</option>${['日记','自我探索','体系构建','日程','心得与摘录'].map(x=>`<option ${section===x?'selected':''}>${x}</option>`).join('')}</select></div><div class="filterField"><label class="kicker">${state.preset==='en'?'Order':'排序'}</label><select class="input" id="searchSort"><option value="relevance" ${sort==='relevance'?'selected':''}>${state.preset==='en'?'Relevance':'相关度'}</option><option value="date_desc" ${sort==='date_desc'?'selected':''}>${state.preset==='en'?'Newest first':'最新优先'}</option><option value="date_asc" ${sort==='date_asc'?'selected':''}>${state.preset==='en'?'Oldest first':'最早优先'}</option></select></div><div class="facetBox" id="searchFacets"><span class="small">${state.preset==='en'?'Facets appear after search.':'搜索后显示匹配分布。'}</span></div></aside><section><div class="v01SearchBox"><input class="input" id="searchQ" value="${esc(q)}" placeholder="${esc(c.search.placeholder)}"><button class="btn" id="searchClear">${state.preset==='en'?'Clear':'清空'}</button></div><div class="searchActionBar"><button class="btn" id="searchDeepRead" ${q?'':'disabled'}>${state.preset==='en'?'Read over time':'沿时间深读'}</button><button class="btn" id="searchAsk" ${q?'':'disabled'}>${state.preset==='en'?'Ask from this query':'用这个问题去问'} ↗</button><span class="small">${state.preset==='en'?'Same query, different reading depth.':'同一个查询，只改变阅读深度。'}</span></div><div id="searchOut" style="margin-top:12px"><div class="small">${esc(c.search.empty)}</div></div></section></div></section>`);
  }


  function installBindings(){
    const oldRender=render; render=async function(){await oldRender();const journeyWrite=$('#homeWriteJourney');if(journeyWrite)journeyWrite.onclick=()=>openProductDock('writer',{date:localDateISO()});applyCoreCopy();};
    buildRail=v01BuildRail;
    const openOther=()=>{closeMobileMore();setPanelOpen?.($('#tweaksPanel'),$('#allRail'),false);openFeature('Other')};
    $('#atticOpen')?.addEventListener('click',event=>{event.preventDefault();event.stopImmediatePropagation();openOther()},true);
    $('#mobileAttic')?.addEventListener('click',event=>{event.preventDefault();event.stopImmediatePropagation();openOther()},true);
    renderProductWriter=renderV01Writer;
    RENDERERS['Home']=renderV01Home;
    RENDERERS['Universal Search']=renderV01Search;
    const searchTop=$('#searchTop');if(searchTop)searchTop.onclick=()=>openFeature('Universal Search');
    const allRail=$('#allRail');if(allRail){allRail.title=state.preset==='en'?'Fine-tune the interface':'界面微调';}
    window.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.shiftKey&&e.key.toLowerCase()==='k'){e.preventDefault();openPalette()}},true);
  }

  async function boot(){
    state.preset=getPreset();await loadDeck();installBindings();ensureLanguageControl();applyCoreCopy();await render();
  }
  boot().catch(console.error);
})();
