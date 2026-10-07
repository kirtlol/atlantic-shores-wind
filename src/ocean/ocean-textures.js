// Procedural textures and lookup tables for the ocean (owner: ocean). Everything is generated at
// start-up from mulberry32 seeds; nothing is fetched.
//   foamTexture()        tileable detail: R bubbles/cells (fine), G bubbles (coarse), both
//                        equalised to uniform [0, 1]; B wind-streak noise; A slicks / cat's-paws, a
//                        low-frequency field meant to be tiled at SLICK_TILE_M
//   SkyReflectionMap     skyRadiance() over the upper hemisphere, seen from the sea, in a
//                        horizon-concentrated 512×256 panorama with mips (reflection lookups);
//                        alpha: the light's degree of linear polarization
import * as THREE from 'three';
import { mulberry32 } from '../shared.js';
import { SEA } from '../config.js';

// ------------------------------------------------------------------ tileable noise helpers
function periodicValueNoise(size, cells, rnd) {
  const lat = new Float32Array(cells * cells);
  for (let i = 0; i < lat.length; i++) lat[i] = rnd();
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const fx = x / size * cells, fy = y / size * cells;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const a = lat[(y0 % cells) * cells + (x0 % cells)], b = lat[(y0 % cells) * cells + ((x0 + 1) % cells)];
    const c = lat[((y0 + 1) % cells) * cells + (x0 % cells)], d = lat[((y0 + 1) % cells) * cells + ((x0 + 1) % cells)];
    out[y * size + x] = (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy;
  }
  return out;
}
function periodicFbm(size, baseCells, octaves, rnd, gain = 0.5) {
  const out = new Float32Array(size * size);
  let amp = 1, norm = 0, cells = baseCells;
  for (let o = 0; o < octaves; o++) {
    const n = periodicValueNoise(size, cells, rnd);
    for (let i = 0; i < out.length; i++) out[i] += n[i] * amp;
    norm += amp; amp *= gain; cells *= 2;
  }
  for (let i = 0; i < out.length; i++) out[i] /= norm;
  return out;
}
// Worley F1/F2 on a periodic jittered grid; returns { f1, f2 } in cell units.
function periodicWorley(size, cells, rnd) {
  const px = new Float32Array(cells * cells), py = new Float32Array(cells * cells);
  for (let i = 0; i < cells * cells; i++) { px[i] = rnd(); py[i] = rnd(); }
  const f1 = new Float32Array(size * size), f2 = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const fx = x / size * cells, fy = y / size * cells;
    const cx = Math.floor(fx), cy = Math.floor(fy);
    let d1 = 9, d2 = 9;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const gx = cx + i, gy = cy + j;
      const k = (((gy % cells) + cells) % cells) * cells + (((gx % cells) + cells) % cells);
      const dx = gx + px[k] - fx, dy = gy + py[k] - fy;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
    }
    f1[y * size + x] = d1; f2[y * size + x] = d2;
  }
  return { f1, f2 };
}

// Rank transform to a uniform distribution (ties broken by index, so the result is deterministic).
function equalise(a) {
  const idx = Array.from(a.keys()).sort((i, j) => a[i] - a[j] || i - j);
  const out = new Float32Array(a.length);
  for (let r = 0; r < idx.length; r++) out[idx[r]] = (r + 0.5) / idx.length;
  return out;
}

// One slick-field tile spans this many metres (SEA.slicks: ±12 % roughness in 50-170 m patches).
export const SLICK_TILE_M = 1400;

