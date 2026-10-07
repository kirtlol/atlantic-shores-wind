// Sea-state spectrum shared by the GPU FFT cascades (ocean-fft.js, GLSL port below) and the
// CPU surface mirror (surface-cpu.js). Pure JS, no three.js objects, so it can be unit-tested.
//
// Model (SCENE-SPEC §11.1):
//   wind sea  JONSWAP peak (gamma 3.3) on an ω⁻⁴ equilibrium range turning into ω⁻⁵ saturation
//             at 3 ωp (see windSeaShape), Hs/Tp from the effective-fetch law of §11.1 (F = 50 km,
//             anchored to Hs 0.50 m, Tp 3.8 s at U10 4.5 m/s; longer fetch in stronger winds, see
//             windSeaFromWind), Longuet-Higgins cos^2s(dθ/2) spreading with s = 3 at the peak,
//             broadening above the peak (Mitsuyasu).
//   swell     JONSWAP (gamma 3.3), Hs 0.45 m, Tp 7.5 s from 160°T, s = 15.
//   dispersion: finite depth (22 m, SITE.waterDepthM) with the capillary term:
//             ω² = (g k + T k³) tanh(k d).
//
// Conventions: +X east, +Z south. A wave travelling TOWARD compass azimuth A has direction
// (sin A, -cos A) in (x, z). The field is η(x, t) = Σ_k h̃(k, t) e^{i k·x} with
// h̃(k, t) = h0(k) e^{-iωt} + conj(h0(-k)) e^{+iωt}, so the h0(k) component travels toward +k.
// h0(k) = (ξr + i ξi) · ½ · sqrt(S(k)) · Δk, ξ ~ N(0, 1): Var η = Σ_k S(k) Δk² = Hs²/16.
import { mulberry32 } from '../shared.js';
import { SEA, SITE } from '../config.js';

export const GRAVITY = 9.81;
export const WATER_DEPTH = SITE.waterDepthM;            // 22 m at the hero (SCENE-SPEC §3.1)
export const SURFACE_TENSION = 7.28e-5;                 // σ/ρ of sea water, m³/s² (capillary term)
export const EFFECTIVE_FETCH = 50000;                   // m, SCENE-SPEC §11.1 JONSWAP effective fetch
const PHYSICAL_FETCH = 375000;                          // m, open water toward 200.5° (SCENE-SPEC §11.1)
const FULL_FETCH_U10 = 30;                              // m/s: the sea has the whole physical fetch
const DEG = Math.PI / 180;

// ------------------------------------------------------------------ dispersion
export function omegaOf(k) {
  const kd = Math.min(k * WATER_DEPTH, 20);
  return Math.sqrt((GRAVITY * k + SURFACE_TENSION * k * k * k) * Math.tanh(kd));
}
export function dOmegaDk(k) {
  const kd = Math.min(k * WATER_DEPTH, 20);
  const th = Math.tanh(kd);
  const a = GRAVITY * k + SURFACE_TENSION * k * k * k;
  const w = Math.sqrt(a * th);
  const da = GRAVITY + 3 * SURFACE_TENSION * k * k;
  const dth = kd < 20 ? WATER_DEPTH * (1 - th * th) : 0;
  return (da * th + a * dth) / (2 * Math.max(w, 1e-9));
}
// ------------------------------------------------------------------ wind-sea growth law
// Tp from the fetch-limited JONSWAP law (ωp = 22 (g²/(U F))^(1/3)); Hs = min(fetch-limited
// JONSWAP, PM-shaped cap anchored so that U10 4.5 m/s gives the spec's 0.50 m). Below 4.5 m/s
// the sea scales like a fully developed PM sea (Hs ∝ U², Tp ∝ U) from the same anchor.
// The effective (duration-limited) fetch: the default light breeze has blown for a few hours
// (50 km); a stronger wind is taken to be a longer-lasting synoptic wind whose sea grows toward the
// whole physical fetch (ESTIMATED): Hs 2.3 m, Tp 7.5 s at 12 m/s (Beaufort 6, "large waves begin
// to form", ~3 m probable in the open sea, WMO); 5.1 m, 10.6 s at 20 m/s (Beaufort 8, 5.5 m).
export function effectiveFetch(u10) {
  const x = Math.min(1, Math.max(0, (u10 - SEA.windSpeed) / (FULL_FETCH_U10 - SEA.windSpeed)));
  return EFFECTIVE_FETCH + (PHYSICAL_FETCH - EFFECTIVE_FETCH) * x;
}
export function windSeaFromWind(u10) {
  const U = Math.max(0, u10);
  const tpJ = (u) => 2 * Math.PI / (22 * Math.cbrt(GRAVITY * GRAVITY / (Math.max(u, 0.05) * effectiveFetch(u))));
  const hsJ = (u) => 0.0016 * Math.sqrt(effectiveFetch(u) / GRAVITY) * u;
  const anchorU = SEA.windSpeed, anchorHs = SEA.windSea.Hs;       // 4.5 m/s -> 0.50 m
  const anchorTp = tpJ(anchorU);                                    // 3.79 s (spec 3.8)
  if (U < anchorU) return { Hs: anchorHs * (U / anchorU) ** 2, Tp: Math.max(anchorTp * U / anchorU, 0.25) };
  return { Hs: Math.min(hsJ(U), anchorHs * (U / anchorU) ** 2), Tp: tpJ(U) };
}

