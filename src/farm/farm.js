// The wind farm (owner: farm): the 200 Atlantic Shores South positions, instancing and LOD of the
// modeller's turbine parts, rotor spin / yaw / idling, the offshore substation, and the night
// lighting (FAA obstruction lights + USCG marine lanterns) as photometric sprites.
//
// Contract (ARCHITECTURE.md "farm/farm.js"; SCENE-SPEC §4.9, §5, §5.1, §6, §13):
//   new Farm(ctx)                  builds everything under one Group (farm.root) in ctx.scene
//   farm.update(dt, t, camera)     per frame, after the atmosphere and before the ocean
//   farm.setWind(u10, fromDeg)     rotor speed, blade pitch, yaw target
//   farm.setPhotoLook(on)          pass-through to turbine.js (photo-look tip bands + stripe)
//   farm.setADLS(on)               aircraft-detection lighting: aviation lights dark (no aircraft)
//   farm.setQuality(q)             LOD distances from a QUALITY tier
//   farm.turbines, farm.hero, farm.pilePositions(), farm.substation, farm.dims, farm.dispose()
//   farm.keepOuts(pos, out?, range?)   camera keep-out volumes near pos (nacelle, cooler, heli deck,
//                                      hub, blades; substation topside and legs), world space
//   farm.resolveKeepOuts(p, clearance) push a point out of them (the shell's camera clamp)
//   farm.lampLight.turbine         the turbine whose lamps currently light its own steel (or null)
//   farm.mirrorRange               metres: reflections drawn into the ocean's mirror (MIRROR_RANGE_M;
//                                  Infinity draws every turbine's, for comparisons)
//   calls ctx.ocean.setPiles(...) once, and ctx.ocean.setDistantLights(...) each night frame if the
//   ocean has it (NightLights.publishDistant)
//
// Frames and matrices are the modeller's (turbine.js composeTurbineMatrices):
//   static  = T(x, baseY, z)                        baseY = −curvatureDrop(x, z): far turbines go hull-down
//   nacelle = T(x, baseY + 146.4, z) · Ry(π − A)    A = compass azimuth the rotor faces (into the wind)
//   rotor   = nacelle · T(0, 5.6, 12) · Rx(−6°) · Rz(−θ)    θ = rotor angle; clockwise seen from upwind
//
// Rendering.
//   LOD 0 and 1: one InstancedMesh per part per LOD (rotors in two roles, operating and feathered);
//     all meshes of one (LOD, frame) share one instance-matrix buffer, rewritten only when a slot or
//     a matrix changed and always into the oldest of a ring of three (see AttributeRing). Shadow
//     casters are packed first and onBeforeShadow trims each draw to them.
//   Far turbines and every mirror image: FarBatch. The farm's own ~300-triangle far turbine (static,
//     nacelle and rotor frames in one geometry, farTurbineGeometry) placed in the vertex shader from
//     the per-turbine pose texture (PoseTexture) and drawn with one diffuse material that widens
//     sub-pixel blades and towers to a minimum width with their true coverage as alpha. All far
//     turbines are ONE draw, and the ocean's mirror pass draws every turbine's reflection (any LOD)
//     within farm.mirrorRange as a second one.
//   Each frame every turbine is culled against the view frustum and against its mirror image, and
//   given a LOD by its FOV-corrected distance. The lamps light the nearest turbine's own steel
//   through its LOD 0 materials (LampIllumination).
import * as THREE from 'three';
import { U, LAYER_REFLECT, EARTH_R, curvatureDrop, mulberry32, registerScale, SCALE_REGISTRY } from '../shared.js';
import {
  TURBINE, NIGHT_LIGHTS, SUBSTATION, SEA, LOOK, SUN, SCALE_TABLE, CAMERA_PRESETS, QUALITY, MARKINGS,
  layoutPositions, rotorRpm, hubWind,
} from '../config.js';
import {
  buildTurbine, buildRotor, createTurbineMaterials, attachTurbineIndex, setPhotoLook, NACELLE_ROOF,
  composeTurbineMatrices, yawForRotorAzimuth, photoLookUniform, photoLookGLSL,
} from '../turbine/turbine.js';
import { buildSubstation } from '../turbine/substation.js';
import { applyAtmosphere } from '../env/fog.js';

const DEG = Math.PI / 180;
const TWO_PI = 2 * Math.PI;
const NL = NIGHT_LIGHTS;
const NAC = TURBINE.nacelle;
const FAR_LOD = 2;   // LOD 0 and 1 are the modeller's (QUALITY lod0/lod1 distances); beyond, the farm's far turbine
// Rotor frame chain (§4.1): shaft tilt and blade cone, as GLSL literals.
const TILT_C = Math.cos(TURBINE.tiltDeg * DEG).toFixed(6), TILT_S = Math.sin(TURBINE.tiltDeg * DEG).toFixed(6);
const CONE_C = Math.cos(TURBINE.coneDeg * DEG).toFixed(6), CONE_S = Math.sin(TURBINE.coneDeg * DEG).toFixed(6);

// ================================================================================================
// Constants (SCENE-SPEC section in brackets; ESTIMATED where no source gives the number)
// ================================================================================================

// Operation [4.9]
const ROTOR_SPEED_TAU_S = 8;           // ESTIMATED: rotor speed follows a wind change with ~8 s lag
const YAW_STATIC_SHARE = 1 / 3;        // ESTIMATED: of the σ = 3° yaw-offset variance, 1/3 is fixed per turbine,
const YAW_DRIFT_PERIODS_S = [[240, 480], [600, 1200]];   // 2/3 drifts as two slow sinusoids (4-8, 10-20 min)
const FEATHER_PITCH_DEG = 90;
const PITCH_STEP_DEG = 2;              // operating pitch is quantised: LOD 0/1 rotor geometry is built once per step
const PITCH_SETTLE_S = 1.0;            // a new operating pitch is applied once the wind has held it this long
// Steady-state blade pitch above rated wind: the NREL 5 MW schedule (Jonkman et al. 2009, Table 7-1)
// against (U_hub − U_rated), applied at the V236's rated wind (TURBINE.ratedWind). ESTIMATED shape for
// the Vestas machine; past the table's end it continues at its last slope.
const PITCH_ABOVE_RATED = [[0, 0], [0.6, 3.8], [1.6, 6.6], [2.6, 8.7], [3.6, 10.5], [4.6, 12.1], [5.6, 13.5],
  [6.6, 14.9], [7.6, 16.2], [8.6, 17.5], [9.6, 18.7], [10.6, 19.9], [11.6, 21.2], [12.6, 22.4], [13.6, 23.5]];

// LOD and culling
const LOD_REFERENCE_VFOV_DEG = CAMERA_PRESETS.drone.vfovDeg;   // QUALITY lod distances hold at the reference FOV
const LOD_HYSTERESIS = 0.05;           // ±5 % around each LOD distance so turbines do not flicker between LODs
const CULL_CENTRE_Y = 135;             // bounding sphere of one turbine (static frame), covering the TP skirt
const CULL_RADIUS = 150;               //   (−15 m) to the tip height (270.6 m) and the ±118 m rotor sideways
// A LOD 0 turbine draws its rotor with LOD 0 blades only while the blade's maximum chord spans at
// least this many pixels; below it the LOD 1 blades' facets (7 per airfoil surface, 34 ribs) are
// ≤ 2 px and indistinguishable, and the LOD 0 rotor's 96k triangles were the farm's largest cost
// (round 2, drone view: ~1.3 ms for a hero whose chord spans 12 px). Tower, TP, rails, ID and lamps
// keep the config LOD.
const ROTOR_DETAIL_PX = 16;
const BLADE_MAX_CHORD = Math.max(...TURBINE.blade.map((row) => row[2]));
// Far turbines never draw narrower than this (px); their coverage becomes alpha. Same value as the
// modeller's thin features (turbine.js THIN_MIN_PX: every pixel row of a 1.5 px band holds an MSAA sample).
const FAR_MIN_PX = 1.5;
// The ocean's mirror draws a turbine's reflection only within this distance (true distance, or the
// FOV-corrected one when that is longer: a telephoto keeps more). Beyond 20 km (haze transmittance 0.55,
// config ATMOS.transmittanceCheck) the reflection streaks are at the frame-to-frame noise floor (round 3,
// against every turbine in the mirror: drone at 760 and 1600 px, overview; no pixel off by more than 8
// levels, as between two identical frames). Every reflection uses the far turbine: the hero's in the
// close blitz view looks the same as with its LOD 0 geometry (half-resolution, wave-spread image).
const MIRROR_RANGE_M = 20000;

// Nacelle-top boxes (yaw frame), shared by the camera keep-outs, the glare occlusion and the lamp
// light: the nacelle box (config TURBINE.nacelle: x ±4.5, y 1 … 12, z −10 … +9) and the modeller's
// roof furniture (turbine.js NACELLE_ROOF: cooler 7 × 5.5 × 1.8 m with radiator panels on all four
// sides; heli-hoist deck 9 × 3 m with its frame, overhanging the rear wall).
const NACELLE_BOX = [[-NAC.width / 2, NAC.floorY, NAC.boxRearZ], [NAC.width / 2, NAC.floorY + NAC.height, NAC.boxFrontZ]];
const COOLER_BOX = NACELLE_ROOF.cooler;
const HELI_BOX = NACELLE_ROOF.heliDeck;
const growBox = (b, d) => [b[0].map((v) => v - d), b[1].map((v) => v + d)];

// Camera keep-outs (keepOuts / resolveKeepOuts): true surfaces, the caller adds its clearance.
const KEEP_OUT_RANGE_M = 400;          // turbines whose axis is this close (horizontal) to the camera
const KEEP_HUB_R = 4.5;                // hub + spinner (Ø7.5 m, nose 3.5 m ahead of the hub centre)
// Blade capsules along the pitch axis: span r0, r1 (m from the hub centre), radius ≥ half the chord (§4.3).
const KEEP_BLADE = [[TURBINE.hubRadius, 20, 3.0], [20, 60, 2.4], [60, TURBINE.hubRadius + TURBINE.bladeLength, 1.4]];
const KEEP_LEG_MIN_R = 1.1;            // jacket legs (Ø2.4 m) against braces and J-tubes at a section

// Marine-light classes [5.1]: extra SPS wherever consecutive SPS along the perimeter exceed 3 nm.
const SPS_MAX_GAP_M = 5556;

// Night lights [13]
const SCENE_LUX = LOOK.sceneUnitLux;                        // 1 scene illuminance unit = 25,000 lx
const LED_EDGE_S = 0.05;                                    // LED rise / fall time (task brief: ~50 ms)
// Flash phase: every flashing class starts FLASH_LEAD_S before t mod period = 0, so animation time
// t = 0 (the team's frozen reference frames) falls inside every class's on-time (the shortest,
// SPS Q Y, is on for 0.3 s). FAA / USCG ask only for synchronised lights, not an absolute phase;
// the classes stay mutually synchronised. L-864s are on for t mod 2 in [1.9, 2) ∪ [0, 0.4).
const FLASH_LEAD_S = 0.1;
const AVIATION_ON_BELOW_DEG = -0.5;                         // photocell: FAA lights switch to night mode
const MARINE_ON_BELOW_DEG = -SUN.angularRadiusRad / DEG;    // sunset → sunrise: apparent upper limb below the horizon
const MARINE_BEAM_FWHM_DEG = NL.marine.beamFWHMDeg;   // vertical divergence of the LED lanterns (config; the ocean reads the same)
const MARINE_BEAM_FLOOR = NL.marine.beamFloor;   // relative intensity well outside the beam (lens glow; config, the ocean reads it too)
// Lens glare around a lamp: HALO_FRACTION of its light in the profile (1 + (θ/θ0)²)^−2. ESTIMATED look. Round 4
// (jury: "nacelle beacons render as big glowing discs"): 2 % at θ0 0.5 mrad saturated into a red disc ~10 px
// across round each L-864 at 774 m on a moonless night; 0.45 % at 0.3 mrad leaves a white point with a ~2 px
// red glow. The wide glow is the post bloom's (screen space, so foreground blades do not cut it).
const HALO_FRACTION = 0.0045;
const HALO_THETA0_RAD = 0.3e-3;
const HALO_VISIBLE_EXPOSED = 0.01;     // the halo sprite reaches out to where it falls below this exposed radiance
const CORE_SIGMA_MIN_PX = 0.6;         // an unresolved lamp is a round Gaussian of this sigma (at least) with the
                                       //   lens's integrated intensity: saturated at night it stays a round dot
const CORE_VISIBLE_EXPOSED = 0.002;    // the lamp sprite reaches out to where its footprint falls below this
const QUAD_MAX_PX = 72;                // largest sprite half-size in pixels (bounds fill rate for close lamps)
const DEPTH_BIAS_M = 0.4;              // sprite drawn this far in front of the lamp centre (lens domes ≤ 0.15 m)
const SCINT_MAX = 0.35;                // ESTIMATED: relative scintillation of a lamp over a long sea path,
const SCINT_RANGE_M = 8000;            //   growing as 1 − exp(−d/range): 4 % at 1 km, 25 % at 10 km
// Lamp colours, ESTIMATED inside the standard chromaticity regions: aviation red (FAA AC 150/5345-43,
// LED L-864 / L-810) at CIE (x, y) = (0.690, 0.300) and marine yellow (IALA E-200-1) at (0.560, 0.430),
// as linear sRGB of unit luminance (sRGB matrix from XYZ, negatives clipped).
const RED = [4.7037, 0, 0], YELLOW = [2.6509, 0.6102, 0];
// Flash classes: index into the shader's uLevel[].
const LAMP = { aviationFlash: 0, aviationSteady: 1, SPS: 2, IPS: 3, inner: 4, interior: 5 };
const LAMP_CLASS_COUNT = 6;
// Beam kinds (aLamp.w): aviation, marine, and aviation on the nacelle (position in the yaw frame).
const BEAM = { aviation: 0, marine: 1, nacelle: 2 };

// ================================================================================================
// Helpers
// ================================================================================================
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const wrap180 = (d) => ((d % 360) + 540) % 360 - 180;
// GLSL literals from JS numbers.
const f = (v, d = 3) => v.toFixed(d);
const v3 = (a, d = 2) => `vec3(${a.map((x) => x.toFixed(d)).join(', ')})`;

function interp1(pairs, x) {
  if (x <= pairs[0][0]) return pairs[0][1];
  let i = 1;
  while (i < pairs.length - 1 && x > pairs[i][0]) i++;
  const [x0, y0] = pairs[i - 1], [x1, y1] = pairs[i];
  return y0 + (y1 - y0) * (x - x0) / (x1 - x0);      // extrapolates past the last pair along its slope
}
function gaussian(rng) { return Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(TWO_PI * rng()); }

// Flash level 0..1: the flash starts at t mod period = −FLASH_LEAD_S, lasts onS, with LED rise/fall edges.
function flashLevel(t, periodS, onS) {
  const ph = (((t + FLASH_LEAD_S) % periodS) + periodS) % periodS;
  return Math.min(1, ph / LED_EDGE_S, 1 - clamp((ph - onS) / LED_EDGE_S, 0, 1));
}

// Operating blade pitch (deg) at a hub-height wind, quantised to PITCH_STEP_DEG.
function operatingPitchDeg(uHub) {
  const p = Math.max(0, interp1(PITCH_ABOVE_RATED, uHub - TURBINE.ratedWind));
  return Math.round(p / PITCH_STEP_DEG) * PITCH_STEP_DEG;
}

