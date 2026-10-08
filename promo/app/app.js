import * as store from './storage.js';
import { localDate, LIMITS } from './model.js';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const providers = { deepseek: { name: 'DeepSeek', model: 'deepseek-chat' }, openai: { name: 'OpenAI', model: 'gpt-4o-mini' }, qwen: { name: '通义千问', model: 'qwen-plus' } };
let entries = [], allEntries = [], draft = null, currentEntry = null;
let settings = { provider: 'deepseek', model: 'deepseek-chat' }, sessionKey = '';
let selected = new Set(), review = null, pendingRequest = null, pendingInstall = null;
let draftTimer, toastTimer, draftWriting = Promise.resolve(), writerVersion = 0, savedWriterVersion = 0;
let writerBase = {}, busySaving = false, storageReady = false, channel;

function text(selector, value) { $(selector).textContent = value; }
function el(tag, className, content) { const node = document.createElement(tag); if (className) node.className = className; if (content !== undefined) node.textContent = content; return node; }
function icon(name) { const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); const use = document.createElementNS(svg.namespaceURI, 'use'); use.setAttribute('href', `#i-${name}`); svg.append(use); svg.setAttribute('aria-hidden', 'true'); return svg; }
function notify(message) { clearTimeout(toastTimer); text('#toast', message); $('#toast').hidden = false; toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 4500); }
function errorMessage(error) { return error?.message || '操作未完成，请重试。'; }
function empty(title, description) { const block = el('div', 'empty'); block.append(icon('book'), el('h3', '', title), el('p', '', description)); return block; }
function displayDate(value) { const [year, month, day] = value.split('-'); return `${year} 年 ${Number(month)} 月 ${Number(day)} 日`; }
function excerpt(body, limit = 75) { const clean = body.replace(/^#{1,6}\s+/gm, '').replace(/\s+/g, ' ').trim(); return clean.length > limit ? `${clean.slice(0, limit)}…` : clean; }
function confirmAction(title, message, label = '确认') {
  return new Promise(resolve => {
    const dialog = $('#confirm-dialog'); text('#confirm-title', title); text('#confirm-copy', message); text('#confirm-yes', label);
    const finish = yes => { dialog.close(); $('#confirm-yes').onclick = null; $('#confirm-no').onclick = null; dialog.oncancel = null; resolve(yes); };
    $('#confirm-yes').onclick = () => finish(true); $('#confirm-no').onclick = () => finish(false);
    dialog.oncancel = event => { event.preventDefault(); finish(false); };
    dialog.showModal(); $('#confirm-no').focus();
  });
}
function broadcast() { channel?.postMessage('changed'); }
function connection() { const offline = !navigator.onLine; text('#connection', offline ? '离线 · 本机保存' : '本机保存'); $('#connection').classList.toggle('offline', offline); }
function renderCard(entry) {
  const button = el('button', 'entry-card'); button.type = 'button'; button.setAttribute('aria-label', `阅读 ${entry.date} ${entry.title || '无题'}`);
  const calendar = el('span', 'entry-calendar'); calendar.append(el('strong', '', String(Number(entry.date.slice(8)))), el('small', '', entry.date.slice(0, 7).replace('-', ' / ')));
  const content = el('span'); content.append(el('strong', 'entry-title', entry.title || '无题'), el('span', 'entry-excerpt', excerpt(entry.body)));
  button.append(calendar, content, icon('arrow')); button.onclick = () => openReader(entry.id).catch(error => notify(errorMessage(error))); return button;
}
function renderLists() {
  text('#entry-count', String(entries.length).padStart(2, '0'));
  $('#recent-list').replaceChildren(...(entries.length ? entries.slice(0, 4).map(renderCard) : [empty('第一篇，还在等你。', '记一件小事，也算认真过了今天。')]));
  const term = $('#archive-search').value.trim().toLocaleLowerCase(), month = $('#archive-month').value;
  const filtered = entries.filter(entry => (!month || entry.date.startsWith(month)) && (!term || `${entry.title}\n${entry.body}\n${entry.date}`.toLocaleLowerCase().includes(term)));
  text('#archive-count', `${filtered.length} 页日记${term || month ? ' · 当前筛选' : ' · 按日期排列'}`);
  $('#archive-list').replaceChildren(...(filtered.length ? filtered.map(renderCard) : [empty('这里暂时没有旧页。', term || month ? '试试其他关键词或日期。' : '从今天开始，把日常留在这里。')]));
  const draftHasContent = draft && (draft.title || draft.body);
  $('#resume-draft').classList.toggle('hidden', !draftHasContent);
  text('#draft-label', draftHasContent ? `${draft.date} · ${draft.title || '继续上次的草稿'}` : '继续上次的草稿');
  text('#write-today span', entries.some(entry => entry.date === localDate()) ? '继续写今天' : '写今天');
  text('#storage-summary', `${entries.length} 页日记`);
  renderEvidence(); renderTrash();
}
function renderEvidence() {
  selected = new Set([...selected].filter(id => entries.some(entry => entry.id === id)));
  const term = $('#evidence-search').value.trim().toLocaleLowerCase();
  const matches = entries.filter(entry => !term || `${entry.title}\n${entry.body}\n${entry.date}`.toLocaleLowerCase().includes(term));
  const rows = matches.map(entry => {
    const label = el('label', 'evidence-row'), checkbox = el('input'); checkbox.type = 'checkbox'; checkbox.checked = selected.has(entry.id); checkbox.setAttribute('aria-label', `参考 ${entry.date} ${entry.title || '无题'}`);
    checkbox.onchange = () => { if (checkbox.checked && selected.size >= 6) { checkbox.checked = false; notify('一次最多选择 6 页。'); return; } if (checkbox.checked) selected.add(entry.id); else selected.delete(entry.id); text('#evidence-count', `${selected.size} / 6 页`); };
    const content = el('span'); content.append(el('time', '', entry.date), el('strong', '', entry.title || '无题'), el('p', '', excerpt(entry.body, 65))); label.append(checkbox, content); return label;
  });
  $('#evidence-list').replaceChildren(...(rows.length ? rows : [empty('先带来一些记录。', entries.length ? '换个关键词，或清空筛选。' : '写下日记或导入旧记录后，即可选择。')]));
  text('#evidence-count', `${selected.size} / 6 页`);
  text('#ai-config-hint', sessionKey ? `已配置 ${providers[settings.provider].name} · ${settings.model}` : '还未配置 AI 服务，请先到「我的」填写自己的 API Key。');
}
function renderTrash() {
  const trash = allEntries.filter(entry => entry.deletedAt);
  $('#trash-list').replaceChildren(...(trash.length ? trash.map(entry => {
    const row = el('div', 'trash-row'), title = el('div'), button = el('button', 'text-link', '恢复');
    title.append(el('small', '', entry.date), el('strong', '', entry.title || '无题')); button.setAttribute('aria-label', `恢复 ${entry.date} ${entry.title || '无题'}`);
    button.onclick = async () => { button.disabled = true; try { await store.restoreEntry(entry.id, { expectedUpdatedAt: entry.updatedAt }); await refresh(); broadcast(); notify('这页日记已回到旧页。'); } catch (error) { notify(errorMessage(error)); button.disabled = false; } };
    row.append(title, button); return row;
  }) : [el('p', 'meta', '回收站是空的。移入的日记可在这里恢复，不会自动清除。')]));
}
async function refresh() { allEntries = await store.listEntries({ includeDeleted: true }); entries = allEntries.filter(entry => !entry.deletedAt); if (!$('#writer').open) draft = await store.getDraft(); renderLists(); }

function route() {
  const tab = location.hash.slice(1); const target = ['today', 'archive', 'ask', 'settings'].includes(tab) ? tab : 'today';
  $$('.view').forEach(view => { view.hidden = view.id !== `view-${target}`; });
  $$('.tabbar a').forEach(link => { if (link.dataset.tab === target) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current'); });
  document.title = `${{ today: '今天', archive: '旧页', ask: '问自己', settings: '我的' }[target]} · LifeOS`;
  window.scrollTo({ top: 0, behavior: 'auto' });
}
window.addEventListener('hashchange', route);

function writerSnapshot() { return { date: $('#entry-date').value, title: $('#entry-title').value, body: $('#entry-body').value, entryId: writerBase.entryId || null, baseUpdatedAt: writerBase.baseUpdatedAt || null }; }
function lockWriter(locked) { busySaving = locked; for (const selector of ['#entry-date', '#entry-title', '#entry-body', '#save-entry', '#close-writer', '#discard-draft']) $(selector).disabled = locked; }
function queueDraft() {
  clearTimeout(draftTimer); const snapshot = writerSnapshot(), version = writerVersion;
  // Both payload and version are captured before awaiting any earlier save.
  draftWriting = draftWriting.catch(() => {}).then(async () => {
    draft = await store.saveDraft({ ...snapshot, id: draft?.id }, { expectedUpdatedAt: draft?.updatedAt ?? null });
    savedWriterVersion = version;
    if (version === writerVersion) text('#draft-status', '草稿已保存在本机');
    return draft;
  });
  return draftWriting;
}
async function flushDraft() {
  clearTimeout(draftTimer);
  if (writerVersion !== savedWriterVersion) await queueDraft(); else await draftWriting;
}
function writerChanged() {
  writerVersion++; text('#draft-status', '正在保存草稿…'); text('#word-count', `${$('#entry-body').value.length.toLocaleString('zh-CN')} 字`); text('#writer-error', '');
  clearTimeout(draftTimer); draftTimer = setTimeout(() => queueDraft().catch(error => { text('#draft-status', '草稿尚未保存'); text('#writer-error', errorMessage(error)); }), 300);
}
async function openWriter(entry = null, resume = false) {
  if (!storageReady) return notify('本机存储尚未就绪，请查看页面顶部提示。');
  draft = await store.getDraft();
  if (draft && (draft.title || draft.body) && !resume) {
    if (draft.entryId !== entry?.id) notify('先继续这页未完的草稿；收笔或舍弃后，可写另一页。');
    resume = true;
  }
  const source = resume && draft ? draft : entry || { date: localDate(), title: '', body: '' };
  writerBase = resume && draft ? { entryId: draft.entryId, baseUpdatedAt: draft.baseUpdatedAt } : { entryId: entry?.id || null, baseUpdatedAt: entry?.updatedAt || null };
  if (!resume && draft && !draft.title && !draft.body) { await store.clearDraft({ expectedUpdatedAt: draft.updatedAt }); draft = null; }
  $('#entry-date').value = source.date; $('#entry-title').value = source.title; $('#entry-body').value = source.body;
  writerVersion = 0; savedWriterVersion = 0; draftWriting = Promise.resolve(); text('#writer-error', ''); text('#draft-status', resume ? '已恢复本机草稿' : '草稿自动保存在本机'); text('#word-count', `${source.body.length.toLocaleString('zh-CN')} 字`);
  $('#writer').showModal();
}
async function closeWriter() {
  if (busySaving) return;
  lockWriter(true);
  try { await flushDraft(); $('#writer').close(); await refresh(); broadcast(); } catch (error) { text('#writer-error', errorMessage(error)); text('#draft-status', '草稿尚未保存'); }
  finally { lockWriter(false); }
}
$('#writer').addEventListener('cancel', event => { event.preventDefault(); closeWriter(); });
$('#close-writer').onclick = closeWriter;
for (const field of ['#entry-date', '#entry-title', '#entry-body']) $(field).addEventListener('input', writerChanged);
$('#writer-form').onsubmit = async event => {
  event.preventDefault(); if (busySaving) return; lockWriter(true);
  try {
    await flushDraft(); const input = writerSnapshot();
    const saved = await store.saveEntry({ id: writerBase.entryId || undefined, date: input.date, title: input.title, body: input.body }, { expectedUpdatedAt: writerBase.baseUpdatedAt });
    // The diary transaction is already durable. A concurrent draft is never removed.
    writerBase = { entryId: saved.id, baseUpdatedAt: saved.updatedAt };
    let preservedDraft = false;
    if (draft) { try { await store.clearDraft({ expectedUpdatedAt: draft.updatedAt }); draft = null; } catch { preservedDraft = true; } }
    $('#writer').close(); await refresh(); broadcast(); notify(preservedDraft ? '日记已保存；另一个页面的草稿已保留。' : '这一页，已好好收下。');
  } catch (error) { text('#writer-error', errorMessage(error)); }
  finally { lockWriter(false); }
};
$('#discard-draft').onclick = async () => {
  if (busySaving || !await confirmAction('舍弃这次草稿？', '已保存的日记不受影响。这次未收笔的文字将从草稿中移除。', '舍弃草稿')) return;
  lockWriter(true); clearTimeout(draftTimer); try {
    await draftWriting.catch(() => {});
    if (draft) { try { await store.clearDraft({ expectedUpdatedAt: draft.updatedAt }); } catch (error) { if (error.code !== 'conflict') throw error; notify('已舍弃本页编辑，另一页面的草稿已保留。'); } }
    draft = null; writerVersion = savedWriterVersion = 0; $('#writer').close(); await refresh(); broadcast();
  } catch (error) { text('#writer-error', errorMessage(error)); }
  finally { lockWriter(false); }
};
$('#write-today').onclick = () => openWriter(entries.find(entry => entry.date === localDate())).catch(error => notify(errorMessage(error)));
$('#write-another').onclick = () => openWriter().catch(error => notify(errorMessage(error)));
$('#resume-draft').onclick = () => openWriter(null, true).catch(error => notify(errorMessage(error)));

async function openReader(id) {
  const entry = await store.getEntry(id); if (!entry || entry.deletedAt) { notify('这页已被移入回收站，或不在本机。'); await refresh(); return; }
  currentEntry = entry; text('#reader-date', displayDate(entry.date)); text('#reader-title', entry.title || '无题'); text('#reader-body', entry.body);
  const revisions = entry.revisions || []; $('#history-details').hidden = !revisions.length; $('#history-details').open = false;
  $('#history-list').replaceChildren(...[...revisions].reverse().map(revision => { const block = el('div', 'revision'); block.append(el('small', 'meta', `${revision.date} · ${new Date(revision.updatedAt).toLocaleString('zh-CN')}`), el('h3', '', revision.title || '无题'), el('pre', '', revision.body)); return block; }));
  if (!$('#reader').open) $('#reader').showModal();
}
$('#close-reader').onclick = () => $('#reader').close();
$('#edit-entry').onclick = async () => { $('#reader').close(); try { await openWriter(currentEntry); } catch (error) { notify(errorMessage(error)); } };
$('#delete-entry').onclick = async () => {
  if (!currentEntry || !await confirmAction('将这一页收进回收站？', '可以随时在「我的 → 回收站」恢复。', '移到回收站')) return;
  try { await store.softDelete(currentEntry.id, { expectedUpdatedAt: currentEntry.updatedAt }); $('#reader').close(); await refresh(); broadcast(); notify('已移到回收站，可以恢复。'); } catch (error) { notify(errorMessage(error)); }
};
$('#archive-search').oninput = renderLists; $('#archive-month').oninput = renderLists;
$('#clear-filter').onclick = () => { $('#archive-month').value = ''; $('#archive-search').value = ''; renderLists(); };
$('#evidence-search').oninput = renderEvidence;

$('#provider').onchange = () => { $('#model').value = providers[$('#provider').value].model; };
$('#ai-settings').onsubmit = async event => {
  event.preventDefault(); try {
    const model = $('#model').value.trim(); if (!/^[a-zA-Z0-9._:/-]{1,128}$/.test(model)) throw new Error('模型名称格式不正确。');
    const key = $('#api-key').value.trim(); if (key && !/^[\x21-\x7e]{8,512}$/.test(key)) throw new Error('请检查 API Key 格式。');
    settings = await store.saveSettings({ provider: $('#provider').value, model }); sessionKey = key; renderEvidence(); text('#settings-status', key ? '已应用。API Key 仅在本次打开期间使用。' : '服务与模型已保存，填写 API Key 后即可提问。');
  } catch (error) { text('#settings-status', errorMessage(error)); }
};
$('#clear-key').onclick = () => { sessionKey = ''; $('#api-key').value = ''; renderEvidence(); text('#settings-status', '已清除本次 API Key。'); };
$('#review-question').onclick = () => {
  if (!navigator.onLine) return notify('提问需要联网，离线时仍可写日记和翻阅旧页。');
  const question = $('#question').value.trim(); if (!question) { $('#question').focus(); return notify('先写下你想问的问题。'); }
  if (!selected.size) return notify('先选择至少一页日记作为依据。');
  if (!sessionKey) { location.hash = 'settings'; return notify('请先配置自己的 AI 服务与 API Key。'); }
  const evidence = [...selected].map(id => entries.find(entry => entry.id === id)).filter(Boolean).map(({ id, date, title, body }) => ({ id, date, title, body: body.slice(0, 1600) }));
  review = { provider: settings.provider, model: settings.model, question, evidence };
  text('#review-destination', `发送至 ${providers[review.provider].name} · ${review.model}，经本站转发。`); text('#review-question-text', question); text('#send-status', '');
  $('#review-evidence').replaceChildren(...evidence.map((entry, index) => { const block = el('div', 'review-evidence-item'), label = el('label', '', `[${index + 1}] ${entry.date} · ${entry.title || '无题'}`), area = el('textarea'); area.value = entry.body; area.maxLength = 10000; area.id = `excerpt-${index}`; label.htmlFor = area.id; block.append(label, area); return block; }));
  $('#send-review').showModal();
};
function closeReview() { if (pendingRequest) { notify('正在提问，可点击「停止等待」。'); return; } $('#send-review').close(); }
$('#close-review').onclick = closeReview; $('#send-review').addEventListener('cancel', event => { event.preventDefault(); closeReview(); });
$('#cancel-question').onclick = () => pendingRequest?.abort();
$('#send-question').onclick = async () => {
  if (pendingRequest || !review) return;
  const evidence = review.evidence.map((entry, index) => ({ ...entry, body: $(`#excerpt-${index}`).value }));
  if (evidence.some(entry => !entry.body.trim())) return text('#send-status', '每页摘录需要保留一些内容。');
  if (evidence.reduce((sum, entry) => sum + entry.body.length, 0) > 10000) return text('#send-status', '全部摘录最多 10,000 字，请缩短后重试。');
  const payload = { ...review, evidence };
  pendingRequest = new AbortController(); const timeout = setTimeout(() => pendingRequest?.abort(), 32000);
  $('#send-question').disabled = true; $('#cancel-question').classList.remove('hidden'); $$('#review-evidence textarea').forEach(area => { area.disabled = true; }); text('#send-status', '正在阅读这些旧页，请稍候…');
  try {
    const response = await fetch('/.netlify/functions/mobile-ask', { method: 'POST', cache: 'no-store', credentials: 'omit', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionKey}` }, body: JSON.stringify(payload), signal: pendingRequest.signal });
    let result; try { result = await response.json(); } catch { throw new Error('AI 服务暂未返回有效内容，请稍后重试。'); }
    if (!response.ok) throw new Error(result.error?.message || 'AI 请求未完成，请检查模型配置。');
    if (typeof result.answer !== 'string' || !result.answer.trim()) throw new Error('AI 未返回有效回答。');
    text('#answer-question', payload.question); text('#answer-text', result.answer);
    $('#answer-sources').replaceChildren(...payload.evidence.map((entry, index) => { const button = el('button', '', `[${index + 1}] ${entry.date} · ${entry.title || '无题'}`); button.onclick = () => openReader(entry.id).catch(error => notify(errorMessage(error))); return button; }));
    $('#answer-panel').hidden = false; $('#send-review').close(); $('#answer-panel').scrollIntoView({ behavior: 'auto', block: 'start' });
  } catch (error) { text('#send-status', error.name === 'AbortError' ? '已停止等待，日记未改动。已发送的请求可能仍由服务商处理。' : errorMessage(error)); }
  finally { clearTimeout(timeout); pendingRequest = null; $('#send-question').disabled = false; $('#cancel-question').classList.add('hidden'); $$('#review-evidence textarea').forEach(area => { area.disabled = false; }); }
};

$('#export-backup').onclick = async () => {
  try {
    const backup = await store.exportBackup(); const file = new File([JSON.stringify(backup, null, 2)], `LifeOS-${localDate()}.json`, { type: 'application/json' });
    const apple = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (apple && navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: 'LifeOS 日记备份' }); notify('备份已交给系统分享，请保存到「文件」。'); }
    else { const url = URL.createObjectURL(file), a = el('a'); a.href = url; a.download = file.name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000); notify('已生成备份，请确认文件已保存。'); }
  } catch (error) { if (error.name !== 'AbortError') notify(errorMessage(error)); }
};
$('#import-backup').onclick = () => $('#import-file').click();
$('#import-file').onchange = async event => {
  const file = event.target.files[0]; if (!file) return;
  $('#import-backup').disabled = true;
  try {
    if (file.size > LIMITS.bytes) throw new Error('一次最多导入 10 MB 的 JSON 文件。');
    let data; try { data = JSON.parse(await file.text()); } catch { throw new Error('文件不是有效 JSON，请使用 LifeOS 导出的日记文件。'); }
    const result = await store.importBackup(data); await refresh(); broadcast();
    text('#import-result', `已导入 ${result.imported} 页，跳过 ${result.skipped} 页。${result.draftImported ? '草稿也已恢复。' : ''}${result.draftDetached ? '草稿对应的原页已变化，已保留为独立草稿，请核对日期后保存。' : ''}${result.conflicts.length ? `其中 ${result.conflicts.length} 页存在冲突，未覆盖本机记录。请保留原文件核对：${result.conflicts.slice(0, 20).map(entry => entry.date).join('、')}${result.conflicts.length > 20 ? ' 等' : ''}。` : ''}`);
  } catch (error) { text('#import-result', errorMessage(error)); }
  finally { event.target.value = ''; $('#import-backup').disabled = false; }
};
$('#persist-storage').onclick = async () => {
  try { const granted = await navigator.storage?.persist?.(); text('#persist-result', granted ? '浏览器已允许持久保存。主动清理网站数据仍会删除记录，请继续定期备份。' : '当前浏览器未授予持久存储，日记仍可正常保存。请定期导出备份。'); }
  catch { text('#persist-result', '此浏览器暂不支持申请，请定期导出备份。'); }
};
$('#show-install').onclick = () => { location.hash = 'settings'; };
window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); pendingInstall = event; $('#native-install').classList.remove('hidden'); });
$('#native-install').onclick = async () => { if (pendingInstall) { await pendingInstall.prompt(); pendingInstall = null; $('#native-install').classList.add('hidden'); } };
function installationState() { const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; $('#install-nudge').hidden = standalone; text('#install-state', standalone ? '你正在主屏幕应用中使用 LifeOS。' : '当前在浏览器中。添加主屏幕后可独立打开。'); }
async function enableOffline() {
  if (!('serviceWorker' in navigator)) { text('#offline-ready', '此浏览器暂不支持离线打开，请联网使用并定期备份。'); return; }
  try {
    const registration = await navigator.serviceWorker.register('./sw.js', { scope: './', updateViaCache: 'none' });
    await navigator.serviceWorker.ready; text('#offline-ready', '离线已就绪，文字只保存在这台设备。');
    const reportUpdate = () => { if (registration.waiting) notify('新版本已就绪。收笔后关闭所有 LifeOS 窗口，再打开即可更新。'); };
    reportUpdate(); registration.addEventListener('updatefound', () => { registration.installing?.addEventListener('statechange', reportUpdate); });
  } catch { text('#offline-ready', '文字可保存在本机，离线页面暂未准备好，请联网重试。'); }
}
window.addEventListener('online', connection); window.addEventListener('offline', connection);
document.addEventListener('visibilitychange', () => { if (document.hidden && $('#writer').open) flushDraft().catch(() => {}); });
window.addEventListener('beforeunload', event => { if ($('#writer').open && writerVersion !== savedWriterVersion) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('pageshow', () => { connection(); installationState(); if (storageReady && !$('#writer').open) refresh().catch(error => notify(errorMessage(error))); });

async function start() {
  text('#today-date', new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }));
  connection(); installationState(); route();
  try {
    await store.openStore(); storageReady = true; settings = { ...settings, ...await store.getSettings() }; $('#provider').value = settings.provider; $('#model').value = settings.model; await refresh();
    if ('BroadcastChannel' in window) { channel = new BroadcastChannel('lifeos-mobile-changes'); channel.onmessage = () => { if (!$('#writer').open) refresh().catch(error => notify(errorMessage(error))); }; }
  } catch (error) { $('#storage-error').classList.remove('hidden'); text('#storage-error', errorMessage(error)); }
  enableOffline();
}
start();
