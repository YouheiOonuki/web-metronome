'use strict';
// ブラウザピアノ（piano/）のテスト: 音の高さ・キーの割り当て・鍵盤の範囲・設定の正規化・ページの決まり
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Core = require('../piano/piano-core.js');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const close = (a, b, eps = 0.005) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

test('周波数: A4 = 440 Hz の 12 平均律', () => {
  assert.equal(Core.frequency(69), 440);
  close(Core.frequency(60), 261.6256); // 真ん中のド C4
  close(Core.frequency(21), 27.5); // A0（88 鍵のいちばん下）
  close(Core.frequency(108), 4186.009); // C8（いちばん上）
  close(Core.frequency(70), 466.1638); // A♯4
  close(Core.frequency(64), 329.6276); // E4
  for (let m = 21; m <= 96; m++) close(Core.frequency(m + 12) / Core.frequency(m), 2, 1e-9); // 1 オクターブで 2 倍
  close(Core.frequency(61) / Core.frequency(60), Math.pow(2, 1 / 12), 1e-12); // 半音は 2 の 12 乗根
  assert.equal(Core.frequency(69, 442), 442); // 基準を変えられる（画面では使わない）
});

test('音名: ドレミと CDE（C4 = 60）', () => {
  assert.equal(Core.noteName(60, 'cde'), 'C4');
  assert.equal(Core.noteName(60, 'doremi'), 'ド');
  assert.equal(Core.noteName(69, 'cde'), 'A4');
  assert.equal(Core.noteName(69, 'doremi'), 'ラ');
  assert.equal(Core.noteName(66, 'cde'), 'F♯4');
  assert.equal(Core.noteName(66, 'doremi'), 'ファ♯');
  assert.equal(Core.noteName(59, 'cde'), 'B3');
  assert.equal(Core.noteName(21, 'cde'), 'A0');
  assert.equal(Core.noteName(108, 'cde'), 'C8');
  const blacks = [...Array(12).keys()].filter((i) => Core.isBlack(60 + i)).map((i) => Core.noteName(60 + i, 'cde'));
  assert.deepEqual(blacks, ['C♯4', 'D♯4', 'F♯4', 'G♯4', 'A♯4']);
});

test('パソコンのキー: code の位置で割り当てる（Z 段 = 低いド、Q 段 = 1 オクターブ上）', () => {
  const base = 48;
  const m = (c) => Core.midiForCode(c, base);
  assert.equal(m('KeyZ'), 48); // C3
  assert.equal(m('KeyS'), 49); // C♯3
  assert.equal(m('KeyM'), 59); // B3
  assert.equal(m('Comma'), 60); // C4（下の段の続き）
  assert.equal(m('KeyQ'), 60); // C4（上の段の始まり）
  assert.equal(m('Digit2'), 61);
  assert.equal(m('KeyP'), 76); // E5
  assert.equal(m('BracketLeft'), 77); // F5（JIS では @ のキー）
  assert.equal(m('Equal'), 78); // F♯5（JIS では ^）
  assert.equal(m('BracketRight'), 79); // G5（JIS では [）
  assert.equal(m('KeyA'), null); // 割り当てなし（C♭ に当たる位置）
  assert.equal(m('Digit1'), null);
  assert.equal(m('Space'), null);
  // 黒鍵の段のキーは黒鍵、白鍵の段のキーは白鍵になる
  for (const c of ['KeyS', 'KeyD', 'KeyG', 'KeyH', 'KeyJ', 'KeyL', 'Semicolon', 'Digit2', 'Digit3', 'Digit5', 'Digit6', 'Digit7', 'Digit9', 'Digit0', 'Equal']) {
    assert.ok(Core.isBlack(m(c)), c);
  }
  for (const c of ['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM', 'Comma', 'Period', 'Slash', 'KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI', 'KeyO', 'KeyP', 'BracketLeft', 'BracketRight']) {
    assert.ok(!Core.isBlack(m(c)), c);
  }
  // 下の段は C3〜E4、上の段は C4〜G5 を切れ目なく
  const lower = ['KeyZ', 'KeyS', 'KeyX', 'KeyD', 'KeyC', 'KeyV', 'KeyG', 'KeyB', 'KeyH', 'KeyN', 'KeyJ', 'KeyM', 'Comma', 'KeyL', 'Period', 'Semicolon', 'Slash'].map(m);
  assert.deepEqual(lower, [...Array(17).keys()].map((i) => 48 + i));
  const upper = ['KeyQ', 'Digit2', 'KeyW', 'Digit3', 'KeyE', 'KeyR', 'Digit5', 'KeyT', 'Digit6', 'KeyY', 'Digit7', 'KeyU', 'KeyI', 'Digit9', 'KeyO', 'Digit0', 'KeyP', 'BracketLeft', 'Equal', 'BracketRight'].map(m);
  assert.deepEqual(upper, [...Array(20).keys()].map((i) => 60 + i));
  // 音域をずらすと一緒にずれる
  assert.equal(Core.midiForCode('KeyZ', 60), 60);
  assert.deepEqual(Core.codesForMidi(60, 48).sort(), ['Comma', 'KeyQ']);
});

