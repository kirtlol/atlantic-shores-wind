// Atlantic Shores "Large" offshore substation (OSS), SCENE-SPEC §6: 8-leg piled jacket, legs yellow to
// +16 m, foundation interface +22.6 m, topside 90 x 50 x 40 m (top +62.6 m MSL) with a clad main module,
// an upper module, a corner helideck, a pedestal crane, walkways, lifeboats and cable J-tubes.
// Owner: modeller. Built in metres in a local frame (long axis +X, width +Z, MSL origin); the returned
// group is already rotated so the long axis runs along SUBSTATION.longAxisBearingDeg. Farm only sets
// group.position (x, -curvatureDrop, z).
import * as THREE from 'three';
import { SUBSTATION, TURBINE, SCALE_TABLE } from '../config.js';
import { registerScale, LAYER_REFLECT } from '../shared.js';
import { SURF, GEOM, OSS_HELIDECK as HELI, createTurbineMaterials, builderPositions } from './turbine.js';

const { revolve, tube, box, aabb, bar, railRun, sweepRect, gratingSlab, lensDome, L864_DOME, newBuilders } = GEOM;
const { paintMisc: S_PAINT, yellowMisc: S_YELLOW, galvMisc: S_GALV, darkMisc: S_DARK } = SURF;
const DEG = Math.PI / 180;
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const S = SUBSTATION, ST = TURBINE.stack;
const HALF_L = S.topside.length / 2, HALF_W = S.topside.width / 2;   // 45, 25
const Y0 = S.interfaceY, Y1 = S.topY;                                // 22.6, 62.6
const SEABED = -27;                                  // ESTIMATED: ASOW depth grows offshore (19-37 m)
const LEG_X = [-33, -11, 11, 33], LEG_Z = [-15, 15]; // ESTIMATED jacket top footprint (66 x 30 m)
const BATTER = 1 / 10;                               // ESTIMATED leg batter
const LEG_R = 1.2, BRACE_R = 0.55, HORIZ_R = 0.45;
const BRACE_LEVELS = [-20, -6, 8, 19.5];
const Y_CELLAR = 26.0, Y_MAIN = 31.0, Y_UPPER = 50.0, Y_ROOF2 = 57.0;
const MODULE = { x: 43.5, z: 22.4 };
const UPPER = { x0: -30, x1: 18, z: 18 };
// Topside furniture (ESTIMATED from published OSS photos: Hornsea/Borssele/Revolution-class topsides).
const Y_GALLERY = 40.5;                              // external escape gallery round the main module's long sides
const GALLERY_W = 1.2;
const RADIATOR_BANKS = [-25, 0, 25];                 // transformer radiator banks per long side (x centres), 10 m long
const LIFEBOAT = { z: HALF_W + 1.9, x: [-31, -15], y: Y_MAIN + 1.9, length: 8.5, beam: 3.2, height: 2.9 };   // +Z side faces the farm (WSW)

const legAt = (ix, iz, y) => {
  const xt = LEG_X[ix], zt = LEG_Z[iz], k = (Y0 - y) * BATTER;
  return V3(xt + (Math.abs(xt) > 20 ? Math.sign(xt) * k : 0), y, zt + Math.sign(zt) * k);
};

// Paint zones up a jacket member: submerged pile colour, marine growth, yellow to +16 m, grey above.
function zoneOf(y, B) {
  if (y < ST.growthBottom) return [B.growth, SURF.pile];
  if (y < ST.growthTop) return [B.growth, SURF.growth];
  if (y < S.legYellowTop) return [B.yellow, SURF.jacket];
  return [B.paint, S_PAINT];
}
function member(B, p0, p1, r, sides) {
  const ts = [0, 1];
  for (const yb of [ST.growthBottom, ST.growthTop, S.legYellowTop]) {
    if ((p0.y - yb) * (p1.y - yb) < 0) ts.push((yb - p0.y) / (p1.y - p0.y));
  }
  ts.sort((a, b) => a - b);
  for (let i = 0; i < ts.length - 1; i++) {
    const a = V3().lerpVectors(p0, p1, ts[i]), b = V3().lerpVectors(p0, p1, ts[i + 1]);
    const [bld, surf] = zoneOf((a.y + b.y) / 2, B);
    bld.set({ surf, band: 0, wear: 0 });
    tube(bld, a, b, r, sides);
  }
}

