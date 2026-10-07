/* ViVi's original GIF animations, with the source pet's independent behavior model. */
(() => {
  'use strict';
  const RENDERER='vivi-gif';
  const STANDARD_ACTIONS={idle:'sit','running-right':'walk_right','running-left':'walk_left',waving:'interact',jumping:'jump',failed:'die',waiting:'sleep',running:'special1',review:'relax'};
  const DEFAULTS={scale:1,dragAction:'fly',autoBehavior:true,edgeHide:true};
  const validPoint=point=>Number.isFinite(point?.x)&&Number.isFinite(point?.y);
  const weighted=items=>{let value=Math.random()*items.reduce((sum,[,weight])=>sum+weight,0);for(const [id,weight] of items){value-=weight;if(value<=0)return id}return items[0][0]};
  function mount(element,item={},options={}){
    if(!element)throw new Error('ViVi 需要一个展示位置');
    const mode=options.mode==='companion'?'companion':'preview';
    const stage=document.createElement('span');stage.className='viviPetStage';stage.dataset.ready='false';
    const canvas=document.createElement('canvas');canvas.className='viviPetCanvas';canvas.setAttribute('aria-hidden','true');
    const image=document.createElement('img');image.className='viviPetImage';image.alt='';image.draggable=false;image.hidden=true;
    stage.append(canvas,image);element.append(stage);
    const context=canvas.getContext('2d',{alpha:true}),decoders=new Map(),cleanup=[];
    const state={action:'sit',manualLoop:null,x:0,y:0,width:Number(options.width)||144,height:Number(options.height)||156,hiddenEdge:null,dragging:false,dx:0,dy:0,groundY:null,lockedUntil:0,visible:true,motion:true};
    let settings={...DEFAULTS,...item.settings,...options.settings},manifest=null,table=new Map(),destroyed=false,raf=null,lastTime=null,frame=0,elapsed=0,asset=null,decoder=null,lastImage=null,lastPainted=-1,painting=false,generation=0,nativeGif=false,drag=null,pausedAt=null;
    const baseSize={width:state.width,height:state.height};
    const bounds=()=>{const value=typeof options.bounds==='function'?options.bounds():options.bounds;return{width:Math.max(state.width,Number(value?.width)||document.documentElement.clientWidth),height:Math.max(state.height,Number(value?.height)||document.documentElement.clientHeight)}};
    const snapshot=()=>({...state,settings:{...settings},frame,renderer:RENDERER});
    const listen=(target,type,handler,extra)=>{target.addEventListener(type,handler,extra);cleanup.push(()=>target.removeEventListener(type,handler,extra));};
    function notify(){
      if(mode!=='companion')return;
      if(options.positionElement){options.positionElement.style.left=state.x+'px';options.positionElement.style.top=state.y+'px';}
      options.onPosition?.({x:state.x,y:state.y,width:state.width,height:state.height,hiddenEdge:state.hiddenEdge,dragging:state.dragging});
    }
    function clamp(){const area=bounds();state.x=Math.max(0,Math.min(area.width-state.width,state.x));state.y=Math.max(0,Math.min(area.height-state.height,state.y));}
    function draw(source){
      if(!source||destroyed)return;
      const width=source.displayWidth||source.width||source.naturalWidth||asset?.width,height=source.displayHeight||source.height||source.naturalHeight||asset?.height;
      if(!width||!height)return;
      context.clearRect(0,0,canvas.width,canvas.height);
      const ratio=Math.min(canvas.width/width,canvas.height/height),drawWidth=width*ratio,drawHeight=height*ratio;
      // Keep the feet on one stable baseline; wide/long GIFs retain the whole scene.
      context.save();if(asset?.mirror||(state.action==='hide'&&state.hiddenEdge==='right')){context.translate(canvas.width,0);context.scale(-1,1);}
      context.drawImage(source,(canvas.width-drawWidth)/2,canvas.height-drawHeight,drawWidth,drawHeight);context.restore();
    }
    function applySize(){
      state.width=baseSize.width*settings.scale;state.height=baseSize.height*settings.scale;
      stage.style.width=state.width+'px';stage.style.height=state.height+'px';
      const ratio=Math.min(2,window.devicePixelRatio||1);canvas.width=Math.round(state.width*ratio);canvas.height=Math.round(state.height*ratio);
      if(lastImage)draw(lastImage);else if(nativeGif&&image.complete)draw(image);
      options.onResize?.({width:state.width,height:state.height});if(!state.hiddenEdge)clamp();else hide(state.hiddenEdge,false);notify();
    }
    async function getDecoder(descriptor){
      const url=descriptor.asset_url;
      if(!decoders.has(url)){
        const loading=(async()=>{
          const response=await fetch(url,{cache:'force-cache'});if(!response.ok)throw new Error('ViVi 动作文件暂不可用');
          const value=new ImageDecoder({data:await response.arrayBuffer(),type:'image/gif',preferAnimation:true});await value.tracks.ready;
          if(!value.tracks.selectedTrack?.frameCount)throw new Error('ViVi 动作没有可用画面');return value;
        })();
        decoders.set(url,loading);loading.catch(()=>decoders.delete(url));
      }
      const value=await decoders.get(url);
      // Keep at most two decoded action sources; the long animation is loaded on demand.
      for(const [key,promise] of [...decoders]){if(decoders.size<=2)break;if(key!==url){decoders.delete(key);promise.then(old=>old.close()).catch(()=>{});}}
      return value;
    }
    async function paintFrame(){
      if(destroyed||!decoder?.tracks.selectedTrack?.frameCount||painting||lastPainted===frame)return;
      painting=true;const selected=decoder,index=frame,sequence=generation;
      try{
        const result=await selected.decode({frameIndex:index,completeFramesOnly:true});
        if(destroyed||sequence!==generation){result.image.close();return;}
        lastImage?.close?.();lastImage=result.image;draw(lastImage);lastPainted=index;
      }catch(error){if(!destroyed&&sequence===generation)options.onError?.(error);}
      finally{painting=false;}
    }
    async function load(id){
      const descriptor=table.get(id);if(!descriptor)throw new Error('ViVi 没有此动作');
      const sequence=++generation;frame=0;elapsed=0;lastPainted=-1;
      if(asset?.asset_url===descriptor.asset_url&&decoder?.tracks.selectedTrack?.frameCount){asset=descriptor;draw(lastImage);await paintFrame();stage.dataset.action=id;options.onAction?.({action:id,loop:state.manualLoop===id});schedule();return;}
      let value=null;
      if(typeof ImageDecoder==='function'){
        try{value=await getDecoder(descriptor)}catch(error){options.onError?.(error);}
      }
      if(sequence!==generation||destroyed)return;
      if(value){
        const result=await value.decode({frameIndex:0,completeFramesOnly:true});
        if(sequence!==generation||destroyed){result.image.close();return;}
        decoder=value;asset=descriptor;nativeGif=false;image.hidden=true;canvas.hidden=false;
        lastImage?.close?.();lastImage=result.image;draw(lastImage);lastPainted=0;
      }else{
        const candidate=new Image();candidate.src=descriptor.asset_url;await candidate.decode();
        if(sequence!==generation||destroyed)return;
        decoder=null;asset=descriptor;nativeGif=true;lastImage?.close?.();lastImage=null;
        image.src=descriptor.asset_url;image.style.transform=descriptor.mirror||(state.action==='hide'&&state.hiddenEdge==='right')?'scaleX(-1)':'';
        await image.decode();if(sequence!==generation||destroyed)return;
        image.hidden=!state.motion;canvas.hidden=state.motion;if(!state.motion)draw(candidate);
      }
      stage.dataset.ready='true';stage.dataset.action=id;options.onAction?.({action:id,loop:state.manualLoop===id});schedule();
    }
    function action(id,hold,manual){
      if(!table.has(id))return Promise.resolve(false);
      state.action=id;state.manualLoop=manual?id:null;state.lockedUntil=hold===Infinity?Infinity:performance.now()+hold;
      state.dx=mode==='companion'?(id==='walk_left'?-1.4:id==='walk_right'?1.4:0):0;
      state.dy=0;state.groundY=null;
      if(id!=='hide')state.hiddenEdge=null;
      if(mode==='companion'&&id==='jump'){state.groundY=state.y;state.dy=-8;}
      const loading=load(id),sequence=generation;return loading.then(()=>{if(sequence===generation&&state.action===id)state.lockedUntil=hold===Infinity?Infinity:performance.now()+hold;return true;});
    }
    function next(){
      if(state.dragging||state.hiddenEdge||state.manualLoop||mode!=='companion')return;
      const id=weighted(settings.autoBehavior?[['sit',14],['relax',24],['sleep',10],['special1',10],['walk_left',18],['walk_right',18],['interact',3],['jump',2],['fly',1]]:[['sit',2],['relax',2],['sleep',1],['special1',1]]);
      const loops=['sit','relax','sleep','special1','walk_left','walk_right'];
      action(id,loops.includes(id)?2800+Math.random()*4200:table.get(id).duration_ms,false).catch(error=>options.onError?.(error));
    }
    function hide(edge,animate=true){
      if(mode!=='companion')return;
      const area=bounds(),peek=Math.max(24,state.width*.216);state.hiddenEdge=edge;state.dx=0;state.dy=0;state.groundY=null;
      state.x=edge==='left'?-(state.width-peek):area.width-peek;state.lockedUntil=state.manualLoop?Infinity:performance.now()+8000;
      if(animate){state.action='hide';load('hide').catch(error=>options.onError?.(error));}notify();
    }
    function wake(){
      if(!state.hiddenEdge)return false;
      const edge=state.hiddenEdge;state.hiddenEdge=null;state.manualLoop=null;state.x=edge==='left'?8:bounds().width-state.width-8;clamp();notify();
      action('sweat',table.get('sweat')?.duration_ms||950,false).catch(error=>options.onError?.(error));return true;
    }
    function updateMotion(now,delta){
      if(mode!=='companion'||state.dragging)return;
      const step=Math.min(delta,100)/16.6667;
      if(!state.hiddenEdge&&state.groundY!==null){state.y=Math.max(0,state.y+state.dy*step);state.dy+=.18*step;if(state.y>=state.groundY){state.y=state.groundY;state.dy=0;state.groundY=null;}notify();}
      if(!state.hiddenEdge&&state.dx){
        const area=bounds(),max=area.width-state.width;state.x+=state.dx*step;
        if(state.x<=0||state.x>=max){
          state.x=Math.max(0,Math.min(state.x,max));
          if(!state.manualLoop){if(settings.edgeHide&&Math.random()<.34)hide(state.x<=0?'left':'right');else action(state.dx<0?'walk_right':'walk_left',2800+Math.random()*4200,false).catch(error=>options.onError?.(error));}
        }notify();
      }
      if(now>=state.lockedUntil&&!state.manualLoop){
        if(state.hiddenEdge){if(Math.random()<.28){const edge=state.hiddenEdge;state.hiddenEdge=null;state.x=edge==='left'?4:bounds().width-state.width-4;action(edge==='left'?'walk_right':'walk_left',2200,false).catch(error=>options.onError?.(error));}else state.lockedUntil=now+3000;}
        else next();
      }
    }
    function tick(now){
      raf=null;if(destroyed||!state.visible||!state.motion||document.hidden)return;
      const delta=lastTime===null?0:Math.max(0,now-lastTime);lastTime=now;updateMotion(now,delta);
      const track=decoder?.tracks.selectedTrack;
      if(track?.frameCount&&asset){
        elapsed+=delta;const durations=asset.frame_durations_ms||[],total=track.frameCount;let guard=0;
        while(elapsed>=(durations[frame]||50)&&guard++<total){elapsed-=durations[frame]||50;frame=(frame+1)%total;}
        paintFrame();
      }schedule();
    }
    function stop(){if(raf!==null)cancelAnimationFrame(raf);raf=null;lastTime=null;if(pausedAt===null)pausedAt=performance.now();}
    function schedule(){if(raf===null&&!destroyed&&state.visible&&state.motion&&!document.hidden){if(pausedAt!==null){if(Number.isFinite(state.lockedUntil))state.lockedUntil+=performance.now()-pausedAt;pausedAt=null;}raf=requestAnimationFrame(tick);}}
    function select(id,{loop=true}={}){
      if(id===null||id==='auto'){state.manualLoop=null;state.hiddenEdge=null;clamp();notify();return action('sit',2800,false);}
      id=STANDARD_ACTIONS[id]||id;if(!table.has(id))return Promise.reject(new Error('ViVi 没有此动作'));
      const result=action(id,loop?Infinity:table.get(id).duration_ms,loop);
      if(id==='hide'&&mode==='companion')hide(state.x<bounds().width/2?'left':'right',false);
      return result;
    }
    function playOnce(id,{force=false,duration}={}){id=STANDARD_ACTIONS[id]||id;if(state.manualLoop&&!force)return Promise.resolve(false);if(!table.has(id))return Promise.resolve(false);return action(id,Math.max(table.get(id).duration_ms,Number(duration)||0),false);}
    function setPosition(x,y){const point=typeof x==='object'?x:{x,y};if(!validPoint(point))return snapshot();state.x=point.x;state.y=point.y;if(!state.hiddenEdge)clamp();notify();return snapshot();}
    function beginDrag(point){
      if(mode!=='companion'||!validPoint(point)||destroyed)return false;if(wake())return false;
      drag={dx:point.x-state.x,dy:point.y-state.y,startX:state.x,startY:state.y,loop:state.manualLoop,moved:false};state.dragging=true;state.dx=0;state.dy=0;state.groundY=null;
      load(settings.dragAction).catch(error=>options.onError?.(error));notify();return true;
    }
    function moveDrag(point){if(!drag||!validPoint(point))return false;const x=point.x-drag.dx,y=point.y-drag.dy;if(Math.hypot(x-drag.startX,y-drag.startY)>3)drag.moved=true;state.x=x;state.y=y;clamp();notify();return true;}
    function endDrag(point){
      if(!drag)return false;if(validPoint(point))moveDrag(point);const prior=drag;drag=null;state.dragging=false;
      if(prior.loop){select(prior.loop).catch(error=>options.onError?.(error));}
      else if(prior.moved&&settings.edgeHide&&(state.x<=2||state.x>=bounds().width-state.width-2))hide(state.x<=2?'left':'right');
      else playOnce('interact',{force:true}).catch(error=>options.onError?.(error));notify();return true;
    }
    function cancelDrag(){if(!drag)return;const prior=drag;drag=null;state.dragging=false;setPosition(prior.startX,prior.startY);select(prior.loop).catch(error=>options.onError?.(error));}
    function setSettings(nextSettings){
      const next={...settings};if(Number.isFinite(Number(nextSettings?.scale)))next.scale=Math.max(.4,Math.min(2.5,Number(nextSettings.scale)));
      if(['fly','interact','sweat','jump'].includes(nextSettings?.dragAction))next.dragAction=nextSettings.dragAction;
      for(const key of ['autoBehavior','edgeHide'])if(typeof nextSettings?.[key]==='boolean')next[key]=nextSettings[key];
      settings=next;applySize();if(!settings.edgeHide)wake();if(!settings.autoBehavior&&!state.manualLoop&&state.dx)action('sit',2800,false).catch(error=>options.onError?.(error));options.onSettings?.({...settings});return {...settings};
    }
    function setMotion(enabled){state.motion=Boolean(enabled);if(!state.motion){stop();if(nativeGif&&image.complete){draw(image);image.hidden=true;canvas.hidden=false;}}else{if(nativeGif){canvas.hidden=true;image.hidden=false;}schedule();}}
    function setVisible(visible){state.visible=Boolean(visible);stage.hidden=!state.visible;if(state.visible)schedule();else stop();}
    function resize(width,height){if(Number(width)>0)baseSize.width=Number(width);if(Number(height)>0)baseSize.height=Number(height);applySize();return snapshot();}
    function destroy(){if(destroyed)return;destroyed=true;generation++;stop();cleanup.forEach(fn=>fn());lastImage?.close?.();for(const promise of decoders.values())promise.then(value=>value.close()).catch(()=>{});decoders.clear();image.removeAttribute('src');stage.remove();}
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
      bind();await action(manifest.defaultAction||'sit',mode==='companion'?2800:Infinity,false);return snapshot();
    })();
    ready.catch(error=>{if(!destroyed){stage.dataset.ready='false';options.onError?.(error);}});
    return {ready,select,playOnce,setSettings,setMotion,setVisible,resize,setPosition,beginDrag,moveDrag,endDrag,cancelDrag,wake,interact:()=>wake()||playOnce('interact',{force:true}),getState:snapshot,destroy,get settings(){return{...settings}},get actions(){return[...table.values()]},get element(){return stage}};
  }
  window.lifeosViVi={renderer:RENDERER,mount,standardActions:STANDARD_ACTIONS};
})();
