// Generative music. Every few minutes a short piece is composed on the spot and played: a slow
// chord progression on a soft pad, a sparse melody on a piano-like or bell voice, and a quiet
// bass. The mood (scale, register, tempo, voices) follows where you are: bright by day, modal at
// night, sparse and low in caves, dark and droning in the Emberdeep, glassy in the Hollow.
// Nothing is sampled: every note is synthesized.

import { audioGraph } from './audio';

export type Mood = 'title' | 'day' | 'night' | 'snow' | 'cave' | 'ember' | 'hollow';

interface MoodDef {
  scales: number[][];
  /** MIDI note of the lowest root. */
  root: [number, number];
  bpm: [number, number];
  /** Chance of a melody note on each eighth. */
  density: number;
  lead: 'piano' | 'bell';
  pad: number;
  bass: boolean;
  /** Melody octave above the root. */
  lift: number;
}

const MOODS: Record<Mood, MoodDef> = {
  title: { scales: [[0, 2, 4, 7, 9], [0, 2, 4, 6, 7, 9, 11]], root: [50, 55], bpm: [58, 66], density: 0.32, lead: 'piano', pad: 1, bass: true, lift: 24 },
  day: { scales: [[0, 2, 4, 7, 9], [0, 2, 4, 6, 7, 9, 11], [0, 2, 4, 5, 7, 9, 11]], root: [48, 55], bpm: [62, 76], density: 0.38, lead: 'piano', pad: 1, bass: true, lift: 24 },
  night: { scales: [[0, 2, 3, 5, 7, 9, 10], [0, 3, 5, 7, 10]], root: [45, 52], bpm: [54, 64], density: 0.28, lead: 'piano', pad: 1, bass: true, lift: 24 },
  snow: { scales: [[0, 3, 5, 7, 10], [0, 2, 3, 7, 8]], root: [50, 57], bpm: [56, 66], density: 0.3, lead: 'bell', pad: 0.8, bass: false, lift: 24 },
  cave: { scales: [[0, 2, 3, 5, 7, 8, 10], [0, 1, 5, 7, 8]], root: [40, 47], bpm: [48, 58], density: 0.14, lead: 'piano', pad: 0.9, bass: true, lift: 24 },
  ember: { scales: [[0, 1, 3, 5, 7, 8, 10], [0, 1, 4, 5, 7, 8, 10]], root: [36, 43], bpm: [50, 60], density: 0.18, lead: 'bell', pad: 1.2, bass: true, lift: 24 },
  hollow: { scales: [[0, 2, 4, 6, 8, 10], [0, 2, 4, 7, 11]], root: [50, 57], bpm: [50, 60], density: 0.22, lead: 'bell', pad: 0.9, bass: false, lift: 24 },
};

/** Chord roots as scale-degree steps; each chord is a triad stacked in the scale. */
const PROGRESSIONS = [[0, 5, 3, 4], [0, 3, 0, 4], [0, 2, 3, 1], [0, 4, 5, 3], [0, 5, 1, 4], [0, 3, 5, 4]];

interface Note { t: number; kind: 'pad' | 'piano' | 'bell' | 'bass'; midi: number; dur: number; gain: number }

const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

