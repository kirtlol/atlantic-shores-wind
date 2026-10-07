# Turbine and foundation geometry for the NJ offshore wind scene

Research date: 2026-09-30. Scope: numbers and shapes a modeller or shader writer can use directly for a procedural Three.js (r180) scene.

**How the tags work.** Every hard number carries one tag:

- **SOURCED**: stated in the cited document. Where I only saw a search-engine excerpt of a page I could not open (paywall or bot wall), it says "(excerpt only)".
- **DERIVED**: arithmetic on sourced numbers or on pixel measurements, with the working shown.
- **ESTIMATED**: my judgement, with what it is based on. Do not quote these as specifications.

Source numbers such as [S12] refer to the list in section 12.

---

## 0. Summary for the team

1. **The reference photo is not a US farm.** `reference/ref-1.png` is the same image as Wikimedia Commons "Borkum Riffgrund 1.jpg", Ørsted's Borkum Riffgrund 1 farm off Germany [S1]. I checked this by resampling the 800×532 Commons file to 760×506: grey-level correlation with ref-1 is **0.986** and the mean absolute difference is about 8/255 per channel (DERIVED). Its turbines are Siemens 120 m-rotor machines. Power Technology's project page gives 78 × 3.6 MW, 120 m rotor, 58.5 m blades [S37]. A search summary names them SWT-4.0-120 (excerpt only), and the SWT-4.0-120 datasheet gives a 90 m hub [S36]. That 90 m is a model value, so for Borkum Riffgrund 1 itself it is ESTIMATED. The rotor/hub ratio I measure in the photo (0.68) agrees with 60/90 = 0.67.
2. **What that means for the scene:**
   - The **red–white–red blade tips** follow the German rule (AVV 2020 §14.1: from the tip, 6 m red, 6 m white or grey, 6 m red) [S6].
   - The **red/magenta patch at the rear of the nacelle** is the German nacelle stripe (AVV §14.2a) [S6].
   - **US turbines carry neither.** The FAA wants blades and nacelles solid white or light grey (AC 70/7460-1N §13.4) [S3], and the CVOW turbines off Virginia have plain white blades (Commons photo [S45]).
   - The **yellow transition piece (TP) is shared**: US guidance says RAL 1023 yellow from MHHW to 50 ft above it [S2].
3. **Best East Coast match to the photo: Siemens Gamesa SG 11.0-200 DD**, used at South Fork Wind (built) and Revolution Wind. It is Ørsted-operated like the photo farm, uses the same Siemens nacelle and blade design language, and its rotor-to-hub proportions are close (R/H = 100/133 = 0.75, against 0.67 in the photo). The full sheet is in section 3.
4. **The NJ-planned turbine is the Vestas V236-15.0 MW** (Atlantic Shores South, NJ; the same machine is being installed at Empire Wind 1, NY). The full sheet is in section 4. Ocean Wind 1's GE Haliade-X was cancelled on 2023-10-31 [S9]; a condensed sheet is in section 9.
5. **Blade planforms are not published by any manufacturer.** Chord, twist and thickness come from the public **IEA 15 MW reference turbine** (240 m rotor, 117 m blade) [S33], scaled geometrically. The V236's 115.5 m blade is almost the same size, so that scale factor is close to 1.

---

## 1. What the reference photo shows (pixel measurements)

The photo is 760×506 px. Measurements were made on a BMP converted with `sips`, using numpy.

| Quantity | Pixel measurement | Result | Tag |
|---|---|---|---|
| Hero rotor centre (centroid of the 3 tips) | tips at (432.5, 97), (274, 124), (397, 285) | (367.8, 168.7) px | DERIVED |
| Hero waterline | TP meets water at y ≈ 345 | — | DERIVED |
| Hub height in px | 345 − 168.7 | **176.3 px** | DERIVED |
| Rotor ellipse (affine fit to 3 tips) | semi-axes 120.5 / 92.2 px | minor/major 0.77 → rotor plane seen about 40° off-axis (acos 0.77) | DERIVED |
| Rotor radius / hub height | 120.5 / 176.3 | **0.68**. The hardware value is 60/90 = 0.667 [S36][S37] | DERIVED |
| Scale at the hero turbine | 90 m / 176.3 px (the 90 m hub is ESTIMATED for Borkum Riffgrund 1, from the SWT-4.0-120 datasheet [S36]) | **0.51 m/px** vertically | DERIVED |
| Tip bands along each blade (fraction of centre-to-tip distance) | colour samples on all 3 blades | red 0.70–0.80, light 0.81–0.89, red 0.90–~0.98. The outer 0.30 R is marked, which matches 18 m / 60 m = 0.30 for AVV 3×6 m bands [S6] | DERIVED |
| Yellow TP below the platform | y 312 → 345 = 33 px | 33 × 0.51 = **16.8 m** above the water at the time of the photo | DERIVED |
| Platform plus railing plus shadow band | y ≈ 300–312 | 12 px ≈ 6 m | DERIVED |
| Yellow collar above the platform | short band at y ≈ 298–302 | a few px, ≈ 1–2 m | DERIVED (low confidence) |
| TP width vs tower width near the base | ≈10 px vs ≈7 px (soft edges) | TP ≈ 1.4× tower (low confidence) | DERIVED |
| Nacelle side | visible length ≈18 px, height ≈7–8 px | box roughly 2.3:1 when seen 40° off-axis | DERIVED |
| Nacelle marking | rear top corner pixels (191,112,151) and (250,195,224) | magenta/red patch at the rear top | DERIVED |

**Colour samples from the photo (sRGB 0–255), for grading reference:**

| Surface | Lit side | Mid | Shade side |
|---|---|---|---|
| TP yellow | (255,241,130), (253,227,122) | (219,190,70) | (157,134,38) |
| Tower white | (254,252,253) | (240,241,243) | (159,171,187) (sky-blue fill) |
| Platform/railing grey | (230,234,233) | (182,185,190) | (62–84, 55–89, 26–95) |
| Red tip band (blade seen from its shaded side) | — | (92,38,48) | (40,10,12), (31,0,3) |

The photo is a sunny, slightly back-lit scene, so the blade faces toward the camera are shaded. That is why the red bands read almost black-red.

---

## 2. East Coast turbine roster

