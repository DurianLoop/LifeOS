const ACTIONS=[['sit','坐着'],['move','走一走'],['sleep','睡觉'],['jump','蹦一下'],['relax','放松'],['interact','回应你'],['start','打招呼'],['sweat','擦擦汗'],['hide','藏起来'],['fly','飞起来'],['die','躺一会儿'],['special','小惊喜'],['special0','特别演出'],['special1','另一种惊喜']];
const SOUNDS=[['rain','雨声','RAIN','M7 5a5 5 0 0 1 10 0 4 4 0 1 1 1 8H6A4 4 0 1 1 7 5M8 17l-1 3m6-3-1 3m6-3-1 3'],['fire','炉火','FIRE','M13 2s1 5-3 8c-2-2-2-4-2-4-6 7-4 15 4 15 10 0 10-10 1-19Z'],['ocean','海浪','OCEAN','M2 9c4-6 8 6 12 0s8 0 8 0M2 15c4-6 8 6 12 0s8 0 8 0'],['forest','森林','FOREST','m6 2-4 8h3l-4 7h10l-4-7h3ZM6 17v5m12-17-3 6h2l-3 6h8l-3-6h2ZM18 17v5'],['stream','溪流','STREAM','M7 2c10 2-10 5 0 8s10 5 0 8m10-16c10 2-10 5 0 8s10 5 0 8'],['night','夏夜','NIGHT','M20 15A8 8 0 0 1 9 4a8 8 0 1 0 11 11ZM17 3v4m-2-2h4']];
export function initCompanion({db,$,el,button,notify,safe,ai}){
  const image=$('#pet-image'),actionSelect=$('#pet-action');let character='vivi',catalog=null;const actions=()=>character==='dsh'?(catalog?.actions||[]).map(a=>[a.id,a.label]):ACTIONS;const source=id=>character==='dsh'?`./media/dsh/${id}.webp`:`./media/vivi/${id}.gif`;const defaultAction=()=>character==='dsh'?catalog.defaultAction:'sit';const prefs=()=>({character,action:current,auto:$('#pet-auto').checked});function drawActions(){actionSelect.replaceChildren(...actions().map(([id,label])=>{const option=el('option','',label);option.value=id;return option;}));$('#pet-character').value=character;$('#pet-character-name').replaceChildren(document.createTextNode(character==='dsh'?'DSH 小鲸':'ViVi'),el('small','','在这里，陪你。'));const credit=$('#pet-credit');credit.replaceChildren(document.createTextNode(character==='dsh'?'DSH 原版 106 段动作 · 动画素材禁止商用。':'ViVi 的原始动作，在应用内陪伴你。'));const link=el('a','','素材来源与许可');link.href=character==='dsh'?'https://github.com/PC2005-cloud/dsh-pet':'./media/vivi/LICENSE.md';link.target='_blank';link.rel='noopener noreferrer';credit.append(link);}
  let paused=false,current='sit',pausedUrl=null,autoTimer,chatBusy=false,chatTurns=[],loaded=false,deadline=0,timerInterval,loadSequence=0;
  const audio=new Audio();audio.loop=true;audio.preload='none';audio.volume=.4;let sound=null,soundSequence=0;const audioExtension=audio.canPlayType('audio/ogg; codecs=vorbis')?'ogg':'m4a';
  const text=(selector,value)=>{$(selector).textContent=value;};
  const on=(selector,event,operation)=>$(selector).addEventListener(event,safe(operation));
  drawActions();
  function markPet(){const label=actions().find(([id])=>id===current)?.[1]||'坐着';image.alt=`${character==='dsh'?'DSH 小鲸':'ViVi'} · ${label}${paused?'，已暂停':''}`;actionSelect.value=current;$('#pause-pet').setAttribute('aria-pressed',String(paused));text('#pause-pet',paused?'继续动作':'暂停动作');}
  async function playAction(id,save=true){
    if(!actions().some(([value])=>value===id))return;const sequence=++loadSequence;const next=new Image();next.src=source(id);
    try{await next.decode();if(sequence!==loadSequence)return;if(pausedUrl){URL.revokeObjectURL(pausedUrl);pausedUrl=null;}current=id;paused=false;image.src=next.src;markPet();if(save)await db.setMeta('companion',prefs());}
    catch{if(sequence===loadSequence){notify('这段动作暂未缓存，请联网后再试。');actionSelect.value=current;}}
  }
  on('#pet-character','change',async()=>{const next=$('#pet-character').value;if(next==='dsh'&&!catalog){try{const response=await fetch('./media/dsh/catalog.json');if(!response.ok)throw Error();catalog=await response.json();}catch{$('#pet-character').value=character;return notify('小鲸的动作目录尚未缓存，请联网后再试。');}}character=next;drawActions();await playAction(defaultAction());});
  on('#pet-action','change',()=>playAction(actionSelect.value));
  on('#pet-interact','click',async()=>{const choices=character==='dsh'?catalog.actions.filter(a=>a.group==='互动与状态').map(a=>a.id):['interact','jump','relax','start'];await playAction(choices[Math.floor(Math.random()*choices.length)]);text('#pet-speech',['今天，也慢慢来。','休息一下，再接着写。','在这一页，留一点喜欢的事情。','听见啦。'][Math.floor(Math.random()*4)]);});
  on('#pause-pet','click',async()=>{
    if(paused){paused=false;if(pausedUrl)URL.revokeObjectURL(pausedUrl);pausedUrl=null;image.src=source(current);markPet();return;}
    const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;if(!canvas.width)return;
    canvas.getContext('2d').drawImage(image,0,0);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)return;pausedUrl=URL.createObjectURL(blob);image.src=pausedUrl;paused=true;markPet();
  });
  on('#pet-auto','change',()=>db.setMeta('companion',prefs()));
  autoTimer=setInterval(()=>{if(!document.hidden&&!paused&&$('#pet-auto').checked&&!$('#view-companion').hidden)void playAction(character==='dsh'?catalog.actions[Math.floor(Math.random()*catalog.actions.length)].id:['sit','relax','interact','sweat'][Math.floor(Math.random()*4)],false);},25000);
  on('#pet-chat-form','submit',async event=>{
    event.preventDefault();if(chatBusy)return;const input=$('#pet-chat-input'),content=input.value.trim();if(!content)return;if(!ai.configured())return notify('先到设置填写模型与 API Key，再和伙伴聊几句。');
    chatBusy=true;event.target.querySelector('button').disabled=true;text('#pet-chat-status','伙伴正在想一想…');
    try{const turns=[...chatTurns,{role:'user',content}].slice(-12),answer=await ai.chat(turns);chatTurns=[...turns,{role:'assistant',content:answer}].slice(-12);input.value='';renderChat();await db.saveItem({type:'chat',body:content,answer,createdAt:new Date().toISOString()});text('#pet-chat-status','只发送了本次聊天，没有读取日记。');}
    catch(error){text('#pet-chat-status',error.name==='AbortError'?'伙伴暂时没有回应，稍后可再试。':error.message);}finally{chatBusy=false;event.target.querySelector('button').disabled=false;}
  });
  function renderChat(){const root=$('#pet-chat-history');root.replaceChildren(...chatTurns.map(turn=>el('p','chat-bubble'+(turn.role==='user'?' user':''),turn.content)));root.scrollTop=root.scrollHeight;}
  $('#sound-grid').replaceChildren(...SOUNDS.map(([id,label,en,path])=>{const b=button('',()=>toggleSound(id),'sound-card');b.dataset.sound=id;b.setAttribute('aria-pressed','false');b.setAttribute('aria-label',`播放${label}`);b.innerHTML=`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`;b.append(el('span','',label),el('small','',en));return b;}));
  function markSound(){
    const label=SOUNDS.find(([id])=>id===sound)?.[1]||'';document.querySelectorAll('[data-sound]').forEach(b=>{const playing=b.dataset.sound===sound&&!audio.paused;b.setAttribute('aria-pressed',String(playing));b.setAttribute('aria-label',(playing?'暂停':'播放')+SOUNDS.find(([id])=>id===b.dataset.sound)[1]);});
    text('#sound-status',audio.paused?'尚未播放':`${label} · ${deadline?Math.max(1,Math.ceil((deadline-Date.now())/60000))+' 分钟后暂停':'正在播放'}`);$('#sound-mini').hidden=audio.paused;text('#sound-mini-name',`${label}${deadline?' · 已定时':''}`);
  }
  async function toggleSound(id){
    if(sound===id&&!audio.paused){stop();return;}const same=sound===id;sound=id;const sequence=++soundSequence;if(!same)audio.src=`./media/audio/${id}.${audioExtension}`;
    try{await audio.play();if(sequence!==soundSequence)return;setTimer();markSound();await saveSound();if('mediaSession'in navigator){navigator.mediaSession.metadata=new MediaMetadata({title:SOUNDS.find(([key])=>key===id)[1],artist:'LifeOS · 自然声'});navigator.mediaSession.setActionHandler('pause',stop);navigator.mediaSession.setActionHandler('play',()=>void toggleSound(sound));}}
    catch{if(sequence!==soundSequence)return;sound=null;markSound();notify('声音暂未缓存，或浏览器未允许播放。请联网后点击声音卡片重试。');}
  }
  function stop(){++soundSequence;audio.pause();deadline=0;clearInterval(timerInterval);markSound();}
  function setTimer(){clearInterval(timerInterval);const minutes=Number($('#sound-timer').value);deadline=minutes?Date.now()+minutes*60000:0;if(deadline)timerInterval=setInterval(()=>{if(Date.now()>=deadline)stop();else markSound();},1000);}
  const saveSound=()=>db.setMeta('sound',{volume:Math.round(audio.volume*100),timer:Number($('#sound-timer').value)});
  on('#sound-volume','input',async()=>{audio.volume=Number($('#sound-volume').value)/100;await saveSound();});on('#sound-timer','change',async()=>{if(!audio.paused)setTimer();markSound();await saveSound();});on('#stop-sound','click',stop);on('#sound-mini-stop','click',stop);
  audio.addEventListener('pause',markSound);audio.addEventListener('play',markSound);audio.addEventListener('error',()=>{sound=null;markSound();});
  return {async load(){if(loaded)return;loaded=true;const petPrefs=await db.getMeta('companion',{}),soundPrefs=await db.getMeta('sound',{});$('#pet-auto').checked=petPrefs.auto!==false;if(petPrefs.character==='dsh'){try{const response=await fetch('./media/dsh/catalog.json');if(response.ok){catalog=await response.json();character='dsh';drawActions();}}catch{}}await playAction(petPrefs.action||defaultAction(),false);if(soundPrefs.volume>=0&&soundPrefs.volume<=100){audio.volume=soundPrefs.volume/100;$('#sound-volume').value=soundPrefs.volume;}if([0,15,30,60].includes(soundPrefs.timer))$('#sound-timer').value=soundPrefs.timer;const chats=(await db.all('items')).filter(i=>i.type==='chat').sort((a,b)=>a.createdAt.localeCompare(b.createdAt)).slice(-6);chatTurns=chats.flatMap(c=>[{role:'user',content:c.body},{role:'assistant',content:c.answer}]);renderChat();}};
}
