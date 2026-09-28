// Gliding with the Colossus's glider, worn in the chest slot. Jump while falling to spread it;
// look down to dive and build speed, look up to trade that speed for height. Flying into a
// wall fast hurts, and so does slamming into the ground in a steep dive. The glider wears a
// little for every second in the air.

import { I, maxDurability, type ItemStack } from '../items';
import { moveBody } from '../physics';
import type { Player } from '../player';
import type { World } from '../world/world';

/** The worn glider, if it still has some life in it. */
export function wornGlider(p: Player): ItemStack | null {
  const s = p.armor.slots[1];
  if (!s || s.id !== I.glider) return null;
  return (s.damage ?? 0) < maxDurability(I.glider) - 1 ? s : null;
}

/** One tick of gliding. Returns damage from a crash (0 if none). */
export function glideStep(w: World, p: Player): number {
  const b = p.body, v = b.vel;
  const cp = Math.cos(p.pitch), sp = Math.sin(p.pitch);
  const look = [-Math.sin(p.yaw) * cp, sp, -Math.cos(p.yaw) * cp];
  const lookH = Math.abs(cp);
  const lift = cp * cp;
  const hs = Math.hypot(v[0], v[2]);
  v[1] += -0.08 + lift * 0.06;
  // Falling while level turns into forward speed.
  if (v[1] < 0 && lookH > 0) {
    const k = v[1] * -0.1 * lift;
    v[1] += k; v[0] += (look[0] / lookH) * k; v[2] += (look[2] / lookH) * k;
  }
  // Pulling up turns forward speed into climb.
  if (p.pitch > 0 && lookH > 0) {
    const k = hs * sp * 0.04;
    v[1] += k * 3.2; v[0] -= (look[0] / lookH) * k; v[2] -= (look[2] / lookH) * k;
  }
  // Steer: the horizontal velocity swings round toward where you look.
  if (lookH > 0) {
    v[0] += ((look[0] / lookH) * hs - v[0]) * 0.1;
    v[2] += ((look[2] / lookH) * hs - v[2]) * 0.1;
  }
  v[0] *= 0.99; v[1] *= 0.98; v[2] *= 0.99;
  const before = Math.hypot(v[0], v[2]), fallSpeed = -v[1];
  moveBody(w, b, v[0], v[1], v[2], 0, false);
  b.fallDistance = 0;
  let crash = 0;
  if (b.collidedH) crash = Math.max(crash, Math.floor((before - Math.hypot(v[0], v[2])) * 10 - 3));
  if (b.onGround) crash = Math.max(crash, Math.floor((fallSpeed - 0.6) * 10));
  return Math.max(0, crash);
}
