// DEV STUB (ocean dev page only): a stand-in for src/env/atmosphere.js + src/env/time.js so the
// ocean can be developed before the real atmosphere exists. It honours the ARCHITECTURE contract
// (glsl/uniforms/skyRadiance/sunDiskRadiance/cloudShadow/applyAerialPerspective, sunLight,
// moonLight, exposureTarget, dayExposure) with a compact analytic sky calibrated to the photo's
// exposed values (SCENE-SPEC §12.2) and a flat procedural cloud layer at 1100 m.
import * as THREE from 'three';
import { U, azElToDir } from '../../src/shared.js';
import { SITE, ATMOS, CLOUDS, LOOK } from '../../src/config.js';

const DEG = Math.PI / 180;

// ---------------------------------------------------------------- NOAA solar position
export function solarPosition(lat, lon, jd) {
  const T = (jd - 2451545.0) / 36525;
  const L0 = (280.46646 + T * (36000.76983 + T * 0.0003032)) % 360;
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const C = Math.sin(M * DEG) * (1.914602 - T * (0.004817 + 0.000014 * T)) + Math.sin(2 * M * DEG) * (0.019993 - 0.000101 * T) + Math.sin(3 * M * DEG) * 0.000289;
  const trueLong = L0 + C;
  const omega = 125.04 - 1934.136 * T;
  const lambda = trueLong - 0.00569 - 0.00478 * Math.sin(omega * DEG);
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(omega * DEG);
  const decl = Math.asin(Math.sin(eps * DEG) * Math.sin(lambda * DEG)) / DEG;
  const y = Math.tan(eps / 2 * DEG) ** 2;
  const eqTime = 4 / DEG * (y * Math.sin(2 * L0 * DEG) - 2 * e * Math.sin(M * DEG) + 4 * e * y * Math.sin(M * DEG) * Math.cos(2 * L0 * DEG) - 0.5 * y * y * Math.sin(4 * L0 * DEG) - 1.25 * e * e * Math.sin(2 * M * DEG));
  const minutesUTC = ((jd + 0.5) % 1) * 1440;
  let tst = (minutesUTC + eqTime + 4 * lon) % 1440; if (tst < 0) tst += 1440;
  let ha = tst / 4 - 180; if (ha < -180) ha += 360;
  const cosZ = Math.sin(lat * DEG) * Math.sin(decl * DEG) + Math.cos(lat * DEG) * Math.cos(decl * DEG) * Math.cos(ha * DEG);
  const zen = Math.acos(Math.min(1, Math.max(-1, cosZ))) / DEG;
  let az = Math.acos(Math.min(1, Math.max(-1, (Math.sin(lat * DEG) * cosZ - Math.sin(decl * DEG)) / (Math.cos(lat * DEG) * Math.sin(zen * DEG))))) / DEG;
  az = ha > 0 ? (az + 180) % 360 : (540 - az) % 360;
  let el = 90 - zen;
  // standard atmospheric refraction (NOAA)
  if (el > -0.575) {
    const te = Math.tan(el * DEG);
    el += (el > 5 ? 58.1 / te - 0.07 / te ** 3 + 0.000086 / te ** 5 : el > -0.575 ? 1735 + el * (-518.2 + el * (103.4 + el * (-12.79 + el * 0.711))) : -20.774 / te) / 3600;
  }
  return { azimuthDeg: az, elevationDeg: el };
}
export function julianDay(year, month, day, hoursLocal, tzOffset) {
  const ut = hoursLocal - tzOffset;
  let y = year, m = month;
  if (m <= 2) { y -= 1; m += 12; }
  const A = Math.floor(y / 100), B = 2 - A + Math.floor(A / 4);
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + day + B - 1524.5 + ut / 24;
}

// ---------------------------------------------------------------- sky constants (stub calibration)
// Units: 1 scene unit ≈ 25,000 lx (LOOK.sceneUnitLux). Normal sun illuminance above the haze 4.4.
const SUN_TOA = 4.4;
const TAU = [0.075, 0.13, 0.26];                    // vertical optical depth R/G/B (Rayleigh + AOD 0.13)
// Photo-calibrated clear-sky colours per unit luminance (exposed values of §12.2 normalised).
const C_HORIZON = [0.685, 1.007, 1.79];
const C_ZENITH = [0.24, 0.93, 3.6];
const HORIZON_OVER_SUN = 0.115;                     // Y(L_horizon, 90° from sun) / E_sun at 43° (§12.1 band)

