// Atlantic City and the barrier-island coast on the western horizon (owner: vessels).
//
// Contract (ARCHITECTURE.md "Land", SCENE-SPEC §16, config LAND):
//   new Land(ctx)              builds the skyline, the coast strip, the onshore wind farm and the
//                              night lights under one Group (land.root) in ctx.scene
//   land.update(dt, t, camera) window occupancy, crown and sign lighting, aviation flashes, rotor
//                              spin; publishes the night lights to ocean.setDistantLights() if offered
//   land.distantLights()       the same list, for a pull model (see _publishDistant)
//   land.setQuality(q), land.dispose()
//   land.buildings             [{ name (dev builds), height, x, z, distanceM, bearingDeg, baseY }] as placed
//   land.coastStats, land.lampCounts, land.midriseCount   (diagnostics; coastStats and lampCounts in dev builds)
//
// Also exports the photometric lamp-sprite renderer shared with src/life/vessels.js:
//   PhotometricLamps, LAMP_BEAM, LAMP_XY, chromaticityToLinear, exposedScale, sunElevationDeg,
//   NO_ATMOSPHERE_GLSL, HASH_GLSL; and the geography: geoToLocal, TOWERS, COAST, ONSHORE.
//
// Scale. Everything stands at its real position relative to the hero (config LAND anchors Ocean
// Casino and Borgata; the other buildings are converted from their published coordinates with the
// local metres-per-degree at 39.36 N, anchored on Ocean Casino so the config positions stay exact)
// on the curved sea surface (base y = -curvatureDrop): from a boat deck most of the coast is
// hull-down and only the towers show, as SCENE-SPEC §16 derives. Nothing is tinted by hand: the
// faint blue-grey look by day is the atmosphere's aerial perspective over 17-36 km.
//
// Massing. Each tower has its plan (slab, stadium, curved slab) and form: a slab with rooftop
// plant, Ocean Casino's sail-cut glass top, stepped crowns, the art-deco setbacks of the Claridge
// and Haddon Hall. Night. Window light is procedural (floor x bay grid, per-room occupancy,
// curtains and colour temperature, lit stair / lift-lobby columns, box-filtered so a sub-pixel
// facade shows its mean luminance); crowns and Borgata's gold facade are floodlit from dusk,
// casino podiums carry LED signage panels, every tower >= 61 m carries FAA red obstruction lights,
// and the shore is a string of photometric lamps: the Boardwalk's regular strip in front of the
// casinos, street and window light elsewhere.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { U, LAYER_REFLECT, EARTH_R, curvatureDrop, mulberry32, registerScale } from '../shared.js';
import { LAND, LOOK, NIGHT_LIGHTS, SEA } from '../config.js';
import { applyAtmosphere } from './fog.js';

const DEG = Math.PI / 180;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smooth01 = (x) => { const c = clamp(x, 0, 1); return c * c * (3 - 2 * c); };
const lin = (hex) => new THREE.Color().setStyle(hex).toArray();
const unitLuminance = (c) => { const y = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; return c.map((v) => v / Math.max(y, 1e-6)); };
const SCENE_LUX = LOOK.sceneUnitLux;

// Shared GLSL hash (Dave Hoskins' hash13), also used by vessels.js.
export const HASH_GLSL = 'float hash13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }\n';

// ================================================================================================
// Geography
// ================================================================================================
// Local metres per degree at 39.36 N (WGS84 series: 111132.954 - 559.822 cos 2φ + 1.175 cos 4φ;
// 111412.84 cos φ - 93.5 cos 3φ). DERIVED; reproduces config LAND's Borgata from Ocean Casino to 2 m.
const ANCHOR = { lat: 39.36175, lon: -74.41350, x: LAND.skyline[0].x, z: LAND.skyline[0].z };   // Ocean Casino [16]
function geoToLocal(lat, lon) { return { x: ANCHOR.x + (lon - ANCHOR.lon) * 86166, z: ANCHOR.z - (lat - ANCHOR.lat) * 111022 }; }

// Towers >= 77 m. Heights: Wikipedia "List of tallest buildings in Atlantic City" (SCENE-SPEC [34]);
// Ocean Casino and Borgata heights and positions from config LAND. Coordinates: Wikipedia article
// coordinates for Hard Rock, Resorts, Bally's, Tropicana, Harrah's, Golden Nugget; towers inside a
// resort and the remaining buildings ESTIMATED from their street addresses along the Boardwalk
// (069/249 T). Forms and cladding ESTIMATED from photographs; lit crowns from night photographs.
// Columns: lat, lon, height (m), L x W (m) along the long-axis bearing, bearing (deg),
// plan (b slab, s stadium, a curved slab), form (p rooftop plant, s sail top, c stepped crown,
// t art-deco setbacks), cladding (sRGB), curtain wall (1: glass skin, the cladding is its tint),
// crown light [sRGB, cd/m², from fraction of height, 1 = LED colour cycling; uplit glass returns little of
// the light: Borgata's gold skin ~1 cd/m²], podium [L, W, H, sign sRGB]. The names are kept for dev builds
// only (land.buildings[].name, the scale report); the published bundle compiles them out.
const TOWER_NAMES = globalThis.NJOW_DEV !== false ? ['Ocean Casino Resort', "Harrah's Waterfront Tower", "Hard Rock's North Tower", 'MGM Tower', 'Borgata Hotel and Casino', 'Hard Rock Hotel & Casino Atlantic City', "Bally's Atlantic City", 'The Claridge', 'Ocean Club', 'Resorts Rendezvous Tower', 'The Flagship Resort', 'Atlantic Palace Suites', "Harrah's Bayview Tower", 'Wyndham Skyline Tower', 'Caesars Centurion Tower', 'Golden Nugget Atlantic City', 'The Enclave', 'Tropicana Havana Tower', 'Tropicana Solana Tower', 'Bella', 'Haddon Hall (Resorts Ocean Tower)', 'Showboat Bourbon Tower'] : [];
const TOWERS = [
  [39.36175, -74.41350, LAND.skyline[0].height, 95, 32, 60, 's', 's', '#56727e', 1, ['#5a7dff', 6, 0.9, 1], [180, 90, 30, '#9fb8ff']],   // Ocean Casino Resort
  [39.3842, -74.4302, 160, 95, 28, 125, 'a', 'c', '#a3a8ae', 0, ['#b06cff', 5, 0.93]],   // Harrah's Waterfront Tower
  [39.3596, -74.4190, 140, 75, 26, 150, 'b', 'p', '#afafaf', 0, ['#ff4fa0', 4, 0.94]],   // Hard Rock's North Tower
  [39.3767, -74.4378, 140, 55, 30, 20, 'b', 'c', '#46677a', 1],   // MGM Tower
  [39.37749, -74.43510, LAND.skyline[1].height, 125, 26, 100, 'a', 'p', '#b39150', 1, ['#ffb347', 1.2, 0]],   // Borgata Hotel and Casino
  [39.3586, -74.4200, 130, 70, 30, 60, 'b', 'p', '#c3c0b7', 0, ['#c77dff', 4, 0.92], [200, 90, 28, '#ff66c4']],   // Hard Rock Hotel & Casino Atlantic City
  [39.3565, -74.4323, 120, 70, 28, 60, 'b', 'c', '#bfbdb6', 0, null, [150, 80, 25, '#ffd27a']],   // Bally's Atlantic City
  [39.3574, -74.4312, 110, 45, 30, 150, 'b', 't', '#95796b'],   // The Claridge
  [39.3500, -74.4497, 110, 55, 25, 60, 'b', 'p', '#b8b6af'],   // Ocean Club
  [39.3598, -74.4228, 106, 55, 25, 60, 'b', 'p', '#b5b0a6', 0, null, [140, 80, 24, '#ffe2a8']],   // Resorts Rendezvous Tower
  [39.3655, -74.4100, 102.6, 50, 25, 30, 'b', 'p', '#b1aea6'],   // The Flagship Resort
  [39.3572, -74.4278, 101, 45, 25, 60, 'b', 'c', '#b5b2ab'],   // Atlantic Palace Suites
  [39.3852, -74.4282, 92, 60, 22, 40, 'b', 'p', '#b1afaa'],   // Harrah's Bayview Tower
  [39.3584, -74.4298, 92, 40, 25, 150, 'b', 'p', '#adaba6'],   // Wyndham Skyline Tower
  [39.3551, -74.4345, 91, 60, 25, 60, 'b', 'c', '#bebcb4', 0, ['#ffe0a0', 3, 0.9], [150, 90, 25, '#ffc680']],   // Caesars Centurion Tower
  [39.378547, -74.429176, 87, 70, 25, 110, 'b', 'p', '#ada086', 0, ['#ffcf6a', 4, 0.9]],   // Golden Nugget Atlantic City
  [39.3478, -74.4553, 87, 45, 25, 60, 'b', 'p', '#b5b2ab'],   // The Enclave
  [39.3530, -74.4448, 86, 50, 25, 150, 'b', 'c', '#bbb8b0'],   // Tropicana Havana Tower
  [39.3519, -74.4463, 86, 50, 25, 60, 'b', 'p', '#bbb8b0', 0, null, [160, 90, 25, '#ffb070']],   // Tropicana Solana Tower
  [39.3534, -74.4430, 83, 40, 25, 60, 'b', 'p', '#b7b3ad'],   // Bella
  [39.3591, -74.4216, 79, 60, 35, 150, 'b', 't', '#8f7462'],   // Haddon Hall (Resorts Ocean Tower)
  [39.3606, -74.4166, 77, 60, 25, 150, 'b', 'p', '#b6b2ab'],   // Showboat Bourbon Tower
];
// Tower forms as stacked parts [bottom, top (fraction of height; negative = metres below the top),
// footprint scale along L, W, rooms]: the top of the highest part is exactly the listed height.
const FORMS = {
  p: [[0, -6, 1, 1, 1], [-6, 1, 0.3, 0.5, 0]],                                    // slab + rooftop plant (lift overrun)
  s: [[0, 1, 1, 1, 1]],                                                            // sail-cut glass top (18 m slant)
  c: [[0, -11, 1, 1, 1], [-11, -5, 0.78, 0.85, 0], [-5, 1, 0.35, 0.5, 0]],          // stepped crown
  t: [[0, 0.6, 1, 1, 1], [0.6, 0.78, 0.8, 0.85, 1], [0.78, 0.9, 0.58, 0.7, 1], [0.9, 1, 0.36, 0.5, 0]],   // art-deco setbacks
};
// Mid-rise city between the towers (hotels, condos, parking decks of 8-20 floors): ESTIMATED count
// and heights, placed by seed within 60-520 m of the Boardwalk line from Chelsea to the Inlet and
// around the Marina district, never inside a listed tower's footprint.
const MIDRISE = { from: [39.3478, -74.4553], to: [39.3655, -74.4100], count: 34, marina: [39.3805, -74.4320], marinaR: 700, marinaCount: 8 };
// Room grid (hotel floors 3.1-3.8 m; listed heights / floor counts give 3.3-3.8). ESTIMATED.
const FLOOR_H = 3.4, BAY_W = 4.2;
// Night photometry (ESTIMATED). A hotel room lit to ~150 lx with 0.3-0.5 albedo surfaces is 15-25 cd/m²,
// ~12 cd/m² through tinted low-e glazing (T ≈ 0.5-0.6): WINDOW_CDM2, curtains open. Late in the evening
// most guests have drawn them (60 %: a sheer or lined curtain glows at 0.06-0.25 of that), so a lit
// window averages ROOM_MEAN x WINDOW_CDM2 ≈ 5 cd/m² and a facade with a third of its rooms lit ~0.8
// (punched windows) to 1.3 (glass skins) cd/m², strongly patchy by floor section (occupancy per 5-bay
// block ∝ hash², mean = the lit fraction). Casino LED signage panels run dimmed at night (a few hundred
// cd/m² at full white; their content and pixel fill bring a panel to SIGN_CDM2 x 0.35-1): bright,
// saturated colour that the post's night shoulder keeps.
const WINDOW_CDM2 = 12, ROOM_MEAN = 0.41, LOBBY = 0.45;
const SIGN_CDM2 = 40;

