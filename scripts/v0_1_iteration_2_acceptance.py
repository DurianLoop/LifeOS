#!/usr/bin/env python3
"""Iteration 2 acceptance: safety invariants plus surface contracts.

It intentionally reuses the production corpus only for read-only checks.  Writer
revision tests run in a temporary root so this gate never adds a test journal to
the user's archive.
"""
from __future__ import annotations
from pathlib import Path
import hashlib, io, json, sqlite3, sys, tempfile, zipfile

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from engine import product_core as product

checks=[]
def check(name, ok, detail=''):
    checks.append({'name':name,'ok':bool(ok),'detail':str(detail)})
    print(('PASS' if ok else 'FAIL')+' · '+name+(f' · {detail}' if detail else ''))

# Source archive safety: the release corpus remains the Iteration 1 corpus.
manifest=json.loads((ROOT/'vault'/'manifest.json').read_text(encoding='utf-8'))
daily=list((ROOT/'vault'/'memories/daily').glob('*/*.md'))
weekly=list((ROOT/'vault'/'memories/weekly').glob('*/*.md'))
hash_errors=[]
for item in manifest.get('files',[]):
    p=ROOT/'vault'/item['vault_path']
    if not p.exists() or hashlib.sha256(p.read_bytes()).hexdigest()!=item['sha256']: hash_errors.append(item['vault_path'])
check('baseline vault remains present while allowing new personal pages',len(daily)>=518 and len(weekly)>=32,(len(daily),len(weekly)))
check('vault manifest hashes remain unchanged',not hash_errors,f'{len(hash_errors)} mismatch(es)')

entries_before=product.list_entries(5000,ROOT)
revision_before=product.core_status(ROOT)['revisions']
check('the original 550 source entries remain addressable',len(entries_before)>=550,len(entries_before))

# Defaults and migration are exercised in a disposable product core.
with tempfile.TemporaryDirectory(prefix='lifeos-i2-settings-') as td:
    sandbox=Path(td); (sandbox/'vault').mkdir(); (sandbox/'config').mkdir()
    defaults=product.settings_dict(sandbox)
    check('missing language setting defaults to poetic Chinese',defaults.get('ui.language_preset')=='poetic' and defaults.get('ui.locale')=='zh-CN' and defaults.get('ui.copy_mode')=='poetic',defaults)
    for old,locale,mode in [('bilingual','zh-CN','bilingual'),('en','en-US','clear'),('poetic','zh-CN','poetic')]:
        product.set_settings({'ui.language_preset':old,'ui.locale':locale,'ui.copy_mode':mode},sandbox)
        stored=product.settings_dict(sandbox)
        check(f'legacy {old} preference remains valid',stored.get('ui.language_preset')==old,stored.get('ui.language_preset'))

# Append-only writer remains true after the UI behavior changes.
with tempfile.TemporaryDirectory(prefix='lifeos-i2-writer-') as td:
    sandbox=Path(td); (sandbox/'vault').mkdir(); (sandbox/'config').mkdir()
    first=product.save_entry(journal_date='2026-08-29',sections={'日记':'第一笔'},title='fixture',root=sandbox,enqueue_sync=False)
    second=product.save_entry(journal_date='2026-08-29',sections={'日记':'第二笔'},entry_id=first['entry_id'],title='fixture',root=sandbox,enqueue_sync=False)
    restored=product.restore_revision(first['entry_id'],first['revision_id'],sandbox)
    revisions=product.list_revisions(first['entry_id'],sandbox)
    check('writer save stays append-only',len(revisions)==3 and second['revision_id']!=first['revision_id'],len(revisions))
    check('restore appends instead of overwriting',restored['revision_id'] not in {first['revision_id'],second['revision_id']},restored['revision_id'])
    portable=product.export_entries(export_format='markdown',entry_ids=[first['entry_id']],root=sandbox)
    portable_json=product.export_entries(export_format='json',entry_ids=[first['entry_id']],root=sandbox)
    portable_csv=product.export_entries(export_format='csv',entry_ids=[first['entry_id']],root=sandbox)
    zip_names=zipfile.ZipFile(io.BytesIO(portable['data'])).namelist()
    json_rows=json.loads(portable_json['data'])['entries']
    check('portable export produces Markdown, JSON and UTF-8 CSV from the current revision',portable['count']==1 and any(x.startswith('entries/') and x.endswith('.md') for x in zip_names) and len(json_rows)==1 and json_rows[0]['content'].find('第一笔')>=0 and portable_csv['data'].startswith(b'\xef\xbb\xbf'),{'zip':zip_names,'json_entries':len(json_rows),'csv_bytes':len(portable_csv['data'])})

