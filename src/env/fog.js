// Aerial perspective for built-in materials (owner: atmosphere).
//
// Importing this module patches THREE.ShaderChunk's fog chunks. It must run before anything is
// compiled (three-r180-api §1.3: later edits never reach cached programs), so main.js imports it
// first. The patched chunks:
//   - carry the world position in a varying (cameraPosition + transpose(mat3(viewMatrix)) *
//     mvPosition.xyz, valid for Mesh / InstancedMesh / BatchedMesh / SkinnedMesh / Sprite / Points),
//   - in materials passed through applyAtmosphere(): replace the fog mix with
//     applyAerialPerspective() from ATMOS_GLSL (height-dependent per-channel extinction in closed
//     form, in-scatter from the sky-view LUT toward the view direction with its Mie lobe toward
//     the sun, night-aware) and multiply direct light by cloudShadow();
//   - in any other fog:true material: a self-contained fallback (exponential height fog with
//     scene.fog.color as in-scatter, fog.near = extinction, fog.far = the pre-exposure factor),
//     so an unpatched material still fades and stays on the same exposure scale.
// scene.fog must be a THREE.Fog so USE_FOG is defined; Atmosphere creates and drives it.
import * as THREE from 'three';
import { ATMOS_GLSL_CORE, ATMOS_UNIFORMS, ATMOS_VERSION } from './atmosphere.js';
import { ATMOS } from '../config.js';

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
	varying float vFogDepth;
	varying vec3 vFogWorldPos;
	#ifndef ATMOS_AERIAL
		uniform vec3 fogColor;
		uniform float fogNear;
		uniform float fogFar;
	#endif
#endif`;

THREE.ShaderChunk.fog_fragment = /* glsl */`
#ifdef USE_FOG
	#ifdef ATMOS_AERIAL
		#ifdef ATMOS_EXTINCTION_ONLY
			gl_FragColor.rgb = applyAerialTransmittance( gl_FragColor.rgb, vFogWorldPos );
		#else
			gl_FragColor.rgb = applyAerialPerspective( gl_FragColor.rgb, vFogWorldPos );
		#endif
	#else
	{
		float fogK = ${(ATMOS.fogHeightFalloff).toPrecision(8)};
		float fogHa = max( cameraPosition.y, 0.0 ) * fogK;
		float fogHb = max( vFogWorldPos.y, 0.0 ) * fogK;
		float fogDh = fogHb - fogHa;
		float fogM = abs( fogDh ) < 1e-4 ? exp( - fogHa ) : ( exp( - fogHa ) - exp( - fogHb ) ) / fogDh;
		float fogT = exp( - fogNear * length( vFogWorldPos - cameraPosition ) * fogM );
		gl_FragColor.rgb = ( gl_FragColor.rgb * fogT + fogColor * ( 1.0 - fogT ) ) * fogFar;
	}
	#endif
#endif`;

// Diffuse sky light for every built-in PBR material (the modeller's round-3 request, wired by the round-3
// verifier, POLISH-3 §2): three's getIBLIrradiance takes one tap of the PMREM's roughest level, a 33 deg lobe
// narrower than the cosine lobe, so a face toward the brightest sky (twilight glow, horizon band) took too much
// light and one facing away too little. Three taps on a 28.6 deg ring follow the cosine lobe within ~10 %
// (fit and figures: turbine.js IBL_RING, identical text); steeply downward faces keep the single tap. Vessels,
// land, birds, fish and the farm's far turbines now light like the near turbines (turbine.js's own replacement
// finds nothing left to replace). Left as is if r180's chunk text is not found.
THREE.ShaderChunk.envmap_physical_pars_fragment = THREE.ShaderChunk.envmap_physical_pars_fragment.replace(
  'vec4 envMapColor = textureCubeUV( envMap, envMapRotation * worldNormal, 1.0 );', /* glsl */`vec3 tIn = envMapRotation * worldNormal, tIt = normalize(cross(abs(tIn.y) < 0.99 ? vec3(0, 1, 0) : vec3(1, 0, 0), tIn)), tIb = 1.1546 * cross(tIn, tIt), tIc = 2.1137 * tIn - 0.5 * tIb;
vec4 envMapColor = textureCubeUV(envMap, tIn, 1.0);
envMapColor.rgb = mix((textureCubeUV(envMap, tIc + 1.5 * tIb, 1.0).rgb + textureCubeUV(envMap, tIc + tIt, 1.0).rgb + textureCubeUV(envMap, tIc - tIt, 1.0).rgb) / 3.0, envMapColor.rgb, smoothstep(-0.35, -0.75, tIn.y));`);

