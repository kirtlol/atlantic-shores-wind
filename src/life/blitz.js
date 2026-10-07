// Topwater fish blitzes (owner: wildlife). See ARCHITECTURE.md "life/blitz.js" and SCENE-SPEC §15.
//
//   new Blitz(ctx)                     ctx: renderer, scene, camera, quality, atmosphere, ocean?, farm?, clock?, birds?, seed?
//   blitz.update(dt, t, camera)        per frame (animation time t = U.uTime)
//   blitz.trigger(x, z, opts?) -> id   start a blitz at once near (x, z) (UI key B, ?blitz=1, the Blitz view);
//                                      it arrives in full swing: the last PREROLL_S seconds are synthesised
//   blitz.splashAt(x, z, size, opts)   a splash of crown height `size` metres (birds' plunge dives)
//   blitz.active                       the running blitzes (see BlitzState below), read-only
//   blitz.recentStrikes                [{ x, z, t, height, id }] of the last STRIKE_MEMORY_S seconds
//   blitz.focus() -> Vector3 | null    the most active blitz's working core (sea level)
//   blitz.setEnabled(on), blitz.setQuality(q), blitz.dispose()
//   dev builds only (globalThis.NJOW_DEV !== false): blitz.strikeAt(x, z, opts) one strike now,
//   blitz.whiteWater(id?) -> { m2, fraction, patches } white water on the sea now
//
// What a blitz is (angler reports and fisheries literature; SCENE-SPEC §15, config LIFE): a school
// of predators (striped bass, bluefish, false albacore, offshore bluefin tuna) pins bait (Atlantic
// menhaden, sand eels, bay anchovy) against the surface, preferably around structure (foundations
// act as reefs). The patch (10-40 m) travels 0.5-3 m/s for 1-5 min in bursts: the fish "pop up",
// feed, "go down" and pop up again tens of metres on. Anglers describe a feeding patch as "churning
// the water white", "like a washing machine", "the water boiling"; bunker schools show as "large
// blobs of purple water", bait "showers" out of the surface, and a glassy, oily slick marks where a
// blitz has been. Strikes come in sweeps (a fish or two tearing through the bait along a few
// metres), each an eruption of aerated white water with spray thrown mostly along the attack
// (bass/blues crowns 0.5-1.5 m, tuna 2-4 m, many smaller "pops"), bait leaping 0.2-1 m, and white
// water that decays over seconds into lace and scum lasting tens of seconds.
//
// Rendering. Everything moves on analytic trajectories evaluated on the GPU from launch data, so
// nothing is integrated per frame, frozen frames (?freeze=1) hold exactly, and the CPU only writes
// new launches into ring buffers:
//   - spray: camera-facing, velocity-stretched sprites under linear drag toward the local wind
//     (ligament droplets, sheets and veils of drops, bulk aerated water, and bait too small on
//     screen for a mesh). Each parcel's water tears as it flies: a sheet opens holes, becomes a web
//     of ligaments and breaks into drops (foamCells in the parcel's frame, stretched along its
//     streak); where a pixel cannot resolve them they are a speckle of whole drops, not a haze. Lit
//     by sun, moon and sky with a forward-peaked droplet phase function, white only where the water
//     is thick, Fresnel sky reflection on thin water (see-through edges), facet and drop glints
//     (faint with the sun behind the camera, brilliant against it), blue-green transmission;
//   - white water: each strike leaves dense fresh foam, lace, aerated water and, for a moment, the
//     open cavity (one density law, FOAM_GLSL). Near the focused blitz they are stamped top-down
//     into a foam map drawn by one sea decal; elsewhere each strike is a decal. The decals ride the
//     rendered waves and shade the foam per pixel (FOAM_FS): a cell network of rafts and bubble
//     clusters (foamCells) covered out from its walls by the density (lace when thin, a sheet with
//     holes when dense), opacity and whiteness from the foam's thickness (grey translucent froth to
//     an opaque white mound), domed clusters, jade aerated water beneath (white -> green -> lace);
//   - fish: one instanced draw per species of a procedural body built to the species' proportions,
//     MeshStandardMaterial patched for the pose (a leap, or a roll at the surface), tail wave and
//     markings;
//   - the ocean: ring trains (its splash map), boils (dome, glassy calm, rim), and each blitz's
//     life patch (ocean.setLifePatches: bait stain, nervous water, slick trail).
// Units: metres, seconds. Axes: +X east, +Y up, +Z south.
import * as THREE from 'three';
import { U, LAYER_REFLECT, mulberry32, registerScale, curvatureDrop, azimuthToDir, CURVATURE_GLSL } from '../shared.js';
import { LIFE, SEA, QUALITY, TURBINE } from '../config.js';
import { applyAtmosphere } from '../env/fog.js';

const G = 9.81;
const DEG = Math.PI / 180;
const TAU = 2 * Math.PI;
const B = LIFE.blitz;

// ================================================================================================
// Constants (SOURCED from config LIFE where it has the number; otherwise ESTIMATED with the basis)
// ================================================================================================
// Scheduling.
const FIRST_BLITZ_DELAY_S = 30;         // none at t = 0 (ARCHITECTURE: nothing in the reference frame at start)
const SPAWN_RADIUS_M = 2000;            // LIFE.blitz.meanGapS counts blitzes within ~2 km of the camera target
const TUNA_OFFSET_M = [400, 1500];      // bluefin blitzes are the rare offshore ones: away from the structure
const MAX_BLITZES = { low: 2, med: 3, high: 3, ultra: 4 };
const FORCED_QUIET_M = 400;             // no scheduled blitz this close to a forced one (the view is on it)
const STRIKE_MEMORY_S = 8;
const END_LINGER_S = 6;                 // a finished blitz stays listed while its last splashes settle
// A blitz in time: a rising phase of nervous water, then bursts of feeding separated by lulls when
// the school goes down (ESTIMATED from angler descriptions: "pop up, go down, pop up").
const RISING_S = [6, 14], BURST_S = [15, 55], LULL_S = [6, 22];
const RAMP_S = 3;                        // intensity ramps in and out of a burst
const PREROLL_S = 8;                     // a forced blitz arrives with this much history already on the water
const HOMING_M = B.preferNearFoundationsM;   // bait holds near structure: patches steer back inside this
const HEADING_WANDER = 7 * DEG;          // rad / √s random walk of the travel direction
const DOWN_SPEED_GAIN = 1.6;             // the school moves on faster while down
// Strikes come in attacks: a single hit (50 %) or a sweep of 3-5 hits along a 3-6 m arc in ~0.6 s
// (ESTIMATED from blitz video: the white water "tears" along a line as a fish runs through the
// bait), so ~60 % of strikes follow another within 4 m and 1 s.
const SWEEP = { chance: 0.5, n: [3, 5], len: [3, 6], dur: [0.45, 0.8] };
const MEAN_PER_ATTACK = 0.4 + SWEEP.chance * (SWEEP.n[0] + SWEEP.n[1]) / 2;
const RATE_SCALE_MAX = 1.6;              // strike rate grows as (radius / 10 m)^1.5, at most this factor
const STRIKE_RATE_MAX = { low: 5, med: 8, high: 10, ultra: 12 };    // per blitz, strikes/s (particles, phones)
// The working core (round 4, ESTIMATED from blitz drone footage): the bait balls up in a few metres
// and the predators tear through it, so most white water, spray and birds are over that ball while
// the rest of the pod shows as dark nervous water with the odd outlying pop. Core radius = share ×
// patch radius within r (tuna: tuna); `hit` of the attacks run through it. The ball wanders round
// a point 0.3 radii ahead of the patch centre (±0.3 radii, ~0.5-1 m/s). Feeding comes in flurries:
// FLURRY = rate factor in a flurry (0.8-2.5 s), between them (0.8-2.5 s).
const CORE = { share: 0.4, r: [3, 6], tuna: [5, 9], hit: 0.8 };
const FLURRY = [1.5, 0.5];
// Detail by camera distance: full within DETAIL_NEAR_M or for the focused blitz; beyond DETAIL_FAR_M
// only crowns, white water (and the birds).
const DETAIL_NEAR_M = 300, DETAIL_FAR_M = 900;
// Wind at spray height: neutral log profile over the sea, z0 = 2e-4 m (light-wind Charnock value,
// ESTIMATED): U(1 m)/U10 = ln(1/z0)/ln(10/z0) = 0.79. Fine drops drift with it.
const SPRAY_WIND_FACTOR = Math.log(1 / 2e-4) / Math.log(10 / 2e-4);
const FOAM_DRIFT = 0.03;                 // surface foam drifts at ~3 % of U10 (the classic wind-drift rule)
const SHUTTER_S = 1 / 120;               // streak motion blur: a 180° shutter at 60 fps (drone video)
const MIN_SPRITE_PX = 0.75;              // smaller drops keep their true coverage through alpha
const MAX_SPRITE_PX = 180;               // bounds fill rate when the camera is in the spray
// Spray kinds. Each sprite is a parcel of spray, not one drop (a 1 m crown throws ~10 litres, some
// 10^5-10^6 drops of 1-5 mm): clumps are ligament fragments and big drops (dense, transparent water
// that flashes), veil parcels sheets and clouds of drops (translucent, tearing within ~0.3 s), blobs
// bulk aerated water (white where thick, its thin rim tearing first), bait a fish too short on
// screen for a mesh.
const K_CLUMP = 0, K_VEIL = 1, K_BLOB = 2, K_BAIT = 5;
// Terminal speeds (m/s), linear-drag fit τ = v_t / g. Water drops: ~2 m/s at 0.5 mm, ~4 m/s at 1 mm,
// ~6.5 m/s at 2 mm, ~9 m/s at 4-5 mm (Gunn & Kinzer 1949); bulk aerated water barely feels drag over
// a metre. Mound: aerated water heaved up round the cavity (τ ≈ 0.25 s, ESTIMATED).
const VT = { clump: [4.5, 8.5], veil: [2.5, 6.5], blob: [12, 16], mound: [2.2, 2.8] };
const POOL_BASE = 24576;                 // spray sprites at QUALITY.particles = 1
const SPRAY_BUDGET_S = 1.5;              // particles launched per second never exceed pool / this
// White water: the heaped white of a strike is gone in about a second (e-fold 0.8-2 s bass/blues,
// 2-4 s tuna), the aerated green water under it lasts 2-4 s, lace 3-6 s (e-folds; round 4: the 2-5 s
// whitecap e-fold of Callaghan et al. 2012 left a working patch paved with flat white decals). A
// working patch's older scum (one lace layer round the core, fed by every strike) lasts ~60 s.
const WHITE_CORE_TAU = { bassBlues: [1.0, 2.5], tuna: [2.0, 4.0] };
const WHITE_LACE_TAU = [3, 6];
const SCUM_PER_STRIKE = 0.02, SCUM_MAX = 0.25, SCUM_TAU_S = 60;
const SLICK_EVERY_S = [2.5, 4];          // fish oil off the core while feeding: a continuous glassy trail
const SLICK_PREROLL_S = 45;              // a blitz that arrives in full swing already has this much slick behind it
const DECALS = 1536;                     // white-water decals (strikes outside the foam map)
// Ocean disturbances: ring trains (its splash map draws them) for every splash near the camera:
// crowns of RING_MIN_H and up within RING_MAX_M at most RING_RATE a second, and the smaller ones
// within SMALL_RING_M at most SMALL_RING_RATE a second (in a working patch the chop scrambles most
// rings; an isolated strike's train shows); boils at most BOILS young.
const RING_RATE = 3, RING_MIN_H = 0.8, RING_MAX_M = 120, SMALL_RING_RATE = 6, SMALL_RING_M = 60, BOILS = 8;
const SEA_MS_PER_FRAME = 0.25;           // CPU time budget for ocean.getSurface per frame
// Wind-sea peak angular frequency (SEA.windSea.Tp): the sea under a point is extrapolated from one
// current sample as y(Δt) = ȳ + (y − ȳ) cos ωΔt + (v_y/ω) sin ωΔt (exact for one wave, bounded).
const SEA_OMEGA = TAU / SEA.windSea.Tp;
const PILE_CLEAR_M = 0.4;                // strikes keep this clear of a foundation's wall

// Seasonal occurrence off New Jersey by month (Jan..Dec), relative (ESTIMATED from NJDEP / MAFMC
// seasons: bluefish May-Oct; striped bass spring and fall migrations; false albacore Aug-Nov;
// bluefin tuna Jun-Oct offshore, rare).
const SEASON = {
  stripedBass:   [0.5, 0.3, 0.3, 0.7, 0.9, 0.35, 0.15, 0.15, 0.3, 0.8, 1.0, 0.8],
  bluefish:      [0.0, 0.0, 0.05, 0.4, 0.9, 1.0, 1.0, 1.0, 1.0, 0.9, 0.5, 0.1],
  falseAlbacore: [0.0, 0.0, 0.0, 0.0, 0.0, 0.05, 0.3, 0.8, 1.0, 1.0, 0.5, 0.0],
  bluefinTuna:   [0.0, 0.0, 0.0, 0.0, 0.03, 0.1, 0.12, 0.1, 0.08, 0.1, 0.06, 0.02],   // already includes rarity
};

// Predators: sizes from config LIFE.fish (SCENE-SPEC §15, SOURCED ranges); behaviour ESTIMATED.
//   sizeRange  individual length (m)      splash  crown height range (m, LIFE.blitz)    cavity  radius range (m)
//   rate       peak strikes/s, 20 m patch  patch   diameter range (m)   speed  travel (m/s, within LIFE 0.5-3)
//   bait       bait species weights        shows   per-strike chance of a visible predator
//   sizes      [share, H min, H max] of strike classes: "pops" (white water, little spray), crowns,
//              and the big ones (most hits in blitz video are small)
// Peak rates from angler descriptions ("washing machine", "a sea of whitewater") and splash counts
// in blitz video, as seen splashes (round 4: fewer, larger; the pops are mostly the outliers):
// bluefish tearing through bunker ≈ 6/s per 20 m, bass ≈ 3.5/s, albies ≈ 4.5/s in short bursts,
// bluefin ≈ 1/s (means: flurries run at 1.5×, the spells between at 0.5×). sizes[0] is the outliers' class.
const SMALL = [[0.25, 0.25, 0.5], [0.5, 0.5, 1.0], [0.25, 1.0, 1.5]];
const PREDATORS = {
  stripedBass: { sizeRange: [0.5, 0.9], splash: B.splashHeight.bassBlues, cavity: [0.14, 0.32], rate: 3.5,
    patch: [10, 30], speed: [0.5, 1.6], bait: { menhaden: 0.6, sandEel: 0.4 }, shows: { roll: 0.4 }, swirl: 0.12, sizes: SMALL },
  bluefish: { sizeRange: [0.35, 0.85], splash: B.splashHeight.bassBlues, cavity: [0.12, 0.28], rate: 6,
    patch: [15, 40], speed: [1.0, 2.5], bait: { menhaden: 0.5, anchovy: 0.3, sandEel: 0.2 }, shows: { roll: 0.35, jump: 0.06 }, swirl: 0.1, sizes: SMALL },
  falseAlbacore: { sizeRange: [0.6, 0.9], splash: [B.splashHeight.bassBlues[0], 1.2], cavity: [0.12, 0.26], rate: 4.5,
    patch: [10, 25], speed: [1.8, 3.0], bait: { anchovy: 0.7, sandEel: 0.3 }, burst: [10, 25], shows: { skyrocket: 0.15, roll: 0.2 }, swirl: 0.1,
    sizes: [[0.25, 0.25, 0.45], [0.5, 0.5, 0.9], [0.25, 0.9, 1.2]] },
  bluefinTuna: { sizeRange: [1.9, 2.5], splash: B.splashHeight.tuna, cavity: [0.45, 0.85], rate: 1.0,
    patch: [20, 40], speed: [1.5, 3.0], bait: { sandEel: 0.5, menhaden: 0.5 }, shows: { roll: 0.25, crash: 0.3 }, swirl: 0.1,
    sizes: [[0.3, 0.8, 1.6], [0.5, 2.0, 3.0], [0.2, 3.0, 4.0]] },
};
// Bait: sizes from config LIFE.fish; count = fish thrown out per strike of a 1 m crown (blitz video:
// a hit on bunker throws dozens, one on rain bait a spray of a hundred or more); shower = fish per
// mass "shower" (a section of the school leaping together, 0.3-0.6 per second).
const BAIT = {
  menhaden: { sizeRange: [0.18, 0.32], count: [15, 40], tumble: [2, 12], flipsPerS: 10, shower: [40, 110] },
  sandEel:  { sizeRange: [0.09, 0.15], count: [30, 80], tumble: [4, 18], flipsPerS: 5, shower: [60, 150] },
  anchovy:  { sizeRange: [0.05, 0.08], count: [60, 150], tumble: [6, 24], flipsPerS: 5, shower: [80, 150] },
};
const SHOWER_RATE = [0.7, 1.4];          // showers per second while a patch feeds (round 4: the silver sprays read)
const BAIT_SPRITE_PX = 6;                // bait shorter than this on screen is a silver fleck
const FLIP_RATE_MAX = 12;                // flips per second per blitz (nervous water, meshes near the camera)
const FLIP_RANGE_M = 250;

