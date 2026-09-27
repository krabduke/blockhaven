// Renders the app icons (PNG) with a canvas in Chromium: an isometric grassy
// block with a lantern glow. Run once after changing the design:
//   node scripts/make-icons.mjs
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const b = await chromium.launch();
const p = await b.newPage();
const draw = async (size, maskable) => p.evaluate(({ size, maskable }) => {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');
  // Background: deep loam with a soft lantern glow.
  const bg = g.createRadialGradient(size * 0.5, size * 0.42, size * 0.05, size * 0.5, size * 0.5, size * 0.75);
  bg.addColorStop(0, '#5a4028'); bg.addColorStop(1, '#1f1711');
  g.fillStyle = bg;
  if (maskable) g.fillRect(0, 0, size, size);
  else { const r = size * 0.2; g.beginPath(); g.roundRect(0, 0, size, size, r); g.fill(); }
  // Isometric block, drawn on a 16-pixel grid so it stays crisp and blocky.
  const s = size * (maskable ? 0.5 : 0.62), cx = size / 2, top = size * (maskable ? 0.27 : 0.2);
  const u = s / 16;
  const face = (pts, fill) => { g.beginPath(); g.moveTo(...pts[0]); for (const q of pts.slice(1)) g.lineTo(...q); g.closePath(); g.fillStyle = fill; g.fill(); };
  const A = [cx, top], Bp = [cx + s / 2, top + s / 4], C = [cx, top + s / 2], D = [cx - s / 2, top + s / 4];
  const h = s * 0.55;
  face([D, C, [C[0], C[1] + h], [D[0], D[1] + h]], '#7a5232');          // left side (earth)
  face([C, Bp, [Bp[0], Bp[1] + h], [C[0], C[1] + h]], '#5e3e25');       // right side (earth, darker)
  face([A, Bp, C, D], '#6fa045');                                       // top (grass)
  // Grass lip hanging over the sides, and a few pebbles.
  face([D, C, [C[0], C[1] + u * 3], [D[0], D[1] + u * 2]], '#5a8a36');
  face([C, Bp, [Bp[0], Bp[1] + u * 2], [C[0], C[1] + u * 3]], '#4a7a2c');
  g.fillStyle = '#8fc05a';
  for (const [x, y] of [[-3, 2.2], [2, 1.3], [0.5, 3.1], [-1.5, 0.8], [3.5, 2.6]]) g.fillRect(cx + x * u * 1.4, top + y * u * 1.6 + s * 0.06, u * 1.2, u * 0.6);
  g.fillStyle = '#4a3020';
  for (const [x, y] of [[-5, 8], [-2, 11], [3, 9], [5.5, 6]]) g.fillRect(cx + x * u, top + s / 4 + y * u * 0.9, u * 1.2, u * 1.2);
  // A small lantern on top, glowing.
  const lx = cx + u * 1.5, ly = top + s * 0.14;
  const glow = g.createRadialGradient(lx, ly, 0, lx, ly, s * 0.32);
  glow.addColorStop(0, 'rgba(255,200,90,0.75)'); glow.addColorStop(1, 'rgba(255,200,90,0)');
  g.fillStyle = glow; g.beginPath(); g.arc(lx, ly, s * 0.32, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#2a1e16'; g.fillRect(lx - u * 1.6, ly - u * 2.6, u * 3.2, u * 0.8); g.fillRect(lx - u * 1.6, ly + u * 1.6, u * 3.2, u * 0.8);
  g.fillStyle = '#f2b544'; g.fillRect(lx - u * 1.2, ly - u * 1.8, u * 2.4, u * 3.4);
  g.fillStyle = '#fff0b0'; g.fillRect(lx - u * 0.5, ly - u * 1.0, u * 1.0, u * 1.6);
  return cv.toDataURL('image/png').split(',')[1];
}, { size, maskable });
for (const [name, size, mask] of [['icon-192', 192, false], ['icon-512', 512, false], ['maskable-512', 512, true], ['apple-touch-icon', 180, true], ['favicon-32', 32, false]]) {
  writeFileSync(`public/icons/${name}.png`, Buffer.from(await draw(size, mask), 'base64'));
  console.log('wrote', name);
}
await b.close();
