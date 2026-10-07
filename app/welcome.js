(() => {
  'use strict';
  const KEY='lifeos.welcome.v1';
  let checking=false,shown=false;
  const copy=(zh,en)=>window.lifeosNavLanguage?.()==='en'?en:zh;
  async function check() {
    if(checking||shown||!window.lifeosV01Ready)return;
    checking=true;
    try {
      if(localStorage.getItem(KEY))return;
      const context=window.lifeosVisitContext;
      // An upgrade or a restored archive must not be mistaken for a new installation.
      if(!context||context.storageError)return;
      if(context.existing){localStorage.setItem(KEY,'existing');return;}
      const status=await api('/api/core/status',{noCache:true});
      if(!Number.isFinite(status?.core?.entries))return;
      if(status.core.entries>0){localStorage.setItem(KEY,'existing');return;}
      if(STATE.feature!=='Home'||document.querySelector('dialog[open]')||document.body.classList.contains('productDockOpen'))return;
      show();
    } catch { /* The app remains usable when local persistence or the backend is unavailable. */ }
    finally {checking=false;}
  }
  function show() {
    const node=document.createElement('dialog');node.id='lifeosWelcome';node.className='welcomeDialog';
    node.setAttribute('aria-labelledby','welcomeTitle');node.setAttribute('aria-describedby','welcomeDescription');
    node.innerHTML=`<div class="welcomePaper"><header><span>LifeOS</span><button type="button" data-welcome="skip" class="welcomeClose" aria-label="${copy('跳过引导','Skip introduction')}">×</button></header><div class="welcomeLeaves" aria-hidden="true"><i></i><i></i><i></i></div><h1 id="welcomeTitle">${copy('一页，留住今天','Keep a little of today')}</h1><p id="welcomeDescription">${copy('写下新的日子，或从旧日记开始','Write something new, or bring your journals with you')}</p><div class="welcomeChoices"><button type="button" data-welcome="write">${uiIcon('write')}<span>${copy('写第一篇','Write your first page')}</span><b aria-hidden="true">→</b></button><button type="button" data-welcome="import">${uiIcon('journal')}<span>${copy('导入旧日记','Import your journals')}</span><b aria-hidden="true">→</b></button></div><footer><span>${copy('本地保存 · AI 可稍后设置','Saved locally · AI can wait')}</span><button type="button" data-welcome="skip">${copy('先看看','Look around')}</button></footer><div class="welcomeError" role="alert"></div></div>`;
    document.body.append(node);shown=true;node.showModal();
    async function done(action) {
      try{localStorage.setItem(KEY,'done');}
      catch{node.querySelector('.welcomeError').textContent=copy('未能保存，请重试','Could not save. Try again');return;}
      node.close();node.remove();
      if(action==='write')await openProductDock('writer',{date:localDateISO()});
      else if(action==='import')await openProductDock('import');
      else document.querySelector('#view')?.focus({preventScroll:true});
    }
    node.addEventListener('cancel',event=>{event.preventDefault();void done('skip');});
    node.querySelectorAll('[data-welcome]').forEach(button=>button.onclick=()=>void done(button.dataset.welcome));
  }
  if(window.lifeosV01Ready)setTimeout(check,450);
  else window.addEventListener('lifeos:v01-ready',()=>setTimeout(check,450),{once:true});
})();
