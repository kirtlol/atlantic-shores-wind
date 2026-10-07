// Local splash map (owner: ocean).
//
// White water, aeration and ring ripples of every splash near the action are
// rasterised each frame as instanced stamps (additive) into a 1024² half-float map covering
// ±SPLASH_HALF m around a focus: the centroid of the disturbances near where the camera looks
// (a blitz). There is no slot limit: a blitz of 15 strikes/s whose white water lives 4-6 s and
// whose ring trains live 10-15 s keeps 150-250 splashes here, at a cost set by the stamps' area
// (a few hundred thousand texels), not by a per-pixel loop over the whole sea. The ocean reads
// the result with one texture fetch; disturbances outside the map (and every boil, whose dome
// displaces the mesh) stay on the analytic uniform path in ocean-material.js.
//
// Channels: R white-water density (the ocean's lace model turns density into coverage),
// G aerated water (the turquoise bubble cloud around and under a strike), B/A ring-ripple slope
// (x, z) of the Cauchy-Poisson ring trains, band-limited to the map's 9 cm texels.
import * as THREE from 'three';

export const SPLASH_HALF = 48;               // metres either side of the focus
export const SPLASH_RES = 1024;              // 9.4 cm texels
export const SPLASH_MAX = 4096;              // stamps per frame
const TEXEL = 2 * SPLASH_HALF / SPLASH_RES;

const VS = /* glsl */`
attribute vec2 aCorner;       // quad corner in [-1, 1]
attribute vec4 aS0;           // x, z (metres from the map centre), radius, strength
attribute vec4 aS1;           // age, duration, foam, kind
attribute vec2 aS2;           // seed, extent (m): radius of the stamp's quad
varying vec2 vP;              // metres from the stamp centre
varying vec4 vS0;
varying vec4 vS1;
varying float vSeed;
uniform float uHalf;
void main() {
  vS0 = aS0; vS1 = aS1; vSeed = aS2.x;
  vP = aCorner * aS2.y;
  gl_Position = vec4((aS0.xy + vP) / uHalf, 0.0, 1.0);
}`;

// Dispersive ring train of a strike (Cauchy-Poisson, stationary phase): the wavenumber reaching
// radius r at time t is the one whose capillary-gravity group velocity is r / t; long waves lead. A
// strike in a 0.5-0.7 m wind sea scrambles its rings within a few metres and seconds, and
// neighbouring strikes interfere: the envelope decays with range and age (the caller breaks it up
// in angle). Returns the radial slope; minLen: shortest ripple the target can hold (m).
export const RING_GLSL = (g, tension) => /* glsl */`
float ocRingSlope(float r, float age, float Rs, float strength, float life, float wind, float minLen) {
  float a = max(Rs * 0.3, 0.04);
  float re = sqrt(r * r + a * a);
  float u = re / max(age, 0.03);
  if (u <= 0.18) return 0.0;
  float k = ${g.toFixed(4)} / (4.0 * u * u);
  for (int it = 0; it < 3; it++) {
    float tk = ${tension.toExponential(4)} * k * k;
    k = (${g.toFixed(4)} + 3.0 * tk) * (${g.toFixed(4)} + 3.0 * tk) / (4.0 * u * u * (${g.toFixed(4)} + tk));
  }
  k = min(k, 140.0);
  float w = sqrt(${g.toFixed(4)} * k + ${tension.toExponential(4)} * k * k * k);
  float lk = log(k * Rs / 4.0);
  float amp = strength * 0.12 * sqrt(a / re) * exp(-lk * lk / 1.6) * exp(-age / min(life * 1.2, 2.0)) * exp(-re / (2.0 + 0.3 * Rs))
            * mix(1.0, 0.5, smoothstep(3.0, 6.0, wind)) * (1.0 - smoothstep(0.35, 0.8, k * minLen / 3.14159265));
  return -amp * k * sin(k * re - w * age);
}`;

