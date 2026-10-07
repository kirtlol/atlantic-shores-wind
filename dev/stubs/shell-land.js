// Dev stub for src/env/land.js (shell test harness only; the vessels agent owns the real one).
// Blue-grey blocks for the tallest Atlantic City towers at their LAND positions.
import * as THREE from 'three';
import { curvatureDrop } from '../../src/shared.js';
import { LAND } from '../../src/config.js';
import { applyAtmosphere } from './shell-fog.js';

export class Land {
  constructor(ctx) {
    const mat = applyAtmosphere(new THREE.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.9 }));
    for (const b of LAND.skyline.filter((s) => Number.isFinite(s.x))) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(70, b.height, 45), mat);
      m.position.set(b.x, b.height / 2 - curvatureDrop(b.x, b.z), b.z);
      ctx.scene.add(m);
    }
  }
  update() {}
}