const GLSL = /* glsl */`
// ---- stub atmosphere (dev only) ----
uniform vec3 uSunDir;
uniform vec3 uSunIlluminance;
uniform vec3 uMoonDir;
uniform vec3 uMoonIlluminance;
uniform float uMoonPhase;
uniform float uNight;
uniform float uCloudCover;
uniform float uCloudAltitude;
uniform vec2 uCloudOffset;
uniform float uFogDensity;
uniform float uFogHeightFalloff;
uniform float uStubSkyScale;
uniform vec3 uStubTwilight;
#ifndef STUB_ATMOS_PI
#define STUB_ATMOS_PI 3.14159265
#endif
float stubHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float stubNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(stubHash(i), stubHash(i + vec2(1, 0)), u.x), mix(stubHash(i + vec2(0, 1)), stubHash(i + vec2(1, 1)), u.x), u.y);
}
float stubFbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * stubNoise(p); p = p * 2.03 + vec2(17.1, 3.7); a *= 0.5; } return s; }
float stubCloudDensity(vec2 xz) {
  vec2 p = (xz + uCloudOffset) / 1900.0;
  float n = stubFbm(p + 0.35 * vec2(stubFbm(p * 0.5 + 3.1), stubFbm(p * 0.5 + 7.7)));
  float streak = stubFbm(vec2(p.x * 0.35, p.y * 2.2) + 11.0);
  n = max(n, streak * 0.92);
  float thr = 1.0 - uCloudCover * 1.25;
  return smoothstep(thr - 0.02, thr + 0.16, n * 1.08);
}
vec3 stubClearSky(vec3 dir) {
  float el = asin(clamp(dir.y, 0.0, 1.0)) * 57.29578;
  float f = 1.0 - exp(-el / 6.0);
  vec3 c = mix(vec3(${C_HORIZON.join(', ')}), vec3(${C_ZENITH.join(', ')}), f);
  float lum = 0.22 + 0.78 * exp(-el / 9.0);
  float cg = dot(dir, uSunDir);
  float aureole = 1.0 + 1.1 * pow(max(cg, 0.0), 6.0) + 3.0 * pow(max(cg, 0.0), 60.0) + 0.25 * cg;
  vec3 twi = mix(vec3(1.0), uStubTwilight, exp(-el / 5.0) * max(0.0, 0.5 + 0.5 * cg));
  return c * lum * aureole * twi * uStubSkyScale;
}
vec3 skyRadiance(vec3 dir) {
  dir = normalize(dir);
  vec3 d = vec3(dir.x, max(dir.y, 0.0), dir.z);
  vec3 sky = stubClearSky(normalize(d + vec3(0.0, 1e-4, 0.0)));
  if (dir.y > 0.002) {
    float t = (uCloudAltitude - cameraPosition.y) / dir.y;
    vec2 hit = cameraPosition.xz + dir.xz * t;
    float dens = stubCloudDensity(hit);
    float thick = stubCloudDensity(hit + uSunDir.xz / max(uSunDir.y, 0.1) * 250.0);
    vec3 sunCol = uSunIlluminance;
    float lit = mix(0.95, 0.42, thick);
    vec3 cloud = sunCol * (0.105 * lit + 0.02) + stubClearSky(vec3(0.0, 1.0, 0.0)) * 0.35;
    float fade = exp(-t * 6.0e-5);
    sky = mix(sky, cloud, dens * fade);
  }
  // moon disc (night reference)
  float cm = dot(dir, uMoonDir);
  if (cm > 0.99996) sky += uMoonIlluminance / 6.4e-5;
  sky += vec3(2e-7, 3e-7, 6e-7);   // starlight / airglow floor
  return sky;
}
vec3 sunDiskRadiance(vec3 dir) {
  float c = dot(normalize(dir), uSunDir);
  float r = 0.004675;
  float x = sqrt(max(0.0, 1.0 - c * c)) / r;
  if (x > 1.0 || c < 0.0) return vec3(0.0);
  float limb = 1.0 - 0.6 * (1.0 - sqrt(1.0 - x * x));
  return uSunIlluminance / (STUB_ATMOS_PI * r * r) * limb / 0.8;
}
float cloudShadow(vec3 worldPos) {
  if (uSunDir.y <= 0.01) return 1.0;
  float t = (uCloudAltitude - worldPos.y) / uSunDir.y;
  vec2 hit = worldPos.xz + uSunDir.xz * t;
  return 1.0 - 0.82 * stubCloudDensity(hit);
}
vec3 applyAerialPerspective(vec3 color, vec3 worldPos) {
  vec3 v = worldPos - cameraPosition;
  float d = length(v);
  float h = uFogHeightFalloff;
  float y0 = max(cameraPosition.y, 0.0), y1 = max(worldPos.y, 0.0);
  float dy = (y1 - y0) * h;
  float od = abs(dy) > 1e-4 ? (exp(-y0 * h) - exp(-y1 * h)) / dy : exp(-y0 * h);
  vec3 sigma = vec3(${ATMOS.fogDensityRGB.map((x) => x.toExponential(4)).join(', ')}) * (uFogDensity / ${ATMOS.fogDensity.toExponential(4)});
  vec3 T = exp(-sigma * d * od);
  vec3 vd = normalize(vec3(v.x, 0.0, v.z) + vec3(1e-5, 0.0, 0.0));
  vec3 ins = stubClearSky(normalize(vd + vec3(0.0, 0.004, 0.0)));
  return color * T + ins * (1.0 - T);
}
`;

