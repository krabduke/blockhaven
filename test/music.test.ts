import { describe, expect, it } from 'vitest';
import { compose, type Mood } from '../src/music';
import { mulberry32 } from '../src/noise';

const MOODS: Mood[] = ['title', 'day', 'night', 'snow', 'cave', 'ember', 'hollow'];

describe('generative music', () => {
  for (const mood of MOODS) {
    it(`composes a playable ${mood} piece`, () => {
      for (let seed = 1; seed <= 20; seed++) {
        const { notes, length } = compose(mood, mulberry32(seed));
        expect(length).toBeGreaterThan(30);
        expect(length).toBeLessThan(160);
        expect(notes.some((n) => n.kind === 'piano' || n.kind === 'bell')).toBe(true);
        for (const n of notes) {
          expect(n.t).toBeGreaterThanOrEqual(-0.05);
          expect(n.t + n.dur).toBeLessThanOrEqual(length + 0.01);
          expect(n.midi).toBeGreaterThanOrEqual(24);
          expect(n.midi).toBeLessThanOrEqual(100);
          expect(n.gain).toBeGreaterThan(0);
          expect(n.gain).toBeLessThan(0.2);
        }
      }
    });
  }

  it('is varied: different seeds give different pieces', () => {
    const a = compose('day', mulberry32(1)).notes.map((n) => n.midi).join();
    const b = compose('day', mulberry32(2)).notes.map((n) => n.midi).join();
    expect(a).not.toBe(b);
  });

  it('ends on the home chord', () => {
    const { notes } = compose('night', mulberry32(7));
    const lastT = Math.max(...notes.map((n) => n.t));
    const pad = notes.filter((n) => n.t === lastT && n.kind === 'pad').map((n) => n.midi % 12);
    const bass = notes.find((n) => n.t === lastT && n.kind === 'bass');
    expect(pad.length).toBe(3);
    expect(pad).toContain(bass!.midi % 12);
  });
});
