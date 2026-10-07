// Scene constants. Lead-owned: every number here comes from research/SCENE-SPEC.md (section in
// brackets). Units: metres, seconds, degrees. Colours: `lin` = linear RGB reflectance/albedo,
// `hex` = display sRGB. Axes: +X east, +Y up, +Z south. Origin: hero foundation axis at MSL.

export const SITE = {
  project: 'Atlantic Shores Offshore Wind South',       // [0] as permitted, not built
  status: 'planned (COP approved 2024-10-01, remanded 2026-08-10); nothing is built off NJ yet',
  heroId: 'F01',
  heroLat: 39.27716406, heroLon: -74.24829964,           // [3.1]
  atlanticCity: { distanceM: 17900, bearingDeg: 302.7 }, // [3.1]
  waterDepthM: 22,                                        // [3.1] ESTIMATED at the hero
  tzStandard: -5, tzDaylight: -4,                         // EST / EDT
  caption: 'Vestas V236-15.0 MW on the Atlantic Shores South layout (as permitted, not built) · 1,111 m in-row × 1,852 m between rows · 17 km off Atlantic City',
  photoNote: 'Reference photo: Borkum Riffgrund 1 (German North Sea), Siemens SWT-4.0-120, 83 m hub.',
};

export const DATUMS = { HAT: 1.122, MHHW: 0.728, MSL: 0, MLLW: -0.675, LAT: -1.077 }; // [3.2]

export const RENDER = {
  near: 0.5, far: 150000,          // [18] overview needs ~110 km of sea
  logarithmicDepthBuffer: true,    // three-r180-api §11: every custom ShaderMaterial must include the logdepthbuf chunks
  maxPixelRatio: 1.5,
};

