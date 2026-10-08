import { LifeOSError, validateId, validateEntryInput, prepareRecord, validateDraft, nextTimestamp, sanitizeSettings, normalizeImport, planImport, resolveImportedDraft, makeBackup } from './model.js';

const DATABASE = 'lifeos-mobile';
const VERSION = 1;
let databasePromise;
let writeQueue = Promise.resolve();

function explain(error) {
  if (error instanceof LifeOSError) return error;
  if (error?.name === 'QuotaExceededError') return new LifeOSError('设备储存空间不足，保存失败。请先导出已有日记，并释放空间后重试。', 'quota');
  if (['SecurityError', 'InvalidStateError', 'NotAllowedError'].includes(error?.name)) return new LifeOSError('浏览器暂时无法使用本地储存。请用 Safari 普通浏览模式打开，日记尚未保存。', 'unavailable');
  if (error?.name === 'VersionError') return new LifeOSError('本地数据由较新版本创建，请关闭旧页面并重新打开。', 'version');
  return new LifeOSError('本地储存操作未完成，请保留当前文字并重试。', 'storage');
}

export async function openStore() {
  if (!databasePromise) {
    databasePromise = new Promise((resolve, reject) => {
      if (!globalThis.indexedDB) { reject(new LifeOSError('此浏览器不支持离线日记储存，请使用最新版 Safari 或 Chrome。', 'unavailable')); return; }
      let request, abandoned = false;
      try { request = indexedDB.open(DATABASE, VERSION); } catch (error) { reject(explain(error)); return; }
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('entries')) {
          const store = db.createObjectStore('entries', { keyPath: 'id' });
          store.createIndex('date', 'date', { unique: false });
        }
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
      };
      request.onerror = () => reject(explain(request.error));
      request.onblocked = () => { abandoned = true; reject(new LifeOSError('另一个 LifeOS 页面正在使用本地储存，请关闭它后重试。', 'blocked')); };
      request.onsuccess = () => {
        const db = request.result;
        if (abandoned) { db.close(); return; }
        db.onversionchange = () => { db.close(); databasePromise = undefined; };
        db.onclose = () => { databasePromise = undefined; };
        resolve(db);
      };
    }).catch(error => { databasePromise = undefined; throw explain(error); });
  }
  return databasePromise;
}

// Queue writes by invocation order, including draft saves and clears. A successful
// IDB request is not enough: only transaction completion acknowledges a save.
function write(operation) {
  const result = writeQueue.then(operation);
  writeQueue = result.catch(() => {});
  return result;
}

async function transaction(stores, mode, operation) {
  const db = await openStore();
  return new Promise((resolve, reject) => {
    let tx, result, failure;
    try { tx = db.transaction(stores, mode); } catch (error) { reject(explain(error)); return; }
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(explain(failure || tx.error));
    tx.onerror = () => { failure ||= tx.error; };
    const fail = error => { failure = error; try { tx.abort(); } catch { reject(explain(error)); } };
    const request = (idbRequest, callback) => {
      idbRequest.onerror = () => { failure ||= idbRequest.error; };
      idbRequest.onsuccess = () => { try { callback(idbRequest.result); } catch (error) { fail(error); } };
    };
    try { operation(tx, request, value => { result = value; }); } catch (error) { fail(error); }
  });
}

function checkVersion(record, expectedUpdatedAt) {
  if (expectedUpdatedAt !== undefined && (record?.updatedAt ?? null) !== expectedUpdatedAt) {
    throw new LifeOSError('这篇内容已在另一个页面修改。请先保留当前文字，再重新打开最新版本。', 'conflict');
  }
}

function checkDate(records, date, id) {
  if (records.some(entry => !entry.deletedAt && entry.date === date && entry.id !== id)) {
    throw new LifeOSError(`${date} 已有一篇日记，请打开当天日记继续写，或选择其他日期。`, 'date-conflict');
  }
}

export async function listEntries({ includeDeleted = false } = {}) {
  await writeQueue;
  return transaction(['entries'], 'readonly', (tx, request, done) => {
    request(tx.objectStore('entries').getAll(), records => done(records.filter(entry => includeDeleted || !entry.deletedAt).sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt.localeCompare(a.updatedAt))));
  });
}

export async function getEntry(id) {
  id = validateId(id);
  await writeQueue;
  return transaction(['entries'], 'readonly', (tx, request, done) => request(tx.objectStore('entries').get(id), value => done(value || null)));
}

