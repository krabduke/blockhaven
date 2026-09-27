// Signs: the text editor and the floating text meshes in front of placed signs.

import * as THREE from 'three';
import { B } from '../blocks';
import type { Game } from '../game';

export class Signs {
  private meshes = new Map<string, { mesh: THREE.Mesh; text: string }>();
  private editor: HTMLElement | null = null;

  constructor(private g: Game) {}

  /** Remove every sign mesh (when the world is unloaded). */
  clear(): void {
    for (const v of this.meshes.values()) { v.mesh.removeFromParent(); v.mesh.geometry.dispose(); }
    this.meshes.clear();
  }

  /** Open the text editor for a sign. */
  edit(x: number, y: number, z: number): void {
    const w = this.g.world;
    if (!w || w.getBlock(x, y, z) !== B.sign) return;
    const be = w.getBlockEntity(x, y, z);
    if (!be || be.kind !== 'sign') return;
    document.exitPointerLock();
    if (!this.editor) {
      const el = document.createElement('div');
      el.className = 'screen dim';
      el.id = 'sign-editor';
      el.innerHTML = `<div class="panel title-menu stack"><h2>Edit sign</h2>${[0, 1, 2, 3].map((i) => `<input class="field" maxlength="18" aria-label="Line ${i + 1}" data-line="${i}">`).join('')}<button class="btn primary" type="button">Done</button></div>`;
      el.querySelectorAll('input').forEach((inp) => inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') (el.querySelector('button') as HTMLButtonElement).click(); }));
      this.g.root.appendChild(el);
      this.editor = el;
    }
    const el = this.editor;
    const inputs = [...el.querySelectorAll('input')] as HTMLInputElement[];
    inputs.forEach((inp, i) => { inp.value = be.lines[i] ?? ''; });
    const done = el.querySelector('button') as HTMLButtonElement;
    done.onclick = () => {
      be.lines = inputs.map((i) => i.value.slice(0, 18));
      const c = w.getChunk(x >> 4, z >> 4);
      if (c) c.modified = true;
      el.classList.remove('show');
      this.g.menus.current = null;
      this.g.input.lockPointer();
    };
    el.classList.add('show');
    this.g.menus.current = 'sign';
    setTimeout(() => inputs[0].focus(), 0);
  }

  /** Keep sign text meshes in step with sign block entities in loaded chunks. */
  sync(): void {
    const w = this.g.world;
    if (!w) return;
    const seen = new Set<string>();
    for (const [key, be] of w.blockEntities) {
      if (be.kind !== 'sign') continue;
      const [x, y, z] = key.split(',').map(Number);
      if (!w.isLoaded(x, z) || w.getBlock(x, y, z) !== B.sign) continue;
      seen.add(key);
      const text = be.lines.join('\n');
      const cur = this.meshes.get(key);
      if (cur && cur.text === text) continue;
      if (cur) { cur.mesh.removeFromParent(); cur.mesh.geometry.dispose(); }
      const mesh = this.g.renderer.signText(be.lines);
      const m = w.getMeta(x, y, z), f = m & 3, wall = (m & 4) !== 0;
      const n = [[0, 1], [-1, 0], [0, -1], [1, 0]][f]; // direction the text faces
      const off = wall ? -0.5 + 2 / 16 + 0.01 : 1 / 16 + 0.01;
      mesh.position.set(x + 0.5 + n[0] * off, y + (wall ? 0.5 : 0.78), z + 0.5 + n[1] * off);
      mesh.rotation.y = [0, -Math.PI / 2, Math.PI, Math.PI / 2][f];
      this.g.renderer.scene.add(mesh);
      this.meshes.set(key, { mesh, text });
    }
    for (const [key, v] of this.meshes) if (!seen.has(key)) { v.mesh.removeFromParent(); v.mesh.geometry.dispose(); this.meshes.delete(key); }
  }
}
