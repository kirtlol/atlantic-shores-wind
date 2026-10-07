// DEV ONLY (wildlife dev page): stand-in for src/farm/farm.js with the parts the birds and the blitz
// use — turbines [{ index, x, z, baseY }], dims { railTopY, deckY }, pilePositions() — and simple
// geometry at the real layout positions near the hero: the yellow TP / monopile ("pile"), the marine
// growth band, the platform deck with its guard-rail (top rail, knee rail, posts every 1.5 m), a
// tapered tower and a nacelle box. All on LAYER_REFLECT. Heights from config TURBINE.stack.
import * as THREE from 'three';
import { LAYER_REFLECT, curvatureDrop } from '../../src/shared.js';
import { TURBINE, PAINT, layoutPositions } from '../../src/config.js';

export function buildStubFarm(ctx, applyAtmosphere, { maxDist = 4000 } = {}) {
  const S = TURBINE.stack, R_TP = TURBINE.tp.diameter / 2, R_DECK = TURBINE.platform.outerDiameter / 2;
  const R_RAIL = R_DECK - 0.04;
  const lin = (a) => new THREE.Color().setRGB(a[0], a[1], a[2]);
  const mat = (c, r, m = 0) => applyAtmosphere(new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m }));
  const yellow = mat(lin(PAINT.ral1023.lin), 0.55), grey = mat(lin(PAINT.ral7035.lin), 0.5);
  const galv = mat(lin(PAINT.galvanised.lin), 0.55, 1), growth = mat(lin(PAINT.marineGrowth.lin), 0.4);
  const parts = [];
  parts.push([new THREE.CylinderGeometry(R_TP, R_TP, S.tpTop - S.growthTop, 64, 1, true).translate(0, (S.tpTop + S.growthTop) / 2, 0), yellow]);
  parts.push([new THREE.CylinderGeometry(R_TP, R_TP, S.growthTop + 8, 64, 1, true).translate(0, (S.growthTop - 8) / 2, 0), growth]);
  parts.push([new THREE.CylinderGeometry(R_DECK, R_TP, S.deck - S.skirtBottom, 64).translate(0, (S.deck + S.skirtBottom) / 2 - 0.05, 0), galv]);
  parts.push([new THREE.CylinderGeometry(3.75, 5.0, S.towerTop - S.tpTop, 48).translate(0, (S.towerTop + S.tpTop) / 2, 0), grey]);
  parts.push([new THREE.BoxGeometry(9, 11, 19).translate(0, S.nacelleFloor + 5.5, -0.5), grey]);
  parts.push([new THREE.TorusGeometry(R_RAIL, 0.0242, 6, 160).rotateX(Math.PI / 2).translate(0, S.railTop - 0.0242, 0), yellow]);
  parts.push([new THREE.TorusGeometry(R_RAIL, 0.0213, 6, 160).rotateX(Math.PI / 2).translate(0, S.deck + 0.6, 0), yellow]);
  const nPosts = Math.round(2 * Math.PI * R_RAIL / TURBINE.platform.postPitch);
  const post = new THREE.CylinderGeometry(0.0242, 0.0242, S.railTop - S.deck, 6);
  const posts = [];
  for (let k = 0; k < nPosts; k++) {
    const a = k / nPosts * 2 * Math.PI;
    posts.push(post.clone().translate(Math.cos(a) * R_RAIL, (S.railTop + S.deck) / 2, Math.sin(a) * R_RAIL));
  }
  parts.push([mergeGeometries(posts), yellow]);

  const pos = layoutPositions().filter((p) => Math.hypot(p.x, p.z) < maxDist);
  const group = new THREE.Group();
  group.name = 'dev.stubFarm';
  const m4 = new THREE.Matrix4();
  for (const [geo, material] of parts) {
    const im = new THREE.InstancedMesh(geo, material, pos.length);
    pos.forEach((p, i) => im.setMatrixAt(i, m4.makeTranslation(p.x, -curvatureDrop(p.x, p.z), p.z)));
    im.layers.enable(LAYER_REFLECT);
    im.frustumCulled = false;
    im.castShadow = true; im.receiveShadow = true;
    group.add(im);
  }
  ctx.scene.add(group);
  const turbines = pos.map((p, index) => ({ index, id: p.id, x: p.x, z: p.z, baseY: -curvatureDrop(p.x, p.z) }));
  const piles = turbines.map((t) => ({ x: t.x, z: t.z, radius: R_TP }));
  ctx.ocean?.setPiles?.(piles);
  return {
    group, turbines, hero: turbines.find((t) => t.x === 0 && t.z === 0),
    dims: { railTopY: S.railTop, deckY: S.deck },
    pilePositions: () => piles.map((p) => ({ ...p })),
    update() {},
  };
}

// Minimal merge of non-indexed or indexed BufferGeometries with position/normal/uv (dev use only).
function mergeGeometries(list) {
  const g = list.map((x) => (x.index ? x.toNonIndexed() : x));
  const count = g.reduce((s, x) => s + x.attributes.position.count, 0);
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) {
    const size = g[0].attributes[name].itemSize;
    const arr = new Float32Array(count * size);
    let o = 0;
    for (const x of g) { arr.set(x.attributes[name].array, o); o += x.attributes[name].array.length; }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  return out;
}
