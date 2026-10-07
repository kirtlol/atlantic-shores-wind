// Boot, frame loop, camera rig and host hooks for the NJ offshore wind scene (owner: shell).
//
// One main.js serves two pages:
// - the standalone page (index.html): a full-window `.stage` with the control panel, caption and
//   loading overlay;
// - a host page such as kirt.lol, whose `.stage` holds only the canvas, a scene tag and a slim
//   `.hud` (hint + three buttons). Detected by `.stage .hud`, or fixed by a host bundle built with
//   globalThis.NJOW_DEV = false (see HOSTED); the host's loader owns loading and failure, so nothing
//   here draws over its page.
// Sizes come from the stage (the canvas's parent), never from the window.
//
// Host contract (kirt.lol piece loader; also used by the local harnesses): window.__app = { world,
// render(), advance(dt), stop(), stats() } exists synchronously once this module has evaluated,
// with world = { renderer, quality: { name }, params: { q, size, … }, frame, t, px (drawing-buffer width),
// moduleStatus(), api }. ?size=N or ?size=WxH fixes the drawing buffer (stills, the 1920×1080 capture).
// window.__ready becomes true once the scene has drawn (also after a failed boot, together with
// window.__bootError). With no ?q= the default tier is the host's window.__SW_HINT.tier
// ('low' | 'med' | 'high'), else one picked from the device; ?q=/?quality= forces a tier.
// window.__sceneReady / window.__scene (the runtime API) / window.__sceneStats stay for the
// project's own tools (tools/shot.mjs; a host bundle does not set __sceneStats).
//
// Every scene module is loaded through a literal import() thunk (so a bundler includes it) and
// constructed inside try/catch: a module that fails to load, construct or update is logged with
// console.error, reported as 'dead' by world.moduleStatus(), and skipped; it never blanks the page.
// Dev stubs: a page may set window.__NJOW_STUBS = { key: () => import(...) } before this module
// loads (dev/shell.html does, for ?stubs=; a host bundle ignores it); this file never references dev/.
//
// The static imports below create no materials and compile nothing, so src/env/fog.js (loaded
// first, before any other scene module, the renderer's first compile or any material) still
// patches THREE.ShaderChunk before the first program is built.
import * as THREE from 'three';
import { U, PARAMS, param, azimuthToDir, curvatureDrop } from './shared.js';
import {
  RENDER, QUALITY, PIXEL_BUDGET, CAMERA_PRESETS, DEFAULT_VIEW, TIME_DEFAULT, SEA, CLOUDS, TURBINE, MARKINGS, NIGHT_LIGHTS,
} from './config.js';
import { Post } from './post/post.js';
import { UI } from './ui/ui.js';
import { HudUI } from './ui/hud.js';
import { Orbit } from './ui/orbit.js';

const DEG = Math.PI / 180;

// ------------------------------------------------------------------------------------------------
// Scene modules, in load order. fog must be first: it patches ShaderChunk at import time.
const LOADERS = {
  fog: () => import('./env/fog.js'),
  time: () => import('./env/time.js'),
  atmosphere: () => import('./env/atmosphere.js'),
  land: () => import('./env/land.js'),
  ocean: () => import('./ocean/ocean.js'),
  turbine: () => import('./turbine/turbine.js'),
  farm: () => import('./farm/farm.js'),
  vessels: () => import('./life/vessels.js'),
  birds: () => import('./life/birds.js'),
  blitz: () => import('./life/blitz.js'),
};
const MODULE_KEYS = Object.keys(LOADERS);
// Construction after SimClock (ARCHITECTURE: SimClock → Atmosphere → Land → Ocean → Farm →
// Vessels → Birds → Blitz → Post → UI). [ctx key = module key, class export]
const BUILD = [
  ['atmosphere', 'Atmosphere'], ['land', 'Land'], ['ocean', 'Ocean'], ['farm', 'Farm'],
  ['vessels', 'Vessels'], ['birds', 'Birds'], ['blitz', 'Blitz'],
];
// What the loading overlay says while each is built (standalone page only).
const BUILD_LABELS = {
  clock: 'the clock', atmosphere: 'sky and light', land: 'the coast', ocean: 'the ocean', farm: 'the wind farm',
  vessels: 'vessels', birds: 'birds', blitz: 'fish blitzes', post: 'post-processing', ui: 'controls',
};
// Per-frame update order after the clock (ARCHITECTURE "Frame order"; land has no slot there and
// runs right after the atmosphere it depends on).
const UPDATE_ORDER = ['atmosphere', 'land', 'farm', 'vessels', 'birds', 'blitz', 'ocean'];
// UI toggles that show or hide a whole module (toggle name = ctx key).
const MODULE_TOGGLES = new Set(['blitz', 'birds', 'vessels']);
const VIEW_ORDER = ['drone', 'deck', 'nacelle', 'blitz', 'overview', 'cinematic'];
// Module health as the host sees it (world.moduleStatus). ctx keys map onto module keys.
const STATUS_KEYS = ['fog', 'time', 'atmosphere', 'land', 'ocean', 'turbine', 'farm', 'vessels', 'birds', 'blitz', 'post'];
const STATUS_ALIAS = { clock: 'time' };

// ------------------------------------------------------------------------------------------------
// Quality tiers and pixel budgets come from config.js (QUALITY low / med / high / ultra, PIXEL_BUDGET):
// the host's hint names low, med or high. The render pixel ratio starts at the device's, capped at
// RENDER.maxPixelRatio and the tier's pixelRatio, and is lowered until the drawing buffer fits the
// tier's pixel budget; the adaptive controller below may move it between ADAPT.min × that and the cap.
// PIXEL_BUDGET.ultra is 1.8 Mpx since round 4 (pixel ratio 1.118 at 1600×900 on DPR 2, MSAA 4×: 40 fps on a retina
// M4, fix3-shell §3) and QUALITY.low.pixelRatio 1.5 (the phone's wide stage renders at its budget, not at DPR 1).
const TIERS = QUALITY;
// Adaptive resolution (only with no explicit ?q=, not frozen or captured): scale the pixel ratio in
// 0.05 steps between ADAPT.min and the device cap when the smoothed real frame time stays above
// slowMs for slowS seconds (down) or below fastMs for fastS seconds (up).
const ADAPT = { min: 0.6, step: 0.05, slowMs: 17.5, slowS: 1.0, fastMs: 13.0, fastS: 3.0, emaK: 0.1 };

// Defaults of the hosted piece (kirt.lol plan: drone view, 21 June, 20:00, clock playing at 60×:
// sunset at 20:26 arrives about 26 s after the reveal). The standalone page keeps TIME_DEFAULT with
// the clock paused.
const HOSTED_DEFAULTS = { hours: 20.0, playing: true, speed: 60 };
const SPEEDS = [1, 60, 600, 3600];

// Camera accessory: a circular polarizer at the glare-cutting angle (the reference photo was shot
// through one: navy near sea with black troughs, photo critic p1). It is a drone/aerial camera
// filter: full strength above CPL.toH metres, none below CPL.fromH (deck and blitz views keep the
// glitter and the ripple rings a naked eye sees). Strength 0.7 (a CPL a little off its extinction
// angle): at 1.0 the near sea of the reference view went darker than the photo's (display-linear
// median 0.034 against 0.047; 0.7 gives 0.048, shots p1fix-shell-cpl-*).
// Written to the shared U.uPolarizer (read by the atmosphere's clear sky and the ocean's reflection).
const CPL = { strength: 0.7, fromH: 20, toH: 80 };

// ------------------------------------------------------------------------------------------------
// Camera constants.
// Orbit pivot distance along each preset's view ray, in metres: the pivot lands on what the
// preset frames. drone: the hero at 774 m (SCENE-SPEC §7). deck: the TP/platform above the CTV
// bow (22 m along a +30° ray from 4 m ends at y 15 on the TP). nacelle: 400 m out over the farm.
// blitz: the sea surface (25 m / sin 12° = 120.2 m). overview: the hero at 4.10 km.
const PIVOT_DISTANCE = { drone: 774, deck: 22, nacelle: 400, blitz: 120.2, overview: 4102 };
// With a blitz to look at, the Blitz view keeps the preset's heading and pitch but stands this far
// from the blitz centre along its view ray (7.3 m up at the preset's −12°). At the preset's own
// 120 m a 1 m bass crown is ~9 px tall at 1600×900; at 35 m it is ~31 px, the white water, ring
// trains and leaping bait read, and the frame (51 m wide at the blitz) still holds a 40 m patch.
const BLITZ_STANDOFF = 35;
// A blitz asked for with B / triggerBlitz(): pre-rolled this many seconds so it is already churning.
const BLITZ_PREROLL_S = 8;
// Where B puts a blitz (engineering/life critics p1): on the sea in the lower part of the frame,
// BLITZ_NEAR..BLITZ_FAR metres out, at least BLITZ_CLEAR from any turbine axis.
const BLITZ_NEAR = 25, BLITZ_FAR = 3000, BLITZ_CLEAR = 12;
const SEA_CLEARANCE = 1.0;    // ARCHITECTURE: the camera never goes below local wave height + 1 m
const STEEL_CLEARANCE = 1.0;  // kept between the camera and turbine/substation steel (near plane 0.5 m)
const VESSEL_CLEARANCE = 0.5; // kept from vessel superstructures (the CTV deck eye is 0.7 m from its deckhouse)
const FOLLOW_TAU_S = 1.5;     // how quickly the Blitz view drifts after a moving blitz
// Field of view: presets are composed for 3:2 (the photo). A wider frame (the 16:9 kirt.lol stage and its
// 1920×1080 capture) keeps the vertical fov (SCENE-SPEC §7), so it holds the photo's whole horizontal field
// and more; a narrower one (a square, a portrait window) widens the vertical fov so the 3:2 horizontal
// field is kept, up to FOV_MAX_DEG.
const FOV_REF_ASPECT = 1.5;
const FOV_MAX_DEG = 75;
// Sun/moon shadow frustum focus (the atmosphere fits ±SHADOW.halfExtent around it). It sits on the
// turbine nearest the orbit pivot, at the turbine bounding-sphere centre height (SCENE-SPEC §12.4;
// the atmosphere's own default for the hero), so shadows are sharp on whatever is being looked at
// and the frustum only ever jumps between structures (no shimmer while orbiting). Over open sea
// farther than SHADOW_FOCUS_REACH from any turbine it follows the pivot on a 50 m grid.
const SHADOW_FOCUS_Y = 130;
const SHADOW_FOCUS_REACH = 1500;
const SHADOW_FOCUS_GRID = 50;
// Close-ups: a camera within SHADOW_CLOSE_RANGE of a turbine axis (CTV deck, nacelle roof, flying
// round the platform) gets a ±SHADOW_CLOSE_EXTENT box on that turbine at the camera's height
// (snapped to SHADOW_CLOSE_STEP so the box moves in steps, not with every frame), for 2.2 cm
// texels instead of the hero box's 9.3 cm.
const SHADOW_CLOSE_RANGE = 60;
const SHADOW_CLOSE_EXTENT = 45;
const SHADOW_CLOSE_STEP = 10;