function buildJacket(B) {
  for (let ix = 0; ix < 4; ix++) for (let iz = 0; iz < 2; iz++) member(B, legAt(ix, iz, SEABED), legAt(ix, iz, Y0 - 0.05), LEG_R, 24);
  for (const y of BRACE_LEVELS) {
    for (let iz = 0; iz < 2; iz++) for (let ix = 0; ix < 3; ix++) member(B, legAt(ix, iz, y), legAt(ix + 1, iz, y), HORIZ_R, 12);
    for (let ix = 0; ix < 4; ix++) member(B, legAt(ix, 0, y), legAt(ix, 1, y), HORIZ_R, 12);
  }
  for (let l = 0; l < BRACE_LEVELS.length - 1; l++) {
    const ya = BRACE_LEVELS[l], yb = BRACE_LEVELS[l + 1];
    for (let iz = 0; iz < 2; iz++) for (let ix = 0; ix < 3; ix++) {
      member(B, legAt(ix, iz, ya), legAt(ix + 1, iz, yb), BRACE_R, 12);
      member(B, legAt(ix + 1, iz, ya), legAt(ix, iz, yb), BRACE_R, 12);
    }
    for (let ix = 0; ix < 4; ix++) {
      member(B, legAt(ix, 0, ya), legAt(ix, 1, yb), BRACE_R, 12);
      member(B, legAt(ix, 1, ya), legAt(ix, 0, yb), BRACE_R, 12);
    }
  }
  // Cable J-tubes: three up each inner -Z leg, bell-mouthed J-bend at the seabed.
  for (const ix of [1, 2]) for (const dx of [-1.9, 0, 1.9]) {
    const off = V3(dx, 0, 2.0);
    const top = legAt(ix, 0, Y0 - 0.1).add(off), low = legAt(ix, 0, SEABED + 4).add(off);
    member(B, low, top, 0.3, 12);
    const bend = low.clone().add(V3(0, -2.2, -1.2)), mouth = low.clone().add(V3(0, -3.2, -4.5));
    member(B, low, bend, 0.3, 12); member(B, bend, mouth, 0.3, 12);
    for (const y of [-20, -6, 8]) {                          // clamps to the leg
      const [bld, surf] = zoneOf(y, B); bld.set({ surf });
      bar(bld, legAt(ix, 0, y), legAt(ix, 0, y).add(off), 0.3, 0.25);
    }
  }
}

// Horizontal walkway grating (see-through) as a thin two-faced plate, bars along x.
const gratingPlate = (g, x0, x1, z0, z1, y) => gratingSlab(g, [V3(x0, 0, z0), V3(x1, 0, z0), V3(x1, 0, z1), V3(x0, 0, z1)], y, -1);

