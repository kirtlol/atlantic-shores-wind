// Slim controls for a host page (owner: shell): the kirt.lol piece page lays out a hint line and a row
// of pills under its wide (16:9-class) stage, or in a column beside it, so the full panel (ui.js) is not
// used there. Nothing here depends on the stage's shape: main.js sizes the scene from the stage.
//
// Markup (inside the host's .stage; all optional, every lookup is null-safe):
//   <div class="scene-tag" aria-hidden="true"><span id="tag-time">20:00</span> <span id="tag-tz">EDT</span> · planned, not built</div>
//   <div class="hud">
//     <span class="hint"><span class="t-touch">…</span><span class="t-mouse">…</span></span>
//     <button id="btn-time" type="button" aria-pressed="true">Time-lapse</button>
//     <button id="btn-view" type="button">Next view</button>
//     <button id="btn-blitz" type="button">Blitz</button>
//   </div>
// btn-time plays or pauses the clock at 60× (Space does the same), btn-view cycles the views,
// btn-blitz starts a blitz in view. The tag shows the scene's local time (SimClock.label()), updated once
// a second.
const TIME_LAPSE_SPEED = 60;

// US daylight saving: second Sunday of March 02:00 to first Sunday of November 02:00 (local). The standalone
// panel (ui.js) uses it; a host bundle leaves it out (the HUD reads the clock's own label).
function nthSunday(year, month, n) {
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  return 1 + ((7 - first) % 7) + 7 * (n - 1);
}
export function isDaylightTime(year, month, day, hours) {
  if (month < 3 || month > 11) return false;
  if (month > 3 && month < 11) return true;
  if (month === 3) { const s = nthSunday(year, 3, 2); return day > s || (day === s && hours >= 2); }
  const e = nthSunday(year, 11, 1);
  return day < e || (day === e && hours < 2);
}

export class HudUI {
  constructor(ctx) {
    this.ctx = ctx;
    this.api = ctx.api;
    this._listeners = [];
    this._t = Infinity;
    this._last = {};
    const stage = ctx.renderer.domElement.parentElement ?? document;
    const $ = (id) => stage.querySelector(`#${id}`) ?? document.getElementById(id);
    this.el = { time: $('btn-time'), view: $('btn-view'), blitz: $('btn-blitz'), tagTime: $('tag-time'), tagTz: $('tag-tz') };

    const on = (target, type, fn, opts) => {
      if (!target) return;
      target.addEventListener(type, fn, opts);
      this._listeners.push(() => target.removeEventListener(type, fn, opts));
    };
    on(this.el.time, 'click', () => this._togglePlay());
    on(this.el.view, 'click', () => this.api.nextView());
    on(this.el.blitz, 'click', () => this.api.triggerBlitz());
    on(window, 'keydown', (e) => {
      if (e.code !== 'Space' || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (t instanceof HTMLButtonElement || t instanceof HTMLAnchorElement || t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t?.isContentEditable) return;
      e.preventDefault();
      this._togglePlay();
    });
    if (this.el.blitz && !ctx.blitz) this.el.blitz.disabled = true;
    if (this.el.time && !ctx.clock) this.el.time.disabled = true;
    this.update(0);
  }

  _togglePlay() {
    const clock = this.ctx.clock;
    if (!clock) return;
    const play = !clock.playing;
    if (play) this.api.setSpeed(TIME_LAPSE_SPEED);
    this.api.play(play);
    this.update(0);
  }

  update(dt) {
    const clock = this.ctx.clock;
    if (!clock) return;
    const playing = !!clock.playing;
    if (this._last.playing !== playing && this.el.time) {
      this._last.playing = playing;
      this.el.time.setAttribute('aria-pressed', String(playing));
    }
    this._t += dt;
    if (this._t < 1) return;
    this._t = 0;
    // "2026-06-21 16:30 EDT" → the time and the zone
    const [, hm, tz] = clock.label?.().split(' ') ?? [];
    this._set('tagTime', hm);
    this._set('tagTz', tz);
  }

  _set(key, text) {
    if (text && this._last[key] !== text && this.el[key]) this.el[key].textContent = this._last[key] = text;
  }

  dispose() {
    for (const off of this._listeners) off();
    this._listeners.length = 0;
  }
}
