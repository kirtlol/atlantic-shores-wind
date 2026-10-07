// Physically based sky, clouds, sun, moon, stars and aerial perspective (owner: atmosphere).
//
// Model: Rayleigh + Mie + ozone single scattering with Hillaire's (EGSR 2020) multiple-scattering
// approximation; every coefficient from config ATMOS (Bruneton + NJ maritime aerosol, 100 km top),
// with a two-term HG phase (MIE_TTHG) and a camera-band ozone correction (OZONE_CAMERA_BAND).
// Look-up tables, rendered with fragment shaders into small half-float targets:
//   transmittance LUT (256x64)    once; stores optical depth (grazing twilight paths do not underflow)
//   multi-scattering LUT (32x32)  once; stores log2 (deep-twilight values survive half-float)
//   sky-view LUT (256x160)        whenever the sun or moon moved > 0.05 deg or the camera changed
//                                 altitude or place; absolute azimuth x elevation (concentrated at
//                                 the horizon); sun + moon in-scatter, the aerosol's forward-peaked
//                                 response to the anisotropic diffuse field (DIFFUSE_SHAPE: the
//                                 bright haze band at the horizon, less veil over the sea), city
//                                 light domes, airglow (diffuse-source form, Krisciunas &
//                                 Schaefer), cloud and night-sky diffuse light, and the Earth's
//                                 shadow in civil twilight (MS_SHADOW);
//                                 alpha: for rays that end on the sea 1 - path transmittance
//                                 (aerial perspective reads the in-scatter per unit opacity from
//                                 it), for sky rays the degree of polarization (camera polarizer)
// A 64x4 float "ambient" target reduces the sky-view LUT to horizon radiance per azimuth (read
// back for the exposure diagnostics) and ambient terms for the clouds. A discontinuous clock change
// (setTime / setDate) rebuilds all of it synchronously before the frame (no stale light).
//
// Clouds (clouds.js): a volumetric stratocumulus / cumulus humilis layer, 1100-1400 m: thin flat
// sheets and rolls from a tileable weather map, broken and frayed by baked 3D noise, lit by a light
// march + a light-space optical-depth map, multiple-scattering octaves, a three-lobe phase with a
// silver lining, ambient and city light from below. Products: a temporally resolved half-resolution
// view buffer (dome + overlay for cameras above the base, Catmull-Rom upsampled), a panorama that
// skyRadiance() / the environment / the ambient pass read, and the light-space map cloudShadow()
// reads. A thin cirrostratus sheet at 7 km adds fibrous streaks. The dome applies the camera's
// polarizing filter (U.uPolarizer) to the clear sky between the clouds.
//
// Night (sky-night.js): the bright-star catalogue (every constellation to V ~3.9, precessed) plus a
// procedural field of fainter stars, a baked Milky Way (disk, bulge, star clouds, the branched Great
// Rift), moon with phase, maria and earthshine, van Rhijn airglow, light domes toward Atlantic City,
// the coast, Philadelphia and New York. atmosphere.zenithSkyMag / zenithRadiance publish the clear
// zenith (moonless target 21.5-21.8 mag/arcsec2) for Post.
//
// Units: radiance and illuminance in scene units (1 illuminance unit = LOOK.sceneUnitLux lux).
// Every colour this module writes into a render target is multiplied by the PRE-EXPOSURE
// (`atmosphere.preExposure`, GLSL `uAtmPre`), 1 by day rising to 4000 at night, so night
// radiances (1e-9..1e-6) stay representable in half-float targets. applyAerialPerspective()
// applies it for every consumer; Post must set toneMappingExposure = exposure / preExposure.
import * as THREE from 'three';
import { U, EARTH_R, registerScale } from '../shared.js';
import { ATMOS, CLOUDS, SITE, SUN, SHADOW, LOOK, SEA, QUALITY, CAMERA_PRESETS } from '../config.js';
import { SimClock, localSiderealTimeDeg, atmosphericRefractionDeg, MOON_RADIUS_KM } from './time.js';
import {
  CloudSystem, CLOUD_UNIFORMS, CLOUD_CORE_GLSL, CLOUD_PANO_GLSL, HASH_GLSL, CITY_EMISSION_GLSL, WEATHER_TILE_M, CLOUD_EXTINCTION, WEATHER_PHASE_M,
  measureCloudsTopDown, deriveCoverTable,
} from './clouds.js';
import { buildStarTextures, MILKY_WAY_FS, MW_W, MW_H, STAR_CATALOG_LIMIT_V, STAR_CATALOG_CELLS } from './sky-night.js';

// ================================================================== constants

// Extraterrestrial solar illuminance, the "solar illuminance constant" (Wikipedia, Sunlight: 128 klx).
const SOLAR_ILLUMINANCE_LX = 128000;
// Full-moon illuminance above the atmosphere at mean distance (Allen, Astrophysical Quantities).
const FULL_MOON_LX = 0.267;
const MOON_MEAN_DISTANCE_KM = 384400;
const SUN_RADIUS_KM = 695700;               // IAU 2015 nominal solar radius
const AU_KM = 149597870.7;
// Moonlight is reflected sunlight reddened by the regolith: the Moon's B-V (0.92) is 0.27 mag redder
// than the Sun's (0.65), i.e. blue/visual 0.78; red/visual ~1.12 from the rising lunar albedo.
const MOON_TINT = [1.12, 1.0, 0.78];
// Illuminance of a magnitude-0 star above the atmosphere (V band).
const MAG0_LX = 2.54e-6;
// Natural night sky: total ~22 mag/arcsec^2 at the zenith, most of it airglow (1.0e-4 cd/m2 used
// for the airglow part, green 557.7 nm + red 630 nm + OH, van Rhijn brightening to the horizon).
const AIRGLOW_ZENITH_CDM2 = 1.0e-4;
// Linear-RGB tint of the airglow + natural background as a camera records it: 557.7 nm green and
// 589 nm Na make it slightly green-yellow, but kept near neutral (0.82/1/0.78 turned brown under the
// ACES toe); Post's scotopic (Purkinje) grade supplies the eye's blue night shift.
const AIRGLOW_TINT = [0.90, 1.0, 0.92];
const AIRGLOW_HEIGHT_KM = 90;
// Integrated starlight + zodiacal light: the rest of the ~22 mag/arcsec^2 natural background,
// nearly uniform over the sky (Leinert et al. 1998).
const STARLIGHT_BACKGROUND_CDM2 = 0.7e-4;
const STARLIGHT_TINT = [1.0, 0.96, 0.88];
// Milky Way: surface brightness of 1 unit of the baked panorama (sky-night.js): the Sagittarius star
// cloud (~1.9 units) at ~6e-4 cd/m2 (20.1 mag/arcsec^2, the bright end of the measured 19.8-20.5),
// Cygnus ~3e-4, the band ~2e-4: the brightest star clouds about 3x a dark marine sky's zenith.
const MILKY_WAY_CDM2 = 3.2e-4;
// Star counts over the whole sky: log10 N(<m) = A + B m (fits N(<2) ~ 50, N(<4) ~ 520, N(<6) ~ 4000).
const STAR_COUNT_A = 0.97, STAR_COUNT_B = 0.44, STAR_MAG_LIMIT = 7.0;
const STAR_CELLS = 256;               // per cube face of the celestial sphere
// Camera white balance: the "daylight" balance makes direct sunlight neutral at the reference
// photo's sun (SCENE-SPEC §8, 43 deg). Applied to the solar spectrum above the atmosphere, so all
// ratios (sky/sun, sunset reddening) stay physical, exactly like a camera's fixed WB.
const WB_REFERENCE_ELEVATION_DEG = 42.97;
// Pre-exposure: 1 while the sun is up, 10^PRE_EXPOSURE_LOG10_NIGHT once it is 12 deg down.
// 4000 keeps the brightest lamp cores (L-864: 1.1 scene units) below the half-float limit.
const PRE_EXPOSURE_LOG10_NIGHT = Math.log10(4000);
// Largest value this module writes into a half-float target (65504 is the format maximum).
const HALF_SAFE_MAX = 30000;
// Light domes (ESTIMATED: calibrated to ~1e-2 cd/m2, about 17.5 mag/arcsec^2, at 1 deg above the
// horizon toward Atlantic City from the hero and ~5e-5 cd/m2 at 45 deg: an over-water Bortle 4-5
// sky 18 km from a brightly lit casino city of ~40k (county ~275k); volumetric model below).
// Intensity I in scene-illuminance units x m^2 (illuminance at distance d is I / d^2).
const CITY_TINT = [1.0, 0.78, 0.55];    // mixed 3000 K LED + residual sodium, linear
const CITIES = [
  // radius 3.5 km: the lit barrier-island strip (Ventnor to the Marina, ~7 km) rather than a point,
  // so the cloud bases over the city glow broadly instead of one base lighting up like a lozenge
  { /* Atlantic City */ bearingDeg: SITE.atlanticCity.bearingDeg, distanceM: SITE.atlanticCity.distanceM, I: 118, radiusM: 3500 },
  { /* Brigantine */ bearingDeg: 327, distanceM: 17600, I: 18, radiusM: 2000 },
  { /* Ocean City */ bearingDeg: 270, distanceM: 28000, I: 41, radiusM: 3000 },
  { /* Beach Haven (LBI) */ bearingDeg: 358, distanceM: 31000, I: 18, radiusM: 3000 },
  { /* Philadelphia / South Jersey */ bearingDeg: 300, distanceM: 90000, I: 1.0e5, radiusM: 30000 },
  // New York metro (Manhattan 40.758 N 73.986 W: 166 km at 7.8 deg from the hero), 2.5x Philadelphia's
  // intensity: the glow that lifts the northern horizon on moonless nights (p1 night critique).
  { /* New York */ bearingDeg: 7.8, distanceM: 166000, I: 2.6e5, radiusM: 40000 },
];
// Moon albedo map: major maria (dark) and bright ray craters in selenographic longitude/latitude
// (deg, east = toward Mare Crisium), angular radius (deg) and albedo change. Highlands 0.135.
const MOON_HIGHLAND_ALBEDO = 0.135;
const MOON_FEATURES = [
  [-57, 18, 21, -0.055], [-48, -2, 14, -0.050], [-66, 32, 11, -0.045],   // Oceanus Procellarum
  [-16, 33, 13, -0.060],                                                  // Mare Imbrium
  [17.5, 28, 9.5, -0.060],                                                // Mare Serenitatis
  [31, 8.5, 11, -0.065],                                                  // Mare Tranquillitatis
  [59, 17, 7, -0.065],                                                    // Mare Crisium
  [51, -8, 9, -0.050],                                                    // Mare Fecunditatis
  [35, -15, 5, -0.050],                                                   // Mare Nectaris
  [-17, -21, 9, -0.045],                                                  // Mare Nubium
  [-39, -24, 6, -0.050],                                                  // Mare Humorum
  [0, 56, 8, -0.040],                                                     // Mare Frigoris
  [-30, 7, 7, -0.040],                                                    // Mare Insularum / Vaporum
  [-11, -43, 2.2, 0.090],                                                 // Tycho
  [-11, -43, 14, 0.025],                                                  // Tycho ray halo
  [-20, 10, 1.6, 0.050],                                                  // Copernicus
];

// LUT sizes.
const TRANS_W = 256, TRANS_H = 64;
const MS_SIZE = 32;
const SKY_W = 256, SKY_H = 160;
const AMB_W = 64, AMB_H = 4;
const CIRRUS = { altitude: CLOUDS.cirrus.altitude, tau: CLOUDS.cirrus.tau };
// View cloud buffer resolution relative to the drawing buffer, per quality tier.
const CLOUD_VIEW_SCALE = { low: 1 / 3, med: 0.4, high: 1 / 2, ultra: 1 / 2 };

// Re-render thresholds.
const SKY_LUT_ANGLE_DEG = 0.05;          // ARCHITECTURE: re-render the sky LUT when the sun moved > ~0.05 deg
const ENV_ANGLE_DEG = 0.5;               // re-bake the environment when the sun moved > 0.5 deg
const ENV_CLOUD_DRIFT_M = 300;           // ... or the clouds drifted this far
const ENV_MIN_INTERVAL_S = 0.25;         // at most four amortized re-bakes per real second

// Physical constants in km for the LUT shaders. Config ATMOS is the single source of truth: a 100 km
// top (the twilight sky between sun -6 and -12 deg is single scattering above the Earth's shadow,
// 35 km overhead at -6, 97 km at -10 deg), and one exponential aerosol layer whose sea-level
// extinction and scale height are the geometry fog's (mieExtinction, fogHeightFalloff = 1 /
// mieScaleHeight = 1/2500 m), so the sky, the transmittance LUT, applyAerialPerspective() and the
// cloud march all see the same haze (round 3: AOD(550) = 1.644e-5 /m x 2500 m = 0.041, visibility
// ~130 km; SCENE-SPEC addendum 2026-10-06).
const RB_KM = ATMOS.planetRadius / 1000;
const RT_KM = ATMOS.topRadius / 1000;
const RAY_KM = ATMOS.rayleighScattering.map((v) => v * 1000);
const RAY_H_KM = ATMOS.rayleighScaleHeight / 1000;
const MIE_EXT_KM = ATMOS.mieExtinction.map((v) => v * 1000);
const MIE_SCA_KM = MIE_EXT_KM.map((v) => v * ATMOS.mieSingleScatterAlbedo);
const MIE_H_KM = 1 / ATMOS.fogHeightFalloff / 1000;
const mieProfile = (h) => Math.exp(-h / MIE_H_KM);
// Camera-band correction of the ozone (Chappuis) absorption. Config ATMOS.ozoneAbsorption is
// Bruneton's monochromatic value at 680 / 550 / 440 nm; a camera's red channel (~570-650 nm) sits on
// the Chappuis peak (603 nm, ~4x the 680 nm cross-section) and its blue channel (~420-490 nm) sees
// ~2x the 440 nm value. The band-averaged factors would be ~(3.9, 0.8, 2.0); half of that in log
// terms (1.5, 0.9, 1.3) keeps the Belt of Venus rose (B/R 1.0-1.2, G/R 0.6 at -4 deg) while the
// twilight zenith turns from lilac (B/R 2.2) to blue (2.5 at -3.7, 3.9 at -7.6 deg): the lilac wash
// of the p1 sky / night critiques was the unweighted 680 nm red surviving the grazing ozone path.
const OZONE_CAMERA_BAND = [1.5, 0.9, 1.3];
const OZONE_KM = ATMOS.ozoneAbsorption.map((v, c) => v * 1000 * OZONE_CAMERA_BAND[c]);
// Aerosol phase function: a two-term Henyey-Greenstein w HG(g1) + (1 - w) HG(g2) whose asymmetry
// w g1 + (1 - w) g2 equals ATMOS.mieG (0.80). A single lobe with that g puts several times too
// little light into side and back scattering compared with measured continental and maritime
// aerosol phase functions (OPAC, AERONET inversions), which matters here because the reference
// view looks away from the sun. g2 < 0 is the back lobe.
const MIE_G = ATMOS.mieG;
const MIE_TTHG = (() => { const g1 = 0.87, g2 = -0.40, w = (MIE_G - g2) / (g1 - g2); return { w, g1, g2 }; })();
// Shape of the diffuse radiance field in the lowest kilometre, relative units (DERIVED from
// this model's own 16:30 sky at the drone azimuth: horizon band 1.9x, zenith 0.64x the full-sphere
// mean; the sea below reflects ~5-10 % of the sky plus upwelling, 0.14x), and the fraction of the
// aerosol's scattering that is forward enough to follow it (delta-Eddington f = g^2).
// sunForward: the fraction used for the sun's MS term. Lower than g^2: under the default 28 % cumulus
// the clouds' own light (fed back through the ambient reduction as an isotropic source) already lifts
// the low haze band; 0.35 keeps the band on the photo's 1.25-1.43 exposed with clouds and the ratio
// Y(L_horizon) / E_sun inside SCENE-SPEC §12's 0.08-0.16 with or without them.
const DIFFUSE_SHAPE = { horizon: 1.9, zenith: 0.64, sea: 0.14, upWidthRad: 0.06, downWidthRad: 0.02, forward: MIE_G * MIE_G, sunForward: 0.35 };
function diffuseShapeUniform() {
  const d = DIFFUSE_SHAPE;
  // full-sphere mean of the profile (cos-weighted elevation integrals of the exponential bands)
  const up = d.zenith + (d.horizon - d.zenith) * d.upWidthRad / (1 + d.upWidthRad ** 2);
  const dn = d.sea + (d.horizon - d.sea) * d.downWidthRad / (1 + d.downWidthRad ** 2);
  const M = 0.5 * (up + dn);
  return new THREE.Vector4(d.horizon / M, d.zenith / M, d.sea / M, d.forward);
}
const OZ_START = ATMOS.ozoneLayer.start / 1000, OZ_PEAK = ATMOS.ozoneLayer.peak / 1000, OZ_END = ATMOS.ozoneLayer.end / 1000;

const RAD = Math.PI / 180;
// Earth's shadow in civil twilight. Hillaire's MS LUT is a per-(altitude, sun angle) sphere mean,
// so it lights the air inside the planet's shadow as brightly as the lit air beside it and fills
// the shadow in (antisolar L(2 deg)/L(12 deg) 0.83 at sun -4, no blue-grey band under the belt).
// Air in the shadow keeps "floor" of its MS source (soft edge softRad). The weight is full down to
// sun fullDeg and fades out by offDeg: below that the whole low sky is in shadow, the MS field is
// all there is and the deep-twilight luminance (validated against the log-LUT fix) is kept.
// Sun -4, antisolar: L(2)/L(12) 0.59, B/R(2) 1.48x B/R(12), belt B/R ~1.0 (rose, was 1.45 lilac).
const MS_SHADOW = { floor: 0.5, fullDeg: -5, offDeg: -8, softRad: 0.02 };
const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