const fragmentShader = (RIPPLE_G, RIPPLE_T) => /* glsl */`
uniform sampler2D uFoamTex;
uniform float uWind;
varying vec2 vP;
varying vec4 vS0;
varying vec4 vS1;
varying float vSeed;
const float TEXEL = ${TEXEL.toFixed(5)};
${RING_GLSL(RIPPLE_G, RIPPLE_T)}
void main() {
  float r = length(vP);
  float age = vS1.x, life = vS1.y, foamAmt = vS1.z;
  float Rs = vS0.z, strength = vS0.w;
  vec2 dir = vP / max(r, 1e-4);
  float ang = atan(vP.y, vP.x) * 0.15915494;
  // ragged outline: low-frequency angular noise (u spans one texture period, so no seam)
  float edgeN = textureLod(uFoamTex, vec2(ang + vSeed * 0.371, 0.23 * vSeed + 0.01 * age), 4.5).b * 2.0 - 0.5;
  float edgeN2 = textureLod(uFoamTex, vec2(3.0 * ang + vSeed * 0.53, 0.61 + 0.17 * vSeed), 3.0).b;
  vec4 o = vec4(0.0);
  o.zw += dir * ocRingSlope(r, age, Rs, strength, life, uWind, TEXEL) * (0.55 + 0.45 * edgeN2);
    // white water: dense for a few tenths of a second, then lace that spreads and thins; radial
    // spokes where the spray sheet fell back; a residual scum; spray specks round it
    float R = Rs * (0.55 + 0.55 * (1.0 - exp(-age / 0.7))) * (0.78 + 0.44 * edgeN);
    float core = 1.0 - smoothstep(0.5, 1.0, r / R);
    float spokes = 0.6 + 0.4 * textureLod(uFoamTex, vec2(ang * 1.333 + vSeed, 0.1 * r / max(R, 0.1)), 0.0).g;   // ~16 spokes
    float fresh = exp(-age / max(life * 0.35, 0.25));
    o.x += foamAmt * core * spokes * (0.9 * fresh + 0.25 * exp(-age / max(life, 0.5)));
    float Rr = R * (1.0 + 0.15 * age);
    o.x += foamAmt * 0.3 * (1.0 - smoothstep(0.6, 1.0, r / Rr)) * exp(-age / max(3.0 * life, 1.0)) * smoothstep(0.2, 0.8, age);
    o.x += foamAmt * 0.45 * smoothstep(2.4 * Rs, 1.2 * Rs, r) * smoothstep(0.7, 1.0, r / R) * exp(-age / 1.6);
  // aerated water: the bubble cloud reaches ~1.5 radii and outlives the white water
  o.y += foamAmt * exp(-age / 3.0) * (1.0 - smoothstep(0.6, 1.6, r / Rs));
  gl_FragColor = o;
}`;

export class SplashMap {
  // ripple: { g, tension } of the capillary-gravity dispersion (ocean-effects.js RIPPLE_G / RIPPLE_T);
  // target: the effects atlas whose right half (SPLASH_RES²) this map draws into
  constructor(renderer, ripple, target) {
    this.renderer = renderer;
    this.target = target;
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('aCorner', new THREE.BufferAttribute(new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]), 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.s0 = new Float32Array(SPLASH_MAX * 4);
    this.s1 = new Float32Array(SPLASH_MAX * 4);
    this.s2 = new Float32Array(SPLASH_MAX * 2);
    g.setAttribute('aS0', new THREE.InstancedBufferAttribute(this.s0, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aS1', new THREE.InstancedBufferAttribute(this.s1, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aS2', new THREE.InstancedBufferAttribute(this.s2, 2).setUsage(THREE.DynamicDrawUsage));
    g.instanceCount = 0;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    this.material = new THREE.ShaderMaterial({
      uniforms: { uFoamTex: { value: null }, uWind: { value: 4.5 }, uHalf: { value: SPLASH_HALF } },
      vertexShader: VS, fragmentShader: fragmentShader(ripple.g, ripple.tension),
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
      depthTest: false, depthWrite: false, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.mesh);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1);
    this.centre = new THREE.Vector2();
    this.on = false;
    this._dirty = false;
    this._clear = new THREE.Color();
    this.count = 0;
  }

  setFoamTexture(tex) { this.material.uniforms.uFoamTex.value = tex; }

  // Whether a disturbance's whole area of influence lies inside the map around `centre`.
  contains(cx, cz, x, z, reach) { return Math.abs(x - cx) + reach < SPLASH_HALF - 1 && Math.abs(z - cz) + reach < SPLASH_HALF - 1; }

  // stamps: [{ x, z, radius, strength, duration, foam, kind, age, reach, seed }] (splashes)
  render(stamps, cx, cz, wind) {
    const n = Math.min(stamps.length, SPLASH_MAX);
    this.centre.set(cx, cz);
    this.on = n > 0;
    this.count = n;
    if (n === 0 && !this._dirty) return;
    this._dirty = n > 0;
    for (let i = 0; i < n; i++) {
      const s = stamps[i];
      this.s0[i * 4] = s.x - cx; this.s0[i * 4 + 1] = s.z - cz; this.s0[i * 4 + 2] = s.radius; this.s0[i * 4 + 3] = s.strength;
      this.s1[i * 4] = s.age; this.s1[i * 4 + 1] = s.duration; this.s1[i * 4 + 2] = s.foam; this.s1[i * 4 + 3] = s.kind;
      this.s2[i * 2] = s.seed; this.s2[i * 2 + 1] = s.reach;
    }
    const g = this.mesh.geometry;
    g.instanceCount = n;
    g.attributes.aS0.needsUpdate = true; g.attributes.aS1.needsUpdate = true; g.attributes.aS2.needsUpdate = true;
    this.material.uniforms.uWind.value = wind;
    const r = this.renderer;
    const prev = r.getRenderTarget(), prevAuto = r.autoClear, prevAlpha = r.getClearAlpha();
    r.getClearColor(this._clear);
    r.setClearColor(0x000000, 0);
    const t = this.target;
    t.viewport.set(SPLASH_RES, 0, SPLASH_RES, SPLASH_RES); t.scissor.copy(t.viewport); t.scissorTest = true;
    r.setRenderTarget(t);
    r.autoClear = true;                                   // clears this half only (scissor)
    r.render(this.scene, this.camera);
    r.setRenderTarget(prev);
    r.autoClear = prevAuto;
    r.setClearColor(this._clear, prevAlpha);
  }

  dispose() { this.material.dispose(); this.mesh.geometry.dispose(); }
}
