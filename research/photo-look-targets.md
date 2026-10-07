# Photo look-dev targets: `reference/ref-1.png`

Quantitative targets taken from the reference still, for the Three.js (r180) offshore wind scene. Everything here is a number or a shape a modeller or shader writer can use directly.

## 0. Conventions and labels

| Item | Value |
|---|---|
| Image | `reference/ref-1.png`, 760 x 506 px, 8-bit RGB, sRGB chunk present. Its eXIf block holds only ColorSpace = 1 (sRGB), PixelXDimension = 760 and PixelYDimension = 506. There is no lens, focal-length or GPS data. SOURCED (px): decoded from the file. |
| Pixel coordinates | Continuous coordinates. The origin is the top-left corner of the image, x points right and y points down. Pixel (col i, row j) covers [i, i+1) x [j, j+1), so its centre is at (i+0.5, j+0.5). Image centre = (380, 253). |
| Labels | **SOURCED (px)** = read directly from the pixels of ref-1.png by the method stated; the source is the file itself. **SOURCED** = from a cited URL. **DERIVED** = arithmetic from the numbers above, with the working shown. **ESTIMATED** = a judgement; the basis is stated. |
| Scale | Most world numbers depend on the unknown hub height H. They are given as multiples of H and also in metres at **H = 90 m**, the most consistent value (section 1.4). |
| Tools | Pure-numpy PNG decoder and camera model. PIL could not be installed because the venv failed on ensurepip. Scripts are in `research/photo-look-measure/` (`png.py`, `cam.py`, `col.py`, `wpng.py`). |
| Overlay | `research/photo-look-targets-overlay.png` (2x) shows the horizon fit (cyan), image centre (yellow), hero landmarks (magenta ticks), hub and blade tips (red), and the predicted lattice waterlines (green) and hubs (orange). |

### Headline numbers

| Quantity | Target | Label |
|---|---|---|
| Horizon | y = 208.25 at the image centre, which is 0.4116 of the height from the top and 44.75 px above centre | SOURCED (px) |
| Roll | +0.058 deg: the right side of the horizon is 0.76 px lower than the left. Treat as 0 | SOURCED (px) |
| Focal length | f = 900 px, which gives a vertical FOV of 31.4 deg and a horizontal FOV of 45.8 deg (about a 43 mm full-frame equivalent). A 24 mm lens is ruled out | DERIVED |
| Camera | Height 0.83 H (74.7 m). Pitch 3.10 deg down with a curved sea, or 2.85 deg down with a flat sea | DERIVED |
| Hero turbine | 5.1 H (459 m) away at azimuth -1.4 deg | DERIVED |
| Farm layout | 19 turbines on a square lattice with spacing 8.5 H (about 765 m, or 6.2 rotor diameters). The lattice axes run +21 deg and -69.5 deg from the camera heading | DERIVED |
| Sun | Behind the camera over its left shoulder, at azimuth 208 deg +/- 10 (clockwise from heading). Elevation is about 45 deg (weakly constrained). Shadows are hard | DERIVED / ESTIMATED |
| Haze | Extinction about 0.11 km^-1, range 0.08-0.15 at H = 90 (visibility about 36 km). Airlight colour #e5ecf5 | DERIVED |
| Sea | Beaufort about 2: small glassy wavelets, no whitecaps, no sun glitter. Near-camera wavelength 5-8 m, plus a faint 25-30 m component | DERIVED / ESTIMATED |

---

## 1. Camera

### 1.1 Horizon and roll: SOURCED (px)

- **Method.** For each column, the sea-sky step is modelled as a two-level edge between the sky (rows 200-205) and the sea (rows 209-211). The sub-pixel edge position is `208 - f207 + f208`, where f is the fraction of each boundary row that belongs to the other medium. Columns crossed by turbines were rejected. A robust linear fit was then run over 590 clean columns.
- **Result.** `y_horizon(x) = 207.866 + 0.001006 x`. That is 207.87 at x = 0, **208.25 at x = 380** and 208.63 at x = 760. The residual standard deviation is 0.16 px.
- **Fraction of height.** 208.25 / 506 = **0.4116** from the top. In three.js NDC (y up) this is y = 1 - 2(0.4116) = **+0.177**. DERIVED.
- **Roll.** atan(0.001006) = **0.058 deg**. The right side is lower, so for a three.js camera `rotation.z = +0.001 rad`. This is optional and below what a viewer can see. DERIVED.
- **Curvature of the horizon.** A quadratic term is not significant. There is no visible lens distortion (barrel distortion would bow a line that sits 45 px above centre).

### 1.2 Focal length / FOV: three independent tests

A 3:2 still was assumed first to be a 24 mm-equivalent drone frame, which gives f = 380 / tan(36.87 deg) = 507 px and a vertical FOV of 53.1 deg. That assumption was then tested:

| f (px) | f (mm FF-eq) | vFOV (deg) | Lattice angle between turbine rows (deg) | Row spacing / column spacing | Spread of per-turbine hub height (std, m, median 90) | Predicted tower lean K (x 1e-4) |
|---|---|---|---|---|---|---|
| 507 | 24 | 53.0 | 110.7 | 0.68 | 4.44 | 1.83 |
| 600 | 28 | 45.7 | 104.7 | 0.76 | 4.10 | - |
| 730 | 35 | 38.2 | 97.8 | 0.87 | 3.69 | 0.90 |
| 800 | 38 | 35.1 | 94.6 | 0.93 | 3.50 | - |
| **900** | **42.6** | **31.4** | **90.5** | **1.01** | **3.27** | **0.60** |
| 950 | 45 | 29.8 | 88.7 | 1.05 | 3.17 | - |
| 1056 | 50 | 26.9 | 85.2 | 1.12 | 3.00 | - |

All entries are DERIVED from SOURCED (px) turbine positions using the camera model in `cam.py`.

1. **The farm lattice (strongest test).** The waterline points of the 19 visible turbines back-project onto the sea plane as a lattice with integer indices. Residuals are 2-34 m for the 12 nearest turbines (section 3). The angle between the two lattice directions, and the ratio of their spacings, both depend on f.
   - At f = 900 px the lattice is **square**: 90.5 deg, with spacings 749 m x 744 m at H = 90. Two separate conditions (a right angle and equal spacing) are met at the same f.
   - At 24 mm the lattice would be a 111 deg rhombus with a 0.68 spacing ratio.
   - This test assumes the farm is laid out on a square grid, which is a common choice. ESTIMATED assumption.
