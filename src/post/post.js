// Post-processing for the offshore wind scene (owner: shell).
//
// Chain (ARCHITECTURE.md "Decisions after research"; no EffectComposer, every stage is one small
// object with a render() so dev pages can time it):
//   scene      the scene into a HalfFloat HDR target with MSAA samples = quality.msaa (resolved by
//              three; the depth buffer is never resolved or stored: nothing reads it). Under ?depth=
//              reversed the target carries a FloatType depth texture (32-bit reversed-Z).
//   meter      frame metering every METER.every frames: log-average scene luminance over a centre-
//              weighted grid, read back asynchronously (framing response and highlight protection)
//   bloom      energy above a threshold set in exposed units, at half resolution: a prefilter (soft
//              threshold, smooth compression of very bright texels, extended sources held back), then
//              a 4-level downsample / tent-upsample chain whose per-level weights give the glow its
//              shape. Point sources (lamps, glints) bloom; the moon disk, floodlit decks and the sun
//              disk mostly do not. Skipped by day while nothing reaches the threshold.
//   grade      scene-linear grade and tone mapping in one full-screen pass: HDR sanitising, bloom (with
//              the sun's glare, GLARE), 1 px unsharp mask (log luminance; MSAA tiers), night Purkinje shift, contrast
//              pivoted on the metered average (by day), highlight saturation, the tone curve (TONE: by day a
//              luminance knee and a hue-preserving toe and midtones for cool colours; ACES Filmic, the r180
//              RRT/ODT fit, for warm darks, the upper midtones and highlights; at night ACES with the
//              hue-keeping SHOULDER), sRGB
//              encode, black toe on luminance (by day), ±0.5/255 dither. With MSAA this is the only
//              full-resolution pass after the scene, drawn straight to the canvas.
//   fxaa       tiers without MSAA (quality.fxaa, or the legacy quality.smaa flag): grade writes display
//              values to a HalfFloat target and this pass antialiases them (FXAA, no lookup textures:
//              nothing loads through data: URIs under a strict CSP), then toe and dither.
//
// Exposure: the camera exposes for the sky, like a photographer's manual exposure. The anchor is the
// clear sky at 10°–12.6° above the horizon in the view azimuth (the atmosphere publishes the
// exposure that puts it on the photo's exposed values as `exposureTargetPhotoFit`; the sky luminance
// there is L_s = √(0.68 · 0.53) / exposureTargetPhotoFit). The exposed value that sky is given is an
// adaptation curve X(L_s) (ADAPT): the photo's 0.60 in daylight, falling through dusk (so sunset is
// rendered darker and more saturated than noon instead of being metered up to a pastel daylight),
// and as L_s^0.33 at night (partial adaptation: a full moon reads blue-grey, a moonless night dark
// but readable, and the two differ). exposure = X(L_s) / L_s. Because the anchor is computed for
// the current frame it has no read-back latency (a 3600× time-lapse no longer trails the light by
// 1–2 stops) and it ignores flashing lamps and framing.
// By day (sun above 2°–10°) the frame meter adds a mild framing response: 35 % of its deviation
// from the anchor, capped at ±0.5 EV (a sea-filled frame no longer meters up to a swimming-pool
// blue, a square frame no longer over-exposes). Highlight protection keeps the brightest share of
// the frame at or under 2.0 exposed by day, 1.4 around sunset and 0.9 at night (floodlit paint and
// casino crowns keep their colour; see HIGHLIGHT). Only this metered part (framing, protection) is
// smoothed, in log space (1.5 s time constant; shorter while the clock runs fast).
// Without an atmosphere (dev stubs) the metered frame drives the exposure (key of Krawczyk et al.
// 2005 with a steeper dusk), clamped to [dayExposure / 16, dayExposure × LOOK.nightExposureMaxGain].
// The anchor rule is not clipped by that night cap: its own target is bounded by the darkest sky.
import * as THREE from 'three';
import { U } from '../shared.js';
import { LOOK } from '../config.js';

const smoothstep = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const mix = (a, b, t) => a + (b - a) * t;
const f1 = (v) => v.toFixed(1), f3 = (v) => v.toFixed(3);

// Auto-exposure time constant (ARCHITECTURE decisions: "≈1.5 s") at up to 60× clock speed. Faster
// clocks shorten it in proportion (3600×: 25 ms), so a sped-up dusk stays exposed the way a
// ramped time-lapse is, instead of lagging an hour of sim time behind the light.
const EXPOSURE_TAU_S = 1.5;
const EXPOSURE_TAU_REF_SPEED = 60;
// Largest finite half-float is 65504; anything brighter was written as Inf. Values are clamped a
// little below that before tone mapping so ACES never sees Inf (Inf/Inf = NaN in its fit).
const HDR_MAX = 6.0e4;
// Day exposure (the reference for the clamps below) when the atmosphere does not publish
// `dayExposure`, and the stand-in when there is no atmosphere at all: the drone reference view's
// exposure at the default time (the atmosphere's exposureTargetPhotoFit there, SCENE-SPEC §12.2).
const DAY_EXPOSURE_FALLBACK = 3.21;
// Lowest exposure relative to the day value (guards against a bad target, e.g. staring at the sun).
const MIN_EXPOSURE_FRACTION = 1 / 16;

// ---------------------------------------------------------------------------- the sky anchor
// Exposed luminance the photo gives its clear sky at 10° and 12.6° (SCENE-SPEC §12.2), geometric
// mean: the value X the adaptation curve returns in daylight.
const SKY_ANCHOR_EXPOSED = Math.sqrt(LOOK.exposedTargets.sky10 * LOOK.exposedTargets.skyTop);   // 0.600
// Adaptation curve X(L) for the anchor sky luminance L in cd/m² (ESTIMATED look, fitted to the
// critics' targets, shots p1fix-shell-*): log-log linear between knots [L, X]; flat above the first
// (the photo's daylight look); X ∝ L^nightSlope below the last (partial adaptation). Knots: daylight
// 0.60 down to 3000 cd/m²; the dusk falls steeply to 0.103 at 1 cd/m² (sunset −1.2 EV against a
// metered camera, so it is darker and more saturated than noon instead of a pastel), blue hour and
// nautical twilight more slowly to 0.057 at 6e-3 cd/m² (a full-moon sky); night as L^0.33
// (quarter moon ≈ 0.035, moonless 21.7 mag/arcsec² sky ≈ 0.021).
const ADAPT = { knots: [[3000, SKY_ANCHOR_EXPOSED], [1.0, 0.103], [6e-3, 0.057]], nightSlope: 0.33 };
function anchorExposed(Lcd) {
  const K = ADAPT.knots;
  if (Lcd >= K[0][0]) return K[0][1];
  for (let i = 1; i < K.length; i++) {
    if (Lcd >= K[i][0]) {
      const f = Math.log(Lcd / K[i][0]) / Math.log(K[i - 1][0] / K[i][0]);
      return K[i][1] * Math.pow(K[i - 1][1] / K[i][1], f);
    }
  }
  const [Ln, Xn] = K[K.length - 1];
  return Xn * Math.pow(Math.max(Lcd, 1e-9) / Ln, ADAPT.nightSlope);
}
// Daytime framing response (see the header): share of the metered deviation, cap in EV, and the sun
// elevations (deg) over which it fades in.
const FRAMING = { weight: 0.35, maxEV: 0.5, sunElFrom: 2, sunElTo: 10 };

