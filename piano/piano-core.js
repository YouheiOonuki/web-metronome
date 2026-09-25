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
   * 1 音の音色の設計（ピアノに似せた加算合成）。
   * partials: 倍音ごとの振幅（高い音ほど倍音を減らす）、decay: 自然に減衰する時定数（秒。低い音ほど長い）、
   * cutoffStart / cutoffEnd: ローパスの開始と終わり（打鍵の直後は明るく、だんだん丸くなる）
   */
  function voiceDesign(midi) {
    const f = frequency(midi);
    const n = Math.max(1, Math.min(10, Math.floor(10000 / f))); // ナイキストのかなり下まで
    const bright = midi < 48 ? 1 : midi < 72 ? 0.85 : 0.6;
    const partials = [0];
    for (let k = 1; k <= n; k++) {
      // 弦を 1/7 の位置で打った弦の近似（7 倍音が弱い）× 高い倍音ほど小さく
      const hammer = Math.abs(Math.sin((Math.PI * k) / 7.3));
      partials.push((hammer / Math.pow(k, 1.1)) * (k === 1 ? 1 : bright));
    }
    const decay = Math.max(0.4, Math.min(6, 2.4 * Math.pow(261.63 / f, 0.7)));
    const cutoffStart = Math.min(16000, f * 14 + 1500);
    const cutoffEnd = Math.min(9000, f * 3 + 400);
    return { f, partials, decay, cutoffStart, cutoffEnd };
  }

  /** 設定の正規化（localStorage から読んだ値をそのまま信じない） */
  const DEFAULTS = Object.freeze({ names: 'doremi', volume: 70, start: 48, sustain: false, layout: '', bpm: 90 });
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
    return s;
  }

  return {
    A4_MIDI, A4_HZ, LOWEST, HIGHEST, KEY_OFFSETS, LAYOUT_DIFF, DEFAULTS,
    frequency, pitchClass, octaveOf, isBlack, noteName, keyLabel, guessLayout,
    midiForCode, codesForMidi, keyboardRange, clampStart, voiceDesign, normalizeSettings,
  };
});
