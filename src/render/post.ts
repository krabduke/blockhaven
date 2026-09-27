// Post-processing for the "Ultra" look: the scene renders into an HDR
// buffer, then gets bloom (bright and glowing things bleed light), god rays
// (a radial blur of the sky toward the sun, so light shafts through trees and
// clouds), a filmic tone curve, gentle grading and a vignette.

import * as THREE from 'three';

const QUAD_VERT = /* glsl */ `
out vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const BRIGHT_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tScene;
uniform float uThreshold;
in vec2 vUv;
out vec4 o;
void main() {
  vec3 c = texture(tScene, vUv).rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  // Soft knee so bloom fades in rather than switching on.
  float k = smoothstep(uThreshold - 0.25, uThreshold + 0.35, l);
  o = vec4(c * k, 1.0);
}
`;

const BLUR_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tInput;
uniform vec2 uDir;
in vec2 vUv;
out vec4 o;
void main() {
  // 9-tap gaussian along one axis.
  vec3 s = texture(tInput, vUv).rgb * 0.227;
  s += texture(tInput, vUv + uDir * 1.385).rgb * 0.316;
  s += texture(tInput, vUv - uDir * 1.385).rgb * 0.316;
  s += texture(tInput, vUv + uDir * 3.231).rgb * 0.070;
  s += texture(tInput, vUv - uDir * 3.231).rgb * 0.070;
  o = vec4(s, 1.0);
}
`;

const RAYS_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tDepth;
uniform sampler2D tScene;
uniform vec2 uSun;
in vec2 vUv;
out vec4 o;
void main() {
  // March from this pixel toward the sun, collecting unobstructed sky.
  vec2 delta = (uSun - vUv) / 40.0;
  vec2 uv = vUv;
  float illum = 0.0, decay = 1.0;
  for (int i = 0; i < 40; i++) {
    uv += delta;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) break;
    float sky = texture(tDepth, uv).r > 0.99995 ? 1.0 : 0.0;
    vec3 c = texture(tScene, uv).rgb;
    illum += sky * decay * (0.4 + dot(c, vec3(0.33)));
    decay *= 0.965;
  }
  o = vec4(vec3(illum / 40.0), 1.0);
}
`;

const COMPOSITE_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform sampler2D tRays;
uniform vec3 uSunColor;
uniform float uRays;
uniform float uBloom;
uniform float uExposure;
uniform float uUnderwater;
uniform float uTime;
uniform float uVignette;
uniform float uSat;
in vec2 vUv;
out vec4 o;

vec3 shoulder(vec3 x) {
  // Leave the midtones alone and roll bright values off smoothly instead of clipping.
  vec3 k = vec3(0.72);
  vec3 over = max(x - k, 0.0);
  return min(x, k) + (1.0 - k) * (1.0 - exp(-over / (1.0 - k)));
}