// ================================================================================================
// Layout classification [5.1]
// ================================================================================================
// A perimeter turbine misses at least one of its four lattice neighbours (±a, ±b). Corners (one
// missing along a AND one along b) are significant peripheral structures (SPS), the rest of the
// perimeter intermediate (IPS); turbines 4-adjacent to the perimeter form the inner boundary; the
// rest are interior. On the ASOW layout this gives 24 / 32 / 42 / 102, the counts SCENE-SPEC §5.1
// states. SPS are then added along long straight edges so that consecutive SPS are never more than
// 3 nm apart: on this layout the perimeter walk below (addSpsOnLongEdges) promotes EXTRA_SPS. The
// shipped build uses that result; dev builds re-derive it and warn if the layout no longer gives it.
const EXTRA_SPS = ['B10', 'B13', 'F22', 'G24', 'H06'];
function classifyLayout(pos) {
  const at = new Map(pos.map((p, k) => [`${p.di},${p.dj}`, k]));
  const has = (i, j) => at.has(`${i},${j}`);
  const cls = pos.map((p) => {
    const missA = !has(p.di - 1, p.dj) || !has(p.di + 1, p.dj);
    const missB = !has(p.di, p.dj - 1) || !has(p.di, p.dj + 1);
    return missA && missB ? 'SPS' : (missA || missB ? 'IPS' : null);
  });
  const cornerCount = cls.filter((c) => c === 'SPS').length;
  pos.forEach((p, k) => {
    if (cls[k]) return;
    const nearPerimeter = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => {
      const n = at.get(`${p.di + a},${p.dj + b}`);
      return n !== undefined && (cls[n] === 'SPS' || cls[n] === 'IPS');
    });
    cls[k] = nearPerimeter ? 'inner' : 'interior';
  });
  if (globalThis.NJOW_DEV !== false) {
    const derived = addSpsOnLongEdges(pos, cls.slice(), perimeterCycle(pos, has)).map((k) => pos[k].id).sort();
    if (derived.join() !== EXTRA_SPS.join()) console.warn(`[farm] the layout's 3 nm SPS additions are now ${derived.join(', ')} (EXTRA_SPS: ${EXTRA_SPS.join(', ')})`);
  }
  const added = pos.map((p, k) => k).filter((k) => EXTRA_SPS.includes(pos[k].id));
  for (const k of added) cls[k] = 'SPS';
  return { cls, cornerCount, added };
}

// Perimeter turbines in clockwise order. Every missing neighbour contributes one directed boundary
// edge of the turbine's lattice cell (di east, dj south); chaining them, left turn first so that a
// diagonal pinch point keeps the walk on the outer loop, traces the outline of the array.
function perimeterCycle(pos, has) {
  const edges = new Map();
  const add = (x0, y0, x1, y1, k, dir) => {
    const s = `${x0},${y0}`;
    if (!edges.has(s)) edges.set(s, []);
    edges.get(s).push({ x0, y0, x1, y1, k, dir, used: false });
  };
  pos.forEach(({ di: i, dj: j }, k) => {
    if (!has(i, j - 1)) add(i, j, i + 1, j, k, 0);             // north side, heading east
    if (!has(i + 1, j)) add(i + 1, j, i + 1, j + 1, k, 1);     // east side, heading south
    if (!has(i, j + 1)) add(i + 1, j + 1, i, j + 1, k, 2);     // south side, heading west
    if (!has(i - 1, j)) add(i, j + 1, i, j, k, 3);             // west side, heading north
  });
  let edge = null;                                              // start: north side of the top-left cell
  for (const list of edges.values()) for (const e of list) {
    if (e.dir === 0 && (!edge || e.y0 < edge.y0 || (e.y0 === edge.y0 && e.x0 < edge.x0))) edge = e;
  }
  const order = [];
  while (edge && !edge.used) {
    edge.used = true;
    if (!order.includes(edge.k)) order.push(edge.k);
    const out = (edges.get(`${edge.x1},${edge.y1}`) || []).filter((o) => !o.used), dir = edge.dir;
    edge = null;
    for (const turn of [3, 0, 1]) if ((edge = out.find((o) => o.dir === (dir + turn) % 4))) break;   // left, straight, right
  }
  return order;
}

// Between consecutive SPS along the perimeter that are more than 3 nm apart, promote the fewest
// perimeter turbines to SPS (found greedily), spread as evenly as the lattice allows along the edge.
function addSpsOnLongEdges(pos, cls, order) {
  const dist = (a, b) => Math.hypot(pos[a].x - pos[b].x, pos[a].z - pos[b].z);
  const first = order.findIndex((k) => cls[k] === 'SPS');
  const cyc = order.slice(first).concat(order.slice(0, first));
  const spsAt = cyc.map((k, i) => (cls[k] === 'SPS' ? i : -1)).filter((i) => i >= 0);
  const added = [];
  for (let m = 0; m < spsAt.length; m++) {
    const ia = spsAt[m], ib = m + 1 < spsAt.length ? spsAt[m + 1] : cyc.length;
    const run = cyc.slice(ia, ib).concat([cyc[ib % cyc.length]]);      // SPS, candidates…, next SPS
    if (dist(run[0], run[run.length - 1]) <= SPS_MAX_GAP_M) continue;
    const greedy = greedyPicks(run, dist);
    const picks = evenPicks(run, dist, greedy.length) || greedy;
    for (const i of picks) { cls[run[i]] = 'SPS'; added.push(run[i]); }
  }
  return added;
}
function greedyPicks(run, dist) {
  const last = run.length - 1, picks = [];
  let cur = 0;
  while (dist(run[cur], run[last]) > SPS_MAX_GAP_M) {
    let best = -1, bestD = -1;
    for (let i = cur + 1; i < last; i++) {
      const d = dist(run[cur], run[i]);
      if (d <= SPS_MAX_GAP_M && d > bestD) { bestD = d; best = i; }
    }
    if (best < 0) best = cur + 1;
    if (best >= last) break;
    picks.push(cur = best);
  }
  return picks;
}
function evenPicks(run, dist, n) {
  const last = run.length - 1, cum = [0], picks = [];
  for (let i = 1; i <= last; i++) cum.push(cum[i - 1] + dist(run[i - 1], run[i]));
  for (let k = 1; k <= n; k++) {
    const target = cum[last] * k / (n + 1);
    let best = 1;
    for (let i = 2; i < last; i++) if (Math.abs(cum[i] - target) < Math.abs(cum[best] - target)) best = i;
    if (picks.length && best <= picks[picks.length - 1]) return null;
    picks.push(best);
  }
  const stops = [0, ...picks, last];
  for (let i = 1; i < stops.length; i++) if (dist(run[stops[i - 1]], run[stops[i]]) > SPS_MAX_GAP_M) return null;
  return picks;
}

// ================================================================================================
// Waterline sections of the substation jacket, measured from its marine-growth band geometry:
// every triangle edge crossing the mean sea level (local y = `level`, default 0) gives a point on a waterline
// contour, and the points of one connected piece of mesh (one tube: leg, J-tube or brace) form one
// section. Returns { x, z, radius } per section in the group's local frame (radius = mean distance
// of the contour from its centre; an oblique brace gives an ellipse, reported by that mean).
// ================================================================================================
function waterlineSections(group, material, level = 0) {
  const out = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  group.traverse((o) => {
    if (!o.isMesh || o.material !== material) return;
    const P = o.geometry.getAttribute('position'), idx = o.geometry.index;
    const vi = (n) => (idx ? idx.getX(n) : n);
    const triangles = (idx ? idx.count : P.count) / 3;
    // Connected pieces: union-find over the vertices of every triangle.
    const parent = new Int32Array(P.count).map((_, i) => i);
    const find = (i) => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
    for (let t = 0; t < triangles; t++) {
      const r0 = find(vi(3 * t));
      parent[find(vi(3 * t + 1))] = r0;
      parent[find(vi(3 * t + 2))] = r0;
    }
    const pieces = new Map();
    for (let t = 0; t < 3 * triangles; t++) {
      const i0 = vi(t), i1 = vi(t % 3 === 2 ? t - 2 : t + 1);
      a.fromBufferAttribute(P, i0).applyMatrix4(o.matrix);
      b.fromBufferAttribute(P, i1).applyMatrix4(o.matrix);
      if ((a.y < level) === (b.y < level)) continue;
      const k = (a.y - level) / (a.y - b.y), root = find(i0);
      if (!pieces.has(root)) pieces.set(root, []);
      pieces.get(root).push([a.x + (b.x - a.x) * k, a.z + (b.z - a.z) * k]);
    }
    for (const g of pieces.values()) {
      if (g.length < 6) continue;
      const cx = g.reduce((s, p) => s + p[0], 0) / g.length, cz = g.reduce((s, p) => s + p[1], 0) / g.length;
      out.push({ x: cx, z: cz, radius: g.reduce((s, p) => s + Math.hypot(p[0] - cx, p[1] - cz), 0) / g.length });
    }
  });
  return out;
}

// ================================================================================================
// Per-frame GPU data goes through a ring of buffers. Rewriting a buffer that the GPU is still
// reading for an earlier frame stalls ANGLE's Metal backend: measured with timer queries in
// dev/farm.html, one moving 3.8k-triangle nacelle mesh cost ~20 ms of GPU time per frame when its
// single instance buffer was updated in place, and nothing when it was not. Each update therefore
// writes the buffer used RING_DEPTH frames ago.
// ================================================================================================
const RING_DEPTH = 3;
class AttributeRing {
  /** @param {function} [make] creates one attribute (default: a dynamic Float32 InstancedBufferAttribute) */
  constructor(itemSize, count, make = null) {
    this.attrs = Array.from({ length: RING_DEPTH }, () => {
      if (make) return make();
      const a = new THREE.InstancedBufferAttribute(new Float32Array(count * itemSize), itemSize);
      return a.setUsage(THREE.DynamicDrawUsage);
    });
    this.index = 0;
  }
  get current() { return this.attrs[this.index]; }
  /** Hand every buffer of the ring to `geometry`, so that its dispose() also frees their GL buffers
   *  (three.js frees only the attributes a geometry or mesh holds at dispose time). */
  attachForRelease(geometry, name) { this.attrs.forEach((a, i) => geometry.setAttribute(`${name}Ring${i}`, a)); }
  /** Copy `data[0 .. n·itemSize)` into the next buffer of the ring and return it. */
  push(data, n) {
    this.index = (this.index + 1) % RING_DEPTH;
    const a = this.attrs[this.index], len = n * a.itemSize;
    a.array.set(len === data.length ? data : data.subarray(0, len));
    a.clearUpdateRanges();
    a.addUpdateRange(0, len);
    a.needsUpdate = true;
    return a;
  }
}

// Per-turbine pose for the GPU (far batches, lamp positions, glare occlusion), a float texture W × 2
// with W = turbines + 1: texel (i, 0) = (x, baseY, z, yaw rad), (i, 1) = (rotor angle rad, blade
// pitch rad, 0, 0); texel (N, 0) is the substation's position (its far mesh is baked in its own
// orientation). One texture per ring slot, as AttributeRing.
class PoseTexture {
  constructor(width) {
    this.width = width;
    this.data = new Float32Array(width * 8);
    this.textures = Array.from({ length: RING_DEPTH }, () => new THREE.DataTexture(new Float32Array(width * 8), width, 2, THREE.RGBAFormat, THREE.FloatType));
    this.index = 0;
    this.uniform = { value: this.textures[0] };
    this.push();
  }
  push() {
    this.index = (this.index + 1) % RING_DEPTH;
    const t = this.uniform.value = this.textures[this.index];
    t.image.data.set(this.data);
    t.needsUpdate = true;
  }
  dispose() { for (const t of this.textures) t.dispose(); }
}

// ================================================================================================
// InstanceSet: the InstancedMeshes of one part list (LOD 0 or 1, one frame) sharing one matrix
// buffer, in the view only (their mirror images are the FarBatches').
// ================================================================================================
class InstanceSet {
  /** @param {Array} parts modeller part list ({ name, geometry, material, castShadow, receiveShadow }) */
  constructor(parts, capacity, root, name) {
    this.count = 0;
    this.casters = 0;
    this.slots = new Int32Array(capacity).fill(-1);            // turbine index in each slot
    this.data = new Float32Array(capacity * 16);               // CPU copy of the slots' matrices
    this.matrices = new AttributeRing(16, capacity);
    this.idData = this.idRing = this.idGeometry = null;        // aTurbineIndex of the painted-ID part
    const set = this;
    this.meshes = parts.map((part) => {
      const mesh = new THREE.InstancedMesh(part.geometry, part.material, capacity);
      mesh.name = `${name}.${part.name}`;
      mesh.instanceMatrix = this.matrices.current;
      mesh.visible = false;                                     // until commit() sets count and visibility
      mesh.frustumCulled = false;                               // culled per instance on the CPU
      mesh.receiveShadow = part.receiveShadow;
      mesh.userData.castsShadow = part.castShadow;
      // The shadow pass draws only the leading `casters` instances.
      mesh.onBeforeShadow = function () { this.count = set.casters; };
      mesh.onAfterShadow = function () { this.count = set.count; };
      if (part.name === 'idMarkings') {
        // turbine.js's per-instance ID index, one attribute per ring slot
        this.idGeometry = part.geometry;
        this.idRing = new AttributeRing(1, capacity, () => attachTurbineIndex(part.geometry, capacity));
        part.geometry.setAttribute('aTurbineIndex', this.idRing.current);
        this.idData = new Float32Array(capacity);
      }
      root.add(mesh);
      return mesh;
    });
  }

  /**
   * Fill the slots from `list` (turbine indices, shadow casters first) with each turbine's matrix
   * `key`, uploading only when a slot or a matrix changed (static slots, parked rotors and frozen
   * frames then cost nothing).
   */
  commit(list, n, casters, turbines, key) {
    let changed = n !== this.count;
    for (let s = 0; s < n; s++) if (this.slots[s] !== list[s]) { this.slots[s] = list[s]; changed = true; }
    this.count = n;
    this.casters = casters;
    let dirty = changed;
    const d = this.data;
    for (let s = 0; s < n; s++) {
      const e = turbines[list[s]].m[key].elements, o = s * 16;
      for (let i = 0; i < 16; i++) {
        const v = Math.fround(e[i]);
        if (d[o + i] !== v) { d[o + i] = v; dirty = true; }
      }
    }
    if (dirty && n > 0) {
      const attr = this.matrices.push(d, n);
      for (const mesh of this.meshes) mesh.instanceMatrix = attr;
    }
    if (changed && n > 0 && this.idRing) {
      this.idData.set(list.subarray(0, n));
      this.idGeometry.setAttribute('aTurbineIndex', this.idRing.push(this.idData, n));
    }
    for (const mesh of this.meshes) {
      mesh.count = n;
      mesh.visible = n > 0;
      mesh.castShadow = mesh.userData.castsShadow && casters > 0;
    }
  }

  /** Swap in new geometry with the same part structure (the operating rotor at a new pitch). */
  setGeometry(parts) { parts.forEach((part, i) => { this.meshes[i].geometry = part.geometry; }); }

  // Geometries are disposed by their owner; the ring buffers ride along on the first part's
  // geometry so that its disposal frees them.
  dispose(root) {
    if (this.meshes.length) this.matrices.attachForRelease(this.meshes[0].geometry, 'instanceMatrix');
    if (this.idRing) this.idRing.attachForRelease(this.idGeometry, 'aTurbineIndex');
    for (const mesh of this.meshes) { root.remove(mesh); mesh.dispose(); }
    this.meshes.length = 0;
  }
}

