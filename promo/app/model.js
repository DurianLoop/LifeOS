// Data rules shared by the offline store and its tests. Diary text stays text.
export const LIMITS = Object.freeze({ title: 200, body: 50000, records: 5000, bytes: 10 * 1024 * 1024, revisions: 20 });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export class LifeOSError extends Error {
  constructor(message, code = 'validation') { super(message); this.name = 'LifeOSError'; this.code = code; }
}

export function localDate(date = new Date()) {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) throw new LifeOSError('日期无效。');
  return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function validateDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new LifeOSError('请选择有效日期（年-月-日）。');
  const [year, month, day] = value.split('-').map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1]) throw new LifeOSError('日期不存在，请重新选择。');
  return value;
}

function text(value, field, maximum, empty = true) {
  if (typeof value !== 'string') throw new LifeOSError(`${field}必须是文字。`);
  if (value.length > maximum) throw new LifeOSError(`${field}最多 ${maximum.toLocaleString('zh-CN')} 个字符。`);
  if (!empty && !value.trim()) throw new LifeOSError('写下一点内容，再保存这篇日记。', 'empty');
  return value;
}

export function createId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  if (!globalThis.crypto?.getRandomValues) throw new LifeOSError('当前浏览器无法安全创建日记，请使用最新版 Safari 或 Chrome。', 'unavailable');
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function validateId(value) {
  if (typeof value !== 'string' || !UUID.test(value)) throw new LifeOSError('日记标识无效，请重新打开日记。');
  return value.toLowerCase();
}

function timestamp(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new LifeOSError('备份中的保存时间无效，未导入任何内容。');
  }
  return new Date(value).toISOString();
}

export function nextTimestamp(previous, now = new Date().toISOString()) {
  return new Date(Math.max(Date.parse(now), previous ? Date.parse(previous) + 1 : 0)).toISOString();
}

export function validateEntryInput(input, { allowEmpty = false } = {}) {
  if (!object(input)) throw new LifeOSError('日记内容格式不正确。');
  const result = {
    date: validateDate(input.date),
    title: text(input.title ?? '', '标题', LIMITS.title),
    body: text(input.body, '正文', LIMITS.body, allowEmpty),
  };
  if (input.id !== undefined && input.id !== null && input.id !== '') result.id = validateId(input.id);
  return result;
}

export function prepareRecord(input, previous = null, now = new Date().toISOString()) {
  const fields = validateEntryInput(input);
  if (previous?.deletedAt) throw new LifeOSError('这篇日记已在回收站，请先恢复再编辑。', 'deleted');
  if (previous && fields.id && fields.id !== previous.id) throw new LifeOSError('日记标识不一致。');
  const changed = previous && ['date', 'title', 'body'].some(key => previous[key] !== fields[key]);
  const revisions = previous?.revisions ? [...previous.revisions] : [];
  if (changed) revisions.push({ date: previous.date, title: previous.title, body: previous.body, updatedAt: previous.updatedAt });
  return {
    id: previous?.id || fields.id || createId(), date: fields.date, title: fields.title, body: fields.body,
    createdAt: previous?.createdAt || now, updatedAt: nextTimestamp(previous?.updatedAt, now), deletedAt: null,
    revisions: revisions.slice(-LIMITS.revisions),
  };
}

export function validateDraft(input, now = new Date().toISOString()) {
  const fields = validateEntryInput(input, { allowEmpty: true });
  return {
    ...fields, id: fields.id || createId(),
    entryId: input.entryId ? validateId(input.entryId) : null,
    baseUpdatedAt: timestamp(input.baseUpdatedAt, null),
    updatedAt: timestamp(input.updatedAt, now),
  };
}

export function sanitizeSettings(value = {}) {
  if (!object(value)) throw new LifeOSError('设置格式不正确。');
  const result = {};
  if (value.provider !== undefined) {
    if (!['deepseek', 'openai', 'qwen'].includes(value.provider)) throw new LifeOSError('请选择支持的 AI 服务。');
    result.provider = value.provider;
  }
  if (value.model !== undefined) result.model = text(value.model, '模型名称', 128);
  return result;
}

function normalizePortableEntry(raw, { own, deleted, now }) {
  if (!object(raw)) throw new LifeOSError('备份中存在格式不正确的日记，未导入任何内容。');
  if (raw.kind && raw.kind !== 'daily') throw new LifeOSError('这份文件含有周记或其他记录。请在桌面版仅选择日记导出后重试，未导入任何内容。', 'unsupported');
  const fields = validateEntryInput({ date: raw.journal_date ?? raw.date, title: raw.title ?? '', body: raw.text ?? raw.content ?? raw.body ?? raw.journal });
  const sourceId = raw.entry_id ?? raw.id;
  const id = typeof sourceId === 'string' && UUID.test(sourceId) ? sourceId.toLowerCase() : createId();
  const createdAt = timestamp(raw.created_at ?? raw.createdAt, now);
  const updatedAt = timestamp(raw.updated_at ?? raw.updatedAt, createdAt);
  const deletedAt = timestamp(raw.deleted_at ?? raw.deletedAt, deleted ? now : null);
  if (!own && deletedAt) throw new LifeOSError('桌面导出中含有已删除记录。请仅导出正常日记后重试。');
  if (own && !deleted && deletedAt) throw new LifeOSError('备份中的回收站结构不正确，未导入任何内容。');
  let revisions = [];
  if (own && raw.revisions !== undefined) {
    if (!Array.isArray(raw.revisions) || raw.revisions.length > LIMITS.revisions) throw new LifeOSError('备份中的编辑历史无效。');
    revisions = raw.revisions.map(revision => {
      const old = validateEntryInput(revision);
      return { date: old.date, title: old.title, body: old.body, updatedAt: timestamp(revision.updatedAt ?? revision.updated_at, createdAt) };
    });
  }
  return { id, ...fields, createdAt, updatedAt, deletedAt, revisions };
}

