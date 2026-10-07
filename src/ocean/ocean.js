// The sea (owner: ocean). See ARCHITECTURE.md "ocean/ocean.js — Ocean" and SCENE-SPEC §11.
//
//   ocean.getHeight(x, z, t)                  world y of the displaced surface (includes curvature)
//   ocean.getSurface(x, z, t, out)            { y, normal, velocity } for floating bodies
//     (cost: ~40-120 µs for the first call at a new t, then ~10-20 µs per call; the last four
//      times are cached, so sampling t, t + T/2 and t + T every frame stays cheap)
//   ocean.addDisturbance({ x, z, radius, strength, duration, foam, kind, t0 })  -> id
//      kind: 'splash' | 'boil' | 'nervous'; t0 (optional) starts it in the past.
//      Splashes near the action go to the splash map (no limit); boils and far ones stay analytic.
//   ocean.addFoamTrail(points, { key, width, lifetime, spread, foam, aeration, aerationLife,
//                               slick, slickLife, slickSpread }), ocean.clearTrail(key)
//      A vessel's wake: per frame, one trail per transom (key per hull) with the newest point
//      { x, z, t, width, foam } ~1 m astern; foam <= 1 is white turbulent water that e-folds in 9 s
//      (~100 m at 22 kn), then lace e-folding in 0.75 x lifetime (60 s: lace for 30-90 s); aeration
//      (default = foam) is the turquoise propwash plume, e-fold aerationLife (default 30 s); slick
//      (default 0.8 for lifetime >= 30 s) is the glassy scar, e-fold slickLife (300 s), widening at
//      slickSpread (0.12 m/s); spread (m/s) widens the foam. Short re-laid trails (bow-wave arms,
//      lifetime < 20 s) get aeration 0.2 x foam and no slick unless given.
//   ocean.setWaveSources([{ x, z, headingDeg | dirX, dirZ, speed, length, beam, amplitude,
//                          halfAngleDeg }])     Kelvin wakes, sent every frame (a list lapses after 1 s):
//      x, z at the bow on the centreline, every frame; displacement and slopes of the transverse
//      and divergent systems inside the cusp, a pressure trough along the hull and a pile-up at the
//      stem; getHeight includes the waves but not the hull's own trough; ocean.wakeHeight(x, z) gives
//      their elevation alone
//   ocean.setLifePatches([{ x, z, radius, heading, bait, nervous, hue, slick: [{ x, z, width, age }] }])
//   ocean.setSeaState({ windSpeed, windFromDeg, swellHs, swellFromDeg, swellPeriod }, { immediate })
//   ocean.setDistantLights(key, { count, position, colour, intensity[, beam][, extent] }) or
//   ocean.setDistantLights(list[, key]): lamps beyond the mirror's reach as analytic glitter
//      columns (<= ocean.distantLightCapacity; nearer than ocean.distantLightMinDistance the mirror
//      draws them; the full contract is in ocean-lights.js)
//   ocean.setPiles([{ x, z, radius }]); the camera polarizer is U.uPolarizer (shared with the sky)
//   ocean.displacementUniforms() -> { uDisp0, uDisp1, uOcCas, uOcOff, uSnap, uRing, uGrid }: the live
//      uniform objects of the displaced surface (geometry cascades 0-1), for decals that ride the waves.
//      Share them by reference (or copy the values every frame after ocean.update). For a world point
//      (x, z): q = (x, z) − uSnap; per cascade c, uv = R(c)·q·uOcCas[c].z + uOcOff[c] with
//      R(c) = [[cas.x, cas.y], [−cas.y, cas.x]] (cascadeSamplingGLSL in ocean-fft.js, `ocCascadeUv`);
//      texture(uDisp0, uv0).xyz + texture(uDisp1, uv1).xyz = (Dx, η, Dz): the point (x, z) + (Dx, Dz)
//      sits at height η − curvatureDrop. To match the mesh, band-limit each lookup to the local vertex
//      spacing d: lod = log2(max(uGrid.w · d / uOcCas[c].w, 1)), d = max(uRing.x + uRing.z · r, r · dθ) at
//      range r from the camera nadir (dθ ≈ 2π (1 − uGrid.y) / uGrid.z ahead of the camera).
//      uOcCas[c] = (cos, sin, 1 / tile, metres per texel); uRing = (s0, ln(1 + a), a, rings).
//   ocean.mesh, ocean.reflectionTarget (ocean.effects.stats in dev builds)
//   ocean.update(dt, t, camera), ocean.setQuality(q), ocean.dispose()
//
// Pieces: spectrum.js (sea state + spectrum), ocean-fft.js (GPU cascades), surface-cpu.js (CPU
// mirror), ocean-mesh.js (polar grid), ocean-material.js (shading), ocean-reflection.js (mirror),
// ocean-effects.js (disturbances, pile wash, trails), ocean-splash.js (splash map), ocean-wake.js
// (vessel wave field), ocean-life.js (bait / nervous water), ocean-lights.js (distant light columns),
// ocean-textures.js (textures, sky maps).
import * as THREE from 'three';
import { U, curvatureDrop, registerScale, EARTH_R, LAYER_REFLECT } from '../shared.js';
import { SEA } from '../config.js';
import {
  CASCADES, FFT_SIZE, resolveSeaState, resolvedSlopeMoments, coxMunk, cascadeFrame,
  wrapIndex, modeK, inBand, spectrumK,
} from './spectrum.js';
import { OceanFFT } from './ocean-fft.js';
import { SurfaceMirror } from './surface-cpu.js';
import { buildPolarGrid, ringParams, HEADING_WARP } from './ocean-mesh.js';
import { PlanarReflection, MIRROR_L0_EXPOSED } from './ocean-reflection.js';
import { OceanEffects, RIPPLE_G, RIPPLE_T, PILE_WASH } from './ocean-effects.js';
import { WaveSources } from './ocean-wake.js';
import { LifePatches } from './ocean-life.js';
import { DistantLights, DISTANT_CAPACITY, DISTANT_MIN_DISTANCE } from './ocean-lights.js';
import { foamTexture, SkyReflectionMap, SLICK_TILE_M } from './ocean-textures.js';
import { createOceanMaterial } from './ocean-material.js';

