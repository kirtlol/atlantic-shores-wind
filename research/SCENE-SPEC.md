# SCENE SPEC: NJ offshore wind farm (the numbers the build uses)

Compiled 2026-09-30 by the completeness critic. Inputs, all read in full: `research/turbine-specs.md`, `research/site-environment.md`, `research/photo-look-targets.md`, `research/three-r180-api.md`, `reference/ref-1.png`, `ARCHITECTURE.md`, `src/shared.js`. Fresh sources were read where the inputs disagreed or left a hole.

**This file wins.** Where it disagrees with an input file, §1 explains why. `src/config.js` should carry these numbers.

**Tags.** Every number carries one tag.
- **SOURCED**: stated in the cited source [n] (§21). "(excerpt only)" means only a search snippet was seen.
- **DERIVED**: arithmetic on sourced numbers or pixel measurements. The working is shown, or the script is named.
- **ESTIMATED**: a judgement. The basis is stated. Do not quote these as specifications.

**Conventions** (these follow ARCHITECTURE.md):
- Units are metres, seconds and degrees. Axes: +X east, +Y up, +Z south. The origin is the **hero foundation axis at MSL**.
- A compass azimuth A becomes the vector (sin A, 0, −cos A). Wind and waves are given as the direction they come **from**.
- Colours are given as display sRGB hex plus *linear* RGB.
- An **"exposed"** value is scene-linear radiance × `toneMappingExposure`, which is what three.js r180 ACES receives before its internal `/0.6`.

**Scripts.** The DERIVED geometry, sun, tone-map and wave numbers were computed by Python scripts written for this research (not included in this repository): `cam.py`, `search.py`, `detail.py`, `final.py`, `rotor.py`, `sun.py`, `aces.py`, `layout.py`.

---

## 0. Decisions at a glance