export function normalizeImport(data, now = new Date().toISOString()) {
  let serialized;
  try { serialized = JSON.stringify(data); } catch { throw new LifeOSError('备份不是有效的 JSON 文件。'); }
  if (!serialized || new TextEncoder().encode(serialized).length > LIMITS.bytes) throw new LifeOSError('备份文件不能超过 10 MB。');
  if (!Array.isArray(data) && !object(data)) throw new LifeOSError('请选择 LifeOS 日记 JSON 备份。');
  const own = data.format === 'lifeos-mobile';
  if (own && data.version !== 1) throw new LifeOSError('此备份版本暂不支持，请保留原文件。', 'unsupported');
  if (data.format && !['lifeos-mobile', 'lifeos-portable-export-v1'].includes(data.format)) throw new LifeOSError('无法识别此备份格式。', 'unsupported');
  const active = Array.isArray(data) ? data : data.entries;
  const trash = own ? (data.trash ?? []) : [];
  if (!Array.isArray(active) || !Array.isArray(trash)) throw new LifeOSError('备份中缺少日记列表。');
  if (active.length + trash.length > LIMITS.records) throw new LifeOSError('一次最多导入 5,000 篇日记，请分批导出后导入。');
  // Validate the entire file before opening a write transaction.
  const entries = [
    ...active.map(raw => normalizePortableEntry(raw, { own, deleted: false, now })),
    ...trash.map(raw => normalizePortableEntry(raw, { own, deleted: true, now })),
  ];
  const draft = own && data.draft ? validateDraft(data.draft, now) : null;
  return { entries, draft };
}

export function planImport(incoming, existing = []) {
  const byId = new Map(existing.map(entry => [entry.id, entry]));
  const byDate = new Map(existing.filter(entry => !entry.deletedAt).map(entry => [entry.date, entry]));
  const trash = existing.filter(entry => entry.deletedAt);
  const additions = [], conflicts = [];
  let skipped = 0;
  for (const entry of incoming) {
    const sameId = byId.get(entry.id);
    const sameDate = !entry.deletedAt && byDate.get(entry.date);
    const match = sameId || sameDate;
    if (match) {
      skipped += 1;
      const identical = match.date === entry.date && match.title === entry.title && match.body === entry.body && Boolean(match.deletedAt) === Boolean(entry.deletedAt);
      if (!identical) conflicts.push({ date: entry.date, title: entry.title, reason: sameId ? '同一日记已有不同内容' : '这一天已有不同内容的日记' });
      continue;
    }
    if (entry.deletedAt && trash.some(old => old.date === entry.date && old.title === entry.title && old.body === entry.body)) { skipped += 1; continue; }
    additions.push(entry);
    byId.set(entry.id, entry);
    if (entry.deletedAt) trash.push(entry); else byDate.set(entry.date, entry);
  }
  return { additions, imported: additions.length, skipped, conflicts };
}

export function resolveImportedDraft(draft, records) {
  if (!draft?.entryId) return draft;
  const original = records.find(entry => entry.id === draft.entryId);
  if (original && !original.deletedAt && original.updatedAt === draft.baseUpdatedAt) return draft;
  // A skipped, removed or subsequently edited source cannot safely be updated.
  // Keep every character, but make this a new draft that can choose another date.
  return { ...draft, entryId: null, baseUpdatedAt: null };
}

export function makeBackup(entries, draft = null, now = new Date().toISOString()) {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  const portable = entry => ({
    entry_id: entry.id, kind: 'daily', journal_date: entry.date, timezone, title: entry.title, tags: [],
    content: entry.body, created_at: entry.createdAt, updated_at: entry.updatedAt,
    deleted_at: entry.deletedAt, source_path: `journal/${entry.date}.md`, source_format: 'markdown',
    revisions: entry.revisions || [],
  });
  const active = entries.filter(entry => !entry.deletedAt);
  return {
    format: 'lifeos-mobile', version: 1,
    manifest: { format: 'lifeos-portable-export-v1', created_at: now, entry_count: active.length, attachments_included: false },
    entries: active.map(portable), trash: entries.filter(entry => entry.deletedAt).map(portable), draft,
  };
}
