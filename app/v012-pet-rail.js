/* LifeOS Pet Shelf — compact browsing, each character keeps its own action. */
(() => {
  'use strict';
  const FEATURE='Pet Shelf',ROWS={idle:0,'running-right':1,'running-left':2,waving:3,jumping:4,failed:5,waiting:6,running:7,review:8};
  const actions=window.lifeosPetActions,columnsKey='lifeos.pet.columns',previews=new Map(),actionFrames=new Map();
  DREAM_META[FEATURE]=['灵犀',''];
  let savedColumns;try{savedColumns=Number(localStorage.getItem(columnsKey))}catch{}
  const pet={catalog:[],installed:[],active:'',state:'idle',frame:0,motion:localStorage.getItem('lifeos.pet.motion')!=='false',query:'',category:'all',limit:48,timer:null,columns:[1,2,4].includes(savedColumns)?savedColumns:2};
  const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>[...r.querySelectorAll(s)];
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const get=async path=>{const r=await fetch(path,{cache:'no-store'}),d=await r.json();if(!r.ok)throw new Error(d.error||'桌宠服务暂不可用');return d};
  const send=async(path,body)=>{const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),d=await r.json();if(!r.ok)throw new Error(d.error||'操作未完成');return d};
  const current=()=>pet.installed.find(x=>x.slug===pet.active)||pet.installed[0]||null;
  const resource=slug=>pet.installed.find(x=>x.slug===slug)||previews.get(slug);
  const selectedState=item=>actions.selected(item?.slug)||(item?.slug===pet.active?pet.state:'idle');
  const mood=()=>({idle:'安静地陪在这里','running-right':'向右跑起来','running-left':'向左跑起来',waving:'向你挥挥手',jumping:'呀，跳一下',failed:'刚才没有做好，缓一缓',waiting:'在这里等你',running:'正在专心忙碌',review:'我也在读这一页'})[selectedState(current())]||'我在这里';
  function preloadSprites(items){return Promise.all(items.map(async(item,index)=>{items[index]=await (window.lifeosPetRenderers?.prepare(item)||window.lifeosPetSprites.prepare(item))}))}
  function configureSprite(el,item,rows){const key=`${item.asset_url}|${rows}`;if(el.dataset.spriteAsset===key)return;if(el.textContent)el.textContent='';el.style.backgroundImage=`url("${item.asset_url}")`;el.style.backgroundSize=`800% ${rows*100}%`;el.dataset.spriteAsset=key}
  function paint(el,item=current()){
    if(!el)return;if(!item){el.textContent='✦';el.style.backgroundImage='';return}
    if(item.renderer==='vivi-gif'){window.lifeosPetRenderers.paint(el,item,{mode:'preview',motion:pet.motion});return;}window.lifeosPetRenderers?.release(el);
    const count=Number(item.spriteVersionNumber)===2?11:9,state=selectedState(item),requested=ROWS[state]??0,row=item.frame_map?.[requested]?.length===0?Math.max(0,item.frame_map.findIndex(cells=>cells.length)):requested,cells=item.frame_map?.[row]?.length?item.frame_map[row]:[0,1,2,3,4,5,6,7],frame=Math.max(0,pet.frame-(actionFrames.get(item.slug)||0)),column=cells[frame%cells.length];
    configureSprite(el,item,count);el.style.backgroundPosition=`${column/7*100}% ${row/Math.max(1,count-1)*100}%`;el.dataset.petAction=state;
  }
  function paintAll(){paint($('#petPageSprite'));$$('[data-pet-mini]').forEach(el=>paint(el,resource(el.dataset.petMini)));$$('[data-pet-catalog-mini]').forEach(el=>paint(el,resource(el.dataset.petCatalogMini)));const out=$('#petPageMood');if(out)out.textContent=mood()}
  function setState(next,{broadcast=true}={}){
    pet.state=ROWS[next]===undefined?'idle':next;pet.frame=0;actionFrames.clear();paintAll();
    if(broadcast){const detail={type:'pet-action',detail:{state:pet.state,slug:pet.active}};window.dispatchEvent(new CustomEvent('lifeos:event',{detail}));}
  }
  function runFrames(){clearTimeout(pet.timer);const tick=()=>{if(STATE.feature!==FEATURE){pet.timer=null;return}if(pet.motion&&!document.hidden){pet.frame+=1;paintAll()}pet.timer=setTimeout(tick,pet.state==='waiting'?240:155)};pet.timer=setTimeout(tick,pet.state==='waiting'?240:155)}
  function absorb(data){pet.catalog=data.catalog||[];pet.installed=data.installed||[];pet.active=data.active_slug||pet.installed[0]?.slug||'';pet.catalog.filter(item=>item.renderer==='vivi-gif').forEach(item=>actions.register(item.slug,item.actions.map(action=>[action.id,action.label])));}
  const targetAttrs=(item)=>`data-pet-target="${esc(item.slug)}" tabindex="0" role="button" aria-haspopup="menu" aria-label="${esc(item.localized_names?.zh||item.name||item.slug)}，选择动作" title="右键选择动作"`;
  function installedHTML(){return pet.installed.map(item=>`<article class="petPageInstalled ${item.slug===pet.active?'active':''}"><span class="petPageMini" data-pet-mini="${esc(item.slug)}" ${targetAttrs(item)}></span><div><b>${esc(item.name)}</b><small>${esc(item.author)} · ${esc(item.license)}</small></div><div><button data-pet-activate="${esc(item.slug)}" type="button">${item.slug===pet.active?'正在陪伴':'使用'}</button><button class="quiet" data-pet-uninstall="${esc(item.slug)}" type="button">移除</button></div></article>`).join('')||'<p class="petPageEmpty">还没有可用桌宠</p>'}
  function catalogHTML(){
    const q=pet.query.trim().toLowerCase(),categories=[...new Set(pet.catalog.map(x=>x.primary_category).filter(Boolean))].sort();
    if(pet.category!=='all'&&!categories.includes(pet.category))pet.category='all';
    const filtered=pet.catalog.filter(x=>{const hay=[x.name,x.localized_names?.zh,x.author,x.primary_category,x.description].join(' ').toLowerCase();return(!q||hay.includes(q))&&(pet.category==='all'||x.primary_category===pet.category)}),select=$('#petPageCategory');
    if(select){select.innerHTML=`<option value="all">所有分类 · ${pet.catalog.length}</option>${categories.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join('')}`;select.value=pet.category}
    const count=$('#petPageCount');if(count)count.textContent=`${Math.min(filtered.length,pet.limit)} / ${filtered.length}`;
    const cards=filtered.slice(0,pet.limit).map(item=>{
      const local=pet.installed.find(x=>x.slug===item.slug),sprite=resource(item.slug),preview=!sprite&&item.preview_url?`<img class="petPagePreview" src="${esc(item.preview_url)}" alt="" loading="lazy">`:`<span class="petPagePreview petPagePreviewSprite" data-pet-catalog-mini="${esc(item.slug)}" aria-hidden="true"></span>`;
      return `<article class="petPageCard"><figure ${targetAttrs(item)}>${preview}</figure><div><span>${esc(item.primary_category||'Community')}</span><h3>${esc(item.localized_names?.zh||item.name||item.slug)}</h3><p>${esc(item.description||`${item.author||'Community'} 的桌宠`)}</p><small>${esc(item.author||'community')} · ${esc(item.license||'see upstream')}</small></div>${local?`<button data-pet-activate="${esc(item.slug)}" type="button">${item.slug===pet.active?'正在使用':'使用'}</button>`:`<button data-pet-install="${esc(item.slug)}" type="button">下载到本机</button>`}</article>`;
    }).join('')||'<p class="petPageEmpty">没有符合的桌宠</p>';
    return cards+(filtered.length>pet.limit?'<button class="petPageMore" data-pet-more type="button">加载更多</button>':'');
  }
  function paintCatalog(){
    $('#petPageCatalog').innerHTML=catalogHTML();
    $$('#petPageCatalog img').forEach(image=>{
      const failed=()=>{const figure=image.closest('figure');if(!figure||figure.querySelector('.petPreviewFallback'))return;image.hidden=true;figure.classList.add('previewUnavailable');const fallback=document.createElement('span');fallback.className='petPreviewFallback';fallback.setAttribute('aria-hidden','true');fallback.innerHTML=typeof uiIcon==='function'?uiIcon('cat'):'✦';figure.append(fallback);};
      image.addEventListener('error',failed,{once:true});if(image.complete&&!image.naturalWidth)failed();
    });paintAll();
  }
  function refreshPieces(){const now=current(),hero=$('#petPageSprite');$('#petPageName').textContent=now?.name||'还没有桌宠';$('#petPageByline').textContent=now?`${now.author} · ${now.license}`:'打开宠物库下载';if(now){hero.dataset.petTarget=now.slug;hero.setAttribute?.('aria-label',`${now.name}，选择动作`)}else{hero.removeAttribute?.('data-pet-target');window.lifeosPetRenderers?.release(hero);}$('#petPageInstalled').innerHTML=installedHTML();paintCatalog();window.dispatchEvent(new CustomEvent('lifeos:pet-current',{detail:now}));}
  async function refresh(){const data=await get('/api/pets/catalog');await preloadSprites(data.installed||[]);absorb(data);if(STATE.feature===FEATURE)refreshPieces();window.dispatchEvent(new Event('lifeos:pets-changed'))}
  function columnsIcon(count){const width=count===1?14:count===2?6:2.5,gap=count===1?0:count===2?2:1.4,start=5;return `<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.35" aria-hidden="true">${Array.from({length:count},(_,i)=>`<rect x="${start+i*(width+gap)}" y="5" width="${width}" height="14" rx=".4"/>`).join('')}</svg>`}
  async function renderPetPage(){
    const data=await get('/api/pets/catalog');await preloadSprites(data.installed||[]);absorb(data);const now=current();
    return pageWrap(`<section class="petPage" data-columns="${pet.columns}" aria-labelledby="petPageTitle">
      <header class="petPageHero"><h1 id="petPageTitle">灵犀</h1></header>
      <section class="petPageControl">
        <div class="petPageHeroPet"><span id="petPageSprite" class="petPageSprite" ${now?targetAttrs(now):'aria-hidden="true"'}></span><b id="petPageName">${esc(now?.name||'还没有桌宠')}</b><small id="petPageByline">${esc(now?`${now.author} · ${now.license}`:'打开宠物库下载')}</small></div>
        <div class="petPageControlBody"><p id="petPageMood" role="status">${esc(mood())}</p><div class="petPageButtons"><button id="petPageSurprise" type="button">一起随机翻页</button><label><input id="petPageMotion" type="checkbox" ${pet.motion?'checked':''}> 播放动效</label></div></div>
      </section>
      <section class="petPageSection"><div class="petPageSectionHead"><h2>已安装</h2></div><div id="petPageInstalled">${installedHTML()}</div></section>
      <section class="petPageLibrary"><header><h2>宠物库</h2><div class="petPageLibraryTools"><div class="petPageColumns" role="group" aria-label="宠物库列数">${[1,2,4].map(count=>`<button data-pet-columns="${count}" type="button" aria-label="${count} 列展示" title="${count} 列展示" aria-pressed="${count===pet.columns}">${columnsIcon(count)}</button>`).join('')}</div><button id="petPageRefresh" type="button" aria-live="polite">更新目录</button></div></header><div class="petPageFilters"><input id="petPageSearch" placeholder="搜索名称、作者或主题"><select id="petPageCategory"></select></div><small id="petPageCount" role="status"></small><div id="petPageCatalog"></div></section>
    </section>`)
  }
  function openPage(){try{saveCurrentJournalProgress();setJournalFocus(false,{silent:true});closeMobileMore()}catch(_){}STATE.room='NOW';STATE.feature=FEATURE;STATE.sourceOrigin=null;rememberContext();lifeEvent('navigate',{feature:FEATURE,title:'灵犀'});syncHistory('push');render()}
  function openActions(anchor,event){
    const slug=anchor.dataset.petTarget,item=pet.installed.find(x=>x.slug===slug)||pet.catalog.find(x=>x.slug===slug);if(!item)return;
    actions.open({slug,anchor,name:item.localized_names?.zh||item.name,x:event?.clientX,y:event?.clientY,frameMap:resource(slug)?.frame_map,
      chat:slug===pet.active?()=>window.dispatchEvent(new Event('lifeos:open-pet-chat')):null,
      prepare:async action=>{
        if(action===null||resource(slug))return;
        if(item.renderer==='vivi-gif'){previews.set(slug,await window.lifeosPetRenderers.prepare(item));anchor.innerHTML=`<span class="petPagePreview petPagePreviewSprite" data-pet-catalog-mini="${esc(slug)}" aria-hidden="true"></span>`;return;}
        anchor.setAttribute('aria-busy','true');
        try{
          const prepared=await window.lifeosPetSprites.prepare({...item,asset_url:`https://raw.githubusercontent.com/legeling/awesome-codex-pet/main/pets/${encodeURIComponent(slug)}/spritesheet.webp`});
          if(prepared.frame_map?.[ROWS[action]]?.length===0)throw new Error('这个桌宠没有此动作');
          previews.set(slug,prepared);
          if(anchor.isConnected){anchor.innerHTML=`<span class="petPagePreview petPagePreviewSprite" data-pet-catalog-mini="${esc(slug)}" aria-hidden="true"></span>`;}
        }catch(error){throw new Error(error.message==='这个桌宠没有此动作'?error.message:'动作未加载，请检查网络后重试')}
        finally{anchor.removeAttribute('aria-busy');}
      }});
  }
  function bindPetPage(){
    if(STATE.feature!==FEATURE)return;refreshPieces();setState(pet.state,{broadcast:false});runFrames();
    $('#petPageSurprise').onclick=()=>{$('#surpriseRail')?.click();setState('running')};
    $('#petPageMotion').onchange=e=>{pet.motion=e.target.checked;localStorage.setItem('lifeos.pet.motion',String(pet.motion));window.dispatchEvent(new CustomEvent('lifeos:pet-motion',{detail:{enabled:pet.motion}}));runFrames()};
    $('#petPageSearch').oninput=e=>{actions.close();pet.query=e.target.value;pet.limit=48;paintCatalog()};
    $('#petPageCategory').onchange=e=>{actions.close();pet.category=e.target.value;pet.limit=48;paintCatalog()};
    $('#petPageRefresh').onclick=async e=>{
      const button=e.currentTarget;button.disabled=true;button.textContent='更新中…';
      try{const data=await get('/api/pets/catalog?refresh=1');await preloadSprites(data.installed||[]);absorb(data);if(STATE.feature===FEATURE){refreshPieces();button.textContent='已更新';button.title=''}}
      catch(error){button.textContent='更新失败 · 重试';button.title=error.message;}
      finally{button.disabled=false;}
    };
    const page=$('.petPage');
    page.oncontextmenu=e=>{const anchor=e.target.closest('[data-pet-target]');if(anchor){e.preventDefault();openActions(anchor,e)}};
    page.onkeydown=e=>{const anchor=e.target.closest('[data-pet-target]');if(anchor&&(e.key==='ContextMenu'||(e.shiftKey&&e.key==='F10')||e.key==='Enter'||e.key===' ')){e.preventDefault();openActions(anchor)}};
    let hold=null;
    page.onpointerdown=e=>{if(e.pointerType!=='touch')return;const anchor=e.target.closest('[data-pet-target]');if(!anchor)return;hold={x:e.clientX,y:e.clientY,timer:setTimeout(()=>{openActions(anchor);hold=null},520)}};
    const cancelHold=()=>{if(hold)clearTimeout(hold.timer);hold=null};
    page.onpointermove=e=>{if(hold&&Math.hypot(e.clientX-hold.x,e.clientY-hold.y)>8)cancelHold()};page.onpointerup=cancelHold;page.onpointercancel=cancelHold;
    page.onclick=async e=>{
      const button=e.target.closest('button');if(!button)return;
      if(button.dataset.petColumns){pet.columns=Number(button.dataset.petColumns);page.dataset.columns=String(pet.columns);$$('[data-pet-columns]').forEach(el=>el.setAttribute('aria-pressed',String(Number(el.dataset.petColumns)===pet.columns)));try{localStorage.setItem(columnsKey,String(pet.columns))}catch{}return;}
      if(button.hasAttribute('data-pet-more')){const previous=pet.limit;pet.limit+=48;paintCatalog();$$('.petPageCard button')[previous]?.focus({preventScroll:true});return;}
      const install=button.dataset.petInstall,activate=button.dataset.petActivate,remove=button.dataset.petUninstall;
      try{
        if(install){button.disabled=true;button.textContent='下载中…';await send('/api/pets/install',{slug:install});await refresh();if(STATE.feature===FEATURE)setState('jumping')}
        if(activate){await send('/api/pets/activate',{slug:activate});await refresh();if(STATE.feature===FEATURE)setState('jumping')}
        if(remove&&confirm('移除这个桌宠？')){await send('/api/pets/uninstall',{slug:remove});actions.select(remove,null);await refresh()}
      }catch(error){button.disabled=false;if(install)button.textContent='下载到本机';alert(error.message)}
    };
  }
  actions.subscribe((slug)=>{actionFrames.set(slug,pet.frame);if(STATE.feature===FEATURE)paintAll()});
  window.addEventListener('lifeos:pet-settings',event=>{if(typeof event.detail?.motion==='boolean'){pet.motion=event.detail.motion;runFrames();}});
  let installed=false;
  function install(){if(installed)return;installed=true;RENDERERS[FEATURE]=renderPetPage;const prior=bindSpecific;bindSpecific=function(){prior();bindPetPage()}}
  window.addEventListener('lifeos:open-pet',openPage);
  window.addEventListener('lifeos:i2-ready',()=>{installed=false;install()},{once:true});
  install();setTimeout(install,1050);
})();
