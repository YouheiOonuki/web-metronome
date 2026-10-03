/**
 * ドラムマシン - drum.js（画面・再生・書き出し・MIDI 送信・保存）
 * 計算は drum-core.js、音は drum-synth.js。再生は Web Audio の先読みスケジューラー（25 ms ごとに 0.12 秒先までを予約）
 */
(function () {
  'use strict';
  const Core = window.DrumCore;
  const Synth = window.DrumSynth;
  const KEY = 'web-metronome_drum';
  const $ = (id) => document.getElementById(id);

  // ---- 状態 ----
  let fromShare = false;
  let st = load();
  const hash = location.hash.match(/^#p=(.+)$/);
  if (hash) {
    const shared = Core.decodeShare(decodeURIComponent(hash[1]));
    if (shared) { st = Object.assign(shared, { volume: st.volume, loops: st.loops, midiChannel: st.midiChannel }); fromShare = true; }
  }

  function load() {
    try { return Core.normalizeState(JSON.parse(localStorage.getItem(KEY) || 'null')); } catch (e) { return Core.normalizeState(null); }
  }
  let saveTimer = 0;
  function save() {
    if (fromShare) { fromShare = false; history.replaceState(null, '', location.pathname); }
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) { /* 保存できない環境でも動かす */ } }, 200);
  }
  function setStatus(t) { $('status').textContent = t; }

  // ---- 部品の初期化 ----
  for (let i = 1; i <= 16; i++) $('num').add(new Option(String(i), String(i)));
  for (let i = 1; i <= 16; i++) $('midiCh').add(new Option(String(i) + (i === 10 ? '（ドラム）' : ''), String(i)));
  for (const p of Core.PRESETS) $('preset').add(new Option(p.name, p.id));

  function syncControls() {
    $('bpm').value = st.bpm;
    $('num').value = String(st.num);
    $('den').value = String(st.den);
    $('grid-res').value = st.grid;
    $('bars').value = String(st.bars);
    $('unit').value = st.unit;
    $('swing').value = st.swing;
    $('swingOut').textContent = st.swing + '%';
    $('swing').disabled = !Core.swingApplies(st.grid);
    $('volume').value = st.volume;
    $('loops').value = st.loops;
    $('midiCh').value = String(st.midiChannel);
    $('unitLabel').textContent = { q: '♩=', e: '♪=', dq: '♩.=' }[st.unit];
    for (const o of $('grid-res').options) o.disabled = !Core.stepsPerBar(st.num, st.den, o.value);
    const parts = [Core.meterLabel(st)];
    if (st.bars > 1) parts.push(st.bars + ' 小節');
    if (Core.swingApplies(st.grid) && st.swing !== 50) parts.push('スイング ' + st.swing + '%');
    $('moreSum').textContent = 'くわしい設定: ' + parts.join('・');
  }

  // ---- マスを描く ----
  let cells = []; // [step] → { trackId: button }
  function render() {
    const grid = $('grid');
    grid.textContent = '';
    cells = [];
    const n = Core.totalSteps(st);
    const one = Core.stepsPerBar(st.num, st.den, st.grid);
    const beat = Core.stepsPerBeat(st.den, st.grid) || 1;
    const width = grid.clientWidth || 360;
    // 広い画面は音の名前、狭い画面は 2 文字の略号（BD・SD…。名前は title と読み上げに入る）
    const wide = width >= 600;
    const label = wide ? 88 : 32;
    const columns = Math.max(1, Math.floor((width - label - 2) / 42));
    const chunk = Core.rowChunk(st, columns);
    for (let b = 0; b < st.bars; b++) {
      for (let s0 = 0; s0 < one; s0 += chunk) {
        const len = Math.min(chunk, one - s0);
        const box = document.createElement('div');
        box.className = 'chunk';
        box.style.gridTemplateColumns = `${label}px repeat(${len}, 40px)`;
        box.setAttribute('role', 'group');
        box.setAttribute('aria-label', `${b + 1} 小節目 ${s0 + 1}〜${s0 + len} マス`);
        box.appendChild(document.createElement('span'));
        for (let k = 0; k < len; k++) {
          const h = document.createElement('span');
          h.className = 'chunk-head';
          const s = s0 + k;
          h.textContent = s % beat === 0 ? String(s / beat + 1) : '';
          box.appendChild(h);
        }
        for (const tr of Core.TRACKS) {
          const nm = document.createElement('span');
          nm.className = 'track-name';
          nm.textContent = wide ? tr.name : tr.short;
          nm.title = tr.name;
          box.appendChild(nm);
          for (let k = 0; k < len; k++) {
            const i = b * one + s0 + k;
            const c = document.createElement('button');
            c.type = 'button';
            c.className = 'cell';
            if ((s0 + k) % beat === 0) c.classList.add('beat-start');
            c.dataset.track = tr.id;
            c.dataset.step = String(i);
            paintCell(c, st.pattern[tr.id][i], tr, i);
            box.appendChild(c);
            (cells[i] = cells[i] || {})[tr.id] = c;
          }
        }
        grid.appendChild(box);
      }
    }
    if (n === 0) setStatus('この拍子とマスの細かさの組み合わせは作れません。');
  }

  function paintCell(c, v, tr, i) {
    c.classList.toggle('lv1', v === 1);
    c.classList.toggle('lv2', v === 2);
    c.setAttribute('aria-label', `${tr.name} ${i + 1} マス目: ${v === 2 ? '強' : v === 1 ? '弱' : '空'}`);
  }

  $('grid').addEventListener('click', (e) => {
    const c = e.target.closest('.cell');
    if (!c || !c.dataset.track) return;
    const id = c.dataset.track;
    const i = Number(c.dataset.step);
    const v = Core.nextLevel(st.pattern[id][i]);
    st.pattern[id][i] = v;
    paintCell(c, v, Core.TRACKS.find((t) => t.id === id), i);
    if (v && !playing) { unlock(); Synth.hit(ctx, out, noise, id, ctx.currentTime + 0.01, Core.LEVEL_GAIN[v]); }
    save();
  });

  // ---- 音 ----
  let ctx = null;
  let out = null;
  let noise = null;
  function unlock() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC({ latencyHint: 'interactive' });
      out = Synth.makeOutput(ctx, gainFor(st.volume));
      noise = Synth.makeNoise(ctx, 2);
    }
    if (ctx.state !== 'running') ctx.resume().catch(() => {});
  }
  function gainFor(v) { return 0.9 * (v / 100) * (v / 100); }

  let playing = false;
  let timer = 0;
  let loopStart = 0;
  let stepIdx = 0;
  let timing = null;
  const drawQueue = [];

  function play() {
    unlock();
    playing = true;
    timing = Core.stepTimes(st);
    loopStart = ctx.currentTime + 0.06;
    stepIdx = 0;
    timer = setInterval(schedule, 25);
    schedule();
    requestAnimationFrame(draw);
    $('playBtn').setAttribute('aria-pressed', 'true');
    $('playIcon').textContent = '■';
    $('playText').textContent = '止める';
    wakeLock(true);
  }
  function stop() {
    playing = false;
    clearInterval(timer);
    drawQueue.length = 0;
    markNow(-1);
    $('playBtn').setAttribute('aria-pressed', 'false');
    $('playIcon').textContent = '▶';
    $('playText').textContent = '再生';
    midiAllOff();
    wakeLock(false);
  }

  function schedule() {
    const n = timing.times.length;
    if (!n) return;
    while (true) {
      if (stepIdx >= n) { loopStart += timing.loop; stepIdx = 0; }
      const t = loopStart + timing.times[stepIdx];
      if (t > ctx.currentTime + 0.12) break;
      if (t >= ctx.currentTime - 0.02) {
        for (const tr of Core.TRACKS) {
          const v = st.pattern[tr.id][stepIdx];
          if (!v) continue;
          if (!midiOut || $('localSound').checked) Synth.hit(ctx, out, noise, tr.id, t, Core.LEVEL_GAIN[v]);
          if (midiOut) midiNote(tr.gm, Core.LEVEL_VELOCITY[v], t);
        }
        drawQueue.push({ t, i: stepIdx });
      }
      stepIdx++;
    }
  }

  /** テンポ・拍子が変わったら、今のマスの位置を保ったまま時刻を作り直す */
  function retime() {
    if (!playing) return;
    const n = Core.totalSteps(st);
    const next = Core.stepTimes(st);
    const now = ctx.currentTime;
    if (stepIdx >= n) stepIdx = 0;
    loopStart = now + 0.03 - next.times[stepIdx];
    timing = next;
  }

  let nowStep = -1;
  function markNow(i) {
    if (nowStep >= 0 && cells[nowStep]) for (const c of Object.values(cells[nowStep])) c.classList.remove('now');
    nowStep = i;
    if (i >= 0 && cells[i]) for (const c of Object.values(cells[i])) c.classList.add('now');
  }
  function draw() {
    if (!playing) return;
    let cur = null;
    while (drawQueue.length && drawQueue[0].t <= ctx.currentTime) cur = drawQueue.shift();
    if (cur) markNow(cur.i);
    requestAnimationFrame(draw);
  }

  let lock = null;
  async function wakeLock(on) {
    try {
      if (on && 'wakeLock' in navigator) lock = await navigator.wakeLock.request('screen');
      else if (!on && lock) { await lock.release(); lock = null; }
    } catch (e) { /* 使えない端末ではそのまま */ }
  }

  $('playBtn').addEventListener('click', () => (playing ? stop() : play()));
  document.addEventListener('keydown', (e) => {
    if (e.code !== 'Space' || e.target.closest('input, select, textarea')) return;
    e.preventDefault();
    playing ? stop() : play();
  });

  // ---- 設定の変更 ----
  function change(fn, rerender) {
    fn();
    st = Core.normalizeState(st);
    syncControls();
    if (rerender) render();
    retime();
    save();
  }
  function setBpm(v) { change(() => { st.bpm = v; }); }
  $('bpm').addEventListener('change', () => setBpm(Number($('bpm').value)));
  $('bpmDown').addEventListener('click', () => setBpm(st.bpm - 1));
  $('bpmUp').addEventListener('click', () => setBpm(st.bpm + 1));
  $('num').addEventListener('change', () => change(() => { st.num = Number($('num').value); }, true));
  $('den').addEventListener('change', () => change(() => { st.den = Number($('den').value); }, true));
  $('grid-res').addEventListener('change', () => change(() => { st.grid = $('grid-res').value; }, true));
  $('bars').addEventListener('change', () => change(() => {
    const one = Core.stepsPerBar(st.num, st.den, st.grid);
    const old = st.bars;
    st.bars = Number($('bars').value);
    // 小節を増やしたら、1 小節目の打ち込みを写す
    if (st.bars > old) for (const id of Core.TRACK_IDS) for (let b = old; b < st.bars; b++) for (let i = 0; i < one; i++) st.pattern[id][b * one + i] = st.pattern[id][i];
  }, true));
  $('unit').addEventListener('change', () => change(() => { st.unit = $('unit').value; }));
  $('swing').addEventListener('input', () => change(() => { st.swing = Number($('swing').value); }));
  $('volume').addEventListener('input', () => {
    st.volume = Number($('volume').value);
    if (out) out.gain.setTargetAtTime(gainFor(st.volume), ctx.currentTime, 0.02);
    save();
  });
  $('loops').addEventListener('change', () => change(() => { st.loops = Number($('loops').value); }));
  $('midiCh').addEventListener('change', () => change(() => { st.midiChannel = Number($('midiCh').value); }));
  $('preset').addEventListener('change', () => {
    const id = $('preset').value;
    if (!id) return;
    st = Core.normalizeState(Core.applyPreset(st, id));
    $('preset').value = '';
    syncControls();
    render();
    retime();
    save();
    setStatus('見本を読み込みました: ' + Core.PRESETS.find((p) => p.id === id).name);
  });
  $('clearBtn').addEventListener('click', () => {
    if (!confirm('打ち込みをすべて消しますか？（テンポと拍子はそのまま）')) return;
    st.pattern = Core.emptyPattern(Core.totalSteps(st));
    render();
    save();
  });
  let lastWidth = 0;
  window.addEventListener('resize', () => {
    const w = $('grid').clientWidth;
    if (Math.abs(w - lastWidth) > 20) { lastWidth = w; render(); }
  });

  // ---- 書き出し ----
  function download(bytes, name, type) {
    const url = URL.createObjectURL(new Blob([bytes], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
  function baseName() { return `drum-${st.num}-${st.den}-${st.bpm}bpm`; }

  $('midBtn').addEventListener('click', () => {
    download(Core.buildMidi(st, st.loops), baseName() + '.mid', 'audio/midi');
    $('exportNote').textContent = `MIDI ファイルを作りました（${st.loops} 回・チャンネル ${st.midiChannel}）。`;
  });

  $('wavBtn').addEventListener('click', async () => {
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const tm = Core.stepTimes(st);
    const seconds = tm.loop * st.loops + 1.6;
    if (!OAC) { $('exportNote').textContent = 'このブラウザでは WAV を作れません。'; return; }
    if (seconds > 300) { $('exportNote').textContent = 'WAV は 5 分までです。くり返す回数を減らしてください。'; return; }
    $('wavBtn').disabled = true;
    $('exportNote').textContent = 'WAV を作っています…';
    try {
      const rate = 44100;
      const off = new OAC(1, Math.ceil(seconds * rate), rate);
      const o = Synth.makeOutput(off, gainFor(st.volume));
      const nz = Synth.makeNoise(off, 2);
      for (let l = 0; l < st.loops; l++) {
        tm.times.forEach((t0, i) => {
          for (const tr of Core.TRACKS) {
            const v = st.pattern[tr.id][i];
            if (v) Synth.hit(off, o, nz, tr.id, l * tm.loop + t0 + 0.005, Core.LEVEL_GAIN[v]);
          }
        });
      }
      const buf = await off.startRendering();
      download(Core.encodeWav([buf.getChannelData(0)], rate), baseName() + '.wav', 'audio/wav');
      $('exportNote').textContent = `WAV を作りました（${st.loops} 回・${seconds.toFixed(1)} 秒・44.1 kHz・16 bit・モノラル）。`;
    } catch (e) {
      $('exportNote').textContent = 'WAV を作れませんでした。';
    }
    $('wavBtn').disabled = false;
  });

  // ---- MIDI 機器へ送る（Web MIDI。押して許可したときだけ） ----
  let midiAccess = null;
  let midiOut = null;
  function midiNote(note, vel, t) {
    const at = performance.now() + Math.max(0, (t - ctx.currentTime) * 1000);
    const ch = (st.midiChannel - 1) & 0x0f;
    try {
      midiOut.send([0x90 | ch, note, vel], at);
      midiOut.send([0x80 | ch, note, 64], at + 60);
    } catch (e) { /* 抜かれたときなど */ }
  }
  function midiAllOff() {
    if (!midiOut) return;
    try { midiOut.send([0xb0 | ((st.midiChannel - 1) & 0x0f), 123, 0]); } catch (e) { /* 無視 */ }
  }
  function listOutputs() {
    const sel = $('midiOut');
    const keep = sel.value;
    sel.textContent = '';
    sel.add(new Option('（送らない）', ''));
    for (const o of midiAccess.outputs.values()) sel.add(new Option(o.name || o.id, o.id));
    sel.disabled = false;
    sel.value = [...sel.options].some((o) => o.value === keep) ? keep : '';
    pickOutput();
  }
  function pickOutput() {
    midiOut = midiAccess && $('midiOut').value ? midiAccess.outputs.get($('midiOut').value) || null : null;
    $('midiSum').textContent = 'MIDI 機器に送る: ' + (midiOut ? (midiOut.name || '送る') : 'つないでいない');
  }
  $('midiBtn').addEventListener('click', async () => {
    if (!navigator.requestMIDIAccess) { $('midiStatus').textContent = 'このブラウザは MIDI 機器に対応していません（Safari・iPhone・iPad など）。'; return; }
    try {
      midiAccess = await navigator.requestMIDIAccess({ sysex: false });
      midiAccess.onstatechange = listOutputs;
      listOutputs();
      $('midiStatus').textContent = midiAccess.outputs.size ? '送る先を選んでください。' : 'MIDI の出力が見つかりません。機器をつないでから押し直してください。';
    } catch (e) {
      $('midiStatus').textContent = '許可されませんでした。サイトの設定で MIDI を許可してから押し直してください。';
    }
  });
  $('midiOut').addEventListener('change', pickOutput);

  // ---- 共有・書き出し・読み込み ----
  $('shareBtn').addEventListener('click', async () => {
    const url = location.origin + location.pathname + '#p=' + encodeURIComponent(Core.encodeShare(st));
    try { await navigator.clipboard.writeText(url); $('shareNote').textContent = '共有リンクをコピーしました。'; } catch (e) { prompt('このリンクをコピーしてください', url); }
  });
  $('exportBtn').addEventListener('click', () => {
    const d = new Date();
    const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    const json = JSON.stringify({ tool: 'web-metronome', version: 1, exportedAt: d.toISOString(), data: { [KEY]: st } }, null, 1);
    download(new TextEncoder().encode(json), `web-metronome-backup-${ymd}.json`, 'application/json');
  });
  $('importBtn').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', async () => {
    const f = $('importFile').files[0];
    $('importFile').value = '';
    if (!f) return;
    try {
      const obj = JSON.parse(await f.text());
      if (!obj || obj.tool !== 'web-metronome' || !obj.data || !obj.data[KEY]) throw new Error('tool');
      if (!confirm('ファイルの打ち込みで、いまの打ち込みと設定を上書きしますか？')) return;
      st = Core.normalizeState(obj.data[KEY]);
      syncControls();
      render();
      retime();
      save();
      setStatus('ファイルから読み込みました。');
    } catch (e) {
      setStatus('このファイルは読み込めません（このドラムマシンで書き出したファイルを選んでください）。');
    }
  });

  syncControls();
  render();
  lastWidth = $('grid').clientWidth;
  if (fromShare) setStatus('共有リンクのパターンです。マスや設定を変えると、この端末にも保存されます。');
})();
