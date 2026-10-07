// CPU mirror of the rendered sea surface (owner: ocean).
//
// The GPU displaces the mesh with cascades 0 and 1 (λ ≥ 2.25 m). This class sums the very same
// Fourier modes on the CPU (same Gaussian noise, same spectrum, same quantised ω), keeping the
// most energetic pairs until 99.5 % of that band's variance is represented. It evaluates height,
// slope and orbital velocity at any point and time, and inverts the choppy horizontal
// displacement so getHeight(x, z) is the height of the displaced surface above (x, z).
//
// Cost: one height evaluation is a single pass over ~3000 modes with separable phase tables
// (e^{i n kx x'} built by recurrence per tile), ≈10–20 µs in V8. Evolving the modes to a new time
// costs ~40-200 µs; the last EVOLVE_SLOTS evolved times are cached, so callers that sample a few
// times per frame (t, t + T/2, t + T for a ballistic fit) pay it once per time, not per call.
import {
  CASCADES, FFT_SIZE, h0Of, wrapIndex, cascadeFrame,
} from './spectrum.js';
import { quantizedOmega, TIME_REPEAT, CHOPPINESS } from './ocean-fft.js';

const MIRRORED_CASCADES = 2;        // cascades that displace the mesh (and so move floating bodies)
const KEEP_FRACTION = 0.995;        // variance fraction of the mirrored band kept
const MAX_PAIRS = 3600;
const CHOP_PAIRS = 400;             // pairs used for the (smooth) horizontal displacement inversion
const EVOLVE_SLOTS = 4;             // evolved time slots kept (LRU)

export class SurfaceMirror {
  // opts.keepFraction / opts.maxPairs override the defaults (used by the consistency tests).
  constructor(noise, opts = {}) {
    this.noise = noise;
    this.keepFraction = opts.keepFraction ?? KEEP_FRACTION;
    this.maxPairs = opts.maxPairs ?? MAX_PAIRS;
    this.R = null;
    this.M = 0;
    this.chop = CHOPPINESS;             // horizontal displacement scale, same as the GPU's uChop
    this._tCache = NaN;
  }

  // Rebuild the candidate list and amplitudes for a resolved sea state (spectrum.resolveSeaState).
  // reselect=false keeps the current pair set and only refreshes amplitudes (cheaper).
  setSeaState(R, reselect = true) {
    this.R = R;
    if (reselect || !this.cand) this._select(R);
    else this._refresh(R);
    this._tCache = NaN;
    for (const sl of this._slots || []) sl.t = NaN;
  }

  _select(R) {
    const N = FFT_SIZE, cands = [];
    let total = 0;
    for (let ci = 0; ci < MIRRORED_CASCADES; ci++) {
      for (let iz = 0; iz < N; iz++) for (let ix = 0; ix < N; ix++) {
        const nx = wrapIndex(ix, N), nz = wrapIndex(iz, N);
        if (!(nz > 0 || (nz === 0 && nx > 0))) continue;          // half plane: one entry per ±k pair
        const a = h0Of(ci, nx, nz, R, this.noise, N);
        if (!a) continue;
        const b = h0Of(ci, -nx, -nz, R, this.noise, N);
        const e = a.re * a.re + a.im * a.im + b.re * b.re + b.im * b.im;
        total += e;
        cands.push({ ci, nx, nz, e, a, b });
      }
    }
    cands.sort((p, q) => q.e - p.e);
    let cum = 0, M = 0;
    while (M < cands.length && M < this.maxPairs && cum < this.keepFraction * total) cum += cands[M++].e;
    this.cand = cands.slice(0, M);
    this.M = M;
    // Field variance of a pair set = 2 Σ e (both conjugate terms), see spectrum.js normalisation.
    // (dev builds only: the probes read it)
    if (globalThis.NJOW_DEV !== false) this.stats = { candidates: cands.length, kept: M, keptFraction: total > 0 ? cum / total : 1, omittedStd: Math.sqrt(Math.max(0, 2 * (total - cum))), bandStd: Math.sqrt(2 * total) };
    this._pack();
  }

  _refresh(R) {
    for (const c of this.cand) {
      c.a = h0Of(c.ci, c.nx, c.nz, R, this.noise) || c.a;
      c.b = h0Of(c.ci, -c.nx, -c.nz, R, this.noise) || c.b;
    }
    this._pack();
  }

