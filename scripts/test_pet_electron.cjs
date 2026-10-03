'use strict';
// Run with desktop/node_modules/electron/dist/electron.exe scripts/test_pet_electron.cjs.
// Only shipped public pet assets are used; no backend or personal workspace is opened.
const {app,BrowserWindow,ipcMain}=require('electron');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {updatePetWindow}=require('../desktop/pet-window.cjs');
const ROOT=path.resolve(__dirname,'..');
const previewMode=process.argv.includes('--preview');
const assetRoot=previewMode?path.join(ROOT,'docs','qa_ai','preview-latest','app','assets','pets'):path.join(ROOT,'app','assets','pets');
const output=path.join(ROOT,'docs','qa_pet',previewMode?'renderer-preview':'renderer');
fs.mkdirSync(output,{recursive:true});
app.setPath('userData',path.join(output,'user-data'));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
app.whenReady().then(async()=>{
  const window=new BrowserWindow({width:192,height:208,show:false,frame:false,transparent:true,
    webPreferences:{contextIsolation:true,sandbox:true,preload:path.join(ROOT,'desktop','pet-preload.cjs')}});
  const fallback=rows=>Array.from({length:rows},()=>[0,1,2,3,4,5,6,7]);
  const pet={id:'desk-otter',version:1,frameMap:fallback(9),sprite:pathToFileURL(path.join(assetRoot,'desk-otter','spritesheet.webp')).href};
  const report={captures:[]};
  let ready=0,navigations=0;
  ipcMain.on('lifeos:pet-ready',event=>{if(event.sender===window.webContents)ready++;});
  window.webContents.on('did-finish-load',()=>navigations++);
  try{
    await updatePetWindow(window,pet,path.join(ROOT,'desktop','pet.html'));
    for(let i=0;i<40;i++){
      report.dom=await window.webContents.executeJavaScript(`({error:document.querySelector('#pet').dataset.loadError||'',background:document.querySelector('#pet').style.backgroundImage,position:document.querySelector('#pet').style.backgroundPosition})`);
      if(report.dom.error||report.dom.background)break;
      await sleep(50);
    }
    report.fileCanvas=await window.webContents.executeJavaScript(`(async()=>{const image=new Image();image.src=${JSON.stringify(pet.sprite)};try{await image.decode();const canvas=document.createElement('canvas');canvas.width=1;canvas.height=1;const c=canvas.getContext('2d');c.drawImage(image,0,0);c.getImageData(0,0,1,1);return {ok:true}}catch(error){return {ok:false,name:error.name,message:error.message}}})()`);
    const capture=await window.webContents.capturePage();
    fs.writeFileSync(path.join(output,'desktop-pet.png'),capture.toPNG());
    const pixels=capture.toBitmap();
    report.opaquePixels=0;for(let i=3;i<pixels.length;i+=4)if(pixels[i])report.opaquePixels++;
    assert.equal(report.dom.error,'');
    assert.ok(report.dom.background,'pet background is installed');
    assert.ok(report.opaquePixels>100,'captured pet has visible pixels');
    for(const [folder,version] of [['firefly--lingxiaotian',1],['drill-cat--qimi',2],['desk-otter',1]]){
      const next={id:folder,version,frameMap:fallback(version===2?11:9),sprite:pathToFileURL(path.join(assetRoot,folder,'spritesheet.webp')).href};
      const before=ready;
      await updatePetWindow(window,next,path.join(ROOT,'desktop','pet.html'));
      for(let i=0;i<80&&ready===before;i++)await sleep(25);
      assert.ok(ready>before,`${folder} decoded and notified readiness`);
      const state=await window.webContents.executeJavaScript(`({id:meta.id,frames:meta.frameMap,error:root.dataset.loadError||''})`);
      assert.equal(state.id,folder);assert.equal(state.error,'');
      assert.deepEqual(state.frames[0],version===2?[0,1,2,3,4,5,6]:[0,1,2,3,4,5]);
      assert.deepEqual(state.frames[3],[0,1,2,3]);
      const timeline=[];
      for(let sample=0;sample<16;sample++){
        await sleep(110);
        const position=await window.webContents.executeJavaScript('root.style.backgroundPosition');
        const sampled=await window.webContents.capturePage(),bitmap=sampled.toBitmap();
        let visible=0;for(let i=3;i<bitmap.length;i+=4)if(bitmap[i])visible++;
        assert.ok(visible>100,`${folder} timed sample ${sample} stays visible`);
        timeline.push({position,alphaPixels:visible});
        fs.writeFileSync(path.join(output,`${folder}-idle-${String(sample).padStart(2,'0')}.png`),sampled.toPNG());
      }
      assert.equal(new Set(timeline.map(sample=>sample.position)).size,state.frames[0].length,'continuous sampling covers every idle frame');
      await window.webContents.executeJavaScript('clearTimeout(timer);timer=null;setState("idle")');
      const samples=[];
      for(let frame=0;frame<state.frames[0].length;frame++){
        await window.webContents.executeJavaScript(`frame=${frame};renderSprite()`);
        const frameImage=await window.webContents.capturePage(),bitmap=frameImage.toBitmap();
        let count=0;for(let i=3;i<bitmap.length;i+=4)if(bitmap[i])count++;
        assert.ok(count>100,`${folder} idle frame ${frame} is visible`);samples.push(count);
      }
      fs.writeFileSync(path.join(output,folder+'.png'),(await window.webContents.capturePage()).toPNG());
      report.captures.push({id:folder,alphaPixels:samples,timeline,frameMap:state.frames});
      await updatePetWindow(window,next,path.join(ROOT,'desktop','pet.html'));
      assert.equal(ready,before+1,'same settings do not reinitialize animation');
    }
    assert.equal(navigations,1,'pet changes never reload the transparent window');
    report.navigations=navigations;report.ready=ready;
    fs.writeFileSync(path.join(output,'result.json'),JSON.stringify(report,null,2));
    console.log('PASS real Electron pet renderer',JSON.stringify(report));
    app.exit(0);
  }catch(error){
    report.failure=error.message;
    fs.writeFileSync(path.join(output,'result.json'),JSON.stringify(report,null,2));
    console.error(JSON.stringify(report));app.exit(1);
  }
}).catch(error=>{fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({failure:error.message}));app.exit(1)});
