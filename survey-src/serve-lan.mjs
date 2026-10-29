// 發布前用手機實測：在區域網路上提供網頁版問卷（survey-next）。
//   node survey-src/serve-lan.mjs
// ⚠ 只開放問卷頁面與它連結到的政策頁，不把整個官網 repo 暴露在區網上。
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const site = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ALLOW = [/^\/survey-next\/(index\.html|app\.js|style\.css)?$/, /^\/survey-v2-next\/(index\.html|app\.js|style\.css)?$/, /^\/survey-v3-next\/(index\.html|app\.js|style\.css)?$/,
  /^\/(privacy|terms)\.html$/, /^\/style\.css$/];
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const PORT = 8765;

createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const ok = ALLOW.some((r) => r.test(path));
  let file = join(site, normalize(path));
  if (ok && existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  const stamp = new Date().toISOString().slice(11, 19);
  if (!ok || !file.startsWith(site) || !existsSync(file)) {
    console.log(`${stamp} 404 ${path}`);
    res.writeHead(404); res.end('not found'); return;
  }
  console.log(`${stamp} 200 ${path}  ${req.headers['user-agent']?.slice(0, 60) ?? ''}`);
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
  createReadStream(file).pipe(res);
}).listen(PORT, '0.0.0.0', () => console.log(`區網問卷伺服器：http://<本機 IP>:${PORT}/survey-next/`));
