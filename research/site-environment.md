# New Jersey offshore wind: site and marine environment

This sheet gives numbers and shapes for a procedural Three.js (r180) scene. Researched on 2026-09-30.

**Labels.** Every hard number carries one of these labels:
- **SOURCED**: taken from the linked source. Where I checked the primary document, the page or line is given.
- **DERIVED**: computed by me from sourced data. The arithmetic or method is shown, and the scripts ran in this session.
- **ESTIMATED**: my own judgement. The basis is stated.

**Coordinates.** Directions are °true unless marked "grid". Wind and wave directions are the direction they come *from*. The Three.js direction vectors use x = East, y = Up, z = South (so −z = North).

**Companion file.** `research/asow-south-wtg-positions.csv` holds the 200 proposed Atlantic Shores South turbine positions from BOEM's point layer (see §4.3).

---

## 0. Key numbers for the scene

| Quantity | Value | Label |
|---|---|---|
| NJ offshore turbines that physically exist (2026-09-30) | **None**. No NJ utility-scale offshore project started offshore construction. | SOURCED (§1) |
| Best "real" layout to use | Atlantic Shores South (lease OCS-A 0499): 200 proposed positions on a skewed grid. In-row step 1111 m at 80.6°T. Row-to-row step 1865 m at 177.4°T, which is 1852 m (1.0 nm) perpendicular. | SOURCED positions, DERIVED vectors |
| Water depth | 19–37 m (Atlantic Shores), 15–36 m (Ocean Wind 1) | SOURCED |
| Transition piece paint | Yellow RAL 1023, from the waterline (MHHW) to 50 ft (15.2 m) above it | SOURCED |
| Tower, nacelle and blade paint | No lighter than RAL 9010 Pure White and no darker than RAL 7035 Light Grey | SOURCED |
| Summer wind at 10 m | Median ≈ 5.0–5.7 m/s from SSW–SW. p10 ≈ 2.3, p90 ≈ 9 m/s. | DERIVED (NDBC 44009/44025) |
| Summer wind at hub (156–175 m) | Median ≈ 7–8.5 m/s (power law, α = 0.11–0.14). Stable summer nights can reach α ≈ 0.2+. | DERIVED |
| Summer significant wave height Hs | Median 0.85–0.91 m. p10 ≈ 0.55 m, p90 ≈ 1.45 m. | DERIVED (3 buoys) |
| Summer dominant wave period Tp | Median 7.1 s; mean period 4.8–4.9 s | DERIVED |
| Summer dominant wave direction (from) | SSE–S–ESE | DERIVED |
| Winter Hs / Tp | Median 1.17–1.34 m; p90 2.1–2.4 m; Tp 6.7–7.1 s | DERIVED |
| Whitecap cover at the summer median wind | About 0.1 % of the sea surface. None are visible in the reference photo. | DERIVED |
| Summer water colour at the site | Forel-Ule class **4** (hue angle ≈ 200°, blue-green) | DERIVED (ESA OC-CCI) |
| Summer aerosol optical depth at 550 nm | Median ≈ 0.16–0.17. Hazy days (p90) ≈ 0.37. | DERIVED (AERONET) |
| Preetham turbidity T | ≈ 2.7 physically (median), ≈ 4.8 on hazy days. Use about 4–6 to match the photo's pale horizon. | DERIVED / ESTIMATED |
| Visibility in the photo | About 20–30 km, from the extinction σ ≈ 0.13–0.2 km⁻¹ fitted to how the transition pieces fade with distance | ESTIMATED |
| Atlantic City skyline from the farm | Geometrically in view. Ocean Casino Resort (216 m) is ≤ 1 m hidden at 30 km from 50 m height. In practice it shows only on clear days (visibility ≥ ~33–45 km). | DERIVED |
| Recommended framing | Camera looking ENE (≈60–80°T) along the rows, on an afternoon. Sun behind-left (SW–W), no land in view, Atlantic City behind the camera. This matches the photo's lighting. | DERIVED / ESTIMATED |

---

## 1. Project status (as of 2026-09-30): no NJ farm exists

**Nothing has been built off New Jersey.** Of the six projects below, two were cancelled by their developers and two lost their leases in 2026. Atlantic Shores South holds a federal approval that has been sent back for re-review, and it has no state power contract. Ocean Wind 2 never had a construction plan approved. No turbine, foundation or offshore substation stands in any NJ lease area.

