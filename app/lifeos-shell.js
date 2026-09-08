(()=>{
  const key='lifeos.pref.sidebarCollapsed';
  const button=document.querySelector('#lifeSidebarToggle');
  const desktop=window.lifeosDesktop&&typeof window.lifeosDesktop.windowControl==='function';
  document.body.classList.toggle('lifeosDesktop',!!desktop);

  const applySidebar=(collapsed,{persist=true}={})=>{
    document.body.classList.toggle('sidebarCollapsed',collapsed);
    button?.setAttribute('aria-expanded',String(!collapsed));
    if(button){button.setAttribute('aria-label',collapsed?'展开侧边栏':'收起侧边栏');button.title=collapsed?'展开侧边栏':'收起侧边栏';const glyph=button.querySelector('[aria-hidden="true"]');if(glyph)glyph.textContent=collapsed?'›':'‹'}
    if(persist){try{localStorage.setItem(key,String(collapsed))}catch(_){}}
  };
  let collapsed=false;try{collapsed=localStorage.getItem(key)==='true'}catch(_){}
  applySidebar(collapsed,{persist:false});
  button?.addEventListener('click',()=>applySidebar(!document.body.classList.contains('sidebarCollapsed')));

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
    if((event.ctrlKey||event.metaKey)&&event.shiftKey&&event.key.toLowerCase()==='b'){
      event.preventDefault();applySidebar(!document.body.classList.contains('sidebarCollapsed'));
    }
  });
})();
