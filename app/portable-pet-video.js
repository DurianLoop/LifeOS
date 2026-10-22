/* A transparent canvas playback clock for iOS, with pause, seek and ended. */
(() => {
  'use strict';
  if(!/LifeOSMobile\/ios/.test(navigator.userAgent))return;
  window.lifeosPortablePetVideo=()=>{
    const canvas=document.createElement('canvas'),context=canvas.getContext('2d');
    let url='',manifest=null,pages=[],time=0,playing=false,last=0,raf=0,generation=0;
    const draw=()=>{if(!manifest)return;const frame=Math.min(manifest.frames-1,Math.floor(time*manifest.fps)),page=pages[Math.floor(frame/manifest.per_page)],cell=frame%manifest.per_page;if(!page)return;context.clearRect(0,0,canvas.width,canvas.height);context.drawImage(page,(cell%manifest.columns)*manifest.width,Math.floor(cell/manifest.columns)*manifest.height,manifest.width,manifest.height,0,0,canvas.width,canvas.height)};
    const stop=()=>{playing=false;cancelAnimationFrame(raf)};
    const tick=now=>{if(!playing)return;time+=Math.max(0,now-last)/1000;last=now;if(time>=canvas.duration){time=canvas.duration;draw();stop();canvas.dispatchEvent(new Event('ended'));return}draw();raf=requestAnimationFrame(tick)};
    Object.defineProperties(canvas,{src:{get:()=>url,set:value=>{url=value}},currentTime:{get:()=>time,set:value=>{time=Number(value)||0;draw()}},duration:{get:()=>manifest?manifest.frames/manifest.fps:NaN},videoWidth:{get:()=>canvas.width},videoHeight:{get:()=>canvas.height},paused:{get:()=>!playing}});
    canvas.play=async()=>{if(playing||!manifest)return;playing=true;last=performance.now();raf=requestAnimationFrame(tick)};
    canvas.pause=stop;
    canvas.load=async()=>{const sequence=++generation;stop();if(!canvas.getAttribute('src')&&!url)return;try{const match=/\/([^/]+)\.webm(?:\?.*)?$/.exec(url);if(!match)throw Error('无效动画');const base=new URL('portable/'+match[1]+'/',url.startsWith('http')?url:new URL(url,document.baseURI));const response=await fetch(new URL('animation.json',base));if(!response.ok)throw Error('动画清单不可用');const value=await response.json();const images=await Promise.all(value.pages.map(name=>new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=reject;img.src=new URL(name,base).href})));if(sequence!==generation)return;manifest=value;pages=images;canvas.width=value.width;canvas.height=value.height;time=0;draw();canvas.dispatchEvent(new Event('loadeddata'));}catch(error){if(sequence===generation)canvas.dispatchEvent(new Event('error'));}};
    const remove=canvas.removeAttribute.bind(canvas);canvas.removeAttribute=name=>{remove(name);if(name==='src'){url='';++generation;stop();pages=[];manifest=null}};
    return canvas;
  };
})();
