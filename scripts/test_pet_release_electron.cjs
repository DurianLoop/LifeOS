'use strict';
// Source integration QA. Only config and shipped public pets enter this workspace.
const {app,BrowserWindow,ipcMain}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const runtime=require('../desktop/runtime.cjs'),{createStore}=require('../desktop/workspace-store.cjs'),{normalizeSettings,SETTINGS_KEY}=require('../desktop/pet-controller.cjs');
const ROOT=path.resolve(__dirname,'..'),out=path.join(ROOT,'docs','qa_pet_release','run-'+Date.now()),workspace=path.join(out,'workspace');
fs.mkdirSync(workspace,{recursive:true});fs.cpSync(path.join(ROOT,'config'),path.join(workspace,'config'),{recursive:true});
fs.cpSync(path.join(ROOT,'app/assets/pets'),path.join(workspace,'app/assets/pets'),{recursive:true});
for(const folder of ['vault','data','.lifeos'])fs.mkdirSync(path.join(workspace,folder),{recursive:true});
app.setPath('userData',path.join(out,'profile'));const store=createStore(workspace),wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),checks=[],errors=[];
store.operation({op:'set',key:'lifeos.welcome.v1',value:'done'});
let backend,win,base,networkRequests=0,settings=normalizeSettings({}),phase=0,settingsDelay=0;
const settingsWrites=[],metrics={};
app.on('window-all-closed',()=>{});
ipcMain.on('lifeos:storage',(event,command)=>{try{event.returnValue={ok:true,value:store.operation(command)}}catch(error){event.returnValue={ok:false,error:error.message}}});
ipcMain.handle('lifeos:update-status',()=>({status:'idle'}));
ipcMain.handle('lifeos:pet-settings-get',()=>({ok:true,settings}));
ipcMain.handle('lifeos:pet-settings-set',async(_event,patch)=>{settingsWrites.push({...patch});if(settingsDelay)await wait(settingsDelay);settings=normalizeSettings(patch,settings);store.operation({op:'set',key:SETTINGS_KEY,value:JSON.stringify(settings)});const result={ok:true,settings};win.webContents.send('lifeos:pet-settings',result);return result});
ipcMain.handle('lifeos:pet-action',()=>({ok:true}));ipcMain.handle('lifeos:pet-refresh',()=>({ok:true,settings}));
const js=code=>win.webContents.executeJavaScript(`(async()=>{${code}})()`);
const until=async condition=>{for(let i=0;i<160;i++){if(await js('return '+condition))return;await wait(75)}throw Error('Wait failed: '+condition)};
const shot=async name=>{await wait(200);fs.writeFileSync(path.join(out,name+'.png'),(await win.webContents.capturePage()).toPNG())};
async function launch(){
  const port=await runtime.availablePort(),paths={dataRoot:workspace,resourceRoot:ROOT,logFile:path.join(out,'backend-'+(++phase)+'.log')};
  const env={...process.env,LIFEOS_PYTHON:path.join(ROOT,'desktop/python-runtime/python.exe'),PYTHON_KEYRING_BACKEND:'keyring.backends.null.Keyring'};
  for(const name of Object.keys(env))if(name.endsWith('_API_KEY')||['PYTHONHOME','PYTHONPATH','ELECTRON_RUN_AS_NODE'].includes(name))delete env[name];
  backend=runtime.startBackend(runtime.backendLaunch({...paths,isPackaged:false,env}),{...paths,port});base=`http://127.0.0.1:${port}`;
  await runtime.waitForServer(base+'/api/health',{failure:backend.failure});
  const persisted=store.operation({op:'get',key:SETTINGS_KEY});if(persisted)settings=normalizeSettings(JSON.parse(persisted));
  win=new BrowserWindow({width:1320,height:980,show:false,webPreferences:{preload:path.join(ROOT,'desktop/preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false,offscreen:true,backgroundThrottling:false}});
  win.webContents.on('console-message',details=>{if(details.level==='error'&&!/net::ERR|Failed to load resource/.test(details.message))errors.push(details.message)});
  win.webContents.session.webRequest.onBeforeRequest({urls:['https://*/*','http://*/*']},(details,callback)=>{if(details.url.startsWith(base))return callback({});networkRequests++;callback({cancel:true})});
  await win.loadURL(base);await until(`!!window.lifeosViVi&&!!window.lifeosPetRenderers&&!!window.lifeosSidebar`);await wait(1400);
  await js(`window.confirm=()=>true;window.dispatchEvent(new Event('lifeos:open-pet'))`);await until(`!!document.querySelector('#petPageCatalog .petPageCard')&&!!document.querySelector('#petSettingsToggle')`);
}
async function data(){return js(`return (await fetch('/api/pets/catalog',{cache:'no-store'})).json()`)}
async function closeSession(){
  if(win&&!win.isDestroyed()){
    await js(`document.querySelectorAll('.viviPetStage').forEach(stage=>lifeosPetRenderers.release(stage.parentElement));await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame)`).catch(()=>{});
    await win.loadURL('about:blank').catch(()=>{});
    win.webContents.stopPainting();
    win.destroy();win=null;
  }
  if(backend){
    const child=backend.child;
    if(child.exitCode===null&&child.signalCode===null){
      await new Promise(resolve=>{child.once('close',resolve);backend.stop();});
    }else backend.stop();
    backend=null;
  }
}
async function run(){
  await launch();let status=await data(),vivi='vivi--durianloop',otter=status.installed.find(p=>p.folder==='desk-otter').slug;
  assert.equal(status.installed[0].slug,vivi);assert.equal(status.installed.find(p=>p.slug===vivi).renderer,'vivi-gif');assert.equal(status.installed.find(p=>p.slug===vivi).actions.length,16);
  assert.equal(await js(`return getComputedStyle(document.querySelector('#petPageCatalog')).gridTemplateColumns.split(' ').length`),2);
  assert.equal(await js(`return document.querySelectorAll('#petPageInstalled [data-pet-uninstall]').length`),status.installed.length);checks.push('ViVi is present with all 16 original actions, two columns by default, and every installed pet can be removed');
  await js(`document.querySelector('#petPageInstalled [data-pet-activate="${vivi}"]').click()`);await until(`document.querySelector('#petPageSprite').dataset.petTarget==='${vivi}'&&document.querySelector('#petPageSprite .viviPetStage')?.dataset.ready==='true'`);
  await until(`document.querySelector('#lifePetFloatSprite .viviPetStage')?.dataset.ready==='true'`);assert.equal(await js(`return document.querySelector('#lifePetFloat').hidden`),false);
  assert.ok(await js(`const canvas=document.querySelector('#lifePetFloatSprite canvas'),data=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;return data.some((value,index)=>index%4===3&&value>0)`));
  checks.push('activating ViVi paints its GIF in the actual shelf and internal companion');
  await js(`document.querySelector('.petPageHero').scrollIntoView({block:'start'})`);await shot('灵犀-ViVi');
  await js(`document.querySelector('#petPageSprite').focus({preventScroll:true});document.querySelector('#petPageSprite').dispatchEvent(new KeyboardEvent('keydown',{key:'F10',shiftKey:true,bubbles:true}))`);await until(`!!document.querySelector('#petActionMenu:not([hidden])')`);
  const menuIds=await js(`return [...document.querySelectorAll('#petActionMenu [data-pet-action]')].map(el=>el.dataset.petAction).filter(id=>id!=='auto')`);
  assert.equal(menuIds.length,16);assert.ok(menuIds.includes('special0')&&menuIds.includes('start')&&menuIds.includes('walk_left'));await shot('ViVi-完整动作菜单');
  await js(`document.querySelector('#petActionMenu [data-pet-action="special0"]').click()`);await until(`document.querySelector('#lifePetFloatSprite .viviPetStage').dataset.action==='special0'`);
  assert.equal(await js(`return lifeosPetRenderers.get(document.querySelector('#lifePetFloatSprite')).getState().onceAction`),'special0');assert.equal(await js(`return lifeosPetRenderers.get(document.querySelector('#lifePetFloatSprite')).getState().manualLoop`),null);checks.push('all original ViVi actions are commands rather than saved loops, including the full long animation');
  await js(`await lifeosPetSettings.update({vivi:{autoBehavior:false}});lifeosPetActions.select('${vivi}','interact')`);await until(`lifeosPetRenderers.get(document.querySelector('#lifePetFloatSprite')).getState().onceAction==='interact'`);await until(`lifeosPetRenderers.get(document.querySelector('#lifePetFloatSprite')).getState().onceAction===null`);
  assert.equal(await js(`return lifeosPetRenderers.get(document.querySelector('#lifePetFloatSprite')).getState().action`),'sit');const previousCommand=await js(`return lifeosPetActions.command('${vivi}').requestId`);
  await js(`lifeosPetActions.select('${vivi}','interact')`);await until(`lifeosPetRenderers.get(document.querySelector('#lifePetFloatSprite')).getState().onceAction==='interact'`);assert.notEqual(await js(`return lifeosPetActions.command('${vivi}').requestId`),previousCommand);checks.push('one-shot finishes into automatic idle and clicking the same action again starts a new full cycle');
  const defaultCatalogCount=await js(`return document.querySelectorAll('#petPageCatalog .petPageCard').length`);
  await js(`const input=document.querySelector('#petPageSearch');input.value='not-a-real-pet-2026';input.dispatchEvent(new Event('input',{bubbles:true}))`);assert.equal(await js(`return document.querySelectorAll('#petPageCatalog .petPageCard').length`),0);assert.equal(await js(`return document.querySelector('#petPageSearchClear').hidden`),false);
  await shot('宠物库-搜索清除');await js(`document.querySelector('#petPageSearchClear').click()`);assert.equal(await js(`return document.querySelectorAll('#petPageCatalog .petPageCard').length`),defaultCatalogCount);assert.equal(await js(`return document.querySelector('#petPageCategory').value`),'all');
  await js(`const input=document.querySelector('#petPageSearch');input.value='vivi';input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);assert.equal(await js(`return document.querySelector('#petPageSearch').value`),'');assert.equal(await js(`return document.querySelectorAll('#petPageCatalog .petPageCard').length`),defaultCatalogCount);checks.push('pet library clear icon and Escape restore the default list and filters');
  await js(`lifeosPetActions.select('${vivi}','sit');document.querySelector('#petSettingsToggle').click()`);await until(`!document.querySelector('#petSettingsPanel').hidden&&!!document.querySelector('[data-vivi-setting="dragAction"]')`);
  assert.ok(await js(`return ['mode','visible','keepOnClose','alwaysOnTop','scale'].every(name=>!!document.querySelector('[data-pet-setting="'+name+'"]'))`));
  assert.ok(await js(`return ['dragAction','autoBehavior','edgeHide'].every(name=>!!document.querySelector('[data-vivi-setting="'+name+'"]'))`));
  await js(`const el=document.querySelector('[data-vivi-setting="dragAction"]');el.value='sweat';el.dispatchEvent(new Event('change',{bubbles:true}))`);await until(`lifeosViViSettings.get().dragAction==='sweat'`);
  await js(`const el=document.querySelector('[data-vivi-setting="autoBehavior"]');el.checked=false;el.dispatchEvent(new Event('change',{bubbles:true}))`);await until(`lifeosViViSettings.get().autoBehavior===false`);
  await shot('桌宠-极简设置');checks.push('room settings preserve size, placement and the original ViVi drag/automatic/hiding preferences');
  await js(`const el=document.querySelector('[data-pet-setting="scale"]');el.value='1.5';el.dispatchEvent(new Event('change',{bubbles:true}))`);await until(`lifeosPetSettings.get().scale===1.5`);
  assert.ok(Math.abs(await js(`return document.querySelector('#lifePetFloatSprite').getBoundingClientRect().width`)-216)<1);
  assert.ok(Math.abs(await js(`return document.querySelector('#lifePetFloat').getBoundingClientRect().width`)-216)<1,'paint containment must resize with the pet rather than cropping it');
  assert.ok(Math.abs(await js(`return lifeosPetRenderers.get(document.querySelector('#lifePetFloatSprite')).getState().width`)-216)<1);checks.push('global scale reaches the original renderer once without multiplying twice');
  settingsDelay=140;const beforeWrites=settingsWrites.length;
  metrics.scale=await js(`const slider=document.querySelector('[data-pet-setting="scale"]'),pet=lifeosPetRenderers.get(document.querySelector('#lifePetFloatSprite'));const started=performance.now();slider.value='1.13';slider.dispatchEvent(new Event('input',{bubbles:true}));await new Promise(requestAnimationFrame);const first={ms:performance.now()-started,scale:lifeosPetSettings.get().scale,width:pet.getState().width,disabled:slider.disabled};for(let i=0;i<24;i++){slider.value=String(1.13+i*.01);slider.dispatchEvent(new Event('input',{bubbles:true}));await new Promise(r=>setTimeout(r,12));if(Math.abs(lifeosPetSettings.get().scale-Number(slider.value))>.001)throw Error('older IPC response replaced the live scale')}slider.value='1.37';slider.dispatchEvent(new Event('input',{bubbles:true}));slider.dispatchEvent(new Event('change',{bubbles:true}));await lifeosPetSettings.update({vivi:{edgeHide:false}});return {first,finalScale:lifeosPetSettings.get().scale,width:pet.getState().width,edgeHide:lifeosViViSettings.get().edgeHide,step:slider.step,trackHeight:getComputedStyle(slider,'::-webkit-slider-runnable-track').height,progress:slider.style.getPropertyValue('--pet-scale-progress')}`);
  assert.equal(metrics.scale.first.scale,1.13);assert.equal(metrics.scale.first.disabled,false);assert.ok(Math.abs(metrics.scale.first.width-163)<1);assert.equal(metrics.scale.finalScale,1.37);assert.equal(metrics.scale.edgeHide,false);assert.equal(metrics.scale.step,'0.01');
  metrics.scale.nativeWrites=settingsWrites.length-beforeWrites;assert.ok(metrics.scale.nativeWrites<12);assert.equal(settings.scale,1.37);assert.equal(settings.vivi.edgeHide,false);assert.ok(settingsWrites.slice(beforeWrites).some(p=>p.commit===true&&p.scale===1.37));
  checks.push('thin slider previews before a slow IPC save, coalesces rapid input and persists the final scale with other settings');
  await shot('桌宠-细滑条');settingsDelay=0;await js(`await lifeosPetSettings.update({scale:1.5,commit:true})`);
  await js(`const el=document.querySelector('[data-pet-setting="mode"]');el.value='desktop';el.dispatchEvent(new Event('change',{bubbles:true}))`);await until(`lifeosPetSettings.get().mode==='desktop'&&document.querySelector('#lifePetFloat').hidden`);
  assert.equal(await js(`return document.querySelector('#lifePetFloat').inert`),true);assert.equal(await js(`return document.querySelector('#lifePetChat').hidden`),true);
  await js(`window.dispatchEvent(new Event('lifeos:open-pet-chat'))`);await wait(200);assert.equal(await js(`return document.querySelector('#lifePetFloat').hidden`),true);checks.push('desktop placement hides and disables the internal companion and does not revive it through chat');
  await js(`const el=document.querySelector('[data-pet-setting="mode"]');el.value='in_app';el.dispatchEvent(new Event('change',{bubbles:true}))`);await until(`lifeosPetSettings.get().mode==='in_app'&&!document.querySelector('#lifePetFloat').hidden`);
  await js(`document.querySelector('#petSettingsToggle').click();document.querySelector('#petPageInstalled [data-pet-uninstall="${vivi}"]').click()`);await until(`!document.querySelector('#petPageInstalled [data-pet-mini="${vivi}"]')`);
  await js(`document.querySelector('#petPageInstalled [data-pet-uninstall="${otter}"]').click()`);await until(`!document.querySelector('#petPageInstalled [data-pet-mini="${otter}"]')`);
  status=await data();assert.equal(status.installed.some(p=>p.slug===vivi||p.slug===otter),false);assert.ok(fs.existsSync(path.join(workspace,'app/assets/pets/vivi/sit.gif')));assert.ok(fs.existsSync(path.join(workspace,'app/assets/pets/desk-otter/spritesheet.webp')));checks.push('removing ViVi and bundled Desk Otter updates active selection while preserving recoverable local assets');
  await closeSession();await launch();status=await data();assert.equal(status.installed.some(p=>p.slug===vivi||p.slug===otter),false);
  assert.equal(await js(`return lifeosPetSettings.get().scale`),1.5);assert.equal(await js(`return lifeosViViSettings.get().dragAction`),'sweat');checks.push('removed pets remain removed across a new server port and settings survive restart');
  await js(`document.querySelector('#petPageCatalog [data-pet-install="${vivi}"]').click()`);await until(`!!document.querySelector('#petPageInstalled [data-pet-mini="${vivi}"]')`);status=await data();assert.equal(status.active_slug,vivi);
  await until(`document.querySelector('#lifePetFloatSprite .viviPetStage')?.dataset.ready==='true'`);checks.push('removed ViVi restores and activates offline from its public bundled package');
  assert.deepEqual(errors,[]);assert.equal(fs.readdirSync(path.join(workspace,'vault')).length,0);checks.push('source renderer has no script errors and no journal data is imported or read');
  const entry=await js(`return fetch('/api/entries/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({journal_date:'2026-10-01',title:'QA synthetic entry',sections:{'日记':'海风拂过窗台，这是搜索验收专用的合成记录。'}})}).then(r=>r.json())`);assert.equal(entry.ok,true);
  await js(`await openFeature('Universal Search')`);await until(`!!document.querySelector('#i2SearchResults')&&!!document.querySelector('#searchQ')`);
  await js(`window.__qaOriginalFetch=window.fetch;window.__qaSearchRequests=0;window.fetch=async(input,options)=>{if(!String(input).startsWith('/api/search?'))return __qaOriginalFetch(input,options);__qaSearchRequests++;const response=await __qaOriginalFetch(input,options),body=await response.text();await new Promise(r=>setTimeout(r,220));return new Response(body,{status:response.status,headers:response.headers})};const q=document.querySelector('#searchQ');q.value='海风';q.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`);await until(`__qaSearchRequests===1`);await js(`document.querySelector('#searchClear').click()`);await wait(450);
  assert.equal(await js(`return document.querySelector('#searchQ').value`),'');assert.equal(await js(`return document.querySelectorAll('.i2Result').length`),0);assert.equal(await js(`return sessionStorage.getItem('lifeos.i2.search')`),null);checks.push('global search clear prevents a delayed real backend response from restoring old results');
  await js(`const q=document.querySelector('#searchQ');q.value='海风';q.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`);await until(`document.querySelectorAll('.i2Result').length>0`);
  assert.equal(await js(`return __qaSearchRequests`),2,'no hidden compatibility search issues a duplicate request');await shot('寻迹-搜索结果');
  await js(`document.querySelector('.i2Result button.source').click()`);await until(`STATE.feature==='Journal'&&!!document.querySelector('#journalBackSearch:not([hidden])')`);assert.ok(await js(`return sessionStorage.getItem('lifeos.i2.search')`));await js(`document.querySelector('#journalBackSearch').click()`);await until(`STATE.feature==='Universal Search'&&document.querySelectorAll('.i2Result').length>0`);
  await js(`document.querySelector('#searchKind').value='daily';document.querySelector('#searchKind').dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('#searchClear').click();await openFeature('Home');await openFeature('Universal Search')`);await until(`STATE.feature==='Universal Search'&&!!document.querySelector('#searchQ')`);await wait(500);
  assert.deepEqual(await js(`return {query:document.querySelector('#searchQ').value,kind:document.querySelector('#searchKind').value,year:document.querySelector('#searchYear').value,section:document.querySelector('#searchSection').value,sort:document.querySelector('#searchSort').value,rows:document.querySelectorAll('.i2Result').length,session:sessionStorage.getItem('lifeos.i2.search')}`),{query:'',kind:'all',year:'',section:'',sort:'relevance',rows:0,session:null});
  await shot('寻迹-恢复默认');await js(`window.fetch=__qaOriginalFetch`);assert.deepEqual(errors,[]);checks.push('search returns from the original page, clears all filters and remains default after navigating away and back');
  fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({ok:true,checks,metrics,real_diaries_opened:0,synthetic_diaries:1,remote_ai_calls:0,network_attempts_blocked:networkRequests,native_window_scope:'separate desktop controller tests',source_workspace:workspace},null,2));console.log(JSON.stringify({ok:true,checks:checks.length,metrics,out}));
}
app.whenReady().then(run).then(async()=>{await closeSession();setImmediate(()=>app.quit());}).catch(async error=>{fs.writeFileSync(path.join(out,'failure.txt'),error.stack);if(win&&!win.isDestroyed()){const state=await js(`return {feature:STATE.feature,active:document.querySelector('#petPageSprite')?.dataset.petTarget,stage:document.querySelector('#lifePetFloatSprite .viviPetStage')?.dataset,settings:window.lifeosPetSettings?.get(),extra:window.lifeosViViSettings?.get(),text:document.querySelector('#petSettingsHint')?.textContent}`).catch(()=>null);fs.writeFileSync(path.join(out,'failure-state.json'),JSON.stringify({state,errors},null,2));fs.writeFileSync(path.join(out,'failure.png'),(await win.webContents.capturePage()).toPNG());}console.error(error.stack);process.exitCode=1;await closeSession();setImmediate(()=>app.quit());});
