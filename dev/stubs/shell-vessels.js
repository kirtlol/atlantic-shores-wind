// Dev stub for src/life/vessels.js (shell test harness only; the vessels agent owns the real one).
// One crew transfer vessel pushed onto the hero's boat landing, floating on ocean.getSurface.
import * as THREE from 'three';
import { LAYER_REFLECT, azimuthToDir, registerScale } from '../../src/shared.js';
import { VESSELS, TURBINE } from '../../src/config.js';
import { applyAtmosphere } from './shell-fog.js';

export class Vessels {
  constructor(ctx) {
    this.ctx = ctx;
    const V = VESSELS.ctv;
    const white = applyAtmosphere(new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.45 }));
    const blue = applyAtmosphere(new THREE.MeshStandardMaterial({ color: 0x1f4f8a, roughness: 0.5 }));
    const hullL = V.length, demihull = 2.6;
    const hull = new THREE.BoxGeometry(demihull, V.foredeckY + V.draft, hullL);
    this.group = new THREE.Group();
    for (const s of [-1, 1]) {
      const h = new THREE.Mesh(hull, blue);
      h.position.set(s * (V.beam - demihull) / 2, (V.foredeckY - V.draft) / 2, 0);
      this.group.add(h);
    }
    const deck = new THREE.Mesh(new THREE.BoxGeometry(V.beam, 0.6, hullL * 0.9), white);
    deck.position.set(0, V.foredeckY - 0.3, -0.5);
    const house = new THREE.Mesh(new THREE.BoxGeometry(V.beam * 0.8, V.wheelhouseRoofY - V.foredeckY, 9), white);
    house.position.set(0, (V.wheelhouseRoofY + V.foredeckY) / 2, -3);
    this.group.add(deck, house);
    this.group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.layers.enable(LAYER_REFLECT); } });
    ctx.scene.add(this.group);

    // Bow on the landing: the landing faces TURBINE.boatLanding.facingDeg, so the CTV lies on that
    // bearing from the TP, bow toward the tower (heading = facing + 180).
    const facing = TURBINE.boatLanding.facingDeg;
    this.anchor = azimuthToDir(facing).multiplyScalar(TURBINE.tp.diameter / 2 + 1.2 + hullL / 2);
    this.heading = facing + 180;
    this._surf = { y: 0, normal: new THREE.Vector3(), velocity: new THREE.Vector3() };
    const box = new THREE.Box3().setFromObject(this.group).getSize(new THREE.Vector3());
    registerScale({ name: 'ctv.length', measure: () => box.z, expect: { axis: 'z' }, source: 'shell stub' });
    registerScale({ name: 'ctv.beam', measure: () => box.x, expect: { axis: 'x' }, source: 'shell stub' });
  }

  update(dt, t) {
    const s = this.ctx.ocean?.getSurface?.(this.anchor.x, this.anchor.z, t, this._surf);
    this.group.position.set(this.anchor.x, s ? s.y : 0, this.anchor.z);
    this.group.rotation.set(0, Math.PI - this.heading * Math.PI / 180, 0, 'YXZ');
    if (s) { this.group.rotation.x = -s.normal.z * 0.5; this.group.rotation.z = s.normal.x * 0.5; }
  }
}
