// Vestas V236-15.0 MW on an Atlantic Shores monopile + transition piece, built procedurally in metres.
// Owner: modeller. Every number comes from research/SCENE-SPEC.md §4 through src/config.js (TURBINE,
// PAINT, MARKINGS); the few extra estimates are named constants below with their basis.
//
// Frames (ARCHITECTURE.md, turbine/turbine.js):
//   static  : origin on the foundation axis at MSL, +Y up, world azimuths (A -> (sin A, 0, -cos A)).
//             Monopile, TP, platform, railings, boat landing, davit, lanterns, tower.
//   nacelle : the yaw frame. Origin on the tower axis at the yaw bearing (static y = 146.4), rotor side +Z.
//   rotor   : origin at the hub centre, spin axis +Z (upwind), blade 0 along +Y at spin 0, cone baked in.
//   rotorMatrix = nacelleMatrix * T(hubOffset) * Rx(-tilt) * Rz(spin)   (see composeTurbineMatrices)
//
// Every part is { name, geometry, material, castShadow, receiveShadow }. Geometries carry
//   position, normal, uv, aBand (photo-look markings), aWear (blade leading-edge wear / grating layout),
//   aSurf (surface class for the procedural weathering), and the ID part also aTurbineIndex.
// Three parts are transparent and draw after the opaque pass, in this order: 'thin' (rails, tubes,
//   ladders, platform frame, lamp housings, distant blades: never narrower than 1.5 px, alpha = true
//   coverage; also carries aThinAxis/aThinChord/aThinSpan), 'idMarkings' (SDF lettering decal) and
//   'grating' (see-through walkway grating, hero LOD only). On LOD 1 the nacelle's thin fittings and the
//   grating fold back into the opaque family parts (foldThinParts), so they cost no extra draw calls there;
//   rotor 'thin' (the blades) is LOD 1 only. All parts of a turbine share one bounding sphere (SORT_CENTRE),
//   so they keep this order under either depth convention.
// Small flat details are drawn by the materials rather than modelled: the TP door, the nacelle's
//   photo-look stripe and the substation helideck markings. The monopile below the marine-growth band
//   is part of 'marineGrowth' (surface class 12). All weathering noise comes from one 32^3 RGBA texture.
// Geometries are fresh per call; materials are shared singletons (createTurbineMaterials()).
import * as THREE from 'three';
import { TURBINE, PAINT, MARKINGS, SCALE_TABLE, NIGHT_LIGHTS, layoutPositions } from '../config.js';
import { registerScale, azimuthToDir, mulberry32 } from '../shared.js';
import { applyAtmosphere } from '../env/fog.js';
import { GLYPH_ORDER, buildGlyphAtlas, glyphAtlasLayout, textWidth } from './glyphs.js';

// ------------------------------------------------------------------------------------------------
// Constants (SCENE-SPEC §4 unless marked ESTIMATED)
// ------------------------------------------------------------------------------------------------
const DEG = Math.PI / 180;
const T = TURBINE;
const ST = TURBINE.stack;
const YAW_Y = ST.towerTop;                                   // 146.4, yaw bearing / tower top
const HUB_OFFSET = new THREE.Vector3(...T.hubCentre);        // (0, 5.6, 12.0) in the yaw frame
const TILT = T.tiltDeg * DEG;
const CONE = T.coneDeg * DEG;
const BLADE_ROOT_R = T.hubRadius;                            // 3.0 m, blade-root circle radius
const BLADE_LEN = T.bladeLength;                             // 115.5 m
const TP_R = T.tp.diameter / 2;                              // 5.25
const PILE_R = 5.0;                                          // monopile Ø10 m at MSL (Empire Wind PDE, §4.6)
const TP_BOTTOM_Y = -6.0;                                    // ESTIMATED: TP skirt overlaps the pile below LAT
const FLANGE_Y = ST.tpTop - T.tp.topFlange.height;           // 21.2: TP shell top / flange underside
const FLANGE_OUT_R = TP_R + T.tp.topFlange.proud;            // 5.55
const TOWER_FLANGE_TOP = ST.tpTop + 0.12;                    // ESTIMATED tower base flange thickness
const DECK_R = T.platform.outerDiameter / 2;                 // 7.875
const LOBE_REACH = T.platform.lobeSpan - DECK_R;             // 12.525 m from the axis toward the landing
const LOBE_HALF_W = 3.4;                                     // ESTIMATED lobe half-width
const LOBE_CORNER_R = 1.2;                                   // ESTIMATED
// Open-frame platform (replaces the closed conical skirt; see buildPlatform). All ESTIMATED from
// typical monopile TP external platforms: yellow brackets, knee braces and secondary beams (the TP's
// coating system), a galvanised rim channel, 30 mm galvanised walkway grating.
const GRATING_T = 0.03;
const RIM_H = 0.25, RIM_W = 0.08;
const BEAM_H = 0.30, BEAM_W = 0.14;
const SEC_H = 0.20, SEC_W = 0.10;
const BRACE_R = 0.085;                                       // Ø 170 mm knee-brace tubes
const RING_BRACE_OUT_R = 7.0;                                // knee brace meets the bracket 1.75 m out
const LOBE_BEAM_U0 = 7.5, LOBE_BEAM_PITCH = 1.5;             // transverse beams under the landing lobe
const LOBE_LONG_V = [-3.3, -0.9, 3.3];                       // lobe brackets, clear of the upper ladder (v 0.65-1.15)
const LOBE_BRACE_FOOT_Y = 15.2, LOBE_BRACE_TOP_U = 9.6;      // 7 m cantilever: braces reach 3 m down the TP
const TOE_H = 0.15;                                          // toe plate height (EN ISO 14122-3)
const KNEE_ABOVE_DECK = 0.60;                                // knee rail centre: both clear gaps <= 0.5 m
const RAIL_R = 0.0242, KNEE_R = 0.0213, POST_R = 0.0242;     // 48.3 / 42.4 mm tube (ESTIMATED)
const LANDING_AZ = T.boatLanding.facingDeg;                  // 20 deg T
const LADDER_U = TP_R + 0.35;                                // ladder rung line, 0.35 m off the TP wall (ESTIMATED)
const TUBE_U = LADDER_U + T.boatLanding.ladderSetback - T.boatLanding.tubeDiameter / 2;   // tube axis
const UPPER_LADDER_V = 0.9;                                  // upper ladder offset over the right tube (ESTIMATED)
const DOOR_AZ = LANDING_AZ + 25;                             // ESTIMATED: beside the ladder hatch, landing side
// Painted IDs: three copies 120 deg apart (BOEM 2021: readable round 360 deg from the water), one
// centred toward the reference drone camera (the hero seen from azimuth 237 deg). A camera facing any
// copy sees that ID whole and at most a limb sliver of another (four copies at 90 deg showed '01 F0'
// pairs). The 352 deg copy's ink (<= +-30 deg) clears the upper landing ladder at 26.6-31.6 deg.
const ID_AZIMUTHS = [232, 352, 112];
const MIDMAST_AZIMUTHS = [74, 164, 254, 344];
const LANTERN_AZIMUTHS = [LANDING_AZ + 90, LANDING_AZ + 270];
const LANTERN_R = DECK_R - 0.33;
const DAVIT_UV = [11.2, 2.4];                                // landing frame (u out, v right), ESTIMATED
// L-864 lamp centres (yaw frame) on short masts above the cooler (config NIGHT_LIGHTS.l864.y = 161.2 m,
// TURBINE.stack.l864): 1.0 m over the cooler top, so the pair stays visible from astern (FAA: 360 deg).
const L864_Y = NIGHT_LIGHTS.l864.y - ST.towerTop;           // 14.8
const L864_POS = [[-3.3, L864_Y, -3.3], [3.3, L864_Y, -3.3]];

// Spinner: rounded cone Ø7.5 x 6.0 m, nose 3.5 m ahead of the hub centre (§4.4).
const SP_NOSE = T.spinner.noseAheadOfHub;                    // +3.5
const SP_REAR = SP_NOSE - T.spinner.length;                  // -2.5
const SP_RMAX = T.spinner.diameter / 2;                      // 3.75
const SP_Z0 = 0.4, SP_N = 2.2, SP_RREAR = 3.30;              // ESTIMATED nose shape and rear rim

// Nacelle box (yaw frame): x +-4.5, y 1..12, z -10..+9, top edges r = 1.
const NAC = T.nacelle;
const NAC_W = NAC.width / 2, NAC_Y0 = NAC.floorY, NAC_Y1 = NAC.floorY + NAC.height;
const NAC_Z0 = NAC.boxRearZ, NAC_Z1 = NAC.boxFrontZ, NAC_RT = NAC.topEdgeRadius, NAC_RB = 0.25;
const STRIPE_Y0 = (NAC_Y0 + NAC_Y1) / 2 - MARKINGS.nacelleStripe.height / 2;   // 5.5
const STRIPE_Y1 = STRIPE_Y0 + MARKINGS.nacelleStripe.height;                     // 7.5
const STRIPE_Z = NAC_Z0 + 6.0;                               // ESTIMATED: stripe wraps the rear 6 m
// Heli-hoist deck: 9 x 3 m at roof level. It overhangs the rear wall by 2.5 m so that spinner nose to
// deck rear = 28.0 m (SCALE_TABLE overallNacelleLength); SCENE-SPEC's "flush" split sums to 25.5 m.
const HELI_Z1 = NAC_Z0 + 0.5, HELI_Z0 = HELI_Z1 - NAC.heliDeck.length;           // -9.5 .. -12.5
const HELI_FRAME_D = 0.42;                                   // ESTIMATED depth of the deck's frame beams
const COOLER = { x: 3.5, z0: -9.3, z1: -3.8, h: NAC.cooler.height };             // on the flat roof

const TIP_BANDS = MARKINGS.tipBands;                         // 3 x 11.8 m from the tip
const TIP_R = BLADE_ROOT_R + BLADE_LEN;                      // 118.5 along the pitch axis
const BAND_EDGES_S = [3, 2, 1].map(k => (TIP_R - k * TIP_BANDS.lengthEach - BLADE_ROOT_R) / BLADE_LEN);
const S_CAP = 0.98;                                          // rounded swept tip cap over the last 2 % (§4.3)

// Surface classes read by the weathering shader (aSurf).
export const SURF = {
  plain: 0, tower: 1, nacelle: 2, spinner: 3, blade: 4, paintMisc: 5, tpShell: 7, yellowMisc: 8,
  grating: 9, galvMisc: 10, growth: 11, pile: 12, darkMisc: 13, radiator: 14, cladding: 15, jacket: 16, skirt: 17, louvre: 18,
  radiatorBank: 19, claddingWhite: 20, lifeboat: 21, lensYellow: 24, lensRed: 25, helideck: 26,
};
// The substation's octagonal helideck (local frame, metres): its CAP 437 markings are drawn by the paint shader.
export const OSS_HELIDECK = { x: 32.5, z: 12.5, flat: 22, net: 1.5, y: 60.3 };   // D-value 22 m
const { paintMisc: S_PAINT, yellowMisc: S_YELLOW, galvMisc: S_GALV, darkMisc: S_DARK } = SURF;   // the common ones, short
const LENS_YELLOW_LIN = [0.80, 0.45, 0.02], LENS_RED_LIN = [0.40, 0.012, 0.01];

// ------------------------------------------------------------------------------------------------
// Level of detail. Silhouettes and dimensions are identical; only tessellation and small parts change.
// LOD 0 (near: the hero, < ~1.5 km) carries every part, see-through grating, opaque blades and thin nacelle
// fittings; LOD 1 (< ~6 km) simple rails and landing, no bolts, hatches, mid-mast lamps or pile, its blades
// thin features and its nacelle fittings folded into the opaque parts. Farm draws farther turbines itself.
// ------------------------------------------------------------------------------------------------
const LODS = [
  { near: true, blade: { side: 56, base: 3, ribs: 112, cap: [0, 0.22, 0.42, 0.58, 0.70, 0.80, 0.88, 0.935, 0.97, 0.99, 0.998] },
    spinner: { seg: 96, nose: 26, rear: 10 }, round: 128, towerRings: 46, nacArc: 7,
    nacEnd: [0, 0.02, 0.08, 0.18, 0.32, 0.5, 0.72, 1], outlineStep: 0.25, railSides: 8, idOffset: 0.006 },
  { near: false, blade: { side: 14, base: 2, ribs: 34, cap: [0, 0.45, 0.75, 0.92, 0.99] }, spinner: { seg: 24, nose: 8, rear: 3 },
    round: 32, towerRings: 12, nacArc: 2, nacEnd: [0, 0.3, 1], outlineStep: 1.2, railSides: 4, idOffset: 0.012 },
];
export const TURBINE_LOD_COUNT = LODS.length;

// ------------------------------------------------------------------------------------------------
// Small math helpers
// ------------------------------------------------------------------------------------------------
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
function interp1(pairs, x) {                                 // piecewise-linear, clamped
  let i = 1;
  while (i < pairs.length - 1 && x > pairs[i][0]) i++;
  const [x0, y0] = pairs[i - 1], [x1, y1] = pairs[i];
  return lerp(y0, y1, clamp((x - x0) / (x1 - x0), 0, 1));
}
// Monotone cubic (Fritsch-Carlson) interpolant, clamped at the ends.
function pchip(xs, ys) {
  const n = xs.length, h = [], d = [], m = [];
  for (let i = 0; i < n - 1; i++) { h[i] = xs[i + 1] - xs[i]; d[i] = (ys[i + 1] - ys[i]) / h[i]; }
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) {
    const w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1];
    m[i] = d[i - 1] * d[i] <= 0 ? 0 : (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
  }
  return (x) => {
    if (x <= xs[0] || x >= xs[n - 1]) return x <= xs[0] ? ys[0] : ys[n - 1];
    let i = 0; while (x > xs[i + 1]) i++;
    const t = (x - xs[i]) / h[i], t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h[i] * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h[i] * m[i + 1];
  };
}
// Landing frame: u out along the landing azimuth, v to its right.
const LF = (() => {
  const u = azimuthToDir(LANDING_AZ), v = azimuthToDir(LANDING_AZ + 90);
  return { u, v, at: (uu, vv, y) => V3(u.x * uu + v.x * vv, y, u.z * uu + v.z * vv) };
})();
const azPoint = (azDeg, r, y) => azimuthToDir(azDeg).multiplyScalar(r).setY(y);

// ------------------------------------------------------------------------------------------------
// PartBuilder: accumulates one material's geometry in one frame, with the shared attribute set.
// Quads/triangles are wound automatically against the vertex normals, so every primitive below only
// has to produce correct outward normals.
// ------------------------------------------------------------------------------------------------
const ATTR_SIZE = { position: 3, normal: 3, uv: 2, aBand: 1, aWear: 1, aSurf: 1, aThinAxis: 3, aThinChord: 3, aThinSpan: 4 };
const _vp = V3(), _vn = V3(), _va = V3(), _vc = V3(), _vs = V3();
export class PartBuilder {
  // { thin: true } adds the thin-feature attributes (aThinAxis, aThinChord, aThinSpan) that the thin
  // materials use to keep sub-pixel tubes, rails and distant blades at >= 1.5 px with their true coverage
  // as alpha (see THIN_PROJECT). Primitives fill them automatically (sweep/tube/bar); loft callers pass
  // attr.thin = { axis, chord, span, b } per vertex.
  constructor({ thin = false } = {}) {
    this.thin = thin;
    this.A = {};
    for (const k in ATTR_SIZE) if (thin || !k.startsWith('aThin')) this.A[k] = [];
    this.idx = []; this.attr = { band: 0, wear: 0, surf: 0, thin: null };
    this.stack = []; this.m = null; this.nm = null;
    this.ranges = {};
    this.extra = null;                                        // optional extra per-vertex float attribute
  }
  get count() { return this.A.position.length / 3; }
  set(attr) { Object.assign(this.attr, attr); return this; }
  surf(code) { this.attr.surf = code; return this; }
  push(m) {
    this.stack.push([this.m, this.nm]);
    this.m = this.m ? this.m.clone().multiply(m) : m.clone();
    this.nm = new THREE.Matrix3().setFromMatrix4(this.m);     // rigid transforms: the upper 3x3
    return this;
  }
  pop() { [this.m, this.nm] = this.stack.pop(); return this; }
  begin(name) { this.ranges[name] = [this.count, this.count]; return this; }
  end(name) { this.ranges[name][1] = this.count; return this; }
  vert(x, y, z, nx, ny, nz, u = 0, v = 0, attr = this.attr) {
    const P = _vp.set(x, y, z), N = _vn.set(nx, ny, nz), A = this.A, t = this.thin && attr.thin;
    // Thin-feature data in the local frame: the section centre (axis point), the chord half-vector, the span
    // direction and the half-thickness b. No data: axis = the vertex itself, never widened.
    const ax = _va.copy(P), ch = _vc.set(0, 0, 0), sp = _vs.set(0, 0, 0);
    if (t) {
      if (t.line) { sp.copy(t.line.dir); ax.copy(t.line.c).addScaledVector(sp, P.clone().sub(t.line.c).dot(sp)); }   // onto the bar's centre line
      else { ax.copy(t.axis); sp.copy(t.span); }
      ch.copy(t.chord);
    }
    if (this.m) { P.applyMatrix4(this.m); N.applyMatrix3(this.nm); ax.applyMatrix4(this.m); ch.applyMatrix3(this.nm); sp.applyMatrix3(this.nm); }
    N.normalize();
    A.position.push(P.x, P.y, P.z); A.normal.push(N.x, N.y, N.z); A.uv.push(u, v);
    A.aBand.push(attr.band); A.aWear.push(attr.wear); A.aSurf.push(attr.surf);
    if (this.thin) { A.aThinAxis.push(ax.x, ax.y, ax.z); A.aThinChord.push(ch.x, ch.y, ch.z); A.aThinSpan.push(sp.x, sp.y, sp.z, t ? t.b : 0); }
    return this.count - 1;
  }
  // Triangle wound so its face normal agrees with the summed vertex normals.
  tri(a, b, c) {
    const P = this.A.position, N = this.A.normal, e = (i, k) => P[3 * i + k] - P[3 * a + k], s = (k) => N[3 * a + k] + N[3 * b + k] + N[3 * c + k];
    const f = (i, j) => e(b, i) * e(c, j) - e(b, j) * e(c, i);
    if (f(1, 2) * s(0) + f(2, 0) * s(1) + f(0, 1) * s(2) >= 0) this.idx.push(a, b, c); else this.idx.push(a, c, b);
  }
  // a-b-d-c ring order: a,b on one edge, c,d on the next (a-c and b-d are the other two edges).
  quad(a, b, c, d) { this.tri(a, b, c); this.tri(b, d, c); }
  build() {
    const g = new THREE.BufferGeometry();
    for (const [k, a] of Object.entries(this.A)) g.setAttribute(k, new THREE.Float32BufferAttribute(a, ATTR_SIZE[k]));
    if (this.extra) g.setAttribute(this.extra.name, new THREE.Float32BufferAttribute(new Float32Array(this.count).fill(this.extra.value), 1));
    g.setIndex(this.idx);
    g.computeBoundingBox();                                   // the bounding sphere is set by the caller (sortSphere)
    return g;
  }
  // Move every triangle into the builder pick(surfCode) returns (vertices copied as built, no matrix), then
  // empty this builder. Distant LODs use it to fold thin features and grating back into the opaque family
  // parts (no extra draw calls where the thin treatment no longer matters).
  transferTo(pick) {
    const remap = [];
    for (let t = 0; t < this.idx.length; t += 3) {
      const dst = pick(this.A.aSurf[this.idx[t]]);
      for (let k = 0; k < 3; k++) {
        const i = this.idx[t + k];
        if (remap[i]?.[0] !== dst) remap[i] = [dst, dst.copyVertex(this, i)];
        dst.idx.push(remap[i][1]);
      }
    }
    for (const a of Object.values(this.A)) a.length = 0;
    this.idx.length = 0; this.ranges = {};
  }
  copyVertex(src, i) {
    for (const k in this.A) {
      const n = ATTR_SIZE[k], s = src.A[k] || (k === 'aThinAxis' ? src.A.position : null);   // unthin source: axis = the vertex
      for (let j = 0; j < n; j++) this.A[k].push(s ? s[n * i + j] : 0);
    }
    return this.count - 1;
  }
}
// Vertex positions of a builder's named range, or all of them (already transformed): for the dev-only
// measurements (turbine dims, substation topside).
export function builderPositions(b, name) {
  const [a, e] = name ? b.ranges[name] : [0, b.count], P = b.A.position, out = [];
  for (let i = a; i < e; i++) out.push(V3(P[3 * i], P[3 * i + 1], P[3 * i + 2]));
  return out;
}

