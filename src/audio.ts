// Synthesized sound effects (Web Audio). No audio files are used.

import type { SoundKind } from './blocks';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
let volume = 0.6;

export function initAudio(): void {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  try {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = volume;
    master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  } catch {
    ctx = null;
  }
}

export function setVolume(v: number): void {
  volume = v;
  if (master) master.gain.value = v;
}

const MATERIAL: Record<SoundKind, { freq: number; q: number; dur: number; type: BiquadFilterType; gain: number }> = {
  stone: { freq: 1400, q: 1.2, dur: 0.09, type: 'bandpass', gain: 0.6 },
  wood: { freq: 600, q: 3, dur: 0.1, type: 'bandpass', gain: 0.8 },
  gravel: { freq: 900, q: 0.7, dur: 0.12, type: 'bandpass', gain: 0.6 },
  grass: { freq: 2600, q: 0.6, dur: 0.12, type: 'highpass', gain: 0.35 },
  sand: { freq: 3200, q: 0.5, dur: 0.1, type: 'highpass', gain: 0.3 },
  glass: { freq: 3000, q: 8, dur: 0.18, type: 'bandpass', gain: 0.6 },
  wool: { freq: 500, q: 0.5, dur: 0.12, type: 'lowpass', gain: 0.5 },
  snow: { freq: 2000, q: 0.4, dur: 0.14, type: 'lowpass', gain: 0.4 },
  none: { freq: 1000, q: 1, dur: 0.05, type: 'bandpass', gain: 0 },
};

function noise(freq: number, q: number, dur: number, type: BiquadFilterType, gain: number, when = 0, pan = 0): void {
  if (!ctx || !master || !noiseBuf || gain <= 0) return;
  const t = ctx.currentTime + when;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.playbackRate.value = 0.8 + Math.random() * 0.4;
  const f = ctx.createBiquadFilter();
  f.type = type; f.frequency.value = freq * (0.85 + Math.random() * 0.3); f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  const p = ctx.createStereoPanner();
  p.pan.value = Math.max(-1, Math.min(1, pan));
  src.connect(f).connect(g).connect(p).connect(master);
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.05);
}

