// DEV ONLY (ocean dev page): reads individual shading terms of the ocean fragment shader at a few
// screen positions. The shader is patched through onBeforeCompile in this dev page only; the
// shipped material is untouched. Terms are written to a FloatType target and read back.
import * as THREE from 'three';

const TERMS = [
  ['Fe', 'vec3(Fe)'], ['Fc', 'vec3(Fc)'], ['reflFinal', 'refl'], ['upwell', 'uUpwelling * (1.0 / PI) * Ed * (1.0 - Fe)'],
  ['Esky', 'Esky'], ['sigmaV', 'vec3(sigV)'], ['N.y', 'vec3(N.y)'], ['cov', 'vec3(cov)'], ['glint', 'glint'], ['C', 'C'], ['Rv.y', 'vec3(Rv.y)'], ['shadow', 'vec3(shadow)'],
];
export function termProbe(ocean, renderer, scene, camera, spots) {
  const mat = ocean._material;
  const uDbg = { value: 0 };
  const origOBC = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uDbg = uDbg;
    const cases = TERMS.map(([, e], i) => `if (uDbg == ${i + 1}) { gl_FragColor = vec4(${e}, 1.0); return; }`).join('\n');
    sh.fragmentShader = 'uniform int uDbg;\n' + sh.fragmentShader.replace('#ifdef OC_VERTEX_AERIAL\n  C = atmExpose', cases + '\n#ifdef OC_VERTEX_AERIAL\n  C = atmExpose');
  };
  mat.customProgramCacheKey = () => 'ocean-terms-probe';
  mat.needsUpdate = true;
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.FloatType });
  const out = {};
  const px = new Float32Array(4);
  for (let i = 0; i < TERMS.length; i++) {
    uDbg.value = i + 1;
    renderer.setRenderTarget(rt); renderer.render(scene, camera); renderer.setRenderTarget(null);
    for (const [fx, fy] of spots) {
      const x = Math.floor(fx * size.x), y = Math.floor((1 - fy) * size.y);
      renderer.readRenderTargetPixels(rt, x, y, 1, 1, px);
      const key = `${fx},${fy}`;
      (out[key] = out[key] || {})[TERMS[i][0]] = [px[0], px[1], px[2]].map((v) => +v.toPrecision(3));
    }
  }
  mat.onBeforeCompile = origOBC;
  mat.customProgramCacheKey = THREE.ShaderMaterial.prototype.customProgramCacheKey;
  mat.needsUpdate = true;
  rt.dispose();
  return out;
}

// DEV ONLY: force the ocean's own radiance to zero before aerial perspective, to measure the floor
// the atmosphere's in-scatter alone puts under the sea (the "black sea" test).
export function blackSea(ocean) {
  const mat = ocean._material;
  mat.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('C = atmExpose(C * vAerT + vAerS);', 'C = atmExpose(vAerS);').replace('C = applyAerialPerspective(C, P);', 'C = applyAerialPerspective(vec3(0.0), P);'); };
  mat.customProgramCacheKey = () => 'ocean-black-sea';
  mat.needsUpdate = true;
}