// ================================================================================================
// Fish species: proportions and markings
// ================================================================================================
// stations: [s, half-height, half-width] with s = 0 at the snout, 1 at the tail tip, all fractions
// of the length L. Proportions from species descriptions and photographs (ESTIMATED): striped bass
// depth ≈ 0.23 L; bluefish 0.24 L; little tunny 0.24 L, round; bluefin 0.27 L, round; menhaden deep
// and compressed (0.33 L); sand eel very slender (0.07 L); bay anchovy 0.17 L. Markings (config LIFE
// notes; FishBase / Wikipedia species pages), colours sRGB: metal / rough = back, flank, belly;
// stripes = spacing, strength, yN min, yN max; wavy = strength, s min, s max, yN min; spots = [s, yN,
// radius, darkness].
export const FISH_SPECIES = {
  stripedBass: {
    length: LIFE.fish.stripedBass.length,
    stations: [[0, 0.004, 0.003], [0.03, 0.036, 0.022], [0.08, 0.064, 0.040], [0.15, 0.090, 0.055], [0.25, 0.109, 0.064],
      [0.35, 0.115, 0.066], [0.45, 0.108, 0.061], [0.55, 0.094, 0.051], [0.65, 0.073, 0.038], [0.74, 0.052, 0.026], [0.81, 0.040, 0.018]],
    tail: { span: 0.25, fork: 0.05, lunate: 0.1 },
    fins: [{ at: 'back', s0: 0.30, s1: 0.46, h: 0.10, shape: 'spiny' }, { at: 'back', s0: 0.50, s1: 0.64, h: 0.075 },
      { at: 'belly', s0: 0.58, s1: 0.68, h: 0.065 }, { at: 'pectoral', s: 0.24, len: 0.11 }, { at: 'pelvic', s: 0.30, len: 0.08 }],
    swim: { beatHz: 3.0, pivot: 0.3, amp: 0.07 },
    look: { back: '#3a4335', flank: '#b3b8b6', belly: '#e8e8e0', fin: '#5e6258', accent: '#1c1f1b',
      metal: [0.3, 0.85, 0.05], rough: [0.45, 0.28, 0.4], stripes: [0.19, 0.9, -0.5, 0.72] },
  },
  bluefish: {
    length: LIFE.fish.bluefish.length,
    stations: [[0, 0.004, 0.003], [0.03, 0.040, 0.024], [0.08, 0.070, 0.040], [0.16, 0.098, 0.053], [0.27, 0.118, 0.060],
      [0.38, 0.120, 0.060], [0.49, 0.110, 0.055], [0.60, 0.090, 0.045], [0.70, 0.065, 0.032], [0.78, 0.043, 0.020], [0.82, 0.036, 0.016]],
    tail: { span: 0.30, fork: 0.13, lunate: 0.15 },
    fins: [{ at: 'back', s0: 0.30, s1: 0.39, h: 0.055, shape: 'spiny' }, { at: 'back', s0: 0.42, s1: 0.73, h: 0.07 },
      { at: 'belly', s0: 0.50, s1: 0.74, h: 0.06 }, { at: 'pectoral', s: 0.25, len: 0.10 }, { at: 'pelvic', s: 0.30, len: 0.06 }],
    swim: { beatHz: 3.4, pivot: 0.32, amp: 0.07 },
    look: { back: '#2e5c5c', flank: '#aebcbb', belly: '#ebebe6', fin: '#4d6560', accent: '#131a1a',
      metal: [0.35, 0.85, 0.05], rough: [0.4, 0.26, 0.4], spots: [[0.245, -0.2, 0.022, 0.85]] },
  },
  falseAlbacore: {
    length: LIFE.fish.falseAlbacore.length,
    stations: [[0, 0.004, 0.004], [0.04, 0.045, 0.034], [0.10, 0.083, 0.062], [0.20, 0.112, 0.082], [0.32, 0.121, 0.088],
      [0.44, 0.112, 0.080], [0.56, 0.088, 0.062], [0.66, 0.060, 0.042], [0.75, 0.034, 0.024], [0.82, 0.018, 0.016], [0.84, 0.017, 0.022]],
    tail: { span: 0.34, fork: 0.14, lunate: 0.55 },
    fins: [{ at: 'back', s0: 0.27, s1: 0.45, h: 0.10, shape: 'falcate' }, { at: 'back', s0: 0.50, s1: 0.56, h: 0.07, shape: 'falcate' },
      { at: 'belly', s0: 0.54, s1: 0.60, h: 0.06, shape: 'falcate' }, { at: 'pectoral', s: 0.26, len: 0.10 }, { at: 'pelvic', s: 0.30, len: 0.05 }],
    finlets: { back: [0.58, 0.80, 8], belly: [0.62, 0.80, 7], h: 0.022 },
    swim: { beatHz: 5.0, pivot: 0.6, amp: 0.06 },
    look: { back: '#173947', flank: '#a9b4b8', belly: '#ecedea', fin: '#1f2d33', accent: '#0b1418', finlet: '#26343a',
      metal: [0.55, 0.9, 0.1], rough: [0.3, 0.22, 0.35], wavy: [0.9, 0.44, 0.86, 0.22],
      spots: [[0.30, -0.36, 0.009, 0.9], [0.33, -0.47, 0.009, 0.9], [0.28, -0.52, 0.008, 0.9], [0.35, -0.3, 0.008, 0.9]] },
  },
  bluefinTuna: {
    length: LIFE.fish.bluefinTuna.length,
    stations: [[0, 0.005, 0.005], [0.04, 0.052, 0.040], [0.10, 0.095, 0.072], [0.20, 0.126, 0.096], [0.32, 0.136, 0.102],
      [0.44, 0.126, 0.094], [0.56, 0.100, 0.074], [0.66, 0.068, 0.050], [0.75, 0.038, 0.028], [0.82, 0.020, 0.018], [0.845, 0.019, 0.026]],
    tail: { span: 0.36, fork: 0.13, lunate: 0.6 },
    fins: [{ at: 'back', s0: 0.28, s1: 0.41, h: 0.07, shape: 'spiny' }, { at: 'back', s0: 0.45, s1: 0.54, h: 0.10, shape: 'falcate' },
      { at: 'belly', s0: 0.52, s1: 0.60, h: 0.09, shape: 'falcate' }, { at: 'pectoral', s: 0.25, len: 0.13 }, { at: 'pelvic', s: 0.29, len: 0.05 }],
    finlets: { back: [0.58, 0.81, 9], belly: [0.62, 0.81, 8], h: 0.02 },
    swim: { beatHz: 2.2, pivot: 0.62, amp: 0.05 },
    look: { back: '#0d1c36', flank: '#9aa3aa', belly: '#dadcdc', fin: '#1d242e', accent: '#0a1222', finlet: '#e0b62a',
      metal: [0.6, 0.85, 0.15], rough: [0.3, 0.24, 0.35] },
  },
  menhaden: {
    length: LIFE.fish.menhaden.length,
    stations: [[0, 0.006, 0.004], [0.04, 0.070, 0.030], [0.10, 0.120, 0.048], [0.20, 0.160, 0.058], [0.32, 0.170, 0.060],
      [0.44, 0.160, 0.055], [0.55, 0.130, 0.045], [0.65, 0.095, 0.034], [0.73, 0.062, 0.022], [0.79, 0.046, 0.015]],
    tail: { span: 0.34, fork: 0.17, lunate: 0.2 },
    fins: [{ at: 'back', s0: 0.40, s1: 0.53, h: 0.10 }, { at: 'belly', s0: 0.65, s1: 0.74, h: 0.05 },
      { at: 'pectoral', s: 0.25, len: 0.09 }, { at: 'pelvic', s: 0.42, len: 0.05 }],
    swim: { beatHz: 12, pivot: 0.3, amp: 0.12 },
    look: { back: '#3f5446', flank: '#c9c4a6', belly: '#e9e8df', fin: '#b9ad78', accent: '#101010',
      metal: [0.35, 0.92, 0.2], rough: [0.4, 0.22, 0.35],
      spots: [[0.30, 0.38, 0.020, 1.0], [0.36, 0.28, 0.010, 0.9], [0.41, 0.38, 0.009, 0.85], [0.46, 0.22, 0.008, 0.8], [0.51, 0.34, 0.007, 0.7]] },
  },
  sandEel: {
    length: LIFE.fish.sandEel.length,
    stations: [[0, 0.003, 0.002], [0.04, 0.020, 0.014], [0.12, 0.031, 0.022], [0.30, 0.035, 0.024], [0.50, 0.034, 0.023],
      [0.70, 0.028, 0.019], [0.82, 0.018, 0.012], [0.88, 0.014, 0.008]],
    tail: { span: 0.12, fork: 0.04, lunate: 0.1 },
    fins: [{ at: 'back', s0: 0.28, s1: 0.82, h: 0.022 }, { at: 'belly', s0: 0.55, s1: 0.82, h: 0.018 }, { at: 'pectoral', s: 0.2, len: 0.05 }],
    swim: { beatHz: 14, pivot: 0.15, amp: 0.16 },
    look: { back: '#566b4c', flank: '#c4cbc7', belly: '#eef0ec', fin: '#8f9a88', accent: '#20251e',
      metal: [0.3, 0.9, 0.2], rough: [0.4, 0.22, 0.35] },
  },
  anchovy: {
    length: LIFE.fish.anchovy.length,
    stations: [[0, 0.004, 0.003], [0.05, 0.045, 0.030], [0.14, 0.074, 0.046], [0.28, 0.084, 0.050], [0.44, 0.080, 0.046],
      [0.58, 0.066, 0.038], [0.70, 0.046, 0.026], [0.79, 0.032, 0.016]],
    tail: { span: 0.28, fork: 0.13, lunate: 0.15 },
    fins: [{ at: 'back', s0: 0.44, s1: 0.56, h: 0.07 }, { at: 'belly', s0: 0.55, s1: 0.72, h: 0.045 }, { at: 'pectoral', s: 0.22, len: 0.07 }],
    swim: { beatHz: 16, pivot: 0.2, amp: 0.13 },
    look: { back: '#8a9690', flank: '#b9c1bf', belly: '#dfe3e0', fin: '#c3c9c5', accent: '#26302c',
      metal: [0.25, 0.55, 0.15], rough: [0.4, 0.3, 0.4] },
  },
};
// Fish pose modes (JS and GLSL): a ballistic leap; a roll at the surface (a predator's back and tail
// break it; a bait fish flips onto its side in nervous water).
const M_LEAP = 0, M_ROLL = 1;
// The snout sits this far forward of the fish's origin (fraction of L): the origin is near the
// centre of mass, ~45 % of the length behind the snout.
const SNOUT_Z = 0.45;
const FISH_POOL = { predator: 24, bait: 1024 };   // instances per species (each holds one leap / roll / flip)

// ================================================================================================
// Linear-drag ballistics: dv/dt = g + (v_air − v)/τ. Vertical, launched at v0 from y = 0:
//   y(t) = −gτ t + (v0 + gτ) τ (1 − e^{−t/τ}),   apex (v0 > 0) = v0 τ − gτ² ln(1 + v0/(gτ)).
// ================================================================================================
function dragY(v0, tau, t) { const gt = G * tau; return -gt * t + (v0 + gt) * tau * (1 - Math.exp(-t / tau)); }
function dragApex(v0, tau) { const gt = G * tau; return v0 * tau - gt * tau * Math.log(1 + v0 / gt); }
// Launch speed for an apex h. In drag units a = v0 / (gτ), y* = h / (gτ²): a − ln(1 + a) = y*,
// tabulated over 12 decades of log10 y* (linear interpolation, relative error < 1e-4).
const APEX_TAB = (() => {
  const tab = new Float64Array(512);
  for (let i = 0; i < 512; i++) {
    const y = Math.pow(10, -7 + 12 * i / 511);
    let a = y < 0.5 ? Math.sqrt(2 * y) : y + Math.log(1 + y) + 1;
    for (let k = 0; k < 80; k++) {
      const f = a - Math.log1p(a) - y;
      if (Math.abs(f) <= 1e-13 * Math.max(1, y)) break;
      const na = a - f / Math.max(a / (1 + a), 1e-12);
      a = na > 0 ? na : a * 0.5;
    }
    tab[i] = a;
  }
  return tab;
})();
export function launchSpeed(h, tau) {
  if (h <= 0) return 0;
  const gt = G * tau, u = (Math.log10(h / (gt * tau)) + 7) / 12 * 511;
  if (u <= 0) return Math.sqrt(2 * G * h);
  const i = Math.min(Math.floor(u), 510), f = Math.min(u - i, 1);
  return (APEX_TAB[i] * (1 - f) + APEX_TAB[i + 1] * f) * gt;
}
// Time after launch when the falling particle reaches height yEnd (< apex), by Newton's method.
function dragTimeTo(v0, tau, yEnd) {
  const gt = G * tau;
  let t = tau * Math.log(1 + Math.max(v0, 0) / gt) + Math.sqrt(2 * Math.max(dragApex(Math.max(v0, 0), tau) - yEnd, 0) / G);
  for (let i = 0; i < 25; i++) {
    const f = dragY(v0, tau, t) - yEnd, d = -gt + (v0 + gt) * Math.exp(-t / tau);
    if (Math.abs(f) < 1e-5 || d > -1e-6) break;
    t -= f / d;
  }
  return Math.max(t, 0.05);
}

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = THREE.MathUtils.clamp;
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };

// ================================================================================================
// Shared pieces of the life modules (birds.js uses them too)
// ================================================================================================
// The atmosphere's vertex-safe GLSL core (aerial perspective, cloud shadow; pass-throughs stand in on
// a bare dev page) plus the shared light uniforms it does not declare, and their uniform objects.
const LIGHTS = [['vec3', 'uSunDir'], ['vec3', 'uSunIlluminance'], ['vec3', 'uMoonDir'], ['vec3', 'uMoonIlluminance'], ['float', 'uTime']];
export function lifeGlsl(ctx) {
  const a = ctx.atmosphere, core = a?.glslCore ?? '';
  const ok = /applyAerialPerspective\s*\(/.test(core) && /cloudShadow\s*\(/.test(core);
  return {
    glsl: (ok ? core : 'vec3 applyAerialPerspective(vec3 c, vec3 p) { return c; }\nfloat cloudShadow(vec3 p) { return 1.0; }\n')
      + LIGHTS.filter(([, n]) => !new RegExp(`uniform\\s+\\w+\\s+${n}\\b`).test(core)).map(([t, n]) => `uniform ${t} ${n};\n`).join(''),
    uniforms: { ...(a?.uniforms ?? {}), ...Object.fromEntries(LIGHTS.map(([, n]) => [n, U[n]])) },
  };
}
// An instanced copy of `base` whose per-instance vec4 attributes (`names`) the CPU writes by index;
// the ranges written since the last upload go to the GPU once per frame.
export class InstanceBuffer {
  constructor(base, names, capacity) {
    this.capacity = capacity;
    this.geometry = new THREE.InstancedBufferGeometry().copy(base);
    this.geometry.instanceCount = 0;
    this.attrs = names.map((n) => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage);
      this.geometry.setAttribute(n, a);
      return a;
    });
    this.ranges = [];
  }
  // instance i: attribute k takes v[4k .. 4k + 3]
  set(i, v) {
    for (let k = 0; k < this.attrs.length; k++) this.attrs[k].array.set(v.slice(k * 4, k * 4 + 4), i * 4);
    this.mark(i);
  }
  mark(i) {
    const r = this.ranges[this.ranges.length - 1];
    if (r && i >= r[0] - 1 && i <= r[1] + 1) { r[0] = Math.min(r[0], i); r[1] = Math.max(r[1], i); } else this.ranges.push([i, i]);
  }
  upload(count) {
    let r = this.ranges;
    if (r.length > 8) r = [[Math.min(...r.map((q) => q[0])), Math.max(...r.map((q) => q[1]))]];
    if (r.length) for (const a of this.attrs) { a.clearUpdateRanges(); for (const [lo, hi] of r) a.addUpdateRange(lo * 4, (hi - lo + 1) * 4); a.needsUpdate = true; }
    this.ranges = [];
    this.geometry.instanceCount = count;
  }
  dispose() { this.geometry.dispose(); }
}
export function lifeMesh(geometry, material, root, name, order = 0, reflect = true) {
  const m = new THREE.Mesh(geometry, material);
  m.name = name; m.frustumCulled = false; m.renderOrder = order; m.visible = false;
  if (reflect) m.layers.enable(LAYER_REFLECT);
  root.add(m);
  return m;
}
// A square grid of (n + 1)² vertices over [-1, 1]² (n = 1: a quad).
export function gridGeometry(n) {
  const g = new THREE.PlaneGeometry(2, 2, n, n);
  g.deleteAttribute('normal'); g.deleteAttribute('uv');
  return g;
}
const QUAD = gridGeometry(1);
// Transparent, premultiplied alpha (NormalBlending then blends One, OneMinusSrcAlpha): light added
// where nothing blocks (glints) needs no coverage.
const PREMULT = { transparent: true, depthWrite: false, premultipliedAlpha: true };
// Foam cells, a tileable 256² texture generated once: r the distance to the nearest cell wall
// (F2 − F1 of ~1000 cells on a 32 × 32 grid, cell units: 0 on the walls, up to ~0.7 at a centre), g a
// random value per cell (uniform), b band-limited noise (24 random waves of 2-11 cycles per tile,
// mean 0.5, std ~0.15). Foam is a network of bubble clusters: it covers the cells out from their walls
// (Plateau borders) as it thickens, so thin foam is the walls' lace; g varies the cover cell by
// cell, b warps the cells and makes the outlines ragged. Real lace is no honeycomb: one jittered
// point per grid square, but where a smooth density field is low squares lose theirs (cells merge)
// and where it is high they get a second (cells split), so cells range ~3:1 in size (hole-size CV
// 0.57, a jittered grid's 0.36) while the wall-distance quantiles lfNet fits stay within ±0.005.
let FOAM_CELLS = null;
export function foamCells() {
  if (FOAM_CELLS) return FOAM_CELLS;
  const S = 256, C = 32, rnd = mulberry32(0xF0A4), ph = rnd() * TAU, W = [];
  // per grid square: its points (local x, y, cell value); dropped where sparse, split where dense
  // (the second point 0.35-0.65 of a square away on both axes)
  const pts = Array.from({ length: C * C }, (_, k) => {
    const dn = 0.8 * Math.sin(TAU * (k % C) / C * 2 + ph) * Math.cos(TAU * (k % C - 3 * Math.floor(k / C)) / C + 2 * ph), q = rnd(), x = rnd(), y = rnd();
    return q < -dn ? [] : [x, y, rnd(), ...(q < dn ? [(x + 0.35 + 0.3 * rnd()) % 1, (y + 0.35 + 0.3 * rnd()) % 1, rnd()] : [])];
  });
  while (W.length < 96) {
    const a = Math.round(lerp(-11, 11, rnd())), b = Math.round(lerp(-11, 11, rnd())), f = Math.hypot(a, b);
    if (f >= 2 && f <= 11) W.push(a * TAU / S, b * TAU / S, rnd() * TAU, 0.12 / Math.sqrt(f));
  }
  const data = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const fx = (x + 0.5) / S * C, fy = (y + 0.5) / S * C, cx = Math.floor(fx), cy = Math.floor(fy);
    let d1 = 99, d2 = 99, g = 0, b = 0.5;
    for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) {
      const l = pts[((cy + j + C) % C) * C + (cx + i + C) % C];
      for (let m = 0; m < l.length; m += 3) {
        const u = cx + i + l[m] - fx, v = cy + j + l[m + 1] - fy, d = u * u + v * v;
        if (d < d1) { d2 = d1; d1 = d; g = l[m + 2]; } else if (d < d2) d2 = d;
      }
    }
    for (let k = 0; k < 96; k += 4) b += W[k + 3] * Math.cos(W[k] * x + W[k + 1] * y + W[k + 2]);
    data.set([Math.min(255, (Math.sqrt(d2) - Math.sqrt(d1)) * 255), g * 255, clamp(b, 0, 1) * 255, 255], (y * S + x) * 4);
  }
  const t = FOAM_CELLS = new THREE.DataTexture(data, S, S);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}
// Share c of a foamCells network covered out from its walls (r: wall distance, j: per-cell value):
// the threshold on r is the quantile of r (a fit, ±0.03, of foamCells' distribution); j varies it
// cell by cell; aa = half a pixel in cell units; k = 1 when the pixel resolves the cells, else the
// mean c. 1 - lfNet(r, j, 1 - c, ...) covers c from the cells' centres instead (drops). lfHash: a
// uniform hash of an integer lattice point.
const NET_GLSL = /* glsl */`
float lfHash(vec2 c) {
  uvec2 u = uvec2(ivec2(c));
  uint h = u.x * 0x8da6b343u ^ u.y * 0xd8163841u;
  h ^= h >> 16; h *= 0x7feb352du; h ^= h >> 15;
  return float(h) * 2.3283064e-10;
}
float lfNet(float r, float j, float c, float aa, float k) {
  float cj = clamp(c * (0.7 + 0.6 * j), 0.0, 1.0);
  float w = cj * (0.389 + cj * (0.128 + 0.261 * pow(cj, 6.0)));
  return mix(c, clamp((w - r) / (2.0 * aa) + 0.5, 0.0, 1.0) * min(1.0, w / aa), k);
}
`;

