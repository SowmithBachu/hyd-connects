// Production server: serves the built site from dist/ plus the live API.
// Run `npm run build` first, then `npm start`.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { apiMiddleware } from './api.js';

const ROOT = path.resolve('dist');
const PORT = Number(process.env.PORT) || 8787;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.ktx2': 'image/ktx2', '.hdr': 'application/octet-stream', '.glb': 'model/gltf-binary', '.webp': 'image/webp', '.wasm': 'application/wasm', '.jpg': 'image/jpeg', '.txt': 'text/plain' };

http.createServer((req, res) => {
  apiMiddleware(req, res, () => {
    const rel = decodeURIComponent(new URL(req.url, 'http://local').pathname);
    let file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(ROOT, 'index.html');
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });
}).listen(PORT, () => console.log(`Hyderabad Connect on http://localhost:${PORT}`));
