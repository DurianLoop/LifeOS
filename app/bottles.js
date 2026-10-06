(() => {
  'use strict';
  const NAME='Time Capsule', PREFIX='lifeos.bottle.draft.', themes={moon:'月海',dawn:'晨雾',dusk:'暮色'};
  const kindNames={text:'文字',audio:'声音',video:'视频'}, tabs={all:'全部',sealed:'在途中',arrived:'已抵达',draft:'草稿',opened:'已开启'};
  const page={tab:'all',theme:localStorage.getItem('lifeos.bottle.scene')||'moon',items:[],arrival:null};
  let session=null,dialog=null,installed=false,chain=Promise.resolve(),saveTimer=null,recordTimer=null,polling=false;
  const $b=s=>document.querySelector(s), e=value=>esc(String(value??''));
  const date=value=>value?new Intl.DateTimeFormat('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value*1000)):'未约定时间';
  const toInput=value=>{const d=new Date(value*1000);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`};
  function tomorrow(){const d=new Date();d.setDate(d.getDate()+1);d.setSeconds(0,0);return d.getTime()/1000}
  async function request(path,body,options={}){
    const res=await fetch(path,{cache:'no-store',...(body!==undefined?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{}),...options});
    const value=await res.json();if(!res.ok)throw new Error(value.error||'未能连接本地服务');return value;
  }
  function shadow(value){localStorage.setItem(PREFIX+value.id,JSON.stringify({...value,pending:true}))}
  function shadows(){const result=[];for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(key?.startsWith(PREFIX))try{result.push(JSON.parse(localStorage.getItem(key)))}catch{}}return result}
  function status(text,error=false){const node=$b('#bottleSaveState');if(node){node.textContent=text;node.style.color=error?'#964f40':''}const retry=$b('#bottleRetrySave');if(retry)retry.hidden=!error;if(session)session.error=error}
  function snapshot(){
    if(!session?.draft)return null;
    const title=$b('#bottleTitle'),body=$b('#bottleBody'),when=$b('#bottleDate');
    if(title)session.value.title=title.value;if(body)session.value.body=body.value;
    if(when)session.value.unlock_at=when.value?new Date(when.value).getTime()/1000:null;
    return {id:session.value.id,kind:session.value.kind,title:session.value.title||'',body:session.value.body||'',
      theme:session.value.theme,unlock_at:session.value.unlock_at,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone||'',revision:session.value.revision};
  }
  function enqueue(task){const job=chain.catch(()=>{}).then(task);chain=job;return job}
  function metadata(out,owner){if(session!==owner)return;Object.assign(owner.value,{revision:out.revision,media_url:out.media_url,mime:out.mime,has_media:out.has_media})}
  async function persist(){
    clearTimeout(saveTimer);const value=snapshot(),owner=session;if(!value)return true;
    try{shadow(value)}catch{status('本地草稿未能保存，请暂时保留此窗口',true);return false}
    status('正在保存');
    try{
      await enqueue(async()=>{value.revision=owner.value.revision;const out=await request('/api/bottles/draft',value);metadata(out,owner);
        // Do not clear newer input while this request is in flight.
        const cached=localStorage.getItem(PREFIX+value.id);if(cached&&JSON.parse(cached).body===value.body&&JSON.parse(cached).title===value.title&&JSON.parse(cached).unlock_at===value.unlock_at&&JSON.parse(cached).kind===value.kind&&JSON.parse(cached).theme===value.theme)localStorage.removeItem(PREFIX+value.id);
      });
      if(session===owner)status('草稿已保存');return true;
    }catch(error){if(session===owner)status(error.message+' · 草稿仍保留在本机',true);return false}
  }
  function changed(){const value=snapshot();try{if(value)shadow(value)}catch{status('本地存储不可用，请暂时保留此窗口',true)}status('待保存');clearTimeout(saveTimer);saveTimer=setTimeout(persist,450);updateCount()}
  function updateCount(){const node=$b('#bottleWordCount');if(node)node.textContent=`${($b('#bottleBody')?.value||'').length} / 20000`}
  function ensureDialog(){
    if(dialog)return dialog;dialog=document.createElement('dialog');dialog.className='bottleDialog';dialog.id='bottleDialog';document.body.append(dialog);
    dialog.addEventListener('cancel',event=>{event.preventDefault();close()});
    dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)close()}});
    return dialog;
  }
  function busy(value){if(!dialog)return;dialog.querySelectorAll('[data-bottle-mode],#bottleSeal,#bottleRecordStart,#bottleFileButton').forEach(b=>b.disabled=value)}
  function release(){
    clearInterval(recordTimer);recordTimer=null;
    session?.stream?.getTracks().forEach(track=>track.stop());
    if(session?.audioContext)session.audioContext.close().catch(()=>{});
    if(session?.objectURL)URL.revokeObjectURL(session.objectURL);
    if(session?.animation)cancelAnimationFrame(session.animation);
  }
  async function prepare(){
    if(!session?.draft)return true;
    if(session.recorder?.state==='recording'&&!await stopRecord())return false;
    await chain.catch(()=>{});
    if(session?.uploadBlob&&!await uploadBlob(session.uploadBlob))return false;
    if(session?.recordError)return false;
    return persist();
  }
  async function close(refresh=true){if(!await prepare())return false;release();session=null;dialog?.close();dialog?.replaceChildren();if(refresh&&STATE.feature===NAME)await render();return true}
  function themeControls(theme){return Object.entries(themes).map(([key,label])=>`<button type="button" data-bottle-theme="${key}" aria-pressed="${key===theme}">${label}</button>`).join('')}
  async function renderPage(){
    let error='';try{page.items=(await request('/api/bottles')).items}catch(err){error=err.message}
    for(const cached of shadows())if(!page.items.some(x=>x.id===cached.id))page.items.unshift({...cached,state:'draft',created_at:Date.now()/1000});
    const items=page.items.filter(x=>page.tab==='all'||x.state===page.tab),arrived=page.items.filter(x=>x.state==='arrived');
    return `<div class="page bottlePage"><header class="bottleHead"><h1>漂流瓶</h1><button class="bottleAction primary" id="bottleNew">寄给未来</button></header>
      <section class="bottleHero bottleScene" data-theme="${e(page.theme)}" aria-label="${e(themes[page.theme])}海面"><div class="bottleHeroCopy"><span>A LETTER TO MY FUTURE SELF</span><h2>把此刻<br>寄向未来</h2><p>让时间替你保管<br>直到重逢的那一天</p></div><img class="bottleHeroArt" src="/assets/bottles/bottle.svg" alt="装着一封信的玻璃瓶"><div class="bottleScenery" aria-label="海面背景">${themeControls(page.theme)}</div></section>
      ${arrived.length?`<div class="bottleArrival"><span>${arrived.length===1?'一只漂流瓶抵达了':`${arrived.length} 只漂流瓶抵达了`}</span><button class="bottleAction" id="bottleArrived">去重逢</button></div>`:''}
      <div class="bottleShelfHead"><div class="bottleTabs" role="tablist" aria-label="漂流瓶状态">${Object.entries(tabs).map(([key,label])=>`<button type="button" role="tab" data-bottle-tab="${key}" aria-selected="${page.tab===key}">${label}<small>${page.items.filter(x=>key==='all'||x.state===key).length}</small></button>`).join('')}</div><span class="bottleCount">${page.items.length} 封时间来信</span></div>
      ${error?`<p role="alert">${e(error)} <button class="bottleAction" id="bottleReload">重试</button></p>`:''}
      <div class="bottleGrid" role="tabpanel">${items.map(x=>`<button type="button" class="bottleCard" data-bottle-id="${e(x.id)}"><div class="bottleCardImage bottleScene" data-theme="${e(x.theme)}"><span>${e(tabs[x.state])}</span><img src="/assets/bottles/bottle.svg" alt=""></div><div class="bottleCardInfo"><h3>${e(x.title||'给未来的自己')}</h3><div class="bottleCardFooter"><time>${e(date(x.unlock_at))}</time><span>${e(kindNames[x.kind])}</span></div></div></button>`).join('')||`<div class="bottleEmpty"><p>${page.tab==='arrived'?'风还在路上':page.tab==='opened'?'等待一次重逢':page.tab==='draft'?'下一封信，从此刻开始':'还没有寄出的漂流瓶'}</p></div>`}</div></div>`;
  }
  async function open(bid){
    if(session&&!await close(false))return;
    try{
      const cached=shadows().find(x=>x.id===bid);let value;
      if(!bid){value=await request('/api/bottles/draft',{kind:'text',theme:page.theme,unlock_at:tomorrow()})}
      else{value=page.items.find(x=>x.id===bid);if(!value){const all=await request('/api/bottles');value=all.items.find(x=>x.id===bid)}if(!value&&cached)value={...cached,state:'draft'};
        if(!value)throw new Error('这只漂流瓶已不存在');
        if(value.state==='draft'||value.state==='opened'){
          try{value=await request('/api/bottles/'+bid)}catch(err){if(!cached)throw err;value={...cached,state:'draft'}}
          if(cached&&value.state==='draft'){
            if(cached.revision!==value.revision&&cached.body!==value.body){value={...cached,id:'bottle_'+crypto.randomUUID().replaceAll('-',''),revision:0,title:(cached.title||'给未来的自己')+' · 恢复草稿'}}
            else value={...value,...cached,state:'draft'};
          }
        }
      }
      session={value,draft:value.state==='draft',uploadBlob:null};ensureDialog();drawDialog();dialog.showModal();
    }catch(err){toast(err.message)}
  }
  function drawDialog(){
    const value=session.value;dialog.setAttribute('aria-label',session.draft?'写给未来的自己':value.title||'漂流瓶');
    if(value.state==='sealed'||value.state==='arrived'){
      const due=value.state==='arrived';dialog.innerHTML=`<section class="bottleLock bottleScene" data-theme="${e(value.theme)}"><button class="bottleClose" data-bottle-close aria-label="关闭">×</button><img src="/assets/bottles/bottle.svg" alt="封存的漂流瓶"><h2>${e(value.title||'给未来的自己')}</h2><time>${e(date(value.unlock_at))}</time><p>${due?'时间到了，过去的你在等你':'这一刻，还在时间的海上'}</p>${due?'<button class="bottleAction" id="bottleUnseal">开启漂流瓶</button>':'<span id="bottleRemaining"></span>'}<button class="bottleDelete" id="bottleDelete">删除漂流瓶</button><div id="bottleDialogError" role="alert"></div></section>`;
    }else{
      dialog.innerHTML=`<div class="bottleCompose"><aside class="bottleDialogScene bottleScene" data-theme="${e(value.theme)}"><span class="bottleStamp">${session.draft?'TO THE DAYS AHEAD':'FROM THE DAYS BEFORE'}</span><h2>${session.draft?'把今天<br>交给时间':'久别<br>重逢'}</h2><img src="/assets/bottles/bottle.svg" alt=""><p>${session.draft?'山海有期<br>此刻有回声':e(date(value.sealed_at))+'<br>从这一天，漂流而来'}</p>${session.draft?`<div class="bottleThemes">${themeControls(value.theme)}</div>`:''}</aside><section class="bottlePaper"><header><span>${session.draft?'写给未来的自己':'一封来自过去的信'}</span><button class="bottleClose" data-bottle-close aria-label="关闭">×</button></header>
      ${session.draft?`<div class="bottleModes" aria-label="内容类型">${Object.entries(kindNames).map(([key,label])=>`<button type="button" data-bottle-mode="${key}" aria-pressed="${key===value.kind}">${label}</button>`).join('')}</div><input id="bottleTitle" class="bottleTitle" maxlength="100" placeholder="给未来的自己" value="${e(value.title)}" aria-label="漂流瓶标题">
        ${value.kind==='text'?`<textarea id="bottleBody" class="bottleBody" maxlength="20000" placeholder="等你读到这里的时候……" aria-label="给未来的文字">${e(value.body)}</textarea>`:`<div class="bottleRecord" id="bottleRecord"></div><input class="bottleCaption" id="bottleBody" maxlength="20000" placeholder="再留一句话 · 可选" aria-label="媒体附言" value="${e(value.body)}">`}
        <div class="bottleSaveLine" aria-live="polite"><span id="bottleSaveState">草稿已保存</span><button type="button" id="bottleRetrySave" hidden>重试保存</button><span id="bottleWordCount"></span></div>
        <div class="bottleSchedule"><label for="bottleDate">约定开启时间<input type="datetime-local" id="bottleDate" value="${e(value.unlock_at?toInput(value.unlock_at):'')}" min="${toInput(Date.now()/1000)}" required></label><div class="bottleShortcuts"><button type="button" data-bottle-days="7">一周后</button><button type="button" data-bottle-months="1">一个月后</button><button type="button" data-bottle-years="1">一年后</button></div></div>
        <div id="bottleSealConfirm"></div><footer class="bottleFoot"><button class="bottleDelete" id="bottleDelete">删除草稿</button><p>封存后，到约定的时间才能开启<br>应用运行时提醒，关闭期间的来信会在下次打开时抵达</p><button class="bottleAction primary" id="bottleSeal">封存漂流瓶</button></footer>`:
        `<div class="bottleLetterDates">寄出 ${e(date(value.sealed_at))}<br>约定 ${e(date(value.unlock_at))}</div><h2 class="bottleOpenedTitle">${e(value.title||'给未来的自己')}</h2>${value.media_url?`<${value.kind} class="bottleOpenedMedia" controls preload="metadata" src="${e(value.media_url)}"></${value.kind}>`:''}<div class="bottleLetter">${e(value.body)}</div><footer class="bottleFoot"><button class="bottleDelete" id="bottleDelete">删除漂流瓶</button><button class="bottleAction" data-bottle-close>收好这封信</button></footer>`}
      </section></div>`;
    }
    bindDialog();if(session.draft&&value.kind!=='text')drawRecord();updateCount();
  }
  function bindDialog(){
    dialog.querySelectorAll('[data-bottle-close]').forEach(b=>b.onclick=()=>close());
    dialog.querySelectorAll('[data-bottle-theme]').forEach(b=>b.onclick=()=>{session.value.theme=b.dataset.bottleTheme;dialog.querySelector('.bottleDialogScene').dataset.theme=session.value.theme;dialog.querySelectorAll('[data-bottle-theme]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));changed()});
    dialog.querySelectorAll('[data-bottle-mode]').forEach(b=>b.onclick=async()=>{
      if(b.dataset.bottleMode===session.value.kind)return;
      if(session.value.has_media||session.uploadBlob||session.recorder?.state==='recording'){
        showConfirm('更换类型会移除这份录音或视频','更换',async()=>{await stopRecord();await chain.catch(()=>{});if(session.value.has_media){const out=await request('/api/bottles/'+session.value.id+'/remove-media',{});metadata(out,session)}release();session.uploadBlob=null;session.recordError=false;session.value.kind=b.dataset.bottleMode;session.value.media_url=null;if(await persist())drawDialog()});return;
      }
      snapshot();session.value.kind=b.dataset.bottleMode;if(await persist())drawDialog();
    });
    for(const id of ['bottleTitle','bottleBody','bottleDate']){const node=$b('#'+id);if(node)node.addEventListener('input',changed)}
    dialog.querySelectorAll('[data-bottle-days],[data-bottle-months],[data-bottle-years]').forEach(b=>b.onclick=()=>{
      const d=new Date();d.setSeconds(0,0);if(b.dataset.bottleDays)d.setDate(d.getDate()+Number(b.dataset.bottleDays));
      if(b.dataset.bottleMonths){const day=d.getDate();d.setDate(1);d.setMonth(d.getMonth()+Number(b.dataset.bottleMonths));d.setDate(Math.min(day,new Date(d.getFullYear(),d.getMonth()+1,0).getDate()))}
      if(b.dataset.bottleYears){const month=d.getMonth();d.setFullYear(d.getFullYear()+Number(b.dataset.bottleYears));if(d.getMonth()!==month)d.setDate(0)}
      $b('#bottleDate').value=toInput(d.getTime()/1000);changed();
    });
    const retry=$b('#bottleRetrySave');if(retry)retry.onclick=()=>persist();
    const seal=$b('#bottleSeal');if(seal)seal.onclick=async()=>{
      snapshot();if(!session.value.unlock_at||session.value.unlock_at<=Date.now()/1000){status('请选择未来的开启时间',true);$b('#bottleDate').focus();return}
      if(!await prepare())return;
      if(!session.value.body.trim()&&!session.value.has_media){status('先留下一段文字、录音或视频',true);return}
      if(session.value.kind!=='text'&&!session.value.has_media){status('请先录制或选择媒体',true);return}
      showConfirm(`约定 ${date(session.value.unlock_at)} 重逢\n封存后无法修改，也无法提前开启`,'确认封存',async()=>{
        busy(true);try{const out=await request('/api/bottles/'+session.value.id+'/seal',{revision:session.value.revision});localStorage.removeItem(PREFIX+session.value.id);release();session={value:out,draft:false};drawDialog();toast('已寄向未来');await render()}catch(err){status(err.message,true);busy(false);throw err}
      });
    };
    const unseal=$b('#bottleUnseal');if(unseal)unseal.onclick=async()=>{unseal.disabled=true;try{const out=await request('/api/bottles/'+session.value.id+'/open',{});session.value=out;drawDialog();await render();poll()}catch(err){$b('#bottleDialogError').textContent=err.message;unseal.disabled=false}};
    const del=$b('#bottleDelete');if(del)del.onclick=()=>showConfirm('删除后无法找回这份内容','确认删除',async()=>{
      await stopRecord();await chain.catch(()=>{});const id=session.value.id;await request('/api/bottles/'+id+'/delete',{});localStorage.removeItem(PREFIX+id);release();session=null;dialog.close();dialog.replaceChildren();await render();poll();
    });
  }
  function showConfirm(message,label,action){
    let box=$b('#bottleSealConfirm');if(!box){box=document.createElement('div');box.id='bottleSealConfirm';dialog.querySelector('.bottleLock')?.append(box)}
    box.innerHTML=`<div class="bottleConfirm"><p style="white-space:pre-line">${e(message)}</p><div><button class="bottleAction" id="bottleConfirmCancel">再想想</button><button class="bottleAction primary" id="bottleConfirmYes">${e(label)}</button></div><p id="bottleConfirmError" role="alert"></p></div>`;
    $b('#bottleConfirmCancel').onclick=()=>box.replaceChildren();$b('#bottleConfirmYes').onclick=async event=>{event.currentTarget.disabled=true;try{await action()}catch(err){if($b('#bottleConfirmError'))$b('#bottleConfirmError').textContent=err.message;if($b('#bottleConfirmYes'))$b('#bottleConfirmYes').disabled=false}};
    box.scrollIntoView({block:'nearest',behavior:'smooth'});$b('#bottleConfirmCancel').focus();
  }
  function drawRecord(){
    const box=$b('#bottleRecord');if(!box)return;const value=session.value,src=session.recordingPreview?null:session.objectURL||value.media_url;
    box.innerHTML=`${src?`<${value.kind} controls preload="metadata" src="${e(src)}"></${value.kind}>`:value.kind==='video'?'<video id="bottleLiveVideo" autoplay muted playsinline></video>':'<canvas id="bottleWave" width="500" height="68" aria-label="录音音量"></canvas>'}
      <div class="bottleRecordControls"><button type="button" id="bottleRecordStart">${src?'重新录制':value.kind==='audio'?'开始录音':'开始录像'}</button>${src?'<button type="button" id="bottleMediaRemove">移除</button>':''}<span id="bottleRecordTime"></span></div><button type="button" class="bottleUpload" id="bottleFileButton">选择已有${value.kind==='audio'?'录音':'视频'}</button><input id="bottleFile" type="file" accept="${value.kind==='audio'?'audio/*,.m4a,.mp3,.wav,.ogg,.webm,.flac':'video/*,.mp4,.webm,.mov'}" hidden><small>最长录制 10 分钟 · 文件不超过 100 MB</small><small id="bottleMediaError" role="alert"></small>${session.uploadBlob?'<button type="button" class="bottleUpload" id="bottleUploadRetry">重试上传</button>':''}`;
    $b('#bottleRecordStart').onclick=()=>session.recorder?.state==='recording'?stopRecord():startRecord();
    $b('#bottleFileButton').onclick=()=>$b('#bottleFile').click();$b('#bottleFile').onchange=async event=>{const file=event.target.files?.[0];if(file){if(file.size>100*1024*1024){mediaError('文件超过 100 MB，请选择较短的录音或视频');return}await uploadBlob(file)}};
    const retry=$b('#bottleUploadRetry');if(retry)retry.onclick=()=>uploadBlob(session.uploadBlob);
    const remove=$b('#bottleMediaRemove');if(remove)remove.onclick=async()=>{try{await chain.catch(()=>{});const out=await request('/api/bottles/'+session.value.id+'/remove-media',{});metadata(out,session);release();session.objectURL=null;session.uploadBlob=null;session.recordError=false;drawRecord()}catch(err){mediaError(err.message)}};
    if(!src&&value.kind==='video')$b('#bottleLiveVideo').hidden=true;
  }
  function mediaError(message){const node=$b('#bottleMediaError');if(node){node.className='bottleMediaError';node.textContent=message}}
  function normalizedMime(blob){
    const type=blob.type.split(';')[0];if(type)return type;
    const ext=(blob.name||'').split('.').pop().toLowerCase();return ({mp3:'audio/mpeg',m4a:'audio/mp4',wav:'audio/wav',ogg:'audio/ogg',flac:'audio/flac',mp4:'video/mp4',mov:'video/quicktime',webm:session.value.kind+'/webm'})[ext]||'';
  }
  async function uploadBlob(blob){
    if(!blob||!session)return false;const owner=session;
    if(blob.size>100*1024*1024||!blob.size){owner.recordError=true;owner.recordingPreview=false;drawRecord();busy(false);status('录制尚未保存',true);mediaError('录制内容为空或超过 100 MB，请重新录制或选择文件');return false}
    owner.uploadBlob=blob;owner.recordingPreview=false;
    if(!await persist()){drawRecord();mediaError('媒体尚未保存，请重试并暂时保留此窗口');return false}
    if(owner.objectURL)URL.revokeObjectURL(owner.objectURL);owner.objectURL=URL.createObjectURL(blob);drawRecord();busy(true);status('正在保存媒体');
    try{
      await enqueue(async()=>{const out=await request('/api/bottles/'+owner.value.id+'/media',undefined,{method:'POST',headers:{'Content-Type':normalizedMime(blob)},body:blob});metadata(out,owner)});
      owner.uploadBlob=null;owner.recordError=false;if(session===owner){status('草稿已保存');drawRecord();busy(false)}return true;
    }catch(err){if(session===owner){status('媒体尚未保存',true);drawRecord();mediaError(err.message+' · 可重试，暂时保留此窗口');busy(false)}return false}
  }
  async function startRecord(){
    const owner=session;if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){mediaError('此环境无法录制，请选择已有的录音或视频');return}
    busy(true);
    try{
      const stream=await navigator.mediaDevices.getUserMedia({audio:true,video:owner.value.kind==='video'?{width:{ideal:1280},height:{ideal:720},frameRate:{ideal:24,max:30}}:false});
      if(session!==owner||!dialog.open){stream.getTracks().forEach(t=>t.stop());return}
      release();owner.stream=stream;owner.objectURL=null;owner.chunks=[];owner.size=0;owner.uploadBlob=null;owner.recordError=false;
      const candidates=owner.value.kind==='video'?['video/webm;codecs=vp8,opus','video/webm','video/mp4']:['audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus','audio/mp4'];
      const mime=candidates.find(x=>MediaRecorder.isTypeSupported(x));
      const recorder=new MediaRecorder(stream,{...(mime?{mimeType:mime}:{}),...(owner.value.kind==='video'?{videoBitsPerSecond:1600000,audioBitsPerSecond:96000}:{audioBitsPerSecond:96000})});
      owner.recorder=recorder;owner.recordingPreview=true;owner.started=Date.now();drawRecord();
      owner.stopped=new Promise(resolve=>{owner.resolveStop=resolve});
      recorder.ondataavailable=event=>{if(event.data.size){owner.chunks.push(event.data);owner.size+=event.data.size;if(owner.size>95*1024*1024&&recorder.state==='recording')recorder.stop()}};
      recorder.onerror=()=>{owner.recordError=true;mediaError('录制中断，请重试或选择已有文件');if(recorder.state==='recording')recorder.stop()};
      recorder.onstop=async()=>{
        stream.getTracks().forEach(t=>t.stop());clearInterval(recordTimer);recordTimer=null;
        owner.audioContext?.close().catch(()=>{});if(owner.animation)cancelAnimationFrame(owner.animation);
        const blob=new Blob(owner.chunks,{type:recorder.mimeType||mime||owner.value.kind+'/webm'});owner.recorder=null;owner.chunks=[];
        const ok=session===owner?await uploadBlob(blob):false;owner.resolveStop(ok);
      };
      recorder.start(1000);busy(true);const button=$b('#bottleRecordStart');button.disabled=false;button.textContent='结束录制';button.classList.add('is-recording');
      $b('#bottleFileButton').disabled=true;
      if(owner.value.kind==='video'){const video=$b('#bottleLiveVideo');video.hidden=false;video.srcObject=stream}
      else drawWave(owner,stream);
      const tick=()=>{const seconds=Math.floor((Date.now()-owner.started)/1000),node=$b('#bottleRecordTime');if(node)node.textContent=String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0');if(seconds>=600&&recorder.state==='recording')recorder.stop()};tick();recordTimer=setInterval(tick,500);
    }catch(err){if(session===owner){release();busy(false);mediaError(err.name==='NotAllowedError'?'麦克风或摄像头权限未开启，可在系统设置中允许，也可选择已有文件':err.name==='NotFoundError'?'未找到麦克风或摄像头，请连接设备或选择已有文件':'无法开始录制，请检查设备是否被其他应用占用')}}
  }
  function drawWave(owner,stream){
    try{const ctx=new AudioContext(),analyser=ctx.createAnalyser();owner.audioContext=ctx;analyser.fftSize=256;ctx.createMediaStreamSource(stream).connect(analyser);const data=new Uint8Array(analyser.frequencyBinCount),canvas=$b('#bottleWave'),paint=canvas.getContext('2d');
      const draw=()=>{if(session!==owner||owner.recorder?.state!=='recording')return;analyser.getByteFrequencyData(data);paint.clearRect(0,0,500,68);paint.fillStyle='#668e7b';for(let i=0;i<40;i++){const h=Math.max(3,data[i*2]/255*58);paint.fillRect(i*12+10,(68-h)/2,3,h)}owner.animation=requestAnimationFrame(draw)};draw();
    }catch{ /* Recording works even when an audio analyser is unavailable. */ }
  }
  async function stopRecord(){if(session?.recorder?.state==='recording'){session.recorder.stop();return session.stopped}return true}
  function bindPage(){
    if(STATE.feature!==NAME)return;
    $b('#bottleArrivalToast')?.remove();
    $b('#bottleNew')?.addEventListener('click',()=>open());$b('#bottleReload')?.addEventListener('click',()=>render());
    document.querySelectorAll('.bottlePage [data-bottle-id]').forEach(b=>b.onclick=()=>open(b.dataset.bottleId));
    document.querySelectorAll('.bottlePage [data-bottle-tab]').forEach(b=>b.onclick=()=>{page.tab=b.dataset.bottleTab;render()});
    document.querySelectorAll('.bottlePage [data-bottle-theme]').forEach(b=>b.onclick=()=>{page.theme=b.dataset.bottleTheme;localStorage.setItem('lifeos.bottle.scene',page.theme);const hero=$b('.bottleHero');hero.dataset.theme=page.theme;hero.setAttribute('aria-label',themes[page.theme]+'海面');document.querySelectorAll('.bottlePage [data-bottle-theme]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)))});
    $b('#bottleArrived')?.addEventListener('click',()=>{page.tab='arrived';render()});
  }
  function badge(count){const nav=$b('[data-nav-id="bottle"]');if(!nav)return;let node=nav.querySelector('.bottleBadge');if(!count){node?.remove();return}if(!node){node=document.createElement('span');node.className='bottleBadge';nav.append(node)}node.textContent=count>99?'99+':count;node.setAttribute('aria-label',count+' 只漂流瓶已抵达')}
  function arrivalToast(items){
    const key=items.map(x=>x.id).join('|');if(!items.length||page.arrival===key)return;page.arrival=key;
    let node=$b('#bottleArrivalToast');node?.remove();node=document.createElement('aside');node.id='bottleArrivalToast';node.className='bottleArrivalToast';node.setAttribute('role','status');
    node.innerHTML='<span>一份来自过去的礼物，抵达了</span><button type="button">去看看</button><button type="button" aria-label="关闭提醒">×</button>';document.body.append(node);
    node.querySelector('button').onclick=()=>{node.remove();page.tab='arrived';openFeature(NAME)};node.querySelector('button:last-child').onclick=()=>node.remove();
  }
  async function poll(){
    if(polling)return;polling=true;
    try{const data=await request('/api/bottles/arrivals');page.arrivedCount=data.items.length;badge(data.items.length);if(!data.items.length){page.arrival=null;$b('#bottleArrivalToast')?.remove()}
      if(data.items.length&&data.notify&&STATE.feature!==NAME&&!dialog?.open)arrivalToast(data.items);
      if(session?.value.state==='sealed'&&data.items.some(x=>x.id===session.value.id)){session.value.state='arrived';drawDialog()}
      if(STATE.feature===NAME&&!session?.draft){const old=page.items.filter(x=>x.state==='arrived').map(x=>x.id).sort().join('|'),next=data.items.map(x=>x.id).sort().join('|');if(old!==next)await render()}
    }catch{}finally{polling=false}
  }
  function install(){
    if(installed)return;installed=true;const prior=bindSpecific;bindSpecific=function(...args){const out=prior.apply(this,args);bindPage();return out};
    const previousClose=window.lifeosPrepareToClose;window.lifeosPrepareToClose=async()=>await prepare()&&(previousClose?await previousClose():true);
    for(const name of ['openFeature','openProductDock']){
      const previous=name==='openFeature'?openFeature:openProductDock;
      const next=async function(...args){if(session&&!await close(false))return;return previous.apply(this,args)};
      if(name==='openFeature')openFeature=next;else openProductDock=next;
    }
    RENDERERS[NAME]=renderPage;if(STATE.feature===NAME)render();poll();
  }
  RENDERERS[NAME]=renderPage;
  window.addEventListener('lifeos:i2-ready',()=>{installed=false;install()},{once:true});setTimeout(install,1200);
  window.addEventListener('beforeunload',event=>{if(session?.draft){snapshot();try{shadow(snapshot())}catch{}if(session.recorder||session.uploadBlob){event.preventDefault();event.returnValue=''}}});
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&session?.draft)persist();else poll()});
  new MutationObserver(()=>badge(page.arrivedCount||0)).observe(document.getElementById('rooms'),{childList:true});
  window.lifeosDesktop?.onBottleArrival?.(async id=>{page.tab='arrived';await openFeature(NAME);await open(id)});
  setInterval(poll,10000);
  window.lifeosBottles={open,prepare,poll,close};
})();