// Jersey-Atlantic Wind Farm: 5 x GE 1.5sle at 39.38139 N, 74.44750 W (Wikipedia). Hub 80 m and
// rotor 77 m are the GE 1.5sle catalogue values (tip 118.5 m; config LAND.onshoreWind 120 m).
// Row orientation and spacing ESTIMATED.
const ONSHORE = { lat: 39.38139, lon: -74.44750, count: LAND.onshoreWind.count, hubHeight: 80, rotorDiameter: 77, rowBearingDeg: 40, spacingM: 240, rpm: 14 };

// Ocean shoreline of the barrier islands from Longport (278 T) to North Beach Haven (006 T),
// 17-36 km (config LAND.coast): beach line points (lat, lon, what stands behind: 0 city = Atlantic
// City blocks 18-30 m, 1 town = houses, dunes and a few condos 7-25 m, 2 dune = refuges, dunes and
// scrub 4-8 m); separate arrays end at inlets. ESTIMATED from charts to ~200 m.
const COAST = [
  [[39.3060, -74.5285, 1], [39.3165, -74.5130, 1], [39.3265, -74.4985, 1], [39.3390, -74.4760, 1], [39.3440, -74.4640, 0], [39.3480, -74.4520, 0],
    [39.3515, -74.4430, 0], [39.3545, -74.4350, 0], [39.3575, -74.4260, 0], [39.3610, -74.4150, 0], [39.3665, -74.4085, 0]],
  [[39.3765, -74.3985, 1], [39.3900, -74.3780, 1], [39.4020, -74.3610, 1], [39.4140, -74.3440, 2], [39.4300, -74.3230, 2]],
  [[39.4450, -74.3090, 2], [39.4600, -74.2980, 2], [39.4780, -74.2900, 2]],
  [[39.4950, -74.2850, 2], [39.5150, -74.2720, 2], [39.5400, -74.2550, 1], [39.5600, -74.2380, 1], [39.5800, -74.2210, 1], [39.6000, -74.2050, 1]],
];
const COAST_SETBACK_M = 110;          // ESTIMATED: first dune / building line behind the waterline
// Per kind: height range (m), albedo (linear), mean night glow of the strip (cd/m², patchy: lit
// blocks between dark ones), shore lights per km and their cd range. ESTIMATED.
const COAST_KIND = [
  { h: [18, 30], albedo: [0.30, 0.29, 0.27], glow: 0.02, perKm: 60, cd: [15, 500] },
  { h: [7, 25], albedo: [0.33, 0.31, 0.27], glow: 0.005, perKm: 28, cd: [8, 300] },
  { h: [4, 8], albedo: [0.28, 0.27, 0.20], glow: 0, perKm: 0, cd: [1, 1] },
];
// The Boardwalk (Atlantic City): ornamental lamp posts every ~30 m on the sea side of the casinos,
// ~25 m in front of the building line, lamps at 4.5 m. ESTIMATED 90 cd toward the sea, 3000 K LED.
const BOARDWALK = { pitchM: 30, offsetM: 25, y: 4.5, cd: 90 };

// ================================================================================================
// Photometric lamp sprites (shared with vessels.js)
// ================================================================================================
// A lamp of luminous intensity I (cd) toward the camera, with projected lens area A, has core
// radiance I / (A · 25,000) scene units (LOOK.sceneUnitLux); its irradiance at the camera is
// I / (d² · 25,000). A lens smaller than a pixel becomes a round spot of the same integrated
// intensity (a Gaussian below 2 px radius, so a sub-pixel core never reads as a '+'): distant lamps
// keep their true brightness. A tight glare halo (θ0 = 0.5 mrad) carries 2 % of the light, drawn
// only out to where it is 0.5 exposed (it is depth-tested per pixel; the wide glow is the bloom
// pass's job); extinction comes from the atmosphere's applyAerialTransmittance(). Same model as
// the farm's night lights, with horizontal sectors (COLREGS arcs) and vertical beams.
export const LAMP_BEAM = { aviation: 0, sidelight: 1, navigation: 2, omni: 3, flood: 4 };
const NV = NIGHT_LIGHTS.verticalBeam;
const f3 = (v) => v.toFixed(3);

