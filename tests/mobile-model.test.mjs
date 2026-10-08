import test from 'node:test';
import assert from 'node:assert/strict';
import { LIMITS, localDate, validateDate, validateEntryInput, prepareRecord, validateDraft, sanitizeSettings, normalizeImport, planImport, resolveImportedDraft, makeBackup } from '../promo/app/model.js';

const stamp = '2026-10-08T05:00:00.000Z';
const id = 'ed861fc5-cb64-4dc9-a613-d92d2904f4d1';
const otherId = '74a0fcce-7294-4a25-8bfb-aee2f9106d30';
const entry = (changes = {}) => ({ id, date: '2026-10-08', title: '秋天', body: '今天把一天留了下来。', createdAt: stamp, updatedAt: stamp, deletedAt: null, revisions: [], ...changes });

test('dates reject impossible days and accept real leap days', () => {
  for (const value of ['2026-02-29', '2024-02-30', '1900-02-29', '2026-04-31', '2026-00-10', '2026-13-01', '0000-01-01', '2026-1-01', '2026-10-08T12:00:00Z']) {
    assert.throws(() => validateDate(value));
  }
  assert.equal(validateDate('2000-02-29'), '2000-02-29');
  assert.equal(validateDate('2024-02-29'), '2024-02-29');
});

test('local date uses the device calendar instead of the UTC day', () => {
  assert.equal(localDate(new Date(2026, 9, 8, 23, 30)), '2026-10-08');
  const original = process.env.TZ;
  try {
    for (const [timezone, expected] of [['Asia/Shanghai', '2026-10-09'], ['America/Los_Angeles', '2026-10-08']]) {
      process.env.TZ = timezone;
      assert.equal(localDate(new Date('2026-10-08T23:30:00Z')), expected);
    }
  } finally { if (original === undefined) delete process.env.TZ; else process.env.TZ = original; }
});

test('HTML and Markdown remain literal text; empty and oversized saves fail', () => {
  const body = '<img src=x onerror=alert(1)>\n# 标题\n**保留 Markdown**';
  assert.equal(validateEntryInput({ date: '2026-10-08', title: '', body }).body, body);
  assert.throws(() => validateEntryInput({ date: '2026-10-08', body: ' \n\t' }), { code: 'empty' });
  assert.throws(() => validateEntryInput({ date: '2026-10-08', body: 12 }));
  assert.throws(() => validateEntryInput({ date: '2026-10-08', body: 'a'.repeat(LIMITS.body + 1) }));
  assert.throws(() => validateEntryInput({ date: '2026-10-08', title: 'a'.repeat(201), body: '写了' }));
});

test('record edits preserve identity, creation time and last twenty full revisions', () => {
  let record = entry();
  for (let index = 1; index <= 25; index++) record = prepareRecord({ id, date: record.date, title: record.title, body: `编辑 ${index}` }, record, stamp);
  assert.equal(record.id, id);
  assert.equal(record.createdAt, stamp);
  assert.equal(record.revisions.length, 20);
  assert.equal(record.revisions[0].body, '编辑 5');
  assert.equal(record.revisions.at(-1).body, '编辑 24');
  assert.ok(record.updatedAt > stamp, 'same-millisecond saves must still have different concurrency tokens');
  const unchanged = prepareRecord(record, record, stamp);
  assert.equal(unchanged.revisions.length, 20);
  assert.throws(() => prepareRecord(record, { ...record, deletedAt: stamp }), { code: 'deleted' });
});

test('draft permits incomplete writing and carries the original entry version', () => {
  const draft = validateDraft({ date: '2026-10-08', title: '想到一半', body: '', entryId: id, baseUpdatedAt: stamp }, stamp);
  assert.equal(draft.body, '');
  assert.equal(draft.entryId, id);
  assert.equal(draft.baseUpdatedAt, stamp);
  assert.match(draft.id, /^[a-f0-9-]{36}$/);
  assert.throws(() => validateDraft({ date: '2026-10-08', body: '', entryId: '<script>' }));
});

test('settings never persist credentials or custom endpoints', () => {
  assert.deepEqual(sanitizeSettings({ provider: 'deepseek', model: 'deepseek-chat', apiKey: 'secret', token: 'secret', baseUrl: 'https://evil.test' }), { provider: 'deepseek', model: 'deepseek-chat' });
  assert.throws(() => sanitizeSettings({ provider: 'unknown' }));
});

