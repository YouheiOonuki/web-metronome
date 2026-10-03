// 共有される結果（yorozu-plans K124・企画書 60）の着地ページを作る（ブラウザピアノのフレーズ。種類 = 音色 6 つ）
//   node tools/build-share.mjs          作る（piano/s/<音色>.html）
//   node tools/build-share.mjs --check  今のファイルと同じかだけを確かめる（tests から呼ぶ）
// OG 画像（piano/s/<音色>.png）は tools/make-share-og.mjs（Playwright）で作る
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { stubHtml, ogHtml, writeAll } from './share-stub.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const Core = createRequire(import.meta.url)(path.join(ROOT, 'piano', 'piano-core.js'));
const SITE = 'https://yorozu-craft.com/web-metronome/piano/';

export function pages() {
  return Core.TIMBRES.map((t) => ({
    file: `piano/s/${t.id}.html`, image: `piano/s/${t.id}.png`,
    stub: stubHtml({
      title: `${t.name}で弾いたフレーズ｜ブラウザピアノ`, desc: `ブラウザピアノ（音色 ${t.name}）で弾いたフレーズ。開くと聞けて、同じ鍵盤で弾けます。`,
      url: `${SITE}s/${t.id}.html`, image: `${SITE}s/${t.id}.png`, back: '../', canonical: SITE, open: 'ブラウザピアノを開く',
    }),
    og: ogHtml({ kicker: 'ブラウザピアノ', big: `${t.name}で弾いたフレーズ`, small: '開くと聞けて、同じ鍵盤で弾けます', url: 'yorozu-craft.com/web-metronome/piano/',
      bg: '#1f1d1a', fg: '#efe9e1', accent: '#e0a060', bigSize: 80 }),
  }));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const check = process.argv.includes('--check');
  const diff = writeAll(ROOT, Object.fromEntries(pages().map((p) => [p.file, p.stub])), check);
  if (check && diff.length) { console.error('作り直しが要る: ' + diff.join(', ')); process.exit(1); }
  console.log(check ? 'OK' : `書いた ${diff.length} 件`);
}
