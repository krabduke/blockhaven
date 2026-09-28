// The sound of the place you're standing in, all synthesized: wind that grows with height,
// surf near water, rain on open ground, birdsong by day, crickets and frogs at night, drips and
// low swells in caves, crackle in the Emberdeep and far-off chimes in the Hollow. Continuous
// layers crossfade as you move; the rest are short calls scheduled at random.

import { audioGraph } from './audio';

export interface Surroundings {
  dimension: 'overworld' | 'ember' | 'hollow';
  /** Biome id at your feet (see BIOME in worldgen). */
  biome: number;
  day: boolean;
  /** Eye height. */
  y: number;
  /** 0 under cover or underground, 1 under open sky. */
  sky: number;
  /** 0 in the open, 1 deep in an enclosed cave. */
  cave: number;
  /** 0-1: how much water is close by. */
  water: number;
  /** 0-1 rain strength. */
  rain: number;
  underwater: boolean;
}

// Biome ids (kept in step with BIOME in worldgen.ts, which this module doesn't import to stay light).
const B = { ocean: 0, plains: 1, forest: 2, desert: 3, taiga: 4, mountains: 5, beach: 6, birch: 7, swamp: 8, savanna: 9, river: 11, badlands: 12, jungle: 13, blossom: 14 };
const BIRDS = new Set([B.plains, B.forest, B.birch, B.jungle, B.blossom, B.savanna, B.taiga, B.swamp]);
const CRICKETS = new Set([B.plains, B.forest, B.birch, B.savanna, B.blossom, B.jungle, B.swamp, B.river]);

interface Layer { gain: GainNode; filter: BiquadFilterNode; level: number }

export class Ambience {
  private layers: Record<'wind' | 'surf' | 'rain' | 'rumble', Layer> | null = null;
  private at: Surroundings | null = null;
  private t = 0;
  private windTarget = 500;

  /** Current surroundings (a few times a second is plenty). */
  set(s: Surroundings): void { this.at = s; }

  private build(): void {
    const g = audioGraph();
    if (!g || this.layers) return;
    const layer = (type: BiquadFilterType, freq: number, q: number): Layer => {
      const src = g.ctx.createBufferSource();
      src.buffer = g.noise; src.loop = true;
      src.playbackRate.value = 0.5 + Math.random() * 0.2;
      const filter = g.ctx.createBiquadFilter();
      filter.type = type; filter.frequency.value = freq; filter.Q.value = q;
      const gain = g.ctx.createGain(); gain.gain.value = 0;
      src.connect(filter).connect(gain).connect(g.amb);
      src.start();
      return { gain, filter, level: 0 };
    };
    this.layers = { wind: layer('bandpass', 500, 0.6), surf: layer('lowpass', 480, 0.4), rain: layer('bandpass', 2600, 0.5), rumble: layer('lowpass', 110, 0.7) };
  }

  /** Stop everything (the title screen, a loading screen). */
  silence(): void {
    this.at = null;
    const g = audioGraph();
    if (!g || !this.layers) return;
    for (const l of Object.values(this.layers)) l.gain.gain.setTargetAtTime(0, g.ctx.currentTime, 0.5);
  }

  update(dt: number): void {
    const g = audioGraph();
    const s = this.at;
    if (!g || !s) return;
    this.build();
    const L = this.layers!;
    const now = g.ctx.currentTime;
    this.t += dt;
    const muffle = s.underwater ? 0.3 : 1;
    // Wind: stronger up high, in snow and on mountains; gusting as its pitch wanders.
    const height = Math.max(0, Math.min(1, (s.y - 75) / 60));
    const bleak = s.biome === B.mountains || s.biome === B.taiga || s.biome === B.desert || s.biome === B.badlands ? 0.35 : 0;
    const wind = s.dimension === 'overworld' ? s.sky * (0.12 + height * 0.55 + bleak + s.rain * 0.25) : s.dimension === 'hollow' ? 0.25 : 0;
    if (Math.random() < dt * 0.4) this.windTarget = 250 + Math.random() * 700;
    L.wind.filter.frequency.setTargetAtTime(this.windTarget, now, 1.5);
    const gust = 0.75 + 0.25 * Math.sin(this.t * 0.35) * Math.sin(this.t * 0.13 + 1);
    this.fade(L.wind, wind * gust * 0.09 * muffle, now);
    // Surf and running water.
    const coast = s.biome === B.ocean || s.biome === B.beach ? 1 : 0.5;
    const surf = s.dimension === 'overworld' ? s.water * coast * (0.55 + 0.45 * Math.sin(this.t * 0.6) ** 2) : 0;
    this.fade(L.surf, surf * 0.07 * (s.underwater ? 1.4 : 1), now);
    // Rain: loud in the open, a hush under a roof.
    this.fade(L.rain, s.dimension === 'overworld' ? s.rain * (0.25 + 0.75 * s.sky) * 0.06 * muffle : 0, now);
    // A low rumble in the Emberdeep.
    this.fade(L.rumble, s.dimension === 'ember' ? 0.12 : s.cave > 0.6 ? 0.03 * s.cave : 0, now);

    // Short calls.
    const chance = (perSecond: number) => Math.random() < perSecond * dt;
    if (s.dimension === 'overworld' && !s.underwater) {
      const open = s.sky > 0.5 && s.cave < 0.3;
      if (open && s.day && s.rain < 0.3 && BIRDS.has(s.biome) && chance(s.biome === B.jungle ? 0.5 : 0.22)) this.bird(g.ctx, g.amb, now);
      if (open && !s.day && s.rain < 0.5 && CRICKETS.has(s.biome) && chance(0.9)) this.cricket(g.ctx, g.amb, now);
      if (open && !s.day && (s.biome === B.swamp || (s.water > 0.3 && s.biome === B.river)) && chance(0.25)) this.frog(g.ctx, g.amb, now);
      if (s.cave > 0.5 && chance(0.18 * s.cave)) this.drip(g.ctx, g.amb, now);
      if (s.cave > 0.7 && chance(1 / 90)) this.caveSwell(g.ctx, g.amb, now);
    }
    if (s.dimension === 'ember') {
      if (chance(1.5)) this.crackle(g.ctx, g.amb, now);
      if (chance(0.08)) this.caveSwell(g.ctx, g.amb, now, 0.6);
    }
    if (s.dimension === 'hollow' && chance(0.12)) this.chime(g.ctx, g.amb, now);
  }

