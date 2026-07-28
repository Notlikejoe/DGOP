import { createReadStream, existsSync, statSync } from 'node:fs';
import http from 'node:http';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const webRoot = resolve(root, 'apps', 'web', 'dist', 'web', 'browser');
const port = Number(process.env.DGOP_WEB_PORT ?? 4205);
const apiPort = Number(process.env.DGOP_API_PORT ?? 3005);

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function proxyApi(req, res) {
  const upstream = http.request(
    {
      hostname: '127.0.0.1',
      port: apiPort,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: `localhost:${apiPort}` },
    },
    (apiRes) => {
      res.writeHead(apiRes.statusCode ?? 502, apiRes.headers);
      apiRes.pipe(res);
    },
  );
  upstream.on('error', () => {
    res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ message: 'DGOP API is not reachable.' }));
  });
  req.pipe(upstream);
}

function resolveFile(url = '/') {
  const clean = decodeURIComponent(url.split('?')[0]).replace(/^\/+/, '');
  const requested = resolve(webRoot, clean || 'index.html');
  if (!requested.startsWith(webRoot)) return null;
  if (!existsSync(requested) || statSync(requested).isDirectory()) {
    return join(webRoot, 'index.html');
  }
  return requested;
}

if (!existsSync(join(webRoot, 'index.html'))) {
  console.error('Built web app not found. Run npm --prefix apps/web run build first.');
  process.exit(1);
}

http
  .createServer((req, res) => {
    if (req.url?.startsWith('/api')) return proxyApi(req, res);
    const file = resolveFile(req.url);
    if (!file) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    const contentType = mimeTypes[extname(file).toLowerCase()] ?? 'application/octet-stream';
    res.writeHead(200, { 'content-type': contentType, 'cache-control': 'no-store' });
    createReadStream(file).pipe(res);
  })
  .listen(port, '127.0.0.1', () => {
    console.log(`DGOP web -> http://localhost:${port}`);
  });
