// Local surface effects (owner: ocean): disturbances (splash / boil / nervous), pile wash rings and
// foam trails. The ocean shader evaluates disturbances and pile wash analytically per fragment
// (crisp at 20-40 m); foam trails (vessel wakes, arbitrarily long) are rasterised every frame as
// ribbons into a camera-centred, world-snapped foam map that the ocean samples.
import * as THREE from 'three';
import { SplashMap, SPLASH_HALF, SPLASH_RES } from './ocean-splash.js';

// Disturbances near the action are stamped into the splash map (ocean-splash.js, no limit);
// MAX_DISTURBANCES is the analytic per-pixel list: every boil (their domes displace the mesh) and
// the splashes nearest the camera that fall outside the map.
export const MAX_DISTURBANCES = 32;
export const MAX_LIVE = 4096;                                // disturbances kept alive at once
export const MAX_PILES = 8;
const THIN_PILE_RADIUS = 1.0, THIN_PILE_REACH = 250;   // m: see _nearPiles
const PILE_CELL_M = 1024;                                    // pile lookup grid
export const KIND = { splash: 0, boil: 1, nervous: 3 };   // (no caller used 'wake': round 4 folded it into 'splash')

// Physical constants for ring ripples (capillary-gravity waves, deep water).
export const RIPPLE_G = 9.81, RIPPLE_T = 7.28e-5;          // g, σ/ρ (m³/s²)
export const RIPPLE_CG_MAX = 0.95;                          // m/s, fastest group velocity kept (λ ≈ 2.3 m)
export const BOIL_DOME_M = 0.16;                            // dome height per unit strength (ESTIMATED)
// Pile wash foam density vs distance d from the pile wall: contact·e^(-d/contactM) (the rim the water
// slapping the wall leaves all round, wider in a bigger sea) + lace·e^(-d/laceM) (ESTIMATED to give the
// 0.5-1.5 m ring of SCENE-SPEC §11.1), modulated by the incidence (weather side), the arrival of crests
// and the sea state in the shader.
// Run-up: on the weather side the incident crest climbs runup × η within ~runupM of the wall.
export const PILE_WASH = { contact: 1.3, contactM: 0.45, lace: 0.55, laceM: 0.8, runup: 0.8, runupM: 2.0 };

// Foam trail map: camera-centred, 1024² RGBA half float, (R foam, G aeration, B slick,
// A flow direction). The mapping is warped, u = ½ + ½·d / (|d| + TRAIL_WARP_M) per axis (d = metres
// from the centre), so texels are 0.31 m at the camera, ~2 m at 256 m, and the map still reaches
// ~2.5 km: a wake's glassy scar stays visible for hundreds of metres behind the boat. Foam (R)
// fades out at ±TRAIL_HALF (square metric, 5 % edge) exactly as before, where the vessels
// module's flat far-field decal takes over; aeration and slick continue to TRAIL_FAR_M.
export const TRAIL_HALF = 256;               // foam extent (m), the vessels decal handoff
export const TRAIL_WARP_M = 160;             // warp scale (m)
export const TRAIL_FAR_M = 2000;             // aeration / slick extent (m)
const TRAIL_RES = 1024;
const TRAIL_MAX_POINTS = 4096;
// Defaults for the wake channels (ESTIMATED from photographs of crew boats at 20-25 kn): the
// turquoise bubble plume of the propwash stays visible 200-300 m astern (e-fold 30 s); the
// capillary-damped "wake scar" lasts minutes and widens slowly.
export const TRAIL_DEFAULTS = { aerationLife: 30, slickLife: 300, slickSpread: 0.12, slickMinLifetime: 30 };
// Wake foam: white turbulent water e-folding in WAKE_WHITE_S (~100 m of white centreline at 22 kn,
// still patchy at 300 m), then lace and streaks e-folding in 0.75 × the trail's lifetime (30-90 s
// for the vessels' 60 s), fading out over the last 30 % of the lifetime.
const WAKE_WHITE_S = 9, WAKE_WHITE = 0.95, WAKE_LACE = 0.45, WAKE_FRESH_S = 1.0;
export const TRAIL_GLSL = /* glsl */`
float ocTrailWarp(float d) { return d / (abs(d) + ${TRAIL_WARP_M.toFixed(1)}); }
`;

