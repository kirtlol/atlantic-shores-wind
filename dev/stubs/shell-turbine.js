// Dev stub for src/turbine/turbine.js (shell test harness only; the modeller owns the real one).
// Same contract: buildTurbine({ lod }) → { static, nacelle, rotor, frames, lights, dims },
// createTurbineMaterials(), setPhotoLook(bool). Simple but to-scale geometry from TURBINE.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TURBINE, PAINT, MARKINGS } from '../../src/config.js';
import { applyAtmosphere } from './shell-fog.js';

const uPhotoLook = { value: MARKINGS.photoLookDefault ? 1 : 0 };
export function setPhotoLook(on) { uPhotoLook.value = on ? 1 : 0; }

const lin = (rgb) => new THREE.Color().setRGB(...rgb);
let materials = null;

export function createTurbineMaterials() {
  if (materials) return materials;
  const P = PAINT;
  const paint = () => new THREE.MeshPhysicalMaterial({ color: lin(P.ral7035.lin), roughness: P.ral7035.roughness, metalness: 0, clearcoat: P.ral7035.clearcoat, clearcoatRoughness: P.ral7035.clearcoatRoughness });
  const banded = paint();
  banded.onBeforeCompile = (shader) => {
    shader.uniforms.uPhotoLook = uPhotoLook;
    shader.vertexShader = `attribute float aBand;\nvarying float vBand;\n${shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvBand = aBand;')}`;
    shader.fragmentShader = `uniform float uPhotoLook;\nvarying float vBand;\n${shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>\n\tdiffuseColor.rgb = mix( diffuseColor.rgb, vec3( ${P.ral3020.lin.join(', ')} ), vBand * uPhotoLook );`)}`;
  };
  banded.customProgramCacheKey = () => 'shell-turbine-banded';
  materials = {
    paint: applyAtmosphere(paint()),
    banded: applyAtmosphere(banded),
    yellow: applyAtmosphere(new THREE.MeshStandardMaterial({ color: lin(P.ral1023.lin), roughness: P.ral1023.roughness })),
    steel: applyAtmosphere(new THREE.MeshStandardMaterial({ color: lin(P.galvanised.lin), roughness: P.galvanised.roughness, metalness: 1 })),
    growth: applyAtmosphere(new THREE.MeshStandardMaterial({ color: lin(P.marineGrowth.lin), roughness: 0.4 })),
  };
  return materials;
}

function cylinder(rTop, rBottom, y0, y1, segments, open = false) {
  return new THREE.CylinderGeometry(rTop, rBottom, y1 - y0, segments, 1, open).translate(0, (y0 + y1) / 2, 0);
}

// Blade 0 along +Y in the rotor frame, leading edge toward +X, +Z upwind; twist, prebend and cone
// from TURBINE.blade; aBand = 1 inside the photo-look red tip bands.
function bladeGeometry(stationStep, sectionPoints) {
  const B = TURBINE.blade, tipR = B[B.length - 1][1], band = MARKINGS.tipBands.lengthEach;
  const at = (r, col) => {
    for (let i = 1; i < B.length; i++) if (r <= B[i][1]) { const f = (r - B[i - 1][1]) / (B[i][1] - B[i - 1][1]); return B[i - 1][col] + (B[i][col] - B[i - 1][col]) * f; }
    return B[B.length - 1][col];
  };
  const radii = [];
  for (let r = B[0][1]; r < tipR; r += stationStep) radii.push(r);
  radii.push(tipR);
  const pos = [], bandAttr = [], idx = [];
  const cone = TURBINE.coneDeg * Math.PI / 180;
  for (const r of radii) {
    const chord = Math.max(at(r, 2), 0.05), tc = at(r, 4), twist = at(r, 3) * Math.PI / 180, pre = -at(r, 6), pax = at(r, 7);
    const inBand = r > tipR - band || (r > tipR - 3 * band && r < tipR - 2 * band) ? 1 : 0;
    for (let k = 0; k < sectionPoints; k++) {
      const a = k / sectionPoints * Math.PI * 2;
      const u = 0.5 - 0.5 * Math.cos(a);                                  // 0 = LE, 1 = TE
      const half = 5 * tc * chord * (0.2969 * Math.sqrt(u) - 0.126 * u - 0.3516 * u * u + 0.2843 * u ** 3 - 0.1036 * u ** 4);
      const x = pax * chord - u * chord, z = Math.sign(Math.sin(a)) * half;
      const xr = x * Math.cos(twist) - z * Math.sin(twist), zr = x * Math.sin(twist) + z * Math.cos(twist) + pre;
      pos.push(xr, r * Math.cos(cone) - zr * Math.sin(cone), r * Math.sin(cone) + zr * Math.cos(cone));
      bandAttr.push(inBand);
    }
  }
  for (let i = 0; i < radii.length - 1; i++) {
    for (let k = 0; k < sectionPoints; k++) {
      const a = i * sectionPoints + k, b = i * sectionPoints + (k + 1) % sectionPoints;
      idx.push(a, a + sectionPoints, b, b, a + sectionPoints, b + sectionPoints);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aBand', new THREE.Float32BufferAttribute(bandAttr, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function buildTurbine({ lod = 0 } = {}) {
  const M = createTurbineMaterials();
  const S = TURBINE.stack, seg = lod === 0 ? 48 : lod === 1 ? 24 : 12;
  const tpR = TURBINE.tp.diameter / 2, platR = TURBINE.platform.outerDiameter / 2;
  const tower = new THREE.LatheGeometry(TURBINE.tower.map(([y, d]) => new THREE.Vector2(d / 2, y)), seg);
  const statics = [
    { name: 'growth', geometry: cylinder(tpR, tpR, -4, S.growthTop, seg), material: M.growth },
    { name: 'tp', geometry: cylinder(tpR, tpR, S.growthTop, S.tpTop, seg), material: M.yellow },
    { name: 'platform', geometry: mergeGeometries([cylinder(platR, tpR, S.skirtBottom, S.deck, seg), cylinder(platR, platR, S.deck, S.deck + 0.1, seg)]), material: M.steel },
    { name: 'railing', geometry: cylinder(platR - 0.1, platR - 0.1, S.deck, S.railTop, seg, true), material: M.yellow },
    { name: 'tower', geometry: tower, material: M.paint },
  ];
  const N = TURBINE.nacelle;
  const nacelle = [{ name: 'nacelle', geometry: new THREE.BoxGeometry(N.width, N.height, N.boxLength).translate(0, N.floorY + N.height / 2, (N.boxFrontZ + N.boxRearZ) / 2), material: M.paint }];
  const blade = bladeGeometry(lod === 0 ? 1.5 : 4, lod === 0 ? 16 : 8);
  const blades = mergeGeometries([0, 1, 2].map((i) => blade.clone().rotateZ(-i * 2 * Math.PI / 3)));
  const spin = TURBINE.spinner;
  const spinner = new THREE.LatheGeometry(Array.from({ length: 12 }, (_, i) => {
    const f = i / 11;
    return new THREE.Vector2(spin.diameter / 2 * Math.sqrt(1 - f * f), spin.noseAheadOfHub - spin.length + spin.length * f);
  }), seg).rotateX(Math.PI / 2);
  const rotor = [
    { name: 'blades', geometry: blades, material: M.banded },
    { name: 'spinner', geometry: spinner, material: M.paint },
  ];
  for (const p of [...statics, ...nacelle, ...rotor]) { p.castShadow = true; p.receiveShadow = true; }
  const hub = new THREE.Vector3(...TURBINE.hubCentre);
  tower.computeBoundingBox();
  let tipR = 0;
  const bp = blades.getAttribute('position');
  for (let i = 0; i < bp.count; i++) tipR = Math.max(tipR, Math.hypot(bp.getX(i), bp.getY(i)));
  return {
    static: statics, nacelle, rotor,
    frames: { yawBearingY: S.towerTop, hubOffset: hub, tiltDeg: TURBINE.tiltDeg, coneDeg: TURBINE.coneDeg },
    lights: { aviation: [new THREE.Vector3(-3.5, S.l864 - S.towerTop, -6), new THREE.Vector3(3.5, S.l864 - S.towerTop, -6)], marine: [] },
    dims: { hubHeight: tower.boundingBox.max.y + hub.y, rotorDiameter: 2 * tipR, tpTopY: S.tpTop, towerBaseD: 2 * tower.boundingBox.max.x },
  };
}
