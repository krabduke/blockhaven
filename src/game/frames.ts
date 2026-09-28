// The item shown in each item frame: a flat picture of its icon on the frame's face, kept in
// step with the frames' block entities in loaded chunks (like sign text).

import * as THREE from 'three';
import { B } from '../blocks';
import { iconURL } from '../ui/icons';
import type { Game } from '../game';

export class FrameItems {
  private meshes = new Map<string, { mesh: THREE.Mesh; id: number }>();
  private textures = new Map<number, THREE.Texture>();
  private geo = new THREE.PlaneGeometry(0.62, 0.62);

  constructor(private g: Game) {}

  private texture(id: number): THREE.Texture {
    let t = this.textures.get(id);
    if (!t) {
      t = new THREE.TextureLoader().load(iconURL(id));
      t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace;
      this.textures.set(id, t);
    }
    return t;
  }

  sync(): void {
    const w = this.g.world;
    if (!w) return;
    const seen = new Set<string>();
    for (const [key, be] of w.blockEntities) {
      if (be.kind !== 'frame') continue;
      const [x, y, z] = key.split(',').map(Number);
      const item = be.inv.slots[0];
      if (!item || !w.isLoaded(x, z) || w.getBlock(x, y, z) !== B.item_frame) continue;
      seen.add(key);
      const cur = this.meshes.get(key);
      if (cur && cur.id === item.id) continue;
      if (cur) cur.mesh.removeFromParent();
      const mesh = new THREE.Mesh(this.geo, new THREE.MeshBasicMaterial({ map: this.texture(item.id), alphaTest: 0.5, side: THREE.DoubleSide }));
      const f = w.getMeta(x, y, z) & 3;
      const n = [[0, 1], [-1, 0], [0, -1], [1, 0]][f];
      const off = -0.5 + 1 / 16 + 0.012;
      mesh.position.set(x + 0.5 + n[0] * off, y + 0.5, z + 0.5 + n[1] * off);
      mesh.rotation.y = [0, -Math.PI / 2, Math.PI, Math.PI / 2][f];
      this.g.renderer.scene.add(mesh);
      this.meshes.set(key, { mesh, id: item.id });
    }
    for (const [key, v] of this.meshes) if (!seen.has(key)) { v.mesh.removeFromParent(); (v.mesh.material as THREE.Material).dispose(); this.meshes.delete(key); }
  }

  clear(): void {
    for (const v of this.meshes.values()) { v.mesh.removeFromParent(); (v.mesh.material as THREE.Material).dispose(); }
    this.meshes.clear();
  }
}
