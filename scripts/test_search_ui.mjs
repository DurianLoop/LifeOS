import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source=readFileSync(new URL('../app/v012.js',import.meta.url),'utf8');
const searchCode=source.slice(source.indexOf('  function highlight('),source.indexOf('  openJournal=async function('));
const journalCode=source.slice(source.indexOf('  openJournal=async function('),source.indexOf('  openProductDock=async function('));
const installCode=source.slice(source.indexOf('  function installI2Surface(){'),source.indexOf('  window.lifeosRegisterPetFeature='));
const defaultState={searchQ:'',searchKind:'all',searchYear:'',searchSection:'',searchSort:'relevance'};
const sessionKey='lifeos.i2.search';
const clone=value=>JSON.parse(JSON.stringify(value));
const settle=()=>new Promise(setImmediate);
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject};}
const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

function fixture({rejectAborted=false,state={}}={}){
  const nodes=new Map(),timers=new Map(),storage=new Map(),calls=[],scrolls=[],openings=[];
  let nextTimer=0,legacyBindings=0,activeElement=null;
  const context={I2:{search:null,journalSequence:0},STATE:{feature:'Universal Search',...defaultState,...state},PRODUCT:{tab:'none'},
    RENDERERS:{},SECTIONS:['日记','自我探索'],copy:()=>({searchTitle:'Search',searchPlaceholder:'Search your words'}),
    esc:escape,c:zh=>zh,sectionName:value=>value,pageWrap:value=>value,updateLanguageControl(){},syncHistory(){},
    renderProductWriter(){},renderWriterExpanded(){},renderJournalI2(){},renderProductTab:async()=>{},bindSpecific(){},buildRail(){},
    setTimeout(fn,ms){timers.set(++nextTimer,{fn,ms});return nextTimer},clearTimeout:id=>timers.delete(id),AbortController,
    CSS:{escape:value=>value},Event:class{},
    sessionStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},
    api(url,options){const task=deferred();calls.push({url,options,...task});if(rejectAborted)options.signal.addEventListener('abort',()=>task.reject(Object.assign(new Error('aborted'),{name:'AbortError'})),{once:true});return task.promise},
    document:{querySelector:selector=>nodes.get(selector)??null,body:{classList:{contains:()=>false,toggle(){}}}},
    $:selector=>nodes.get(selector)??null,$$:()=>[]};
  const scroller={scrollTop:240,scrollTo(options){scrolls.push(clone(options));this.scrollTop=options.top}};
  context.window={scrollY:0,lifeosPageScroller:()=>scroller,dispatchEvent(){}};
  function element(id){
    let html='',results=[];
    const node={id,value:'',hidden:false,isConnected:true,dataset:{},attributes:new Map(),writes:[],
      setAttribute(name,value){this.attributes.set(name,value)},focus(){activeElement=this},addEventListener(){},
      querySelectorAll:selector=>selector==='[data-i2-source]'?results:[],
      querySelector:selector=>results.find(item=>selector.includes('"'+item.dataset.i2Source+'"'))||null};
    Object.defineProperty(node,'innerHTML',{get:()=>html,set(value){html=value;node.writes.push(value);results=[];
      if(id==='i2SearchResults')for(const match of value.matchAll(/<(article|button)\b[^>]*data-i2-source="([^"]+)"/g)){
        const child=element('result-'+results.length);child.dataset.i2Source=match[2];results.push(child);
      }
    }});
    return node;
  }
  function unmount(){for(const node of nodes.values())node.isConnected=false;nodes.clear()}
  function mount(){
    unmount();
    for(const id of ['searchQ','searchKind','searchYear','searchSection','searchSort','searchClear','searchFilterToggle','i2Filters','i2SearchResults'])nodes.set('#'+id,element(id));
    nodes.get('#i2Filters').hidden=true;
  }
  context.render=async()=>{if(context.STATE.feature==='Universal Search')mount();else unmount();context.bindSpecific()};
  context.openJournal=async path=>{openings.push(path);context.STATE.feature='Journal';context.STATE.journalPath=path;await context.render()};
  context.saved={bindSpecific(){legacyBindings++},openJournal:context.openJournal};
  vm.createContext(context);vm.runInContext(searchCode+journalCode+installCode+'\ninstallI2Surface();',context);
  function runTimer(ms){const next=[...timers].find(([,task])=>task.ms===ms);assert.ok(next,`timer ${ms} is scheduled`);timers.delete(next[0]);next[1].fn()}
  function input(query){const field=nodes.get('#searchQ');field.value=query;field.oninput()}
  function filter(name,value){const field=nodes.get('#search'+name);field.value=value;field.onchange()}
  function resolve(index,label){calls[index].resolve({total_matches:1,items:[{source_path:`/fixture-${index}.md`,date:'2026-10-01',kind:'daily',section:'日记',snippet:label}]})}
  return {context,nodes,timers,storage,calls,scrolls,openings,scroller,mount,runTimer,input,filter,resolve,
    start:()=>context.render(),clear:()=>nodes.get('#searchClear').onclick(),
    output:()=>nodes.get('#i2SearchResults').innerHTML,
    state:()=>Object.fromEntries(Object.keys(defaultState).map(key=>[key,context.STATE[key]])),
    get activeElement(){return activeElement},get legacyBindings(){return legacyBindings}};
}