function tone(freq: number, dur: number, type: OscillatorType, gain: number, slideTo?: number, when = 0): void {
  if (!ctx || !master) return;
  const t = ctx.currentTime + when;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

/** A slow-swelling brass-like note: two detuned saws through a low-pass. */
function swell(freq: number, dur: number, gain: number, when = 0): void {
  if (!ctx || !master) return;
  const t = ctx.currentTime + when;
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass'; f.frequency.setValueAtTime(400, t); f.frequency.linearRampToValueAtTime(1400, t + dur * 0.4); f.Q.value = 2;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + dur * 0.3);
  g.gain.setValueAtTime(gain, t + dur * 0.7);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  f.connect(g).connect(master);
  for (const d of [-4, 4]) {
    const o = ctx.createOscillator();
    o.type = 'sawtooth'; o.frequency.value = freq; o.detune.value = d;
    o.connect(f); o.start(t); o.stop(t + dur + 0.05);
  }
}

/** Distance attenuation and stereo pan from listener to a sound source. */
export interface Spatial { gain: number; pan: number }

export const sfx = {
  step(kind: SoundKind, s: Spatial = { gain: 1, pan: 0 }) {
    const m = MATERIAL[kind];
    noise(m.freq, m.q, m.dur * 0.8, m.type, m.gain * 0.35 * s.gain, 0, s.pan);
  },
  dig(kind: SoundKind, s: Spatial = { gain: 1, pan: 0 }) {
    const m = MATERIAL[kind];
    noise(m.freq, m.q, m.dur, m.type, m.gain * 0.5 * s.gain, 0, s.pan);
  },
  breakBlock(kind: SoundKind, s: Spatial = { gain: 1, pan: 0 }) {
    const m = MATERIAL[kind];
    noise(m.freq, m.q, m.dur * 2, m.type, m.gain * s.gain, 0, s.pan);
    noise(m.freq * 0.7, m.q, m.dur * 2.5, m.type, m.gain * 0.6 * s.gain, 0.03, s.pan);
    if (kind === 'glass') { tone(2400, 0.2, 'triangle', 0.08 * s.gain); tone(3100, 0.25, 'triangle', 0.06 * s.gain, undefined, 0.04); }
  },
  place(kind: SoundKind) {
    const m = MATERIAL[kind];
    noise(m.freq * 0.8, m.q, m.dur * 1.4, m.type, m.gain * 0.9);
  },
  pop() { tone(700 + Math.random() * 300, 0.07, 'sine', 0.12, 1400); },
  click() { tone(900, 0.04, 'square', 0.05, 600); },
  hurt() { tone(260, 0.18, 'sawtooth', 0.12, 150); noise(800, 1, 0.12, 'bandpass', 0.3); },
  mobHurt(pitch: number, s: Spatial) { tone(pitch, 0.16, 'square', 0.08 * s.gain, pitch * 0.6); },
  mobSay(pitch: number, s: Spatial) { tone(pitch, 0.25, 'triangle', 0.07 * s.gain, pitch * (0.8 + Math.random() * 0.5)); },
  eat() { for (let i = 0; i < 3; i++) noise(1800, 0.8, 0.08, 'bandpass', 0.35, i * 0.12); },
  burp() { tone(140, 0.3, 'sawtooth', 0.08, 90); },
  splash() { noise(1200, 0.5, 0.35, 'lowpass', 0.5); },
  fizz(s: Spatial = { gain: 1, pan: 0 }) { noise(4000, 0.5, 0.5, 'highpass', 0.4 * s.gain, 0, s.pan); },
  explode(s: Spatial = { gain: 1, pan: 0 }) {
    noise(200, 0.4, 1.2, 'lowpass', 1.2 * s.gain, 0, s.pan);
    tone(80, 0.8, 'sine', 0.4 * s.gain, 30);
  },
  fuse(s: Spatial) { noise(5000, 0.5, 0.6, 'highpass', 0.25 * s.gain, 0, s.pan); },
  door(open: boolean) { noise(open ? 500 : 350, 2, 0.18, 'bandpass', 0.8); tone(open ? 180 : 140, 0.12, 'triangle', 0.05); },
  /** A piston's hiss and clunk (out or in). */
  piston(out: boolean, s: Spatial = { gain: 1, pan: 0 }) { noise(out ? 700 : 500, 1.2, 0.18, 'bandpass', 0.35 * s.gain, 0, s.pan); tone(out ? 150 : 110, 0.08, 'square', 0.05 * s.gain); },
  /** A soft bubbling chime when a brew finishes. */
  brewed(s: Spatial = { gain: 1, pan: 0 }) { [392, 523, 659].forEach((f, i) => tone(f, 0.18, 'sine', 0.05 * s.gain, f * 1.02, i * 0.07)); noise(900, 1, 0.3, 'bandpass', 0.15 * s.gain, 0.05, s.pan); },
  /** A dull wooden thunk when a shield takes a hit. */
  shieldBlock() { noise(260, 1.4, 0.12, 'lowpass', 0.6); tone(120, 0.1, 'triangle', 0.08, 90); },
  /** The raiders' war horn: two long, low calls. */
  warHorn() { swell(98, 1.6, 0.16); swell(110, 2.2, 0.16, 1.5); },
  /** A bright little fanfare when a raid is beaten. */
  fanfare() { [392, 523, 659, 784, 1047].forEach((f, i) => tone(f, i === 4 ? 0.6 : 0.16, 'triangle', 0.09, undefined, i * 0.11)); },
  levelUp() { [523, 659, 784].forEach((f, i) => tone(f, 0.15, 'triangle', 0.08, undefined, i * 0.08)); },
};

export function spatial(lx: number, ly: number, lz: number, yaw: number, x: number, y: number, z: number, range = 16): Spatial {
  const dx = x - lx, dy = y - ly, dz = z - lz;
  const d = Math.hypot(dx, dy, dz);
  const gain = Math.max(0, 1 - d / range);
  // Listener right vector for yaw (0 = facing -z).
  const rx = Math.cos(yaw), rz = -Math.sin(yaw);
  const pan = d > 0.01 ? (dx * rx + dz * rz) / d : 0;
  return { gain, pan: pan * 0.7 };
}
