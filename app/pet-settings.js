/* Companion placement belongs to its own room, separate from journal settings. */
(() => {
  'use strict';
  const bridge=window.lifeosDesktop,key='lifeos.pet.settings';
  let settings={mode:'in_app',keepOnClose:true,alwaysOnTop:true,scale:1,visible:true,motion:true,vivi:{dragAction:'fly',autoBehavior:true,edgeHide:true}},incoming=false,currentPet=null,choices={};
  try{if(!bridge?.petGetSettings)settings={...settings,...JSON.parse(localStorage.getItem(key)||'{}')};}catch{}
  let confirmed=settings,inFlight=null,pending=null,writeTask=null,scaleDraft=null,scaleTimer=null,previewFrame=null,lastBroadcast='',revision=0;
  const $=selector=>document.querySelector(selector);
  const merge=(base,patch)=>({...base,...patch,...(patch?.vivi?{vivi:{...base.vivi,...patch.vivi}}:{})});
  function reconcile(){settings=merge(merge(confirmed,inFlight||{}),pending||{});delete settings.commit;if(scaleDraft!==null)settings.scale=scaleDraft;}
  function broadcast(){const value=JSON.stringify(settings);if(value!==lastBroadcast){lastBroadcast=value;window.dispatchEvent(new CustomEvent('lifeos:pet-settings',{detail:{...settings}}));}paint();}
  function preview(){if(previewFrame===null)previewFrame=requestAnimationFrame(()=>{previewFrame=null;broadcast();});}
  function paint(){
    const panel=$('#petSettingsPanel');if(!panel)return;
    panel.querySelectorAll('[data-pet-setting]').forEach(input=>{const name=input.dataset.petSetting;if(input.type==='checkbox')input.checked=!!settings[name];else input.value=String(settings[name]);input.disabled=(input.dataset.native==='true'&&!bridge?.petSetSettings)||(name==='keepOnClose'&&settings.mode!=='desktop');});
    const slider=panel.querySelector('[data-pet-setting="scale"]');slider.style.setProperty('--pet-scale-progress',((settings.scale-.6)/1.2*100)+'%');slider.setAttribute('aria-valuetext',Math.round(settings.scale*100)+'%');
    $('#petScaleValue').textContent=Math.round(settings.scale*100)+'%';
    if($('#petPageMotion')&&typeof settings.motion==='boolean')$('#petPageMotion').checked=settings.motion;
    const extra=$('#petExtraSettings');extra.hidden=currentPet?.renderer!=='vivi-gif';extra.querySelectorAll('[data-vivi-setting]').forEach(input=>{const value=settings.vivi?.[input.dataset.viviSetting];if(input.type==='checkbox')input.checked=value!==false;else input.value=value||'fly';});
  }
  function update(patch){
    revision++;
    pending=merge(pending||{},patch);reconcile();broadcast();
    if(writeTask)return writeTask;
    writeTask=Promise.resolve().then(async()=>{
      try{
        while(pending){
          inFlight=pending;pending=null;
          try{
            if(bridge?.petSetSettings){const result=await bridge.petSetSettings(inFlight);if(result.ok===false)throw Error(result.error||'设置未保存');confirmed=result.settings;}
            else {const {commit,...value}=inFlight;confirmed=merge(confirmed,value);localStorage.setItem(key,JSON.stringify(confirmed));}
            if($('#petSettingsHint'))$('#petSettingsHint').textContent='';
          }catch(error){if($('#petSettingsHint'))$('#petSettingsHint').textContent=error.message||'设置未保存';}
          inFlight=null;reconcile();broadcast();
        }
      }finally{writeTask=null;}
    });
    return writeTask;
  }
  function previewScale(value){
    scaleDraft=Number(value);reconcile();preview();
    if(scaleTimer===null)scaleTimer=setTimeout(()=>{scaleTimer=null;if(scaleDraft!==null)update({scale:scaleDraft});},60);
  }
  function commitScale(){
    if(scaleDraft===null)return;
    const value=scaleDraft;scaleDraft=null;clearTimeout(scaleTimer);scaleTimer=null;
    return update({scale:value,commit:true});
  }
  function mount(){
    const page=$('.petPage'),header=page?.querySelector('.petPageHero');if(!header||$('#petSettingsPanel'))return;
    header.insertAdjacentHTML('beforeend','<button id="petSettingsToggle" class="petSettingsToggle" type="button" aria-label="桌宠设置" title="桌宠设置" aria-expanded="false" aria-controls="petSettingsPanel">'+(typeof uiIcon==='function'?uiIcon('settings'):'⚙')+'</button>');
    header.insertAdjacentHTML('afterend',`<section id="petSettingsPanel" class="petSettingsPanel" aria-label="桌宠设置" hidden>
      <label class="petSettingRow"><span>显示位置</span><select data-pet-setting="mode" data-native="true" aria-label="桌宠显示位置"><option value="in_app">软件内</option><option value="desktop">桌面</option></select></label>
      <label class="petSettingRow"><span>显示桌宠</span><input type="checkbox" data-pet-setting="visible"></label>
      <label class="petSettingRow"><span>关闭窗口后保留</span><input type="checkbox" data-pet-setting="keepOnClose" data-native="true"></label>
      <label class="petSettingRow"><span>桌面置顶</span><input type="checkbox" data-pet-setting="alwaysOnTop" data-native="true"></label>
      <label class="petSettingRow petSettingScale"><span>大小</span><span class="petScaleControl"><input type="range" min="0.6" max="1.8" step="0.01" data-pet-setting="scale" aria-label="桌宠大小"><output id="petScaleValue">100%</output></span></label>
      <div id="petMotionSetting" class="petSettingRow"></div><div id="petExtraSettings" hidden>
        <label class="petSettingRow"><span>ViVi 自动游走</span><input type="checkbox" data-vivi-setting="autoBehavior"></label>
        <label class="petSettingRow"><span>靠边藏起</span><input type="checkbox" data-vivi-setting="edgeHide"></label>
        <label class="petSettingRow"><span>拖动动作</span><select data-vivi-setting="dragAction" aria-label="ViVi 拖动动作"><option value="fly">飞起来</option><option value="interact">摸摸</option><option value="sweat">流汗</option><option value="jump">跳跃</option></select></label>
      </div>
      <p id="petSettingsHint" role="status">${bridge?.petSetSettings?'':'桌面模式需桌面客户端'}</p>
    </section>`);
    const motion=$('#petPageMotion')?.closest('label');if(motion){motion.classList.add('petSettingMotion');$('#petMotionSetting').append(motion);}
    $('#petFloatToggle')?.remove();
    $('#petSettingsToggle').onclick=()=>{const panel=$('#petSettingsPanel');panel.hidden=!panel.hidden;$('#petSettingsToggle').setAttribute('aria-expanded',String(!panel.hidden));};
    $('#petSettingsPanel').onchange=event=>{const input=event.target.closest('[data-pet-setting]');if(input){if(input.dataset.petSetting==='scale'){scaleDraft=Number(input.value);commitScale();}else update({[input.dataset.petSetting]:input.type==='checkbox'?input.checked:input.value});}const special=event.target.closest('[data-vivi-setting]');if(special)update({vivi:{[special.dataset.viviSetting]:special.type==='checkbox'?special.checked:special.value}});};
    $('#petSettingsPanel').oninput=event=>{if(event.target.dataset.petSetting==='scale')previewScale(event.target.value);};
    $('#petSettingsPanel').addEventListener('pointercancel',commitScale);
    $('#petSettingsPanel').addEventListener('focusout',commitScale);
    paint();window.dispatchEvent(new Event('lifeos:pet-settings-mounted'));
  }
  function restoreChoices(){/* Older clients persisted loops; one-shot commands are never restored. */}
  function absorb(result){if(result.settings){confirmed=result.settings;reconcile();choices=result.choices||{};restoreChoices();broadcast();}}
  if(bridge?.onPetSettings)bridge.onPetSettings(absorb);
  if(bridge?.onPetAction)bridge.onPetAction(value=>{incoming=true;if(value.completed)window.lifeosPetActions?.finish(value.slug,value.requestId);else window.lifeosPetActions?.select(value.slug,value.action,{requestId:value.requestId});incoming=false;});
  window.lifeosPetActions?.subscribe((slug,action,meta)=>{
    if(incoming||(meta?.completed&&settings.mode!=='in_app'))return;
    bridge?.petAction?.({slug,action,requestId:meta?.requestId,...(meta?.completed?{completed:true}:{})}).catch(()=>{});
  });
  window.addEventListener('lifeos:pets-changed',()=>bridge?.petRefresh?.().catch(()=>{}));
  if(bridge?.onPetOpen)bridge.onPetOpen(async value=>{if(value.settings)window.dispatchEvent(new Event('lifeos:open-pet'));for(let i=0;i<80;i++){mount();if((!value.settings||$('#petSettingsPanel'))&&(!value.chat||$('#lifePetChat')))break;await new Promise(resolve=>setTimeout(resolve,100));}if(value.settings&&$('#petSettingsPanel')?.hidden)$('#petSettingsToggle')?.click();if(value.chat)window.dispatchEvent(new Event('lifeos:open-pet-chat'));});
  window.addEventListener('lifeos:pet-motion',event=>update({motion:event.detail?.enabled!==false}));
  const observe=new MutationObserver(mount);observe.observe(document.body,{childList:true,subtree:true});
  window.lifeosPetSettings={get:()=>({...settings}),update,restoreChoices};
  window.lifeosViViSettings={get:()=>({...settings.vivi})};
  window.addEventListener('pagehide',commitScale);
  window.addEventListener('lifeos:pet-current',event=>{currentPet=event.detail;paint();});
  if(bridge?.petGetSettings){const requestedRevision=revision;bridge.petGetSettings().then(result=>{if(revision===requestedRevision)absorb(result);}).catch(()=>broadcast());}else broadcast();
  mount();
})();