const DEG = Math.PI / 180;
const SNAP_M = 2048;                  // texture-lookup origin granularity (keeps float UVs precise)
const SEA_STATE_TAU_S = 1.2;          // setSeaState transitions ease with this time constant ...
const SEA_STATE_STEP_S = 0.1;         // ... and reach GPU + CPU together in 10 Hz steps
const LOD_SCALE = 3.0;                // displaced wavelengths keep ≥ ~6 vertices (ocean-mesh.js)
// Per-tier FFT settings (the tiers themselves live in config.js QUALITY). every: the cascades are
// recomputed every n-th frame (Low: 30 Hz; the phase is evaluated at the frame's time, so the
// motion stays smooth for the ≥ 2 m waves the Low mesh displaces).
const FFT_TIERS = { low: { cascades: 2, every: 2 }, high: { cascades: 3, every: 1 } };
// Optical constants (SCENE-SPEC §11.2 / site-environment §7.4).
const FOAM_ALBEDO = 0.72;                          // fresh whitecap foam (site-environment §7.4: 0.5-0.6 aged)
const SSS_TINT = [0.02, 0.30, 0.22];               // forward-scattered light through a crest (linear, teal)
const SSS_STRENGTH = 0.08;
// (Round 4: a dimmer sunlit-water floor, ×0.35-0.5 of π·Rrs, was the ocean's share of the lead's three
// near-field levers. With the other two in (the shell's luminance toe, the atmosphere's weather) the
// integrated reference view went darker than the photo (near median 0.026-0.032 against 0.047) and the
// floor at FU-4 matched its mean colour, so the water body stays as measured.)
const AER_TINT = [0.022, 0.10, 0.092];             // π·R of bubble-laden water (ESTIMATED: a propwash plume reads as light
                                                   // turquoise against ~1 % navy water, ~11x the FU-4 body in green)
const SLICK_SWING = 0.4;                           // ±40 % short-wave amplitude (slicks down to -40 %, p1 photo critique)
const GROUP_SWING = 0.4;                           // wave groups: short-band slope amplitude 0.6-1.4
// Normals of the 2.25-15 m band (cascade 1) are steepened past the Elfouhaily et al. (1997) unified
// spectrum's slope there (0.0074 against the JONSWAP-anchored 0.0055 at 4.5 m/s: × 1.16) to × 1.6 at a
// light breeze: these are the facets the drone camera resolves near the bottom of the frame (the photo's
// contrast lives on them), and the extra variance comes out of the unresolved share (ocean-material.js),
// so the Cox-Munk total is kept: contrast moves from the blur to the facets, and nothing changes where the
// band is sub-pixel. Back to × 1 by 9 m/s, where the band is the far tail of a long sea. Normals only:
// the geometry, the CPU mirror and the whitecap calibration keep the anchored band.
function band1GainFor(u10) { return 1 + 0.6 * (1 - THREE.MathUtils.smoothstep(u10, 5, 9)); }
// Hydrodynamic modulation of the short waves by the long ones (log-normal, mean one, capped at
// ocean-material.js HYDRO_CAP): they ride the crests and forward faces and leave the backs and troughs
// glassy. Radar MTFs |M| of 10-20 at light wind (Keller & Wright 1975, Plant 1990) with ak ≈ 0.07-0.1
// give ±0.7-2 per unit long-wave phase, past the linear range: at ~5 m/s the wavelets gather on the
// crests and the troughs go glassy (the photo's dark troughs between bright facets). The MTF weakens
// roughly as 1/U in stronger wind. Log-std at light wind (ESTIMATED from the photo's near field, round
// 4: on the 2-15 m wavelets' faces, 1.6 / 2.8 / 3.5 give p90/p10 6.7 / 8.7 / 11 at the reference view):
const HYDRO_MOD = 3.5, HYDRO_FALL_U = 5;
function hydroModFor(u10) { return HYDRO_MOD * Math.min(1, HYDRO_FALL_U / Math.max(u10, 1e-3)); }
// Whitecaps: a crest breaks where the Jacobian of cascade c drops below bias[c]. Calibrated by
// bisection in dev/ocean.html (?calibsearch=1) so the equilibrium mean visible whitecap cover
// (stage A + 0.6 × stage B, what the shader turns into coverage) follows Monahan
// W = 3.84e-4·U^3.41 % (SCENE-SPEC §11.1). The long cascade's threshold sits WHITECAP_OFFSET higher.
// None below SEA.whitecapOnsetWind (5.0 m/s).
// Calibration 2026-10-06, round 4 (long-crested tail, stronger along-wind smear of the residual foam,
// and the long cascade's bias 0.12 above the short one's so the dominant waves' breakers, metres
// across, carry more of the cover than the 2-15 m band's flecks) of the VISIBLY WHITE cover (texels
// whose stage A + 0.6 × stage B foam ≥ 0.5, what photographs count; thinner lace comes on top),
// bisection in dev/ocean.html?calibsearch=1 (6.5 m/s, where the search did not settle, interpolated):
// 0.23/–/0.61/1.00/1.54/4.26/11.3 % against Monahan 0.13/0.23/0.46/0.99/1.84/3.93/10.49 % at
// 5.5/6.5/8/10/12/15/20 m/s.
const WHITECAP_GAIN = 40;          // near-binary: a breaking crest is white at once (stage A)
const WHITECAP_OFFSET = 0.12;
const WHITECAP_BIAS = [[5.0, 0.768], [5.5, 0.764], [6.5, 0.751], [8, 0.7373], [10, 0.7165], [12, 0.6883], [15, 0.6512], [20, 0.6215]];
function whitecapFor(u10) {
  if (u10 < SEA.whitecapOnsetWind) return { bias: [-100, -100], gain: WHITECAP_GAIN };
  // piecewise linear in the table, extrapolated past its end along the last segment
  const T = WHITECAP_BIAS;
  let i = 1;
  while (i < T.length - 1 && u10 > T[i][0]) i++;
  const [u0, b0] = T[i - 1], [u1, b1] = T[i], b = b0 + (b1 - b0) * (u10 - u0) / (u1 - u0);
  return { bias: [b + WHITECAP_OFFSET, b], gain: WHITECAP_GAIN };
}
// Visible cover above Monahan's fit at Beaufort 6: his W is the low side of the measured scatter at
// 10-15 m/s (1-6 %, Callaghan et al. 2008, Brumer et al. 2017), while the Beaufort descriptor reads
// "white foam crests are more extensive everywhere" (×2: with the residual foam run up, white water over
// ~4-5 % of the frozen reference view at 12 m/s, round 4). By Beaufort 8 the extra foam lies in the wind
// streaks, drawn separately (back to ×1 by 19 m/s).
function whitecapGainFor(u10) {
  if (u10 < SEA.whitecapOnsetWind - 0.5) return 0;
  return 1 + THREE.MathUtils.smoothstep(u10, 8.5, 12) * (1 - THREE.MathUtils.smoothstep(u10, 14, 19));
}
// Wind-aligned foam streaks: faint lines from Beaufort 5-6 (gain 0-1, 8-12 m/s), "blown in well-marked
// streaks along the direction of the wind" by Beaufort 8 (gain 1-2, 13-19 m/s).
function streakGainFor(u10) { return THREE.MathUtils.smoothstep(u10, 8, 12) + THREE.MathUtils.smoothstep(u10, 13, 19); }
// Spray over a gale-swept sea (Beaufort 8+: spindrift, then spume; "spray may affect visibility" from
// Beaufort 9): near-surface extinction σ0 (1/m) in a layer of SPRAY_H (ocean-material.js) scale height, ESTIMATED from
// spume-droplet concentrations (~1e3-1e4 /m³ of 50-200 µm drops at 20 m/s: 1-3e-4 /m).
function sprayExtinctionFor(u10) { return 2.5e-4 * Math.max(0, (u10 - 14) / 6) ** 2; }

