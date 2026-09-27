// Creature animation. Each frame, a creature's pose is rebuilt from its
// resting pose plus: a walk cycle scaled by how fast it is moving, breathing,
// head tracking, and behaviour-specific motion (grazing, pecking, aiming,
// attacking, swelling, hovering). Values that respond to events are smoothed so
// motion eases in and out instead of snapping.

import type * as THREE from 'three';
import type { Mob } from './entities';

/** Per-creature smoothed animation state. */
export interface AnimState {
  speed: number;
  look: number;
  pitch: number;
  graze: number;
  attack: number;
  lastCd: number;
  twitch: number;
  earTimer: number;
  ear: number;
  gesture: number;
  /** 0 wave, 1 scratch head, 2 look around. */
  gestureKind: number;
  seed: number;
  /** Displayed yaw (eases toward the mob's real yaw) and the lean that turning produces. */
  yaw: number;
  lean: number;
  /** Idle glances: where the head drifts when nothing holds its attention. */
  glance: number;
  glanceTarget: number;
  glanceTimer: number;
  blink: number;
  blinkTimer: number;
  /** Landing squash, 1 on touchdown easing to 0. */
  land: number;
  wasAir: boolean;
}

export function newAnimState(): AnimState {
  return {
    speed: 0, look: 0, pitch: 0, graze: 0, attack: 0, lastCd: 0, twitch: 0, earTimer: 60, ear: 0, gesture: 0, gestureKind: 0,
    seed: Math.random() * 100, yaw: NaN, lean: 0, glance: 0, glanceTarget: 0, glanceTimer: 1, blink: 0, blinkTimer: 1 + Math.random() * 4,
    land: 0, wasAir: false,
  };
}

type Parts = Record<string, THREE.Object3D>;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

function rot(p: THREE.Object3D | undefined, x = 0, y = 0, z = 0): void {
  if (!p) return;
  const b = (p.userData.baseRot as number[] | undefined) ?? [0, 0, 0];
  p.rotation.set(b[0] + x, b[1] + y, b[2] + z);
}
function move(p: THREE.Object3D | undefined, x = 0, y = 0, z = 0): void {
  if (!p) return;
  const b = p.userData.basePos as THREE.Vector3 | undefined;
  if (b) p.position.set(b.x + x / 16, b.y + y / 16, b.z + z / 16);
}
function scale(p: THREE.Object3D | undefined, x: number, y = x, z = x): void {
  if (p) p.scale.set(x, y, z);
}
function visible(p: THREE.Object3D | undefined, v: boolean): void {
  if (p) p.visible = v;
}

interface Ctx {
  mob: Mob;
  parts: Parts;
  a: AnimState;
  /** Seconds, continuous. */
  t: number;
  /** Walk phase (radians) and how strongly to apply it (0..1). */
  phase: number;
  amp: number;
  /** Head yaw and pitch toward whatever the creature is looking at. */
  look: number;
  pitch: number;
  idle: boolean;
}