const LAMP_VERTEX = /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec3 aLampPos;          // world position of the lamp centre
attribute vec4 aLamp;             // x intensity (cd), y projected lens area (m²), z level group, w beam kind
attribute vec3 aLampColor;        // linear RGB with unit luminance
attribute vec4 aLampAxis;         // xyz horizontal sector centre (world), w sector half-angle (rad; >= PI all-round)
uniform float uLevel[LAMP_GROUPS];
uniform vec2 uViewportPx;
uniform float uExposed;
uniform float uLampTime;
uniform float uHaloGain;          // 1 in views, 0 in the ocean's mirror pass (the sea spreads the core itself)
uniform float uFogDensity;
uniform float uFogHeightFalloff;
varying vec3 vCore;
varying vec3 vHalo;
varying vec3 vShape;              // x core radius, y halo θ0, z sprite half-size (px)
varying vec2 vOffset;
varying vec3 vLampWorld;
${HASH_GLSL}
// Vertical beams: FAA shielded obstruction light (config NIGHT_LIGHTS.verticalBeam: full at or above -1°, 3 % at -10°, 1 % below);
// COLREGS Annex I §10(a) navigation lights (full within ±5°, >= 60 % to ±7.5°, then an ESTIMATED
// 12° e-fold to a 12 % floor); a deck flood seen from outside its downward beam (0.4 %).
float beamOf(float kind, float el) {
	if (kind < 0.5) return el >= ${f3(NV.fullAboveDeg)} ? 1.0 : (el >= -10.0 ? mix(1.0, ${f3(NV.at10Deg)}, (${f3(NV.fullAboveDeg)} - el) / (${f3(NV.fullAboveDeg)} + 10.0)) : mix(${f3(NV.at10Deg)}, ${f3(NV.below)}, clamp((-10.0 - el) / 2.0, 0.0, 1.0)));
	float a = abs(el);
	if (kind < 2.5) return a <= 5.0 ? 1.0 : (a <= 7.5 ? mix(1.0, 0.6, (a - 5.0) / 2.5) : max(0.6 * exp(-(a - 7.5) / 12.0), 0.12));
	return kind < 3.5 ? 1.0 : mix(0.004, 1.0, smoothstep(3.0, 50.0, -el));
}
void main() {
	vLampWorld = aLampPos;
	vec3 toCam = cameraPosition - aLampPos;
	float d = max(length(toCam), 1e-3), kind = aLamp.w;
	vec3 up = normalize(vec3(aLampPos.x / ${EARTH_R.toFixed(1)}, 1.0, aLampPos.z / ${EARTH_R.toFixed(1)}));
	float beam = beamOf(kind, degrees(asin(clamp(dot(toCam, up) / d, -1.0, 1.0))));
	// horizontal sector (Annex I §9): sidelights cut off within 1-3° outside their arc; masthead and
	// stern lights may drop 50 % over the last 5° and cut off within 5° outside
	if (aLampAxis.w < 3.1 && length(toCam.xz) > 1e-3) {
		float ang = acos(clamp(dot(normalize(toCam.xz), normalize(aLampAxis.xz)), -1.0, 1.0));
		beam *= kind < 1.5 ? 1.0 - smoothstep(aLampAxis.w + 0.0087, aLampAxis.w + 0.0436, ang) : 1.0 - smoothstep(aLampAxis.w - 0.0873, aLampAxis.w + 0.0873, ang);
	}
	// scintillation over long sea paths (up to ±35 % beyond ~8 km)
	float h = 6.2831853 * hash13(aLampPos);
	float n = (sin(uLampTime * 44.6 + h) + sin(uLampTime * 71.0 + 2.3 * h) + sin(uLampTime * 112.5 + 3.7 * h)) * 0.8165;
	float I = aLamp.x * uLevel[int(aLamp.z + 0.5)] * beam * max(1.0 + 0.35 * (1.0 - exp(-d / 8000.0)) * n, 0.0);
	float focal = projectionMatrix[1][1] * 0.5 * uViewportPx.y;             // px per radian
	float rc = sqrt(aLamp.y / PI) / d * focal;
	vec3 core = aLampColor * (I * 0.98 / (aLamp.y * ${SCENE_LUX.toFixed(1)}));
	if (rc < 0.75) { core *= rc * rc / 0.5625; rc = 0.75; }
	vec3 halo = aLampColor * (uHaloGain * 0.02 * I / (d * d * ${SCENE_LUX.toFixed(1)}) / (PI * 2.5e-7));
	float h0 = 5e-4 * focal;
	// haze between the camera and the lamp thins the halo
	float hc = max(cameraPosition.y, 0.0) * uFogHeightFalloff, hb = max(aLampPos.y, 0.0) * uFogHeightFalloff, dh = hb - hc;
	float T = exp(-uFogDensity * d * (abs(dh) < 1e-4 ? exp(-hc) : (exp(-hc) - exp(-hb)) / dh));
	float rh = h0 * sqrt(max(sqrt(max(halo.r, max(halo.g, halo.b)) * T * uExposed / 0.5) - 1.0, 0.0));
	float R = min(max(max(rc + 1.5, rc < 2.0 ? 3.0 * sqrt(max(0.5 * rc * rc, 0.3844)) : 0.0), rh), 72.0);
	vCore = core;
	vHalo = halo;
	vShape = vec3(rc, h0, R);
	vOffset = position.xy * R;
	vec4 mvPosition = modelViewMatrix * vec4(aLampPos + toCam / d * min(0.25, 0.5 * d), 1.0);   // drawn 0.25 m toward the camera (lens housings)
	gl_Position = projectionMatrix * mvPosition;
	gl_Position.xy += position.xy * R * 2.0 / uViewportPx * gl_Position.w;
	if (I <= 0.0) gl_Position = vec4(0.0, 0.0, 2.0, 1.0);                 // dark lamp: beyond the far plane
	#include <logdepthbuf_vertex>
}`;
const LAMP_FRAGMENT = (atmosGlsl) => /* glsl */`
#include <common>
#include <logdepthbuf_pars_fragment>
${atmosGlsl}
varying vec3 vCore;
varying vec3 vHalo;
varying vec3 vShape;
varying vec2 vOffset;
varying vec3 vLampWorld;
void main() {
	#include <logdepthbuf_fragment>
	float r = length(vOffset), rc = vShape.x, s2 = max(0.5 * rc * rc, 0.3844);
	// resolved lamps: a disc with a 1 px linear edge whose integral is exactly π rc²; small ones: a
	// round Gaussian spot with the same integral. Halo profile (1 + (θ/θ0)²)^-2, feathered to the sprite edge.
	float core = rc < 2.0 ? rc * rc / (2.0 * s2) * exp(-0.5 * r * r / s2) : clamp(rc + 0.5 - r, 0.0, 1.0) * rc * rc / (rc * rc + 0.0833);
	float q = 1.0 + (r / vShape.y) * (r / vShape.y), u = 1.0 - min(r / vShape.z, 1.0) * min(r / vShape.z, 1.0);
	gl_FragColor = vec4(applyAerialTransmittance(vCore * core + vHalo * u * u / (q * q), vLampWorld), 0.0);
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`;
// Bare test pages without an atmosphere: unattenuated, absolute units.
export const NO_ATMOSPHERE_GLSL = 'vec3 applyAerialTransmittance(vec3 c, vec3 p) { return c; }\nvec3 applyAerialPerspective(vec3 c, vec3 p) { return c; }\nfloat cloudShadow(vec3 p) { return 1.0; }';

// CIE 1931 (x, y) -> linear sRGB with unit luminance (out-of-gamut negatives clipped).
export function chromaticityToLinear([x, y]) {
  const X = x / y, Z = (1 - x - y) / y;
  return unitLuminance([3.2406 * X - 1.5372 - 0.4986 * Z, -0.9689 * X + 1.8758 + 0.0415 * Z, 0.0557 * X - 0.2040 + 1.0570 * Z].map((v) => Math.max(0, v)));
}
// Lamp chromaticities (CIE x, y). Aviation red per FAA AC 150/5345-43 LED; COLREGS Annex I §7
// regions for navigation lights; warm/cool white and HPS street light typical values. ESTIMATED
// inside the standard regions.
export const LAMP_XY = {
  aviationRed: [0.690, 0.300], navRed: [0.680, 0.310], navGreen: [0.170, 0.700], navWhite: [0.335, 0.345],
  warmWhite: [0.437, 0.404], neutralWhite: [0.380, 0.377], sodium: [0.530, 0.415],
};

/**
 * Instanced camera-facing lamp sprites with photometric sizing.
 *   new PhotometricLamps({ name, count, groups, atmosphere, dynamic })
 *   lamps.set(i, { position, cd, area, group, beam, xy | colour, axis, halfAngleRad })
 *   lamps.setPosition(i, v) / setAxis(i, dir, halfAngleRad)   (dynamic lamps; then markMoved())
 *   lamps.update(t, exposed)   levels: lamps.levels[group] = 0..1 before update
 * The mesh is on LAYER_REFLECT (lamps glint in the ocean's planar reflection) and writes no alpha.
 */
export class PhotometricLamps {
  constructor({ name = 'lamps', count, groups = 1, atmosphere = null, dynamic = false }) {
    this.count = count;
    this.levels = new Array(groups).fill(0);
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    const attr = (name, size, fill = 0) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(count * size).fill(fill), size); geo.setAttribute(name, a); return a; };
    this.pos = attr('aLampPos', 3); this.lamp = attr('aLamp', 4); this.colour = attr('aLampColor', 3); this.axis = attr('aLampAxis', 4, Math.PI);
    if (dynamic) for (const a of [this.pos, this.axis, this.lamp]) a.setUsage(THREE.DynamicDrawUsage);
    geo.instanceCount = count;
    this.uniforms = {
      ...(atmosphere?.uniforms || {}), uFogDensity: U.uFogDensity, uFogHeightFalloff: U.uFogHeightFalloff,
      uLevel: { value: this.levels }, uViewportPx: { value: new THREE.Vector2(1, 1) }, uExposed: { value: 1 }, uLampTime: { value: 0 }, uHaloGain: { value: 1 },
    };
    this.material = new THREE.ShaderMaterial({
      name, defines: { LAMP_GROUPS: groups }, uniforms: this.uniforms,
      vertexShader: LAMP_VERTEX, fragmentShader: LAMP_FRAGMENT(atmosphere?.glsl || NO_ATMOSPHERE_GLSL),
      transparent: true, depthWrite: false,
      // pure emission: add RGB, leave alpha (the ocean's mirror target reads alpha as coverage)
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.name = name;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    this.mesh.visible = false;
    this.mesh.layers.enable(LAYER_REFLECT);
    // Sprite sizes are in pixels of whatever is being rendered (the view or the ocean's mirror). The
    // mirror camera sees only LAYER_REFLECT: there the glare halo (a camera-lens effect) is left out.
    const viewport = new THREE.Vector4();
    this.mesh.onBeforeRender = (renderer, scene, camera) => {
      renderer.getCurrentViewport(viewport);
      this.uniforms.uViewportPx.value.set(Math.max(1, viewport.z), Math.max(1, viewport.w));
      this.uniforms.uHaloGain.value = +camera.layers.isEnabled(0);
      this.material.uniformsNeedUpdate = true;
    };
  }

  set(i, { position, cd, area, group = 0, beam = LAMP_BEAM.omni, xy = null, colour = null, axis = null, halfAngleRad = Math.PI }) {
    position.toArray(this.pos.array, i * 3);
    this.lamp.array.set([cd, area, group, beam], i * 4);
    this.colour.array.set(colour || chromaticityToLinear(xy || LAMP_XY.warmWhite), i * 3);
    this.setAxis(i, axis, halfAngleRad);
  }
  setPosition(i, v) { v.toArray(this.pos.array, i * 3); }
  setAxis(i, dir, halfAngleRad = Math.PI) { this.axis.array.set(dir ? [dir.x, 0, dir.z, halfAngleRad] : [0, 0, -1, halfAngleRad], i * 4); }
  /** Intensity of lamp i (cd): e.g. to dim floods or switch a lamp off without re-packing. */
  setIntensity(i, cd) { this.lamp.array[i * 4] = cd; this.lamp.needsUpdate = true; }
  markMoved() { this.pos.needsUpdate = this.axis.needsUpdate = true; }
  markAll() { this.markMoved(); this.lamp.needsUpdate = this.colour.needsUpdate = true; }

  update(t, exposed) {
    this.mesh.visible = this.levels.some((l) => l > 0);
    this.uniforms.uLampTime.value = t;
    this.uniforms.uExposed.value = exposed;
  }

  dispose() { this.mesh.parent?.remove(this.mesh); this.mesh.geometry.dispose(); this.material.dispose(); }
}

/** Scene radiance -> exposed units (sizes lamp halos), from Post or the renderer. */
export function exposedScale(ctx) {
  const e = ctx.post?.exposure, pre = ctx.atmosphere?.preExposure;
  return Number.isFinite(e) && e > 0 ? e : ctx.renderer.toneMappingExposure * (Number.isFinite(pre) ? pre : 1);
}

/** Sun elevation (deg) from the atmosphere, or from U.uSunDir when it is absent. */
export function sunElevationDeg(ctx) {
  const e = ctx.atmosphere?.sunElevationDeg;
  return Number.isFinite(e) ? e : Math.asin(clamp(U.uSunDir.value.y, -1, 1)) / DEG;
}

// FAA flashing red obstruction lights (L-864 medium intensity, 2000 cd, 30 fpm, 0.5 s on, 50 ms LED
// edges), switched to night mode below -0.5° sun elevation (photocell).
const L864 = NIGHT_LIGHTS.l864;
const AV_PHASES = 6;
function flashLevel(t, phaseS = 0) {
  const ph = (((t + phaseS) % L864.periodS) + L864.periodS) % L864.periodS;
  return Math.min(ph / 0.05, 1, 1 - clamp((ph - L864.onS) / 0.05, 0, 1));
}

// ================================================================================================
// Facade material: rooms (day albedo, night window light), crowns, floodlit facades, LED signage
// ================================================================================================
const FACADE_UNIFORMS = {
  uLandLit: { value: 0.3 },                          // fraction of rooms lit
  uLandWindowL: { value: WINDOW_CDM2 / SCENE_LUX },  // lit-room glass luminance (scene units)
  uLandCrown: { value: 0 },                          // architectural lighting and signage on (0..1)
  uLandTime: { value: 0 },
};
// aFacade: metres along the facade and above the part's base; aBldg: x seed, y rooms (0 none,
// 1 punched windows, 2 curtain wall), z crown / sign band start (m), w 0 steady, 1 LED colour
// cycling, 2 signage panels; aGlow: rgb (linear, unit luminance), a luminance (scene units).
const FACADE_VERT = /* glsl */`
attribute vec2 aFacade;
attribute vec4 aBldg;
attribute vec4 aGlow;
attribute vec3 aGlass;
varying vec3 vGlass;
varying vec2 vFacade;
varying vec4 vBldg;
varying vec4 vGlow;
`;
const FACADE_FRAG_PARS = /* glsl */`
uniform float uLandLit;
uniform float uLandWindowL;
uniform float uLandCrown;
uniform float uLandTime;
varying vec3 vGlass;
varying vec2 vFacade;
varying vec4 vBldg;
varying vec4 vGlow;
float lHash(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
// box-filtered 1D pulse on [a, b] of a unit cell, for a pixel footprint w (cells)
float lPulse(float x, float a, float b, float w) {
	w = max(w, 1e-4);
	float x0 = x - 0.5 * w, x1 = x + 0.5 * w;
	return (floor(x1) * (b - a) + clamp(fract(x1), a, b) - floor(x0) * (b - a) - clamp(fract(x0), a, b)) / w;
}
vec3 lHue(float h) { return clamp(abs(fract(h + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0, 0.0, 1.0); }
`;
// After <color_fragment>: lWin (lit glass radiance) and the glass blended into the cladding. Rooms:
// hotel floors fill in blocks (per floor section, patchy: lit fraction ∝ hash²), each room its own
// curtains (open in 40 %, else a dim glow) and lamp colour (2700-4000 K, a few blue TV-lit rooms);
// ~8 % of bay columns are lit stair / lift lobbies (cool, every floor). Once a pixel covers several
// rooms the facade takes their mean, block by block.
const FACADE_FRAG_COLOR = /* glsl */`
vec3 lWin = vec3(0.0);
float lGlass = 0.0;
if (vBldg.y > 0.5) {
	vec2 q = vFacade / vec2(${BAY_W.toFixed(2)}, ${FLOOR_H.toFixed(2)}), fw = fwidth(q), cell = floor(q);
	bool curtain = vBldg.y > 1.5;
	lGlass = lPulse(q.x, curtain ? 0.04 : 0.12, curtain ? 0.96 : 0.88, fw.x) * lPulse(q.y, curtain ? 0.1 : 0.22, curtain ? 0.92 : 0.86, fw.y);
	float hb = lHash(floor(cell / vec2(5.0, 1.0)) + vBldg.x * 13.1), pLit = clamp(3.0 * uLandLit * hb * hb, 0.0, 1.0);
	float hr = lHash(cell + vBldg.x * 7.7), hc = lHash(cell + 3.7), lobby = step(0.92, lHash(vec2(cell.x, vBldg.x))), hd = fract(hr * 17.3);
	float resolved = 1.0 - smoothstep(0.35, 1.2, max(fw.x, fw.y));
	vec3 tint = hc < 0.55 ? vec3(1.0, 0.78, 0.55) : (hc < 0.8 ? vec3(1.0, 0.86, 0.7) : (hc < 0.95 ? vec3(0.95, 0.97, 1.0) : vec3(0.55, 0.72, 1.0)));
	vec3 room = step(hr, pLit) * mix(0.06 + 0.19 * hd, 0.6 + 0.4 * hd, step(0.6, fract(hr * 29.7))) * tint;
	lWin = uLandWindowL * lGlass * max(mix(pLit * ${ROOM_MEAN.toFixed(2)} * vec3(1.0, 0.85, 0.68), room, resolved), lobby * ${LOBBY.toFixed(2)} * vec3(0.9, 0.96, 1.0));
	diffuseColor.rgb = mix(diffuseColor.rgb, vGlass, lGlass * 0.85);
}
`;
const FACADE_FRAG_EMISSIVE = /* glsl */`
totalEmissiveRadiance += lWin;
if (vGlow.a > 0.0 && vFacade.y >= vBldg.z) {
	float band = vBldg.z > 1.0 ? smoothstep(vBldg.z, vBldg.z + 3.0, vFacade.y) : 1.0;
	vec3 gc = vGlow.rgb;
	if (vBldg.w > 1.5) {
		// casino signage: LED screens and lettering, ~8-11 m panels in two of three 14 m bays, each its
		// own hue and changing content
		float c = floor(vFacade.x / 14.0), hs = lHash(vec2(c, vBldg.x));
		band *= step(0.33, hs) * step(0.2 + 0.2 * hs, fract(vFacade.x / 14.0)) * (0.35 + 0.65 * lHash(vec2(c, floor(uLandTime * 0.4 + hs * 7.0))));
		gc = mix(gc, lHue(hs) * 1.4, 0.7);
	} else if (vBldg.w > 0.5) gc = lHue(uLandTime * 0.02 + vFacade.y * 0.002) * 0.6 + gc * 0.4;
	else band *= 0.35 + 0.65 * exp((vBldg.z - vFacade.y) / 70.0);   // uplights: brightest just above the fixtures
	totalEmissiveRadiance += gc * (vGlow.a * uLandCrown * band);
}
`;
function createFacadeMaterial() {
  const mat = new THREE.MeshStandardMaterial({ name: 'land.facade', vertexColors: true, roughness: 0.82 });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, FACADE_UNIFORMS);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + FACADE_VERT)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFacade = aFacade; vBldg = aBldg; vGlow = aGlow; vGlass = aGlass;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FACADE_FRAG_PARS)
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + FACADE_FRAG_COLOR)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.12, lGlass * 0.85);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + FACADE_FRAG_EMISSIVE);
  };
  mat.customProgramCacheKey = () => 'land-facade-v2';
  return applyAtmosphere(mat);
}

// ================================================================================================
// Geometry builders
// ================================================================================================
// Accumulates non-indexed triangles with the facade attribute set. `m`: { col (cladding, linear),
// glass (tint, linear), bldg (aBldg), glow (aGlow) }.
class FacadeBuilder {
  constructor() { this.a = { position: [], normal: [], color: [], aGlass: [], aFacade: [], aBldg: [], aGlow: [] }; }
  // quad a-b-c-d, counter-clockwise seen from its front, flat normal n; f* = facade coordinates
  quad(a, b, c, d, n, m, fa, fb, fc, fd) { for (const [v, f] of [[a, fa], [b, fb], [c, fc], [a, fa], [c, fc], [d, fd]]) this.vertex(v, n, m, f); }
  vertex(v, n, m, f = [0, 0]) {
    const A = this.a;
    A.position.push(v.x, v.y, v.z); A.normal.push(n.x, n.y, n.z); A.color.push(...m.col); A.aGlass.push(...m.glass);
    A.aFacade.push(...f); A.aBldg.push(...m.bldg); A.aGlow.push(...m.glow);
  }
  geometry(name) {
    const g = new THREE.BufferGeometry();
    for (const [k, v] of Object.entries(this.a)) g.setAttribute(k, new THREE.Float32BufferAttribute(v, { aFacade: 2, aBldg: 4, aGlow: 4 }[k] || 3));
    g.computeBoundingSphere();
    g.name = name;
    return g;
  }
}

// Footprint outline (counter-clockwise seen from above; local frame: +x along the long axis):
// b slab, s stadium (Ocean Casino), a slab bent on a circle (Borgata, Harrah's: sagitta L/8).
function footprint(plan, L, W) {
  const pts = [];
  if (plan === 's') {
    const r = W / 2, half = L / 2 - r;
    for (const [sx, a0] of [[1, -0.5], [-1, 0.5]]) for (let i = 0; i <= 8; i++) { const a = Math.PI * (a0 + i / 8); pts.push([sx * half + r * Math.cos(a), r * Math.sin(a)]); }
  } else if (plan === 'a') {
    const sag = L / 8, R = (L * L / 4 + sag * sag) / (2 * sag), span = 2 * Math.asin(L / 2 / R), cz = R - sag / 2;
    for (const rr of [R + W / 2, R - W / 2]) for (let i = 0; i <= 10; i++) { const a = span * ((rr > R ? i : 10 - i) / 10 - 0.5); pts.push([rr * Math.sin(a), cz - rr * Math.cos(a)]); }
  } else pts.push([L / 2, -W / 2], [L / 2, W / 2], [-L / 2, W / 2], [-L / 2, -W / 2]);
  // counter-clockwise seen from above (+y; north up, east right) has a negative signed area in (x, z)
  let area = 0;
  pts.forEach(([x0, z0], i) => { const [x1, z1] = pts[(i + 1) % pts.length]; area += x0 * z1 - x1 * z0; });
  return area > 0 ? pts.reverse() : pts;
}

// Extrudes a footprint into walls + roof in world space; the roof falls by `slant` toward the
// footprint's -x end (a sail-cut crown).
function addPrism(B, { cx, cz, axisDeg, pts, base, height, slant = 0, col, glass = col, roof, rooms = 0, seed = 0, glow = null, crownFrom = 0, mode = 0 }) {
  const a = axisDeg * DEG, ex = [Math.sin(a), -Math.cos(a)], ez = [Math.cos(a), Math.sin(a)];   // local +x = the long-axis bearing, +z = 90° clockwise
  const L = Math.max(...pts.map((p) => p[0])) - Math.min(...pts.map((p) => p[0]));
  const topAt = (lx) => height - slant * clamp(0.5 - lx / Math.max(L, 1), 0, 1);
  const world = (lx, lz, y) => new THREE.Vector3(cx + ex[0] * lx + ez[0] * lz, y, cz + ex[1] * lx + ez[1] * lz);
  const wall = { col, glass, bldg: [seed, rooms, crownFrom, mode], glow: glow ? [...glow.rgb, glow.L] : [0, 0, 0, 0] };
  const top = { col: roof, glass: roof, bldg: [seed, 0, 0, 0], glow: [0, 0, 0, 0] }, upV = new THREE.Vector3(0, 1, 0);
  let u = 0;
  pts.forEach(([x0, z0], i) => {
    const [x1, z1] = pts[(i + 1) % pts.length], len = Math.hypot(x1 - x0, z1 - z0);
    if (len < 1e-3) return;
    const t0 = topAt(x0), t1 = topAt(x1), a0 = world(x0, z0, base), a1 = world(x1, z1, base);
    B.quad(a0, a1, world(x1, z1, base + t1), world(x0, z0, base + t0), new THREE.Vector3().subVectors(a1, a0).cross(upV).normalize(), wall, [u, 0], [u + len, 0], [u + len, t1], [u, t0]);
    u += len;
  });
  for (const tri of THREE.ShapeUtils.triangulateShape(pts.map(([x, z]) => new THREE.Vector2(x, z)), [])) {
    const [va, vb, vc] = tri.map((i) => world(pts[i][0], pts[i][1], base + topAt(pts[i][0])));
    const n = new THREE.Vector3().subVectors(vb, va).cross(new THREE.Vector3().subVectors(vc, va)), flip = n.y < 0;
    n.normalize().multiplyScalar(flip ? -1 : 1);
    for (const v of flip ? [va, vc, vb] : [va, vb, vc]) B.vertex(v, n, top);
  }
}

// ================================================================================================
// Land
// ================================================================================================
export class Land {
  /** @param {object} ctx { renderer, scene, camera, quality, atmosphere?, clock?, post?, ocean? } */
  constructor(ctx) {
    this.ctx = ctx;
    this.root = new THREE.Group();
    this.root.name = 'land';
    ctx.scene.add(this.root);
    this.rng = mulberry32(0x1a4d5eed);
    this.facadeMaterial = createFacadeMaterial();
    this.distant = [];                    // night lights for the ocean: { x, y, z, cd, color, width?, beam?, flash?, kind }
    this.aviation = [];                   // { position, cd, phase, onshore? }: flashing red L-864s
    this._buildTowers();
    this._buildCoast();
    this._buildOnshoreWind();
    this._buildLamps();
    this._spin = 0;
    this._published = [-1, -1, -1, -1];
    if (globalThis.NJOW_DEV !== false) registerLandScales(this);
  }

  // ---------------------------------------------------------------- towers
  _buildTowers() {
    const B = new FacadeBuilder(), roof = [0.09, 0.09, 0.09];
    this.buildings = [];
    TOWERS.forEach(([lat, lon, H, L, W, axis, plan, form, clad, curtain, crown, podium], k) => {
      const p = geoToLocal(lat, lon), base = -curvatureDrop(p.x, p.z) - 2.0;   // parts start 2 m below the local MSL: no gap on the curved sea
      const col = lin(clad), glow = crown && { rgb: unitLuminance(lin(crown[0])), L: crown[1] / SCENE_LUX };
      for (const [a, b, kl, kw, rooms] of FORMS[form]) {
        const h0 = a < 0 ? H + a : a * H, h1 = b < 0 ? H + b : b * H, y0 = h0 ? base + 2 + h0 : base;
        addPrism(B, {
          cx: p.x, cz: p.z, axisDeg: axis, pts: footprint(kl === 1 ? plan : 'b', L * kl, W * kw), base: y0, height: base + 2 + h1 - y0, slant: form === 's' ? 18 : 0,
          col: rooms ? col : col.map((c) => c * 0.8), glass: curtain ? col.map((c) => c * 0.35) : [0.08, 0.09, 0.10], roof, seed: 11.3 * (k + 1), rooms: rooms && (curtain ? 2 : 1),
          glow, crownFrom: crown ? crown[2] * H + 2 + base - y0 : 0, mode: crown?.[3] || 0,
        });
      }
      if (podium) {
        // casino podium on the Boardwalk side (axis + 90°), LED signage on its upper walls
        const [pl, pw, ph, sign] = podium, a = (axis + 90) * DEG, px = p.x + Math.sin(a) * 0.2 * pw, pz = p.z - Math.cos(a) * 0.2 * pw, sc = unitLuminance(lin(sign));
        addPrism(B, { cx: px, cz: pz, axisDeg: axis, pts: footprint('b', pl, pw), base: -curvatureDrop(px, pz) - 2.0, height: ph + 2.0, col: [0.36, 0.34, 0.31], roof, seed: 7.1 * (k + 1),
          glow: { rgb: sc, L: SIGN_CDM2 / SCENE_LUX }, crownFrom: 0.55 * ph, mode: 2 });
        this.distant.push({ x: px, y: 0.8 * ph, z: pz, cd: SIGN_CDM2 * 0.72 * pl * 0.45 * ph, color: sc, width: pl, kind: 'sign' });
      }
      this.buildings.push({ name: TOWER_NAMES[k], height: H, x: p.x, z: p.z, distanceM: Math.hypot(p.x, p.z), bearingDeg: (Math.atan2(p.x, -p.z) / DEG + 360) % 360, baseY: base + 2.0 });
      // the lit facade as one source for the ocean: mean room luminance over the face toward the sea
      this.distant.push({ x: p.x, y: base + 2 + 0.45 * H, z: p.z, cd: WINDOW_CDM2 * 0.3 * ROOM_MEAN * (curtain ? 0.75 : 0.5) * 0.8 * L * 0.85 * H + (crown ? crown[1] * 0.8 * L * (1 - crown[2]) * H : 0),
        color: unitLuminance([1, 0.85, 0.68]), width: 0.8 * L, kind: 'facade' });
      // FAA AC 70/7460-1: structures above 200 ft (61 m) carry flashing red L-864s at the top (two,
      // on the plant corners or the high end of a sail top) and, above 350 ft (107 m), two more at
      // mid height just outside the end walls. Buildings flash independently. ESTIMATED placement.
      if (H >= 61) {
        const a = axis * DEG, phase = this.rng() * L864.periodS, s = form === 's';
        const spots = [1, -1].map((sg) => (s ? [0.4 * L, sg * 0.35 * W, H - 1.3] : [sg * 0.13 * L, 0, H + 0.5]));
        if (H > 107) spots.push([0.5 * L + 0.6, 0, 0.5 * H], [-0.5 * L - 0.6, 0, 0.5 * H]);
        for (const [lx, lz, y] of spots) this.aviation.push({ position: new THREE.Vector3(p.x + Math.sin(a) * lx + Math.cos(a) * lz, base + 2.0 + y, p.z - Math.cos(a) * lx + Math.sin(a) * lz), cd: L864.cd, phase });
      }
    });
    this._buildMidrise(B, roof);
    this.towerMesh = new THREE.Mesh(B.geometry('land.towers'), this.facadeMaterial);
    this.towerMesh.name = 'land.towers';
    this.towerMesh.layers.enable(LAYER_REFLECT);           // lit facades and crowns in the ocean's mirror
    this.root.add(this.towerMesh);
  }

  _buildMidrise(B, roof) {
    const rng = mulberry32(0x3d1e7a), M = MIDRISE;
    const towers = TOWERS.map((T) => ({ ...geoToLocal(T[0], T[1]), r: Math.max(T[3], T[4]) * 0.6 + 20 }));
    this.midriseCount = 0;
    const place = (x, z, axis, k) => {
      if (towers.some((t) => Math.hypot(t.x - x, t.z - z) < t.r)) return;
      const h = 24 + 48 * rng() * rng(), L = 25 + 45 * rng(), W = 18 + 22 * rng(), tone = 0.34 + 0.16 * rng();
      addPrism(B, { cx: x, cz: z, axisDeg: axis, pts: footprint('b', L, W), base: -curvatureDrop(x, z) - 2.0, height: h + 2.0, col: [tone, tone * 0.97, tone * 0.92], glass: [0.07, 0.08, 0.09], roof, rooms: 1, seed: 101.7 + 5.3 * k });
      this.midriseCount++;
    };
    const a = geoToLocal(...M.from), b = geoToLocal(...M.to), len = Math.hypot(b.x - a.x, b.z - a.z), ux = (b.x - a.x) / len, uz = (b.z - a.z) / len;
    const inland = Math.sign(uz * a.x - ux * a.z) || 1, nx = inland * uz, nz = -inland * ux;   // away from the hero
    const axis = (Math.atan2(ux, -uz) / DEG + 360) % 360;
    for (let k = 0; k < M.count; k++) {
      const f = rng(), d = 60 + 460 * rng();
      place(a.x + ux * len * f + nx * d, a.z + uz * len * f + nz * d, axis + (rng() < 0.5 ? 0 : 90), k);
    }
    const c = geoToLocal(...M.marina);
    for (let k = 0; k < M.marinaCount; k++) {
      const r = M.marinaR * Math.sqrt(rng()), th = rng() * 2 * Math.PI;
      place(c.x + Math.cos(th) * r, c.z + Math.sin(th) * r, rng() * 180, 100 + k);
    }
  }

  // ---------------------------------------------------------------- coast strip, shore lights, Boardwalk
  _buildCoast() {
    const B = new FacadeBuilder(), rng = mulberry32(0xc0a57), warm = unitLuminance(lin('#ffb877'));
    this.shoreLights = [];
    for (const stretch of COAST) {
      // resample every 60 m, offset landward (away from the hero side of the line) by the setback
      const pts = stretch.map(([lat, lon, kind]) => ({ ...geoToLocal(lat, lon), kind })), S = [];
      pts.forEach((a, i) => {
        const b = pts[i + 1];
        if (!b) return S.push({ x: a.x, z: a.z, kind: a.kind });
        const n = Math.max(1, Math.round(Math.hypot(b.x - a.x, b.z - a.z) / 60));
        for (let s = 0; s < n; s++) S.push({ x: a.x + (b.x - a.x) * s / n, z: a.z + (b.z - a.z) * s / n, kind: s / n < 0.5 ? a.kind : b.kind });
      });
      S.map((p, i) => {
        const q = S[Math.min(i + 1, S.length - 1)], o = S[Math.max(i - 1, 0)], tl = Math.hypot(q.x - o.x, q.z - o.z) || 1, nx = (q.z - o.z) / tl, nz = -(q.x - o.x) / tl;
        return nx * p.x + nz * p.z < 0 ? [-nx, -nz] : [nx, nz];     // landward normals of the beach line, then the offset
      }).forEach(([nx, nz], i) => {
        const p = S[i];
        Object.assign(p, { nx, nz, x: p.x + nx * COAST_SETBACK_M, z: p.z + nz * COAST_SETBACK_M });
        const K = COAST_KIND[p.kind], r = rng();
        p.h = K.h[0] + (K.h[1] - K.h[0]) * (0.35 * r + 0.45 * rng() * rng() + (r > 0.93 ? 0.2 : 0));   // dunes, house rows, the odd taller block
      });
      let u = 0, walk = 0;
      for (let i = 0; i < S.length - 1; i++) {
        const a = S[i], b = S[i + 1], len = Math.hypot(b.x - a.x, b.z - a.z), K = COAST_KIND[a.kind];
        const ya = -curvatureDrop(a.x, a.z) - 2.0, yb = -curvatureDrop(b.x, b.z) - 2.0;
        const A0 = new THREE.Vector3(a.x, ya, a.z), B0 = new THREE.Vector3(b.x, yb, b.z), A1 = new THREE.Vector3(a.x, ya + 2.0 + a.h, a.z), B1 = new THREE.Vector3(b.x, yb + 2.0 + b.h, b.z);
        const n = new THREE.Vector3(-(a.nx + b.nx) / 2, 0, -(a.nz + b.nz) / 2).normalize();   // facing the sea
        const col = K.albedo.map((v) => v * (0.85 + 0.3 * rng()));
        const m = { col, glass: col, bldg: [rng() * 50, 0, 0, 0], glow: [...warm, rng() < 0.55 ? K.glow * 2 * rng() / SCENE_LUX : 0] };
        if (new THREE.Vector3().subVectors(B0, A0).cross(new THREE.Vector3().subVectors(A1, A0)).dot(n) >= 0) B.quad(A0, B0, B1, A1, n, m, [u, 0], [u + len, 0], [u + len, b.h], [u, a.h]);
        else B.quad(B0, A0, A1, B1, n, m, [u + len, 0], [u, 0], [u, a.h], [u + len, b.h]);
        u += len;
        // shore lights between the beach and the first building line (street lamps, lit windows and
        // signs seen from the sea), log-distributed in intensity: most are dim
        const expected = K.perKm * len / 1000;
        for (let k = Math.floor(expected) + (rng() < expected % 1); k > 0; k--) {
          const f = rng(), x = a.x + (b.x - a.x) * f - a.nx * 40 * rng(), z = a.z + (b.z - a.z) * f - a.nz * 40 * rng(), y = 3 + (a.h + (b.h - a.h) * f) * rng();
          const cd = K.cd[0] * Math.pow(K.cd[1] / K.cd[0], rng() * rng()), xyr = rng();
          this.shoreLights.push({ position: new THREE.Vector3(x, -curvatureDrop(x, z) + y, z), cd, xy: xyr < 0.4 ? LAMP_XY.sodium : (xyr < 0.8 ? LAMP_XY.warmWhite : LAMP_XY.neutralWhite) });
        }
        // the Boardwalk: a regular string of lamp posts in front of the city blocks
        if (a.kind) walk = u;
        else for (; walk < u; walk += BOARDWALK.pitchM) {
          const f = 1 - (u - walk) / len, x = a.x + (b.x - a.x) * f - a.nx * BOARDWALK.offsetM, z = a.z + (b.z - a.z) * f - a.nz * BOARDWALK.offsetM;
          this.shoreLights.push({ position: new THREE.Vector3(x, -curvatureDrop(x, z) + BOARDWALK.y, z), cd: BOARDWALK.cd, xy: LAMP_XY.warmWhite, walk: true });
        }
      }
    }
    this.coastMesh = new THREE.Mesh(B.geometry('land.coast'), this.facadeMaterial);
    this.coastMesh.name = 'land.coast';
    this.coastMesh.layers.enable(LAYER_REFLECT);
    this.root.add(this.coastMesh);
    // the shore lights for the ocean, merged into ~400 m cells along the coast
    const cells = new Map();
    for (const s of this.shoreLights) {
      const key = `${Math.round(s.position.x / 400)},${Math.round(s.position.z / 400)}`, c = cells.get(key) || { x: 0, y: 0, z: 0, cd: 0 };
      c.x += s.position.x * s.cd; c.y += s.position.y * s.cd; c.z += s.position.z * s.cd; c.cd += s.cd;
      cells.set(key, c);
    }
    for (const c of cells.values()) this.distant.push({ x: c.x / c.cd, y: c.y / c.cd, z: c.z / c.cd, cd: c.cd, color: chromaticityToLinear(LAMP_XY.warmWhite), width: 400, kind: 'shore' });
  }

  // ---------------------------------------------------------------- Jersey-Atlantic Wind Farm
  _buildOnshoreWind() {
    const O = ONSHORE, c = geoToLocal(O.lat, O.lon), row = O.rowBearingDeg * DEG;
    this.onshore = Array.from({ length: O.count }, (_, i) => {
      const s = (i - (O.count - 1) / 2) * O.spacingM, x = c.x + Math.sin(row) * s, z = c.z - Math.cos(row) * s;
      return { x, z, baseY: -curvatureDrop(x, z) + 1.5, phase: this.rng() * 2 * Math.PI };   // ground ~1.5 m above MSL (marsh fill)
    });
    const white = this.onshoreMaterial = applyAtmosphere(new THREE.MeshStandardMaterial({ name: 'land.onshoreWind', color: new THREE.Color(0.62, 0.63, 0.61), roughness: 0.5 }));
    // towers (static, merged): 4.3 m base, 2.6 m top, up to the nacelle floor
    const tower = new THREE.CylinderGeometry(1.3, 2.15, O.hubHeight - 1.8, 16).translate(0, (O.hubHeight - 1.8) / 2, 0);
    this.onshoreTowers = new THREE.Mesh(mergeGeometries(this.onshore.map((p) => tower.clone().translate(p.x, p.baseY, p.z))), white);
    tower.dispose();
    // nacelle (3.4 x 3.6 x 8.6 m) + hub, and the rotor (3 blades + spinner): instanced, yaw + spin in the instance matrix
    const nac = new THREE.BoxGeometry(3.4, 3.6, 8.6).translate(0, 0, -3.02), hub = new THREE.SphereGeometry(1.3, 12, 8).scale(1, 1, 1.4).translate(0, 0, 3.2);
    this.nacelleGeometry = mergeGeometries([nac, hub]);
    nac.dispose(); hub.dispose();
    this.bladeGeometry = onshoreRotorGeometry(O.rotorDiameter / 2, 3.2);
    this.onshoreNacelles = new THREE.InstancedMesh(this.nacelleGeometry, white, O.count);
    this.onshoreRotors = new THREE.InstancedMesh(this.bladeGeometry, white, O.count);
    this.onshoreTowers.name = 'land.onshoreWind.towers';
    this.onshoreNacelles.name = 'land.onshoreWind.nacelles';
    this.onshoreRotors.name = 'land.onshoreWind.rotors';
    for (const m of [this.onshoreTowers, this.onshoreNacelles, this.onshoreRotors]) { m.layers.enable(LAYER_REFLECT); this.root.add(m); }
    for (const p of this.onshore) this.aviation.push({ position: new THREE.Vector3(p.x, p.baseY + O.hubHeight + 2.3, p.z), cd: L864.cd, phase: 0, onshore: true });
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(0, 0, 0, 'YXZ'); this._v = new THREE.Vector3(); this._s = new THREE.Vector3(1, 1, 1);
    this._setRotors(0);
    // the rotors spin and yaw about fixed hubs: one bounding sphere (with margin) lets both the view
    // and the ocean's mirror pass cull the 19 km-away wind farm when it is out of frame
    for (const m of [this.onshoreNacelles, this.onshoreRotors]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.computeBoundingSphere();
      m.boundingSphere.radius += 12;
    }
  }

  _setRotors(spin) {
    // the rotor faces into the wind (U.uWind is the vector the air moves toward); shaft tilt 5°
    const w = U.uWind.value, fromDeg = w.lengthSq() > 1e-6 ? Math.atan2(w.x, -w.y) / DEG + 180 : SEA.windFromDeg, yaw = Math.PI - fromDeg * DEG;
    this.onshore.forEach((p, i) => {
      this._v.set(p.x, p.baseY + ONSHORE.hubHeight, p.z);
      this.onshoreNacelles.setMatrixAt(i, this._m.compose(this._v, this._q.setFromEuler(this._e.set(0, yaw, 0)), this._s));
      this.onshoreRotors.setMatrixAt(i, this._m.compose(this._v, this._q.setFromEuler(this._e.set(-5 * DEG, yaw, spin + p.phase)), this._s));
    });
    this.onshoreNacelles.instanceMatrix.needsUpdate = this.onshoreRotors.instanceMatrix.needsUpdate = true;
  }

  // ---------------------------------------------------------------- lamps
  _buildLamps() {
    // Level groups: 0 shore lights (dusk to dawn), 1 onshore wind farm L-864s (flashing in unison,
    // FAA §13.5), 2.. building L-864s in AV_PHASES flash phases (buildings are independent).
    const lamps = this.lamps = new PhotometricLamps({ name: 'land.lamps', count: this.shoreLights.length + this.aviation.length, groups: 2 + AV_PHASES, atmosphere: this.ctx.atmosphere });
    let i = 0;
    for (const s of this.shoreLights) lamps.set(i++, { position: s.position, cd: s.cd, area: s.walk ? 0.12 : 0.05, xy: s.xy });
    const red = chromaticityToLinear(LAMP_XY.aviationRed);
    for (const a of this.aviation) {
      const k = a.onshore ? -1 : Math.min(AV_PHASES - 1, Math.floor(a.phase / L864.periodS * AV_PHASES));
      lamps.set(i++, { position: a.position, cd: a.cd, area: Math.PI * (L864.lensD / 2) ** 2, group: 2 + k, beam: LAMP_BEAM.aviation, colour: red });
      // for the ocean: FAA beam, flashing with this lamp's phase bucket (level = 1 while (t + phase) mod period < on)
      this.distant.push({ ...a.position, cd: a.cd, color: red, beam: 1, flash: { period: L864.periodS, on: L864.onS, phase: k < 0 ? 0 : -k / AV_PHASES * L864.periodS }, kind: 'aviation' });
    }
    lamps.markAll();
    this.root.add(lamps.mesh);
    this.distant.sort((a, b) => b.cd - a.cd);
  }

  // ---------------------------------------------------------------- frame
  update(dt, t) {
    const ctx = this.ctx, sunEl = sunElevationDeg(ctx), F = FACADE_UNIFORMS;
    const hours = Number.isFinite(ctx.clock?.hours) ? ctx.clock.hours : 16.5;
    // Room occupancy through the night (hotel towers): ESTIMATED 35 % in the evening, 12 % at 3 am,
    // 25 % by day (daytime interiors are invisible against sunlit facades anyway).
    F.uLandLit.value = 0.25 + 0.10 * smooth01((hours - 17) / 3) * (1 - smooth01((hours - 22.5) / 4)) - 0.13 * (hours < 6 ? 1 - smooth01((hours - 3) / 3) : 0);
    F.uLandCrown.value = smooth01((-sunEl - 1) / 4);   // architectural lighting and signage from civil dusk
    F.uLandTime.value = t;

    // onshore rotors
    this._spin += Math.max(dt, 0) * ONSHORE.rpm * 2 * Math.PI / 60;
    this._setRotors(-this._spin);

    // lamps: shore lights ramp in through dusk; L-864s flash in night mode
    const L = this.lamps.levels, night = sunEl < -0.5;
    L[0] = smooth01((1 - sunEl) / 7);
    L[1] = night ? flashLevel(t) : 0;
    for (let k = 0; k < AV_PHASES; k++) L[2 + k] = night ? flashLevel(t, k / AV_PHASES * L864.periodS) : 0;
    this.lamps.update(t, exposedScale(ctx));

    // Night lights for the ocean's light columns (its planar mirror cannot resolve 17-36 km sources
    // on the grazing sea): sent to ocean.setDistantLights(list, 'land') when their levels change by
    // 2 % (a few times per dusk and night, never per frame; the ocean flashes the L-864s itself).
    const key = [L[0], F.uLandLit.value, F.uLandCrown.value, +night], ocean = ctx.ocean;
    if (typeof ocean?.setDistantLights === 'function' && key.some((v, k) => Math.abs(v - this._published[k]) > 0.02)) {
      this._published = key;
      ocean.setDistantLights(this.distantLights(), 'land');
    }
  }

  /**
   * The city's and shore's night lights as ~190 sources (lit facades, casino signs, shore-light
   * cells of 400 m, the FAA L-864s), in ocean.setDistantLights() list form: [{ x, y, z (world, m),
   * cd (toward the sea, at the current level), color (linear RGB, unit luminance), width (m, the
   * source's extent), beam?, flash?, kind }]. Dark sources are left out.
   */
  distantLights() {
    const F = FACADE_UNIFORMS, k = this.lamps.levels[0], lit = F.uLandLit.value / 0.3, sign = F.uLandCrown.value, night = +(sunElevationDeg(this.ctx) < -0.5);
    const level = { facade: k * lit, sign: k * sign, shore: k, aviation: night };
    return this.distant.map((s) => ({ ...s, cd: s.cd * level[s.kind] })).filter((s) => s.cd > 0);
  }

  setQuality() {}

  dispose() {
    this.root.parent?.remove(this.root);
    for (const g of [this.towerMesh.geometry, this.coastMesh.geometry, this.onshoreTowers.geometry, this.nacelleGeometry, this.bladeGeometry]) g.dispose();
    for (const m of [this.onshoreNacelles, this.onshoreRotors, this.facadeMaterial, this.onshoreMaterial, this.lamps]) m.dispose();
    this.ctx.ocean?.setDistantLights?.([], 'land');   // land's own set (a list without a key would go to 'default')
  }
}

// Three blades + spinner for a GE 1.5sle-class rotor, in the rotor frame (hub at the origin, spin
// axis +z): each blade a flattened 4-sided cone, 2.8 m chord at the root to a point at radius R.
function onshoreRotorGeometry(R, hubZ) {
  const parts = [0, 1, 2].map((k) => new THREE.ConeGeometry(1.4, R - 1.5, 4).scale(1, 1, 0.12).translate(0, (R + 1.5) / 2, 0).rotateZ(k * 2 * Math.PI / 3).translate(0, 0, hubZ + 0.6));
  parts.push(new THREE.ConeGeometry(1.2, 2.4, 12).rotateX(Math.PI / 2).translate(0, 0, hubZ + 1.6));
  const g = mergeGeometries(parts);
  parts.forEach((p) => p.dispose());
  return g;
}

// Dev builds only (compiled out of the kirt.lol bundle): diagnostics (coast extent, lamp counts)
// and the scale registry rows.
function registerLandScales(land) {
  const src = 'land.js: measured from the built geometry', pos = land.towerMesh.geometry.attributes.position, cp = land.coastMesh.geometry.attributes.position;
  const cs = land.coastStats = { minDistanceM: Infinity, maxDistanceM: 0, bearingFromDeg: 360, bearingToDeg: -360, maxHeightM: 0 };
  for (let k = 0; k < cp.count; k++) {
    const x = cp.getX(k), z = cp.getZ(k), d = Math.hypot(x, z), az = Math.atan2(x, -z) / DEG;
    cs.minDistanceM = Math.min(cs.minDistanceM, d); cs.maxDistanceM = Math.max(cs.maxDistanceM, d);
    cs.bearingFromDeg = Math.min(cs.bearingFromDeg, az); cs.bearingToDeg = Math.max(cs.bearingToDeg, az);
    cs.maxHeightM = Math.max(cs.maxHeightM, cp.getY(k) + curvatureDrop(x, z));
  }
  cs.bearingFromDeg = (cs.bearingFromDeg + 360) % 360; cs.bearingToDeg = (cs.bearingToDeg + 360) % 360;
  land.lampCounts = { shore: land.shoreLights.length, boardwalk: land.shoreLights.filter((s) => s.walk).length, aviation: land.aviation.length, distant: land.distant.length };
  // highest vertex within 70 m of a tower's position, above its base (the tallest part there)
  const heightOf = (name) => () => {
    const b = land.buildings.find((x) => x.name === name);
    let top = -Infinity;
    for (let k = 0; k < pos.count; k++) if (Math.hypot(pos.getX(k) - b.x, pos.getZ(k) - b.z) < 70) top = Math.max(top, pos.getY(k));
    return top - b.baseY;
  };
  const rotorRadius = () => { const p = land.bladeGeometry.attributes.position; let r = 0; for (let k = 0; k < p.count; k++) r = Math.max(r, Math.hypot(p.getX(k), p.getY(k))); return r; };
  const reg = (name, measure, metres, tolerance, source = src) => registerScale({ name, measure, expect: { axis: 'y', metres, tolerance }, source });
  reg('land.oceanCasino.height', heightOf('Ocean Casino Resort'), LAND.skyline[0].height, 1.0);
  reg('land.borgata.height', heightOf('Borgata Hotel and Casino'), LAND.skyline[1].height, 1.0);
  reg('land.harrahsWaterfront.height', heightOf("Harrah's Waterfront Tower"), 160, 1.0);
  reg('land.hardRockNorth.height', heightOf("Hard Rock's North Tower"), 140, 1.0);
  reg('land.mgmTower.height', heightOf('MGM Tower'), 140, 1.0);
  reg('land.oceanCasino.distanceFromHero', () => land.buildings[0].distanceM, 17100, 150, 'placement (SCENE-SPEC §16: 17.1 km)');
  reg('land.oceanCasino.bearingDeg', () => land.buildings[0].bearingDeg, 303.4, 0.3, 'placement (SCENE-SPEC §16: 303.4°)');
  reg('land.onshoreWind.rotorDiameter', () => 2 * rotorRadius(), ONSHORE.rotorDiameter, 0.5, 'GE 1.5sle catalogue rotor 77 m');
  reg('land.onshoreWind.tipHeight', () => {
    const m = new THREE.Matrix4();
    land.onshoreRotors.getMatrixAt(0, m);
    return new THREE.Vector3().setFromMatrixPosition(m).y - land.onshore[0].baseY + rotorRadius();
  }, LAND.onshoreWind.tipHeight, 2.0, 'GE 1.5sle hub 80 m + rotor 77 m (config LAND.onshoreWind: 120 m)');
  reg('land.coast.maxHeight', () => land.coastStats.maxHeightM, 20, 10, 'config LAND.coast.heightRange 5-25 m (Atlantic City blocks to 30 m)');
  reg('land.coast.nearestDistance', () => land.coastStats.minDistanceM, 17000, 1500, 'config LAND.coast.distanceRange 17-35 km');
}

export { geoToLocal, TOWERS, COAST, ONSHORE };
