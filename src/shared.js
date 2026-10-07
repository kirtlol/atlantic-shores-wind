// Shared runtime state for every module. Owned by the lead; do not fork these objects.
// Units: metres, seconds. Axes: +X east, +Y up, +Z south (-Z north). Origin: hero turbine
// foundation axis at mean sea level. Colours in uniforms are LINEAR (scene-referred HDR).
import * as THREE from 'three';

export const EARTH_R = 6371000;

// Earth curvature: the mean sea surface at (x, z) sits this far below y = 0.
// Every object that rests on or floats at the sea surface adds -curvatureDrop(x, z) to its y,
// and the ocean shader applies the same formula per vertex.
export function curvatureDrop(x, z) { return (x * x + z * z) / (2 * EARTH_R); }
export const CURVATURE_GLSL = /* glsl */`
float curvatureDrop(vec2 xz) { return dot(xz, xz) / (2.0 * ${EARTH_R.toFixed(1)}); }
`;

// Compass azimuth (degrees clockwise from north) -> unit vector on the XZ plane.
export function azimuthToDir(azDeg, out = new THREE.Vector3()) {
  const a = THREE.MathUtils.degToRad(azDeg);
  return out.set(Math.sin(a), 0, -Math.cos(a));
}
// Compass azimuth + elevation (degrees) -> unit world vector.
export function azElToDir(azDeg, elDeg, out = new THREE.Vector3()) {
  const a = THREE.MathUtils.degToRad(azDeg), e = THREE.MathUtils.degToRad(elDeg);
  return out.set(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e));
}

// Render layers. Layer 0 = main camera. Anything that should show in the ocean's planar
// reflection calls obj.layers.enable(LAYER_REFLECT) (turbines, substation, vessels, lights,
// birds, splashes). The sky and the ocean itself stay off it: the ocean evaluates sky
// reflection analytically.
export const LAYER_REFLECT = 1;

// Global uniforms. Every material that needs time, sun, moon, sky, fog or wind references
// these exact objects (never copies), so one write updates the whole scene.
export const U = {
  uTime:            { value: 0 },                          // animation seconds (monotonic, frozen with ?freeze=1)
  uSunDir:          { value: new THREE.Vector3(0, 1, 0) }, // unit, toward the sun (can be below horizon)
  uSunIlluminance:  { value: new THREE.Color(0, 0, 0) },   // linear RGB sunlight at sea level after atmosphere (0 at night)
  uMoonDir:         { value: new THREE.Vector3(0, -1, 0) },
  uMoonIlluminance: { value: new THREE.Color(0, 0, 0) },   // linear RGB moonlight at sea level (tiny)
  uMoonPhase:       { value: 0.5 },                        // 0 new, 0.5 full, 1 new
  uNight:           { value: 0 },                          // 0 = day, 1 = full night (sun < -12 deg)
  uSkyLUT:          { value: null },                       // THREE.Texture: sky radiance lookup, owned by atmosphere
  uTransmittanceLUT:{ value: null },                       // optional, owned by atmosphere
  uStarRotation:    { value: new THREE.Matrix3() },        // sidereal rotation for the star field
  uExposureHint:    { value: 1 },                          // atmosphere's suggested auto-exposure scale (post may use it)
  // Aerial perspective (fog). applyAerialPerspective() in the atmosphere GLSL uses these.
  uFogDensity:      { value: 1.2e-4 },                     // extinction per metre at sea level
  uFogHeightFalloff:{ value: 1 / 1200 },                    // 1/scale height of the haze layer (metres)
  uFogInscatter:    { value: new THREE.Color(0.6, 0.7, 0.8) }, // average horizon in-scatter radiance (linear)
  // Clouds (one procedural layer; sky, ocean reflection, and cloud shadows all read these).
  uCloudCover:      { value: 0.28 },                       // 0..1
  uCloudAltitude:   { value: 1100 },                       // metres
  uCloudThickness:  { value: 300 },
  uCloudOffset:     { value: new THREE.Vector2() },        // drift in metres (advected by wind aloft)
  uCloudScale:      { value: 1 },
  // Wind and sea.
  uWind:            { value: new THREE.Vector2(1.58, -4.22) },    // m/s at 10 m, vector the air moves TOWARD (x east, y = +Z south)
  uWindSpeed:       { value: 4.5 },                          // m/s at 10 m
  // Camera (some shaders want it in world space without relying on cameraPosition in RTs).
  uCameraPos:       { value: new THREE.Vector3() },
  // Camera polarizing filter strength 0..1 (drone CPL). Written by Post/UI; the atmosphere darkens the
  // polarized clear sky and the ocean attenuates polarized sky reflection with it (added 2026-09-30).
  uPolarizer:       { value: 0 },
};

// Deterministic PRNG. Use this, never Math.random, for anything that affects layout or
// look (so ?seed=N screenshots are reproducible). Math.random is fine only for purely
// transient particle jitter.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// URL parameters (read once). See ARCHITECTURE.md for the list.
export const PARAMS = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
export function param(name, fallback) {
  const v = PARAMS.get(name);
  if (v === null || v === '') return fallback;
  if (typeof fallback === 'number') { const n = parseFloat(v); return Number.isFinite(n) ? n : fallback; }
  if (typeof fallback === 'boolean') return v === '1' || v === 'true';
  return v;
}

// Scale registry: every module registers the real-world size of each thing it builds, so
// window.__scene.scaleReport() can compare the measured bounding box with the reference.
// register({ name, object3D | geometry | measure(): {x,y,z}, expect: { axis:'y'|'x'|'z'|'max', metres, tolerance } , source })
export const SCALE_REGISTRY = [];
export function registerScale(entry) { SCALE_REGISTRY.push(entry); }
