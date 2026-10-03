// 共有される結果（yorozu-plans K124・企画書 60）の「着地ページ」と OG 画像の下書き。どのリポジトリでも同じもの（直したら全部に写す）
//
// 着地ページ（<道具>/s/<種類>.html）:
//   - X・LINE などが読む og:image を「結果の種類」ごとに変えるためだけのページ（静的なサイトなので、# の中身ごとに OG は変えられない）
//   - noindex・sitemap に載せない。AdSense は meta だけ、Cloudflare のビーコン 1 個（印刷物の着地ページ /print/ と同じ扱い）
//   - 開くとすぐ、同じ「#」のまま道具の画面へ移る（location.replace）。JS が無いときは道具へのリンク
// OG 画像（<道具>/s/<種類>.png、1200×630）: ogHtml() の HTML を Playwright で撮る（tools/make-share-og.cjs）
// 依存パッケージなし（Node 20 以上）
import fs from 'node:fs';
import path from 'node:path';

export const ADSENSE_META = '<meta name="google-adsense-account" content="ca-pub-5375267956079717">';
export const BEACON = `<!-- Cloudflare Web Analytics --><script type='module' src='https://static.cloudflareinsights.com/beacon.min.js' data-cf-beacon='{"token": "b79bf821e1fd4b6683866d493b1de426"}'></script><!-- End Cloudflare Web Analytics -->`;
export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * 着地ページの HTML。o: { title, desc, url（このページの公開 URL）, image（OG 画像の公開 URL）, back（道具の画面への相対パス）,
 *   canonical（道具の画面の公開 URL）, open（リンクの文字）, lang（既定 ja）, imageType（既定 image/png） }
 */
export function stubHtml(o) {
  return `<!DOCTYPE html>
<html lang="${o.lang || 'ja'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(o.title)}</title>
<!-- 共有される結果の着地ページ（K124）。OG 画像を結果の種類ごとに変えるためだけに置く。検索には出さない -->
<meta name="robots" content="noindex">
<link rel="canonical" href="${esc(o.canonical)}">
<meta name="description" content="${esc(o.desc)}">
<meta property="og:title" content="${esc(o.title)}">
<meta property="og:description" content="${esc(o.desc)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${esc(o.url)}">
<meta property="og:image" content="${esc(o.image)}">
<meta property="og:image:type" content="${o.imageType || 'image/png'}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:site_name" content="yorozu-craft">
<meta property="og:locale" content="${o.lang === 'en' ? 'en_US' : 'ja_JP'}">
<meta name="twitter:card" content="summary_large_image">
${ADSENSE_META}
<script>location.replace(${JSON.stringify(o.back)} + location.hash);</script>
<noscript><meta http-equiv="refresh" content="0; url=${esc(o.back)}"></noscript>
</head>
<body>
<p><a href="${esc(o.back)}">${esc(o.open)}</a></p>
${BEACON}
</body>
</html>
`;
}

/**
 * OG 画像の下書き（1200×630 の HTML。文字は端末のフォント）。o: { kicker（道具の名前）, big（結果の種類）, small（補足 1 行）,
 *   url（下に出す URL の文字）, bg, fg, accent }
 */
export function ogHtml(o) {
  return `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><style>
html,body{margin:0;width:1200px;height:630px;overflow:hidden}
body{background:${o.bg};color:${o.fg};font-family:"Hiragino Sans","Noto Sans JP","IPAexGothic",sans-serif;display:flex;flex-direction:column;justify-content:space-between;box-sizing:border-box;padding:64px 80px}
.k{font-size:40px;font-weight:700;opacity:.85}
.b{font-size:${o.bigSize || 88}px;font-weight:700;line-height:1.15;word-break:keep-all;color:${o.accent}}
.s{font-size:36px;margin-top:20px;opacity:.85}
.u{font-size:30px;opacity:.75;display:flex;justify-content:space-between}
</style></head><body>
<div class="k">${esc(o.kicker)}</div>
<div><div class="b">${esc(o.big)}</div>${o.small ? `<div class="s">${esc(o.small)}</div>` : ''}</div>
<div class="u"><span>${esc(o.url)}</span><span>yorozu-craft</span></div>
</body></html>`;
}

/** 書く（--check なら同じかを確かめるだけ）。files: { 相対パス: 中身 }。違うファイルの一覧を返す */
export function writeAll(root, files, check) {
  const diff = [];
  for (const [rel, body] of Object.entries(files)) {
    const p = path.join(root, rel);
    const now = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
    if (now === body) continue;
    diff.push(rel);
    if (!check) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, body); }
  }
  return diff;
}
