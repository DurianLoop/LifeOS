/* Native mobile capabilities, loaded before workspace storage and feature code. */
(() => {
  'use strict';
  const platform=/LifeOSMobile\/(android|ios)/.exec(navigator.userAgent)?.[1];
  if(!platform)return;
  const storage=command=>{
    const request=new XMLHttpRequest();request.open('POST','/_mobile/storage',false);
    request.setRequestHeader('Content-Type','application/json');request.send(JSON.stringify(command));
    if(request.status!==200)throw new Error('草稿保存失败，请重试');
    return JSON.parse(request.responseText);
  };
  window.lifeosMobile={platform,storage,version:'0.6.0'};
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
  document.addEventListener('click',event=>{
    const anchor=event.target.closest?.('a[href]');if(!anchor)return;
    const url=anchor.href;
    if(anchor.hasAttribute('download')||/\/api\/(?:backup\/download|export|memorial\/qr)/.test(url)){
      event.preventDefault();event.stopImmediatePropagation();
      exportFile(url,anchor.download).catch(error=>{if(window.toast)window.toast(error.message);else alert(error.message)});
    }
  },true);
  const originalClick=HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click=function(){
    if(this.hasAttribute('download')){exportFile(this.href,this.download).catch(error=>alert(error.message));return}
    originalClick.call(this);
  };
  document.addEventListener('visibilitychange',()=>{window.dispatchEvent(new Event('lifeos:mobile-lifecycle'))});
})();
