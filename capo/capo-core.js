'use strict';
/* =================================================================
   カポ・移調 — 計算（ブラウザでも Node でも読める。DOM に触れない）
   ・音の高さは 12 平均律の半音（ピッチクラス 0=C … 11=B）で数える
   ・コード名の根音と分数コードの低音だけを動かし、残り（m7・sus4 など）はそのまま
   ・制度の値は持たない（音楽の約束ごとだけ）。確認日の管理は不要
   ================================================================= */

const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
/** 日本語の音名（ハニホヘトイロ）。嬰＝#、変＝♭ */
const JA_LETTER = { C: 'ハ', D: 'ニ', E: 'ホ', F: 'ヘ', G: 'ト', A: 'イ', B: 'ロ' };

/** 表に出すカポの位置（0〜7 フレット） */
const MAX_CAPO = 7;
const mod12 = (n) => ((n % 12) + 12) % 12;

/** 長調の主音（ピッチクラス）→ ♭で書くか。F・B♭・E♭・A♭・D♭ は ♭、ほか（F# を含む）は # */
const FLAT_MAJOR = new Set([5, 10, 3, 8, 1]);
function useFlats(key) {
  if (!key) return false;
  const major = key.mode === 'minor' ? mod12(key.tonic + 3) : key.tonic;
  return FLAT_MAJOR.has(major);
}
function pcName(pc, flats) { return (flats ? FLAT_NAMES : SHARP_NAMES)[mod12(pc)]; }