test('desktop JSON imports journal_date/content and respects text precedence', () => {
  const data = { manifest: { format: 'lifeos-portable-export-v1' }, entries: [{ entry_id: 'desktop-legacy-id', kind: 'daily', journal_date: '2026-10-08', title: '桌面', content: '---\ntitle: 测试\n---\n\n保留完整 Markdown', created_at: stamp }] };
  const normalized = normalizeImport(data, stamp);
  assert.equal(normalized.entries[0].body, data.entries[0].content);
  assert.equal(normalized.entries[0].date, '2026-10-08');
  assert.match(normalized.entries[0].id, /^[a-f0-9-]{36}$/);
  assert.equal(normalizeImport({ entries: [{ date: '2026-10-08', text: 'first', content: 'second', body: 'third' }] }, stamp).entries[0].body, 'first');
});

test('own backup round trips active entries, trash, history, and an unfinished draft', () => {
  const active = prepareRecord({ id, date: '2026-10-08', title: '改过', body: '今天的第二段' }, entry(), stamp);
  const removed = entry({ id: otherId, date: '2026-10-07', deletedAt: stamp });
  const draft = validateDraft({ date: '2026-10-09', title: '', body: '没有写完' }, stamp);
  const backup = makeBackup([active, removed], draft, stamp);
  assert.equal(backup.manifest.format, 'lifeos-portable-export-v1');
  assert.equal(backup.entries.length, 1);
  assert.equal(backup.trash.length, 1);
  assert.equal(backup.entries[0].kind, 'daily');
  assert.deepEqual(normalizeImport(backup, stamp), { entries: [active, removed], draft });
});

test('import prevalidation rejects an invalid later record and all unsupported weekly content', () => {
  assert.throws(() => normalizeImport({ entries: [{ date: '2026-10-08', body: '有效' }, { date: '2026-02-30', body: '无效' }] }));
  assert.throws(() => normalizeImport({ entries: [{ date: '2026-10-08', body: '有效' }, { kind: 'weekly', body: '一周' }] }), { code: 'unsupported' });
  assert.throws(() => normalizeImport({ format: 'lifeos-mobile', version: 2, entries: [] }), { code: 'unsupported' });
  assert.throws(() => normalizeImport({ entries: Array.from({ length: 5001 }, () => ({ date: '2026-10-08', body: 'a' })) }));
  assert.throws(() => normalizeImport({ entries: [], oversized: 'a'.repeat(LIMITS.bytes) }), /10 MB/);
});

test('duplicate dates skip identical contents and report differences without overwriting', () => {
  const current = entry();
  const imported = [entry({ id: otherId }), entry({ id: otherId, body: '不同的正文' }), entry({ id: otherId, date: '2026-10-09', body: '新的一天' })];
  const plan = planImport(imported, [current]);
  assert.equal(plan.imported, 1);
  assert.equal(plan.skipped, 2);
  assert.equal(plan.conflicts.length, 1);
  assert.deepEqual(plan.conflicts[0], { date: '2026-10-08', title: '秋天', reason: '这一天已有不同内容的日记' });
  assert.equal(current.body, '今天把一天留了下来。');
});

test('duplicate identities, repeats in one import and deleted records never silently replace data', () => {
  const changed = entry({ body: '修改后的版本' });
  const plan = planImport([changed, entry({ id: otherId, date: '2026-10-09' }), entry({ id: otherId, date: '2026-10-09' })], [entry()]);
  assert.equal(plan.imported, 1);
  assert.equal(plan.skipped, 2);
  assert.equal(plan.conflicts[0].reason, '同一日记已有不同内容');
  const deleted = entry({ deletedAt: stamp });
  assert.equal(planImport([entry()], [deleted]).conflicts.length, 1);
  assert.equal(planImport([deleted], [deleted]).skipped, 1);
  assert.equal(planImport([entry({ title: '新标题' })], [entry()]).conflicts.length, 1);
  assert.equal(planImport([entry({ id: otherId, title: '新标题' })], [entry()]).conflicts.length, 1);
});

test('restored draft detaches from a missing, deleted or conflicting original so it remains saveable', () => {
  const draft = validateDraft({ date: '2026-10-08', body: '尚未保存的部分', entryId: id, baseUpdatedAt: stamp }, stamp);
  assert.equal(resolveImportedDraft(draft, [entry()]), draft);
  for (const records of [[], [entry({ deletedAt: stamp })], [entry({ updatedAt: '2026-10-08T06:00:00.000Z' })], [entry({ id: otherId })]]) {
    const recovered = resolveImportedDraft(draft, records);
    assert.equal(recovered.body, draft.body);
    assert.equal(recovered.entryId, null);
    assert.equal(recovered.baseUpdatedAt, null);
  }
});
