/**
 * ブラウザピアノ - piano.js（画面と操作）
 *
 * - タップ・クリックは Pointer Events。指ごと（pointerId）に押している鍵を持つので、複数の指で和音になる。
 *   指を横にすべらせると隣の鍵に移る（グリッサンド）
 * - パソコンのキーは KeyboardEvent.code で割り当てる（配列・入力モードに左右されない）。画面のキーの文字は
 *   navigator.keyboard.getLayoutMap()（対応ブラウザ）か、実際に押された文字から合わせる
 * - 最初の操作の中で AudioContext を作り、resume する（それより前は音を出せない）
 */
(function () {
  'use strict';
  const Core = window.PianoCore;
  const synth = new window.PianoSynth();
  const STORAGE_KEY = 'web-metronome_piano';
  const $ = (id) => document.getElementById(id);

  const keysEl = $('keys');
  const stage = $('stage');

  // ---- 設定 ----
  let settings = Core.normalizeSettings(null);
  try {
    settings = Core.normalizeSettings(JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'));
  } catch (e) { /* 保存が使えない環境では既定値 */ }
  const save = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        names: settings.names, volume: settings.volume, start: settings.start, layout: settings.layout, bpm: settings.bpm,
      }));
    } catch (e) { /* 保存できなくても弾ける */ }
  };
  if (!settings.layout) settings.layout = /^ja\b/i.test(navigator.language || '') ? 'jis' : 'us';
  const learned = {}; // code → 実際のキーの文字
  synth.setVolume(settings.volume / 100);

  // ---- 鍵盤の描画 ----
  let whites = 15;
  let keyEls = new Map(); // midi → element

  function whitesForWidth(w) {
    const n = Math.max(8, Math.min(29, Math.floor(w / 52)));
    return Math.floor((n - 1) / 7) * 7 + 1; // 8・15・22・29（ドで始まりドで終わる）
  }

  function showLabels() {
    return document.documentElement.classList.contains('has-keyboard');
  }

  // 鍵の縦横比を本物のピアノに近く（白鍵の長さは幅の 6.5 倍まで）。パソコンの大きな画面で縦に伸びすぎないように
  function fitHeight() {
    const w = (stage.clientWidth - 12) / whites;
    const avail = stage.clientHeight - 6;
    keysEl.style.height = Math.max(120, Math.min(avail, Math.round(w * 6.5))) + 'px';
  }

  function render() {
    whites = whitesForWidth(stage.clientWidth || window.innerWidth);
    fitHeight();
    settings.start = Core.clampStart(settings.start, whites);
    const keys = Core.keyboardRange(settings.start, whites);
    const frag = document.createDocumentFragment();
    keyEls = new Map();
    const ww = 100 / whites;
    for (const k of keys) {
      const el = document.createElement('div');
      el.className = k.black ? 'key black' : 'key white';
      el.dataset.midi = String(k.midi);
      el.setAttribute('role', 'button');
      el.setAttribute('aria-label', Core.noteName(k.midi, 'doremi') + '（' + Core.noteName(k.midi, 'cde') + '）');
      if (k.black) {
        el.style.left = ((k.whiteIndex + 1) * ww - ww * 0.3) + '%';
        el.style.width = (ww * 0.6) + '%';
      } else {
        el.style.left = (k.whiteIndex * ww) + '%';
        el.style.width = ww + '%';
      }
      const name = document.createElement('span');
      name.className = 'name';
      el.appendChild(name);
      const kb = document.createElement('span');
      kb.className = 'kbd';
      el.appendChild(kb);
      if (k.midi === 60) el.classList.add('middle-c');
      if (held.has(k.midi)) el.classList.add('down');
      keyEls.set(k.midi, el);
      frag.appendChild(el);
    }
    keysEl.replaceChildren(frag);
    updateLabels();
    const last = keys.filter((k) => !k.black).pop();
    $('rangeLabel').textContent = Core.noteName(settings.start, 'cde') + '〜' + Core.noteName(last.midi, 'cde');
    $('octDown').disabled = settings.start <= 24;
    $('octUp').disabled = Core.clampStart(settings.start + 12, whites) === settings.start;
    document.documentElement.classList.toggle('narrow', whites <= 8);
  }

  function updateLabels() {
    for (const [midi, el] of keyEls) {
      const name = el.firstChild;
      const kb = el.lastChild;
      const black = el.classList.contains('black');
      if (settings.names === 'none') name.textContent = '';
      else if (settings.names === 'doremi') name.textContent = black ? '' : Core.noteName(midi, 'doremi');
      else name.textContent = black ? '' : Core.noteName(midi, 'cde');
      const codes = Core.codesForMidi(midi, settings.start);
      kb.textContent = showLabels() ? codes.map((c) => Core.keyLabel(c, settings.layout, learned)).join(' ') : '';
    }
  }

  // ---- 押している鍵（指・キー・マウスのどれで押しているか） ----
  const held = new Map(); // midi → Set(源)
  function press(midi, src) {
    if (midi == null || midi < Core.LOWEST || midi > Core.HIGHEST) return;
    let s = held.get(midi);
    if (!s) {
      s = new Set();
      held.set(midi, s);
    }
    if (s.size === 0) {
      synth.noteOn(midi, 0.8);
      const el = keyEls.get(midi);
      if (el) el.classList.add('down');
    }
    s.add(src);
  }
  function release(midi, src) {
    const s = held.get(midi);
    if (!s || !s.delete(src)) return;
    if (s.size === 0) {
      held.delete(midi);
      synth.noteOff(midi);
      const el = keyEls.get(midi);
      if (el) el.classList.remove('down');
    }
  }
  function releaseAll() {
    for (const [midi, s] of [...held]) for (const src of [...s]) release(midi, src);
    pointers.clear();
    codeNotes.clear();
  }

  // ---- タップ・クリック（Pointer Events） ----
  const pointers = new Map(); // pointerId → midi
  function midiAt(x, y) {
    const el = document.elementFromPoint(x, y);
    const key = el && el.closest ? el.closest('.key') : null;
    return key ? Number(key.dataset.midi) : null;
  }
  stage.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    e.preventDefault();
    synth.unlock();
    // タッチは押した要素に捕まえられるので外し、指の下の鍵を毎回探す（グリッサンドのため）
    if (e.target.hasPointerCapture && e.target.hasPointerCapture(e.pointerId)) e.target.releasePointerCapture(e.pointerId);
    const midi = midiAt(e.clientX, e.clientY);
    pointers.set(e.pointerId, midi);
    press(midi, 'p' + e.pointerId);
  });
  stage.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    const midi = midiAt(e.clientX, e.clientY);
    const old = pointers.get(e.pointerId);
    if (midi === old) return;
    release(old, 'p' + e.pointerId);
    pointers.set(e.pointerId, midi);
    press(midi, 'p' + e.pointerId);
  });
  const up = (e) => {
    if (!pointers.has(e.pointerId)) return;
    release(pointers.get(e.pointerId), 'p' + e.pointerId);
    pointers.delete(e.pointerId);
  };
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
  stage.addEventListener('contextmenu', (e) => e.preventDefault());
  // 画面のボタンを押したあとにフォーカスを外す（Space をサステインに使うので、ボタンが Space で押されないように）
  $('bar').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b && e.detail > 0) b.blur();
  });

  // ---- パソコンのキー ----
  const codeNotes = new Map(); // code → 押したときの midi（押している間に音域を変えても正しく離すため）
  let spaceSustain = false;
  function isTyping(t) {
    return !!t && (t.tagName === 'INPUT' && t.type === 'number' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  }
  // ラジオ・スライダーにフォーカスがあるときの矢印と Space は、その部品の操作として残す
  const isFormControl = (t) => !!t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName);
  function markKeyboard() {
    if (!document.documentElement.classList.contains('has-keyboard')) {
      document.documentElement.classList.add('has-keyboard');
      updateLabels();
    }
  }
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
    const code = e.code;
    if ((code === 'Space' || code.startsWith('Arrow')) && isFormControl(e.target)) return;
    if (code === 'Space') {
      e.preventDefault();
      if (!e.repeat && !spaceSustain) {
        spaceSustain = true;
        applySustain();
      }
      return;
    }
    if (code === 'ArrowLeft' || code === 'ArrowRight') {
      e.preventDefault();
      if (!e.repeat) shiftOctave(code === 'ArrowLeft' ? -1 : 1);
      return;
    }
    const midi = Core.midiForCode(code, settings.start);
    if (midi == null) return;
    e.preventDefault();
    markKeyboard();
    learnKey(code, e.key, e.shiftKey);
    if (e.repeat || codeNotes.has(code)) return;
    synth.unlock();
    codeNotes.set(code, midi);
    press(midi, 'k' + code);
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') {
      spaceSustain = false;
      applySustain();
      return;
    }
    if (!codeNotes.has(e.code)) return;
    release(codeNotes.get(e.code), 'k' + e.code);
    codeNotes.delete(e.code);
  });
  window.addEventListener('blur', releaseAll);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) releaseAll();
  });

  function learnKey(code, key, shift) {
    if (shift || typeof key !== 'string' || key.length !== 1) return;
    const guess = Core.guessLayout(code, key);
    const label = key.toUpperCase();
    let changed = false;
    if (guess && guess !== settings.layout) {
      settings.layout = guess;
      save();
      changed = true;
    }
    if (learned[code] !== label) {
      learned[code] = label;
      changed = true;
    }
    if (changed) updateLabels();
  }

  // 対応ブラウザ（Chrome・Edge のパソコン版）は、配列の実際の文字を最初から読める
  if (navigator.keyboard && navigator.keyboard.getLayoutMap) {
    navigator.keyboard.getLayoutMap().then((map) => {
      for (const code of Object.keys(Core.KEY_OFFSETS)) {
        const ch = map.get(code);
        if (ch) learned[code] = ch.toUpperCase();
      }
      const g = Core.guessLayout('BracketLeft', map.get('BracketLeft'));
      if (g) settings.layout = g;
      updateLabels();
    }).catch(() => {});
  }
  // マウスやトラックパッドのある端末は、はじめからキーの文字を出す
  if (window.matchMedia && matchMedia('(any-hover: hover) and (any-pointer: fine)').matches) {
    document.documentElement.classList.add('has-keyboard');
  }

  // ---- 音域・音名・サステイン・音量 ----
  function shiftOctave(dir) {
    const next = Core.clampStart(settings.start + dir * 12, whites);
    if (next === settings.start) return;
    settings.start = next;
    save();
    render();
  }
  $('octDown').addEventListener('click', () => shiftOctave(-1));
  $('octUp').addEventListener('click', () => shiftOctave(1));

  document.querySelectorAll('input[name="names"]').forEach((r) => {
    r.checked = r.value === settings.names;
    r.addEventListener('change', () => {
      settings.names = r.value;
      save();
      updateLabels();
    });
  });

  let sustainToggle = false;
  function applySustain() {
    const on = sustainToggle || spaceSustain;
    synth.setSustain(on);
    $('sustainBtn').setAttribute('aria-pressed', String(on));
  }
  $('sustainBtn').addEventListener('click', () => {
    sustainToggle = !sustainToggle;
    applySustain();
  });

  const vol = $('volume');
  vol.value = String(settings.volume);
  vol.addEventListener('input', () => {
    settings.volume = Number(vol.value);
    synth.setVolume(settings.volume / 100);
    save();
  });

  // ---- クリック（かんたんなメトロノーム。4 拍ごとに 1 拍目を高く） ----
  const bpmEl = $('bpm');
  bpmEl.value = String(settings.bpm);
  let clickTimer = null;
  let nextBeat = 0;
  let beat = 0;
  function scheduler() {
    const ctx = synth.ctx;
    while (nextBeat < ctx.currentTime + 0.12) {
      synth.click(nextBeat, beat % 4 === 0);
      nextBeat += 60 / settings.bpm;
      beat++;
    }
  }
  function setClick(on) {
    if (on && !synth.unlock()) return;
    $('clickBtn').setAttribute('aria-pressed', String(on));
    if (clickTimer) clearInterval(clickTimer);
    clickTimer = null;
    if (on) {
      nextBeat = synth.ctx.currentTime + 0.06;
      beat = 0;
      scheduler();
      clickTimer = setInterval(scheduler, 25);
    }
  }
  $('clickBtn').addEventListener('click', () => setClick(!clickTimer));
  bpmEl.addEventListener('change', () => {
    const s = Core.normalizeSettings({ bpm: bpmEl.value });
    settings.bpm = s.bpm;
    bpmEl.value = String(s.bpm);
    save();
  });

  // ---- 大きさの変化 ----
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (whitesForWidth(stage.clientWidth) !== whites) render();
      else fitHeight();
    }, 100);
  });

  render();

  // オフラインで開けるように（メトロノームと同じ sw.js。スコープは /web-metronome/）
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('../sw.js').catch(() => {});
  }

  // テスト用（Playwright から中を見る）
  window.__piano = { synth, held, settings, render };
})();
