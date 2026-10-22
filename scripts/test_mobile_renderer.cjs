'use strict';
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),out=path.join(root,'docs/qa_mobile',String(Date.now()));
fs.mkdirSync(out,{recursive:true});app.setPath('userData',path.join(out,'profile'));
const wait=ms=>new Promise(r=>setTimeout(r,ms));let win,child;const errors=[],checks=[];
const js=code=>win.webContents.executeJavaScript(code);
async function until(expression){for(let i=0;i<150;i++){if(await js(expression))return;await wait(100)}throw Error('Timed out '+expression)}
async function run(){
 const ready=path.join(out,'ready.json'),log=fs.openSync(path.join(out,'backend.log'),'w');
 child=spawn(process.env.LIFEOS_TEST_PYTHON||'python',[path.join(root,'scripts/mobile_preview.py'),path.join(out,'workspace'),ready],{cwd:root,env:{...process.env,PYTHONUTF8:'1'},stdio:['ignore',log,log],windowsHide:true});
 for(let i=0;i<300&&!fs.existsSync(ready);i++){if(child.exitCode!==null)throw Error('Backend exited');await wait(100)}
 const {url,origin}=JSON.parse(fs.readFileSync(ready,'utf8'));
 win=new BrowserWindow({width:390,height:844,show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,offscreen:true,backgroundThrottling:false}});
 win.webContents.setUserAgent(win.webContents.getUserAgent()+' LifeOSMobile/android');
 win.webContents.session.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(details,callback)=>callback(details.url.startsWith(origin)?{}:{cancel:true}));
 win.webContents.on('console-message',event=>{if(event.level==='error'&&!/Failed to load resource|net::ERR/.test(event.message))errors.push(event.message)});
 await win.loadURL(url);await until('!!window.lifeosMobile&&!!window.lifeosJournalBook');await wait(600);
 await js("document.querySelector('[data-welcome=skip]')?.click();localStorage.setItem('lifeos.qa','persist')");
 const names=await js('FEATURES.map(x=>x.name)');assert.ok(names.length>=142);
 for(const width of [390,768]){
  win.setSize(width,1024);
  for(const name of names){
   if(name==='Ask My Life'){await js('openAsk();document.querySelector("#askModal").classList.remove("open")');checks.push({width,name,modal:true});continue}
   await js('openFeature('+JSON.stringify(name)+')');await until('!document.querySelector("#view .loading")');await wait(100);
   const value=await js('({page:STATE.feature,text:document.querySelector("#view").innerText.slice(0,500),overflow:document.documentElement.scrollWidth-innerWidth,shellOverflow:document.querySelector(".shell").scrollWidth-document.querySelector(".shell").clientWidth})');
   assert.equal(value.page,name);assert.ok(!value.text.includes('Could not render this module'),JSON.stringify(value));
   checks.push({width,name,...value});
   if(value.overflow>4||value.shellOverflow>4)console.log('OVERFLOW '+JSON.stringify({width,name,...value}));
   if(['Home','Journal','Time Capsule','Daily Poetry','Pet Shelf','Analytics'].includes(name))fs.writeFileSync(path.join(out,width+'-'+name.replaceAll(' ','-')+'.png'),(await win.webContents.capturePage()).toPNG());
  }
 }
 await win.loadURL(url);await until('!!window.lifeosStorage');assert.equal(await js("localStorage.getItem('lifeos.qa')"),'persist');
 const overflow=checks.filter(x=>x.overflow>4||x.shellOverflow>4);const report={ok:!errors.length&&!overflow.length,checks,errors,overflow,user_diaries_read:0};
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({ok:report.ok,pages:checks.length,errors,overflow:overflow.length,out}));
 assert.ok(report.ok);win.destroy();child.kill();app.quit();
}
app.whenReady().then(run).catch(error=>{console.error(error.stack);if(win&&!win.isDestroyed())win.destroy();child?.kill();app.exit(1)});
