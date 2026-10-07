// Dev stub for src/env/fog.js (shell test harness only; the atmosphere agent owns the real one).
// Same contract: patches THREE.ShaderChunk's fog chunks at import time and exports
// applyAtmosphere(material). The haze is a height-dependent exponential toward U.uFogInscatter.
// When the real fog.js has already patched the chunks (?stubs= naming only some modules), this
// stub leaves them alone and only marks materials fog:true, so they take the real chunk's
// fallback path (with its pre-exposure) instead of fighting over ShaderChunk.
import * as THREE from 'three';
import { U } from '../../src/shared.js';

const OWN_PATCH = !THREE.ShaderChunk.fog_vertex.includes('vFogWorldPos');
if (OWN_PATCH) {
  THREE.ShaderChunk.fog_pars_vertex = /* glsl */`
#ifdef USE_FOG
	varying float vFogDepth;
	varying vec3 vFogWorldPos;
#endif`;
  THREE.ShaderChunk.fog_vertex = /* glsl */`
#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
	vFogWorldPos = cameraPosition + transpose( mat3( viewMatrix ) ) * mvPosition.xyz;
#endif`;
  THREE.ShaderChunk.fog_pars_fragment = /* glsl */`
#ifdef USE_FOG
	uniform vec3 fogColor;
	uniform float fogNear;
	uniform float fogFar;
	varying float vFogDepth;
	varying vec3 vFogWorldPos;
	uniform float uFogDensity;
	uniform float uFogHeightFalloff;
	uniform vec3 uFogInscatter;
#endif`;
  THREE.ShaderChunk.fog_fragment = /* glsl */`
#ifdef USE_FOG
	{
		float h0 = max( cameraPosition.y, 0.0 ), h1 = max( vFogWorldPos.y, 0.0 );
		float k = uFogHeightFalloff;
		float dh = h1 - h0;
		float avg = abs( dh ) > 0.01 ? ( exp( - k * h0 ) - exp( - k * h1 ) ) / ( k * dh ) : exp( - k * h0 );
		float T = exp( - uFogDensity * length( vFogWorldPos - cameraPosition ) * avg );
		gl_FragColor.rgb = gl_FragColor.rgb * T + uFogInscatter * ( 1.0 - T );
	}
#endif`;
}

const FOG_UNIFORMS = { uFogDensity: U.uFogDensity, uFogHeightFalloff: U.uFogHeightFalloff, uFogInscatter: U.uFogInscatter };

export function applyAtmosphere(material) {
  if (material.userData.shellAtmosphere) return material;
  material.userData.shellAtmosphere = true;
  material.fog = true;
  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey === THREE.Material.prototype.customProgramCacheKey
    ? (() => { const s = previous.toString(); return () => s; })()
    : material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    if (OWN_PATCH) Object.assign(shader.uniforms, FOG_UNIFORMS);
  };
  material.customProgramCacheKey = () => `${previousKey()}|shell-atmosphere`;
  return material;
}
