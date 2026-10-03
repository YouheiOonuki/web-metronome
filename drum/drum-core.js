/**
 * ドラムマシン - drum-core.js（画面と音に依存しない計算。node --test でも読む）
 *
 * - 1 小節のマス数 = 分子 × (全音符を何マスに割るか ÷ 分母)。16 分なら全音符 = 16 マス、3 連（8 分 3 連）なら 12、8 分なら 8
 *   例: 4/4・16 分 = 16 マス、7/8・16 分 = 14 マス、3/4・3 連 = 9 マス。割り切れない組み合わせ（7/8 の 3 連など）は作らない
 * - テンポは「何の音符を 1 拍と数えるか」（4 分・8 分・付点 4 分）と BPM で決める。1 マスの秒数 = 60 / BPM × (1 マスの長さ ÷ 1 拍の長さ)
 * - スイングは 50%（まっすぐ）〜 75%。2 マスを 1 組にし、後ろのマスを (スイング × 2 − 1) マス分だけ遅らせる（66.7% で 3 連の跳ね）
 * - MIDI ファイルは SMF フォーマット 0・分解能 480（4 分音符）。ドラムの音の番号は General MIDI の打楽器の割り当て（チャンネル 10）
 * - WAV は 16 bit のリニア PCM（RIFF）
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DrumCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** 音の種類。上から画面に並べる順。gm は General MIDI の打楽器の音の番号（チャンネル 10） */
  const TRACKS = [
    { id: 'crash', name: 'クラッシュ', short: 'CY', gm: 49 },
    { id: 'ohh', name: 'オープンHH', short: 'OH', gm: 46 },
    { id: 'chh', name: 'ハイハット', short: 'HH', gm: 42 },
    { id: 'htom', name: 'ハイタム', short: 'HT', gm: 50 },
    { id: 'ltom', name: 'ロータム', short: 'LT', gm: 45 },
    { id: 'clap', name: 'クラップ', short: 'CP', gm: 39 },
    { id: 'rim', name: 'リム', short: 'RS', gm: 37 },
    { id: 'snare', name: 'スネア', short: 'SD', gm: 38 },
    { id: 'kick', name: 'キック', short: 'BD', gm: 36 },
  ];
  const TRACK_IDS = TRACKS.map((t) => t.id);

  /** マスの細かさ: 全音符を何マスに割るか */
  const GRIDS = { e8: 8, s16: 16, t12: 12 };
  const GRID_NAMES = { e8: '8 分', s16: '16 分', t12: '3 連' };
  /** 1 拍と数える音符の長さ（全音符 = 1） */
  const TEMPO_UNITS = { q: 1 / 4, e: 1 / 8, dq: 3 / 8 };
  const TEMPO_UNIT_NAMES = { q: '♩（4 分）', e: '♪（8 分）', dq: '♩.（付点 4 分）' };
  const DENOMS = [2, 4, 8, 16];
  const MAX_STEPS = 128;
  const BPM_MIN = 20;
  const BPM_MAX = 300;
  /** 強・弱の音量（0〜1）と、MIDI のベロシティ */
  const LEVEL_GAIN = [0, 0.55, 1];
  const LEVEL_VELOCITY = [0, 70, 112];
  const PPQ = 480;

  const DEFAULTS = {
    num: 4, den: 4, grid: 's16', bars: 1, bpm: 100, unit: 'q', swing: 50,
    volume: 80, loops: 4, midiChannel: 10, pattern: null,
  };

  /** 1 小節のマス数。作れない組み合わせは 0 */
  function stepsPerBar(num, den, grid) {
    const per = GRIDS[grid];
    if (!per || !DENOMS.includes(den) || !(num >= 1 && num <= 16)) return 0;
    const s = (num * per) / den;
    return Number.isInteger(s) && s >= 1 ? s : 0;
  }

  /** 1 拍（分母の音符 1 つ）あたりのマス数。整数でなければ 0（3 連で /8 など） */
  function stepsPerBeat(den, grid) {
    const s = GRIDS[grid] / den;
    return Number.isInteger(s) ? s : 0;
  }

  function totalSteps(st) {
    return stepsPerBar(st.num, st.den, st.grid) * st.bars;
  }

  /** 1 マスの秒数 */
  function stepSeconds(bpm, unit, grid) {
    return (60 / bpm) * ((1 / GRIDS[grid]) / TEMPO_UNITS[unit]);
  }

  /** スイングが効くのは 8 分と 16 分だけ（3 連は 2 マスの組にならない） */
  function swingApplies(grid) {
    return grid === 'e8' || grid === 's16';
  }

  /** i 番目のマスが鳴る時刻（ループの頭から秒）。1 周の長さはスイングしても変わらない */
  function stepTimes(st) {
    const n = totalSteps(st);
    const sec = stepSeconds(st.bpm, st.unit, st.grid);
    const shift = swingApplies(st.grid) ? (st.swing / 100) * 2 - 1 : 0;
    const out = [];
    for (let i = 0; i < n; i++) out.push(i * sec + (i % 2 === 1 ? shift * sec : 0));
    return { times: out, loop: n * sec, step: sec };
  }

  function emptyPattern(n) {
    const p = {};
    for (const id of TRACK_IDS) p[id] = new Array(n).fill(0);
    return p;
  }

  /** マス数が変わったとき、前の模様を頭から写す（足りない分は空、余る分は捨てる） */
  function resizePattern(pattern, n) {
    const p = emptyPattern(n);
    if (!pattern) return p;
    for (const id of TRACK_IDS) {
      const src = Array.isArray(pattern[id]) ? pattern[id] : [];
      for (let i = 0; i < n && i < src.length; i++) p[id][i] = clampLevel(src[i]);
    }
    return p;
  }

  function clampLevel(v) {
    const x = Number(v);
    return x === 1 || x === 2 ? x : 0;
  }

  /** マスを押したとき: 空 → 強 → 弱 → 空 */
  function nextLevel(v) {
    return v === 0 ? 2 : v === 2 ? 1 : 0;
  }

  function clampInt(v, lo, hi, dflt) {
    const x = Math.round(Number(v));
    return Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : dflt;
  }

  /** 保存・共有・読み込みの値をそのまま信じずに直す */
  function normalizeState(raw) {
    const s = Object.assign({}, DEFAULTS);
    if (!raw || typeof raw !== 'object') {
      s.pattern = presetPattern('rock8', s) || emptyPattern(totalSteps(s));
      return s;
    }
    s.num = clampInt(raw.num, 1, 16, DEFAULTS.num);
    s.den = DENOMS.includes(Number(raw.den)) ? Number(raw.den) : DEFAULTS.den;
    s.grid = GRIDS[raw.grid] ? raw.grid : DEFAULTS.grid;
    s.bars = clampInt(raw.bars, 1, 4, DEFAULTS.bars);
    s.bpm = clampInt(raw.bpm, BPM_MIN, BPM_MAX, DEFAULTS.bpm);
    s.unit = TEMPO_UNITS[raw.unit] ? raw.unit : DEFAULTS.unit;
    s.swing = clampInt(raw.swing, 50, 75, DEFAULTS.swing);
    s.volume = clampInt(raw.volume, 0, 100, DEFAULTS.volume);
    s.loops = clampInt(raw.loops, 1, 32, DEFAULTS.loops);
    s.midiChannel = clampInt(raw.midiChannel, 1, 16, DEFAULTS.midiChannel);
    // 作れない拍子とマスの組み合わせは 16 分 → 8 分の順に直し、それでもだめなら 4/4 に戻す
    if (!stepsPerBar(s.num, s.den, s.grid)) s.grid = stepsPerBar(s.num, s.den, 's16') ? 's16' : 'e8';
    if (!stepsPerBar(s.num, s.den, s.grid)) { s.num = 4; s.den = 4; }
    while (s.bars > 1 && totalSteps(s) > MAX_STEPS) s.bars--;
    if (totalSteps(s) > MAX_STEPS) s.grid = 'e8';
    s.pattern = resizePattern(raw.pattern, totalSteps(s));
    return s;
  }

  // ---- 見本のパターン（よく使われる型を自作で書いたもの。x = 強、o = 弱、. = 空） ----
  const PRESETS = [
    { id: 'rock8', name: '8 ビート（4/4）', num: 4, den: 4, grid: 's16', bpm: 100, swing: 50,
      rows: { chh: 'x.o.x.o.x.o.x.o.', snare: '....x.......x...', kick: 'x.......x.x.....' } },
    { id: 'beat16', name: '16 ビート（4/4）', num: 4, den: 4, grid: 's16', bpm: 90, swing: 50,
      rows: { chh: 'xoooxoooxoooxooo', snare: '....x..o....x...', kick: 'x..x..x...x..x..' } },
    { id: 'four', name: '4 つ打ち（4/4）', num: 4, den: 4, grid: 's16', bpm: 124, swing: 50,
      rows: { ohh: '..x...x...x...x.', clap: '....x.......x...', kick: 'x...x...x...x...' } },
    { id: 'shuffle', name: 'シャッフル（4/4・3 連）', num: 4, den: 4, grid: 't12', bpm: 96, swing: 50,
      rows: { chh: 'x.ox.ox.ox.o', snare: '...x.....x..', kick: 'x.....x.o...' } },
    { id: 'waltz', name: 'ワルツ（3/4）', num: 3, den: 4, grid: 'e8', bpm: 120, swing: 50,
      rows: { chh: '..x.x.', snare: '..o.o.', kick: 'x.....' } },
    { id: 'six8', name: '6/8', num: 6, den: 8, grid: 'e8', bpm: 120, unit: 'e', swing: 50,
      rows: { chh: 'xooxoo', snare: '...x..', kick: 'x.....' } },
    { id: 'five4', name: '5/4（3+2）', num: 5, den: 4, grid: 'e8', bpm: 140, swing: 50,
      rows: { chh: 'xoxoxoxoxo', snare: '..x...x.x.', kick: 'x...x.x...' } },
    { id: 'seven8', name: '7/8（2+2+3）', num: 7, den: 8, grid: 'e8', bpm: 220, unit: 'e', swing: 50,
      rows: { chh: 'xoxoxoo', snare: '..x..x.', kick: 'x...x..' } },
  ];

  function patternFromRows(rows, n) {
    const p = emptyPattern(n);
    for (const id of Object.keys(rows || {})) {
      if (!p[id]) continue;
      const s = rows[id];
      for (let i = 0; i < n && i < s.length; i++) p[id][i] = s[i] === 'x' ? 2 : s[i] === 'o' ? 1 : 0;
    }
    return p;
  }

  function presetPattern(id, st) {
    const pr = PRESETS.find((p) => p.id === id);
    if (!pr) return null;
    const one = stepsPerBar(pr.num, pr.den, pr.grid);
    const base = patternFromRows(pr.rows, one);
    const bars = st && st.bars ? st.bars : 1;
    const p = emptyPattern(one * bars);
    for (const tid of TRACK_IDS) for (let b = 0; b < bars; b++) for (let i = 0; i < one; i++) p[tid][b * one + i] = base[tid][i];
    return p;
  }

  /** 見本を読み込んだ状態（小節数・音量・MIDI の設定は今のまま） */
  function applyPreset(st, id) {
    const pr = PRESETS.find((p) => p.id === id);
    if (!pr) return st;
    const s = Object.assign({}, st, { num: pr.num, den: pr.den, grid: pr.grid, bpm: pr.bpm, unit: pr.unit || 'q', swing: pr.swing });
    while (s.bars > 1 && totalSteps(s) > MAX_STEPS) s.bars--;
    s.pattern = presetPattern(id, s);
    return s;
  }

  // ---- 共有リンク（#p=。名前などの個人の情報は入らない。パターンと設定だけ） ----
  function encodeShare(st) {
    const head = ['1', st.num, st.den, st.grid, st.bars, st.bpm, st.unit, st.swing].join('-');
    const rows = TRACK_IDS.map((id) => {
      const a = st.pattern[id];
      return a.some((v) => v) ? id + ':' + a.join('').replace(/0+$/, '') : '';
    }).filter(Boolean);
    return head + '~' + rows.join('~');
  }

  function decodeShare(str) {
    if (typeof str !== 'string' || str.length > 2000) return null;
    const parts = str.split('~');
    const h = parts[0].split('-');
    if (h[0] !== '1' || h.length !== 8) return null;
    const raw = { num: h[1], den: h[2], grid: h[3], bars: h[4], bpm: h[5], unit: h[6], swing: h[7], pattern: {} };
    for (const r of parts.slice(1)) {
      const m = /^([a-z]+):([012]*)$/.exec(r);
      if (!m || !TRACK_IDS.includes(m[1])) continue;
      raw.pattern[m[1]] = m[2].split('').map(Number);
    }
    return normalizeState(raw);
  }

  // ---- 書き出し: Standard MIDI File（フォーマット 0） ----
  function vlq(n) {
    const bytes = [n & 0x7f];
    n >>= 7;
    while (n > 0) { bytes.unshift((n & 0x7f) | 0x80); n >>= 7; }
    return bytes;
  }

  /** 1 マスの長さ（ティック）。分解能 480 なら 16 分 = 120、3 連 = 160、8 分 = 240 */
  function ticksPerStep(grid) {
    return (PPQ * 4) / GRIDS[grid];
  }

  /** 4 分音符 1 つのマイクロ秒（SMF のテンポは 4 分音符で書く） */
  function microsPerQuarter(bpm, unit) {
    return Math.round((60e6 / bpm) * ((1 / 4) / TEMPO_UNITS[unit]));
  }

  /** パターンを loops 回くり返した MIDI ファイル（Uint8Array） */
  function buildMidi(st, loops) {
    const n = totalSteps(st);
    const tps = ticksPerStep(st.grid);
    const shift = swingApplies(st.grid) ? Math.round(((st.swing / 100) * 2 - 1) * tps) : 0;
    const ch = (st.midiChannel - 1) & 0x0f;
    const len = Math.max(1, Math.floor(tps / 2));
    const events = []; // { tick, order, bytes }
    for (let l = 0; l < loops; l++) {
      for (let i = 0; i < n; i++) {
        const t0 = (l * n + i) * tps + (i % 2 === 1 ? shift : 0);
        for (const tr of TRACKS) {
          const v = st.pattern[tr.id][i];
          if (!v) continue;
          events.push({ tick: t0, order: 1, bytes: [0x90 | ch, tr.gm, LEVEL_VELOCITY[v]] });
          events.push({ tick: t0 + len, order: 0, bytes: [0x80 | ch, tr.gm, 64] });
        }
      }
    }
    events.sort((a, b) => a.tick - b.tick || a.order - b.order);
    const us = microsPerQuarter(st.bpm, st.unit);
    const dd = Math.round(Math.log2(st.den));
    const body = [];
    body.push(0, 0xff, 0x51, 0x03, (us >> 16) & 0xff, (us >> 8) & 0xff, us & 0xff);
    body.push(0, 0xff, 0x58, 0x04, st.num, dd, 24, 8);
    let last = 0;
    for (const e of events) {
      body.push(...vlq(e.tick - last), ...e.bytes);
      last = e.tick;
    }
    const end = loops * n * tps;
    body.push(...vlq(Math.max(0, end - last)), 0xff, 0x2f, 0x00);
    const head = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, (PPQ >> 8) & 0xff, PPQ & 0xff];
    const L = body.length;
    const trk = [0x4d, 0x54, 0x72, 0x6b, (L >>> 24) & 0xff, (L >>> 16) & 0xff, (L >>> 8) & 0xff, L & 0xff];
    return Uint8Array.from([...head, ...trk, ...body]);
  }

  // ---- 書き出し: WAV（16 bit・リニア PCM） ----
  function encodeWav(channels, sampleRate) {
    const nCh = channels.length;
    const n = channels[0].length;
    const dataLen = n * nCh * 2;
    const buf = new ArrayBuffer(44 + dataLen);
    const v = new DataView(buf);
    const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); v.setUint32(4, 36 + dataLen, true); str(8, 'WAVE');
    str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, nCh, true);
    v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * nCh * 2, true);
    v.setUint16(32, nCh * 2, true); v.setUint16(34, 16, true);
    str(36, 'data'); v.setUint32(40, dataLen, true);
    let o = 44;
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < nCh; c++) {
        const x = Math.max(-1, Math.min(1, channels[c][i]));
        v.setInt16(o, x < 0 ? Math.round(x * 0x8000) : Math.round(x * 0x7fff), true);
        o += 2;
      }
    }
    return new Uint8Array(buf);
  }

  /** 画面の拍子の表示（例: 7/8・16 分・14 マス） */
  function meterLabel(st) {
    return `${st.num}/${st.den}・${GRID_NAMES[st.grid]}・${totalSteps(st)} マス`;
  }

  /** 狭い画面で 1 段に並べるマス数（拍の切れ目で折り返す） */
  function rowChunk(st, columns) {
    const one = stepsPerBar(st.num, st.den, st.grid);
    if (columns >= one) return one;
    const beat = stepsPerBeat(st.den, st.grid) || 1;
    if (beat > columns) return Math.max(1, columns);
    return Math.max(beat, Math.floor(columns / beat) * beat);
  }

  return {
    TRACKS, TRACK_IDS, GRIDS, GRID_NAMES, TEMPO_UNITS, TEMPO_UNIT_NAMES, DENOMS, MAX_STEPS, BPM_MIN, BPM_MAX,
    LEVEL_GAIN, LEVEL_VELOCITY, PPQ, DEFAULTS, PRESETS,
    stepsPerBar, stepsPerBeat, totalSteps, stepSeconds, swingApplies, stepTimes, emptyPattern, resizePattern,
    nextLevel, normalizeState, presetPattern, applyPreset, encodeShare, decodeShare,
    vlq, ticksPerStep, microsPerQuarter, buildMidi, encodeWav, meterLabel, rowChunk,
  };
});