// ---------------------------------------------------------------------------- the frame meter
// The frame is divided into cols × rows cells; each cell's value is the mean log2 luminance of 4 × 4
// bilinear taps (and the brightest tap), and the frame value is their weighted mean with a mild
// centre weighting (weight 1 + centre × Gaussian of width sigma, in frame units), like a camera's
// centre-weighted average metering. Only the central refAspect band of the frame is metered (a
// square or portrait frame meters what a 3:2 frame of the same width shows). Each cell is clamped
// to at most cellClampLog2 above the median cell before averaging, so a few lamps cannot swing a dark
// frame's average with every flash. Read back every `every` frames (15 Hz at 60 fps: the metered
// part is smoothed over 1.5 s anyway), one read in flight at a time.
const METER = { cols: 48, rows: 27, centre: 1.5, sigma: 0.25, floorY: 1e-12, every: 4, refAspect: 1.5, cellClampLog2: 4 };
// Highlight protection: the exposure never puts the brightest `share` of the frame (by metering
// weight) above `exposed` (ACES displays 2.0 at ~242/255, 1.4 at ~232, 0.9 at ~212). Day values:
// a log-average alone is ruled by the darkest large areas; this keeps a low sun's glitter and a
// floodlit TP out of white. Around sunset the brightest sky stays below the ACES shoulder; at night
// a small floodlit subject (a TP from the CTV, a casino crown in a telephoto view) keeps its colour.
// At night the level is the maximum over the last holdS seconds, so a flashing lamp cannot pump it.
const HIGHLIGHT = { share: 0.10, exposed: 2.0, duskExposed: 1.4, nightShare: 0.03, nightExposed: 0.9, smallMaxEV: 1.5, holdS: 2.6 };
// Metered target (framing response, and the whole rule without an atmosphere): METER_CALIBRATION ×
// key(L̄) / Ȳ, with the key of the metered frame against its log-average L̄ in cd/m²: 0.67 in
// daylight, 0.20 at civil twilight (14 cd/m²), steeper than Krawczyk et al. 2005's 1.03 − 2 /
// (2 + log10(L + 1)), which metered dusk almost like day; METER_KEY_NIGHT below that.
const METER_KEY_NIGHT = 0.03;
function meterKey(Lcd) { return clamp(0.20 + 0.20 * Math.log10(Math.max(Lcd, 1e-12) / 14), METER_KEY_NIGHT, 0.67); }
// Calibration (DERIVED, index.html, polarizer 0.7, all modules as of 2026-09-30 16:10): at the drone
// reference view and the default time the metered target came out 2.541 against the sky anchor's
// 2.590, so the framing response is neutral there: 0.584 × 2.590 / 2.541 = 0.595. Re-derive it the
// same way (post.diagnostics.metered = post.diagnostics.anchor in that view) when the sea or the sky
// changes; a 20 % error moves every view by only 6 % (FRAMING.weight).
// Re-derived after polish round 2 (p2 integration: the anchor now sees the sky through the polarizer,
// new clouds and sea): metered / anchor came out 1.074 in the 3:2 reference frame (760 × 506) and 1.043
// at 16:9 (1600 × 900) at 17:15, so 0.595 / 1.058 (their geometric mean) = 0.56.
const METER_CALIBRATION = 0.56;

// ---------------------------------------------------------------------------- grade
// contrast: contrast pivoted on the frame's exposed log-average, applied to luminance only (hue
// kept): c *= (Y / Ȳ)^contrast below the pivot, by day, faded out when highlight protection sets the
// exposure (a backlit frame is already compressed) and at night. SCENE-SPEC §12.3 / photo critic p1:
// the reference photo's luma spread is 1.7× the render's at the same exposure.
// contrastHi: the same above the pivot, for near-neutral colours only (clouds, white paint): pushed
// further up, a saturated highlight (the lit RAL 1023 TP) would only bleach on the ACES shoulder.
// highlightSat: extra saturation for exposed luminance 0.5–2.0 (SCENE-SPEC §12.2 allows it; it keeps
// the lit RAL 1023 TP lemon instead of ACES cream without moving the sky, tower or sea).
// toe: black toe (SCENE-SPEC §12.3) subtracted from display-linear LUMINANCE, every channel scaled by the
// same factor (hue and saturation kept; lead ruling after round 3: the per-channel toe crushed red first
// and turned the near sea saturated blue, POLISH-3 §6.2). By day only: at night it would erase a correctly
// exposed moonless sky and the moonlit sea. LOOK.blackToe with the sun below toeSunDeg[0]; `toe` (1.5 ×
// LOOK.blackToe, the near-field lever of the round-3 ruling, ESTIMATED) above toeSunDeg[1], ramped in
// between, so dawn, 07:00 (sun 14.9°: backlit towers already read dark navy, judge 2) and dusk keep their
// shadows. Drone 760 × 506 at 16:30, near-field median / p90/p10 / luma p1 (photo 0.047 / 18.2 / 11.8):
// - round-3 sea (s5 replica of this pass), toe 0.003 / 0.006 / 0.009 / 0.012: 0.056 / 0.053 / 0.050 / 0.048,
//   5.1 / 5.7 / 6.6 / 7.7;
// - with round 4's ocean and weather (live tree 19:25, post.look.toe), toe 0 / 0.003 / 0.006 / 0.009:
//   0.039 / 0.036 / 0.033 / 0.030, 10.3 / 13.2 / 19.2 / 34.6, p1 27 / 22 / 16 / 8.
// Round-4 verifier re-fit on the final ocean + weather (POLISH-4 §2.1), toe 0.003 / 0.0045 / 0.006: median
// 0.036 / 0.034 / 0.033, p90/p10 13.2 / 15.7 / 19.2, near-field luma p1 10.3 / 5.7 / 0.8 (photo 3.3), lower
// third p90/p10 8.6 / 9.2 / 9.9 (13.1). 0.0045 is the best joint fit; 0.006 crushed the troughs to black.
// sharpen: 1 px unsharp mask of LOOK.sharpen (photo-look §9: ~5 % halos, 1 px wide), applied to log
// luminance before tone mapping. For a display curve d ∝ Y^(1/γ), d + k (d − d̄) ≈ Y · (Y / Ȳ_geo)^k,
// so the same k gives the display-space mask's overshoot at a fraction of the cost (no second pass).
// The factor is clamped to ±20 % so a lamp against the night sky gets no dark ring.
const GRADE = { contrast: 0.25, contrastHi: 0.10, highlightSat: 0.30, toe: 1.5 * LOOK.blackToe, toeSunDeg: [10, 25], sharpen: LOOK.sharpen };
// Tone curve by day (lead ruling after round 3: hue-preserving, no olive TP in shade, recalibrated to the
// photo; jury: AgX / PBR-Neutral-style handling of chroma). Three parts, all weighted by the day factor
// (1 − the night factor), so night frames keep ACES + SHOULDER exactly:
// - hp: below exposed luminance hp[0] a cool colour (blue above red) keeps its own ratios and only its
//   luminance goes through the ACES grey curve (a channel that would leave the display is pulled toward
//   grey at constant luminance); ACES above hp[1], smoothly blended between. ACES's per-channel toe expands
//   saturation in the darks by crushing the weakest channel: the near sea (exposed 0.032, 0.067, 0.132)
//   showed as cobalt (26, 59, 97) where the photo has neutral navy (42, 63, 78); hue-preserving it is
//   (39, 59, 83). Warm colours keep ACES's toe: the same rule turned the deck view's shaded RAL 1023 greyer
//   (HSV saturation 0.80 → 0.57, blue 13 → 24), and the photo's shaded TP is strongly saturated (0.81).
//   Their hue is the scene's either way (exposed R/G 1.08 on the deck view's shaded TP, 56°, before any
//   curve: the olive is in the lighting, not the tone map). Above ~0.45 ACES is what the photo shows: the
//   clear sky at 10–12.6° (exposed blue 1.4–1.6) and the lit TP (the photo's lit TP keeps blue 118–134,
//   x 353–357 at rows 320–336; ACES gives 124–126 on ours; a hue-preserving map pulled to grey gives
//   cream, (255, 226, 191)). Grey is identical either way, so the sky anchor and the horizon band do not
//   move. DERIVED from the round-3 frames read back as HDR (HDR probes and a replica of the grade).
// - knee: by day, luminance above `knee` (exposed) is compressed, hue kept, before both curves:
//   y' = knee + (y − knee) / (1 + (y − knee) / (acesWhite − knee)), slope 1 at the knee and reaching the ACES
//   white point (`acesWhite`, where the r180 fit reaches 1.0) only as y → ∞. Sunlit clouds and the aureole
//   toward the sun (exposed 4–30) keep 249–254 instead of flat 251–255; everything the photo calibrates
//   (≤ 2 exposed: sky, horizon band, TP, cloud tops) is untouched, the lit tower (exposed ~3) moves < 1
//   level, and the sun disk still reaches white (exposed 100 shows as 254.7). ESTIMATED look.
const TONE = { hp: [0.08, 0.45], knee: 2.0, acesWhite: 15.4 };
// Sun glare (jury: "a real camera blows the sun into a large glare with veiling flare"). The bloom chain
// is the lens's point-spread function: by day the sun disk is held back far less than other highlights, so
// a share of its light spreads over the chain's five levels (σ ≈ 2 px to ≈ 2° at the drone's 31.4° fov): a
// brighter, larger core and a veil that fades over a few degrees. In the bloom prefilter each texel above
// `minExposed` keeps the compression constant k = max(K, (peak − minExposed) · share) instead of K (day
// 48, BLOOM.compressDay), i.e. about share / (1 + share) of the sun's light, and skips the extended-source
// hold-back (the disk spans the hold-back taps at 1920 px). Glints (≤ ~200 exposed), lamps and the moon are
// below minExposed and unchanged; with the sun below the horizon share is 0 (a blue-hour L-864 core reaches
// ~15,000 exposed). Only where the sun is visible: blades, clouds and the horizon hide it. Tiers without
// bloom (Low) show the plain disk. At 05:45 (drone view) 460 pixels within 40 px of the sun reach 250+ (95
// before). ESTIMATED look (shots/s5-g-dawn-sheet.png: share 0, 0.3, 1, 3).
const GLARE = { share: 2.0, minExposed: 1000 };
// Night highlight shoulder (vessels/verifier p2: lit facades, casino signs and the CTV's saloon windows
// clipped to flat cream). The night exposure follows the sky, so a lit window (≈ 8 cd/m²) lands 4–7
// stops above white, where ACES's per-channel curve saturates every channel and the colour is gone.
// Above exposed 1.0 in the brightest channel (ACES shows grey 1.0 as 226) the display value is blended
// toward a hue-preserving mapping: the colour's own ratios scaled by the ACES grey curve of that channel.
// The blend fades in from `ramp[0]` to `ramp[1]` stops over 1.0 (a highlight a stop or so over keeps the
// ACES look of the rest of the scene, e.g. the floodlit TP from the CTV deck; a floodlit deck 3 stops
// over and lit windows and signs 5–6 stops over get their colour) and out again from `white[0]` to
// `white[1]` stops, so the hottest sources (lamp lenses and cores, ≥ 8 stops: floods, navigation lights,
// L-864s, the moon) still bleach to white as a camera shows them. Weight `strength` × the night factor:
// zero by day. Measured levels (exposed max channel, s3 probes): windows and casino signs 27–47 at 23:30,
// the floodlit CTV deck 7–27, its saloon windows 1.5–3, the floodlit TP from the CTV 1.2–3.3, CTV flood
// lenses 400–1000, sidelight cores 700, L-864 cores 2.5e5. ESTIMATED look.
const SHOULDER = { strength: 0.85, ramp: [1.0, 3.5], white: [6.5, 9.5] };

