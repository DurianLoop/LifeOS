(()=>{
  const key='lifeos.pref.sidebarCollapsed';
  const button=document.querySelector('#lifeSidebarToggle');
  const rail=document.querySelector('#lifeSidebar');
  const wideSidebar=window.matchMedia('(min-width:881px)');
  let collapsed=false;try{collapsed=localStorage.getItem(key)==='true'}catch(_){}
  const desktop=window.lifeosDesktop&&typeof window.lifeosDesktop.windowControl==='function';
  document.body.classList.toggle('lifeosDesktop',!!desktop);
  window.lifeosPageScroller=()=>document.body.classList.contains('writerImmersive')?window:document.querySelector('.shell')||window;

  const applySidebar=(nextCollapsed,{persist=true}={})=>{
    collapsed=nextCollapsed;
    const hidden=collapsed&&wideSidebar.matches;
    if(hidden&&rail?.contains(document.activeElement))button?.focus({preventScroll:true});
    document.body.classList.toggle('sidebarCollapsed',hidden);
    if(rail){rail.inert=hidden;if(hidden)rail.setAttribute('aria-hidden','true');else rail.removeAttribute('aria-hidden')}
    button?.setAttribute('aria-expanded',String(!hidden));
    if(button){button.setAttribute('aria-label',hidden?'展开侧边栏':'收起侧边栏');button.title=hidden?'展开侧边栏':'收起侧边栏';const glyph=button.querySelector('[aria-hidden="true"]');if(glyph)glyph.innerHTML=`<svg viewBox="0 0 24 24" fill="none"><path d="${hidden?'M4 5h16M12 12h8M4 19h16':'M4 5h16M4 12h8M4 19h16'}" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="${hidden?'m4 8 5 4-5 4z':'m20 8-5 4 5 4z'}" fill="currentColor"/></svg>`}
    if(persist){try{localStorage.setItem(key,String(collapsed))}catch(_){}}
  };
  applySidebar(collapsed,{persist:false});
  button?.addEventListener('click',()=>applySidebar(!collapsed));
  wideSidebar.addEventListener('change',()=>applySidebar(collapsed,{persist:false}));
  window.addEventListener('lifeos:sidebar-edit',event=>{
    const editing=event.detail?.editing===true;
    if(button)button.disabled=editing;
    if(editing)applySidebar(false);
  });

  const actions={write:'#memoryDockOpen',search:'#searchTop',tune:'#allRail'};
  document.querySelectorAll('[data-life-shell-action]').forEach(control=>control.addEventListener('click',()=>document.querySelector(actions[control.dataset.lifeShellAction])?.click()));

  document.querySelectorAll('[data-life-window-control]').forEach(control=>control.addEventListener('click',async()=>{
    if(!desktop)return;
    const result=await window.lifeosDesktop.windowControl(control.dataset.lifeWindowControl);
    if(control.dataset.lifeWindowControl==='toggle-maximize'&&result?.ok){
      const glyph=control.querySelector('.lifeMaximizeGlyph');
      if(glyph)glyph.textContent=result.maximized?'❐':'□';
      control.setAttribute('aria-label',result.maximized?'还原窗口':'最大化窗口');
    }
  }));
  window.addEventListener('keydown',event=>{
    if(!document.body.classList.contains('sidebarEditing')&&(event.ctrlKey||event.metaKey)&&event.shiftKey&&event.key.toLowerCase()==='b'){
      event.preventDefault();applySidebar(!collapsed);
    }
  });
})();
