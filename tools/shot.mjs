// Headless screenshot + console capture for the offshore wind scene.
// Usage:
//   node tools/shot.mjs [--page index.html] [--query "view=drone&time=13"] [--out shots/a.png]
//                       [--w 1600] [--h 900] [--wait 9000] [--eval "js expr run after load"]
//                       [--fps]   (samples frame rate for 3 s before the screenshot) [--dpr 2]
// Serves the project root (parent of tools/) on a free localhost port, opens system Chrome (CHROME=<path> to
// point at another Chrome or Chromium binary; the default is the macOS install)
// headless with GPU (ANGLE/Metal), waits for window.__sceneReady (or --wait ms), prints JSON:
//   { ok, errors:[...], warnings:[...], logs:[...], fps, out }
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const flag = (k) => args.includes('--' + k);

const page = opt('page', 'index.html');
const query = opt('query', '');
const out = path.resolve(root, opt('out', 'shots/shot.png'));
const W = +opt('w', 1600), H = +opt('h', 900);
const DPR = +opt('dpr', 1);   // --dpr 2 emulates a retina screen (devicePixelRatio 2)
const wait = +opt('wait', 12000);
const evalExpr = opt('eval', null);
fs.mkdirSync(path.dirname(out), { recursive: true });

const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.css': 'text/css', '.glsl': 'text/plain' };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  const f = path.join(root, u === '/' ? 'index.html' : u);
  if (u === '/favicon.ico') { res.writeHead(204); return res.end(); }
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('404'); }
  res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl', '--no-first-run',
         '--disable-background-timer-throttling', '--disable-renderer-backgrounding', `--window-size=${W},${H}`],
  defaultViewport: { width: W, height: H, deviceScaleFactor: DPR },
});
const errors = [], warnings = [], logs = [];
let fps = null, ok = false;
try {
  const p = await browser.newPage();
  p.on('console', m => { const t = m.type(), s = m.text(); if (t === 'error' && /favicon|status of 404/.test(s) && !/\.js/.test(s)) return; if (t === 'error') errors.push(s); else if (t === 'warning' || t === 'warn') warnings.push(s); else logs.push(s); });
  p.on('pageerror', e => errors.push('pageerror: ' + (e.stack || e.message)));
  p.on('requestfailed', r => errors.push('requestfailed: ' + r.url() + ' ' + (r.failure()?.errorText || '')));
  const url = `http://127.0.0.1:${port}/${page}${query ? '?' + query : ''}`;
  await p.goto(url, { waitUntil: 'load', timeout: 60000 });
  const t0 = Date.now();
  while (Date.now() - t0 < wait) {
    const ready = await p.evaluate(() => !!window.__sceneReady).catch(() => false);
    if (ready) break;
    await new Promise(r => setTimeout(r, 250));
  }
  if (evalExpr) {
    const r = await p.evaluate(`(async () => { return (${evalExpr}); })()`).catch(e => 'eval error: ' + e.message);
    logs.push('eval => ' + JSON.stringify(r));
    await new Promise(r => setTimeout(r, 1500));
  }
  // let a few frames settle (clouds/env/pmrem builds)
  await new Promise(r => setTimeout(r, 1500));
  if (flag('fps')) {
    fps = await p.evaluate(() => new Promise(res => { let n = 0; const s = performance.now(); const f = () => { n++; if (performance.now() - s < 3000) requestAnimationFrame(f); else res(+(n / ((performance.now() - s) / 1000)).toFixed(1)); }; requestAnimationFrame(f); }));
  }
  const info = await p.evaluate(() => { try { const gl = document.createElement('canvas').getContext('webgl2'); const d = gl && gl.getExtension('WEBGL_debug_renderer_info'); return { webgl2: !!gl, renderer: d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : null, ready: !!window.__sceneReady, stats: window.__sceneStats || null }; } catch (e) { return { err: e.message }; } });
  logs.push('info => ' + JSON.stringify(info));
  await p.screenshot({ path: out });
  ok = errors.length === 0;
} catch (e) {
  errors.push('harness: ' + e.message);
} finally {
  await browser.close();
  server.close();
}
console.log(JSON.stringify({ ok, out, fps, errors, warnings: warnings.slice(0, 30), logs: logs.slice(-30) }, null, 2));
