// Volumetric stratocumulus / cumulus humilis layer (owner: atmosphere). Used by atmosphere.js.
//
// Look (the reference photo, SCENE-SPEC §10): a few broken, flat cells and rolls 3-6x wider than deep,
// some bright, some thin and grey, with ragged, translucent margins; clear air further out; faint high
// streaks; not a field of identical puffs nor long uniform bands.
//   density  a 2D weather map (tileable noise): stratocumulus clumped into ~1.2 km cells and gathered
//            into rolls 3 km apart across the wind aloft (see WIND_AL) that break every 1.5-3 km,
//            cumulus-humilis cells in some regions (cloud type), a mesoscale (12-50 km) and a synoptic
//            (50-200 km) macro field, a +-40 m base offset that also sets the optical thickness;
//            WEATHER_PHASE_M places the field under the scene (the reference weather); x a height
//            profile per type (flat sheets 45-150 m, humilis domes to ~250 m, thicker toward cores,
//            sheared downwind, irregular base) eroded by baked tileable 3D noise: Perlin fbm with
//            Worley cells (sheets) or Perlin-Worley (billows) for the shape, Worley detail stretched
//            along the bands and curl-distorted that eats low densities far more than cores and lifts
//            the tops into 30-120 m turrets, a finer octave of it close up (7-30 m lumps; crisper
//            outlines within ~4 km); and a thin veil past each patch's dense outline (soft margins)
//   lighting a short march toward the key light (sun, or the moon after dark) + the long-range optical
//            depth from a light-space map, three multiple-scattering octaves (Wrenninge) whose last
//            keeps the two-stream diffuse transmission as a floor (in full against the light: backlit
//            cores stay grey; a quarter front-lit: neutral grey bases, not blue), a key gain 1.55x
//            higher toward the light, a three-lobe phase (forward 0.80, back -0.25, silver lining
//            0.95), beer-powder for front-lit views,
//            ambient from the sky (cosine-weighted; the low sky's excess, a twilight arch, only looking
//            toward the key light) and from the sea and lit haze below attenuated by the local depth
//            to the cloud's top and base, city light from below, and close up an in-scatter
//            probability from the detail (lumps bright, crevices dark)
//   products (A) a half-resolution view buffer: one texel of each 2x2 block marched per frame, in a
//                per-block order offset by interleaved gradient noise, resolved temporally
//                (reprojection through the cloud depth including the drift, clipping toward the mean
//                of the new samples, a faster blend while the key light moves)
//            (B) a panorama of the upper hemisphere from the camera, sampled by skyRadiance(), the
//                environment map, the ambient reduction and (through skyRadiance) the ocean
//            (C) a light-space map around the camera: optical depth through the layer along the key
//                light (cumulative at 1/3, 2/3 and 3/3 of the slab) and its transmittance, with mips
//                for the penumbra; read by cloudShadow() and by the in-cloud light march
// The 3D noises carry mip chains; every march reads them at the sample's footprint (gAtmCloudLod).
// The cover -> coverage-threshold relation is a baked table (COVER_TABLE; dev builds re-derive it).
// All radiances are absolute scene units; render targets hold them pre-exposed (uAtmPre).
import * as THREE from 'three';
import { U } from '../shared.js';
import { CLOUDS } from '../config.js';

// ------------------------------------------------------------------ sizes and physical constants
export const WEATHER_TILE_M = 25600;          // one repeat of the weather map (50 m texels)
const WEATHER_SIZE = 512;
const WEATHER_MAX_SIZE = 64;                  // 400 m blocks, dilated: empty-space skipping
const SHAPE_SIZE = 128, SHAPE_TILE_M = 2400;  // Perlin fbm + Worley fbm shape noise
const DETAIL_SIZE = 64, DETAIL_TILE_M = 240;  // Worley detail noise (3.75 m texels)
const CURL_SIZE = 128, CURL_TILE_M = 1000;
const CIRRUS_SIZE = 512, CIRRUS_TILE_M = 30000;
const SHADOW_SIZE = 512;
const SHADOW_HALF_M = 24000;                  // light-space map covers +-24 km around the camera (94 m texels)
const SHADOW_SNAP_M = 2000;                   // re-centred in 2 km steps (full rebuild), banded refresh otherwise
const PANO_W = 512, PANO_H = 192;
// Largest view cloud buffer (texels): 800 x 450 = half of 1600 x 900 at DPR 1.
const VIEW_MAX_TEXELS = 800 * 450;
// March settings per quality tier (defines of the view march).
const VIEW_TIERS = {
  low: { ATM_CLOUD_MAX_STEPS: 32, ATM_CLOUD_LIGHT_STEPS: 3, ATM_CLOUD_STEP_SCALE: '2.0' },
  med: { ATM_CLOUD_MAX_STEPS: 40, ATM_CLOUD_LIGHT_STEPS: 4, ATM_CLOUD_STEP_SCALE: '1.7' },
  high: { ATM_CLOUD_MAX_STEPS: 48, ATM_CLOUD_LIGHT_STEPS: 4, ATM_CLOUD_STEP_SCALE: '1.4' },
  ultra: { ATM_CLOUD_MAX_STEPS: 80, ATM_CLOUD_LIGHT_STEPS: 6, ATM_CLOUD_STEP_SCALE: '1.0' },
};
// Temporal resolve: weight of a new sample over its history while the camera holds still (a converged,
// noise-free frame within ~1 s) and while it moves (short memory, no smearing).
const BLEND_STILL = 0.1, BLEND_MOVING = 0.35;
// Extinction of cloud at density 1 (1/m): beta = 1.5 LWC / (rho_w r_eff) with LWC ~0.4 g/m^3 and an
// effective radius 8 um (0.075 /m). Sheets carry densities 0.1-0.4 (vertical optical depth 0.5-4:
// translucent grey margins, bright cores), humilis cores up to ~0.8 (SCENE-SPEC §10: tau 2-6).
export const CLOUD_EXTINCTION = 0.08;
// Upward emission of a lit city against the elevation sine of the direction it leaves in: light sent
// out near the horizon by fixtures plus ground-reflected light rising more steeply. Garstang (1986)
// finds the two comparable (2G cos psi + 0.554 F psi^4, G 0.15, F 0.1: about as much light leaves
// just above the horizon as straight up); 0.12 + 0.1 sin is close to that. With the intensities in
// atmosphere.js CITIES it keeps the near-horizon dome toward Atlantic City, while the haze high above
// the region is lit far less than by a steeply upward-peaked emission, which swamped the natural
// horizon brightening (the moonless sky toward the open sea was only 1.26x its zenith at 0.5 deg).
// Used for the sky glow (atmosphere.js) and for the city light on the cloud bases.
export const CITY_EMISSION_GLSL = (s) => `(0.12 + 0.1 * max(${s}, 0.0))`;
// Band axis: stratocumulus undulatus, sheets and rolls lying across the wind shear at the capping
// inversion (the 4.5 m/s boundary-layer wind from 200.5 deg under 8 m/s from 225 deg aloft: shear
// toward 71 deg, bands along ~161 deg), drifting with the flow aloft. The tile only allows lattice
// directions: the weather map's bands lie along its x + z diagonal (135 / 315 deg), and the 3D noise
// is stretched along the same axis; WIND_AL is the drift (config CLOUDS.driftMS), across the bands.
const WIND_AL = (() => { const [x, z] = CLOUDS.driftMS, l = Math.hypot(x, z) || 1; return [x / l, z / l]; })();
// Coverage field span from a patch's outline to its core (the field's fbm has a standard deviation
// ~0.1), and how far the 3D shape noise moves the outline (in field units): lobes, lanes and holes.
// Round 4 (jury: smooth lens-shaped pillows): the 600/300/150 m shape noise moves the outline twice as far
// (ragged, broken outlines of varied size) over a 1.5x wider, more translucent margin.
const COVER_SPAN = 0.15, NOISE_LIFT = 0.4;
// Veil: thin, translucent cloud continuing past a patch's dense outline over HALO x COVER_SPAN of the field
// (a few hundred metres: the soft, wispy margins of decaying stratocumulus), at most VEIL density. EDGE is
// how far below the coverage threshold the field can still hold cloud (the early-outs; the shape noise's
// mix stays within 0.2-0.8, so 0.6 of the full lift).
const HALO = 0.8, VEIL = 0.3, EDGE = 0.6 * NOISE_LIFT + HALO * COVER_SPAN;
// Coverage threshold (uAtmCloud.x) against cover, interpolated linearly: the projected (top-down) cover
// of one weather tile (q in [0, 25.6 km]^2, wherever the drift and WEATHER_PHASE_M put it), counting as
// cloud every column whose vertical transmittance is below VISIBLE_T (config CLOUDS.cover is the
// photo's share of the sky that shows any cloud, veils included; SCENE-SPEC §10), equals the requested
// cover. The bake is deterministic (same noise, same field), so it is a table. Dev builds re-derive it
// with deriveCoverTable() (bisection, COVER_ITERATIONS synchronous read-backs per cover;
// dev/atmosphere.html?calibrate=1 prints both), which used to run at every boot: 280 ms on an idle GPU,
// seconds on a shared one. Re-derive it whenever the weather map or the density changes.
export const COVER_TABLE = [[0.1, 0.63086], [0.28, 0.49805], [0.5, 0.50195], [0.8, 0.74023], [1.0, -0.49805]];
const COVER_ITERATIONS = 9, VISIBLE_T = 0.8;
// Mesoscale macro field (x amplitude 1.2 in uAtmCloudMacro): clear and cloudier regions 12-50 km
// across; and a synoptic one (w amplitude) 4x larger, rotated 41 deg: cloud fields and clear air
// 50-200 km across, as off the coast on a summer afternoon (cumulus over and near land, clear further
// out). WEATHER_PHASE_M places the field under the scene: the reference weather (see atmosphere.js).
const MACRO_OFFSET = [0.175, 0.675], MACRO2_OFFSET = [0.31, 0.83];
// Where the weather field sits at animation time 0 (metres added to the drift): the reference weather.
// Chosen by a search over a 400 x 400 km grid of offsets (2 km steps, then 0.5 km around the best) for the
// drone frame's cloud share by elevation as the photo shows it (pixels noticeably less blue than the clear
// sky: 0.24 / 0.42 / 0.27 / 0.12 / ~0 over 12.6-10.2 / 10.2-7.8 / 7.8-5.3 / 5.3-2.8 / 2.8-0.3 deg, the top
// band weighted double), streaks spread across the frame at 3-8 deg, clear sky where the near-right sea
// reflects it (12-19 deg, az 66-82) and at the photo's clear patch (760 px frame (250, 75): az 48-53,
// el 7-9 deg), some cloud where the near-left sea reflects it, no cloud near the 16:30 sun except the
// casters of the round-4 term: cloud shadow on the near sea 330-540 m out (where the photo is darkest),
// with the hero itself in sun. Re-run it whenever the weather map or the cloud shapes change.
export const WEATHER_PHASE_M = [98000, 104000];