// ------------------------------------------------------------------------------------------------
// Geometry primitives
// ------------------------------------------------------------------------------------------------

// Loft through rings of points (rings[j][k]) with finite-difference normals. closedK wraps the
// contour, closedJ wraps the rings. `outward` is a direction used once to orient all normals.
// attrFn(j, k) may return per-vertex attribute overrides and uv.
function loft(b, rings, { closedK = false, closedJ = false, outward = null, outwardAt = null, attrFn = null } = {}) {
  const nJ = rings.length, nK = rings[0].length, EPS2 = 1e-12;
  const tk = V3(), tj = V3(), nrm = V3(), prev = V3(0, 1, 0);
  const normals = [];
  const pick = (arr, i, step, closed, n) => {                  // next distinct neighbour index
    const base = arr(i);
    for (let s = 1; s < n; s++) {
      let q = i + step * s;
      if (closed) q = (q % n + n) % n; else if (q < 0 || q >= n) return i;
      if (arr(q).distanceToSquared(base) > EPS2) return q;
    }
    return i;
  };
  for (let j = 0; j < nJ; j++) {
    const row = [];
    for (let k = 0; k < nK; k++) {
      const kA = pick((q) => rings[j][q], k, -1, closedK, nK), kB = pick((q) => rings[j][q], k, 1, closedK, nK);
      const jA = pick((q) => rings[q][k], j, -1, closedJ, nJ), jB = pick((q) => rings[q][k], j, 1, closedJ, nJ);
      tk.subVectors(rings[j][kB], rings[j][kA]);
      tj.subVectors(rings[jB][k], rings[jA][k]);
      nrm.crossVectors(tk, tj);
      if (nrm.lengthSq() < 1e-18) nrm.copy(prev); else nrm.normalize();
      prev.copy(nrm);
      row.push(nrm.clone());
    }
    normals.push(row);
  }
  // Orientation: one reference vertex decides the sign for the whole grid.
  const [rj, rk] = outwardAt || [Math.floor(nJ / 2), Math.floor(nK / 2)];
  let sign = 1;
  if (outward) sign = normals[rj][rk].dot(outward) >= 0 ? 1 : -1;
  const ids = [];
  for (let j = 0; j < nJ; j++) {
    const row = [];
    for (let k = 0; k < nK; k++) {
      const P = rings[j][k], N = normals[j][k];
      const a = attrFn ? attrFn(j, k) : null;
      const attr = a ? { ...b.attr, ...a } : b.attr;
      row.push(b.vert(P.x, P.y, P.z, N.x * sign, N.y * sign, N.z * sign, a?.u ?? k / (nK - 1), a?.v ?? j / (nJ - 1), attr));
    }
    ids.push(row);
  }
  const jEnd = closedJ ? nJ : nJ - 1, kEnd = closedK ? nK : nK - 1;
  const coincident = (ra, rb) => ra.every((p, k) => p.distanceToSquared(rb[k]) < 1e-12);
  for (let j = 0; j < jEnd; j++) {
    const j1 = (j + 1) % nJ;
    if (coincident(rings[j], rings[j1])) continue;
    for (let k = 0; k < kEnd; k++) {
      const k1 = (k + 1) % nK;
      b.quad(ids[j][k], ids[j][k1], ids[j1][k], ids[j1][k1]);
    }
  }
  return ids;
}

// Fan from a centre vertex to a loop of existing vertex indices.
function fan(b, centre, normal, loopIds, attr) {
  const c = b.vert(centre.x, centre.y, centre.z, normal.x, normal.y, normal.z, 0.5, 0.5, attr || b.attr);
  for (let i = 0; i < loopIds.length - 1; i++) b.tri(c, loopIds[i], loopIds[i + 1]);
  return c;
}

// Surface of revolution about local Y. prof: [[r, y], ...] walked with the outside on the right
// (walls bottom->top, top faces outer->inner). Azimuth follows the compass convention.
function revolve(b, prof, segs, { az0 = 0, az1 = 360, smooth = false } = {}) {
  const full = Math.abs(az1 - az0) >= 360 - 1e-6;
  const nA = full ? segs : segs + 1;
  const segN = [];
  for (let i = 0; i < prof.length - 1; i++) {
    const dr = prof[i + 1][0] - prof[i][0], dy = prof[i + 1][1] - prof[i][1], l = Math.hypot(dr, dy) || 1;
    segN.push([dy / l, -dr / l]);
  }
  const rows = [];                                           // each row: [r, y, nr, ny]
  for (let i = 0; i < prof.length; i++) {
    if (smooth) {
      const a = segN[Math.max(0, i - 1)], c = segN[Math.min(segN.length - 1, i)];
      const nr = a[0] + c[0], ny = a[1] + c[1], l = Math.hypot(nr, ny) || 1;
      rows.push([[prof[i][0], prof[i][1], nr / l, ny / l]]);
    } else {
      const out = [];
      if (i > 0) out.push([prof[i][0], prof[i][1], segN[i - 1][0], segN[i - 1][1]]);
      if (i < prof.length - 1) out.push([prof[i][0], prof[i][1], segN[i][0], segN[i][1]]);
      rows.push(out);
    }
  }
  // Emit vertex rings; each profile segment uses the vertex copy carrying its own normal.
  const ringIds = [];
  for (let i = 0; i < prof.length; i++) {
    const copies = rows[i].map(([r, y, nr, ny]) => {
      const ids = [];
      for (let k = 0; k < nA; k++) {
        const az = (az0 + (az1 - az0) * k / segs) * DEG, s = Math.sin(az), c = -Math.cos(az);
        ids.push(b.vert(r * s, y, r * c, nr * s, ny, nr * c, k / segs, i / (prof.length - 1)));
      }
      return ids;
    });
    ringIds.push(copies);
  }
  for (let i = 0; i < prof.length - 1; i++) {
    const A = ringIds[i][ringIds[i].length - 1];              // outgoing copy (the only one when smooth)
    const B = ringIds[i + 1][0];                               // incoming copy
    for (let k = 0; k < segs; k++) {
      const k1 = full ? (k + 1) % segs : k + 1;
      b.quad(A[k], A[k1], B[k], B[k1]);
    }
  }
}

// Sweep a 2D section along a 3D path with rotation-minimising frames (parallel transport).
// section: [{x, y, nx, ny}], x along the binormal, y along the frame normal (initially `up`).
function sweep(b, path, section, { closed = false, caps = true, up = V3(0, 1, 0), closedSection = true } = {}) {
  const n = path.length;
  const Tn = [], Nn = [], Bn = [];
  for (let i = 0; i < n; i++) {
    const a = path[closed ? (i - 1 + n) % n : Math.max(0, i - 1)], c = path[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
    Tn.push(V3().subVectors(c, a).normalize());
  }
  let N0 = up.clone().sub(Tn[0].clone().multiplyScalar(up.dot(Tn[0])));
  if (N0.lengthSq() < 1e-8) N0 = Math.abs(Tn[0].x) < 0.9 ? V3(1, 0, 0) : V3(0, 0, 1);
  N0.normalize().sub(Tn[0].clone().multiplyScalar(N0.dot(Tn[0]))).normalize();
  Nn.push(N0);
  const q = new THREE.Quaternion();
  for (let i = 1; i < n; i++) {
    q.setFromUnitVectors(Tn[i - 1], Tn[i]);
    Nn.push(Nn[i - 1].clone().applyQuaternion(q).normalize());
  }
  if (closed && n > 2) {                                     // distribute the closure twist
    q.setFromUnitVectors(Tn[n - 1], Tn[0]);
    const end = Nn[n - 1].clone().applyQuaternion(q);
    let ang = Math.atan2(V3().crossVectors(end, N0).dot(Tn[0]), end.dot(N0));
    for (let i = 0; i < n; i++) {
      const r = new THREE.Quaternion().setFromAxisAngle(Tn[i], ang * i / n);
      Nn[i].applyQuaternion(r);
    }
  }
  for (let i = 0; i < n; i++) Bn.push(V3().crossVectors(Tn[i], Nn[i]).normalize());
  const m = section.length;
  // Thin builders: every vertex of ring i carries the path point, the tangent and the section
  // half-extents (section.thinExt = [half-width along the binormal, half-height along the normal]).
  const ext = section.thinExt;
  const thinAt = (i) => (b.thin && ext ? { ...b.attr, thin: { axis: path[i], span: Tn[i], chord: Bn[i].clone().multiplyScalar(ext[0]), b: ext[1] } } : b.attr);
  const ids = [];
  for (let i = 0; i < n; i++) {
    const row = [], at = thinAt(i);
    for (let k = 0; k < m; k++) {
      const s = section[k], P = path[i], Nf = Nn[i], Bf = Bn[i];
      row.push(b.vert(
        P.x + Bf.x * s.x + Nf.x * s.y, P.y + Bf.y * s.x + Nf.y * s.y, P.z + Bf.z * s.x + Nf.z * s.y,
        Bf.x * s.nx + Nf.x * s.ny, Bf.y * s.nx + Nf.y * s.ny, Bf.z * s.nx + Nf.z * s.ny, k / (m - 1), i / (n - 1), at));
    }
    ids.push(row);
  }
  const iEnd = closed ? n : n - 1;
  for (let i = 0; i < iEnd; i++) {
    const i1 = (i + 1) % n;
    for (let k = 0; k < m - 1; k += section.dupEnds ? 2 : 1) b.quad(ids[i][k], ids[i][k + 1], ids[i1][k], ids[i1][k + 1]);
    if (closedSection && section.length > 2 && !section.dupEnds) b.quad(ids[i][m - 1], ids[i][0], ids[i1][m - 1], ids[i1][0]);
  }
  if (caps && !closed) {
    for (const [i, dir] of [[0, -1], [n - 1, 1]]) {
      const T0 = Tn[i].clone().multiplyScalar(dir), P = path[i], Nf = Nn[i], Bf = Bn[i], at = thinAt(i);
      const loopIds = section.filter((s, k) => !section.dupEnds || k % 2 === 0).map((s) => b.vert(
        P.x + Bf.x * s.x + Nf.x * s.y, P.y + Bf.y * s.x + Nf.y * s.y, P.z + Bf.z * s.x + Nf.z * s.y, T0.x, T0.y, T0.z, 0, 0, at));
      loopIds.push(loopIds[0]);
      fan(b, P, T0, loopIds, at);
    }
  }
  return ids;
}
// Section helpers: circle (smooth normals), rectangle (hard edges).
function circleSection(r, sides) {
  const s = [];
  for (let i = 0; i < sides; i++) { const a = 2 * Math.PI * i / sides, c = Math.cos(a), n = Math.sin(a); s.push({ x: r * c, y: r * n, nx: c, ny: n }); }
  s.thinExt = [r, r];
  return s;
}
// Sweep of a centred w x h rectangle with duplicated corners (hard edges), CCW: quads only between the
// pairs (0-1, 2-3, 4-5, 6-7).
function sweepRect(b, path, w, h, opts = {}) {
  const x = w / 2, y = h / 2, s = [[x, -y, 1, 0], [x, y, 1, 0], [x, y, 0, 1], [-x, y, 0, 1], [-x, y, -1, 0], [-x, -y, -1, 0], [-x, -y, 0, -1], [x, -y, 0, -1]]
    .map(([px, py, nx, ny]) => ({ x: px, y: py, nx, ny }));
  s.dupEnds = true;
  s.thinExt = [x, y];
  return sweep(b, path, s, { ...opts, closedSection: false });
}
function tube(b, p0, p1, r, sides, caps = true, up = null) {
  const axis = V3().subVectors(p1, p0).normalize();
  const hint = up || (Math.abs(axis.y) > 0.9 ? V3(1, 0, 0) : V3(0, 1, 0));
  return sweep(b, [p0, p1], circleSection(r, sides), { caps, up: hint });
}
// Oriented box from a centre and three (orthogonal) half-axis vectors.
function box(b, c, ax, ay, az) {
  const faces = [[ax, ay, az], [ax.clone().negate(), az, ay], [ay, az, ax], [ay.clone().negate(), ax, az], [az, ax, ay], [az.clone().negate(), ay, ax]];
  for (const [n, u, v] of faces) {
    const nn = n.clone().normalize();
    const corner = (su, sv) => { const p = c.clone().add(n).addScaledVector(u, su).addScaledVector(v, sv); return b.vert(p.x, p.y, p.z, nn.x, nn.y, nn.z, (su + 1) / 2, (sv + 1) / 2); };
    const a = corner(-1, -1), bb = corner(1, -1), cc = corner(-1, 1), d = corner(1, 1);
    b.quad(a, bb, cc, d);
  }
}
const aabb = (b, x0, y0, z0, x1, y1, z1) => box(b, V3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), V3((x1 - x0) / 2, 0, 0), V3(0, (y1 - y0) / 2, 0), V3(0, 0, (z1 - z0) / 2));
// Rectangular bar between two points; `side` fixes the width direction, `roll` spins it (radians).
function bar(b, p0, p1, w, h, side = null, roll = 0) {
  const axis = V3().subVectors(p1, p0), len = axis.length(); axis.normalize();
  let sx = side ? side.clone() : (Math.abs(axis.y) > 0.9 ? V3(1, 0, 0) : V3(0, 1, 0).cross(axis));
  sx.sub(axis.clone().multiplyScalar(sx.dot(axis))).normalize();
  const sy = V3().crossVectors(axis, sx).normalize();
  if (roll) { const q = new THREE.Quaternion().setFromAxisAngle(axis, roll); sx.applyQuaternion(q); sy.applyQuaternion(q); }
  const mid = V3().addVectors(p0, p1).multiplyScalar(0.5), prev = b.attr.thin;
  if (b.thin) b.attr.thin = { line: { c: mid, dir: axis.clone() }, chord: sx.clone().multiplyScalar(w / 2), b: h / 2 };
  box(b, mid, axis.multiplyScalar(len / 2), sx.multiplyScalar(w / 2), sy.multiplyScalar(h / 2));
  b.attr.thin = prev;
}
// Import a three.js geometry (e.g. Extrude/Shape) through a matrix; attrFn(pos, normal) -> attr overrides.
function importGeometry(b, geo, matrix) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const P = g.attributes.position, N = g.attributes.normal, UV = g.attributes.uv;
  const nm = new THREE.Matrix3().setFromMatrix4(matrix);
  const p = V3(), n = V3();
  const ids = [];
  for (let i = 0; i < P.count; i++) {
    p.fromBufferAttribute(P, i).applyMatrix4(matrix);
    n.fromBufferAttribute(N, i).applyMatrix3(nm).normalize();
    ids.push(b.vert(p.x, p.y, p.z, n.x, n.y, n.z, UV ? UV.getX(i) : 0, UV ? UV.getY(i) : 0));
  }
  for (let i = 0; i < ids.length; i += 3) b.tri(ids[i], ids[i + 1], ids[i + 2]);
  geo.dispose(); if (g !== geo) g.dispose();
}
// See-through grating slab over the polygon pts (x, z; optional circular hole round the axis): a top face at y
// and a bottom face GRATING_T below it, each seen only from its own side. wear: bar layout for the shader.
function gratingSlab(b, pts, y, wear, holeR = 0, curveSegments = 12) {
  const shape = new THREE.Shape(pts.map((p) => new THREE.Vector2(p.x, -p.z))), rot = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
  if (holeR) shape.holes.push(new THREE.Path().absarc(0, 0, holeR, 0, 2 * Math.PI, true));
  b.set({ surf: SURF.grating, wear });
  importGeometry(b, new THREE.ShapeGeometry(shape, curveSegments), rot.clone().setPosition(0, y, 0));
  importGeometry(b, new THREE.ShapeGeometry(shape, curveSegments), new THREE.Matrix4().makeScale(1, -1, 1).multiply(rot).setPosition(0, y - GRATING_T, 0));
  return b;
}

// ------------------------------------------------------------------------------------------------
// Blade: parametric airfoil family + loft through the 18-station planform (§4.3)
// ------------------------------------------------------------------------------------------------
// Trailing-edge thickness (fraction of chord) and aft-loaded camber against thickness, modelled on the
// IEA 15 MW family: SNL-FFA-W3-500 flatback near the root, FFA-W3-360 ... 211 outboard. ESTIMATED shapes.
const TE_TABLE = [[0.211, 0.004], [0.24, 0.006], [0.30, 0.010], [0.36, 0.02], [0.40, 0.035], [0.50, 0.09], [0.70, 0.19], [1.0, 0.28]];
const CAMBER_TABLE = [[0.211, 0.032], [0.24, 0.034], [0.30, 0.036], [0.36, 0.034], [0.50, 0.020], [0.70, 0.008], [1.0, 0.0]];
const naca = (x) => 5 * (0.2969 * Math.sqrt(x) - 0.1260 * x - 0.3516 * x * x + 0.2843 * x * x * x - 0.1036 * x * x * x * x); // closed TE, max 0.1 at x = 0.3
const CAMBER_NORM = Math.pow(2.4 / 3.4, 2.4) * (1 - 2.4 / 3.4);   // peak of x^2.4 (1 - x) at x = 0.706

// Section contour in chord units (x from the leading edge, y toward the suction side).
// Returns main: 2M-1 points from the upper TE corner round the LE to the lower TE corner, with the
// chord station of each (for leading-edge wear), and base: K points across the flat trailing edge.
// tc -> 1 blends into the circular root; tc 0.5-0.7 gives a thick flatback; tc 0.211 an FFA-W3-211.
function airfoilSection(tc, M, K) {
  // Root transition: a 62 %-thick flatback blended linearly into the circle, so that the blended
  // thickness equals the table's t/c and the shape changes monotonically along the span.
  const TC_FB = 0.62;
  const tcA = Math.min(tc, TC_FB);
  const wC = tc > TC_FB ? clamp((tc - TC_FB) / (1 - TC_FB), 0, 1) : 0;
  const te = interp1(TE_TABLE, tcA), m = interp1(CAMBER_TABLE, tcA);
  let sc = 1;
  for (let it = 0; it < 5; it++) {                           // scale so that max thickness == tcA
    let mx = 0;
    for (let i = 0; i <= 200; i++) { const x = i / 200; mx = Math.max(mx, sc * tcA / 0.2 * naca(x) + te / 2 * x * x * x); }
    sc *= (tcA / 2) / mx;
  }
  const yt = (x) => sc * tcA / 0.2 * naca(x) + te / 2 * x * x * x;
  const zc = (x) => m * Math.pow(x, 2.4) * (1 - x) / CAMBER_NORM;
  const dzc = (x) => m * Math.pow(x, 1.4) * (2.4 - 3.4 * x) / CAMBER_NORM;
  const surf = (x, side) => {
    const t = yt(x), th = Math.atan(dzc(x)), cx = x, cy = zc(x);
    const ax = cx - side * t * Math.sin(th), ay = cy + side * t * Math.cos(th);
    const circ = Math.sqrt(Math.max(0, x * (1 - x)));      // circle of diameter 1 through (0,0) and (1,0)
    return [lerp(ax, x, wC), lerp(ay, side * circ, wC)];
  };
  const xs = [];
  for (let k = 0; k < M; k++) xs.push(0.5 * (1 - Math.cos(Math.PI * k / (M - 1))));
  const main = [], chord = [];
  for (let k = M - 1; k >= 0; k--) { main.push(surf(xs[k], 1)); chord.push(xs[k]); }
  for (let k = 1; k < M; k++) { main.push(surf(xs[k], -1)); chord.push(xs[k]); }
  const lo = main[main.length - 1], up = main[0], base = [];
  for (let i = 0; i < K; i++) { const t = i / (K - 1); base.push([lerp(lo[0], up[0], t), lerp(lo[1], up[1], t)]); }
  return { main, chord, base };
}

const bladeTable = T.blade;                                  // [s, r, chord, twist, t/c, thickness, prebend, pax]
const col = (i) => bladeTable.map(r => r[i]);
const S_COL = col(0);
const F_CHORD = pchip(S_COL, col(2)), F_TWIST = pchip(S_COL, col(3)), F_TC = pchip(S_COL, col(4));
const F_PREBEND = pchip(S_COL, col(6)), F_PAX = pchip(S_COL, col(7));

