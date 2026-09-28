// What a held instrument shows: a compass dial pointing home, a clock with the sun and moon and
// the time of day, or a paper map with your position (and an X on a treasure map). Drawn in the
// top-left corner, a few times a second, only while you hold one.

import { I } from '../items';
import { MAP_SIZE, type PaperMap } from '../game/maps';
import type { Game } from '../game';

const DIAL = 76;
const MAP_PX = 2;

export class Instruments {
  private root: HTMLElement;
  private dial: HTMLCanvasElement;
  private label: HTMLElement;
  private mapCv: HTMLCanvasElement;
  private timer = 0;
  private spin = 0;
  private showing = '';

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'instruments';
    this.dial = Object.assign(document.createElement('canvas'), { width: DIAL, height: DIAL });
    this.dial.className = 'dial';
    this.mapCv = Object.assign(document.createElement('canvas'), { width: MAP_SIZE * MAP_PX + 16, height: MAP_SIZE * MAP_PX + 16 });
    this.mapCv.className = 'paper';
    this.label = document.createElement('div');
    this.label.className = 'inst-label';
    this.root.append(this.dial, this.mapCv, this.label);
    parent.appendChild(this.root);
  }

  update(g: Game, dt: number): void {
    const p = g.player, w = g.world;
    const held = p.held;
    const kind = !w || g.mode !== 'playing' || g.hudHidden || !p.alive ? '' : held?.id === I.compass ? 'compass' : held?.id === I.clock ? 'clock' : held?.id === I.filled_map || held?.id === I.treasure_map ? 'map' : '';
    if (kind !== this.showing) {
      this.showing = kind;
      this.root.className = kind ? `show ${kind}` : '';
      this.timer = 0;
    }
    if (!kind || !w) return;
    this.spin += dt;
    if ((this.timer -= dt) > 0) return;
    this.timer = kind === 'map' ? 0.2 : 0.05;
    if (kind === 'compass') this.drawCompass(g);
    else if (kind === 'clock') this.drawClock(g);
    else this.drawMap(g, g.maps.get(held?.map));
  }

  private face(ctx: CanvasRenderingContext2D, rim: string, fill: string): void {
    const r = DIAL / 2;
    ctx.clearRect(0, 0, DIAL, DIAL);
    ctx.fillStyle = rim;
    ctx.beginPath(); ctx.arc(r, r, r - 1, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = fill;
    ctx.beginPath(); ctx.arc(r, r, r - 6, 0, Math.PI * 2); ctx.fill();
  }

  private drawCompass(g: Game): void {
    const ctx = this.dial.getContext('2d')!, p = g.player, r = DIAL / 2;
    this.face(ctx, '#5a5e62', '#e8e0c8');
    let a: number;
    if (g.world!.dimension !== 'overworld') a = this.spin * 7 + Math.sin(this.spin * 3.1) * 2;
    else {
      // Bearing to your spawn point, relative to where you face.
      const dx = p.spawn[0] - p.body.pos[0], dz = p.spawn[2] - p.body.pos[2];
      const right = dx * Math.cos(p.yaw) - dz * Math.sin(p.yaw), fwd = -dx * Math.sin(p.yaw) - dz * Math.cos(p.yaw);
      a = Math.atan2(right, fwd);
    }
    ctx.save();
    ctx.translate(r, r);
    ctx.rotate(a);
    ctx.fillStyle = '#c83a2a';
    ctx.beginPath(); ctx.moveTo(0, -r + 11); ctx.lineTo(5, 0); ctx.lineTo(-5, 0); ctx.fill();
    ctx.fillStyle = '#3a4a6a';
    ctx.beginPath(); ctx.moveTo(0, r - 11); ctx.lineTo(5, 0); ctx.lineTo(-5, 0); ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#2a2a2a';
    ctx.beginPath(); ctx.arc(r, r, 3, 0, Math.PI * 2); ctx.fill();
    const d = Math.round(Math.hypot(p.spawn[0] - p.body.pos[0], p.spawn[2] - p.body.pos[2]));
    this.label.textContent = g.world!.dimension === 'overworld' ? (d < 4 ? 'Home' : `Home: ${d} blocks`) : 'The needle spins';
  }

  private drawClock(g: Game): void {
    const ctx = this.dial.getContext('2d')!, w = g.world!, r = DIAL / 2;
    this.face(ctx, '#d8a830', '#1a2250');
    // A disc, day on top, night below, that turns with the time: the sun rises on the left.
    const t = w.time / 24000;
    ctx.save();
    ctx.beginPath(); ctx.arc(r, r, r - 6, 0, Math.PI * 2); ctx.clip();
    ctx.translate(r, r);
    ctx.rotate(-t * Math.PI * 2);
    ctx.fillStyle = '#6ab0e8';
    ctx.fillRect(-r, -r, DIAL, r);
    ctx.fillStyle = '#f8e060';
    ctx.beginPath(); ctx.arc(-r + 16, -4, 7, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#e8e8ff';
    ctx.beginPath(); ctx.arc(r - 16, 4, 6, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    // The pointer stays at the top.
    ctx.fillStyle = '#3a2a10';
    ctx.beginPath(); ctx.moveTo(r, 4); ctx.lineTo(r + 5, 13); ctx.lineTo(r - 5, 13); ctx.fill();
    if (w.dimension !== 'overworld') { this.label.textContent = 'Time means little here'; return; }
    const hours = (w.time / 1000 + 6) % 24, h = Math.floor(hours), m = Math.floor((hours - h) * 60 / 15) * 15;
    const hh = ((h + 11) % 12) + 1, ampm = h < 12 ? 'am' : 'pm';
    this.label.textContent = `Day ${w.day + 1}, ${hh}:${String(m).padStart(2, '0')} ${ampm}`;
  }

  private drawMap(g: Game, m: PaperMap | undefined): void {
    const ctx = this.mapCv.getContext('2d')!, W = this.mapCv.width, p = g.player;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#8a6a3a';
    ctx.fillRect(0, 0, W, W);
    ctx.fillStyle = '#c8b484';
    ctx.fillRect(4, 4, W - 8, W - 8);
    if (!m) { this.label.textContent = 'Use it to start drawing'; return; }
    ctx.drawImage(m.canvas, 8, 8, MAP_SIZE * MAP_PX, MAP_SIZE * MAP_PX);
    const toPx = (x: number, z: number) => [8 + (x - m.x0) * MAP_PX, 8 + (z - m.z0) * MAP_PX];
    if (m.target) {
      const [tx, ty] = toPx(m.target[0], m.target[1]);
      ctx.strokeStyle = '#b8201a'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(tx - 6, ty - 6); ctx.lineTo(tx + 6, ty + 6); ctx.moveTo(tx + 6, ty - 6); ctx.lineTo(tx - 6, ty + 6); ctx.stroke();
    }
    // You: an arrow inside the map, a dot on the edge when you're off it.
    let [px, py] = toPx(p.body.pos[0], p.body.pos[2]);
    const inside = px >= 8 && px <= W - 8 && py >= 8 && py <= W - 8;
    px = Math.max(10, Math.min(W - 10, px)); py = Math.max(10, Math.min(W - 10, py));
    ctx.save();
    ctx.translate(px, py);
    if (inside) {
      ctx.rotate(-p.yaw);
      ctx.fillStyle = '#fff'; ctx.strokeStyle = '#1a1410'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(6, 6); ctx.lineTo(0, 3); ctx.lineTo(-6, 6); ctx.closePath(); ctx.fill(); ctx.stroke();
    } else {
      ctx.fillStyle = '#fff'; ctx.strokeStyle = '#1a1410';
      ctx.beginPath(); ctx.arc(0, 0, 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    ctx.restore();
    this.label.textContent = m.target ? 'Treasure map: dig where the X is' : inside ? `Map of ${m.x0}, ${m.z0}` : 'You’re off the edge of this map';
  }
}
