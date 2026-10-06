(() => {
  'use strict';
  const desktop=window.lifeosDesktop;
  let state={status:desktop?'idle':'unsupported'},busy=false;
  const labels={idle:'检查更新',checking:'正在检查',current:'当前已是最新版',available:'可下载新版本',downloading:'正在下载',cancelling:'正在取消',ready:'更新已下载',preparing:'正在保存与备份',error:'更新未完成',unsupported:'源码模式不执行自动更新'};
  function draw(){
    const box=document.getElementById('desktopUpdateCard');if(!box)return;
    box.dataset.status=state.status;
    box.replaceChildren();
    const text=document.createElement('span');text.className='small';text.id='updateState';
    text.textContent=state.message||`${labels[state.status]||'检查更新'}${state.version?' · '+state.version:''}${state.status==='downloading'?' '+(state.percent||0)+'%':''}`;
    const button=(label,action,disabled=false)=>{const node=document.createElement('button');node.type='button';node.className='productAction';node.textContent=label;node.disabled=disabled;node.onclick=action;box.append(node)};
    button('检查更新',()=>act('checkForUpdates'),busy||['checking','downloading','cancelling','preparing','unsupported'].includes(state.status));
    if(state.status==='available'||(state.status==='error'&&state.hasUpdate))button('下载更新',()=>act('downloadUpdate'),busy);
    if(state.status==='downloading')button('取消下载',()=>act('cancelUpdate'));
    if(state.status==='ready')button('重启安装',()=>act('installUpdate'),busy);
    box.append(text);box.setAttribute('aria-live','polite');
  }
  async function act(method){
    if(method!=='cancelUpdate'){busy=true;draw()}
    try{const result=await desktop?.[method]?.();if(result?.status)state={...state,...result};if(result?.error||result?.reason)state={...state,message:result.error||result.reason};}
    catch{state={...state,status:'error',message:'操作未完成，请重试'}}
    finally{if(method!=='cancelUpdate')busy=false;draw()}
  }
  desktop?.onUpdate?.(next=>{state=next;draw()});
  desktop?.updateStatus?.().then(next=>{state=next;draw()}).catch(()=>{});
  new MutationObserver(()=>{const box=document.getElementById('desktopUpdateCard');if(box&&!box.children.length)draw()}).observe(document.body,{childList:true,subtree:true});
  draw();
})();
