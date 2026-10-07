// Control panel, caption and keyboard shortcuts (owner: shell).
//
// Binds to the markup in index.html by id. Every change goes through ctx.api (the same object
// exposed as window.__scene), and update() re-syncs the controls from ctx.state and the clock, so
// changes made by URL params or test hooks show up in the panel too. Every element is optional: a
// page without some control simply does not get it (no lookups on null).
import { SITE, SUN, TURBINE, rotorRpm, hubWind } from '../config.js';
import { U } from '../shared.js';
import { isDaylightTime } from './hud.js';

const VIEWS = ['drone', 'deck', 'nacelle', 'blitz', 'overview', 'cinematic'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// Lower bounds of Beaufort forces 1–12 in m/s (WMO Beaufort scale).
const BEAUFORT_FROM = [0.5, 1.6, 3.4, 5.5, 8.0, 10.8, 13.9, 17.2, 20.8, 24.5, 28.5, 32.7];
// Colour of the time track against sun elevation (deg): night, nautical and civil twilight,
// the orange band around sunrise/sunset, then daylight blue.
const SKY_STOPS = [
  [-90, [8, 14, 26]], [-18, [8, 14, 26]], [-12, [17, 27, 50]], [-6, [44, 56, 98]], [-2, [128, 92, 110]],
  [0, [206, 130, 80]], [3, [214, 168, 104]], [8, [112, 154, 196]], [25, [104, 160, 212]], [90, [138, 188, 232]],
];
const STORAGE_KEY = 'njow.panelCollapsed';
const READOUT_INTERVAL_S = 1 / 10;
const STATS_INTERVAL_S = 0.5;

const pad2 = (n) => String(n).padStart(2, '0');
function formatHM(hours) {
  const total = Math.floor((((hours % 24) + 24) % 24) * 60 + 1e-6);
  return `${pad2(Math.floor(total / 60) % 24)}:${pad2(total % 60)}`;
}


// Julian day (Meeus ch. 7) for a Gregorian date and UTC hours (hours may exceed 24).
function julianDay(year, month, day, hoursUTC) {
  let y = year, m = month;
  if (m <= 2) { y -= 1; m += 12; }
  const a = Math.floor(y / 100), b = 2 - a + Math.floor(a / 4);
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + day + b - 1524.5 + hoursUTC / 24;
}

function skyColour(el) {
  let i = 1;
  while (i < SKY_STOPS.length - 1 && el > SKY_STOPS[i][0]) i++;
  const [e0, c0] = SKY_STOPS[i - 1], [e1, c1] = SKY_STOPS[i];
  const f = Math.min(1, Math.max(0, (el - e0) / (e1 - e0)));
  return `rgb(${c0.map((c, k) => Math.round(c + (c1[k] - c) * f)).join(' ')})`;
}

function beaufort(u) { let b = 0; while (b < BEAUFORT_FROM.length && u >= BEAUFORT_FROM[b]) b++; return b; }

function formatCount(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)} M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)} k`;
  return String(n);
}

export class UI {
  constructor(ctx) {
    this.ctx = ctx;
    this.api = ctx.api;
    this.state = ctx.state;
    this._t = { readout: Infinity, stats: Infinity };
    this._dragging = new Set();        // ids of sliders the user is holding
    this._last = {};                   // last values written to the DOM
    this._sunTrackKey = '';
    this._listeners = [];
    const $ = (id) => document.getElementById(id);
    this.el = {
      panel: $('panel'), play: $('btn-play'), iconPlay: $('icon-play'), iconPause: $('icon-pause'),
      collapse: $('btn-collapse'), hm: $('clock-hm'), tz: $('clock-tz'), sub: $('clock-sub'),
      time: $('in-time'), timeOut: $('out-time'), sunTimes: $('sun-times'), month: $('in-month'),
      wind: $('in-wind'), windOut: $('out-wind'), windHint: $('wind-hint'),
      clouds: $('in-clouds'), cloudsOut: $('out-clouds'),
      blitzBtn: $('btn-blitz'), stats: $('stats'), notice: $('notice'),
      captionText: $('caption-text'), photoNote: $('photo-note'),
      views: Object.fromEntries(VIEWS.map((v) => [v, $(`view-${v}`)])),
      toggles: {
        blitz: $('tg-blitz'), birds: $('tg-birds'), vessels: $('tg-vessels'), photo: $('tg-photo'), adls: $('tg-adls'), cpl: $('tg-cpl'),
      },
      speeds: [...document.querySelectorAll('input[name="speed"]')],
      qualities: [...document.querySelectorAll('input[name="quality"]')],
    };

    // Caption text from config (the markup carries the same words so the page reads during load).
    if (this.el.captionText) this.el.captionText.textContent = SITE.caption;
    if (this.el.photoNote) this.el.photoNote.textContent = `The look is matched to a photo of ${SITE.photoNote.replace(/^Reference photo:\s*/, '').replace(/\.$/, '')}. The model is New Jersey's planned project; nothing is built off New Jersey yet.`;

    this._bindControls();
    this._applyAvailability();
    this._restoreCollapsed();
    this.update(0);
  }

  // ------------------------------------------------------------------------------------ binding
  _on(target, type, fn, opts) {
    if (!target) return;
    target.addEventListener(type, fn, opts);
    this._listeners.push(() => target.removeEventListener(type, fn, opts));
  }

  _bindControls() {
    const { el, api } = this;
    this._on(el.play, 'click', () => this._togglePlay());
    this._on(el.collapse, 'click', () => this._setCollapsed(el.panel?.dataset.collapsed !== 'true', true));

    this._trackSlider(el.time, (minutes) => api.setTime(minutes / 60));   // the slider counts minutes
    this._trackSlider(el.wind, (v) => api.setWind(v));
    this._trackSlider(el.clouds, (v) => api.setClouds(v));

    for (const r of el.speeds) this._on(r, 'change', () => { if (r.checked) api.setSpeed(+r.value); });
    for (const r of el.qualities) this._on(r, 'change', () => { if (r.checked) api.setQuality(r.value); });
    this._on(el.month, 'change', () => api.setDate(+el.month.value, this.ctx.clock?.date.day ?? 21));
    for (const [name, btn] of Object.entries(el.views)) this._on(btn, 'click', () => api.setView(name));
    for (const [name, input] of Object.entries(el.toggles)) this._on(input, 'change', () => api.setToggle(name, input.checked));
    this._on(el.blitzBtn, 'click', () => api.triggerBlitz());
    this._on(window, 'keydown', (e) => this._onKey(e));
  }

  _trackSlider(input, apply) {
    if (!input) return;
    const id = input.id;
    this._on(input, 'input', () => { this._dragging.add(id); apply(+input.value); this._paintFill(input); });
    const release = () => this._dragging.delete(id);
    this._on(input, 'change', release);
    this._on(input, 'pointerup', release);
    this._on(input, 'blur', release);
  }

  _applyAvailability() {
    const { ctx, el } = this;
    const available = {
      blitz: !!ctx.blitz, birds: !!ctx.birds, vessels: !!ctx.vessels,
      photo: !!ctx.state.capabilities?.photoLook, adls: typeof ctx.farm?.setADLS === 'function',
      cpl: !!ctx.state.capabilities?.polarizer,
    };
    for (const [name, input] of Object.entries(el.toggles)) {
      if (!input) continue;
      input.disabled = !available[name];
      const label = input.closest('label');
      if (label) label.title = available[name] ? '' : 'Not available: the module did not load';
    }
    if (el.blitzBtn) el.blitzBtn.disabled = !available.blitz;
    if (!ctx.clock) for (const c of [el.time, el.play, el.month]) if (c) c.disabled = true;
  }

  _togglePlay() {
    const clock = this.ctx.clock;
    if (clock) this.api.play(!clock.playing);
  }

  _onKey(e) {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    const tag = t?.tagName;
    const isRange = tag === 'INPUT' && t.type === 'range';
    // Leave keys to the focused control where it has its own meaning (buttons, checkboxes,
    // radios, selects and text fields all use Space; digits type into text fields).
    const ownsKeys = (tag === 'INPUT' && !isRange) || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'BUTTON' || t?.isContentEditable;
    if (e.code === 'Space') {
      if (ownsKeys) return;
      e.preventDefault();
      this._togglePlay();
      return;
    }
    if (ownsKeys && tag !== 'BUTTON') return;
    const digit = /^(?:Digit|Numpad)([1-6])$/.exec(e.code);
    if (digit) { e.preventDefault(); this.api.setView(VIEWS[+digit[1] - 1]); return; }
    if (e.code === 'KeyB') { e.preventDefault(); this.api.triggerBlitz(); }
  }

  // ---------------------------------------------------------------------------------- collapse
  _restoreCollapsed() {
    let stored = null;
    try { stored = window.localStorage.getItem(STORAGE_KEY); } catch { stored = null; }
    const narrow = window.matchMedia('(max-width: 640px)').matches;
    this._setCollapsed(stored === null ? narrow : stored === '1', false);
  }

  _setCollapsed(collapsed, remember) {
    const { panel, collapse } = this.el;
    if (panel) panel.dataset.collapsed = String(collapsed);
    collapse?.setAttribute('aria-expanded', String(!collapsed));
    collapse?.setAttribute('aria-label', collapsed ? 'Show controls' : 'Hide controls');
    if (remember) {
      try { window.localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0'); } catch { /* storage unavailable: keep the in-page state */ }
    }
  }

  // ------------------------------------------------------------------------------------- sync
  update(dt) {
    this._t.readout += dt;
    this._t.stats += dt;
    this._syncTime();
    if (this._t.readout >= READOUT_INTERVAL_S) { this._t.readout = 0; this._syncReadouts(); this._syncControls(); }
    if (this._t.stats >= STATS_INTERVAL_S) { this._t.stats = 0; this._syncStats(); }
  }

  _set(key, value, write) {
    if (this._last[key] === value) return;
    this._last[key] = value;
    write(value);
  }

  _syncTime() {
    const clock = this.ctx.clock;
    if (!clock) return;
    const { el } = this;
    if (!this._dragging.has('in-time') && el.time) {
      // The slider counts minutes in 5-minute steps up to 23:55 (1435), so it never wraps to 00:00.
      this._set('time', Math.min(1435, Math.floor(clock.hours * 60 + 1e-6)), (minutes) => { el.time.value = String(minutes); });
    }
    this._set('hm', formatHM(clock.hours), (s) => {
      if (el.hm) el.hm.textContent = s;
      if (el.timeOut) el.timeOut.textContent = s;
      el.time?.setAttribute('aria-valuetext', `${s} ${el.tz?.textContent || ''}`.trim());
    });
    this._set('playing', !!clock.playing, (p) => {
      el.play?.setAttribute('aria-pressed', String(p));
      el.play?.setAttribute('aria-label', p ? 'Pause time' : 'Play time');
      el.iconPlay?.toggleAttribute('hidden', p);        // SVG elements have no .hidden property
      el.iconPause?.toggleAttribute('hidden', !p);
    });
  }

  _syncReadouts() {
    const { ctx, el } = this;
    const clock = ctx.clock;
    if (clock) {
      const { year, month, day } = clock.date;
      const dst = isDaylightTime(year, month, day, clock.hours);
      this._set('tz', dst ? 'EDT' : 'EST', (s) => { if (el.tz) el.tz.textContent = s; this._last.hm = null; });
      const sun = this._sunNow();
      const sunText = sun ? ` · sun ${sun.el < 0 ? '−' : '+'}${Math.abs(sun.el).toFixed(1)}°` : '';
      this._set('sub', `${day} ${MONTHS[month - 1]} ${year}${sunText}`, (s) => { if (el.sub) el.sub.textContent = s; });
      if (sun && el.sub) {
        this._set('subTitle', `${sun.el.toFixed(1)}|${Math.round(sun.az)}`, () => {
          el.sub.title = `Sun elevation ${sun.el.toFixed(1)}°, azimuth ${Math.round(sun.az) % 360}° true`;
        });
      }
      this._set('month', month, (m) => { if (el.month) el.month.value = String(m); });
      const trackKey = `${year}-${month}-${day}`;
      if (trackKey !== this._sunTrackKey) { this._sunTrackKey = trackKey; this._paintSunTrack(year, month, day); }
    }

    const wind = this.state.wind;
    this._set('windOut', wind.toFixed(1), (s) => { if (el.windOut) el.windOut.textContent = `${s} m/s`; });
    if (el.windHint) this._set('windHint', wind, (u) => {
      const uh = hubWind(u);
      const rotor = uh < TURBINE.cutIn ? `rotor idling below cut-in, ${rotorRpm(u).toFixed(1)} rpm`
        : uh >= TURBINE.cutOut ? 'rotor parked above cut-out'
          : `rotor ${rotorRpm(u).toFixed(1)} rpm`;
      el.windHint.textContent = `Beaufort ${beaufort(u)} · ${rotor}`;
    });
    this._set('cloudsOut', Math.round(this.state.clouds * 100), (p) => { if (el.cloudsOut) el.cloudsOut.textContent = `${p} %`; });
  }

  _syncControls() {
    const { el, state, ctx } = this;
    if (!this._dragging.has('in-wind') && el.wind) this._set('windIn', state.wind, (v) => { el.wind.value = String(v); this._paintFill(el.wind); });
    if (!this._dragging.has('in-clouds') && el.clouds) this._set('cloudsIn', state.clouds, (v) => { el.clouds.value = String(v); this._paintFill(el.clouds); });
    if (ctx.clock) {
      this._set('speed', ctx.clock.speed, (s) => { for (const r of el.speeds) r.checked = +r.value === s; });
    }
    this._set('quality', state.quality, (q) => { for (const r of el.qualities) r.checked = r.value === q; });
    this._set('view', state.view, (v) => {
      for (const [name, btn] of Object.entries(el.views)) btn?.setAttribute('aria-pressed', String(name === v));
    });
    for (const [name, input] of Object.entries(el.toggles)) {
      if (input) this._set(`tg-${name}`, !!state.toggles[name], (on) => { input.checked = on; });
    }
    const missing = state.missing.map((m) => `${m.key} (${m.reason})`).join(', ');
    const notice = state.busy || (missing ? `Running without: ${missing}` : '');
    this._set('notice', notice, (s) => { if (!el.notice) return; el.notice.hidden = !s; el.notice.textContent = s; });
  }

  _syncStats() {
    const s = window.__sceneStats;
    if (!s || !this.el.stats) return;
    this.el.stats.textContent = `${Math.round(s.fps)} fps · ${s.frameMs.toFixed(1)} ms · ${s.drawCalls} draws · ${formatCount(s.triangles)} tris · ${s.px} px`;
  }

  _paintFill(input) {
    if (!input) return;
    const min = +input.min, max = +input.max;
    input.style.setProperty('--fill', `${(100 * (+input.value - min) / (max - min)).toFixed(2)}%`);
  }

  // Sun position now: from the atmosphere when it is running, else from the ephemeris.
  _sunNow() {
    const { ctx } = this;
    const el = ctx.atmosphere?.sunElevationDeg;
    if (Number.isFinite(el)) {
      const d = U.uSunDir.value;
      return { el, az: (Math.atan2(d.x, -d.z) * 180 / Math.PI + 360) % 360 };
    }
    const eph = ctx.ephemeris?.solarPosition;
    if (!eph || !ctx.clock) return null;
    const p = eph(SITE.heroLat, SITE.heroLon, this._jdLocal(ctx.clock.date, ctx.clock.hours));
    return { el: p.elevationDeg, az: (p.azimuthDeg + 360) % 360 };
  }

  _jdLocal({ year, month, day }, hours) {
    const offset = isDaylightTime(year, month, day, hours) ? SITE.tzDaylight : SITE.tzStandard;
    return julianDay(year, month, day, hours - offset);
  }

  // Paint the time track with the day's sky (sun elevation every 30 min) and list sunrise and
  // sunset (upper limb on the horizon: centre at minus the sun's angular radius, refracted).
  _paintSunTrack(year, month, day) {
    const eph = this.ctx.ephemeris?.solarPosition;
    const { time, sunTimes } = this.el;
    if (!eph || !time || !sunTimes) { if (sunTimes) sunTimes.hidden = true; return; }
    const date = { year, month, day };
    const elAt = (h) => eph(SITE.heroLat, SITE.heroLon, this._jdLocal(date, h)).elevationDeg;
    const stops = [];
    for (let i = 0; i <= 48; i++) stops.push(`${skyColour(elAt(i / 2))} ${(100 * i / 48).toFixed(2)}%`);
    time.style.setProperty('--track', `linear-gradient(90deg, ${stops.join(', ')})`);

    const horizon = -SUN.angularRadiusRad * 180 / Math.PI;
    const crossings = [];
    let h0 = 0, e0 = elAt(0) - horizon;
    for (let i = 1; i <= 144; i++) {
      const h1 = i / 6, e1 = elAt(h1) - horizon;
      if (e0 < 0 !== e1 < 0) {
        let a = h0, b = h1, ea = e0;
        for (let k = 0; k < 20; k++) {
          const m = (a + b) / 2, em = elAt(m) - horizon;
          if (ea < 0 === em < 0) { a = m; ea = em; } else b = m;
        }
        crossings.push({ h: (a + b) / 2, rising: e1 > e0 });
      }
      h0 = h1; e0 = e1;
    }
    const rise = crossings.find((c) => c.rising), set = crossings.find((c) => !c.rising);
    sunTimes.hidden = false;
    sunTimes.textContent = rise && set ? `Sunrise ${formatHM(rise.h)} · sunset ${formatHM(set.h)}`
      : e0 > 0 ? 'The sun stays up all day' : 'The sun stays down all day';
  }

  dispose() {
    for (const off of this._listeners) off();
    this._listeners.length = 0;
  }
}
