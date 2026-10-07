// The sea-surface ShaderMaterial (owner: ocean).
//
// Vertex: polar grid around the camera (ocean-mesh.js), world-space FFT displacement from the two
// geometry cascades with mip-level band-limiting to the local vertex spacing, boil domes, run-up on
// the weather side of piles, the vessel wave field (ocean-wake.js), Earth curvature,
// camera-relative positions (float precision out to 150 km), logarithmic (or reversed-Z) depth;
// per-vertex aerial perspective and cloud shadow (both vary over hundreds of metres).
//
// Fragment (all linear HDR radiance):
//   normal     LEAN slope moments of every cascade (mean + variance survive mip filtering), slick /
//              cat's-paw and wave-group modulation of the short bands, their hydrodynamic
//              modulation by the long-wave phase (the capillaries stay in the BRDF: a copy of the short
//              cascade 7.7x smaller tiled into a glittery normal-map look close up, round 4), ring
//              ripples (splash map + analytic), boil domes, Kelvin wakes, turbulent facets in
//              churned water, Earth curvature
//   sky        the filtered sea BRDF (Bruneton, Neyret & Holzschuch 2010) integrated over the
//              Smith-visible slope distribution with three quadrature nodes: per node the exact
//              Fresnel (s and p), the camera polarizer acting on partially polarised skylight,
//              its own reflected ray into the skyRadiance() panorama, masking of low rays by the
//              next wave (which then mirrors the sea)
//   planar     LAYER_REFLECT mirror image (log-coded, with depth), placed by the band-limited
//              long-wave normal scaled by the reflected object's parallax, spread along the mirror
//              vertical by the remaining slopes, near lamps as discrete glints
//   glint      anisotropic Beckmann BRDF for sun, moon and distant lamps (ocean-lights.js), broken
//              into Poisson-distributed glints where a pixel holds few specular points
//   water      upwelling π·Rrs of FU-4 NJ water × downwelling irradiance (tinted over bait pods),
//              turquoise aerated water under foam and wakes, forward scatter through backlit crests
//   foam       whitecaps in two stages (gathered on the dominant crests), wind streaks, spindrift,
//              pile wash, strikes, wake trails: densities turned into coverage by a three-octave
//              bubble lace that stays unbiased at any range
//   aerial     perspective last
import * as THREE from 'three';
import { CURVATURE_GLSL, EARTH_R } from '../shared.js';
import { cascadeSamplingGLSL } from './ocean-fft.js';
import { SKY_MAP_GLSL } from './ocean-textures.js';
import { SEA } from '../config.js';
import { MAX_DISTURBANCES, MAX_PILES, RIPPLE_G, RIPPLE_T, RIPPLE_CG_MAX, BOIL_DOME_M, BOIL_ENVELOPE_GLSL, PILE_WASH, TRAIL_GLSL, TRAIL_HALF } from './ocean-effects.js';
import { WAKE_GLSL } from './ocean-wake.js';
import { RING_GLSL } from './ocean-splash.js';
import { LIGHTS_GLSL, DISTANT_MIN_DISTANCE } from './ocean-lights.js';
import { MAX_LIFE_PATCHES } from './ocean-life.js';
import { TURBINE } from '../config.js';

// a GLSL float literal, as short as it can be (7 significant digits)
const F = (x) => { const s = String(+Number(x).toPrecision(7)); return /[.e]/.test(s) ? s : s + '.0'; };
// Turbine silhouette for the analytic sea shadows (SCENE-SPEC §4.2 / §4.5: TP to 21.5 m, tower
// 10.0 -> 7.5 m wide up to 146.4 m, nacelle 9 m wide to 158.4 m).
const TURBINE_SHADOW = {
  tpTop: TURBINE.stack.tpTop, towerTop: TURBINE.stack.towerTop, top: TURBINE.stack.nacelleRoof,
  towerBaseR: TURBINE.tower[0][1] / 2, towerTopR: TURBINE.tower[TURBINE.tower.length - 1][1] / 2, nacelleR: TURBINE.nacelle.width / 2 + 0.5,
};
const SEA_IOR = SEA.ior;
// Specular points of the capillary wavelets per m² at the centre of the sun's glitter lobe
// (ESTIMATED: ~1000 wavelets of 2-5 cm per m², a good fraction of them holding a point of the
// most probable glinting slope).
const GLINT_DENSITY = 400;
// A lamp is a point: each specular point shows it at a brightness set by the facet's curvature
// (∝ its radii), so the capillaries' many glints are a faint haze and what a camera records of a lamp's
// glitter column are the few bright glints of the metre-scale waves (ESTIMATED ~0.15 per m² at the lobe
// centre, 1/λ² for 2-3 m waves): the columns break into stippled glints, sparse toward their ends,
// instead of smooth pillars.
const LAMP_GLINT_DENSITY = 0.15;
// Radiance of the sea seen by a reflected ray that the next wave masks, relative to the sky at the
// ray's (clamped) elevation near the horizon: the grazing sea radiance, ~0.2-0.3 of the horizon sky
// (numerical integral of the rough-surface reflection at 0.1-1° grazing, σ 0.11: 0.25).
const SEA_SELF = 0.25;
// Scale height (m) of the spray layer a gale lifts over the sea (spindrift and spume, ESTIMATED: most of
// the spume mass within ~5-10 m of the surface).
const SPRAY_H = 6;
// Saturation of the hydrodynamic modulation: a crest's short waves hold at most this many times their
// mean variance (ESTIMATED: microbreaking caps them on the forward faces; uncapped, a Kelvin crest's
// ripples spread the sun's glitter into a milky sheet).
const HYDRO_CAP = 8;

// Uniforms the ocean needs from shared U; each is declared only if the atmosphere GLSL has not.
const SHARED_UNIFORMS = [
  ['vec3', 'uSunDir'], ['vec3', 'uSunIlluminance'], ['vec3', 'uMoonDir'], ['vec3', 'uMoonIlluminance'], ['float', 'uTime'],
  ['float', 'uWindSpeed'],
];
export function declaredIn(glsl, name) { return new RegExp(`uniform\\s+\\w+\\s+(\\w+\\s*,\\s*)*${name}\\b`).test(glsl); }