export class Ocean {
  constructor(ctx) {
    this.ctx = ctx;
    this.renderer = ctx.renderer;
    this.scene = ctx.scene;
    this.atmosphere = ctx.atmosphere;
    this.quality = ctx.quality;
    this.tier = FFT_TIERS[this.quality?.name] || FFT_TIERS.high;

    // ---- sea state (target, eased, applied)
    this.target = { windSpeed: SEA.windSpeed, windFromDeg: SEA.windFromDeg, swellHs: SEA.swell.Hs, swellFromDeg: SEA.swell.fromDeg, swellPeriod: SEA.swell.Tp };
    this.eased = { ...this.target };
    this.applied = null;
    this._stepAcc = 0;
    this._selected = null;
    this._lastT = null;
    this._uSeen = { speed: U.uWindSpeed.value, x: U.uWind.value.x, y: U.uWind.value.y };

    // ---- GPU + CPU wave field
    this.fft = new OceanFFT({ renderer: this.renderer });
    this.fft.active = this.tier.cascades;
    this.surfaceMirror = new SurfaceMirror(this.fft.noise);

    // ---- textures, probe, effects, reflection
    this.foamTex = foamTexture();
    this.skyMap = new SkyReflectionMap(this.renderer, this.atmosphere);
    this.skyMap.setQuality(this.quality?.name === 'low');
    this.effects = new OceanEffects(this.renderer);
    this.effects.setFoamTexture(this.foamTex);
    this.waveSources = new WaveSources();
    this.life = new LifePatches();
    this.lights = new DistantLights();
    this.reflection = new PlanarReflection(this.renderer, { scale: this.quality?.reflection ? this.quality.reflectionScale : 0, samples: mirrorSamples(this.quality) });
    this.reflection.onTargetsChanged = () => {
      this.uniforms.uMirror.value = this.reflection.target.texture;
      this.uniforms.uMirrorDist.value = this.reflection.distTexture;
    };

    // ---- material + mesh
    this.snap = new THREE.Vector2(0, 0);
    this._waveDir = new THREE.Vector2(0, -1);
    this.uniforms = this._makeUniforms();
    this._material = createOceanMaterial({ cascades: this.fft.count, atmosphere: this.atmosphere, uniforms: this.uniforms });
    this._buildMesh();

    this._apply(this.eased, true);
    if (globalThis.NJOW_DEV !== false) this._registerScales();
    this._lightScan = 0;
    this._tmp = { eta: 0, sx: 0, sz: 0, vx: 0, vy: 0, vz: 0 };
    this._mrel = new THREE.Matrix4();
    this._fwd = new THREE.Vector3();
  }

  // ------------------------------------------------------------------ public API
  get mesh() { return this._mesh; }
  get reflectionTarget() { return this.reflection.target; }


  // The displaced surface for decals that ride the waves (see the header): the live uniform objects,
  // stable for the ocean's lifetime (their values change in place each frame).
  displacementUniforms() {
    const u = this.uniforms;
    return { uDisp0: u.uDisp0, uDisp1: u.uDisp1, uOcCas: u.uOcCas, uOcOff: u.uOcOff, uSnap: u.uSnap, uRing: u.uRing, uGrid: u.uGrid };
  }

