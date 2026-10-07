/* Runtime faithful to the upstream 8×9 / 8×11 pet contract. */
(() => {
  'use strict';
  const key='lifeos.pet.float.position',visibleKey='lifeos.pet.float.visible',spriteW=144,spriteH=156;
  const actions=window.lifeosPetActions;
  const ROWS={idle:0,'running-right':1,'running-left':2,waving:3,jumping:4,failed:5,waiting:6,running:7,review:8};
  let pet=null,frame=0,timer=null,state='idle',stateUntil=0,look=-1,drag=null,loadedAsset='',refreshSequence=0,chatHistory=[],chatBusy=false,chatWelcomed=false,visibleWanted=false,preferredPosition=null,touchHold=null,motion=localStorage.getItem('lifeos.pet.motion')!=='false',placement='in_app',scale=1;
  const $=(s,r=document)=>r.querySelector(s),isV2=()=>Number(pet?.spriteVersionNumber)===2,isDesktop=()=>Boolean(window.lifeosDesktop);
  const viewportWidth=()=>document.documentElement?.clientWidth||innerWidth,viewportHeight=()=>document.documentElement?.clientHeight||innerHeight;
  async function current(){const r=await fetch('/api/pets/catalog',{cache:'no-store'});if(r.ok===false)throw new Error('桌宠目录暂不可用');const d=await r.json();return(d.installed||[]).find(x=>x.slug===d.active_slug)||(d.installed||[])[0]||null}
  function point(){try{return JSON.parse(localStorage.getItem(key)||'null')}catch{return null}}
  function clamp(x,y){const el=$('#lifePetFloat'),w=el?.offsetWidth||spriteW,h=el?.offsetHeight||spriteH;return{x:Math.max(0,Math.min(viewportWidth()-w,x)),y:Math.max(0,Math.min(viewportHeight()-h,y))}}
  function readySprite(){if(pet?.renderer==='vivi-gif')return $('#lifePetFloatSprite')?.dataset.spriteReady==='true';return Boolean(pet?.asset_url&&loadedAsset===pet.asset_url)}
  function avoidReaderFooter(q,w,h){
    const footer=$('.jbPageFoot'),r=footer?.getBoundingClientRect();
    if(!r||r.width<=0||r.height<=0||r.top>=viewportHeight()||r.bottom<=0)return q;
    const right=r.right??r.left+r.width,bottom=r.bottom??r.top+r.height,gap=12;
    if(q.x+w<=r.left||q.x>=right||q.y+h<=r.top||q.y>=bottom)return q;
    if(r.top-h-gap>=0)return{...q,y:r.top-h-gap};
    if(bottom+gap+h<=viewportHeight())return{...q,y:bottom+gap};
    if(r.left-w-gap>=0)return{...q,x:r.left-w-gap};
    if(right+gap+w<=viewportWidth())return{...q,x:right+gap};
    return{...q,blocked:true};
  }
  function position(p=preferredPosition){
    const el=$('#lifePetFloat');if(!el)return;
    // Measure the decoded sprite at its responsive size before choosing a safe position.
    const ready=visibleWanted&&placement==='in_app'&&readySprite();el.hidden=!ready;
    const w=el.offsetWidth||spriteW,h=el.offsetHeight||spriteH;
    const q=avoidReaderFooter(clamp(Number.isFinite(p?.x)?p.x:viewportWidth()-w-28,Number.isFinite(p?.y)?p.y:viewportHeight()-h-28),w,h);
    el.style.left=q.x+'px';el.style.top=q.y+'px';
    const show=ready&&!q.blocked;el.hidden=!show;el.inert=!show;el.style.pointerEvents=show?'':'none';el.dataset.spriteReady=String(readySprite());
    if(pet?.renderer==='vivi-gif'){const runtime=window.lifeosPetRenderers.get($('#lifePetFloatSprite'));runtime?.setVisible(show);runtime?.setMotion(motion);}
    if(show){if(timer===null&&motion&&!document.hidden)animate()}else{stop();closeMenu()}
    requestAnimationFrame(placePetPanels);
  }
  function prepareSprite(){const el=$('#lifePetFloatSprite');if(!el||!pet)return null;const rows=isV2()?11:9,cellW=el.clientWidth||spriteW,cellH=el.clientHeight||spriteH;if(loadedAsset!==pet.asset_url||el.dataset.rows!==String(rows)||el.dataset.cellW!==String(cellW)||el.dataset.cellH!==String(cellH)){el.style.backgroundImage='url("'+pet.asset_url+'")';el.style.backgroundSize=(cellW*8)+'px '+(cellH*rows)+'px';el.dataset.rows=String(rows);el.dataset.cellW=String(cellW);el.dataset.cellH=String(cellH);loadedAsset=pet.asset_url}return{el,rows,cellW,cellH}}
  function paint(){
    const element=$('#lifePetFloatSprite');if(pet?.renderer==='vivi-gif'){
      window.lifeosPetRenderers.paint(element,pet,{mode:'companion',width:element.clientWidth||spriteW*scale,height:element.clientHeight||spriteH*scale,motion,visible:visibleWanted&&placement==='in_app',position:preferredPosition||undefined,positionElement:$('#lifePetFloat'),bounds:()=>({width:viewportWidth(),height:viewportHeight()}),settings:{...window.lifeosViViSettings?.get(),scale:1},onReady:position,onPosition:()=>{if(!drag)placePetPanels();}});return;
    }window.lifeosPetRenderers?.release(element);const sprite=prepareSprite();if(!sprite)return;const {el,rows,cellW,cellH}=sprite,usingLook=isV2()&&look>=0&&!actions.selected(pet?.slug),requested=usingLook?9+Math.floor(look/8):ROWS[state],row=pet?.frame_map?.[requested]?.length===0?Math.max(0,pet.frame_map.findIndex(cells=>cells.length)):requested,cells=pet?.frame_map?.[row]?.length?pet.frame_map[row]:[0,1,2,3,4,5,6,7],column=usingLook&&row===requested?look%8:cells[frame%cells.length];el.style.backgroundPosition='-'+(column*cellW)+'px -'+(row*cellH)+'px';el.dataset.petAction=state}
  function setState(next,ms=0,{force=false}={}){if(pet?.renderer==='vivi-gif'){paint();if(!actions.selected(pet.slug))window.lifeosPetRenderers.get($('#lifePetFloatSprite'))?.playOnce(next,{duration:ms}).catch(()=>{});return;}const loop=actions.selected(pet?.slug);if(loop&&!force){next=loop;ms=0}state=ROWS[next]===undefined?'idle':next;frame=0;look=-1;stateUntil=ms?Date.now()+ms:0;paint()}
  function stop(){clearTimeout(timer);timer=null}
  function animate(){stop();if(pet?.renderer==='vivi-gif')return;const tick=()=>{if(!$('#lifePetFloat')||$('#lifePetFloat').hidden||!motion||document.hidden)return;if(!drag&&stateUntil&&Date.now()>=stateUntil)setState('idle');if(!isV2()||look<0||actions.selected(pet?.slug))frame+=1;paint();timer=setTimeout(tick,state==='waiting'?240:140)};tick()}
  async function refresh(){
    const sequence=++refreshSequence;
    try{
      const item=await current(),next=item?.asset_url?await (window.lifeosPetRenderers?.prepare(item)||window.lifeosPetSprites.prepare(item)):null;
      if(sequence!==refreshSequence)return;
      const changed=pet?.asset_url!==next?.asset_url;pet=next;
      if(changed){frame=0;look=-1;state=actions.selected(next?.slug)||'idle';stateUntil=0}
      if(!next){loadedAsset='';window.lifeosPetRenderers?.release($('#lifePetFloatSprite'));$('#lifePetFloatSprite')?.style.removeProperty('background-image');}
      paint();position();
    }catch(error){if(sequence===refreshSequence)position()}
  }
  function setVisible(show){const el=$('#lifePetFloat');if(!el)return;visibleWanted=Boolean(show);localStorage.setItem(visibleKey,String(visibleWanted));position();if(!visibleWanted)closeChat();const b=$('#petFloatToggle');if(b)b.textContent=visibleWanted?'收起悬浮桌宠':'显示悬浮桌宠'}
  function lookAt(event){if(!isV2()||drag||actions.selected(pet?.slug))return;const el=$('#lifePetFloat'),r=el?.getBoundingClientRect();if(!r)return;const dx=event.clientX-r.left-r.width/2,dy=event.clientY-r.top-r.height/2;look=Math.hypot(dx,dy)<12?-1:Math.round((Math.atan2(dx,-dy)*180/Math.PI+360)%360/22.5)%16;paint()}
  function chatLine(role,text){const feed=$('#petChatFeed');if(!feed)return;const line=document.createElement('p');line.className=`petChatLine ${role}`;line.textContent=text;feed.append(line);feed.scrollTop=feed.scrollHeight}
  function chatSources(data){
    const feed=$('#petChatFeed'),sources=Array.isArray(data.knowledge?.sources)?data.knowledge.sources.slice(0,4):[];if(!feed||(!sources.length&&data.mode!=='local_guide'))return;
    const row=document.createElement('div');row.className='petChatSources';
    if(data.mode==='local_guide'||data.local_guide){const label=document.createElement('small');label.textContent='本地指南';row.append(label)}
    const docks=new Set(['writer','import','export','versions','backup','privacy','memorial','inbox','sync']);
    for(const source of sources){
      const canFeature=source.feature==='Ask My Life'||(typeof source.feature==='string'&&typeof RENDERERS!=='undefined'&&Object.prototype.hasOwnProperty.call(RENDERERS,source.feature)),canAction=source.action==='appearance'||docks.has(source.action);
      const item=document.createElement(canFeature||canAction?'button':'span');item.textContent=String(source.title||'使用指南');if(source.entry)item.title=String(source.entry);
      if(canFeature||canAction){item.type='button';item.addEventListener('click',()=>{closeChat();if(source.action==='appearance'){if(!$('#tweaksPanel')?.classList.contains('open'))$('#allRail')?.click();}else if(docks.has(source.action))openProductDock(source.action);else if(source.feature==='Pet Shelf')window.dispatchEvent(new Event('lifeos:open-pet'));else if(source.feature==='Ask My Life')openAsk();else openFeature(source.feature)});}
      row.append(item);
    }
    feed.append(row);feed.scrollTop=feed.scrollHeight;
  }
  function chatHint(text,kind=''){const hint=$('#petChatHint');if(hint){hint.textContent=text;hint.dataset.kind=kind;hint.hidden=!text}}
  function petRect(){const el=$('#lifePetFloat');if(!el)return null;if(!el.hidden)return el.getBoundingClientRect();return{left:Number.parseFloat(el.style.left)||0,top:Number.parseFloat(el.style.top)||0,width:spriteW,height:spriteH}}
  function anchorPanel(panel,kind){
    const r=petRect();if(!panel||!r)return;
    const pad=12,gap=14,right=r.left+r.width,bottom=r.top+r.height,midX=r.left+r.width/2,midY=r.top+r.height/2;
    panel.style.removeProperty('--pet-panel-max-height');
    const w=panel.offsetWidth||Math.min(390,viewportWidth()-pad*2);let h=panel.offsetHeight||Math.min(480,viewportHeight()-pad*2),anchor,left,top;
    const sides=midX>viewportWidth()/2?['left','right']:['right','left'];
    anchor=sides.find(side=>side==='left'?r.left-gap-w>=pad:right+gap+w<=viewportWidth()-pad);
    if(anchor){left=anchor==='left'?r.left-gap-w:right+gap;top=Math.max(pad,Math.min(viewportHeight()-h-pad,midY-h/2))}
    else{
      const above=Math.max(0,r.top-gap-pad),below=Math.max(0,viewportHeight()-pad-bottom-gap);
      anchor=above>=below?'above':'below';const available=anchor==='above'?above:below;
      if(kind==='chat'){panel.style.setProperty('--pet-panel-max-height',available+'px');h=Math.min(h,available)}
      left=Math.max(pad,Math.min(viewportWidth()-w-pad,midX-w/2));top=anchor==='above'?r.top-gap-h:bottom+gap;
    }
    panel.style.left=Math.round(left)+'px';panel.style.top=Math.round(top)+'px';panel.dataset.anchor=anchor;
    if(kind==='chat'){
      panel.style.setProperty('--pet-origin',anchor==='left'?'100% 50%':anchor==='right'?'0 50%':anchor==='above'?'50% 100%':'50% 0');
      panel.style.setProperty('--pet-tail',Math.max(18,Math.min(w-18,midX-left))+'px');
      panel.style.setProperty('--pet-tail-y',Math.max(18,Math.min(h-18,midY-top))+'px');
    }
  }
  function placePetPanels(){const chat=$('#lifePetChat');if(chat&&!chat.hidden)anchorPanel(chat,'chat')}
  function closeMenu(){actions.close();$('#lifePetFloat')?.classList.remove('contextOpen')}
  function closeChat(){const modal=$('#lifePetChat');if(!modal)return;modal.hidden=true;chatBusy=false;setState('idle')}
  function openMenu(){const sprite=$('#lifePetFloatSprite');if(!pet||!sprite)return;closeChat();actions.open({slug:pet.slug,name:pet.name,anchor:sprite,frameMap:pet.frame_map,chat:openChat})}
  async function openChat(){const modal=$('#lifePetChat');if(!modal)return;if(!visibleWanted)setVisible(true);closeMenu();modal.hidden=false;setState('waiting');if(!chatWelcomed){chatLine('assistant',`${pet?.name||'小桌宠'}在这儿。想聊点什么？`);chatHint('');chatWelcomed=true}requestAnimationFrame(()=>{anchorPanel(modal,'chat');$('#petChatInput')?.focus()})}
  async function sendChat(){
    const input=$('#petChatInput'),text=input?.value.trim();if(!text||chatBusy)return;chatBusy=true;input.value='';chatHistory.push({role:'user',content:text});chatLine('user',text);chatHint('正在认真听…','waiting');setState('running',1100);const submit=$('#petChatSend');if(submit)submit.disabled=true;
    try{
      const response=await fetch('/api/pets/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({messages:chatHistory.slice(-12)})});const data=await response.json();
      if(!response.ok){if(data.local_guide){chatLine('assistant',String(data.local_guide));chatSources(data)}throw new Error(data.error||'桌宠暂时没有回应')}
      const reply=String(data.reply||'我在');chatHistory.push({role:'assistant',content:reply});chatLine('assistant',reply);chatSources(data);chatHint('','ready');setState('waving',900);
    }catch(error){chatLine('system',error.message||'桌宠暂时没有回应');chatHint('请稍后重试','error');setState('failed',1200)}finally{chatBusy=false;if(submit)submit.disabled=false;input?.focus()}
  }
  function bindChat(){const modal=$('#lifePetChat');if(!modal)return;$('#petChatClose')?.addEventListener('click',closeChat);$('#petChatForm')?.addEventListener('submit',event=>{event.preventDefault();sendChat()});document.addEventListener('pointerdown',event=>{if(!event.target.closest('#lifePetFloat,#lifePetChat,#petActionMenu,[data-pet-target]')){closeMenu();closeChat()}});document.addEventListener('keydown',event=>{if(event.key==='Escape'){closeMenu();closeChat()}});window.addEventListener('lifeos:open-pet-chat',openChat)}
  function bindDrag(){
    const el=$('#lifePetFloat'),sprite=$('#lifePetFloatSprite'),cancelHold=()=>{clearTimeout(touchHold);touchHold=null};
    sprite.addEventListener('pointerdown',event=>{
      if(pet?.renderer==='vivi-gif'){if(event.button!==0||el.hidden||!readySprite())return;closeMenu();const runtime=window.lifeosPetRenderers.get(sprite);if(runtime?.beginDrag({x:event.clientX,y:event.clientY})){drag={vivi:true};sprite.setPointerCapture?.(event.pointerId);event.preventDefault();}return;}
      if(event.button!==0||el.hidden||!readySprite())return;closeMenu();sprite.setPointerCapture?.(event.pointerId);
      drag={dx:event.clientX-el.offsetLeft,dy:event.clientY-el.offsetTop,lastX:event.clientX,moved:false,position:null};setState('running-right',0,{force:true});el.classList.add('dragging');event.preventDefault();
      if(event.pointerType==='touch')touchHold=setTimeout(()=>{if(drag&&!drag.moved){drag=null;el.classList.remove('dragging');setState('idle');openMenu()}touchHold=null},520);
    });
    sprite.addEventListener('pointermove',event=>{
      if(drag?.vivi){window.lifeosPetRenderers.get(sprite)?.moveDrag({x:event.clientX,y:event.clientY});placePetPanels();event.preventDefault();return;}
      if(!drag)return;const dx=event.clientX-drag.lastX;if(Math.abs(event.clientX-(el.offsetLeft+drag.dx))+Math.abs(event.clientY-(el.offsetTop+drag.dy))>3){drag.moved=true;cancelHold()}
      if(dx){const next=dx<0?'running-left':'running-right';if(state!==next)setState(next,0,{force:true});drag.lastX=event.clientX}
      const p=clamp(event.clientX-drag.dx,event.clientY-drag.dy);drag.position=p;el.style.left=p.x+'px';el.style.top=p.y+'px';placePetPanels();event.preventDefault();
    });
    sprite.addEventListener('pointerup',event=>{cancelHold();if(drag?.vivi){const runtime=window.lifeosPetRenderers.get(sprite);runtime?.endDrag({x:event.clientX,y:event.clientY});const value=runtime?.getState();if(value){preferredPosition={x:value.x,y:value.y};localStorage.setItem(key,JSON.stringify(preferredPosition));}drag=null;placePetPanels();return;}if(!drag)return;const wasClick=!drag.moved,next=drag.position;drag=null;el.classList.remove('dragging');if(!wasClick&&next){preferredPosition=next;localStorage.setItem(key,JSON.stringify(next))}position();setState(wasClick?'waving':'idle',wasClick?900:0)});
    sprite.addEventListener('pointercancel',()=>{cancelHold();if(drag?.vivi)window.lifeosPetRenderers.get(sprite)?.cancelDrag();drag=null;el.classList.remove('dragging');position();setState('idle')});
    sprite.addEventListener('contextmenu',event=>{event.preventDefault();cancelHold();openMenu()});
    sprite.addEventListener('keydown',event=>{if(event.key==='ContextMenu'||(event.shiftKey&&event.key==='F10')||event.key==='Enter'||event.key===' '){event.preventDefault();openMenu()}});
    sprite.addEventListener('pointermove',lookAt);sprite.addEventListener('pointerleave',()=>{if(!drag){look=-1;paint()}});
    addEventListener('resize',()=>{if(!drag)position();requestAnimationFrame(()=>requestAnimationFrame(()=>{if(!drag)position()}))});
    document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();else if(!el.hidden&&motion)animate()});
  }
  function mount(){
    if($('#lifePetChat'))return;
    const floating='<aside id="lifePetFloat" class="lifePetFloat" aria-label="悬浮桌宠" hidden><button id="lifePetFloatSprite" class="lifePetFloatSprite" type="button" aria-haspopup="menu" aria-label="拖动桌宠；右键选择动作或聊天" title="拖动桌宠；右键选择动作或聊天"></button></aside>';
    document.body.insertAdjacentHTML('beforeend',floating+'<section id="lifePetChat" class="petChatDialog" role="dialog" aria-modal="false" aria-labelledby="petChatTitle" hidden><header><div><h2 id="petChatTitle">和桌宠聊聊</h2></div><button id="petChatClose" type="button" aria-label="关闭对话">×</button></header><div id="petChatFeed" class="petChatFeed" aria-live="polite"></div><p id="petChatHint" class="petChatHint" hidden></p><form id="petChatForm"><textarea id="petChatInput" rows="2" maxlength="1800" placeholder="说点什么…" aria-label="和桌宠说点什么"></textarea><button id="petChatSend" type="submit">发送</button></form></section>');
    bindDrag();bindChat();preferredPosition=point();const visible=localStorage.getItem(visibleKey),settings=window.lifeosPetSettings?.get();placement=settings?.mode||'in_app';scale=settings?.scale||1;applySize();setVisible(settings?settings.visible:visible==='true'||(isDesktop()&&visible===null));refresh().catch(()=>{})
  }
  const eventState={navigate:['running',850],'journal-open':['review',1200],'journal-focus-enter':['review',0],'journal-focus-exit':['idle',0],'journal-section':['review',700],'journal-complete':['waving',1100],theme:['jumping',900],typography:['review',700],'pet-click':['waving',900],'entry-created':['waving',1000],'entry-updated':['review',850],'lifeos:backend-exit':['failed',0]};
  window.addEventListener('lifeos:event',e=>{if(drag)return;const event=e.detail||{};if(['navigate','journal-open','journal-focus-enter','journal-focus-exit'].includes(event.type))requestAnimationFrame(()=>position());if(event.type==='pet-action'){if(event.detail?.slug&&event.detail.slug!==pet?.slug)return;return setState(event.detail?.state,1000)}const next=eventState[event.type];if(next)setState(next[0],next[1])});
  actions.subscribe((slug,action)=>{if(slug===pet?.slug&&!drag)setState(action||'idle')});
  window.addEventListener('lifeos:pet-motion',event=>{motion=event.detail?.enabled!==false;if(motion)position();else stop()});
  function applySize(){const el=$('#lifePetFloatSprite');if(!el)return;el.style.width=Math.round(spriteW*scale)+'px';el.style.height=Math.round(spriteH*scale)+'px';window.lifeosPetRenderers?.get(el)?.resize(spriteW*scale,spriteH*scale);loadedAsset='';paint();}
  window.addEventListener('lifeos:pet-settings',event=>{const settings=event.detail||{},previous=placement;placement=settings.mode||'in_app';scale=settings.scale||1;if(typeof settings.motion==='boolean'){motion=settings.motion;localStorage.setItem('lifeos.pet.motion',String(motion));}applySize();window.lifeosPetRenderers?.get($('#lifePetFloatSprite'))?.setSettings({...settings.vivi,scale:1});setVisible(settings.visible!==false);if(previous!==placement&&placement==='desktop')closeChat();});
  function bind(){mount();if(!drag)position()}
  window.addEventListener('lifeos:pets-changed',()=>refresh().catch(()=>{}));
  let installed=false;
  function install(){if(installed)return;installed=true;const prior=bindSpecific;bindSpecific=function(){prior();bind()};mount()}
  window.addEventListener('lifeos:i2-ready',()=>{installed=false;install()},{once:true});
  setTimeout(install,1300)
})();