// ================================================================================================
// Far turbines (FarBatch). Beyond the LOD 1 distance a turbine is 60 px tall at most and its blades
// and tower fall below a pixel; drawn as ordinary geometry they break into MSAA dashes, and the
// modeller's geometry and materials spend almost all of their time on surfaces smaller than a pixel. So:
//   - one geometry holds all three frames (farTurbineGeometry): each vertex knows its frame, and
//     the vertex shader places it from the turbine's pose texel (the modeller's frame chain; blades
//     are pitched in the shader about their own pitch axis, so one geometry serves every pitch and
//     the feathered idle rotors);
//   - every far turbine is one instance of one draw; the ocean's mirror pass draws the same geometry
//     as a second draw with its own list (every reflection in its view, LOD 0 and 1 turbines too);
//   - thin features are widened to FAR_MIN_PX across their centre line (blades about their pitch
//     axis, tower, TP and platform about their column, spinner about the rotor axis, nacelle boxes
//     about their vertical centre line) and drawn with alpha = true width / drawn width, so a 0.3 px
//     blade is a continuous stroke of 20 % coverage, as a camera sensor records it;
//   - the material is the standard material with diffuse light only (sun, moon and the sky's IBL
//     irradiance, cloud shadow, aerial perspective per pixel). Specular reflection of a matte
//     RAL 7035 surface a pixel wide is a few percent of its radiance; dropping it cut the far LOD's
//     cost ~3× (amplified A/B, round 2 notes). The base colour comes per vertex from the parts'
//     materials. No shadows are cast or received (sub-pixel at these distances).
// ================================================================================================
const FAR_VIEWPORT_H = { value: 900 };   // height (px) of the target being drawn; set per draw
const FAR_VERTEX_DECL = /* glsl */`
attribute float aFarIndex;
attribute float aFarPart;
attribute float aBand;
attribute vec3 aThinAxis;
attribute vec3 aThinChord;
attribute vec4 aThinSpan;
uniform highp sampler2D uTurbineState;
uniform float uThinViewportH;
varying float vThinCover;
varying float vFarBand;
mat3 farAxisRot(vec3 a, float t) {
	float c = cos(t), s = sin(t), k = 1.0 - c;
	return mat3(c + k * a.x * a.x, k * a.x * a.y + s * a.z, k * a.x * a.z - s * a.y,
		k * a.x * a.y - s * a.z, c + k * a.y * a.y, k * a.y * a.z + s * a.x,
		k * a.x * a.z + s * a.y, k * a.y * a.z - s * a.x, c + k * a.z * a.z);
}
`;
// Frame of this vertex (world = farT + farR · local): aFarPart 0 static, 1 nacelle (yaw frame),
// 2 rotor, 3 + k blade k (rotor frame, pitched about its cone-tilted pitch axis).
const FAR_POSE = /* glsl */`
ivec2 farTx = ivec2(int(aFarIndex + 0.5), 0);
vec4 farS0 = texelFetch(uTurbineState, farTx, 0);
vec4 farS1 = texelFetch(uTurbineState, farTx + ivec2(0, 1), 0);
vec3 farT = farS0.xyz;
mat3 farR = mat3(1.0);
if (aFarPart > 0.5) {
	float cy = cos(farS0.w), sy = sin(farS0.w);
	farR = mat3(cy, 0.0, -sy, 0.0, 1.0, 0.0, sy, 0.0, cy);
	farT.y += ${f(TURBINE.stack.towerTop, 2)};
	if (aFarPart > 1.5) {
		farT += farR * ${v3(TURBINE.hubCentre)};
		float cs = cos(farS1.x), ss = sin(farS1.x);
		farR *= mat3(1.0, 0.0, 0.0, 0.0, ${TILT_C}, -${TILT_S}, 0.0, ${TILT_S}, ${TILT_C}) * mat3(cs, ss, 0.0, -ss, cs, 0.0, 0.0, 0.0, 1.0);
		if (aFarPart > 2.5) {
			float k = (aFarPart - 3.0) * 2.0943951;
			farR *= farAxisRot(vec3(sin(k) * ${CONE_C}, cos(k) * ${CONE_C}, ${CONE_S}), -farS1.y);
		}
	}
}
vec3 objectNormal = farR * normal;
`;
// Widening across the feature's centre line (view space): the projected width of the section
// (ellipse of half-extents |chord| and b about the span) sets the stretch k ≥ 1 of the vertex's
// offset from the centre line along the screen direction across the span. Depth is untouched.
const FAR_PROJECT = /* glsl */`
vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
vThinCover = 1.0;
vec3 farCh = mat3(modelViewMatrix) * (farR * aThinChord);
vec3 farSp = mat3(modelViewMatrix) * (farR * aThinSpan.xyz);
float farTa = length(farCh), farSl = length(farSp);
if (max(farTa, aThinSpan.w) > 1e-6 && farSl > 1e-6) {
	vec3 axV = (modelViewMatrix * vec4(farT + farR * aThinAxis, 1.0)).xyz;
	farSp /= farSl;
	vec3 e = cross(axV, farSp);
	float eL = length(e);
	if (eL > 1e-4 * length(axV)) {
		e /= eL;
		vec3 ch = farTa > 1e-6 ? farCh / farTa : normalize(cross(farSp, e));
		float halfW = length(vec2(farTa * dot(ch, e), aThinSpan.w * dot(cross(farSp, ch), e)));
		float k = clamp(${f(FAR_MIN_PX / 2)} * max(-axV.z, 1e-3) / max(halfW * projectionMatrix[1][1] * uThinViewportH * 0.5, 1e-6), 1.0, 400.0);
		mvPosition.xyz += e * dot(mvPosition.xyz - axV, e) * (k - 1.0);
		vThinCover = 1.0 / k;
	}
}
gl_Position = projectionMatrix * mvPosition;
`;
// Diffuse only: direct lights through a Lambert term, and no specular IBL (r180 adds the IBL
// irradiance inside RE_IndirectSpecular, so it is moved into the plain irradiance instead; see
// createFarMaterial's lights_fragment_maps patch).
const FAR_DIFFUSE_ONLY = /* glsl */`
#undef RE_Direct
#define RE_Direct RE_Direct_Far
#undef RE_IndirectSpecular
void RE_Direct_Far(const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight) {
	reflectedLight.directDiffuse += saturate(dot(geometryNormal, directLight.direction)) * directLight.color * BRDF_Lambert(material.diffuseColor);
}
`;

function createFarMaterial(poseUniform) {
  const m = new THREE.MeshStandardMaterial({ name: 'farm.far', vertexColors: true, roughness: 1, metalness: 0, transparent: true, depthWrite: true });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, { uTurbineState: poseUniform, uThinViewportH: FAR_VIEWPORT_H, uPhotoLook: photoLookUniform });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${FAR_VERTEX_DECL}`)
      .replace('#include <beginnormal_vertex>', FAR_POSE)
      .replace('#include <begin_vertex>', 'vec3 transformed = farT + farR * position;\nvFarBand = aBand;')
      .replace('#include <project_vertex>', FAR_PROJECT);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uPhotoLook;\nvarying float vThinCover;\nvarying float vFarBand;')
      .replace('#include <lights_physical_pars_fragment>', `#include <lights_physical_pars_fragment>\n${FAR_DIFFUSE_ONLY}`)
      .replace('#include <lights_fragment_maps>', '#include <lights_fragment_maps>\nirradiance += iblIrradiance;')
      .replace('#include <color_fragment>', `#include <color_fragment>\n${photoLookGLSL('diffuseColor.rgb', 'vFarBand')}\ndiffuseColor.a *= vThinCover;`);
  };
  m.customProgramCacheKey = () => 'farm-far-v2';
  return applyAtmosphere(m);
}

// ------------------------------------------------------------------------------------------------
// FarBuilder: the vertices of a FarBatch geometry. Each carries its frame (aFarPart, see FAR_POSE),
// base colour, photo-look band and thin-feature data (centre-line point, chord half-vector, span
// direction + half-thickness; all zero: never widened).
// ------------------------------------------------------------------------------------------------
const FAR_SIDES = 6;
const FAR_ATTRIBUTES = { position: 3, normal: 3, color: 3, aBand: 1, aFarPart: 1, aThinAxis: 3, aThinChord: 3, aThinSpan: 4 };
const ZERO3 = [0, 0, 0], ZERO4 = [0, 0, 0, 0];
class FarBuilder {
  constructor() {
    this.data = Object.fromEntries(Object.keys(FAR_ATTRIBUTES).map((k) => [k, []]));
    this.index = [];
    this.count = 0;
  }
  vert(part, colour, band, p, n, axis = p, chord = ZERO3, span = ZERO4) {
    const D = this.data;
    D.position.push(...p); D.normal.push(...n); D.color.push(colour.r, colour.g, colour.b); D.aBand.push(band); D.aFarPart.push(part);
    D.aThinAxis.push(...axis); D.aThinChord.push(...chord); D.aThinSpan.push(...span);
    return this.count++;
  }
  // Triangle wound so that its face normal agrees with its vertex normals (as turbine.js PartBuilder).
  tri(a, b, c) {
    const P = this.data.position, N = this.data.normal, e = (i, k) => P[3 * i + k];
    const u = [0, 1, 2].map((k) => e(b, k) - e(a, k)), w = [0, 1, 2].map((k) => e(c, k) - e(a, k));
    let s = 0;
    for (let k = 0; k < 3; k++) s += (u[(k + 1) % 3] * w[(k + 2) % 3] - u[(k + 2) % 3] * w[(k + 1) % 3]) * (N[3 * a + k] + N[3 * b + k] + N[3 * c + k]);
    this.index.push(a, ...(s >= 0 ? [b, c] : [c, b]));
  }
  quad(a, b, c, d) { this.tri(a, b, c); this.tri(b, d, c); }      // a-b one edge, c-d the next
  // A band of FAR_SIDES-gons about the vertical axis (static frame) or the rotor axis (zAxis). Rings:
  // [h, r, R, cap]: position h along the axis, radius r; R the thin radius (default r); cap ±1: the
  // ring's normals point along the axis (a flat end) instead of radially.
  rings(part, colour, list, zAxis = false) {
    const base = this.count;
    for (const [h, r, R = r, cap = 0] of list) for (let j = 0; j < FAR_SIDES; j++) {
      const c = Math.cos(TWO_PI * j / FAR_SIDES), s = Math.sin(TWO_PI * j / FAR_SIDES);
      const ax = zAxis ? [0, 0, h] : [0, h, 0], n = cap ? (zAxis ? [0, 0, cap] : [0, cap, 0]) : (zAxis ? [c, s, 0] : [c, 0, s]);
      this.vert(part, colour, 0, zAxis ? [r * c, r * s, h] : [r * c, h, r * s], n, ax, [R, 0, 0], zAxis ? [0, 0, 1, R] : [0, 1, 0, R]);
    }
    for (let k = 1; k < list.length; k++) for (let j = 0; j < FAR_SIDES; j++) {
      const i = base + (k - 1) * FAR_SIDES, jn = (j + 1) % FAR_SIDES;
      this.quad(i + j, i + jn, i + FAR_SIDES + j, i + FAR_SIDES + jn);
    }
  }
  // A flat-faced box [min, max] (vertices at its floor take colour `low`); its thin proxy is the box about
  // its vertical centre line.
  box(part, colour, [lo, hi], low = colour) {
    const c = lo.map((v, k) => (v + hi[k]) / 2), h = hi.map((v, k) => (v - lo[k]) / 2);
    for (let k = 0; k < 3; k++) for (const sgn of [-1, 1]) {
      const n = [0, 0, 0], k1 = (k + 1) % 3, k2 = (k + 2) % 3;
      n[k] = sgn;
      const ids = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b]) => {
        const v = c.slice();
        v[k] += sgn * h[k]; v[k1] += a * h[k1]; v[k2] += b * h[k2];
        return this.vert(part, v[1] > lo[1] ? colour : low, 0, v, n, [c[0], v[1], c[2]], [h[0], 0, 0], [0, 1, 0, h[2]]);
      });
      this.quad(...ids);
    }
  }
  // A modeller mesh (static frame, `matrix` baked in), never widened.
  mesh(geometry, colour, matrix) {
    const P = geometry.attributes.position, N = geometry.attributes.normal, I = geometry.index, base = this.count;
    const nm = new THREE.Matrix3().getNormalMatrix(matrix), v = new THREE.Vector3(), n = new THREE.Vector3();
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i).applyMatrix4(matrix);
      n.fromBufferAttribute(N, i).applyMatrix3(nm).normalize();
      this.vert(0, colour, 0, v.toArray(), n.toArray(), ZERO3);
    }
    for (let k = 0; k < (I ? I.count : P.count); k++) this.index.push(base + (I ? I.getX(k) : k));
  }
  build() {
    const g = new THREE.InstancedBufferGeometry();
    for (const [k, size] of Object.entries(FAR_ATTRIBUTES)) g.setAttribute(k, new THREE.Float32BufferAttribute(this.data[k], size));
    g.setIndex(this.index);
    return g;
  }
}

// ------------------------------------------------------------------------------------------------
// The far turbine. Even the modeller's coarsest LOD has 1.8k triangles, nearly all smaller than a
// pixel beyond the LOD 1 distance, and a far turbine costs its triangle count, not its shading
// (round 2, drone view: drawing 12 triangles per far instance cost the same as not drawing the far
// batch; drawing half of them saved 60 %). So the far batch draws this ~300-triangle turbine,
// built from the same config numbers (TURBINE: tower profile, TP and growth band, platform, nacelle
// box with the modeller's roof furniture, spinner, blade planform with twist, prebend, pitch axis,
// cone and the photo-look band edges). Silhouette and size are the modeller's; what is below a
// pixel at 4 km (rails, brackets, ladders, flanges, airfoil camber, the nacelle stripe) is left
// out. Blades are 4-sided (leading edge, suction side, trailing edge, pressure side at their true
// chord and thickness), round parts 6-sided with radial normals. The ocean's mirror draws every
// turbine with it (its image is half resolution and wave-distorted).
// ------------------------------------------------------------------------------------------------
function farTurbineGeometry() {
  const F = new FarBuilder(), mats = createTurbineMaterials(), paint = mats.paint.color, T = TURBINE, S = T.stack;
  const tp = T.tp.diameter / 2, deck = T.platform.outerDiameter / 2, towerR = (y) => interp1(T.tower, y) / 2;
  // static: growth band, TP, platform deck (a plate of the deck's outer diameter), tower
  F.rings(0, mats.growth.color, [[-1, tp], [S.growthTop, tp]]);
  F.rings(0, mats.yellow.color, [[S.growthTop, tp], [S.tpTop, tp]]);
  F.rings(0, mats.galvanised.color, [[S.deck - 0.6, deck], [S.deck, deck], [S.deck, deck, deck, 1], [S.deck, 0, deck, 1]]);
  F.rings(0, paint, [0, 0.3, 0.6, 1].map((k) => { const y = S.tpTop + k * (S.towerTop - S.tpTop); return [y, towerR(y)]; }));
  // nacelle (yaw frame): body, cooler, heli-hoist deck. The body's walls darken toward its floor as the
  // modeller's LOD 0/1 GRP covers do (in-service grime, −14 % at the floor; turbine.js tSurf_paint), so its
  // lower edge stays darker than the sky at range; a linear fade keeps the walls' mean (−7 %).
  F.box(1, paint, NACELLE_BOX, paint.clone().multiplyScalar(0.86));
  for (const b of [COOLER_BOX, HELI_BOX]) F.box(1, paint, b);
  // spinner (rotor frame, about the rotor axis), nose last
  const sp = T.spinner, R = sp.diameter / 2, z0 = sp.noseAheadOfHub - sp.length;
  F.rings(2, paint, [[z0, R * 0.88, R], [0.4, R, R], [sp.noseAheadOfHub - 0.6, R / 2, R], [sp.noseAheadOfHub, 0, R]], true);
  // Blades (rotor frame, pitched in the shader): stations at the root, maximum chord, mid span, the
  // three band edges (twinned: the band changes there) and the tip, interpolated in TURBINE.blade
  // (§4.3). Section in the blade frame (span +Y, rotation +X, upwind +Z; turbine.js sectionPoint):
  // pitch-axis point (0, r, −prebend), chord line u = (cos tw, 0, sin tw) toward the leading edge,
  // thickness line w = (sin tw, 0, −cos tw); then Rz(−k · 120°) · Rx(cone) as the modeller's.
  const BL = T.blade, col = (c) => BL.map((row) => [row[1], row[c]]), tip = T.hubRadius + T.bladeLength;
  const [e0, e1, e2] = [3, 2, 1].map((m) => tip - m * MARKINGS.tipBands.lengthEach);
  const stations = [[BL[0][1], 0], [26.9, 0], [55, 0], [e0, 0], [e0, 1], [e1, 1], [e1, 0.5], [e2, 0.5], [e2, 1], [tip - 0.6, 1]];
  for (let k = 0; k < 3; k++) {
    const m = new THREE.Matrix4().makeRotationZ(-k * TWO_PI / 3).multiply(new THREE.Matrix4().makeRotationX(T.coneDeg * DEG));
    const tv = (x, y, z, w = 1) => new THREE.Vector4(x, y, z, w).applyMatrix4(m).toArray().slice(0, 3);
    const ids = stations.map(([r, band]) => {
      const c = interp1(col(2), r), tw = interp1(col(3), r) * DEG, t = interp1(col(4), r) * c, pb = interp1(col(6), r), pa = interp1(col(7), r);
      const u = [Math.cos(tw), Math.sin(tw)], w = [Math.sin(tw), -Math.cos(tw)];            // (x, z) components
      const at = (fu, fw) => tv(u[0] * fu * c + w[0] * fw * t, r, u[1] * fu * c + w[1] * fw * t - pb);
      const axis = tv(0, r, -pb), chord = tv(u[0] * c / 2, 0, u[1] * c / 2, 0), span = [...tv(0, 1, 0, 0), t / 2];
      return [[pa, 0, u], [pa - 0.3, 0.5, w], [pa - 1, 0, [-u[0], -u[1]]], [pa - 0.3, -0.5, [-w[0], -w[1]]]]
        .map(([fu, fw, n]) => F.vert(3 + k, paint, band, at(fu, fw), tv(n[0], 0, n[1], 0), axis, chord, span));
    });
    for (let s = 1; s < stations.length; s++) {
      if (stations[s][0] === stations[s - 1][0]) continue;            // band twins: no quad between them
      for (let j = 0; j < 4; j++) F.quad(ids[s - 1][j], ids[s - 1][(j + 1) % 4], ids[s][j], ids[s][(j + 1) % 4]);
    }
  }
  return F.build();
}

