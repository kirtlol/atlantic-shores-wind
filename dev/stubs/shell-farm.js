// Dev stub for src/farm/farm.js (shell test harness only; the farm agent owns the real one).
// Same contract: class Farm with turbines/hero/pilePositions(), rotor spin + yaw, synchronised
// L-864 night lights; plus the shell's requested setWind(ms, fromDeg) and setADLS(on).
import * as THREE from 'three';
import { U, LAYER_REFLECT, curvatureDrop, mulberry32, registerScale } from '../../src/shared.js';
import { TURBINE, NIGHT_LIGHTS, SEA, LOOK, layoutPositions, rotorRpm } from '../../src/config.js';
import { buildTurbine } from './shell-turbine.js';

const LIGHT_VERT = /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>
attribute float aRadiance;
uniform float uFocalPx;
uniform float uLensD;
uniform float uOn;
varying float vRadiance;
varying vec3 vWorld;
void main() {
	vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
	float px = uLensD / max( - mvPosition.z, 0.1 ) * uFocalPx;
	float size = max( px, 2.0 );
	vRadiance = aRadiance * uOn * ( px * px ) / ( size * size );
	vWorld = ( modelMatrix * vec4( position, 1.0 ) ).xyz;
	gl_PointSize = size;
	gl_Position = projectionMatrix * mvPosition;
	#include <logdepthbuf_vertex>
}`;
const LIGHT_FRAG = (atmos) => /* glsl */`
#include <common>
#include <logdepthbuf_pars_fragment>
${atmos}
varying float vRadiance;
varying vec3 vWorld;
void main() {
	#include <logdepthbuf_fragment>
	float r = length( gl_PointCoord - 0.5 ) * 2.0;
	if ( r > 1.0 ) discard;
	vec3 core = vec3( 1.0, 0.03, 0.01 ) * vRadiance * smoothstep( 1.0, 0.6, r );
	vec3 fogged = applyAerialPerspective( core, vWorld ) - applyAerialPerspective( vec3( 0.0 ), vWorld );
	gl_FragColor = vec4( fogged, 1.0 );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`;

export class Farm {
  constructor(ctx) {
    this.ctx = ctx;
    this.adls = NIGHT_LIGHTS.adlsDefault;
    this.parts = buildTurbine({ lod: 0 });
    const rng = mulberry32((ctx.seed ?? 1) * 7919);
    const gauss = () => Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());
    this.turbines = layoutPositions().map((p, index) => ({
      index, id: p.id, x: p.x, z: p.z, baseY: -curvatureDrop(p.x, p.z),
      yawOffset: gauss() * TURBINE.yawOffsetSigmaDeg, yawDeg: 0, rpm: 0, phase: rng() * Math.PI * 2, lod: 0,
      idle: rng() < TURBINE.idleFraction,
    }));
    this.hero = this.turbines.find((t) => t.x === 0 && t.z === 0);
    const count = this.turbines.length;
    this.meshes = { static: [], nacelle: [], rotor: [] };
    for (const group of Object.keys(this.meshes)) {
      for (const part of this.parts[group]) {
        const mesh = new THREE.InstancedMesh(part.geometry, part.material, count);
        mesh.name = `farm.${part.name}`;
        mesh.castShadow = part.castShadow; mesh.receiveShadow = part.receiveShadow;
        mesh.frustumCulled = false;
        mesh.layers.enable(LAYER_REFLECT);
        if (group === 'rotor') mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        ctx.scene.add(mesh);
        this.meshes[group].push(mesh);
      }
    }
    const m = new THREE.Matrix4();
    this.turbines.forEach((t, i) => { m.makeTranslation(t.x, t.baseY, t.z); for (const mesh of this.meshes.static) mesh.setMatrixAt(i, m); });

    // L-864: radiance = cd / (lens area × LOOK.sceneUnitLux) (NIGHT_LIGHTS note).
    const L = NIGHT_LIGHTS.l864;
    const radiance = L.cd / (Math.PI * (L.lensD / 2) ** 2 * LOOK.sceneUnitLux);
    const lampCount = count * this.parts.lights.aviation.length;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(lampCount * 3), 3));
    geo.setAttribute('aRadiance', new THREE.Float32BufferAttribute(new Float32Array(lampCount).fill(radiance), 1));
    this.lightUniforms = { ...ctx.atmosphere?.uniforms, uFocalPx: { value: 1000 }, uLensD: { value: L.lensD }, uOn: { value: 0 } };
    this.lights = new THREE.Points(geo, new THREE.ShaderMaterial({
      uniforms: this.lightUniforms, vertexShader: LIGHT_VERT, fragmentShader: LIGHT_FRAG(ctx.atmosphere?.glsl ?? ''),
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.lights.frustumCulled = false;
    this.lights.layers.enable(LAYER_REFLECT);
    ctx.scene.add(this.lights);

    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(0, 0, 0, 'YXZ');
    this._hub = this.parts.frames.hubOffset;
    this._tilt = new THREE.Matrix4().makeRotationX(-TURBINE.tiltDeg * Math.PI / 180);
    this._size = new THREE.Vector2();
    ctx.ocean?.setPiles?.(this.pilePositions());
    this.setWind(SEA.windSpeed, SEA.windFromDeg);

    const d = this.parts.dims, a = this.turbines.find((t) => t.x !== 0 && t.z < 0 && Math.abs(t.z) < 200 && t.x < 1200);
    registerScale({ name: 'turbine.hubHeight', measure: () => d.hubHeight, expect: { axis: 'y' }, source: 'shell stub' });
    registerScale({ name: 'turbine.rotorDiameter', measure: () => d.rotorDiameter, expect: { axis: 'max' }, source: 'shell stub' });
    registerScale({ name: 'turbine.towerBaseD', measure: () => d.towerBaseD, expect: { axis: 'x' }, source: 'shell stub' });
    registerScale({ name: 'turbine.tpD', geometry: this.parts.static.find((p) => p.name === 'tp').geometry, expect: { axis: 'x' }, source: 'shell stub' });
    registerScale({ name: 'lattice.a', measure: () => Math.hypot(a.x, a.z), source: 'shell stub' });
  }

  pilePositions() { return this.turbines.map((t) => ({ x: t.x, z: t.z, radius: TURBINE.tp.diameter / 2 })); }
  setADLS(on) { this.adls = !!on; }

  setWind(ms, fromDeg) {
    const rpm = rotorRpm(ms);
    const pos = this.lights.geometry.getAttribute('position');
    const lamp = new THREE.Vector3();
    let k = 0;
    this.turbines.forEach((t, i) => {
      t.rpm = t.idle ? TURBINE.idleRpm : rpm;
      t.yawDeg = 180 - fromDeg + t.yawOffset;
      this._nacelleMatrix(t, this._m);
      for (const mesh of this.meshes.nacelle) mesh.setMatrixAt(i, this._m);
      for (const p of this.parts.lights.aviation) { lamp.copy(p).applyMatrix4(this._m); pos.setXYZ(k++, lamp.x, lamp.y, lamp.z); }
    });
    pos.needsUpdate = true;
    for (const mesh of [...this.meshes.static, ...this.meshes.nacelle]) mesh.instanceMatrix.needsUpdate = true;
  }

  _nacelleMatrix(t, out) {
    return out.makeRotationY(t.yawDeg * Math.PI / 180).setPosition(t.x, t.baseY + this.parts.frames.yawBearingY, t.z);
  }

  update(dt, t, camera) {
    const spin = new THREE.Matrix4(), hub = new THREE.Matrix4().makeTranslation(this._hub.x, this._hub.y, this._hub.z);
    this.turbines.forEach((tb, i) => {
      const angle = -(tb.rpm / 60 * 2 * Math.PI * t + tb.phase);
      this._nacelleMatrix(tb, this._m).multiply(hub).multiply(this._tilt).multiply(spin.makeRotationZ(angle));
      for (const mesh of this.meshes.rotor) mesh.setMatrixAt(i, this._m);
    });
    for (const mesh of this.meshes.rotor) mesh.instanceMatrix.needsUpdate = true;

    this.ctx.renderer.getDrawingBufferSize(this._size);
    this.lightUniforms.uFocalPx.value = this._size.y / (2 * Math.tan(camera.fov * Math.PI / 360));
    const flashOn = (t % NIGHT_LIGHTS.l864.periodS) < NIGHT_LIGHTS.l864.onS;
    this.lightUniforms.uOn.value = !this.adls && U.uNight.value > 0.02 && flashOn ? 1 : 0;
  }
}