| Project (state) | Turbine | Units | Rotor | Blade | Hub height | Tip height | Foundation | Status | Sources |
|---|---|---|---|---|---|---|---|---|---|
| **Ocean Wind 1** (NJ) | GE Haliade-X 12 MW (selected) | up to 98 (PDE) | ≤240 m (788 ft) PDE | — | ≤156 m (512 ft) MLLW, PDE | ≤276 m (906 ft) MLLW, PDE; lowest tip ≥22 m (70.8 ft) MLLW | Monopile + yellow TP; pile 11.3 m (37 ft) at seabed, 8.2 m (27 ft) at sea surface | **Cancelled 2023-10-31** | SOURCED [S7][S8][S9] |
| **Atlantic Shores South** (NJ) | Vestas V236-15.0 MW (preferred supplier, install "expected in 2027" as of 2022) | up to 197 locations incl. OSS and met tower | 236 m (turbine); ≤280 m PDE | 115.5 m | ≤175 m (574 ft) AMSL, PDE | ≤319 m (1,046.6 ft) AMSL, PDE; lowest tip 23.1 m | Monopile or piled jacket; pile ≤15 m at seabed (PDE) | COP approved 2024-10-01. No construction start found in the sources I read | SOURCED [S10][S11][S12][S13][S14] |
| **South Fork Wind** (NY) | Siemens Gamesa SG 11.0-200 DD | 12 | 200 m | 97 m | envelope 100.9–143.9 m; ≤143.9 m (472 ft) MSL | ≤256 m (840 ft) MSL (12 MW envelope) | Monopile 11 m (36 ft) (envelope) | Completed 2024-03-14 | SOURCED [S20][S21][S22 excerpt only][S23] |
| **Revolution Wind** (RI/CT) | SG 11.0-200 DD | 65 | 200 m | 97 m | **133 m** | 233 m (133 + 100) | Monopile ≤39 ft (11.9 m) diameter, tapered 20–39 ft | Stop-work Aug 2025, lifted Sep 2025, operations expected H2 2026 | SOURCED [S24][S25]; tip DERIVED |
| **Vineyard Wind 1** (MA) | GE Haliade-X 13 MW | 62 (excerpt only) | 220 m | 107 m (351 ft) | ≈150 m (260 − 110) | 260 m (853 ft) (excerpt only) | Monopile + TP; envelope pile 7.5–10.3 m, TP 6.0–8.5 m | Operating (not verified here) | SOURCED [S26][S27][S28]; hub DERIVED |
| **CVOW commercial** (VA) | SG 14-222 DD (14.6 MW) | 176 | 222 m (PDE 221–232) | 108 m | 147 m (482 ft); PDE 136–149 m MSL | PDE 245–265 m MSL | Monopile up to 83 m long, 10 m diameter, 1,500 t; PDE pile 31 ft (9.4 m), 36 ft (11.0 m) "diameter at HAT" | About 50 % complete Feb 2025; completion targeted end 2026 | SOURCED [S29][S30][S31] |
| **Empire Wind 1** (NY) | Vestas V236-15 MW | 54 (search excerpt); site gives 138 for EW1+EW2 | 236 m (774 ft) | 115.5 m | **≈152 m** (270 − 118). Wikipedia says 160 m, which is the PDE maximum and does not reconcile | **270 m (886 ft)** | Monopile: PDE 11 m at base, 10 m at MSL | First power expected 2026-12-31 after 2025 stop-work orders | SOURCED [S17][S18][S19]; hub DERIVED |
| **Block Island** (RI) | GE Haliade 150-6 MW | 5 | 150 m | — | 100 m | ≈175 m (100 + 75) | **Jacket** (Gulf Island Fabrication), water depth 22–31 m | Commissioned 2016-12-12 | SOURCED [S32]; tip DERIVED |
| *(Not in the task list)* CVOW pilot (VA) | Siemens SWT-6.0-154 | 2 | 154 m | — | — | — | Monopile + yellow TP | Operating since Oct 2020 | SOURCED [S30]. The best US photo of a yellow TP [S45] |

---

## 3. Which East Coast turbine best matches the photo

| Cue in ref-1 | SG 11.0-200 DD | V236-15.0 | Haliade-X 12/13 |
|---|---|---|---|
| Nacelle: plain rectangular box, flat roof, small blunt spinner | **Yes.** Same Siemens box nacelle family; a DD generator ring sits between the hub and the box (ESTIMATED from the SG 14-222 DD photo [S46]) | Large box with a cooler-top module and heli-hoist module [S13] | Large box with rounded vertical edges, a ribbed generator ring and heli-hoist railings on the roof (ESTIMATED from Commons photo [S47] and OW COP render [S8]) |
| Slender blades | **Yes** (Siemens IntegralBlade B97) | Yes | Yes, with visibly fat roots |
| R/H in the photo is 0.68 | 100/133 = **0.75** | 118/152 = 0.78 | 110/150 = 0.73 |
| Same operator and TP style as the photo (Ørsted, yellow TP, grey cantilever platform) | **Yes** (Ørsted built South Fork and Revolution Wind) | Atlantic Shores (NJ) / Empire Wind (NY) developers | Ørsted (OW1, cancelled); Avangrid/CIP (Vineyard Wind) |
| Red tip bands | No (US) | No (US) | No (US) |

**Verdict: SG 11.0-200 DD** (ESTIMATED judgement from the cues above). The visual lineage is the same and so is the operator. It also has the smallest scale jump from the photo: the rotor is 1.67× the photo turbine's, against 1.97× for the V236. For a "hero at about 400 m" shot the silhouette will read most like the photo.

**Scale warning.** The photo's hero turbine is 90 m to the hub. Every East Coast machine is 133–152 m to the hub, and the TP and platform stay about the same absolute size. On a modern turbine the TP will therefore look **smaller relative to the tower** than in the photo. The yellow band is still about 16–21 m tall, but it becomes roughly 12–15 % of hub height instead of 19 % (DERIVED: 17/133 = 0.13, 21/152 = 0.14).

---

## 4. Modelling sheet A: Siemens Gamesa SG 11.0-200 DD (Revolution Wind / South Fork configuration)

### 4.1 Global geometry and operation

| Parameter | Value | Tag and basis |
|---|---|---|
| Rated power | 11.0 MW | SOURCED [S23] |
| Rotor diameter | 200 m (R = 100 m) | SOURCED [S23] |
| Blade length | 97 m | SOURCED [S23] |
| Swept area | 31,400 m² | SOURCED [S23] |
| Hub height | **133 m** above sea level | SOURCED [S25] (Revolution Wind). South Fork envelope 100.9–143.9 m [S22 excerpt only], ≤143.9 m MSL [S20] |
| Tip height / lowest tip | 233 m / 33 m | DERIVED: 133 ± 100 |
| Hub (blade-root circle) radius | 3.3 m | ESTIMATED: IEA 15 MW hub radius 3.97 m [S33] × (100/120) |
| Blade count | 3 | SOURCED [S24] |
| Rotor tilt | 6° | ESTIMATED from IEA 15 MW uptilt 6.0° [S33] |
| Pre-cone | 4° (rotor opens upwind) | ESTIMATED from IEA 15 MW cone 4.0° [S33] |
| Tip prebend | 3.3 m upwind (toward the wind, away from the tower) | ESTIMATED: IEA 4.0 m × (97/117) [S33] |
| Overhang (tower axis to hub centre, horizontal) | ≈10 m | ESTIMATED: IEA 11.0–12.0 m [S33] × 0.83 |
| Tower top to hub centre (vertical) | ≈4.7 m | ESTIMATED: IEA 5.614 m [S33] × 0.83 |
| Max tip speed | ~95 m/s | ESTIMATED from IEA 15 MW max tip speed 95 m/s [S33] |
| Rated / max rotor speed | **≈9.1 rpm** | DERIVED: 95 / 100 × 60 / 2π = 9.07 rpm. A search excerpt of wind-turbine-models.com also shows "max 9.1 U/min"; the page itself is behind a bot check |
| Min rotor speed (cut-in) | ≈5–6 rpm | ESTIMATED (IEA 15 MW min 5.0 rpm [S33]; exact value set by tower frequency, unpublished) |
| rpm at 6 / 7 / 8 / 9 / 10 m/s | **5.2 / 6.0 / 6.9 / 7.7 / 8.6 rpm**, capped at ≈9.1 | DERIVED: Ω = λV/R with λ = 9.0 (IEA 15 MW optimal TSR [S33]) |
| Cut-in / cut-out wind | ≈3–5 m/s / ≈30 m/s | ESTIMATED from sibling SG 14-222 DD: CVOW PDE gives 11.2 mph = 5.0 m/s and 67.1 mph = 30.0 m/s [S29] |
| Drivetrain | Direct drive (no gearbox) | SOURCED (name "DD"; [S31]) |

### 4.2 Blade planform (scaled from the IEA 15 MW RWT)

The scale factor is k = 97/117 = 0.829 (DERIVED). Chord, thickness and prebend scale by k. Twist and t/c are unchanged. r = 3.3 + s·97 m.