// Cinematic orbit (CAMERA_PRESETS.cinematic): starts exactly on the drone preset, then orbits the
// hero at degPerSec while radius, altitude and fov oscillate over loopSeconds.
const CINE = (() => {
  const C = CAMERA_PRESETS.cinematic, D = CAMERA_PRESETS.drone;
  const [x0, y0, z0] = D.position;
  const r0 = Math.hypot(x0, z0);
  const az0 = Math.atan2(x0, -z0) / DEG;                       // compass azimuth of the camera from the hero
  const mid = (a) => (a[0] + a[1]) / 2, amp = (a) => (a[1] - a[0]) / 2;
  const phase = (v, a) => Math.acos(THREE.MathUtils.clamp((v - mid(a)) / amp(a), -1, 1));
  return {
    C, az0,
    headingOffset: D.headingDeg - (az0 - 180),                 // drone heading vs straight at the hero axis
    lookY: y0 + r0 * Math.tan(D.pitchDeg * DEG),                // height the view ray crosses the hero axis
    omega: 2 * Math.PI / C.loopSeconds,
    r: { mid: mid(C.orbitRadius), amp: amp(C.orbitRadius), ph: phase(r0, C.orbitRadius) },
    y: { mid: mid(C.altitude), amp: amp(C.altitude), ph: phase(y0, C.altitude) },
    fov: { mid: mid(C.vfovDeg), amp: amp(C.vfovDeg), ph: phase(D.vfovDeg, C.vfovDeg) },
  };
})();

// ------------------------------------------------------------------------------------------------
const byId = (id) => document.getElementById(id);
const clamp = THREE.MathUtils.clamp;
const smoothstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
const wrap180 = (d) => ((d % 360) + 540) % 360 - 180;
const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const smootherstep = (x) => x * x * x * (x * (x * 6 - 15) + 10);
const wrapHours = (h) => ((h % 24) + 24) % 24;

function forwardDir(headingDeg, pitchDeg, out = new THREE.Vector3()) {
  const h = headingDeg * DEG, p = pitchDeg * DEG;
  return out.set(Math.sin(h) * Math.cos(p), Math.sin(p), -Math.cos(h) * Math.cos(p));
}

// Vertical fov that keeps a preset's 3:2 horizontal field on a narrower frame.
function effectiveFov(designFov, aspect) {
  if (!(aspect > 0) || aspect >= FOV_REF_ASPECT) return designFov;
  const f = 2 * Math.atan(Math.tan(designFov * DEG / 2) * FOV_REF_ASPECT / aspect) / DEG;
  return Math.min(f, Math.max(designFov, FOV_MAX_DEG));
}

// Tower outer diameter at height y above the foundation's MSL, from the TURBINE.tower table.
function towerDiameterAt(y) {
  const T = TURBINE.tower;
  if (y <= T[0][0]) return T[0][1];
  for (let i = 1; i < T.length; i++) {
    if (y <= T[i][0]) {
      const f = (y - T[i - 1][0]) / (T[i][0] - T[i - 1][0]);
      return T[i - 1][1] + (T[i][1] - T[i - 1][1]) * f;
    }
  }
  return T[T.length - 1][1];
}

// Minimum horizontal distance from a turbine axis for a camera at height h above that
// turbine's MSL: TP below the tower base, the platform (ring and boat-landing lobe) around the
// deck, the tower above (the farm's keep-outs cover the nacelle, hub and blades).
function structureKeepOut(h) {
  const S = TURBINE.stack;
  if (h > S.towerTop) return 0;
  if (h >= S.skirtBottom - STEEL_CLEARANCE && h <= S.railTop + STEEL_CLEARANCE) {
    return TURBINE.platform.lobeSpan / 2 + STEEL_CLEARANCE;
  }
  if (h <= S.tpTop) return TURBINE.tp.diameter / 2 + STEEL_CLEARANCE;
  return towerDiameterAt(h) / 2 + STEEL_CLEARANCE;
}

function makePose() { return { pos: new THREE.Vector3(), heading: 0, pitch: 0, fov: 45, pivot: 500 }; }

function lerpPose(a, b, s, out) {
  // Cylindrical interpolation about the hero axis: long moves swing around the turbine instead of
  // cutting through the rotor, and radius, height and bearing all ease together.
  const ra = Math.hypot(a.pos.x, a.pos.z), rb = Math.hypot(b.pos.x, b.pos.z);
  const aa = Math.atan2(a.pos.x, a.pos.z), ab = Math.atan2(b.pos.x, b.pos.z);
  const ang = aa + wrapPi(ab - aa) * s, r = ra + (rb - ra) * s;
  out.pos.set(r * Math.sin(ang), a.pos.y + (b.pos.y - a.pos.y) * s, r * Math.cos(ang));
  out.heading = a.heading + wrap180(b.heading - a.heading) * s;
  out.pitch = a.pitch + (b.pitch - a.pitch) * s;
  out.fov = a.fov + (b.fov - a.fov) * s;
  out.pivot = Math.exp(Math.log(a.pivot) + (Math.log(b.pivot) - Math.log(a.pivot)) * s);
  return out;
}

function transitionSeconds(a, b) {
  const d = a.pos.distanceTo(b.pos);
  const turn = Math.abs(wrap180(b.heading - a.heading)) / 180;
  return clamp(1.4 + 0.9 * Math.log10(1 + d / 100) + 0.6 * turn, 1.4, 4.0);
}

function focusOf(blitz) {
  const f = blitz?.focus?.();
  return f && Number.isFinite(f.x) && Number.isFinite(f.z) ? f : null;
}

// ------------------------------------------------------------------------------------------------
// Camera rig: user orbit control (ui/orbit.js) plus preset views, animated transitions, the scripted
// cinematic orbit, Blitz-view following, riding the CTV in the deck view, and the sea / structure clamps.
class CameraRig {
  constructor(ctx, reducedMotion) {
    this.ctx = ctx;
    this.camera = ctx.camera;
    this.reducedMotion = reducedMotion;
    this.view = null;          // active preset name; null once the user orbits away
    this.transition = null;    // { from, to, s, duration, view }
    this.cine = null;          // { tau }: seconds into the cinematic orbit
    this.follow = null;        // { point }: smoothed blitz focus the Blitz view tracks
    this.ride = null;          // { eye }: the CTV eye position last frame (deck view rides the boat)
    this.pivot = 500;
    this.designFov = this.camera.fov;
    this.onViewChange = null;
    this._pose = makePose();
    this._v = new THREE.Vector3();
    this._eye = new THREE.Vector3();

    // User control (ui/orbit.js: orbit, dolly, pan along the sea; arrows pan when the canvas has focus).
    const el = ctx.renderer.domElement;
    this.controls = new Orbit(this.camera, el);
    this.controls.onStart = () => this._userTookOver();
    // A press, wheel or arrow key during an animation hands control back straight away. Capture-phase
    // listeners on the canvas run before the controls' own, so the same gesture then orbits.
    this._interrupt = (e) => { if ((this.transition || this.cine) && (e.type !== 'keydown' || /^Arrow/.test(e.code))) this._userTookOver(); };
    this._events = ['pointerdown', 'wheel', 'keydown'];
    for (const type of this._events) el.addEventListener(type, this._interrupt, { capture: true, passive: true });
  }

  dispose() {
    for (const type of this._events) this.ctx.renderer.domElement.removeEventListener(type, this._interrupt, { capture: true });
    this.controls.dispose();
  }

  setView(name, { instant = false } = {}) {
    const pose = this._presetPose(name);
    if (!pose) return false;
    this._flushControls();
    this.cine = null;
    this.follow = name === 'blitz' ? { point: pose.focus.clone() } : null;
    this.ride = null;
    // The CTV deck view stands on the crew boat pushed onto the hero's landing: bring the boat
    // there before the camera arrives (vessels.js also does so once a camera is aboard).
    if (name === 'deck') this.ctx.vessels?.ctv?.seek?.('hero');
    this._setViewName(name);
    if (instant || this.reducedMotion) {
      this.transition = null;
      this._apply(pose);
      this.cine = name === 'cinematic' ? { tau: 0 } : null;
      this.controls.enabled = name !== 'cinematic';
      return true;
    }
    const from = this._currentPose();
    this.transition = { from, to: pose, s: 0, duration: transitionSeconds(from, pose), view: name };
    this.controls.enabled = false;
    return true;
  }