// ---------------------------------------------------------------- shared motions
function quadLegs(c: Ctx, mag: number): void {
  const s = Math.sin(c.phase) * mag * c.amp;
  rot(c.parts.legFL, s); rot(c.parts.legBR, s);
  rot(c.parts.legFR, -s); rot(c.parts.legBL, -s);
}
function bipedLegs(c: Ctx, mag: number, limp = 0): void {
  const s = Math.sin(c.phase) * mag * c.amp;
  rot(c.parts.legL, s * (1 - limp));
  rot(c.parts.legR, -s * (1 + limp * 0.3));
}
function bob(c: Ctx, height: number, sway = 0): void {
  const body = c.parts.body;
  body.position.y = Math.abs(Math.sin(c.phase)) * height / 16 * c.amp;
  body.rotation.z = Math.sin(c.phase) * sway * c.amp;
}
function breathe(c: Ctx, part = 'torso', amt = 0.025, rate = 2.2): void {
  const b = 1 + Math.sin(c.t * rate + c.a.seed) * amt;
  scale(c.parts[part], 1 + (b - 1) * 0.5, b, 1 + (b - 1) * 0.5);
}
/** Aim the head: `nod` > 0 lowers the nose (grazing, pecking); `tilt` rolls it. */
function head(c: Ctx, nod = 0, tilt = 0, lookMul = 1): void {
  rot(c.parts.head, c.pitch * 0.7 - nod, c.look * lookMul, tilt);
}
/** Tail sway, wagging fast when the animal has been fed. */
function tailWag(c: Ctx, name: string, lift: number, sway: number, rate: number): void {
  const love = c.mob.love > 0 ? 1 : 0;
  const s = Math.sin(c.t * (rate + love * 14) + c.a.seed) * (sway + love * 0.35);
  rot(c.parts[name], lift + love * -0.3, s, 0);
}
/** Ears that flick every few seconds. */
function ears(c: Ctx, l: string, r: string, amt = 0.4): void {
  const f = Math.sin(c.a.ear * Math.PI) * amt;
  rot(c.parts[l], 0, 0, f);
  rot(c.parts[r], 0, 0, -f * 0.6);
}
function armsSwing(c: Ctx, mag: number): [number, number] {
  const s = Math.sin(c.phase) * mag * c.amp;
  return [-s, s].map((v, i) => v + Math.sin(c.t * 1.6 + c.a.seed + i) * 0.04) as [number, number];
}
/** Tripod gait for six legs: alternate groups lift and swing. */
function sixLegs(c: Ctx, swing: number, lift: number): void {
  for (let i = 0; i < 3; i++) for (const side of ['L', 'R']) {
    const group = (i + (side === 'L' ? 0 : 1)) % 2 === 0 ? 0 : Math.PI;
    const ph = c.phase * 1.4 + group;
    const up = Math.max(0, Math.sin(ph)) * lift * c.amp;
    rot(c.parts['leg' + side + i], 0, Math.cos(ph) * swing * c.amp * (side === 'L' ? 1 : -1), side === 'L' ? -up : up);
  }
}

// ---------------------------------------------------------------- creatures
type Animator = (c: Ctx) => void;

