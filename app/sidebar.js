(() => {
  'use strict';
  const model=window.lifeosSidebarModel, KEY='lifeos.nav.layout', GROUP='lifeos.nav.atticOpen';
  const loaded=model.read(localStorage,KEY);
  let saved=loaded.value, draft=null, editing=false, groupOpen=true, dragId=null, installed=false;
  let pointer=null, ghost=null, dropTarget=null, suppressClick=false, scrollFrame=0;
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
    const active=current(item), attributes=editing?`draggable="false" aria-describedby="sidebarEditHint"`:'';
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
      if(editing){node.addEventListener('keydown',keyMove);node.addEventListener('pointerdown',startPointer);}
    });
    get('sidebarAtticToggle').onclick=()=>{
      if(editing)return;const next=!groupOpen;
      try{localStorage.setItem(GROUP,String(next));groupOpen=next;draw();get('sidebarAtticToggle')?.focus();}
      catch{toast(copy('未能保存，请重试','Could not save. Try again'));}
    };
    get('mobileMoreBtn').onclick=()=>toggleMobileMore();
    let footer=get('sidebarEditBar');if(!footer){footer=document.createElement('div');footer.id='sidebarEditBar';footer.className='sidebarEditBar';document.querySelector('.railActions')?.before(footer);}
    footer.hidden=!editing;
    footer.innerHTML=editing?`<div id="sidebarEditStatus" class="sidebarEditStatus" role="status" aria-live="polite"></div><div class="sidebarEditActions"><button type="button" id="sidebarReset">${copy('恢复默认','Reset')}</button><button type="button" id="sidebarCancel">${copy('取消','Cancel')}</button><button type="button" id="sidebarDone">${copy('完成','Done')}</button></div>`:'';
    if(editing){
      get('sidebarCancel').onclick=cancel;get('sidebarDone').onclick=complete;
      get('sidebarReset').onclick=()=>{draft=model.defaults();draw();notify(copy('已恢复默认，点击完成保存','Defaults restored. Done to save'));};
      if(loaded.error)notify(copy('偏好暂不可读，保存后将使用当前排列','Preferences unavailable. Save this layout'),true);
    }
    const editButton=get('sidebarEdit');if(editButton){editButton.textContent=copy('编辑侧栏','Edit sidebar');editButton.onclick=start;}
    const editLabel=get('sidebarTweakLabel');if(editLabel)editLabel.textContent=copy('侧栏','Sidebar');
    drawMobile(registry,layout);
    rooms.scrollTop=scroll;
    if(focusId||oldFocus)rooms.querySelector(`[data-sidebar-item="${CSS.escape(focusId||oldFocus)}"]`)?.focus({preventScroll:true});
  }
  function drawMobile(registry,layout) {
    const panel=get('mobileMorePanel');if(!panel)return;
    for(const node of [...panel.children])if(!node.classList.contains('sidebarMobileMenu'))node.style.display='none';
    panel.querySelector('.sidebarMobileMenu')?.remove();const menu=document.createElement('div');menu.className='sidebarMobileMenu';
    const rows=ids=>ids.map(id=>`<button type="button" data-mobile-sidebar="${esc(id)}">${uiIcon(registry.get(id).icon)}<span>${esc(registry.get(id).label)}</span></button>`).join('');
    menu.innerHTML=`<div class="sidebarMobileList">${rows(layout.main)}</div><details ${groupOpen?'open':''}><summary>${copy('阁楼','Attic')}</summary><div class="sidebarMobileList">${rows(layout.attic)}</div></details><div class="sidebarMobileTools"><button type="button" data-mobile-tweaks>${copy('界面微调','Appearance')}</button><button type="button" data-mobile-settings>${copy('设置','Settings')}</button></div>`;
    panel.prepend(menu);menu.querySelectorAll('[data-mobile-sidebar]').forEach(node=>node.onclick=()=>navigate(registry.get(node.dataset.mobileSidebar)));
    menu.querySelector('[data-mobile-tweaks]').onclick=()=>{closeMobileMore();setPanelOpen(get('tweaksPanel'),get('allRail'),true);get('sidebarEdit')?.focus();};
    menu.querySelector('[data-mobile-settings]').onclick=()=>{closeMobileMore();openFeature('AI Settings');};
  }
  async function navigate(item) {
    closeMobileMore();if(item.action==='write')return openProductDock('writer',{date:localDateISO()});
    if(item.pet){window.dispatchEvent(new CustomEvent('lifeos:open-pet'));return;}
    return openFeature(item.feature);
  }
  function start() {
    if(editing||document.body.classList.contains('writerImmersive'))return;
    closeMobileMore();setPanelOpen(get('tweaksPanel'),get('allRail'),false);window.dispatchEvent(new CustomEvent('lifeos:sidebar-edit',{detail:{editing:true}}));
    draft=model.normalize(saved);editing=true;document.body.classList.add('sidebarEditing');draw();get('sidebarDone')?.focus();
  }
  function finish() {
    clearDrag();editing=false;draft=null;document.body.classList.remove('sidebarEditing');window.dispatchEvent(new CustomEvent('lifeos:sidebar-edit',{detail:{editing:false}}));draw();
    const trigger=get('allRail');(trigger?.getClientRects().length?trigger:get('mobileMoreBtn'))?.focus();
  }
  function complete() {
    try{const value=model.normalize(draft);localStorage.setItem(KEY,JSON.stringify(value));saved=value;loaded.error=false;finish();}
    catch{notify(copy('未能保存，请重试','Could not save. Try again'),true);}
  }
  function cancel(){finish();}
  function keyMove(event) {
    if(!editing||!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key))return;
    event.preventDefault();event.stopPropagation();const id=event.currentTarget.dataset.sidebarItem;
    draft=model.keyboard(draft,id,event.key);draw(id);get('rooms').querySelector(`[data-sidebar-item="${id}"]`)?.scrollIntoView({block:'nearest'});
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
  const animated=()=>document.documentElement.dataset.motion!=='off'&&!matchMedia('(prefers-reduced-motion: reduce)').matches;
  function preview(target) {
    marker(target);if(!target||!pointer)return;
    const node=pointer.node,before=target.before?target.list.querySelector(`[data-sidebar-item="${target.before}"]`):null;
    if(node.parentNode===target.list&&node.nextElementSibling===before)return;
    const rows=[...get('rooms').querySelectorAll('[data-sidebar-item]')].filter(item=>item!==node);
    const positions=new Map(rows.map(item=>[item,item.getBoundingClientRect()]));
    target.list.insertBefore(node,before);
    // Capture stays with the lifted item when its placeholder changes groups.
    try{node.setPointerCapture(pointer.id);}catch{}
    get('rooms').querySelectorAll('.sidebarDropEmpty').forEach(empty=>{empty.hidden=!!empty.parentNode.querySelector('[data-sidebar-item]');});
    if(animated())for(const item of rows){
      const previous=positions.get(item);item.getAnimations().forEach(animation=>animation.cancel());const box=item.getBoundingClientRect();
      const x=previous.left-box.left,y=previous.top-box.top;
      if(x||y)item.animate([{transform:`translate(${x}px,${y}px)`},{transform:'translate(0,0)'}],{duration:180,easing:'cubic-bezier(.2,.8,.2,1)'});
    }
  }
  function autoScroll() {
    if(scrollFrame)return;
    const tick=()=>{
      scrollFrame=0;if(!pointer||!dragId)return;
      const rooms=get('rooms'),box=rooms.getBoundingClientRect(),before=rooms.scrollTop;
      if(pointer.x>=box.left-12&&pointer.x<=box.right+12){
        if(pointer.y<box.top+36)rooms.scrollTop-=10;
        else if(pointer.y>box.bottom-36)rooms.scrollTop+=10;
      }
      if(rooms.scrollTop!==before)preview(targetAt(pointer.x,pointer.y));
      scrollFrame=requestAnimationFrame(tick);
    };scrollFrame=requestAnimationFrame(tick);
  }
  function clearDrag() {
    const captured=pointer;pointer=null;dragId=null;marker(null);ghost?.remove();ghost=null;
    cancelAnimationFrame(scrollFrame);scrollFrame=0;document.body.classList.remove('sidebarDraggingActive');
    try{if(captured?.node.hasPointerCapture(captured.id))captured.node.releasePointerCapture(captured.id);}catch{}
    document.querySelectorAll('.sidebarDragging').forEach(node=>node.classList.remove('sidebarDragging'));
  }
  function startPointer(event) {
    if(!editing||pointer||event.button!==0||event.isPrimary===false)return;
    const node=event.currentTarget,box=node.getBoundingClientRect();
    pointer={id:event.pointerId,item:node.dataset.sidebarItem,x:event.clientX,y:event.clientY,startX:event.clientX,startY:event.clientY,offsetX:event.clientX-box.left,offsetY:event.clientY-box.top,node,box};
    try{node.setPointerCapture(event.pointerId);}catch{}
  }
  document.addEventListener('pointermove',event=>{
    if(!pointer||event.pointerId!==pointer.id)return;
    pointer.x=event.clientX;pointer.y=event.clientY;
    if(!dragId&&Math.hypot(pointer.x-pointer.startX,pointer.y-pointer.startY)<7)return;
    event.preventDefault();if(!dragId){
      dragId=pointer.item;ghost=document.createElement('div');ghost.className='sidebarDragGhost';ghost.innerHTML=pointer.node.innerHTML;ghost.setAttribute('aria-hidden','true');
      ghost.style.width=pointer.box.width+'px';ghost.style.height=pointer.box.height+'px';ghost.style.transformOrigin=`${pointer.offsetX}px ${pointer.offsetY}px`;
      document.body.append(ghost);pointer.node.classList.add('sidebarDragging');document.body.classList.add('sidebarDraggingActive');
    }
    ghost.style.transform=`translate3d(${pointer.x-pointer.offsetX}px,${pointer.y-pointer.offsetY}px,0) scale(1.04) rotate(-1deg)`;
    preview(targetAt(pointer.x,pointer.y));autoScroll();
  },{passive:false});
  document.addEventListener('pointerup',event=>{
    if(!pointer||event.pointerId!==pointer.id)return;const id=dragId,target=id?targetAt(event.clientX,event.clientY):null,lifted=ghost;
    if(id&&target)draft=model.move(draft,id,target.zone,target.before);
    if(id){suppressClick=true;setTimeout(()=>suppressClick=false,0);}ghost=null;clearDrag();if(id)draw(id);
    if(lifted){
      const node=get('rooms').querySelector(`[data-sidebar-item="${id}"]`),box=node?.getBoundingClientRect();
      if(box&&animated()){
        lifted.classList.add('is-settling');const animation=lifted.animate([{transform:lifted.style.transform,opacity:1},{transform:`translate3d(${box.left}px,${box.top}px,0) scale(1) rotate(0deg)`,opacity:0}],{duration:170,easing:'cubic-bezier(.2,.8,.2,1)',fill:'forwards'});
        animation.finished.catch(()=>{}).finally(()=>lifted.remove());
      }else lifted.remove();
    }
  });
  document.addEventListener('pointercancel',event=>{if(pointer?.id===event.pointerId){clearDrag();draw();}});
  document.addEventListener('lostpointercapture',event=>{if(pointer?.id===event.pointerId){clearDrag();draw();}});
  document.addEventListener('keydown',event=>{if(editing&&event.key==='Escape'&&!document.querySelector('dialog[open]')){event.preventDefault();cancel();}});
  // Changes remain a draft until Done; close/save protection elsewhere remains in charge of diary text.
  function install() {
    if(installed||!window.lifeosV01Ready)return;installed=true;
    const previous=buildRail;buildRail=function(...args){if(pointer||dragId)return;const result=previous.apply(this,args);draw();return result;};
    buildRail();window.dispatchEvent(new Event('lifeos:sidebar-ready'));
  }
  window.lifeosSidebar={edit:start,draw,layout:()=>model.normalize(editing?draft:saved),isEditing:()=>editing};
  if(window.lifeosV01Ready)install();else window.addEventListener('lifeos:v01-ready',install,{once:true});
})();
