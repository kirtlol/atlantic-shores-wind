// Planar reflection of LAYER_REFLECT objects for the ocean (owner: ocean).
//
// A mirror camera (Reflector.js math, research/three-r180-api.md §10) renders only the reflect
// layer into a HalfFloat target cleared to alpha 0, so alpha marks coverage and the analytic sky
// shows through everywhere else. An oblique near plane clips everything below the mirror plane.
// The depth is kept (logarithmic depth -> view distance): the ocean shader spreads each reflection
// along the mirror vertical by the facet-slope distribution, scaled by the parallax of the
// reflected object, so streaks are short at a pile's base and long for distant structures, as on
// a real rough sea.
//
// The colour the ocean samples is a log-compressed, mip-mapped copy of the render:
//   c = log2(1 + min(L, CLAMP · L0) / L0)        decoded as L = L0 · (2^c − 1)
// and beside it (second attachment, same mips) the distance: (coverage · 1000 / w, coverage), w = the
// mirror camera's view distance, so any footprint gives the coverage-weighted harmonic mean distance of
// what it holds, 1000 · g / r (the ocean drops what stands nearer than the water it reflects in).
// L0 is a fixed number of EXPOSED units (post exposure and atmosphere pre-exposure divided out),
// so the code is linear for ordinary reflected surfaces (towers, TPs, hulls) and logarithmic for
// lamp cores. Mip levels then average in the log domain: a 1.5 px lamp no longer floods a whole
// mip block (the red wash between lamp columns and the rectangular blocks at night), while the
// full-resolution level still decodes the lamp exactly for the sharp glint tap.
import * as THREE from 'three';
import { LAYER_REFLECT } from '../shared.js';

export const MIRROR_L0_EXPOSED = 4.0;       // linear below ~4 exposed units (a lit white tower is ~6)
export const MIRROR_CLAMP_EXPOSED = 1024.0; // lamp cores clamp here (the log code keeps them out of the mips)

