/**
 * ドラムマシン - drum-synth.js（Web Audio で太鼓の音をその場で作る。録音した音のファイルは使わない）
 *
 * 同じ関数 hit(ctx, dest, noise, id, time, gain) を、鳴らすとき（AudioContext）と WAV に書き出すとき（OfflineAudioContext）の両方で使う。
 * - キック: 正弦波の高さを 150 → 45 Hz に下げ、音量を短く減衰
 * - スネア: ノイズ（ハイパス）＋ 185 Hz の三角波
 * - ハイハット: ノイズを 7 kHz より上に絞って短く（オープンは長く）
 * - クラップ: 帯域を絞ったノイズを 10 ms おきに 3 回
 * - タム: 正弦波の高さを少し下げる
 * - リム: 短い矩形波 2 つ
 * - クラッシュ: ノイズ（ハイパス 5 kHz）を長く
 */
(function (root) {
  'use strict';

  function makeNoise(ctx, seconds) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const b = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = b.getChannelData(0);
    // 書き出しのたびに同じ音になるよう、決まった種から作る（線形合同法）
    let s = 12345;
    for (let i = 0; i < len; i++) {
      s = (s * 1103515245 + 12345) >>> 0;
      d[i] = (s / 0xffffffff) * 2 - 1;
    }
    return b;
  }

  function env(ctx, dest, time, peak, decay) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), time + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, time + decay);
    g.connect(dest);
    return g;
  }

  function noiseSrc(ctx, noise, time, dur) {
    const n = ctx.createBufferSource();
    n.buffer = noise;
    n.start(time);
    n.stop(time + dur);
    return n;
  }

  function filter(ctx, type, freq, q) {
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    if (q) f.Q.value = q;
    return f;
  }

  function tone(ctx, dest, type, f0, f1, time, dur, peak) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, time);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, time + dur * 0.6);
    o.connect(env(ctx, dest, time, peak, dur));
    o.start(time);
    o.stop(time + dur + 0.02);
  }

  function hit(ctx, dest, noise, id, time, gain) {
    if (!(gain > 0)) return;
    switch (id) {
      case 'kick':
        tone(ctx, dest, 'sine', 150, 45, time, 0.45, 1.0 * gain);
        break;
      case 'snare': {
        const n = noiseSrc(ctx, noise, time, 0.25);
        n.connect(filter(ctx, 'highpass', 1500)).connect(env(ctx, dest, time, 0.55 * gain, 0.2));
        tone(ctx, dest, 'triangle', 185, 160, time, 0.12, 0.45 * gain);
        break;
      }
      case 'chh': {
        const n = noiseSrc(ctx, noise, time, 0.08);
        n.connect(filter(ctx, 'highpass', 7000)).connect(env(ctx, dest, time, 0.35 * gain, 0.05));
        break;
      }
      case 'ohh': {
        const n = noiseSrc(ctx, noise, time, 0.45);
        n.connect(filter(ctx, 'highpass', 7000)).connect(env(ctx, dest, time, 0.3 * gain, 0.4));
        break;
      }
      case 'clap': {
        for (let k = 0; k < 3; k++) {
          const t = time + k * 0.01;
          const n = noiseSrc(ctx, noise, t, k === 2 ? 0.2 : 0.02);
          n.connect(filter(ctx, 'bandpass', 1200, 1.2)).connect(env(ctx, dest, t, 0.7 * gain, k === 2 ? 0.18 : 0.015));
        }
        break;
      }
      case 'ltom':
        tone(ctx, dest, 'sine', 140, 95, time, 0.4, 0.8 * gain);
        break;
      case 'htom':
        tone(ctx, dest, 'sine', 220, 160, time, 0.3, 0.7 * gain);
        break;
      case 'rim':
        tone(ctx, dest, 'square', 1700, 1700, time, 0.03, 0.18 * gain);
        tone(ctx, dest, 'triangle', 480, 480, time, 0.04, 0.35 * gain);
        break;
      case 'crash': {
        const n = noiseSrc(ctx, noise, time, 1.6);
        n.connect(filter(ctx, 'highpass', 5000)).connect(env(ctx, dest, time, 0.35 * gain, 1.5));
        break;
      }
      default:
        break;
    }
  }

  /** 出力の最後: 圧縮 → 頭を丸める（大きな音が重なっても割れにくく） */
  function makeOutput(ctx, volume) {
    const master = ctx.createGain();
    master.gain.value = volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.knee.value = 10;
    comp.ratio.value = 4;
    comp.attack.value = 0.003;
    comp.release.value = 0.2;
    const shaper = ctx.createWaveShaper();
    const N = 2049;
    const curve = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const x = (i / (N - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * 1.2) / Math.tanh(1.2) * 0.95;
    }
    shaper.curve = curve;
    master.connect(comp);
    comp.connect(shaper);
    shaper.connect(ctx.destination);
    return master;
  }

  root.DrumSynth = { hit, makeNoise, makeOutput };
})(typeof self !== 'undefined' ? self : this);