const f = (x) => { const s = Number(x).toPrecision(9); return /[.e]/.test(s) ? s : s + '.0'; };
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ------------------------------------------------------------------ uniforms (merged into ATMOS_UNIFORMS)
export const CLOUD_UNIFORMS = {
  uAtmWeather: { value: null },
  uAtmWeatherMax: { value: null },
  uAtmShape: { value: null },
  uAtmDetail: { value: null },
  uAtmCurl: { value: null },
  uAtmCirrusTex: { value: null },
  // x 1/shape tile, y 1/detail tile, z 1/curl tile, w detail erosion strength
  uAtmCloudShape: { value: new THREE.Vector4(1 / SHAPE_TILE_M, 1 / DETAIL_TILE_M, 1 / CURL_TILE_M, 1.6) },
  // x macro amplitude, y 1/cirrus tile, z shape evolution (m/s), w synoptic amplitude
  uAtmCloudMacro: { value: new THREE.Vector4(1.2, 1 / CIRRUS_TILE_M, 0.6, 1.0) },
  // lighting: x octave extinction a, y octave contribution b, z octave phase c, w key-light gain (round 3:
  // 3.8 -> 1.7, the reference view's cloud pixels at 760 px had a median 14 levels over the photo's 230;
  // round 4: 1.1 with the diffuse floor at every view angle, tops at the photo's ~234)
  uAtmCloudLight: { value: new THREE.Vector4(0.45, 0.45, 0.5, 1.1) },
  // x ambient from above, y ambient from below, z powder weight, w fill of the coverage (high covers)
  uAtmCloudLight2: { value: new THREE.Vector4(0.56, 0.15, 0.5, 0) },
  // light-space optical-depth map
  uAtmCloudShadow: { value: null },
  uAtmCloudShadowXf: { value: new THREE.Vector4(0, 0, 1 / (2 * SHADOW_HALF_M), 1) },   // centre x, z; 1 / size; mean T
  uAtmCloudPano: { value: null },
  uAtmCloudPanoPre: { value: 1 },
  uAtmTime: U.uTime,                  // animation time: drift and slow evolution of the cloud shapes
};

// ------------------------------------------------------------------ GLSL: hashes and bake noises
// Interleaved gradient noise (Jimenez 2014): a blue-noise-like value per pixel.
const IGN_GLSL = 'float atmIGN(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }\n';
// PCG-style 3D hash (shared: the atmosphere's stars and sky-night's Milky Way use it too).
export const HASH_GLSL = IGN_GLSL + /* glsl */`
uvec3 atmPcg3(uvec3 v) {
	v = v * 1664525u + 1013904223u;
	v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
	v ^= v >> 16u;
	v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
	return v;
}
vec3 atmRand3(uvec3 v) { return vec3(atmPcg3(v)) * (1.0 / 4294967296.0); }
`;
// Periodic lattice noises for the one-time bakes (per = lattice cells per period, per axis).
export const NOISE_GLSL = HASH_GLSL + /* glsl */`
vec3 nzRand(vec3 c, ivec3 per, uint salt) { return atmRand3(uvec3(mod(c, vec3(per))) + uvec3(salt, salt * 7u, salt * 13u)); }
// 2D value noise and fbm, periodic with per cells per unit of q
float nzValue2(vec2 p, ivec2 per, uint salt) {
	vec2 i = floor(p), fr = p - i, u = fr * fr * (3.0 - 2.0 * fr);
	ivec3 P = ivec3(per, 1);
	return mix(mix(nzRand(vec3(i, 0.0), P, salt).x, nzRand(vec3(i.x + 1.0, i.y, 0.0), P, salt).x, u.x),
	           mix(nzRand(vec3(i.x, i.y + 1.0, 0.0), P, salt).x, nzRand(vec3(i + 1.0, 0.0), P, salt).x, u.x), u.y);
}
float fbm2(vec2 q, ivec2 per, int oct, uint salt) {
	float s = 0.0, a = 0.5, n = 0.0;
	vec2 p = q * vec2(per);
	for (int o = 0; o < 6; o++) {
		if (o >= oct) break;
		s += a * nzValue2(p, per, salt + uint(o) * 131u);
		n += a; a *= 0.5; p *= 2.0; per *= 2;
	}
	return s / n;
}
// 1 - F1 of a periodic Worley field, p in cells.
float nzWorley(vec3 p, ivec3 per, uint salt) {
	vec3 i = floor(p), fr = p - i;
	float d = 9.0;
	for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
		vec3 o = vec3(x, y, z), fp = o + nzRand(i + o, per, salt) - fr;
		d = min(d, dot(fp, fp));
	}
	return 1.0 - clamp(sqrt(d), 0.0, 1.0);
}
float nzWorleyFbm(vec3 p, int per, uint salt) {
	return 0.625 * nzWorley(p, ivec3(per), salt) + 0.25 * nzWorley(p * 2.0, ivec3(per * 2), salt + 11u) + 0.125 * nzWorley(p * 4.0, ivec3(per * 4), salt + 23u);
}
float nzPerlin(vec3 p, int per, uint salt) {
	vec3 i = floor(p), fr = p - i;
	vec3 u = fr * fr * fr * (fr * (fr * 6.0 - 15.0) + 10.0);
	float g[8];
	for (int k = 0; k < 8; k++) {
		vec3 c = vec3(k & 1, (k >> 1) & 1, k >> 2);
		g[k] = dot(normalize(nzRand(i + c, ivec3(per), salt) * 2.0 - 0.99999), fr - c);
	}
	return mix(mix(mix(g[0], g[1], u.x), mix(g[2], g[3], u.x), u.y), mix(mix(g[4], g[5], u.x), mix(g[6], g[7], u.x), u.y), u.z);
}
float nzPerlinFbm(vec3 p, int per, int oct, uint salt) {
	float s = 0.0, a = 0.5, n = 0.0;
	for (int o = 0; o < 6; o++) {
		if (o >= oct) break;
		s += a * nzPerlin(p, per, salt + uint(o) * 101u);
		n += a; p *= 2.0; per *= 2; a *= 0.5;
	}
	return s / n;
}
`;

// ------------------------------------------------------------------ GLSL: cloud shadow (vertex-safe core)
export const CLOUD_CORE_GLSL = /* glsl */`
uniform sampler2D uAtmCloudShadow;   // key-light map: rgb cumulative optical depth at 1/3, 2/3, 3/3 of the slab, a transmittance
uniform vec4 uAtmCloudShadowXf;      // xy map centre (world x, z), z 1 / map size (1/m), w mean transmittance
// Map coordinates of the key-light ray through p (projected along the light to sea level).
vec2 atmCloudShadowUV(vec3 p, float lyInv) {
	vec2 q = p.xz - uAtmKey.xz * (atmAltitude(p) * lyInv);
	return (q - uAtmCloudShadowXf.xy) * uAtmCloudShadowXf.z + 0.5;
}
// Transmittance of the key light (the sun; the moon after dark) through the cloud layer. The edge
// softens with the distance to the cloud (the 0.53 deg solar disk: 0.0093 x distance) on top of the
// clouds' own edge ramp, which the density field carries.
float cloudShadow(vec3 worldPos) {
	vec3 up = atmUp(worldPos);
	float ly = dot(uAtmKey, up);
	if (ly < 0.02 || uAtmCloud.w <= 0.0) return 1.0;
	float h = atmAltitude(worldPos);
	if (h > uAtmCloudAlt + uAtmCloudThick) return 1.0;
	vec2 uv = atmCloudShadowUV(worldPos, 1.0 / ly);
	float d = max(uAtmCloudAlt + 0.5 * uAtmCloudThick - h, 0.0) / ly;
	float lod = log2(max((60.0 + 0.0093 * d) * uAtmCloudShadowXf.z * ${f(SHADOW_SIZE)}, 1.0));
	vec2 e = abs(uv - 0.5);
	float T = mix(uAtmCloudShadowXf.w, textureLod(uAtmCloudShadow, uv, lod).a, 1.0 - smoothstep(0.44, 0.5, max(e.x, e.y)));
	return mix(1.0, T, smoothstep(0.02, 0.1, ly));
}
`;

// ------------------------------------------------------------------ GLSL: panorama lookup (consumers)
export const CLOUD_PANO_GLSL = /* glsl */`
uniform sampler2D uAtmCloudPano;     // clouds over the clear sky from the camera: rgb pre-exposed delta, a transmittance
uniform float uAtmCloudPanoPre;
vec4 atmCloudPanoSample(vec3 dir) {
	vec4 c = textureLod(uAtmCloudPano, vec2(atan(dir.x, -dir.z) * ${f(1 / (2 * Math.PI))} + 0.5, sqrt(asin(clamp(dir.y, 0.0, 1.0)) * ${f(2 / Math.PI)})), 0.0);
	return vec4(c.rgb / uAtmCloudPanoPre, c.a);
}
`;

