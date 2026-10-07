# three.js r180 (three@0.180.0): API facts for the NJ offshore-wind scene

Everything below was read from the **r180 source files on cdn.jsdelivr.net** (not docs, not the newest release). The riskiest claims were also **run live** against the r180 CDN build in a browser (Chrome 152, ANGLE Metal on an Apple M4, `maxSamples = 4`) on 2026-09-30.

**How each number is labelled**
- **SOURCED**: comes straight from a cited source or file.
- **MEASURED**: a SOURCED subtype. I measured it myself in the r180 live test, and the method is given.
- **DERIVED**: computed from sourced values. The arithmetic or the script is shown.
- **ESTIMATED**: a judgement. What it is based on is stated.

**Version trap (read first).** The three.js wiki Migration Guide is now at r187 ([Migration Guide](https://github.com/mrdoob/three.js/wiki/Migration-Guide)). Several things changed *after* r180. If you copy code from the current docs or examples you may get code that does not match r180:

| Changed after r180 | Release | Effect on us (we pin r180) |
|---|---|---|
| PMREM / indirect-specular / energy-conservation changes | r181 | r180 PBR looks slightly different from the current examples |
| `PCFSoftShadowMap` deprecated for WebGLRenderer | r182 | **Not deprecated in r180**, so no warning |
| `Clock` deprecated in favour of `Timer` | r183 | **Not deprecated in r180** |
| Sky/SkyMesh "legacy gamma correction" removed | r183 | **r180 Sky still has it** (the `pow(texColor, 1/(1.2+1.2*sunfade))` line) |
| Sky `up` uniform removed | r186 | **r180 Sky still has `up`** |
| PMREM rebuilt on cube RTs, `CubeUVReflectionMapping` removed | r187 | r180 PMREM uses CubeUV (mapping 306) |

Source for the whole table: [Migration Guide](https://github.com/mrdoob/three.js/wiki/Migration-Guide), sections 180→181 through 186→187. **SOURCED**

Changes that landed **in or before** r180 and do apply to us:
- **r179:** `Timer` moved into core, so `THREE.Timer`. `examples/jsm/misc/Timer.js` is **gone in r180**: jsdelivr returns "Couldn't find the requested file /examples/jsm/misc/Timer.js". The `reverseDepthBuffer` option was renamed `reversedDepthBuffer`.
- **r180:** `RGBELoader` renamed `HDRLoader`. The shader defines are now `USE_LOGARITHMIC_DEPTH_BUFFER` (was `USE_LOGDEPTHBUF`) and `USE_REVERSED_DEPTH_BUFFER` (was `USE_REVERSEDEPTHBUF`). Any custom GLSL that tests the old define names silently stops working.
- **r175:** the `SMAAPass` constructor lost its `width, height` arguments.

**SOURCED:** [Migration Guide](https://github.com/mrdoob/three.js/wiki/Migration-Guide), plus a 404 check on `https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/misc/Timer.js`.

---

## 1. ShaderChunk: fog, world position and instancing

### 1.1 Verbatim r180 chunks
Sources: `https://cdn.jsdelivr.net/npm/three@0.180.0/src/renderers/shaders/ShaderChunk/<name>.glsl.js`. **SOURCED**

`fog_pars_vertex`
```glsl
#ifdef USE_FOG

	varying float vFogDepth;

#endif
```
`fog_vertex`
```glsl
#ifdef USE_FOG

	vFogDepth = - mvPosition.z;

#endif
```
`fog_pars_fragment`
```glsl
#ifdef USE_FOG

	uniform vec3 fogColor;
	varying float vFogDepth;

	#ifdef FOG_EXP2

		uniform float fogDensity;

	#else

		uniform float fogNear;
		uniform float fogFar;

	#endif

#endif
```
`fog_fragment`
```glsl
#ifdef USE_FOG

	#ifdef FOG_EXP2

		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );

	#else

		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );

	#endif

	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );

#endif
```
`begin_vertex`
```glsl
vec3 transformed = vec3( position );

#ifdef USE_ALPHAHASH

	vPosition = vec3( position );

#endif
```
`project_vertex` (this is where the instancing and batching matrices are applied)
```glsl
vec4 mvPosition = vec4( transformed, 1.0 );

#ifdef USE_BATCHING

	mvPosition = batchingMatrix * mvPosition;

#endif

#ifdef USE_INSTANCING

	mvPosition = instanceMatrix * mvPosition;

#endif

mvPosition = modelViewMatrix * mvPosition;

gl_Position = projectionMatrix * mvPosition;
```
`worldpos_vertex` (**conditional**: `worldPosition` only exists under these defines)
```glsl
#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0

	vec4 worldPosition = vec4( transformed, 1.0 );

	#ifdef USE_BATCHING

		worldPosition = batchingMatrix * worldPosition;

	#endif

	#ifdef USE_INSTANCING

		worldPosition = instanceMatrix * worldPosition;

	#endif

	worldPosition = modelMatrix * worldPosition;

#endif
```
`batching_vertex`
```glsl
#ifdef USE_BATCHING
	mat4 batchingMatrix = getBatchingMatrix( getIndirectIndex( gl_DrawID ) );
#endif
```

**Instancing in r180 has no chunk of its own.** The files `instancing_pars_vertex` and `instancing_vertex` do not exist in r180 (jsdelivr returns "Couldn't find the requested file"). The attributes are declared in the `WebGLProgram` vertex prefix ([WebGLProgram.js](https://cdn.jsdelivr.net/npm/three@0.180.0/src/renderers/webgl/WebGLProgram.js)) **SOURCED**:
```js
'#ifdef USE_INSTANCING',
'	attribute mat4 instanceMatrix;',
'#endif',
'#ifdef USE_INSTANCING_COLOR',
'	attribute vec3 instanceColor;',
'#endif',
```
The same prefix also declares `uniform mat4 modelMatrix, modelViewMatrix, projectionMatrix, viewMatrix; uniform mat3 normalMatrix; uniform vec3 cameraPosition; uniform bool isOrthographic;`. So `cameraPosition` and `viewMatrix` are available in **every** built-in and ShaderMaterial vertex shader (not in RawShaderMaterial).

The instance normal transform (`defaultnormal_vertex`, excerpt, **SOURCED**):
```glsl
#ifdef USE_INSTANCING
	// this is in lieu of a per-instance normal-matrix
	// shear transforms in the instance matrix are not supported
	mat3 im = mat3( instanceMatrix );
	transformedNormal /= vec3( dot( im[ 0 ], im[ 0 ] ), dot( im[ 1 ], im[ 1 ] ), dot( im[ 2 ], im[ 2 ] ) );
	transformedNormal = im * transformedNormal;
```
This means **no shear in instance matrices**. Non-uniform scale is fine.

### 1.2 Built-in materials apply fog **after** tone mapping and colour-space conversion
This is the tail of the r180 `meshphysical` fragment shader, taken from `build/three.module.js`. **SOURCED:**
```glsl
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
```
The fog colour uniform is filled like this (WebGLMaterials `refreshFogUniforms`):
```js
fog.color.getRGB( uniforms.fogColor.value, getUnlitUniformColorSpace( renderer ) );
```
`getUnlitUniformColorSpace` returns `renderer.outputColorSpace` (sRGB) when drawing to the canvas, and the linear working space when drawing to a render target. **SOURCED:** `build/three.core.js`.

`toneMapping` is applied only when the current render target is `null` or an XR target, and output is `LinearSRGBColorSpace` for any other render target. **SOURCED:** WebGLRenderer `setProgram`:
```js
const colorSpace = ( _currentRenderTarget === null ) ? _this.outputColorSpace : ( _currentRenderTarget.isXRRenderTarget === true ? _currentRenderTarget.texture.colorSpace : LinearSRGBColorSpace );
...
if ( material.toneMapped ) {
	if ( _currentRenderTarget === null || _currentRenderTarget.isXRRenderTarget === true ) {
		toneMapping = _this.toneMapping;
```
**What this means (DERIVED from the above):**
- **Rendering straight to the canvas:** fog is mixed into a pixel that is already tone-mapped and sRGB-encoded, and the fog colour itself is never tone-mapped.
- **Rendering through EffectComposer (RenderPass → … → OutputPass):** everything, fog included, is mixed in linear HDR and tone-mapped once in OutputPass.

**Use the composer path** so that fog, sky and ocean go through one tone curve. The fog colour must then be chosen as **linear HDR radiance** matching the sky near the horizon (roughly 1.0–1.9 linear for Sky.js, §5.3), not as a display colour.

### 1.3 Patching fog globally for every built-in material
`ShaderChunk` is a plain object literal in `build/three.module.js` (`const ShaderChunk = { alphahash_fragment: …, … }`), exported as `ShaderChunk`. `#include` is resolved **at program-compile time** by reading it:
```js
function includeReplacer( match, include ) {
	let string = ShaderChunk[ include ];
```
**SOURCED:** [WebGLProgram.js](https://cdn.jsdelivr.net/npm/three@0.180.0/src/renderers/webgl/WebGLProgram.js).

Mutating it through the ES-module namespace (`THREE.ShaderChunk.fog_fragment = '…'`) works. A namespace object's *bindings* are read-only, but the exported object is not frozen. **MEASURED:** `Object.isFrozen(THREE.ShaderChunk) === false`, and `fog_fragment` is `writable: true`. r180's own `examples/jsm/csm/CSM.js` does exactly this: `ShaderChunk.lights_fragment_begin = CSMShader.lights_fragment_begin;`.

**Install the patch before the first render or compile. Changes made afterwards are ignored for already-cached programs.** The program cache key for built-in materials is `shaderID + parameters` and contains no source hash ([WebGLPrograms.js](https://cdn.jsdelivr.net/npm/three@0.180.0/src/renderers/webgl/WebGLPrograms.js) `getProgramCacheKey`). **MEASURED** (probe below):
- Mutating the chunk after compile, then setting `material.needsUpdate = true`: output unchanged.
- A brand-new material with the same key: output unchanged (it reuses the cached program).
- Only a material whose key differs (an extra define) picked up the new chunk.

**Verified patch** (world position works for Mesh, InstancedMesh, BatchedMesh, SkinnedMesh, Sprite, Points and Line). It rebuilds world position from `mvPosition`, which already contains the batching, instance, model and view transforms. For a rigid view matrix `view = R(world − c)`, so `world = c + Rᵀ·view`.
```js
import * as THREE from 'three';
// MUST run before renderer.render / renderer.compile / composer.render
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
	varying float vFogDepth;
	varying vec3 vFogWorldPos;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;   // re-purposed: extinction coefficient (1/m)
		uniform float fogFar;    // re-purposed: height falloff (1/m)
	#endif
#endif`;
THREE.ShaderChunk.fog_fragment = /* glsl */`
#ifdef USE_FOG
	float fogFactor = 1.0 - exp( - fogNear * vFogDepth );
	fogFactor *= exp( - fogFar * max( vFogWorldPos.y, 0.0 ) );
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, clamp( fogFactor, 0.0, 1.0 ) );
#endif`;
scene.fog = new THREE.Fog( 0xc8d4e0, 8e-5, 1.5e-3 ); // .near/.far now carry the two coefficients (ESTIMATED starting values)
```
**MEASURED verification** (r180 CDN, live):
- The patched chunks compiled with **zero** errors or warnings in MeshPhysical (clearcoat), MeshStandard, MeshLambert, MeshBasic, MeshPhong, MeshToon, MeshMatcap, ShadowMaterial, Sprite, Points, LineBasic, LineDashed and a `ShaderMaterial({ fog:true })`.
- That covered InstancedMesh (with `setColorAt`), BatchedMesh, PCFSoft shadows, both `THREE.Fog` and `THREE.FogExp2`, and `logarithmicDepthBuffer: true`.
- The world-position probe (a fog chunk writing `vFogWorldPos` into a FloatType RT) returned `(1234.53, 56.28, −789.00)` for an instance at `(1234.5, 56.25, −789)`. InstancedMesh, BatchedMesh and Sprite gave identical results. The 0.03 m offset is the half-pixel sample offset: DERIVED, 89 m × 2·tan(5°)/256 px × 0.5 px = 0.030 m.

**Why not reuse `worldPosition` from `worldpos_vertex`?** It is only declared under `USE_ENVMAP / DISTANCE / USE_SHADOWMAP / USE_TRANSMISSION / spot coords` (see 1.1), so it would fail to compile in some materials. Sprites never include it at all.

**Extra fog uniforms (sun direction for an in-scatter glow, and so on).** A chunk may declare any uniform. A built-in material that has no value for it just reads 0 and throws no error. Two ways to feed them:
1. **Re-purpose the built-in fog uniforms.** With `THREE.Fog` you get `fogColor`, `fogNear` and `fogFar`. The renderer refreshes these on every material with `fog:true`, including ShaderMaterials (WebGLRenderer: `if ( fog && material.fog === true ) { materials.refreshFogUniforms( m_uniforms, fog ); }`). This needs no per-material work. **SOURCED.**
2. **Share uniform objects through `onBeforeCompile`** (§2). Wrap each material's hook so it does `Object.assign(shader.uniforms, sharedFogUniforms)`. The objects are shared by reference, so one `.value` write updates every material.

Custom ShaderMaterials (ocean, sky) need `fog: true`, uniforms merged with `THREE.UniformsLib.fog`, and the `fog_*` includes. They must also define `vec4 mvPosition` before `#include <fog_vertex>`.

---

## 2. `onBeforeCompile` and `customProgramCacheKey` in r180
**SOURCED:** [Material.js](https://cdn.jsdelivr.net/npm/three@0.180.0/src/materials/Material.js):
```js
onBeforeCompile( /* shaderobject, renderer */ ) {}
customProgramCacheKey() {
	return this.onBeforeCompile.toString();
}
```
Order of operations in WebGLRenderer `getProgram` ([WebGLRenderer.js](https://cdn.jsdelivr.net/npm/three@0.180.0/src/renderers/WebGLRenderer.js)), **SOURCED**:
```js
const parameters = programCache.getParameters( material, lights.state, shadowsArray, scene, object );
const programCacheKey = programCache.getProgramCacheKey( parameters );   // key computed FIRST
...
let program = programs.get( programCacheKey );        // per-material map
...
} else {
	parameters.uniforms = programCache.getUniforms( material );
	material.onBeforeCompile( parameters, _this );
	program = programCache.acquireProgram( parameters, programCacheKey ); // reuses ANY program with same key
	programs.set( programCacheKey, program );
	materialProperties.uniforms = parameters.uniforms;
}
```
What this means (DERIVED from the code above):
- **The key is computed before `onBeforeCompile` runs.** Anything the hook changes (source strings, `shader.defines`) is not in the key. `parameters.defines` *is* `material.defines` by reference (`defines: material.defines` in `getParameters`), so mutating it also mutates the material.
- `acquireProgram` scans **all** programs for an equal key. Two materials of the same type whose hooks have **identical source text** (for example closures over different constants) share **one** program, which is the wrong shader for one of them. Override `customProgramCacheKey()` to return something that encodes those constants.
- `onBeforeCompile` still runs **once per material** even when the program is reused. So `parameters.uniforms`, a fresh `UniformsUtils.clone(ShaderLib[id].uniforms)` for built-ins or `material.uniforms` for ShaderMaterial, becomes that material's live uniform object.
- `parameters.vertexShader` and `.fragmentShader` still contain unresolved `#include <…>` lines when the hook sees them (includes resolve later, inside `WebGLProgram`). String-replace the include lines, for example `'#include <fog_fragment>'`.

**Adding uniforms (canonical pattern):**
```js
const shared = { uTime: { value: 0 }, uSunDir: { value: new THREE.Vector3() } };
mat.onBeforeCompile = ( shader ) => {
	Object.assign( shader.uniforms, shared );              // same objects => one update propagates
	shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader.replace( '#include <begin_vertex>', '#include <begin_vertex>\n/* ... */' );
	mat.userData.shader = shader;                          // optional handle
};
mat.customProgramCacheKey = () => 'turbine-rotor-v1';    // explicit, stable key
```

**Shadow-pass gotcha (SOURCED, WebGLShadowMap `getDepthMaterial`).** The shadow pass renders with `object.customDepthMaterial` if set, otherwise a shared internal `MeshDepthMaterial({ depthPacking: RGBADepthPacking })`. Vertex animation added through `onBeforeCompile` (rotor spin in the shader, for example) does **not** move the shadow unless you also give the object a `customDepthMaterial` with the same patch.

**CSM conflict (SOURCED, CSM.js).** `csm.setupMaterial(material)` *assigns* `material.onBeforeCompile = function (shader) {…}`, which overwrites any existing hook. If you use CSM, call `setupMaterial` first and then wrap its hook.

---

## 3. Tone mapping, OutputPass, EffectComposer, SMAA, bloom

### 3.1 Availability (MEASURED on r180)
| Constant | Value |
|---|---|
| `ACESFilmicToneMapping` | 4 |
| `AgXToneMapping` | 6 |
| `NeutralToneMapping` | 7 |
| `CustomToneMapping` | 5 |

- Renderer defaults: `toneMapping = 0` (NoToneMapping), `toneMappingExposure = 1`, `outputColorSpace = 'srgb'`.
- `ColorManagement.enabled = true`, and the working space is `'srgb-linear'`.

Every operator multiplies by `toneMappingExposure` first (ACES uses `/0.6`). The full GLSL is in `tonemapping_pars_fragment` ([source](https://cdn.jsdelivr.net/npm/three@0.180.0/src/renderers/shaders/ShaderChunk/tonemapping_pars_fragment.glsl.js)):
```glsl
vec3 ACESFilmicToneMapping( vec3 color ) { ... color *= toneMappingExposure / 0.6; ... }
vec3 AgXToneMapping( vec3 color ) { ... color *= toneMappingExposure; ... }
vec3 NeutralToneMapping( vec3 color ) { ... color *= toneMappingExposure; ... }
vec3 CustomToneMapping( vec3 color ) { return color; }
```
For a custom curve, set `renderer.toneMapping = THREE.CustomToneMapping` and replace that `CustomToneMapping` line in `ShaderChunk.tonemapping_pars_fragment` **before first compile**. OutputPass `#include`s the same chunk, so the custom curve reaches it too.

### 3.2 The curves, evaluated (DERIVED)
The three operators were ported line by line to JS from the r180 GLSL, at exposure 1, output through the sRGB OETF.

| Linear grey in | AgX (0–255) | ACES | Neutral |
|---|---|---|---|
| 0.05 | 70 | 50 | 34 |
| 0.18 | 128 | 127 | 105 |
| 0.50 | 174 | 197 | 181 |
| 1.0 | 202 | 226 | 240 |
| 2.0 | 224 | 242 | 250 |
| 5.0 | 242 | 251 | 254 |
| 16.0 | 254 | 255 | 255 |

Linear grey needed to reach display values 118 / 200 / 235 / 250:
- AgX: 0.147 / 0.948 / 3.26 / 10.1
- ACES: 0.159 / 0.530 / 1.38 / 4.25
- Neutral: 0.221 / 0.618 / 0.900 / 1.87

**How each operator handles saturated yellow.** Test colour: an ESTIMATED "safety yellow" paint with sRGB (247,181,0), which is linear (0.930, 0.462, 0), lit at normal incidence by sun E=5, so L = albedo·5/π:

| Operator | Display result |
|---|---|
| AgX | (220,189,122), noticeably desaturated toward beige |
| ACES | (242,217,94) |
| Neutral | (248,188,75), shifts orange |

The sunlit transition piece in `reference/ref-1.png` measures **≈ (245,216,104)** on its lit side and **(190,157,33)** on its shade side. **MEASURED:** pixel sampling, x 346–366, y 312–342. **ACES is the closest match.** This is ESTIMATED, because the paint albedo is itself an estimate.

### 3.3 OutputPass (verbatim core, SOURCED)
Source: [OutputPass.js](https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/postprocessing/OutputPass.js).
```js
this.uniforms[ 'toneMappingExposure' ].value = renderer.toneMappingExposure;
if ( this._outputColorSpace !== renderer.outputColorSpace || this._toneMapping !== renderer.toneMapping ) {
	...
	if ( ColorManagement.getTransfer( this._outputColorSpace ) === SRGBTransfer ) this.material.defines.SRGB_TRANSFER = '';
	if ( this._toneMapping === LinearToneMapping ) this.material.defines.LINEAR_TONE_MAPPING = '';
	...
	else if ( this._toneMapping === ACESFilmicToneMapping ) this.material.defines.ACES_FILMIC_TONE_MAPPING = '';
	else if ( this._toneMapping === AgXToneMapping ) this.material.defines.AGX_TONE_MAPPING = '';
	else if ( this._toneMapping === NeutralToneMapping ) this.material.defines.NEUTRAL_TONE_MAPPING = '';
```
The fragment shader ([OutputShader.js](https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/shaders/OutputShader.js)) is `texture → <ToneMapping>(rgb) → sRGBTransferOETF`.

- It has **no dithering**. Half-float sky gradients get quantised to 8-bit, which risks banding in the hazy sky. **ESTIMATED:** add ±0.5/255 triangular noise in a final ShaderPass after OutputPass, or inside the sky shader.
- OutputPass reads `renderer.toneMapping` and `renderer.toneMappingExposure`, so you keep setting those on the renderer.
- **RenderPass output is linear.** RenderPass draws into `readBuffer`, which is a render target, so every material compiles with NoToneMapping and linear output (see §1.2). Per-material `toneMapped:false` has **no effect** on the composer path; everything is tone-mapped once in OutputPass.

### 3.4 EffectComposer: HalfFloat and MSAA (SOURCED, verbatim excerpt)
Source: [EffectComposer.js](https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/postprocessing/EffectComposer.js).
```js
constructor( renderer, renderTarget ) {
	this._pixelRatio = renderer.getPixelRatio();
	if ( renderTarget === undefined ) {
		const size = renderer.getSize( new Vector2() );
		...
		renderTarget = new WebGLRenderTarget( this._width * this._pixelRatio, this._height * this._pixelRatio, { type: HalfFloatType } );
	} else {
		this._width = renderTarget.width;
		this._height = renderTarget.height;
	}
	this.renderTarget1 = renderTarget;
	this.renderTarget2 = renderTarget.clone();
	...
	this.clock = new Clock();
```
- **HalfFloat is already the default. MSAA is opt-in:**
  ```js
  new EffectComposer(renderer, new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: 4 }))
  ```
  `clone()` copies `samples`. **MEASURED:** `renderTarget1.samples === renderTarget2.samples === 4`, type 1016 (HalfFloatType).
- **Size gotcha (DERIVED from the code).** With a custom RT, `_width` is the RT's *pixel* width, but `addPass` and `setSize` multiply by `_pixelRatio` again. Always call `composer.setPixelRatio(dpr); composer.setSize(cssW, cssH)` right after construction and on resize, passing **CSS** pixels.
- **Parity (DERIVED).** RenderPass writes into `readBuffer` with `needsSwap=false`. OutputPass and SMAAPass have `needsSwap=true` (inherited from `Pass`), UnrealBloomPass has `needsSwap=false`. With an odd number of swapping passes per frame, RenderPass alternates between rt1 and rt2 every frame, so both must be MSAA. That is why the clone carrying `samples` matters.
- **Memory (DERIVED).** Per HalfFloat RGBA RT, 2560×1440 × 8 B = 29.5 MB. Its ×4 MSAA renderbuffer adds 118 MB. With two RTs that is ≈ 295 MB plus depth. Cap `devicePixelRatio`, for example at `Math.min(devicePixelRatio, 1.5)`.
- **First frame.** The first `composer.render` of a 22-program scene took **7.2 s**. **MEASURED:** Apple M4 / ANGLE Metal. Pre-warm with `await renderer.compileAsync(scene, camera)`, which exists in r180 and uses `KHR_parallel_shader_compile` when available.

### 3.5 SMAAPass and UnrealBloomPass signatures (SOURCED)
- `new SMAAPass()` takes **no arguments** in r180 (`constructor( ) {`). It uses HalfFloat edge and weight targets, and `setSize` is called by the composer. The r180 official example orders passes as `RenderPass → SMAAPass → OutputPass` ([example](https://raw.githubusercontent.com/mrdoob/three.js/r180/examples/webgl_postprocessing_smaa.html)).
  - SMAA edge detection is colour-based with `SMAA_THRESHOLD 0.1` ([SMAAShader.js](https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/shaders/SMAAShader.js)). Before OutputPass that threshold runs on linear HDR values; after OutputPass it runs on display values, which is what SMAA was designed for. ESTIMATED: prefer `… → OutputPass → SMAAPass`.
  - Both orders work, because the SMAA blend shader writes raw values and does not re-encode. If MSAA ×4 is on, SMAA is optional.
- `new UnrealBloomPass( resolution /*Vector2*/, strength = 1, radius, threshold )`, with `needsSwap = false`. It adds bloom onto `readBuffer`. The threshold is compared against `luminance(texel)` of the **linear HDR** input (LuminosityHighPassShader). A threshold ≈ 1.5–3 bloom-affects only the sun glint and specular highlights (ESTIMATED from the Sky/sea radiances in §5.3). The resolution argument only sets the initial size; `composer.addPass` calls `setSize`.

---

## 4. PMREMGenerator
### 4.1 Signatures (SOURCED)
Source: [PMREMGenerator.js](https://cdn.jsdelivr.net/npm/three@0.180.0/src/extras/PMREMGenerator.js).
```js
fromScene( scene, sigma = 0, near = 0.1, far = 100, options = {} ) {
	const { size = 256, position = _origin } = options;
	...
	const cubeUVRenderTarget = this._allocateTargets();   // NEW render target every call
fromEquirectangular( equirectangular, renderTarget = null )
fromCubemap( cubemap, renderTarget = null )             // can REUSE a target
compileCubemapShader(); compileEquirectangularShader(); dispose();
```
- `fromScene` forces NoToneMapping while it renders.
- It is reversed-depth aware: it clears depth first when `getReversed()` is true.
- It allocates a new `PerspectiveCamera`, `MeshBasicMaterial` and `BoxGeometry` on every call (disposed afterwards), so each call produces some garbage.

### 4.2 Cost
| Item | Value | Label |
|---|---|---|
| Output RT for size 256 | 768 × 1024, HalfFloat, mapping 306 (CubeUV) | **MEASURED** |
| Memory, one RT | 768·1024·8 B = **6.3 MB**, doubled by the ping-pong RT | DERIVED |
| Blur draws for size 256 | `lodMax = log2(256) = 8`; `totalLods = 8−4+1+6 = 11`; 10 × 2 half-blurs = **20 draws** + 6 cube-face scene renders | DERIVED |
| First `fromScene` call | **880 ms** (includes shader compile) | MEASURED |
| `fromScene` size 256, repeat calls | **15–90 ms** (8 runs, noisy) | MEASURED |
| `fromScene` size 64 / 128 / 512 | 27–130 / 137–160 / 64–138 ms | MEASURED |
| CubeCamera(256, HalfFloat) + `fromCubemap(tex, reusedTarget)` | **13–48 ms**; same RT object returned each time | MEASURED |

All MEASURED rows: live r180, synchronised with `gl.readPixels`, Apple M4 / ANGLE Metal. Budget ≥ 15–50 ms per update and never run it every frame.

### 4.3 Recommended pattern when the sun moves
**Official r180 pattern** ([webgl_shaders_ocean.html @ r180](https://raw.githubusercontent.com/mrdoob/three.js/r180/examples/webgl_shaders_ocean.html), verbatim):
```js
const pmremGenerator = new THREE.PMREMGenerator( renderer );
const sceneEnv = new THREE.Scene();
let renderTarget;
function updateSun() {
	...
	sky.material.uniforms[ 'sunPosition' ].value.copy( sun );
	water.material.uniforms[ 'sunDirection' ].value.copy( sun ).normalize();
	if ( renderTarget !== undefined ) renderTarget.dispose();
	sceneEnv.add( sky );
	renderTarget = pmremGenerator.fromScene( sceneEnv );
	scene.add( sky );
	scene.environment = renderTarget.texture;
}
```
`sceneEnv.add(sky)` *moves* the sky out of the main scene; an Object3D has one parent.

**Allocation-free variant (verified).** Keep one `PMREMGenerator`, one `WebGLCubeRenderTarget` and one PMREM target. Put a *second* Sky instance, sharing the same uniforms object, in an env-only scene:
```js
const pmrem = new THREE.PMREMGenerator( renderer );
const cubeRT = new THREE.WebGLCubeRenderTarget( 256, { type: THREE.HalfFloatType } );
const cubeCam = new THREE.CubeCamera( 1, 100000, cubeRT );
const envSky = new Sky(); envSky.material.uniforms = sky.material.uniforms; envSky.scale.setScalar( 1000 );
const envScene = new THREE.Scene(); envScene.add( envSky );
cubeCam.update( renderer, envScene );
let envRT = pmrem.fromCubemap( cubeRT.texture );          // allocate once
scene.environment = envRT.texture;
function refreshEnv() {                                  // call only when the sun moved > ~0.5 deg (ESTIMATED threshold)
	cubeCam.update( renderer, envScene );
	pmrem.fromCubemap( cubeRT.texture, envRT );            // reuses envRT
}
```
Keep the full-resolution analytic Sky mesh as the visible background. Use the PMREM only for `scene.environment`, and attenuate it with `scene.environmentIntensity`, which exists in r180 (`this.environmentIntensity = 1`).

---

## 5. `Sky.js` (examples/jsm/objects/Sky.js) in r180
### 5.1 Uniforms and defaults (verbatim, SOURCED)
Source: [Sky.js](https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/objects/Sky.js).
```js
uniforms: {
	'turbidity': { value: 2 },
	'rayleigh': { value: 1 },
	'mieCoefficient': { value: 0.005 },
	'mieDirectionalG': { value: 0.8 },
	'sunPosition': { value: new Vector3() },
	'up': { value: new Vector3( 0, 1, 0 ) }
},
```
The material is `ShaderMaterial({ side: BackSide, depthWrite: false })` on a `BoxGeometry(1,1,1)`.

### 5.2 What its output represents (SOURCED)
The vertex shader forces the far plane: `gl_Position.z = gl_Position.w; // set z to camera.far`. The fragment shader ends with:
```glsl
vec3 texColor = ( Lin + L0 ) * 0.04 + vec3( 0.0, 0.0003, 0.00075 );
vec3 retColor = pow( texColor, vec3( 1.0 / ( 1.2 + ( 1.2 * vSunfade ) ) ) );
gl_FragColor = vec4( retColor, 1.0 );
#include <tonemapping_fragment>
#include <colorspace_fragment>
```
- **It does include `tonemapping_fragment` and `colorspace_fragment`.** Straight to the canvas it is tone-mapped and sRGB-encoded. Into a render target (the composer, a PMREM, a CubeCamera or a mirror RT) it writes **linear HDR**, which is consistent on both paths.
- The `pow(…, 1/(1.2+1.2·sunfade))` is the "legacy gamma" that r183 removed. It is present in r180.
- `vSunfade = 1.0 - clamp( 1.0 - exp( ( sunPosition.y / 450000.0 ) ), 0.0, 1.0 )`. The official examples pass a **unit** `sunPosition` (`sun.setFromSphericalCoords( 1, phi, theta )`), which makes vSunfade ≈ 1 for all elevations (DERIVED: exp(y/450000) ≈ 1 for |y| ≤ 1). Keep a unit vector to match the examples' look.

### 5.3 Sky.js absolute radiance (DERIVED)
Method: the r180 shader was ported line by line to JS (script `calc/sky.mjs`, not included), using a unit `sunPosition` and linear output.

| Settings | Sun elevation | Zenith | Horizon, 90° from sun | Horizon, toward sun |
|---|---|---|---|---|
| defaults T2 R1 | 40°–45° | (0.42,0.69,1.09) | (1.74,2.05,2.14) | (2.34,2.68,2.74) |
| ocean example T10 R2 | 45° | (0.63,1.02,1.54) | (1.72,1.89,1.99) | – |
| hazy T6 R1.2 M0.008 G0.85 | 40° | (0.44,0.72,1.14) | (1.43,1.70,1.85) | (2.20,2.45,2.54) |

Cosine-integrated **sky irradiance** on a horizontal plane (DERIVED, numerical integration of the same port, luminance-weighted Rec.709):
- defaults at 40°: (1.76, 2.78, 4.14), which is ≈ **2.7**
- hazy at 40°: (2.11, 3.27, 4.75), which is ≈ **3.1**

**Matching `ref-1.png`.** Measured pixels: horizon sky (228,235,243) and top of frame (169,206,239). Fitting the r180 curves to the hazy-40° sky gives (DERIVED fit, `calc/fit.mjs`):
- ACES: exposure **≈ 0.89**, rms error 9.4 in 8-bit units.
- AgX: exposure **≈ 1.74**, rms 12.9.
- Neutral: exposure 1.41, rms 6.1. This is the best sky colour, but whites clip, see §8.

The official r180 sky and ocean examples use ACES with exposure 0.5 ([example](https://raw.githubusercontent.com/mrdoob/three.js/r180/examples/webgl_shaders_sky.html)), which renders darker than our reference.

### 5.4 Sky.js with `reversedDepthBuffer` (MEASURED bug; fix is one line)
With `reversedDepthBuffer:true`, far = 0, so `z = w` maps to the **near** plane. If the Sky draws *after* an opaque object, it overwrites it. The opaque sort is groupOrder → renderOrder → material id → z.
- **MEASURED:** red box created before the Sky, reversed depth, `sky.renderOrder = 0` → pixel (255,255,255): **the sky covered the box**.
- With `sky.renderOrder = -1` → box visible. Normal depth → box visible either way.
- **Always set `sky.renderOrder = -1`.** It is harmless without reversed depth.

---

## 6. InstancedMesh, BatchedMesh and MeshPhysicalMaterial
- **`InstancedMesh(geometry, material, count)`** (SOURCED, `build/three.core.js`):
  - `instanceMatrix` is an `InstancedBufferAttribute(Float32Array(count*16), 16)`.
  - `instanceColor` starts `null`. `setColorAt` creates it lazily, filled with 1s:
    ```js
    setColorAt( index, color ) {
    	if ( this.instanceColor === null ) {
    		this.instanceColor = new InstancedBufferAttribute( new Float32Array( this.instanceMatrix.count * 3 ).fill( 1 ), 3 );
    	}
    	color.toArray( this.instanceColor.array, index * 3 );
    }
    setMatrixAt( index, matrix ) { matrix.toArray( this.instanceMatrix.array, index * 16 ); }
    ```
  - After edits, set `mesh.instanceMatrix.needsUpdate = true` and `mesh.instanceColor.needsUpdate = true`.
  - The instance colour multiplies the material colour, because `USE_COLOR` is defined when `instancingColor` is on.
  - Calling `setColorAt` for the first time after first render forces a program switch (recompile). Call it before the first render.
- **Culling (SOURCED, `Frustum.intersectsObject`).** `if ( object.boundingSphere === null ) object.computeBoundingSphere();`. An InstancedMesh's sphere is computed **once**, lazily. If instances move later, call `mesh.computeBoundingSphere()` or set `frustumCulled = false`.
- **Shadows.** `castShadow` and `receiveShadow` work with InstancedMesh plus MeshPhysicalMaterial. **MEASURED:** compiled and rendered with PCFSoft, no errors. Instance matrices reach the depth pass through `project_vertex`.
  - Default **`shadowSide` flips faces**: `{ FrontSide: BackSide, BackSide: FrontSide, DoubleSide: DoubleSide }` (SOURCED, WebGLShadowMap.js).
  - Single-sided open meshes (thin blade shells) cast shadow only from back faces. Use closed geometry or set `material.shadowSide = THREE.DoubleSide`.
- **Update cost.**
  - **MEASURED:** CPU `setMatrixAt` × 10,000 = **0.93 ms**.
  - **MEASURED:** a render with a full 10k-matrix re-upload took 30 ms against 9.4 ms without it, noisy because the timing includes a readPixels sync.
  - For our ~16–60 turbine instances the per-frame data is ≤ 60 × 64 B = 3.8 KB (DERIVED), which is negligible.
  - For per-frame updates use `instanceMatrix.setUsage(THREE.DynamicDrawUsage)`. Partial uploads use `attribute.addUpdateRange(start, count)` and `clearUpdateRanges()`, both present in r180.
- **BatchedMesh** is available in r180. Signature: `new BatchedMesh( maxInstanceCount, maxVertexCount, maxIndexCount = maxVertexCount * 2, material )`. Methods: `addGeometry`, `addInstance(geometryId)`, `setMatrixAt`, `setColorAt`, `setVisibleAt`, `setGeometryIdAt`, `deleteInstance`, `optimize`, `setInstanceCount`, `setGeometrySize`. It has `perObjectFrustumCulled = true` and `sortObjects = true`.
  - One material for all geometries; the geometries must share the same attribute set.
  - Since r166 you must call `addInstance` after `addGeometry` ([Migration Guide](https://github.com/mrdoob/three.js/wiki/Migration-Guide)).
  - **MEASURED:** a BatchedMesh with MeshStandardMaterial and `setColorAt` compiled and rendered.
- **MeshPhysicalMaterial.** `STANDARD` and `PHYSICAL` are defined. Clearcoat and sheen work with instancing. Avoid `transmission > 0`: it triggers an extra full-scene transmission render.

---

## 7. DirectionalLight shadows and CSM in r180
- **Shadow map types in r180.** `BasicShadowMap`, `PCFShadowMap` (1, the default), `PCFSoftShadowMap` (2), `VSMShadowMap` (3). **MEASURED:** `renderer.shadowMap.type === 1` by default.
  - **None are deprecated in r180.** PCFSoft deprecation is r182 (SOURCED, Migration Guide). **MEASURED:** no warning with PCFSoftShadowMap.
  - From `shadowmap_pars_fragment` (SOURCED): **PCF** takes 17 taps scaled by `shadowRadius`. **PCF_SOFT** takes 9 bilinear taps and **ignores `shadow.radius`**. **VSM** uses `radius` and `blurSamples`, and also renders receivers into the shadow map (`object.receiveShadow && type === VSMShadowMap`).
- **Storage.** The shadow map is an RGBA8 target with `NearestFilter`, packed depth (`MeshDepthMaterial({ depthPacking: RGBADepthPacking })`). It is not a hardware depth-compare texture.
- **LightShadow defaults** (SOURCED, [LightShadow.js](https://cdn.jsdelivr.net/npm/three@0.180.0/src/lights/LightShadow.js), [DirectionalLightShadow.js](https://cdn.jsdelivr.net/npm/three@0.180.0/src/lights/DirectionalLightShadow.js)):

  | Property | Default |
  |---|---|
  | `intensity` | 1 |
  | `bias` | 0 |
  | `normalBias` | 0 |
  | `radius` | 1 |
  | `blurSamples` | 8 |
  | `mapSize` | 512×512 |
  | `camera` | `OrthographicCamera(-5, 5, 5, -5, 0.5, 500)` |
- **Bias semantics (SOURCED):**
  - `bias` is added in normalised shadow-depth units: `shadowCoord.z += shadowBias;`. For an orthographic shadow camera one unit equals `(far − near)` metres, so `bias = −0.0002` with a 1000 m depth range is 0.2 m (DERIVED).
  - `normalBias` is in **world metres** along the world normal: `shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * directionalLightShadows[ i ].shadowNormalBias, 0 );`.
  - **Sign flips with reversed depth.** The compare is `step( depth, compare )` under `USE_REVERSED_DEPTH_BUFFER` and `step( compare, depth )` otherwise, and the shadow matrix uses a z-row of `(0,0,1,0)` instead of `(0,0,0.5,0.5)`. So an acne-fixing bias is **negative in normal depth and positive in reversed depth** (DERIVED from those two lines).
- **Frustum setup for this scene (ESTIMATED).** Fit one DirectionalLight shadow to the **hero turbine only**. Distant turbines' shadows are sub-pixel.
  ```js
  const s = sun.shadow; s.mapSize.set(4096, 4096);
  s.camera.left = -160; s.camera.right = 160; s.camera.top = 160; s.camera.bottom = -160;
  s.camera.near = 1; s.camera.far = 1200;
  sun.position.copy(hero).addScaledVector(sunDir, 600); sun.target.position.copy(hero);
  s.camera.updateProjectionMatrix();
  s.bias = -0.0001; s.normalBias = 0.1;
  ```
  - Texel size = 320/4096 = **0.078 m** (DERIVED).
  - `bias = −0.0001` × 1199 m ≈ 0.12 m (DERIVED).
  - `normalBias = 0.1` ≈ 1.3 texels.
  - `DirectionalLight.target` must be in the scene (`scene.add(sun.target)`) or its matrix is stale.
- **Penumbra check (DERIVED).** The sun disc is about 0.53° wide (ESTIMATED common value), so penumbra width ≈ distance × tan(0.53°) = 0.0093 × distance. A blade 100 m above the surface it shadows gives a ≈ 0.9 m penumbra ≈ 12 texels at 0.078 m. PCFSoft (≈ 1 texel) will look too sharp. Use PCF with `radius` 3–5, or VSM with `radius` 6–10 and `blurSamples` 16 (ESTIMATED).
- **CSM in r180 exists and works** ([CSM.js](https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/csm/CSM.js)).
  - Constructor defaults: `new CSM({ camera, parent, cascades = 3, maxFar = 100000, mode = 'practical', shadowMapSize = 2048, shadowBias = 0.000001, lightDirection, lightIntensity = 3, lightNear = 1, lightFar = 2000, lightMargin = 200 })`, then `csm.setupMaterial(mat)`, `csm.update()` every frame, and `csm.updateFrustums()` when the camera changes.
  - It **globally replaces** `ShaderChunk.lights_fragment_begin` and `lights_pars_begin` at construction, so construct it before the first compile.
  - It **overwrites** `material.onBeforeCompile`.
  - **ESTIMATED:** not needed for this scene.

---

## 8. WebGLRenderer options, colour management and light units
**Constructor destructuring in r180** (verbatim, [WebGLRenderer.js](https://cdn.jsdelivr.net/npm/three@0.180.0/src/renderers/WebGLRenderer.js)):
```js
const {
	canvas = createCanvasElement(),
	context = null,
	depth = true,
	stencil = false,
	alpha = false,
	antialias = false,
	premultipliedAlpha = true,
	preserveDrawingBuffer = false,
	powerPreference = 'default',
	failIfMajorPerformanceCaveat = false,
	reversedDepthBuffer = false,
} = parameters;
```
`precision` (default `'highp'`) and `logarithmicDepthBuffer` (default false) are read in [WebGLCapabilities.js](https://cdn.jsdelivr.net/npm/three@0.180.0/src/renderers/webgl/WebGLCapabilities.js):
```js
const logarithmicDepthBuffer = parameters.logarithmicDepthBuffer === true;
const reversedDepthBuffer = parameters.reversedDepthBuffer === true && extensions.has( 'EXT_clip_control' );
```
`antialias` only affects the canvas framebuffer. On the composer path, MSAA comes from the RT's `samples`.

**Colour defaults (MEASURED):**
- `outputColorSpace = 'srgb'`, `ColorManagement.enabled = true`, working space `'srgb-linear'`.
- `Color.setHex` and `setStyle` default to **SRGBColorSpace** (converted to linear).
- `setRGB`, `setHSL` and `new Color(r,g,b)` default to the **working (linear)** space (SOURCED, `build/three.core.js`). So `new THREE.Color(1, 0.7, 0)` is *linear*.

**`physicallyCorrectLights` and `useLegacyLights` no longer exist in r180.** The source never reads them. They were renamed in r150, defaulted off and deprecated in r155, and are now gone (SOURCED, [Migration Guide](https://github.com/mrdoob/three.js/wiki/Migration-Guide) sections 149→150 and 154→155). Setting them does nothing and gives no warning.

**Light units in the r180 physical shader (SOURCED, verbatim):**
```glsl
// DirectionalLight uniform: uniforms.color.copy( light.color ).multiplyScalar( light.intensity );
vec3 irradiance = dotNL * directLight.color;
reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );   // BRDF_Lambert = RECIPROCAL_PI * diffuseColor
vec3 getHemisphereLightIrradiance(...) { ... return mix( hemiLight.groundColor, hemiLight.skyColor, hemiDiffuseWeight ); }  // color*intensity, no PI
vec3 getIBLIrradiance( const in vec3 normal ) { ... return PI * envMapColor.rgb * envMapIntensity; }
```
- A white Lambert surface of albedo *a* facing a DirectionalLight of intensity *E* has **linear radiance L = a·E·cosθ/π**.
- An environment map of uniform radiance *Lₑ* contributes **L = a·Lₑ**.

**Recommended intensities** (sunlit hazy day, Sky.js PMREM as `scene.environment` with `environmentIntensity = 1`, white paint albedo 0.6–0.8 ESTIMATED):

| Tone map | Exposure | DirectionalLight (sun) intensity | Basis |
|---|---|---|---|
| **ACES (recommended)** | **0.9** | **≈ 10–14** | DERIVED: exposure fitted to ref sky (§5.3); sun solved so a vertical white tower facing the sun (sun 40° up, sky vertical irradiance ≈ 2.9) displays 244, the value measured on ref-1.png's hero tower |
| AgX | 1.7 | ≈ 13–19 | same method |
| Neutral | – | – | fits sky colour best, but its shoulder clips sky-lit whites before any sun is added (DERIVED: 0.8/π·2.9·1.41 ≈ 1.04, which is already ≥ 240/255) |

**Physical cross-check.**
- Clear-sky diffuse fraction kd ≈ **0.165–0.273** (Erbs, Orgill–Hollands and Lam–Li models, as quoted in [Computing diffuse fraction of global horizontal solar radiation (PMC4802514)](https://pmc.ncbi.nlm.nih.gov/articles/PMC4802514/)). SOURCED.
- Direct-to-diffuse horizontal ratio = (1−kd)/kd = **2.7–5.1** (DERIVED).
- E_sun,normal = ratio × 3.1 / sin 40° = **13–25** (DERIVED). The photo-fitted 10–14 sits at the hazy end, which is consistent with the hazy reference.
- The familiar "sun = 3" suits scenes with dim backgrounds. The Sky.js absolute scale (horizon radiance ≈ 1–2) forces a brighter sun. **Change these values together, not one at a time.**

---

## 9. Deprecation warnings and timing APIs in r180
**MEASURED.** A modern scene raised **zero** `console.warn` or `console.error` in r180. It used EffectComposer, which instantiates `Clock` internally, plus RenderPass, UnrealBloomPass, OutputPass, SMAAPass, Sky, PCFSoftShadowMap, AgX, InstancedMesh, BatchedMesh, PMREMGenerator, CubeCamera and reversedDepthBuffer.

The deprecation strings actually present in r180 builds (SOURCED, grep of `build/three.module.js` and `three.core.js`):
- `THREE.WebGLRenderer: renderMultiDrawInstances has been deprecated…` (r174)
- `THREE.ColorManagement: .fromWorkingColorSpace() has been renamed to .workingToColorSpace()` (r177). Its twin is `.toWorkingColorSpace()` → `.colorSpaceToWorking()`.
- `THREE.AnimationClip: parseAnimation() is deprecated…`
- `THREE.Controls: connect() now requires an element.` Pass `renderer.domElement` to controls.
- Shader-chunk rename warning. The rename map is **empty** in r180 (`const shaderChunkMap = new Map();`).

**Clock and Timer:**
- `Clock` is **not** deprecated in r180; that happens in r183.
- `Timer` is in core (`THREE.Timer`). The old `three/addons/misc/Timer.js` path 404s on r180.
- Recommended, and forward-compatible:
  ```js
  const timer = new THREE.Timer(); timer.connect( document );
  renderer.setAnimationLoop( ( t ) => { timer.update( t ); const dt = timer.getDelta(); ... composer.render( dt ); } );
  ```
  `connect(document)` is required for the Page Visibility API behaviour; this changed in r174.

Other r180 API names that bite: `RGBELoader` → `HDRLoader`, `reverseDepthBuffer` → `reversedDepthBuffer`, and the `USE_LOGDEPTHBUF` / `USE_REVERSEDEPTHBUF` defines (renamed, §0).

---

## 10. Reflector.js: planar reflection math, and reuse in a custom ocean shader
### 10.1 Verbatim r180 math
Source: [Reflector.js](https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/objects/Reflector.js), `onBeforeRender`. **SOURCED:**
```js
reflectorWorldPosition.setFromMatrixPosition( scope.matrixWorld );
cameraWorldPosition.setFromMatrixPosition( camera.matrixWorld );
rotationMatrix.extractRotation( scope.matrixWorld );
normal.set( 0, 0, 1 );
normal.applyMatrix4( rotationMatrix );
view.subVectors( reflectorWorldPosition, cameraWorldPosition );
// Avoid rendering when reflector is facing away unless forcing an update
const isFacingAway = view.dot( normal ) > 0;
if ( isFacingAway === true && this.forceUpdate === false ) return;
view.reflect( normal ).negate();
view.add( reflectorWorldPosition );
rotationMatrix.extractRotation( camera.matrixWorld );
lookAtPosition.set( 0, 0, - 1 );
lookAtPosition.applyMatrix4( rotationMatrix );
lookAtPosition.add( cameraWorldPosition );
target.subVectors( reflectorWorldPosition, lookAtPosition );
target.reflect( normal ).negate();
target.add( reflectorWorldPosition );
virtualCamera.position.copy( view );
virtualCamera.up.set( 0, 1, 0 );
virtualCamera.up.applyMatrix4( rotationMatrix );
virtualCamera.up.reflect( normal );
virtualCamera.lookAt( target );
virtualCamera.far = camera.far; // Used in WebGLBackground
virtualCamera.updateMatrixWorld();
virtualCamera.projectionMatrix.copy( camera.projectionMatrix );
// Update the texture matrix
textureMatrix.set(
	0.5, 0.0, 0.0, 0.5,
	0.0, 0.5, 0.0, 0.5,
	0.0, 0.0, 0.5, 0.5,
	0.0, 0.0, 0.0, 1.0
);
textureMatrix.multiply( virtualCamera.projectionMatrix );
textureMatrix.multiply( virtualCamera.matrixWorldInverse );
textureMatrix.multiply( scope.matrixWorld );
// Now update projection matrix with new clip plane, implementing code from: http://www.terathon.com/code/oblique.html
reflectorPlane.setFromNormalAndCoplanarPoint( normal, reflectorWorldPosition );
reflectorPlane.applyMatrix4( virtualCamera.matrixWorldInverse );
clipPlane.set( reflectorPlane.normal.x, reflectorPlane.normal.y, reflectorPlane.normal.z, reflectorPlane.constant );
const projectionMatrix = virtualCamera.projectionMatrix;
q.x = ( Math.sign( clipPlane.x ) + projectionMatrix.elements[ 8 ] ) / projectionMatrix.elements[ 0 ];
q.y = ( Math.sign( clipPlane.y ) + projectionMatrix.elements[ 9 ] ) / projectionMatrix.elements[ 5 ];
q.z = - 1.0;
q.w = ( 1.0 + projectionMatrix.elements[ 10 ] ) / projectionMatrix.elements[ 14 ];
clipPlane.multiplyScalar( 2.0 / clipPlane.dot( q ) );
projectionMatrix.elements[ 2 ] = clipPlane.x;
projectionMatrix.elements[ 6 ] = clipPlane.y;
projectionMatrix.elements[ 10 ] = clipPlane.z + 1.0 - clipBias;
projectionMatrix.elements[ 14 ] = clipPlane.w;
```
- The render target is `new WebGLRenderTarget( textureWidth, textureHeight, { samples: multisample, type: HalfFloatType } )`, with defaults 512² and `multisample` 4.
- During the mirror render it sets `renderer.shadowMap.autoUpdate = false` and `renderer.xr.enabled = false`.
- The vertex shader does `vUv = textureMatrix * vec4( position, 1.0 );` and the fragment does `texture2DProj( tDiffuse, vUv )`.
- `Water.js` in r180 uses the same math, but its `textureMatrix` omits `* matrixWorld` (it is fed **world** positions). Its RT is a plain **UnsignedByte** `WebGLRenderTarget(512,512)`, which clips HDR sun glints. Its distortion (verbatim):
  ```glsl
  vec2 distortion = surfaceNormal.xz * ( 0.001 + 1.0 / distance ) * distortionScale;
  vec3 reflectionSample = vec3( texture2D( mirrorSampler, mirrorCoord.xy / mirrorCoord.w + distortion ) );
  ```

### 10.2 Reusing it in a custom ocean ShaderMaterial (recommended structure, ESTIMATED design)
1. The ocean plane is y = 0 with normal (0,1,0). Each frame, **before** `composer.render()`, run the math above on your own `mirrorCam`. Use `normal = (0,1,0)` and point `P = (0,0,0)`, and build a **world-space** textureMatrix (Water.js style, no `* matrixWorld`).
2. Render the mirror pass yourself, not inside `onBeforeRender`. That avoids nested renders inside the composer's RenderPass. Give `mirrorCam.layers` a mask that excludes the ocean and the Sky mesh. Clear to **alpha 0** into a HalfFloat RT, at half resolution with `samples: 4`. Now alpha marks turbine pixels, and the sky reflection comes from the PMREM/analytic sky instead:
   ```js
   renderer.setRenderTarget( mirrorRT ); renderer.setClearColor( 0x000000, 0 ); renderer.clear();
   renderer.render( scene, mirrorCam ); renderer.setRenderTarget( null );
   ```
3. Ocean shader:
   ```glsl
   // vertex:   vMirrorCoord = uMirrorTextureMatrix * vec4( worldPosFlat, 1.0 );   // flat (undisplaced) y=0 position
   // fragment:
   vec2 muv = vMirrorCoord.xy / vMirrorCoord.w + N.xz * uDistortion / ( 1.0 + 0.002 * viewDist );
   vec4 planar = texture( uMirror, muv );                    // linear HDR, alpha = coverage
   vec3 skyRefl = /* analytic sky or envMap lookup of reflect(-V, N) */;
   vec3 refl = mix( skyRefl, planar.rgb, planar.a );
   ```
   The `1/(1+k·dist)` taper is an ESTIMATED replacement for Water.js's `0.001 + 1.0/distance`, which is designed for a 10 km plane.

### 10.3 Reflector is broken under `reversedDepthBuffer`, with a verified fix
The oblique-clip formula assumes GL [−1,1] depth. Two things go wrong under reversed depth:
- The main camera's projection is already reversed. The renderer does `camera._reversedDepth = true; camera.updateProjectionMatrix();` the first time it renders with any camera (SOURCED, WebGLRenderer `setProgram`), so Reflector copies a reversed matrix and then applies the GL formula to it.
- On the virtual camera's first render, that same `updateProjectionMatrix()` overwrites the copied projection using the virtual camera's own fov, aspect and near. **Copy those from the main camera every frame.**

**MEASURED** (live r180, 128² mirror RT; red box fully under the mirror, green box above it):

| Depth mode | Oblique formula | Red (under-water) px | Green (reflected) px |
|---|---|---|---|
| normal | r180 GL formula | 0 | 192 (correct) |
| normal | none | 376 (leak) | 72 |
| **reversed** | **r180 GL formula** | 0 | **0: reflection empty** |
| **reversed** | **proposed formula below** | 0 | **192 (correct)** |
| reversed | none | 376 | 72 |

**Reversed-Z oblique near-plane** (DERIVED, then verified above and by a 20,000-point numeric test with 0 violations, `calc/oblique.mjs`):
```js
// te = mirrorCam.projectionMatrix.elements (already reversed: te[10]=n/(f-n), te[14]=fn/(f-n)); C = view-space plane (x,y,z,w), kept side C·v>0
const far = te[14] / te[10];
const q = new THREE.Vector4( ( Math.sign( C.x ) + te[8] ) / te[0] * far, ( Math.sign( C.y ) + te[9] ) / te[5] * far, -far, 1 );
const a = q.z / C.dot( q );
te[2] = a * C.x; te[6] = a * C.y; te[10] = a * C.z - 1; te[14] = a * C.w;   // near plane := C (maps to depth 1), far plane through frustum corner
```
Branch on `renderer.capabilities.reversedDepthBuffer`: use this formula when it is true and the r180 GL formula otherwise. The textureMatrix only uses xy/w, so it is unaffected.

---

## 11. Float targets and depth precision for 0.5 m – 40 km
**Extension support** (SOURCED, [web3dsurvey](https://web3dsurvey.com/webgl2/extensions/EXT_clip_control), data date not stated on the pages):

| Extension | Overall | Notable per-platform figures |
|---|---|---|
| `EXT_color_buffer_float` (render to RGBA16F/32F) | **99.95%** | – |
| `OES_texture_float_linear` (filter 32F textures) | 90.72% | **iOS 54.68%**, Safari 58.9% |
| `EXT_clip_control` (required for reversed-Z) | 87.87% | Chrome 94.95%, Safari 98.25%, **Firefox 5.62%**, Samsung Internet 1.08%, Android 65.28% |

Sources: [EXT_color_buffer_float](https://web3dsurvey.com/webgl2/extensions/EXT_color_buffer_float), [OES_texture_float_linear](https://web3dsurvey.com/webgl2/extensions/OES_texture_float_linear), [EXT_clip_control](https://web3dsurvey.com/webgl2/extensions/EXT_clip_control).

- Use **HalfFloatType** for colour targets (filterable in core WebGL2). Use FloatType only for depth textures and readback probes.
- Without `EXT_clip_control`, three.js silently falls back to normal depth: `capabilities.reversedDepthBuffer` is false.

**Precision** (DERIVED; three.js `logDepthBufFC = 2/log2(far+1)`, fragment `gl_FragDepth = log2(vFragDepth) * logDepthBufFC * 0.5` with `vFragDepth = 1.0 + gl_Position.w`, all SOURCED). Formulas, with far = 60 km:
- standard: Δz ≈ z²/(n·2²⁴)
- log: Δz ≈ 2⁻²⁴·(1+z)·ln2·log2(1+f)
- reversed 32F: Δz ≈ ulp(n/z)·z²/n ≈ 1.2e-7·z

| near | z | standard 24-bit | log 24-bit | reversed + 32F |
|---|---|---|---|---|
| 0.5 m | 400 m | 0.019 m | 0.00026 m | 0.00004 m |
| 0.5 m | 10 km | **11.9 m** | 0.0066 m | 0.0007 m |
| 0.5 m | 40 km | **191 m** | 0.026 m | 0.0015 m |
| 5 m | 10 km | 1.19 m | 0.0066 m | 0.0006 m |
| 5 m | 40 km | 19.1 m | 0.026 m | 0.0012 m |

**MEASURED z-fight test** (planes 2 m apart at 10 km, 5 m at 20 km, 10 m at 40 km; near 0.5, far 60 km; composer HalfFloat MSAA ×4):
- **standard 24-bit fails** in all three cases, drawing the far plane.
- logarithmic passes all three.
- reversed + FloatType `DepthTexture` passes all three, with MSAA and no GL errors.
- reversed **without** a FloatType depth texture also passed *on this Mac*. ESTIMATED reason: Apple-silicon Metal stores "24-bit" depth as 32F. Do not rely on this on Windows or Android.

**Far plane** (SOURCED formula, [Horizon, Wikipedia](https://en.wikipedia.org/wiki/Horizon)): d ≈ 3.57·√h km for h in metres (≈ 3.86·√h with refraction). DERIVED: camera at 60 / 100 / 150 m gives a sea horizon at 27.7 / 35.7 / 43.7 km, and a 260 m turbine tip stays visible out to 3.57·(√h_cam + √260) km. **Use `far = 60000` and `near = 0.5–1`.**

**Recommendation (DERIVED from the above plus the measurements):**
1. **Default: `logarithmicDepthBuffer: true`.** It works everywhere, and Reflector-style oblique clipping still works because log depth is written from `w`.
   - Cost: `gl_FragDepth` disables early-Z. Overdraw is low here (sky first, one ocean plane, thin turbines).
   - Every custom ShaderMaterial (ocean, mirror, particles) must include `logdepthbuf_pars_vertex`, `logdepthbuf_vertex`, `logdepthbuf_pars_fragment` and `logdepthbuf_fragment`, or it will depth-sort wrongly against built-ins.
   - Sky.js lacks these chunks but is safe: it has `depthWrite:false` and z = w.
2. **Optional: reversed-Z when `capabilities.reversedDepthBuffer` is true.** It needs:
   - a composer RT carrying `depthTexture = new THREE.DepthTexture(); depthTexture.type = THREE.FloatType;`, as in the official r180 example ([webgl_reversed_depth_buffer.html](https://raw.githubusercontent.com/mrdoob/three.js/r180/examples/webgl_reversed_depth_buffer.html));
   - `sky.renderOrder = -1` (§5.4);
   - the reversed oblique formula (§10.3);
   - positive shadow bias (§7).
3. Standard depth is acceptable only if `near ≥ 5 m` and you accept about 1 m error at 10 km (1.19 m, table above).

---

## Quick gotcha list
1. Patch `ShaderChunk` **before the first compile**. Later edits never reach cached programs, not even through `needsUpdate` (measured).
2. Built-in fog is applied after tone mapping on the canvas path. Use the composer so fog is linear HDR and gets tone-mapped once in OutputPass.
3. Fog world position: `cameraPosition + transpose(mat3(viewMatrix)) * mvPosition.xyz`. Verified for Instanced, Batched and Sprite.
4. `onBeforeCompile` needs a unique `customProgramCacheKey` when two hooks share source text but differ in behaviour.
5. Vertex animation done in a shader does not reach the shadow pass without a `customDepthMaterial`.
6. `sky.renderOrder = -1`, always.
7. Composer: `setPixelRatio` + `setSize` in CSS pixels; `samples: 4`; cap DPR; pre-warm with `compileAsync` (first frame measured at 7.2 s).
8. PMREM: 15–90 ms per update (measured); reuse targets with `fromCubemap(tex, target)`; never per frame.
9. Reflector and Water are **wrong under reversed-Z** (measured). Use the §10.3 formula.
10. `new THREE.Color(r,g,b)` is linear; hex and CSS strings are sRGB.
11. With the Sky.js env: ACES exposure ≈ 0.9 and sun ≈ 10–14 (derived). AgX washes out the yellow transition pieces (derived).
12. r180 versus later: PCFSoft and Clock are fine in r180; Timer comes from `THREE.Timer`, not the addon path.

## Sources
three.js is MIT-licensed; the excerpts are quoted verbatim from the r180 package.
- r180 build and src: https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js, https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.core.js, https://cdn.jsdelivr.net/npm/three@0.180.0/src/renderers/shaders/ShaderChunk/ (fog_*, worldpos_vertex, project_vertex, begin_vertex, batching_*, defaultnormal_vertex, tonemapping_*, colorspace_*, logdepthbuf_*, shadowmap_*), https://cdn.jsdelivr.net/npm/three@0.180.0/src/renderers/webgl/WebGLProgram.js, WebGLPrograms.js, WebGLCapabilities.js, WebGLState.js, WebGLTextures.js, WebGLShadowMap.js, https://cdn.jsdelivr.net/npm/three@0.180.0/src/renderers/WebGLRenderer.js, src/materials/Material.js, src/extras/PMREMGenerator.js, src/lights/LightShadow.js, src/lights/DirectionalLightShadow.js, src/core/RenderTarget.js, src/math/Matrix4.js, src/cameras/Camera.js
- r180 addons: https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/ (postprocessing/EffectComposer.js, RenderPass.js, OutputPass.js, SMAAPass.js, UnrealBloomPass.js, Pass.js; shaders/OutputShader.js, SMAAShader.js, LuminosityHighPassShader.js; objects/Sky.js, Reflector.js, Water.js; csm/CSM.js, CSMShader.js)
- r180 examples (tag r180): https://raw.githubusercontent.com/mrdoob/three.js/r180/examples/webgl_shaders_ocean.html, webgl_shaders_sky.html, webgl_postprocessing_smaa.html, webgl_postprocessing_unreal_bloom.html, webgl_reversed_depth_buffer.html
- Migration guide: https://github.com/mrdoob/three.js/wiki/Migration-Guide (raw: https://raw.githubusercontent.com/wiki/mrdoob/three.js/Migration-Guide.md)
- Extension support: https://web3dsurvey.com/webgl2/extensions/EXT_clip_control, https://web3dsurvey.com/webgl2/extensions/EXT_color_buffer_float, https://web3dsurvey.com/webgl2/extensions/OES_texture_float_linear
- reversedDepthBuffer naming thread (r183, confirms the r179 rename): https://discourse.threejs.org/t/reversedepthbuffer-works-instead-of-reverseddepthbuffer/90954
- Diffuse fraction: https://pmc.ncbi.nlm.nih.gov/articles/PMC4802514/
- Horizon distance: https://en.wikipedia.org/wiki/Horizon
- Reference pixels: reference/ref-1.png (the Borkum Riffgrund 1 photo; not included in this repository) (sampled with a stdlib PNG decoder)
- Derivation scripts (working files, not part of the deliverable and not included): calc/{tonemap.mjs, sky.mjs, irr.mjs, fit.mjs, oblique.mjs, png.mjs}
