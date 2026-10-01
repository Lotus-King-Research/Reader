// Minimal local static server for tests. Production is served by Cloudflare.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve, sep, extname} from 'node:path';
const root = resolve('public');
const types = {'.html':'text/html; charset=utf-8','.json':'application/json','.md':'text/markdown; charset=utf-8'};
createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = resolve(root, '.' + (path === '/' ? '/index.html' : path));
    if (!file.startsWith(root + sep)) throw new Error('Invalid path');
    const content = await readFile(file);
    res.writeHead(200, {'Content-Type': types[extname(file)] || 'application/octet-stream', 'X-Content-Type-Options':'nosniff'});
    res.end(content);
  } catch (_) { if (!res.headersSent) res.writeHead(404); res.end('Not found'); }
}).listen(8788, '127.0.0.1', () => console.log('Reader tests: http://127.0.0.1:8788'));