| Span s | r (m) | Chord (m) | Twist (°) | t/c | Abs. thickness (m) | Prebend (m, − = upwind) |
|---|---|---|---|---|---|---|
| 0.000 | 3.3 | 4.31 | +15.59 | 1.000 | 4.31 | 0.00 |
| 0.020 | 5.2 | 4.32 | +15.59 | 1.000 | 4.32 | +0.01 |
| 0.050 | 8.2 | 4.36 | +15.21 | 0.939 | 4.10 | +0.05 |
| 0.100 | 13.0 | 4.51 | +13.49 | 0.704 | 3.18 | +0.11 |
| 0.150 | 17.8 | 4.68 | +11.03 | 0.502 | 2.35 | +0.17 |
| 0.207 | 23.4 | **4.78 (max)** | +8.43 | 0.399 | 1.91 | +0.21 |
| 0.250 | 27.6 | 4.71 | +7.03 | 0.358 | 1.68 | +0.21 |
| 0.300 | 32.4 | 4.45 | +5.52 | 0.338 | 1.51 | +0.20 |
| 0.400 | 42.1 | 3.90 | +3.22 | 0.311 | 1.21 | +0.16 |
| 0.500 | 51.8 | 3.44 | +1.69 | 0.282 | 0.97 | −0.05 |
| 0.600 | 61.5 | 3.04 | +0.56 | 0.251 | 0.77 | −0.41 |
| 0.700 | 71.2 | 2.67 | −0.49 | 0.223 | 0.60 | −0.96 |
| 0.800 | 80.9 | 2.30 | −1.94 | 0.211 | 0.48 | −1.62 |
| 0.900 | 90.6 | 1.88 | −2.10 | 0.211 | 0.40 | −2.40 |
| 0.950 | 95.4 | 1.65 | −1.82 | 0.211 | 0.35 | −2.84 |
| 0.980 | 98.4 | 1.51 | −1.50 | 0.211 | 0.32 | −3.12 |
| 0.995 | 99.8 | 1.22 | −1.31 | 0.211 | 0.26 | −3.27 |
| 1.000 | 100.3 | 0.41 | −1.24 | 0.211 | 0.09 | −3.32 |

All values in this table are DERIVED from [S33] × k. Treat them as ESTIMATED for the real B97 blade.

Key points:

- Root diameter is **4.3 m** (ESTIMATED: IEA 5.2 m × k).
- Max chord is **4.8 m at r ≈ 23 m (r/R ≈ 0.23)**. For comparison, the Vineyard Wind envelope for 164–222 m rotors gives a max chord of 5.0–7.5 m [S26], and the Revolution Wind envelope gives a "blade width" of 5–8 m [S24]. The real B97 may be a little wider than this scaled value.
- Tip chord is about 1.5 m until the last 2 % of span, then a rounded taper to about 0.4 m.

### 4.3 Nacelle, generator, hub

| Part | Modelling value | Tag and basis |
|---|---|---|
| Envelope dims for 8–12 MW WTGs at Revolution Wind (L × W × H) | 14×7×6 m (8 MW) to 22×10×12 m (12 MW) | SOURCED [S24] |
| Interpolated for 11 MW | 20.0 × 9.25 × 10.5 m overall | DERIVED: fraction (11−8)/(12−8) = 0.75 of the way from min to max. This is an upper bound |
| **Recommended overall** (spinner nose to rear wall) | ≈20 m | ESTIMATED: sum of the three parts below |
| Spinner/hub | Blunt rounded dome ("half ellipsoid"), max Ø ≈6.6 m, length ≈6 m, same light grey as the nacelle. The three blade-root openings sit on the dome's widest ring | ESTIMATED: IEA hub Ø7.94 m [S33] × 0.83; shape from the SG 14-222 DD photo [S46] |
| Direct-drive generator ring | Cylinder Ø ≈8.8 m, axial length ≈2.5 m, between the hub and the nacelle front wall. Its underside reads darker/shadowed in photos | ESTIMATED: IEA generator radius 5.309 m → Ø10.6 m [S33] × 0.83; placement from [S46] |
| Nacelle box | L ≈12 m × W ≈8 m × H ≈8.5 m. Flat roof, flat sides, vertical edges rounded (r ≈0.6–0.8 m), front face mates with the generator, flat rear wall | ESTIMATED from [S46] (nacelle height ≈1.6× tower-top Ø in the photo) and the envelope above |
| Roof items | Heli-hoist platform (railed, ≈1.1 m rails) on the rear half of the roof; small met mast (wind vane and anemometer) at the rear; **2 aviation lights on opposite sides of the roof** | Lights: SOURCED [S3 §13.6.2]. Platform and mast: ESTIMATED from Haliade-X photo [S47] and Siemens DD practice |
| Colour | Light grey RAL 7035 (or anything up to RAL 9010 pure white), matte | SOURCED [S3 §13.4.1][S24]; "usually painted matte grey" [S4] |

### 4.4 Tower

| Parameter | Value | Tag and basis |
|---|---|---|
| Base (at the TP flange) | +21 m above MSL | ESTIMATED: Vineyard Wind interface 19.5–22.5 m MLLW [S26] |
| Tower top | ≈128.3 m | DERIVED: 133 − 4.7 |
| Tower length | ≈107 m | DERIVED: 128.3 − 21 |
| Base diameter | **8.0 m** | ESTIMATED: IEA 10.0 m [S33] × 0.83 = 8.3 m; Vineyard Wind envelope 6.0–8.5 m [S26] |
| Top diameter | **5.5 m** | ESTIMATED: IEA 6.5 m × 0.83 = 5.4 m; Revolution Wind "base (tower) width at the top" 4–6.4 m [S24] |
| Taper shape (η = height fraction from base) | D/D_base = 1.000, 1.000, 0.993, 0.944, 0.883, 0.815, 0.739, 0.691, 0.675, 0.657, 0.650 at η = 0, 0.1, …, 1.0 | DERIVED from the IEA 15 MW tower table [S33]: flat for the lowest 20 %, steepest taper at 40–60 % |
| Sections/flanges | 3 sections of ≈35 m. Show each flange joint as a thin (≈5–10 cm) darker ring. Faint circumferential weld seams about every 3–4 m | Sections: ESTIMATED by analogy with Vineyard Wind's 31.7 / 39.8 / 39.8 m sections (104 / 130.5 / 130.5 ft) [S27]. Seams: ESTIMATED from the CVOW photo [S45] |
| Colour | RAL 7035 light grey, semi-matte | SOURCED range [S2][S3] |
| Door | One door ≈1.0 m wide × 2.2 m tall, rounded corners, at platform level (entry from the external platform into the TP/tower base), usually facing the boat landing | ESTIMATED; no source gives door geometry |
| Mid-mast aviation lights | Ring of **4 L-810 F** red lights at ≈ half the nacelle-top height (≈69 m) | SOURCED rule [S3 §13.7.2–13.7.4]: tip ≥699 ft needs ≥3 lights, 4 if the mast Ø >20 ft. DERIVED: 764 ft tip; mast Ø at mid-height ≈6.9 m |

### 4.5 Foundation (see section 5 for TP and platform details)

| Parameter | Value | Tag and basis |
|---|---|---|
| Monopile diameter | 6.1–11.9 m tapered (Revolution Wind); 11 m (South Fork envelope) | SOURCED [S24][S20] |
| Diameter at the waterline (TP outer) | **≈8.5 m** | ESTIMATED: slightly larger than the 8.0 m tower base; TP envelope 6.0–8.5 m [S26] |

---

## 5. Transition piece and secondary steel (US practice, used for both sheets)

### 5.1 Datums for NJ

| Datum | Value | Tag |
|---|---|---|
| MHHW above MLLW (Ocean Wind 1 site) | 4.6 ft = **1.40 m** | SOURCED [S8] (Fig. 6.1.1-2) |
| MSL above MLLW | ≈0.7 m | ESTIMATED: mid-tide |
| Required yellow, top | MHHW + 50 ft → 1.40 + 15.24 = **16.64 m above MLLW** (≈15.9 m above MSL) | DERIVED from [S2] |
| Lowest rotor tip | ≥75 ft (22.9 m) above HAT | SOURCED [S4] |

### 5.2 TP body

