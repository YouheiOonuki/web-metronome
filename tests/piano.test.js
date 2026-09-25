'use strict';
// ブラウザピアノ（piano/）のテスト: 音の高さ・キーの割り当て・鍵盤の範囲・音色・MIDI の読み方・設定の正規化・ページの決まり
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

test('音色: 6 種の設計がどの音域でも正しい範囲（倍音・音量の形・1 音の大きさ）', () => {
  const ids = Core.TIMBRES.map((t) => t.id);
  assert.deepEqual(ids, ['piano', 'epiano', 'organ', 'musicbox', 'synth', 'strings']);
  assert.equal(new Set(Core.TIMBRES.map((t) => t.name)).size, 6);
  const pianoPeak = Core.voiceDesign(60, 'piano').level * Core.voiceDesign(60, 'piano').detune.length; // 0.32 × 2
  for (const id of ids) {
    for (let m = 21; m <= 108; m++) {
      const d = Core.voiceDesign(m, id);
      const at = `${id} ${m}`;
      close(d.f, Core.frequency(m), 1e-9);
      assert.equal(d.partials[0], 0, at);
      assert.ok(d.partials[1] > 0, at);
      assert.ok(d.partials.every((x) => x >= 0 && Number.isFinite(x)), at);
      assert.ok((d.partials.length - 1) * d.f <= 11000 || d.partials.length === 2, `${at}: ${d.partials.length - 1} 倍音`);
      assert.ok(d.detune.length >= 1 && d.detune.length <= 2, at); // 発振器は 1 音に 2 つまで（CPU）
      assert.ok(d.attack > 0 && d.attack <= 0.2, at);
      assert.ok(d.t2 >= d.attack, at);
      assert.ok(d.mid > 0 && d.mid <= 1, at);
      assert.ok(d.sustain >= 0 && d.sustain <= d.mid, at);
      assert.ok(d.tau1 > 0 && d.tau2 > 0 && d.release > 0 && d.release <= 0.5, at);
      assert.ok(d.cutoffStart >= d.cutoffEnd && d.cutoffEnd > d.f, at);
      assert.ok(d.cutoffStart <= 16000, at);
      assert.ok(d.noise >= 0 && d.noise <= 0.06, at);
      // 1 音の最大はピアノ（今までの音）を超えない（和音で割れないように。実際の出力は書き出して確かめた）
      assert.ok(d.level * d.detune.length <= pianoPeak + 1e-9, `${at}: ${d.level * d.detune.length}`);
      // 自然に消える音色は減衰の時定数を持つ。押している間鳴る音色は離すと消える
      if (d.sustain === 0) assert.ok(Number.isFinite(d.tau2) && d.tau2 <= 6, at);
    }
  }
  assert.deepEqual(Core.voiceDesign(60, 'x'), Core.voiceDesign(60, 'piano')); // 知らない値はピアノ
  assert.deepEqual(Core.voiceDesign(60), Core.voiceDesign(60, 'piano'));
  // 押している間鳴り続けるのはオルガン・シンセ・ストリングス風
  assert.deepEqual(ids.filter((id) => Core.voiceDesign(60, id).sustain > 0), ['organ', 'synth', 'strings']);
  // ストリングス風はゆっくり立ち上がる、オルゴールは離しても少し残る
  assert.ok(Core.voiceDesign(60, 'strings').attack >= 0.1);
  assert.ok(Core.voiceDesign(60, 'musicbox').release > Core.voiceDesign(60, 'piano').release);
});

test('音色: ピアノは今までと同じ数字（C4・A0・C8）', () => {
  const c4 = Core.voiceDesign(60, 'piano');
  assert.equal(c4.partials.length, 11);
  close(c4.partials[1], 0.41719, 1e-5);
  close(c4.partials[7], 0.012869, 1e-5);
  close(c4.decay, 2.40003, 1e-4);
  close(c4.cutoffStart, 5162.758, 1e-3);
  close(c4.cutoffEnd, 1184.877, 1e-3);
  assert.deepEqual([c4.level, c4.mid, c4.t2, c4.release, c4.noise, c4.attack], [0.32, 0.4, 0.3, 0.08, 0.06, 0.004]);
  assert.deepEqual(c4.detune, [-1.5, 1.5]);
  assert.equal(Core.voiceDesign(21, 'piano').decay, 6);
  assert.equal(Core.voiceDesign(108, 'piano').partials.length, 3); // 4186Hz × 2 = 8372Hz ≤ 10,000Hz
});

test('MIDI: ベロシティ → 音の大きさ（127 で画面の鍵盤と同じ 0.8、弱いほど小さい）', () => {
  assert.equal(Core.velocityLevel(127), 0.8);
  assert.ok(Core.velocityLevel(1) > 0 && Core.velocityLevel(1) < 0.1);
  let prev = 0;
  for (let v = 1; v <= 127; v++) {
    const x = Core.velocityLevel(v);
    assert.ok(x > prev && x <= 0.8, String(v));
    prev = x;
  }
  assert.equal(Core.velocityLevel(200), 0.8);
  assert.equal(Core.velocityLevel('abc'), Core.velocityLevel(0));
});