// ------------------------------------------------------------------ spectrum pieces
// Unnormalised spectral shapes (α g² = 1); the GLSL port in ocean-fft.js mirrors them exactly.
// Swell: JONSWAP (ω⁻⁵ tail). Wind sea: the same peak enhancement on the ω⁻⁴ equilibrium range
// observed above the peak (Toba 1973; Donelan, Hamilton & Hui 1985), which turns into the ω⁻⁵
// saturation range at ~3 ωp (Kahma & Calkoen 1992). With the JONSWAP ω⁻⁵ tail the 2-15 m waves
// carried half the slope the Elfouhaily et al. (1997) unified spectrum gives at 4.5 m/s
// (0.0028 against 0.0074), and those are the facets a drone camera resolves.
function peakShape(w, wp, gamma) {
  const sigma = w <= wp ? 0.07 : 0.09;
  return Math.pow(gamma, Math.exp(-((w - wp) ** 2) / (2 * sigma * sigma * wp * wp)));
}
export function jonswapShape(w, wp, gamma) {
  if (w <= 1e-4) return 0;
  const x = wp / w;
  return Math.pow(w, -5) * Math.exp(-1.25 * x * x * x * x) * peakShape(w, wp, gamma);
}
export function windSeaShape(w, wp, gamma) {
  if (w <= 1e-4) return 0;
  const x = wp / w, wt = 3 * wp;
  return (w <= wt ? Math.pow(w, -4) / wp : Math.pow(w, -5) * wt / wp) * Math.exp(-x * x * x * x) * peakShape(w, wp, gamma);
}
// Scale so that ∫ scale·shape dω = Hs²/16.
export function spectrumScale(Hs, wp, gamma, shape) {
  if (Hs <= 0 || wp <= 0) return 0;
  const n = 6000, w0 = 0.25 * wp, w1 = 40 * wp, lr = Math.log(w1 / w0);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const w = w0 * Math.exp(lr * (i + 0.5) / n);
    sum += shape(w, wp, gamma) * w * lr / n;      // dω = ω d(ln ω)
  }
  return (Hs * Hs / 16) / sum;
}
// Longuet-Higgins normalisation N(s) = Γ(s+1) / (2 √π Γ(s+½)), via the ratio approximation
// Γ(s+1)/Γ(s+½) ≈ sqrt(s + ¼ + 1/(32 s + 32)) (error < 0.3 % for s ≥ 0.5). Same formula in GLSL.
export function spreadNorm(s) {
  return Math.sqrt(s + 0.25 + 1 / (32 * s + 32)) / (2 * Math.sqrt(Math.PI));
}
// Above the peak the wind sea's short waves run in long crests along the wind, not in the broad
// cardioid (s = 1) the Mitsuyasu fall-off from the peak's s = 3 reached by 1.3 ωp: Donelan et al.
// (1985) measure s ≈ 10 at 1.2 ωp and ≈ 3.5 at 2 ωp (their sech² widths as cos^2s), and the 2-15 m
// waves at 1.2-3 ωp are the facets the drone camera resolves (the photo's dark lee faces run along
// crests across the frame). So above the peak the spreading eases to TAIL_SPREAD_S by 1.6 ωp and
// broadens again to s = 2 from 2.5 to 4 ωp (Donelan's ~1-2 there; few modes of a narrow far tail
// interfered into a diamond hatch in a strong wind's 2-15 m band).
export const TAIL_SPREAD_S = 5;
const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export function spreadS(w, wp, sPeak, broadens) {
  if (!broadens || w <= wp) return sPeak;
  return sPeak + (TAIL_SPREAD_S - sPeak) * sm(1, 1.6, w / wp) - (TAIL_SPREAD_S - 2) * sm(2.5, 4, w / wp);
}
// Short-wave damping at low wind. (1) Below ~3 m/s the wind no longer sustains capillary-gravity
// ripples (glassy sea). (2) Coastal summer water carries natural surfactant films that damp waves
// shorter than ~2 m until the wind breaks them up (6-8 m/s). ESTIMATED strength. 0.6 (the strength
// of the Cox-Munk slick fit, FILM_SLICK_REF) removed half the resolved 0.1-1.5 m slope energy
// and handed it back to the BRDF as blur (p1 ocean critique: the near field lost its ripple
// detail); 15 km offshore the films are patchy, so a quarter of that strength is used, and
// coxMunk() below moves the same quarter of the way from the clean to the slick fit, so the slope
// variance is removed consistently rather than moved into the unresolved blur.
export const FILM_DAMPING = 0.15;
export const FILM_SLICK_REF = 0.6;
export function lowWindRippleFactor(u10, k) {
  const onset = Math.min(1, Math.max(0, (u10 - 0.4) / 2.6));      // 0 at 0.4 m/s, 1 at 3 m/s
  const w = 1 - Math.exp(-((k / 4) ** 2));                          // waves shorter than ~1.5 m
  const x = Math.min(1, Math.max(0, (u10 - 4) / 4)), film = FILM_DAMPING * (1 - x * x * (3 - 2 * x));
  const wf = 1 - Math.exp(-((k / 3) ** 2));                         // waves shorter than ~2 m
  return (1 - w * (1 - onset * onset)) * (1 - film * wf);
}

