// Dev stub for src/env/atmosphere.js (shell test harness only; the atmosphere agent owns the real
// one). Same contract: class Atmosphere with .glsl/.uniforms, sun + moon DirectionalLights, a sky
// dome, scene.environment from a PMREM of the sky, U.* writes, exposureTarget, sunElevationDeg,
// setClouds(). The sky is an analytic gradient scaled by a luminance-vs-sun-elevation table so that
// day, twilight and night exercise the shell's auto-exposure, bloom and grade over their full range.
import * as THREE from 'three';
import { U, azElToDir, CURVATURE_GLSL } from '../../src/shared.js';
import { SITE, SHADOW, LOOK, SUN } from '../../src/config.js';
import { solarPosition, lunarPosition } from './shell-time.js';

// log10 horizon sky luminance (scene units, 1 = 25,000 cd/m2) against sun elevation (deg).
// ESTIMATED stub values: ~0.44 at 43 deg (Y(L_h)/E_sun ≈ 0.12), ~250 cd/m2 at sunset,
// ~0.6 cd/m2 at the end of civil twilight, ~2e-4 cd/m2 (natural night sky) below -18 deg.
const HORIZON_LOG_Y = [[-90, -8.1], [-18, -8.1], [-12, -6.9], [-6, -4.6], [-3, -3.4], [0, -2.0], [5, -1.2], [10, -0.8], [20, -0.52], [43, -0.36], [90, -0.3]];
const SUN_TOP = 4.6;                 // scene units at the top of the atmosphere (≈115 klx)
const TAU = [0.12, 0.17, 0.30];      // zenith optical depth R, G, B (Rayleigh + aerosol, ESTIMATED)
const MOON_FULL = 1.0e-5;            // full-moon illuminance, scene units (0.25 lx)

function interp(table, x) {
  if (x <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) {
    if (x <= table[i][0]) { const [x0, y0] = table[i - 1], [x1, y1] = table[i]; return y0 + (y1 - y0) * (x - x0) / (x1 - x0); }
  }
  return table[table.length - 1][1];
}
const airmass = (el) => 1 / (Math.sin(Math.max(el, -1) * Math.PI / 180) + 0.50572 * Math.pow(Math.max(el, -1) + 6.07995, -1.6364));
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

const ATMOS_GLSL = /* glsl */`
uniform vec3 uSunDir;
uniform vec3 uSunIlluminance;
uniform vec3 uMoonDir;
uniform vec3 uMoonIlluminance;
uniform float uMoonPhase;
uniform float uNight;
uniform float uFogDensity;
uniform float uFogHeightFalloff;
uniform vec3 uFogInscatter;
uniform float uSkyScale;
uniform float uTwilight;
${CURVATURE_GLSL}
float atmosHash( vec3 p ) { p = fract( p * 0.3183099 + 0.1 ); p *= 17.0; return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) ); }
vec3 skyRadiance( vec3 dir ) {
	float y = max( dir.y, 0.0 );
	float hz = exp( - y * 7.0 );
	vec3 zenith = vec3( 0.30, 0.62, 1.55 ) / 0.61;
	vec3 horizonDay = vec3( 0.72, 1.00, 1.52 ) / 0.98;
	vec3 horizonDusk = vec3( 1.65, 0.92, 0.55 ) / 1.04;
	vec2 hs = normalize( uSunDir.xz + 1e-5 ), hd = normalize( dir.xz + 1e-5 );
	float toward = 0.5 + 0.5 * dot( hs, hd );
	vec3 horizon = mix( horizonDay, horizonDusk, uTwilight * toward * toward );
	vec3 col = mix( zenith * 0.32, horizon, hz );
	float mu = max( dot( dir, uSunDir ), 0.0 );
	col += ( 0.05 * pow( mu, 10.0 ) + 0.6 * pow( mu, 600.0 ) ) * vec3( 1.2, 1.0, 0.8 );
	vec3 L = uSkyScale * col;
	// moon disk and stars
	float md = dot( dir, uMoonDir );
	L += step( 0.99999, md ) * uMoonIlluminance * ( 0.25 + 0.75 * sin( 3.14159 * uMoonPhase ) ) / 6.4e-5;
	vec3 sp = dir * 380.0;
	float h = atmosHash( floor( sp ) );
	float star = step( 0.9975, h ) * smoothstep( 0.35, 0.0, length( fract( sp ) - 0.5 ) );
	L += star * uNight * 4e-6 * ( 0.2 + 4.0 * pow( atmosHash( floor( sp ) + 7.1 ), 6.0 ) ) * smoothstep( 0.0, 0.08, dir.y );
	return L;
}
vec3 sunDiskRadiance( vec3 dir ) {
	float c = dot( dir, uSunDir );
	float r = ${SUN.angularRadiusRad.toFixed(6)};
	float cosR = cos( r );
	if ( c < cosR ) return vec3( 0.0 );
	float x = sqrt( max( 1.0 - c * c, 0.0 ) ) / sin( r );
	float limb = 1.0 - 0.6 * ( 1.0 - sqrt( max( 1.0 - x * x, 0.0 ) ) );
	return uSunIlluminance / ( 3.14159265 * r * r ) * limb;
}
float cloudShadow( vec3 worldPos ) { return 1.0; }
vec3 applyAerialPerspective( vec3 color, vec3 worldPos ) {
	float h0 = max( cameraPosition.y, 0.0 ), h1 = max( worldPos.y, 0.0 );
	float k = uFogHeightFalloff, dh = h1 - h0;
	float avg = abs( dh ) > 0.01 ? ( exp( - k * h0 ) - exp( - k * h1 ) ) / ( k * dh ) : exp( - k * h0 );
	float T = exp( - uFogDensity * length( worldPos - cameraPosition ) * avg );
	return color * T + uFogInscatter * ( 1.0 - T );
}
// Extinction only (additive lights and glows), as in the real atmosphere's GLSL.
vec3 applyAerialTransmittance( vec3 color, vec3 worldPos ) {
	float h0 = max( cameraPosition.y, 0.0 ), h1 = max( worldPos.y, 0.0 );
	float k = uFogHeightFalloff, dh = h1 - h0;
	float avg = abs( dh ) > 0.01 ? ( exp( - k * h0 ) - exp( - k * h1 ) ) / ( k * dh ) : exp( - k * h0 );
	return color * exp( - uFogDensity * length( worldPos - cameraPosition ) * avg );
}
`;

