(() => {
  'use strict';
  const model=window.lifeosSidebarModel, KEY='lifeos.nav.layout', GROUP='lifeos.nav.atticOpen';
  const loaded=model.read(localStorage,KEY);
  let saved=loaded.value, draft=null, editing=false, groupOpen=true, dragId=null, installed=false;
  let pointer=null, ghost=null, dropTarget=null, suppressClick=false;
  try { groupOpen=localStorage.getItem(GROUP)!=='false'; } catch {}
  const get=id=>document.getElementById(id), text=()=>window.lifeosNavLanguage?.()==='en';
  const copy=(zh,en)=>text()?en:zh;
  function catalog() {
    return [...(window.lifeosNavItems?.()||[]).filter(item=>item.id!=='attic'),
      {id:'overview',icon:'overview',label:copy('概览','Overview'),feature:'Attic'},
      {id:'review',icon:'memory',label:copy('回看','Revisit'),feature:'Attic Review'},
      {id:'organize',icon:'grow',label:copy('整理','Organize'),feature:'Attic Organize'},
      {id:'observe',icon:'discover',label:copy('观察','Observe'),feature:'Attic Observe'}];
  }
  const current=item=>item.action==='write'?document.body.classList.contains('writerImmersive'):item.feature===STATE.feature&&!document.body.classList.contains('writerImmersive');
  function button(item,slot=false) {
    const active=current(item), attributes=editing?`draggable="true" aria-describedby="sidebarEditHint"`:'';
    return `<button type="button" class="roomBtn ${active?'active':''} ${slot?'sidebarMobileSlot':''}" data-nav-id="${esc(item.id)}" data-sidebar-item="${esc(item.id)}" ${attributes} aria-current="${active?'page':'false'}">${uiIcon(item.icon)}<span class="navText">${esc(item.label)}</span>${editing?'<span class="sidebarGrip" aria-hidden="true">⠿</span>':''}</button>`;
  }
  function notify(message,error=false) {
    const node=get('sidebarEditStatus');if(node){node.textContent=message;node.classList.toggle('is-error',error);}
  }
  function draw(focusId) {
    const rooms=get('rooms');if(!rooms||!window.lifeosNavItems)return;
    if(pointer||dragId)return;
    const registry=new Map(catalog().map(item=>[item.id,item])), layout=editing?draft:saved;
    const scroll=rooms.scrollTop, oldFocus=document.activeElement?.dataset.sidebarItem;
    const atticActive=layout.attic.some(id=>current(registry.get(id)));
    rooms.classList.add('sidebarRooms');rooms.setAttribute('aria-label',copy('功能导航','Navigation'));
    rooms.innerHTML=`${editing?`<p class="sidebarEditHint" id="sidebarEditHint">${copy('拖动排序，拖进阁楼收起','Drag to reorder or tuck into Attic')}</p>`:''}<div class="sidebarMain sidebarList" data-sidebar-zone="main">${layout.main.map((id,i)=>button(registry.get(id),i<4)).join('')}${editing&&!layout.main.length?`<span class="sidebarDropEmpty">${copy('拖到这里，放回侧栏','Drag here to restore')}</span>`:''}</div><div class="atticNavGroup"><button type="button" class="roomBtn atticNavToggle ${!groupOpen&&atticActive?'has-active':''}" data-nav-id="attic-group" id="sidebarAtticToggle" aria-expanded="${editing||groupOpen}" aria-controls="sidebarAtticList">${uiIcon('attic')}<span class="navText">${copy('阁楼','Attic')}</span><span class="atticNavChevron" aria-hidden="true">${editing||groupOpen?'⌄':'›'}</span></button><div id="sidebarAtticList" class="atticNavPages sidebarList" data-sidebar-zone="attic" ${editing||groupOpen?'':'hidden'}>${layout.attic.map(id=>button(registry.get(id))).join('')}${editing&&!layout.attic.length?`<span class="sidebarDropEmpty">${copy('拖到这里，收进阁楼','Drag here to tuck away')}</span>`:''}</div></div><button class="roomBtn mobileMoreButton" id="mobileMoreBtn" type="button" aria-haspopup="dialog" aria-controls="mobileMorePanel" aria-expanded="false">${uiIcon('more')}<span class="navText">${copy('更多','More')}</span></button>`;
    rooms.querySelectorAll('[data-sidebar-item]').forEach(node=>{
      node.onclick=event=>{if(suppressClick){event.preventDefault();return;}if(!editing)void navigate(registry.get(node.dataset.sidebarItem));};
      if(editing){node.addEventListener('dragstart',startDrag);node.addEventListener('dragend',endDrag);node.addEventListener('keydown',keyMove);node.addEventListener('pointerdown',startPointer);}
    });
    if(editing)rooms.querySelectorAll('[data-sidebar-zone],.atticNavGroup').forEach(node=>{
      node.addEventListener('dragover',overDrag);node.addEventListener('drop',dropDrag);
    });
    get('sidebarAtticToggle').onclick=()=>{
      if(editing)return;const next=!groupOpen;
      try{localStorage.setItem(GROUP,String(next));groupOpen=next;draw();get('sidebarAtticToggle')?.focus();}
      catch{toast(copy('未能保存，请重试','Could not save. Try again'));}
    };
    get('mobileMoreBtn').onclick=()=>toggleMobileMore();
    let footer=get('sidebarEditBar');if(!footer){footer=document.createElement('div');footer.id='sidebarEditBar';footer.className='sidebarEditBar';document.querySelector('.railActions')?.before(footer);}
    footer.innerHTML=editing?`<div id="sidebarEditStatus" class="sidebarEditStatus" role="status" aria-live="polite"></div><div class="sidebarEditActions"><button type="button" id="sidebarReset">${copy('恢复默认','Reset')}</button><button type="button" id="sidebarCancel">${copy('取消','Cancel')}</button><button type="button" id="sidebarDone">${copy('完成','Done')}</button></div>`:`<button type="button" id="sidebarEdit" aria-label="${copy('编辑侧栏','Edit sidebar')}" aria-pressed="false">${uiIcon('write')}<span>${copy('编辑侧栏','Edit sidebar')}</span></button>`;
    if(editing){
      get('sidebarCancel').onclick=cancel;get('sidebarDone').onclick=complete;
      get('sidebarReset').onclick=()=>{draft=model.defaults();draw();notify(copy('已恢复默认，点击完成保存','Defaults restored. Done to save'));};
      if(loaded.error)notify(copy('偏好暂不可读，保存后将使用当前排列','Preferences unavailable. Save this layout'),true);
    }else get('sidebarEdit').onclick=start;
    drawMobile(registry,layout);
    rooms.scrollTop=scroll;
    if(focusId||oldFocus)rooms.querySelector(`[data-sidebar-item="${CSS.escape(focusId||oldFocus)}"]`)?.focus({preventScroll:true});
  }
  function drawMobile(registry,layout) {
    const panel=get('mobileMorePanel');if(!panel)return;
    for(const node of [...panel.children])if(!node.classList.contains('sidebarMobileMenu'))node.style.display='none';
    panel.querySelector('.sidebarMobileMenu')?.remove();const menu=document.createElement('div');menu.className='sidebarMobileMenu';
    const rows=ids=>ids.map(id=>`<button type="button" data-mobile-sidebar="${esc(id)}">${uiIcon(registry.get(id).icon)}<span>${esc(registry.get(id).label)}</span></button>`).join('');
    menu.innerHTML=`<div class="sidebarMobileList">${rows(layout.main)}</div><details ${groupOpen?'open':''}><summary>${copy('阁楼','Attic')}</summary><div class="sidebarMobileList">${rows(layout.attic)}</div></details><div class="sidebarMobileTools"><button type="button" data-mobile-edit>${copy('编辑侧栏','Edit sidebar')}</button><button type="button" data-mobile-settings>${copy('设置','Settings')}</button></div>`;
    panel.prepend(menu);menu.querySelectorAll('[data-mobile-sidebar]').forEach(node=>node.onclick=()=>navigate(registry.get(node.dataset.mobileSidebar)));
    menu.querySelector('[data-mobile-edit]').onclick=start;
    menu.querySelector('[data-mobile-settings]').onclick=()=>{closeMobileMore();openFeature('AI Settings');};
  }
  async function navigate(item) {
    closeMobileMore();if(item.action==='write')return openProductDock('writer',{date:localDateISO()});
    if(item.pet){window.dispatchEvent(new CustomEvent('lifeos:open-pet'));return;}
    return openFeature(item.feature);
  }
  function start() {
    if(editing||document.body.classList.contains('writerImmersive'))return;
    closeMobileMore();document.querySelector('#lifeSidebarToggle[aria-expanded="false"]')?.click();
    draft=model.normalize(saved);editing=true;document.body.classList.add('sidebarEditing');draw();get('sidebarDone')?.focus();
  }
  function finish() {
    clearDrag();editing=false;draft=null;document.body.classList.remove('sidebarEditing');draw();get('sidebarEdit')?.focus();
  }
  function complete() {
    try{const value=model.normalize(draft);localStorage.setItem(KEY,JSON.stringify(value));saved=value;loaded.error=false;finish();}
    catch{notify(copy('未能保存，请重试','Could not save. Try again'),true);}
  }
  function cancel(){finish();}
  function keyMove(event) {
    if(!editing||!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key))return;
    event.preventDefault();event.stopPropagation();const id=event.currentTarget.dataset.sidebarItem;
    draft=model.keyboard(draft,id,event.key);draw(id);
    const registry=new Map(catalog().map(item=>[item.id,item]));notify(`${registry.get(id).label} · ${draft.main.includes(id)?copy('侧栏','Sidebar'):copy('阁楼','Attic')}`);
  }
  function targetAt(x,y) {
    const node=document.elementFromPoint(x,y), group=node?.closest('.atticNavGroup');
    const zone=node?.closest('[data-sidebar-zone]')?.dataset.sidebarZone||(group?'attic':null);
    if(!zone)return null;
    const list=get('rooms').querySelector(`[data-sidebar-zone="${zone}"]`);
    const candidates=[...list.querySelectorAll('[data-sidebar-item]')].filter(item=>item.dataset.sidebarItem!==dragId);
    const before=candidates.find(item=>{const box=item.getBoundingClientRect();return y<box.top+box.height/2;});
    return {zone,before:before?.dataset.sidebarItem||null,list};
  }
  function marker(target) {
    document.querySelectorAll('.sidebarDropBefore,.sidebarDropEnd,.sidebarDropZone').forEach(node=>node.classList.remove('sidebarDropBefore','sidebarDropEnd','sidebarDropZone'));
    dropTarget=target;if(!target)return;
    if(target.before)target.list.querySelector(`[data-sidebar-item="${target.before}"]`)?.classList.add('sidebarDropBefore');
    else target.list.classList.add('sidebarDropEnd');
    if(target.zone==='attic')target.list.closest('.atticNavGroup')?.classList.add('sidebarDropZone');
  }
  function scrollEdge(y) {
    const rooms=get('rooms'),box=rooms.getBoundingClientRect();
    if(y<box.top+36)rooms.scrollTop-=14;else if(y>box.bottom-36)rooms.scrollTop+=14;
  }
  function startDrag(event) {
    if(!editing)return;dragId=event.currentTarget.dataset.sidebarItem;
    event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('application/x-lifeos-nav',dragId);event.currentTarget.classList.add('sidebarDragging');
  }
  function overDrag(event) {
    if(!dragId)return;const target=targetAt(event.clientX,event.clientY);if(!target)return;
    event.preventDefault();event.dataTransfer.dropEffect='move';marker(target);scrollEdge(event.clientY);
  }
  function dropDrag(event) {
    if(!dragId)return;event.preventDefault();const target=targetAt(event.clientX,event.clientY)||dropTarget,id=dragId;
    if(target)draft=model.move(draft,id,target.zone,target.before);clearDrag();draw(id);
  }
  function clearDrag() {
    dragId=null;marker(null);ghost?.remove();ghost=null;pointer=null;
    document.querySelectorAll('.sidebarDragging').forEach(node=>node.classList.remove('sidebarDragging'));
  }
  function endDrag(){clearDrag();draw();}
  function startPointer(event) {
    if(event.pointerType==='mouse'||event.button!==0)return;
    pointer={id:event.pointerId,item:event.currentTarget.dataset.sidebarItem,x:event.clientX,y:event.clientY,node:event.currentTarget};
  }
  document.addEventListener('pointermove',event=>{
    if(!pointer||event.pointerId!==pointer.id)return;
    if(!dragId&&Math.hypot(event.clientX-pointer.x,event.clientY-pointer.y)<7)return;
    event.preventDefault();if(!dragId){dragId=pointer.item;ghost=pointer.node.cloneNode(true);ghost.className='sidebarDragGhost';ghost.removeAttribute('id');ghost.setAttribute('aria-hidden','true');document.body.append(ghost);pointer.node.classList.add('sidebarDragging');}
    ghost.style.left=(event.clientX-95)+'px';ghost.style.top=(event.clientY-20)+'px';marker(targetAt(event.clientX,event.clientY));scrollEdge(event.clientY);
  },{passive:false});
  document.addEventListener('pointerup',event=>{
    if(!pointer||event.pointerId!==pointer.id)return;const id=dragId,target=dropTarget;
    if(id&&target)draft=model.move(draft,id,target.zone,target.before);
    if(id){suppressClick=true;setTimeout(()=>suppressClick=false,0);}clearDrag();if(id)draw(id);
  });
  document.addEventListener('pointercancel',()=>{if(pointer){clearDrag();draw();}});
  document.addEventListener('keydown',event=>{if(editing&&event.key==='Escape'&&!document.querySelector('dialog[open]')){event.preventDefault();cancel();}});
  // Changes remain a draft until Done; close/save protection elsewhere remains in charge of diary text.
  function install() {
    if(installed||!window.lifeosV01Ready)return;installed=true;
    const previous=buildRail;buildRail=function(...args){const result=previous.apply(this,args);draw();return result;};
    buildRail();window.dispatchEvent(new Event('lifeos:sidebar-ready'));
  }
  window.lifeosSidebar={edit:start,draw,layout:()=>model.normalize(editing?draft:saved),isEditing:()=>editing};
  if(window.lifeosV01Ready)install();else window.addEventListener('lifeos:v01-ready',install,{once:true});
})();