// ------------------------------------------------------------------ GLSL: density, light march, march
// Needs ATMOS core + sky GLSL before it (atmAltitude, atmUp, atmLayerInterval, atmTransmittance, ...).
const CLOUD_MARCH_GLSL = /* glsl */`
uniform sampler2D uAtmWeather;       // r coverage field, g type (0 sheet, 1 humilis), b macro field, a base offset
uniform sampler2D uAtmWeatherMax;    // conservative 400 m block maximum of r (dilated one block)
uniform highp sampler3D uAtmShape;   // r Perlin fbm, gba Worley fbm (4, 8, 16 cells per tile)
uniform highp sampler3D uAtmDetail;  // rgb Worley fbm (2, 4, 8 cells per tile)
uniform sampler2D uAtmCurl;          // rg curl of periodic Perlin noise
uniform sampler2D uAtmCirrusTex;     // r cirrus streaks, g their fibre field (fine striations)
uniform vec4 uAtmCloudShape;
uniform vec4 uAtmCloudMacro;
uniform vec4 uAtmCloudLight;
uniform vec4 uAtmCloudLight2;
uniform vec4 uAtmCities[CITY_COUNT];
uniform vec3 uAtmCityTint;
uniform vec4 uAtmCirrus;             // x altitude (m), y optical depth
uniform float uAtmTime;
#ifndef ATM_CLOUD_LIGHT_STEPS
#define ATM_CLOUD_LIGHT_STEPS 6
#endif
#ifndef ATM_CLOUD_MAX_STEPS
#define ATM_CLOUD_MAX_STEPS 96
#endif
#ifndef ATM_CLOUD_STEP_SCALE
#define ATM_CLOUD_STEP_SCALE 1.0
#endif
const mat2 ATM_ROT17 = mat2(0.95630476, 0.29237170, -0.29237170, 0.95630476);
const mat2 ATM_ROT41 = mat2(0.75470958, 0.65605903, -0.65605903, 0.75470958);
const vec2 ATM_WIND_AL = vec2(${f(WIND_AL[0])}, ${f(WIND_AL[1])});   // the drift (x, z), across the bands
// Mip level of the 3D noise for the current sample (set by each march before atmCloudDensity): the
// larger of the pixel footprint and a quarter of the step, in detail texels (3.75 m); the shape noise
// (18.75 m texels) reads ATM_SHAPE_LOD_OFFSET levels coarser. Far samples then read small,
// cache-friendly mips and do not alias; near ones keep the detail's full resolution.
const float ATM_DETAIL_TEXEL = ${f(DETAIL_TILE_M / DETAIL_SIZE)};
const float ATM_SHAPE_LOD_OFFSET = ${f(Math.log2((SHAPE_TILE_M / SHAPE_SIZE) / (DETAIL_TILE_M / DETAIL_SIZE)))};
uniform float uCloudPixRad;          // angular size of one texel of the pass's target (0: step-based only)
float gAtmCloudLod = 0.0;
// Set by atmCloudDensity for the lighting: height within the cloud (0 base .. 1 local top), local top (m),
// and the close-range detail value (0.5 when there is none).
float gAtmCloudH = 0.0, gAtmCloudTop = 1.0, gAtmCloudHF = 0.5;
// Weight of the close-range detail (set by the view march: a pixel under ~10 m and within ~4 km).
float gAtmCloudNear = 0.0;
float atmCloudLodFor(float footprintM) { return log2(max(footprintM, ATM_DETAIL_TEXEL) / ATM_DETAIL_TEXEL); }

// Coverage field at map position q (world xz + drift): the tile's own field modulated by its macro
// channel read at 3.7x the scale and rotated 17 deg (so the pattern never visibly repeats) and at 14.8x
// the scale rotated 41 deg (the synoptic field).
float atmCloudF(vec2 q, out vec4 w) {
	w = textureLod(uAtmWeather, q * uAtmCloud.y, 0.0);
	vec2 m = q * (uAtmCloud.y * 0.27027);
	float F = w.r * (1.0 + uAtmCloudMacro.x * (textureLod(uAtmWeather, ATM_ROT17 * m + vec2(${f(MACRO_OFFSET[0])}, ${f(MACRO_OFFSET[1])}), 3.0).b - 0.5))
	              * max(1.0 + uAtmCloudMacro.w * (textureLod(uAtmWeather, ATM_ROT41 * m * 0.25 + vec2(${f(MACRO2_OFFSET[0])}, ${f(MACRO2_OFFSET[1])}), 5.0).b - 0.5), 0.0);
	// high covers close the gaps into a broken-to-overcast stratocumulus deck
	return F + (1.0 - F) * uAtmCloudLight2.w * (0.55 + 0.45 * w.a);
}
// May a cloud lie within ~400 m of q? (conservative: block maxima, dilated, largest macro factor,
// the largest lift of the shape noise)
bool atmCloudMaybe(vec2 q) {
	float m = texture(uAtmWeatherMax, q * uAtmCloud.y).r * (1.0 + 0.5 * uAtmCloudMacro.x) * (1.0 + 0.5 * uAtmCloudMacro.w);
	return m + (1.0 - m) * uAtmCloudLight2.w > uAtmCloud.x - ${f(EDGE)};
}
// Density (0..1) at p with altitude alt. detailW 0 = shape only (light march, shadows).
float atmCloudDensity(vec3 p, float alt, float detailW) {
	vec2 q = p.xz + uAtmCloudOffset;
	vec4 w;
	float F = atmCloudF(q, w);
	if (F < uAtmCloud.x - ${f(EDGE)}) return 0.0;
	float z = alt - uAtmCloudAlt - (w.a - 0.5) * 80.0;           // height above the local base (+-40 m)
	if (z <= -25.0 || z >= uAtmCloudThick) return 0.0;
	// noise frame: across / along the bands, stretched 1.7:1 along them (the km-scale elongation is
	// the weather map's; finer structure is near isotropic), sheared downwind with height (the tops
	// trail their bases), evolving slowly
	vec2 wa = vec2(dot(q, ATM_WIND_AL), dot(q, vec2(-ATM_WIND_AL.y, ATM_WIND_AL.x)));
	float evo = uAtmTime * uAtmCloudMacro.z;
	vec4 s = textureLod(uAtmShape, vec3(wa.x - z * 0.5, z * 1.2 + evo, wa.y * 0.6) * uAtmCloudShape.x, max(gAtmCloudLod - ATM_SHAPE_LOD_OFFSET, 0.0));
	// local coverage: the field plus the shape noise, which moves a patch's outline by up to
	// +-NOISE_LIFT of the field (lanes, holes, lobes); 0 at the outline, 1 COVER_SPAN inside it. Sheets:
	// Perlin fbm with 40 % of the 600 m Worley cells (stratocumulus cells and the thinner lanes between
	// them); humilis: Perlin-Worley billows; both frayed by the 150 m Worley octave
	float fill = uAtmCloudLight2.w;
	float n = mix(mix(mix(s.r, s.g, 0.4), s.g + s.r * (1.0 - s.g), w.g), s.a, 0.5);
	float cov = (F + (n - 0.5) * ${f(2 * NOISE_LIFT)} - uAtmCloud.x) * ${f(1 / COVER_SPAN)} * (1.0 + 1.5 * fill);
	if (cov <= ${f(-HALO)}) return 0.0;
	// local top: flat stratocumulus sheets (type 0) 45-150 m, humilis domes (type 1) to ~250 m,
	// thicker toward a patch's core (the map's own fine octaves, coherent through the column, so the
	// base seen from below is mottled by the thickness above it) and in 150 m cells; a deck at high covers
	float core = smoothstep(-0.1, 0.25, F - uAtmCloud.x);
	float top = uAtmCloudThick * mix(0.3, 0.8, w.g) * (0.35 + 0.65 * clamp(cov, 0.0, 1.0)) * (0.55 + 0.6 * core) * mix(0.45, 1.45, s.a) * (1.0 + fill);
	float hl = z / top;
	// irregular base: 600 m and 300 m lumps (+-25 m, +-15 m) on the map's +-40 m, a soft 30 m ramp
	// the detail frays into hanging wisps; sheets end in a flat-ish top (rounded over the upper half),
	// humilis in a dome (upper 80 %)
	// (a close cloud's outline ramps over 0.3 of the span: crisp at 1 km, as soft as the photo's at 5 km).
	// Outside the outline the veil: full where the detail frays it (the view within ~10 km), a quarter in
	// the shape-only passes and far away (a thin haze of cloud would only brighten the horizon), faint
	// close up (a smooth veil a few hundred metres away reads as blur)
	float cm = cov > 0.0 ? min(cov * (1.0 + 2.5 * gAtmCloudNear), 1.0) : ${f(VEIL)} * max(0.25 + 0.75 * detailW - 0.8 * gAtmCloudNear, 0.0) * (1.0 + cov * ${f(1 / HALO)}) * (1.0 + cov * ${f(1 / HALO)});
	float d = cm * smoothstep(0.0, 30.0, z + (s.g - 0.5) * 50.0 + (s.b - 0.5) * 30.0);
	if (d <= 0.0 || hl >= 1.3) return 0.0;
	gAtmCloudH = clamp(hl, 0.0, 1.0); gAtmCloudTop = top;
	float ta = mix(0.5, 0.2, w.g);
	if (detailW <= 0.0) d *= 1.0 - smoothstep(ta, 1.0, hl);
	else {
		// fibrous, ragged margins: Worley detail stretched 1.4:1 along the bands and curl-distorted (wispy
		// underneath, billowy on top), eating thin parts and margins far more than cores
		vec2 c = textureLod(uAtmCurl, q * uAtmCloudShape.z, 0.0).rg * 2.0 - 1.0;
		vec3 dp = vec3(wa.x, alt * 1.5 - evo * 2.0, wa.y * 0.7) + vec3(c.x, 0.0, c.y) * (60.0 * (1.0 - gAtmCloudH) * (1.0 - 0.75 * gAtmCloudNear));
		vec3 dn = textureLod(uAtmDetail, dp * uAtmCloudShape.y, gAtmCloudLod).rgb;
		float hf = 0.625 * dn.r + 0.25 * dn.g + 0.125 * dn.b;
		// close range (the deck, the overview looking up): a finer octave of the same noise, 7-30 m
		// turrets, lumps and gaps, so a cloud a few hundred metres away is not a smooth blur
		float nearW = detailW * gAtmCloudNear;
		if (nearW > 0.0) {
			vec3 dn2 = textureLod(uAtmDetail, dp * (uAtmCloudShape.y * 4.13) + 0.37, max(gAtmCloudLod - 2.05, 0.0)).rgb;
			hf = mix(hf, 0.3 * hf + 0.7 * (0.6 * dn2.r + 0.4 * dn2.g), nearW);
		}
		hf = mix(hf, 1.0 - hf, clamp(gAtmCloudH * 3.0, 0.0, 1.0));
		gAtmCloudHF = hf;
		// cauliflower top: the detail lifts and lowers the local top by up to +-30 % (30-120 m turrets)
		d *= 1.0 - smoothstep(ta, 1.0, hl / (1.0 + 0.6 * (hf - 0.5) * detailW));
		d -= hf * uAtmCloudShape.w * detailW * (1.0 - smoothstep(0.2, 0.9, d)) * d;
		d = max(d - hf * 0.1 * detailW * (1.0 - smoothstep(0.1, 0.6, d)), 0.0);   // frayed: the margins break into wisps
		d *= 1.0 + (hf - 0.5) * mix(0.7, 1.6, nearW) * detailW;    // 30-120 m lumps all through (7-30 m close)
	}
	// sheets are optically thinner than humilis cores; 300 m cells of denser and thinner cloud give the
	// underside its mottling; and ~1 km patches of thinner and thicker cloud (the map's base channel:
	// thick where the base hangs low) vary the brightness from cloud to cloud, grey translucent veils
	// among bright white heads
	return max(d, 0.0) * mix(0.55, 1.0, w.g) * mix(0.8, 1.15, w.b) * (0.5 + 0.8 * s.b) * mix(1.25, 0.25, smoothstep(0.32, 0.68, w.a));
}

// Optical depth along the key light from p beyond the short light march, from the light-space map's
// cumulative profile (the long paths of a low sun or moon through neighbouring clouds).
float atmCloudFarTau(vec3 p, float altEnd, float lyInv) {
	vec2 uv = atmCloudShadowUV(p, lyInv), e = abs(uv - 0.5);
	if (max(e.x, e.y) > 0.5) return 0.0;
	vec4 m = textureLod(uAtmCloudShadow, uv, 0.0);
	float x = (altEnd - (uAtmCloudAlt - 50.0)) / (uAtmCloudThick + 100.0) * 3.0;
	float cum = x <= 0.0 ? 0.0 : (x < 1.0 ? m.r * x : (x < 2.0 ? mix(m.r, m.g, x - 1.0) : mix(m.g, m.b, clamp(x - 2.0, 0.0, 1.0))));
	return max(m.b - cum, 0.0);
}

float atmCloudPhase(float c, float k) {   // k scales the lobes' asymmetry (multiple-scattering octaves)
	return 0.74 * atmHG(0.80 * k, c) + 0.21 * atmHG(-0.25 * k, c) + 0.05 * atmHG(0.95 * k, c);
}

// Marches the cumulus layer along ro + t rd. jitter in [0, 1) offsets the sample lattice. Returns rgb =
// in-scattered radiance at the cloud (absolute, before aerial perspective), a = transmittance;
// tMean = transmittance-weighted distance of the cloud.
vec4 atmCloudMarch(vec3 ro, vec3 rd, float jitter, out float tMean) {
	tMean = 0.0;
	if (uAtmCloud.w <= 0.0) return vec4(0.0, 0.0, 0.0, 1.0);
	vec2 iv = atmLayerInterval(ro, rd, uAtmCloudAlt - 45.0, uAtmCloudAlt + uAtmCloudThick + 45.0, 90000.0);
	if (iv.y <= iv.x) return vec4(0.0, 0.0, 0.0, 1.0);
	// key light at the cloud (planet shadow + atmospheric transmittance from the cloud's altitude)
	vec3 pMid = ro + rd * (iv.x + 0.5 * min(iv.y - iv.x, 4000.0));
	float hk = max(atmAltitude(pMid), 0.0) * 0.001;
	float muK = dot(uAtmKey, atmUp(pMid));
	vec3 keyE = uAtmKeyE * atmTransmittance(uAtmTransLUT, hk, muK) * atmLightVisibility(hk, muK, 0.0047);
	bool keyOn = dot(keyE, vec3(1.0)) > 0.0;
	float ly = max(muK, 0.02);
	float cosT = dot(rd, uAtmKey);
	vec3 oa = vec3(1.0, uAtmCloudLight.x, uAtmCloudLight.x * uAtmCloudLight.x);
	vec3 ob = vec3(1.0, uAtmCloudLight.y, uAtmCloudLight.y * uAtmCloudLight.y);
	vec3 ph = vec3(atmCloudPhase(cosT, 1.0), atmCloudPhase(cosT, uAtmCloudLight.z), atmCloudPhase(cosT, uAtmCloudLight.z * uAtmCloudLight.z));
	// fwd: toward the key light the octaves miss more of the forward-peaked multiple scattering, so the
	// key gain rises 1.55x (round 4: the front-lit gain fell 1.7 -> 1.1 with the diffuse floor; the backlit
	// dawn and dusk clouds keep their round-3 brightness and silver linings)
	float fwd = smoothstep(-0.2, 0.6, cosT), powderK = uAtmCloudLight2.z * clamp(-cosT, 0.0, 1.0), diffuseK = ${f(2 / (4 * Math.PI))} * mix(0.25, 1.0, fwd);
	// sky light from above: the cosine-weighted mean (the irradiance on the layer, x1.27: the uniform mean's
	// level in daylight), plus the uniform mean's excess, the low sky's light (a twilight arch), only
	// where the view looks toward the key light's azimuth. Round 4: the uniform mean alone lit blue-hour
	// clouds from the whole western glow, lavender and twice as bright as the eastern sky behind them;
	// now they stand grey against it, with warm sides only toward the sun.
	vec3 ambCos = texelFetch(uAtmAmbTex, ivec2(1, 1), 0).rgb, ambDown = texelFetch(uAtmAmbTex, ivec2(2, 1), 0).rgb;
	float toKey = clamp(0.5 + 0.5 * dot(normalize(rd.xz + 1e-6), normalize(uAtmKey.xz + 1e-6)), 0.0, 1.0);
	vec3 ambUp = 1.27 * ambCos + max(texelFetch(uAtmAmbTex, ivec2(0, 1), 0).rgb - ambCos, 0.0) * toKey * toKey;
	// city light on the cloud base (illuminance from below at the entry point); a lit base is a thick
	// diffuse reflector (~0.7 E / pi), the light diffusing upward inside with depth
	vec3 pIn = ro + rd * iv.x;
	vec3 cityE = vec3(0.0);
	for (int k = 0; k < CITY_COUNT; k++) {
		vec4 c = uAtmCities[k];
		if (c.z <= 0.0) continue;
		vec3 v = pIn - vec3(c.x, 0.0, c.y);
		float d2 = dot(v, v);
		cityE += c.z * ${CITY_EMISSION_GLSL('v.y / sqrt(d2)')} / (d2 + c.w * c.w) * exp(-uAtmFogRGB * atmHazePath(vec3(c.x, 0.0, c.y), pIn));
	}
	vec3 cityL = cityE * uAtmCityTint * ${f(0.7 / Math.PI)};
	float sig = uAtmCloud.z;
	// step length grows with distance (the pixel footprint), capped by the slab crossing
	float t = iv.x + clamp(0.012 * iv.x, 10.0, 380.0) * ATM_CLOUD_STEP_SCALE * jitter;
	vec3 L = vec3(0.0);
	float T = 1.0, wSum = 0.0, tSum = 0.0;
	// the detail erosion fades out where it is sub-pixel (beyond ~10 km)
	float detailFar = 1.0 - smoothstep(6000.0, 15000.0, iv.x);
	// empty space is crossed in double steps; a hit after a double step steps back and refines
	bool coarse = false;
	int fineLeft = 0;
	for (int i = 0; i < ATM_CLOUD_MAX_STEPS; i++) {
		if (t >= iv.y || T < 0.02) break;
		vec3 p = ro + rd * t;
		float dt = clamp(0.012 * t, 10.0, 380.0) * ATM_CLOUD_STEP_SCALE;
		if (!atmCloudMaybe(p.xz + uAtmCloudOffset)) { t += max(dt, 220.0); coarse = false; continue; }
		float alt = atmAltitude(p);
		float lodView = atmCloudLodFor(max(t * uCloudPixRad, dt * mix(0.1, 0.25, smoothstep(2000.0, 6000.0, t))));
		gAtmCloudLod = lodView;
		gAtmCloudNear = (1.0 - smoothstep(0.6, 2.2, lodView)) * (1.0 - smoothstep(2500.0, 5000.0, t));
		gAtmCloudHF = 0.5;
		float d = atmCloudDensity(p, alt, detailFar);
		if (d <= 0.0) {
			if (fineLeft > 0) { fineLeft--; t += dt; } else { t += coarse ? 2.0 * dt : dt; coarse = true; }
			continue;
		}
		if (coarse) { t -= dt; coarse = false; fineLeft = 2; continue; }
		{
			float hrel = gAtmCloudH, top = gAtmCloudTop;
			// close up, light is more likely scattered out of the dense lumps than out of the thin gaps
			// between them (in-scatter probability, Schneider 2015): cell centres under a base glow, the
			// lanes between them and the crevices of the turrets read darker (mean 1)
			float lumps = mix(1.0, 0.2 + 1.6 * smoothstep(0.3, 0.7, gAtmCloudHF), gAtmCloudNear * detailFar);
			// short light march (shape only) + the map's long-range remainder
			float tauL = 0.0, prev = 0.0;
			if (keyOn) {
				// beyond 16 km a pixel covers tens of metres: three short samples (to 100 m) resolve the
				// lumps' own shading and the light-space map carries the rest
				int nL = t > 16000.0 ? min(3, ATM_CLOUD_LIGHT_STEPS) : ATM_CLOUD_LIGHT_STEPS;
				for (int k = 0; k < ATM_CLOUD_LIGHT_STEPS; k++) {
					if (k >= nL) break;
					float s = mix(18.0, 7.0, gAtmCloudNear) * pow(2.2, float(k)) * (0.85 + 0.3 * jitter);
					gAtmCloudLod = max(lodView, atmCloudLodFor((s - prev) * 0.5));
					// the first sample sees the detail erosion too (the first two close up): lumps shade their lee
					tauL += atmCloudDensity(p + uAtmKey * s, alt + s * ly, k == 0 || (k == 1 && gAtmCloudNear > 0.5) ? detailFar : 0.0) * (s - prev);
					prev = s;
				}
				tauL = tauL * sig + atmCloudFarTau(p, alt + prev * ly, 1.0 / ly);
			}
			vec3 ext = exp(-oa * tauL);
			// deep paths: the octave series dies off as exp(-0.2 tau), while light diffusing through a cloud
			// falls only as the two-stream 1 / (1 + 0.75 (1 - g) tau) (g 0.85) and leaves near isotropically,
			// once it has scattered a few times (1 - exp(-tau / 2): thin veils keep single scattering). Against
			// the light a backlit core stays grey under its silver lining (not a black body ringed by glowing
			// fringes); front- and side-lit, a quarter of it keeps the lower half of a sheet lit by neutral,
			// diffused sunlight where the octaves alone left only the blue sky light (round 4: the jury's
			// lavender-blue core band and stacked-lens look)
			float diffuse = diffuseK * (1.0 - exp(-0.5 * tauL)) / (1.0 + 0.1125 * tauL);
			float powder = mix(1.0, 2.0 * (1.0 - exp(-2.0 * tauL)), powderK);
			vec3 key = keyE * (uAtmCloudLight.w * (1.0 + 0.55 * fwd)) * (ob.x * ph.x * ext.x * powder + ob.y * ph.y * ext.y + max(ob.z * ph.z * ext.z, diffuse));
			// ambient: the sky from above and the sea + lit haze from below, each through the cloud
			// between the sample and the local top (base); thin sheets are lit through
			float tauV = sig * d * top * 0.5;
			vec3 amb = ambUp * (uAtmCloudLight2.x * mix(0.35, 1.0, exp(-tauV * (1.0 - hrel)))) + ambDown * (uAtmCloudLight2.y * mix(0.3, 1.0, exp(-tauV * hrel)));
			vec3 city = cityL * exp(-tauV * hrel * 0.7);
			float a = 1.0 - exp(-sig * d * dt);
			L += T * a * ((key + amb) * lumps + city);
			tSum += T * a * t; wSum += T * a;
			T *= 1.0 - a;
		}
		t += dt;
	}
	tMean = wSum > 0.0 ? tSum / wSum : iv.x;
	return vec4(L, T);
}

// Thin cirrostratus sheet at 7 km (config CLOUDS.cirrus): fibrous streaks along the wind aloft.
vec4 atmCirrus(vec3 ro, vec3 rd, out float tHit) {
	tHit = 0.0;
	if (uAtmCirrus.y <= 0.0) return vec4(0.0, 0.0, 0.0, 1.0);
	float t0, t1;
	float C = atmAltitude(ro) - uAtmCirrus.x;
	if (C > 0.0 || !atmShellHit(dot(rd.xz, rd.xz) * (0.5 / ATM_EARTH_R), rd.y + dot(ro.xz, rd.xz) / ATM_EARTH_R, C, t0, t1) || t1 <= 0.0) return vec4(0.0, 0.0, 0.0, 1.0);
	tHit = t0 > 0.0 ? t0 : t1;
	vec3 p = ro + rd * tHit;
	vec2 cuv = (p.xz + uAtmCloudOffset * 1.6) * uAtmCloudMacro.y;
	float mu = max(dot(rd, atmUp(p)), 0.03);
	// the streaks' own striations: the fibre field 7.3x finer (75-120 m apart), read at the footprint
	float fine = textureLod(uAtmCirrusTex, cuv * 7.3, log2(max(tHit * max(uCloudPixRad, 1e-4) / sqrt(mu), 1.0) / ${f(CIRRUS_TILE_M / CIRRUS_SIZE / 7.3)})).g;
	float s = textureLod(uAtmCirrusTex, cuv, 0.5).r * (0.45 + 1.1 * fine);
	float a = 1.0 - exp(-uAtmCirrus.y * s * 2.2 / mu);
	float hk = uAtmCirrus.x * 0.001;
	float muK = dot(uAtmKey, atmUp(p));
	vec3 keyE = uAtmKeyE * atmTransmittance(uAtmTransLUT, hk, muK) * atmLightVisibility(hk, muK, 0.0047);
	float cosT = dot(rd, uAtmKey);
	return vec4(a * (keyE * mix(atmHG(0.75, cosT), atmHG(0.1, cosT), 0.4) + texelFetch(uAtmAmbTex, ivec2(0, 1), 0).rgb), 1.0 - a);
}

// Sky with both cloud layers along dir, as a delta over the clear sky-view LUT (absolute) and the
// layers' transmittance for the celestial background behind them. Each layer sits behind its share
// of the air (aerial perspective).
vec4 atmCloudLayersDelta(vec3 ro, vec3 dir, float jitter) {
	vec3 S0 = atmSkyLUTSample(dir).rgb;
	vec3 S = S0;
	vec3 Tsp = atmTransView(dir);
	float a = 1.0;
	float tCi;
	vec4 ci = atmCirrus(ro, dir, tCi);
	if (ci.a < 1.0) {
		vec3 Tci = atmTransAlong(dir, tCi);
		vec3 fr = clamp((1.0 - Tci) / max(1.0 - Tsp, vec3(1e-4)), 0.0, 1.0);
		S = S * (fr + ci.a * (1.0 - fr)) + Tci * ci.rgb;
		a = ci.a;
	}
	float tMean;
	vec4 cl = atmCloudMarch(ro, dir, jitter, tMean);
	if (cl.a < 0.999) {
		vec3 Tair = atmTransAlong(dir, tMean);
		vec3 fr = clamp((1.0 - Tair) / max(1.0 - Tsp, vec3(1e-4)), 0.0, 1.0);
		S = S * (fr + cl.a * (1.0 - fr)) + Tair * cl.rgb;
		a *= cl.a;
	}
	return vec4(S - S0, a);
}
`;