// ---------------------------------------------------------------- TURBINE (Vestas V236-15.0 MW) [4]
export const TURBINE = {
  model: 'Vestas V236-15.0 MW',
  ratedMW: 15,
  rotorDiameter: 236, tipRadius: 118, bladeLength: 115.5, hubRadius: 3.0,       // [4.1]
  hubHeight: 152.0, tipHeight: 270, lowestTip: 34,
  tiltDeg: 6, coneDeg: 4, prebendTip: 3.95, overhang: 12.0, towerTopToHub: 5.6,
  cutIn: 3, cutOut: 31, ratedWind: 10.6,
  // vertical stack at the foundation [4.2]
  stack: {
    seabed: -22,
    growthBottom: -1.1, growthTop: 1.8, growthFade: 0.5,
    yellowBottom: 0.73, yellowTop: 21.5,
    idBottom: 11.0, idTop: 14.0,
    skirtBottom: 17.0, deck: 18.5, railTop: 19.6,
    marineLanterns: 20.5, tpTop: 21.5,
    midMastLights: 79.2,
    towerTop: 146.4, nacelleFloor: 147.4, hub: 152.0, nacelleRoof: 158.4,
    l864: 161.2, coolerTop: 160.2,   // L-864s on short masts so the cooler never hides them (FAA: visible 360 deg)
  },
  // blade planform [4.3]: s = span fraction, r = radius from hub centre (m)
  // columns: s, r, chord, twistDeg, t/c, thickness, prebend (- = upwind), pitchAxisX/c
  blade: [
    [0.000,   3.0, 5.13, 15.59, 1.000, 5.13,  0.00, 0.505],
    [0.020,   5.3, 5.14, 15.59, 1.000, 5.14,  0.02, 0.490],
    [0.050,   8.8, 5.19, 15.21, 0.939, 4.88,  0.05, 0.464],
    [0.100,  14.6, 5.37, 13.49, 0.704, 3.79,  0.13, 0.417],
    [0.150,  20.3, 5.58, 11.03, 0.502, 2.80,  0.21, 0.376],
    [0.207,  26.9, 5.69,  8.43, 0.399, 2.27,  0.25, 0.339],
    [0.250,  31.9, 5.61,  7.03, 0.358, 2.01,  0.25, 0.323],
    [0.300,  37.7, 5.30,  5.52, 0.338, 1.79,  0.24, 0.312],
    [0.400,  49.2, 4.64,  3.22, 0.311, 1.44,  0.20, 0.300],
    [0.500,  60.8, 4.10,  1.69, 0.282, 1.16, -0.05, 0.289],
    [0.600,  72.3, 3.63,  0.56, 0.251, 0.91, -0.49, 0.289],
    [0.700,  83.9, 3.18, -0.49, 0.223, 0.71, -1.14, 0.299],
    [0.800,  95.4, 2.73, -1.94, 0.211, 0.58, -1.93, 0.314],
    [0.900, 107.0, 2.24, -2.10, 0.211, 0.47, -2.86, 0.335],
    [0.950, 112.7, 1.96, -1.82, 0.211, 0.41, -3.39, 0.350],
    [0.980, 116.2, 1.79, -1.50, 0.211, 0.38, -3.72, 0.360],
    [0.995, 117.9, 1.45, -1.31, 0.211, 0.31, -3.89, 0.366],
    [1.000, 118.5, 0.49, -1.24, 0.211, 0.10, -3.95, 0.368],
  ],
  airfoils: 'circle s 0-0.02, then FFA-W3 family 50% -> 21.1% thick; rounded swept tip cap over last 2% span; positive twist turns the leading edge upwind',
  // nacelle, hub (yaw frame: origin on tower axis at y = stack.towerTop; rotor side = +Z) [4.4]
  nacelle: {
    height: 11.0, width: 9.0, overallLength: 28.0,
    boxFrontZ: 12.0 - 3.0,     // box front is 3.0 m behind the hub centre (hub centre at z = +12.0)
    boxRearZ: 12.0 - 22.0,     // box rear 22.0 m behind the hub centre -> z = -10.0
    boxLength: 19.0, topEdgeRadius: 1.0, floorY: 1.0,   // floor 1.0 m above the yaw bearing
    heliDeck: { length: 3.0, width: 9.0, railHeight: 1.1 },   // rear 3.0 m of the roof
    cooler: { height: 1.8, fractionOfRoof: 1 / 3 },           // open radiator frame, rear third
    metMastHeight: 2.0,
  },
  hubCentre: [0, 5.6, 12.0],   // in the yaw frame (x, y, z)
  spinner: { diameter: 7.5, length: 6.0, noseAheadOfHub: 3.5 },
  // tower [4.5]: y (m), D (m)
  tower: [
    [21.5, 10.00], [34.0, 10.00], [46.5, 9.95], [59.0, 9.60], [71.5, 9.16], [84.0, 8.68],
    [96.4, 8.14], [108.9, 7.79], [121.4, 7.68], [133.9, 7.55], [146.4, 7.50],
  ],
  towerFlangesY: [52.7, 83.9, 115.2], flangeBand: 0.08, weldSeamPitch: 3.5,
  door: { width: 1.0, height: 2.2, bottomY: 18.5 },          // in the TP wall at deck level, facing the boat landing
  // transition piece, platform, boat landing [4.6]
  tp: { diameter: 10.5, topFlange: { proud: 0.3, height: 0.3 } },
  platform: { outerDiameter: 15.75, lobeSpan: 20.4, skirtDepth: 1.5, railHeight: 1.1, postPitch: 1.5, kneeRailGapMax: 0.5 },
  boatLanding: {
    facingDeg: 20,                 // compass bearing the landing faces (NNE, lee side)
    tubeDiameter: 0.406, tubeSpacing: 1.8, ladderSetback: 0.85, ladderWidth: 0.5,
    rungSize: 0.03, rungPitch: 0.28, tubeBottom: -3.98, tubeTop: 8.7, restPlatformY: 8.7,
  },
  davit: { jibLength: 4.5 },
  idCharHeight: 3.0,               // black RAL 9005 characters painted at 4 azimuths
  // operation [4.9]
  spinClockwiseFromUpwind: true,   // rotor.rotation.z = -omega * t in the rotor frame (+Z = upwind)
  referencePhaseDeg: 50,           // blade 0 at 50 deg clockwise from top seen from upwind (photo fit)
  rpmMin: 5.0, rpmMax: 7.9, tsr: 9, idleRpm: 0.5, idleFraction: 0.04,
  yawOffsetSigmaDeg: 3, yawRateDegPerS: 0.5,
  shearAlpha: 0.14,
};
export function hubWind(u10) { return u10 * Math.pow(TURBINE.hubHeight / 10, TURBINE.shearAlpha); }
export function rotorRpm(u10) {
  const u = hubWind(u10);
  if (u < TURBINE.cutIn) return TURBINE.idleRpm;
  if (u >= TURBINE.cutOut) return 0;
  const rpm = TURBINE.tsr * u / TURBINE.tipRadius * 9.549;
  return Math.min(TURBINE.rpmMax, Math.max(TURBINE.rpmMin, rpm));
}

