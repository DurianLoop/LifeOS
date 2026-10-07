/* Independent pet formats share selection and lifecycle, never an atlas contract. */
(() => {
  'use strict';
  const mounted=new Map();
  const special=item=>item?.renderer==='vivi-gif';
  async function prepare(item){
    if(!special(item))return window.lifeosPetSprites.prepare(item);
    window.lifeosPetActions.register(item.slug,(item.actions||[]).map(action=>[action.id,action.label]));
    window.lifeosPetSettings?.restoreChoices();
    return item;
  }
  function release(element){const entry=mounted.get(element);if(entry){entry.runtime.destroy();mounted.delete(element);delete element.dataset.spriteAsset;}}
  function clean(){for(const element of mounted.keys())if(!element.isConnected)release(element);}
  function paint(element,item,options={}){
    clean();if(!element)return null;
    if(!special(item)){release(element);return null;}
    let entry=mounted.get(element);
    if(entry?.slug!==item.slug){release(element);element.textContent='';element.style.backgroundImage='';
      const runtime=window.lifeosViVi.mount(element,item,{...options,mode:options.mode||'preview',width:options.width||element.clientWidth||144,height:options.height||element.clientHeight||156});
      entry={runtime,slug:item.slug,ready:false,lastRequest:null,motion:undefined,visible:undefined,options};mounted.set(element,entry);
      runtime.ready.then(()=>{if(mounted.get(element)!==entry)return;entry.ready=true;element.dataset.spriteReady='true';apply(element,entry,entry.options);entry.options.onReady?.();}).catch(()=>{if(mounted.get(element)!==entry)return;element.dataset.spriteReady='false';element.textContent='✦';});
    }
    entry.options=options;
    if(entry.ready)apply(element,entry,options);return entry.runtime;
  }
  function apply(element,entry,options){
    const actions=window.lifeosPetActions,command=actions.command(entry.slug),motion=options.motion!==false,visible=options.visible!==false;
    if(command&&command.requestId!==entry.lastRequest){
      entry.lastRequest=command.requestId;
      if(command.action===null)entry.runtime.select(null).catch(()=>{});
      else if(command.active)entry.runtime.select(command.action,{loop:false,onComplete:()=>{if(mounted.get(element)===entry)actions.finish(entry.slug,command.requestId);}}).catch(()=>{});
    }
    if(motion!==entry.motion){entry.motion=motion;entry.runtime.setMotion(motion);}
    if(visible!==entry.visible){entry.visible=visible;entry.runtime.setVisible(visible);}
    element.dataset.petAction=entry.runtime.getState().action;
  }
  function get(element){return mounted.get(element)?.runtime||null;}
  window.lifeosPetRenderers={special,prepare,paint,get,release,clean};
  new MutationObserver(clean).observe(document.body,{childList:true,subtree:true});
  document.addEventListener('visibilitychange',()=>{for(const [element,entry] of mounted)entry.runtime.setVisible(!document.hidden&&entry.options.visible!==false&&!element.closest('[hidden]'));});
})();
