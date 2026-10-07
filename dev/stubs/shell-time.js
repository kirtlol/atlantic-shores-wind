// Dev stub for src/env/time.js (shell test harness only). Same contract: SimClock, solarPosition
// (NOAA algorithm, refracted elevation) and lunarPosition (low precision).
import { SITE, TIME_DEFAULT } from '../../src/config.js';

const R = Math.PI / 180;
const sinD = (d) => Math.sin(d * R), cosD = (d) => Math.cos(d * R), tanD = (d) => Math.tan(d * R);

function julianDay(year, month, day, hoursUTC) {
  let y = year, m = month;
  if (m <= 2) { y -= 1; m += 12; }
  const a = Math.floor(y / 100), b = 2 - a + Math.floor(a / 4);
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + day + b - 1524.5 + hoursUTC / 24;
}

function nthSunday(year, month, n) {
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  return 1 + ((7 - first) % 7) + 7 * (n - 1);
}
function isDaylightTime(year, month, day, hours) {
  if (month < 3 || month > 11) return false;
  if (month > 3 && month < 11) return true;
  if (month === 3) { const s = nthSunday(year, 3, 2); return day > s || (day === s && hours >= 2); }
  const e = nthSunday(year, 11, 1);
  return day < e || (day === e && hours < 2);
}

function refraction(el) {
  if (el > 85) return 0;
  const t = tanD(el);
  let arcsec;
  if (el > 5) arcsec = 58.1 / t - 0.07 / t ** 3 + 0.000086 / t ** 5;
  else if (el > -0.575) arcsec = 1735 + el * (-518.2 + el * (103.4 + el * (-12.79 + el * 0.711)));
  else arcsec = -20.772 / t;
  return arcsec / 3600;
}

function sunEcliptic(jd) {
  const T = (jd - 2451545) / 36525;
  const L0 = (280.46646 + T * (36000.76983 + T * 0.0003032)) % 360;
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const C = sinD(M) * (1.914602 - T * (0.004817 + 0.000014 * T)) + sinD(2 * M) * (0.019993 - 0.000101 * T) + sinD(3 * M) * 0.000289;
  const omega = 125.04 - 1934.136 * T;
  const lambda = L0 + C - 0.00569 - 0.00478 * sinD(omega);
  const eps = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60 + 0.00256 * cosD(omega);
  return { T, L0, M, e, lambda, eps };
}

function horizontal(lat, decl, ha) {
  const cosZ = sinD(lat) * sinD(decl) + cosD(lat) * cosD(decl) * cosD(ha);
  const el = 90 - Math.acos(Math.max(-1, Math.min(1, cosZ))) / R;
  const az = (Math.atan2(sinD(ha), cosD(ha) * sinD(lat) - tanD(decl) * cosD(lat)) / R + 180 + 360) % 360;
  return { el, az };
}

export function solarPosition(lat, lon, jd) {
  const { L0, M, e, lambda, eps } = sunEcliptic(jd);
  const decl = Math.asin(sinD(eps) * sinD(lambda)) / R;
  const y = tanD(eps / 2) ** 2;
  const eqTime = 4 / R * (y * sinD(2 * L0) - 2 * e * sinD(M) + 4 * e * y * sinD(M) * cosD(2 * L0) - 0.5 * y * y * sinD(4 * L0) - 1.25 * e * e * sinD(2 * M));
  const utcMin = (((jd + 0.5) % 1) + 1) % 1 * 1440;
  const tst = (((utcMin + eqTime + 4 * lon) % 1440) + 1440) % 1440;
  const { el, az } = horizontal(lat, decl, tst / 4 - 180);
  return { azimuthDeg: az, elevationDeg: el + refraction(el) };
}

export function lunarPosition(lat, lon, jd) {
  const d = jd - 2451545;
  const L = 218.316 + 13.176396 * d, M = 134.963 + 13.064993 * d, F = 93.272 + 13.229350 * d;
  const lam = L + 6.289 * sinD(M), beta = 5.128 * sinD(F), eps = 23.4397;
  const ra = Math.atan2(sinD(lam) * cosD(eps) - tanD(beta) * sinD(eps), cosD(lam)) / R;
  const decl = Math.asin(sinD(beta) * cosD(eps) + cosD(beta) * sinD(eps) * sinD(lam)) / R;
  const gmst = 280.46061837 + 360.98564736629 * d;
  const { el, az } = horizontal(lat, decl, gmst + lon - ra);
  const elong = (((lam - sunEcliptic(jd).lambda) % 360) + 360) % 360;
  return { azimuthDeg: az, elevationDeg: el + refraction(el), phase: elong / 360 };
}

export class SimClock {
  constructor({ year = TIME_DEFAULT.year, month = TIME_DEFAULT.month, day = TIME_DEFAULT.day, hours = TIME_DEFAULT.hours, speed = 1, playing = false } = {}) {
    this.date = { year, month, day };
    this.hours = hours;
    this.speed = speed;
    this.playing = playing;
    this.version = 0;          // bumped on every jump (setTime / setDate), as in the real clock
  }
  update(dt) {
    if (!this.playing || !(dt > 0)) return;
    this.hours += dt * this.speed / 3600;
    while (this.hours >= 24) {
      this.hours -= 24;
      const { year, month, day } = this.date;
      const next = new Date(Date.UTC(year, month - 1, day + 1));
      this.date = { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() };
    }
  }
  setTime(hours) { this.hours = ((hours % 24) + 24) % 24; this.version++; }
  setDate(month, day, year = this.date.year) {
    const m = Math.min(12, Math.max(1, Math.round(month)));
    const dim = new Date(Date.UTC(year, m, 0)).getUTCDate();
    this.date = { year, month: m, day: Math.min(dim, Math.max(1, Math.round(day))) };
    this.version++;
  }
  utcOffsetHours() {
    const { year, month, day } = this.date;
    return isDaylightTime(year, month, day, this.hours) ? SITE.tzDaylight : SITE.tzStandard;
  }
  julianDay() {
    const { year, month, day } = this.date;
    return julianDay(year, month, day, this.hours - this.utcOffsetHours());
  }
  sun() { return solarPosition(SITE.heroLat, SITE.heroLon, this.julianDay()); }
  moon() { return lunarPosition(SITE.heroLat, SITE.heroLon, this.julianDay()); }
}