  // Put the camera at an explicit pose (test hooks, scripted captures); the user has it from here.
  setPose(x, y, z, headingDeg, pitchDeg, fovDeg = this.designFov) {
    this._flushControls();
    this.transition = null; this.cine = null; this.follow = null; this.ride = null;
    const pose = makePose();
    pose.pos.set(x, y, z); pose.heading = headingDeg; pose.pitch = pitchDeg; pose.fov = fovDeg; pose.pivot = 500;
    this._apply(pose);
    this.controls.enabled = true;
    this._setViewName(null);
  }

  // The camera's aspect changed: re-derive the effective fov from the design fov.
  applyAspect() {
    const f = effectiveFov(this.designFov, this.camera.aspect);
    if (Math.abs(this.camera.fov - f) > 1e-6) this.camera.fov = f;
    this.camera.updateProjectionMatrix();
  }

  // realDt drives user-facing motion (transitions, damping); simDt (0 when frozen) drives the
  // cinematic orbit so a frozen frame stays put.
  update(realDt, simDt, t) {
    const prev = this._v.copy(this.camera.position);
    let userMoved = false;
    if (this.transition) {
      const tr = this.transition;
      tr.s = Math.min(1, tr.s + realDt / tr.duration);
      this._apply(lerpPose(tr.from, tr.to, smootherstep(tr.s), this._pose));
      if (tr.s >= 1) {
        this.transition = null;
        if (tr.view === 'cinematic') this.cine = { tau: 0 };
        else this.controls.enabled = true;
      }
    } else if (this.cine) {
      this.cine.tau += simDt;
      this._apply(this._cinePose(this.cine.tau, this._pose));
    } else {
      if (this.follow) this._followBlitz(realDt);
      if (this.view === 'deck') this._rideCTV();
      this.controls.update();
      userMoved = true;
    }
    this._clamp(t, userMoved ? prev : null);
    this.camera.updateMatrixWorld();
  }

  // A sea point for a blitz that will be in view: in the lower part of the frame, BLITZ_NEAR–
  // BLITZ_FAR metres out, within ±0.3 of the horizontal fov, at least BLITZ_CLEAR from any turbine
  // axis. When no sea is in frame (the deck view looks up at the TP) it goes 30–40 m out to the
  // side, where the birds wheeling over it are in frame.
  pointNearView(out = new THREE.Vector3()) {
    const cam = this.camera, pos = cam.position;
    const f = cam.getWorldDirection(new THREE.Vector3());
    const hLen = Math.hypot(f.x, f.z) || 1;
    const fx = f.x / hLen, fz = f.z / hLen;
    const pitch = Math.asin(clamp(f.y, -1, 1)) / DEG;
    const vfov = cam.fov, hfov = 2 * Math.atan(Math.tan(vfov * DEG / 2) * cam.aspect) / DEG;
    const h = Math.max(1, pos.y + curvatureDrop(pos.x, pos.z));
    const lower = pitch - 0.3 * vfov;           // a ray 30 % of the fov below the centre
    let dist, side = 0;
    if (lower < -1) dist = clamp(h / Math.tan(-lower * DEG), BLITZ_NEAR, BLITZ_FAR);
    else { dist = 35; side = 0.3 * hfov; }
    const turbines = this.ctx.farm?.turbines ?? [];
    const tries = side ? [side, -side] : [0, 0.12 * hfov, -0.12 * hfov, 0.25 * hfov, -0.25 * hfov];
    for (const a of tries) {
      const c = Math.cos(a * DEG), s = Math.sin(a * DEG);
      const dx = fx * c - fz * s, dz = fz * c + fx * s;
      out.set(pos.x + dx * dist, 0, pos.z + dz * dist);
      if (turbines.every((tb) => Math.hypot(tb.x - out.x, tb.z - out.z) >= BLITZ_CLEAR)) break;
    }
    out.y = -curvatureDrop(out.x, out.z);
    return out;
  }

  _setViewName(name) {
    if (this.view === name) return;
    this.view = name;
    this.onViewChange?.(name);
  }

  _userTookOver() {
    if (this.transition || this.cine) {
      this.transition = null;
      this.cine = null;
      this._retarget();
      this.controls.enabled = true;
    }
    this.follow = null;
    this.ride = null;
    this._setViewName(null);
  }

  // Apply any inertia the controls still hold, then clear it, so a view change never inherits
  // the drift of the last drag.
  _flushControls() {
    const damping = this.controls.enableDamping;
    this.controls.enableDamping = false;
    this.controls.update();
    this.controls.enableDamping = damping;
  }

  _retarget() {
    const f = this.camera.getWorldDirection(new THREE.Vector3());
    this.controls.target.copy(this.camera.position).addScaledVector(f, this.pivot);
  }

  _apply(pose) {
    const cam = this.camera;
    cam.position.copy(pose.pos);
    cam.rotation.set(pose.pitch * DEG, -pose.heading * DEG, 0, 'YXZ');
    if (Math.abs(this.designFov - pose.fov) > 1e-6 || Math.abs(cam.fov - effectiveFov(pose.fov, cam.aspect)) > 1e-6) {
      this.designFov = pose.fov;
      this.applyAspect();
    }
    this.pivot = pose.pivot;
    this.controls.target.copy(pose.pos).addScaledVector(forwardDir(pose.heading, pose.pitch, new THREE.Vector3()), pose.pivot);
  }

  _currentPose() {
    const p = makePose();
    const f = this.camera.getWorldDirection(new THREE.Vector3());
    p.pos.copy(this.camera.position);
    p.heading = Math.atan2(f.x, -f.z) / DEG;
    p.pitch = Math.asin(clamp(f.y, -1, 1)) / DEG;
    p.fov = this.designFov;
    p.pivot = Math.max(1, this.camera.position.distanceTo(this.controls.target));
    return p;
  }

  // Pose of a preset without side effects (no blitz is started): used to pre-warm programs.
  staticPose(name) {
    if (name === 'cinematic') return this._cinePose(0, makePose());
    const P = CAMERA_PRESETS[name];
    if (!P?.position) return null;
    const pose = makePose();
    pose.pos.fromArray(P.position);
    pose.heading = P.headingDeg; pose.pitch = P.pitchDeg; pose.fov = P.vfovDeg;
    pose.pivot = PIVOT_DISTANCE[name] ?? 500;
    return pose;
  }

  _presetPose(name) {
    const pose = this.staticPose(name);
    if (!pose || name !== 'blitz') return pose;
    // The preset frames a sea point 120 m ahead; blitz.focus() moves that point onto the action,
    // and the camera closes in to BLITZ_STANDOFF along the same view ray.
    const fwd = forwardDir(pose.heading, pose.pitch);
    const implied = pose.pos.clone().addScaledVector(fwd, pose.pivot);
    const blitz = this.ctx.blitz;
    let f = focusOf(blitz);
    if (!f && blitz?.trigger && this.ctx.state.toggles.blitz) {
      blitz.trigger(implied.x, implied.z, { preroll: BLITZ_PREROLL_S });
      f = focusOf(blitz);
    }
    if (f) {
      pose.focus = new THREE.Vector3(f.x, f.y, f.z);
      pose.pivot = BLITZ_STANDOFF;
      pose.pos.copy(pose.focus).addScaledVector(fwd, -BLITZ_STANDOFF);
    } else {
      pose.focus = implied.setY(0);
    }
    return pose;
  }

  _cinePose(tau, out) {
    const K = CINE, ph = K.omega * tau;
    const az = K.az0 + K.C.degPerSec * tau;
    const r = K.r.mid + K.r.amp * Math.cos(ph + K.r.ph);
    const y = K.y.mid + K.y.amp * Math.cos(ph + K.y.ph);
    azimuthToDir(az, out.pos).multiplyScalar(r);
    out.pos.y = y;
    out.heading = az - 180 + K.headingOffset;
    out.pitch = Math.atan2(K.lookY - y, r) / DEG;
    out.fov = K.fov.mid + K.fov.amp * Math.cos(ph + K.fov.ph);
    out.pivot = r;
    return out;
  }

  _followBlitz(dt) {
    const f = focusOf(this.ctx.blitz);
    if (!f) { this.follow = null; return; }
    const k = 1 - Math.exp(-dt / FOLLOW_TAU_S);
    const dx = (f.x - this.follow.point.x) * k, dz = (f.z - this.follow.point.z) * k;
    this.follow.point.x += dx; this.follow.point.z += dz;
    this.camera.position.x += dx; this.camera.position.z += dz;
    this.controls.target.x += dx; this.controls.target.z += dz;
  }