function buildTopside(T, lights) {
  const { paint, galvanised: galv, dark, lensRed, thin, grating } = T;
  // Cellar (cable) deck: deep main girders over the jacket legs, shallower perimeter girders and
  // secondary beams every 3 m, grating floor: an open steel frame, not a slab.
  paint.surf(S_PAINT);
  const yPer = Y_CELLAR - 1.6;
  aabb(paint, -HALF_L, yPer, HALF_W - 0.6, HALF_L, Y_CELLAR, HALF_W);
  aabb(paint, -HALF_L, yPer, -HALF_W, HALF_L, Y_CELLAR, -HALF_W + 0.6);
  aabb(paint, -HALF_L, yPer, -HALF_W, -HALF_L + 0.6, Y_CELLAR, HALF_W);
  aabb(paint, HALF_L - 0.6, yPer, -HALF_W, HALF_L, Y_CELLAR, HALF_W);
  for (const x of LEG_X) aabb(paint, x - 0.45, Y0, -HALF_W, x + 0.45, Y_CELLAR, HALF_W);
  for (const z of LEG_Z) aabb(paint, -HALF_L, Y0, z - 0.45, HALF_L, Y_CELLAR, z + 0.45);
  for (let x = -42; x <= 42; x += 3) if (!LEG_X.some((lx) => Math.abs(lx - x) < 1)) aabb(paint, x - 0.18, Y_CELLAR - 0.75, -HALF_W + 0.6, x + 0.18, Y_CELLAR - 0.03, HALF_W - 0.6);
  gratingPlate(grating, -HALF_L + 0.6, HALF_L - 0.6, -HALF_W + 0.6, HALF_W - 0.6, Y_CELLAR);
  // Open cellar level: columns and switchgear rooms. (The OSS is >= 13 km from every preset view, its 90 m
  // topside 3-6 px wide, so features under ~1 m are left out: cellar X-bracing, cable trays, gallery brackets, the
  // boom lattice, fan grilles; since round 4 also the stair flights, wall louvres and doors and the roof plant.)
  paint.surf(S_PAINT);
  const colX = [-44.3, -22, 0, 22, 44.3];
  for (const x of colX) for (const z of [-24.3, 24.3]) aabb(paint, x - 0.5, Y_CELLAR, z - 0.5, x + 0.5, Y_MAIN - 0.8, z + 0.5);
  for (const x of LEG_X) for (const z of LEG_Z) aabb(paint, x - 0.5, Y_CELLAR, z - 0.5, x + 0.5, Y_MAIN - 0.8, z + 0.5);
  dark.surf(S_DARK);
  for (const [x0, x1, z0, z1] of [[-40, -26, -12, 8], [-20, -4, -20, -6], [26, 40, -14, 2]]) aabb(dark, x0, Y_CELLAR, z0, x1, Y_MAIN - 1.6, z1);
  paint.surf(SURF.cladding);
  aabb(paint, -8, Y_CELLAR, 6, 2, Y_MAIN - 0.8, 18);
  aabb(paint, 4, Y_CELLAR, 4, 20, Y_MAIN - 1.4, 20);
  // Main deck plate and walkway grating.
  paint.surf(S_PAINT);
  aabb(paint, -HALF_L, Y_MAIN - 0.8, -HALF_W, HALF_L, Y_MAIN, HALF_W);
  galv.set({ surf: SURF.grating, wear: 0 });
  aabb(galv, -HALF_L, Y_MAIN, MODULE.z, HALF_L, Y_MAIN + 0.03, HALF_W);
  aabb(galv, -HALF_L, Y_MAIN, -HALF_W, HALF_L, Y_MAIN + 0.03, -MODULE.z);
  aabb(galv, -HALF_L, Y_MAIN, -MODULE.z, -MODULE.x, Y_MAIN + 0.03, MODULE.z);
  aabb(galv, MODULE.x, Y_MAIN, -MODULE.z, HALF_L, Y_MAIN + 0.03, MODULE.z);
  // Clad main module (RAL 7035) and upper module (RAL 9010): the two-tone reads at distance.
  paint.surf(SURF.cladding);
  aabb(paint, -MODULE.x, Y_MAIN, -MODULE.z, MODULE.x, Y_UPPER, MODULE.z);
  paint.surf(SURF.claddingWhite);
  aabb(paint, UPPER.x0, Y_UPPER, -UPPER.z, UPPER.x1, Y_ROOF2, UPPER.z);
  // Transformer radiator banks outside both long walls (the most recognisable OSS feature from the sea).
  for (const zs of [-1, 1]) for (const xc of RADIATOR_BANKS) {
    const z0 = zs * MODULE.z, z1 = zs * (MODULE.z + 1.2);
    paint.surf(SURF.radiatorBank);
    aabb(paint, xc - 5, Y_MAIN + 0.4, Math.min(z0, z1), xc + 5, Y_MAIN + 6.4, Math.max(z0, z1));
    dark.surf(S_DARK);                     // header pipes into the wall
    for (const y of [Y_MAIN + 6.0, Y_MAIN + 0.8]) tube(dark, V3(xc - 4.6, y, zs * (MODULE.z + 0.6)), V3(xc + 4.6, y, zs * (MODULE.z + 0.6)), 0.22, 10);
  }
  // External escape galleries on the long sides at +40.5: grating with an edge channel, railed.
  for (const zs of [-1, 1]) {
    const z0 = zs * MODULE.z, z1 = zs * (MODULE.z + GALLERY_W);
    gratingPlate(grating, -MODULE.x, MODULE.x, Math.min(z0, z1), Math.max(z0, z1), Y_GALLERY);
    thin.surf(S_GALV);
    sweepRect(thin, [V3(-MODULE.x, Y_GALLERY - 0.12, z1), V3(MODULE.x, Y_GALLERY - 0.12, z1)], 0.06, 0.18);
    railRun(thin, [V3(-MODULE.x, 0, z1 - zs * 0.04), V3(MODULE.x, 0, z1 - zs * 0.04)], Y_GALLERY, 6, false, 1.5, true);
  }
  // Rails round the walkway and the main roof.
  const rect = (hx, hz) => [V3(-hx, 0, -hz), V3(hx, 0, -hz), V3(hx, 0, hz), V3(-hx, 0, hz)];
  railRun(thin, rect(HALF_L - 0.05, HALF_W - 0.05), Y_MAIN, 6, true, 1.5, true);
  railRun(thin, rect(MODULE.x - 0.05, MODULE.z - 0.05), Y_UPPER, 6, true, 1.5, true);
  // Roof -> helideck: the stair landings and a railed bridge onto the helideck's north-west diagonal edge.
  const HS = { z0: 19.5, z1: 20.5, mid: Y_UPPER + (HELI.y - Y_UPPER) / 2 };
  galv.set({ surf: SURF.grating, wear: 0 });
  aabb(galv, 14.3, HS.mid - 0.06, HS.z0 - 0.1, 15.5, HS.mid, HS.z1 + 0.1);
  aabb(galv, 20.8, HELI.y - 0.06, HS.z0 - 0.1, 25.4, HELI.y, HS.z1 + 0.1);
  paint.surf(S_PAINT);
  for (const x of [14.9, 23.1]) for (const z of [HS.z0, HS.z1]) {
    const yTop = x < 20 ? HS.mid - 0.06 : HELI.y - 0.06;
    tube(paint, V3(x, Y_UPPER, z), V3(x, yTop, z), 0.09, 8);
  }
  railRun(thin, [V3(20.8, 0, HS.z0 - 0.08), V3(25.2, 0, HS.z0 - 0.08)], HELI.y, 6, false, 1.2, true);
  railRun(thin, [V3(20.8, 0, HS.z1 + 0.08), V3(24.6, 0, HS.z1 + 0.08)], HELI.y, 6, false, 1.2, true);
  // Helideck: octagonal deck on a braced frame over the +X/+Z corner, sloped safety net.
  const R8 = (HELI.flat / 2) / Math.cos(22.5 * DEG);
  const hc = V3(HELI.x, 0, HELI.z);
  const octAt = (r, i, y) => { const a = (22.5 + 45 * i) * DEG; return V3(hc.x + r * Math.cos(a), y, hc.z + r * Math.sin(a)); };
  paint.surf(S_PAINT);
  for (let i = 0; i < 8; i++) {
    const top = octAt(R8 * 0.72, i, HELI.y - 0.45), bottom = octAt(R8 * 0.72, i, Y_UPPER);
    tube(paint, bottom, top, 0.32, 10);
    const nb = octAt(R8 * 0.72, i + 1, Y_UPPER + 0.4), nt = octAt(R8 * 0.72, i + 1, HELI.y - 0.8);
    tube(paint, V3(bottom.x, Y_UPPER + 0.4, bottom.z), nt, 0.12, 6);
    tube(paint, V3(top.x, HELI.y - 0.8, top.z), nb, 0.12, 6);
  }
  paint.push(new THREE.Matrix4().makeTranslation(hc.x, 0, hc.z));
  revolve(paint, [[0, HELI.y - 0.45], [R8, HELI.y - 0.45], [R8, HELI.y]], 8, { az0: 90 - 22.5, az1: 90 - 22.5 + 360 });
  paint.pop();
  dark.surf(S_DARK);
  dark.push(new THREE.Matrix4().makeTranslation(hc.x, 0, hc.z));
  const netOuter = (HELI.flat / 2 + HELI.net) / Math.cos(22.5 * DEG);
  revolve(dark, [[R8, HELI.y - 0.02], [netOuter, HELI.y - 0.3], [netOuter, HELI.y - 0.36], [R8, HELI.y - 0.12]], 8, { az0: 90 - 22.5, az1: 90 - 22.5 + 360 });
  dark.pop();
  // Helideck surface (its markings are drawn by the paint shader, surface code 26): an octagonal fan.
  paint.surf(SURF.helideck);
  const ring = [], c = paint.vert(hc.x, HELI.y + 0.001, hc.z, 0, 1, 0);
  for (let i = 0; i <= 8; i++) { const q = octAt(R8, i % 8, HELI.y + 0.001); ring.push(paint.vert(q.x, q.y, q.z, 0, 1, 0)); }
  for (let i = 0; i < 8; i++) paint.tri(c, ring[i], ring[i + 1]);
  // Pedestal crane with its boom (the four chords) parked along the -Z edge of the roof.
  const yellow = T.yellow;
  yellow.surf(S_YELLOW);
  const ped = V3(-38, Y_UPPER, -17);
  tube(yellow, ped, V3(ped.x, Y_UPPER + 4.2, ped.z), 1.1, 20);
  aabb(yellow, ped.x - 2.2, Y_UPPER + 4.2, ped.z - 1.8, ped.x + 1.6, Y_UPPER + 7.2, ped.z + 1.8);
  dark.surf(S_DARK);
  aabb(dark, ped.x + 1.6, Y_UPPER + 5.4, ped.z + 0.3, ped.x + 1.65, Y_UPPER + 6.9, ped.z + 1.6);   // cab window
  thin.surf(S_YELLOW);
  const apex = V3(ped.x - 0.8, Y_UPPER + 10.6, ped.z);
  for (const dz of [-1.4, 1.4]) bar(thin, V3(ped.x - 1.6, Y_UPPER + 7.2, ped.z + dz), apex, 0.3, 0.3);
  const pivot = V3(ped.x + 1.2, Y_UPPER + 5.0, ped.z), tipB = V3(-6, Y_UPPER + 5.9, -21.2);
  const axis = V3().subVectors(tipB, pivot), len = axis.length(); axis.normalize();
  const side = V3(0, 1, 0).cross(axis).normalize(), upv = V3().crossVectors(axis, side).normalize();
  const chord = (t, sx, sy) => { const w = THREE.MathUtils.lerp(0.75, 0.3, t); return pivot.clone().addScaledVector(axis, t * len).addScaledVector(side, sx * w).addScaledVector(upv, sy * w); };
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (const [sx, sy] of corners) tube(thin, chord(0, sx, sy), chord(1, sx, sy), 0.1, 6);
  // Aviation obstruction lights (L-810) on galvanised posts with a dark housing and a red lens dome: the four
  // top corners of the main module and four more near +31 m at the deck corners.
  const lamps = (hx, hz, y0, yc, postR) => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => {
    const x = sx * hx, z = sz * hz;
    tube(thin.surf(S_GALV), V3(x, y0, z), V3(x, yc - 0.25, z), postR, 10);
    tube(dark.surf(S_DARK), V3(x, yc - 0.25, z), V3(x, yc - 0.13, z), 0.19, 14);
    lensDome(lensRed, x, yc, z, L864_DOME, 14, 0);
    return V3(x, yc, z);
  });
  lights.l810Top = lamps(MODULE.x - 0.25, MODULE.z - 0.25, Y_UPPER, Y1 - L864_DOME[3][1], 0.12);
  lights.l810Mid = lamps(HALF_L - 0.3, HALF_W - 0.3, Y_MAIN, Y_MAIN + 0.35, 0.05);
}

