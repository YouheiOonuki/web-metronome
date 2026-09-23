/**
 * Web Metronome - main.js
 * Web Audio API を使った精度の高いメトロノーム。
 * lookahead スケジューラーパターンで音ズレを最小化し、
 * 拍子（変則拍子のグルーピング含む）・拍ごとのアクセント・細分化（裏拍 / 3連 / 16分など）に対応。
 */

'use strict';

// =============================================
// 定数
// =============================================
const BPM_MIN    = 1;
const BPM_MAX    = 500;
const BEATS_MIN  = 1;
const BEATS_MAX  = 16;
const NOTE_UNITS = [2, 4, 8, 16];

// スケジューラー設定
const LOOKAHEAD_MS   = 25;    // スケジューラー呼び出し間隔 (ms)
const SCHEDULE_AHEAD = 0.1;   // 先読み時間 (秒)

// タップテンポ用
const TAP_MAX      = 8;       // 保持するタップ履歴の最大数
const TAP_RESET_MS = 2000;    // この間隔以上あいたらリセット (ms)

// 保存キー
const STORAGE_KEY    = 'metronome-settings';
const LEGACY_BPM_KEY = 'bpm'; // 旧バージョン（BPM のみ保存）からの移行用

/** アクセントの段階。拍ドットをタップすると 強 → 中 → 弱 → 休 → 強 … と切り替わる */
const LEVEL_LABELS = ['休符', '弱', '中', '強'];

/**
 * 細分化パターン。pattern の各要素が 1 拍を等分した位置で、1 なら鳴らす。
 * offbeat は表拍を鳴らさず、裏拍にその拍のアクセントを載せる（裏拍練習用）。
 */
const SUBDIVISIONS = {
  quarter:   { pattern: [1] },
  eighth:    { pattern: [1, 1] },
  triplet:   { pattern: [1, 1, 1] },
  sixteenth: { pattern: [1, 1, 1, 1] },
  shuffle:   { pattern: [1, 0, 1] },
  offbeat:   { pattern: [0, 1], offbeat: true },
};

/** 拍子プリセット（groups はアクセントのまとまり。空なら 1 拍目のみ強拍） */
const PRESETS = [
  { beats: 4,  unit: 4, groups: '' },
  { beats: 3,  unit: 4, groups: '' },
  { beats: 2,  unit: 4, groups: '' },
  { beats: 5,  unit: 4, groups: '3+2' },
  { beats: 6,  unit: 8, groups: '3+3' },
  { beats: 9,  unit: 8, groups: '3+3+3' },
  { beats: 12, unit: 8, groups: '3+3+3+3' },
  { beats: 5,  unit: 8, groups: '2+3' },
  { beats: 5,  unit: 8, groups: '3+2' },
  { beats: 7,  unit: 8, groups: '2+2+3' },
  { beats: 7,  unit: 8, groups: '3+2+2' },
  { beats: 7,  unit: 8, groups: '2+3+2' },
  { beats: 8,  unit: 8, groups: '3+3+2' },
  { beats: 9,  unit: 8, groups: '2+2+2+3' },
  { beats: 11, unit: 8, groups: '3+3+3+2' },
];

/** テンポ表示（上限未満ならその名前） */
const TEMPO_MARKINGS = [
  [40, 'Grave'], [60, 'Largo'], [66, 'Larghetto'], [76, 'Adagio'],
  [108, 'Andante'], [120, 'Moderato'], [156, 'Allegro'], [176, 'Vivace'],
  [200, 'Presto'], [Infinity, 'Prestissimo'],
];

// 音色: アクセント段階ごとの音量・ピッチ倍率（sub は細分化の音）
const LEVEL_GAIN  = { 3: 1.0, 2: 0.8, 1: 0.6, sub: 0.45 };
const LEVEL_PITCH = { 3: 2.0, 2: 1.5, 1: 1.0, sub: 0.75 };
const SOUNDS = ['beep', 'wood', 'hihat'];

/** 見た目のテーマ（web-roulette と共通の 6 種類） */
const THEMES = ['washi', 'mori', 'aizome', 'dark', 'metal', 'neon'];

const DEFAULTS = {
  bpm: 120,
  beats: 4,
  unit: 4,
  groups: '',
  accents: null,           // null なら beats / groups から自動生成
  subdivision: 'quarter',
  sound: 'beep',
  volume: 0.8,
  subVolume: 0.5,
  trainer: { enabled: false, everyBars: 4, step: 2, target: 160 },
  gap:     { enabled: false, playBars: 3, muteBars: 1 },
  theme: 'washi',
  wakeLock: true,          // 再生中は画面を消さない
};

// =============================================
// DOM 要素
// =============================================
const $ = (id) => document.getElementById(id);

