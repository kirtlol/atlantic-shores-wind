// Offshore wind vessels (owner: vessels): a crew transfer vessel (CTV) shuttling between the hero
// and a nearby turbine, and a service operation vessel (SOV) on dynamic positioning 13.4 km SE.
//
// Contract (ARCHITECTURE.md "life/vessels.js", SCENE-SPEC §14, config VESSELS):
//   new Vessels(ctx)               builds both vessels under vessels.root in ctx.scene (after Farm)
//   vessels.update(dt, t, camera)  route, seakeeping, wakes, spray, lights (before ocean.update)
//   vessels.ctv / vessels.sov      see CrewTransferVessel / ServiceOperationVessel below
//   vessels.setEnabled(on), setQuality(q), dispose()
//   vessels.keepOuts(cameraPos, out)  oriented keep-out boxes of hulls + superstructures (world)
//   vessels.clampCamera(p, clearance) pushes a camera position out of them (true if moved)
//   vessels.ctv.eye(out) / .seek(name) foredeck eye point for the deck view (main.js rides on it); jump the shuttle
//   vessels.kelvinSources()         the CTV's wave sources, also sent to ocean.setWaveSources() each frame
//
// Scale: every size is built in metres from config VESSELS and measured back from the geometry
// (registerScale ctv.* / sov.*, dev builds). Vessel frame: origin on the design waterline
// amidships, +z bow, +y up, +x port (so -x is starboard). Heading H (compass) is a rotation of
// π - H about +y.
//
// Motion is a pure function of animation time t for the route (so ?t= and frozen frames are
// reproducible), plus damped seakeeping driven by ocean.getSurface at several hull points.
// Wakes are the ocean's to draw; this module sends physically sized inputs: two transom jets and
// the tunnel's tail as short-lived tumbling white clumps (merging and gone within two boat lengths)
// over long lace trails with aeration (the turquoise propwash) and slick, the white water along the
// hulls, the breaking bow-wave shoulders along the Kelvin arms with caps on the crests of the ocean's
// own wake field (the first divergent crests near the hull too), and that wave field itself via
// setWaveSources(). Beyond the ocean's ±256 m foam map a flat decal continues the same density law.
// On a landing: the lead's subtle low-thrust stern wash (_holdWash, HOLD) and a faint collar of
// broken water round the forefeet. Spray: the bow wave's white water and whisker sheet along each
// chine (mesh), velocity-stretched drops off the chines and in the jets' low rooster tails
// (instanced); the hull carries a wet band where the sea reaches up it.
// Windows show a parallax interior (seats, console, cabins) lit by daylight or the room lamps.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { U, LAYER_REFLECT, curvatureDrop, azimuthToDir, mulberry32, registerScale } from '../shared.js';
import { VESSELS, TURBINE, SEA, LOOK, SUN, QUALITY, layoutPositions } from '../config.js';
import { applyAtmosphere } from '../env/fog.js';
import { PhotometricLamps, LAMP_BEAM, LAMP_XY, exposedScale, sunElevationDeg, NO_ATMOSPHERE_GLSL, HASH_GLSL } from '../env/land.js';

const DEG = Math.PI / 180;
const TAU = 2 * Math.PI;
const SCENE_LUX = LOOK.sceneUnitLux;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const lin = (hex) => new THREE.Color().setStyle(hex).toArray();
const unitLum = (c) => { const y = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; return c.map((v) => v / Math.max(y, 1e-6)); };
const v3 = (a) => (a.isVector3 ? a : new THREE.Vector3(...a));
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const glslVec = (a) => `vec3(${a.map((v) => v.toFixed(4)).join()})`;
// a point in a vessel's frame (lx port, lz forward) -> world (x, z) for a pose { x, z, heading }
const onHull = (P, lx, lz) => { const h = P.heading * DEG, s = Math.sin(h), c = -Math.cos(h); return { x: P.x + s * lz + c * lx, z: P.z + c * lz - s * lx }; };

// ================================================================================================
// Constants (SCENE-SPEC section in brackets; ESTIMATED where no source gives the number)
// ================================================================================================
const C = VESSELS.ctv, S = VESSELS.sov;

// CTV hull [14]: StratCat 27, 27.0 x 8.9 m overall, 1.5 m draft. Overall length includes the
// 0.5 m bow fender; overall beam includes the side D-fenders.
// [14] 0.5 x 3 m; ESTIMATED 2.45 m tall from push-on photos: down to ~1 m above the waterline and
// standing 0.6 m proud of the foredeck (the crew steps over it onto the ladder), so the bow is a black
// rubber block from any side and from the deck
const CTV_FENDER = { thick: 0.5, width: 3.0, y0: 1.0, y1: 3.45 };
const CTV_BOW_Z = C.length / 2;                                         // fender face (local z)
const CTV_STEM_Z = CTV_BOW_Z - CTV_FENDER.thick;                        // stems of the demi-hulls
const CTV_STERN_Z = -C.length / 2;                                      // stern fender face
const CTV_TRANSOM_Z = CTV_STERN_Z + 0.14;
const CTV_HULL_X = 3.10;               // demi-hull centrelines (tunnel ≈ 4 m)
const CTV_HULL_W = 1.10;               // demi-hull half-width at the deck
const CTV_SIDE_FENDER_R = 0.27;        // D-fender depth, 0.03 m of it inside the hull: overall beam = 2 (3.10 + 1.10 + 0.24) = 8.88 m
const CTV_DECKHOUSE = { z0: -6.0, z1: 3.2, halfW: 3.4, roof: 4.6 };      // foredeck 9.8 m long
const CTV_WHEELHOUSE = { z0: -2.2, z1: 2.2, halfW: 2.6, roof: C.wheelhouseRoofY };
const CTV_MAST_Z = -0.8;
const CTV_EYE_LOCAL = [0, C.foredeckY + 1.7, 3.9];                       // standing on the foredeck (SCENE-SPEC §7 deck preset)

// CTV operation [14]. Speeds from config; manoeuvring limits ESTIMATED for a 27 m planing cat.
const CTV_TRANSIT = C.transitSpeed;        // 11.3 m/s (22 kn)
const CTV_APPROACH = C.approachSpeed;      // 2.5 m/s
const CTV_CONTACT_SPEED = 0.35;            // m/s when the fender touches
const CTV_ACCEL = 0.7, CTV_DECEL = 0.6;    // m/s² along the path
const CTV_LAT_ACCEL = 1.4;                 // m/s² in turns
const CTV_TURN_RADIUS = 26;                // m, low-speed turn after backing off
const CTV_BACK_OFF = 32;                   // m astern off the landing before turning
const CTV_REVERSE_SPEED = 1.2, CTV_REVERSE_ACCEL = 0.25;
const CTV_APPROACH_LINE = 260;             // m of straight final approach on the landing axis
const CTV_PARTNER = { di: 3, dj: 1 };      // G04: 3.6 km ESE, outside the drone reference frame
const FENDER_PRELOAD = 0.10;               // m of fender compression while pushing on
const BOW_SLIP = 0.22;                     // fraction of the free bow heave that gets past the fender friction

// SOV [14]: ECO Edison / ECO Liberty class, 80 x 19 m, draft 6 m.
const SOV_HEADING = SEA.windFromDeg;       // bow into the wind on DP
const SOV_GANGWAY_PIVOT = [-6.5, S.gangwayTowerTopY, -2.0];         // pedestal top, starboard side, amidships
const SOV_GANGWAY = [20.0, 14.0];          // m: fixed outer + telescoping inner section (21-34 m working range)
const SOV_STANDOFF = 36;                   // m from SOV centreline to the TP axis (gangway ~21 m)
const SOV_UPWIND_SHIFT = 8;                // m toward the wind (SCENE-SPEC §14 "upwind side")

// Night lights [14] (COLREGS Annex I; intensities from config). LED work floods: wide, soft beams
// (ESTIMATED 100 W class: ~4000 cd peak, 110-130° full beam).
const NAV_ON_BELOW_DEG = -SUN.angularRadiusRad / DEG;   // sunset -> sunrise (upper limb)
const FLOODS_ON_BELOW_DEG = -3;
const FLOOD_CD = { ctv: 4000, sov: 3000 };
// The CTV's two bow floods also light the boat landing it pushes on: one real SpotLight (created at
// construction so every program is compiled with it; zero intensity unless it is needed). Penumbra
// 1 = the whole cone is soft, so the TP shows the beam's falloff and inverse square, no spot edge.
const LANDING_SPOT = { cd: 2 * FLOOD_CD.ctv, angleDeg: 58, range: 90 };
const LANTERN_AREA = { ctv: 0.012, sov: 0.02 };          // m², projected lens area of an LED nav lantern
// Interior lighting at night (ESTIMATED, cd/m² of the lit back wall): the CTV saloon on its warm LED
// ceiling lights (~150 lx on 0.4-albedo trim: ~20 cd/m²; the technicians ride in it, the wheelhouse
// above is screened off), SOV cabins behind curtains (45 % occupied, curtains in 55 %), bridges kept
// dark for night vision (< 1 lx: ~0.02 cd/m² on the trim) apart from the glow the night-mode displays
// (~1 cd/m², facing the helm) throw on the console, ~0.08 cd/m² seen from outside. At tens of cd/m²
// the post's night shoulder keeps the saloon's hue instead of clipping it to white.
const ROOM_CDM2 = { ctv: 20, sov: 25 }, SCREEN_CDM2 = 0.08;
const WARM = unitLum(lin('#ffc98a'));                    // ~3000 K LED

// Wakes [14] (config VESSELS.wake; ESTIMATED from aerial footage of crew boats at 20-25 kn). Each
// waterjet throws out solid white water (the transom boil mound, then the ocean's first second of
// fresh foam) that breaks within 10-15 m into tumbling clumps of white water with turquoise between
// them (CHURN: a clump every few metres, widening ~0.8 m/s a side), so the two jets and the tunnel's
// tail merge within about a boat length and the white is gone within two; behind that only lace
// streaks, the turquoise bubble plume and the glassy slick remain (LACE: ~150-200 m of lace and
// plume, the slick for minutes). The ocean owns the look (white water e-folding in 9 s, then lace in
// 0.75 x life, the foam faded out over the last 30 % of a trail's life); these are its inputs, laid
// every metre: birth width, lateral spread, foam per point, aeration, slick.
const WAKE_LIFETIME_S = 45;                // track history kept for the wake (s)
const CHURN = { width: 2.0, spread: 0.8, life: 4.5 };                 // white clumps fading out 35-50 m astern
const LACE = { width: 1.6, spread: 0.45, life: 45, aerationLife: 20 };
const ARM_MAX_AGE_S = 9;                   // breaking crests along the Kelvin arms: ~100 m at 22 kn
const ARM_SHOULDER_S = 2.4;
const TRAIL_MAP_HALF = 256;                // ocean-effects.js foam extent (±256 m, 5 % edge fade)
const DECAL_LIFT = 0.05;                   // far wake decal above the mean surface (m): crests hide it
// m, Kelvin wave amplitude at planing speed (ocean-wake.js scales it with speed): 0.5 = ~1 m crest to
// trough within a boat length of the hull, the high side of fast-ferry wash data scaled to 27 m (ESTIMATED)
const CTV_WAVE_AMP = 0.5;
const HULL_TRAILS = ['vessels.ctv.hullP', 'vessels.ctv.hullS', 'vessels.ctv.tunnel'];     // LACE
const CHURN_TRAILS = ['vessels.ctv.churnP', 'vessels.ctv.churnS', 'vessels.ctv.churnT'];
const SIDE_TRAILS = ['vessels.ctv.sideP', 'vessels.ctv.sideS', 'vessels.ctv.sideTP', 'vessels.ctv.sideTS'];
const BOW_TRAILS = ['vessels.ctv.hold.bowP', 'vessels.ctv.hold.bowS'];
const ARM_TRAILS = ['vessels.ctv.armP', 'vessels.ctv.capP', 'vessels.ctv.armS', 'vessels.ctv.capS'];
// Holding on a landing (ESTIMATED from CTV push-on footage): the boat only needs ~20-30 % thrust
// to keep the fender loaded, so what shows astern is a low turbulent boil, not a fan of white
// water: a short wandering bubble stream behind each jet that pulses with the surge, small eddies
// shed off both quarters that spin and drift aft, and now and then a soft upwelling where a vortex
// reaches the surface. Lead fix 2026-09-30 after Kirt's review ("not that visible triangle").
const HOLD_JET_TRAILS = ['vessels.ctv.hold.jetP', 'vessels.ctv.hold.jetS'];
const HOLD_EDDY_TRAILS = Array.from({ length: 6 }, (_, i) => `vessels.ctv.hold.eddy${i}`);
const HOLD = {
  flow: 1.4,                 // m/s: speed of the wash leaving a jet at holding thrust
  jetLength: 9,              // m of visible bubble stream astern of each transom
  jetFoam: 0.16,             // peak foam: white flecks, not white water
  jetAeration: 0.4,          // turquoise bubble cloud, faint
  eddyLife: 4.5,             // s from shedding to dissolving
  eddyRadius: [0.5, 1.2],    // m, grows as it drifts aft
  eddyFoam: 0.13,
  eddySpin: 2.4,             // rad/s
  boilEvery: 1.7,            // s between surfacing vortex boils (alternating jets)
  asternFoam: 0.28,          // backing off: the wash runs forward under the tunnel, a little harder
};

// Bow spray (ESTIMATED from CTV footage): at planing speed each bow shoulder throws a thin,
// translucent sheet of water out and up along the outer chine, 0.5-1.5 m high, that breaks into
// fine drops and falls back within ~1 s: ~70 % in the sheet (ribbon mesh), ~30 % in 1-6 cm drops,
// ~5600 drops/s at 22 kn (70 % off the outer chines). 30 % of the slots are the jets' low rooster
// tails: a dense feather of churned water thrown 0.1-0.8 m up behind each transom.
// Each drop slot re-launches every SPRAY_CYCLE_S.
const SPRAY_MAX = 14336;
const SPRAY_CYCLE_S = 1.8;
const SPRAY_DRAG = 0.9;                    // 1/s: g / terminal velocity (~11 m/s for cm-scale drops)

// ================================================================================================
// Geometry kit: primitives accumulated per material bucket, merged at the end
// ================================================================================================
// Every vessel is three draws: 'hull' (the livery shader), 'paint' (all other opaque surfaces;
// colour, roughness and metalness per vertex) and 'glass' (windows with their interiors).
class Kit {
  constructor() { this.buckets = { hull: [], paint: [], glass: [] }; }

  // Adds `geo` (consumed) with constant per-vertex attributes: colour, aRM = (roughness, metalness),
  // aWin = (night glow weight | surface pattern, cabin draw). Glass keeps its aPane (see framedPane).
  add(bucket, geo, { colour = [1, 1, 1], rough = 0.5, metal = 0, glow = 0, cabins = 0, pattern = 0 } = {}) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (g !== geo) geo.dispose();
    for (const k in g.attributes) if (!/^(position|normal|aPane)$/.test(k)) g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    const n = g.attributes.position.count;
    const fill = (vals) => { const a = new Float32Array(n * vals.length); for (let i = 0; i < n; i++) a.set(vals, i * vals.length); return new THREE.BufferAttribute(a, vals.length); };
    g.setAttribute('color', fill(colour));
    g.setAttribute('aRM', fill([rough, metal]));
    g.setAttribute('aWin', fill([glow || pattern, cabins]));
    if (bucket !== 'glass') g.deleteAttribute('aPane');
    else if (!g.attributes.aPane) g.setAttribute('aPane', fill([0, 0, 1, 3.3]));
    this.buckets[bucket].push(g);
    return this;
  }

  // The primitives below go to the 'paint' bucket unless told otherwise.
  // Axis-aligned box from ranges.
  box([x0, x1], [y0, y1], [z0, z1], opts) {
    return this.add('paint', new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), opts);
  }

  // Cylinder between two points (rails, posts, masts, pipes); a, b: Vector3 or [x, y, z].
  rod(a, b, r, opts, seg = 8, rTop = r) {
    a = v3(a); b = v3(b);
    const d = new THREE.Vector3().subVectors(b, a), len = d.length();
    if (len < 1e-4) return this;
    const g = new THREE.CylinderGeometry(rTop, r, len, seg, 1, false).translate(0, len / 2, 0)
      .applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), d.normalize())).translate(a.x, a.y, a.z);
    return this.add('paint', g, opts);
  }

  // Hexahedron from 8 corners (Vector3 or [x, y, z]): 0-3 bottom, 4-7 top. Faces are wound outward
  // from the centroid, so raked fronts, tumblehome and tapers come out right whatever the order.
  hexa(corners, opts, bucket = 'paint') {
    const c = corners.map(v3), centre = c.reduce((s, v) => s.add(v), V3(0, 0, 0)).multiplyScalar(1 / 8);
    const pos = [], nor = [];
    for (const f of [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]]) {
      const [a, b, cc, d] = f.map((i) => c[i]);
      const n = new THREE.Vector3().subVectors(cc, a).cross(new THREE.Vector3().subVectors(d, b)).normalize();
      const flip = n.dot(a.clone().add(b).add(cc).add(d).multiplyScalar(0.25).sub(centre)) < 0;
      if (flip) n.negate();
      for (const v of flip ? [a, cc, b, a, d, cc] : [a, b, cc, a, cc, d]) { pos.push(v.x, v.y, v.z); nor.push(n.x, n.y, n.z); }
    }
    return this.add(bucket, geometry(pos, nor), opts);
  }

  // Single-sided quad a-b-c-d facing n (its flat normal is the face's, flipped to agree with n).
  quad([a, b, c, d], n, opts) {
    const f = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(d, a)).normalize(), flip = f.dot(n) < 0;
    if (flip) f.negate();
    const pos = [], nor = [];
    for (const v of flip ? [a, c, b, a, d, c] : [a, b, c, a, c, d]) { pos.push(v.x, v.y, v.z); nor.push(f.x, f.y, f.z); }
    return this.add('paint', geometry(pos, nor), opts);
  }

  // Rounded block: x ±halfW (top ±halfWTop), y y0..y1, z from zb (bottom) to zt (top) for sloped
  // fronts and backs, every edge rounded with radius r. A RoundedBoxGeometry deformed linearly in
  // height; its analytic normals go through the inverse transpose of the deformation.
  rblock(bucket, { halfW, halfWTop = halfW, y0, y1, zb0, zb1, zt0 = zb0, zt1 = zb1, x = 0 }, opts, r = 0.12, seg = 2) {
    const D = zb1 - zb0, Hh = y1 - y0;
    const g = new RoundedBoxGeometry(2 * halfW, Hh, D, seg, Math.min(r, 0.45 * Math.min(2 * halfW, Hh, D)));
    const p = g.attributes.position, n = g.attributes.normal, J = new THREE.Matrix3(), N = V3(0, 0, 0);
    const sx = (v) => (halfW + (halfWTop - halfW) * v) / halfW, dsx = (halfWTop - halfW) / halfW / Hh;
    const dA = (zt0 - zb0) / Hh, dB = (zt1 - zb1 - zt0 + zb0) / Hh;
    for (let i = 0; i < p.count; i++) {
      const lx = p.getX(i), v = (p.getY(i) + Hh / 2) / Hh, u = (p.getZ(i) + D / 2) / D;
      const A = zb0 + (zt0 - zb0) * v, B = zb1 + (zt1 - zb1) * v - A;
      p.setXYZ(i, x + lx * sx(v), y0 + v * Hh, A + u * B);
      J.set(sx(v), lx * dsx, 0, 0, 1, 0, 0, dA + u * dB, B / D).invert().transpose();   // n' = J^-T n
      N.fromBufferAttribute(n, i).applyMatrix3(J).normalize();
      n.setXYZ(i, N.x, N.y, N.z);
    }
    return this.add(bucket, g, opts);
  }

  // Window: a rounded-rectangle pane filling the quad a-b-c-d (a-b bottom, d-c top; bilinear, so
  // raked faces work) plus a dark gasket/frame ring of width fw standing slightly proud of the wall.
  // n = outward normal. glassOpts.room = [sill (m, floor below the pane bottom), kind, depth (m)]
  // describes the interior (see GLASS_GLSL); each glass vertex carries aPane = (u, v, sill, kind + depth/10).
  framedPane(glassBucket, a, b, c, d, n, glassOpts, { cr = 0.1, fw = 0.06, frame = PAINT.frame, off = 0.02, proud = 0.035 } = {}) {
    const W = a.distanceTo(b), H = a.distanceTo(d), nn = n.clone().normalize();
    const [sill, kind, depth] = glassOpts.room || [1, 3, 3];
    const map = (u, v, o) => { const s = u / W, t = v / H; return V3(0, 0, 0).addScaledVector(a, (1 - s) * (1 - t)).addScaledVector(b, s * (1 - t)).addScaledVector(c, s * t).addScaledVector(d, (1 - s) * t).addScaledVector(nn, o); };
    const rr = (P, x0, y0, x1, y1, rad) => {
      rad = Math.max(0.001, Math.min(rad, 0.5 * (x1 - x0), 0.5 * (y1 - y0)));
      P.moveTo(x0 + rad, y0);
      for (const [cx, cy, a0] of [[x1 - rad, y0 + rad, -0.5], [x1 - rad, y1 - rad, 0], [x0 + rad, y1 - rad, 0.5], [x0 + rad, y0 + rad, 1]]) P.absarc(cx, cy, rad, a0 * Math.PI, (a0 + 0.5) * Math.PI, false);
      return P;
    };
    const emit = (bucket, shape, o, opts) => {
      const sg = new THREE.ShapeGeometry(shape, cr >= 0.2 ? 4 : 2), sp = sg.attributes.position, idx = sg.index.array;
      const pos = [], nor = [], pane = [];
      for (let k = 0; k < idx.length; k += 3) {
        const I = [idx[k], idx[k + 1], idx[k + 2]], P = I.map((i) => map(sp.getX(i), sp.getY(i), o));
        const f = new THREE.Vector3().subVectors(P[1], P[0]).cross(new THREE.Vector3().subVectors(P[2], P[0]));
        for (const j of f.dot(nn) >= 0 ? [0, 1, 2] : [0, 2, 1]) { pos.push(P[j].x, P[j].y, P[j].z); nor.push(nn.x, nn.y, nn.z); pane.push(sp.getX(I[j]), sp.getY(I[j]), sill, kind + depth / 10); }
      }
      sg.dispose();
      const g = geometry(pos, nor);
      if (bucket === 'glass') g.setAttribute('aPane', new THREE.Float32BufferAttribute(pane, 4));
      this.add(bucket, g, opts);
    };
    emit(glassBucket, rr(new THREE.Shape(), fw / 2, fw / 2, W - fw / 2, H - fw / 2, Math.max(cr - fw / 2, 0.01)), off, glassOpts);
    if (fw > 0) {
      const ring = rr(new THREE.Shape(), 0, 0, W, H, cr);
      ring.holes.push(rr(new THREE.Path(), fw, fw, W - fw, H - fw, Math.max(cr - fw, 0.01)));
      emit('paint', ring, proud, frame);
    }
    return this;
  }

  merged() {
    const out = {};
    for (const [k, list] of Object.entries(this.buckets)) {
      out[k] = list.length ? mergeGeometries(list) : null;
      list.forEach((g) => g.dispose());
      if (out[k]) { out[k].computeBoundingBox(); out[k].computeBoundingSphere(); }
    }
    return out;
  }
}

function geometry(pos, nor, idx) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  if (nor) g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  if (idx) { g.setIndex(idx); g.computeVertexNormals(); }
  return g;
}

// Surface through a list of stations (each { z, pts: [[x, y] or [x, y, z], ...] }), smooth along and across.
function loft(stations) {
  const nP = stations[0].pts.length, pos = [], idx = [];
  for (const st of stations) for (const q of st.pts) pos.push(q[0], q[1], q[2] ?? st.z);
  for (let s = 0; s < stations.length - 1; s++) for (let p = 0; p < nP - 1; p++) {
    const a = s * nP + p, c = a + nP;
    idx.push(a, c, a + 1, a + 1, c, c + 1);
  }
  return geometry(pos, null, idx);
}