const ANIMATORS: Record<string, Animator> = {
  boar(c) {
    quadLegs(c, 0.7); bob(c, 0.8, 0.03); breathe(c);
    const sniff = c.idle ? Math.sin(c.t * 9) * 0.05 * (0.5 + 0.5 * Math.sin(c.t * 0.7 + c.a.seed)) : 0;
    head(c, c.a.graze * 0.75 + sniff + Math.sin(c.phase * 2) * 0.05 * c.amp);
    ears(c, 'earL', 'earR', 0.5);
    tailWag(c, 'tail', -c.amp * 0.4, 0.35, 5);
    rot(c.parts.mane, 0, 0, Math.sin(c.phase) * 0.04 * c.amp);
  },
  hen(c) {
    const s = Math.sin(c.phase * 1.2) * 0.9 * c.amp;
    rot(c.parts.legL, s); rot(c.parts.legR, -s);
    bob(c, 0.6, 0.06); breathe(c, 'torso', 0.03, 3);
    // Head bobs forward with each step; pecks at the ground when idle.
    const peck = c.a.graze * (0.6 + 0.6 * Math.max(0, Math.sin(c.t * 13)));
    head(c, peck, Math.sin(c.t * 0.9 + c.a.seed) * 0.12 * (c.idle ? 1 : 0));
    move(c.parts.head, 0, 0, -Math.max(0, Math.sin(c.phase * 2.4)) * 1.2 * c.amp);
    const airborne = !c.mob.body.onGround || c.mob.panic > 0;
    const flap = airborne ? 0.3 + Math.abs(Math.sin(c.t * 22)) * 0.9 : 0;
    rot(c.parts.wingL, 0, 0, flap); rot(c.parts.wingR, 0, 0, -flap);
    rot(c.parts.tailFan, Math.sin(c.t * 3 + c.a.seed) * 0.08, Math.sin(c.phase) * 0.15 * c.amp, 0);
    rot(c.parts.crest, Math.sin(c.phase * 2.4) * 0.2 * c.amp, 0, Math.sin(c.t * 2 + c.a.seed) * 0.1);
    rot(c.parts.wattle, Math.sin(c.phase * 2.4 + 1) * 0.35 * c.amp + peck * 0.4);
  },
  woolback(c) {
    quadLegs(c, 0.6); bob(c, 0.7, 0.02); breathe(c, 'wool', 0.02, 1.6);
    const chew = c.a.graze > 0.6 ? Math.sin(c.t * 9) * 0.06 : 0;
    head(c, c.a.graze * 0.95 + chew);
    ears(c, 'earL', 'earR', 0.35);
    tailWag(c, 'tail', 0, 0.3, 4);
    visible(c.parts.wool, !c.mob.sheared);
    visible(c.parts.tail, !c.mob.sheared);
  },
  mossback(c) {
    quadLegs(c, 0.75); bob(c, 1.1, 0.02); breathe(c, 'torso', 0.02, 1.4);
    const air = !c.mob.body.onGround;
    if (air) { rot(c.parts.legFL, -0.9); rot(c.parts.legFR, -0.9); rot(c.parts.legBL, 0.8); rot(c.parts.legBR, 0.8); }
    rot(c.parts.neck, -c.a.graze * 0.9 + Math.sin(c.phase * 2) * 0.04 * c.amp);
    head(c, c.a.graze * 0.3, 0, 0.6);
    ears(c, 'earL', 'earR', 0.45);
    tailWag(c, 'tail', 0, 0.25, 3);
    visible(c.parts.saddle, c.mob.saddled);
  },
  burrowfox(c) {
    visible(c.parts.collar, c.mob.tamed);
    if (c.mob.sitting) {
      // Sitting: haunches down, front legs straight, tail curled round.
      rot(c.parts.legBL, -1.4); rot(c.parts.legBR, -1.4); rot(c.parts.legFL, 0); rot(c.parts.legFR, 0);
      c.parts.body.position.y = -0.12;
      c.parts.body.rotation.x = 0.35;
      head(c, -0.3, Math.sin(c.t * 0.8 + c.a.seed) * 0.15);
      rot(c.parts.tail, -0.2, 0.9, 0);
      return;
    }
    quadLegs(c, 0.85); bob(c, 0.9, 0.03); breathe(c);
    // Curious head tilt when watching you.
    const tilt = c.idle && Math.abs(c.look) < 1 ? Math.sin(c.t * 0.8 + c.a.seed) * 0.25 : 0;
    head(c, c.a.graze * 0.6, tilt);
    ears(c, 'earL', 'earR', 0.3);
    tailWag(c, 'tail', -c.amp * 0.3 + Math.sin(c.t * 2.2) * 0.06, 0.3 + 0.2 * c.amp, 1.7);
  },
  bogfrog(c) {
    const vy = c.mob.body.vel[1];
    const air = !c.mob.body.onGround;
    const stretch = air ? clamp(0.5 + vy * 3, 0, 1) : 0;
    rot(c.parts.thighL, air ? 0.9 * stretch : -0.1);
    rot(c.parts.thighR, air ? 0.9 * stretch : -0.1);
    rot(c.parts.armL, air ? -0.6 : 0); rot(c.parts.armR, air ? -0.6 : 0);
    rot(c.parts.torso, air ? -0.35 * stretch : 0);
    const pulse = c.idle ? Math.max(0, Math.sin(c.t * 5 + c.a.seed)) * (0.5 + 0.5 * Math.sin(c.t * 0.4)) : 0;
    scale(c.parts.throat, 1 + pulse * 0.15, 1 + pulse * 1.6, 1 + pulse * 0.25);
    rot(c.parts.eyeL, 0, 0, Math.sin(c.t * 0.6) * 0.1);
    head(c, 0, 0, 0.3);
  },
  bee(c) {
    const f = Math.sin(c.t * 40 + c.a.seed);
    rot(c.parts.wingL, 0, 0, 0.2 + f * 0.7); rot(c.parts.wingR, 0, 0, -0.2 - f * 0.7);
    c.parts.body.position.y = Math.sin(c.t * 5 + c.a.seed) * 0.03;
    rot(c.parts.torso, c.mob.beeAnger > 0 ? 0.25 : Math.sin(c.t * 2) * 0.06, 0, 0);
    rot(c.parts.antennaL, -0.5 + Math.sin(c.t * 4) * 0.15); rot(c.parts.antennaR, -0.5 + Math.sin(c.t * 4 + 1) * 0.15);
  },
  cavemoth(c) {
    const f = Math.sin(c.t * 26 + c.a.seed);
    rot(c.parts.wingL, 0, 0, 0.15 + f * 0.8); rot(c.parts.wingR, 0, 0, -0.15 - f * 0.8);
    rot(c.parts.wingBL, 0, 0, 0.1 + f * 0.6); rot(c.parts.wingBR, 0, 0, -0.1 - f * 0.6);
    rot(c.parts.antennaL, Math.sin(c.t * 3) * 0.2); rot(c.parts.antennaR, Math.sin(c.t * 3 + 1) * 0.2);
    c.parts.body.position.y = Math.sin(c.t * 4 + c.a.seed) * 0.05 + f * 0.012;
    c.parts.body.rotation.x = 0.12 + Math.sin(c.t * 1.3) * 0.06;
  },
  streamfish(c) {
    const s = Math.sin(c.t * 9 + c.a.seed) * (0.2 + c.amp * 0.3);
    rot(c.parts.torso, 0, s * 0.5, 0);
    rot(c.parts.tail, 0, -s * 1.4, 0);
    rot(c.parts.dorsal, 0, 0, s * 0.3);
    const fin = Math.sin(c.t * 6 + c.a.seed) * 0.4;
    rot(c.parts.finL, 0, 0, fin); rot(c.parts.finR, 0, 0, -fin);
    rot(c.parts.jaw, Math.max(0, Math.sin(c.t * 2.5)) * 0.25);
  },
  villager(c) {
    bipedLegs(c, 0.7); bob(c, 0.6, 0.02); breathe(c);
    let [al, ar] = armsSwing(c, 0.55);
    let az = 0, nod = Math.sin(c.t * 0.7 + c.a.seed) * 0.05, tilt = 0;
    const g = Math.min(1, c.a.gesture * 2);   // ease in and out of gestures
    if (c.idle && c.a.gesture > 0) {
      if (c.a.gestureKind === 0) { ar = lerp(ar, -2.7 + Math.sin(c.t * 11) * 0.3, g); az = -0.35 * g; }                       // wave
      else if (c.a.gestureKind === 1) { ar = lerp(ar, -2.5, g); az = lerp(0, 0.55 + Math.sin(c.t * 16) * 0.12, g); tilt = 0.2 * g; nod = -0.1 * g; } // scratch head
      else { nod = 0.25 * g; al = lerp(al, -0.5, g); ar = lerp(ar, -0.5, g); }                                              // peer at the ground
    }
    rot(c.parts.armL, al); rot(c.parts.armR, ar, 0, az);
    head(c, nod, tilt);
    rot(c.parts.hatBrim, Math.sin(c.phase * 2) * 0.03 * c.amp);
  },
  stonewarden(c) {
    bipedLegs(c, 0.45); bob(c, 1.2, 0.05); breathe(c, 'torso', 0.015, 1.2);
    let [al, ar] = armsSwing(c, 0.4);
    // Slam: both arms high then crash down.
    const atk = c.a.attack;
    if (atk > 0) { const k = atk > 0.5 ? (1 - atk) * 2 : atk * 2; al = ar = -2.4 * k; }
    rot(c.parts.armL, al); rot(c.parts.armR, ar);
    head(c, 0.1);
    rot(c.parts.sapling, Math.sin(c.phase * 2) * 0.15 * c.amp, 0, Math.sin(c.t * 2 + c.a.seed) * 0.15);
    // Its heart glows brighter as it winds up a slam.
    scale(c.parts.heart, 1 + atk * 0.4);
  },

  // ------------------------------------------------ hostile
  zombie(c) {
    bipedLegs(c, 0.65, 0.45); bob(c, 0.9, 0.09); breathe(c, 'torso', 0.02, 1.4);
    let [al, ar] = armsSwing(c, 0.3);
    const reach = c.mob.aiming ? -1.25 : -0.15;
    al += reach + Math.sin(c.t * 2.1) * 0.12 * (c.mob.aiming ? 1 : 0);
    ar += reach + Math.sin(c.t * 2.1 + 1.3) * 0.12 * (c.mob.aiming ? 1 : 0);
    if (c.a.attack > 0) { al -= c.a.attack * 0.9; ar -= c.a.attack * 0.9; }
    rot(c.parts.armL, al, 0, 0.08); rot(c.parts.armR, ar, 0, -0.08);
    // Head lolls, with the odd sudden twitch.
    head(c, 0, Math.sin(c.t * 1.3 + c.a.seed) * 0.18 + c.a.twitch * 0.5, 0.7);
    // The jaw hangs slack and snaps shut when it bites.
    rot(c.parts.jaw, 0.15 + (c.mob.aiming ? Math.max(0, Math.sin(c.t * 7)) * 0.4 : 0) + c.a.attack * 0.5);
  },
  skeleton(c) {
    bipedLegs(c, 0.7); bob(c, 0.7, 0.03);
    const jitter = (Math.random() - 0.5) * 0.04 * c.amp;
    let [al, ar] = armsSwing(c, 0.45);
    if (c.mob.aiming) {
      // Bow arm straight out, string hand drawing back as the shot nears.
      const delay = c.mob.spec.shotDelay ?? 40;
      const draw = clamp(1 - c.mob.attackCooldown / delay, 0, 1);
      ar = -1.5; al = -1.4 + draw * 0.1;
      rot(c.parts.armR, ar, 0.05, 0);
      rot(c.parts.armL, al, -0.5 * draw, 0);
    } else { rot(c.parts.armL, al + jitter); rot(c.parts.armR, ar - jitter); }
    // The cloak streams out behind when it runs.
    rot(c.parts.cloak, -clamp(c.a.speed * 5, 0, 0.6) - Math.abs(Math.sin(c.phase)) * 0.1 * c.amp + Math.sin(c.t * 2.5 + c.a.seed) * 0.04);
    rot(c.parts.jaw, Math.max(0, Math.sin(c.t * (c.mob.aiming ? 18 : 3))) * (c.mob.aiming ? 0.25 : 0.06));
    head(c, 0, jitter * 2);
  },
  raider(c) {
    bipedLegs(c, 0.7); bob(c, 0.8, 0.04); breathe(c);
    let [al, ar] = armsSwing(c, 0.45);
    if (c.mob.aiming) {
      // Crossbow levelled at the shoulder; the off hand steadies the prod.
      ar = -1.45; al = -1.3;
      rot(c.parts.armR, ar, 0, 0); rot(c.parts.armL, al, 0.55, 0);
    } else { rot(c.parts.armL, al); rot(c.parts.armR, ar * 0.5 - 0.25); }
    rot(c.parts.crossbow, c.mob.aiming ? 0 : 0.9);
    // The scarf tail streams out behind at a run.
    rot(c.parts.scarfTail, -0.2 - Math.min(0.9, c.a.speed * 6) - Math.abs(Math.sin(c.phase)) * 0.15 * c.amp + Math.sin(c.t * 3 + c.a.seed) * 0.08, 0, 0.1);
    if (c.parts.pennant) {
      c.parts.pennant.visible = c.mob.captain;
      rot(c.parts.pennant, 0.12 + Math.sin(c.phase) * 0.05 * c.amp, 0, -0.08 + Math.sin(c.t * 1.7) * 0.03);
    }
    head(c, c.mob.aiming ? 0.05 : 0);
  },
  witch(c) {
    bipedLegs(c, 0.5); bob(c, 0.7, 0.04); breathe(c);
    let [al, ar] = armsSwing(c, 0.35);
    const delay = c.mob.spec.shotDelay ?? 60;
    if (c.mob.attackCooldown > delay - 12) ar = -2.4 + (delay - c.mob.attackCooldown) * 0.2;   // throw
    if (c.mob.healCooldown > 370) ar = -2.3;                                                      // drinking
    else if (c.mob.aiming) ar = Math.min(ar, -0.6);                                               // potion held ready
    rot(c.parts.armL, al); rot(c.parts.armR, ar);
    const wob = Math.sin(c.phase * 2) * 0.12 * c.amp + Math.sin(c.t * 1.3 + c.a.seed) * 0.06;
    rot(c.parts.hatTop, wob * 0.6, 0, wob * 0.4); rot(c.parts.hatTip, wob, 0, wob);
    rot(c.parts.hairBack, Math.abs(Math.sin(c.phase)) * 0.12 * c.amp + 0.05);
    rot(c.parts.skirt, Math.sin(c.phase) * 0.08 * c.amp, 0, Math.sin(c.phase) * 0.06 * c.amp);
    rot(c.parts.feather, Math.sin(c.t * 3) * 0.1, 0, wob);
    // Cackle: a bouncy shake after a throw.
    const cackle = c.mob.attackCooldown > delay - 25 ? Math.sin(c.t * 30) * 0.06 : 0;
    head(c, cackle);
  },
  blastcap(c) {
    quadLegs(c, 0.9);
    bob(c, 0.8, 0.14);
    const fuse = c.mob.fuse / 30;
    const squash = 1 - Math.sin(c.t * 4 + c.a.seed) * 0.04 - fuse * 0.1;
    scale(c.parts.cap, 1 + fuse * 0.15, squash, 1 + fuse * 0.15);
    move(c.parts.cap, 0, fuse * 1.5, 0);
    if (fuse > 0) { const j = fuse * 0.6; c.parts.body.position.x = (Math.random() - 0.5) * j / 16; c.parts.body.position.z = (Math.random() - 0.5) * j / 16; }
    else c.parts.body.position.x = c.parts.body.position.z = 0;
    rot(c.parts.torso, 0, c.look * 0.3, 0);
  },
  mirewalker(c) {
    bipedLegs(c, 0.55); bob(c, 1.1, 0.07); breathe(c, 'torso', 0.03, 1.1);
    // Long arms dangle and lag behind the stride like pendulums.
    let al = Math.sin(c.phase - 0.8) * 0.5 * c.amp + Math.sin(c.t * 1.4) * 0.05;
    let ar = -Math.sin(c.phase - 0.8) * 0.5 * c.amp + Math.sin(c.t * 1.4 + 2) * 0.05;
    if (c.a.attack > 0) { al -= c.a.attack * 1.6; ar -= c.a.attack * 1.6; }
    else if (c.mob.aiming) { al -= 0.35; ar -= 0.35; }
    rot(c.parts.armL, al); rot(c.parts.armR, ar);
    head(c, 0, Math.sin(c.t * 0.9 + c.a.seed) * 0.12, 0.6);
    rot(c.parts.reed1, Math.sin(c.t * 2) * 0.1, 0, Math.sin(c.t * 1.6) * 0.1);
    rot(c.parts.reed2, Math.sin(c.t * 2 + 1) * 0.1, 0, Math.sin(c.t * 1.6 + 1) * 0.1);
    rot(c.parts.hood, -Math.abs(Math.sin(c.phase)) * 0.06 * c.amp);
  },
  brambler(c) {
    bipedLegs(c, 0.45); bob(c, 0.6, 0.05);
    const [al, ar] = armsSwing(c, 0.4);
    const shot = c.a.attack;
    rot(c.parts.armL, al - shot * 1.2); rot(c.parts.armR, ar - shot * 1.2);
    // Petals flare open when it spits a barb, and breathe slowly otherwise.
    const open = shot * 0.9 + (c.mob.aiming ? 0.25 : 0) + Math.sin(c.t * 1.8 + c.a.seed) * 0.08;
    rot(c.parts.petalN, -open); rot(c.parts.petalS, open); rot(c.parts.petalW, 0, 0, open); rot(c.parts.petalE, 0, 0, -open);
    const pulse = 1 + shot * 0.12;
    scale(c.parts.head, pulse, pulse, pulse);
    scale(c.parts.stamen, 1, 1 + open * 0.8, 1);
    head(c, 0, Math.sin(c.t * 1.1) * 0.1);
  },
  shellcrawler(c) {
    sixLegs(c, 0.45, 0.35);
    c.parts.body.position.y = Math.abs(Math.sin(c.phase * 1.4)) * 0.03 * c.amp;
    const clack = c.mob.aiming ? Math.sin(c.t * 14) * 0.3 : Math.sin(c.t * 2) * 0.05;
    rot(c.parts.mandL, 0, clack, 0); rot(c.parts.mandR, 0, -clack, 0);
    rot(c.parts.head, c.pitch * 0.4 - c.a.attack * 0.4, c.look * 0.4, 0);
    // The body sinks low and rears back before a lunge.
    rot(c.parts.torso, c.mob.aiming ? -0.08 : 0);
  },
  dunescuttler(c) {
    sixLegs(c, 0.5, 0.4);
    const strike = c.a.attack;
    rot(c.parts.tail, strike * 0.9 + Math.sin(c.t * 2.2 + c.a.seed) * 0.08, Math.sin(c.t * 1.5) * 0.15, 0);
    rot(c.parts.tail2, strike * 0.5);
    const snap = c.mob.aiming ? Math.abs(Math.sin(c.t * 9)) * 0.35 : 0.05;
    rot(c.parts.clawL, 0, snap, 0); rot(c.parts.clawR, 0, -snap, 0);
    rot(c.parts.pincerL, 0, snap * 1.4, 0); rot(c.parts.pincerR, 0, -snap * 1.4, 0);
    rot(c.parts.head, 0, c.look * 0.3, 0);
  },
  frostling(c) {
    bipedLegs(c, 0.9); bob(c, 1.4, 0.05);
    let [al, ar] = armsSwing(c, 0.7);
    if (c.mob.attackCooldown > 15) ar = -2.3 + (25 - c.mob.attackCooldown) * 0.15;
    rot(c.parts.armL, al); rot(c.parts.armR, ar);
    head(c, 0, Math.sin(c.t * 2.4 + c.a.seed) * 0.15);
    // The crown of shards shimmers.
    const sh = 1 + Math.sin(c.t * 3 + c.a.seed) * 0.05;
    scale(c.parts.crown, sh, 1 + (sh - 1) * 2, sh);
    rot(c.parts.icicles, Math.sin(c.phase * 2) * 0.12 * c.amp);
  },
  cinderbrute(c) {
    bipedLegs(c, 0.4); bob(c, 1.2, 0.05); breathe(c, 'torso', 0.03, 1.3);
    // Knuckle-walk: the arms swing with the stride; a double-fisted slam when attacking.
    let al = -Math.sin(c.phase) * 0.35 * c.amp, ar = Math.sin(c.phase) * 0.35 * c.amp;
    if (c.a.attack > 0) { const k = c.a.attack > 0.5 ? (1 - c.a.attack) * 2 : c.a.attack * 2; al = ar = -2.2 * k; }
    rot(c.parts.armL, al); rot(c.parts.armR, ar);
    head(c, 0, 0, 0.5);
  },
  emberwisp(c) {
    c.parts.body.position.y = Math.sin(c.t * 2 + c.a.seed) * 0.06;
    c.parts.body.rotation.z = Math.sin(c.t * 1.3) * 0.08;
    const f = Math.sin(c.t * 5 + c.a.seed);
    rot(c.parts.wingL, 0, 0, 0.2 + f * 0.5); rot(c.parts.wingR, 0, 0, -0.2 - f * 0.5);
    for (const n of ['flame1', 'flame2', 'flame3']) scale(c.parts[n], 1, 0.75 + Math.abs(Math.sin(c.t * 7 + n.length * 1.7)) * 0.45, 1);
    rot(c.parts.jaw, c.a.attack * 0.7 + Math.max(0, Math.sin(c.t * 3)) * 0.08);
    rot(c.parts.core, 0, c.t * 2, 0);
    rot(c.parts.torso, c.pitch * 0.4, 0, 0);
  },
};