// Planform at span fraction s (s < 0 is the root flange extension inside the hub).
function bladeStation(s) {
  const sc = Math.max(0, s);
  const st = { s, r: BLADE_ROOT_R + s * BLADE_LEN, c: F_CHORD(Math.min(sc, S_CAP)), tw: F_TWIST(sc) * DEG, tc: F_TC(sc), pb: F_PREBEND(sc) };
  st.a = F_PAX(Math.min(sc, S_CAP)) * st.c;                 // leading edge ahead of the pitch axis
  if (s > S_CAP) {                                           // rounded tip cap, swept back
    // The leading edge follows a quarter-ellipse back to a tip point near the trailing edge; the
    // trailing edge stays almost straight, so the planform reads as a swept tip, not a round end.
    const c0 = st.c, le0 = st.a, te0 = st.a - c0, tip = le0 - 0.84 * c0;
    const u = Math.min(1, (s - S_CAP) / (1 - S_CAP));
    const eLE = 1 - Math.sqrt(Math.max(0, 1 - u * u)), eTE = Math.pow(u, 6);
    const le = le0 + (tip - le0) * eLE, tee = te0 + (tip - te0) * eTE;
    st.c = Math.max(0, le - tee); st.a = le;
  }
  return st;
}
// Section point in the blade frame (span +Y, rotation direction +X, upwind +Z), before cone/pitch.
function sectionPoint(st, xa, ya, out = V3()) {
  const along = st.a - xa * st.c, perp = ya * st.c, ct = Math.cos(st.tw), sn = Math.sin(st.tw);
  return out.set(along * ct + perp * sn, st.r, along * sn - perp * ct - st.pb);
}
function bandAt(s) {                                         // 0 base, 1 red (RAL 3020), 0.5 grey band
  if (s >= BAND_EDGES_S[2]) return 1;
  if (s >= BAND_EDGES_S[1]) return 0.5;
  if (s >= BAND_EDGES_S[0]) return 1;
  return 0;
}

// Span stations: dense at the root transition and the tip, duplicated at the three band edges.
function bladeStations(spec) {
  const N = spec.ribs, grid = 2000, cdf = [0];
  const dens = (s) => 0.6 + 2.4 * Math.exp(-(((s - 0.08) / 0.09) ** 2)) + 1.0 * Math.exp(-(((s - S_CAP) / 0.04) ** 2));
  for (let i = 1; i <= grid; i++) cdf.push(cdf[i - 1] + dens(S_CAP * (i - 0.5) / grid));
  const tot = cdf[grid], out = [];
  for (let k = 0; k <= N; k++) {
    const target = tot * k / N; let i = 0; while (i < grid && cdf[i + 1] < target) i++;
    out.push(S_CAP * (i + (target - cdf[i]) / Math.max(1e-9, cdf[i + 1] - cdf[i])) / grid);
  }
  let list = out.map(s => ({ s, band: bandAt(s) }));
  for (const e of BAND_EDGES_S) {                            // drop ribs too close to an edge, then insert twins
    const spacing = S_CAP / N;
    list = list.filter(r => Math.abs(r.s - e) > 0.35 * spacing);
    list.push({ s: e, band: bandAt(e - 1e-6) }, { s: e + 1e-9, band: bandAt(e + 1e-6) });
  }
  list.sort((a, b) => a.s - b.s);
  const ext = { s: -(BLADE_ROOT_R - 2.3) / BLADE_LEN, band: 0 };   // root flange extension to r = 2.3 m
  const cap = spec.cap.slice(1).map(u => ({ s: S_CAP + u * (1 - S_CAP), band: 1 }));
  return [ext, ...list, ...cap];
}

// Builds the three blades into `b` (rotor frame). Records blade 0's rings for measurement.
function buildBlades(b, spec, pitchDeg, meta) {
  const stations = bladeStations(spec);
  const M = spec.side, K = spec.base;
  const mainRings = [], baseRings = [], wearMain = [], thinSt = [];
  const tmp = V3();
  for (const stn of stations) {
    const st = bladeStation(stn.s);
    // Thin-feature data (distant LODs): the pitch axis point, the chord half-vector along the twisted
    // chord line and the half-thickness, in the blade frame (sectionPoint's conventions).
    thinSt.push({ axis: V3(0, st.r, -st.pb), span: V3(0, 1, 0), chord: V3(Math.cos(st.tw), 0, Math.sin(st.tw)).multiplyScalar(Math.max(st.c, 0.02) / 2), b: Math.max(0.01, st.tc * st.c / 2) });
    const sec = airfoilSection(st.tc, M, K);
    mainRings.push(sec.main.map(([x, y]) => sectionPoint(st, x, y, tmp).clone()));
    baseRings.push(sec.base.map(([x, y]) => sectionPoint(st, x, y, tmp).clone()));
    const spanW = smoothstep(0.66, 0.80, stn.s) * (0.65 + 0.35 * smoothstep(0.8, 1.0, stn.s));
    wearMain.push(sec.chord.map(x => spanW * (1 - smoothstep(0.015, 0.10, x))));
  }
  const tipSt = bladeStation(1);
  const tipPoint = sectionPoint(tipSt, 0, 0);
  const rootCentre = sectionPoint(bladeStation(stations[0].s), 0.5, 0);
  b.set({ surf: SURF.blade, wear: 0 });
  meta.rings = [];
  for (let i = 0; i < 3; i++) {
    const m = new THREE.Matrix4().makeRotationZ(-i * 120 * DEG)
      .multiply(new THREE.Matrix4().makeRotationX(CONE))
      .multiply(new THREE.Matrix4().makeRotationY(-pitchDeg * DEG));
    b.push(m);
    b.begin(`blade${i}`);
    const attrMain = (j, k) => ({ band: stations[j].band, wear: wearMain[j][k], u: k / (2 * M - 2), v: Math.max(0, stations[j].s), thin: thinSt[j] });
    const attrBase = (j) => ({ band: stations[j].band, wear: 0, v: Math.max(0, stations[j].s), thin: thinSt[j] });
    const mid = Math.floor(stations.length / 2);
    const leOut = V3(Math.cos(bladeStation(stations[mid].s).tw), 0, Math.sin(bladeStation(stations[mid].s).tw));
    const mainIds = loft(b, mainRings, { outwardAt: [mid, M - 1], outward: leOut, attrFn: attrMain });
    const teOut = leOut.clone().negate();
    const baseIds = loft(b, baseRings, { outwardAt: [mid, Math.floor(K / 2)], outward: teOut, attrFn: attrBase });
    if (i === 0) {
      meta.rings = mainIds.map((row, j) => ({ s: stations[j].s, ids: row.concat(baseIds[j]) }));
    }
    // root cap (inside the hub) and tip fan
    const loopAt = (j) => mainIds[j].concat(baseIds[j].slice(1, -1), [mainIds[j][0]]);
    fan(b, rootCentre, V3(0, -1, 0), loopAt(0), { ...b.attr, band: 0, wear: 0, thin: thinSt[0] });
    fan(b, tipPoint, V3(0, 1, 0), loopAt(mainRings.length - 1), { ...b.attr, band: 1, wear: 0, thin: thinSt[thinSt.length - 1] });
    b.end(`blade${i}`);
    b.pop();
  }
}

// ------------------------------------------------------------------------------------------------
// Spinner (rotor frame); its rubber seal rings round the blade roots are painted by the shader (code 3)
// ------------------------------------------------------------------------------------------------
function spinnerR(z) {
  if (z >= SP_NOSE) return 0;
  if (z >= SP_Z0) { const u = (z - SP_Z0) / (SP_NOSE - SP_Z0); return SP_RMAX * Math.pow(Math.max(0, 1 - Math.pow(u, SP_N)), 1 / SP_N); }
  return SP_RREAR + (SP_RMAX - SP_RREAR) * smoothstep(SP_REAR, SP_REAR + 1.2, z);
}
function buildSpinner(b, spec) {
  // Profile (r, z) from the nose tip to the rear rim, then the back plate to the axis.
  const prof = [];
  for (let i = 0; i <= spec.nose; i++) {                     // superellipse, angle-parametrised
    const phi = (Math.PI / 2) * (i / spec.nose);
    const zz = SP_Z0 + (SP_NOSE - SP_Z0) * Math.pow(Math.cos(phi), 2 / SP_N), rr = SP_RMAX * Math.pow(Math.sin(phi), 2 / SP_N);
    prof.push([rr, zz]);
  }
  for (let i = 1; i <= spec.rear; i++) { const z = lerp(SP_Z0, SP_REAR, i / spec.rear); prof.push([spinnerR(z), z]); }
  // Rotate the Y-lathe onto +Z: Rx(+90 deg) maps local +Y to +Z and puts azimuth 0 on +Y (blade 0).
  b.push(new THREE.Matrix4().makeRotationX(Math.PI / 2));
  b.set({ surf: SURF.spinner, band: 0, wear: 0 });
  b.begin('spinner');
  // Profile walks nose -> rear (y decreasing); reverse it so walls go "up" in lathe terms, outside on the right.
  const lathe = prof.slice().reverse();
  revolve(b, lathe, spec.seg, { smooth: true });
  revolve(b, [[0, SP_REAR], [SP_RREAR, SP_REAR]], spec.seg);  // back plate, faces -Z
  b.end('spinner');
  b.pop();
}
// ------------------------------------------------------------------------------------------------
// Nacelle (yaw frame)
// ------------------------------------------------------------------------------------------------
// Section of the cover at distance d (m) from an end wall. The four vertical edges are rounded with
// NAC_RV (the section narrows near each end), the roof-to-end edges with NAC_RT (the top drops), and
// the long top/bottom edges are the section's own corner arcs. GRP covers have no sharp corners.
const NAC_RV = 0.8;                                          // ESTIMATED vertical-edge radius (critic 2026-09-30)
function nacelleProfile(d, arcN) {
  const h = d >= 1 ? 1 : Math.sqrt(Math.max(0, 1 - (1 - d) * (1 - d)));
  const xw = d >= NAC_RV ? NAC_W : NAC_W - (NAC_RV - Math.sqrt(Math.max(0, NAC_RV * NAC_RV - (NAC_RV - d) * (NAC_RV - d))));
  const thMax = Math.asin(h), cornerN = Math.max(1, Math.round(arcN / 2)), P = [], add = (x, y) => P.push(new THREE.Vector2(x, y));
  const arc = (cx, cy, r, a0, a1, n) => { for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; add(cx + r * Math.cos(a), cy + r * Math.sin(a)); } };
  arc(xw - NAC_RB, NAC_Y0 + NAC_RB, NAC_RB, -Math.PI / 2, 0, cornerN);                  // bottom-right corner
  add(xw, 9.5);                                                                          // flat side
  arc(xw - NAC_RT, NAC_Y1 - NAC_RT, NAC_RT, 0, thMax, arcN);                             // roof edge
  const topY = NAC_Y1 - NAC_RT + h, xe = xw - NAC_RT + NAC_RT * Math.cos(thMax);
  for (const f of [0.55, 0, -0.55]) add(f * xe, topY);
  arc(-(xw - NAC_RT), NAC_Y1 - NAC_RT, NAC_RT, Math.PI - thMax, Math.PI, arcN);
  add(-xw, 9.5);
  arc(-(xw - NAC_RB), NAC_Y0 + NAC_RB, NAC_RB, Math.PI, 1.5 * Math.PI, cornerN);
  for (const f of [-0.5, 0, 0.5]) add(f * (xw - NAC_RB), NAC_Y0);
  return P;
}
function buildNacelleBody(b, spec) {
  // Sections rear -> front, then the end walls from the d = 0 outline. The photo-look stripe is painted
  // by the shader (GLSL_MODES.paint, code 2).
  const ds = spec.nacEnd, secs = [...ds.map((d) => [NAC_Z0 + d, d]), ...ds.slice().reverse().map((d) => [NAC_Z1 - d, d])];
  b.set({ surf: SURF.nacelle, band: 0, wear: 0 }).begin('nacelleBody');
  loft(b, secs.map(([z, d]) => nacelleProfile(d, spec.nacArc).map((q) => V3(q.x, q.y, z))),
    { closedK: true, outward: V3(1, 0, 0), outwardAt: [secs.length >> 1, Math.max(1, Math.round(spec.nacArc / 2)) + 1] });
  const shape = new THREE.Shape(nacelleProfile(0, spec.nacArc).filter((q, i, a) => q.distanceTo(a[(i + 1) % a.length]) > 1e-5));
  importGeometry(b, new THREE.ShapeGeometry(shape), new THREE.Matrix4().makeRotationY(Math.PI).setPosition(0, 0, NAC_Z0));
  importGeometry(b, new THREE.ShapeGeometry(shape), new THREE.Matrix4().makeTranslation(0, 0, NAC_Z1));
  b.end('nacelleBody');
}
function buildNacelle(spec, B) {
  const { paint, dark, galvanised: galv, thin, grating } = B, full = spec.near, sides = spec.railSides >= 6;
  buildNacelleBody(paint, spec);
  // Yaw adapter between the tower top and the nacelle floor.
  revolve(dark.surf(S_DARK), [[0, 0.02], [3.62, 0.02], [3.62, NAC_Y0 + 0.02], [0, NAC_Y0 + 0.02]], spec.round >= 64 ? 96 : Math.max(8, spec.round));
  // Main-shaft cover between the nacelle front wall and the spinner rim (tilted with the shaft): RAL 7035,
  // not a black hole in side views, then a rubber seal ring just behind the spinner rim.
  const axis = V3(0, Math.sin(TILT), Math.cos(TILT)), at = (z) => HUB_OFFSET.clone().addScaledVector(axis, z), shaftSides = Math.max(8, spec.round / 2);
  tube(paint.surf(S_PAINT), at(-3.35), at(SP_REAR - 0.12), 2.3, shaftSides, true, V3(0, 1, 0));
  tube(dark.surf(S_DARK), at(SP_REAR - 0.12), at(SP_REAR - 0.02), SP_RREAR - 0.06, shaftSides, true, V3(0, 1, 0));
  // Cooler top on the rear third of the roof: frame posts and rails, radiator panels and cores, grille.
  const c = COOLER, y0 = NAC_Y1, y1 = NAC_Y1 + c.h, zm = (c.z0 + c.z1) / 2;
  paint.surf(S_PAINT);
  if (full) {
    for (const z of [c.z0, c.z1, zm]) for (const x of [-c.x, c.x]) aabb(paint, x - 0.14, y0, z - 0.14, x + 0.14, y1, z + 0.14);
    for (const yy of [y0 + 0.05, y1 - 0.12]) {
      for (const z of [c.z0, c.z1]) aabb(paint, -c.x - 0.14, yy - 0.07, z - 0.14, c.x + 0.14, yy + 0.07, z + 0.14);
      for (const x of [-c.x, c.x]) aabb(paint, x - 0.14, yy - 0.07, c.z0, x + 0.14, yy + 0.07, c.z1);
    }
    dark.surf(SURF.radiator);
    const ry0 = y0 + 0.12, ry1 = y1 - 0.19;
    for (const s of [-1, 1]) aabb(dark, Math.min(s * (c.x - 0.02), s * (c.x - 0.12)), ry0, c.z0 + 0.15, Math.max(s * (c.x - 0.02), s * (c.x - 0.12)), ry1, c.z1 - 0.15);
    for (const z of [c.z0 + 0.07, c.z1 - 0.07]) aabb(dark, -c.x + 0.15, ry0, z - 0.05, c.x - 0.15, ry1, z + 0.05);
    for (let i = 1; i < 4; i++) {                            // inner radiator cores seen through the grille
      const z = lerp(c.z0, c.z1, i / 4);
      aabb(dark, -c.x + 0.2, ry0, z - 0.05, c.x - 0.2, ry1 - 0.1, z + 0.05);
    }
    aabb(galv.set({ surf: SURF.grating, wear: 0 }), -c.x + 0.1, y1 - 0.12, c.z0 + 0.1, c.x - 0.1, y1 - 0.06, c.z1 - 0.1);
  } else aabb(paint, -c.x, y0, c.z0, c.x, y1, c.z1);
  // Heli-hoist deck: see-through grating (the sea 158 m below shows between the bars) overhanging the rear
  // wall, on a galvanised rim and three beams with knee braces; rails.
  const pts = [V3(-NAC_W, 0, HELI_Z0), V3(NAC_W, 0, HELI_Z0), V3(NAC_W, 0, HELI_Z1), V3(-NAC_W, 0, HELI_Z1)];
  gratingSlab(grating.begin('heliDeck'), pts, NAC_Y1, -1).end('heliDeck');
  sweepRect(thin.set({ surf: S_GALV, wear: 0 }), insetOutline(pts, 0.04).map((p) => V3(p.x, NAC_Y1 - 0.11, p.z)), 0.08, 0.2, { closed: true, caps: false });
  for (const x of [-NAC_W + 0.3, 0, NAC_W - 0.3]) {
    aabb(paint.surf(S_PAINT), x - 0.1, NAC_Y1 - HELI_FRAME_D, HELI_Z0, x + 0.1, NAC_Y1 - GRATING_T - 0.005, NAC_Z0 + 0.2);
    thin.surf(S_PAINT);
    bar(thin, V3(x, NAC_Y1 - 3.2, NAC_Z0 - 0.05), V3(x, NAC_Y1 - 0.4, HELI_Z0 + 0.4), 0.14, 0.14, V3(1, 0, 0));
  }
  railRun(thin, [V3(-NAC_W + 0.05, 0, HELI_Z1 - 0.4), V3(-NAC_W + 0.05, 0, HELI_Z0 + 0.05), V3(NAC_W - 0.05, 0, HELI_Z0 + 0.05), V3(NAC_W - 0.05, 0, HELI_Z1 - 0.4)], NAC_Y1, spec.railSides, false, 1.3, full);
  // Met mast on the cooler: a cross-arm with the anemometer and wind-vane posts.
  if (full) {
    const mx = -c.x + 0.5, mz = c.z0 + 0.3, m = (dx, y) => V3(mx + dx, y1 + y, mz);
    tube(thin.surf(S_GALV), m(0, 0), m(0, NAC.metMastHeight), 0.045, 10);
    bar(thin, m(-0.7, 1.8), m(0.7, 1.8), 0.05, 0.05);
    tube(thin, m(-0.65, 1.8), m(-0.65, 2.05), 0.035, 8);
    tube(thin, m(0.65, 1.8), m(0.65, 2.0), 0.02, 6);
  }
  // L-864 masts: a 2.55 m galvanised Ø0.1 m tube from the roof with a base plate and an outboard diagonal
  // brace, then the dark housing and the red lens dome centred on L864_Y.
  thin.begin('l864');
  for (const [x, y, z] of L864_POS) {
    tube(thin.surf(S_GALV), V3(x, NAC_Y1, z), V3(x, y - 0.25, z), 0.05, sides ? 10 : 4);
    tube(thin, V3(x + (Math.sign(x) || 1) * 0.75, NAC_Y1, z), V3(x, NAC_Y1 + 1.35, z), 0.028, sides ? 8 : 4);
    aabb(galv.surf(S_GALV), x - 0.16, NAC_Y1, z - 0.16, x + 0.16, NAC_Y1 + 0.02, z + 0.16);
    tube(thin.surf(S_DARK), V3(x, y - 0.25, z), V3(x, y - 0.13, z), 0.19, 16);
    lensDome(thin, x, y, z, L864_DOME, 16);
  }
  thin.end('l864');
  if (full) {
    dark.surf(SURF.louvre);                                  // side air intakes above the stripe zone
    for (const sx of [-1, 1]) for (const [z0, z1] of [[-8.6, -6.4], [-6.0, -3.8]]) aabb(dark, Math.min(sx * NAC_W, sx * (NAC_W + 0.03)), 7.9, z0, Math.max(sx * NAC_W, sx * (NAC_W + 0.03)), 9.5, z1);
    paint.surf(S_PAINT);
    aabb(paint, 0.8, NAC_Y1, 3.4, 2.1, NAC_Y1 + 0.07, 4.7);          // roof hatch
    aabb(paint, 0.75, NAC_Y1 + 0.05, 4.62, 2.15, NAC_Y1 + 0.1, 4.75); // hinge line
    aabb(paint, -2.6, NAC_Y0 - 0.03, -8.4, 2.6, NAC_Y0, -3.2);        // service crane floor hatch
  }
}
// Red lamp lens dome centred on (x, yc, z): a revolved cap drawn as a thin feature (never under 1.5 px).
const L864_DOME = [[0.15, -0.13], [0.15, 0.02], [0.1, 0.12], [0, 0.15]], L810_DOME = [[0.075, -0.04], [0.075, 0.05], [0.04, 0.1], [0, 0.11]];
function lensDome(b, x, yc, z, prof, segs, surf = SURF.lensRed) {
  const r = prof[0][0];
  b.set({ surf, thin: { line: { c: V3(0, yc, 0), dir: V3(0, 1, 0) }, chord: V3(r, 0, 0), b: r } }).push(new THREE.Matrix4().makeTranslation(x, 0, z));
  revolve(b, prof.map(([pr, y]) => [pr, yc + y]), segs, { smooth: true });
  b.pop().set({ thin: null });
}

