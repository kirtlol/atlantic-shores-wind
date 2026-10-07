// Dev stub for src/ocean/ocean.js (shell test harness only; the ocean agent owns the real one).
// Same contract: getHeight/getSurface/addDisturbance/setSeaState/setPiles, .mesh, .reflectionTarget.
// Surface = a few long-crested sinusoids (swell + wind sea) shared by the GPU and getHeight, on a
// camera-centred polar grid with Earth curvature; Fresnel sky reflection, sun/moon glint, FU-4
// upwelling, whitecaps above SEA.whitecapOnsetWind, aerial perspective.
import * as THREE from 'three';
import { U, curvatureDrop, azimuthToDir } from '../../src/shared.js';
import { SEA } from '../../src/config.js';

const G = 9.81;
const MAX_WAVES = 10;
const GRID_RADIUS = 120000;

function buildWaves({ windSpeed = SEA.windSpeed, windFromDeg = SEA.windFromDeg, swellHs = SEA.swell.Hs, swellFromDeg = SEA.swell.fromDeg, swellPeriod = SEA.swell.Tp } = {}) {
  const waves = [];
  const add = (towardDeg, lambda, amp, phase) => {
    const k = 2 * Math.PI / lambda, d = azimuthToDir(towardDeg);
    waves.push({ kx: k * d.x, kz: k * d.z, amp, omega: Math.sqrt(G * k), phase });
  };
  const swellLambda = G * swellPeriod * swellPeriod / (2 * Math.PI);
  add(swellFromDeg + 180, swellLambda, swellHs / Math.sqrt(8 * 2), 0.3);
  add(swellFromDeg + 186, swellLambda * 0.83, swellHs / Math.sqrt(8 * 2), 2.1);
  const hs = SEA.windSea.Hs * (windSpeed / SEA.windSpeed) ** 2;                 // PM scaling, Hs ∝ U²
  const lp = Math.max(1.5, SEA.windSea.wavelength * (windSpeed / SEA.windSpeed) ** 2);
  const spread = [-38, 24, -12, 35, 6, -25, 15, -4];
  const scale = [1.0, 0.82, 0.66, 0.55, 0.44, 0.36, 0.3, 0.24];
  const n = spread.length;
  spread.forEach((s, i) => add(windFromDeg + 180 + s, lp * scale[i], hs / Math.sqrt(8 * n) * Math.sqrt(scale[i] * 1.4), 1.7 * i + 0.5));
  return { waves, hs };
}