| Item | Value | Tag and basis |
|---|---|---|
| Colour | **RAL 1023 traffic yellow**, all around, from MHHW to ≥50 ft (15.24 m) above MHHW | SOURCED [S2] (BOEM 2021 §III.A); RW PDE [S24]; IALA O-139: yellow from HAT up to 15 m [S5] |
| Practical yellow extent | Yellow up to the TP top flange, typically 2–5 m above the platform deck, with the tower (grey) starting at the flange | ESTIMATED from the CVOW pilot photo (yellow runs ≈22 % of the yellow height above the deck [S45]) and ref-1 (short yellow collar above the deck) |
| TP outer diameter | 6.0–8.5 m (Vineyard Wind envelope) | SOURCED [S26]. Use 8.5 m (SG 11) or 10.0 m (V236; Empire Wind PDE "diameter at MSL 10 m" [S18]) |
| TP length | 18–30 m (overlaps the pile below water) | SOURCED [S26] |
| Interface (TP top flange) level | 19.5–22.5 m MLLW (figure) / 19–23 m MLLW (table) | SOURCED [S26]. Use **+21 m MSL** |
| Bolted flange at the TP top | Outward ring flange, about 0.3 m proud of the shell and ≈0.3 m tall, with a visible bolt circle | ESTIMATED (typical L-flange appearance) |
| Bearing marks | Painted black compass bearings ("S 180°", "E 90°") with vertical tick lines on the TP a few metres above the water | ESTIMATED from the CVOW pilot photo [S45] |
| Marine growth (splash/tidal zone) | Dark olive-brown to black band with barnacles/weed, from below LAT to ≈1 m above MHHW, fading upward. **About 1.5–2.5 m tall** in NJ (tidal range 1.4 m plus wave wash) | ESTIMATED. Tidal range SOURCED [S8]; the dark waterline band is visible in ref-1 and in [S45] |
| Below-water pile colour | Not visible in normal views. Where it shows (troughs, clear water), use dark red-brown/black | ESTIMATED (monopile being lifted in the Vineyard Wind COP Fig 3.1-4 [S26] is dark brown with a grey top) |

### 5.3 External work platform

| Item | Value | Tag and basis |
|---|---|---|
| Deck level | ≈**+17.5 m MSL** (below the flange) | ESTIMATED: ref-1 yellow below deck 16.8 m (DERIVED, section 1); Vineyard Wind "platform level and interface 19–23 m MLLW" [S26] |
| Plan shape | Annular ring around the TP. Ring width ≈0.45–0.5× TP diameter (≈3–4 m), extended into a larger lobe on the boat-landing side that carries the davit crane | ESTIMATED from the CVOW pilot photo: platform span ≈1.94× TP diameter [S45]; Veja Mate photos in the VW COP [S26] |
| Underside | Conical/sloped skirt about 1 m deep between deck edge and TP, grey | ESTIMATED from [S45] |
| Deck | Galvanised grating, grey | ESTIMATED from ref-1 platform colours (section 1) |
| Guard-rail | **≥1,100 mm** high with knee rail(s) (≤500 mm clear gaps) and toe plate. Model as 2 horizontal rails plus a top rail, posts every ≈1.5 m, grey or yellow | Height and gap SOURCED [S40] (EN ISO 14122-3). Post spacing ESTIMATED |
| Davit crane | Slewing jib ≈4–5 m long, knuckle/lattice or box section, at the platform edge above the boat landing, white/grey | ESTIMATED from [S45]. Existence SOURCED: "the transition piece includes boat landing features, ladders, a crane" [S8] |
| Marine lanterns | 2 yellow LED lanterns on opposite corners of the platform/TP top, same horizontal plane, **≈20–23 m MLLW** | SOURCED [S24]; Vineyard Wind "top of the work platform, 19–30 m MLLW" [S26] |
| ID panel on the railing | Black characters on a white or yellow rectangular panel ≈1 m high, e.g. "CV A02" | Panel size SOURCED (IALA: 1 m high, black on yellow [S5]); example ESTIMATED from [S45] |

### 5.4 Boat landing (Carbon Trust / OWA recommended geometry, SOURCED [S38])

| Item | Value |
|---|---|
| Layout | 2 vertical bumper tubes with a vertical ladder centred between and behind them |
| Bumper tube diameter | **406 mm** |
| Tube spacing (centreline to centreline) | **1,800 mm** |
| Tube front face to ladder-rung centreline | **850 mm** recommended (770 mm "commonly used" in UK/EU) |
| Safe-zone clearance | 500 mm from the ladder face (ACP/G+: 500–650 mm step-over [S39]) |
| Ladder width (between stiles) | 400–600 mm |
| Rungs | 30×30 mm square bar set diamond-wise, 225–300 mm pitch |
| Tube top | ≥ HAT + 7.6 m |
| Tube bottom | LAT −1.9 m (calculated) to LAT −2.9 m (with a 1 m margin). Bottom ends are straight or angled 60° inward to stop a vessel getting trapped |
| Supports | Horizontal stub members from the TP to the tubes at top and bottom (plus intermediate supports) |
| Ladder climb | ≤12 m between rest platforms, so there is a rest platform part-way up |
| Colour | BOEM: ladders "may be painted in a color that contrasts with the recommended yellow" [S2]. Observed US and EU practice is yellow ladders and tubes (ESTIMATED from [S45]) |

---

## 6. Modelling sheet B: Vestas V236-15.0 MW (NJ: Atlantic Shores South; NY: Empire Wind 1)

### 6.1 Global geometry and operation

| Parameter | Value | Tag and basis |
|---|---|---|
| Rated power | 15.0 MW | SOURCED [S14] |
| Rotor diameter | 236 m (R = 118 m) | SOURCED [S14] |
| Blade length | 115.5 m | SOURCED [S14][S15] |
| Swept area | 43,742 m² | SOURCED [S14] |
| Hub height | **152 m** above sea level (East Coast value) | DERIVED: Empire Wind tip 886 ft = 270 m [S17] − 118. Hub heights are site-specific [S14]. Atlantic Shores envelope ≤175 m AMSL [S11]. The Østerild prototype stands 280 m tall [S15] (→ ≈162 m hub, DERIVED) |
| Tip / lowest tip | 270 m / 34 m | DERIVED |
| Hub radius | 3.5 m | ESTIMATED so that (3.5 + 115.5)·cos 4° = 118.7 m ≈ 118 m (DERIVED) |
| Tilt / cone / prebend | 6° / 4° / 3.95 m upwind | ESTIMATED from IEA 15 MW [S33] (prebend × 115.5/117) |
| Overhang / tower-top-to-hub | ≈12 m / ≈5.6 m | ESTIMATED from IEA 15 MW 11.0–12.0 m / 5.614 m [S33] |
| Gearbox | Medium-speed, so there is **no external generator ring**; the hub mates to the nacelle front | SOURCED [S14] ("medium speed"); silhouette consequence ESTIMATED |
| Cut-in / cut-out | 3 m/s / 31 m/s | SOURCED [S14] |
| Max rotor speed | ≈7.7–8.1 rpm | DERIVED from tip speed 95–100 m/s (ESTIMATED; Windpower Monthly excerpt only notes an "increased tip speed"): 95/118×9.549 = 7.69; 100/118×9.549 = 8.09 |
| rpm at 6 / 7 / 8 / 9 / 10 m/s | **4.4 / 5.1 / 5.8 / 6.6 / 7.3 rpm** | DERIVED: λ = 9 [S33], Ω = λV/R |

### 6.2 Blade planform

Scale factor k = 115.5/117 = 0.987. The IEA 15 MW blade is a near 1:1 proxy. r = 3.5 + s·115.5 m.

