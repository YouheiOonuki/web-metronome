// 共有される結果（K124）の OG 画像（1200×630 の PNG）を作り直す。どのリポジトリでも同じもの（直したら全部に写す）
//   NODE_PATH=$(npm root -g) node tools/make-share-og.mjs [種類の名前で絞る…]
// tools/build-share.mjs の pages() の og（HTML の文字列）か ogShot（ページを開いて撮る関数。星空など）を Playwright で撮る。
// 画像はリポジトリに入れる（公開される静的なファイル）。着地ページの HTML は build-share.mjs が書く
import { createRequire } from 'node:module';
import path from 'node:path';
import http from 'node:http';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pages } from './build-share.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const only = process.argv.slice(2);

// ogShot がページを開くとき用に、リポジトリの直下を配る（外へは出ない）
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/json' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
// 外への要求は止める（計測・広告を汚さない）
await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
let n = 0;
for (const p of pages()) {
  if (!p.image || (only.length && !only.some((o) => p.image.includes(o)))) continue;
  const out = path.join(ROOT, p.image);
  if (p.ogShot) await p.ogShot(page, base);
  else await page.setContent(p.og, { waitUntil: 'load' });
  const type = out.endsWith('.jpg') ? 'jpeg' : 'png';
  await page.screenshot({ path: out, type, ...(type === 'jpeg' ? { quality: 82 } : {}), clip: { x: 0, y: 0, width: 1200, height: 630 } });
  n += 1;
}
await browser.close();
server.close();
console.log(`OG 画像 ${n} 枚`);
