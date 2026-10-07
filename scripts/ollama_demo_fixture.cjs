'use strict';
// Public/synthetic QA only. This is an Ollama protocol fixture, not a model.
const http = require('node:http');

async function startOllamaFixture({port = 0, models = ['lifeos-demo:fixture', 'qwen-demo:fixture']} = {}) {
  const requests = [];
  let scenario = 'ready';
  const server = http.createServer((req, res) => {
    const reply = (body, status = 200) => {
      res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8'});
      res.end(JSON.stringify(body));
    };
    if (req.method === 'GET' && req.url === '/api/tags') {
      requests.push({method: 'GET', path: req.url});
      return reply({models: scenario === 'empty' ? [] : models.map(name => ({name, model: name}))});
    }
    if (req.method !== 'POST' || req.url !== '/api/chat') return reply({error: 'fixture route not found'}, 404);
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 1024 * 1024) req.destroy(); });
    req.on('end', () => {
      let input;
      try { input = JSON.parse(body); } catch { return reply({error: 'fixture invalid input'}, 400); }
      requests.push({method: 'POST', path: req.url, body: input, authorization: Boolean(req.headers.authorization)});
      if (scenario === 'failure') return reply({error: 'fixture failure'}, 503);
      if (scenario === 'missing' || !models.includes(input.model)) return reply({error: 'fixture model not found'}, 404);
      const messages = input.messages || [];
      const connectionTest = messages.length === 1 && messages[0].content?.includes('这是连接测试');
      const content = connectionTest ? '连接成功' : '打开界面微调，再选择「编辑侧栏」，可以拖动图标调整顺序，也可以将功能收进阁楼 [H1]';
      reply({model: input.model, message: {role: 'assistant', content}, done: true, prompt_eval_count: 16, eval_count: 24});
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return {base_url: `http://127.0.0.1:${server.address().port}`, requests,
    setScenario(value) { scenario = value; },
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  };
}

module.exports = {startOllamaFixture};

if (require.main === module && process.argv.includes('--serve')) {
  startOllamaFixture().then(fixture => {
    process.stdout.write(JSON.stringify({ok: true, base_url: fixture.base_url, fixture: true}) + '\n');
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => fixture.close().then(() => process.exit(0)));
  }).catch(error => { process.stderr.write(String(error) + '\n'); process.exit(1); });
}