// Appendages outside the measured topside box: two enclosed (TEMPSC) lifeboats on davits outboard of
// the +Z main-deck walkway (the side facing the farm).
function buildLifeSaving(L) {
  const { paint, thin } = L;
  const B = LIFEBOAT, hl = B.length / 2, r = (B.beam + B.height) / 4;
  for (const xc of B.x) {
    // enclosed hull: a body of revolution about the boat's long axis, rounded bow and stern
    paint.set({ surf: SURF.lifeboat, band: 0, wear: 0 }).push(new THREE.Matrix4().makeRotationZ(-Math.PI / 2).setPosition(xc, B.y + 0.15, B.z));
    revolve(paint, [[0, -hl], [0.55 * r, 0.35 - hl], [0.9 * r, 1.4 - hl], [r, 2.4 - hl], [r, hl - 2.4], [0.9 * r, hl - 1.4], [0.55 * r, hl - 0.35], [0, hl]], 16, { smooth: true });
    paint.pop();
    for (const dx of [-2.6, 2.6]) {                          // davit arms
      thin.surf(S_PAINT);
      const head = V3(xc + dx, B.y + B.height * 0.55 + 1.6, B.z);
      bar(thin, V3(xc + dx, Y_MAIN, HALF_W - 0.3), V3(xc + dx, Y_MAIN + 3.2, HALF_W + 0.3), 0.3, 0.3);
      bar(thin, V3(xc + dx, Y_MAIN + 3.2, HALF_W + 0.3), head, 0.24, 0.24);
    }
  }
}

