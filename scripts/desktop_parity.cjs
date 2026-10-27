'use strict';

// Acceptance runs inside the real packaged Electron main process. Only
// synthetic entries and a disposable application profile are used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

module.exports = async function desktopParity({window, js, until, screenshot, output, resources, sourcePath}) {
  const pages = [], tools = [];
  const assetHash = crypto.createHash('sha256');
  const appRoot = path.join(resources, 'app');
  function fingerprint(directory) {
    for (const entry of fs.readdirSync(directory, {withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'en'))) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) fingerprint(file);
      else if (/\.(?:html|js|css|woff2)$/.test(file)) assetHash.update(path.relative(appRoot,file).split(path.sep).join('/')).update(fs.readFileSync(file));
    }
  }
  fingerprint(appRoot);
  await js(`document.fonts.ready`);
  const fonts = await js(`({serif:document.fonts.check('18px "LifeOS Book"','日记与生活'),sans:document.fonts.check('16px "LifeOS UI"','落笔与流年'),desktop:document.documentElement.classList.contains('desktopRenderer'),mobile:!!window.lifeosMobile})`);
  assert.deepEqual(fonts, {serif:true,sans:true,desktop:true,mobile:false});

  const metrics = () => js(`(()=>{
    const selectors=['.lifeWindowBar','.rail','.shell','#view h1','#view h2','.i2DeskHead','.i2WriterStageTop','.i2WriterGrid','.i2WriterCell','.jbSpread','.jbIndexPage','.jbReadingPage','.memoryDrawHeader','.memoryDrawStage','.bottleHead','.bottleGrid','.atticHeader'];
    const rows={};for(const selector of selectors){const nodes=[...document.querySelectorAll(selector)].filter(n=>n.getClientRects().length);rows[selector]=nodes.map(n=>{const r=n.getBoundingClientRect(),s=getComputedStyle(n);return {x:r.x,y:r.y,width:r.width,height:r.height,font:s.fontFamily,size:s.fontSize,line:s.lineHeight}})}
    return {width:innerWidth,height:innerHeight,bodyOverflow:document.documentElement.scrollWidth>innerWidth+1,rows};
  })()`);
  async function capture(name) {
    await js(`document.fonts.ready`);
    await delay(550); // Allow the existing paper entrance and layout observer to settle.
    const layout = await metrics();
    assert.equal(layout.bodyOverflow,false,name+' has no horizontal document overflow');
    await screenshot('parity-'+name);
    pages.push({name,...layout});
  }
  // Both OSes use this common real content size; no device emulation or
  // offscreen renderer substitutes for the actual native window.
  window.setContentSize(1024, 684);
  await js(`(()=>{setProductDock(false);openFeature('Home')})()`);
  await until(()=>js(`STATE.feature==='Home'&&!!document.querySelector('#view .homePage')`),'desktop home');
  await capture('home');
  await js(`openProductDock('writer',{date:'2099-01-07'})`);
  await until(()=>js(`!!document.querySelector('#writerForm')&&!!document.querySelector('.i2WriterGrid')`),'six-cell desk');
  const cells = await js(`[...document.querySelectorAll('.i2WriterGrid .i2WriterCell:not(.i2Hidden)')].map(n=>n.dataset.key)`);
  assert.equal(cells.length,6,'Windows six-cell desk is present on each OS');
  await capture('writer');
  await js(`document.querySelector('#writerCustomizeCells').click()`);
  assert.equal(await js(`document.querySelector('.i2Desk').classList.contains('i2DeskInlineEdit')`),true);
  await capture('writer-layout');
  await js(`(()=>{document.querySelector('#writerCustomizeCells').click();document.querySelector('#writerSaveTemplate').click()})()`);
  await until(()=>js(`!!document.querySelector('.i2ChapterOpen')`),'layout templates');
  await capture('writer-templates');
  await js(`(()=>{document.querySelector('#writerDrawerClose').click();setProductDock(false);openJournal(${JSON.stringify(sourcePath)})})()`);
  await until(()=>js(`!!document.querySelector('.jbPageBody')`),'book reader');
  await capture('journal');

  for (const [name,feature] of [
    ['search','Universal Search'],['poetry','Daily Poetry'],['memory','Serendipity'],
    ['bottles','Time Capsule'],['companion','Pet Shelf'],['overview','Attic'],
    ['review','Attic Review'],['organize','Attic Organize'],['observe','Attic Observe'],['ai','AI Settings']
  ]) {
    if(name==='companion')await js(`document.querySelector('[data-sidebar-item="pet"]').click()`);
    else await js(`openFeature(${JSON.stringify(feature)})`);
    await until(()=>js(`STATE.feature===${JSON.stringify(feature)}&&!document.querySelector('#view .loading')&&document.querySelector('#view')?.textContent.trim().length>0`),feature);
    await capture(name);
    if(name==='memory') {
      await js(`document.querySelector('#memoryDrawRun').click()`);
      await until(()=>js(`document.querySelector('#memoryDrawStage')?.getAttribute('aria-busy')==='false'&&!!document.querySelector('.memoryDrawExcerpt')`),'saved memory draw',15000);
      await capture('memory-result');
    }
    if(name==='bottles') {
      await js(`document.querySelector('#bottleNew').click()`);
      await until(()=>js(`!!document.querySelector('.bottleCompose')`),'full bottle composer');
      await capture('bottle-composer');
      await js(`document.querySelector('[data-bottle-close]').click()`);
      await until(()=>js(`!document.querySelector('dialog[open]')`),'close bottle composer');
    }
  }
  for(const tab of ['import','export','versions','backup','privacy']) {
    await js(`openProductDock(${JSON.stringify(tab)})`);
    await until(()=>js(`PRODUCT.tab===${JSON.stringify(tab)}&&document.querySelector('#productPanel')?.textContent.trim().length>0`),'product '+tab);
    await capture(tab);
  }
  await js(`setProductDock(false)`);
  // Walk the full tool catalogue. Readiness messages for optional AI/cloud
  // services are valid; renderer failures and missing handlers are not.
  const catalog = await js(`FEATURES.filter(f=>typeof RENDERERS[f.name]==='function'&&!['Other','Ask My Life'].includes(f.name)).map(f=>f.name)`);
  assert.ok(catalog.length>=140,'complete Windows tool catalogue is packaged');
  for(const feature of catalog) {
    await js(`openFeature(${JSON.stringify(feature)})`);
    await until(()=>js(`!document.querySelector('#view .loading')`),'render '+feature);
    const rendered=await js(`({feature:STATE.feature,content:document.querySelector('#view')?.textContent.trim()||''})`);
    assert.equal(rendered.feature,feature);
    assert.ok(rendered.content.length>0,feature+' renders content');
    assert.ok(!/ReferenceError:|TypeError:|SyntaxError:|Could not render this module/.test(rendered.content),feature+' does not display a renderer exception');
    tools.push(feature);
  }
  // Persisted user typography remains available, with identical font files.
  await js(`openProductDock('writer',{date:'2099-01-07'})`);
  await until(()=>js(`!!document.querySelector('#writerForm')`),'compact desk');
  window.setContentSize(900,650);
  await capture('writer-compact');
  await js(`(()=>{const f=document.querySelector('#v03FontSize');f.value='xlarge';f.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await capture('writer-large-type');
  await js(`(()=>{const f=document.querySelector('#v03FontSize');f.value='default';f.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  window.setContentSize(1024,684);
  await js(`(()=>{setProductDock(false);openFeature('Home')})()`);
  const report={ok:true,platform:process.platform,arch:process.arch,renderer_sha256:assetHash.digest('hex'),fonts,pages,tools};
  fs.writeFileSync(path.join(output,'DESKTOP_PARITY.json'),JSON.stringify(report,null,2)+'\n');
  return report;
};
