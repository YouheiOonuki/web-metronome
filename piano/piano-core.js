/**
 * ブラウザピアノ - piano-core.js（画面と音に依存しない計算。node --test でも読む）
 *
 * - 音の高さは MIDI ノート番号で持つ（60 = 真ん中のド = C4、69 = ラ = A4）
 * - 周波数は A4 = 440 Hz の 12 平均律: f = 440 × 2^((n − 69) / 12)
 * - パソコンのキーは KeyboardEvent.code（キーの物理的な位置）で割り当てる。
 *   code は配列（US・JIS など）や入力モードで変わらないので、JIS キーボードでも US キーボードでも同じ位置のキーが同じ音になる。
 *   キーに印字された文字（画面に出すラベル）だけが配列で違う → keyLabel()
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PianoCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const A4_MIDI = 69;
  const A4_HZ = 440;

  /** MIDI ノート番号 → 周波数（Hz）。A4 = 440 Hz の 12 平均律 */
  function frequency(midi, a4 = A4_HZ) {
    return a4 * Math.pow(2, (midi - A4_MIDI) / 12);
  }

  /** 12 音の並び（0 = C） */
  const PITCH_CLASS = [
    { cde: 'C', doremi: 'ド', black: false },
    { cde: 'C♯', doremi: 'ド♯', black: true },
    { cde: 'D', doremi: 'レ', black: false },
    { cde: 'D♯', doremi: 'レ♯', black: true },
    { cde: 'E', doremi: 'ミ', black: false },
    { cde: 'F', doremi: 'ファ', black: false },
    { cde: 'F♯', doremi: 'ファ♯', black: true },
    { cde: 'G', doremi: 'ソ', black: false },
    { cde: 'G♯', doremi: 'ソ♯', black: true },
    { cde: 'A', doremi: 'ラ', black: false },
    { cde: 'A♯', doremi: 'ラ♯', black: true },
    { cde: 'B', doremi: 'シ', black: false },
  ];

  const pitchClass = (midi) => ((midi % 12) + 12) % 12;
  /** オクターブ番号（国際式。60 = C4） */
  const octaveOf = (midi) => Math.floor(midi / 12) - 1;
  const isBlack = (midi) => PITCH_CLASS[pitchClass(midi)].black;

  /**
   * 音名。style は 'doremi'（ド・レ・ミ）か 'cde'（C4・D4…）。
   * ドレミにはオクターブ番号を付けない（鍵盤の上ではドの鍵にだけ番号を添える）
   */
  function noteName(midi, style) {
    const p = PITCH_CLASS[pitchClass(midi)];
    return style === 'doremi' ? p.doremi : p.cde + octaveOf(midi);
  }

  /**
   * パソコンのキー（code）→ 基準のドからの半音の数。
   * 下の 2 段（Z 段が白鍵、A 段が黒鍵）が低いオクターブ、上の 2 段（Q 段が白鍵、数字の段が黒鍵）が 1 オクターブ上。
   * 下の段の終わり（, . / ; L）と上の段の始まり（Q 2 W 3 E）は同じ音が重なる（どちらの手でも弾けるように）
   */
  const KEY_OFFSETS = Object.freeze({
    KeyZ: 0, KeyS: 1, KeyX: 2, KeyD: 3, KeyC: 4, KeyV: 5, KeyG: 6, KeyB: 7, KeyH: 8, KeyN: 9, KeyJ: 10, KeyM: 11,
    Comma: 12, KeyL: 13, Period: 14, Semicolon: 15, Slash: 16,
    KeyQ: 12, Digit2: 13, KeyW: 14, Digit3: 15, KeyE: 16, KeyR: 17, Digit5: 18, KeyT: 19, Digit6: 20, KeyY: 21, Digit7: 22, KeyU: 23,
    KeyI: 24, Digit9: 25, KeyO: 26, Digit0: 27, KeyP: 28, BracketLeft: 29, Equal: 30, BracketRight: 31,
  });

  /**
   * キーの印字。英字・数字と , . / ; は US 配列と JIS 配列で同じ位置・同じ文字。
   * 違うのは 3 つだけ（UI Events KeyboardEvent code Values の 106 配列の図）:
   *   BracketLeft: US「[」／JIS「@」、Equal: US「=」／JIS「^」、BracketRight: US「]」／JIS「[」
   */
  const LAYOUT_DIFF = Object.freeze({
    us: { BracketLeft: '[', Equal: '=', BracketRight: ']' },
    jis: { BracketLeft: '@', Equal: '^', BracketRight: '[' },
  });
  const COMMON_LABEL = { Comma: ',', Period: '.', Slash: '/', Semicolon: ';' };

  /** code → 画面に出すキーの文字。layout は 'us' | 'jis'、learned は実際に押された文字（あれば優先） */
  function keyLabel(code, layout, learned) {
    if (learned && learned[code]) return learned[code];
    if (/^Key[A-Z]$/.test(code)) return code.slice(3);
    if (/^Digit[0-9]$/.test(code)) return code.slice(5);
    if (COMMON_LABEL[code]) return COMMON_LABEL[code];
    const d = LAYOUT_DIFF[layout === 'us' ? 'us' : 'jis'];
    return d[code] || '';
  }

  /**
   * 実際に押されたキーの (code, key) から配列を推定する。わからなければ null。
   * 例: code=BracketLeft で key='@' なら JIS、key='[' なら US
   */
  function guessLayout(code, key) {
    for (const name of ['us', 'jis']) {
      const want = LAYOUT_DIFF[name][code];
      if (want && want === key) {
        // BracketRight の「[」は JIS、BracketLeft の「[」は US なので code とあわせて判定する
        return name;
      }
    }
    return null;
  }

  /** code → MIDI ノート番号（割り当てのないキーは null）。base は Z キーの音（既定 48 = C3） */
  function midiForCode(code, base) {
    const off = KEY_OFFSETS[code];
    return off === undefined ? null : base + off;
  }

  /** MIDI ノート番号 → その音を鳴らすキーの code の一覧（鍵盤にラベルを出すため） */
  function codesForMidi(midi, base) {
    return Object.keys(KEY_OFFSETS).filter((c) => base + KEY_OFFSETS[c] === midi);
  }

  /**
   * 画面に出す鍵盤の範囲。start は左はしの白鍵（ドにそろえる）、whites は白鍵の数。
   * 返り値: [{ midi, black, whiteIndex }]（黒鍵の whiteIndex は左どなりの白鍵の番号）
   */
  function keyboardRange(start, whites) {
    const keys = [];
    let w = -1;
    for (let m = start; ; m++) {
      if (isBlack(m)) {
        if (w < 0) continue; // 左はしの白鍵より左には置かない
        if (w >= whites - 1) break; // 右はしの白鍵の右にも置かない
        keys.push({ midi: m, black: true, whiteIndex: w });
      } else {
        if (w + 1 >= whites) break;
        w++;
        keys.push({ midi: m, black: false, whiteIndex: w });
      }
    }
    return keys;
  }

  /** 表示できる範囲（88 鍵のピアノと同じ A0 = 21 〜 C8 = 108） */
  const LOWEST = 21;
  const HIGHEST = 108;

  /** 左はしのド（start）を範囲に収める。whites 本の白鍵が HIGHEST を超えない、C1 より下にしない */
  function clampStart(start, whites) {
    const lastWhiteMidi = (s) => keyboardRange(s, whites).filter((k) => !k.black).pop().midi;
    let s = Math.round(start / 12) * 12;
    if (s < 24) s = 24; // C1
    while (s > 24 && lastWhiteMidi(s) > HIGHEST) s -= 12;
    return s;
  }

  /**
   * 音色の一覧（すべてその場で合成する。録音した音は使わない）。
   * 画面の選択肢と保存する値（id）。並びは画面の順
   */
  const TIMBRES = Object.freeze([
    { id: 'piano', name: 'ピアノ' },
    { id: 'epiano', name: 'エレピ' },
    { id: 'organ', name: 'オルガン' },
    { id: 'musicbox', name: 'オルゴール' },
    { id: 'synth', name: 'シンセ' },
    { id: 'strings', name: 'ストリングス風' },
  ]);
  const TIMBRE_IDS = TIMBRES.map((t) => t.id);

  /** ナイキスト（44.1kHz の半分 22,050Hz）のかなり下、top Hz（既定 11,000Hz）までに収まる倍音の数（max 本まで） */
  const harmonicsUnder = (f, max, top = 11000) => Math.max(1, Math.min(max, Math.floor(top / f)));

  /** 倍音の振幅の表（添字 = 何倍音か。0 番は直流で常に 0）。amp(k) が 0 の倍音は鳴らさない */
  function partialsOf(f, max, amp, top) {
    const n = harmonicsUnder(f, max, top);
    const partials = [0];
    for (let k = 1; k <= n; k++) partials.push(amp(k));
    return partials;
  }

  /** 低い音ほど長い減衰の時定数（秒）。ピアノの形。base は C4 での値 */
  const decayFor = (f, base, lo, hi) => Math.max(lo, Math.min(hi, base * Math.pow(261.63 / f, 0.7)));

  /**
   * 1 音の音色の設計。timbre は TIMBRES の id（知らない値はピアノ）。返り値の意味:
   * - f: 周波数、partials: 倍音ごとの振幅（PeriodicWave に渡す。ブラウザが最大 1 に正規化する）
   * - detune: 重ねる発振器ごとのずれ（セント）。数 = 発振器の数（CPU のため 1〜2 個）
   * - cutoffStart → cutoffEnd: ローパスの動き（cutoffTau 秒の時定数）、Q: ローパスの山
   * - 音量（音量の形 = エンベロープ）: attack 秒で level まで上がり → tau1 で level × mid へ →
   *   t2 秒から tau2 で level × sustain へ（sustain が 0 なら自然に消える。0 より大きければ押している間は鳴り続ける）
   * - release: 鍵を離したときに消える時定数（秒）、noise: 打鍵・キーの「コツ」の大きさ（0 = なし）
   * level は 10 音の和音を音量最大で鳴らしても割れないように、オフラインで書き出して決めた（synth.js の最後で軽く頭を抑える）
   */
  function voiceDesign(midi, timbre) {
    const f = frequency(midi);
    const bright = midi < 48 ? 1 : midi < 72 ? 0.85 : 0.6;
    switch (timbre) {
      case 'epiano': {
        // 丸い基音に 2 倍音と、たたいた直後だけ明るい高い倍音（ローパスで早く丸くする）。2 つを ±4 セントずらして揺れを出す
        const table = { 1: 1, 2: 0.3, 3: 0.06, 4: 0.12, 5: 0.03 };
        const decay = decayFor(f, 1.8, 0.35, 4);
        return {
          f, partials: partialsOf(f, 5, (k) => table[k] || 0), detune: [-4, 4],
          cutoffStart: Math.min(12000, f * 10 + 1500), cutoffEnd: Math.min(6000, f * 3 + 500), cutoffTau: 0.25, Q: 0.5,
          attack: 0.003, level: 0.3, mid: 0.55, tau1: 0.15, t2: 0.25, sustain: 0, tau2: decay, release: 0.12, noise: 0.02, decay,
        };
      }
      case 'organ': {
        // ドローバーのオルガンに似せた倍音（1・2・3・4・6・8 倍）。押している間は同じ大きさで鳴り続ける。発振器は 1 つ
        const table = { 1: 1, 2: 0.7, 3: 0.45, 4: 0.35, 6: 0.2, 8: 0.15 };
        const c = Math.min(14000, f * 12 + 2000);
        return {
          f, partials: partialsOf(f, 8, (k) => table[k] || 0), detune: [0],
          cutoffStart: c, cutoffEnd: c, cutoffTau: 0.1, Q: 0.5,
          attack: 0.008, level: 0.15, mid: 1, tau1: 0.05, t2: 0.01, sustain: 1, tau2: 0.1, release: 0.03, noise: 0.015, decay: Infinity,
        };
      }
      case 'musicbox': {
        // 基音と 4 倍・6 倍の小さな倍音（金属の歯を弾いた音）。すぐに減衰し、鍵を離しても少し残る。発振器は 1 つ
        const table = { 1: 1, 4: 0.2, 6: 0.08 };
        const decay = Math.max(0.25, Math.min(1.6, 1.2 * Math.pow(523.25 / f, 0.5)));
        const c = Math.min(14000, f * 10 + 2000);
        return {
          f, partials: partialsOf(f, 6, (k) => table[k] || 0), detune: [0],
          cutoffStart: c, cutoffEnd: c, cutoffTau: 0.1, Q: 0.5,
          attack: 0.002, level: 0.45, mid: 0.5, tau1: 0.05, t2: 0.08, sustain: 0, tau2: decay, release: 0.5, noise: 0.03, decay,
        };
      }
      case 'synth': {
        // のこぎり波（k 倍音の振幅 1/k）を ±7 セントずらした 2 つ。ローパスに山（Q）をつけて明るい → 少し暗い
        return {
          f, partials: partialsOf(f, 24, (k) => 1 / k), detune: [-7, 7],
          cutoffStart: Math.min(12000, f * 16 + 1200), cutoffEnd: Math.min(8000, f * 4 + 600), cutoffTau: 0.2, Q: 3,
          attack: 0.005, level: 0.2, mid: 0.75, tau1: 0.1, t2: 0.2, sustain: 0.6, tau2: 0.5, release: 0.12, noise: 0, decay: Infinity,
        };
      }
      case 'strings': {
        // のこぎり波に近い倍音を ±8 セントずらした 2 つ。ゆっくり立ち上がり（0.12 秒）、押している間は鳴り続け、ゆっくり消える
        const c = Math.min(9000, f * 5 + 900);
        return {
          f, partials: partialsOf(f, 16, (k) => 1 / Math.pow(k, 1.2)), detune: [-8, 8],
          cutoffStart: c, cutoffEnd: c, cutoffTau: 0.1, Q: 0.5,
          attack: 0.12, level: 0.18, mid: 1, tau1: 0.1, t2: 0.12, sustain: 0.85, tau2: 0.8, release: 0.35, noise: 0, decay: Infinity,
        };
      }
      default: {
        // ピアノ（最初からの音）: 倍音を足した加算合成。弦を 1/7 の位置で打った弦の近似（7 倍音が弱い）× 高い倍音ほど小さく。
        // 2 つを ±1.5 セントずらして弦 2 本のうなり。打鍵の直後は明るく → だんだん丸く。低い音ほど長く響く
        const decay = decayFor(f, 2.4, 0.4, 6);
        const partials = partialsOf(f, 10, (k) => {
          const hammer = Math.abs(Math.sin((Math.PI * k) / 7.3));
          return (hammer / Math.pow(k, 1.1)) * (k === 1 ? 1 : bright);
        }, 10000);
        return {
          f, partials, detune: [-1.5, 1.5],
          cutoffStart: Math.min(16000, f * 14 + 1500), cutoffEnd: Math.min(9000, f * 3 + 400), cutoffTau: decay * 0.3, Q: 0.5,
          attack: 0.004, level: 0.32, mid: 0.4, tau1: Math.min(0.25, decay * 0.12), t2: 0.3, sustain: 0, tau2: decay, release: 0.08, noise: 0.06, decay,
        };
      }
    }
  }

  /**
   * MIDI の強さ（ベロシティ 1〜127）→ 音の大きさ（0〜0.8）。
   * 127 で画面の鍵盤・パソコンのキーと同じ 0.8（それより大きくしない = 割れない範囲のまま）。弱く弾くほど小さく（1.5 乗）
   */
  function velocityLevel(v) {
    const x = Math.max(0, Math.min(127, Number(v) || 0)) / 127;
    return +(0.8 * (0.12 + 0.88 * Math.pow(x, 1.5))).toFixed(4);
  }

  /**
   * MIDI の 1 メッセージ（Uint8Array か配列）を読む。Web MIDI の midimessage は 1 回に 1 メッセージ（ランニングステータスは展開済み）。
   * 返り値: { type: 'on', note, velocity, channel } | { type: 'off', note, channel } | { type: 'sustain', on, channel } |
   *         { type: 'allOff', channel } | null（使わないメッセージ）。channel は 1〜16（全チャンネルを受ける）
   * - ノートオン（0x9n）でベロシティ 0 はノートオフ（MIDI 1.0 の決まり）
   * - CC64（ダンパーペダル）は 64 以上でオン、63 以下でオフ
   * - CC120（オールサウンドオフ）・CC123（オールノートオフ）は全部止める
   * - 0xF0 以上（システムメッセージ: クロック 0xF8、アクティブセンシング 0xFE など）は無視
   */
  function parseMidiMessage(data) {
    if (!data || data.length < 1) return null;
    const status = data[0];
    if (!(status >= 0x80 && status < 0xf0)) return null;
    const kind = status & 0xf0;
    const channel = (status & 0x0f) + 1;
    const d1 = data[1];
    const d2 = data[2];
    const ok = (x) => Number.isInteger(x) && x >= 0 && x < 0x80;
    if (kind === 0x80 || kind === 0x90) {
      if (!ok(d1) || !ok(d2)) return null;
      if (kind === 0x90 && d2 > 0) return { type: 'on', note: d1, velocity: d2, channel };
      return { type: 'off', note: d1, channel };
    }
    if (kind === 0xb0) {
      if (!ok(d1) || !ok(d2)) return null;
      if (d1 === 64) return { type: 'sustain', on: d2 >= 64, channel };
      if (d1 === 120 || d1 === 123) return { type: 'allOff', channel };
    }
    return null;
  }

  /** 設定の正規化（localStorage から読んだ値をそのまま信じない） */
  const DEFAULTS = Object.freeze({ names: 'doremi', volume: 70, start: 48, sustain: false, layout: '', bpm: 90, timbre: 'piano' });
  function normalizeSettings(raw) {
    const s = Object.assign({}, DEFAULTS);
    if (!raw || typeof raw !== 'object') return s;
    if (['doremi', 'cde', 'none'].includes(raw.names)) s.names = raw.names;
    const v = Number(raw.volume);
    if (Number.isFinite(v)) s.volume = Math.max(0, Math.min(100, Math.round(v)));
    const st = Number(raw.start);
    if (Number.isFinite(st)) s.start = Math.max(24, Math.min(96, Math.round(st / 12) * 12));
    if (['us', 'jis'].includes(raw.layout)) s.layout = raw.layout;
    const b = Number(raw.bpm);
    if (Number.isFinite(b)) s.bpm = Math.max(30, Math.min(240, Math.round(b)));
    if (TIMBRE_IDS.includes(raw.timbre)) s.timbre = raw.timbre;
    return s;
  }

  return {
    A4_MIDI, A4_HZ, LOWEST, HIGHEST, KEY_OFFSETS, LAYOUT_DIFF, DEFAULTS, TIMBRES,
    frequency, pitchClass, octaveOf, isBlack, noteName, keyLabel, guessLayout,
    midiForCode, codesForMidi, keyboardRange, clampStart, voiceDesign, normalizeSettings,
    velocityLevel, parseMidiMessage,
  };
});
