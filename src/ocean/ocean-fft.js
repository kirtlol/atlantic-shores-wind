// GPU FFT ocean cascades (owner: ocean).
//
// Per frame, for every cascade at once (the cascades are stacked into one 256 × (256·n) atlas):
//   1. spectrum pass   evaluates the directional spectrum (GLSL port of spectrum.js) for
//                      each mode, evolves it to time t and packs eight spectral fields into four
//                      complex numbers (two MRT outputs):
//                        (Dx + i η), (Dz + i ∂η/∂x), (∂η/∂z + i ∂Dx/∂x), (∂Dz/∂z + i ∂Dx/∂z)
//   2. 2·log4(N) = 8 passes of a radix-4 Stockham inverse FFT (rows, then columns within each tile)
//   3. assemble passes choppy displacement (the two geometry cascades), then per cascade the
//                      Jacobian, LEAN slope moments (sx, sz, sx², sz²) and whitecap foam with
//                      persistence, decay and wind streaks, into mip-mapped, repeat-wrapped
//                      HalfFloat textures (see the class below):
//                        disp[c] (Dx, η, Dz, 1)   slope layer c (sx, sz, sx², sz²)
//                        foam layer c (stage A, streak, J, stage B): the state the next frame reads
//
// The initial Gaussian noise, each mode's (quantised) angular frequency and each mode's band mask
// live in a static float texture generated with mulberry32, so the CPU mirror (surface-cpu.js)
// reproduces exactly the same modes.
import * as THREE from 'three';
import {
  CASCADES, FFT_SIZE, makeNoise, modeK, inBand, wrapIndex, omegaOf, cascadeFrame,
  GRAVITY, WATER_DEPTH, SURFACE_TENSION, FILM_DAMPING, TAIL_SPREAD_S,
} from './spectrum.js';

// Angular frequencies are rounded to multiples of 2π/TIME_REPEAT so the whole field repeats
// exactly every TIME_REPEAT seconds; the shaders then use (t mod TIME_REPEAT) and keep full
// float32 phase precision however long the scene runs (Tessendorf 2001, §4.3).
export const TIME_REPEAT = 600;
const OMEGA_0 = 2 * Math.PI / TIME_REPEAT;
export function quantizedOmega(k) { return Math.max(1, Math.round(omegaOf(k) / OMEGA_0)) * OMEGA_0; }

// Whitecap model (ESTIMATED, calibrated in dev/ocean.html against Monahan W(U)): foam is generated
// where the Jacobian of the choppy map drops below a wind-dependent bias, on the forward face of
// the crest and drawn out along it (a breaking front is a line, not a disc). It lives in two
// stages (Monahan & Woolf): stage A, the bright active whitecap, e-folds in FOAM_FRESH_S; what
// decays from it becomes stage-B residual foam, grey lace that drifts and smears downwind and
// e-folds in residualS(U); the residual in turn feeds long wind-aligned streaks.
export const CHOPPINESS = 1.0;     // at the default wind; choppinessFor(U) above 8 m/s
export function choppinessFor(u10) {
  const x = Math.min(1, Math.max(0, (u10 - 8) / 10));
  return CHOPPINESS + 0.4 * x * x * (3 - 2 * x);     // steeper, sharper crests in a gale (1.4 at 18 m/s)
}
const FOAM_FRESH_S = 1.2;          // stage A (active breaking, bright white) e-folding time
// stage B (residual patch) e-folding time: 4 s in a moderate breeze, 14 s by a near gale, when the
// residual foam of each breaker lingers and is drawn into streaks (Beaufort 6-7: "white foam
// crests are more extensive everywhere", "foam begins to be blown in streaks")
const residualS = (u10) => 4 + 10 * Math.min(1, Math.max(0, (u10 - 6) / 10)) ** 2 * (3 - 2 * Math.min(1, Math.max(0, (u10 - 6) / 10)));
const FOAM_TRANSFER = 1.0;         // share of the decaying stage-A foam that becomes stage B
const FOAM_THIN_RATE = 0.012;      // /s: thin stage-B foam collapses outright (bubbles burst)
const STREAK_DECAY_S = 24;         // residual streak lifetime
const STREAK_FEED = 0.12;          // fraction of the decaying residual left behind as streak residue