  private fade(l: Layer, target: number, now: number): void {
    if (Math.abs(target - l.level) < 0.0005) return;
    l.level = target;
    l.gain.gain.setTargetAtTime(target, now, 1.2);
  }

  /** A voice: oscillator -> envelope -> panner -> out, freed when it ends. */
  private voice(c: AudioContext, out: AudioNode, type: OscillatorType, t: number, dur: number, gain: number, pan: number, shape: (f: AudioParam, t: number) => void, attack = 0.01): void {
    const o = c.createOscillator();
    o.type = type;
    shape(o.frequency, t);
    const e = c.createGain();
    e.gain.setValueAtTime(0.0001, t);
    e.gain.linearRampToValueAtTime(gain, t + attack);
    e.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const p = c.createStereoPanner();
    p.pan.value = pan;
    o.connect(e).connect(p).connect(out);
    o.start(t); o.stop(t + dur + 0.05);
    o.onended = () => { e.disconnect(); p.disconnect(); };
  }

  /** A little song: a few quick whistles that swoop up or down. */
  private bird(c: AudioContext, out: AudioNode, now: number): void {
    const base = 2200 + Math.random() * 2400, pan = Math.random() * 1.6 - 0.8, notes = 2 + Math.floor(Math.random() * 5);
    const up = Math.random() < 0.5, gap = 0.07 + Math.random() * 0.08;
    for (let i = 0; i < notes; i++) {
      const t = now + i * gap, f0 = base * (1 + (Math.random() - 0.5) * 0.15);
      this.voice(c, out, 'sine', t, 0.06 + Math.random() * 0.05, 0.02, pan, (f, tt) => { f.setValueAtTime(up ? f0 * 0.8 : f0 * 1.2, tt); f.exponentialRampToValueAtTime(up ? f0 * 1.25 : f0 * 0.75, tt + 0.05); }, 0.005);
    }
  }

  /** A cricket's trill: a handful of fast chirps. */
  private cricket(c: AudioContext, out: AudioNode, now: number): void {
    const f0 = 4200 + Math.random() * 900, pan = Math.random() * 1.8 - 0.9, n = 3 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) this.voice(c, out, 'sine', now + i * 0.045, 0.025, 0.006, pan, (f, tt) => f.setValueAtTime(f0, tt), 0.004);
  }

  /** A frog: a low, buzzy double croak. */
  private frog(c: AudioContext, out: AudioNode, now: number): void {
    const f0 = 120 + Math.random() * 90, pan = Math.random() * 1.6 - 0.8;
    for (let i = 0; i < 2; i++) this.voice(c, out, 'sawtooth', now + i * 0.18, 0.12, 0.012, pan, (f, tt) => { f.setValueAtTime(f0, tt); f.linearRampToValueAtTime(f0 * 0.85, tt + 0.1); }, 0.02);
  }

  /** A drop of water somewhere in the dark (it echoes through the cave reverb). */
  private drip(c: AudioContext, out: AudioNode, now: number): void {
    const f0 = 1100 + Math.random() * 1400;
    this.voice(c, out, 'sine', now, 0.14, 0.035, Math.random() * 1.6 - 0.8, (f, tt) => { f.setValueAtTime(f0, tt); f.exponentialRampToValueAtTime(f0 * 1.6, tt + 0.05); }, 0.003);
  }

  /** A slow, low swell from deep in the rock. */
  private caveSwell(c: AudioContext, out: AudioNode, now: number, gain = 1): void {
    const f0 = 55 + Math.random() * 40;
    for (const d of [0, 7]) this.voice(c, out, 'triangle', now, 5, 0.03 * gain, Math.random() - 0.5, (f, tt) => { f.setValueAtTime(f0 * (d ? 1.5 : 1), tt); f.linearRampToValueAtTime(f0 * (d ? 1.45 : 0.95), tt + 5); }, 2.2);
  }

  /** Embers popping. */
  private crackle(c: AudioContext, out: AudioNode, now: number): void {
    this.voice(c, out, 'square', now, 0.03, 0.01, Math.random() * 1.8 - 0.9, (f, tt) => f.setValueAtTime(600 + Math.random() * 1800, tt), 0.002);
  }

  /** A far-off glassy chime in the Hollow, on a whole-tone scale. */
  private chime(c: AudioContext, out: AudioNode, now: number): void {
    const f0 = 880 * Math.pow(2, [0, 2, 4, 6, 8, 10][Math.floor(Math.random() * 6)] / 12) * (Math.random() < 0.5 ? 1 : 2);
    const pan = Math.random() * 1.6 - 0.8;
    this.voice(c, out, 'sine', now, 3.5, 0.02, pan, (f, tt) => f.setValueAtTime(f0, tt), 0.005);
    this.voice(c, out, 'sine', now, 2, 0.006, pan, (f, tt) => f.setValueAtTime(f0 * 2.76, tt), 0.005);
  }
}