| Project (lease) | What was planned | Status at 2026-09-30 | Sources |
|---|---|---|---|
| **Ocean Wind 1** (OCS-A 0498, Ørsted) | Up to 98 WTGs (GE Haliade-X 12 MW class) and up to 3 offshore substations, 1,100 MW, about 13 nm SE of Atlantic City. COP approved 2023-07-05. | **Cancelled** by Ørsted on 2023-10-31. BOEM approved a 2-year lease suspension on 2024-02-29. NJBPU vacated the power contract (OREC) in August 2024. No construction took place. | [Wikipedia](https://en.wikipedia.org/wiki/Ocean_Wind_1), [BOEM OW1](https://www.boem.gov/renewable-energy/state-activities/ocean-wind-1), [Utility Dive](https://www.utilitydive.com/news/orsted-cancel-ocean-wind-offshore-project-development-new-jersey/698464/), [EIA](https://www.eia.gov/todayinenergy/detail.php?id=62445) |
| **Ocean Wind 2** (OCS-A 0532, Ørsted) | Second phase. EIA gives 2,400 MW for OW1 and OW2 combined. | **Cancelled** together with OW1 in October 2023. No COP was approved. | [EIA](https://www.eia.gov/todayinenergy/detail.php?id=62445), [Haas Energy Institute blog, 2026-08-10](https://energyathaas.wordpress.com/2026/08/10/who-killed-offshore-wind/) |
| **Atlantic Shores South** (OCS-A 0499 + 0570; EDF, after Shell exited) | Up to 200 WTG positions (max 280 m rotor, 319.7 m tip), 2,800 MW, plus up to 10 small, 5 medium or 4 large OSSs and 1 met tower. 8.7 statute mi from shore at the closest point. | **Federally approved but stalled.** COP approved 2024-10-01. Shell exited in early 2025 and EDF took a ~$940 M write-down. NJBPU vacated the Project 1 OREC on 2025-08-13/18 at the developer's own request ("no longer viable"). On **2026-08-10** a federal court granted BOEM's request to remand the COP approval for reconsideration, and the case is stayed. The lease is still held; I found no 2026 buyback. No offshore construction. | [BOEM ASOW South](https://www.boem.gov/renewable-energy/state-activities/atlantic-shores-south), [offshorewind.biz 2025-08-19](https://www.offshorewind.biz/2025/08/19/new-jersey-atlantic-shores-terminate-orec-contract-for-1-5-gw-offshore-wind-project/), [NJBPU order](https://www.nj.gov/bpu/pdf/boardorders/2025/20250813/8D%20ORDER%20ASOW%20Petition%20to%20Terminate.pdf), [WorkBoat](https://www.workboat.com/wind/edf-exits-atlantic-shores-wind-project), [RTO Insider](https://www.rtoinsider.com/138874-atlantic-shores-offshore-wind-approval-to-be-reviewed/), [Harvard EELP tracker (updated 2026-09-01)](https://eelp.law.harvard.edu/tracker/federal-offshore-wind-deployment/) |
| **Atlantic Shores North** (OCS-A 0549) | Separate northern lease | Notice of intent for an EIS in 2024. No approval. | [Federal Register](https://www.federalregister.gov/documents/2024/03/18/2024-05649/notice-of-intent-to-prepare-an-environmental-impact-statement-for-the-proposed-atlantic-shores-north) |
| **Leading Light Wind** (OCS-A 0542, Invenergy) | 2,400 MW NJ award (January 2024), about 35 mi off NJ | **Cancelled** (filing of 2025-11-07). Lease **cancelled and rescinded 2026-06-12** under a settlement; Invenergy's affiliates are reimbursed $765 M. No COP was ever submitted. | [BOEM OCS-A 0542](https://www.boem.gov/renewable-energy/state-activities/invenergy-ocs-0542), [Haas blog](https://energyathaas.wordpress.com/2026/08/10/who-killed-offshore-wind/) |
| **Attentive Energy (One/Two)** (OCS-A 0538, TotalEnergies-led) | 1,342 MW NJ award (Attentive Energy Two, January 2024), about 36 nm off NJ. COP (1,545 MW) submitted 2024-09-20. | Settlement signed **2026-03-23**. Lease cancelled and rescinded (BOEM record 2026-04-17). $795 M reimbursement. | [BOEM OCS-A 0538](https://www.boem.gov/renewable-energy/state-activities/attentive-energy-ocs-0538), [DOI press release](https://www.doi.gov/pressreleases/interior-and-totalenergies-agree-end-offshore-wind-projects-lowering-costs-american) |

**Wider context (SOURCED).** Elsewhere on the US East Coast, Revolution Wind has delivered power since March 2026 and Vineyard Wind 1 completed offshore construction in March 2026. CVOW was 81 % complete on 2026-07-31, and Empire Wind 1 and Sunrise Wind resumed construction under injunctions. The two CVOW pilot turbines are listed as "Installed" in BOEM's turbine layer. Between March and August 2026 the Interior Department announced 5 buyback rounds covering 12 leases, about $3.9 B in total ([Haas blog](https://energyathaas.wordpress.com/2026/08/10/who-killed-offshore-wind/)).

**How to frame the scene.** Present it as the *planned* Atlantic Shores South / Ocean Wind array, built to the approved design envelope. Say "planned" or "as permitted", never "operating".

---

## 2. The reference photo: what it is and what it shows

### 2.1 Where was it taken? (not identified)
I could not identify the photo. The attempts were:
- Ørsted's NJ page images (`nj_header-new.jpg`, `oceanwind-new.jpg`) and the Ocean Wind 1 website images, all downloaded and compared. None match.
- Image credits on NJ Spotlight, NJ Monitor, WHYY, NJ Monthly and the Press of Atlantic City. The fetchable pages used other photos: Burbo Bank, AP images of the onshore Jersey-Atlantic turbines, protests. NJ Spotlight and NJ Monitor returned 403.
- A reverse image search is not possible with the tools here.

**Visual evidence (ESTIMATED from the pixels).**
- **The blades carry red-white-red bands near the tips.** On the hero's lower blade there is a red band at about 70 % span, then white, then red at the tip. This is the German day-marking scheme for aviation obstacles. UK, Danish and Dutch farms normally use unbanded white blades. This points to a **German North Sea farm**.
- The towers have yellow transition pieces with a grey access platform and a dark band at the waterline, on monopiles.
- The nacelles are small and boxy, like a geared Siemens.
- There are about 16 turbines in view on a sparse grid, and a small offshore substation on the horizon.

The best guess is an Ørsted German farm (Borkum Riffgrund 1 or Gode Wind 1/2), or a similar Siemens-turbine German farm used as a stock image. **This is unverified.** It is *not* a New Jersey photo, because nothing has been built there (§1).

**Implication for the build.** NJ turbines would be much larger: Atlantic Shores allows a rotor up to 280 m and a tip up to 319.7 m. A 4–6 MW German farm has a 120–154 m rotor. Relative to rotor size, however, the NJ grid is *tighter* (§4.4), so the "forest of turbines receding into haze" look still holds.

### 2.2 Measurements from the photo (DERIVED: `ref-1.png` 760×506, decoded with a custom PNG reader in node)
The horizon is at **y ≈ 207.5 px**, 41 % down from the top. Values are per-row medians over columns with no turbines. Linear values use the sRGB transfer function; Y is Rec.709 luminance.

| y (px) | px from horizon | sRGB | hex | linear RGB | Y |
|---|---|---|---|---|---|
| 0 | −208 (top, some cloud) | 217, 223, 236 | #d9dfec | 0.694, 0.738, 0.839 | 0.736 |
| 40 | −168 (blue gap) | 183, 212, 240 | #b7d4f0 | 0.474, 0.658, 0.871 | 0.634 |
| 80 | −128 | 203, 221, 242 | #cbddf2 | 0.597, 0.723, 0.888 | 0.708 |
| 120 | −88 | 214, 228, 242 | #d6e4f2 | 0.672, 0.776, 0.888 | 0.762 |
| 160 | −48 | 226, 234, 243 | #e2eaf3 | 0.761, 0.823, 0.896 | 0.815 |
| 190 | −18 | 230, 237, 245 | #e6edf5 | 0.791, 0.847, 0.913 | 0.840 |
| 205 | −3 (horizon sky) | 228, 235, 245 | #e4ebf5 | 0.776, 0.831, 0.913 | 0.825 |
| 209 | +2 (sea at horizon) | 187, 210, 229 | #bbd2e5 | 0.497, 0.644, 0.784 | 0.623 |
| 220 | +13 | 155, 192, 219 | #9bc0db | 0.328, 0.527, 0.708 | 0.498 |
| 240 | +33 | 121, 170, 204 | #79aacc | 0.191, 0.402, 0.604 | 0.372 |
| 300 | +93 | 110, 149, 185 | #6e95b9 | 0.156, 0.301, 0.485 | 0.283 |
| 380 | +173 | 90, 117, 150 | #5a7596 | 0.102, 0.178, 0.305 | 0.171 |
| 460 | +253 | 48, 68, 86 | #304456 | 0.030, 0.058, 0.093 | 0.054 |
| 500 | +293 (bottom) | 30, 48, 63 | #1e303f | 0.013, 0.030, 0.050 | 0.027 |

**Other measurements (DERIVED from pixels):**
- **Horizon.** The sky just above the horizon (Y ≈ 0.83) is about 1.3× brighter than the sea just below it (Y ≈ 0.62). The line is crisp, with no fog bank.
- **Sea texture.** The ratio of 95th- to 5th-percentile luminance per band grows toward the camera: 1.7 (y 210–230), 2.3 (260–300), 4.6 (300–360), 11 (360–420), 51 (420–506). The foreground is facetted chop that alternately reflects bright sky and shows dark water.
- **No whitecaps.** No sea pixel is both more than 4× its band median and above Y 0.35. This implies U10 below about 4–5 m/s (see §6.5).
- **Sun side.** The foreground sea is brighter on the left (sRGB 73, 92, 114 at x 0–150) than on the right (38, 64, 96 at x 600–760). The hero tower's left side is lit (237, 244, 252) and its right side is shaded (168, 172, 184). There is no sun glitter in frame. So the **sun is to the left and behind the camera, and moderately high**.
- **Hero transition piece.** Lit face sRGB ≈ (253, 227, 124) to (255, 240, 147). Shaded face ≈ (194, 161, 30). There is a very dark band about 1–2 px tall at the waterline, sRGB ≈ (5–40, 4–30, 2–10). Note that true RAL 1023 is more saturated; the photo's exposure lifts it.
- **Distant towers against the bright horizon sky read darker than the sky**, with contrast −0.3 to −0.7. That is their shaded side. Below the horizon, against the sea, towers read *brighter* than the sea (+0.5 to +1.7). For the renderer, distant towers are grey silhouettes above the horizon and white lines against the water.
- **Fade with distance.** Distance was estimated from each yellow TP's height in pixels, scaled to the hero at about 400 m, as ESTIMATED. The peak linear "yellowness" (R+G)/2 − B falls from 0.72 (hero) to about 0.60 (about 1.5 km), 0.50 (about 2.2 km) and 0.21–0.28 (about 4–5 km). That gives an attenuation of σ ≈ 0.19–0.23 km⁻¹. Small TPs also lose saturation to sub-pixel mixing, so the true σ is lower. **ESTIMATED visibility V = 3.912/σ ≈ 20–30 km.**
- **Substation on the horizon** (x 736–745, y 204–209). It is about 10 px wide by 5 px tall. The sun-lit face is warm cream (244, 230, 210); the shaded face is grey-blue (167, 174, 185).

---

## 3. Location

### 3.1 Lease areas (DERIVED from BOEM polygons)
The polygons came from BOEM's *Offshore Wind Lease Outlines* FeatureServer ([service](https://services7.arcgis.com/G5Ma95RzqJRPKsWL/ArcGIS/rest/services/Wind_Lease_Boundaries__BOEM_/FeatureServer); data last edited March 2025, so it still shows the leases cancelled in 2026). Centroids are area-weighted. Distances are great-circle, using Atlantic City (39.3643 N, 74.4229 W), Beach Haven on Long Beach Island (39.5593 N, 74.2432 W) and Barnegat Light (39.7587 N, 74.1063 W).

| Lease / project | Acres (SOURCED) | Centroid lat, lon | Bounding box | Centroid to Atlantic City | Centroid to Beach Haven / Barnegat Light |
|---|---|---|---|---|---|
| OCS-A 0498 Ocean Wind 1 | 75,526 | 39.1223, −74.2422 | 39.016–39.221 N, 74.376–74.097 W | 31.1 km (16.8 nm), bearing 150° from AC | 48.6 / 71.7 km |
| OCS-A 0532 Ocean Wind 2 | 84,955 | 39.0656, −74.3789 | 38.898–39.286 N, 74.501–74.235 W | 33.4 km, bearing 173° | 56.1 / 80.5 km |
| OCS-A 0499 Atlantic Shores South, Project 1 | 58,712 | 39.2615, −74.1374 | 39.144–39.372 N, 74.249–74.013 W | 27.1 km (14.6 nm), bearing 115° | 34.3 / 55.3 km |
| OCS-A 0570 Atlantic Shores South, Project 2 | 43,439 | 39.2885, −74.0318 | 39.209–39.377 N, 74.102–73.942 W | 34.7 km, bearing 104° | 35.2 / 52.7 km |
| OCS-A 0549 Atlantic Shores North | 81,129 | 39.4722, −74.0041 | 39.322–39.673 N | 37.9 km, bearing 71° | 22.7 / 33.0 km |
| OCS-A 0542 Leading Light (cancelled) | 83,976 | 39.3038, −73.4611 | — | 83.0 km, bearing 94° | 72.9 / 75.0 km |
| OCS-A 0538 Attentive (cancelled) | 84,332 | 39.7185, −73.1702 | — | 114.4 km, bearing 69° | 93.6 / 80.2 km |

**Atlantic Shores South turbine-grid centroid** (from the 200 BOEM points): **39.2732 N, 74.0922 W**. DERIVED.

**Cross-checks against sourced distances.**
- Atlantic Shores is 8.7 statute mi (14 km) offshore at its closest point ([BOEM](https://www.boem.gov/renewable-energy/state-activities/atlantic-shores-south); [NOAA IHA application](https://media.fisheries.noaa.gov/2022-09/AtlanticShoresOWF_2022_Application_OPR1.pdf)). My coarse vertex-to-coast-sample distance is 13.3 km (8.3 mi). Consistent.
- Ocean Wind 1 is "13 nautical miles (15 statute miles) southeast of Atlantic City" ([OW1 COP Vol I](https://www.boem.gov/sites/default/files/documents/renewable-energy/state-activities/OCW01_COP%20Volume%20I_20220614.pdf), p. 1). My coarse nearest distance is 21.4 km (13.3 mi). Consistent.

### 3.2 Water depth and seabed (SOURCED)
- **Ocean Wind 1:** "Water depths in the Wind Farm range from 49–118 ft below mean lower low water (MLLW) [**15–36 m**] with the seabed sloping generally offshore toward the southeast at less than 1°." The Wind Farm Area is 68,450 acres. ([OW1 COP Vol I](https://www.boem.gov/sites/default/files/documents/renewable-energy/state-activities/OCW01_COP%20Volume%20I_20220614.pdf), p. 59)
- **Atlantic Shores South:** "Water depths in the WTA range from 62 to 121 feet (ft) (**19 to 37 meters**), gradually increasing with distance from shore." ([NOAA IHA application](https://media.fisheries.noaa.gov/2022-09/AtlanticShoresOWF_2022_Application_OPR1.pdf), p. 1)
- **Seabed** (from the [OW1 FEIS Vol 1](https://www.boem.gov/sites/default/files/documents/renewable-energy/state-activities/Ocean_Wind1_FEIS_Vol1.pdf), §3.6):
  - A flat expanse of mostly soft sediment: fine to coarse sand, 0.125–1 mm.
  - NE–SW sand ridges and troughs. Side slopes are under 1°, vertical relief is up to 15 m, and ridges are about 8 m high and about 1.5 km long.
  - Sand waves have wavelengths up to 500 m and heights up to 1.5 m.
  - Scour-protection rock can reach 2.5 m high, extending 22.3 m from each foundation.
  - The seabed is invisible from above the surface at these depths (§7), so there is no need to model it for an above-water camera.

---

## 4. Layout

### 4.1 Coast Guard guidance (SOURCED)
- **MA/RI Port Access Route Study final report** ([USCG, May 2020](https://www.navcen.uscg.gov/sites/default/files/pdf/PARS/FINAL_REPORT_PARS_May_14_2020.pdf), exec. summary) recommends a "standard and uniform grid pattern with at least three lines of orientation". It specifies:
  - Transit lanes NW–SE, 0.6–0.8 nm wide.
  - Fishing lanes E–W, 1 nm wide.
  - Search-and-rescue lanes N–S and E–W, 1 nm wide.

  This produced the familiar **1 × 1 nm** E–W/N–S grid for Rhode Island and Massachusetts.
- **New Jersey:** the Coast Guard ran a separate Seacoast of NJ route study ([Federal Register, 2022-03-24](https://www.federalregister.gov/documents/2022/03/24/2022-06228/port-access-route-study-seacoast-of-new-jersey-including-offshore-approaches-to-the-delaware-bay)). NJ projects did **not** copy 1 × 1 nm; see below.

### 4.2 Ocean Wind 1 (SOURCED, [OW1 FEIS Vol 1](https://www.boem.gov/sites/default/files/documents/renewable-energy/state-activities/Ocean_Wind1_FEIS_Vol1.pdf) §2.1.2.2.3)
- Up to **98 WTGs**, "with a spacing of **1 nm by 0.8 nm** between WTGs in a **southeast-northwest orientation**". The COP says the arrays were oriented SE–NW "to align with ... the predominant commercial fishing transit routes out from Atlantic City".
- A later array-compression scenario created a **0.81 nm buffer** between OW1 and Atlantic Shores South (joint letter, 2022-07-21).
- The WTG envelope: rotor ≤ 240 m, hub ≤ 156 m above MLLW, tip ≤ 276 m, lowest tip ≥ 22 m.
- Monopiles, with an optional piled-jacket substation.
- The exact turbine bearings are **NOT FOUND**. BOEM's turbine-point layer does not include OW1 because the project was cancelled.

### 4.3 Atlantic Shores South: real grid geometry
**SOURCED.** From the PDE ([BOEM PDE summary](https://boem.gov/sites/default/files/documents/renewable-energy/state-activities/AtlanticShoresSouth_PDE.pdf); [FEIS App C](https://www.boem.gov/sites/default/files/documents/renewable-energy/state-activities/AtlanticShoresSouth_AppC_PDE%20and%20Max-Case%20Scenario_DEIS.pdf) Table C-1):
- A grid with "east-northeast/west-southwest rows and approximately north/south columns, consistent with the predominant flow of traffic".
- Rows are 1.0 nm apart and columns 0.6 nm apart (per the FEIS text).
- 105–136 WTGs in Project 1 and 64–95 in Project 2, 200 in total including a 31-position overlap area.
- OSSs are placed "along the same east-northeast/west-southwest rows as WTGs".

**DERIVED.** From BOEM's *Offshore Wind – Proposed or Installed Turbine Locations* layer ([FeatureServer](https://services7.arcgis.com/G5Ma95RzqJRPKsWL/arcgis/rest/services/Offshore_Wind_-_Proposed_or_Installed_Turbine_Locations/FeatureServer), 200 points for OCS-A 0499, status "Proposed", max tip 319.7 m, rotor 280 m, model not assigned):

| Lattice vector | UTM 18N components (E, N) | Length | Bearing (grid → true, +0.575° grid convergence) |
|---|---|---|---|
| **a**: next turbine along a row | (+1094.3, +193.0) m | **1111.2 m = 0.600 nm** | 80.00° grid → **80.6°T** (ENE) |
| **b**: next row, same column | (+102.7, −1862.5) m | **1865.3 m = 1.007 nm** | 176.84° grid → **177.4°T** (≈S) |

- The perpendicular spacing between rows is |a×b|/|a| = 2,057,955 / 1111.2 = **1852.0 m, exactly 1.0 nm**.
- The perpendicular spacing between columns is |a×b|/|b| = **1103 m**.
- The angle between a and b is about 96.8°, so the grid is slightly **skewed, not rectangular**.
- All 200 points sit exactly on this lattice (standard deviation about 0.00005 m).
- The nearest-neighbour distance is 1111 m (minimum and median).
- The array spans 39.146–39.371 N and 74.248–73.943 W, about 26 km E–W by 25 km N–S.
- **CSV:** `research/asow-south-wtg-positions.csv`. Columns are lat/lon (NAD83), UTM 18N E/N, and `local_x_east_m` / `local_z_south_m` relative to the array centroid (UTM E 578,306.95, N 4,347,489.73). Local axes are UTM-grid aligned, rotated 0.575° from true.

### 4.4 Spacing in rotor diameters (DERIVED)

| Turbine | In-row (1111 m) | Row-to-row (1852 m) |
|---|---|---|
| 280 m rotor (Atlantic Shores maximum) | 4.0 D | 6.6 D |
| 240 m rotor (Ocean Wind 1 maximum; 1852 × 1482 m grid) | 7.7 D (1852 m) | 6.2 D (1482 m) |
| Reference photo's German farm, ~120 m rotor, ~5–7 D (ESTIMATED) | ~600–850 m | ~600–850 m |

### 4.5 Offshore substations (SOURCED)

**Ocean Wind 1** ([COP Vol I](https://www.boem.gov/sites/default/files/documents/renewable-energy/state-activities/OCW01_COP%20Volume%20I_20220614.pdf) Tables 6.1.1-4 to 6.1.1-6, pp. 93–97; [FEIS](https://www.boem.gov/sites/default/files/documents/renewable-energy/state-activities/Ocean_Wind1_FEIS_Vol1.pdf) p. S-6):

| Parameter | Value |
|---|---|
| Number | Up to 3 |
| Topside main structure | ≤ 230 × 230 ft (**70 × 70 m**); ≤ 295 × 295 ft (90 × 90 m) with ancillary structures |
| Total height above MLLW | ≤ 296 ft (**90 m**) |
| Decks | "one or more decks". Steel brace-column frame with non-load-bearing architectural cladding walls. |
| Helideck | "may include a helicopter platform (helideck)", about 220 tons, with netting and fire-fighting |
| Foundation option 1 | Monopile with a modular support frame and cable deck |
| Foundation option 2 | Piled jacket: **6 legs**, 16 pin piles, leg separation 230 ft (70 m) at both seabed and surface, leg diameter 15 ft (4.6 m), platform 131 ft (40 m) above MLLW |
| Access | Boat landing with a staircase to the cable deck, intruder cage, life rafts |

**Atlantic Shores South** ([FEIS App C](https://www.boem.gov/sites/default/files/documents/renewable-energy/state-activities/AtlanticShoresSouth_AppC_PDE%20and%20Max-Case%20Scenario_DEIS.pdf) Table C-2; ft converted to m):

| Size | Maximum count | Width × length | Height above foundation interface | Topside top above MLLW | Jacket legs | Leg spacing at MSL |
|---|---|---|---|---|---|---|
| Small | 10 (5 per project) | 114.8 × 131.2 ft (35 × 40 m) | 98.4 ft (30 m) | 174.8 ft (53.3 m) | monopile / jacket / bucket | — |
| Medium | 5 | 147.6 × 213.3 ft (45 × 65 m) | 114.8 ft (35 m) | 191.2 ft (58.3 m) | **6** | 393.7 × 196.9 ft (120 × 60 m) as tabulated |
| Large | 4 | 164 × 295.3 ft (50 × 90 m) | 131.2 ft (40 m) | 207.6 ft (63.3 m) | **8** | 492.1 × 328.1 ft (150 × 100 m) as tabulated |

- Minimum distance from shore is 12 mi for small OSSs and 13.5 mi for medium and large ([PDE](https://boem.gov/sites/default/files/documents/renewable-energy/state-activities/AtlanticShoresSouth_PDE.pdf)).
- The large leg spacings look bigger than the topside; the PDE lists them as maxima, so treat them as envelope values.

**Colour.** Not specified in the permits.
- ESTIMATED: light-grey or white clad topside, with the foundation or jacket yellow from MHHW up to about 15 m as for turbines. This follows IALA O-139 and the BOEM marking rules cited in the COP.
- The photo's substation shows a cream sunlit face and a grey-blue shaded face. That fits a light-grey box of about 2:1 width to height.
- ESTIMATED typical form: 2–4 enclosed decks on 4–8 yellow jacket legs, plus a crane and often a helideck on one corner.

### 4.6 Marking and lighting (SOURCED, [OW1 COP Vol I](https://www.boem.gov/sites/default/files/documents/renewable-energy/state-activities/OCW01_COP%20Volume%20I_20220614.pdf) §7.4, p. 162–163; [FEIS](https://www.boem.gov/sites/default/files/documents/renewable-energy/state-activities/Ocean_Wind1_FEIS_Vol1.pdf) p. 2-14 and §3.20)

**Paint**
- The foundation base is **yellow RAL 1023**, all around, from **MHHW up to 50 ft (15.2 m)**. Ladders may use a contrasting colour.
- The WTGs are "no lighter than RAL 9010 Pure White and no darker than RAL 7035 Light Grey", non-reflective.
- Retro-reflective bands at least 2 ft wide, placed at least 30 ft above MHHW.

**ID characters**
- Each turbine carries a unique alphanumeric ID, **about 9.8 ft (3 m) tall**.
- The bottom of the characters sits 30–50 ft above MHHW, and the ID is readable through 360°.

**Aviation lights**
- Red L-864 medium-intensity lights, flashing together at 30 flashes per minute.
- On the nacelle top, plus mid-mast for turbines over 699 ft tip height.
- Controlled by an aircraft-detection system (ADLS), so normally off.

**Marine lights (yellow)**
- Corner structures (SPS): quick-flashing, range at least 5 nm.
- Perimeter structures (IPS): 2.5 s flash, range 3 nm.
- Inner boundary: 6 or 10 s flash, range 2 nm.
- Interior: 15 s flash, range 1 nm.

**Visibility of the yellow band.** Because of Earth curvature, the yellow band is below the horizon beyond about 11.4 mi (18.3 km) for an eye height of 5 ft.

---

## 5. Can the Atlantic City skyline be seen from the farm?

**Inputs (SOURCED).**
- Ocean Casino Resort: 710 ft = **216.4 m**, at 39.36175 N, 74.41350 W ([Wikipedia](https://en.wikipedia.org/wiki/Ocean_Casino_Resort)). The [tallest-buildings list](https://en.wikipedia.org/wiki/List_of_tallest_buildings_in_Atlantic_City) gives 718 ft / 219 m.
- Borgata: 431 ft = **131.4 m**, at 39.37749 N, 74.43510 W ([Wikipedia](https://en.wikipedia.org/wiki/Borgata)).
- Harrah's Waterfront Tower: 525 ft / 160 m (list).

**Geometry (DERIVED).**
- Observer height h = 50 m.
- Standard terrestrial refraction k = 0.13 (ESTIMATED convention), so the effective Earth radius R' = 6,371 km / (1 − 0.13) = 7,323 km.
- Horizon distance d_h = √(2R'h) = √(2 × 7.323×10⁶ × 50) = **27.06 km** (25.24 km with no refraction).
- Hidden height = (D − d_h)² / (2R').
- The dip of the sea horizon at 50 m is **0.212°**.

| Observer (50 m) | Target | Distance | Bearing from observer | Hidden (k = 0.13) | Visible | Top above true horizontal |
|---|---|---|---|---|---|---|
| Atlantic Shores WTG nearest to AC | Ocean Casino 216 m | 16.9 km | 296° | 0 m | 216 m | +0.50° (0.71° above sea horizon) |
| Atlantic Shores grid centroid | Ocean Casino | 29.3 km | 290° | 0.4 m | 216 m | +0.21° (0.42° above sea horizon) |
| Atlantic Shores grid centroid | Borgata 131 m | 31.7 km | 292° | 1.5 m | 130 m | +0.02° (0.23° above sea horizon) |
| OW1 lease centroid | Ocean Casino | 30.4 km | 331° | 0.8 m | 216 m | +0.19° |
| OW1 lease centroid | Borgata | 32.9 km | 330° | 2.3 m | 129 m | +0.01° |
| Atlantic Shores WTG farthest from AC | Ocean Casino | 41.1 km | 285° | 13.4 m | 203 m | +0.07° |

**Geometry says yes: the casino towers stand above the horizon from anywhere in the arrays.** At 30 km the whole cluster is only about 0.2–0.4° tall. With a 60° vertical field of view on 1080 px, that is about 4–8 px.

**Atmosphere says usually not.** Koschmieder's law gives the visual range V needed for a target of inherent contrast |C₀| to reach the 2 % threshold at distance D: V = 3.912·D / ln(|C₀|/0.02).

| Distance D | Needed V for \|C₀\| = 0.8 | 0.5 | 0.3 |
|---|---|---|---|
| 27 km | 28.6 km | 32.8 km | 39.0 km |
| 31 km | 32.9 km | 37.7 km | 44.8 km |

**Conclusions.**
- Coastal conditions limit visibility of the Wind Farm Area on **77 % of days**, with clear views on 23 % ("1 of every 4 to 5 days") ([OW1 FEIS](https://www.boem.gov/sites/default/files/documents/renewable-energy/state-activities/Ocean_Wind1_FEIS_Vol1.pdf) §3.20, citing Atlantic Shores 2021).
- The photo's own haze (V ≈ 20–30 km, §2.2) would put the skyline below the contrast threshold.
- **Recommendation: no land in the photo-match view.** An optional "clear day" preset could show a faint grey skyline at bearing ~290° from the array centre, at ≤ 3–5 % contrast.

---

## 6. Metocean

### 6.1 Buoys used (SOURCED station pages)

| Station | Location | Depth | Sensors |
|---|---|---|---|
| [NDBC 44091](https://www.ndbc.noaa.gov/station_page.php?station=44091) Barnegat NJ | 39.772 N, 73.769 W | 25 m | USACE/CDIP Waverider; waves only in the files used |
| [NDBC 44009](https://www.ndbc.noaa.gov/station_page.php?station=44009) Delaware Bay | 38.460 N, 74.692 W (26 nm SE of Cape May) | 24 m | 3 m discus; anemometer 3.8 m |
| [NDBC 44025](https://www.ndbc.noaa.gov/station_page.php?station=44025) Long Island | 40.258 N, 73.175 W | 40.2 m | 3 m foam buoy; anemometer 4.1 m |

The data are the NDBC historical standard-meteorological files for 2021–2025 ([archive](https://www.ndbc.noaa.gov/data/historical/stdmet/)), about 84k to 244k records per station. Statistics below are DERIVED with numpy.

### 6.2 Wind (DERIVED)

| Season | Station | Wind speed at buoy height (m/s): p10 / median / mean / p90 | Share ≥ 4 m/s | Share ≥ 7 m/s | Top directions (from) |
|---|---|---|---|---|---|
| **JJA** | 44009 | 1.9 / **4.5** / 4.8 / 7.9 | 59 % | 18 % | **SSW 22 %**, S 14 %, SW 10 %, SSE 6 %, NE 6 % |
| **JJA** | 44025 | 2.1 / **5.0** / 5.2 / 8.4 | 66 % | 22 % | **SSW 21 %**, SW 16 %, S 11 %, ENE 7 % |
| SON | 44009 | 2.6 / 6.4 / 6.7 / 11.2 | 78 % | 44 % | NE 11 %, SSW 10 %, NW 10 % |
| **DJF** | 44009 | 2.9 / **6.9** / 7.2 / 11.8 | 82 % | 49 % | **NW 14 %**, NNW 11 %, SSW 10 %, WNW 9 % |
| **DJF** | 44025 | 3.5 / **8.0** / 8.1 / 12.7 | 87 % | 61 % | **NW 16 %**, W 14 %, WNW 13 % |

- **Summer diurnal pattern** (JJA, 44009 / 44025): median 4.2 / 4.7 m/s at 09–11 EDT, **4.7 / 5.1 m/s at 14–17 EDT**, and 4.5 / 4.9 m/s at 02–05 EDT. Afternoons veer toward **S–SSW**, which is the sea-breeze and Bermuda-High flow.
- **Hub-height extrapolation (DERIVED).** Power law U(z) = U_ref·(z/z_ref)^α.
  - IEC 61400-3-1 normal offshore profile, **α = 0.14** ([WES 2024](https://wes.copernicus.org/articles/9/2001/2024/)): the 44009 JJA median 4.5 m/s at 3.8 m gives U10 = 5.15, **U156 = 7.6 m/s** and U175 = 7.7 m/s. For 44025 (5.0 m/s at 4.1 m): U10 = 5.66, **U156 = 8.3 m/s**.
  - With α = 0.11: U156 is 6.8 / 7.5 m/s. With α = 0.20: 9.5 / 10.4 m/s.
  - Summer flow of warm air over the cold pool produces strong shear and low-level jets; high-shear events are most frequent in summer ([Debnath et al. 2021, WES](https://wes.copernicus.org/articles/6/1043/2021/)).
  - The PNNL NJ lidar buoy found "Summer winds are southwesterly, and northwesterly to a lesser degree" at 90 m, with mean speeds lowest in summer ([PNNL-29823](https://www.pnnl.gov/main/publications/external/technical_reports/PNNL-29823.pdf) §3.2).
- **Rotor animation.** Cut-in is 3 m/s ([Wikipedia ASOW](https://en.wikipedia.org/wiki/Atlantic_Shores_Offshore_Wind_South), SOURCED but secondary). At a summer hub median of about 7–8 m/s a 236–280 m rotor turns at roughly 5–7 rpm. That figure is ESTIMATED from typical tip-speed ratio (8–9) × U / R; the turbine research sheet should confirm it.
- **Nearshore sea breeze.** The NJ sea breeze peaks in **July (26 % of events), August (20 %) and June (19 %)**. In simulations, 50 m winds fall from above 7 m/s at the coast to below 2 m/s about 25 nm offshore, then rise again beyond about 30 nm ([Rutgers COOL](https://marine.rutgers.edu/cool/weather/wind_analysis/seabreeze.pdf), SOURCED). The lease areas, 8–25 nm out, sit in this weak-wind trough on sea-breeze afternoons. That supports **calm, glassy-to-rippled scenes like the photo**.

### 6.3 Waves (DERIVED)
In the table, Hs is significant wave height, Tp (DPD) is the dominant period, Tm (APD) is the average period, and MWD is the mean wave direction (from).

| Season | Station | Hs (m): p10 / median / mean / p90 | Tp (s): p10 / median / p90 | Tm (s): median | MWD (from): top sectors |
|---|---|---|---|---|---|
| **JJA** | 44091 | 0.58 / **0.90** / 0.99 / 1.46 | 4.5 / **7.1** / 10.5 | 4.9 | **SSE 22 %, S 20 %, ESE 20 %**, SE 15 % |
| **JJA** | 44009 | 0.53 / **0.85** / 0.95 / 1.42 | 4.8 / **7.1** / 10.8 | 4.8 | SSE 24 %, SE 21 %, ESE 15 %, S 13 % |
| **JJA** | 44025 | 0.57 / **0.91** / 1.01 / 1.55 | 4.5 / **7.1** / 10.0 | 4.8 | S 22 %, SSE 20 %, SE 18 % |
| SON | 44091 | 0.64 / 1.20 / 1.33 / 2.16 | 4.3 / 8.3 / 12.5 | 5.1 | ESE 25 %, E 22 % |
| **DJF** | 44091 | 0.66 / **1.24** / 1.36 / 2.16 | 4.2 / **7.1** / 11.8 | 4.8 | E 17 %, ESE 15 %, SSE 13 %, N 9 % |
| **DJF** | 44025 | 0.67 / **1.34** / 1.47 / 2.42 | 4.3 / 6.7 / 10.8 | 4.7 | WNW 13 %, ESE 13 % |

**Sea surface temperature** (JJA median): **22.1–23.1 °C**, with air at 22.0–23.5 °C (DERIVED, same files). In winter the SST is 7.6–8.6 °C.

### 6.4 Swell versus wind sea
- **NDBC's own separation.** 44091's real-time spectral summary for 2026-08-16 to 09-30 ([file](https://www.ndbc.noaa.gov/data/realtime2/44091.spec)) gives:
  - Hs median 0.9 m.
  - Swell part median **0.2 m at 10.5 s from ESE/E**.
  - "Wind-wave" part median **0.8 m at 7.1 s from E/SE/ENE**.
  - Swell holds about 8–10 % of the energy (DERIVED, from the squared-height ratio).

  This window is late summer, not JJA.
- **Physical check (DERIVED).** A fully developed sea for the local wind is given by the Pierson-Moskowitz relations (SOURCED from [Stewart, *Intro. to Physical Oceanography*](https://www.colorado.edu/oclab/sites/default/files/attached-files/stewart_textbook.pdf) ch. 16): Hs = 0.21·U²/g and ωp = 0.877·g/U, with U at 19.5 m.
  - For U = 5 m/s: Hs = 0.54 m and Tp = 3.7 s.
  - The observed summer peak of 7.1 s and Hs 0.9 m are therefore **older, remotely generated sea or swell** arriving from SSE–S. The short local chop comes from SSW.
- **Shader recipe (ESTIMATED, built from the DERIVED stats).** Use two components. Directions are "toward" = from + 180°.
  1. **Primary swell:** Hs 0.4–0.6 m, Tp 7–8 s, from about 160° (SSE), so traveling toward about 340°. Long-crested, JONSWAP γ ≈ 3.3 or a narrow cos^2s spread (s about 10–20).
  2. **Wind sea:** Hs 0.3–0.5 m, Tp 3–4.5 s, from about 205° (SSW), so traveling toward about 25°. Short-crested, with a broad spread (s about 2–4).
  3. **Capillary and gravity ripples:** normal-map detail only, aligned with the wind sea.

  **Wavelengths (DERIVED, linear dispersion in 25–36 m depth):**

  | Period | Wavelength | Phase speed |
  |---|---|---|
  | 4.0 s | 25 m | 6.3 m/s |
  | 4.9 s | 37.5 m | 7.7 m/s |
  | 7.1 s | **76–78 m** | 10.7–11.0 m/s |
  | 8.3 s | 99–105 m | — |
  | 10.5 s | 139–155 m (shallow-water shortening begins) | — |

### 6.5 Whitecaps (SOURCED formula, DERIVED values)
- Monahan & O'Muircheartaigh (1980): **W(%) = 3.84×10⁻⁴·U10^3.41** (quoted in [Norris et al. 2013, *Ocean Science* 9:133](https://os.copernicus.org/articles/9/133/2013/os-9-133-2013.pdf), eq. 1).
- Beaufort 3 (7–10 kn ≈ 3.6–5.1 m/s): "Large wavelets, crests begin to break, scattered whitecaps". Beaufort 4 (11–16 kn): "numerous whitecaps" ([NOAA SPC](https://www.spc.noaa.gov/faq/tornado/beaufort.html)).
- **Onset:** about 3.5–4 m/s. In the formula, W is 0.043 % at 4 m/s and 0.093 % at 5 m/s.

| U10 (m/s) | 4 | 5 | 6 | 7 | 8 | 10 | 12 |
|---|---|---|---|---|---|---|---|
| Whitecap fraction W (%) | 0.04 | **0.09** | 0.17 | 0.29 | 0.46 | 0.99 | 1.84 |

- The JJA median U10 is about 5–5.7 m/s, so W is about 0.1 %: very few whitecaps, which matches the photo. The summer p90 (U10 about 9 m/s) gives about 0.6 %. The winter median (U10 about 8.9 m/s at 44025) gives about 0.7 %.

---

## 7. Water optics

### 7.1 Satellite ocean colour at the site (DERIVED)
- **Main dataset:** ESA OC-CCI v6.0 monthly 4 km ([ERDDAP `pmlEsaCCI60OceanColorMonthly`](https://coastwatch.pfeg.noaa.gov/erddap/griddap/pmlEsaCCI60OceanColorMonthly.html)), JJA 2019–2025. The box is 39.00–39.25 N, 74.10–74.40 W, the Ocean Wind 1 / Atlantic Shores South vicinity; n = 1,176 pixel-months.
- **Check dataset:** MODIS-Aqua monthly ([`erdMH1chlamday`](https://coastwatch.pfeg.noaa.gov/erddap/griddap/erdMH1chlamday.html), [`erdMH1kd490mday`](https://coastwatch.pfeg.noaa.gov/erddap/griddap/erdMH1kd490mday.html)), 2015–2021.

**Medians and ranges**

| Quantity (JJA) | Median | p10–p90 | Notes |
|---|---|---|---|
| Chlorophyll-a (OC-CCI) | **0.94 mg m⁻³** | 0.63–1.50 | MODIS OC3 gives 1.26 (0.75–4.46). Case-2 coastal water inflates standard algorithms. |
| Kd(490) | **0.096 m⁻¹** (1/Kd ≈ 10.5 m) | 0.073–0.129 | MODIS gives 0.12. Annual cycle: winter about 0.18–0.19, July minimum 0.11. |
| Rrs 412 / 443 / 490 / 510 / 560 / 665 (sr⁻¹) | 0.00357 / 0.00368 / 0.00367 / 0.00330 / **0.00248** / 0.00021 | — | Flat blue-to-green, then collapses in the red |
| Total absorption a 412 / 443 / 490 / 510 / 560 / 665 (m⁻¹) | 0.121 / 0.088 / 0.071 / 0.071 / 0.077 / **0.669** | a(560): 0.071–0.086 | Includes water |
| Particle backscatter bbp 443 / 560 / 665 (m⁻¹) | 0.0042 / 0.0031 / 0.0025 | bbp(560): 0.0019–0.0069 | — |
| CDOM + detritus absorption a_dg(443) | 0.050 m⁻¹ | — | — |
| Phytoplankton absorption a_ph(443) | 0.030 m⁻¹ | — | CDOM dominates the blue absorption, which is why the water is Case-2 |

**Monthly chlorophyll cycle** (MODIS-Aqua, 2015–2021, same box): winter–spring about 2.2–2.5 mg m⁻³, **July minimum 1.09**, August 1.25, September 1.81. This matches the literature: "summer conditions tend to be oligotrophic" on the MAB shelf, with fall and winter blooms ([Xu et al. 2011 abstract](https://www.sciencedirect.com/science/article/abs/pii/S0278434311002081)).

### 7.2 Forel-Ule class and true colour (DERIVED)
**Method** (van der Woerd & Wernand 2015, [Sensors 15:25663](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC4634488/)):
- Compute CIE X, Y, Z as linear sums of Rrs, using the SeaWiFS-band coefficients (Table 3). OC-CCI bands match SeaWiFS: 412, 443, 490, 510, 555→560, 670→665.
  - X = 2.957·R412 + 10.861·R443 + 3.744·R490 + 3.455·R510 + 52.304·R560 + 32.825·R665
  - Y = 0.112·R412 + 1.711·R443 + 5.672·R490 + 21.929·R510 + 59.454·R560 + 17.810·R665
  - Z = 14.354·R412 + 58.356·R443 + 28.227·R490 + 3.967·R510 + 0.682·R560 + 0.018·R665
- The hue angle is atan2(y − ⅓, x − ⅓).
- Apply the SeaWiFS 5th-order correction (Table 4).
- Classify with the Forel-Ule boundaries of [Wernand et al. 2013, *Ocean Sci.* 9:477](https://os.copernicus.org/articles/9/477/2013/os-9-477-2013.pdf), Table 3. FU4 is 189.20° < α ≤ 205.19°.

**Results**

| | Hue (raw → corrected) | FU class |
|---|---|---|
| JJA median spectrum | 204.2° → **201.5°** | **FU 4** |
| Per pixel-month | — | median FU 4, p10 FU 3, p90 FU 5 |
| June / July / August | 197.1° / 199.5° / 204.7° | FU 4 each month |

**What FU 4 means.** FU 4 is **blue with a green tint**, clearer than typical North Sea coastal water (FU 5–9; see Wernand 2013 Fig. 5). It is *not* the indigo of FU 1–2. The ocean off NJ in summer is a fairly clear blue-green shelf sea.

**Water-leaving colour.** Convert XYZ (equal-energy illuminant) → Bradford adaptation to D65 → linear sRGB, applied to π·Rrs:
- **Luminance reflectance Y ≈ 0.0074**. The water body returns about 0.7 % of downwelling light.
- **Linear RGB ≈ (0.0019, 0.0087, 0.0118)**, which is (0.16, 0.73, 1.00) when normalised. This is a **teal blue**.
- For viewing, a ×4 exposure encodes as sRGB (21, 52, 61), about #15343d.

**Semi-analytic check (DERIVED).**
- rrs = 0.0949u + 0.0794u² and Rrs ≈ 0.52·rrs / (1 − 1.7·rrs), with u = bb/(a + bb). These are the standard Gordon/Lee relations (the [QAA v6 doc](https://ioccg.org/wp-content/uploads/2020/11/qaa_v6_202011.pdf) uses the same framework).
- At 560 nm: a = 0.077, bb ≈ 0.0031 + about 0.0007 for water (ESTIMATED; Morel 1974 order of magnitude). So u = 0.047, rrs = 0.0046, and **Rrs ≈ 0.0024**, against the observed 0.00248. The inherent optical properties are self-consistent.

### 7.3 Why the photo looks deep navy even though the water is FU 4 (DERIVED / ESTIMATED)
- Upwelling light is only about 0.7 % of the incident light.
- Seen from a drone at 20–60° below the horizon, the sea's brightness is dominated by **Fresnel reflection of the sky**: about 2 % at normal incidence, rising toward grazing angles.
- In the foreground (linear Y 0.03–0.05), reflected blue sky from the zenith side (0.02–0.05 × sky of 0.6–0.8) and teal upwelling (about 0.007 × E/π) are about equal. The result is dark blue-slate, as in the photo (sRGB 30–48, 48–68, 63–86).
- Near the horizon, reflectance approaches about 20–60 %, so the sea converges to the pale horizon sky (sRGB 187, 210, 229 at +2 px). This is why the far field is pale blue.
- Nothing in the photo requires "indigo" water. **Match it with physically plausible FU 4 water plus a correct Fresnel sky reflection**, and tune the exposure so that the foreground sea is about 5–8 % of the luminance at the top of the sky.

### 7.4 Shader suggestions (ESTIMATED from the DERIVED properties; linear RGB)

| Parameter | Suggested value | Basis |
|---|---|---|
| Absorption σa (m⁻¹), R / G / B | **0.35 / 0.077 / 0.075** | G = a(560); B = mean of a(443) and a(490); R interpolated toward about 600–620 nm (the a(665) of 0.67 overstates red absorption for an sRGB red primary centred about 600 nm) |
| Backscatter σb (m⁻¹), R / G / B | **0.0028 / 0.0038 / 0.0055** | bbp plus approximate seawater bbw |
| Single-scatter albedo-like ratio bb/(a + bb), R / G / B | 0.008 / 0.047 / 0.068 | — |
| Deep / upwelling ("scatter") colour | **(0.0019, 0.0087, 0.0118)** × sky irradiance; hue (0.16, 0.73, 1.0) | π·Rrs, §7.2 |
| Transmittance of submerged steel at 1 / 3 / 6 m | R: 0.70 / 0.35 / 0.12, G: 0.93 / 0.79 / 0.63, B: 0.93 / 0.80 / 0.64 | exp(−σa·z), one-way. Submerged yellow paint turns green-grey within about 3 m, then vanishes. Using Kd ≈ 0.1 m⁻¹ (two-way) gives similar results. |
| Photo calibration targets | Sea at +2 px ≈ linear (0.50, 0.64, 0.78); at +93 px ≈ (0.16, 0.30, 0.49); at +253 px ≈ (0.03, 0.06, 0.09) | §2.2 table |
| Foam albedo | about 0.5–0.6, only where the whitecap mask is on, covering W from §6.5 | ESTIMATED |

---

## 8. Atmosphere

### 8.1 Aerosol and turbidity
- **AERONET summer AOD (DERIVED).** Level 1.5 daily means, JJA 2022–2025 ([AERONET web service](https://aeronet.gsfc.nasa.gov/cgi-bin/print_web_data_v3)):

  | Site | Days | AOD500 median | p10–p90 | AOD550 median | Ångström (440–870) |
  |---|---|---|---|---|---|
  | GSFC (MD) | 335 | **0.20** | 0.08–0.39 | 0.17 | 1.64 |
  | Wallops (VA coast) | 256 | **0.19** | 0.09–0.43 | 0.17 | 1.58 |
  | CCNY (NYC) | 297 | **0.19** | 0.07–0.47 | 0.16 | 1.60 |

  The mean is higher (about 0.25) because of the June 2023 Canadian wildfire smoke. The Ångström values of about 1.6 mean fine, pollution-type aerosol, not sea salt, dominates the *column*. Sea-salt haze is confined to the lowest few hundred metres, where it whitens the horizon.
- **Historical context (SOURCED).** GSFC averaged a July AOD500 of 0.48 in 1993–1999 ([Holben et al., AERONET climatology](https://aeronet.gsfc.nasa.gov/new_web/PDF/AERONET_climo.pdf), Table 3). Today's value is about 0.2, after US SO₂ cuts. **Do not use 1990s haze values.**
- **Rayleigh optical depth (DERIVED).** τR(λ) = 0.008569·λ⁻⁴·(1 + 0.0113·λ⁻² + 0.00013·λ⁻⁴), with λ in µm (Hansen & Travis 1974 fit). This gives **τR(550) = 0.0973**, τR(440) = 0.243 and τR(680) = 0.041.
- **Preetham turbidity (DERIVED).** Preetham et al. define T = (τ_molecular + τ_haze) / τ_molecular ([paper](https://dl.acm.org/doi/pdf/10.1145/311535.311545)).

  | Condition | AOD550 | T |
  |---|---|---|
  | Clean (p10) | 0.07 | 1.7 |
  | **Median** | 0.166 | **2.7** |
  | — | 0.25 | 3.6 |
  | Hazy (p90) | 0.37 | **4.8** |

  **For the photo's pale, milky horizon use T ≈ 4–6** (ESTIMATED). Preetham is known to misbehave at low T ([Zotti et al. 2007](https://www.cg.tuwien.ac.at/research/publications/2007/zotti-2007-wscg/zotti-2007-wscg-paper.pdf)). Hosek-Wilkie accepts T 1–10; use 3–5 there, with a ground albedo of about 0.06–0.10 for the sea (ESTIMATED).

### 8.2 Three.js r180 `Sky` mapping (SOURCED code, DERIVED mapping)
The code is [`examples/jsm/objects/Sky.js` @0.180.0](https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/objects/Sky.js).
- **Defaults:** `turbidity 2, rayleigh 1, mieCoefficient 0.005, mieDirectionalG 0.8`.
- **Mie coefficient** = `0.434·(0.2·T·1e-17)·MieConst·mieCoefficient`, with MieConst_G = 2.78×10¹⁴. Mie zenith length is 1.25 km; Rayleigh zenith length is 8.4 km, with βR_G = 1.356×10⁻⁵ m⁻¹.
- **Derived optical depths:**
  - The Rayleigh zenith depth is 0.114. The shader is roughly physical there.
  - At the defaults, the Mie zenith depth is only **0.003**.
  - With T = 10 and mie 0.005 it is 0.015; with T = 10 and mie 0.05 it is **0.15**, which is about the real AOD.
- The shader is art-directed (pow 1.5, pow ½ blends), so **tune by eye against the §2.2 table**.
- **Starting point (ESTIMATED):** `turbidity 8–10, rayleigh 1.2–2.0, mieCoefficient 0.006–0.012, mieDirectionalG 0.8–0.85`.
- **Targets** from the §2.2 table:
  - Horizon ≈ linear (0.78, 0.83, 0.91).
  - About 25–30° up, a blue gap ≈ (0.47, 0.66, 0.87).
  - The horizon should be about 1.3× brighter than the sea directly below it.
- **Aerial perspective for geometry.** Add exponential distance fog with **σ ≈ 0.13–0.20 km⁻¹** (V ≈ 20–30 km).
  - Transmittance is 0.88–0.82 at 1 km, 0.52–0.37 at 5 km, 0.27–0.14 at 10 km and ≤ 0.07 at 20 km.
  - Use the horizon sky colour as the in-scatter colour.
  - Optionally concentrate the fog below about 300 m: marine haze layer scale height about 0.3–0.5 km (ESTIMATED).

### 8.3 Visibility climatology (DERIVED; ASOS via [Iowa Environmental Mesonet](https://mesonet.agron.iastate.edu/request/download.phtml), JJA 2021–2025)

| Station | Hours | Visibility ≥ 10 SM (sensor cap, 16 km) | < 5 SM | < 1 SM | Main weather codes |
|---|---|---|---|---|---|
| **ACY** Atlantic City Intl | Daytime 09–17 | 93 % | 3.3 % | 0.3 % | rain, mist (BR), haze (HZ), thunder nearby |
| ACY | All hours | 87 % | 5.1 % | 1.7 % | BR, RA, HZ, FG |
| **WWD** Cape May | Daytime 09–17 | 93 % | 1.5 % | 0.5 % | — |

- ASOS stops reporting at 10 mi, so "≥ 10 SM" does *not* mean crystal clear.
- The FEIS figure of **23 % clear-view days** (§5) is the better measure of long-range clarity.
- Fog (FG) is reported in about 1 % of summer hours on land. It is ESTIMATED to be more frequent offshore over the cold pool in late spring and early summer, but no offshore fog statistic was found.

### 8.4 Clouds
- **ASOS lowest layer, JJA daytime (DERIVED):**
  - ACY: CLR (nothing below 12,000 ft) 48 %, FEW 21 %, SCT 13 %, BKN 10 %, OVC 7 %. Median base of the FEW/SCT/BKN deck is **3,700 ft (1.1 km)**, interquartile range 2,200–5,500 ft.
  - WWD (coast): CLR 64 %. Median base **2,500 ft (0.76 km)**.
- **Regime (SOURCED).** Sea breezes form under weak synoptic flow when cold coastal water sits next to warm land. They are most frequent in June–August ([Rutgers COOL](https://marine.rutgers.edu/cool/weather/wind_analysis/seabreeze.pdf)). Fair-weather cumulus marks the sea-breeze front *over land*, and the coastal strip is typically cloud-free ([NOAA JetStream](https://www.noaa.gov/jetstream/ocean/sea-breeze)).
- **ESTIMATED consequence for the view offshore:**
  - Overhead: mostly clear or thin sky.
  - Looking west toward land: a line of flat cumulus humilis over the coast.
  - Seaward: occasional shallow stratocumulus or haze. On SW-flow days there are stratiform streaks (altostratus or cirrostratus) ahead of fronts.
- **The photo shows:** flattened fair-weather cumulus and stratocumulus patches in the upper frame, and thin horizontal stratiform streaks (cirrostratus or altostratus look) in the lower sky band. Both are plausible for a NJ summer day with SW flow.
- **Suggested cloud layers (ESTIMATED):**
  - Cumulus or stratocumulus base about 0.8–1.2 km, thickness 0.2–0.6 km, cover 10–30 %.
  - A high thin sheet at 6–9 km with low optical depth, for the streaks.

---

## 9. Sun positions (DERIVED, NOAA Solar Calculator algorithm)
- **Method:** the [NOAA spreadsheet](https://gml.noaa.gov/grad/solcalc/calcdetails.html) equations (Meeus-based), coded in Python and run for **Atlantic City, 39.36 N, 74.42 W**, EDT = UTC − 4, year 2026.
- **Refraction** uses NOAA's piecewise formula.
- **Direction vector:** (sin Az·cos El, sin El, −cos Az·cos El), with x = E, y = Up, z = S.
- **Farm check:** at the farm centroids (39.12–39.27 N, 74.09–74.24 W) values differ by ≤ 0.2° in elevation and ≤ 0.5° in azimuth. For example, at 15:00 on 21 June the OW1 centroid gives El 59.96°, Az 247.5°.

| Date | Declination | Equation of time | Sunrise | Solar noon | Sunset |
|---|---|---|---|---|---|
| 2026-06-21 | +23.438° | −1.86 min | 05:31 | 13:00 | 20:28 EDT |
| 2026-09-21 | +0.521° | +6.97 min | 06:45 | 12:51 | 18:57 EDT |

| Local time (EDT) | 21 Jun elevation (refracted) | 21 Jun azimuth | 21 Jun dir (x, y, z) | 21 Sep elevation (refracted) | 21 Sep azimuth | 21 Sep dir (x, y, z) |
|---|---|---|---|---|---|---|
| 09:00 | 37.48° | 88.9° | (+0.793, +0.609, −0.016) | 24.84° | 111.4° | (+0.845, +0.420, +0.331) |
| 12:00 | 69.70° | 137.2° | (+0.236, +0.938, +0.255) | 49.48° | 160.3° | (+0.219, +0.760, +0.611) |
| 15:00 | 60.00° | 247.0° | (−0.460, +0.866, +0.196) | 41.20° | 225.3° | (−0.535, +0.659, +0.529) |
| 18:00 | 25.80° | 280.1° | (−0.886, +0.435, −0.158) | 10.11° | 262.2° | (−0.975, +0.176, +0.133) |
| 19:45 | 6.60° | 295.1° | (−0.899, +0.115, −0.422) | **−10.19° (after sunset)** | 279.0° | (−0.972, −0.177, −0.154) |

**Framing to match the photo (ESTIMATED).** The photo needs the sun to the left and behind the camera, fairly high, with no glitter in frame (§2.2).
- On 21 June at 15:00–16:00 EDT (Az about 247–260°, El about 50–60°), a camera heading of about **60–80°** (ENE, along the Atlantic Shores rows at 80.6°) puts the sun about 180–200° relative: behind, slightly left.
- This faces open ocean with Atlantic City about 110° behind-left, out of frame.
- On 21 September at 15:00 (Az 225°, El 41°), use a heading of about 45–60°.

---

## 10. Life on site

### 10.1 Vessels (SOURCED unless noted)
- **Crew transfer vessels (CTVs):**
  - Aluminium catamarans, **about 20–27 m**.
  - *Atlantic Pioneer*, the first US-built CTV (2016), is **21 m (69 ft)**, built by Blount Boats ([Maritime Executive](https://maritime-executive.com/article/first-us-offshore-wind-crew-boat-hits-the-water)).
  - Its livery, from the article's photo: white superstructure, **blue hull band with a teal stripe**, black bottom, and a thick black rubber bow fender for pushing onto boat landings.
  - A StratCat 27 is **27.0 m long, 8.9 m beam, 1.5 m draft, 24–26 kn**, carrying 24 passengers and 3 crew ([Strategic Marine](https://www.strategicmarine.com/product/stratcat-27-crew-transfer-vessel/)).
  - "CTVs push onto the boat landing on the foundations to allow technicians to ascend the WTG" ([OW1 COP](https://www.boem.gov/sites/default/files/documents/renewable-energy/state-activities/OCW01_COP%20Volume%20I_20220614.pdf) §6.1.2, near Figure 6.1.2-11).
- **Service operation vessels (SOVs):**
  - *ECO Edison* is **80 m (262 ft)**, houses 60 technicians, has a motion-compensated walk-to-work gangway and a daughter craft ([Maritime Executive](https://maritime-executive.com/article/first-u-s-built-sov-christened-for-oersted-s-offshore-wind-operations)).
  - Sister *ECO Liberty* (Empire Wind) is **262 × 62 ft (80 × 19 m)**. From its [WorkBoat photo](https://www.workboat.com/wind/new-edison-chouest-sov-ready-after-empire-wind-reprieve): **dark navy hull**, white superstructure, a tall white gangway and elevator tower amidships, and an orange rescue boat.
- **Traffic density:**
  - OW1 planned up to 908 crew-vessel trips a year and up to 2,278 CTV or SOV trips a year ([OW1 FEIS](https://www.boem.gov/sites/default/files/documents/renewable-energy/state-activities/Ocean_Wind1_FEIS_Vol1.pdf) §2.1.2.3).
  - O&M ports were Atlantic City for both OW1 (the Bungalow Park facility) and Atlantic Shores ([PDE](https://boem.gov/sites/default/files/documents/renewable-energy/state-activities/AtlanticShoresSouth_PDE.pdf)).
  - Vessel speed is under 10 kn in right-whale management areas ([FEIS](https://www.boem.gov/sites/default/files/documents/renewable-energy/state-activities/Ocean_Wind1_FEIS_Vol1.pdf)).
- **Scene suggestion (ESTIMATED):** 0–2 CTVs moving at 10–20 kn with a white wake about 100–300 m long, and at most one SOV holding position at a turbine.

### 10.2 Seabirds (SOURCED)

**NJ Ecological Baseline Study, 2008–2009** ([NJDEP / Geo-Marine Vol I](https://tethys.pnnl.gov/sites/default/files/publications/Ocean-Wind-Power-Baseline-Volume1.pdf)):
- Most abundant birds by season: Black Scoter in winter, **Northern Gannet in spring**, **Laughing Gull in summer**, and Laughing Gull plus Gannet in fall.
- Only **4.8 %** of more than 70,000 flying birds flew in the rotor-swept zone (30.5–213 m).
- Gannet was the species most often in that zone offshore, but only **3.9 %** of gannets were there, so about 96 % flew below 30 m.
- Gannets concentrate in depths over 10 m, within about 25 km of the coast.
- Laughing Gulls stay within about 7.6 km of shore. Common Terns range to about 18 km.
- Cory's Shearwaters and Wilson's Storm-Petrels are summer visitors offshore; the shearwaters are mostly beyond the 30 m isobath.

**Flight heights**
- Northern Gannet GPS tracking: median **12 m** while commuting and **27 m** while foraging ([Cleasby et al. 2015](https://besjournals.onlinelibrary.wiley.com/doi/full/10.1111/1365-2664.12529)).

**Sizes and colours** (from [Wikipedia gannet](https://en.wikipedia.org/wiki/Northern_gannet), [Laughing Gull](https://en.wikipedia.org/wiki/Laughing_gull), [American Herring Gull](https://en.wikipedia.org/wiki/American_herring_gull)):

| Bird | Wingspan | Length | Adult plumage |
|---|---|---|---|
| Gannet | **170–180 cm** | 87–100 cm | White, black wingtips, buff head. Juveniles grey-brown. |
| Laughing Gull | **98–110 cm** | 36–41 cm | Dark-grey mantle, black hood in summer, red bill |
| Herring Gull | **120–155 cm** | 53–66 cm | Pale-grey mantle, black wingtips with white "mirrors" |

**Scene suggestion (ESTIMATED):** in summer, a few Laughing Gulls and terns in the near field at 2–20 m altitude, and gulls resting on transition-piece platforms. Gannets are rare in summer, so reserve them for spring or fall scenes, gliding 5–30 m above the swell.

### 10.3 Buoys and aids to navigation
- **Weather buoys:**
  - NDBC 3 m discus and foam hulls ([44009](https://www.ndbc.noaa.gov/station_page.php?station=44009), [44025](https://www.ndbc.noaa.gov/station_page.php?station=44025)), and a Waverider at 44091, which is a sphere under 1 m, ESTIMATED.
  - Atlantic Shores deployed **two** metocean buoys in its lease off Atlantic City in May 2021 ([Atlantic Shores](https://atlanticshoreswind.com/atlantic-shores-offshore-wind-launches-buoys-to-collect-essential-atmospheric-cold-pool-animal-migration-data/)).
  - PNNL's AXYS WindSentinel lidar buoy sat about 5 km off Atlantic City in 2015–2017 ([PNNL-29823](https://www.pnnl.gov/main/publications/external/technical_reports/PNNL-29823.pdf)).
  - Hull colours are not given in these sources; ESTIMATED yellow with a white or grey mast.
- **Lights at turbines:** yellow lights on the turbines themselves (§4.6). No separate channel buoys lie inside the arrays.
- **Scene suggestion (ESTIMATED):** optionally one yellow metocean buoy, about 2–3 m tall above the water, at the array edge.

---

## 11. Gaps and cautions
1. **Reference photo location: NOT IDENTIFIED.** The evidence points to a German North Sea farm (§2.1).
2. **Ocean Wind 1 exact turbine bearings: NOT FOUND.** No public point layer exists. The FEIS text says 1 × 0.8 nm "southeast-northwest orientation"; Wikipedia says ENE/WSW. Use the Atlantic Shores lattice instead.
3. **Substation colours and deck counts:** not in the permits. The values given are ESTIMATED.
4. **Hub-height wind** is extrapolated from buoys. The NJ lidar data (NYSERDA/PNNL, and Atlantic Shores ASOW-1 and ASOW-6 on NOAA IOOS) exist but were not processed here.
5. **Chlorophyll** from standard satellite algorithms is biased high in Case-2 water. The FU class and hue come from Rrs and are more robust.
6. **Offshore fog frequency:** no offshore statistic was found. ASOS land stations only.
7. **Atlantic Shores lease:** still held as far as found. A 2026 buyback may follow, since E&E (2026-05-26) lists it as "similarly situated" to leases already bought back.

---

## 12. Source list
- BOEM Ocean Wind 1 FEIS Vol 1 (2023): https://www.boem.gov/sites/default/files/documents/renewable-energy/state-activities/Ocean_Wind1_FEIS_Vol1.pdf
- Ocean Wind 1 COP Vol I (2022-06-14): https://www.boem.gov/sites/default/files/documents/renewable-energy/state-activities/OCW01_COP%20Volume%20I_20220614.pdf
- BOEM Ocean Wind 1 page: https://www.boem.gov/renewable-energy/state-activities/ocean-wind-1
- Atlantic Shores South PDE: https://boem.gov/sites/default/files/documents/renewable-energy/state-activities/AtlanticShoresSouth_PDE.pdf
- Atlantic Shores South FEIS App C: https://www.boem.gov/sites/default/files/documents/renewable-energy/state-activities/AtlanticShoresSouth_AppC_PDE%20and%20Max-Case%20Scenario_DEIS.pdf
- Atlantic Shores NOAA IHA/LOA application (2022): https://media.fisheries.noaa.gov/2022-09/AtlanticShoresOWF_2022_Application_OPR1.pdf
- BOEM Atlantic Shores South page: https://www.boem.gov/renewable-energy/state-activities/atlantic-shores-south
- BOEM lease outlines FeatureServer: https://services7.arcgis.com/G5Ma95RzqJRPKsWL/ArcGIS/rest/services/Wind_Lease_Boundaries__BOEM_/FeatureServer
- BOEM turbine locations FeatureServer: https://services7.arcgis.com/G5Ma95RzqJRPKsWL/arcgis/rest/services/Offshore_Wind_-_Proposed_or_Installed_Turbine_Locations/FeatureServer
- BOEM OCS-A 0538 (Attentive): https://www.boem.gov/renewable-energy/state-activities/attentive-energy-ocs-0538
- BOEM OCS-A 0542 (Invenergy/Leading Light): https://www.boem.gov/renewable-energy/state-activities/invenergy-ocs-0542
- DOI and TotalEnergies release (2026-03-23): https://www.doi.gov/pressreleases/interior-and-totalenergies-agree-end-offshore-wind-projects-lowering-costs-american
- Harvard EELP federal offshore wind tracker (updated 2026-09-01): https://eelp.law.harvard.edu/tracker/federal-offshore-wind-deployment/
- Haas Energy Institute, "Who Killed Offshore Wind?" (2026-08-10): https://energyathaas.wordpress.com/2026/08/10/who-killed-offshore-wind/
- offshorewind.biz, NJ and Atlantic Shores OREC termination (2025-08-19): https://www.offshorewind.biz/2025/08/19/new-jersey-atlantic-shores-terminate-orec-contract-for-1-5-gw-offshore-wind-project/
- NJBPU order vacating the Atlantic Shores OREC (2025-08-13): https://www.nj.gov/bpu/pdf/boardorders/2025/20250813/8D%20ORDER%20ASOW%20Petition%20to%20Terminate.pdf
- WorkBoat, EDF exits Atlantic Shores (2025-02-22): https://www.workboat.com/wind/edf-exits-atlantic-shores-wind-project
- E&E News (2026-05-26): https://www.eenews.net/articles/trump-is-paying-companies-to-quit-offshore-wind-these-projects-could-be-next-2/
- RTO Insider, Atlantic Shores approval to be reviewed: https://www.rtoinsider.com/138874-atlantic-shores-offshore-wind-approval-to-be-reviewed/
- Wikipedia, Ocean Wind 1: https://en.wikipedia.org/wiki/Ocean_Wind_1 ; Atlantic Shores South: https://en.wikipedia.org/wiki/Atlantic_Shores_Offshore_Wind_South
- USCG MARIPARS final report (2020): https://www.navcen.uscg.gov/sites/default/files/pdf/PARS/FINAL_REPORT_PARS_May_14_2020.pdf
- USCG NJ PARS notice (2022): https://www.federalregister.gov/documents/2022/03/24/2022-06228/port-access-route-study-seacoast-of-new-jersey-including-offshore-approaches-to-the-delaware-bay
- NDBC stations 44091, 44009, 44025 and historical stdmet data: https://www.ndbc.noaa.gov/ ; realtime spec file: https://www.ndbc.noaa.gov/data/realtime2/44091.spec
- PNNL-29823 lidar buoy report: https://www.pnnl.gov/main/publications/external/technical_reports/PNNL-29823.pdf
- Debnath et al. 2021, WES 6:1043: https://wes.copernicus.org/articles/6/1043/2021/
- IEC offshore shear α = 0.14 (as quoted in WES 2024): https://wes.copernicus.org/articles/9/2001/2024/
- Rutgers COOL, NJ sea breeze: https://marine.rutgers.edu/cool/weather/wind_analysis/seabreeze.pdf
- Stewart, *Introduction to Physical Oceanography* (PM spectrum): https://www.colorado.edu/oclab/sites/default/files/attached-files/stewart_textbook.pdf
- Norris et al. 2013 (Monahan whitecap formula): https://os.copernicus.org/articles/9/133/2013/os-9-133-2013.pdf
- NOAA SPC Beaufort scale: https://www.spc.noaa.gov/faq/tornado/beaufort.html
- ESA OC-CCI v6 monthly on ERDDAP: https://coastwatch.pfeg.noaa.gov/erddap/griddap/pmlEsaCCI60OceanColorMonthly.html
- MODIS-Aqua chlorophyll and Kd490 on ERDDAP: https://coastwatch.pfeg.noaa.gov/erddap/griddap/erdMH1chlamday.html
- van der Woerd & Wernand 2015 (hue algorithm): https://www.ncbi.nlm.nih.gov/pmc/articles/PMC4634488/
- Wernand et al. 2013 (FU boundaries): https://os.copernicus.org/articles/9/477/2013/os-9-477-2013.pdf
- Pitarch et al. 2021, global FU maps: https://essd.copernicus.org/articles/13/481/2021/
- QAA v6 (IOCCG): https://ioccg.org/wp-content/uploads/2020/11/qaa_v6_202011.pdf
- Xu et al. 2011, MAB chlorophyll seasonality: https://www.sciencedirect.com/science/article/abs/pii/S0278434311002081
- AERONET climatology (Holben et al.): https://aeronet.gsfc.nasa.gov/new_web/PDF/AERONET_climo.pdf ; AERONET v3 data service: https://aeronet.gsfc.nasa.gov/cgi-bin/print_web_data_v3
- Preetham, Shirley & Smits 1999: https://dl.acm.org/doi/pdf/10.1145/311535.311545 ; Zotti et al. 2007 review: https://www.cg.tuwien.ac.at/research/publications/2007/zotti-2007-wscg/zotti-2007-wscg-paper.pdf
- three.js r180 Sky.js: https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/objects/Sky.js
- Iowa Environmental Mesonet ASOS download: https://mesonet.agron.iastate.edu/request/download.phtml
- NOAA JetStream, sea breeze: https://www.noaa.gov/jetstream/ocean/sea-breeze
- NOAA Solar Calculator details: https://gml.noaa.gov/grad/solcalc/calcdetails.html
- Wikipedia, Ocean Casino Resort / Borgata / tallest buildings in Atlantic City: https://en.wikipedia.org/wiki/Ocean_Casino_Resort , https://en.wikipedia.org/wiki/Borgata , https://en.wikipedia.org/wiki/List_of_tallest_buildings_in_Atlantic_City
- Maritime Executive (Atlantic Pioneer; ECO Edison): https://maritime-executive.com/article/first-us-offshore-wind-crew-boat-hits-the-water , https://maritime-executive.com/article/first-u-s-built-sov-christened-for-oersted-s-offshore-wind-operations
- WorkBoat, ECO Liberty: https://www.workboat.com/wind/new-edison-chouest-sov-ready-after-empire-wind-reprieve
- Strategic Marine StratCat 27: https://www.strategicmarine.com/product/stratcat-27-crew-transfer-vessel/
- NJ Ecological Baseline Studies Vol I: https://tethys.pnnl.gov/sites/default/files/publications/Ocean-Wind-Power-Baseline-Volume1.pdf
- Cleasby et al. 2015, gannet flight heights: https://besjournals.onlinelibrary.wiley.com/doi/full/10.1111/1365-2664.12529
- Wikipedia bird pages: https://en.wikipedia.org/wiki/Northern_gannet , https://en.wikipedia.org/wiki/Laughing_gull , https://en.wikipedia.org/wiki/American_herring_gull
- Atlantic Shores buoy launch: https://atlanticshoreswind.com/atlantic-shores-offshore-wind-launches-buoys-to-collect-essential-atmospheric-cold-pool-animal-migration-data/