const PI_GLSL = '3.14159265358979';

// ------------------------------------------------------------------ GLSL
const FULLSCREEN_VS = /* glsl */`
precision highp float;
in vec3 position;
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }`;

// Spectrum functions, a line-by-line port of spectrum.js (spectrumK and helpers).
const SPECTRUM_GLSL = /* glsl */`
const float OC_PI = ${PI_GLSL};
const float OC_G = ${GRAVITY.toFixed(4)};
const float OC_DEPTH = ${WATER_DEPTH.toFixed(3)};
const float OC_TENSION = ${SURFACE_TENSION.toExponential(4)};
uniform float uScaleW, uWpW, uGammaW, uSW, uWind; uniform vec2 uDirW;
uniform float uScaleS, uWpS, uGammaS, uSS; uniform vec2 uDirS;
float ocOmega(float k) {
  float kd = min(k * OC_DEPTH, 20.0);
  return sqrt((OC_G * k + OC_TENSION * k * k * k) * tanh(kd));
}
float ocDOmegaDk(float k) {
  float kd = min(k * OC_DEPTH, 20.0);
  float th = tanh(kd);
  float a = OC_G * k + OC_TENSION * k * k * k;
  float w = sqrt(a * th);
  float da = OC_G + 3.0 * OC_TENSION * k * k;
  float dth = kd < 20.0 ? OC_DEPTH * (1.0 - th * th) : 0.0;
  return (da * th + a * dth) / (2.0 * max(w, 1e-9));
}
float ocPeak(float w, float wp, float gamma) {
  float sigma = w <= wp ? 0.07 : 0.09;
  return pow(gamma, exp(-(w - wp) * (w - wp) / (2.0 * sigma * sigma * wp * wp)));
}
float ocJonswap(float w, float wp, float gamma) {
  if (w <= 1e-4) return 0.0;
  float x2 = wp * wp / (w * w);
  return pow(w, -5.0) * exp(-1.25 * x2 * x2) * ocPeak(w, wp, gamma);
}
float ocWindShape(float w, float wp, float gamma) {
  if (w <= 1e-4) return 0.0;
  float x2 = wp * wp / (w * w), wt = 3.0 * wp;
  return (w <= wt ? pow(w, -4.0) / wp : pow(w, -5.0) * wt / wp) * exp(-x2 * x2) * ocPeak(w, wp, gamma);
}
float ocSpreadNorm(float s) { return sqrt(s + 0.25 + 1.0 / (32.0 * s + 32.0)) / (2.0 * sqrt(OC_PI)); }
float ocRipple(float u10, float k) {
  float onset = clamp((u10 - 0.4) / 2.6, 0.0, 1.0);
  float w = 1.0 - exp(-(k / 4.0) * (k / 4.0));
  float x = clamp((u10 - 4.0) / 4.0, 0.0, 1.0);
  float film = ${FILM_DAMPING.toFixed(4)} * (1.0 - x * x * (3.0 - 2.0 * x));
  float wf = 1.0 - exp(-(k / 3.0) * (k / 3.0));
  return (1.0 - w * (1.0 - onset * onset)) * (1.0 - film * wf);
}
float ocSpectrumK(vec2 kv) {
  float k = length(kv);
  if (k < 1e-6) return 0.0;
  float w = ocOmega(k);
  float jac = ocDOmegaDk(k) / k;
  vec2 c = kv / k;
  float S = 0.0;
  if (uScaleW > 0.0) {
    float cosd = clamp(dot(c, uDirW), -1.0, 1.0);
    float s = w <= uWpW ? uSW : mix(uSW, ${TAIL_SPREAD_S.toFixed(1)}, smoothstep(1.0, 1.6, w / uWpW)) - ${(TAIL_SPREAD_S - 2).toFixed(1)} * smoothstep(2.5, 4.0, w / uWpW);
    float D = ocSpreadNorm(s) * pow(max(0.0, 0.5 + 0.5 * cosd), s);
    S += uScaleW * ocWindShape(w, uWpW, uGammaW) * D * ocRipple(uWind, k);
  }
  if (uScaleS > 0.0) {
    float cosd = clamp(dot(c, uDirS), -1.0, 1.0);
    float D = ocSpreadNorm(uSS) * pow(max(0.0, 0.5 + 0.5 * cosd), uSS);
    S += uScaleS * ocJonswap(w, uWpS, uGammaS) * D;
  }
  return S * jac;
}`;