  // Surface additions the CPU mirror must share with the mesh: boil domes, run-up on the weather
  // side of piles, the Kelvin wakes of moving hulls (not their own trough: a hull rides the sea).
  _extraHeight(x, z, t, eta) {
    let h = this.effects.domeHeight(x, z, t) + this.waveSources.height(x, z);
    for (const p of this.effects.nearPiles) {
      const dx = x - p.x, dz = z - p.z, rr = Math.hypot(dx, dz), d = rr - p.radius;
      if (d > 6 || d < -0.5 || rr < 1e-3) continue;
      const face = Math.max(0, -(dx * this._waveDir.x + dz * this._waveDir.y) / rr);
      h += Math.max(eta, 0) * PILE_WASH.runup * face * Math.exp(-Math.max(d, 0) / PILE_WASH.runupM);
    }
    return h;
  }

  getHeight(x, z, t = U.uTime.value) {
    const eta = this.surfaceMirror.height(x, z, t);
    return eta + this._extraHeight(x, z, t, eta) - curvatureDrop(x, z);
  }

  getSurface(x, z, t = U.uTime.value, out = { y: 0, normal: new THREE.Vector3(), velocity: new THREE.Vector3() }) {
    const s = this.surfaceMirror.surface(x, z, t, this._tmp);
    out.y = s.eta + this._extraHeight(x, z, t, s.eta) - curvatureDrop(x, z);
    out.normal = out.normal || new THREE.Vector3();
    out.velocity = out.velocity || new THREE.Vector3();
    out.normal.set(-s.sx + x / EARTH_R, 1, -s.sz + z / EARTH_R).normalize();
    out.velocity.set(s.vx, s.vy, s.vz);
    return out;
  }

  addDisturbance(opts) { return this.effects.add(opts, U.uTime.value); }

  addFoamTrail(points, opts = {}) { this.effects.addTrail(points, opts, U.uTime.value); }

  clearTrail(key = 'default') { this.effects.clearTrail(key); }

  setPiles(list) { this.effects.setPiles(list); }

  // Kelvin wake sources for this frame (see ocean-wake.js), and the elevation (m) their waves add at
  // (x, z) this frame (the hulls' own troughs left out), e.g. to lay foam caps on the crests.
  setWaveSources(list) { this.waveSources.set(list, U.uTime.value); }
  wakeHeight(x, z) { return this.waveSources.height(x, z); }

  // Bait stains, nervous water and blitz slicks (see ocean-life.js); call each frame.
  setLifePatches(list) { this.life.set(list, this.effects, U.uTime.value); }

  // Lamps beyond the planar mirror's reach, as analytic glitter columns (see ocean-lights.js):
  // setDistantLights(key, { count, position, colour, intensity[, beam][, extent] }) or
  // setDistantLights(list[, key]); one set per key, replaced on each call.
  setDistantLights(a, b) { this.lights.set(a, b); }
  get distantLightCapacity() { return DISTANT_CAPACITY; }
  get distantLightMinDistance() { return DISTANT_MIN_DISTANCE; }

  // Partial updates are fine. The change eases in over ~1-3 s unless { immediate: true }.
  // Also mirrors wind into U.uWindSpeed / U.uWind so every consumer sees the same wind.
  setSeaState(state = {}, { immediate = false } = {}) {
    for (const k of Object.keys(this.target)) if (Number.isFinite(state[k])) this.target[k] = state[k];
    this.target.windSpeed = Math.max(0, this.target.windSpeed);
    this.target.swellHs = Math.max(0, this.target.swellHs);
    this.target.swellPeriod = Math.max(1, this.target.swellPeriod);
    const toward = (this.target.windFromDeg + 180) * DEG;
    U.uWindSpeed.value = this.target.windSpeed;
    U.uWind.value.set(Math.sin(toward) * this.target.windSpeed, -Math.cos(toward) * this.target.windSpeed);
    this._uSeen = { speed: U.uWindSpeed.value, x: U.uWind.value.x, y: U.uWind.value.y };
    if (immediate) { this.eased = { ...this.target }; this._apply(this.eased, true); }
  }