const bpmDisplay      = $('bpmDisplay');
const tempoName       = $('tempoName');
const beatDots        = $('beatDots');
const meterLabel      = $('meterLabel');
const bpmSlider       = $('bpmSlider');
const bpmInput        = $('bpmInput');
const btnMinus        = $('btnMinus');
const btnPlus         = $('btnPlus');
const btnPlay         = $('btnPlay');
const btnTap          = $('btnTap');
const presetSelect    = $('presetSelect');
const beatsValue      = $('beatsValue');
const btnBeatsMinus   = $('btnBeatsMinus');
const btnBeatsPlus    = $('btnBeatsPlus');
const unitSelect      = $('unitSelect');
const groupsInput     = $('groupsInput');
const groupsHint      = $('groupsHint');
const btnResetAccents = $('btnResetAccents');
const soundSelect     = $('soundSelect');
const volumeSlider    = $('volumeSlider');
const subVolumeSlider = $('subVolumeSlider');
const trainerEnabled  = $('trainerEnabled');
const trainerEvery    = $('trainerEvery');
const trainerStep     = $('trainerStep');
const trainerTarget   = $('trainerTarget');
const gapEnabled      = $('gapEnabled');
const gapPlay         = $('gapPlay');
const gapMute         = $('gapMute');
const subdivisionRadios = document.querySelectorAll('input[name="subdivision"]');
const metronomeSection = $('metronomeSection');
const themeSelect      = $('themeSelect');
const wakeLockSetting  = $('wakeLockSetting');
const wakeLockToggle   = $('wakeLockToggle');
const installSetting   = $('installSetting');
const btnInstall       = $('btnInstall');

// =============================================
// 状態変数
// =============================================
const settings = loadSettings();

let audioCtx     = null;   // AudioContext（初回再生時に生成）
let noiseBuffer  = null;   // ウッドブロック / ハイハット用のホワイトノイズ
let runGain      = null;   // 再生ごとの出力ゲイン（停止時に切り離して残響を即カット）
let isPlaying    = false;
let nextNoteTime = 0;      // 次の刻みをスケジュールする AudioContext 時刻
let beatIndex    = 0;      // 小節内の拍位置
let subIndex     = 0;      // 拍内の細分化位置
let barCount     = 0;      // 再生開始からの小節数
let visualQueue  = [];     // 描画待ちの拍 { time, beat, level, silent }
let rafId        = null;
let flashTimeout = null;
let tapTimes     = [];
let wakeLock     = null;   // 画面スリープ防止のロック
let installPrompt = null;  // ホーム画面への追加（beforeinstallprompt）

const ticker = createTicker(scheduler);

// =============================================
// ユーティリティ
// =============================================

/** 値を整数に丸めて min〜max にクランプ */
function clamp(value, min, max) {
  return Math.min(Math.max(Math.round(value), min), max);
}

function toInt(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

// =============================================
// 設定の保存 / 復元
// =============================================

function loadSettings() {
  const s = JSON.parse(JSON.stringify(DEFAULTS));
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (saved && typeof saved === 'object') {
      Object.assign(s, saved, {
        trainer: { ...s.trainer, ...saved.trainer },
        gap:     { ...s.gap, ...saved.gap },
      });
    } else {
      s.bpm = toInt(localStorage.getItem(LEGACY_BPM_KEY), s.bpm);
    }
  } catch {
    // localStorage が使えない環境（プライベートモード等）では既定値で動かす
  }

  s.bpm         = clamp(toInt(s.bpm, DEFAULTS.bpm), BPM_MIN, BPM_MAX);
  s.beats       = clamp(toInt(s.beats, DEFAULTS.beats), BEATS_MIN, BEATS_MAX);
  s.unit        = NOTE_UNITS.includes(s.unit) ? s.unit : DEFAULTS.unit;
  s.groups      = normalizeGroups(s.groups, s.beats) ?? '';
  s.subdivision = s.subdivision in SUBDIVISIONS ? s.subdivision : DEFAULTS.subdivision;
  s.sound       = SOUNDS.includes(s.sound) ? s.sound : DEFAULTS.sound;
  s.volume      = Math.min(Math.max(Number(s.volume) || 0, 0), 1);
  s.subVolume   = Math.min(Math.max(Number(s.subVolume) || 0, 0), 1);
  const validAccents = Array.isArray(s.accents) && s.accents.length === s.beats
    && s.accents.every((v) => Number.isInteger(v) && v >= 0 && v <= 3);
  if (!validAccents) s.accents = buildAccents(s.beats, s.groups);

  s.trainer.enabled   = !!s.trainer.enabled;
  s.trainer.everyBars = clamp(toInt(s.trainer.everyBars, 4), 1, 64);
  s.trainer.step      = clamp(toInt(s.trainer.step, 2), 1, 50);
  s.trainer.target    = clamp(toInt(s.trainer.target, 160), BPM_MIN, BPM_MAX);
  s.gap.enabled       = !!s.gap.enabled;
  s.gap.playBars      = clamp(toInt(s.gap.playBars, 3), 1, 64);
  s.gap.muteBars      = clamp(toInt(s.gap.muteBars, 1), 1, 64);
  s.theme    = THEMES.includes(s.theme) ? s.theme : DEFAULTS.theme;
  s.wakeLock = s.wakeLock !== false;
  return s;
}