function spectrumFS(n) {
  return /* glsl */`
precision highp float; precision highp int; precision highp sampler2D;
layout(location = 0) out vec4 outA;
layout(location = 1) out vec4 outB;
uniform sampler2D uNoise;         // (ξr, ξi, ω quantised, band mask)
uniform float uTimeMod;
uniform vec4 uCas[${n}];          // (L, cos rot, sin rot, 0)
const int N = ${FFT_SIZE};
${SPECTRUM_GLSL}
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  int c = p.y / N;
  int iz = p.y - c * N;
  int ix = p.x;
  vec4 n0 = texelFetch(uNoise, p, 0);
  if (n0.w < 0.5) { outA = vec4(0.0); outB = vec4(0.0); return; }
  vec4 cas = uCas[c];
  float dk = 2.0 * OC_PI / cas.x;
  vec2 kl = vec2(float(ix < N / 2 ? ix : ix - N), float(iz < N / 2 ? iz : iz - N)) * dk;
  vec2 k = vec2(cas.y * kl.x - cas.z * kl.y, cas.z * kl.x + cas.y * kl.y);
  float kk = length(k);
  vec4 n1 = texelFetch(uNoise, ivec2((N - ix) % N, c * N + (N - iz) % N), 0);
  vec2 h0 = n0.xy * (0.5 * sqrt(ocSpectrumK(k)) * dk);
  vec2 h0m = n1.xy * (0.5 * sqrt(ocSpectrumK(-k)) * dk);
  float ph = n0.z * uTimeMod;
  float cs = cos(ph), sn = sin(ph);
  // h~ = h0 e^{-iφ} + conj(h0(-k)) e^{+iφ}
  vec2 ht = vec2(h0.x * cs + h0.y * sn, h0.y * cs - h0.x * sn)
          + vec2(h0m.x * cs + h0m.y * sn, h0m.x * sn - h0m.y * cs);
  vec2 kn = k / kk;
  vec2 pi = vec2(-ht.y, ht.x);          // +i h~
  // Choppy displacement D = +i (k/|k|) h~ moves surface points toward the crests (for η = a cos kx,
  // Dx = −a sin kx), so crests sharpen and troughs broaden, as in Gerstner waves. (Tessendorf's
  // −i k/|k| with a positive λ, used before 2026-09-30, did the opposite: broad crests, cusped
  // troughs, and whitecaps generated in the troughs.)
  vec2 fDx = kn.x * pi, fDz = kn.y * pi;
  vec2 fSx = k.x * pi, fSz = k.y * pi;
  vec2 fJxx = -(k.x * k.x / kk) * ht, fJzz = -(k.y * k.y / kk) * ht, fJxz = -(k.x * k.y / kk) * ht;
  // A + iB packing of two real fields into one complex spectrum
  outA = vec4(fDx.x - ht.y, fDx.y + ht.x, fDz.x - fSx.y, fDz.y + fSx.x);
  outB = vec4(fSz.x - fJxx.y, fSz.y + fJxx.x, fJzz.x - fJxz.y, fJzz.y + fJxz.x);
}`;
}