// ------------------------------------------------------------------ sea state
// A resolved sea state: everything the spectrum needs as plain numbers (and GLSL uniforms).
export function resolveSeaState(st) {
  const ws = windSeaFromWind(st.windSpeed);
  const windToward = (st.windFromDeg + 180) * DEG;
  const swellToward = (st.swellFromDeg + 180) * DEG;
  const wpW = 2 * Math.PI / Math.max(ws.Tp, 0.2);
  const wpS = 2 * Math.PI / Math.max(st.swellPeriod, 0.5);
  const gW = SEA.windSea.gamma, gS = SEA.swell.gamma;
  return {
    windSpeed: st.windSpeed, windFromDeg: st.windFromDeg,
    swellHs: st.swellHs, swellFromDeg: st.swellFromDeg, swellPeriod: st.swellPeriod,
    windHs: ws.Hs, windTp: ws.Tp,
    // wind sea
    wW: wpW, gammaW: gW, scaleW: spectrumScale(ws.Hs, wpW, gW, windSeaShape), sW: SEA.windSea.spreadS,
    dirW: [Math.sin(windToward), -Math.cos(windToward)],
    // swell
    wS: wpS, gammaS: gS, scaleS: spectrumScale(st.swellHs, wpS, gS, jonswapShape), sS: SEA.swell.spreadS,
    dirS: [Math.sin(swellToward), -Math.cos(swellToward)],
  };
}