let saveTimer = null;

/** スライダー操作中の書き込み過多を避けるため少し遅延して保存 */
function saveSettings() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // 保存できなくても動作には影響しない
    }
  }, 200);
}

// =============================================
// 拍子・グルーピング
// =============================================

/**
 * "2+2+3" 形式のグルーピングを検証して正規化する。
 * 空文字は「グルーピングなし」として '' を返し、不正なら null。
 */
function normalizeGroups(text, beats) {
  const t = String(text ?? '').replace(/\s+/g, '');
  if (t === '') return '';
  if (!/^\d+(\+\d+)*$/.test(t)) return null;
  const parts = t.split('+').map(Number);
  if (parts.some((p) => p < 1)) return null;
  if (parts.reduce((a, b) => a + b, 0) !== beats) return null;
  return parts.join('+');
}

/** 拍子から既定のグルーピングを決める（x/8 以上は 3 または 2 のまとまりに分ける） */
function defaultGroups(beats, unit) {
  if (unit < 8 || beats <= 3) return '';
  if (beats % 3 === 0) return Array(beats / 3).fill(3).join('+');
  if (beats % 2 === 0) return Array(beats / 2).fill(2).join('+');
  return [...Array((beats - 3) / 2).fill(2), 3].join('+');
}

/** グルーピングからアクセント配列を作る（1 拍目 = 強、各グループ頭 = 中、それ以外 = 弱） */
function buildAccents(beats, groups) {
  const accents = Array(beats).fill(1);
  if (groups) {
    let i = 0;
    for (const g of groups.split('+').map(Number)) {
      accents[i] = 2;
      i += g;
    }
  }
  accents[0] = 3;
  return accents;
}

function groupStartIndexes() {
  const starts = new Set();
  if (!settings.groups) return starts;
  let i = 0;
  for (const g of settings.groups.split('+').map(Number)) {
    starts.add(i);
    i += g;
  }
  return starts;
}

function presetKey(beats, unit, groups) {
  return `${beats}/${unit}|${groups}`;
}

/** 拍子を変更（アクセントはグルーピングから作り直す） */
function setMeter(beats, unit, groups) {
  settings.beats   = clamp(beats, BEATS_MIN, BEATS_MAX);
  settings.unit    = NOTE_UNITS.includes(unit) ? unit : 4;
  settings.groups  = normalizeGroups(groups, settings.beats) ?? '';
  settings.accents = buildAccents(settings.beats, settings.groups);
  renderMeter();
  saveSettings();
}

// =============================================
// BPM
// =============================================

/**
 * BPM を設定して UI と保存値を更新する。
 * 再生中でも次の刻みから反映される（リセット不要）。
 */
function applyBPM(bpm) {
  settings.bpm = clamp(bpm, BPM_MIN, BPM_MAX);
  bpmDisplay.textContent = settings.bpm;
  bpmSlider.value = settings.bpm;
  bpmInput.value  = settings.bpm;
  tempoName.textContent = TEMPO_MARKINGS.find(([limit]) => settings.bpm < limit)[1];
  saveSettings();
}

// =============================================
// Web Audio API
// =============================================