// ------------------------------------------------------------------ noise bakes
const SHAPE_FS = /* glsl */`
${NOISE_GLSL}
uniform float uSlice;
varying vec2 vUv;
void main() {
	vec3 p = vec3(vUv, (uSlice + 0.5) / ${f(SHAPE_SIZE)});
	gl_FragColor = vec4(clamp(nzPerlinFbm(p * 4.0, 4, 4, 3u) * 0.9 + 0.5, 0.0, 1.0), nzWorleyFbm(p * 4.0, 4, 17u), nzWorleyFbm(p * 8.0, 8, 31u), nzWorleyFbm(p * 16.0, 16, 47u));
}
`;
const DETAIL_FS = /* glsl */`
${NOISE_GLSL}
uniform float uSlice;
varying vec2 vUv;
void main() {
	vec3 p = vec3(vUv, (uSlice + 0.5) / ${f(DETAIL_SIZE)});
	gl_FragColor = vec4(nzWorleyFbm(p * 2.0, 2, 61u), nzWorleyFbm(p * 4.0, 4, 73u), nzWorleyFbm(p * 8.0, 8, 89u), 1.0);
}
`;
const CURL_FS = /* glsl */`
${NOISE_GLSL}
varying vec2 vUv;
float pot(vec2 p) { return nzPerlinFbm(vec3(p * 4.0, 0.37), 4, 3, 7u); }
void main() {
	float e = ${f(1 / CURL_SIZE)};
	vec2 c = vec2(pot(vUv + vec2(0.0, e)) - pot(vUv - vec2(0.0, e)), pot(vUv - vec2(e, 0.0)) - pot(vUv + vec2(e, 0.0)));
	gl_FragColor = vec4(c / max(length(c), 1e-4) * 0.5 + 0.5, 0.0, 1.0);
}
`;
// Cirrus (fibratus / uncinus) along the wind aloft (the x - z diagonal; periodic because every field
// is on whole lattice periods): fibres that meander over ~10 km and bend into hooks where they carry
// a denser head (the commas of uncinus), two sets of 0.55 and 0.9 km pitch mixed regionally so the
// spacing is uneven, broken along their length and gathered in patches with clear sky between (r);
// g holds the fibre field alone, which atmCirrus reads 7.3x finer for the striations inside a streak.
const CIRRUS_FS = /* glsl */`
${NOISE_GLSL}
varying vec2 vUv;
void main() {
	vec2 uv = vUv + (vec2(fbm2(vUv, ivec2(3), 3, 5u), fbm2(vUv + 0.37, ivec2(3), 3, 9u)) - 0.5) * 0.12;
	vec2 q = vec2(uv.x - uv.y, uv.x + uv.y);
	float head = smoothstep(0.56, 0.8, fbm2(q, ivec2(8, 5), 3, 241u));
	vec2 k = vec2(fbm2(q, ivec2(6, 10), 2, 13u), fbm2(q + 0.61, ivec2(6, 10), 2, 17u)) - 0.5;
	q += k * vec2(0.03, 0.02 + 0.06 * head);
	float fib = mix(fbm2(q, ivec2(2, 24), 4, 211u), fbm2(q + 0.29, ivec2(3, 38), 4, 223u), smoothstep(0.35, 0.65, fbm2(uv, ivec2(4), 2, 229u)));
	float along = smoothstep(0.3, 0.6, fbm2(q, ivec2(12, 3), 3, 233u));
	float patches = smoothstep(0.42, 0.72, fbm2(q, ivec2(2, 5), 3, 307u));
	gl_FragColor = vec4(min(smoothstep(0.42 - 0.1 * head, 0.75, fib) * patches * along * (0.7 + 0.9 * head), 1.0), smoothstep(0.3, 0.7, fib), 0.0, 1.0);
}
`;
// Weather map: one pass over the tile. Coordinates in the band frame q = (u + v, u - v) (along the
// bands, 135 deg / across them, along the drift; whole lattice periods keep every field tileable; one
// unit of q is 18.1 km). Stratocumulus: value fbm, 1.8 x 1.1 km at the base octave down to ~60 m,
// domain-warped, clumped into ~1.2 km cells (Worley) and gathered into rolls 3 km apart (the
// transverse bands) that break every 1.5-3 km along their length; humilis cells (Worley, ~1 km,
// 1.3:1 along the bands) in the regions the type field gives them (x 1.6: the field's mean stays near
// the old sheets', ~0.45); macro field (mesoscale anti-repetition) and base offset (which also sets the
// optical thickness, atmCloudDensity).
const WEATHER_FS = /* glsl */`
${NOISE_GLSL}
varying vec2 vUv;
void main() {
	vec2 uv = vUv, q = vec2(uv.x + uv.y, uv.x - uv.y);
	vec2 wq = q + (vec2(fbm2(q, ivec2(4, 8), 3, 5u), fbm2(q + 0.37, ivec2(4, 8), 3, 9u)) - 0.5) * vec2(0.12, 0.07);
	float sheet = fbm2(wq, ivec2(8, 16), 5, 83u);
	float band = 0.5 + 0.5 * cos(37.699112 * wq.y);
	float brk = smoothstep(0.25, 0.65, fbm2(wq, ivec2(10, 6), 3, 151u));
	float cell = nzWorley(vec3(wq * vec2(14.0, 18.0), 0.5), ivec3(14, 18, 1), 17u);
	float type = smoothstep(0.45, 0.65, fbm2(uv, ivec2(3), 3, 97u));
	float F = mix(sheet * (0.85 + 0.15 * cell), cell * (0.45 + 0.55 * sheet), type) * (0.68 + 0.32 * band) * (0.6 + 0.4 * brk) * 1.4;
	gl_FragColor = vec4(F, type, fbm2(uv, ivec2(2), 3, 101u), fbm2(uv, ivec2(24), 2, 109u));
}
`;
const WEATHER_MAX_FS = /* glsl */`
uniform sampler2D uMap;
void main() {
	ivec2 o = ivec2(gl_FragCoord.xy);
	const int B = ${WEATHER_SIZE / WEATHER_MAX_SIZE};
	float m = 0.0;
	for (int by = -1; by <= 1; by++) for (int bx = -1; bx <= 1; bx++)
		for (int y = 0; y < B; y++) for (int x = 0; x < B; x++)
			m = max(m, texelFetch(uMap, ((o + ivec2(bx, by)) * B + ivec2(x, y) + ${WEATHER_SIZE}) & ${WEATHER_SIZE - 1}, 0).r);
	gl_FragColor = vec4(m, 0.0, 0.0, 1.0);
}
`;