  // Deck view: the camera stands on the CTV and moves with it (heave, pitch, roll, drift on the
  // landing), keeping the view direction the user chose.
  _rideCTV() {
    const ctv = this.ctx.vessels?.ctv;
    if (typeof ctv?.eye !== 'function') return;
    const eye = ctv.eye(this._eye);
    if (!Number.isFinite(eye.x)) return;
    if (!this.ride) {
      // Only ride once the boat is under the camera (it is brought to the landing on view change).
      if (eye.distanceTo(this.camera.position) > 3) return;
      this.ride = { eye: eye.clone() };
      return;
    }
    const dx = eye.x - this.ride.eye.x, dy = eye.y - this.ride.eye.y, dz = eye.z - this.ride.eye.z;
    if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) > 20) { this.ride = null; return; }   // the boat jumped
    this.camera.position.x += dx; this.camera.position.y += dy; this.camera.position.z += dz;
    this.controls.target.x += dx; this.controls.target.y += dy; this.controls.target.z += dz;
    this.ride.eye.copy(eye);
  }

  // prev: the camera position before the controls moved it this frame (null for scripted poses:
  // presets and transitions are composed outside every volume). The farm and the vessels publish
  // keep-out solvers that push a point out of their volumes (farm.resolveKeepOuts: nacelle, cooler,
  // heli deck, hub, the blades at their current angle, the substation topside and jacket legs;
  // vessels.clampCamera: hulls and superstructures, sideways or up only); the shell adds the tower,
  // TP and platform (structureKeepOut) and the sea.
  _clamp(t, prev) {
    const p = this.camera.position;
    const ctx = this.ctx;
    if (prev) {
      const solvers = this._solvers || (this._solvers = []);
      solvers.length = 0;
      if (typeof ctx.farm?.resolveKeepOuts === 'function') solvers.push((q) => ctx.farm.resolveKeepOuts(q, STEEL_CLEARANCE));
      if (typeof ctx.vessels?.clampCamera === 'function') solvers.push((q) => ctx.vessels.clampCamera(q, VESSEL_CLEARANCE));
      const probe = this._probe || (this._probe = new THREE.Vector3());
      const tgt = this.controls.target;
      for (const push of solvers) {
        try {
          push(p);
          // A target inside a volume would pull the zoom through it: move the target onto the skin
          // (bisect camera → target for the first point the solver would move).
          if (push(probe.copy(tgt))) {
            const dir = new THREE.Vector3().subVectors(tgt, p);
            const len = dir.length();
            if (len > 1e-3) {
              dir.divideScalar(len);
              let lo = 0, hi = len;
              for (let i = 0; i < 20; i++) {
                const mid = 0.5 * (lo + hi);
                if (push(probe.copy(p).addScaledVector(dir, mid))) hi = mid; else lo = mid;
              }
              tgt.copy(p).addScaledVector(dir, Math.max(lo, 0.5));
            }
          }
        } catch { /* a module's solver failed: skip it this frame */ }
      }
    }
    const turbines = ctx.farm?.turbines;
    if (turbines) {
      const reach = TURBINE.platform.lobeSpan / 2 + STEEL_CLEARANCE;
      for (const tb of turbines) {
        let dx = p.x - tb.x, dz = p.z - tb.z;
        if (Math.abs(dx) > reach || Math.abs(dz) > reach) continue;
        const base = Number.isFinite(tb.baseY) ? tb.baseY : -curvatureDrop(tb.x, tb.z);
        const keep = structureKeepOut(p.y - base);
        const r = Math.hypot(dx, dz);
        if (keep <= 0 || r >= keep) continue;
        if (r < 1e-4) {
          const f = this.camera.getWorldDirection(new THREE.Vector3());
          dx = -f.x; dz = -f.z;
          const h = Math.hypot(dx, dz) || 1;
          dx /= h; dz /= h;
        } else { dx /= r; dz /= r; }
        p.x = tb.x + dx * keep;
        p.z = tb.z + dz * keep;
      }
    }
    const ocean = ctx.ocean;
    const sea = ocean ? ocean.getHeight(p.x, p.z, t) : -curvatureDrop(p.x, p.z);
    if (p.y < sea + SEA_CLEARANCE) p.y = sea + SEA_CLEARANCE;
  }
}

// ------------------------------------------------------------------------------------------------
// Loading overlay (standalone page only; on a host page the host shows its own still). Progress is
// a fraction weighted by where the time goes: module loading 25 %, construction 25 %, shader
// compilation 45 % (by programs ready), opening frame 5 %.
const LOAD_STAGE = { modules: [0, 0.25], build: [0.25, 0.5], compile: [0.5, 0.95], frame: [0.95, 1] };
class LoadingOverlay {
  constructor() {
    this.root = byId('loading');
    this.status = byId('loading-status');
    this.bar = byId('loading-bar');
    this.action = byId('loading-action');
  }
  set(stage, fraction, text) {
    const [a, b] = LOAD_STAGE[stage];
    if (this.bar) this.bar.style.width = `${(100 * (a + (b - a) * clamp(fraction, 0, 1))).toFixed(1)}%`;
    if (text && this.status) this.status.textContent = text;
  }
  finish(instant) {
    if (!this.root) return;
    if (this.bar) this.bar.style.width = '100%';
    this.root.classList.add('done');
    setTimeout(() => { this.root.hidden = true; }, instant ? 0 : 650);
  }
  // Show a message; with `reload`, a button that reloads the page (state kept in the URL).
  fail(text, reload = null) {
    if (this.status) { this.status.textContent = text; this.status.classList.add('failed'); }
    if (this.root) { this.root.hidden = false; this.root.classList.remove('done'); }
    if (this.action) {
      this.action.hidden = !reload;
      this.action.onclick = reload;
    }
  }
}

// Progress on the standalone page's loading overlay. Call sites read `globalThis.NJOW_DEV === false ||
// progress(…)` so that a host bundle (no overlay) drops them and their texts (see HOSTED).
const progress = globalThis.NJOW_DEV === false ? null : (stage, fraction, text) => overlay?.set(stage, fraction, text);

function deviceTier() {
  const ua = navigator.userAgent || '';
  const touch = (navigator.maxTouchPoints || 0) > 1;
  const coarse = matchMedia('(pointer: coarse)').matches;
  const fine = matchMedia('(any-pointer: fine)').matches;
  const iPad = /iPad/.test(ua) || (/Macintosh/.test(ua) && touch);
  const phone = navigator.userAgentData?.mobile === true || /iPhone|iPod/.test(ua) || (/Android/.test(ua) && /Mobile/.test(ua));
  const shortSide = Math.min(screen.width || 0, screen.height || 0);
  if (phone || (coarse && !fine && shortSide > 0 && shortSide < 600)) return 'low';
  if (iPad || /Android/.test(ua) || (coarse && !fine)) return 'med';
  return 'high';
}
function hintTier() {
  const h = window.__SW_HINT?.tier;
  return TIERS[h] ? h : null;
}

// Reversed-Z (three-r180-api §5.4, §7, §10.3; only under ?depth=reversed): the far plane is at depth 0
// and three flips every depth test. The modules own their side of it: the sky dome sits at z ≈ 0 and
// the shadow bias is positive (atmosphere.js), the ocean mirror uses the reversed oblique near plane
// and a float depth texture (ocean-reflection.js), and Post gives the scene target a float depth.

// ?size=N (a square) or ?size=WxH (e.g. 1920x1080, the wide kirt.lol capture): a drawing buffer of exactly that
// many pixels at pixel ratio 1, whatever the stage's CSS size (stills and captures read it back). [w, h] or null.
function parseSize(s) {
  const m = /^(\d{1,4})(?:[x×](\d{1,4}))?$/i.exec(String(s ?? '').trim());
  if (!m || !(+m[1] > 0) || (m[2] !== undefined && !(+m[2] > 0))) return null;
  const w = Math.min(+m[1], 4096), h = Math.min(+(m[2] ?? m[1]), 4096);
  return [w, h];
}

function parseDate(s) {
  const m = /^(\d{1,2})-(\d{1,2})$/.exec(s || '');
  if (!m) return null;
  const month = +m[1], day = +m[2];
  return month >= 1 && month <= 12 && day >= 1 && day <= 31 ? { month, day } : null;
}

// ------------------------------------------------------------------------------------------------
// Module scope: parameters, tier, renderer, the host-facing world (all synchronous).
const canvas = byId('scene');
const stage = canvas?.parentElement ?? document.body;
// A host's production bundle (kirt.lol builds with globalThis.NJOW_DEV = false) only ever runs on the
// host's stage + HUD. Tests of `globalThis.NJOW_DEV === false || HOSTED` below are written out in full
// so the bundler folds them and drops the standalone page's panel and loading overlay with the dev
// hooks. Unbundled (index.html, dev pages, dev/shell-hosted.html) the markup decides.
const HOSTED = globalThis.NJOW_DEV === false || !!document.querySelector('.stage .hud');
const REDUCED_MOTION = matchMedia('(prefers-reduced-motion: reduce)').matches;

const P = (() => {
  const qRaw = String(PARAMS.get('q') ?? PARAMS.get('quality') ?? '').toLowerCase();
  const hours = param('time', HOSTED ? HOSTED_DEFAULTS.hours : TIME_DEFAULT.hours);
  const speed = param('speed', HOSTED ? HOSTED_DEFAULTS.speed : 60);
  return {
    q: TIERS[qRaw] ? qRaw : null,
    size: parseSize(PARAMS.get('size')),
    freeze: param('freeze', false),
    capture: param('capture', false),
    dev: PARAMS.get('dev') === '1',
    t: Math.max(0, param('t', 0)),
    hours: Number.isFinite(hours) ? wrapHours(hours) : TIME_DEFAULT.hours,
    date: parseDate(PARAMS.get('date')),
    speed: SPEEDS.includes(speed) ? speed : 60,
    // A visitor who asked for reduced motion gets the hosted piece paused (the Time-lapse button starts it).
    play: PARAMS.has('play') ? param('play', false) : HOSTED && HOSTED_DEFAULTS.playing && !REDUCED_MOTION,
  };
})();
if (P.capture) P.freeze = false;
const tierName = P.q ?? hintTier() ?? deviceTier();