// ================================================================================================
// Fish geometry
// ================================================================================================
// Local frame: +Z toward the snout (snout at z = SNOUT_Z·L), +Y dorsal, X lateral; the tail tip at
// z = (SNOUT_Z − 1)·L, so the bounding box length is exactly L. Attribute aFish = (s, yN, part, h):
// s along the body (0 snout .. 1 tail tip), yN from −1 (belly) to +1 (back), part (0 body, 1 fin,
// 2 finlet, 3 caudal fin), h = local half-height / L (scales the marking coordinates to metres).
export function buildFishGeometry(key) {
  const F = FISH_SPECIES[key], L = F.length, st = F.stations, RING = 12;
  const pos = [], fish = [], idx = [];
  const zOf = (s) => (SNOUT_Z - s) * L;
  const halfAt = (s) => {                         // interpolated [half-height, half-width] (fractions of L)
    for (let i = 1; i < st.length; i++) if (s <= st[i][0]) {
      const t = clamp((s - st[i - 1][0]) / (st[i][0] - st[i - 1][0]), 0, 1);
      return [lerp(st[i - 1][1], st[i][1], t), lerp(st[i - 1][2], st[i][2], t)];
    }
    return st[st.length - 1].slice(1);
  };
  const vert = (x, y, z, s, yN, part, h) => { pos.push(x, y, z); fish.push(s, yN, part, h); return pos.length / 3 - 1; };
  const fan = (ids) => { for (let k = 1; k < ids.length - 1; k++) idx.push(ids[0], ids[k], ids[k + 1]); };
  // body: elliptical rings (slightly flattened belly), closed with fans at snout and peduncle
  const tip = vert(0, 0, zOf(0), 0, 0, 0, 0.01);
  const rings = st.slice(1).map(([s, hh, hw]) => Array.from({ length: RING }, (_, j) => {
    const c = Math.cos(j / RING * TAU), sn = Math.sin(j / RING * TAU);      // 0 = back, π = belly
    return vert(hw * L * sn, hh * L * (c >= 0 ? c : c * 0.92), zOf(s), s, c, 0, hh);
  }));
  for (let j = 0; j < RING; j++) {
    const j1 = (j + 1) % RING;
    idx.push(tip, rings[0][j], rings[0][j1]);
    for (let i = 0; i < rings.length - 1; i++) idx.push(rings[i][j], rings[i + 1][j], rings[i][j1], rings[i][j1], rings[i + 1][j], rings[i + 1][j1]);
  }
  const last = rings[rings.length - 1], [sPed, hPed] = st[st.length - 1];
  const capC = vert(0, 0, zOf(sPed), sPed, 0, 0, hPed);
  for (let j = 0; j < RING; j++) idx.push(capC, last[(j + 1) % RING], last[j]);
  // flat fins (double-sided material), in metres; pts: [[x, y, s], ...] as a fan from pts[0]
  const flat = (pts, part) => fan(pts.map(([x, y, s]) => vert(x, y, zOf(s), s, Math.sign(y), part, halfAt(s)[0])));
  // caudal fin: forked (and for tunas lunate: lobes swept back with a curved leading edge)
  {
    const T = F.tail, hp = hPed * 0.95, span = T.span / 2, notchS = 1 - T.fork, midS = notchS + T.fork * 0.55;
    const leS = sPed + (1 - sPed) * (0.35 + 0.25 * T.lunate), leY = hp + (span - hp) * (0.45 + 0.25 * T.lunate);
    const lobe = (sg) => [[0, sg * hp * L, sPed], [0, sg * leY * L, leS], [0, sg * span * L, 1], [0, sg * span * 0.35 * L, midS], [0, 0, notchS]];
    flat(lobe(1), 3); flat(lobe(-1), 3); flat([[0, hp * L, sPed], [0, 0, notchS], [0, -hp * L, sPed]], 3);
  }
  for (const f of F.fins) {
    if (f.at === 'back' || f.at === 'belly') {
      // strip between the body and the fin's outline: spiny = rounded, falcate = tall front swept
      // back, default = trapezoid; the rays rake backward
      const sg = f.at === 'back' ? 1 : -1, n = 6;
      let prev = null;
      for (let k = 0; k <= n; k++) {
        const u = k / n, s = lerp(f.s0, f.s1, u), hs = halfAt(s)[0];
        const h = f.shape === 'falcate' ? f.h * Math.pow(1 - u, 1.4) * Math.min(u / 0.15, 1)
          : f.shape === 'spiny' ? f.h * Math.sin(Math.PI * Math.min(1, u * 1.05 + 0.02)) ** 0.7
          : f.h * (u < 0.3 ? 0.6 + u / 0.3 * 0.4 : 1 - (u - 0.3) / 0.7 * 0.75);
        const sT = Math.min(s + (f.shape === 'falcate' ? 0.35 : 0.15) * h, 0.99);
        const cur = [vert(0, sg * hs * 0.96 * L, zOf(s), s, sg, 1, hs), vert(0, sg * (hs * 0.96 + h) * L, zOf(sT), sT, sg, 1, hs)];
        if (prev) idx.push(prev[0], prev[1], cur[0], cur[0], prev[1], cur[1]);
        prev = cur;
      }
    } else {
      const [hh, hw] = halfAt(f.s), pec = f.at === 'pectoral', len = f.len * L;
      for (const sd of [-1, 1]) {
        const y0 = (pec ? -0.3 : -0.85) * hh * L, x0 = sd * hw * L * (pec ? 0.92 : 0.5);
        flat([[x0, y0, f.s], [x0 + sd * 0.35 * len, y0 - 0.25 * len, f.s + f.len * 0.85], [x0 + sd * 0.15 * len, y0 - 0.05 * len, f.s + f.len], [x0, y0 + 0.12 * len, f.s + 0.25 * f.len]], 1);
      }
    }
  }
  if (F.finlets) {
    for (const [where, sg] of [['back', 1], ['belly', -1]]) {
      const [s0, s1, n] = F.finlets[where], ds = (s1 - s0) / n;
      for (let k = 0; k < n; k++) {
        const s = s0 + (k + 0.5) * ds, y = sg * halfAt(s)[0] * L * 0.9;
        flat([[0, y, s - ds * 0.4], [0, y + sg * F.finlets.h * L, s + ds * 0.35], [0, y, s + ds * 0.45]], 2);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aFish', new THREE.Float32BufferAttribute(fish, 4));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.name = `fish.${key}`;
  return g;
}

// ================================================================================================
// Fish material: MeshStandardMaterial with the pose, tail wave and markings patched in
// ================================================================================================
const FISH_VERTEX_PARS = /* glsl */`
attribute vec4 aFish;      // s (snout 0 .. tail 1), yN (-1 belly .. +1 back), part, half-height / L
attribute vec4 iA;         // launch position (m), launch time (s)
attribute vec4 iB;         // velocity (m/s); w = duration (s)
attribute vec4 iC;         // mode, length scale, roll rate (rad/s) or roll amplitude (rad), seed
attribute vec4 iD;         // sea fit c1 (m/s), c2 (m/s^2), mode parameters
uniform float uTime;
uniform vec4 uSwim;        // tail-beat frequency (Hz), bend pivot (s), bend amplitude (fraction of L), geometry length L (m)
varying vec4 vFish;
`;
// Replaces <beginnormal_vertex>: evaluates the pose once, bends and orients the normal.
const FISH_POSE = /* glsl */`
vFish = aFish;
float fAge = uTime - iA.w, fDur = iB.w, fLen = uSwim.w * iC.y;
int fMode = int(iC.x + 0.5);
bool fAlive = fAge >= 0.0 && fAge <= fDur;
float fSea = iA.y + iD.x * fAge + iD.y * fAge * fAge;       // sea surface above the event (quadratic fit)
float fU = clamp(fAge / fDur, 0.0, 1.0), fPi = 3.14159265;
vec3 fP, fF;
float fRoll, fTumble = 0.0, fBeat;
if (fMode == ${M_LEAP}) {
  fP = iA.xyz + iB.xyz * fAge + vec3(0.0, -4.905 * fAge * fAge, 0.0);
  fF = normalize(iB.xyz + vec3(0.0, -9.81 * fAge, 0.0));
  fRoll = iC.z * fAge + iC.w * 6.2832;
  fTumble = iD.z * fAge;
  fBeat = iD.w;
} else {
  // along the surface at the sea fit, its centre iD.z L under it rising iD.w L in an arc, nosing
  // down at the end (the tail comes up)
  float spd = length(iB.xz);
  vec2 dir = spd > 1e-4 ? iB.xz / spd : vec2(0.0, 1.0);
  float amp = iD.w * fLen;
  float dy = iD.x + 2.0 * iD.y * fAge + amp * fPi / fDur * cos(fPi * fU);
  float pitch = atan(dy, max(spd, 0.3)) - 1.1 * smoothstep(0.55, 1.0, fU);
  fP = vec3(iA.x + dir.x * spd * fAge, fSea - iD.z * fLen + amp * sin(fPi * fU), iA.z + dir.y * spd * fAge);
  fF = vec3(dir.x * cos(pitch), sin(pitch), dir.y * cos(pitch));
  fRoll = iC.z * sin(fPi * fU);
  fBeat = 0.8;
}
// body frame: F forward, U dorsal, X = U x F, then roll about F and tumble about X
vec3 fX = normalize(cross(abs(fF.y) > 0.985 ? vec3(sin(iC.w * 6.2832), 0.0, cos(iC.w * 6.2832)) : vec3(0.0, 1.0, 0.0), fF));
vec3 fU0 = cross(fF, fX);
vec3 fX2 = fX * cos(fRoll) + fU0 * sin(fRoll), fU2 = cross(fF, fX2);
vec3 fF3 = fF * cos(fTumble) + fU2 * sin(fTumble), fU3 = cross(fF3, fX2);
mat3 fR = mat3(fX2, fU3, fF3);
// travelling tail wave: lateral offset grows behind the pivot, the wave runs toward the tail
float fw0 = max(aFish.x - uSwim.y, 0.0) / (1.0 - uSwim.y);
float fPh = 6.2832 * (uSwim.x * uTime - 0.9 * aFish.x) + iC.w * 31.0;
float fA = uSwim.z * uSwim.w * fBeat;
float fOff = fA * fw0 * fw0 * sin(fPh);
float fSlope = -fA * (2.0 * fw0 / (1.0 - uSwim.y) * sin(fPh) - fw0 * fw0 * 5.655 * cos(fPh)) / uSwim.w;   // dx/dz
vec3 objectNormal = fR * vec3(normal.xy, normal.z - fSlope * normal.x);
#ifdef USE_TANGENT
vec3 objectTangent = vec3(tangent.xyz);
#endif
`;
const FISH_BEGIN = /* glsl */`
vec3 transformed = fAlive ? fP + fR * (vec3(position.x + fOff, position.yz) * iC.y) : fP;   // dead instances collapse
`;
const FISH_FRAGMENT_PARS = /* glsl */`
varying vec4 vFish;
uniform vec3 uFishBack, uFishFlank, uFishBelly, uFishFin, uFishAccent, uFishFinlet;
uniform vec3 uFishMetal;       // metalness back, flank, belly
uniform vec3 uFishRough;       // roughness back, flank, belly
uniform vec4 uFishStripes;     // spacing (yN), strength, yN min, yN max
uniform vec4 uFishWavy;        // strength, s min, s max, yN min
uniform vec4 uFishSpots[6];    // s, yN, radius (fraction of L), darkness
void lifeFishPattern(vec4 f, out vec3 col, out float metal, out float rough) {
  float s = f.x, y = f.y, tBack = smoothstep(0.05, 0.55, y), tBelly = smoothstep(-0.2, -0.65, y);
  int part = int(f.z + 0.5);
  col = mix(mix(uFishFlank, uFishBack, tBack), uFishBelly, tBelly);
  metal = mix(mix(uFishMetal.y, uFishMetal.x, tBack), uFishMetal.z, tBelly);
  rough = mix(mix(uFishRough.y, uFishRough.x, tBack), uFishRough.z, tBelly);
  if (part == 0) {
    float k = 0.0;
    if (y > uFishStripes.z && y < uFishStripes.w) {                       // lengthwise stripes
      float d = abs(fract((y - uFishStripes.z) / uFishStripes.x + 0.5) - 0.5);
      k = (1.0 - smoothstep(0.1, 0.2, d)) * smoothstep(0.16, 0.24, s) * (1.0 - smoothstep(0.78, 0.84, s)) * uFishStripes.y;
    }
    if (y > uFishWavy.w)                                                  // wavy dorsal lines
      k = max(k, smoothstep(0.35, 0.8, sin(y * 34.0 + 3.2 * sin(s * 48.0) + s * 18.0)) * smoothstep(uFishWavy.y, uFishWavy.y + 0.05, s) * (1.0 - smoothstep(uFishWavy.z - 0.05, uFishWavy.z, s)) * uFishWavy.x);
    for (int i = 0; i < 6; i++) {                                         // spots
      vec4 sp = uFishSpots[i];
      if (sp.w > 0.0) k = max(k, (1.0 - smoothstep(sp.z * 0.65, sp.z, length(vec2(s - sp.x, (y - sp.y) * f.w)))) * sp.w);
    }
    col = mix(col, uFishAccent, k);
    metal *= 1.0 - 0.8 * k;
  } else {
    col = part == 1 ? uFishFin : (part == 2 ? uFishFinlet : mix(uFishFin, uFishBack, 0.5));
    metal = 0.05; rough = 0.55;
  }
}
`;
function createFishMaterial(key) {
  const F = FISH_SPECIES[key], look = F.look, c = (hex) => ({ value: new THREE.Color(hex) }), v = (a) => ({ value: new THREE.Vector4(...a) });
  const uniforms = {
    uTime: U.uTime, uSwim: v([F.swim.beatHz, F.swim.pivot, F.swim.amp, F.length]),
    uFishBack: c(look.back), uFishFlank: c(look.flank), uFishBelly: c(look.belly), uFishFin: c(look.fin), uFishAccent: c(look.accent), uFishFinlet: c(look.finlet ?? look.fin),
    uFishMetal: { value: new THREE.Vector3(...look.metal) }, uFishRough: { value: new THREE.Vector3(...look.rough) },
    uFishStripes: v(look.stripes ?? [1, 0, 2, 2]), uFishWavy: v(look.wavy ?? [0, 0, 0, 2]),
    uFishSpots: { value: Array.from({ length: 6 }, (_, i) => new THREE.Vector4(...(look.spots?.[i] ?? [0, 0, 0, 0]))) },
  };
  const mat = new THREE.MeshStandardMaterial({ name: `fish.${key}`, side: THREE.DoubleSide });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\n${FISH_VERTEX_PARS}`)
      .replace('#include <beginnormal_vertex>', FISH_POSE).replace('#include <begin_vertex>', FISH_BEGIN);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\n${FISH_FRAGMENT_PARS}`)
      .replace('#include <color_fragment>', 'vec3 fishCol; float fishMetal, fishRough;\nlifeFishPattern(vFish, fishCol, fishMetal, fishRough);\ndiffuseColor.rgb = fishCol;')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = fishRough;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = fishMetal;');
  };
  mat.customProgramCacheKey = () => 'life-fish-v2';
  return applyAtmosphere(mat);
}
// One species' instanced fish: launches evaluated on the GPU. launch(a, b, c, d) takes the four
// instance vectors of FISH_POSE: a = [x, y, z, t0], b = [vx, vy, vz, duration], c = [mode, scale,
// roll, seed], d = [sea c1, sea c2, p, q]. Live instances stay packed at [0, live): an expired one is
// replaced by the last live one, so the draw never runs the vertex shader for dead fish.
export class FishInstances {
  constructor(key, capacity, root, { reflect = true } = {}) {
    this.key = key; this.root = root; this.reflect = reflect;
    this.base = buildFishGeometry(key);
    this.material = createFishMaterial(key);
    this.resize(capacity);
  }
  /** A new capacity (a quality switch; the fish in the air are dropped). */
  resize(capacity) {
    if (capacity === this.capacity) return;
    if (this.mesh) { this.root.remove(this.mesh); this.buf.dispose(); }
    this.capacity = capacity;
    this.buf = new InstanceBuffer(this.base, ['iA', 'iB', 'iC', 'iD'], capacity);
    this.mesh = lifeMesh(this.buf.geometry, this.material, this.root, `blitz.fish.${this.key}`, 0, this.reflect);
    this.ends = new Float64Array(capacity); this.live = 0;
  }
  launch(a, b, c, d) {
    let i = this.live;
    if (i >= this.capacity) i = this.ends.indexOf(Math.min(...this.ends));   // full: replace the one that ends first
    else this.live++;
    this.buf.set(i, [...a, ...b, ...c, ...d]);
    this.ends[i] = a[3] + b[3];
  }
  // Removes the fish whose time is up, uploads what changed, sets the draw count.
  flush(t, visible) {
    for (let i = this.live - 1; i >= 0; i--) {
      if (this.ends[i] >= t) continue;
      const last = --this.live;
      if (i === last) continue;
      for (const a of this.buf.attrs) a.array.copyWithin(i * 4, last * 4, last * 4 + 4);
      this.ends[i] = this.ends[last];
      this.buf.mark(i);
    }
    this.buf.upload(this.live);
    this.mesh.visible = visible && this.live > 0;
  }
  clear() { this.live = 0; this.buf.upload(0); this.mesh.visible = false; }
  dispose() { this.buf.dispose(); this.base.dispose(); this.material.dispose(); }
}

// ================================================================================================
// Spray: velocity-stretched sprites on analytic linear-drag trajectories
// ================================================================================================
const SPRAY_VS = (glsl) => /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>
${glsl}
attribute vec4 aPosT;      // launch position (m), launch time (s)
attribute vec4 aVelTau;    // launch velocity (m/s), drag time constant (s)
attribute vec4 aShape;     // radius (m), growth (1/s: blobs) | speed spread (clumps, veil) | body length (bait), opacity, kind
attribute vec4 aLife;      // life (s), seed, air velocity x, z (m/s)
uniform float uPxPerM;     // pixels per metre at 1 m depth (viewport height / (2 tan(fov/2)))
uniform vec3 uAbsorb;      // sea-water absorption (1/m)
varying vec3 vWorld;
varying vec4 vQuad;        // along (radii), across (radii), half streak (radii), kind
varying vec4 vMisc;        // coverage (bait: alpha), age, seed, bait: which side is the back
varying vec4 vOpt;         // the parcel's water: optical depth at its centre, share it covers, drop stage, aeration
varying vec2 vAxis;        // streak direction (view space)
varying vec3 vLight;       // sun phase, moon phase, cloud shadow
varying vec3 vTint;        // transmission through the parcel's water
varying vec3 vAPt;         // aerial perspective: transmittance x pre-exposure
varying vec3 vAPs;         // aerial perspective: pre-exposed in-scatter
float sprayHG(float g, float c) { float d = 1.0 + g * g - 2.0 * g * c; return (1.0 - g * g) / (12.5663706 * d * sqrt(d)); }
// forward-peaked phase of large drops with a weak backscatter lobe (two-term Henyey-Greenstein)
float sprayPhase(vec3 L, vec3 V) { float c = dot(-L, V); return 0.78 * sprayHG(0.8, c) + 0.22 * sprayHG(-0.25, c); }
void main() {
  float age = uTime - aPosT.w, life = aLife.x, kind = aShape.w, tau = aVelTau.w;
  if (age < 0.0 || age > life) { gl_Position = vec4(0.0, 0.0, -2.0, 1.0); vMisc = vec4(0.0); return; }
  vec3 vTerm = vec3(aLife.z, -9.81 * tau, aLife.w);
  float e = exp(-age / tau);
  vec3 p = aPosT.xyz + vTerm * age + (aVelTau.xyz - vTerm) * tau * (1.0 - e);
  vec3 v = vTerm + (aVelTau.xyz - vTerm) * e;
  bool bait = kind > 4.5;
  // A parcel's drops left with a spread of speeds (aShape.y for clumps and veil, 0.22 for blobs): it
  // stretches along its launch direction by spread x v0 x age, the radiating streaks of a real
  // crown. Blobs also grow (aShape.y per second).
  float radius = aShape.x * (1.0 + (kind > 1.5 && !bait ? aShape.y : 0.0) * age);
  float u = age / life, op = aShape.z;
  // The parcel's water, optical depth op x tau through its centre, tears as it flies: holes open in
  // the sheet and grow until it is a web of ligaments covering a share c of the parcel, then the web
  // breaks into drops (stage s). Bulk aerated water (blobs) spreads (tau ~ 1 / area) and is white
  // where thick; a veil of drops is thinner and tears sooner.
  vOpt = vec4(3.0 * op * (1.0 - smoothstep(0.85, 1.0, u)), 1.0, 0.0, 0.35);                                  // clump
  if (kind > 1.5) {
    float g = 1.0 + aShape.y * age, s = smoothstep(0.12, 0.4, age);
    vOpt = vec4(4.5 * op / (g * g) * (1.0 - smoothstep(0.55, 1.0, u)), mix(mix(0.85, 0.45, smoothstep(0.02, 0.2, age)), 0.3, s), s, 1.0 - 0.6 * s);
  } else if (kind > 0.5) {
    float s = smoothstep(0.08, 0.28, age);
    vOpt = vec4(2.2 * op * (1.0 - smoothstep(0.8, 1.0, u)), mix(mix(0.8, 0.35, smoothstep(0.02, 0.15, age)), 0.25, s), s, 0.5);
  }
  if (kind > 0.5) vOpt.y *= 1.0 - 0.5 * smoothstep(0.35, 0.9, age);                         // the drops fly apart
  vec4 mv = viewMatrix * vec4(p, 1.0);
  float mPerPx = max(-mv.z, 0.05) / uPxPerM;
  // streak: a fish's body along its path, or a parcel's spread along its path (beyond ~2.5 radii its
  // drops have separated: droplets, not sticks), plus motion blur over the shutter time
  vec3 sprW;
  if (bait) sprW = normalize(v + vec3(0.0, 1e-5, 0.0)) * max(aShape.y - 2.0 * radius, 0.0);
  else {
    sprW = aVelTau.xyz * ((kind < 1.5 ? aShape.y : 0.22) * age);
    float l = length(sprW);
    if (l > 2.5 * radius) sprW *= 2.5 * radius / l;
  }
  vec3 vv = mat3(viewMatrix) * (sprW + v * ${SHUTTER_S.toFixed(6)});
  float sp = length(vv.xy), halfSeg = 0.5 * sp;
  vec2 axis = sp > 1e-6 ? vv.xy / sp : vec2(1.0, 0.0);
  float rc = min(radius, ${MAX_SPRITE_PX.toFixed(1)} * mPerPx), r = max(rc, ${MIN_SPRITE_PX.toFixed(3)} * mPerPx);
  // coverage kept true when the sprite is fattened to the minimum size (a fish's area; a drop's,
  // spread along its streak)
  float cover = bait ? rc * (halfSeg + rc) / (r * (halfSeg + r)) : rc * rc / (r * r) / (1.0 + 1.2732 * halfSeg / r);
  float along = position.x * (r + halfSeg);
  mv.xy += axis * along + vec2(-axis.y, axis.x) * (position.y * r);
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
  vWorld = p;
  vQuad = vec4(along / r, position.y, halfSeg / r, kind);
  vMisc = vec4((bait ? op : 1.0) * cover, age, aLife.y, axis.x < 0.0 ? -1.0 : 1.0);
  vAxis = axis;
  vec3 V = normalize(cameraPosition - p);
  vLight = vec3(sprayPhase(uSunDir, V), sprayPhase(uMoonDir, V), cloudShadow(p));
  vTint = exp(-uAbsorb * (kind > 1.5 ? 2.0 * radius : radius));
  vAPs = applyAerialPerspective(vec3(0.0), p);
  vAPt = applyAerialPerspective(vec3(1.0), p) - vAPs;
}`;
const SPRAY_FS = /* glsl */`
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uSunDir, uSunIlluminance, uMoonDir, uMoonIlluminance;
uniform vec3 uSkyE;            // sky irradiance / pi (absolute)
uniform vec3 uSkyHor;          // horizon sky radiance
uniform sampler2D uCells;      // foamCells(): the tear pattern
varying vec3 vWorld;
varying vec4 vQuad;
varying vec4 vMisc;
varying vec4 vOpt;
varying vec2 vAxis;
varying vec3 vLight;
varying vec3 vTint;
varying vec3 vAPt;
varying vec3 vAPs;
${NET_GLSL}
vec3 sprayHash(float n) { return fract(sin(vec3(n, n + 17.13, n + 41.71)) * vec3(43758.5453, 22578.1459, 19642.3490)); }
// Light scattered toward the camera by spray lit from Ld with irradiance E. ms: share of multiple
// scattering (dense water: white, Lambert-like); thin spray scatters once with the phase ph of
// large drops, tinted by the water the light crossed.
vec3 sprayLight(vec3 E, vec3 Ld, vec3 N, float ph, float ms) {
  return mix(E * (0.97 * ph) * vTint, E * (0.82 / 3.14159265) * max(0.45 * dot(N, Ld) + 0.55, 0.0), ms);
}
// Sky radiance along d, from the horizon and zenith radiances (the sea below: dark).
vec3 spraySky(vec3 d) { return d.y < 0.0 ? uSkyHor * 0.1 : mix(uSkyHor, uSkyE * 0.8, sqrt(d.y)); }
// a facet flashing when it turns to the sun (normalised Blinn-Phong lobe, facet re-rolled at hz)
float sprayGlint(vec3 V, float spread, float n, float hz, float salt) {
  vec3 H = normalize(uSunDir + V);
  vec3 fn = normalize(H * spread + sprayHash(vMisc.z * salt + floor(vMisc.y * hz + vMisc.z * 13.0)) - 0.5);
  return pow(max(dot(fn, H), 0.0), n);
}
void main() {
  #include <logdepthbuf_fragment>
  float a0 = vMisc.x, kind = vQuad.w;
  // the tear pattern: foamCells in the parcel's own frame (~3 cells per radius, shifted by its
  // seed); its gradients are taken here, before any discard
  vec2 pq = vec2(vQuad.x / (1.0 + vQuad.z), vQuad.y) * (0.09 + 0.06 * vOpt.z) + vMisc.z * vec2(7.31, 3.17);
  vec2 gx = dFdx(pq), gy = dFdy(pq);
  if (a0 <= 0.002) discard;
  bool bait = kind > 4.5;
  float dx = max(abs(vQuad.x) - vQuad.z, 0.0);
  // a bait fleck tapers to a spindle
  float yq = bait ? vQuad.y / max(1.0 - 0.75 * pow(vQuad.x / (vQuad.z + 1.0), 2.0), 0.15) : vQuad.y;
  float r2 = dx * dx + yq * yq;
  if (r2 >= 1.0) discard;
  // pseudo-sphere normal of the streak's cross-section, view space -> world
  vec3 nV = vec3(vAxis * (sign(vQuad.x) * dx) + vec2(-vAxis.y, vAxis.x) * vQuad.y, sqrt(max(1.0 - r2, 0.0)));
  vec3 N = normalize(transpose(mat3(viewMatrix)) * nV);
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 Es = uSunIlluminance * vLight.z, L, add = vec3(0.0);
  float up = 0.5 + 0.5 * N.y, alpha;
  if (bait) {
    // a silver fish: dark back, mirror-like flank (guanine) that mirrors the sky and flashes when a
    // flip turns it to the sun (F0 ~0.6, n = 200)
    alpha = a0 * (1.0 - smoothstep(0.45, 1.0, r2));
    float fl = smoothstep(-0.2, 0.5, -vQuad.y * vMisc.w);
    L = mix(vec3(0.07, 0.09, 0.08), vec3(0.55, 0.57, 0.55), fl) * ((Es * max(dot(N, uSunDir), 0.0) + uMoonIlluminance * max(dot(N, uMoonDir), 0.0)) * 0.26 + uSkyE * (0.5 + 0.5 * up))
      + (0.1 + 0.4 * fl) * spraySky(reflect(-V, N));
    if (uSunDir.y > 0.0) L += Es * 4.9 * sprayGlint(V, 1.25, 200.0, 7.0, 131.0);
    L *= alpha;
  } else {
    // Where the water is (the web, then the drops: 1 inside it, its share c where the pixel does
    // not resolve the cells) and how thick it is there: optical depth through the parcel (a chord
    // of the streak's cross-section) over the share it covers
    vec4 cl = textureGrad(uCells, pq, gx, gy);
    // (a blob's thick core holds together until its cell turns to drops; its thin rim tears first)
    bool drop = cl.g < vOpt.z;
    float aa = max(16.0 * max(length(gx), length(gy)), 0.004), k = 1.0 - smoothstep(0.15, 0.4, aa);
    float c = drop || kind < 1.5 ? vOpt.y : mix(vOpt.y, 1.0, smoothstep(0.35, 0.85, nV.z));
    // where the pixel does not resolve the cells: a speckle of whole drops and strands (share c of
    // ~pixel-sized lattice cells in the parcel's frame, power-of-two sized so it holds still), not
    // a smooth haze
    float px = exp2(floor(log2(2.0 * aa) + 0.5));
    vec2 pc = floor(pq * 32.0 / px);
    float cover = a0 * mix(step(lfHash(pc), c), drop ? 1.0 - lfNet(cl.r, cl.g, 1.0 - c, aa, 1.0) : lfNet(cl.r, cl.g, c, aa, 1.0), k);
    float tl = vOpt.x * nV.z / max(c, 0.05), aw = 1.0 - exp(-tl);
    // white where aerated water is thick (multiple scattering); thin water and drops scatter once,
    // forward-peaked, tinted by the water the light crossed
    float ms = vOpt.w * (1.0 - exp(-0.5 * tl));
    L = sprayLight(Es, uSunDir, N, vLight.x, ms) * step(-0.05, uSunDir.y) + sprayLight(uMoonIlluminance, uMoonDir, N, vLight.y, ms) * step(-0.05, uMoonDir.y);
    // sky from above, the sea's ~6 % from below
    L += (0.85 * uSkyE * mix(0.55, 1.0, up) + 0.06 * (uSkyE + Es / 3.14159265) * (1.0 - up)) * mix(0.55, 0.95, ms);
    // a coherent surface (sheet, ligament, clump) also reflects the sky (Schlick,
    // F0 = 0.02) where the water is thin, and its facets flash in the sun, cell by cell
    float film = (1.0 - 0.6 * vOpt.z) * (1.0 - aw), F = 0.02 + 0.98 * pow(1.0 - clamp(nV.z, 0.0, 1.0), 5.0);
    alpha = cover * (aw + film * F);
    L = cover * (aw * L + film * F * spraySky(reflect(-V, N)));
    // A drop always has a point that mirrors the sun (Fresnel at the half angle: faint with the sun
    // behind the camera, brilliant against it); a few per cent of the drops, re-rolled as they tumble.
    vec3 H = normalize(uSunDir + V);
    if (uSunDir.y > 0.0) add = cover * Es * ((kind < 0.5 ? 0.36 : 0.12) * sprayGlint(V, 0.9, 300.0, 9.0, 97.0 + 61.0 * cl.g)
      + (drop ? 6.0 : 0.0) * pow(1.0 - dot(H, V), 5.0) * step(0.97, lfHash(pc + floor(vMisc.y * 20.0) * 71.0)));
  }
  if (alpha < 0.002) discard;
  gl_FragColor = vec4((L + add) * vAPt + vAPs * alpha, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// Instances launched at a time (v[3]) for a life: a ring buffer (the oldest is overwritten) drawn as
// one mesh while anything in it lives.
class LaunchRing {
  constructor(base, names, capacity, material, root, name, order, reflect) {
    Object.assign(this, { base, names, material, root, name, order, reflect });
    this.resize(capacity);
  }
  /** A new capacity (a quality switch; what is in the air is dropped). */
  resize(capacity) {
    if (this.buf) { this.root.remove(this.mesh); this.buf.dispose(); }
    this.buf = new InstanceBuffer(this.base, this.names, capacity);
    this.mesh = lifeMesh(this.buf.geometry, this.material, this.root, this.name, this.order, this.reflect);
    this.capacity = capacity;
    this.clear();
  }
  add(life, v) {
    const i = this.cursor;
    this.cursor = (i + 1) % this.capacity;
    this.used = Math.max(this.used, i + 1);
    this.buf.set(i, v);
    this.lastEnd = Math.max(this.lastEnd, v[3] + life);
  }
  update(t, visible) { this.buf.upload(this.used); this.mesh.visible = visible && this.used > 0 && t <= this.lastEnd + 0.1; }
  clear() { this.buf.attrs[0].array.fill(-1e9); this.buf.mark(0); this.buf.mark(this.capacity - 1); this.used = this.cursor = 0; this.lastEnd = -1e9; }
  dispose() { this.buf.dispose(); }
}

class SprayField extends LaunchRing {
  constructor(ctx, capacity, root, skyE) {
    const L = lifeGlsl(ctx);
    const uniforms = { ...L.uniforms, uPxPerM: { value: 1000 }, uAbsorb: { value: new THREE.Vector3(...SEA.absorption) }, uSkyE: skyE, uSkyHor: U.uFogInscatter, uCells: { value: foamCells() } };
    super(QUAD, ['aPosT', 'aVelTau', 'aShape', 'aLife'], capacity, new THREE.ShaderMaterial({
      name: 'blitz.spray', uniforms, vertexShader: SPRAY_VS(L.glsl), fragmentShader: SPRAY_FS, ...PREMULT,
    }), root, 'blitz.spray', 2, true);
    this.uniforms = uniforms;
    this.launched = 0;                 // sprites written since construction (budget bookkeeping)
    this._size = new THREE.Vector2();
  }
  // x, y, z, t0 | vx, vy, vz, tau | radius, growth, opacity, kind | life, seed, air x, air z
  add(...v) { this.launched++; super.add(v[12], v); }
  update(renderer, camera, t, visible) {
    renderer.getDrawingBufferSize(this._size);
    this.uniforms.uPxPerM.value = this._size.y / (2 * Math.tan(camera.fov * DEG / 2));
    super.update(t, visible);
  }
  dispose() { super.dispose(); this.material.dispose(); }
}

// ================================================================================================
// White water on the sea
// ================================================================================================
// One density law for a strike's white water (used by the foam-map stamps and the decals alike):
// q metres from the strike (attack frame, elongation divided out); n outline noise (0..1, the foam
// cells' noise, anchored in the water); W = (radius when spread (m), strength, e-folds of
// the dense foam and the lace (s)); r0 cavity radius (m). Returns (foam thickness, lace, aerated
// water, open cavity). Thickness above 1 is the fresh, heaped white water of the first second; the
// foam spreads from 0.55 to 1.15 of its radius within ~1 s and thins from its centre out; lace
// reaches a little further and lasts 1.2-1.6 e-folds; the bubble cloud beneath (aerated green
// water) reaches ~2 radii and outlasts the white (e-fold 1.5 W.z + 1 s), so a strike grades from
// white to green to lace; the cavity the fish tore stays open ~0.3 s. Nothing reaches beyond 2.4
// radii (the stamps' and decals' extent).
const FOAM_GLSL = /* glsl */`
vec4 lfWhite(vec2 q, float n, vec4 W, float r0, float age) {
  float R = W.x * (0.55 + 0.6 * (1.0 - exp(-age / 0.8))) + 0.015 * age;
  float rn = length(q) / (R * (0.45 + 1.1 * n));
  float hole = (1.0 - smoothstep(0.08, 0.35, age)) * (1.0 - smoothstep(0.55, 1.0, length(q) / r0));
  return vec4(W.y * (exp(-age / W.z) + 0.7 * exp(-age / 0.6) * (1.0 - smoothstep(0.0, 0.8, rn))) * (1.0 - smoothstep(0.15, 1.0, rn)) * (1.0 - hole),
    0.8 * W.y * exp(-age / W.w) * (1.0 - smoothstep(0.5, 1.35, rn)) * (1.0 - smoothstep(1.2 * W.w, 1.6 * W.w, age)),
    W.y * exp(-age / (1.5 * W.z + 1.0)) * (1.0 - smoothstep(0.3, 1.9, length(q) / (R * (0.8 + 0.4 * n)))),
    hole);
}
`;
const FOAM_VS = (glsl, curv) => /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>
${glsl}
${curv}
// the ocean's displaced surface (ocean.displacementUniforms(), shared by reference)
uniform sampler2D uDisp0, uDisp1;   // geometry cascades 0-1: (Dx, eta, Dz)
uniform vec4 uOcCas[2];      // cascade frame: cos, sin, 1 / tile, metres per texel
uniform vec2 uOcOff[2];      // uv offsets of the snap origin
uniform vec2 uSnap;          // snap origin (world x, z)
uniform vec4 uRing;          // grid: inner spacing s0 (m), ln(1 + a), growth a, rings
uniform vec4 uGrid;          // grid: heading, warp, segments, lod scale
uniform float uLfSeaOn;
uniform vec3 uSkyE;          // sky irradiance / pi (absolute)
uniform vec2 uDrift;         // surface drift of foam (m/s)
attribute vec4 dA;           // x, sea y at emission, z, t0               | foam map: centre x, y, z, -
attribute vec4 dB;           // radius (m), strength, e-fold dense, lace (s) | half extents x, z, -, -1
attribute vec4 dC;           // elongation, attack angle (rad), seed, cavity radius (m)
varying vec4 vB;
varying vec4 vC;
varying vec3 vQ;             // metres from the strike (attack frame, elongation divided out), age | -, -, -1
varying vec3 vWorld;
varying vec3 vN;             // sea normal
varying vec3 vEs;            // sun irradiance / pi (cloud-shadowed)
varying vec3 vEd;            // diffuse irradiance / pi: sky and moon
varying vec3 vAPt;           // aerial perspective: transmittance x pre-exposure
varying vec3 vAPs;           // aerial perspective: pre-exposed in-scatter
vec2 lfUv(int c, vec2 q) { vec4 a = uOcCas[c]; return vec2(a.x * q.x + a.y * q.y, -a.y * q.x + a.x * q.y) * a.z + uOcOff[c]; }
vec3 lfDisp(vec2 q, float sp) {
  return textureLod(uDisp0, lfUv(0, q), log2(max(uGrid.w * sp / uOcCas[0].w, 1.0))).xyz
       + textureLod(uDisp1, lfUv(1, q), log2(max(uGrid.w * sp / uOcCas[1].w, 1.0))).xyz;
}
// elevation of the displaced sea above world (x, z): one fixed-point step of the chop inversion,
// band-limited like the ocean mesh at this range
float lfEta(vec2 w, float sp) { vec2 q = w - uSnap; return lfDisp(q - lfDisp(q, sp).xz, sp).y; }
void main() {
  bool map = dB.w < 0.0;     // (not t0 < 0: strikes pre-rolled at t < 8 s have negative launch times)
  float age = uTime - dA.w;
  float R = dB.x * (0.55 + 0.6 * (1.0 - exp(-age / 0.8))) + 0.015 * age;
  if ((!map && (age < 0.0 || age > max(3.2 * dB.z, 1.6 * dB.w))) || dB.y <= 0.0) { gl_Position = vec4(0.0, 0.0, -2.0, 1.0); return; }
  vec2 ad = vec2(cos(dC.y), sin(dC.y));
  vec2 loc = map ? position.xy * dB.xy : (ad * (position.x * max(dC.x, 1.0)) + vec2(-ad.y, ad.x) * position.y) * 2.4 * R;
  vec2 w = dA.xz + (map ? vec2(0.0) : uDrift * age) + loc;
  vec3 up = vec3(0.0, 1.0, 0.0);
  float y = dA.y;
  if (uLfSeaOn > 0.5) {
    float rc = length(w - cameraPosition.xz);
    // the mesh's vertex spacing here: radial s0 + a r, angular r dθ (dθ ahead of the camera)
    float sp = max(uRing.x + uRing.z * rc, rc * 6.2832 * max(1.0 - uGrid.y, 0.2) / max(uGrid.z, 16.0)), h = max(0.35, 0.5 * sp);
    float e0 = lfEta(w, sp);
    up = normalize(vec3(e0 - lfEta(w + vec2(h, 0.0), sp), h, e0 - lfEta(w + vec2(0.0, h), sp)));
    y = e0 - curvatureDrop(w);
  }
  vec3 wp = vec3(w.x, y, w.y);
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  // depth bias: the vertex slides toward the camera along its own view ray (same screen position),
  // so the sea mesh's interpolation between its own vertices cannot hide the foam
  float dd = max(-mv.z, 0.05);
  mv.xyz *= max(dd - (0.06 + 0.006 * dd), 0.05) / dd;
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
  vB = dB; vC = dC;
  vQ = map ? vec3(0.0, 0.0, -1.0) : vec3(dot(loc, ad) / max(dC.x, 1.0), dot(loc, vec2(-ad.y, ad.x)), age);
  vWorld = wp;
  vN = up;
  vEs = uSunIlluminance * cloudShadow(wp) / PI;
  vEd = uSkyE + uMoonIlluminance * max(dot(up, uMoonDir), 0.0) / PI;
  vAPs = applyAerialPerspective(vec3(0.0), wp);
  vAPt = applyAerialPerspective(vec3(1.0), wp) - vAPs;
}`;
// Foam on the water (see foamCells): rafts of ~40 cm made of bubble clusters of ~10 cm, slightly
// warped by the noise. Foam is a network: a density covers the cells out from their walls, so thin
// foam is a lace of strands along the walls and dense foam a sheet with round holes at the cells'
// centres that shrink and close as it thickens. Each raft has its own threshold, so holes open in
// some rafts first. Both scales share the density (their product); each counts while a pixel
// resolves it, else at its mean, so the cover stays the density at any range without speckle.
// Opacity and whiteness follow the foam's thickness: fresh heaped white water is opaque and white,
// an aging patch grey and translucent, lace a veil. Relief: rafts and clusters dome up.
const FOAM_FS = /* glsl */`
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uSunDir;
uniform float uTime;
uniform sampler2D uFoamMap;  // FoamMap: foam thickness, lace, aerated water, cavity
uniform vec4 uFoamArea;      // map centre (world x, z), 1 / map size (1/m)
uniform sampler2D uCells;    // foamCells()
uniform vec2 uAnchor;        // pattern origin (world x, z)
uniform vec2 uDrift;
varying vec4 vB;
varying vec4 vC;
varying vec3 vQ;
varying vec3 vWorld;
varying vec3 vN;
varying vec3 vEs;
varying vec3 vEd;
varying vec3 vAPt;
varying vec3 vAPs;
${FOAM_GLSL}
${NET_GLSL}
// foamCells at p (m) scaled by s, with the pattern's screen gradients gx, gy (set in main)
vec2 gx, gy;
vec4 lfC(vec2 p, float s) { return textureGrad(uCells, p * s, gx * s, gy * s); }
void main() {
  #include <logdepthbuf_fragment>
  // pattern coordinates, anchored in the water and drifting with the foam, and their screen
  // gradients (taken here, in uniform control flow: every lookup below uses them explicitly)
  vec2 w = vWorld.xz - uAnchor - uDrift * uTime;
  gx = dFdx(w); gy = dFdy(w);
  float fp = sqrt(length(gx) * length(gy)), fm = max(length(gx), length(gy));   // metres per pixel: mean, longer side
  // warped: gently over metres (strands curve), and over decimetres in two independent directions
  // (cells of mixed shapes, wavy strands)
  vec2 ww = w + 0.8 * vec2(lfC(w, 0.05).b, lfC(w + 10.0, 0.05).b) - 0.4 + 0.35 * vec2(lfC(w, 0.37).b, lfC(w + 1.16, 0.37).b) - 0.175;
  vec4 cL = lfC(ww, 0.08);                         // rafts ~40 cm
  vec4 cS = lfC(ww + 1.19, 0.31);                  // bubble clusters ~10 cm
  vec2 aa = max(0.5 * fwidth(vec2(cL.r, cS.r)), 0.004);                           // half a pixel in cell units
  vec4 f = vQ.z < 0.0 ? textureLod(uFoamMap, (vWorld.xz - uFoamArea.xy) * uFoamArea.z + 0.5, 0.0)
                      : lfWhite(vQ.xy, lfC(w + 7.7 * vC.z, 0.13).b, vB, vC.w, vQ.z);
  if (f.x + f.y + f.z + f.w < 0.004) discard;
  // a scale counts while the pixel resolves it (mostly its mean size: at grazing views the cells are
  // resolved across the view and their edges are anti-aliased along it, see lfNet)
  vec2 k = 1.0 - smoothstep(vec2(0.07, 0.018), vec2(0.18, 0.045), vec2(mix(fp, fm, 0.3)));
  float d = clamp(f.x, 0.0, 1.0), fresh = smoothstep(0.9, 1.5, f.x);
  // covered share: dense foam, and the lace (thin strands along the walls, at most 70 % cover, in
  // patches of a metre or more, its strands broken every 0.3-1.6 m: cS.b)
  float c = 1.0 - (1.0 - d) * (1.0 - 0.7 * clamp(f.y, 0.0, 1.0) * smoothstep(0.35, 0.7, mix(0.5, cL.b, k.x)) * mix(1.0, 1.6 * smoothstep(0.32, 0.62, cS.b), k.x));
  float fill = lfNet(cL.r, cL.g, pow(c, 0.65), aa.x, k.x) * lfNet(cS.r, cS.g, pow(c, 0.35), aa.y, k.y);
  // optical depth: grows with the density (thin, grey and translucent at a patch's fringe and as it
  // ages; opaque in fresh white water) and heaps at the clusters' centres
  float T = (1.0 + 2.5 * min(f.x, 1.5)) * mix(1.0, 0.5 + 0.9 * smoothstep(0.0, 0.4, cS.r), k.y);
  float o = fill * (1.0 - exp(-T));
  // whiteness: thin foam greys; each raft and cluster a little different, clusters domed
  float thick = smoothstep(0.0, 1.2, f.x + 0.3 * f.y) * mix(1.0, 0.85 + 0.3 * cL.g, k.x) * mix(1.0, (0.8 + 0.3 * cS.g) * (0.7 + 0.4 * smoothstep(0.0, 0.35, cS.r)), k.y);
  // (no mound relief from the map's gradient: sunlit fresh white water clips anyway, round 4)
  vec3 N = vN;
  vec3 V = normalize(cameraPosition - vWorld);
  // lit by sun and sky: thin foam greyer, fresh foam whitest (the clusters' domes are in thick)
  vec3 L = mix(0.5, mix(0.65, 0.8, fresh), thick) * (vEs * max(dot(N, uSunDir), 0.0) + vEd * (0.6 + 0.4 * N.y));
  // (no per-bubble glints: ~2 cm cells only resolve within ~10 m; round 4 byte budget)
  // aerated water under and round fresh white water: the bubble cloud scatters light back up
  // through ~1 m of the green coastal water (red absorbed): pale jade, patchy, degassing within seconds
  float F = 0.02 + 0.98 * pow(1.0 - clamp(dot(vN, V), 0.0, 1.0), 5.0);
  vec3 aer = (vEd + vEs * max(uSunDir.y, 0.0)) * vec3(0.026, 0.115, 0.095) * f.z * (0.7 + 0.6 * (cL.b - 0.5)) * (1.0 - F) * (1.0 - o);
  // premultiplied over the water: foam and aerated water, then the cavity darkens it
  vec3 col = (L * vAPt + vAPs) * o + aer * vAPt;
  float al = o + 0.8 * f.w * (1.0 - o);
  gl_FragColor = vec4(col + vAPs * (al - o), al);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
// Stamps of the foam map: every strike's densities (FOAM_GLSL) and each blitz's scum, blended by
// maximum into the map (r dense, g lace, b aerated water, a cavity).
const STAMP_VS = /* glsl */`
attribute vec4 fA;           // x, z (m from the map centre), age (s), kind (0 strike, 1 scum)
attribute vec4 fB;           // as dB | scum: along and across radius (m), strength, -
attribute vec4 fC;           // as dC | scum: heading cos, sin, seed, -
uniform float uHalf;
uniform vec2 uOrigin;        // pattern coordinates of the map centre
varying vec2 vL;
varying vec2 vW;
varying vec4 vA;
varying vec4 vB;
varying vec4 vC;
void main() {
  float R = fB.x * (0.55 + 0.6 * (1.0 - exp(-fA.z / 0.8))) + 0.015 * fA.z;
  vec2 ad = fA.w > 0.5 ? fC.xy : vec2(cos(fC.y), sin(fC.y));
  vec2 ext = fA.w > 0.5 ? 1.3 * fB.xy : 2.4 * R * vec2(max(fC.x, 1.0), 1.0);
  vL = ad * (position.x * ext.x) + vec2(-ad.y, ad.x) * (position.y * ext.y);
  vW = uOrigin + fA.xy + vL;
  vA = fA; vB = fB; vC = fC;
  gl_Position = vec4((fA.xy + vL) / uHalf, 0.0, 1.0);
}`;
const STAMP_FS = /* glsl */`
uniform sampler2D uCells;
varying vec2 vL;
varying vec2 vW;
varying vec4 vA;
varying vec4 vB;
varying vec4 vC;
${FOAM_GLSL}
void main() {
  if (vA.w < 0.5) {
    vec2 ad = vec2(cos(vC.y), sin(vC.y));
    gl_FragColor = lfWhite(vec2(dot(vL, ad) / max(vC.x, 1.0), dot(vL, vec2(-ad.y, ad.x))), textureLod(uCells, vW * 0.13 + vC.z, 0.0).b, vB, vC.w, vA.z);
  } else {
    // scum over the school: patchy, low-density lace the strikes left behind
    vec2 q = vec2(dot(vL, vC.xy), dot(vL, vec2(-vC.y, vC.x))) / vB.xy;
    float env = 1.0 - smoothstep(0.55, 1.0, length(q) / (0.72 + 0.56 * textureLod(uCells, vW * 0.01, 0.0).b));
    gl_FragColor = vec4(0.0, vB.z * env * smoothstep(0.35, 0.65, textureLod(uCells, vW * 0.05 + 0.3, 0.0).b), 0.0, 0.0);
  }
}`;
// Foam map: the focused blitz's white water, rasterised top-down. A working patch keeps a few
// hundred strikes' white water and lace on the water at once. Drawn as separate decals they overlap
// five-fold and each fragment writes log depth (no early depth test), so every strike near the
// focus is instead stamped into a 1024² map (9.4 cm texels, ±48 m) round the focused blitz, and one
// decal draws the map with the fine structure computed at screen resolution. Strikes elsewhere, or
// that the map leaves behind as it follows its blitz, are ordinary decals.
const FOAM_MAP = { half: 48, res: 1024, snap: 4, maxStamps: 2048 };
class FoamMap {
  constructor(renderer) {
    this.renderer = renderer;
    this.target = new THREE.WebGLRenderTarget(FOAM_MAP.res, FOAM_MAP.res, { type: THREE.HalfFloatType, depthBuffer: false });
    this.target.texture.name = 'blitz.foamMap';
    this.uniforms = { uHalf: { value: FOAM_MAP.half }, uOrigin: { value: new THREE.Vector2() }, uCells: { value: foamCells() } };
    this.material = new THREE.ShaderMaterial({
      name: 'blitz.foamStamp', uniforms: this.uniforms, vertexShader: STAMP_VS, fragmentShader: STAMP_FS,
      blending: THREE.CustomBlending, blendEquation: THREE.MaxEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
      depthTest: false, depthWrite: false, side: THREE.DoubleSide,
    });
    // two stamp buffers used in turn: a frame never rewrites the one the GPU may still be reading
    this.sets = [0, 1].map(() => {
      const buf = new InstanceBuffer(QUAD, ['fA', 'fB', 'fC'], FOAM_MAP.maxStamps);
      const mesh = new THREE.Mesh(buf.geometry, this.material);
      mesh.frustumCulled = false;
      return { buf, mesh };
    });
    this.cur = 0;
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1);
    this.centre = new THREE.Vector2();
    this.n = 0;
    this._clear = new THREE.Color();
    this.drawn = false;
  }
  begin(cx, cz) {
    this.centre.set(cx, cz); this.n = 0;
    this.scene.remove(this.sets[this.cur].mesh);
    this.cur = 1 - this.cur;
    this.scene.add(this.sets[this.cur].mesh);
  }
  // world x, z, then the stamp's attributes (fA.zw, fB, fC)
  put(x, z, ...v) {
    if (this.n >= FOAM_MAP.maxStamps) return false;
    this.sets[this.cur].buf.set(this.n++, [x - this.centre.x, z - this.centre.y, ...v]);
    return true;
  }
  render() {
    this.sets[this.cur].buf.upload(this.n);
    if (!this.n && !this.drawn) return;
    const r = this.renderer, prev = r.getRenderTarget(), prevAuto = r.autoClear, prevAlpha = r.getClearAlpha();
    r.getClearColor(this._clear);
    r.setClearColor(0x000000, 0);
    r.setRenderTarget(this.target);
    r.autoClear = true;
    r.render(this.scene, this.camera);
    r.setRenderTarget(prev);
    r.autoClear = prevAuto;
    r.setClearColor(this._clear, prevAlpha);
    this.drawn = this.n > 0;
  }
  dispose() { this.target.dispose(); for (const s of this.sets) s.buf.dispose(); this.material.dispose(); }
}

// ================================================================================================
// Blitz
// ================================================================================================
/**
 * BlitzState (entries of blitz.active; read-only for other modules):
 *   id, species ('stripedBass' | 'bluefish' | 'falseAlbacore' | 'bluefinTuna'),
 *   bait ('menhaden' | 'sandEel' | 'anchovy'), x, z (patch centre, m), radius (m),
 *   cx, cz, core (the working core: the balled bait most strikes and birds are over; centre, radius m),
 *   headingDeg (travel direction, compass), speed (m/s), startT, endT (animation s),
 *   state ('rising' | 'feeding' | 'down' | 'ending'), intensity (0..1, current feeding activity),
 *   score (recent strike energy, what focus() ranks by), home { x, z } (the structure it holds to),
 *   forced (started by trigger()), dist (m from the camera, last frame).
 */
export class Blitz {
  // private state (see the constructor)
  #boils; #camPos; #dir; #events; #focus; #lastT; #mapDirty; #mapList; #mapOn; #mapT; #nextId; #nextSpawn; #rings; #seaCache; #seaMs; #sprayMark; #sprayRate; #surf; #v; #v2;
  constructor(ctx) {
    this.ctx = ctx;
    this.quality = ctx.quality || QUALITY.high;
    this.enabled = true;
    this.rng = mulberry32(0xB1172 + 7907 * (ctx.seed ?? 1));
    this.root = new THREE.Group();
    this.root.name = 'blitz';
    ctx.scene.add(this.root);
    this.skyE = { value: new THREE.Vector3(0.3, 0.4, 0.55) };      // sky irradiance / pi (see #lighting)
    this.spray = new SprayField(ctx, this.#poolSize(this.quality), this.root, this.skyE);
    // white water: one material for the strike decals and the foam map's decal
    // The decals ride the rendered waves: the ocean's displaced surface, its official accessor (round
    // 3), else (an older ocean) its material uniforms of the same names, shared by reference (they
    // change in place each frame, after this update, before the draw). Without them the white water
    // lies on the mean sea.
    const L = lifeGlsl(ctx), v2 = () => new THREE.Vector2(), o = ctx.ocean, D = o?.displacementUniforms?.() ?? o?.uniforms;
    this.foamUniforms = {
      ...L.uniforms, uSkyE: this.skyE, uSunDir: U.uSunDir, uLfSeaOn: { value: +!!D?.uDisp0 },
      ...D?.uDisp0 && Object.fromEntries(['uDisp0', 'uDisp1', 'uOcCas', 'uOcOff', 'uSnap', 'uRing', 'uGrid'].map((k) => [k, D[k]])),
      uFoamMap: { value: null }, uFoamArea: { value: new THREE.Vector4() }, uCells: { value: foamCells() }, uAnchor: { value: v2() }, uDrift: { value: v2() },
    };
    const foamMat = new THREE.ShaderMaterial({
      name: 'blitz.foam', uniforms: this.foamUniforms,
      vertexShader: FOAM_VS(L.glsl, /float\s+curvatureDrop\s*\(/.test(L.glsl) ? '' : CURVATURE_GLSL), fragmentShader: FOAM_FS,
      side: THREE.DoubleSide, ...PREMULT,
    });
    // white water on the sea: grids laid on the rendered waves (see FOAM_VS), one per strike or one
    // for the foam map
    this.decals = new LaunchRing(gridGeometry(8), ['dA', 'dB', 'dC'], DECALS, foamMat, this.root, 'blitz.whiteWater', 1, false);
    this.foamMap = ctx.renderer ? new FoamMap(ctx.renderer) : null;
    this.mapDecal = this.foamMap ? new LaunchRing(gridGeometry(48), ['dA', 'dB', 'dC'], 1, foamMat, this.root, 'blitz.foamMap', 1, false) : null;
    this.foamUniforms.uFoamMap.value = this.foamMap?.target.texture ?? null;
    this.#mapOn = false;
    this.#mapList = [];              // white water drawn through the foam map
    this.#mapDirty = true;
    this.#mapT = NaN;
    this.fish = {};
    // Bait stays out of the planar reflection: a 7-30 cm fish at the surface has a negligible mirror
    // image, which the rough-sea reflection would only scatter into dark specks.
    for (const key of Object.keys(FISH_SPECIES)) this.fish[key] = new FishInstances(key, this.#fishCap(key, this.quality), this.root, { reflect: key in PREDATORS });
    this.blitzes = [];
    this.recentStrikes = [];
    this.#events = [];               // [{ t, fn }] sorted by t
    this.#boils = [];                // end times of our young ocean boils
    this.#rings = [RING_RATE, SMALL_RING_RATE];   // ring-train tokens (per second): big, small splashes
    this._ww = [];                   // white water emitted (dev: whiteWater())
    this.#seaCache = [];
    this.#seaMs = 0;
    this.#surf = { y: 0, normal: new THREE.Vector3(), velocity: new THREE.Vector3() };
    this._t = U.uTime.value;
    this.#lastT = null;
    this.#nextSpawn = this._t + FIRST_BLITZ_DELAY_S + this.#expGap();
    this.#nextId = 1;
    this.#focus = new THREE.Vector3();
    this.focusId = null;
    this.#camPos = new THREE.Vector3().copy(ctx.camera?.position ?? new THREE.Vector3());
    this.#sprayRate = 0;             // sprites launched per second (smoothed), for the pool budget
    this.#sprayMark = 0;
    this.#v = new THREE.Vector3(); this.#v2 = new THREE.Vector3(); this.#dir = new THREE.Vector3();
    if (globalThis.NJOW_DEV !== false) this._registerScales();      // dev builds (see the end of this file)
  }

  // ---------------------------------------------------------------- public API
  get active() { return this.blitzes; }
  // focusId: the id of the blitz focus() returns (the Blitz view and the birds' full flock follow it)

  /**
   * Start a blitz now near (x, z): it arrives in full swing, with the last PREROLL_S seconds of
   * strikes, white water, lace and birds already there (so a frozen frame shows a working blitz).
   * opts: { species, bait } to choose the school (default: by season, never the rare offshore
   * bluefin); { rising: true } starts it at the nervous-water stage instead (bait up, no strikes
   * for 6-14 s); { preroll: seconds } (default PREROLL_S; 0: a single strike just happened).
   */
  trigger(x, z, opts = {}) {
    if (!this.enabled || !Number.isFinite(x) || !Number.isFinite(z)) return null;
    const t = this._t = U.uTime.value;             // may be called before the first update (?blitz=1)
    // at most MAX_BLITZES + 1 forced blitzes: the oldest winds down (repeated B presses)
    const forced = this.blitzes.filter((q) => q.forced && q.state !== 'ending' && t < q.endT).sort((a, b) => a.startT - b.startT);
    while (forced.length > (MAX_BLITZES[this.quality.name] ?? 3)) { const o = forced.shift(); o.state = 'ending'; o.endT = o.stateUntil = Math.min(o.endT, t + 3); }
    const species = PREDATORS[opts.species] ? opts.species : this._pickSpecies(false);
    const b = this._createBlitz(x, z, t, { species, bait: BAIT[opts.bait] ? opts.bait : undefined, forced: !opts.rising });
    b.forced = true;
    this.#keepOffPiles(b);
    [b.cx, b.cz] = this.#ball(b, t);
    this.#updateSchool(b, t);
    this.focusId = b.id;
    this.#placeMap(b);
    if (!opts.rising) {
      const pre = Number.isFinite(opts.preroll) ? Math.max(0, opts.preroll) : PREROLL_S;
      if (pre > 0) this.#preroll(b, t, pre);
      else this._strike(b, b.x, b.z, t - 0.4, {});      // the strike that drew the eye: at its height now
      b.nextAttack = t + 0.1 + this.rng() * 0.3;
      this.ctx.birds?.seedFlock?.(b);                  // the birds are already working it
    }
    return b.id;
  }

  /**
   * A splash at (x, z) with a crown `size` metres high (e.g. a tern's plunge 0.3, a gannet's 1-2 m).
   * opts: { t0, radius (cavity m), foam (0..1.5), disturb (default true), dirX, dirZ }.
   */
  splashAt(x, z, size = 1, opts = {}) {
    if (!this.enabled || !Number.isFinite(x) || !Number.isFinite(z)) return;
    this._t = U.uTime.value;
    const t0 = opts.t0 ?? this._t, H = clamp(size, 0.05, 5), r0 = opts.radius ?? clamp(0.06 + 0.07 * H, 0.05, 0.6);
    const y0 = this.#seaAt(this.#sea(x, z), t0 - this._t), dist = this.#camDist(x, z);
    this.#emitCrown(x, y0, z, t0, H, r0, opts.dirX ?? 0, opts.dirZ ?? 0, { plume: true, det: this.#det(dist) });
    const foam = clamp(opts.foam ?? 0.5 + 0.4 * H, 0.3, 1.2);
    this.#white(x, y0, z, t0, clamp(0.25 + 0.45 * H, 0.3, 1.1), 0.6 + 0.3 * foam, lerp(0.8, 2.2, clamp(H / 1.8, 0, 1)), lerp(4, 8, this.rng()), r0);
    if (opts.disturb !== false) this.#ring(x, z, t0, H, clamp(0.15 + 0.35 * H, 0.2, 1.2), clamp(0.3 + 0.5 * H, 0.3, 1.3), dist);
  }

  /** The most active blitz's working core at sea level (a reused vector: copy it to keep it), or null. */
  focus() {
    const b = this.blitzes.find((q) => q.id === this.focusId);
    return b ? this.#focus.set(b.cx, -curvatureDrop(b.cx, b.cz), b.cz) : null;
  }

  setEnabled(on) {
    on = !!on;
    if (on === this.enabled) return;
    this.enabled = this.root.visible = on;
    if (on) { this.#nextSpawn = this._t + 10 + this.#expGap(); return; }
    this.blitzes.length = this.recentStrikes.length = this.#events.length = this._ww.length = this.#mapList.length = 0;
    this.focusId = null;
    this.#mapOn = false;
    this.ctx.ocean?.setLifePatches?.([]);
    this.spray.clear();
    this.decals.clear();
    for (const p of Object.values(this.fish)) p.clear();
  }

  setQuality(q) {
    if (!q) return;
    this.quality = q;
    const n = this.#poolSize(q);
    if (n !== this.spray.capacity) this.spray.resize(n);
    for (const [key, pool] of Object.entries(this.fish)) pool.resize(this.#fishCap(key, q));
  }

  dispose() {
    this.ctx.scene.remove(this.root);
    this.spray.dispose();
    this.decals.dispose();
    this.mapDecal?.dispose();
    this.decals.material.dispose();
    this.foamMap?.dispose();
    for (const p of Object.values(this.fish)) p.dispose();
  }

  // ---------------------------------------------------------------- frame
  update(dt, t, camera) {
    this._t = t;
    this.#seaMs = 0;
    if (this.#seaCache.length && this.#seaCache[0].t !== t) this.#seaCache.length = 0;
    if (camera) this.#camPos.copy(camera.position);
    // the first frame fixes the time base (the shell may set U.uTime after construction)
    if (this.#lastT === null) this.#nextSpawn = t + FIRST_BLITZ_DELAY_S + this.#expGap();
    const step = this.#lastT === null ? 0 : clamp(t - this.#lastT, 0, 0.1);
    this.#lastT = t;
    if (this.enabled && step > 0) {
      const launched = this.spray.launched - this.#sprayMark;
      this.#sprayMark = this.spray.launched;
      this.#sprayRate += (launched / step - this.#sprayRate) * (1 - Math.exp(-step));
      this.#rings = this.#rings.map((n, i) => Math.min(n + step * [RING_RATE, SMALL_RING_RATE][i], [RING_RATE, SMALL_RING_RATE][i]));
      if (t >= this.#nextSpawn) this.#spawnScheduled(t, camera);
      for (const b of this.blitzes) this.#advance(b, t, step);
      while (this.#events.length && this.#events[0].t <= t) this.#events.shift().fn();
      this.blitzes = this.blitzes.filter((b) => t < b.endT + END_LINGER_S);
      this.recentStrikes = this.recentStrikes.filter((s) => t - s.t < STRIKE_MEMORY_S);
      this.#boils = this.#boils.filter((e) => t < e);
      this.#updateFocus(t);
    }
    if (this.enabled) this.#oceanLife();
    this.#updateFoamMap(t);
    this.#lighting();
    this.spray.update(this.ctx.renderer, camera, t, this.enabled);
    this.decals.update(t, this.enabled);
    this.mapDecal?.update(t, this.enabled && this.#mapOn);
    for (const p of Object.values(this.fish)) p.flush(t, this.enabled);
  }

  // ---------------------------------------------------------------- scheduling
  #poolSize(q) { return Math.max(4096, Math.round(POOL_BASE * (q?.particles ?? 1))); }
  #fishCap(key, q) { return Math.round((key in PREDATORS ? FISH_POOL.predator : FISH_POOL.bait) * Math.max(0.5, q?.particles ?? 1)); }
  #expGap() { return -Math.log(1 - this.rng() * 0.999) * B.meanGapS; }

  _pickSpecies(allowTuna) {
    const m = (this.ctx.clock?.date?.month ?? 6) - 1;
    return pickWeighted(Object.fromEntries(Object.entries(SEASON).map(([k, s]) => [k, k === 'bluefinTuna' && !allowTuna ? 0 : s[m]])), this.rng) ?? 'stripedBass';
  }

  #spawnScheduled(t, camera) {
    this.#nextSpawn = t + this.#expGap();
    if (this.blitzes.filter((b) => t < b.endT).length >= (MAX_BLITZES[this.quality.name] ?? 3)) return;
    const target = this.#viewTarget(camera, this.#v);
    const nearForced = (x, z, r) => this.blitzes.some((b) => b.forced && t < b.endT && Math.hypot(b.x - x, b.z - z) < r);
    // a forced blitz has the stage: nothing else starts round it
    if (nearForced(target.x, target.z, FORCED_QUIET_M + SPAWN_RADIUS_M * 0.25)) return;
    const species = this._pickSpecies(true), tuna = species === 'bluefinTuna';
    const home = tuna ? target : this.#pickStructure(target);
    const a = this.rng() * TAU, d = tuna ? lerp(TUNA_OFFSET_M[0], TUNA_OFFSET_M[1], this.rng()) : lerp(25, HOMING_M, Math.sqrt(this.rng()));
    const x = home.x + Math.cos(a) * d, z = home.z + Math.sin(a) * d;
    if (!nearForced(x, z, FORCED_QUIET_M)) this.#keepOffPiles(this._createBlitz(x, z, t, { species }));
  }

  // Where the camera looks at the sea (or 400 m ahead when it looks above the horizon), within 2 km.
  #viewTarget(camera, out) {
    const p = camera.position, f = camera.getWorldDirection(this.#v2);
    const h = Math.max(p.y + curvatureDrop(p.x, p.z), 1), fh = Math.hypot(f.x, f.z);
    if (fh < 1e-4) return out.set(p.x, 0, p.z);
    const reach = f.y < -0.02 ? Math.min(h / -f.y * fh, SPAWN_RADIUS_M * 0.75) : 400;
    return out.set(p.x + f.x / fh * reach, 0, p.z + f.z / fh * reach);
  }

  // A foundation near the target, weighted toward the closest (bait holds around structure).
  #pickStructure(target) {
    const tb = this.ctx.farm?.turbines;
    if (!tb?.length) return { x: 0, z: 0 };
    const w = tb.map((s) => { const d = Math.hypot(s.x - target.x, s.z - target.z); return d > SPAWN_RADIUS_M ? 0 : Math.exp(-d / 700); });
    const i = pickWeighted(w, this.rng);
    return i === null ? this.#nearestStructure(target.x, target.z) : tb[i];
  }

  _createBlitz(x, z, t, { species, bait, forced = false, quiet = false }) {
    const P = PREDATORS[species], rng = this.rng, radius = lerp(P.patch[0], P.patch[1], rng()) / 2;
    const burst = P.burst ?? BURST_S, dur = lerp(B.durationS[0], B.durationS[1], rng());
    const b = {
      id: this.#nextId++, species, bait: bait ?? pickWeighted(P.bait, rng), x, z, cx: x, cz: z, radius,
      core: clamp(CORE.share * radius, ...(species === 'bluefinTuna' ? CORE.tuna : CORE.r)), ph: rng() * TAU, fl: 1, flUntil: t,
      headingDeg: rng() * 360, speed: lerp(P.speed[0], P.speed[1], rng()),
      startT: t, endT: t + dur,
      state: forced ? 'feeding' : 'rising', intensity: forced ? 1 : 0, score: forced ? 1 : 0,
      home: species === 'bluefinTuna' ? { x, z } : this.#nearestStructure(x, z),
      forced: forced && !quiet, dist: this.#camDist(x, z),
      // internal: a forced blitz is the one being watched: its first burst runs long, at full
      // intensity from the start (the ramp has passed)
      stateUntil: t + (forced ? lerp(Math.max(burst[1], 45), Math.max(burst[1], 45) + 30, rng()) : lerp(RISING_S[0], RISING_S[1], rng())),
      burstStart: forced ? t - RAMP_S : t, nextAttack: t + (quiet ? 1e9 : 0.5), nextFlip: t, nextBoil: t + 1 + 2 * rng(),
      nextShower: t + 0.5 + 2 * rng(), nextSlick: t + 1 + 2 * rng(), piles: [], pilesT: -1e9,
      quiet, stain: 0, nervous: 0, scum: 0, slickNew: [],
    };
    this.blitzes.push(b);
    return b;
  }

  #nearestStructure(x, z) {
    let best = { x: 0, z: 0 }, bd = Infinity;
    for (const s of this.ctx.farm?.turbines ?? []) { const d = (s.x - x) ** 2 + (s.z - z) ** 2; if (d < bd) { bd = d; best = s; } }
    return { x: best.x, z: best.z };
  }

  // Foundations near a blitz (refreshed once a second): strikes keep clear of the steel.
  _refreshPiles(b, t) {
    b.pilesT = t;
    const reach = b.radius * 1.5 + 60;
    b.piles = (this.ctx.farm?.turbines ?? []).filter((s) => Math.abs(s.x - b.x) < reach && Math.abs(s.z - b.z) < reach);
  }
  // (x, z) pushed radially out of any foundation it falls in (bait schools against the pile wall).
  #offPile(b, x, z, out) {
    out.x = x; out.z = z;
    const R = TURBINE.tp.diameter / 2 + PILE_CLEAR_M;
    for (const s of b.piles) {
      const dx = out.x - s.x, dz = out.z - s.z, d = Math.hypot(dx, dz);
      if (d >= R) continue;
      if (d > 1e-3) { out.x = s.x + dx * R / d; out.z = s.z + dz * R / d; } else out.x = s.x + R;
    }
    return out;
  }
  // A new patch centred on a foundation moves out to ≥ TP radius + half its own radius (toward the camera).
  #keepOffPiles(b) {
    this._refreshPiles(b, this._t);
    const need = TURBINE.tp.diameter / 2 + 0.5 * b.radius;
    for (const s of b.piles) {
      let dx = b.x - s.x, dz = b.z - s.z, d = Math.hypot(dx, dz);
      if (d >= need) continue;
      if (d < 0.5) { dx = this.#camPos.x - s.x; dz = this.#camPos.z - s.z; d = Math.hypot(dx, dz) || 1; }
      b.x = s.x + dx / d * need; b.z = s.z + dz / d * need;
    }
  }

  // ---------------------------------------------------------------- one blitz, one step
  #advance(b, t, step) {
    const rng = this.rng;
    if (b.quiet) { b.score *= Math.exp(-step / 6); b.intensity = 0; return; }
    const P = PREDATORS[b.species];
    // state machine: rising -> feeding <-> down -> ending
    if (t >= b.endT - 10 && b.state !== 'ending') { b.state = 'ending'; b.stateUntil = b.endT; }
    if (t >= b.stateUntil) {
      if (b.state === 'rising' || b.state === 'down') {
        const burst = P.burst ?? BURST_S;
        b.state = 'feeding'; b.burstStart = t; b.stateUntil = t + lerp(burst[0], burst[1], rng()); b.nextAttack = Math.min(b.nextAttack, t + 0.3);
      } else if (b.state === 'feeding') {
        b.state = 'down'; b.stateUntil = t + lerp(LULL_S[0], LULL_S[1], rng());
        b.headingDeg += (rng() - 0.5) * 120;
        this.#boil(b, t);                             // sounding fish leave a boil
      }
    }
    const target = b.state === 'feeding' ? smooth(0, RAMP_S, t - b.burstStart) * (1 - smooth(-RAMP_S, 0, t - b.stateUntil))
      : b.state === 'ending' ? 0.35 * (1 - smooth(b.endT - 10, b.endT, t)) : 0;
    b.intensity += (target - b.intensity) * (1 - Math.exp(-step / 0.8));
    // travel: random walk of the heading, homing toward the structure it holds to
    b.headingDeg += (rng() - 0.5) * 2 * HEADING_WANDER / DEG * Math.sqrt(step) * 1.7;
    if (b.species !== 'bluefinTuna' && Math.hypot(b.x - b.home.x, b.z - b.home.z) > HOMING_M) {
      const want = Math.atan2(b.home.x - b.x, -(b.home.z - b.z)) / DEG;
      b.headingDeg += (((want - b.headingDeg + 540) % 360) - 180) * Math.min(1, step * 0.08);
    }
    const dir = azimuthToDir(b.headingDeg, this.#dir), v = b.speed * (b.state === 'down' ? DOWN_SPEED_GAIN : 1);
    b.x += dir.x * v * step; b.z += dir.z * v * step;
    [b.cx, b.cz] = this.#ball(b, t);
    if (t >= b.flUntil) { b.fl = FLURRY[+(b.fl > 1)]; b.flUntil = t + lerp(0.8, 2.5, rng()); }
    b.score *= Math.exp(-step / 6);
    b.scum *= Math.exp(-step / SCUM_TAU_S);
    const dist = b.dist = this.#camDist(b.x, b.z);
    if (t - b.pilesT > 1) this._refreshPiles(b, t);
    this.#updateSchool(b, t);
    // flipping bait (nervous water) while the bait is up: fish meshes, near the camera only
    if (b.state !== 'down' && t < b.endT && dist < FLIP_RANGE_M) {
      const rate = Math.min(FLIP_RATE_MAX, BAIT[b.bait].flipsPerS * (b.state === 'rising' ? 1 : 0.5) * (b.radius / 10));
      while (t >= b.nextFlip) { this.#flip(b, b.nextFlip); b.nextFlip += -Math.log(1 - rng() * 0.999) / rate; }
    } else b.nextFlip = t;
    // strikes: attacks (a hit, or a sweep of hits) as a Poisson process thinned by the current
    // intensity (candidates at the full rate, each kept with probability intensity), so bursts start
    // without delay
    const attacks = this.#attackRate(b) * b.fl;
    while (t >= b.nextAttack) {
      const at = b.nextAttack;
      b.nextAttack += -Math.log(1 - rng() * 0.999) / attacks;
      if (at >= t - 0.5 && rng() < b.intensity) this.#attack(b, at, dir, b.x, b.z);   // (skipped after a time jump)
    }
    // mass showers of bait, boils, slicks
    if (b.state === 'feeding' && b.intensity > 0.4 && t >= b.nextShower) {
      if (dist < DETAIL_NEAR_M || b.id === this.focusId) this.#massShower(b, t);
      b.nextShower = t + 1 / lerp(SHOWER_RATE[0], SHOWER_RATE[1], rng());
    }
    if (b.intensity > 0.3 && t >= b.nextBoil) { this.#boil(b, t); b.nextBoil = t + lerp(1, 3, rng()); }
    if (b.state === 'feeding' && b.intensity > 0.3 && t >= b.nextSlick) { this.#slick(b, t); b.nextSlick = t + lerp(SLICK_EVERY_S[0], SLICK_EVERY_S[1], rng()); }
  }

  // The last `secs` seconds of a blitz at full swing, replayed at once: every strike is emitted with
  // its past launch time (the GPU evaluates everything from launch data, so a frozen frame shows each
  // at its right age); the patch was further back along its heading then.
  #preroll(b, t, secs) {
    const rng = this.rng, dir = azimuthToDir(b.headingDeg, new THREE.Vector3()), attacks = this.#attackRate(b) * FLURRY[0];
    const back = (ta) => [b.x - dir.x * b.speed * (t - ta), b.z - dir.z * b.speed * (t - ta)];
    // flurries of 1.6 s every 3.5 s, the last one still running (the moment the camera arrives),
    // and the big hit that drew the eye a moment ago
    for (let ta = t - secs; (ta += -Math.log(1 - rng() * 0.999) / attacks) < t;) if ((t - ta) % 3.5 < 1.6 || rng() < FLURRY[1] / FLURRY[0]) this.#attack(b, ta, dir, ...back(ta));
    this._strike(b, b.cx, b.cz, t - 0.3, { height: lerp(...PREDATORS[b.species].splash, 0.6 + 0.4 * rng()) });
    b.fl = FLURRY[0]; b.flUntil = t + 0.5 + rng();
    for (let tb = t - secs + rng() * 2; tb < t; tb += lerp(1, 3, rng())) this.#boil(b, tb, ...back(tb));
    for (let ts = t - SLICK_PREROLL_S; ts < t; ts += lerp(SLICK_EVERY_S[0], SLICK_EVERY_S[1], rng())) this.#slick(b, ts, ...back(ts));
    for (let ts = t - 1.2 + rng() * 0.6; ts < t; ts += 1 / lerp(SHOWER_RATE[0], SHOWER_RATE[1], rng())) this.#massShower(b, ts);
    b.score = 3;
  }

  // The working core's centre at time t for a patch centred at (px, pz) then: a point 0.3 radii
  // ahead of the centre plus a slow wander of ±0.3 radii (periods ~20-27 s).
  #ball(b, t, px = b.x, pz = b.z) {
    const h = b.headingDeg * DEG, l = 0.3 * b.radius;
    return [px + l * (Math.sin(h) + Math.sin(0.23 * t + b.ph)), pz + l * (Math.sin(0.31 * t + 2 * b.ph) - Math.cos(h))];
  }

  // An attack: a single hit, or a sweep of 3-5 hits along a curving 3-6 m run. Most run through the
  // working core from any side; the rest are single pops anywhere over the pod, starting near its
  // leading edge where the predators push the bait.
  #attack(b, t0, dir, cx, cz) {
    const rng = this.rng, gs = () => (rng() + rng() + rng() - 1.5) * 2, core = rng() < CORE.hit, [bx, bz] = this.#ball(b, t0, cx, cz);
    const n = core && rng() < SWEEP.chance ? SWEEP.n[0] + Math.floor(rng() * (SWEEP.n[1] - SWEEP.n[0] + 1)) : 1;
    const len = lerp(SWEEP.len[0], SWEEP.len[1], rng()), dur = lerp(SWEEP.dur[0], SWEEP.dur[1], rng());
    const h0 = core ? rng() * TAU : Math.atan2(dir.z, dir.x) + (rng() < 0.5 ? 1 : -1) * lerp(40, 110, rng()) * DEG, curve = (rng() - 0.5) * 1.4;
    const a = rng() * TAU, r = b.radius * Math.sqrt(rng()) * 0.85, s = (n > 1 ? 0.45 : 0.75) * b.core, o = n > 1 ? len / 2 : 0;
    const x0 = core ? bx + gs() * s - Math.cos(h0) * o : cx + Math.cos(a) * r + dir.x * b.radius * 0.35;
    const z0 = core ? bz + gs() * s - Math.sin(h0) * o : cz + Math.sin(a) * r + dir.z * b.radius * 0.35;
    for (let k = 0; k < n; k++) {
      const u = n > 1 ? k / (n - 1) : 0, h = h0 + curve * u, hm = h0 + curve * u * 0.5;
      const px = x0 + Math.cos(hm) * len * u + (rng() - 0.5) * 0.8, pz = z0 + Math.sin(hm) * len * u + (rng() - 0.5) * 0.8;
      const tk = t0 + dur * u + (n > 1 ? (rng() - 0.5) * 0.25 * dur / (n - 1) : 0);
      const opts = { dirX: Math.cos(h), dirZ: Math.sin(h), pop: !core };
      if (tk <= this._t) this._strike(b, px, pz, tk, opts);
      else this.#at(tk, () => { if (this.blitzes.includes(b)) this._strike(b, px, pz, tk, opts); });
    }
  }

  // Attacks per second at full intensity: the species' peak strike rate for a 20 m patch, growing as
  // (radius / 10 m)^1.5 (more fish), capped per tier, over the mean strikes per attack.
  #attackRate(b) {
    const rateScale = Math.min(RATE_SCALE_MAX, Math.pow(Math.max(b.radius, 5) / 10, 1.5));
    return Math.min(PREDATORS[b.species].rate * rateScale, STRIKE_RATE_MAX[this.quality.name] ?? 20) / MEAN_PER_ATTACK;
  }

  // ---------------------------------------------------------------- events
  // One predator strike: white water, crown of spray, bait thrown out, rings, sometimes the predator.
  _strike(b, x, z, t0, opts) {
    const rng = this.rng, P = PREDATORS[b.species], tuna = b.species === 'bluefinTuna';
    const age = this._t - t0;
    ({ x, z } = this.#offPile(b, x, z, this.#v2));
    const dist = this.#camDist(x, z);
    const det = opts.full || age > 0.05 ? 1 : this.#det(dist);      // pre-roll: full detail (the camera is not placed yet)
    const s = this.#sea(x, z), y0 = this.#seaAt(s, -age);
    if (!opts.height && rng() < P.swirl) {
      // a fish turning on the bait just under the surface: a swirl (a small boil), no crown
      this.#boil(b, t0, x, z, tuna ? lerp(2, 3, rng()) : lerp(0.8, 1.6, rng()), 2.5);
      this.recentStrikes.push({ x, z, t: t0, height: 0.2, id: b.id });
      return;
    }
    const [h0, h1] = P.splash;
    let H = opts.height;
    if (!H) { let u = rng(); const c = opts.pop ? P.sizes[0] : P.sizes.find(([share]) => (u -= share) < 0) ?? P.sizes[P.sizes.length - 1]; H = lerp(c[1], c[2], Math.pow(rng(), 1.3)); }
    const hNorm = clamp((H - h0) / Math.max(h1 - h0, 1e-3), 0, 1);
    const r0 = lerp(P.cavity[0], P.cavity[1], hNorm) * (0.85 + 0.3 * rng()) * (H < h0 ? 0.75 : 1);
    let dX = opts.dirX, dZ = opts.dirZ;
    if (!Number.isFinite(dX) || !Number.isFinite(dZ)) { const a = rng() * TAU; dX = Math.cos(a); dZ = Math.sin(a); }
    if (age < 3) this.#emitCrown(x, y0, z, t0, H, r0, dX, dZ, { det, load: this.#sprayLoad() });
    if (age < 2 && dist < DETAIL_FAR_M) this.#baitShower(b, x, z, t0, H, r0, dX, dZ, s, dist);
    // white water on the sea: bass/blues 0.6-1.8 m radius, tuna 1.5-3.2 m
    const Rw = (tuna ? clamp(1.2 + 0.45 * H, 1.5, 3.2) : clamp(0.5 + 0.8 * H, 0.6, 1.8)) * (0.9 + 0.2 * rng());
    const coreTau = tuna ? lerp(...WHITE_CORE_TAU.tuna, hNorm) : lerp(...WHITE_CORE_TAU.bassBlues, clamp(H / 1.3, 0, 1));
    this.#white(x, y0, z, t0, Rw, 0.85 + 0.3 * clamp(H / 1.2, 0, 1), coreTau, lerp(...WHITE_LACE_TAU, rng()), r0 * (tuna ? 1.2 : 1.6), lerp(1.15, 1.7, rng()), dX, dZ);
    // the ring train: the ocean draws it (its splash map)
    this.#ring(x, z, t0, H, tuna ? clamp(1.5 + 0.45 * H, 2, 3.5) : clamp(0.3 + 0.6 * H, 0.4, 1.5), clamp(0.5 + 0.5 * H / (tuna ? 3 : 1), 0.5, 1.5), dist);
    // the predator itself, now and then
    const show = opts.show ?? pickWeighted({ ...P.shows, none: 1 - Object.values(P.shows).reduce((a, v) => a + v, 0) }, rng);
    if (show !== 'none' && age < 2 && dist < DETAIL_FAR_M) this.#showPredator(b, x, y0, z, t0, dX, dZ, show, s);
    this.recentStrikes.push({ x, z, t: t0, height: H, id: b.id });
    b.score += H * H;
    if (age < SCUM_TAU_S) b.scum = Math.min(SCUM_MAX, b.scum + SCUM_PER_STRIKE * Math.exp(-age / SCUM_TAU_S));
  }

  // Share of fine spray parcels kept so launches never exceed the pool over SPRAY_BUDGET_S.
  #sprayLoad() {
    const max = this.spray.capacity / SPRAY_BUDGET_S * 0.7;
    return this.#sprayRate > max ? clamp(max / this.#sprayRate, 0.25, 1) : 1;
  }

  // Crown splash (H = crown height, r0 = cavity radius, both m; (dX, dZ) the direction the fish hit
  // toward). The strike heaves up a mound of aerated water round the cavity and throws thin sheets
  // out of it (jets: stretched, translucent, torn into drops within ~0.3 s, falling at drop speed);
  // the sheet breaks into ligaments ("fingers": strings of drops launched along one direction with a
  // spread of speeds), 65 % of them toward the attack (round 4: no separate rooster tail; the
  // fingers and jets already lean along the attack); between
  // them a curtain of drops (a veil that tears apart within ~0.3 s). No hanging mist: a strike's
  // drops are millimetres and fall within a second (round 4: the mist parcels read as a milky
  // haze over the white water). plume: a diving bird's narrow jet.
  // det: detail (1 near; fewer, larger parcels far away, same coverage); load: pool budget share.
  #emitCrown(x, y0, z, t0, H, r0, dX, dZ, { plume = false, det = 1, load = 1 } = {}) {
    const rng = this.rng, S = this.spray, now = this._t;
    const q = this.quality.particles ?? 1, qm = Math.min(q, 1.3);
    const w = U.uWind.value, ax = w.x * SPRAY_WIND_FACTOR, az = w.y * SPRAY_WIND_FACTOR;
    const rs = Math.sqrt(r0 / 0.22), big = Math.max(H, 0.5);
    const fine = clamp(det * load, 0.05, 1), cs = 1 / Math.sqrt(Math.max(fine, 0.2));   // fewer parcels: larger ones
    const put = (px, pz, t, vx, vy, vz, vt, radius, growth, op, kind, end = -0.35) => {
      const tau = vt / G, life = dragTimeTo(vy, tau, end);
      if (t + life >= now) S.add(px, y0 + 0.02, pz, t, vx, vy, vz, tau, radius, growth, op, kind, life, rng(), ax, az);   // (else over: pre-roll)
    };
    const aAtk = Math.atan2(dZ, dX);
    const towardAtk = () => (rng() < 0.65 ? aAtk + (rng() - 0.5) * 100 * DEG : rng() * TAU);
    const ring = (phi, rr) => [x + Math.cos(phi) * rr, z + Math.sin(phi) * rr];
    if (!plume) {
      // 1. eruption: lumps of aerated white water heaved up round the cavity (a mound 0.3-0.5 H
      // tall, 1.2-1.8 m wide for bass/blues, 3-4 m for tuna) and faster, thinner sheets thrown out
      // of it, most toward the attack (veil parcels stretched along their path: no hanging puffs)
      const nFull = lerp(10, 26, clamp((H - 0.2) / 1.3, 0, 1));
      const nM = Math.max(4, Math.round(nFull * Math.sqrt(Math.max(det, 0.25)) * Math.min(q, 1.2)));
      const mScale = Math.min(Math.sqrt(nFull / nM), 1.6);
      for (let i = 0; i < nM; i++) {
        const jet = i >= nM * 0.45, phi = towardAtk();
        const v = (jet ? lerp(2.5, 5.0, rng()) : lerp(1.2, 3.0, rng())) * Math.sqrt(big);
        const el = (jet ? lerp(55, 85, rng()) : lerp(60, 88, rng())) * DEG, vh = v * Math.cos(el), lean = lerp(0.15, 0.45, rng()) * v;
        const radius = (jet ? lerp(0.06, 0.14, rng()) : lerp(0.09, 0.22, rng())) * big * mScale;
        put(...ring(phi, r0 * (jet ? 1.1 : 1.5) * Math.sqrt(rng())), t0 + 0.06 * rng(), Math.cos(phi) * vh + dX * lean, v * Math.sin(el), Math.sin(phi) * vh + dZ * lean,
          lerp(...(jet ? VT.veil : VT.mound), rng()), radius, jet ? lerp(0.2, 0.35, rng()) : lerp(0.4, 0.8, rng()), jet ? lerp(0.25, 0.55, rng()) : lerp(0.8, 0.97, rng()), jet ? K_VEIL : K_BLOB, -0.55 * radius);
      }
    } else {
      // a diving bird's plume: a narrow column of opaque blobs
      const nP = H < 0.3 ? 3 : Math.round(lerp(20, 40, rng()) * Math.min(q, 1.2) * Math.max(det, 0.35));
      const pr = Math.sqrt(H / 1.5) / Math.sqrt(Math.max(det, 0.35));
      for (let i = 0; i < nP; i++) {
        const vt = lerp(...VT.blob, rng()), v = launchSpeed(H * (H < 0.3 ? lerp(0.4, 1.0, rng()) : lerp(0.25, 1.0, Math.pow(rng(), 0.8))), vt / G);
        const phi = rng() * TAU, vh = v * Math.tan(lerp(0, 5, rng()) * DEG);
        put(...ring(phi, r0 * 0.6 * Math.sqrt(rng())), t0 + 0.05 * rng(), Math.cos(phi) * vh + dX * 0.05 * v, v, Math.sin(phi) * vh + dZ * 0.05 * v,
          vt, lerp(0.06, 0.14, rng()) * pr * (H < 0.3 ? 0.5 : 1), 0.3, lerp(0.85, 0.95, rng()), K_BLOB, -0.2);
      }
    }
    if (det < 0.12) return;
    // 2. fingers: strings of drops, most thrown toward the attack
    const nLig = Math.round(clamp((plume ? 5 : 8) + 7 * H * rs, 4, 40) * qm * fine), perLig = Math.round(clamp(3 + 2 * H, 3, 9));
    for (let k = 0; k < nLig; k++) {
      const phi = plume ? rng() * TAU : towardAtk(), frac = 0.5 + 0.5 * Math.pow(rng(), 0.6);
      const beta = (plume ? lerp(2, 14, rng()) : lerp(9, 28, rng()) + (1 - frac) * 12) * DEG;
      const vt = lerp(...VT.clump, rng()), vTip = launchSpeed(H * frac, vt / G);
      const cx = Math.cos(phi), cz = Math.sin(phi), lean = plume ? 0.05 : lerp(0.35, 0.6, rng()) * (0.5 + 0.5 * Math.max(0, Math.cos(phi - aAtk)));
      const [px, pz] = ring(phi, r0 * (0.65 + 0.35 * rng()));
      for (let j = 0; j < perLig; j++) {
        const u = clamp((j + 0.9 * rng() - 0.45) / Math.max(perLig - 1, 1), 0, 1);
        const v = vTip * lerp(0.28, 1.0, u), vh = v * Math.tan(beta);
        put(px, pz, t0 + 0.03 * rng() + 0.04 * (1 - u), cx * vh + dX * lean * v, v, cz * vh + dZ * lean * v, vt,
          lerp(0.028, 0.011, u) * rs * (0.7 + 0.6 * rng()) * (plume ? 0.8 : 1) * cs, lerp(0.03, 0.08, rng()), 0.9, K_CLUMP);
      }
    }
    // 3. veil: parcels of separate drops, densest low on the rim early on (the sheet), tearing apart
    if (det > 0.2) {
      const nVeil = Math.round(clamp(90 * Math.pow(H, 1.1) * rs, 8, 600) * Math.min(q, 1.5) * fine);
      for (let i = 0; i < nVeil; i++) {
        const frac = 0.12 + 0.92 * Math.pow(rng(), 0.8), vt = lerp(...VT.veil, rng()), v = launchSpeed(H * frac, vt / G);
        const beta = (plume ? lerp(0, 18, rng()) : lerp(36, 7, Math.min(frac, 1)) + (rng() - 0.5) * 12) * DEG;
        const phi = plume ? rng() * TAU : towardAtk(), vh = v * Math.tan(Math.max(beta, 0)), rr = r0 * (0.55 + 0.5 * rng());
        const rim = rr < 1.3 * r0 && frac < 0.5;
        put(...ring(phi, rr), t0 + 0.06 * rng(), Math.cos(phi) * vh + dX * 0.2 * v * rng(), v, Math.sin(phi) * vh + dZ * 0.2 * v * rng(),
          vt, (0.03 + 0.045 * rng()) * rs * (plume ? 0.7 : 1) * cs, lerp(0.04, 0.12, rng()), (rim ? lerp(0.35, 0.8, rng()) : lerp(0.14, 0.45, rng())) * (1 - 0.45 * Math.min(frac, 1)), K_VEIL);
      }
    }
  }

  // Bait thrown out of the water by a strike (config LIFE.blitz.baitJumpHeight 0.2-1.0 m): fleeing
  // outward, mostly away from the side the predator came from.
  #baitShower(b, x, z, t0, H, r0, dX, dZ, s, dist) {
    const rng = this.rng, Bt = BAIT[b.bait];
    const n = Math.round(lerp(...Bt.count, rng()) * clamp(Math.sqrt(H), 0.45, 1.6) * Math.min(this.quality.particles ?? 1, 1.5) * (dist < DETAIL_NEAR_M ? 1 : 0.35));
    const flee = Math.atan2(dZ, dX);
    for (let i = 0, plips = 0; i < n; i++) {
      const a = flee + (rng() - 0.5) * 2.6, cx = Math.cos(a), cz = Math.sin(a), rr = r0 * (0.5 + 2.2 * rng()) + 0.3 * rng();
      plips += this.#leap(b, x + cx * rr, z + cz * rr, t0 + lerp(-0.06, 0.28, rng()), cx, cz, lerp(...B.baitJumpHeight, rng() * rng()), lerp(30, 72, rng()) * DEG, s, dist, plips < 4 ? 0.3 : 0);
    }
  }

  // A section of the school showering out of the water together (40-150 fish within 0.6 s), fleeing
  // radially from the latest strike.
  #massShower(b, t0) {
    const rng = this.rng;
    let last = b;
    for (const q of this.recentStrikes) if (q.id === b.id) last = q;
    const a0 = rng() * TAU, d0 = lerp(1.5, 4, rng()), width = lerp(3, 6, rng());
    const cx = last.x + Math.cos(a0) * d0, cz = last.z + Math.sin(a0) * d0;
    const n = Math.round(lerp(...BAIT[b.bait].shower, rng()) * Math.min(this.quality.particles ?? 1, 1.5));
    const s = this.#sea(cx, cz), dist = this.#camDist(cx, cz);
    for (let i = 0, plips = 0; i < n; i++) {
      const off = (rng() - 0.5) * width, along = (rng() - 0.5) * width * 0.5;
      const px = cx - Math.sin(a0) * off + Math.cos(a0) * along, pz = cz + Math.cos(a0) * off + Math.sin(a0) * along;
      const a = Math.atan2(pz - last.z, px - last.x) + (rng() - 0.5) * 0.9;
      plips += this.#leap(b, px, pz, t0 + 0.6 * rng(), Math.cos(a), Math.sin(a), lerp(0.15, 0.6, rng()), lerp(30, 60, rng()) * DEG, s, dist, plips < 10 ? 0.2 : 0);
    }
  }

  // One bait fish leaping from (x, z) at t along (cx, cz) with its centre peaking h above the sea; a
  // mesh near the camera, a silver fleck in the spray pass when short on screen. Returns 1 when it
  // queued a plip (a small splash where it falls back), else 0.
  #leap(b, x, z, t, cx, cz, h, elev, s, dist, plipChance) {
    const rng = this.rng, Bt = BAIT[b.bait], L0 = FISH_SPECIES[b.bait].length;
    const size = lerp(...Bt.sizeRange, rng()) / L0, L = L0 * size, now = this._t;
    const d0 = BAIT_LAUNCH_DEPTH * L, vUp = baitLaunchSpeed(h, L), vh = vUp / Math.tan(elev);
    const dur = (vUp + Math.sqrt(vUp * vUp + 2 * G * (0.6 * L - d0))) / G;   // until the centre is 0.6 L under
    if (t + dur < now) return 0;
    const y0 = this.#seaAt(s, t - now) - d0;
    if (L / Math.max(dist, 1) * this.spray.uniforms.uPxPerM.value < BAIT_SPRITE_PX) {
      this.spray.add(x, y0, z, t, cx * vh, vUp, cz * vh, BAIT_SPRITE_TAU, BAIT_HALF_DEPTH[b.bait] * L, L, 1.0, K_BAIT, dur, rng(), 0, 0);
    } else {
      const tumble = (rng() < 0.5 ? -1 : 1) * lerp(...Bt.tumble, rng()) * (rng() < 0.6 ? 0.25 : 1);
      this.fish[b.bait].launch([x, y0, z, t], [cx * vh, vUp, cz * vh, dur], [M_LEAP, size, (rng() - 0.5) * 12, rng()], [0, 0, tumble, 1.2]);
    }
    // a small plip where it falls back (bunker-sized bait near the camera)
    if (!(plipChance > 0 && L > 0.14 && dist < 80 && rng() < plipChance)) return 0;
    const tl = t + (vUp + Math.sqrt(vUp * vUp - 2 * G * d0)) / G;         // centre back through the surface
    const lx = x + cx * vh * (tl - t), lz = z + cz * vh * (tl - t);
    this.#later(tl, 1, () => this.#emitCrown(lx, this.#seaAt(this.#sea(lx, lz), tl - this._t), lz, tl, lerp(0.06, 0.14, this.rng()) * Math.sqrt(L / 0.15), 0.03, cx, cz, { plume: true }));
    return 1;
  }

  // A predator shows itself: roll (back and dorsal break the surface, tail slaps), jump (bluefish,
  // head-shaking), skyrocket (false albacore, near vertical), crash (tuna).
  #showPredator(b, x, y0, z, t0, dX, dZ, show, s) {
    const rng = this.rng, pool = this.fish[b.species], P = PREDATORS[b.species], tuna = b.species === 'bluefinTuna';
    const L = lerp(...P.sizeRange, rng()), size = L / FISH_SPECIES[b.species].length, now = this._t;
    if (show === 'roll') {
      const T = tuna ? lerp(1.0, 1.5, rng()) : lerp(0.5, 0.9, rng()), spd = tuna ? lerp(2.5, 3.5, rng()) : lerp(1.4, 2.4, rng());
      const sx = x - dX * spd * T * 0.4, sz = z - dZ * spd * T * 0.4, t = t0 + lerp(0.1, 0.35, rng());
      if (t + T < now) return;
      const fit = this.#fitPath(s, t, T, dX * spd, dZ * spd);
      pool.launch([sx, fit.c0, sz, t], [dX * spd, 0, dZ * spd, T], [M_ROLL, size, (rng() - 0.5) * 1.6, rng()], [fit.c1, fit.c2, 0.34, 0.44]);
      // the tail slaps as it goes down
      const ts = t + 0.88 * T, ex = sx + dX * spd * 0.88 * T, ez = sz + dZ * spd * 0.88 * T;
      this.#later(ts, Infinity, () => {
        const y = this.#seaAt(this.#sea(ex, ez), ts - this._t);
        this.#emitCrown(ex, y, ez, ts, tuna ? lerp(0.8, 1.4, this.rng()) : lerp(0.3, 0.55, this.rng()), tuna ? 0.35 : 0.12, dX, dZ, { det: this.#det(this.#camDist(ex, ez)) });
        this.#white(ex, y, ez, ts, tuna ? 1.6 : 0.6, 0.9, 1.2, 6, tuna ? 0.4 : 0.15, 1.3, dX, dZ);
      });
      return;
    }
    // ballistic: [elevation (deg), apex (m), roll (rad/s), splash crown (m), cavity (m)]
    const spec = { jump: [38, 60, 0.3, 0.8, 5, 0.4, 0.7, 0.14], skyrocket: [66, 86, 0.8, 2.0, 3, 0.6, 1.0, 0.16], crash: [28, 48, 0.5, 1.6, 0.8, 2.2, 3.6, 0.75] }[show];
    if (!spec) return;
    const elev = lerp(spec[0], spec[1], rng()) * DEG, apex = lerp(spec[2], spec[3], rng()), d0 = 0.45 * L;
    const vUp = Math.sqrt(2 * G * (apex + d0)), vh = vUp / Math.tan(elev), t = t0 + lerp(0.05, 0.35, rng());
    const tEntry = t + (vUp + Math.sqrt(vUp * vUp - 2 * G * d0)) / G;
    if (tEntry + 0.5 < now) return;
    pool.launch([x, y0 - d0, z, t], [dX * vh, vUp, dZ * vh, tEntry - t + 0.5], [M_LEAP, size, (rng() - 0.5) * 2 * spec[4], rng()], [0, 0, 0, tuna ? 0.4 : 0.6]);
    const ex = x + dX * vh * (tEntry - t), ez = z + dZ * vh * (tEntry - t);
    this.#later(tEntry, Infinity, () => {
      const y = this.#seaAt(this.#sea(ex, ez), tEntry - this._t), Hs = lerp(spec[5], spec[6], this.rng()), r0 = spec[7] * (tuna ? 1 : size);
      this.#emitCrown(ex, y, ez, tEntry, Hs, r0, dX, dZ, { det: this.#det(this.#camDist(ex, ez)) });
      this.#white(ex, y, ez, tEntry, tuna ? 2.6 : 0.9, 1.1, tuna ? 3 : 1.5, 8, r0 * 1.4, 1.2, dX, dZ);
      this.#ring(ex, ez, tEntry, Hs, tuna ? 3.0 : 0.9, tuna ? 1.5 : 1.0, this.#camDist(ex, ez));
    });
  }

  // Bait flipping at the surface (nervous water): a silver flash as a fish rolls onto its side.
  #flip(b, t) {
    const rng = this.rng, Bt = BAIT[b.bait], a = rng() * TAU, r = b.radius * Math.sqrt(rng());
    const pt = this.#offPile(b, b.x + Math.cos(a) * r, b.z + Math.sin(a) * r, this.#v2), T = lerp(0.25, 0.6, rng());
    const h = rng() * TAU, vx = 0.35 * Math.cos(h), vz = 0.35 * Math.sin(h), fit = this.#fitPath(this.#sea(pt.x, pt.z), t, T, vx, vz);
    this.fish[b.bait].launch([pt.x, fit.c0, pt.z, t], [vx, 0, vz, T], [M_ROLL, lerp(...Bt.sizeRange, rng()) / FISH_SPECIES[b.bait].length, (rng() < 0.5 ? -1 : 1) * lerp(1.0, 1.5, rng()), rng()], [fit.c1, fit.c2, 0.13, 0.2]);
  }

  // Boils: predators turning just under the surface leave a domed, glassy upwelling with a broken
  // rim of bubbles; the ocean draws them (dome, calm, rim), within our budget of young ones. The
  // dome is the upwelling's stagnation head w²/2g: w ~0.5-1 m/s under a bass, 1-1.5 m/s under a
  // tuna gives 1-5 cm and 5-11 cm (strength = height / the ocean's 0.16 m per unit).
  #boil(b, t, cx = b.x, cz = b.z, R = 0, dur = 0) {
    const rng = this.rng, tuna = b.species === 'bluefinTuna';
    if (!R) { const a = rng() * TAU, r = b.radius * 0.7 * Math.sqrt(rng()); cx += Math.cos(a) * r; cz += Math.sin(a) * r; R = tuna ? lerp(3.5, 5, rng()) : lerp(2, 3.5, rng()); dur = lerp(4, 6, rng()); }
    if (this.#boils.length >= BOILS || t + dur < this._t || this.#camDist(cx, cz) > 300 || !this.ctx.ocean?.addDisturbance) return;
    this.ctx.ocean.addDisturbance({ x: cx, z: cz, radius: R, strength: tuna ? lerp(0.3, 0.7, rng()) : lerp(0.08, 0.3, rng()), duration: dur, foam: 0.12, kind: 'boil', t0: t });
    this.#boils.push(t + 2 * dur);
  }
  // A ring train for a splash near the camera (the ocean's splash map): the budget by crown height.
  // A small splash's white water is small, so its train (0.7-0.9 m ripples) runs clear of it after
  // ~1.5 s; it is sent stronger and longer-lived (slopes ~0.1-0.2 at 1-1.5 m, 1.5-2.5 s) than the
  // ocean's default, or the 4.5 m/s chop would hide it there.
  #ring(x, z, t0, H, radius, strength, dist) {
    const small = H < RING_MIN_H ? 1 : 0;
    if (this.#rings[small] < 1 || dist > (small ? SMALL_RING_M : RING_MAX_M) || this._t - t0 > 1.5 || !this.ctx.ocean?.addDisturbance) return;
    this.#rings[small]--;
    this.ctx.ocean.addDisturbance({ x, z, radius, strength: (small ? 3.2 : 0.6) * strength, duration: small ? 1.5 + H : clamp(1 + 0.6 * H, 1, 3), foam: 0, kind: 'splash', t0 });
  }
  // A glassy slick left where the core fed (fish oil damping the ripples): drawn by the ocean.
  #slick(b, t, cx, cz) {
    const [x, z] = this.#ball(b, t, cx, cz);
    b.slickNew.push({ x, z, width: clamp(2.4 * b.core, 6, 16) * lerp(0.9, 1.2, this.rng()), age: Math.max(0, this._t - t) });
  }

  // The bait school under the patch: its stain and nervous water, eased toward the state's level.
  #updateSchool(b, t) {
    const bait = { menhaden: 0.85, sandEel: 0.45, anchovy: 0.6 }[b.bait] ?? 0.6;
    const up = b.state === 'down' ? 0.2 : (b.state === 'ending' ? 0.35 * (1 - smooth(b.endT - 10, b.endT, t)) : 1);
    const nerv = { rising: 1, feeding: 0.45 + 0.2 * (1 - b.intensity), down: 0.1 }[b.state] ?? 0.3;
    const k = b.stain === 0 ? 1 : 0.05;
    b.stain += (bait * up - b.stain) * k;
    b.nervous += (nerv * up - b.nervous) * k;
  }
  // The patches the ocean draws for every blitz: the pod (bait stain, nervous water, slick trail:
  // new points) and its working core (the balled bait: darkest, most nervous).
  #oceanLife() {
    const o = this.ctx.ocean;
    if (!o?.setLifePatches) return;
    const list = this.blitzes.filter((b) => !b.quiet).flatMap((b) => {
      const d = azimuthToDir(b.headingDeg, this.#v), slick = b.slickNew, h = Math.atan2(d.z, d.x);
      b.slickNew = [];
      const p = { id: b.id, x: b.x, z: b.z, radius: b.radius, heading: h, bait: b.stain, nervous: b.nervous, bait_species: b.bait, slick, d: b.dist };
      return [p, { ...p, id: -b.id, x: b.cx, z: b.cz, radius: 1.6 * b.core, bait: 1.2 * b.stain, nervous: 2.2 * b.nervous, slick: 0, d: b.dist - 1 }];
    });
    o.setLifePatches(list.sort((a, b) => a.d - b.d));
  }

  // ---------------------------------------------------------------- white water
  // White water of radius R (m), strength s, e-folds ct (dense) and lt (lace), cavity r0; elong > 1
  // stretches it along the attack (dX, dZ). Near the focused blitz it goes into the foam map.
  #white(x, y0, z, t0, R, s, ct, lt, r0, elong = 1, dX = 1, dZ = 0) {
    const q = { x, y0, z, t0, R, s, ct, lt, r0, e: Math.max(elong, 1), ang: Math.atan2(dZ, dX), seed: this.rng(), life: Math.max(ct * 3.2, lt * 1.6) };
    if (globalThis.NJOW_DEV !== false && this._ww.push(q) > 4096) this._ww.shift();
    if (this.#inMap(x, z, R * q.e * 3)) { this.#mapList.push(q); this.#mapDirty = true; } else this.#decal(q);
  }
  #decal(q) { this.decals.add(q.life, [q.x, q.y0, q.z, q.t0, q.R, q.s, q.ct, q.lt, q.e, q.ang, q.seed, q.r0]); }
  #inMap(x, z, ext) {
    const c = this.foamMap?.centre, h = FOAM_MAP.half;
    return this.#mapOn && Math.abs(x - c.x) + ext < h && Math.abs(z - c.y) + ext < h;
  }
  // Centre the foam map on a blitz (snapped); its pattern origin moves only on a 1 km grid.
  #placeMap(b) {
    if (!this.foamMap) return;
    const sn = FOAM_MAP.snap;
    this.foamMap.centre.set(Math.round(b.x / sn) * sn, Math.round(b.z / sn) * sn);
    this.foamUniforms.uAnchor.value.set(Math.round(b.x / 1024) * 1024, Math.round(b.z / 1024) * 1024);
    this.#mapOn = true;
  }
  // Each frame: follow the focused blitz, stamp its white water and scum, lay the map's decal.
  #updateFoamMap(t) {
    const M = this.foamMap, w = U.uWind.value, u = this.foamUniforms;
    u.uDrift.value.set(w.x * FOAM_DRIFT, w.y * FOAM_DRIFT);
    if (!M) return;
    const f = this.enabled ? this.blitzes.find((q) => q.id === this.focusId) : null;
    if (!f) {
      if (this.#mapOn) for (const q of this.#mapList) if (t - q.t0 < q.life) this.#decal(q);   // handed to decals
      this.#mapList.length = 0;
      this.#mapOn = false;
      return;
    }
    const c = M.centre, h = FOAM_MAP.half;
    if (!this.#mapOn || Math.abs(f.x - c.x) > 12 || Math.abs(f.z - c.y) > 12) { this.#placeMap(f); this.#mapDirty = true; }
    if (t === this.#mapT && !this.#mapDirty) return;          // a frozen frame keeps its map
    this.#mapT = t; this.#mapDirty = false;
    M.uniforms.uOrigin.value.set(c.x - u.uAnchor.value.x - u.uDrift.value.x * t, c.y - u.uAnchor.value.y - u.uDrift.value.y * t);
    M.begin(c.x, c.y);
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    const grow = (x, z, e) => { x0 = Math.min(x0, x - e); x1 = Math.max(x1, x + e); z0 = Math.min(z0, z - e); z1 = Math.max(z1, z + e); };
    this.#mapList = this.#mapList.filter((q) => {
      const age = Math.max(t - q.t0, 0);
      if (age > q.life) return false;
      const x = q.x + u.uDrift.value.x * age, z = q.z + u.uDrift.value.y * age;
      const ext = 2.4 * q.e * (q.R * (0.55 + 0.6 * (1 - Math.exp(-age / 0.8))) + 0.015 * age);
      if (Math.abs(x - c.x) + ext > h || Math.abs(z - c.y) + ext > h) { this.#decal(q); return false; }   // left behind: a decal
      if (M.put(x, z, age, 0, q.R, q.s, q.ct, q.lt, q.e, q.ang, q.seed, q.r0)) grow(x, z, ext);
      return true;
    });
    for (const b of this.blitzes) {
      if (!(b.scum > 0.01) || Math.abs(b.cx - c.x) > h || Math.abs(b.cz - c.y) > h) continue;
      const d = azimuthToDir(b.headingDeg, this.#v);
      if (M.put(b.cx, b.cz, 0, 1, b.core * 2.8, b.core * 2, b.scum, 0, d.x, d.z, (b.id * 0.618) % 1, 0)) grow(b.cx, b.cz, b.core * 3.7);
    }
    M.render();
    const on = M.n > 0;
    x0 = Math.max(x0, c.x - h); x1 = Math.min(x1, c.x + h); z0 = Math.max(z0, c.y - h); z1 = Math.min(z1, c.y + h);
    const bx = on ? (x0 + x1) / 2 : c.x, bz = on ? (z0 + z1) / 2 : c.y;
    this.mapDecal.buf.set(0, [bx, -curvatureDrop(bx, bz), bz, 0, Math.max((x1 - x0) / 2, 0.5), on ? Math.max((z1 - z0) / 2, 0.5) : 0, 0, -1, 1, 0, 0, 1]);
    this.mapDecal.used = 1; this.mapDecal.lastEnd = Infinity;
    u.uFoamArea.value.set(c.x, c.y, 1 / (2 * h), 0);
  }

  // ---------------------------------------------------------------- helpers
  #at(t, fn) {
    let i = this.#events.length;
    while (i > 0 && this.#events[i - 1].t > t) i--;
    this.#events.splice(i, 0, { t, fn });
  }
  // fn at time t: now if t has passed (and is less than `within` s ago), else when it comes
  #later(t, within, fn) { if (t > this._t) this.#at(t, fn); else if (t + within > this._t) fn(); }

  #camDist(x, z) { return Math.hypot(x - this.#camPos.x, z - this.#camPos.z, this.#camPos.y + curvatureDrop(x, z)); }
  // Detail of spray near (1) and far (fewer, larger parcels): from the pixels per metre there.
  #det(dist) { return clamp(this.spray.uniforms.uPxPerM.value / Math.max(dist, 1) / 30, 0.05, 1); }

  // The sea under (x, z) now: { y, vy, sx, sz, mean } from one ocean.getSurface at the current time.
  // The ocean's CPU mirror caches a single time, so sampling other times would re-evolve its whole
  // spectrum for every caller in the frame; other times are extrapolated (#seaAt). Samples are
  // shared within 0.75 m for the frame, and a time budget caps the cost.
  #sea(x, z) {
    const t = this._t, mean = -curvatureDrop(x, z), ocean = this.ctx.ocean;
    if (!ocean?.getSurface) return { x, z, t, y: mean, vy: 0, sx: 0, sz: 0, mean };
    let near = null, nd = Infinity;
    for (const s of this.#seaCache) { const d = (s.x - x) ** 2 + (s.z - z) ** 2; if (d < nd) { nd = d; near = s; } }
    if (nd < 0.56) return near;
    if (near && this.#seaMs > SEA_MS_PER_FRAME && nd < 400) return { ...near, x, z, y: near.y - near.mean + mean, mean };
    const c0 = performance.now();
    ocean.getSurface(x, z, t, this.#surf);
    this.#seaMs += performance.now() - c0;
    const n = this.#surf.normal, ny = Math.max(n.y, 0.2);
    const s = { x, z, t, y: this.#surf.y, vy: this.#surf.velocity?.y ?? 0, sx: -n.x / ny, sz: -n.z / ny, mean };
    if (this.#seaCache.push(s) > 48) this.#seaCache.shift();
    return s;
  }
  // The sea under a sampled point dt seconds from now (harmonic extrapolation at the wind-sea peak).
  #seaAt(s, dt, vyExtra = 0) {
    return dt ? s.mean + (s.y - s.mean) * Math.cos(SEA_OMEGA * dt) + (s.vy + vyExtra) / SEA_OMEGA * Math.sin(SEA_OMEGA * dt) : s.y;
  }
  // Quadratic fit in time of the sea under a point moving at (vx, vz) from t0 for T seconds:
  // y(age) = c0 + c1 age + c2 age² (sampled from the extrapolated sea at t0, t0 + T/2, t0 + T).
  #fitPath(s, t0, T, vx, vz) {
    const e = s.sx * vx + s.sz * vz, d0 = t0 - this._t;
    const h0 = this.#seaAt(s, d0, e), h1 = this.#seaAt(s, d0 + T / 2, e), h2 = this.#seaAt(s, d0 + T, e);
    return { c0: h0, c1: (4 * h1 - 3 * h0 - h2) / T, c2: (2 * h2 - 4 * h1 + 2 * h0) / (T * T) };
  }

  #updateFocus(t) {
    const score = (b) => b.score + 0.5 * b.intensity + (b.state === 'rising' ? 0.2 : 0);
    let best = null;
    for (const b of this.blitzes) if (t <= b.endT && score(b) > (best ? score(best) : 0)) best = b;
    const cur = this.blitzes.find((b) => b.id === this.focusId && t < b.endT);
    // hysteresis: the camera does not flit
    if (!cur || (best && best !== cur && score(best) > 2.5 * (cur.score + 0.5 * cur.intensity) + 0.5)) this.focusId = best?.id ?? null;
  }

  // Sky irradiance / π for the spray and foam: the atmosphere's (its ambient table, as the ocean
  // lights the sea), else ~0.6 × the horizon. (The ocean's uEsky is a constant for dev stubs: lighting
  // with it lit night foam ~10⁶× too bright, p2 integration.)
  #lighting() {
    const s = this.ctx.atmosphere?.skyIrradiance, f = U.uFogInscatter.value;
    if (s?.isColor) this.skyE.value.set(s.r, s.g, s.b).multiplyScalar(1 / Math.PI);
    else this.skyE.value.set(f.r, f.g, f.b).multiplyScalar(0.6);
  }
}

// Bait leaves the water from BAIT_LAUNCH_DEPTH x L under the surface; its centre peaks h above it.
const BAIT_LAUNCH_DEPTH = 0.35;
function baitLaunchSpeed(h, L) { return Math.sqrt(2 * G * (h + BAIT_LAUNCH_DEPTH * L)); }
// A bait fleck flies without appreciable drag: a long time constant keeps the GPU's drag trajectory
// ballistic (5 % slower at 1 s) and within float precision.
const BAIT_SPRITE_TAU = 40;
// Half the body depth (fraction of L) of each bait species, from its stations.
const BAIT_HALF_DEPTH = Object.fromEntries(Object.keys(BAIT).map((k) => [k, Math.max(...FISH_SPECIES[k].stations.map((s) => s[1]))]));

// A key of `weights` (object, or an array's index) drawn with probability ∝ weight; null if none.
function pickWeighted(weights, rng) {
  const e = Object.entries(weights);
  let r = rng() * e.reduce((s, [, w]) => s + w, 0);
  for (const [k, w] of e) if (w > 0 && (r -= w) <= 0) return Array.isArray(weights) ? +k : k;
  return null;
}

// ---------------------------------------------------------------- dev builds: diagnostics, scales
if (globalThis.NJOW_DEV !== false) {
  Object.assign(Blitz.prototype, {
    /**
     * One predator strike at (x, z) now. opts: { species, height (crown m), bait, show: 'roll' |
     * 'jump' | 'skyrocket' | 'crash' | 'none', t0, dirX, dirZ }. Uses (or creates) the nearest blitz
     * within 60 m.
     */
    strikeAt(x, z, opts = {}) {
      if (!this.enabled || !Number.isFinite(x) || !Number.isFinite(z)) return false;
      this._t = U.uTime.value;
      let b = this.blitzes.find((q) => Math.hypot(q.x - x, q.z - z) < 60 && this._t < q.endT && (!opts.species || q.species === opts.species));
      if (!b) { b = this._createBlitz(x, z, this._t, { species: opts.species ?? this._pickSpecies(false), bait: opts.bait, forced: true, quiet: true }); this._refreshPiles(b, this._t); }
      if (opts.bait) b.bait = opts.bait;
      this._strike(b, x, z, opts.t0 ?? this._t, { ...opts, full: true });
      return true;
    },
    /**
     * White water on the sea now round a blitz (default: the focused one): area (m²) where the dense
     * foam's density is ≥ 0.5, within 1.5 radii of the centre, and the fraction of π r² that is.
     */
    whiteWater(id = this.focusId) {
      const b = this.blitzes.find((q) => q.id === id);
      if (!b) return null;
      let m2 = 0, n = 0;
      const t = this._t, w = U.uWind.value;
      for (const q of this._ww) {
        const age = t - q.t0;
        if (age < 0 || Math.hypot(q.x + w.x * FOAM_DRIFT * age - b.x, q.z + w.y * FOAM_DRIFT * age - b.z) > 1.5 * b.radius) continue;
        const dens = Math.min(1.4, 1.5 * q.s * Math.exp(-age / q.ct));
        if (dens < 0.5) continue;
        // dens · (1 - smoothstep(0.15, 1, rn)) >= 0.5  ->  rn <= r*
        let lo = 0, hi = 1;
        for (let it = 0; it < 14; it++) { const m = (lo + hi) / 2; if (m * m * (3 - 2 * m) < 1 - 0.5 / dens) lo = m; else hi = m; }
        m2 += Math.PI * ((q.R * (0.55 + 0.6 * (1 - Math.exp(-age / 0.8))) + 0.015 * age) * (0.15 + 0.85 * lo)) ** 2 * q.e;
        n++;
      }
      return { m2: +m2.toFixed(2), fraction: +(m2 / (Math.PI * b.radius * b.radius)).toFixed(4), patches: n };
    },
    _registerScales() {
      const src = 'blitz.js: measured from the built geometry';
      for (const [key, pool] of Object.entries(this.fish)) {
        const e = { sandEel: 0.03, anchovy: 0.016 }[key];
        registerScale({ name: `fish.${key}.length`, geometry: pool.base, expect: e ? { axis: 'z', metres: FISH_SPECIES[key].length, tolerance: e } : { axis: 'z' }, source: src });
      }
      // crown heights: the tallest launch of the smallest and largest strike, re-integrated numerically
      const apexFor = (H) => {
        const tau = VT.clump[0] / G;
        let y = 0, v = launchSpeed(H, tau), best = 0;
        while (v > 0) { v += (-G - v / tau) * 1e-4; y += v * 1e-4; best = Math.max(best, y); }
        return best;
      };
      const reg = (name, v, metres, tolerance, source) => registerScale({ name, measure: () => ({ x: v(), y: v(), z: v() }), expect: { axis: 'y', metres, tolerance }, source });
      const sb = B.splashHeight.bassBlues, st = B.splashHeight.tuna, jb = B.baitJumpHeight;
      reg('blitz.crown.bassBlues.min', () => apexFor(sb[0]), sb[0], 0.05, 'blitz.js crown emitter (drag trajectory re-integrated); LIFE.blitz.splashHeight');
      reg('blitz.crown.bassBlues.max', () => apexFor(sb[1]), sb[1], 0.1, 'blitz.js crown emitter; LIFE.blitz.splashHeight');
      reg('blitz.crown.tuna.min', () => apexFor(st[0]), st[0], 0.15, 'blitz.js crown emitter; LIFE.blitz.splashHeight');
      reg('blitz.crown.tuna.max', () => apexFor(st[1]), st[1], 0.3, 'blitz.js crown emitter; LIFE.blitz.splashHeight');
      const leap = (h) => { const v = baitLaunchSpeed(h, FISH_SPECIES.menhaden.length); return v * v / (2 * G) - BAIT_LAUNCH_DEPTH * FISH_SPECIES.menhaden.length; };
      reg('blitz.bait.leap.min', () => leap(jb[0]), jb[0], 0.05, 'blitz.js bait leap launch (centre apex above the surface); LIFE.blitz.baitJumpHeight');
      reg('blitz.bait.leap.max', () => leap(jb[1]), jb[1], 0.1, 'blitz.js bait leap launch (centre apex above the surface); LIFE.blitz.baitJumpHeight');
      reg('blitz.patch.diameter.max', () => Math.max(...Object.values(PREDATORS).map((p) => p.patch[1])), B.patchDiameter[1], 2, 'blitz.js PREDATORS.patch; LIFE.blitz.patchDiameter');
      reg('blitz.travel.speed.max', () => Math.max(...Object.values(PREDATORS).map((p) => p.speed[1])), B.travelSpeed[1], 0.1, 'blitz.js PREDATORS.speed; LIFE.blitz.travelSpeed');
    },
  });
}