| Item | Build value | Tag |
|---|---|---|
| What is modelled | **Atlantic Shores Offshore Wind South** (OCS-A 0499/0570), built as permitted. The COP was approved 2024-10-01 and remanded for reconsideration 2026-08-10. **Nothing is built off NJ.** Captions should say "planned" or "as permitted" | SOURCED [7], site-environment §1 |
| Turbine | **Vestas V236-15.0 MW**, the Atlantic Shores preferred turbine and the one being installed at Empire Wind 1. Hub **152.0 m**, rotor **236 m** | model and rotor SOURCED [4]; hub DERIVED (§4.1) |
| Layout | The **200 real BOEM positions**: **1111.6 m** along rows at **80.6°T**, **1865.9 m** between rows at **177.4°T** (1852 m perpendicular, i.e. 1.0 nm). **No jitter**: the real layout has none | DERIVED [9] |
| Hero turbine | West-south-west end of the longest row: **39.27716 N, 74.24830 W**. Atlantic City lies 17.9 km away at bearing 302.7° | DERIVED |
| Reference camera | Position (−649.5, 127.5, 420.9) m, **heading 58.5°T**, **pitch −3.209°**, **vertical FOV 31.40°**, aspect 3:2. The hero is 774 m away | DERIVED |
| Sun | **2026-06-21 16:30 EDT**: azimuth **266.6°**, elevation **43.0°** (reproduces the photo's sun at 208° relative) | DERIVED [31] |
| Wind | U10 **4.5 m/s from 200.5°T** (SSW). Hub wind 6.6 m/s gives a rotor speed of **5.0 rpm** | DERIVED / ESTIMATED |
| Waves | Wind sea: Hs **0.50 m**, Tp **3.8 s**, λp **22 m**, from 200.5°. Swell: Hs **0.45 m**, Tp **7.5 s**, λ **82 m**, from 160° | ESTIMATED within DERIVED bounds |
| Haze | Sea-level σ(550 nm) = **1.2 × 10⁻⁴ m⁻¹** (visibility 32.6 km). Aerosol scale height 1200 m, so AOD ≈ 0.13 | DERIVED |
| Clouds | One layer: base **1100 m**, thickness 300 m, cover **0.28** | DERIVED / ESTIMATED |
| Tone mapping | **ACES Filmic**. Exposure is set so that the horizon sky in the view direction has an *exposed* luminance of **1.43** | DERIVED |
| Reference photo | ref-1.png is **Borkum Riffgrund 1 (Germany)**: Siemens SWT-4.0-120 turbines, hub ≈83 m | SOURCED [2][3] |

---

## 1. Contradictions between the inputs, and how each is resolved

| # | Topic | Conflict | Resolution and reason |
|---|---|---|---|
| C1 | Identity of the photo | turbine-specs identifies it as Borkum Riffgrund 1 (grey-level correlation 0.986 with the Commons file). site-environment says "not identified; guess BR1 or Gode Wind". photo-look says "very likely German North Sea" | **Borkum Riffgrund 1.** The pixel match to [2] is decisive. The other two files only reasoned from the markings. |
| C2 | Hub height of the photo turbine, H_photo | turbine-specs uses 90 m (the SWT-4.0-120 model datasheet, ESTIMATED for BR1). photo-look chose 90 m (range 80–95 m) | **Fresh source: H_photo ≈ 83 m, tip ≈ 142 m** (German Wikipedia, "Nabenhöhe etwa 83 m") [3]. SOURCED. Consequences (DERIVED from photo-look's scale-free ratios × 83): the scale at the hero is 176 px / 83 m = **2.12 px/m**. The yellow paint (33 px) is **15.6 m**, which matches IALA's "15 m" [14] better than 16.8 m did. Each tip band is 11.7 px = **5.5 m** (the AVV rule is 6 m). The photo camera was **68.9 m** up and the hero was **423 m** away (the task brief said "~400 m"). The lattice is 8.5 H = 706 m, and extinction rescales to σ = 0.11 × 90/83 = **0.119 km⁻¹**. |
| C3 | Hero waterline row | turbine-specs uses y = 345. photo-look uses y = 350, with a dark band at 345–350 | **Waterline at y = 350**, where the reflection starts. Rows 345–350 are the dark splash/marine-growth band, 5 px = 2.4 m at 2.12 px/m. |
| C4 | Hero hub pixel | turbine-specs uses (367.8, 168.7), the centroid of the three tips. photo-look uses (362, 174), where the blade axes cross | **(362, 174).** The axis intersection uses the whole blade length. The tips are sub-pixel and noisy, and the rotor model below puts the tip centroid only 0.4 px from the hub (`rotor.py`). |
| C5 | Width of the transition piece (TP) vs the tower | turbine-specs says 1.4× (low confidence). photo-look measured 10.2 px against 9.5 px = 1.07× | **1.07×** (edge-fitted). For the V236: TP 10.5 m / tower base 10.0 m = 1.05×. |
| C6 | Platform deck height | turbine-specs puts the deck at +17.5 m MSL, derived from the photo with the wrong waterline and H. The photo at H = 83 gives about +21.7 m. The Vineyard Wind interface envelope is 19–23 m MLLW [15] | **Deck at +18.5 m MSL** (= 19.2 m MLLW, inside the VW range). The **TP top flange is at +21.5 m** (3.0 m above the deck, the photo's collar/railing band of 6 px = 2.8 m). The **marine lanterns are at +20.5 m MSL** (= 21.2 m MLLW, inside Revolution Wind's 20–23 m [16]). |
| C7 | Turbine count in the photo | The brief says ~15, site-environment ~16, photo-look **19** (column scan) | **19** (hero + 18). In the NJ scene, **19 turbines fall in frame within 10 km** (T ≥ 0.30). A further 61 fainter ones out to 26 km do not exist in the photo; this is by design, because ASOW has 200 positions. |
| C8 | Farm grid | photo-look: a square lattice of 8.5 H (706 m at H = 83). site-environment: the real ASOW grid, 1111 × 1865 m, skewed 96.8° | **Real ASOW grid** (NJ realism). With heading 58.5° the right-hand row reproduces the photo's T580/T634/T659/T674/T682 within 3–12 px. The near-left field is sparser: the first left turbine is at 3.8 km, and the photo's T97/T46 have no counterpart. This is documented in §20. |
| C9 | Extinction σ and visibility | site-environment: 0.13–0.20 km⁻¹ as the fog recommendation, with 0.19–0.23 in its §2.2 fit. photo-look: 0.11 km⁻¹ (0.08–0.15) at H = 90, plus a horizon-brightness check of σ ≤ 0.10–0.12 | **σ(550) = 0.12 km⁻¹ at sea level.** This is photo-look's value rescaled to H = 83 (0.119). The horizon check still passes: T(10 km) = 0.30. site-environment's higher values come from a "yellowness" metric that includes sub-pixel mixing, which photo-look flags. |
| C10 | Haze height falloff | photo-look: 0 or ≤ 5 × 10⁻⁴ m⁻¹. site-environment: scale height 0.3–0.5 km. three-r180-api example: 1.5 × 10⁻³. shared.js: 1/900 | **1/1200 m⁻¹** (aerosol scale height 1200 m, SOURCED Bruneton default [22]). This gives AOD = 1.064 × 10⁻⁴ × 1200 = **0.128**, which sits between the NJ summer AERONET p10 (0.07) and median (0.166) [28] (DERIVED). A 0.3–0.5 km scale height would give AOD 0.03–0.05, below the NJ p10, so it is rejected. |
| C11 | Units of the fog/in-scatter colour | photo-look gives display hex #e5ecf5. three-r180-api says the fog colour must be linear HDR radiance | **In-scatter colour = the atmosphere's horizon sky radiance** in the view azimuth. The *exposure* then maps it to #e5ecf5 (exposed luminance **1.43**, exposed RGB (0.98, 1.44, 2.56); §12). |
| C11b | Sky model | site-environment and three-r180-api tune three.js `Sky.js`. ARCHITECTURE requires a physically based Rayleigh + Mie + ozone atmosphere | **Physically based model (§9)**, using Bruneton's coefficients with NJ aerosol. The Sky.js settings are superseded and serve only as a sanity check. |
| C12 | Sun | photo-look: 208° ± 10 relative, elevation 45° (35–55°). site-environment: 21 June 15:00–16:00, heading 60–80° (180–200° relative) | **21 June 2026, 16:30 EDT, at the hero**: azimuth 266.59°, elevation 42.97°. With heading 58.5° that is **208.1° relative** (DERIVED, NOAA algorithm, `sun.py`, which reproduces site-environment's 15:00 check to 0.01°). |
| C13 | Camera | photo-look: 74.7 m, 459 m, pitch 3.10° at H = 90 with a refracted Earth radius. turbine-specs: 0.51 m/px | For the **H = 152 m** build, with **R = 6371 km** (shared.js `EARTH_R`, no refraction), solving hero waterline → y 350 and hub → y 174 with the horizon at y 208.25 gives: **camera h = 127.5 m, hero distance 774 m, pitch 3.209°** (DERIVED, `cam.py`). The pitch must use the same R as the ocean shader, or the horizon misses row 208 by about 0.4 px. |
| C14 | Earth radius | photo-look: 7433 km (7/6 R_E) in its recipe and 7323 km in its maths. site-environment: 7323 km. shared.js: 6371 km | **The render uses 6371 km** (geometry has no refraction). The horizon is at 40.3 km from 127.5 m. The refracted numbers in the input files differ by ≤ 8 % in hull-down distance, which is not visible here. |
| C15 | Turbine choice | turbine-specs recommends the SG 11.0-200 DD for photo likeness. The same file, and site-environment, name the V236 as the NJ turbine for ASOW | **V236-15.0 MW.** The user asked for NJ. ASOW is the only NJ project with a selected turbine and real positions, and its grid was designed for ≤ 280 m rotors [7]. The silhouette differences are small (R/H 0.78 against the photo's 0.68). The SG 11 figures are kept in §19 as a switch. |
| C16 | V236 hub/root radius | turbine-specs uses 3.5 m, which gives (3.5 + 115.5)·cos 4° = **237.4 m** diameter, not the SOURCED 236 m | **3.0 m.** Then (3.0 + 115.5)·cos 4° − 3.95·sin 4° = **117.9 m** tip radius, or 235.9 m diameter (DERIVED). |
| C17 | Tip bands and nacelle stripe | photo-look checklist item 6 requires 3 red/white bands. turbine-specs: the FAA requires solid white/grey blades and nacelles in the US [11] | **US-accurate: no bands and no stripe.** An optional `photoLook` toggle adds 3 bands of 0.10 R (11.8 m each, RAL 3020 / 7035 / 3020). Checklist item 6 is changed (§20). |
| C18 | Mid-mast aviation lights | ARCHITECTURE says "mid-tower L-810 steady red". turbine-specs says L-810 F flashing | **Flashing L-810 F, in unison with the nacelle L-864s at 30 fpm; 4 lights** because the mast is more than 20 ft in diameter. Re-read in FAA AC 70/7460-1N §13.7.3–13.7.4 [11]. SOURCED. |
| C19 | Water body colour | site-environment: NJ water is Forel-Ule 4 teal (water-leaving π·Rrs = 0.0019, 0.0087, 0.0118). photo-look: "very dark navy, lin (0, 0.003, 0.010), upwelling ≈ 0" | **Physical FU4 NJ water** (DERIVED from satellite data [29]). The photo is German Bight water with a black-crushing grade. Reproduce the photo's black troughs with the grade's toe (§12), **not** by darkening the water. The render's near troughs will be slightly tealer than the photo. |
| C20 | Wind speed and sea state | photo-look says U ≈ 4–5 m/s but "Beaufort ≈ 2", which is 2.1–3.1 m/s [43], so it contradicts itself. site-environment: summer median U10 5.0–5.7 m/s, and no whitecaps implies ≤ 4–5 m/s | **U10 = 4.5 m/s** (low Beaufort 3). Monahan gives a whitecap fraction W = 0.065 %, which is invisible. Set the render's whitecap onset at 5.0 m/s. The wave statistics are in §11. |
| C21 | Direction of wind and waves | photo-look: wind "from ≈142° relative"; the wind sea propagates toward −38° relative. site-environment: summer wind from SSW; wind sea from 205° | **Consistent.** With heading 58.5°: wind from 58.5 + 142 = **200.5°T** (SSW, the top summer sector [27]), and the sea travels toward 20.5°T = **−38° relative**, exactly as photo-look measured. |
| C22 | Cloud base | photo-look: 0.6–1.0 km (ESTIMATED from an assumed cloud width). site-environment: ACY daytime JJA median 1.13 km (IQR 0.67–1.68 km). shared.js: 1600 m. ARCHITECTURE: the overview camera is at 1.5 km, above that layer | **Base 1100 m, top 1400 m.** The **overview camera is at 900 m**, below the base. If the lead keeps a 1.5 km overview, the cloud module must render the layer from above. |
| C23 | Vignette and grain | ARCHITECTURE: "very subtle vignette + fine grain". photo-look: **no measurable vignette**, noise 0.6–1.2 levels | Reference preset: **vignette 0**, grain ≤ 0.5/255, used only as dither against sky banding (three-r180-api §3.3). |
| C24 | Rotor speed at the default wind | site-environment: "5–7 rpm" (estimate). turbine-specs: λ = 9 law with no minimum rpm | U_hub = 4.5·(152/10)^0.14 = 6.59 m/s gives λ·U/R = **4.8 rpm**. That is below an IEA-style minimum rotor speed (5.0 rpm), so **5.0 rpm** (DERIVED / ESTIMATED floor). |
| C25 | Hero distance | brief ~400 m; photo-look 459 m | Photo: **423 m** at H = 83. Build: **774 m** = 5.09 H. The same framing ratio is kept. |
| C26 | ASOW position count | turbine-specs: "up to 197 locations incl. OSS and met tower". site-environment: 200 WTG positions | **200 WTG positions.** Project 1 has 105–136 and Project 2 has 64–95, with a 31-position overlap; the BOEM layer has 200 points. The OSSs are *extra*, "positioned along the same ENE/WSW rows" [7] (read in full this session). SOURCED. |
| C27 | Substation | photo-look: 10 × 5.5 px on the horizon (a converter-class topside ≈140 m wide). The NJ envelopes are much smaller | **ASOW "Large" OSS**, 50 × 90 m, topside top 63.3 m MLLW [8], on the hero's row at 14.6 km. It renders about 5.5 × 4 px straddling the horizon at x ≈ 723. No permitted NJ OSS can reproduce 10 px at the horizon. Documented deviation. |
| C28 | Platform size | turbine-specs: CVOW pilot photo, platform span ≈ 1.94 × TP. photo-look: BR1 platform 14 px / TP 10.2 px ≈ 1.37 × | **Ring outer diameter = 1.5 × TP (15.75 m)**, plus a lobe reaching 1.94 × TP (20.4 m span) on the boat-landing side, which faces away from the reference camera (ESTIMATED compromise). |
| C29 | shared.js placeholders vs research | `uFogDensity` 4e-5, `uFogHeightFalloff` 1/900, `uCloudAltitude` 1600, `uCloudThickness` 400, `uCloudCover` 0.35, `uWindSpeed` 7 | Replace with **1.2e-4, 1/1200, 1100, 300, 0.28, 4.5** (§9–§11). This is a note for the lead; this file does not edit shared.js. |
| C30 | Yellow extent rule | IALA: from HAT up to 15 m [14]. BOEM: from MHHW to ≥ 50 ft above it [12] | The US rule applies: yellow from **MHHW (+0.73 m MSL)** to at least **+15.97 m**. The build paints it up to the TP top at **+21.5 m**, which satisfies both rules. |
| C31 | Sun intensity scale | three-r180-api: sun 10–14 with ACES exposure 0.9, calibrated to Sky.js radiance. ARCHITECTURE: sun ≈ 3–5 scene units | Absolute units are the atmosphere module's choice. Only **ratios** are specified: exposure = 1.43 / L_horizon, and L_horizon / E_sun ≈ 0.08–0.16 sr⁻¹ as a sanity band (§12). |

---

## 2. Gaps no input file filled, and what fills them now

| # | Gap | Filled with | Section |
|---|---|---|---|
| G1 | Hub height of the photo turbine | 83 m [3] | §1 C2 |
| G2 | Tidal datums (MLLW, MHHW, HAT, LAT relative to MSL) | NOAA CO-OPS 8534720, Atlantic City [19] | §3.2 |
| G3 | Which of the 200 positions is the hero; the lattice in three.js axes; the full position list | Hero-relative lattice with row ranges (exact to 1e-9 m against the CSV) | §5 |
| G4 | Exact default date, time and sun vector | NOAA algorithm at the hero | §8 |
| G5 | Coefficients for the physical atmosphere | Bruneton [22] plus NJ aerosol | §9 |
| G6 | Exposure and tone-map targets in HDR units | ACES r180 inverse [32] | §12 |
| G7 | Paint albedos (linear) and PBR roughness/metalness | RAL XYZ table [21] → linear sRGB; roughness ESTIMATED | §4.8 |
| G8 | Wave spectrum numbers: fetch, Hs, Tp, λ, spreading, depth | PM/JONSWAP [25], dispersion | §11 |
| G9 | Cloud drift and optical look | ESTIMATED from photo ratios | §10 |
| G10 | L-810 intensity; marine-lantern and vessel-light intensities; vertical beam | FAA Table B-1 [11]; COLREGS Annex I §8 [23] | §13 |
| G11 | Vessel light positions, heights, arcs | COLREGS Rules 21/22/27 and Annex I §2 [23][24] | §14 |
| G12 | Substation placement, orientation and lights | ASOW PDE rows rule [7]; FAA §5.7 [11] | §6 |
| G13 | **Land in non-reference views**: the hero is only 17 km from Atlantic City, and the casino towers are geometrically visible and above the 2 % contrast threshold | Skyline data [34][35] | §16 |
| G14 | Rotor spin direction, blade leading-edge side, the reference rotor phase | Convention (ESTIMATED) plus a photo fit | §4.9 |
| G15 | rpm law with floor and cap; idle fraction | DERIVED / ESTIMATED | §4.9 |
| G16 | Camera presets for all 6 views | DERIVED / ESTIMATED | §7 |
| G17 | Sizes for the fish and bird "life" modules | Wikipedia species pages [39]; site-environment | §15 |
| G18 | SCALE_TABLE reference sizes with tolerances | Consolidated | §17 |
| G19 | V236 tower diameter against height, in metres | IEA shape rescaled | §4.5 |
| G20 | Where the hub sits inside the nacelle | DERIVED from the sourced 11 m height | §4.4 |
| G21 | Boat-landing orientation, door, ID string | ESTIMATED | §4.6 |
| G22 | Water depth at the hero | ESTIMATED 22 m (ASOW range 19–37 m [40], shallowest near shore) | §3.1 |
| G23 | Shadow frustum for a 270 m hero | DERIVED | §12.4 |

---

## 3. SITE

### 3.1 Location

| Quantity | Value | Tag |
|---|---|---|
| Hero turbine | ASOW position at CSV row index 110: **39.27716406 N, 74.24829964 W** (NAD83 ≈ WGS84 within 1–2 m). UTM 18N 564836.7 E, 4347803.8 N | SOURCED [9] (CSV) |
| Hero in the lattice | Absolute (i, j) = (−12, −9): the west-south-west end of the longest row (25 turbines) | DERIVED (`layout.py`) |
| Atlantic City (39.3643 N, 74.4229 W) | 17.9 km at bearing 302.7° from the hero | DERIVED |
| Nearest shore | ≈17 km (rough coastline polyline). The ASOW array's closest point is 8.7 statute mi = 14 km [7] | DERIVED / SOURCED |
| Water depth at the hero | ≈22 m. The ASOW range is 19–37 m, "gradually increasing with distance from shore" [40] | ESTIMATED / SOURCED range |
| Time zone | EDT = UTC−4 in summer, EST = UTC−5 in winter | SOURCED (standard) |
| Grid convergence (UTM 18N) | +0.575°: true bearing = grid bearing + 0.575° | DERIVED (site-environment §4.3) |
| UTM scale factor at the site | k = 0.99968. Grid distances are 0.03 % short, and are corrected in §5 | DERIVED: 0.9996 · (1 + (Δλ·cos φ)²/2) with Δλ = 0.908° |

### 3.2 Vertical datums (MSL = y 0)

| Datum | Relative to MSL (m) | Tag |
|---|---|---|
| HAT (highest astronomical tide) | **+1.122** | DERIVED from [19]: HAT 3.308 − MSL 2.186 |
| MHHW | **+0.728** | DERIVED from [19]: 2.914 − 2.186 |
| MLLW | **−0.675** | DERIVED from [19]: 1.511 − 2.186 |
| LAT (lowest astronomical tide) | **−1.077** | DERIVED from [19]: 1.109 − 2.186 |
| Great diurnal range (MHHW − MLLW) | 1.403 m. This matches the Ocean Wind 1 site value of 4.6 ft = 1.40 m [20] | SOURCED [19] |

Atlantic City (station 8534720, epoch 1983–2001) is used as the site proxy (ESTIMATED; the tidal range matches the offshore value from the OW1 COP).

### 3.3 Earth

| Quantity | Value | Tag |
|---|---|---|
| Curvature radius used in geometry | 6,371,000 m (`EARTH_R`, no refraction) | SOURCED (shared.js) |
| Sea horizon from the reference camera (127.5 m) | √(2Rh) = **40.3 km**; dip **0.363°** | DERIVED |
| Minimum sea-mesh radius, reference view | ≥ 45 km. For the 900 m overview: √(2R·900) = 107 km, so use ≥ 110 km | DERIVED |

---

## 4. TURBINE: Vestas V236-15.0 MW

### 4.1 Global geometry

| Parameter | Value | Tag and basis |
|---|---|---|
| Rated power | 15.0 MW | SOURCED [4] |
| Rotor diameter / tip radius | **236 m / 118 m** (the model gives 117.9 m) | SOURCED [4]; model DERIVED (C16) |
| Blade length | **115.5 m** | SOURCED [4] |
| Blade-root circle radius (hub radius) | **3.0 m** | DERIVED (C16) |
| Hub height | **152.0 m above MSL** | DERIVED: Empire Wind tip 886 ft = 270 m [5] − 118. The ASOW envelope is ≤175 m [7] |
| Tip height / lowest tip | 270 m / ≈34 m. The permit minimum is 23.1 m [7] | DERIVED |
| Shaft tilt | 6° (the upwind end is higher) | ESTIMATED from IEA 15 MW [10] |
| Pre-cone | 4° (blades lean upwind) | ESTIMATED from [10] |
| Tip prebend | 3.95 m upwind | ESTIMATED: IEA 4.0 m × 115.5/117 [10] |
| Overhang (tower axis to hub centre, horizontal) | 12.0 m | ESTIMATED from IEA 11.0–12.0 m [10] |
| Tower top → hub centre (vertical) | 5.6 m. The yaw bearing is at **y = 146.4 m** | ESTIMATED from IEA 5.614 m [10]; DERIVED |
| Drivetrain | Medium-speed geared. There is **no external generator ring**: the hub mates directly to the nacelle front | SOURCED [4]; look ESTIMATED |
| Cut-in / cut-out | 3 m/s / 31 m/s | SOURCED [4] |

### 4.2 Vertical stack at the foundation (y above MSL)

| Level | y (m) | Tag and basis |
|---|---|---|
| Seabed (hero) | −22 | ESTIMATED (G22) |
| Monopile below water | dark red-brown/black, visible only in wave troughs | ESTIMATED (turbine-specs §5.2) |
| Marine-growth band | **−1.1 to +1.8**, fading over the top 0.5 m. Colour: photo #100e08, lin (0.005, 0.004, 0.002) | Range DERIVED: LAT to HAT + ≈0.7 m splash. The photo band is 2.4 m (C3). Colour SOURCED (px) [1] |
| Yellow paint (RAL 1023) | from +0.73 (MHHW; below +1.8 it is under the growth band) **to +21.5 (TP top)** | SOURCED rule [12] (C30) |
| Painted ID characters | bottom **+11.0**, top **+14.0** (3.0 m tall) | SOURCED rule: 9.8 ft tall, bottom 30–50 ft above MHHW = +9.9 to +16.0 [12][13]; placement ESTIMATED |
| Platform skirt bottom | **+17.0** | ESTIMATED: deck minus a 1.5 m conical skirt |
| Platform deck (grating) | **+18.5** (= 19.2 m MLLW) | ESTIMATED inside the VW 19–23 m MLLW envelope [15] (C6) |
| Guard-rail top | **+19.6** (1.1 m rail) | SOURCED rail height ≥1,100 mm [18] |
| Marine lanterns (2, on opposite sides) | **+20.5** (= 21.2 m MLLW) | SOURCED range 20–23 m MLLW [16]; the pick is ESTIMATED |
| TP top flange = tower base | **+21.5** | ESTIMATED (C6); inside the VW interface of 19.5–22.5 m MLLW [15] |
| Mid-mast aviation lights (4) | **+79.2** | DERIVED: midway between the nacelle top and sea level [11 §13.7.2] |
| Tower top / yaw bearing | **+146.4** | DERIVED |
| Nacelle floor | +147.4 | ESTIMATED: 1.0 m yaw adapter |
| Hub centre | **+152.0** | DERIVED §4.1 |
| Nacelle roof | **+158.4** | DERIVED: floor + 11.0 m [6] |
| Nacelle L-864 lights (2) | +159.4 | ESTIMATED: roof + 1.0 m mounts |
| Top of cooler | +160.2 | ESTIMATED: roof + 1.8 m |

### 4.3 Blade planform (IEA 15 MW scaled by k = 115.5/117 = 0.987; r = 3.0 + s·115.5)

| s | r (m) | Chord (m) | Twist (°) | t/c | Thickness (m) | Prebend (m, − = upwind) | Pitch axis x/c |
|---|---|---|---|---|---|---|---|
| 0.000 | 3.0 | 5.13 | +15.59 | 1.000 | 5.13 | 0.00 | 0.505 |
| 0.020 | 5.3 | 5.14 | +15.59 | 1.000 | 5.14 | +0.02 | 0.490 |
| 0.050 | 8.8 | 5.19 | +15.21 | 0.939 | 4.88 | +0.05 | 0.464 |
| 0.100 | 14.6 | 5.37 | +13.49 | 0.704 | 3.79 | +0.13 | 0.417 |
| 0.150 | 20.3 | 5.58 | +11.03 | 0.502 | 2.80 | +0.21 | 0.376 |
| 0.207 | 26.9 | **5.69 max** | +8.43 | 0.399 | 2.27 | +0.25 | 0.339 |
| 0.250 | 31.9 | 5.61 | +7.03 | 0.358 | 2.01 | +0.25 | 0.323 |
| 0.300 | 37.7 | 5.30 | +5.52 | 0.338 | 1.79 | +0.24 | 0.312 |
| 0.400 | 49.2 | 4.64 | +3.22 | 0.311 | 1.44 | +0.20 | 0.300 |
| 0.500 | 60.8 | 4.10 | +1.69 | 0.282 | 1.16 | −0.05 | 0.289 |
| 0.600 | 72.3 | 3.63 | +0.56 | 0.251 | 0.91 | −0.49 | 0.289 |
| 0.700 | 83.9 | 3.18 | −0.49 | 0.223 | 0.71 | −1.14 | 0.299 |
| 0.800 | 95.4 | 2.73 | −1.94 | 0.211 | 0.58 | −1.93 | 0.314 |
| 0.900 | 107.0 | 2.24 | −2.10 | 0.211 | 0.47 | −2.86 | 0.335 |
| 0.950 | 112.7 | 1.96 | −1.82 | 0.211 | 0.41 | −3.39 | 0.350 |
| 0.980 | 116.2 | 1.79 | −1.50 | 0.211 | 0.38 | −3.72 | 0.360 |
| 0.995 | 117.9 | 1.45 | −1.31 | 0.211 | 0.31 | −3.89 | 0.366 |
| 1.000 | 118.5 | 0.49 | −1.24 | 0.211 | 0.10 | −3.95 | 0.368 |

- **Where the numbers come from.** Chord, twist, t/c, prebend and pitch axis are DERIVED from [10] × k (turbine-specs §6.2 and §10). The r column is shifted −0.5 m by C16. All of it is ESTIMATED for the real Vestas blade.
- **Airfoils.** Circular from s = 0 to 0.02, then the FFA-W3 family from 50 % down to 21.1 % thick (turbine-specs §10, SOURCED [10]).
- **Tip.** A rounded, swept tip cap over the last 2 % of span.
- **Twist sign.** Positive twist turns the leading edge upwind.

### 4.4 Hub and nacelle (yaw frame: origin on the tower axis at y 146.4, rotor side = +Z toward upwind)

| Part | Value | Tag and basis |
|---|---|---|
| Nacelle height × width | **11.0 × 9.0 m** | SOURCED (excerpt only) [6] |
| Overall length, spinner nose to the rear of the heli-hoist deck | **28 m** | SOURCED (excerpt only) [6] |
| Nacelle box | 19.0 m long (from 3.0 m behind the hub centre back to 22.0 m behind it; tower axis at 12.0 m) × 9.0 × 11.0 m. Flat sides; top edges rounded r ≈ 1.0 m | ESTIMATED split of the sourced 28 m (turbine-specs §6.3) |
| Heli-hoist deck | Railed deck (1.1 m rails) over the rear 3.0 m, flush with the rear wall; 9 × 3 m | ESTIMATED; the modules are SOURCED [turbine-specs S13] |
| Cooler top | Open radiator frame on the rear third of the roof, 1.8 m tall | ESTIMATED; "cooler top" module SOURCED [turbine-specs S13] |
| Spinner / hub | Rounded cone, **Ø 7.5 m**, **6.0 m long**; nose 3.5 m ahead of the hub centre | ESTIMATED: IEA hub Ø 7.94 m × 0.95 [10] |
| Hub centre in the yaw frame | (0, **+5.6**, **+12.0**); shaft tilted 6° nose-up; nacelle box kept level | DERIVED §4.1; level box ESTIMATED |
| Nacelle envelope check | ASOW maximum 25.0 × 16.0 × 12.0 m [8]. The box plus deck (22 m) fits | SOURCED / DERIVED |
| Roof items | 2 × L-864 on opposite roof sides; small met mast (vane and anemometer, ≈2 m) at the rear | Lights SOURCED [11 §13.6.2]; mast ESTIMATED |

### 4.5 Tower (base y 21.5, top y 146.4, length 124.9 m)

| η (fraction of height) | 0 | 0.1 | 0.2 | 0.3 | 0.4 | 0.5 | 0.6 | 0.7 | 0.8 | 0.9 | 1.0 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| y (m) | 21.5 | 34.0 | 46.5 | 59.0 | 71.5 | 84.0 | 96.4 | 108.9 | 121.4 | 133.9 | 146.4 |
| D (m) | 10.00 | 10.00 | 9.95 | 9.60 | 9.16 | 8.68 | 8.14 | 7.79 | 7.68 | 7.55 | 7.50 |

- **How D is built.** D = 7.5 + 2.5·f(η), where f is the IEA 15 MW normalised taper (t − 0.65)/0.35 [10]. DERIVED shape, ESTIMATED for the V236.
- **End diameters.** The base, 10.0 m, is SOURCED as the ASOW maximum [8] and equals the IEA value. The top, 7.5 m, is ESTIMATED (turbine-specs §6.4).
- **Sections.** 4 sections with flange rings at y 52.7, 83.9 and 115.2. Each flange is a 0.08 m darker ring. Faint weld seams every 3.5 m. ESTIMATED (turbine-specs §4.4).
- **Door.** 1.0 × 2.2 m with rounded corners, in the TP wall at deck level (y 18.5–20.7), facing the boat landing. ESTIMATED.

### 4.6 Transition piece, platform, boat landing, davit

| Item | Value | Tag |
|---|---|---|
| TP outer diameter | **10.5 m** (the Empire Wind monopile is 10 m at MSL) | ESTIMATED from SOURCED [33] |
| Top flange | Outward L-flange, 0.3 m proud × 0.3 m tall, with a bolt circle | ESTIMATED |
| Platform plan | Annular ring, outer **Ø 15.75 m** (1.5 × TP), plus a lobe out to **20.4 m** span (1.94 × TP) on the boat-landing side | ESTIMATED (C28) |
| Platform underside | Conical skirt, 1.5 m deep, grey | ESTIMATED |
| Grating | Galvanised grating; photo band #bbbdbc | SOURCED (px) colour [1]; material ESTIMATED |
| Guard-rail | 1.1 m tall: top rail, knee rail (≤500 mm gaps), toe plate, posts every 1.5 m. **Yellow RAL 1023** (the photo shows a cream/yellow railing) | Heights and gaps SOURCED [18]; post spacing and colour ESTIMATED |
| Boat landing | Faces **20°T** (NNE), the lee of the SSW summer wind sea and SSE swell, so a CTV pushes on bow-into-sea. **Hidden from the reference camera** | ESTIMATED |
| Landing geometry | 2 bumper tubes, **Ø 406 mm**, **1.8 m apart** centre to centre. Ladder 850 mm behind the tube face, 0.5 m wide, 30 mm square rungs at 0.28 m pitch. Tubes run from −3.98 (LAT − 2.9) up to at least +8.7 (HAT + 7.6). Rest platform at +8.7; the ladder continues to the deck | SOURCED [17]; y values DERIVED with §3.2 |
| Davit crane | Slewing jib, 4.5 m long, on the landing-side lobe, white/grey | ESTIMATED (turbine-specs §5.3) |
| ID string | Row letter + column number. Rows dj = −5 … +9 → A … O; column = di + 1. **Hero = "F01"**. Black, 3 m characters, painted at 4 azimuths | Format ESTIMATED; size SOURCED [12] |

### 4.7 Markings

| Item | US build (default) | `photoLook` toggle | Tag |
|---|---|---|---|
| Blade tip bands | none | 3 bands of 11.8 m (0.10 R) from the tip: RAL 3020 / 7035 / 3020 | SOURCED US rule [11]; toggle DERIVED from C17 |
| Nacelle stripe | none | 2 m RAL 3020 band around the rear at half height | SOURCED German rule [41] (turbine-specs §7.2) |
| Retro-reflective bands | optional: white, ≥0.61 m, ≥30 ft above MHHW | – | SOURCED [12] |

### 4.8 Materials and colours (PBR). Linear values are the paint's reflectance, converted from the XYZ table of [21] with the sRGB D65 matrix and clipped to ≥0.

| Surface | Paint | Linear base colour | sRGB hex | Luminance reflectance (Y) | Roughness / metalness / clearcoat | Tag |
|---|---|---|---|---|---|---|
| Tower, nacelle, spinner, blades | **RAL 7035** light grey | **(0.547, 0.567, 0.530)** | #c3c6c0 | 0.560 | 0.50 / 0 / 0.2 (clearcoat roughness 0.35) | Colour DERIVED from [21]; FAA range RAL 9010–7035 SOURCED [11][12]; PBR ESTIMATED ("matte" per turbine-specs) |
| (the lightest allowed option) | RAL 9010 pure white | (0.871, 0.852, 0.765) | #f0eee3 | 0.850 | same | DERIVED [21] |
| TP and railing | **RAL 1023** traffic yellow | **(0.941, 0.478, 0.020)** (raw blue −0.039 is out of gamut; floor 0.02) | #f8b800 | 0.539 | 0.55 / 0 / 0 | DERIVED [21]; rule SOURCED [12] |
| Platform grating and skirt | galvanised steel | (0.525, 0.539, 0.536) (≈RAL 9006) | #c0c2c1 | 0.536 | 0.55 / **1.0** / 0 | DERIVED [21]; metalness ESTIMATED |
| ID characters | RAL 9005 black | (0.002, 0.002, 0.003) | #060609 | 0.002 | 0.6 / 0 / 0 | DERIVED [21] |
| `photoLook` tip red | RAL 3020 | (0.476, 0.005, 0.000) | #b71100 | 0.105 | 0.5 | DERIVED [21] |
| Marine growth | – | (0.005, 0.004, 0.002); wet lower half roughness 0.25 | #100e08 | – | 0.8 dry / 0.25 wet | SOURCED (px) [1]; PBR ESTIMATED |
| Weathering | Faint rust streaks below the TP flange and bolts, lin (0.20, 0.08, 0.03), ≤10 % coverage; salt bloom on the yellow; leading-edge wear on the outer 30 % of the blade | – | – | – | – | ESTIMATED |

**How RAL 1023 tone-maps under ACES** (§12 exposure, sun 43°). The lit side displays about **(252, 241, 178)**; the photo's lit TP is #f8eb89 = (248, 235, 137). ACES's hue shift gives the lemon look the photo has. DERIVED (`aces.py`).

### 4.9 Operation and animation

| Behaviour | Value | Tag |
|---|---|---|
| Spin direction | **Clockwise seen from upwind.** In the rotor frame (+Z = upwind): `rotor.rotation.z = −Ω·t`. The leading edge of blade 0, which is at +Y, faces **+X** | ESTIMATED (industry convention; no source was read) |
| Reference rotor phase (the photo) | Blade 0 at **50° clockwise from the top**, seen from upwind. This projects the tips to (446, 91), (400, 309) and (253, 117), against the photo's (432.5, 97.5), (397, 287) and (274.5, 124.5) | DERIVED (`rotor.py`, the photo's blade angle 42.7° de-foreshortened by cos 38°) |
| Yaw | Rotor faces into the wind: **the rotor axis points to 200.5°T**, and the nacelle rear points to 20.5°T. Per-turbine offset: normal, σ = 3°, drifting over minutes | Wind DERIVED (C21); offset ESTIMATED (turbine-specs §8) |
| Hub wind | U_hub = U10·(152/10)^0.14. At 4.5 m/s that is **6.59 m/s** | SOURCED α [42]; DERIVED |
| rpm law | rpm = clamp(9·U_hub/118·9.549, **5.0**, **7.9**) for 3 ≤ U_hub < 31 m/s. Below cut-in: idling at 0.5 rpm, feathered. Above cut-out: parked | TSR 9 and min 5.0 rpm ESTIMATED from IEA [10]; max 7.9 rpm ESTIMATED (tip ≈ 97 m/s); cut-in/out SOURCED [4] |
| Default rpm | **5.0 rpm**: 12 s per revolution, a blade passes the tower every 4 s | DERIVED (C24) |
| Pitch | 0–1° at the default wind. Rises above rated wind (≈10.6 m/s). Idle turbines are feathered at 90° | SOURCED schedule [10] (turbine-specs §8) |
| Idle turbines | 4 % of turbines, chosen by seed, idle and feathered | ESTIMATED (typical offshore availability ≈95 %; not sourced) |
| Phase between turbines | Independent random phase per turbine; never synchronise | ESTIMATED |
| Yaw rate / yaw lag | 0.5 °/s; about 3 min lag after a wind shift | SOURCED [10] / turbine-specs [S41] |

---

## 5. LAYOUT (Atlantic Shores South, 200 positions)

**Lattice vectors.** These are in three.js axes, true-north aligned, with the UTM scale corrected. DERIVED from [9] (`final.py`); the fit residual on the CSV is 0.04 m RMS.
- **a** (next turbine along a row, bearing 80.575°T): **(+1096.55, 0, −182.02)**, |a| = **1111.56 m** (0.600 nm).
- **b** (next row to the south, same column, bearing 177.418°T): **(+84.06, 0, +1863.99)**, |b| = **1865.88 m**. The perpendicular row spacing is 1852.0 m (1.000 nm).

**Positions.** Turbine (di, dj) sits at **x = di·a_x + dj·b_x, z = di·a_z + dj·b_z**, relative to the hero. The rows are contiguous in di. dj increases southward.

| dj | di range | Count | | dj | di range | Count |
|---|---|---|---|---|---|---|
| −5 | +5 … +6 | 2 | | +3 | +5 … +23 | 19 |
| −4 | +5 … +16 | 12 | | +4 | +4 … +21 | 18 |
| −3 | +6 … +17 | 12 | | +5 | +5 … +19 | 15 |
| −2 | +5 … +18 | 14 | | +6 | +8 … +18 | 11 |
| −1 | +1 … +19 | 19 | | +7 | +9 … +15 | 7 |
| **0 (hero row)** | **0 … +24** | 25 | | +8 | +10 … +14 | 5 |
| +1 | +3 … +23 | 21 | | +9 | +12 … +12 | 1 |
| +2 | +5 … +23 | 19 | | **total** | | **200** |

Reproducing the CSV this way leaves a maximum error of 1 × 10⁻⁹ m against the (rotated) CSV positions. DERIVED.

| Quantity | Value | Tag |
|---|---|---|
| Array extent relative to the hero | x 0 … +26.3 km; z −10.4 … +14.6 km | DERIVED |
| Jitter | **0** (the BOEM points sit on the lattice to 0.00005 m) | DERIVED (site-environment §4.3) |
| Spacing in rotor diameters | 4.7 D along rows, 7.8 D between rows | DERIVED (1111.6/236, 1852/236) |
| Rows (turbine lines) | ENE–WSW | SOURCED [7] |
| Met tower | ≤1, ≤180 m AMSL; position not published. Omit | SOURCED [7] |

### 5.1 Marine-light classes on the lattice (feeds §13.2)

The rule is ESTIMATED, applying [12][13] to the lattice. The counts are DERIVED.

| Class | Definition | Count |
|---|---|---|
| **SPS** (significant peripheral structure) | Perimeter turbines missing at least one ±a neighbour **and** at least one ±b neighbour (corners). Add more SPS on straight edges wherever two consecutive SPS would be more than 3 nm (5,556 m) apart | **24** corners (the hero is one), before any additions |
| **IPS** (intermediate peripheral structure) | Every other perimeter turbine (missing any of the four neighbours) | 32 |
| Inner boundary | Not on the perimeter, but next to a perimeter turbine | 42 |
| Interior | The rest | 102 |

---

## 6. SUBSTATION

| Item | Value | Tag |
|---|---|---|
| Type | ASOW **Large OSS**: topside **50 × 90 m** (plan), **40 m** tall above the foundation interface. Topside top at **63.3 m MLLW = +62.6 m MSL**, so the interface is at +22.6 m MSL | SOURCED [8] (site-environment §4.5); DERIVED with §3.2 |
| Foundation | 8-leg piled jacket, legs **yellow up to +16 m** | Legs SOURCED [8]; paint ESTIMATED (turbine rule) |
| Position | On the hero's row, midway between di = 12 and 13: **(13706.9, 0, −2275.3)**. It is 26.5 km from shore; the minimum for a large OSS is 21.7 km [7] | Row rule SOURCED [7]; the pick is ESTIMATED; distances DERIVED |
| Orientation | Long (90 m) axis perpendicular to the rows (bearing 170.6°/350.6°), so the reference camera sees it nearly broadside | ESTIMATED |
| In the reference frame | x ≈ 723; top y 207.8 (0.4 px above the horizon); waterline y 212.0; about **5.5 px wide**; 14.6 km from the camera | DERIVED (C27) |
| Look | Light grey clad box (RAL 7035); crane and helideck on one corner; 2–4 decks. In the photo: lit face #f4e5d0, shaded face #a6aebb | ESTIMATED form; colours SOURCED (px) [1] |
| Aviation lights | Steady red **L-810 (32 cd)** at the 4 top corners (+62.6 m), plus 4 more at an intermediate level (+31 m) | Rule SOURCED [11 §5.7]; intensity SOURCED [11 Table B-1]; heights DERIVED |
| Marine lights | Two yellow lanterns at +20 m, with the character of its lattice class (interior, Fl Y 15 s) | ESTIMATED |

---

## 7. CAMERA_PRESETS

All positions are relative to the hero at MSL. **Rotation order 'YXZ'**: rotation.y = −heading, rotation.x = pitch.

| Preset | Position (x, y, z) m | Heading °T | Pitch ° | vFOV ° | Notes | Tag |
|---|---|---|---|---|---|---|
| **drone (reference)** | **(−649.5, 127.5, 420.9)** | **58.50** | **−3.209** | **31.40** | rotation (−0.05601, −1.02102, 0) rad. A lookAt target 1 km ahead is (201.8, 71.6, −100.8). **Render 3:2** for the photo comparison; at 16:9 keep the vFOV (hFOV becomes 53.1°). Near 0.5 m, far 60 km | DERIVED (`cam.py`, `final.py`); near/far from three-r180-api §11 |
| deck (CTV) | (5.5, 4.0, −15.0): a CTV bow on the hero landing, eye 16 m from the TP axis toward 20°T | 200.0 | +30 | 60 | Looking up at the TP and tower | ESTIMATED (foredeck 2.2 m + eye 1.7 m) |
| nacelle | (3.5, 160.1, −9.4): heli-hoist deck, 10 m aft of the tower axis | 58.5 | −10 | 50 | Looks across the farm, rotor behind-right | DERIVED from §4.2 / §4.4 |
| blitz | (−180, 25, 120) | 57 | −12 | 45 | Low drone near the hero; `blitz.focus()` overrides the target | ESTIMATED |
| overview | (−2830, **900**, 2830): 4 km SW of the hero | 50 | −10 | 45 | **Below the 1100 m cloud base** (C22); sea mesh ≥110 km | ESTIMATED |
| cinematic | Orbit about the hero: radius 700–800 m, altitude 90–150 m, 0.5 °/s (≈6.5 m/s), 120 s loop, starting at the drone preset | – | – | 31.4 → 40 | – | ESTIMATED |

**Reference view: what the frame contains** (760 × 506, f = 900 px; DERIVED, `detail.py`, `final.py`):
- 80 turbines in frame: 6 within 5 km, 19 within 10 km, 42 within 15 km, 66 within 20 km.
- **No turbine lies behind the camera within 3 km**, so the camera is just outside the array corner, as it was in the photo.
- **No vessels in frame** (the photo shows none).

---

## 8. SUN and default time

| Quantity | Value | Tag |
|---|---|---|
| Default date and time | **2026-06-21, 16:30 EDT** (SimClock: month 6, day 21, hours 16.5) | DERIVED to match C12 |
| Sun azimuth / elevation (refracted) | **266.59° / 42.97°** | DERIVED (NOAA algorithm [31], `sun.py`) |
| Direction toward the sun (x, y, z) | **(−0.7304, 0.6817, 0.0435)** | DERIVED |
| Relative to the camera heading | 208.1°: behind the camera, 28° to its left | DERIVED |
| Neighbouring times on 21 June | 16:00: 261.2° / 48.7°. 16:15: 264.0° / 45.9°. 16:45: 269.1° / 40.1° | DERIVED |
| Sun angular radius | 0.004675 rad (0.268°) | SOURCED [22] |
| Shadows | Hard. The platform shadow line in the photo is 1 px | SOURCED (px) [1] |

---

## 9. ATMOSPHERE (physically based: Rayleigh + Mie + ozone)

| Parameter | Value | Tag |
|---|---|---|
| Planet / top of atmosphere radius | 6,360 km / 6,420 km (ARCHITECTURE allows a 100 km top) | SOURCED [22] |
| Rayleigh scattering at sea level, R/G/B (680/550/440 nm) | **(5.802, 13.558, 33.100) × 10⁻⁶ m⁻¹** (= 1.24062 × 10⁻⁶ · λ[µm]⁻⁴) | SOURCED formula [22]; DERIVED values |
| Rayleigh scale height | 8,000 m | SOURCED [22] |
| **Aerosol (Mie) extinction at sea level, R/G/B** | **(86.1, 106.4, 133.1) × 10⁻⁶ m⁻¹** | DERIVED: σ_total(550) 1.2 × 10⁻⁴ − Rayleigh 1.356 × 10⁻⁵ = 1.064 × 10⁻⁴, spread with Ångström exponent 1.0 |
| Ångström exponent near the surface | 1.0 | ESTIMATED: between the column value 1.58–1.64 (NJ AERONET [28]) and clean-marine coarse aerosol |
| Aerosol single-scattering albedo | 0.95 (Bruneton's default is 0.9) | ESTIMATED: coastal summer aerosol |
| Mie phase asymmetry g | 0.80 | SOURCED default [22]; ESTIMATED suitable |
| Mie scale height | 1,200 m | SOURCED [22] (C10) |
| Aerosol optical depth at 550 nm | **0.128** (NJ JJA: p10 0.07, median 0.166, p90 0.37) | DERIVED; range SOURCED/DERIVED [28] |
| Ozone absorption peak, R/G/B | **(0.650, 1.881, 0.085) × 10⁻⁶ m⁻¹**. Tent profile: 0 at 10 km, peak at 25 km, 0 at 40 km | SOURCED [22] (300 DU × cross-sections) |
| Ground (sea) albedo for multiple scattering | 0.06 | ESTIMATED (site-environment §8.1: 0.06–0.10) |
| **Horizontal visibility** | 3.912/σ = **32.6 km** | DERIVED [44] |

### 9.1 Aerial perspective on geometry (`applyAerialPerspective`)

| Parameter | Value | Tag |
|---|---|---|
| `uFogDensity` (extinction per metre at sea level, luminance) | **1.2 × 10⁻⁴** | DERIVED (C9) |
| Per channel (if implemented) | **(9.19, 12.00, 16.62) × 10⁻⁵ m⁻¹** R/G/B | DERIVED (Rayleigh + Mie above) |
| `uFogHeightFalloff` | **1/1200 = 8.33 × 10⁻⁴ m⁻¹**. Rayleigh (1/8000) is negligible over these paths | SOURCED [22] |
| In-scatter colour | The sky radiance at the horizon in the view azimuth, plus a Mie lobe toward the sun. **Check value:** it must display as **#e5ecf5** (exposed (0.98, 1.44, 2.56)) | DERIVED (C11) |
| Transmittance check (reference view) | Hero (774 m) 0.91; (1,0) at 1.85 km 0.80; (2,0) at 2.95 km 0.70; (5,0) at 6.3 km 0.47; 10 km 0.30; 20 km 0.09 | DERIVED |
| Apply to the sky dome? | No. The sky has its own model | SOURCED advice (photo-look §6.3) |

---

## 10. CLOUDS (one layer, per ARCHITECTURE)

| Parameter | Value | Tag |
|---|---|---|
| Base altitude (`uCloudAltitude`) | **1,100 m** | DERIVED: ACY JJA daytime median FEW/SCT/BKN base 3,700 ft = 1.13 km, IQR 0.67–1.68 km [30] (C22) |
| Thickness (`uCloudThickness`) | **300 m** | ESTIMATED: the photo's bases are only ≈20 % darker than its tops (thin clouds) |
| Cover (`uCloudCover`) | **0.28** | SOURCED (px): 25–30 % of the visible sky [1] |
| Cover against elevation (photo) | 10–12.6°: 0.18; 7.8–10.2°: 0.30; 5.3–7.8°: 0.17; 2.8–5.3°: 0.13; below 2.8°: ≈0.03 | SOURCED (px) [1] |
| Shapes | Flat-bottomed cumulus humilis puffs, 1.2–2 km across, plus elongated stratocumulus streaks. Horizon compression must come from perspective, not painted stripes | ESTIMATED from photo-look §8 |
| Photo cloud colours (display / exposed) | Tops #efeef1 (exposed luminance 1.63); bases #cedaeb (exposed 0.78). Base/top ≈ 0.48 in scene-linear | SOURCED (px) / DERIVED (`aces.py`) |
| Optical depth | Puffs τ ≈ 2–6, edges fade over 100–200 m | ESTIMATED |
| Drift (`uCloudOffset` rate) | 8 m/s from 225°T, i.e. (+5.66, −5.66) m/s in (x, z) | ESTIMATED: summer SW flow aloft; power law 4.5·(1100/10)^0.14 = 8.7 m/s |
| Optional high streak layer | Thin cirrostratus at 7 km, τ ≈ 0.05, visible only 1–8° above the horizon | ESTIMATED (site-environment §8.4) |

---

## 11. SEA

### 11.1 Wind and waves

`ocean.setSeaState({ windSpeed: 4.5, windFromDeg: 200.5, swellHs: 0.45, swellFromDeg: 160, swellPeriod: 7.5 })`

| Quantity | Value | Tag |
|---|---|---|
| U10 | **4.5 m/s** from **200.5°T**. `U.uWind` (vector toward) = **(+1.58, −4.22)** m/s; `U.uWindSpeed` 4.5 | ESTIMATED (C20, C21) |
| Physical fetch toward 200.5° | ≈375 km, to the Outer Banks near 36.0 N 75.7 W. The sea is fetch-unlimited and duration-limited | DERIVED (ray trace, rough coastline) |
| Fully developed PM wind sea at U10 4.5 (U19.5 = 4.76) | Hs 0.48 m, Tp 3.48 s, λp 18.9 m | DERIVED [25]: Hs = 0.21U²/g, ωp = 0.877g/U |
| JONSWAP at an effective fetch of 50 km | α = 0.00825, ωp = 1.658 rad/s, **Tp 3.79 s, λp 22.4 m**; the integrated Hs of 0.72 m exceeds the PM cap | DERIVED [25]: α = 0.076(U²/Fg)^0.22, ωp = 22(g²/UF)^(1/3), γ = 3.3 |
| **Wind-sea target** | **Hs 0.50 m, Tp 3.8 s, λp 22 m, cp 5.9 m/s, γ = 3.3.** Directional spread cos^(2s) with **s = 3** (short-crested, nearly isotropic, as in the photo). Travels toward 20.5°T | ESTIMATED: the JONSWAP peak with energy capped near PM; the photo's 25–30 m component rescaled to H = 83 is 23–28 m |
| **Swell target** | **Hs 0.45 m, Tp 7.5 s, from 160°T**, γ = 3.3, s = 15. **λ 82.0 m, c 10.9 m/s at 22 m depth** (88 m in deep water) | Hs/Tp/direction ESTIMATED from site-environment §6.4 (NDBC [27]); λ DERIVED (linear dispersion) |
| Total Hs | 0.67 m. NJ summer p10–median is 0.55–0.91 m, so this is a calm-side day | DERIVED [27] |
| Short detail (normal map only) | 0.02–6 m wavelengths aligned with the wind. The photo's near-field texture peaks at 6.4–7.4 m (T ≈ 2.0 s) | DERIVED (photo-look §7 × 83/90) |
| Slicks and cat's-paws | Roughness modulation of ±12 %, patches 50–170 m across | SOURCED (px) / DERIVED [1] |
| Whitecaps | Monahan: W = 3.84 × 10⁻⁴·U10^3.41 %, giving **0.065 %** at 4.5 m/s. **Render onset: 5.0 m/s**, so the reference view shows none | SOURCED formula [26]; onset ESTIMATED to match the photo |
| Foam at the piles | A thin wash ring, 0.5–1.5 m wide, that rises and falls with the waves | ESTIMATED |
| Near-field wave faces | In the photo, p90/p10 luminance contrast exceeds 10 near the camera, 1.3 at the horizon | SOURCED (px) [1] |

### 11.2 Water optics

| Quantity | Value | Tag |
|---|---|---|
| Refractive index for Fresnel | 1.333 | SOURCED (photo-look §6.2) |
| Effective sky reflectance | 0.55–0.75 × flat-water Fresnel, from roughness slope averaging | DERIVED (photo-look §6.2) |
| Absorption σa, R/G/B | **(0.35, 0.077, 0.075) m⁻¹** | ESTIMATED from DERIVED OC-CCI IOPs [29] (site-environment §7.4) |
| Backscatter σb, R/G/B | **(0.0028, 0.0038, 0.0055) m⁻¹** | same |
| Upwelling (water-leaving) reflectance π·Rrs | **lin (0.0019, 0.0087, 0.0118)** × downwelling irradiance. Hue normalised (0.16, 0.73, 1.00); sRGB of 4× that is #15343d | DERIVED [29] (FU class 4, C19) |
| Submerged yellow paint | Turns green-grey by 3 m depth. Transmittance at 1/3/6 m: R 0.70/0.35/0.12, G 0.93/0.79/0.63, B 0.93/0.80/0.64 | DERIVED (site-environment §7.4) |

**Photo sea targets** (display sRGB → exposed values for ACES; DERIVED, `aces.py`):

| Where | Display hex | Display-linear | Exposed (luminance) |
|---|---|---|---|
| Horizon band (row 209) | #b5cfe4 | (0.464, 0.623, 0.778) | (0.32, 0.61, 1.09); Y 0.58 |
| About 1 km | #79a0c3 | (0.191, 0.352, 0.546) | (0.14, 0.28, 0.50); Y 0.27 |
| Near camera, mean | #33475c | (0.033, 0.063, 0.107) | (0.05, 0.08, 0.11); Y 0.074 |
| Near-camera troughs / lit facets | #000a1a / #57708a | – | reached through the grade toe (§12) |

Luminance falls with depression angle as Y ≈ 0.586·exp(−0.134·depression°), within ±25 %. SOURCED (px) / DERIVED (photo-look §6.2).

---

## 12. LOOK (tone mapping, exposure, grade)

### 12.1 Operator and exposure

| Item | Value | Tag |
|---|---|---|
| Tone mapping | **ACESFilmicToneMapping** (r180 RRT/ODT fit, ×exposure/0.6), applied once in OutputPass | SOURCED code [32]; choice from three-r180-api §3.2 (keeps the TP yellow) |
| **Exposure rule** | `exposure = 1.43 / Y(L_horizon)`, where L_horizon is the sky radiance 0–1.5° above the horizon in the view azimuth | DERIVED: the ACES inverse of #e5ecf5 has exposed luminance 1.425 |
| Sanity band for Y(L_horizon)/E_sun | 0.08–0.16 sr⁻¹ (sun elevation 43°, AOD 0.13). Outside this band, the sky and sun units disagree | ESTIMATED from three-r180-api §5.3/§8 (Sky.js fit ≈0.14) and typical clear-sky luminances |
| Scene units, for night lights | Treat **1 scene illuminance unit ≈ 25,000 lx**, so a radiance of 1 ≈ 25,000 cd/m² (matches ARCHITECTURE's sun ≈ 3–5 at noon for 75–125 klx) | ESTIMATED |
| Night | Auto-exposure driven by `U.uExposureHint`, up to about 3 × 10⁴× the day value | ESTIMATED |

### 12.2 Exposed targets (values into ACES before its /0.6; inverted from photo pixels with the r180 matrices)

| Target | Photo display | Exposed RGB | Exposed Y |
|---|---|---|---|
| Horizon haze / airlight | #e5ecf5 | (0.98, 1.44, 2.56) | **1.43** |
| Sky at the top of frame (12.6°) | #9fcaeb | (0.17, 0.55, 1.41) | 0.53 |
| Sky at 10° | #b2d5f2 | (0.21, 0.69, 2.00) | 0.68 |
| Tower lit | #fcfcfb (clipped) | ≥ (5.9, 6.0, 4.8) | ≥ 5.9 |
| Tower shade limb | #6a7687 | (0.13, 0.16, 0.21) | 0.16 |
| Nacelle underside | #afb4bb | (0.35, 0.38, 0.43) | 0.37 |
| TP lit / shade | #f8eb89 / #be9d24 | (2.22, 1.34, 0.00) / (0.44, 0.27, 0.01) | 1.43 / 0.29 |
| Cloud top / base | #efeef1 / #cedaeb | (1.68, 1.59, 1.91) / (0.54, 0.78, 1.42) | 1.63 / 0.78 |

All DERIVED (`aces.py`; the ACES constants were checked against the r180 source [32]).

**Expected shortfalls.**
- A physically plausible horizon (blue/red ≈ 1.35) tone-maps to **(232, 236, 238)**, against the photo's (229, 236, 245), because ACES desaturates bright blues. If the render reads too grey, add +10 % saturation to highlights in the grade. Do not push the sky model.
- A lit RAL 7035 tower tone-maps to **242–245**, against the photo's 252. Accept this; the photo's own curve clips harder than ACES.
- DERIVED (`aces.py`).

### 12.3 Grade (reference preset)

| Item | Value | Tag |
|---|---|---|
| Vignette | **0** | SOURCED (px): none measurable [1] (C23) |
| Grain | ≤ 0.5/255 triangular dither only | SOURCED (px): noise 0.6–1.2 levels [1]; dither advice from three-r180-api §3.3 |
| Black toe | Subtract 0.003 display-linear and clamp, so troughs reach #000a1a (0.5 % of pixels below luma 6.4) | ESTIMATED to reproduce the SOURCED (px) crush [1] |
| Sharpening | Optional 1 px unsharp mask, 5 % | SOURCED (px) [1] |
| White balance | Neutral: sunlit whites have no cast | SOURCED (px) [1] |
| Bloom | Threshold in linear HDR ≥ 2 × Y(L_horizon)·exposure, so only lights and glints bloom. The reference view has no glint | ESTIMATED (three-r180-api §3.5) |

### 12.4 Hero shadow frustum

- Orthographic box of **±190 m**, near 1 m, far 1400 m, map size 4096. That gives 0.093 m texels.
- DERIVED: the V236 hero's bounding sphere, rotor ±120 m and height 0–270 m, has radius ≈181 m. three-r180-api's ±160 m was sized for a smaller turbine.

---

## 13. NIGHT_LIGHTS

### 13.1 Aviation lights (FAA AC 70/7460-1N; BOEM 2021)

| Light | Count and position | Intensity | Character | Tag |
|---|---|---|---|---|
| **L-864** red | 2 per turbine, on opposite sides of the nacelle roof, y 159.4. **Every turbine** is lit | **2,000 cd (±25 %)** | Flashing **30 fpm** (2.0 s period), on for 0.5 s with fast LED edges. **Synchronised farm-wide to ±0.05 s** (flash starts when t mod 2.0 = 0) | Rule, rate and sync SOURCED [11 §13.5–13.6][12]; on-time ESTIMATED |
| **L-810 F** red | **4 per turbine** at y 79.2, spaced 90° around the tower (Ø there ≈ 8.8 m > 6.1 m) | **32 cd** | Flashing in unison with the L-864s | SOURCED [11 §13.7.3–13.7.4, Table B-1] (C18) |
| Vertical beam | Full intensity at ≥ −1° elevation, falling linearly to 3 % at −10°, 1 % below that ("not visible below their horizontal plane" to mariners) | – | – | Shielding SOURCED [12]; the profile is ESTIMATED |
| ADLS | Real NJ proposals are lit only when an aircraft is within 3 nm, so a quiet night can be dark. **Default: lights ON**, with a UI toggle for ADLS behaviour | – | – | SOURCED [11 §10.2][20]; default ESTIMATED (art direction) |
| Lamp sizes (sprite core) | L-864 lens Ø 0.30 m; L-810 Ø 0.15 m; marine lantern Ø 0.20 × 0.30 m tall. Radiance = I / (lens area × 25,000) in scene units (§12.1) | – | – | ESTIMATED |

### 13.2 Marine lights (yellow; USCG NVIC 03-23, BOEM 2021; classes from §5.1)

| Class | Character | Range | Minimum intensity | Tag |
|---|---|---|---|---|
| SPS | **Q Y**: 0.3 s on / 0.7 s off, all SPS synchronised | 5 nm | **52 cd** | Character and range SOURCED [12][13]; intensity DERIVED from the Annex I formula [23] |
| IPS | **Fl Y 2.5 s**: 1.0 s on / 1.5 s off, synchronised | 3 nm | **12 cd** | same |
| Inner boundary | Fl Y 6 s (1 s on) | 2 nm | **4.3 cd** | same; on-time ESTIMATED |
| Interior | Fl Y 15 s (1 s on) | 1 nm | **0.9 cd** | same |
| Placement | 2 lanterns per structure on opposite sides, y 20.5, same horizontal plane | – | – | SOURCED [16] (§4.2) |
| Hours | Sunset to sunrise, and in poor daytime visibility | – | – | SOURCED [12] |

- **Intensity formula (Annex I §8).** I = 3.43 × 10⁶ × T × D² × K⁻ᴰ, with T = 2 × 10⁻⁷ lx and K = 0.8. For 1–6 nm this gives 0.9 / 4.3 / 12 / 27 / 52 / 94 cd. SOURCED [23].
- **IALA's aids-to-navigation variant** (K = 0.74) gives 1.2–1.5× higher values. ESTIMATED.
- **The hero is an SPS.**

---

## 14. VESSELS

| Item | CTV (crew transfer vessel) | SOV (service operation vessel) | Tag |
|---|---|---|---|
| Model | StratCat-27-class aluminium catamaran | ECO Edison / ECO Liberty class | SOURCED [36][37][38] |
| Length × beam × draft | **27.0 × 8.9 × 1.5 m** | **80 × 19 m** (262 × 62 ft); draft ≈6 m | SOURCED [36][38]; SOV draft ESTIMATED |
| Speed | Service 24–26 kn. Default 22 kn (11.3 m/s) in transit, <5 kn on the final approach | Holds position on dynamic positioning (DP) | SOURCED [36] / ESTIMATED |
| Heights above the waterline | Foredeck 2.2 m; wheelhouse roof 6.5 m; **masthead light ≥ 8.9 m above the hull, so ≈11 m** | Main deck ≈5 m; accommodation and bridge to ≈22 m; gangway tower amidships, top ≈25 m; mast ≈30 m | Masthead height DERIVED from Annex I §2(a)(i) [23] (beam 8.9 m > 6 m); the rest ESTIMATED |
| Livery | White superstructure; blue hull band with teal stripe; black bottom; **black rubber bow fender** (0.5 m thick, 3 m wide) | **Dark navy hull**, white superstructure, white gangway and elevator tower, orange rescue boat | SOURCED (photos in [37][38]); fender size ESTIMATED |
| Nav lights: masthead | White, 225° arc, **5 nm = 52 cd** | 2 white lights, 225°, **6 nm = 94 cd**. Forward one ≥12 m above the hull (cap); aft one ≥4.5 m higher | SOURCED [23][24] |
| Nav lights: sidelights | Red (port) / green (starboard), 112.5° each, **2 nm = 4.3 cd**, ≤ ¾ of the masthead height above the hull | 3 nm = 12 cd | SOURCED [23][24] |
| Nav lights: sternlight | White, 135°, 2 nm = 4.3 cd | 3 nm = 12 cd | SOURCED [24][23] |
| On DP / gangway | – | Restricted-manoeuvrability lights: **red-white-red all-round**, stacked vertically, 3 nm = 12 cd. By day: ball-diamond-ball shapes | SOURCED Rule 27(b) [24] |
| Deck floodlights at night | Wheelhouse glow only | Several warm-white floods on the deck and gangway | ESTIMATED |
| Default placement | Transiting from Atlantic City (bearing 302.7° from the hero) and shuttling between turbines. **Out of the reference frame** | On station at SPS turbine (8, +6), 13.4 km SE of the hero, upwind side. Out of frame | ESTIMATED |
| Wake | Foam trail 100–300 m long. Kelvin half-angle ≤19.47° (arcsin 1/3); at planing speed the visible angle narrows to about 10–15° | ESTIMATED (site-environment §10.1); 19.47° SOURCED physics |

---

## 15. LIFE (wildlife and fish-blitz modules)

| Species | Size | Look / behaviour | Tag |
|---|---|---|---|
| Herring gull | Wingspan 1.20–1.55 m | Pale grey mantle, black tips; rests on TP railings | SOURCED (site-environment §10.2) |
| Laughing gull | Wingspan 0.98–1.10 m | Dark grey mantle, black summer hood; the commonest summer bird near shore | SOURCED (site-environment §10.2) |
| Common tern | Length 31–35 cm; **wingspan 0.77–0.98 m** | Pale grey above, black cap, red bill and legs; hover-dives | SOURCED [39] |
| Northern gannet | Wingspan 1.70–1.80 m | White with black tips; plunge-dives from 10–30 m; rare in summer (spring and fall) | SOURCED (site-environment §10.2) |
| Striped bass | Typically **0.50–0.90 m**, 2–9 kg | Silvery with dark lengthwise stripes | SOURCED [39] |
| Bluefish | 0.18 m ("snappers") to about 1 m, up to 14 kg | Blue-green back, white belly; "bluefish blitz" churning the water | SOURCED [39] |
| False albacore (little tunny) | Up to about 0.90 m fork length (Atlantic) | Metallic blue-green with wavy dorsal stripes, dark spots below the pectoral fin | SOURCED [39] |
| Atlantic bluefin tuna | Adults **2–2.5 m**, 225–250 kg | Dark blue above, grey below, yellow finlets | SOURCED [39] |
| Atlantic menhaden (bait) | Adults up to about 0.38 m (15 in); juvenile "peanut bunker" is smaller | Silvery, black shoulder spot, large schools | SOURCED [39]; juvenile size ESTIMATED |
| Flight heights | Gannets: median 12 m commuting, 27 m foraging. 4.8 % of birds fly in the rotor zone | – | SOURCED (site-environment §10.2) |
| Reference view | No birds or blitz in frame (the photo shows none) | – | SOURCED (px) [1] |

---

## 16. Land on the horizon (non-reference views)

The hero is 17–20 km from the casino strip. That is inside the 40 km sea horizon from 127.5 m, and even from a 4 m CTV eye only about 8 m of the towers is hull-down. At σ = 1.2 × 10⁻⁴, a tower with inherent contrast 0.5 keeps an apparent contrast of 0.5·e^(−0.12·17.1) = **0.064**, above the 2 % threshold (DERIVED [44]). **Any view facing 290–310°T must show a faint skyline.** The reference view faces 58.5° and is unaffected.

| Landmark | Height | Position relative to the hero (x, z) | Distance / bearing | Tag |
|---|---|---|---|---|
| Ocean Casino Resort | **216 m** (219 m in the list) | (−14,236, −9,385) | 17.1 km / 303.4° | Height SOURCED [35][34]; position DERIVED from the SOURCED coordinates 39.36175 N, 74.41350 W |
| Borgata | **131 m** | (−16,097, −11,131) | 19.6 km / 304.7° | SOURCED [35]; DERIVED |
| Harrah's Waterfront Tower / Hard Rock North / MGM Tower | 160 / 140 / 140 m | Marina district, near Borgata (±1 km) | about 19.5 km / 304–306° | Heights SOURCED [34]; positions ESTIMATED |
| Boardwalk towers (Bally's, Caesars, Tropicana, Resorts and others, 77–120 m, about 12 buildings) | 77–120 m | A 3 km line from Ocean Casino south-west to about 39.348 N, 74.443 W | 17–18.5 km / 295–303° | Heights SOURCED [34]; line ESTIMATED |
| Jersey-Atlantic Wind Farm (5 onshore turbines) | 120 m tip | Near the Marina district | about 19 km / ≈305° | Height SOURCED [34]; position ESTIMATED |
| Low-rise coast and dune | 5–25 m | Coastline from about 280° to 015° | 17–35 km | ESTIMATED |

- **Look.** Blue-grey silhouettes at airlight contrast ≤ 0.1. They sit on the horizon line; below it is sea.
- **Distant coast.** Long Beach Island (31 km north) is below 2 % contrast (DERIVED) and can be omitted.

---

## 17. SCALE_TABLE (reference sizes for `registerScale`)

| Name | Axis | Metres | Tolerance | Tag |
|---|---|---|---|---|
| turbine.hubHeight | y | 152.0 | ±0.5 | DERIVED §4.1 |
| turbine.rotorDiameter | max | 236.0 | ±1.0 | SOURCED [4] |
| turbine.bladeLength | – | 115.5 | ±0.5 | SOURCED [4] |
| turbine.bladeMaxChord | – | 5.69 | ±0.3 | DERIVED §4.3 |
| turbine.towerBaseD / towerTopD | x | 10.0 / 7.5 | ±0.1 | SOURCED / ESTIMATED §4.5 |
| turbine.towerTopY | y | 146.4 | ±0.3 | DERIVED |
| turbine.tpD | x | 10.5 | ±0.1 | ESTIMATED |
| turbine.tpTopY / deckY / railTopY | y | 21.5 / 18.5 / 19.6 | ±0.2 | §4.2 |
| turbine.nacelle L × W × H | – | 19.0 × 9.0 × 11.0 (28.0 overall incl. spinner and deck) | ±0.5 | SOURCED (excerpt only) [6] / ESTIMATED split |
| turbine.spinnerD | – | 7.5 | ±0.3 | ESTIMATED |
| boatLanding.tubeD / spacing | – | 0.406 / 1.80 | ±0.02 | SOURCED [17] |
| substation.topside | x, z, y | 90 × 50 × 40 | ±1 | SOURCED [8] |
| ctv | length / beam | 27.0 / 8.9 | ±0.3 | SOURCED [36] |
| sov | length / beam | 80.0 / 19.0 | ±0.5 | SOURCED [38] |
| birds: herring gull / common tern / gannet wingspan | – | 1.40 / 0.85 / 1.75 | ±0.15 / ±0.1 / ±0.1 | SOURCED ranges |
| fish: striped bass / bluefish / false albacore / bluefin | – | 0.7 / 0.6 / 0.8 / 2.2 | ±0.2 / ±0.3 / ±0.15 / ±0.3 | SOURCED ranges [39] |
| lattice.a / lattice.b | – | 1111.56 / 1865.88 | ±0.5 | DERIVED §5 |

---

## 18. Other ARCHITECTURE-facing notes

- **`src/shared.js` placeholders to update (for the lead).** `uFogDensity` 1.2e-4. `uFogHeightFalloff` 1/1200. `uCloudAltitude` 1100. `uCloudThickness` 300. `uCloudCover` 0.28. `uWindSpeed` 4.5. `uWind` (1.58, −4.22). (C29)
- **Caption text.** "Vestas V236-15.0 MW on the Atlantic Shores South layout (as permitted, not built) — 1,111 m in-row × 1,852 m between rows — 17 km off Atlantic City". The spacings are DERIVED.
- **Depth range for the renderer.** Near 0.5 m, far 150 km (the overview needs 110 km). Use a logarithmic or reversed depth buffer, as three-r180-api §11 describes.

---

## 19. Alternate turbine switch: Siemens Gamesa SG 11.0-200 DD (closer to the photo's silhouette)

To use this machine instead, change only these values; everything else stays.

| Parameter | Value | Tag |
|---|---|---|
| Rotor / blade / hub height | 200 m / 97 m / **133 m** (Revolution Wind) | SOURCED (turbine-specs [S23][S25]) |
| Reference camera | h **111.3 m**, hero distance **677 m**, pitch **−3.185°**; heading and vFOV unchanged | DERIVED (`cam.py`) |
| Tower base / top diameter | 8.0 / 5.5 m | ESTIMATED (turbine-specs §4.4) |
| TP diameter | 8.5 m | ESTIMATED |
| Nacelle | Box 12 × 8 × 8.5 m, direct-drive generator ring Ø 8.8 × 2.5 m, spinner Ø 6.6 m | ESTIMATED (turbine-specs §4.3) |
| rpm at the default wind | 9·U_hub/100·9.549 with U_hub = 4.5·(13.3)^0.14 = 6.47 m/s, so 5.6 rpm | DERIVED |
| Blade table | turbine-specs §4.2 | DERIVED |

With this machine the in-row spacing of 1,111.6 m is 8.36 H. That matches the photo's 8.5 H.

---

## 20. PHOTO TARGET CHECKLIST (render the drone preset at 760 × 506 and compare)

The pixel numbers are DERIVED for the V236 build (`final.py`, `rotor.py`). Each item says where the build is expected to differ from the photo **by design**.

1. **Horizon on row 208.25 ± 1**, level to ≤1 px across the frame. (Same as the photo.)
2. **Hero waterline at (357.5, 350) ± 2. Hub at (366, 174) ± 2** (photo: (362, 174)).
3. **Rotor.** Tip path spans x 247–474 and y 32–314, width/height **0.80** (photo 0.79). The disc is **37°** off the view axis (photo 38°).
   - With phase 50°, the tips fall at **(446, 91), (400, 309), (253, 117)** (photo: (432, 97), (397, 287), (274, 124)).
   - The tip radius is about 137 px against the photo's 120. **By design:** R/H is 0.78 here and 0.68 in the photo.
4. **Hero vertical stack** (rows).

   | Level | Build row | Photo row |
   |---|---|---|
   | Marine band top | 347.9 | 345 |
   | Yellow visible up to (skirt bottom) | 330.5 | 312 |
   | Deck | 328.8 | – |
   | TP top / tower base | 325.3 | 298 |
   | Tower top | 180.5 | 176.5 |
   | Nacelle roof | 166.4 | 169 |

   **By design:** the yellow band is 0.10 of the waterline-to-hub height, against 0.19 in the photo, because the TP is the same absolute size under a 1.8× taller turbine.
5. **Widths.** TP about **12 px**, tower base about **11.6 px**, tower top about **8.7 px** (photo: 10 / 9.5 / 7).
6. **Blades are solid light grey** (US). On the faces away from the sun they read grey-slate (#9ba7b2 to #56627a). The tip bands appear **only** with `photoLook`, in which case they read near-black maroon (#33090f to #3d1b28).
7. **Right-hand row.**

   | Turbine | Build | Photo |
   |---|---|---|
   | (1,0) | (578, 266) | (581, 262) |
   | (2,0) | (639, 243) | (634, 240) |
   | (3,0) | (667, 233) | (660, 230) |
   | (4,0) | (684, 226) | (674.5, 223.5) |
   | (5,0) | (695, 222) | (682.5, 221) |

   **Left and centre:** (2,−1) at (183, 234), (3,−1) at (305, 227), (4,−1) at (383, 223).

   **By design:** the photo's near-left T97/T46 have no counterpart (ASOW rows are 1.0 nm apart). The frame holds **19 turbines within 10 km** and 80 in total, fading into the haze.
8. **Substation.** A small grey box straddling the horizon at **x ≈ 723**: top at y 207.8, waterline at y 212, about 5.5 px wide, lit on its left face (photo: 10 × 5.5 px at x 736–745). **By design:** no NJ OSS is as large as the photo's converter platform.
9. **Everything is lit from the left.** The sun is 208° relative, at 43° elevation. On the hero tower the terminator is near the right limb. The shade limb is about #6a7687 ± 25 levels.
10. **No sun glitter** anywhere. The brightest water is the band just below the horizon (display Y ≈ 0.60).
11. **Sea luminance.** #b5cfe4 at the horizon, #79a0c3 at about 1 km, #33475c mean near the bottom edge. It follows Y ≈ 0.586·exp(−0.134·depression°) within ±25 %. The bottom-left is about **2× brighter** than the bottom-right, because it reflects the cumulus.
12. **Near-field facets.** Troughs toward #000a1a (via the grade toe) and facets about #57708a; p90/p10 contrast above 10.
13. **Waves.** Wind sea λp ≈ 22 m travelling to −38° relative (away-left), short-crested; near texture 6–7 m; swell at 82 m barely visible; **no whitecaps**; slicks ±12 %.
14. **Sky.** #9fcaeb at the top edge, #b2d5f2 at 10°, **#e5ecf5 in the 0–1.5° band**, following Y(el) ≈ 0.828 − 0.0031·el − 0.00154·el² within ±0.03 (photo-look §6.1). **Allowed deviation:** the horizon may be up to 7 levels less blue (§12.2).
15. **Clouds.** Cumulus puffs in the top third (tops #efeef1, bases #cedaeb) plus streaks at 3–8°. Cover **25–30 %**; the 0–2° band is nearly clear.
16. **Haze.**
    - TP chroma at (2,0), 2.95 km, is about **0.77×** the hero's from extinction alone. Pixel mixing at 760 px pushes it toward the photo's 0.65–0.70.
    - Turbines at 5–6 km are clearly visible (T ≈ 0.5); those at 20 km are ghosts (T ≈ 0.09).
17. **Reflections.**
    - The hero's reflection is short and dark (#40361e, about 0.6× the TP height).
    - Far TP reflections are vertical, pale yellow-white streaks, **1.5–2.5×** the TP height.
18. **Grade.**
    - Sunlit whites at 242–252.
    - Blacks slightly crushed.
    - Neutral white balance.
    - **No vignette.**
    - At most 1 px, 5 % sharpening.
    - No vessels or birds in frame.

---

## 21. Sources

Research files cited by section (secondary): `research/turbine-specs.md`, `research/site-environment.md`, `research/photo-look-targets.md`, `research/three-r180-api.md`.

1. Reference photo `reference/ref-1.png`, read as pixels. The method is in photo-look-targets.md.
2. Wikimedia Commons, "Borkum Riffgrund 1.jpg" — https://commons.wikimedia.org/wiki/File:Borkum_Riffgrund_1.jpg
3. Wikipedia (de), "Offshore-Windpark Borkum Riffgrund" (BR1: 78 × SWT-4.0-120, hub ≈83 m, tip ≈142 m; read this session) — https://de.wikipedia.org/wiki/Offshore-Windpark_Borkum_Riffgrund
4. Vestas, V236-15.0 MW product page — https://www.vestas.com/en/energy-solutions/offshore-wind-turbines/V236-15MW
5. Empire Wind, Technology page (tip 886 ft / 270 m) — https://www.empirewind.com/about/technology/
6. Windpower Monthly, "Exclusive: How Vestas beat rivals to launch first 15MW offshore turbine" (excerpt only) — https://www.windpowermonthly.com/article/1706924/exclusive-vestas-beat-rivals-launch-first-15mw-offshore-turbine
7. BOEM, Atlantic Shores South PDE fact sheet (read in full this session: 105–136 + 64–95 WTGs; rotor ≤280 m; hub ≤175 m; tip ≤319 m; lowest tip 23.1 m; OSS rows rule; OSS minimum distances from shore) — https://boem.gov/sites/default/files/documents/renewable-energy/state-activities/AtlanticShoresSouth_PDE.pdf
8. BOEM, Atlantic Shores South DEIS Appendix C (OSS sizes, nacelle envelope, tower maximum) — https://www.boem.gov/sites/default/files/documents/renewable-energy/state-activities/AtlanticShoresSouth_AppC_PDE%20and%20Max-Case%20Scenario_DEIS.pdf
9. BOEM, Offshore Wind – Proposed or Installed Turbine Locations (FeatureServer), extracted to `research/asow-south-wtg-positions.csv` — https://services7.arcgis.com/G5Ma95RzqJRPKsWL/arcgis/rest/services/Offshore_Wind_-_Proposed_or_Installed_Turbine_Locations/FeatureServer
10. IEA Wind TCP Task 37, IEA-15-240-RWT windIO YAML — https://raw.githubusercontent.com/IEAWindSystems/IEA-15-240-RWT/master/WT_Ontology/IEA-15-240-RWT.yaml
11. FAA AC 70/7460-1N, 11 Aug 2026 (§5.5, §5.7, §10.2, §13.5–13.7, §13.10, Table B-1; re-read this session from the team's text copy) — https://www.faa.gov/documentLibrary/media/Advisory_Circular/2026-07-13_AC_70_7460-1N_Obstruction_Marking_and_Lighting_FINAL_CLEAN.pdf
12. BOEM, *Guidelines for Lighting and Marking of Structures Supporting Renewable Energy Development*, 2021 — https://www.boem.gov/sites/default/files/documents/renewable-energy/2021-Lighting-and-Marking-Guidelines.pdf
13. USCG NVIC 03-23 (mariner guidance copy) — https://www.crmc.ri.gov/windenergy/OffshoreEnergy_MarinerGuidance.pdf
14. IALA Recommendation O-139, Ed. 2 (2013) — https://vasab.org/wp-content/uploads/2018/06/2013_IALA_Marking-of-Man-Made-Offshore-Structures.pdf
15. Vineyard Wind COP Volume I, Section 3 — https://www.boem.gov/sites/default/files/documents/renewable-energy/Vineyard-Wind-COP-Volume-I-Section-3_0.pdf
16. BOEM, Revolution Wind FEIS Appendix D (PDE) — https://boem.gov/sites/default/files/documents/RWF_FEIS_App_D_PDE%20and%20Maximum%20Case%20Scenario_508.pdf
17. Carbon Trust OWA / Atkins, recommended boat landing geometry — https://www.carbontrust.com/sites/default/files/documents/resource/public/Design_for_recommended_boat_landing_geometry.pdf
18. EN ISO 14122-3 guard-rail summary — https://www.gt-engineering.it/en/technical-standards/en-iso-standards/en-iso-14122-3-eng/guard-rails-en-14122-eng/
19. NOAA CO-OPS, Atlantic City 8534720 datums, epoch 1983–2001 (API, read this session) — https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations/8534720/datums.json?units=metric
20. Ocean Wind COP Volume I (2022-06-14) — https://www.boem.gov/sites/default/files/documents/renewable-energy/state-activities/OCW01_COP%20Volume%20I_20220614.pdf
21. Radiance materials, RAL colour XYZ/reflectance table (read this session) — https://www.radiance-online.org/share/materials/ral-colors.html
22. E. Bruneton, *Precomputed Atmospheric Scattering*, `atmosphere/demo/demo.cc` (read this session) — https://github.com/ebruneton/precomputed_atmospheric_scattering/blob/master/atmosphere/demo/demo.cc
23. USCG Navigation Center, COLREGS Annex I (International), §2(a), §2(g), §8 (read this session) — https://www.navcen.uscg.gov/annex1-international-positioning-technical-details-lights-shapes . Cross-checked against 33 CFR 84.14 (identical intensity table) — https://www.law.cornell.edu/cfr/text/33/84.14
24. USCG Navigation Center, Navigation Rules (Rules 21, 22, 23, 27; read this session) — https://www.navcen.uscg.gov/navigation-rules-amalgamated
25. R. H. Stewart, *Introduction to Physical Oceanography*, ch. 16 (Pierson-Moskowitz and JONSWAP) — https://www.colorado.edu/oclab/sites/default/files/attached-files/stewart_textbook.pdf
26. Norris et al. 2013, *Ocean Science* 9:133 (Monahan whitecap formula) — https://os.copernicus.org/articles/9/133/2013/os-9-133-2013.pdf
27. NDBC historical standard meteorological data (44009, 44025, 44091), via site-environment §6 — https://www.ndbc.noaa.gov/data/historical/stdmet/
28. AERONET v3 data service, via site-environment §8.1 — https://aeronet.gsfc.nasa.gov/cgi-bin/print_web_data_v3
29. ESA OC-CCI v6 on ERDDAP, via site-environment §7 — https://coastwatch.pfeg.noaa.gov/erddap/griddap/pmlEsaCCI60OceanColorMonthly.html
30. Iowa Environmental Mesonet ASOS (ACY, WWD), via site-environment §8.3–8.4 — https://mesonet.agron.iastate.edu/request/download.phtml
31. NOAA Solar Calculator equations — https://gml.noaa.gov/grad/solcalc/calcdetails.html
32. three.js r180 `tonemapping_pars_fragment` (ACES constants verified this session) — https://cdn.jsdelivr.net/npm/three@0.180.0/src/renderers/shaders/ShaderChunk/tonemapping_pars_fragment.glsl.js
33. BOEM, Empire Wind FEIS Appendix E (PDE) — https://www.boem.gov/sites/default/files/documents/renewable-energy/state-activities/Empire_Wind_FEIS_App_E_PDE_0.pdf
34. Wikipedia, "List of tallest buildings in Atlantic City" (read this session) — https://en.wikipedia.org/wiki/List_of_tallest_buildings_in_Atlantic_City
35. Wikipedia, "Ocean Casino Resort" and "Borgata" (coordinates and heights, via site-environment §5) — https://en.wikipedia.org/wiki/Ocean_Casino_Resort , https://en.wikipedia.org/wiki/Borgata
36. Strategic Marine, StratCat 27 CTV — https://www.strategicmarine.com/product/stratcat-27-crew-transfer-vessel/
37. Maritime Executive: *Atlantic Pioneer* and *ECO Edison* — https://maritime-executive.com/article/first-us-offshore-wind-crew-boat-hits-the-water , https://maritime-executive.com/article/first-u-s-built-sov-christened-for-oersted-s-offshore-wind-operations
38. WorkBoat, *ECO Liberty* — https://www.workboat.com/wind/new-edison-chouest-sov-ready-after-empire-wind-reprieve
39. Wikipedia species pages (read this session):
    - Common tern — https://en.wikipedia.org/wiki/Common_tern
    - Striped bass — https://en.wikipedia.org/wiki/Striped_bass
    - Bluefish — https://en.wikipedia.org/wiki/Bluefish
    - Little tunny — https://en.wikipedia.org/wiki/Little_tunny
    - Atlantic menhaden — https://en.wikipedia.org/wiki/Atlantic_menhaden
    - Atlantic bluefin tuna — https://en.wikipedia.org/wiki/Atlantic_bluefin_tuna
40. Atlantic Shores NOAA IHA application, 2022 (water depth 19–37 m) — https://media.fisheries.noaa.gov/2022-09/AtlanticShoresOWF_2022_Application_OPR1.pdf
41. Germany, AVV Kennzeichnung von Luftfahrthindernissen (2020) — https://www.verwaltungsvorschriften-im-internet.de/bsvwvbund_24042020_LF15.htm
42. IEC 61400-3-1 offshore shear α = 0.14, as quoted in *Wind Energ. Sci.* 9:2001 (2024) — https://wes.copernicus.org/articles/9/2001/2024/
43. NWS Miami, Beaufort Wind Scale — https://www.weather.gov/mfl/beaufort
44. Wikipedia, "Horizon" and "Visibility" (Koschmieder) — https://en.wikipedia.org/wiki/Horizon , https://en.wikipedia.org/wiki/Visibility

---

## Addendum 2026-09-30 (lead, after polish round 1) — supersedes the rows cited

- §4.2 / §13.1: **L-864 lamps at +161.2 m** on short masts above the 160.2 m cooler top (FAA: visible
  360°). The 159.4 m row is superseded.
- §4.6: the platform is an **open-frame** grating deck on yellow brackets (the modeller's round-1
  build); the conical skirt row is superseded.
- §9 / C9: **haze σ(550) = 6.6e-5 /m** (visibility ≈ 59 km), per-channel (5.02, 6.56, 9.08)e-5,
  SSA 0.985, top of atmosphere 100 km. Transmittance: 774 m 0.95, 2.95 km 0.82, 10 km 0.53. The
  photo's horizon-sea step and crisp far turbines support it; the 1.2e-4 value came from TP chroma
  contaminated by sub-pixel mixing.
- §8: **default time 17:15 EDT** (photo brightness-profile fit, sun az ≈ 273.5°, el ≈ 34.4°).
- §15: common tern hover-dives from **1–6 m**; gannet plunges start at **11–60 m** (most 10–30 m).
- §17: `clouds.puffDiameter` 1000 ± 500 m (median projected patch).

## Addendum 2026-10-06 (lead, after polish round 2) — supersedes the 2026-09-30 haze and time rows

- §9: surface haze σ(550) **3.0e-5 /m**, aerosol scale height **2.5 km**, Mie extinction (13.3, 16.44, 20.55)e-6 /m,
  per-channel fog (1.91, 3.00, 5.37)e-5 /m, visibility ≈ 130 km, AOD ≈ 0.041. Transmittance at TP height: 774 m 0.977,
  2.95 km 0.916, 6.3 km 0.829, 10 km 0.742, 20 km 0.551.
- §8: default time **16:30 EDT** again (17:15 overexposed the camera-facing TP by ~1 EV).