2. **Hub-height consistency.** Every turbine should give the same hub height. The spread falls steadily as f grows. The hero (large angles) and the far turbines (near the horizon) disagree by 5-7% at 24 mm and by 3% at 900 px.
3. **Tower lean (keystone).** A camera pitched down makes vertical towers lean toward the image centre line. The lean is K x (380 - x) px per px of height, with K ≈ tan(pitch) / f.
   - Measured edge-midline slopes: T634 -0.0249 +/- 0.003, T306 +0.0088 +/- 0.002, T659 -0.036 +/- 0.005, T580 -0.008 +/- 0.005.
   - The weighted K is 0.91e-4, with a scatter of 0.4-1.3e-4. That points to f ≈ 730 px (range 640-860).
   - The towers are only 1.3-2.7 px wide, so this is the least reliable test. It still rules out 24 mm, which would need K = 1.83e-4.

**Pick: f = 900 px.** That gives a vertical FOV of 2·atan(253/900) = **31.40 deg**, a horizontal FOV of 2·atan(380/900) = **45.78 deg** and a diagonal FOV of 53.8 deg. On a 36 mm-wide frame this is 900 x 36/760 = **42.6 mm FF-equivalent**. The acceptable range is 730-950 px, which is a vertical FOV of 38.2-29.8 deg. The 24 mm reading is rejected. DERIVED.

If the render aspect is not 3:2, keep the vertical FOV at 31.4 deg. At 16:9 the horizontal FOV becomes 2·atan(tan(15.7 deg) x 1.778) = 53.1 deg, which shows more width than the photo. DERIVED.

### 1.3 Triangulation for hub-height candidates

**Model.** A pinhole camera with pitch θ and no roll. The visible horizon sits below the true horizontal by the dip γ, where cos γ = R'/(R' + h) and R' is the effective Earth radius. The sea surface at distance D drops by D²/(2R').