// The substation beyond the LOD 1 distance: one merged mesh (1 draw instead of ~15) of its main
// surfaces in the far material; the rails, lamp lenses, grating, fittings, growth band and the
// submerged piles (27k of its 37k triangles) are below a pixel there. Vertices are relative to the
// substation's position (pose texel N), its orientation baked in.
const HELIDECK_FAR = new THREE.Color(0.045, 0.058, 0.047);   // turbine.js helideck deck colour, markings averaged in
function farSubstationGeometry(sub) {
  const F = new FarBuilder(), toLocal = new THREE.Matrix4().makeTranslation(sub.position.clone().negate());
  sub.traverse((o) => {
    if (o.isMesh && /\.(jacket\.(paint|yellow)|topside\.(paint|yellow|galvanised|dark|helideck))$/.test(o.name)) {
      F.mesh(o.geometry, o.material.userData.turbineMode === 'helideck' ? HELIDECK_FAR : o.material.color, toLocal.clone().multiply(o.matrixWorld));
    }
  });
  return F.build();
}

// One draw of many turbines with one merged geometry: instances are turbine indices (pose texels).
// Two draws share the vertex buffers, each with its own instance list: the view's (layer 0) and
// the ocean's mirror's (LAYER_REFLECT only), so each draws only what it needs.
class FarBatch {
  constructor(geometry, material, capacity, root, name) {
    const size = new THREE.Vector2();
    this.draws = [0, LAYER_REFLECT].map((layer) => {
      const g = layer ? new THREE.InstancedBufferGeometry() : geometry;
      if (layer) { for (const k in geometry.attributes) g.setAttribute(k, geometry.attributes[k]); g.setIndex(geometry.index); }
      const ring = new AttributeRing(1, capacity), data = new Float32Array(capacity);
      g.setAttribute('aFarIndex', ring.current);
      const mesh = new THREE.Mesh(g, material);
      mesh.name = name;
      mesh.layers.set(layer);
      mesh.frustumCulled = false;                                // culled per turbine on the CPU
      mesh.renderOrder = -1;                                     // first among the transparent: farthest
      mesh.visible = false;
      mesh.onBeforeRender = (renderer) => { FAR_VIEWPORT_H.value = renderer.getRenderTarget()?.height ?? renderer.getDrawingBufferSize(size).y; };
      root.add(mesh);
      return { g, ring, data, mesh, len: 0 };
    });
  }
  /** The view draws list[0 .. nView), the mirror mirrorList[0 .. nMirror). A list is uploaded when
   *  it changed or grew past the last upload (the ring's buffer holds only that upload's entries). */
  set(list, nView, mirrorList = list, nMirror = nView) {
    this.draws.forEach((D, k) => {
      const l = k ? mirrorList : list, n = k ? nMirror : nView;
      let changed = n > D.len;
      for (let i = 0; i < n; i++) if (D.data[i] !== l[i]) { D.data[i] = l[i]; changed = true; }
      if (changed) D.g.setAttribute('aFarIndex', D.ring.push(D.data, D.len = n));
      D.g.instanceCount = n;
      D.mesh.visible = n > 0;
    });
  }
  dispose() {
    for (const D of this.draws) {
      D.mesh.parent?.remove(D.mesh);
      D.ring.attachForRelease(D.g, 'aFarIndex');
      D.g.dispose();
    }
  }
}

// ================================================================================================
// Night lights: every lamp of the farm as camera-facing sprites in two instanced draws that share
// one geometry: the lamp itself (depth-tested) and the lens glare around it (not depth-tested).
// ================================================================================================
// Photometry (SCENE-SPEC §12.1, §13): a lamp of intensity I (cd) toward the camera and projected
// lens area A has core radiance I / (A · 25,000) scene units; its irradiance at the camera is
// I / (d² · 25,000). The core is drawn with the lens's integrated intensity whatever its size on
// screen: a resolved lens as a disc, a sub-pixel one as a round Gaussian footprint of the same
// integral (a 1 px disc saturates into a '+' at night exposure). Extinction comes from the
// atmosphere's applyAerialTransmittance(); nothing is added by in-scatter. The L-864s ride on the
// nacelles: their positions are yaw-frame offsets placed from the pose texture, so nothing is
// uploaded per frame as the turbines yaw.
//
// Glare. HALO_FRACTION of the light is scattered by the camera lens into a fixed-angle halo, and a
// lens scatters it over everything in the frame: a nacelle or a blade in front of the halo does not
// cut it, only one in front of the lamp itself does. The halo is therefore drawn without depth test
// and scaled by the lamp's visibility, found in the vertex shader by casting the ray camera → lamp
// against proxies of the structures that can hide a lamp (LAMP_OCCLUSION_GLSL below): the lamp's own
// turbine (tower, TP, platform, nacelle, cooler, spinner, the three blades at their current angle),
// the turbines nearest the camera, the substation topside and the curved sea. The proxies are a
// little smaller than the geometry, so a halo never vanishes while its lamp is in sight; each
// fades over about a pixel as an edge crosses the lamp.

// Vertical beam shapes, shared by the sprites and the lamp light on the steel.
const VB = NL.verticalBeam;
const BEAM_GLSL = /* glsl */`
float aviationBeam(float el) {
	if (el >= ${f(VB.fullAboveDeg, 2)}) return 1.0;
	if (el >= -10.0) return mix(1.0, ${f(VB.at10Deg)}, (${f(VB.fullAboveDeg, 2)} - el) / ${f(VB.fullAboveDeg + 10, 2)});
	return mix(${f(VB.at10Deg)}, ${f(VB.below)}, clamp((-10.0 - el) * 0.5, 0.0, 1.0));
}
float marineBeam(float el) {
	float s = el / ${f(MARINE_BEAM_FWHM_DEG / 2.3548, 4)};
	return mix(${f(MARINE_BEAM_FLOOR)}, 1.0, exp(-0.5 * s * s));
}
`;
// 1 when the segment ro + rd·t (t ∈ [0, tMax]) enters the box (not counting a start inside it), else 0.
const BOX_GLSL = /* glsl */`
float occBoxHit(vec3 ro, vec3 rd, float tMax, vec3 bmin, vec3 bmax) {
	if (all(greaterThan(ro, bmin)) && all(lessThan(ro, bmax))) return 0.0;
	vec3 inv = 1.0 / (rd + mix(vec3(-1e-9), vec3(1e-9), step(0.0, rd)));
	vec3 t0 = (bmin - ro) * inv, t1 = (bmax - ro) * inv;
	vec3 tn = min(t0, t1), tf = max(t0, t1);
	return max(max(tn.x, tn.y), max(tn.z, 0.0)) <= min(min(tf.x, tf.y), min(tf.z, tMax)) ? 1.0 : 0.0;
}
`;
const boxArgs = (b) => `${v3(b[0])}, ${v3(b[1])}`;

