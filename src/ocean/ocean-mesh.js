// Camera-following polar grid for the sea surface (owner: ocean).
//
// Vertex (ring i, column u) sits at radius r_i = s0·((1+a)^i − 1)/a from the camera nadir, so the
// radial spacing grows as s0 + a·r (dense under the camera, geometric further out) and the last
// ring lies past the geometric horizon of the current camera height. Columns are warped toward
// the camera heading (θ = heading + π·(x(1−β) + βx³), x = 2u − 1) so most of them cover the view.
// Everything positional is computed in the vertex shader from uniforms, so the geometry itself is
// static; nothing is world-locked except the texture lookups, which is why the wave field never
// swims (the displacement is also band-limited to the local vertex spacing).
import * as THREE from 'three';
import { EARTH_R } from '../shared.js';

// Grid sizing (ESTIMATED to balance vertex count against the pixel footprint of each view).
const INNER_SPACING_PER_HEIGHT = 0.035;   // s0 = 3.5 % of camera height ...
const INNER_SPACING_MIN = 0.08, INNER_SPACING_MAX = 6;
const HORIZON_MARGIN = 1.15;              // outer radius = 1.15 × geometric horizon ...
const HORIZON_EXTRA_M = 1500;             // ... + 1.5 km
const MIN_RADIUS_M = 4000;
export const HEADING_WARP = 0.55;          // β: column density ahead of the camera is 1/(1−β) × uniform

export function buildPolarGrid(rings, segments) {
  const nv = (rings + 1) * (segments + 1);
  const grid = new Float32Array(nv * 2);
  let k = 0;
  for (let i = 0; i <= rings; i++) for (let j = 0; j <= segments; j++) { grid[k++] = i; grid[k++] = j / segments; }
  // typed arrays throughout: a tier switch rebuilds this grid (up to 225 × 385 vertices) in a few ms
  const idx = new (nv > 65535 ? Uint32Array : Uint16Array)((2 * rings - 1) * segments * 3);
  k = 0;
  for (let i = 0; i < rings; i++) for (let j = 0; j < segments; j++) {
    const a = i * (segments + 1) + j, b = a + 1, c = a + segments + 1, d = c + 1;
    if (i > 0) { idx[k++] = a; idx[k++] = c; idx[k++] = b; }   // ring 0 is the nadir point: one triangle per cell
    idx[k++] = b; idx[k++] = c; idx[k++] = d;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('aGrid', new THREE.BufferAttribute(grid, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 2e5);
  return g;
}

// Solve s0·((1+a)^n − 1)/a = rMax for the growth rate a (bisection; the left side grows with a).
export function ringGrowth(n, s0, rMax) {
  const f = (a) => (a < 1e-9 ? s0 * n : s0 * (Math.pow(1 + a, n) - 1) / a) - rMax;
  if (f(0) >= 0) return 1e-9;
  let lo = 0, hi = 1;
  while (f(hi) < 0) hi *= 2;
  for (let it = 0; it < 60; it++) { const m = 0.5 * (lo + hi); if (f(m) < 0) lo = m; else hi = m; }
  return 0.5 * (lo + hi);
}

// Ring parameters for a camera `height` metres above the local sea surface.
export function ringParams(height, rings) {
  const h = Math.max(height, 1);
  const s0 = THREE.MathUtils.clamp(INNER_SPACING_PER_HEIGHT * h, INNER_SPACING_MIN, INNER_SPACING_MAX);
  const horizon = Math.sqrt(2 * EARTH_R * h + h * h);
  const rMax = Math.max(MIN_RADIUS_M, HORIZON_MARGIN * horizon + HORIZON_EXTRA_M);
  const a = ringGrowth(rings, s0, rMax);
  return { s0, a, rMax, horizon, rings };
}
export function ringRadius(p, i) { return p.s0 * (Math.pow(1 + p.a, i) - 1) / p.a; }
