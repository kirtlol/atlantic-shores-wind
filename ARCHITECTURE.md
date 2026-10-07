# NJ Offshore Wind: scene architecture (build contract)

> **About this file (public copy).** This is the build contract the scene's modules were written against during
> development, kept because it is the best map of the code: units, axes, frame order, module contracts and the
> decisions that changed them. "Owner" names an area of the code (atmosphere, ocean, modeller, farm, vessels,
> wildlife, shell), and "lead" the person who set the numbers. A few files it mentions are not in this repository:
> the reference photo (`reference/ref-1.png`, Borkum Riffgrund 1), the site build's tools (`tools/bundle-size.mjs`,
> `tools/capture-piece.mjs`) and the staging folder for the kirt.lol version of the piece (`kirtlol/`).

A photoreal, fully procedural Three.js scene of New Jersey's planned Atlantic Shores South offshore wind farm
(Vestas V236-15.0 MW on the 200 real BOEM positions, ~17 km off Atlantic City), matched to `reference/ref-1.png`.
Plain ES modules with no build step for development (`index.html`, `dev/*.html`); the kirt.lol piece bundles the
same `src/` with esbuild (`tools/bundle-size.mjs` measures that exact build). No downloaded assets.

**Read `research/SCENE-SPEC.md` (numbers, both addenda) and `src/config.js` (the same numbers as code) before
writing anything.** `src/shared.js` and `src/config.js` are owned by the lead: import from them, never edit them. If a
number you need is missing, add it as a named `const` at the top of your own module with a comment citing SCENE-SPEC
or the source.

*Prose above the dated "Decisions after …" sections was rewritten on 2026-10-06 (round-3 verifier) to match the code
and updated for round 4 the same day (round-4 verifier, POLISH-4.md).
Each module file's header comment is the full, authoritative contract; this file summarises it. Where a dated
decision section below disagrees, the decision wins.*

## Hard rules

1. **Units are metres and seconds everywhere.** No module scales anything "to look right". Every modelled thing
   registers its real size with `registerScale()` (shared.js; dev builds only) so `window.__scene.scaleReport()` can
   check it. A reviewer fails any asset that is off by more than its tolerance. Reference sizes live in
   `config.js → SCALE_TABLE`.
2. **Axes:** +X east, +Y up, +Z south (−Z north). Compass azimuth A (clockwise from north) is the vector
   `(sin A, 0, −cos A)` → use `azimuthToDir` / `azElToDir`.
3. **Origin** = hero turbine (F01) foundation axis at mean sea level (MSL).
4. **Earth curvature is real geometry**: the mean sea surface at (x, z) is at `y = −curvatureDrop(x, z)`
   (= (x²+z²)/2R, R = 6371 km). The ocean vertex shader applies it; anything resting on or floating at the sea surface
   adds it to its base y. (At 10 km that is 7.8 m; distant turbines go hull-down as in real photos.)