// ================================================================== CPU atmosphere (JS mirror of the LUT physics)

function extinctionKm(h, out) {
  const r = Math.exp(-h / RAY_H_KM), m = mieProfile(h);
  const o = Math.max(0, h < OZ_PEAK ? (h - OZ_START) / (OZ_PEAK - OZ_START) : (OZ_END - h) / (OZ_END - OZ_PEAK));
  for (let c = 0; c < 3; c++) out[c] = RAY_KM[c] * r + MIE_EXT_KM[c] * m + OZONE_KM[c] * o;
  return out;
}
const _ext = [0, 0, 0];
/** Transmittance from altitude hKm along zenith cosine mu to space (ignores the ground). */
function transmittanceToSpace(hKm, mu, out = [0, 0, 0]) {
  const r = RB_KM + hKm;
  const d = -r * mu + Math.sqrt(Math.max(RT_KM * RT_KM - r * r * (1 - mu * mu), 0));
  const N = 96;
  let o0 = 0, o1 = 0, o2 = 0;
  for (let i = 0; i < N; i++) {
    const a = i / N, b = (i + 1) / N;
    const t = d * (a * a + b * b) * 0.5, dt = d * (b * b - a * a);
    const hh = Math.sqrt(r * r + t * t + 2 * r * mu * t) - RB_KM;
    extinctionKm(Math.max(hh, 0), _ext);
    o0 += _ext[0] * dt; o1 += _ext[1] * dt; o2 += _ext[2] * dt;
  }
  out[0] = Math.exp(-o0); out[1] = Math.exp(-o1); out[2] = Math.exp(-o2);
  return out;
}
/** Fraction of a disk of angular radius angR (rad) above the geometric horizon of altitude hKm. */
function diskVisibility(hKm, elevationRad, angR) {
  const dip = Math.acos(RB_KM / (RB_KM + Math.max(hKm, 1e-6)));
  const x = (elevationRad + dip) / angR;               // -1 = set, +1 = fully up
  if (x <= -1) return 0;
  if (x >= 1) return 1;
  // area fraction of a circle above a chord at offset x (x in radii)
  return 1 - (Math.acos(x) - x * Math.sqrt(1 - x * x)) / Math.PI;
}

// ================================================================== GLSL

const f = (x) => { const s = Number(x).toPrecision(9); return /[.e]/.test(s) ? s : s + '.0'; };
const v3 = (a) => `vec3(${f(a[0])}, ${f(a[1])}, ${f(a[2])})`;

// Physics shared by the LUT shaders and ATMOS_GLSL. Distances in km inside the atmosphere model.
const GLSL_PHYSICS = /* glsl */`
#define ATM_PI 3.141592653589793
const float ATM_RB = ${f(RB_KM)};
const float ATM_RT = ${f(RT_KM)};
const vec3 ATM_RAY = ${v3(RAY_KM)};
const float ATM_RAY_H = ${f(RAY_H_KM)};
const vec3 ATM_MIE_S = ${v3(MIE_SCA_KM)};
const vec3 ATM_MIE_E = ${v3(MIE_EXT_KM)};
const float ATM_MIE_H = ${f(MIE_H_KM)};
const float ATM_MIE_W = ${f(MIE_TTHG.w)};
const float ATM_MIE_G1 = ${f(MIE_TTHG.g1)};
const float ATM_MIE_G2 = ${f(MIE_TTHG.g2)};
const vec3 ATM_OZONE = ${v3(OZONE_KM)};
const vec3 ATM_OZ = vec3(${f(OZ_START)}, ${f(OZ_PEAK)}, ${f(OZ_END)});
const vec2 ATM_TRANS_SIZE = vec2(${f(TRANS_W)}, ${f(TRANS_H)});
const vec2 ATM_MS_SIZE = vec2(${f(MS_SIZE)}, ${f(MS_SIZE)});
const vec2 ATM_SKY_SIZE = vec2(${f(SKY_W)}, ${f(SKY_H)});

float atmToSub(float u, float n) { return 0.5 / n + u * (1.0 - 1.0 / n); }
float atmLum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
// Relative aerosol density at altitude h (km), and its mean between the ground and h (slant paths).
float atmMieDensity(float h) { return exp(-h / ATM_MIE_H); }
float atmMieMeanTo(float h) { h = max(h, 1e-3); return ATM_MIE_H * (1.0 - exp(-h / ATM_MIE_H)) / h; }
float atmFromSub(float u, float n) { return (u - 0.5 / n) / (1.0 - 1.0 / n); }

vec3 atmExtinction(float h) {
	float o = max(0.0, h < ATM_OZ.y ? (h - ATM_OZ.x) / (ATM_OZ.y - ATM_OZ.x) : (ATM_OZ.z - h) / (ATM_OZ.z - ATM_OZ.y));
	return ATM_RAY * exp(-h / ATM_RAY_H) + ATM_MIE_E * atmMieDensity(h) + ATM_OZONE * o;
}
float atmRayPhase(float c) { return 0.0596831 * (1.0 + c * c); }
float atmHG(float g, float c) { return (1.0 - g * g) / (4.0 * ATM_PI * pow(max(1.0 + g * g - 2.0 * g * c, 1e-6), 1.5)); }
// Aerosol phase: two-term Henyey-Greenstein with the configured asymmetry g (see MIE_TTHG).
float atmMiePhase(float c) { return ATM_MIE_W * atmHG(ATM_MIE_G1, c) + (1.0 - ATM_MIE_W) * atmHG(ATM_MIE_G2, c); }

// Cosine of the zenith angle of the geometric horizon seen from altitude h (km); negative.
float atmHorizonMu(float h) { float r = ATM_RB + h; return -sqrt(max(h * (2.0 * ATM_RB + h), 0.0)) / r; }

// Transmittance LUT parametrisation (Bruneton 2017), from altitude h (km) and zenith cosine mu.
vec2 atmTransUV(float h, float mu) {
	float r = ATM_RB + h;
	float H = sqrt(ATM_RT * ATM_RT - ATM_RB * ATM_RB);
	float rho = sqrt(max(h * (2.0 * ATM_RB + h), 0.0));
	float disc = ATM_RT * ATM_RT - r * r * (1.0 - mu * mu);
	float d = max(-r * mu + sqrt(max(disc, 0.0)), 0.0);
	float dMin = ATM_RT - r, dMax = rho + H;
	float xMu = clamp((d - dMin) / max(dMax - dMin, 1e-6), 0.0, 1.0);
	return vec2(atmToSub(xMu, ATM_TRANS_SIZE.x), atmToSub(clamp(rho / H, 0.0, 1.0), ATM_TRANS_SIZE.y));
}
// The LUT stores optical depth, not exp(-od): grazing twilight paths reach od 10-25, whose
// transmittance (1e-5..1e-11) would underflow a half-float target to zero or to a few subnormal
// ulps of red, turning deep twilight blood-red (p1 night critique). Optical depth stays in range.
vec3 atmTransmittance(sampler2D lut, float h, float mu) {
	return exp(-texture(lut, atmTransUV(max(h, 0.0), max(mu, atmHorizonMu(max(h, 0.0))))).rgb);
}
// Soft planet shadow: fraction of a light of angular radius angR above the local horizon.
float atmLightVisibility(float h, float mu, float angR) {
	float muH = atmHorizonMu(max(h, 0.0));
	float s = angR * sqrt(max(1.0 - muH * muH, 0.0)) + 1e-5;
	return smoothstep(muH - s, muH + s, mu);
}
vec2 atmMSUV(float h, float muS) {
	return vec2(atmToSub(clamp(muS * 0.5 + 0.5, 0.0, 1.0), ATM_MS_SIZE.x),
	            atmToSub(clamp(h / (ATM_RT - ATM_RB), 0.0, 1.0), ATM_MS_SIZE.y));
}
// Nearest positive intersection of a ray with a sphere of radius R centred at the origin, or -1.
float atmRaySphere(vec3 o, vec3 d, float R) {
	float b = dot(o, d);
	float c = dot(o, o) - R * R;
	float disc = b * b - c;
	if (disc < 0.0) return -1.0;
	float s = sqrt(disc);
	float t0 = -b - s, t1 = -b + s;
	return t0 > 0.0 ? t0 : (t1 > 0.0 ? t1 : -1.0);
}
`;

// Shared fullscreen-triangle vertex shader for the LUT passes.
const FULLSCREEN_VS = /* glsl */`
varying vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

// ---------------------------------------------------------------- LUT: transmittance
const TRANSMITTANCE_FS = /* glsl */`
${GLSL_PHYSICS}
varying vec2 vUv;
void main() {
	float xMu = atmFromSub(vUv.x, ATM_TRANS_SIZE.x);
	float xR = atmFromSub(vUv.y, ATM_TRANS_SIZE.y);
	float H = sqrt(ATM_RT * ATM_RT - ATM_RB * ATM_RB);
	float rho = H * xR;
	float r = sqrt(rho * rho + ATM_RB * ATM_RB);
	float h = rho * rho / (r + ATM_RB);                 // r - RB without cancellation
	float dMin = ATM_RT - r, dMax = rho + H;
	float d = dMin + xMu * (dMax - dMin);
	float mu = d <= 0.0 ? 1.0 : clamp((H * H - rho * rho - d * d) / (2.0 * r * d), -1.0, 1.0);
	vec3 od = vec3(0.0);
	const int N = 64;
	for (int i = 0; i < N; i++) {
		float a = float(i) / float(N), b = float(i + 1) / float(N);
		float t = d * 0.5 * (a * a + b * b), dt = d * (b * b - a * a);
		float hh = sqrt(r * r + t * t + 2.0 * r * mu * t) - ATM_RB;
		od += atmExtinction(max(hh, 0.0)) * dt;
	}
	gl_FragColor = vec4(od, 1.0);          // optical depth (see atmTransmittance)
}
`;

// ---------------------------------------------------------------- LUT: multiple scattering (Hillaire 2020)
const MULTISCATTER_FS = /* glsl */`
${GLSL_PHYSICS}
uniform sampler2D uTrans;
uniform float uGroundAlbedo;
varying vec2 vUv;
void main() {
	float muS = atmFromSub(vUv.x, ATM_MS_SIZE.x) * 2.0 - 1.0;
	float h = max(atmFromSub(vUv.y, ATM_MS_SIZE.y) * (ATM_RT - ATM_RB), 0.01);
	vec3 O = vec3(0.0, ATM_RB + h, 0.0);
	vec3 L = vec3(sqrt(max(1.0 - muS * muS, 0.0)), muS, 0.0);
	const float isoPhase = 1.0 / (4.0 * ATM_PI);
	vec3 lumSum = vec3(0.0), fmsSum = vec3(0.0);
	const int SQ = 8;
	const int STEPS = 20;
	for (int i = 0; i < SQ; i++) for (int j = 0; j < SQ; j++) {
		float theta = 2.0 * ATM_PI * (float(i) + 0.5) / float(SQ);
		float phi = acos(1.0 - 2.0 * (float(j) + 0.5) / float(SQ));
		vec3 dir = vec3(cos(theta) * sin(phi), cos(phi), sin(theta) * sin(phi));
		float tG = atmRaySphere(O, dir, ATM_RB);
		float tT = atmRaySphere(O, dir, ATM_RT);
		bool ground = tG > 0.0;
		float tMax = ground ? tG : tT;
		float dt = tMax / float(STEPS);
		vec3 lum = vec3(0.0), fms = vec3(0.0), thr = vec3(1.0);
		for (int k = 0; k < STEPS; k++) {
			float t = (float(k) + 0.3) * dt;
			vec3 P = O + dir * t;
			float pr = length(P);
			float ph = pr - ATM_RB;
			vec3 up = P / pr;
			float mu = dot(up, L);
			vec3 scat = ATM_RAY * exp(-ph / ATM_RAY_H) + ATM_MIE_S * atmMieDensity(ph);
			vec3 ext = max(atmExtinction(ph), vec3(1e-7));
			vec3 sT = exp(-ext * dt);
			vec3 sun = atmTransmittance(uTrans, ph, mu) * atmLightVisibility(ph, mu, 0.0047);
			vec3 S = sun * scat * isoPhase;
			lum += thr * (S - S * sT) / ext;
			fms += thr * (scat - scat * sT) / ext;
			thr *= sT;
		}
		if (ground) {
			vec3 P = O + dir * tG;
			vec3 up = normalize(P);
			float mu = dot(up, L);
			lum += thr * atmTransmittance(uTrans, 0.0, mu) * max(mu, 0.0) * uGroundAlbedo / ATM_PI;
		}
		lumSum += lum; fmsSum += fms;
	}
	float n = float(SQ * SQ);
	vec3 L2 = lumSum / n;
	vec3 fMS = fmsSum / n;
	// Stored as log2: the transfer falls ~6 decades between sun -5 and -13 deg and would underflow
	// half-float (at -9.3 deg only 2 subnormal ulps of red survived). Decoded with exp2 in SKYVIEW_FS.
	gl_FragColor = vec4(log2(max(L2 / max(1.0 - fMS, vec3(1e-3)), vec3(1e-30))), 1.0);
}
`;

// ---------------------------------------------------------------- LUT: sky view (absolute azimuth)
const SKYVIEW_FS = /* glsl */`
${GLSL_PHYSICS}
uniform sampler2D uTrans;
uniform sampler2D uMS;
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform vec3 uSunE;            // TOA illuminance x LUT scale
uniform vec3 uMoonE;
uniform vec4 uCam;             // x altitude (km), y unused, z zenith->horizon angle, w horizon->nadir angle
uniform vec4 uCities[${CITIES.length}];   // x, z offset from the camera (km), intensity (x LUT scale, km^2 units), radius (km)
uniform vec3 uCityTint;
uniform vec3 uAirglow;         // zenith airglow radiance x LUT scale
uniform float uAirglowRatio;   // RB / (RB + airglow height)
uniform vec3 uBackground;      // integrated starlight + zodiacal light x LUT scale (above the atmosphere)
uniform vec3 uNightDiffuse;    // mean radiance of the night sky over the sphere x LUT scale (in-scatter source)
uniform sampler2D uAmb;        // latest ambient reduction (absolute); texel (4,1) = cloud light
uniform float uScale;          // LUT scale (pre-exposure)
uniform float uCloudTopKm;
uniform float uCloudLightGain; // 0 while the ambient table may be from another time (forced builds, jumps)
uniform vec4 uDiffuseShape;    // relative diffuse radiance (sphere mean 1): x horizon, y zenith, z sea; w forward fraction
uniform float uDiffuseSunF;    // forward fraction applied to the sun's MS term (fades out in twilight)
uniform vec2 uMSShadow;        // x: MS weight for air inside the Earth's shadow, y: softness (rad)
uniform vec2 uDiffuseWidth;    // e-folding elevation (rad) of the horizon band above / below the horizon
varying vec2 vUv;

// Relative radiance of the diffuse field seen along a direction of local elevation sine s (full-sphere
// mean 1): bright near the horizon (long hazy paths), dimmer toward the zenith, dark below (the sea).
float atmDiffuseRel(float s) {
	float e = asin(clamp(s, -1.0, 1.0));
	return e >= 0.0 ? mix(uDiffuseShape.y, uDiffuseShape.x, exp(-e / uDiffuseWidth.x))
	                : mix(uDiffuseShape.z, uDiffuseShape.x, exp(e / uDiffuseWidth.y));
}

vec3 cityInscatter(vec3 P, float ph, vec3 dir) {
	vec3 acc = vec3(0.0);
	float hP = max(ph, 0.002);
	vec3 tauUnit = ATM_RAY * (1.0 - exp(-hP / ATM_RAY_H)) * ATM_RAY_H / hP + ATM_MIE_E * atmMieMeanTo(hP);
	vec3 scatR = ATM_RAY * exp(-ph / ATM_RAY_H), scatM = ATM_MIE_S * atmMieDensity(ph);
	for (int k = 0; k < ${CITIES.length}; k++) {
		vec4 c = uCities[k];
		if (c.z <= 0.0) continue;
		vec3 C = vec3(c.x, sqrt(max(ATM_RB * ATM_RB - c.x * c.x - c.y * c.y, 0.0)), c.y);
		vec3 v = P - C;
		float d2 = dot(v, v);
		float d = sqrt(d2);
		float sinG = dot(v, C) / (d * ATM_RB);
		if (sinG < -0.02) continue;
		float emis = ${CITY_EMISSION_GLSL('sinG')};
		vec3 E = c.z * emis / (d2 + c.w * c.w) * exp(-tauUnit * d);
		float cosT = dot(-v / d, dir);
		acc += E * (scatR * atmRayPhase(cosT) + scatM * atmMiePhase(cosT) + (scatR + scatM) * 0.02);
	}
	return acc * uCityTint;
}