test('キーの文字: US と JIS で違うのは 3 つだけ。押された文字から配列を当てる', () => {
  assert.equal(Core.keyLabel('KeyQ', 'jis'), 'Q');
  assert.equal(Core.keyLabel('Digit7', 'us'), '7');
  assert.equal(Core.keyLabel('Semicolon', 'jis'), ';');
  assert.equal(Core.keyLabel('Comma', 'us'), ',');
  assert.equal(Core.keyLabel('BracketLeft', 'jis'), '@');
  assert.equal(Core.keyLabel('BracketLeft', 'us'), '[');
  assert.equal(Core.keyLabel('Equal', 'jis'), '^');
  assert.equal(Core.keyLabel('Equal', 'us'), '=');
  assert.equal(Core.keyLabel('BracketRight', 'jis'), '[');
  assert.equal(Core.keyLabel('BracketRight', 'us'), ']');
  assert.equal(Core.keyLabel('KeyZ', 'us', { KeyZ: 'Y' }), 'Y'); // ドイツ語配列などは実際の文字を優先
  assert.equal(Core.guessLayout('BracketLeft', '@'), 'jis');
  assert.equal(Core.guessLayout('BracketLeft', '['), 'us');
  assert.equal(Core.guessLayout('BracketRight', '['), 'jis');
  assert.equal(Core.guessLayout('BracketRight', ']'), 'us');
  assert.equal(Core.guessLayout('Equal', '^'), 'jis');
  assert.equal(Core.guessLayout('KeyA', 'a'), null);
  assert.equal(Core.guessLayout('BracketLeft', 'ü'), null);
  // 割り当てのあるキーはすべて文字を持つ
  for (const layout of ['us', 'jis']) for (const c of Object.keys(Core.KEY_OFFSETS)) assert.ok(Core.keyLabel(c, layout), c);
});

test('鍵盤の範囲: 白鍵 8・15・22 本と黒鍵の数・位置', () => {
  for (const [whites, blacks] of [[8, 5], [15, 10], [22, 15], [29, 20]]) {
    const ks = Core.keyboardRange(48, whites);
    assert.equal(ks.filter((k) => !k.black).length, whites);
    assert.equal(ks.filter((k) => k.black).length, blacks);
    assert.equal(ks[0].midi, 48);
    assert.equal(ks[ks.length - 1].midi, 48 + ((whites - 1) / 7) * 12); // ドで終わる
    for (const k of ks.filter((x) => x.black)) {
      assert.ok(k.whiteIndex >= 0 && k.whiteIndex < whites - 1);
      const left = ks.find((x) => !x.black && x.whiteIndex === k.whiteIndex);
      assert.equal(k.midi, left.midi + 1); // 黒鍵は左の白鍵の半音上
    }
  }
  assert.equal(Core.clampStart(48, 15), 48);
  assert.equal(Core.clampStart(0, 15), 24); // C1 より下にしない
  assert.equal(Core.clampStart(120, 15), 84); // C6〜C8 が上限（C8 = 108）
  assert.equal(Core.clampStart(120, 8), 96);
  assert.equal(Core.clampStart(53, 15), 48); // ドにそろえる
});