const LAMP_COMMON_VERTEX = /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec3 aLampPos;          // world position of the lamp centre; on a nacelle its offset in the yaw frame
attribute vec4 aLamp;             // x intensity (cd), y projected lens area (m²), z flash class, w beam (BEAM)
attribute vec3 aLampColor;        // linear RGB with unit luminance
attribute float aLampOwner;       // index of the turbine carrying the lamp; -1 substation
uniform highp sampler2D uTurbineState;
uniform float uLevel[LAMP_CLASSES];
uniform vec2 uViewportPx;         // size of the current render target (px)
uniform float uExposed;           // scene radiance → exposed units (sizes the sprites only)
uniform float uLampTime;
uniform float uFogDensity;        // sea-level extinction (1/m), for the sprite size estimate
uniform float uFogHeightFalloff;  // 1 / haze scale height (1/m)
varying vec3 vRad;                // core radiance (lamp pass) or halo peak radiance (glare pass), scene units
varying vec3 vShape;              // lamp pass: x lens radius, y Gaussian sigma, z disc weight (px); glare pass: x θ0, y half-size (px)
varying vec2 vOffset;             // offset of this corner from the lamp centre (px)
varying vec3 vLampWorld;
${BEAM_GLSL}
float lampHash(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
vec3 lampPosition() {
	if (aLamp.w < 1.5) return aLampPos;
	vec4 s = texelFetch(uTurbineState, ivec2(int(aLampOwner + 0.5), 0), 0);
	float c = cos(s.w), n = sin(s.w);
	return s.xyz + vec3(c * aLampPos.x + n * aLampPos.z, aLampPos.y + ${f(TURBINE.stack.towerTop, 2)}, c * aLampPos.z - n * aLampPos.x);
}
// Haze transmittance (luminance) between two points, for the sprite size estimate.
float lampHazeT(vec3 a, vec3 b) {
	float ha = max(a.y, 0.0) * uFogHeightFalloff, hb = max(b.y, 0.0) * uFogHeightFalloff;
	float dh = hb - ha;
	return exp(-uFogDensity * length(b - a) * (abs(dh) < 1e-4 ? exp(-ha) : (exp(-ha) - exp(-hb)) / dh));
}
// Intensity (cd) toward the camera: beam, flash level, scintillation over long sea paths.
float lampIntensity(vec3 P, vec3 toCam, float d) {
	vec3 up = normalize(vec3(P.x / ${f(EARTH_R, 1)}, 1.0, P.z / ${f(EARTH_R, 1)}));
	float el = degrees(asin(clamp(dot(toCam, up) / d, -1.0, 1.0)));
	float h = 6.2831853 * lampHash(P);
	float n = (sin(uLampTime * 44.6 + h) + sin(uLampTime * 71.0 + 2.3 * h) + sin(uLampTime * 112.5 + 3.7 * h)) * 0.8165;
	float scint = max(1.0 + ${f(SCINT_MAX)} * (1.0 - exp(-d / ${f(SCINT_RANGE_M, 1)})) * n, 0.0);
	return aLamp.x * uLevel[int(aLamp.z + 0.5)] * (abs(aLamp.w - 1.0) < 0.5 ? marineBeam(el) : aviationBeam(el)) * scint;
}
// Both passes: the lamp centre P, the way to the camera, its distance d, the intensity I toward it
// and the focal length in px per radian.
vec3 P, toCam;
float d, I, focal;
void lampSetup() {
	P = vLampWorld = lampPosition();
	toCam = cameraPosition - P;
	d = max(length(toCam), 1e-3);
	I = lampIntensity(P, toCam, d);
	focal = projectionMatrix[1][1] * 0.5 * uViewportPx.y;
}
// Camera-facing quad of half-size R px around the lamp, drawn biasM metres in front of its centre.
void lampQuad(float R, float biasM) {
	vOffset = position.xy * R;
	vec4 mvPosition = modelViewMatrix * vec4(P + toCam / d * min(biasM, 0.5 * d), 1.0);
	gl_Position = projectionMatrix * mvPosition;
	gl_Position.xy += position.xy * R * 2.0 / uViewportPx * gl_Position.w;
}
`;

// Structure proxies for the glare visibility, in metres (turbine.js frames; config.js TURBINE).
// Kept a little inside the real surfaces (the halo must never vanish while its lamp is visible).
// The cooler is at its true size: the L-864 lenses sit only 0.2 m inside its outline seen from
// astern, so a smaller proxy would leave their glare half lit behind it.
const OCC_NAC_BOX = [[NACELLE_BOX[0][0] + 0.1, NACELLE_BOX[0][1] + 0.1, NACELLE_BOX[0][2] + 0.1], [NACELLE_BOX[1][0] - 0.1, NACELLE_BOX[1][1] - 0.15, NACELLE_BOX[1][2] - 0.1]];
const OCC_BLADE = [[3.0, 14.0, 2.1], [14.0, 40.0, 1.0], [40.0, TURBINE.hubRadius + TURBINE.bladeLength, 0.4]];   // span r0, r1, radius (≤ half the airfoil thickness, §4.3)
const OCC_NEAR_COUNT = 6;              // turbines nearest the camera tested against every lamp
const OCC_SEA_MARGIN_M = 0.25;         // mean-sea clearance a lamp needs over the curved sea (waves hide less)
const OCC_SOFT_MAX_M = 0.35;           // widest occluder-edge fade (m); lamps sit ≥ 0.36 m off their own steel
const ST = TURBINE.stack, TOWER = TURBINE.tower, TP_R = TURBINE.tp.diameter / 2;

const LAMP_OCCLUSION_GLSL = /* glsl */`
uniform float uNear[${OCC_NEAR_COUNT}];  // turbine indices nearest the camera (-1: none)
uniform vec3 uSubCentre;                 // substation topside proxy: centre, two horizontal axes, half-extents
uniform vec3 uSubAxisX;
uniform vec3 uSubAxisZ;
uniform vec3 uSubHalf;
${BOX_GLSL}
float occStep(float clearance, float w) { return smoothstep(-w, w, clearance); }
// A closest approach at the lamp's end of the segment means the structure is beside or behind the
// lamp, not in front of it: clear unless the segment actually passes through it.
float occEndRule(float clearance, float s) { return s > 0.999 && clearance > 0.0 ? 1e4 : clearance; }
// Clearance (m) of the segment ro + rd·t (t ∈ [0, tMax], |rd| = 1) from the capsule a–b of radius r
// (closest points of two segments, Ericson §5.1.9; a = b: a sphere); negative when the segment passes through it.
float occCapsule(vec3 ro, vec3 rd, float tMax, vec3 a, vec3 b, float r) {
	vec3 d1 = rd * tMax, d2 = b - a, w = ro - a;
	float A = dot(d1, d1), B = dot(d1, d2), C = max(dot(d2, d2), 1e-9), D = dot(d1, w), E = dot(d2, w);
	float den = A * C - B * B;
	float s = den > 1e-7 * A * C ? clamp((B * E - C * D) / den, 0.0, 1.0) : 0.0;
	float t = (B * s + E) / C;
	if (t < 0.0) { t = 0.0; s = clamp(-D / A, 0.0, 1.0); }
	else if (t > 1.0) { t = 1.0; s = clamp((B - D) / A, 0.0, 1.0); }
	return occEndRule(length(w + d1 * s - d2 * t) - r, s);
}
// Clearance from a vertical cylinder (axis through the local origin) between heights y0 and y1,
// radius tapering r0 → r1: horizontal distance at the closest approach inside the height slab.
float occCylinder(vec3 ro, vec3 rd, float tMax, float y0, float y1, float r0, float r1) {
	float ta = 0.0, tb = tMax;
	if (abs(rd.y) < 1e-7) { if (ro.y < y0 || ro.y > y1) return 1e4; }
	else {
		float t0 = (y0 - ro.y) / rd.y, t1 = (y1 - ro.y) / rd.y;
		ta = max(ta, min(t0, t1)); tb = min(tb, max(t0, t1));
		if (ta > tb) return 1e4;
	}
	vec2 o = ro.xz, d = rd.xz;
	float dd = dot(d, d);
	float t = dd > 1e-12 ? clamp(-dot(o, d) / dd, ta, tb) : ta;
	return occEndRule(length(o + d * t) - mix(r0, r1, clamp((ro.y + rd.y * t - y0) / (y1 - y0), 0.0, 1.0)), t / tMax);
}
// Soft box visibility: fully hidden inside the box shrunk by w, fully clear outside it grown by w.
float occBox(vec3 ro, vec3 rd, float tMax, vec3 bmin, vec3 bmax, float w) {
	return 1.0 - 0.5 * (occBoxHit(ro, rd, tMax, bmin - w, bmax + w) + occBoxHit(ro, rd, tMax, bmin + w, bmax - w));
}
// Visibility of the far end of a segment past one turbine.
float occTurbine(int i, vec3 ro, vec3 rd, float tMax, float w) {
	vec4 s0 = texelFetch(uTurbineState, ivec2(i, 0), 0);
	vec3 oc = s0.xyz + vec3(0.0, ${f(CULL_CENTRE_Y, 1)}, 0.0) - ro;   // bounding sphere of the whole turbine
	if (length(oc - rd * clamp(dot(oc, rd), 0.0, tMax)) > ${f(CULL_RADIUS + 2, 1)}) return 1.0;
	vec3 lo = ro - s0.xyz;
	float v = occStep(occCylinder(lo, rd, tMax, ${f(ST.tpTop, 2)}, ${f(ST.towerTop, 2)}, ${f(TOWER[0][1] / 2 - 0.12)}, ${f(TOWER[TOWER.length - 1][1] / 2 - 0.12)}), w);
	v = min(v, occStep(occCylinder(lo, rd, tMax, -30.0, ${f(ST.tpTop, 2)}, ${f(TP_R - 0.1)}, ${f(TP_R - 0.1)}), w));
	v = min(v, occStep(occCylinder(lo, rd, tMax, ${f(ST.skirtBottom + 0.3, 2)}, ${f(ST.deck - 0.05, 2)}, ${f(TURBINE.platform.outerDiameter / 2 - 0.2)}, ${f(TURBINE.platform.outerDiameter / 2 - 0.2)}), w));
	if (v <= 0.0) return 0.0;
	// Yaw frame: origin on the tower axis at the yaw bearing, rotor side +Z (three.js Ry(yaw)).
	float cy = cos(s0.w), sy = sin(s0.w);
	vec3 q = lo - vec3(0.0, ${f(ST.towerTop, 2)}, 0.0);
	vec3 yo = vec3(cy * q.x - sy * q.z, q.y, sy * q.x + cy * q.z);
	vec3 yd = vec3(cy * rd.x - sy * rd.z, rd.y, sy * rd.x + cy * rd.z);
	v = min(v, occBox(yo, yd, tMax, ${boxArgs(OCC_NAC_BOX)}, w));
	v = min(v, occBox(yo, yd, tMax, ${boxArgs(COOLER_BOX)}, w));
	// Rotor: hub, tilted shaft, three blades with the cone angle at the current rotor angle.
	vec3 hub = ${v3(TURBINE.hubCentre)};
	const float cT = ${TILT_C}, sT = ${TILT_S}, cC = ${CONE_C}, sC = ${CONE_S};
	vec3 sc = hub + vec3(0.0, sT, cT) * 0.5;
	v = min(v, occStep(occCapsule(yo, yd, tMax, sc, sc, ${f(TURBINE.spinner.diameter / 2 - 0.35, 2)}), w));
	float spin = texelFetch(uTurbineState, ivec2(i, 1), 0).x;
	for (int k = 0; k < 3; k++) {
		float phi = spin + float(k) * 2.0943951;
		vec3 b = vec3(-cC * sin(phi), cC * cos(phi), sC);             // Rz(phi) · blade axis with cone
		vec3 dir = vec3(b.x, b.y * cT + b.z * sT, -b.y * sT + b.z * cT); // Rx(-tilt)
${OCC_BLADE.map(([r0, r1, r]) => `\t\tv = min(v, occStep(occCapsule(yo, yd, tMax, hub + dir * ${f(r0, 1)}, hub + dir * ${f(r1, 1)}, ${f(r, 2)}), w));`).join('\n')}
	}
	return v;
}
// Visibility of a lamp from the camera (0 hidden … 1 in sight). wPerM: one pixel's footprint per
// metre of distance; an occluder edge crossing the lamp fades over about a pixel (at most
// OCC_SOFT_MAX_M, so a lamp mounted next to its own steel is never dimmed by it).
float lampVisibility(vec3 cam, vec3 lamp, float lensR, float wPerM) {
	vec3 v = lamp - cam;
	float d = length(v);
	if (d < 1.0) return 1.0;
	vec3 rd = v / d;
	float tMax = d - 0.3;                                          // stop short of the lamp's own mount
	float w = clamp(wPerM * d * 0.5, lensR, ${f(OCC_SOFT_MAX_M, 2)});
	// The curved sea: lowest height of the ray above mean sea level.
	vec2 o = cam.xz, dx = rd.xz;
	float dd = dot(dx, dx);
	float ts = dd > 1e-12 ? clamp(-(rd.y * ${f(EARTH_R, 1)} + dot(o, dx)) / dd, 0.0, tMax) : 0.0;
	vec3 ps = cam + rd * ts;
	float vis = occStep(ps.y + dot(ps.xz, ps.xz) / ${f(2 * EARTH_R, 1)} - ${f(OCC_SEA_MARGIN_M, 2)}, max(w, wPerM * ts));
	int own = int(aLampOwner + 0.5);
	if (aLampOwner >= -0.5) vis = min(vis, occTurbine(own, cam, rd, tMax, w));
	for (int k = 0; k < ${OCC_NEAR_COUNT}; k++) {
		if (vis <= 0.0) break;
		int n = int(uNear[k] + 0.5);
		if (uNear[k] < -0.5 || n == own) continue;
		vis = min(vis, occTurbine(n, cam, rd, tMax, w));
	}
	// Substation topside (its own lamps included: they sit outside this proxy).
	if (vis > 0.0) {
		vec3 q = cam - uSubCentre;
		vis = min(vis, occBox(vec3(dot(q, uSubAxisX), q.y, dot(q, uSubAxisZ)), vec3(dot(rd, uSubAxisX), rd.y, dot(rd, uSubAxisZ)), tMax, -uSubHalf, uSubHalf, max(w, 0.5)));
	}
	return vis;
}
`;

const LAMP_VERTEX = LAMP_COMMON_VERTEX + /* glsl */`
void main() {
	lampSetup();
	float area = aLamp.y;
	float rc = sqrt(area / PI) / d * focal;                                  // lens radius on screen (px)
	vec3 core = aLampColor * (I * ${f(1 - HALO_FRACTION)} / (area * ${f(SCENE_LUX, 1)}));
	// Footprint: a disc with a 1 px edge when the lens is resolved, a round Gaussian below ~2 px;
	// both integrate to pi rc^2 so the pixel sum keeps the lamp's intensity.
	float sigma = max(rc / 1.2, ${f(CORE_SIGMA_MIN_PX, 2)});
	float disc = smoothstep(1.5, 3.0, rc);
	float peak = max(core.r, max(core.g, core.b)) * lampHazeT(cameraPosition, P) * uExposed * mix(rc * rc / (2.0 * sigma * sigma), 1.0, disc);
	float reach = sigma * sqrt(2.0 * log(max(peak / ${f(CORE_VISIBLE_EXPOSED, 4)}, 1.0)));
	vRad = core;
	vShape = vec3(rc, sigma, disc);
	lampQuad(min(max(rc + 1.5, mix(reach, 0.0, disc) + 1.0), ${f(QUAD_MAX_PX, 1)}), ${f(DEPTH_BIAS_M, 2)});
	if (I <= 0.0) gl_Position = vec4(0.0, 0.0, 2.0, 1.0);                 // dark lamp: quad beyond the far plane
	#include <logdepthbuf_vertex>
}`;

const HALO_VERTEX = LAMP_COMMON_VERTEX + LAMP_OCCLUSION_GLSL + /* glsl */`
void main() {
	lampSetup();
	// Fixed angular profile (1 + (θ/θ0)²)^-2, peak radiance from the irradiance at the camera.
	vec3 halo = aLampColor * (${f(HALO_FRACTION)} * I / (d * d * ${f(SCENE_LUX, 1)}) / (PI * ${(HALO_THETA0_RAD * HALO_THETA0_RAD).toExponential(4)}));
	float h0 = ${HALO_THETA0_RAD.toExponential(4)} * focal;
	float peak = max(halo.r, max(halo.g, halo.b)) * lampHazeT(cameraPosition, P) * uExposed;
	float R = min(h0 * sqrt(max(sqrt(peak / ${f(HALO_VISIBLE_EXPOSED, 4)}) - 1.0, 0.0)), ${f(QUAD_MAX_PX, 1)});
	float vis = I > 0.0 && R > 0.75 ? lampVisibility(cameraPosition, P, sqrt(aLamp.y / PI), 1.0 / focal) : 0.0;
	vRad = halo * vis;
	vShape = vec3(h0, R, 0.0);
	lampQuad(R, 0.0);
	if (vis <= 0.0) gl_Position = vec4(0.0, 0.0, 2.0, 1.0);               // hidden or no halo: nothing to draw
	#include <logdepthbuf_vertex>
}`;

// Fragment shaders: `profile` turns vOffset (px) and vShape into the footprint weight.
const lampFragment = (atmosGlsl, profile) => /* glsl */`
#include <common>
#include <logdepthbuf_pars_fragment>
${atmosGlsl}
varying vec3 vRad;
varying vec3 vShape;
varying vec2 vOffset;
varying vec3 vLampWorld;
void main() {
	#include <logdepthbuf_fragment>
	float r = length(vOffset);
	${profile}
	gl_FragColor = vec4(applyAerialTransmittance(vRad * weight, vLampWorld), 0.0);
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`;
const CORE_PROFILE = /* glsl */`float rc = vShape.x, sigma = vShape.y;
	float weight = mix(exp(-r * r / (2.0 * sigma * sigma)) * (rc * rc) / (2.0 * sigma * sigma), clamp(rc + 0.5 - r, 0.0, 1.0) * (rc * rc) / (rc * rc + 1.0 / 12.0), vShape.z);`;
const HALO_PROFILE = /* glsl */`float q = r / vShape.x, u = min(r / vShape.y, 1.0);
	float weight = (1.0 - u * u) * (1.0 - u * u) / ((1.0 + q * q) * (1.0 + q * q));`;
// Without an atmosphere (bare test pages) lamps are unattenuated, in absolute units.
const NO_ATMOSPHERE_GLSL = 'vec3 applyAerialTransmittance(vec3 c, vec3 p) { return c; }';

// Pure emission: add RGB, leave the target's alpha alone (the ocean's mirror target reads alpha as
// coverage, and a lamp covers nothing).
const ADDITIVE_EMISSION = {
  transparent: true, depthWrite: false,
  blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
  blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
};

class NightLights {
  constructor(farm, ctx) {
    this.ctx = ctx;
    this.farm = farm;
    const b0 = farm.builds[0];
    const area = { l864: Math.PI * (NL.l864.lensD / 2) ** 2, l810: Math.PI * (NL.l810.lensD / 2) ** 2, marine: NL.marine.lensD * NL.marine.lensH };
    // { pos (world; nacelle lamps: yaw frame), cd, area, cls, beam, colour, owner }; kept for the ocean's distant lights.
    const lamps = this.lamps = [];
    const add = (pos, cd, a, cls, beam, colour, owner) => lamps.push({ pos, cd, area: a, cls, beam, colour, owner });
    for (const tb of farm.turbines) {
      const base = new THREE.Vector3(tb.x, tb.baseY, tb.z), ch = NL.marine[tb.class];
      for (const p of b0.lights.aviation) add(p.clone(), NL.l864.cd, area.l864, LAMP.aviationFlash, BEAM.nacelle, RED, tb.index);
      for (const p of b0.lights.midMast) add(p.clone().add(base), NL.l810.cd, area.l810, LAMP.aviationFlash, BEAM.aviation, RED, tb.index);
      for (const p of b0.lights.marine) add(p.clone().add(base), ch.cd, area.marine, LAMP[tb.class], BEAM.marine, YELLOW, tb.index);
    }
    // Substation (SCENE-SPEC §6): steady L-810 at the top corners and the main deck, and two
    // yellow lanterns with the interior character.
    const sub = farm.substation, L = sub.userData.lights, subClass = SUBSTATION.lights.marineClass;
    const world = (p) => sub.localToWorld(p.clone());
    for (const p of [...L.l810Top, ...L.l810Mid]) add(world(p), SUBSTATION.lights.l810Cd, area.l810, LAMP.aviationSteady, BEAM.aviation, RED, -1);
    for (const p of L.marine) add(world(p), NL.marine[subClass].cd, area.marine, LAMP[subClass], BEAM.marine, YELLOW, -1);

    this.count = lamps.length;
    if (globalThis.NJOW_DEV !== false) {   // dev page readout
      const n = (beam) => lamps.filter((l) => l.beam === beam).length;
      this.counts = { l864: n(BEAM.nacelle), l810: n(BEAM.aviation), marine: n(BEAM.marine) };
    }
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    const attr = (name, size, get) => geo.setAttribute(name, new THREE.InstancedBufferAttribute(new Float32Array(lamps.flatMap(get)), size));
    attr('aLampPos', 3, (l) => l.pos.toArray());
    attr('aLamp', 4, (l) => [l.cd, l.area, l.cls, l.beam]);
    attr('aLampColor', 3, (l) => l.colour);
    attr('aLampOwner', 1, (l) => [l.owner]);
    geo.instanceCount = this.count;

    // Substation topside proxy for the glare: the clad main module (substation.js: the deck house
    // spans the topside plan up to the upper deck), kept 3 m inside the plan and between the cellar and roof.
    const subY0 = SUBSTATION.interfaceY + 5, subY1 = SUBSTATION.topY - 13;
    const atmosphere = ctx.atmosphere;
    const shared = this.uniforms = {
      ...(atmosphere?.uniforms || {}),
      uFogDensity: U.uFogDensity, uFogHeightFalloff: U.uFogHeightFalloff,
      uTurbineState: farm.pose.uniform,
      uLevel: { value: new Array(LAMP_CLASS_COUNT).fill(0) },
      uViewportPx: { value: new THREE.Vector2(1, 1) },
      uExposed: { value: 1 },
      uLampTime: { value: 0 },
    };
    this.haloUniforms = {
      ...shared,
      uNear: { value: new Array(OCC_NEAR_COUNT).fill(-1) },
      uSubCentre: { value: new THREE.Vector3(sub.position.x, sub.position.y + 0.5 * (subY0 + subY1), sub.position.z) },
      uSubAxisX: { value: new THREE.Vector3(1, 0, 0).applyQuaternion(sub.quaternion).normalize() },
      uSubAxisZ: { value: new THREE.Vector3(0, 0, 1).applyQuaternion(sub.quaternion).normalize() },
      uSubHalf: { value: new THREE.Vector3(SUBSTATION.topside.length / 2 - 3, 0.5 * (subY1 - subY0), SUBSTATION.topside.width / 2 - 3) },
    };
    const atmosGlsl = atmosphere?.glsl || NO_ATMOSPHERE_GLSL;
    const material = (name, uniforms, vertexShader, profile, depthTest) => new THREE.ShaderMaterial({
      name, defines: { LAMP_CLASSES: LAMP_CLASS_COUNT }, uniforms, vertexShader, fragmentShader: lampFragment(atmosGlsl, profile), depthTest, ...ADDITIVE_EMISSION,
    });
    this.material = material('farm.lamps', shared, LAMP_VERTEX, CORE_PROFILE, true);
    this.haloMaterial = material('farm.lampGlare', this.haloUniforms, HALO_VERTEX, HALO_PROFILE, false);
    // The lamps: in the view and in the ocean's mirror. The glare: a lens effect of the viewing
    // camera, so not in the mirror (as land.js's lamps).
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.name = 'farm.lamps';
    this.mesh.renderOrder = 10;
    this.mesh.layers.enable(LAYER_REFLECT);
    this.haloMesh = new THREE.Mesh(geo, this.haloMaterial);
    this.haloMesh.name = 'farm.lampGlare';
    this.haloMesh.renderOrder = 11;
    // Sprite sizes are in pixels of whatever is being rendered (the view or the ocean's mirror).
    const viewport = new THREE.Vector4();
    for (const m of [this.mesh, this.haloMesh]) {
      const u = m.material.uniforms;
      m.onBeforeRender = (renderer) => {
        renderer.getCurrentViewport(viewport);
        u.uViewportPx.value.set(Math.max(1, viewport.z), Math.max(1, viewport.w));
        m.material.uniformsNeedUpdate = true;
      };
      m.frustumCulled = false;
      m.visible = false;
      farm.root.add(m);
    }
    this._v = new THREE.Vector3();
    this._nearD = new Float64Array(OCC_NEAR_COUNT);
    this._distant = null;
    this.aviationOn = false;
    this.marineOn = false;
  }

  update(t, sunElevationDeg, adls, exposed, camera) {
    this.aviationOn = !adls && sunElevationDeg < AVIATION_ON_BELOW_DEG;
    this.marineOn = sunElevationDeg < MARINE_ON_BELOW_DEG;
    const lv = this.uniforms.uLevel.value;
    lv[LAMP.aviationFlash] = this.aviationOn ? flashLevel(t, NL.l864.periodS, NL.l864.onS) : 0;   // L-864 + L-810 F in unison
    lv[LAMP.aviationSteady] = this.aviationOn ? 1 : 0;
    for (const c of ['SPS', 'IPS', 'inner', 'interior']) lv[LAMP[c]] = this.marineOn ? flashLevel(t, NL.marine[c].periodS, NL.marine[c].onS) : 0;
    const on = this.aviationOn || this.marineOn;
    this.mesh.visible = this.haloMesh.visible = on;
    const cam = camera.getWorldPosition(this._v);
    this.publishDistant(on, cam);
    if (!on) return;
    this.uniforms.uLampTime.value = t;
    this.uniforms.uExposed.value = exposed;
    // The OCC_NEAR_COUNT turbines nearest the camera (horizontal distance), by insertion: no allocation.
    const u = this.haloUniforms.uNear.value, dist = this._nearD;
    u.fill(-1); dist.fill(Infinity);
    for (const tb of this.farm.turbines) {
      const d2 = (tb.x - cam.x) ** 2 + (tb.z - cam.z) ** 2;
      if (d2 >= dist[OCC_NEAR_COUNT - 1]) continue;
      let k = OCC_NEAR_COUNT - 1;
      while (k > 0 && dist[k - 1] > d2) { dist[k] = dist[k - 1]; u[k] = u[k - 1]; k--; }
      dist[k] = d2; u[k] = tb.index;
    }
  }

  /**
   * Hand the lamps beyond the reach of the ocean's planar mirror to its analytic glitter columns
   * (ocean-lights.js), each night frame: ocean.setDistantLights('farm', { count, position, colour,
   * intensity, beam }) with the peak intensity (cd) at the current flash level and the beam kind
   * (1 FAA, 2 marine lantern) so the ocean shapes it toward each water point. Lamps nearer than
   * ocean.distantLightMinDistance are left to the mirror; of the rest, the ocean.distantLightCapacity
   * brightest at the camera (I / d²) are sent. By day the set is removed (count 0) once.
   */
  publishDistant(on, cam) {
    const ocean = this.ctx.ocean;
    if (typeof ocean?.setDistantLights !== 'function') return;
    const lamps = this.lamps, n = lamps.length, cap = ocean.distantLightCapacity;
    const D = this._distant || (this._distant = {
      count: 0, sent: 0, position: new Float32Array(3 * cap), colour: new Float32Array(3 * cap), intensity: new Float32Array(cap), beam: new Uint8Array(cap),
      order: [], weight: new Float64Array(n), at: new Float32Array(3 * n),
    });
    D.count = 0;
    if (on) {
      const minD2 = ocean.distantLightMinDistance ** 2, lv = this.uniforms.uLevel.value, T = this.farm.turbines, v = this._v2 || (this._v2 = new THREE.Vector3());
      const order = D.order, w = D.weight;
      order.length = 0;
      for (let i = 0; i < n; i++) {
        const l = lamps[i], I = l.cd * lv[l.cls];
        if (I <= 0) continue;
        v.copy(l.pos);
        if (l.beam === BEAM.nacelle) v.applyMatrix4(T[l.owner].m.nacelle);
        const d2 = (v.x - cam.x) ** 2 + (v.z - cam.z) ** 2;
        if (d2 < minD2) continue;
        v.toArray(D.at, 3 * i);
        w[i] = I / (d2 + (v.y - cam.y) ** 2);
        order.push(i);
      }
      order.sort((a, b) => w[b] - w[a]);
      D.count = Math.min(cap, order.length);
      for (let k = 0; k < D.count; k++) {
        const i = order[k], l = lamps[i];
        for (let c = 0; c < 3; c++) { D.position[3 * k + c] = D.at[3 * i + c]; D.colour[3 * k + c] = l.colour[c]; }
        D.intensity[k] = l.cd * lv[l.cls];
        D.beam[k] = l.beam === BEAM.marine ? 2 : 1;
      }
    }
    if (D.count || D.sent) ocean.setDistantLights('farm', D);
    D.sent = D.count;
  }

  dispose() {
    this.mesh.parent?.remove(this.mesh);
    this.haloMesh.parent?.remove(this.haloMesh);
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.haloMaterial.dispose();
  }
}

// ================================================================================================
// Lamp light on the steel around it. The sprites above are what the camera sees of a lamp; this is
// what a lamp does to its surroundings: 2000 cd a few metres from the heli-deck rails lights them
// red on every flash, and a lantern lights the platform railing and TP top yellow.
//
// It is added to the farm's own LOD 0 materials (LampLitMaterials below), not made of three.js
// lights: a real light would put its cost on every lit pixel of the scene (vessels, land, far
// turbines) at all hours, for light that is only visible within a few hundred metres, and could not
// have the FAA or IALA beam shape. Here each of the nearest turbine's two L-864s and its lantern on
// the camera's side is evaluated with three.js's own RE_Direct (the material's diffuse, specular and
// clearcoat response), with the lamp's true vertical beam (the same functions as the sprites),
// inverse-square falloff in photometric units (cd / LOOK.sceneUnitLux), and occlusion by the nacelle
// body and cooler (L-864s) or the TP and platform deck (lantern). A uniform branch skips it by day.
// ================================================================================================
const LAMP_LIGHT_FADE_M = [300, 400];  // camera distance from the nearest nacelle: lit … dark (no pop)
const LAMP_LIGHT_MIN_D2 = 0.04;        // m²: surfaces closer than 0.2 m (the lamp's own housing) are not blown up
const LAMP_LENS_R = f(NL.l864.lensD / 2 * 0.8);   // shadow samples across the L-864 lens (m)

const LAMP_LIGHT_GLSL = /* glsl */`
uniform float uFarmLampOn;             // 1 when any lamp light is on (branch)
uniform vec3 uFarmLampPos[3];          // world: L-864 a, L-864 b, marine lantern
uniform vec3 uFarmLampI[3];            // linear RGB intensity toward the beam maximum (scene cd)
uniform mat4 uFarmYawInv;              // world → yaw frame of the lit turbine
uniform vec3 uFarmBase;                // its foundation axis at mean sea level (static frame origin)
${BEAM_GLSL}
${BOX_GLSL}
// 1 if the segment a → b misses the box, else 0 (both in the box's frame).
float farmBoxClear(vec3 a, vec3 b, vec3 bmin, vec3 bmax) {
	float l = length(b - a);
	return 1.0 - occBoxHit(a, (b - a) / max(l, 1e-6), l, bmin, bmax);
}
void farmLampLight(vec3 wp, vec3 geometryPosition, vec3 geometryNormal, vec3 geometryViewDir, vec3 geometryClearcoatNormal, PhysicalMaterial material, inout ReflectedLight reflectedLight) {
	IncidentLight farmL;
	farmL.visible = true;
	vec3 ya = (uFarmYawInv * vec4(wp, 1.0)).xyz;
	for (int i = 0; i < 3; i++) {
		vec3 L = uFarmLampPos[i] - wp;
		float d2 = max(dot(L, L), ${f(LAMP_LIGHT_MIN_D2)});
		L *= inversesqrt(dot(L, L) + 1e-12);
		float el = degrees(asin(clamp(-L.y, -1.0, 1.0)));      // the surface point seen from the lamp
		float clear;
		if (i < 2) {
			// Nacelle body and cooler, seen from four points across the lens (the cooler edge is
			// half a metre from the lamp, so its shadow has a penumbra metres wide on the deck).
			vec3 yb = (uFarmYawInv * vec4(uFarmLampPos[i], 1.0)).xyz;
			const vec3 lens[4] = vec3[4](vec3(${LAMP_LENS_R}, 0.05, 0.0), vec3(-${LAMP_LENS_R}, 0.05, 0.0), vec3(0.0, -0.05, ${LAMP_LENS_R}), vec3(0.0, -0.05, -${LAMP_LENS_R}));
			float vis = 0.0;
			for (int k = 0; k < 4; k++) vis += farmBoxClear(ya, yb + lens[k], ${boxArgs(growBox(NACELLE_BOX, -0.05))}) * farmBoxClear(ya, yb + lens[k], ${boxArgs(growBox(COOLER_BOX, -0.05))});
			clear = aviationBeam(el) * 0.25 * vis;
		} else {
			// Lantern: shaded by the TP / tower (vertical axis) and, for points under it, the platform
			// deck; edges softened over the lens size.
			vec2 o = wp.xz - uFarmBase.xz, dd = uFarmLampPos[i].xz - uFarmBase.xz - o;
			float t = clamp(-dot(o, dd) / max(dot(dd, dd), 1e-9), 0.0, 1.0);
			clear = marineBeam(el) * smoothstep(${f(TP_R - 0.45, 2)}, ${f(TP_R - 0.15, 2)}, length(o + dd * t));
			float yp = wp.y - uFarmBase.y, yl = uFarmLampPos[i].y - uFarmBase.y, deck = ${f(ST.deck - 0.05, 2)};
			if (yp < deck && yl > deck) clear *= smoothstep(${f(TURBINE.platform.outerDiameter / 2 - 0.15)}, ${f(TURBINE.platform.outerDiameter / 2 + 0.15)}, length(o + dd * (deck - yp) / (yl - yp)));
		}
		farmL.color = uFarmLampI[i] * (clear / d2);
		farmL.direction = normalize((viewMatrix * vec4(L, 0.0)).xyz);
		if (clear > 0.0) RE_Direct(farmL, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight);
	}
}
`;
const LAMP_LIGHT_CALL = /* glsl */`
#if defined( USE_FOG ) && defined( RE_Direct )
	if (uFarmLampOn > 0.5) farmLampLight(vFogWorldPos, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight);
#endif
`;

class LampIllumination {
  constructor(farm) {
    this.farm = farm;
    this.lights = null;                                         // the NightLights (set once they exist)
    const b0 = farm.builds[0];
    this.aviationLocal = b0.lights.aviation.map((p) => p.clone());   // yaw frame
    this.marineLocal = b0.lights.marine.map((p) => p.clone());       // static frame
    const v = () => new THREE.Vector3();
    this.uniforms = {
      uFarmLampOn: { value: 0 },
      uFarmLampPos: { value: [v(), v(), v()] },
      uFarmLampI: { value: [v(), v(), v()] },
      uFarmYawInv: { value: new THREE.Matrix4() },
      uFarmBase: { value: v() },
    };
    this.turbine = null;                                        // the turbine whose lamps light, or null
    this._c = v();
  }

  update(camera) {
    const lv = this.lights.uniforms.uLevel.value, u = this.uniforms;
    const cam = camera.getWorldPosition(this._c);
    let best = null, bestD2 = Infinity;
    for (const tb of this.farm.turbines) {
      const d2 = (tb.x - cam.x) ** 2 + (cam.y - tb.baseY - ST.towerTop) ** 2 + (tb.z - cam.z) ** 2;
      if (d2 < bestD2) { bestD2 = d2; best = tb; }
    }
    const [f0, f1] = LAMP_LIGHT_FADE_M;
    const fade = clamp((f1 - Math.sqrt(bestD2)) / (f1 - f0), 0, 1);
    const aviation = fade * lv[LAMP.aviationFlash] * NL.l864.cd / SCENE_LUX;
    const marine = fade * lv[LAMP[best.class]] * NL.marine[best.class].cd / SCENE_LUX;
    this.turbine = aviation > 0 || marine > 0 ? best : null;
    u.uFarmLampOn.value = this.turbine ? 1 : 0;
    if (!this.turbine) return;
    const P = u.uFarmLampPos.value, I = u.uFarmLampI.value, n = this.aviationLocal.length;
    for (let i = 0; i < 2; i++) {
      P[i].copy(this.aviationLocal[i % n]).applyMatrix4(best.m.nacelle);
      I[i].fromArray(RED).multiplyScalar(i < n ? aviation : 0);
    }
    // The lantern on the camera's side of the platform.
    let lb = Infinity;
    for (const m of this.marineLocal) {
      const d2 = (best.x + m.x - cam.x) ** 2 + (best.z + m.z - cam.z) ** 2;
      if (d2 < lb) { lb = d2; P[2].set(best.x + m.x, best.baseY + m.y, best.z + m.z); }
    }
    I[2].fromArray(YELLOW).multiplyScalar(marine);
    u.uFarmYawInv.value.copy(best.m.nacelle).invert();
    u.uFarmBase.value.set(best.x, best.baseY, best.z);
  }
}

// LOD 0 materials: farm-owned clones of the modeller's (same class, properties and weathering hook)
// with the lamp light added after all of three.js's lights and the atmosphere's cloud shadow on them.
const LAMP_LIT_KEY = 'farm-lamplit-v2';
class LampLitMaterials {
  constructor(lampUniforms) { this.lamp = lampUniforms; this.cache = new Map(); }

  /** The lamp-lit clone of the modeller's material `m` (the same object for repeated calls). */
  get(m) {
    let v = this.cache.get(m);
    if (v) return v;
    v = m.clone();
    v.name = `${m.name}.lamplit`;
    const hook = m.onBeforeCompile, baseKey = m.customProgramCacheKey.bind(m), lamp = this.lamp;
    v.onBeforeCompile = function (shader, renderer) {
      hook.call(this, shader, renderer);
      if (!shader.fragmentShader.includes('#include <aomap_fragment>') || !shader.fragmentShader.includes('#include <lights_physical_pars_fragment>')) return;
      Object.assign(shader.uniforms, lamp);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <lights_physical_pars_fragment>', `#include <lights_physical_pars_fragment>\n${LAMP_LIGHT_GLSL}`)
        .replace('#include <aomap_fragment>', `${LAMP_LIGHT_CALL}\n#include <aomap_fragment>`);
    };
    v.customProgramCacheKey = () => `${baseKey()}|${LAMP_LIT_KEY}`;
    v.fog = true;
    this.cache.set(m, v);
    return v;
  }

  /** One LOD's part list as the farm instances it: LOD 0 lamp-lit (in place); LOD 1 without the lamp
   *  lenses (≤ 0.3 m: sub-pixel; the sprites carry the light), whose geometries are disposed. (The
   *  monopile below the growth band is part of the LOD 0 marineGrowth part since round 2.) */
  parts(parts, lod) {
    if (lod === 0) { for (const p of parts) p.material = this.get(p.material); return parts; }
    const keep = parts.filter((p) => !/^lens(Yellow|Red)$/.test(p.name));
    for (const p of parts) if (!keep.includes(p)) p.geometry.dispose();
    return keep;
  }

  dispose() { for (const v of this.cache.values()) v.dispose(); this.cache.clear(); }
}

