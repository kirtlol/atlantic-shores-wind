// DEV ONLY (ocean dev page): GPU readback of the rendered displacement, for the CPU-vs-GPU height
// consistency check. For each probe point q (Lagrangian, snap frame) it samples the two geometry
// cascades exactly as the ocean vertex shader does at full detail (LOD 0, bilinear), returning
// (Dx, η, Dz). The CPU mirror is then asked for the height above the displaced point q + D.
import * as THREE from 'three';
import { CASCADES } from '../../src/ocean/spectrum.js';

export function gpuHeightProbe(ocean, points) {
  const renderer = ocean.renderer;
  const n = points.length;
  const W = 64, H = Math.ceil(n / W);
  const data = new Float32Array(W * H * 4);
  points.forEach((p, i) => { data[i * 4] = p.x - ocean.snap.x; data[i * 4 + 1] = p.z - ocean.snap.y; });
  const pts = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.FloatType);
  pts.needsUpdate = true;
  const rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.FloatType, depthBuffer: false });
  const u = ocean.uniforms;
  const mat = new THREE.ShaderMaterial({
    uniforms: { uPts: { value: pts }, uDisp0: u.uDisp0, uDisp1: u.uDisp1, uOcCas: u.uOcCas, uOcOff: u.uOcOff },
    vertexShader: 'void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: /* glsl */`
uniform sampler2D uPts, uDisp0, uDisp1;
uniform vec4 uOcCas[${ocean.fft.count}];
uniform vec2 uOcOff[${ocean.fft.count}];
vec2 uvOf(int c, vec2 q) { vec4 a = uOcCas[c]; return vec2(a.x * q.x + a.y * q.y, -a.y * q.x + a.x * q.y) * a.z + uOcOff[c]; }
void main() {
  vec2 q = texelFetch(uPts, ivec2(gl_FragCoord.xy), 0).xy;
  vec3 d = textureLod(uDisp0, uvOf(0, q), 0.0).xyz + textureLod(uDisp1, uvOf(1, q), 0.0).xyz;
  gl_FragColor = vec4(d, 1.0);
}`,
  });
  const tri = new THREE.BufferGeometry();
  tri.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  const mesh = new THREE.Mesh(tri, mat); mesh.frustumCulled = false;
  const scene = new THREE.Scene(); scene.add(mesh);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(rt); renderer.render(scene, cam); renderer.setRenderTarget(prev);
  const out = new Float32Array(W * H * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, W, H, out);
  rt.dispose(); mat.dispose(); tri.dispose(); pts.dispose();
  return points.map((p, i) => ({ dx: out[i * 4], eta: out[i * 4 + 1], dz: out[i * 4 + 2] }));
}

// Compare: GPU η at Lagrangian q vs CPU mirror height above the displaced point (q + D).
export function consistencyCheck(ocean, t, count = 256, radius = 600, cx = 0, cz = 0) {
  const pts = [];
  for (let i = 0; i < count; i++) {
    const a = i * 2.39996, r = radius * Math.sqrt((i + 0.5) / count);
    pts.push({ x: cx + r * Math.cos(a), z: cz + r * Math.sin(a) });
  }
  const g = gpuHeightProbe(ocean, pts);
  let s2 = 0, mx = 0, sEta2 = 0;
  const diffs = [];
  pts.forEach((p, i) => {
    const X = p.x + g[i].dx, Z = p.z + g[i].dz;
    const cpu = ocean.surfaceMirror.height(X, Z, t);
    const d = cpu - g[i].eta;
    s2 += d * d; mx = Math.max(mx, Math.abs(d)); sEta2 += g[i].eta ** 2;
    diffs.push(d);
  });
  return { points: count, rmsError: Math.sqrt(s2 / count), maxError: mx, gpuEtaStd: Math.sqrt(sEta2 / count), mirror: ocean.surfaceMirror.stats, cascades: CASCADES.length };
}

// Field-only check: GPU η at Lagrangian q vs the CPU mirror's η at the same q (no inversion).
export function lagrangianCheck(ocean, t, count = 256, radius = 400, cx = 0, cz = 0) {
  const pts = [];
  for (let i = 0; i < count; i++) { const a = i * 2.39996, r = radius * Math.sqrt((i + 0.5) / count); pts.push({ x: cx + r * Math.cos(a), z: cz + r * Math.sin(a) }); }
  const g = gpuHeightProbe(ocean, pts);
  const m = ocean.surfaceMirror;
  m._evolve(t);
  let s2 = 0, mx = 0, sd2 = 0;
  pts.forEach((p, i) => {
    m._tables(p.x, p.z);
    let h = 0;
    for (let j = 0; j < m.M; j++) { const a = m.jx[j], b = m.jz[j]; const pr = m.TX[a] * m.TZ[b] - m.TX[a + 1] * m.TZ[b + 1], pim = m.TX[a] * m.TZ[b + 1] + m.TX[a + 1] * m.TZ[b]; h += m.Hr[j] * pr - m.Hi[j] * pim; }
    const d = 2 * h - g[i].eta; s2 += d * d; mx = Math.max(mx, Math.abs(d));
    const dd = m._displacement(p.x, p.z, [0, 0]); sd2 += (dd[0] - g[i].dx) ** 2 + (dd[1] - g[i].dz) ** 2;
  });
  return { etaRms: Math.sqrt(s2 / count), etaMax: mx, dispRms: Math.sqrt(sd2 / count) };
}