/** Compose a whole piece as a list of timed notes. */
export function compose(mood: Mood, rand: () => number = Math.random): { notes: Note[]; length: number } {
  const def = MOODS[mood];
  const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)];
  const scale = pick(def.scales);
  const root = def.root[0] + Math.floor(rand() * (def.root[1] - def.root[0] + 1));
  const bpm = def.bpm[0] + rand() * (def.bpm[1] - def.bpm[0]);
  const beat = 60 / bpm, bar = beat * 4;
  const prog = pick(PROGRESSIONS).map((d) => d % scale.length);
  const bars = 12 + 4 * Math.floor(rand() * 3);
  /** Scale degree -> MIDI note (degrees can run past the octave). */
  const deg = (d: number, base = root) => base + scale[((d % scale.length) + scale.length) % scale.length] + 12 * Math.floor(d / scale.length);
  const notes: Note[] = [];
  // A two-bar motif, as degree offsets (null = rest), varied as the piece goes on.
  const motif: (number | null)[] = [];
  let walk = 0;
  for (let i = 0; i < 16; i++) {
    if (rand() > def.density * (i % 4 === 0 ? 1.6 : 1)) { motif.push(null); continue; }
    walk = Math.max(-3, Math.min(7, walk + pick([-2, -1, -1, 1, 1, 2, 0, 3])));
    motif.push(walk);
  }
  for (let b = 0; b < bars; b++) {
    const chord = prog[b % prog.length];
    const last = b === bars - 1;
    const c = last ? 0 : chord;
    const t0 = b * bar;
    // Pad: the triad, held for the bar (the last chord rings on).
    if (def.pad > 0) for (const k of [0, 2, 4]) notes.push({ t: t0, kind: 'pad', midi: deg(c + k), dur: last ? bar * 2 : bar * 1.05, gain: 0.035 * def.pad });
    if (def.bass && (b % 2 === 0 || last)) notes.push({ t: t0, kind: 'bass', midi: deg(c) - 12, dur: bar * (last ? 2 : 1.9), gain: 0.07 });
    // Melody: the motif over the current chord, thinned at the start and end, varied every other pass.
    if (last) { notes.push({ t: t0, kind: def.lead, midi: deg(c + 7, root + def.lift - 12), dur: bar * 2, gain: 0.07 }); continue; }
    const pass = Math.floor(b / 2), vary = pass % 2 === 1;
    for (let e = 0; e < 8; e++) {
      const m = motif[(b % 2) * 8 + e];
      if (m === null || b < 1) continue;
      if (vary && rand() < 0.3) continue;
      const d = m + c + (vary && rand() < 0.3 ? pick([-1, 1]) : 0);
      const len = (1 + Math.floor(rand() * 3)) * beat / 2;
      notes.push({ t: t0 + e * beat / 2 + (rand() - 0.5) * 0.02, kind: def.lead, midi: deg(d, root + def.lift - 12), dur: len, gain: 0.05 + rand() * 0.025 });
    }
  }
  return { notes, length: bars * bar + bar * 2.5 };
}

export class Music {
  private mood: Mood = 'title';
  private piece: { notes: Note[]; start: number; length: number; next: number; gain: GainNode; mood: Mood } | null = null;
  /** Seconds (of audio-context time) until the next piece may start. */
  private waitUntil = -1;
  private enabled = true;

  /** Start a new piece right away (the /music command). */
  playNow(): void {
    const g = audioGraph();
    this.fadeOut(1);
    if (g) this.waitUntil = g.ctx.currentTime + 1;
  }

  get playing(): boolean { return !!this.piece; }

  setEnabled(on: boolean): void { this.enabled = on; if (!on) this.fadeOut(1); }

  /** Where you are now; a big change (another dimension, the title screen) ends the current piece early. */
  setMood(m: Mood): void {
    if (m === this.mood) return;
    const big = (a: Mood) => (a === 'ember' || a === 'hollow' || a === 'title' ? a : 'surface');
    const changed = big(m) !== big(this.mood);
    this.mood = m;
    const g = audioGraph();
    if (changed && g) {
      this.fadeOut(3);
      this.waitUntil = g.ctx.currentTime + 6 + Math.random() * 10;
    }
  }

  private fadeOut(seconds: number): void {
    const g = audioGraph();
    if (!this.piece || !g) { this.piece = null; return; }
    const p = this.piece;
    p.gain.gain.setTargetAtTime(0, g.ctx.currentTime, seconds / 3);
    setTimeout(() => p.gain.disconnect(), seconds * 1000 + 500);
    this.piece = null;
  }

