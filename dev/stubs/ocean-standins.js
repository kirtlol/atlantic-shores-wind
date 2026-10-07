// DEV ONLY (ocean dev page): stand-in turbines on LAYER_REFLECT — yellow TP + white tower +
// nacelle box + hub, at the real layout positions within `maxDist`, plus night-light sprites
// (L-864 red on the nacelle, yellow marine lanterns) so reflections can be judged.
import * as THREE from 'three';
import { LAYER_REFLECT, curvatureDrop } from '../../src/shared.js';
import { TURBINE, layoutPositions } from '../../src/config.js';

export function buildStandins(scene, applyAtmosphere, { maxDist = 16000, night = false } = {}) {
  const S = TURBINE.stack;
  const yellow = applyAtmosphere(new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(0.941, 0.478, 0.02), roughness: 0.55 }));
  const white = applyAtmosphere(new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(0.547, 0.567, 0.53), roughness: 0.5 }));
  const growth = applyAtmosphere(new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(0.005, 0.004, 0.002), roughness: 0.4 }));
  const tpGeo = new THREE.CylinderGeometry(5.25, 5.25, S.tpTop - S.growthTop, 48, 1, true).translate(0, (S.tpTop + S.growthTop) / 2, 0);
  const growthGeo = new THREE.CylinderGeometry(5.25, 5.25, S.growthTop + 6, 48, 1, true).translate(0, (S.growthTop - 6) / 2, 0);
  const towerGeo = new THREE.CylinderGeometry(3.75, 5.0, S.towerTop - S.tpTop, 48, 1, false).translate(0, (S.towerTop + S.tpTop) / 2, 0);
  const nacGeo = new THREE.BoxGeometry(9, 11, 19).translate(0, S.nacelleFloor + 5.5, -0.5);
  const deckGeo = new THREE.CylinderGeometry(7.9, 7.9, 1.2, 48).translate(0, S.deck - 0.6, 0);
  const parts = [[tpGeo, yellow], [growthGeo, growth], [towerGeo, white], [nacGeo, white], [deckGeo, white]];
  const pos = layoutPositions().filter((p) => Math.hypot(p.x, p.z) < maxDist);
  const group = new THREE.Group();
  for (const [geo, mat] of parts) {
    const m = new THREE.InstancedMesh(geo, mat, pos.length);
    pos.forEach((p, i) => m.setMatrixAt(i, new THREE.Matrix4().makeTranslation(p.x, -curvatureDrop(p.x, p.z), p.z)));
    m.layers.enable(LAYER_REFLECT);
    m.frustumCulled = false;
    group.add(m);
  }
  // night lights (sprites sized for visibility; radiance scaled to keep intensity plausible)
  const lights = new THREE.Group();
  if (night) {
    const red = new THREE.SpriteMaterial({ color: new THREE.Color(0.9, 0.02, 0.01).multiplyScalar(0.012), blending: THREE.AdditiveBlending, depthWrite: false });
    const amber = new THREE.SpriteMaterial({ color: new THREE.Color(0.9, 0.6, 0.05).multiplyScalar(0.004), blending: THREE.AdditiveBlending, depthWrite: false });
    for (const p of pos) {
      const y0 = -curvatureDrop(p.x, p.z);
      const s = new THREE.Sprite(red); s.position.set(p.x, y0 + S.l864, p.z); s.scale.setScalar(2.5); s.layers.enable(LAYER_REFLECT); lights.add(s);
      const m = new THREE.Sprite(amber); m.position.set(p.x + 5.4, y0 + S.marineLanterns, p.z); m.scale.setScalar(1.2); m.layers.enable(LAYER_REFLECT); lights.add(m);
    }
  }
  group.add(lights);
  scene.add(group);
  return { group, positions: pos, piles: pos.map((p) => ({ x: p.x, z: p.z, radius: 5.25 })) };
}
