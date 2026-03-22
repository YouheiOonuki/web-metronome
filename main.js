/**
 * Web Metronome - main.js
 * Web Audio API を使った精度の高いメトロノーム。
 * lookahead スケジューラーパターンで音ズレを最小化。
 */

'use strict';

// =============================================
// DOM 要素
// =============================================
const bpmDisplay  = document.getElementById('bpmDisplay');
const bpmSlider   = document.getElementById('bpmSlider');
const bpmInput    = document.getElementById('bpmInput');
const btnMinus    = document.getElementById('btnMinus');
const btnPlus     = document.getElementById('btnPlus');
const btnPlay     = document.getElementById('btnPlay');
const btnTap      = document.getElementById('btnTap');

// =============================================
// 状態変数
// =============================================
let audioCtx      = null;   // AudioContext（初回再生時に生成）
let isPlaying     = false;  // 再生中フラグ
let nextNoteTime  = 0;      // 次のビートをスケジュールする AudioContext 時刻
let schedulerTimer = null;  // setTimeout ハンドル

// BPM（1〜500）。localStorage から復元、なければ 120
let currentBPM = parseInt(localStorage.getItem('bpm'), 10) || 120;
currentBPM = clamp(currentBPM, 1, 500);

// スケジューラー設定
const LOOKAHEAD     = 25.0;   // スケジューラー呼び出し間隔 (ms)
const SCHEDULE_AHEAD = 0.1;   // 先読み時間 (秒)

// タップテンポ用
const TAP_MAX      = 8;       // 保持するタップ履歴の最大数
const TAP_RESET_MS = 2000;    // この間隔以上あいたらリセット (ms)
let tapTimes = [];            // タップ時刻の配列

// =============================================
// 初期化
// =============================================
function init() {
  applyBPM(currentBPM);
  bindEvents();
}

// =============================================
// BPM ユーティリティ
// =============================================

/** 値を min〜max にクランプ */
function clamp(value, min, max) {
  return Math.min(Math.max(Math.round(value), min), max);
}

/**
 * BPM を設定して UI と localStorage を更新する。
 * 再生中でも次のスケジュールから反映される（リセット不要）。
 */
function applyBPM(bpm) {
  currentBPM = clamp(bpm, 1, 500);
  bpmDisplay.textContent = currentBPM;
  bpmSlider.value  = currentBPM;
  bpmInput.value   = currentBPM;
  localStorage.setItem('bpm', currentBPM);
}

// =============================================
// Web Audio API: AudioContext
// =============================================

/** AudioContext を遅延生成（ブラウザの自動再生ポリシー対策） */
function getAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  // suspended 状態なら resume（モバイル対策）
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

/**
 * クリック音を指定時刻にスケジュール
 * @param {number} time - AudioContext の再生時刻（秒）
 * @param {boolean} accent - アクセント拍かどうか（将来の拍子機能用）
 */
function scheduleClick(time, accent = false) {
  const ctx  = getAudioContext();
  const osc  = ctx.createOscillator();
  const gain = ctx.createGain();

  // アクセント拍は高め、通常拍は低め
  osc.frequency.value = accent ? 1000 : 800;
  osc.type = 'sine';

  // 急激なアタック → 短いリリースで「クリック感」を演出
  gain.gain.setValueAtTime(0, time);
  gain.gain.linearRampToValueAtTime(accent ? 0.8 : 0.5, time + 0.003);
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.05);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(time);
  osc.stop(time + 0.06);
}

// =============================================
// スケジューラー（lookahead パターン）
// =============================================

/**
 * 次の SCHEDULE_AHEAD 秒分のクリック音を先行スケジュール。
 * setTimeout で LOOKAHEAD ms ごとに呼ばれ続ける。
 * currentBPM の変更は次のスケジュールから自動反映される。
 */
function scheduler() {
  const ctx = getAudioContext();
  const secondsPerBeat = 60.0 / currentBPM;

  while (nextNoteTime < ctx.currentTime + SCHEDULE_AHEAD) {
    scheduleClick(nextNoteTime, true); // 現在は全拍アクセントなし（true = 単音）

    // ビジュアルフラッシュは実際のビート時刻に合わせて遅延実行
    // （先読みスケジュール時に即時呼ぶと視覚フィードバックがズレるため）
    const flashDelay = Math.max(0, (nextNoteTime - ctx.currentTime) * 1000);
    setTimeout(flashBeat, flashDelay);

    nextNoteTime += secondsPerBeat;
  }

  schedulerTimer = setTimeout(scheduler, LOOKAHEAD);
}

// =============================================
// 再生 / 停止
// =============================================

function startMetronome() {
  const ctx = getAudioContext();
  // 再生開始時刻を少し先に設定してバッファ確保
  nextNoteTime = ctx.currentTime + 0.05;
  scheduler();
  isPlaying = true;
  btnPlay.textContent = '■ 停止';
  btnPlay.classList.add('playing');
  btnPlay.setAttribute('aria-pressed', 'true');
}