| Span s | r (m) | Chord (m) | Twist (°) | t/c | Abs. thickness (m) | Prebend (m, − = upwind) |
|---|---|---|---|---|---|---|
| 0.000 | 3.5 | 5.13 | +15.59 | 1.000 | 5.13 | 0.00 |
| 0.020 | 5.8 | 5.14 | +15.59 | 1.000 | 5.14 | +0.02 |
| 0.050 | 9.3 | 5.19 | +15.21 | 0.939 | 4.88 | +0.05 |
| 0.100 | 15.1 | 5.37 | +13.49 | 0.704 | 3.79 | +0.13 |
| 0.150 | 20.8 | 5.58 | +11.03 | 0.502 | 2.80 | +0.21 |
| 0.207 | 27.4 | **5.69 (max)** | +8.43 | 0.399 | 2.27 | +0.25 |
| 0.250 | 32.4 | 5.61 | +7.03 | 0.358 | 2.01 | +0.25 |
| 0.300 | 38.1 | 5.30 | +5.52 | 0.338 | 1.79 | +0.24 |
| 0.400 | 49.7 | 4.64 | +3.22 | 0.311 | 1.44 | +0.20 |
| 0.500 | 61.2 | 4.10 | +1.69 | 0.282 | 1.16 | −0.05 |
| 0.600 | 72.8 | 3.63 | +0.56 | 0.251 | 0.91 | −0.49 |
| 0.700 | 84.3 | 3.18 | −0.49 | 0.223 | 0.71 | −1.14 |
| 0.800 | 95.9 | 2.73 | −1.94 | 0.211 | 0.58 | −1.93 |
| 0.900 | 107.5 | 2.24 | −2.10 | 0.211 | 0.47 | −2.86 |
| 0.950 | 113.2 | 1.96 | −1.82 | 0.211 | 0.41 | −3.39 |
| 0.980 | 116.7 | 1.79 | −1.50 | 0.211 | 0.38 | −3.72 |
| 0.995 | 118.4 | 1.45 | −1.31 | 0.211 | 0.31 | −3.89 |
| 1.000 | 119.0 | 0.49 | −1.24 | 0.211 | 0.10 | −3.95 |

All values are DERIVED from [S33] × k and ESTIMATED for the real Vestas blade.

### 6.3 Nacelle and hub

| Part | Value | Tag and basis |
|---|---|---|
| Nacelle height × width | **11 m × 9 m** | SOURCED (excerpt only) [S16] |
| Overall length incl. heli-hoist deck and hub | **28 m** | SOURCED (excerpt only) [S16] |
| Modules | Hub, **cooler top**, **heli-hoist** (assembled at the NJ Wind Port) | SOURCED [S13] |
| Recommended split | Spinner/hub ≈6 m long, Ø ≈7.5 m, rounded cone. Nacelle box ≈19 m long, 9 m wide, 11 m tall (flat sides, rounded top edges r ≈1 m). Heli-hoist deck (railed, ≈1.1 m rails) over the rear ≈3 m, flush with or slightly aft of the rear wall. Cooler-top frame (open radiator grid) on the rear third of the roof, ≈1.5–2 m tall | ESTIMATED: split of the sourced 28 m; hub Ø = IEA 7.94 m × 0.95 |
| Envelope check (Atlantic Shores max) | 82 × 52.5 × 39.4 ft = 25.0 × 16.0 × 12.0 m; nacelle top ≤603.7 ft vs hub ≤574.2 ft → nacelle top ≈9 m above the hub | SOURCED [S11]; DERIVED conversions |
| Colour | RAL 7035 light grey, matte | SOURCED range [S2][S3] |
| Aviation lights | 2 × L-864 on opposite sides of the roof. Nacelle top ≈158–161 m | Rule SOURCED [S3]; height DERIVED: 152 + 6 to 9 |

### 6.4 Tower and foundation

| Parameter | Value | Tag and basis |
|---|---|---|
| Tower base / top diameter | **10.0 m / 7.5 m** | Base: SOURCED as the Atlantic Shores max 32.8 ft = 10.0 m [S11], equal to IEA 15 MW 10.0 m [S33]. Top: ESTIMATED between IEA 6.5 m and Atlantic Shores max 27.9 ft = 8.5 m |
| Tower base / top level | +21 m / ≈146.4 m (152 − 5.6) | ESTIMATED / DERIVED |
| Tower length | ≈125 m | DERIVED |
| Taper shape | Same η table as sheet A | DERIVED from [S33] |
| Sections | 3–4 sections of ≈30–40 m | ESTIMATED by analogy with [S27] |
| Mid-mast lights | 4 × L-810 F at ≈79 m | DERIVED from the [S3 §13.7] rule; tip 886 ft |
| Monopile | Empire Wind PDE: 11 m at base, 10 m at MSL. Atlantic Shores PDE: ≤15 m at seabed | SOURCED [S18][S11] |
| TP at the waterline | ≈10.0–10.5 m Ø | ESTIMATED from [S18] |

---

## 7. Markings and lights

### 7.1 Paint colours (sRGB values are approximate; RAL-to-sRGB conversions differ between tables)

| Use | RAL | sRGB (hex) | sRGB (table 2) | Tag |
|---|---|---|---|---|
| Tower, nacelle, blades (US: anything from RAL 9010 to RAL 7035; "most turbines are RAL 7035") | 7035 light grey | #CBD0CC | (197,199,196) | Rule SOURCED [S2][S3]; values SOURCED [S42] |
| Lightest allowed | 9010 pure white | #F7F9EF | (241,236,225) | [S3][S42] |
| Foundation/TP yellow | **1023 traffic yellow** | **#F7B500** | (247,181,0) | [S2][S42] |
| German tip bands / nacelle stripe (photo) | 3020 traffic red, or 2009 traffic orange | #C1121C / #E15501 | (184,29,19) / (218,83,10) | Allowed combinations: 3020 with 9002, 7038 or 7035; or 2009 with 9016 [S6 §4.1]; values [S42] |
| German "white" band options | 9002 / 7038 / 7035 / 9016 | #DDDED4 / #B4B8B0 / #CBD0CC / #F7FBF5 | — | [S6][S42] |
| ID characters | Black, retro-reflective | — | — | [S2][S26] |

### 7.2 Blade tip bands and nacelle stripe

| Regime | Rule | Tag |
|---|---|---|
| **US (FAA)** | No tip bands. Nacelle and blades stay solid white or light grey. Blades must not be coloured to camouflage the turbine | SOURCED [S3 §13.4.1–13.4.4]; observed at CVOW [S45] |
| **Germany (the photo)** | **3 bands from the tip: 6 m red – 6 m white/grey – 6 m red** (or orange–white–orange) | SOURCED [S6 §14.1] |
| Germany, turbines >150 m | ≥2 m orange/red stripe around the rear of the nacelle at half nacelle height (graphics may interrupt it); 3 m red ring on the tower starting 40 m above water (applies offshore too, per §18) | SOURCED [S6 §14.2, §18] |
| Photo-matched art direction on an East Coast rotor | 6 m bands would cover only 18/100 = 18 % of an SG 11 radius, against 30 % in the photo. To reproduce the photo's look, use 3 bands of **0.10 R each** (10 m on SG 11, 11.8 m on V236). This is **not US-accurate** | DERIVED |

### 7.3 Aviation obstruction lights (FAA AC 70/7460-1N, 11 Aug 2026, which supersedes 1M; BOEM 2021)

| Item | Value | Tag |
|---|---|---|
| Type | **L-864** medium-intensity red flashing, **2,000 cd (±25 %)** at night | SOURCED [S3 §13.5.1, Table B-1] |
| Rate | 20–40 fpm generally; **30 fpm (±3)** when used with L-810 F; BOEM recommends 30 fpm | SOURCED [S3][S2] |
| Synchronisation | Every light in the farm flashes simultaneously, within **±0.05 s** | SOURCED [S3 §13.5.1][S2] |
| Nacelle lights (tip >499 ft) | **2 × L-864 on opposite sides of the nacelle roof**, as high as possible, all turbines lit | SOURCED [S3 §13.6] |
| Mid-mast (tip ≥699 ft) | ≥3 L-810 F (4 if the mast Ø >20 ft), midway between nacelle top and sea, flashing with the nacelle lights | SOURCED [S3 §13.7] |
| Example heights (Revolution Wind) | Nacelle lights ≈161.5 m (530 ft); tower lights ≈95 m (312 ft) | SOURCED [S24] |
| Colour and IR | Red, with an IR component at 800–900 nm (for night-vision goggles, invisible to the eye). Lights are shielded so that they are not visible to mariners below their horizontal plane | SOURCED [S2][S8] |
| Flash shape for rendering | 2.0 s period, ≈0.5–0.7 s on with fast rise and fall (LED) | Period DERIVED (60/30). On-time ESTIMATED; not in the documents read |
| **ADLS** | Proposed at Ocean Wind 1 and Vineyard Wind. Lights stay **OFF** unless an aircraft is inside 3 NM and between 200 ft above the surface and 1,000 ft above the tallest turbine. Lights then stay on until it leaves (30-minute timer if track is lost). **A realistic quiet night can show no red lights at all** | SOURCED [S3 §10.2][S8][S26] |