// Radix-4 Stockham inverse FFT pass (N = 256 = 4^4: 4 passes per direction), autosorting:
//   y[idx] = Σ_m x[k + m·N/4] · e^{+2πi·m·idx/s},  k = ⌊idx/s⌋·(s/4) + idx mod (s/4)
// verified against a direct DFT in the dev tests; rows first, then columns inside each tile.
const FFT_FS = /* glsl */`
precision highp float; precision highp int; precision highp sampler2D;
layout(location = 0) out vec4 outA;
layout(location = 1) out vec4 outB;
uniform sampler2D uIn0, uIn1;
uniform int uSize;          // current sub-transform size s (4, 16, 64, 256)
uniform int uHorizontal;
const int N = ${FFT_SIZE};
vec2 cmul(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  int rowBase = p.y - p.y % N;
  int idx = uHorizontal == 1 ? p.x : p.y - rowBase;
  int q = uSize / 4;
  int k = (idx / uSize) * q + idx % q;
  float ang = ${(2 * Math.PI).toFixed(10)} * float(idx) / float(uSize);
  vec2 w1 = vec2(cos(ang), sin(ang));
  vec2 w2 = cmul(w1, w1), w3 = cmul(w2, w1);
  vec4 a0, a1, a2, a3, b0, b1, b2, b3;
  if (uHorizontal == 1) {
    a0 = texelFetch(uIn0, ivec2(k, p.y), 0);             b0 = texelFetch(uIn1, ivec2(k, p.y), 0);
    a1 = texelFetch(uIn0, ivec2(k + N / 4, p.y), 0);     b1 = texelFetch(uIn1, ivec2(k + N / 4, p.y), 0);
    a2 = texelFetch(uIn0, ivec2(k + N / 2, p.y), 0);     b2 = texelFetch(uIn1, ivec2(k + N / 2, p.y), 0);
    a3 = texelFetch(uIn0, ivec2(k + 3 * N / 4, p.y), 0); b3 = texelFetch(uIn1, ivec2(k + 3 * N / 4, p.y), 0);
  } else {
    a0 = texelFetch(uIn0, ivec2(p.x, rowBase + k), 0);             b0 = texelFetch(uIn1, ivec2(p.x, rowBase + k), 0);
    a1 = texelFetch(uIn0, ivec2(p.x, rowBase + k + N / 4), 0);     b1 = texelFetch(uIn1, ivec2(p.x, rowBase + k + N / 4), 0);
    a2 = texelFetch(uIn0, ivec2(p.x, rowBase + k + N / 2), 0);     b2 = texelFetch(uIn1, ivec2(p.x, rowBase + k + N / 2), 0);
    a3 = texelFetch(uIn0, ivec2(p.x, rowBase + k + 3 * N / 4), 0); b3 = texelFetch(uIn1, ivec2(p.x, rowBase + k + 3 * N / 4), 0);
  }
  outA = vec4(a0.xy + cmul(w1, a1.xy) + cmul(w2, a2.xy) + cmul(w3, a3.xy),
              a0.zw + cmul(w1, a1.zw) + cmul(w2, a2.zw) + cmul(w3, a3.zw));
  outB = vec4(b0.xy + cmul(w1, b1.xy) + cmul(w2, b2.xy) + cmul(w3, b3.xy),
              b0.zw + cmul(w1, b1.zw) + cmul(w2, b2.zw) + cmul(w3, b3.zw));
}`;

