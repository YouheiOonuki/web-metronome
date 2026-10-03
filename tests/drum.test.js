'use strict';
// ドラムマシン（drum/）のテスト: マス数・時刻・スイング・正規化・見本・共有リンク・MIDI ファイル・WAV・ページの決まり
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Core = require('../drum/drum-core.js');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

test('1 小節のマス数: 拍子 × マスの細かさ。割り切れない組み合わせは 0', () => {
  assert.equal(Core.stepsPerBar(4, 4, 's16'), 16);
  assert.equal(Core.stepsPerBar(7, 8, 's16'), 14);
  assert.equal(Core.stepsPerBar(7, 8, 'e8'), 7);
  assert.equal(Core.stepsPerBar(5, 4, 'e8'), 10);
  assert.equal(Core.stepsPerBar(3, 4, 't12'), 9);
  assert.equal(Core.stepsPerBar(4, 4, 't12'), 12);
  assert.equal(Core.stepsPerBar(6, 8, 't12'), 9); // 6/8 の 3 連 = 付点 4 分を 3 つ割り…ではなく 8 分 3 連 9 個（6×12/8）
  assert.equal(Core.stepsPerBar(7, 8, 't12'), 0); // 10.5 マスは作らない
  assert.equal(Core.stepsPerBar(15, 16, 'e8'), 0);
  assert.equal(Core.stepsPerBar(0, 4, 's16'), 0);
  assert.equal(Core.stepsPerBar(17, 4, 's16'), 0);
  assert.equal(Core.stepsPerBar(4, 3, 's16'), 0);
});

test('1 マスの秒数: BPM とテンポの基準', () => {
  close(Core.stepSeconds(120, 'q', 's16'), 0.125); // ♩=120 の 16 分 = 0.125 秒
  close(Core.stepSeconds(60, 'q', 'e8'), 0.5);
  close(Core.stepSeconds(120, 'e', 'e8'), 0.5); // ♪=120 の 8 分 = 0.5 秒
  close(Core.stepSeconds(60, 'dq', 'e8'), 1 / 3); // ♩.=60 の 8 分 = 1/3 秒
  close(Core.stepSeconds(90, 'q', 't12'), (60 / 90) / 3); // 8 分 3 連 = 4 分の 1/3
});

test('時刻: スイング 50% はまっすぐ、66.7% で 3 連の跳ね、1 周の長さは変わらない', () => {
  const base = { num: 4, den: 4, grid: 's16', bars: 1, bpm: 120, unit: 'q', swing: 50 };
  const a = Core.stepTimes(base);
  assert.equal(a.times.length, 16);
  close(a.loop, 2);
  close(a.times[1], 0.125);
  const b = Core.stepTimes(Object.assign({}, base, { swing: 200 / 3 }));
  close(b.times[1], 0.125 + 0.125 / 3);
  close(b.times[2], 0.25);
  close(b.loop, 2);
  const c = Core.stepTimes(Object.assign({}, base, { grid: 't12', swing: 75 })); // 3 連にはスイングを掛けない
  close(c.times[1], (0.5 / 3));
});

test('正規化: 範囲外を直し、作れない組み合わせは作れるものへ', () => {
  const d = Core.normalizeState(null);
  assert.equal(Core.totalSteps(d), 16);
  assert.equal(d.pattern.kick[0], 2); // 初めは 8 ビートの見本
  const s = Core.normalizeState({ num: 7, den: 8, grid: 't12', bars: 9, bpm: 999, unit: 'zz', swing: 10, volume: -3, loops: 0, midiChannel: 22, pattern: { kick: [2, 1, 7, 'x'], bogus: [1] } });
  assert.equal(s.grid, 's16');
  assert.equal(s.bars, 4);
  assert.equal(s.bpm, 300);
  assert.equal(s.unit, 'q');
  assert.equal(s.swing, 50);
  assert.equal(s.volume, 0);
  assert.equal(s.loops, 1);
  assert.equal(s.midiChannel, 16);
  assert.deepEqual(s.pattern.kick.slice(0, 4), [2, 1, 0, 0]);
  assert.equal(s.pattern.kick.length, 56);
  assert.equal(s.pattern.bogus, undefined);
  const big = Core.normalizeState({ num: 16, den: 4, grid: 's16', bars: 4 });
  assert.ok(Core.totalSteps(big) <= Core.MAX_STEPS);
});