// Flat cap (fan around the centroid) closing a ring of [x, y, z?] points at z.
function capFan(z, pts) {
  const n = pts.length, pos = [0, 0, 0], idx = [];
  for (const q of pts) { const p = [q[0], q[1], q[2] ?? z]; p.forEach((v, i) => { pos.push(v); pos[i] += v / n; }); }
  for (let p = 0; p < n; p++) idx.push(0, ((p + 1) % n) + 1, p + 1);
  return geometry(pos, null, idx);
}

// Makes a surface face outward: `outwardAt(x, y, z)` returns the approximate outward direction at a
// point of the surface; if most normals disagree, the winding is flipped.
function orientOutward(g, outwardAt) {
  const p = g.attributes.position, n = g.attributes.normal;
  let score = 0;
  for (let i = 0; i < p.count; i++) {
    const [dx, dy, dz] = outwardAt(p.getX(i), p.getY(i), p.getZ(i));
    score += Math.sign(n.getX(i) * dx + n.getY(i) * dy + n.getZ(i) * dz);
  }
  if (score >= 0) return g;
  const ix = g.index.array;
  for (let i = 0; i < ix.length; i += 3) [ix[i + 1], ix[i + 2]] = [ix[i + 2], ix[i + 1]];
  g.computeVertexNormals();
  return g;
}
const UP = () => [0, 1, 0];
const AFT = () => [0, 0, -1];

// ================================================================================================
// Materials: hull livery, paint, glass; lit by the vessel's own LED floods at night
// ================================================================================================
const MAX_FLOODS = 6;
const FLOOD_GLSL = /* glsl */`
uniform vec4 uFloodP[${MAX_FLOODS}];
uniform vec4 uFloodD[${MAX_FLOODS}];
uniform vec3 uFloodC;
`;
// uFloodP: world position, w = peak intensity (scene units, cd / lux per unit); uFloodD: world aim,
// w = cos of the beam half-angle. Inverse square, cosine-weighted, the whole cone soft (LED optics).
const FLOOD_APPLY = /* glsl */`
for (int i = 0; i < ${MAX_FLOODS}; i++) {
	vec4 P = uFloodP[i], A = uFloodD[i];
	if (P.w <= 0.0) continue;
	vec3 L = (viewMatrix * vec4(P.xyz, 1.0)).xyz - geometryPosition;
	float d2 = dot(L, L);
	L *= inversesqrt(d2);
	float cone = smoothstep(A.w, 1.0, dot(-L, normalize((viewMatrix * vec4(A.xyz, 0.0)).xyz)));
	reflectedLight.directDiffuse += uFloodC * (P.w * cone * saturate(dot(geometryNormal, L)) / max(d2, 0.25)) * BRDF_Lambert(material.diffuseColor);
}
`;
const NOISE_GLSL = /* glsl */`
float vNoise(vec3 p) {
	vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
	return mix(mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x), mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y),
	           mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x), mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
// bump from a height field h (metres; world-scale slope from the screen derivatives)
vec3 vBump(vec3 pos, vec3 nrm, float h, float fd) {
	vec3 sx = dFdx(pos), sy = dFdy(pos), r1 = cross(sy, nrm), r2 = cross(nrm, sx);
	float det = dot(sx, r1) * fd;
	return normalize(abs(det) * nrm - sign(det) * (dFdx(h) * r1 + dFdy(h) * r2));
}
// box-filtered grid lines of width w (cells) at integer q: 1 on a line, fading to the mean
vec2 vLines(vec2 q, vec2 w) {
	vec2 s = max(fwidth(q), vec2(1e-4));
	return clamp((0.5 * (w + s) - abs(fract(q + 0.5) - 0.5)) / s, 0.0, 1.0) * min(w / s, vec2(1.0));
}
`;
// Hull livery and weathering in the vessel frame (metres). uLv[12], see makeLivery(): bands, stripe,
// four paints (rgb + roughness), grime, weeps, surface. ESTIMATED from CTV / SOV photos:
// algae film above the boot-top, black rubber scuffs under the fender, paint chipped to primer along
// the band edges, salt or rust weeps below the scuppers, plate seams with weld
// beads, oil-canning between frames. Everything finer than the pixel footprint fades to its mean.
const LIVERY_GLSL = /* glsl */`
uniform vec4 uLv[12];
uniform vec4 uWet;
varying vec3 vLiv;
float livBand(float y, float a, float b) { float w = max(fwidth(y), 1e-4); return smoothstep(a - w, a + w, y) - smoothstep(b - w, b + w, y); }
`;
const LIVERY_APPLY = /* glsl */`
{
	vec3 p = vLiv;
	vec4 B = uLv[0], S = uLv[1], GA = uLv[6], GB = uLv[7], WA = uLv[8], WB = uLv[9], X = uLv[11];
	float bow = smoothstep(S.y, S.w, p.z), boot1 = B.y + 0.18 * bow, sc = B.z + B.w * bow;
	float fb = 1.0 - smoothstep(B.x - fwidth(p.y), B.x + fwidth(p.y), p.y);
	float fbt = livBand(p.y, B.x, boot1);
	float fs = livBand(p.y, sc - S.x, sc + S.x) * step(p.z, S.z);
	vec3 col = mix(mix(mix(uLv[4].rgb, uLv[5].rgb, fs), uLv[3].rgb, fbt), uLv[2].rgb, fb);
	livRough = mix(mix(mix(uLv[4].w, uLv[5].w, fs), uLv[3].w, fbt), uLv[2].w, fb);
	float detail = 1.0 - smoothstep(0.05, 0.25, length(fwidth(p)));
	// the stripe's edges chipped and worn through to the primer in places (fender knocks, line chafe)
	float eD = S.x > 0.0 && p.z < S.z ? abs(abs(p.y - sc) - S.x) : 1.0;
	float chip = X.z * detail * smoothstep(0.68, 0.78, vNoise(p * vec3(5.0, 24.0, 5.0)) * 0.7 + vNoise(p * 0.8) * 0.3) * (1.0 - smoothstep(0.004, 0.03, eD * (0.5 + vNoise(p * 3.1))));
	col = mix(col, vec3(0.16, 0.17, 0.17), chip);
	float nA = vNoise(p * vec3(0.9, 3.0, 0.9)) * 0.65 + vNoise(p * vec3(4.0, 9.0, 4.0)) * 0.35, up = p.y - boot1;
	float algae = GA.y * step(0.0, up) * (1.0 - smoothstep(0.0, GA.x * (0.35 + 1.1 * nA), up)) * (0.55 + 0.45 * smoothstep(0.3, 0.7, nA));
	col = mix(col, vec3(0.05, 0.047, 0.02), algae);
	float nS = vNoise(p * vec3(2.0, 14.0, 0.7)) * 0.7 + vNoise(p * vec3(9.0, 30.0, 3.0)) * 0.3;
	float scuff = GA.w * smoothstep(GA.z - 0.7, GA.z - 0.3, p.y) * (1.0 - smoothstep(GA.z - 0.05, GA.z, p.y)) * smoothstep(0.58, 0.74, nS) * mix(0.4, 1.0, detail);
	col = mix(col, vec3(0.012), scuff);
	// weeps below the scuppers: about two in three weep, each its own width and length, broken up
	float k = floor((p.z - WA.z) / WB.x + 0.5), zk = WA.z + WB.x * k, sd = sign(p.x);
	float hW = hash13(vec3(k + 0.37, sd, 7.7)), hL = hash13(vec3(k + 0.11, sd, 3.1));
	float nW = vNoise(vec3(p.z * 7.0, p.y * 0.8, p.x * 0.2 + zk)), drop = WA.x - p.y;
	float wdz = (p.z - zk - 0.04 * drop * (hL - 0.5)) / (WB.y * (0.7 + 1.1 * hW) * (0.6 + 0.8 * nW) * (1.0 + 0.25 * max(drop, 0.0)));
	float weep = step(WA.z - 0.5 * WB.x, p.z) * step(p.z, WA.w + 0.5 * WB.x) * step(0.33, hW) * exp(-wdz * wdz) * smoothstep(0.0, 0.06, drop)
		* exp(-max(drop, 0.0) / (WA.y * (0.3 + 0.9 * hL))) * (0.45 + 0.55 * hW)
		* smoothstep(0.25, 0.75, 0.7 * vNoise(vec3(p.z * 9.0, p.y * 2.4, k * 3.3)) + 0.3 * vNoise(vec3(p.z * 30.0, p.y * 6.0, k)));
	col = mix(col, mix(vec3(0.2, 0.21, 0.2), vec3(0.14, 0.06, 0.025), WB.z), clamp(weep * WB.w, 0.0, 0.4));
	// plate seams (strakes and butts above the boot-top), 2 cm, with a raised weld bead
	vec2 ln = vLines(vec2(p.y / GB.x, p.z / GB.y), 0.02 / GB.xy);
	float seam = max(ln.x, ln.y) * step(B.y + 0.2, p.y);
	diffuseColor.rgb *= col * (1.0 - GB.z * seam);
	livRough = mix(mix(livRough, 0.9, max(algae, 0.6 * scuff)), 0.6, chip);
	float fz = p.z / GB.w;
	livBumpH = X.x * (vNoise(p * vec3(0.5, 1.4, 0.5)) - 0.5) + X.w * seam
		+ X.y * (0.5 - 0.5 * cos(6.2831853 * fz)) * (1.0 - smoothstep(0.08, 0.3, fwidth(fz))) * smoothstep(0.1, 0.5, p.y) * (1.0 - smoothstep(GA.z - 0.4, GA.z, p.y));
	// wet band, dark and glossy: how far the sea reaches up the hull (uWet: height aft, the bow wave's
	// extra climb forward, strength of the run-off streaks above it, their drift)
	float wt = uWet.x + uWet.y * smoothstep(-2.0, 9.0, p.z) * (1.0 - smoothstep(11.0, 13.0, p.z)) + 0.12 * (nA - 0.5);
	float wet = max(1.0 - smoothstep(wt - 0.03, wt + 0.03, p.y), uWet.z * smoothstep(0.6, 0.85, vNoise(vec3(p.z * 7.0, p.y * 0.8 + uWet.w, p.x))) * (1.0 - smoothstep(wt, wt + 0.7, p.y)));
	diffuseColor.rgb *= 1.0 - 0.45 * wet;
	livRough = mix(livRough, 0.1, wet);
}
`;
// Paint patterns (vessel frame): non-slip deck paint (roughness > 0.9; pattern 1 adds tie-down
// sockets), rubber fenders (pattern 2), worn deck markings (pattern 3).
const PAINT_APPLY = /* glsl */`
{
	vec3 p = vPaintP;
	float fw = length(fwidth(p)), near = 1.0 - smoothstep(0.003, 0.02, fw);
	if (vRM.x > 0.9) {
		// fine sand grain (seen only close up), dirt and trodden patches, plate seams
		float grain = vNoise(p * 170.0) - 0.5, dirt = vNoise(p * vec3(0.6, 1.0, 0.35)) * 0.6 + vNoise(p * 2.3) * 0.4;
		vec2 ln = vLines(p.xz / vec2(1.5, 2.0), vec2(0.008, 0.006));
		diffuseColor.rgb *= (0.84 + 0.32 * dirt) * (1.0 + 0.4 * grain * near) * (1.0 - 0.3 * max(ln.x, ln.y));
		pBump = 0.0005 * grain * near;
		if (vPat > 0.5) {
			float rr = length((fract(p.xz / 0.9 + 0.5) - 0.5) * 0.9), fr = max(length(fwidth(p.xz)), 1e-4);
			diffuseColor.rgb *= 1.0 - 0.6 * mix(1.0 - smoothstep(0.055 - fr, 0.055 + fr, rr), 0.0117, smoothstep(0.02, 0.1, fr));
		}
	} else if (vPat > 1.5 && vPat < 2.5) {
		// moulded grip grooves (0.1 m pitch), faint grey chalking, polished black where the landing tubes rub (x ±0.9)
		float groove = (1.0 - smoothstep(0.07, 0.15, abs(fract(p.x * 10.0) - 0.5))) * near;
		float rub = exp(-pow((abs(p.x) - 0.9) / 0.3, 2.0)) * smoothstep(0.3, 0.7, vNoise(p * vec3(3.0, 12.0, 3.0)));
		float chalk = smoothstep(0.62, 0.85, vNoise(p * vec3(6.0, 18.0, 1.5) + 11.0));
		diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.03), 0.3 * chalk) * (1.0 - 0.45 * groove);
		pRough = mix(0.85, 0.4, rub);
		pBump = -0.012 * groove;
	} else if (vPat > 2.5) {
		float wear = smoothstep(0.5, 0.75, vNoise(p * vec3(3.0, 1.0, 3.0)) * 0.65 + vNoise(p * 19.0) * 0.35);
		diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.045, 0.05, 0.055), wear);
		pRough = mix(pRough, 0.95, wear);
	}
}
`;
// Window interiors: the room behind each pane, ray-traced as a box (parallax-correct): back wall,
// floor, ceiling and one furniture block (saloon seats, the console under a windscreen, a bunk),
// with windows in the far wall showing the outside. aPane = (u, v, sill, kind + depth/10); kinds:
// 0 saloon, 1 bridge / wheelhouse front, 2 cabin (curtains), 3 plain room. uWin[0] = (night room
// luminance, lit cabin fraction, screen luminance, curtained fraction), uWin[1] = daylight on the
// ceiling, uWin[2] = the outside seen through the far windows (scene units).
const GLASS_GLSL = /* glsl */`
uniform vec4 uWin[3];
varying vec2 vWin;
varying vec4 vPane;
`;
const GLASS_APPLY = /* glsl */`
{
	vec3 e = -vViewPosition, q0 = dFdx(e), q1 = dFdy(e), a1 = cross(q1, normal), a0 = cross(normal, q0);
	vec2 s0 = dFdx(vPane.xy), s1 = dFdy(vPane.xy);
	vec3 T = a1 * s0.x + a0 * s1.x, Bt = a1 * s0.y + a0 * s1.y, V = normalize(e);
	float m = inversesqrt(max(max(dot(T, T), dot(Bt, Bt)), 1e-24));
	vec3 d = vec3(dot(V, T) * m, dot(V, Bt) * m, max(-dot(V, normal), 0.02));
	float kind = floor(vPane.w), D = fract(vPane.w) * 10.0, fl = -vPane.z;
	vec3 o = vec3(vPane.xy, 0.0);
	float t = D / d.z, s = 2.0;
	float ty = d.y > 0.0 ? (fl + 2.2 - o.y) / d.y : (fl - o.y) / min(d.y, -1e-5);
	if (ty < t) { t = ty; s = d.y > 0.0 ? 0.0 : 1.0; }
	vec3 f = kind < 0.5 ? vec3(0.5, D - 0.4, 1.15) : (kind < 1.5 ? vec3(0.03, 0.8, 0.95) : vec3(D - 0.9, D, 0.55));
	if (kind < 2.5) {
		float tf = f.x / d.z, tt = (fl + f.z - o.y) / min(d.y, -1e-5), zt = d.z * tt;
		if (tf < t && o.y + d.y * tf < fl + f.z) { t = tf; s = 4.0; }
		if (d.y < 0.0 && tt < t && zt > f.x && zt < f.y) { t = tt; s = 3.0; }
	}
	vec3 h = o + d * t;
	float k = s < 0.5 ? 1.0 : (s < 1.5 ? 0.3 : (s < 2.5 ? 0.55 : (s < 3.5 ? 0.3 : 0.18)));
	if (kind < 0.5 && s > 2.5) k *= 0.55 + 0.45 * step(0.15, fract(h.x / 0.55));
	float farWin = kind < 1.5 && s == 2.0 ? step(fl + 1.0, h.y) * step(h.y, fl + 2.0) * step(0.2, fract(h.x / 1.3)) : 0.0;
	float lit = vWin.y > 0.5 ? step(fract(vWin.y), uWin[0].y) : 1.0;
	vec3 Lin = uWin[1].rgb * k + WARM * (uWin[0].x * vWin.x * lit * k * (0.75 + 0.25 * cos(2.618 * h.x)));
	if (kind > 0.5 && kind < 1.5 && s == 3.0) Lin += vec3(0.3, 0.65, 1.0) * uWin[0].z * (0.5 + 0.5 * sin(h.x * 4.5)) * smoothstep(0.15, 0.4, h.z);   // the glow of the chart plotter / radar screens
	Lin = mix(Lin, uWin[2].rgb, farWin);
	if (kind > 1.5 && kind < 2.5 && fract(vWin.y * 7.31) < uWin[0].w) Lin = (0.5 * uWin[1].rgb + 0.35 * uWin[0].x * lit * WARM) * vec3(0.9, 0.85, 0.75);
	totalEmissiveRadiance += 0.72 * (0.957 - 0.957 * pow(1.0 - d.z, 5.0)) * Lin;
}
`;