### 7.4 Marine navigation marks (USCG NVIC 03-23; BOEM 2021; IALA O-139)

| Position in farm | Character | Range | Tag |
|---|---|---|---|
| **SPS** (corners / significant points, ≤3 NM apart) | **Quick flashing yellow, Q Y: 0.3 s on / 0.7 s off**, all SPS synchronised | ≥5 NM | SOURCED [S4][S2][S5] |
| **IPS** (perimeter between SPS) | **Fl Y 2.5 s: 1.0 s on / 1.5 s off**, synchronised | ≥3 NM (BOEM, USCG); IALA ≥2 NM | SOURCED [S4][S2][S5] |
| Inner boundary | Fl Y 6 s or 10 s | 2 NM | SOURCED [S2][S4] |
| All other turbines | Fl Y 15 s | 1 NM | SOURCED [S2] |
| Flash on-time for 6/10/15 s characters | ≈1 s | ESTIMATED |
| Lantern placement | Below the rotor arc, near the top of the yellow section; 2 lanterns on opposite corners at ≈20–23 m MLLW | SOURCED [S4][S24] |
| Lantern hardware | Compact LED marine lantern, ≈0.3–0.5 m tall, yellow lens, on the railing or TP top | ESTIMATED |
| Operating hours | Sunset to sunrise, and in daytime restricted visibility | SOURCED [S2] |
| ID characters | Unique alphanumeric; **≈3.0 m (9.8 ft)** tall (NVIC: ≈9 ft); bottom 30–50 ft (9.1–15.2 m) above MHHW; visible over 360° above the platform; retro-reflective; duplicated smaller below the platform | SOURCED [S2][S4] |
| Retro-reflective bands (optional) | White, yellow or silver bands ≥2 ft (0.61 m) tall, ≥30 ft above MHHW | SOURCED [S2] |
| **Sound signals** | On all SPS, and on IPS as needed so they are ≤3 NM apart. **4 s blast every ≤30 s**, 2 NM range; switched on when visibility <5 NM or by keying VHF ch. 83A (1083) five times in 10 s (MRASS), then sounds for 45 min. Revolution Wind spec: **134 dB at 1 m, 660 Hz** | SOURCED [S2][S4][S24] |
| AIS AtoN | On all SPS | SOURCED [S2][S4] |

---

## 8. Operating behaviour (for animation)

| Behaviour | Value | Tag |
|---|---|---|
| Orientation | All rotors are upwind and face into the wind | SOURCED (IEA 15 MW "Upwind" [S33]; OW COP: nacelle "rotate[s] to face the oncoming wind" [S8]) |
| Yaw rate | ≈0.5 °/s | SOURCED [S33] (yaml `yaw_rate: 0.498`; units assumed deg/s) |
| Yaw response lag | ≈3 min between a wind-direction change and the yaw move (observed on a commercial farm) | SOURCED [S41] |
| Turbine-to-turbine yaw scatter | ±2–5° random per turbine (σ ≈3°); keep constant over seconds and drift over minutes | ESTIMATED; no numeric source found |
| Wake steering | Research campaigns used offsets ≤20° at ≤12 m/s. **Not normal practice** in US farms; do not show large offsets | SOURCED [S41] |
| Blade pitch below rated | **0° (fine pitch)** from ≈7 to 10.6 m/s; 3.4° at 3–4 m/s, easing to 0° by ≈7 m/s (IEA 15 MW min-pitch schedule) | SOURCED [S33] |
| Blade pitch above rated | Rises progressively. The IEA min-pitch floor reaches ≈8° at 17 m/s and ≈15° at 25 m/s; actual pitch is at or above that floor | SOURCED floor [S33]; behaviour ESTIMATED |
| Parked / idling | Feathered to ≈90° (IEA max pitch 89.95°), slow idle or stopped | SOURCED limit [S33] |
| Rated wind (IEA 15 MW) | 10.59 m/s | SOURCED [S33] |
| rpm at 8–10 m/s | SG 11: 6.9–8.6. V236: 5.8–7.3. Haliade-X: 6.25–7.8. IEA 15: 5.7–7.2 | DERIVED (λ = 9) |
| Rotor phase between turbines | Independent. Never synchronise blade azimuths | ESTIMATED |

---

## 9. Condensed sheets: other East Coast machines

| Parameter | GE Haliade-X 12/13 (OW1 planned, VW1 built) | SG 14-222 DD (CVOW) | GE Haliade 150-6 (Block Island) |
|---|---|---|---|
| Rotor / blade | 220 m / 107 m (LM Wind Power) [S27][S44] | 222 m / 108 m [S31] | 150 m [S32] |
| Hub height | VW ≈150 m (DERIVED 260 − 110); Rotterdam prototype 135 m, tip 245 m (excerpt only [S43]); OW1 PDE ≤156 m MLLW [S7] | 147 m [S30]; PDE 136–149 m MSL [S29] | 100 m [S32] |
| Rated rpm | **7.81 rpm**, 90 m/s tip (excerpt only [S43]); DERIVED check 7.81 × 2π/60 × 110 = 90.0 m/s | ≈8.2 rpm (DERIVED at 95 m/s). A search excerpt says 12.7 rpm, which would mean a 148 m/s tip, so it is likely wrong | — |
| Nacelle | ≈22 × 10 × 12 m (RW PDE max for the 12 MW, 220 m, 107 m blade class [S24]); VW nacelle "about 40 feet tall" (12.2 m), 750 tons [S27]; 600 t [S43 excerpt only] | 500 t [S31]; shape: compact box, rounded dome spinner, generator ring, magenta stripe on the prototype (ESTIMATED from [S46]) | — |
| Look | Big box with rounded vertical edges; **ribbed generator ring** between hub and nacelle; heli-hoist railings on the roof; small red square handling marks on the blade roots | Siemens box | Jacket foundation with yellow tubular braces |
| Tower | VW sections 31.7 / 39.8 / 39.8 m [S27]; envelope Ø 6.0–8.5 m [S26] | — | — |
| Foundation | OW1: pile 11.3 m at seabed, 8.2 m at sea surface [S7] | Pile 10 m, ≤83 m long, 1,500 t [S30] | Jacket, depth 22–31 m [S32] |

Photo-only reference (Borkum Riffgrund 1): 78 Siemens turbines, 120 m rotor, 58.5 m blades [S37]; monopiles 5.9 m Ø, up to 66 m long, 495–684 t; TPs ≈330 t [S35]. The SWT-4.0-120 model datasheet gives a 90 m hub, max 14 rpm and a 140 t nacelle [S36]; these are model values, not confirmed for this farm.

**Substation** (the small structure on the right of the photo). Ocean Wind 1 envelope:

- OSS ≤90 m above MLLW (296 ft)
- topside ≤90 × 90 m including ancillaries
- platform 131 ft (40 m) above MLLW on a 6-leg jacket [S7]

CVOW: topside 242 × 203 ft (74 × 62 m), height 177 ft (54 m), air gap 151 ft (46 m) above HAT [S29].

---

## 10. Normalised blade table (IEA 15 MW RWT, R = 120.97 m to the blade tip on the pitch axis)

These are the raw source numbers: IEA-15-240-RWT windIO YAML, tag v1.0, with t/c from the current master file [S33]. Twist is the angle of the chord line to the rotor plane; positive means the leading edge is turned upwind (toward feather). "Pitch axis x/c" is the chord fraction from the leading edge where the section rotates.