test('マスを押す順: 空 → 強 → 弱 → 空', () => {
  assert.equal(Core.nextLevel(0), 2);
  assert.equal(Core.nextLevel(2), 1);
  assert.equal(Core.nextLevel(1), 0);
});

test('見本: すべて作れる拍子で、行の長さが 1 小節のマス数と同じ', () => {
  for (const p of Core.PRESETS) {
    const n = Core.stepsPerBar(p.num, p.den, p.grid);
    assert.ok(n > 0, p.id);
    for (const [id, row] of Object.entries(p.rows)) {
      assert.ok(Core.TRACK_IDS.includes(id), p.id + ' ' + id);
      assert.equal(row.length, n, p.id + ' ' + id);
    }
    const s = Core.applyPreset(Core.normalizeState(null), p.id);
    assert.equal(Core.totalSteps(s), n);
  }
  const two = Core.applyPreset(Object.assign(Core.normalizeState(null), { bars: 2 }), 'seven8');
  assert.equal(two.pattern.kick.length, 14);
  assert.deepEqual(two.pattern.kick.slice(0, 7), two.pattern.kick.slice(7));
});

test('共有リンク: 書いて読むと同じ打ち込みと設定に戻る。壊れた文字列は読まない', () => {
  const s = Core.applyPreset(Core.normalizeState(null), 'seven8');
  s.swing = 60; s.bars = 1;
  const enc = Core.encodeShare(s);
  assert.ok(!/[^0-9a-z:~\-]/i.test(enc), enc);
  const d = Core.decodeShare(enc);
  for (const k of ['num', 'den', 'grid', 'bars', 'bpm', 'unit', 'swing']) assert.equal(d[k], s[k], k);
  assert.deepEqual(d.pattern, s.pattern);
  assert.equal(Core.decodeShare('2-4-4'), null);
  assert.equal(Core.decodeShare('x'.repeat(3000)), null);
  assert.equal(Core.decodeShare(null), null);
});

test('MIDI: 可変長の数（SMF の例）', () => {
  assert.deepEqual(Core.vlq(0), [0x00]);
  assert.deepEqual(Core.vlq(0x40), [0x40]);
  assert.deepEqual(Core.vlq(0x7f), [0x7f]);
  assert.deepEqual(Core.vlq(0x80), [0x81, 0x00]);
  assert.deepEqual(Core.vlq(0x2000), [0xc0, 0x00]);
  assert.deepEqual(Core.vlq(0x3fff), [0xff, 0x7f]);
  assert.deepEqual(Core.vlq(0x4000), [0x81, 0x80, 0x00]);
  assert.deepEqual(Core.vlq(0x0fffffff), [0xff, 0xff, 0xff, 0x7f]);
});

/** SMF を読み直す（テスト用の小さな読み手） */
function parseMidi(b) {
  const str = (o, n) => String.fromCharCode(...b.slice(o, o + n));
  assert.equal(str(0, 4), 'MThd');
  const fmt = (b[8] << 8) | b[9];
  const ntrk = (b[10] << 8) | b[11];
  const ppq = (b[12] << 8) | b[13];
  assert.equal(str(14, 4), 'MTrk');
  const len = (b[18] << 24) | (b[19] << 16) | (b[20] << 8) | b[21];
  assert.equal(22 + len, b.length);
  let o = 22, tick = 0;
  const ev = [];
  while (o < b.length) {
    let d = 0, x;
    do { x = b[o++]; d = (d << 7) | (x & 0x7f); } while (x & 0x80);
    tick += d;
    const s = b[o];
    if (s === 0xff) { const type = b[o + 1]; const l = b[o + 2]; ev.push({ tick, meta: type, data: [...b.slice(o + 3, o + 3 + l)] }); o += 3 + l; }
    else { ev.push({ tick, status: s, note: b[o + 1], vel: b[o + 2] }); o += 3; }
  }
  return { fmt, ntrk, ppq, ev };
}

