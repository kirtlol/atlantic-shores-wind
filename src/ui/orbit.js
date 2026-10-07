// Orbit camera control for the scene's camera rig (owner: shell). A compact stand-in for three's
// OrbitControls (18.6 KiB minified in the site bundle) with the same feel and only what the rig uses:
// orbit about `target` with damping, dolly toward it, pan along the sea (not the screen plane), polar
// and distance limits, and the r180 input mapping:
//   mouse    left drag orbits (with Shift / Ctrl / ⌘: pans), right drag pans (with a modifier: orbits),
//            middle drag and the wheel dolly (a trackpad pinch arrives as Ctrl + wheel: ×10)
//   touch    one finger orbits; two fingers pinch to dolly and move together to pan
//   keyboard with the element focused, arrows pan (with Shift / Ctrl / ⌘: orbit)
// `onStart` is called when a gesture begins (the rig hands control back to the user). The camera's up
// is +Y, so the spherical frame needs no rotation.
import * as THREE from 'three';

const TWO_PI = 2 * Math.PI;
const _v = new THREE.Vector3();
const _s = new THREE.Spherical();

export class Orbit {
  constructor(camera, element) {
    this.camera = camera;
    this.el = element;
    this.target = new THREE.Vector3();
    this.enabled = true;
    this.enableDamping = true;
    this.dampingFactor = 0.08;
    this.rotateSpeed = 0.45;
    this.zoomSpeed = 0.9;
    this.panSpeed = 0.8;
    this.keyPanSpeed = 14;              // pixels per arrow press
    this.minDistance = 2;
    this.maxDistance = 30000;
    this.minPolarAngle = 0.02;
    this.maxPolarAngle = Math.PI * 0.985; // look up at the TP from a boat deck
    this.onStart = null;
    this._dTheta = 0; this._dPhi = 0; this._scale = 1;
    this._pan = new THREE.Vector3();
    this._pointers = new Map();         // pointerId → { x, y } (page pixels)
    this._mode = null;                  // 'orbit' | 'pan' | 'dolly' | 'pinch'
    this._pinch = null;                 // { d, x, y }: finger distance and centroid last move
    const on = (type, fn, opts) => { element.addEventListener(type, fn, opts); return () => element.removeEventListener(type, fn, opts); };
    this._off = [
      on('pointerdown', (e) => this._down(e)),
      on('pointermove', (e) => this._move(e)),
      on('pointerup', (e) => this._up(e)),
      on('pointercancel', (e) => this._up(e)),
      on('wheel', (e) => this._wheel(e), { passive: false }),
      on('contextmenu', (e) => { if (this.enabled) e.preventDefault(); }),
      on('keydown', (e) => this._key(e)),
    ];
  }

  dispose() { for (const off of this._off.splice(0)) off(); }

  // Apply this frame's share of the pending orbit, pan and dolly, keep the limits, look at the target.
  update() {
    const pos = this.camera.position, k = this.enableDamping ? this.dampingFactor : 1;
    _s.setFromVector3(_v.subVectors(pos, this.target));
    _s.theta += this._dTheta * k;
    _s.phi = THREE.MathUtils.clamp(_s.phi + this._dPhi * k, this.minPolarAngle, this.maxPolarAngle);
    _s.makeSafe();
    _s.radius = THREE.MathUtils.clamp(_s.radius * this._scale, this.minDistance, this.maxDistance);
    this.target.addScaledVector(this._pan, k);
    pos.copy(this.target).add(_v.setFromSpherical(_s));
    this.camera.lookAt(this.target);
    const keep = this.enableDamping ? 1 - k : 0;
    this._dTheta *= keep; this._dPhi *= keep; this._pan.multiplyScalar(keep);
    this._scale = 1;
  }

  _orbit(dx, dy) {
    const h = this.el.clientHeight || 1;
    this._dTheta -= TWO_PI * dx / h;
    this._dPhi -= TWO_PI * dy / h;
  }

  // Pan by a screen displacement (pixels): along the camera's right axis and the horizontal forward
  // axis, scaled so the point under the target follows the pointer.
  _panBy(dx, dy) {
    const cam = this.camera, h = this.el.clientHeight || 1;
    const d = 2 * cam.position.distanceTo(this.target) * Math.tan(cam.fov * Math.PI / 360) / h;
    _v.setFromMatrixColumn(cam.matrix, 0);
    this._pan.addScaledVector(_v, -dx * d);
    this._pan.addScaledVector(_v.crossVectors(cam.up, _v), dy * d);
  }

  // amount > 0 dollies in (wheel units: 100 per notch).
  _dolly(amount) { this._scale *= Math.pow(0.95, this.zoomSpeed * amount * 0.01); }

  _start(mode) {
    this._mode = mode;
    if (mode) this.onStart?.();
  }

  _down(e) {
    if (!this.enabled) return;
    if (!this._pointers.size) this.el.setPointerCapture(e.pointerId);
    this._pointers.set(e.pointerId, { x: e.pageX, y: e.pageY });
    if (e.pointerType === 'touch') this._touchMode();
    else {
      const mod = e.shiftKey || e.ctrlKey || e.metaKey;
      this._start(e.button > 2 ? null : e.button === 1 ? 'dolly' : (e.button === 2) !== mod ? 'pan' : 'orbit');
    }
  }

  // One finger orbits; two pinch and pan (a third is ignored).
  _touchMode() {
    const p = [...this._pointers.values()];
    if (p.length === 1) this._start('orbit');
    else if (p.length === 2) {
      this._pinch = { d: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y), x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 };
      this._start('pinch');
    }
  }

  _move(e) {
    const last = this._pointers.get(e.pointerId);
    if (!this.enabled || !last || !this._mode) return;
    const dx = e.pageX - last.x, dy = e.pageY - last.y;
    last.x = e.pageX; last.y = e.pageY;
    if (this._mode === 'pinch') {
      const p = [...this._pointers.values()];
      if (p.length < 2) return;
      const d = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y), x = (p[0].x + p[1].x) / 2, y = (p[0].y + p[1].y) / 2;
      if (d > 0 && this._pinch.d > 0) this._scale /= Math.pow(d / this._pinch.d, this.zoomSpeed);
      this._panBy((x - this._pinch.x) * this.panSpeed, (y - this._pinch.y) * this.panSpeed);
      this._pinch = { d, x, y };
    } else if (this._mode === 'orbit') this._orbit(dx * this.rotateSpeed, dy * this.rotateSpeed);
    else if (this._mode === 'pan') this._panBy(dx * this.panSpeed, dy * this.panSpeed);
    else this._dolly(-dy);
    this.update();
  }

  _up(e) {
    if (!this._pointers.delete(e.pointerId)) return;
    if (!this._pointers.size) {
      if (this.el.hasPointerCapture?.(e.pointerId)) this.el.releasePointerCapture(e.pointerId);
      this._mode = null;
    } else if (e.pointerType === 'touch') this._touchMode();
  }

  _wheel(e) {
    if (!this.enabled || this._mode) return;
    e.preventDefault();
    this.onStart?.();
    this._dolly(-e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1) * (e.ctrlKey ? 10 : 1));
    this.update();
  }

  _key(e) {
    const dir = { ArrowUp: [0, 1], ArrowDown: [0, -1], ArrowLeft: [1, 0], ArrowRight: [-1, 0] }[e.code];
    if (!this.enabled || !dir) return;
    e.preventDefault();
    if (e.shiftKey || e.ctrlKey || e.metaKey) this._orbit(dir[0], dir[1]);
    else this._panBy(dir[0] * this.keyPanSpeed, dir[1] * this.keyPanSpeed);
    this.update();
  }
}