void main() {
	float r = ATM_RB + uCam.x;
	float az = vUv.x * 2.0 * ATM_PI;
	float v = atmFromSub(vUv.y, ATM_SKY_SIZE.y);
	float theta;
	if (v < 0.5) { float c = 1.0 - 2.0 * v; c = 1.0 - c * c; theta = uCam.z * c; }
	else { float c = 2.0 * v - 1.0; theta = uCam.z + uCam.w * c * c; }
	vec3 dir = vec3(sin(theta) * sin(az), cos(theta), -sin(theta) * cos(az));
	vec3 O = vec3(0.0, r, 0.0);
	float tG = atmRaySphere(O, dir, ATM_RB);
	bool ground = tG > 0.0 && theta > uCam.z;
	float tMax = ground ? tG : atmRaySphere(O, dir, ATM_RT);
	float cS = dot(dir, uSunDir), cM = dot(dir, uMoonDir);
	float pRS = atmRayPhase(cS), pMS = atmMiePhase(cS);
	float pRM = atmRayPhase(cM), pMM = atmMiePhase(cM);
	bool moonOn = dot(uMoonE, vec3(1.0)) > 0.0;
	bool cityOn = uCities[0].z > 0.0;
	vec3 cloudLight = texelFetch(uAmb, ivec2(4, 1), 0).rgb * uScale * uCloudLightGain;
	vec3 L = vec3(0.0), thr = vec3(1.0), Lr = vec3(0.0);
	const int N = 40;
	for (int i = 0; i < N; i++) {
		float a = float(i) / float(N), b = float(i + 1) / float(N);
		float t0 = tMax * a * a, t1 = tMax * b * b;
		float t = mix(t0, t1, 0.3), dt = t1 - t0;
		vec3 P = O + dir * t;
		float pr = length(P);
		float ph = max(pr - ATM_RB, 0.0);
		vec3 up = P / pr;
		vec3 scatR = ATM_RAY * exp(-ph / ATM_RAY_H), scatM = ATM_MIE_S * atmMieDensity(ph);
		vec3 ext = max(atmExtinction(ph), vec3(1e-7));
		vec3 sT = exp(-ext * dt);
		// Multiple-scattering source: Rayleigh (nearly isotropic) + aerosol. Hillaire's LUT is an
		// isotropic estimate (the sphere-mean diffuse radiance); the aerosol's forward-peaked phase
		// (g 0.8) instead scatters toward the camera mostly the diffuse light already travelling along
		// the ray, i.e. the field seen along dir: the bright hazy horizon band for near-horizontal rays
		// (the photo's 0-3 deg band, ~2x the 12 deg sky), the dark sea for rays looking down (less
		// veil over the near water), the dimmer upper sky for rays looking up. Energy-neutral over the
		// sphere (atmDiffuseRel has mean 1).
		// In twilight the sun's diffuse field is ruled by the sunward arc, not by a uniform horizon
		// band, so its forward term fades out below sun +2 deg (off at -4: the antisolar horizon
		// stays the dark Earth's shadow); the moonlit and airglow fields are day-like again.
		float rel = atmDiffuseRel(dot(dir, up));
		vec3 scatMS = scatR + scatM * mix(1.0, rel, uDiffuseShape.w);
		vec3 scatMSs = scatR + scatM * mix(1.0, rel, uDiffuseSunF);
		float muS = dot(up, uSunDir);
		vec3 tS = atmTransmittance(uTrans, ph, muS) * atmLightVisibility(ph, muS, 0.0047);
		vec3 msS = exp2(texture(uMS, atmMSUV(ph, muS)).rgb);
		msS *= mix(uMSShadow.x, 1.0, atmLightVisibility(ph, muS, uMSShadow.y));
		vec3 Sr = uSunE * tS * scatR * pRS;               // Rayleigh single scattering: the polarized part
		vec3 Ss = Sr + uSunE * tS * scatM * pMS;
		vec3 Sd = uSunE * msS * scatMSs;
		if (moonOn) {
			float muM = dot(up, uMoonDir);
			vec3 tM = atmTransmittance(uTrans, ph, muM) * atmLightVisibility(ph, muM, 0.0045);
			vec3 msM = exp2(texture(uMS, atmMSUV(ph, muM)).rgb);
			Ss += uMoonE * tM * (scatR * pRM + scatM * pMM);
			Sd += uMoonE * msM * scatMS;
		}
		if (cityOn) Ss += cityInscatter(P, ph, dir);
		// light from the cumulus layer (cloud-enhanced diffuse field), fading above the cloud tops,
		// and, for rays that end on the sea, the night sky's own diffuse field (airglow + starlight)
		// scattered by the air and haze (sky rays carry it in the compensated term after the loop)
		Sd += (cloudLight * exp(-max(ph - uCloudTopKm, 0.0) * 0.5) + (ground ? uNightDiffuse : vec3(0.0))) * scatMS;
		vec3 S = Ss + Sd;
		L += thr * (S - S * sT) / ext;
		Lr += thr * (Sr - Sr * sT) / ext;
		thr *= sT;
	}
	if (!ground) {
		// Airglow shell (van Rhijn factor X) and the starlight/zodiacal background. These are diffuse
		// sources filling the whole sky, so what extinction removes from a ray is largely put back by
		// light scattered in from the neighbouring, equally bright directions (Leinert et al. 1998).
		// Marching the real airmass (~40 at the horizon) as for a point source, with only the
		// sphere-mean field scattered back in, left the moonless horizon darker than the zenith, which
		// no dark-site sky shows. Empirical form instead (Krisciunas & Schaefer 1991): the effective
		// airmass of the diffuse sky is the shell's own X (max ~6 at the horizon for a 90 km layer)
		// with k from this LUT's zenith optical depth. Written in saturating form, so that what is
		// removed is replaced by the neutral sphere-mean night field (the K&S reddening is for a
		// V-band luminance; a saturated horizon takes the colour of the field it scatters, not of the
		// extinction). The aerosol's forward-scattered share (delta-Eddington, g^2) is not lost at all:
		// near the horizon it carries the equally bright neighbouring sky into the ray. The natural sky
		// then brightens to ~2x its zenith at 5-10 deg and stays ~1.9x at the horizon (K&S, k ~0.2).
		float s = uAirglowRatio * sin(theta);
		float X = inversesqrt(max(1.0 - s * s, 0.03));
		vec3 Te = exp(-(texture(uTrans, atmTransUV(max(uCam.x, 0.0), 1.0)).rgb                // LUT holds optical depth
		          - uDiffuseShape.w * ATM_MIE_E * ATM_MIE_H * exp(-uCam.x / ATM_MIE_H)) * X);
		L += (uAirglow * X + uBackground) * Te + uNightDiffuse * (1.0 - Te);
	}
	// alpha: path opacity for rays that end on the sea (atmHazeColour); for sky rays the degree of
	// linear polarization: Rayleigh single scattering of sunlight is polarized by
	// sin^2 g / (1 + cos^2 g + 2 rho / (1 - rho)) (depolarization factor rho 0.0279, max 0.946 at 90 deg
	// from the sun); the aerosol, multiple scattering, airglow and city light count as unpolarized.
	float dop = (1.0 - cS * cS) / (1.0574 + cS * cS);
	gl_FragColor = vec4(L, ground ? 1.0 - thr.g : dop * atmLum(Lr) / max(atmLum(L), 1e-30));
}
`;

// ---------------------------------------------------------------- ATMOS GLSL (consumers)
// Core: uniforms, sky-view lookup, aerial perspective, cloud shadow. Built-in materials get this
// part through applyAtmosphere(); custom shaders include ATMOS_GLSL (core + sky).
const GLSL_CORE = /* glsl */`
#ifndef ATMOS_CORE_GLSL
#define ATMOS_CORE_GLSL
${GLSL_PHYSICS}
uniform vec3 uAtmSunDir;
uniform vec3 uAtmMoonDir;
uniform sampler2D uAtmSkyLUT;
uniform sampler2D uAtmTransLUT;
uniform vec4 uAtmLUT;          // x camera altitude (km), y 1 / LUT scale, z zenith->horizon angle, w horizon->nadir angle
uniform vec3 uAtmFogRGB;       // sea-level extinction (1/m), per channel
uniform float uAtmFogFalloff;  // 1 / haze scale height (1/m)
uniform float uAtmPre;         // pre-exposure applied to every colour written to a render target
uniform vec3 uAtmKey;          // key light for clouds and cloud shadows (sun by day, moon at night)
uniform vec4 uAtmCloud;        // x coverage threshold, y 1 / tile (1/m), z extinction (1/m), w cover
uniform vec2 uAtmCloudOffset;  // drift (m)
uniform float uAtmCloudAlt;    // base altitude (m)
uniform float uAtmCloudThick;  // thickness (m)

const float ATM_EARTH_R = ${f(EARTH_R)};
// Height above the curved mean sea surface (shared.js curvature).
float atmAltitude(vec3 p) { return p.y + dot(p.xz, p.xz) * (0.5 / ATM_EARTH_R); }
vec3 atmUp(vec3 p) { return normalize(vec3(p.x / ATM_EARTH_R, 1.0, p.z / ATM_EARTH_R)); }

vec2 atmSkyUV(vec3 dir) {
	float az = atan(dir.x, -dir.z);
	float theta = acos(clamp(dir.y, -1.0, 1.0));
	float v;
	if (theta < uAtmLUT.z) v = 0.5 * (1.0 - sqrt(max(1.0 - theta / uAtmLUT.z, 0.0)));
	else v = 0.5 + 0.5 * sqrt(clamp((theta - uAtmLUT.z) / uAtmLUT.w, 0.0, 1.0));
	return vec2(az * (0.5 / ATM_PI), atmToSub(v, ATM_SKY_SIZE.y));
}
// Sky-view LUT: in-scattered radiance along dir from the camera (absolute), alpha = path opacity.
vec4 atmSkyLUTSample(vec3 dir) {
	vec4 s = texture(uAtmSkyLUT, atmSkyUV(dir));
	return vec4(s.rgb * uAtmLUT.y, s.a);
}
// Same direction turned up or down in elevation to a given zenith angle (keeps the azimuth).
vec3 atmWithZenith(vec3 dir, float z) {
	vec2 hz = dir.xz;
	float l = length(hz);
	hz = l > 1e-6 ? hz / l : vec2(0.0, -1.0);
	return vec3(hz.x * sin(z), cos(z), hz.y * sin(z));
}
// In-scatter per unit opacity of the haze toward dir (the colour distant geometry fades into):
// the sky-view LUT below the horizon holds the in-scatter up to the sea and its opacity, so
// S / (1 - T) is the path's source radiance. Rays at or above the horizon use the row just below.
vec3 atmHazeColour(vec3 dir) {
	float z = max(acos(clamp(dir.y, -1.0, 1.0)), uAtmLUT.z + 0.0009);
	vec4 s = atmSkyLUTSample(atmWithZenith(dir, z));
	vec3 T = pow(vec3(max(1.0 - s.a, 1e-6)), uAtmFogRGB / uAtmFogRGB.g);
	return s.rgb / max(1.0 - T, vec3(1e-4));
}
// Integral of the relative haze density exp(-h / H) along the straight segment a -> b (metres).
float atmHazePath(vec3 a, vec3 b) {
	float d = length(b - a);
	float ha = max(atmAltitude(a), 0.0) * uAtmFogFalloff;
	float hb = max(atmAltitude(b), 0.0) * uAtmFogFalloff;
	float dh = hb - ha;
	float ea = exp(-ha);
	float m = abs(dh) < 1e-4 ? ea * (1.0 - 0.5 * dh) : (ea - exp(-hb)) / dh;
	return d * m;
}
// Aerial perspective between two points, absolute units.
vec3 atmAerial(vec3 color, vec3 a, vec3 b) {
	vec3 v = b - a;
	float d = length(v);
	if (d < 1e-3) return color;
	vec3 T = exp(-uAtmFogRGB * atmHazePath(a, b));
	return color * T + atmHazeColour(v / d) * (1.0 - T);
}
// NaN test on the bit pattern. ANGLE's Metal backend compiles every shader that calls isnan() or
// isinf() with fast math disabled; measured in index.html at 1600x900, that alone made the ocean
// surface ~15 ms slower on the M4, and this function is in every patched material. The integer
// test is exact under fast math.
bool atmHasNaN(vec3 v) { return any(greaterThan(floatBitsToUint(v) & 0x7fffffffu, uvec3(0x7f800000u))); }
// Pre-exposed output, clamped below the half-float maximum and never NaN (a NaN would spread
// through the composer's MSAA resolve and bloom).
vec3 atmExpose(vec3 L) {
	vec3 o = min(L * uAtmPre, vec3(${f(HALF_SAFE_MAX)}));
	return atmHasNaN(o) ? vec3(0.0) : max(o, vec3(0.0));
}

// Extinction + in-scatter between cameraPosition and worldPos; returns the pre-exposed colour.
vec3 applyAerialPerspective(vec3 color, vec3 worldPos) { return atmExpose(atmAerial(color, cameraPosition, worldPos)); }
// Extinction only (additive lights, glows); returns the pre-exposed colour.
vec3 applyAerialTransmittance(vec3 color, vec3 worldPos) {
	return atmExpose(color * exp(-uAtmFogRGB * atmHazePath(cameraPosition, worldPos)));
}

${CLOUD_CORE_GLSL}
#endif
`;

// Sky part: clouds, sun and moon disks, stars, Milky Way, composite skyRadiance().
const GLSL_SKY = /* glsl */`
#ifndef ATMOS_SKY_GLSL
#define ATMOS_SKY_GLSL
uniform vec3 uAtmKeyE;         // key-light illuminance above the atmosphere (absolute)
uniform vec4 uAtmSunDisk;      // rgb: disk-centre radiance above the atmosphere, a: angular radius (rad)
uniform vec4 uAtmMoonDisk;     // rgb: lunar surface radiance per unit albedo x Lommel-Seeliger, a: angular radius (rad)
uniform vec4 uAtmDiskShape;    // x sun vertical squash (refraction), y moon squash, z earthshine per unit albedo, w moon visible
uniform vec3 uAtmMoonN;        // unit vectors across the moon disk: toward celestial north, toward sky west
uniform vec3 uAtmMoonW;
uniform vec4 uAtmMaria[${MOON_FEATURES.length}];
uniform mat3 uAtmStarRot;      // celestial (equatorial) from world
uniform vec4 uAtmStars;        // x flux of a mag-0 star (absolute, 0 = stars off), y PSF sigma (rad), z Milky Way radiance, w time (s)
uniform sampler2D uAtmAmbTex;  // float 64x4: row 1 = cloud ambient terms (absolute)
uniform sampler2D uAtmMilkyWay;  // galactic (l, b) panorama of the Milky Way, relative surface brightness (sky-night.js)
uniform sampler2D uAtmStarCells; // catalogue stars per cube-face cell: up to 4 indices + 1 (sky-night.js)
uniform sampler2D uAtmStarData;  // row 0: celestial unit vector + V; row 1: B-V
${CLOUD_PANO_GLSL}

// Camera polarizing filter (U.uPolarizer, 0..1) on clear sky of degree of polarization P (sky-view
// LUT alpha). The filter is the one the ocean assumes: transmission axis vertical in the image, so it
// blocks the horizontally polarized sea glare. Skylight's E-vector is normal to the scattering plane
// (dir, sun); normalised to unpolarized light, the filter passes 1 + P cos(2 theta), theta the angle
// between the E-vector and the axis: the sky darkens where the E-vector lies across the axis (most
// of the sky 60-120 deg from the sun), and brightens a little where it lies along it. up: the image's
// vertical in the world (the camera's up; world up for a level camera), so the axis never pinches at
// the zenith.
uniform float uAtmPolarizer;  // = U.uPolarizer (the ocean declares its own uPolarizer)
float atmPolarizer(vec3 dir, float P, vec3 up) {
	vec3 e = cross(dir, uAtmSunDir), a = up - dir * dot(dir, up);
	float ea = dot(e, e) * dot(a, a), c = dot(e, a);
	return ea > 1e-8 ? 1.0 + uAtmPolarizer * P * (2.0 * c * c / ea - 1.0) : 1.0;
}
// Transmittance camera -> space along dir.
vec3 atmTransView(vec3 dir) { return atmTransmittance(uAtmTransLUT, uAtmLUT.x, dir.y); }
// Transmittance camera -> a point t metres along an upward ray (Bruneton's ratio form).
vec3 atmTransAlong(vec3 dir, float t) {
	float h0 = uAtmLUT.x, r0 = ATM_RB + h0, mu0 = dir.y;
	float d = t * 0.001;
	float r1 = sqrt(d * d + 2.0 * r0 * mu0 * d + r0 * r0);
	float mu1 = clamp((r0 * mu0 + d) / r1, -1.0, 1.0);
	float h1 = max(r1 - ATM_RB, 0.0);
	return min(atmTransmittance(uAtmTransLUT, h0, mu0) / max(atmTransmittance(uAtmTransLUT, h1, mu1), vec3(1e-6)), vec3(1.0));
}
// Directions below the visible horizon are lifted to just above it ("horizon-ish" radiance).
vec3 atmAboveHorizon(vec3 dir) {
	float z = acos(clamp(dir.y, -1.0, 1.0));
	float zMax = uAtmLUT.z - 0.0004;
	return z > zMax ? atmWithZenith(dir, zMax) : dir;
}
${HASH_GLSL}