// Displacement of the two geometry cascades (the mesh, floating bodies' GPU twins, blitz decals).
const DISP_FS = /* glsl */`
precision highp float; precision highp int; precision highp sampler2D;
layout(location = 0) out vec4 outDisp;
uniform sampler2D uFft0;
uniform int uRow;
uniform float uChop;
void main() {
  vec4 a = texelFetch(uFft0, ivec2(gl_FragCoord.x, float(uRow) + gl_FragCoord.y), 0);
  outDisp = vec4(a.x * uChop, a.y, a.z * uChop, 1.0);
}`;
// Slope moments (every cascade) and whitecap foam (the two geometry cascades), into one layer of
// the slope and foam array textures: the ocean shader reads all cascades through two samplers.
const ASSEMBLE_FS = /* glsl */`
precision highp float; precision highp int; precision highp sampler2D; precision highp sampler2DArray;
layout(location = 0) out vec4 outSlope;
layout(location = 1) out vec4 outFoam;
uniform sampler2D uFft0, uFft1;
uniform sampler2DArray uPrevFoam;
uniform int uRow;
uniform float uLayer;
uniform float uChop;
uniform vec4 uFoam;          // (Jacobian bias, gain, stage-A decay factor, stage-B decay factor)
uniform vec4 uFoam2;         // (streak decay factor, A->B transfer, wind x, wind z in the tile frame)
uniform float uThin;         // thin-foam collapse this frame
uniform vec2 uAdvect;        // foam drift this frame, in tile uv (local frame)
uniform vec2 uStreak;        // along-wind blur step, in tile uv (local frame)
uniform float uFoamOn;
const int N = ${FFT_SIZE};
float ocJac(ivec2 p) {
  vec4 b = texelFetch(uFft1, ivec2((p.x + N) % N, uRow + (p.y + N) % N), 0);
  float jxx = b.y * uChop, jzz = b.z * uChop, jxz = b.w * uChop;
  return (1.0 + jxx) * (1.0 + jzz) - jxz * jxz;
}
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 a = texelFetch(uFft0, ivec2(p.x, uRow + p.y), 0);
  vec4 b = texelFetch(uFft1, ivec2(p.x, uRow + p.y), 0);
  float jxx = b.y * uChop, jzz = b.z * uChop, jxz = b.w * uChop;
  float J = (1.0 + jxx) * (1.0 + jzz) - jxz * jxz;
  // slope of the displaced surface (first-order correction for the horizontal compression)
  float sx = a.w / max(1.0 + jxx, 0.3);
  float sz = b.x / max(1.0 + jzz, 0.3);
  outSlope = vec4(sx, sz, sx * sx, sz * sz);
  if (uFoamOn < 0.5) { outFoam = vec4(0.0, 0.0, J, 0.0); return; }
  vec2 uv = (vec2(p) + 0.5) / float(N) - uAdvect;
  vec4 prev = texture(uPrevFoam, vec3(uv, uLayer));
  vec4 pA = texture(uPrevFoam, vec3(uv + uStreak, uLayer));
  vec4 pB = texture(uPrevFoam, vec3(uv - uStreak, uLayer));
  // breaking: the Jacobian below the bias, here or one texel either way along the crest (fronts
  // are lines), weighted toward the forward face of the crest (the surface falling downwind)
  vec2 wl = uFoam2.zw;
  ivec2 cr = ivec2(round(vec2(-wl.y, wl.x) * 1.41));
  float gen = clamp((uFoam.x - J) * uFoam.y, 0.0, 1.0);
  gen = max(gen, 0.75 * clamp((uFoam.x - max(ocJac(p + cr), ocJac(p - cr))) * uFoam.y, 0.0, 1.0));
  gen *= 0.35 + 0.65 * smoothstep(-0.03, 0.1, -(sx * wl.x + sz * wl.y));
  float fresh = max(prev.x * uFoam.z, gen);
  // stage B: what stage A loses, smeared a little downwind (Langmuir windrows start here)
  float residPrev = 0.7 * prev.w + 0.15 * (pA.w + pB.w);
  float resid = clamp(residPrev * uFoam.w - uThin + ${FOAM_TRANSFER.toFixed(3)} * prev.x * (1.0 - uFoam.z), 0.0, 1.0);
  float streak = (0.5 * prev.y + 0.25 * (pA.y + pB.y)) * uFoam2.x + ${STREAK_FEED.toFixed(3)} * residPrev * (1.0 - uFoam.w);
  outFoam = vec4(fresh, min(streak, 1.0), J, resid);
}`;