test('clear resets the query, filters, return context and session immediately, and ignores an already pending response',async()=>{
  const app=fixture({state:{searchQ:'old',searchKind:'weekly',searchYear:'2025',searchSection:'日记',searchSort:'date_asc'}});
  await app.start();assert.equal(app.calls.length,1);
  app.context.I2.search={query:'old',selectedSourcePath:'/previous.md'};
  app.context.I2.journalData={backSearch:true};app.context.STATE.sourceOrigin={feature:'Universal Search'};
  app.storage.set(sessionKey,JSON.stringify(app.context.I2.search));
  app.nodes.get('#i2Filters').hidden=false;app.nodes.get('#searchFilterToggle').setAttribute('aria-expanded','true');
  app.clear();const empty=app.output();
  assert.match(empty,/输入一个词/);assert.deepEqual(app.state(),defaultState);
  assert.equal(app.nodes.get('#searchQ').value,'');assert.equal(app.nodes.get('#searchKind').value,'all');
  assert.equal(app.nodes.get('#searchYear').value,'');assert.equal(app.nodes.get('#searchSection').value,'');
  assert.equal(app.nodes.get('#searchSort').value,'relevance');assert.equal(app.nodes.get('#i2Filters').hidden,true);
  assert.equal(app.nodes.get('#searchFilterToggle').attributes.get('aria-expanded'),'false');
  assert.equal(app.context.I2.search,null);assert.equal(app.context.I2.journalData.backSearch,false);
  assert.equal(app.context.STATE.sourceOrigin,null);assert.equal(app.storage.has(sessionKey),false);
  assert.equal(app.calls[0].options.signal.aborted,true);assert.equal(app.activeElement,app.nodes.get('#searchQ'));
  app.resolve(0,'LATE OLD RESPONSE');await settle();assert.equal(app.output(),empty);
  assert.equal(app.calls.length,1,'clear does not send an empty query or a legacy browse request');
  app.context.restoreSearch();assert.equal(app.context.I2.search,null);assert.equal(app.timers.size,0);
});

test('clear removes pending input and restoration timers, so leaving and returning stays at the default search',async()=>{
  const app=fixture();await app.start();app.input('scheduled');
  app.context.I2.search={query:'saved',kind:'daily',year:'2025',section:'日记',sort:'date_desc',scrollY:777};
  app.storage.set(sessionKey,JSON.stringify(app.context.I2.search));app.context.restoreSearch();
  assert.ok(app.timers.size);app.clear();assert.equal(app.timers.size,0);
  app.context.STATE.feature='Home';await app.context.render();
  app.context.STATE.feature='Universal Search';await app.context.render();await settle();
  assert.deepEqual(app.state(),defaultState);assert.match(app.output(),/输入一个词/);assert.equal(app.calls.length,0);
  app.context.restoreSearch();assert.equal(app.timers.size,0);assert.equal(app.scrolls.length,0);
});

test('rapid queries invalidate earlier results as soon as typing changes and only render the newest response',async()=>{
  const app=fixture();await app.start();app.input('first');app.runTimer(170);assert.equal(app.calls.length,1);
  app.input('second');assert.equal(app.calls[0].options.signal.aborted,true);
  app.resolve(0,'EARLY STALE RESPONSE');await settle();assert.doesNotMatch(app.output(),/EARLY STALE RESPONSE/);
  app.runTimer(170);app.input('third');app.runTimer(170);assert.equal(app.calls.length,3);
  app.resolve(2,'third newest passage');await settle();assert.match(app.output(),/newest passage/);
  const newest=app.output();app.resolve(1,'LATE SECOND RESPONSE');await settle();assert.equal(app.output(),newest);
  assert.equal(app.state().searchQ,'third');
});

test('filter changes cannot let an older response replace the current filtered result',async()=>{
  const app=fixture({state:{searchQ:'passage'}});await app.start();
  app.filter('Kind','weekly');assert.equal(app.calls.length,2);assert.equal(app.calls[0].options.signal.aborted,true);
  assert.equal(new URL('http://fixture'+app.calls[1].url).searchParams.get('kind'),'weekly');
  app.resolve(1,'weekly current passage');await settle();const filtered=app.output();
  app.resolve(0,'DAILY OLD RESPONSE');await settle();assert.equal(app.output(),filtered);
  assert.equal(app.state().searchKind,'weekly');
});