// ---- sun and moon disks
// Offset of dir from a disk centre m in the sky plane, its vertical part stretched by 1 / squash
// (refraction flattens a low disk). Callers test that dir is near m first.
vec3 atmDiskOffset(vec3 dir, vec3 m, float squash) {
	vec3 off = dir - m * dot(dir, m), up = vec3(0.0, 1.0, 0.0) - m * m.y;
	float lu2 = dot(up, up);
	return lu2 > 1e-8 ? off + up * (dot(off, up) / lu2) * (1.0 / squash - 1.0) : off;
}
// Anti-aliased edge of a disk of angular radius R at x disk radii.
float atmDiskEdge(float x, float R) { float aa = uAtmStars.y / R; return 1.0 - smoothstep(1.0 - aa, 1.0 + aa, x); }
// Sun disk: limb darkening I = 1 - u (1 - mu), u per channel.
vec3 atmSunDiskShape(vec3 dir) {
	if (dot(dir, uAtmSunDir) < 0.9999) return vec3(0.0);
	float x = length(atmDiskOffset(dir, uAtmSunDir, uAtmDiskShape.x)) / uAtmSunDisk.a;
	if (x > 1.2) return vec3(0.0);
	return uAtmSunDisk.rgb * (1.0 - vec3(0.52, 0.60, 0.72) * (1.0 - sqrt(max(1.0 - x * x, 0.0)))) * atmDiskEdge(x, uAtmSunDisk.a);
}
// Sun disk only, seen through the atmosphere (for reflections and glints). No clouds.
vec3 sunDiskRadiance(vec3 dir) { return atmSunDiskShape(dir) * atmTransView(dir); }
// Moon: Lommel-Seeliger with maria and ray craters, earthshine; shaded in its (west, north) frame.
float atmMoonAlbedo(float lon, float lat) {
	vec3 p = vec3(cos(lat) * sin(lon), sin(lat), cos(lat) * cos(lon));
	float a = ${f(MOON_HIGHLAND_ALBEDO)};
	for (int i = 0; i < ${MOON_FEATURES.length}; i++) {
		vec4 m = uAtmMaria[i];
		float ang = acos(clamp(dot(p, vec3(cos(m.y) * sin(m.x), sin(m.y), cos(m.y) * cos(m.x))), -1.0, 1.0)) / m.z;
		a += m.w * exp(-ang * ang * 1.6);
	}
	return max(a, 0.05);
}
vec3 atmMoonDiskRadiance(vec3 dir) {
	vec3 m = uAtmMoonDir;
	if (uAtmDiskShape.w <= 0.0 || dot(dir, m) < 0.9998) return vec3(0.0);
	vec3 off = atmDiskOffset(dir, m, uAtmDiskShape.y);
	vec2 q = vec2(dot(off, uAtmMoonW), dot(off, uAtmMoonN)) / uAtmMoonDisk.a;
	float rr = dot(q, q);
	if (rr > 1.44) return vec3(0.0);
	float edge = atmDiskEdge(sqrt(rr), uAtmMoonDisk.a);
	q *= min(1.0, inversesqrt(max(rr, 1e-6)));        // clamp the shading point onto the disk for the AA rim
	float mu = sqrt(max(1.0 - dot(q, q), 0.0));
	float mu0 = dot(q.x * uAtmMoonW + q.y * uAtmMoonN - mu * m, uAtmSunDir);
	float ls = mu0 > 0.0 ? mu0 / (mu0 + mu + 1e-3) * smoothstep(-0.01, 0.05, mu0) : 0.0;   // topography softens the terminator
	return (uAtmMoonDisk.rgb * ls + uAtmDiskShape.z * vec3(0.9, 0.97, 1.08)) * atmMoonAlbedo(atan(q.x, mu), asin(clamp(q.y, -1.0, 1.0))) * edge;
}

// ---- stars and the Milky Way (celestial coordinates c = uAtmStarRot * world direction)
const mat3 ATM_EQ2GAL = mat3(-0.0548755604, 0.4941094279, -0.8676661490,
                             -0.8734370902, -0.4448296300, -0.1980763734,
                             -0.4838350155, 0.7469822445, 0.4559837762);
const float ATM_STAR_CELLS = ${f(STAR_CELLS)};
const float ATM_STAR_NTOT = ${f(Math.pow(10, STAR_COUNT_A + STAR_COUNT_B * STAR_MAG_LIMIT))};
const float ATM_STAR_P = ${f(Math.pow(10, STAR_COUNT_A + STAR_COUNT_B * STAR_MAG_LIMIT) / (6 * STAR_CELLS * STAR_CELLS))};
// Position on the equi-angular cube of the celestial sphere: [0, 1]^2 on the face it returns.
vec2 atmCubeFace(vec3 c, out int face) {
	vec3 a = abs(c);
	vec2 uv;
	if (a.x >= a.y && a.x >= a.z) { face = c.x > 0.0 ? 0 : 1; uv = c.yz / a.x; }
	else if (a.y >= a.z) { face = c.y > 0.0 ? 2 : 3; uv = c.xz / a.y; }
	else { face = c.z > 0.0 ? 4 : 5; uv = c.xy / a.z; }
	return atan(uv) * (2.0 / ATM_PI) + 0.5;
}
// One star's image: magnitude mag, colour index bv (linear RGB normalised to unit luminance, halfway
// to white: subtle colours), Gaussian PSF at squared angular distance d2, scintillation (random
// phases r) stronger near the horizon (longer, more turbulent path).
vec3 atmStar(float mag, float bv, float d2, vec3 r, float el) {
	vec3 col = bv < 0.6 ? mix(vec3(0.62, 0.74, 1.00), vec3(1.0, 0.97, 0.93), smoothstep(-0.3, 0.6, bv))
	                    : mix(vec3(1.0, 0.97, 0.93), vec3(1.0, 0.72, 0.45), smoothstep(0.6, 1.8, bv));
	float s = uAtmStars.y, t = uAtmStars.w;
	float tw = 1.0 + (0.06 + 0.55 * (1.0 - smoothstep(0.0, 0.5, el))) * sin(t * (9.0 + 7.0 * r.y) + 40.0 * r.x) * sin(t * (5.0 + 5.0 * r.z) + 60.0 * r.y);
	return mix(vec3(1.0), col / atmLum(col), 0.6) * uAtmStars.x * pow(10.0, -0.4 * mag) * max(tw, 0.0) / (2.0 * ATM_PI * s * s) * exp(-d2 / (2.0 * s * s));
}
// Procedural stars fainter than the catalogue: one candidate per cube cell, log N(<m) = A + B m,
// denser toward the galactic plane.
vec3 atmStars(vec3 c, float el) {
	int face;
	vec2 g = atmCubeFace(c, face) * ATM_STAR_CELLS, cell = floor(g);
	uvec2 ci = uvec2(cell);
	vec3 r = atmRand3(uvec3(ci, uint(face) * 7919u + 17u)), gal = ATM_EQ2GAL * c;
	float p = ATM_STAR_P * (0.65 + 1.6 * exp(-gal.z * gal.z * 16.0));
	if (r.x >= p) return vec3(0.0);
	vec3 r2 = atmRand3(uvec3(ci + 1013u, uint(face) + 31u));
	vec2 dd = (g - cell - 0.2 - 0.6 * r2.xy) * (0.5 * ATM_PI / ATM_STAR_CELLS);
	float mag = (log(max(r.x / p, 1e-7) * ATM_STAR_NTOT) * 0.4342945 - ${f(STAR_COUNT_A)}) / ${f(STAR_COUNT_B)};
	if (mag < ${f(STAR_CATALOG_LIMIT_V)} || dot(dd, dd) > 25.0 * uAtmStars.y * uAtmStars.y) return vec3(0.0);   // the catalogue has the bright ones
	// B-V: two populations (hot main sequence ~0.0, giants ~1.1)
	return atmStar(mag, r2.z < 0.55 ? mix(-0.25, 0.7, r.y) : mix(0.6, 1.7, r.z), dot(dd, dd), vec3(r2.xy, r.z), el);
}
// Catalogue stars (sky-night.js): the cell under c lists every bright star whose image reaches it.
vec3 atmCatalogStars(vec3 c, float el) {
	int face;
	ivec2 cell = ivec2(min(atmCubeFace(c, face) * ${f(STAR_CATALOG_CELLS)}, ${f(STAR_CATALOG_CELLS - 1)}));
	vec4 idx = texelFetch(uAtmStarCells, ivec2(face * ${STAR_CATALOG_CELLS} + cell.x, cell.y), 0);
	vec3 L = vec3(0.0);
	for (int k = 0; k < 4; k++) {
		int id = int(idx[k]) - 1;
		if (id < 0) break;
		vec4 st = texelFetch(uAtmStarData, ivec2(id, 0), 0);
		vec3 dd = c - st.xyz;
		L += atmStar(st.w, texelFetch(uAtmStarData, ivec2(id, 1), 0).x, dot(dd, dd), atmRand3(uvec3(id, 7, 131)), el);
	}
	return L;
}
vec3 atmMilkyWay(vec3 c) {
	vec3 g = ATM_EQ2GAL * c;
	// mip level from the pixel footprint (~1.4 PSF sigmas per pixel) against the panorama's texels
	float I = textureLod(uAtmMilkyWay, vec2(atan(g.y, g.x) * (0.5 / ATM_PI) + 0.5, asin(clamp(g.z, -1.0, 1.0)) / ATM_PI + 0.5),
	                     log2(max(uAtmStars.y * 1.43 * ${f(MW_W / (2 * Math.PI))}, 1.0))).r;
	return uAtmStars.z * I * vec3(1.0, 0.95, 0.86);
}

