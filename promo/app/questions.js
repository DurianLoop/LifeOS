const providers={deepseek:{name:'DeepSeek',model:'deepseek-chat'},openai:{name:'OpenAI',model:'gpt-4.1-mini'},qwen:{name:'通义千问',model:'qwen-plus'}};
export function initAI({db,$,$$,el,button,notify,safe,entries,items,openReader,refresh,broadcast}){
  let selected=new Set(),settings={provider:'deepseek',model:'deepseek-chat'},key='',review=null,pending=null;
  const text=(selector,value)=>{$(selector).textContent=value;};
  const on=(selector,event,operation)=>$(selector).addEventListener(event,safe(operation));
  function renderEvidence(){
    selected=new Set([...selected].filter(id=>entries().some(e=>e.id===id)));const term=$('#evidence-search').value.trim().toLocaleLowerCase();const matches=entries().filter(e=>(e.body||'').trim()&&(!term||`${e.title}\n${e.body}\n${e.date}`.toLocaleLowerCase().includes(term)));
    $('#evidence-list').replaceChildren(...matches.slice(0,100).map(entry=>{const label=el('label','evidence-row'),check=el('input');check.type='checkbox';check.checked=selected.has(entry.id);check.setAttribute('aria-label',`参考 ${entry.date} ${entry.title||'无题'}`);check.onchange=()=>{if(check.checked&&selected.size>=6){check.checked=false;notify('一次最多带上 6 页原文。');return;}if(check.checked)selected.add(entry.id);else selected.delete(entry.id);text('#evidence-count',`${selected.size} / 6`);};const content=el('span');content.append(el('time','',entry.date+(entry.kind==='weekly'?' · 周记':'')),el('strong','',entry.title||'无题'),el('p','',entry.body.replace(/^#+\s*/gm,'').slice(0,85)));label.append(check,content);return label;}));
    if(!matches.length)$('#evidence-list').append(el('p','meta',entries().length?'换一个关键词，或先清空筛选。':'先写几页日记，或导入已有记录，再选择本次选材。'));
    text('#evidence-count',`${selected.size} / 6`);text('#ai-config-hint',key?`已连接配置：${providers[settings.provider].name} · ${settings.model}。每次发送前仍由你核对范围。`:'AI 可稍后配置。前往「设置 → AI，按需而来」填写自己的密钥。');
  }
  function answerCard(item){
    const root=el('article','answer-card');root.append(el('p','eyebrow',new Date(item.createdAt).toLocaleString('zh-CN')),el('h3','',item.question||'这一次的回声'),el('div','answer-body',item.body));const sources=el('div','answer-sources');for(const [index,source]of (item.sources||[]).entries())sources.append(button(`[${index+1}] ${source.date} · ${source.title||'无题'}`,()=>openReader(source.id)));root.append(sources,el('p','meta','依据仅限本次选材，事实与推测请回到原文核对。'));return root;
  }
  function renderHistory(){const answers=items().filter(i=>i.type==='answer').sort((a,b)=>b.createdAt.localeCompare(a.createdAt));$('#answer-history').replaceChildren(...answers.slice(0,15).map(answerCard));}
  on('#evidence-search','input',renderEvidence);
  $$('.prompt-chips button').forEach(b=>b.onclick=()=>{$('#question').value=b.dataset.question;$('#question').focus();});
  on('#provider','change',()=>{$('#model').value=providers[$('#provider').value].model;});
  on('#ai-settings','submit',async event=>{event.preventDefault();const provider=$('#provider').value,model=$('#model').value.trim(),value=$('#api-key').value.trim();
    if(!Object.hasOwn(providers,provider)||!/^[a-zA-Z0-9._:/-]{1,128}$/.test(model))throw Error('请选择模型服务并填写有效模型名称。');
    if(value&&!/^[\x21-\x7e]{8,512}$/.test(value))throw Error('请核对 API Key 格式。');
    settings={provider,model};await db.setMeta('ai-provider',settings);key=value;renderEvidence();text('#settings-status',key?'已应用，本次密钥仅保留在页面内存。':'模型偏好已保存，填入密钥即可提问。');
  });
  on('#clear-key','click',()=>{key='';$('#api-key').value='';text('#settings-status','已清除本次密钥。');renderEvidence();});
  on('#review-question','click',()=>{
    if(!navigator.onLine)throw Error('提问需要联网。离线写作、阅读和本地检索仍可使用。');
    const question=$('#question').value.trim();if(!question)throw Error('先写下想问的问题。');if(!selected.size)throw Error('先勾选至少一页原文。');if(!key){location.hash='settings';throw Error('请先配置自己的模型与 API Key。');}
    review={...settings,question,evidence:[...selected].map(id=>entries().find(e=>e.id===id)).filter(Boolean).map(e=>({id:e.id,date:e.date,title:e.title,body:e.body.slice(0,1600)}))};
    text('#review-destination',`发送至 ${providers[review.provider].name} · ${review.model}，经本站网关转发。`);text('#review-question-text',question);text('#send-status','');
    $('#review-evidence').replaceChildren(...review.evidence.map((e,index)=>{const root=el('div','review-evidence-item'),label=el('label','',`[${index+1}] ${e.date} · ${e.title||'无题'}`),area=el('textarea');label.htmlFor=area.id=`excerpt-${index}`;area.value=e.body;area.maxLength=10000;root.append(label,area);return root;}));$('#send-review').showModal();
  });
  function closeReview(){if(pending)return notify('正在提问，可点击「停止等待」。');$('#send-review').close();}
  on('#close-review','click',closeReview);$('#send-review').addEventListener('cancel',event=>{event.preventDefault();closeReview();});on('#cancel-question','click',()=>pending?.abort());
  async function request(payload,signal){
    const response=await fetch('/.netlify/functions/mobile-ask',{method:'POST',cache:'no-store',credentials:'omit',headers:{'Content-Type':'application/json',Authorization:`Bearer ${key}`},body:JSON.stringify(payload),signal});
    let data;try{data=await response.json();}catch{throw Error('服务没有返回有效回答，请稍后再试。');}if(!response.ok)throw Error(data.error?.message||'AI 请求未完成，请核对模型设置。');if(typeof data.answer!=='string'||!data.answer.trim())throw Error('AI 未返回可用文字。');return data;
  }
  on('#send-question','click',async()=>{
    if(pending||!review)return;const evidence=review.evidence.map((e,i)=>({...e,body:$('#excerpt-'+i).value}));if(evidence.some(e=>!e.body.trim()))return text('#send-status','每页摘录需要保留一些文字。');if(evidence.reduce((n,e)=>n+e.body.length,0)>10000)return text('#send-status','摘录总量最多 10,000 字，请缩短后重试。');
    const payload={...review,evidence};pending=new AbortController();const timeout=setTimeout(()=>pending?.abort(),32000);$('#send-question').disabled=true;$('#cancel-question').hidden=false;$$('#review-evidence textarea').forEach(n=>{n.disabled=true;});text('#send-status','正在阅读这些旧页，请稍候…');
    try{const data=await request(payload,pending.signal);const item=await db.saveItem({type:'answer',question:payload.question,body:data.answer,sources:evidence.map(({id,date,title})=>({id,date,title})),provider:payload.provider,model:payload.model,createdAt:new Date().toISOString()});$('#answer-panel').replaceChildren(answerCard(item));$('#send-review').close();await refresh();broadcast();$('#answer-panel').scrollIntoView({block:'start'});}
    catch(error){text('#send-status',error.name==='AbortError'?'已停止等待。原文未改动，已发出的请求可能仍在服务商处理。':error.message);}
    finally{clearTimeout(timeout);pending=null;$('#send-question').disabled=false;$('#cancel-question').hidden=true;$$('#review-evidence textarea').forEach(n=>{n.disabled=false;});}
  });
  return {refresh(){renderEvidence();renderHistory();},select(id){selected.add(id);renderEvidence();},configured:()=>Boolean(key),
    async chat(messages){if(!key)throw Error('先到「设置」填写自己的模型与 API Key，再和伙伴聊天。');if(!navigator.onLine)throw Error('伙伴聊天需要联网；原始动作可在离线时陪伴。');const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),32000);try{return (await request({...settings,mode:'companion',question:messages.at(-1).content,evidence:[],messages:messages.slice(-12)},controller.signal)).answer;}finally{clearTimeout(timer);}},
    async load(){const saved=await db.getMeta('ai-provider',null);if(saved&&Object.hasOwn(providers,saved.provider)&&typeof saved.model==='string')settings={provider:saved.provider,model:saved.model};$('#provider').value=settings.provider;$('#model').value=settings.model;renderEvidence();renderHistory();},
  };
}