const COMPRESS_VS = /* glsl */`
varying vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const COMPRESS_FS = /* glsl */`
layout(location = 0) out vec4 oCol;
layout(location = 1) out vec4 oDist;
uniform sampler2D uSrc;
uniform sampler2D uDepth;
uniform float uL0;
uniform float uClamp;
uniform float uLogFar;   // log2(far + 1) of the mirror camera (0: not a logarithmic depth)
uniform vec4 uZ;         // reversed-Z: row 2 of the mirror's oblique projection (else 0)
uniform vec4 uXY;        // reversed-Z: (te0, te5, te8, te9) of the same projection
varying vec2 vUv;
void main() {
  vec4 c = texture(uSrc, vUv);
  vec3 L = clamp(c.rgb, vec3(0.0), vec3(uClamp * uL0));
  float a = clamp(c.a, 0.0, 1.0), d = texture(uDepth, vUv).r, w = 1e9;
  if (uLogFar > 0.0) { if (d < 0.999999) w = exp2(d * uLogFar) - 1.0; }
  else if (uZ.w != 0.0 && d > 1e-7) { vec2 xy = (vUv * 2.0 - 1.0 + uXY.zw) / uXY.xy; w = uZ.w / max(d - uZ.x * xy.x - uZ.y * xy.y + uZ.z, 1e-9); }
  oCol = vec4(log2(1.0 + L / uL0), a);
  oDist = vec4(a * 1000.0 / max(w, 1.0), a, 0.0, 1.0);
}`;

export class PlanarReflection {
  constructor(renderer, { scale = 0.5, samples = 2 } = {}) {
    this.renderer = renderer;
    this.scale = scale;
    this.samples = samples;
    this.enabled = scale > 0;
    this.camera = new THREE.PerspectiveCamera();
    this.camera.layers.set(LAYER_REFLECT);
    this.camera.matrixAutoUpdate = true;
    this._makeTargets(4, 4);
    // log2(far + 1): inverts three's logarithmic depth (gl_FragDepth = log2(1 + w) / log2(far + 1));
    // 0 when the renderer does not use a logarithmic depth buffer. Under reversed-Z the depth is
    // inverted through the oblique projection instead: depthRow = its row 2 (te2, te6, te10, te14),
    // xyRow = (te0, te5, te8, te9); w = te14 / (d − te2·X − te6·Y + te10), X, Y = ray slopes.
    this.logFar = 0;
    this.l0 = 1;                 // current decode scale (pre-exposed radiance units)
    // world -> projective texture coordinates of the mirror view (Water.js convention)
    this.textureMatrix = new THREE.Matrix4();
    // mirror camera basis (world right / up / forward) and projection scales for the shader
    this.basis = new THREE.Matrix3();
    this.proj = new THREE.Vector2(1, 1);
    this.planeY = 0;
    this._v = new THREE.Vector3(); this._t = new THREE.Vector3(); this._n = new THREE.Vector3(0, 1, 0);
    this._p = new THREE.Plane(); this._c = new THREE.Vector4(); this._q = new THREE.Vector4();
    this._rot = new THREE.Matrix4(); this._look = new THREE.Vector3(); this._size = new THREE.Vector2();
    this._clear = new THREE.Color(); this._view = new THREE.Vector3(); this._tgt = new THREE.Vector3();
    // compression pass
    this._cmat = new THREE.ShaderMaterial({
      uniforms: { uSrc: { value: null }, uDepth: { value: null }, uL0: { value: 1 }, uClamp: { value: MIRROR_CLAMP_EXPOSED }, uLogFar: { value: 0 }, uZ: { value: new THREE.Vector4() }, uXY: { value: new THREE.Vector4() } },
      vertexShader: COMPRESS_VS, fragmentShader: COMPRESS_FS, depthTest: false, depthWrite: false, glslVersion: THREE.GLSL3,
    });
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this._cmesh = new THREE.Mesh(tri, this._cmat);
    this._cmesh.frustumCulled = false;
    this._cscene = new THREE.Scene();
    this._cscene.add(this._cmesh);
    this._ccam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  // raw: the MSAA render with its depth; target: the compressed, mip-mapped colour the ocean reads
  _makeTargets(w, h) {
    this.raw = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType, samples: this.samples, generateMipmaps: false,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      // reversed-Z keeps its precision only in a float depth buffer
      depthTexture: new THREE.DepthTexture(w, h, this.renderer.capabilities.reversedDepthBuffer ? THREE.FloatType : THREE.UnsignedIntType),
    });
    this.raw.texture.name = 'ocean.mirror.raw';
    this.raw.depthTexture.name = 'ocean.mirror.depth';
    this.target = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType, depthBuffer: false, generateMipmaps: true, count: 2,
      minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
    });
    // elongated footprints (thin across, tap-long along the mirror vertical): let the hardware
    // filter them anisotropically instead of picking one square mip (5 taps already span the column)
    this.target.textures.forEach((t, i) => { t.name = i ? 'ocean.mirror.dist' : 'ocean.mirror'; t.anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy()); });
  }

  _disposeTargets() {
    this.raw?.depthTexture?.dispose();
    this.raw?.dispose();
    this.target?.dispose();
  }

  get distTexture() { return this.target.textures[1]; }

  // scale 0 disables the mirror and releases its GPU memory (the Low tier on phones)
  setScale(scale) {
    this.scale = scale;
    this.enabled = scale > 0;
    if (!this.enabled && this.target.width > 4) {
      this._disposeTargets();
      this._makeTargets(4, 4);
      this.onTargetsChanged?.();
    }
  }

  // MSAA sample count of the mirror render (from the quality tier)
  setSamples(samples) {
    if (samples === this.samples) return;
    this.samples = samples;
    const w = this.target.width, h = this.target.height;
    this._disposeTargets();
    this._makeTargets(w, h);
    this.onTargetsChanged?.();
  }

  _resize() {
    const r = this.renderer.getDrawingBufferSize(this._size);
    const w = Math.max(16, Math.round(r.x * this.scale)), h = Math.max(16, Math.round(r.y * this.scale));
    if (this.target.width !== w || this.target.height !== h) {
      this.raw.setSize(w, h);
      this.target.setSize(w, h);
    }
  }

  // Render the mirror view of `scene` for `camera` about the horizontal plane y = planeY.
  // l0: the decode scale in pre-exposed radiance units (MIRROR_L0_EXPOSED exposed units).
  render(scene, camera, planeY, l0 = 1) {
    if (!this.enabled) return;
    this._resize();
    this.planeY = planeY;
    this.l0 = l0;
    const mc = this.camera, n = this._n;
    camera.updateMatrixWorld();
    const camPos = this._v.setFromMatrixPosition(camera.matrixWorld);
    const P = this._t.set(camPos.x, planeY, camPos.z);            // plane point under the camera
    // mirrored position
    const view = this._view.subVectors(P, camPos).reflect(n).negate().add(P);
    // mirrored look target
    this._rot.extractRotation(camera.matrixWorld);
    const look = this._look.set(0, 0, -1).applyMatrix4(this._rot).add(camPos);
    const target = this._tgt.subVectors(P, look).reflect(n).negate().add(P);
    mc.position.copy(view);
    mc.up.set(0, 1, 0).applyMatrix4(this._rot).reflect(n);
    mc.lookAt(target);
    mc.fov = camera.fov; mc.aspect = camera.aspect; mc.near = camera.near; mc.far = camera.far;
    // Under reversed-Z the renderer would turn this camera's projection reversed (and rebuild it)
    // at its first render, after the oblique clip below was applied (research/three-r180-api.md
    // §10.3): make it reversed from the start so the oblique formula sees the matrix it is made for.
    if (this.renderer.capabilities.reversedDepthBuffer) mc._reversedDepth = true;
    mc.updateProjectionMatrix();
    this.logFar = this.renderer.capabilities.logarithmicDepthBuffer ? Math.log2(mc.far + 1) : 0;
    mc.updateMatrixWorld();
    // texture matrix (world space)
    this.textureMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)
      .multiply(mc.projectionMatrix).multiply(mc.matrixWorldInverse);
    const e = mc.matrixWorld.elements;
    this.basis.set(e[0], e[4], -e[8], e[1], e[5], -e[9], e[2], e[6], -e[10]);   // columns: right, up, forward
    this.proj.set(mc.projectionMatrix.elements[0], mc.projectionMatrix.elements[5]);
    // oblique near plane = mirror plane (Lengyel), GL or reversed-Z depth
    this._p.setFromNormalAndCoplanarPoint(n, P).applyMatrix4(mc.matrixWorldInverse);
    const C = this._c.set(this._p.normal.x, this._p.normal.y, this._p.normal.z, this._p.constant);
    const te = mc.projectionMatrix.elements;
    if (this.renderer.capabilities.reversedDepthBuffer) {
      const far = te[14] / te[10];
      const q = this._q.set((Math.sign(C.x) + te[8]) / te[0] * far, (Math.sign(C.y) + te[9]) / te[5] * far, -far, 1);
      const a = q.z / C.dot(q);
      te[2] = a * C.x; te[6] = a * C.y; te[10] = a * C.z - 1; te[14] = a * C.w;
    } else {
      const q = this._q.set((Math.sign(C.x) + te[8]) / te[0], (Math.sign(C.y) + te[9]) / te[5], -1, (1 + te[10]) / te[14]);
      C.multiplyScalar(2 / C.dot(q));
      te[2] = C.x; te[6] = C.y; te[10] = C.z + 1; te[14] = C.w;
    }
    mc.projectionMatrixInverse.copy(mc.projectionMatrix).invert();
    const cu = this._cmat.uniforms;
    cu.uLogFar.value = this.logFar;
    if (this.renderer.capabilities.reversedDepthBuffer) { cu.uZ.value.set(te[2], te[6], te[10], te[14]); cu.uXY.value.set(te[0], te[5], te[8], te[9]); } else cu.uZ.value.set(0, 0, 0, 0);

    // render
    const r = this.renderer;
    const prevTarget = r.getRenderTarget(), prevXR = r.xr.enabled, prevShadow = r.shadowMap.autoUpdate;
    const prevAlpha = r.getClearAlpha(); r.getClearColor(this._clear);
    const prevAuto = r.autoClear, prevBg = scene.background;
    scene.background = null;
    r.xr.enabled = false; r.shadowMap.autoUpdate = false; r.autoClear = true;
    r.setClearColor(0x000000, 0);
    r.setRenderTarget(this.raw);
    r.clear();
    r.render(scene, mc);
    // compress into the mip-mapped target the ocean samples
    cu.uSrc.value = this.raw.texture; cu.uDepth.value = this.raw.depthTexture;
    cu.uL0.value = l0;
    r.setRenderTarget(this.target);
    r.render(this._cscene, this._ccam);
    r.setRenderTarget(prevTarget);
    r.setClearColor(this._clear, prevAlpha);
    r.xr.enabled = prevXR; r.shadowMap.autoUpdate = prevShadow; r.autoClear = prevAuto;
    scene.background = prevBg;
  }

  dispose() { this._disposeTargets(); this._cmat.dispose(); this._cmesh.geometry.dispose(); }
}
