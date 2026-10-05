import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const buckets = new Map();
globalThis.__mockGetStore = ({ name }) => {
  if (!buckets.has(name)) buckets.set(name, new Map());
  const bucket = buckets.get(name);
  return {
    async get(key) { return bucket.get(key) ?? null; },
    async setJSON(key, value) { bucket.set(key, structuredClone(value)); return { modified: true }; },
  };
};
const source = (await readFile(new URL('../netlify/functions/memorial.mjs', import.meta.url), 'utf8'))
  .replace("import { getStore } from '@netlify/blobs';", 'const getStore = globalThis.__mockGetStore;');
const { default: handler, config } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
assert(config.path.includes('/v2/public/memorial'));
process.env.MEMORIAL_PUBLISH_TOKEN = 'test-owner-token-of-sufficient-length';
delete process.env.OPENAI_API_KEY;
delete process.env.OPENAI_BASE_URL;

const call = async (method, path, body, authorized = false) => {
  const request = new Request(`https://example.netlify.app${path}`, {
    method,
    headers: { ...(authorized ? { Authorization: `Bearer ${process.env.MEMORIAL_PUBLISH_TOKEN}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const response = await handler(request);
  return [response.status, await response.json()];
};

assert.equal((await call('GET', '/v2/memorial'))[0], 401);
assert.deepEqual((await call('GET', '/v2/memorial', null, true))[1], { published: false });
assert.equal((await call('POST', '/v2/memorial', { entries: 'invalid' }, true))[0], 400);
assert.equal((await call('POST', '/v2/memorial', [], true))[0], 400);
const body = { title: '留下的事', introduction: '写给后来的人。', story_ids: ['day-1'], ai_enabled: true,
  entries: [{ entry_id: 'day-1', date: '2030-01-02', title: '第一次', content: '今天出发了。' }] };
const [createdStatus, created] = await call('POST', '/v2/memorial', body, true);
assert.equal(createdStatus, 200);
assert.match(created.url, /^https:\/\/example\.netlify\.app\/memorial\.html\?id=/);
const id = created.public_id;
assert.equal((await call('GET', `/v2/public/memorial?id=${id}`))[1].entries[0].content, '今天出发了。');
assert.equal((await call('POST', '/v2/public/memorial/ask', { id, question: '何时出发？' }))[0], 503);
body.entries[0].content = '今天到达了。';
assert.equal((await call('POST', '/v2/memorial', body, true))[1].url, created.url);
assert.equal((await call('GET', `/v2/public/memorial?id=${id}`))[1].entries[0].content, '今天到达了。');
const longContent = '完整长日记。'.repeat(8000) + '末尾不应丢失。';
body.entries[0].content = longContent;
assert.equal((await call('POST', '/v2/memorial', body, true))[0], 200);
assert.equal((await call('GET', `/v2/public/memorial?id=${id}`))[1].entries[0].content, longContent);
const oversized = { ...body, entries: [{ ...body.entries[0], content: 'a'.repeat(4_000_001) }] };
assert.equal((await call('POST', '/v2/memorial', oversized, true))[0], 400);
assert.equal((await call('GET', `/v2/public/memorial?id=${id}`))[1].entries[0].content, longContent);
body.entries[0].content = '今天到达了。';
await call('POST', '/v2/memorial', body, true);

// The AI sees only the published evidence and its citation IDs stay usable.
process.env.OPENAI_API_KEY = 'test-gateway-key';
process.env.OPENAI_BASE_URL = 'https://gateway.example.test/v1';
let modelCalls = 0;
globalThis.fetch = async (url, options) => {
  modelCalls++;
  assert.equal(url, 'https://gateway.example.test/v1/chat/completions');
  assert(options.signal instanceof AbortSignal);
  const request = JSON.parse(options.body);
  assert.match(request.messages[1].content, /今天到达了。/);
  assert(!request.messages[1].content.includes('今天出发了。'));
  return Response.json({ choices: [{ message: { content: '在 2030 年 1 月 2 日到达。[1]' } }] });
};
assert.equal((await call('POST', '/v2/public/memorial/ask', { id: 'wrong-public-id', question: '何时到达？' }))[0], 404);
assert.equal((await call('POST', '/v2/public/memorial/ask', { id, question: 'a' }))[0], 400);
const noEvidence = await call('POST', '/v2/public/memorial/ask', { id, question: 'zebra' });
assert.deepEqual(noEvidence[1].citations, []);
assert.equal(modelCalls, 0);
for (let i = 0; i < 5; i++) {
  const [status, answer] = await call('POST', '/v2/public/memorial/ask', { id, question: '何时到达？' });
  assert.equal(status, 200);
  assert.deepEqual(answer.citations.map(c => c.entry_id), ['day-1']);
}
assert.equal((await call('POST', '/v2/public/memorial/ask', { id, question: '何时到达？' }))[0], 429);
assert.equal(modelCalls, 5);
// Failure paths return usable errors, keep citation numbering and recover on
// the next allowed request. All snapshots here are synthetic.
const counters = buckets.get('lifeos-memorial-questions');
body.entries.push({entry_id:'day-2',date:'2030-01-03',title:'第二次',content:'今天又到达了。'});
await call('POST','/v2/memorial',body,true);
for (const content of [' ', {}, ['unexpected'], '未知出处[99]']) {
  counters.clear();
  globalThis.fetch = async () => Response.json({choices:[{message:{content}}]});
  assert.equal((await call('POST','/v2/public/memorial/ask',{id,question:'何时到达？'}))[0],502);
}
counters.clear();
globalThis.fetch=async()=>Response.json({choices:[{message:{content:'第二天也到达了。[2]'}}]});
const subset=await call('POST','/v2/public/memorial/ask',{id,question:'何时到达？'});
assert.equal(subset[0],200);
assert.equal(subset[1].citation_status,'verified');
assert.deepEqual(subset[1].citations.map(c=>[c.citation_id,c.entry_id]),[[2,'day-2']]);
counters.clear();
globalThis.fetch=async()=>Response.json({choices:[{message:{content:'无法确定'}}]});
const uncited=await call('POST','/v2/public/memorial/ask',{id,question:'何时到达？'});
assert.equal(uncited[1].citation_status,'missing');assert.deepEqual(uncited[1].citations,[]);
counters.clear();
globalThis.fetch=async()=>{throw new DOMException('fixture-secret','TimeoutError')};
const timeout=await call('POST','/v2/public/memorial/ask',{id,question:'何时到达？'});
assert([502,503].includes(timeout[0]));assert(!JSON.stringify(timeout[1]).includes('fixture-secret'));
counters.clear();
globalThis.fetch=async()=>Response.json({choices:[{message:{content:'已到达[1]'}}]});
assert.equal((await call('POST','/v2/public/memorial/ask',{id,question:'何时到达？'}))[0],200);
assert.equal((await call('POST', '/v2/memorial/unpublish', {}, true))[0], 200);
assert.equal((await call('GET', `/v2/public/memorial?id=${id}`))[0], 410);
assert.equal((await call('POST', '/v2/public/memorial/ask', { id, question: '何时到达？' }))[0], 404);
assert.equal((await call('POST', '/v2/memorial', body, true))[1].url, created.url);
body.ai_enabled = false;
await call('POST', '/v2/memorial', body, true);
assert.equal((await call('POST', '/v2/public/memorial/ask', { id, question: '何时到达？' }))[0], 403);
console.log('Netlify memorial lifecycle, complete snapshots, AI evidence and question limits: OK');
