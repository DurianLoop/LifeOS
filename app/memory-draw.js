/* A local encounter with an old page; the coloured bookmark belongs to the UI. */
(() => {
  'use strict';
  const NAME='Serendipity',KEY='lifeos.memory.draw.v1',MAX_MARKS=5000;
  const get=id=>document.getElementById(id),escape=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const copy=(zh,en)=>window.lifeosNavLanguage?.()==='en'?en:window.lifeosNavLanguage?.()==='bilingual'?`${zh} / ${en}`:zh;
  const safePath=value=>typeof value==='string'&&value.length<1024&&!/^(?:[a-z]:|\/)|[\0\r\n]/i.test(value)&&!value.replace(/\\/g,'/').split('/').includes('..')&&/\.md$/i.test(value);
  function read(){try{const data=JSON.parse(localStorage.getItem(KEY)||'null');return {paths:new Set(Array.isArray(data?.paths)?data.paths.filter(safePath):[]),recent:Array.isArray(data?.recent)?data.recent.filter(id=>typeof id==='string'&&id.length<=160).slice(-120):[]}}catch{return null}}
  let stored=read()||{paths:new Set(),recent:[]},sequence=0,starId=0,observer=null,frame=0;
  const state={mode:'memory',result:null,results:new Map(),busy:false,controller:null,error:'',returnPath:null};
  function star(){const id='memory-spectrum-'+(++starId);return `<svg class="memoryStar" viewBox="0 0 24 24" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#5687ef"/><stop offset=".34" stop-color="#9771dd"/><stop offset=".68" stop-color="#da88a4"/><stop offset="1" stop-color="#dfb369"/></linearGradient></defs><path fill="url(#${id})" d="M12 1.5C10.7 8.6 8.6 10.7 1.5 12c7.1 1.3 9.2 3.4 10.5 10.5 1.3-7.1 3.4-9.2 10.5-10.5-7.1-1.3-9.2-3.4-10.5-10.5Z"/></svg>`}
  function refreshStored(){const latest=read();if(!latest){toast(copy('本机记录暂时无法读取，请重试','Local records could not be read. Please retry'));return false}stored=latest;return true}
  function save(paths=stored.paths,recent=stored.recent){const next={paths:new Set(paths),recent:recent.slice(-120)};try{localStorage.setItem(KEY,JSON.stringify({version:1,paths:[...next.paths],recent:next.recent}));stored=next;return true}catch{toast(copy('本机记录未能保存，请重试','Local records could not be saved. Please retry'));return false}}
  function mark(path,value){if(!safePath(path)||!refreshStored())return false;const next=new Set(stored.paths);if(value&&!next.has(path)&&next.size>=MAX_MARKS){toast(copy('彩笺已满，请先取消一些标记','Bookmarks are full. Remove a few to add more'));return false}value?next.add(path):next.delete(path);if(!save(next))return false;decorate();return true}
  const sources=result=>(result?.sources||[]).filter(item=>safePath(item?.source_path));
  function sourceCard(source){const marked=stored.paths.has(source.source_path);return `<article class="memoryDrawSource${marked?' is-marked':''}"><div class="memoryDrawSourceHead"><time>${escape(source.date||'')}</time><span>${escape(source.kind==='weekly'?copy('周记','Weekly'):copy('日记','Journal'))}</span></div><h2>${escape(source.title||source.date||copy('一页往事','An old page'))}</h2><p class="memoryDrawExcerpt">${escape(source.excerpt||copy('展开这一页，读完那天的故事','Open the page to read the rest'))}</p><footer><button type="button" class="memoryOpenSource" data-memory-open="${escape(source.source_path)}">${escape(copy('展开原页','Open page'))}<span aria-hidden="true">→</span></button>${marked?`<span class="memorySourceMark">${star()}${escape(copy('已留彩笺','Bookmarked'))}</span>`:''}</footer></article>`}
  function resultMarkup(){
    const result=state.result;
    if(!result)return `<div class="memoryDrawInvitation"><div class="memoryDrawOrbit" aria-hidden="true">${star()}<i></i><i></i><i></i></div><h2>${escape(copy('与某一日，重新相逢','Meet an old day again'))}</h2><p>${escape(copy('抽一签，让一页往事来到眼前','Draw a memory and see which page finds you'))}</p></div>`;
    const pages=sources(result);
    if(!pages.length)return `<div class="memoryDrawEmpty">${star()}<h2>${escape(copy(state.mode==='echo'?'旧页尚未成双':'这里还没有落下往事',state.mode==='echo'?'No paired echoes yet':'Your first page is still ahead'))}</h2><p>${escape(result.empty_reason||copy('写一页，或把以前的日记带进来','Write a page, or import your journals'))}</p><div>${state.mode==='echo'?`<button type="button" data-memory-mode="memory">${escape(copy('先抽一页','Draw one page'))}</button>`:`<button type="button" data-memory-write>${escape(copy('落笔','Write'))}</button><button type="button" data-memory-import>${escape(copy('导入日记','Import journals'))}</button>`}</div></div>`;
    const item=result.item||{},heading=result.type==='echo'?copy('两页之间，藏着同一句回声','Two pages, one echo'):result.type==='card'?(item.title||copy('一条旧日线索','An old thread')):copy('这一签，落在这一天','This draw found a day');
    const terms=result.type==='echo'?(item.shared_terms||[]).slice(0,6):[];
    return `<div class="memoryDrawReveal"><div class="memoryDrawResultHead"><span>${star()}${escape(heading)}</span>${result.repeated?`<small>${escape(copy('这一轮已翻完，重新相逢','A new round begins'))}</small>`:''}</div>${terms.length?`<div class="memoryDrawTerms">${terms.map(term=>`<span>${escape(term)}</span>`).join('')}</div>`:''}${result.type==='card'&&item.body?`<p class="memoryDrawClue">${escape(item.body)}</p>`:''}<div class="memoryDrawPages${pages.length>1?' is-paired':''}">${pages.map(sourceCard).join('')}</div></div>`;
  }
  function render(){return pageWrap(`<section class="memoryDrawPage" aria-labelledby="memoryDrawTitle"><header class="memoryDrawHeader"><h1 id="memoryDrawTitle">${escape(copy('记忆抽签机','Memory draw'))}</h1><button type="button" id="memoryDrawRun" class="memoryDrawRun"${state.busy?' disabled':''}>${star()}<span>${escape(state.busy?copy('寻一页','Finding a page'):state.result?copy('再抽一签','Draw again'):copy('抽一签','Draw a memory'))}</span></button></header><nav class="memoryDrawModes" aria-label="${escape(copy('抽签方式','Draw mode'))}">${[['memory',copy('旧页','Pages')],['echo',copy('回声','Echoes')],['mixed',copy('线索','Threads')]].map(([id,label])=>`<button type="button" data-memory-mode="${id}" aria-pressed="${state.mode===id}">${escape(label)}</button>`).join('')}</nav><div class="memoryDrawStage" id="memoryDrawStage" aria-busy="${state.busy}">${resultMarkup()}</div><footer class="memoryDrawFoot"><span id="memoryDrawFeedback" role="status" aria-live="polite">${escape(state.error)}</span><span id="memoryDrawMarkCount">${stored.paths.size?escape(copy(`${stored.paths.size} 页彩笺`,`${stored.paths.size} bookmarked pages`)):''}</span></footer></section>`)}
  function paint(){const stage=get('memoryDrawStage');if(!stage||STATE.feature!==NAME)return;stage.innerHTML=resultMarkup();stage.setAttribute('aria-busy',String(state.busy));const button=get('memoryDrawRun');if(button){button.disabled=state.busy;button.querySelector('span').textContent=state.busy?copy('寻一页','Finding a page'):state.result?copy('再抽一签','Draw again'):copy('抽一签','Draw a memory')}get('memoryDrawFeedback').textContent=state.error;get('memoryDrawMarkCount').textContent=stored.paths.size?copy(`${stored.paths.size} 页彩笺`,`${stored.paths.size} bookmarked pages`):'';document.querySelectorAll('[data-memory-mode]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.memoryMode===state.mode)))}
  async function draw(){
    if(state.busy||STATE.feature!==NAME)return false;
    const current=++sequence,stage=get('memoryDrawStage'),mode=state.mode;state.busy=true;state.error='';state.controller=new AbortController();paint();
    try{const params=new URLSearchParams({mode,exclude:JSON.stringify(stored.recent)}),data=await api('/api/serendipity?'+params,{noCache:true,signal:state.controller.signal});if(current!==sequence||STATE.feature!==NAME||!stage?.isConnected)return false;state.result=data;state.results.set(mode,data);if(data.draw_id&&refreshStored()){const prefix=data.draw_id.split(':')[0]+':',previous=data.repeated?stored.recent.filter(id=>!id.startsWith(prefix)):stored.recent;const recent=[...previous.filter(id=>id!==data.draw_id),data.draw_id].slice(-120);save(stored.paths,recent)}return Boolean(sources(data).length)}
    catch(error){if(current===sequence&&error.name!=='AbortError')state.error=copy('这一签暂时未能打开，再试一次','This draw could not open. Please retry');return false}
    finally{if(current===sequence){state.busy=false;state.controller=null;paint()}}
  }
  async function open(path,button){
    if(!safePath(path)||button.disabled)return;button.disabled=true;button.setAttribute('aria-busy','true');
    try{await openJournal(path);const volume=document.querySelector('.i2JournalVolume');if(volume?.dataset.path===path){state.returnPath=path;mark(path,true);decorate()}else throw Error('Page unavailable')}
    catch{toast(copy('这一页暂时无法打开，请重试','This page could not open. Please retry'))}
    finally{if(button.isConnected){button.disabled=false;button.setAttribute('aria-busy','false')}}
  }
  function decorate(){
    const volume=document.querySelector('.i2JournalVolume');if(!volume)return;
    const path=volume.dataset.path,marked=stored.paths.has(path),paper=volume.querySelector('.jbReadingPage'),head=volume.querySelector('.jbReadingHead');
    paper?.classList.toggle('memoryMarked',marked);let control=head?.querySelector('.memoryMarkToggle');
    if(marked&&head&&!control){control=document.createElement('button');control.type='button';control.className='memoryMarkToggle';head.append(control)}
    if(control){if(!marked)control.remove();else{const label=copy('取消彩笺','Remove bookmark');if(control.title!==label){control.title=label;control.setAttribute('aria-label',label);control.innerHTML=`${star()}<span>${escape(copy('彩笺','Encounter'))}</span>`}control.onclick=()=>{mark(path,false);paint()}}}
    volume.querySelectorAll('[data-i2-journal-page]').forEach(button=>button.classList.toggle('memoryMarked',stored.paths.has(button.dataset.i2JournalPage)));
    let back=volume.querySelector('.memoryBackDraw');const fromDraw=state.returnPath===path;
    if(fromDraw&&!back){back=document.createElement('button');back.type='button';back.className='jbQuietButton memoryBackDraw';volume.querySelector('.jbToolbarActions')?.prepend(back)}
    if(back){if(!fromDraw)back.remove();else{const label=copy('返回抽签','Back to draw');if(back.textContent!==label)back.textContent=label;back.onclick=()=>openFeature(NAME)}}
  }
  function inspect(){frame=0;if(state.controller&&STATE.feature!==NAME){sequence++;state.controller.abort();state.controller=null;state.busy=false}decorate()}
  document.addEventListener('click',event=>{const button=event.target.closest('button');if(!button)return;if(button.id==='memoryDrawRun')void draw();else if(button.dataset.memoryMode){state.controller?.abort();sequence++;state.controller=null;state.busy=false;state.mode=button.dataset.memoryMode;state.result=state.results.get(state.mode)||null;state.error='';paint()}else if(button.dataset.memoryOpen)void open(button.dataset.memoryOpen,button);else if(button.hasAttribute('data-memory-write'))openProductDock('writer',{date:localDateISO()});else if(button.hasAttribute('data-memory-import'))openProductDock('import',{openedFrom:'memory-draw'})});
  function install(){RENDERERS[NAME]=render;window.runSerendipity=draw;if(!observer&&get('view')){observer=new MutationObserver(()=>{if(!frame)frame=requestAnimationFrame(inspect)});observer.observe(get('view'),{childList:true,subtree:true})}decorate()}
  window.addEventListener('storage',event=>{if(event.key===KEY||event.key===null){const latest=read();if(latest)stored=latest;decorate();paint()}});
  window.addEventListener('lifeos:i2-ready',install);window.addEventListener('lifeos:v01-ready',install);install();
  window.lifeosMemoryDraw={render,draw,marks:()=>[...stored.paths],mark,decorate};
})();
