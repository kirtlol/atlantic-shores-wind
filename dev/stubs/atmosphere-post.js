// Dev stand-in for src/post/post.js (owner: shell), used only by dev/atmosphere.html.
// Implements the ARCHITECTURE exposure contract so the sky can be judged as the real Post will
// show it: HalfFloat MSAA composer -> RenderPass -> OutputPass (ACES), exposure =
// 1.43 / Y(L_horizon) (atmosphere.exposureTarget) smoothed in log space and clamped to
// LOOK.nightExposureMaxGain x the day exposure, divided by atmosphere.preExposure because every
// colour in the composer target is pre-exposed.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { LOOK } from '../../src/config.js';

// Exposure of the reference photo's light (drone view, 2026-06-21 16:30 EDT): the night clamp
// allows LOOK.nightExposureMaxGain times this.
const DAY_EXPOSURE_REF = 3.2;

export class DevPost {
  constructor({ renderer, scene, camera, atmosphere }, { samples = 4, timeConstant = 1.5, anchor = 'rule', nightGain = LOOK.nightExposureMaxGain } = {}) {
    this.renderer = renderer;
    this.anchor = anchor;          // 'rule' (contract: horizon) or 'photofit' (atmosphere diagnostic)
    this.atmosphere = atmosphere;
    this.timeConstant = timeConstant;
    const size = renderer.getSize(new THREE.Vector2());
    const dpr = renderer.getPixelRatio();
    const rt = new THREE.WebGLRenderTarget(size.x * dpr, size.y * dpr, { type: THREE.HalfFloatType, samples });
    this.composer = new EffectComposer(renderer, rt);
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(size.x, size.y);
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);
    this.composer.addPass(new OutputPass());
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.maxExposure = DAY_EXPOSURE_REF * nightGain;
    this.exposure = null;
  }
  /** Exposure the rule asks for after the night clamp (absolute units). */
  targetExposure() {
    const a = this.atmosphere;
    return Math.min(this.anchor === 'photofit' ? a.exposureTargetPhotoFit : a.exposureTarget, this.maxExposure);
  }
  render(dt, { snap = false } = {}) {
    const target = this.targetExposure();
    if (this.exposure === null || snap) this.exposure = target;
    else this.exposure *= Math.pow(target / this.exposure, 1 - Math.exp(-dt / this.timeConstant));
    this.renderer.toneMappingExposure = this.exposure / this.atmosphere.preExposure;
    this.composer.render(dt);
  }
  setSize(w, h) { this.composer.setSize(w, h); }
}
