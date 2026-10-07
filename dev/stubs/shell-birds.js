// Dev stub for src/life/birds.js (shell test harness only; the wildlife agent owns the real one).
// A loose flock of herring gulls wheeling near the hero by day; none flying at night.
import * as THREE from 'three';
import { U, LAYER_REFLECT, mulberry32, registerScale } from '../../src/shared.js';
import { LIFE } from '../../src/config.js';
import { applyAtmosphere } from './shell-fog.js';

const COUNT = 14;

export class Birds {
  constructor(ctx) {
    const span = LIFE.birds.herringGull.wingspan, len = LIFE.birds.herringGull.length;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0, -len / 2, 0, 0, len / 2, -span / 2, 0.08, 0.05,
      0, 0, -len / 2, span / 2, 0.08, 0.05, 0, 0, len / 2,
    ], 3));
    g.computeVertexNormals();
    const mat = applyAtmosphere(new THREE.MeshStandardMaterial({ color: 0xd9dcdf, roughness: 0.8, side: THREE.DoubleSide }));
    this.mesh = new THREE.InstancedMesh(g, mat, COUNT);
    this.mesh.frustumCulled = false;
    this.mesh.layers.enable(LAYER_REFLECT);
    ctx.scene.add(this.mesh);
    const rng = mulberry32((ctx.seed ?? 1) * 31);
    this.birds = Array.from({ length: COUNT }, () => ({ r: 20 + 40 * rng(), h: 12 + 25 * rng(), w: (0.2 + 0.25 * rng()) * (rng() < 0.5 ? -1 : 1), ph: rng() * 6.283 }));
    this.centre = new THREE.Vector3(-90, 0, 60);
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._p = new THREE.Vector3(); this._s = new THREE.Vector3(1, 1, 1);
    registerScale({ name: 'bird.herringGull.wingspan', geometry: g, expect: { axis: 'x' }, source: 'shell stub' });
  }

  update(dt, t) {
    this.mesh.visible = U.uNight.value < 0.5;
    this.birds.forEach((b, i) => {
      const a = b.ph + b.w * t;
      this._p.set(this.centre.x + b.r * Math.cos(a), b.h + 2 * Math.sin(0.3 * t + b.ph), this.centre.z + b.r * Math.sin(a));
      this._q.setFromEuler(new THREE.Euler(0, -a - Math.sign(b.w) * Math.PI / 2, 0.35 * Math.sign(b.w)));
      this._s.set(1, 1 + 0.6 * Math.sin(9 * t + b.ph), 1);
      this.mesh.setMatrixAt(i, this._m.compose(this._p, this._q, this._s));
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
