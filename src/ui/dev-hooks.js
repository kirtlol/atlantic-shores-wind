// Test and inspection hooks for the standalone page and dev hosts (owner: shell). main.js loads this
// with a literal import() only outside a host page (or with ?dev=1), and a host build can leave it
// out entirely by defining globalThis.NJOW_DEV = false.
//   __scene.scaleReport()   every registerScale() entry measured against SCALE_TABLE
//   __scene.bench(frames)   uncapped throughput of complete frames at a fixed 1/60 s step
//   __scene.benchPost(frames) cost of the post chain alone and of each optional stage in it
import * as THREE from 'three';
import { SCALE_REGISTRY } from '../shared.js';
import { SCALE_TABLE } from '../config.js';

// Scale report: measures every SCALE_REGISTRY entry and compares it with SCALE_TABLE (which wins
// over an entry's own `expect`). Entries SCALE_TABLE lists but no module registered come last,
// flagged `missing`.
function measureEntry(e, axis, box, size) {
  const pick = (v) => (axis === 'max' ? Math.max(v.x, v.y, v.z) : v[axis]);
  if (typeof e.measure === 'function') {
    const m = e.measure();
    return typeof m === 'number' ? m : pick(m);
  }
  const obj = e.object3D ?? e.object;
  if (obj) {
    obj.updateWorldMatrix(true, true);
    return pick(box.setFromObject(obj, true).getSize(size));
  }
  if (e.geometry) {
    e.geometry.computeBoundingBox();
    return pick(e.geometry.boundingBox.getSize(size));
  }
  throw new Error('entry has no measure(), object3D or geometry');
}

export function scaleReport() {
  const rows = [], seen = new Set();
  const box = new THREE.Box3(), size = new THREE.Vector3();
  const round = (v) => (Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null);
  for (const e of SCALE_REGISTRY) {
    const ref = SCALE_TABLE[e.name];
    const axis = e.expect?.axis ?? 'max';
    const expected = ref ? ref.metres : e.expect?.metres ?? null;
    const tolerance = ref ? ref.tolerance : e.expect?.tolerance ?? null;
    const row = { name: e.name, measured: null, expected, tolerance, ok: false, axis, source: e.source ?? null };
    try { row.measured = round(measureEntry(e, axis, box, size)); } catch (err) { row.error = String(err?.message ?? err); }
    row.ok = row.measured !== null && expected !== null && tolerance !== null && Math.abs(row.measured - expected) <= tolerance + 1e-9;
    rows.push(row);
    seen.add(e.name);
  }
  for (const [name, ref] of Object.entries(SCALE_TABLE)) {
    if (!seen.has(name)) rows.push({ name, measured: null, expected: ref.metres, tolerance: ref.tolerance, ok: false, missing: true });
  }
  return rows;
}

// hooks: { renderer, state, stepFrame(dt), sync() }
export function installDevHooks(api, hooks) {
  api.scaleReport = scaleReport;
  // Renders `frames` complete frames back to back (rig, module updates, post) at a fixed 1/60 s
  // step, then waits for the GPU. Returns wall-clock ms per frame (throughput, CPU and GPU
  // overlapped as in the live loop). Blocks the page while it runs.
  api.bench = (frames = 120) => {
    const { renderer, stepFrame, sync } = hooks;
    const dtStep = 1 / 60;
    for (let i = 0; i < 10; i++) stepFrame(dtStep);       // warm-up (amortised passes settle)
    sync();
    const t0 = performance.now();
    for (let i = 0; i < frames; i++) stepFrame(dtStep);
    sync();
    const ms = (performance.now() - t0) / frames;
    return {
      msPerFrame: +ms.toFixed(2), fps: +(1000 / ms).toFixed(1),
      drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles, quality: hooks.state.quality,
      pixelRatio: renderer.getPixelRatio(),
    };
  };
  // Post chain cost (ms per post.render(), scene hidden: its pass is a clear + MSAA resolve), min of 7
  // interleaved rounds, and each optional stage as the difference it makes: bloom (forced on), MSAA
  // (samples → 0), the FXAA path (instead of the merged grade), sharpening, metering (every frame).
  api.benchPost = (frames = 50) => {
    const { renderer, sync } = hooks, ctx = api.ctx, post = ctx.post, m = post.meterPass, look = post.look, q = ctx.quality;
    const run = () => { for (let i = 0; i < 4; i++) post.render(1 / 60); sync(); const t0 = performance.now(); for (let i = 0; i < frames; i++) post.render(1 / 60); sync(); return (performance.now() - t0) / frames; };
    const saved = { bloom: look.bloom, sharpen: look.sharpen, fxaa: post.fxaa, render: m.render, every: m.every };
    const reset = () => { Object.assign(look, { bloom: 0, sharpen: saved.sharpen }); post.fxaa = false; post.scenePass.setSamples(q.msaa); m.render = saved.render; m._busy = true; m.reading = null; };
    const cases = {
      chain: () => {}, bloom: () => { look.bloom = 1; }, msaa: () => post.scenePass.setSamples(0), fxaa: () => { post.fxaa = true; }, sharpen: () => { look.sharpen = 0; },
      meter: () => { m.render = function (...a) { this._busy = false; this.every = 1; saved.render.apply(this, a); this.reading = null; }; },
    };
    const best = {};
    ctx.scene.visible = false;
    try {
      for (let r = 0; r < 7; r++) for (const [k, set] of Object.entries(cases)) { reset(); set(); best[k] = Math.min(best[k] ?? Infinity, run()); }
    } finally {
      ctx.scene.visible = true;
      Object.assign(look, { bloom: saved.bloom, sharpen: saved.sharpen });
      post.fxaa = saved.fxaa; post.scenePass.setSamples(q.msaa);
      m.render = saved.render; m.every = saved.every; m._busy = false;
    }
    const c = best.chain, f = (v) => +v.toFixed(3);
    return { chainNoBloom: f(c), bloom: f(best.bloom - c), msaa: f(c - best.msaa), fxaaPath: f(best.fxaa - c), sharpen: f(c - best.sharpen),
      meterPerMeteredFrame: f(best.meter - c), quality: q.name, pixelRatio: renderer.getPixelRatio() };
  };
}
