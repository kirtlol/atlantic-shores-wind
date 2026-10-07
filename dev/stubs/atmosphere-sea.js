// Dev stand-in for the ocean (owner: ocean), used only by dev/atmosphere.html: a dark grey,
// Earth-curved polar sheet (y = -curvatureDrop) out to 150 km, glossy enough to show the
// environment's Fresnel sky reflection, receiving shadows, fogged through applyAtmosphere().
import * as THREE from 'three';
import { curvatureDrop } from '../../src/shared.js';
import { applyAtmosphere } from '../../src/env/fog.js';

export function createSeaStandIn({ radius = 150000, rings = 220, segments = 256, centre = new THREE.Vector3() } = {}) {
  const pos = [], idx = [];
  const r0 = 2;
  for (let i = 0; i <= rings; i++) {
    const r = i === 0 ? 0 : r0 * Math.pow(radius / r0, (i - 1) / (rings - 1));
    for (let j = 0; j < segments; j++) {
      const a = (j / segments) * Math.PI * 2;
      const x = centre.x + r * Math.cos(a), z = centre.z + r * Math.sin(a);
      pos.push(x, -curvatureDrop(x, z), z);
    }
  }
  for (let i = 0; i < rings; i++) for (let j = 0; j < segments; j++) {
    const a = i * segments + j, b = i * segments + (j + 1) % segments;
    const c = (i + 1) * segments + j, d = (i + 1) * segments + (j + 1) % segments;
    idx.push(a, b, c, b, d, c);                  // counter-clockwise seen from above (normal +Y)
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = applyAtmosphere(new THREE.MeshStandardMaterial({ name: 'Dev.Sea', color: new THREE.Color(0.012, 0.016, 0.022), roughness: 0.28, metalness: 0 }));
  const mesh = new THREE.Mesh(g, m);
  mesh.name = 'Dev.SeaStandIn';
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  return mesh;
}