export function saveEntry(input, { expectedUpdatedAt } = {}) {
  return write(() => {
    const fields = validateEntryInput(input);
    return transaction(['entries'], 'readwrite', (tx, request, done) => {
      const store = tx.objectStore('entries');
      request(store.getAll(), records => {
        const previous = fields.id ? records.find(entry => entry.id === fields.id) : null;
        if (fields.id && !previous) throw new LifeOSError('未找到这篇日记，请重新打开后再试。', 'missing');
        checkVersion(previous, expectedUpdatedAt);
        checkDate(records, fields.date, fields.id);
        const entry = prepareRecord(fields, previous);
        store.put(entry);
        done(entry);
      });
    });
  });
}

function changeDeleted(id, deleted, { expectedUpdatedAt } = {}) {
  return write(() => {
    id = validateId(id);
    return transaction(['entries'], 'readwrite', (tx, request, done) => {
      const store = tx.objectStore('entries');
      request(store.getAll(), records => {
        const entry = records.find(record => record.id === id);
        if (!entry) throw new LifeOSError('未找到这篇日记。', 'missing');
        checkVersion(entry, expectedUpdatedAt);
        if (Boolean(entry.deletedAt) === deleted) { done(entry); return; }
        if (!deleted) checkDate(records, entry.date, entry.id);
        const updatedAt = nextTimestamp(entry.updatedAt);
        const changed = { ...entry, updatedAt, deletedAt: deleted ? updatedAt : null };
        store.put(changed);
        done(changed);
      });
    });
  });
}

export function softDelete(id, options) { return changeDeleted(id, true, options); }
export function restoreEntry(id, options) { return changeDeleted(id, false, options); }

export function saveDraft(input, { expectedUpdatedAt } = {}) {
  return write(() => {
    const draft = validateDraft(input);
    return transaction(['meta'], 'readwrite', (tx, request, done) => {
      const store = tx.objectStore('meta');
      request(store.get('draft'), record => {
        checkVersion(record?.value, expectedUpdatedAt);
        draft.updatedAt = nextTimestamp(record?.value?.updatedAt);
        store.put({ key: 'draft', value: draft });
        done(draft);
      });
    });
  });
}

export async function getDraft() {
  await writeQueue;
  return transaction(['meta'], 'readonly', (tx, request, done) => request(tx.objectStore('meta').get('draft'), record => done(record?.value || null)));
}

export function clearDraft({ expectedUpdatedAt } = {}) {
  return write(() => transaction(['meta'], 'readwrite', (tx, request, done) => {
    const store = tx.objectStore('meta');
    request(store.get('draft'), record => { checkVersion(record?.value, expectedUpdatedAt); store.delete('draft'); done(); });
  }));
}

export async function getSettings() {
  await writeQueue;
  return transaction(['meta'], 'readonly', (tx, request, done) => request(tx.objectStore('meta').get('settings'), record => done(sanitizeSettings(record?.value || {}))));
}

export function saveSettings(input) {
  return write(() => {
    const settings = sanitizeSettings(input);
    return transaction(['meta'], 'readwrite', (tx, request, done) => {
      const store = tx.objectStore('meta');
      request(store.get('settings'), record => {
        const value = { ...sanitizeSettings(record?.value || {}), ...settings };
        store.put({ key: 'settings', value });
        done(value);
      });
    });
  });
}

export async function exportBackup() {
  await writeQueue;
  return transaction(['entries', 'meta'], 'readonly', (tx, request, done) => {
    let entries, draft, complete = 0;
    const finish = () => { if (++complete === 2) done(makeBackup(entries, draft)); };
    request(tx.objectStore('entries').getAll(), records => { entries = records; finish(); });
    request(tx.objectStore('meta').get('draft'), record => { draft = record?.value || null; finish(); });
  });
}

export function importBackup(data) {
  return write(() => {
    const incoming = normalizeImport(data);
    return transaction(['entries', 'meta'], 'readwrite', (tx, request, done) => {
      const entries = tx.objectStore('entries'), meta = tx.objectStore('meta');
      request(entries.getAll(), existing => {
        const plan = planImport(incoming.entries, existing);
        for (const entry of plan.additions) entries.add(entry);
        request(meta.get('draft'), record => {
          const draftImported = Boolean(incoming.draft && !record?.value);
          const importedDraft = draftImported ? resolveImportedDraft(incoming.draft, [...existing, ...plan.additions]) : null;
          if (draftImported) meta.put({ key: 'draft', value: importedDraft });
          done({ imported: plan.imported, skipped: plan.skipped, conflicts: plan.conflicts, draftImported, draftDetached: Boolean(draftImported && incoming.draft.entryId && !importedDraft.entryId) });
        });
      });
    });
  });
}