let REGISTERED = false;

/** Build the ASOW Large OSS. Returns a THREE.Group (MSL origin, long axis on bearing 170.6 deg). */
export function buildSubstation() {
  const mats = createTurbineMaterials();
  const B = newBuilders('paint yellow growth'), Tb = newBuilders('paint yellow galvanised dark lensRed thin grating'), Jx = newBuilders('lensYellow dark galvanised');
  buildJacket(B);
  const lights = {};
  buildTopside(Tb, lights);
  // Marine lanterns (+20 m) on brackets off two opposite corner legs.
  const my = S.lights.marineY;
  lights.marine = [[3, 0], [0, 1]].map(([ix, iz]) => {
    const leg = legAt(ix, iz, my), p = leg.clone().addScaledVector(V3(Math.sign(leg.x), 0, Math.sign(leg.z)).normalize(), LEG_R + 0.9);
    const at = (dy) => p.clone().setY(my + dy);
    bar(Jx.galvanised.surf(S_GALV), leg.clone().setY(my - 0.5), at(-0.5), 0.15, 0.15);
    tube(Jx.dark.surf(S_DARK), at(-0.5), at(-0.15), 0.14, 14);
    tube(Jx.lensYellow.surf(0), at(-0.15), at(0.15), 0.1, 14, false);
    tube(Jx.dark, at(0.15), at(0.22), 0.13, 14);
    return at(0);
  });
  // Dev builds measure the topside from its geometry for the scale report (the kirt.lol build defines
  // globalThis.NJOW_DEV = false and drops this). The lifeboats hang outboard of the measured box,
  // so they are built afterwards, into the same parts (no extra draw calls).
  let dims = null;
  if (globalThis.NJOW_DEV !== false) {
    const box3 = new THREE.Box3();
    for (const b of Object.values(Tb)) for (const p of builderPositions(b)) box3.expandByPoint(p);
    const size = box3.getSize(V3());
    dims = { topsideLength: size.x, topsideWidth: size.z, topsideHeight: size.y, topsideBottomY: box3.min.y, topY: box3.max.y };
    if (!REGISTERED) {
      REGISTERED = true;
      for (const [k, axis] of [['Length', 'x'], ['Width', 'z'], ['Height', 'y']]) {
        const name = `substation.topside${k}`, v = dims[`topside${k}`], ref = SCALE_TABLE[name];
        registerScale({ name, measure: () => ({ x: 0, y: 0, z: 0, [axis]: v }), expect: { axis, metres: ref.metres, tolerance: ref.tolerance }, source: 'src/turbine/substation.js (measured topside bounding box, local frame)' });
      }
    }
  }
  buildLifeSaving(Tb);
  const group = new THREE.Group();
  group.name = 'substation';
  for (const [tag, set] of [['jacket', B], ['topside', Tb], ['fittings', Jx]]) {
    for (const [k, b] of Object.entries(set)) {
      if (!b.count) continue;
      const mesh = new THREE.Mesh(b.build(), mats[k]);
      mesh.name = mesh.geometry.name = `substation.${tag}.${k}`;
      mesh.castShadow = mesh.receiveShadow = !k.startsWith('lens');
      mesh.layers.enable(LAYER_REFLECT);
      group.add(mesh);
    }
  }
  // One bounding sphere for every mesh (as turbine.js does): the transparent parts sort at one depth and draw in
  // part order (thin features, then grating) under either depth convention.
  const box = new THREE.Box3(), sphere = new THREE.Sphere();
  for (const m of group.children) box.union(m.geometry.boundingBox);
  box.getBoundingSphere(sphere);
  for (const m of group.children) m.geometry.boundingSphere = sphere.clone();
  group.rotation.y = (90 - S.longAxisBearingDeg) * DEG;       // local +X -> bearing 170.6 deg
  group.userData = {
    longAxisBearingDeg: S.longAxisBearingDeg, interfaceY: Y0, topY: Y1, seabedY: SEABED,
    lights,                                                   // local frame: world = group.localToWorld(p.clone())
    dims, drawCalls: group.children.length,
  };
  if (dims) group.userData.triangles = group.children.reduce((n, m) => n + m.geometry.index.count / 3, 0);
  return group;
}
