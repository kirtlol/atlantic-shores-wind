// Seabirds (owner: wildlife). See ARCHITECTURE.md "life/birds.js" and SCENE-SPEC §15.
//
//   new Birds(ctx)                 ctx: renderer, scene, camera, quality, ocean?, farm?, blitz?, clock?, seed?
//   birds.update(dt, t, camera)    per frame (after the farm, before the blitz)
//   birds.setEnabled(on), birds.setQuality(q), birds.dispose()
//   birds.seedFlock(blitz, n?)     put a working flock on a blitz at once (blitz.trigger calls it)
//   birds.count                    birds currently alive (perched + flying + on the water)
//   birds.stats                    { dips, plunges } since construction (diagnostics)
//
// Species (config LIFE.birds, SCENE-SPEC §15): herring gull (1.40 m span), laughing gull (1.04 m),
// common tern (0.85 m), northern gannet (1.75 m), in the proportions of their season off New Jersey.
// Behaviour:
//   - gulls (and a few terns) loaf on the transition-piece railings of turbines near the camera,
//     facing into the wind; more of them roost there at night;
//   - a few birds commute past at 5-30 m (gannets at their median 12 m);
//   - over an active blitz a flock of dozens gathers fast: gulls wheel low and tight over the latest
//     strikes and dip for bait every few seconds, terns hover 1-6 m up into the wind, head cocked
//     down, and plunge; gannets circle at 11-60 m (most at 10-30 m) and drop near-vertically
//     (tip-over, wings half-folded, then swept back) with their splash via blitz.splashAt, stay under
//     for seconds, sit on the water and run off the surface to fly again. When the school goes
//     down, many gulls settle on the water and terns search higher;
//   - at dusk flying birds go to roost on the platforms; none fly at night.
// Rendering: one InstancedMesh per species (procedural body, head, bill, tail, two-segment wings
// with a thin section, legs; vertex-coloured plumage, top and underside differing), the pose (arm
// and hand elevation, fold, legs, head pitch, tail fan) applied in the vertex shader from
// per-instance attributes the CPU writes each frame. castShadow = false (the pose is
// vertex-animated). Birds under FAR_LOD_PX of wingspan on screen are coverage-true sprites instead
// (BirdSprites), and are simulated at 15 Hz beyond 250 m.
import * as THREE from 'three';
import { U, LAYER_REFLECT, mulberry32, registerScale, curvatureDrop, azimuthToDir } from '../shared.js';
import { LIFE, TURBINE, QUALITY } from '../config.js';
import { applyAtmosphere } from '../env/fog.js';
import { lifeGlsl, lifeMesh, gridGeometry, InstanceBuffer } from './blitz.js';

const G = 9.81;
const DEG = Math.PI / 180;
const TAU = 2 * Math.PI;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = THREE.MathUtils.clamp;
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const LB = LIFE.birds;

// ================================================================================================
// Species
// ================================================================================================
// Sizes: config LIFE.birds (SOURCED). Flight: gulls from Pennycuick 2001, J. Exp. Biol. 204:3283,
// Tables 1-2 (herring gull 1.35 m span / 0.200 m² / 11.8 m/s / 3.13 Hz; black-headed gull, the
// laughing gull's closest measured relative, 0.963 m / 0.0985 m² / 10.1 m/s / 3.27 Hz); common tern
// 3.5 Hz commuting (Birds of the World, Common Tern: Behavior); northern gannet 3.9 Hz (tri-axial
// accelerometers; "The role of wingbeat frequency and amplitude in flight power", J. R. Soc. Interface
// 19: 20220168, 2022). Hovering rates ESTIMATED.
// Wing areas: scaled to the LIFE span at the measured (gulls) or typical (tern, gannet: aspect ratio
// ≈ 11.5, ESTIMATED) aspect ratio. Plumage: field-guide colours (sRGB).
// amp: wingbeat amplitude [arm, hand (rad), hand phase lag (rad)]; glide: chance of a glide phase in
// cruise (gulls and gannets flap-glide, terns flap almost continuously); stations [z, half width,
// half height, centre y] (fractions of L); months: relative abundance off New Jersey, Jan..Dec
// (ESTIMATED from NJ seabird surveys: laughing gull and common tern breed in summer; gannets winter
// and migrate offshore, rare in summer). The two gulls share one body (as fractions of their length).
const GULL = [[0.40, 0.004, 0.004, 0.02], [0.33, 0.010, 0.016, 0.022], [0.30, 0.028, 0.034, 0.03], [0.25, 0.036, 0.042, 0.028],
  [0.19, 0.030, 0.033, 0.018], [0.13, 0.052, 0.062, 0.004], [0.05, 0.072, 0.080, -0.006], [-0.05, 0.075, 0.078, 0.0],
  [-0.15, 0.062, 0.062, 0.006], [-0.24, 0.042, 0.040, 0.012], [-0.30, 0.026, 0.020, 0.016]];
export const BIRD_SPECIES = {
  herringGull: {
    wingspan: LB.herringGull.wingspan, length: LB.herringGull.length,
    wingArea: 0.200 * (1.40 / 1.35) ** 2, cruise: 11.8, flapHz: 3.13, hoverHz: 3.6,
    arm: 0.42, handSweepDeg: 16, amp: [0.52, 0.42, 0.8], glide: 0.45, legLen: 0.12,
    stations: GULL,
    tail: { z0: -0.26, halfBase: 0.045, halfTip: 0.085, shape: 'square' },
    bill: 0.33, headZ: 0.19,
    colours: { body: '#f1f1ee', head: '#f1f1ee', cap: null, mantle: '#a9b3bb', tip: '#1b1b1c', trailing: '#ecebe7',
      under: '#e4e6e7', underTip: '#2e2e30', bill: '#e0b637', legs: '#d9a59e', tail: '#f1f1ee' },
    tipFrom: 0.75, juvenile: [0.34, 0.26, 0.19], juvenileShare: 0.3,
    months: [1, 1, 1, 0.9, 0.7, 0.6, 0.6, 0.6, 0.7, 0.9, 1, 1],
  },
  laughingGull: {
    wingspan: LB.laughingGull.wingspan, length: LB.laughingGull.length,
    wingArea: 0.0985 * (1.04 / 0.963) ** 2, cruise: 10.1, flapHz: 3.27, hoverHz: 3.8,
    arm: 0.41, handSweepDeg: 18, amp: [0.55, 0.45, 0.8], glide: 0.35, legLen: 0.13,
    stations: GULL,
    tail: { z0: -0.27, halfBase: 0.042, halfTip: 0.08, shape: 'square' },
    bill: 0.32, headZ: 0.18,
    colours: { body: '#efefec', head: '#1c1c1e', cap: null, mantle: '#5a6167', tip: '#141414', trailing: '#e6e6e2',
      under: '#c9cdd0', underTip: '#2a2a2a', bill: '#6e1e1e', legs: '#3a2222', tail: '#efefec' },
    tipFrom: 0.68, juvenile: [0.55, 0.47, 0.40], juvenileShare: 0.15,
    months: [0, 0, 0.1, 0.6, 1, 1, 1, 1, 1, 0.7, 0.2, 0],
  },
  commonTern: {
    wingspan: LB.commonTern.wingspan, length: LB.commonTern.length,
    wingArea: 0.85 ** 2 / 11.5, cruise: 9.0, flapHz: 3.5, hoverHz: 4.6,
    arm: 0.37, handSweepDeg: 24, amp: [0.62, 0.5, 0.75], glide: 0.08, legLen: 0.06,
    stations: [[0.40, 0.003, 0.003, 0.01], [0.29, 0.010, 0.013, 0.012], [0.26, 0.030, 0.034, 0.02], [0.21, 0.036, 0.040, 0.02],
      [0.16, 0.034, 0.036, 0.012], [0.09, 0.060, 0.066, 0.0], [0.0, 0.066, 0.070, -0.004], [-0.09, 0.056, 0.056, 0.004],
      [-0.17, 0.034, 0.030, 0.01], [-0.22, 0.020, 0.014, 0.012]],
    tail: { z0: -0.18, halfBase: 0.04, halfTip: 0.075, shape: 'fork' },
    bill: 0.29, headZ: 0.16,
    colours: { body: '#e9ecee', head: '#f0f2f3', cap: '#141414', mantle: '#b9c3ca', tip: '#737c83', trailing: '#c9d1d6',
      under: '#f0f2f3', underTip: '#a0a6aa', bill: '#d23a22', legs: '#c83a26', tail: '#f2f3f4' },
    tipFrom: 0.74, juvenile: [0.92, 0.9, 0.86], juvenileShare: 0.1,
    months: [0, 0, 0, 0.3, 1, 1, 1, 1, 0.8, 0.2, 0, 0],
  },
  gannet: {
    wingspan: LB.gannet.wingspan, length: LB.gannet.length,
    wingArea: 1.75 ** 2 / 11.5, cruise: 14.0, flapHz: 3.9, hoverHz: 4.2,
    arm: 0.45, handSweepDeg: 20, amp: [0.40, 0.3, 0.7], glide: 0.5, legLen: 0.065,
    stations: [[0.42, 0.004, 0.004, 0.0], [0.32, 0.012, 0.022, 0.006], [0.29, 0.026, 0.034, 0.012], [0.24, 0.032, 0.038, 0.012],
      [0.18, 0.030, 0.032, 0.006], [0.11, 0.046, 0.052, 0.0], [0.04, 0.066, 0.070, -0.006], [-0.06, 0.070, 0.068, -0.002],
      [-0.16, 0.058, 0.054, 0.004], [-0.25, 0.036, 0.030, 0.008], [-0.31, 0.022, 0.016, 0.01]],
    tail: { z0: -0.28, halfBase: 0.04, halfTip: 0.0, shape: 'wedge' },
    bill: 0.32, headZ: 0.20,
    colours: { body: '#f4f4f0', head: '#e3d49b', cap: null, mantle: '#f4f4f0', tip: '#151515', trailing: '#f4f4f0',
      under: '#f2f2ee', underTip: '#1a1a1a', bill: '#a8b3b8', legs: '#3b3f42', tail: '#f4f4f0' },
    tipFrom: 0.6, juvenile: [0.14, 0.13, 0.12], juvenileShare: 0.35,
    months: [0.9, 0.9, 1, 0.9, 0.3, 0.05, 0.05, 0.05, 0.1, 0.6, 1, 1],
  },
};

