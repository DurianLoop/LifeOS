'use strict';
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const assert=require('node:assert/strict');
const platform=process.env.LIFEOS_PREVIEW_PLATFORM||'ios';
const root=path.resolve(__dirname,'..'),out=path.join(root,'docs/qa_mobile_pet',String(Date.now()));
fs.mkdirSync(out,{recursive:true});app.setPath('userData',path.join(out,'profile'));
const wait=ms=>new Promise(r=>setTimeout(r,ms));let win,child;
async function run(){
 const ready=path.join(out,'ready.json'),log=fs.openSync(path.join(out,'backend.log'),'w');
 child=spawn(process.env.LIFEOS_TEST_PYTHON||'python',[path.join(root,'scripts/mobile_preview.py'),path.join(out,'workspace'),ready],{cwd:root,env:{...process.env,PYTHONUTF8:'1',LIFEOS_PREVIEW_PLATFORM:platform,LIFEOS_PREVIEW_RESOURCES:path.join(root,'mobile/src/lifeosmobile/resources')},stdio:['ignore',log,log],windowsHide:true});
 for(let i=0;i<300&&!fs.existsSync(ready);i++){if(child.exitCode!==null)throw Error('Backend exited');await wait(100)}
 const {url}=JSON.parse(fs.readFileSync(ready,'utf8'));
 win=new BrowserWindow({width:390,height:844,show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,offscreen:true,backgroundThrottling:false}});
 win.webContents.setUserAgent(win.webContents.getUserAgent()+' LifeOSMobile/'+platform);
 const js=code=>win.webContents.executeJavaScript(code);
 await win.loadURL(url);
 const report=await js(`(async()=>{
  const manifest=await fetch('/assets/pets/dsh-pet/pet.json').then(r=>r.json());
  const host=document.createElement('div');document.body.append(host);
  const pet=lifeosDSH.mount(host,{...manifest,manifest_url:location.origin+'/assets/pets/dsh-pet/pet.json'},{motion:false});await pet.ready;
  let count=0;for(const row of manifest.actions){if(!await pet.select(row.id,{loop:true}))throw Error(row.id);count++}
  const canvas=pet.element.querySelector('canvas:not([hidden])'),data=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
  let transparent=0,visible=0;for(let i=3;i<data.length;i+=4){if(data[i]===0)transparent++;if(data[i]>0)visible++}
  pet.setMotion(true);await new Promise(r=>setTimeout(r,300));const moving=pet.getState().animation.time;
  pet.setMotion(false);await new Promise(r=>setTimeout(r,250));const paused=pet.getState().animation.time;
  let ended=false;await pet.select(manifest.defaultAction,{onComplete:()=>ended=true});
  const current=pet.element.querySelector('canvas:not([hidden])');current.currentTime=current.duration-.15;pet.setMotion(true);
  await new Promise(r=>setTimeout(r,450));
  pet.setMotion(false);
  return{count,transparent,visible,moving,paused,ended,canvas:!!canvas};
 })()`);
 assert.equal(report.count,106);assert.ok(report.transparent>report.visible*.1&&report.visible>0);assert.ok(report.moving>0);assert.equal(report.moving,report.paused);assert.ok(report.ended);
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({ok:true,...report},null,2));
 fs.writeFileSync(path.join(out,platform+'-pet.png'),(await win.webContents.capturePage()).toPNG());
 console.log(JSON.stringify({ok:true,...report,out}));
 win.destroy();child.kill();app.exit(0);
}
app.whenReady().then(run).catch(error=>{console.error(error.stack);if(win&&!win.isDestroyed())win.destroy();child?.kill();app.exit(1)});
