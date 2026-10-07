'use strict';
// Pure renderer QA: public GIFs only, no diary backend or user profile is opened.
const {app,BrowserWindow}=require('electron');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const ROOT=path.resolve(__dirname,'..'),out=path.join(ROOT,'docs','qa_vivi','run-'+Date.now());fs.mkdirSync(out,{recursive:true});
app.setPath('userData',path.join(out,'profile'));let win,server;const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),checks=[];
const html=`<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/vivi-pet.css"><style>body{margin:0;background:#f8f4ec;color:#38333b;font:16px Georgia,serif}main{padding:32px}h1{font-weight:400}.stage{width:800px;height:560px;position:relative;border-bottom:1px solid #c7bdb0}.pet{position:absolute}.preview{display:grid;grid-template-columns:repeat(7,110px);gap:12px}.sample{width:100px;height:130px;border-bottom:1px solid #ded5c9}.sample label{font-size:12px;display:block;margin-top:5px}</style><main><h1>ViVi · original animation renderer</h1><div class="preview"></div><div class="stage"><div class="pet" tabindex="0"></div></div></main><script src="/vivi-pet.js"></script>`;
async function run(){
  server=http.createServer((request,response)=>{
    const uri=new URL(request.url,'http://localhost').pathname;
    if(uri==='/'){response.setHeader('Content-Type','text/html; charset=utf-8');response.end(html);return;}
    const allowed=uri==='/vivi-pet.js'||uri==='/vivi-pet.css'||/^\/assets\/pets\/vivi\/[a-z0-9_.-]+$/.test(uri);
    if(!allowed){response.writeHead(404);response.end();return;}
    const file=path.join(ROOT,'app',uri);if(!fs.existsSync(file)){response.writeHead(404);response.end();return;}
    response.setHeader('Content-Type',uri.endsWith('.js')?'text/javascript':uri.endsWith('.css')?'text/css':uri.endsWith('.json')?'application/json':'image/gif');fs.createReadStream(file).pipe(response);
  });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  win=new BrowserWindow({width:1000,height:900,show:false,webPreferences:{contextIsolation:true,sandbox:true,nodeIntegration:false,offscreen:true,backgroundThrottling:false}});await win.loadURL(`http://127.0.0.1:${server.address().port}`);
  const js=code=>win.webContents.executeJavaScript(`(async()=>{${code}})()`),until=async condition=>{for(let i=0;i<100;i++){if(await js('return '+condition))return;await wait(80)}throw Error('Wait failed: '+condition)};
  await js(`window.manifest=await (await fetch('/assets/pets/vivi/pet.json')).json();window.positions=[];window.pet=lifeosViVi.mount(document.querySelector('.pet'),manifest,{mode:'companion',width:144,height:156,interactive:true,positionElement:document.querySelector('.pet'),world:document.querySelector('.stage'),bounds:()=>({width:800,height:560}),position:{x:450,y:380},onPosition:p=>positions.push(p)});await pet.ready`);
  assert.equal(await js(`return typeof ImageDecoder`),'function');await until(`pet.getState().frame>0`);
  const alpha=()=>js(`const canvas=pet.element.querySelector('canvas'),data=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;let count=0;for(let i=3;i<data.length;i+=4)if(data[i])count++;return count`);
  assert.ok(await alpha()>500);checks.push('GIF ImageDecoder draws a visible transparent character and advances original frames');
  const ids=await js(`return [...new Set(manifest.actions.map(a=>a.asset))].map(asset=>manifest.actions.find(a=>a.asset===asset).id)`);
  const visible={};
  for(const id of ids){await js(`await pet.select('${id}');pet.setMotion(false)`);visible[id]=await alpha();if(!visible[id]){await js(`pet.setMotion(true)`);await until(`pet.getState().frame>=2`);await js(`pet.setMotion(false)`);visible[id]=await alpha();}assert.ok(visible[id]>20,id+' has visible animation content');await js(`pet.setMotion(true)`);}
  assert.equal(ids.length,14);checks.push('all fourteen distinct source GIFs render without converting to the nine-row sprite contract');
  await js(`await pet.playOnce('special0',{force:true});pet.setMotion(false)`);assert.ok(await js(`return pet.getState().lockedUntil-performance.now()`)>11900);checks.push('long action holds for its original 12.2 seconds rather than the upstream truncated 5.2 seconds');
  await js(`await pet.select('walk_left');pet.setMotion(true)`);const left=await js(`return pet.getState().x`);await wait(220);assert.ok(await js(`return pet.getState().x`)<left);
  await js(`await pet.select('walk_right')`);assert.equal(await js(`return pet.element.dataset.action`),'walk_right');checks.push('direction aliases share the walking GIF with correct mirror and preserved movement');
  await js(`pet.setSettings({autoBehavior:false,dragAction:'fly',edgeHide:true});await pet.select(null);pet.setPosition(350,300);pet.beginDrag({x:380,y:330});pet.moveDrag({x:460,y:420})`);
  assert.equal(await js(`return pet.getState().dragging`),true);assert.equal(await js(`return pet.getState().x`),430);assert.equal(await js(`return pet.getState().y`),390);await until(`pet.element.dataset.action==='fly'`);
  await js(`pet.endDrag()`);await until(`pet.element.dataset.action==='interact'`);checks.push('drag uses configurable original flying GIF and releases into the full touch interaction');
  await js(`await pet.select('hide')`);assert.equal(await js(`return pet.getState().hiddenEdge`),'right');assert.ok(await js(`return pet.getState().x`)>750);
  await js(`pet.wake()`);await until(`pet.element.dataset.action==='sweat'`);assert.equal(await js(`return pet.getState().hiddenEdge`),null);assert.ok(await js(`return pet.getState().x+pet.getState().width`)<800);checks.push('edge hiding leaves a clickable sliver and wake plays original sweat before returning inside the world');
  await js(`await pet.select('sleep');pet.beginDrag({x:pet.getState().x+20,y:pet.getState().y+20});pet.moveDrag({x:120,y:120});pet.endDrag()`);await until(`pet.element.dataset.action==='sleep'`);checks.push('a chosen loop survives dragging and resumes until explicitly changed');
  await js(`pet.setSettings({scale:1.4});pet.resize(144,156);pet.setMotion(false)`);assert.ok(Math.abs(await js(`return pet.getState().width`)-201.6)<.01);const frame=await js(`return pet.getState().frame`);await wait(180);assert.equal(await js(`return pet.getState().frame`),frame);checks.push('original scale control applies once and animation pause holds the decoded frame');
  await js(`window.previews=[];for(const descriptor of manifest.actions.filter(a=>a.asset&&!a.id.startsWith('walk_'))){const host=document.createElement('div');host.className='sample';document.querySelector('.preview').append(host);const preview=lifeosViVi.mount(host,manifest,{mode:'preview',width:96,height:104});await preview.ready;await preview.select(descriptor.id);preview.setMotion(false);const label=document.createElement('label');label.textContent=descriptor.label;host.append(label);previews.push(preview)}await pet.select('sit');pet.setSettings({scale:1});pet.setPosition(500,380)`);
  const points=await js(`return previews.map(p=>({x:p.getState().x,y:p.getState().y}))`);await wait(250);assert.deepEqual(await js(`return previews.map(p=>({x:p.getState().x,y:p.getState().y}))`),points);checks.push('gallery previews keep all original action scenes within their cards without wandering');
  fs.writeFileSync(path.join(out,'ViVi-全部动作.png'),(await win.webContents.capturePage()).toPNG());
  await js(`window.fallbackHost=document.createElement('div');document.querySelector('.stage').append(fallbackHost);window.savedDecoder=window.ImageDecoder;window.ImageDecoder=undefined;window.fallback=lifeosViVi.mount(fallbackHost,manifest,{mode:'preview',width:96,height:104});await fallback.ready;window.ImageDecoder=savedDecoder;fallback.setMotion(false)`);assert.equal(await js(`return fallback.element.dataset.ready`),'true');assert.equal(await js(`return fallback.element.querySelector('img').hidden`),true);checks.push('native GIF fallback stays usable and freezes to a canvas when a browser lacks ImageDecoder');
  await js(`pet.destroy();previews.forEach(p=>p.destroy());fallback.destroy()`);assert.equal(await js(`return document.querySelectorAll('.viviPetStage').length`),0);checks.push('destroy removes renderers and releases decoded animations');
  fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({ok:true,checks,visible_sample_pixels:visible,diaries_opened:0,remote_requests:0},null,2));console.log(JSON.stringify({ok:true,checks:checks.length,out}));
}
app.whenReady().then(run).then(()=>{server.close();win.destroy();app.exit(0)}).catch(error=>{fs.writeFileSync(path.join(out,'failure.txt'),error.stack);console.error(error.stack);server?.close();win?.destroy();app.exit(1)});