// Bloom, in exposed units (scene radiance × exposure). LOOK.bloomThresholdRule asks for a
// threshold ≥ 2 × Y(L_horizon) × exposure = 2 × LOOK.horizonExposedY = 2.86; only the energy
// above it blooms (soft knee, not a hard gate). compress*: each texel is compressed as
// c × K / (K + peak) before blurring (K by day holds HDR sun glints; at night K = 500 caps every lamp
// core alike, so the aviation lights read as points with a tight glow, not discs: round 4, the jury's
// "nacelle beacons render as big glowing discs" and the farm's test, fix4-farm §3, hero L-864 glow at 23:30
// 442 → 166 px; 5000 before). weights*: the share of each level of the
// chain (half resolution down to 1/32) in the glow, by day and at night; the night set keeps the glow
// close to the lamp (veiling glare is a few % of the source, not a halo the size of a disc; the lamps
// draw their own halo sprites, farm.js): wide levels would lay a red veil over the horizon from the
// 400 flashing lamps. Same shape as round 1's UnrealBloomPass settings (its lerpBloomFactor at radius
// 0.4 by day, 0 at night). strength*: the glow's gain, equal to what round 1 delivered: its additive
// blend multiplied the composite by the composite's own alpha (strength × Σ weights), so 0.06 by day
// and 0.08 at night acted as 0.06² × 4.2 = 0.0151 and 0.08² × 1.55 = 0.0099; the chain here is a little
// tighter than its Gaussians, and 0.0138 / 0.0090 give the same glow energy on screen (bloomE probe:
// 22:30 drone view, display-linear energy 1616 against 1613). ESTIMATED looks (night
// critic p1, shots p1fix-shell-night-*).
const BLOOM = {
  thresholdExposed: 2 * LOOK.horizonExposedY,
  kneeExposed: 1.0,
  compressDay: 48,
  compressNight: 500,
  strengthDay: 0.0138, strengthNight: 0.0090,
  weightsDay: [1.08, 0.96, 0.84, 0.72, 0.60],
  weightsNight: [1.0, 0.4, 0.12, 0.03, 0.0],
  // Extended-source hold-back: the share of 8 taps at extendedRadiusPx (full-resolution pixels) at
  // least a quarter as bright as the texel; a texel inside a bright area (moon disk, floodlit deck)
  // keeps only extendedKeep of its bloom.
  extendedRadiusPx: 4, extendedKeep: 0.08,
};
const BLOOM_LEVELS = BLOOM.weightsDay.length;

// Night vision (ESTIMATED look parameters). By the scene's absolute luminance: photopic above
// ~3 cd/m² (colour as is), mesopic below, scotopic below ~0.003 cd/m² (a moonless sky, 2e-4 cd/m²,
// or the sea under it), where colour fades toward a blue-shifted grey; lamps and their bright
// reflections stay photopic and keep their colour (so does anything the exposure makes bright on
// screen: a dim red glow mixed with rod grey reads pink, not dark red). The rods' own luminance is the
// scotopic one (Larson, Rushmeier & Piatko 1997, Ys = Y (1.33 (1 + (Y + Z) / X) - 1.68), evaluated for
// the sRGB primaries and normalised to white): red light barely registers, so the dim glow around a
// red aviation lamp and the faint red wash its reflections lay on the sea go dark instead of pink
// (the Purkinje shift).
const PURKINJE = { strength: 0.85, photopicLog10Cd: 0.5, scotopicLog10Cd: -2.5, brightExposed: [0.02, 0.5], tint: [0.72, 0.94, 1.45], scotopic: [0.033, 0.765, 0.202] };