/** AudioContext を遅延生成（ブラウザの自動再生ポリシー対策） */
function ensureAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    noiseBuffer = audioCtx.createBuffer(1, Math.floor(audioCtx.sampleRate * 0.2), audioCtx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  // suspended 状態なら resume（モバイル対策）
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

/** 立ち上がり 2ms → 指数減衰のエンベロープを作り runGain へ接続 */
function envelope(time, peak, decay) {
  const g = audioCtx.createGain();
  g.gain.setValueAtTime(0, time);
  g.gain.linearRampToValueAtTime(peak, time + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, time + decay);
  g.connect(runGain);
  return g;
}

function playBeep(time, freq, peak) {
  const osc = audioCtx.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = freq;
  osc.connect(envelope(time, peak, 0.05));
  osc.start(time);
  osc.stop(time + 0.06);
}

function playWood(time, freq, peak) {
  // 胴鳴り: ピッチが一瞬落ちる三角波
  const osc = audioCtx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(freq * 1.6, time);
  osc.frequency.exponentialRampToValueAtTime(freq, time + 0.01);
  osc.connect(envelope(time, peak, 0.07));
  osc.start(time);
  osc.stop(time + 0.08);

  // 打撃感: 帯域を絞った短いノイズ
  const noise = audioCtx.createBufferSource();
  noise.buffer = noiseBuffer;
  const bp = audioCtx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = freq * 2;
  bp.Q.value = 4;
  noise.connect(bp);
  bp.connect(envelope(time, peak * 0.6, 0.015));
  noise.start(time);
  noise.stop(time + 0.02);
}

function playHihat(time, level, peak) {
  const decay = { 3: 0.12, 2: 0.08, 1: 0.05, sub: 0.035 }[level];
  const noise = audioCtx.createBufferSource();
  noise.buffer = noiseBuffer;
  const hp = audioCtx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 7000;
  noise.connect(hp);
  hp.connect(envelope(time, peak, decay));
  noise.start(time);
  noise.stop(time + decay + 0.01);
}

/**
 * 指定時刻に 1 音をスケジュール
 * @param {number} time - AudioContext の再生時刻（秒）
 * @param {1|2|3|'sub'} level - アクセント段階（'sub' は細分化の音）
 * @param {number} gainScale - 追加の音量倍率
 */
function playVoice(time, level, gainScale = 1) {
  const peak = LEVEL_GAIN[level] * gainScale;
  if (peak <= 0) return;
  switch (settings.sound) {
    case 'wood':  playWood(time, 800 * LEVEL_PITCH[level], peak); break;
    case 'hihat': playHihat(time, level, peak); break;
    default:      playBeep(time, 880 * LEVEL_PITCH[level], peak);
  }
}

// =============================================
// タイマー（Web Worker）
// =============================================

/**
 * LOOKAHEAD_MS ごとに onTick を呼ぶタイマー。
 * メインスレッドの setTimeout はバックグラウンドタブで大きく間引かれ音が途切れるため、
 * 可能なら Worker 内の setInterval を使う。Worker が使えない環境（file:// 等）では setInterval にフォールバック。
 */
function createTicker(onTick) {
  const src = `let id = null;
    onmessage = (e) => {
      clearInterval(id);
      if (e.data === 'start') id = setInterval(() => postMessage(0), ${LOOKAHEAD_MS});
    };`;
  let worker = null;
  let fallbackId = null;
  let running = false;

  const startFallback = () => {
    clearInterval(fallbackId);
    fallbackId = setInterval(onTick, LOOKAHEAD_MS);
  };

  try {
    worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    worker.onmessage = onTick;
    worker.onerror = () => {
      worker = null;
      if (running) startFallback();
    };
  } catch {
    worker = null;
  }

  return {
    start() {
      running = true;
      if (worker) worker.postMessage('start');
      else startFallback();
    },
    stop() {
      running = false;
      if (worker) worker.postMessage('stop');
      clearInterval(fallbackId);
    },
  };
}

// =============================================
// スケジューラー（lookahead パターン）
// =============================================

/** 無音小節トレーニングで現在の小節がミュート対象か */
function isGapBar() {
  const { enabled, playBars, muteBars } = settings.gap;
  return enabled && barCount % (playBars + muteBars) >= playBars;
}

/** 小節の区切りで呼ばれる。テンポアップトレーナーの処理 */
function onBarEnd() {
  barCount++;
  const { enabled, everyBars, step, target } = settings.trainer;
  if (!enabled || barCount % everyBars !== 0 || settings.bpm === target) return;
  applyBPM(settings.bpm < target
    ? Math.min(settings.bpm + step, target)
    : Math.max(settings.bpm - step, target));
}

/**
 * 次の SCHEDULE_AHEAD 秒分の刻みを先行スケジュール。
 * BPM・拍子・細分化の変更は次の刻みから自動反映される。
 */
function scheduler() {
  if (!isPlaying) return;
  const now = audioCtx.currentTime;

  // タブ凍結などで大きく遅れた場合は、溜まった音を一気に鳴らさず仕切り直す
  if (nextNoteTime < now - 0.2) nextNoteTime = now + 0.05;

  while (nextNoteTime < now + SCHEDULE_AHEAD) {
    const sub = SUBDIVISIONS[settings.subdivision];
    const divisions = sub.pattern.length;
    if (subIndex >= divisions) subIndex = 0;          // 細分化を途中で変えた場合
    if (beatIndex >= settings.beats) beatIndex = 0;   // 拍子を途中で変えた場合

    const time   = nextNoteTime;
    const level  = settings.accents[beatIndex];
    const silent = isGapBar();

    if (!silent && sub.pattern[subIndex]) {
      if (subIndex === 0 || sub.offbeat) {
        if (level > 0) playVoice(time, level);
      } else {
        playVoice(time, 'sub', settings.subVolume);
      }
    }

    if (subIndex === 0) {
      visualQueue.push({ time, beat: beatIndex, level, silent });
      // 描画が止まっている（バックグラウンド）間に溜まり続けないよう上限を設ける
      if (visualQueue.length > 64) visualQueue.shift();
    }

    nextNoteTime += 60 / settings.bpm / divisions;
    if (++subIndex >= divisions) {
      subIndex = 0;
      if (++beatIndex >= settings.beats) {
        beatIndex = 0;
        onBarEnd();
      }
    }
  }
}

// =============================================
// 再生 / 停止
// =============================================

function startMetronome() {
  const ctx = ensureAudio();
  runGain = ctx.createGain();
  runGain.gain.value = settings.volume;
  runGain.connect(ctx.destination);

  beatIndex = 0;
  subIndex  = 0;
  barCount  = 0;
  visualQueue = [];
  // 再生開始時刻を少し先に設定してバッファ確保
  nextNoteTime = ctx.currentTime + 0.06;

  isPlaying = true;
  scheduler();
  ticker.start();
  rafId = requestAnimationFrame(draw);

  btnPlay.textContent = '■ 停止';
  btnPlay.classList.add('playing');
  btnPlay.setAttribute('aria-pressed', 'true');
  metronomeSection.classList.add('playing');
  requestWakeLock();
}

function stopMetronome() {
  isPlaying = false;
  ticker.stop();
  cancelAnimationFrame(rafId);
  visualQueue = [];

  // 先読み済みの音も含めて即座に消す
  if (runGain) {
    const g = runGain;
    g.gain.setTargetAtTime(0, audioCtx.currentTime, 0.005);
    setTimeout(() => g.disconnect(), 100);
    runGain = null;
  }

  clearBeatHighlight();
  btnPlay.textContent = '▶ 再生';
  btnPlay.classList.remove('playing');
  btnPlay.setAttribute('aria-pressed', 'false');
  metronomeSection.classList.remove('playing');
  releaseWakeLock();
}

// =============================================
// 画面のスリープ防止（Screen Wake Lock API）
// =============================================

/**
 * 再生中に画面が暗くならないようにする。
 * スマホを譜面台に置いて使うとき、画面が消えると表示が止まり、端末によっては音も止まるため。
 * タブを切り替えるとブラウザが自動で解除するので、戻ってきたら取り直す（visibilitychange）。
 */
async function requestWakeLock() {
  if (!('wakeLock' in navigator) || !settings.wakeLock || !isPlaying || wakeLock) return;
  try {
    const lock = await navigator.wakeLock.request('screen');
    // 取得を待つ間に停止した・設定を切った・別の取得が先に済んだ場合は返す
    if (!isPlaying || !settings.wakeLock || wakeLock) {
      lock.release().catch(() => {});
      return;
    }
    wakeLock = lock;
    lock.addEventListener('release', () => {
      if (wakeLock === lock) wakeLock = null;
    });
  } catch {
    // 省電力モードなどで拒否された場合は何もしない（メトロノーム自体は動く）
  }
}

function releaseWakeLock() {
  if (!wakeLock) return;
  wakeLock.release().catch(() => {});
  wakeLock = null;
}

// =============================================
// テーマ
// =============================================

function applyTheme(theme) {
  settings.theme = THEMES.includes(theme) ? theme : DEFAULTS.theme;
  document.documentElement.setAttribute('data-theme', settings.theme);
  themeSelect.value = settings.theme;
}

function togglePlayback() {
  if (isPlaying) stopMetronome();
  else startMetronome();
}

// =============================================
// ビジュアルフィードバック
// =============================================

/**
 * 音の再生時刻に合わせて拍を描画する（requestAnimationFrame ループ）。
 * outputLatency を考慮し、実際に音が聞こえるタイミングに近づける。
 */
function draw() {
  if (!isPlaying) return;
  const heardTime = audioCtx.currentTime - (audioCtx.outputLatency || 0);
  let current = null;
  while (visualQueue.length && visualQueue[0].time <= heardTime) {
    current = visualQueue.shift();
  }
  if (current) showBeat(current);
  rafId = requestAnimationFrame(draw);
}

function showBeat({ beat, level, silent }) {
  const dots = beatDots.children;
  for (let i = 0; i < dots.length; i++) {
    dots[i].classList.toggle('active', i === beat);
  }
  beatDots.classList.toggle('silent', silent);

  if (silent || level === 0) return;
  clearTimeout(flashTimeout);
  bpmDisplay.classList.remove('beat-flash', 'beat-flash-strong');
  bpmDisplay.classList.add(level === 3 ? 'beat-flash-strong' : 'beat-flash');
  flashTimeout = setTimeout(() => {
    bpmDisplay.classList.remove('beat-flash', 'beat-flash-strong');
  }, 90);
}

function clearBeatHighlight() {
  clearTimeout(flashTimeout);
  bpmDisplay.classList.remove('beat-flash', 'beat-flash-strong');
  beatDots.classList.remove('silent');
  for (const dot of beatDots.children) dot.classList.remove('active');
}

// =============================================
// 描画（拍ドット・拍子表示・各コントロール）
// =============================================

function beatLabel(index, level) {
  return `${index + 1} 拍目: ${LEVEL_LABELS[level]}（タップで切替）`;
}

function renderBeatDots() {
  const starts = groupStartIndexes();
  const dots = settings.accents.map((level, i) => {
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = 'beat-dot';
    if (i > 0 && starts.has(i)) dot.classList.add('group-start');
    dot.dataset.index = i;
    dot.dataset.level = level;
    dot.setAttribute('aria-label', beatLabel(i, level));
    const fill = document.createElement('span');
    fill.className = 'beat-fill';
    dot.appendChild(fill);
    return dot;
  });
  beatDots.replaceChildren(...dots);
}

function renderMeter() {
  beatsValue.textContent = settings.beats;
  unitSelect.value = settings.unit;
  if (document.activeElement !== groupsInput) groupsInput.value = settings.groups;
  groupsInput.classList.remove('invalid');
  groupsHint.textContent = '';

  const key = presetKey(settings.beats, settings.unit, settings.groups);
  presetSelect.value = PRESETS.some((p) => presetKey(p.beats, p.unit, p.groups) === key) ? key : 'custom';

  meterLabel.textContent = `${settings.beats}/${settings.unit}`
    + (settings.groups ? `（${settings.groups}）` : '');
  renderBeatDots();
}

function renderPresetOptions() {
  const options = PRESETS.map((p) => {
    const opt = document.createElement('option');
    opt.value = presetKey(p.beats, p.unit, p.groups);
    opt.textContent = `${p.beats}/${p.unit}` + (p.groups ? `（${p.groups}）` : '');
    return opt;
  });
  const custom = document.createElement('option');
  custom.value = 'custom';
  custom.textContent = 'カスタム';
  custom.hidden = true;
  presetSelect.replaceChildren(...options, custom);
}

function renderControls() {
  applyBPM(settings.bpm);
  renderPresetOptions();
  renderMeter();
  for (const radio of subdivisionRadios) radio.checked = radio.value === settings.subdivision;
  soundSelect.value     = settings.sound;
  volumeSlider.value    = Math.round(settings.volume * 100);
  subVolumeSlider.value = Math.round(settings.subVolume * 100);
  trainerEnabled.checked = settings.trainer.enabled;
  trainerEvery.value     = settings.trainer.everyBars;
  trainerStep.value      = settings.trainer.step;
  trainerTarget.value    = settings.trainer.target;
  gapEnabled.checked = settings.gap.enabled;
  gapPlay.value      = settings.gap.playBars;
  gapMute.value      = settings.gap.muteBars;
  applyTheme(settings.theme);
  wakeLockToggle.checked = settings.wakeLock;
  wakeLockSetting.hidden = !('wakeLock' in navigator);
}

// =============================================
// タップテンポ
// =============================================

function handleTap() {
  const now = performance.now();
  const last = tapTimes[tapTimes.length - 1];

  // 2 秒以上間隔が空いたら履歴をリセット
  if (last !== undefined && now - last > TAP_RESET_MS) tapTimes = [];

  // テンポを大きく変えて叩き直した場合は、古い履歴を捨てて追従させる
  if (tapTimes.length >= 2) {
    const avg = (last - tapTimes[0]) / (tapTimes.length - 1);
    const interval = now - last;
    if (interval < avg * 0.6 || interval > avg * 1.6) tapTimes = [last];
  }

  tapTimes.push(now);
  if (tapTimes.length > TAP_MAX) tapTimes.shift();

  // タップが 2 回以上あれば平均間隔から BPM を計算
  if (tapTimes.length >= 2) {
    const avgInterval = (tapTimes[tapTimes.length - 1] - tapTimes[0]) / (tapTimes.length - 1);
    applyBPM(60000 / avgInterval);
  }
}

// =============================================
// イベントバインド
// =============================================

function bindEvents() {
  // 再生 / 停止
  btnPlay.addEventListener('click', togglePlayback);

  // BPM 増減（長押しで連続変更）
  setupHoldButton(btnMinus, () => applyBPM(settings.bpm - 1));
  setupHoldButton(btnPlus,  () => applyBPM(settings.bpm + 1));

  // スライダー
  bpmSlider.addEventListener('input', () => applyBPM(toInt(bpmSlider.value, settings.bpm)));

  // 数値入力（空欄・NaN を安全に処理）
  bpmInput.addEventListener('change', () => {
    const val = parseInt(bpmInput.value, 10);
    if (!isNaN(val)) applyBPM(val);
    else bpmInput.value = settings.bpm; // 無効値は現在の BPM に戻す
  });
  bpmInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') bpmInput.blur();
  });

  // タップテンポ
  // pointerdown はタッチ・マウス両方で 1 回だけ発火し、click より反応が速い
  btnTap.addEventListener('pointerdown', (e) => {
    e.preventDefault(); // テキスト選択・スクロール防止
    handleTap();
  });
  btnTap.addEventListener('click', (e) => {
    if (e.detail === 0) handleTap(); // キーボード（Enter）操作
  });

  // 拍ドット: タップでアクセントを 強 → 中 → 弱 → 休 と切替
  beatDots.addEventListener('click', (e) => {
    const dot = e.target.closest('.beat-dot');
    if (!dot) return;
    const i = Number(dot.dataset.index);
    const level = (settings.accents[i] + 3) % 4;
    settings.accents[i] = level;
    dot.dataset.level = level;
    dot.setAttribute('aria-label', beatLabel(i, level));
    saveSettings();
  });

  // 拍子
  presetSelect.addEventListener('change', () => {
    const p = PRESETS.find((x) => presetKey(x.beats, x.unit, x.groups) === presetSelect.value);
    if (p) setMeter(p.beats, p.unit, p.groups);
  });
  setupHoldButton(btnBeatsMinus, () => {
    if (settings.beats > BEATS_MIN) setMeter(settings.beats - 1, settings.unit, defaultGroups(settings.beats - 1, settings.unit));
  });
  setupHoldButton(btnBeatsPlus, () => {
    if (settings.beats < BEATS_MAX) setMeter(settings.beats + 1, settings.unit, defaultGroups(settings.beats + 1, settings.unit));
  });
  unitSelect.addEventListener('change', () => {
    const unit = toInt(unitSelect.value, 4);
    setMeter(settings.beats, unit, defaultGroups(settings.beats, unit));
  });

  // グルーピング: 入力中も有効な値なら即反映、不正なら合計を案内
  groupsInput.addEventListener('input', () => {
    const groups = normalizeGroups(groupsInput.value, settings.beats);
    if (groups === null) {
      groupsInput.classList.add('invalid');
      const sum = groupsInput.value.split('+').reduce((a, b) => a + (parseInt(b, 10) || 0), 0);
      groupsHint.textContent = `合計 ${sum} 拍（${settings.beats} 拍にしてください）`;
      return;
    }
    setMeter(settings.beats, settings.unit, groups);
  });
  groupsInput.addEventListener('change', () => {
    // 不正なまま離れたら元に戻す（拍ドットは再描画しない: 直後のタップを取りこぼすため）
    groupsInput.value = settings.groups;
    groupsInput.classList.remove('invalid');
    groupsHint.textContent = '';
  });

  btnResetAccents.addEventListener('click', () => {
    settings.accents = buildAccents(settings.beats, settings.groups);
    renderBeatDots();
    saveSettings();
  });

  // 細分化
  for (const radio of subdivisionRadios) {
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      settings.subdivision = radio.value;
      saveSettings();
    });
  }

  // サウンド
  soundSelect.addEventListener('change', () => {
    settings.sound = SOUNDS.includes(soundSelect.value) ? soundSelect.value : 'beep';
    saveSettings();
  });
  volumeSlider.addEventListener('input', () => {
    settings.volume = toInt(volumeSlider.value, 80) / 100;
    if (runGain) runGain.gain.setTargetAtTime(settings.volume, audioCtx.currentTime, 0.01);
    saveSettings();
  });
  subVolumeSlider.addEventListener('input', () => {
    settings.subVolume = toInt(subVolumeSlider.value, 50) / 100;
    saveSettings();
  });

  // 練習: テンポアップトレーナー / 無音小節
  const bindNumber = (input, min, max, apply) => {
    input.addEventListener('change', () => {
      const val = clamp(toInt(input.value, min), min, max);
      input.value = val;
      apply(val);
      saveSettings();
    });
  };
  trainerEnabled.addEventListener('change', () => {
    settings.trainer.enabled = trainerEnabled.checked;
    saveSettings();
  });
  bindNumber(trainerEvery,  1, 64, (v) => { settings.trainer.everyBars = v; });
  bindNumber(trainerStep,   1, 50, (v) => { settings.trainer.step = v; });
  bindNumber(trainerTarget, BPM_MIN, BPM_MAX, (v) => { settings.trainer.target = v; });
  gapEnabled.addEventListener('change', () => {
    settings.gap.enabled = gapEnabled.checked;
    saveSettings();
  });
  bindNumber(gapPlay, 1, 64, (v) => { settings.gap.playBars = v; });
  bindNumber(gapMute, 1, 64, (v) => { settings.gap.muteBars = v; });

  // 設定: テーマ・画面スリープ防止
  themeSelect.addEventListener('change', () => {
    applyTheme(themeSelect.value);
    saveSettings();
  });
  wakeLockToggle.addEventListener('change', () => {
    settings.wakeLock = wakeLockToggle.checked;
    if (settings.wakeLock) requestWakeLock();
    else releaseWakeLock();
    saveSettings();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') requestWakeLock();
  });

  // ホーム画面への追加（インストールできるブラウザでだけボタンを出す）
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // ブラウザ標準の案内の代わりに「設定」のボタンから追加してもらう
    installPrompt = e;
    installSetting.hidden = false;
  });
  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    installSetting.hidden = true;
  });
  btnInstall.addEventListener('click', async () => {
    if (!installPrompt) return;
    const prompt = installPrompt;
    installPrompt = null; // 同じイベントは 1 回しか使えない
    installSetting.hidden = true;
    prompt.prompt();
    await prompt.userChoice.catch(() => {});
  });

  // キーボードショートカット
  document.addEventListener('keydown', handleShortcut);
  document.addEventListener('keyup', (e) => {
    // ボタンにフォーカスがあるとき Space の keyup で click が二重に発火するのを防ぐ
    if (e.code === 'Space' && e.target.tagName === 'BUTTON') e.preventDefault();
  });
}

