import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(await readFile(path.join(root, 'hackathon.config.json'), 'utf8'));
const publicDir = path.join(root, 'public');
const contentTypes = new Map([['.html', 'text/html; charset=utf-8'], ['.css', 'text/css; charset=utf-8']]);

function headers(type = 'application/json; charset=utf-8') {
  return {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'self'; style-src 'self'; base-uri 'none'; frame-ancestors 'none'",
  };
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${config.host}:${config.port}`);
  if (request.method === 'GET' && url.pathname === '/api/health') {
    response.writeHead(200, headers());
    response.end(JSON.stringify({ ok: true, project: config.projectName, oauthEnabled: false }));
    return;
  }
  if (request.method !== 'GET') {
    response.writeHead(405, headers());
    response.end(JSON.stringify({ ok: false, error: 'METHOD_NOT_ALLOWED' }));
    return;
  }
  const requested = url.pathname === '/' ? '/index.html' : url.pathname;
  const filePath = path.join(publicDir, path.normalize(requested));
  if (!filePath.startsWith(publicDir) || !existsSync(filePath)) {
    response.writeHead(404, headers());
    response.end(JSON.stringify({ ok: false, error: 'NOT_FOUND' }));
    return;
  }
  response.writeHead(200, headers(contentTypes.get(path.extname(filePath)) || 'application/octet-stream'));
  response.end(await readFile(filePath));
});

server.listen(config.port, config.host, () => {
  process.stdout.write(`__PROJECT_NAME__: http://${config.host}:${config.port}/\n`);
});

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