| Span s | r/R | c/R | Chord (m) | Twist (°) | t/c | Prebend/L | Pitch axis x/c |
|---|---|---|---|---|---|---|---|
| 0.000 | 0.033 | 0.0430 | 5.20 | +15.59 | 1.000 | +0.0000 | 0.505 |
| 0.020 | 0.052 | 0.0431 | 5.21 | +15.59 | 1.000 | +0.0002 | 0.490 |
| 0.050 | 0.081 | 0.0435 | 5.26 | +15.21 | 0.939 | +0.0005 | 0.464 |
| 0.100 | 0.130 | 0.0450 | 5.44 | +13.49 | 0.704 | +0.0011 | 0.417 |
| 0.150 | 0.178 | 0.0467 | 5.65 | +11.03 | 0.502 | +0.0018 | 0.376 |
| 0.207 | 0.233 | **0.0477** | **5.77** | +8.43 | 0.399 | +0.0021 | 0.339 |
| 0.250 | 0.275 | 0.0469 | 5.68 | +7.03 | 0.358 | +0.0021 | 0.323 |
| 0.300 | 0.323 | 0.0444 | 5.37 | +5.52 | 0.338 | +0.0021 | 0.312 |
| 0.400 | 0.420 | 0.0389 | 4.70 | +3.22 | 0.311 | +0.0017 | 0.300 |
| 0.500 | 0.516 | 0.0343 | 4.15 | +1.69 | 0.282 | −0.0005 | 0.289 |
| 0.600 | 0.613 | 0.0304 | 3.67 | +0.56 | 0.251 | −0.0042 | 0.289 |
| 0.700 | 0.710 | 0.0266 | 3.22 | −0.49 | 0.223 | −0.0099 | 0.299 |
| 0.800 | 0.807 | 0.0229 | 2.77 | −1.94 | 0.211 | −0.0167 | 0.314 |
| 0.900 | 0.903 | 0.0187 | 2.26 | −2.10 | 0.211 | −0.0248 | 0.335 |
| 0.950 | 0.952 | 0.0164 | 1.99 | −1.82 | 0.211 | −0.0293 | 0.350 |
| 0.980 | 0.981 | 0.0150 | 1.82 | −1.50 | 0.211 | −0.0322 | 0.360 |
| 0.995 | 0.995 | 0.0122 | 1.47 | −1.31 | 0.211 | −0.0337 | 0.366 |
| 1.000 | 1.000 | 0.0041 | 0.50 | −1.24 | 0.211 | −0.0342 | 0.368 |

All SOURCED [S33] (r/R and c/R DERIVED with R = 3.97 + 117).

**Airfoil family (IEA 15 MW)**, by span position:

| Span s | Section |
|---|---|
| 0.00–0.02 | Circular |
| 0.15 | SNL-FFA-W3-500 |
| 0.245 | FFA-W3-360 |
| 0.329 | FFA-W3-330 |
| 0.439 | FFA-W3-301 |
| 0.538 | FFA-W3-270 |
| 0.638 | FFA-W3-241 |
| 0.772–1.0 | FFA-W3-211 |

The number in each name is the thickness in per-mille, e.g. W3-241 is 24.1 % thick. SOURCED [S33]. Real OEM airfoils are proprietary (ESTIMATED that FFA-W3 is a visually adequate stand-in).

**Other IEA 15 MW values** [S33]:

| Parameter | Value |
|---|---|
| Rotor / hub height | 240 m / 150 m |
| Hub diameter | 7.94 m |
| Cone / tilt | 4° / 6° |
| Tip prebend | 4.0 m |
| Overhang | 11.014 m (v1.0) / 12.031 m (current) |
| Tower top to hub | 5.614 m |
| Tower | 10.0 m at +15 m, 6.5 m at +144.386 m |
| Monopile | 10.0 m |
| Rotor speed | min 5.0 rpm, rated 7.56 rpm |
| Max tip speed | 95 m/s |
| TSR | 9.0 |
| Rated wind | 10.59 m/s |

**Tip detail.** The chord drops from 1.78 m at s = 0.985 to 1.42 m at 0.996, 1.10 m at 0.998 and 0.50 m at 1.0 (SOURCED [S33]). Model it as a rounded, swept-back tip cap over the last ≈2 % of span.

---

## 11. Gaps and cautions

- **No OEM publishes chord or twist, nacelle drawings, TP drawings or rotor-speed curves** for these machines. Everything in the blade tables, nacelle splits, tower diameters (except the envelope maxima), platform shapes and door is a scaled reference or an estimate.
- **Envelope values are maxima, not as-built values.** This applies to the PDE figures from BOEM documents: Ocean Wind 1 ≤240 m rotor, Atlantic Shores ≤280 m, Empire Wind ≤260 m and 160 m hub.
- **Empire Wind hub height conflicts.** Wikipedia's 160 m plus a 118 m radius gives 278 m, not the operator's 270 m. I used the operator's tip height.
- **The Revolution Wind PDE contradicts itself on TP top height.** It gives "base height (foundation height – top of transition piece)" as both 6–8 m and 25–39 m [S24]. I used the Vineyard Wind interface of 19.5–22.5 m MLLW instead.
- **Colour of the Revolution Wind marine lights.** The RW PDE text says "two white flashing obstruction lights (color to be determined)" for USCG District 1 [S24], while BOEM 2021 and NVIC 03-23 specify yellow. Use yellow.
- **Sites I could not open** (Cloudflare/bot check or 403): wind-turbine-models.com, 4coffshore.com, Windpower Monthly. I did not attempt to get past the bot checks. Figures from them are marked "(excerpt only)".
- **IALA O-139 (2013) is superseded by IALA G1162** (per search results). I could not read G1162 itself; its published summary matches O-139 on the 15 m yellow above HAT.

---

## 12. Sources