/** コードの後ろの部分（m7・sus4 など）として認める文字 */
const SUFFIX_RE = /^(?:maj|min|dim|aug|sus|add|omit|alt|no|M|m|°|ø|△|Δ|\+|-|[0-9]|#|♯|b|♭|\(|\)|,|\.|\s)*$/;
const ROOT_RE = /^([A-G])([#♯b♭]?)(.*)$/;

/** 1 つの語をコードとして読む。読めなければ null */
function parseChord(token) {
  if (typeof token !== 'string') return null;
  const t = token.normalize('NFKC').replace(/[（]/g, '(').replace(/[）]/g, ')');
  if (!t) return null;
  let main = t, bass = null;
  const slash = t.lastIndexOf('/');
  if (slash > 0) {
    const b = t.slice(slash + 1).match(/^([A-G])([#♯b♭]?)$/);
    if (!b) return null;
    bass = mod12(LETTER_PC[b[1]] + acc(b[2]));
    main = t.slice(0, slash);
  }
  const m = main.match(ROOT_RE);
  if (!m) return null;
  const suffix = m[3];
  if (!SUFFIX_RE.test(suffix)) return null;
  // 英単語（例: "Bad" は a が残る）は後ろの部分の文字で外れる
  return { root: mod12(LETTER_PC[m[1]] + acc(m[2])), suffix, bass };
}
function acc(s) { return s === '#' || s === '♯' ? 1 : s === 'b' || s === '♭' ? -1 : 0; }

/** コードの種類（キーの推定と押さえやすさの判定に使う） */
function chordClass(suffix) {
  const s = suffix.replace(/\s/g, '');
  if (/^(dim|°|ø|m7-5|m7\(-5\)|m7b5|m7♭5|m7\(b5\)|m7\(♭5\))/.test(s)) return 'dim';
  if (/^(maj|M|△|Δ)/.test(s)) return 'major';
  if (/^(m|min)/.test(s)) return 'minor';
  if (/^(aug|\+)/.test(s)) return 'aug';
  return 'major';
}

/** 押さえやすさの判定に使う形の名前（m7・maj7 などをそろえる） */
function shapeKind(suffix) {
  const s = suffix.replace(/\s/g, '');
  const table = [
    [/^$/, ''], [/^(m|min)$/, 'm'], [/^7$/, '7'], [/^(m7|min7)$/, 'm7'],
    [/^(maj7|M7|△7|Δ7|△)$/, 'maj7'], [/^(sus4|sus)$/, 'sus4'], [/^add9$/, 'add9'],
  ];
  for (const [re, k] of table) if (re.test(s)) return k;
  return null;
}

/** 開放弦を使う基本の形（セーハなし）として数えるコード。根音のピッチクラスと形の名前の組 */
const OPEN_SHAPES = {
  '': [0, 2, 4, 7, 9],            // C D E G A
  m: [9, 2, 4],                   // Am Dm Em
  '7': [0, 2, 4, 7, 9, 11],       // C7 D7 E7 G7 A7 B7
  m7: [9, 2, 4],                  // Am7 Dm7 Em7
  maj7: [0, 2, 4, 5, 7, 9],       // Cmaj7 Dmaj7 Emaj7 Fmaj7 Gmaj7 Amaj7
  sus4: [2, 4, 9],                // Dsus4 Esus4 Asus4
  add9: [0],                      // Cadd9
};
/** 一覧に出す形（表示用。ピッチクラスは C の形で書く） */
const OPEN_SHAPE_LIST = ['C', 'D', 'E', 'G', 'A', 'Am', 'Dm', 'Em', 'C7', 'D7', 'E7', 'G7', 'A7', 'B7', 'Am7', 'Dm7', 'Em7',
  'Cmaj7', 'Dmaj7', 'Emaj7', 'Fmaj7', 'Gmaj7', 'Amaj7', 'Dsus4', 'Esus4', 'Asus4', 'Cadd9'];

function isOpenShape(ch) {
  const k = shapeKind(ch.suffix);
  return k !== null && OPEN_SHAPES[k].includes(mod12(ch.root));
}

/** コード名を書く（根音と低音を半音 shift 動かし、key の書き方（# か ♭）で） */
function chordName(ch, shift, flats) {
  const root = pcName(ch.root + shift, flats);
  const bass = ch.bass === null ? '' : '/' + pcName(ch.bass + shift, flats);
  return root + ch.suffix + bass;
}

/** 行を語と区切りに分ける（空白・| ・[ ] で区切る。歌詞の中の [Am] も拾う） */
function splitLine(line) {
  return line.split(/(\s+|\||｜|\[|\]|【|】)/).filter((x) => x !== '');
}

/** 文章からコードを順に取り出す */
function extractChords(text) {
  const out = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    for (const tok of splitLine(line)) {
      const c = parseChord(tok);
      if (c) out.push(c);
    }
  }
  return out;
}

/** 長調の主音 t のダイアトニック三和音（根音のずれと種類） */
const MAJOR_TRIADS = [[0, 'major'], [2, 'minor'], [4, 'minor'], [5, 'major'], [7, 'major'], [9, 'minor'], [11, 'dim']];

/** キーを推す。コードがダイアトニックに入る数がいちばん多い長調。同点は最初・最後のコードが主和音のもの、次に調号の少ないもの */
function guessKey(chords) {
  if (!chords.length) return null;
  const accidentals = [0, 7, 2, 5, 4, 1, 6, 1, 4, 3, 2, 5]; // 長調の主音 pc → 調号の数
  let best = null;
  for (let t = 0; t < 12; t++) {
    let score = 0;
    for (const c of chords) {
      const cls = chordClass(c.suffix);
      if (MAJOR_TRIADS.some(([d, k]) => mod12(t + d) === c.root && k === cls)) score++;
    }
    const first = chords[0], last = chords[chords.length - 1];
    const isTonic = (c) => (c.root === t && chordClass(c.suffix) === 'major') || (c.root === mod12(t + 9) && chordClass(c.suffix) === 'minor');
    const ends = (isTonic(first) ? 1 : 0) + (isTonic(last) ? 1 : 0);
    const cand = { t, score, ends, acc: accidentals[t] };
    if (!best || cand.score > best.score || (cand.score === best.score && (cand.ends > best.ends || (cand.ends === best.ends && cand.acc < best.acc)))) best = cand;
  }
  // 最初のコードが平行調の短調の主和音なら短調と読む
  const f = chords[0];
  const minor = f.root === mod12(best.t + 9) && chordClass(f.suffix) === 'minor';
  return minor ? { tonic: mod12(best.t + 9), mode: 'minor' } : { tonic: best.t, mode: 'major' };
}

function shiftKey(key, n) { return key ? { tonic: mod12(key.tonic + n), mode: key.mode } : null; }

/** キーの名前（例: { en: 'B♭', ja: '変ロ長調' }） */
function keyName(key) {
  if (!key) return null;
  const flats = useFlats(key);
  const n = pcName(key.tonic, flats);
  const ja = (n[1] === '#' ? '嬰' : n[1] === '♭' ? '変' : '') + JA_LETTER[n[0]] + (key.mode === 'minor' ? '短調' : '長調');
  return { en: n + (key.mode === 'minor' ? 'm' : ''), ja };
}

/** 文章のコードを半音 shift 動かす。歌詞・空白・コードでない語はそのまま */
function transposeText(text, shift, key) {
  const flats = useFlats(shiftKey(key, shift));
  return String(text || '').split(/\r?\n/).map((line) =>
    splitLine(line).map((tok) => {
      const c = parseChord(tok);
      return c ? chordName(c, shift, flats) : tok;
    }).join('')).join('\n');
}

/**
 * まとめて計算する
 * @param {string} text 譜面のコード（written）
 * @param {object} o  shift: キーを変える半音（−6〜+6）、capo: 弾くときのカポ（0〜）、sheetCapo: 譜面がカポ何の形で書いてあるか
 */
function compute(text, o = {}) {
  const shift = Number(o.shift) || 0, capo = Number(o.capo) || 0, sheetCapo = Number(o.sheetCapo) || 0;
  const written = extractChords(text);
  const writtenKey = guessKey(written);
  // 実際に鳴る音（原曲）= 譜面の形 + 譜面のカポ
  const originalKey = shiftKey(writtenKey, sheetCapo);
  const soundingKey = shiftKey(originalKey, shift);
  const playShift = sheetCapo + shift - capo;        // 譜面の形 → 弾く形
  const playKey = shiftKey(soundingKey, -capo);
  const playText = transposeText(text, playShift, writtenKey);
  const distinct = new Map();
  for (const c of written) distinct.set(chordName(c, sheetCapo + shift, false), c);
  const capoTable = [];
  for (let n = 0; n <= MAX_CAPO; n++) {
    const sh = sheetCapo + shift - n;
    const flats = useFlats(shiftKey(soundingKey, -n));
    let open = 0;
    const shapes = [];
    for (const c of distinct.values()) {
      const moved = { root: mod12(c.root + sh), suffix: c.suffix, bass: c.bass === null ? null : mod12(c.bass + sh) };
      if (isOpenShape(moved)) open++;
      shapes.push(chordName(c, sh, flats));
    }
    capoTable.push({ capo: n, key: keyName(shiftKey(soundingKey, -n)), open, total: distinct.size, shapes });
  }
  let best = null;
  for (const r of capoTable) if (r.total && (!best || r.open > best.open)) best = r;
  return {
    count: written.length, distinct: distinct.size,
    originalKey: keyName(originalKey), soundingKey: keyName(soundingKey), playKey: keyName(playKey),
    soundingKeyRaw: soundingKey, playText, capoTable, best: best ? best.capo : null,
  };
}

/** ダイアトニックコード（三和音と四和音）。短調は自然的短音階 */
function diatonic(key) {
  const flats = useFlats(key);
  const t = key.tonic;
  const rows = key.mode === 'minor'
    ? [['Ⅰm', 0, 'm', 'm7'], ['Ⅱm(♭5)', 2, 'dim', 'm7(♭5)'], ['♭Ⅲ', 3, '', 'maj7'], ['Ⅳm', 5, 'm', 'm7'],
       ['Ⅴm', 7, 'm', 'm7'], ['♭Ⅵ', 8, '', 'maj7'], ['♭Ⅶ', 10, '', '7']]
    : [['Ⅰ', 0, '', 'maj7'], ['Ⅱm', 2, 'm', 'm7'], ['Ⅲm', 4, 'm', 'm7'], ['Ⅳ', 5, '', 'maj7'],
       ['Ⅴ', 7, '', '7'], ['Ⅵm', 9, 'm', 'm7'], ['Ⅶm(♭5)', 11, 'dim', 'm7(♭5)']];
  return rows.map(([deg, d, tri, sev]) => {
    const n = pcName(t + d, flats);
    return { degree: deg, triad: n + tri, seventh: n + sev };
  });
}

/** 共有リンク（# 以降）の読み書き */
function encodeState(s) {
  const p = new URLSearchParams();
  if (s.text) p.set('c', s.text);
  if (s.shift) p.set('k', String(s.shift));
  if (s.capo) p.set('p', String(s.capo));
  if (s.sheetCapo) p.set('s', String(s.sheetCapo));
  return p.toString();
}
function decodeState(hash) {
  const p = new URLSearchParams(String(hash || '').replace(/^#/, ''));
  const int = (v, lo, hi) => { const n = Math.trunc(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : 0; };
  return { text: (p.get('c') || '').slice(0, 20000), shift: int(p.get('k'), -6, 6), capo: int(p.get('p'), 0, MAX_CAPO), sheetCapo: int(p.get('s'), 0, MAX_CAPO) };
}

const api = { MAX_CAPO, parseChord, chordClass, shapeKind, isOpenShape, OPEN_SHAPE_LIST, extractChords, guessKey, keyName, useFlats,
  transposeText, compute, diatonic, encodeState, decodeState, pcName };
if (typeof module !== 'undefined') module.exports = api;
if (typeof window !== 'undefined') window.CapoCore = api;