function createVesselMaterials(name, floods, livery) {
  const hull = new THREE.MeshStandardMaterial({ name: `${name}.hull`, roughness: 0.4 });
  const paint = new THREE.MeshStandardMaterial({ name: `${name}.paint`, vertexColors: true });
  // Window glass: n = 1.52 float glass (F0 0.043); its reflection of sky and sea comes from the
  // physical material, the interior from GLASS_APPLY (transmitted, so weighted by 1 - Fresnel).
  const glass = new THREE.MeshPhysicalMaterial({ name: `${name}.glass`, color: 0x010101, roughness: 0.03, ior: 1.52, specularIntensity: 1 });
  const win = { uWin: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] } };
  const common = (shader, uniforms, pars) => {
    Object.assign(shader.uniforms, floods, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${HASH_GLSL}${NOISE_GLSL}${FLOOD_GLSL}${pars}`)
      .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n' + FLOOD_APPLY);
  };
  hull.onBeforeCompile = (shader) => {
    common(shader, livery, LIVERY_GLSL);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLiv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLiv = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <color_fragment>', '#include <color_fragment>\nfloat livRough = 0.4, livBumpH = 0.0;\n' + LIVERY_APPLY)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = livRough;')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = vBump(-vViewPosition, normal, livBumpH, faceDirection);');
  };
  paint.onBeforeCompile = (shader) => {
    common(shader, {}, 'varying vec3 vPaintP;\nvarying vec2 vRM;\nvarying float vPat;');
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aRM, aWin;\nvarying vec3 vPaintP;\nvarying vec2 vRM;\nvarying float vPat;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPaintP = position; vRM = aRM; vPat = aWin.x;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <color_fragment>', '#include <color_fragment>\nfloat pRough = vRM.x, pBump = 0.0;\n' + PAINT_APPLY)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = pRough;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = vRM.y;')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = vBump(-vViewPosition, normal, pBump, faceDirection);');
  };
  glass.onBeforeCompile = (shader) => {
    common(shader, win, `${GLASS_GLSL}const vec3 WARM = ${glslVec(WARM)};\n`);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aWin;\nattribute vec4 aPane;\nvarying vec2 vWin;\nvarying vec4 vPane;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWin = aWin; vPane = aPane;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', GLASS_APPLY);
  };
  hull.customProgramCacheKey = () => 'vessel-hull-v3';
  paint.customProgramCacheKey = () => 'vessel-paint-v4';
  glass.customProgramCacheKey = () => 'vessel-glass-v3';
  for (const m of [hull, paint, glass]) applyAtmosphere(m);
  return { hull, paint, glass, window: win };
}

const makeFloodUniforms = () => ({
  uFloodP: { value: Array.from({ length: MAX_FLOODS }, () => new THREE.Vector4()) },
  uFloodD: { value: Array.from({ length: MAX_FLOODS }, () => new THREE.Vector4(0, -1, 0, 0.8)) },
  uFloodC: { value: new THREE.Vector3(...WARM) },
});

// Livery uniforms uLv[12]: v = 32 numbers for slots 0-1 (bands: boot-top bottom, top, stripe centre,
// stripe rise to the bow; stripe: half-height, z where the bow sweep starts, stripe end z, bow z) and
// 6-11 (grime: algae height, strength, fender line y, scuff; seams: strake, butt pitch, darkening,
// frame pitch; weeps: start y, e-fold, first z, last z; weeps: pitch, half-width, rust share,
// strength; (slot 10 unused); surface: fairness amp, dent amp, edge wear, weld bead);
// slots 2-5 are the bottom, boot-top, topsides and stripe paints (sRGB hex) with their roughness.
function makeLivery(hex, rough, v) {
  const a = v.slice(0, 8);
  hex.forEach((h, i) => a.push(...lin(h), rough[i]));
  a.push(...v.slice(8));
  return { uLv: { value: Array.from({ length: 12 }, (_, i) => new THREE.Vector4().fromArray(a, 4 * i)) }, uWet: { value: new THREE.Vector4(0.4, 0, 0, 0) } };
}

// Paints (display sRGB, ESTIMATED from photos cited in SCENE-SPEC [37][38]).
const paintOf = (hex, rough, metal = 0, pattern = 0) => ({ colour: lin(hex), rough, metal, pattern });
const PAINT = {
  white: paintOf('#e9e9e4', 0.42), offWhite: paintOf('#dcddd8', 0.5), deck: paintOf('#3b4044', 0.95),
  rubber: paintOf('#141414', 0.85, 0, 2), steel: paintOf('#c8ccce', 0.32, 1), galv: paintOf('#a9adac', 0.55, 1),
  dark: paintOf('#1c1e20', 0.55), frame: paintOf('#2a2d30', 0.5), blue: paintOf('#22406e', 0.55),
  orange: paintOf('#e0551c', 0.5), container: paintOf('#8e3a1f', 0.7), yellow: paintOf('#e2b100', 0.5),
  marking: paintOf('#e2b100', 0.8, 0, 3), navy: paintOf('#17253f', 0.38), sovDeck: paintOf('#4b5650', 0.93),
  greyBlue: paintOf('#3d5873', 0.6), grey: paintOf('#8d9296', 0.45), lens: paintOf('#f4f1e6', 0.1),
};
// Window glass: nearly black itself; what shows is its reflection and the interior behind it.
const glassOf = (glow, room, cabins = 0) => ({ colour: [0.005, 0.006, 0.007], rough: 0.03, glow, room, cabins });

// ================================================================================================
// CTV geometry
// ================================================================================================
// Demi-hull section at local z (x from the demi-hull centreline): body keel, chine, waterline,
// sheer. A deep-V canoe body (keel 1.1 m down) with the chine near the waterline; a skeg under it
// reaches the 1.5 m draft. The sheer rises 0.5 m toward the stems and the topsides flare out over
// the forward 8 m, as on StratCat / Incat Crowther 27 m cats. ESTIMATED lines.
function ctvSection(z) {
  const bow = smooth(3.5, CTV_STEM_Z, z);
  const plan = (z0, w) => w * Math.pow(clamp(1 - Math.pow(Math.max(0, z - z0) / (CTV_STEM_Z - z0), 2), 0, 1), 0.55);
  const bD = Math.max(plan(3.0, CTV_HULL_W), 0.02);                  // deck
  const bW0 = plan(1.0, 0.98), flare = 0.18 * smooth(CTV_STEM_Z - 9, CTV_STEM_Z - 4, z);
  const bW = Math.max(bW0 - flare * bW0 / (bW0 + 0.15), 0.02);        // waterline (pulled in forward: flare)
  const bC = Math.max(Math.min(plan(-1.0, 0.86) * (1 - 0.15 * bow), bW - 0.02), 0.02);   // chine
  const yK = -1.1 + 0.2 * smooth(CTV_TRANSOM_Z + 3.5, CTV_TRANSOM_Z, z) + 1.85 * Math.pow(smooth(2.5, CTV_STEM_Z + 0.3, z), 1.6);   // raked forefoot
  const yC = Math.min(yK + bC * Math.tan((22 + 18 * bow) * DEG), 0.2);   // deadrise 22-40°
  const yD = C.foredeckY + 0.12 * bow + 0.5 * smooth(4, CTV_STEM_Z, z) ** 2;   // sheer
  return { bD, bW, bC, yK, yC, yD };
}
const ctvDeckY = (z) => ctvSection(z).yD + 0.03;                           // walking surface (3 cm plate) at local z

// Corrugated wall (containers): a trapezoid profile of pitch `pitch` and depth `depth` along u
// (length Lu from origin o), extruded along v (height Lv); n = outward. Outer flats sit on the plane.
function corrugated(kit, o, u, v, n, Lu, Lv, pitch, depth, opts) {
  const k = Math.max(1, Math.round(Lu / pitch)), P = Lu / k, prof = [];
  for (let i = 0; i < k; i++) prof.push([i * P, 0], [(i + 0.3) * P, 0], [(i + 0.42) * P, -depth], [(i + 0.88) * P, -depth]);
  prof.push([Lu, 0]);
  const at = (s, d, h) => o.clone().addScaledVector(u, s).addScaledVector(n, d).addScaledVector(v, h);
  for (let i = 0; i < prof.length - 1; i++) {
    const [s0, d0] = prof[i], [s1, d1] = prof[i + 1];
    kit.quad([at(s0, d0, 0), at(s1, d1, 0), at(s1, d1, Lv), at(s0, d0, Lv)], n, opts);
  }
}

// ISO 10 ft box container: corrugated sides and front, door end with locking bars, corner posts,
// rails and corner castings. x0/x1, y0, z0 (door end, aft) .. z1. [ISO 668: 2.991 x 2.438 x 2.591 m]
function buildContainer(kit, x0, x1, y0, z0, z1, paint) {
  const H = 2.591, y1 = y0 + H, t = 0.15, P = PAINT;
  for (const x of [x0, x1 - t]) for (const z of [z0, z1 - t]) kit.box([x, x + t], [y0, y1], [z, z + t], paint);
  for (const [ya, yb] of [[y0, y0 + 0.16], [y1 - 0.12, y1]]) {
    for (const x of [x0, x1 - t]) kit.box([x, x + t], [ya, yb], [z0 + t, z1 - t], paint);
    for (const z of [z0, z1 - t]) kit.box([x0 + t, x1 - t], [ya, yb], [z, z + t], paint);
  }
  for (const s of [-1, 1]) corrugated(kit, V3(s > 0 ? x1 - 0.035 : x0 + 0.035, y0 + 0.16, z0 + t), V3(0, 0, 1), V3(0, 1, 0), V3(s, 0, 0), z1 - z0 - 2 * t, H - 0.28, 0.28, 0.036, paint);
  corrugated(kit, V3(x0 + t, y0 + 0.16, z1 - 0.035), V3(1, 0, 0), V3(0, 1, 0), V3(0, 0, 1), x1 - x0 - 2 * t, H - 0.28, 0.22, 0.03, paint);
  kit.box([x0 + t, x1 - t], [y1 - 0.06, y1 - 0.02], [z0 + t, z1 - t], paint);
  // door end: two leaves, four locking bars, hinges; corner castings
  kit.box([x0 + t, x1 - t], [y0 + 0.16, y1 - 0.12], [z0 + 0.03, z0 + 0.07], { ...paint, colour: paint.colour.map((c) => c * 0.8) });
  const xm = (x0 + x1) / 2;
  kit.box([xm - 0.006, xm + 0.006], [y0 + 0.16, y1 - 0.12], [z0 + 0.015, z0 + 0.03], P.dark);
  for (const f of [0.18, 0.4, 0.6, 0.82]) {
    const x = x0 + (x1 - x0) * f;
    kit.rod([x, y0 + 0.1, z0 - 0.01], [x, y1 - 0.06, z0 - 0.01], 0.014, P.galv, 6);
  }
  for (const x of [x0 + 0.02, x1 - 0.02]) for (const y of [y0 + 0.45, y0 + 1.3, y0 + 2.15]) kit.box([x - 0.03, x + 0.03], [y, y + 0.12], [z0 - 0.02, z0 + 0.04], P.dark);
  for (const x of [x0 - 0.005, x1 - 0.173]) for (const z of [z0 - 0.005, z1 - 0.113]) for (const y of [y0, y1 - 0.118]) kit.box([x, x + 0.178], [y, y + 0.118], [z, z + 0.118], P.dark);
}

// Guard-rail run through deck points: 42 mm top rail, 34 mm knee rail, posts every ~1.5 m
// [SCENE-SPEC §4.6 rail rules; EN ISO 14122-3 tube sizes].
function railRun(kit, pts, height) {
  const V = pts.map(v3);
  for (let i = 0; i < V.length - 1; i++) {
    const a = V[i], b = V[i + 1], n = Math.max(1, Math.round(a.distanceTo(b) / 1.5));
    kit.rod(a.clone().setY(a.y + height), b.clone().setY(b.y + height), 0.021, PAINT.steel, 10);
    kit.rod(a.clone().setY(a.y + height / 2), b.clone().setY(b.y + height / 2), 0.017, PAINT.steel, 8);
    if (i > 0) kit.add('paint', new THREE.SphereGeometry(0.024, 10, 6).translate(a.x, a.y + height, a.z), PAINT.steel);   // bent corner
    for (let k = i === 0 ? 0 : 1; k <= n; k++) { const p = a.clone().lerp(b, k / n); kit.rod(p, p.clone().setY(p.y + height), 0.021, PAINT.steel, 8); }
  }
}

function buildCTV(kit) {
  const P = PAINT;
  // --- demi-hulls: bottom (keel -> chine) and topsides (chine -> waterline -> sheer), crisp chine
  const zs = [];
  for (let z = CTV_TRANSOM_Z; z < 7; z += 0.8) zs.push(z);
  for (let z = 7; z < CTV_STEM_Z; z += 0.25) zs.push(z);
  zs.push(CTV_STEM_Z);
  for (const side of [-1, 1]) {
    const cx = side * CTV_HULL_X;
    const away = (x, y, z) => { const s = ctvSection(clamp(z, CTV_TRANSOM_Z, CTV_STEM_Z)); return [x - cx, y - 0.5 * (s.yK + s.yD), 0]; };
    const st = (f) => zs.map((z) => ({ z, pts: f(ctvSection(z)) }));
    const bottomHalf = (s, sg) => [0.25, 0.5, 0.75].map((f) => [cx + sg * s.bC * f, s.yK + (s.yC - s.yK) * (f - 0.12 * f * (1 - f))]);
    const topside = (s, sg) => [[cx + sg * s.bC, s.yC], ...[0.35, 0.7].map((f) => [cx + sg * (s.bC + (s.bW - s.bC) * f), s.yC + (0.05 - s.yC) * f]),
      ...[0, 0.25, 0.5, 0.75, 1].map((f) => [cx + sg * (s.bW + (s.bD - s.bW) * f ** 1.5), 0.05 + (s.yD - 0.05) * f])];
    for (const strip of [st((s) => [[cx - s.bC, s.yC], ...bottomHalf(s, -1).reverse(), [cx, s.yK], ...bottomHalf(s, 1), [cx + s.bC, s.yC]]),
      st((s) => topside(s, 1)), st((s) => topside(s, -1).reverse())]) kit.add('hull', orientOutward(loft(strip), away));
    kit.add('hull', orientOutward(loft(st((s) => [[cx + s.bD, s.yD], [cx - s.bD, s.yD]])), UP));
    const s0 = ctvSection(CTV_TRANSOM_Z);
    kit.add('hull', orientOutward(capFan(CTV_TRANSOM_Z, [[cx, s0.yK], [cx + s0.bC, s0.yC], [cx + s0.bW, 0.05], [cx + s0.bD, s0.yD], [cx - s0.bD, s0.yD], [cx - s0.bW, 0.05], [cx - s0.bC, s0.yC]]), AFT));
    // skeg down to the design draft (protects the running gear), raked leading edge
    const yk0 = ctvSection(-12.4).yK + 0.05, yk1 = ctvSection(4.5).yK + 0.05, t = 0.09;
    kit.hexa([[cx - t, -C.draft, -12.4], [cx + t, -C.draft, -12.4], [cx + t, -C.draft, 1], [cx - t, -C.draft, 1], [cx - t, yk0, -12.7], [cx + t, yk0, -12.7], [cx + t, yk1, 4.5], [cx - t, yk1, 4.5]], undefined, 'hull');
  }

  // --- tunnel roof (cross-deck structure) and the bow beam carrying the fender (below the deck
  // plate); the tunnel stays open below it, so both demi-hull stems show
  kit.box([-CTV_HULL_X + 0.4, CTV_HULL_X - 0.4], [1.25, C.foredeckY - 0.02], [CTV_TRANSOM_Z + 0.2, CTV_STEM_Z - 0.6], P.blue);
  kit.rblock('paint', { halfW: 2.3, y0: CTV_FENDER.y0 + 0.1, y1: ctvSection(CTV_STEM_Z).yD - 0.01, zb0: CTV_STEM_Z - 0.8, zb1: CTV_STEM_Z - 0.02, zt1: CTV_STEM_Z }, P.blue, 0.08);

  // --- deck plate over both hulls and the tunnel, following the sheer, closed across the bow; the
  // aft cargo deck carries the tie-down socket grid
  const D = CTV_DECKHOUSE, y0 = C.foredeckY + 0.08;
  const plate = (list) => loft(list.map((z) => { const s = ctvSection(z), w = CTV_HULL_X + s.bD - 0.02, y = ctvDeckY(z); return { z, pts: [[w, y], [0, y], [-w, y]] }; }));
  kit.add('paint', orientOutward(plate([...zs.filter((z) => z < D.z0), D.z0]), UP), { ...P.deck, pattern: 1 });
  kit.add('paint', orientOutward(plate([D.z0, ...zs.filter((z) => z > D.z0)]), UP), P.deck);

  // --- bow fender (black rubber block, 0.5 m thick, 3 m wide, its face raked back a little, every edge
  // rounded, grip grooves) and the D-fenders along the sheer: a D section 0.44 m tall, 0.24 m proud
  const F = CTV_FENDER;
  kit.rblock('paint', { halfW: F.width / 2, y0: F.y0, y1: F.y1, zb0: CTV_STEM_Z - 0.06, zb1: CTV_BOW_Z, zt1: CTV_BOW_Z - 0.08 }, P.rubber, 0.22, 3);
  for (const side of [-1, 1]) {
    const st = zs.filter((z) => z <= CTV_STEM_Z - 0.3).map((z) => { const s = ctvSection(z), x0 = side * (CTV_HULL_X + s.bD - 0.03);
      return { z, pts: [0, 1, 2, 3, 4, 5, 6].map((k) => { const a = (k / 6 - 0.5) * Math.PI; return [x0 + side * CTV_SIDE_FENDER_R * Math.cos(a), s.yD - 0.19 + 0.22 * Math.sin(a)]; }) }; });
    const out = (x) => [x - side * CTV_HULL_X, 0, 0];
    kit.add('paint', orientOutward(loft(st), out), P.rubber);
    for (const [i, d] of [[0, -1], [st.length - 1, 1]]) kit.add('paint', orientOutward(capFan(st[i].z, st[i].pts), () => [0, 0, d]), P.rubber);
  }
  kit.box([-CTV_HULL_X - 1.0, CTV_HULL_X + 1.0], [1.35, 2.0], [CTV_STERN_Z, CTV_TRANSOM_Z + 0.02], P.rubber);   // stern fender

  // --- deckhouse (saloon): white, raked front, slight tumblehome, every edge rounded (0.12 m);
  // framed windows (seats inside), aft door
  kit.rblock('paint', { halfW: D.halfW, halfWTop: D.halfW - 0.08, y0, y1: D.roof, zb0: D.z0, zb1: D.z1, zt0: D.z0 + 0.1, zt1: D.z1 - 0.45 }, P.white, 0.12);
  const fy = (y) => (y - y0) / (D.roof - y0), wallX = (y) => D.halfW - 0.08 * fy(y), frontZ = (y) => D.z1 - 0.45 * fy(y), aftZ = (y) => D.z0 + 0.1 * fy(y);
  const saloon = (depth) => glassOf(1, [0.72, 0, depth]);
  for (const s of [-1, 1]) {
    const n = V3(s, 0.08 / (D.roof - y0), 0).normalize();
    for (const [za, zb] of [[-5.35, -3.05], [-2.75, -0.45], [-0.15, 2.0]]) {
      kit.framedPane('glass', V3(s * wallX(3.05), 3.05, za), V3(s * wallX(3.05), 3.05, zb), V3(s * wallX(4.18), 4.18, zb), V3(s * wallX(4.18), 4.18, za), n, saloon(6.5), { cr: 0.22, fw: 0.07 });
    }
  }
  const fwd = V3(0, 0.45 / (D.roof - y0), 1).normalize(), aftN = V3(0, 0.1 / (D.roof - y0), -1).normalize();
  for (const [xa, xb] of [[-2.95, -1.07], [-0.87, 0.87], [1.07, 2.95]]) {
    kit.framedPane('glass', V3(xa, 3.12, frontZ(3.12)), V3(xb, 3.12, frontZ(3.12)), V3(xb, 4.22, frontZ(4.22)), V3(xa, 4.22, frontZ(4.22)), fwd, saloon(8.8), { cr: 0.1, fw: 0.07 });
  }
  const aftQuad = (xa, xb, ya, yb) => [V3(xa, ya, aftZ(ya)), V3(xb, ya, aftZ(ya)), V3(xb, yb, aftZ(yb)), V3(xa, yb, aftZ(yb))];
  kit.framedPane('paint', ...aftQuad(0.5, -0.5, y0 + 0.02, y0 + 2.0), aftN, P.offWhite, { cr: 0.12, fw: 0.06 });
  kit.framedPane('glass', ...aftQuad(0.3, -0.3, y0 + 1.15, y0 + 1.75), aftN, saloon(8.8), { cr: 0.08, fw: 0.04, off: 0.045, proud: 0.055 });
  kit.rod([-0.38, y0 + 1.0, aftZ(y0 + 1.0) - 0.06], [-0.38, y0 + 1.22, aftZ(y0 + 1.22) - 0.06], 0.015, P.steel, 5);
  for (const [xa, xb] of [[2.9, 1.0], [-1.0, -2.9]]) kit.framedPane('glass', ...aftQuad(xa, xb, 3.15, 4.15), aftN, saloon(8.8), { cr: 0.12, fw: 0.07 });

  // --- wheelhouse on the saloon roof: rounded body, forward-raked windscreen (the console behind
  // it), framed windows all round, a door each side, roof slab with a visor
  const W = CTV_WHEELHOUSE, wy0 = D.roof, wy1 = W.roof - 0.08, rake = 0.44, wa = 5.02, wb = 6.2;
  kit.rblock('paint', { halfW: W.halfW, y0: wy0, y1: wy1, zb0: W.z0, zb1: W.z1, zt1: W.z1 + rake }, P.white, 0.1);
  kit.rblock('paint', { halfW: W.halfW + 0.12, y0: W.roof - 0.14, y1: W.roof, zb0: W.z0 - 0.1, zb1: W.z1 + 0.85 }, P.white, 0.05, 1);   // roof slab: its top is the 6.5 m roof
  const wFront = (y) => W.z1 + rake * (y - wy0) / (wy1 - wy0), sill = wa - wy0;
  const screenN = V3(0, -rake / (wy1 - wy0), 1).normalize();
  const pw = (2 * W.halfW - 0.3 - 3 * 0.09) / 4;
  for (let k = 0; k < 4; k++) {
    const xa = -W.halfW + 0.15 + k * (pw + 0.09), xb = xa + pw;
    kit.framedPane('glass', V3(xa, wa, wFront(wa)), V3(xb, wa, wFront(wa)), V3(xb, wb, wFront(wb)), V3(xa, wb, wFront(wb)), screenN, glassOf(0.001, [sill, 1, 4.2]), { cr: 0.06, fw: 0.06 });
  }
  const bridgeRoom = (depth) => glassOf(0.001, [sill, 3, depth]);   // wheelhouse: dark at night (~0.02 cd/m²)
  for (const s of [-1, 1]) {
    const x = s * W.halfW, n = V3(s, 0, 0);
    kit.framedPane('glass', V3(x, wa, -0.75), V3(x, wa, 1.7), V3(x, wb, 1.7), V3(x, wb, -0.75), n, bridgeRoom(5.0), { cr: 0.06, fw: 0.06 });
    kit.framedPane('paint', V3(x, wy0 + 0.03, -1.95), V3(x, wy0 + 0.03, -1.05), V3(x, 6.26, -1.05), V3(x, 6.26, -1.95), n, P.offWhite, { cr: 0.1, fw: 0.06 });
    kit.framedPane('glass', V3(x, 5.25, -1.8), V3(x, 5.25, -1.2), V3(x, 6.05, -1.2), V3(x, 6.05, -1.8), n, bridgeRoom(5.0), { cr: 0.07, fw: 0.04, off: 0.045, proud: 0.055 });
    kit.rod([x + s * 0.06, 5.35, -1.15], [x + s * 0.06, 5.6, -1.15], 0.015, P.steel, 5);
  }
  for (const [xa, xb] of [[2.25, 0.2], [-0.2, -2.25]]) kit.framedPane('glass', V3(xa, wa, W.z0), V3(xb, wa, W.z0), V3(xb, wb, W.z0), V3(xa, wb, W.z0), V3(0, 0, -1), bridgeRoom(4.2), { cr: 0.06, fw: 0.06 });
  const nameBoard = { centre: [0, 4.84, wFront(4.84) + 0.03], width: 2.6, height: 0.3, normal: screenN.toArray() };

  // --- mast and electronics: pole on a tripod, radar pedestal + 6 ft open array on a platform,
  // radome, yardarm with VHF / AIS whips, horn, masthead lantern with a lightning rod; on the roof
  // GPS / satcom domes, a thermal (FLIR) camera ball, the searchlight, a low guard rail
  const mz = CTV_MAST_Z, R = W.roof;
  kit.rod([0, R, mz], [0, C.mastheadLightY - 0.12, mz], 0.11, P.white, 12, 0.07);
  for (const s of [-1, 1]) kit.rod([s * 1.1, R - 0.04, mz - 0.9], [0, 8.3, mz], 0.05, P.white, 8);   // feet set into the roof
  kit.box([-0.7, 0.7], [7.55, 7.65], [mz - 0.5, mz + 0.5], P.white);
  kit.rblock('paint', { halfW: 0.2, halfWTop: 0.17, y0: 7.65, y1: 8.02, zb0: mz - 0.05, zb1: mz + 0.4 }, P.white, 0.04, 1);
  kit.hexa([[-0.95, 8.04, mz + 0.12], [0.95, 8.04, mz + 0.12], [0.95, 8.04, mz + 0.24], [-0.95, 8.04, mz + 0.24], [-0.95, 8.22, mz + 0.15], [0.95, 8.22, mz + 0.15], [0.95, 8.22, mz + 0.21], [-0.95, 8.22, mz + 0.21]], P.dark);
  kit.add('paint', new THREE.SphereGeometry(0.33, 16, 8, 0, TAU, 0, Math.PI / 2).scale(1, 0.9, 1).translate(0, 8.7, mz - 0.4), P.white);
  kit.rod([0, 8.2, mz - 0.4], [0, 8.7, mz - 0.4], 0.05, P.white, 6);
  kit.rod([-1.0, 9.6, mz], [1.0, 9.6, mz], 0.035, P.white, 8);
  for (const s of [-1, 1]) {
    kit.rod([s * 0.95, 9.6, mz], [s * 0.95, 11.3, mz], 0.011, P.white, 5, 0.006);
    kit.rod([s * 0.55, 9.6, mz], [s * 0.55, 10.4, mz], 0.016, P.dark, 5);
  }
  kit.add('paint', new THREE.ConeGeometry(0.07, 0.24, 10, 1, true).rotateX(Math.PI / 2).translate(0.2, 9.3, mz + 0.2), P.grey);
  const Ym = C.mastheadLightY;                                                                                        // masthead lantern: base, lens, cap, lightning rod
  kit.box([-0.09, 0.09], [Ym - 0.12, Ym - 0.06], [mz - 0.08, mz + 0.1], P.dark);
  kit.rod([0, Ym - 0.06, mz + 0.01], [0, Ym + 0.06, mz + 0.01], 0.07, P.lens, 12);
  kit.rod([0, Ym + 0.06, mz + 0.01], [0, Ym + 0.1, mz + 0.01], 0.075, P.dark, 12);
  kit.rod([0, Ym + 0.1, mz + 0.01], [0, Ym + 0.9, mz + 0.01], 0.008, P.steel, 4);
  kit.box([-0.16, 0.16], [R - 0.12, R + 0.22], [W.z0 - 0.32, W.z0 - 0.08], P.dark);                        // aft-deck flood bolted to the roof's aft edge
  for (const s of [-1, 1]) {
    kit.rod([s * (W.halfW - 0.2), R, W.z0 + 0.3], [s * (W.halfW - 0.2), R + 3.6, W.z0 + 0.3], 0.022, P.white, 5, 0.008);   // VHF whips
    kit.rod([s * 0.9, R, 1.3], [s * 0.9, R + 0.35, 1.3], 0.05, P.white, 8);
    kit.add('paint', new THREE.SphereGeometry(0.1, 10, 6).translate(s * 0.9, R + 0.4, 1.3), P.white);                // GPS mushrooms
    // floodlights under the visor (LED panels) and the sidelight screens at the visor's corners
    kit.box([s * 0.8 - 0.16, s * 0.8 + 0.16], [R - 0.27, R - 0.1], [W.z1 + 0.5, W.z1 + 0.68], P.dark);
    kit.box([s * 0.8 - 0.14, s * 0.8 + 0.14], [R - 0.26, R - 0.22], [W.z1 + 0.68, W.z1 + 0.69], P.lens);
    kit.box([s * (W.halfW + 0.2) - 0.03, s * (W.halfW + 0.2) + 0.03], [6.02, 6.38], [2.05, 2.55], P.dark);
    kit.box([Math.min(s * W.halfW, s * (W.halfW + 0.2)), Math.max(s * W.halfW, s * (W.halfW + 0.2))], [6.3, 6.36], [2.3, 2.4], P.dark);
  }
  kit.rod([-1.3, R, -1.5], [-1.3, R + 0.35, -1.5], 0.09, P.white, 10);
  kit.add('paint', new THREE.SphereGeometry(0.3, 16, 10).translate(-1.3, R + 0.62, -1.5), P.white);                   // satcom dome
  kit.rod([1.1, R, 1.8], [1.1, R + 0.32, 1.8], 0.04, P.grey, 8);
  kit.add('paint', new THREE.SphereGeometry(0.12, 14, 10).translate(1.1, R + 0.44, 1.8), P.grey);                     // thermal camera
  kit.box([1.05, 1.15], [R + 0.4, R + 0.48], [1.9, 1.93], P.dark);
  kit.rod([0, R, 1.75], [0, R + 0.26, 1.75], 0.07, P.dark, 8);                                               // searchlight
  kit.rod([0, R + 0.42, 1.55], [0, R + 0.42, 1.95], 0.15, P.grey, 14);
  kit.rod([0, R + 0.42, 1.95], [0, R + 0.42, 1.99], 0.13, P.lens, 14);
  railRun(kit, [[-(W.halfW - 0.1), R, W.z0 + 0.8], [-(W.halfW - 0.1), R, W.z1 + 0.3], [W.halfW - 0.1, R, W.z1 + 0.3], [W.halfW - 0.1, R, W.z0 + 0.8]], 0.9);

  // --- saloon roof: life rafts, exhaust stacks, rails; external stair from the aft deck (port)
  for (const s of [-1, 1]) {
    kit.add('paint', new THREE.CylinderGeometry(0.33, 0.33, 1.25, 14).rotateX(Math.PI / 2).translate(s * 2.85, D.roof + 0.45, -4.3), P.white);
    kit.box([s * 2.85 - 0.4, s * 2.85 + 0.4], [D.roof, D.roof + 0.14], [-5.1, -3.5], P.galv);
    kit.rod([s > 0 ? 2.95 : -1.9, D.roof, -5.45], [s > 0 ? 2.95 : -1.9, D.roof + 1.3, -5.45], 0.17, P.dark, 12);
  }
  railRun(kit, [[-3.3, D.roof, -5.2], [-3.3, D.roof, 2.6], [3.3, D.roof, 2.6], [3.3, D.roof, -5.9]], 0.9);
  {
    const x0 = -3.05, x1 = -2.4, zf = -7.75, zt = D.z0 - 0.05, yb = ctvDeckY(-7.7), yt = D.roof;
    for (const x of [x0, x1]) kit.hexa([[x - 0.02, yb, zf], [x + 0.02, yb, zf], [x + 0.02, yt - 0.25, zt], [x - 0.02, yt - 0.25, zt], [x - 0.02, yb + 0.25, zf - 0.02], [x + 0.02, yb + 0.25, zf - 0.02], [x + 0.02, yt, zt], [x - 0.02, yt, zt]], P.galv);
    const n = Math.round((yt - yb) / 0.25);
    for (let k = 1; k < n; k++) { const f = k / n, y = yb + (yt - yb) * f, z = zf + (zt - zf) * f; kit.box([x0 + 0.02, x1 - 0.02], [y - 0.02, y + 0.01], [z - 0.1, z + 0.12], P.galv); }
    for (const x of [x0, x1]) {
      kit.rod([x, yb + 0.9, zf], [x, yt + 0.9, zt], 0.021, P.steel, 8);
      kit.rod([x, yb, zf], [x, yb + 0.9, zf], 0.021, P.steel, 8);
      kit.rod([x, yt, zt], [x, yt + 0.9, zt], 0.021, P.steel, 8);
    }
  }

  // --- foredeck: rails with a gap at the bow for stepping onto the ladder, bollards, bow step,
  // worn yellow markings (edge lines, hatched transfer zone), flush hatches
  const edge = (z, s, inset = 0.12) => { const sc = ctvSection(z); return [s * (CTV_HULL_X + sc.bD - inset), ctvDeckY(z), z]; };
  const mk = (z) => ctvDeckY(z) + 0.006;
  for (const s of [-1, 1]) {
    railRun(kit, [edge(D.z1 + 0.3, s), edge(6.5, s), edge(10.0, s), edge(11.8, s, 0.25), [s * 1.9, ctvDeckY(CTV_STEM_Z - 0.35), CTV_STEM_Z - 0.35]], 1.1);
    kit.rod([s * 2.6, ctvDeckY(9.0) - 0.05, 9.0], [s * 2.6, ctvDeckY(9.0) + 0.45, 9.0], 0.13, P.dark, 12);
    for (let z = D.z1 + 0.4; z < 11.4; z += 0.5) {
      const z2 = Math.min(z + 0.5, 11.4), a = edge(z, s, 0.3), b = edge(z2, s, 0.3);
      kit.hexa([[a[0] - 0.06, mk(z) - 0.004, z], [a[0] + 0.06, mk(z) - 0.004, z], [b[0] + 0.06, mk(z2) - 0.004, z2], [b[0] - 0.06, mk(z2) - 0.004, z2],
        [a[0] - 0.06, mk(z), z], [a[0] + 0.06, mk(z), z], [b[0] + 0.06, mk(z2), z2], [b[0] - 0.06, mk(z2), z2]], P.marking);
    }
  }
  const ys = ctvDeckY(CTV_STEM_Z - 0.9);
  kit.rblock('paint', { halfW: 1.2, y0: ys - 0.05, y1: ys + 0.2, zb0: CTV_STEM_Z - 1.4, zb1: CTV_STEM_Z - 0.4 }, P.marking, 0.04, 1);   // bow step
  for (let k = 0; k < 7; k++) {
    const x0 = -1.9 + k * 0.62, za = CTV_STEM_Z - 3.2, zb = CTV_STEM_Z - 1.6;
    kit.hexa([[x0, mk(za) - 0.004, za], [x0 + 0.22, mk(za) - 0.004, za], [x0 + 0.62, mk(zb) - 0.004, zb], [x0 + 0.4, mk(zb) - 0.004, zb],
      [x0, mk(za), za], [x0 + 0.22, mk(za), za], [x0 + 0.62, mk(zb), zb], [x0 + 0.4, mk(zb), zb]], P.marking);
  }
  for (const x of [-1.6, 1.6]) {
    const y = ctvDeckY(6.2);
    kit.box([x - 0.6, x + 0.6], [y - 0.05, y + 0.06], [5.6, 6.8], paintOf('#6f7477', 0.6));
    kit.box([x - 0.5, x + 0.5], [y + 0.06, y + 0.075], [5.7, 6.7], paintOf('#5c6164', 0.96));
  }

  // --- aft deck: 10 ft container, small crane, rails, stern light post
  buildContainer(kit, -1.22, 1.22, C.foredeckY + 0.1, -10.9, -7.91, P.container);
  kit.rod([3.3, C.foredeckY, -12.2], [3.3, C.foredeckY + 1.2, -12.2], 0.28, P.yellow, 14);
  kit.rod([3.3, C.foredeckY + 1.2, -12.2], [3.2, C.foredeckY + 2.0, -9.4], 0.14, P.yellow, 10);
  kit.rod([3.2, C.foredeckY + 2.0, -9.4], [3.3, C.foredeckY + 1.4, -7.4], 0.11, P.yellow, 10);
  for (const s of [-1, 1]) railRun(kit, [edge(D.z0 - 0.3, s), edge(-10, s), edge(CTV_TRANSOM_Z + 0.25, s), [s * 1.2, C.foredeckY, CTV_TRANSOM_Z + 0.25]], 1.1);
  kit.rod([0, C.foredeckY, CTV_TRANSOM_Z + 0.2], [0, 3.45, CTV_TRANSOM_Z + 0.2], 0.05, P.steel, 6);
  kit.box([-0.08, 0.08], [3.35, 3.55], [CTV_TRANSOM_Z + 0.12, CTV_TRANSOM_Z + 0.3], P.dark);

  // lamps (local), floods (wide LED beams), sea sample points, name board
  const nav = (pos, cd, xy, beam, rel, half) => ({ pos, cd, xy, beam, rel, half });
  const lights = [
    nav([0, C.mastheadLightY, mz], C.lights.masthead.cd, LAMP_XY.navWhite, LAMP_BEAM.navigation, 0, C.lights.masthead.arcDeg / 2),
    nav([W.halfW + 0.28, 6.2, 2.3], C.lights.side.cd, LAMP_XY.navRed, LAMP_BEAM.sidelight, -C.lights.side.arcDeg / 2, C.lights.side.arcDeg / 2),
    nav([-(W.halfW + 0.28), 6.2, 2.3], C.lights.side.cd, LAMP_XY.navGreen, LAMP_BEAM.sidelight, C.lights.side.arcDeg / 2, C.lights.side.arcDeg / 2),
    nav([0, 3.45, CTV_TRANSOM_Z + 0.32], C.lights.stern.cd, LAMP_XY.navWhite, LAMP_BEAM.navigation, 180, C.lights.stern.arcDeg / 2),
  ];
  const floods = [
    { pos: [-0.8, R - 0.24, W.z1 + 0.72], dir: [0.05, -0.5, 1], halfDeg: 56 },     // foredeck + landing
    { pos: [0.8, R - 0.24, W.z1 + 0.72], dir: [-0.05, -0.5, 1], halfDeg: 56 },
    { pos: [0, R + 0.05, W.z0 - 0.34], dir: [0, -1.3, -1], halfDeg: 50 },            // aft deck
  ];
  const samples = [];
  for (const s of [-1, 1]) for (const z of [-10, -0.5, 9]) samples.push([s * CTV_HULL_X, z]);
  return { lights, floods, samples, nameBoard };
}

// ================================================================================================
// SOV geometry
// ================================================================================================
// Hull lines (ESTIMATED for an 80 m ECO Edison-class SOV): wall-sided amidships, a flared bow with
// a knuckle 2 m below the forecastle deck, the stem raked 4 m (waterline end aft of the deck end),
// a slightly raked transom, bilge radius 2.2 m, forefoot rising to the waterline.
const SOV_KNUCKLE_DROP = 2.0;
function sovSection(z) {
  const L2 = S.length / 2, bow = smooth(14, L2, z);
  const plan = (z0, w, p) => w * Math.pow(clamp(1 - Math.pow(Math.max(0, z - z0) / (L2 - z0), 2), 0, 1), p);
  const bD = Math.max(plan(8, S.beam / 2, 0.55), 0.05);                     // deck edge
  const bW = Math.max(Math.min(plan(2, S.beam / 2 - 0.05, 0.9), bD), 0.05); // waterline: finer entrance -> bow flare
  const yK = -S.draft + 3.2 * smooth(-L2 + 12, -L2, z) + 6.0 * Math.pow(smooth(18, L2 + 1, z), 1.8);
  const yD = S.mainDeckY + 3.4 * Math.pow(smooth(8, L2, z), 1.3);          // forecastle rises toward the bow
  return { bD, bW, yK, bilge: 2.2 * (1 - bow), yD, knuckle: smooth(2, 16, z) * (1 - smooth(L2 - 3, L2, z)) };
}
// Per-point rake: points below the deck move aft at the stem (4 m) and forward at the transom (1.2 m).
function sovRakeZ(z, y, s) {
  const L2 = S.length / 2, depth = clamp(1 - (y - s.yK) / Math.max(s.yD - s.yK, 0.1), 0, 1);
  return z - 4.0 * smooth(L2 - 20, L2, z) * depth + 1.2 * smooth(-L2 + 4, -L2, z) * depth;
}
// Accommodation decks (ESTIMATED from ECO Edison photos): the front ~18 m aft of the stem, four
// decks of 3.2 m, each stepped back 0.6 m; the bridge on top with wing cabs.
const SOV_TIERS = [                                   // y0, y1, aft z, front z, half-width
  { y0: 5.0, y1: 8.2, z0: 0.5, z1: 22.0, halfW: 8.6 },
  { y0: 8.2, y1: 11.4, z0: 0.5, z1: 21.4, halfW: 8.6 },
  { y0: 11.4, y1: 14.6, z0: 3.0, z1: 20.8, halfW: 7.8 },
  { y0: 14.6, y1: 17.8, z0: 9.5, z1: 20.2, halfW: 7.8 },
];
const SOV_BRIDGE = { y0: 17.8, y1: 21.6, z0: 11.0, z1: 19.8, halfW: 8.0, rake: 0.5, wingZ0: 15.4, wingZ1: 19.4, wingY1: 21.2 };

// Keep-out boxes in the vessel frames: [x0, x1, y0, y1, z0, z1] (hulls up to the deck edge, then
// the solid superstructure blocks; open decks stay walkable). The saloon's raked front takes two
// boxes, so the foredeck eye (z 3.9, y 3.9) keeps its 0.5 m clearance.
const CTV_KEEPOUTS = [
  [-4.45, 4.45, -1.5, 2.28, -13.5, 8.0], [-4.3, 4.3, -1.5, 2.8, 8.0, 13.5], [-1.55, 1.55, 2.8, 3.5, 12.9, 13.5],
  [-3.45, 3.45, 2.2, 3.2, -6.05, 3.25], [-3.4, 3.4, 3.2, 4.62, -6.0, 2.95],
  [-2.75, 2.75, 4.6, 6.56, -2.3, 2.7], [-1.25, 1.25, 2.3, 4.95, -10.95, -7.85],
];
const KEEPOUT_EXITS = [[0, 1], [0, -1], [2, 1], [2, -1], [1, 1]];     // ±x, ±z and up: never down into a hull
const SOV_KEEPOUTS = [
  [-9.5, 9.5, -6.0, 5.0, -40.0, 8.0], [-9.5, 9.5, -6.0, 8.45, 8.0, 40.0],
  [-9.5, 9.5, 5.0, 23.5, 0.45, 22.05], [-7.7, -5.3, 5.0, 25.0, -6.65, -0.85],
];

function buildSOV(kit, rng) {
  const P = PAINT, L2 = S.length / 2, B = SOV_BRIDGE, mz = 16.0;
  const zs = [];
  for (let z = -L2; z < -34; z += 1) zs.push(z);
  for (let z = -34; z < 20; z += 2) zs.push(z);
  for (let z = 20; z < L2; z += 1) zs.push(z);
  zs.push(L2);
  const ring = (s, z) => {
    const b = Math.min(s.bilge, s.bW * 0.8), yb = s.yK + b, yk = s.yD - SOV_KNUCKLE_DROP;
    const xk = s.bW + (s.bD - s.bW) * THREE.MathUtils.lerp(Math.max(yk, 0) / Math.max(s.yD, 0.1), 0.72, s.knuckle);
    const half = [[s.bD, s.yD], [xk, yk], [s.bW, 0], [s.bW, Math.min(yb, 0)]];
    for (let k = 1; k < 4; k++) { const a = (k / 4) * Math.PI / 2; half.push([s.bW - b + b * Math.cos(a), yb - b * Math.sin(a)]); }
    half.push([s.bW - b, s.yK]);
    return [...half.map(([x, y]) => [-x, y]), [0, s.yK], ...half.reverse()].map(([x, y]) => [x, y, sovRakeZ(z, y, s)]);
  };
  const shell = zs.map((z) => ({ z, pts: ring(sovSection(z), z) }));
  kit.add('hull', orientOutward(loft(shell), (x, y, z) => { const s = sovSection(clamp(z, -L2, L2)); return [x, y - 0.5 * (s.yK + s.yD), 0]; }));
  kit.add('hull', orientOutward(capFan(-L2, shell[0].pts), AFT));
  // main deck + forecastle deck (the aft working deck has sockets); bulwarks with cap rails forward
  const deck = (list) => loft(list.map((z) => { const s = sovSection(z); return { z, pts: [[s.bD - 0.05, s.yD - 0.05], [-(s.bD - 0.05), s.yD - 0.05]] }; }));
  kit.add('paint', orientOutward(deck([...zs.filter((z) => z < 6), 6]), UP), { ...P.sovDeck, pattern: 1 });
  kit.add('paint', orientOutward(deck([6, ...zs.filter((z) => z > 6)]), UP), P.sovDeck);
  for (const s of [-1, 1]) {
    const st = zs.filter((z) => z >= 6 && z <= L2 - 1.5).map((z) => { const sc = sovSection(z), b = sc.bD - 0.05, y = sc.yD - 0.05; return { z, pts: [[s * b, y], [s * b, y + 1.2], [s * (b - 0.25), y + 1.2], [s * (b - 0.25), y]] }; });
    kit.add('paint', orientOutward(loft(st), (x, y, z) => { const sc = sovSection(z); return [x - s * (sc.bD - 0.175), y - (sc.yD + 0.55), 0]; }), P.navy);
  }

  // --- accommodation: four stacked decks, discrete cabin windows at 2.0 m pitch (each cabin its own
  // occupancy and curtain draw), doors onto the side walkways, railings on the steps
  const cabin = () => glassOf(1, [1.15, 2, 3.5], 1 + 0.999 * rng());
  const frameO = { cr: 0.12, fw: 0.05 };
  const door = (a, b, c, d, n) => kit.framedPane('paint', a, b, c, d, n, P.offWhite, { cr: 0.1, fw: 0.06 });
  SOV_TIERS.forEach((T, k) => {
    kit.rblock('paint', { halfW: T.halfW, y0: T.y0, y1: T.y1, zb0: T.z0, zb1: T.z1 }, P.white, 0.1, 1);
    const wy0 = T.y0 + 1.15, wy1 = wy0 + 0.9;
    for (const s of [-1, 1]) {
      const x = s * T.halfW, n = V3(s, 0, 0);
      for (let z = T.z0 + 1.6, i = 0; z + 1.2 < T.z1 - 1.0; z += 2.0, i++) {
        if (k >= 2 && i === 6) door(V3(x, T.y0 + 0.05, z), V3(x, T.y0 + 0.05, z + 0.95), V3(x, T.y0 + 2.1, z + 0.95), V3(x, T.y0 + 2.1, z), n);
        else kit.framedPane('glass', V3(x, wy0, z), V3(x, wy0, z + 1.2), V3(x, wy1, z + 1.2), V3(x, wy1, z), n, cabin(), frameO);
      }
    }
    for (let x = -T.halfW + 1.2; x + 1.2 < T.halfW - 1.0; x += 2.0) kit.framedPane('glass', V3(x, wy0, T.z1), V3(x + 1.2, wy0, T.z1), V3(x + 1.2, wy1, T.z1), V3(x, wy1, T.z1), V3(0, 0, 1), cabin(), frameO);
    door(V3(1.0, T.y0 + 0.05, T.z0), V3(0.0, T.y0 + 0.05, T.z0), V3(0.0, T.y0 + 2.1, T.z0), V3(1.0, T.y0 + 2.1, T.z0), V3(0, 0, -1));
    const below = SOV_TIERS[k - 1];
    if (below) {
      railRun(kit, [[-below.halfW + 0.05, T.y0, below.z1 - 0.05], [below.halfW - 0.05, T.y0, below.z1 - 0.05]], 1.1);
      if (T.halfW < below.halfW - 0.3) for (const s of [-1, 1]) railRun(kit, [[s * (below.halfW - 0.05), T.y0, below.z1 - 0.05], [s * (below.halfW - 0.05), T.y0, T.z0 + 0.3]], 1.1);
    }
  });
  const top = SOV_TIERS[3];
  railRun(kit, [[-top.halfW + 0.05, top.y1, top.z1 - 0.05], [top.halfW - 0.05, top.y1, top.z1 - 0.05]], 1.1);

  // --- bridge: forward-raked windows over the console, wing cabs to full beam, roof with a rail
  kit.rblock('paint', { halfW: B.halfW, y0: B.y0, y1: B.y1, zb0: B.z0, zb1: B.z1, zt1: B.z1 + B.rake }, P.white, 0.1, 1);
  kit.rblock('paint', { halfW: S.beam / 2 - 0.05, y0: B.y1 - 0.02, y1: S.bridgeTopY, zb0: B.z0 - 0.2, zb1: B.z1 + B.rake + 0.6 }, P.white, 0.08, 1);
  const bFront = (y) => B.z1 + B.rake * (y - B.y0) / (B.y1 - B.y0), by0 = 18.8, by1 = 21.05, bw = { cr: 0.05, fw: 0.07 };
  const bridge = (kind, depth) => glassOf(0.008, [by0 - B.y0, kind, depth]);
  {
    const n = V3(0, -B.rake / (B.y1 - B.y0), 1).normalize(), pw = 1.42, gap = 0.11, cnt = Math.floor((2 * B.halfW - 0.4 + gap) / (pw + gap));
    for (let i = 0, xa = -0.5 * (cnt * pw + (cnt - 1) * gap); i < cnt; i++, xa += pw + gap) {
      kit.framedPane('glass', V3(xa, by0, bFront(by0)), V3(xa + pw, by0, bFront(by0)), V3(xa + pw, by1, bFront(by1)), V3(xa, by1, bFront(by1)), n, bridge(1, 8.5), bw);
    }
  }
  for (const s of [-1, 1]) {
    for (let z = B.z0 + 0.6; z + 1.3 < B.wingZ0 - 0.3; z += 1.6) kit.framedPane('glass', V3(s * B.halfW, by0, z), V3(s * B.halfW, by0, z + 1.3), V3(s * B.halfW, by1, z + 1.3), V3(s * B.halfW, by1, z), V3(s, 0, 0), bridge(3, 9.9), bw);
    const xi = s * (B.halfW - 0.2), xo = s * (S.beam / 2 - 0.05);
    kit.rblock('paint', { halfW: Math.abs(xo - xi) / 2, y0: B.y0 - 0.3, y1: B.wingY1, zb0: B.wingZ0, zb1: B.wingZ1, x: (xi + xo) / 2 }, P.white, 0.08, 1);
    kit.framedPane('glass', V3(xo, by0, B.wingZ0 + 0.3), V3(xo, by0, B.wingZ1 - 0.3), V3(xo, by1 - 0.3, B.wingZ1 - 0.3), V3(xo, by1 - 0.3, B.wingZ0 + 0.3), V3(s, 0, 0), bridge(3, 1.2), bw);
    kit.hexa([[xi, B.y0 - 0.3, B.wingZ0 + 0.5], [xo, B.y0 - 0.3, B.wingZ0 + 0.5], [xo, B.y0 - 0.3, B.wingZ1 - 0.5], [xi, B.y0 - 0.3, B.wingZ1 - 0.5],
      [xi, B.y0 - 1.6, B.wingZ0 + 0.5], [xi + s * 0.3, B.y0 - 0.35, B.wingZ0 + 0.5], [xi + s * 0.3, B.y0 - 0.35, B.wingZ1 - 0.5], [xi, B.y0 - 1.6, B.wingZ1 - 0.5]], P.white);
  }
  const hb = S.beam / 2 - 0.2;
  railRun(kit, [[-hb, S.bridgeTopY, B.z0], [-hb, S.bridgeTopY, B.z1 + 0.6], [hb, S.bridgeTopY, B.z1 + 0.6], [hb, S.bridgeTopY, B.z0]], 1.0);
  kit.rblock('paint', { halfW: 2.6, y0: SOV_TIERS[2].y1, y1: 23.5, zb0: 3.6, zb1: 9.2, zt0: 4.2 }, P.white, 0.15, 1);        // funnel casing
  for (const x of [-1.0, 1.0]) kit.rod([x, 23.5, 6.4], [x, 24.4, 6.4], 0.32, P.dark, 12);

  // --- main mast (radars, RAM lights on a bracket, day shapes), radomes, foremast
  kit.rod([0, S.bridgeTopY, mz], [0, S.mastY, mz], 0.35, P.white, 10, 0.2);
  kit.box([-3.5, 3.5], [25.25, 25.5], [mz - 0.3, mz + 0.3], P.white);
  kit.rod([0, 23.9, mz], [0, 23.9, mz + 1.05], 0.05, P.white, 6);
  kit.rod([0, 23.9, mz + 1.0], [0, 28.8, mz + 1.0], 0.045, P.white, 6);
  for (const y of [24.4, 26.4, 28.4]) kit.rod([0, y - 0.18, mz + 1.0], [0, y - 0.12, mz + 1.0], 0.09, P.dark, 10);
  kit.rod([0, 28.8, mz + 1.0], [0, 28.8, mz], 0.05, P.white, 6);
  kit.rod([0, 29.45, mz + 0.3], [0, 29.5, mz + 0.3], 0.1, P.dark, 10);
  for (const [y, w] of [[23.2, 2.6], [24.5, 2.0]]) {
    kit.box([-w / 2, w / 2], [y, y + 0.25], [mz - 0.95, mz - 0.65], P.dark);
    kit.box([-0.4, 0.4], [y - 0.35, y], [mz - 0.95, mz - 0.25], P.white);
  }
  for (const [x, z, r] of [[4.5, 18.0, 1.1], [-4.5, 18.0, 1.1], [0, 19.5, 0.8]]) kit.add('paint', new THREE.SphereGeometry(r, 16, 10).translate(x, S.bridgeTopY + r, z), P.white);
  kit.rod([-2.6, 25.25, mz], [-2.6, 22.5, mz], 0.012, P.dark, 4);                                   // Rule 27(b)(ii): ball-diamond-ball
  for (const y of [24.8, 23.0]) kit.add('paint', new THREE.SphereGeometry(0.3, 12, 8).translate(-2.6, y, mz), P.dark);
  kit.add('paint', new THREE.OctahedronGeometry(0.42).scale(0.72, 1, 0.72).translate(-2.6, 23.9, mz), P.dark);
  kit.rod([0, sovSection(36).yD, 36], [0, 17.8, 36], 0.18, P.white, 8);

  // --- gangway system (starboard, amidships): slewing pedestal and turret at the pivot, a clad
  // elevator tower (2.4 x 2.4 m) beside it to the same top level, a short bridge between them
  const [gx, gy, gz] = SOV_GANGWAY_PIVOT, et = { z0: gz - 4.6, z1: gz - 2.2 }, tower = glassOf(0.4, [1, 3, 2.2]);
  kit.rod([gx, S.mainDeckY, gz], [gx, gy - 1.4, gz], 1.05, P.white, 20);
  kit.rod([gx, gy - 1.4, gz], [gx, gy - 1.0, gz], 1.45, P.galv, 24);
  kit.rblock('paint', { halfW: 1.25, y0: gy - 1.0, y1: gy, zb0: gz - 1.1, zb1: gz + 1.1, x: gx + 0.2 }, P.white, 0.08, 1);
  kit.framedPane('glass', V3(gx + 1.45, gy - 0.75, gz - 0.6), V3(gx + 1.45, gy - 0.75, gz + 0.6), V3(gx + 1.45, gy - 0.2, gz + 0.6), V3(gx + 1.45, gy - 0.2, gz - 0.6), V3(1, 0, 0), tower, { cr: 0.05, fw: 0.05 });
  kit.rblock('paint', { halfW: 1.2, y0: S.mainDeckY, y1: gy, zb0: et.z0, zb1: et.z1, x: gx }, P.white, 0.06, 1);
  for (let y = S.mainDeckY + 2.4; y < gy - 0.5; y += 2.4) kit.box([gx - 1.22, gx + 1.22], [y, y + 0.03], [et.z0 - 0.02, et.z1 + 0.02], P.offWhite);
  for (const y of [S.mainDeckY + 0.02, gy - 3.05]) door(V3(gx + 1.2, y, et.z0 + 0.7), V3(gx + 1.2, y, et.z0 + 1.7), V3(gx + 1.2, y + 2.05, et.z0 + 1.7), V3(gx + 1.2, y + 2.05, et.z0 + 0.7), V3(1, 0, 0));
  for (let y = S.mainDeckY + 4.0; y < gy - 4; y += 4.8) kit.framedPane('glass', V3(gx + 1.2, y, et.z0 + 0.8), V3(gx + 1.2, y, et.z0 + 1.6), V3(gx + 1.2, y + 0.9, et.z0 + 1.6), V3(gx + 1.2, y + 0.9, et.z0 + 0.8), V3(1, 0, 0), tower, { cr: 0.1, fw: 0.05 });
  kit.box([gx - 0.8, gx + 0.8], [gy - 1.05, gy - 0.95], [et.z1, gz - 1.05], P.galv);
  for (const s of [-1, 1]) railRun(kit, [[gx + s * 0.8, gy - 0.95, et.z1], [gx + s * 0.8, gy - 0.95, gz - 1.1]], 1.0);

  // --- aft working deck: crane, containers; rescue boat in its davit (port, by the accommodation); rails
  kit.rod([6.0, S.mainDeckY, -30], [6.0, S.mainDeckY + 4.5, -30], 1.2, P.yellow, 14);
  kit.rblock('paint', { halfW: 1.4, y0: S.mainDeckY + 4.5, y1: S.mainDeckY + 6.8, zb0: -31.5, zb1: -28.5, x: 6.0 }, P.white, 0.1, 1);
  kit.rod([6.0, S.mainDeckY + 6.0, -29.0], [3.5, S.mainDeckY + 10.5, -10.0], 0.45, P.yellow, 8, 0.3);
  for (const [x, z, p] of [[-4, -24, P.greyBlue], [0, -24, P.white], [-4, -18, P.container], [2.5, -17, P.greyBlue]]) buildContainer(kit, x - 1.22, x + 1.22, S.mainDeckY, z - 3.0, z + 3.0, p);
  kit.add('paint', new THREE.CapsuleGeometry(1.2, 4.6, 4, 10).rotateX(Math.PI / 2).scale(1, 0.62, 1).translate(7.9, 10.2, -3.0), P.orange);
  kit.box([7.2, 8.6], [10.6, 11.4], [-4.4, -1.4], P.white);
  for (const z of [-5, -1]) kit.rod([7.6, S.mainDeckY, z], [8.2, 12.5, z], 0.16, P.white, 6);
  for (const [x, z0, z1] of [[-9.2, -39.0, -6.5], [-9.2, -1.0, 5.5], [9.2, -39.0, -3.5]]) railRun(kit, [[x, S.mainDeckY, z0], [x, S.mainDeckY, z1]], 1.1);

  const t2 = SOV_TIERS[2], nav = (name, pos, cd, xy, rel, half, underway = true) => ({ name, pos, cd, xy, beam: LAMP_BEAM.navigation, rel, half, underway });
  const lights = [
    nav('masthead-fwd', [0, 17.9, 36], S.lights.masthead.cd, LAMP_XY.navWhite, 0, 112.5),
    nav('masthead-aft', [0, 29.62, mz + 0.3], S.lights.masthead.cd, LAMP_XY.navWhite, 0, 112.5),
    // COLREGS Annex I §2(g): sidelights no higher than 3/4 of the forward masthead light above the
    // hull (<= 14.7 m here): on screens at the forward corners of the second accommodation deck
    { ...nav('port', [t2.halfW + 0.35, 13.0, t2.z1 - 0.4], S.lights.side.cd, LAMP_XY.navRed, -56.25, 56.25), beam: LAMP_BEAM.sidelight },
    { ...nav('starboard', [-(t2.halfW + 0.35), 13.0, t2.z1 - 0.4], S.lights.side.cd, LAMP_XY.navGreen, 56.25, 56.25), beam: LAMP_BEAM.sidelight },
    nav('stern', [0, 7.5, -L2 + 0.5], S.lights.stern.cd, LAMP_XY.navWhite, 180, 67.5),
    // Rule 27(b): restricted in ability to manoeuvre, all-round red-white-red, 2 m apart
    ...[[28.4, LAMP_XY.navRed], [26.4, LAMP_XY.navWhite], [24.4, LAMP_XY.navRed]].map(([y, xy]) => nav('ram', [0, y, mz + 1.0], S.lights.rabRedWhiteRed.cd, xy, 0, 180, false)),
  ];
  for (const s of [-1, 1]) kit.box([s * (t2.halfW + 0.02), s * (t2.halfW + 0.5)].sort((a, b) => a - b), [12.7, 13.3], [t2.z1 - 0.9, t2.z1 - 0.1], P.dark);   // sidelight screens
  const floods = [
    { pos: [-3.2, 26.0, mz - 0.4], dir: [0.1, -0.6, -1], halfDeg: 50 },     // over the working deck
    { pos: [3.2, 26.0, mz - 0.4], dir: [-0.1, -0.6, -1], halfDeg: 50 },
    { pos: [gx, gy + 0.3, gz + 1.6], dir: [-1, -0.25, 0], halfDeg: 40 },    // along the gangway
    { pos: [gx + 2.3, gy - 2.4, gz], dir: [0.3, -1, 0], halfDeg: 60 },       // tower foot
    { pos: [6.0, S.mainDeckY + 7.0, -28.5], dir: [0, -1, 0.3], halfDeg: 60 },  // crane house
    { pos: [0, S.bridgeTopY - 0.2, B.z0 - 0.2], dir: [0, -0.7, -1], halfDeg: 55 },
  ];
  const samples = [];
  for (const s of [-1, 1]) for (const z of [-30, 0, 30]) samples.push([s * 8, z]);
  return { lights, floods, samples };
}

// Gangway truss in its own frame (pivot at the origin, +z out): side trusses with a yellow handrail
// at 1.1 m, knee rail, bottom chord, posts every 2 m bay, toe plates, grating walkway
// (ESTIMATED from Ulmatec / Uptime W2W gangways).
function buildGangwayTruss(len, halfW, tip) {
  const k = new Kit(), P = PAINT, bays = Math.max(1, Math.round(len / 2.0)), bl = len / bays;
  for (const s of [-1, 1]) {
    const x = s * halfW;
    k.box([x - 0.09, x + 0.09], [-0.12, 0.1], [0, len], P.white);
    k.rod([x, 1.1, 0], [x, 1.1, len], 0.03, P.yellow, 8);
    k.rod([x, 0.55, 0], [x, 0.55, len], 0.022, P.white, 6);
    k.box([x - 0.012, x + 0.012], [0.1, 0.25], [0, len], P.white);
    for (let b = 0; b <= bays; b++) {
      const z = b * bl;
      k.box([x - 0.04, x + 0.04], [0.1, 1.1], [z - 0.04, z + 0.04], P.white);
    }
  }
  k.box([-halfW, halfW], [-0.04, 0.03], [0, len], P.galv);
  for (let z = 0.5; z < len; z += 1.0) k.box([-halfW, halfW], [-0.12, -0.04], [z - 0.05, z + 0.05], P.white);
  if (tip) k.box([-0.75, 0.75], [-0.2, 0.05], [len - 0.4, len + 0.1], P.dark);   // tip bumper
  return k.merged().paint;
}

// ================================================================================================
// Route: Dubins paths between landings with a speed plan (CTV)
// ================================================================================================
// Planar frame for the planner: E = world x, N = -world z; heading angle θ counter-clockwise from E.
const thetaOf = (headingDeg) => (90 - headingDeg) * DEG;
const headingOf = (theta) => ((90 - theta / DEG) % 360 + 360) % 360;
const angNorm = (a) => ((a % TAU) + TAU) % TAU;

// Shortest CSC Dubins path (LSL, RSR, LSR, RSL) from pose (p0, θ0) to (p1, θ1) with radius R.
function dubins(p0, th0, p1, th1, R) {
  const centre = (p, th, l) => [p[0] + (l ? -R : R) * Math.sin(th), p[1] + (l ? R : -R) * Math.cos(th)];
  const off = (phi, l) => (l ? [Math.sin(phi) * R, -Math.cos(phi) * R] : [-Math.sin(phi) * R, Math.cos(phi) * R]);
  let best = null;
  for (const [l0, l1] of [[true, true], [false, false], [true, false], [false, true]]) {
    const c0 = centre(p0, th0, l0), c1 = centre(p1, th1, l1), D = Math.hypot(c1[0] - c0[0], c1[1] - c0[1]);
    let phi = Math.atan2(c1[1] - c0[1], c1[0] - c0[0]), Lline = D;
    if (l0 !== l1) {
      if (D < 2 * R) continue;
      Lline = Math.sqrt(D * D - 4 * R * R);
      phi += (l0 ? 1 : -1) * Math.atan2(2 * R, Lline);
    }
    // tangent points: the centre is to the left of motion on a left arc, to the right on a right arc
    const o0 = off(phi, l0), o1 = off(phi, l1), t0 = [c0[0] + o0[0], c0[1] + o0[1]], t1 = [c1[0] + o1[0], c1[1] + o1[1]];
    const sweep0 = angNorm(l0 ? phi - th0 : th0 - phi), sweep1 = angNorm(l1 ? th1 - phi : phi - th1);
    const len = R * (sweep0 + sweep1) + Math.hypot(t1[0] - t0[0], t1[1] - t0[1]);
    if (!best || len < best.len) best = { len, segs: [{ arc: true, c: c0, left: l0, th: th0, sweep: sweep0 }, { arc: false, a: t0, b: t1 }, { arc: true, c: c1, left: l1, th: phi, sweep: sweep1 }] };
  }
  return best;
}

// Samples a Dubins path followed by a straight line into `lineTo` every metre: { x: E, n: N, th, k: curvature }.
function samplePath(dub, R, lineTo) {
  const out = { x: [], n: [], th: [], k: [] };
  const push = (x, n, th, k) => { out.x.push(x); out.n.push(n); out.th.push(th); out.k.push(k); };
  const line = (a, b, last) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]), steps = Math.max(1, Math.ceil(len)), th = Math.atan2(b[1] - a[1], b[0] - a[0]);
    for (let i = 0; i < steps + last; i++) push(a[0] + (b[0] - a[0]) * i / steps, a[1] + (b[1] - a[1]) * i / steps, th, 0);
  };
  for (const s of dub.segs) {
    if (!s.arc) { line(s.a, s.b, 0); continue; }
    const steps = Math.max(1, Math.ceil(R * s.sweep)), sg = s.left ? 1 : -1;
    for (let i = 0; i < steps; i++) {
      const th = s.th + sg * s.sweep * i / steps;
      push(s.c[0] + sg * Math.sin(th) * R, s.c[1] - sg * Math.cos(th) * R, th, 1 / R);   // centre + R * (the perpendicular to the boat)
    }
  }
  line([out.x[out.x.length - 1], out.n[out.n.length - 1]], lineTo, 1);
  return out;
}

// Speed plan along sampled points: curvature and approach caps, acceleration limits both ways.
// Final approach cap by distance to the landing: creep over the last 15 m, 2.5 m/s inside 180 m,
// coming off the plane over the 450 m before that.
function planSpeed(path, vEnd) {
  const n = path.x.length, s = new Float64Array(n), v = new Float64Array(n), t = new Float64Array(n);
  for (let i = 1; i < n; i++) s[i] = s[i - 1] + Math.hypot(path.x[i] - path.x[i - 1], path.n[i] - path.n[i - 1]);
  const L = s[n - 1];
  const cap = (r) => (r < 15 ? CTV_CONTACT_SPEED + (CTV_APPROACH - CTV_CONTACT_SPEED) * r / 15 : r < 180 ? CTV_APPROACH : r < 630 ? CTV_APPROACH + (CTV_TRANSIT - CTV_APPROACH) * (r - 180) / 450 : Infinity);
  for (let i = 0; i < n; i++) v[i] = Math.min(CTV_TRANSIT, Math.sqrt(CTV_LAT_ACCEL / Math.max(path.k[i], 1e-6)), cap(L - s[i]));
  v[0] = 0; v[n - 1] = Math.min(v[n - 1], vEnd);
  for (let i = 1; i < n; i++) v[i] = Math.min(v[i], Math.sqrt(v[i - 1] ** 2 + 2 * CTV_ACCEL * (s[i] - s[i - 1])));
  for (let i = n - 2; i >= 0; i--) v[i] = Math.min(v[i], Math.sqrt(v[i + 1] ** 2 + 2 * CTV_DECEL * (s[i + 1] - s[i])));
  for (let i = 1; i < n; i++) t[i] = t[i - 1] + (s[i] - s[i - 1]) / Math.max(0.5 * (v[i] + v[i - 1]), 0.05);
  return { s, v, t, duration: t[n - 1], length: L };
}

class CtvRoute {
  // landings: [{ name, turbine: {x, z, id}, contact: {x, z} (vessel origin), axis: unit (x, z) out from the TP, heading, holdS }]
  constructor(landings) {
    this.landings = landings;
    this.legs = [];
    const add = (leg) => { leg.t0 = this.legs.length ? this.legs[this.legs.length - 1].t1 : 0; leg.t1 = leg.t0 + leg.duration; this.legs.push(leg); };
    landings.forEach((A, i) => {
      const B = landings[(i + 1) % landings.length], back = CTV_BACK_OFF;
      add({ kind: 'hold', name: `hold-${A.name}`, landing: A, duration: A.holdS });
      // reverse off the landing (trapezoid in time), then forward: Dubins from the backed-off pose to
      // the approach start, then the final approach line
      const ta = CTV_REVERSE_SPEED / CTV_REVERSE_ACCEL, cruise = Math.max(0, back - CTV_REVERSE_SPEED * ta) / CTV_REVERSE_SPEED;
      add({ kind: 'reverse', name: `back-${A.name}`, landing: A, ta, cruise, duration: 2 * ta + cruise });
      const at = (L, r) => [L.contact.x + L.axis.x * r, -(L.contact.z + L.axis.z * r)];
      const path = samplePath(dubins(at(A, back), thetaOf(A.heading), at(B, CTV_APPROACH_LINE), thetaOf(B.heading), CTV_TURN_RADIUS), CTV_TURN_RADIUS, at(B, 0));
      const plan = planSpeed(path, CTV_CONTACT_SPEED);
      add({ kind: 'transit', name: `to-${B.name}`, from: A, landing: B, path, plan, duration: plan.duration });
    });
    this.period = this.legs[this.legs.length - 1].t1;
  }

  // Pose at cycle time tc: { x, z, heading (deg), speed (m/s, < 0 astern), accel, yawRate (rad/s), leg, holdAge }
  pose(tc, out) {
    tc = ((tc % this.period) + this.period) % this.period;
    const leg = this.legs.find((l) => tc < l.t1) || this.legs[this.legs.length - 1], lt = tc - leg.t0, L = leg.landing;
    Object.assign(out, { leg, holdAge: 0, accel: 0, yawRate: 0, x: L.contact.x, z: L.contact.z, heading: L.heading, speed: 0 });
    if (leg.kind === 'hold') { out.holdAge = lt; return out; }
    if (leg.kind === 'reverse') {
      const { ta, cruise } = leg, V = CTV_REVERSE_SPEED, a = CTV_REVERSE_ACCEL;
      let d, v, acc;
      if (lt < ta) { d = 0.5 * a * lt * lt; v = a * lt; acc = a; }
      else if (lt < ta + cruise) { d = 0.5 * V * ta + V * (lt - ta); v = V; acc = 0; }
      else { const u = Math.min(lt - ta - cruise, ta); d = 0.5 * V * ta + V * cruise + V * u - 0.5 * a * u * u; v = V - a * u; acc = -a; }
      out.x += L.axis.x * d; out.z += L.axis.z * d; out.speed = -v; out.accel = -acc;
      return out;
    }
    // transit: interpolate the planned samples by time
    const { path, plan } = leg, T = plan.t;
    let lo = 0, hi = T.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (T[mid] <= lt) lo = mid; else hi = mid; }
    const dt = Math.max(T[hi] - T[lo], 1e-3), f = clamp((lt - T[lo]) / dt, 0, 1);
    let dth = path.th[hi] - path.th[lo];
    dth = Math.atan2(Math.sin(dth), Math.cos(dth));
    out.x = path.x[lo] + (path.x[hi] - path.x[lo]) * f;
    out.z = -(path.n[lo] + (path.n[hi] - path.n[lo]) * f);
    out.heading = headingOf(path.th[lo] + dth * f);
    out.speed = plan.v[lo] + (plan.v[hi] - plan.v[lo]) * f;
    out.accel = (plan.v[hi] - plan.v[lo]) / dt;
    out.yawRate = -dth / dt;                                   // compass heading rate (rad/s, + = turning right)
    return out;
  }

  // Cycle time of a named moment (for seek): 'hero' / 'partner' in the hold, 'transit' mid-way to
  // the hero at full speed, 'approach' 90 s before touching the hero landing.
  timeOf(name) {
    const [hero, partner] = this.landings, leg = (n) => this.legs.find((l) => l.name === n);
    if (name === 'hero') return leg(`hold-${hero.name}`).t0 + 25;
    if (name === 'partner') return leg(`hold-${partner.name}`).t0 + 0.5 * partner.holdS;
    if (name === 'approach') return leg(`to-${hero.name}`).t1 - 90;
    if (name !== 'transit') return null;
    const l = leg(`to-${hero.name}`), v = l.plan.v;
    let i = Math.floor(v.length / 2);
    while (i < v.length - 1 && v[i] < CTV_TRANSIT - 0.01) i++;
    return l.t0 + l.plan.t[i];
  }
}

// ================================================================================================
// Seakeeping: damped heave / pitch / roll following a plane fitted to the sea under the hull
// ================================================================================================
const MODES = ['heave', 'pitch', 'roll'];
class Seakeeping {
  // samples: hull points [x, z] (vessel frame); modes: { heave: [period s, damping ratio], pitch, roll }
  constructor(samples, modes) {
    this.samples = samples;
    this.modes = modes;
    this.state = { heave: [0, 0], pitch: [0, 0], roll: [0, 0] };
    this.target = { heave: 0, pitch: 0, roll: 0 };
    this.fresh = true;
    this.surge = 0;                         // along-ship orbital velocity at the bow samples (m/s)
    this._surf = { y: 0, normal: V3(0, 0, 0), velocity: V3(0, 0, 0) };
    this._zz = samples.reduce((a, s) => a + s[1] * s[1], 0);
    this._xx = samples.reduce((a, s) => a + s[0] * s[0], 0);
    this._nBow = Math.max(1, samples.filter((s) => s[1] > 0).length);
  }

  // Samples the sea at the hull points for pose (x, z, heading) and fits heave + slopes.
  sense(ocean, x, z, headingDeg, t) {
    const h = headingDeg * DEG, fx = Math.sin(h), fz = -Math.cos(h);   // bow (fx, fz); local +x (port) is (fz, -fx)
    let sum = 0, sz = 0, sx = 0, bow = 0;
    for (const [ax, az] of this.samples) {
      const wx = x + fx * az + fz * ax, wz = z + fz * az - fx * ax;
      let y = 0;
      if (ocean) { ocean.getSurface(wx, wz, t, this._surf); y = this._surf.y + curvatureDrop(wx, wz); if (az > 0) bow += this._surf.velocity.x * fx + this._surf.velocity.z * fz; }
      sum += y; sz += y * az; sx += y * ax;
    }
    this.target.heave = sum / this.samples.length;
    this.target.pitch = Math.atan(sz / this._zz);                        // + = bow up
    this.target.roll = Math.atan(sx / this._xx);                         // + = port side up
    this.surge = bow / this._nBow;
  }

  // Integrates the three modes toward target + bias (semi-implicit Euler, 120 Hz sub-steps).
  step(dt, bias) {
    if (this.fresh || dt <= 0) {
      if (this.fresh) for (const k of MODES) this.state[k] = [this.target[k] + (bias[k] || 0), 0];
      this.fresh = false;
      return;
    }
    const n = Math.ceil(dt * 120), h = dt / n;
    for (const k of MODES) {
      const [T, zeta] = this.modes[k], w = TAU / T, s = this.state[k], goal = this.target[k] + (bias[k] || 0);
      for (let i = 0; i < n; i++) { s[1] += (w * w * (goal - s[0]) - 2 * zeta * w * s[1]) * h; s[0] += s[1] * h; }
    }
  }
}

// ================================================================================================
// Wake decal beyond the ocean's foam map, spray drops and the chine spray sheet
// ================================================================================================
// the ocean's wake-foam age law (ocean-effects.js: white water e-folding in 9 s, lace in 0.75 x life,
// faded out over the last 30 % of the life), so the decal continues the trail map without a seam
const foamDensity = (age, life) => Math.min(0.95 * Math.exp(-age / 9) + 0.45 * Math.exp(-age / (0.75 * life)), 1) * (1 - smooth(0.7 * life, life, age));

// Ribbons of three rows (edge, centre, edge) laid flat on the mean sea, alpha at the centre row only;
// consecutive ribbons share one index strip with zero-alpha joins.
class WakeDecal {
  constructor(max = 900) {
    this.max = max;
    this.pos = new Float32Array(max * 9);
    this.col = new Float32Array(max * 12);
    const g = new THREE.BufferGeometry(), idx = [];
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(max * 9).map((_, i) => +(i % 3 === 1)), 3));
    for (let a = 0; a < (max - 1) * 3; a += 3) idx.push(a, a + 1, a + 3, a + 1, a + 4, a + 3, a + 1, a + 2, a + 4, a + 2, a + 5, a + 4);
    g.setIndex(idx);
    this.material = applyAtmosphere(new THREE.MeshStandardMaterial({ name: 'vessels.wakeDecal', color: 0xb8b8b8, roughness: 1, vertexColors: true, transparent: true, depthWrite: false }));
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.name = 'vessels.wakeDecal';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.n = 0;
  }

  // Lays the ribbons [[{ x, z, width, alpha }, ...], ...] seen from `cam`. A flat decal seen at
  // grazing incidence would float over the crests: it fades with the view depression (0.25-1.5°),
  // and hands over to the ocean's trail map at its ±256 m edge (the same square metric).
  set(ribbons, cam) {
    let n = 0, vis = false;
    for (const pts of ribbons) {
      if (pts.length < 2 || n + pts.length > this.max) continue;
      pts.forEach((p, i) => {
        const q = pts[Math.min(i + 1, pts.length - 1)], o = pts[Math.max(i - 1, 0)], L = Math.hypot(q.x - o.x, q.z - o.z) || 1;
        const dx = (q.x - o.x) / L, dz = (q.z - o.z) / L, hw = p.width / 2, y = DECAL_LIFT - curvatureDrop(p.x, p.z);
        const far = 1 - smooth(0, 0.05, 0.5 - Math.max(Math.abs(p.x - cam.x), Math.abs(p.z - cam.z)) / (2 * TRAIL_MAP_HALF));
        const dep = Math.atan2(cam.y - y, Math.hypot(p.x - cam.x, p.z - cam.z)) / DEG;
        const a = i && i < pts.length - 1 ? p.alpha * far * smooth(0.25, 1.5, dep) : 0;
        vis ||= a > 0.004;
        this.pos.set([p.x + dz * hw, y, p.z - dx * hw, p.x, y, p.z, p.x - dz * hw, y, p.z + dx * hw], n * 9);
        this.col.set([1, 1, 1, 0, 1, 1, 1, a, 1, 1, 1, 0], n * 12);
        n++;
      });
    }
    const g = this.mesh.geometry;
    g.attributes.position.needsUpdate = g.attributes.color.needsUpdate = true;
    g.setDrawRange(0, Math.max(0, (n - 1) * 12));
    this.mesh.visible = vis;
  }
}

// Water lit in the vertex stage (drops, sheet): diffuse white with a forward-scattering lobe toward
// the sun (4π-normalised Henyey-Greenstein, g = 0.6), moonlight and the sky ambient; then aerial perspective.
const WATER_LIGHT_GLSL = /* glsl */`
uniform vec3 uSunIllum;
uniform vec3 uSunDirW;
uniform vec3 uMoonIllum;
uniform vec3 uAmbient;
vec3 waterLight(vec3 p) {
	float hg = 0.64 / pow(1.36 - 1.2 * dot(-uSunDirW, normalize(cameraPosition - p)), 1.5);
	return applyAerialPerspective(0.75 / PI * (uSunIllum * cloudShadow(p) * (0.5 + 0.5 * min(hg, 9.0)) + uMoonIllum) + 0.75 * uAmbient, p);
}
`;
function waterMaterial(ctx, name, vertexShader, fragmentShader, extra, side) {
  const uniforms = {
    ...(ctx.atmosphere?.uniforms || {}),
    uSunIllum: U.uSunIlluminance, uSunDirW: U.uSunDir, uMoonIllum: U.uMoonIlluminance, uAmbient: { value: new THREE.Color() }, ...extra,
  };
  const head = `#include <common>\n#include <logdepthbuf_pars_vertex>\n${ctx.atmosphere?.glslCore || NO_ATMOSPHERE_GLSL}\n${HASH_GLSL}${WATER_LIGHT_GLSL}`;
  return new THREE.ShaderMaterial({
    name, uniforms, vertexShader: head + vertexShader, side: side ?? THREE.FrontSide,
    fragmentShader: `#include <common>\n#include <logdepthbuf_pars_fragment>\n${fragmentShader}`,
    transparent: true, depthWrite: false,
  });
}

// Drops with linear air drag, stateless on the GPU: each slot is launched from a fixed point on the
// chine (vessel frame, scaled with speed) every SPRAY_CYCLE_S at its own phase; the launch point is
// carried back along the hull's velocity by the drop's age, so drops in flight stay in the world
// frame. Drawn as velocity-stretched capsules: a drop of diameter d moving at v during a ~1/30 s
// exposure paints a streak v·0.03 long and d wide; each pixel on it is covered for d / streak of the
// exposure, which sets its alpha. Lit per drop in the vertex stage.
const SPRAY_VERTEX = /* glsl */`
attribute vec4 aP;          // launch point (vessel frame at 22 kn: chine x, y above the waterline, z), w phase
attribute vec4 aV;          // lateral reach (m) and launch speed (m/s), up speed, forward fraction of the hull speed
uniform mat4 uHull;         // the hull's world matrix
uniform vec4 uHullV;        // xyz hull velocity (world), w speed / 22 kn
uniform vec2 uSpray;        // x launching fraction of the slots, y sea level (world y)
uniform float uTime;
uniform float uPxPerRad;
uniform vec2 uViewportPx;
varying vec4 vColour;
varying vec2 vQ;
varying vec2 vWL;
void main() {
	vQ = position.xy;
	vWL = vec2(1.0);
	vColour = vec4(0.0);
	gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
	float k2 = uHullV.w, age = fract(uTime / ${SPRAY_CYCLE_S.toFixed(1)} + aP.w) * ${SPRAY_CYCLE_S.toFixed(1)}, k = ${SPRAY_DRAG.toFixed(2)}, ek = exp(-k * age), e = 1.0 - ek;
	if (fract(aP.w * 97.13) > uSpray.x) return;
	vec3 v0 = mat3(uHull) * vec3(aV.y * k2, aV.z * k2, aV.w * length(uHullV.xyz));
	vec3 p = (uHull * vec4(aP.x + aV.x * k2, aP.y * k2, aP.z, 1.0)).xyz - uHullV.xyz * age + v0 * (e / k);
	p.y -= 9.81 * (age / k - e / (k * k));
	vec3 v = v0 * ek; v.y -= 9.81 * e / k;
	if (p.y < uSpray.y - 0.05) return;                              // back in the sea
	vec4 mv = viewMatrix * vec4(p, 1.0);
	vec3 vv = (viewMatrix * vec4(v, 0.0)).xyz * 0.015;
	vec4 ca = projectionMatrix * vec4(mv.xyz - vv, 1.0), cb = projectionMatrix * vec4(mv.xyz + vv, 1.0);
	vec2 dPx = (cb.xy / max(cb.w, 1e-3) - ca.xy / max(ca.w, 1e-3)) * 0.5 * uViewportPx;
	float Lpx = length(dPx), hsh = hash13(aP.xyz * 13.7 + aP.w);
	vec2 dir = Lpx > 1e-3 ? dPx / Lpx : vec2(0.0, 1.0), nrm = vec2(dir.y, -dir.x);
	float wpx = (0.008 + 0.03 * hsh * hsh * hsh) * (1.0 + 0.8 * age) * uPxPerRad / max(-mv.z, 0.1), wD = max(wpx, 1.2), lD = max(Lpx, wD);
	float a = (0.35 + 0.25 * hsh) * (wpx / wD) * sqrt(min(1.0, wpx / max(Lpx, wpx))) * (1.0 - smoothstep(0.5, 1.4, age));
	if (a < 0.002) return;
	vWL = vec2(wD, lD);
	vColour = vec4((0.8 + 0.4 * hsh) * waterLight(p), a);
	gl_Position = projectionMatrix * mv;
	gl_Position.xy += (nrm * (0.5 * wD * position.x) + dir * (0.5 * lD * position.y)) * 2.0 / uViewportPx * gl_Position.w;
	#include <logdepthbuf_vertex>
}`;
const SPRAY_FRAGMENT = /* glsl */`
varying vec4 vColour;
varying vec2 vQ;
varying vec2 vWL;
void main() {
	#include <logdepthbuf_fragment>
	float r = 0.5 * vWL.x, h = max(0.5 * vWL.y - r, 0.0);
	float a = 1.0 - smoothstep(0.35, 1.0, length(vec2(vQ.x * r, max(abs(vQ.y) * 0.5 * vWL.y - h, 0.0))) / max(r, 1e-3));
	gl_FragColor = vec4(vColour.rgb, vColour.a * a);
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`;

class BowSpray {
  constructor(ctx, n) {
    // per slot: where on the chine it launches (the spray root z 3.5-10.5, 0.25-0.9 m up, 0.8-2 m
    // out), thrown out 2-6 m/s and up 2.5-5.5 m/s at 22 kn (1-2 m high, back in the sea within
    // ~1 s), keeping 5-30 % of the hull's forward speed; the tunnel side throws half as far
    // (rooster-tail slots: launched 0.8-4.3 m behind a transom, ±0.4 m off the jet line, 1.5-4 m/s up,
    // ±0.4 m/s sideways, keeping 35-70 % of the hull speed, so the plume stands ~1-6 m astern)
    const rnd = mulberry32(0x5b7a4), P = [], V = [];
    for (let i = 0; i < n; i++) {
      const side = rnd() < 0.5 ? 1 : -1, outer = rnd() < 0.71 ? 1 : -1, u = rnd(), zl = 10.5 - 7 * u, so = side * outer;
      if (i < 0.3 * n) {
        P.push(side * CTV_HULL_X + 0.8 * (u - 0.5), 0.4 + 0.4 * rnd(), CTV_TRANSOM_Z - 0.8 - 3.5 * rnd() ** 1.5, rnd());
        V.push(0, 0.8 * (rnd() - 0.5), 1.5 + 2.5 * rnd(), 0.35 + 0.35 * rnd());
        continue;
      }
      P.push(side * CTV_HULL_X + so * (ctvSection(zl).bW + 0.05), (0.25 + 0.6 * rnd()) * (1.1 - 0.5 * u), zl, rnd());
      V.push(so * (0.8 + 1.2 * rnd()) * (outer > 0 ? 1 : 0.5), so * (2 + 4 * rnd()), (2.5 + 3 * rnd()) * (1.15 - 0.5 * u), 0.05 + 0.25 * rnd());
    }
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    g.setAttribute('aP', new THREE.InstancedBufferAttribute(new Float32Array(P), 4));
    g.setAttribute('aV', new THREE.InstancedBufferAttribute(new Float32Array(V), 4));
    g.instanceCount = n;
    this.material = waterMaterial(ctx, 'vessels.spray', SPRAY_VERTEX, SPRAY_FRAGMENT, {
      uTime: { value: 0 }, uHull: { value: new THREE.Matrix4() }, uHullV: { value: new THREE.Vector4() }, uSpray: { value: new THREE.Vector2() },
      uPxPerRad: { value: 800 }, uViewportPx: { value: new THREE.Vector2(1, 1) },
    });
    this.uniforms = this.material.uniforms;
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.name = 'vessels.spray';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    const viewport = new THREE.Vector4();
    this.mesh.onBeforeRender = (renderer, scene, camera) => {
      renderer.getCurrentViewport(viewport);
      this.uniforms.uViewportPx.value.set(Math.max(1, viewport.z), Math.max(1, viewport.w));
      this.uniforms.uPxPerRad.value = camera.projectionMatrix.elements[5] * 0.5 * Math.max(1, viewport.w);
    };
  }

  // The hull's pose and speed this frame; seaY = mean sea level under it.
  update(t, group, headingDeg, speed, seaY) {
    const u = this.uniforms, d = azimuthToDir(headingDeg).multiplyScalar(Math.max(speed, 0)), f = speed > 5 ? smooth(5, 10.5, speed) ** 2 : 0;
    u.uTime.value = t;
    u.uHull.value.copy(group.matrixWorld);
    u.uHullV.value.set(d.x, 0, d.z, speed / CTV_TRANSIT);
    u.uSpray.value.set(f, seaY);
    u.uAmbient.value.copy(U.uFogInscatter.value).multiplyScalar(0.8);   // mean sky ~0.8 x the horizon in-scatter
    this.mesh.visible = f > 0;
  }
}

// Spray sheet and hull-side white water, in the vessel frame: where the forefoot meets the sea (z 9 on
// the plane) the bow wave breaks against each demi-hull, piles up white against it and peels off the
// chine as a thin water sheet ("whisker spray", ~1 m high, 2 m out) fingering outboard and aft; aft of
// that the band of churned water hugging the hull stays low (~0.2 m, 0.5 m out) down to the transom.
// The tunnel sides get the same at 0.6 scale. u runs aft along the root (z 9 -> -13), v outward; the
// root follows the ocean's pressure trough along the hull. uRoot: running waterline, y = x + y z
// (port), z + w z (stbd).
const SHEET_VERTEX = /* glsl */`
attribute vec3 aUV;         // u, v, the chine's height: a root above the sea (the lifted forefoot) leaves the chine
uniform vec4 uRoot;
varying vec2 vUV;
varying vec3 vRad;
void main() {
	vUV = aUV.xy;
	vec3 lp = position;
	lp.y += max(position.x > 0.0 ? uRoot.x + uRoot.y * position.z : uRoot.z + uRoot.w * position.z, aUV.z);
	vec4 wp = modelMatrix * vec4(lp, 1.0);
	vRad = waterLight(wp.xyz);
	gl_Position = projectionMatrix * viewMatrix * wp;
	#include <logdepthbuf_vertex>
}`;
const SHEET_FRAGMENT = /* glsl */`
uniform float uSheet;
uniform float uFlow;
varying vec2 vUV;
varying vec3 vRad;
float n2(vec2 p) { return vNoise(vec3(p, 0.5)); }
void main() {
	#include <logdepthbuf_fragment>
	float u = vUV.x, v = vUV.y, f = exp(-u / 0.2);
	vec2 q = vec2(u * 70.0 + v * 3.0, v * 2.2 - uFlow * 0.9);
	float n = n2(q) * 0.6 + n2(q * vec2(2.3, 3.1) + 5.1) * 0.4, clump = n2(vec2(u * 18.0, 3.7 + v));
	float fingers = smoothstep(0.35 + 0.35 * v, 0.75 + 0.1 * v, n);
	// lumpy churned white water against the hull, then (forward) the sheet fingering out; a ragged outer edge
	float white = (1.0 - smoothstep(0.15, 0.35 + 0.45 * n, v + 0.3 * f)) * (0.35 + 0.65 * clump);
	float a = uSheet * smoothstep(0.0, 0.025, u) * (1.0 - smoothstep(0.75, 1.0, u)) * (1.0 - smoothstep(0.55, 0.95, v + 0.4 * (n - 0.5)))
		* max(0.9 * white, (0.5 * pow(1.0 - v, 1.5) + 0.08) * mix(fingers, 1.0, 0.3 * (1.0 - v)) * f);
	if (a < 0.003) discard;
	gl_FragColor = vec4(vRad * (0.8 + 0.3 * n), a);
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`;

// Transom boil: right behind each transom of a planing hull the water closes over the hollow the
// transom leaves and heaps up into a mound of churned white water (~0.4 m high 2-4 m aft at 22 kn,
// ESTIMATED from CTV footage) that thins within ~10 m into turquoise, bubble-laden propwash; the
// ocean's foam trail carries it on from there. Vessel frame, u aft (0..1 = 10 m), v across.
const BOIL_FRAGMENT = /* glsl */`
uniform float uSheet;
uniform float uFlow;
varying vec2 vUV;
varying vec3 vRad;
float n2(vec2 p) { return vNoise(vec3(p, 1.5)); }
void main() {
	#include <logdepthbuf_fragment>
	float u = vUV.x, x = abs(vUV.y - 0.5) * 2.0;
	vec2 q = vec2(vUV.y * 8.0, u * 16.0 - uFlow);
	float n = n2(q * vec2(1.0, 0.6)) * 0.5 + n2(q * vec2(2.1, 1.7) + 7.0) * 0.3 + n2(q * 4.3 + 3.0) * 0.2;
	// bubble-laden water over the whole mound, clumps of white foam in it that break up aft; ragged edges
	float body = uSheet * smoothstep(0.0, 0.05, u) * (1.0 - smoothstep(0.2, 0.95, u + 0.3 * (n - 0.5))) * (1.0 - smoothstep(0.5, 1.0, x + 0.35 * (n - 0.5)));
	float white = body * smoothstep(0.3 + 0.3 * u, 0.58 + 0.2 * u, n), a = min(0.3 * body + 0.9 * white, 0.95);
	if (a < 0.004) discard;
	gl_FragColor = vec4(vRad * (vec3(0.06, 0.32, 0.29) * 0.3 * body + (0.7 + 0.45 * n) * 0.9 * white) / a, a);
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`;

class SpraySheet {
  constructor(ctx, parent) {
    const NU = 44, NV = 8, pos = [], uv = [], idx = [];
    for (const side of [-1, 1]) for (const o of [1, -0.6]) {
      const base = pos.length / 3, ao = Math.abs(o);
      for (let j = 0; j <= NV; j++) for (let i = 0; i <= NU; i++) {
        const u = i / NU, v = j / NV, z = 9 - 22 * u, s = ctvSection(z), f = Math.exp(-u / 0.2);
        const x = side * (CTV_HULL_X + Math.sign(o) * (Math.max(s.bC, s.bW - 0.12) + 0.04 + (0.05 + (0.8 + 1.3 * f) * ao * v)));
        pos.push(x, ao * (0.25 + f) * (1.9 * v - 1.25 * v * v) - 0.13 * Math.exp(-(((z + 1.35) / 13.5) ** 2)), z - 1.4 * v * (0.3 + 0.7 * f));
        uv.push(u, v, s.yC - 0.05);
      }
      for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) {
        const a = base + j * (NU + 1) + i, c = a + NU + 1;
        idx.push(a, c, a + 1, a + 1, c, c + 1);
      }
    }
    const g = geometry(pos, null);
    g.setAttribute('aUV', new THREE.Float32BufferAttribute(uv, 3));
    g.setIndex(idx);
    g.computeBoundingSphere();
    this.material = waterMaterial(ctx, 'vessels.spraySheet', SHEET_VERTEX, HASH_GLSL + NOISE_GLSL + SHEET_FRAGMENT,
      { uSheet: { value: 0 }, uFlow: { value: 0 }, uRoot: { value: new THREE.Vector4() } }, THREE.DoubleSide);
    this.uniforms = this.material.uniforms;
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.name = 'vessels.ctv.spraySheet';
    // transom boils: 2 x 12 x 5 quads, a hump along u and a crown across v
    const bp = [], bu = [], bi = [];
    for (const side of [-1, 1]) {
      const base = bp.length / 3;
      for (let j = 0; j <= 5; j++) for (let i = 0; i <= 12; i++) {
        const u = i / 12, v = j / 5, w = 2.2 + 0.5 * u;
        bp.push(side * CTV_HULL_X + (v - 0.5) * w, (0.32 * Math.exp(-(((u - 0.28) / 0.25) ** 2)) - 0.12 * Math.exp(-((u / 0.08) ** 2))) * (1 - 0.6 * (2 * v - 1) ** 2), CTV_TRANSOM_Z - 0.1 - 10 * u);
        bu.push(u, v, -9);
      }
      for (let j = 0; j < 5; j++) for (let i = 0; i < 12; i++) { const a = base + j * 13 + i, c = a + 13; bi.push(a, c, a + 1, a + 1, c, c + 1); }
    }
    const bg = geometry(bp, null);
    bg.setAttribute('aUV', new THREE.Float32BufferAttribute(bu, 3));
    bg.setIndex(bi);
    bg.computeBoundingSphere();
    this.boil = new THREE.Mesh(bg, waterMaterial(ctx, 'vessels.ctv.transomBoil', SHEET_VERTEX, HASH_GLSL + NOISE_GLSL + BOIL_FRAGMENT,
      { uSheet: { value: 0 }, uFlow: { value: 0 }, uRoot: this.uniforms.uRoot, uAmbient: this.uniforms.uAmbient }, THREE.DoubleSide));
    this.boil.name = 'vessels.ctv.transomBoil';
    for (const m of [this.mesh, this.boil]) { m.renderOrder = 3; m.visible = false; parent.add(m); }
  }

  // sk: the hull's Seakeeping (target = the sea plane under the hull, state = the hull attitude)
  update(speed, t, sk) {
    const k = speed > 0 ? smooth(4.5, 10.5, speed) : 0, tg = sk.target, st = sk.state, xs = CTV_HULL_X + 0.9;
    const dh = tg.heave - st.heave[0], dp = Math.tan(tg.pitch) - Math.sin(st.pitch[0]), dr = Math.tan(tg.roll) - Math.sin(st.roll[0]);
    this.uniforms.uRoot.value.set(dh + dr * xs, dp, dh - dr * xs, dp);
    this.uniforms.uSheet.value = k;
    this.uniforms.uFlow.value = t * Math.max(speed, 0) * 0.35;
    this.uniforms.uAmbient.value.copy(U.uFogInscatter.value).multiplyScalar(0.8);
    this.mesh.visible = k > 0.01;
    const b = this.boil.material.uniforms, kb = speed > 0 ? smooth(3, 10, speed) : 0;
    b.uSheet.value = kb;
    b.uFlow.value = t * Math.max(speed, 0) * 1.4;
    this.boil.visible = kb > 0.01;
  }
}

