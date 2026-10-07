// Dev-page stand-in for the Ocean module in dev/turbine.html: a flat, dark, glossy water plane at MSL
// (no waves, no curvature), passed through the real atmosphere so it fogs like everything else.
// The sky, sun, environment map and fog come from the real src/env/atmosphere.js.
import * as THREE from 'three';
import { applyAtmosphere } from '../../src/env/fog.js';

export function createDevWater(scene) {
  const mat = applyAtmosphere(new THREE.MeshPhysicalMaterial({ name: 'dev.water', color: new THREE.Color(0.002, 0.008, 0.014), roughness: 0.16, metalness: 0 }));
  const water = new THREE.Mesh(new THREE.CircleGeometry(60000, 96).rotateX(-Math.PI / 2), mat);
  water.receiveShadow = true;
  scene.add(water);
  return water;
}