- [S1] Wikimedia Commons, "Borkum Riffgrund 1.jpg" (Ørsted farm off Borkum; same image as ref-1). https://commons.wikimedia.org/wiki/File:Borkum_Riffgrund_1.jpg
- [S2] BOEM, *Guidelines for Lighting and Marking of Structures Supporting Renewable Energy Development*, 28 Apr 2021. https://www.boem.gov/sites/default/files/documents/renewable-energy/2021-Lighting-and-Marking-Guidelines.pdf
- [S3] FAA AC 70/7460-1N *Obstruction Marking and Lighting*, 11 Aug 2026 (supersedes 1M): Ch. 10 (ADLS), Ch. 13 (wind turbines), App. B. https://www.faa.gov/documentLibrary/media/Advisory_Circular/2026-07-13_AC_70_7460-1N_Obstruction_Marking_and_Lighting_FINAL_CLEAN.pdf
- [S4] USCG NVIC 03-23, *Guidance on Navigational Safety in and around OREI*, 16 Nov 2023 (enclosure 1). https://www.crmc.ri.gov/windenergy/OffshoreEnergy_MarinerGuidance.pdf
- [S5] IALA Recommendation O-139, Ed. 2, Dec 2013, §2.3. https://vasab.org/wp-content/uploads/2018/06/2013_IALA_Marking-of-Man-Made-Offshore-Structures.pdf
- [S6] Germany, AVV Kennzeichnung von Luftfahrthindernissen, 24 Apr 2020, §§4.1, 14, 16, 18. https://www.verwaltungsvorschriften-im-internet.de/bsvwvbund_24042020_LF15.htm
- [S7] BOEM, Ocean Wind 1 DEIS Appendix E (PDE). https://www.boem.gov/sites/default/files/documents/renewable-energy/state-activities/Ocean-Wind1-DEIS-Ap-E-PDE.pdf
- [S8] Ocean Wind COP Volume I (2022-06-14), §6.1.1, §7.4, Figs 6.1.1-1 to 6.1.1-4. https://www.boem.gov/sites/default/files/documents/renewable-energy/state-activities/OCW01_COP%20Volume%20I_20220614.pdf
- [S9] Ørsted, "Ørsted Ceases Development of Ocean Wind 1 and Ocean Wind 2", 31 Oct 2023. https://us.orsted.com/news-archive/2023/10/orsted-ceases-development-of-ocean-wind-1-and-ocean-wind-2
- [S10] BOEM, Atlantic Shores South PDE fact sheet. https://boem.gov/sites/default/files/documents/renewable-energy/state-activities/AtlanticShoresSouth_PDE.pdf
- [S11] BOEM, Atlantic Shores South DEIS Appendix C (PDE and max case). https://www.boem.gov/sites/default/files/documents/renewable-energy/state-activities/AtlanticShoresSouth_AppC_PDE%20and%20Max-Case%20Scenario_DEIS.pdf
- [S12] BOEM press release, COP approval, 1 Oct 2024. https://www.boem.gov/newsroom/press-releases/boem-approves-construction-and-operations-plan-atlantic-shores-south
- [S13] Vestas, "Atlantic Shores selects Vestas as preferred turbine supplier…", 2022. https://www.vestas.com/en/media/company-news/2022/atlantic-shores-selects-vestas-as-preferred-turbine-sup-c3644063
- [S14] Vestas, V236-15.0 MW product page. https://www.vestas.com/en/energy-solutions/offshore-wind-turbines/V236-15MW
- [S15] Vestas, "Vestas to install V236-15.0 MW prototype turbine at Østerild", 2021. https://www.vestas.com/en/media/company-news/2021/vestas-to-install-v236-15-0-mw-prototype-turbine-at-ost-c3433411
- [S16] Windpower Monthly, "Exclusive: How Vestas beat rivals to launch first 15MW offshore turbine" (403; search excerpt only). https://www.windpowermonthly.com/article/1706924/exclusive-vestas-beat-rivals-launch-first-15mw-offshore-turbine
- [S17] Empire Wind, Technology page. https://www.empirewind.com/about/technology/
- [S18] BOEM, Empire Wind FEIS Appendix E (PDE). https://www.boem.gov/sites/default/files/documents/renewable-energy/state-activities/Empire_Wind_FEIS_App_E_PDE_0.pdf
- [S19] Wikipedia, "Empire Wind". https://en.wikipedia.org/wiki/Empire_Wind
- [S20] BOEM, South Fork Wind Farm Biological Assessment (USFWS). https://www.boem.gov/sites/default/files/documents/renewable-energy/SFWF_BA_USFWS_Final.pdf
- [S21] Wikipedia, "South Fork Wind". https://en.wikipedia.org/wiki/South_Fork_Wind
- [S22] Tethys, South Fork Wind (search excerpt only). https://tethys.pnnl.gov/wind-project-sites/south-fork-wind
- [S23] Siemens Gamesa, SG 11.0-200 DD product page. https://www.siemensgamesa.com/global/en/home/products-and-services/offshore/wind-turbine-sg-11-0-200-dd.html
- [S24] BOEM, Revolution Wind FEIS Appendix D (PDE). https://boem.gov/sites/default/files/documents/RWF_FEIS_App_D_PDE%20and%20Maximum%20Case%20Scenario_508.pdf
- [S25] Wikipedia, "Revolution Wind". https://en.wikipedia.org/wiki/Revolution_Wind
- [S26] Vineyard Wind COP Volume I, Section 3 (Tables 3.1-2 and 3.1-3, Figs 3.1-1 to 3.1-5). https://www.boem.gov/sites/default/files/documents/renewable-energy/Vineyard-Wind-COP-Volume-I-Section-3_0.pdf
- [S27] WBUR, "PHOTOS: Massive Vineyard Wind turbines under construction in New Bedford", 2 Oct 2023. https://www.wbur.org/news/2023/10/02/vineyard-wind-construction-turbines-installation
- [S28] Offshorewind.biz, "GE Haliade-X 13 MW Turbines to Spin on Vineyard Wind 1" (search excerpt only). https://www.offshorewind.biz/2021/10/11/ge-haliade-x-13-mw-turbines-to-spin-on-vineyard-wind-1/
- [S29] BOEM, CVOW Commercial DEIS Appendix E (PDE). https://tethys.pnnl.gov/sites/default/files/publications/CVOW_DEIS_App_E.pdf
- [S30] Wikipedia, "Coastal Virginia Offshore Wind". https://en.wikipedia.org/wiki/Coastal_Virginia_Offshore_Wind
- [S31] Siemens Gamesa, SG 14-222 DD fact sheet, May 2020. https://sofiawindfarm.com/media/pd3iqrpu/20200519-fact-sheet-sg-14-222-dd.pdf
- [S32] Tethys, Block Island Wind Farm. https://tethys.pnnl.gov/wind-project-sites/block-island-wind-farm
- [S33] IEA Wind TCP Task 37, IEA-15-240-RWT windIO YAML, v1.0 and master. https://raw.githubusercontent.com/IEAWindSystems/IEA-15-240-RWT/v1.0/WT_Ontology/IEA-15-240-RWT.yaml and https://raw.githubusercontent.com/IEAWindSystems/IEA-15-240-RWT/master/WT_Ontology/IEA-15-240-RWT.yaml
- [S35] Offshorewind.biz, "GeoSea Finalises Borkum Riffgrund 1 Foundation Installation", 29 Jul 2014. https://www.offshorewind.biz/2014/07/29/geosea-finalises-borkum-riffgrund-1-foundation-installation/ (also CS Wind: https://www.cswoffshore.com/references/foundations-references/borkum-riffgrund-1/)
- [S36] The Wind Power, SWT-4.0-120 datasheet. https://www.thewindpower.net/scripts/fpdf181/turbine.php?id=956
- [S37] Power Technology, Borkum Riffgrund 1 project page. https://www.power-technology.com/projects/borkum-riffgrund-1-offshore-wind-farm/
- [S38] Carbon Trust OWA / Atkins, *Recommended boat landing geometry*, public drawings 5166244-ST-DRG-0004/0005, rev 02, Dec 2019. https://www.carbontrust.com/sites/default/files/documents/resource/public/Design_for_recommended_boat_landing_geometry.pdf
- [S39] ACP, *Offshore Marine Transfer Guidance*, May 2023. https://cleanpower.org/wp-content/uploads/gateway/2024/03/ACP-Offshore-Marine-Transfer-Guidance.pdf
- [S40] GT Engineering, summary of EN ISO 14122-3 guard-rail requirements. https://www.gt-engineering.it/en/technical-standards/en-iso-standards/en-iso-14122-3-eng/guard-rails-en-14122-eng/
- [S41] Fleming et al., "Initial results from a field campaign of wake steering applied at a commercial wind farm – Part 1", *Wind Energ. Sci.* 4, 273 (2019). https://wes.copernicus.org/articles/4/273/2019/
- [S42] Wikipedia, "List of RAL colours". https://en.wikipedia.org/wiki/List_of_RAL_colours
- [S43] Windpower Monthly, "Haliade-X uncovered: GE aims for 14MW" (search excerpt only). https://www.windpowermonthly.com/article/1577816/haliade-x-uncovered-ge-aims-14mw
- [S44] Power Technology, "Haliade-X: a look at GE's supersized new wind turbine". https://www.power-technology.com/features/haliade-x-look-ges-supersized-new-wind-turbine/
- [S45] Wikimedia Commons, "Coastal Virginia Offshore Wind 14.jpg" and "… 11.jpg" (CVOW pilot, June 2022). https://commons.wikimedia.org/wiki/File:Coastal_Virginia_Offshore_Wind_14.jpg and https://commons.wikimedia.org/wiki/File:Coastal_Virginia_Offshore_Wind_11.jpg
- [S46] Wikimedia Commons, "SG 14-222 DD.jpg" (Østerild, Nov 2023). https://commons.wikimedia.org/wiki/File:SG_14-222_DD.jpg
- [S47] Wikimedia Commons, "Haliade-X, nacelle.jpg" (Maasvlakte prototype, Jan 2020). https://commons.wikimedia.org/wiki/File:Haliade-X,_nacelle.jpg
- Also viewed: Commons "Turbine Structure.jpg" (Block Island jacket, 2016) https://commons.wikimedia.org/wiki/File:Turbine_Structure.jpg; Commons "South-Fork-Wind-Offshore-Wind-Turbine.jpg" https://commons.wikimedia.org/wiki/File:South-Fork-Wind-Offshore-Wind-Turbine.jpg