// Name board on the CTV's wheelhouse front: a canvas texture on a thin plate (fictional name).
function makeNameBoard(ctx, nb) {
  if (typeof document === 'undefined') return null;
  const cv = document.createElement('canvas');
  cv.width = 1024; cv.height = 128;
  const g = cv.getContext('2d');
  g.fillStyle = '#f1f1ec'; g.fillRect(0, 0, 1024, 128);
  g.fillStyle = g.strokeStyle = '#1d2f52';
  g.font = 'bold 86px Helvetica, Arial, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('SHOAL RUNNER', 512, 68);
  g.lineWidth = 6; g.strokeRect(10, 10, 1004, 108);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(8, ctx.renderer?.capabilities?.getMaxAnisotropy?.() || 1);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(nb.width, nb.height), applyAtmosphere(new THREE.MeshStandardMaterial({ name: 'vessels.ctv.nameBoard', map: tex, roughness: 0.45 })));
  m.name = 'vessels.ctv.nameBoard';
  m.position.fromArray(nb.centre);
  m.quaternion.setFromUnitVectors(V3(0, 0, 1), V3(...nb.normal));
  m.receiveShadow = true;
  m.layers.enable(LAYER_REFLECT);
  return m;
}

// ================================================================================================
// Vessel base: meshes, pose, seakeeping, lamps, floods
// ================================================================================================
class Vessel {
  constructor(name, kit, spec, root, livery, modes) {
    const parts = kit.merged();
    this.name = name;
    this.spec = spec;                       // { lights, floods, samples }
    this.floods = makeFloodUniforms();
    this.materials = createVesselMaterials(name, this.floods, livery);
    this.group = new THREE.Group();
    this.group.name = name;
    this.meshes = [];
    this.box = new THREE.Box3();
    for (const k of ['hull', 'paint', 'glass']) {
      if (!parts[k]) continue;
      const m = new THREE.Mesh(parts[k], this.materials[k]);
      m.name = `${name}.${k}`;
      m.castShadow = m.receiveShadow = true;
      m.layers.enable(LAYER_REFLECT);
      this.meshes.push(m);
      this.group.add(m);
      this.box.union(parts[k].boundingBox);
    }
    root.add(this.group);
    this.sea = new Seakeeping(spec.samples, modes);
    this.pose = { x: 0, z: 0, heading: 0, speed: 0, accel: 0, yawRate: 0, leg: null, holdAge: 0 };
  }