// ================================================================================================
// Farm
// ================================================================================================
export class Farm {
  /** @param {object} ctx { renderer, scene, camera, quality, atmosphere?, ocean?, post?, seed? } */
  constructor(ctx) {
    this.ctx = ctx;
    this.quality = ctx.quality || QUALITY.high;
    this.adls = NL.adlsDefault;
    this.root = new THREE.Group();
    this.root.name = 'farm';
    ctx.scene.add(this.root);

    // ---- layout and light classes
    const pos = layoutPositions();
    const { cls, cornerCount, added } = classifyLayout(pos);
    const rng = mulberry32(0x5eed0f + 7919 * (ctx.seed ?? 1));
    this.turbines = pos.map((p, index) => ({
      // (random draws in this order: yaw drift, rotor phase, static yaw offset; seeds reproduce frames)
      yawDrift: YAW_DRIFT_PERIODS_S.map(([lo, hi]) => ({ w: TWO_PI / (lo + (hi - lo) * rng()), p: TWO_PI * rng() })),
      index, id: p.id, di: p.di, dj: p.dj, x: p.x, z: p.z, baseY: -curvatureDrop(p.x, p.z),
      class: cls[index],                 // marine-light class: 'SPS' | 'IPS' | 'inner' | 'interior'
      idle: false,                       // unavailable: feathered and idling (4 %)
      feathered: false,                  // blades at 90° (idle, below cut-in or above cut-out)
      pitchDeg: 0,                       // blade pitch of the rotor geometry in use
      yawDeg: SEA.windFromDeg,           // compass azimuth the rotor faces
      yawOffsetDeg: 0,                   // current misalignment target relative to the wind
      rpm: 0,                            // current rotor speed
      phase: TWO_PI * rng(),             // rotor angle at t = 0 (rad); independent per turbine
      lod: FAR_LOD,
      rotorLod: 1,                       // LOD of the rotor geometry (LOD 0 turbines: see ROTOR_DETAIL_PX)
      visible: false,
      // internal state
      yawStatic: gaussian(rng) * TURBINE.yawOffsetSigmaDeg * Math.sqrt(YAW_STATIC_SHARE),
      omega: 0, omegaTarget: 0, angle: 0,
      m: { static: new THREE.Matrix4(), nacelle: new THREE.Matrix4(), rotor: new THREE.Matrix4() },
    }));
    this.hero = this.turbines.find((t) => t.di === 0 && t.dj === 0);
    // The hero reproduces the reference frame at t = 0 (SCENE-SPEC §4.9, §20 item 3): blade 0 at the
    // reference phase and the rotor exactly into the wind; its misalignment drifts from zero.
    this.hero.phase = TURBINE.referencePhaseDeg * DEG;
    this.hero.yawStatic = 0;
    for (const d of this.hero.yawDrift) d.p = 0;
    // 4 % of turbines are unavailable (idle, feathered), chosen by seed; never the hero.
    const pool = this.turbines.filter((t) => t !== this.hero);
    for (let i = Math.round(this.turbines.length * TURBINE.idleFraction); i > 0 && pool.length; i--) pool.splice(Math.floor(rng() * pool.length), 1)[0].idle = true;
    if (globalThis.NJOW_DEV !== false) {
      const count = (c) => this.turbines.filter((t) => t.class === c).length;
      this.classCounts = { SPS: count('SPS'), IPS: count('IPS'), inner: count('inner'), interior: count('interior'), cornersSPS: cornerCount, addedSPS: added.map((k) => pos[k].id) };
    }

    // ---- substation (SCENE-SPEC §6): position only, the group is already oriented
    this.substation = buildSubstation();
    const [sx, sz] = SUBSTATION.position;
    this.substation.position.set(sx, -curvatureDrop(sx, sz), sz);
    this.root.add(this.substation);
    this.substation.updateMatrixWorld(true);

    // ---- per-turbine pose texture (+ the substation's position in texel N)
    const N = this.turbines.length;
    this.pose = new PoseTexture(N + 1);
    this.substation.position.toArray(this.pose.data, 4 * N);

    // ---- turbine geometry: LOD 0 / 1 instanced per part; far turbines and every mirror image one FarBatch
    this.builds = [];
    for (let lod = 0; lod < FAR_LOD; lod++) this.builds.push(buildTurbine({ lod }));
    this.dims = this.builds[0].dims;
    this.farMaterial = createFarMaterial(this.pose.uniform);
    this.far = new FarBatch(farTurbineGeometry(), this.farMaterial, N, this.root, `farm.lod${FAR_LOD}.far`);
    this.lampLight = new LampIllumination(this);
    this.lampLit = new LampLitMaterials(this.lampLight.uniforms);
    for (const [lod, b] of this.builds.entries()) for (const frame of ['static', 'nacelle', 'rotor']) b[frame] = this.lampLit.parts(b[frame], lod);
    this.lodSets = this.builds.map((b, lod) => ({
      static: new InstanceSet(b.static, N, this.root, `farm.lod${lod}.static`),
      nacelle: new InstanceSet(b.nacelle, N, this.root, `farm.lod${lod}.nacelle`),
    }));
    // Rotors in two roles per LOD: operating (0° up to rated wind; above it the pitch schedule, built
    // on demand and swapped in as geometry) and feathered at 90° (idle, below cut-in, above cut-out).
    const feathered = this.builds.map((b, lod) => this.lampLit.parts(buildRotor({ lod, pitchDeg: FEATHER_PITCH_DEG }), lod));
    const rotorSets = (lodParts, role) => lodParts.map((parts, lod) => new InstanceSet(parts, N, this.root, `farm.lod${lod}.rotor.${role}`));
    this.rotorSets = { operating: rotorSets(this.builds.map((b) => b.rotor), 'operating'), feathered: rotorSets(feathered, 'feathered') };
    this._featheredParts = feathered;
    this._rotorParts = new Map([[0, this.builds.map((b) => b.rotor)]]);   // operating geometry by pitch
    this.operatingPitchDeg = 0;
    this._pitchWanted = 0;
    this._pitchHeld = 0;

    // ---- the substation beyond the LOD 1 distance
    this.substationFar = new FarBatch(farSubstationGeometry(this.substation), this.farMaterial, 1, this.root, 'farm.substation.far');
    this._subCentre = new THREE.Box3().setFromObject(this.substation).getCenter(new THREE.Vector3());
    this._subIsFar = false;
    this._subList = [N];

    // ---- night lights, sea contact, wind
    this.lights = this.lampLight.lights = new NightLights(this, ctx);
    this._piles = this._measurePiles();
    this._keepSub = this._substationKeepOut();
    ctx.ocean?.setPiles?.(this.pilePositions());
    this.wind = { u10: SEA.windSpeed, fromDeg: SEA.windFromDeg, regime: 'operating' };
    this.setWind(SEA.windSpeed, SEA.windFromDeg);

    // ---- per-frame scratch
    this._lastT = null;
    this.mirrorRange = MIRROR_RANGE_M;   // public: Infinity puts every turbine back into the mirror (comparisons)
    this._cam = new THREE.Vector3();
    this._sphere = new THREE.Sphere(new THREE.Vector3(), CULL_RADIUS);
    this._mirror = new THREE.Sphere(new THREE.Vector3(), CULL_RADIUS);
    this._frustum = new THREE.Frustum();
    this._pv = new THREE.Matrix4();
    const lists = (n) => Array.from({ length: n }, () => new Int32Array(N));
    this._lists = { near: lists(FAR_LOD), nearC: new Int32Array(FAR_LOD), rest: lists(FAR_LOD), restN: new Int32Array(FAR_LOD), rotor: lists(2 * FAR_LOD), rotorN: new Int32Array(2 * FAR_LOD), rotorC: new Int32Array(2 * FAR_LOD), far: new Int32Array(N), mirror: new Int32Array(N) };
    this._size = new THREE.Vector2();
    if (globalThis.NJOW_DEV !== false) {   // dev page readout; the scale report is a dev hook
      this.stats = { lod: [0, 0, 0], culled: 0, casters: 0, lamps: this.lights.count, updateMs: 0 };
      this.lattice = registerLatticeScale(this.turbines);
    }
  }

