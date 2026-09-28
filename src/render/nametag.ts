// A floating name above a creature or another player: white text on a dark band, drawn on top
// of the world so you can find them.

import * as THREE from 'three';

export function nameTag(name: string): THREE.Sprite {
  const cv = document.createElement('canvas');
  const g = cv.getContext('2d')!;
  g.font = 'bold 28px system-ui, sans-serif';
  const w = Math.ceil(g.measureText(name).width) + 20;
  cv.width = w; cv.height = 40;
  g.font = 'bold 28px system-ui, sans-serif';
  g.fillStyle = 'rgba(0,0,0,0.45)';
  g.fillRect(0, 0, w, 40);
  g.fillStyle = '#fff';
  g.textBaseline = 'middle';
  g.fillText(name, 10, 21);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.set(w / 80, 0.5, 1);
  s.renderOrder = 10;
  return s;
}