  // Places the group: waterline at the fitted sea height + heave, rotation yaw / pitch / roll.
  place() {
    const p = this.pose, s = this.sea.state;
    this.group.position.set(p.x, s.heave[0] - curvatureDrop(p.x, p.z), p.z);
    this.group.rotation.set(-s.pitch[0], Math.PI - p.heading * DEG, s.roll[0], 'YXZ');
    this.group.updateMatrixWorld(true);
  }

  localToWorld(local, out = V3(0, 0, 0)) { return out.fromArray(local).applyMatrix4(this.group.matrixWorld); }

  // World-space horizontal direction of a relative bearing (deg clockwise from the bow).
  bearingDir(relDeg, out = V3(0, 0, 0)) { return azimuthToDir(this.pose.heading + relDeg, out); }
}

// ================================================================================================
// Crew transfer vessel
// ================================================================================================
export class CrewTransferVessel extends Vessel {
  constructor(ctx, root, landings) {
    const kit = new Kit(), spec = buildCTV(kit);
    // livery: navy-blue topsides with a 70 %-saturation teal stripe (see makeLivery for the slots)
    const livery = makeLivery(['#131314', '#131314', '#2b3a50', '#2e8a88'], [0.72, 0.6, 0.5, 0.5], [
      0.08, 0.32, 1.05, 0.5, 0.13, -4.0, CTV_STEM_Z + 1, CTV_STEM_Z,
      0.3, 0.8, 1.78, 0.7, 1.5, 3.0, 0.07, 0.5, 1.72, 0.6, -10.5, 5.5, 5.33, 0.07, 0.45, 0.7, 0, 0, 1, 0, 0.003, 0.0012, 0.8, 0.0015,
    ]);
    super('vessels.ctv', kit, spec, root, livery, { heave: [1.8, 0.35], pitch: [2.0, 0.3], roll: [2.6, 0.18] });
    this.wet = livery.uWet.value;      // wet band (see LIVERY_APPLY), set every frame by Vessels
    this.nameBoard = makeNameBoard(ctx, spec.nameBoard);
    if (this.nameBoard) this.group.add(this.nameBoard);
    this.route = new CtvRoute(landings);
    this.offset = this.route.timeOf('partner');        // t = 0: mid-hold at the partner turbine, out of the drone frame
  }

