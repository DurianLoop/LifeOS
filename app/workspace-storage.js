/* The desktop workspace owns drafts and preferences, independent of its URL. */
(() => {
  'use strict';
  const native=window.localStorage,bridge=window.lifeosDesktop?.storage;
  const known=storage=>{for(let i=0;i<storage.length;i++)if(/^lifeos[.:]/.test(storage.key(i)||''))return true;return false;};
  if(!bridge){try{window.lifeosVisitContext={existing:known(native),storageError:false};}catch{window.lifeosVisitContext={existing:true,storageError:true};}return;}
  let failure=null;
  const call=command=>{const reply=bridge(command);if(!reply?.ok){failure=new Error(reply?.error||'无法保存本地草稿');throw failure}failure=null;return reply.value};
  let items={};
  try{
    items=call({op:'snapshot'});
    const legacy={};
    for(let i=0;i<native.length;i++){const key=native.key(i);if(/^lifeos[.:]/.test(key))legacy[key]=native.getItem(key)}
    if(Object.keys(legacy).length){items=call({op:'import',items:legacy});for(const key of Object.keys(legacy))native.removeItem(key)}
  }catch(error){failure=error}
  window.lifeosVisitContext={existing:Object.keys(items).some(key=>/^lifeos[.:]/.test(key)),storageError:!!failure};
  const storage={
    get length(){return Object.keys(items).length},
    key:index=>Object.keys(items)[index]??null,
    getItem:key=>{if(failure)items=call({op:'snapshot'});return items[String(key)]??null},
    setItem(key,value){key=String(key);value=String(value);call({op:'set',key,value});items[key]=value;try{native.removeItem(key)}catch{}},
    removeItem(key){key=String(key);call({op:'remove',key});delete items[key];try{native.removeItem(key)}catch{}},
    clear(){for(const key of Object.keys(items))this.removeItem(key)}
  };
  window.lifeosStorage=storage;
  Object.defineProperty(window,'localStorage',{configurable:true,get:()=>storage});
})();