// ------------------------------------------------------------------------------------------------
// Railings: posts, top rail, knee rail and toe plate along a path at a given deck level.
// ------------------------------------------------------------------------------------------------
function railRun(b, path2, deckY, sides, closed, postPitch = T.platform.postPitch, toe = true) {
  const at = (y) => path2.map((p) => V3(p.x, y, p.z)), topY = deckY + T.platform.railHeight - RAIL_R, round = sides >= 6;
  b.surf(S_YELLOW);
  for (const [y, r] of [[topY, RAIL_R], [deckY + KNEE_ABOVE_DECK, KNEE_R]]) {
    if (round) sweep(b, at(y), circleSection(r, sides), { closed, up: V3(0, 1, 0) }); else sweepRect(b, at(y), 2 * r, 2 * r, { closed });
  }
  if (toe) sweepRect(b, at(deckY + TOE_H / 2), 0.008, TOE_H, { closed });
  // posts by arc length
  const seg = [], n = path2.length, m = closed ? n : n - 1;
  for (let i = 0; i < m; i++) seg.push(path2[i].distanceTo(path2[(i + 1) % n]));
  const total = seg.reduce((a, l) => a + l, 0), count = Math.max(closed ? 3 : 2, Math.round(total / postPitch)), step = total / count;
  for (let k = 0; k < count + (closed ? 0 : 1); k++) {
    let d = k * step, i = 0;
    while (i < m - 1 && d > seg[i]) d -= seg[i++];
    const A = path2[i], Bp = path2[(i + 1) % n], t = seg[i] > 0 ? Math.min(1, d / seg[i]) : 0, x = lerp(A.x, Bp.x, t), z = lerp(A.z, Bp.z, t);
    if (round) tube(b, V3(x, deckY, z), V3(x, topY, z), POST_R, sides); else bar(b, V3(x, deckY, z), V3(x, topY, z), 2 * POST_R, 2 * POST_R);
  }
  return b;
}

// ------------------------------------------------------------------------------------------------
// Tower (static frame)
// ------------------------------------------------------------------------------------------------
// Four welded conical cans between the base, the three section flanges and the top: straight
// silhouettes with small kinks only at the flanges (a spline through SCENE-SPEC §4.5's table gave an
// S-shaped waist). The can ends take the §4.5 table's diameter at those heights (max deviation from
// the table 0.17 m at y 96-109; base 10.0 and top 7.5 exact).
const TOWER_KNOTS = [ST.tpTop, ...T.towerFlangesY, ST.towerTop].map(y => [y, interp1(T.tower, y)]);
const F_TOWER_D = (y) => interp1(TOWER_KNOTS, y);
function buildTower(b, spec) {
  const y0 = TOWER_FLANGE_TOP, y1 = YAW_Y;
  const prof = [[0, y0]];
  // Profile rings: the knots exactly (so each kink sits on a ring) plus even subdivisions per can.
  const ys = [y0], perCan = Math.max(1, Math.round(spec.towerRings / (TOWER_KNOTS.length - 1)));
  for (let k = 0; k < TOWER_KNOTS.length - 1; k++) {
    const a = Math.max(y0, TOWER_KNOTS[k][0]), c = TOWER_KNOTS[k + 1][0];
    for (let i = 1; i <= perCan; i++) ys.push(lerp(a, c, i / perCan));
  }
  for (const y of ys) prof.push([F_TOWER_D(y) / 2, y]);
  prof.push([0, y1]);
  b.set({ surf: SURF.tower, band: 0, wear: 0 });
  b.begin('tower');
  // Wall smooth, caps hard: revolve the three pieces separately.
  revolve(b, [[0, y0], [prof[1][0], y0]], spec.round);
  revolve(b, prof.slice(1, -1), spec.round, { smooth: true });
  revolve(b, [[prof[prof.length - 2][0], y1], [0, y1]], spec.round);
  b.end('tower');
}

// ------------------------------------------------------------------------------------------------
// Transition piece, platform, boat landing, davit, lanterns, ID markings (static frame)
// ------------------------------------------------------------------------------------------------
function deckOutline(step) {
  const R = DECK_R, w = LOBE_HALF_W, L = LOBE_REACH, rc = LOBE_CORNER_R;
  const uj = Math.sqrt(R * R - w * w), aj = Math.atan2(w, uj);
  const uv = [];
  const nArc = Math.max(12, Math.ceil(R * (2 * Math.PI - 2 * aj) / step));
  for (let i = 0; i < nArc; i++) { const a = aj + (2 * Math.PI - 2 * aj) * i / nArc; uv.push([R * Math.cos(a), R * Math.sin(a)]); }
  const line = (u0, v0, u1, v1) => { const n = Math.max(1, Math.ceil(Math.hypot(u1 - u0, v1 - v0) / step)); for (let i = 0; i < n; i++) uv.push([lerp(u0, u1, i / n), lerp(v0, v1, i / n)]); };
  const arc = (cu, cv, a0, a1) => { const n = Math.max(2, Math.ceil(rc * Math.abs(a1 - a0) / step)); for (let i = 0; i < n; i++) { const a = lerp(a0, a1, i / n); uv.push([cu + rc * Math.cos(a), cv + rc * Math.sin(a)]); } };
  line(uj, -w, L - rc, -w);
  arc(L - rc, -w + rc, -Math.PI / 2, 0);
  line(L, -w + rc, L, w - rc);
  arc(L - rc, w - rc, 0, Math.PI / 2);
  line(L - rc, w, uj, w);
  return uv.map(([u, v]) => LF.at(u, v, 0));
}
// Offset a closed CCW (x -> z) outline inward by d.
function insetOutline(pts, d) {
  const n = pts.length;
  return pts.map((p, i) => {
    const a = pts[(i - 1 + n) % n], c = pts[(i + 1) % n];
    const tx = c.x - a.x, tz = c.z - a.z, l = Math.hypot(tx, tz) || 1;
    return V3(p.x + (-tz / l) * d, p.y, p.z + (tx / l) * d);
  });
}
// Platform (SCENE-SPEC §4.6 outline: ring Ø 15.75 m + landing lobe to 20.4 m span). The spec's closed
// 1.5 m conical skirt (ESTIMATED, unsourced) read from a boat as a navy 'flying saucer' mirroring the sea;
// the common TP external platform is an open frame, so that is what is built: yellow radial brackets
// welded to the TP with knee braces down to +17.0 (the spec's skirt bottom), yellow secondary beams, a
// yellow rim channel (round 4: galvanised, it read as a glowing sky-lit rim from below) and 30 mm grating
// that shows the sky (or the sea) through it.
function buildPlatform(spec, B, outline) {
  const { grating, thin } = B, yTop = ST.deck, yBot = ST.deck - GRATING_T, full = spec.near, sides = full ? 10 : 4;
  // Grating deck round the TP (its top face is the measured deck), galvanised rim channel round the outline.
  gratingSlab(grating.begin('deck'), outline, yTop, 1, TP_R + 0.02, Math.max(12, spec.round / 2)).end('deck');
  sweepRect(thin.set({ surf: S_YELLOW, wear: 0 }), insetOutline(outline, RIM_W / 2).map((p) => V3(p.x, yTop - 0.01 - RIM_H / 2, p.z)), RIM_W, RIM_H, { closed: true, caps: false });
  const ring = (r, y, a0, a1, n) => Array.from({ length: n + 1 }, (_, i) => azPoint(lerp(a0, a1, i / n), r, y)), nRing = Math.max(16, Math.round(spec.round / 2));
  // Frame steel is part of the TP's coating system (yellow): a ledger ring on the TP wall, radial brackets
  // every 22.5 deg (on the grating panel joints) outside the lobe span, each with a knee brace to the TP
  // wall, and a circumferential secondary beam at mid-width.
  sweepRect(thin.surf(S_YELLOW), ring(TP_R + SEC_W / 2 + 0.01, yBot - SEC_H / 2, 0, 360, nRing).slice(0, -1), SEC_W, SEC_H, { closed: true, caps: false });
  const yBeam = yBot - BEAM_H / 2, lobeHalfDeg = Math.atan2(LOBE_HALF_W, Math.sqrt(DECK_R * DECK_R - LOBE_HALF_W * LOBE_HALF_W)) / DEG;   // 25.6
  for (let k = 0; k < 16; k++) {
    const az = k * 22.5;
    if (Math.abs(((az - LANDING_AZ + 540) % 360) - 180) < lobeHalfDeg + 1.5) continue;
    bar(thin, azPoint(az, TP_R + 0.01, yBeam), azPoint(az, DECK_R - RIM_W, yBeam), BEAM_W, BEAM_H);
    if (full || k % 2 === 0) tube(thin, azPoint(az, TP_R + 0.02, ST.skirtBottom), azPoint(az, RING_BRACE_OUT_R, yBot - BEAM_H), BRACE_R, sides);
  }
  const rMid = (TP_R + DECK_R) / 2, aMid = Math.asin(LOBE_HALF_W / rMid) / DEG;
  sweepRect(thin, ring(rMid, yBot - SEC_H / 2, LANDING_AZ + aMid, LANDING_AZ + 360 - aMid, nRing), SEC_W, SEC_H);
  // Lobe: longitudinal brackets with long knee braces, transverse beams.
  for (const v of LOBE_LONG_V) {
    const uw = Math.sqrt(TP_R * TP_R - v * v);
    bar(thin, LF.at(uw, v, yBeam), LF.at(LOBE_REACH - RIM_W, v, yBeam), BEAM_W, BEAM_H, V3(0, 1, 0).cross(LF.u));
    if (Math.abs(v) > 2) tube(thin, LF.at(uw + 0.03, v, LOBE_BRACE_FOOT_Y), LF.at(LOBE_BRACE_TOP_U, v, yBot - BEAM_H), BRACE_R, sides);
  }
  for (let u = LOBE_BEAM_U0; u < LOBE_REACH - 0.3; u += LOBE_BEAM_PITCH) bar(thin, LF.at(u, -LOBE_HALF_W + RIM_W, yBot - SEC_H / 2), LF.at(u, LOBE_HALF_W - RIM_W, yBot - SEC_H / 2), SEC_W, SEC_H, LF.u);
}

function buildFoundation(spec, B, meta) {
  const { paint, yellow, galvanised: galv, growth, thin } = B, segs = spec.round, sides = spec.railSides >= 6;
  // Monopile and the submerged TP skirt; the marine-growth band (-1.1 .. +1.8); the painted TP shell and
  // its top flange; the tower's base flange.
  if (spec.near) revolve(growth.surf(SURF.pile), [[0, ST.seabed], [PILE_R, ST.seabed], [PILE_R, TP_BOTTOM_Y], [TP_R, TP_BOTTOM_Y], [TP_R, ST.growthBottom]], segs);
  revolve(growth.surf(SURF.growth).begin('growthBand'), spec.near ? [[TP_R, ST.growthBottom], [TP_R, ST.growthTop]] : [[0, ST.growthBottom], [TP_R, ST.growthBottom], [TP_R, ST.growthTop]], segs);
  growth.end('growthBand');
  revolve(yellow.surf(SURF.tpShell).begin('tpShell'), [[TP_R, ST.growthTop], [TP_R, 6], [TP_R, 12], [TP_R, FLANGE_Y]], segs);
  revolve(yellow.end('tpShell').begin('tpFlange'), [[TP_R, FLANGE_Y], [FLANGE_OUT_R, FLANGE_Y], [FLANGE_OUT_R, ST.tpTop], [4.9, ST.tpTop]], segs);
  yellow.end('tpFlange');
  revolve(paint.surf(S_PAINT), [[FLANGE_OUT_R - 0.01, ST.tpTop], [FLANGE_OUT_R - 0.01, TOWER_FLANGE_TOP], [4.9, TOWER_FLANGE_TOP]], segs);
  galv.surf(S_GALV);
  const br = (FLANGE_OUT_R + F_TOWER_D(ST.tpTop) / 2) / 2 + 0.02;
  for (let i = 0; spec.near && i < 120; i++) {                // tower flange bolts, every 3 deg
    const az = (i + 0.5) * 3, p = azPoint(az, br, TOWER_FLANGE_TOP);
    galv.push(new THREE.Matrix4().makeTranslation(p.x, p.y, p.z).multiply(new THREE.Matrix4().makeRotationY(-az * DEG)));
    revolve(galv, [[0.052, 0], [0.052, 0.06], [0, 0.06]], 6);
    revolve(galv, [[0.028, 0.06], [0.028, 0.105], [0, 0.11]], 6);
    galv.pop();
  }
  // Platform (open steel frame under a see-through walkway grating) and its guard-rails.
  const outline = deckOutline(spec.outlineStep);
  buildPlatform(spec, B, outline);
  railRun(thin.begin('rails'), insetOutline(outline, 0.04), ST.deck, spec.railSides, true).end('rails');
  buildLanding(spec, B, meta);
  buildDavit(spec, B);
  // Marine lanterns (+20.5, opposite sides) on posts inside the rail.
  const ym = ST.marineLanterns;
  meta.marine = LANTERN_AZIMUTHS.map((az) => azPoint(az, LANTERN_R, ym));
  for (const p of meta.marine) {
    const at = (y) => V3(p.x, y, p.z);
    tube(thin.surf(S_GALV), at(ST.deck), at(ym - 0.3), 0.045, sides ? 10 : 4);
    tube(thin.surf(S_DARK), at(ym - 0.3), at(ym - 0.15), 0.14, 14);
    tube(thin.surf(SURF.lensYellow), at(ym - 0.15), at(ym + 0.15), 0.1, 14, false);
    tube(thin.surf(S_DARK), at(ym + 0.15), at(ym + 0.22), 0.13, 14);
  }
  // Mid-mast L-810 housings (4 x 90 deg at +79.2).
  const yl = ST.midMastLights, rMid = F_TOWER_D(yl) / 2;
  meta.midMast = MIDMAST_AZIMUTHS.map((az) => azPoint(az, rMid + 0.36, yl));
  if (spec.near) {
    for (const az of MIDMAST_AZIMUTHS) {
      const tip = azPoint(az, rMid + 0.36, yl - 0.14);
      bar(thin.surf(S_DARK), azPoint(az, rMid - 0.05, yl - 0.14), tip, 0.12, 0.06, V3(0, 1, 0).cross(azimuthToDir(az)));
      tube(thin, tip, V3(tip.x, yl - 0.04, tip.z), 0.1, 12);
      lensDome(thin, tip.x, yl, tip.z, L810_DOME, 12);
    }
  }
}

function buildLanding(spec, B, meta) {
  const { galvanised: galv, thin, grating } = B, bl = T.boatLanding, tubeR = bl.tubeDiameter / 2, half = bl.tubeSpacing / 2;
  const full = spec.near, sides = full ? 24 : 8;
  meta.landingTubes = [-half, half].map((v) => { const p = LF.at(TUBE_U, v, 0); return { x: p.x, z: p.z, radius: tubeR }; });
  // Everything here is a thin feature (tubes, ladders, rails): one builder, the finish by height (marine
  // growth below +1.8, yellow above); runs crossing the growth line are split there.
  const zone = (y) => thin.surf(y < ST.growthTop ? SURF.growth : S_YELLOW);
  const split = (y0, y1, fn) => {
    const cuts = [y0, ...[ST.growthTop].filter((c) => c > y0 && c < y1), y1];
    for (let i = 0; i < cuts.length - 1; i++) { zone((cuts[i] + cuts[i + 1]) / 2); fn(cuts[i], cuts[i + 1]); }
  };
  for (const [name, v] of [['landingTubeL', -half], ['landingTubeR', half]]) {
    thin.begin(name);
    split(bl.tubeBottom, bl.tubeTop, (a, b) => tube(thin, LF.at(TUBE_U, v, a), LF.at(TUBE_U, v, b), tubeR, sides));
    thin.end(name);
  }
  // Horizontal stubs from the TP wall to each tube, and a top tie between the tubes.
  for (const y of full ? [bl.tubeTop - 0.5, 3.5, -1.6, -3.6] : [bl.tubeTop - 0.5, -1.6]) {
    for (const v of [-half, half]) tube(zone(y), LF.at(TP_R - 0.05, v * 0.85, y), LF.at(TUBE_U, v, y), 0.135, full ? 14 : 6);
  }
  tube(thin.surf(S_YELLOW), LF.at(TUBE_U, -half, bl.tubeTop - 0.25), LF.at(TUBE_U, half, bl.tubeTop - 0.25), 0.1, full ? 12 : 6);
  // Ladders: lower between the tubes (tubeBottom .. rest platform), upper offset (rest .. deck).
  const ladder = (v, y0, y1) => {
    const w = bl.ladderWidth / 2;
    for (const dv of [-w, w]) split(y0, y1, (a, b) => bar(thin, LF.at(LADDER_U, v + dv, a), LF.at(LADDER_U, v + dv, b), 0.075, 0.014, LF.u));
    if (full) {
      for (let y = y0 + 0.2; y < y1 - 0.1; y += bl.rungPitch) bar(zone(y), LF.at(LADDER_U, v - w, y), LF.at(LADDER_U, v + w, y), bl.rungSize, bl.rungSize, LF.u, Math.PI / 4);
      for (let y = y0 + 0.6; y < y1; y += 2.0) {             // stand-off brackets
        zone(y);
        for (const dv of [-w, w]) bar(thin, LF.at(TP_R - 0.03, v + dv, y), LF.at(LADDER_U, v + dv, y), 0.06, 0.012, V3(0, 1, 0));
      }
    } else bar(thin.surf(S_YELLOW), LF.at(LADDER_U, v, Math.max(y0, ST.growthTop)), LF.at(LADDER_U, v, y1), bl.ladderWidth, 0.02, LF.u);
  };
  ladder(0, bl.tubeBottom, bl.restPlatformY);
  ladder(UPPER_LADDER_V, bl.restPlatformY, ST.deck - GRATING_T);
  // Rest platform at +8.7: grating on a galvanised frame, bracketed off the TP, with the lower ladder's
  // opening at the TP wall.
  const ry = bl.restPlatformY;
  for (const [u0, u1, v0, v1] of [[TP_R - 0.02, 6.5, 0.35, 1.45], [5.95, 6.5, -0.55, 0.35]]) {
    const pts = [LF.at(u0, v0, 0), LF.at(u1, v0, 0), LF.at(u1, v1, 0), LF.at(u0, v1, 0)];
    gratingSlab(grating, pts, ry, -1);
    sweepRect(thin.surf(S_GALV), insetOutline(pts, -0.02).map((p) => V3(p.x, ry - 0.09, p.z)), 0.05, 0.16, { closed: true, caps: false });
  }
  if (full) {
    thin.surf(S_YELLOW);
    for (const v of [0.4, 1.4]) tube(thin, LF.at(TP_R + 0.02, v, ry - 1.3), LF.at(6.3, v, ry - 0.17), 0.05, 8);
    railRun(thin, [LF.at(TP_R + 0.05, -0.55, 0), LF.at(6.47, -0.55, 0), LF.at(6.47, 1.45, 0), LF.at(TP_R + 0.05, 1.45, 0)], ry, 8, false, 1.0, true);
  }
  // Hatch lid over the upper ladder and grab rails above the deck.
  box(galv.surf(S_GALV), LF.at(LADDER_U + 0.05, UPPER_LADDER_V, ST.deck + 0.012), LF.u.clone().multiplyScalar(0.42), V3(0, 0.012, 0), LF.v.clone().multiplyScalar(0.42));
  if (full) {
    thin.surf(S_YELLOW);
    for (const dv of [-0.3, 0.3]) {
      const p = (u, y) => LF.at(u, UPPER_LADDER_V + dv, y);
      sweep(thin, [p(LADDER_U - 0.2, ST.deck), p(LADDER_U - 0.2, ST.deck + 1.05), p(LADDER_U + 0.35, ST.deck + 1.05)], circleSection(0.02, 8), { up: LF.u });
    }
  }
}

