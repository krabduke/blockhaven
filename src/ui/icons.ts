// Item icons for the UI: blocks are drawn as small isometric cubes, items as
// their flat sprite. Cached as data URLs.

import { BLOCKS } from '../blocks';
import { itemDef } from '../items';
import type { Atlas } from '../textures';
import { tileIndex } from '../tiles';

const cache = new Map<number, string>();
let atlasRef: Atlas | null = null;

export function initIcons(atlas: Atlas): void {
  atlasRef = atlas;
  cache.clear();
}

function drawFace(g: CanvasRenderingContext2D, img: HTMLCanvasElement, u: [number, number], v: [number, number], o: [number, number], shade: number, sy = 0, sh = 16): void {
  g.save();
  g.setTransform(u[0], u[1], v[0], v[1], o[0], o[1]);
  g.drawImage(img, 0, sy, 16, sh, 0, 0, 16, sh);
  if (shade < 1) {
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = `rgba(0,0,0,${1 - shade})`;
    g.fillRect(0, 0, 16, sh);
  }
  g.restore();
}

export function iconURL(id: number): string {
  const hit = cache.get(id);
  if (hit) return hit;
  const atlas = atlasRef!;
  const def = itemDef(id);
  const cv = document.createElement('canvas');
  cv.width = cv.height = 32;
  const g = cv.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  if (!def) return '';
  if (id < 256 && !def.icon) {
    const b = BLOCKS[id];
    const tile = (f: number) => atlas.canvases[tileIndex(b.tiles[f])];
    const half = b.shape === 'slabBottom';
    // Each face is drawn on its own layer so shading doesn't bleed across faces.
    const layer = (fn: (lg: CanvasRenderingContext2D) => void) => {
      const lc = document.createElement('canvas');
      lc.width = lc.height = 32;
      const lg = lc.getContext('2d')!;
      lg.imageSmoothingEnabled = false;
      fn(lg);
      g.drawImage(lc, 0, 0);
    };
    const k = 15 / 16;
    const drop = half ? 7.5 : 0;
    layer((lg) => drawFace(lg, tile(2), [k, -0.4375], [k, 0.4375], [1, 8 + drop], 1));
    layer((lg) => drawFace(lg, tile(4), [k, 0.4375], [0, k], [1, 8 + drop], 0.8, half ? 8 : 0, half ? 8 : 16));
    layer((lg) => drawFace(lg, tile(0), [k, -0.4375], [0, k], [16, 15 + drop], 0.62, half ? 8 : 0, half ? 8 : 16));
  } else {
    g.drawImage(atlas.canvases[tileIndex(def.icon!)], 0, 0, 32, 32);
  }
  const url = cv.toDataURL();
  cache.set(id, url);
  return url;
}
