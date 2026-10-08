'use strict';
// Render the shipped application against a NEW workspace containing fictional samples only.
// Run with Electron, not node. No production workspace/profile is read.
const {app,BrowserWindow,ipcMain}=require('electron');
app.commandLine.appendSwitch('force-device-scale-factor','1');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const args=process.argv.slice(2),option=(name,fallback)=>{const i=args.indexOf('--'+name);return i<0?fallback:args[i+1]};
if(!option('source-root'))throw Error('Provide --source-root pointing to a clean release checkout. See docs/images/readme/CAPTURE.md.');
const SOURCE=path.resolve(option('source-root'));
const OUTPUT=path.resolve(option('output',path.join(__dirname,'../docs/images/readme')));
const TEMP=path.resolve(option('temp-root',path.join(require('node:os').tmpdir(),'lifeos-readme-capture')));
const PYTHON=path.resolve(option('python',path.join(SOURCE,'desktop/python-runtime/python.exe')));
const sourceCommit=execFileSync('git',['-C',SOURCE,'rev-parse','HEAD'],{encoding:'utf8',windowsHide:true}).trim();
let sourceTag;try{sourceTag=execFileSync('git',['-C',SOURCE,'describe','--exact-match','--tags','HEAD'],{encoding:'utf8',windowsHide:true}).trim()}catch{sourceTag=null}
const runRoot=path.join(TEMP,'run-'+Date.now()),workspace=path.join(runRoot,'workspace');
fs.mkdirSync(workspace,{recursive:true});fs.mkdirSync(OUTPUT,{recursive:true});
const runtime=require(path.join(SOURCE,'desktop/runtime.cjs'));
const {createStore}=require(path.join(SOURCE,'desktop/workspace-store.cjs'));
const {normalizeSettings}=require(path.join(SOURCE,'desktop/pet-controller.cjs'));
runtime.prepareWorkspace({resourceRoot:SOURCE,dataRoot:workspace});
app.setPath('userData',path.join(runRoot,'profile'));
const store=createStore(workspace),wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
store.operation({op:'set',key:'lifeos.welcome.v1',value:'done'});
store.operation({op:'set',key:'lifeos.writer.habits.v1',value:JSON.stringify(['阅读','运动','早睡','冥想'])});
let settings=normalizeSettings({visible:false}),backend,win,base;const errors=[],blocked=[],shots=[];
app.on('window-all-closed',()=>{});
ipcMain.on('lifeos:storage',(event,command)=>{try{event.returnValue={ok:true,value:store.operation(command)}}catch(error){event.returnValue={ok:false,error:error.message}}});
ipcMain.handle('lifeos:update-status',()=>({status:'idle'}));
ipcMain.handle('lifeos:window-control',()=>({ok:true}));
ipcMain.handle('lifeos:pet-settings-get',()=>({ok:true,settings}));
ipcMain.handle('lifeos:pet-settings-set',async(_event,patch)=>{settings=normalizeSettings(patch,settings);const value={ok:true,settings};win.webContents.send('lifeos:pet-settings',value);return value});
ipcMain.handle('lifeos:pet-action',()=>({ok:true}));ipcMain.handle('lifeos:pet-refresh',()=>({ok:true,settings}));
const js=code=>win.webContents.executeJavaScript(`(async()=>{${code}})()`);
const until=async condition=>{for(let i=0;i<180;i++){if(await js('return '+condition))return;await wait(100)}throw Error('Wait failed: '+condition)};
async function request(url,body){const r=await fetch(base+url,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const result=await r.json();assert.ok(r.ok,JSON.stringify(result));return result}
const entries=[
 {date:'2026-09-18',title:'把日子过成喜欢的样子',body:'下班时绕了远路，沿着河边慢慢走。夕阳落在水面上，像撒了一把碎金。\n\n在路边的小店买了一束洋甘菊。没有特别的理由，只是觉得今天的书桌应该有一点花香。\n\n我想，认真生活也许就是愿意为这些小事停下来。'},
 {date:'2026-09-23',title:'秋天寄来一封信',body:'翻出了去年秋天写的便笺，上面只有一句话：慢一点，也会到达。\n\n那时觉得遥远的事，如今已经成了生活的一部分。最值得庆祝的，是我还在保持好奇。'},
 {date:'2026-09-28',title:'在书店度过的下午',body:'午后的书店很安静，只有翻页的声音。读到一段喜欢的文字，便抄进了本子里。\n\n回家的路上想起，阅读让一个普通的下午，忽然变得很宽。'},
 {date:'2026-10-01',title:'十月，从一场散步开始',body:'清晨去公园走了一圈，空气里已经有桂花的味道。没有急着完成什么，只是看树叶，看慢慢亮起来的天空。\n\n这个月想继续写日记，读完一本喜欢的书，也给自己留一些没有安排的时间。'},
 {date:'2026-10-04',title:'留一点空白给自己',body:'今天把手机留在书桌上，去附近的小公园坐了半小时。看云一点点移动，心里的杂音也渐渐安静下来。\n\n有些答案，需要空白才能出现。'},
 {date:'2026-10-06',title:'雨天里的小小进展',body:'窗外下了一整天的雨。泡了一壶热茶，把搁置的读书笔记整理完了。\n\n进展不一定很大，但只要往前走一点，就值得在今天的日记里画一颗星。'},
 {date:'2026-10-07',title:'今天也有值得记住的事',body:'傍晚和朋友散步，聊最近读到的书。一路上没有看手机，倒是看见了许多平时会错过的风景。\n\n回到家时，天刚刚暗下来。给明天列了一个很短的计划，然后安心地合上本子。'},
 {date:'2026-10-08',title:'把平凡的一天，认真收藏',body:'傍晚回家的路上，闻到了桂花香。风很轻，天空是一种刚刚好的蓝。\n\n在书桌前泡了一杯热茶，把今天的小事慢慢写下来：读完的章节，走过的小路，还有一次很好的聊天。\n\n日子不必总是闪闪发光。有时候，能够清楚地记得自己怎样度过了一天，就已经很好。'}
];
async function shot(name){await js(`document.activeElement?.blur();await document.fonts.ready;await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame)`);await wait(900);const file=path.join(OUTPUT,name+'.png');const capture=await win.webContents.capturePage();fs.writeFileSync(file,capture.toPNG());shots.push({file:path.basename(file),size:capture.getSize(),feature:await js('return STATE.feature')});console.log('Captured '+name)}
async function run(){
 const port=await runtime.availablePort(),paths={dataRoot:workspace,resourceRoot:SOURCE,logFile:path.join(runRoot,'backend.log')};
 const env={...process.env,LIFEOS_PYTHON:PYTHON,PYTHON_KEYRING_BACKEND:'keyring.backends.null.Keyring'};
 for(const name of Object.keys(env))if(name.endsWith('_API_KEY')||['PYTHONHOME','PYTHONPATH','ELECTRON_RUN_AS_NODE'].includes(name))delete env[name];
 const launch=runtime.backendLaunch({...paths,isPackaged:false,env});
 // Fail closed for outbound Python sockets; the HTTP server remains loopback-only.
 const guard=`import socket,runpy\n_original_connect=socket.socket.connect\ndef _local_connect(self,address):\n if isinstance(address,tuple) and str(address[0]) not in ('127.0.0.1','localhost','::1'):\n  raise OSError('README capture blocks external network')\n return _original_connect(self,address)\nsocket.socket.connect=_local_connect\nrunpy.run_path(${JSON.stringify(path.join(SOURCE,'desktop/server_bootstrap.py'))},run_name='__main__')`;
 launch.args=['-c',guard];backend=runtime.startBackend(launch,{...paths,port});base=`http://127.0.0.1:${port}`;
 await runtime.waitForServer(base+'/api/health',{failure:backend.failure});
 for(const entry of entries){const sections={'日记':entry.body};if(entry.date==='2026-10-08')Object.assign(sections,{'日程':'09:00 · 阅读与晨间记录\n14:00 · 完成一个小目标\n18:30 · 散步，看看秋天','自我探索':'今天什么时候最有能量？\n\n把注意力放回手边的小事时，心里反而更安定。','心得与摘录':'「生活的美，是认真看见。」\n\n不急着给每一天评分，先把它记下来。','体系构建':'每天留十分钟收拾书桌。\n每周回看一页旧日记。\n让习惯从很小的行动开始。','习惯打卡':'- [x] 阅读\n- [x] 运动\n- [x] 早睡\n- [ ] 冥想'});const out=await request('/api/entries/save',{journal_date:entry.date,title:entry.title,sections,tags:['生活','记录'],timezone:'Asia/Shanghai'});assert.equal(out.ok,true);entry.path=out.result.source_path;}
 const letters=[['写给明年春天的自己','dawn',180,'愿你依然愿意为了路边盛开的花停下来，也记得最初为什么出发。'],['等一个晴朗的周末','moon',14,'到那一天，带上相机和一本书，去看一看还没有走过的路。'],['愿你依然心怀好奇','dusk',90,'把今天的小愿望交给时间。等我们再见，希望你仍然认真地喜欢着生活。']];
 for(const [title,theme,days,body] of letters){const d=await request('/api/bottles/draft',{title,body,kind:'text',theme,unlock_at:Math.floor(Date.now()/1000)+days*86400,timezone:'Asia/Shanghai'});await request('/api/bottles/'+d.id+'/seal',{revision:d.revision})}
 win=new BrowserWindow({width:1600,height:1100,useContentSize:true,frame:false,show:false,webPreferences:{preload:path.join(SOURCE,'desktop/preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false,offscreen:true,backgroundThrottling:false}});
 win.setContentSize(1600,1100);
 win.webContents.on('console-message',details=>{if(details.level==='error'&&!/net::ERR|Failed to load resource/.test(details.message))errors.push(details.message)});
 win.webContents.session.webRequest.onBeforeRequest({urls:['https://*/*','http://*/*']},(details,callback)=>{if(details.url.startsWith(base+'/'))return callback({});blocked.push(new URL(details.url).origin);callback({cancel:true})});
 await win.loadURL(base);await until('!!window.lifeosMemoryDraw&&!!window.lifeosSidebar&&!!window.lifeosBottles');await wait(1000);
 await js(`await openProductDock('writer',{date:'2026-10-08'})`);await until(`!!document.querySelector('.i2WriterGrid')`);await shot('desk');
 await js(`setProductDock(false);await openJournal(${JSON.stringify(entries[7].path)})`);await until(`!!document.querySelector('.i2JournalVolume')&&!document.querySelector('#productDock').classList.contains('open')`);await shot('journal');
 await js(`await openFeature('Serendipity');await lifeosMemoryDraw.draw()`);await until(`!!document.querySelector('.memoryDrawSource')`);await shot('memory');
 await js(`await openFeature('Time Capsule')`);await until(`document.querySelectorAll('.bottleCard').length===3`);await shot('bottles');
 await js(`window.dispatchEvent(new Event('lifeos:open-pet'))`);await until(`!!document.querySelector('#petPageInstalled [data-pet-activate="vivi--durianloop"]')`);
 await js(`document.querySelector('#petPageInstalled [data-pet-activate="vivi--durianloop"]').click();await lifeosPetSettings.update({visible:true})`);await until(`document.querySelector('#petPageSprite .viviPetStage')?.dataset.ready==='true'`);await shot('companion');
 const report={sourceTag,sourceCommit,sourceRoot:SOURCE,shots,fictionalSampleEntries:entries.map(({date,title,path})=>({date,title,path})),fictionalLetters:letters.map(([title,theme])=>({title,theme})),isolatedWorkspace:workspace,network:'External renderer requests blocked; external Python socket connections blocked; no model configuration or credentials loaded.',externalRequestsBlocked:[...new Set(blocked)],rendererErrors:errors,notes:'Screenshots are direct Electron capturePage renders of the unmodified released application. All diary and letter content is fictional. No real user vault/data/profile was read.'};
 fs.writeFileSync(path.join(runRoot,'capture-report.json'),JSON.stringify(report,null,2));
 fs.writeFileSync(path.join(TEMP,'latest-run.txt'),runRoot);console.log(JSON.stringify({ok:true,output:OUTPUT,report:path.join(runRoot,'capture-report.json')}));
}
async function cleanup(){if(win&&!win.isDestroyed()){await win.loadURL('about:blank').catch(()=>{});win.webContents.stopPainting();win.destroy()}if(backend){const child=backend.child;if(child.exitCode===null&&child.signalCode===null)await new Promise(resolve=>{child.once('close',resolve);backend.stop()});else backend.stop()}}
app.whenReady().then(run).then(async()=>{await cleanup();app.quit()}).catch(async error=>{fs.writeFileSync(path.join(runRoot,'failure.txt'),error.stack);if(win&&!win.isDestroyed()){fs.writeFileSync(path.join(runRoot,'failure.png'),(await win.webContents.capturePage()).toPNG());fs.writeFileSync(path.join(runRoot,'dom.txt'),await js('return document.body.innerText').catch(()=>''))}console.error(error.stack);await cleanup();app.exit(1)});
