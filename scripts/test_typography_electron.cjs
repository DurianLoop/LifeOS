'use strict';
// Real renderer checks using synthetic pages and an isolated workspace.
const {app,BrowserWindow,ipcMain}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const runtime=require('../desktop/runtime.cjs'),{createStore}=require('../desktop/workspace-store.cjs');
const ROOT=path.resolve(__dirname,'..'),out=path.join(ROOT,'docs/qa_typography','run-'+Date.now()),workspace=path.join(out,'workspace');
const resourceRoot=process.env.LIFEOS_QA_RESOURCES||ROOT;
fs.mkdirSync(workspace,{recursive:true});fs.cpSync(path.join(resourceRoot,'config'),path.join(workspace,'config'),{recursive:true});
app.setPath('userData',path.join(out,'profile'));app.on('window-all-closed',()=>{});
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),checks=[],errors=[];let backend,win;
const js=code=>win.webContents.executeJavaScript(`(async()=>{${code}})()`);
const until=async condition=>{const start=Date.now();while(Date.now()-start<15000){if(await js('return '+condition))return;await wait(80)}throw Error('Timed out: '+condition)};
const shot=async name=>{fs.writeFileSync(path.join(out,name+'.png'),(await win.webContents.capturePage()).toPNG())};
async function run(){
  const store=createStore(workspace);store.operation({op:'set',key:'lifeos.welcome.v1',value:'done'});
  const port=await runtime.availablePort(),paths={dataRoot:workspace,resourceRoot,logFile:path.join(out,'backend.log')};
  const packaged=fs.existsSync(path.join(resourceRoot,'server_bootstrap.py'));
  const env={...process.env,LIFEOS_PYTHON:path.join(resourceRoot,packaged?'python/python.exe':'desktop/python-runtime/python.exe'),PYTHON_KEYRING_BACKEND:'keyring.backends.null.Keyring'};
  for(const key of Object.keys(env))if(key.endsWith('_API_KEY')||['PYTHONHOME','PYTHONPATH','ELECTRON_RUN_AS_NODE'].includes(key))delete env[key];
  backend=runtime.startBackend(runtime.backendLaunch({...paths,isPackaged:packaged,env}),{...paths,port});const base='http://127.0.0.1:'+port;
  await runtime.waitForServer(base+'/api/health',{failure:backend.failure});
  const saved=await fetch(base+'/api/entries/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({journal_date:'2026-10-01',title:'窗前的一页 · Typography fixture',sections:{'日记':('秋日的光落在书页上。今天整理了工作，也给散步和阅读留出时间。\n\nA quiet page, with room to breathe. Numbers: 2026 / 10 / 01.\n\n').repeat(12),'自我探索':'把心里的声音慢慢写清楚，比仓促地得出答案更有意义。'}})}).then(r=>r.json());assert.equal(saved.ok,true);
  win=new BrowserWindow({width:1440,height:1000,show:false,webPreferences:{preload:packaged?path.join(resourceRoot,'app.asar/preload.cjs'):path.join(ROOT,'desktop/preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false,offscreen:true,backgroundThrottling:false}});
  ipcMain.on('lifeos:storage',(event,value)=>{try{event.returnValue={ok:true,value:store.operation(value)}}catch(error){event.returnValue={ok:false,error:error.message}}});
  ipcMain.handle('lifeos:update-status',()=>({status:'idle'}));ipcMain.handle('lifeos:pet-settings-get',()=>({mode:'hidden',motion:false,scale:1}));
  win.webContents.on('console-message',event=>{if(event.level==='error'&&!/Failed to load resource|net::ERR/.test(event.message))errors.push(event.message)});
  win.webContents.session.webRequest.onBeforeRequest({urls:['https://*/*','http://*/*']},(details,callback)=>callback(details.url.startsWith(base)?{}:{cancel:true}));
  await win.loadURL(base);await until('!!window.lifeosJournalBook&&!!window.lifeosMemoryDraw');await wait(800);
  const smoke=process.env.LIFEOS_QA_SMOKE==='1';
  const pages=smoke?['Home','Journal','Serendipity','Pet Shelf','AI Settings']:['Home','Journal','Universal Search','Serendipity','Daily Poetry','On This Day','Time Capsule','Pet Shelf','AI Settings','Attic','Attic Review','Attic Organize','Attic Observe','Analytics','Memory Provenance'];
  for(const size of smoke?['xlarge']:['default','xlarge']){
    await js(`const select=document.querySelector('#v03FontSize');select.value='${size}';select.dispatchEvent(new Event('change',{bubbles:true}));`);
    for(const width of smoke?[1440]:[1440,760,480]){
      win.setSize(width,1000);await wait(120);
      for(const page of pages){
        await js(page==='Pet Shelf'?"window.dispatchEvent(new Event('lifeos:open-pet'))":`openFeature(${JSON.stringify(page)})`);await until("!document.querySelector('#view .loading')");await wait(180);
        const result=await js(`const root=document.querySelector('#view'),shell=document.querySelector('.shell');const style=getComputedStyle(document.body);return {page:STATE.feature,bodySize:parseFloat(style.fontSize),overflow:Math.max(0,shell.scrollWidth-shell.clientWidth),caption:style.getPropertyValue('--text-caption'),text:root.innerText.slice(0,100),tiny:[...root.querySelectorAll('*')].filter(el=>el.childNodes.length&&[...el.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())&&el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden'&&parseFloat(getComputedStyle(el).fontSize)<12).slice(0,12).map(el=>({tag:el.tagName,cls:el.className,text:el.innerText.slice(0,40),size:getComputedStyle(el).fontSize}))}`);
        assert.equal(result.page,page);assert.ok(result.bodySize>=15);assert.ok(result.overflow<=2,JSON.stringify({width,size,...result}));assert.deepEqual(result.tiny,[],JSON.stringify({width,size,...result}));
        checks.push({width,size,...result});
        if((size==='default'&&width===1440)||(size==='xlarge'&&width===480))await shot(`${width}-${size}-${page.replaceAll(' ','-')}`);
      }
    }
  }
  win.setSize(1440,1000);await js("openFeature('Journal')");await until("!!document.querySelector('.jbSectionText')");await wait(200);
  const reading=await js(`const el=document.querySelector('.jbSectionText'),s=getComputedStyle(el),scroll=document.querySelector('.jbTextScroll');scroll.scrollTop=scroll.scrollHeight;return {size:parseFloat(s.fontSize),leading:parseFloat(s.lineHeight)/parseFloat(s.fontSize),scroll:scroll.scrollTop,body:parseFloat(getComputedStyle(document.body).fontSize)}`);
  assert.ok(reading.size>=22&&reading.size<=25);assert.ok(reading.leading>=1.8);assert.ok(reading.scroll>0);checks.push({reading});
  await js(`openProductDock('writer',{date:'2026-10-01'})`);await until("!!document.querySelector('.i2WriterCell .i2CellEditor')");await wait(300);await shot('writer-large');
  const writer=await js(`const el=document.querySelector('.i2WriterCell .i2CellEditor'),s=getComputedStyle(el);return {size:parseFloat(s.fontSize),leading:parseFloat(s.lineHeight)/parseFloat(s.fontSize)}`);assert.ok(writer.size>=22&&writer.leading>=1.8);checks.push({writer});
  await js("setProductDock(false);document.documentElement.dataset.theme='rain';openFeature('Serendipity')");await until("!!document.querySelector('.memoryDrawPage')");await wait(200);await shot('night-draw');
  assert.equal(await js("return getComputedStyle(document.documentElement).getPropertyValue('--paper').trim()"),'#121721');
  // Explicit nested roles must remain the same size as their parent role.
  const nested=await js(`const el=document.createElement('div');el.className='small';el.innerHTML='<span class="small">Nested helper</span>';document.body.append(el);const sizes=[parseFloat(getComputedStyle(el).fontSize),parseFloat(getComputedStyle(el.firstChild).fontSize)];el.remove();return sizes`);assert.equal(nested[0],nested[1]);checks.push({nested});
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({ok:true,checks,consoleErrors:errors,user_diaries_read:0},null,2));console.log(JSON.stringify({ok:true,checks:checks.length,out}));
}
async function cleanup(){if(win&&!win.isDestroyed())win.destroy();if(backend){const child=backend.child;backend.stop();if(child.exitCode===null)await Promise.race([new Promise(resolve=>child.once('close',resolve)),wait(3000)]);}}
app.whenReady().then(run).then(async()=>{await cleanup();app.quit()}).catch(async error=>{console.error(error.stack);if(win&&!win.isDestroyed())await shot('failure').catch(()=>{});fs.writeFileSync(path.join(out,'failure.txt'),error.stack);await cleanup();app.exit(1)});