export class OceanEffects {
  constructor(renderer) {
    this.renderer = renderer;
    this.slots = [];                    // active disturbances, oldest first
    this.nextId = 1;
    this.piles = [];
    this.trails = new Map();            // key -> { width, lifetime, spread, foam, ..., points: [] }
    // the trail map and the splash map share one mip-mapped atlas (left / right half): the ocean
    // shader reads both through one texture unit
    this.atlas = new THREE.WebGLRenderTarget(2 * TRAIL_RES, TRAIL_RES, {
      type: THREE.HalfFloatType, depthBuffer: false, generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
    });
    this.atlas.texture.name = 'ocean.trails+splashes';
    this.atlas.texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    this.splash = new SplashMap(renderer, { g: RIPPLE_G, tension: RIPPLE_T }, this.atlas);
    this._stamps = []; this._stampPool = []; this._far = []; this._nervous = [];
    this._fwd = new THREE.Vector3();
    this._pileGrid = new Map(); this._pileBest = new Array(MAX_PILES); this._pileBestD = new Float64Array(MAX_PILES);
    this.nearPiles = [];
    this.stats = {};                    // dev builds: { live, stamped, analytic, dropped }
    this.uniforms = {
      uDistA: { value: Array.from({ length: MAX_DISTURBANCES }, () => new THREE.Vector4()) },
      uDistB: { value: Array.from({ length: MAX_DISTURBANCES }, () => new THREE.Vector4()) },
      uDistCount: { value: 0 },
      uPiles: { value: Array.from({ length: MAX_PILES }, () => new THREE.Vector4()) },
      uPileCount: { value: 0 },
      uFxMap: { value: null },     // trail map (left half) and splash map (right half), one sampler
      uTrailArea: { value: new THREE.Vector4(0, 0, 1 / (2 * TRAIL_HALF), 0) },   // (centre x, centre z rel. to snap, 1/(2·TRAIL_HALF), on)
      uDistBound: { value: new THREE.Vector4(1e9, 1e9, -1e9, -1e9) },              // analytic list bounds (x0, z0, x1, z1) rel. to snap
      uSplashArea: { value: new THREE.Vector4(0, 0, 1 / (2 * SPLASH_HALF), 0) },  // (centre x, z rel. to snap, 1/size, on)
    };
    // --- trail map
    this.uniforms.uFxMap.value = this.atlas.texture;
    const g = new THREE.BufferGeometry();
    const nv = TRAIL_MAX_POINTS * 2;
    this.trailPos = new Float32Array(nv * 3);
    this.trailA = new Float32Array(nv * 4);        // (age, foam lifetime, side, foam)
    this.trailB = new Float32Array(nv * 4);        // (aeration, slick, arc length, flow direction 0..1)
    this.trailC = new Float32Array(nv * 4);        // (foam half-width, ribbon half-width, aeration life, slick life)
    g.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aTrailA', new THREE.BufferAttribute(this.trailA, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aTrailB', new THREE.BufferAttribute(this.trailB, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aTrailC', new THREE.BufferAttribute(this.trailC, 4).setUsage(THREE.DynamicDrawUsage));
    const idx = [];
    for (let i = 0; i < TRAIL_MAX_POINTS - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    g.setIndex(idx);
    this.trailMat = new THREE.ShaderMaterial({
      uniforms: { uFoamTex: { value: null }, uOrigin: { value: new THREE.Vector2() } },
      vertexShader: /* glsl */`
${TRAIL_GLSL}
attribute vec4 aTrailA;
attribute vec4 aTrailB;
attribute vec4 aTrailC;
uniform vec2 uOrigin;      // world (x, z) of the map centre
varying vec4 vA;
varying vec4 vB;
varying vec4 vC;
varying vec2 vWorld;
varying float vAcross;     // metres from the track centre line
varying float vRange;      // square-metric distance from the map centre (m)
void main() {
  vA = aTrailA; vB = aTrailB; vC = aTrailC;
  vWorld = vec2(position.x + uOrigin.x, -position.y + uOrigin.y);   // absolute world x, z
  vAcross = aTrailA.z * aTrailC.y;
  vRange = max(abs(position.x), abs(position.y));
  gl_Position = vec4(ocTrailWarp(position.x), ocTrailWarp(position.y), 0.0, 1.0);
}`,
      fragmentShader: /* glsl */`
uniform sampler2D uFoamTex;
varying vec4 vA;           // age, foam lifetime, side (-1..1), foam
varying vec4 vB;           // aeration, slick, arc length (m), flow direction
varying vec4 vC;           // foam half-width, ribbon half-width, aeration life, slick life
varying vec2 vWorld;
varying float vAcross;
varying float vRange;
void main() {
  float age = vA.x, life = vA.y;
  float across = abs(vAcross);
  // turbulent wake: dense aerated water right behind the stern for a few seconds, then patchy
  // foam whose frayed edges open up with age, breaking into streaks along the track
  float n = texture2D(uFoamTex, vWorld / 23.0).g * 0.6 + texture2D(uFoamTex, vWorld / 7.0).r * 0.4;
  float fEdge = 1.0 - smoothstep((0.25 + 0.3 * n) * vC.x, vC.x * (0.8 + 0.4 * n), across);
  // mean density: white turbulent water, then lace that gathers into streaks along the track
  // (keeping its mean) and fades out over the end of the trail's lifetime
  float dens = ${WAKE_WHITE.toFixed(2)} * exp(-age / ${WAKE_WHITE_S.toFixed(1)}) + ${WAKE_LACE.toFixed(2)} * exp(-age / max(0.75 * life, 1.0));
  float along = texture2D(uFoamTex, vec2(vB.z / 96.0, vAcross / 6.4)).b;     // ~12 m long, ~0.8 m wide streaks
  float streaks = mix(1.0, 2.0 * smoothstep(0.38, 0.78, along), smoothstep(4.0, 20.0, age));
  // (the boils of turquoise water that break the white water are drawn at the sea's own resolution
  // by its foam lace, not here: this map's 0.3 m texels would turn them into blocks)
  // the first ~2 s (20-25 m at 22 kn) are solid, bubbly white water: densities above one, which the
  // ocean's lace draws without holes, before the foam opens into lace
  float fresh = exp(-age / ${WAKE_FRESH_S.toFixed(1)});
  float foam = min(vA.w * dens * fEdge * mix(0.45 + 0.8 * n, 1.6, fresh) * streaks, 0.95 + 0.5 * fresh) * (1.0 - smoothstep(0.7 * life, life, age));
  // aeration: the bubble cloud under the wake, wider and longer-lived than the surface foam
  float aEdge = 1.0 - smoothstep(0.35 * vC.y, 1.1 * vC.x + 0.2 * vC.y, across);
  float plume = texture2D(uFoamTex, vWorld / 41.0 + vec2(0.13, 0.71)).g;            // patchy bubble plumes
  float aer = vB.x * exp(-age / max(vC.z, 0.5)) * aEdge * (0.5 + 0.9 * plume);
  // slick: capillary damping over the whole ribbon, fading over minutes
  float sEdge = 1.0 - smoothstep(0.6 * vC.y, vC.y, across);
  float slick = vB.y * exp(-age / max(vC.w, 1.0)) * sEdge * smoothstep(0.0, 4.0, age);
  // the handoff to the vessels' far-field decal stays exactly where it was
  foam *= 1.0 - smoothstep(0.9 * ${TRAIL_HALF.toFixed(1)}, ${TRAIL_HALF.toFixed(1)}, vRange);
  float far = 1.0 - smoothstep(0.8 * ${TRAIL_FAR_M.toFixed(1)}, ${TRAIL_FAR_M.toFixed(1)}, vRange);
  gl_FragColor = vec4(foam, aer * far, slick * far, (foam + aer + slick) > 1e-4 ? vB.w : 0.0);
}`,
      blending: THREE.CustomBlending, blendEquation: THREE.MaxEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
      depthTest: false, depthWrite: false, side: THREE.DoubleSide,
    });
    this.trailMesh = new THREE.Mesh(g, this.trailMat);
    this.trailMesh.frustumCulled = false;
    this.trailScene = new THREE.Scene();
    this.trailScene.add(this.trailMesh);
    this.trailCam = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1);
    this._clear = new THREE.Color();
  }

  setFoamTexture(tex) { this.trailMat.uniforms.uFoamTex.value = tex; this.splash.setFoamTexture(tex); }

  // ---------------------------------------------------------------- disturbances
  // opts.t0 (animation seconds) lets a caller start a disturbance in the past (a pre-rolled blitz).
  add({ x, z, radius = 1, strength = 1, duration = 4, foam = 1, kind = 'splash', t0 }, t) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return -1;
    if (this.slots.length >= MAX_LIVE) this.slots.shift();       // recycle the oldest
    const k = KIND[kind] ?? 0;
    const id = this.nextId++;
    this.slots.push({
      id, x, z, t0: Number.isFinite(t0) ? Math.min(t0, t) : t, kind: k,
      radius: Math.max(0.05, radius), strength: Math.max(0, strength),
      duration: Math.max(0.2, duration), foam: THREE.MathUtils.clamp(foam, 0, 1.5),
      seed: (id * 0.6180339887) % 1,
    });
    return id;
  }
  // A disturbance stays alive until its foam has decayed and its ring has left the area.
  _life(d) {
    if (d.kind === KIND.nervous) return d.duration;
    return Math.max(d.duration * 1.6, Math.min((d.radius * 6 + 8) / RIPPLE_CG_MAX, 3.0 + d.duration * 2.0));
  }
  // Radius of the area a disturbance touches at a given age (foam, aeration and its ring train).
  _reach(d, age) { return d.radius * 2.4 + RIPPLE_CG_MAX * Math.min(age, 2.0 + d.radius * 3.0) + 0.6; }