// Davit crane (TURBINE.davit, SCENE-SPEC §4.6: slewing jib, 4.5 m, landing-side lobe, white/grey). Sized as the
// common 1-3 t TP davits (ESTIMATED): Ø0.5 m pedestal on a base plate, Ø0.36 m slewing column with its head and
// winch, a 0.26 x 0.32 m box jib luffed 18 deg and parked inboard across the lobe, the luffing cylinder, wire and a
// yellow hook block: its knuckle and jib stand ~2.5 m clear of the rails, so it reads from the boat and the sea.
function buildDavit(spec, B) {
  const { paint, yellow, thin } = B, base = LF.at(DAVIT_UV[0], DAVIT_UV[1], ST.deck), full = spec.near, sides = full ? 16 : 6;
  const at = (y) => V3(base.x, ST.deck + y, base.z), dir = azimuthToDir(LANDING_AZ - 90), side = V3(0, 1, 0).cross(dir);
  aabb(paint.surf(S_PAINT), base.x - 0.4, ST.deck, base.z - 0.4, base.x + 0.4, ST.deck + 0.06, base.z + 0.4);
  tube(thin.surf(S_PAINT), at(0), at(1.1), 0.25, sides);
  tube(thin, at(1.1), at(2.75), 0.18, sides);
  bar(thin, at(2.65).addScaledVector(dir, -0.25), at(2.65).addScaledVector(dir, 0.3), 0.5, 0.55, side);   // slewing head + winch
  const root = at(2.8), tip = root.clone().addScaledVector(dir, T.davit.jibLength * Math.cos(18 * DEG)); tip.y += T.davit.jibLength * Math.sin(18 * DEG);
  bar(thin, root, tip, 0.26, 0.32, side);
  if (full) {                                                // luffing cylinder, hoist wire and hook block
    const c0 = at(1.25).addScaledVector(dir, 0.2), c1 = root.clone().addScaledVector(dir, 1.9); c1.y += 0.45;
    const cm = c1.clone().lerp(c0, 0.45);
    tube(thin, c0, cm, 0.09, 12);
    tube(thin.surf(S_DARK), cm, c1, 0.05, 10);
    tube(thin, tip.clone().add(V3(0, -0.18, 0)), tip.clone().add(V3(0, -1.6, 0)), 0.012, 6, false);
    aabb(yellow.surf(S_YELLOW), tip.x - 0.12, tip.y - 1.9, tip.z - 0.08, tip.x + 0.12, tip.y - 1.6, tip.z + 0.08);
  }
}

// ------------------------------------------------------------------------------------------------
// Painted IDs: RAL 9005 characters drawn from a signed-distance glyph atlas (glyphs.js). One curved
// decal patch per copy; per instance the three glyph codes come from a 200 x 1 code texture indexed
// by aTurbineIndex, and the fragment lays the text out and reconstructs sharp, anti-aliased edges.
// ------------------------------------------------------------------------------------------------
export const TURBINE_IDS = layoutPositions().map(p => p.id);   // index -> ID; index 0 = 'F01' (hero)
const GLYPH_OPTS = { S: 96, margin: 0.2, spread: 0.12, cols: 5 };
const GLYPH_LAYOUT = glyphAtlasLayout(GLYPH_OPTS);
const ID_CAP = T.idCharHeight;                                // 3.0 m cap height (SCENE-SPEC §4.2)
const ID_PAD = 0.06 * ID_CAP;                                // decal margin round the text (AA room)
const ID_MAX_W = Math.max(...TURBINE_IDS.map(textWidth));     // widest ID in cap units
const ID_PATCH_W = ID_MAX_W * ID_CAP + 2 * ID_PAD, ID_PATCH_H = ID_CAP + 2 * ID_PAD;
let GLYPHS = null;
// The ID uniforms: the glyph SDF atlas (R8, mipmapped), per-turbine glyph codes (a 200 x 1 RGBA8 texture
// indexed by aTurbineIndex), glyph advances and mean ink coverage.
function glyphTextures() {
  if (GLYPHS) return GLYPHS;
  const A = buildGlyphAtlas(GLYPH_OPTS), codes = new Uint8Array(TURBINE_IDS.length * 4);
  TURBINE_IDS.forEach((id, i) => { for (let k = 0; k < 3; k++) codes[4 * i + k] = GLYPH_ORDER.indexOf(id[k]); codes[4 * i + 3] = id.length; });
  const tex = (data, w, h, format, o) => Object.assign(new THREE.DataTexture(data, w, h, format, THREE.UnsignedByteType), { unpackAlignment: 1, needsUpdate: true }, o);
  return (GLYPHS = {
    uIdGlyphs: { value: tex(A.data, A.width, A.height, THREE.RedFormat, { name: 'turbine.idGlyphSDF', minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: true, anisotropy: 4 }) },
    uIdCodes: { value: tex(codes, TURBINE_IDS.length, 1, THREE.RGBAFormat, { name: 'turbine.idCodes' }) },
    uGlyphAdv: { value: Array.from(A.advance) }, uGlyphCov: { value: Array.from(A.coverage) },
  });
}
function buildIdMarkings(b, spec, meta) {
  const y0 = ST.idBottom - ID_PAD, R = TP_R + spec.idOffset, W = ID_PATCH_W, H = ID_PATCH_H;
  // 24 facets over the <= 62 deg patch: the chord sagitta (1.5 mm) stays below the decal offset at every
  // LOD, so the flat facets never dip inside the transition-piece polygon.
  const half = W / 2 / R, nU = 24;
  b.set({ surf: 0, band: 0, wear: 0 });
  for (const az of ID_AZIMUTHS) {
    const ids = [];
    for (let i = 0; i <= nU; i++) {
      const t = i / nU, a = az * DEG + half - 2 * half * t;   // u = 0 on the left as seen from outside
      const s = Math.sin(a), c = -Math.cos(a);
      ids.push([b.vert(R * s, y0, R * c, s, 0, c, t, 0), b.vert(R * s, y0 + H, R * c, s, 0, c, t, 1)]);
    }
    for (let i = 0; i < nU; i++) b.quad(ids[i][0], ids[i + 1][0], ids[i][1], ids[i + 1][1]);
  }
  b.extra = { name: 'aTurbineIndex', value: 0 };             // per-vertex 0 -> "F01" unless Farm instances it
  meta.sign = { azimuthsDeg: ID_AZIMUTHS.slice(), yBottom: ST.idBottom, yTop: ST.idBottom + ID_CAP, radius: TP_R, patchWidth: W, patchHeight: H, capHeight: ID_CAP };
}

// ------------------------------------------------------------------------------------------------
// Materials: MeshPhysicalMaterial + atmosphere + procedural weathering (onBeforeCompile)
// ------------------------------------------------------------------------------------------------
const PHOTO_LOOK = { value: MARKINGS.photoLookDefault ? 1 : 0 };
export function setPhotoLook(on) { PHOTO_LOOK.value = on ? 1 : 0; }
export const photoLookUniform = PHOTO_LOOK;

const RGB = (a) => `vec3(${a.map((v) => F(v)).join(', ')})`;
function F(v) { const s = String(+v.toFixed(5)); return /[.e]/.test(s) ? s : `${s}.0`; }   // GLSL float literal
/** GLSL: repaint `c` with the photo-look markings of `band` (aBand: 0 base, 0.5 grey RAL 7035, 1 red RAL 3020) under uPhotoLook. */
export const photoLookGLSL = (c, band) => `${c} = mix(${c}, mix(${RGB(PAINT.ral7035.lin)}, ${RGB(PAINT.ral3020.lin)}, step(0.75, ${band})), uPhotoLook * step(0.25, ${band}));`;

// Surface finishes that deviate from config PAINT (ESTIMATED, 2026-09-30 critique):
// - TP yellow in service: RAL 1023 (PAINT.ral1023, the fresh paint's table reflectance) under a salt and grime
//   film with a chalked, matte topcoat. The film's reflectance factor is ESTIMATED from the reference photo:
//   its lit TP reads ~0.68x its lit RAL 7035 tower in linear light, so <= 0.7x fresh RAL 1023; under ACES at
//   the default 16:30 sun, 0.5x puts the drone frame's lit TP at 760 px (352, 338) on (233, 211, 135), the
//   photo's luminance (224, 213, 143); fresh paint gave (247, 232, 164). The low sheen keeps the hue (a white
//   specular lift read as lemon-cream); the residual R+9/B-8 is RAL 1023 being redder than the photo's yellow.
// - Galvanised steel: config holds fresh hot-dip zinc (metal 1, rough 0.55, reflectance 0.53); offshore zinc
//   weathers to a dull mid-grey patina (~0.32; walkway grating 0.21 under its grime), so it neither mirrors the navy
//   sea nor reads white in the sun (jury, round 3).
const TP_FINISH = { film: 0.5, roughness: 0.85, specularIntensity: 0.3 };
const YELLOW_LIN = PAINT.ral1023.lin.map((v) => v * TP_FINISH.film);
const ID_FINISH = { roughness: 0.85, specularIntensity: 0.4 };
const GALV = { lin: [0.32, 0.33, 0.33], roughness: 0.75, metalness: 0.35 };
const DARK_LIN = [0.045, 0.047, 0.05], PILE_LIN = [0.045, 0.018, 0.010];
// Weathering tones (linear, ESTIMATED from photographs of North Sea / US East Coast TPs; rust is config
// PAINT.rust): dried salt, gull guano, splash-zone algae film, black fender rubber, splash-zone grime, sun-chalked
// yellow.
const TONE = {
  salt: [0.66, 0.63, 0.52], guano: [0.62, 0.62, 0.57], algae: [0.10, 0.13, 0.03],
  rubber: [0.016, 0.016, 0.018], grime: [0.09, 0.075, 0.04], chalk: [0.80, 0.64, 0.34], zincBloom: [0.62, 0.63, 0.60],
};
// Walkway grating (EN ISO 14122-2 press-locked, ESTIMATED typical offshore): bearing bars 3 x 30 mm at
// 34 mm, cross rods 6 mm at 100 mm.
const GRATING = { pitch: 0.034, barT: 0.003, barD: 0.030, rod: 0.006, rodPitch: 0.10 };
// Thin features (rails, tubes, distant blades) never draw narrower than this many pixels; their coverage
// becomes alpha, so they stay continuous lines instead of MSAA dots (1.5 px: every pixel row of the band
// holds a sample of the 2x MSAA pattern).
const THIN_VIEWPORT = { value: 900 }, THIN_MIN_PX = { value: 1.5 };
const _thinSize = new THREE.Vector2();
function thinBeforeRender(renderer) {
  const rt = renderer.getRenderTarget();
  THIN_VIEWPORT.value = rt ? rt.height : renderer.getDrawingBufferSize(_thinSize).y;
}

// Weathering noise: a 32^3 RGBA8 texture of four independent value-noise lattices. One trilinear fetch at a
// smoothstep-remapped coordinate equals the 8-hash value noise it replaces (same interpolant), for all
// four channels at once; texelFetch of a cell gives four random numbers.
let NOISE = null;
function noiseTexture() {
  if (NOISE) return NOISE;
  const n = 32, rnd = mulberry32(0x7e57), data = new Uint8Array(n * n * n * 4);
  for (let i = 0; i < data.length; i++) data[i] = rnd() * 256;
  const t = new THREE.Data3DTexture(data, n, n, n);
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping;
  t.name = 'turbine.noise3d'; t.needsUpdate = true;
  return (NOISE = { value: t });
}

const VERT_DECL = 'attribute float aBand;\nattribute float aWear;\nattribute float aSurf;\n';
const VARYINGS = 'varying vec3 vTObj;\nvarying vec3 vTObjN;\nvarying float vTBand;\nvarying float vTWear;\nvarying float vTSurf;\n';
const VERT_BODY = 'vTObj = position; vTObjN = normal; vTBand = aBand; vTWear = aWear; vTSurf = aSurf;\n';
// Thin-feature widening (vertex). Each vertex knows its section centre (aThinAxis), the section's chord
// half-vector and half-thickness b, and the span direction. The projected width across the feature
// (perpendicular to the view ray and the span) is the ellipse extent along that direction; if it is under
// uThinMinPx, the vertex moves away from the centre line in the screen plane so the band is uThinMinPx
// wide, and vThinCover = true width / drawn width becomes alpha. Depth is untouched.
const THIN_VERT_DECL = /* glsl */`
attribute vec3 aThinAxis;
attribute vec3 aThinChord;
attribute vec4 aThinSpan;
uniform float uThinViewportH;
uniform float uThinMinPx;
varying float vThinCover;
`;
const THIN_PROJECT = /* glsl */`
vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
	mvPosition = instanceMatrix * mvPosition;
	mat4 tM = modelViewMatrix * instanceMatrix;
#else
	mat4 tM = modelViewMatrix;
#endif
mvPosition = modelViewMatrix * mvPosition;
vThinCover = 1.0;
{
	vec3 axV = ( tM * vec4( aThinAxis, 1.0 ) ).xyz, spV = mat3( tM ) * aThinSpan.xyz, chV = mat3( tM ) * aThinChord;
	float ta = length( chV ), tb = aThinSpan.w, spL = length( spV );
	vec3 e = cross( axV, spV / max( spL, 1e-9 ) );
	float eL = length( e );
	if ( max( ta, tb ) > 1e-6 && spL > 1e-6 && ! isOrthographic && eL > 1e-4 * length( axV ) ) {
		e /= eL;
		vec3 ch = ta > 1e-6 ? chV / ta : normalize( cross( spV, e ) ), th = cross( spV / spL, ch );
		float pc = dot( ch, e ), pt = dot( th, e );
		float wPx = 2.0 * sqrt( ta * ta * pc * pc + tb * tb * pt * pt ) * projectionMatrix[ 1 ][ 1 ] * 0.5 * uThinViewportH / max( - axV.z, 1e-3 );
		float k = clamp( uThinMinPx / max( wPx, 1e-6 ), 1.0, 400.0 );
		mvPosition.xyz += e * dot( mvPosition.xyz - axV, e ) * ( k - 1.0 );
		vThinCover = 1.0 / k;
	}
}
gl_Position = projectionMatrix * mvPosition;
`;
// The object axes in view space (rigid transforms: normalMatrix is the view rotation), so the grating can
// measure the view direction against its bars.
const AXES_DECL = 'varying vec3 vTAxX;\nvarying vec3 vTAxY;\nvarying vec3 vTAxZ;\n';
const AXES_VERT = /* glsl */`
#ifdef USE_INSTANCING
	mat3 tIm = mat3( instanceMatrix );
#else
	mat3 tIm = mat3( 1.0 );
#endif
vTAxX = normalize( normalMatrix * tIm[ 0 ] ); vTAxY = normalize( normalMatrix * tIm[ 1 ] ); vTAxZ = normalize( normalMatrix * tIm[ 2 ] );
`;
const ID_VERT_DECL = 'attribute float aTurbineIndex;\nuniform sampler2D uIdCodes;\nflat varying ivec3 vTIdCode;\nvarying vec2 vTIdUv;\n';
const ID_VERT = 'vTIdUv = uv;\nvTIdCode = ivec3( texelFetch( uIdCodes, ivec2( int( aTurbineIndex + 0.5 ), 0 ), 0 ).rgb * 255.0 + 0.5 );\n';
const ID_FRAG_DECL = `uniform sampler2D uIdGlyphs;\nuniform float uGlyphAdv[${GLYPH_ORDER.length}];\nuniform float uGlyphCov[${GLYPH_ORDER.length}];\nflat varying ivec3 vTIdCode;\nvarying vec2 vTIdUv;\n`;

// Landing frame (u out along the landing azimuth, v to its right) and the arc-angle origin of the TP
// streak rows: azimuths are measured from compass 180 deg, so the atan seam sits behind the landing.
const LU = azimuthToDir(LANDING_AZ), LV = azimuthToDir(LANDING_AZ + 90);
const AZ0 = (a) => F((a - 180) * DEG);

const GLSL_COMMON = /* glsl */`
uniform float uPhotoLook;
uniform highp sampler3D tNoiseTex;
// The fragment's object-space position and normal and its surface class, set before tSurface() runs.
vec3 p, on;
float code;
// ao: occlusion of the sky light (indirect diffuse and specular) by the turbine's own overhangs.
struct TSurf { vec3 albedo; float rough; float roughAdd; float metal; float metalW; float height; float ccMul; float alpha; float specMul; vec3 n; float nW; float ao; };
TSurf tInit(vec3 c) { return TSurf(c, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 1.0, 1.0, vec3(0.0, 0.0, 1.0), 0.0, 1.0); }
// Four independent value noises at lattice point x (see noiseTexture), and their 4-octave fbms (0..1).
vec4 tN(vec3 x) { vec3 i = floor(x), f = x - i; return texture(tNoiseTex, (i + f * f * (3.0 - 2.0 * f) + 0.5) / 32.0); }
// Octaves are rotated against each other so the lattice's axis-aligned blotches do not stack up.
const mat3 tRot = mat3(0.0, 1.62, 1.22, -1.62, 0.73, -0.97, -1.22, -0.97, 1.3);   // rotation x 2.03
vec4 tF(vec3 p) { vec3 q = tRot * p, r = tRot * q; return (8.0 * tN(p) + 4.0 * tN(q + 17.1) + 2.0 * tN(r + 5.3) + tN(tRot * r + 11.7)) / 15.0; }
// Four random numbers for the integer cell (a, b).
vec4 tR(float a, float b) { return texelFetch(tNoiseTex, ivec3(mod(vec3(a, floor(a / 32.0) * 7.0 + b, 5.0), 32.0)), 0); }
// Box-filtered pulse train: the share of the pixel footprint fw round x covered by [kP, kP + w]. It fades to
// the mean w / P before the footprint reaches the pitch, where a box filter would alias into moire.
float tPI(float x, float P, float w) { float k = floor(x / P); return k * w + min(x - k * P, w); }
float tPulse(float x, float fw, float P, float w) {
  fw = max(fw, 1e-5);
  return mix(clamp((tPI(x + 0.5 * fw, P, w) - tPI(x - 0.5 * fw, P, w)) / fw, 0.0, 1.0), w / P, smoothstep(0.2, 0.55, fw / P));
}
float tLines(float x, float P, float hw) { return tPulse(x + hw, fwidth(x), P, 2.0 * hw); }
float tBand(float x, float a, float b) { float fw = max(fwidth(x), 1e-5); return clamp((min(x + 0.5 * fw, b) - max(x - 0.5 * fw, a)) / fw, 0.0, 1.0); }
// 1 while unit-sized features of x span more than ~2 px, fading to 0 before they would alias.
float tDetail(float x) { return 1.0 - smoothstep(0.25, 0.6, fwidth(x)); }
// Surface-gradient bump (Mikkelsen) from a height field in metres.
vec3 tBump(vec3 pos, vec3 n, float h, float faceDir) {
  vec3 dpx = dFdx(pos), dpy = dFdy(pos), r1 = cross(dpy, n), r2 = cross(n, dpx);
  float det = dot(dpx, r1) * faceDir;
  return abs(det) < 1e-20 ? n : normalize(abs(det) * n - sign(det) * (dFdx(h) * r1 + dFdy(h) * r2));
}
// A run down a vertical surface from a row of sources at ySrc (each source up to yj lower, at random). u:
// horizontal position in cells of 'cell' metres, one run per cell (probability prob) centred within +-jit/2 of
// the middle; w..2w wide at the source, widening 1.6x and fading over a random length <= maxLen. kind (random
// 0..1) picks what it carries. Box-filtered across: a sub-pixel run keeps its mean ink instead of breaking into dots.
float tRun(float u, float cell, float y, float ySrc, float prob, float maxLen, float w, float jit, float seed, out float kind, float yj) {
  float k = floor(u);
  vec4 r = tR(k, seed);
  kind = r.w;
  float dy = ySrc - yj * fract(r.w * 7.31) - y;
  float t = dy / (0.3 + (maxLen - 0.3) * r.y * r.y);
  if (dy < 0.0 || t > 1.0 || r.x > prob) return 0.0;
  float ww = w * (1.0 + r.z) * (1.0 + 0.6 * t), n = tN(vec3(k * 3.1, y * 2.5, seed)).x;
  float x = (u - k - 0.5 - jit * (r.z - 0.5)) * cell + (n - 0.5) * ww;
  return exp(-x * x / (ww * ww)) * (1.0 - t * t) * (0.6 + 0.4 * n) * min(1.0, ww / (1.5 * fwidth(u) * cell + 1e-5));
}
// Gull droppings round the TP platform (static frame): chalky splats on up-facing steel, clustered where
// gulls perch along the rails, and short vertical drips on the faces below them.
float tGuano(vec3 p, vec3 on) {
  float r2 = dot(p.xz, p.xz);
  if (p.y < 16.8 || p.y > 19.9 || r2 < 28.6 || r2 > 170.0) return 0.0;
  float perch = smoothstep(0.5, 0.8, tN(vec3(p.x * 2.4 * inversesqrt(r2), 13.0, p.z * 2.4 * inversesqrt(r2))).z);
  float up = step(0.4, on.y);
  return perch * smoothstep(0.6, 0.74, tN(up > 0.5 ? p * 7.0 : vec3(p.x * 5.0, p.y * 0.8, p.z * 5.0)).y) * (0.45 + 0.5 * up);
}
// Black rubber scuffs where crew boats push their bow fenders: the outward faces of the boat-landing tubes
// between LAT - 0.5 m and about +3.6 m (bow fender 0.5-2.5 m above the water, over the tide and the
// waves), and fainter marks on the TP wall behind them. Vertical smears: the boat heaves while it pushes.
float tFender(vec3 p, vec3 on) {
  float lu = dot(p.xz, vec2(${F(LU.x)}, ${F(LU.z)})), lv = dot(p.xz, vec2(${F(LV.x)}, ${F(LV.z)}));
  float band = smoothstep(-1.6, -0.6, p.y) * (1.0 - smoothstep(3.0, 3.8, p.y));
  if (band <= 0.0 || lu < ${F(TP_R - 0.3)} || abs(lv) > 1.7) return 0.0;
  float tube = step(abs(lu - ${F(TUBE_U)}), 0.26) * step(abs(abs(lv) - ${F(T.boatLanding.tubeSpacing / 2)}), 0.26);
  float face = smoothstep(-0.2, 0.6, dot(on.xz, vec2(${F(LU.x)}, ${F(LU.z)})));
  float smear = smoothstep(0.38, 0.6, tF(vec3(lv * 11.0, p.y * 0.9, lu * 11.0)).x);
  return band * face * smear * mix(0.2 * step(lu, ${F(TP_R + 0.2)}), 0.95, tube);
}
`;
// Bar grating seen along Vo (the eye direction in the grating's frame, y up): bearing bars run along d.
// Across the bars the eye sees each bar's face (thickness barT) and the bar side turned toward it (depth barD
// at the view slope), which lies on the eye's side of the face; cross rods cover rod (1 + slope) along d.
// Returns (coverage, face share, side share, visible depth of the sides).
const GLSL_GRATE = /* glsl */`
vec4 tGrate(vec2 q, vec2 d, vec3 Vo) {
  vec2 t = vec2(-d.y, d.x);
  float vy = max(abs(Vo.y), 1e-3), tx = dot(Vo.xz, t) / vy, td = abs(dot(Vo.xz, d)) / vy;
  float u = dot(q, t) * sign(tx + 1e-9), w = dot(q, d), fu = fwidth(u);
  float side = min(${F(GRATING.barD)} * abs(tx), ${F(GRATING.pitch - GRATING.barT)});
  float bars = tPulse(u, fu, ${F(GRATING.pitch)}, ${F(GRATING.barT)} + side), face = tPulse(u, fu, ${F(GRATING.pitch)}, ${F(GRATING.barT)});
  float rods = tPulse(w, fwidth(w), ${F(GRATING.rodPitch)}, ${F(GRATING.rod)} * (1.0 + td));
  return vec4(1.0 - (1.0 - bars) * (1.0 - rods), face + rods * (1.0 - bars), bars - face, min(${F(GRATING.barD)}, ${F(GRATING.pitch - GRATING.barT)} / max(abs(tx), 1e-3)));
}
vec3 tViewInObject() { vec3 V = normalize(vViewPosition); return vec3(dot(V, vTAxX), dot(V, vTAxY), dot(V, vTAxZ)); }
`;

