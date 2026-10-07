// DEV STUB (ocean dev page only): stand-in for src/env/fog.js → applyAtmosphere(material).
// Patches a built-in material so its final colour goes through the atmosphere's
// applyAerialPerspective(), with the world position rebuilt from mvPosition (three-r180-api §1.3).
import * as THREE from 'three';

export function makeApplyAtmosphere(atmosphere) {
  return function applyAtmosphere(material) {
    if (material.userData.oceanStubAtmos) return material;
    material.userData.oceanStubAtmos = true;
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, atmosphere.uniforms);
      shader.vertexShader = 'varying vec3 vStubWorldPos;\n' + shader.vertexShader.replace(
        '#include <project_vertex>',
        '#include <project_vertex>\nvStubWorldPos = cameraPosition + transpose( mat3( viewMatrix ) ) * mvPosition.xyz;');
      shader.fragmentShader = 'varying vec3 vStubWorldPos;\n' + atmosphere.glsl + shader.fragmentShader.replace(
        '#include <fog_fragment>',
        'gl_FragColor.rgb = applyAerialPerspective( gl_FragColor.rgb, vStubWorldPos );');
    };
    material.customProgramCacheKey = () => 'ocean-dev-stub-atmos';
    return material;
  };
}