// ================================================================================================
// Behaviour constants (ESTIMATED unless noted)
// ================================================================================================
const CAPACITY = { herringGull: 80, laughingGull: 120, commonTern: 120, gannet: 80 };   // at QUALITY.birds = 1
const MAX_BIRDS = 220;                  // alive at once at QUALITY.birds = 1
const PERCH_RANGE_M = 600, PERCH_HYSTERESIS_M = 150;   // loafing birds on turbines this close to the camera
const RAIL_RADIUS = TURBINE.platform.outerDiameter / 2 - 0.04;   // top-rail centreline (turbine.js insets the rail 0.04 m)
const DECK_SEAT_RADIUS = 6.6;           // birds sitting on the grating between the TP wall and the rail
const PERCH_SLOTS = 10;
const COMMUTERS = 4, COMMUTE_RING_M = [420, 560], DESPAWN_M = 800;
const FLOCK_RANGE_M = 1500;             // flocks gather over blitzes this close to the camera
// A working flock over a bass or bluefish blitz: dozens to hundreds of gulls and terns (tern flocks
// of hundreds over predatory fish; gulls "hovering tightly, dipping repeatedly"); a bluefin blitz
// offshore draws fewer, mostly gannets and big gulls.
const FLOCK_MAX = 90;                   // at QUALITY.birds = 1
const ARRIVE_FROM_M = [40, 140], ARRIVE_EVERY_S = [0.15, 0.6];
const SEED_SHARE = 0.7;                 // a forced blitz starts with this share of its flock on station
const FIRST_FLYERS_S = 25;              // no flying birds in the first seconds (reference frame at t = 0)
// Common terns are the classic sign of "birds working" over bluefish and albies; laughing gulls next.
const FLOCK_MIX = { commonTern: 1.2, laughingGull: 1.2, herringGull: 0.6, gannet: 0.8 };
const TUNA_MIX = { gannet: 1.2, herringGull: 0.6, laughingGull: 0.3, commonTern: 0.2 };
// Heights over a feeding patch (m above the sea). Gannets circle and start their plunges at 11-60 m,
// most at 10-30 m (config LIFE.birds.gannet.plungeStart; Garthe et al. 2014): log-normal, median
// 20 m (84 % below 30 m). Common terns hover 1-6 m up and dive from there (LIFE.birds.commonTern.
// hoverHeight; anglers: "8-10 ft"), most of them low. Gulls wheel low and tight over the bait
// (laughing gulls 1.5-6 m, herring gulls 2.5-9 m; round 4: a working flock 2-10 m up) and drop to
// pick at the surface; some sit on the water at the edge of the core.
const GANNET_H = LB.gannet.plungeStart, GANNET_MEDIAN_M = 20, GANNET_SIGMA = 0.4;
const HOVER_M = LB.commonTern.hoverHeight, HOVER_SKEW = 1.8;
const FORAGE_H = { laughingGull: [1.5, 6], herringGull: [2.5, 9], commonTern: [2, 7] };
const ORBIT_R = { laughingGull: [2, 6], herringGull: [3, 7], commonTern: [2, 5], gannet: [6, 16] };
// Plunges: start height range (m; gulls drop low first), splash crown (m), time under water (s).
const PLUNGE = {
  gannet: { from: GANNET_H, splash: [1.1, 1.9], under: [3, 8] },
  commonTern: { from: HOVER_M, splash: [0.22, 0.4], under: [0.3, 0.8] },
  herringGull: { from: [2.5, 6], splash: [0.3, 0.5], under: [0.4, 1.0] },
};
// A gannet only commits when the target lies inside this cone (dive angle ≥ 65°: horizontal
// distance ≤ 0.45 × height); otherwise it circles over the target first.
const GANNET_DIVE_CONE = 0.45;
// Fold geometry: arm sweep (rad) and extra hand sweep at a full fold, how much of the lift onto the
// back the tips lose (they lie lower, over the tail), and how far the folded wing reaches from the
// shoulder (fraction of L: the crossed primaries end just past the tail base, as on a resting gull).
const FOLD = { arm: 1.35, hand: 1.2, tipDrop: 0.55, reach: 0.62 };
// Far birds: below this wingspan on screen a bird is a coverage-true sprite, and beyond FAR_STEP_M it
// is simulated at FAR_STEP_HZ (its wingbeats still read at 15 Hz).
const FAR_LOD_PX = 8;
const FAR_STEP_M = 250, FAR_STEP_HZ = 15;

// Flight states.
const S = { PERCH: 0, FLY: 1, CIRCLE: 2, HOVER: 3, PLUNGE: 4, UNDER: 5, FLOAT: 6, TAKEOFF: 7, DIP: 8, LAND: 9, DEPART: 10 };

