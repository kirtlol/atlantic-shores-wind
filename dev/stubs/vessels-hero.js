// Dev stand-in for the hero turbine foundation (vessels dev page only): the yellow transition
// piece, a grey tower stub and the two boat-landing tubes at their config positions, so the CTV
// can be checked pushing onto the landing without the full farm (use ?farm=1 for the real one).
import * as THREE from 'three';
import { azimuthToDir, LAYER_REFLECT } from '../../src/shared.js';
import { TURBINE, PAINT } from '../../src/config.js';
import { applyAtmosphere } from '../../src/env/fog.js';

export function buildHeroStandIn(ctx) {
  const T = TURBINE, S = T.stack, B = T.boatLanding;
  const yellow = applyAtmosphere(new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(...PAINT.ral1023.lin), roughness: 0.55 }));
  const grey = applyAtmosphere(new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(...PAINT.ral7035.lin), roughness: 0.5 }));
  const group = new THREE.Group();
  group.name = 'dev.heroStandIn';
  const tp = new THREE.Mesh(new THREE.CylinderGeometry(T.tp.diameter / 2, T.tp.diameter / 2, S.tpTop + 6, 48).translate(0, (S.tpTop - 6) / 2, 0), yellow);
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(4.9, 5.0, 60, 48).translate(0, S.tpTop + 30, 0), grey);
  const deck = new THREE.Mesh(new THREE.CylinderGeometry(T.platform.outerDiameter / 2, T.platform.outerDiameter / 2 - 0.6, 1.6, 48).translate(0, S.deck - 0.8, 0), grey);
  group.add(tp, tower, deck);
  // landing tubes: axis 0.35 m ladder offset + ladder setback - tube radius from the TP wall (turbine.js)
  const u = azimuthToDir(B.facingDeg), v = azimuthToDir(B.facingDeg + 90);
  const tubeU = T.tp.diameter / 2 + 0.35 + B.ladderSetback - B.tubeDiameter / 2;
  const piles = [{ x: 0, z: 0, radius: T.tp.diameter / 2 }];
  for (const s of [-1, 1]) {
    const x = u.x * tubeU + v.x * s * B.tubeSpacing / 2, z = u.z * tubeU + v.z * s * B.tubeSpacing / 2;
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(B.tubeDiameter / 2, B.tubeDiameter / 2, B.tubeTop - B.tubeBottom, 16).translate(x, (B.tubeTop + B.tubeBottom) / 2, z), yellow);
    group.add(tube);
    piles.push({ x, z, radius: B.tubeDiameter / 2 });
  }
  group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.layers.enable(LAYER_REFLECT); } });
  ctx.scene.add(group);
  ctx.ocean?.setPiles(piles);
  return group;
}