  // Height of boil domes at (x, z) (CPU mirror of the vertex shader's ocDisturbHeight).
  domeHeight(x, z, t) {
    let h = 0;
    for (const d of this.slots) {
      if (d.kind !== KIND.boil) continue;
      const age = t - d.t0;
      if (age < 0) continue;
      const r2 = ((x - d.x) ** 2 + (z - d.z) ** 2) / (d.radius * d.radius);
      if (r2 > 9) continue;
      h += BOIL_DOME_M * d.strength * boilEnvelope(age, d.duration) * Math.exp(-r2);
    }
    return h;
  }

  // ---------------------------------------------------------------- piles
  setPiles(list) {
    this.piles = (list || []).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.z)).map((p) => ({ x: p.x, z: p.z, radius: p.radius ?? 5.25, surge: 0 }));
    this._pileGrid = new Map();
    for (const p of this.piles) {
      const k = Math.floor(p.x / PILE_CELL_M) * 65536 + Math.floor(p.z / PILE_CELL_M);
      if (!this._pileGrid.has(k)) this._pileGrid.set(k, []);
      this._pileGrid.get(k).push(p);
    }
  }

  // ---------------------------------------------------------------- foam trails
  // points: [{ x, z, width?, foam?, t? }]. Consecutive calls with the same key extend one ribbon.
  // t (animation seconds) is when the point was laid down (default: now), so a caller can seed a
  // wake that already has history. opts: { key, width, lifetime, spread, foam, aeration,
  // aerationLife, slick, slickLife, slickSpread } (the wake channels default from TRAIL_DEFAULTS:
  // aeration = foam; a slick only on trails that live ≥ 30 s, i.e. hull wakes, not re-laid arms).
  addTrail(points, opts, t) {
    const key = opts?.key ?? 'default';
    let tr = this.trails.get(key);
    if (!tr) { tr = { points: [], s: 0 }; this.trails.set(key, tr); }
    tr.width = opts?.width ?? tr.width ?? 6;
    tr.lifetime = opts?.lifetime ?? tr.lifetime ?? 60;
    tr.spread = opts?.spread ?? tr.spread ?? 0.25;      // m/s widening of each side
    tr.foam = opts?.foam ?? tr.foam ?? 1;
    // aerated water: hull wakes carry a bubble cloud; short-lived foam (bow-wave arms, splashes of
    // wash) mostly does not
    tr.aeration = opts?.aeration ?? tr.aeration ?? Math.min(1, tr.foam) * (tr.lifetime >= 20 ? 1 : 0.2);
    tr.aerationLife = opts?.aerationLife ?? tr.aerationLife ?? TRAIL_DEFAULTS.aerationLife;
    tr.slick = opts?.slick ?? tr.slick ?? (tr.lifetime >= TRAIL_DEFAULTS.slickMinLifetime ? 0.8 : 0);
    tr.slickLife = opts?.slickLife ?? tr.slickLife ?? TRAIL_DEFAULTS.slickLife;
    tr.slickSpread = opts?.slickSpread ?? tr.slickSpread ?? TRAIL_DEFAULTS.slickSpread;
    for (const p of points || []) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) continue;
      const last = tr.points[tr.points.length - 1];
      const d = last ? Math.hypot(p.x - last.x, p.z - last.z) : 0;
      if (last && d < 0.5) continue;                                             // keep ≥ 0.5 m apart
      tr.s += d;
      tr.points.push({ x: p.x, z: p.z, t: Number.isFinite(p.t) ? Math.min(p.t, t) : t, width: p.width ?? tr.width, foam: p.foam ?? tr.foam, s: tr.s });
    }
    while (tr.points.length > TRAIL_MAX_POINTS / 2) tr.points.shift();
  }
  clearTrail(key = 'default') { this.trails.delete(key); }
  // How long a trail's points are kept: until the foam, the aeration and the slick are all gone.
  _keep(tr) { return Math.max(tr.lifetime, tr.aeration > 0 ? 4 * tr.aerationLife : 0, tr.slick > 0 ? 2.5 * tr.slickLife : 0); }
  // Old points are thinned out (the slick is wide and smooth): spacing 0.5 m young, ~12 m at 100 s.
  _decimate(tr, t) {
    const pts = tr.points;
    if (pts.length < 3) return;
    const out = [pts[0]];
    for (let i = 1; i < pts.length - 1; i++) {
      const p = pts[i], q = out[out.length - 1];
      const need = Math.min(12, 0.5 + 0.12 * (t - p.t));
      if (Math.hypot(p.x - q.x, p.z - q.z) >= need) out.push(p);
    }
    out.push(pts[pts.length - 1]);
    tr.points = out;
  }

  // ---------------------------------------------------------------- per frame
  update(t, camera, snap, windSpeed = 4.5) {
    // disturbances: expire in place (no per-frame allocation)
    let w = 0;
    for (const d of this.slots) if (t - d.t0 < this._life(d) && t >= d.t0 - 1e-3) this.slots[w++] = d;
    this.slots.length = w;
    // splash-map focus: the sea point the camera looks at (≤ 150 m ahead), then the centroid of
    // the splashes within 90 m of it
    const cp = camera.position, f = camera.getWorldDirection(this._fwd);
    const h = Math.max(cp.y, 1), horiz = Math.hypot(f.x, f.z);
    const ahead = f.y < -0.02 ? Math.min(h * horiz / -f.y, 150) : 150;
    const gx = cp.x + (horiz > 1e-4 ? f.x / horiz : 0) * ahead, gz = cp.z + (horiz > 1e-4 ? f.z / horiz : 0) * ahead;
    let sx = 0, sz = 0, sn = 0;
    for (const d of this.slots) {
      if (d.kind === KIND.boil || d.kind === KIND.nervous) continue;
      if (Math.abs(d.x - gx) < 90 && Math.abs(d.z - gz) < 90) { sx += d.x; sz += d.z; sn++; }
    }
    const map = this.splash;
    const tex = 2 * SPLASH_HALF / SPLASH_RES;
    // the map re-centres only when the action's centroid has moved 12 m: a centre that followed
    // every new splash pushed older ones (their ring trains still spreading) out of the map early
    if (sn && (!this._mc || Math.hypot(sx / sn - this._mc.x, sz / sn - this._mc.z) > 12)) this._mc = { x: Math.round(sx / sn / tex) * tex, z: Math.round(sz / sn / tex) * tex };
    if (!sn) this._mc = null;
    const mcx = this._mc ? this._mc.x : 0, mcz = this._mc ? this._mc.z : 0;
    const stamps = this._stamps; stamps.length = 0;
    const far = this._far; far.length = 0;
    const patches = this._nervous; patches.length = 0;
    for (const d of this.slots) {
      const age = Math.max(0, t - d.t0);
      if (d.kind === KIND.nervous) { patches.push(d); continue; }
      // a splash stamped into the map stays there for its whole life (its ring tail fades at the
      // map's edge) rather than dropping to the capped analytic list as its rings spread
      const reach = this._reach(d, age);
      if (d.kind !== KIND.boil && sn && (map.contains(mcx, mcz, d.x, d.z, reach) || (d._map === mcx * 7919 + mcz && map.contains(mcx, mcz, d.x, d.z, d.radius * 2.4)))) {
        d._map = mcx * 7919 + mcz;
        const s = this._stampPool[stamps.length] || (this._stampPool[stamps.length] = {});
        s.x = d.x; s.z = d.z; s.radius = d.radius; s.strength = d.strength; s.duration = d.duration;
        s.foam = d.foam; s.kind = d.kind; s.age = age; s.reach = reach; s.seed = d.seed;
        stamps.push(s);
      } else {
        d._dist = d.kind === KIND.boil ? -1 : (d.x - cp.x) ** 2 + (d.z - cp.z) ** 2;   // boils first
        far.push(d);
      }
    }
    map.render(stamps, mcx, mcz, windSpeed);
    this.uniforms.uSplashArea.value.set(mcx - snap.x, mcz - snap.y, 1 / (2 * SPLASH_HALF), map.on ? 1 : 0);
    if (far.length > MAX_DISTURBANCES) far.sort((a, b) => a._dist - b._dist);
    const A = this.uniforms.uDistA.value, B = this.uniforms.uDistB.value;
    const nA = Math.min(far.length, MAX_DISTURBANCES);
    let bx0 = Infinity, bz0 = Infinity, bx1 = -Infinity, bz1 = -Infinity;
    for (let i = 0; i < nA; i++) {
      const d = far[i], age = Math.max(0, t - d.t0), reach = this._reach(d, age) + 3 * d.radius;
      A[i].set(d.x - snap.x, d.z - snap.y, d.radius, d.strength);
      B[i].set(age, d.duration, d.foam, d.kind);
      bx0 = Math.min(bx0, d.x - reach); bx1 = Math.max(bx1, d.x + reach); bz0 = Math.min(bz0, d.z - reach); bz1 = Math.max(bz1, d.z + reach);
    }
    this.uniforms.uDistCount.value = nA;
    // bounding box of the analytic list: one test per pixel skips the loop over the rest of the sea
    this.uniforms.uDistBound.value.set(bx0 - snap.x, bz0 - snap.y, bx1 - snap.x, bz1 - snap.y);
    if (globalThis.NJOW_DEV !== false) this.stats = { live: this.slots.length, stamped: stamps.length, analytic: nA, dropped: far.length - nA };
    // piles: nearest MAX_PILES to the camera from a 1 km grid (no per-frame sorting of every pile)
    this._nearPiles(cp.x, cp.z, snap);
    // trails
    this._renderTrails(t, camera, snap);
  }

  _nearPiles(cx, cz, snap) {
    const best = this._pileBest, bd = this._pileBestD;
    let n = 0;
    const scan = (r) => {
      const ix = Math.floor(cx / PILE_CELL_M), iz = Math.floor(cz / PILE_CELL_M);
      for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) {
        const cell = this._pileGrid.get((ix + i) * 65536 + (iz + j));
        if (!cell) continue;
        for (const p of cell) {
          const d = (p.x - cx) ** 2 + (p.z - cz) ** 2;
          // Thin members (boat-landing tubes, r 0.2 m) compete for a slot only near the camera: beyond
          // THIN_PILE_REACH their wash is sub-pixel, and the hero's two tubes plus each neighbour's
          // took 5 of the 8 slots, leaving the third turbine of the row without wash (p1 integration;
          // farm pilePositions() lists TPs, tubes and jacket members together).
          if (p.radius < THIN_PILE_RADIUS && d > THIN_PILE_REACH * THIN_PILE_REACH) continue;
          if (n < MAX_PILES) { let k = n++; while (k > 0 && bd[k - 1] > d) { bd[k] = bd[k - 1]; best[k] = best[k - 1]; k--; } bd[k] = d; best[k] = p; }
          else if (d < bd[n - 1]) { let k = n - 1; while (k > 0 && bd[k - 1] > d) { bd[k] = bd[k - 1]; best[k] = best[k - 1]; k--; } bd[k] = d; best[k] = p; }
        }
      }
    };
    scan(1);
    if (n < MAX_PILES && this.piles.length > n) { n = 0; scan(4); }
    for (let i = 0; i < n; i++) this.uniforms.uPiles.value[i].set(best[i].x - snap.x, best[i].z - snap.y, best[i].radius, best[i].surge ?? 0);
    this.uniforms.uPileCount.value = n;
    this.nearPiles = best.slice(0, n);
  }

  _renderTrails(t, camera, snap) {
    const area = this.uniforms.uTrailArea.value;
    let n = 0;
    const texel = 2 * TRAIL_WARP_M / TRAIL_RES;                  // texel size at the centre
    const ox = Math.round(camera.position.x / texel) * texel, oz = Math.round(camera.position.z / texel) * texel;
    const maxV = TRAIL_MAX_POINTS * 2 - 2;
    this._frame = (this._frame || 0) + 1;
    for (const [key, tr] of this.trails) {
      const keep = this._keep(tr);
      let drop = 0;
      while (drop < tr.points.length && t - tr.points[drop].t >= keep) drop++;
      if (drop) tr.points.splice(0, drop);
      if ((this._frame + tr.points.length) % 30 === 0) this._decimate(tr, t);
      if (tr.points.length < 2) { if (!tr.points.length) this.trails.delete(key); continue; }
      if (n > 0 && n + 4 < maxV) {
        // join separate ribbons with two collapsed rows (all joint triangles have zero area)
        const p0 = tr.points[0];
        this._putVertex(n++, this._lastX, this._lastZ); this._putVertex(n++, this._lastX, this._lastZ);
        this._putVertex(n++, p0.x - ox, p0.z - oz); this._putVertex(n++, p0.x - ox, p0.z - oz);
      }
      for (let i = 0; i < tr.points.length && n < maxV; i++) {
        const p = tr.points[i], q = tr.points[Math.min(i + 1, tr.points.length - 1)], o = tr.points[Math.max(i - 1, 0)];
        let dx = q.x - o.x, dz = q.z - o.z; const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
        const age = t - p.t;
        const foamHalf = 0.5 * p.width + tr.spread * age;
        const slickHalf = tr.slick > 0 ? 0.5 * p.width + tr.slickSpread * age : 0;
        const half = Math.max(foamHalf * 1.15, slickHalf);
        let ang = Math.atan2(dz, dx); if (ang < 0) ang += Math.PI; if (ang >= Math.PI) ang -= Math.PI;
        const dir01 = 0.02 + 0.96 * ang / Math.PI;
        const x = p.x - ox, z = p.z - oz;
        for (let side = -1; side <= 1; side += 2) {
          this._putVertex(n, x - side * dz * half, z + side * dx * half);
          const i4 = n * 4;
          this.trailA[i4] = age; this.trailA[i4 + 1] = tr.lifetime; this.trailA[i4 + 2] = side; this.trailA[i4 + 3] = p.foam;
          this.trailB[i4] = tr.aeration * Math.min(1, p.foam / Math.max(tr.foam, 1e-3)); this.trailB[i4 + 1] = tr.slick; this.trailB[i4 + 2] = p.s; this.trailB[i4 + 3] = dir01;
          this.trailC[i4] = foamHalf; this.trailC[i4 + 1] = half; this.trailC[i4 + 2] = tr.aerationLife; this.trailC[i4 + 3] = tr.slickLife;
          n++;
        }
        this._lastX = x + dz * half; this._lastZ = z - dx * half;
      }
    }
    area.set(ox - snap.x, oz - snap.y, 1 / (2 * TRAIL_HALF), n > 0 ? 1 : 0);
    this.trailMat.uniforms.uOrigin.value.set(ox, oz);
    if (n === 0 && !this._trailDirty) return;
    this._trailDirty = n > 0;
    const g = this.trailMesh.geometry;
    for (const a of ['position', 'aTrailA', 'aTrailB', 'aTrailC']) g.attributes[a].needsUpdate = true;
    g.setDrawRange(0, Math.max(0, (n / 2 - 1) * 6));
    const r = this.renderer;
    const prev = r.getRenderTarget(), prevAuto = r.autoClear, prevAlpha = r.getClearAlpha();
    r.getClearColor(this._clear);
    r.setClearColor(0x000000, 0);
    const rt = this.atlas;
    rt.viewport.set(0, 0, TRAIL_RES, TRAIL_RES); rt.scissor.copy(rt.viewport); rt.scissorTest = true;
    r.setRenderTarget(rt);
    r.autoClear = true;                                   // clears this half only (scissor)
    r.render(this.trailScene, this.trailCam);
    r.setRenderTarget(prev);
    r.autoClear = prevAuto;
    r.setClearColor(this._clear, prevAlpha);
  }

  _putVertex(i, x, z) {
    // the map's y axis is world -z (north up): world (x, z) -> (x, -z); joint rows carry zero weights
    this.trailPos[i * 3] = x; this.trailPos[i * 3 + 1] = -z; this.trailPos[i * 3 + 2] = 0;
    const i4 = i * 4;
    this.trailA[i4] = 1e4; this.trailA[i4 + 1] = 1; this.trailA[i4 + 2] = 0; this.trailA[i4 + 3] = 0;
    this.trailB[i4] = 0; this.trailB[i4 + 1] = 0; this.trailB[i4 + 2] = 0; this.trailB[i4 + 3] = 0;
    this.trailC[i4] = 1; this.trailC[i4 + 1] = 1; this.trailC[i4 + 2] = 1; this.trailC[i4 + 3] = 1;
  }

  dispose() { this.atlas.dispose(); this.trailMat.dispose(); this.trailMesh.geometry.dispose(); this.splash.dispose(); }
}

// Boil dome envelope: rises in ~0.4 s, then subsides over the duration (shared by CPU and GLSL).
export function boilEnvelope(age, duration) {
  const rise = THREE.MathUtils.smoothstep(age, 0, 0.4);
  return rise * Math.exp(-age / Math.max(duration * 0.5, 0.2));
}
export const BOIL_ENVELOPE_GLSL = /* glsl */`
float ocBoilEnvelope(float age, float duration) {
  return smoothstep(0.0, 0.4, age) * exp(-age / max(duration * 0.5, 0.2));
}`;