// ---------------------------------------------------------------------------- shaders
// Every pass is one full-screen triangle (no vertex-shader matrices).
const VERTEX = /* glsl */`
varying vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

// NaN / Inf tests on the bit pattern. ANGLE's Metal backend compiles any shader that calls isnan()
// or isinf() with fast math disabled (see atmosphere.js atmHasNaN); integer tests stay exact.
const FLOAT_BITS = /* glsl */`
bool nanBits(float x) { return (floatBitsToUint(x) & 0x7fffffffu) > 0x7f800000u; }
bool anyNaNBits(vec3 v) { return any(greaterThan(floatBitsToUint(v) & 0x7fffffffu, uvec3(0x7f800000u))); }
vec3 sanitise(vec3 c) { return anyNaNBits(c) ? vec3(0.0) : min(c, ${f1(HDR_MAX)}); }`;

// Display finish, in display (sRGB-encoded) values: black toe on display-linear luminance keeping the
// white point and the colour's ratios (GRADE.toe), then triangular dither ±uDither against 8-bit banding
// in the sky.
const FINISH = /* glsl */`
uniform float uToe, uDither, uFrame;
float hash(vec3 p) {
	p = fract(p * vec3(0.1031, 0.1030, 0.0973));
	p += dot(p, p.yxz + 33.33);
	return fract((p.x + p.y) * p.z);
}
vec3 finish(vec3 c) {
	if (uToe > 0.0) {
		vec3 l = sRGBTransferEOTF(vec4(c, 1.0)).rgb;
		float y = max(luminance(l), 1e-8);
		c = sRGBTransferOETF(vec4(l * (max(y - uToe, 0.0) / ((1.0 - uToe) * y)), 1.0)).rgb;
	}
	vec3 q = vec3(gl_FragCoord.xy, uFrame);
	return c + (hash(q) - hash(q + 17.13)) * uDither;
}`;

// Grade + tone map. Input: the scene HDR buffer (radiance × preExposure) and the half-resolution
// bloom (same units). Output: display sRGB (finished unless FXAA follows).
const GRADE_FRAGMENT = /* glsl */`
${FLOAT_BITS}
${FINISH}
uniform sampler2D tScene, tBloom;
uniform vec2 uTexel;
uniform float uBloom, uSharpen, uExposure, uPurkinje, uBufferToCd, uHighlightSat, uContrast, uContrastHi, uPivot, uShoulder, uDay;
varying vec2 vUv;
const vec3 SCOTOPIC_TINT = vec3(${PURKINJE.tint.map(f3).join(', ')});
const vec3 SCOTOPIC_W = vec3(${PURKINJE.scotopic.map(f3).join(', ')});
// three.js r180 ACESFilmicToneMapping (tonemapping_pars_fragment) at toneMappingExposure 1. Both of its
// matrices map grey to grey, so acesRRT alone is its curve for a grey input.
vec3 acesRRT(vec3 v) { return (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.4329510) + 0.238081); }
vec3 aces(vec3 color) {
	const mat3 ACESInputMat = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
	const mat3 ACESOutputMat = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
	return clamp(ACESOutputMat * acesRRT(ACESInputMat * (color / 0.6)), 0.0, 1.0);
}
float grey(float x) { return min(acesRRT(vec3(x / 0.6)).x, 1.0); }
// TONE by day (weight uDay): the knee, then the hue-preserving toe and midtones blended
// into ACES; at night the SHOULDER: t = stops of the brightest channel over exposed 1.0.
vec3 toneMap(vec3 c) {
	float y = luminance(c), t = max(y - ${f1(TONE.knee)}, 0.0), m;
	// the knee, y' / y = 1 − d² / ((d + acesWhite − knee) y) with d = y − knee
	t = 1.0 - uDay * t * t / ((t + ${f1(TONE.acesWhite - TONE.knee)}) * max(y, 1e-8));
	c *= t; y *= t;
	t = grey(y);
	vec3 a = aces(c), h = c * (t / max(y, 1e-8));
	m = max(h.r, max(h.g, h.b));
	if (m > 1.0) h = t + (h - t) * ((1.0 - t) / (m - t));
	a = mix(a, h, uDay * (1.0 - smoothstep(${TONE.hp.map(f3).join(', ')}, y)) * clamp((c.b - c.r) / (c.b + c.r + 1e-8) * 5.0 + 0.5, 0.0, 1.0));
	m = max(c.r, max(c.g, c.b));
	t = log2(max(m, 1e-8));
	t = uShoulder * smoothstep(${SHOULDER.ramp.map(f1).join(', ')}, t) * (1.0 - smoothstep(${SHOULDER.white.map(f1).join(', ')}, t));
	return t > 0.0 ? mix(a, c * (grey(m) / m), t) : a;
}
float logLum(vec2 uv) { return log2(max(luminance(sanitise(texture2D(tScene, uv).rgb)), 1e-12)); }
void main() {
	vec3 c = sanitise(texture2D(tScene, vUv).rgb);
	if (uSharpen > 0.0) {
		float n = logLum(vUv + vec2(uTexel.x, 0.0)) + logLum(vUv - vec2(uTexel.x, 0.0))
		        + logLum(vUv + vec2(0.0, uTexel.y)) + logLum(vUv - vec2(0.0, uTexel.y));
		c *= clamp(exp2(uSharpen * (log2(max(luminance(c), 1e-12)) - 0.25 * n)), 0.8, 1.2);
	}
	if (uBloom > 0.0) c += uBloom * texture2D(tBloom, vUv).rgb;
	// Purkinje shift by absolute luminance: blend toward the rods' blue-tinted grey, except where the
	// frame is bright on screen.
	float y0 = luminance(c);
	float lcd = log2(max(y0 * uBufferToCd, 1e-12)) * 0.30103;
	float rod = uPurkinje * (1.0 - smoothstep(${PURKINJE.scotopicLog10Cd.toFixed(2)}, ${PURKINJE.photopicLog10Cd.toFixed(2)}, lcd))
	          * (1.0 - smoothstep(${f3(PURKINJE.brightExposed[0])}, ${f3(PURKINJE.brightExposed[1])}, y0 * uExposure));
	c = mix(c, dot(c, SCOTOPIC_W) * SCOTOPIC_TINT / luminance(SCOTOPIC_TINT), rod);
	c *= uExposure;                                                   // exposed
	float y = luminance(c);
	// Contrast pivoted on the frame's exposed log-average, on luminance (hue kept).
	if ((uContrast != 0.0 || uContrastHi != 0.0) && y > 0.0) {
		float mx = max(c.r, max(c.g, c.b)), sat = (mx - min(c.r, min(c.g, c.b))) / max(mx, 1e-8);
		float k = pow(y / uPivot, y < uPivot ? uContrast : uContrastHi * (1.0 - smoothstep(0.3, 0.8, sat)));
		c *= k; y *= k;
	}
	// Highlight saturation (SCENE-SPEC §12.2), exposed luminance 0.5–2.0.
	c = max(mix(vec3(y), c, 1.0 + uHighlightSat * smoothstep(0.5, 2.0, y)), 0.0);
	c = sRGBTransferOETF(vec4(toneMap(c), 1.0)).rgb;
	#ifdef FINISH_HERE
	c = finish(c);
	#endif
	gl_FragColor = vec4(c, 1.0);
}`;

// FXAA (after Lottes' FXAA 3.11 "console" variant): luma from the display values, one blend
// direction from the 2 × 2 corner gradient, two or four taps along it; then the display finish.
const FXAA_FRAGMENT = /* glsl */`
${FINISH}
uniform sampler2D tDiffuse;
uniform vec2 uTexel;
varying vec2 vUv;
float lumaAt(vec2 uv) { return luminance(texture2D(tDiffuse, uv).rgb); }
void main() {
	vec3 rgbM = texture2D(tDiffuse, vUv).rgb;
	float lM = luminance(rgbM);
	float lNW = lumaAt(vUv + vec2(-1.0, -1.0) * uTexel), lNE = lumaAt(vUv + vec2(1.0, -1.0) * uTexel);
	float lSW = lumaAt(vUv + vec2(-1.0, 1.0) * uTexel), lSE = lumaAt(vUv + vec2(1.0, 1.0) * uTexel);
	float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE))), lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
	vec2 dir = vec2((lSW + lSE) - (lNW + lNE), (lNW + lSW) - (lNE + lSE));
	float reduce = max((lNW + lNE + lSW + lSE) * 0.03125, 1.0 / 128.0);
	dir = clamp(dir / (min(abs(dir.x), abs(dir.y)) + reduce), -8.0, 8.0) * uTexel;
	vec3 a = 0.5 * (texture2D(tDiffuse, vUv - dir / 6.0).rgb + texture2D(tDiffuse, vUv + dir / 6.0).rgb);
	vec3 b = 0.5 * a + 0.25 * (texture2D(tDiffuse, vUv - 0.5 * dir).rgb + texture2D(tDiffuse, vUv + 0.5 * dir).rgb);
	float lB = luminance(b);
	vec3 c = lMax - lMin < max(0.0312, 0.125 * lMax) ? rgbM : (lB < lMin || lB > lMax ? a : b);
	gl_FragColor = vec4(finish(c), 1.0);
}`;

// Bloom prefilter, full resolution in, half resolution out: the part of each texel above threshold,
// compressed and held back inside extended bright areas.
const BLOOM_PREFILTER = /* glsl */`
${FLOAT_BITS}
uniform sampler2D tDiffuse;
uniform float uThreshold, uKnee, uK, uSun, uSunMin;
uniform vec2 uTexel;
varying vec2 vUv;
float lumAt(vec2 uv) { return luminance(sanitise(texture2D(tDiffuse, uv).rgb)); }
void main() {
	vec3 c = sanitise(texture2D(tDiffuse, vUv).rgb);                // half-float overflow (sun disk): HDR_MAX
	float peak = max(c.r, max(c.g, c.b)), k = max(uK, (peak - uSunMin) * uSun);   // GLARE: the sun keeps more
	c *= k / (k + peak);                                           // smooth compression, hue kept
	float y = luminance(c);
	float over = max(y - uThreshold, 0.0);
	float gain = over * over / (over + uKnee) / max(y, 1e-8);    // quadratic knee, then linear
	if (gain > 0.0 && k == uK) {
		float y0 = lumAt(vUv) * 0.25, n = 0.0;
		vec2 r = uTexel * ${f1(BLOOM.extendedRadiusPx)}, d = 0.7071 * r;
		n += step(y0, lumAt(vUv + vec2(r.x, 0.0))) + step(y0, lumAt(vUv - vec2(r.x, 0.0)));
		n += step(y0, lumAt(vUv + vec2(0.0, r.y))) + step(y0, lumAt(vUv - vec2(0.0, r.y)));
		n += step(y0, lumAt(vUv + d)) + step(y0, lumAt(vUv - d));
		n += step(y0, lumAt(vUv + vec2(d.x, - d.y))) + step(y0, lumAt(vUv - vec2(d.x, - d.y)));
		gain *= mix(1.0, ${f3(BLOOM.extendedKeep)}, smoothstep(0.35, 0.95, n / 8.0));
	}
	gl_FragColor = vec4(c * gain, 1.0);
}`;
// Downsample by 2: centre plus four diagonal taps half a source texel out (dual filter, Martin 2015).
const BLOOM_DOWN = /* glsl */`
uniform sampler2D tDiffuse;
uniform vec2 uTexel;
varying vec2 vUv;
void main() {
	vec2 h = 0.5 * uTexel;
	gl_FragColor = vec4((4.0 * texture2D(tDiffuse, vUv).rgb
		+ texture2D(tDiffuse, vUv - h).rgb + texture2D(tDiffuse, vUv + h).rgb
		+ texture2D(tDiffuse, vUv + vec2(h.x, - h.y)).rgb + texture2D(tDiffuse, vUv - vec2(h.x, - h.y)).rgb) / 8.0, 1.0);
}`;
// Upsample by 2 with a tent (dual filter) and add this level blurred at its own resolution (3 × 3
// bilinear taps 1.5 texels apart: σ ≈ 1.1 texel, like each level's Gaussian in round 1's
// UnrealBloomPass): out = wLow · tent(low) + wCur · blur(cur).
const BLOOM_UP = /* glsl */`
uniform sampler2D tDiffuse, tCur;
uniform vec2 uTexel, uTexelCur;
uniform float uLow, uCur;
varying vec2 vUv;
vec3 tap(float x, float y) { return texture2D(tDiffuse, vUv + vec2(x, y) * uTexel).rgb; }
void main() {
	vec3 t = tap(-1.0, 0.0) + tap(1.0, 0.0) + tap(0.0, -1.0) + tap(0.0, 1.0)
	       + 2.0 * (tap(-0.5, -0.5) + tap(0.5, -0.5) + tap(-0.5, 0.5) + tap(0.5, 0.5));
	vec3 b = vec3(0.0);
	for (int j = -1; j <= 1; j ++) for (int i = -1; i <= 1; i ++)
		b += (i == 0 ? 2.0 : 1.0) * (j == 0 ? 2.0 : 1.0) * texture2D(tCur, vUv + 1.5 * vec2(float(i), float(j)) * uTexelCur).rgb;
	gl_FragColor = vec4(uLow * t / 12.0 + uCur * b / 16.0, 1.0);
}`;

// Metering: 4 × 4 taps per cell; R: mean log2 luminance (absolute scene units), G: the brightest tap,
// B: the third-brightest tap (an extended highlight, a lit facade or a floodlit deck, fills several
// taps; a point lamp only one).
const METER_FRAGMENT = /* glsl */`
${FLOAT_BITS}
uniform sampler2D tDiffuse;
uniform float uInvPre;
uniform vec2 uCell;
varying vec2 vUv;
void main() {
	vec2 corner = vUv - 0.5 * uCell;
	float acc = 0.0, h1 = -1e9, h2 = -1e9, h3 = -1e9;
	for (int j = 0; j < 4; j ++) for (int i = 0; i < 4; i ++) {
		float y = luminance(texture2D(tDiffuse, corner + (vec2(float(i), float(j)) + 0.5) * 0.25 * uCell).rgb);
		// NaN counts as black, Inf (half-float overflow: a sun disk) as the brightest finite value
		y = nanBits(y) ? 0.0 : min(y, ${f1(HDR_MAX)});
		float l = log2(max(y * uInvPre, ${METER.floorY.toExponential(1)}));
		acc += l;
		if (l > h1) { h3 = h2; h2 = h1; h1 = l; } else if (l > h2) { h3 = h2; h2 = l; } else if (l > h3) h3 = l;
	}
	gl_FragColor = vec4(acc / 16.0, h1, h3, 1.0);
}`;

// ---------------------------------------------------------------------------- plumbing
const TRIANGLE = new THREE.BufferGeometry();
TRIANGLE.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
const ORTHO = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

function shader(name, fragmentShader, uniforms, defines = {}) {
  return new THREE.ShaderMaterial({
    name, defines, uniforms, vertexShader: VERTEX, fragmentShader,
    depthTest: false, depthWrite: false, toneMapped: false,
  });
}
// A full-screen pass: its material drawn into `target` (null = the canvas).
class Quad {
  constructor(material) {
    this.material = material;
    this.u = material.uniforms;
    this.mesh = new THREE.Mesh(TRIANGLE, material);
    this.mesh.frustumCulled = false;
  }
  draw(renderer, target) {
    renderer.setRenderTarget(target);
    renderer.render(this.mesh, ORTHO);
  }
  dispose() { this.material.dispose(); }
}
const hdrTarget = (w = 1, h = 1, opts = {}) => new THREE.WebGLRenderTarget(w, h, {
  type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, ...opts,
});

// ---------------------------------------------------------------------------- stages
// The scene into its HDR target. MSAA comes from the target's samples; the depth buffer is
// neither resolved nor stored (nothing samples it), which also spares the tile store on Apple GPUs.
class ScenePass {
  constructor(scene, camera, renderer) {
    this.scene = scene;
    this.camera = camera;
    this.reversed = globalThis.NJOW_DEV !== false && !!renderer.capabilities.reversedDepthBuffer;   // ?depth=reversed is dev-only (main.js)
    this.target = null;
    this.samples = -1;
    this._w = 1; this._h = 1;
  }
  setSamples(samples) {
    if (samples === this.samples) return;
    this.samples = samples;
    this.target?.dispose();
    this.target = hdrTarget(this._w, this._h, {
      samples, depthBuffer: true, resolveDepthBuffer: false,
      // Reversed-Z needs a 32-bit float depth buffer to pay off (three-r180-api §11).
      depthTexture: this.reversed ? new THREE.DepthTexture(this._w, this._h, THREE.FloatType) : null,
    });
    this.target.texture.name = 'post.scene';
  }
  setSize(w, h) { this._w = w; this._h = h; this.target.setSize(w, h); }
  render(renderer) {
    renderer.setRenderTarget(this.target);
    renderer.render(this.scene, this.camera);
  }
  dispose() { this.target.depthTexture?.dispose(); this.target.dispose(); }
}

// Frame metering (see METER): reduces the scene HDR buffer to a small grid of mean and max log2
// luminances (absolute scene units: the buffer's pre-exposure is divided out) and reads it back
// asynchronously. A reading: `logY` the weighted frame mean, `levels`/`cumWeight` the cells sorted
// from the brightest with their cumulative weight (for any highlight share), `peakLevels`/
// `peakCumWeight` the same for the third-brightest taps, `logYMax` the brightest tap, `frame` the
// frame it measured. In capture mode (`every` = 1) `lastRead` is a promise for the reading of the
// latest frame.
// The read-back is a pixel-pack buffer, a fence and a poll every 4 ms, as in three's
// readRenderTargetPixelsAsync, which is not used: for a float target it calls gl.getParameter(
// IMPLEMENTATION_COLOR_READ_TYPE), a synchronous round trip to Chrome's GPU process that waits for
// every queued command (the whole frame): 1.1 ms of main-thread stall per metered frame on the M4
// (shell probes). Each read gets a fresh buffer: Chrome keeps a copy of a read buffer at
// its fence, and reusing one buffer discards that copy (a console performance warning).
class MeterPass extends Quad {
  constructor() {
    super(shader('NJOWMeter', METER_FRAGMENT, {
      tDiffuse: { value: null }, uInvPre: { value: 1 }, uCell: { value: new THREE.Vector2(1 / METER.cols, 1 / METER.rows) },
    }));
    const n = METER.cols * METER.rows;
    this.pre = 1;                     // pre-exposure of the frame being rendered
    this.skyL = null;                 // anchor sky luminance of the frame being rendered (see Post._target)
    this.frame = 0;
    this.every = METER.every;
    this.reading = null;
    this.lastRead = Promise.resolve(null);
    this._order = new Uint16Array(n);
    this._tmp = new Float32Array(n);
    this._buffer = new Float32Array(n * 4);
    this._weights = new Float32Array(n);
    this._busy = false;
    this._disposed = false;
    this.target = new THREE.WebGLRenderTarget(METER.cols, METER.rows, {
      type: THREE.FloatType, depthBuffer: false, stencilBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
    });
    this.setAspect(16 / 9);
  }

  // Cell weights for a frame of this aspect (width / height): centre-weighted, and zero outside the
  // central METER.refAspect band when the frame is narrower than that.
  setAspect(aspect) {
    const band = Math.min(1, aspect / METER.refAspect);   // height fraction metered
    const w = this._weights;
    let sum = 0;
    for (let j = 0; j < METER.rows; j++) {
      const fy = (j + 0.5) / METER.rows - 0.5, dy = fy / band;
      const inBand = Math.abs(fy) <= 0.5 * band + 0.5 / METER.rows;
      for (let i = 0; i < METER.cols; i++) {
        const dx = (i + 0.5) / METER.cols - 0.5;
        sum += w[j * METER.cols + i] = inBand ? 1 + METER.centre * Math.exp(-(dx * dx + dy * dy) / (2 * METER.sigma * METER.sigma)) : 0;
      }
    }
    for (let k = 0; k < w.length; k++) w[k] /= sum;
  }

  render(renderer, input) {
    this.frame++;
    if (this._busy || this.frame % this.every !== 0) return;
    this.u.tDiffuse.value = input;
    this.u.uInvPre.value = 1 / this.pre;
    this.draw(renderer, this.target);                   // leaves the target's framebuffer bound
    const gl = renderer.getContext(), pbo = gl.createBuffer();
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
    gl.bufferData(gl.PIXEL_PACK_BUFFER, this._buffer.byteLength, gl.STREAM_READ);
    gl.readPixels(0, 0, METER.cols, METER.rows, gl.RGBA, gl.FLOAT, 0);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);          // synchronous readPixels elsewhere stay valid
    const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0), frame = this.frame, skyL = this.skyL;
    this._busy = true;
    this.lastRead = new Promise((resolve) => {
      const probe = () => {
        if (this._disposed || gl.isContextLost()) { gl.deleteSync(fence); gl.deleteBuffer(pbo); this._busy = false; resolve(null); return; }
        const status = gl.clientWaitSync(fence, 0, 0);
        if (status === gl.TIMEOUT_EXPIRED) { setTimeout(probe, 4); return; }
        // Read before the fence is deleted: Chrome serves the read from the copy it made at the fence.
        const ok = status !== gl.WAIT_FAILED;
        if (ok) {
          gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
          gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, this._buffer);
          gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
        }
        gl.deleteSync(fence);
        gl.deleteBuffer(pbo);
        this._busy = false;
        resolve(ok ? this._reduce(frame, skyL) : null);
      };
      setTimeout(probe, 4);
    });
  }

  _reduce(frame, skyL) {
    const b = this._buffer, w = this._weights, order = this._order, tmp = this._tmp, n = w.length;
    let m = 0;
    for (let k = 0; k < n; k++) if (w[k] > 0) tmp[m++] = b[k * 4];
    if (!m) return this.reading;
    const cap = tmp.subarray(0, m).sort()[m >> 1] + METER.cellClampLog2;   // median cell + clamp
    let s = 0, hi = -Infinity;
    for (let k = 0; k < n; k++) {
      s += w[k] * Math.min(b[k * 4], cap);
      if (w[k] > 0 && b[k * 4 + 1] > hi) hi = b[k * 4 + 1];
    }
    if (!Number.isFinite(s)) return this.reading;
    const sorted = (ch) => {
      for (let k = 0; k < n; k++) order[k] = k;
      order.sort((a, c) => b[c * 4 + ch] - b[a * 4 + ch]);
      const levels = new Float32Array(n), cumWeight = new Float32Array(n);
      let acc = 0;
      for (let k = 0; k < n; k++) { const i = order[k]; levels[k] = b[i * 4 + ch]; acc += w[i]; cumWeight[k] = acc; }
      return [levels, cumWeight];
    };
    const [levels, cumWeight] = sorted(0), [peakLevels, peakCumWeight] = sorted(2);
    return (this.reading = { logY: s, logYMax: hi, levels, cumWeight, peakLevels, peakCumWeight, frame, skyL });
  }

  // log2 level the brightest `share` of the metered frame reaches (weighted upper quantile), of the
  // cells' mean or (peak = true) of their third-brightest tap.
  static highLevel(reading, share, peak = false) {
    const levels = peak ? reading.peakLevels : reading.levels, cumWeight = peak ? reading.peakCumWeight : reading.cumWeight;
    for (let k = 0; k < levels.length; k++) if (cumWeight[k] >= share) return levels[k];
    return levels[levels.length - 1];
  }

  dispose() { this._disposed = true; this.target.dispose(); super.dispose(); }
}

// Half-resolution bloom (see BLOOM): prefilter → BLOOM_LEVELS − 1 downsamples → as many tent
// upsamples, each adding its level with that level's weight. `texture` is the result (buffer units,
// before strength).
class BloomPass {
  constructor() {
    this.enabled = false;
    this.prefilter = new Quad(shader('NJOWBloomPrefilter', BLOOM_PREFILTER, {
      tDiffuse: { value: null }, uThreshold: { value: 1 }, uKnee: { value: 1 }, uK: { value: 1e4 }, uSun: { value: 0 }, uSunMin: { value: 1 }, uTexel: { value: new THREE.Vector2() },
    }));
    this.down = new Quad(shader('NJOWBloomDown', BLOOM_DOWN, { tDiffuse: { value: null }, uTexel: { value: new THREE.Vector2() } }));
    this.up = new Quad(shader('NJOWBloomUp', BLOOM_UP, {
      tDiffuse: { value: null }, tCur: { value: null }, uTexel: { value: new THREE.Vector2() }, uTexelCur: { value: new THREE.Vector2() }, uLow: { value: 1 }, uCur: { value: 1 },
    }));
    this.levels = Array.from({ length: BLOOM_LEVELS }, () => hdrTarget());
    this.ups = Array.from({ length: BLOOM_LEVELS - 1 }, () => hdrTarget());
    this.weights = BLOOM.weightsDay.slice();
  }
  get texture() { return this.ups[0].texture; }
  setSize(w, h) {
    this.prefilter.u.uTexel.value.set(1 / w, 1 / h);
    for (let i = 0; i < BLOOM_LEVELS; i++) {
      const lw = Math.max(1, Math.round(w / 2 ** (i + 1))), lh = Math.max(1, Math.round(h / 2 ** (i + 1)));
      this.levels[i].setSize(lw, lh);
      if (i < BLOOM_LEVELS - 1) this.ups[i].setSize(lw, lh);
    }
  }
  render(renderer, input) {
    const { prefilter, down, up, levels, ups, weights } = this;
    prefilter.u.tDiffuse.value = input;
    prefilter.draw(renderer, levels[0]);
    for (let i = 1; i < BLOOM_LEVELS; i++) {
      const src = levels[i - 1];
      down.u.tDiffuse.value = src.texture;
      down.u.uTexel.value.set(1 / src.width, 1 / src.height);
      down.draw(renderer, levels[i]);
    }
    for (let i = BLOOM_LEVELS - 2; i >= 0; i--) {
      const low = i === BLOOM_LEVELS - 2 ? levels[i + 1] : ups[i + 1];
      up.u.tDiffuse.value = low.texture;
      up.u.tCur.value = levels[i].texture;
      up.u.uTexel.value.set(1 / low.width, 1 / low.height);
      up.u.uTexelCur.value.set(1 / levels[i].width, 1 / levels[i].height);
      up.u.uLow.value = i === BLOOM_LEVELS - 2 ? weights[i + 1] : 1;
      up.u.uCur.value = weights[i];
      up.draw(renderer, ups[i]);
    }
  }
  dispose() {
    for (const q of [this.prefilter, this.down, this.up]) q.dispose();
    for (const t of [...this.levels, ...this.ups]) t.dispose();
  }
}

const finishUniforms = () => ({ uToe: { value: GRADE.toe }, uDither: { value: LOOK.grainDither }, uFrame: { value: 0 } });

export class Post {
  // ctx: { renderer, scene, camera, quality, atmosphere?, clock? } (atmosphere: exposureTargetPhotoFit,
  // sunElevationDeg, preExposure, dayExposure?; clock: playing/speed/version for exposure ramping)
  constructor(ctx) {
    this.ctx = ctx;
    const { renderer, scene, camera } = ctx;
    this.renderer = renderer;
    this.quality = ctx.quality;
    this._size = renderer.getSize(new THREE.Vector2());
    this._pr = renderer.getPixelRatio();
    this._logExposure = null;         // smoothed log(exposure / anchor); null = snap on next render
    this._snapFrame = -1;             // a snap request waits for a meter reading of a later frame
    this._frame = 0;
    this._hold = [];                  // [{ t, big, small }] recent highlight levels (night peak hold)
    this._clockS = 0;                 // real seconds rendered (for the hold window)
    this.exposure = DAY_EXPOSURE_FALLBACK;
    this.capture = false;             // capture mode: meter every frame, frames are stepped
    this.diagnostics = {};
    // Look controls (A/B hooks; 1 = GRADE / BLOOM / SHOULDER / GLARE as above; toe = the high-sun toe).
    this.look = { contrast: 1, contrastHi: GRADE.contrastHi, bloom: 1, toe: GRADE.toe, sharpen: GRADE.sharpen, shoulder: 1, glare: 1 };

    this.scenePass = new ScenePass(scene, camera, renderer);
    this.meterPass = new MeterPass();
    this.bloomPass = new BloomPass();
    const gradeUniforms = {
      tScene: { value: null }, tBloom: { value: null }, uBloom: { value: 0 }, uTexel: { value: new THREE.Vector2() },
      uSharpen: { value: 0 }, uExposure: { value: 1 }, uPurkinje: { value: PURKINJE.strength }, uBufferToCd: { value: LOOK.sceneUnitLux },
      uHighlightSat: { value: GRADE.highlightSat }, uContrast: { value: 0 }, uContrastHi: { value: 0 }, uPivot: { value: 0.44 }, uShoulder: { value: 0 },
      uDay: { value: 1 },
      ...finishUniforms(),
    };
    // Two programs from one source: finished and drawn to the canvas (MSAA tiers), or display values
    // for the FXAA pass. Both share the uniform objects.
    this.gradeFinal = new Quad(shader('NJOWGrade', GRADE_FRAGMENT, gradeUniforms, { FINISH_HERE: '' }));
    this.gradeToFxaa = new Quad(shader('NJOWGradeDisplay', GRADE_FRAGMENT, gradeUniforms));
    this.fxaaPass = new Quad(shader('NJOWFxaa', FXAA_FRAGMENT, { tDiffuse: { value: null }, uTexel: { value: new THREE.Vector2() }, ...finishUniforms() }));
    this.fxaaTarget = hdrTarget();
    this.fxaa = false;
    // Stages in drawing order, for profiling from dev pages (a host bundle leaves the list out).
    if (globalThis.NJOW_DEV !== false) {
      this.passes = [this.scenePass, this.meterPass, this.bloomPass, this.gradeFinal, this.fxaaPass];
      ['scene', 'meter', 'bloom', 'grade', 'fxaa'].forEach((name, i) => { this.passes[i].name = name; });
    }
    this._applyQuality(this.quality);
  }

  // The render target the scene is drawn into (main.js pre-compiles programs against it so they
  // match this linear-HDR path).
  get sceneTarget() { return this.scenePass.target; }

  // Exposure the atmosphere calls "day" (the reference for the clamps).
  get dayExposure() {
    const d = this.ctx.atmosphere?.dayExposure;
    return Number.isFinite(d) && d > 0 ? d : DAY_EXPOSURE_FALLBACK;
  }

  // Jump straight to the exposure target (time jumps, frozen frames): now, and again when the meter
  // has read a frame rendered after the request.
  snapExposure() {
    this._logExposure = null;
    this._snapFrame = this.meterPass.frame;
    this._hold.length = 0;
  }

  // Capture mode (frame-exact stepping): meter every frame; `meterPass.lastRead` resolves with the
  // reading of the frame just rendered.
  setCapture(on) {
    this.capture = !!on;
    this.meterPass.every = on ? 1 : METER.every;
  }

  // Sun elevation (deg): the atmosphere's, else from U.uSunDir.
  _sunElevation() {
    const e = this.ctx.atmosphere?.sunElevationDeg;
    if (Number.isFinite(e)) return e;
    const d = U.uSunDir.value;
    return Math.asin(clamp(d.y / (d.length() || 1), -1, 1)) * 180 / Math.PI;
  }

  // The exposure target for this frame, and the pieces the grade needs.
  _target(reading, night, sunEl) {
    const atm = this.ctx.atmosphere;
    const eDay = this.dayExposure;
    const n = smoothstep(0.3, 0.9, night);
    const d = { anchor: null, skyL: null, framing: 0, metered: null, highlight: null, protect: 1 };

    // Highlight levels (log2 scene luminance), held over the last few seconds at night: `big`, the
    // brightest HIGHLIGHT.share of the frame (cell means by day; at night the cells' third-brightest
    // taps, since a lit facade or a floodlit deck inside dark cells would hide in their log-mean,
    // while a point lamp is one tap and does not count); `small`, at night only, the brightest
    // nightShare (a casino crown in a telephoto view, the floodlit landing seen from astern).
    const hlExposed = mix(mix(HIGHLIGHT.exposed, HIGHLIGHT.duskExposed, smoothstep(8, 4, sunEl)), HIGHLIGHT.nightExposed, n);
    let big = null, small = null;
    const pf = atm?.exposureTargetPhotoFit;
    const Ls = Number.isFinite(pf) && pf > 0 ? SKY_ANCHOR_EXPOSED / pf : null;   // anchor sky, scene units
    // log2 of the anchor exposure for sky luminance L: a level plus this is its exposed level there
    const refOf = (L) => (L ? Math.log2(anchorExposed(L * LOOK.sceneUnitLux) / L) : 0);
    const ref = refOf(Ls);
    // A reading describes a frame drawn 3-12 frames ago (read back asynchronously), and the night hold
    // keeps levels for HIGHLIGHT.holdS real seconds: at 3600x that is 10-40 sim-minutes and 2.6 sim-hours,
    // over which the twilight sky changes by many stops. A level from another moment is valid now under
    // one of two readings: it scaled with the sky (the sky itself, sunlit or skylit paint: keep its
    // exposed level at that moment's anchor, `rel`) or it did not (a lamp, a floodlit deck: keep its
    // absolute level, `abs`). Neither is known, so the smaller is used: as the sky darkens that is the
    // sky-scaled one, as it brightens the lamp's own. Taken absolute, dusk highlights read 4-5 EV over
    // the scene and held the exposure 5 EV under the anchor from 21:24 to 23:23 at 3600x; taken relative,
    // the night's lamp columns held dawn 1.3 EV under from 04:13 to 05:02 (p2 integration, probe-lapse).
    // At a fixed time (anchor constant) both are the measured level and the hold is the plain peak hold.
    const refR = reading && Ls && reading.skyL ? refOf(reading.skyL) : ref;
    const metered = (r) => { const y = 2 ** (r.logY + Math.min(0, refR - ref)); return METER_CALIBRATION * meterKey(y * LOOK.sceneUnitLux) / y; };
    if (reading) {
      const bigA = mix(MeterPass.highLevel(reading, HIGHLIGHT.share), MeterPass.highLevel(reading, HIGHLIGHT.share, true), n);
      const smallA = n > 0 ? MeterPass.highLevel(reading, HIGHLIGHT.nightShare, true) : null;
      const now = (a, r) => Math.min(a, r - ref);
      big = now(bigA, bigA + refR);
      small = smallA === null ? null : now(smallA, smallA + refR);
      const hold = HIGHLIGHT.holdS * n;
      if (hold > 0) {
        this._hold.push({ t: this._clockS, bigA, bigR: bigA + refR, smallA, smallR: smallA + refR });
        while (this._hold.length && this._hold[0].t < this._clockS - hold) this._hold.shift();
        for (const h of this._hold) { big = Math.max(big, now(h.bigA, h.bigR)); small = Math.max(small, now(h.smallA, h.smallR)); }
      } else this._hold.length = 0;
    }

    let target;
    if (Ls) {
      const anchor = anchorExposed(Ls * LOOK.sceneUnitLux) / Ls;
      d.anchor = anchor; d.skyL = Ls;
      target = anchor;
      if (reading) {
        d.metered = metered(reading);
        const w = smoothstep(FRAMING.sunElFrom, FRAMING.sunElTo, sunEl);
        if (w > 0) {
          const lim = FRAMING.maxEV * Math.LN2;
          d.framing = w * clamp(FRAMING.weight * Math.log(d.metered / anchor), -lim, lim);
          target = anchor * Math.exp(d.framing);
        }
      }
    } else {
      // No atmosphere (dev stubs): the metered frame.
      target = d.metered = reading ? metered(reading) : eDay;
    }
    const unprotected = target;
    if (big !== null) {
      let hl = hlExposed / 2 ** big;
      // A small bright subject may pull the exposure down by at most HIGHLIGHT.smallMaxEV: it clips a
      // little, the scene around it stays readable (a subject filling the frame is `big`).
      if (small !== null) hl = Math.min(hl, Math.max(hlExposed / 2 ** small, unprotected * 2 ** (-HIGHLIGHT.smallMaxEV * n)));
      d.highlight = hl;
      target = Math.min(target, hl);
      d.protect = unprotected / hl;                              // ≥ 1 when protection binds
    }
    const cap = Math.max(eDay * LOOK.nightExposureMaxGain, d.anchor ?? 0);
    target = clamp(target, eDay * MIN_EXPOSURE_FRACTION, cap);
    if (!(Number.isFinite(target) && target > 0)) target = eDay;
    d.target = target;
    return d;
  }

  render(dt, { snap = false } = {}) {
    const { renderer, ctx, look } = this;
    const atm = ctx.atmosphere, clock = ctx.clock;
    const realDt = Math.max(dt, 0);
    this._clockS += realDt;
    const tau = EXPOSURE_TAU_S / Math.max(1, clock?.playing ? clock.speed / EXPOSURE_TAU_REF_SPEED : 1);
    const night = clamp(U.uNight.value, 0, 1);
    const n = smoothstep(0.3, 0.9, night);
    // Any clock jump (setTime / setDate from the UI, a host script or a capture) snaps the exposure,
    // not only the ones that go through __scene.setTime (p1 integration).
    const ver = clock?.version;
    if (ver !== undefined && ver !== this._clockVersion) {
      if (this._clockVersion !== undefined) this.snapExposure();
      this._clockVersion = ver;
    }
    // Until a reading of a frame drawn after a snap request arrives, the latest reading describes
    // the old light (the frame before a time jump): meter nothing and expose on the sky anchor alone.
    // Otherwise a day→night jump fed the day's highlights into the night peak hold and the frame
    // stayed at day exposure, i.e. black, for ~3 s (p1 integration, shots/p1v-jump-*).
    let reading = this.meterPass.reading;
    if (reading && this._snapFrame !== null && reading.frame <= this._snapFrame) reading = null;
    const sunEl = this._sunElevation();
    const d = this.diagnostics = this._target(reading, night, sunEl);

    // A pending snap completes once a reading of a frame rendered after the request has arrived
    // (the first reading ever counts too, so the page never fades in from the stand-in exposure).
    if (reading && this._snapFrame !== null && reading.frame > this._snapFrame) { snap = true; this._snapFrame = null; }
    // Smoothing: the sky anchor follows the light at once (it is computed for this frame, so a
    // time-lapse never trails it); only the metered part (framing, highlight protection) is eased.
    const base = d.anchor ?? 1;
    const logRel = Math.log(d.target / base);
    if (snap || this._logExposure === null) this._logExposure = logRel;
    else this._logExposure += (logRel - this._logExposure) * (1 - Math.exp(-realDt / tau));
    this.exposure = base * Math.exp(this._logExposure);

    // An atmosphere may pre-expose scene radiance (multiply everything by preExposure before it is
    // written to the HalfFloat target, to keep night values out of half-float underflow). The
    // buffer then holds radiance × preExposure; divide it back out here.
    const pre = Number.isFinite(atm?.preExposure) && atm.preExposure > 0 ? atm.preExposure : 1;
    this.meterPass.pre = pre;
    this.meterPass.skyL = d.skyL;      // the light this frame's reading will be carried from
    const bufferToExposed = this.exposure / pre, toBuffer = 1 / bufferToExposed;
    renderer.toneMappingExposure = bufferToExposed;      // for modules that read it (land, farm)

    // Bloom: by day, skipped while nothing in the frame reaches the threshold.
    const bloom = this.bloomPass;
    bloom.enabled = this._bloomWanted && look.bloom > 0
      && (night > 0.05 || !reading || 2 ** reading.logYMax * this.exposure > 0.8 * BLOOM.thresholdExposed);
    const g = this.gradeFinal.u;
    if (bloom.enabled) {
      const p = bloom.prefilter.u;
      p.uThreshold.value = BLOOM.thresholdExposed * toBuffer;
      p.uKnee.value = BLOOM.kneeExposed * toBuffer;
      p.uK.value = Math.exp(mix(Math.log(BLOOM.compressDay), Math.log(BLOOM.compressNight), n)) * toBuffer;
      p.uSun.value = GLARE.share * look.glare * smoothstep(-1, 1, sunEl);   // no sun disk, no glare
      p.uSunMin.value = GLARE.minExposed * toBuffer;
      for (let i = 0; i < BLOOM_LEVELS; i++) bloom.weights[i] = mix(BLOOM.weightsDay[i], BLOOM.weightsNight[i], n);
      g.uBloom.value = mix(BLOOM.strengthDay, BLOOM.strengthNight, n) * look.bloom;
    } else g.uBloom.value = 0;

    g.uExposure.value = bufferToExposed;
    g.uBufferToCd.value = LOOK.sceneUnitLux / pre;
    g.uSharpen.value = this.fxaa ? 0 : look.sharpen;
    // Pivoted contrast: by day, faded out where highlight protection sets the exposure or the frame
    // is backlit (its brightest tenth 3.5–7× its average: a low sun, glitter), which is compressed
    // already and would crush to black.
    let hb = smoothstep(0.9, 1.0, d.protect ?? 0);
    if (reading) hb = Math.max(hb, smoothstep(1.8, 2.8, MeterPass.highLevel(reading, HIGHLIGHT.share) - reading.logY));
    const cw = (1 - night) * (1 - hb) * look.contrast;
    g.uContrast.value = GRADE.contrast * cw;
    g.uContrastHi.value = look.contrastHi * cw;
    g.uPivot.value = reading ? Math.max(1e-6, 2 ** reading.logY * this.exposure) : METER_CALIBRATION * 0.67;
    g.uShoulder.value = SHOULDER.strength * n * look.shoulder;   // 0 by day
    g.uDay.value = 1 - n;
    // Display finish: black toe by day only, stronger with a high sun; the dither pattern moves every
    // frame (fixed in captures).
    if (!snap) this._frame = (this._frame + 1) % 4096;
    const fin = this.fxaa ? this.fxaaPass.u : g;
    fin.uToe.value = mix(LOOK.blackToe, look.toe, smoothstep(...GRADE.toeSunDeg, sunEl)) * (1 - smoothstep(0.2, 0.8, night));
    fin.uFrame.value = this.capture ? 0 : this._frame;

    // Draw.
    const scene = this.scenePass.target.texture;
    this.scenePass.render(renderer);
    this.meterPass.render(renderer, scene);
    if (bloom.enabled) {
      bloom.render(renderer, scene);
      g.tBloom.value = bloom.texture;
    }
    g.tScene.value = scene;
    if (this.fxaa) {
      this.gradeToFxaa.draw(renderer, this.fxaaTarget);
      this.fxaaPass.u.tDiffuse.value = this.fxaaTarget.texture;
      this.fxaaPass.draw(renderer, null);
    } else this.gradeFinal.draw(renderer, null);
  }

  // Compile every post-processing program in parallel, without drawing: a pass used for the first
  // time after a quality switch (FXAA, bloom) would otherwise compile inside a frame.
  compileAsync() {
    const { renderer } = this;
    const b = this.bloomPass, prev = renderer.getRenderTarget();
    // Each group compiles against its target kind (render target, or the canvas for the last pass).
    const compile = (target, quads) => {
      const s = new THREE.Scene();
      for (const q of quads) s.add(q.mesh);
      renderer.setRenderTarget(target);
      const p = renderer.compileAsync(s, ORTHO);
      for (const q of quads) s.remove(q.mesh);          // the programs are known; the meshes draw on their own
      return p;
    };
    const all = Promise.all([compile(this.fxaaTarget, [this.meterPass, b.prefilter, b.down, b.up, this.gradeToFxaa]), compile(null, [this.gradeFinal, this.fxaaPass])]);
    renderer.setRenderTarget(prev);
    return all;
  }

  setSize(cssWidth, cssHeight, pixelRatio = this.renderer.getPixelRatio()) {
    this._size.set(cssWidth, cssHeight);
    this._pr = pixelRatio;
    const w = Math.max(1, Math.floor(cssWidth * pixelRatio)), h = Math.max(1, Math.floor(cssHeight * pixelRatio));
    this.scenePass.setSize(w, h);
    this.bloomPass.setSize(w, h);
    this.fxaaTarget.setSize(w, h);
    this.meterPass.setAspect(cssWidth / Math.max(1, cssHeight));
    this.gradeFinal.u.uTexel.value.set(1 / w, 1 / h);
    this.fxaaPass.u.uTexel.value.set(1 / w, 1 / h);
  }

  setQuality(q) {
    this.quality = q;
    this._applyQuality(q);
  }

  _applyQuality(q) {
    this.scenePass.setSamples(q.msaa);
    this._bloomWanted = !!q.bloom;
    this.fxaa = q.msaa === 0 && !!(q.fxaa ?? q.smaa);
    this.setSize(this._size.x, this._size.y, this._pr);
  }

  dispose() {
    for (const p of [this.scenePass, this.meterPass, this.bloomPass, this.gradeFinal, this.gradeToFxaa, this.fxaaPass, this.fxaaTarget]) p.dispose();
  }
}
