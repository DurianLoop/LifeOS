/* Native mobile capabilities, loaded before workspace storage and feature code. */
(() => {
  'use strict';
  const detected=document.documentElement.dataset.nativePlatform;
  const platform=['android','ios'].includes(detected)?detected:/LifeOSMobile\/(android|ios)/.exec(navigator.userAgent)?.[1];
  if(!platform)return;
  let persisted=null;
  const storage=command=>{
    // Navigation repeatedly saves unchanged preferences. A value enters this
    // cache only after the private engine confirms a durable write/snapshot.
    if(command.op==='set'&&persisted&&persisted[command.key]===command.value)return {ok:true,value:null};
    const request=new XMLHttpRequest();request.open('POST','/_mobile/storage',false);
    request.setRequestHeader('Content-Type','application/json');request.send(JSON.stringify(command));
    if(request.status!==200)throw new Error('草稿保存失败，请重试');
    const reply=JSON.parse(request.responseText);
    if(reply.ok){
      if(command.op==='snapshot'||command.op==='import')persisted={...reply.value};
      else if(command.op==='set'&&persisted)persisted[command.key]=command.value;
      else if(command.op==='remove'&&persisted)delete persisted[command.key];
    }else persisted=null;
    return reply;
  };
  window.lifeosMobile={platform,storage,version:'0.6.1'};
  window.lifeosMobile.requestText=(message,value='')=>new Promise(resolve=>{
    const dialog=document.createElement('dialog'),form=document.createElement('form'),label=document.createElement('label'),input=document.createElement('input'),actions=document.createElement('div'),cancel=document.createElement('button'),submit=document.createElement('button');
    dialog.className='mobileTextDialog';form.method='dialog';label.textContent=message;input.value=value;input.autocomplete='off';input.spellcheck=false;input.setAttribute('aria-label',message);
    cancel.type='button';cancel.textContent='取消';submit.type='submit';submit.textContent='确定';cancel.className=submit.className='productAction';actions.append(cancel,submit);form.append(label,input,actions);dialog.append(form);document.body.append(dialog);
    const finish=value=>{dialog.remove();resolve(value)};
    cancel.onclick=()=>finish(null);dialog.addEventListener('cancel',event=>{event.preventDefault();finish(null)});form.onsubmit=event=>{event.preventDefault();finish(input.value)};
    dialog.showModal();input.focus();
  });
  document.documentElement.dataset.platform=platform;
  async function exportFile(url,name){
    const response=await fetch(url);if(!response.ok)throw Error('无法读取导出文件');
    const blob=await response.blob();
    const base64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(Error('无法读取导出文件'));reader.onload=()=>resolve(reader.result.split(',')[1]);reader.readAsDataURL(blob)});
    const disposition=response.headers.get('Content-Disposition')||'';
    const encoded=/filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
    const result=await fetch('/_mobile/export',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({base64,name:name||(encoded?decodeURIComponent(encoded):'LifeOS-export'),type:blob.type})});
    const data=await result.json();if(!data.ok)throw Error(data.error||'导出未完成');
  }
  window.lifeosMobile.exportFile=exportFile;
  window.lifeosMobile.restart=async()=>{const result=await fetch('/_mobile/restart',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});return result.json()};
  document.addEventListener('click',event=>{
    const anchor=event.target.closest?.('a[href]');if(!anchor)return;
    const url=anchor.href;
    if(anchor.hasAttribute('download')||/\/api\/(?:backups?\/download|export|attachment\?|memorial\/qr)/.test(url)){
      event.preventDefault();event.stopImmediatePropagation();
      exportFile(url,anchor.download).catch(error=>{if(window.toast)window.toast(error.message);else alert(error.message)});
    }
  },true);
  const originalClick=HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click=function(){
    if(this.hasAttribute('download')){exportFile(this.href,this.download).catch(error=>alert(error.message));return}
    originalClick.call(this);
  };
  window.lifeosMobile.back=()=>{
    const dialog=document.querySelector('dialog[open]');if(dialog){if(dialog.dispatchEvent(new Event('cancel',{cancelable:true})))dialog.close();return true}
    const ask=document.querySelector('#askModal.open');if(ask){closeAsk();return true}
    if(document.body.classList.contains('productDockOpen')){setProductDock(false);return true}
    if(document.querySelector('#mobileMorePanel.open')){closeMobileMore();return true}
    if(typeof STATE!=='undefined'&&STATE.feature!=='Home'){const previous=STATE.feature;history.back();setTimeout(()=>{if(STATE.feature===previous)openFeature('Home')},200);return true}
    return false;
  };
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden)void window.lifeosPrepareToClose?.();
    window.dispatchEvent(new Event('lifeos:mobile-lifecycle'));
  });
})();
