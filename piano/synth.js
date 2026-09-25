/**
 * ブラウザピアノ - synth.js（Web Audio の音源。録音した音は使わず、その場で合成する）
 *
 * 1 音 = 同じ波形（倍音を足した PeriodicWave）の発振器 2 つを少しずらして重ね（弦 2 本のうなり）、
 * ローパスを「打鍵の直後は明るく → だんだん丸く」動かし、音量を 2 段階で減衰させる。打鍵の「コツ」は短いノイズ。
 * 鍵を離すとダンパーのように 0.1 秒ほどで消す（サステインが入っていれば鳴らし続ける）。
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
        comp.connect(this.ctx.destination);
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

    waveFor(midi, design) {
      let w = this.waves.get(midi);
      if (!w) {
        const imag = new Float32Array(design.partials);
        const real = new Float32Array(imag.length);
        w = this.ctx.createPeriodicWave(real, imag);
        this.waves.set(midi, w);
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
      const d = Core.voiceDesign(midi);
      const wave = this.waveFor(midi, d);
      const vca = ctx.createGain();
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.Q.value = 0.5;
      lp.frequency.setValueAtTime(d.cutoffStart, t);
      lp.frequency.setTargetAtTime(d.cutoffEnd, t + 0.01, d.decay * 0.3);
      lp.connect(vca);
      vca.connect(this.master);

      const oscs = [-1.5, 1.5].map((cents) => {
        const o = ctx.createOscillator();
        o.setPeriodicWave(wave);
        o.frequency.value = d.f;
        o.detune.value = cents;
        o.connect(lp);
        o.start(t);
        return o;
      });

      // 音量: 4ms で立ち上がり、すぐ 4 割まで落ち（打鍵の音）、そのあと長く減衰する
      const peak = 0.32 * velocity;
      const g = vca.gain;
      g.setValueAtTime(0, t);
      g.linearRampToValueAtTime(peak, t + 0.004);
      g.setTargetAtTime(peak * 0.4, t + 0.004, Math.min(0.25, d.decay * 0.12));
      g.setTargetAtTime(0, t + 0.3, d.decay);
      const end = t + 0.3 + d.decay * 6;
      oscs.forEach((o) => o.stop(end));

      // 打鍵のノイズ（ハンマーが弦に当たる音）
      const n = ctx.createBufferSource();
      n.buffer = this.noise;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = Math.min(6000, d.f * 3);
      bp.Q.value = 0.8;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0.06 * velocity, t);
      ng.gain.setTargetAtTime(0, t, 0.008);
      n.connect(bp);
      bp.connect(ng);
      ng.connect(this.master);
      n.start(t);
      n.stop(t + 0.05);

      const voice = { midi, oscs, vca, lp, held: true, done: false };
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
      if (!this.sustain) this.release(v, this.ctx.currentTime, 0.08);
    }

    setSustain(on) {
      this.sustain = on;
      if (on || !this.ctx) return;
      const t = this.ctx.currentTime;
      for (const v of [...this.voices.values()]) if (!v.held) this.release(v, t, 0.1);
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
