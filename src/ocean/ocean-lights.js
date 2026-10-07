// Distant light columns (owner: ocean): the glitter paths that lamps too far for the planar mirror
// draw on the sea at night (Atlantic City at 17-36 km, turbine and substation lamps beyond ~3 km).
//
// Callers hand over their lamps; each frame the ocean keeps the DISTANT_CAPACITY brightest at the
// camera (I / d²), packs them into a small float texture and sorts them into screen-column bins, so
// a sea pixel evaluates only the few lights whose column can reach it. The column itself is
// analytic: each lamp is a point (or a small extended) source lighting the sea with E = I / d²,
// reflected by the same anisotropic Beckmann BRDF as the sun glint, dimmed by the haze between the
// lamp and the water, with the lamp's vertical beam toward the water point, and hidden where the
// sea's curvature puts the lamp below that point's horizon.
//
//   ocean.setDistantLights(key, { count, position: Float32Array(3n), colour: Float32Array(3n),
//                                 intensity: Float32Array(n)[, beam: Uint8Array(n)][, extent: Float32Array(n)] })
//   ocean.setDistantLights(list[, key])     list: [{ x, y, z, cd, color | colour: [r, g, b],
//                                                    width?, height?, beam?, flash?: { period, on, phase } }]
//     key        one set per caller ('farm', 'land', ...); a new call replaces that caller's set;
//                an empty list or count 0 removes it. Without a key a list goes to 'default'.
//     position   world metres (the curved-Earth y the object is drawn at)
//     colour     linear RGB, unit luminance (the lamp's chromaticity)
//     intensity  luminous intensity in cd at the current flash level, the lamp's peak (in the
//                horizontal plane): the ocean applies the vertical beam toward each water point
//                beam: 1 FAA L-864/L-810 (full above −1°, 3 % at −10°, 1 % below), 2 marine
//                lantern (Gaussian, NIGHT_LIGHTS.marine.beamFWHMDeg FWHM, beamFloor outside), 0 none. Without `beam`, saturated red
//                lamps get 1 and yellow ones 2 (aviation and marine colours), others 0
//     extent     source size in metres (lit facade, shore-light cell): widens its column
//     flash      (lists only) square wave with LED edges evaluated each frame on the ocean's clock:
//                level = 1 for `on` s of every `period` s starting at `phase` s
//   ocean.distantLightCapacity   lights kept (128)
//   ocean.distantLightMinDistance  callers may skip lamps nearer than this (the mirror draws them)
import * as THREE from 'three';
import { U } from '../shared.js';
import { LOOK, NIGHT_LIGHTS } from '../config.js';

export const DISTANT_CAPACITY = 128;
export const DISTANT_MIN_DISTANCE = 2500;        // m: nearer lamps are resolved by the planar mirror
const BINS = 64, SLOTS = 8;                      // screen-column bins, lights per bin
const LED_EDGE_S = 0.05;
const VB = NIGHT_LIGHTS.verticalBeam;
const MARINE_SIGMA2 = (NIGHT_LIGHTS.marine.beamFWHMDeg / 2.3548) ** 2;   // deg², vertical beam of the marine lanterns (10° FWHM)

