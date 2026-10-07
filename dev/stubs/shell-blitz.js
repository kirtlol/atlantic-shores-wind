// Dev stub for src/life/blitz.js (shell test harness only; the wildlife agent owns the real one).
// Same contract: trigger(x, z), active, focus(), splashAt(x, z, size). Each blitz drifts across
// the sea throwing ballistic spray bursts (0.5-1.5 m high, LIFE.blitz) and ring disturbances.
import * as THREE from 'three';
import { U, LAYER_REFLECT, azimuthToDir } from '../../src/shared.js';
import { LIFE } from '../../src/config.js';

const POOL = 2400;
const G = 9.81;

const VERT = /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>
attribute float aSize;
uniform float uFocalPx;
varying float vCover;
varying vec3 vWorld;
void main() {
	vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
	float px = aSize / max( - mvPosition.z, 0.1 ) * uFocalPx;
	float size = clamp( px, 1.5, 64.0 );
	vCover = aSize > 0.0 ? min( 1.0, ( px * px ) / ( size * size ) ) : 0.0;
	vWorld = ( modelMatrix * vec4( position, 1.0 ) ).xyz;
	gl_PointSize = size;
	gl_Position = projectionMatrix * mvPosition;
	#include <logdepthbuf_vertex>
}`;
const FRAG = (atmos) => /* glsl */`
#include <common>
#include <logdepthbuf_pars_fragment>
${atmos}
uniform vec3 uWhite;
varying float vCover;
varying vec3 vWorld;
void main() {
	#include <logdepthbuf_fragment>
	float r = length( gl_PointCoord - 0.5 ) * 2.0;
	float a = vCover * smoothstep( 1.0, 0.4, r );
	if ( a < 0.004 ) discard;
	gl_FragColor = vec4( applyAerialPerspective( uWhite, vWorld ), a );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`;

export class Blitz {
  constructor(ctx) {
    this.ctx = ctx;
    this.active = [];
    this._id = 1;
    this.pos = new Float32Array(POOL * 3);
    this.vel = new Float32Array(POOL * 3);
    this.size = new Float32Array(POOL);
    this._cursor = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.uniforms = { ...ctx.atmosphere?.uniforms, uFocalPx: { value: 1000 }, uWhite: { value: new THREE.Color(1, 1, 1) } };
    this.points = new THREE.Points(geo, new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG(ctx.atmosphere?.glsl ?? ''), transparent: true, depthWrite: false,
    }));
    this.points.frustumCulled = false;
    this.points.layers.enable(LAYER_REFLECT);
    ctx.scene.add(this.points);
    this._size = new THREE.Vector2();
  }

  trigger(x, z) {
    const B = LIFE.blitz;
    const ev = {
      id: this._id++, x, z,
      dir: azimuthToDir(Math.random() * 360),
      speed: B.travelSpeed[0] + Math.random() * (B.travelSpeed[1] - B.travelSpeed[0]),
      radius: (B.patchDiameter[0] + Math.random() * (B.patchDiameter[1] - B.patchDiameter[0])) / 2,
      life: B.durationS[0] + Math.random() * (B.durationS[1] - B.durationS[0]),
      next: 0,
    };
    this.active.push(ev);
    this.splashAt(x, z, 1);
    return ev.id;
  }

  focus() {
    const e = this.active[this.active.length - 1];
    return e ? new THREE.Vector3(e.x, 0, e.z) : null;
  }

  splashAt(x, z, size = 1) {
    const [h0, h1] = LIFE.blitz.splashHeight.bassBlues;
    const drops = Math.round(60 * size);
    for (let i = 0; i < drops; i++) {
      const k = this._cursor, j = 3 * k;
      this._cursor = (this._cursor + 1) % POOL;
      const up = Math.sqrt(2 * G * (h0 + Math.random() * (h1 - h0)) * size);
      const a = Math.random() * Math.PI * 2, out = 0.6 + 1.8 * Math.random();
      this.pos[j] = x + 0.3 * Math.cos(a); this.pos[j + 2] = z + 0.3 * Math.sin(a);
      this.pos[j + 1] = this.ctx.ocean ? this.ctx.ocean.getHeight(x, z, U.uTime.value) : 0;
      this.vel[j] = out * Math.cos(a); this.vel[j + 1] = up * (0.5 + 0.5 * Math.random()); this.vel[j + 2] = out * Math.sin(a);
      this.size[k] = 0.05 + 0.12 * Math.random();
    }
    this.ctx.ocean?.addDisturbance?.({ x, z, radius: 2 * size, strength: size, duration: 4, foam: 1, kind: 'splash' });
  }

  update(dt, t, camera) {
    for (const e of this.active) {
      e.life -= dt;
      e.x += e.dir.x * e.speed * dt; e.z += e.dir.z * e.speed * dt;
      e.next -= dt;
      if (e.next <= 0) {
        const a = Math.random() * Math.PI * 2, r = e.radius * Math.sqrt(Math.random());
        this.splashAt(e.x + r * Math.cos(a), e.z + r * Math.sin(a), 0.5 + Math.random());
        e.next = 0.15 + Math.random() * 0.9;
      }
    }
    this.active = this.active.filter((e) => e.life > 0);
    const ocean = this.ctx.ocean;
    for (let k = 0; k < POOL; k++) {
      if (this.size[k] <= 0) continue;
      const j = 3 * k;
      this.vel[j + 1] -= G * dt;
      this.pos[j] += this.vel[j] * dt; this.pos[j + 1] += this.vel[j + 1] * dt; this.pos[j + 2] += this.vel[j + 2] * dt;
      const sea = ocean ? ocean.getHeight(this.pos[j], this.pos[j + 2], t) : 0;
      if (this.vel[j + 1] < 0 && this.pos[j + 1] < sea) this.size[k] = 0;
    }
    const geo = this.points.geometry;
    geo.getAttribute('position').needsUpdate = true;
    geo.getAttribute('aSize').needsUpdate = true;
    this.ctx.renderer.getDrawingBufferSize(this._size);
    this.uniforms.uFocalPx.value = this._size.y / (2 * Math.tan(camera.fov * Math.PI / 360));
    // White water: albedo 0.75 under sun + sky (Lambert, radiance = a·E/π).
    const E = U.uSunIlluminance.value, s = Math.max(U.uSunDir.value.y, 0), f = U.uFogInscatter.value;
    this.uniforms.uWhite.value.setRGB((E.r * s + 2.2 * f.r) * 0.75 / Math.PI, (E.g * s + 2.2 * f.g) * 0.75 / Math.PI, (E.b * s + 2.2 * f.b) * 0.75 / Math.PI);
  }
}