/** 文字入力中はショートカットを無効にする（ラジオ・チェックボックス・スライダーは対象外） */
function isTextEntry(el) {
  if (!el) return false;
  if (el.tagName === 'INPUT') return !['radio', 'checkbox', 'range', 'button'].includes(el.type);
  return ['SELECT', 'TEXTAREA'].includes(el.tagName) || el.isContentEditable;
}

/**
 * Space: 再生 / 停止
 * ↑ / ↓: BPM ±1（Shift で ±10）
 * T: タップテンポ
 */
function handleShortcut(e) {
  if (e.ctrlKey || e.metaKey || e.altKey || isTextEntry(e.target)) return;

  if (e.code === 'Space') {
    // 折りたたみの開閉・チェックボックスの切替を優先
    if (e.target.tagName === 'SUMMARY' || e.target.type === 'checkbox') return;
    e.preventDefault();
    if (!e.repeat) togglePlayback();
    return;
  }

  const delta = e.shiftKey ? 10 : 1;
  switch (e.key) {
    case 'ArrowUp':
    case 'ArrowDown':
      if (e.target.tagName === 'INPUT') return; // ラジオ・スライダー本来の矢印操作を優先
      e.preventDefault();
      applyBPM(settings.bpm + (e.key === 'ArrowUp' ? delta : -delta));
      break;
    case 't':
    case 'T':
      if (!e.repeat) handleTap();
      break;
  }
}

