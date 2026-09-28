// The trailer's score: 44 bars at 100 bpm (2.4 s a bar), rendered offline in the browser with
// Web Audio. Every sound is synthesized here, in the same spirit as the game's own music.
//
//   bars  0-5   dawn: pad and a piano motif
//   bars  6-13  the world: a pulse, kick and hats come in
//   bars 14-15  nightfall: everything drains away under a riser
//   bars 16-23  hit: taiko drums, braams, the motif in the minor
//   bars 24-31  the Emberdeep: half-time, heavy, phrygian, anvil strikes
//   bars 32-35  the Hollow: drums out, glassy bells, a riser
//   bars 36-39  climax: everything
//   bars 40-43  the logo: one last impact, then it rings out

window.renderScore = async function renderScore() {
  const SR = 48000, BAR = 2.4, BEAT = 0.6, LEN = 44 * BAR + 6;
  const ctx = new OfflineAudioContext(2, Math.ceil(LEN * SR), SR);
  const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);

  // ---- Mix bus: a compressor, a long hall reverb and a short room.
  const master = ctx.createDynamicsCompressor();
  master.threshold.value = -14; master.ratio.value = 3; master.attack.value = 0.01; master.release.value = 0.25;
  const out = ctx.createGain(); out.gain.value = 0.9;
  master.connect(out).connect(ctx.destination);
  const impulse = (secs, decay) => {
    const n = Math.floor(secs * SR), b = ctx.createBuffer(2, n, SR);
    for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay); }
    return b;
  };
  const hall = ctx.createConvolver(); hall.buffer = impulse(4.5, 2.6);
  const hallGain = ctx.createGain(); hallGain.gain.value = 0.55;
  hall.connect(hallGain).connect(master);
  const room = ctx.createConvolver(); room.buffer = impulse(1.2, 4);
  const roomGain = ctx.createGain(); roomGain.gain.value = 0.35;
  room.connect(roomGain).connect(master);
  /** A channel strip: level, pan, and sends to the reverbs. */
  const strip = (level, pan = 0, hallSend = 0.3, roomSend = 0) => {
    const g = ctx.createGain(); g.gain.value = level;
    const p = ctx.createStereoPanner(); p.pan.value = pan;
    g.connect(p).connect(master);
    if (hallSend) { const s = ctx.createGain(); s.gain.value = hallSend; p.connect(s).connect(hall); }
    if (roomSend) { const s = ctx.createGain(); s.gain.value = roomSend; p.connect(s).connect(room); }
    return g;
  };
  const busPad = strip(0.55, 0, 0.6), busPiano = strip(0.9, 0.1, 0.5), busBell = strip(0.6, -0.15, 0.8), busBass = strip(0.9, 0, 0.05);
  const busKick = strip(1.0, 0, 0.05, 0.1), busPerc = strip(0.55, 0.05, 0.15, 0.3), busHat = strip(0.22, 0.25, 0.1), busTom = strip(0.9, 0, 0.5, 0.2);
  const busBraam = strip(0.5, 0, 0.5), busFx = strip(0.5, 0, 0.6), busLead = strip(0.35, -0.05, 0.6);

  const noiseBuf = (() => { const b = ctx.createBuffer(1, SR * 2, SR); const d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; return b; })();
  const noise = (t, dur) => { const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true; s.start(t); s.stop(t + dur); return s; };
  const env = (t, a, peak, hold, rel, dest) => {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.setValueAtTime(peak, t + a + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + hold + rel);
    g.connect(dest);
    return g;
  };
  const osc = (type, f, t, end, dest, detune = 0) => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; o.detune.value = detune; o.connect(dest); o.start(t); o.stop(end); return o; };

  // ---- Voices.
  const pad = (t, notes, dur, level = 0.06, bright = 900) => {
    for (const m of notes) for (const [det, pan] of [[-9, -0.5], [9, 0.5]]) {
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.4;
      lp.frequency.setValueAtTime(bright * 0.5, t); lp.frequency.linearRampToValueAtTime(bright, t + dur * 0.6);
      const p = ctx.createStereoPanner(); p.pan.value = pan;
      lp.connect(p).connect(busPad);
      const g = env(t, Math.min(1.2, dur * 0.35), level, dur * 0.5, dur * 0.5 + 0.8, lp);
      osc('sawtooth', hz(m), t, t + dur + 1.8, g, det);
      osc('sine', hz(m - 12), t, t + dur + 1.8, g);
    }
  };
  const piano = (t, m, dur, level = 0.12) => {
    const g = ctx.createGain(); g.connect(busPiano);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(level, t + 0.006);
    g.gain.exponentialRampToValueAtTime(level * 0.35, t + 0.3); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 2.4);
    const f = hz(m);
    for (const [mul, lvl, det] of [[1, 0.8, 0], [2, 0.18, 3], [3, 0.06, -2], [1, 0.3, 5]]) { const lg = ctx.createGain(); lg.gain.value = lvl; lg.connect(g); osc(mul === 2 ? 'triangle' : 'sine', f * mul, t, t + dur + 2.5, lg, det); }
  };
  const bell = (t, m, level = 0.08, ring = 3) => {
    const g = ctx.createGain(); g.connect(busBell);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(level, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + ring);
    const f = hz(m);
    for (const [mul, lvl] of [[1, 0.7], [2.76, 0.25], [5.4, 0.08], [0.5, 0.15]]) { const lg = ctx.createGain(); lg.gain.value = lvl; lg.connect(g); osc('sine', f * mul, t, t + ring + 0.1, lg); }
  };
  const bass = (t, m, dur, level = 0.22) => {
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420; lp.Q.value = 2; lp.connect(busBass);
    const g = env(t, 0.01, level, dur * 0.4, dur * 0.6, lp);
    osc('sawtooth', hz(m), t, t + dur + 0.2, g); osc('sine', hz(m), t, t + dur + 0.2, g);
  };
  const sub = (t, m, dur, level = 0.35) => { const g = env(t, 0.02, level, dur * 0.5, dur * 0.5, busBass); osc('sine', hz(m), t, t + dur + 0.1, g); };
  const kick = (t, level = 0.9) => {
    const g = env(t, 0.002, level, 0.02, 0.4, busKick);
    const o = ctx.createOscillator(); o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12); o.connect(g); o.start(t); o.stop(t + 0.5);
    const c = env(t, 0.001, level * 0.3, 0, 0.02, busKick); const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2000; hp.connect(c); noise(t, 0.03).connect(hp);
  };
  const clap = (t, level = 0.5) => {
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1500; bp.Q.value = 0.8;
    const g = ctx.createGain(); g.connect(busPerc); bp.connect(g);
    g.gain.setValueAtTime(0.0001, t);
    for (const k of [0, 0.012, 0.024]) { g.gain.linearRampToValueAtTime(level, t + k + 0.002); g.gain.exponentialRampToValueAtTime(level * 0.2, t + k + 0.011); }
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    noise(t, 0.35).connect(bp);
  };
  const hat = (t, level = 0.25, open = false) => {
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7000;
    const g = env(t, 0.001, level, 0, open ? 0.25 : 0.05, busHat); hp.connect(g); noise(t, open ? 0.3 : 0.07).connect(hp);
  };
  const tom = (t, level = 0.9, pitch = 1) => {
    const g = env(t, 0.003, level, 0.02, 0.9, busTom);
    const o = ctx.createOscillator(); o.frequency.setValueAtTime(170 * pitch, t); o.frequency.exponentialRampToValueAtTime(62 * pitch, t + 0.35); o.connect(g); o.start(t); o.stop(t + 1.1);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
    const n = env(t, 0.002, level * 0.35, 0, 0.18, busTom); lp.connect(n); noise(t, 0.25).connect(lp);
  };
  const crash = (t, level = 0.25) => {
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 4500;
    const g = env(t, 0.002, level, 0.05, 2.4, busFx); hp.connect(g); noise(t, 2.6).connect(hp);
  };
  const shaper = (() => { const ws = ctx.createWaveShaper(); const c = new Float32Array(1024); for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; c[i] = Math.tanh(x * 2.5); } ws.curve = c; return ws; })();
  const braamIn = ctx.createGain(); braamIn.gain.value = 0.5; braamIn.connect(shaper).connect(busBraam);
  const braam = (t, root, dur = 2.4, level = 0.5) => {
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 3;
    lp.frequency.setValueAtTime(120, t); lp.frequency.exponentialRampToValueAtTime(1400, t + 0.25); lp.frequency.exponentialRampToValueAtTime(200, t + dur);
    const g = env(t, 0.03, level, dur * 0.4, dur * 0.6, lp); lp.connect(braamIn);
    for (const [iv, det] of [[0, -6], [0, 6], [7, 0], [12, -4], [-12, 0]]) osc('sawtooth', hz(root + iv), t, t + dur + 0.2, g, det);
  };
  const riser = (t, dur, level = 0.3) => {
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 3;
    bp.frequency.setValueAtTime(300, t); bp.frequency.exponentialRampToValueAtTime(9000, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(level, t + dur); g.gain.setValueAtTime(0.0001, t + dur + 0.01);
    bp.connect(g).connect(busFx); noise(t, dur + 0.02).connect(bp);
    const sg = ctx.createGain(); sg.gain.setValueAtTime(0.0001, t); sg.gain.exponentialRampToValueAtTime(level * 0.25, t + dur); sg.gain.setValueAtTime(0.0001, t + dur + 0.01); sg.connect(busFx);
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(880, t + dur); o.connect(sg); o.start(t); o.stop(t + dur + 0.02);
  };
  const impact = (t, root, level = 1) => {
    kick(t, level); tom(t, level, 0.7); crash(t, 0.35 * level); braam(t, root, 4.5, 0.6 * level);
    const g = env(t, 0.005, 0.6 * level, 0.3, 3.5, busBass);
    const o = ctx.createOscillator(); o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(28, t + 3); o.connect(g); o.start(t); o.stop(t + 4);
  };
  const lead = (t, m, dur, level = 0.08) => {
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400; lp.connect(busLead);
    const g = env(t, 0.03, level, dur * 0.7, 0.6, lp);
    osc('sawtooth', hz(m), t, t + dur + 0.7, g, -5); osc('sawtooth', hz(m), t, t + dur + 0.7, g, 5); osc('square', hz(m - 12), t, t + dur + 0.7, g);
    bell(t, m + 12, level * 0.6, 1.6);
  };

  // ---- Harmony, bar by bar (MIDI triads around D3), and the bass root.
  const D = [50, 54, 57], Bm = [47, 50, 54], G = [43, 47, 50], A = [45, 49, 52], E = [52, 56, 59];
  const Dm = [50, 53, 57], Eb = [51, 55, 58], C = [48, 52, 55];
  const chords = [];
  for (let b = 0; b < 14; b++) chords.push([D, Bm, G, A][b % 4]);
  chords.push(G, A);
  for (let b = 16; b < 24; b++) chords.push([Bm, G, D, A][b % 4]);
  for (let b = 24; b < 32; b++) chords.push([Dm, Eb, Dm, C][b % 4]);
  for (let b = 32; b < 36; b++) chords.push([D, E, Bm, A][b % 4]);
  chords.push(G, A, Bm, A);
  chords.push(D, D, D, D);

  // The motif: two bars of eighths as MIDI notes (null rests), in D major.
  const motif = [74, null, 69, 78, 76, null, 74, 69, 71, null, 74, null, 76, 74, null, null];
  const motifMinor = [74, null, 69, 77, 76, null, 74, 69, 70, null, 74, null, 76, 73, null, null];

  for (let b = 0; b < 44; b++) {
    const t = b * BAR, ch = chords[b], root = ch[0] - 12;
    const section = b < 6 ? 'dawn' : b < 14 ? 'world' : b < 16 ? 'dusk' : b < 24 ? 'hit' : b < 32 ? 'ember' : b < 36 ? 'hollow' : b < 40 ? 'climax' : 'logo';
    // Pads everywhere but the logo's tail (which gets one long chord).
    if (section !== 'logo') pad(t, ch.map((n) => n + 12), BAR * 1.02, section === 'dawn' ? 0.045 : section === 'ember' ? 0.05 : 0.055, section === 'ember' ? 600 : section === 'hollow' ? 2600 : 1400);
    // The motif.
    const m = section === 'hit' || section === 'ember' ? motifMinor : motif;
    const half = b % 2;
    if (section === 'dawn' && b >= 1) for (let e = 0; e < 8; e++) { const n = m[half * 8 + e]; if (n) piano(t + e * BEAT / 2, n - 12, BEAT, 0.11); }
    if (section === 'world') for (let e = 0; e < 8; e++) { const n = m[half * 8 + e]; if (n) piano(t + e * BEAT / 2, n, BEAT, 0.09); }
    if (section === 'hit' || section === 'climax') for (let e = 0; e < 8; e++) { const n = m[half * 8 + e]; if (n) lead(t + e * BEAT / 2, n, BEAT * 0.9, section === 'climax' ? 0.09 : 0.07); }
    if (section === 'ember' && half === 0) for (let e = 0; e < 8; e += 2) { const n = m[e]; if (n) bell(t + e * BEAT / 2, n - 12, 0.07, 2.5); }
    if (section === 'hollow') for (let s = 0; s < 16; s++) bell(t + s * BEAT / 4, ch[s % 3] + 24 + (s % 6 === 5 ? 12 : 0), 0.035 + (s % 4 === 0 ? 0.02 : 0), 2.2);
    // Rhythm section.
    if (section === 'world') {
      for (let e = 0; e < 8; e++) bass(t + e * BEAT / 2, root + (e === 7 ? 7 : 0), BEAT / 2 * 0.8, b < 8 ? 0.12 : 0.18);
      if (b >= 8) { kick(t); kick(t + 2 * BEAT, 0.8); }
      if (b >= 10) { clap(t + BEAT, 0.35); clap(t + 3 * BEAT, 0.35); }
      if (b >= 8) for (let e = 0; e < 8; e++) hat(t + e * BEAT / 2 + BEAT / 4, e % 2 ? 0.2 : 0.12);
    }
    if (section === 'dusk') {
      sub(t, root, BAR, 0.2);
      if (b === 14) riser(t, BAR * 2, 0.35);
      if (b === 15) for (let k = 0; k < 16; k++) clap(t + (k / 16) * BAR * (1 - k * 0.02), 0.08 + k * 0.02);
    }
    if (section === 'hit' || section === 'climax') {
      if (b === 16) impact(t, 35);
      if (b === 36) impact(t, 31);
      for (let e = 0; e < 8; e++) bass(t + e * BEAT / 2, root + (e % 4 === 3 ? 12 : 0), BEAT / 2 * 0.85, 0.2);
      for (let q = 0; q < 4; q++) kick(t + q * BEAT, q === 0 ? 1 : 0.75);
      clap(t + BEAT, 0.45); clap(t + 3 * BEAT, 0.45);
      for (const [k, lv, p] of [[0, 1, 1], [1.5, 0.7, 1.1], [2, 0.9, 1], [3.5, 0.7, 1.2]]) tom(t + k * BEAT, lv * 0.8, p);
      for (let s = 0; s < 16; s++) hat(t + s * BEAT / 4, s % 4 === 2 ? 0.2 : 0.09, s === 14);
      if (b % 4 === 0) { braam(t, root - 12 + 12, BAR * 1.6, 0.4); crash(t, 0.22); }
      if (section === 'climax' && b === 39) riser(t, BAR, 0.4);
    }
    if (section === 'ember') {
      if (b === 24) impact(t, 38, 0.9);
      sub(t, root, BAR, 0.3);
      tom(t, 1, 0.8); tom(t + 2 * BEAT, 0.95, 0.75); tom(t + 3.5 * BEAT, 0.6, 0.9);
      kick(t); kick(t + 2 * BEAT, 0.9);
      clap(t + 2 * BEAT, 0.3);
      if (b % 2 === 0) braam(t, root, BAR * 1.8, 0.55);
      bell(t + 3 * BEAT, 86 + (b % 2), 0.05, 1.2); // anvil
      for (let e = 0; e < 8; e++) hat(t + e * BEAT / 2, 0.06);
    }
    if (section === 'hollow') {
      sub(t, root, BAR, 0.14);
      if (b === 32) crash(t, 0.2);
      if (b === 35) riser(t, BAR, 0.4);
    }
    if (section === 'logo' && b === 40) {
      impact(t, 38, 1.2);
      pad(t, [50, 57, 62, 66, 69], BAR * 3.5, 0.07, 1800);
      sub(t, 38, BAR * 3, 0.3);
      for (const [k, n] of [[4, 74], [4.5, 69], [5, 78], [5.5, 76], [6.5, 74]]) bell(t + k * BEAT, n, 0.07, 4);
      piano(t + 8 * BEAT, 62, BAR * 2, 0.1); piano(t + 8 * BEAT, 69, BAR * 2, 0.08); piano(t + 8 * BEAT, 74, BAR * 2, 0.08);
    }
  }

  const buf = await ctx.startRendering();
  // Hand back 16-bit PCM, interleaved, as base64 (small enough to cross into Node).
  const L = buf.getChannelData(0), R = buf.getChannelData(1);
  let peak = 0;
  for (let i = 0; i < L.length; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  const norm = peak > 0 ? 0.92 / peak : 1;
  const pcm = new Int16Array(L.length * 2);
  for (let i = 0; i < L.length; i++) { pcm[i * 2] = Math.max(-1, Math.min(1, L[i] * norm)) * 32767; pcm[i * 2 + 1] = Math.max(-1, Math.min(1, R[i] * norm)) * 32767; }
  const bytes = new Uint8Array(pcm.buffer);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return { sampleRate: SR, channels: 2, data: btoa(s), peak };
};