  // ---------------------------------------------------------------- public API

  /** Wind at 10 m (m/s) and the compass direction it blows FROM (deg). */
  setWind(u10, fromDeg = this.wind.fromDeg) {
    if (!Number.isFinite(u10)) return;
    const uHub = hubWind(u10);
    const regime = uHub < TURBINE.cutIn ? 'idling' : (uHub >= TURBINE.cutOut ? 'parked' : 'operating');
    this.wind = { u10, fromDeg: Number.isFinite(fromDeg) ? fromDeg : this.wind.fromDeg, uHub, regime };
    const rpm = rotorRpm(u10);                                  // idleRpm below cut-in, 0 above cut-out
    for (const t of this.turbines) {
      t.feathered = t.idle || regime !== 'operating';
      t.omegaTarget = (t.idle ? TURBINE.idleRpm : rpm) * TWO_PI / 60;
    }
    if (regime === 'operating') { this._pitchWanted = operatingPitchDeg(uHub); this._pitchHeld = 0; }
  }

  setPhotoLook(on) { setPhotoLook(!!on); }
  setADLS(on) { this.adls = !!on; }
  setQuality(q) { if (q) this.quality = q; }

  /** Sea-surface contact for the ocean's wash rings: TPs, boat-landing tubes, substation jacket members. */
  pilePositions() { return this._piles.map((p) => ({ ...p })); }