/**
 * ボタンを押し続けると callback を繰り返す。
 * - 押した瞬間に 1 回、500ms 以上押し続けると 80ms 間隔で連射
 * - Pointer Events でマウス・タッチを統一的に扱う
 * - キーボード操作（Enter / Space）は click（detail === 0）で 1 回実行
 */
function setupHoldButton(btn, callback) {
  let holdTimer = null;
  let repeatTimer = null;

  const stop = () => {
    clearTimeout(holdTimer);
    clearInterval(repeatTimer);
    holdTimer = repeatTimer = null;
  };

  btn.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    stop();
    callback();
    holdTimer = setTimeout(() => {
      repeatTimer = setInterval(callback, 80);
    }, 500);
  });
  btn.addEventListener('pointerup', stop);
  btn.addEventListener('pointerleave', stop);
  btn.addEventListener('pointercancel', stop);
  btn.addEventListener('click', (e) => {
    if (e.detail === 0) callback();
  });
  // 長押しでコンテキストメニューが出るのを防ぐ（モバイル）
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
}

// =============================================
// 起動
// =============================================
renderControls();
bindEvents();

// オフラインでも使えるように Service Worker を登録する（https または localhost でのみ動作）
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      // file:// で開いた場合などは登録できないが、メトロノーム自体は動く
    });
  });
}