  /** Cycle time for animation time t. */
  cycleTime(t) { return t + this.offset; }

  /**
   * Jumps the shuttle cycle so that, at animation time t, the CTV is at a named moment:
   * 'hero' (pushed onto the hero landing), 'partner', 'transit' (22 kn toward the hero),
   * 'approach' (final approach to the hero). Wakes and motion restart consistently.
   */
  seek(name, t = U.uTime.value) {
    const tc = this.route.timeOf(name);
    if (tc === null) return false;
    this.offset = tc - t;
    return (this.jumped = true);
  }

  /** Current phase: { kind: 'hold' | 'reverse' | 'transit', landing, speed }. */
  get phase() { return { kind: this.pose.leg?.kind ?? 'hold', landing: this.pose.leg?.landing?.name ?? null, speed: this.pose.speed }; }

  /** A camera target: the middle of the vessel at deck height (world). */
  focus(out) { return this.localToWorld([0, C.foredeckY + 1.0, 0], out); }

  /** Eye point of someone standing on the foredeck (world), for a ride-along camera. */
  eye(out) { return this.localToWorld(CTV_EYE_LOCAL, out); }

}

// ================================================================================================
// Service operation vessel
// ================================================================================================
export class ServiceOperationVessel extends Vessel {
  constructor(ctx, root, turbine) {
    const kit = new Kit(), spec = buildSOV(kit, mulberry32(0x50f1));
    super('vessels.sov', kit, spec, root, makeLivery(['#5b2620', '#141414', '#17253f', '#17253f'], [0.72, 0.6, 0.38, 0.38], [
      -0.4, 0.9, 3.0, 0, 0.0, -40, -39, 40,
      0.4, 0.45, -5, 0, 2.4, 6.0, 0.05, 0.7, 4.75, 1.6, -36, 4, 5, 0.1, 0.75, 0.6, sovSection(35.3).yD - 2.1, 35.3, 3.0, 0.65, 0.006, 0.0015, 0.3, 0.002,
    ]), { heave: [6.5, 0.28], pitch: [6.0, 0.28], roll: [10.5, 0.08] });
    this.turbine = turbine;
    // Station: bow into the wind, the turbine SOV_STANDOFF off the centreline to starboard abreast of
    // the gangway, then moved SOV_UPWIND_SHIFT toward the wind.
    const fwd = azimuthToDir(SOV_HEADING), stbd = azimuthToDir(SOV_HEADING + 90), along = SOV_UPWIND_SHIFT - SOV_GANGWAY_PIVOT[2];
    this.station = { x: turbine.x - stbd.x * SOV_STANDOFF + fwd.x * along, z: turbine.z - stbd.z * SOV_STANDOFF + fwd.z * along, heading: SOV_HEADING, turbine };
    Object.assign(this.pose, { x: this.station.x, z: this.station.z, heading: SOV_HEADING });
    this.makingWay = false;              // on DP at the turbine: not making way through the water
    // gangway (outer truss + telescoping inner section), landing on the TP platform edge facing the SOV
    [this.gangwayOuter, this.gangwayInner] = SOV_GANGWAY.map((len, i) => {
      const m = new THREE.Mesh(buildGangwayTruss(len, i ? 0.62 : 0.8, i), this.materials.paint);
      m.name = 'vessels.sov.gangway'; m.castShadow = m.receiveShadow = true; m.layers.enable(LAYER_REFLECT);
      m.matrixAutoUpdate = false;
      root.add(m);
      return m;
    });
    const toSov = V3(this.station.x - turbine.x, 0, this.station.z - turbine.z).normalize().multiplyScalar(TURBINE.platform.outerDiameter / 2 - 0.3);
    this.gangwayTip = V3(turbine.x + toSov.x, turbine.baseY + TURBINE.stack.deck + 0.1, turbine.z + toSov.z);
    this._gw = { p: V3(0, 0, 0), d: V3(0, 0, 0), x: V3(0, 0, 0), q: new THREE.Quaternion(), tw: new THREE.Quaternion(), one: V3(1, 1, 1) };
  }