  // ------------------------------------------------------------------ frame
  update(dt, t, camera) {
    // external writes to U.uWind / U.uWindSpeed (e.g. the UI) are adopted as a sea-state change
    const w = U.uWind.value;
    if (U.uWindSpeed.value !== this._uSeen.speed || w.x !== this._uSeen.x || w.y !== this._uSeen.y) {
      const from = (Math.atan2(w.x, -w.y) / DEG + 180 + 360) % 360;
      this.setSeaState({ windSpeed: U.uWindSpeed.value, windFromDeg: w.lengthSq() > 1e-6 ? from : this.target.windFromDeg });
    }
    this._ease(dt);
    const simDt = this._lastT === null ? 0 : THREE.MathUtils.clamp(t - this._lastT, 0, 0.1);
    this._lastT = t;

    camera.updateMatrixWorld();
    const cp = camera.position;
    // snap origin for precise texture coordinates
    if (Math.abs(cp.x - this.snap.x) > SNAP_M || Math.abs(cp.z - this.snap.y) > SNAP_M) {
      this.snap.set(Math.round(cp.x / SNAP_M) * SNAP_M, Math.round(cp.z / SNAP_M) * SNAP_M);
      this._updateSnapOffsets();
    }
    const u = this.uniforms;
    u.uCamQ.value.set(cp.x - this.snap.x, cp.z - this.snap.y);
    // grid: rings sized for the camera height above the local sea, columns toward the heading
    const seaY = -curvatureDrop(cp.x, cp.z);
    const h = Math.max(cp.y - seaY, 1);
    if (!this._ring || Math.abs(Math.log(h / this._ringH)) > 0.03) {
      this._ringH = h;
      this._ring = ringParams(h, this._rings);
      u.uRing.value.set(this._ring.s0, Math.log(1 + this._ring.a), this._ring.a, this._rings);
    }
    const f = camera.getWorldDirection(this._fwd);
    const horiz = Math.hypot(f.x, f.z);
    const pitchFactor = THREE.MathUtils.smoothstep(horiz, Math.cos(80 * DEG), Math.cos(45 * DEG));
    u.uGrid.value.set(horiz > 1e-4 ? Math.atan2(f.z, f.x) : 0, HEADING_WARP * pitchFactor, this._segments, LOD_SCALE);

    // wave field. Whitecap foam is a state (stage B, streaks) built up over ~10 s: a frozen frame (or the
    // first one) at a new wind would show only the crests breaking at that instant, so it is run up
    // through the 10 s before t first (240 cascade updates, only with whitecaps on)
    if (simDt === 0 && u.uWhitecapsOn.value > 0 && this._warmU !== this.applied.windSpeed) {
      this._warmU = this.applied.windSpeed;
      for (let i = 240; i > 0; i--) this.fft.update(t - i / 24, 1 / 24);
    }
    this._fftDt = (this._fftDt || 0) + simDt;
    this._fftFrame = (this._fftFrame || 0) + 1;
    if (this._fftFrame % (this.tier.every || 1) === 0 || this._fftDt === 0 || simDt === 0) {
      this.fft.update(t, Math.min(this._fftDt, 0.2));
      this._fftDt = 0;
    }
    const tx = this.fft.textures;
    u.uSlopeA.value = tx.slope; u.uFoamA.value = tx.foam;
    u.uSlickP.value.set(1 / SLICK_TILE_M, SLICK_SWING, 0.03 * U.uWind.value.x * -t, 0.03 * U.uWind.value.y * -t);
    // groups travel at the deep-water group speed of the wind-sea peak, g Tp / 4π
    u.uGroup.value.x = GROUP_SWING; u.uGroup.value.y = 9.81 * (this.R?.windTp ?? 3.8) / (4 * Math.PI) * t;

    // sky panorama, local effects, planar reflection. After a clock jump the panorama is redrawn at
    // once (its own "time jump" test watches animation time, not the clock)
    const clockVersion = this.ctx.clock?.version;
    if (clockVersion !== undefined && clockVersion !== this._clockVersion) {
      if (this._clockVersion !== undefined) this.skyMap._pos = null;
      this._clockVersion = clockVersion;
    }
    // A fast time-lapse (600x and up) through dawn or dusk changes the sky every frame, and the panorama follows it every
    // frame: refreshed every second, the sea's reflection of the sky lagged by a frame in turn, a 30 Hz sawtooth on the
    // sea (flash-verify, 2026-10-07; same test as the atmosphere's table read-back). A capture keeps the old cadence.
    const clock = this.ctx.clock, sunEl = this.atmosphere?.sunElevationDeg;
    if (clock?.playing && clock.speed >= 600 && sunEl > -14 && sunEl < 12 && !this.ctx.world?.params?.capture) this.skyMap._pos = null;
    this.skyMap.update(camera, t);
    this._pileSurge(dt, t, camera);
    this.effects.update(t, camera, this.snap, this.eased.windSpeed);
    this.waveSources.update(t, this.snap, camera);
    this.life.update(this.snap, this.effects._nervous, t);
    this.lights.update(t, camera, this.renderer, this._sigCross);
    if (this.reflection.enabled) {
      if (this._lightScan-- <= 0) { this._enableLightsForReflection(); this._lightScan = 120; }
      // mirror decode scale: MIRROR_L0_EXPOSED exposed units in pre-exposed radiance (last frame's
      // exposure; the log code is insensitive to small lags)
      const pre = this.atmosphere?.uniforms?.uAtmPre?.value ?? 1;
      const exposure = this.ctx.post?.exposure || 3.21;
      const l0 = MIRROR_L0_EXPOSED * pre / Math.max(exposure, 1e-9);
      this.reflection.render(this.scene, camera, seaY, l0);
      u.uMirrorL0.value = l0;
      this._mrel.makeTranslation(cp.x, cp.y, cp.z).premultiply(this.reflection.textureMatrix);
      u.uMirrorMatrix.value.copy(this._mrel);
      u.uMirrorPlaneRel.value = seaY - cp.y;
      u.uMirrorBasis.value.copy(this.reflection.basis);
      u.uMirrorProj.value.copy(this.reflection.proj);
      u.uMirrorSize.value.set(this.reflection.target.width, this.reflection.target.height);
      u.uMirrorOn.value = 1;
    } else {
      u.uMirrorOn.value = 0;
    }
  }

  setQuality(q) {
    this.quality = q;
    this.skyMap.setQuality(q?.name === 'low');
    this.reflection.setScale(q?.reflection ? q.reflectionScale : 0);
    this.reflection.setSamples(mirrorSamples(q));
    // every cascade stays allocated and the material keeps its program: a tier switch only changes
    // how many cascades are computed (Low: the short one is off, its variance goes to the BRDF)
    const tier = FFT_TIERS[q?.name] || FFT_TIERS.high;
    if (tier.cascades !== this.fft.active) {
      this.tier = tier;
      this.fft.active = tier.cascades;
      this._apply(this.eased, true);
    }
    this.tier = tier;
    if (q?.oceanRings !== this._rings || q?.oceanSegments !== this._segments) {
      this._mesh.geometry.dispose();
      this._rings = q.oceanRings; this._segments = q.oceanSegments;
      this._mesh.geometry = buildPolarGrid(this._rings, this._segments);
      this._ring = null;
    }
  }

