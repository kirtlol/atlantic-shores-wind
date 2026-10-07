// Vessel wave field (owner: ocean): the Kelvin wake of each moving hull, evaluated analytically.
//
// A hull moving at speed U radiates waves whose phase is stationary in the hull's frame. For a point
// x' astern and y' abeam of the source, the waves that reach it travel at angle θ to the track with
// T = tan θ a root of 2|y'|T² − x'T + |y'| = 0 (Lamb §256; real inside the wedge |y'|/x' ≤ 1/√8,
// the 19.47° cusp line): the small root is the transverse system, the large one the divergent.
// Each has wavenumber k = k0 (1 + T²), k0 = g/U², phase φ = k0 √(1+T²) (x' − |y'| T) (stationary in θ
// exactly at those roots), and (envelope theorem) phase gradient k0 √(1+T²) (1, −T sgn y') in (x', y'). Its amplitude falls as √(L/r) and is
// weighted by the hull's wave-making spectrum W(k) = (k/kp)² e^(1 − (k/kp)²): a hull of length L
// barely makes waves much shorter than itself and makes the long transverse waves weakly at high
// Froude number, so the visible arms sit inside the cusp (Rabaud & Moisy 2013), at 12-17° for a
// planing crew boat. Near the hull a pressure trough runs along its length and the water piles up
// at the stem. Waves older than ~40 s (x' > 40 U) have faded.
//
// Sources: ocean.setWaveSources([{ x, z, headingDeg | dirX,dirZ, speed, length, beam, amplitude,
// halfAngleDeg }]) each frame (a list older than 1 s lapses).
import * as THREE from 'three';

export const MAX_WAVE_SOURCES = 4;
const G = 9.81;
const DEG = Math.PI / 180;
const WAKE_DECAY_S = 40;             // ESTIMATED e-folding age of a wake's waves
const DEFAULTS = { length: 27, beam: 8.9, amplitude: 0.4 };   // StratCat-27 CTV (config VESSELS.ctv); ESTIMATED 0.8 m crest-to-trough wash near a planing 27 m cat

// Peak wavenumber of the hull spectrum: from the visible half-angle if given (the angle whose
// divergent root has the peak wavenumber), else λ = 0.9 L.
function peakK(U, L, halfAngleDeg) {
  if (halfAngleDeg > 1 && halfAngleDeg < 19.4) {
    const r = Math.tan(halfAngleDeg * DEG), disc = Math.sqrt(Math.max(1 - 8 * r * r, 0));
    const T = (1 + disc) / (4 * r);
    return (G / (U * U)) * (1 + T * T);
  }
  return 2 * Math.PI / (0.9 * L);
}

// GLSL: per-source parameters in uniforms uWakeA[i] = (x, z rel. snap, dirX, dirZ),
// uWakeB[i] = (k0, kp, length, amplitude), uWakeC[i] = (beam, speed, 0, 0); uWakeCount.
export const WAKE_GLSL = /* glsl */`
uniform vec4 uWakeA[${MAX_WAVE_SOURCES}];
uniform vec4 uWakeB[${MAX_WAVE_SOURCES}];
uniform vec4 uWakeC[${MAX_WAVE_SOURCES}];
uniform int uWakeCount;
// Elevation (x) and slope (yz) of all wave sources at p (snap frame); band-limited: waves shorter
// than 'minLambda' are dropped (vertex spacing, or the pixel footprint). hull: include the local
// pressure trough and bow pile-up.
vec3 ocWake(vec2 p, float minLambda, bool hull) {
  vec3 o = vec3(0.0);
  for (int i = 0; i < uWakeCount; i++) {
    vec4 A = uWakeA[i], B = uWakeB[i], C = uWakeC[i];
    vec2 r = p - A.xy;
    vec2 h = A.zw, hp = vec2(-h.y, h.x);
    float xs = -dot(r, h);                  // metres astern of the bow
    float ys = dot(r, hp);                  // metres abeam
    float L = B.z;
    if (xs < -0.5 * L || xs > 60.0 * C.y + 40.0) continue;
    float ay = max(abs(ys), 1e-3), sy = ys < 0.0 ? -1.0 : 1.0;
    if (hull) {
      // pressure trough along the hull and the stem's pile-up (moves with it, grows with speed²)
      float sp = clamp(C.y / 11.0, 0.0, 1.3);
      float xh = (xs - 0.55 * L) / (0.5 * L), yh = ys / (0.6 * C.x);
      float tr = -0.25 * sp * sp * exp(-xh * xh - yh * yh);
      float xb = (xs + 1.2) / 1.6, yb = ys / (0.7 * C.x);
      float hb = 0.2 * sp * sp * exp(-xb * xb - yb * yb);
      o.x += tr + hb;
      o.y += tr * (-2.0 * xh / (0.5 * L)) * (-h.x) + tr * (-2.0 * yh / (0.6 * C.x)) * hp.x
           + hb * (-2.0 * xb / 1.6) * (-h.x) + hb * (-2.0 * yb / (0.7 * C.x)) * hp.x;
      o.z += tr * (-2.0 * xh / (0.5 * L)) * (-h.y) + tr * (-2.0 * yh / (0.6 * C.x)) * hp.y
           + hb * (-2.0 * xb / 1.6) * (-h.y) + hb * (-2.0 * yb / (0.7 * C.x)) * hp.y;
    }
    if (xs <= 0.0) continue;
    float disc = xs * xs - 8.0 * ay * ay;
    if (disc <= 0.0) continue;
    float sd = sqrt(disc);
    float dist = sqrt(xs * xs + ys * ys);
    float env = B.w * sqrt(L / max(dist, L)) * exp(-xs / (${WAKE_DECAY_S.toFixed(1)} * C.y))
              * smoothstep(0.0, 0.35 * L, xs) * (1.0 + 0.8 * exp(-disc / (0.02 * xs * xs)));   // cusp caustic
    for (int s = 0; s < 2; s++) {
      float T = s == 0 ? 2.0 * ay / (xs + sd) : (xs + sd) / (4.0 * ay);
      float sec = sqrt(1.0 + T * T);
      float k = B.x * sec * sec;
      float kr = k / B.y;
      float W = kr * kr * exp(1.0 - kr * kr);
      float amp = env * W * smoothstep(minLambda, 2.0 * minLambda, 6.2831853 / k);
      if (amp < 1e-4) continue;
      float ph = B.x * sec * (xs - ay * T) + (s == 0 ? 0.785398 : -0.785398);   // ±π/4: sign of φ''(θ)
      vec2 g = B.x * sec * vec2(1.0, -T * sy);                 // phase gradient in (x', y')
      vec2 gw = g.x * (-h) + g.y * hp;                         // in world (x, z)
      o.x += amp * cos(ph);
      o.yz += -amp * sin(ph) * gw;
    }
  }
  return o;
}
`;