// ================================================================================================
// Geometry
// ================================================================================================
// Local frame: +Z forward (bill tip at z = stations[0][0]·L), +Y up, X lateral (+X = left wing);
// origin near the wing root. Wings are spread and level at rest, so the bounding box width is
// exactly the wingspan and its length the bill-to-tail length. Attributes: color (top / front
// faces), color2 (underside: the back faces of wings and tail), aWing = (side, span fraction, hand
// weight, part: 0 body, 1 wing, 2 leg), aBody = (head weight, tail weight): the head pitches down
// about the neck and the tail fans in the pose. Wings have a thin section (a rounded leading edge
// ~12 % of the chord deep at the root, thinning to the tip), so an edge-on wing keeps a lit edge.
export function buildBirdGeometry(key) {
  const S0 = BIRD_SPECIES[key], L = S0.length, span = S0.wingspan, st = S0.stations;
  const C = Object.fromEntries(Object.entries(S0.colours).map(([k, v]) => [k, v && new THREE.Color(v)]));
  const pos = [], col = [], col2 = [], wing = [], body = [], idx = [];
  const vert = (x, y, z, c, c2 = c, w = [0, 0, 0, 0], bd = [0, 0]) => {
    pos.push(x, y, z); col.push(c.r, c.g, c.b); col2.push(c2.r, c2.g, c2.b); wing.push(...w); body.push(...bd);
    return pos.length / 3 - 1;
  };
  // a triangle whose front face points up (+Y, upward = 1) or down (-1)
  const tri = (a, b, c, upward) => {
    const p = (i) => new THREE.Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
    const ny = p(b).sub(p(a)).cross(p(c).sub(p(a))).y;
    idx.push(a, ...(ny * upward < 0 ? [c, b] : [b, c]));
  };
  // body: loft of ellipses through the stations, closed by the bill tip and a rear fan
  const RING = 10;
  const headW = (z) => smooth((S0.headZ - 0.05) * L, (S0.headZ + 0.02) * L, z);
  const bodyCol = (z, yN) => (z > S0.bill * L ? C.bill
    : z > S0.headZ * L ? (C.cap && yN > -0.15 && z < (S0.bill + 0.01) * L ? C.cap : C.head)
    : yN > 0.45 && z < 0.12 * L && z > -0.22 * L ? C.mantle : C.body);
  const tip = vert(0, st[0][3] * L, st[0][0] * L, C.bill, C.bill, undefined, [1, 0]);
  const rings = st.slice(1).map(([zf, hw, hh, yc]) => Array.from({ length: RING }, (_, j) => {
    const c = Math.cos(j / RING * TAU);
    return vert(hw * L * Math.sin(j / RING * TAU), (yc + hh * c) * L, zf * L, bodyCol(zf * L, c), undefined, undefined, [headW(zf * L), 0]);
  }));
  const lastSt = st[st.length - 1], rearC = vert(0, lastSt[3] * L, (lastSt[0] - 0.01) * L, C.body), last = rings[rings.length - 1];
  for (let j = 0; j < RING; j++) {
    const j1 = (j + 1) % RING;
    idx.push(tip, rings[0][j], rings[0][j1], rearC, last[j1], last[j]);
    for (let i = 0; i < rings.length - 1; i++) idx.push(rings[i][j], rings[i + 1][j], rings[i][j1], rings[i][j1], rings[i + 1][j], rings[i + 1][j1]);
  }
  // tail: flat plate (square, forked with streamers, or wedge); tail weight grows to the tip
  {
    const T = S0.tail, y = (lastSt[3] + 0.004) * L, z0 = T.z0 * L, zTip = (st[0][0] - 1) * L, hb = T.halfBase, ht = T.halfTip;
    const pts = T.shape === 'fork' ? [[-hb, z0], [hb, z0], [ht, zTip], [ht * 0.55, zTip + 0.05 * L], [0, lerp(z0, zTip, 0.45)], [-ht * 0.55, zTip + 0.05 * L], [-ht, zTip]]
      : T.shape === 'wedge' ? [[-hb, z0], [hb, z0], [hb * 0.6, lerp(z0, zTip, 0.6)], [0, zTip], [-hb * 0.6, lerp(z0, zTip, 0.6)]]
      : [[-hb, z0], [hb, z0], [ht, zTip + 0.01 * L], [0, zTip], [-ht, zTip + 0.01 * L]];
    const tw = (z) => clamp((z0 - z) / (z0 - zTip), 0, 1);
    const ids = pts.map(([x, z]) => vert(x * L, y, z, C.tail, C.tail, undefined, [0, tw(z)]));
    const c = vert(0, y, lerp(z0, zTip, 0.4), C.tail, C.tail, undefined, [0, 0.4]);
    ids.forEach((id, k) => tri(c, id, ids[(k + 1) % ids.length], 1));
  }
  // wings: two-segment planform, pointed hand swept back, cambered, with a thin section
  const shoulder = new THREE.Vector3(0.55 * Math.max(...st.map((s) => s[1])) * L, 0.035 * L, 0.04 * L);
  const half = span / 2 - shoulder.x, uw = S0.arm, handSweep = S0.handSweepDeg * DEG;
  const chordShape = (u) => (u <= uw ? 1 - 0.12 * u / uw : 0.88 * (1 - 0.9 * Math.pow((u - uw) / (1 - uw), 1.5)));
  // root chord from the wing area: A = 2 · half · ∫ c(u) du
  let integ = 0;
  for (let i = 0; i < 200; i++) integ += chordShape((i + 0.5) / 200) / 200;
  const c0 = S0.wingArea / (2 * half * integ);
  const leZ = (u) => shoulder.z + 0.4 * c0 - (u <= uw ? 0.05 * c0 * (1 - u / uw) : (u - uw) * half * Math.tan(handSweep));
  const NS = 12, wrist = new THREE.Vector3(shoulder.x + uw * half, shoulder.y, shoulder.z);
  for (const sg of [1, -1]) {
    const grid = [], low = [];
    for (let i = 0; i <= NS; i++) {
      const u = i / NS, chord = c0 * chordShape(u), x = sg * (shoulder.x + u * half);
      const tipZone = smooth(S0.tipFrom - 0.04, S0.tipFrom + 0.04, u), thick = chord * 0.12 * (1 - 0.8 * u);
      const w = [sg, u, smooth(uw - 0.03, uw + 0.1, u), 1];
      const row = [0, 0.5, 1].map((f) => {
        let top = C.mantle.clone().lerp(C.tip, key === 'commonTern' ? tipZone * (1 - f * 0.7) : tipZone);
        if (f === 1 && key !== 'gannet' && key !== 'commonTern') top.lerp(C.trailing, 0.6 * (1 - tipZone));
        return [top, C.under.clone().lerp(C.underTip, tipZone * (key === 'commonTern' ? f : 1)), f];
      });
      grid.push(row.map(([top, under, f]) => vert(x, shoulder.y + chord * (f === 0 ? 0 : f === 1 ? -0.01 : 0.045), leZ(u) - f * chord, top, under, w)));
      // lower surface: the leading edge rounded down, meeting the upper surface at the trailing edge
      low.push([vert(x, shoulder.y - thick, leZ(u) - 0.06 * chord, row[0][0].clone().lerp(row[0][1], 0.5), row[0][1], w),
        vert(x, shoulder.y + chord * 0.045 - thick * 0.9, leZ(u) - 0.5 * chord, row[1][1], row[1][1], w)]);
    }
    for (let i = 0; i < NS; i++) {
      const [A0, A1, A2] = grid[i], [B0, B1, B2] = grid[i + 1], [a0, a1] = low[i], [b0, b1] = low[i + 1];
      tri(A0, B0, A1, 1); tri(B0, B1, A1, 1); tri(A1, B1, A2, 1); tri(B1, B2, A2, 1);
      idx.push(A0, a0, B0, B0, a0, b0);              // leading-edge strip
      tri(a0, b0, a1, -1); tri(b0, b1, a1, -1); tri(a1, b1, A2, -1); tri(b1, B2, A2, -1);
    }
  }
  // legs: two thin crossed quads per leg with a webbed foot, hip under the body
  const hip = new THREE.Vector3(0, (st[6][3] - st[6][2] * 0.8) * L, -0.02 * L), legLen = S0.legLen * L, lw = 0.006 * L;
  for (const sg of [1, -1]) {
    const hx = sg * 0.018 * L, by = hip.y - legLen, bz = hip.z + 0.01 * L, lv = (x, y, z) => vert(x, y, z, C.legs, C.legs, [0, 0, 0, 2]);
    for (const [dx, dz] of [[lw, 0], [0, lw]]) {
      const a = lv(hx - dx, hip.y, hip.z - dz), b = lv(hx + dx, hip.y, hip.z + dz), c = lv(hx - dx, by, bz - dz), d = lv(hx + dx, by, bz + dz);
      idx.push(a, c, b, b, c, d);
    }
    idx.push(lv(hx, by, bz - 0.01 * L), lv(hx - 0.03 * L, by, bz + 0.07 * L), lv(hx + 0.03 * L, by, bz + 0.07 * L));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('color2', new THREE.Float32BufferAttribute(col2, 3));
  g.setAttribute('aWing', new THREE.Float32BufferAttribute(wing, 4));
  g.setAttribute('aBody', new THREE.Float32BufferAttribute(body, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.name = `bird.${key}`;
  // back surface above the shoulder (widest station): where a folded wing rests; neck pivot on the
  // body axis where the head joins
  const wide = st.reduce((m, q) => (q[1] > m[1] ? q : m), st[0]);
  const backY = (wide[3] + wide[2] * Math.sqrt(Math.max(0, 1 - (shoulder.x / (wide[1] * L)) ** 2))) * L;
  const iNeck = st.findIndex((q) => q[0] <= S0.headZ - 0.03);
  g.userData = { shoulder, wrist, hip, footDrop: legLen - hip.y, halfSpan: half, foldLift: backY + 0.006 * L - shoulder.y,
    neck: new THREE.Vector4(0, st[iNeck > 0 ? iNeck : 3][3] * L, (S0.headZ - 0.04) * L, 0) };
  return g;
}

// ================================================================================================
// Material: wing pose in the vertex shader
// ================================================================================================
const BIRD_VERTEX_PARS = /* glsl */`
attribute vec4 aWing;      // side (+1 left, -1 right), span fraction, hand weight, part (0 body, 1 wing, 2 leg)
attribute vec2 aBody;      // head weight, tail weight
attribute vec4 iPose;      // arm elevation (rad), hand elevation vs arm (rad), fold (0 spread .. 1 folded), legs (0 tucked .. 1 down)
attribute vec2 iPose2;     // head pitch (rad, + = bill down), tail fan (0 closed .. 1 spread)
attribute vec3 color2;     // underside colour (back faces of wings and tail)
uniform vec3 uShoulder;    // left shoulder (x > 0)
uniform vec3 uWrist;       // left wrist at rest
uniform vec4 uFold;        // arm sweep (rad), extra hand sweep (rad), -, span scale at a full fold
uniform vec2 uFoldY;       // folded wing: lift onto the back at the root (m), drop toward the tip (m)
uniform vec3 uHip;         // where tucked legs collapse to
uniform vec4 uNeck;        // neck pivot (m)
varying vec3 vColor2;
mat3 birdRotY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
mat3 birdRotZ(float a) { float c = cos(a), s = sin(a); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }
mat3 birdRotX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
`;
const BIRD_POSE = /* glsl */`
vec3 birdP = position;
vec3 objectNormal = normal;
#ifdef USE_TANGENT
vec3 objectTangent = vec3(tangent.xyz);
#endif
if (aWing.w > 1.5) birdP = mix(uHip, birdP, iPose.w);          // legs tuck up into the body
else if (aWing.w > 0.5) {
  // wing: the hand turns about the wrist, then the whole wing about the shoulder; a folded wing
  // Z-folds (shorter span), lies on the back and its tips cross over the tail
  float sg = aWing.x, fold = iPose.z;
  vec3 sh = vec3(sg * uShoulder.x, uShoulder.yz);
  float k = mix(1.0, uFold.w, fold);
  birdP.x = sh.x + (birdP.x - sh.x) * k;
  vec3 wr = vec3(sh.x + (sg * uWrist.x - sh.x) * k, uWrist.yz);
  mat3 Rh = birdRotY(sg * fold * uFold.y * aWing.z) * birdRotZ(sg * iPose.y * aWing.z);
  mat3 Ra = birdRotY(sg * fold * uFold.x) * birdRotZ(sg * iPose.x);
  birdP = sh + Ra * (wr + Rh * (birdP - wr) - sh);
  objectNormal = Ra * Rh * objectNormal;
  birdP.y += fold * (uFoldY.x - uFoldY.y * aWing.y + sg * 0.004 * aWing.y);
} else {
  // the head pitched down about the neck (a hovering tern looks at the water); the tail fanned
  mat3 Rn = birdRotX(iPose2.x * aBody.x);
  birdP = uNeck.xyz + Rn * (birdP - uNeck.xyz);
  objectNormal = Rn * objectNormal;
  birdP.x *= 1.0 + 0.7 * iPose2.y * aBody.y;
}
`;
function createBirdMaterial(key, geometry) {
  const u = geometry.userData, v = (x) => ({ value: x });
  const uniforms = {
    uShoulder: v(u.shoulder), uWrist: v(u.wrist), uHip: v(u.hip), uNeck: v(u.neck),
    uFold: v(new THREE.Vector4(FOLD.arm, FOLD.hand, 0, clamp(FOLD.reach * BIRD_SPECIES[key].length / u.halfSpan, 0.3, 0.8))),
    uFoldY: v(new THREE.Vector2(u.foldLift, u.foldLift * FOLD.tipDrop)),
  };
  // Feathers are micro-structured and matte: half the specular of a smooth dielectric (F0 0.02).
  const mat = new THREE.MeshPhysicalMaterial({ name: `bird.${key}`, vertexColors: true, roughness: 0.8, specularIntensity: 0.5, side: THREE.DoubleSide });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${BIRD_VERTEX_PARS}`)
      .replace('#include <color_vertex>', '#include <color_vertex>\nvColor2 = color2;\n#ifdef USE_INSTANCING_COLOR\nvColor2 *= instanceColor.xyz;\n#endif')
      .replace('#include <beginnormal_vertex>', BIRD_POSE)
      .replace('#include <begin_vertex>', 'vec3 transformed = birdP;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vColor2;')
      .replace('#include <color_fragment>', '#if defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )\ndiffuseColor.rgb *= gl_FrontFacing ? vColor : vColor2;\n#endif');
  };
  mat.customProgramCacheKey = () => 'life-bird-v3';
  return applyAtmosphere(mat);
}

// One species: an InstancedMesh with a packed range of live instances and their wing poses. Each
// frame commit() writes the birds large enough on screen (or all of them without a LOD split); the
// rest go to the sprite pass.
export class BirdMesh {
  constructor(key, capacity, root) {
    this.key = key; this.root = root;
    this.geometry = buildBirdGeometry(key);
    this.material = createBirdMaterial(key, this.geometry);
    this.agents = [];
    this._m = new THREE.Matrix4(); this._s = new THREE.Vector3(1, 1, 1);
    this.resize(capacity);
  }
  /** A new capacity (a quality switch): the live birds carry over (the oldest first). */
  resize(capacity) {
    if (capacity === this.capacity) return;
    if (this.mesh) { this.root.remove(this.mesh); this.mesh.dispose(); }
    this.capacity = capacity;
    const attr = (n) => new THREE.InstancedBufferAttribute(new Float32Array(capacity * n), n).setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('iPose', this.pose = attr(4));
    this.geometry.setAttribute('iPose2', this.pose2 = attr(2));
    const m = this.mesh = new THREE.InstancedMesh(this.geometry, this.material, capacity);
    m.name = `birds.${this.key}`;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.instanceColor = attr(3);                 // before the first render (a later one recompiles)
    m.count = 0; m.frustumCulled = false; m.receiveShadow = true;
    m.layers.enable(LAYER_REFLECT);
    this.root.add(m);
    this.agents.length = Math.min(this.agents.length, capacity);
    this.agents.forEach((a, i) => { a.slot = i; });
  }
  get full() { return this.agents.length >= this.capacity; }
  add(agent, tint) { agent.slot = this.agents.push(agent) - 1; agent.tint = tint.clone(); }
  remove(agent) {
    const i = agent.slot;
    if (this.agents[i] !== agent) return;
    const moved = this.agents.pop();
    if (moved !== agent) { this.agents[i] = moved; moved.slot = i; }
    agent.slot = -1;
  }
  // Writes every live agent's matrix and pose; with a LOD test, only those it accepts (the others
  // are handed to `far`).
  commit(isNear = null, far = null) {
    const p = this.pose.array, p2 = this.pose2.array, c = this.mesh.instanceColor.array;
    let k = 0;
    for (const a of this.agents) {
      if (isNear && !isNear(a)) { far?.(a); continue; }
      this.mesh.setMatrixAt(k, this._m.compose(a.pos, a.quat, this._s));
      p.set([a.arm, a.hand, a.fold, a.legs], k * 4);
      p2.set([a.head ?? 0, a.tailFan ?? 0], k * 2);
      a.tint.toArray(c, k * 3);
      k++;
    }
    this.mesh.count = k;
    this.mesh.visible = k > 0;
    for (const at of [this.mesh.instanceMatrix, this.mesh.instanceColor, this.pose, this.pose2]) at.needsUpdate = true;
  }
  dispose() { this.geometry.dispose(); this.material.dispose(); this.mesh.dispose(); }
}

// ================================================================================================
// Far birds: coverage-true sprites
// ================================================================================================
// A bird a few pixels across collapses under MSAA (its wing chord is a fraction of a pixel). Here
// each far bird is an ellipse along its projected wingspan, at least SPRITE_MIN_PX half-size, whose
// alpha makes its covered area equal the bird's true silhouette area seen from the camera (the wings
// as two plates raised by the arm elevation, plus the body): wingbeats and banking make it twinkle as
// the silhouette and the lit side change. Radiance: the visible sides' plumage under sun, sky and the
// sea's light, from the CPU; aerial perspective per vertex.
const SPRITE_MIN_PX = 0.75;
const SPRITE_VS = (glsl) => /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>
${glsl}
attribute vec4 sA;         // centre (m), half wingspan (m)
attribute vec4 sB;         // lateral axis (unit), half depth (m)
attribute vec4 sC;         // radiance (absolute), silhouette area (m²)
uniform float uPxPerM;
varying vec2 vQ;
varying float vA;
varying vec3 vRad;
void main() {
  vec4 mv = viewMatrix * vec4(sA.xyz, 1.0);
  float pxm = uPxPerM / max(-mv.z, 0.05);           // pixels per metre at the bird
  vec2 lat = (mat3(viewMatrix) * sB.xyz).xy;
  float ll = length(lat);
  vec2 ax = ll > 1e-4 ? lat / ll : vec2(1.0, 0.0);
  float hx = max(sA.w * ll * pxm, ${SPRITE_MIN_PX.toFixed(2)}), hy = max(sB.w * pxm, ${SPRITE_MIN_PX.toFixed(2)});
  vA = clamp(sC.w * pxm * pxm / (2.2 * hx * hy), 0.0, 1.0);   // 2.2 = the profile's integral over the quad
  vQ = position.xy;
  mv.xy += (ax * position.x * hx + vec2(-ax.y, ax.x) * position.y * hy) / pxm;
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
  vec3 s0 = applyAerialPerspective(vec3(0.0), sA.xyz);
  vRad = sC.rgb * (applyAerialPerspective(vec3(1.0), sA.xyz) - s0) + s0;
}`;
const SPRITE_FS = /* glsl */`
#include <common>
#include <logdepthbuf_pars_fragment>
varying vec2 vQ;
varying float vA;
varying vec3 vRad;
void main() {
  #include <logdepthbuf_fragment>
  float a = vA * (1.0 - smoothstep(0.35, 1.0, dot(vQ, vQ)));
  if (a < 0.003) discard;
  gl_FragColor = vec4(vRad, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
class BirdSprites {
  constructor(ctx, capacity, root) {
    const L = lifeGlsl(ctx);
    this.buf = new InstanceBuffer(gridGeometry(1), ['sA', 'sB', 'sC'], capacity);
    this.uniforms = { ...L.uniforms, uPxPerM: { value: 1000 } };
    this.mesh = lifeMesh(this.buf.geometry, new THREE.ShaderMaterial({
      name: 'birds.far', uniforms: this.uniforms, vertexShader: SPRITE_VS(L.glsl), fragmentShader: SPRITE_FS, transparent: true, depthWrite: false,
    }), root, 'birds.far', 3);
    this.n = 0;
  }
  put(...v) { if (this.n < this.buf.capacity) this.buf.set(this.n++, v); }
  end(pxPerM) {
    this.buf.upload(this.n);
    this.uniforms.uPxPerM.value = pxPerM;
    this.mesh.visible = this.n > 0;
    this.n = 0;
  }
  dispose() { this.buf.dispose(); this.mesh.material.dispose(); }
}

// ================================================================================================
// Birds
// ================================================================================================
export class Birds {
  // private state (see the constructor)
  #b; #camera; #e; #lastT; #lin; #n; #nextCommuter; #perchCheck; #pxPerM; #size; #surf; #t; #v; #w; #wind;
  constructor(ctx) {
    this.ctx = ctx;
    this.quality = ctx.quality || QUALITY.high;
    this.enabled = true;
    this.rng = mulberry32(0xB12D5 + 104729 * (ctx.seed ?? 1));
    this.root = new THREE.Group();
    this.root.name = 'birds';
    ctx.scene.add(this.root);
    this.meshes = {};
    for (const key in BIRD_SPECIES) this.meshes[key] = new BirdMesh(key, this.#capOf(key, this.quality), this.root);
    this.sprites = new BirdSprites(ctx, Math.round(MAX_BIRDS * 1.5) + 40, this.root);
    this.agents = [];
    this.perches = new Map();          // turbine index -> { tb, slots: [{ x, y, z, deck, bird|null }], dayN, nightN }
    this.flocks = new Map();           // blitz id -> { members: Set, nextArrival, nextLeave, heat, blitz, lull }
    this.#t = U.uTime.value;
    this.#lastT = null;
    this.#nextCommuter = this.#t + FIRST_FLYERS_S;
    this.#perchCheck = -1;
    this.#pxPerM = 1000;
    this.#size = new THREE.Vector2();
    this.#e = new THREE.Euler(0, 0, 0, 'YXZ');
    this.#v = new THREE.Vector3(); this.#w = new THREE.Vector3(); this.#n = new THREE.Vector3(); this.#wind = new THREE.Vector3(0, 0, 1);
    this.#b = [0, 1, 2, 3].map(() => new THREE.Vector3());
    this.#surf = { y: 0, normal: new THREE.Vector3(), velocity: new THREE.Vector3() };
    this.#lin = Object.fromEntries(Object.entries(BIRD_SPECIES).map(([k, sp]) => [k, ['mantle', 'under', 'body'].map((c) => new THREE.Color(sp.colours[c]))]));
    this.stats = { dips: 0, plunges: 0 };   // foraging events since construction (diagnostics)
    if (globalThis.NJOW_DEV !== false) this._registerScales();
  }

  get count() { return this.agents.length; }

  setEnabled(on) {
    on = !!on;
    if (on === this.enabled) return;
    this.enabled = this.root.visible = on;
    if (on) { this.#perchCheck = -1; this.#nextCommuter = this.#t + 5; return; }
    for (const a of this.agents) this.meshes[a.key].remove(a);
    this.agents.length = 0;
    this.perches.clear();
    this.flocks.clear();
  }

  setQuality(q) {
    if (!q) return;
    this.quality = q;
    for (const [key, m] of Object.entries(this.meshes)) {
      const cap = this.#capOf(key, q);
      while (m.agents.length > cap) this.#despawn(m.agents[m.agents.length - 1]);   // the newest leave
      m.resize(cap);
    }
  }

  dispose() {
    this.ctx.scene.remove(this.root);
    for (const m of Object.values(this.meshes)) m.dispose();
    this.sprites.dispose();
  }

  /**
   * A forced blitz arrives in full swing (blitz.trigger): put SEED_SHARE of its flock on station at
   * once, each bird part-way through what it would be doing (circling, hovering, dipping, diving,
   * sitting on the water), so the first frame already shows a working flock.
   * b: a BlitzState (or its id). Returns the number of birds placed.
   */
  seedFlock(b, n = null) {
    if (typeof b === 'number') b = this.ctx.blitz?.active?.find((q) => q.id === b);
    const activity = this.#activity();
    if (!this.enabled || !b || activity < 0.3) return 0;
    const t = this.#t = U.uTime.value, rng = this.rng;
    this.#windAway();
    const f = this.#flock(b, t, 1);
    const want = n ?? Math.round(this.#flockMax(b) * SEED_SHARE * activity);
    const strikes = this.ctx.blitz?.recentStrikes?.filter((q) => q.id === b.id && t - q.t < 3) ?? [];
    let placed = 0;
    for (; placed < want; placed++) {
      const key = this.#pickSpecies(b.species === 'bluefinTuna' ? TUNA_MIX : FLOCK_MIX);
      const s = strikes.length ? strikes[Math.floor(rng() * strikes.length)] : b, ang = rng() * TAU, r = lerp(1, 10, Math.sqrt(rng()));
      const a = key && this.#spawn(key, S.CIRCLE, this.#v.set(s.x + Math.cos(ang) * r, 5, s.z + Math.sin(ang) * r));
      if (!a) break;
      a.blitzId = b.id; a.purpose = 'forage'; f.members.add(a);
      const sea = this.#seaAt(a, t, 10), u = rng(), diver = key === 'gannet' || key === 'commonTern';
      if (key === 'commonTern' && u < 0.55) {
        this.#hoverAt(a, b);
        a.pos.copy(a.target).add(this.#w.set(rng() - 0.5, (rng() - 0.5) * 0.4, rng() - 0.5));
      } else if (u < 0.2 && key.endsWith('Gull')) {
        // on the water at the edge of the core
        const [ex, ez] = this.#edge(b);
        a.pos.set(ex, 0, ez);
        a.state = S.FLOAT; a.until = t + lerp(2, 12, rng()); a.yaw = this.#upwind() + (rng() - 0.5) * 0.8;
        this.#float(a, t, 1);
        continue;
      } else if (u < 0.3 && !diver && s !== b) {
        // dropping to pick at the surface
        this.#dip(a, s);
        a.pos.set(a.target.x + (rng() - 0.5) * 6, sea + lerp(0.8, 3, rng()), a.target.z + (rng() - 0.5) * 6);
        a.vel.set(a.target.x - a.pos.x, -0.5, a.target.z - a.pos.z).setLength(lerp(3, 6, rng()));
      } else if (u < 0.42 && diver && s !== b) {
        // mid-dive: a straight drop with a little drift
        const top = PLUNGE[key].from[1] * 0.7, h = lerp(1.5, key === 'gannet' ? Math.min(top, 30) : top, rng());
        a.target.set(s.x + (rng() - 0.5) * 2, 0, s.z + (rng() - 0.5) * 2);
        a.pos.set(a.target.x + (rng() - 0.5) * 0.3 * h, sea + h, a.target.z + (rng() - 0.5) * 0.3 * h);
        a.vel.set((rng() - 0.5) * 2, -Math.sqrt(2 * G * Math.max(h * 0.6, 1)), (rng() - 0.5) * 2);
        a.state = S.PLUNGE; a.t0 = t - lerp(0.3, 1.2, rng());
        a.yaw = Math.atan2(a.vel.x, a.vel.z); a.pitch = -1.3;
        Object.assign(a, { fold: key === 'gannet' ? 0.9 : 0.55, arm: 0.3, hand: -0.3, flap: 0, legs: 0 });
        continue;
      } else {
        this.#circle(a, b);
        const o = a.orbit, sp = a.sp.cruise * (key === 'gannet' ? 0.95 : 0.72);
        o.ang = rng() * TAU;
        a.pos.set(b.x + o.cx + Math.cos(o.ang) * o.r, sea + o.h, b.z + o.cz + Math.sin(o.ang) * o.r);
        a.vel.set(-Math.sin(o.ang) * o.dir * sp, 0, Math.cos(o.ang) * o.dir * sp);
        a.bank = -0.35 * o.dir;
      }
      const hover = a.state === S.HOVER;
      a.yaw = hover ? this.#upwind() : Math.atan2(a.vel.x, a.vel.z);
      a.phase = rng() * TAU;
      this.#flapPose(a, 1 / 60, hover ? 1.15 : rng() < 0.5 ? 1 : 0, hover ? a.sp.hoverHz / a.sp.flapHz : 1);
      this.#headPose(a);
    }
    for (const a of this.agents) this.#orient(a);
    return placed;
  }

  // ---------------------------------------------------------------- frame
  update(dt, t, camera) {
    this.#t = t;
    if (this.#lastT === null) this.#nextCommuter = t + FIRST_FLYERS_S;     // time base from the first frame
    const step = this.#lastT === null ? 0 : clamp(t - this.#lastT, 0, 0.1);
    this.#lastT = t;
    if (!this.enabled) return;
    this.#camera = camera;
    this.ctx.renderer?.getDrawingBufferSize?.(this.#size);
    if (this.#size.y) this.#pxPerM = this.#size.y / (2 * Math.tan(camera.fov * DEG / 2));
    this.activity = this.#activity();
    this.#windAway();
    const cp = camera.position;
    if (t >= this.#perchCheck && (step > 0 || this.#perchCheck < 0)) { this.#perchCheck = t + 1; this.#populatePerches(cp); }
    if (step > 0) {
      this.#populateFlocks(t, step, cp);
      this.#populateCommuters(t, cp);
      this.#nightfall();
      for (const a of this.agents.slice()) {
        // far birds are simulated at FAR_STEP_HZ (their wingbeats still read at 15 Hz)
        a.acc += step;
        if (a.state !== S.PLUNGE && a.acc < 1 / FAR_STEP_HZ && Math.abs(a.pos.x - cp.x) + Math.abs(a.pos.z - cp.z) > FAR_STEP_M) continue;
        this.#step(a, t, Math.min(a.acc, 0.1));
        a.acc = 0;
      }
    }
    // near birds as meshes, far ones as coverage-true sprites
    for (const a of this.agents) this.#orient(a);
    const near = (a) => a.sp.wingspan / Math.max(a.pos.distanceTo(cp), 0.1) * this.#pxPerM >= FAR_LOD_PX;
    for (const m of Object.values(this.meshes)) m.commit(near, (a) => this.#sprite(a, cp));
    this.sprites.end(this.#pxPerM);
  }

  // A far bird's sprite: silhouette area (wings as two plates raised by the arm elevation, folded
  // away with the fold, plus the body) and the radiance of the sides the camera sees.
  #sprite(a, cp) {
    const sp = a.sp, L = sp.length, [v, up, lat, fwd] = this.#b;
    const d = v.subVectors(cp, a.pos).length();
    v.divideScalar(Math.max(d, 1e-3));
    up.set(0, 1, 0).applyQuaternion(a.quat); lat.set(1, 0, 0).applyQuaternion(a.quat); fwd.set(0, 0, 1).applyQuaternion(a.quat);
    const ca = Math.cos(a.arm), sa = Math.sin(a.arm), open = 1 - 0.8 * clamp(a.fold, 0, 1);
    const sun = U.uSunDir.value, moon = U.uMoonDir.value, Es = U.uSunIlluminance.value, Em = U.uMoonIlluminance.value, Ls = U.uFogInscatter.value;
    const [top, under, bodyC] = this.#lin[a.key];
    const rad = [0, 0, 0];
    let A = 0;
    // a surface of this area and normal, seen from the camera: direct light on the seen side
    // (feathers pass ~12 % through to the other side), sky from above and the sea's ~6 % from below
    const face = (nx, ny, nz, area, alb, light = null) => {
      const dv = nx * v.x + ny * v.y + nz * v.z, w = area * Math.abs(dv), s = Math.sign(dv);
      if (w <= 0) return;
      const ns = s * (nx * sun.x + ny * sun.y + nz * sun.z), nm = s * (nx * moon.x + ny * moon.y + nz * moon.z), n1 = s * ny;
      const col = alb === null ? (s > 0 ? top : under) : alb;
      const kS = light ?? Math.max(ns, 0) + 0.12 * Math.max(-ns, 0), kSky = Math.PI * (light === null ? 0.7 * (0.5 + 0.5 * n1) + 0.06 * (0.5 - 0.5 * n1) : 0.5);
      for (const [i, c] of ['r', 'g', 'b'].entries()) rad[i] += w * col[c] * (Es[c] * kS + (light === null ? Em[c] * Math.max(nm, 0) : 0) + Ls[c] * kSky) / Math.PI;
      A += w;
    };
    // the left wing (+X) raised by the arm tilts its normal toward -X; the right wing mirrored
    face(up.x * ca - lat.x * sa, up.y * ca - lat.y * sa, up.z * ca - lat.z * sa, 0.5 * sp.wingArea * open, null);
    face(up.x * ca + lat.x * sa, up.y * ca + lat.y * sa, up.z * ca + lat.z * sa, 0.5 * sp.wingArea * open, null);
    // body: a spindle, seen from the side most
    const side = Math.sqrt(Math.max(0, 1 - fwd.dot(v) ** 2));
    face(v.x, v.y, v.z, 0.12 * L * L * (0.35 + 0.65 * side), bodyC, Math.max(sun.y, 0) * 0.6);
    const k = 1 / Math.max(A, 1e-6), t = a.tint;
    this.sprites.put(a.pos.x, a.pos.y, a.pos.z, 0.5 * sp.wingspan * Math.max(ca, 0.2) * (0.35 + 0.65 * open), lat.x, lat.y, lat.z,
      0.07 * L + 0.25 * Math.abs(sa) * sp.wingspan * open, rad[0] * k * t.r, rad[1] * k * t.g, rad[2] * k * t.b, A);
  }

  // ---------------------------------------------------------------- population
  #cap() { return Math.round(MAX_BIRDS * (this.quality.birds ?? 1)); }
  #capOf(key, q) { return Math.round(CAPACITY[key] * Math.max(0.5, q?.birds ?? 1)); }
  #flockMax(b) { return Math.round(FLOCK_MAX * (this.quality.birds ?? 1) * (b?.species === 'bluefinTuna' ? 0.5 : 1)); }
  // Flying from civil dawn to civil dusk (sun above -6°), fully active above -1°.
  #activity() { return smooth(-6, -1, Math.asin(clamp(U.uSunDir.value.y, -1, 1)) / DEG); }

  #spawn(key, state, pos) {
    const mesh = this.meshes[key];
    if (mesh.full || this.agents.length >= this.#cap()) return null;
    const sp = BIRD_SPECIES[key];
    const a = {
      key, sp, slot: -1, state, t0: this.#t, until: Infinity,
      pos: pos.clone(), vel: new THREE.Vector3(), quat: new THREE.Quaternion(),
      yaw: 0, pitch: 0, bank: 0, phase: this.rng() * TAU, flap: 1, gliding: false, cycleUntil: 0,
      arm: 0, hand: 0, fold: 0, legs: 0, head: 0, tailFan: 0,
      target: new THREE.Vector3(), orbit: null, blitzId: null, perch: null, purpose: null,
      sea: null, seaT: -1, speedMul: lerp(0.9, 1.1, this.rng()), acc: 0,
    };
    mesh.add(a, this.rng() < sp.juvenileShare ? new THREE.Color(...sp.juvenile) : new THREE.Color(1, 1, 1));
    this.agents.push(a);
    return a;
  }

  #despawn(a) {
    this.meshes[a.key].remove(a);
    this.agents.splice(this.agents.indexOf(a), 1);
    if (a.perch) a.perch.bird = a.perch = null;
    this.flocks.get(a.blitzId)?.members.delete(a);
  }

  // A species drawn from `weights` × its abundance this month (null if none is about).
  #pickSpecies(weights) {
    const m = (this.ctx.clock?.date?.month ?? 6) - 1;
    const w = Object.entries(weights).map(([k, v]) => [k, v * BIRD_SPECIES[k].months[m]]);
    let r = this.rng() * w.reduce((s, [, x]) => s + x, 0);
    for (const [k, x] of w) if (x > 0 && (r -= x) <= 0) return k;
    return null;
  }

  // Loafing (and at night roosting) birds on the railings of turbines near the camera.
  #populatePerches(cp) {
    const farm = this.ctx.farm;
    for (const tb of farm?.turbines ?? []) {
      const d = Math.hypot(tb.x - cp.x, tb.z - cp.z);
      let p = this.perches.get(tb.index);
      if (d > PERCH_RANGE_M + PERCH_HYSTERESIS_M) {
        if (p) { for (const s of p.slots) if (s.bird?.state === S.PERCH) this.#despawn(s.bird); this.perches.delete(tb.index); }
        continue;
      }
      if (d > PERCH_RANGE_M || p) continue;
      // deterministic per turbine: slots (off the boat-landing lobe, where the rail leaves the
      // circle), and how many are taken by day and by night
      const r = mulberry32(0x9E3779B1 ^ (tb.index * 2654435761)), y0 = tb.baseY ?? -curvatureDrop(tb.x, tb.z);
      const slots = Array.from({ length: PERCH_SLOTS }, () => {
        let az;
        do az = r() * 360; while (Math.abs(((az - TURBINE.boatLanding.facingDeg + 540) % 360) - 180) < 38);
        const deck = r() < 0.2, dir = azimuthToDir(az, this.#v), rad = deck ? DECK_SEAT_RADIUS : RAIL_RADIUS;
        return { x: tb.x + dir.x * rad, y: y0 + (deck ? farm.dims?.deckY ?? TURBINE.stack.deck : farm.dims?.railTopY ?? TURBINE.stack.railTop), z: tb.z + dir.z * rad, deck, yawJitter: (r() - 0.5) * 50 * DEG, bird: null };
      });
      const dayN = [0, 0, 0, 1, 1, 2, 3, 4, 5, 6][Math.floor(r() * 10)], nightN = Math.min(PERCH_SLOTS, dayN + 2 + Math.floor(r() * 4));
      this.perches.set(tb.index, p = { tb, slots, dayN, nightN });
      for (let k = 0; k < Math.round(lerp(nightN, dayN, this.activity)); k++) this.#perchBird(slots[k]);
    }
  }

  #perchBird(slot, key = null) {
    key ??= this.#pickSpecies({ herringGull: 0.6, laughingGull: 0.4, commonTern: 0.08 }) ?? 'herringGull';
    const a = this.#spawn(key, S.PERCH, this.#v.set(slot.x, slot.y + this.meshes[key].geometry.userData.footDrop, slot.z));
    if (a) { a.perch = slot; slot.bird = a; this.#setPerched(a); }
  }

  #setPerched(a) {
    Object.assign(a, { state: S.PERCH, pitch: a.perch.deck ? 0.05 : 0.12, bank: 0, arm: 0.06, hand: 0, fold: 1, legs: 1, head: 0, tailFan: 0 });
    a.vel.set(0, 0, 0);
    a.yaw = this.#upwind() + a.perch.yawJitter;           // facing into the wind
    a.until = this.#t + lerp(8, 40, this.rng());           // next shuffle or stretch
  }

  #flock(b, t, heat) {
    let f = this.flocks.get(b.id);
    if (!f) this.flocks.set(b.id, f = { members: new Set(), nextArrival: t, nextLeave: t, heat, blitz: b, lull: false });
    return f;
  }

  // Flocks over active blitzes near the camera.
  #populateFlocks(t, step, cp) {
    const blitz = this.ctx.blitz, seen = new Set();
    for (const b of blitz?.enabled === false ? [] : blitz?.active ?? []) {
      if (t > b.endT || (!this.flocks.has(b.id) && Math.hypot(b.x - cp.x, b.z - cp.z) > FLOCK_RANGE_M)) continue;
      seen.add(b.id);
      const f = this.#flock(b, t, 0.3);
      f.blitz = b;
      // birds home in on activity and hang on a while after it stops (20 s memory)
      f.heat = Math.max(f.heat * Math.exp(-step / 20), b.intensity, b.state === 'rising' ? 0.35 : 0);
      // a feeding patch draws them at once, a new quiet one builds up over ~35 s; the blitz in view
      // draws the full flock, others far off a smaller share (cost, and the birds split between them)
      const ramp = b.intensity > 0.5 ? 1 : smooth(0, 35, t - b.startT) * 0.7 + 0.3;
      const share = b.id === blitz.focusId || Math.hypot(b.x - cp.x, b.z - cp.z) < 300 ? 1 : 0.4;
      const want = Math.round(this.#flockMax(b) * share * clamp(0.25 + 0.75 * f.heat, 0, 1) * ramp * this.activity);
      if (f.members.size < want && t >= f.nextArrival && this.activity > 0.3) {
        f.nextArrival = t + lerp(...ARRIVE_EVERY_S, this.rng());
        const key = this.#pickSpecies(b.species === 'bluefinTuna' ? TUNA_MIX : FLOCK_MIX);
        if (key) this.#arrive(key, f, b);
      } else if (f.members.size > want + 2 && t >= f.nextLeave) {
        f.nextLeave = t + lerp(1.5, 4, this.rng());
        const m = [...f.members].find((a) => a.state === S.CIRCLE || a.state === S.HOVER);
        if (m) this.#leave(m);
      }
      // the school goes down: many gulls settle on the water to wait (birds sitting on the water
      // mean the fish are down); terns keep searching, higher; when it pops up they are off again
      const lull = b.state === 'down';
      if (lull === f.lull) continue;
      f.lull = lull;
      for (const a of f.members) {
        if (lull && a.key.endsWith('Gull') && (a.state === S.CIRCLE || a.state === S.FLY) && this.rng() < 0.55) this.#sitNear(a);
        else if (!lull && a.lullSit) { a.lullSit = false; if (a.state === S.FLOAT) a.until = t + lerp(0.2, 3, this.rng()); }
      }
    }
    for (const [id, f] of this.flocks) {
      if (seen.has(id)) continue;
      for (const a of f.members) {
        a.blitzId = null;
        if (a.state === S.FLOAT && a.lullSit) { a.lullSit = false; a.until = this.#t + lerp(1, 6, this.rng()); }
        else if (a.state === S.CIRCLE || a.state === S.HOVER) this.#leave(a);
      }
      this.flocks.delete(id);
    }
  }

  // A bird joins a flock: a gull off a nearby railing if one is there, otherwise one flying in.
  #arrive(key, f, b) {
    let a = null;
    if (key.endsWith('Gull')) for (const p of this.perches.values()) {
      const s = Math.hypot(p.tb.x - b.x, p.tb.z - b.z) < 500 && p.slots.find((q) => q.bird?.key === key && q.bird.state === S.PERCH);
      if (s && this.rng() < 0.5) { a = s.bird; s.bird = a.perch = null; this.#depart(a); break; }
    }
    if (!a) {
      const ang = this.rng() * TAU, d = lerp(...ARRIVE_FROM_M, this.rng());
      a = this.#spawn(key, S.FLY, this.#v.set(b.x + Math.cos(ang) * d, lerp(4, 14, this.rng()), b.z + Math.sin(ang) * d));
      if (!a) return;
      a.vel.set(-Math.cos(ang), 0, -Math.sin(ang)).multiplyScalar(a.sp.cruise);
    }
    a.blitzId = b.id; a.purpose = 'join';
    f.members.add(a);
    a.target.set(b.x, this.#forageHeight(a), b.z);
    if (a.state !== S.DEPART) { a.state = S.FLY; a.t0 = this.#t; }
  }

  #populateCommuters(t, cp) {
    if (t < this.#nextCommuter) return;
    this.#nextCommuter = t + lerp(5, 14, this.rng());
    const n = this.agents.filter((a) => a.purpose === 'commute').length;
    const key = this.activity >= 0.5 && n < Math.round(COMMUTERS * this.activity * (this.quality.birds ?? 1)) && this.#pickSpecies({ herringGull: 0.8, laughingGull: 1.0, commonTern: 0.5, gannet: 1.2 });
    if (!key) return;
    const ang = this.rng() * TAU, d = lerp(...COMMUTE_RING_M, this.rng()), c = Math.cos(ang), s = Math.sin(ang);
    // gannets at their commuting median height (SCENE-SPEC §15), the others low
    const h = key === 'gannet' ? LB.flightHeights.gannetCommute * Math.exp((this.rng() - 0.5) * 0.9) : lerp(5, key === 'commonTern' ? 15 : 30, this.rng());
    const a = this.#spawn(key, S.FLY, this.#v.set(cp.x + c * d, h, cp.z + s * d));
    if (!a) return;
    // across the view: to the far side, offset sideways
    const off = (this.rng() - 0.5) * 500;
    this.#flyTo(a, cp.x - c * d - s * off, h, cp.z - s * d + c * off);
    a.purpose = 'commute';
    a.vel.subVectors(a.target, a.pos).setY(0).setLength(a.sp.cruise);
  }

  // Dusk: flying birds go to roost on the nearest free railing; at night nothing flies.
  #nightfall() {
    if (this.activity > 0.35) return;
    for (const a of this.agents.slice()) {
      if (a.state === S.PERCH || a.state === S.LAND || a.purpose === 'roost') continue;
      const slot = this.#freeSlot(a);
      if (this.activity <= 0.02) {
        // full night (e.g. the clock jumped): settled at once, or gone
        this.#despawn(a);
        if (slot) this.#perchBird(slot, a.key === 'gannet' ? 'herringGull' : a.key);
      } else if (a.state !== S.UNDER && a.state !== S.PLUNGE) {
        if (slot && a.key !== 'gannet') { slot.bird = a; a.perch = slot; a.purpose = 'roost'; this.#approach(a); } else this.#leave(a);
      }
    }
  }

  #freeSlot(a) {
    let best = null, bd = 1.2e3;
    for (const p of this.perches.values()) for (const s of p.slots) {
      const d = Math.hypot(s.x - a.pos.x, s.z - a.pos.z);
      if (!s.bird && d < bd) { bd = d; best = s; }
    }
    return best;
  }

  // ---------------------------------------------------------------- state transitions
  #flyTo(a, x, y, z) { a.state = S.FLY; a.target.set(x, y, z); a.t0 = this.#t; }
  #leave(a) {
    this.flocks.get(a.blitzId)?.members.delete(a);
    a.blitzId = null; a.purpose = 'leave';
    const ang = this.rng() * TAU;
    this.#flyTo(a, a.pos.x + Math.cos(ang) * 900, lerp(10, 30, this.rng()), a.pos.z + Math.sin(ang) * 900);
  }
  #depart(a) {                                   // drop off the rail into flight
    a.state = S.DEPART; a.t0 = this.#t; a.until = this.#t + 0.8; a.legs = 1;
    a.vel.copy(this.#fwd(a)).multiplyScalar(3).setY(-1);
  }
  #approach(a) {                                 // to a point downwind of the perch, then land into the wind
    const s = a.perch, w = this.#wind;
    this.#flyTo(a, s.x + w.x * 10, s.y + 2.5, s.z + w.z * 10);
  }
  // Circling over the patch: while it feeds, tight orbits round a strike of the last 3 s (the birds
  // concentrate over the breaking fish), re-targeted every 1.5-4 s; otherwise wider over the patch.
  // One in seven of the gulls' and terns' turns is wider and higher (5-12 m out, 4-10 m up): birds
  // waiting their turn wheel over the ones working the surface; the flock stays a tight column over
  // the core (round 4: the old 8-20 m / 6-20 m wheel spread it over the sky).
  #circle(a, b, over = null) {
    const rng = this.rng, gannet = a.key === 'gannet', feeding = b.intensity > 0.5;
    const s = over ?? (feeding ? this.#recentStrike(b, 3) : null), wheel = !over && !gannet && rng() < 0.15;
    const r = wheel ? lerp(5, 12, rng()) : s ? lerp(...ORBIT_R[a.key], rng()) : gannet ? lerp(10, 25, rng()) : lerp(3, 9, rng());
    const cx = s && !wheel ? s.x - b.x : b.cx - b.x + (rng() - 0.5) * b.core, cz = s && !wheel ? s.z - b.z : b.cz - b.z + (rng() - 0.5) * b.core;
    a.orbit = { cx, cz, r, dir: rng() < 0.5 ? -1 : 1, h: wheel ? lerp(4, 10, rng()) : this.#forageHeight(a, b.state === 'down'), ph: rng() * TAU, ang: Math.atan2(a.pos.z - b.z - cz, a.pos.x - b.x - cx) };
    a.state = S.CIRCLE; a.t0 = this.#t;
    a.until = this.#t + (feeding ? lerp(1.5, 4, rng()) : gannet ? lerp(4, 14, rng()) : lerp(5, 16, rng()));
  }
  // Height (m above the sea) a flock member wheels at: gannets log-normal round their median
  // plunge height (most 10-30 m, up to 60 m), terns search higher in a lull.
  #forageHeight(a, lull = false) {
    if (a.key === 'gannet') return clamp(GANNET_MEDIAN_M * Math.exp(GANNET_SIGMA * gauss(this.rng)), ...GANNET_H);
    if (a.key === 'commonTern' && lull) return lerp(8, 15, this.rng());
    return lerp(...FORAGE_H[a.key], Math.pow(this.rng(), 1.4));
  }

  // ---------------------------------------------------------------- per-bird step
  #step(a, t, step) {
    const b = this.flocks.get(a.blitzId)?.blitz, rng = this.rng, age = t - a.t0, gannet = a.key === 'gannet', tern = a.key === 'commonTern';
    switch (a.state) {
      case S.PERCH: {
        // an occasional shuffle into the wind, or a wing stretch; in the morning the extra birds
        // that roosted overnight fly off
        if (t >= a.until) {
          a.until = t + lerp(8, 40, rng());
          const p = [...this.perches.values()].find((q) => q.slots.includes(a.perch));
          if (p && this.activity > 0.6 && p.slots.filter((q) => q.bird?.state === S.PERCH).length > p.dayN && rng() < 0.5) {
            a.perch.bird = a.perch = null; this.#leave(a); this.#depart(a);
            return;
          }
          a.stretchUntil = t + (rng() < 0.4 ? 0.9 : 0);
          a.yaw = this.#upwind() + a.perch.yawJitter + (rng() - 0.5) * 0.4;
        }
        const st = t < (a.stretchUntil ?? 0) ? Math.sin(Math.PI * (1 - (a.stretchUntil - t) / 0.9)) : 0;
        Object.assign(a, { fold: 1 - 0.55 * st, arm: 0.06 + 0.7 * st, hand: -0.2 * st, legs: 1 });
        return;
      }
      case S.DEPART:
        this.#integrate(a, step, this.#fwd(a).multiplyScalar(7).setY(-0.4), { flap: 1.15 });
        if (t >= a.until) { a.state = S.FLY; a.t0 = t; }
        return;
      case S.FLY: {
        const d = this.#v.subVectors(a.target, a.pos), dist = Math.hypot(d.x, d.z);
        const want = this.#w.set(d.x, 0, d.z).setLength(a.sp.cruise * a.speedMul * (a.purpose === 'roost' ? 0.75 : 1)).setY(clamp((a.target.y - a.pos.y) * 0.6, -2.5, 2.5));
        this.#integrate(a, step, want, {});
        if (a.purpose === 'leave' || a.purpose === 'commute') {
          if (Math.hypot(a.pos.x - this.#camera.position.x, a.pos.z - this.#camera.position.z) > DESPAWN_M || dist < 20) this.#despawn(a);
        } else if (a.purpose === 'roost' && a.perch && dist < 3) {
          a.state = S.LAND; a.t0 = t; a.from = a.pos.clone(); a.fromVel = a.vel.clone();
        } else if (a.purpose === 'join') {
          if (!b) this.#leave(a);
          else { a.target.set(b.x, a.target.y, b.z); if (dist < 45) { a.purpose = 'forage'; this.#forage(a, b); } }
        }
        return;
      }
      case S.CIRCLE: {
        if (!b) { this.#leave(a); return; }
        const o = a.orbit, speed = a.sp.cruise * (gannet ? 0.95 : 0.72) * a.speedMul;
        o.ang += o.dir * speed / o.r * step;
        const h = o.h + Math.min(1.5, 0.2 * o.h) * Math.sin(0.35 * t + o.ph) - curvatureDrop(a.pos.x, a.pos.z);   // over the mean sea
        const px = b.x + o.cx + Math.cos(o.ang) * o.r, pz = b.z + o.cz + Math.sin(o.ang) * o.r;
        this.#integrate(a, step, this.#w.set(-Math.sin(o.ang) * o.dir * speed + (px - a.pos.x) * 0.8, clamp((h - a.pos.y) * 0.8, -2.5, 2.5),
          Math.cos(o.ang) * o.dir * speed + (pz - a.pos.z) * 0.8), { glideBias: 0.15 });
        if (t >= a.until) this.#forage(a, b);
        return;
      }
      case S.HOVER: {
        if (!b) { this.#leave(a); return; }
        // drops quickly to its hover point, and dives only once it hangs there
        const want = this.#w.subVectors(a.target, a.pos).multiply(this.#n.set(1.5, 2.5, 1.5));
        this.#integrate(a, step, want.clampLength(0, 4), { hover: true });
        if (a.pos.distanceTo(a.target) > 0.6) a.until = Math.max(a.until, t + 0.4);
        if (t >= a.until) { if (rng() < 0.8) this.#plunge(a, b, this.#nearStrike(b, a.target, 4)); else this.#hoverAt(a, b); }
        return;
      }
      case S.PLUNGE: {
        a.vel.y -= (G + 0.004 * a.vel.y * Math.abs(a.vel.y)) * step;            // gravity, body drag
        const dx = a.target.x - a.pos.x, dz = a.target.z - a.pos.z;
        // a gannet darts near-vertically: its horizontal speed is limited to a fraction of the fall speed
        const lim = gannet ? 0.25 * Math.abs(a.vel.y) + 2 : Infinity, e = Math.min(1, step * (gannet ? 4 : 3)), kh = gannet ? 0.8 : 1.5;
        a.vel.x += (clamp(dx * kh, -lim, lim) - a.vel.x) * e;
        a.vel.z += (clamp(dz * kh, -lim, lim) - a.vel.z) * e;
        a.pos.addScaledVector(a.vel, step);
        const hs = Math.hypot(a.vel.x, a.vel.z);
        if (hs > 0.3) a.yaw += wrapPi(Math.atan2(a.vel.x, a.vel.z) - a.yaw) * Math.min(1, step * 6);
        // the body tips over ahead of the velocity (tip-over in the first 0.3-0.35 s)
        a.pitch = Math.min(Math.atan2(a.vel.y, Math.max(hs, 0.2)), gannet ? lerp(-0.2, -1.25, smooth(0, 0.35, age)) : lerp(-0.1, -1.0, smooth(0, 0.3, age)));
        a.bank *= Math.exp(-step / 0.2);
        const sea = this.#seaAt(a, t, 0.1), k = smooth(8, 5, a.pos.y - sea);
        // gannet: wings half-folded in a W, swept fully back below ~6 m
        Object.assign(a, gannet ? { fold: lerp(0.5, 1, k), arm: lerp(0.35, 0.05, k), hand: lerp(-0.3, 0, k) } : { fold: tern ? 0.55 : 0.4, arm: 0.55, hand: -0.45 },
          { flap: 0, legs: 0, head: 0, tailFan: 0 });
        if (a.pos.y > sea) return;
        const speed = a.vel.length(), P = PLUNGE[a.key] ?? PLUNGE.herringGull;
        this.ctx.blitz?.splashAt?.(a.pos.x, a.pos.z, lerp(...P.splash, clamp((speed - 8) / 16, 0, 1)), { radius: gannet ? 0.18 : 0.07, dirX: a.vel.x / Math.max(speed, 1e-3), dirZ: a.vel.z / Math.max(speed, 1e-3) });
        a.state = S.UNDER; a.t0 = t; a.until = t + lerp(...P.under, rng());
        a.pos.y = sea - (gannet ? 1.8 : 0.4);
        a.vel.set(0, 0, 0);
        return;
      }
      case S.UNDER:
        if (t < a.until) return;
        a.pos.y = this.#seaAt(a, t, 0) + 0.02;
        if (tern) this.#takeoff(a);
        else { a.state = S.FLOAT; a.t0 = t; a.until = t + (gannet ? lerp(2, 6, rng()) : lerp(3, 12, rng())); }
        return;
      case S.FLOAT:
        this.#float(a, t, step);
        if (t >= a.until) this.#takeoff(a);
        return;
      case S.TAKEOFF: {
        // a run off the surface into the wind (terns spring straight up)
        const speed = Math.min(a.sp.cruise * 0.75, 1.2 + age * (tern ? 7 : 4.5));
        this.#integrate(a, step, this.#fwd(a).multiplyScalar(speed).setY(tern ? 3.0 : age < 0.9 ? 0.15 : 1.8), { flap: 1.25 });
        a.legs = age < 0.9 && !tern ? 0.6 : a.legs;
        if (age < (gannet ? 3.5 : tern ? 1.2 : 2.2)) return;
        if (!b) this.#leave(a);
        // a gannet climbs back to its diving height and goes again within 5-15 s while they feed
        else if (gannet) { this.#circle(a, b); a.until = t + lerp(5, 15, rng()); } else this.#forage(a, b);
        return;
      }
      case S.DIP: {
        const sea = this.#seaAt(a, t, 0.15), d = this.#v.subVectors(a.target, a.pos), dist = Math.hypot(d.x, d.z);
        if (a.phaseDip !== 'pick') {
          const want = this.#w.set(d.x, 0, d.z).setLength(Math.max(3, Math.min(a.sp.cruise * 0.7, dist * 1.2))).setY(clamp((sea + 0.6 - a.pos.y) * 1.5, -4, 1));
          this.#integrate(a, step, want, { flap: dist < 6 ? 1.1 : 0.6 });
          a.head = 0.5; a.tailFan = dist < 6 ? 0.6 : 0;
          if (dist < 1.2 && a.pos.y - sea < 1.2) {
            if (a.sitAfter) { a.sitAfter = false; a.state = S.FLOAT; a.t0 = t; a.until = a.lullSit ? Infinity : t + lerp(5, 15, rng()); a.vel.set(0, 0, 0); return; }
            a.phaseDip = 'pick'; a.t0 = t;
            this.stats.dips++;
          }
          if (age > 12) this.#forage(a, b);
        } else {
          // the pick: legs down, tail fanned, then up and away
          this.#integrate(a, step, this.#fwd(a).multiplyScalar(2).setY(age < 0.35 ? -0.3 : 2.5), { flap: 1.2, pitchBias: 0.4 });
          Object.assign(a, { legs: age < 0.5 ? 0.7 : a.legs, head: 0.4, tailFan: 0.8 });
          if (age > 1.0) { a.phaseDip = null; if (!b) this.#leave(a); else { this.#circle(a, b); if (b.intensity > 0.5) a.until = t + lerp(2, 6, rng()); } }
        }
        return;
      }
      case S.LAND: {
        // final approach: decelerate onto the perch along a cubic, flaring (pitch up, legs down)
        const T = 1.6, u = clamp(age / T, 0, 1), s = a.perch;
        const end = this.#v.set(s.x, s.y + this.meshes[a.key].geometry.userData.footDrop, s.z);
        a.pos.copy(a.from).multiplyScalar(2 * u ** 3 - 3 * u ** 2 + 1).addScaledVector(a.fromVel, (u ** 3 - 2 * u ** 2 + u) * T * 0.6).addScaledVector(end, -2 * u ** 3 + 3 * u ** 2);
        a.yaw = Math.atan2(end.x - a.from.x, end.z - a.from.z);
        a.pitch = lerp(0, 0.5, smooth(0.4, 1, u));
        a.bank *= Math.exp(-step / 0.2);
        this.#flapPose(a, step, 1.1, 1.05);
        Object.assign(a, { legs: smooth(0.3, 0.8, u), tailFan: smooth(0.2, 0.7, u), head: 0 });
        if (u >= 1) { a.purpose = null; this.#setPerched(a); }
      }
    }
  }

  // Head and tail with the flight mode: a foraging tern or gull looks down at the water (head
  // cocked down), a hovering bird fans its tail; commuters look ahead.
  #headPose(a) {
    const hover = a.state === S.HOVER, circling = a.state === S.CIRCLE;
    a.head = hover ? 0.6 : circling && a.blitzId !== null ? (a.key === 'gannet' ? 0.25 : 0.35) : 0;
    a.tailFan = hover ? 1 : circling ? 0.2 : 0;
  }

  // Foraging choice for a flock member.
  #forage(a, b) {
    if (!b) { this.#leave(a); return; }
    const r = this.rng(), strike = this.#recentStrike(b, 3), down = b.state === 'down';
    if (a.key === 'commonTern') { if (!down && r < 0.85) this.#hoverAt(a, b); else this.#circle(a, b); }
    else if (a.key === 'gannet') { if (strike && r < 0.6) this.#plunge(a, b, strike); else this.#circle(a, b); }
    else if (down) { if (r < 0.15) this.#sit(a, ...this.#edge(b)); else this.#circle(a, b); }
    else if (strike && r < 0.6) this.#dip(a, strike);
    else if (strike && r < 0.68 && a.key === 'herringGull') this.#plunge(a, b, strike);
    else if (r > 0.9) this.#sit(a, ...this.#edge(b));
    else this.#circle(a, b);
  }
  // A strike of this blitz from the last `within` seconds (any of the last 8 s if none), or null.
  #recentStrike(b, within) {
    const all = (this.ctx.blitz?.recentStrikes ?? []).filter((q) => q.id === b.id), t = this.#t;
    const s = all.filter((q) => t - q.t < within);
    const l = s.length ? s : all;
    return l.length ? l[Math.floor(this.rng() * l.length)] : null;
  }
  // The strike of the last 2 s nearest p within rMax, or null.
  #nearStrike(b, p, rMax) {
    let best = null, bd = rMax * rMax;
    for (const q of this.ctx.blitz?.recentStrikes ?? []) {
      const d = (q.x - p.x) ** 2 + (q.z - p.z) ** 2;
      if (q.id === b.id && this.#t - q.t <= 2 && d < bd) { bd = d; best = q; }
    }
    return best;
  }
  // A tern hovers 1-6 m up (most of them low) over a fresh strike (the bait is showering there), or
  // anywhere over the working core, for 0.8-2.5 s before it plunges.
  #hoverAt(a, b) {
    const rng = this.rng, s = this.#recentStrike(b, 2);
    const ang = rng() * TAU, r = s ? lerp(0.5, 3, rng()) : b.core * Math.sqrt(rng()), c = s ?? { x: b.cx, z: b.cz };
    a.target.set(c.x + Math.cos(ang) * r, lerp(...HOVER_M, Math.pow(rng(), HOVER_SKEW)) + this.#seaAt(a, this.#t, 1), c.z + Math.sin(ang) * r);
    a.state = S.HOVER; a.t0 = this.#t; a.until = this.#t + lerp(0.8, 2.5, rng());
  }
  #plunge(a, b, strike = null) {
    const rng = this.rng, P = PLUNGE[a.key], s = strike ?? this.#nearStrike(b, a.pos, 1e3) ?? { x: b.cx, z: b.cz };
    const h = a.pos.y - this.#seaAt(a, this.#t, 1);
    if (a.key !== 'commonTern' && (h < P.from[0] * 0.8 || h > P.from[1] * 1.3)) {
      // get to a diving height first (gannets climb, gulls drop low): circle at it, dive next time
      this.#circle(a, b);
      a.orbit.h = a.key === 'gannet' ? this.#forageHeight(a) : lerp(...P.from, rng());
      return;
    }
    const ex = s.x + (rng() - 0.5) * 3, ez = s.z + (rng() - 0.5) * 3;
    if (a.key === 'gannet' && Math.hypot(ex - a.pos.x, ez - a.pos.z) > GANNET_DIVE_CONE * h) {
      // too far out for a steep dive: circle over the target (small orbit) and try again in 1-2 s
      this.#circle(a, b, { x: ex, z: ez });
      Object.assign(a.orbit, { r: lerp(3, 6, rng()), h: Math.max(h, P.from[0]) });
      a.until = this.#t + lerp(1, 2, rng());
      return;
    }
    a.target.set(ex, 0, ez);
    a.state = S.PLUNGE; a.t0 = this.#t;
    this.stats.plunges++;
    // a gannet from a stall at the top of a circle: slow forward, already falling
    const f = this.#fwd(a), hs = a.key === 'gannet' ? Math.min(Math.hypot(a.vel.x, a.vel.z), 4) : a.vel.length() * 0.4;
    a.vel.set(f.x * hs, Math.min(a.vel.y, a.key === 'gannet' ? -2 : -1), f.z * hs);
  }
  #dip(a, s) {
    a.target.set(s.x + (this.rng() - 0.5) * 3, 0, s.z + (this.rng() - 0.5) * 3);
    a.state = S.DIP; a.t0 = this.#t; a.phaseDip = null;
  }
  // A point on the water at the edge of a blitz's working core (gulls wait there).
  #edge(b) {
    const g = this.rng() * TAU, d = b.core * lerp(1.3, 2.6, this.rng());
    return [b.cx + Math.cos(g) * d, b.cz + Math.sin(g) * d];
  }
  // Settle on the water at (x, z) (a dip that ends sitting).
  #sit(a, x, z) { this.#dip(a, { x, z }); a.target.set(x, 0, z); a.sitAfter = true; }
  // Lull: settle on the water 10-30 m from where it is, and wait for the fish to come up.
  #sitNear(a) {
    const ang = this.rng() * TAU, d = lerp(10, 30, this.rng());
    this.#sit(a, a.pos.x + Math.cos(ang) * d, a.pos.z + Math.sin(ang) * d);
    a.lullSit = true;
  }
  #takeoff(a) {
    a.state = S.TAKEOFF; a.t0 = this.#t; a.lullSit = false;
    a.yaw = this.#upwind() + (this.rng() - 0.5) * 0.6;         // into the wind
    a.vel.set(0, 0, 0);
  }

  // Sitting on the sea: rides the surface (sampled every 0.12 s), faces into the wind.
  #float(a, t, step) {
    const ocean = this.ctx.ocean;
    if (ocean?.getSurface && t - a.seaT > 0.12) {
      ocean.getSurface(a.pos.x, a.pos.z, t, this.#surf);
      a.seaT = t; a.sea = this.#surf.y;
      (a.floatN ??= new THREE.Vector3()).copy(this.#surf.normal);
    }
    const target = (a.sea ?? -curvatureDrop(a.pos.x, a.pos.z)) + 0.35 * a.sp.stations[6][2] * a.sp.length;
    a.pos.y += (target - a.pos.y) * (1 - Math.exp(-step / 0.08));
    a.yaw += wrapPi(this.#upwind() - a.yaw) * (1 - Math.exp(-step / 2));
    const n = a.floatN, cy = Math.cos(a.yaw), sy = Math.sin(a.yaw);
    if (n) { a.pitch = -(n.x * sy + n.z * cy); a.bank = -(n.x * cy - n.z * sy); }   // the slope along and across the heading
    Object.assign(a, { fold: 1, arm: 0.05, hand: 0, legs: 0, flap: 0, head: 0, tailFan: 0 });
  }

  // ---------------------------------------------------------------- flight dynamics
  // Steers the ground velocity toward `want` (limited acceleration), then yaw / bank / pitch, the
  // wingbeat, head and tail. opts: hover (hovering into the wind), flap (forced flapping at this
  // amplitude), glideBias, pitchBias; otherwise the species' flap-glide rhythm.
  #integrate(a, step, want, opts) {
    const dv = this.#n.subVectors(want, a.vel).clampLength(0, (opts.hover ? 8 : 4.5) * step);
    a.vel.add(dv);
    a.pos.addScaledVector(a.vel, step);
    const hs = Math.hypot(a.vel.x, a.vel.z), yawPrev = a.yaw;
    if (opts.hover) a.yaw += wrapPi(this.#upwind() - a.yaw) * (1 - Math.exp(-step / 0.6));
    else if (hs > 0.5) a.yaw += wrapPi(Math.atan2(a.vel.x, a.vel.z) - a.yaw) * (1 - Math.exp(-step / 0.12));
    // coordinated turn: bank for the turn rate; hovering: the body held ~20° nose-up
    const bankT = opts.hover ? 0 : clamp(-Math.atan(wrapPi(a.yaw - yawPrev) / Math.max(step, 1e-3) * hs / G), -1, 1);
    a.bank += (bankT - a.bank) * (1 - Math.exp(-step / 0.2));
    a.pitch += ((opts.hover ? 0.35 : Math.atan2(a.vel.y, Math.max(hs, 1.5)) * 0.8 + (opts.pitchBias ?? 0)) - a.pitch) * (1 - Math.exp(-step / 0.2));
    // wingbeat: forced, hovering, climbing or slow (flapping), or the species' flap-glide rhythm
    let target = opts.flap ?? (opts.hover ? 1.15 : 1);
    if (opts.flap === undefined && !opts.hover && a.vel.y <= 0.8 && hs >= a.sp.cruise * 0.6) {
      if (this.#t >= a.cycleUntil) {
        a.gliding = !a.gliding && this.rng() < a.sp.glide + (opts.glideBias ?? 0);
        a.cycleUntil = this.#t + (a.gliding ? lerp(0.8, 3.2, this.rng()) : lerp(0.9, 2.6, this.rng()));
      }
      target = a.gliding ? 0 : 1;
    }
    this.#flapPose(a, step, target, opts.hover ? a.sp.hoverHz / a.sp.flapHz : target > 1.05 ? 1.1 : 1);
    a.legs = Math.max(0, a.legs - step * 1.5);
    if (opts.flap === undefined) this.#headPose(a);
  }

  // Wing pose from the wingbeat phase: arm elevation, the hand lagging behind it, a partial fold
  // on the upstroke; gliding holds the gull's shallow "M" (arm raised, hand lowered).
  #flapPose(a, step, target, freqMul) {
    a.flap += (target - a.flap) * (1 - Math.exp(-step / 0.15));
    const A = a.sp.amp, w = clamp(a.flap, 0, 1.3), m = Math.min(w, 1);
    a.phase = (a.phase + TAU * a.sp.flapHz * freqMul * step) % TAU;
    a.arm = lerp(0.14, 0.08 + A[0] * w * Math.sin(a.phase), m);
    a.hand = lerp(-0.26, -0.05 + A[1] * w * Math.sin(a.phase - A[2]), m);
    a.fold = lerp(0.04, 0.05 + 0.24 * Math.max(0, Math.cos(a.phase)) * w, m);
  }

  #orient(a) { a.quat.setFromEuler(this.#e.set(-a.pitch, a.yaw, a.bank)); }
  #fwd(a) { return this.#v.set(Math.sin(a.yaw), 0, Math.cos(a.yaw)); }
  // Unit vector the wind blows toward (U.uWind); birds face the other way on perches and water.
  #windAway() {
    const w = U.uWind.value, l = Math.hypot(w.x, w.y);
    if (l > 1e-3) this.#wind.set(w.x / l, 0, w.y / l);
  }
  #upwind() { return Math.atan2(-this.#wind.x, -this.#wind.z); }

  // Sea height under a bird, refreshed at most every `every` seconds (at the current time only: the
  // ocean's CPU mirror caches one time).
  #seaAt(a, t, every) {
    if (a.sea === null || t - a.seaT >= every) {
      a.sea = this.ctx.ocean?.getHeight?.(a.pos.x, a.pos.z, t) ?? -curvatureDrop(a.pos.x, a.pos.z);
      a.seaT = t;
    }
    return a.sea;
  }
}

// A standard normal deviate (Box-Muller).
function gauss(rng) { return Math.sqrt(-2 * Math.log(1 - rng() * 0.9999)) * Math.cos(TAU * rng()); }

// ---------------------------------------------------------------- dev builds: the scale registry
if (globalThis.NJOW_DEV !== false) {
  Birds.prototype._registerScales = function () {
    const reg = (name, v, metres, tolerance, source) => registerScale({ name, measure: () => ({ x: v, y: v, z: v }), expect: { axis: 'y', metres, tolerance }, source });
    for (const [key, m] of Object.entries(this.meshes)) {
      registerScale({ name: `bird.${key}.wingspan`, geometry: m.geometry, expect: { axis: 'x' }, source: 'birds.js: measured from the built geometry (wings spread)' });
      registerScale({ name: `bird.${key}.length`, geometry: m.geometry, expect: { axis: 'z', metres: BIRD_SPECIES[key].length, tolerance: 0.12 * BIRD_SPECIES[key].length }, source: 'birds.js: bill tip to tail tip; config LIFE.birds' });
    }
    reg('bird.gannet.plungeStart.min', PLUNGE.gannet.from[0], 11, 0.5, 'birds.js PLUNGE (gannet heights log-normal, median 20 m); config LIFE.birds.gannet.plungeStart');
    reg('bird.gannet.plungeStart.max', PLUNGE.gannet.from[1], 60, 1, 'birds.js PLUNGE; config LIFE.birds.gannet.plungeStart');
    reg('bird.commonTern.hover.min', HOVER_M[0], 1, 0.2, 'birds.js HOVER_M (skewed low); config LIFE.birds.commonTern.hoverHeight');
    reg('bird.commonTern.hover.max', HOVER_M[1], 6, 0.5, 'birds.js HOVER_M; config LIFE.birds.commonTern.hoverHeight');
  };
}