  dispose() {
    this.scene.remove(this._mesh);
    this._mesh.geometry.dispose();
    this._material.dispose();
    this.fft.dispose();
    this.reflection.dispose();
    this.effects.dispose();
    this.skyMap.dispose();
    this.foamTex.dispose();
    this.lights.dispose();
  }


  // ------------------------------------------------------------------ internals
  _makeUniforms() {
    const n = this.fft.count;
    const cas = [], off = [];
    for (let c = 0; c < n; c++) {
      const f = cascadeFrame(CASCADES[c]);
      cas.push(new THREE.Vector4(f.cos, f.sin, 1 / CASCADES[c].L, CASCADES[c].L / FFT_SIZE));
      off.push(new THREE.Vector2());
    }
    const u = {
      uTime: U.uTime,
      uOcCas: { value: cas }, uOcOff: { value: off },
      uRing: { value: new THREE.Vector4(1, 0.05, 0.05, 160) },
      uGrid: { value: new THREE.Vector4(0, HEADING_WARP, 256, LOD_SCALE) },
      uCamQ: { value: new THREE.Vector2() }, uSnap: { value: this.snap },
      uDisp0: { value: this.fft.disp[0].texture }, uDisp1: { value: this.fft.disp[1].texture },
      uSlopeA: { value: this.fft.textures.slope }, uFoamA: { value: this.fft.textures.foam },
      uFoamTex: { value: this.foamTex },
      uEsky: { value: new THREE.Vector3(0.9, 1.1, 1.4) }, uSkyMap: { value: this.skyMap.texture },
      uSubgrid: { value: new THREE.Vector2(0.01, 0.01) },
      uShortOn: { value: 0 },
      uWaveDir: { value: new THREE.Vector2(0, -1) },
      uWindSpeed: U.uWindSpeed,
      uWhitecapsOn: { value: 0 },                  // 0 off, else the visible-cover gain
      uSpray: { value: 0 },                        // near-surface spray extinction (1/m), SPRAY_H layer
      uAerTint: { value: new THREE.Vector3(...AER_TINT) },
      uSlickP: { value: new THREE.Vector4(1 / SLICK_TILE_M, SLICK_SWING, 0, 0) },
      uGroup: { value: new THREE.Vector3(GROUP_SWING, 0, 1) },
      uWindDir: { value: new THREE.Vector2(1, 0) },
      uEtaStd: { value: 0.17 }, uStreakGain: { value: 0 },
      uHydro: { value: new THREE.Vector4() },      // log-std, 1 / 2-15 m slope std along the wind, 1 / peak wavelength, 0.3 / elevation std
      uUpwelling: { value: new THREE.Vector3(...SEA.upwellingReflectance) },
      uSSSColor: { value: new THREE.Vector3(...SSS_TINT.map((v) => v * SSS_STRENGTH)) },
      uFoamAlbedo: { value: FOAM_ALBEDO },
      uPolarizer: U.uPolarizer,
      uMirror: { value: this.reflection.target.texture }, uMirrorOn: { value: 0 },
      uMirrorMatrix: { value: new THREE.Matrix4() }, uMirrorPlaneRel: { value: 0 },
      uMirrorBasis: { value: new THREE.Matrix3() }, uMirrorProj: { value: new THREE.Vector2(1, 1) },
      uMirrorSize: { value: new THREE.Vector2(1, 1) },
      uMirrorDist: { value: this.reflection.distTexture },
      uMirrorL0: { value: 1 },
      ...this.effects.uniforms,
      ...this.waveSources.uniforms,
      ...this.life.uniforms,
      ...this.lights.uniforms,
    };
    this._updateSnapOffsets(u);
    return u;
  }

  _updateSnapOffsets(u = this.uniforms) {
    for (let c = 0; c < this.fft.count; c++) {
      const f = cascadeFrame(CASCADES[c]), L = CASCADES[c].L;
      // texel m of an FFT tile holds the field at x' = m·L/N, i.e. at uv = (m + ½)/N: shift by half a texel
      const lx = (f.cos * this.snap.x + f.sin * this.snap.y) / L + 0.5 / FFT_SIZE;
      const lz = (-f.sin * this.snap.x + f.cos * this.snap.y) / L + 0.5 / FFT_SIZE;
      u.uOcOff.value[c].set(lx - Math.floor(lx), lz - Math.floor(lz));
    }
  }

  _buildMesh() {
    this._rings = this.quality?.oceanRings ?? 160;
    this._segments = this.quality?.oceanSegments ?? 256;
    this._mesh = new THREE.Mesh(buildPolarGrid(this._rings, this._segments), this._material);
    this._mesh.name = 'ocean';
    this._mesh.frustumCulled = false;                    // (casts and receives no shadow: the defaults)
    this.scene.add(this._mesh);
  }

  // Ease the sea state toward the target; push it to GPU + CPU at 10 Hz so both always agree.
  _ease(dt) {
    const k = 1 - Math.exp(-Math.max(dt, 0) / SEA_STATE_TAU_S);
    const e = this.eased, tg = this.target;
    let moving = false;
    for (const key of ['windSpeed', 'swellHs', 'swellPeriod']) {
      e[key] += (tg[key] - e[key]) * k;
      if (Math.abs(tg[key] - e[key]) < 1e-3) e[key] = tg[key]; else moving = true;
    }
    for (const key of ['windFromDeg', 'swellFromDeg']) {
      const d = ((tg[key] - e[key] + 540) % 360) - 180;
      e[key] = (e[key] + d * k + 360) % 360;
      if (Math.abs(d * (1 - k)) < 0.05) e[key] = tg[key]; else moving = true;
    }
    this._stepAcc += dt;
    const differs = !this.applied || ['windSpeed', 'swellHs', 'swellPeriod', 'windFromDeg', 'swellFromDeg'].some((key) => this.applied[key] !== e[key]);
    if (differs && (this._stepAcc >= SEA_STATE_STEP_S || !moving)) { this._stepAcc = 0; this._apply(e, false); }
  }