# UI contracts are static enough to catch accidental removal of critical flows.
ui=(ROOT/'app'/'v012.js').read_text(encoding='utf-8')
css=(ROOT/'app'/'v012.css').read_text(encoding='utf-8')
required=['poetic:{locale:\'zh-CN\',copyMode:\'poetic\'}','bilingual:{locale:\'zh-CN\',copyMode:\'bilingual\'}','writerImmersive','writerRead','returnContext','lifeos.i2.search','searchFilterToggle','i2Journal','localStorage.removeItem(draftKey','document.documentElement.lang']
check('Iteration 2 UI contract contains Writer/Search/Journal/i18n hooks',all(x in ui for x in required),[x for x in required if x not in ui])
pet_root=ROOT/'app'/'assets'/'pets'/'desk-otter'
pet_files=('spritesheet.webp','pet.json','submission.json','LICENSE.md')
pet_ui=(ROOT/'app'/'v012-pet-rail.js').read_text(encoding='utf-8')
pet_float=(ROOT/'app'/'v012-pet-float.js').read_text(encoding='utf-8')
pet_api=(ROOT/'backend'/'server.py').read_text(encoding='utf-8')
pet_desktop=(ROOT/'desktop'/'pet.html').read_text(encoding='utf-8')
pet_preview_manifest=json.loads((ROOT/'app'/'assets'/'pet-readme-previews'/'manifest.json').read_text(encoding='utf-8'))
check('Desk Otter is locally packaged with MIT attribution',all((pet_root/name).exists() for name in pet_files) and 'Desk Otter attribution' in (pet_root/'LICENSE.md').read_text(encoding='utf-8'),[name for name in pet_files if not (pet_root/name).exists()])
check('peer-level Pets page supports local install, switch, action and removal flows',all(x in pet_ui for x in ("FEATURE='Pet Shelf'",'renderPetPage','/api/pets/install','/api/pets/activate','/api/pets/uninstall','data-pet-state','lifeos:open-pet')) and "label:c.nav.pet,feature:'Pet Shelf',pet:true" in (ROOT/'app'/'v01.js').read_text(encoding='utf-8') and all(x in pet_api for x in ("'/api/pets/catalog'","'/api/pets/install'","'/api/pets/activate'","'/api/pets/uninstall'","pet_license_allowed")),'pet page contracts')
check('pet library renders local animated action previews',all(x in pet_ui for x in ('preview_url','petPagePreview','petPageCatalog')) and 'PET_PREVIEW_ROOT' in pet_api and (ROOT/'app'/'assets'/'pet-readme-previews'/'firefly--lingxiaotian'/'idle.webp').exists(),'preview contracts')
check('web and desktop pets expose an unframed draggable sprite and a local usage guide',all(x in pet_float for x in ('lifePetFloat','pointerdown','lifeos.pet.float.position','refreshPet','lifePetFloatSprite')) and all(x not in pet_float for x in ('lifePetFloatHandle','lifePetFloatClose','lifePetFloatName')) and "'/api/pets/desktop'" in pet_api and 'activePet' in (ROOT/'desktop'/'main.cjs').read_text(encoding='utf-8') and 'bubble' not in (ROOT/'desktop'/'pet.html').read_text(encoding='utf-8') and (ROOT/'docs'/'PET_SHELF_README.md').exists(),'unframed draggable companion contracts')
check('dragging uses directional run frames before returning to idle',all(x in pet_float for x in ("setState('running-right')","dx<0?'running-left':'running-right'","setState(wasClick?'waving':'idle'")) and "running-right" in (ROOT/'desktop'/'pet.html').read_text(encoding='utf-8') and "running-left" in (ROOT/'desktop'/'pet.html').read_text(encoding='utf-8'),'drag action contracts')
check('pet chat sends only current turns through the local backend and opens from a concise right-click menu',all(x in pet_api for x in ('def pet_companion_chat','/api/pets/chat','The pet may only receive the current chat turns','use_cache=False')) and all(x in pet_float for x in ('lifePetChat','lifePetMenu','/api/pets/chat','lifeos:open-pet-chat','chatHistory.slice(-12)','contextmenu','anchorPanel')) and '回到右下' not in pet_float and all(x in pet_desktop for x in ('contextmenu',"ipcRenderer.send('lifeos:pet-menu')")) and 'lifeos:pet-menu' in (ROOT/'desktop'/'main.cjs').read_text(encoding='utf-8') and '回到右下' not in (ROOT/'desktop'/'main.cjs').read_text(encoding='utf-8') and 'onPetChat' in (ROOT/'desktop'/'preload.cjs').read_text(encoding='utf-8'),'pet chat privacy, menu and activation contracts')
check('pet playback skips transparent atlas slots and keeps the image cached',all(x in pet_api for x in ('def pet_frame_map','frame_map','getbbox')) and 'cells=pet?.frame_map?.[row]' in pet_float and 'loadedAsset' in pet_float and 'frameMap?.[row]' in (ROOT/'desktop'/'pet.html').read_text(encoding='utf-8'),'nonblank frame playback contracts')
check('window header merges identity, context and page actions without duplicate quick navigation',all(x in (ROOT/'app'/'index.html').read_text(encoding='utf-8') for x in ('lifeWindowPage','搜日记','class="page"')) and 'lifeWindowNav' not in (ROOT/'app'/'index.html').read_text(encoding='utf-8') and (ROOT/'app'/'index.html').read_text(encoding='utf-8').count('id="crumb"')==1 and (ROOT/'app'/'index.html').read_text(encoding='utf-8').count('id="memoryDockOpen"')==1,'single header contracts')
check('micro-adjustment belongs to the rail while the pet is a single lower-right action',all(x in (ROOT/'app'/'index.html').read_text(encoding='utf-8') for x in ('id="allRail"','class="round systemRound tweaksToggle"','toggle.onclick','class="dreamPet iconButton"','aria-label="和桌宠聊天"','.dreamDock{left:auto;right:18px;')) and 'dreamTune' not in (ROOT/'app'/'index.html').read_text(encoding='utf-8') and 'allRail.onclick=openPalette' not in (ROOT/'app'/'v01.js').read_text(encoding='utf-8'),'separate adjustment and companion entry contracts')
shell_ui=(ROOT/'app'/'lifeos-shell.css').read_text(encoding='utf-8')
check('desktop home starts near the header instead of leaving a blank stage','@media(min-width:881px){.homePage{padding-top:20px}.v01HomeHero{padding-top:12px}}' in shell_ui,'home first-screen density')
check('upstream README preview archive is complete for the current local mirror',len(pet_preview_manifest.get('items',[]))>=1000 and not pet_preview_manifest.get('failures') and all((ROOT/item['local_path']).exists() for item in pet_preview_manifest.get('items',[])),{'items':len(pet_preview_manifest.get('items',[])),'failures':len(pet_preview_manifest.get('failures',[]))})
check('writer layout has desktop and mobile reading rules','width:min(760px,100%)' in css and '@media(max-width:760px)' in css,'v012.css')
export_ui=(ROOT/'app'/'index.html').read_text(encoding='utf-8')
check('archive flow exposes Import → Write → Export plus a download endpoint',all(x in export_ui for x in ("data-producttab=\"export\"",'renderProductExport','下载导出文件','Markdown 压缩包')) and all(x in pet_api for x in ("'/api/export'",'export_entries','disposition=\'attachment\'')) and all(x in ui for x in ('writerImport','writerExport')),'export flow contracts')
check('writer desk cells are locally customizable without dropping hidden writing',all(x in ui for x in ('DESK_CELL_STORAGE','loadDeskCells','saveDeskCells','writerCellEditor','writerAddCell','writerCustomizeCells','writerSaveTemplate','preservedSections','data-cell-title-input','data-cell-size','data-cell-remove')),'custom desk cell contracts')
check('language switching offers poetic, bilingual and English without entry writes',all(x in ui for x in ('value="poetic"','value="bilingual"','value="en"')) and 'value="zh"' not in ui[ui.index('function updateLanguageControl'):ui.index('async function renderWriter')] and '/api/entries/save' not in ui[ui.index('function updateLanguageControl'):ui.index('async function renderWriter')], 'copy control only')
check('an empty journal page directly offers writing and importing',all(x in ui for x in ('journalStartI2','id="journalStartWrite"','id="journalStartImport"',"openProductDock('writer'", "openProductDock('import'")) and 'i2JournalStartActions' in css,'empty journal start contracts')
check('language check did not mutate production entry/revision counts',len(product.list_entries(5000,ROOT))==len(entries_before) and product.core_status(ROOT)['revisions']==revision_before,{'entries':len(product.list_entries(5000,ROOT)),'revisions':product.core_status(ROOT)['revisions']})

# Feature inventory remains immutable.
baseline=json.loads((ROOT/'config'/'features_141_baseline.json').read_text(encoding='utf-8'))
check('feature parity baseline remains 141',len(baseline)==141,len(baseline))

result={'schema':'lifeos-v0.1-iteration-2-acceptance-v1','passed':sum(x['ok'] for x in checks),'failed':sum(not x['ok'] for x in checks),'checks':checks}
out=ROOT/'docs'/'qa_v0_1_iteration_2';out.mkdir(parents=True,exist_ok=True)
(out/'acceptance.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
lines=['# LifeOS V0.1 · Iteration 2 Acceptance','',f"- Passed: **{result['passed']}**",f"- Failed: **{result['failed']}**",'']
lines += [f"- {'✅' if x['ok'] else '❌'} **{x['name']}** — {x['detail']}" for x in checks]
(out/'ACCEPTANCE.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
print(json.dumps({'passed':result['passed'],'failed':result['failed'],'report':str(out/'ACCEPTANCE.md')},ensure_ascii=False))
raise SystemExit(1 if result['failed'] else 0)