test('MIDI: メッセージの読み方（ノートオン・オフ、ベロシティ 0、CC64、チャンネル）', () => {
  const P = Core.parseMidiMessage;
  assert.deepEqual(P([0x90, 60, 100]), { type: 'on', note: 60, velocity: 100, channel: 1 });
  assert.deepEqual(P(new Uint8Array([0x9f, 21, 1])), { type: 'on', note: 21, velocity: 1, channel: 16 });
  // ノートオンでベロシティ 0 はノートオフ（多くのキーボードはこちらで離鍵を送る）
  assert.deepEqual(P([0x90, 60, 0]), { type: 'off', note: 60, channel: 1 });
  assert.deepEqual(P([0x80, 60, 64]), { type: 'off', note: 60, channel: 1 });
  assert.deepEqual(P([0x8a, 108, 0]), { type: 'off', note: 108, channel: 11 });
  // ダンパーペダル（CC64）: 64 以上でオン
  assert.deepEqual(P([0xb0, 64, 127]), { type: 'sustain', on: true, channel: 1 });
  assert.deepEqual(P([0xb0, 64, 64]), { type: 'sustain', on: true, channel: 1 });
  assert.deepEqual(P([0xb3, 64, 63]), { type: 'sustain', on: false, channel: 4 });
  assert.deepEqual(P([0xb0, 64, 0]), { type: 'sustain', on: false, channel: 1 });
  assert.deepEqual(P([0xb0, 123, 0]), { type: 'allOff', channel: 1 });
  assert.deepEqual(P([0xb9, 120, 0]), { type: 'allOff', channel: 10 });
  // 使わないもの: ほかの CC（モジュレーション）、ピッチベンド、プログラムチェンジ、アフタータッチ
  assert.equal(P([0xb0, 1, 64]), null);
  assert.equal(P([0xe0, 0, 64]), null);
  assert.equal(P([0xc0, 5]), null);
  assert.equal(P([0xd0, 40]), null);
  assert.equal(P([0xa0, 60, 40]), null);
  // システムメッセージ（クロック・アクティブセンシング・sysex）は無視
  assert.equal(P([0xf8]), null);
  assert.equal(P([0xfe]), null);
  assert.equal(P([0xf0, 0x7e, 0x7f, 0xf7]), null);
  // 壊れたもの
  assert.equal(P([]), null);
  assert.equal(P(null), null);
  assert.equal(P([0x90, 60]), null);
  assert.equal(P([0x90, 128, 10]), null);
  assert.equal(P([0x90, 60, 200]), null);
  assert.equal(P([0x3c, 100]), null); // データのバイトから始まる
  // 16 チャンネルすべてを受ける（チャンネルは 1〜16 で返す）
  for (let ch = 0; ch < 16; ch++) assert.equal(P([0x90 | ch, 60, 80]).channel, ch + 1);
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
  assert.equal(t.timbre, 'piano');
  assert.equal(Core.normalizeSettings({ timbre: 'organ' }).timbre, 'organ');
  assert.equal(Core.normalizeSettings({ timbre: '__proto__' }).timbre, 'piano');
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

test('MIDI: 許可はボタンを押したときだけ求め、sysex は使わず、何も送らない', () => {
  const js = read('piano/piano.js');
  const calls = [...js.matchAll(/navigator\.requestMIDIAccess\(/g)];
  assert.equal(calls.length, 1);
  assert.ok(calls[0].index > js.indexOf("midiBtn.addEventListener('click'"), 'ボタンを押したときの中で呼ぶ');
  assert.ok(js.includes('requestMIDIAccess({ sysex: false })'));
  assert.ok(!/sysex:\s*true/.test(js));
  for (const f of ['piano/piano.js', 'piano/synth.js', 'piano/piano-core.js']) {
    const src = read(f);
    assert.ok(!/\bfetch\(|XMLHttpRequest|sendBeacon|WebSocket|\.send\(/.test(src), f + ' は外部に送らない');
  }
  // 対応していないブラウザの案内と、ボタン・状態の欄がある
  assert.ok(js.includes('Safari・iPhone・iPad は非対応'));
  const html = read('piano/index.html');
  assert.ok(html.includes('id="midiBtn"') && html.includes('MIDI キーボードをつなぐ'));
  assert.ok(/<details class="more"[\s\S]*id="timbreList"[\s\S]*id="midiStatus"[\s\S]*<\/details>/.test(html));
});

test('保存のキーは web-metronome_ で始まる', () => {
  const js = read('piano/piano.js');
  const keys = [...js.matchAll(/STORAGE_KEY = '([^']+)'/g)].map((x) => x[1]);
  assert.deepEqual(keys, ['web-metronome_piano']);
});