  _apply(state, force) {
    const R = resolveSeaState(state);
    this.applied = { ...state };
    this.R = R;
    this.fft.setSeaState(R, whitecapFor(state.windSpeed));
    this.surfaceMirror.chop = this.fft.chop;
    // re-select the CPU mode set on big changes; otherwise only refresh amplitudes
    const sel = this._selected;
    const reselect = force || !sel || Math.abs(sel.windSpeed - state.windSpeed) > 0.6 || Math.abs(sel.swellHs - state.swellHs) > 0.1
      || Math.abs(sel.swellPeriod - state.swellPeriod) > 0.6 || angleDiff(sel.windFromDeg, state.windFromDeg) > 12 || angleDiff(sel.swellFromDeg, state.swellFromDeg) > 12;
    if (reselect) this._selected = { ...state };
    this.surfaceMirror.setSeaState(R, reselect);
    // unresolved slope variance -> BRDF (Cox & Munk minus what the FFT resolves)
    const kMax = Math.PI * FFT_SIZE / CASCADES[CASCADES.length - 1].L;          // Nyquist of the finest cascade
    const [rx, rz] = resolvedSlopeMoments(R, 2 * Math.PI / CASCADES[0].L, this.fft.active > 2 ? kMax : CASCADES[1].kHigh);
    const cm = coxMunk(state.windSpeed);
    const wx = R.dirW[0], wz = R.dirW[1];
    const cmx = cm.up * wx * wx + cm.cross * wz * wz, cmz = cm.up * wz * wz + cm.cross * wx * wx;
    const u = this.uniforms;
    // (the 2-15 m band's resolved slopes take band1GainFor; the shader takes the variance they gain out of
    // the unresolved share)
    const [b1x, b1z] = resolvedSlopeMoments(R, CASCADES[1].kLow, CASCADES[1].kHigh);
    u.uGroup.value.z = band1GainFor(state.windSpeed);
    u.uSubgrid.value.set(Math.max(cmx - rx, 0.0015), Math.max(cmz - rz, 0.0015));
    this._sigCross = Math.sqrt(cm.cross);                                    // glitter column width (distant lights)

    u.uWindDir.value.set(wx, wz);
    u.uEtaStd.value = Math.hypot(R.windHs, state.swellHs) / 4;
    // (1 / the 2-15 m band's slope std along the wind; 0.3 / elevation std, the Kelvin waves' phase weight)
    u.uHydro.value.set(hydroModFor(state.windSpeed), 1 / Math.max(Math.sqrt(b1x * wx * wx + b1z * wz * wz), 1e-3), 2 * Math.PI / (9.81 * R.windTp * R.windTp), 0.3 / Math.max(u.uEtaStd.value, 0.05));
    u.uStreakGain.value = streakGainFor(state.windSpeed);
    u.uWhitecapsOn.value = whitecapGainFor(state.windSpeed);
    u.uSpray.value = sprayExtinctionFor(state.windSpeed);
    // mean direction the waves travel (energy-weighted wind sea + swell) for run-up and wash
    const ew = R.windHs * R.windHs, es = state.swellHs * state.swellHs;
    this._waveDir.set(wx * ew + R.dirS[0] * es, wz * ew + R.dirS[1] * es);
    if (this._waveDir.lengthSq() < 1e-12) this._waveDir.set(wx, wz);
    this._waveDir.normalize();
    u.uWaveDir.value.copy(this._waveDir);
    u.uShortOn.value = this.fft.active > 2 ? 1 : 0;
  }

  // Crest arrival on the weather side of the piles near the camera: an envelope that jumps with
  // each crest and decays over 1.5 s drives the wash pulse (uPiles.w); CPU mirror, ≤ 2 piles.
  _pileSurge(dt, t, camera) {
    const piles = this.effects.nearPiles, sd = Math.max(this.uniforms.uEtaStd.value, 0.02);
    const k = Math.exp(-Math.max(dt, 0) / 1.5);
    let n = 0;
    for (const p of piles) {
      const far = (p.x - camera.position.x) ** 2 + (p.z - camera.position.z) ** 2 > 150 * 150;
      if (far || n >= 2) { p.surge = 0; continue; }
      n++;
      const x = p.x - this._waveDir.x * (p.radius + 0.5), z = p.z - this._waveDir.y * (p.radius + 0.5);
      const eta = this.surfaceMirror.height(x, z, t);
      const now = THREE.MathUtils.smoothstep(eta / sd, 0.4, 1.2);
      p.surge = Math.max(now, (p.surge ?? 0) * k);
    }
  }

  _enableLightsForReflection() {
    // The mirror camera sees only LAYER_REFLECT; lights must be on it to light the reflection.
    this.scene.traverse((o) => { if (o.isLight) o.layers.enable(LAYER_REFLECT); });
  }
}

function angleDiff(a, b) { return Math.abs(((a - b + 540) % 360) - 180); }
// MSAA samples of the mirror render: the waves blur the reflection over many texels anyway, and with
// a logarithmic depth buffer every sample shades depth (4x on High cost ~1.5 ms): Ultra only, 2x.
function mirrorSamples(q) { return q?.name === 'ultra' ? 2 : 0; }

