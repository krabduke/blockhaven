import * as THREE from 'three';
import { BLOCKS } from '../blocks';
import { itemDef } from '../items';
import { mulberry32 } from '../noise';
import type { Atlas } from '../textures';
import { tileIndex } from '../tiles';
import type { LayerMesh, SubMesh } from '../world/mesher';

const VERT = /* glsl */ `
in vec4 aPos;
in vec4 aUV;
in vec4 aLight;
in vec4 aTint;
uniform float uTime;
out vec3 vUV;
out vec2 vLight;
out float vBright;
out vec3 vTint;
out float vFogDepth;
void main() {
  vec3 p = aPos.xyz / 16.0;
  vec4 world = modelMatrix * vec4(p, 1.0);
  float flags = aUV.w;
  if (flags == 1.0) {
    world.x += sin(uTime * 1.7 + world.x * 0.7 + world.z * 0.3) * 0.045;
    world.z += cos(uTime * 1.4 + world.z * 0.6 + world.y * 0.2) * 0.045;
  }
  vec4 mv = viewMatrix * world;
  gl_Position = projectionMatrix * mv;
  vUV = vec3(aUV.x / 16.0, aUV.y / 16.0, aUV.z);
  if (flags == 2.0) vUV.xy += vec2(uTime * 0.015, uTime * 0.03);
  vLight = aLight.xy / 240.0;
  vBright = aLight.z / 255.0;
  vTint = aTint.rgb / 255.0;
  vFogDepth = length(mv.xyz);
}
`;

const FRAG = /* glsl */ `
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray uAtlas;
uniform float uSun;
uniform vec3 uSkyLightColor;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
uniform float uAlphaTest;
uniform float uOpacity;
uniform float uGamma;
in vec3 vUV;
in vec2 vLight;
in float vBright;
in vec3 vTint;
in float vFogDepth;
out vec4 outColor;
float curve(float f) {
  f = clamp(f, 0.0, 1.0);
  return mix(f / (3.0 - 2.0 * f), f, uGamma);
}
void main() {
  vec4 tex = texture(uAtlas, vUV);
  if (tex.a < uAlphaTest) discard;
  float sky = curve(vLight.x * uSun);
  float blk = curve(vLight.y);
  vec3 light = max(vec3(sky) * uSkyLightColor, vec3(blk) * vec3(1.0, 0.88, 0.7));
  light = max(light, vec3(0.035));
  vec3 col = tex.rgb * vTint * light * vBright;
  float fog = smoothstep(uFogNear, uFogFar, vFogDepth);
  outColor = vec4(mix(col, uFogColor, fog), tex.a * uOpacity);
}
`;

export interface SkyState {
  sun: number;
  skyColor: THREE.Color;
  fogColor: THREE.Color;
}

export class Renderer {
  readonly gl: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly terrain = new THREE.Group();
  readonly uniforms: Record<string, THREE.IUniform>;
  readonly materials: { opaque: THREE.ShaderMaterial; cutout: THREE.ShaderMaterial; translucent: THREE.ShaderMaterial };
  readonly atlasTexture: THREE.DataArrayTexture;
  private subMeshes = new Map<string, THREE.Mesh[]>();
  private chunkGroups = new Map<string, THREE.Group>();
  private sky: THREE.Group;
  private sun: THREE.Mesh;
  private moon: THREE.Mesh;
  private stars: THREE.Points;
  private clouds: THREE.Mesh;
  private highlight: THREE.LineSegments;
  private crack: THREE.Mesh;
  private crackTextures: THREE.Texture[] = [];
  readonly handScene = new THREE.Scene();
  readonly handCamera: THREE.PerspectiveCamera;
  private hand: THREE.Group;
  private handItem: THREE.Object3D | null = null;
  private handItemId = -1;
  private swing = 0;
  private bob = 0;
  renderDistance = 8;
  underwater = false;
  /** 0..1 rain strength, 0..1 thunder strength (smoothed). */
  rain = 0;
  thunder = 0;
  flash = 0;
  private rainLines: THREE.LineSegments;
  private rainDrops: { x: number; y: number; z: number; v: number; snow: boolean; on: boolean }[] = [];
  sky_state: SkyState = { sun: 1, skyColor: new THREE.Color(), fogColor: new THREE.Color() };