// ------------------------------------------------------------------ foam detail
// Real sea foam is a froth of bubbles bounded by bright films. The channels hold the distance to
// the nearest cell centre (Worley F1, highest on the cell walls): thresholding it at 1 − density
// leaves a connected network of thin walls when the foam is sparse and ever smaller round holes
// as it thickens, which is how decaying foam lace looks. R: fine cells, G: coarse rafts.
export function foamTexture(seed = 7771) {
  const S = 256, rnd = mulberry32(seed);
  const fine = periodicWorley(S, 48, rnd);
  const fine2 = periodicWorley(S, 92, rnd);            // second cell size: holes of mixed sizes
  const coarse = periodicWorley(S, 12, rnd);
  const fb = periodicFbm(S, 4, 5, rnd);
  const streak = periodicFbm(S, 8, 4, rnd);
  // slick field: patches of SEA.slicks.patchSize (50-170 m) when one tile spans SLICK_TILE_M
  const slickCells = Math.round(SLICK_TILE_M / ((SEA.slicks.patchSize[0] + SEA.slicks.patchSize[1]) * 0.5 * 1.6));
  const slick = periodicFbm(S, slickCells, 4, rnd, 0.55);
  const data = new Uint8Array(S * S * 4);
  const walls = (f1) => { const x = Math.min(1, Math.max(0, (f1 - 0.05) / 0.7)); return x * x * (3 - 2 * x); };
  const R = new Float32Array(S * S), G = new Float32Array(S * S);
  for (let i = 0; i < S * S; i++) {
    R[i] = 0.55 * walls(fine.f1[i]) + 0.35 * walls(fine2.f1[i] * 0.9) + 0.15 * fb[i];
    G[i] = 0.8 * walls(coarse.f1[i]) + 0.2 * fb[i];
  }
  // R and G are histogram-equalised to a uniform distribution on [0, 1]: thresholding one at
  // 1 − ρ then covers exactly the fraction ρ at any distance, and its mip levels average to 0.5,
  // so the ocean's lace coverage stays unbiased from 5 m (resolved bubbles) to 2 km (mean density).
  const Re = equalise(R), Ge = equalise(G);
  for (let i = 0; i < S * S; i++) {
    data[i * 4] = Math.round(255 * Re[i]);
    data[i * 4 + 1] = Math.round(255 * Ge[i]);
    data[i * 4 + 2] = Math.round(255 * streak[i]);
    data[i * 4 + 3] = Math.round(255 * slick[i]);
  }
  const tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true; tex.anisotropy = 4;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

// ------------------------------------------------------------------ sky reflection panorama
// The sea reflects the sky along every pixel's reflected ray. Evaluating the atmosphere's full
// skyRadiance() (sky-view LUT + cloud march + cirrus) per ocean pixel is the single biggest cost
// of the surface, so it is evaluated once per texel of a camera-centred panorama instead, every
// frame, and sampled with a mip level set by the surface roughness (a rough sea reflects a
// blurred sky). Mapping: u = azimuth / 2π (compass, clockwise from north), v = sqrt(el / 90°),
// which puts half the rows in the lowest 22.5° where grazing reflections need the resolution.
const SKY_MAP_W = 512, SKY_MAP_H = 256;
export const SKY_MAP_GLSL = /* glsl */`
vec2 ocSkyMapUv(vec3 d) {
  float az = atan(d.x, -d.z);
  float el = asin(clamp(d.y, 0.0, 1.0));
  return vec2(az * ${(1 / (2 * Math.PI)).toFixed(10)} + 0.5, sqrt(el * ${(2 / Math.PI).toFixed(10)}));
}`;
export class SkyReflectionMap {
  constructor(renderer, atmosphere) {
    this.renderer = renderer;
    this.target = new THREE.WebGLRenderTarget(SKY_MAP_W, SKY_MAP_H, {
      type: THREE.HalfFloatType, depthBuffer: false, generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
      wrapS: THREE.RepeatWrapping, wrapT: THREE.ClampToEdgeWrapping,
    });
    this.target.texture.name = 'ocean.skyReflection';
    this.every = 2;
    this.target.texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());   // three quadrature nodes already span the elevation spread
    this.material = new THREE.ShaderMaterial({
      uniforms: { ...atmosphere.uniforms },
      vertexShader: /* glsl */`varying vec2 vUv; void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      // stored pre-exposed, like the atmosphere's own half-float targets. Alpha: the degree of linear
      // polarization of the light from dir (the clear sky's, from the sky-view LUT, diluted by what
      // clouds add: they depolarize); the sea's reflection through the camera polarizer needs it.
      fragmentShader: atmosphere.glsl + /* glsl */`
#define OC_PRE ${/uniform\s+float\s+uAtmPre\b/.test(atmosphere.glsl) ? 'uAtmPre' : '1.0'}
varying vec2 vUv;
void main() {
  float az = (vUv.x - 0.5) * ${(2 * Math.PI).toFixed(10)};
  float el = vUv.y * vUv.y * ${(Math.PI / 2).toFixed(10)};
  vec3 dir = vec3(sin(az) * cos(el), sin(el), -cos(az) * cos(el));
  vec3 L = skyRadiance(dir);
  float P = 0.0;
${/vec4\s+atmSkyLUTSample\s*\(/.test(atmosphere.glsl) ? `  vec4 clear = atmSkyLUTSample(dir);
  float lc = dot(clear.rgb, vec3(0.2126, 0.7152, 0.0722)), l = dot(L, vec3(0.2126, 0.7152, 0.0722));
  P = clamp(clear.a * lc / max(l, 1e-30), 0.0, clear.a);` : ''}
  gl_FragColor = vec4(L * OC_PRE, P);
}`,
      depthTest: false, depthWrite: false,
    });
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.mesh = new THREE.Mesh(tri, this.material);
    this.mesh.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.mesh);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }
  get texture() { return this.target.texture; }
  // Resolution and refresh interval (frames) per quality tier: 512 x 256 every 2nd frame on
  // High/Ultra, 256 x 128 every 4th on Low (phones: fixed passes dominate there).
  setQuality(low) {
    const w = low ? SKY_MAP_W / 2 : SKY_MAP_W, h = low ? SKY_MAP_H / 2 : SKY_MAP_H;
    if (this.target.width !== w) { this.target.setSize(w, h); this._pos = null; }
    this.every = low ? 4 : 2;
  }
  // The sea reflects the sky seen from the sea surface, not from the camera: skyRadiance() depends
  // on its observer (cloud parallax, the layer is 1.1-1.4 km up), so the panorama is rendered from
  // 2 m above the sea under the camera, or, for cameras above 300 m, under the point the view
  // looks at (at most 3 km ahead), which places the cloud reflections the viewer sees. Refreshed
  // every second frame (clouds drift ~0.01° per frame at 1100 m), at once when that point moves
  // more than 25 m or on a time jump.
  update(camera, t) {
    const p = this._obs || (this._obs = new THREE.Vector3()), f = this._f || (this._f = new THREE.Vector3());
    p.set(camera.position.x, 2, camera.position.z);
    if (camera.position.y > 300) {
      camera.getWorldDirection(f);
      const h = camera.position.y, horiz = Math.hypot(f.x, f.z);
      if (horiz > 1e-4) {
        const d = f.y < -1e-3 ? Math.min(h * horiz / -f.y, 3000) : 3000;
        p.x += f.x / horiz * d; p.z += f.z / horiz * d;
      }
    }
    const moved = !this._pos || this._pos.distanceToSquared(p) > 625 || Math.abs(t - this._t) > 0.5;
    this._frame = (this._frame || 0) + 1;
    if (!moved && this._frame % this.every !== 0) return;
    this._pos = (this._pos || new THREE.Vector3()).copy(p);
    this._t = t;
    const r = this.renderer;
    const prev = r.getRenderTarget(), prevAuto = r.autoClear;
    this.camera.position.copy(p);
    this.camera.updateMatrixWorld();
    r.autoClear = false;
    r.setRenderTarget(this.target);
    r.render(this.scene, this.camera);
    r.setRenderTarget(prev);
    r.autoClear = prevAuto;
  }
  dispose() { this.target.dispose(); this.material.dispose(); this.mesh.geometry.dispose(); }
}
