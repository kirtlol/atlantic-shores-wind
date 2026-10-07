// Minimal host loader for dev/shell-hosted.html: sets the tier hint before the piece loads (as the
// kirt.lol loader does), imports main.js, then records what a host sees in window.__hostReport.
const params = new URLSearchParams(location.search);
window.__SW_HINT = Object.freeze({ tier: params.get('hint') || 'high', why: 'dev' });
const aspect = /^(\d+):(\d+)$/.exec(params.get('aspect') || '');
if (aspect) document.documentElement.style.setProperty('--ar', `calc(${aspect[1]} / ${aspect[2]})`);
const t0 = performance.now();
const report = window.__hostReport = { imported: false, atImport: null, ready: false, readyMs: null, bootError: null, status: null };
await import('../src/main.js');
report.imported = true;
const w = window.__app?.world;
report.atImport = w ? { quality: w.quality?.name, q: w.params?.q, frame: w.frame, px: w.px, hasRender: typeof window.__app.render, hasStop: typeof window.__app.stop } : null;
const tick = () => {
  if (window.__ready) {
    report.ready = true;
    report.readyMs = Math.round(performance.now() - t0);
    report.bootError = window.__bootError ?? null;
    report.status = window.__app?.world.moduleStatus?.() ?? null;
    window.__sceneReady = true;           // for tools/shot.mjs
    return;
  }
  requestAnimationFrame(tick);
};
tick();