  constructor(canvas: HTMLCanvasElement, readonly atlas: Atlas) {
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.gl.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.gl.autoClear = false;
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.05, 1200);
    this.handCamera = new THREE.PerspectiveCamera(70, 1, 0.01, 10);
    this.scene.add(this.terrain);

    const tex = new THREE.DataArrayTexture(atlas.layers, 16, 16, atlas.count);
    tex.format = THREE.RGBAFormat;
    tex.type = THREE.UnsignedByteType;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.NoColorSpace;
    tex.needsUpdate = true;
    this.atlasTexture = tex;

    this.uniforms = {
      uAtlas: { value: tex },
      uTime: { value: 0 },
      uSun: { value: 1 },
      uSkyLightColor: { value: new THREE.Color(1, 1, 1) },
      uFogColor: { value: new THREE.Color(0.6, 0.75, 0.9) },
      uFogNear: { value: 80 },
      uFogFar: { value: 120 },
      uGamma: { value: 0.5 },
    };
    const mk = (alphaTest: number, opacity: number, transparent: boolean) => new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { ...this.uniforms, uAlphaTest: { value: alphaTest }, uOpacity: { value: opacity } },
      transparent,
      depthWrite: !transparent,
    });
    this.materials = { opaque: mk(0.0, 1, false), cutout: mk(0.5, 1, false), translucent: mk(0.02, 0.72, true) };

    this.sky = new THREE.Group();
    this.scene.add(this.sky);
    this.sun = this.makeCelestial(true);
    this.moon = this.makeCelestial(false);
    this.sky.add(this.sun, this.moon);
    this.stars = this.makeStars();
    this.sky.add(this.stars);
    this.clouds = this.makeClouds();
    this.scene.add(this.clouds);

    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004));
    this.highlight = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55 }));
    this.highlight.visible = false;
    this.scene.add(this.highlight);

    for (let i = 0; i < 10; i++) {
      const t = new THREE.CanvasTexture(atlas.canvases[tileIndex('destroy_' + i)]);
      t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.colorSpace = THREE.NoColorSpace;
      this.crackTextures.push(t);
    }
    this.crack = new THREE.Mesh(new THREE.BoxGeometry(1.006, 1.006, 1.006), new THREE.MeshBasicMaterial({ map: this.crackTextures[0], transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }));
    this.crack.visible = false;
    this.scene.add(this.crack);

    const RAIN = 1400;
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(RAIN * 6), 3));
    rg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(RAIN * 6), 3));
    this.rainLines = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false, fog: false }));
    this.rainLines.frustumCulled = false;
    this.rainLines.renderOrder = 3;
    this.scene.add(this.rainLines);
    for (let i = 0; i < RAIN; i++) this.rainDrops.push({ x: 0, y: -1000, z: 0, v: 0, snow: false, on: false });

    this.hand = new THREE.Group();
    this.handScene.add(this.hand);
    this.handScene.add(new THREE.AmbientLight(0xffffff, 1));
    this.setHeldItem(0);
  }

  private makeCelestial(sun: boolean): THREE.Mesh {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 32;
    const g = cv.getContext('2d')!;
    if (sun) {
      g.fillStyle = 'rgba(255,230,150,0.25)'; g.fillRect(0, 0, 32, 32);
      g.fillStyle = '#fff4c8'; g.fillRect(6, 6, 20, 20);
      g.fillStyle = '#ffffff'; g.fillRect(9, 9, 14, 14);
    } else {
      g.fillStyle = '#dfe6f0'; g.fillRect(8, 8, 16, 16);
      g.fillStyle = '#b7c0cf'; g.fillRect(11, 11, 4, 4); g.fillRect(18, 16, 3, 3); g.fillRect(13, 19, 2, 2);
    }
    const t = new THREE.CanvasTexture(cv);
    t.magFilter = THREE.NearestFilter;
    t.colorSpace = THREE.NoColorSpace;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(sun ? 70 : 50, sun ? 70 : 50), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, fog: false, blending: sun ? THREE.AdditiveBlending : THREE.NormalBlending }));
    m.renderOrder = -10;
    return m;
  }

  private makeStars(): THREE.Points {
    const rand = mulberry32(7);
    const n = 1400;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = rand() * 2 - 1, th = rand() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      pos.set([r * Math.cos(th) * 500, u * 500, r * Math.sin(th) * 500], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false }));
    pts.renderOrder = -11;
    return pts;
  }

  private makeClouds(): THREE.Mesh {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const g = cv.getContext('2d')!;
    const rand = mulberry32(42);
    for (let i = 0; i < 70; i++) {
      const w = 2 + Math.floor(rand() * 7), h = 2 + Math.floor(rand() * 5);
      g.fillStyle = 'rgba(255,255,255,0.85)';
      g.fillRect(Math.floor(rand() * 64), Math.floor(rand() * 64), w, h);
    }
    const t = new THREE.CanvasTexture(cv);
    t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(4, 4);
    t.colorSpace = THREE.NoColorSpace;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(3072, 3072), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false, opacity: 0.8 }));
    m.rotation.x = -Math.PI / 2;
    m.renderOrder = -5;
    return m;
  }

  resize(w: number, h: number): void {
    this.gl.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.handCamera.aspect = w / h;
    this.handCamera.updateProjectionMatrix();
  }

  // ---------- Terrain meshes ----------
  private chunkGroup(cx: number, cz: number): THREE.Group {
    const key = cx + ',' + cz;
    let g = this.chunkGroups.get(key);
    if (!g) {
      g = new THREE.Group();
      g.position.set(cx * 16, 0, cz * 16);
      g.userData = { cx, cz };
      this.chunkGroups.set(key, g);
      this.terrain.add(g);
    }
    return g;
  }

  setSubMesh(cx: number, sy: number, cz: number, mesh: SubMesh | null): void {
    const key = `${cx},${sy},${cz}`;
    const old = this.subMeshes.get(key);
    if (old) {
      for (const m of old) { m.removeFromParent(); m.geometry.dispose(); }
      this.subMeshes.delete(key);
    }
    if (!mesh) return;
    const g = this.chunkGroup(cx, cz);
    const list: THREE.Mesh[] = [];
    const add = (lm: LayerMesh | null, mat: THREE.Material, order: number) => {
      if (!lm) return;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('aPos', new THREE.BufferAttribute(lm.pos, 4));
      geo.setAttribute('aUV', new THREE.BufferAttribute(lm.uv, 4));
      geo.setAttribute('aLight', new THREE.BufferAttribute(lm.light, 4));
      geo.setAttribute('aTint', new THREE.BufferAttribute(lm.tint, 4));
      geo.setIndex(new THREE.BufferAttribute(lm.index, 1));
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(8, 8, 8), 14);
      const m = new THREE.Mesh(geo, mat);
      m.position.set(0, sy * 16, 0);
      m.renderOrder = order;
      m.matrixAutoUpdate = false;
      m.updateMatrix();
      g.add(m);
      list.push(m);
    };
    add(mesh.opaque, this.materials.opaque, 0);
    add(mesh.cutout, this.materials.cutout, 1);
    add(mesh.translucent, this.materials.translucent, 2);
    this.subMeshes.set(key, list);
  }

  removeChunk(cx: number, cz: number): void {
    for (let sy = 0; sy < 16; sy++) this.setSubMesh(cx, sy, cz, null);
    const key = cx + ',' + cz;
    const g = this.chunkGroups.get(key);
    if (g) { g.removeFromParent(); this.chunkGroups.delete(key); }
  }

  clearTerrain(): void {
    for (const key of [...this.chunkGroups.keys()]) {
      const [cx, cz] = key.split(',').map(Number);
      this.removeChunk(cx, cz);
    }
  }

  get meshCount(): number { return this.subMeshes.size; }

  // ---------- Per-frame ----------
  updateSky(time: number, camPos: THREE.Vector3): void {
    const theta = (time / 24000) * Math.PI * 2;
    const sy = Math.sin(theta);
    const sun = Math.min(1, Math.max(0.27, sy * 2.2 + 0.45)) * (1 - this.rain * 0.25 - this.thunder * 0.2) + this.flash * 0.6;
    const day = new THREE.Color(0x8ec3e6), night = new THREE.Color(0x070b1c), dusk = new THREE.Color(0xe8905a);
    const skyC = night.clone().lerp(day, Math.min(1, Math.max(0, sy * 2 + 0.3)));
    if (this.rain > 0) skyC.lerp(new THREE.Color(0x5f6670).multiplyScalar(Math.min(1, Math.max(0.15, sy * 2 + 0.3))), this.rain * 0.7);
    if (this.flash > 0) skyC.lerp(new THREE.Color(0xdde4ff), this.flash);
    const twilight = Math.max(0, 1 - Math.abs(sy) * 4) * (Math.cos(theta) > -2 ? 1 : 0);
    const fogC = skyC.clone().lerp(dusk, twilight * 0.55);
    if (this.underwater) {
      fogC.set(0x1f3d7a).multiplyScalar(Math.max(0.25, sun));
    }
    this.sky_state = { sun, skyColor: skyC, fogColor: fogC };
    this.uniforms.uSun.value = sun;
    const dayness = Math.min(1, Math.max(0, (sun - 0.27) / 0.73));
    (this.uniforms.uSkyLightColor.value as THREE.Color).setRGB(0.62 + 0.38 * dayness, 0.7 + 0.3 * dayness, 0.95 + 0.05 * dayness);
    (this.uniforms.uFogColor.value as THREE.Color).copy(fogC);
    const far = this.renderDistance * 16;
    this.uniforms.uFogNear.value = this.underwater ? 2 : far * (0.62 - this.rain * 0.3);
    this.uniforms.uFogFar.value = this.underwater ? 22 : far * (0.95 - this.rain * 0.2);
    this.gl.setClearColor(fogC.clone().lerp(skyC, 0.5));

    this.sky.position.copy(camPos);
    const d = 400;
    this.sun.position.set(Math.cos(theta) * d, Math.sin(theta) * d, 0);
    this.sun.lookAt(camPos);
    this.moon.position.set(-Math.cos(theta) * d, -Math.sin(theta) * d, 0);
    this.moon.lookAt(camPos);
    this.stars.rotation.z = theta;
    (this.stars.material as THREE.PointsMaterial).opacity = Math.max(0, Math.min(1, -sy * 3));
    this.clouds.position.set(Math.floor(camPos.x / 64) * 64, 192.5, Math.floor(camPos.z / 64) * 64);
    const ct = (this.clouds.material as THREE.MeshBasicMaterial);
    const cl = Math.max(0.12, Math.min(1, sy * 2 + 0.35));
    ct.color.setRGB(cl, cl, cl * 1.05);
    ct.opacity = 0.55 + 0.25 * cl;
    ct.map!.offset.set((this.uniforms.uTime.value * 0.0004 + camPos.x / 768 * 0) % 1, 0);
  }

  /**
   * Rain and snow around the camera. `exposed(x, y, z)` says whether a spot is under open sky,
   * `cold(x, z)` whether precipitation falls as snow there.
   */
  updateWeather(dt: number, cam: THREE.Vector3, exposed: (x: number, y: number, z: number) => boolean, cold: (x: number, z: number) => boolean): void {
    const pos = this.rainLines.geometry.getAttribute('position') as THREE.BufferAttribute;
    const col = this.rainLines.geometry.getAttribute('color') as THREE.BufferAttribute;
    const active = Math.floor(this.rainDrops.length * this.rain);
    const l = Math.max(0.25, this.uniforms.uSun.value as number);
    for (let i = 0; i < this.rainDrops.length; i++) {
      const d = this.rainDrops[i];
      if (i >= active) { pos.setXYZ(i * 2, 0, -1000, 0); pos.setXYZ(i * 2 + 1, 0, -1000, 0); continue; }
      d.y -= d.v * dt;
      const far = Math.abs(d.x - cam.x) > 22 || Math.abs(d.z - cam.z) > 22;
      if (d.y < cam.y - 12 || far || !d.on) {
        const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 20;
        d.x = cam.x + Math.cos(a) * r;
        d.z = cam.z + Math.sin(a) * r;
        d.y = cam.y + 4 + Math.random() * 14;
        d.snow = cold(d.x, d.z);
        d.v = d.snow ? 2 + Math.random() : 18 + Math.random() * 6;
        d.on = true;
      }
      const visible = exposed(Math.floor(d.x), Math.floor(d.y), Math.floor(d.z));
      const len = d.snow ? 0.08 : 0.6;
      const wob = d.snow ? Math.sin(d.y * 2 + i) * 0.05 : 0;
      if (!visible) { pos.setXYZ(i * 2, 0, -1000, 0); pos.setXYZ(i * 2 + 1, 0, -1000, 0); continue; }
      pos.setXYZ(i * 2, d.x + wob, d.y, d.z);
      pos.setXYZ(i * 2 + 1, d.x + wob + (d.snow ? 0.06 : 0), d.y + len, d.z);
      const c = d.snow ? [l, l, l] : [0.55 * l, 0.65 * l, 0.85 * l];
      col.setXYZ(i * 2, c[0], c[1], c[2]);
      col.setXYZ(i * 2 + 1, c[0], c[1], c[2]);
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    this.flash = Math.max(0, this.flash - dt * 3);
  }

  setHighlight(pos: [number, number, number] | null, shape?: { min: number[]; max: number[] }): void {
    if (!pos) { this.highlight.visible = false; return; }
    this.highlight.visible = true;
    const min = shape?.min ?? [0, 0, 0], max = shape?.max ?? [1, 1, 1];
    this.highlight.scale.set(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
    this.highlight.position.set(pos[0] + (min[0] + max[0]) / 2, pos[1] + (min[1] + max[1]) / 2, pos[2] + (min[2] + max[2]) / 2);
  }

  setCrack(pos: [number, number, number] | null, progress: number): void {
    if (!pos || progress <= 0) { this.crack.visible = false; return; }
    this.crack.visible = true;
    this.crack.position.set(pos[0] + 0.5, pos[1] + 0.5, pos[2] + 0.5);
    (this.crack.material as THREE.MeshBasicMaterial).map = this.crackTextures[Math.min(9, Math.floor(progress * 10))];
  }

  // ---------- First-person hand ----------
  setHeldItem(id: number): void {
    if (id === this.handItemId) return;
    this.handItemId = id;
    if (this.handItem) { this.hand.remove(this.handItem); }
    const pulledBow = id === -2;
    const def = itemDef(pulledBow ? 283 : id);
    let obj: THREE.Object3D;
    if (!def || id === 0) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.7), new THREE.MeshBasicMaterial({ color: 0xc89a78 }));
      arm.position.set(0.42, -0.42, -0.55);
      arm.rotation.set(0.25, -0.35, 0.15);
      obj = arm;
    } else if (id < 256 && !def.icon) {
      obj = this.blockModel(id, 0.24);
      obj.position.set(0.4, -0.34, -0.6);
      obj.rotation.set(0.1, 0.8, 0);
    } else {
      const m = this.itemModel(pulledBow ? 'bow_pull' : def.icon!, 0.36);
      m.position.set(0.4, -0.28, -0.6);
      m.rotation.set(0.05, -1.25, 0.2);
      obj = m;
    }
    this.handItem = obj;
    this.hand.add(obj);
  }

  private extrudeCache = new Map<string, THREE.BufferGeometry>();

  /** A flat item sprite extruded into a thin slab of pixels (held and dropped items). */
  itemModel(tile: string, size: number): THREE.Mesh {
    let geo = this.extrudeCache.get(tile);
    if (!geo) {
      const cv = this.atlas.canvases[tileIndex(tile)];
      const d = cv.getContext('2d')!.getImageData(0, 0, 16, 16).data;
      const pos: number[] = [], col: number[] = [];
      const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < 16 && y < 16 && d[(x + y * 16) * 4 + 3] > 127;
      const quad = (pts: number[][], c: number[], shade: number) => {
        for (const k of [0, 1, 2, 0, 2, 3]) { pos.push(...pts[k]); col.push(c[0] * shade, c[1] * shade, c[2] * shade); }
      };
      const t = 1 / 32;
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        if (!solid(x, y)) continue;
        const i = (x + y * 16) * 4;
        const c = [d[i] / 255, d[i + 1] / 255, d[i + 2] / 255];
        const x0 = x / 16 - 0.5, x1 = (x + 1) / 16 - 0.5, y0 = 0.5 - (y + 1) / 16, y1 = 0.5 - y / 16;
        quad([[x0, y0, t], [x1, y0, t], [x1, y1, t], [x0, y1, t]], c, 1);
        quad([[x1, y0, -t], [x0, y0, -t], [x0, y1, -t], [x1, y1, -t]], c, 0.8);
        if (!solid(x - 1, y)) quad([[x0, y0, -t], [x0, y0, t], [x0, y1, t], [x0, y1, -t]], c, 0.65);
        if (!solid(x + 1, y)) quad([[x1, y0, t], [x1, y0, -t], [x1, y1, -t], [x1, y1, t]], c, 0.65);
        if (!solid(x, y - 1)) quad([[x0, y1, t], [x1, y1, t], [x1, y1, -t], [x0, y1, -t]], c, 0.9);
        if (!solid(x, y + 1)) quad([[x0, y0, -t], [x1, y0, -t], [x1, y0, t], [x0, y0, t]], c, 0.55);
      }
      geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      this.extrudeCache.set(tile, geo);
    }
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true }));
    m.scale.setScalar(size);
    return m;
  }

  /** A small textured cube for a block (held item / dropped item). */
  blockModel(id: number, size: number): THREE.Mesh {
    const def = BLOCKS[id];
    const order = [0, 1, 2, 3, 4, 5]; // BoxGeometry face order: +x -x +y -y +z -z
    const mats = order.map((f) => {
      const cv = this.atlas.canvases[tileIndex(def.tiles[f])];
      const t = new THREE.CanvasTexture(cv);
      t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.colorSpace = THREE.NoColorSpace;
      const shade = [0.6, 0.6, 1, 0.5, 0.8, 0.8][f];
      return new THREE.MeshBasicMaterial({ map: t, color: new THREE.Color(shade, shade, shade), transparent: def.layer !== 'opaque', alphaTest: 0.1 });
    });
    return new THREE.Mesh(new THREE.BoxGeometry(size, size, size), mats);
  }

  swingHand(): void {
    this.swing = 1;
  }

  renderFrame(dt: number, moving: boolean, handBrightness: number, showHand: boolean): void {
    this.uniforms.uTime.value += dt;
    if (moving) this.bob += dt * 9; else this.bob *= 0.9;
    this.swing = Math.max(0, this.swing - dt * 4);
    const s = Math.sin(this.swing * Math.PI);
    this.hand.position.set(Math.sin(this.bob) * 0.02 - s * 0.12, -Math.abs(Math.cos(this.bob)) * 0.02 - s * 0.1, -s * 0.1);
    this.hand.rotation.set(-s * 0.9, s * 0.3, 0);
    this.hand.traverse((o) => {
      const mat = (o as THREE.Mesh).material as THREE.MeshBasicMaterial | THREE.MeshBasicMaterial[] | undefined;
      if (!mat) return;
      for (const m of Array.isArray(mat) ? mat : [mat]) {
        if (!m.userData.base) m.userData.base = m.color.clone();
        m.color.copy(m.userData.base).multiplyScalar(handBrightness);
      }
    });
    this.gl.clear();
    this.gl.render(this.scene, this.camera);
    if (showHand) {
      this.gl.clearDepth();
      this.gl.render(this.handScene, this.handCamera);
    }
  }
}