// Directional wavenumber spectrum S(kx, kz) in m⁴ (∫∫ S dkx dkz = m0).
export function spectrumK(kx, kz, R) {
  const k = Math.hypot(kx, kz);
  if (k < 1e-6) return 0;
  const w = omegaOf(k), dwdk = dOmegaDk(k);
  const jac = dwdk / k;                       // S(k) dkx dkz = S(ω) D(θ) dω dθ  ->  dω/dk / k
  const cx = kx / k, cz = kz / k;
  let S = 0;
  if (R.scaleW > 0) {
    const cosd = Math.max(-1, Math.min(1, cx * R.dirW[0] + cz * R.dirW[1]));
    const s = spreadS(w, R.wW, R.sW, true);
    const D = spreadNorm(s) * Math.pow(Math.max(0, 0.5 + 0.5 * cosd), s);   // cos^2s(θ/2) = ((1+cosθ)/2)^s
    S += R.scaleW * windSeaShape(w, R.wW, R.gammaW) * D * lowWindRippleFactor(R.windSpeed, k);
  }
  if (R.scaleS > 0) {
    const cosd = Math.max(-1, Math.min(1, cx * R.dirS[0] + cz * R.dirS[1]));
    const s = R.sS;
    const D = spreadNorm(s) * Math.pow(Math.max(0, 0.5 + 0.5 * cosd), s);
    S += R.scaleS * jonswapShape(w, R.wS, R.gammaS) * D;
  }
  return S * jac;
}

// ------------------------------------------------------------------ cascades
// Three FFT tiles. Each tile holds the modes whose |k| lies in its band, so nothing is counted
// twice. Band edges sit at ~6.4 texels per wavelength of the coarser tile, so every displaced
// component is sampled well enough for bilinear interpolation. The tiles are rotated against
// each other so their repeat lattices never line up.
export const FFT_SIZE = 256;
export const CASCADES = [
  { L: 600.0, rotDeg: 0,    kLow: 0,                   kHigh: 2 * Math.PI / 15.0 },   // swell + wind-sea peak, λ ≥ 15 m
  { L: 90.25, rotDeg: 31.7, kLow: 2 * Math.PI / 15.0,  kHigh: 2 * Math.PI / 2.25 },   // wind-sea tail, 15 m .. 2.25 m
  { L: 14.63, rotDeg: 63.1, kLow: 2 * Math.PI / 2.25,  kHigh: 1e9 },                  // short detail 2.25 m .. 0.114 m (normals)
];
export function cascadeFrame(c) {
  const a = c.rotDeg * DEG;
  return { cos: Math.cos(a), sin: Math.sin(a) };
}
// World wavevector of grid mode (nx, nz) of cascade c (grid axes rotated by rotDeg).
// Local coordinates: x' = cos·x + sin·z, z' = -sin·x + cos·z; k·x = k'·x'  =>  k = Rᵀ k'.
export function modeK(c, nx, nz) {
  const f = cascadeFrame(c), dk = 2 * Math.PI / c.L;
  const kxl = nx * dk, kzl = nz * dk;
  return [f.cos * kxl - f.sin * kzl, f.sin * kxl + f.cos * kzl];
}
export function inBand(c, k, nx, nz, N = FFT_SIZE) {
  if (nx === 0 && nz === 0) return false;
  if (nx === -N / 2 || nz === -N / 2) return false;   // Nyquist row/column has no Hermitian partner
  return k >= c.kLow && k < c.kHigh;
}

// Gaussian noise pairs (ξr, ξi) for every grid mode of every cascade. Texel (j, i) of cascade c
// holds the noise of mode (nx, nz) = (wrap(j), wrap(i)) with wrap(j) = j < N/2 ? j : j - N.
export function makeNoise(seed, N = FFT_SIZE, count = CASCADES.length) {
  const rnd = mulberry32(seed);
  const out = new Float32Array(N * N * count * 4);
  for (let i = 0; i < N * N * count; i++) {
    // Box-Muller, two independent pairs (the last pair is spare, kept for alignment)
    for (let p = 0; p < 2; p++) {
      const u1 = Math.max(rnd(), 1e-12), u2 = rnd();
      const r = Math.sqrt(-2 * Math.log(u1));
      out[i * 4 + p * 2] = r * Math.cos(2 * Math.PI * u2);
      out[i * 4 + p * 2 + 1] = r * Math.sin(2 * Math.PI * u2);
    }
  }
  return out;
}
export const wrapIndex = (j, N = FFT_SIZE) => (j < N / 2 ? j : j - N);
export const unwrapIndex = (n, N = FFT_SIZE) => (n >= 0 ? n : n + N);

