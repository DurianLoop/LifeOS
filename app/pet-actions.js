/* A looping action belongs to one pet, across its shelf and in-app companion. */
(() => {
  'use strict';
  const actions=[['idle','待机'],['running-right','向右跑'],['running-left','向左跑'],['waving','挥手'],['jumping','跳跃'],['failed','失败'],['waiting','等待'],['running','运行'],['review','审阅']];
  if(typeof module==='object'&&module.exports&&typeof window==='undefined'){module.exports={actions};return;}
  const customActions=new Map();
  const getActions=slug=>customActions.get(slug)||actions;
  function register(slug,list){if(slug&&Array.isArray(list))customActions.set(slug,list.filter(item=>Array.isArray(item)&&typeof item[0]==='string'&&typeof item[1]==='string'));}
  const choices=new Map(),listeners=new Set();
  let menu=null,opened=null,request=0;
  const selected=slug=>choices.get(slug)||null;
  function select(slug,action){
    if(!slug)return;
    if(action!==null&&!getActions(slug).some(([id])=>id===action))return;
    if(selected(slug)===action)return;
    if(action===null)choices.delete(slug);else choices.set(slug,action);
    listeners.forEach(fn=>fn(slug,action));
  }
  function close(restore=false){
    request++;
    if(menu)menu.hidden=true;
    const origin=opened?.anchor;opened=null;
    if(restore&&origin?.isConnected)origin.focus({preventScroll:true});
  }
  function mount(){
    if(menu)return;
    menu=document.createElement('div');menu.id='petActionMenu';menu.className='petActionMenu';menu.role='menu';menu.hidden=true;
    menu.setAttribute('aria-label','桌宠动作');document.body.append(menu);
    menu.addEventListener('click',async event=>{
      const button=event.target.closest('[data-pet-loop],[data-pet-chat]');
      if(!button||!opened||menu.dataset.busy==='true')return;
      const target=opened,sequence=++request;
      if(button.hasAttribute('data-pet-chat')){close(false);target.chat?.();return;}
      const action=button.dataset.petLoop==='auto'?null:button.dataset.petLoop;
      menu.dataset.busy='true';button.setAttribute('aria-busy','true');
      try{
        await target.prepare?.(action);
        if(request!==sequence||opened!==target)return;
        select(target.slug,action);close(true);
      }catch(error){
        if(request!==sequence||opened!==target)return;
        const hint=menu.querySelector('[role="status"]');hint.textContent=error.message||'动作暂时无法加载，请重试';hint.hidden=false;
      }finally{if(request===sequence||!opened){menu.dataset.busy='false';button.removeAttribute('aria-busy');}}
    });
    menu.addEventListener('keydown',event=>{
      const buttons=[...menu.querySelectorAll('button:not(:disabled)')],index=buttons.indexOf(document.activeElement);
      if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
        event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length;
        buttons[next]?.focus();
      }else if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close(true);}
      else if(event.key==='Tab')close(false);
    });
    document.addEventListener('pointerdown',event=>{if(!menu.hidden&&!event.target.closest('#petActionMenu'))close(false);});
    document.addEventListener('scroll',event=>{if(!menu.hidden&&!event.target?.closest?.('#petActionMenu'))close(false);},true);
    window.addEventListener('resize',()=>close(false));
    window.addEventListener('lifeos:event',event=>{if(event.detail?.type==='navigate')close(false);});
  }
  function open(target){
    if(!target?.slug||!target.anchor)return;
    mount();close(false);opened=target;menu.dataset.busy='false';menu.replaceChildren();
    const title=document.createElement('b');title.textContent=target.name||'桌宠';menu.append(title);
    if(target.chat){const button=document.createElement('button');button.type='button';button.role='menuitem';button.dataset.petChat='true';button.textContent='和它聊聊';menu.append(button);}
    const choice=selected(target.slug);
    const available=getActions(target.slug);
    for(const [id,label] of [...available,['auto','恢复自动']]){
      const button=document.createElement('button');button.type='button';button.role='menuitemradio';button.dataset.petLoop=id;
      button.setAttribute('aria-checked',String(id==='auto'?choice===null:choice===id));button.textContent=label;menu.append(button);
      const row=available.findIndex(([action])=>action===id);if(!customActions.has(target.slug)&&row>=0&&target.frameMap?.[row]?.length===0){button.disabled=true;button.setAttribute('aria-disabled','true');button.title='这个桌宠没有此动作';}
    }
    const hint=document.createElement('p');hint.role='status';hint.hidden=true;menu.append(hint);menu.hidden=false;
    const rect=target.anchor.getBoundingClientRect(),width=menu.offsetWidth,height=menu.offsetHeight,pad=10;
    const viewportWidth=document.documentElement.clientWidth,viewportHeight=document.documentElement.clientHeight;
    let x=Number.isFinite(target.x)?target.x:rect.right+8,y=Number.isFinite(target.y)?target.y:rect.top;
    if(x+width>viewportWidth-pad)x=Math.min(rect.left-width-8,viewportWidth-width-pad);
    menu.style.left=Math.max(pad,x)+'px';menu.style.top=Math.max(pad,Math.min(y,viewportHeight-height-pad))+'px';
    menu.querySelector('[aria-checked="true"]')?.focus({preventScroll:true});
  }
  window.lifeosPetActions={actions,getActions,register,selected,select,open,close,subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);}};
})();
