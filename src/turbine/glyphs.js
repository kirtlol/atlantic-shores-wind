// Turbine ID lettering (owner: modeller): the 25 characters the Atlantic Shores IDs use (row letters A-O,
// digits 0-9), drawn once in the platform's condensed bold sans (DIN Condensed on Apple systems, Bahnschrift
// on Windows, a condensed Roboto / DejaVu elsewhere) and turned into a signed-distance-field atlas, so the
// painted IDs stay sharp under magnification and fade to their true ink coverage at distance. A fallback
// face wider than DIN 1451 Engschrift is condensed to it, so a 3-character ID always spans <= 60 deg of
// the 10.5 m TP. The painted characters are RAL 9005 black, 3.0 m tall (SCENE-SPEC §4.2).
export const GLYPH_ORDER = 'ABCDEFGHIJKLMNO0123456789';
const FONT = '"DIN Condensed", "Bahnschrift Condensed", Bahnschrift, "Arial Narrow", "Roboto Condensed", "DejaVu Sans Condensed", sans-serif';
const DIGIT_ADVANCE = 0.59;            // Engschrift digit advance (cap-height units), the condensing target
const S0 = 96;                         // pixels per cap height in the atlas

// Font metrics, measured once: ctx (font set for a 96 px cap), sx (horizontal condensing), cap ascent px.
let FM = null;
function fontMetrics() {
  if (FM) return FM;
  const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  ctx.font = `bold 100px ${FONT}`;
  const px = 100 * S0 / ctx.measureText('H').actualBoundingBoxAscent;   // font size for a 96 px cap height
  ctx.font = `bold ${px}px ${FONT}`;
  const digits = [...'0123456789'].reduce((a, c) => a + ctx.measureText(c).width, 0) / 10 / S0;
  return (FM = { ctx, font: ctx.font, sx: Math.min(1, DIGIT_ADVANCE / digits) });
}
export function glyphAdvance(ch) { const { ctx, sx } = fontMetrics(); return ctx.measureText(ch).width * sx / S0; }
export function textWidth(str) { let w = 0; for (const c of str) w += glyphAdvance(c); return w; }

// Atlas geometry for given options (no rasterisation): the shader needs it as constants.
export function glyphAtlasLayout({ S = S0, margin = 0.2, spread = 0.12, cols = 5 } = {}) {
  const rows = Math.ceil(GLYPH_ORDER.length / cols), maxAdv = Math.max(...[...GLYPH_ORDER].map(glyphAdvance));
  const cellW = Math.ceil((maxAdv + 2 * margin) * S), cellH = Math.ceil((1 + 2 * margin) * S);
  return { S, margin, spread, cols, rows, cellW, cellH, width: cols * cellW, height: rows * cellH };
}

// Exact squared Euclidean distance transform along one line (Felzenszwalb & Huttenlocher 2012).
function edt1(f, n, d, v, z) {
  const cross = (q, r) => (f[q] + q * q - f[r] - r * r) / (2 * (q - r));   // where the parabolas of q and r meet
  let k = 0;
  v[0] = 0; z[0] = -1e30; z[1] = 1e30;
  for (let q = 1; q < n; q++) {
    let s = cross(q, v[k]);
    while (s <= z[k]) s = cross(q, v[--k]);
    v[++k] = q; z[k] = s; z[k + 1] = 1e30;
  }
  for (let q = 0, j = 0; q < n; q++) { while (z[j + 1] < q) j++; d[q] = (q - v[j]) ** 2 + f[v[j]]; }
}
// 2D squared EDT of a grid of initial squared distances (in place).
function edt2(g, w, h) {
  const n = Math.max(w, h), f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  for (let x = 0; x < w; x++) { for (let y = 0; y < h; y++) f[y] = g[y * w + x]; edt1(f, h, d, v, z); for (let y = 0; y < h; y++) g[y * w + x] = d[y]; }
  for (let y = 0; y < h; y++) { for (let x = 0; x < w; x++) f[x] = g[y * w + x]; edt1(f, w, d, v, z); for (let x = 0; x < w; x++) g[y * w + x] = d[x]; }
  return g;
}

/**
 * Rasterise the SDF atlas. Cells hold one glyph each (row 0 of the data = bottom, v up), laid out cols x rows.
 * Texel value: 0.5 on the glyph edge, 1 deep inside, 0 far outside (spread in cap units).
 * @returns {{ data: Uint8Array, width, height, advance: Float32Array, coverage: Float32Array }}
 */
export function buildGlyphAtlas(opts = {}) {
  const { S, margin, spread, cols, cellW, cellH, width, height } = glyphAtlasLayout(opts);
  const { ctx, sx } = fontMetrics(), n = GLYPH_ORDER.length;
  const data = new Uint8Array(width * height), advance = new Float32Array(n), coverage = new Float32Array(n);
  ctx.canvas.width = cellW; ctx.canvas.height = cellH;
  for (let gi = 0; gi < n; gi++) {
    const ch = GLYPH_ORDER[gi], adv = advance[gi] = glyphAdvance(ch);
    ctx.font = FM.font;                                    // a canvas resize resets the context state
    ctx.setTransform(sx, 0, 0, 1, margin * S, (1 + margin) * S);
    ctx.clearRect(-1e3, -1e3, 1e4, 1e4);
    ctx.fillText(ch, 0, 0);
    // Edge texels start at their sub-texel distance from the anti-aliased coverage (as in Mapbox's TinySDF),
    // so curves and diagonals stay smooth under magnification instead of stair-stepping.
    const a = ctx.getImageData(0, 0, cellW, cellH).data, N = cellW * cellH, out = new Float64Array(N), inn = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const c = a[4 * i + 3] / 255, e = 0.5 - c;
      out[i] = c === 1 ? 0 : c === 0 ? 1e20 : Math.max(0, e) ** 2;
      inn[i] = c === 0 ? 0 : c === 1 ? 1e20 : Math.max(0, -e) ** 2;
    }
    edt2(out, cellW, cellH); edt2(inn, cellW, cellH);
    const cx0 = (gi % cols) * cellW, cy0 = Math.floor(gi / cols) * cellH;
    let ink = 0, cnt = 0;
    for (let j = 0; j < cellH; j++) {
      const y = (cellH - 1 - j + 0.5) / S - margin;        // canvas rows run down, atlas rows up
      for (let i = 0; i < cellW; i++) {
        const k = j * cellW + i, d = (Math.sqrt(out[k]) - Math.sqrt(inn[k])) / S, x = (i + 0.5) / S - margin;
        data[(cy0 + cellH - 1 - j) * width + cx0 + i] = Math.round(Math.min(1, Math.max(0, 0.5 - d / (2 * spread))) * 255);
        if (x >= 0 && x <= adv && y >= 0 && y <= 1) { cnt++; ink += a[4 * k + 3] / 255; }
      }
    }
    coverage[gi] = ink / Math.max(1, cnt);
  }
  return { data, width, height, advance, coverage };
}