  /** Call every frame: starts pieces now and then and schedules their notes a moment ahead. */
  update(): void {
    const g = audioGraph();
    if (!g || !this.enabled) return;
    const now = g.ctx.currentTime;
    if (this.waitUntil < 0) this.waitUntil = now + (this.mood === 'title' ? 2 : 20 + Math.random() * 40);
    if (!this.piece && now >= this.waitUntil) {
      const { notes, length } = compose(this.mood);
      const gain = g.ctx.createGain();
      gain.connect(g.music);
      this.piece = { notes, start: now + 0.3, length, next: 0, gain, mood: this.mood };
    }
    const p = this.piece;
    if (!p) return;
    // Schedule notes up to 1.5 s ahead.
    while (p.next < p.notes.length && p.start + p.notes[p.next].t < now + 1.5) {
      const n = p.notes[p.next++];
      this.play(g.ctx, p.gain, n, p.start + n.t);
    }
    if (now > p.start + p.length) {
      const q = this.piece!;
      setTimeout(() => q.gain.disconnect(), 3000);
      this.piece = null;
      // A long quiet stretch before the next one (shorter on the title screen).
      this.waitUntil = now + (this.mood === 'title' ? 8 + Math.random() * 8 : 150 + Math.random() * 200);
    }
  }

  private play(c: AudioContext, out: AudioNode, n: Note, t: number): void {
    const f = hz(n.midi);
    const env = c.createGain();
    env.connect(out);
    const osc = (type: OscillatorType, freq: number, detune = 0, level = 1) => {
      const o = c.createOscillator();
      o.type = type; o.frequency.value = freq; o.detune.value = detune;
      const g = c.createGain(); g.gain.value = level;
      o.connect(g).connect(env);
      return o;
    };
    let oscs: OscillatorNode[] = [];
    let end = t + n.dur;
    let filter: BiquadFilterNode | null = null;
    if (n.kind === 'pad') {
      // Two slightly detuned saws, softened, swelling in and out.
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 900; lp.Q.value = 0.3;
      lp.connect(out);
      env.disconnect(); env.connect(lp);
      filter = lp;
      oscs = [osc('sawtooth', f, -7, 0.5), osc('sawtooth', f, 7, 0.5), osc('sine', f / 2, 0, 0.4)];
      env.gain.setValueAtTime(0.0001, t);
      env.gain.linearRampToValueAtTime(n.gain, t + Math.min(1.6, n.dur * 0.4));
      env.gain.setValueAtTime(n.gain, t + n.dur * 0.7);
      env.gain.linearRampToValueAtTime(0.0001, t + n.dur + 1.2);
      end = t + n.dur + 1.3;
    } else if (n.kind === 'bass') {
      oscs = [osc('sine', f), osc('triangle', f, 0, 0.3)];
      env.gain.setValueAtTime(0.0001, t);
      env.gain.linearRampToValueAtTime(n.gain, t + 0.08);
      env.gain.exponentialRampToValueAtTime(0.0001, t + n.dur + 0.5);
      end = t + n.dur + 0.6;
    } else if (n.kind === 'piano') {
      // A soft hammered string: fundamental, a touch of octave and fifth, quick attack, long decay.
      oscs = [osc('sine', f, 0, 0.8), osc('triangle', f * 2, 3, 0.18), osc('sine', f * 3, -2, 0.06), osc('sine', f, 5, 0.3)];
      env.gain.setValueAtTime(0.0001, t);
      env.gain.linearRampToValueAtTime(n.gain, t + 0.006);
      env.gain.exponentialRampToValueAtTime(n.gain * 0.35, t + 0.25);
      env.gain.exponentialRampToValueAtTime(0.0001, t + n.dur + 2.2);
      end = t + n.dur + 2.3;
    } else {
      // A bell: inharmonic partials that ring and fade.
      oscs = [osc('sine', f, 0, 0.7), osc('sine', f * 2.76, 0, 0.25), osc('sine', f * 5.4, 0, 0.08), osc('sine', f * 0.5, 0, 0.15)];
      env.gain.setValueAtTime(0.0001, t);
      env.gain.linearRampToValueAtTime(n.gain, t + 0.004);
      env.gain.exponentialRampToValueAtTime(0.0001, t + n.dur + 3.2);
      end = t + n.dur + 3.3;
    }
    for (const o of oscs) { o.start(t); o.stop(end); }
    oscs[0].onended = () => { env.disconnect(); filter?.disconnect(); };
  }
}