  /** A camera target: amidships at the bridge-deck height (world). */
  focus(out) { return this.localToWorld([0, 12, 0], out); }

  // Aims the gangway from the (moving) pivot at the fixed landing point, walkway kept level across;
  // the inner section telescopes to make up the length (motion compensation).
  updateGangway() {
    const g = this._gw, p = this.localToWorld(SOV_GANGWAY_PIVOT, g.p), d = g.d.subVectors(this.gangwayTip, p), len = d.length();
    d.multiplyScalar(1 / len);
    g.q.setFromUnitVectors(V3(0, 0, 1), d);
    const x = g.x.set(1, 0, 0).applyQuaternion(g.q), want = V3(0, 1, 0).cross(d).normalize();
    g.q.multiply(g.tw.setFromAxisAngle(V3(0, 0, 1), Math.atan2(x.clone().cross(want).dot(d), x.dot(want))));
    this.gangwayOuter.matrix.compose(p, g.q, g.one);
    this.gangwayInner.matrix.compose(p.clone().addScaledVector(d, len - SOV_GANGWAY[1]), g.q, g.one);
    this.gangwayOuter.matrixWorldNeedsUpdate = this.gangwayInner.matrixWorldNeedsUpdate = true;
    this.gangwayLength = len;
  }
}

// ================================================================================================
// Vessels
// ================================================================================================
export class Vessels {
  /** @param {object} ctx { renderer, scene, camera, quality, atmosphere?, ocean?, farm?, post? } */
  constructor(ctx) {
    this.ctx = ctx;
    this.quality = ctx.quality || QUALITY.high;
    this.enabled = true;
    this.root = new THREE.Group();
    this.root.name = 'vessels';
    ctx.scene.add(this.root);

    // Turbines and landing geometry (the farm's measured tube positions when it exists).
    const turbines = this.turbines = layoutPositions().map((p) => ({ ...p, baseY: -curvatureDrop(p.x, p.z) }));
    const find = (di, dj) => turbines.find((p) => p.di === di && p.dj === dj);
    const axis = azimuthToDir(TURBINE.boatLanding.facingDeg), faceDist = this.landingFaceDistance = landingFaceDistance(ctx.farm, axis);
    const landing = (tb, holdS) => ({ name: tb.id, turbine: tb, axis: { x: axis.x, z: axis.z }, heading: (TURBINE.boatLanding.facingDeg + 180) % 360, holdS,
      contact: { x: tb.x + axis.x * (faceDist + CTV_BOW_Z), z: tb.z + axis.z * (faceDist + CTV_BOW_Z) } });   // fender face on the tube faces
    const hero = find(0, 0);
    this.ctv = new CrewTransferVessel(ctx, this.root, [landing(hero, 210), landing(find(CTV_PARTNER.di, CTV_PARTNER.dj), 150)]);
    this.sov = new ServiceOperationVessel(ctx, this.root, find(VESSELS.sov.station.di, VESSELS.sov.station.dj));

    // Lights: one dynamic lamp set for both vessels (nav + RAM + flood lenses).
    this.lampList = [];
    for (const v of [this.ctv, this.sov]) {
      const kind = v === this.ctv ? 'ctv' : 'sov';
      for (const L of v.spec.lights) this.lampList.push({ ...L, vessel: v, area: LANTERN_AREA[kind], group: 0 });
      for (const F of v.spec.floods) this.lampList.push({ pos: F.pos, vessel: v, half: 180, cd: FLOOD_CD[kind], xy: LAMP_XY.warmWhite, beam: LAMP_BEAM.flood, area: 0.08, group: 1 });
    }
    this.lamps = new PhotometricLamps({ name: 'vessels.lamps', count: this.lampList.length, groups: 2, atmosphere: ctx.atmosphere, dynamic: true });
    this.lampList.forEach((L, i) => this.lamps.set(i, { position: V3(0, 0, 0), ...L }));
    this.lamps.markAll();
    this.root.add(this.lamps.mesh);

    // Work light on the landing: the two bow floods as one soft spot aimed at the tubes and ladder.
    this.landingSpot = new THREE.SpotLight(new THREE.Color(...WARM), 0, LANDING_SPOT.range, LANDING_SPOT.angleDeg * DEG, 1, 2);
    this.landingSpot.name = 'vessels.ctv.landingSpot';
    this.landingSpot.layers.enable(LAYER_REFLECT);          // lights the mirror pass too; never hidden (a light-count change recompiles every program)
    this.root.add(this.landingSpot, this.landingSpot.target);

    // Wake decal and spray.
    this.decal = new WakeDecal();
    this.spray = new BowSpray(ctx, Math.round(SPRAY_MAX * clamp(this.quality.particles ?? 1, 0.25, 1.5)));
    this.root.add(this.decal.mesh, this.spray.mesh);
    this.sheet = new SpraySheet(ctx, this.ctv.group);
    this.history = [];                    // CTV track: { t, x, z, heading, speed }
    this.kelvin = [];                     // current bow wave sources (see kelvinSources())
    this.kelvinHalfAngleDeg = kelvinVisibleHalfAngle(CTV_TRANSIT);
    this._lastT = null;
    this._sovTick = 0;
    this._lay = { p: null, s: 0 };
    this._v = V3(0, 0, 0); this._w = V3(0, 0, 0); this._tr = {};
    // foredeck eye point with the CTV on the hero landing (SCENE-SPEC §7 deck preset: (5.5, 4.0, -15.0))
    const hl = this.ctv.route.landings[0], eyeR = Math.hypot(hl.contact.x - hero.x, hl.contact.z - hero.z) - FENDER_PRELOAD - CTV_EYE_LOCAL[2];
    this.heroEye = V3(hero.x + hl.axis.x * eyeR, CTV_EYE_LOCAL[1], hero.z + hl.axis.z * eyeR);
    this.stats = { updateMs: 0 };
    if (globalThis.NJOW_DEV !== false) devReport(this);
  }

  // ---------------------------------------------------------------- public API
  setEnabled(on) {
    this.enabled = this.root.visible = !!on;
    if (!this.enabled) {
      this._clearTrails(); this.kelvin.length = 0; this.ctx.ocean?.setWaveSources?.(this.kelvin);
      // the SOV's light column goes with the SOV (update() stops while hidden); re-sent on enable
      this.ctx.ocean?.setDistantLights?.([], 'vessels');
      this._pubDusk = -1;
    } else this.ctv.jumped = true;
  }

  setQuality(q) { this.quality = q; }

  /** Current wave sources (the CTV's stem while under way): [{ x, z, headingDeg, speed, length, beam, amplitude, halfAngleDeg }]. */
  kelvinSources() { return this.kelvin; }

  /**
   * Keep-out volumes (oriented boxes, world space) of the vessels' hulls and superstructures within
   * `range` m of cameraPos: out = [{ centre: Vector3, axes: [x, y, z unit Vector3], half: Vector3 }].
   * The boxes are cached per vessel pose (read-only; rebuilt when the vessel moves). A camera
   * standing on an open deck (the CTV foredeck eye) is outside all of them.
   */
  keepOuts(cameraPos, out = [], range = 150) {
    out.length = 0;
    if (!this.enabled) return out;
    for (const v of [this.ctv, this.sov]) {
      if (cameraPos && v.group.position.distanceTo(cameraPos) > range + (v === this.ctv ? 16 : 45)) continue;
      const e = v.group.matrixWorld.elements;
      let c = v._ko;
      if (!c) c = v._ko = { m: [], boxes: (v === this.ctv ? CTV_KEEPOUTS : SOV_KEEPOUTS).map((b) => ({ local: b, centre: V3(0, 0, 0), axes: [V3(1, 0, 0), V3(0, 1, 0), V3(0, 0, 1)], half: V3(0, 0, 0) })) };
      if (e.some((x, i) => x !== c.m[i])) {
        c.m = [...e];
        for (const o of c.boxes) {
          const [x0, x1, y0, y1, z0, z1] = o.local;
          o.centre.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2).applyMatrix4(v.group.matrixWorld);
          o.axes.forEach((a, k) => a.set(+(k === 0), +(k === 1), +(k === 2)).transformDirection(v.group.matrixWorld));
          o.half.set((x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2);
        }
      }
      out.push(...c.boxes);
    }
    return out;
  }

  /**
   * Pushes a camera position out of any vessel keep-out volume (plus clearance); true if moved.
   * Moves are sideways or up only (never down into a hull): of the exits of the box that holds the
   * point, the shortest one that is clear of every other box is taken.
   */
  clampCamera(p, clearance = 0.4) {
    const list = this.keepOuts(p, this._ko || (this._ko = []), 60), d = V3(0, 0, 0), q = V3(0, 0, 0);
    const local = (o, v) => o.axes.map((a) => d.subVectors(v, o.centre).dot(a));
    const inside = (o, v) => local(o, v).every((c, k) => Math.abs(c) < o.half.getComponent(k) + clearance);
    let moved = false;
    for (let pass = 0; pass < 4; pass++) {
      const o = list.find((b) => inside(b, p));
      if (!o) break;
      const c = local(o, p);
      const cands = KEEPOUT_EXITS.map(([k, sg]) => { const need = sg * (o.half.getComponent(k) + clearance) - c[k]; return [Math.abs(need), k, need + Math.sign(need) * 1e-3]; }).sort((x, y) => x[0] - y[0]);
      const pick = cands.find((cd) => !list.some((b) => inside(b, q.copy(p).addScaledVector(o.axes[cd[1]], cd[2])))) || cands[0];
      p.addScaledVector(o.axes[pick[1]], pick[2]);
      moved = true;
    }
    return moved;
  }

  // ---------------------------------------------------------------- frame
  update(dt, t, camera) {
    if (!this.enabled) return;
    const t0 = performance.now(), ocean = this.ctx.ocean, ctv = this.ctv, P = ctv.pose;
    const jump = this._lastT === null || ctv.jumped || t < this._lastT - 1e-6 || t - this._lastT > Math.max(0.5, 3 * dt + 0.25);
    const simDt = jump ? 0 : t - this._lastT;
    this._lastT = t;
    ctv.jumped = false;

    // aboard: a camera standing on the CTV's foredeck at the hero landing (the "CTV deck" view)
    // brings the CTV to that landing and keeps it pushing on while the camera stays
    if (camera.position.distanceTo(this.heroEye) < 3) {
      const hold = ctv.route.legs[0], per = ctv.route.period, tc = ((ctv.cycleTime(t) % per) + per) % per;
      if (tc < hold.t0 || tc > hold.t1 - 20) { ctv.seek('hero', t); return this.update(dt, t, camera); }
      if (tc > hold.t0 + 30) ctv.offset -= simDt;
    }
    ctv.route.pose(ctv.cycleTime(t), P);
    const holding = P.leg.kind === 'hold';
    if (holding) {
      // on the landing: fender preload + wave-driven surge, a little yaw working against the tubes
      const ramp = smooth(0, 1.5, P.holdAge);
      const surge = ramp * (FENDER_PRELOAD + 0.02 * Math.sin(TAU * t / 8.3) + 0.05 * clamp(ctv.sea.surge / 0.35, -1, 1));
      P.x -= P.leg.landing.axis.x * surge; P.z -= P.leg.landing.axis.z * surge;
      P.heading += 0.25 * Math.sin(TAU * t / 11.7) * ramp;
    }
    ctv.sea.sense(ocean, P.x, P.z, P.heading, t);
    if (jump) ctv.sea.fresh = true;
    // running trim (bow up) of a planing cat: hump near 11 kn, ~2.2° on the plane; squat when
    // accelerating; slightly bow-down going astern. Dynamic lift raises the hull once planing;
    // catamarans heel out of a turn.
    const Ua = Math.abs(P.speed);
    const trim = P.speed >= 0
      ? (2.2 * smooth(3, 9, Ua) + 1.6 * Math.exp(-(((Ua - 5.5) / 1.8) ** 2)) + 0.6 * clamp(P.accel / CTV_ACCEL, -1, 1)) * DEG
      : -0.3 * DEG * Ua / CTV_REVERSE_SPEED;
    const rise = 0.28 * smooth(6, 11, Ua) - 0.12 * Math.exp(-(((Ua - 4.5) / 1.8) ** 2));
    if (holding) {
      // the fender grips the tubes: the bow follows only BOW_SLIP of the free heave, the stern rides
      const s = ctv.sea.target, stern = s.heave - Math.tan(s.pitch) * 12;
      s.pitch = Math.atan(((s.heave + Math.tan(s.pitch) * CTV_BOW_Z) * BOW_SLIP - stern) / (CTV_BOW_Z + 12));
      s.heave = stern + Math.tan(s.pitch) * 12;
      s.roll *= 0.6;
    }
    ctv.sea.step(simDt, { heave: rise, pitch: trim, roll: -0.03 * Ua * P.yawRate });
    ctv.place();

    // SOV: DP station with slow excursions, seakeeping (sea sampled every 3rd frame: its heave and
    // roll periods are 6-10 s), gangway
    const sov = this.sov, Q = sov.pose;
    Q.x = sov.station.x + 0.35 * Math.sin(TAU * t / 97 + 1.3);
    Q.z = sov.station.z + 0.3 * Math.sin(TAU * t / 131 + 0.4);
    Q.heading = SOV_HEADING + 0.4 * Math.sin(TAU * t / 173);
    if (jump || (this._sovTick = (this._sovTick + 1) % 3) === 0) sov.sea.sense(ocean, Q.x, Q.z, Q.heading, t);
    if (jump) sov.sea.fresh = true;
    sov.sea.step(simDt, {});
    sov.place();
    sov.updateGangway();

    // wakes, spray, lights
    this._updateHistory(t, P, jump);
    this._updateTrails(t, P, jump, ocean);
    this._updateDecal(t, camera.position);
    this.spray.update(t, ctv.group, P.heading, P.speed, ctv.sea.target.heave - curvatureDrop(P.x, P.z));
    this.sheet.update(P.speed, t, ctv.sea);
    // the sea's reach up the hull: the bow wave climbing the forward topsides under way, wave slap and
    // run-off streaks otherwise
    const kw = smooth(4, 10.5, P.speed);
    ctv.wet.set(holding ? 0.5 : 0.34 + 0.1 * kw, 0.7 * kw, holding ? 0.45 : 0.2 + 0.4 * kw, 0.3 * t);
    this._updateLights(t);
    this.stats.updateMs = performance.now() - t0;
  }

  dispose() {
    this._clearTrails();
    for (const v of [this.ctv, this.sov]) {
      for (const m of v.meshes) m.geometry.dispose();
      for (const k of ['hull', 'paint', 'glass']) v.materials[k].dispose();
    }
    for (const m of [this.sov.gangwayOuter, this.sov.gangwayInner]) { m.geometry.dispose(); m.parent?.remove(m); }
    const nb = this.ctv.nameBoard;
    if (nb) { nb.geometry.dispose(); nb.material.map.dispose(); nb.material.dispose(); }
    for (const m of [this.decal.mesh, this.spray.mesh, this.sheet.mesh, this.sheet.boil]) { m.geometry.dispose(); m.material.dispose(); }
    this.lamps.dispose();
    this.root.parent?.remove(this.root);
  }

  // ---------------------------------------------------------------- CTV track history
  _updateHistory(t, P, jump) {
    const H = this.history;
    if (jump) {
      // seed the last WAKE_LIFETIME_S of track from the route, so a seek or ?t= has its wake
      H.length = 0;
      for (let a = WAKE_LIFETIME_S; a > 0; a -= 0.25) { const p = this.ctv.route.pose(this.ctv.cycleTime(t - a), {}); H.push({ t: t - a, x: p.x, z: p.z, heading: p.heading, speed: p.speed }); }
    }
    const last = H[H.length - 1];
    if (!last || t - last.t >= 0.25 || Math.hypot(P.x - last.x, P.z - last.z) > 3) H.push({ t, x: P.x, z: P.z, heading: P.heading, speed: P.speed });
    while (H.length && t - H[0].t > WAKE_LIFETIME_S + 1) H.shift();
  }

  // Interpolated track pose at time tq (between the nearest history samples).
  _trackAt(tq, out) {
    const H = this.history;
    if (!H.length) return null;
    let i = H.length - 1;
    while (i > 0 && H[i - 1].t > tq) i--;
    const a = H[Math.max(i - 1, 0)], b = H[i], f = clamp((tq - a.t) / Math.max(b.t - a.t, 1e-6), 0, 1);
    out.x = a.x + (b.x - a.x) * f; out.z = a.z + (b.z - a.z) * f; out.speed = a.speed + (b.speed - a.speed) * f;
    out.heading = a.heading + ((((b.heading - a.heading) % 360) + 540) % 360 - 180) * f;
    return out;
  }

  // ---------------------------------------------------------------- ocean wake inputs (near field)
  _updateTrails(t, P, jump, ocean) {
    if (!ocean?.addFoamTrail) return;
    if (jump) {
      // replay the seeded track every ~0.6 m (its samples are 0.25 s apart), as live play lays it
      this._clearTrails();
      for (let tq = this.history[0].t; tq < t; tq += 0.05) this._laySternPoints(ocean, this._trackAt(tq, this._tr), tq);
    }
    this._laySternPoints(ocean, P, t);
    // breaking crests along the Kelvin arms, re-laid every frame (the far decal reuses them)
    this._arms = [1, -1].flatMap((side) => this._armPoints(t, side, ocean)).map((pts, i) => {
      ocean.clearTrail?.(ARM_TRAILS[i]);
      if (pts.length > 1) ocean.addFoamTrail(pts, { key: ARM_TRAILS[i], width: 1.2, lifetime: ARM_MAX_AGE_S + 1, spread: 0.08, foam: 0.7, aeration: 0.5, aerationLife: 6, slick: 0 });
      return pts;
    });
    this._emitWaves(P, ocean);
    // white water along the hulls under way, the fender contact on a landing: re-laid every frame
    for (const k of [...SIDE_TRAILS, ...BOW_TRAILS]) ocean.clearTrail?.(k);
    this._hullSides(P, ocean, t);
    // jet wash while holding on a landing, or backing off it (see HOLD)
    for (const k of HOLD_JET_TRAILS) ocean.clearTrail?.(k);
    for (const k of HOLD_EDDY_TRAILS) ocean.clearTrail?.(k);
    if (P.leg.kind === 'hold' || (P.leg.kind !== 'transit' && P.speed < 0)) this._holdWash(P, ocean, t);
    if (P.leg.kind === 'hold') this._holdBow(P, ocean, t);
  }

  // Under way the bow wave breaks against each demi-hull where the forefoot meets the sea (z ~8.6 on
  // the plane) and runs aft along the outer and tunnel sides as a band of churned water, thinning
  // toward the transom where the jets take it over. Laid with ages as if shed by the bow, so the
  // ocean's fresh-foam law thins it aft (SpraySheet draws the white water standing against the hull).
  _hullSides(P, ocean, t) {
    const U = P.speed, k = smooth(3.5, 10, U);
    if (k > 0) SIDE_TRAILS.forEach((key, i) => {
      const s = i % 2 ? -1 : 1, o = i < 2 ? 1 : -0.6, pts = [];
      for (let z = 8.6; z > CTV_TRANSOM_Z; z -= 1.5) {
        const f = (8.6 - z) / 22, lx = s * (CTV_HULL_X + Math.sign(o) * (ctvSection(z).bW + 0.25 + 0.35 * f));
        pts.push({ ...onHull(P, lx, z), t: t - (8.6 - z) / U, width: 0.8 + 0.8 * f,
          foam: k * Math.abs(o) * (1 - 0.5 * f) * (0.3 + 0.7 * Math.abs(Math.sin(1.4 * z + 1.7 * i + 2 * t))) });
      }
      ocean.addFoamTrail(pts, { key, width: 1.2, lifetime: 6, spread: 0.25, foam: 0.95, aeration: 0.45 * k, aerationLife: 4, slick: 0 });
    });
  }

  // On a landing the fender holds the bow, but the forefeet still pump a little in the swell: a faint
  // collar of broken water round each forefoot (z ~9.5 at rest) that breathes with the 8.3 s surge on
  // the fender. Nothing changes astern (_holdWash).
  _holdBow(P, ocean, t) {
    const pump = smooth(0, 2, P.holdAge) * (0.68 + 0.32 * Math.sin(TAU * t / 8.3 + 2.4));
    BOW_TRAILS.forEach((key, i) => {
      const s = i ? -1 : 1, pts = [];
      for (let k = 0; k <= 4; k++) { const a = (k / 4 - 0.5) * 2.8; pts.push({ ...onHull(P, s * CTV_HULL_X + 0.85 * Math.sin(a), 9.1 + 0.85 * Math.cos(a)), width: 0.5, foam: 0.18 * pump * (0.6 + 0.4 * Math.sin(4.1 * k + 1.3 * t + 2 * i)) }); }
      ocean.addFoamTrail(pts, { key, width: 0.5, lifetime: 2, spread: 0.04, foam: 0.18, aeration: 0.15 * pump, aerationLife: 2, slick: 0 });
    });
  }