/**
 * Pose a creature for this frame. `playerRel` is the player's position relative to the
 * creature (x, eye height difference, z); `dt` is the frame time in seconds.
 */
export function animateMob(mob: Mob, parts: Parts, dt: number, playerRel: [number, number, number]): void {
  const a = mob.anim;
  const k = Math.min(1, dt * 8);
  const hs = Math.hypot(mob.body.vel[0], mob.body.vel[2]);
  a.speed = lerp(a.speed, hs, Math.min(1, dt * 10));
  // Head tracking: yaw from the mob's own logic, pitch toward the player when close.
  const dist = Math.hypot(playerRel[0], playerRel[2]);
  const targetPitch = dist < 10 ? clamp(Math.atan2(playerRel[1], dist), -0.6, 0.6) : 0;
  a.look = lerp(a.look, clamp(mob.headYaw, -1.1, 1.1), k);
  a.pitch = lerp(a.pitch, targetPitch, k * 0.6);
  a.graze = lerp(a.graze, mob.grazeTicks > 0 ? 1 : 0, Math.min(1, dt * 5));
  // Attack pulse: 1 the moment an attack starts, easing out over ~0.4 s.
  if (mob.attackCooldown > a.lastCd) a.attack = 1;
  a.lastCd = mob.attackCooldown;
  a.attack = Math.max(0, a.attack - dt * 2.5);
  // Occasional twitches and ear flicks.
  a.twitch = Math.max(0, a.twitch - dt * 6);
  if (Math.random() < dt * 0.4) a.twitch = Math.random() < 0.5 ? 1 : -1;
  if ((a.earTimer -= dt * 20) <= 0) { a.earTimer = 40 + Math.random() * 120; a.ear = 1; }
  a.ear = Math.max(0, a.ear - dt * 3);
  const idle = hs < 0.02;
  // Villagers wave at a nearby player, and otherwise fidget now and then.
  if (mob.spec.trader && idle && a.gesture <= 0) {
    if (dist < 5 && Math.random() < dt * 0.15) { a.gesture = 2.5; a.gestureKind = 0; }
    else if (Math.random() < dt * 0.05) { a.gesture = 2 + Math.random(); a.gestureKind = 1 + Math.floor(Math.random() * 2); }
  }
  a.gesture = Math.max(0, a.gesture - dt);
  // Turn smoothly instead of snapping, and lean into the turn.
  if (Number.isNaN(a.yaw)) a.yaw = mob.yaw;
  let dy = mob.yaw - a.yaw;
  dy = Math.atan2(Math.sin(dy), Math.cos(dy));
  a.yaw += dy * Math.min(1, dt * 9);
  a.lean = lerp(a.lean, clamp(-dy * 0.35, -0.18, 0.18) * clamp(hs * 8, 0, 1), Math.min(1, dt * 6));
  // Idle glances: when nothing holds its attention the head wanders.
  if ((a.glanceTimer -= dt) <= 0) { a.glanceTimer = 1.5 + Math.random() * 3.5; a.glanceTarget = Math.random() < 0.35 ? 0 : (Math.random() - 0.5) * 1.4; }
  a.glance = lerp(a.glance, idle && dist > 5 && mob.grazeTicks === 0 ? a.glanceTarget : 0, Math.min(1, dt * 3));
  // Blinks every few seconds.
  if ((a.blinkTimer -= dt) <= 0) { a.blinkTimer = 2 + Math.random() * 5; a.blink = 0.14; }
  a.blink = Math.max(0, a.blink - dt);
  // A little squash on landing.
  const air = !mob.body.onGround;
  if (a.wasAir && !air) a.land = 1;
  a.wasAir = air;
  a.land = Math.max(0, a.land - dt * 5);
  const c: Ctx = {
    mob, parts, a,
    t: mob.age / 20 + (a.seed % 7),
    phase: mob.walkAnim,
    amp: clamp(a.speed * 7, 0, 1),
    look: clamp(a.look + a.glance, -1.2, 1.2), pitch: a.pitch, idle,
  };
  const body = parts.body;
  body.position.set(0, 0, 0);
  body.rotation.set(0, 0, 0);
  const fn = ANIMATORS[mob.spec.kind];
  if (fn) fn(c);
  body.rotation.z += a.lean;
  const sq = Math.sin(a.land * Math.PI) * 0.1;
  body.scale.set(1 + sq * 0.5, 1 - sq, 1 + sq * 0.5);
  visible(parts.lids, a.blink > 0);
}
