// Shell dev page: choose the stub modules from ?stubs= and hand them to main.js, which reads
// window.__NJOW_STUBS before loading any scene module (src/ never references dev/).
const STUBS = {
  fog: () => import('./stubs/shell-fog.js'),
  time: () => import('./stubs/shell-time.js'),
  atmosphere: () => import('./stubs/shell-atmosphere.js'),
  land: () => import('./stubs/shell-land.js'),
  ocean: () => import('./stubs/shell-ocean.js'),
  turbine: () => import('./stubs/shell-turbine.js'),
  farm: () => import('./stubs/shell-farm.js'),
  vessels: () => import('./stubs/shell-vessels.js'),
  birds: () => import('./stubs/shell-birds.js'),
  blitz: () => import('./stubs/shell-blitz.js'),
};
const sel = (new URLSearchParams(location.search).get('stubs') ?? '1').trim().toLowerCase();
const all = sel === '1' || sel === 'true' || sel === 'all';
const want = all ? new Set(Object.keys(STUBS)) : new Set(sel.split(',').map((s) => s.trim()).filter((s) => s && s !== '0' && s !== 'false'));
window.__NJOW_STUBS = Object.fromEntries(Object.entries(STUBS).filter(([k]) => want.has(k)));
await import('../src/main.js');