// ------------------------------------------------------------------ class
// Outputs (HalfFloat, mip-mapped, repeat-wrapped):
//   disp[c]      2D, cascades 0-1: (Dx, η, Dz, 1), sampled by the mesh (uDisp0/uDisp1: the blitz
//                decals and the dev probes read the same uniforms)
//   slope        2D array, one layer per cascade: (sx, sz, sx², sz²)
//   foam         2D array, layers 0-1: (stage A, streak, J, stage B); ping-pong, the next frame
//                reads it
// All cascades are allocated on every tier; `active` (2 on Low) says how many are computed, so a
// tier switch never reallocates or recompiles anything.
export class OceanFFT {
  constructor({ renderer, seed = 20260621 }) {
    this.renderer = renderer;
    this.count = CASCADES.length;
    this.active = this.count;
    this.N = FFT_SIZE;
    this.seed = seed;
    const N = FFT_SIZE, H = N * this.count;

    // --- static noise / ω / band texture
    this.noise = makeNoise(seed, N, CASCADES.length);
    const tex = new Float32Array(N * H * 4);
    for (let c = 0; c < this.count; c++) {
      for (let iz = 0; iz < N; iz++) for (let ix = 0; ix < N; ix++) {
        const nx = wrapIndex(ix, N), nz = wrapIndex(iz, N);
        const [kx, kz] = modeK(CASCADES[c], nx, nz);
        const k = Math.hypot(kx, kz);
        const i4 = ((c * N + iz) * N + ix) * 4;
        tex[i4] = this.noise[i4]; tex[i4 + 1] = this.noise[i4 + 1];
        tex[i4 + 2] = quantizedOmega(k);
        tex[i4 + 3] = inBand(CASCADES[c], k, nx, nz, N) ? 1 : 0;
      }
    }
    this.noiseTex = new THREE.DataTexture(tex, N, H, THREE.RGBAFormat, THREE.FloatType);
    this.noiseTex.minFilter = this.noiseTex.magFilter = THREE.NearestFilter;
    this.noiseTex.generateMipmaps = false;
    this.noiseTex.needsUpdate = true;

    // --- FFT ping-pong targets (2 complex pairs each)
    const fftOpts = { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, generateMipmaps: false, count: 2 };
    this.fftA = new THREE.WebGLRenderTarget(N, H, fftOpts);
    this.fftB = new THREE.WebGLRenderTarget(N, H, fftOpts);

    // --- outputs
    const maxAniso = renderer.capabilities.getMaxAnisotropy();
    const sampled = (t, aniso, name) => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.wrapR = THREE.ClampToEdgeWrapping;           // the second attachment of an array target is a plain Texture without one
      t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
      t.generateMipmaps = true; t.anisotropy = aniso; t.name = name;
    };
    this.disp = [0, 1].map((c) => {
      const rt = new THREE.WebGLRenderTarget(N, N, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false });
      sampled(rt.texture, 1, `ocean.c${c}.disp`);
      return rt;
    });
    // slopes: full anisotropy (the screen footprint's aspect is 1/sin(depression): 3.4 at 17°, 19 at
    // 3°; with a 4x cap the lateral detail beyond ~14° depression was averaged into LEAN variance
    // and the mid field read as horizontal corduroy). Foam: 4x, so distant foam stays flecks.
    this.sf = [0, 1].map(() => {
      const rt = new THREE.WebGLArrayRenderTarget(N, N, this.count, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, count: 2, depth: this.count });
      sampled(rt.textures[0], maxAniso, 'ocean.slopes');
      sampled(rt.textures[1], Math.min(4, maxAniso), 'ocean.foam');
      return rt;
    });
    this.flip = 0;

    // --- passes
    const casUniform = [];
    for (let c = 0; c < this.count; c++) {
      const f = cascadeFrame(CASCADES[c]);
      casUniform.push(new THREE.Vector4(CASCADES[c].L, f.cos, f.sin, 0));
    }
    this.seaUniforms = {
      uScaleW: { value: 0 }, uWpW: { value: 1 }, uGammaW: { value: 3.3 }, uSW: { value: 3 }, uWind: { value: 4.5 }, uDirW: { value: new THREE.Vector2(1, 0) },
      uScaleS: { value: 0 }, uWpS: { value: 1 }, uGammaS: { value: 3.3 }, uSS: { value: 15 }, uDirS: { value: new THREE.Vector2(1, 0) },
    };
    const pass = (fragmentShader, uniforms) => new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: FULLSCREEN_VS, fragmentShader, uniforms, depthTest: false, depthWrite: false });
    this.spectrumMat = pass(spectrumFS(this.count), { uNoise: { value: this.noiseTex }, uTimeMod: { value: 0 }, uCas: { value: casUniform }, ...this.seaUniforms });
    this.fftMat = pass(FFT_FS, { uIn0: { value: null }, uIn1: { value: null }, uSize: { value: 4 }, uHorizontal: { value: 1 } });
    this.dispMat = pass(DISP_FS, { uFft0: { value: null }, uRow: { value: 0 }, uChop: { value: CHOPPINESS } });
    this.assembleMat = pass(ASSEMBLE_FS, {
      uFft0: { value: null }, uFft1: { value: null }, uPrevFoam: { value: null }, uRow: { value: 0 }, uLayer: { value: 0 },
      uChop: this.dispMat.uniforms.uChop, uFoam: { value: new THREE.Vector4(-1, 4, 1, 1) }, uFoam2: { value: new THREE.Vector4(1, 1, 1, 0) }, uThin: { value: 0 },
      uAdvect: { value: new THREE.Vector2() }, uStreak: { value: new THREE.Vector2() }, uFoamOn: { value: 1 },
    });
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.quad = new THREE.Mesh(tri, this.spectrumMat);
    this.quad.frustumCulled = false;
    this.passScene = new THREE.Scene();
    this.passScene.add(this.quad);
    this.passCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this.whitecap = { bias: [-100, -100], gain: 12 };    // Jacobian thresholds for cascades 0 and 1
    this.windDir = new THREE.Vector2(1, 0);
    this.windSpeed = 4.5;
    this.chop = CHOPPINESS;
  }

  // Sea state from spectrum.resolveSeaState(); whitecap = { bias: [c0, c1], gain } for the Jacobian test.
  setSeaState(R, whitecap) {
    const u = this.seaUniforms;
    u.uScaleW.value = R.scaleW; u.uWpW.value = R.wW; u.uGammaW.value = R.gammaW; u.uSW.value = R.sW; u.uWind.value = R.windSpeed;
    u.uDirW.value.set(R.dirW[0], R.dirW[1]);
    u.uScaleS.value = R.scaleS; u.uWpS.value = R.wS; u.uGammaS.value = R.gammaS; u.uSS.value = R.sS;
    u.uDirS.value.set(R.dirS[0], R.dirS[1]);
    this.windDir.set(R.dirW[0], R.dirW[1]);
    this.windSpeed = R.windSpeed;
    this.chop = choppinessFor(R.windSpeed);
    this.dispMat.uniforms.uChop.value = this.chop;
    if (whitecap) this.whitecap = whitecap;
  }

  // Current output textures: { disp: [c0, c1], slope, foam } (slope and foam are 2D arrays).
  get textures() { const t = this.sf[this.flip].textures; return { disp: [this.disp[0].texture, this.disp[1].texture], slope: t[0], foam: t[1] }; }

  _pass(material, target, layer = 0) {
    this.quad.material = material;
    this.renderer.setRenderTarget(target, layer);
    this.renderer.render(this.passScene, this.passCam);
  }

  // Compute the active cascades for animation time t (seconds), frame step dt.
  update(t, dt) {
    const r = this.renderer, N = this.N, n = this.active;
    const prevTarget = r.getRenderTarget();
    const prevAutoClear = r.autoClear;
    r.autoClear = false;
    // spectrum and FFT passes cover the tiles of the active cascades only
    for (const rt of [this.fftA, this.fftB]) { rt.viewport.set(0, 0, N, N * n); rt.scissor.set(0, 0, N, N * n); rt.scissorTest = n < this.count; }
    this.spectrumMat.uniforms.uTimeMod.value = ((t % TIME_REPEAT) + TIME_REPEAT) % TIME_REPEAT;
    this._pass(this.spectrumMat, this.fftA);
    let src = this.fftA, dst = this.fftB;
    const fu = this.fftMat.uniforms;
    for (const horizontal of [1, 0]) {
      for (let size = 4; size <= N; size *= 4) {
        fu.uIn0.value = src.textures[0]; fu.uIn1.value = src.textures[1];
        fu.uSize.value = size; fu.uHorizontal.value = horizontal;
        this._pass(this.fftMat, dst);
        [src, dst] = [dst, src];
      }
    }
    // assemble: displacement (cascades 0-1), then slopes + foam into each cascade's layer
    const du = this.dispMat.uniforms;
    du.uFft0.value = src.textures[0];
    for (let c = 0; c < 2; c++) { du.uRow.value = c * N; this._pass(this.dispMat, this.disp[c]); }
    this.flip ^= 1;
    const out = this.sf[this.flip];
    const au = this.assembleMat.uniforms;
    au.uFft0.value = src.textures[0]; au.uFft1.value = src.textures[1];
    au.uPrevFoam.value = this.sf[this.flip ^ 1].textures[1];
    const wc = this.whitecap;
    const drift = 0.03 * this.windSpeed * dt;            // wind drift of surface foam ≈ 3 % of U10
    for (let c = 0; c < n; c++) {
      const cas = CASCADES[c], f = cascadeFrame(cas);
      // wind direction in the tile's local frame
      const lx = f.cos * this.windDir.x + f.sin * this.windDir.y;
      const lz = -f.sin * this.windDir.x + f.cos * this.windDir.y;
      au.uRow.value = c * N; au.uLayer.value = c;
      au.uFoamOn.value = c < 2 ? 1 : 0;
      au.uFoam.value.set(wc.bias[Math.min(c, 1)], wc.gain, dt > 0 ? Math.exp(-dt / FOAM_FRESH_S) : 1, dt > 0 ? Math.exp(-dt / residualS(this.windSpeed)) : 1);
      au.uFoam2.value.set(dt > 0 ? Math.exp(-dt / STREAK_DECAY_S) : 1, FOAM_TRANSFER, lx, lz);
      au.uThin.value = FOAM_THIN_RATE * Math.max(dt, 0);
      au.uAdvect.value.set(lx * drift / cas.L, lz * drift / cas.L);
      // along-wind smear: residual patches and their streaks spread ~±3 / ±5 m along the wind at 12 m/s
      const step = dt > 0 ? Math.min(0.9, this.windSpeed * dt) / cas.L : 0;
      au.uStreak.value.set(lx * step, lz * step);
      // the whole array's mips are rebuilt after each layer's pass: only after the last one
      for (const tx of out.textures) tx.generateMipmaps = c === n - 1;
      this._pass(this.assembleMat, out, c);
    }
    r.setRenderTarget(prevTarget);
    r.autoClear = prevAutoClear;
  }

  dispose() {
    this.noiseTex.dispose();
    this.fftA.dispose(); this.fftB.dispose();
    for (const rt of [...this.disp, ...this.sf]) rt.dispose();
    this.spectrumMat.dispose(); this.fftMat.dispose(); this.dispMat.dispose(); this.assembleMat.dispose();
    this.quad.geometry.dispose();
  }
}

// GLSL used by the ocean surface shader to sample cascade c at a local position q (relative to
// the snapped origin). uOcCas[c] = (cos, sin, 1/L, texel metres), uOcOff[c] = uv offset of the snap.
export function cascadeSamplingGLSL(n) {
  return /* glsl */`
uniform vec4 uOcCas[${n}];
uniform vec2 uOcOff[${n}];
vec2 ocCascadeUv(int c, vec2 q) {
  vec4 a = uOcCas[c];
  return vec2(a.x * q.x + a.y * q.y, -a.y * q.x + a.x * q.y) * a.z + uOcOff[c];
}`;
}