  // Low-thrust wash of a CTV holding position: re-laid every frame in the vessel's frame, so it
  // follows the boat's small surge and yaw on the tubes.
  _holdWash(P, ocean, t) {
    const h = P.heading * DEG, fx = Math.sin(h), fz = -Math.cos(h);
    const at = (lx, lz) => ({ x: P.x + fx * lz + fz * lx, z: P.z + fz * lz - fx * lx });   // local (x, z) -> world
    const astern = P.speed < 0, dir = astern ? 1 : -1, z0 = astern ? CTV_STEM_Z + 0.4 : CTV_TRANSOM_Z - 0.4;
    // thrust breathes with the surge on the fender (8.3 s, as the pose's surge term) and ramps in
    const ramp = astern ? 1 : smooth(0, 2, P.holdAge);
    const thrust = ramp * (0.62 + 0.24 * Math.sin(TAU * t / 8.3 + 1.1) + 0.14 * Math.sin(TAU * t / 3.1 + 0.4));
    const peak = astern ? HOLD.asternFoam : HOLD.jetFoam;

    // one wandering bubble stream per jet: points laid as if they left the jet d/flow seconds ago,
    // so the ocean's age law thins them aft; the curl makes it swirl instead of fanning straight
    HOLD_JET_TRAILS.forEach((key, i) => {
      const s = i ? -1 : 1, ph = 1.9 * i, pts = [];
      for (let d = 0; d <= HOLD.jetLength; d += 0.75) {
        const curl = (0.1 + 0.07 * d) * Math.sin(1.1 * d - 1.6 * t + ph) + 0.05 * d * Math.sin(2.7 * d + 0.9 * t + 2 * ph);
        const flick = 0.75 + 0.25 * Math.sin(3.3 * d - 2.2 * t + 3 * ph);
        pts.push({ ...at(s * CTV_HULL_X + curl, z0 + dir * d), t: t - d / HOLD.flow, width: 0.8 + 0.2 * d,
          foam: peak * thrust * flick * (0.35 + 0.65 * Math.exp(-d / 3.5)) });
      }
      ocean.addFoamTrail(pts, { key, width: 1.0, lifetime: 6, spread: 0.15, foam: peak, aeration: HOLD.jetAeration * thrust, aerationLife: 3, slick: 0 });
    });

    // small eddies shed alternately off the two quarters: each a short spinning arc of bubbles
    // that grows and fades as it drifts aft and a little outboard
    if (!astern) HOLD_EDDY_TRAILS.forEach((key, i) => {
      const u = ((t / HOLD.eddyLife) + i / HOLD_EDDY_TRAILS.length) % 1, age = u * HOLD.eddyLife;
      const s = i % 2 ? -1 : 1, env = Math.sin(Math.PI * u) ** 2 * ramp;
      if (env < 0.02) return;
      const r = HOLD.eddyRadius[0] + (HOLD.eddyRadius[1] - HOLD.eddyRadius[0]) * u;
      const cx = s * (CTV_HULL_X + 0.9 + 0.25 * age), cz = CTV_TRANSOM_Z - 0.8 - 0.9 * age;
      const spin = s * HOLD.eddySpin * age + 2.4 * i, pts = [];
      for (let k = 0; k <= 4; k++) {
        const a = spin + s * k * (1.5 * Math.PI / 4);
        pts.push({ ...at(cx + r * Math.cos(a), cz + r * Math.sin(a)), width: 0.3 + 0.25 * u, foam: HOLD.eddyFoam * env * (0.4 + 0.15 * k) });
      }
      ocean.addFoamTrail(pts, { key, width: 0.4, lifetime: 2, spread: 0.05, foam: HOLD.eddyFoam, aeration: 0.25 * env, aerationLife: 2, slick: 0 });
    });

    // now and then a vortex surfaces behind a jet as a soft upwelling (deterministic per boil index)
    const n = Math.floor(t / HOLD.boilEvery);
    if (!astern && ramp > 0.5 && n !== this._holdBoil) {
      this._holdBoil = n;
      const r1 = (Math.sin(n * 12.9898) * 43758.5453) % 1, r2 = (Math.sin(n * 78.233) * 12543.1234) % 1;
      const s = n % 2 ? -1 : 1, p = at(s * CTV_HULL_X + 1.2 * r1, CTV_TRANSOM_Z - 2.0 - 4.0 * Math.abs(r2));
      ocean.addDisturbance?.({ ...p, kind: 'boil', radius: 0.7 + 0.4 * Math.abs(r1), strength: 0.22 * thrust, duration: 3.0, foam: 0.22 });
    }
  }

  // Whenever the vessel has moved 1 m: one point per demi-hull transom (the two jets) and one for the
  // churned tunnel water between them, each on two trails laid on the same meandering line: the
  // tumbling white clumps (CHURN: incommensurate waves of the laid distance, ~2.7 / ~5.6 / ~13 m, each
  // trail its own phase, so white clots with gaps of turquoise between them) and the long lace with
  // the bubble plume and the slick (LACE: clumps at ~4-7 / ~18 / ~75 m).
  _laySternPoints(ocean, pose, tp) {
    const Ua = Math.abs(pose.speed), L = this._lay, d = L.p ? Math.hypot(pose.x - L.p.x, pose.z - L.p.z) : 0;
    if (L.p && d < 1) return;
    if (Ua < 1.0 || pose.speed < 0) { L.p = null; return; }
    L.s += d;
    L.p = { x: pose.x, z: pose.z };
    const planing = smooth(1.5, 9, Ua), s0 = L.s;
    HULL_TRAILS.forEach((key, i) => {
      const jet = i < 2, s = jet ? 1 - 2 * i : 0;
      const c = clamp(0.6 + 0.3 * Math.sin(s0 * 0.35 + 2.1 * i) + 0.18 * Math.sin(s0 * 0.083 + 4.1 * i) + 0.09 * (Math.sin(s0 * 0.91 + 1.3 * i) + Math.sin(s0 * 1.67 + 0.7 * i)), 0, 1);
      const q = clamp(0.45 + 0.35 * Math.sin(s0 * 1.13 + 2.9 * i) + 0.25 * Math.sin(s0 * 0.47 + 1.7 * i) + 0.2 * Math.sin(s0 * 2.31 + 0.6 * i), 0, 1);
      const off = s * CTV_HULL_X + 0.15 * Math.sin(s0 * 0.13 + 2.3 * i) + 0.25 * Math.sin(s0 * 0.041 + i);   // the jets meander
      const pt = (width, foam) => [{ ...onHull(pose, off, CTV_TRANSOM_Z - 0.6), t: tp, width, foam }];
      ocean.addFoamTrail(pt(CHURN.width * (0.7 + 0.6 * q) * (jet ? 1 : 0.8), planing * (jet ? 0.22 + 0.6 * q * q : 0.6 * q * q)),
        { key: CHURN_TRAILS[i], width: CHURN.width, lifetime: CHURN.life, spread: CHURN.spread * (jet ? 1 : 0.75), foam: 0.95, aeration: 0, slick: 0 });
      ocean.addFoamTrail(pt(LACE.width * (0.65 + 0.7 * c), planing * (0.06 + 0.3 * c * c)),
        { key, width: LACE.width, lifetime: LACE.life, spread: LACE.spread, foam: 0.05, aeration: planing * (jet ? 0.55 : 0.4), aerationLife: LACE.aerationLife, slick: 1 });
    });
  }

  // The Kelvin arms (side +1 port, -1 starboard), as two foam lists. `line`: the breaking bow-wave
  // shoulder and the residual foam it leaves along the arm (the visible half-angle off the hull side),
  // bright for the first ~30 m, then a thin line that is whiter on the crests and thins in the troughs.
  // `caps`: where the divergent waves crest near the arm the steepest of them spill, a white streak along
  // each crest. The crests are taken from the ocean's own wake field (ocean.waveSources.height, the field
  // it displaces the surface with), so the foam sits on the waves it draws. Caps are laid crest by crest
  // with zero-foam joints.
  _armPoints(t, side, ocean) {
    const P = this.ctv.pose, U = Math.abs(P.speed), line = [], caps = [];
    if (U < 3.5 || P.speed < 0) return [line, caps];
    const fwd = azimuthToDir(P.heading, this._w), g = this.ctv.group.position, ta = Math.tan(kelvinVisibleHalfAngle(U) * DEG);
    const sx = g.x + fwd.x * CTV_STEM_Z, sz = g.z + fwd.z * CTV_STEM_Z, px = side * fwd.z, pz = -side * fwd.x;   // stem; outward (port = (fz, -fx))
    const W = ocean?.waveSources, src = W?.list?.[0], live = typeof W?.height === 'function' && src && Math.hypot(src.x - sx, src.z - sz) < 30;
    const D = CTV_HULL_X + CTV_HULL_W, at = (xs, o, f) => { const ys = D + xs * ta * f; o.x = sx - fwd.x * xs + px * ys; o.z = sz - fwd.z * xs + pz * ys; return o; };   // off the hull side
    // the ocean's field relative to the source it last resolved (it moved on by up to a frame since);
    // without one (dev stubs, the frame after a seek) the line is laid plain and there are no caps
    const field = (x, z) => (live ? W.height(x + src.x - sx, z + src.z - sz) : 0);
    const xs0 = 0.35 * C.length, n = Math.ceil((U * ARM_MAX_AGE_S - xs0) / 2), h = new Float32Array(n + 1), q = {};
    // the arm, then two rays inside it: near the hull the first divergent crests are steep enough to
    // spill too, so they carry short caps of their own (fading with age much faster than the arm's)
    for (const f of live ? [1, 0.6, 0.3] : [1]) {
      for (let i = 0; i <= n; i++) { at(xs0 + 2 * i, q, f); h[i] = field(q.x, q.z); }   // every 2 m along the ray
      for (let i = 0; i <= n; i++) {
        let m = 1e-6;
        for (let j = Math.max(0, i - 8); j <= Math.min(n, i + 8); j++) m = Math.max(m, Math.abs(h[j]));
        const xs = xs0 + 2 * i, a = xs / U, sh = Math.exp(-a / ARM_SHOULDER_S), { x, z } = at(xs, q, f), r = h[i] / m;
        const base = smooth(3.5, 9, U) * (1 - smooth(0.6 * ARM_MAX_AGE_S, ARM_MAX_AGE_S, a));
        if (f === 1) line.push({ x, z, t: t - a, width: 0.9 + 0.8 * sh, foam: base * (0.9 * sh + 0.18) * (0.5 + 0.5 * smooth(-0.4, 0.9, r)) });
        if (!(i > 0 && i < n && h[i] > h[i - 1] && h[i] >= h[i + 1] && r > 0.35)) continue;
        // along the crest: normal to the field's gradient (one-sided differences, 0.5 m)
        let ex = field(x, z + 0.5) - h[i], ez = h[i] - field(x + 0.5, z);
        const e = Math.hypot(ex, ez) || 1, half = (3 + 5 * sh) * (0.4 + 0.6 * f), foam = base * (f === 1 ? 0.8 * sh + 0.2 : sh) * smooth(0.35, 0.8, r);
        ex /= e; ez /= e;
        for (const k of [-1, 0, 1]) caps.push({ x: x + ex * half * k, z: z + ez * half * k, t: t - a, width: 1.2 + 1.3 * sh, foam: k ? 0 : foam });
      }
    }
    return [line, caps];
  }

  // Divergent and transverse bow waves: the ocean evaluates the Kelvin wave field of each moving
  // hull from ocean.setWaveSources([{ x, z (stem), headingDeg, speed, length, beam, amplitude,
  // halfAngleDeg }]) sent every frame (empty when the CTV is not under way). The amplitude is the
  // full-speed value; the ocean ramps it with speed.
  _emitWaves(P, ocean) {
    this.kelvin.length = 0;
    if (P.speed > 1.5) {
      const g = this.ctv.group.position, d = azimuthToDir(P.heading, this._w);
      this.kelvin.push({ x: g.x + d.x * CTV_STEM_Z, z: g.z + d.z * CTV_STEM_Z, headingDeg: P.heading, speed: P.speed, length: C.length, beam: C.beam, amplitude: CTV_WAVE_AMP, halfAngleDeg: kelvinVisibleHalfAngle(P.speed) });
    }
    ocean.setWaveSources?.(this.kelvin);
  }

  // Beyond the ocean's ±256 m foam map: the hull wake as one ribbon over the span of the two jets with
  // the ocean's density law (their mean cover: clumps of white, lace and gaps between), and the arms.
  _updateDecal(t, cam) {
    const tr = this._tr, wake = [];
    for (let a = 0.5; a <= WAKE_LIFETIME_S; a += 0.5) {
      if (!this._trackAt(t - a, tr)) break;
      if (tr.speed < 1) { if (wake.length > 1) break; continue; }
      const d = azimuthToDir(tr.heading, this._w);
      wake.push({ x: tr.x + d.x * CTV_TRANSOM_Z, z: tr.z + d.z * CTV_TRANSOM_Z, width: 2 * CTV_HULL_X + LACE.width + 2 * LACE.spread * a,
        alpha: 0.14 * smooth(1.5, 9, tr.speed) * foamDensity(a, LACE.life) });
    }
    const arms = (this._arms || []).map((pts) => pts.map((p) => ({ ...p, alpha: p.foam * foamDensity(t - p.t, ARM_MAX_AGE_S + 1) })));
    this.decal.set([wake, ...arms], cam);
  }

  // ---------------------------------------------------------------- lights
  _updateLights(t) {
    const ctx = this.ctx, sunEl = sunElevationDeg(ctx), v = this._v, d = this._w;
    const dusk = smooth(FLOODS_ON_BELOW_DEG + 2, FLOODS_ON_BELOW_DEG, sunEl);   // 0 by day, 1 once the sun is 3° down
    this.lamps.levels[0] = sunEl < NAV_ON_BELOW_DEG ? 1 : 0;
    this.lamps.levels[1] = dusk;
    // floods: the SOV always works at night; the CTV while on a landing or backing off
    const on = (vessel) => (vessel === this.sov || this.ctv.pose.leg.kind !== 'transit' ? dusk : 0);
    this.lampList.forEach((L, i) => {
      L.vessel.localToWorld(L.pos, v);
      this.lamps.setPosition(i, v);
      // Rule 27(b)(iii): masthead, side and stern lights only when making way through the water;
      // an SOV holding station on DP shows its red-white-red and deck floods only
      if (L.beam === LAMP_BEAM.flood) this.lamps.lamp.array[i * 4] = on(L.vessel) > 0 ? L.cd : 0;
      else if (L.underway) this.lamps.lamp.array[i * 4] = L.vessel.makingWay === false ? 0 : L.cd;
      this.lamps.setAxis(i, L.half >= 180 ? null : L.vessel.bearingDir(L.rel, d), Math.min(L.half, 180) * DEG);
    });
    this.lamps.lamp.needsUpdate = true;
    this.lamps.markMoved();
    this.lamps.update(t, exposedScale(ctx));
    // The SOV, 13.4 km out on station, for the ocean's distant light columns: its floodlit decks and
    // superstructure as one extended source (~28 klm of LED flood on ~40 % albedo decks, ~1800 cd
    // seen from abeam, ESTIMATED), sent when the floods' level changes (the CTV is near the camera
    // whenever it matters: the planar mirror carries it).
    if (typeof ctx.ocean?.setDistantLights === 'function' && Math.abs(dusk - (this._pubDusk ?? -1)) > 0.02) {
      this._pubDusk = dusk;
      ctx.ocean.setDistantLights(dusk > 0 ? [{ ...this.sov.focus(), cd: 1800 * dusk, color: WARM, width: 60 }] : [], 'vessels');
    }
    // bow floods on the landing (a real light; intensity in scene units = cd / lux per unit)
    const spot = this.landingSpot, onLanding = this.ctv.pose.leg.kind === 'hold' ? on(this.ctv) : 0;
    spot.intensity = onLanding * LANDING_SPOT.cd / SCENE_LUX;
    if (onLanding > 0) {
      this.ctv.localToWorld([0, CTV_WHEELHOUSE.roof - 0.24, CTV_WHEELHOUSE.z1 + 0.72], spot.position);
      this.ctv.localToWorld([0, 3.0, CTV_BOW_Z + 6.0], spot.target.position);
      spot.target.updateMatrixWorld();
    }
    // Interior daylight: ~3 % daylight factor on a white ceiling (0.8) from the outdoor horizontal
    // illuminance (sun on the horizontal + sky); the outside seen across a room is the horizon sky.
    const sun = U.uSunIlluminance.value, sy = Math.max(U.uSunDir.value.y, 0), sky = U.uFogInscatter.value, k = 0.8 / Math.PI * 0.03;
    for (const vessel of [this.ctv, this.sov]) {
      const cd = FLOOD_CD[vessel === this.ctv ? 'ctv' : 'sov'], w = on(vessel) * cd / SCENE_LUX;
      vessel.spec.floods.forEach((F, i) => {
        vessel.localToWorld(F.pos, v);
        d.fromArray(F.dir).transformDirection(vessel.group.matrixWorld);
        vessel.floods.uFloodP.value[i].set(v.x, v.y, v.z, w);
        vessel.floods.uFloodD.value[i].set(d.x, d.y, d.z, Math.cos(F.halfDeg * DEG));
      });
      const [w0, w1, w2] = vessel.materials.window.uWin.value, sovV = vessel === this.sov;
      w0.set((sovV ? ROOM_CDM2.sov : ROOM_CDM2.ctv) / SCENE_LUX, sovV ? 0.45 : 1, SCREEN_CDM2 / SCENE_LUX, 0.55);
      w1.set((sun.r * sy + sky.r * Math.PI * 0.6) * k, (sun.g * sy + sky.g * Math.PI * 0.6) * k, (sun.b * sy + sky.b * Math.PI * 0.6) * k, 0);
      w2.set(sky.r * 0.72, sky.g * 0.72, sky.b * 0.72, 0);
    }
  }

  _clearTrails() {
    for (const k of [...HULL_TRAILS, ...CHURN_TRAILS, ...ARM_TRAILS, ...SIDE_TRAILS, ...BOW_TRAILS, ...HOLD_JET_TRAILS, ...HOLD_EDDY_TRAILS]) this.ctx.ocean?.clearTrail?.(k);
    this._lay.p = null;
  }
}

// Distance from the TP axis to the outer face of the boat-landing tubes along the landing axis:
// from the farm's built tubes when available, else from config (the modeller's ladder offset).
function landingFaceDistance(farm, axis) {
  const tubes = farm?.builds?.[0]?.landingTubes;
  if (tubes?.length) return Math.max(...tubes.map((t) => t.x * axis.x + t.z * axis.z + t.radius));
  return TURBINE.tp.diameter / 2 + 0.35 + TURBINE.boatLanding.ladderSetback;     // turbine.js: ladder 0.35 m off the TP wall
}

// Visible half-angle of the Kelvin wake (deg): Rabaud & Moisy (2013) angle of maximum amplitude
// α = 1 / (2 sqrt(2π) Fr) for Fr > 0.6 (Kelvin's 19.47° below), with Fr on the wetted length,
// which shortens by ~25 % once the hull planes (bow clear of the water).
export function kelvinVisibleHalfAngle(speed) {
  const L = (CTV_STEM_Z - CTV_TRANSOM_Z - 1.5) * (1 - 0.25 * smooth(6, 10, speed));
  return Math.min(Math.asin(1 / 3) / DEG, 1 / (2 * Math.sqrt(TAU) * Math.max(speed / Math.sqrt(9.81 * L), 1e-3)) / DEG);
}

// Dev builds only (compiled out of the kirt.lol bundle): scale registry rows and a route summary.
function devReport(vs) {
  const { ctv, sov } = vs, src = 'vessels.js: measured from the built geometry (vessel frame)';
  const size = (v) => v.box.getSize(V3(0, 0, 0));
  const reg = (name, measure, axis, metres, tolerance, source = src) => registerScale({ name, measure, expect: { axis, metres, tolerance }, source });
  // highest vertex inside a local x/z rectangle below yMax (deck and roof heights)
  const topIn = (v, [x0, x1], [z0, z1], yMax) => {
    let top = -Infinity;
    for (const m of v.meshes) {
      const p = m.geometry.attributes.position;
      for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); if (x >= x0 && x <= x1 && z >= z0 && z <= z1 && y < yMax) top = Math.max(top, y); }
    }
    return top;
  };
  // width of the rubber at the bow: the paint geometry's black vertices ahead of the stems
  const fenderWidth = () => {
    const g = ctv.meshes.find((m) => m.name.endsWith('.paint')).geometry, p = g.attributes.position, c = g.attributes.color;
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < p.count; i++) if (p.getZ(i) > CTV_STEM_Z + 0.05 && c.getX(i) < 0.02) { lo = Math.min(lo, p.getX(i)); hi = Math.max(hi, p.getX(i)); }
    return hi - lo;
  };
  const B = SOV_BRIDGE, [gx, , gz] = SOV_GANGWAY_PIVOT, W = CTV_WHEELHOUSE;
  reg('ctv.length', () => size(ctv), 'z', C.length, 0.3);
  reg('ctv.beam', () => size(ctv), 'x', C.beam, 0.3);
  reg('ctv.draft', () => -ctv.box.min.y, 'y', C.draft, 0.1);
  reg('ctv.foredeckY', () => topIn(ctv, [-0.5, 0.5], [3.6, 4.8], 2.5), 'y', C.foredeckY, 0.15);
  reg('ctv.wheelhouseRoofY', () => topIn(ctv, [-3, 3], [W.z0 - 0.3, W.z1 + 0.9], 6.7), 'y', C.wheelhouseRoofY, 0.15);
  reg('ctv.mastheadLightY', () => ctv.spec.lights[0].pos[1], 'y', C.mastheadLightY, 0.2, 'lamp position (COLREGS Annex I §2(a)(i), SCENE-SPEC §14)');
  reg('ctv.bowFender.width', fenderWidth, 'x', 3.0, 0.1);
  reg('ctv.wake.kelvinHalfAngleDeg@22kn', () => vs.kelvinHalfAngleDeg, 'x', 12.5, 2.5, 'Rabaud & Moisy 2013 on the planing wetted length (config VESSELS.wake.visibleHalfAngleDeg 10-15)');
  reg('sov.length', () => size(sov), 'z', S.length, 0.5);
  reg('sov.beam', () => size(sov), 'x', S.beam, 0.5);
  reg('sov.draft', () => -sov.box.min.y, 'y', S.draft, 0.2);
  reg('sov.bridgeTopY', () => topIn(sov, [-3, 3], [B.z0 + 0.5, B.z1 - 0.5], 22.3), 'y', S.bridgeTopY, 0.3);
  reg('sov.mastY', () => sov.box.max.y, 'y', S.mastY, 0.5);
  reg('sov.gangwayTowerTopY', () => topIn(sov, [gx - 2.3, gx + 2.3], [gz - 2.3, gz + 2.3], 26), 'y', S.gangwayTowerTopY, 0.5, 'pedestal top (SCENE-SPEC §14: ~25 m)');
  reg('sov.distanceFromHero', () => Math.hypot(sov.station.x, sov.station.z), 'x', 13442, 150, 'station at turbine (8, 6) (SCENE-SPEC §14: 13.4 km)');
  // closest approach of the CTV centre to any turbine other than the two it serves
  const served = new Set(ctv.route.landings.map((l) => l.turbine.id));
  let minD = Infinity, at = null;
  for (const leg of ctv.route.legs) if (leg.kind === 'transit') for (let i = 0; i < leg.path.x.length; i += 5) {
    for (const tb of vs.turbines) { const dd = Math.hypot(tb.x - leg.path.x[i], tb.z + leg.path.n[i]); if (!served.has(tb.id) && dd < minD) { minD = dd; at = tb.id; } }
  }
  vs.routeInfo = {
    periodS: +ctv.route.period.toFixed(1),
    legs: ctv.route.legs.map((l) => ({ name: l.name, kind: l.kind, t0: +l.t0.toFixed(1), duration: +l.duration.toFixed(1), length: l.plan ? +l.plan.length.toFixed(0) : undefined })),
    closestOtherTurbineM: +minD.toFixed(0), closestTurbine: at, landingFaceDistanceM: +vs.landingFaceDistance.toFixed(3),
    sovStation: { x: +sov.station.x.toFixed(1), z: +sov.station.z.toFixed(1), turbine: sov.turbine.id },
  };
}

export { CtvRoute };