function stopMetronome() {
  clearTimeout(schedulerTimer);
  isPlaying = false;
  btnPlay.textContent = '▶ 再生';
  btnPlay.classList.remove('playing');
  btnPlay.setAttribute('aria-pressed', 'false');
}

function togglePlayback() {
  if (isPlaying) {
    stopMetronome();
  } else {
    startMetronome();
  }
}

// =============================================
// ビジュアルフィードバック（BPM 数字のフラッシュ）
// =============================================

let flashTimeout = null;

/**
 * ビートに合わせて bpmDisplay を一瞬点灯させる。
 * AudioContext の時刻ではなく setTimeout で視覚フィードバックのみ実行。
 */
function flashBeat() {
  // 既にフラッシュ中なら何もしない
  if (flashTimeout) return;

  bpmDisplay.classList.add('beat-flash');
  flashTimeout = setTimeout(() => {
    bpmDisplay.classList.remove('beat-flash');
    flashTimeout = null;
  }, 80);
}

// =============================================
// タップテンポ
// =============================================

function handleTap() {
  const now = Date.now();

  // 2 秒以上間隔が空いたら履歴をリセット
  if (tapTimes.length > 0 && now - tapTimes[tapTimes.length - 1] > TAP_RESET_MS) {
    tapTimes = [];
  }

  tapTimes.push(now);

  // 直近 TAP_MAX 件だけ保持
  if (tapTimes.length > TAP_MAX) {
    tapTimes.shift();
  }

  // タップが 2 回以上あれば BPM を計算
  if (tapTimes.length >= 2) {
    const intervals = [];
    for (let i = 1; i < tapTimes.length; i++) {
      intervals.push(tapTimes[i] - tapTimes[i - 1]);
    }
    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const tappedBPM = Math.round(60000 / avgInterval);
    applyBPM(tappedBPM);
  }
}

// =============================================
// イベントバインド
// =============================================

function bindEvents() {
  // 再生 / 停止
  btnPlay.addEventListener('click', togglePlayback);

  // BPM 増減ボタン
  btnMinus.addEventListener('click', () => applyBPM(currentBPM - 1));
  btnPlus.addEventListener('click',  () => applyBPM(currentBPM + 1));

  // 長押しで連続変更（mousedown / touchstart で繰り返し）
  setupHoldButton(btnMinus, () => applyBPM(currentBPM - 1));
  setupHoldButton(btnPlus,  () => applyBPM(currentBPM + 1));

  // スライダー
  bpmSlider.addEventListener('input', () => applyBPM(parseInt(bpmSlider.value, 10)));

  // 数値入力（空欄・NaN を安全に処理）
  bpmInput.addEventListener('change', () => {
    const val = parseInt(bpmInput.value, 10);
    if (!isNaN(val)) applyBPM(val);
    else bpmInput.value = currentBPM; // 無効値は現在の BPM に戻す
  });
  bpmInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') bpmInput.blur();
  });

  // タップテンポ
  // pointerdown はタッチ・マウス両方で1回だけ発火するため二重防止不要
  btnTap.addEventListener('pointerdown', (e) => {
    e.preventDefault(); // テキスト選択・スクロール防止
    handleTap();
  });
}

/**
 * ボタンを押し続けると callback を繰り返す。
 * - 短タップ（< 500ms）: touchend 時に callback を 1 回呼ぶ
 * - 長押し（>= 500ms）: 80ms 間隔で連射
 * touchstart で preventDefault() するため click は発火しない点に注意。
 * そのため PC の click リスナーとは独立して実装している。
 */
function setupHoldButton(btn, callback) {
  let holdTimer = null;
  let repeatTimer = null;
  let holdFired = false; // 長押しリピートが発動したかどうか

  const start = (e) => {
    if (e.type === 'touchstart') e.preventDefault(); // click の二重発火を防ぐ
    holdFired = false;
    holdTimer = setTimeout(() => {
      holdFired = true;
      repeatTimer = setInterval(callback, 80);
    }, 500);
  };

  const stopRepeat = () => {
    clearTimeout(holdTimer);
    clearInterval(repeatTimer);
  };

  btn.addEventListener('mousedown',  start);
  btn.addEventListener('touchstart', start, { passive: false });

  // touchend: 短タップなら 1 回コールバック（click が発火しないため）
  btn.addEventListener('touchend', () => {
    if (!holdFired) callback();
    stopRepeat();
  });

  btn.addEventListener('mouseup',    stopRepeat);
  btn.addEventListener('mouseleave', stopRepeat);
  btn.addEventListener('touchcancel', stopRepeat);
}

// =============================================
// 起動
// =============================================
init();