// ---- cloud layers (clouds.js marches them; consumers read the panorama)
// Parabolic-Earth altitude along a ray: alt(t) = A t^2 + B t + C.
bool atmShellHit(float A, float B, float C, out float t0, out float t1) {
	if (A < 1e-12) {
		if (abs(B) < 1e-9) return false;
		t0 = t1 = -C / B;
		return true;
	}
	float disc = B * B - 4.0 * A * C;
	if (disc < 0.0) return false;
	float q = -0.5 * (B + (B >= 0.0 ? 1.0 : -1.0) * sqrt(disc));
	float ra = q / A, rb = abs(q) > 1e-12 ? C / q : ra;
	t0 = min(ra, rb); t1 = max(ra, rb);
	return true;
}
// Interval of the ray inside [hBase, hTop] (first crossing), clipped to [0, tLimit].
vec2 atmLayerInterval(vec3 ro, vec3 rd, float hBase, float hTop, float tLimit) {
	float A = dot(rd.xz, rd.xz) * (0.5 / ATM_EARTH_R);
	float B = rd.y + dot(ro.xz, rd.xz) / ATM_EARTH_R;
	float C = atmAltitude(ro);
	float b0, b1, u0, u1;
	bool hb = atmShellHit(A, B, C - hBase, b0, b1);
	bool ht = atmShellHit(A, B, C - hTop, u0, u1);
	vec2 iv = vec2(1.0, 0.0);
	if (C < hBase) {
		if (!hb || b1 <= 0.0) return iv;
		iv.x = b0 > 0.0 ? b0 : b1;
		iv.y = ht ? (u0 > iv.x ? u0 : u1) : iv.x;
	} else if (C > hTop) {
		if (!ht || u1 <= 0.0) return iv;
		iv.x = max(u0, 0.0);
		iv.y = (hb && b0 > iv.x) ? b0 : u1;
	} else {
		iv.x = 0.0;
		float up = ht ? (u0 > 0.0 ? u0 : u1) : 1e9;
		float dn = (hb && b0 > 0.0) ? b0 : 1e9;
		iv.y = min(up, dn);
	}
	iv.y = min(iv.y, tLimit);
	return iv;
}
// Sky along dir without the celestial background: in-scatter (sky-view LUT) with the cirrus and
// cumulus layers composited into it (from the camera-centred cloud panorama, clouds.js), each behind
// its share of the air. rgb = radiance (absolute), a = transmittance of the cloud layers.
vec4 atmSkyLayers(vec3 dir) {
	vec4 c = atmCloudPanoSample(dir);
	return vec4(atmSkyLUTSample(dir).rgb + c.rgb, c.a);
}
// Celestial background along dir (stars, Milky Way, moon, optionally the sun disk), seen through
// the atmosphere; the caller multiplies by the cloud transmittance.
vec3 atmBackground(vec3 dir, bool withSun, bool withNight) {
	vec3 bg = vec3(0.0);
#ifndef ATM_ENV
	if (withNight) {
		if (uAtmStars.x > 0.0) { vec3 c = uAtmStarRot * dir; bg += atmStars(c, max(dir.y, 0.0)) + atmCatalogStars(c, max(dir.y, 0.0)) + atmMilkyWay(c); }
		bg += atmMoonDiskRadiance(dir);
	}
	if (withSun) bg += atmSunDiskShape(dir);
#endif
	return bg * atmTransView(dir);
}
vec3 atmSkyComposite(vec3 dirIn, bool withSun, bool withNight) {
	vec3 dir = atmAboveHorizon(dirIn);
	vec4 sky = atmSkyLayers(dir);
	return sky.rgb + atmBackground(dir, withSun, withNight) * sky.a;
}
// Public: sky + clouds + stars + moon, no sun disk (absolute radiance). Below the horizon it
// returns the radiance just above the horizon in the same azimuth.
vec3 skyRadiance(vec3 dir) { return atmSkyComposite(dir, false, true); }
#endif
`;


// ---------------------------------------------------------------- ambient + horizon reduction
// Rendered after every sky-view LUT build into a 64x4 float target (ping-pong: the cloud march
// reads the previous one). All values absolute.
// Row 0: horizon radiance per 5.625 deg azimuth bin, 0.1..1.5 deg above the visible horizon.
// Row 2 / row 3: clear-sky radiance at 10 deg / 12.6 deg elevation per azimuth bin as the camera
//        records it (through its polarizer): the photo's other two sky anchors (photo-look §6.1),
//        on which Post exposes (exposureTargetPhotoFit).
// Row 1: [0] upper-hemisphere mean radiance (clear), [1] cosine-weighted mean (E_sky / pi),
//        [2] lower hemisphere seen from the cloud base (sea + lit haze), [3] zenith,
//        [4] cloud light: extra full-sphere mean radiance the cumulus layer adds to the diffuse
//            field (fed back into the next sky-view LUT build as a multiple-scattering source).
const AMBIENT_FS = /* glsl */`
${GLSL_CORE}
${GLSL_SKY}
uniform vec3 uSunSea;          // direct sun illuminance at sea level (absolute)
uniform vec3 uSeaAlbedo;       // diffuse reflectance of the sea surface incl. water-leaving light
varying vec2 vUv;
vec3 dirAzEl(float az, float el) { return vec3(sin(az) * cos(el), sin(el), -cos(az) * cos(el)); }
void main() {
	ivec2 px = ivec2(gl_FragCoord.xy);
	float horizonEl = 0.5 * ATM_PI - uAtmLUT.z;          // visible sea horizon (negative: the dip)
	if (px.y == 0) {
		vec3 acc = vec3(0.0);
		for (int i = 0; i < 4; i++) for (int j = 0; j < 5; j++) {
			float az = (float(px.x) + (float(i) + 0.5) / 4.0) / 64.0 * 2.0 * ATM_PI;
			float el = horizonEl + (0.1 + 1.4 * float(j) / 4.0) * ATM_PI / 180.0;
			acc += atmSkyLUTSample(dirAzEl(az, el)).rgb;
		}
		gl_FragColor = vec4(acc / 20.0, 1.0);
		return;
	}
	if (px.y >= 2) {
		float el = (px.y == 2 ? 10.0 : 12.6) * ATM_PI / 180.0;
		vec3 acc = vec3(0.0);
		for (int i = 0; i < 4; i++) { vec3 d = dirAzEl((float(px.x) + (float(i) + 0.5) / 4.0) / 64.0 * 2.0 * ATM_PI, el); vec4 s = atmSkyLUTSample(d); acc += s.rgb * atmPolarizer(d, s.a, vec3(0.0, 1.0, 0.0)); }
		gl_FragColor = vec4(acc / 4.0, 1.0);
		return;
	}
	if (px.y == 1 && px.x < 5) {
		vec3 upMean = vec3(0.0), cosMean = vec3(0.0), horMean = vec3(0.0), cloudGain = vec3(0.0);
		float cosW = 0.0;
		for (int i = 0; i < 24; i++) for (int j = 0; j < 12; j++) {
			float az = (float(i) + 0.5) / 24.0 * 2.0 * ATM_PI;
			float mu = (float(j) + 0.5) / 12.0;             // uniform in solid angle over the upper hemisphere
			vec3 d = dirAzEl(az, asin(mu));
			vec3 L = atmSkyLUTSample(d).rgb;
			upMean += L; cosMean += L * mu; cosW += mu;
			if (px.x == 4) cloudGain += atmSkyComposite(d, false, false) - L;
		}
		for (int i = 0; i < 24; i++) horMean += atmSkyLUTSample(dirAzEl((float(i) + 0.5) / 24.0 * 2.0 * ATM_PI, horizonEl + 0.03)).rgb;
		upMean /= 288.0; cosMean /= cosW; horMean /= 24.0;
		vec3 Esky = ATM_PI * cosMean;
		vec3 Esun = uSunSea * max(uAtmSunDir.y, 0.0);
		vec3 seaL = uSeaAlbedo * (Esky + Esun) / ATM_PI;
		// Seen from the cloud base (~1.1 km) the lower hemisphere is the sea behind the lit haze below.
		float tauHaze = ATM_MIE_E.g * atmMieMeanTo(1.1) * 1.1 * 2.0;
		vec3 below = seaL * exp(-tauHaze) + horMean * (1.0 - exp(-tauHaze));
		// cloud light is bounded well below the clear sky's own mean, so the LUT <-> ambient feedback
		// loop has a gain below 1 and can never run away (24 -> 104 cd/m2 was observed before)
		vec3 cl = min(max(0.5 * cloudGain / 288.0, vec3(0.0)), 0.6 * upMean);
		vec3 outv = px.x == 0 ? upMean : (px.x == 1 ? cosMean : (px.x == 2 ? below : (px.x == 3 ? atmSkyLUTSample(vec3(0.0, 1.0, 0.0)).rgb : cl)));
		gl_FragColor = vec4(outv, 1.0);
		return;
	}
	gl_FragColor = vec4(0.0);
}
`;

/**
 * GLSL for consumers: declares the atmosphere uniforms (all prefixed uAtm*) and defines
 *   vec3  skyRadiance(vec3 dir)                         sky + clouds + stars + moon, no sun disk (absolute)
 *   vec3  sunDiskRadiance(vec3 dir)                     sun disk through the atmosphere (absolute)
 *   float cloudShadow(vec3 worldPos)                    key-light transmittance through the cloud layer
 *   vec3  applyAerialPerspective(vec3 c, vec3 worldPos) extinction + in-scatter, returns PRE-EXPOSED colour
 *   vec3  applyAerialTransmittance(vec3 c, vec3 worldPos) extinction only, returns PRE-EXPOSED colour
 * plus helpers (atmAltitude, atmUp, atmExpose, atmTransView, ...). Uses cameraPosition.
 */
export const ATMOS_GLSL = GLSL_CORE + GLSL_SKY;
// Upsample of the half-resolution cloud layers: 3x3 tent of texel fetches that keeps only texels
// of the requested kind (dome: alpha < 2, overlay: alpha >= 2) so the two never bleed across the
// horizon; missing taps fall back to the identity (no layer, full transmittance).
const GLSL_LAYER_UPSAMPLE = /* glsl */`
uniform sampler2D uAtmCloudScreen;
uniform mat4 uAtmLayerViewProj;   // widened projection x view rotation the layer pass was rendered with
uniform float uAtmLayerPre;       // pre-exposure the layer pass was rendered with
// Layer texture coordinates of a world direction (the pass holds functions of direction only, so
// it can be reused across frames while the camera turns); outside the pass frustum: < 0.
vec2 atmLayerUV(vec3 dir) {
	vec4 c = uAtmLayerViewProj * vec4(dir, 0.0);
	if (c.w <= 1e-6) return vec2(-1.0);
	vec2 uv = c.xy / c.w * 0.5 + 0.5;
	return (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) ? vec2(-1.0) : uv;
}
vec4 atmLayersAt(vec2 uv, bool overlay) {
	if (uv.x < 0.0) return vec4(0.0, 0.0, 0.0, 1.0);
	ivec2 size = textureSize(uAtmCloudScreen, 0);
	vec2 c = uv * vec2(size) - 0.5;
	ivec2 b = ivec2(floor(c + 0.5));
	vec4 acc = vec4(0.0);
	float wSum = 0.0;
	for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
		ivec2 q = clamp(b + ivec2(x, y), ivec2(0), size - 1);
		vec4 t = texelFetch(uAtmCloudScreen, q, 0);
		if ((t.a >= 1.5) != overlay) continue;
		vec2 d = abs(vec2(q) - c);
		float w = max(1.5 - d.x, 0.0) * max(1.5 - d.y, 0.0);
		acc += w * t; wSum += w;
	}
	if (wSum <= 0.0) return vec4(0.0, 0.0, 0.0, 1.0);
	acc /= wSum;
	if (overlay) acc.a -= 2.0;
	acc.rgb /= uAtmLayerPre;
	return acc;
}
// Away from the horizon every texel is of the dome's kind: a Catmull-Rom upsample of the half-
// resolution buffer in five bilinear taps (Jimenez 2016), which keeps the cloud edges crisp where a
// bilinear tap blurs them over two display pixels.
vec4 atmDomeLayersAt(vec2 uv, bool nearHorizon) {
	if (uv.x < 0.0) return vec4(0.0, 0.0, 0.0, 1.0);
	if (nearHorizon) return atmLayersAt(uv, false);
	vec4 t = texture(uAtmCloudScreen, uv);
	if (t.a > 0.999) return vec4(t.rgb / uAtmLayerPre, t.a);   // clear sky: one tap is exact enough
	vec2 size = vec2(textureSize(uAtmCloudScreen, 0)), p = uv * size - 0.5, fr = fract(p), c = floor(p) + 0.5;
	vec2 w0 = fr * (-0.5 + fr * (1.0 - 0.5 * fr)), w12 = 1.0 + fr * (0.5 - 0.5 * fr), w3 = fr * fr * (0.5 * fr - 0.5);
	vec2 t0 = (c - 1.0) / size, t3 = (c + 2.0) / size, t12 = (c + (fr * (0.5 + fr * (2.0 - 1.5 * fr))) / w12) / size;
	t = texture(uAtmCloudScreen, vec2(t12.x, t0.y)) * (w12.x * w0.y) + texture(uAtmCloudScreen, vec2(t0.x, t12.y)) * (w0.x * w12.y)
	       + texture(uAtmCloudScreen, t12) * (w12.x * w12.y) + texture(uAtmCloudScreen, vec2(t3.x, t12.y)) * (w3.x * w12.y)
	       + texture(uAtmCloudScreen, vec2(t12.x, t3.y)) * (w12.x * w3.y);
	t /= w12.x * w0.y + w0.x * w12.y + w12.x * w12.y + w3.x * w12.y + w12.x * w3.y;
	return vec4(t.rgb / uAtmLayerPre, clamp(t.a, 0.0, 1.0));      // rgb is a signed delta over the clear sky
}
`;
/** Core subset (uniforms, aerial perspective, cloud shadow) used by fog.js for built-in materials. */
export const ATMOS_GLSL_CORE = GLSL_CORE;
/** Bumped whenever the GLSL changes shape, so patched built-in programs never collide in the cache. */
export const ATMOS_VERSION = 'atmos-3';

// ================================================================== shared uniforms

/**
 * One object shared by every material that uses the atmosphere GLSL. U-owned values are the same
 * uniform objects as in shared.js (under both their U names and the uAtm* names the GLSL uses).
 */
export const ATMOS_UNIFORMS = {
  // U references under their U names (for consumers that declare them themselves)
  uSunDir: U.uSunDir, uSunIlluminance: U.uSunIlluminance, uMoonDir: U.uMoonDir,
  uMoonIlluminance: U.uMoonIlluminance, uMoonPhase: U.uMoonPhase, uNight: U.uNight,
  uSkyLUT: U.uSkyLUT, uTransmittanceLUT: U.uTransmittanceLUT, uStarRotation: U.uStarRotation,
  uExposureHint: U.uExposureHint, uFogDensity: U.uFogDensity, uFogHeightFalloff: U.uFogHeightFalloff,
  uFogInscatter: U.uFogInscatter, uCloudCover: U.uCloudCover, uCloudAltitude: U.uCloudAltitude,
  uCloudThickness: U.uCloudThickness, uCloudOffset: U.uCloudOffset, uCloudScale: U.uCloudScale,
  // the same objects under the names ATMOS_GLSL declares
  uAtmSunDir: U.uSunDir, uAtmMoonDir: U.uMoonDir, uAtmSkyLUT: U.uSkyLUT, uAtmTransLUT: U.uTransmittanceLUT,
  uAtmStarRot: U.uStarRotation, uAtmFogFalloff: U.uFogHeightFalloff, uAtmPolarizer: U.uPolarizer, uAtmCloudOffset: U.uCloudOffset,
  uAtmCloudAlt: U.uCloudAltitude, uAtmCloudThick: U.uCloudThickness,
  // atmosphere-owned
  uAtmAmbTex: { value: null },
  uAtmMilkyWay: { value: null },
  uAtmStarCells: { value: null },
  uAtmStarData: { value: null },
  uAtmLUT: { value: new THREE.Vector4(0.1, 1, Math.PI / 2, Math.PI / 2) },
  uAtmFogRGB: { value: new THREE.Vector3().fromArray(ATMOS.fogDensityRGB) },
  uAtmPre: { value: 1 },
  uAtmKey: { value: new THREE.Vector3(0, 1, 0) },
  uAtmKeyE: { value: new THREE.Vector3() },
  uAtmCloud: { value: new THREE.Vector4(1, 1 / WEATHER_TILE_M, CLOUD_EXTINCTION, CLOUDS.cover) },   // x coverage threshold, y 1 / weather tile, z extinction at density 1, w cover
  uAtmSunDisk: { value: new THREE.Vector4(0, 0, 0, SUN.angularRadiusRad) },
  uAtmMoonDisk: { value: new THREE.Vector4(0, 0, 0, 0.0045) },
  uAtmDiskShape: { value: new THREE.Vector4(1, 1, 0, 0) },
  uAtmMoonN: { value: new THREE.Vector3(0, 1, 0) },
  uAtmMoonW: { value: new THREE.Vector3(1, 0, 0) },
  uAtmMaria: { value: MOON_FEATURES.map(([lo, la, r, d]) => new THREE.Vector4(lo * RAD, la * RAD, r * RAD, d)) },
  uAtmStars: { value: new THREE.Vector4(0, 4e-4, 0, 0) },
  uAtmCities: { value: CITIES.map(() => new THREE.Vector4()) },
  uAtmCityTint: { value: new THREE.Vector3().fromArray(CITY_TINT) },
  uAtmCirrus: { value: new THREE.Vector4(CIRRUS.altitude, CIRRUS.tau, 0, 0) },
  ...CLOUD_UNIFORMS,
};

// ================================================================== helpers

function makeTarget(w, h, opts = {}) {
  return new THREE.WebGLRenderTarget(w, h, {
    type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, stencilBuffer: false,
    magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter, generateMipmaps: false,
    wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping, ...opts,
  });
}

// Fullscreen passes into small targets, restoring the renderer's target afterwards.
class LutRenderer {
  constructor(renderer) {
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.mesh = new THREE.Mesh(g, null);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }
  material(name, fragmentShader, uniforms = {}) {
    return new THREE.ShaderMaterial({
      name, uniforms, vertexShader: FULLSCREEN_VS, fragmentShader,
      depthTest: false, depthWrite: false, fog: false, toneMapped: false,
    });
  }
  render(material, target) {
    const r = this.renderer;
    const prev = r.getRenderTarget(), face = r.getActiveCubeFace(), mip = r.getActiveMipmapLevel();
    const xr = r.xr.enabled;
    r.xr.enabled = false;
    this.mesh.material = material;
    r.setRenderTarget(target);
    r.render(this.scene, this.camera);
    r.setRenderTarget(prev, face, mip);
    r.xr.enabled = xr;
  }
  dispose() { this.mesh.geometry.dispose(); }
}

// Smooth pre-exposure against the sun elevation (see PRE_EXPOSURE_LOG10_NIGHT).
function preExposureForSun(elDeg) {
  const x = Math.min(1, Math.max(0, -elDeg / 12));
  return Math.pow(10, PRE_EXPOSURE_LOG10_NIGHT * x * x * (3 - 2 * x));
}

function angleBetweenDeg(a, b) { return Math.acos(Math.min(1, Math.max(-1, a.dot(b)))) / RAD; }

// Disk mean of albedo x Lommel-Seeliger at phase angle i (deg): 0.5 x the Lommel-Seeliger phase
// function 1 - sin(i/2) tan(i/2) ln(cot(i/4)) x the disk's mean albedo with the maria above, 0.126
// (a 60x60 integration of the shader's own disk gives 0.124-0.128 at every phase, waxing or waning).
function moonDiskMean(iDeg) {
  const i = Math.max(iDeg * RAD, 1e-4);
  return 0.063 * (1 - Math.sin(i / 2) * Math.tan(i / 2) * Math.log(1 / Math.tan(i / 4)));
}

// ================================================================== Atmosphere

// A clock running at 600x or more with the sun between -14 and +12 deg: the light changes by a large factor every frame
// (flash-verify, 2026-10-07; the ocean's sky panorama uses the same test).
function fastTwilight(clock, sunEl) { return !!clock?.playing && clock.speed >= 600 && sunEl > -14 && sunEl < 12; }

export class Atmosphere {
  /**
   * @param {object} ctx { renderer, scene, camera, quality, clock } (clock optional: a default SimClock)
   */
  constructor(ctx) {
    this.ctx = ctx;
    this.renderer = ctx.renderer;
    this.scene = ctx.scene;
    this.quality = ctx.quality || QUALITY.high;
    this.clock = ctx.clock || new SimClock();
    this.glsl = ATMOS_GLSL;
    // The core subset (uniforms, aerial perspective, cloud shadow) has no gl_FragCoord, so it also
    // compiles in vertex shaders (the ocean evaluates its aerial perspective per vertex).
    this.glslCore = ATMOS_GLSL_CORE;
    this.uniforms = ATMOS_UNIFORMS;

    // Public state (read by UI, Post, other modules).
    this.sunElevationDeg = 0; this.sunAzimuthDeg = 0;
    this.moonElevationDeg = 0; this.moonAzimuthDeg = 0; this.moon = null; this.sun = null;
    this.exposureTarget = 1;
    this.exposureTargetPhotoFit = 1;
    this.preExposure = 1;
    this.horizonRadiance = new THREE.Color();          // absolute, 0-1.5 deg above the horizon in the view azimuth
    this.horizonToSunRatio = 0;                          // Y(L_horizon) / E_sun (sr^-1), SCENE-SPEC §12 sanity band
    this.zenithRadiance = new THREE.Color();            // absolute clear-sky zenith radiance (sky LUT, no clouds)
    this.zenithSkyMag = 0;                              // the same as V mag/arcsec^2 (moonless dark site ~21.6)
    // Sky irradiance on a horizontal surface (absolute), clouds' light included: π (cosine-weighted
    // clear-sky mean + 2 × cloud light), the same E_sky the ocean lights the sea with from the ambient
    // table. CPU copy for modules that light things on the CPU (blitz spray and foam).
    this.skyIrradiance = new THREE.Color();
    this.ready = false;

    // Cloud state.
    this.cloudCover = CLOUDS.cover;
    U.uCloudCover.value = CLOUDS.cover;
    U.uCloudAltitude.value = CLOUDS.baseAltitude;
    U.uCloudThickness.value = CLOUDS.thickness;
    U.uFogDensity.value = ATMOS.fogDensity;
    U.uFogHeightFalloff.value = ATMOS.fogHeightFalloff;
    this._cloudDrift = new THREE.Vector2().fromArray(CLOUDS.driftMS);
    this.weatherPhase = new THREE.Vector2().fromArray(WEATHER_PHASE_M);   // field position at t = 0 (m)

    // White balance and solar illuminance above the atmosphere.
    const tRef = transmittanceToSpace(0.002, Math.sin(WB_REFERENCE_ELEVATION_DEG * RAD));
    const wb = [1 / tRef[0], 1 / tRef[1], 1 / tRef[2]];
    const wbY = lum(wb[0], wb[1], wb[2]);
    this._solarWB = wb.map((c) => c / wbY);
    this._sunTOA = this._solarWB.map((c) => c * SOLAR_ILLUMINANCE_LX / LOOK.sceneUnitLux);

    // GPU resources.
    this._lut = new LutRenderer(this.renderer);
    this._buildStaticLUTs();
    this._createSkyView();
    this._createClouds();
    this._createNightSky();
    this._createSky();
    this._createLights();
    this._createEnvironment();

    // Fog: the patched chunks need scene.fog (USE_FOG); its values feed the fallback path.
    if (!this.scene.fog || !this.scene.fog.isFog) this.scene.fog = new THREE.Fog(0xffffff, ATMOS.fogDensity, 1);

    // Per-frame bookkeeping.
    this._lastSky = { sun: new THREE.Vector3(0, -2, 0), moon: new THREE.Vector3(0, -2, 0), h: -1, x: 1e9, z: 1e9, pre: -1, moonE: -1 };
    this._lastEnv = { sun: new THREE.Vector3(0, -2, 0), moon: new THREE.Vector3(0, -2, 0), cover: -1, drift: new THREE.Vector2(1e9, 1e9), version: -1 };
    this._envStep = -1;
    this._hzTable = new Float32Array(AMB_W * 4);
    this._ambRow = new Float32Array(5 * 4);
    this._sky10Table = new Float32Array(AMB_W * 4);
    this._sky126Table = new Float32Array(AMB_W * 4);
    this._readback = { busy: false, pending: null };
    this._shadowFocus = new THREE.Vector3(0, 130, 0);   // hero bounding sphere centre (SCENE-SPEC §12.4)
    this._camPos = new THREE.Vector3(); this._tmpV = new THREE.Vector3(); this._tmpSize = new THREE.Vector2();
    this._tmpColor = new THREE.Color();
    this._tmpMat = new THREE.Matrix4(); this._tmpMat2 = new THREE.Matrix4(); this._tmpQuat = new THREE.Quaternion();
    this._viewAz = CAMERA_PRESETS.drone.headingDeg;
    this._time = 0;

    this._clockVersion = -1;
    this._envClock = 0;                                  // accumulated frame dt (s): throttles env re-bakes
    this._envStart = -1e9;
    this._envE = 0;                                      // sky irradiance (luminance) the environment was baked with
    this._ambBuf = [new Float32Array(AMB_W * AMB_H * 4), new Float32Array(AMB_W * AMB_H * 4)];
    this._ambBufIndex = 0;

    // First frame: everything synchronously (LUT, horizon table, environment).
    this.update(0, U.uTime.value, ctx.camera, { force: true });
    if (globalThis.NJOW_DEV !== false) registerAtmosphereScales(this);
    this.ready = true;
  }

  // ---------------------------------------------------------------- public API

  /** Cloud cover 0..1 (and optionally base altitude / thickness in metres). */
  setClouds({ cover, altitude, thickness } = {}) {
    if (typeof cover === 'number' && Number.isFinite(cover)) {
      this.cloudCover = Math.min(1, Math.max(0, cover));
      U.uCloudCover.value = this.cloudCover;
    }
    if (typeof altitude === 'number') U.uCloudAltitude.value = altitude;
    if (typeof thickness === 'number') U.uCloudThickness.value = thickness;
    this.clouds.setCover(this.cloudCover);
    this._forceNext = true;         // cloud light, panorama and shadow map are rebuilt next frame
  }

  /**
   * World point the sun/moon shadow frustum is centred on, and optionally its half-width in metres
   * (default SHADOW.halfExtent, the hero's bounding sphere). Close-up views pass a smaller box so
   * the 4096² map resolves platform-scale shadows (±45 m: 2.2 cm texels instead of 9.3 cm).
   */
  setShadowFocus(v, halfExtent = SHADOW.halfExtent) {
    this._shadowFocus.copy(v);
    for (const light of [this.sunLight, this.moonLight]) {
      const c = light.shadow.camera;
      if (c.right === halfExtent) continue;
      c.left = -halfExtent; c.right = halfExtent; c.top = halfExtent; c.bottom = -halfExtent;
      c.updateProjectionMatrix();
      light.shadow.needsUpdate = true;
    }
  }

  /** Horizon radiance (absolute, linear RGB) for a compass azimuth, from the latest table. */
  horizonRadianceAt(azDeg, out = new THREE.Color()) { return this._tableAt(this._hzTable, azDeg, out); }

  _tableAt(t, azDeg, out) {
    const x = (((azDeg / 360) * AMB_W - 0.5) % AMB_W + AMB_W) % AMB_W;
    const i0 = Math.floor(x), i1 = (i0 + 1) % AMB_W, w = x - i0;
    return out.setRGB(
      t[i0 * 4] * (1 - w) + t[i1 * 4] * w,
      t[i0 * 4 + 1] * (1 - w) + t[i1 * 4 + 1] * w,
      t[i0 * 4 + 2] * (1 - w) + t[i1 * 4 + 2] * w, THREE.LinearSRGBColorSpace);
  }

  setQuality(q) {
    this.quality = q;
    this.clouds.setQuality(q);
    const s = q.shadowMapSize;
    for (const [light, size] of [[this.sunLight, s], [this.moonLight, s / 2]]) {
      if (light.shadow.mapSize.x !== size) {
        light.shadow.mapSize.set(size, size);
        if (light.shadow.map) { light.shadow.map.dispose(); light.shadow.map = null; }
      }
    }
    if (q.pmremSize !== this._envSize) {
      this._disposeEnvironment();
      this._createEnvironment();
      this._bakeEnvironmentNow();
    }
  }

  // ---------------------------------------------------------------- frame update

  /**
   * @param {number} dt real seconds (clamped by main)
   * @param {number} t  animation time (U.uTime)
   * @param {THREE.Camera} camera the view camera
   */
  update(dt, t, camera, { force = false } = {}) {
    const clock = this.clock;
    // A discontinuous clock change (setTime / setDate / the UI slider) rebuilds everything that is
    // built incrementally, synchronously, before this frame renders: the sky-view LUT twice (the
    // first pass without cloud light, whose absolute value belongs to the previous time), the
    // ambient table (read back synchronously), the cloud layers and the environment. Without this
    // the previous time's absolute cloud and ambient light was re-injected into the new sky, scaled
    // by the new pre-exposure: a yellow-green or orange 'day' at night (p1 night / life critiques).
    const jumped = clock.version !== this._clockVersion;
    this._clockVersion = clock.version;
    if (jumped || this._forceNext) force = true;
    this._forceNext = false;
    this._envClock += Math.max(dt, 0);
    const jd = clock.julianDay();
    const sun = clock.sun();
    const moon = clock.moon();
    this.sun = sun; this.moon = moon;
    this.sunElevationDeg = sun.elevationDeg; this.sunAzimuthDeg = sun.azimuthDeg;
    this.moonElevationDeg = moon.elevationDeg; this.moonAzimuthDeg = moon.azimuthDeg;
    this._time = t;

    const sunDir = dirFromAzEl(sun.azimuthDeg, sun.elevationDeg, U.uSunDir.value);
    const moonDir = dirFromAzEl(moon.azimuthDeg, moon.elevationDeg, U.uMoonDir.value);

    // Camera frame.
    const cam = camera || this.ctx.camera;
    const camPos = cam.getWorldPosition(this._camPos);
    U.uCameraPos.value.copy(camPos);
    const camAlt = Math.max(camPos.y + (camPos.x * camPos.x + camPos.z * camPos.z) / (2 * EARTH_R), 0.5);
    const fwd = cam.getWorldDirection(this._tmpV);
    if (Math.abs(fwd.x) + Math.abs(fwd.z) > 1e-6) this._viewAz = (Math.atan2(fwd.x, -fwd.z) / RAD + 360) % 360;

    // Pre-exposure, night factor.
    this.preExposure = preExposureForSun(sun.elevationDeg);
    this.uniforms.uAtmPre.value = this.preExposure;
    U.uNight.value = smooth01((2 - sun.elevationDeg) / 14);

    // Direct light at sea level.
    this._updateSunMoonLight(sun, moon, sunDir, moonDir);

    // Key light for clouds and cloud shadows: the sun until it is well below the horizon.
    const sunKey = sun.elevationDeg > -8 || moon.elevationDeg < -2;
    this.uniforms.uAtmKey.value.copy(sunKey ? sunDir : moonDir);
    this.uniforms.uAtmKeyE.value.fromArray(sunKey ? this._sunTOA : this._moonTOA);

    // Night sky.
    this._updateNightSky(jd, moon, moonDir, cam);

    // Clouds drift with the wind aloft (animation time, so ?freeze=1 shots are reproducible).
    U.uCloudOffset.value.copy(this._cloudDrift).multiplyScalar(t).add(this.weatherPhase);

    // Sky-view LUT when anything it depends on moved.
    const ls = this._lastSky;
    const needSky = force
      || angleBetweenDeg(ls.sun, sunDir) > SKY_LUT_ANGLE_DEG
      || (angleBetweenDeg(ls.moon, moonDir) > SKY_LUT_ANGLE_DEG && moon.elevationDeg > -10)
      || Math.abs(camAlt - ls.h) > Math.max(2, 0.03 * ls.h)
      || Math.hypot(camPos.x - ls.x, camPos.z - ls.z) > 300
      || Math.abs(this.preExposure / ls.pre - 1) > 0.02
      || Math.abs(this._moonTOAY / Math.max(ls.moonE, 1e-30) - 1) > 0.02
      || ls.cover !== this.cloudCover
      || ls.pol !== U.uPolarizer.value;       // the photo-fit rows see the sky through the camera filter
    // A big step of the sun since the last build (a slider drag between input events) is treated
    // like a jump: synchronous, two passes. A playing time-lapse moves it < 3 deg per frame and
    // stays on the cheap asynchronous path (the cloud light changes continuously there).
    const hard = force || angleBetweenDeg(ls.sun, sunDir) > 3;
    if (needSky) {
      const gain = this._skyViewMat.uniforms.uCloudLightGain;
      if (hard) {
        // pass 0: clear-sky LUT (no cloud light) -> ambient (clear-sky rows) -> clouds lit by them
        // (light-space map + panorama) -> ambient again (this sky's cloud light); pass 1: LUT with
        // that cloud light -> ambient -> clouds again.
        gain.value = 0;
        this._renderSkyView(sunDir, moonDir, camAlt, camPos);
        this._renderAmbient(true, camPos);
        this.clouds.update(camPos, this.preExposure, { force: true });
        this._renderAmbient(true, camPos);
        gain.value = 1;
        this._renderSkyView(sunDir, moonDir, camAlt, camPos);
        this._renderAmbient(true, camPos);
      } else {
        gain.value = 1;
        this._renderSkyView(sunDir, moonDir, camAlt, camPos);
        // A fast time-lapse (600x and up) through dawn or dusk moves the light by up to stops a frame; read back late,
        // this table (the exposure anchor, the fog colour) lagged the sky by one frame or two in turn: a 30 Hz flicker of
        // the whole frame, +-6 levels at 60 fps, +-30 at 10 fps (flash-verify, 2026-10-07). There the live loop reads it
        // at once (a main-thread wait for the GPU, twilight only); a capture waits for its own read-backs every frame
        // (its table is always the previous frame's) and stays as it was.
        this._renderAmbient(fastTwilight(clock, sun.elevationDeg) && !this.ctx.world?.params?.capture, camPos);
      }
      ls.sun.copy(sunDir); ls.moon.copy(moonDir); ls.h = camAlt; ls.x = camPos.x; ls.z = camPos.z;
      ls.pre = this.preExposure; ls.moonE = this._moonTOAY; ls.cover = this.cloudCover; ls.pol = U.uPolarizer.value;
    }
    // Cloud products: light-space map and panorama, a band of rows per frame (the whole of each within
    // ~20 m of cloud drift), all at once when forced, the camera moved or the pre-exposure changed.
    this.clouds.update(camPos, this.preExposure, { force: hard });

    // Exposure (rule: 1.43 / Y(L_horizon) in the camera's view azimuth), fog colour.
    this.horizonRadianceAt(this._viewAz, this.horizonRadiance);
    // the original horizon rule and the sun sanity ratio: diagnostics of dev builds only (no consumer reads
    // them or U.uExposureHint; round 4 dropped them from the hosted bundle)
    if (globalThis.NJOW_DEV !== false) {
      const hY = Math.max(lum(this.horizonRadiance.r, this.horizonRadiance.g, this.horizonRadiance.b), 1e-12);
      this.exposureTarget = LOOK.horizonExposedY / hY;
      U.uExposureHint.value = this.exposureTarget / this.preExposure;
      const sunY = lum(U.uSunIlluminance.value.r, U.uSunIlluminance.value.g, U.uSunIlluminance.value.b);
      this.horizonToSunRatio = sunY > 0 ? hY / sunY : 0;
    }
    // Diagnostic (not the contract rule): the exposure that puts the clear sky at 10 and 12.6 deg
    // on the photo's exposed luminances (0.68, 0.53; SCENE-SPEC §12.2), geometric mean of the two.
    const c10 = this._tableAt(this._sky10Table, this._viewAz, this._tmpColor);
    const y10 = Math.max(lum(c10.r, c10.g, c10.b), 1e-12);
    const c126 = this._tableAt(this._sky126Table, this._viewAz, this._tmpColor);
    const y126 = Math.max(lum(c126.r, c126.g, c126.b), 1e-12);
    this.exposureTargetPhotoFit = Math.sqrt((LOOK.exposedTargets.sky10 / y10) * (LOOK.exposedTargets.skyTop / y126));
    U.uFogInscatter.value.copy(this.horizonRadiance);
    this.scene.fog.color.copy(this.horizonRadiance);
    this.scene.fog.near = ATMOS.fogDensity;
    this.scene.fog.far = this.preExposure;

    // Sky dome follows the camera; its cloud layers are rendered for this camera. Clouds below the
    // camera (camera above the cloud base) go through the overlay.
    this.skyMesh.position.copy(camPos);
    this.cloudOverlay.visible = camAlt > U.uCloudAltitude.value && this.cloudCover > 0;
    this._renderCloudScreen(cam, camPos, hard);

    // Shadows.
    this._updateShadows(sun, moon);

    // Environment.
    this._updateEnvironment(sunDir, moonDir, moon, camPos, hard);
  }

  // ---------------------------------------------------------------- LUTs

  _buildStaticLUTs() {
    this.transLUT = this.transLUT || makeTarget(TRANS_W, TRANS_H);
    this.msLUT = this.msLUT || makeTarget(MS_SIZE, MS_SIZE);
    const transMat = this._lut.material('Atmosphere.TransmittanceLUT', TRANSMITTANCE_FS);
    this._lut.render(transMat, this.transLUT);
    const msMat = this._lut.material('Atmosphere.MultiScatteringLUT', MULTISCATTER_FS, {
      uTrans: { value: this.transLUT.texture }, uGroundAlbedo: { value: ATMOS.groundAlbedo },
    });
    this._lut.render(msMat, this.msLUT);
    transMat.dispose(); msMat.dispose();
    U.uTransmittanceLUT.value = this.transLUT.texture;
  }

  _createSkyView() {
    this.skyLUT = makeTarget(SKY_W, SKY_H, { wrapS: THREE.RepeatWrapping });
    U.uSkyLUT.value = this.skyLUT.texture;
    this._skyViewMat = this._lut.material('Atmosphere.SkyViewLUT', SKYVIEW_FS, {
      uTrans: { value: this.transLUT.texture }, uMS: { value: this.msLUT.texture },
      uSunDir: { value: new THREE.Vector3() }, uMoonDir: { value: new THREE.Vector3() },
      uSunE: { value: new THREE.Vector3() }, uMoonE: { value: new THREE.Vector3() },
      uCam: { value: new THREE.Vector4() },
      uCities: { value: CITIES.map(() => new THREE.Vector4()) },
      uCityTint: { value: new THREE.Vector3().fromArray(CITY_TINT) },
      uAirglow: { value: new THREE.Vector3() },
      uAirglowRatio: { value: RB_KM / (RB_KM + AIRGLOW_HEIGHT_KM) },
      uAmb: { value: null }, uScale: { value: 1 }, uCloudTopKm: { value: 1.4 },
      uBackground: { value: new THREE.Vector3() }, uNightDiffuse: { value: new THREE.Vector3() },
      uCloudLightGain: { value: 1 },
      uDiffuseSunF: { value: DIFFUSE_SHAPE.sunForward },
      uMSShadow: { value: new THREE.Vector2(1, MS_SHADOW.softRad) },
      uDiffuseShape: { value: diffuseShapeUniform() },
      uDiffuseWidth: { value: new THREE.Vector2(DIFFUSE_SHAPE.upWidthRad, DIFFUSE_SHAPE.downWidthRad) },
    });
    // Ambient / horizon reduction: two float targets (the cloud march inside the pass reads the
    // previous one), read back for the exposure table and texelFetch'ed by clouds and the LUT.
    const ambOpts = { type: THREE.FloatType, magFilter: THREE.NearestFilter, minFilter: THREE.NearestFilter };
    this.ambRT = [makeTarget(AMB_W, AMB_H, ambOpts), makeTarget(AMB_W, AMB_H, ambOpts)];
    this._ambIndex = 0;
    this.uniforms.uAtmAmbTex.value = this.ambRT[0].texture;
    this._skyViewMat.uniforms.uAmb.value = this.ambRT[0].texture;
    this._ambMat = this._lut.material('Atmosphere.Ambient', AMBIENT_FS, Object.assign({}, this.uniforms, {
      uSunSea: { value: new THREE.Vector3() },
      uSeaAlbedo: { value: new THREE.Vector3(0.06, 0.06, 0.06).add(new THREE.Vector3().fromArray(SEA.upwellingReflectance)) },
    }));
  }

  _renderSkyView(sunDir, moonDir, camAltM, camPos) {
    const m = this._skyViewMat.uniforms;
    const scale = this.preExposure;
    const hKm = camAltM / 1000;
    const r = RB_KM + hKm;
    const beta = Math.acos(Math.sqrt(hKm * (2 * RB_KM + hKm)) / r);   // horizon -> nadir
    m.uCam.value.set(hKm, 0, Math.PI - beta, beta);
    m.uSunDir.value.copy(sunDir);
    m.uMoonDir.value.copy(moonDir);
    m.uSunE.value.fromArray(this._sunTOA).multiplyScalar(scale);
    m.uMoonE.value.fromArray(this._moonTOA).multiplyScalar(scale);
    const nightSky = smooth01((-2 - this.sunElevationDeg) / 10);       // city lights and airglow
    CITIES.forEach((c, i) => {
      const x = Math.sin(c.bearingDeg * RAD) * c.distanceM, z = -Math.cos(c.bearingDeg * RAD) * c.distanceM;
      m.uCities.value[i].set((x - camPos.x) / 1000, (z - camPos.z) / 1000, c.I * 1e-6 * scale * nightSky, c.radiusM / 1000);
      this.uniforms.uAtmCities.value[i].set(x, z, c.I * nightSky, c.radiusM);
    });
    const ag = AIRGLOW_ZENITH_CDM2 / LOOK.sceneUnitLux * scale;
    const agY = lum(...AIRGLOW_TINT);
    m.uAirglow.value.set(AIRGLOW_TINT[0] / agY * ag, AIRGLOW_TINT[1] / agY * ag, AIRGLOW_TINT[2] / agY * ag);
    const bg = STARLIGHT_BACKGROUND_CDM2 / LOOK.sceneUnitLux * scale, bgY = lum(...STARLIGHT_TINT);
    m.uBackground.value.set(STARLIGHT_TINT[0] / bgY * bg, STARLIGHT_TINT[1] / bgY * bg, STARLIGHT_TINT[2] / bgY * bg);
    // Diffuse night-sky field seen from inside the atmosphere, averaged over the whole sphere: upper
    // hemisphere ~1.6x the zenith airglow (van Rhijn, less extinction) + the background; lower
    // hemisphere the dark sea (reflectance ~0.06 + upwelling), ~0.07 of the upper: 0.5 x 1.07.
    m.uNightDiffuse.value.copy(m.uAirglow.value).multiplyScalar(1.6).add(m.uBackground.value).multiplyScalar(0.5 * 1.07);
    m.uScale.value = scale;
    m.uDiffuseSunF.value = DIFFUSE_SHAPE.sunForward * smooth01((this.sunElevationDeg + 4) / 6);
    const k = smooth01((this.sunElevationDeg - MS_SHADOW.offDeg) / (MS_SHADOW.fullDeg - MS_SHADOW.offDeg));
    m.uMSShadow.value.set(1 - (1 - MS_SHADOW.floor) * k, MS_SHADOW.softRad);
    m.uCloudTopKm.value = (U.uCloudAltitude.value + U.uCloudThickness.value) / 1000;
    this._lut.render(this._skyViewMat, this.skyLUT);
    this.uniforms.uAtmLUT.value.set(hKm, 1 / scale, Math.PI - beta, beta);
  }

  _renderAmbient(sync, camPos) {
    const a = this._ambMat.uniforms;
    a.uSunSea.value.set(U.uSunIlluminance.value.r, U.uSunIlluminance.value.g, U.uSunIlluminance.value.b);
    const src = this.ambRT[this._ambIndex], dst = this.ambRT[1 - this._ambIndex];
    this.uniforms.uAtmAmbTex.value = src.texture;
    // The pass marches the clouds from the view camera: cameraPosition comes from the LUT camera.
    this._lut.camera.position.copy(camPos);
    this._lut.camera.updateMatrixWorld();
    this._lut.render(this._ambMat, dst);
    this._lut.camera.position.set(0, 0, 0);
    this._lut.camera.updateMatrixWorld();
    this._ambIndex = 1 - this._ambIndex;
    this.uniforms.uAtmAmbTex.value = dst.texture;
    this._skyViewMat.uniforms.uAmb.value = dst.texture;
    const target = dst;
    const buf = this._ambBuf[0];
    const apply = (b) => {
      this._hzTable.set(b.subarray(0, AMB_W * 4));
      this._ambRow.set(b.subarray(AMB_W * 4, AMB_W * 4 + 20));
      this._sky10Table.set(b.subarray(AMB_W * 8, AMB_W * 12));
      this._sky126Table.set(b.subarray(AMB_W * 12, AMB_W * 16));
      const z = this._ambRow;
      this.zenithRadiance.setRGB(z[12], z[13], z[14]);
      this.skyIrradiance.setRGB(Math.PI * (z[4] + 2 * z[16]), Math.PI * (z[5] + 2 * z[17]), Math.PI * (z[6] + 2 * z[18]));
      if (globalThis.NJOW_DEV !== false) {
        const zY = lum(z[12], z[13], z[14]) * LOOK.sceneUnitLux;     // cd/m2
        this.zenithSkyMag = zY > 0 ? -2.5 * Math.log10(zY / 1.08e5) : 0;
      }
    };
    if (sync) {
      // another module's asynchronous read may still have its pixel-pack buffer bound (r180 binds
      // it while the read is in flight); a synchronous readPixels would then fail silently
      const gl = this.renderer.getContext();
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      this.renderer.readRenderTargetPixels(target, 0, 0, AMB_W, AMB_H, buf);
      apply(buf);
      return;
    }
    // One asynchronous read in flight at a time; a newer table replaces a pending request.
    if (this._readback.busy) { this._readback.pending = target; return; }
    const read = (rt) => {
      this._readback.busy = true;
      this.renderer.readRenderTargetPixelsAsync(rt, 0, 0, AMB_W, AMB_H, this._ambBuf[1]).then(apply)
        .catch(() => { /* context lost or target disposed: keep the last table */ })
        .finally(() => {
          this._readback.busy = false;
          const next = this._readback.pending;
          this._readback.pending = null;
          if (next && !this._disposed) read(next);
        });
      // r180 leaves its pixel-pack buffer bound until the read completes (it re-binds it itself
      // before reading), which would make any synchronous readPixels in between fail.
      const gl = this.renderer.getContext();
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    };
    read(target);
  }

  // Cloud layers for the view camera (clouds.js): a quarter of the half-resolution buffer is marched
  // per frame and resolved temporally; the dome and the overlay look it up by direction.
  _renderCloudScreen(cam, camPos, force) {
    const size = this.renderer.getDrawingBufferSize(this._tmpSize);
    cam.updateMatrixWorld();
    const rot = this._tmpMat.extractRotation(cam.matrixWorld);
    const ov = this.cloudOverlay.material.uniforms;
    ov.uScreenNow.value.set(size.x, size.y);
    ov.uInvViewProjNow.value.multiplyMatrices(rot, cam.projectionMatrixInverse);
    if (force) this.clouds.invalidateHistory();
    const scale = CLOUD_VIEW_SCALE[this.quality.name] ?? 0.5;
    const tex = this.clouds.renderView(cam, camPos, this.preExposure, size, scale, this._layerUniforms.uAtmLayerViewProj.value);
    this._layerUniforms.uAtmCloudScreen.value = tex;
    this._layerUniforms.uAtmLayerPre.value = this.preExposure;
  }

  // ---------------------------------------------------------------- clouds

  _createClouds() {
    this.clouds = new CloudSystem({
      renderer: this.renderer, lut: this._lut, uniforms: this.uniforms, glslCore: GLSL_CORE, glslSky: GLSL_SKY,
      cityCount: CITIES.length, quality: this.quality,
    });
    // projected (top-down) cover = the requested cover at every setting (clouds.js COVER_TABLE)
    this.clouds.setCover(this.cloudCover);
  }

  // ---------------------------------------------------------------- night sky (sky-night.js)

  _createNightSky() {
    const stars = buildStarTextures(this.clock.date.year + (this.clock.date.month - 0.5) / 12);
    this._starTex = stars;
    this.uniforms.uAtmStarCells.value = stars.cellTex;
    this.uniforms.uAtmStarData.value = stars.dataTex;
    this.milkyWayRT = new THREE.WebGLRenderTarget(MW_W, MW_H, {
      type: THREE.HalfFloatType, format: THREE.RedFormat, depthBuffer: false, stencilBuffer: false,
      generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
      wrapS: THREE.RepeatWrapping, wrapT: THREE.ClampToEdgeWrapping,
    });
    this.milkyWayRT.texture.name = 'Sky.MilkyWay';
    this._bakeMilkyWay();
    this.uniforms.uAtmMilkyWay.value = this.milkyWayRT.texture;
  }

  _bakeMilkyWay() {
    const m = this._lut.material('Atmosphere.MilkyWay', MILKY_WAY_FS);
    this._lut.render(m, this.milkyWayRT);
    m.dispose();
  }


  // ---------------------------------------------------------------- sky dome

  _createSky() {
    const vs = /* glsl */`
      varying vec3 vAtmWorldPos;
      #include <common>
      #include <logdepthbuf_pars_vertex>
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vAtmWorldPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
        #include <logdepthbuf_vertex>
      }`;
    // The dome is drawn after every opaque object at the far plane (depth 0.99999 w, no log-depth
    // write), with a less-or-equal depth test: early-Z rejects every pixel geometry already covers
    // (the ocean covers ~55 % of the drone frame; the dome shaded all of it first before: 1.4 ms at
    // DPR 2). Log-depth values of real geometry stay below 0.99995 out to the 150 km far plane.
    // Contract consequence: opaque materials must write depth.
    const domeVs = /* glsl */`
      varying vec3 vAtmWorldPos;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vAtmWorldPos = wp.xyz;
        vec4 c = projectionMatrix * viewMatrix * wp;
      #ifdef USE_REVERSED_DEPTH_BUFFER
        gl_Position = vec4(c.xy, c.w * 1e-7, c.w);     // reversed-Z: the far plane is depth 0
      #else
        gl_Position = vec4(c.xy, c.w * 0.99999, c.w);
      #endif
      }`;
    // The dome: clear sky-view LUT + the half-resolution cloud layers (screen pre-pass, rendered in
    // update() for the view camera) + stars, Milky Way, moon and sun at full resolution.
    const fs = /* glsl */`
      #include <common>
      ${ATMOS_GLSL}
      ${GLSL_LAYER_UPSAMPLE}
      varying vec3 vAtmWorldPos;
      void main() {
        vec3 dir0 = normalize(vAtmWorldPos - cameraPosition);
        vec3 dir = atmAboveHorizon(dir0);
        // within ~4 half-resolution texels of the horizon the kind-aware upsample is needed
        bool nearHorizon = acos(clamp(dir0.y, -1.0, 1.0)) > uAtmLUT.z - 12.0 * uAtmStars.y;
        vec4 layers = atmDomeLayersAt(atmLayerUV(dir0), nearHorizon);
        vec4 sky = atmSkyLUTSample(dir);
        // the filter acts on the clear sky seen between the clouds (clouds depolarize)
        vec3 L = sky.rgb * (1.0 + (atmPolarizer(dir, sky.a, vec3(viewMatrix[0].y, viewMatrix[1].y, viewMatrix[2].y)) - 1.0) * layers.a) + layers.rgb + atmBackground(dir, true, true) * layers.a;
        gl_FragColor = vec4(atmExpose(L), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`;
    this._cloudScreenRT = makeTarget(2, 2);
    this._layerUniforms = {
      uAtmCloudScreen: { value: this._cloudScreenRT.texture },
      uAtmLayerViewProj: { value: new THREE.Matrix4() },
      uAtmLayerPre: { value: 1 },
    };
    this.skyMaterial = new THREE.ShaderMaterial({
      name: 'Atmosphere.Sky',
      uniforms: Object.assign({}, this.uniforms, this._layerUniforms),
      vertexShader: domeVs, fragmentShader: fs,
      side: THREE.BackSide, depthWrite: false, depthTest: true, depthFunc: THREE.LessEqualDepth, fog: false,
    });

    // Cloud overlay for cameras above the cloud base: clouds below the camera composited over the
    // finished frame (everything modelled is below 300 m, so no depth test is needed).
    this.cloudOverlay = new THREE.Mesh(this._lut.mesh.geometry, new THREE.ShaderMaterial({
      name: 'Atmosphere.CloudOverlay',
      uniforms: Object.assign({}, this._layerUniforms, {
        uScreenNow: { value: new THREE.Vector2(1, 1) }, uInvViewProjNow: { value: new THREE.Matrix4() }, uAtmPreNow: this.uniforms.uAtmPre,
      }),
      vertexShader: /* glsl */`
        #include <common>
        #include <logdepthbuf_pars_vertex>
        void main() { gl_Position = vec4(position.xy, 0.0, 1.0);
        #include <logdepthbuf_vertex>
        }`,
      fragmentShader: /* glsl */`
        #include <common>
        #include <logdepthbuf_pars_fragment>
        ${GLSL_LAYER_UPSAMPLE}
        uniform vec2 uScreenNow;
        uniform mat4 uInvViewProjNow;   // inverse of the current projection x view rotation
        uniform float uAtmPreNow;
        void main() {
          #include <logdepthbuf_fragment>
          vec4 w = uInvViewProjNow * vec4(gl_FragCoord.xy / uScreenNow * 2.0 - 1.0, 1.0, 1.0);
          vec4 o = atmLayersAt(atmLayerUV(normalize(w.xyz / w.w)), true);
          gl_FragColor = vec4(o.rgb * uAtmPreNow, o.a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true, depthTest: false, depthWrite: false, fog: false,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor, blendDst: THREE.SrcAlphaFactor,
      blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
    }));
    this.cloudOverlay.name = 'Atmosphere.CloudOverlay';
    this.cloudOverlay.frustumCulled = false;
    this.cloudOverlay.renderOrder = 1e6;
    this.cloudOverlay.visible = false;
    this.scene.add(this.cloudOverlay);
    const geo = new THREE.BoxGeometry(1, 1, 1);
    this.skyMesh = new THREE.Mesh(geo, this.skyMaterial);
    this.skyMesh.name = 'Atmosphere.SkyDome';
    this.skyMesh.scale.setScalar(10000);                 // encloses the camera; never clipped by near 0.5 / far 150 km
    this.skyMesh.renderOrder = 1e5;                      // last of the opaque list (see domeVs)
    this.skyMesh.frustumCulled = false;
    this.skyMesh.castShadow = false; this.skyMesh.receiveShadow = false;
    this.scene.add(this.skyMesh);                        // layer 0 only: never in LAYER_REFLECT

    // Environment variant: no stars, sun or moon disks; the lower hemisphere is the sea, seen as a
    // rough surface (Cox-Munk slopes at the current wind): mean Fresnel of the visible facets, whose
    // reflected rays leave higher than the mirror ray (into darker, bluer sky), the upwelling light,
    // and the sun's (moon's) glitter lobe, the largest source of light for downward-facing surfaces
    // on a sunny day (~1.7 % of the direct beam at 43 deg against ~0.9 % reflected sky).
    const envFs = /* glsl */`
      #define ATM_ENV
      #include <common>
      #include <logdepthbuf_pars_fragment>
      ${ATMOS_GLSL}
      uniform float uEnvScale;
      uniform vec3 uSeaUp;          // upwelling (water-leaving) radiance, absolute
      uniform float uEnvWind;       // U10 (m/s)
      uniform vec3 uSunIlluminance; // direct sun / moon at sea level (absolute, per unit normal area)
      uniform vec3 uMoonIlluminance;
      varying vec3 vAtmWorldPos;
      float envErfc(float x) { return 2.0 * exp(-x * x) / (2.319 * x + sqrt(4.0 + 1.52 * x * x)); }
      // Mean Fresnel of a rough water surface (Gaussian slopes, Smith masking): the ocean module's fit.
      float envMeanFresnel(float mu, float sigma) {
        float e = 5.2782 * exp(-2.9938 * sigma);
        return 0.02 + 0.98 * pow(1.0 - clamp(mu, 0.0, 1.0), e) / (1.0 + 24.6147 * pow(sigma, 1.5912));
      }
      // Cox-Munk glitter radiance toward v (from the sea up to the probe) for a light from L.
      vec3 envGlint(vec3 v, vec3 L, vec3 E, float s2) {
        if (L.y <= 0.0) return vec3(0.0);
        vec3 h = normalize(v + L);
        float cb = max(h.y, 1e-3);
        float cb2 = cb * cb;
        float tan2 = (1.0 - cb2) / cb2;
        float p = exp(-tan2 / s2) / (3.14159265 * s2 * cb2 * cb2);
        float c = clamp(dot(v, h), 0.0, 1.0);
        float F = 0.02 + 0.98 * pow(1.0 - c, 5.0);
        return E * F * p / (4.0 * max(v.y, 0.05));
      }
      void main() {
        #include <logdepthbuf_fragment>
        vec3 dir = normalize(vAtmWorldPos - cameraPosition);
        vec3 L;
        if (dir.y < 0.0) {
          float cosT = -dir.y;
          float s2 = 0.003 + 0.00512 * uEnvWind;           // Cox-Munk total mean-square slope
          float sig = sqrt(0.5 * s2);                        // per axis
          // visible facets tilt toward the viewer: mean visible slope sigma Phi(t) / D, t = tan(grazing) / sigma
          float a = cosT / sqrt(max(1.0 - cosT * cosT, 1e-6)) / sig;
          float Phi = 1.0 - 0.5 * envErfc(a * 0.70710678);
          float phi = 0.39894228 * exp(-0.5 * a * a);
          float lift = 2.0 * atan(sig * Phi / max(a * Phi + phi, 1e-4));
          float elR = min(asin(cosT) + lift, 1.5707);
          vec3 R = atmWithZenith(dir, 1.5707963 - elR);
          float F = envMeanFresnel(cosT, sig);
          vec3 hit = cameraPosition + dir * min(atmAltitude(cameraPosition) / max(cosT, 1e-3), 60000.0);
          vec3 v = -dir;
          vec3 glint = envGlint(v, uAtmSunDir, uSunIlluminance, s2) * cloudShadow(hit) + envGlint(v, uAtmMoonDir, uMoonIlluminance, s2);
          vec3 sea = F * atmSkyComposite(R, false, false) + (1.0 - F) * uSeaUp + min(glint, vec3(${f(HALF_SAFE_MAX)}) / uEnvScale);
          L = atmAerial(sea, cameraPosition, hit);
        } else {
          L = atmSkyComposite(dir, false, false);
        }
        gl_FragColor = vec4(min(L * uEnvScale, vec3(${f(HALF_SAFE_MAX)})), 1.0);
      }`;
    this._envSkyMaterial = new THREE.ShaderMaterial({
      name: 'Atmosphere.EnvSky',
      uniforms: Object.assign({}, this.uniforms, { uEnvScale: { value: 1 }, uSeaUp: { value: new THREE.Vector3() }, uEnvWind: U.uWindSpeed }),
      vertexShader: vs, fragmentShader: envFs, side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
    });
    this._envSkyMesh = new THREE.Mesh(geo, this._envSkyMaterial);
    this._envSkyMesh.scale.setScalar(10000);
    this._envSkyMesh.frustumCulled = false;
  }

  // ---------------------------------------------------------------- sun and moon

  _createLights() {
    const q = this.quality;
    const mk = (name, mapSize, radius) => {
      const l = new THREE.DirectionalLight(0xffffff, 0);
      l.name = name;
      l.castShadow = true;
      const s = l.shadow;
      s.mapSize.set(mapSize, mapSize);
      s.camera.left = -SHADOW.halfExtent; s.camera.right = SHADOW.halfExtent;
      s.camera.top = SHADOW.halfExtent; s.camera.bottom = -SHADOW.halfExtent;
      s.camera.near = SHADOW.near; s.camera.far = SHADOW.far;
      s.camera.updateProjectionMatrix();
      // reversed-Z flips the shadow compare, so an acne-fixing bias changes sign (three-r180-api §7)
      s.bias = this.renderer.capabilities.reversedDepthBuffer ? -SHADOW.bias : SHADOW.bias;
      s.normalBias = SHADOW.normalBias; s.radius = radius;
      this.scene.add(l, l.target);
      return l;
    };
    // PCF radius ~4 texels: the 0.53 deg sun gives a ~0.9 m penumbra 100 m from the caster (three-r180-api §7).
    this.sunLight = mk('Atmosphere.Sun', q.shadowMapSize, 4);
    this.moonLight = mk('Atmosphere.Moon', q.shadowMapSize / 2, 3);
    this._moonTOA = [0, 0, 0]; this._moonTOAY = 0;
  }

  _updateSunMoonLight(sun, moon, sunDir, moonDir) {
    const t = [0, 0, 0];
    // Sun at sea level: transmittance along the (refracted) apparent direction x visible disk fraction.
    // Angular radius from the actual Earth-Sun distance (SUN.angularRadiusRad is the 1 AU mean).
    const sunAngR = Math.asin(SUN_RADIUS_KM / (sun.distanceAU * AU_KM));
    const visS = diskVisibility(0.002, sun.elevationDeg * RAD, sunAngR);
    transmittanceToSpace(0.002, Math.max(Math.sin(sun.elevationDeg * RAD), -0.02), t);
    const E = this._sunTOA.map((c, i) => c * t[i] * visS);
    U.uSunIlluminance.value.setRGB(E[0], E[1], E[2], THREE.LinearSRGBColorSpace);
    setLight(this.sunLight, E);

    // Moon above the atmosphere: full-moon illuminance x distance x Allen's phase law.
    const i = moon.phaseAngleDeg;
    const Emoon = FULL_MOON_LX / LOOK.sceneUnitLux * (MOON_MEAN_DISTANCE_KM / moon.distanceKm) ** 2
      * Math.pow(10, -0.4 * (0.026 * i + 4e-9 * i ** 4));
    const tint = MOON_TINT.map((c, k) => c * this._solarWB[k]);
    const tY = lum(...tint);
    this._moonTOA = tint.map((c) => c / tY * Emoon);
    this._moonTOAY = Emoon;
    const visM = diskVisibility(0.002, moon.elevationDeg * RAD, moon.angularRadiusDeg * RAD);
    transmittanceToSpace(0.002, Math.max(Math.sin(moon.elevationDeg * RAD), -0.02), t);
    const Em = this._moonTOA.map((c, k) => c * t[k] * visM);
    U.uMoonIlluminance.value.setRGB(Em[0], Em[1], Em[2], THREE.LinearSRGBColorSpace);
    U.uMoonPhase.value = moon.phase;
    setLight(this.moonLight, Em);

    // Sun disk: centre radiance above the atmosphere (limb-darkening normalised, 1 - u/3 mean).
    const omegaS = Math.PI * sunAngR ** 2;
    const limbMean = [1 - 0.52 / 3, 1 - 0.60 / 3, 1 - 0.72 / 3];
    const sd = this.uniforms.uAtmSunDisk.value;
    sd.set(this._sunTOA[0] / (omegaS * limbMean[0]), this._sunTOA[1] / (omegaS * limbMean[1]), this._sunTOA[2] / (omegaS * limbMean[2]), sunAngR);
    const shape = this.uniforms.uAtmDiskShape.value;
    shape.x = refractionSquash(sun.trueElevationDeg);
    shape.y = refractionSquash(moon.trueElevationDeg);
  }

  _updateNightSky(jd, moon, moonDir, cam) {
    const u = this.uniforms;
    // Sidereal rotation: celestial (equatorial) = M * world.
    const lst = localSiderealTimeDeg(jd, this.clock.lon) * RAD;
    const phi = this.clock.lat * RAD;
    const ct = Math.cos(lst), st = Math.sin(lst), cp = Math.cos(phi), sp = Math.sin(phi);
    U.uStarRotation.value.set(
      -st, ct * cp, ct * sp,
      ct, st * cp, st * sp,
      0, sp, -cp,
    );
    // Moon disk frame: celestial north projected on the disk, and sky west.
    const ncp = this._tmpV.set(0, sp, -cp);
    const n = u.uAtmMoonN.value.copy(ncp).addScaledVector(moonDir, -ncp.dot(moonDir)).normalize();
    const w = u.uAtmMoonW.value.crossVectors(moonDir, n).normalize();
    // Lunar surface radiance scale: disk-integrated radiance = moon illuminance above the atmosphere.
    const angR = moon.angularRadiusDeg * RAD;
    const omegaM = Math.PI * angR * angR;
    const K = this._moonTOAY / (omegaM * Math.max(moonDiskMean(moon.phaseAngleDeg), 1e-6));
    const tY = this._moonTOA;
    u.uAtmMoonDisk.value.set(tY[0] / this._moonTOAY * K, tY[1] / this._moonTOAY * K, tY[2] / this._moonTOAY * K, angR);
    // Earthshine: ~1.5e-4 of the full-moon surface brightness when the Earth is full (new moon).
    const fullL = FULL_MOON_LX / LOOK.sceneUnitLux * (MOON_MEAN_DISTANCE_KM / moon.distanceKm) ** 2 / omegaM;
    const earthFull = (1 - Math.cos(moon.phaseAngleDeg * RAD)) / 2;
    u.uAtmDiskShape.value.z = fullL * 1.5e-4 * earthFull / 0.12;
    u.uAtmDiskShape.value.w = moon.elevationDeg > -2 ? 1 : 0;
    // Stars: skipped while the sun is up (their radiance is 1e-9 of the day sky anyway).
    const starVis = smooth01((1 - this.sunElevationDeg) / 7);
    const st4 = u.uAtmStars.value;
    st4.x = starVis > 0 ? MAG0_LX / LOOK.sceneUnitLux * starVis : 0;
    // PSF: ~0.7 pixel sigma in the view camera.
    const size = this.renderer.getDrawingBufferSize(this._tmpSize).y || 900;
    const vfov = (cam.isPerspectiveCamera ? cam.fov : 45) * RAD;
    st4.y = 0.7 * vfov / size;
    st4.z = MILKY_WAY_CDM2 / LOOK.sceneUnitLux * starVis;
    st4.w = this._time;
  }

  // ---------------------------------------------------------------- shadows

  _updateShadows(sun, moon) {
    const focus = this._shadowFocus;
    const place = (light, dir) => {
      light.position.copy(focus).addScaledVector(dir, 700);
      light.target.position.copy(focus);
      light.target.updateMatrixWorld();
      light.updateMatrixWorld();
    };
    place(this.sunLight, U.uSunDir.value);
    place(this.moonLight, U.uMoonDir.value);
    // Only the light that actually lights the scene re-renders its shadow map.
    const sunOn = sun.elevationDeg > -1;
    const moonOn = !sunOn && moon.elevationDeg > 0 && sun.elevationDeg < -4;
    setShadowUpdates(this.sunLight, sunOn);
    setShadowUpdates(this.moonLight, moonOn);
  }

  // ---------------------------------------------------------------- environment (PMREM of sky + clouds + sea)

  _createEnvironment() {
    const size = this.quality.pmremSize;
    this._envSize = size;
    this._cubeRT = new THREE.WebGLCubeRenderTarget(size, {
      type: THREE.HalfFloatType, generateMipmaps: false, magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter, depthBuffer: false,
    });
    this._cubeCam = new THREE.CubeCamera(1, 20000, this._cubeRT);
    this._envScene = new THREE.Scene();
    this._envScene.add(this._envSkyMesh);
    if (!this._pmrem) { this._pmrem = new THREE.PMREMGenerator(this.renderer); this._pmrem.compileCubemapShader(); }
    this._envRT = null;
    this._envScale = 1;
  }

  _disposeEnvironment() {
    this._cubeRT.dispose();
    if (this._envRT) this._envRT.dispose();
    this._envRT = null;
  }

  _prepareEnvPass(camPos) {
    const scale = this.preExposure;
    this._envScale = scale;
    this._envE = lum(this._ambRow[4], this._ambRow[5], this._ambRow[6]);
    const eu = this._envSkyMaterial.uniforms;
    eu.uEnvScale.value = scale;
    // Upwelling light from the water column (SCENE-SPEC §11.2: pi Rrs x downwelling irradiance).
    const esky = Math.PI;                                              // cosine-weighted mean -> irradiance
    const Es = U.uSunIlluminance.value, sy = Math.max(U.uSunDir.value.y, 0);
    const up = SEA.upwellingReflectance;
    const a = this._ambRow;
    eu.uSeaUp.value.set(
      up[0] * (Es.r * sy + esky * a[4]) / Math.PI,
      up[1] * (Es.g * sy + esky * a[5]) / Math.PI,
      up[2] * (Es.b * sy + esky * a[6]) / Math.PI);
    this._cubeCam.position.set(camPos.x, 30, camPos.z);
    this._cubeCam.updateMatrixWorld();
    this._envSkyMesh.position.copy(this._cubeCam.position);
    this._envSkyMesh.updateMatrixWorld();
  }

  _renderEnvFace(i) {
    const r = this.renderer, cam = this._cubeCam;
    if (cam.coordinateSystem !== r.coordinateSystem) { cam.coordinateSystem = r.coordinateSystem; cam.updateCoordinateSystem(); }
    const prev = r.getRenderTarget(), face = r.getActiveCubeFace(), mip = r.getActiveMipmapLevel();
    r.setRenderTarget(this._cubeRT, i);
    r.render(this._envScene, cam.children[i]);
    r.setRenderTarget(prev, face, mip);
  }

  _finishEnv() {
    if (!this._envRT) this._envRT = this._pmrem.fromCubemap(this._cubeRT.texture);
    else this._pmrem.fromCubemap(this._cubeRT.texture, this._envRT);
    this.scene.environment = this._envRT.texture;
    this._envBakedE = this._envE;
    this._applyEnvIntensity();
  }

  // Between bakes the environment keeps the brightness it was baked with; scale it by the ratio of
  // the current cosine-weighted sky irradiance to the baked one, so a time-lapse dusk never lights
  // the turbines with a sky several times brighter than the one drawn behind them (p1 engineering:
  // 3.3x at 3600x).
  _applyEnvIntensity() {
    const eNow = lum(this._ambRow[4], this._ambRow[5], this._ambRow[6]);
    const eBake = this._envBakedE || 0;
    const k = eBake > 0 && eNow > 0 ? Math.min(4, Math.max(0.25, eNow / eBake)) : 1;
    this.scene.environmentIntensity = k / this._envScale;
  }

  _bakeEnvironmentNow(camPos = U.uCameraPos.value) {
    this._prepareEnvPass(camPos);
    for (let i = 0; i < 6; i++) this._renderEnvFace(i);
    this._finishEnv();
    this._envStep = -1;
  }

  _updateEnvironment(sunDir, moonDir, moon, camPos, force) {
    const le = this._lastEnv;
    const night = this.sunElevationDeg < -6;
    const moved = angleBetweenDeg(le.sun, sunDir) > ENV_ANGLE_DEG
      || (night && moon.elevationDeg > -3 && angleBetweenDeg(le.moon, moonDir) > ENV_ANGLE_DEG)
      || Math.abs(this.cloudCover - le.cover) > 1e-3
      || le.drift.distanceTo(U.uCloudOffset.value) > ENV_CLOUD_DRIFT_M
      || Math.abs(Math.log(this.preExposure / this._envScale)) > Math.log(3);
    const jumped = this.clock.version !== le.version;
    const mark = () => {
      le.sun.copy(sunDir); le.moon.copy(moonDir); le.cover = this.cloudCover;
      le.drift.copy(U.uCloudOffset.value); le.version = this.clock.version;
    };
    // A fast clock (time-lapse) re-bakes in one frame whenever the sun moved: the amortized bake
    // would light the scene with a sky up to 4 deg of sun elevation old at 3600x.
    const fast = this.clock.playing && this.clock.speed >= 600 && this._envStep < 0;
    if (force || jumped || !this._envRT || (fast && moved)) {
      this._bakeEnvironmentNow(camPos);
      mark();
      this._envStart = this._envClock;
      return;
    }
    if (this._envStep >= 0) {
      // Amortized re-bake in progress: one cube face per frame, the PMREM filter on the seventh.
      if (this._envStep < 6) this._renderEnvFace(this._envStep++);
      else { this._finishEnv(); this._envStep = -1; }
      return;
    }
    this._applyEnvIntensity();
    // Throttled on accumulated frame time (the shell's dt), not wall-clock time, so a stepped
    // capture re-bakes at the same frames on every run whatever the machine load.
    if (moved && this._envClock - this._envStart > ENV_MIN_INTERVAL_S) {
      this._envStart = this._envClock;
      this._prepareEnvPass(camPos);
      mark();
      this._renderEnvFace(0);
      this._envStep = 1;
    }
  }

  /**
   * Rebuilds every GPU product that is rendered once or incrementally, after a WebGL context restore
   * (three re-creates the textures empty): the transmittance and multiple-scattering LUTs, the cloud
   * noise and weather maps, the sky-view LUT, ambient table, cloud products and the environment.
   * The shell calls it from its webglcontextrestored handler before restarting the loop.
   */
  restoreGPU() {
    this._buildStaticLUTs();
    this.clouds.restoreGPU();
    this._bakeMilkyWay();
    this.clouds.setCover(this.cloudCover);
    this._readback = { busy: false, pending: null };
    this._envRT = null;                                  // re-created by the next bake
    this._envStep = -1;
    this._lastSky.pre = -1;
    this.update(0, U.uTime.value, this.ctx.camera, { force: true });
  }

  /** Re-bakes the environment immediately (capture scripts: a deterministic IBL at this frame). */
  forceEnvironmentUpdate() { this._bakeEnvironmentNow(U.uCameraPos.value); this._envStep = -1; }

  // ---------------------------------------------------------------- scale registry

  dispose() {
    this._disposed = true;
    this.scene.remove(this.skyMesh, this.cloudOverlay, this.sunLight, this.sunLight.target, this.moonLight, this.moonLight.target);
    this.cloudOverlay.material.dispose();
    this.skyMesh.geometry.dispose();
    this.skyMaterial.dispose(); this._envSkyMaterial.dispose();
    this._skyViewMat.dispose(); this._ambMat.dispose();
    for (const rt of [this.transLUT, this.msLUT, this.skyLUT, this.ambRT[0], this.ambRT[1], this._cloudScreenRT, this.milkyWayRT]) rt.dispose();
    this._starTex.cellTex.dispose(); this._starTex.dataTex.dispose();
    this.clouds.dispose();
    if (this._envRT && this.scene.environment === this._envRT.texture) this.scene.environment = null;
    this._disposeEnvironment();
    this._pmrem.dispose();
    this.sunLight.dispose(); this.moonLight.dispose();
    this._lut.dispose();
  }
}