// ?depth=reversed (A/B, dev builds only: a host bundle always uses the default logarithmic depth): reversed-Z
// (EXT_clip_control) with a 32-bit float depth buffer instead of the logarithmic depth buffer, whose
// gl_FragDepth write disables early depth rejection (hidden-surface removal on Apple GPUs) and makes MSAA pay
// for per-pixel depth (engineering critic p1). Without EXT_clip_control three falls back to standard depth.
// See the reversed-Z note above.
const REVERSED = globalThis.NJOW_DEV !== false && PARAMS.get('depth') === 'reversed';
let renderer = null, createError = null;
try {
  if (!canvas) throw new Error('The page has no <canvas id="scene">.');
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,                                   // MSAA/FXAA happen in Post
    logarithmicDepthBuffer: !REVERSED && RENDER.logarithmicDepthBuffer,
    reversedDepthBuffer: REVERSED,
    powerPreference: 'high-performance',
    stencil: false,
    preserveDrawingBuffer: P.freeze || P.capture,       // stills are read back with toDataURL
  });
} catch (err) {
  createError = err;
}
// Under reversed-Z, r180 still sorts by clip-space z as if it grew with distance (projectObject with
// painterSortStable / reversePainterSortStable), but the reversed projection makes it shrink (z = n (f − d) /
// (f − n)): opaque draws would run back to front and transparent ones front to back (blitz spray, wakes, lamp
// halos sharing a renderOrder; modeller r3). The same orders with the z step flipped.
if (REVERSED && renderer?.capabilities.reversedDepthBuffer) {
  const order = (a, b) => a.groupOrder - b.groupOrder || a.renderOrder - b.renderOrder;
  renderer.setOpaqueSort((a, b) => order(a, b) || a.material.id - b.material.id || b.z - a.z || a.id - b.id);
  renderer.setTransparentSort((a, b) => order(a, b) || a.z - b.z || a.id - b.id);
}

// Runtime state shared by boot, the loop and the host hooks.
let ctx = null, rig = null, overlay = null, timer = null, ro = null;
let running = false, stopped = false, booted = false;
let stopResolve;
const stopSignal = new Promise((r) => { stopResolve = r; });
const missing = [];                      // [{ key, reason }]
const broken = new Set();
const gov = { active: false, scale: 1, ema: 16.7, slow: 0, fast: 0 };
const cleanups = [];                     // listeners to remove on stop()

function moduleStatus() {
  const dead = new Set();
  for (const m of missing) dead.add(STATUS_ALIAS[m.key] ?? m.key);
  for (const k of broken) dead.add(STATUS_ALIAS[k] ?? k);
  return Object.fromEntries(STATUS_KEYS.map((k) => [k, dead.has(k) ? 'dead' : 'ok']));
}

const world = {
  renderer,
  get quality() { return ctx?.quality ?? TIERS[tierName]; },
  params: { q: P.q ?? 'auto', size: P.size ? P.size.join('x') : null, t: P.t, freeze: P.freeze, capture: P.capture, dev: P.dev, hosted: HOSTED,
    depth: renderer?.capabilities.reversedDepthBuffer ? 'reversed' : renderer?.capabilities.logarithmicDepthBuffer ? 'log' : 'standard' },
  frame: 0, t: 0, px: 0,
  moduleStatus,
  api: {},
  get ctx() { return ctx; },
};

let stepFrame = null, renderFrame = null;     // set in boot()
let bootPromise = null;

window.__app = {
  world,
  // One frame without advancing time.
  render() { if (renderFrame && !stopped) renderFrame(0); },
  // Advance the simulation by dt seconds (fixed step), render, and resolve once that frame's meter
  // reading is back, so the next frame's exposure never depends on read-back timing.
  async advance(dt = 1 / 60) {
    await bootPromise;
    if (stopped || !stepFrame) return world.t;
    stepFrame(dt, dt);
    await ctx.post?.meterPass.lastRead;
    return world.t;
  },
  stop,
  stats() {
    const i = renderer?.info;
    return { t: +world.t.toFixed(3), px: world.px, scale: gov.scale, drawCalls: i?.render.calls, triangles: i?.render.triangles,
      textures: i?.memory.textures, geometries: i?.memory.geometries, modules: moduleStatus(), exposure: ctx?.post?.exposure };
  },
};

// Stop for good (a host switching to its recording, or leaving the page): no more frames, listeners
// removed, every module disposed in reverse construction order, then the renderer.
function stop() {
  if (stopped) return;
  stopped = true;
  running = false;
  stopResolve();
  try { renderer?.setAnimationLoop(null); } catch { /* ignore */ }
  try { timer?.dispose(); } catch { /* ignore */ }
  try { ro?.disconnect(); } catch { /* ignore */ }
  for (const off of cleanups.splice(0)) { try { off(); } catch { /* ignore */ } }
  try { ctx?.ui?.dispose?.(); } catch { /* ignore */ }
  try { rig?.dispose(); } catch { /* ignore */ }
  if (ctx) {
    for (const key of ['blitz', 'birds', 'vessels', 'farm', 'ocean', 'land', 'atmosphere', 'post']) {
      try { ctx[key]?.dispose?.(); } catch { /* a module that cannot dispose cleanly */ }
    }
  }
  try { renderer?.dispose(); } catch { /* ignore */ }
}

const nextFrame = () => new Promise((resolve) => {
  let done = false;
  const go = () => { if (!done) { done = true; resolve(); } };
  requestAnimationFrame(go);
  setTimeout(go, 50);                    // background tabs get no rAF
});
const guard = (p) => Promise.race([p, stopSignal]);

