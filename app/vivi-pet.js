/* ViVi's original GIF animations, with the source pet's independent behavior model. */
(() => {
  'use strict';
  const RENDERER='vivi-gif';
  const STANDARD_ACTIONS={idle:'sit','running-right':'walk_right','running-left':'walk_left',waving:'interact',jumping:'jump',failed:'die',waiting:'sleep',running:'special1',review:'relax'};
  const DEFAULTS={scale:1,dragAction:'fly',autoBehavior:true,edgeHide:true};
  const BEHAVIORS=[['sit',14,2,4],['relax',16,1,3],['sleep',5,3,5],['special1',10,1,3],['walk_left',15,2,5],['walk_right',15,2,5],['interact',9,1,1],['jump',6,1,1],['fly',4,1,1],['sweat',3,1,1],['special',3,1,1]];
  const QUIET=new Set(['sit','relax','sleep','special1']);
  const FRAME_LIMIT=48*1024*1024,SOURCE_LIMIT=32*1024*1024,DECODER_LIMIT=4;
  const sources=new Map(),frames=new Map();
  const metrics={requests:0,decodes:0,frameHits:0};
  let frameBytes=0,sourceBytes=0,mounts=0,cacheEpoch=0;
  const touch=(map,key,value)=>{map.delete(key);map.set(key,value);};
  function trimResources(){
    for(const [key,entry] of frames){if(frameBytes<=FRAME_LIMIT&&frames.size<=512)break;if(!entry.refs&&entry.image){frames.delete(key);frameBytes-=entry.bytes;entry.image.close();}}
    let decoders=[...sources.values()].filter(entry=>entry.decoder).length;
    for(const entry of sources.values()){if(decoders<=DECODER_LIMIT)break;if(entry.decoder&&!entry.busy){entry.decoder.close();entry.decoder=null;decoders--;}}
    for(const [key,entry] of sources){if(sourceBytes<=SOURCE_LIMIT)break;if(entry.data&&!entry.busy){sources.delete(key);sourceBytes-=entry.data.byteLength;entry.decoder?.close();}}
  }
  function clearResources(){
    cacheEpoch++;for(const entry of frames.values())entry.image?.close();frames.clear();frameBytes=0;
    for(const entry of sources.values())entry.decoder?.close();sources.clear();sourceBytes=0;
  }
  async function sourceFor(descriptor){
    const url=new URL(descriptor.asset_url,document.baseURI).href;
    let entry=sources.get(url);
    if(!entry){
      entry={url,data:null,decoder:null,decoderReady:null,busy:0,queue:Promise.resolve(),epoch:cacheEpoch};sources.set(url,entry);
      entry.ready=(async()=>{metrics.requests++;const response=await fetch(url,{cache:'force-cache'});if(!response.ok)throw new Error('ViVi 动作文件暂不可用');const data=await response.arrayBuffer();if(entry.epoch!==cacheEpoch)throw new Error('ViVi 展示已结束');entry.data=data;sourceBytes+=data.byteLength;return entry;})();
      entry.ready.catch(()=>{if(sources.get(url)===entry)sources.delete(url);});
    }
    touch(sources,url,entry);return entry.ready;
  }
  async function decoderFor(entry){
    if(entry.decoder?.tracks.selectedTrack?.frameCount)return entry.decoder;
    if(!entry.decoderReady){
      entry.decoderReady=(async()=>{const decoder=new ImageDecoder({data:entry.data,type:'image/gif',preferAnimation:true});await decoder.tracks.ready;if(entry.epoch!==cacheEpoch){decoder.close();throw new Error('ViVi 展示已结束');}if(!decoder.tracks.selectedTrack?.frameCount){decoder.close();throw new Error('ViVi 动作没有可用画面');}entry.decoder=decoder;return decoder;})().finally(()=>{entry.decoderReady=null;});
    }
    return entry.decoderReady;
  }
  async function acquireFrame(descriptor,index,width,height){
    const ratio=Math.min(1,width/descriptor.width,height/descriptor.height),pixelWidth=Math.max(1,Math.ceil(descriptor.width*ratio)),pixelHeight=Math.max(1,Math.ceil(descriptor.height*ratio));
    const key=[descriptor.asset_url,pixelWidth,pixelHeight,index].join('|');let entry=frames.get(key);
    if(entry){metrics.frameHits++;touch(frames,key,entry);}else{
      entry={image:null,refs:0,bytes:pixelWidth*pixelHeight*4,epoch:cacheEpoch};frames.set(key,entry);
      entry.ready=(async()=>{
        const source=await sourceFor(descriptor);source.busy++;
        const work=source.queue.catch(()=>{}).then(async()=>{
          if(entry.epoch!==cacheEpoch)throw new Error('ViVi 展示已结束');const decoder=await decoderFor(source);metrics.decodes++;
          const result=await decoder.decode({frameIndex:index,completeFramesOnly:true});
          try{return await createImageBitmap(result.image,{resizeWidth:pixelWidth,resizeHeight:pixelHeight,resizeQuality:'low'});}finally{result.image.close();}
        });source.queue=work;
        try{const bitmap=await work;if(entry.epoch!==cacheEpoch){bitmap.close();throw new Error('ViVi 展示已结束');}entry.image=bitmap;frameBytes+=entry.bytes;return bitmap;}finally{source.busy--;trimResources();}
      })();entry.ready.catch(()=>{if(frames.get(key)===entry)frames.delete(key);});
    }
    entry.refs++;
    try{const bitmap=await entry.ready;let released=false;return{image:bitmap,release(){if(released)return;released=true;entry.refs--;trimResources();}};}catch(error){entry.refs--;throw error;}
  }
  const validPoint=point=>Number.isFinite(point?.x)&&Number.isFinite(point?.y);
  const weighted=(items,random)=>{let value=random()*items.reduce((sum,[,weight])=>sum+weight,0);for(const [id,weight] of items){value-=weight;if(value<=0)return id}return items[0][0]};
  function mount(element,item={},options={}){
    if(!element)throw new Error('ViVi 需要一个展示位置');
    const mode=options.mode==='companion'?'companion':'preview';
    const stage=document.createElement('span');stage.className='viviPetStage';stage.dataset.ready='false';
    const canvas=document.createElement('canvas');canvas.className='viviPetCanvas';canvas.setAttribute('aria-hidden','true');
    const image=document.createElement('img');image.className='viviPetImage';image.alt='';image.draggable=false;image.hidden=true;
    stage.append(canvas,image);element.append(stage);
    const context=canvas.getContext('2d',{alpha:true}),cleanup=[];mounts++;
    const state={action:'sit',manualLoop:null,onceAction:null,x:0,y:0,width:Number(options.width)||144,height:Number(options.height)||156,hiddenEdge:null,dragging:false,dx:0,dy:0,groundY:null,lockedUntil:0,visible:true,motion:true};
    let settings={...DEFAULTS,...item.settings,...options.settings},manifest=null,table=new Map(),destroyed=false,raf=null,lastTime=null,frame=0,cycle=0,elapsed=0,asset=null,lastLease=null,lastPainted=-1,painting=false,generation=0,loadedGeneration=0,nativeGif=false,drag=null,pausedAt=null,sizeApplied=false,warmup=null,oneShot=null,notifiedFrame='',fallbackURL=null,autoPlan=null,pendingEdge=null;
    const recent=[],random=()=>Math.max(0,Math.min(1-Number.EPSILON,Number((options.random||Math.random)())||0)),integer=(min,max)=>min+Math.floor(random()*(max-min+1));
    const baseSize={width:state.width,height:state.height};
    const bounds=()=>{const value=typeof options.bounds==='function'?options.bounds():options.bounds;return{width:Math.max(state.width,Number(value?.width)||document.documentElement.clientWidth),height:Math.max(state.height,Number(value?.height)||document.documentElement.clientHeight)}};
    const snapshot=()=>({...state,settings:{...settings},frame,renderer:RENDERER,animation:{sequence:generation,ready:loadedGeneration===generation,lastPainted,painting,elapsed_ms:elapsed,frameCount:asset?.frames||0},behavior:{enabled:mode==='companion'&&settings.autoBehavior,automatic:Boolean(autoPlan),cycles_remaining:autoPlan?.cyclesRemaining||0,history:[...recent],pending_edge:pendingEdge}});
    const listen=(target,type,handler,extra)=>{target.addEventListener(type,handler,extra);cleanup.push(()=>target.removeEventListener(type,handler,extra));};
    function notify(){
      if(mode!=='companion')return;
      if(options.positionElement){options.positionElement.style.left=state.x+'px';options.positionElement.style.top=state.y+'px';}
      options.onPosition?.({x:state.x,y:state.y,width:state.width,height:state.height,hiddenEdge:state.hiddenEdge,dragging:state.dragging});
    }
    function clamp(){const area=bounds();state.x=Math.max(0,Math.min(area.width-state.width,state.x));state.y=Math.max(0,Math.min(area.height-state.height,state.y));}
    const isMirrored=()=>asset?.id==='hide'&&state.hiddenEdge?state.hiddenEdge==='left':Boolean(asset?.mirror);
    const hideOffset=width=>asset?.id==='hide'&&state.hiddenEdge?width*(47/150):0;
    function imageTransform(){const ratio=Math.min(state.width/asset.width,state.height/asset.height),offset=hideOffset(asset.width*ratio);image.style.transform=(isMirrored()?'scaleX(-1) ':'')+(offset?'translateX(-'+offset+'px)':'');}
    function draw(source){
      if(!source||destroyed)return;
      const width=source.naturalWidth||source.displayWidth||source.width||asset?.width,height=source.naturalHeight||source.displayHeight||source.height||asset?.height;
      if(!width||!height)return;
      context.clearRect(0,0,canvas.width,canvas.height);
      const ratio=Math.min(canvas.width/width,canvas.height/height),drawWidth=width*ratio,drawHeight=height*ratio;
      // Keep the feet on one stable baseline; wide/long GIFs retain the whole scene.
      // The source tail points left: mirror at the left edge and align its tip,
      // removing only the transparent horizontal gutter while hidden.
      context.save();if(isMirrored()){context.translate(canvas.width,0);context.scale(-1,1);}
      context.drawImage(source,(canvas.width-drawWidth)/2-hideOffset(drawWidth),canvas.height-drawHeight,drawWidth,drawHeight);context.restore();
    }
    function applySize(){
      state.width=baseSize.width*settings.scale;state.height=baseSize.height*settings.scale;
      stage.style.width=state.width+'px';stage.style.height=state.height+'px';
      const ratio=Math.min(2,window.devicePixelRatio||1);canvas.width=Math.round(state.width*ratio);canvas.height=Math.round(state.height*ratio);
      sizeApplied=true;if(lastLease)draw(lastLease.image);else if(nativeGif&&image.complete)draw(image);
      if(nativeGif&&asset)imageTransform();
      options.onResize?.({width:state.width,height:state.height});if(!state.hiddenEdge)clamp();else hide(state.hiddenEdge,false);notify();
    }
    function presented(index,sequence){
      const key=[sequence,cycle,index].join(':');if(key===notifiedFrame)return;notifiedFrame=key;
      const time=performance.now(),duration=asset.frame_durations_ms?.[index]||50;
      if(elapsed>=duration){elapsed=0;lastTime=time;}
      if(oneShot?.sequence===sequence&&index===0&&oneShot.startedAt===null)oneShot.startedAt=time;
      options.onFrame?.({action:asset.id,frame:index,frames:asset.frames,duration_ms:duration,time,cycle,sequence});
    }
    async function paintFrame(){
      if(destroyed||loadedGeneration!==generation||nativeGif||!asset||painting||lastPainted===frame)return;
      painting=true;const selected=asset,index=frame,sequence=generation;
      try{
        const lease=await acquireFrame(selected,index,canvas.width,canvas.height);
        if(destroyed||sequence!==generation){lease.release();return;}
        lastLease?.release();lastLease=lease;draw(lease.image);lastPainted=index;presented(index,sequence);
      }catch(error){if(!destroyed&&sequence===generation)options.onError?.(error);}
      finally{painting=false;}
    }
    async function load(id){
      const descriptor=table.get(id);if(!descriptor)throw new Error('ViVi 没有此动作');
      const sequence=++generation;frame=0;cycle=0;elapsed=0;lastPainted=-1;lastTime=null;
      let lease=null;
      if(typeof ImageDecoder==='function'){
        try{lease=await acquireFrame(descriptor,0,canvas.width,canvas.height)}catch(error){if(sequence===generation&&!destroyed)options.onError?.(error);}
      }
      if(sequence!==generation||destroyed){lease?.release();return;}
      if(lease){
        asset=descriptor;nativeGif=false;image.hidden=true;canvas.hidden=false;
        lastLease?.release();lastLease=lease;draw(lease.image);lastPainted=0;
      }else{
        let url=descriptor.asset_url,objectURL=null;
        if(oneShot?.sequence===sequence){
          // A GIF without its looping extension plays its unchanged source frames once.
          const source=await sourceFor(descriptor),bytes=new Uint8Array(source.data);let cut=-1,end=-1;
          for(let i=0;i<bytes.length-19;i++){if(bytes[i]===0x21&&bytes[i+1]===0xff&&bytes[i+2]===11){const name=String.fromCharCode(...bytes.subarray(i+3,i+14));if(name==='NETSCAPE2.0'||name==='ANIMEXTS1.0'){cut=i;let at=i+14;while(at<bytes.length&&bytes[at])at+=1+bytes[at];end=at+1;break;}}}
          let data=bytes;if(cut>=0){data=new Uint8Array(bytes.length-(end-cut));data.set(bytes.subarray(0,cut));data.set(bytes.subarray(end),cut);}objectURL=URL.createObjectURL(new Blob([data],{type:'image/gif'}));url=objectURL;
        }
        const candidate=new Image();candidate.src=url;await candidate.decode();
        if(sequence!==generation||destroyed){if(objectURL)URL.revokeObjectURL(objectURL);return;}
        asset=descriptor;nativeGif=true;lastLease?.release();lastLease=null;
        if(fallbackURL)URL.revokeObjectURL(fallbackURL);fallbackURL=objectURL;image.src=url;imageTransform();
        await image.decode();if(sequence!==generation||destroyed)return;
        image.hidden=!state.motion;canvas.hidden=state.motion;if(!state.motion)draw(candidate);
      }
      loadedGeneration=sequence;lastPainted=0;presented(0,sequence);stage.dataset.ready='true';stage.dataset.action=id;options.onAction?.({action:id,loop:state.manualLoop===id,once:Boolean(oneShot)});schedule();
    }
    function action(id,hold,manual,{once=false,onComplete,automatic=false,cycles=1}={}){
      if(!table.has(id))return Promise.resolve(false);
      if(manual&&loadedGeneration===generation&&state.manualLoop===id&&state.action===id&&stage.dataset.action===id)return Promise.resolve(true);
      oneShot=once?{id,sequence:generation+1,onComplete,startedAt:null}:null;state.onceAction=once?id:null;autoPlan=automatic?{id,cyclesRemaining:cycles}:null;pendingEdge=null;
      state.action=id;state.manualLoop=manual?id:null;state.lockedUntil=once||hold===Infinity?Infinity:performance.now()+hold;
      state.dx=mode==='companion'?(id==='walk_left'?-1.4:id==='walk_right'?1.4:0):0;
      state.dy=0;state.groundY=null;
      if(id!=='hide')state.hiddenEdge=null;
      if(mode==='companion'&&id==='jump'){state.groundY=state.y;state.dy=-8;}
      const loading=load(id),sequence=generation;return loading.then(()=>{if(sequence===generation&&state.action===id)state.lockedUntil=oneShot||hold===Infinity?Infinity:performance.now()+hold;return true;});
    }
    function completeCycle(){
      const current=oneShot;if(!current||current.sequence!==generation)return;
      const result={action:current.id,frames:asset.frames,duration_ms:asset.duration_ms,elapsed_ms:performance.now()-current.startedAt,sequence:current.sequence,renderer:RENDERER};
      oneShot=null;state.onceAction=null;
      if(state.hiddenEdge){const edge=state.hiddenEdge;state.hiddenEdge=null;state.x=edge==='left'?8:bounds().width-state.width-8;clamp();notify();}
      idle('resume').catch(error=>options.onError?.(error));
      current.onComplete?.(result);if(options.onComplete!==current.onComplete)options.onComplete?.(result);
    }
    function automatic(id,{reason='choice',cycles}={}){
      const descriptor=BEHAVIORS.find(value=>value[0]===id),count=cycles??integer(descriptor?.[2]||1,descriptor?.[3]||1);
      recent.push(id);if(recent.length>8)recent.shift();
      options.onBehavior?.({action:id,cycles:count,reason,time:performance.now(),wandering:settings.autoBehavior,history:[...recent]});
      return action(id,Infinity,false,{automatic:true,cycles:count});
    }
    function idle(reason){return mode==='companion'?automatic('sit',{reason,cycles:integer(1,2)}):action('sit',Infinity,false);}
    function next(preferred){
      if(state.dragging||state.hiddenEdge||state.manualLoop||oneShot||mode!=='companion')return;
      const area=bounds(),last=recent.slice(-3),walked=last.slice(-1).some(id=>id.startsWith('walk_'));
      const choices=BEHAVIORS.filter(([id])=>id!==state.action&&table.has(id)&&(settings.autoBehavior||QUIET.has(id))&&(id!=='walk_left'||state.x>32)&&(id!=='walk_right'||area.width-state.width-state.x>32)).map(([id,weight])=>[id,weight*(last.includes(id)?.28:1)*(walked&&id.startsWith('walk_')?.45:1)]);
      const id=preferred&&table.has(preferred)?preferred:weighted(choices.length?choices:[['sit',1]],random);
      automatic(id).catch(error=>options.onError?.(error));
    }
    function finishAutomatic(){
      if(state.hiddenEdge){const edge=state.hiddenEdge;state.hiddenEdge=null;state.x=edge==='left'?8:bounds().width-state.width-8;clamp();notify();next(settings.autoBehavior?(edge==='left'?'walk_right':'walk_left'):undefined);}
      else if(pendingEdge&&settings.autoBehavior&&settings.edgeHide&&random()<.14)hide(pendingEdge);
      else next();
    }
    function hide(edge,animate=true){
      if(mode!=='companion')return;
      const area=bounds(),peek=Math.max(24,state.width*.216);state.hiddenEdge=edge;state.dx=0;state.dy=0;state.groundY=null;
      state.x=edge==='left'?-(state.width-peek):area.width-peek;state.lockedUntil=state.manualLoop||oneShot?Infinity:state.lockedUntil;
      if(animate){automatic('hide',{reason:'edge',cycles:integer(2,4)}).catch(error=>options.onError?.(error));}else{if(lastLease)draw(lastLease.image);if(nativeGif&&asset)imageTransform();}notify();
    }
    function wake(){
      if(!state.hiddenEdge||oneShot)return false;
      const edge=state.hiddenEdge;state.hiddenEdge=null;state.manualLoop=null;state.x=edge==='left'?8:bounds().width-state.width-8;clamp();notify();
      automatic('sweat',{reason:'wake',cycles:1}).catch(error=>options.onError?.(error));return true;
    }
    function updateMotion(now,delta){
      if(mode!=='companion'||state.dragging)return;
      const step=Math.min(delta,100)/16.6667;
      if(!state.hiddenEdge&&state.groundY!==null){state.y=Math.max(0,state.y+state.dy*step);state.dy+=.18*step;if(state.y>=state.groundY){state.y=state.groundY;state.dy=0;state.groundY=null;}notify();}
      if(!state.hiddenEdge&&state.dx){
        const area=bounds(),max=area.width-state.width;state.x+=state.dx*step;
        if(state.x<=0||state.x>=max){
          state.x=Math.max(0,Math.min(state.x,max));
          if(!state.manualLoop&&!oneShot){if(autoPlan){pendingEdge=state.x<=0?'left':'right';state.dx=0;}else next();}
        }notify();
      }
      if(now>=state.lockedUntil&&!state.manualLoop){
        if(!state.hiddenEdge)next();
      }
    }
    function tick(now){
      raf=null;if(destroyed||!state.visible||!state.motion||document.hidden)return;
      const delta=lastTime===null?0:Math.max(0,now-lastTime);lastTime=now;updateMotion(now,delta);
      if(loadedGeneration===generation&&asset?.frames){
        elapsed+=delta;const duration=asset.frame_durations_ms?.[frame]||50;
        // Never skip a source frame to catch up. A delayed draw rebases its clock.
        if(lastPainted===frame&&elapsed>=duration){
          elapsed-=duration;
          if(frame===asset.frames-1&&oneShot){completeCycle();schedule();return;}
          if(frame===asset.frames-1&&autoPlan&&--autoPlan.cyclesRemaining<=0){finishAutomatic();schedule();return;}
          frame=(frame+1)%asset.frames;if(!frame)cycle++;
          if(elapsed>=(asset.frame_durations_ms?.[frame]||50))elapsed=0;
          if(nativeGif){lastPainted=frame;presented(frame,generation);}
        }
        if(!nativeGif)paintFrame();
      }schedule();
    }
    function stop(){if(raf!==null)cancelAnimationFrame(raf);raf=null;lastTime=null;if(pausedAt===null)pausedAt=performance.now();}
    function schedule(){if(raf===null&&!destroyed&&state.visible&&state.motion&&!document.hidden){if(pausedAt!==null){if(Number.isFinite(state.lockedUntil))state.lockedUntil+=performance.now()-pausedAt;pausedAt=null;}raf=requestAnimationFrame(tick);}}
    function select(id,{loop=true,onComplete}={}){
      if(id===null||id==='auto'){state.manualLoop=null;state.hiddenEdge=null;clamp();notify();return idle('reset');}
      id=STANDARD_ACTIONS[id]||id;if(!table.has(id))return Promise.reject(new Error('ViVi 没有此动作'));
      const result=action(id,loop?Infinity:table.get(id).duration_ms,loop,{once:!loop,onComplete});
      if(id==='hide'&&mode==='companion')hide(state.x<bounds().width/2?'left':'right',false);
      return result;
    }
    function playOnce(id,{force=false,duration,onComplete}={}){id=STANDARD_ACTIONS[id]||id;if((state.manualLoop||oneShot)&&!force)return Promise.resolve(false);if(!table.has(id))return Promise.resolve(false);return action(id,Math.max(table.get(id).duration_ms,Number(duration)||0),false,{once:true,onComplete});}
    function setPosition(x,y){const point=typeof x==='object'?x:{x,y};if(!validPoint(point))return snapshot();state.x=point.x;state.y=point.y;if(!state.hiddenEdge)clamp();notify();return snapshot();}
    function beginDrag(point){
      if(mode!=='companion'||!validPoint(point)||destroyed)return false;
      if(oneShot&&state.hiddenEdge){const edge=state.hiddenEdge;state.hiddenEdge=null;state.x=edge==='left'?8:bounds().width-state.width-8;clamp();if(lastLease)draw(lastLease.image);if(nativeGif&&asset)imageTransform();notify();}else if(wake())return false;
      drag={dx:point.x-state.x,dy:point.y-state.y,startX:state.x,startY:state.y,loop:state.manualLoop,once:Boolean(oneShot),moved:false};state.dragging=true;state.dx=0;state.dy=0;state.groundY=null;
      if(!oneShot){autoPlan=null;pendingEdge=null;load(settings.dragAction).catch(error=>options.onError?.(error));}notify();return true;
    }
    function moveDrag(point){if(!drag||!validPoint(point))return false;const x=point.x-drag.dx,y=point.y-drag.dy;if(Math.hypot(x-drag.startX,y-drag.startY)>3)drag.moved=true;state.x=x;state.y=y;clamp();notify();return true;}
    function endDrag(point){
      if(!drag)return false;if(validPoint(point))moveDrag(point);const prior=drag;drag=null;state.dragging=false;
      if(prior.once){notify();return true;}
      if(prior.loop){select(prior.loop).catch(error=>options.onError?.(error));}
      else if(prior.moved&&settings.edgeHide&&(state.x<=2||state.x>=bounds().width-state.width-2))hide(state.x<=2?'left':'right');
      else playOnce('interact',{force:true}).catch(error=>options.onError?.(error));notify();return true;
    }
    function cancelDrag(){if(!drag)return;const prior=drag;drag=null;state.dragging=false;setPosition(prior.startX,prior.startY);if(!prior.once)select(prior.loop).catch(error=>options.onError?.(error));}
    function setSettings(nextSettings){
      const next={...settings};if(Number.isFinite(Number(nextSettings?.scale)))next.scale=Math.max(.4,Math.min(2.5,Number(nextSettings.scale)));
      if(['fly','interact','sweat','jump'].includes(nextSettings?.dragAction))next.dragAction=nextSettings.dragAction;
      for(const key of ['autoBehavior','edgeHide'])if(typeof nextSettings?.[key]==='boolean')next[key]=nextSettings[key];
      const changed=Object.keys(DEFAULTS).some(key=>next[key]!==settings[key]),resized=!sizeApplied||next.scale!==settings.scale;settings=next;
      if(resized)applySize();if(!changed)return {...settings};
      if(!settings.edgeHide&&!oneShot)wake();if(!settings.autoBehavior&&!state.manualLoop&&!oneShot&&state.dx){state.dx=0;pendingEdge=null;}options.onSettings?.({...settings});return {...settings};
    }
    function setMotion(enabled){state.motion=Boolean(enabled);if(!state.motion){stop();if(nativeGif&&image.complete){draw(image);image.hidden=true;canvas.hidden=false;}}else{if(nativeGif){canvas.hidden=true;image.hidden=false;}schedule();}}
    function setVisible(visible){state.visible=Boolean(visible);stage.hidden=!state.visible;if(state.visible)schedule();else stop();}
    function resize(width,height){const nextWidth=Number(width)>0?Number(width):baseSize.width,nextHeight=Number(height)>0?Number(height):baseSize.height;if(sizeApplied&&nextWidth===baseSize.width&&nextHeight===baseSize.height)return snapshot();baseSize.width=nextWidth;baseSize.height=nextHeight;applySize();lastPainted=-1;if(!nativeGif)paintFrame();return snapshot();}
    function destroy(){if(destroyed)return;destroyed=true;generation++;oneShot=null;stop();if(warmup!==null)clearTimeout(warmup);cleanup.forEach(fn=>fn());lastLease?.release();lastLease=null;if(fallbackURL)URL.revokeObjectURL(fallbackURL);image.removeAttribute('src');stage.remove();mounts--;if(!mounts)clearResources();}
    function bind(){
      listen(document,'visibilitychange',()=>{if(document.hidden)stop();else schedule();});listen(window,'resize',()=>{applySize();});
      if(!options.interactive||mode!=='companion')return;
      const pointerPoint=event=>{const rect=options.world?.getBoundingClientRect?.()||{left:0,top:0};return{x:event.clientX-rect.left,y:event.clientY-rect.top}};
      listen(element,'pointerdown',event=>{if(event.button===0&&beginDrag(pointerPoint(event))){element.setPointerCapture?.(event.pointerId);event.preventDefault();}});
      listen(element,'pointermove',event=>{if(state.dragging){moveDrag(pointerPoint(event));event.preventDefault();}});
      listen(element,'pointerup',event=>endDrag(pointerPoint(event)));listen(element,'pointercancel',cancelDrag);
      listen(element,'contextmenu',event=>{event.preventDefault();options.onContextMenu?.({x:event.clientX,y:event.clientY,actions:[...table.values()]});});
    }
    const ready=(async()=>{
      if(Array.isArray(item.actions)&&item.actions.length)manifest=item;
      else{const response=await fetch(item.manifest_url||'/assets/pets/vivi/pet.json',{cache:'force-cache'});if(!response.ok)throw new Error('ViVi 动作目录暂不可用');manifest=await response.json();}
      if(destroyed)return;
      const base=manifest.assetBase||'/assets/pets/vivi/';
      for(const descriptor of manifest.actions||[]){if(!/^[a-z0-9_-]+$/.test(descriptor.id)||(!descriptor.asset_url&&!/^[a-z0-9]+\.gif$/.test(descriptor.asset||'')))continue;table.set(descriptor.id,{...descriptor,asset_url:descriptor.asset_url||base+descriptor.asset,duration_ms:Number(descriptor.duration_ms)||1000});}
      if(!table.has('sit'))throw new Error('ViVi 动作目录缺少待机画面');
      settings={...DEFAULTS,...manifest.settings,...settings};setSettings(settings);const point=options.position;if(validPoint(point))setPosition(point);else{const area=bounds();setPosition(Math.max(0,area.width-state.width-28),Math.max(0,area.height-state.height-28));}
      bind();await (mode==='companion'?automatic(manifest.defaultAction||'sit',{reason:'start'}):action(manifest.defaultAction||'sit',Infinity,false));
      if(mode==='companion'&&typeof ImageDecoder==='function')warmup=setTimeout(()=>{warmup=null;if(destroyed)return;for(const id of new Set([settings.dragAction,'interact','hide'])){const descriptor=table.get(id);if(descriptor)acquireFrame(descriptor,0,canvas.width,canvas.height).then(lease=>lease.release()).catch(()=>{});}},120);
      return snapshot();
    })();
    ready.catch(error=>{if(!destroyed){stage.dataset.ready='false';options.onError?.(error);}});
    return {ready,select,playOnce,setSettings,setMotion,setVisible,resize,setPosition,beginDrag,moveDrag,endDrag,cancelDrag,wake,interact:()=>wake()||playOnce('interact'),getState:snapshot,destroy,get settings(){return{...settings}},get actions(){return[...table.values()]},get element(){return stage}};
  }
  window.lifeosViVi={renderer:RENDERER,mount,standardActions:STANDARD_ACTIONS,cacheStats:()=>({...metrics,mounts,frameBytes,sourceBytes,frames:frames.size,decoders:[...sources.values()].filter(entry=>entry.decoder).length,frameLimit:FRAME_LIMIT,sourceLimit:SOURCE_LIMIT})};
})();