const VERT = /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>
uniform vec2 uOrigin;
uniform float uTime;
uniform vec4 uWaves[ ${MAX_WAVES} ];     // kx, kz, amp, phase
uniform float uOmega[ ${MAX_WAVES} ];
varying vec3 vWorld;
varying float vHeight;
void main() {
	vec2 xz = position.xz + uOrigin;
	float d = length( position.xz );
	float fade = 1.0 - smoothstep( 3000.0, 8000.0, d );
	float h = 0.0;
	for ( int i = 0; i < ${MAX_WAVES}; i ++ ) h += uWaves[ i ].z * sin( dot( uWaves[ i ].xy, xz ) - uOmega[ i ] * uTime + uWaves[ i ].w );
	h *= fade;
	vHeight = h;
	vWorld = vec3( xz.x, h - dot( xz, xz ) / ( 2.0 * 6371000.0 ), xz.y );
	vec4 mvPosition = viewMatrix * vec4( vWorld, 1.0 );
	gl_Position = projectionMatrix * mvPosition;
	#include <logdepthbuf_vertex>
}`;

// The shared U uniforms this stub reads, declared here unless the atmosphere's GLSL already does
// (its public GLSL no longer declares all of them).
const STUB_U = { uSunDir: 'vec3', uSunIlluminance: 'vec3', uMoonDir: 'vec3', uMoonIlluminance: 'vec3', uFogInscatter: 'vec3' };
const stubDecls = (atmosGlsl) => Object.entries(STUB_U)
  .filter(([name]) => !new RegExp(`uniform\\s+\\w+\\s+${name}\\b`).test(atmosGlsl))
  .map(([name, type]) => `uniform ${type} ${name};`).join('\n');
const frag = (atmosGlsl) => /* glsl */`
#include <common>
#include <logdepthbuf_pars_fragment>
${atmosGlsl}
${stubDecls(atmosGlsl)}
uniform float uTime;
uniform vec4 uWaves[ ${MAX_WAVES} ];
uniform float uOmega[ ${MAX_WAVES} ];
uniform float uFoam;
uniform float uSigma;
varying vec3 vWorld;
varying float vHeight;
void main() {
	#include <logdepthbuf_fragment>
	vec3 toCam = cameraPosition - vWorld;
	float dist = length( toCam );
	vec3 V = toCam / dist;
	vec2 xz = vWorld.xz;
	vec2 grad = vec2( 0.0 );
	for ( int i = 0; i < ${MAX_WAVES}; i ++ ) grad += uWaves[ i ].z * uWaves[ i ].xy * cos( dot( uWaves[ i ].xy, xz ) - uOmega[ i ] * uTime + uWaves[ i ].w );
	// fine ripples (normal only), fading with distance
	float rip = 1.0 - smoothstep( 20.0, 150.0, dist );
	grad += rip * 0.035 * vec2( cos( 1.9 * xz.x + 0.7 * xz.y + 3.1 * uTime ), cos( -0.8 * xz.x + 2.3 * xz.y + 2.7 * uTime ) );
	grad *= 1.0 - smoothstep( 2000.0, 30000.0, dist );
	vec3 N = normalize( vec3( - grad.x, 1.0, - grad.y ) );
	float NdV = max( dot( N, V ), 0.0 );
	float F = 0.02 + 0.98 * pow( 1.0 - NdV, 5.0 );
	vec3 R = reflect( - V, N ); R.y = abs( R.y );
	vec3 col = 0.65 * F * skyRadiance( R );      // slope averaging: 0.55-0.75 x flat Fresnel (SCENE-SPEC 11.2)
	float shin = mix( 900.0, 40.0, smoothstep( 30.0, 6000.0, dist ) );
	vec3 H = normalize( V + uSunDir );
	col += uSunIlluminance * F * ( shin + 8.0 ) / 25.13 * pow( max( dot( N, H ), 0.0 ), shin ) * max( dot( N, uSunDir ), 0.0 );
	vec3 Hm = normalize( V + uMoonDir );
	col += uMoonIlluminance * F * ( shin + 8.0 ) / 25.13 * pow( max( dot( N, Hm ), 0.0 ), shin ) * max( dot( N, uMoonDir ), 0.0 );
	vec3 Ed = uSunIlluminance * max( uSunDir.y, 0.0 ) + uMoonIlluminance * max( uMoonDir.y, 0.0 ) + 2.2 * uFogInscatter;
	col += ( 1.0 - F ) * vec3( ${SEA.upwellingReflectance.map((v) => v.toFixed(4)).join(', ')} ) / 3.14159 * Ed;
	float foam = uFoam * smoothstep( 1.1, 2.4, vHeight / max( uSigma, 1e-3 ) ) * ( 1.0 - smoothstep( 500.0, 4000.0, dist ) );
	col = mix( col, 0.7 * Ed / 3.14159, foam );
	gl_FragColor = vec4( applyAerialPerspective( col, vWorld ), 1.0 );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`;

function polarGrid(rings, segments) {
  const pos = [0, 0, 0], idx = [];
  const r0 = 0.5;
  for (let i = 0; i < rings; i++) {
    const r = r0 * Math.pow(GRID_RADIUS / r0, i / (rings - 1));
    for (let j = 0; j < segments; j++) { const a = j / segments * Math.PI * 2; pos.push(r * Math.cos(a), 0, r * Math.sin(a)); }
  }
  for (let j = 0; j < segments; j++) idx.push(0, 1 + (j + 1) % segments, 1 + j);
  for (let i = 0; i < rings - 1; i++) {
    for (let j = 0; j < segments; j++) {
      const a = 1 + i * segments + j, b = 1 + i * segments + (j + 1) % segments, c = a + segments, d = b + segments;
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

export class Ocean {
  constructor(ctx) {
    this.ctx = ctx;
    this.piles = [];
    this.reflectionTarget = null;
    this._nextId = 1;
    const waveUniforms = Array.from({ length: MAX_WAVES }, () => new THREE.Vector4());
    this.uniforms = {
      uSunDir: U.uSunDir, uSunIlluminance: U.uSunIlluminance, uMoonDir: U.uMoonDir, uMoonIlluminance: U.uMoonIlluminance, uFogInscatter: U.uFogInscatter,
      ...ctx.atmosphere?.uniforms,
      uTime: U.uTime, uOrigin: { value: new THREE.Vector2() },
      uWaves: { value: waveUniforms }, uOmega: { value: new Array(MAX_WAVES).fill(0) },
      uFoam: { value: 0 }, uSigma: { value: 0.1 },
    };
    const material = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: VERT, fragmentShader: frag(ctx.atmosphere?.glsl ?? '') });
    this.mesh = new THREE.Mesh(polarGrid(ctx.quality.oceanRings, ctx.quality.oceanSegments), material);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = false;
    ctx.scene.add(this.mesh);
    this.setSeaState({});
  }

  setSeaState(opts) {
    const { waves, hs } = buildWaves(opts);
    this.waves = waves;
    waves.forEach((w, i) => { this.uniforms.uWaves.value[i].set(w.kx, w.kz, w.amp, w.phase); this.uniforms.uOmega.value[i] = w.omega; });
    const u = opts.windSpeed ?? SEA.windSpeed;
    const monahan = 3.84e-4 * Math.pow(u, 3.41) / 100;       // whitecap fraction
    this.uniforms.uFoam.value = u > SEA.whitecapOnsetWind ? Math.min(1, monahan * 60) : 0;
    this.uniforms.uSigma.value = Math.hypot(hs, SEA.swell.Hs) / 4;
  }

  getHeight(x, z, t) {
    let h = 0;
    for (const w of this.waves) h += w.amp * Math.sin(w.kx * x + w.kz * z - w.omega * t + w.phase);
    return h - curvatureDrop(x, z);
  }

  getSurface(x, z, t, out = { y: 0, normal: new THREE.Vector3(), velocity: new THREE.Vector3() }) {
    let h = 0, gx = 0, gz = 0, vy = 0;
    for (const w of this.waves) {
      const a = w.kx * x + w.kz * z - w.omega * t + w.phase;
      h += w.amp * Math.sin(a);
      const c = w.amp * Math.cos(a);
      gx += c * w.kx; gz += c * w.kz; vy -= c * w.omega;
    }
    out.y = h - curvatureDrop(x, z);
    out.normal.set(-gx, 1, -gz).normalize();
    out.velocity.set(0, vy, 0);
    return out;
  }

  addDisturbance() { return this._nextId++; }
  setPiles(piles) { this.piles = piles; }

  update(dt, t, camera) {
    this.uniforms.uOrigin.value.set(Math.round(camera.position.x), Math.round(camera.position.z));
    // The grid is centred under the camera; its vertex positions are offsets from uOrigin.
  }
}