5. **Colour pipeline:** every shader outputs **linear, scene-referred HDR radiance multiplied by the atmosphere's
   pre-exposure** (`atmosphere.preExposure`, GLSL `uAtmPre`; 1 by day, up to 4000 at night so night radiances survive
   half-float targets; `applyAerialPerspective()` applies it). Tone mapping and sRGB encoding happen once, in Post's
   grade pass. Custom `ShaderMaterial`s still end with `#include <tonemapping_fragment>` and
   `#include <colorspace_fragment>` (no-ops when rendering into Post's HDR target). Spec colours are sRGB; convert
   with `new THREE.Color().setStyle(hex)` or `.convertSRGBToLinear()`.
6. **Light units:** 1 scene illuminance unit = `LOOK.sceneUnitLux` (25,000 lx); a radiance of 1 ≈ 25,000 cd/m².
   Lamp core radiance = cd / (lens area × 25,000). The sun `DirectionalLight` carries `U.uSunIlluminance`; sky,
   environment and lamps use the same units, so IBL, sun and lamps agree.
7. **Every material you create goes through `applyAtmosphere(material)`** from `src/env/fog.js` (built-in
   materials) or includes `ATMOS_GLSL` (from `ctx.atmosphere.glsl`) and calls `applyAerialPerspective()` itself
   (custom ShaderMaterials). `scene.fog` is a `THREE.Fog` the atmosphere owns (so `USE_FOG` is defined); never set
   your own.
8. **Randomness:** `mulberry32(seed)` from shared.js for anything visual that should be reproducible
   (`?seed=N`). `Math.random` only for transient particle jitter.
9. **three@0.180.0 only**, imported as `import * as THREE from 'three'` and addons as `'three/addons/...'` (the
   importmap in index.html maps both to cdn.jsdelivr.net; the kirt.lol build pins the same version). No other
   network fetches: the published page's CSP is self-only (no images, fetch, XHR or `data:` loads). All textures are
   generated (canvas, DataTexture, or render-to-texture).
10. **Zero console errors and zero warnings**, including three.js deprecation warnings (see
    `research/three-r180-api.md`).
11. **Do not edit files owned by other modules.** If you need something the contract does not give you, write a stub
    in your own dev page and note the request in your report. Integrators list every cross-module edit they make.
12. **Depth:** the default is the logarithmic depth buffer (`RENDER.logarithmicDepthBuffer`, near 0.5 m, far
    150 km): every custom ShaderMaterial includes `logdepthbuf_pars_vertex`, `logdepthbuf_vertex`,
    `logdepthbuf_pars_fragment`, `logdepthbuf_fragment`. `?depth=reversed` is an A/B mode (reversed-Z, 32-bit float
    depth; see main.js) whose contract each module owns for its own passes. **Every opaque material writes depth**;
    the sky dome is the only exception (it draws last at the far plane).

## Files and owners

| File | Owner | What it is / exports |
|---|---|---|
| `index.html` | shell | standalone page: importmap, `.stage` + canvas, control panel markup, `<script type="module" src="./src/main.js">` |
| `src/shared.js` | lead | `U`, `EARTH_R`, `curvatureDrop`, `CURVATURE_GLSL`, `azimuthToDir`, `azElToDir`, `LAYER_REFLECT`, `mulberry32`, `PARAMS`, `param`, `registerScale`, `SCALE_REGISTRY` |
| `src/config.js` | lead | `SITE`, `DATUMS`, `RENDER`, `TURBINE` (+ `hubWind`, `rotorRpm`), `PAINT`, `MARKINGS`, `LAYOUT` (+ `layoutPositions`), `SUBSTATION`, `CAMERA_PRESETS`, `DEFAULT_VIEW`, `TIME_DEFAULT`, `SUN`, `ATMOS`, `CLOUDS`, `SEA`, `LOOK`, `SHADOW`, `NIGHT_LIGHTS`, `VESSELS`, `LIFE`, `LAND`, `SCALE_TABLE`, `QUALITY`, `PIXEL_BUDGET` |
| `src/env/time.js` | atmosphere | `SimClock`, `solarPosition()`, `lunarPosition()`, sidereal time, refraction |
| `src/env/atmosphere.js` | atmosphere | `Atmosphere`, `ATMOS_GLSL`, `ATMOS_GLSL_CORE`, `ATMOS_UNIFORMS`, `ATMOS_VERSION` |
| `src/env/clouds.js` | atmosphere | `CloudSystem` (volumetric Sc/Cu layer + cirrus), cloud GLSL, `COVER_TABLE`, `WEATHER_PHASE_M`, `HASH_GLSL`, `CITY_EMISSION_GLSL` |
| `src/env/sky-night.js` | atmosphere | star catalogue + procedural stars, baked Milky Way |
| `src/env/fog.js` | atmosphere | global ShaderChunk patches at import time; `applyAtmosphere(material)`, `hasAtmosphere()` |
| `src/env/land.js` | vessels | `Land` (Atlantic City skyline, coast, onshore turbines, night glow), `PhotometricLamps`, `HASH_GLSL` |
| `src/ocean/ocean.js` (+ `spectrum`, `ocean-fft`, `surface-cpu`, `ocean-mesh`, `ocean-material`, `ocean-reflection`, `ocean-effects`, `ocean-splash`, `ocean-wake`, `ocean-life`, `ocean-lights`, `ocean-textures`) | ocean | `Ocean` |
| `src/turbine/turbine.js` (+ `glyphs.js`) | modeller | `buildTurbine`, `buildRotor`, `createTurbineMaterials`, `setPhotoLook`, `photoLookGLSL`, `NACELLE_ROOF`, `OSS_HELIDECK`, `composeTurbineMatrices`, `TURBINE_IDS`, … |
| `src/turbine/substation.js` | modeller | `buildSubstation()` |
| `src/farm/farm.js` | farm | `Farm` (layout, instancing, LOD, far batch, rotor/yaw, night lights, substation placement) |
| `src/life/vessels.js` | vessels | `Vessels` (CTV, SOV, wakes, spray, nav lights) |
| `src/life/blitz.js` | wildlife | `Blitz` (topwater blowups) + shared life helpers (`lifeGlsl`, `InstanceBuffer`, `FISH_SPECIES`, …) |
| `src/life/birds.js` | wildlife | `Birds` |
| `src/post/post.js` | shell | `Post` (HDR MSAA scene target, meter, bloom, grade + tone map, FXAA tiers) |
| `src/ui/ui.js`, `ui.css` | shell | `UI`: the standalone control panel, caption and keyboard (compiled out of host bundles) |
| `src/ui/hud.js`, `hud.css`, `piece.html` | shell | `HudUI`: the slim host HUD (hint, Time-lapse / Next view / Blitz) and the kirt.lol page fragment |
| `src/ui/orbit.js` | shell | `Orbit`: the camera rig's orbit controls (replaces three's OrbitControls) |
| `src/ui/dev-hooks.js` | shell | `scaleReport`, `bench`, `benchPost` (dev builds only) |
| `src/main.js` | shell | boot, frame loop, camera rig, quality tiers, host contract, test hooks |
| `dev/<module>.html` | each owner | standalone test page for the module, with stubs (`dev/shell.html?stubs=…`, `dev/shell-hosted.html` = the host page) |
| `tools/shot.mjs`, `tools/bundle-size.mjs`, `tools/capture-piece.mjs` | lead / packager | screenshots + console capture; the kirt.lol bundle size; the frame-exact 1920×1080 capture |
| `kirtlol/**` | packager | everything staged for the kirt.lol repo (tooling patch, piece page, README-PIECE.md) |

## Runtime context

`main.js` builds one context object and passes it to every constructor:

```js
const ctx = {
  renderer, scene, camera,          // THREE objects (camera: PerspectiveCamera, rotation order 'YXZ')
  quality,                          // QUALITY[tier] from config.js (low | med | high | ultra)
  clock,                            // SimClock (env/time.js)
  atmosphere, land, ocean, farm, vessels, birds, blitz, post, ui,   // filled in as constructed (null if a module failed)
  seed, state, api, controls, world, ephemeris,                      // shell: URL seed, UI state, window.__scene, Orbit, host world
};
```

