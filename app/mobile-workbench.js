/* Touch navigation for the full native engine. Business actions keep their
   existing handlers, storage, revisions and source links. */
(() => {
  'use strict';
  if(!window.lifeosMobile)return;
  const mobile=matchMedia('(max-width:880px)'),get=id=>document.getElementById(id);
  const make=(tag,cls,text='')=>{const n=document.createElement(tag);n.className=cls;n.textContent=text;return n;};
  const label=name=>window.lifeosNavLabel?.(name)||dreamMeta(name)?.title||name;
  const dock=[['writer','落笔','日记、周记与自由分格'],['import','导入档案','文件预览、冲突处理与附件'],['export','导出原文','Markdown、JSON 与附件'],['versions','版本历史','找回修改前的原文'],['backup','备份与恢复','完整档案与恢复验证'],['privacy','隐私与授权','本机资料与 AI 发送范围'],['sync','同步与交换','查看同步配置和执行状态'],['inbox','资料收件箱','导入资料的后续整理'],['platform','设备与运行','当前平台和引擎状态'],['memorial','纪念空间','独立管理纪念内容']];
  const sheet=make('dialog','mobileLibrary');sheet.id='mobileLibrary';sheet.setAttribute('aria-labelledby','mobileLibraryTitle');
  const head=make('header','mobileLibraryHead'),close=make('button','mobileLibraryClose','←');close.type='button';close.setAttribute('aria-label','返回原页面');const title=make('div','');title.append(make('small','','YOUR LIFE, ALL IN REACH.'));const h=make('h2','','阁间');h.id='mobileLibraryTitle';title.append(h);head.append(close,title);sheet.append(head);
  const intro=make('p','mobileLibraryIntro','所有内容仍由完整本机引擎处理。按用途寻找，也可以直接搜索。');
  const search=make('input','mobileLibrarySearch');search.type='search';search.placeholder='搜索功能、用途或名称';search.setAttribute('aria-label','搜索全部功能');
  const tabs=make('div','mobileLibraryTabs');tabs.setAttribute('aria-label','功能分类');
  const result=make('div','mobileLibraryResults');const count=make('p','mobileLibraryCount');count.setAttribute('role','status');sheet.append(intro,search,tabs,count,result);document.body.append(sheet);
  const nav=make('nav','mobileWorkbenchNav');nav.setAttribute('aria-label','手机主导航');
  const entries=[['Home','今天','today'],['Journal','流年','journal'],['writer','落笔','write'],['Pet Shelf','灵犀','cat'],['library','阁间','attic']];
  const buttons=new Map();for(const [name,text,icon]of entries){const b=make('button',name==='writer'?'mobileWrite':'');b.type='button';b.dataset.mobileDestination=name;b.innerHTML=uiIcon(icon);b.append(make('span','',text));nav.append(b);buttons.set(name,b);b.onclick=()=>go(name);}
  document.body.append(nav);let category='常用',lastFocus=null;
  const common=['Home','Journal','Universal Search','Daily Poetry','On This Day','Time Capsule','Pet Shelf','Attic','Attic Review','Attic Organize','Attic Observe','Ask My Life'];
  const rooms={NOW:'日常',MEMORY:'原文与检索',ASK:'问答',BOOK:'人生之书',PEOPLE:'人物与地点',IDEAS:'想法',GROWTH:'成长',TIME:'时光',ARCHIVE:'档案',CURIOSITY:'发现',OBSERVATORY:'观察',TIMEFOLD:'时间线索',MIRROR:'自我回顾',COMPASS:'方向',TOPOLOGY:'记忆网络',FOOTPRINT:'足迹',LINEAGE:'作品脉络',ATTIC:'阁楼'};
  function row(name,note,action){const b=make('button','mobileLibraryRow');b.type='button';const copy=make('span','');copy.append(make('strong','',name),make('small','',note));b.append(copy,make('span','mobileLibraryArrow','↗'));b.onclick=()=>{sheet.close();void action();};return b;}
  function draw(){
    const term=search.value.trim().toLocaleLowerCase();result.replaceChildren();
    const groups=category==='数据与设置'?[]:FEATURES.filter(f=>(term||category==='全部'||(category==='常用'?common.includes(f.name):f.room===category))&&(!term||`${label(f.name)} ${f.name} ${f.desc} ${f.room}`.toLocaleLowerCase().includes(term)));
    if(category==='常用'&&!term)result.append(row('灵犀与自然声','伙伴动作、聊天与声音陪伴',()=>window.dispatchEvent(new CustomEvent('lifeos:open-pet'))));
    if(category==='数据与设置'||term){for(const [id,name,note]of dock)if(!term||`${name} ${note}`.includes(term))result.append(row(name,note,()=>openProductDock(id)));}
    if(category==='数据与设置'&&!term){result.append(row('字体与外观','字号、主题、动效与书桌设置',()=>setPanelOpen(get('tweaksPanel'),get('allRail'),true)),row('AI 模型与密钥','连接、权限与可用状态',()=>openFeature('AI Settings')));}
    let group='';for(const f of groups){if(f.room!==group){group=f.room;result.append(make('h3','mobileLibraryGroup',rooms[group]||group));}result.append(row(label(f.name),`${f.name}${f.desc?' · '+f.desc:''}`,()=>openFeature(f.name)));}
    const total=result.querySelectorAll('button').length;count.textContent=`${total} 个入口 · ${FEATURES.length} 项功能可查`;
    if(!total)result.append(make('p','mobileLibraryEmpty','没有找到。试试「备份」「日记」或原来的英文名称。'));
    for(const b of tabs.querySelectorAll('button'))b.setAttribute('aria-pressed',String(b.dataset.category===category));
  }
  const categories=['常用','数据与设置','全部',...new Set(FEATURES.map(f=>f.room))];
  for(const name of categories){const b=make('button','',rooms[name]||name);b.type='button';b.dataset.category=name;b.onclick=()=>{category=name;draw();};tabs.append(b);}
  search.oninput=draw;close.onclick=()=>sheet.close();sheet.addEventListener('close',()=>{lastFocus?.focus?.();update();});
  sheet.addEventListener('click',event=>{if(event.target===sheet){const r=sheet.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)sheet.close();}});
  function open(categoryName='常用'){if(document.body.classList.contains('writerImmersive'))return;closeMobileMore();category=categoryName;search.value='';lastFocus=document.activeElement;draw();sheet.showModal();search.focus();update();}
  async function go(name){if(name==='library')return open();if(name==='writer')return openProductDock('writer',{date:localDateISO()});if(name==='Pet Shelf')return window.dispatchEvent(new CustomEvent('lifeos:open-pet'));return openFeature(name);}
  function update(){document.body.classList.toggle('mobileWorkbench',mobile.matches);for(const [name,b]of buttons){const active=name==='library'?sheet.open:name==='writer'?document.body.classList.contains('writerImmersive'):name===STATE.feature;b.setAttribute('aria-current',active?'page':'false');}}
  const observer=new MutationObserver(()=>{for(const [name,b]of buttons)b.setAttribute('aria-current',(name==='library'?sheet.open:name==='writer'?document.body.classList.contains('writerImmersive'):name===STATE.feature)?'page':'false');});
  observer.observe(get('view'),{childList:true});observer.observe(document.body,{attributes:true,attributeFilter:['class']});
  mobile.addEventListener('change',update);window.addEventListener('lifeos:language-change',draw);update();
  window.lifeosMobile.openLibrary=open;
})();