// ------------------------------------------------------------------------------------------------
async function boot() {
  if (createError) throw createError;
  const reducedMotion = REDUCED_MOTION;
  const state = {
    view: null,
    wind: SEA.windSpeed,
    windFromDeg: SEA.windFromDeg,
    clouds: CLOUDS.cover,
    quality: tierName,
    toggles: {
      blitz: param('blitzes', true),
      birds: param('birds', true),
      vessels: param('vessels', true),
      photo: param('photo', MARKINGS.photoLookDefault),
      adls: param('adls', NIGHT_LIGHTS.adlsDefault),
      cpl: param('cpl', true),
    },
    frozen: P.freeze,
    uiVisible: param('ui', true) && !HOSTED,
    reducedMotion,
    hosted: HOSTED,
    missing,
    ready: false,
    busy: null,                            // text while the scene is paused for work (quality switch)
  };
  if (globalThis.NJOW_DEV !== false && !state.uiVisible) document.documentElement.classList.add('ui-off');
  overlay = globalThis.NJOW_DEV === false || HOSTED ? null : new LoadingOverlay();
  window.__sceneReady = false;
  // Boot timings (ms) for __sceneStats.boot; a host bundle (no __sceneStats readers) leaves them out.
  const bootStats = {};
  const t0 = globalThis.NJOW_DEV === false ? 0 : performance.now();
  const since = (t) => +(performance.now() - t).toFixed(1);

  // 1. Modules. fog first and alone (ShaderChunk patch), then the rest in parallel.
  const stubs = globalThis.NJOW_DEV !== false ? window.__NJOW_STUBS : null;   // dev/shell.html only
  const mods = {};
  const noteMissing = (key, reason) => { missing.push({ key, reason }); };
  let loaded = 0;
  const load = async (key) => {
    const loader = stubs?.[key] ?? LOADERS[key];
    try {
      mods[key] = await loader();
    } catch (err) {
      mods[key] = null;
      noteMissing(key, 'failed to load');
      console.error(`[shell] module "${key}" failed to load; continuing without it.`, err);
    }
    loaded++;
    globalThis.NJOW_DEV === false || progress('modules', loaded / MODULE_KEYS.length, `Loading modules · ${loaded} of ${MODULE_KEYS.length}`);
  };
  globalThis.NJOW_DEV === false || progress('modules', 0, `Loading modules · 0 of ${MODULE_KEYS.length}`);
  await guard(load(MODULE_KEYS[0]));
  if (stopped) return;
  await guard(Promise.all(MODULE_KEYS.slice(1).map(load)));
  if (stopped) return;
  globalThis.NJOW_DEV === false || (bootStats.modulesMs = since(t0));

  // 2. Renderer setup, scene, camera.
  const quality = TIERS[tierName];
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;   // (Post tone-maps itself; kept for any direct render)
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.info.autoReset = false;                      // one reset per frame, so every pass counts

  const scene = new THREE.Scene();
  // USE_FOG must be defined for the aerial-perspective chunk (ARCHITECTURE decisions). The
  // atmosphere may replace this; its near/far are set so an unpatched chunk would add no fog.
  scene.fog = new THREE.Fog(0xffffff, RENDER.far, 2 * RENDER.far);

  const camera = new THREE.PerspectiveCamera(CAMERA_PRESETS.drone.vfovDeg, 16 / 9, RENDER.near, RENDER.far);
  camera.rotation.order = 'YXZ';
  scene.add(camera);

  ctx = {
    renderer, scene, camera, quality,
    clock: null, atmosphere: null, land: null, ocean: null, farm: null, vessels: null, birds: null, blitz: null,
    post: null, ui: null,
    // shell additions
    seed: param('seed', 1),
    state,
    api: null,
    controls: null,
    world,
    ephemeris: mods.time ? { solarPosition: mods.time.solarPosition, lunarPosition: mods.time.lunarPosition } : null,
  };

  const roots = {};                  // module key → scene roots it added (for toggles without setEnabled)
  const buildSteps = BUILD.length + 3;        // + clock, post, UI
  let built = 0;
  const construct = async (key, make) => {
    globalThis.NJOW_DEV === false || progress('build', built / buildSteps, `Building ${BUILD_LABELS[key]}`);
    built++;
    await guard(nextFrame());                  // let the status paint; no single long task
    if (stopped) return;
    const before = scene.children.length;
    const c0 = globalThis.NJOW_DEV === false ? 0 : performance.now();
    try {
      ctx[key] = make();
    } catch (err) {
      ctx[key] = null;
      noteMissing(key, 'failed to construct');
      console.error(`[shell] ${key} failed to construct; continuing without it.`, err);
    }
    globalThis.NJOW_DEV === false || (bootStats[key] = since(c0));
    roots[key] = scene.children.slice(before);
  };

  // 3. SimClock → Atmosphere → Land → Ocean → Farm → Vessels → Birds → Blitz → Post → UI.
  if (mods.time?.SimClock) {
    await construct('clock', () => new mods.time.SimClock({
      year: TIME_DEFAULT.year,
      month: P.date ? P.date.month : TIME_DEFAULT.month,
      day: P.date ? P.date.day : TIME_DEFAULT.day,
      hours: P.hours,
      speed: P.speed,
      playing: P.play && !P.freeze,
    }));
  } else built++;
  if (stopped) return;
  for (const [key, exportName] of BUILD) {
    const Cls = mods[key]?.[exportName];
    if (Cls) await construct(key, () => new Cls(ctx));
    else {
      built++;
      if (mods[key]) { noteMissing(key, `no ${exportName} export`); console.error(`[shell] module "${key}" has no ${exportName} export; continuing without it.`); }
    }
    if (stopped) return;
  }
  await construct('post', () => new Post(ctx));
  if (stopped) return;
  if (ctx.post && P.capture) ctx.post.setCapture(true);

  rig = new CameraRig(ctx, reducedMotion);
  ctx.controls = rig.controls;
  rig.onViewChange = (name) => { state.view = name; };

  // ---------------------------------------------------------------------------------------------
  // Runtime state changes. The UI, the keyboard, URL params and window.__scene all go through here.
  const safeCall = (key, what, fn) => {
    if (broken.has(key)) return;
    try { fn(); } catch (err) {
      broken.add(key);
      noteMissing(key, `${what} threw`);
      console.error(`[shell] ${key}.${what} threw; ${key} is paused for the rest of the session.`, err);
    }
  };
  const setModuleEnabled = (key, on) => {
    const m = ctx[key];
    if (!m) return;
    if (typeof m.setEnabled === 'function') safeCall(key, 'setEnabled', () => m.setEnabled(on));
    else for (const o of roots[key] || []) o.visible = on;
  };
  // A module hidden by its toggle keeps updating only if it manages its own visibility.
  const moduleActive = (key) => !MODULE_TOGGLES.has(key) || state.toggles[key] || typeof ctx[key]?.setEnabled === 'function';

  // Everything that must happen when the frame size, the pixel ratio or the tier changes.
  function stageSize() {
    if (P.size) return P.size;
    return [Math.max(1, stage.clientWidth || window.innerWidth), Math.max(1, stage.clientHeight || window.innerHeight)];
  }
  // Pixel ratio (see TIERS): [the budget-fitted base, the cap] for tier q on a w × h CSS stage.
  function pixelRatioRange(q, w, h) {
    const cap = Math.min(window.devicePixelRatio || 1, RENDER.maxPixelRatio, q.pixelRatio);
    return [Math.min(cap, Math.sqrt(PIXEL_BUDGET[q.name] / Math.max(1, w * h))), cap];
  }
  function pixelRatioFor(q, w, h) {
    if (P.size) return 1;
    const [base, cap] = pixelRatioRange(q, w, h);
    return clamp(base * gov.scale, 0.25, cap);
  }
  const _px = new THREE.Vector2();
  function resize() {
    if (stopped) return;
    const [w, h] = stageSize();
    const pr = pixelRatioFor(ctx.quality, w, h);
    renderer.setPixelRatio(pr);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    rig.applyAspect();
    ctx.post?.setSize(w, h, pr);
    world.px = renderer.getDrawingBufferSize(_px).x;
  }

  // The URL that reproduces the current state: the standalone page reloads with it after a lost graphics
  // context (a host reloads its own page, so a host bundle leaves it out).
  const stateUrl = globalThis.NJOW_DEV === false ? null : () => {
    const q = new URLSearchParams(location.search);
    const clock = ctx.clock;
    if (clock) {
      q.set('time', clock.hours.toFixed(4));
      q.set('date', `${String(clock.date.month).padStart(2, '0')}-${String(clock.date.day).padStart(2, '0')}`);
      q.set('speed', String(clock.speed));
      q.set('play', clock.playing ? '1' : '0');
    }
    if (rig.view) q.set('view', rig.view);
    q.set('wind', String(state.wind));
    q.set('clouds', String(state.clouds));
    for (const [k, v] of Object.entries(state.toggles)) q.set(k === 'blitz' ? 'blitzes' : k, v ? '1' : '0');
    if (P.q) q.set('q', state.quality);
    return `${location.pathname}?${q.toString()}${location.hash}`;
  };

  let compiling = null;                  // promise while programs compile after a quality switch
  const api = {
    ctx,
    setTime(h) {
      if (!ctx.clock || !Number.isFinite(h)) return;
      ctx.clock.setTime(wrapHours(h));
      ctx.post?.snapExposure();
    },
    setDate(month, day) {
      if (!ctx.clock || !Number.isFinite(month)) return;
      ctx.clock.setDate(month, Number.isFinite(day) ? day : ctx.clock.date.day);
      ctx.post?.snapExposure();
    },
    play(on = true) { if (ctx.clock) ctx.clock.playing = !!on; },
    // Any positive rate (a capture script eases it); the UI offers SPEEDS.
    setSpeed(x) { if (ctx.clock && Number.isFinite(+x) && +x > 0) ctx.clock.speed = Math.min(+x, 86400); },
    setView(name, opts) { return rig.setView(name, opts); },
    // Switch tier. The loop pauses while the new programs compile in parallel (no frozen page), then
    // resumes; returns a promise that settles when the new tier is drawing.
    setQuality(t) {
      const next = t === 'auto' ? (hintTier() ?? deviceTier()) : t;
      if (compiling) return compiling.then(() => api.setQuality(t));
      if (!TIERS[next] || next === state.quality) return Promise.resolve(false);
      state.quality = next;
      ctx.quality = TIERS[next];
      globalThis.NJOW_DEV === false || (state.busy = 'Switching quality…');   // the panel's notice
      const timing = globalThis.NJOW_DEV === false ? null : (bootStats.qualitySwitch = {});
      compiling = (async () => {
        running = false;
        renderer.setAnimationLoop(null);
        // One module per task, so no single task holds the page (they rebuild meshes and targets).
        let c0 = globalThis.NJOW_DEV === false ? 0 : performance.now();
        resize();
        if (ctx.post) safeCall('post', 'setQuality', () => ctx.post.setQuality(ctx.quality));
        globalThis.NJOW_DEV === false || (timing.post = since(c0));
        for (const key of UPDATE_ORDER) {
          const m = ctx[key];
          if (!m || typeof m.setQuality !== 'function') continue;
          await guard(nextFrame());
          if (stopped) return;
          globalThis.NJOW_DEV === false || (c0 = performance.now());
          safeCall(key, 'setQuality', () => m.setQuality(ctx.quality));
          globalThis.NJOW_DEV === false || (timing[key] = since(c0));
        }
        // One update without advancing time, so the modules rebuild what depends on the tier (the
        // environment map at its new size changes every PBR program) before the programs compile.
        await guard(nextFrame());
        if (stopped) return;
        globalThis.NJOW_DEV === false || (c0 = performance.now());
        updateModules(0, U.uTime.value);
        globalThis.NJOW_DEV === false || (timing.update = since(c0));
        await prewarmPrograms('Switching quality');
        globalThis.NJOW_DEV === false || (timing.compile = bootStats.lastCompileMs);
      })().finally(() => { compiling = null; state.busy = null; });
      return compiling.then(() => true);
    },
    // immediate: jump the sea state instead of easing (boot, frozen frames).
    setWind(ms, { immediate = state.frozen } = {}) {
      if (!Number.isFinite(ms)) return;
      state.wind = clamp(ms, 0, 25);
      const toward = azimuthToDir(state.windFromDeg + 180);
      U.uWindSpeed.value = state.wind;
      U.uWind.value.set(toward.x * state.wind, toward.z * state.wind);
      if (ctx.farm?.setWind) safeCall('farm', 'setWind', () => ctx.farm.setWind(state.wind, state.windFromDeg));
      if (ctx.ocean?.setSeaState) {
        safeCall('ocean', 'setSeaState', () => ctx.ocean.setSeaState({
          windSpeed: state.wind, windFromDeg: state.windFromDeg,
          swellHs: SEA.swell.Hs, swellFromDeg: SEA.swell.fromDeg, swellPeriod: SEA.swell.Tp,
        }, { immediate }));
      }
    },
    setClouds(cover) {
      if (!Number.isFinite(cover)) return;
      state.clouds = clamp(cover, 0, 1);
      U.uCloudCover.value = state.clouds;
      if (ctx.atmosphere?.setClouds) safeCall('atmosphere', 'setClouds', () => ctx.atmosphere.setClouds({ cover: state.clouds }));
    },
    // Returns { x, z, id } for the point used (id = whatever blitz.trigger returned), or null
    // when blitzes are off or unavailable. Without a point: a sea point in view (pointNearView).
    triggerBlitz(x, z, opts = {}) {
      const b = ctx.blitz;
      if (!b?.trigger || !state.toggles.blitz) return null;
      if (!Number.isFinite(x) || !Number.isFinite(z)) ({ x, z } = rig.pointNearView());
      let id = null;
      safeCall('blitz', 'trigger', () => { id = b.trigger(x, z, { preroll: BLITZ_PREROLL_S, ...opts }) ?? null; });
      return { x, z, id };
    },
    freeze(on = true) { state.frozen = !!on; },
    setToggle(name, on) {
      if (!(name in state.toggles)) return;
      on = !!on;
      state.toggles[name] = on;
      if (MODULE_TOGGLES.has(name)) setModuleEnabled(name, on);
      else if (name === 'photo') { const f = mods.turbine?.setPhotoLook; if (f) safeCall('turbine', 'setPhotoLook', () => f(on)); }
      else if (name === 'adls') { if (ctx.farm?.setADLS) safeCall('farm', 'setADLS', () => ctx.farm.setADLS(on)); }
    },
    getView() { return rig.view; },
    // Explicit camera pose: world metres, compass heading, pitch and vertical fov in degrees.
    setCamera(x, y, z, headingDeg, pitchDeg, fovDeg) {
      if (![x, y, z, headingDeg, pitchDeg].every(Number.isFinite)) return false;
      rig.setPose(x, y, z, headingDeg, pitchDeg, Number.isFinite(fovDeg) ? fovDeg : undefined);
      return true;
    },
    nextView() {
      const order = ['drone', 'overview', 'nacelle', 'deck', 'blitz', 'cinematic'];
      const i = order.indexOf(rig.view);
      return rig.setView(order[(i + 1) % order.length]);
    },
    stateUrl,
  };
  ctx.api = api;
  world.api = api;
  window.__scene = api;

  // Initial state from the URL (ARCHITECTURE "URL params").
  api.setWind(param('wind', SEA.windSpeed), { immediate: true });
  api.setClouds(param('clouds', CLOUDS.cover));
  for (const [name, on] of Object.entries(state.toggles)) api.setToggle(name, on);
  if (state.frozen) U.uTime.value = P.t;
  let startView = String(param('view', DEFAULT_VIEW));
  if (!VIEW_ORDER.includes(startView)) startView = DEFAULT_VIEW;
  if (param('blitz', false)) {
    // ?blitz=1: one blitz at the sea point the Blitz preset frames (also in the drone frame, 675 m out).
    const Pb = CAMERA_PRESETS.blitz;
    const p = new THREE.Vector3().fromArray(Pb.position).addScaledVector(forwardDir(Pb.headingDeg, Pb.pitchDeg), PIVOT_DISTANCE.blitz);
    api.triggerBlitz(p.x, p.z);
  }
  resize();
  rig.setView(startView, { instant: true });

  if (globalThis.NJOW_DEV !== false) state.capabilities = { photoLook: typeof mods.turbine?.setPhotoLook === 'function', polarizer: !!(ctx.ocean || ctx.atmosphere) };   // for the panel (ui.js)
  await construct('ui', () => (globalThis.NJOW_DEV === false || HOSTED ? new HudUI(ctx) : new UI(ctx)));
  if (stopped) return;

  // Test and inspection hooks (bench, scaleReport) for the standalone page and dev hosts. A host
  // build may define globalThis.NJOW_DEV = false to leave them out.
  if (globalThis.NJOW_DEV !== false && (!HOSTED || P.dev)) {
    try {
      const dev = await guard(import('./ui/dev-hooks.js'));
      if (stopped) return;
      dev?.installDevHooks?.(api, { renderer, camera, state, stepFrame: (dt) => stepFrame(dt, state.frozen ? 0 : dt), sync: () => { renderer.setRenderTarget(null); const gl = renderer.getContext(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4)); } });
    } catch (err) { console.error('[shell] dev hooks failed to load.', err); }
  }

  // ---------------------------------------------------------------------------------------------
  // Frame.
  timer = new THREE.Timer();
  timer.connect(document);
  // Frame statistics for the panel's readout and the project's tools (window.__sceneStats; a host reads
  // __app.stats() instead): exponential moving averages over ~0.5 s of real time.
  const stats = globalThis.NJOW_DEV === false ? { boot: bootStats }
    : { fps: 0, frameMs: 0, cpuMs: 0, drawCalls: 0, triangles: 0, programs: 0, geometries: 0, textures: 0, exposure: 0, quality: tierName, view: startView, pixelRatio: 1, px: 0, adaptive: false, boot: bootStats };
  globalThis.NJOW_DEV === false || (window.__sceneStats = stats);
  const updateStats = globalThis.NJOW_DEV === false ? null : (realDt, cpuMs) => {
    const k = realDt > 0 ? 1 - Math.exp(-realDt / 0.5) : 1, info = renderer.info;
    stats.frameMs += (realDt * 1000 - stats.frameMs) * k;
    stats.fps = stats.frameMs > 0 ? 1000 / stats.frameMs : 0;
    stats.cpuMs += (cpuMs - stats.cpuMs) * k;
    Object.assign(stats, {
      drawCalls: info.render.calls, triangles: info.render.triangles, programs: info.programs?.length ?? 0,
      geometries: info.memory.geometries, textures: info.memory.textures, exposure: ctx.post?.exposure ?? renderer.toneMappingExposure,
      quality: state.quality, view: rig.view, pixelRatio: renderer.getPixelRatio(), px: world.px, adaptive: gov.active,
    });
  };

  const updateModules = (dt, t) => {
    if (ctx.clock) safeCall('clock', 'update', () => ctx.clock.update(dt));
    for (const key of UPDATE_ORDER) {
      const m = ctx[key];
      if (!m || !moduleActive(key)) continue;
      const before = scene.children.length;
      safeCall(key, 'update', () => m.update(dt, t, camera));
      if (scene.children.length > before && roots[key]) roots[key].push(...scene.children.slice(before));
    }
  };
  const shadowFocus = new THREE.Vector3(0, SHADOW_FOCUS_Y, 0), focusCandidate = new THREE.Vector3();
  // The substation is a focus candidate too, at the centre of its bounding box (farm report: it
  // never received shadows when looked at).
  const substationFocus = ctx.farm?.substation ? new THREE.Box3().setFromObject(ctx.farm.substation).getCenter(new THREE.Vector3()) : null;
  let shadowExtent = null;               // null: the atmosphere's default (SHADOW.halfExtent)
  const updateShadowFocus = () => {
    if (typeof ctx.atmosphere?.setShadowFocus !== 'function') return;
    const turbines = ctx.farm?.turbines ?? [];
    const baseOf = (tb) => (Number.isFinite(tb.baseY) ? tb.baseY : 0);
    const nearest = (p, reach) => {
      let best = null, bestD2 = reach * reach;
      for (const tb of turbines) {
        const d2 = (tb.x - p.x) ** 2 + (tb.z - p.z) ** 2;
        if (d2 < bestD2) { bestD2 = d2; best = tb; }
      }
      return { best, d2: bestD2 };
    };
    let extent = null;
    const cam = camera.position, close = nearest(cam, SHADOW_CLOSE_RANGE).best;
    if (close) {
      const h = clamp(Math.round((cam.y - baseOf(close)) / SHADOW_CLOSE_STEP) * SHADOW_CLOSE_STEP, SHADOW_CLOSE_STEP, 260);
      focusCandidate.set(close.x, baseOf(close) + h, close.z);
      extent = SHADOW_CLOSE_EXTENT;
    } else {
      const pivot = rig.controls.target;
      const { best, d2 } = nearest(pivot, SHADOW_FOCUS_REACH);
      const subD2 = substationFocus ? (substationFocus.x - pivot.x) ** 2 + (substationFocus.z - pivot.z) ** 2 : Infinity;
      if (subD2 < d2) focusCandidate.copy(substationFocus);
      else if (best) focusCandidate.set(best.x, baseOf(best) + SHADOW_FOCUS_Y, best.z);
      else focusCandidate.set(Math.round(pivot.x / SHADOW_FOCUS_GRID) * SHADOW_FOCUS_GRID, SHADOW_FOCUS_Y / 2, Math.round(pivot.z / SHADOW_FOCUS_GRID) * SHADOW_FOCUS_GRID);
    }
    if (!focusCandidate.equals(shadowFocus) || extent !== shadowExtent) {
      shadowFocus.copy(focusCandidate);
      shadowExtent = extent;
      safeCall('atmosphere', 'setShadowFocus', () => ctx.atmosphere.setShadowFocus(shadowFocus, extent ?? undefined));
    }
  };
  // Camera accessories: the polarizer follows the camera height (see CPL). U.uPolarizer is the shared
  // contract; an ocean that still keeps its own uniform is told through setPolarizer as well.
  const updateCameraAccessories = () => {
    const p = camera.position;
    // (the ramp in 1/32 steps: every change re-renders the atmosphere's sky-view LUT)
    const want = state.toggles.cpl ? CPL.strength * Math.round(32 * smoothstep(CPL.fromH, CPL.toH, p.y + curvatureDrop(p.x, p.z))) / 32 : 0;
    if (want === U.uPolarizer.value) return;
    U.uPolarizer.value = want;
    const ocean = ctx.ocean;
    if (typeof ocean?.setPolarizer === 'function' && ocean.uniforms?.uPolarizer !== U.uPolarizer) safeCall('ocean', 'setPolarizer', () => ocean.setPolarizer(want));
  };
  renderFrame = (realDt) => {
    if (ctx.post && !broken.has('post')) safeCall('post', 'render', () => ctx.post.render(realDt, { snap: state.frozen && !P.capture }));
    else renderer.render(scene, camera);
  };
  stepFrame = (realDt, simDt) => {
    const dt = state.frozen ? 0 : simDt;
    if (!state.frozen) U.uTime.value += dt;
    const t = U.uTime.value;
    renderer.info.reset();
    rig.update(realDt, dt, t);
    U.uCameraPos.value.copy(camera.position);
    updateCameraAccessories();
    updateShadowFocus();
    updateModules(dt, t);
    renderFrame(realDt);
    world.frame++;
    world.t = t;
  };

  // Adaptive resolution: see ADAPT.
  gov.active = world.params.q === 'auto' && !P.freeze && !P.capture && !P.size;
  const adapt = (realDt) => {
    if (!gov.active || realDt <= 0 || realDt >= 0.1) return;
    const ms = realDt * 1000;
    gov.ema += (ms - gov.ema) * ADAPT.emaK;
    if (gov.ema > ADAPT.slowMs) { gov.slow += realDt; gov.fast = 0; } else if (gov.ema < ADAPT.fastMs) { gov.fast += realDt; gov.slow = 0; } else { gov.slow = 0; gov.fast = 0; }
    const [base, cap] = pixelRatioRange(ctx.quality, ...stageSize());
    const maxScale = cap / base;
    let next = gov.scale;
    if (gov.slow > ADAPT.slowS && gov.scale > ADAPT.min) next = Math.max(ADAPT.min, gov.scale - ADAPT.step);
    else if (gov.fast > ADAPT.fastS && gov.scale < maxScale - 1e-6) next = Math.min(maxScale, gov.scale + ADAPT.step);
    if (next !== gov.scale) { gov.scale = next; gov.slow = 0; gov.fast = 0; gov.ema = 16.7; resize(); }
  };

  let readyFrames = 0;
  let readyWaitStart = 0;
  function frame(timestamp) {
    if (!running || compiling) return;
    const f0 = globalThis.NJOW_DEV === false ? 0 : performance.now();
    timer.update(timestamp);
    const realDt = Math.min(0.1, timer.getDelta());
    stepFrame(realDt, realDt);
    if (ctx.ui) safeCall('ui', 'update', () => ctx.ui.update(realDt, U.uTime.value, camera));
    globalThis.NJOW_DEV === false || updateStats(realDt, performance.now() - f0);
    adapt(realDt);
    // Some browsers (and device emulation) change devicePixelRatio without firing the media query.
    if ((world.frame & 31) === 0 && (window.devicePixelRatio || 1) !== lastDpr) onDpr();

    if (!state.ready) {
      // Ready after two complete frames with the atmosphere's LUTs/env built (an atmosphere that
      // exposes `ready === false` holds this back for up to 10 s).
      if (ctx.atmosphere?.ready !== false || performance.now() - readyWaitStart > 10000) readyFrames++;
      if (readyFrames >= 2) markReady();
    }
  }
  function markReady() {
    if (state.ready) return;
    state.ready = true;
    globalThis.NJOW_DEV === false || (stats.boot.readyMs = since(t0));
    window.__sceneReady = true;
    window.__ready = true;
    if (globalThis.NJOW_DEV !== false) {
      overlay?.finish(!state.uiVisible || reducedMotion);
      const panel = byId('panel');
      if (panel) panel.hidden = !state.uiVisible;
    }
  }

  // Graphics context loss: stop drawing; when the browser gives the context back, reload with the
  // current state in the URL (every render-target product, LUTs, PMREM and FFT, would be garbage).
  // On a host page the host decides (it shows its recording if the context does not come back).
  const onLost = (e) => {
    e.preventDefault();
    running = false;
    renderer.setAnimationLoop(null);
    globalThis.NJOW_DEV === false || overlay?.fail('The graphics context was lost. Waiting for it to come back…', () => location.replace(stateUrl()));
  };
  const onRestored = () => {
    if (stopped) return;
    globalThis.NJOW_DEV === false || overlay?.fail('Restoring graphics…');
    if (globalThis.NJOW_DEV === false || HOSTED) location.reload();
    else location.replace(stateUrl());
  };
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);
  cleanups.push(() => { canvas.removeEventListener('webglcontextlost', onLost); canvas.removeEventListener('webglcontextrestored', onRestored); });

  // Size from the stage (not the window). The observer is created here, unguarded: a host that
  // cannot provide one gets a boot error, not a silently unsized canvas.
  ro = new ResizeObserver(() => resize());
  ro.observe(stage);
  // A device-pixel-ratio change alone (window moved between displays) fires no resize.
  let dprQuery = null;
  const watchDpr = () => {
    dprQuery?.removeEventListener('change', onDpr);
    dprQuery = matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    dprQuery.addEventListener('change', onDpr);
  };
  let lastDpr = window.devicePixelRatio || 1;
  function onDpr() { lastDpr = window.devicePixelRatio || 1; resize(); watchDpr(); }
  watchDpr();
  cleanups.push(() => dprQuery?.removeEventListener('change', onDpr));

  // 4. Pre-warm: one update pass so every module has built its per-frame objects, then compile
  // every program against the composer's HDR target (render-target programs differ from canvas
  // ones: no tone mapping, linear output), including objects hidden right now (night lamps, empty
  // instanced meshes) and the shadow-depth variants of every caster, so no view, time of day or
  // quality switch compiles on first use.
  // The modules update once before the rig's first frame: the rig's keep-out clamp tests the vessels'
  // current poses, and before their first update the crew boat sits where its constructor left it,
  // not where setView('deck') seeked it; ?view=deck then booted 5.9 m sideways (bearing 35° instead
  // of the landing's 20°) with the ID split at the TP limb (p1 integration, shots/p1v-deck-*).
  updateModules(0, U.uTime.value);
  rig.update(0, 0, U.uTime.value);
  U.uCameraPos.value.copy(camera.position);
  updateCameraAccessories();
  updateShadowFocus();
  updateModules(0, U.uTime.value);

  async function prewarmPrograms(label) {
    running = false;
    renderer.setAnimationLoop(null);
    const hidden = [], culled = [];
    scene.traverse((o) => {
      if (!o.visible) { hidden.push(o); o.visible = true; }
      if (o.castShadow && o.frustumCulled) { culled.push(o); o.frustumCulled = false; }
    });
    const c0 = globalThis.NJOW_DEV === false ? 0 : performance.now();
    // Progress for the standalone page's loading overlay and panel (a host bundle has neither).
    const report = globalThis.NJOW_DEV === false ? null : () => {
      state.busy = `${label}…`;
      const total = renderer.info.programs.length, ready = renderer.info.programs.reduce((n, q) => n + (q.isReady() ? 1 : 0), 0);
      progress('compile', total ? ready / total : 0, `${label} · ${ready} of ${total} programs ready · ${((performance.now() - c0) / 1000).toFixed(1)} s`);
    };
    report?.();
    const ticker = report && setInterval(report, 100);
    try {
      renderer.setRenderTarget(ctx.post ? ctx.post.sceneTarget : null);
      const p = renderer.compileAsync(scene, camera);
      renderer.setRenderTarget(null);
      const pp = ctx.post?.compileAsync?.() ?? null;
      report?.();
      await guard(Promise.all([p, pp]));
      await guard(nextFrame());
      if (!stopped) {
        // Shadow-depth programs are built by the shadow pass, not by compile(): draw the scene once
        // (into the HDR target; the next real frame overwrites it) with every caster included.
        const r0 = globalThis.NJOW_DEV === false ? 0 : performance.now(), n0 = renderer.info.programs.length;
        for (const l of [ctx.atmosphere?.sunLight, ctx.atmosphere?.moonLight]) if (l?.shadow) l.shadow.needsUpdate = true;
        renderer.setRenderTarget(ctx.post ? ctx.post.sceneTarget : null);
        renderer.render(scene, camera);
        globalThis.NJOW_DEV === false || (bootStats.lastPrewarmRenderMs = since(r0));
        // programs only the draw built (shadow-depth variants and anything compile() cannot see)
        if (globalThis.NJOW_DEV !== false) bootStats.lastPrewarmNew = renderer.info.programs.slice(n0).map((q) => `${q.name}|${q.cacheKey.slice(0, 48)}`);
      }
    } catch (err) {
      console.error('[shell] shader pre-compile failed; programs will compile when used.', err);
    } finally {
      clearInterval(ticker);
      for (const o of hidden) o.visible = false;
      for (const o of culled) o.frustumCulled = true;
      renderer.setRenderTarget(null);
      state.busy = null;
    }
    globalThis.NJOW_DEV === false || (bootStats.lastCompileMs = since(c0));
    if (!stopped && booted && !P.capture) { running = true; renderer.setAnimationLoop(frame); }
  }

  globalThis.NJOW_DEV === false || progress('compile', 0, 'Compiling shaders');
  await prewarmPrograms('Compiling shaders');
  if (stopped) return;
  globalThis.NJOW_DEV === false || (bootStats.compiledAt = since(t0));
  globalThis.NJOW_DEV === false || progress('frame', 0, `Rendering the opening frame · ${renderer.info.programs.length} programs ready`);
  readyWaitStart = performance.now();
  booted = true;

  if (P.capture) {
    // Capture: no loop; frames are stepped by __app.advance(). Draw the opening frame now.
    stepFrame(0, 0);
    await guard(ctx.post?.meterPass.lastRead);
    stepFrame(0, 0);
    await guard(ctx.post?.meterPass.lastRead);
    markReady();
  } else {
    running = true;
    renderer.setAnimationLoop(frame);
  }
  if (missing.length) console.info('[shell] running without:', missing.map((m) => `${m.key} (${m.reason})`).join(', '));
}

function bootFailed(err) {
  if (stopped) { window.__ready = true; return; }
  console.error('[shell] the scene failed to start.', err);
  window.__bootError = String(err?.stack || err);
  window.__ready = true;
  // The message is for the standalone page's overlay (a host shows its own fallback).
  if (globalThis.NJOW_DEV !== false && !HOSTED) {
    (overlay ?? new LoadingOverlay()).fail(createError
      ? 'This scene needs WebGL 2, which this browser or device does not provide.'
      : `The scene failed to start: ${err?.message ?? err}`);
  }
}

bootPromise = boot().then(() => { if (stopped) window.__ready = true; }, bootFailed);
