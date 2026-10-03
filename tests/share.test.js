'use strict';
// 共有される結果（yorozu-plans K124・企画書 60、ACCEPTANCE 3 章「束 B」）: ブラウザピアノのフレーズ
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const Core = require('../piano/piano-core.js');
const ShareCard = require('../share-card.js');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const AT = Date.parse('2026-10-02T12:04:00Z');

test('フレーズ → # → 同じフレーズ（音の高さ・間・音色・日時だけ）', () => {
  const notes = Core.phraseFromOnsets([{ midi: 60, at: 0 }, { midi: 64, at: 10 }, { midi: 62, at: 300 }, { midi: 64, at: 9000 }]);
  assert.deepEqual(notes, [{ m: 60, g: 0 }, { m: 64, g: 3 }, { m: 62, g: 20 }, { m: 64, g: 4 }]);
  const h = Core.encodePhrase(notes, 'organ', AT);
  assert.equal(h, '#p=60_0.64_3.62_20.64_4&v=organ&t=1790942640');
  assert.deepEqual(Core.decodePhrase(h), { notes, timbre: 'organ', atMs: AT });
  assert.equal(Core.phraseText(notes), 'ド+ミ レ ミ');
  // 32 音まで
  const many = Core.phraseFromOnsets(Array.from({ length: 50 }, (_, i) => ({ midi: 60 + (i % 12), at: i * 200 })));
  assert.equal(many.length, 32);
  assert.ok(Core.decodePhrase(Core.encodePhrase(many, 'piano', AT)));
});

test('読めない・範囲の外の # は null。知らない音色はピアノ', () => {
  for (const h of ['', '#p=', '#p=200_1', '#p=10_1', '#p=60_25', '#p=60_1.' + Array(40).fill('60_1').join('.'), '#p=abc']) assert.equal(Core.decodePhrase(h), null, h);
  assert.equal(Core.decodePhrase('#p=60_1&v=xyz').timbre, 'piano');
  assert.equal(Core.decodePhrase('#p=60_1&t=123').atMs, null);
});

test('着地ページと OG 画像: 音色ごとに 1 つ（6 枚）、1200×630、noindex・広告スクリプトなし・すぐピアノへ', () => {
  const ids = Core.TIMBRES.map((t) => t.id);
  assert.ok(ids.length <= 12);
  assert.deepEqual(fs.readdirSync(path.join(ROOT, 'piano', 's')).sort(), ids.flatMap((i) => [i + '.html', i + '.png']).sort());
  for (const id of ids) {
    const b = fs.readFileSync(path.join(ROOT, 'piano', 's', id + '.png'));
    assert.deepEqual([b.readUInt32BE(16), b.readUInt32BE(20)], [1200, 630]);
    const s = read('piano/s/' + id + '.html');
    assert.match(s, /<meta name="robots" content="noindex">/);
    assert.ok(s.includes(`<meta property="og:image" content="https://yorozu-craft.com/web-metronome/piano/s/${id}.png">`));
    assert.ok(s.includes('<script>location.replace("../" + location.hash);</script>'));
    assert.doesNotMatch(s, /adsbygoogle|pagead2/);
  }
  assert.ok(!read('sitemap.xml').includes('/s/'));
  execFileSync(process.execPath, [path.join(ROOT, 'tools', 'build-share.mjs'), '--check']);
});

test('ピアノの画面: 共有のボタン・カードの部品。外のリンクを足していない（遊ぶ画面 R7）', () => {
  const h = read('piano/index.html');
  assert.ok(h.includes('id="shareBtn"') && h.includes('<script src="../share-card.js"></script>'));
  assert.doesNotMatch(h, /github\.com|x\.com|twitter\.com|note\.com/);
  assert.doesNotMatch(h, /adsbygoogle|pagead2/);
  const s = read('share-card.js');
  assert.doesNotMatch(s, /https?:\/\//);
  assert.doesNotMatch(s, /\bfetch\(|XMLHttpRequest|sendBeacon|<script|\.src\s*=/);
  assert.equal((s.match(/@keyframes/g) || []).length, 1);
  assert.match(s, /@media \(prefers-reduced-motion:reduce\)\{\.share-card\{animation:none\}\}/);
  assert.equal(ShareCard.fmtWhen(AT, 'Asia/Tokyo'), '2026年10月2日 21:04');
  assert.ok(read('sw.js').includes("'./share-card.js'"));
});