// Complex initial amplitude h0 of mode (nx, nz) of cascade ci, or null if outside its band.
export function h0Of(ci, nx, nz, R, noise, N = FFT_SIZE) {
  const c = CASCADES[ci];
  const [kx, kz] = modeK(c, nx, nz);
  const k = Math.hypot(kx, kz);
  if (!inBand(c, k, nx, nz, N)) return null;
  const dk = 2 * Math.PI / c.L;
  const amp = 0.5 * Math.sqrt(spectrumK(kx, kz, R)) * dk;
  const t = ((ci * N + unwrapIndex(nz, N)) * N + unwrapIndex(nx, N)) * 4;
  return { kx, kz, k, w: omegaOf(k), re: noise[t] * amp, im: noise[t + 1] * amp };
}

// Cox & Munk (1954) mean-square slopes, upwind and crosswind. Below ~4 m/s coastal summer water
// carries natural surfactant films (the photo's glassy wavelets and slick patches); their share of
// the slick fit follows FILM_DAMPING, and the clean fit takes over as they break up by 8 m/s.
export function coxMunk(u10) {
  const U = Math.max(0, u10);
  const clean = { up: 3.16e-3 * U, cross: 0.003 + 1.92e-3 * U };
  const slick = { up: 0.005 + 0.78e-3 * U, cross: 0.003 + 0.84e-3 * U };
  const x = Math.min(1, Math.max(0, (U - 4) / 4)), f = x * x * (3 - 2 * x);
  const film = Math.min(1, FILM_DAMPING / FILM_SLICK_REF) * (1 - f);   // share of the slick fit
  return { up: clean.up + (slick.up - clean.up) * film, cross: clean.cross + (slick.cross - clean.cross) * film };
}

// Fast resolved mean-square slope per world axis for wavenumbers kMin ≤ |k| < kMax, from the
// continuous spectrum (1-D integral with the spreading function's second angular moment:
// for cos^2s(θ/2), E[cos 2θ] = s(s−1)/((s+1)(s+2))). Used at 10 Hz during sea-state easing.
export function resolvedSlopeMoments(R, kMin, kMax) {
  const n = 600, lr = Math.log(kMax / kMin);
  let aw = 0, cw = 0, as = 0, cs = 0;
  for (let i = 0; i < n; i++) {
    const k = kMin * Math.exp(lr * (i + 0.5) / n), dk = k * lr / n;
    const w = omegaOf(k), dwdk = dOmegaDk(k);
    if (R.scaleW > 0) {
      const m = k * k * R.scaleW * windSeaShape(w, R.wW, R.gammaW) * lowWindRippleFactor(R.windSpeed, k) * dwdk * dk;
      const s = spreadS(w, R.wW, R.sW, true), c2 = s * (s - 1) / ((s + 1) * (s + 2));
      aw += m * (1 + c2) / 2; cw += m * (1 - c2) / 2;
    }
    if (R.scaleS > 0) {
      const m = k * k * R.scaleS * jonswapShape(w, R.wS, R.gammaS) * dwdk * dk;
      const s = R.sS, c2 = s * (s - 1) / ((s + 1) * (s + 2));
      as += m * (1 + c2) / 2; cs += m * (1 - c2) / 2;
    }
  }
  const [wx, wz] = R.dirW, [sx, sz] = R.dirS;
  return [aw * wx * wx + cw * wz * wz + as * sx * sx + cs * sz * sz, aw * wz * wz + cw * wx * wx + as * sz * sz + cs * sx * sx];
}
