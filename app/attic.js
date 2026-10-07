/* Editorial attic: existing tools stay addressable; all content comes from local APIs. */
(() => {
  'use strict';
  const PAGES = [['Attic', '概览', 'overview'], ['Attic Review', '回看', 'memory'],
    ['Attic Organize', '整理', 'grow'], ['Attic Observe', '观察', 'discover']];
  const NAMES = new Set(PAGES.map(p => p[0]));
  const pageTitle = name => window.lifeosNavLabel?.(name) || PAGES.find(p=>p[0]===name)?.[1] || name;
  const groupTitle = () => window.lifeosNavCopy?.().attic || '阁楼';
  const state = Object.fromEntries(PAGES.map(([name]) => [name, {scroll: 0, year: '', topic: '', kind: '', month: '', offset: 0}]));
  let data = null, activePage = null, renderSequence = 0, drawerSequence = 0, drawerBack = null, resetScroll = false;
  let groupOpen = true;
  const get = id => document.getElementById(id);
  const TOPIC_LABELS={AI:'人工智能',Product:'产品',Research:'研究',Career:'职业',Learning:'学习',Relationships:'关系',Travel:'旅行',Self:'自我',Health:'健康',Money:'财务'};
  const topicLabel=value=>TOPIC_LABELS[value]||value;
  const TOOL_LABELS={'Timeline':'时间线','Quotes':'摘录','First / Last':'首次与最近','Year in Review':'年度回顾','Memory Echoes':'记忆回声','Hidden Chapters':'隐藏章节','On This Day':'往年今日','Timefold Atlas':'时间折叠','Book':'日记成册','Projects':'项目','Project Families':'项目家族','Ideas':'想法','Questions':'问题','Question Threads':'反复的问题','Decisions':'决定','Decision Replay':'决定回放','Forks':'分岔记录','Fork Replay':'分岔回放','Thought → Artifact':'想法与作品','Idea Genealogy':'想法脉络','Analytics':'写作统计','Habits':'习惯记录','Life Rhythms':'生活节律','Skill Evidence':'技能证据','Skill Evolution':'技能变化','Skill Momentum':'技能趋势','Skill Constellation':'技能关联','Month Portraits':'月度画像','Attention Portfolio':'主题分布','Word Evolution':'词语变化'};
  const fmtDate = value => String(value || '').replaceAll('-', '.');
  const number = value => Number(value || 0).toLocaleString('zh-CN');
  const scroller = () => document.querySelector('.shell');
  const action = (name, label) => `<button type="button" class="atticAction" data-attic-route="${esc(name)}">${esc(label)}</button>`;
  const sourceButton = (path, label = '阅读原页') => `<button type="button" class="atticAction" data-attic-source="${esc(path)}">${esc(label)}</button>`;
  const empty = (text, actions = '') => `<div class="atticEmpty"><p>${esc(text)}</p>${actions}</div>`;
  const params = obj => new URLSearchParams(Object.entries(obj).filter(([,v]) => v !== '' && v != null)).toString();
  const sectionHead = (id, n, title, right = '') => `<header class="atticRoomHead"><div class="atticRoomTitle"><span class="serial">${n}</span><h2 id="${id}">${esc(title)}</h2></div>${right}</header>`;

  for (const [name, title] of PAGES) {
    if (!FEATURES.some(f => f.name === name)) FEATURES.push({name, room: 'ATTIC', no: FEATURES.length + 1, desc: ''});
    DREAM_META[name] = [name === 'Attic' ? '阁楼' : title, ''];
    FRONT_FEATURES.add(name);
  }
  ROOMS.ATTIC = {no: '16', desc: '', features: [...NAMES]};

  function header(name, sections) {
    return `<header class="atticHeader"><h1>${esc(pageTitle(name))}</h1><div class="atticHeaderTools"><nav class="atticIndex" aria-label="页内目录">${sections.map(([id,label],i) => `<button type="button" data-attic-jump="${id}" class="${i ? '' : 'active'}">${label}</button>`).join('')}</nav><button type="button" class="atticAll" data-attic-tools>工具索引</button></div></header>`;
  }
  function wrap(name, content, sections) {
    return `<section class="atticArchive"><div class="atticLab" data-attic-page="${name}">${header(name, sections)}${content}<footer class="atticEnd"><span>${toolCatalog().length} 项工具</span><button type="button" class="atticAction" data-attic-tools>浏览全部工具</button></footer></div></section>`;
  }
  async function overview(name) {
    const sequence = renderSequence;
    const d = await api('/api/attic/overview?' + params({year: state[name].year}), {noCache: true});
    if (sequence !== renderSequence) return d;
    if (name === 'Attic' || name === 'Attic Observe') state[name].year = d.year;
    if (!d.topics.some(t => t.topic === state[name].topic)) state[name].topic = name === 'Attic' ? d.topics[0]?.topic || '' : '';
    if (!d.months.some(m => m.month === state[name].month)) state[name].month = [...d.months].reverse().find(m => m.days)?.month || `${d.year}-01`;
    return d;
  }
  function leaves(topic) {
    if (!topic) return empty('还没有主题记录', action('Universal Search', '搜索日记'));
    const single = topic.first.id === topic.last.id;
    return [topic.first, ...(single ? [] : [topic.last])].map((r, i) => `<article class="echoLeaf ${i ? 'second' : ''}"><header><span>${single ? '当前记录' : i ? '最近记录' : '首次记录'}</span><time>${fmtDate(r.date)}</time></header><blockquote>${esc(r.excerpt)}</blockquote><footer>${sourceButton(r.source_path)}</footer></article>`).join('');
  }
  function timeline(topic) {
    if (!topic) return '';
    const firstYear = Number(topic.first_date.slice(0,4)), lastYear = Number(topic.last_date.slice(0,4));
    const start = Date.parse(`${firstYear}-01-01T00:00:00Z`), end = Date.parse(`${lastYear + 1}-01-01T00:00:00Z`);
    const position = value => (Date.parse(value + 'T00:00:00Z') - start) / (end - start) * 100;
    const left = position(topic.first_date), right = position(topic.last_date), count = Math.min(5, lastYear - firstYear + 1);
    const years = [...new Set(Array.from({length: count}, (_,i) => count === 1 ? firstYear : Math.round(firstYear + (lastYear - firstYear) * i / (count - 1))))];
    const ends = topic.first_date === topic.last_date ? [topic.last] : [topic.first, topic.last];
    return `<div class="echoTimeline" aria-label="记录日期"><div class="timelineYears" style="grid-template-columns:repeat(${years.length},1fr)">${years.map(y => `<span>${y}</span>`).join('')}</div><div class="timelineSpan" style="left:${left}%;width:${right-left}%"></div>${ends.map((r,i) => `<button type="button" class="timelineDate ${i ? 'recent' : 'earlier'} ${position(r.date)<10?'nearStart':''}" style="left:${position(r.date)}%" data-attic-source="${esc(r.source_path)}" aria-label="阅读 ${r.date} 的原页"><i></i><time>${fmtDate(r.date)}</time></button>`).join('')}</div>`;
  }
  function ledgerRows(items) {
    return items.map(x => `<article class="atticLedgerRow"><span class="atticLedgerRowType">${esc(x.label)}</span><div class="atticLedgerRowText"><h3>${esc(x.title)}</h3></div><span class="atticLedgerSources">${x.pages} 页</span><time>${fmtDate(x.date)}</time><button class="atticAction" type="button" data-attic-detail="${esc(x.kind)}" data-attic-id="${x.id}">${x.kind === 'decision' ? '对照' : '查看'}</button></article>`).join('');
  }
  function ledgerHTML(items) {
    return `<div class="atticLedger"><div class="atticColumns" aria-hidden="true"><span>类别</span><span>线索</span><span>来源</span><span>最近记录</span><span></span></div><div id="atticLedgerRows">${items.length ? ledgerRows(items) : empty('还没有项目、问题或决定的记录')}</div></div>`;
  }
  function yearSelect(d, name, allowAll = false) {
    const selectedYear = state[name].year || (allowAll ? '' : d.year);
    return `<select class="atticSelect" data-attic-year aria-label="选择年份">${allowAll?'<option value="" '+(!selectedYear?'selected':'')+'>全部年份</option>':''}${[...new Set([d.year, ...d.years])].sort().reverse().map(y => `<option value="${y}" ${y === selectedYear ? 'selected' : ''}>${y}</option>`).join('')}</select>`;
  }
  function yearHTML(d, name) {
    const selected = d.months.find(m => m.month === state[name].month) || d.months[0];
    const max = Math.max(1,...d.months.map(m => m.days));
    return `<div class="yearInstrument"><div class="yearCaption">${yearSelect(d,name)}<div class="atticYearTotal">${number(d.recorded_days)}</div><p>个写作日</p><div class="monthSummary" id="atticMonthSummary">${Number(selected.month.slice(5))} 月 · ${selected.days} 个写作日<br>${selected.quotes} 条摘录</div></div><div class="yearPlot"><header><span>月度记录</span><span>写作日</span></header><div class="yearRibbon" aria-label="按月翻阅记录">${d.months.map(m => `<button type="button" class="monthColumn ${m.month === selected.month ? 'active' : ''}" data-attic-month="${m.month}" aria-pressed="${m.month === selected.month}" aria-label="${Number(m.month.slice(5))} 月 · ${m.days} 个写作日"><div class="monthSpine">${m.days ? `<i style="height:${Math.round(m.days/max*100)}px"></i>` : ''}</div><span>${m.month.slice(5)}</span></button>`).join('')}</div><div class="yearFoot"><span id="atticMonthLabel">${Number(selected.month.slice(5))} 月的原页</span><button class="atticAction" type="button" id="atticMonthOpen" ${selected.days ? '' : 'disabled'}>翻阅</button></div></div></div>`;
  }
  async function renderOverview() {
    const sequence = renderSequence;
    const name = 'Attic', d = await overview(name), topic = d.topics.find(t => t.topic === state[name].topic);
    if (sequence !== renderSequence || STATE.feature !== name) return '';
    data = d;
    if (!d.pages) return wrap(name, empty('从第一篇日记开始', `<button class="atticAction" type="button" data-attic-write>写一页</button><button class="atticAction" type="button" data-attic-import>导入日记</button>`), []);
    return wrap(name, `<section class="atticRoom" id="echo-room">${sectionHead('atticTopicTitle','01','主题对照',topic && d.topics.length>1 ? '<button class="atticAction" type="button" data-attic-next-topic>下一主题</button>' : '')}<div class="echoInstrument"><aside class="echoContext"><h3 id="echoCenterTopic">${esc(topicLabel(topic?.topic || '主题'))}</h3><p id="echoTimespan">${topic ? `${fmtDate(topic.first_date.slice(0,7))} — ${fmtDate(topic.last_date.slice(0,7))}` : ''}</p><div class="echoInterval"><strong id="echoInterval">${number(topic?.span_days)}</strong><span>天的跨度</span></div><nav class="echoTopicFilter" aria-label="对照主题">${d.topics.map(t => `<button type="button" data-attic-topic="${esc(t.topic)}" aria-pressed="${t.topic === state[name].topic}" class="${t.topic === state[name].topic ? 'active' : ''}">${esc(topicLabel(t.topic))}</button>`).join('')}</nav></aside><div class="echoPages ${topic?.first.id === topic?.last.id ? 'single' : ''}" id="echoPages">${leaves(topic)}</div></div><div id="echoTimeline">${timeline(topic)}</div><footer class="echoFoot"><button type="button" class="atticAction" data-attic-topic-records>查看主题记录</button></footer></section>
      <section class="atticRoom" id="desk-room">${sectionHead('atticLedgerTitle','02','线索',action('Attic Organize','全部线索'))}${ledgerHTML(d.ledger)}</section>
      <section class="atticRoom" id="year-room">${sectionHead('atticYearTitle','03','记录',action('Attic Observe','完整统计'))}${yearHTML(d,name)}</section>`, [['echo-room','主题'],['desk-room','线索'],['year-room','记录']]);
  }
  function recordRows(items) {
    return items.map(x => `<article class="atticRecord"><time>${fmtDate(x.date)}</time><blockquote>${esc(x.excerpt || x.text)}</blockquote>${sourceButton(x.source_path)}</article>`).join('');
  }
  const more = (result, type) => result.has_more ? `<button class="atticAction atticMore" type="button" data-attic-load="${type}">加载更多</button>` : '';
  async function restoredRows(endpoint, filters, s) {
    const sequence = renderSequence;
    const wanted = Math.max(30, s.offset || 0);
    let result = await api(endpoint + '?' + params({...filters, limit: Math.min(100, wanted)}), {noCache: true});
    while (sequence === renderSequence && result.has_more && result.items.length < wanted) {
      const next = await api(endpoint + '?' + params({...filters, offset: result.items.length, limit: Math.min(100, wanted - result.items.length)}), {noCache: true});
      result = {...next, items: [...result.items, ...next.items]};
      if (!next.items.length) break;
    }
    if (sequence === renderSequence) s.offset = result.items.length;
    return result;
  }
  async function renderReview() {
    const sequence=renderSequence, name='Attic Review', d=await overview(name);
    if(sequence!==renderSequence||STATE.feature!==name)return '';data=d;
    const result=await restoredRows('/api/attic/review', {topic:state[name].topic,year:state[name].year}, state[name]);
    const quotes=await api('/api/quotes?' + params({year:state[name].year,limit:12}), {noCache:true});
    return wrap(name, `<section class="atticRoom" id="review-records">${sectionHead('atticReviewTitle','01','主题记录',yearSelect(d,name,true))}<div class="atticFilters"><select class="atticSelect" data-attic-review-topic aria-label="选择主题"><option value="">全部主题</option>${d.topics.map(t=>`<option value="${esc(t.topic)}" ${state[name].topic===t.topic?'selected':''}>${esc(topicLabel(t.topic))}</option>`).join('')}</select><span>${number(result.total)} 页</span></div><div id="atticRecordRows">${result.items.length?recordRows(result.items):empty('这个范围还没有记录')}</div><div id="atticMoreRows">${more(result,'review')}</div></section>
      <section class="atticRoom" id="review-quotes">${sectionHead('atticQuoteTitle','02','摘录',action('Quotes','全部摘录'))}${quotes.items.length?recordRows(quotes.items.map(q=>({...q,excerpt:plainText(q.text)}))):empty('这个范围还没有摘录')}</section>
      <section class="atticRoom" id="review-year">${sectionHead('atticReviewYearTitle','03','年度回顾',action('Year in Review','打开年度回顾'))}${yearHTML(d,name)}</section>`,[['review-records','记录'],['review-quotes','摘录'],['review-year','年度']]);
  }
  async function renderOrganize() {
    const sequence=renderSequence, name='Attic Organize', d=await overview(name);
    if(sequence!==renderSequence||STATE.feature!==name)return '';data=d;
    const result=await restoredRows('/api/attic/ledger', {kind:state[name].kind,year:state[name].year}, state[name]);
    return wrap(name, `<section class="atticRoom" id="organize-records">${sectionHead('atticOrganizeTitle','01','原文线索',yearSelect(d,name,true))}<div class="atticFilters"><nav aria-label="线索类别">${[['','全部'],['project','项目'],['question','问题'],['decision','决定']].map(([kind,label])=>`<button type="button" class="${kind===state[name].kind?'active':''}" data-attic-kind="${kind}" aria-pressed="${kind===state[name].kind}">${label}</button>`).join('')}</nav><span>${number(result.total)} 条</span></div>${ledgerHTML(result.items)}<div id="atticMoreRows">${more(result,'ledger')}</div></section>
      <section class="atticRoom" id="organize-tools">${sectionHead('atticOrganizeTools','02','继续整理')}<div class="atticToolLinks">${[['Projects','项目来源'],['Project Families','项目家族'],['Question Threads','反复的问题'],['Decision Replay','决定回放'],['Thought → Artifact','想法与作品']].filter(([id])=>featureObj(id)).map(([id,label])=>action(id,label)).join('')}</div></section>`,[['organize-records','线索'],['organize-tools','工具']]);
  }
  async function renderObserve() {
    const sequence=renderSequence, name='Attic Observe', d=await overview(name);
    if(sequence!==renderSequence||STATE.feature!==name)return '';data=d;
    const skills=await api('/api/skills?' + params({period:state[name].year}), {noCache:true});
    const recorded=(skills.items||[]).filter(s=>s.evidence_days>0).slice(0,20);
    return wrap(name, `<section class="atticRoom" id="observe-records">${sectionHead('atticObserveTitle','01','写作记录')}${yearHTML(d,name)}</section>
      <section class="atticRoom" id="observe-skills">${sectionHead('atticSkillsTitle','02','技能记录',action('Skill Evidence','全部来源'))}${recorded.length?`<div class="atticSkillTable"><div class="atticSkillHead"><span>技能</span><span>记录页</span><span>最近提及</span><span></span></div>${recorded.map(s=>`<div class="atticSkillRow"><span>${esc(s.name)}</span><span>${number(s.evidence_days)}</span><time>${fmtDate(s.last_seen)}</time><button class="atticAction" type="button" data-attic-skill="${esc(s.name)}">来源</button></div>`).join('')}</div>`:empty('这个范围还没有技能记录')}</section>
      <section class="atticRoom" id="observe-tools">${sectionHead('atticObserveTools','03','深入观察')}<div class="atticToolLinks">${[['Habits','习惯记录'],['Life Rhythms','生活节律'],['Skill Evolution','技能变化'],['Month Portraits','月度画像']].filter(([id])=>featureObj(id)).map(([id,label])=>action(id,label)).join('')}</div></section>`,[['observe-records','写作'],['observe-skills','技能'],['observe-tools','观察']]);
  }
  function plainText(value) {
    const template=document.createElement('template');template.innerHTML=String(value||'');
    template.content.querySelectorAll('br').forEach(b=>b.replaceWith(document.createTextNode('\n')));
    return template.content.textContent||'';
  }
  const GROUPS = {
    回看:new Set(['Timeline','Quotes','First / Last','Year in Review','Memory Echoes','Hidden Chapters','On This Day','Timefold Atlas','Book']),
    整理:new Set(['Projects','Project Families','Ideas','Questions','Question Threads','Decisions','Decision Replay','Forks','Fork Replay','Thought → Artifact','Idea Genealogy']),
    观察:new Set(['Analytics','Habits','Life Rhythms','Skill Evidence','Skill Evolution','Skill Momentum','Skill Constellation','Month Portraits','Attention Portfolio','Word Evolution']),
  };
  function toolCatalog() {
    const excluded=new Set(['Home','Journal','Other','Daily Poetry','Pets','Pet Shelf','Time Capsule','AI Settings',...NAMES]);
    return FEATURES.filter(f=>!excluded.has(f.name)).map(f=>({...f,title:TOOL_LABELS[f.name]||dreamMeta(f.name).title,group:Object.keys(GROUPS).find(g=>GROUPS[g].has(f.name))||'深入'}));
  }
  function dialog() {
    if (!get('atticSource')) {
      const node=document.createElement('dialog');node.id='atticSource';node.className='atticArchive atticSourceDialog';
      node.setAttribute('aria-labelledby','atticSourceTitle');node.innerHTML='<header><h2 id="atticSourceTitle"></h2><button type="button" data-attic-close aria-label="关闭预览">×</button></header><article id="atticSourceBody"></article>';
      document.body.append(node);node.addEventListener('close',()=>{drawerSequence++;drawerBack=null;});
      node.addEventListener('click',e=>{if(e.target===node){const r=node.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)node.close();}});
    }
    return get('atticSource');
  }
  function openDrawer(title,html) {
    const node=dialog();get('atticSourceTitle').textContent=title;get('atticSourceBody').innerHTML=html;node.scrollTop=0;
    if(!node.open)node.showModal();
  }
  function tools() {
    drawerBack=null;drawerSequence++;
    openDrawer('工具索引',`<div class="toolShelf"><input id="atticToolSearch" type="search" aria-label="搜索工具"><div id="atticToolGroups">${['回看','整理','观察','深入'].map(g=>`<section><h3>${g}</h3><div>${toolCatalog().filter(f=>f.group===g).map(f=>`<button type="button" data-attic-route="${esc(f.name)}" data-tool-text="${esc(f.title+' '+f.name)}">${esc(f.title)}</button>`).join('')}</div></section>`).join('')}</div><p class="toolEmpty" hidden>没有找到这个工具</p></div>`);
  }
  async function rawSource(path) {
    const node=dialog();drawerBack=node.open?{title:get('atticSourceTitle').textContent,html:get('atticSourceBody').innerHTML,scroll:node.scrollTop}:null;
    const token=++drawerSequence;openDrawer('原页','<p class="atticDrawerMeta">正在打开</p>');
    try {
      const j=await api('/api/journal?path='+encodeURIComponent(path),{noCache:true});if(token!==drawerSequence||!node.open)return;
      openDrawer(j.product_entry?.title||fmtDate(j.memory.date)||'原页', `${drawerBack?'<button type="button" class="atticAction atticSourceBack" data-attic-back>返回</button>':''}${Object.entries(j.sections||{}).filter(([,t])=>t.trim()).map(([label,text])=>`<section class="atticSourceSection"><h3>${esc(label)}</h3><p>${esc(plainText(text))}</p></section>`).join('')}<button type="button" class="atticAction" data-attic-full-source="${esc(path)}">在流年中打开</button>`);
    } catch(e) {if(token===drawerSequence&&node.open)openDrawer('原页',empty('这页暂时无法打开',`<button type="button" class="atticAction" data-attic-source="${esc(path)}">重试</button>`));}
  }
  async function lineage(kind,id) {
    drawerBack=null;const token=++drawerSequence;openDrawer('线索','<p class="atticDrawerMeta">正在打开</p>');
    try {
      const d=await api('/api/attic/lineage?'+params({kind,id}),{noCache:true});if(token!==drawerSequence||!dialog().open)return;
      openDrawer(d.item.text.slice(0,60),`<div class="atticDrawerLine"><time>${fmtDate(d.item.date)}</time><p>${esc(d.item.text)}</p>${sourceButton(d.item.source_path)}</div>${d.related.length?'<h3 class="atticRelatedTitle">同主题的后续记录</h3>':''}${d.related.map(r=>`<div class="atticDrawerLine"><time>${fmtDate(r.date)}</time><p>${esc(r.excerpt)}</p>${sourceButton(r.source_path)}</div>`).join('')}`);
    } catch(e) {if(token===drawerSequence&&dialog().open)openDrawer('线索',empty(e.message));}
  }
  async function monthPages(append=false) {
    const name=STATE.feature,m=state[name].month;const token=++drawerSequence;
    if(!append){drawerBack=null;state[name].monthOffset=0;openDrawer(`${m.replace('-',' 年 ')} 月`, '<p class="atticDrawerMeta">正在打开</p>');}
    try {
      const result=await api('/api/attic/month?'+params({month:m,offset:state[name].monthOffset||0}),{noCache:true});if(token!==drawerSequence||!dialog().open)return;
      const html=result.items.map(r=>`<div class="atticDrawerLine"><time>${fmtDate(r.date)}</time><p>${esc(r.excerpt)}</p>${sourceButton(r.source_path)}</div>`).join('');
      if(append)get('atticMonthPages').insertAdjacentHTML('beforeend',html);
      else openDrawer(`${m.replace('-',' 年 ')} 月`,`<p class="atticDrawerMeta">${number(result.total)} 页</p><div id="atticMonthPages">${html||empty('这个月份没有记录')}</div><div id="atticMonthMore"></div>`);
      state[name].monthOffset=(state[name].monthOffset||0)+result.items.length;
      get('atticMonthMore').innerHTML=more(result,'month');
    }catch(e){if(token===drawerSequence&&dialog().open)openDrawer('原页',empty(e.message));}
  }
  function selectTopic(topic) {
    const t=data.topics.find(t=>t.topic===topic);if(!t)return;state.Attic.topic=topic;
    get('echoCenterTopic').textContent=topicLabel(t.topic);get('echoTimespan').textContent=`${fmtDate(t.first_date.slice(0,7))} — ${fmtDate(t.last_date.slice(0,7))}`;
    get('echoInterval').textContent=number(t.span_days);get('echoPages').innerHTML=leaves(t);get('echoPages').classList.toggle('single',t.first.id===t.last.id);get('echoTimeline').innerHTML=timeline(t);
    document.querySelectorAll('[data-attic-topic]').forEach(b=>{b.classList.toggle('active',b.dataset.atticTopic===topic);b.setAttribute('aria-pressed',String(b.dataset.atticTopic===topic));});
  }
  function selectMonth(month) {
    const m=data.months.find(m=>m.month===month);if(!m)return;state[STATE.feature].month=month;
    document.querySelectorAll('[data-attic-month]').forEach(b=>{b.classList.toggle('active',b.dataset.atticMonth===month);b.setAttribute('aria-pressed',String(b.dataset.atticMonth===month));});
    get('atticMonthSummary').innerHTML=`${Number(month.slice(5))} 月 · ${m.days} 个写作日<br>${m.quotes} 条摘录`;get('atticMonthLabel').textContent=`${Number(month.slice(5))} 月的原页`;get('atticMonthOpen').disabled=!m.days;
  }
  async function loadMore(type,button) {
    if(type==='month')return monthPages(true);
    const name=STATE.feature,s=state[name];button.disabled=true;
    try{
      const result=await api('/api/attic/'+(type==='ledger'?'ledger':'review')+'?'+params({kind:s.kind,topic:s.topic,year:s.year,offset:s.offset}),{noCache:true});
      if(STATE.feature!==name||!button.isConnected)return;
      get(type==='ledger'?'atticLedgerRows':'atticRecordRows').insertAdjacentHTML('beforeend',type==='ledger'?ledgerRows(result.items):recordRows(result.items));
      s.offset+=result.items.length;get('atticMoreRows').innerHTML=more(result,type);
    }catch(e){toast(e.message);button.disabled=false;}
  }
  function syncIndex() {
    if(!NAMES.has(STATE.feature))return;const root=document.querySelector('.atticLab'),header=root?.querySelector('.atticHeader');if(!header)return;
    const shell=scroller(),bounds=shell.getBoundingClientRect(),edge=header.getBoundingClientRect();
    header.style.setProperty('--attic-left-edge',Math.max(0,edge.left-bounds.left)+'px');
    header.style.setProperty('--attic-right-edge',Math.max(0,bounds.left+shell.clientWidth-edge.right)+'px');
    header.classList.toggle('stuck',root.getBoundingClientRect().top<=bounds.top+.5);
    let selected=root.querySelector('.atticRoom');for(const section of root.querySelectorAll('.atticRoom'))if(section.getBoundingClientRect().top<=header.getBoundingClientRect().bottom+45)selected=section;
    root.querySelectorAll('[data-attic-jump]').forEach(b=>b.classList.toggle('active',b.dataset.atticJump===selected?.id));
  }
  function rail() {
    const old=document.querySelector('#rooms [data-nav-id="attic"]');if(!old)return;
    const container=document.createElement('div');container.className='atticNavGroup';
    container.innerHTML=`<button type="button" class="roomBtn atticNavToggle" data-nav-id="attic-group" aria-expanded="${groupOpen}">${uiIcon('attic')}<span class="navText">${esc(groupTitle())}</span><span class="atticNavChevron" aria-hidden="true">${groupOpen?'⌄':'›'}</span></button><div class="atticNavPages" ${groupOpen?'':'hidden'}>${PAGES.map(([name,,icon])=>`<button type="button" class="roomBtn ${STATE.feature===name&&!document.body.classList.contains('writerImmersive')?'active':''}" data-attic-route="${name}" aria-current="${STATE.feature===name?'page':'false'}">${uiIcon(icon)}<span class="navText">${esc(pageTitle(name))}</span></button>`).join('')}</div>`;
    old.replaceWith(container);container.querySelector('.atticNavToggle').onclick=()=>{groupOpen=!groupOpen;buildRail();};
    if(get('atticOpen'))get('atticOpen').textContent=groupTitle();
    if(get('mobileAttic'))get('mobileAttic').textContent=groupTitle();
    if(get('mobileMorePanel')){let mobile=get('atticMobilePages');if(!mobile){mobile=document.createElement('div');mobile.id='atticMobilePages';get('mobileMorePanel').append(mobile);}mobile.innerHTML=PAGES.map(([name])=>`<button type="button" data-attic-route="${name}">${esc(pageTitle(name))}</button>`).join('');}
  }
  function install() {
    if(!window.lifeosV01Ready)return;
    if(!buildRail.__attic){const prior=buildRail;buildRail=function(...args){const result=prior.apply(this,args);rail();return result;};buildRail.__attic=true;}
    if(!openFeature.__attic){const prior=openFeature;openFeature=function(name){return prior(name==='Other'?'Attic':name);};openFeature.__attic=true;}
    if(!hydrateFromLocation.__attic){const prior=hydrateFromLocation;hydrateFromLocation=function(...args){const result=prior.apply(this,args);if(result&&STATE.feature==='Other'){STATE.feature='Attic';STATE.room='ATTIC';}return result;};hydrateFromLocation.__attic=true;}
    if(!render.__attic){const prior=render;render=async function(...args){
      const previous=document.querySelector('.atticLab')?.dataset.atticPage;if(previous&&state[previous])state[previous].scroll=scroller().scrollTop;
      if(resetScroll&&state[STATE.feature])state[STATE.feature].scroll=0;resetScroll=false;
      const target=STATE.feature,seq=++renderSequence;dialog().close();document.body.classList.toggle('atticMode',NAMES.has(target));
      const result=await prior.apply(this,args);if(seq!==renderSequence||target!==STATE.feature)return result;
      activePage=NAMES.has(target)?target:null;
      if(activePage&&document.querySelector('.atticLab')){scroller().scrollTop=state[target].scroll;syncIndex();}
      return result;
    };render.__attic=true;}
    for(const [name,fn] of [['Attic',renderOverview],['Attic Review',renderReview],['Attic Organize',renderOrganize],['Attic Observe',renderObserve]]){
      RENDERERS[name]=async()=>{try{return await fn();}catch(e){return wrap(name,empty('暂时无法读取阁楼',`<button type="button" class="atticAction" data-attic-retry>重试</button>`),[]);}};
    }
    scroller()?.addEventListener('scroll',syncIndex,{passive:true});buildRail();
    window.addEventListener('resize',syncIndex,{passive:true});
    if(typeof ResizeObserver==='function')new ResizeObserver(syncIndex).observe(scroller());
    if(NAMES.has(decodeURIComponent(location.hash.slice(1).split('?')[0]))||STATE.feature==='Other'){hydrateFromLocation();render();}
  }
  document.addEventListener('click',event=>{
    const b=event.target.closest('button');if(!b)return;
    if(b.dataset.atticRoute){if(b.dataset.atticRoute==='Year in Review')STATE.yearReview=data?.year||state[STATE.feature]?.year;if(b.closest('.atticLab')&&b.dataset.atticRoute==='Attic Observe'){state['Attic Observe'].year=data.year;state['Attic Observe'].month=state[STATE.feature].month;}dialog().close();closeMobileMore();openFeature(b.dataset.atticRoute);}
    if(b.hasAttribute('data-attic-tools'))tools();
    if(b.dataset.atticSource)rawSource(b.dataset.atticSource);
    if(b.dataset.atticFullSource){dialog().close();openJournal(b.dataset.atticFullSource);}
    if(b.hasAttribute('data-attic-close'))dialog().close();
    if(b.hasAttribute('data-attic-back')&&drawerBack){const back=drawerBack;drawerBack=null;drawerSequence++;openDrawer(back.title,back.html);dialog().scrollTop=back.scroll;}
    if(b.dataset.atticDetail)lineage(b.dataset.atticDetail,b.dataset.atticId);
    if(b.dataset.atticTopic)selectTopic(b.dataset.atticTopic);
    if(b.hasAttribute('data-attic-next-topic'))selectTopic(data.topics[(data.topics.findIndex(t=>t.topic===state.Attic.topic)+1)%data.topics.length].topic);
    if(b.hasAttribute('data-attic-topic-records')){state['Attic Review'].topic=state.Attic.topic;state['Attic Review'].year='';state['Attic Review'].scroll=0;state['Attic Review'].offset=0;openFeature('Attic Review');}
    if(b.dataset.atticMonth)selectMonth(b.dataset.atticMonth);
    if(b.id==='atticMonthOpen')monthPages();
    if(b.hasAttribute('data-attic-kind')){state[STATE.feature].kind=b.dataset.atticKind;state[STATE.feature].offset=0;resetScroll=true;render();}
    if(b.dataset.atticLoad)loadMore(b.dataset.atticLoad,b);
    if(b.hasAttribute('data-attic-retry'))render();
    if(b.hasAttribute('data-attic-write'))openProductDock('writer',{date:localDateISO()});
    if(b.hasAttribute('data-attic-import'))openProductDock('import');
    if(b.dataset.atticSkill){STATE.skill=b.dataset.atticSkill;openFeature('Skill Evidence');}
    if(b.dataset.atticJump){const section=get(b.dataset.atticJump),root=scroller(),head=document.querySelector('.atticHeader');root.scrollTo({top:Math.max(0,section.getBoundingClientRect().top-root.getBoundingClientRect().top+root.scrollTop-head.offsetHeight-20),behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'instant':'smooth'});}
  });
  document.addEventListener('change',e=>{
    if(e.target.hasAttribute('data-attic-year')){state[STATE.feature].year=e.target.value;state[STATE.feature].month='';state[STATE.feature].offset=0;render();}
    if(e.target.hasAttribute('data-attic-review-topic')){state[STATE.feature].topic=e.target.value;state[STATE.feature].offset=0;resetScroll=true;render();}
  });
  document.addEventListener('input',e=>{if(e.target.id!=='atticToolSearch')return;const q=e.target.value.trim().toLowerCase();
    get('atticToolGroups').querySelectorAll('[data-tool-text]').forEach(b=>b.hidden=!b.dataset.toolText.toLowerCase().includes(q));
    get('atticToolGroups').querySelectorAll('section').forEach(s=>s.hidden=![...s.querySelectorAll('button')].some(b=>!b.hidden));
    get('atticSource').querySelector('.toolEmpty').hidden=[...get('atticToolGroups').querySelectorAll('button')].some(b=>!b.hidden);
  });
  window.addEventListener('lifeos:i2-ready',install,{once:true});
  if(window.lifeosV01Ready)install();
})();