// Connected cloud patches of a top-down coverage mask over one weather tile (the mask wraps): count,
// and the median / p10 / p90 equivalent diameter of those >= 300 m (scale report).
function patchSizes(covered, N) {
  const cell = WEATHER_TILE_M / N;
  const seen = new Uint8Array(N * N), sizes = [], stack = [];
  for (let s0 = 0; s0 < N * N; s0++) {
    if (seen[s0] || !covered[s0]) continue;
    let area = 0;
    stack.push(s0); seen[s0] = 1;
    while (stack.length) {
      const k = stack.pop(); area++;
      const x = k % N, y = (k / N) | 0;
      for (const q of [((x + 1) % N) + y * N, ((x - 1 + N) % N) + y * N, x + ((y + 1) % N) * N, x + ((y - 1 + N) % N) * N]) {
        if (!seen[q] && covered[q]) { seen[q] = 1; stack.push(q); }
      }
    }
    sizes.push(2 * Math.sqrt(area * cell * cell / Math.PI));
  }
  const over = sizes.filter((d) => d >= 300).sort((a, b) => a - b);
  const q = (p) => (over.length ? over[Math.min(over.length - 1, Math.floor(p * over.length))] : 0);
  return { count: sizes.length, countOver300m: over.length, median: q(0.5), p10: q(0.1), p90: q(0.9) };
}