- The Horizon article gives cos γ = R/(R+h) and Young's refraction-corrected radius R' = 7/6 R_E. SOURCED: [Horizon (Wikipedia)](https://en.wikipedia.org/wiki/Horizon).
- The code used R' = 6371 km / (1 - 0.13) = 7323 km instead of 7/6 R_E = 7433 km. The dip differs by less than 0.003 deg (0.05 px), which is negligible.

**Hero landmarks.** SOURCED (px), see section 2: waterline y_wl = 350.0, hub y_hub = 174.0, tower axis x = 357.5.

**Worked arithmetic at H = 90 m** (farm-median calibration). DERIVED:
- Dip at h = 72.5 m: γ = sqrt(2 x 72.5 / 7.323e6) = 4.45e-3 rad = **0.255 deg**.
- Pitch: θ = γ + atan((253 - 208.25)/900) = 0.255 + 2.846 = **3.101 deg down**.
- Hero waterline depression: α_wl = θ + atan((350 - 253)/900) = 3.101 + 6.151 = 9.252 deg. So D = h / tan α_wl = 72.5 / 0.16292 = **445 m**.
- Hero hub angle: α_hub = 3.101 + atan((174 - 253)/900) = 3.101 - 5.017 = -1.916 deg. So the hub height is h - D tan α_hub = 72.5 + 445 x 0.03345 = 87.4 m.
- Calibrating on the hero alone (hub = 90 m exactly) scales h by 90/87.4, giving **h = 74.7 m and D = 459 m**.

| H (m) | Calibration | Camera h (m) | h / H | Pitch (deg, curved sea) | Dip (deg) | Hero distance (m) | Hero D / H | Lattice spacing (m) | Horizon distance (km) |
|---|---|---|---|---|---|---|---|---|---|
| **90** | hero | **74.7** | 0.830 | **3.105** | 0.259 | **459** | 5.09 | 769 x 764 | 33.1 |
| 90 | farm median | 72.5 | 0.805 | 3.101 | 0.255 | 445 | 4.95 | 749 x 743 | 32.6 |
| 100 | hero | 83.1 | 0.831 | 3.120 | 0.273 | 509 | 5.09 | 848 x 844 | 34.9 |
| 100 | farm median | 81.0 | 0.810 | 3.116 | 0.270 | 497 | 4.97 | 828 x 824 | 34.4 |
| 125 | hero | 104.3 | 0.834 | 3.152 | 0.306 | 637 | 5.09 | 1039 x 1040 | 39.1 |
| 150 | hero | 125.5 | 0.837 | 3.182 | 0.335 | 764 | 5.09 | 1225 x 1233 | 42.9 |

All rows DERIVED, f = 900 px.

- **The ratios are nearly scale-free.** The camera sits at 0.81-0.84 H (just below hub height), about 5.1 H from the hero, pitched 3.1-3.2 deg down. The lattice spacing is 8.2-8.6 H.
- **The geometric fit alone barely separates H.** A larger H makes the dip larger, which slightly improves how well the far turbines agree (2% at H = 150 against 5% at H = 90). That signal is only about 1 px. The regulated markings in section 1.4 decide H.

### 1.4 Which H is most consistent

The photo carries two fixed-size markings:

| Clue | Photo ratio (SOURCED px) | Rule | Implied H |
|---|---|---|---|
| Blade tip marking: three bands, each 0.099-0.104 of the tip radius R. R = 0.682 H, so each band is 0.068 H | Order from the tip inward: red (seen dark), white/grey, red | German AVV §14.1 requires three stripes starting at the outside: 6 m orange/red, 6 m white or grey, 6 m orange/red. SOURCED: [AVV Kennzeichnung von Luftfahrthindernissen, verwaltungsvorschriften-im-internet.de](https://www.verwaltungsvorschriften-im-internet.de/bsvwvbund_24042020_LF15.htm) | 6 m / 0.068 = **88 m**. DERIVED |
| Yellow paint band on the transition piece (TP): 33 px = 0.19 H, above a dark 5 px (0.028 H) waterline band | Dark band read as the intertidal zone below HAT (highest astronomical tide). ESTIMATED | IALA O-139 §2.3: "painted yellow all around from the level of HAT up to 15 metres". SOURCED: [IALA Recommendation O-139, Ed. 2, 2013 (PDF p.12)](https://vasab.org/wp-content/uploads/2018/06/2013_IALA_Marking-of-Man-Made-Offshore-Structures.pdf) | 15 m / 0.19 = **80 m** if the paint stops at exactly 15 m, and more if it runs higher. DERIVED |
| TP top / tower flange at 0.295 H | - | Checked for plausibility only | 26.6 m at H = 90, but 44 m at H = 150, which is implausibly tall for a TP |

**Choice: H ≈ 90 m** (range 80-95). ESTIMATED from the two DERIVED values above. Of the 100-150 m candidates in the brief, 100 m is the closest. At 125-150 m the tip bands would be 8.5-10 m and the yellow 24-29 m, which matches neither rule.

> Context: the red-white-red 6 m tip stripes are the German AVV pattern, and the yellow TP is the IALA pattern. FAA AC 70/7460-1L chapter 13 says wind turbines "should be painted white or light grey" (RAL 9010 to 7035). It also says the nacelle and blades "shall remain solid white or light grey" (§13.4.2 and §13.4.4, under the snow-area and lattice-mast provisions), and it requires no tip bands. SOURCED: [AC 70/7460-1L ch.13 (copy hosted by NY DPS)](https://documents.dps.ny.gov/public/Common/ViewDoc.aspx?DocRefId=%7BD3CAE7E7-AAC5-44E2-9F37-ECAF7036157D%7D).
>
> That text is superseded by AC 70/7460-1M and -1N. The faa.gov copies returned HTTP 403 and could not be read.
>
> So the reference is very likely a German North Sea farm. Keep the bands anyway, because they are part of the look being matched. ESTIMATED.

### 1.5 Three.js camera recipe (H = 90 m, 1 unit = 1 m)

| Setting | Value | Label |
|---|---|---|
| `camera.fov` | **31.4** (vertical, degrees). Render at 3:2 to reproduce the framing | DERIVED |
| `camera.position` | (0, **74.7**, 0) | DERIVED |
| `camera.rotation` (order 'YXZ') | x = **-3.10 deg (-0.0541 rad)**, y = 0, z = 0 (or +0.001) | DERIVED |
| Sea | Curve the sea with `y -= (x² + z²) / (2 x 7.433e6)`, using R' = 7/6 R_E, and give it a radius of at least 35 km. This puts the visible horizon exactly on row 208.25 | DERIVED |
| Flat-sea alternative | Use pitch **-2.85 deg**, so atan(44.75/900) puts the horizon on row 208.25. Far turbine bases will then sit about 1-4 px too high above the horizon, because a flat sea has no dip and the dip is 0.26 deg ≈ 4 px | DERIVED |
| Hero base | (**-11.5, 0, -459**) | DERIVED |
| Lattice vectors (three.js x, z) | a = (**+276, -718**), |a| = 769 m at +21.0 deg from the heading. c = (**-716, -268**), |c| = 764 m at -69.5 deg | DERIVED |
| Turbine placement | Place turbine (i, j) at hero + i·a + j·c. The visible set is i = 0..5 with 0 ≤ j ≤ min(i, 4) (section 3) | DERIVED |
| Scale-free form | In units of H: camera y = 0.83, hero (-0.128, -5.10), a = (3.06, -7.98), c = (-7.95, -2.97) | DERIVED |

---

## 2. Hero turbine proportions

All pixel values are SOURCED (px) from luminance and colour dumps of columns 346-370 and rows 90-370. The "x H" column is DERIVED as px / 176, where 176 px is the waterline-to-hub distance. The metres column is DERIVED at H = 90 (1.956 px/m). Perspective across the turbine's height changes the scale by at most 2%.

| Landmark | y (px) | Height above waterline (px) | x H | m @ H = 90 |
|---|---|---|---|---|
| Waterline (reflection starts; dark → dark-yellow reflection) | 350.0 | 0 | 0 | 0 |
| Top of dark waterline band = bottom of yellow | 345.0 | 5 | 0.028 | 2.6 |
| Top of yellow paint (just below a 1 px platform shadow line at row 311) | 312.0 | 38 | 0.216 | 19.4 |
| Yellow paint height alone | 312 → 345 | 33 | 0.19 | 16.9 |
| Platform band: grey steel deck/skirt (rows 304-311) and cream/yellow railing (298-304) | 298-311 | - | 0.074 (band) | 6.6 |
| Tower base (white starts; flange on the TP) | 298.0 | 52 | 0.295 | 26.6 |
| Tower top = nacelle underside | 176.5 | 173.5 | 0.986 | 88.7 |
| Hub centre (the three blade axes intersect within ±0.4 px; nacelle mid-height is 172.7) | **174.0 ± 1.5** at x = 362.0 | 176 | 1.000 | 90 |
| Nacelle top | 169.0 | 181 | 1.028 | 92.5 |

| Dimension | px | x H | m @ H = 90 |
|---|---|---|---|
| Tower diameter at base (edges 352.4 / 361.9) | 9.5 | 0.054 | 4.9 |
| Tower diameter at top (edges 353.5 / 360.7) | 7.2 | 0.041 | 3.7 |
| TP diameter (yellow, 352.3 / 362.5) | 10.2 | 0.058 | 5.2 |
| Platform apparent width (350 / 364) | 14 | 0.080 | 7.2 |
| Nacelle height (visible side plus underside) | 7.5-8 | 0.044 | 3.9 |
| Nacelle visible length (341.5 → 357) | 15.5 | - | - |
| Nacelle true length. DERIVED: 15.5 / sin 38 deg | ≈ 25 | 0.14 | 12.8. ESTIMATED |
| **Rotor tip radius R**. Semi-major axis of the ellipse through the 3 tips around the hub | **120.1 ± 1** | **0.682** | **61.4** |
| Semi-minor axis. b/a = 0.786, so the disc normal is **38 deg from the line of sight**; the major axis is tilted 4.4 deg from vertical | 94.4 | - | - |
| Each tip band, measured along the blade (lower blade: 11.5 / 12.6 / 11.0 px; upper-right blade: 11 / 11 / 10.3 px) | ≈ 11.7 | 0.068 (0.10 R) | 6.1 |

- **Blade tips.** Upper-right (432.5, 97.5), left (274.5, 124.5), lower (397.0, 287.0). In the image the blades sit at about 1:25, 10:00 and 5:25 on a clock face. Projected lengths are 104.0, 100.5 and 118.3 px. SOURCED (px).
- **Key ratios.**
  - Yellow TP height / hub height = **0.19** for the paint alone, or **0.216** from the waterline to the top of the yellow.
  - Blade length (tip radius) / hub height = **0.68**. Rotor diameter = 1.36 H.
  - Tip band = **10% of R per band**; the three bands together cover the outer **30%**.
  - Tower top diameter / base diameter = 0.76.
  - All DERIVED from the rows above.
- **Small red fleck on the nacelle.** A 2-3 px fleck sits at the rear top corner, at (342, 168), colour #ca88a9. It is probably an aviation-light housing or a hoist-platform marking. ESTIMATED.
- **Yaw.** Every visible rotor sits to the right of its tower, so all turbines are yawed the same way. The visible blade faces are 66 deg away from the sun in azimuth and read as grey. That puts the camera-facing disc normal toward the camera and 38 deg to its right (azimuth about 142 deg), with the nacelle behind the rotor. Wind would then be *from* about 142 deg (behind-right of the camera) and blow toward away-left. ESTIMATED, from shading and occlusion.

---

## 3. Farm layout, count, spacing and size against distance

**Count.** Hero plus 18 turbines = **19 turbines**, plus one substation on the horizon at the far right. SOURCED (px): a column-contrast scan below the horizon, checked on zoomed crops.

| # | id (x px) | Lattice (i, j) | Tower x | Waterline y | Hub y | Azimuth (deg) | D (m) @ H = 90 | D / H | Hub px x D (px·m) |
|---|---|---|---|---|---|---|---|---|---|
| 1 | hero | (0,0) | 357.5 | 350.0 | 174.0 | -1.4 | 459 | 5.1 | 80,700 |
| 2 | T580 | (1,0) | 581.2 | 261.8 | 192.0 | +12.6 | 1197 | 13.3 | 83,500 |
| 3 | T97 | (1,1) | 97.5 | 250.8 | 193.0 | -17.4 | 1515 | 16.8 | 87,600 |
| 4 | T634 | (2,0) | 634.4 | 240.0 | 195.0 | +15.8 | 1959 | 21.8 | 88,100 |
| 5 | T306 | (2,1) | 306.6 | 235.0 | 197.0 | -4.7 | 2200 | 24.4 | 83,600 |
| 6 | T46 | (2,2) | 47.5 | 231.8 | 197.0 | -20.3 | 2614 | 29.0 | 91,000 |
| 7 | T659 | (3,0) | 660.0 | 230.0 | 195.5 | +17.3 | 2749 | 30.5 | 94,800 |
| 8 | T409 | (3,1) | 410.0 | 227.8 | 199.8 | +1.9 | 2873 | 31.9 | 80,400 |
| 9 | T203 | (3,2) | 203.5 | 226.0 | - | -11.1 | 3173 | 35.3 | - |
| 10 | T472 | (4,1) | 472.5 | 223.0 | - | +5.9 | 3640 | 40.4 | - |
| 11 | T25 | (3,3) | 25.5 | 224.0 | - | -21.5 | 3696 | 41.1 | - |
| 12 | T674 | (4,0) | 674.5 | 223.5 | - | +18.1 | 3713 | 41.3 | - |
| 13 | T300 | (4,2) | 300.5 | 222.0 | - | -5.0 | 3844 | 42.7 | - |
| 14 | T514 | (5,1) | 514.5 | 221.5 | - | +8.5 | 3988 | 44.3 | - |
| 15 | T682 | (5,0) | 682.5 | 221.0 | - | +18.6 | 4294 | 47.7 | - |
| 16 | T366 (behind the hero's tower) | (5,2) | 366.5 | 220.0 | - | -0.9 | 4330 | 48.1 | - |
| 17 | T149 | (4,3) | 149.5 | 220.0 | - | -14.4 | 4474 | 49.7 | - |
| 18 | T13 | (4,4) | 13.5 | 219.0 | - | -22.1 | 5019 | 55.8 | - |
| 19 | T235 | (5,3) | 235.5 | 218.0 | - | -9.1 | 5050 | 56.1 | - |

- x, waterline y and hub y are SOURCED (px). The waterline is where the dark band ends and the reflection begins. The hub is where the blades converge.
- D, azimuth and the lattice indices are DERIVED (f = 900 px, h = 74.7 m, curved sea).
- For turbine 9 onward, D from its own waterline carries about ±50-100 m of error per 0.5 px. Use the lattice position instead.

**Size against distance.** Apparent hub height in px x distance ≈ 84,000 ± 5,000 px·m, which should equal f·H = 900 x 90 = 81,000. The apparent size falls as 1/D: 176 px at 459 m, 70 px at 1.2 km, 45 px at 2.0 km and 28 px at 2.9 km. At about 4-5 km a whole turbine (waterline to hub) is about 18-20 px tall. DERIVED.

**Lattice (grid spacing).** DERIVED:
- Averaging five steps in each direction gives a = (275.6, 717.9) m and c = (-715.6, 267.5) m, with **|a| = 769 m** and **|c| = 764 m** at 90.5 deg. That is **8.5 H**, about **6.2 rotor diameters** (1.364 H = 123 m).
- Snapping each turbine to its lattice point leaves residuals of 2-34 m for the 12 nearest. The rest are 22-370 m, which matches their ±50-100 m waterline error.
- The camera itself sits at lattice coordinates (-0.55, -0.23). That is inside the grid cell next to the hero, so the camera may be inside the farm.
- **Farm extent.** Predicted lattice points with i ≥ 6, or at (5,4) and (5,5), show no tower contrast (0.002-0.06, against 0.04-0.44 at occupied points). The far edge of the farm is therefore the i = 5 row: T682, T514, T366, T235. On the left, positions with j > i fall outside the horizontal FOV, so the left and right edges are not constrained. Populate the lattice beyond the frame edges for off-frame reflections.

**Substation.** SOURCED (px):
- A box on the horizon at x = 736-745 (10 px wide), y = 204-209.5 (5.5 px tall), at azimuth +21.8 deg.
- The left face is lit cream #f4e5d0 and the right face is shaded grey #a6aebb.
- ESTIMATED distance 8-15 km, from its base sitting on the horizon. At 12.6 km, 10 px corresponds to about 140 m, which suggests a large converter-class topside.

---

## 4. Sun and lighting

| Quantity | Value | Evidence / label |
|---|---|---|
| Lit side | **Left** on every structure: the hero tower, the hero TP (#f8eb89 on the left, #be9d24 on the right), the nacelle side, every far TP, and the substation (cream on the left, grey on the right) | SOURCED (px) |
| Sun azimuth relative to the camera | The brightest visible normal on the hero tower is **28 deg (range 25-31) left of the camera-facing normal**. A Lambert fit on rows 215-295 gives φ_s = -25 deg (the lit face clips at 0.98 linear), and the centre of the clipped plateau at x ≈ 354.8 gives -31 deg. So the sun is at **ψ ≈ 208 deg ± 10 clockwise from the heading**: behind the camera, 28 deg to its left. The terminator is near the right limb (φ ≈ +62 deg) | DERIVED |
| Sun elevation | **ESTIMATED 45 deg (range 35-55)**. Vertical faces are strongly lit and downward faces are dark: nacelle underside Y 0.45 against its side at 0.97+ (clipped). The only cast shadow, the platform on the TP, is 1 px ≈ 0.5 m, and the overhang is unknown. The photo constrains elevation only weakly | ESTIMATED |
| three.js sun direction (toward the sun) | (cos e·sin ψ, sin e, -cos e·cos ψ) = **(-0.33, 0.71, 0.62)** for ψ = 208 deg, e = 45 deg | DERIVED |
| Shadow softness | Hard. The platform shadow line on the yellow TP (row 311) is 1 px sharp, and blade and blade-root shadows are crisp. The sun disc is not veiled by the thin clouds | SOURCED (px) |
| Key-to-fill ratio | Tower lit 0.97 linear (clipped) against the shade limb 0.18, so at least **5.4 : 1**. TP lit 0.81 against shade 0.35 (the cosine falloff dominates). Nacelle underside (sky and sea bounce only) 0.45 | SOURCED (px) |
| Sun glint on the sea | **None in frame**, because the sun is behind the camera. No near-sea pixel exceeds Y = 0.52 (max 0.305 in rows 460-506), and there is no glitter path | SOURCED (px) |
| Brightest water | The horizon band. Grazing Fresnel reflection of the bright horizon sky gives Y 0.60 at about 10 km | SOURCED (px) |
| Sea brightness left to right | The near sea on the left is **2.4x** brighter than on the right (rows 470-506: 0.093 against 0.039; rows 380-420: 0.187 against 0.079). The foreground reflects the bright cumulus at the top-left, just above the frame. It is not vignetting. The render's sea must reflect a sky *with clouds* in it | SOURCED (px) / ESTIMATED cause |
| Blades | The visible blade faces read **grey-slate**, not white. Upper-right blade Y about 0.38 (#9ba7b2), roots near the hub #56627a (0.12), lower blade against the sea #c6d6e6. The red bands read **near-black maroon** (#33090f to #3d1b28, Y 0.009-0.019). These faces are turned about 66 deg from the sun in azimuth | SOURCED (px) / DERIVED |

---

## 5. Colour palette

Hex is display sRGB as found in the photo. Linear values are the sRGB decode of that hex. Y is Rec.709 relative luminance of the linear values. All SOURCED (px) (medians of the stated regions) unless marked otherwise.

| Target | Region | sRGB hex | Linear R, G, B | Y |
|---|---|---|---|---|
| Sky at 30 deg elevation (upper-sky placeholder) | Exponential extrapolation of the in-frame trend, ESTIMATED; the zenith is not in frame | #4f92d8 | 0.079, 0.286, 0.683 | 0.27 |
| Sky at 20 deg (ESTIMATED extrapolation) | same | #78b0e4 | 0.189, 0.435, 0.777 | 0.41 |
| Clear sky, top of frame (elevation 12.6 deg) | rows 0-4, bluest 15% | **#9fcaeb** | 0.347, 0.591, 0.831 | 0.556 |
| Clear sky 10 deg above the horizon | rows 40-47 | **#b2d5f2** | 0.445, 0.665, 0.888 | 0.635 |
| Clear sky 5 deg | rows 118-126 | #d4e5f6 | 0.658, 0.784, 0.922 | 0.767 |
| Horizon haze band (0-1.5 deg) = airlight colour | rows 195-207 | **#e5ecf5** | 0.784, 0.839, 0.913 | 0.832 |
| Cloud tops (cumulus) | brightest 5% of cloud pixels, rows 0-110 | **#efeef1** | 0.863, 0.855, 0.880 | 0.859 |
| Cloud bases (cumulus, grey-blue) | darkest 10% of cloud pixels | **#cedaeb** | 0.617, 0.701, 0.831 | 0.693 |
| Low streak deck, undersides | rows 110-190, darkest 15% | #d8e2ee | 0.687, 0.761, 0.855 | 0.752 |
| Low streak deck, tops and gaps | rows 110-190, brightest 10% | #e4eef8 | 0.776, 0.855, 0.939 | 0.844 |
| Sea at the horizon (7-11 km) | rows 209-212 | **#b5cfe4** | 0.464, 0.623, 0.778 | 0.600 |
| Sea mid distance, mean (0.77-1.2 km) | rows 255-300 | **#79a0c3** | 0.193, 0.352, 0.547 | 0.332 |
| Sea mid distance, troughs (p10) | same | #5681a8 | 0.093, 0.220, 0.392 | 0.205 |
| Sea mid distance, lit facets (p90) | same | #99bad8 | 0.319, 0.491, 0.687 | 0.468 |
| Sea near the camera, mean (220-270 m) | rows 440-506 | **#33475c** | 0.033, 0.062, 0.107 | 0.059 |
| Sea near the camera, dark troughs (p10) | same | **#000a1a** | 0.000, 0.003, 0.010 | 0.003 |
| Sea near the camera, lit facets (p90) | same | **#57708a** | 0.095, 0.162, 0.254 | 0.154 |
| Tower white, lit side (against the sea) | x 353-355, rows 215-296 | **#fcfcfb** | 0.973, 0.973, 0.965 | 0.973 |
| Tower white, lit side (against the sky) | x 354-355, rows 182-206 | #f6fcfa | 0.922, 0.969, 0.956 | 0.958 |
| Tower terminator zone | x 358 | #dcdfe6 | 0.716, 0.738, 0.795 | 0.737 |
| Tower shadow limb | x 360, rows 182-206 | **#6a7687** | 0.146, 0.181, 0.242 | 0.178 |
| Nacelle side, lit | rows 170-176, x 343-355 | #f7fdfc | 0.930, 0.982, 0.978 | 0.971 |
| Nacelle underside | row 176 | #afb4bb | 0.429, 0.454, 0.497 | 0.451 |
| TP yellow, lit side | x 353-355, rows 313-340 | **#f8eb89** | 0.939, 0.831, 0.250 | 0.812 |
| TP yellow, mid (peak saturation) | x 356-357 | #fee079 | 0.987, 0.742, 0.191 | 0.754 |
| TP yellow, shadow side | x 359-361 | **#be9d24** | 0.515, 0.337, 0.018 | 0.352 |
| Platform band (grey steel) | rows 304-311 | #bbbdbc | 0.497, 0.509, 0.503 | 0.506 |
| Waterline dark band | rows 346-349 | **#100e08** | 0.005, 0.004, 0.002 | 0.004 |
| TP reflection directly below the waterline (hero) | rows 351-359 | #40361e | 0.051, 0.038, 0.013 | 0.039 |
| Blade tip red band as seen (shaded face) | red-dominant pixels, upper-right and lower blades | **#33090f to #3d1b28** | 0.033, 0.003, 0.005 to 0.047, 0.011, 0.021 | 0.009-0.019 |
| Outer red band on the lower blade (sub-pixel, mixed with the sea) | rows 276-286 | ≈#9e97a7 (mauve) | 0.34, 0.31, 0.39 | ≈0.32 |
| Blade body, shaded face against the sky | upper-right blade, dark pixels | #9ba7b2 | 0.328, 0.386, 0.445 | 0.378 |
| Blade root area near the hub | left blade, x 320-345 | #56627a | 0.092, 0.123, 0.193 | 0.122 |
| Far tower (T580, 1.2 km), lit, against the sea | x 580-581 | #fcfcf7 | 0.969, 0.973, 0.930 | 0.969 |
| Far TP yellow at 1.2 km / 2.6 km / 4.3 km (max-chroma pixel) | T580 / T46 / T682 | #fdf98d / #f3e29a / #ebeed9 | - | - |
| Substation lit / shade | x 736-745 | #f4e5d0 / #a6aebb | 0.905, 0.784, 0.631 / 0.381, 0.423, 0.497 | 0.798 / 0.420 |

**Paint albedos are not measured here.** These are display values after the photo's exposure and grade. The red band's hue in shade is crimson-magenta, not orange, so the paint is red. The AVV allows either orange or red. ESTIMATED.

---

## 6. Gradients

### 6.1 Clear sky against elevation

Method: for each row, the median of the bluest 15% of pixels (highest B - R). This rejects clouds. Elevation is DERIVED from the camera model at the centre column. SOURCED (px).

| Row | Elevation (deg) | Clear-sky hex | Y (linear) |
|---|---|---|---|
| 0 | 12.6 | #9fcaeb | 0.556 |
| 16 | 11.6 | #a6ceef | 0.585 |
| 32 | 10.7 | #b0d2f3 | 0.618 |
| 48 | 9.7 | #b4d7f2 | 0.647 |
| 64 | 8.7 | #c0d9f3 | 0.673 |
| 80 | 7.8 | #c8dcf4 | 0.700 |
| 96 | 6.8 | #cce2f6 | 0.739 |
| 112 | 5.8 | #d1e7f9 | 0.775 |
| 128 | 4.8 | #d7e9f7 | 0.794 |
| 144 | 3.8 | #dbebf6 | 0.811 |
| 160 | 2.8 | #deecf5 | 0.821 |
| 176 | 1.8 | #e4ebf5 | 0.825 |
| 192 | 0.8 | #e6edf7 | 0.841 |
| 203 | 0.05 | #e3eaf5 | 0.818 |

- **Fit.** Y(el) ≈ 0.828 - 0.0031·el - 0.00154·el², for el in degrees from 0 to 12.6. RMS error 0.014. DERIVED.
- **Shape.** The sky is nearly flat and white in the lowest 3 deg (the haze band), then darkens and saturates faster above about 5 deg. The B - R gap grows from 17 levels at the horizon to 76 at 12.6 deg.
- **Implication.** A physical sky model (for example three.js `Sky` or a Preetham-type shader) should be tuned until these in-frame rows match. The zenith is off-frame and unconstrained.

### 6.2 Sea against distance

Method: 3-row bands with turbine and reflection columns excluded. Distance is D = h / tan(depression) with h = 74.7 m. D scales by H/90. SOURCED (px) / DERIVED.

| Row | Depression (deg) | D (m) | Mean hex | Mean Y | p10 Y | p90 Y | Facet contrast p90/p10 |
|---|---|---|---|---|---|---|---|
| 209 | 0.40 | ~10,800 | #b5cfe4 | 0.600 | 0.534 | 0.674 | 1.26 |
| 212 | 0.59 | 7,300 | #abc9e2 | 0.559 | 0.480 | 0.633 | 1.32 |
| 218 | 0.97 | 4,420 | #a0c2dc | 0.511 | 0.439 | 0.571 | 1.30 |
| 226 | 1.48 | 2,900 | #8cb5d4 | 0.434 | 0.330 | 0.519 | 1.57 |
| 235 | 2.05 | 2,090 | #7da9cb | 0.369 | 0.275 | 0.490 | 1.78 |
| 250 | 3.00 | 1,420 | #85accd | 0.388 | 0.285 | 0.516 | 1.81 |
| 275 | 4.60 | 930 | #7da3c6 | 0.347 | 0.245 | 0.480 | 1.96 |
| 310 | 6.82 | 620 | #6a8fb4 | 0.259 | 0.147 | 0.380 | 2.58 |
| 350 | 9.35 | 450 | #58789c | 0.179 | 0.049 | 0.324 | 6.6 |
| 400 | 12.47 | 340 | #46607d | 0.112 | 0.028 | 0.221 | 7.9 |
| 450 | 15.54 | 270 | #3c536b | 0.082 | 0.004 | 0.182 | ≫10 |
| 500 | 18.54 | 220 | #263546 | 0.034 | 0.002 | 0.096 | ≫10 |

- **Fit.** Y_sea(dep) ≈ 0.586·exp(-0.134·dep), with dep in degrees. Log RMS 0.12. DERIVED.
- **Effective reflectance.** Divide sea Y by clear-sky Y at the mirror elevation. This gives about 0.45 at 2 deg depression, 0.42 at 5 deg and 0.27 at 10 deg. Flat-water Fresnel (n = 1.333) would be 0.80, 0.58 and 0.35. The photographed sea therefore reflects about **0.55-0.75x flat-water Fresnel**, the expected effect of rough-surface slope averaging. DERIVED.
- **Water body.** The near-camera troughs are essentially black (#000a1a), so upwelling light from the water itself is close to 0. Use a very dark navy body colour, about lin (0.000, 0.003, 0.010), and let the reflected sky carry the brightness. SOURCED (px) / ESTIMATED interpretation.
- **Facet contrast.** Facet contrast climbs from 1.3 near the horizon to more than 10 near the camera. The near foreground reads as dark water with scattered sky-coloured facets.

### 6.3 Turbine fade against distance (extinction)

Measure: the chroma of the TP yellow, C = (R+G)/2 - B in linear light, taken as the median of per-row maxima. Airlight chroma is C_air = -0.10 (from #e5ecf5). SOURCED (px).

| Turbine | D (m) | TP width (px) | C |
|---|---|---|---|
| hero | 459 | 11 | 0.680 |
| T580 | 1,197 | 5 | 0.650 |
| T97 | 1,515 | 4 | 0.628 |
| T634 | 1,959 | 3 | 0.539 |
| T306 | 2,200 | 2 | 0.555 |
| T46 | 2,614 | 3 | 0.453 |
| T659 | 2,749 | 3 | 0.239 |
| T25 | 3,696 | 3 | 0.202 |
| T682 | 4,294 | 2 | 0.101 |

- **Chroma fit.** Fitting ln(C - C_air) = const - σD over the six turbines that are resolved (at least 2 px) gives **σ = 0.152 ± 0.03 km⁻¹** at hero-calibrated distances. Sub-pixel mixing with the sea also lowers the chroma of small TPs, so this is an **upper bound**. DERIVED.
- **Horizon check.** The sea 10.8 km away is measured at Y 0.60. Airlight is 0.83 and the sea's own grazing radiance is about 0-0.15, so observed = T·L0 + (1 - T)·0.83 requires T ≳ 0.27-0.34. That means **σ ≲ 0.10-0.12 km⁻¹**; σ = 0.15 would give 0.68 or more. DERIVED.
- **Recommendation: σ = 0.11 km⁻¹ = 1.1e-4 m⁻¹** (range 0.08-0.15) at H = 90. Scale by 90/H if the scene uses a different H.
  - Koschmieder visibility is 3.912/σ ≈ **36 km**. SOURCED formula: [Visibility (Wikipedia)](https://en.wikipedia.org/wiki/Visibility).
  - Transmittance at that σ: T(0.46 km) = 0.95, T(2.5 km) = 0.76, T(5 km) = 0.58, T(10 km) = 0.33, T(33 km) = 0.03. DERIVED.
  - Fog colour = the horizon haze, #e5ecf5 (lin 0.784, 0.839, 0.913).
- **Fog implementation.** Use a true exponential, 1 - exp(-σd). The patched `fog_fragment` in `research/three-r180-api.md` fits: `fogNear` is repurposed as σ, set it to 1.1e-4, and `fogFar` is a height falloff, set it to 0 or at most 5e-4 (ESTIMATED; the photo shows no height dependence).
  - Built-in `FogExp2` (1 - exp(-(ρd)²)) cannot match. With ρ tuned to agree at 2.5 km (2.1e-4), it under-fogs the hero (0.009 against 0.05) and over-fogs 10 km (0.99 against 0.67).
  - Keep fog off the sky dome; the sky has its own gradient.

---

## 7. Sea texture

| Property | Value | Label |
|---|---|---|
| Pixel footprint near the bottom of frame | 0.28-0.30 m across x 0.97-1.1 m along the view, per px (D ≈ 240-270 m at H = 90) | DERIVED |
| Dominant near-camera wavelength | FFT of rows 440-504: peaks at **6.9-8.0 m**. The power-weighted mean spatial period is 4.5-5.5 m along the view and about 5.6 m across it | SOURCED (px) → DERIVED |
| Longer component | **25-30 m**, crest-normal pointing 19-34 deg left of the heading. It shows as faint diagonal banding in the lower right | SOURCED (px) → DERIVED |
| Directionality | In image space the texture is streaky and horizontal: fx/fy ≈ 0.20-0.25. After converting pixels to metres the anisotropy on the water is about 0.9, so the wind sea is **short-crested and nearly isotropic**. The horizontal streaking is perspective. Propagation is toward away-left (azimuth about -38 deg). This agrees with the rotor-yaw estimate of the wind (section 2), which settles the 180 deg ambiguity | DERIVED / ESTIMATED |
| Periods | Deep-water λ = gT²/2π, so 6 m waves have T ≈ 2.0 s and 28 m waves T ≈ 4.2 s. SOURCED formula: [Dispersion (water waves), Wikipedia](https://en.wikipedia.org/wiki/Dispersion_(water_waves)) | DERIVED |
| Wind estimate | Pierson-Moskowitz peak ω_p = (4β/5)^¼·g/U_19.4 with β = 0.74, so ω_p = 0.877 g/U. SOURCED: [CodeCogs, Pierson-Moskowitz](https://www.codecogs.com/library/engineering/fluid_mechanics/waves/spectra/pierson_moskowitz.php). Then λ_p = 2πU²/(0.769 g) = 0.832 U². For λ_p = 6-8 m, U ≈ 2.7-3.1 m/s; for 25-30 m, U ≈ 5.5-6.0 m/s. Take **U ≈ 4-5 m/s** for a shader spectrum | DERIVED / ESTIMATED |
| Whitecaps | **None.** The maximum near-sea Y is 0.31-0.52 and nothing is white | SOURCED (px) |
| Beaufort | **About 2**: "Small wavelets ... Crests have a glassy appearance and do not break" (4-6 kn). Force 3 would show "Perhaps scattered white horses", and none are seen. SOURCED: [NWS Miami, Beaufort Wind Scale](https://www.weather.gov/mfl/beaufort) | ESTIMATED |
| Capillary sparkle / glitter | None visible, because the sun is behind the camera. Sub-metre ripples are unresolved, but they control facet roughness: near-field p90/p10 contrast is more than 10 | SOURCED (px) |
| Mid-distance patchiness | Lighter slick and cat's-paw patches of **±12% luminance**, 50-120 px wide (about 60-180 m) at 1-1.5 km, for example x 100-330 and x 480-560 in rows 245-280. Add a low-frequency roughness modulation | SOURCED (px) / DERIVED |
| Structure reflections | Each TP has a vertical reflection streak. On the hero it is short and dark (#40361e, about 0.6x TP height). On far turbines it is brighter and longer: T306 2.0x, T634 2.4x, T659 1.8x the TP height, lightening toward the TP colour because of grazing Fresnel | SOURCED (px) |

---

## 8. Clouds

| Property | Value | Label |
|---|---|---|
| Types | (a) **Fair-weather cumulus humilis**: flat-bottomed puffs with bright tops (#efeef1) and blue-grey bases (#cedaeb). They sit at the top-left (x 0-330, y 0-30 and y 50-100) and as one long cloud at the top-right (x 440-740, y 45-95). (b) A **thin stratiform streak deck**, stratocumulus or altocumulus stratiformis seen at grazing angles, as long flat bands at 3-8 deg elevation (rows 100-190). (c) A **white haze band** at 0-3 deg with only faint streaks | ESTIMATED from appearance |
| Coverage | Blueness-mask fraction by elevation: 10-12.6 deg: 0.18; 7.8-10.2 deg: 0.30; 5.3-7.8 deg: 0.17; 2.8-5.3 deg: 0.13; below 2.8 deg: 0.03, where the mask fails because the clear sky is itself pale. Overall **about 25-30% of the visible sky** | SOURCED (px) / ESTIMATED total |
| Altitude | Cumulus base **about 0.6-1.0 km**. The top-right cloud spans 18 deg of azimuth at about 9 deg elevation, so its width is 2.0 x (base height). A typical 1.2-2 km cumulus width then gives a base of 0.6-1 km. The streak deck is consistent with a layer at 1-3 km seen 10-40 km away | ESTIMATED |
| Compression toward the horizon | For a flat layer, apparent depth scales with sin²(el). From 10 deg to 3 deg that is 11x flatter. Observed width:height is about 6:1 for the upper cumulus and 30-60:1 for the low streaks. Build the clouds on a curved layer at 1-2 km and let perspective do the compression; do not paint horizontal stripes | DERIVED / ESTIMATED |
| Under-lighting | With the sun behind the camera, the cumulus faces toward the camera are lit. Their bases are only about 20% darker than their tops (Y 0.69 against 0.86), so the clouds are thin | SOURCED (px) |

---

## 9. Overall grade

| Property | Value | Label |
|---|---|---|
| Exposure | Sunlit white paint sits just at clip: tower lit side 0.97 linear, 8-bit 252. The horizon sky is 0.83 and the top-of-frame sky 0.56. Whole-image mean Y (linear) is 0.43, median 0.39. Mean sRGB is (138, 162, 186) | SOURCED (px) |
| Highlights / blacks | 0.17% of pixels have a channel at 255 (tower, nacelle and TP highlights). Blacks are crushed: 0.5% of pixels have luma below 6.4 and the near-sea troughs reach 0. The waterline band reads as pure black. The tone curve is a mild S with a black clip | SOURCED (px) |
| Contrast | Near sea (Y about 0.03-0.06) against sky (0.56-0.84) is about **15-25 : 1** in linear light within one frame. Luma percentiles: 5% = 43, 50% = 166, 95% = 236 | SOURCED (px) |
| Saturation | Sky is low (mean HSV S 0.14). The sea is moderately high blue (0.45). The TP yellow is the most saturated element (S 0.52 lit, 0.81 in shade) | SOURCED (px) |
| White balance | Neutral daylight. Sunlit white paint is lin (0.973, 0.973, 0.965), essentially neutral. Shadows are blue from sky fill (#6a7687) and the airlight is cool (#e5ecf5). Aim for **no warm or cool cast on sunlit whites** | SOURCED (px) / ESTIMATED WB |
| Vignette | **None measurable.** The sky row just above the horizon is flat to ±3% across the frame (0.795-0.840). The left-right sea gradient is scene content (section 4) | SOURCED (px) |
| Sharpening | Mild unsharp-mask halos of +10-13 levels (about 5%), 1 px wide, next to dark blade tips. Examples: 238 and 237 against sky 226 at (432,96) and (429,98) | SOURCED (px) |
| Noise | Very clean: clear-sky patch std 0.6-1.2 levels, near-horizon 2.0. No visible grain; add none, or at most 1 level | SOURCED (px) |

---

## 10. Target checklist (compare the render at 760 x 506)

1. The horizon lies on **row 208 ± 1** across the full width and is dead level: the right end at most 1 px lower than the left.
2. The hero waterline (where the TP meets its reflection) is at **y 350 ± 2**, x ≈ 357. The hub is at **(362, 174) ± 2**.
3. The hero's tip radius spans **120 ± 3 px**. The rotor ellipse is about **0.79** as wide as it is tall (disc about 38 deg off the view axis).
4. Hero vertical stack above the waterline, as a fraction of waterline-to-hub: dark band **0.03**, top of yellow **0.22**, tower base/platform top **0.30**, nacelle underside **0.99**.
5. The yellow TP is **about 10 px wide** and the tower base **about 9.5 px**, tapering to **about 7 px** under the nacelle.
6. Each blade carries **three bands of about 10% of R**: dark red at the tip, then white, then dark red. On the shaded faces they read near-black maroon (#33090f to #3d1b28).
7. There are **19 turbines** on a **square grid** (spacing 8.5 H). Checkpoints: T580 base (581, 262), T97 (98, 251), T634 (634, 240), T306 (307, 235). Nothing stands at lattice positions beyond the i = 5 row.
8. The substation box is about **10 x 5.5 px at x 736-745**, sitting on the horizon, lit on the left.
9. Every structure is **lit from the left**. On the hero tower the terminator is near the right limb; the lit face is at 0.95+ linear and the shade limb about 0.18.
10. There is **no sun glitter anywhere** in the frame, and the brightest water is the band just below the horizon (Y about 0.60).
11. Sea luminance falls from **#b5cfe4 at the horizon** through **#79a0c3 at about 1 km** to **#33475c (mean) near the bottom edge**, following Y ≈ 0.586·exp(-0.134·depression in degrees) within ±25%.
12. The near foreground shows dark troughs close to **#000a1a** and sky-coloured facets about **#57708a**, with p90/p10 contrast above 10. The bottom-left is about **2x brighter** than the bottom-right, from reflected cumulus.
13. The wind sea is **short-crested, 5-8 m**, with a faint 25-30 m banding and **no whitecaps**. Mid-distance slick patches vary by ±10-15%.
14. Sky: **#9fcaeb at the top edge**, **#b2d5f2 about 44 px down** (10 deg), and **#e5ecf5 in the 0-1.5 deg haze band**, with luminance following the section 6.1 fit within ±0.03.
15. Clouds are **fair-weather cumulus (tops #efeef1, bases #cedaeb) in the top third**, plus a thin streak deck at 3-8 deg. Coverage is about **25-30%**, with the 0-2 deg band nearly clear.
16. Haze: TP yellow chroma at 2.5 km is about **0.65-0.70x** the hero's, and turbines at 4-5 km still read clearly (extinction about 1.1e-4 m⁻¹, airlight #e5ecf5). The 0.65-0.70 figure is measured at 760 x 506 and includes pixel mixing, which a render at the same size will also show. Extinction alone predicts about 0.77.
17. Far-turbine reflections are **vertical streaks 1.5-2.5x the TP height**, pale yellow-white. The hero's reflection is short and dark.
18. Grade: sunlit white just touches clip (252-255), blacks are slightly crushed, sunlit whites are neutral, there is no vignette, and there is at most a 1 px, 5% sharpening halo.

---

## Sources

- Reference photo: `reference/ref-1.png` (Borkum Riffgrund 1; not included in this repository). All SOURCED (px) values come from it.
- German AVV for marking aviation obstacles (2020), §14 (rotor-blade stripes) and §18 (offshore): https://www.verwaltungsvorschriften-im-internet.de/bsvwvbund_24042020_LF15.htm
- IALA Recommendation O-139, *The Marking of Man-Made Offshore Structures*, Ed. 2 (Dec 2013), §2.3 (yellow from HAT up to 15 m): https://vasab.org/wp-content/uploads/2018/06/2013_IALA_Marking-of-Man-Made-Offshore-Structures.pdf
- FAA AC 70/7460-1L, chapter 13 (superseded by -1M and -1N; faa.gov returned 403): https://documents.dps.ny.gov/public/Common/ViewDoc.aspx?DocRefId=%7BD3CAE7E7-AAC5-44E2-9F37-ECAF7036157D%7D
- Horizon dip and effective Earth radius: https://en.wikipedia.org/wiki/Horizon
- Koschmieder visibility relation: https://en.wikipedia.org/wiki/Visibility
- Deep-water dispersion: https://en.wikipedia.org/wiki/Dispersion_(water_waves)
- Pierson-Moskowitz spectrum and peak frequency: https://www.codecogs.com/library/engineering/fluid_mechanics/waves/spectra/pierson_moskowitz.php
- Beaufort sea-state descriptions: https://www.weather.gov/mfl/beaufort and https://www.spc.noaa.gov/faq/tornado/beaufort.html
- Team note on three.js r180 fog chunks: `research/three-r180-api.md`

## Reproduction

The helpers are in `research/photo-look-measure/`:
- `png.py` decodes the PNG into a numpy array.
- `col.py` holds the sRGB and linear conversions, luminance, and pixel elevation at f = 900 and pitch 3.10 deg.
- `cam.py` holds the turbine measurements and the pitched-camera model with dip and curvature.
- `wpng.py` writes zoomed crops.

To re-derive the tables: horizon fit (section 1.1), hub consistency, lattice fit and tower-edge lean (section 1.2), per-turbine back-projection (section 3), and the region medians and FFTs (sections 5-7).