// The scale report is a dev hook: builds that define globalThis.NJOW_DEV = false leave it out.
if (globalThis.NJOW_DEV !== false) {
  Ocean.prototype._registerScales = function () {
    const src = 'ocean.js: measured from the built discrete spectrum / CPU surface mirror / mesh';
    const R0 = resolveSeaState({ windSpeed: SEA.windSpeed, windFromDeg: SEA.windFromDeg, swellHs: SEA.swell.Hs, swellFromDeg: SEA.swell.fromDeg, swellPeriod: SEA.swell.Tp });
    const onlyWind = { ...R0, scaleS: 0 }, onlySwell = { ...R0, scaleW: 0 };
    const reg = (name, measure, metres, tolerance, source = src) =>
      registerScale({ name, measure: () => { const v = measure(); return { x: v, y: v, z: v }; }, expect: { axis: 'x', metres, tolerance }, source });
    reg('ocean.windSea.Hs', () => 4 * Math.sqrt(discreteVariance(onlyWind)), SEA.windSea.Hs, 0.03);
    reg('ocean.windSea.peakWavelength', () => discretePeakWavelength(onlyWind), SEA.windSea.wavelength, 2.0);
    reg('ocean.swell.Hs', () => 4 * Math.sqrt(discreteVariance(onlySwell)), SEA.swell.Hs, 0.03);
    reg('ocean.swell.wavelength', () => discretePeakWavelength(onlySwell), SEA.swell.wavelength, 3.0);
    reg('ocean.surface.Hs (CPU mirror, 4σ of η at 4000 points)', () => {
      let s = 0, s2 = 0; const n = 4000;
      for (let i = 0; i < n; i++) { const e = this.surfaceMirror.height((i * 7.31) % 900 - 450, (i * 13.7) % 900 - 450, 17 + i * 0.37); s += e; s2 += e * e; }
      return 4 * Math.sqrt(s2 / n - (s / n) ** 2);
    }, Math.hypot(SEA.windSea.Hs, SEA.swell.Hs), 0.08);
    reg('ocean.mesh.outerRadius@drone(127.5 m)', () => ringParams(127.5, this._rings).rMax, 47850, 2900,
      'ocean-mesh.js ringParams; SCENE-SPEC §3.3 requires ≥ 45 km at 127.5 m');
    reg('ocean.mesh.outerRadius@overview(900 m)', () => ringParams(900, this._rings).rMax, 124000, 14000,
      'ocean-mesh.js ringParams; SCENE-SPEC §3.3 requires ≥ 110 km at 900 m');
    reg('ocean.pileWash.visibleWidth', () => {
      // distance from the pile wall at which the wash density on the weather side, as a crest
      // arrives (the shader's rim + lace at surge 1, incidence 1, gaps open, mean noise 0.5, the
      // default sea: hsF 1, calm-sea factor 0.93 at 4.5 m/s), falls to 0.2, where the lace covers a fifth
      const W = PILE_WASH, dens = (d) => W.contact * Math.exp(-d / W.contactM) * 0.85 + W.lace * Math.exp(-d / W.laceM) * 0.7 * 0.93;
      let d = 0; while (dens(d) > 0.2 && d < 5) d += 0.01;
      return d;
    }, 1.0, 0.5, 'ocean-effects.js PILE_WASH profile, SCENE-SPEC §11.1 0.5-1.5 m');
    const cg = (lambda) => { const k = 2 * Math.PI / lambda, w = Math.sqrt(RIPPLE_G * k + RIPPLE_T * k ** 3); return (RIPPLE_G + 3 * RIPPLE_T * k * k) / (2 * w); };
    reg('ocean.ripple.groupVelocity(λ=0.1 m)', () => cg(0.1), 0.21, 0.02, 'capillary-gravity dispersion used by ring ripples');
    reg('ocean.ripple.groupVelocity(λ=1 m)', () => cg(1.0), 0.625, 0.03, 'capillary-gravity dispersion used by ring ripples');
  };

  // Variance of the discrete modes the GPU renders (all cascades) for a resolved state.
  function discreteVariance(R) {
    let v = 0;
    for (let c = 0; c < CASCADES.length; c++) {
      const cas = CASCADES[c], dk = 2 * Math.PI / cas.L;
      for (let iz = 0; iz < FFT_SIZE; iz++) for (let ix = 0; ix < FFT_SIZE; ix++) {
        const nx = wrapIndex(ix), nz = wrapIndex(iz);
        const [kx, kz] = modeK(cas, nx, nz); const k = Math.hypot(kx, kz);
        if (inBand(cas, k, nx, nz)) v += spectrumK(kx, kz, R) * dk * dk;
      }
    }
    return v;
  }
  // Wavelength of the peak of the discrete energy spectrum over |k| (cascade 0 holds both peaks).
  function discretePeakWavelength(R) {
    const cas = CASCADES[0], dk = 2 * Math.PI / cas.L, bins = new Float64Array(400);
    for (let iz = 0; iz < FFT_SIZE; iz++) for (let ix = 0; ix < FFT_SIZE; ix++) {
      const nx = wrapIndex(ix), nz = wrapIndex(iz);
      const [kx, kz] = modeK(cas, nx, nz); const k = Math.hypot(kx, kz);
      if (!inBand(cas, k, nx, nz)) continue;
      const b = Math.round(k / dk);                 // bins one Δk wide
      if (b < bins.length) bins[b] += spectrumK(kx, kz, R) * dk * dk / Math.max(b, 1);   // per unit k (ring area ∝ k)
    }
    let best = 1;
    for (let b = 1; b < bins.length; b++) if (bins[b] > bins[best]) best = b;
    // parabolic refinement
    const y0 = bins[best - 1] || 0, y1 = bins[best], y2 = bins[best + 1] || 0;
    const off = (y0 - y2) / (2 * (y0 - 2 * y1 + y2) || 1);
    return 2 * Math.PI / ((best + THREE.MathUtils.clamp(off, -0.5, 0.5)) * dk);
  }
}