// GLSL: rows of uDL: 0 (x, y, z, cd), 1 (r, g, b, extent + 1000 · beam), 2 bins (4 light indices
// per texel, two texels per bin, −1 = none). uDLInfo: (count, bins per pixel, 1 / sceneUnitLux, 0).
export const LIGHTS_GLSL = /* glsl */`
uniform highp sampler2D uDL;
uniform vec4 uDLInfo;
float ocBeam(float kind, float el) {
  if (kind < 0.5) return 1.0;
  if (kind < 1.5) return el >= ${VB.fullAboveDeg.toFixed(2)} ? 1.0 : (el >= -10.0 ? 1.0 + ${(VB.at10Deg - 1).toFixed(4)} * (${VB.fullAboveDeg.toFixed(2)} - el) / ${(VB.fullAboveDeg + 10).toFixed(2)} : ${VB.below.toFixed(3)});
  return max(${NIGHT_LIGHTS.marine.beamFloor.toFixed(3)}, exp(-0.5 * el * el / ${MARINE_SIGMA2.toFixed(3)}));   // NIGHT_LIGHTS.marine beamFWHMDeg, beamFloor
}
// Radiance of the lamps' glitter at sea point P (absolute). eOut: Gaussian exponent of the brightest.
vec3 ocDistantLights(vec3 P, vec3 V, vec3 N, vec2 s2, out float eOut) {
  vec3 sum = vec3(0.0);
  float best = 0.0;
  eOut = 14.0;
  int bin = int(gl_FragCoord.x * uDLInfo.y);
  vec3 up = normalize(vec3(P.x * ${(1 / 6371000).toExponential(6)}, 1.0, P.z * ${(1 / 6371000).toExponential(6)}));
  for (int t = 0; t < 2; t++) {
    vec4 ids = texelFetch(uDL, ivec2(bin * 2 + t, 2), 0);
    for (int j = 0; j < 4; j++) {
      int id = int(ids[j]);
      if (id < 0) break;
      vec4 a = texelFetch(uDL, ivec2(id, 0), 0), b = texelFetch(uDL, ivec2(id, 1), 0);
      vec3 Lv = a.xyz - P;
      float d = length(Lv);
      vec3 L = Lv / d;
      if (dot(Lv, up) <= 0.0) continue;                  // below this water point's horizon
      float kind = floor(b.w / 1000.0), ext = b.w - 1000.0 * kind;
      float h = 0.5 * ext / d;                             // the source's angular half size
      float e;
      float g = ocGlint(L, V, N, s2 + h * h, e);
      if (g <= 0.0) continue;
      float lum = a.w * uDLInfo.z / (d * d) * ocBeam(kind, -asin(clamp(dot(L, up), -1.0, 1.0)) * 57.29578);
#ifdef OC_VERTEX_AERIAL
      vec3 E = b.rgb * lum * exp(-uAtmFogRGB * atmHazePath(P, a.xyz));
#else
      vec3 E = b.rgb * lum;
#endif
      sum += E * g;
      float m = lum * g;
      if (m > best) { best = m; eOut = e; }
    }
  }
  return sum;
}
`;

export class DistantLights {
  constructor() {
    this.sets = new Map();
    this.count = 0;
    this.data = new Float32Array(DISTANT_CAPACITY * 4 * 3);
    this.texture = new THREE.DataTexture(this.data, DISTANT_CAPACITY, 3, THREE.RGBAFormat, THREE.FloatType);
    this.texture.minFilter = this.texture.magFilter = THREE.NearestFilter;
    this.texture.generateMipmaps = false;
    this.texture.needsUpdate = true;
    this.uniforms = { uDL: { value: this.texture }, uDLInfo: { value: new THREE.Vector4(0, BINS / 1600, 1 / LOOK.sceneUnitLux, 0) } };
    this._pick = [];
    this._v = new THREE.Vector3();
    this._size = new THREE.Vector2();
    this._bins = Array.from({ length: BINS }, () => []);
  }

  set(a, b) {
    let key, src;
    if (typeof a === 'string') { key = a; src = b; } else { src = a; key = typeof b === 'string' ? b : 'default'; }
    if (!src || (Array.isArray(src) ? src.length === 0 : !(src.count > 0))) { this.sets.delete(key); return; }
    this.sets.set(key, src);
  }

