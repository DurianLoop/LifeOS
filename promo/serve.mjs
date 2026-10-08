import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handler } from '../netlify/functions/mobile-ask.mjs';

const source = dirname(fileURLToPath(import.meta.url));
const root = process.env.LIFEOS_PROMO_DIST === '1' ? resolve(source, 'dist') : source;
const port = Number(process.env.LIFEOS_PROMO_PORT || 4173);
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.ogg': 'audio/ogg', '.md': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json' };

const server = createServer(async (request, response) => {
  if (request.url === '/.netlify/functions/mobile-ask') {
    try {
      let length = 0; const chunks = [];
      for await (const chunk of request) { length += chunk.length; if (length > 120 * 1024) { response.writeHead(413).end(); return; } chunks.push(chunk); }
      const result = await handler({ httpMethod: request.method, rawUrl: `http://${request.headers.host}${request.url}`, headers: request.headers, body: Buffer.concat(chunks).toString('utf8') });
      response.writeHead(result.statusCode, result.headers).end(result.body);
    } catch { response.writeHead(500).end('Request failed'); }
    return;
  }
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  try {
    const url = new URL(request.url, 'http://localhost');
    const path = decodeURIComponent(url.pathname).replaceAll('\\', '/');
    const target = resolve(root, `.${path.endsWith('/') ? `${path}index.html` : path}`);
    if (!target.startsWith(`${root}${sep}`)) {
      response.writeHead(403).end('Forbidden');
      return;
    }
    const extension = extname(target);
    if (!types[extension] || !(await stat(target)).isFile()) throw new Error('Not found');
    const bytes = await readFile(target);
    response.writeHead(200, {
      'Content-Type': types[extension],
      'Content-Length': bytes.length,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin'
    });
    response.end(request.method === 'HEAD' ? undefined : bytes);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
  }
});
server.listen(port, '127.0.0.1', () => console.log(`LifeOS promo: http://127.0.0.1:${port}`));
server.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