export class StubAtmosphere {
  constructor(ctx, opts = {}) {
    this.ctx = ctx;
    this.opts = opts;
    this.glsl = GLSL;
    this.skyScale = { value: 0.5 };
    this.twilight = { value: new THREE.Color(1, 1, 1) };
    this.uniforms = {
      uSunDir: U.uSunDir, uSunIlluminance: U.uSunIlluminance, uMoonDir: U.uMoonDir,
      uMoonIlluminance: U.uMoonIlluminance, uMoonPhase: U.uMoonPhase, uNight: U.uNight,
      uCloudCover: U.uCloudCover, uCloudAltitude: U.uCloudAltitude, uCloudOffset: U.uCloudOffset,
      uFogDensity: U.uFogDensity, uFogHeightFalloff: U.uFogHeightFalloff,
      uStubSkyScale: this.skyScale, uStubTwilight: this.twilight,
    };
    this.sunLight = new THREE.DirectionalLight(0xffffff, 1);
    this.moonLight = new THREE.DirectionalLight(0xb8c8ff, 0);
    ctx.scene.add(this.sunLight, this.sunLight.target, this.moonLight, this.moonLight.target);
    this.hemi = new THREE.HemisphereLight(0x9fc0e0, 0x1a2a38, 1);
    ctx.scene.add(this.hemi);
    // sky dome
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */`varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`,
      fragmentShader: GLSL + /* glsl */`varying vec3 vDir; void main(){ vec3 d = normalize(vDir); gl_FragColor = vec4(skyRadiance(d) + sunDiskRadiance(d), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
      side: THREE.BackSide, depthWrite: false, depthTest: false,
    });
    this.skyMesh = new THREE.Mesh(new THREE.SphereGeometry(1000, 48, 24), mat);
    this.skyMesh.renderOrder = -1;
    this.skyMesh.frustumCulled = false;
    this.skyMesh.onBeforeRender = (r, s, cam) => { this.skyMesh.position.copy(cam.position); this.skyMesh.updateMatrixWorld(); };
    ctx.scene.add(this.skyMesh);
    this.date = { year: 2026, month: opts.month ?? 6, day: opts.day ?? 21 };
    this.hours = opts.hours ?? 16.5;
    this.moon = opts.moon ?? { az: 120, el: 18, phase: 0.5 };
    this.exposureTarget = 3;
    this.dayExposure = 3;
    this.sunElevationDeg = 43;
    this._v = new THREE.Vector3();
  }
  setClouds({ cover }) { if (cover !== undefined) U.uCloudCover.value = cover; }
  setTime(h) { this.hours = h; }

  // JS mirror of stubClearSky luminance at the horizon in a view azimuth (for exposure).
  _clearSkyY(dir, sunDir) {
    const el = Math.asin(Math.max(0, Math.min(1, dir.y))) / DEG;
    const f = 1 - Math.exp(-el / 6);
    const c = C_HORIZON.map((h, i) => h + (C_ZENITH[i] - h) * f);
    const lum = 0.22 + 0.78 * Math.exp(-el / 9);
    const cg = dir.dot(sunDir);
    const aur = 1 + 1.1 * Math.max(cg, 0) ** 6 + 3 * Math.max(cg, 0) ** 60 + 0.25 * cg;
    const Y = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    return Y * lum * aur * this.skyScale.value;
  }

  update(dt, t, camera) {
    const jd = julianDay(this.date.year, this.date.month, this.date.day, this.hours, SITE.tzDaylight);
    const sp = solarPosition(SITE.heroLat, SITE.heroLon, jd);
    this.sunElevationDeg = sp.elevationDeg;
    const sunDir = azElToDir(sp.azimuthDeg, sp.elevationDeg, U.uSunDir.value);
    const el = sp.elevationDeg;
    // sun transmittance (Kasten-Young airmass)
    const am = el > -0.5 ? 1 / (Math.sin(Math.max(el, 0) * DEG) + 0.50572 * Math.pow(Math.max(el, 0) + 6.07995, -1.6364)) : 40;
    const vis = THREE.MathUtils.smoothstep(el, -0.6, 0.4);
    U.uSunIlluminance.value.setRGB(...TAU.map((tau) => SUN_TOA * Math.exp(-tau * am) * vis));
    // sky brightness follows the sun (daylight -> civil -> nautical twilight -> night floor)
    const sElev = Math.sin(Math.max(el, -18) * DEG);
    const day = Math.max(0, sElev + 0.1);
    const skyLum = HORIZON_OVER_SUN * 4.0 * Math.pow(day / (Math.sin(43 * DEG) + 0.1), 0.55);
    this.skyScale.value = Math.max(skyLum, 2e-7);
    const tw = THREE.MathUtils.clamp(1 - el / 12, 0, 1);
    this.twilight.value.setRGB(1 + 0.8 * tw, 1 + 0.15 * tw, 1 - 0.55 * tw);
    U.uNight.value = THREE.MathUtils.clamp((-el - 0) / 12, 0, 1);
    // moon (from dev options)
    azElToDir(this.moon.az, this.moon.el, U.uMoonDir.value);
    U.uMoonPhase.value = this.moon.phase;
    const moonLux = 0.25 * Math.max(0, 1 - Math.abs(this.moon.phase - 0.5) * 2) ** 2.5;   // full moon ~0.25 lx
    const moonUnits = moonLux / LOOK.sceneUnitLux * (this.moon.el > 0 ? Math.exp(-0.13 / Math.max(Math.sin(this.moon.el * DEG), 0.05)) : 0);
    U.uMoonIlluminance.value.setRGB(moonUnits * 0.92, moonUnits * 0.96, moonUnits);
    // lights
    const sl = this.sunLight;
    const focus = camera.position;
    sl.color.copy(U.uSunIlluminance.value);
    const ys = Math.max(1e-6, 0.2126 * sl.color.r + 0.7152 * sl.color.g + 0.0722 * sl.color.b);
    sl.color.multiplyScalar(1 / ys); sl.intensity = ys;
    sl.position.copy(focus).addScaledVector(sunDir, 1000); sl.target.position.copy(focus);
    this.moonLight.intensity = moonUnits;
    this.moonLight.position.copy(focus).addScaledVector(U.uMoonDir.value, 1000); this.moonLight.target.position.copy(focus);
    this.hemi.intensity = this.skyScale.value * 1.2;
    // clouds drift
    U.uCloudOffset.value.set(CLOUDS.driftMS[0] * t, CLOUDS.driftMS[1] * t);
    // exposure = 1.43 / Y(horizon sky in the view azimuth, 0.75° up)
    const f = camera.getWorldDirection(this._v); f.y = 0;
    if (f.lengthSq() < 1e-8) f.set(0, 0, -1);
    f.normalize(); f.y = Math.sin(0.75 * DEG); f.normalize();
    const Yh = this._clearSkyY(f, sunDir);
    this.exposureTarget = LOOK.horizonExposedY / Math.max(Yh, 1e-9);
    this.dayExposure = LOOK.horizonExposedY / (HORIZON_OVER_SUN * 4.0 * 0.99);
  }
  dispose() {}
}