// ---------------------------------------------------------------- MATERIALS [4.8]
export const PAINT = {
  ral7035: { lin: [0.547, 0.567, 0.530], hex: '#c3c6c0', roughness: 0.50, metalness: 0, clearcoat: 0.2, clearcoatRoughness: 0.35 }, // tower/nacelle/spinner/blades
  ral9010: { lin: [0.871, 0.852, 0.765], hex: '#f0eee3' },
  ral1023: { lin: [0.941, 0.478, 0.020], hex: '#f8b800', roughness: 0.55, metalness: 0 },   // TP + railings
  galvanised: { lin: [0.525, 0.539, 0.536], hex: '#c0c2c1', roughness: 0.55, metalness: 1.0 },
  ral9005: { lin: [0.002, 0.002, 0.003], hex: '#060609', roughness: 0.6 },
  ral3020: { lin: [0.476, 0.005, 0.000], hex: '#b71100', roughness: 0.5 },                  // photoLook only
  marineGrowth: { lin: [0.005, 0.004, 0.002], hex: '#100e08', roughnessDry: 0.8, roughnessWet: 0.25 },
  rust: { lin: [0.20, 0.08, 0.03], coverageMax: 0.10 },
};
// Markings [4.7]. US (FAA) default: solid blades, no nacelle stripe. photoLook reproduces the
// German reference photo's 3 tip bands (RAL 3020 / 7035 / 3020, 0.10 R = 11.8 m each) + nacelle stripe.
export const MARKINGS = {
  photoLookDefault: false,
  tipBands: { count: 3, lengthEach: 11.8, colours: ['ral3020', 'ral7035', 'ral3020'] },
  nacelleStripe: { height: 2.0, colour: 'ral3020' },
};

