'use strict';
// カポ・移調（capo/capo-core.js）のテスト。期待値は 12 平均律の半音を手で数えたもの
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../capo/capo-core.js');

test('コードの読み取り: 根音・後ろの部分・分数コード', () => {
  assert.deepEqual(C.parseChord('Am7'), { root: 9, suffix: 'm7', bass: null });
  assert.deepEqual(C.parseChord('B♭m'), { root: 10, suffix: 'm', bass: null });
  assert.deepEqual(C.parseChord('Bbm7-5'), { root: 10, suffix: 'm7-5', bass: null });
  assert.deepEqual(C.parseChord('D/F#'), { root: 2, suffix: '', bass: 6 });
  assert.deepEqual(C.parseChord('E7(#9)'), { root: 4, suffix: '7(#9)', bass: null });
  assert.deepEqual(C.parseChord('Ｃａｄｄ９'), { root: 0, suffix: 'add9', bass: null }, '全角も読む');
  for (const w of ['Bad', 'Go', 'And', 'N.C.', 'x', '', 'C/H', 'Dance']) assert.equal(C.parseChord(w), null, w);
});

test('移調: 歌詞と空白はそのまま、コードだけ動く', () => {
  const key = C.guessKey(C.extractChords('G D Em C'));
  assert.equal(C.transposeText('G   D  Em C', 2, key), 'A   E  F#m D');
  assert.equal(C.transposeText('[Am]あいうえお[D7]かき G/B', 1, key), '[B♭m]あいうえお[E♭7]かき A♭/C');
  assert.equal(C.transposeText('C | F | G7 | C', -1, C.guessKey(C.extractChords('C F G7 C'))), 'B | E | F#7 | B');
});

test('♯と♭の書き分けは鳴るキーの調号', () => {
  const g = C.guessKey(C.extractChords('G C D G'));
  assert.equal(C.transposeText('G C D', 3, g), 'B♭ E♭ F', 'B♭ 長調');
  assert.equal(C.transposeText('G C D', 4, g), 'B E F#', 'B 長調');
  assert.equal(C.transposeText('G C D', -1, g), 'F# B C#', 'F# 長調（G♭ ではなく F#）');
  assert.deepEqual(C.keyName({ tonic: 10, mode: 'minor' }), { en: 'B♭m', ja: '変ロ短調' });
  assert.deepEqual(C.keyName({ tonic: 1, mode: 'minor' }), { en: 'C#m', ja: '嬰ハ短調' });
  assert.deepEqual(C.keyName({ tonic: 3, mode: 'major' }), { en: 'E♭', ja: '変ホ長調' });
});

test('キーの推定', () => {
  const k = (s) => C.keyName(C.guessKey(C.extractChords(s))).en;
  assert.equal(k('C Am F G'), 'C');
  assert.equal(k('Am F C G'), 'Am');
  assert.equal(k('E♭ B♭ Cm A♭'), 'E♭');
  assert.equal(k('D A Bm G'), 'D');
  assert.equal(C.guessKey([]), null);
});

test('カポ: 鳴るキー A・カポ 2 なら G の形（よくある質問の例）', () => {
  const r = C.compute('A E F#m D', { capo: 2 });
  assert.equal(r.soundingKey.en, 'A');
  assert.equal(r.playKey.en, 'G');
  assert.equal(r.playText, 'G D Em C');
});

test('カポ早見表: 押さえやすい形の数と、いちばん多い位置', () => {
  const r = C.compute('E♭ B♭ Cm A♭', {});
  assert.equal(r.capoTable.length, C.MAX_CAPO + 1);
  const row = (n) => r.capoTable[n];
  assert.deepEqual(row(1).shapes, ['D', 'A', 'Bm', 'G']);
  assert.equal(row(1).open, 3, 'Bm はセーハ');
  assert.deepEqual(row(3).shapes, ['C', 'G', 'Am', 'F']);
  assert.equal(row(3).open, 3, 'F はセーハ');
  assert.equal(row(0).open, 0);
  assert.equal(r.best, 1, '同数なら低いフレット');
  const g = C.compute('G D Em C', {});
  assert.equal(g.best, 0);
  assert.equal(g.capoTable[0].open, 4);
});