  // Pick, pack and bin the lights for this frame (the camera's view).
  update(t, camera, renderer, sigCross) {
    const pick = this._pick; pick.length = 0;
    const cp = camera.position;
    // bins: each light's column spans its screen x at the horizon ± the widest glitter, at the
    // bottom of the frame: a water point at depression δ reflects it with a cross slope of
    // α / tan δ for an azimuth offset α, so ±2.5 σ reaches α = 2.5 σ tan δ
    const size = renderer.getDrawingBufferSize(this._size);
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2), focal = size.y / (2 * tanHalf);
    const fwd = camera.getWorldDirection(this._v);
    const dep = Math.max(-Math.asin(THREE.MathUtils.clamp(fwd.y, -1, 1)) + Math.atan(tanHalf), 0.02);   // depression of the frame's bottom row
    const halfW = 2.5 * sigCross * Math.tan(Math.min(dep, 1.2)) * focal + 2;
    const v = this._v;
    // Only lights whose column can reach the frame compete for the capacity: behind the camera or
    // farther than halfW beside the frame they draw nothing (p2 integration: in the Atlantic City view
    // the farm's L-864s behind the camera took 103 of the 128 slots and most of the city went dark).
    const add = (x, y, z, cd, r, g, b, ext, beam) => {
      if (!(cd > 0)) return;
      const d2 = (x - cp.x) ** 2 + (y - cp.y) ** 2 + (z - cp.z) ** 2;
      if (d2 < 1) return;
      v.set(x, y, z).applyMatrix4(camera.matrixWorldInverse);
      if (v.z > -1) return;                                 // behind the camera (any depth convention)
      const sx = (v.applyMatrix4(camera.projectionMatrix).x * 0.5 + 0.5) * size.x;
      if (sx < -halfW || sx > size.x + halfW) return;
      pick.push({ x, y, z, cd, r, g, b, ext, beam, sx, w: cd / d2 });
    };
    for (const src of this.sets.values()) {
      if (Array.isArray(src)) {
        for (const l of src) {
          const c = l.colour || l.color || [1, 1, 1], f = l.flash;
          const lv = f ? flash(t, f.period, f.on, f.phase || 0) : 1;
          add(l.x, l.y, l.z, l.cd * lv, c[0], c[1], c[2], Math.max(l.width || 0, l.height || 0), l.beam | 0);
        }
      } else {
        const { position: P, colour: C, intensity: I, beam: B, extent: X } = src;
        for (let i = 0; i < src.count; i++) {
          const r = C[3 * i], g = C[3 * i + 1], b = C[3 * i + 2];
          add(P[3 * i], P[3 * i + 1], P[3 * i + 2], I[i], r, g, b, X ? X[i] : 0, B ? B[i] : r > 4 * g ? 1 : r > 2 * b && g > 2 * b ? 2 : 0);
        }
      }
    }
    pick.sort((p, q) => q.w - p.w);                      // brightest at the camera first
    const n = this.count = Math.min(pick.length, DISTANT_CAPACITY);
    const D = this.data, C4 = DISTANT_CAPACITY * 4;
    for (let i = 0; i < n; i++) {
      const p = pick[i];
      D.set([p.x, p.y, p.z, p.cd], i * 4);
      D.set([p.r, p.g, p.b, Math.min(p.ext, 999) + 1000 * p.beam], C4 + i * 4);
    }
    for (const b of this._bins) b.length = 0;
    for (let i = 0; i < n; i++) {
      const x = pick[i].sx;
      const b0 = Math.max(0, Math.floor((x - halfW) * BINS / size.x)), b1 = Math.min(BINS - 1, Math.floor((x + halfW) * BINS / size.x));
      for (let k = b0; k <= b1; k++) { const bin = this._bins[k]; if (bin.length < SLOTS) bin.push(i); }   // brightest first
    }
    const R2 = C4 * 2;
    D.fill(-1, R2, R2 + BINS * SLOTS);
    for (let k = 0; k < BINS; k++) for (let j = 0; j < this._bins[k].length; j++) D[R2 + k * SLOTS + j] = this._bins[k][j];
    this.texture.needsUpdate = true;
    this.uniforms.uDLInfo.value.set(n, BINS / size.x, 1 / LOOK.sceneUnitLux, 0);
  }

  dispose() { this.texture.dispose(); }
}

function flash(t, period, on, phase) {
  const ph = ((((t - phase) % period) + period) % period);
  return Math.min(1, ph / LED_EDGE_S, 1 - Math.min(Math.max((ph - on) / LED_EDGE_S, 0), 1));
}