// CPU mirror of ocWake (without the hull-local terms: a hull must not sit in its own trough).
export function wakeHeight(sources, x, z) {
  let h = 0;
  for (const s of sources) {
    const rx = x - s.x, rz = z - s.z;
    const xs = -(rx * s.dirX + rz * s.dirZ), ys = rx * -s.dirZ + rz * s.dirX;
    if (xs <= 0 || xs > 60 * s.speed + 40) continue;
    const ay = Math.max(Math.abs(ys), 1e-3);
    const disc = xs * xs - 8 * ay * ay;
    if (disc <= 0) continue;
    const sd = Math.sqrt(disc), dist = Math.hypot(xs, ys), L = s.length;
    const sm = Math.min(1, xs / (0.35 * L)), fadeIn = sm * sm * (3 - 2 * sm);
    const env = s.amplitude * Math.sqrt(L / Math.max(dist, L)) * Math.exp(-xs / (WAKE_DECAY_S * s.speed)) * fadeIn * (1 + 0.8 * Math.exp(-disc / (0.02 * xs * xs)));
    for (let k2 = 0; k2 < 2; k2++) {
      const T = k2 === 0 ? 2 * ay / (xs + sd) : (xs + sd) / (4 * ay);
      const sec = Math.sqrt(1 + T * T), k = s.k0 * sec * sec, kr = k / s.kp;
      const W = kr * kr * Math.exp(1 - kr * kr);
      const ph = s.k0 * sec * (xs - ay * T) + (k2 === 0 ? 0.785398 : -0.785398);
      h += env * W * Math.cos(ph);
    }
  }
  return h;
}

export class WaveSources {
  constructor() {
    this.list = [];                 // resolved sources this frame (world coordinates)
    this._explicit = null;
    this._explicitT = -Infinity;
    this.uniforms = {
      uWakeA: { value: Array.from({ length: MAX_WAVE_SOURCES }, () => new THREE.Vector4()) },
      uWakeB: { value: Array.from({ length: MAX_WAVE_SOURCES }, () => new THREE.Vector4()) },
      uWakeC: { value: Array.from({ length: MAX_WAVE_SOURCES }, () => new THREE.Vector4()) },
      uWakeCount: { value: 0 },
    };
  }

  // Explicit sources (vessels): [{ x, z, headingDeg | dirX, dirZ, speed, length, beam, amplitude,
  // halfAngleDeg }], x/z at the bow on the centreline.
  set(list, t) { this._explicit = (list || []).slice(0, MAX_WAVE_SOURCES); this._explicitT = t; }

  update(t, snap, camera) {
    const out = [];
    if (this._explicit && t - this._explicitT < 1.0) for (const s of this._explicit) out.push(this._resolve(s));
    // nearest to the camera first
    if (camera && out.length > 1) out.sort((p, q) => ((p.x - camera.position.x) ** 2 + (p.z - camera.position.z) ** 2) - ((q.x - camera.position.x) ** 2 + (q.z - camera.position.z) ** 2));
    this.list = out;
    const U = this.uniforms;
    out.forEach((s, i) => {
      U.uWakeA.value[i].set(s.x - snap.x, s.z - snap.y, s.dirX, s.dirZ);
      U.uWakeB.value[i].set(s.k0, s.kp, s.length, s.amplitude);
      U.uWakeC.value[i].set(s.beam, s.speed, 0, 0);
    });
    U.uWakeCount.value = out.length;
  }

  _resolve(s) {
    let dirX = s.dirX, dirZ = s.dirZ;
    if (!Number.isFinite(dirX) || !Number.isFinite(dirZ)) { const a = (s.headingDeg ?? 0) * DEG; dirX = Math.sin(a); dirZ = -Math.cos(a); }
    const n = Math.hypot(dirX, dirZ) || 1;
    const speed = Math.max(0.5, s.speed ?? 10);
    const length = s.length ?? DEFAULTS.length, beam = s.beam ?? DEFAULTS.beam;
    // wave amplitude grows with speed up to planing (ESTIMATED 0.4 m near a CTV at 22 kn)
    const amplitude = (s.amplitude ?? DEFAULTS.amplitude) * THREE.MathUtils.smoothstep(speed, 1.5, 8) * (length / DEFAULTS.length);
    return { x: s.x, z: s.z, dirX: dirX / n, dirZ: dirZ / n, speed, length, beam, amplitude, k0: G / (speed * speed), kp: peakK(speed, length, s.halfAngleDeg) };
  }

  height(x, z) { return this.list.length ? wakeHeight(this.list, x, z) : 0; }
}