const SKY_VERTEX = /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vDir;
void main() {
	vDir = normalize( position );
	vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
	gl_Position = projectionMatrix * mvPosition;
	#include <logdepthbuf_vertex>
}`;
const SKY_FRAGMENT = /* glsl */`
#include <common>
#include <logdepthbuf_pars_fragment>
${ATMOS_GLSL}
varying vec3 vDir;
void main() {
	#include <logdepthbuf_fragment>
	vec3 d = normalize( vDir );
	vec3 L = skyRadiance( d );
	#ifdef DRAW_SUN
	L += sunDiskRadiance( d );
	#endif
	gl_FragColor = vec4( L, 1.0 );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`;

export class Atmosphere {
  constructor(ctx) {
    this.ctx = ctx;
    this.glsl = ATMOS_GLSL;
    this.uSkyScale = { value: 0.4 };
    this.uTwilight = { value: 0 };
    this.uniforms = {
      uSunDir: U.uSunDir, uSunIlluminance: U.uSunIlluminance, uMoonDir: U.uMoonDir, uMoonIlluminance: U.uMoonIlluminance,
      uMoonPhase: U.uMoonPhase, uNight: U.uNight, uFogDensity: U.uFogDensity, uFogHeightFalloff: U.uFogHeightFalloff,
      uFogInscatter: U.uFogInscatter, uSkyScale: this.uSkyScale, uTwilight: this.uTwilight,
    };
    this.sunElevationDeg = 0;
    this.exposureTarget = 1;
    this.dayExposure = LOOK.horizonExposedY / Math.pow(10, interp(HORIZON_LOG_Y, 43));
    const { scene, renderer, quality } = ctx;

    const mat = (drawSun) => new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: SKY_VERTEX, fragmentShader: SKY_FRAGMENT,
      side: THREE.BackSide, depthWrite: false, defines: drawSun ? { DRAW_SUN: 1 } : {},
    });
    this.skyMesh = new THREE.Mesh(new THREE.SphereGeometry(140000, 64, 32), mat(true));
    this.skyMesh.renderOrder = -1;
    this.skyMesh.frustumCulled = false;
    scene.add(this.skyMesh);

    this.sunLight = new THREE.DirectionalLight(0xffffff, 0);
    this.sunLight.castShadow = true;
    const s = this.sunLight.shadow;
    s.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
    Object.assign(s.camera, { left: -SHADOW.halfExtent, right: SHADOW.halfExtent, top: SHADOW.halfExtent, bottom: -SHADOW.halfExtent, near: SHADOW.near, far: SHADOW.far });
    s.camera.updateProjectionMatrix();
    s.bias = SHADOW.bias; s.normalBias = SHADOW.normalBias; s.radius = 4;
    this.moonLight = new THREE.DirectionalLight(0xdfe6ff, 0);
    scene.add(this.sunLight, this.sunLight.target, this.moonLight, this.moonLight.target);

    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.cubeRT = new THREE.WebGLCubeRenderTarget(quality.pmremSize, { type: THREE.HalfFloatType });
    this.cubeCam = new THREE.CubeCamera(1, 5000, this.cubeRT);
    this.envScene = new THREE.Scene();
    this.envScene.add(new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16), mat(false)));
    this.envRT = null;
    this._bakedSun = new THREE.Vector3(0, -2, 0);
    this._bakedScale = -1;
    this._v = new THREE.Vector3();
  }

  setClouds({ cover }) { U.uCloudCover.value = cover; }
  setQuality(q) { this.sunLight.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize); this.sunLight.shadow.map?.dispose(); this.sunLight.shadow.map = null; }

  _skyLuma(dirY, mu) {
    const hz = Math.exp(-Math.max(dirY, 0) * 7);
    return this.uSkyScale.value * (0.32 * (1 - hz) + hz + 0.05 * Math.pow(Math.max(mu, 0), 10) + 0.6 * Math.pow(Math.max(mu, 0), 600));
  }

  update(dt, t, camera) {
    const clock = this.ctx.clock;
    const jd = clock ? clock.julianDay() : 2461213.35;
    const sun = solarPosition(SITE.heroLat, SITE.heroLon, jd);
    const moon = lunarPosition(SITE.heroLat, SITE.heroLon, jd);
    const el = sun.elevationDeg;
    this.sunElevationDeg = el;
    azElToDir(sun.azimuthDeg, el, U.uSunDir.value);
    azElToDir(moon.azimuthDeg, moon.elevationDeg, U.uMoonDir.value);
    U.uMoonPhase.value = moon.phase;

    const m = airmass(el), up = smooth(-0.8, 0.8, el);
    U.uSunIlluminance.value.setRGB(...TAU.map((tau) => SUN_TOP * Math.exp(-tau * m) * up));
    const lit = 0.5 - 0.5 * Math.cos(2 * Math.PI * moon.phase);
    const moonE = MOON_FULL * Math.pow(lit, 1.5) * smooth(-1, 2, moon.elevationDeg) * Math.exp(-0.2 * airmass(moon.elevationDeg));
    U.uMoonIlluminance.value.setRGB(moonE, moonE * 0.97, moonE * 0.9);
    U.uNight.value = smooth(0, -12, el);
    this.uTwilight.value = smooth(12, 2, el) * smooth(-10, -2, el);
    this.uSkyScale.value = Math.pow(10, interp(HORIZON_LOG_Y, el)) + 0.12 * moonE;

    const E = U.uSunIlluminance.value, luma = 0.2126 * E.r + 0.7152 * E.g + 0.0722 * E.b;
    this.sunLight.intensity = luma;
    if (luma > 0) this.sunLight.color.setRGB(E.r / luma, E.g / luma, E.b / luma);
    this.sunLight.target.position.set(0, 80, 0);
    this.sunLight.position.copy(this.sunLight.target.position).addScaledVector(U.uSunDir.value, 700);
    this.moonLight.intensity = moonE;
    this.moonLight.position.copy(U.uMoonDir.value).multiplyScalar(1000);

    // Horizon radiance in the view azimuth, 0.75 deg up: exposure target and fog in-scatter.
    const f = camera.getWorldDirection(this._v);
    const h = Math.hypot(f.x, f.z) || 1;
    const dir = this._v.set(f.x / h * 0.99991, 0.01309, f.z / h * 0.99991);
    const yH = this._skyLuma(dir.y, dir.dot(U.uSunDir.value));
    this.exposureTarget = LOOK.horizonExposedY / Math.max(yH, 1e-12);
    const tw = this.uTwilight.value;
    U.uFogInscatter.value.setRGB(yH * (0.73 + 0.9 * tw), yH * (1.02 - 0.1 * tw), yH * (1.55 - 0.9 * tw));
    U.uExposureHint.value = this.exposureTarget;

    this.skyMesh.position.copy(camera.position);
    const moved = this._bakedSun.angleTo(U.uSunDir.value) > 0.5 * Math.PI / 180;
    const rescaled = Math.abs(Math.log(this.uSkyScale.value / Math.max(this._bakedScale, 1e-30))) > 0.1;
    if (!this.envRT || moved || rescaled) this._bakeEnvironment();
  }

  _bakeEnvironment() {
    const { renderer, scene } = this.ctx;
    this.cubeCam.update(renderer, this.envScene);
    this.envRT = this.pmrem.fromCubemap(this.cubeRT.texture, this.envRT);
    scene.environment = this.envRT.texture;
    this._bakedSun.copy(U.uSunDir.value);
    this._bakedScale = this.uSkyScale.value;
  }
}
