// Life patches (owner: ocean): what a school of bait and its predators do to the sea surface
// between strikes, the cues anglers and spotter pilots read from far away.
//   bait     a pod of menhaden darkens and tints the water ("large blobs of purple water")
//   nervous  bait under pressure ruffles the surface: short-wave roughness × (1 + 0.8·nervous)
//   slick    a feeding blitz leaves a glassy, oily slick drifting downwind: laid into the ocean's
//            trail map (slick channel) as a foam-free trail
// ocean.setLifePatches([{ x, z, radius, heading, bait, nervous, hue: [r, g, b], slick: [{x, z,
// width, age}] }]) replaces the patches (call each frame, ≤ MAX_LIFE_PATCHES); disturbances of kind
// 'nervous' ({ x, z, radius, strength, duration }) add short-lived patches as well.
import * as THREE from 'three';

export const MAX_LIFE_PATCHES = 8;
// Linear body tints (hue of the upwelling light over the pod), SCENE-SPEC §15 / life critique.
export const BAIT_HUES = { menhaden: [0.30, 0.18, 0.22], sandEel: [0.20, 0.22, 0.12], anchovy: [0.22, 0.22, 0.20] };
const SLICK_LIFE_S = 240;          // ESTIMATED: a blitz slick fades over 3-6 min

export class LifePatches {
  constructor() {
    this.list = [];
    this.uniforms = {
      uLifeA: { value: Array.from({ length: MAX_LIFE_PATCHES }, () => new THREE.Vector4()) },   // x, z (snap), radius, heading (rad)
      uLifeB: { value: Array.from({ length: MAX_LIFE_PATCHES }, () => new THREE.Vector4()) },   // bait, nervous, 0, 0
      uLifeC: { value: Array.from({ length: MAX_LIFE_PATCHES }, () => new THREE.Vector4()) },   // hue rgb (linear), 0
      uLifeCount: { value: 0 },
      uLifeBound: { value: new THREE.Vector4(1e9, 1e9, -1e9, -1e9) },
    };
    this._slickKeys = new Set();
  }

  // Patches from the wildlife module. Slick points go into the trail map (effects.addTrail).
  set(list, effects, t) {
    this.list = (list || []).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.z)).slice(0, MAX_LIFE_PATCHES);
    this.list.forEach((p, i) => {
      if (!Array.isArray(p.slick) || !p.slick.length) return;
      const key = `ocean.life.slick.${p.id ?? i}`;
      this._slickKeys.add(key);
      const pts = p.slick.filter((q) => Number.isFinite(q.x) && Number.isFinite(q.z))
        .map((q) => ({ x: q.x, z: q.z, t: t - (q.age ?? 0), width: q.width ?? 12, foam: 0 }));
      effects.addTrail(pts, { key, width: 12, lifetime: 1, spread: 0.02, foam: 0, aeration: 0, slick: 1, slickLife: SLICK_LIFE_S, slickSpread: 0.04 }, t);
    });
  }

  update(snap, nervous = [], t = 0) {
    const U = this.uniforms;
    let n = 0, x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    const put = (x, z, radius, heading, bait, nerv, hue) => {
      if (n >= MAX_LIFE_PATCHES) return;
      U.uLifeA.value[n].set(x - snap.x, z - snap.y, radius, heading);
      U.uLifeB.value[n].set(bait, nerv, 0, 0);
      U.uLifeC.value[n].set(hue[0], hue[1], hue[2], 0);
      const r = radius * 1.4 + 5;
      x0 = Math.min(x0, x - r); x1 = Math.max(x1, x + r); z0 = Math.min(z0, z - r); z1 = Math.max(z1, z + r);
      n++;
    };
    for (const p of this.list) {
      const hue = Array.isArray(p.hue) ? p.hue : BAIT_HUES[p.bait_species] || BAIT_HUES.menhaden;
      put(p.x, p.z, Math.max(p.radius ?? 15, 1), p.heading ?? 0, THREE.MathUtils.clamp(p.bait ?? 0, 0, 1), THREE.MathUtils.clamp(p.nervous ?? 0, 0, 1), hue);
    }
    // 'nervous' disturbances: rise over the first 30 % of their duration, fade over the last 30 %
    for (const d of nervous) {
      const a = (t - d.t0) / d.duration, env = THREE.MathUtils.smoothstep(a, 0, 0.3) * (1 - THREE.MathUtils.smoothstep(a, 0.7, 1));
      put(d.x, d.z, d.radius, 0, 0, THREE.MathUtils.clamp(d.strength, 0, 1) * env, BAIT_HUES.menhaden);
    }
    U.uLifeCount.value = n;
    U.uLifeBound.value.set(x0 - snap.x, z0 - snap.y, x1 - snap.x, z1 - snap.y);
  }
}
