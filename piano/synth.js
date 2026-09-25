/**
 * ブラウザピアノ - synth.js（Web Audio の音源。録音した音は使わず、その場で合成する）
 *
 * 1 音 = 同じ波形（倍音を足した PeriodicWave）の発振器 1〜2 つを少しずらして重ね、ローパスを動かし、
 * 音量を「立ち上がり → 1 段目 → 2 段目（消えるか、押している間は同じ大きさ）」で動かす。打鍵の「コツ」は短いノイズ。
 * 形の数字は音色ごとに piano-core.js の voiceDesign(midi, timbre) が決める（ピアノ・エレピ・オルガン・オルゴール・シンセ・ストリングス風）。
 * 鍵を離すと音色ごとの時定数で消す（サステインが入っていれば鳴らし続ける）。
 * 最後に、大きすぎる和音だけ頭を丸める（0.8 までは素通し、それより上をなめらかに 0.98 未満へ。割れを防ぐ）。
 */
(function (root) {
  'use strict';
  const Core = root.PianoCore;
  const MAX_VOICES = 32;

  class PianoSynth {
    constructor() {
      this.ctx = null;
      this.master = null;
      this.voices = new Map(); // midi → voice
      this.waves = new Map();
      this.volume = 0.7;
      this.sustain = false;
      this.noise = null;
      this.timbre = 'piano';
    }

    /** 音色を変える（これから鳴らす音から。いま鳴っている音はそのまま） */
    setTimbre(id) {
      this.timbre = Core.TIMBRES.some((t) => t.id === id) ? id : 'piano';
    }

    /** 最初のタップ・キー操作の中で呼ぶ（ブラウザは操作の中でしか音を出させない） */
    unlock() {
      if (!this.ctx) {
        const AC = root.AudioContext || root.webkitAudioContext;
        if (!AC) return false;
        try {
          this.ctx = new AC({ latencyHint: 'interactive' });
        } catch (e) {
          this.ctx = new AC();
        }
        const comp = this.ctx.createDynamicsCompressor();
        comp.threshold.value = -12;
        comp.knee.value = 12;
        comp.ratio.value = 4;
        comp.attack.value = 0.003;
        comp.release.value = 0.25;
        this.master = this.ctx.createGain();
        this.master.gain.value = this.gainFor(this.volume);
        this.master.connect(comp);
        // 頭を丸める（ソフトクリップ）。|x| ≤ 0.8 はそのまま、それより上は 0.8 + 0.18 × tanh((|x| − 0.8) / 0.18)。
        // WaveShaper は入力 −1〜1 を表の端から端に当てるので、手前で 0.8 倍して表を −1.25〜1.25 の分にする
        const pre = this.ctx.createGain();
        pre.gain.value = 0.8;
        const shaper = this.ctx.createWaveShaper();
        const N = 2049;
        const curve = new Float32Array(N);
        for (let i = 0; i < N; i++) {
          const x = ((i / (N - 1)) * 2 - 1) / 0.8;
          const a = Math.abs(x);
          curve[i] = Math.sign(x) * (a <= 0.8 ? a : 0.8 + 0.18 * Math.tanh((a - 0.8) / 0.18));
        }
        shaper.curve = curve;
        comp.connect(pre);
        pre.connect(shaper);
        shaper.connect(this.ctx.destination);
        const len = Math.floor(this.ctx.sampleRate * 0.05);
        this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noise.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      }
      if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
      return true;
    }

    gainFor(v) {
      return 0.7 * v * v;
    }

    setVolume(v) {
      this.volume = Math.max(0, Math.min(1, v));
      if (this.master) this.master.gain.setTargetAtTime(this.gainFor(this.volume), this.ctx.currentTime, 0.02);
    }

    waveFor(midi, design, timbre) {
      const key = timbre + ':' + midi;
      let w = this.waves.get(key);
      if (!w) {
        const imag = new Float32Array(design.partials);
        const real = new Float32Array(imag.length);
        w = this.ctx.createPeriodicWave(real, imag);
        this.waves.set(key, w);
      }
      return w;
    }

    noteOn(midi, velocity = 0.8) {
      if (!this.ctx) return;
      const ctx = this.ctx;
      const t = ctx.currentTime;
      const old = this.voices.get(midi);
      if (old) this.release(old, t, 0.02);
      if (this.voices.size >= MAX_VOICES) {
        const oldest = this.voices.values().next().value;
        this.release(oldest, t, 0.03);
      }
      const timbre = this.timbre;
      const d = Core.voiceDesign(midi, timbre);
      const wave = this.waveFor(midi, d, timbre);
      const vca = ctx.createGain();
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.Q.value = d.Q;
      lp.frequency.setValueAtTime(d.cutoffStart, t);
      if (d.cutoffEnd !== d.cutoffStart) lp.frequency.setTargetAtTime(d.cutoffEnd, t + 0.01, d.cutoffTau);
      lp.connect(vca);
      vca.connect(this.master);

      const oscs = d.detune.map((cents) => {
        const o = ctx.createOscillator();
        o.setPeriodicWave(wave);
        o.frequency.value = d.f;
        o.detune.value = cents;
        o.connect(lp);
        o.start(t);
        return o;
      });

      // 音量: attack 秒で立ち上がり → level × mid へ（ピアノはすぐ 4 割まで落ちる = 打鍵の音）→ t2 秒から level × sustain へ
      const peak = d.level * velocity;
      const g = vca.gain;
      g.setValueAtTime(0, t);
      g.linearRampToValueAtTime(peak, t + d.attack);
      if (d.mid !== 1) g.setTargetAtTime(peak * d.mid, t + d.attack, d.tau1);
      if (d.sustain !== d.mid) g.setTargetAtTime(peak * d.sustain, t + d.t2, d.tau2);
      // 自然に消える音色は、十分小さくなったころに止める（押している間鳴り続ける音色は離したときに止める）
      if (d.sustain === 0) {
        const end = t + d.t2 + d.tau2 * 6;
        oscs.forEach((o) => o.stop(end));
      }

      // 打鍵のノイズ（ピアノはハンマーが弦に当たる音、オルガンはキーの接点の音）
      if (d.noise > 0) {
        const n = ctx.createBufferSource();
        n.buffer = this.noise;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = Math.min(6000, d.f * 3);
        bp.Q.value = 0.8;
        const ng = ctx.createGain();
        ng.gain.setValueAtTime(d.noise * velocity, t);
        ng.gain.setTargetAtTime(0, t, 0.008);
        n.connect(bp);
        bp.connect(ng);
        ng.connect(this.master);
        n.start(t);
        n.stop(t + 0.05);
      }

      const voice = { midi, oscs, vca, lp, held: true, done: false, releaseTau: d.release };
      oscs[0].onended = () => {
        voice.done = true;
        try { vca.disconnect(); } catch (e) { /* 既に外れている */ }
        if (this.voices.get(midi) === voice) this.voices.delete(midi);
      };
      this.voices.set(midi, voice);
    }

    /** 鍵を離した。サステイン中は鳴らし続ける */
    noteOff(midi) {
      const v = this.voices.get(midi);
      if (!v) return;
      v.held = false;
      if (!this.sustain) this.release(v, this.ctx.currentTime, v.releaseTau);
    }

    setSustain(on) {
      this.sustain = on;
      if (on || !this.ctx) return;
      const t = this.ctx.currentTime;
      for (const v of [...this.voices.values()]) if (!v.held) this.release(v, t, Math.max(0.1, v.releaseTau));
    }

    release(v, t, tau) {
      if (v.done) return;
      v.done = true;
      const g = v.vca.gain;
      if (g.cancelAndHoldAtTime) {
        g.cancelAndHoldAtTime(t);
      } else {
        g.cancelScheduledValues(t);
        g.setValueAtTime(g.value, t);
      }
      g.setTargetAtTime(0, t, tau);
      v.oscs.forEach((o) => {
        try { o.stop(t + tau * 8); } catch (e) { /* 既に止まっている */ }
      });
      if (this.voices.get(v.midi) === v) this.voices.delete(v.midi);
    }

    releaseAll() {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      for (const v of [...this.voices.values()]) this.release(v, t, 0.05);
    }

    /** メトロノームのクリック（time に予約して鳴らす） */
    click(time, accent) {
      if (!this.ctx) return;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.frequency.value = accent ? 1760 : 1320;
      g.gain.setValueAtTime(0.0001, time);
      g.gain.exponentialRampToValueAtTime(accent ? 0.5 : 0.3, time + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, time + 0.04);
      o.connect(g);
      g.connect(this.master);
      o.start(time);
      o.stop(time + 0.05);
    }
  }

  root.PianoSynth = PianoSynth;
})(typeof self !== 'undefined' ? self : this);