Construction order: `SimClock → Atmosphere → Land → Ocean → Farm → Vessels → Birds → Blitz → Post → UI` (UI is
`HudUI` on a host page, `UI` on the standalone page). Consumers take the atmosphere's GLSL and uniforms from
`ctx.atmosphere.glsl` / `.glslCore` / `.uniforms` instead of hard-importing, so dev pages can stub it. Every module is
loaded through a literal `import()` and constructed inside try/catch: a module that fails is logged, reported `dead`
by `world.moduleStatus()` and skipped; the page never blanks. Every class has `constructor(ctx)` and
`update(dt, t, camera)` (dt = the real frame time clamped to 0.1 s, 0 when frozen; t = `U.uTime.value`), adds its own objects to
`ctx.scene`, and may implement `setQuality(q)`, `setEnabled(on)` and `dispose()`.

### Frame order (main.js `stepFrame`)

```
if !frozen: U.uTime.value += dt
rig.update(realDt, dt, t)                  // camera presets, cinematic flight, orbit, clearance solvers
U.uCameraPos ← camera; U.uPolarizer ← CPL strength by camera height (drone 0.7; 0 below 20 m)
atmosphere.setShadowFocus(nearest turbine / substation to the camera or pivot)
clock.update(dt)
atmosphere → land → farm → vessels → birds → blitz → ocean   .update(dt, t, camera)
post.render(realDt, { snap })              // scene → HDR target → meter → bloom → grade → canvas
ui.update(realDt, t, camera)               // panel / HUD readouts (live loop only; capture steps skip it)
```
The atmosphere updates sun/moon directions, all sky/fog/cloud fields of `U`, the sky-view LUT (when the sun or
moon moved > 0.05° or the camera moved), the cloud products, the sun + moon DirectionalLights and the PMREM
environment (re-baked when the sun moved enough or on clock jumps, never every frame). The ocean updates last: it
renders the planar mirror of everything on `LAYER_REFLECT`.

## Module contracts

### env/time.js — `SimClock`
```js
new SimClock({ year, month, day, hours, speed, playing })   // local civil time at SITE (EDT/EST from the date)
clock.hours, clock.date, clock.playing, clock.speed          // speed = sim seconds per real second (1, 60, 600, 3600)
clock.update(dt), clock.setTime(h), clock.setDate(m, d), clock.play(on), clock.pause()
clock.julianDay(), clock.sun(), clock.moon(), clock.label()
solarPosition(lat, lon, jdUTC)  -> { azimuthDeg, elevationDeg }            // NOAA
lunarPosition(lat, lon, jdUTC)  -> { azimuthDeg, elevationDeg, phase, … }  // low-precision Meeus
```
`setTime` / `setDate` are discontinuous: the atmosphere rebuilds its tables synchronously and Post snaps exposure.

### env/atmosphere.js (+ clouds.js, sky-night.js) — `Atmosphere`
- Physically based sky: Rayleigh + Mie + ozone single scattering with Hillaire's multiple-scattering approximation,
  every coefficient from `config ATMOS` (2026-10-06 haze: σ(550) 3.0e-5 /m, 2.5 km scale height); transmittance,
  multi-scattering and sky-view LUTs; twilight, Earth's shadow, airglow, city light domes, Milky Way, catalogue stars,
  moon with phase and earthshine, sun disk with limb darkening.
- Clouds (`clouds.js`): one volumetric stratocumulus / cumulus-humilis layer at 1100–1400 m from a tileable weather
  map (cover calibrated by the baked `COVER_TABLE`; the reference weather placed by `WEATHER_PHASE_M`, round 4:
  [98000, 104000], which puts a cloud shadow on the near sea and keeps (250, 75) clear), plus a thin cirrus sheet at
  7 km. Ragged, eroded margins; bases lit by light diffused through the cloud (neutral grey, no blue core band); at blue
  hour the twilight arch lights only the clouds toward the sun. Products: a temporally resolved half-resolution view buffer, a panorama read by
  `skyRadiance()` / the environment / the ambient pass, and a light-space map read by `cloudShadow()`.
- Owns the sun and moon `DirectionalLight`s and their shadows (`setShadowFocus(v, halfExtent)` places the frustum;
  the shell calls it), `scene.environment` (PMREM of sky + clouds), `scene.fog` and the sky dome.