  _pack() {
    const M = this.M;
    this.ci = new Uint8Array(M);
    this.ix = new Int16Array(M); this.iz = new Int16Array(M);
    this.w = new Float64Array(M);
    this.ar = new Float64Array(M); this.ai = new Float64Array(M);
    this.br = new Float64Array(M); this.bi = new Float64Array(M);
    this.kx = new Float64Array(M); this.kz = new Float64Array(M); this.kinv = new Float64Array(M);
    this._slots = Array.from({ length: EVOLVE_SLOTS }, () => ({ t: NaN, used: 0, Hr: new Float64Array(M), Hi: new Float64Array(M), Vr: new Float64Array(M), Vi: new Float64Array(M) }));
    this._use = 0;
    this._bind(this._slots[0]);
    this.nt = [0, 0];
    for (let i = 0; i < M; i++) {
      const c = this.cand[i];
      this.ci[i] = c.ci; this.ix[i] = c.nx; this.iz[i] = c.nz;
      this.nt[c.ci] = Math.max(this.nt[c.ci], Math.abs(c.nx), Math.abs(c.nz));
      this.w[i] = quantizedOmega(c.a.k);
      this.ar[i] = c.a.re; this.ai[i] = c.a.im; this.br[i] = c.b.re; this.bi[i] = c.b.im;
      this.kx[i] = c.a.kx; this.kz[i] = c.a.kz; this.kinv[i] = 1 / c.a.k;
    }
    // phase tables: per cascade, n in [-nt, nt], interleaved re/im, for x' and z', all cascades in
    // one flat array per axis; each pair stores its absolute table offsets (no lookups in the loop)
    this.tab = [];
    let off = 0;
    for (let c = 0; c < MIRRORED_CASCADES; c++) { this.tab.push({ nt: this.nt[c], off }); off += (2 * this.nt[c] + 1) * 2; }
    this.TX = new Float64Array(off); this.TZ = new Float64Array(off);
    this.jx = new Int32Array(M); this.jz = new Int32Array(M);
    for (let i = 0; i < M; i++) {
      const T = this.tab[this.ci[i]];
      this.jx[i] = T.off + (this.ix[i] + T.nt) * 2; this.jz[i] = T.off + (this.iz[i] + T.nt) * 2;
    }
    this.frames = CASCADES.slice(0, MIRRORED_CASCADES).map((c) => ({ ...cascadeFrame(c), L: c.L }));
    this._tCache = NaN;
  }

  _bind(slot) { this.Hr = slot.Hr; this.Hi = slot.Hi; this.Vr = slot.Vr; this.Vi = slot.Vi; this._tCache = slot.t; }

  // Time-evolved complex amplitudes H(k, t) and ∂H/∂t for every kept pair (LRU cache of times).
  _evolve(t) {
    if (t === this._tCache) return;
    const slots = this._slots;
    let hit = null, lru = slots[0];
    for (const sl of slots) { if (sl.t === t) { hit = sl; break; } if (sl.used < lru.used) lru = sl; }
    if (hit) { hit.used = ++this._use; this._bind(hit); return; }
    lru.t = t; lru.used = ++this._use;
    this._bind(lru);
    const tm = ((t % TIME_REPEAT) + TIME_REPEAT) % TIME_REPEAT;
    const { M, w, ar, ai, br, bi, Hr, Hi, Vr, Vi } = this;
    for (let i = 0; i < M; i++) {
      const ph = w[i] * tm, cs = Math.cos(ph), sn = Math.sin(ph);
      const Ar = ar[i] * cs + ai[i] * sn, Ai = ai[i] * cs - ar[i] * sn;   // h0 e^{-iφ}
      const Br = br[i] * cs + bi[i] * sn, Bi = br[i] * sn - bi[i] * cs;   // conj(h0(-k)) e^{+iφ}
      Hr[i] = Ar + Br; Hi[i] = Ai + Bi;
      // ∂H/∂t = ω i (B - A)
      Vr[i] = -w[i] * (Bi - Ai); Vi[i] = w[i] * (Br - Ar);
    }
  }

  _tables(x, z) {
    for (let c = 0; c < MIRRORED_CASCADES; c++) {
      const f = this.frames[c], T = this.tab[c];
      const xl = f.cos * x + f.sin * z, zl = -f.sin * x + f.cos * z;
      const ax = 2 * Math.PI * xl / f.L, az = 2 * Math.PI * zl / f.L;
      fillTable(this.TX, T.off, T.nt, Math.cos(ax), Math.sin(ax));
      fillTable(this.TZ, T.off, T.nt, Math.cos(az), Math.sin(az));
    }
  }