// atmosCore: the atmosphere's vertex-safe GLSL core (ctx.atmosphere.glslCore). When present the
// aerial perspective is evaluated per vertex: haze varies over hundreds of metres while the grid
// is dense where the view is close, so interpolating transmittance and in-scatter is exact to the
// eye, and it takes the atmosphere's per-pixel LUT lookup out of the most expensive shader here.
function vertexShader(n, atmosCore) {
  return /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>
${atmosCore ? `#define OC_VERTEX_AERIAL\n${atmosCore}` : ''}
${CURVATURE_GLSL}
${cascadeSamplingGLSL(n)}
${BOIL_ENVELOPE_GLSL}
${WAKE_GLSL}
attribute vec2 aGrid;
uniform vec4 uRing;          // s0, ln(1+a), a, rings
uniform vec4 uGrid;          // heading angle (rad, in the xz plane), warp β, segments, lod scale
uniform vec2 uCamQ;          // camera xz relative to the snap origin
uniform vec2 uSnap;          // snap origin, world xz
uniform sampler2D uDisp0;
uniform sampler2D uDisp1;
uniform vec4 uDistA[${MAX_DISTURBANCES}];
uniform vec4 uDistB[${MAX_DISTURBANCES}];
uniform int uDistCount;
uniform vec4 uDistBound;     // bounds of the analytic list (x0, z0, x1, z1), snap frame
uniform vec4 uPiles[${MAX_PILES}];
uniform int uPileCount;
uniform vec2 uWaveDir;       // mean direction the waves travel toward (wind sea + swell)
uniform float uEtaStd;
uniform mat4 uMirrorMatrix;  // camera-relative world -> mirror texture (projective)
uniform float uMirrorPlaneRel;
uniform float uSpray;        // near-surface spray extinction (1/m) in a layer of SPRAY_H scale height
varying vec2 vQ;
varying vec3 vRel;
varying float vEta;
varying vec4 vMirror;
#ifdef OC_VERTEX_AERIAL
varying vec3 vAerT;          // haze transmittance camera -> surface
varying vec3 vAerS;          // haze in-scatter along that path (absolute radiance)
varying float vShadow;       // cloudShadow() of the key light: it varies over ~100 m
#endif

float ocDomeHeight(vec2 p) {
  float h = 0.0;
  if (p.x < uDistBound.x || p.x > uDistBound.z || p.y < uDistBound.y || p.y > uDistBound.w) return 0.0;
  // uniform loop bounds: the compiler cannot unroll these (keeps the shader small)
  for (int i = 0; i < uDistCount; i++) {
    vec4 B = uDistB[i];
    if (abs(B.w - 1.0) > 0.5) continue;              // boils only
    vec4 A = uDistA[i];
    vec2 d = (p - A.xy) / A.z;
    float r2 = dot(d, d);
    if (r2 > 9.0) continue;
    h += ${F(BOIL_DOME_M)} * A.w * ocBoilEnvelope(B.x, B.y) * exp(-r2);
  }
  return h;
}
// Run-up on the weather side of a pile: the incident crest climbs the wall (reflection from a
// kD ≈ 3 cylinder); the lee is sheltered. eta: the undisturbed surface height here.
float ocRunup(vec2 p, float eta) {
  float h = 0.0;
  for (int i = 0; i < uPileCount; i++) {
    vec4 pl = uPiles[i];
    vec2 dp = p - pl.xy;
    float rr = length(dp), d = rr - pl.z;
    if (d > 6.0 || d < -0.5) continue;
    float face = max(0.0, dot(dp / max(rr, 1e-3), -uWaveDir));
    h += max(eta, 0.0) * ${F(PILE_WASH.runup)} * face * exp(-max(d, 0.0) / ${F(PILE_WASH.runupM)});
  }
  return h;
}

void main() {
  float u = aGrid.y > 0.99999 ? 0.0 : aGrid.y;       // closing column == first column (no seam)
  float g = exp(aGrid.x * uRing.y);
  float r = uRing.x * (g - 1.0) / uRing.z;
  float dr = uRing.x * g;
  float x = 2.0 * u - 1.0;
  float beta = uGrid.y;
  float th = uGrid.x + PI * (x * (1.0 - beta) + beta * x * x * x);
  float dth = PI * (1.0 - beta + 3.0 * beta * x * x) * 2.0 / uGrid.z;
  vec2 rel = r * vec2(cos(th), sin(th));
  vec2 q = uCamQ + rel;
  float spacing = max(dr, r * dth);
  // displacement, band-limited so every displaced wavelength spans several vertices
  vec3 d = textureLod(uDisp0, ocCascadeUv(0, q), log2(max(uGrid.w * spacing / uOcCas[0].w, 1.0))).xyz;
  d += textureLod(uDisp1, ocCascadeUv(1, q), log2(max(uGrid.w * spacing / uOcCas[1].w, 1.0))).xyz;
  vec2 pd = q + d.xz;
  float dome = uDistCount > 0 ? ocDomeHeight(pd) : 0.0;
  float runup = uPileCount > 0 ? ocRunup(pd, d.y) : 0.0;
  float wake = uWakeCount > 0 ? ocWake(pd, uGrid.w * spacing, true).x : 0.0;
  vec2 wxz = pd + uSnap;
  float y = d.y + dome + runup + wake - curvatureDrop(wxz);
  vec3 rel3 = vec3(rel.x + d.x, y - cameraPosition.y, rel.y + d.z);
  vQ = q;
  vRel = rel3;
  vEta = d.y + dome + runup + wake;
  gl_Position = projectionMatrix * vec4(mat3(viewMatrix) * rel3, 1.0);
  #include <logdepthbuf_vertex>
  vMirror = uMirrorMatrix * vec4(rel3.x, uMirrorPlaneRel, rel3.z, 1.0);
#ifdef OC_VERTEX_AERIAL
  // atmAerial() of the atmosphere, split into the two terms the fragment shader combines
  float dist = length(rel3);
  vAerT = exp(-uAtmFogRGB * atmHazePath(cameraPosition, cameraPosition + rel3));
  vec3 airlight = dist > 1e-3 ? atmHazeColour(rel3 / dist) : vec3(0.0);
  vAerS = airlight * (1.0 - vAerT);
  // a gale's spray layer over the sea veils it toward the horizon: the path through an exponential
  // layer (SPRAY_H) from the camera height hc down to the water
  if (uSpray > 0.0) {
    float hc = max(-rel3.y, 0.5);
    float Ts = exp(-uSpray * dist * ${F(SPRAY_H)} / hc * (1.0 - exp(-hc / ${F(SPRAY_H)})));
    vAerS += vAerT * airlight * (1.0 - Ts);
    vAerT *= Ts;
  }
  vShadow = cloudShadow(cameraPosition + rel3);
#endif
}`;
}

function fragmentShader(n, atmosGlsl, vertexAerial) {
  const missing = SHARED_UNIFORMS.filter(([, name]) => !declaredIn(atmosGlsl, name)).map(([t, name]) => `uniform ${t} ${name};`).join('\n');
  const needCurv = !/float\s+curvatureDrop\s*\(/.test(atmosGlsl);
  // Render targets written through the atmosphere (the mirror, the sky probe) hold PRE-EXPOSED
  // colours when the atmosphere pre-exposes (uAtmPre); everything here is absolute until
  // applyAerialPerspective(), so those samples are divided back.
  const pre = declaredIn(atmosGlsl, 'uAtmPre') ? 'uAtmPre' : '1.0';
  return /* glsl */`
#include <logdepthbuf_pars_fragment>
${vertexAerial ? '#define OC_VERTEX_AERIAL' : ''}
${declaredIn(atmosGlsl, 'uAtmAmbTex') ? '#define OC_AMB' : ''}
#ifndef PI
#define PI 3.141592653589793
#endif
#ifndef saturate
#define saturate( a ) clamp( a, 0.0, 1.0 )
#endif
${atmosGlsl}
${missing}
${needCurv ? CURVATURE_GLSL : ''}
${cascadeSamplingGLSL(n)}
${BOIL_ENVELOPE_GLSL}
${RING_GLSL(RIPPLE_G, RIPPLE_T)}
${TRAIL_GLSL}
${WAKE_GLSL}
#define OC_CASCADES ${n}
#define OC_PRE ${pre}
${SKY_MAP_GLSL}
uniform sampler2D uDisp0;      // (shared with the vertex stage: no extra texture unit)
uniform sampler2D uDisp1;
uniform sampler2DArray uSlopeA; // slope moments (sx, sz, sx², sz²), one layer per cascade
uniform sampler2DArray uFoamA;  // whitecap foam state (stage A, streak, J, stage B), cascades 0-1
uniform sampler2D uFoamTex;    // R/G bubbles (equalised), B streak noise, A slick field
uniform sampler2D uSkyMap;     // skyRadiance() panorama (pre-exposed), see SkyReflectionMap
uniform sampler2D uMirror;
uniform sampler2D uMirrorDist;  // (coverage · 1000 / view distance, coverage), mip-mapped (ocean-reflection.js)
uniform sampler2D uFxMap;     // left: trails (foam, aeration, slick, flow direction), warped extent;
                               // right: splashes (white water, aeration, ring slope x, z) round the action
uniform vec4 uSplashArea;      // centre x, z (snap), 1 / size, on
uniform vec2 uSnap;
uniform vec2 uSubgrid;       // unresolved (Cox-Munk minus resolved) slope variance, x and z
uniform float uShortOn;      // the short cascade is computed (not on Low)
uniform vec4 uSlickP;        // 1/tile, short-wave amplitude swing, drift x, drift z
uniform vec3 uGroup;         // wave-group amplitude swing, along-wind drift (m), 2-15 m slope gain (ocean.js band1GainFor)
uniform vec2 uWindDir;
uniform vec2 uWaveDir;       // mean direction the waves travel toward
uniform float uEtaStd;
uniform vec4 uHydro;         // short-wave modulation: log-std, 1 / 2-15 m slope std along the wind, 1 / peak wavelength, 0.3 / elevation std
uniform float uStreakGain;   // wind streak visibility (0 below ~8 m/s)
uniform float uWhitecapsOn;   // 0 off, else the visible-cover gain
uniform vec3 uUpwelling;     // π·Rrs
uniform vec3 uAerTint;       // π·R of aerated water (bubble clouds under foam and wakes)
uniform vec3 uSSSColor;
uniform float uFoamAlbedo;
uniform float uPolarizer;
uniform float uMirrorOn;
uniform mat3 uMirrorBasis;   // mirror camera right, up, forward (world)
uniform vec2 uMirrorProj;    // projection (0,0) and (1,1)
uniform vec2 uMirrorSize;    // mirror texture size (px)
uniform float uMirrorL0;     // decode scale of the log-coded mirror colour (pre-exposed radiance)
uniform vec4 uDistA[${MAX_DISTURBANCES}];
uniform vec4 uDistB[${MAX_DISTURBANCES}];
uniform int uDistCount;
uniform vec4 uDistBound;
uniform vec4 uPiles[${MAX_PILES}];
uniform int uPileCount;
uniform vec4 uTrailArea;
uniform vec4 uLifeA[${MAX_LIFE_PATCHES}];
uniform vec4 uLifeB[${MAX_LIFE_PATCHES}];
uniform vec4 uLifeC[${MAX_LIFE_PATCHES}];
uniform int uLifeCount;
uniform vec4 uLifeBound;
uniform vec3 uEsky;          // sky irradiance on the sea for atmospheres without an ambient table (dev stubs)
varying vec2 vQ;
varying vec3 vRel;
varying float vEta;
varying vec4 vMirror;
#ifdef OC_VERTEX_AERIAL
varying vec3 vAerT;
varying vec3 vAerS;
varying float vShadow;
#endif

const float OC_EARTH_R = ${EARTH_R.toFixed(1)};
const float OC_GLINT_DENSITY = ${F(GLINT_DENSITY)};
const float OC_SEA_SELF = ${F(SEA_SELF)};
const float OC_HYDRO_CAP = ${F(HYDRO_CAP)};

// Exact dielectric Fresnel of sea water at incidence cosine c: (Rs, Rp).
vec2 ocFresnelSP(float c) {
  c = clamp(c, 1e-3, 1.0);
  const float n = ${F(SEA_IOR)};
  float ct = sqrt(max(1.0 - (1.0 - c * c) / (n * n), 0.0));
  float rs = (c - n * ct) / (c + n * ct), rp = (ct - n * c) / (ct + n * c);
  return vec2(rs * rs, rp * rp);
}
// Reflectance: x unpolarised, y what the camera records. A polarizer set to cut glare (uPolarizer)
// passes the p-polarised reflection only; exposure makes up for the unpolarised light it halves, so
// for unpolarised light (P = 0) the reflection is mix((Rs + Rp)/2, Rp, uPolarizer): near Brewster's
// angle (53° incidence) almost nothing. For partially polarised skylight: degree P, E-vector normal to
// the plane of the ray and the sun (Rayleigh), at cos² c2 to the facet's s direction. The s and p shares of the incident light
// are ½(1 − P) + P·c2 and ½(1 − P) + P·(1 − c2); the polarizer keeps 2 × the p part. The clear sky
// 90° from the sun is ~70 % polarised with its E-vector near horizontal: reflected as s light, it is
// what a polarizer takes out of the sea.
// z: what the camera records of unpolarised light (the planar mirror's towers and hulls, P = 0).
vec3 ocFresnelPol(float c, float P, float c2) {
  vec2 r = ocFresnelSP(c);
  float rs = r.x * (0.5 - 0.5 * P + P * c2), rp = r.y * (0.5 + 0.5 * P - P * c2);
  return vec3(0.5 * (r.x + r.y), mix(rs + rp, 2.0 * rp, uPolarizer), mix(0.5 * (r.x + r.y), r.y, uPolarizer));
}

// ---------------------------------------------------------------- microfacet (Beckmann slopes)
float ocErfc(float x) { return 2.0 * exp(-x * x) / (2.319 * x + sqrt(4.0 + 1.52 * x * x)); }
// Standard normal CDF.
float ocPhi(float x) { float e = 0.5 * ocErfc(abs(x) * 0.70710678); return x < 0.0 ? e : 1.0 - e; }
// Smith Λ for Beckmann slopes of variance s2 along the ray, cos c to the mean normal (rational fit
// of Walter et al. 2007, < 0.5 % error).
float ocLambda(float c, float s2) {
  float v = c / sqrt(max((1.0 - c * c) * 2.0 * s2, 1e-10));
  return v >= 1.6 ? 0.0 : (1.0 - 1.259 * v + 0.396 * v * v) / (3.535 * v + 2.181 * v * v);
}
// Reflected radiance per unit normal irradiance from direction L (Bruneton, Neyret, Holzschuch 2010).
// e: the Gaussian exponent at the half vector (0 at the centre of the glitter lobe).
float ocGlint(vec3 L, vec3 V, vec3 N, vec2 s2, out float e) {
  vec3 Tx = normalize(vec3(N.y, -N.x, 0.0));
  vec3 Ty = cross(Tx, N);
  vec3 H = normalize(L + V);
  float zH = max(dot(H, N), 1e-3);
  float zx = dot(H, Tx) / zH, zy = dot(H, Ty) / zH;
  e = 0.5 * (zx * zx / s2.x + zy * zy / s2.y);
  if (e > 14.0) return 0.0;                        // facet slope > ~5σ away: exp(-14) ≈ 1e-6
  float p = exp(-e) / (2.0 * PI * sqrt(s2.x * s2.y));
  vec2 lt = vec2(dot(L, Tx), dot(L, Ty)); lt *= lt; float sL = dot(lt, s2) / max(lt.x + lt.y, 1e-8);
  vec2 vt = vec2(dot(V, Tx), dot(V, Ty)); vt *= vt; float sV = dot(vt, s2) / max(vt.x + vt.y, 1e-8);
  float zL = max(dot(L, N), 0.01), zV = max(dot(V, N), 0.01);
  float fr = ocFresnelPol(dot(V, H), 0.0, 0.0).z;
  float z2 = zH * zH;
  return fr * p / ((1.0 + ocLambda(zL, sL) + ocLambda(zV, sV)) * 4.0 * zV * z2 * z2);
}
${LIGHTS_GLSL}
// Integer hash of a cell and a time slot, uniform in [0, 1).
float ocHash(vec2 c, float s) {
  uvec2 u = uvec2(ivec2(c));
  uint h = u.x * 0x8da6b343u ^ u.y * 0xd8163841u ^ uint(int(s)) * 0xcb1ab31fu;
  h ^= h >> 16; h *= 0x7feb352du; h ^= h >> 15; h *= 0x846ca68bu; h ^= h >> 16;
  return float(h) * 2.3283064e-10;
}
// Stochastic glitter. The lobe above is the mean; the glints themselves are discrete specular
// points on the capillary wavelets, about OC_GLINT_DENSITY per m² at the lobe centre. Within a
// world-space cell about one pixel wide their number is Poisson with mean mu, so the pixel shows
// k/mu times the mean: near the camera a sparse field of sharp sparkles over a dark base, a
// smooth mean where a pixel holds many (mu > 16, from ~1 km). Cells re-roll at ~15 Hz.
float ocSparkle(float mean, float e, vec2 pq, float foot, float seed, float density) {
  if (mean <= 0.0) return mean;
  float lf = log2(max(foot, 0.004));
  float lvl = floor(lf);
  lvl += step(ocHash(floor(pq / exp2(lvl + 1.0)) + uSnap / exp2(lvl + 1.0), 7.0 + seed), fract(lf));   // dither between two cell sizes
  float c = exp2(lvl);
  float mu = c * c * density * exp(-e);
  float w = 1.0 - smoothstep(2.0, 16.0, mu);
  if (w <= 0.0) return mean;
  vec2 cell = floor(pq / c) + uSnap / c;
  float slot = floor(uTime * 15.0 + 8.0 * ocHash(cell, 3.0 + seed));
  float h = ocHash(cell + vec2(slot * 7.0, 0.0), 11.0 + seed + slot);
  float p = exp(-mu), cdf = p, k = 0.0;
  for (int i = 0; i < 8; i++) { if (h < cdf) break; k += 1.0; p *= mu / k; cdf += p; }
  return mix(mean, mean * k / max(mu, 1e-6), w);
}

// Turbine shadows on the sea, analytic (no shadow-map sampler: the program is at the 16-unit
// limit): each nearby transition piece (radius ≥ 4 m) stands for its turbine, whose TP, tower and
// nacelle are discs of the SCENE-SPEC radii at their heights; a sea point is in shade when the ray
// toward the sun passes within that radius at the height it reaches above the pile. The penumbra
// grows with the sun's 0.53° disc. Blades are left out (thin, moving).
float ocTowerShadow(vec2 p, vec3 sun) {
  if (sun.y < 0.03 || uPileCount == 0) return 1.0;
  float hl = length(sun.xz);
  vec2 sd = -sun.xz / max(hl, 1e-5);                       // shadows fall this way on the sea
  float cotEl = hl / sun.y;
  float sh = 1.0;
  for (int i = 0; i < uPileCount; i++) {
    vec4 pl = uPiles[i];
    if (pl.z < 4.0) continue;
    vec2 d = p - pl.xy;
    float along = dot(d, sd);
    if (along < -pl.z || along > ${F(TURBINE_SHADOW.top)} * cotEl + 10.0) continue;
    float across = abs(dot(d, vec2(-sd.y, sd.x)));
    if (across > 8.0) continue;
    float h = max(along, 0.0) / cotEl;
    float r = h < ${F(TURBINE_SHADOW.tpTop)} ? pl.z
            : (h < ${F(TURBINE_SHADOW.towerTop)} ? mix(${F(TURBINE_SHADOW.towerBaseR)}, ${F(TURBINE_SHADOW.towerTopR)}, (h - ${F(TURBINE_SHADOW.tpTop)}) / ${F(TURBINE_SHADOW.towerTop - TURBINE_SHADOW.tpTop)})
            : (h < ${F(TURBINE_SHADOW.top)} ? ${F(TURBINE_SHADOW.nacelleR)} : 0.0));
    float pen = 0.15 + 0.0047 * h / max(sun.y, 0.05);        // half-width of the penumbra (m)
    sh = min(sh, smoothstep(r - pen, r + pen, across));
  }
  return sh;
}

// ---------------------------------------------------------------- planar reflection
// View distance (mirror camera) of what the mirror holds over a footprint (its coverage-weighted
// harmonic mean; 1e9: nothing). No implicit derivatives: called after a branch.
float ocMirrorD(vec2 d) { return d.y > 1e-4 ? 1000.0 * d.y / max(d.x, 1e-9) : 1e9; }
float ocMirrorW(vec2 uv) { return ocMirrorD(textureLod(uMirrorDist, uv, 0.0).rg); }
// Mirror colour: log-coded (ocean-reflection.js), decoded per tap; alpha = coverage.
vec4 ocMirrorTap(vec2 uv, vec2 dx, vec2 dy) {
  vec4 c = textureGrad(uMirror, uv, dx, dy);
  return vec4(uMirrorL0 * (exp2(c.rgb) - 1.0), c.a);
}
// Reflection of LAYER_REFLECT objects, alpha = coverage (premultiplied: rgb already × coverage).
// A facet tilted by δ in the view plane turns the reflected ray by 2δ; the reflected object at view
// distance wO (surface point at wS) then shifts in the mirror image by Δθ = 2δ (wO − wS) / wO, so
// an object standing in the water (a pile at its waterline, wO ≈ wS) does not move at all and a
// far one moves by the full angle. The shift is therefore scaled by the parallax at the
// undistorted position, and it is taken from the long waves only (Rc: the band-limited normal,
// tilted by the mean visible facet slope): full-resolution 2-15 m slopes changed from pixel to
// pixel and scattered a TP's reflection into confetti at drone range. The shorter slopes and the
// unresolved ones spread the reflection along the mirror vertical (5 taps, weighted by the
// visible-slope density about its mean), with elongated
// hardware-filtered footprints (thin across, tap-long along). Rsharp (full-resolution normal)
// feeds a sharp tap near the camera, where lamps and bright edges break into glints.
vec4 ocMirror(vec3 Rc, vec3 Rsharp, vec3 Rflat, vec3 V, float sAlong, float sAcross, vec2 gBx, vec2 gBy, vec2 pq, float foot) {
  vec2 base = vMirror.xy / vMirror.w;
  float wS = vMirror.w;
  float fwd = max(dot(Rflat, uMirrorBasis[2]), 0.05);
  vec2 perRad2 = 0.5 * uMirrorProj / fwd;                  // mirror-texture uv per radian (x, y)
  // A texel whose object is nearer to the (mirror) camera than this water point is not on the ray
  // reflected here, which leaves the water away from the camera: it reads as empty. Without this the
  // distortion pulled a crew boat's reflection into dark dashes on the water behind the boat.
  // parallax: evaluated at the undistorted position, then once more at the object the shift lands
  // on (a water point beside a pile must not borrow the pile's reflection sideways)
  vec2 shiftC = perRad2 * ((Rc - Rflat) * uMirrorBasis).xy;
  // early out first (most of the sea reflects nothing): one isotropic lookup covering everything
  // the column could reach, from the undistorted point to the full shift plus the widest spread
  float reach = 0.5 * length(shiftC) + min(5.0 * sAlong * perRad2.y, 0.3) + 2.0 / uMirrorSize.y;
  vec4 probe = textureLod(uMirror, base + 0.5 * shiftC, log2(max(reach * uMirrorSize.y, 1.0)) + 0.5);
  if (probe.a + dot(probe.rgb, vec3(1.0)) < 1e-6) return vec4(0.0);
  float wO0 = ocMirrorW(base);
  float par0 = wO0 <= wS ? 0.0 : clamp((wO0 - wS) / wO0, 0.0, 1.0);
  float wO1 = ocMirrorW(base + par0 * shiftC);
  par0 = min(par0, wO1 <= wS ? 0.0 : clamp((wO1 - wS) / wO1, 0.0, 1.0));
  vec2 uv = base + par0 * shiftC;
  float wO = ocMirrorW(uv);
  if (wO <= wS) return vec4(0.0);
  float par = clamp((wO - wS) / wO, 0.02, 1.0);                 // (wO − wS) / wO at the centre tap
  // the reflected ray turns by 2δ in the view plane for a facet tilt δ along the view, and by
  // 2ζ·sin(depression) sideways for a cross tilt ζ: the column's length and width (2.5 σ)
  float halfSpan = min(2.5 * 2.0 * sAlong * par * perRad2.y, 0.3);
  float spU = min(2.5 * 2.0 * sAcross * max(V.y, 0.03) * par * perRad2.x, 0.15);
  vec2 fx = vec2(spU + abs(gBx.x) + abs(gBy.x), 0.0);
  vec4 acc = vec4(0.0);
  float wsum = 0.0;
  float inv2s2 = 0.5 / max(sAlong * sAlong, 1e-6);
  // A pixel holds few wavelet facets close to the camera (~OC_GLINT_DENSITY per m²): which of them catch the
  // reflected object is a matter of chance, so the column breaks into fragments there (each tap takes
  // its facet's own sideways tilt, a narrow footprint at a random offset, and a weight drawn from an
  // exponential, re-rolled at 15 Hz in world-space cells a pixel wide) and is the smooth mean (wide
  // footprints) where a pixel holds many.
  float noisy = 1.0 - smoothstep(4.0, 64.0, foot * foot * OC_GLINT_DENSITY);
  vec2 cell = floor(pq / max(foot, 0.01)) + uSnap / max(foot, 0.01);
  float slot = floor(uTime * 15.0);
  fx.x = mix(fx.x, fx.x - 0.8 * spU, noisy);
  // taps along the mirror vertical weighted by the density of the facet tilt that reaches them (the
  // centre's parallax for all: per-tap parallax aliased into speckles where a tap column crossed a
  // silhouette). The mirror is the view from the mirrored camera, so a tap's footprint can hold what
  // stands NEARER than this water point, which no ray reflected here reaches (it leaves the water away
  // from the camera): a far sea point's taps borrowed the near tower, a soft white column beside it.
  // That part is dropped by the footprint's mean distance.
  vec2 fy = vec2(0.0, 0.5 * halfSpan + abs(gBx.y) + abs(gBy.y));
  for (int k = -2; k <= 2; k++) {
    float o = float(k) * 0.5 * halfSpan;
    float delta = (o / perRad2.y) / (2.0 * par);
    vec2 hc = cell + vec2(slot * 7.0, float(k));
    float w = exp(-delta * delta * inv2s2) * mix(1.0, -log(ocHash(hc, 17.0 + slot) + 1e-3), noisy);
    vec2 t = uv + vec2(noisy * spU * 0.98 * (ocHash(hc, 23.0) + ocHash(hc, 29.0) - 1.0), o);   // (≈ N(0, spU / 2.5))
    acc += ocMirrorTap(t, fx, fy) * (w * smoothstep(0.8, 1.0, ocMirrorD(textureGrad(uMirrorDist, t, fx, fy).rg) / wS));
    wsum += w;
  }
  vec4 col = acc / max(wsum, 1e-6);
  // Sharp tap at the full-resolution distortion (parallax-scaled): a hit on a lamp-bright texel (log
  // code > ~3, i.e. > ~30 exposed units) replaces the column: the log-coded mips average lamps
  // away, so a lamp's reflection is carried by these hits alone, as a column of discrete glints
  // whose density is the chance a facet points at the lamp (the linear mean, without the square
  // mip blocks and the red wash of an averaged lamp).
  // Lamps farther than DISTANT_MIN_DISTANCE draw their columns analytically (ocean-lights.js).
  // (no lamp is lit while the sun is up)
  if (uSunDir.y > 0.1) return col;
  vec2 uvS = base + par0 * perRad2 * ((Rsharp - Rflat) * uMirrorBasis).xy;
  vec4 cS = textureGrad(uMirror, uvS, gBx, gBy);
  float lampHit = smoothstep(2.6, 3.4, max(cS.r, max(cS.g, cS.b)));
  if (lampHit <= 0.0) return col;
  float wSh = ocMirrorW(uvS);
  vec4 sharp = wSh <= wS ? vec4(0.0) : vec4(uMirrorL0 * (exp2(cS.rgb) - 1.0), cS.a);
  return mix(col, sharp, lampHit * (wSh > 1e8 ? 1.0 : 1.0 - smoothstep(0.8, 1.0, wSh / ${F(DISTANT_MIN_DISTANCE)})));
}

// ---------------------------------------------------------------- disturbances (analytic list)
// Boils (their domes displace the mesh) and splashes outside the splash map. Accumulates ripple
// slope, white-water density, aeration, glassiness (boils) and churn.
void ocDisturb(vec2 p, float foot, inout vec2 slope, inout float foam, inout float aer, inout float calm, inout float churn) {
  for (int i = 0; i < uDistCount; i++) {
    vec4 A = uDistA[i], B = uDistB[i];
    vec2 d2 = p - A.xy;
    float r = length(d2);
    float age = B.x, life = B.y;
    int kind = int(B.w + 0.5);
    if (r > A.z * 2.4 + ${F(RIPPLE_CG_MAX)} * min(age, 2.0 + 3.0 * A.z) + 0.6 + (kind == 1 ? 2.0 * A.z : 0.0)) continue;
    vec2 dir = d2 / max(r, 1e-4);
    float ang = atan(d2.y, d2.x) / (2.0 * PI);
    float edgeN = textureLod(uFoamTex, vec2(ang + float(i) * 0.371, 0.23 * float(i) + 0.01 * age), 4.5).b * 2.0 - 0.5;
    if (kind == 0) {
      // the splash map's ring train and white water, for isolated splashes elsewhere
      slope += dir * ocRingSlope(r, age, A.z, A.w, life, uWindSpeed, foot);
      float R = A.z * (0.55 + 0.55 * (1.0 - exp(-age / 0.7))) * (0.78 + 0.44 * edgeN);
      float core = 1.0 - smoothstep(0.5, 1.0, r / R);
      float fresh = exp(-age / max(life * 0.35, 0.25));
      foam += B.z * core * (0.9 * fresh + 0.25 * exp(-age / max(life, 0.5)));
      aer += B.z * exp(-age / 3.0) * (1.0 - smoothstep(0.6, 1.6, r / A.z));
      churn += core * fresh;
    } else {
      float env = ocBoilEnvelope(age, life);
      float s = r / A.z;
      float h = ${F(BOIL_DOME_M)} * A.w * env * exp(-s * s);
      slope += dir * (-2.0 * r / (A.z * A.z)) * h;
      calm = max(calm, env * exp(-s * s / 1.9));
      float rim = A.z * (1.05 + 0.3 * age) * (0.85 + 0.3 * edgeN);
      float dr = r - rim;
      // the rim is where the upwelling meets the surrounding surface: a thin, broken line of
      // bubbles, not a closed white ring (a continuous rim read as a painted donut at 50 m)
      foam += B.z * 0.55 * exp(-dr * dr / (0.05 * A.z * A.z + 0.02)) * exp(-age / max(life * 0.6, 0.4)) * smoothstep(0.35, 1.1, edgeN);
      foam += B.z * 0.2 * env * exp(-s * s * 1.5);
      aer += B.z * 0.5 * env * exp(-s * s);
    }
  }
}

// Isotropic mip level of an FFT tile lookup at uv (256² tiles), from the larger footprint axis.
float ocLod(vec2 uv) {
  vec2 dx = dFdx(uv) * ${F(256)}, dy = dFdy(uv) * ${F(256)};
  return 0.5 * log2(max(max(dot(dx, dx), dot(dy, dy)), 1e-8));
}

// ---------------------------------------------------------------- foam lace
// Coverage of foam of density rho. Foam is a network of bubble films: the walls of equalised
// Worley cells (the R channel, uniform on [0, 1]), thresholded at 1 − rho so the covered fraction
// is exactly rho: thin foam is filaments, dense foam leaves round holes. The cell size follows the
// pixel footprint (never below 19 cm, always ≥ 8 pixels, two neighbouring octaves blended), so the
// lace is crisp at every range and never aliases into salt and pepper: close up bubble lace, at
// 100 m ragged, holed patches, far away a correct partial cover. Near the camera a 6 cm octave
// adds the bubble texture (their sum has the trapezoidal quantile ocNetQ). 'patchy' modulates the
// density at the metre scale, keeping its mean. dir/stretch elongate the cells (wind, a wake).
float ocNetQ(float p) {
  return p < 0.21429 ? sqrt(0.42 * p) : (p < 0.78571 ? 0.7 * p + 0.15 : 1.0 - sqrt(0.42 * max(1.0 - p, 0.0)));
}
float ocLace(vec2 p, vec2 dir, float stretch, float rho, float patchy, vec2 gx, vec2 gy, out float shade) {
  vec2 pp = vec2(-dir.y, dir.x);
  vec2 q = vec2(dot(p, dir) / stretch, dot(p, pp));
  vec2 qx = vec2(dot(gx, dir) / stretch, dot(gx, pp)), qy = vec2(dot(gy, dir) / stretch, dot(gy, pp));
  float fMin = min(length(qx), length(qy));
  float L = max(log2(8.0 * fMin / 0.19), 0.0);            // octave of the cells (0: 19 cm), ≥ 8 pixels each
  float L0 = floor(L), fL = L - L0;
  float ta = 0.10989 * exp2(-L0);                           // 1 / tile: 48 cells per tile of 9.1 m × 2^L0
  float na = textureGrad(uFoamTex, q * ta + 0.61, qx * ta, qy * ta).r;
  float nb = textureGrad(uFoamTex, q * ta * 0.5 + 0.23, qx * ta * 0.5, qy * ta * 0.5).r;
  float b3 = textureGrad(uFoamTex, q * 0.025 + 0.37, qx * 0.025, qy * 0.025).g;   // 40 m tile: 3.3 m patches
  float rl = clamp(rho * mix(1.0, 0.25 + 1.5 * b3, patchy), 0.0, 1.25);
  float thr = rl >= 1.0 ? -0.2 : 1.0 - rl;
  // bubble texture: a 6 cm octave while it spans ≥ 3 pixels
  float fine = 1.0 - smoothstep(0.01, 0.02, fMin);
  float b1 = fine > 0.0 ? textureGrad(uFoamTex, q * 0.37037, qx * 0.37037, qy * 0.37037).r : 0.5;
  float netA = mix(na, 0.3 * b1 + 0.7 * na, fine);
  float thrA = rl >= 1.0 ? -0.2 : mix(thr, ocNetQ(1.0 - rl), fine);
  float fMax = max(length(qx), length(qy));
  float w = 0.05 + 0.2 * smoothstep(4.0, 16.0, fMax / max(fMin, 1e-5)) * 0.5;   // steep grazing: filtering flattens the cells
  float ca = saturate((netA - thrA) / (2.0 * w) + 0.5);
  float cb = saturate((nb - thr) / (2.0 * w) + 0.5);
  shade = mix(na, nb, fL);
  return mix(ca, cb, fL);
}

void main() {
  #include <logdepthbuf_fragment>
  vec3 P = cameraPosition + vRel;
  float dist = length(vRel);
  vec3 V = -vRel / max(dist, 1e-4);
  vec2 q = vQ;
  vec2 pq = P.xz - uSnap;                                   // displaced position, snap frame
  float foot = max(length(fwidth(vRel.xz)), 1e-4);          // metres per pixel on the water
  // gradients for the detail lookups, taken while control flow is still uniform
  vec2 gx = dFdx(P.xz), gy = dFdy(P.xz);
  vec2 gMirX = dFdx(vMirror.xy / vMirror.w), gMirY = dFdy(vMirror.xy / vMirror.w);

  // ---- wake trails: foam, aeration, capillary slick, flow direction
  vec4 trail = vec4(0.0);
  if (uTrailArea.w > 0.5) {
    vec2 dq = pq - uTrailArea.xy;
    vec2 tuv = vec2(0.5 + 0.5 * ocTrailWarp(dq.x), 0.5 - 0.5 * ocTrailWarp(dq.y));
    trail = texture(uFxMap, vec2(min(tuv.x * 0.5, 0.49975), tuv.y));
  }
  // ---- splashes around the action (splash map)
  vec4 spl = vec4(0.0);
  if (uSplashArea.w > 0.5) {
    vec2 sq = (pq - uSplashArea.xy) * uSplashArea.z;
    spl = texture(uFxMap, vec2(max(0.75 + 0.5 * sq.x, 0.50025), sq.y + 0.5)) * (1.0 - smoothstep(0.45, 0.5, max(abs(sq.x), abs(sq.y))));
  }
  // ---- life patches: bait stain, nervous water
  float bait = 0.0, nervous = 0.0;
  vec3 baitHue = vec3(0.0);
  if (uLifeCount > 0 && pq.x > uLifeBound.x && pq.x < uLifeBound.z && pq.y > uLifeBound.y && pq.y < uLifeBound.w) {
    for (int i = 0; i < uLifeCount; i++) {
      vec4 L = uLifeA[i];
      vec2 dp = pq - L.xy;
      vec2 hd = vec2(cos(L.w), sin(L.w));
      vec2 e = vec2(dot(dp, hd) / (1.25 * L.z), dot(dp, vec2(-hd.y, hd.x)) / (0.8 * L.z));
      float n = textureLod(uFoamTex, (P.xz + L.xy) * 0.012, 0.0).a;
      float w = 1.0 - smoothstep(0.7, 1.05, length(e) * (0.85 + 0.3 * n));
      bait = max(bait, uLifeB[i].x * w);
      nervous = max(nervous, uLifeB[i].y * w);
      if (uLifeB[i].x * w > 0.0) baitHue = uLifeC[i].rgb;
    }
  }
  // ---- analytic disturbances: boils, splashes outside the map
  vec2 dSlope = spl.zw;
  float dFoam = spl.x, dAer = spl.y, calm = 0.0, churn = 0.0;
  if (uDistCount > 0 && pq.x > uDistBound.x && pq.x < uDistBound.z && pq.y > uDistBound.y && pq.y < uDistBound.w)
    ocDisturb(pq, foot, dSlope, dFoam, dAer, calm, churn);

  // ---- short-wave amplitude: slicks and cat's-paws, wave groups, boils, wake scars, nervous water
  float slickN = texture(uFoamTex, (P.xz + uSlickP.zw) * uSlickP.x).a;
  float rough = 1.0 + uSlickP.y * clamp((slickN - 0.5) * 2.6, -1.0, 1.0);
  // wave groups: the short bands (normals only, the CPU mirror is unaffected) swell and fade over
  // 150-400 m patches stretched 3:1 along the crests, drifting downwind at the wind-sea group
  // speed, so the mid field shows the photo's darker and livelier swaths
  vec2 gq = vec2(dot(P.xz, uWindDir) - uGroup.y, dot(P.xz, vec2(-uWindDir.y, uWindDir.x)));
  float grpN = texture(uFoamTex, gq * vec2(1.0 / 3500.0, 1.0 / 10500.0) + vec2(0.31, 0.57)).a;
  float grp = 1.0 + uGroup.x * clamp((grpN - 0.5) * 2.6, -1.0, 1.0);
  float shortAmp = rough * (1.0 - 0.85 * calm) * (1.0 - 0.7 * trail.b) * (1.0 + 0.8 * nervous);

  // ---- LEAN: mean slope + variance per axis from each cascade
  vec2 uv0 = ocCascadeUv(0, q), uv1 = ocCascadeUv(1, q);
  // phase of the long waves at this pixel (crest +, trough −, in standard deviations)
  float xi = clamp((textureGrad(uDisp0, uv0, dFdx(uv0), dFdy(uv0)).y + textureGrad(uDisp1, uv1, dFdx(uv1), dFdy(uv1)).y) / max(uEtaStd, 0.02), -2.5, 2.5);
  vec4 m0 = texture(uSlopeA, vec3(uv0, 0.0));
  // The 2-15 m band repeats every 90 m (its FFT tile): across the near field its wave groups lined up
  // in a diagonal lattice of dark blotches. It is drawn as a blend of the tile and the tile shifted by
  // part of itself, with weights (cos φ, sin φ) that wander over ~170 m cells (φ from a non-periodic
  // field): two Gaussian fields mixed with unit total weight are one Gaussian field with the same
  // statistics (Heitz & Neyret 2018), so slopes and variance are kept and the repeat is gone.
  float phi = texture(uFoamTex, P.xz * 0.0005 + 0.29).g * 1.5707963;
  vec2 cw = vec2(cos(phi), sin(phi));
  vec2 uv1b = uv1 + vec2(0.37, 0.61);
  vec4 m1a = texture(uSlopeA, vec3(uv1, 1.0)), m1b = texture(uSlopeA, vec3(uv1b, 1.0));
  vec2 m1 = m1a.xy * cw.x + m1b.xy * cw.y;
  vec2 m1v = max(m1a.zw - m1a.xy * m1a.xy, 0.0) * cw.x * cw.x + max(m1b.zw - m1b.xy * m1b.xy, 0.0) * cw.y * cw.y;
  // hydrodynamic modulation of the short waves by the long ones (ocean.js HYDRO_MOD): rough crests
  // and forward faces, glassy backs and troughs. The phase variable (unit variance) takes the crest
  // height (0.5) and, mostly, the forward-face slope of the 2-15 m band (0.87): the roughness peaks
  // ~60° ahead of their crests, so the contrast sits on the wavelets' faces (the photo's dark lee faces
  // along the crests), not in trough-wide blotches. Where the band is partly sub-pixel the phase is
  // rescaled to unit variance; a log-normal factor with a mean of one keeps the Cox-Munk variance. A
  // pixel as large as a fifth of the dominant wavelength averages it out.
  // (a vessel's Kelvin waves modulate them too: rough crests along its wake arms)
  vec3 wake = uWakeCount > 0 ? ocWake(pq, foot * 3.0, false) : vec3(0.0);   // band-limited to the pixel footprint
  // The short waves saturate (breaking): no crest holds more than OC_HYDRO_CAP × their mean
  // variance; the capped log-normal is divided by its mean, which keeps the Cox-Munk total.
  float rho = saturate(1.0 - dot(m1v, uWindDir * uWindDir) * uHydro.y * uHydro.y);
  float chi = (0.5 * xi - 0.866 * dot(m1, uWindDir) * uHydro.y) / sqrt(0.25 + 0.75 * rho) + wake.x * uHydro.w;
  float hmS = max(uHydro.x * (1.0 - smoothstep(0.05, 0.2, foot * uHydro.z)), 1e-3);
  float lc = (log(OC_HYDRO_CAP) + 0.5 * hmS * hmS) / hmS;      // chi where the cap starts
  // (churned water, a wake or a strike, is rough whatever the long waves do)
  float turb = saturate(dFoam * 1.2 + dAer * 0.5 + trail.g * 0.7 + trail.r * 0.5 + churn);
  float hm = max(min(exp(hmS * chi - 0.5 * hmS * hmS), OC_HYDRO_CAP) / (ocPhi(lc - hmS) + OC_HYDRO_CAP * (1.0 - ocPhi(lc))), 2.0 * turb);
  // Slopes blurrier than the pixel place planar reflections; the variance between the two mip
  // levels (LEAN) spreads them. Two levels up (waves spanning ≳ 8 pixels) where a pixel covers
  // decimetres: coherent wobbles, no confetti at drone range; half a level near the camera, where
  // the resolved wavelets break a reflection into the wobbling dashes of real water instead of a
  // smooth smoky smear. (Isotropic trilinear lookups: cheap, and blur is the point.)
  float lodB = 0.5 + 1.5 * smoothstep(0.04, 0.25, foot);
  vec4 mb0 = textureLod(uSlopeA, vec3(uv0, 0.0), ocLod(uv0) + lodB);
  vec4 mb1 = textureLod(uSlopeA, vec3(uv1, 1.0), ocLod(uv1) + lodB);
  // the 2-15 m band's RESOLVED slopes take the gain (ocean.js band1GainFor); the variance they gain comes
  // out of the unresolved share here, so where the band is sub-pixel (far away) nothing changes
  float amp1 = mix(1.0, shortAmp, 0.35) * grp;
  vec2 s = m0.xy + m1 * amp1 * uGroup.z;
  vec2 v2 = max(m0.zw - m0.xy * m0.xy, 0.0) + m1v * amp1 * amp1;
  vec2 sLo = mb0.xy + mb1.xy * amp1 * uGroup.z;
  vec2 vLo = max(mb0.zw - mb0.xy * mb0.xy, 0.0) + max(mb1.zw - mb1.xy * mb1.xy, 0.0) * amp1 * amp1;
  vec2 sub = max(uSubgrid - (uGroup.z * uGroup.z - 1.0) * m1 * m1 * amp1 * amp1, 0.0015);
  vec2 uv2 = ocCascadeUv(2, q);
  // where a pixel spans more than ~5 m of the short cascade's 14.6 m tile its waves are all sub-pixel:
  // the tile's mean moments (its 1×1 mip, one cached texel) replace two anisotropic lookups
  vec2 uv2x = dFdx(uv2), uv2y = dFdy(uv2);
  float l2 = ocLod(uv2);
  vec4 m2 = textureLod(uSlopeA, vec3(uv2, 2.0), 8.0), mb2 = m2;
  if (l2 < 6.5) { m2 = textureGrad(uSlopeA, vec3(uv2, 2.0), uv2x, uv2y); mb2 = textureLod(uSlopeA, vec3(uv2, 2.0), l2 + lodB); }
  float amp2 = shortAmp * mix(1.0, grp, 0.6) * uShortOn;
  // the short cascade's longer waves (0.5-2.25 m), which carry its resolved slopes, are strained far
  // less than the wavelets and capillaries: its mean slope is left alone (no mirror-glassy troughs
  // close up), its sub-pixel variance (the finer end of the band) takes all of it. Where a pixel holds
  // several of its texels (beyond ~150 m at the drone) the footprint means are a few waves' sampling
  // noise, an even white sparkle over the whole near field: they go into the variance (the blur).
  float k2 = 1.0 - smoothstep(1.5, 4.0, l2);
  s += m2.xy * amp2 * k2;
  v2 += (max(m2.zw - m2.xy * m2.xy, 0.0) * hm + m2.xy * m2.xy * (1.0 - k2 * k2)) * amp2 * amp2;
  sLo += mb2.xy * amp2;
  vLo += max(mb2.zw - mb2.xy * mb2.xy, 0.0) * amp2 * amp2;
  sLo -= P.xz / OC_EARTH_R;
  vec2 vEx = max(vLo - v2, 0.0);                            // variance left out of sLo, per axis
  s += dSlope;
  s += wake.yz;                                             // vessel wave field (Kelvin wake)
  s -= P.xz / OC_EARTH_R;                                   // Earth curvature tilts the mean normal
  // churned, aerated water (strikes, wakes, fresh whitecaps): bubbling, broken 5-30 cm facets
  if (turb > 0.01) {
    vec2 tq = P.xz + uTime * vec2(0.27, -0.19);
    float t8 = floor(uTime * 8.0);
    vec2 n1 = textureGrad(uFoamTex, tq * 0.41667 + t8 * vec2(0.13, 0.29), gx * 0.41667, gy * 0.41667).rg;   // 2.4 m tile: ~20 cm cells
    vec2 n2 = textureGrad(uFoamTex, tq * 0.37037 - t8 * vec2(0.21, 0.07), gx * 0.37037, gy * 0.37037).gr;   // ~6 cm cells
    float fade = 1.0 - smoothstep(0.05, 0.3, foot);
    s += turb * 0.25 * fade * ((n1 - 0.5) * 1.4 + (n2 - 0.5) * 0.8);
  }
  vec3 N = normalize(vec3(-s.x, 1.0, -s.y));
  vec2 s2 = v2 + (sub * hm) * shortAmp * shortAmp * (1.0 - 0.6 * trail.b) * (1.0 + 1.2 * nervous) + turb * 0.02 + 1.1e-5;   // + sun-disc size

  // ---- rough-surface sky reflection: the filtered sea BRDF (Bruneton, Neyret & Holzschuch 2010),
  // with the visible slope distribution integrated by quadrature. The unresolved facets a pixel
  // sees are weighted by their projected area (a + ζ)·p(ζ) over the Smith-visible slopes ζ > −a
  // along the view (a = tan of the grazing angle to the resolved normal); with t = a/σ:
  //   mean visible slope   σ·Φ(t)/D,  D = t·Φ(t) + φ(t)
  //   its spread           σ·sqrt((t·Φ + 2φ)/D − (Φ/D)²)
  // At grazing views the visible facets tilt toward the camera (their reflected rays leave 5-16°
  // higher, into darker sky, at lower incidence: lower Fresnel). Three nodes (mean, mean ± √3·spread;
  // weights 2/3, 1/6, 1/6 keep the variance) each take their own exact Fresnel, polarizer share and
  // reflected ray: facets tilted toward the camera reflect the dark upper sky near Brewster's angle,
  // facets tilted away reflect the bright horizon at grazing incidence, unless their reflected ray
  // leaves so low that the next wave masks it (Smith G1) and they mirror that wave instead.
  vec2 vh = V.xz;
  float vl = dot(vh, vh);
  vec2 vdir = vl > 1e-10 ? vh * vh / vl : vec2(0.5);
  float sigV = sqrt(dot(vdir, s2));                         // slope spread along the view
  float sigX = sqrt(dot(vdir.yx, s2));                      // across it
  float NdV = clamp(dot(N, V), 0.0, 1.0);
  float tV = NdV / sqrt(max(1.0 - NdV * NdV, 1e-6));
  float aV = tV / max(sigV, 1e-4);
  float PhiV = 1.0 - 0.5 * ocErfc(aV * 0.70710678);
  float phiV = 0.39894228 * exp(-0.5 * aV * aV);
  float DV = max(aV * PhiV + phiV, 1e-6);
  float EzV = PhiV / DV;
  float zV = sigV * EzV;                                    // mean visible facet slope toward the camera
  float sigC = sigV * sqrt(max((aV * PhiV + 2.0 * phiV) / DV - EzV * EzV, 0.05));
  vec3 Vt = V - N * dot(V, N);
  Vt /= max(length(Vt), 1e-5);
  // sky panorama blur per node: the spread between nodes in elevation (the panorama's rows are
  // stretched near the horizon, v = sqrt(el / 90°)) and 2σ across the view in azimuth
  vec3 refl = vec3(0.0);
  float Fe = 0.0, Fm = 0.0;
  for (int k = -1; k <= 1; k++) {
    float zk = max(zV + float(k) * 1.7320508 * sigC, 0.02 - tV);
    float wk = k == 0 ? 0.6666667 : 0.1666667;
    vec3 Nk = normalize(N + Vt * zk);
    vec3 Rk = reflect(-V, Nk);
    float Gk = Rk.y > 0.0 ? 1.0 / (1.0 + ocLambda(Rk.y, sigV * sigV)) : 0.0;
    Rk.y = max(Rk.y, 0.0015);
    Rk = normalize(Rk);
    // (the elevation in the row scale is taken as Rk.y: it only sizes the blur)
    vec2 dSky = vec2(2.0 * sigX * 0.15915494 / max(sqrt(1.0 - Rk.y * Rk.y), 0.2), 0.9 * sigC * 0.31830989 / sqrt(max(Rk.y * 0.63661977, 1e-4)));
    vec4 Lk = textureGrad(uSkyMap, ocSkyMapUv(Rk), vec2(dSky.x, 0.0), vec2(0.0, dSky.y));
    vec3 ek = cross(Rk, uSunDir), sk = cross(V, Nk);           // skylight E-vector, facet s direction
    float c2 = dot(ek, sk); c2 = c2 * c2 / max(dot(ek, ek) * dot(sk, sk), 1e-12);
    vec3 Fk = ocFresnelPol(dot(Nk, V), Lk.a * Gk, c2);
    refl += (wk * Fk.y * mix(OC_SEA_SELF, 1.0, Gk)) * Lk.rgb;
    Fe += wk * Fk.x;
    Fm += wk * Fk.z;
  }
  refl /= OC_PRE;
  vec3 Rv = reflect(-V, N);
  Rv.y = max(Rv.y, 0.0015);
  Rv = normalize(Rv);
  if (uMirrorOn > 0.5) {
    vec3 Rflat = normalize(vec3(-V.x, max(V.y, 0.0015), -V.z));
    // long-wave normal tilted by the mean visible facet slope: its reflected ray places the
    // reflection, the shorter and unresolved slopes spread it
    vec3 NLo = normalize(vec3(-sLo.x, 1.0, -sLo.y));
    vec3 VtLo = V - NLo * dot(V, NLo);
    VtLo /= max(length(VtLo), 1e-5);
    // Within a few tens of metres (pixels of centimetres) the full-resolution normal places it: the
    // resolved wavelets break a tower's reflection into the wobbling fragments of real water.
    float nearM = 1.0 - smoothstep(0.03, 0.3, foot);
    vec3 Rc = normalize(mix(reflect(-V, normalize(NLo + VtLo * zV)), Rv, nearM));
    Rc.y = max(Rc.y, 0.0015); Rc = normalize(Rc);
    vec2 vE = vEx * (1.0 - nearM);
    vec4 pl = ocMirror(Rc, Rv, Rflat, V, sqrt(sigC * sigC + dot(vdir, vE)), sqrt(sigX * sigX + dot(vdir.yx, vE)), gMirX, gMirY, pq, foot);
    // (unpolarised light: towers, hulls and lamps)
    refl = refl * (1.0 - clamp(pl.a, 0.0, 1.0)) + pl.rgb * (Fm / OC_PRE);
  }
  vec3 C = refl;

  // ---- sun and moon glint: the Beckmann mean, broken into discrete glints near the camera
#ifdef OC_VERTEX_AERIAL
  float shadow = vShadow;
#else
  float shadow = cloudShadow(P);
#endif
  float shT = ocTowerShadow(pq, uSunDir), shadowSun = shadow * shT;
  // a structure's shadow is a few metres wide: the light the water body sends up there is mostly
  // scattered in from the sunlit water around it (~10 m attenuation length), so it dims only partly;
  // the glint and the foam's direct sun go entirely
  float shadowW = shadow * mix(1.0, shT, 0.5);
  vec3 glint = vec3(0.0);
  float eg;
  if (uSunDir.y > -0.01) {
    float g = ocGlint(uSunDir, V, N, s2, eg);
    glint += uSunIlluminance * (shadowSun * ocSparkle(g, eg, pq, foot, 0.0, OC_GLINT_DENSITY));
  }
  // moon glint only when it can matter (it is ~1e-5 of the sun by day)
  if (uMoonDir.y > -0.01 && dot(uMoonIlluminance, vec3(1.0)) > 1e-4 * dot(uSunIlluminance, vec3(1.0))) {
    float g = ocGlint(uMoonDir, V, N, s2, eg);
    glint += uMoonIlluminance * ocSparkle(g, eg, pq, foot, 5.0, OC_GLINT_DENSITY);
  }
  // lamps beyond the mirror's reach (the city, far turbines): analytic glitter columns
  if (uDLInfo.x > 0.5) {
    vec3 gl = ocDistantLights(P, V, N, s2, eg);
    glint += gl * ocSparkle(1.0, eg, pq, foot, 9.0, ${F(LAMP_GLINT_DENSITY)});
  }

  // ---- light leaving the water body (FU-4 NJ water; darker and tinted over a bait pod)
  // sky irradiance on the sea: π × the atmosphere's cosine-weighted mean of the clear sky (its ambient
  // table, row 1 texel 1) plus the cumulus light (texel 4, half the hemisphere's mean gain), current
  // on the frame of a clock jump (a probe read back asynchronously lagged a day sky into the night)
#ifdef OC_AMB
  vec3 Esky = PI * (texelFetch(uAtmAmbTex, ivec2(1, 1), 0).rgb + 2.0 * texelFetch(uAtmAmbTex, ivec2(4, 1), 0).rgb);
#else
  vec3 Esky = uEsky;
#endif
  vec3 Ed = uSunIlluminance * (max(uSunDir.y, 0.0) * shadowW) + uMoonIlluminance * max(uMoonDir.y, 0.0) + Esky;
  vec3 upw = uUpwelling;
  if (bait > 0.0) upw = mix(upw, baitHue * dot(upw, vec3(0.3333)) * 2.2, 0.6 * bait) * (1.0 - 0.35 * bait);
  C += upw * (1.0 / PI) * Ed * (1.0 - Fe);
  // forward-scattered sunlight through the backs of crests when looking toward a low sun: faces
  // tilted toward the sun, seen from behind, glow teal
  vec2 sunH = uSunDir.xz / max(length(uSunDir.xz), 1e-5);
  float lobe = pow(saturate(dot(-V, uSunDir)), 6.0) + 0.15 * saturate(dot(-V.xz / max(length(V.xz), 1e-5), sunH));
  float back = saturate(dot(-N.xz, -sunH) * 25.0);          // faces sloping up toward the sun (≥ 0.04)
  float crest = smoothstep(0.2, 1.4, vEta / max(uEtaStd, 0.01)) * back;
  C += uSSSColor * uSunIlluminance * (shadowW * lobe * crest * (1.0 - Fe) * saturate(1.5 - uSunDir.y));

  // ---- foam
  // whitecaps in two stages (both geometry cascades): stage A bright, stage B grey lace
  float wFresh = 0.0, wRes = 0.0, wAer = 0.0, streak = 0.0;
  if (uWhitecapsOn > 0.0) {
    // (cascade 1 switched between the same two tiles as its slopes, over a narrow seam: its 90 m tile drew
    // the breakers in diagonal rows of dashes, and an even blend would halve them to grey)
    float fsw = smoothstep(0.3, 0.7, cw.x * cw.x);
    vec2 c2w = vec2(fsw, 1.0 - fsw);
    vec4 f0 = texture(uFoamA, vec3(uv0, 0.0)), f1 = texture(uFoamA, vec3(uv1, 1.0)) * c2w.x + texture(uFoamA, vec3(uv1b, 1.0)) * c2w.y;
    // the short cascade's breakers gather on the crests of the dominant waves, where its own
    // Jacobian adds to theirs (Banner et al. 2000: breaking follows the dominant wave groups);
    // the factor keeps the mean, so the calibrated cover is unchanged but whitecaps come in patches
    // large enough to read from far away
    float crestF = (0.15 + 3.5 * smoothstep(0.8, 1.8, xi)) * 1.968;
    wFresh = (0.8 * f0.x + f1.x * crestF) * uWhitecapsOn;
    wRes = (0.8 * f0.w + f1.w * crestF) * uWhitecapsOn;
    // the residue of decayed foam, drawn out along the wind by the FFT pass: trails behind the breakers
    streak = saturate((f0.y + f1.y) * uStreakGain);
    // the bubble cloud under a breaker spreads a little wider than its foam (two mips blurrier)
    vec4 fb0 = texture(uFoamA, vec3(uv0, 0.0), 2.0), fb1 = texture(uFoamA, vec3(uv1, 1.0), 2.0) * c2w.x + texture(uFoamA, vec3(uv1b, 1.0), 2.0) * c2w.y;
    wAer = 0.8 * (fb0.x + 0.4 * fb0.w) + fb1.x + 0.4 * fb1.w;
  }
  // pile wash: the water slapping the wall leaves a thin bubbly rim all round, brightening as each crest
  // arrives (the weather side first) and wider in a bigger sea; outside it lace, denser and climbing on
  // the weather side, pulsing with the crests, mostly clear in the lee and broken up at a calm sea
  float pile = 0.0;
  float seaUp = smoothstep(3.0, 10.0, uWindSpeed), hsF = clamp(uEtaStd * 6.0, 0.7, 2.0);   // ≈ Hs / 0.67 m
  float lodFoam = log2(max(foot * 256.0 / 3.3, 1.0));
  for (int i = 0; i < uPileCount; i++) {
    vec4 pl = uPiles[i];
    vec2 dp = pq - pl.xy;
    float rr = length(dp);
    float dd = rr - pl.z;
    if (dd > 3.0 || dd < -1.0) continue;
    float inc = smoothstep(-0.2, 0.6, dot(dp / max(rr, 1e-3), -uWaveDir));
    float arc = pl.z * atan(dp.y, dp.x);
    float nz = textureLod(uFoamTex, vec2(arc / 3.3, dd / 1.9 - uTime * 0.07), lodFoam).g;
    float gaps = textureLod(uFoamTex, vec2(arc / 17.0 + uTime * 0.011, 0.5 + uTime * 0.02), lodFoam + 1.0).g;
    float eta = vEta / max(uEtaStd, 0.02);
    float surge = max(smoothstep(0.4, 1.2, eta), pl.w * inc);
    float dw = max(dd, 0.0);
    float rim = ${F(PILE_WASH.contact)} * exp(-dw / (${F(PILE_WASH.contactM)} * hsF)) * (0.35 + 0.65 * max(smoothstep(-0.6, 1.0, eta), pl.w * inc)) * mix(0.5, 1.0, inc) * (0.7 + 0.3 * nz);
    float lace = ${F(PILE_WASH.lace)} * exp(-dw / ${F(PILE_WASH.laceM)}) * (0.4 + 0.6 * nz) * (0.1 + 0.9 * surge) * mix(0.3, 1.0, inc)
               * mix(smoothstep(0.35, 0.65, gaps), 1.0, seaUp) * (0.6 + 0.4 * seaUp + 0.3 * inc);
    pile = max(pile, rim + lace);
  }
  // densities: white (stage A, strikes, wash, wake foam) and lacy (stage B)
  float FD = wFresh + min(dFoam, 0.9) + pile + trail.r;
  float RD = 0.6 * wRes;
  float aer = saturate(wAer * 0.6 + dAer + trail.g + 0.4 * pile);
  float covF = 0.0, covR = 0.0, shadeF = 0.5, shadeR = 0.5;
  // Wind streaks: the residue of decayed foam, drawn out along the wind by the FFT pass (Langmuir
  // windrows gather it): grey trails behind the breakers at Beaufort 6, white streaks by Beaufort 8. (A
  // windrow texture with free-standing lines read as a regular diagonal hatch over a gale sea.)
  RD += 0.35 * streak;
  FD += 0.15 * max(uStreakGain - 1.0, 0.0) * streak;
  if (FD > 0.004) {
    // wake foam is drawn out along its flow (4:1); elsewhere the cells are round
    float tw = saturate(trail.r * 3.0) * step(0.01, trail.a);
    float ta = (trail.a - 0.02) / 0.96 * PI;
    vec2 fdir = normalize(mix(uWindDir, vec2(cos(ta), sin(ta)), tw) + 1e-5);
    // wake white water is broken by boils of turquoise aerated water (patchier lace). Within a few
    // metres the cells are not drawn out: stretched 4:1 they were magnified past the foam texture's
    // resolution and their outlines turned into blocks
    float near = smoothstep(0.02, 0.1, foot);
    // a wake's first seconds (trail densities above one, ocean-effects.js) are white water without holes
    covF = ocLace(P.xz, fdir, 1.0 + 3.0 * tw * near, FD, mix(0.3, 0.85, tw) * (1.0 - smoothstep(1.0, 1.35, trail.r)), gx, gy, shadeF);
  }
  if (RD > 0.004) covR = ocLace(P.xz + vec2(17.3, 5.1), uWindDir, 1.0 + smoothstep(0.02, 0.1, foot), RD, 1.0, gx, gy, shadeR);
  // Beaufort 7-8: the wind tears spray off the breaking crests and carries it a few metres downwind,
  // a veil over and behind each breaker (spindrift): the fresh foam, blurred and taken upwind
  float spray = 0.0;
  if (uWhitecapsOn > 0.0 && uWindSpeed > 14.0) {
    vec2 up = -uWindDir * 4.0;
    spray = smoothstep(14.0, 20.0, uWindSpeed) * (texture(uFoamA, vec3(ocCascadeUv(1, q + up), 1.0), 2.5).x
          + 0.8 * texture(uFoamA, vec3(ocCascadeUv(0, q + 2.5 * up), 0.0), 1.5).x);
  }
  // foam is Lambertian on the wave normal (sun + sky); aerated water glows turquoise under it
  vec3 Efoam = uSunIlluminance * (max(dot(N, uSunDir), 0.0) * shadowSun) + uMoonIlluminance * max(dot(N, uMoonDir), 0.0)
             + Esky * (0.55 + 0.45 * N.y);
  vec3 foamLit = (1.0 / PI) * Efoam;
  C += glint * (1.0 - max(covF, 0.6 * covR));
  C += uAerTint * (1.0 / PI) * Ed * aer * (1.0 - Fe);
  // stage B: fairly white while dense (just left by the breaker), thinning to grey, translucent lace
  float rdn = saturate(RD * 1.5);
  C = mix(C, mix(mix(0.35, 0.68, rdn) * (0.85 + 0.3 * shadeR) * foamLit, C, mix(0.5, 0.12, rdn)), covR);
  C = mix(C, uFoamAlbedo * mix(0.55, 1.0, saturate(FD)) * (0.82 + 0.3 * shadeF) * foamLit, covF);
  C = mix(C, 0.8 * foamLit, saturate(0.5 * spray));

#ifdef OC_VERTEX_AERIAL
  C = atmExpose(C * vAerT + vAerS);
#else
  C = applyAerialPerspective(C, P);
#endif
  gl_FragColor = vec4(C, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
}

export function createOceanMaterial({ cascades, atmosphere, uniforms }) {
  const mat = new THREE.ShaderMaterial({
    name: 'OceanSurface',
    uniforms: { ...atmosphere.uniforms, ...uniforms },
    vertexShader: vertexShader(cascades, atmosphere.glslCore),
    fragmentShader: fragmentShader(cascades, atmosphere.glsl, !!atmosphere.glslCore),
    side: THREE.DoubleSide,
  });
  return mat;
}