// ------------------------------------------------------------------ CloudSystem
export class CloudSystem {
  /**
   * @param {object} o { renderer, lut (LutRenderer), uniforms (ATMOS_UNIFORMS), glslCore, glslSky, cityCount, quality }
   */
  constructor(o) {
    this.renderer = o.renderer;
    this.lut = o.lut;
    this.uniforms = o.uniforms;
    this.quality = o.quality;
    this._glslCore = o.glslCore;
    this._glsl = `${o.glslCore}\n${o.glslSky}\n${CLOUD_MARCH_GLSL.replace(/CITY_COUNT/g, String(o.cityCount))}`;
    this.cover = CLOUDS.cover;
    this._driftPerFrame = 0;
    this._lastOffset = null;
    this._bakeNoise();
    this._buildWeather();
    this._createShadowMap();
    this._createPanorama();
    this._createView();
  }

  _target(w, h, opts) {
    return new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false, generateMipmaps: false,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, ...opts,
    });
  }

  // -------------------------------------------------------------- noise
  _bake3D(size, fs, name) {
    const rt = new THREE.WebGL3DRenderTarget(size, size, size, {
      type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: false, stencilBuffer: false,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false,
    });
    const tex = rt.texture;
    tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping;
    tex.name = name;
    const mat = this.lut.material(name, fs, { uSlice: { value: 0 } });
    const r = this.renderer;
    const prev = r.getRenderTarget(), face = r.getActiveCubeFace(), mip = r.getActiveMipmapLevel();
    this.lut.mesh.material = mat;
    for (let z = 0; z < size; z++) {
      mat.uniforms.uSlice.value = z;
      r.setRenderTarget(rt, z);
      r.render(this.lut.scene, this.lut.camera);
    }
    r.setRenderTarget(prev, face, mip);
    mat.dispose();
    // Mip chain, built once here (three would rebuild it after every slice): the marches pick a
    // level from the sample's footprint (gAtmCloudLod). Bound through three's state cache.
    const gl = r.getContext();
    r.state.bindTexture(gl.TEXTURE_3D, r.properties.get(tex).__webglTexture);
    gl.generateMipmap(gl.TEXTURE_3D);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    r.state.unbindTexture();
    tex.minFilter = THREE.LinearMipmapLinearFilter;   // record only: the GL state above is what counts
    return rt;
  }

  _bake2D(size, fs, name) {
    const rt = new THREE.WebGLRenderTarget(size, size, {
      type: THREE.UnsignedByteType, depthBuffer: false, stencilBuffer: false,
      minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: true,
      wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping,
    });
    rt.texture.name = name;
    const mat = this.lut.material(name, fs);
    this.lut.render(mat, rt);
    mat.dispose();
    return rt;
  }

  _bakeNoise() {
    const t0 = performance.now();
    const u = this.uniforms;
    u.uAtmShape.value = (this.shapeRT = this._bake3D(SHAPE_SIZE, SHAPE_FS, 'Clouds.Shape')).texture;
    u.uAtmDetail.value = (this.detailRT = this._bake3D(DETAIL_SIZE, DETAIL_FS, 'Clouds.Detail')).texture;
    u.uAtmCurl.value = (this.curlRT = this._bake2D(CURL_SIZE, CURL_FS, 'Clouds.Curl')).texture;
    u.uAtmCirrusTex.value = (this.cirrusRT = this._bake2D(CIRRUS_SIZE, CIRRUS_FS, 'Clouds.Cirrus')).texture;
    this.bakeMs = performance.now() - t0;
  }

  // -------------------------------------------------------------- weather map
  _buildWeather() {
    const wrap = { wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping };
    // float, mipmapped for the macro lookup
    this.weatherRT = this._target(WEATHER_SIZE, WEATHER_SIZE, { ...wrap, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
    this.weatherRT.texture.name = 'Clouds.Weather';
    const wm = this.lut.material('Clouds.Weather', WEATHER_FS);
    this.lut.render(wm, this.weatherRT);
    wm.dispose();
    const nearest = { type: THREE.FloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter };
    this.weatherMaxRT = this._target(WEATHER_MAX_SIZE, WEATHER_MAX_SIZE, { ...wrap, ...nearest });
    const mm = this.lut.material('Clouds.WeatherMax', WEATHER_MAX_FS, { uMap: { value: this.weatherRT.texture } });
    this.lut.render(mm, this.weatherMaxRT);
    mm.dispose();
    const u = this.uniforms;
    u.uAtmWeather.value = this.weatherRT.texture;
    u.uAtmWeatherMax.value = this.weatherMaxRT.texture;
    u.uAtmCloud.value.y = 1 / WEATHER_TILE_M;
    u.uAtmCloud.value.z = CLOUD_EXTINCTION;

  }

  // Coverage threshold x (uAtmCloud.x) for a cover: COVER_TABLE, piecewise linear.
  _thresholdAt(cover) {
    const t = COVER_TABLE;
    let i = 1;
    while (i < t.length - 1 && cover > t[i][0]) i++;
    const a = t[i - 1], b = t[i], w = Math.min(1, Math.max(0, (cover - a[0]) / (b[0] - a[0])));
    return a[1] + (b[1] - a[1]) * w;
  }

  setCover(cover, threshold = this._thresholdAt(cover)) {
    this.cover = cover;
    // above ~35 % the patches alone cannot cover the sky: the gaps fill with stratocumulus
    this.uniforms.uAtmCloudLight2.value.w = smooth(0.3, 1.0, cover);
    this.uniforms.uAtmCloud.value.x = threshold;
    this.uniforms.uAtmCloud.value.w = cover;
    if (this._shadowState) this._shadowState.cx = 1e9;
    if (this._pano) this._pano.pre = -1;
  }

  // -------------------------------------------------------------- light-space optical-depth map
  _createShadowMap() {
    this.shadowRT = this._target(SHADOW_SIZE, SHADOW_SIZE, { generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
    this.shadowRT.texture.name = 'Clouds.LightSpace';
    this._shadowMat = this.lut.material('Clouds.LightSpace', `${this._glsl}
      uniform vec3 uKeyDir;          // the light the map is built for (may differ from uAtmKey: top-down calibration)
      uniform vec4 uXf;              // centre x, z; size (m); unused
      varying vec2 vUv;
      void main() {
        vec2 q = uXf.xy + (vUv - 0.5) * uXf.z;
        vec3 ro = vec3(q.x, -dot(q, q) * (0.5 / ATM_EARTH_R), q.y);
        vec3 L = normalize(uKeyDir);
        float lo = uAtmCloudAlt - 50.0, hi = uAtmCloudAlt + uAtmCloudThick + 50.0;
        vec2 iv = atmLayerInterval(ro, L, lo, hi, 200000.0);
        if (L.y < 0.01 || iv.y <= iv.x) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
        const int N = 10;
        float dt = (iv.y - iv.x) / float(N);
        gAtmCloudLod = atmCloudLodFor(max(uXf.z * ${f(1 / SHADOW_SIZE)}, dt * 0.25));   // the map's texel
        float tau = 0.0;
        vec3 cum = vec3(0.0);
        float third = (hi - lo) / 3.0;
        for (int i = 0; i < N; i++) {
          vec3 p = ro + L * (iv.x + (float(i) + 0.5) * dt);
          float alt = atmAltitude(p);
          tau += atmCloudDensity(p, alt, 0.0) * dt * uAtmCloud.z;
          float x = (alt + 0.5 * dt * L.y - lo) / third;
          if (x <= 1.0) cum.x = tau;
          if (x <= 2.0) cum.y = tau;
        }
        gl_FragColor = vec4(cum.x, max(cum.y, cum.x), tau, exp(-tau));
      }`, Object.assign({}, this.uniforms, {
      uAtmCloudShadow: { value: null },   // never read by this pass (it writes the map)
      uKeyDir: { value: new THREE.Vector3(0, 1, 0) }, uXf: { value: new THREE.Vector4(0, 0, 2 * SHADOW_HALF_M, 0) },
    }));
    this._shadowState = { cx: 1e9, cz: 1e9, band: 0, key: new THREE.Vector3(0, -2, 0) };
    this.uniforms.uAtmCloudShadow.value = this.shadowRT.texture;
  }

  // Renders a band of the map's rows (all when a full rebuild is due) for the current key light and camera.
  _renderShadow(camPos, full) {
    const st = this._shadowState;
    const cx = Math.round(camPos.x / SHADOW_SNAP_M) * SHADOW_SNAP_M, cz = Math.round(camPos.z / SHADOW_SNAP_M) * SHADOW_SNAP_M;
    const key = this.uniforms.uAtmKey.value;
    if (cx !== st.cx || cz !== st.cz || st.key.angleTo(key) > 0.3 * Math.PI / 180) full = true;
    const u = this._shadowMat.uniforms;
    u.uKeyDir.value.copy(key);
    u.uXf.value.set(cx, cz, 2 * SHADOW_HALF_M, 0);
    // mean transmittance used outside the map: 1 - cover x (1 - typical cloud T ~0.15)
    this.uniforms.uAtmCloudShadowXf.value.set(cx, cz, 1 / (2 * SHADOW_HALF_M), 1 - Math.min(1, this.cover) * 0.85);
    // a band of rows per frame: the whole map is refreshed before the clouds drift ~20 m (a fifth of a
    // 94 m texel): 1/16 of it per frame at real time, 1/4 in a time-lapse
    st.band = full ? 0 : this._banded(this._shadowMat, this.shadowRT, SHADOW_SIZE, SHADOW_SIZE, st.band, 16);
    if (full) this.lut.render(this._shadowMat, this.shadowRT);
    st.cx = cx; st.cz = cz; st.key.copy(key);
  }

  // Renders band `band` of a target's rows (the band count adapted to the drift, at most maxBands);
  // returns the next band.
  _banded(mat, rt, w, h, band, maxBands) {
    let n = maxBands;
    while (n > 4 && this._driftPerFrame * n > 20) n >>= 1;
    band %= n;
    rt.scissor.set(0, band * h / n, w, h / n);
    rt.scissorTest = true;
    this.lut.render(mat, rt);
    rt.scissorTest = false;
    return band + 1;
  }

  // -------------------------------------------------------------- panorama (skyRadiance consumers)
  _createPanorama() {
    this.panoRT = this._target(PANO_W, PANO_H, { wrapS: THREE.RepeatWrapping });
    this.panoRT.texture.name = 'Clouds.Panorama';
    this._panoMat = this.lut.material('Clouds.Panorama', `
      #define ATM_CLOUD_LIGHT_STEPS 4
      #define ATM_CLOUD_MAX_STEPS 48
      #define ATM_CLOUD_STEP_SCALE 1.8
      ${this._glsl}
      uniform float uFrame;
      varying vec2 vUv;
      void main() {
        float az = (vUv.x - 0.5) * ${f(2 * Math.PI)};
        float el = vUv.y * vUv.y * ${f(Math.PI / 2)};
        vec4 c = atmCloudLayersDelta(cameraPosition, vec3(sin(az) * cos(el), sin(el), -cos(az) * cos(el)), fract(atmIGN(gl_FragCoord.xy) + uFrame * 0.6180339887));
        gl_FragColor = vec4(c.rgb * uAtmPre, c.a);
      }`, Object.assign({}, this.uniforms, { uFrame: { value: 0 }, uCloudPixRad: { value: 2 * Math.PI / PANO_W } }));
    this.uniforms.uAtmCloudPano.value = this.panoRT.texture;
    this._pano = { frame: 0, band: 0, pos: new THREE.Vector3(1e9, 0, 0), pre: -1 };
  }

  // A band of the rows per frame (1/16 at real time: a full refresh every 0.27 s, 2 m of drift; 1/4
  // when the clouds drift fast); all at once when forced, when the pre-exposure changed by more than
  // 2 % (twilight) or the camera moved more than 50 m.
  _renderPanorama(camPos, pre, force) {
    const p = this._pano;
    const full = force || Math.abs(pre / p.pre - 1) > 0.02 || p.pos.distanceToSquared(camPos) > 50 * 50;
    this._panoMat.uniforms.uFrame.value = ++p.frame % 64;
    this.lut.camera.position.copy(camPos);
    this.lut.camera.updateMatrixWorld();
    if (full) {
      this.lut.render(this._panoMat, this.panoRT);
      this.uniforms.uAtmCloudPanoPre.value = pre;
      p.pos.copy(camPos); p.pre = pre;
    } else p.band = this._banded(this._panoMat, this.panoRT, PANO_W, PANO_H, p.band, 16);
    this.lut.camera.position.set(0, 0, 0);
    this.lut.camera.updateMatrixWorld();
  }

  // -------------------------------------------------------------- view buffer (dome + overlay)
  _createView() {
    const opts = { wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping };
    this.marchRT = this._target(2, 2, { ...opts, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    this.histRT = [this._target(2, 2, opts), this._target(2, 2, opts)];
    this.marchRT.texture.name = 'Clouds.ViewMarch';
    this.histRT[0].texture.name = this.histRT[1].texture.name = 'Clouds.View';
    this._histIndex = 0;
    // The texel of each 2x2 block marched in a frame: the Bayer order (0,0) (1,1) (1,0) (0,1), offset
    // per block by interleaved gradient noise, so the texels updated together never form a lattice.
    const slot = /* glsl */`
      uniform float uFrame;
      vec2 atmSlot(vec2 block) {
        int k = (int(uFrame) + int(atmIGN(block) * 4.0)) & 3;
        return vec2(k == 1 || k == 2, k == 1 || k == 3);
      }`;
    this._marchMat = this.lut.material('Clouds.ViewMarch', `${this._glsl}${slot}
      uniform mat4 uInvViewProj;     // inverse of (projection x view rotation) of the current frame
      uniform vec2 uViewSize;        // cloud-buffer size (texels)
      varying vec2 vUv;
      void main() {
        vec2 pix = floor(gl_FragCoord.xy) * 2.0 + atmSlot(floor(gl_FragCoord.xy)) + 0.5;
        vec4 w = uInvViewProj * vec4(pix / uViewSize * 2.0 - 1.0, 1.0, 1.0);
        vec3 dir = normalize(w.xyz / w.w);
        // this texel's own jitter sequence: a golden-ratio step per update (every 4th frame)
        float jit = fract(atmIGN(pix) + floor(uFrame * 0.25) * 0.6180339887);
        if (acos(clamp(dir.y, -1.0, 1.0)) > uAtmLUT.z + 0.003) {
          // below the horizon: only clouds between a camera above the base and the sea (overlay kind)
          if (atmAltitude(cameraPosition) < uAtmCloudAlt) { gl_FragColor = vec4(0.0, 0.0, 0.0, 3.0); return; }
          float tMean;
          vec4 cl = atmCloudMarch(cameraPosition, dir, jit, tMean);
          if (cl.a >= 0.999) { gl_FragColor = vec4(0.0, 0.0, 0.0, 3.0); return; }
          vec3 Tair = exp(-uAtmFogRGB * atmHazePath(cameraPosition, cameraPosition + dir * tMean));
          gl_FragColor = vec4(atmExpose((1.0 - cl.a) * atmHazeColour(dir) * (1.0 - Tair) + Tair * cl.rgb), 2.0 + cl.a);
          return;
        }
        vec4 c = atmCloudLayersDelta(cameraPosition, atmAboveHorizon(dir), jit);
        gl_FragColor = vec4(c.rgb * uAtmPre, c.a);
      }`, Object.assign({}, this.uniforms, {
      uInvViewProj: { value: new THREE.Matrix4() }, uViewSize: { value: new THREE.Vector2(1, 1) },
      uFrame: { value: 0 }, uCloudPixRad: { value: 0 },
    }));
    this.setQuality(this.quality);
    // Temporal resolve: this frame's new texels from the march target, the others reprojected from
    // the history through the cloud's depth (camera motion and the clouds' drift since the last frame)
    // and clipped to the mean +- 1.25 sigma of the new samples around them (same kind only); new
    // samples blend into their history, so the march noise averages out over ~1/uBlend updates.
    this._resolveMat = this.lut.material('Clouds.ViewResolve', `${this._glslCore}${IGN_GLSL}${slot}
      uniform sampler2D uMarch;
      uniform sampler2D uHist;
      uniform mat4 uInvViewProj;
      uniform mat4 uPrevViewProj;    // previous frame's projection x view rotation
      uniform vec3 uPrevCam;         // previous camera position + the clouds' drift since (world)
      uniform vec2 uViewSize;
      uniform float uPreRatio;       // pre-exposure now / when the history was written
      uniform float uHistValid;
      uniform float uBlend;          // weight of a new sample over its clipped history
      varying vec2 vUv;
      void main() {
        vec2 pix = floor(gl_FragCoord.xy), block = floor(pix * 0.5);
        ivec2 msize = textureSize(uMarch, 0);
        vec4 nNew = texelFetch(uMarch, ivec2(block), 0);
        bool overlayKind = nNew.a >= 1.5, fresh = all(equal(pix - block * 2.0, atmSlot(block)));
        // moments of the new samples of the 3x3 blocks around (same kind), and their tent-weighted mean
        vec4 m1 = vec4(0.0), m2 = vec4(0.0), near = vec4(0.0);
        float n = 0.0, nw = 0.0;
        for (int k = 0; k < 9; k++) {
          ivec2 q = clamp(ivec2(block) + ivec2(k % 3, k / 3) - 1, ivec2(0), msize - 1);
          vec4 s = texelFetch(uMarch, q, 0);
          if ((s.a >= 1.5) != overlayKind) continue;
          vec2 dd = abs(vec2(q) * 2.0 + atmSlot(vec2(q)) - pix);
          float wgt = max(3.0 - dd.x, 0.0) * max(3.0 - dd.y, 0.0);
          m1 += s; m2 += s * s; n += 1.0; near += wgt * s; nw += wgt;
        }
        m1 /= n;
        vec4 sd = sqrt(max(m2 / n - m1 * m1, 0.0)) * 1.25 + abs(m1) * 0.02 + 1e-6;
        near = nw > 0.0 ? near / nw : nNew;
        // history: reproject through the cloud's depth (the middle of the slab)
        vec4 w = uInvViewProj * vec4((pix + 0.5) / uViewSize * 2.0 - 1.0, 1.0, 1.0);
        vec3 dir = normalize(w.xyz / w.w);
        float A = dot(dir.xz, dir.xz) * (0.5 / ATM_EARTH_R), B = dir.y + dot(cameraPosition.xz, dir.xz) / ATM_EARTH_R;
        float C = atmAltitude(cameraPosition) - uAtmCloudAlt - 0.5 * uAtmCloudThick, disc = B * B - 4.0 * A * C;
        float tc = A < 1e-12 ? -C / B : (disc < 0.0 ? -1.0 : (-B + (C > 0.0 ? -1.0 : 1.0) * sqrt(disc)) / (2.0 * A));
        vec3 pd = tc > 0.0 ? normalize(cameraPosition + dir * tc - uPrevCam) : dir;
        vec4 c = uPrevViewProj * vec4(pd, 0.0);
        vec2 puv = c.w > 1e-6 ? c.xy / c.w * 0.5 + 0.5 : vec2(-1.0);
        bool histOk = uHistValid > 0.5 && all(greaterThanEqual(puv, vec2(0.0))) && all(lessThanEqual(puv, vec2(1.0)));
        vec4 h = histOk ? texture(uHist, puv) * vec4(vec3(uPreRatio), 1.0) : near;
        if ((h.a >= 1.5) != overlayKind) h = near;
        // clip toward the neighbourhood mean (Karis 2014) rather than clamping each channel on its own:
        // a per-channel clamp of a stale history (the light moving fast in a time-lapse) shifts hue
        // per 2x2 block, the blue blocky streaks along cloud bases of the p2 integration
        vec4 hd = (h - m1) / sd;
        float hk = max(max(abs(hd.x), abs(hd.y)), max(abs(hd.z), abs(hd.w)));
        if (hk > 1.0) h = m1 + (h - m1) / hk;
        gl_FragColor = fresh ? mix(h, nNew, histOk ? uBlend : 1.0) : h;
      }`, Object.assign({}, this.uniforms, {
      uMarch: { value: this.marchRT.texture }, uHist: { value: null },
      uInvViewProj: { value: new THREE.Matrix4() }, uPrevViewProj: { value: new THREE.Matrix4() },
      uPrevCam: { value: new THREE.Vector3() }, uViewSize: { value: new THREE.Vector2(1, 1) },
      uFrame: { value: 0 }, uPreRatio: { value: 1 }, uHistValid: { value: 0 }, uBlend: { value: BLEND_STILL },
    }));
    this._view = { frame: 0, prevVP: new THREE.Matrix4(), prevCam: new THREE.Vector3(), prevOff: new THREE.Vector2(), prevKey: new THREE.Vector3(0, 1, 0), prevPre: 1, valid: false, w: 0, h: 0 };
    this._tmpM = new THREE.Matrix4(); this._tmpM2 = new THREE.Matrix4();
  }

  /** Quality tier (config QUALITY entry): march steps of the view buffer. */
  setQuality(q) {
    this.quality = q;
    const t = VIEW_TIERS[q?.name] || VIEW_TIERS.high;
    const m = this._marchMat;
    if (m && JSON.stringify(m.defines) !== JSON.stringify(t)) { m.defines = { ...t }; m.needsUpdate = true; }
    this.invalidateHistory();
  }

  invalidateHistory() { if (this._view) this._view.valid = false; }

  // Marches this frame's texel of every 2x2 block of the view buffer and resolves it. Writes the
  // projection x view rotation the buffer is indexed with (for the dome / overlay lookups) into
  // outViewProj and returns the resolved texture.
  renderView(cam, camPos, pre, drawingBufferSize, scale, outViewProj) {
    const v = this._view;
    // the buffer never exceeds VIEW_MAX_TEXELS (a HiDPI drawing buffer does not multiply the march)
    const s = Math.min(scale, Math.sqrt(VIEW_MAX_TEXELS / Math.max(drawingBufferSize.x * drawingBufferSize.y, 1)));
    const W = Math.max(2, Math.ceil(drawingBufferSize.x * s / 2) * 2), H = Math.max(2, Math.ceil(drawingBufferSize.y * s / 2) * 2);
    if (W !== v.w || H !== v.h) {
      this.histRT[0].setSize(W, H); this.histRT[1].setSize(W, H);
      this.marchRT.setSize(W / 2, H / 2);
      v.w = W; v.h = H; v.valid = false;
    }
    cam.updateMatrixWorld();
    const rot = this._tmpM.extractRotation(cam.matrixWorld);
    outViewProj.multiplyMatrices(cam.projectionMatrix, this._tmpM2.copy(rot).transpose());
    const inv = this._tmpM2.copy(outViewProj).invert();
    const moved = !v.valid || !outViewProj.equals(v.prevVP) || v.prevCam.distanceToSquared(camPos) > 1e-4;
    // History keeps the light it was marched with: when the key light moves fast (a time-lapse) the
    // new samples get weight 2 per degree it moved since the last frame (at most 0.5, which keeps the
    // march noise averaged over a few updates): 3600x moves the sun 0.25-1.2 deg a frame and the clouds
    // lag it by 2-9 deg instead of ~40; at 60x (0.004 deg) nothing changes
    const key = this.uniforms.uAtmKey.value;
    const lightBlend = Math.min(0.5, 2 * v.prevKey.angleTo(key) * 180 / Math.PI);
    v.prevKey.copy(key);
    const off = this.uniforms.uAtmCloudOffset.value;
    const m = this._marchMat.uniforms, r = this._resolveMat.uniforms;
    m.uInvViewProj.value.copy(inv);
    m.uViewSize.value.set(W, H);
    m.uCloudPixRad.value = (cam.fov ?? 45) * Math.PI / 180 / H;
    r.uInvViewProj.value.copy(inv);
    r.uViewSize.value.set(W, H);
    this.lut.camera.position.copy(camPos);
    this.lut.camera.updateMatrixWorld();
    // A buffer without history (boot, resize, tier change, clock jump) is filled whole at once: every
    // texel of each 2x2 block is marched twice in eight passes and the two samples averaged, so the
    // first frame never shows the half-resolution lattice (p2 integration: kirt.lol capture frame 0
    // and the first ~0.5 s after a time jump did). Seven extra marches, on those frames only.
    const passes = v.valid ? 1 : 8;
    let dst = null;
    for (let k = 0; k < passes; k++) {
      const frame = ++v.frame % 1024;
      m.uFrame.value = frame;
      this.lut.render(this._marchMat, this.marchRT);
      const src = this.histRT[this._histIndex];
      dst = this.histRT[1 - this._histIndex];
      r.uHist.value = src.texture;
      r.uPrevViewProj.value.copy(v.prevVP);
      // a cloud now at P was at P + (offset change) a frame ago: reproject from the previous camera
      // displaced by the opposite drift
      r.uPrevCam.value.set(v.prevCam.x - (off.x - v.prevOff.x), v.prevCam.y, v.prevCam.z - (off.y - v.prevOff.y));
      r.uFrame.value = frame;
      r.uPreRatio.value = v.prevPre > 0 ? pre / v.prevPre : 1;
      r.uHistValid.value = v.valid ? 1 : 0;
      r.uBlend.value = passes > 1 ? 1 / (1 + (k >> 2)) : Math.max(moved ? BLEND_MOVING : BLEND_STILL, lightBlend);
      this.lut.render(this._resolveMat, dst);
      this._histIndex = 1 - this._histIndex;
      v.prevVP.copy(outViewProj); v.prevCam.copy(camPos); v.prevOff.copy(off); v.prevPre = pre; v.valid = true;
    }
    this.lut.camera.position.set(0, 0, 0);
    this.lut.camera.updateMatrixWorld();
    return dst.texture;
  }

  // -------------------------------------------------------------- per frame
  update(camPos, pre, { force = false } = {}) {
    const off = this.uniforms.uAtmCloudOffset.value;
    if (this._lastOffset) this._driftPerFrame = Math.hypot(off.x - this._lastOffset.x, off.y - this._lastOffset.y);
    else this._lastOffset = off.clone();
    this._lastOffset.copy(off);
    this._renderShadow(camPos, force);
    this._renderPanorama(camPos, pre, force);
  }

  // After a context restore: the GL objects died with the old context (disposing them would only
  // warn), so the one-time products are simply baked again into new targets.
  restoreGPU() {
    this._bakeNoise();
    this._buildWeather();
    this.setCover(this.cover);
    this._view.valid = false;
  }

  dispose() {
    for (const rt of [this.shapeRT, this.detailRT, this.curlRT, this.cirrusRT, this.weatherRT, this.weatherMaxRT, this.shadowRT, this.panoRT, this.marchRT, this.histRT[0], this.histRT[1]]) rt.dispose();
    this._shadowMat.dispose(); this._panoMat.dispose(); this._marchMat.dispose(); this._resolveMat.dispose();
  }
}

// ------------------------------------------------------------------ dev: cover calibration
// (referenced only from dev builds: a host bundle with NJOW_DEV = false leaves all of this out)

/** Top-down projected cover (and patch sizes) of one weather tile (q in [0, 25.6 km]^2; tile-aligned so
 *  wrapping patches are measured whole) at the current threshold: the vertical optical depth at 256^2
 *  through the light-space pass, cloud where T < tCloud. */
export function measureCloudsTopDown(cs, tCloud = 0.5, patches = true) {
  const N = 256, r = cs.renderer;
  const rt = cs._target(N, N, { type: THREE.FloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
  const u = cs._shadowMat.uniforms, off = cs.uniforms.uAtmCloudOffset.value;
  const keep = [u.uKeyDir.value.clone(), u.uXf.value.clone()];
  u.uKeyDir.value.set(0, 1, 0);
  u.uXf.value.set(WEATHER_TILE_M / 2 - off.x, WEATHER_TILE_M / 2 - off.y, WEATHER_TILE_M, 0);
  cs.lut.render(cs._shadowMat, rt);
  const px = new Float32Array(N * N * 4), gl = r.getContext();
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);   // another module's asynchronous read may hold one bound
  r.readRenderTargetPixels(rt, 0, 0, N, N, px);
  rt.dispose();
  u.uKeyDir.value.copy(keep[0]); u.uXf.value.copy(keep[1]);
  cs._shadowState.cx = 1e9;                    // the real map is rebuilt next frame
  const covered = new Uint8Array(N * N);
  let n = 0;
  for (let i = 0; i < N * N; i++) if (px[i * 4 + 3] < tCloud) { covered[i] = 1; n++; }
  return { cover: n / (N * N), ...(patches ? patchSizes(covered, N) : {}) };
}

/** Re-derives COVER_TABLE: per cover, bisection on the threshold (the projected cover falls as it
 *  rises) until the projected cover equals it. Restores the current cover. */
export function deriveCoverTable(cs, covers = COVER_TABLE.map((row) => row[0])) {
  const cover = cs.cover;
  const table = covers.map((c) => {
    let lo = -0.5, hi = 1.5;
    for (let i = 0; i < COVER_ITERATIONS; i++) {
      const x = 0.5 * (lo + hi);
      cs.setCover(c, x);
      if (measureCloudsTopDown(cs, VISIBLE_T, false).cover > c) lo = x; else hi = x;
    }
    return [c, +(0.5 * (lo + hi)).toFixed(5)];
  });
  cs.setCover(cover);
  return table;
}