  // Horizontal displacement (Dx, Dz) at Lagrangian point (x, z), from the strongest pairs only:
  // D = +i (k/|k|) H, toward the crests (the GPU's convention, ocean-fft.js).
  _displacement(x, z, out) {
    this._tables(x, z);
    const n = Math.min(this.M, CHOP_PAIRS);
    const { TX, TZ, jx, jz, Hr, Hi, kx, kz, kinv } = this;
    let dx = 0, dz = 0;
    for (let i = 0; i < n; i++) {
      const a = jx[i], b = jz[i];
      const pr = TX[a] * TZ[b] - TX[a + 1] * TZ[b + 1];
      const pi = TX[a] * TZ[b + 1] + TX[a + 1] * TZ[b];
      const d = (Hi[i] * pr + Hr[i] * pi) * kinv[i];                // Re(−i H P) / |k| = −Re(i H P) / |k|
      dx += kx[i] * d; dz += kz[i] * d;
    }
    out[0] = -2 * this.chop * dx; out[1] = -2 * this.chop * dz;
    return out;
  }

  // Lagrangian point whose displaced position is (x, z): two fixed-point steps.
  _invert(x, z, out) {
    this._displacement(x, z, out);
    const qx = x - out[0], qz = z - out[1];
    this._displacement(qx, qz, out);
    out[0] = x - out[0]; out[1] = z - out[1];
    return out;
  }

  // Wave elevation (no curvature) of the displaced surface above world (x, z) at time t.
  height(x, z, t) {
    if (!this.M) return 0;
    this._evolve(t);
    const q = this._invert(x, z, this._q || (this._q = [0, 0]));
    this._tables(q[0], q[1]);
    let h = 0;
    const { M, TX, TZ, jx, jz, Hr, Hi } = this;
    for (let i = 0; i < M; i++) {
      const a = jx[i], b = jz[i];
      h += Hr[i] * (TX[a] * TZ[b] - TX[a + 1] * TZ[b + 1]) - Hi[i] * (TX[a] * TZ[b + 1] + TX[a + 1] * TZ[b]);
    }
    return 2 * h;
  }

  // Elevation, slopes (∂η/∂x, ∂η/∂z) and orbital velocity at world (x, z), time t.
  surface(x, z, t, out) {
    out.eta = 0; out.sx = 0; out.sz = 0; out.vx = 0; out.vy = 0; out.vz = 0;
    if (!this.M) return out;
    this._evolve(t);
    const q = this._invert(x, z, this._q || (this._q = [0, 0]));
    this._tables(q[0], q[1]);
    let h = 0, sx = 0, sz = 0, vx = 0, vy = 0, vz = 0;
    const { M, TX, TZ, jx, jz, Hr, Hi, Vr, Vi, kx, kz, kinv } = this;
    for (let i = 0; i < M; i++) {
      const a = jx[i], b = jz[i];
      const pr = TX[a] * TZ[b] - TX[a + 1] * TZ[b + 1];
      const pi = TX[a] * TZ[b + 1] + TX[a + 1] * TZ[b];
      h += Hr[i] * pr - Hi[i] * pi;
      const s = -Hi[i] * pr - Hr[i] * pi;                // Re(i H P)
      sx += kx[i] * s; sz += kz[i] * s;
      vy += Vr[i] * pr - Vi[i] * pi;                    // Re(∂H/∂t P)
      const dv = (Vi[i] * pr + Vr[i] * pi) * kinv[i];   // −Re(i ∂H/∂t P) / |k|
      vx += kx[i] * dv; vz += kz[i] * dv;
    }
    out.eta = 2 * h; out.sx = 2 * sx; out.sz = 2 * sz;
    out.vx = -2 * this.chop * vx; out.vy = 2 * vy; out.vz = -2 * this.chop * vz;
    return out;
  }
}

function fillTable(tab, base, nt, c, s) {
  // tab[base + (n + nt) * 2] = cos(n a), [.. + 1] = sin(n a), n in [-nt, nt]
  const o = base + nt * 2;
  tab[o] = 1; tab[o + 1] = 0;
  let r = 1, i = 0;
  for (let n = 1; n <= nt; n++) {
    const nr = r * c - i * s, ni = r * s + i * c;
    r = nr; i = ni;
    tab[o + n * 2] = r; tab[o + n * 2 + 1] = i;
    tab[o - n * 2] = r; tab[o - n * 2 + 1] = -i;
  }
}
