/* Companion placement belongs to its own room, separate from journal settings. */
(() => {
  'use strict';
  const bridge=window.lifeosDesktop,key='lifeos.pet.settings';
  let settings={mode:'in_app',keepOnClose:true,alwaysOnTop:true,scale:1,visible:true,motion:true,vivi:{dragAction:'fly',autoBehavior:true,edgeHide:true}},busy=false,incoming=false,currentPet=null,choices={};
  try{if(!bridge?.petGetSettings)settings={...settings,...JSON.parse(localStorage.getItem(key)||'{}')};}catch{}
  const $=selector=>document.querySelector(selector);
  function broadcast(){window.dispatchEvent(new CustomEvent('lifeos:pet-settings',{detail:{...settings}}));paint();}
  function paint(){
    const panel=$('#petSettingsPanel');if(!panel)return;
    panel.querySelectorAll('[data-pet-setting]').forEach(input=>{const name=input.dataset.petSetting;if(input.type==='checkbox')input.checked=!!settings[name];else input.value=String(settings[name]);input.disabled=busy||(input.dataset.native==='true'&&!bridge?.petSetSettings)||(name==='keepOnClose'&&settings.mode!=='desktop');});
    $('#petScaleValue').textContent=Math.round(settings.scale*100)+'%';
    if($('#petPageMotion')&&typeof settings.motion==='boolean')$('#petPageMotion').checked=settings.motion;
    const extra=$('#petExtraSettings');extra.hidden=currentPet?.renderer!=='vivi-gif';extra.querySelectorAll('[data-vivi-setting]').forEach(input=>{const value=settings.vivi?.[input.dataset.viviSetting];if(input.type==='checkbox')input.checked=value!==false;else input.value=value||'fly';input.disabled=busy;});
  }
  async function update(patch){
    if(busy)return;busy=true;paint();const previous={...settings};
    try{
      if(bridge?.petSetSettings){const result=await bridge.petSetSettings(patch);if(result.ok===false)throw Error(result.error||'设置未保存');settings=result.settings;}
      else {settings={...settings,...patch};localStorage.setItem(key,JSON.stringify(settings));}
      $('#petSettingsHint').textContent='';broadcast();
    }catch(error){settings=previous;if($('#petSettingsHint'))$('#petSettingsHint').textContent=error.message||'设置未保存';}
    finally{busy=false;paint();}
  }
  function mount(){
    const page=$('.petPage'),header=page?.querySelector('.petPageHero');if(!header||$('#petSettingsPanel'))return;
    header.insertAdjacentHTML('beforeend','<button id="petSettingsToggle" class="petSettingsToggle" type="button" aria-label="桌宠设置" title="桌宠设置" aria-expanded="false" aria-controls="petSettingsPanel">'+(typeof uiIcon==='function'?uiIcon('settings'):'⚙')+'</button>');
    header.insertAdjacentHTML('afterend',`<section id="petSettingsPanel" class="petSettingsPanel" aria-label="桌宠设置" hidden>
      <label class="petSettingRow"><span>显示位置</span><select data-pet-setting="mode" data-native="true" aria-label="桌宠显示位置"><option value="in_app">软件内</option><option value="desktop">桌面</option></select></label>
      <label class="petSettingRow"><span>显示桌宠</span><input type="checkbox" data-pet-setting="visible"></label>
      <label class="petSettingRow"><span>关闭窗口后保留</span><input type="checkbox" data-pet-setting="keepOnClose" data-native="true"></label>
      <label class="petSettingRow"><span>桌面置顶</span><input type="checkbox" data-pet-setting="alwaysOnTop" data-native="true"></label>
      <label class="petSettingRow petSettingScale"><span>大小 <output id="petScaleValue">100%</output></span><input type="range" min="0.6" max="1.8" step="0.1" data-pet-setting="scale" aria-label="桌宠大小"></label>
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
    $('#petSettingsPanel').onchange=event=>{const input=event.target.closest('[data-pet-setting]');if(input)update({[input.dataset.petSetting]:input.type==='checkbox'?input.checked:input.type==='range'?Number(input.value):input.value});const special=event.target.closest('[data-vivi-setting]');if(special)update({vivi:{...settings.vivi,[special.dataset.viviSetting]:special.type==='checkbox'?special.checked:special.value}});};
    $('#petSettingsPanel').oninput=event=>{if(event.target.dataset.petSetting==='scale')$('#petScaleValue').textContent=Math.round(Number(event.target.value)*100)+'%';};
    paint();window.dispatchEvent(new Event('lifeos:pet-settings-mounted'));
  }
  function restoreChoices(){incoming=true;for(const [slug,action] of Object.entries(choices))window.lifeosPetActions?.select(slug,action);incoming=false;}
  function absorb(result){if(result.settings){settings=result.settings;choices=result.choices||{};restoreChoices();broadcast();}}
  if(bridge?.onPetSettings)bridge.onPetSettings(absorb);
  if(bridge?.onPetAction)bridge.onPetAction(value=>{if(value.action===null)delete choices[value.slug];else choices[value.slug]=value.action;incoming=true;window.lifeosPetActions?.select(value.slug,value.action);incoming=false;});
  window.lifeosPetActions?.subscribe((slug,action)=>{if(!incoming)bridge?.petAction?.({slug,action}).catch(()=>{});});
  window.addEventListener('lifeos:pets-changed',()=>bridge?.petRefresh?.().catch(()=>{}));
  if(bridge?.onPetOpen)bridge.onPetOpen(async value=>{if(value.settings)window.dispatchEvent(new Event('lifeos:open-pet'));for(let i=0;i<80;i++){mount();if((!value.settings||$('#petSettingsPanel'))&&(!value.chat||$('#lifePetChat')))break;await new Promise(resolve=>setTimeout(resolve,100));}if(value.settings&&$('#petSettingsPanel')?.hidden)$('#petSettingsToggle')?.click();if(value.chat)window.dispatchEvent(new Event('lifeos:open-pet-chat'));});
  window.addEventListener('lifeos:pet-motion',event=>update({motion:event.detail?.enabled!==false}));
  const observe=new MutationObserver(mount);observe.observe(document.body,{childList:true,subtree:true});
  window.lifeosPetSettings={get:()=>({...settings}),update,restoreChoices};
  window.lifeosViViSettings={get:()=>({...settings.vivi})};
  window.addEventListener('lifeos:pet-current',event=>{currentPet=event.detail;paint();});
  if(bridge?.petGetSettings)bridge.petGetSettings().then(absorb).catch(()=>broadcast());else broadcast();
  mount();
})();