const GLSL_MODES = {
  paint: (oss) => /* glsl */`
TSurf tSurf_paint(vec3 base) {
  TSurf s = tInit(base);
  s.rough = 0.0; s.roughAdd = ${F(PAINT.ral7035.roughness)};
  ${photoLookGLSL('s.albedo', 'vTBand')}
  s.albedo *= 0.985 + 0.03 * tF(p * 0.22).x;
  if (code == 1.0) {                                   // tower: weld seams, flange rings, spray grime low down
    float yb = p.y - ${F(ST.tpTop)}, weld = tLines(yb, ${F(T.weldSeamPitch)}, 0.009) * step(1.0, yb), fl = 0.0, run = 0.0;
    for (int i = 0; i < 3; i++) {                      // section flanges: a dark ring, faint rain runs below
      float y = float[3](${T.towerFlangesY.map(F).join(', ')})[i];
      fl += tBand(p.y, y - 0.04, y + 0.04);
      run = max(run, step(p.y, y) * (1.0 - smoothstep(0.0, 7.0, y - p.y)));
    }
    vec4 n = tN(vec3(p.x * 2.5, p.y * 0.05, p.z * 2.5));
    float low = 1.0 - smoothstep(21.5, 45.0, p.y);     // CTV exhaust and spray, rain runs below the flanges
    s.albedo *= 1.0 - 0.035 * weld - 0.5 * fl - (0.05 * low + 0.025 * run) * smoothstep(0.45, 0.9, n.x) - 0.02 * low;
    s.height += 0.0012 * weld - 0.002 * fl;
    s.roughAdd += 0.05 * low;
    // sky occlusion under the nacelle (floor 1 m above the tower top, 19 x 9 m): azimuthal mean of the sky
    // above each wall point that the floor hides, 0.57 at the yaw ring, 0.88 3 m down, 0.98 at 7 m; the tower's
    // polyurethane topcoat is semi-gloss (clearcoat 0.35, ESTIMATED; it moves the 760 px drone profile by <= 1 level)
    s.ao = 1.0 - 0.43 * exp((p.y - ${F(YAW_Y)}) / 2.3);
    s.ccMul = 1.75;
  } else if (code == 2.0) {                            // nacelle: GRP cover panels, seams, rain streaks
    // photo-look stripe: a 2 m RAL 3020 band at half height round the rear ${F(STRIPE_Z - NAC_Z0)} m
    s.albedo = mix(s.albedo, ${RGB(PAINT.ral3020.lin)}, uPhotoLook * tBand(p.y, ${F(STRIPE_Y0)}, ${F(STRIPE_Y1)}) * step(p.z, ${F(STRIPE_Z)}));
    // GRP cover panels 19/8 m long (sides and roof), horizontal seams at +4.2 and +8.0 on the sides, 3 m on
    // the end walls; each moulded panel a slightly different white, so the grid reads at range.
    float side = step(0.7, abs(on.x)), wall = step(on.y, 0.7), pz = 2.375, hs = p.y < 6.1 ? 4.2 : 8.0;
    float seams = max(max((1.0 - wall + side) * tLines(p.z + 10.0, pz, 0.012), step(0.7, abs(on.z)) * tLines(p.x + 1.5, 3.0, 0.012)), side * tBand(p.y, hs - 0.012, hs + 0.012));
    s.albedo *= (1.0 - 0.22 * seams) * (1.0 + 0.07 * (tR(floor((p.z + 10.0) / pz) + 13.0 * floor((p.y - 4.2) / 3.8) + 29.0 * sign(p.x), floor(p.x / 3.0 + 1.5) - wall).x - 0.5));
    s.height -= 0.003 * seams;
    // In-service grime: dirt washed down from the horizontal seams, long irregular rain runs from the roof edge,
    // and a film thickening toward the floor. The rear wall's top sees little sky under the 2.5 m heli-deck
    // overhang (half open: the grating closes only to oblique rays).
    vec4 n = tN(vec3(p.z * 5.0, p.y * 0.12, p.x * 5.0));
    float u = hs - p.y;
    s.albedo *= 1.0 - side * 0.05 * smoothstep(0.45, 0.85, n.x) * step(0.0, u) * (1.0 - smoothstep(0.0, 0.4 + 0.8 * n.y, u))
      - wall * (0.12 * smoothstep(0.5, 0.95, n.z) * smoothstep(2.0, 11.0, p.y) + 0.14 * (1.0 - smoothstep(1.0, 7.0, p.y + 2.0 * n.w)));
    s.ao = 1.0 - 0.45 * step(on.z, -0.7) * exp((p.y - ${F(NAC_Y1)}) / 1.4);
  } else if (code == 3.0) {                            // spinner: segment seams between the roots, nose cap
    float sm = max(tLines(atan(p.x, p.y) / 2.0943951 - 0.5, 1.0, 0.005 / (max(length(p.xy), 0.5) * 2.0943951)), tBand(p.z, 3.0, 3.015));
    s.albedo *= 1.0 - 0.16 * sm;
    // the black rubber seal round the nearest blade root: a band just outside the root cylinder (blade 0's
    // axis after turning the point back by that blade's 120 deg step)
    float ang = 2.0943951 * floor(atan(p.x, p.y) / 2.0943951 + 0.5), c = cos(ang), sn = sin(ang);
    vec3 q = vec3(c * p.x - sn * p.y, sn * p.x + c * p.y, p.z), ax = vec3(0.0, ${F(Math.cos(CONE))}, ${F(Math.sin(CONE))});
    float seal = tBand(length(q - dot(q, ax) * ax), ${F(F_CHORD(0) / 2 - 0.01)}, ${F(F_CHORD(0) / 2 + 0.12)});
    s.albedo = mix(s.albedo, ${RGB(DARK_LIN)}, seal);
    s.height += 0.01 * seal - 0.003 * sm;
  } else if (code == 4.0) {                            // blade: leading-edge erosion (close up only), root grease
    // the blades' polyurethane topcoat over the gelcoat is semi-gloss, glossier than the tower's paint (ESTIMATED)
    s.roughAdd = 0.4; s.ccMul = 2.0;
    float wear = vTWear * (1.0 - smoothstep(0.015, 0.05, length(fwidth(p))));
    if (wear > 0.001) {
      vec4 n = tN(p * 16.0);
      float pits = smoothstep(0.45, 0.8, n.x) * tDetail(p.y * 16.0);
      float m = min(1.0, wear * (0.45 + 0.35 * smoothstep(0.3, 0.8, tN(vec3(p.x * 3.0, p.y * 0.8, p.z * 3.0)).y) + 0.4 * pits));
      s.albedo = mix(s.albedo, s.albedo * vec3(0.80, 0.78, 0.73), 0.6 * m);
      s.roughAdd += 0.32 * m;
      s.ccMul *= 1.0 - 0.9 * m;
      s.height -= 0.001 * pits * wear;
    }
    float r = length(p);
    vec4 n = tN(vec3(p.x * 4.0, r * 0.4, p.z * 4.0));
    s.albedo *= 1.0 - 0.10 * (1.0 - smoothstep(3.3, 7.5, r + 1.5 * n.y)) * smoothstep(0.35, 0.8, n.x);
  }${oss ? /* glsl */`
  // substation surfaces: at >= 13 km from every preset view (its 90 m topside 3-6 px wide) each keeps only its mean
  // tone: RAL 9010 upper module (20), RAL 2004 lifeboats (21), the helideck with its CAP 437 markings averaged (26),
  // the RAL 7038 radiator banks with their fins' shade (19)
  else if (code > 18.5) s.albedo = code == 20.0 ? ${RGB(PAINT.ral9010.lin)} : code == 21.0 ? ${RGB([0.797, 0.104, 0.006])} : code == 26.0 ? ${RGB([0.165, 0.153, 0.096])} : ${RGB([0.26, 0.27, 0.26])};` : ''}
  return s;
}`,
  // TP shell (7), fittings (8: rails, brackets, landing, door, davit) and jacket legs (16): RAL 1023.
  yellow: /* glsl */`
TSurf tSurf_yellow(vec3 base) {
  TSurf s = tInit(base);
  s.rough = 0.0; s.roughAdd = ${F(TP_FINISH.roughness)}; s.specMul = ${F(TP_FINISH.specularIntensity)};
  float R = length(p.xz), az = atan(-p.x, p.z), c = az * R, k, kw = 0.0;
  vec4 m = tF(p * vec3(0.35, 0.2, 0.35)), M = tN(p * 0.15 + 9.0);   // fine mottle (y: salt field); patches metres across
  // paint value varies +-8 % in faded patches metres across, paler (chalked, still yellow) where the sun bleaches it
  s.albedo = mix(s.albedo * (0.92 + 0.16 * M.x + 0.05 * m.x), s.albedo * vec3(1.1, 1.2, 1.5) + 0.04, 0.4 * smoothstep(0.6, 0.9, M.y));
  // splash zone up to a ragged edge 2-5 m above MSL (run-up licks higher): grime and a green algae film darkest
  // just above the growth, dried salt crust, iron staining
  float top = 3.4 + 2.6 * (M.z - 0.5) + 1.2 * (tN(vec3(c * 1.4, 2.0, 7.0)).x - 0.5);
  float sz = 1.0 - smoothstep(top - 1.6, top, p.y + 0.5 * (m.w - 0.5)), lo = 1.0 - smoothstep(1.8, 4.0, p.y + 0.7 * (m.z - 0.5));
  s.albedo = mix(s.albedo, ${RGB(TONE.grime)}, min(0.92, sz * (0.4 + 0.5 * lo) * (0.7 + 0.5 * m.z)));
  s.albedo = mix(s.albedo, ${RGB(TONE.algae)}, 0.5 * lo * smoothstep(0.4, 0.65, m.w));
  float white = 0.15 * sz * (1.0 - lo) * smoothstep(0.55, 0.8, m.y), guano = tGuano(p, on);
  float rust = 0.45 * sz * smoothstep(0.55, 0.75, m.z) * (0.4 + 0.6 * lo);
  s.roughAdd += 0.1 * sz;
  if (code == 7.0) {
    // touch-up patches: rectangles of fresher, glossier paint where crews repaired the coating, most round the landing
    float lv = dot(p.xz, vec2(${F(LV.x)}, ${F(LV.z)})), land = step(abs(lv), 2.4) * step(0.0, dot(p.xz, vec2(${F(LU.x)}, ${F(LU.z)})));
    vec4 q = tR(floor(c / 1.7), floor(p.y / 1.3) + 40.0);
    float tu = step(q.x, 0.03 + 0.15 * land) * tBand(mod(c, 1.7), 0.1 + 0.6 * q.y, 0.8 + 0.8 * q.z) * tBand(mod(p.y, 1.3), 0.05 + 0.4 * q.w, 0.7 + 0.5 * q.y) * step(3.5, p.y) * step(p.y, 17.0);
    s.albedo = mix(s.albedo, ${RGB(YELLOW_LIN)} * 1.12, 0.85 * tu);
    s.roughAdd -= 0.3 * tu;
    // Runs down the TP wall: from the platform bracket welds (+18.2) and the knee-brace feet (+17.0) at the
    // 16 bracket azimuths (none under the landing lobe), drips from the grating and rim above, fine bleed from
    // the tower flange bolts (+21.2), and weeps scattered over the wall from pinholes, bolts and the landing's
    // stand-offs (one per 0.7 m x 2 m cell, denser round the landing). Most carry rust; some dried salt or guano.
    float ub = (az + 3.14159265) / 0.39269908 + 0.5, lobe = step(abs(mod(floor(ub) * 22.5 + 180.0 - ${F(LANDING_AZ)}, 360.0) - 180.0), 27.0);
    float kb, br = (1.0 - lobe) * (tRun(ub, R * 0.3927, p.y, 18.15, 0.95, 5.5, 0.08, 0.15, 2.0, kb, 0.0) + 0.8 * tRun(ub, R * 0.3927, p.y, 16.95, 0.9, 4.0, 0.06, 0.1, 3.0, k, 0.0));
    float kd, dr = tRun(c / 0.45, 0.45, p.y, 18.3, 0.18, 5.0, 0.03, 0.8, 4.0, kd, 0.0), kf, fb = tRun(c / 0.25, 0.25, p.y, ${F(FLANGE_Y)}, 0.25, 2.4, 0.02, 0.8, 1.0, kf, 0.0), wp = 0.0;
    for (float j = 0.0; j < 2.0; j++) {
      float row = floor(p.y * 0.5) + j, v = tRun(c / 0.7 + 3.1 * row, 0.7, p.y, row * 2.0 + 1.9, 0.18 + 0.5 * land, 2.2, 0.04, 0.8, row + 20.0, k, 1.5);
      if (v > wp) { wp = v; kw = k; }
    }
    rust += 0.75 * br * step(kb, 0.85) + 0.7 * wp * step(kw, 0.85) + 0.4 * dr * step(kd, 0.55) + 0.45 * fb * step(kf, 0.7);
    // broad grey-brown grime washed down from the platform: what makes a TP read as in service from afar
    s.albedo *= 1.0 - 0.18 * tRun(c / 0.8, 0.8, p.y, 18.2, 0.6, 7.0, 0.12, 0.8, 6.0, k, 0.0);
    white += 0.3 * wp * step(0.85, kw) + 0.35 * dr * step(0.55, kd) * step(kd, 0.85) + 0.3 * fb * step(0.7, kf);
    // gull droppings from the brackets and from the top flange's ledge, where gulls sit inside the rails
    guano += 0.9 * br * step(0.85, kb) + 0.75 * dr * step(0.85, kd) + 0.8 * tRun(c / 0.9, 0.9, p.y, ${F(FLANGE_Y)}, 0.25, 2.6, 0.05, 0.8, 8.0, k, 0.0);
    s.albedo *= 1.0 - 0.12 * (1.0 - smoothstep(0.0, 0.25, ${F(FLANGE_Y)} - p.y));     // shade line under the flange lip
    // circumferential can welds every 3.0 m, one longitudinal seam per can at a staggered azimuth
    float yc = p.y - 0.73, can = floor(yc / 3.0), da = (mod(az - 6.2831853 * tR(can, 9.0).x + 3.14159265, 6.2831853) - 3.14159265) * R;
    float weld = max(tLines(yc, 3.0, 0.0075) * step(0.5, yc), tBand(da, -0.0075, 0.0075));
    s.albedo *= 1.0 - 0.08 * weld;
    s.height += 0.002 * weld;
  } else {
    // fittings: pinpoint rust at pores and edges with short tails, rain streaks
    rust += 0.35 * smoothstep(0.84, 0.96, tN(p * vec3(40.0, 12.0, 40.0)).z) * tDetail(p.y * 12.0);
    s.albedo *= 1.0 - 0.08 * smoothstep(0.6, 0.95, tN(vec3(p.x * 3.0, p.y * 0.2, p.z * 3.0)).w);
  }
  // The TP door at deck level (config TURBINE.door), a flush watertight door drawn here: the opening (leaf
  // + 2 cm, corners r 0.15 m) in a raised frame, the leaf behind a dark gap, hinges and handle; hand and boot
  // grime, a worn threshold and chalky, sun-faded paint on the leaf.
  float dx = (mod(${AZ0(DOOR_AZ)} - az + 3.14159265, 6.2831853) - 3.14159265) * R, dy = p.y - ${F(ST.deck)};
  if (code == 7.0 && abs(dx) < 1.1 && dy > -0.1 && dy < 2.6) {
    vec2 q = abs(vec2(dx, dy - ${F(0.07 + T.door.height / 2 + 0.01)})) - vec2(${F(T.door.width / 2 + 0.01 - 0.15)}, ${F(T.door.height / 2 + 0.01 - 0.15)});
    float sd = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - 0.15;
    float gap = tBand(sd, -0.025, 0.0), frame = tBand(sd, 0.0, 0.07), leaf = tBand(sd, -2.0, -0.025);
    float iron = tBand(dx, -0.48, -0.42) * (tBand(dy, 0.535, 0.715) + tBand(dy, 1.835, 2.015)) + tBand(dx, 0.35, 0.45) * tBand(dy, 1.135, 1.185);
    vec4 n = tN(vec3(dx * 7.0, dy * 5.0, 3.0));
    float hand = exp(-pow((dx - 0.36) / 0.16, 2.0) - pow((dy - 1.15) / 0.3, 2.0));
    float boot = (1.0 - smoothstep(0.0, 0.45, dy)) * (1.0 - smoothstep(0.5, 0.75, abs(dx)));
    float dirt = clamp(0.6 * hand + 0.5 * boot + 0.12 * (1.0 - smoothstep(0.5, 1.1, abs(dx))), 0.0, 1.0) * (0.5 + 0.5 * n.x);
    s.albedo = mix(mix(s.albedo, ${RGB(TONE.chalk)}, 0.22 * leaf * (0.5 + 0.5 * n.y)) * (1.0 - 0.45 * dirt), vec3(0.015), max(gap, 0.85 * iron));
    s.height += 0.004 * frame - 0.003 * gap + 0.006 * iron;
    s.roughAdd += 0.12 * leaf + 0.1 * dirt;
  }
  float fend = tFender(p, on);   // black rubber over paint worn back to rusty steel
  s.albedo = mix(s.albedo, ${RGB(PAINT.rust.lin)} * (0.7 + 0.6 * m.x), clamp(rust + 0.6 * fend, 0.0, 0.85));
  s.albedo = mix(s.albedo, ${RGB(TONE.salt)}, clamp(white, 0.0, 0.6));
  s.albedo = mix(s.albedo, ${RGB(TONE.guano)}, clamp(guano, 0.0, 0.9));
  s.albedo = mix(s.albedo, ${RGB(TONE.rubber)}, fend);
  s.roughAdd += 0.2 * rust + 0.15 * guano - 0.2 * fend;
  return s;
}`,
  // Galvanised fittings; opaque grating (9: substation stairs and walkways, cooler grille, distant LODs).
  galv: /* glsl */`
TSurf tSurf_galv(vec3 base) {
  TSurf s = tInit(base);
  s.rough = 0.0; s.roughAdd = ${F(GALV.roughness)};
  vec4 m = tF(p * 1.1);
  float metal = 1.0;
  if (floor(vTSurf + 0.5) == 9.0) {                    // the slots read dark, the bars average by footprint
    metal = tGrate(p.xz, vTWear < -0.5 ? vec2(1.0, 0.0) : vec2(0.0, 1.0), tViewInObject()).x;
    s.albedo = mix(vec3(0.018, 0.02, 0.022), base * (0.95 + 0.1 * m.x), metal);
    s.roughAdd += mix(0.25, -0.05, metal);
  } else {                                             // spangle and patchy zinc
    s.albedo *= (0.94 + 0.1 * tN(p * 18.0).x * tDetail(p.x * 18.0) + 0.08 * (m.y - 0.5)) * mix(vec3(1.0), vec3(0.62, 0.55, 0.46), 0.6 * smoothstep(0.45, 0.8, m.w));
    s.roughAdd += 0.12 * (m.y - 0.5);
  }
  float white = smoothstep(0.62, 0.86, m.z);           // white rust (zinc bloom)
  float guano = tGuano(p, on);
  s.albedo = mix(mix(s.albedo, ${RGB(TONE.zincBloom)}, 0.35 * white), ${RGB(TONE.guano)}, guano);
  s.roughAdd += 0.15 * white + 0.1 * guano;
  s.metal = ${F(GALV.metalness)} * (1.0 - 0.7 * max(white, guano)) * metal; s.metalW = 1.0;
  return s;
}`,
  // See-through walkway grating (alpha = coverage, tGrate). The metal is shaded with the normal of what is
  // seen: the bar faces (up or down, toward the eye) and the bar sides turned to the eye, tilted toward the
  // slot opening on the eye's side, which is where their light comes from (the sky above, the sea below),
  // and darkened by the slot's ambient occlusion averaged over the visible depth. From below this reads as a
  // dark grid against the sky with sunlit slits, from above as bright bar tops over dark slots, and at
  // grazing angles or beyond ~3 px per bar as the averaged sheet.
  grating: /* glsl */`
TSurf tSurf_grating(vec3 base) {
  TSurf s = tInit(base);
  vec2 d = vec2(1.0, 0.0);                             // bars run along d (they span between the beams)
  // de: distance (m) to the toe plate or wall the deck meets, where grime collects and the corner shades it
  float joint = 0.0, panel = floor(p.x * 0.8) + 7.0 * floor(p.z * 0.8), de = 9.0;
  if (vTWear > 0.5) {                                  // TP platform: 48 ring panels of radial bars + the lobe
    float u = dot(p.xz, vec2(${F(LU.x)}, ${F(LU.z)})), v = dot(p.xz, vec2(${F(LV.x)}, ${F(LV.z)})), R = length(p.xz);
    if (u > ${F(Math.sqrt(DECK_R * DECK_R - LOBE_HALF_W * LOBE_HALF_W) - 0.5)} && abs(v) < ${F(LOBE_HALF_W)}) {
      d = vec2(${F(LU.x)}, ${F(LU.z)});
      joint = tLines(u - ${F(LOBE_BEAM_U0)}, ${F(LOBE_BEAM_PITCH)}, 0.02);
      panel = 20.0 + floor((u - ${F(LOBE_BEAM_U0)}) / ${F(LOBE_BEAM_PITCH)});
      de = min(${F(LOBE_HALF_W)} - abs(v), ${F(LOBE_REACH)} - u);
    } else {
      float az = atan(p.x, -p.z) / 0.13089969, ac = (floor(az) + 0.5) * 0.13089969;   // 7.5 deg panels, 0.7-1 m wide
      d = vec2(sin(ac), -cos(ac));
      panel = floor(az);
      joint = tLines(az, 1.0, 0.02 / (max(R, 1.0) * 0.13089969));
      de = min(R - ${F(TP_R)}, ${F(DECK_R)} - R);
    }
  } else if (abs(p.y - ${F(NAC_Y1)}) < 0.05) de = min(${F(NAC_W)} - abs(p.x), p.z - ${F(HELI_Z0)});   // heli-hoist deck
  vec3 Vo = tViewInObject();
  vec4 g = tGrate(p.xz, d, Vo);
  float a = max(g.x, joint), eye = sign(Vo.y + 1e-9), gap = ${F(GRATING.pitch - GRATING.barT)}, w = max(g.w, 1e-4);
  s.alpha = a;
  // Seen from below, the visible lower part of a side takes its light through the far (top) opening: the sky,
  // and the sun off the opposite wall. The near opening shows only the dark sea. So the side leans up either way,
  // and its occlusion is the view factor to that opening over the visible depth w: a sliver seen steeply from
  // below is dark, an oblique side sky-lit steel (it read as navy glass when it leaned toward the sea).
  vec3 ny = vTAxY * eye, t3 = normalize(vTAxZ * d.x - vTAxX * d.y);
  vec3 ns = normalize(t3 * sign(dot(t3, normalize(vViewPosition)) + 1e-9) + (eye > 0.0 ? 0.7 : -0.6) * ny);
  s.n = normalize(ny * g.y + ns * (g.z + joint) + 1e-4 * ny); s.nW = 1.0;   // panel banding bars: their 30 mm sides show
  float sideShare = g.z / max(a, 1e-3), D = ${F(GRATING.barD)};
  // (from below, the sunlit far wall of the slot lights the visible side about as much as the sky does: x2)
  float ao = mix(1.0, eye > 0.0 ? 1.0 - (sqrt(w * w + gap * gap) - gap) / w : 1.0 - (sqrt(D * D + gap * gap) - sqrt((D - w) * (D - w) + gap * gap)) / w, sideShare);
  // each grating panel weathered a little differently; white zinc bloom mostly on the washed top faces; grime in
  // patches and along the toe plates and walls (with the corner's contact shade); the never-washed underside
  // rust-bloomed, dirty and matte
  vec4 n = tN(p * 3.0), st = tN(vec3(dot(p.xz, d) * 1.2, dot(p.xz, vec2(-d.y, d.x)) * 9.0, 4.0));   // st: streaks along the bars
  float white = smoothstep(0.65, 0.9, n.y) * (eye > 0.0 ? 1.0 : 0.3), guano = eye > 0.0 ? tGuano(p, vec3(0.0, 1.0, 0.0)) * (1.0 - sideShare) : 0.0;
  // (de >= 0: fragments on the lobe's side edges can fall just outside its |v| test and read the ring's distance)
  de = max(de, 0.0);
  float dirt = min(1.0, eye > 0.0 ? 0.8 * (1.0 - smoothstep(0.05, 0.7, de + 0.3 * n.z)) + 0.15 + 0.55 * smoothstep(0.4, 0.75, st.x) * (0.6 + 0.4 * n.w) : 0.8);
  ao *= 1.0 - 0.5 * exp(-9.0 * de) * step(0.0, eye);
  s.albedo = mix(mix(base * (0.94 + 0.12 * n.x + 0.16 * (tR(panel, 3.0).x - 0.5)) * mix(vec3(1.0), eye > 0.0 ? vec3(0.6, 0.52, 0.42) : vec3(0.95, 0.7, 0.45), dirt), ${RGB(TONE.zincBloom)}, 0.12 * white), ${RGB(TONE.guano)}, guano) * ao;
  s.specMul = ao * (0.75 + 0.25 * eye);
  s.roughAdd += 0.15 * white + 0.1 * dirt - 0.05;
  s.metal = ${F(GALV.metalness)} * (1.0 - 0.7 * max(white, max(guano, dirt))); s.metalW = 1.0;
  return s;
}`,
  // Marine growth, -1.1 .. +1.8: mussel and weed mat, barnacles close up, a weed fringe in the wash zone,
  // the paint line above; fenders scrape the landing tubes back toward bare, rubber-blackened steel.
  growth: /* glsl */`
TSurf tSurf_growth(vec3 base) {
  TSurf s = tInit(base);
  s.specMul = 0.5;                                     // water film: F0 ~0.02
  if (code == 12.0) {                                  // pile and jacket below the band: dark, fouled steel, can welds
    vec4 m = tF(p * 1.5);
    s.albedo = mix(${RGB(PILE_LIN)} * (0.7 + 0.6 * m.x), vec3(0.012, 0.014, 0.006), 0.7 * smoothstep(0.5, 0.8, m.y)) * (1.0 - 0.06 * tLines(p.y + 22.0, 3.0, 0.0075));
    s.rough = 0.0; s.roughAdd = 0.7 + 0.1 * m.x;
    return s;
  }
  vec4 m = tF(p * vec3(4.0, 6.0, 4.0));
  // weed and slime hang in fine vertical strands; the mat is brown-black with lighter tufts
  float strand = tF(vec3(p.x * 30.0, p.y * 4.0, p.z * 30.0)).y;
  vec3 g = base * (0.65 + 0.4 * m.x + 0.5 * strand);
  g = mix(g, vec3(0.020, 0.024, 0.010), 0.35 * smoothstep(0.45, 0.7, m.y) * smoothstep(-0.2, 0.8, p.y));   // algae film
  float mus = smoothstep(0.52, 0.7, m.z) * (1.0 - smoothstep(0.2, 1.0, p.y));                            // mussels low down
  g = mix(g, vec3(0.006, 0.007, 0.010), 0.8 * mus);
  // barnacles: 2-4 cm pale plates with a dark aperture where they are resolved (else their mean tone)
  float det = 1.0 - smoothstep(0.12, 0.3, fwidth(p.y * 22.0)), b = tN(p * 26.0).z * (1.0 - mus);
  float plate = smoothstep(0.66, 0.74, b) * det, hole = smoothstep(0.8, 0.86, b) * det;
  g = mix(mix(g, vec3(0.042, 0.040, 0.034), 0.6 * mix(0.085, plate, det)), vec3(0.003), 0.8 * hole);
  float e = p.y + 0.3 * (m.w - 0.5) + 0.25 * (strand - 0.5);     // ragged, strand-hung top edge
  g = mix(g, vec3(0.026, 0.042, 0.012), 0.5 * smoothstep(1.1, 1.3, e) * (1.0 - smoothstep(1.45, 1.6, e)) * smoothstep(0.35, 0.65, strand));
  float edge = smoothstep(1.4, 1.8, e), fend = tFender(p, on);
  g = mix(g, mix(${RGB(YELLOW_LIN)} * 0.7, ${RGB(TONE.rubber)}, 0.6), fend);
  s.albedo = mix(g, ${RGB(TONE.grime)}, edge);         // meets the splash zone's darkest grime
  float wet = 1.0 - smoothstep(-0.2, 0.9, p.y + 0.5 * (tN(vec3(p.x * 0.8, p.y * 0.4, p.z * 0.8)).y - 0.5));
  s.albedo *= 1.0 - 0.35 * wet;
  s.rough = 0.0; s.roughAdd = mix(mix(mix(${F(PAINT.marineGrowth.roughnessDry)}, ${F(PAINT.marineGrowth.roughnessWet)}, max(wet, 0.6 * mus)), 0.8, plate), 0.6, max(edge, fend));
  s.height += (0.002 * plate - 0.0015 * hole + 0.003 * m.x + 0.005 * mus) * (1.0 - max(edge, fend));
  return s;
}`,
  dark: /* glsl */`
TSurf tSurf_dark(vec3 base) {
  TSurf s = tInit(base);
  s.rough = 0.0; s.roughAdd = 0.5; s.metal = 0.2; s.metalW = 1.0;
  s.albedo *= 0.9 + 0.2 * tF(p * 0.8).x;
  if (code == 14.0) {                                  // radiator cores: aluminium fins behind the frame
    float fins = tLines(abs(on.x) > 0.5 ? p.z : p.x, 0.014, 0.0025);
    s.albedo = vec3(0.20, 0.205, 0.21) * (0.55 + 0.7 * fins) * (0.92 + 0.16 * tN(p * 2.0).x);
    s.height += 0.002 * fins;
    s.metal = 0.6; s.metalW = 1.0;
    s.roughAdd += 0.15;
  } else if (code == 18.0) {                           // louvre slats: a shadow line under each blade
    float gap = tLines(p.y, 0.12, 0.022);
    s.albedo = vec3(0.16, 0.165, 0.17) * (1.0 - 0.6 * gap);
    s.height -= 0.006 * gap;
  }
  return s;
}`,
  // Painted ID: SDF glyphs. g = text coordinates in cap-height units (x from the text's left edge).
  id: /* glsl */`
TSurf tSurf_id(vec3 base) {
  TSurf s = tInit(base);
  float salt = smoothstep(0.55, 0.85, tF(p * 4.0).x);
  s.albedo = mix(base, vec3(0.05, 0.047, 0.04), 0.15 * salt);
  s.roughAdd += 0.1 * salt;
  float a0 = uGlyphAdv[vTIdCode.x], a1 = uGlyphAdv[vTIdCode.y], tw = a0 + a1 + uGlyphAdv[vTIdCode.z];
  vec2 g = vec2((vTIdUv.x * ${F(ID_PATCH_W)} - 0.5 * (${F(ID_PATCH_W)} - tw * ${F(ID_CAP)})) / ${F(ID_CAP)}, (vTIdUv.y * ${F(ID_PATCH_H)} - ${F(ID_PAD)}) / ${F(ID_CAP)});
  vec2 gdx = dFdx(g), gdy = dFdy(g);
  int ci = g.x >= a0 + a1 ? vTIdCode.z : g.x >= a0 ? vTIdCode.y : vTIdCode.x;
  float x0 = g.x >= a0 + a1 ? a0 + a1 : g.x >= a0 ? a0 : 0.0, fc = float(ci);
  vec2 cell = vec2(mod(fc, ${F(GLYPH_LAYOUT.cols)}) * ${F(GLYPH_LAYOUT.cellW)}, floor(fc / ${F(GLYPH_LAYOUT.cols)}) * ${F(GLYPH_LAYOUT.cellH)});
  vec2 atlas = vec2(${F(GLYPH_LAYOUT.width)}, ${F(GLYPH_LAYOUT.height)});
  // A distance field must not be mip-averaged down to the pixel footprint (the strokes would fade): sample
  // two mip levels finer than the footprint and let the AA width carry the minification.
  float sd = textureGrad(uIdGlyphs, (cell + (vec2(g.x - x0, g.y) + ${F(GLYPH_LAYOUT.margin)}) * ${F(GLYPH_LAYOUT.S)}) / atlas, 0.25 * gdx * ${F(GLYPH_LAYOUT.S)} / atlas, 0.25 * gdy * ${F(GLYPH_LAYOUT.S)} / atlas).r;
  float fp = max(length(gdx), length(gdy));            // pixel footprint in cap units
  float w = 0.6 * fp / ${F(2 * GLYPH_LAYOUT.spread)} + 1e-4;
  // Far away (glyph < ~5 px tall) the strokes turn into their mean ink over the glyph box.
  s.alpha = mix(smoothstep(0.5 - w, 0.5 + w, sd), uGlyphCov[ci] * tBand(g.x, 0.0, tw) * tBand(g.y, 0.0, 1.0), smoothstep(0.18, 0.4, fp));
  return s;
}`,
};
// One material for every thin feature: the fragment picks the finish from the surface code, with the base
// colour and roughness each regular material would have had.
const GLSL_MULTI = () => GLSL_MODES.paint(false) + GLSL_MODES.yellow + GLSL_MODES.galv + GLSL_MODES.growth + GLSL_MODES.dark + /* glsl */`
TSurf tSurface(vec3 base) {
if (code == 7.0 || code == 8.0 || code == 16.0) return tSurf_yellow(${RGB(YELLOW_LIN)});
if (code == 11.0) return tSurf_growth(${RGB(PAINT.marineGrowth.lin)});
if (code == 9.0 || code == 10.0 || code == 17.0) return tSurf_galv(${RGB(GALV.lin)});
if (code == 13.0 || code == 14.0 || code == 18.0) return tSurf_dark(${RGB(DARK_LIN)});
if (code > 23.5 && code < 25.5) { TSurf s = tInit(code < 24.5 ? ${RGB(LENS_YELLOW_LIN)} : ${RGB(LENS_RED_LIN)}); s.rough = 0.0; s.roughAdd = 0.08; return s; }
return tSurf_paint(${RGB(PAINT.ral7035.lin)});
}`;   // lamp lenses (24, 25): glossy