void main() {
  vec2 uv = vUv;
  if (uUnderwater > 0.5) uv += vec2(sin(uv.y * 30.0 + uTime * 2.0), cos(uv.x * 26.0 + uTime * 1.7)) * 0.0025;
  vec3 c = texture(tScene, uv).rgb;
  c += texture(tBloom, uv).rgb * uBloom;
  c += texture(tRays, uv).r * uSunColor * uRays;
  c *= uExposure;
  c = shoulder(c);
  // A touch more contrast and saturation, like a camera's picture profile.
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, uSat);
  c = mix(c, c * c * (3.0 - 2.0 * c), 0.12);
  if (uUnderwater > 0.5) c = mix(c, c * vec3(0.55, 0.8, 1.1), 0.6);
  float d = distance(vUv, vec2(0.5));
  c *= 1.0 - smoothstep(0.45, 0.95, d) * uVignette;
  o = vec4(c, 1.0);
}
`;

function quadMaterial(frag: string, uniforms: Record<string, THREE.IUniform>): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: QUAD_VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false });
}

export interface PostParams {
  sunScreen: THREE.Vector2 | null;
  sunColor: THREE.Color;
  rays: number;
  bloom: number;
  exposure: number;
  saturation?: number;
  underwater: boolean;
  time: number;
}

export class PostFX {
  readonly scene: THREE.WebGLRenderTarget;
  private bright: THREE.WebGLRenderTarget;
  private blurA: THREE.WebGLRenderTarget;
  private blurB: THREE.WebGLRenderTarget;
  private rays: THREE.WebGLRenderTarget;
  private quad: THREE.Mesh;
  private quadScene = new THREE.Scene();
  private quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private brightMat: THREE.ShaderMaterial;
  private blurMat: THREE.ShaderMaterial;
  private raysMat: THREE.ShaderMaterial;
  private compMat: THREE.ShaderMaterial;

  constructor(private gl: THREE.WebGLRenderer) {
    const hdr = { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false } as const;
    this.scene = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: true });
    this.scene.depthTexture = new THREE.DepthTexture(1, 1);
    this.scene.depthTexture.type = THREE.UnsignedIntType;
    this.bright = new THREE.WebGLRenderTarget(1, 1, hdr);
    this.blurA = new THREE.WebGLRenderTarget(1, 1, hdr);
    this.blurB = new THREE.WebGLRenderTarget(1, 1, hdr);
    this.rays = new THREE.WebGLRenderTarget(1, 1, hdr);
    for (const t of [this.bright, this.blurA, this.blurB, this.rays]) { t.texture.minFilter = THREE.LinearFilter; t.texture.magFilter = THREE.LinearFilter; }
    this.brightMat = quadMaterial(BRIGHT_FRAG, { tScene: { value: this.scene.texture }, uThreshold: { value: 1.12 } });
    this.blurMat = quadMaterial(BLUR_FRAG, { tInput: { value: null }, uDir: { value: new THREE.Vector2() } });
    this.raysMat = quadMaterial(RAYS_FRAG, { tDepth: { value: this.scene.depthTexture }, tScene: { value: this.scene.texture }, uSun: { value: new THREE.Vector2() } });
    this.compMat = quadMaterial(COMPOSITE_FRAG, {
      tScene: { value: this.scene.texture }, tBloom: { value: this.blurB.texture }, tRays: { value: this.rays.texture },
      uSunColor: { value: new THREE.Color() }, uRays: { value: 0 }, uBloom: { value: 0.6 }, uExposure: { value: 1 },
      uUnderwater: { value: 0 }, uTime: { value: 0 }, uVignette: { value: 0.35 }, uSat: { value: 1.04 },
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.compMat);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
  }

  setSize(w: number, h: number): void {
    this.scene.setSize(w, h);
    const bw = Math.max(1, Math.floor(w / 4)), bh = Math.max(1, Math.floor(h / 4));
    this.bright.setSize(bw, bh);
    this.blurA.setSize(bw, bh);
    this.blurB.setSize(bw, bh);
    this.rays.setSize(Math.max(1, Math.floor(w / 2)), Math.max(1, Math.floor(h / 2)));
  }

  private pass(mat: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null): void {
    this.quad.material = mat;
    this.gl.setRenderTarget(target);
    this.gl.render(this.quadScene, this.quadCam);
  }

  /** Run all passes on `this.scene` and draw the result to the screen. */
  finish(p: PostParams): void {
    // Bloom: bright pass, then two rounds of separable blur at quarter resolution.
    this.pass(this.brightMat, this.bright);
    const bw = this.bright.width, bh = this.bright.height;
    let src = this.bright;
    for (let i = 0; i < 2; i++) {
      this.blurMat.uniforms.tInput.value = src.texture;
      this.blurMat.uniforms.uDir.value.set((1 + i) / bw, 0);
      this.pass(this.blurMat, this.blurA);
      this.blurMat.uniforms.tInput.value = this.blurA.texture;
      this.blurMat.uniforms.uDir.value.set(0, (1 + i) / bh);
      this.pass(this.blurMat, this.blurB);
      src = this.blurB;
    }
    // God rays toward the sun, only when it's on screen or just off it.
    const raysOn = !!p.sunScreen && p.rays > 0.01;
    if (raysOn) {
      this.raysMat.uniforms.uSun.value.copy(p.sunScreen!);
      this.pass(this.raysMat, this.rays);
    }
    const u = this.compMat.uniforms;
    u.uSunColor.value.copy(p.sunColor);
    u.uRays.value = raysOn ? p.rays : 0;
    u.uBloom.value = p.bloom;
    u.uExposure.value = p.exposure;
    u.uSat.value = p.saturation ?? 1.04;
    u.uUnderwater.value = p.underwater ? 1 : 0;
    u.uTime.value = p.time;
    this.pass(this.compMat, null);
  }
}