test('MIDI ファイル: 8 ビート ♩=120・4/4・1 回（チャンネル 10・GM の音の番号）', () => {
  const s = Core.normalizeState(null);
  s.bpm = 120;
  const m = parseMidi(Core.buildMidi(s, 1));
  assert.equal(m.fmt, 0);
  assert.equal(m.ntrk, 1);
  assert.equal(m.ppq, 480);
  const tempo = m.ev.find((e) => e.meta === 0x51);
  assert.deepEqual(tempo.data, [0x07, 0xa1, 0x20]); // 500,000 µs = ♩=120
  const ts = m.ev.find((e) => e.meta === 0x58);
  assert.deepEqual(ts.data, [4, 2, 24, 8]);
  const ons = m.ev.filter((e) => e.status === 0x99);
  const kicks = ons.filter((e) => e.note === 36).map((e) => e.tick);
  assert.deepEqual(kicks, [0, 960, 1200]); // 1 拍目・3 拍目・3 拍目の 8 分裏
  const snares = ons.filter((e) => e.note === 38).map((e) => e.tick);
  assert.deepEqual(snares, [480, 1440]);
  assert.equal(ons.filter((e) => e.note === 42).length, 8);
  assert.equal(ons.find((e) => e.note === 42 && e.tick === 0).vel, 112);
  assert.equal(ons.find((e) => e.note === 42 && e.tick === 240).vel, 70);
  assert.equal(m.ev.filter((e) => e.status === 0x89).length, ons.length);
  const end = m.ev[m.ev.length - 1];
  assert.equal(end.meta, 0x2f);
  assert.equal(end.tick, 1920);
});

test('MIDI ファイル: 7/8・♪=220 のテンポ、チャンネルの変更、くり返し', () => {
  const s = Core.applyPreset(Core.normalizeState(null), 'seven8');
  s.midiChannel = 1;
  const m = parseMidi(Core.buildMidi(s, 3));
  const us = Math.round((60e6 / 220) * 2); // ♪=220 → ♩=110
  const tempo = m.ev.find((e) => e.meta === 0x51).data;
  assert.equal((tempo[0] << 16) | (tempo[1] << 8) | tempo[2], us);
  assert.deepEqual(m.ev.find((e) => e.meta === 0x58).data, [7, 3, 24, 8]);
  assert.ok(m.ev.filter((e) => e.status !== undefined).every((e) => (e.status & 0x0f) === 0));
  const kicks = m.ev.filter((e) => e.status === 0x90 && e.note === 36).map((e) => e.tick);
  assert.deepEqual(kicks, [0, 960, 1680, 2640, 3360, 4320]); // 7 マス × 240 = 1680 ごと
  assert.equal(m.ev[m.ev.length - 1].tick, 3 * 1680);
});

test('MIDI ファイル: スイングは後ろのマスをずらす', () => {
  const s = Core.normalizeState(null);
  s.swing = 75; s.bpm = 120;
  const m = parseMidi(Core.buildMidi(s, 1));
  const hh = m.ev.filter((e) => e.status === 0x99 && e.note === 42).map((e) => e.tick);
  assert.equal(hh[1], 240); // 3 マス目（偶数）はずらさない
  const s2 = Core.normalizeState({ pattern: { chh: [0, 2] }, swing: 75 });
  const m2 = parseMidi(Core.buildMidi(s2, 1));
  assert.equal(m2.ev.find((e) => e.status === 0x99).tick, 120 + 60);
});