test('音色の設計: 倍音はナイキストより下、低い音ほど長く響く', () => {
  let prevDecay = Infinity;
  for (let m = 21; m <= 108; m++) {
    const d = Core.voiceDesign(m);
    close(d.f, Core.frequency(m), 1e-9);
    assert.equal(d.partials[0], 0);
    assert.ok((d.partials.length - 1) * d.f <= 11000, `midi ${m}: ${d.partials.length - 1} 倍音`); // 22,050 Hz の半分より下
    assert.ok(d.partials[1] > 0);
    assert.ok(d.decay <= prevDecay);
    assert.ok(d.decay >= 0.4 && d.decay <= 6);
    assert.ok(d.cutoffStart > d.cutoffEnd);
    prevDecay = d.decay;
  }
});

test('設定の正規化（保存されていた値をそのまま信じない）', () => {
  assert.deepEqual(Core.normalizeSettings(null), Core.DEFAULTS);
  assert.deepEqual(Core.normalizeSettings('x'), Core.DEFAULTS);
  const s = Core.normalizeSettings({ names: 'cde', volume: 250, start: 61, layout: 'jis', bpm: 5 });
  assert.equal(s.names, 'cde');
  assert.equal(s.volume, 100);
  assert.equal(s.start, 60);
  assert.equal(s.layout, 'jis');
  assert.equal(s.bpm, 30);
  const t = Core.normalizeSettings({ names: '<b>', volume: 'abc', start: -100, layout: 'dvorak', bpm: 999 });
  assert.equal(t.names, 'doremi');
  assert.equal(t.volume, 70);
  assert.equal(t.start, 24);
  assert.equal(t.layout, '');
  assert.equal(t.bpm, 240);
});

test('ページの決まり: 弾く画面は AdSense の meta だけ、使い方ページは広告あり、共通ページへのリンク', () => {
  const play = read('piano/index.html');
  const guide = read('piano/guide.html');
  assert.equal((play.match(/google-adsense-account/g) || []).length, 1);
  assert.ok(!/adsbygoogle\.js/.test(play), '弾く画面に広告スクリプトを入れない');
  assert.equal((guide.match(/adsbygoogle\.js/g) || []).length, 1);
  for (const html of [play, guide]) {
    assert.ok(html.includes('../../about.html'));
    assert.ok(html.includes('../../privacy-policy.html'));
    assert.equal((html.match(/cloudflareinsights/g) || []).length, 1);
  }
  assert.ok(play.includes('<link rel="canonical" href="https://yorozu-craft.com/web-metronome/piano/">'));
  assert.ok(guide.includes('<link rel="canonical" href="https://yorozu-craft.com/web-metronome/piano/guide.html">'));
});

test('オフライン: sw.js がピアノのファイルを持ち、ファイルが存在する', () => {
  const sw = read('sw.js');
  for (const f of ['./piano/', './piano/index.html', './piano/piano.css', './piano/piano-core.js', './piano/synth.js', './piano/piano.js', './piano/guide.html']) {
    assert.ok(sw.includes(`'${f}'`), f);
    if (!f.endsWith('/')) assert.ok(fs.existsSync(path.join(ROOT, f)), f);
  }
  const sitemap = read('sitemap.xml');
  assert.ok(sitemap.includes('https://yorozu-craft.com/web-metronome/piano/</loc>'));
  assert.ok(sitemap.includes('https://yorozu-craft.com/web-metronome/piano/guide.html</loc>'));
});

test('保存のキーは web-metronome_ で始まる', () => {
  const js = read('piano/piano.js');
  const keys = [...js.matchAll(/STORAGE_KEY = '([^']+)'/g)].map((x) => x[1]);
  assert.deepEqual(keys, ['web-metronome_piano']);
});