// ---------------------------------------------------------------- LAYOUT [5]
export const LAYOUT = {
  a: [1096.55, -182.02],   // (x, z) next turbine along a row, bearing 80.575 T, |a| = 1111.56
  b: [84.06, 1863.99],     // (x, z) next row south, bearing 177.418 T, |b| = 1865.88
  // rows: dj -> [diMin, diMax] inclusive; 200 positions; hero = (0, 0)
  rows: {
    '-5': [5, 6], '-4': [5, 16], '-3': [6, 17], '-2': [5, 18], '-1': [1, 19], '0': [0, 24],
    '1': [3, 23], '2': [5, 23], '3': [5, 23], '4': [4, 21], '5': [5, 19], '6': [8, 18],
    '7': [9, 15], '8': [10, 14], '9': [12, 12],
  },
  count: 200,
  jitter: 0,
  // ID: row letter from dj (-5 -> A ... +9 -> O), column number = di + 1. Hero = F01.
  rowLetters: 'ABCDEFGHIJKLMNO', rowLetterOffset: 5,
};
export function layoutPositions() {
  const out = [];
  for (const [djs, [lo, hi]] of Object.entries(LAYOUT.rows)) {
    const dj = +djs;
    for (let di = lo; di <= hi; di++) {
      out.push({
        di, dj,
        x: di * LAYOUT.a[0] + dj * LAYOUT.b[0],
        z: di * LAYOUT.a[1] + dj * LAYOUT.b[1],
        id: LAYOUT.rowLetters[dj + LAYOUT.rowLetterOffset] + String(di + 1).padStart(2, '0'),
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------- SUBSTATION [6]
export const SUBSTATION = {
  type: 'ASOW Large OSS',
  topside: { length: 90, width: 50, height: 40 },     // long axis perpendicular to the rows
  interfaceY: 22.6, topY: 62.6,
  jacketLegs: 8, legYellowTop: 16,
  position: [13706.9, -2275.3],                      // (x, z) on the hero row between di 12 and 13
  longAxisBearingDeg: 170.6,
  colours: { clad: 'ral7035' },
  lights: { l810TopCorners: 4, l810Mid: 4, l810MidY: 31, l810Cd: 32, marineY: 20, marineClass: 'interior' },
};

// ---------------------------------------------------------------- CAMERA PRESETS [7]
// Rotation order 'YXZ': rotation.y = -heading (rad), rotation.x = pitch (rad).
export const CAMERA_PRESETS = {
  drone:     { label: 'Drone (reference)', position: [-649.5, 127.5, 420.9], headingDeg: 58.5, pitchDeg: -3.209, vfovDeg: 31.40 },
  deck:      { label: 'CTV deck',          position: [5.5, 4.0, -15.0],      headingDeg: 200.0, pitchDeg: 8, vfovDeg: 60 },   // round 4: pitched down so the bow fender on the tubes, the ladder and the water are in frame
  nacelle:   { label: 'Nacelle roof',      position: [3.5, 160.1, -9.4],     headingDeg: 58.5, pitchDeg: -10, vfovDeg: 50 },
  blitz:     { label: 'Blitz',             position: [-180, 25, 120],        headingDeg: 57, pitchDeg: -12, vfovDeg: 45 },
  overview:  { label: 'Farm overview',     position: [-2830, 900, 2830],     headingDeg: 50, pitchDeg: -10, vfovDeg: 45 },
  cinematic: { label: 'Cinematic',         orbitRadius: [700, 800], altitude: [90, 150], degPerSec: 0.5, loopSeconds: 120, vfovDeg: [31.4, 40] },
};
export const DEFAULT_VIEW = 'drone';

// ---------------------------------------------------------------- TIME + SUN [8]
// Revised 2026-09-30 (polish 1, atmosphere #11): a fit of the photo's tower/TP brightness profiles puts the sun
// further to the side than the 16:30 estimate (psi 44-52 deg). 17:15 EDT: sun az ~273.5, el ~34.4 at the hero.
// Round 3 (2026-10-06): back to 16:30. At 17:15 the camera-facing TP sat ~1 EV hotter than the photo
// (POLISH-2 §12.4); 16:30 is the geometry-derived sun of SCENE-SPEC §8 (az 266.6, el 43.0).
export const TIME_DEFAULT = { year: 2026, month: 6, day: 21, hours: 16.5 };
export const SUN = { angularRadiusRad: 0.004675, checkDirAtDefault: [-0.7304, 0.6817, 0.0435] };

// ---------------------------------------------------------------- ATMOSPHERE [9]
export const ATMOS = {
  planetRadius: 6360e3, topRadius: 6460e3,           // 100 km top (was 60 km; the atmosphere enforced 100 km internally)
  rayleighScattering: [5.802e-6, 13.558e-6, 33.100e-6], rayleighScaleHeight: 8000,
  // Haze revised 2026-09-30 (polish 1): the photo's horizon-sea step and crisp far turbines support sigma(550)
  // ~6.6e-5 /m (visibility ~59 km); SCENE-SPEC C9's 1.2e-4 came from TP chroma contaminated by pixel mixing.
  // Round 3 (2026-10-06): surface haze cut to sigma(550) 3.0e-5 /m with a 2.5 km aerosol scale height. The photo keeps
  // TPs yellow and turbines crisp out to ~15 km (T ~0.85 at 7.8 km, POLISH-2 §9.2) while the horizon band stays bright
  // because 40+ km grazing paths still saturate. Column AOD(550) = 1.644e-5 * 2500 = 0.041.
  mieExtinction: [13.3e-6, 16.44e-6, 20.55e-6], mieSingleScatterAlbedo: 0.985,   // sea-salt maritime aerosol SSA 0.98-0.99
  mieG: 0.80, mieScaleHeight: 2500,
  ozoneAbsorption: [0.650e-6, 1.881e-6, 0.085e-6], ozoneLayer: { start: 10e3, peak: 25e3, end: 40e3 },
  groundAlbedo: 0.06,
  visibilityM: 130000,                                 // 3.912 / 3.0e-5
  // aerial perspective on geometry [9.1]
  fogDensity: 3.0e-5, fogDensityRGB: [1.91e-5, 3.00e-5, 5.37e-5], fogHeightFalloff: 1 / 2500,   // Rayleigh + Mie per channel
  // horizontal path at TP height (12 m) with the 1/1200 height falloff (the atmosphere's dev-page probes)
  transmittanceCheck: { 774: 0.977, 1850: 0.946, 2950: 0.916, 6300: 0.829, 10000: 0.742, 20000: 0.551 },
};

// ---------------------------------------------------------------- CLOUDS [10]
export const CLOUDS = {
  baseAltitude: 1100, thickness: 300, cover: 0.28,
  coverByElevationPhoto: [[10, 12.6, 0.18], [7.8, 10.2, 0.30], [5.3, 7.8, 0.17], [2.8, 5.3, 0.13], [0, 2.8, 0.03]],
  shapes: 'flat-bottomed cumulus humilis puffs 1.2-2 km across + elongated stratocumulus streaks; horizon compression by perspective only',
  opticalDepth: [2, 6], edgeFadeM: [100, 200],
  driftMS: [5.66, -5.66],          // (x, z) m/s, from 225 T at 8 m/s
  cirrus: { altitude: 7000, tau: 0.05 },
  photo: { topHex: '#efeef1', baseHex: '#cedaeb', baseToTopLinear: 0.48 },
};

// ---------------------------------------------------------------- SEA [11]
export const SEA = {
  windSpeed: 4.5, windFromDeg: 200.5, windVectorToward: [1.58, -4.22],        // U10, (x, z) toward
  windSea: { Hs: 0.50, Tp: 3.8, wavelength: 22, gamma: 3.3, spreadS: 3, towardDeg: 20.5 },
  swell: { Hs: 0.45, Tp: 7.5, fromDeg: 160, gamma: 3.3, spreadS: 15, wavelength: 82.0, speed: 10.9 },
  detailWavelengths: [0.02, 6],     // normal-map-only band; photo near texture peaks at 6.4-7.4 m
  slicks: { roughnessMod: 0.12, patchSize: [50, 170] },
  whitecapOnsetWind: 5.0,           // render onset (Monahan W = 3.84e-4 * U^3.41 %)
  pileFoamRingWidth: [0.5, 1.5],
  ior: 1.333,
  absorption: [0.35, 0.077, 0.075], backscatter: [0.0028, 0.0038, 0.0055],   // per metre
  upwellingReflectance: [0.0019, 0.0087, 0.0118],                            // pi*Rrs, FU class 4
  photoTargets: { horizonHex: '#b5cfe4', at1kmHex: '#79a0c3', nearMeanHex: '#33475c', troughHex: '#000a1a', facetHex: '#57708a' },
};

// ---------------------------------------------------------------- LOOK [12]
export const LOOK = {
  toneMapping: 'ACESFilmic',
  exposureRule: 'exposure = 1.43 / Y(L_horizon)',   // L_horizon: sky radiance 0-1.5 deg above horizon in the view azimuth
  horizonExposedY: 1.43,
  horizonOverSunSanity: [0.08, 0.16],               // Y(L_horizon) / E_sun, sr^-1
  sceneUnitLux: 25000,                               // 1 scene illuminance unit ~ 25,000 lx; radiance 1 ~ 25,000 cd/m2
  nightExposureMaxGain: 3e5,                        // raised 2026-09-30: 3e4 left moonless nights at lights-only (INTEGRATION §7.1)
  vignette: 0, grainDither: 0.5 / 255, blackToe: 0.003, sharpen: 0.05,
  bloomThresholdRule: '>= 2 * Y(L_horizon) * exposure (exposed units)',
  exposedTargets: {
    horizon: 1.43, skyTop: 0.53, sky10: 0.68, towerLitMin: 5.9, towerShade: 0.16, nacelleUnder: 0.37,
    tpLit: 1.43, tpShade: 0.29, cloudTop: 1.63, cloudBase: 0.78,
  },
};
export const SHADOW = { halfExtent: 190, near: 1, far: 1400, mapSize: 4096, bias: -0.0001, normalBias: 0.1 }; // [12.4]

// ---------------------------------------------------------------- NIGHT LIGHTS [13]
export const NIGHT_LIGHTS = {
  l864: { perTurbine: 2, y: 161.2, cd: 2000, periodS: 2.0, onS: 0.5, lensD: 0.30, colour: 'red' },   // synchronised farm-wide
  l810: { perTurbine: 4, y: 79.2, cd: 32, lensD: 0.15, colour: 'red', syncWithL864: true },
  verticalBeam: { fullAboveDeg: -1, at10Deg: 0.03, below: 0.01 },
  adlsDefault: false,     // lights ON by default; UI toggle simulates ADLS (dark unless aircraft)
  marine: {
    y: 20.5, perStructure: 2, lensD: 0.20, lensH: 0.30, colour: 'yellow',
    beamFWHMDeg: 10, beamFloor: 0.02,   // floor = relative intensity outside the beam; farm AND ocean read both   // vertical divergence of the LED lanterns; farm AND ocean read this (round 3: they disagreed, 10 vs 7)
    SPS:      { onS: 0.3, periodS: 1.0, cd: 52 },    // Q Y
    IPS:      { onS: 1.0, periodS: 2.5, cd: 12 },    // Fl Y 2.5 s
    inner:    { onS: 1.0, periodS: 6.0, cd: 4.3 },   // Fl Y 6 s
    interior: { onS: 1.0, periodS: 15.0, cd: 0.9 },  // Fl Y 15 s
  },
  // radiance of a lamp core in scene units = cd / (lens area m2 * LOOK.sceneUnitLux)
};

// ---------------------------------------------------------------- VESSELS [14]
export const VESSELS = {
  ctv: {
    model: 'StratCat 27-class aluminium catamaran', length: 27.0, beam: 8.9, draft: 1.5,
    transitSpeed: 11.3, approachSpeed: 2.5,
    foredeckY: 2.2, wheelhouseRoofY: 6.5, mastheadLightY: 11.0,
    livery: 'white superstructure, blue hull band with teal stripe, black bottom, black rubber bow fender 0.5 m thick x 3 m wide',
    lights: { masthead: { cd: 52, arcDeg: 225 }, side: { cd: 4.3, arcDeg: 112.5 }, stern: { cd: 4.3, arcDeg: 135 } },
  },
  sov: {
    model: 'ECO Edison / ECO Liberty class', length: 80, beam: 19, draft: 6,
    mainDeckY: 5, bridgeTopY: 22, gangwayTowerTopY: 25, mastY: 30,
    livery: 'dark navy hull, white superstructure, white gangway + elevator tower, orange rescue boat',
    station: { di: 8, dj: 6 },     // on DP at SPS turbine (8, +6), upwind side
    lights: { masthead: { cd: 94 }, side: { cd: 12 }, stern: { cd: 12 }, rabRedWhiteRed: { cd: 12 } },
  },
  wake: { lengthM: [100, 300], kelvinHalfAngleDeg: 19.47, visibleHalfAngleDeg: [10, 15] },
};

// ---------------------------------------------------------------- LIFE [15]
export const LIFE = {
  birds: {
    herringGull:  { wingspan: 1.40, length: 0.60, note: 'pale grey mantle, black wingtips, rests on TP railings' },
    laughingGull: { wingspan: 1.04, length: 0.42, note: 'dark grey mantle, black summer hood; commonest summer bird' },
    commonTern:   { wingspan: 0.85, length: 0.33, hoverHeight: [1, 6], note: 'pale grey, black cap, red bill + legs; hover-dives from 1-6 m' },
    gannet:       { wingspan: 1.75, length: 0.95, plungeStart: [11, 60], note: 'white, black wingtips; plunge-dives from 11-60 m (most 10-30 m); spring/fall' },
    flightHeights: { gannetCommute: 12, gannetForage: 27 },
  },
  fish: {
    stripedBass:   { length: 0.70, note: 'silvery, dark lengthwise stripes' },
    bluefish:      { length: 0.60, note: 'blue-green back, white belly' },
    falseAlbacore: { length: 0.80, note: 'metallic blue-green, wavy dorsal stripes, dark spots under pectoral' },
    bluefinTuna:   { length: 2.20, note: 'dark blue above, grey below, yellow finlets' },
    menhaden:      { length: 0.25, note: 'silvery, black shoulder spot (adult up to 0.38 m)' },
    sandEel:       { length: 0.12 },
    anchovy:       { length: 0.065 },
  },
  blitz: {
    patchDiameter: [10, 40], travelSpeed: [0.5, 3], durationS: [60, 300],
    splashHeight: { bassBlues: [0.5, 1.5], tuna: [2, 4] },
    whiteWaterDecayS: [2, 6], baitJumpHeight: [0.2, 1.0],
    preferNearFoundationsM: 250,
    meanGapS: 45,                   // ESTIMATED mean seconds between blitz starts within ~2 km of the camera target
  },
};

// ---------------------------------------------------------------- LAND [16]
export const LAND = {
  skyline: [
    { name: 'Ocean Casino Resort', height: 216, x: -14236, z: -9385 },
    { name: 'Borgata', height: 131, x: -16097, z: -11131 },
    { name: "Harrah's Waterfront Tower", height: 160, near: 'Borgata', spreadM: 1000 },
    { name: 'Hard Rock North', height: 140, near: 'Borgata', spreadM: 1000 },
    { name: 'MGM Tower', height: 140, near: 'Borgata', spreadM: 1000 },
  ],
  boardwalkTowers: { count: 12, height: [77, 120], lineFrom: 'Ocean Casino', lineLengthM: 3000, towardBearingDeg: 225 },
  onshoreWind: { count: 5, tipHeight: 120, distanceM: 19000, bearingDeg: 305 },
  coast: { heightRange: [5, 25], bearingRange: [280, 15], distanceRange: [17000, 35000] },
};

// ---------------------------------------------------------------- SCALE TABLE [17]
// name -> { metres, tolerance }. registerScale() entries are checked against these.
export const SCALE_TABLE = {
  'turbine.hubHeight': { metres: 152.0, tolerance: 0.5 },
  'turbine.rotorDiameter': { metres: 236.0, tolerance: 1.0 },
  'turbine.bladeLength': { metres: 115.5, tolerance: 0.5 },
  'turbine.bladeMaxChord': { metres: 5.69, tolerance: 0.3 },
  'turbine.towerBaseD': { metres: 10.0, tolerance: 0.1 },
  'turbine.towerTopD': { metres: 7.5, tolerance: 0.1 },
  'turbine.towerTopY': { metres: 146.4, tolerance: 0.3 },
  'turbine.tpD': { metres: 10.5, tolerance: 0.1 },
  'turbine.tpTopY': { metres: 21.5, tolerance: 0.2 },
  'turbine.deckY': { metres: 18.5, tolerance: 0.2 },
  'turbine.railTopY': { metres: 19.6, tolerance: 0.2 },
  'turbine.nacelleLength': { metres: 19.0, tolerance: 0.5 },
  'turbine.nacelleWidth': { metres: 9.0, tolerance: 0.5 },
  'turbine.nacelleHeight': { metres: 11.0, tolerance: 0.5 },
  'turbine.overallNacelleLength': { metres: 28.0, tolerance: 0.5 },
  'turbine.spinnerD': { metres: 7.5, tolerance: 0.3 },
  'boatLanding.tubeD': { metres: 0.406, tolerance: 0.02 },
  'boatLanding.spacing': { metres: 1.80, tolerance: 0.02 },
  'substation.topsideLength': { metres: 90, tolerance: 1 },
  'substation.topsideWidth': { metres: 50, tolerance: 1 },
  'substation.topsideHeight': { metres: 40, tolerance: 1 },
  'ctv.length': { metres: 27.0, tolerance: 0.3 },
  'ctv.beam': { metres: 8.9, tolerance: 0.3 },
  'sov.length': { metres: 80.0, tolerance: 0.5 },
  'sov.beam': { metres: 19.0, tolerance: 0.5 },
  'bird.herringGull.wingspan': { metres: 1.40, tolerance: 0.15 },
  'bird.laughingGull.wingspan': { metres: 1.04, tolerance: 0.1 },
  'bird.commonTern.wingspan': { metres: 0.85, tolerance: 0.1 },
  'bird.gannet.wingspan': { metres: 1.75, tolerance: 0.1 },
  'fish.stripedBass.length': { metres: 0.7, tolerance: 0.2 },
  'fish.bluefish.length': { metres: 0.6, tolerance: 0.3 },
  'fish.falseAlbacore.length': { metres: 0.8, tolerance: 0.15 },
  'fish.bluefinTuna.length': { metres: 2.2, tolerance: 0.3 },
  'fish.menhaden.length': { metres: 0.25, tolerance: 0.08 },
  'clouds.puffDiameter': { metres: 1000, tolerance: 500 },   // median projected patch; cumulus humilis / Sc cells 0.3-2 km (lead ruling 2026-09-30)
  'bird.commonTern.hover.min': { metres: 1, tolerance: 0.2 },
  'bird.commonTern.hover.max': { metres: 6, tolerance: 0.5 },
  'bird.gannet.plungeStart.min': { metres: 11, tolerance: 0.5 },
  'bird.gannet.plungeStart.max': { metres: 60, tolerance: 1 },
  'lattice.a': { metres: 1111.56, tolerance: 0.5 },
  'lattice.b': { metres: 1865.88, tolerance: 0.5 },
};

// ---------------------------------------------------------------- QUALITY TIERS
// Tiers: low (phones), med (tablets / integrated GPUs; kirt.lol loader hint), high (desktop, Apple silicon), ultra.
// pixelBudget = max drawing-buffer pixels (the pixel ratio is lowered to fit; adaptive resolution may lower it more).
export const QUALITY = {
  low:   { name: 'low',   pixelRatio: 1.5, msaa: 0, smaa: true,  shadowMapSize: 2048, reflection: false, reflectionScale: 0,   oceanRings: 96,  oceanSegments: 128, bloom: false, pmremSize: 64,  lod0Distance: 900,  lod1Distance: 4000, particles: 0.5, birds: 0.5 },
  med:   { name: 'med',   pixelRatio: 1.0, msaa: 0, smaa: false, fxaa: true, shadowMapSize: 2048, reflection: true, reflectionScale: 0.35, oceanRings: 128, oceanSegments: 192, bloom: true, pmremSize: 64, lod0Distance: 1200, lod1Distance: 3000, particles: 0.75, birds: 0.75 },
  high:  { name: 'high',  pixelRatio: 1.25, msaa: 2, smaa: false, shadowMapSize: 4096, reflection: true,  reflectionScale: 0.5, oceanRings: 160, oceanSegments: 256, bloom: true,  pmremSize: 128, lod0Distance: 1500, lod1Distance: 4000, particles: 1.0, birds: 1.0 },
  ultra: { name: 'ultra', pixelRatio: 1.5, msaa: 4, smaa: false, shadowMapSize: 4096, reflection: true,  reflectionScale: 0.75, oceanRings: 224, oceanSegments: 384, bloom: true,  pmremSize: 256, lod0Distance: 2500, lod1Distance: 9000, particles: 1.5, birds: 1.5 },
};
export const PIXEL_BUDGET = { low: 0.45e6, med: 0.9e6, high: 1.6e6, ultra: 1.8e6 };   // ultra 1.8 Mpx (round 3: holds 40 fps on a retina M4)