test('deleting the query clears previous filters and does not revive the old STATE query when capturing context',async()=>{
  const app=fixture({state:{searchQ:'before',searchKind:'weekly',searchYear:'2025'}});await app.start();
  app.input('   ');assert.deepEqual(app.state(),defaultState);assert.match(app.output(),/输入一个词/);
  app.context.STATE.searchQ='stale fallback';app.context.captureSearch();
  assert.equal(app.context.I2.search,null);assert.equal(app.storage.has(sessionKey),false);
  await app.context.openJournal('/fixture-source.md');assert.deepEqual(app.openings,['/fixture-source.md']);
  assert.equal(app.context.I2.search,null,'opening a source with an empty input has no search-return context');
});

test('leaving cancels in-flight work and timers; a late response cannot write into either the old or next search page',async()=>{
  const app=fixture({state:{searchQ:'old'}});await app.start();const oldOutput=app.nodes.get('#i2SearchResults');
  app.input('pending');app.context.STATE.feature='Home';await app.context.render();
  assert.equal(app.calls[0].options.signal.aborted,true);assert.equal(app.timers.size,0);
  const writes=oldOutput.writes.length;app.resolve(0,'OLD DETACHED PAGE');await settle();assert.equal(oldOutput.writes.length,writes);
  app.context.STATE.feature='Universal Search';await app.context.render();assert.equal(app.calls.length,2);
  app.resolve(1,'pending current page');await settle();assert.match(app.output(),/current page/);
  assert.notEqual(app.nodes.get('#i2SearchResults'),oldOutput);
});

test('returning from a source restores query, filters, selection and the actual page scroller once current results arrive',async()=>{
  const app=fixture({state:{searchQ:'remember',searchKind:'weekly',searchYear:'2025',searchSection:'日记',searchSort:'date_desc'}});
  await app.start();app.resolve(0,'remember this passage');await settle();
  const source=app.nodes.get('#i2SearchResults').querySelectorAll('[data-i2-source]')[1];
  let stopped=false;source.onclick({stopPropagation(){stopped=true}});await settle();
  assert.equal(stopped,true);assert.equal(app.context.STATE.feature,'Journal');assert.equal(app.context.I2.search.selectedSourcePath,'/fixture-0.md');
  assert.equal(JSON.parse(app.storage.get(sessionKey)).scrollY,240);
  app.context.STATE.feature='Universal Search';await app.context.render();app.context.restoreSearch();app.runTimer(0);
  const latest=app.calls.length-1;app.calls[latest].resolve({total_matches:1,items:[{source_path:'/fixture-0.md',date:'2026-10-01',kind:'weekly',section:'日记',snippet:'remember restored passage'}]});
  await settle();assert.equal(app.state().searchQ,'remember');assert.equal(app.state().searchKind,'weekly');
  assert.deepEqual(app.scrolls,[{top:240,behavior:'auto'}]);assert.equal(app.activeElement.dataset.i2Source,'/fixture-0.md');
  assert.match(app.output(),/restored passage/);
});

test('clearing after a source return begins prevents the pending restoration from scrolling or reviving results',async()=>{
  const app=fixture();await app.start();
  app.storage.set(sessionKey,JSON.stringify({query:'saved',kind:'daily',year:'',section:'',sort:'relevance',scrollY:888}));
  app.context.restoreSearch();app.runTimer(0);assert.equal(app.calls.length,1);
  app.clear();app.resolve(0,'SAVED RESULT AFTER CLEAR');await settle();
  assert.match(app.output(),/输入一个词/);assert.equal(app.scrolls.length,0);assert.deepEqual(app.state(),defaultState);
  assert.equal(app.storage.has(sessionKey),false);
});

test('Enter uses the current search handler, cancels debounce, and remains usable after a rejected request',async()=>{
  const app=fixture({rejectAborted:true});await app.start();assert.equal(app.legacyBindings,0);
  app.input('retry');let prevented=false;
  app.nodes.get('#searchQ').onkeydown({key:'Enter',preventDefault(){prevented=true}});
  assert.equal(prevented,true);assert.equal(app.timers.size,0);assert.equal(app.calls.length,1);
  app.calls[0].reject(new Error('fixture unavailable'));await settle();assert.match(app.output(),/搜索暂不可用/);
  app.nodes.get('#searchQ').onkeydown({key:'Enter',preventDefault(){}});app.resolve(1,'retry recovered passage');await settle();
  assert.match(app.output(),/recovered passage/);
  app.input('next');app.clear();await settle();assert.match(app.output(),/输入一个词/);
  app.context.STATE.feature='Home';await app.context.render();assert.equal(app.legacyBindings,1,'other pages retain their original bindings');
});

test('filters can be chosen before a query and zero matches show the existing empty-result guidance',async()=>{
  const app=fixture();await app.start();app.filter('Kind','weekly');
  assert.equal(app.state().searchKind,'weekly');assert.equal(app.calls.length,0);
  app.input('missing');app.runTimer(170);
  assert.equal(new URL('http://fixture'+app.calls[0].url).searchParams.get('kind'),'weekly');
  app.calls[0].resolve({total_matches:0,items:[]});await settle();
  assert.match(app.output(),/0 个匹配段落/);assert.match(app.output(),/没有找到/);
});