  /**
   * Camera keep-out volumes near `pos` (world metres), for the shell's camera clamp. Fills `out`
   * (cleared first) with world-space volumes at the true surfaces (callers add their clearance):
   *   { kind: 'obb', center: Vector3, axes: [Vector3 ×3] (unit), half: Vector3, owner }
   *   { kind: 'capsule', a: Vector3, b: Vector3, radius, owner }   (a sphere when a = b)
   * owner: a turbine ID ('F01') or 'substation'. For every turbine whose axis is within `range` m
   * (horizontal) of pos: the nacelle box and the cooler on its roof (yaw frame), the hub/spinner
   * sphere, and each blade as three capsules at its current angle. For the substation within
   * range: its topside box and its eight jacket legs. Towers, TPs and platforms are the shell's own
   * radial keep-out (main.js structureKeepOut). The volumes are pooled and valid until the next
   * call; no allocation after the first calls.
   * @returns {Array} out
   */
  keepOuts(pos, out = [], range = KEEP_OUT_RANGE_M) {
    const K = this._keep || (this._keep = { pool: [], n: 0 });
    K.n = 0;
    out.length = 0;
    const get = (kind, owner) => {
      const e = K.pool[K.n++] || (K.pool[K.n - 1] = { center: new THREE.Vector3(), axes: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()], half: new THREE.Vector3(), radius: 0, a: new THREE.Vector3(), b: new THREE.Vector3() });
      e.kind = kind; e.owner = owner;
      out.push(e);
      return e;
    };
    const obb = (m, box, owner) => {
      const e = get('obb', owner);
      e.center.fromArray(box[0]).add(e.half.fromArray(box[1])).multiplyScalar(0.5).applyMatrix4(m);
      e.half.fromArray(box[1]).sub(e.axes[0].fromArray(box[0])).multiplyScalar(0.5);
      m.extractBasis(e.axes[0], e.axes[1], e.axes[2]);
      for (const a of e.axes) a.normalize();
    };
    const cone = TURBINE.coneDeg * DEG;
    for (const tb of this.turbines) {
      if ((tb.x - pos.x) ** 2 + (tb.z - pos.z) ** 2 > range * range) continue;
      const m = tb.m, id = tb.id;
      obb(m.nacelle, NACELLE_BOX, id);
      obb(m.nacelle, COOLER_BOX, id);
      obb(m.nacelle, HELI_BOX, id);
      const hub = get('capsule', id);
      hub.b.copy(hub.a.setFromMatrixPosition(m.rotor));
      hub.radius = KEEP_HUB_R;
      for (let k = 0; k < 3; k++) {
        // Blade k's pitch axis in the rotor frame (cone included), then through the rotor matrix.
        const phi = k * TWO_PI / 3, bx = -Math.sin(phi) * Math.cos(cone), by = Math.cos(phi) * Math.cos(cone), bz = Math.sin(cone);
        for (const [s0, s1, r] of KEEP_BLADE) {
          const e = get('capsule', id);
          e.a.set(bx * s0, by * s0, bz * s0).applyMatrix4(m.rotor);
          e.b.set(bx * s1, by * s1, bz * s1).applyMatrix4(m.rotor);
          e.radius = r;
        }
      }
    }
    const S = this._keepSub;
    if (S && (S.center.x - pos.x) ** 2 + (S.center.z - pos.z) ** 2 < (range + S.reach) ** 2) {
      const e = get('obb', 'substation');
      e.center.copy(S.center); e.half.copy(S.half);
      S.axes.forEach((a, i) => e.axes[i].copy(a));
      for (const leg of S.legs) {
        const c = get('capsule', 'substation');
        c.a.copy(leg.a); c.b.copy(leg.b); c.radius = leg.radius;
      }
    }
    return out;
  }

  /**
   * Push the point `p` (Vector3, modified in place) out of every keep-out volume near it, each grown
   * by `clearance` metres (the moving blades push a camera ahead of them). Returns true if p moved.
   */
  resolveKeepOuts(p, clearance = 1) {
    const list = this.keepOuts(p, this._keepList || (this._keepList = []));
    const v = this._keepV || (this._keepV = new THREE.Vector3());
    const q = this._keepQ || (this._keepQ = new THREE.Vector3());
    let moved = false;
    for (let pass = 0; pass < 2; pass++) {
      for (const e of list) {
        if (e.kind === 'obb') {
          v.subVectors(p, e.center);
          let best = -1, pen = Infinity, sgn = 1;
          for (let i = 0; i < 3; i++) {
            const loc = v.dot(e.axes[i]), d = e.half.getComponent(i) + clearance - Math.abs(loc);
            if (d <= 0) { best = -1; break; }
            if (d < pen) { pen = d; best = i; sgn = loc < 0 ? -1 : 1; }
          }
          if (best < 0) continue;
          p.addScaledVector(e.axes[best], sgn * (pen + 1e-4));
          moved = true;
        } else {
          const t = clamp(q.subVectors(p, e.a).dot(v.subVectors(e.b, e.a)) / Math.max(v.lengthSq(), 1e-9), 0, 1);
          q.copy(e.a).addScaledVector(v, t);
          const R = e.radius + clearance, d = v.subVectors(p, q).length();
          if (d >= R) continue;
          if (d < 1e-6) v.set(0, 1, 0); else v.multiplyScalar(1 / d);
          p.copy(q).addScaledVector(v, R + 1e-4);
          moved = true;
        }
      }
    }
    return moved;
  }

  update(dt, t, camera) {
    const t0 = globalThis.NJOW_DEV !== false ? performance.now() : 0;   // dev page readout (stats)
    const step = this._animationStep(t, dt);
    this._updatePitch(dt, step);
    this._animate(t, step);
    this._assign(camera);
    const atm = this.ctx.atmosphere;
    const sunEl = Number.isFinite(atm?.sunElevationDeg) ? atm.sunElevationDeg : Math.asin(clamp(U.uSunDir.value.y, -1, 1)) / DEG;
    this.lights.update(t, sunEl, this.adls, this._exposed(), camera);
    this.lampLight.update(camera);
    if (globalThis.NJOW_DEV !== false) this.stats.updateMs = performance.now() - t0;
  }

  dispose() {
    for (const s of this.lodSets) { s.static.dispose(this.root); s.nacelle.dispose(this.root); }
    for (const sets of Object.values(this.rotorSets)) for (const s of sets) s.dispose(this.root);
    for (const b of this.builds) for (const p of [...b.static, ...b.nacelle]) p.geometry.dispose();
    for (const lodParts of [...this._rotorParts.values(), this._featheredParts]) for (const parts of lodParts) for (const p of parts) p.geometry.dispose();
    this._rotorParts.clear();
    for (const b of [this.far, this.substationFar]) b.dispose();
    this.farMaterial.dispose();
    this.pose.dispose();
    this.lights.dispose();
    this.lampLit.dispose();
    this.substation.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
    this.root.parent?.remove(this.root);
    if (globalThis.NJOW_DEV !== false) {   // scale report: a rebuilt farm registers its own lattice rows
      for (const e of this.lattice.entries.splice(0)) { const i = SCALE_REGISTRY.indexOf(e); if (i >= 0) SCALE_REGISTRY.splice(i, 1); }
    }
  }

  // ---------------------------------------------------------------- animation

  // Animation seconds since the last update, or null when the clock jumped (first frame, a new
  // ?t=, a seek): then every turbine is placed in its settled closed-form state for time t.
  _animationStep(t, dt) {
    const last = this._lastT;
    this._lastT = t;
    if (last === null) return null;
    const s = t - last;
    return s < 0 || s > Math.max(0.5, 4 * dt) ? null : s;
  }

  _updatePitch(dt, step) {
    if (this._pitchWanted === this.operatingPitchDeg) return;
    this._pitchHeld += dt;
    if (step === null || dt === 0 || this._pitchHeld >= PITCH_SETTLE_S) this._setOperatingPitch(this._pitchWanted);
  }

  // LOD 0 / 1 rotors at a new operating pitch (the far batches pitch their blades in the shader).
  _setOperatingPitch(p) {
    let parts = this._rotorParts.get(p);
    if (!parts) this._rotorParts.set(p, parts = this.builds.map((b, lod) => this.lampLit.parts(buildRotor({ lod, pitchDeg: p }), lod)));
    this.rotorSets.operating.forEach((set, lod) => set.setGeometry(parts[lod]));
    this.operatingPitchDeg = p;
    for (const [q, old] of this._rotorParts) {                  // keep the built-in 0° and the current pitch
      if (q === 0 || q === p) continue;
      for (const lodParts of old) for (const part of lodParts) part.geometry.dispose();
      this._rotorParts.delete(q);
    }
  }

  // Yaw, rotor speed and angle of every turbine, its matrices, and the pose texture.
  _animate(t, step) {
    const w = this.wind, rate = TURBINE.yawRateDegPerS, N = this.turbines.length, d = this.pose.data;
    const driftAmp = TURBINE.yawOffsetSigmaDeg * Math.sqrt((1 - YAW_STATIC_SHARE) / YAW_DRIFT_PERIODS_S.length) * Math.SQRT2;
    const k = step === null ? 1 : 1 - Math.exp(-step / ROTOR_SPEED_TAU_S);
    const pose = this._pose || (this._pose = {});
    let changed = false;
    const put = (o, v) => { v = Math.fround(v); if (d[o] !== v) { d[o] = v; changed = true; } };
    for (const tb of this.turbines) {
      // Yaw: into the wind plus a slowly drifting misalignment, turned at ≤ 0.5°/s.
      let off = tb.yawStatic;
      for (const dr of tb.yawDrift) off += driftAmp * Math.sin(dr.w * t + dr.p);
      tb.yawOffsetDeg = off;
      const target = w.fromDeg + off;
      if (step === null) tb.yawDeg = target;
      else tb.yawDeg += clamp(wrap180(target - tb.yawDeg), -rate * step, rate * step);
      tb.yawDeg = ((tb.yawDeg % 360) + 360) % 360;
      // Rotor: speed eases toward the target; the angle integrates it (closed form on a clock jump).
      if (step === null) {
        tb.omega = tb.omegaTarget;
        tb.angle = (tb.phase + tb.omega * t) % TWO_PI;
      } else {
        const w0 = tb.omega;
        tb.omega += (tb.omegaTarget - tb.omega) * k;
        tb.angle = (tb.angle + 0.5 * (w0 + tb.omega) * step) % TWO_PI;
      }
      tb.rpm = tb.omega * 60 / TWO_PI;
      tb.pitchDeg = tb.feathered ? FEATHER_PITCH_DEG : this.operatingPitchDeg;
      pose.x = tb.x; pose.y = tb.baseY; pose.z = tb.z;
      pose.yawRad = yawForRotorAzimuth(tb.yawDeg);
      pose.spinRad = -tb.angle;                                 // clockwise seen from upwind (§4.9)
      composeTurbineMatrices(pose, tb.m);
      const o = 4 * tb.index, o1 = 4 * (N + 1 + tb.index);
      put(o, tb.x); put(o + 1, tb.baseY); put(o + 2, tb.z); put(o + 3, pose.yawRad);
      put(o1, pose.spinRad); put(o1 + 1, tb.pitchDeg * DEG);
    }
    if (changed) this.pose.push();
  }

  // ---------------------------------------------------------------- culling, LOD, instance packing

  _assign(camera) {
    const cam = camera.getWorldPosition(this._cam);
    this._frustum.setFromProjectionMatrix(this._pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const shadows = this._shadowFrusta();
    const q = this.quality;
    const fovScale = camera.isPerspectiveCamera
      ? Math.tan(camera.fov * DEG / 2) / camera.zoom / Math.tan(LOD_REFERENCE_VFOV_DEG * DEG / 2) : 1;
    const limits = [q.lod0Distance, q.lod1Distance], mirrorD = this.mirrorRange * Math.max(fovScale, 1);
    const mirrorY = -curvatureDrop(cam.x, cam.z), hub = this.dims.hubHeight;
    const S = globalThis.NJOW_DEV !== false && this.stats, Ls = this._lists, T = this.turbines;
    // blade chord in px at a (FOV-corrected) distance of 1 m: chord × reference focal length
    const chordPx1 = BLADE_MAX_CHORD * 0.5 * this.ctx.renderer.getDrawingBufferSize(this._size).y / Math.tan(LOD_REFERENCE_VFOV_DEG * DEG / 2);
    // Per LOD 0 / 1: shadow casters first, then the rest in view. Far batch: the view's list (far
    // turbines in view) and the mirror's (every turbine, any LOD, whose reflection is in view within
    // mirrorD: true distance, or the FOV-corrected one when that is longer).
    let nFar = 0, nMirror = 0;
    Ls.nearC.fill(0); Ls.restN.fill(0);
    if (globalThis.NJOW_DEV !== false) { S.lod.fill(0); S.culled = 0; S.casters = 0; }
    for (const tb of T) {
      // LOD from the distance to the tower axis (clamped to the hub), scaled to the reference FOV.
      const dy = cam.y - clamp(cam.y, tb.baseY, tb.baseY + hub);
      const d = Math.hypot(tb.x - cam.x, dy, tb.z - cam.z) * fovScale;
      let lod = tb.lod;
      while (lod > 0 && d < limits[lod - 1] * (1 - LOD_HYSTERESIS)) lod--;
      while (lod < FAR_LOD && d > limits[lod] * (1 + LOD_HYSTERESIS)) lod++;
      tb.lod = lod;
      tb.rotorLod = lod > 0 || chordPx1 / d < ROTOR_DETAIL_PX * (tb.rotorLod ? 1 + LOD_HYSTERESIS : 1 - LOD_HYSTERESIS) ? 1 : 0;
      // In the view, in its mirror image in the sea (the ocean's planar reflection), in a shadow frustum.
      this._sphere.center.set(tb.x, tb.baseY + CULL_CENTRE_Y, tb.z);
      this._mirror.center.set(tb.x, 2 * mirrorY - (tb.baseY + CULL_CENTRE_Y), tb.z);
      const inView = this._frustum.intersectsSphere(this._sphere), inMirror = this._frustum.intersectsSphere(this._mirror);
      const caster = lod < FAR_LOD && shadows.some((fr) => fr.intersectsSphere(this._sphere));
      tb.visible = inView || inMirror;
      if (!tb.visible && !caster) { if (globalThis.NJOW_DEV !== false) S.culled++; continue; }
      if (globalThis.NJOW_DEV !== false) S.lod[lod]++;
      if (inMirror && d < mirrorD) Ls.mirror[nMirror++] = tb.index;
      if (lod === FAR_LOD) { if (inView) Ls.far[nFar++] = tb.index; continue; }
      if (caster) { Ls.near[lod][Ls.nearC[lod]++] = tb.index; if (globalThis.NJOW_DEV !== false) S.casters++; } else if (inView) Ls.rest[lod][Ls.restN[lod]++] = tb.index;
    }
    this.far.set(Ls.far, nFar, Ls.mirror, nMirror);
    this._assignSubstation(cam, fovScale, q.lod1Distance);
    for (let l = 0; l < FAR_LOD; l++) {
      const list = Ls.near[l], casters = Ls.nearC[l], n = casters + Ls.restN[l];
      list.set(Ls.rest[l].subarray(0, Ls.restN[l]), casters);   // casters first, then the rest
      this.lodSets[l].static.commit(list, n, casters, T, 'static');
      this.lodSets[l].nacelle.commit(list, n, casters, T, 'nacelle');
    }
    // Rotors by rotor LOD and role (operating / feathered), every caster before every non-caster.
    const rn = Ls.rotorN.fill(0), rc = Ls.rotorC.fill(0);
    for (const casters of [true, false]) for (let l = 0; l < FAR_LOD; l++) {
      const c = Ls.nearC[l];
      for (let s = casters ? 0 : c, end = casters ? c : c + Ls.restN[l]; s < end; s++) {
        const tb = T[Ls.near[l][s]], k = 2 * tb.rotorLod + (tb.feathered ? 1 : 0);
        Ls.rotor[k][rn[k]++] = tb.index;
        if (casters) rc[k]++;
      }
    }
    for (let k = 0; k < 2 * FAR_LOD; k++) this.rotorSets[k % 2 ? 'feathered' : 'operating'][k >> 1].commit(Ls.rotor[k], rn[k], rc[k], T, 'rotor');
  }

  // The substation beyond the LOD 1 distance (FOV-corrected, with the turbines' hysteresis) is drawn
  // as its merged far mesh, in the view and in the ocean's mirror.
  _assignSubstation(cam, fovScale, limit) {
    const d = cam.distanceTo(this._subCentre) * fovScale;
    const far = this._subIsFar = d > limit * (this._subIsFar ? 1 - LOD_HYSTERESIS : 1 + LOD_HYSTERESIS);
    this.substationFar.set(this._subList, far ? 1 : 0);
    this.substation.visible = !far;
  }

  // Frusta of the shadow cameras that will render this frame (sun by day, moon at night).
  _shadowFrusta() {
    const out = [];
    const atm = this.ctx.atmosphere;
    for (const light of [atm?.sunLight, atm?.moonLight]) {
      if (!light?.castShadow || !(light.shadow.autoUpdate || light.shadow.needsUpdate)) continue;
      light.shadow.updateMatrices(light);
      out.push(light.shadow.getFrustum());
    }
    return out;
  }

  // Scene radiance → exposed units (the halo size of the lamps depends on it).
  _exposed() {
    const post = this.ctx.post, atm = this.ctx.atmosphere;
    if (Number.isFinite(post?.exposure) && post.exposure > 0) return post.exposure;
    return this.ctx.renderer.toneMappingExposure * (Number.isFinite(atm?.preExposure) ? atm.preExposure : 1);
  }

  // ---------------------------------------------------------------- measurements

  _measurePiles() {
    const piles = [];
    const r = this.dims.waterlineRadius, tubes = this.builds[0].landingTubes;
    for (const t of this.turbines) {
      piles.push({ x: t.x, z: t.z, radius: r });
      for (const tube of tubes) piles.push({ x: t.x + tube.x, z: t.z + tube.z, radius: tube.radius });
    }
    const sub = this.substation, v = new THREE.Vector3();
    for (const s of waterlineSections(sub, createTurbineMaterials().growth)) {
      v.set(s.x, 0, s.z).applyMatrix4(sub.matrixWorld);
      piles.push({ x: v.x, z: v.z, radius: s.radius });
    }
    return piles;
  }

  // Substation keep-out, world frame: the topside's bounding box (from its meshes, group frame) and
  // the jacket legs, each the line through its sections at the waterline and at +12 m (inside the
  // yellow zone), from 3 m below the sea to the topside interface.
  _substationKeepOut() {
    const sub = this.substation, m = sub.matrixWorld, box = new THREE.Box3(), tmp = new THREE.Box3();
    for (const o of sub.children) {
      if (!o.isMesh || !/topside/.test(o.name)) continue;
      o.geometry.computeBoundingBox();
      box.union(tmp.copy(o.geometry.boundingBox).applyMatrix4(o.matrix));
    }
    if (box.isEmpty()) return null;
    const center = box.getCenter(new THREE.Vector3()), half = box.getSize(new THREE.Vector3()).multiplyScalar(0.5);
    const axes = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    m.extractBasis(...axes);
    axes.forEach((a) => a.normalize());
    const mats = createTurbineMaterials(), LEVEL = 12;
    const lo = waterlineSections(sub, mats.growth, 0).filter((s) => s.radius > KEEP_LEG_MIN_R);
    const hi = waterlineSections(sub, mats.yellow, LEVEL).filter((s) => s.radius > KEEP_LEG_MIN_R);
    const legs = [];
    for (const a of lo) {
      let b = null, bd = Infinity;
      for (const h of hi) { const d = Math.hypot(h.x - a.x, h.z - a.z); if (d < bd) { bd = d; b = h; } }
      if (!b || bd > 5) continue;
      const at = (y) => new THREE.Vector3(a.x + (b.x - a.x) * y / LEVEL, y, a.z + (b.z - a.z) * y / LEVEL).applyMatrix4(m);
      legs.push({ a: at(-3), b: at(box.min.y), radius: a.radius });
    }
    return { center: center.applyMatrix4(m), half, axes, legs, reach: Math.hypot(half.x, half.z) };
  }

}

// Lattice vectors measured from the placed positions for the scale report (a dev hook): mean
// horizontal distance over every pair of neighbours along a (next in the row) and along b (next
// row, same column). `entries` are the registered rows, which dispose() takes out again.
function registerLatticeScale(turbines) {
  const at = new Map(turbines.map((t) => [`${t.di},${t.dj}`, t])), entries = [];
  const reg = (name, di, dj) => {
    let s = 0, n = 0;
    for (const t of turbines) {
      const u = at.get(`${t.di + di},${t.dj + dj}`);
      if (u) { s += Math.hypot(u.x - t.x, u.z - t.z); n++; }
    }
    const e = {
      name, measure: () => ({ x: s / n, y: s / n, z: s / n }),
      expect: { axis: 'x', metres: SCALE_TABLE[name].metres, tolerance: SCALE_TABLE[name].tolerance },
      source: `src/farm/farm.js (mean over ${n} placed neighbour pairs)`,
    };
    registerScale(e);
    entries.push(e);
    return s / n;
  };
  return { a: reg('lattice.a', 1, 0), b: reg('lattice.b', 0, 1), entries };
}