// Thin features and the grating are centimetres of steel or an averaged sheet, so their sun-shadow penumbra
// spans a few pixels at most: they take a 5-tap PCF (centre and the four corners of three's kernel)
// instead of its 17 taps, which is most of their fragment cost close up. Left as is if the r180 chunk
// text is not found.
const PCF17 = /shadow = \(\s*texture2DCompare\( shadowMap, shadowCoord\.xy \+ vec2\( dx0, dy0 \)[\s\S]*?\) \* \( 1\.0 \/ 17\.0 \);/;
const PCF5 = `shadow = 0.2 * (${['', ' + vec2( dx0, dy0 )', ' + vec2( dx1, dy0 )', ' + vec2( dx0, dy1 )', ' + vec2( dx1, dy1 )']
  .map((o) => `texture2DCompare( shadowMap, shadowCoord.xy${o}, shadowCoord.z )`).join(' + ')});`;
// Diffuse sky light. three's getIBLIrradiance takes one tap of the PMREM's roughest level, a 33 deg Gaussian with
// 1.65x the cosine lobe's weight along the normal: a wall facing the brightest sky (twilight glow, horizon band)
// took too much light and walls facing away too little. Against the cosine integral of the environment cube, the
// nacelle's WNW wall at 21:08 got 1.35x, the rotor face 0.92x. Three taps of that level on a 28.6 deg ring (one
// above the normal, two below either side; textureCubeUV needs no unit vectors, so the ring is scaled by 1/sin)
// follow the cosine lobe within ~10 % at 06:00, noon, 16:30, 20:30 and 21:08. Steeply downward faces keep the
// single tap, whose tail reaches less far over the horizon into the bright sky.
const IBL_ONE = 'vec4 envMapColor = textureCubeUV( envMap, envMapRotation * worldNormal, 1.0 );';
const IBL_RING = /* glsl */`vec3 tIn = envMapRotation * worldNormal, tIt = normalize(cross(abs(tIn.y) < 0.99 ? vec3(0, 1, 0) : vec3(1, 0, 0), tIn)), tIb = 1.1546 * cross(tIn, tIt), tIc = 2.1137 * tIn - 0.5 * tIb;
vec4 envMapColor = textureCubeUV(envMap, tIn, 1.0);
envMapColor.rgb = mix((textureCubeUV(envMap, tIc + 1.5 * tIb, 1.0).rgb + textureCubeUV(envMap, tIc + tIt, 1.0).rgb + textureCubeUV(envMap, tIc - tIt, 1.0).rgb) / 3.0, envMapColor.rgb, smoothstep(-0.35, -0.75, tIn.y));`;

function injectTurbineShader(shader, mode, flags) {
  if (shader.vertexShader.includes('vTObj')) return;         // idempotent if a hook chain runs twice
  const u = shader.uniforms;
  u.uPhotoLook = PHOTO_LOOK; u.tNoiseTex = noiseTexture();
  let vDecl = VERT_DECL + VARYINGS, vBody = VERT_BODY, fDecl = VARYINGS + GLSL_COMMON;
  if (flags.thin) { vDecl += THIN_VERT_DECL; fDecl += 'varying float vThinCover;\n'; u.uThinViewportH = THIN_VIEWPORT; u.uThinMinPx = THIN_MIN_PX; }
  if (/grating|galv|multi/.test(mode)) { vDecl += AXES_DECL; vBody += AXES_VERT; fDecl += AXES_DECL + GLSL_GRATE; }
  if (mode === 'id') { vDecl += ID_VERT_DECL; vBody += ID_VERT; fDecl += ID_FRAG_DECL; Object.assign(u, glyphTextures()); }
  const glsl = GLSL_MODES[mode];
  fDecl += mode === 'multi' ? GLSL_MULTI() : `${typeof glsl === 'function' ? glsl(true) : glsl}\nTSurf tSurface(vec3 base) { return tSurf_${mode}(base); }\n`;
  const rep = (src, pairs) => pairs.reduce((s, [a, b]) => s.replace(`#include <${a}>`, `#include <${a}>\n${b}`), src);
  shader.vertexShader = rep(shader.vertexShader, [['common', vDecl], ['begin_vertex', vBody]]);
  if (flags.thin) shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', THIN_PROJECT);
  if (flags.thin || mode === 'grating') shader.fragmentShader = shader.fragmentShader.replace('#include <shadowmap_pars_fragment>', THREE.ShaderChunk.shadowmap_pars_fragment.replace(PCF17, PCF5));
  shader.fragmentShader = shader.fragmentShader.replace('#include <envmap_physical_pars_fragment>', THREE.ShaderChunk.envmap_physical_pars_fragment.replace(IBL_ONE, IBL_RING));
  shader.fragmentShader = rep(shader.fragmentShader, [
    ['clipping_planes_pars_fragment', fDecl],
    ['color_fragment', `p = vTObj; on = normalize(vTObjN); code = floor(vTSurf + 0.5);\nTSurf tS = tSurface(diffuseColor.rgb);\ndiffuseColor.rgb = tS.albedo;\ndiffuseColor.a *= tS.alpha${flags.thin ? ' * vThinCover' : ''};`],
    ['roughnessmap_fragment', 'roughnessFactor = clamp(roughnessFactor * tS.rough + tS.roughAdd, 0.03, 1.0);'],
    ['metalnessmap_fragment', 'metalnessFactor = mix(metalnessFactor, tS.metal, tS.metalW);'],
    ['normal_fragment_maps', 'normal = tBump(-vViewPosition, normal, tS.height, faceDirection);\nif (tS.nW > 0.0) normal = normalize(mix(normal, tS.n, tS.nW));'],
    ['aomap_fragment', 'reflectedLight.indirectDiffuse *= tS.ao;\nreflectedLight.indirectSpecular *= tS.ao;'],
    ['lights_physical_fragment', '#ifdef USE_CLEARCOAT\nmaterial.clearcoat *= tS.ccMul;\n#endif\nmaterial.specularColor = mix(material.specularColor * tS.specMul, material.specularColor, metalnessFactor);\nmaterial.specularF90 = mix(material.specularF90 * tS.specMul, material.specularF90, metalnessFactor);'],
    // Decal depth bias: the ID patch floats a few mm off the TP, below the depth buffer's resolution at
    // range (the strokes z-fought the shell in columns). A constant bias in logarithmic depth is a constant
    // relative distance (1e-5 = 0.012 %: 2 mm at 16 m, 9 cm at 774 m), which only the painted shell sits within.
    ...(mode === 'id' ? [['logdepthbuf_fragment', '#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )\n\tgl_FragDepth -= 1e-5;\n#endif']] : []),
  ]);
}
// Our weathering hook and program key go on first; applyAtmosphere() then wraps them (it calls the previous
// hook first and keys on the previous key), which also marks the material so a later call is a no-op.
function finishMaterial(mat, mode, flags = {}) {
  if (mode) {
    mat.onBeforeCompile = (shader) => injectTurbineShader(shader, mode, flags);
    const key = `turbine-weather-v4:${mode}${flags.thin ? ':thin' : ''}`;
    mat.customProgramCacheKey = () => key;
  }
  if (flags.thin) mat.onBeforeRender = thinBeforeRender;
  applyAtmosphere(mat);
  mat.userData.turbineMode = mode || 'plain';
  return mat;
}

let MATERIALS = null;
const lin = (a) => new THREE.Color().setRGB(a[0], a[1], a[2]);   // spec values are already linear
const phys = (name, o, mode, flags) => finishMaterial(new THREE.MeshPhysicalMaterial({ name, metalness: 0, ...o }), mode, flags);
export function createTurbineMaterials() {
  if (MATERIALS) return MATERIALS;
  const P = PAINT, clear = { transparent: true, depthWrite: false };
  MATERIALS = {
    paint: phys('turbine.paint', { color: lin(P.ral7035.lin), roughness: P.ral7035.roughness, clearcoat: P.ral7035.clearcoat, clearcoatRoughness: P.ral7035.clearcoatRoughness }, 'paint'),
    yellow: phys('turbine.yellow', { color: lin(YELLOW_LIN), roughness: TP_FINISH.roughness }, 'yellow'),
    galvanised: phys('turbine.galvanised', { color: lin(GALV.lin), roughness: GALV.roughness, metalness: GALV.metalness }, 'galv'),
    growth: phys('turbine.marineGrowth', { color: lin(P.marineGrowth.lin), roughness: 1 }, 'growth'),
    dark: phys('turbine.darkSteel', { color: lin(DARK_LIN), roughness: 0.5, metalness: 0.2 }, 'dark'),
    // Decals and grating (depthWrite off): drawn after the opaque pass, blended by their coverage.
    idPaint: phys('turbine.idPaint', { color: lin(P.ral9005.lin), ...ID_FINISH, ...clear }, 'id'),
    grating: phys('turbine.grating', { color: lin(GALV.lin.map((v) => v * 0.65)), roughness: GALV.roughness, metalness: GALV.metalness, ...clear }, 'grating'),
    // Thin features: transparent (alpha = coverage when widened) but depth-writing; no clearcoat (invisible
    // at the sizes they draw). Base colour RAL 7035: a merged far LOD (farm) reads it for the blades.
    thin: phys('turbine.thin', { color: lin(P.ral7035.lin), roughness: P.ral7035.roughness, transparent: true }, 'multi', { thin: true }),
    lensYellow: phys('turbine.lens.yellow', { color: lin(LENS_YELLOW_LIN), roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.05 }),
    lensRed: phys('turbine.lens.red', { color: lin(LENS_RED_LIN), roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.05 }),
    uniforms: { uPhotoLook: PHOTO_LOOK },
  };
  return MATERIALS;
}

// ------------------------------------------------------------------------------------------------
// Assembly
// ------------------------------------------------------------------------------------------------
/** Nacelle roof furniture in the yaw frame (metres, [min, max] corners): the cooler and the heli-hoist deck
 *  (grating plate and the frame beams under it), plus the heli-deck rail top. For keep-outs and occlusion. */
export const NACELLE_ROOF = Object.freeze({
  cooler: [[-COOLER.x, NAC_Y1, COOLER.z0], [COOLER.x, NAC_Y1 + COOLER.h, COOLER.z1]],
  heliDeck: [[-NAC_W, NAC_Y1 - HELI_FRAME_D, HELI_Z0], [NAC_W, NAC_Y1, HELI_Z1]],
  heliRailTopY: NAC_Y1 + NAC.heliDeck.railHeight,
});
// The design values the geometry is built to. Dev builds measure them from the geometry instead (measure(),
// checked by the scale report).
const DESIGN_DIMS = {
  hubHeight: YAW_Y + HUB_OFFSET.y, towerTopY: YAW_Y, tpD: T.tp.diameter, tpTopY: ST.tpTop, deckY: ST.deck,
  railTopY: ST.deck + T.platform.railHeight, waterlineRadius: TP_R, rotorDiameter: T.rotorDiameter, l864Y: NIGHT_LIGHTS.l864.y,
};

// Builder order is part order, which is draw order among the transparent parts (same renderOrder and object
// depth): depth-writing thin features first, then the ID decals, the see-through grating last.
const newBuilders = (keys) => Object.fromEntries(keys.split(' ').map((k) => [k, new PartBuilder({ thin: k === 'thin' })]));
// Where a LOD does not need the thin treatment (or see-through grating), move those triangles into the
// opaque part of their surface family, so distant LODs cost no extra draw calls.
function foldThinParts(B, keepThin, keepGrating) {
  const S = SURF, family = (c) => (c === S.yellowMisc || c === S.tpShell || c === S.jacket ? B.yellow
    : c === S.growth ? B.growth || B.yellow
      : c === S.grating || c === S.galvMisc ? B.galvanised
        : c === S.darkMisc || c === S.radiator || c === S.louvre ? B.dark
          : c === S.lensYellow ? B.lensYellow || B.lensRed : c === S.lensRed ? B.lensRed : B.paint);
  if (!keepThin && B.thin?.count) B.thin.transferTo(family);
  if (!keepGrating && B.grating?.count) B.grating.transferTo(() => B.galvanised);
}

function buildRotorParts(spec, pitchDeg, meta) {
  const B = newBuilders('paint thin');
  // Hero LOD blades stay opaque; distant LODs draw them as thin features (>= 1.5 px, alpha = coverage).
  buildBlades(spec.near ? B.paint : B.thin, spec.blade, pitchDeg, meta);
  buildSpinner(B.paint, spec.spinner);
  return B;
}

// Measurements taken from the built geometry (not echoed from the spec). Dev builds only.
function measure(Bs, Bn, Br, meta) {
  const range = builderPositions;
  const bbox = (pts) => new THREE.Box3().setFromPoints(pts);
  const radius = (pts) => Math.max(...pts.map((p) => Math.hypot(p.x, p.z)));
  const tower = range(Bs.paint, 'tower'), tb = bbox(tower);
  const ringD = (y) => 2 * radius(tower.filter((p) => Math.abs(p.y - y) < 1e-4));
  const dims = { towerTopY: tb.max.y, towerBaseY: tb.min.y, towerBaseD: ringD(tb.min.y), towerTopD: ringD(tb.max.y) };
  dims.tpD = 2 * radius(range(Bs.yellow, 'tpShell'));
  dims.tpTopY = bbox(range(Bs.yellow, 'tpFlange')).max.y;
  dims.deckY = bbox(range(Bs.grating, 'deck')).max.y;
  dims.railTopY = Bs.thin.ranges.rails ? bbox(range(Bs.thin, 'rails')).max.y : null;
  dims.waterlineRadius = radius(range(Bs.growth, 'growthBand'));
  const nb = bbox(range(Bn.paint, 'nacelleBody'));
  dims.nacelleLength = nb.max.z - nb.min.z; dims.nacelleWidth = nb.max.x - nb.min.x; dims.nacelleHeight = nb.max.y - nb.min.y;
  // the L-864 range holds the masts, housings and domes: the dome tops (centre + 0.15) are the highest points
  if (Bn.thin.ranges.l864?.[1] > Bn.thin.ranges.l864[0]) dims.l864Y = bbox(range(Bn.thin, 'l864')).max.y - 0.15 + dims.towerTopY;
  // Rotor: spinner and blade tips, taken into the yaw frame (spin 0) to measure lengths along it.
  const rotorToYaw = new THREE.Matrix4().makeTranslation(HUB_OFFSET.x, HUB_OFFSET.y, HUB_OFFSET.z).multiply(new THREE.Matrix4().makeRotationX(-TILT));
  const spinner = range(Br.paint, 'spinner');
  dims.spinnerD = 2 * Math.max(...spinner.map((p) => Math.hypot(p.x, p.y)));
  dims.overallNacelleLength = Math.max(...spinner.map((p) => p.clone().applyMatrix4(rotorToYaw).z)) - bbox(range(Bn.grating, 'heliDeck')).min.z;
  const Bb = Br.thin.ranges.blade0 ? Br.thin : Br.paint;       // blades are thin features on distant LODs
  const tips = [0, 1, 2].map((i) => range(Bb, `blade${i}`).reduce((a, p) => (Math.hypot(p.x, p.y) > Math.hypot(a.x, a.y) ? p : a)));
  dims.tipRadius = Math.max(...tips.map((p) => Math.hypot(p.x, p.y)));
  dims.rotorDiameter = 2 * dims.tipRadius;
  const tc = tips.reduce((a, p) => a.add(p), V3()).multiplyScalar(1 / 3);
  dims.tipCentroidOffset = Math.hypot(tc.x, tc.y);           // ~0: blades are symmetric about the hub
  const bladeAxis = V3(0, Math.cos(CONE), Math.sin(CONE));
  dims.bladeLength = Math.max(...range(Bb, 'blade0').map((p) => p.dot(bladeAxis))) - BLADE_ROOT_R;
  let maxChord = 0;                                            // largest section diameter over blade 0's rings
  const P = Bb.A.position, d = (i, j) => Math.hypot(P[3 * i] - P[3 * j], P[3 * i + 1] - P[3 * j + 1], P[3 * i + 2] - P[3 * j + 2]);
  for (const ring of meta.rings) if (ring.s >= 0) for (const i of ring.ids) for (const j of ring.ids) maxChord = Math.max(maxChord, d(i, j));
  dims.bladeMaxChord = maxChord;
  dims.hubHeight = dims.towerTopY + HUB_OFFSET.y;
  // Tip heights with the rotor tilted, over a turn: highest and lowest blade tip above MSL.
  const tipY = [];
  for (let k = 0; k < 360; k += 2) for (const t of tips) tipY.push(t.clone().applyMatrix4(rotorToYaw.clone().multiply(new THREE.Matrix4().makeRotationZ(k * DEG))).y + dims.towerTopY);
  dims.tipHeight = Math.max(...tipY); dims.lowestTip = Math.min(...tipY);
  if (Bs.thin.ranges.landingTubeL) {
    const L = range(Bs.thin, 'landingTubeL'), R = range(Bs.thin, 'landingTubeR');
    const axisOf = (pts) => pts.reduce((a, p) => a.add(V3(p.x, 0, p.z)), V3()).multiplyScalar(1 / pts.length);
    const cL = axisOf(L), cR = axisOf(R);
    dims.landingTubeD = 2 * Math.max(...L.map((p) => Math.hypot(p.x - cL.x, p.z - cL.z)));
    dims.landingTubeSpacing = Math.hypot(cL.x - cR.x, cL.z - cR.z);
  }
  return dims;
}

let SCALE_REGISTERED = false;
function registerTurbineScale(dims) {
  if (SCALE_REGISTERED) return;
  SCALE_REGISTERED = true;
  const reg = (name, axis, value, ref = SCALE_TABLE[name]) => registerScale({ name, measure: () => ({ x: 0, y: 0, z: 0, [axis]: value }),
    expect: { axis, metres: ref.metres, tolerance: ref.tolerance }, source: 'src/turbine/turbine.js (measured from the LOD 0 geometry)' });
  const axes = { x: 'rotorDiameter bladeMaxChord towerBaseD towerTopD tpD nacelleWidth spinnerD', y: 'hubHeight bladeLength towerTopY tpTopY deckY railTopY nacelleHeight', z: 'nacelleLength overallNacelleLength' };
  for (const [axis, names] of Object.entries(axes)) for (const k of names.split(' ')) reg(`turbine.${k}`, axis, dims[k]);
  reg('boatLanding.tubeD', 'x', dims.landingTubeD);
  reg('boatLanding.spacing', 'x', dims.landingTubeSpacing);
  // L-864 lamp centres on their masts (config NIGHT_LIGHTS.l864.y / TURBINE.stack.l864; not in SCALE_TABLE).
  reg('turbine.l864Y', 'y', dims.l864Y, { metres: NIGHT_LIGHTS.l864.y, tolerance: 0.1 });
}

// Every part of every frame gets one bounding sphere, centred where the spin axis crosses the tower axis (a
// point no yaw or spin moves) and holding the whole turbine. Farm culls per instance, so the sphere only sets
// three's transparent sort key: all of a turbine's parts then sort at one depth and draw in part order (thin
// features, ID decals, the see-through grating last) under either depth convention. With per-part centres
// they sorted by depth, an order r180 inverts under reversed-Z (it sorts by clip-space z): the grating then
// drew before the rails and posts behind it.
const SORT_Y = HUB_OFFSET.y - HUB_OFFSET.z * Math.tan(TILT);   // 4.34 m above the yaw bearing
const SORT_CENTRE = { static: [0, YAW_Y + SORT_Y, 0], nacelle: [0, SORT_Y, 0], rotor: [0, 0, -HUB_OFFSET.z / Math.cos(TILT)] };
const PART_NAME = { growth: 'marineGrowth', dark: 'darkSteel', id: 'idMarkings' };
function toParts(B, frame, lod) {
  const mats = createTurbineMaterials(), parts = [];
  for (const [key, b] of Object.entries(B)) {
    if (!b.count) continue;
    const name = PART_NAME[key] || key, geometry = b.build(), lens = key.startsWith('lens');
    geometry.boundingSphere = new THREE.Sphere(V3(...SORT_CENTRE[frame]), 200);
    geometry.name = `turbine.lod${lod}.${frame}.${name}`;
    parts.push({ name, geometry, material: mats[key === 'id' ? 'idPaint' : key], castShadow: key !== 'id' && !lens, receiveShadow: !lens });
  }
  return parts;
}

/**
 * Build one LOD of the turbine as part lists in local frames (Farm instances them).
 * @param {{ lod?: 0|1, pitchDeg?: number }} opts  pitchDeg: blade pitch toward feather (90 = feathered)
 */
export function buildTurbine({ lod = 0, pitchDeg = 0 } = {}) {
  const spec = LODS[clamp(lod | 0, 0, LODS.length - 1)], meta = {};
  const Bs = newBuilders('paint yellow galvanised growth dark lensYellow lensRed thin id grating');
  const Bn = newBuilders('paint yellow galvanised dark lensRed thin grating');
  buildTower(Bs.paint, spec);
  buildFoundation(spec, Bs, meta);
  buildIdMarkings(Bs.id, spec, meta);
  buildNacelle(spec, Bn);
  const Br = buildRotorParts(spec, pitchDeg, meta);
  // Dev builds measure the built geometry and register it for the scale report. The kirt.lol build defines
  // globalThis.NJOW_DEV = false, so these tests fold to false and the measuring code is dropped.
  const dims = globalThis.NJOW_DEV !== false ? measure(Bs, Bn, Br, meta) : { ...DESIGN_DIMS };
  if (globalThis.NJOW_DEV !== false && lod === 0) registerTurbineScale(dims);
  foldThinParts(Bs, true, spec.near);
  foldThinParts(Bn, spec.near, spec.near);
  const out = {
    lod, static: toParts(Bs, 'static', lod), nacelle: toParts(Bn, 'nacelle', lod), rotor: toParts(Br, 'rotor', lod),
    frames: { yawBearingY: YAW_Y, hubOffset: HUB_OFFSET.clone(), tiltDeg: T.tiltDeg, coneDeg: T.coneDeg },
    lights: {
      aviation: L864_POS.map(([x, y, z]) => V3(x, y, z)),      // L-864, yaw frame (lamp centres)
      midMast: meta.midMast,                                     // L-810, static frame
      marine: meta.marine,                                       // yellow lanterns, static frame
      sign: meta.sign,                                           // painted ID patches, static frame
    },
    landingTubes: meta.landingTubes,                             // [{x, z, radius}] static frame, for foam
    dims,
  };
  if (globalThis.NJOW_DEV !== false) {
    const tris = (f) => out[f].reduce((n, p) => n + p.geometry.index.count / 3, 0);
    out.triangles = { static: tris('static'), nacelle: tris('nacelle'), rotor: tris('rotor') };
    out.triangles.total = out.triangles.static + out.triangles.nacelle + out.triangles.rotor;
  }
  return out;
}

/** Rotor parts only (e.g. a feathered variant for idle turbines: buildRotor({ lod, pitchDeg: 90 })). */
export function buildRotor({ lod = 0, pitchDeg = 0 } = {}) {
  return toParts(buildRotorParts(LODS[clamp(lod | 0, 0, LODS.length - 1)], pitchDeg, {}), 'rotor', lod);
}

/**
 * Attach per-instance turbine indices to the ID part's geometry (index into layoutPositions() /
 * TURBINE_IDS; 0 = F01). Replaces the default per-vertex zeros; returns the InstancedBufferAttribute.
 * Fill attr.array[instanceSlot] = turbineIndex and set attr.needsUpdate = true when slots change.
 */
export function attachTurbineIndex(geometry, count) {
  const attr = new THREE.InstancedBufferAttribute(new Float32Array(count), 1).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('aTurbineIndex', attr);
  return attr;
}

/** Compass azimuth the rotor faces (the wind-from direction) -> yaw-frame rotation.y (radians). */
export function yawForRotorAzimuth(azDeg) { return Math.PI - azDeg * DEG; }

const _mT = new THREE.Matrix4(), _mR = new THREE.Matrix4(), _mS = new THREE.Matrix4();
/**
 * Matrices for one turbine: static (translation), nacelle (yaw), rotor (hub, tilt, spin).
 * spinRad = -(omega * t + phase) turns the rotor clockwise seen from upwind (SCENE-SPEC §4.9).
 */
export function composeTurbineMatrices({ x = 0, y = 0, z = 0, yawRad = 0, spinRad = 0 }, out = {}) {
  const S = (out.static ||= new THREE.Matrix4()), N = (out.nacelle ||= new THREE.Matrix4()), R = (out.rotor ||= new THREE.Matrix4());
  S.makeTranslation(x, y, z);
  N.makeRotationY(yawRad).setPosition(x, y + YAW_Y, z);
  R.copy(N).multiply(_mT.makeTranslation(HUB_OFFSET.x, HUB_OFFSET.y, HUB_OFFSET.z)).multiply(_mR.makeRotationX(-TILT)).multiply(_mS.makeRotationZ(spinRad));
  return out;
}

// Geometry helpers shared with substation.js (same author, same conventions).
export const GEOM = { loft, fan, revolve, sweep, sweepRect, circleSection, tube, box, aabb, bar, importGeometry, railRun, gratingSlab, lensDome, L864_DOME, newBuilders };