- `ATMOS_GLSL` (string; `ATMOS_GLSL_CORE` = the aerial-perspective part only) declares the `uAtm*` uniforms and
  defines `skyRadiance(dir)` (no sun disk), `sunDiskRadiance(dir)`, `cloudShadow(worldPos)`,
  `applyAerialPerspective(color, worldPos)` and `applyAerialTransmittance(color, worldPos)` (both return
  pre-exposed colour), plus helpers (`atmHazeColour`, `atmAltitude`, `atmExpose`, `atmPolarizer`, …).
  Consumers add `atmosphere.uniforms` (references into `U` and the atmosphere's own uniforms) to their material.
- Public fields: `sunLight`, `moonLight`, `skyMesh`, `clouds`, `glsl`, `glslCore`, `uniforms`, `sunElevationDeg`,
  `sunAzimuthDeg`, `moonElevationDeg`, `preExposure`, `exposureTargetPhotoFit` (the exposure that puts the clear sky
  at 10–12.6° in the view azimuth on the photo's exposed values: Post's anchor), `dayExposure`, `horizonRadiance`,
  `zenithRadiance`; dev builds only (not computed in the hosted bundle): `exposureTarget` (the original horizon rule),
  `horizonToSunRatio`, `zenithSkyMag`, `U.uExposureHint`;
  **`skyIrradiance`** (THREE.Color: absolute sky irradiance on a horizontal surface including the clouds' light,
  the E_sky the ocean lights the sea with; blitz lights its foam and spray with it), `weatherPhase` (Vector2, where
  the weather field sits at t = 0; not a runtime control), `cloudCover`.
- Methods: `setClouds({ cover, altitude, thickness })`, `setShadowFocus()`, `setQuality(q)`, `update()`,
  `forceEnvironmentUpdate()`, `restoreGPU()`, `dispose()`.
- Reversed-Z: the dome branches on `USE_REVERSED_DEPTH_BUFFER` (z = 1e-7 w) and the sun/moon shadow bias is positive.

### env/fog.js — `applyAtmosphere(material, { extinctionOnly })`
Importing fog.js patches `THREE.ShaderChunk` **before anything compiles** (main.js loads it first): the fog chunks
carry the world position (`cameraPosition + transpose(mat3(viewMatrix)) * mvPosition.xyz`, valid for Mesh /
Instanced / Batched / Skinned / Sprite / Points), and `envmap_physical_pars_fragment` takes three taps on a 28.6° ring
for diffuse sky light (cosine-lobe fit; the modeller's `IBL_RING`, global since round 3). `applyAtmosphere()` adds the
uniforms with a stable `customProgramCacheKey`, replaces the fog mix with `applyAerialPerspective()` (or
`applyAerialTransmittance()` for additive glows) and multiplies direct light by `cloudShadow()`. Idempotent;
composes with an existing `onBeforeCompile`. Unpatched `fog:true` materials get a self-contained height-fog fallback.

### ocean/ocean.js — `Ocean`
The full contract is the header of `ocean.js`. In short:
```js
ocean.getHeight(x, z, t), ocean.getSurface(x, z, t, out) -> { y, normal, velocity }   // CPU mirror of the FFT surface
ocean.addDisturbance({ x, z, radius, strength, duration, foam, kind, t0 }) -> id      // 'splash' | 'boil' | 'nervous' (unknown → 'splash')
ocean.addFoamTrail(points, { key, width, lifetime, spread, foam, aeration, aerationLife, slick, … }), ocean.clearTrail(key)
ocean.setWaveSources([{ x, z, headingDeg, speed, length, beam, amplitude, halfAngleDeg }])   // Kelvin wakes, every frame
ocean.wakeHeight(x, z), ocean.waveSources.{ list, height(x, z) }                        // the Kelvin field's elevation
ocean.setLifePatches([...])                                                              // bait / nervous water (blitz)
ocean.setSeaState({ windSpeed, windFromDeg, swellHs, swellFromDeg, swellPeriod }, { immediate })
ocean.setDistantLights(key, { count, position, colour, intensity[, beam][, extent] }) | (list[, key])
ocean.distantLightCapacity (128), ocean.distantLightMinDistance (2500 m)                 // beyond it: analytic glitter columns
ocean.setPiles([{ x, z, radius }])                                                       // wash ring + contact rim breathing with Hs
ocean.displacementUniforms() -> { uDisp0, uDisp1, uOcCas, uOcOff, uSnap, uRing, uGrid }  // live uniforms for decals riding the waves
ocean.mesh, ocean.reflectionTarget, ocean.uniforms, ocean.update(dt, t, camera), setQuality(q), dispose()
```
- Surface: JONSWAP wind sea + swell in GPU FFT cascades (world space), a CPU mirror that agrees with the rendered
  swell and wind sea within ~0.1 m, a polar camera-following grid out past the horizon for the camera height.
- Shading: polarized Fresnel reflection of the sky (+ planar mirror of `LAYER_REFLECT` objects, weighted with the
  unpolarised Fresnel; a distance attachment rejects mirror content nearer than the water point, and at steep angles
  the column breaks into glints), slope-integrated roughness with hydrodynamic modulation on the 2–15 m facets (the
  cascade tile blended with a shifted copy, so no lattice), GGX sun + moon glint, FU-4 water body, foam (whitecaps
  above 5 m/s with streaks from the foam residue, pre-rolled 10 s on frozen frames; pile wash and contact rim;
  disturbances; vessel trails), cloud and structure shadows (structure shadows halve the upwelling, not zero it),
  aerial perspective, distant lamp columns as stippled Beckmann glints. The camera polarizer is
  `U.uPolarizer` (the ocean's `uPolarizer` and the atmosphere's `uAtmPolarizer` are that object).

### turbine/turbine.js — `buildTurbine({ lod, pitchDeg })`, `buildSubstation()`
Returns part lists in local frames (no scene graph, no instancing; the farm instances them):
```js
{
  static:  [{ name, geometry, material, castShadow, receiveShadow }],  // monopile/marine growth, TP, platform, railings,
                                                                        // boat landing, ladders, davit, tower (origin: foundation axis at MSL)
  nacelle: [...],   // yaw frame: origin at the yaw bearing on the tower axis; rotor side is +Z
  rotor:   [...],   // rotor frame: origin at hub centre; spin axis +Z (upwind); blade 0 at +Y; cone included
  frames: { yawBearingY, hubOffset, tiltDeg, coneDeg },
  lights: { aviation: [...], marine: [...], ... },
  dims:   { hubHeight, rotorDiameter, bladeLength, tpTopY, towerBaseD, towerTopD, ... },   // measured from the geometry
}
```
- Two LODs: 0 (hero, full detail: lofted blades with chord/twist/prebend, nacelle with cooler and heli deck, door,
  flanges, open grating platform, railings, boat landing, davit, ID glyphs, lanterns) and 1 (simplified). Far
  turbines are the farm's own geometry. Silhouette and size agree across LODs.
- `createTurbineMaterials()`: shared materials through `applyAtmosphere`, with procedural weathering and the
  per-surface finishes in shader code (`injectTurbineShader`); all parts of a turbine share one transparent-sort
  sphere so the thin parts, ID glyphs and grating draw in the same order under either depth convention.
- Markings: US/FAA by default; `setPhotoLook(bool)` drives the shared `uPhotoLook` (blades/nacelle carry `aBand`;
  `photoLookGLSL` lets the farm's far turbines follow).
- `buildSubstation()`: `THREE.Group` at the MSL origin (jacket + topside per spec), registers its dimensions.

### farm/farm.js — `Farm`
- The 200 positions of `layoutPositions()` (hero F01 at the origin), the substation per `SUBSTATION`.
- LOD 0/1 as instanced meshes per part; every farther turbine and **every mirror image** is the farm's
  ~300-triangle far turbine in one batched draw (view) plus one mirror draw within `farm.mirrorRange`
  (20 km, FOV-corrected; `Infinity` draws all). Rotor detail switches by screen size (`ROTOR_DETAIL_PX` 16 px).
- Rotors spin at `rotorRpm(u)` with per-turbine phase, yaw into the wind with drifting offsets, a few idle and
  feathered; `setWind(u10, fromDeg)` changes speed, pitch and yaw target.
- Night lights (`NIGHT_LIGHTS`): synchronised L-864 + L-810 flashes, USCG marine lanterns per light class (beam from
  `NIGHT_LIGHTS.marine.beamFWHMDeg`), substation lights; photometric sprites faded by the atmosphere, in the mirror,
  and sent to `ocean.setDistantLights('farm', …)` beyond the mirror's reach. `setADLS(on)` darkens the aviation lights.
- `farm.turbines`, `farm.hero`, `farm.pilePositions()` (→ `ocean.setPiles`), `farm.substation`, `farm.keepOuts()` /
  `resolveKeepOuts()` (the shell's camera clearance), `farm.setPhotoLook()`, `setQuality()`, `dispose()`.

### life/vessels.js — `Vessels`, env/land.js — `Land`
- CTV (StratCat 27-class catamaran) on a time-pure route that shuttles between turbines and holds on the hero's
  boat landing; SOV on DP 13.4 km SE. Seakeeping from `ocean.getSurface` at several hull points.
- Black bow fender (3.0 m) and full-length D-fenders; a wet band with run-off above the waterline.
- Wakes are the ocean's to draw from physically sized inputs: tumbling white clumps that merge and fade 35–50 m
  astern, lace, churn and hull-side white water, chine spray and a low rooster tail, as `addFoamTrail` trails with
  aeration and slick, Kelvin arms on the ocean's own wave field (`setWaveSources` every
  frame, `waveSources.list/height` read back), and on the landing only the subtle low-thrust `_holdWash()` (the user's
  rule: never a visible wedge) plus a faint collar at each forefoot. A flat decal continues the wake beyond the ocean's ±256 m foam map.
- Nav lights per COLREGS, windows with parallax interiors, the SOV's light column via `setDistantLights('vessels')`.
- `vessels.setEnabled(on)` (withdraws its trails and light set), `keepOuts()` / `clampCamera()`, `kelvinSources()`.
- `Land`: the Atlantic City skyline, coast, boardwalk towers and onshore turbines on the horizon toward 290–310°T;
  windows, signs and aviation lights at night through `PhotometricLamps`, light columns via `setDistantLights('land')`.

### life/blitz.js — `Blitz`, life/birds.js — `Birds`
- Blitz: predator schools drive bait to the surface near structure, balled in a wandering working core (3–9 m) that
  takes 80 % of the strikes, in flurries; strikes make spray crowns (torn sheets and drops, glints), short-lived white
  water graded to aerated green and lace, boils, ring trains (`ocean.addDisturbance`), backs, tails, swirls, breaches
  and silver bait sprays; two life patches per blitz (pod, core) and a continuous slick.
  Foam decals ride the waves through `ocean.displacementUniforms()` (shared by reference); lit by
  `atmosphere.skyIrradiance`. API: `trigger(x, z, opts)`, `active` (each `BlitzState` has `cx`, `cz`, `core`),
  `focus()` (the core's centre), `splashAt(x, z, size, opts)`, `setEnabled()`, `setQuality()`.
- Birds: instanced gulls, terns and gannets with vertex-animated wings at true wingspan; loafing on TP railings,
  a tight working flock 2–10 m over a blitz core with gulls sitting on the water at its edge (`seedFlock`), tern hover-dives (1–6 m) and gannet plunges (11–60 m) with their own splashes
  (`blitz.splashAt`); none flying at night.

### post/post.js — `Post`
No EffectComposer, OutputPass, UnrealBloom or SMAA: every stage is one small object with a `render()`.
- **scene**: one HalfFloat HDR target with `quality.msaa` samples (FloatType depth texture under reversed-Z).
- **meter**: centre-weighted log-average + highlight levels every 4th frame (every frame in capture mode), read back
  asynchronously; each reading keeps the anchor sky luminance of its own frame.
- **bloom**: half-resolution prefilter + 4-level down/up chain with a threshold in exposed units; skipped by day
  while nothing reaches it. The sun disk keeps ~2/3 of its light in the glow (`GLARE`: dawn/dusk glare); night lamp
  cores are compressed at `BLOOM.compressNight` 500 (beacons read as points, not discs).
- **grade**: one full-screen pass: bloom add, 1 px unsharp mask (MSAA tiers), night Purkinje shift, daytime contrast,
  highlight saturation, the tone curve (`TONE`, by day: a hue-keeping luminance knee above 2.0 exposed, then for cool
  colours below 0.08–0.45 exposed a hue-preserving toe on luminance through the ACES grey curve; ACES Filmic, the r180
  fit, for warm darks, upper midtones and highlights; at night ACES with the hue-keeping `SHOULDER`), sRGB, daytime
  black toe on display-linear luminance (`LOOK.blackToe` with the sun below 10°, `GRADE.toe` = 1.5 × that above 25°),
  ±0.5/255 dither, straight to the canvas. **fxaa** (tiers without MSAA): grade to a HalfFloat target, then FXAA,
  toe and dither.
- **Exposure = sky anchor**: `exposure = X(L_s) / L_s` for the clear sky at 10–12.6° in the view azimuth
  (`atmosphere.exposureTargetPhotoFit`) through an adaptation curve, plus a daytime framing response (±0.5 EV) and
  highlight protection (night peak hold). `toneMappingExposure = exposure / preExposure`.
- API: `post.exposure`, `post.diagnostics`, `post.look` (`contrast`, `contrastHi`, `bloom`, `toe` (the high-sun toe),
  `sharpen`, `shoulder`, `glare`: A/B hooks), `snapExposure()`, `setCapture(on)`, `sceneTarget`, `meterPass`, `compileAsync()`,
  `setSize()`, `setQuality()`, `dispose()`.

### ui — `UI` (ui.js), `HudUI` (hud.js), `Orbit` (orbit.js)
- `UI` (standalone page only; `?ui=0` hides it): collapsible panel with time of day, play/pause and speed (1×, 60×,
  600×, 3600×), date, wind (with the Beaufort force), cloud cover, the six views, toggles (blitzes, birds, vessels,
  photo markings, ADLS, polarizer), quality, caption. Keys: Space play/pause, 1–6 views, B blitz near the camera
  target. Every change goes through `ctx.api`.
- `HudUI` (host pages): the scene tag (`clock.label()` — keep its "YYYY-MM-DD HH:MM TZ" format — and "planned, not
  built") and the hint + Time-lapse / Next view /
  Blitz buttons; the standalone panel and loading overlay are compiled out when `globalThis.NJOW_DEV === false`.
- `Orbit`: a compact stand-in for three's OrbitControls (orbit, dolly, pan along the sea, damping, limits; mouse, touch
  and keyboard). The rig keeps the camera at least 1 m above the local wave height and clear of steel and vessels.

### main.js — boot, loop, host contract, hooks
Renderer: WebGL2, `antialias:false` (Post antialiases), log depth by default, tier from `?q=`/`?quality=`, the host's
`window.__SW_HINT.tier`, or the device; pixel ratio capped by `RENDER.maxPixelRatio`, the tier and its
`PIXEL_BUDGET` (all from config; Ultra 1.8 Mpx); adaptive resolution only with no explicit
tier, size, freeze or capture. Programs are pre-compiled (`compileAsync` + one shadow draw) at boot and on tier changes.

Host contract (kirt.lol; also used by the local harnesses):
```js
window.__app = { world, render(), advance(dt), stop(), stats() }   // synchronous once main.js has evaluated
world = { renderer, quality: { name }, params: { q, size, t, freeze, capture, dev, hosted, depth }, frame, t, px, moduleStatus(), api, ctx }
window.__ready, window.__bootError                                  // drawn (or failed) once
```
`?capture=1` + `await __app.advance(1/60)` steps frame-exact, deterministic frames (each waits for its own meter
reading). Dev builds also set `window.__sceneReady`, `window.__sceneStats` and:
```js
window.__scene = { ctx, setTime(h), setDate(m, d), play(on), setSpeed(x), setView(name), setQuality(tier) /* Promise */,
  setWind(ms), setClouds(cover), triggerBlitz(x?, z?), freeze(on), setToggle(name, on), getView(), nextView(),
  setCamera(x, y, z, headingDeg, pitchDeg, fovDeg), stateUrl, scaleReport(), bench(frames), benchPost(frames) }
```
URL params: `time=13.5`, `date=09-21`, `view=drone|deck|nacelle|blitz|overview|cinematic`,
`q=` / `quality=low|med|high|ultra`, `freeze=1`, `t=<s>` (animation time), `seed=N`, `wind=8`, `clouds=0.35`,
`blitz=1` (one blitz at start), `ui=0`, `speed=60`, `play=1`, `size=N|WxH` (exact drawing buffer, e.g. 1920x1080),
`capture=1`, `depth=reversed` (dev builds only; the hosted bundle ignores it), toggles `blitzes=0`, `birds=0`, `vessels=0`, `photo=1`, `adls=1`, `cpl=0`, and `dev=1`
(dev hooks on a host page). The hosted piece defaults to 20:00 playing at 60× (paused under reduced motion).

## Verifying your module

`node tools/shot.mjs --page index.html --query "view=drone&freeze=1&t=0&ui=0" --w 1600 --h 900 --out shots/x.png
[--dpr 2] [--eval "<js>"] [--fps]` serves the project over localhost, opens system Chrome headless on the M4 GPU,
waits for `window.__sceneReady`, prints console errors/warnings + fps, and saves a screenshot (read the PNG with the
Read tool). Dev pages work the same way (`--page dev/<module>.html`). `node tools/bundle-size.mjs` builds the
kirt.lol bundle exactly as the site does and reports its brotli size against the budget. Zero console errors and
zero warnings are required. Shots go in `shots/` (scratch).

Budgets (High, DPR 1, drone view, M4, uncontended; see "Decisions after polish round 1"): whole frame ≤ 14 ms;
atmosphere + clouds ≤ 2.0 ms (overview ≤ 2.5), ocean incl. mirror ≤ 4.5, farm ≤ 2.5, life ≤ 1.5 (close blitz ≤ 2.5),
vessels + land ≤ 0.7, post ≤ 2.0. Ultra ≥ 40 fps, Low ≥ 60 fps on phones. Bundle ≤ 290 KiB brotli (round-2 decision).

## Decisions after research (these override anything above that disagrees)

Read `research/SCENE-SPEC.md` in full; `src/config.js` carries its numbers. Key decisions:

- **What is modelled:** Atlantic Shores South (planned, not built), **Vestas V236-15.0 MW**,
  hub 152 m, rotor 236 m, the real 200 BOEM positions (`layoutPositions()` in config.js,
  hero = F01 at the origin). The reference photo is Borkum Riffgrund 1 (Germany); we match its
  *look* (camera, light, haze, sea, clouds), not its turbine model.
- **Markings:** US/FAA by default (solid RAL 7035 blades, no nacelle stripe). A **photo look**
  toggle adds the photo's 3 red/grey/red tip bands (11.8 m each) + 2 m nacelle stripe.
  Contract: blade + nacelle geometry carry a float attribute `aBand` (0 = base paint, 1 = RAL
  3020 band) and their materials read a shared uniform `uPhotoLook` (0/1) owned by
  turbine.js (`setPhotoLook(bool)` export). No rebuild when toggled.
- **Depth:** `logarithmicDepthBuffer: true`, near 0.5 m, far 150 km. **Every custom
  ShaderMaterial includes `logdepthbuf_pars_vertex`, `logdepthbuf_vertex`,
  `logdepthbuf_pars_fragment`, `logdepthbuf_fragment`** (r180 define is
  `USE_LOGARITHMIC_DEPTH_BUFFER`). Sky dome: `depthWrite:false`, `renderOrder = -1`.
- **Fog/aerial perspective:** `src/env/fog.js` installs a global `THREE.ShaderChunk` patch
  **at import time, before any compile** (patches after first compile never reach cached
  programs). World position in the fog chunk: `cameraPosition + transpose(mat3(viewMatrix)) *
  mvPosition.xyz` (verified for Mesh/Instanced/Batched/Sprite/Points). `scene.fog` must be set
  (a `THREE.Fog`, so `USE_FOG` is defined) and `applyAtmosphere(mat)` feeds the U uniforms via
  `onBeforeCompile` with a stable `customProgramCacheKey`. main.js imports fog.js before
  creating any material.
- **Tone mapping: ACESFilmic**, applied once in OutputPass. **Auto-exposure (REVISED after integration): Post meters the frame** (centre-weighted log-average + highlight protection + Krawczyk key), calibrated so the drone reference view lands on the photo's 10°/12.6° sky (≈3.2). The original horizon rule below is kept only as `atmosphere.exposureTarget` for diagnostics:
  *(original rule)*
  `exposure = 1.43 / Y(L_horizon)`, where `L_horizon` is the sky radiance 0–1.5° above the
  horizon in the camera's view azimuth. Atmosphere computes it on the CPU (its JS
  transmittance/scattering model or a cached table) and publishes `atmosphere.exposureTarget`;
  Post smooths it (≈1.5 s time constant) and clamps night gain (`LOOK.nightExposureMaxGain`)
  so night stays dark but readable. Sanity: `Y(L_horizon)/E_sun` in 0.08–0.16 at the default sun.
- **Light units:** 1 scene illuminance unit ≈ 25,000 lx. Lamp core radiance =
  cd / (lens area × 25,000). The atmosphere picks absolute sun units; everything else follows.
- **Timer:** `THREE.Timer` (core in r180; `timer.connect(document)`). `Clock` is fine too.
  No `examples/jsm/misc/Timer.js` (404 in r180).
- **Composer:** `new EffectComposer(renderer, new WebGLRenderTarget(w, h, {type: HalfFloatType,
  samples}))`, then `composer.setPixelRatio(dpr); composer.setSize(cssW, cssH)`.
  `SMAAPass()` takes no args. Pre-warm with `await renderer.compileAsync(scene, camera)`.
- **PMREM:** one `PMREMGenerator`, one `CubeCamera` + `WebGLCubeRenderTarget`, reuse the target
  with `pmrem.fromCubemap(cubeRT.texture, envRT)`; never per frame (15–90 ms each).
- **Shadows:** one sun `DirectionalLight` shadow fitted around the hero / camera focus
  (`SHADOW` in config: ±190 m, 4096², bias −0.0001, normalBias 0.1), `PCFShadowMap` with radius
  3–5 (sun penumbra), `scene.add(sun.target)`. Vertex-animated meshes (birds) need a matching
  `customDepthMaterial` or `castShadow = false`.
- **Instancing:** no shear in instance matrices; call `setColorAt` before first render;
  `frustumCulled = false` or recompute bounding spheres when instances move.
- **Land:** Atlantic City skyline (§16) is visible from views facing 290–310°T — faint
  blue-grey silhouettes on the horizon by day, window/casino glow + aviation lights at night.
  Owned by the vessels agent as `src/env/land.js` → `class Land`.
- **Vessels are out of the reference frame by default** (CTV shuttles near the hero landing on
  the NNE side, SOV on station 13.4 km SE). No birds or blitz in the drone reference frame at
  t=0 unless `?blitz=1`.

## Decisions after polish round 1 (2026-09-30; override anything above)

- **Exposure = sky anchor.** Post exposes on the clear sky at 10–12.6° in the view direction
  (`atmosphere.exposureTargetPhotoFit`, absolute units, current every frame) through an adaptation
  curve (0.60 exposed by day, −1.2 EV at sunset, L^0.33 at night), plus a small daytime framing
  term (±0.5 EV) and two-level highlight protection. The frame meter is advisory only.
- **Sky dome draws last** at the far plane (renderOrder 1e5, depthFunc LessEqual, no log-depth).
  Therefore **every opaque material must write depth**; nothing opaque may use depthWrite:false
  except the dome.
- **Haze** revised (config ATMOS): σ(550) 6.6e-5 /m, visibility ≈ 59 km, SSA 0.985, 100 km top.
- **Default time** 17:15 EDT (photo brightness-profile fit). The kirt.lol page defaults to 20:00
  playing at 60×.
- **Tiers:** low / med / high / ultra, all in config `QUALITY`, with `PIXEL_BUDGET` per tier.
  main.js consumes them from config (no locally derived tiers).
- **Host contract (kirt.lol):** `window.__app = { world, render, advance, stop, stats }`,
  `window.__ready`, `window.__bootError`, `world.moduleStatus()`; `?capture=1` + `__app.advance(dt)`
  gives frame-exact, deterministic frames. Dev hooks live in `src/ui/dev-hooks.js` behind
  `globalThis.NJOW_DEV` (defined false in the kirt.lol bundle).
- **Budgets (High, DPR 1, drone view, M4, uncontended):** whole frame ≤ 14 ms. Per module:
  atmosphere + clouds ≤ 2.0 ms (overview ≤ 2.5), ocean incl. mirror ≤ 4.5, farm ≤ 2.5, life ≤ 1.5
  (close blitz ≤ 2.5), vessels + land ≤ 0.7, post ≤ 2.0. **Bundle:** the kirt.lol app bundle
  (minified ESM incl. three, glsl-stripped) ≤ 280 KiB brotli, so the piece's first view stays under
  the site's 420 KiB with margin. Measured with
  esbuild 0.25.12 (minify, three 0.180.0), as the site build does.

## Lead edits outside the rounds

- 2026-09-30 22:10 (user review): `src/life/vessels.js` — the CTV's holding wash on a landing was
  a 24 m widening turquoise wedge that read as full throttle. Replaced by `_holdWash()` + `HOLD`
  constants: ~20–30 % thrust breathing with the 8.3 s fender surge; one short (9 m) wandering
  bubble stream per jet, small eddies shed off both quarters, an occasional soft vortex boil. Going
  astern keeps a short forward wash. Owners: keep it subtle — the user's rule is "not that visible
  triangle".
- 2026-09-30 22:20 (user decision): **the kirt.lol piece is WIDE, not square** like Sinking Light.
  The piece page gets a wide stage (16:9-class, filling the viewport width; HUD overlaid or below,
  phone portrait still readable), the capture is 16:9 (1920×1080 for clip/og; the stage still wide),
  and only the library card preview stays square (cropped from the wide capture, as every card in
  the gallery is square). Tooling: `piece.json` gets an aspect/stage mode so build, gate layout
  checks, make-media (clip keeps the capture aspect) and make-stage-still handle a wide piece.
  The first-view budget then needs the bundle ≤ 280 KiB (a wide still is ~1.5× the square one).

## Decisions after polish round 2 (2026-10-06; override anything above)

- **Haze:** surface σ(550) **3.0e-5 /m**, aerosol scale height **2.5 km** (fog falloff 1/2500), AOD ≈ 0.041,
  visibility ≈ 130 km. Target: the photo's crisp, still-yellow TPs and turbines out to ~15 km (T ≈ 0.83 at 6.3 km,
  0.74 at 10 km) with a bright horizon band from long grazing paths. Re-check the sky at 10°/12.6° and the band.
- **Default time back to 16:30 EDT** (the 17:15 fit made the camera-facing TP ~1 EV hot).
- **Bundle budget 290 KiB brotli** (accepting round 2's 287.6; the gate's real limit is the 420 KiB first view,
  ≈ 410 KiB with a wide dusk still). No growth beyond it.
- **Night horizon with Atlantic City skyglow:** 1.65× zenith accepted (2.18 natural sky). **Transverse Sc bands**
  accepted, but the reference view needs the photo's *amount*: a few broken puffs + faint streaks, not long uniform
  bands, and clear sky where the near-right sea reflects it.
- **kirt.lol piece is WIDE** (16:9-class stage, 1920×1080 capture/clip/og, wide dusk stage still; only the library card
  is square). `piece.json` gets a stage/aspect mode.
- **Bird height rows** are in SCALE_TABLE now (tern hover 1–6 m, gannet plunge start 11–60 m).
- **ARCHITECTURE prose above is partly stale** (Post: no EffectComposer/OutputPass/UnrealBloom/SMAA any more —
  one HDR MSAA target, merged grade + display, half-resolution bloom chain, FXAA tiers, `post.look`; reversed-Z
  contract owned by the modules; `NJOW_DEV=false` drops the standalone panel; `atmosphere.skyIrradiance`,
  `ocean.setDistantLights`, `ui/orbit.js`). The round-3 verifier rewrites those sections to match the code.

## Decisions after polish round 3 + jury (2026-10-06; the final round)

Jury (marine photographer / VFX supervisor / offshore tech): means 5.9 / 5.8 / 5.5 of 10; low-sun, dusk and blue-hour
frames ~7–7.5; the 16:30 hero frame and the close views give it away. One of three would publish as-is. Their shared
high-impact fixes are round 4's brief. Lead rulings:
- **Near field:** all three levers — weather that shades the foreground where the photo is dark, a dimmer sunlit-water
  floor near the camera, and a luminance-based (hue-preserving) toe. Target p90/p10 ≥ 10, neutral navy (42, 63, 78).
- **Sky fill on vertical surfaces** must be physical (~0.10–0.15× the direct sun for a clear, AOD 0.04 sky), not
  ~0.37×: the hero tower needs a real shaded half (photo row 300: lit ~250, shade ~126–163).
- **Tone curve:** hue-preserving (no ACES red/green leak into blue, no olive TP in shade), recalibrated to the photo.
- **Night lamp columns:** keep the lights on (the farm's signature look) but break the columns into stippled glitter,
  shorter and less saturated. ADLS stays a toggle, default off.
- **Wide framing keeps the photo's vertical FOV** (31.4°, 53.1° across at 16:9).
- Config: deck preset pitch 8°, `PIXEL_BUDGET.ultra` 1.8e6, `QUALITY.low.pixelRatio` 1.5, `NIGHT_LIGHTS.marine.beamFloor`
  0.02 (farm and ocean both read it). Poster at 22.2 s; `"stillQuality": 6` only if the first view would fail.