test('WAV: RIFF の頭と 16 bit の値', () => {
  const w = Core.encodeWav([Float32Array.from([0, 1, -1, 0.5, 2])], 44100);
  const v = new DataView(w.buffer);
  const str = (o) => String.fromCharCode(w[o], w[o + 1], w[o + 2], w[o + 3]);
  assert.equal(str(0), 'RIFF');
  assert.equal(v.getUint32(4, true), 36 + 10);
  assert.equal(str(8), 'WAVE');
  assert.equal(str(12), 'fmt ');
  assert.equal(v.getUint16(20, true), 1);
  assert.equal(v.getUint16(22, true), 1);
  assert.equal(v.getUint32(24, true), 44100);
  assert.equal(v.getUint32(28, true), 88200);
  assert.equal(v.getUint16(34, true), 16);
  assert.equal(str(36), 'data');
  assert.equal(v.getUint32(40, true), 10);
  assert.deepEqual([0, 1, 2, 3, 4].map((i) => v.getInt16(44 + i * 2, true)), [0, 32767, -32768, 16384, 32767]);
});

test('狭い画面の折り返し: 拍の切れ目で割る', () => {
  const s = Core.normalizeState(null);
  assert.equal(Core.rowChunk(s, 8), 8);
  assert.equal(Core.rowChunk(s, 7), 4);
  assert.equal(Core.rowChunk(s, 20), 16);
  const s7 = Core.normalizeState({ num: 7, den: 8, grid: 's16' });
  assert.equal(Core.rowChunk(s7, 8), 8);
  assert.equal(Core.rowChunk(s7, 20), 14);
  const t = Core.normalizeState({ num: 4, den: 4, grid: 't12' });
  assert.equal(Core.rowChunk(t, 8), 6);
});

test('GM の音の番号（General MIDI Level 1 の打楽器の割り当て）', () => {
  const gm = Object.fromEntries(Core.TRACKS.map((t) => [t.id, t.gm]));
  assert.deepEqual(gm, { crash: 49, ohh: 46, chh: 42, htom: 50, ltom: 45, clap: 39, rim: 37, snare: 38, kick: 36 });
});

test('ページの決まり: 打ち込む画面は広告の script なし・使い方は自動広告・切り替えに 3 つ', () => {
  const idx = read('drum/index.html');
  assert.ok(idx.includes('name="google-adsense-account"'));
  assert.ok(!idx.includes('adsbygoogle.js'));
  assert.ok(idx.includes('rel="canonical" href="https://yorozu-craft.com/web-metronome/drum/"'));
  assert.ok(idx.includes('data-reset-storage="web-metronome_drum"'));
  assert.ok(idx.includes('static.cloudflareinsights.com'));
  const g = read('drum/guide.html');
  assert.ok(g.includes('adsbygoogle.js'));
  assert.ok(g.includes('entry.585564634=web-metronome'));
  for (const f of ['index.html', 'piano/index.html', 'drum/index.html']) {
    const h = read(f);
    const nav = /<nav class="mode-switch"[\s\S]*?<\/nav>/.exec(h)[0];
    assert.equal((nav.match(/<a /g) || []).length, 3, f);
    assert.equal((nav.match(/aria-current="page"/g) || []).length, 1, f);
  }
  const sw = read('sw.js');
  for (const p of ['./drum/', './drum/drum-core.js', './drum/drum-synth.js', './drum/drum.js', './drum/drum.css', './drum/guide.html']) assert.ok(sw.includes(`'${p}'`), p);
  assert.ok(read('sitemap.xml').includes('https://yorozu-craft.com/web-metronome/drum/'));
  assert.ok(!/localStorage\.(setItem|getItem)\(\s*['"](?!web-metronome_)/.test(read('drum/drum.js')));
});