// Cloud shadow on direct light (sun by day, moon at night) for lit built-in materials.
const CLOUD_SHADOW_GLSL = /* glsl */`
#if defined( USE_FOG ) && defined( ATMOS_AERIAL )
	{
		float atmCS = cloudShadow( vFogWorldPos );
		reflectedLight.directDiffuse *= atmCS;
		reflectedLight.directSpecular *= atmCS;
		#ifdef USE_CLEARCOAT
			clearcoatSpecularDirect *= atmCS;
		#endif
		#ifdef USE_SHEEN
			sheenSpecularDirect *= atmCS;
		#endif
	}
#endif`;

const HOOK = Symbol.for('nj-offshore-wind.atmosphere.hook');

/**
 * Adds aerial perspective (and cloud shadows on direct light) to a built-in material.
 * Works with Standard/Physical/Basic/Lambert/Phong/Toon/Points/Sprite/Line materials, instanced,
 * batched or not. Idempotent; composes with an existing onBeforeCompile (called first) and keeps
 * that hook's program-cache identity.
 * @param {THREE.Material|THREE.Material[]} material
 * @param {object} [opts]
 * @param {boolean} [opts.extinctionOnly] only attenuate (no in-scatter): for additive glows and
 *   lamp sprites. Defaults to true for AdditiveBlending materials.
 * @returns the material
 */
export function applyAtmosphere(material, opts = {}) {
  if (Array.isArray(material)) { material.forEach((m) => applyAtmosphere(m, opts)); return material; }
  if (!material || (material.onBeforeCompile && material.onBeforeCompile[HOOK])) return material;
  const extinctionOnly = opts.extinctionOnly ?? (material.blending === THREE.AdditiveBlending);
  const prevHook = material.onBeforeCompile;
  const prevKey = material.customProgramCacheKey;
  // A material without its own key uses Material.prototype's (the hook's source text): keep that
  // identity by keying on the previous hook's source rather than on this wrapper's.
  const baseKey = prevKey === THREE.Material.prototype.customProgramCacheKey
    ? () => prevHook.toString()
    : () => prevKey.call(material);

  const hook = function (shader, renderer) {
    prevHook.call(this, shader, renderer);
    for (const k in ATMOS_UNIFORMS) shader.uniforms[k] = ATMOS_UNIFORMS[k];
    let fs = shader.fragmentShader;
    if (!fs.includes('#include <fog_pars_fragment>')) return;
    const defines = '#define ATMOS_AERIAL\n' + (extinctionOnly ? '#define ATMOS_EXTINCTION_ONLY\n' : '');
    fs = fs.replace('#include <fog_pars_fragment>', `${defines}#include <fog_pars_fragment>\n${ATMOS_GLSL_CORE}`);
    if (!extinctionOnly && fs.includes('#include <lights_fragment_end>')) {
      fs = fs.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>\n${CLOUD_SHADOW_GLSL}`);
    }
    shader.fragmentShader = fs;
  };
  hook[HOOK] = true;
  material.onBeforeCompile = hook;
  material.customProgramCacheKey = () => `${baseKey()}|${ATMOS_VERSION}${extinctionOnly ? '-ext' : ''}`;
  material.fog = true;
  material.needsUpdate = true;
  return material;
}

/** true if applyAtmosphere() has been applied to this material (and not overwritten since). */
export function hasAtmosphere(material) { return !!(material && material.onBeforeCompile && material.onBeforeCompile[HOOK]); }