// The scale report's atmosphere entries and the cover calibration (dev hooks: left out of the hosted
// build). The cloud patch statistics are measured on first use, at CLOUDS.cover.
function registerAtmosphereScales(atm) {
  let ps = null;
  const stats = () => {
    if (ps) return ps;
    const c = atm.clouds.cover;
    atm.clouds.setCover(CLOUDS.cover);
    ps = measureCloudsTopDown(atm.clouds);
    atm.clouds.setCover(c);
    return ps;
  };
  Object.defineProperty(atm, 'cloudPatchStats', { get: stats, configurable: true });
  /** Re-derives clouds.js COVER_TABLE (5 x 10 synchronous read-backs). */
  atm.deriveCoverTable = (covers) => deriveCoverTable(atm.clouds, covers);
  registerScale({
    name: 'clouds.baseAltitude', measure: () => ({ x: 0, y: U.uCloudAltitude.value, z: 0 }),
    expect: { axis: 'y', metres: CLOUDS.baseAltitude, tolerance: 1 }, source: 'SCENE-SPEC §10 (ACY JJA median base)',
  });
  registerScale({
    name: 'clouds.thickness', measure: () => ({ x: 0, y: U.uCloudThickness.value, z: 0 }),
    expect: { axis: 'y', metres: CLOUDS.thickness, tolerance: 1 }, source: 'SCENE-SPEC §10',
  });
  registerScale({
    name: 'clouds.puffDiameter',
    measure: () => { const s = stats(); return { x: s.median, y: 0, z: s.median }; },
    expect: { axis: 'x', metres: 1000, tolerance: 500 },
    source: `median equivalent diameter of the rendered cloud patches >= 300 m (top-down transmittance < 0.5 over one 25.6 km weather tile) at cover ${CLOUDS.cover}. SCENE-SPEC addendum (§17): median projected patch 1000 +- 500 m`,
  });
  registerScale({
    name: 'sun.diameter',
    measure: () => { const d = 2 * Math.tan(atm.uniforms.uAtmSunDisk.value.w) * (atm.sun ? atm.sun.distanceAU : 1) * 1.495978707e11; return { x: d, y: d, z: d }; },
    expect: { axis: 'x', metres: 2 * SUN_RADIUS_KM * 1000, tolerance: 0.01e9 }, source: 'rendered disk angular radius x NOAA Earth-Sun distance (IAU solar radius)',
  });
  registerScale({
    name: 'moon.diameter',
    measure: () => { const d = 2 * Math.tan(atm.uniforms.uAtmMoonDisk.value.w) * (atm.moon ? atm.moon.distanceKm * 1000 : 3.844e8); return { x: d, y: d, z: d }; },
    expect: { axis: 'x', metres: 2 * MOON_RADIUS_KM * 1000, tolerance: 20000 }, source: 'rendered disk angular radius x Meeus distance (topocentric parallax ignored for size)',
  });
}

// ================================================================== small utilities

function smooth01(x) { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); }

function dirFromAzEl(azDeg, elDeg, out) {
  const a = azDeg * RAD, e = elDeg * RAD;
  return out.set(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e));
}

function setLight(light, rgb) {
  const Y = lum(rgb[0], rgb[1], rgb[2]);
  light.intensity = Y;
  if (Y > 0) light.color.setRGB(rgb[0] / Y, rgb[1] / Y, rgb[2] / Y, THREE.LinearSRGBColorSpace);
}

function setShadowUpdates(light, on) {
  const s = light.shadow;
  if (on && !s.autoUpdate) { s.autoUpdate = true; s.needsUpdate = true; }
  else if (!on && s.autoUpdate) { s.autoUpdate = false; }
}

// Apparent vertical flattening of a disk from the refraction gradient (1 = round).
function refractionSquash(trueElDeg) {
  if (trueElDeg > 10) return 1;
  const e = Math.max(trueElDeg, -1.5);
  const d = 0.05;
  const dR = (atmosphericRefractionDeg(e + d) - atmosphericRefractionDeg(e - d)) / (2 * d);
  return Math.min(1, Math.max(0.7, 1 + dR));
}
