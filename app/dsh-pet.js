/* Original DSH VP9 alpha clips and animation pools; no DSH server or AI is started. */
(() => {
  'use strict';
  const RENDERER='dsh-webm';
  function mount(element,item,options={}){
    const companion=options.mode==='companion',stage=document.createElement('span');
    stage.className='dshPetStage';stage.dataset.ready='false';element.append(stage);
    const previousTitle=element.getAttribute('title');
    element.title='DSH 小鲸 · 素材禁止商用 · '+(item.source_url||'https://github.com/PC2005-cloud/dsh-pet');
    let manifest=item,table=new Map(),current=null,destroyed=false,generation=0,raf=null,drag=null,retained=null,move=null,facing=false;
    let settings={autoBehavior:true,...item.settings,...options.settings};
    const state={action:item.defaultAction,onceAction:null,manualLoop:null,x:0,y:0,width:options.width||144,height:options.height||156,visible:options.visible!==false,motion:options.motion!==false,dragging:false,hiddenEdge:null};
    const random=()=>Math.max(0,Math.min(.999999,Number((options.random||Math.random)())||0));
    const pick=list=>list?.length?list[Math.floor(random()*list.length)]:manifest.defaultAction;
    const bounds=()=>{const area=typeof options.bounds==='function'?options.bounds():options.bounds;return{width:Math.max(state.width,area?.width||document.documentElement.clientWidth),height:Math.max(state.height,area?.height||document.documentElement.clientHeight)}};
    function notify(){if(!companion)return;if(options.positionElement){options.positionElement.style.left=state.x+'px';options.positionElement.style.top=state.y+'px';}options.onPosition?.({...state});}
    function clamp(){const area=bounds();state.x=Math.max(0,Math.min(area.width-state.width,state.x));state.y=Math.max(0,Math.min(area.height-state.height,state.y));}
    function paintFacing(){if(current)current.video.style.transform=facing&&!current.descriptor.noMirror?'scaleX(-1)':'';}
    function stopMove(){if(raf!==null)cancelAnimationFrame(raf);raf=null;}
    function tick(){
      raf=null;if(destroyed||!current||!state.motion||!state.visible||state.dragging||!move)return;
      const duration=current.video.duration,time=current.video.currentTime;
      if(Number.isFinite(duration)){
        const ratio=Math.max(0,Math.min(1,(time-move.leadSec)/Math.max(.1,duration-move.leadSec-move.tailSec)));
        const next=move.start+(move.end-move.start)*ratio;
        if(Math.abs(next-state.x)>.1){state.x=next;notify();}
      }
      raf=requestAnimationFrame(tick);
    }
    function playback(){
      if(!current||destroyed)return;stopMove();
      if(state.motion&&state.visible){current.video.play().catch(error=>{if(!destroyed&&error.name!=='AbortError')options.onError?.(error)});if(move)raf=requestAnimationFrame(tick);}
      else current.video.pause();
    }
    function dispose(session){if(!session)return;session.video.pause();session.video.removeAttribute('src');session.video.load();session.video.remove();}
    function planMove(id){
      const descriptor=manifest.behavior.moves.find(row=>row.id===id);move=null;
      if(!companion||!descriptor)return;
      const area=bounds(),margin=descriptor.margin,limit=Math.max(margin,area.width-state.width-margin);
      const distance=(descriptor.minDist+random()*(descriptor.maxDist-descriptor.minDist))*state.width/462;
      let direction=facing?1:-1;if(state.x+direction*distance<margin||state.x+direction*distance>limit)direction*=-1;
      facing=direction>0;move={...descriptor,start:state.x,end:Math.max(margin,Math.min(limit,state.x+direction*distance))};
    }
    function ended(session){
      if(destroyed||current!==session)return;
      if(session.loop){session.video.currentTime=0;playback();return;}
      if(session.turn)facing=!facing;
      const callback=session.onComplete;state.onceAction=null;state.manualLoop=null;move=null;
      next();callback?.({action:session.descriptor.id,renderer:RENDERER,duration_ms:session.video.duration*1000});
    }
    async function play(id,{once=false,loop=false,onComplete,turn=false}={}){
      const descriptor=table.get(id);if(!descriptor||destroyed)return false;
      const sequence=++generation,video=window.lifeosPortablePetVideo?.()||document.createElement('video');
      video.className='dshPetVideo';video.muted=true;video.playsInline=true;video.preload='auto';video.setAttribute('aria-hidden','true');video.hidden=true;stage.append(video);
      const session={descriptor,video,once,loop,onComplete,turn};
      try{
        await new Promise((resolve,reject)=>{
          const timer=setTimeout(()=>finish(new Error('DSH 动画加载超时')),15000);
          const finish=error=>{clearTimeout(timer);video.onloadeddata=null;video.onerror=null;error?reject(error):resolve();};
          video.onloadeddata=()=>finish();video.onerror=()=>finish(new Error('DSH 动画暂不可用：'+descriptor.label));video.src=descriptor.asset_url;video.load();
        });
        if(sequence!==generation||destroyed){dispose(session);return false;}
        const previous=current;current=session;previous?.video.pause();if(previous!==retained)dispose(previous);else if(previous)previous.video.hidden=true;
        video.hidden=false;state.action=id;state.onceAction=once?id:null;state.manualLoop=loop&&companion?id:null;
        video.addEventListener('ended',()=>ended(session));video.addEventListener('error',()=>{if(current===session&&!destroyed)options.onError?.(new Error('DSH 动画播放失败'));});
        planMove(id);paintFacing();stage.dataset.action=id;stage.dataset.ready='true';
        options.onAction?.({action:id,once,loop});playback();return true;
      }catch(error){dispose(session);if(sequence===generation&&!destroyed)throw error;return false;}
    }
    function report(promise){promise.catch(error=>{if(!destroyed)options.onError?.(error)});}
    function next(){
      if(destroyed||state.dragging)return;
      const behavior=manifest.behavior;
      if(!companion||!settings.autoBehavior){report(play(manifest.defaultAction,{loop:true}));return;}
      const choices=[{weight:behavior.weights.idle,actions:behavior.idle},{weight:behavior.weights.turn,actions:behavior.turn,turn:true},{weight:behavior.weights.move,actions:behavior.moves.map(row=>row.id)},...behavior.categories];
      let roll=random()*choices.reduce((sum,row)=>sum+row.weight,0),chosen=choices[0];
      for(const row of choices){roll-=row.weight;if(roll<0){chosen=row;break;}}
      const candidates=chosen.actions.filter(id=>id!==state.action&&(!facing||!table.get(id)?.noMirror));
      report(play(pick(candidates.length?candidates:behavior.idle),{turn:Boolean(chosen.turn)}));
    }
    function select(id,{loop=false,onComplete}={}){
      if(id===null){state.onceAction=null;state.manualLoop=null;return play(manifest.defaultAction,{loop:!companion||!settings.autoBehavior});}
      return play(id,{once:!loop,loop,onComplete});
    }
    function interact(){if(state.onceAction)return;report(play(pick(manifest.behavior.clicks),{once:true}));}
    function beginDrag(point){
      if(!companion||!Number.isFinite(point?.x)||!Number.isFinite(point?.y)||!current)return false;
      drag={x:point.x,y:point.y,startX:state.x,startY:state.y,moved:false};state.dragging=true;move=null;stopMove();
      if(current.once||current.loop&&state.manualLoop){retained=current;retained.video.pause();}
      report(play(pick(manifest.behavior.drag),{loop:true}));return true;
    }
    function moveDrag(point){if(!drag||!Number.isFinite(point?.x)||!Number.isFinite(point?.y))return;const dx=point.x-drag.x,dy=point.y-drag.y;drag.moved||=Math.hypot(dx,dy)>3;state.x=drag.startX+dx;state.y=drag.startY+dy;clamp();notify();}
    function endDrag(){
      if(!drag)return;const moved=drag.moved;drag=null;state.dragging=false;
      if(retained){++generation;if(current!==retained)dispose(current);current=retained;retained=null;current.video.hidden=false;state.action=current.descriptor.id;state.onceAction=current.once?state.action:null;state.manualLoop=current.loop?state.action:null;stage.dataset.action=state.action;paintFacing();playback();}
      else if(!moved&&options.interactive!==false)interact();else report(play(manifest.defaultAction,{loop:!settings.autoBehavior}));
      notify();
    }
    const ready=(async()=>{
      if(!manifest.behavior||!manifest.actions?.every(row=>row.asset_url)){
        const response=await fetch(item.manifest_url);if(!response.ok)throw new Error('DSH 动画清单暂不可用');const data=await response.json();
        manifest={...data,...item,behavior:data.behavior,actions:data.actions.map(row=>({...row,asset_url:new URL(row.asset,item.manifest_url?new URL(item.manifest_url,document.baseURI):document.baseURI).href}))};
      }
      if(destroyed)return;table=new Map(manifest.actions.map(row=>[row.id,row]));
      state.x=options.position?.x??bounds().width-state.width-28;state.y=options.position?.y??bounds().height-state.height-28;clamp();notify();
      await play(manifest.defaultAction,{loop:!companion||!settings.autoBehavior});
    })();
    const standard={idle:'待机呼吸休闲',waving:'点击回应-元气挥手',jumping:'点击回应-开心跃动',failed:'工作状态-垂头叹气冒汗',waiting:'工作状态-原地踱步张望',running:'工作状态-忙碌点按',review:'轻快记录','running-right':'螃蟹走路','running-left':'原地左转奔跑'};
    return {element:stage,ready,select,interact,beginDrag,moveDrag,endDrag,cancelDrag:endDrag,
      playOnce(action){if(state.onceAction||state.dragging)return Promise.resolve(false);const id=table.has(action)?action:[...table.values()].find(row=>row.label===standard[action])?.id;return id?play(id,{once:action!=='idle',loop:action==='idle'&&(!companion||!settings.autoBehavior)}):Promise.resolve(false);},
      setPosition(x,y){state.x=x;state.y=y;clamp();notify();},
      resize(width,height){state.width=width;state.height=height;clamp();notify();},
      setMotion(value){state.motion=Boolean(value);playback();},setVisible(value){state.visible=Boolean(value);playback();},
      setSettings(value){settings={...settings,...value};},
      getState(){return {...state,settings:{...settings},renderer:RENDERER,mirrored:facing&&!current?.descriptor.noMirror,animation:{time:current?.video.currentTime||0,duration:current?.video.duration||0,ready:stage.dataset.ready==='true'}};},
      destroy(){destroyed=true;++generation;stopMove();dispose(current);if(retained!==current)dispose(retained);stage.querySelectorAll('video').forEach(video=>{video.removeAttribute('src');video.load();});stage.remove();if(previousTitle===null)element.removeAttribute('title');else element.setAttribute('title',previousTitle);}
    };
  }
  window.lifeosDSH={mount};
})();
