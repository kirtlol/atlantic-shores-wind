// A 1.80 m technician in an orange survival suit and white hard hat, as a scale reference for
// dev/turbine.html. Feet at y = 0, facing +Z. Dimensions are adult anthropometric round numbers.
import * as THREE from 'three';
import { applyAtmosphere } from '../../src/env/fog.js';

export function buildHuman() {
  const suit = applyAtmosphere(new THREE.MeshStandardMaterial({ name: 'dev.human.suit', color: new THREE.Color().setRGB(0.80, 0.18, 0.02), roughness: 0.75 }));
  const dark = applyAtmosphere(new THREE.MeshStandardMaterial({ name: 'dev.human.dark', color: new THREE.Color().setRGB(0.03, 0.03, 0.03), roughness: 0.6 }));
  const skin = applyAtmosphere(new THREE.MeshStandardMaterial({ name: 'dev.human.skin', color: new THREE.Color().setRGB(0.45, 0.28, 0.2), roughness: 0.6 }));
  const hat = applyAtmosphere(new THREE.MeshStandardMaterial({ name: 'dev.human.hat', color: new THREE.Color().setRGB(0.8, 0.8, 0.78), roughness: 0.4 }));
  const g = new THREE.Group();
  const add = (geo, mat, x, y, z, rx = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.x = rx; m.castShadow = true; m.receiveShadow = true; g.add(m); return m; };
  // capsule of total height h centred at y: CapsuleGeometry(radius, length) is length + 2r tall
  const cap = (r, h) => new THREE.CapsuleGeometry(r, Math.max(0.001, h - 2 * r), 6, 12);
  add(new THREE.BoxGeometry(0.11, 0.07, 0.27), dark, -0.1, 0.035, 0.03);          // boots
  add(new THREE.BoxGeometry(0.11, 0.07, 0.27), dark, 0.1, 0.035, 0.03);
  add(cap(0.075, 0.86), suit, -0.1, 0.07 + 0.43, 0);                              // legs 0.07 .. 0.93
  add(cap(0.075, 0.86), suit, 0.1, 0.07 + 0.43, 0);
  add(cap(0.19, 0.62), suit, 0, 0.9 + 0.31, 0);                                   // torso 0.90 .. 1.52
  add(cap(0.055, 0.66), suit, -0.26, 1.12, 0);                                    // arms
  add(cap(0.055, 0.66), suit, 0.26, 1.12, 0);
  add(cap(0.06, 0.12), skin, 0, 1.54, 0);                                         // neck
  add(new THREE.SphereGeometry(0.1, 16, 12), skin, 0, 1.64, 0);                    // head centre 1.64
  const helmet = add(new THREE.SphereGeometry(0.125, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), hat, 0, 1.675, 0);
  helmet.scale.set(1, 1.0, 1.1);
  add(new THREE.CylinderGeometry(0.15, 0.15, 0.012, 20), hat, 0, 1.675, 0.02);     // brim
  const box = new THREE.Box3().setFromObject(g);
  g.userData.height = box.max.y - box.min.y;
  return g;
}