test('譜面のカポ: カポ 3 の G の形 → 鳴るキーは B♭', () => {
  const r = C.compute('G D Em C', { sheetCapo: 3 });
  assert.equal(r.originalKey.en, 'B♭');
  assert.equal(r.playText, 'B♭ F Gm E♭', 'カポなしで弾く形');
  const r2 = C.compute('G D Em C', { sheetCapo: 3, capo: 3 });
  assert.equal(r2.playText, 'G D Em C', '同じカポなら同じ形');
  const r3 = C.compute('G D Em C', { sheetCapo: 3, capo: 2, shift: -1 });
  assert.equal(r3.playText, 'G D Em C', 'キーを 1 下げてカポ 2');
});

test('押さえやすい形の一覧（使い方ページの 27 個）と判定が一致', () => {
  assert.equal(C.OPEN_SHAPE_LIST.length, 27);
  for (const n of C.OPEN_SHAPE_LIST) assert.ok(C.isOpenShape(C.parseChord(n)), n);
  for (const n of ['F', 'Bm', 'B', 'Cm', 'F#m', 'Gm', 'Bb', 'Fm7', 'Cm7', 'Gsus4', 'Bdim']) assert.ok(!C.isOpenShape(C.parseChord(n)), n);
  assert.ok(C.isOpenShape(C.parseChord('CM7')), 'M7 は maj7');
  const html = fs.readFileSync(path.join(__dirname, '..', 'capo', 'guide.html'), 'utf8');
  const line = html.match(/<p>(C・D・E・G・A[^<]*)<\/p>/)[1];
  assert.deepEqual(line.split(/[・／]/), C.OPEN_SHAPE_LIST);
});

test('ダイアトニック: C 長調と A 短調（自然的短音階）', () => {
  const c = C.diatonic({ tonic: 0, mode: 'major' });
  assert.deepEqual(c.map((r) => r.triad), ['C', 'Dm', 'Em', 'F', 'G', 'Am', 'Bdim']);
  assert.deepEqual(c.map((r) => r.seventh), ['Cmaj7', 'Dm7', 'Em7', 'Fmaj7', 'G7', 'Am7', 'Bm7(♭5)']);
  const a = C.diatonic({ tonic: 9, mode: 'minor' });
  assert.deepEqual(a.map((r) => r.triad), ['Am', 'Bdim', 'C', 'Dm', 'Em', 'F', 'G']);
  const f = C.diatonic({ tonic: 5, mode: 'major' });
  assert.deepEqual(f.map((r) => r.triad), ['F', 'Gm', 'Am', 'B♭', 'C', 'Dm', 'Edim']);
});

test('共有リンク（# 以降）の読み書きと範囲', () => {
  const s = { text: 'G D\nEm C', shift: -2, capo: 3, sheetCapo: 1 };
  assert.deepEqual(C.decodeState('#' + C.encodeState(s)), s);
  assert.deepEqual(C.decodeState('#k=99&p=-4&s=abc'), { text: '', shift: 6, capo: 0, sheetCapo: 0 });
  assert.equal(C.encodeState({ text: '', shift: 0, capo: 0, sheetCapo: 0 }), '');
});

test('ページの決まり: 保存しない・共通ページへのリンク・ビーコン・sitemap と sw', () => {
  const root = path.join(__dirname, '..');
  const idx = fs.readFileSync(path.join(root, 'capo', 'index.html'), 'utf8');
  const js = fs.readFileSync(path.join(root, 'capo', 'capo.js'), 'utf8') + fs.readFileSync(path.join(root, 'capo', 'capo-core.js'), 'utf8');
  assert.ok(!/localStorage|indexedDB/.test(js.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')), '保存しない（リセットボタン不要）');
  for (const f of ['index.html', 'guide.html']) {
    const h = fs.readFileSync(path.join(root, 'capo', f), 'utf8');
    assert.ok(h.includes('href="../../about.html"') && h.includes('href="../../privacy-policy.html"'), f);
    assert.equal((h.match(/static\.cloudflareinsights\.com\/beacon\.min\.js/g) || []).length, 1, f);
    assert.equal((h.match(/adsbygoogle\.js\?client=ca-pub-5375267956079717/g) || []).length, 1, f);
    assert.ok(h.includes(`<link rel="canonical" href="https://yorozu-craft.com/web-metronome/capo/${f === 'index.html' ? '' : f}">`), f);
  }
  assert.ok(idx.includes('aria-live="polite"'));
  const sm = fs.readFileSync(path.join(root, 'sitemap.xml'), 'utf8');
  assert.ok(sm.includes('/web-metronome/capo/</loc>') && sm.includes('/web-metronome/capo/guide.html</loc>'));
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  for (const f of ['./capo/', './capo/capo-core.js', './capo/capo.js', './capo/capo.css', './capo/guide.html']) assert.ok(sw.includes(`'${f}'`), f);
});
