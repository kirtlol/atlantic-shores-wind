// Simulation clock and ephemerides for the day/night cycle (owner: atmosphere).
//
//   SimClock          local civil time at the site (EDT/EST by US DST rules), play/pause, speed
//   solarPosition()   NOAA Solar Calculator algorithm, with NOAA's atmospheric refraction
//   lunarPosition()   low-precision Meeus (Astronomical Algorithms ch. 47, 48, 40): topocentric,
//                     refracted, with phase angle, illuminated fraction and bright-limb angle
//   greenwichSiderealTimeDeg() / localSiderealTimeDeg()   for the star-field rotation
//
// Pure maths: no three.js import, so the module also runs under node for checks.
// Angles in degrees unless a name says otherwise; azimuth is clockwise from true north.
import { SITE, TIME_DEFAULT } from '../config.js';

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const sind = (a) => Math.sin(a * RAD);
const cosd = (a) => Math.cos(a * RAD);
const tand = (a) => Math.tan(a * RAD);
const wrap360 = (a) => ((a % 360) + 360) % 360;
const wrap180 = (a) => wrap360(a + 180) - 180;

const MS_PER_DAY = 86400000;
const JD_UNIX_EPOCH = 2440587.5;
// TT - UT for 2026 (IERS: 69.1 s). Used only for the Moon, which moves 0.5"/s; the NOAA sun
// algorithm is defined on UT and is kept exactly as published so it reproduces SCENE-SPEC §8.
const DELTA_T_S = 69.1;
const AU_KM = 149597870.7;
const EARTH_EQ_RADIUS_KM = 6378.14;
export const MOON_RADIUS_KM = 1737.4;

// ------------------------------------------------------------------ calendar helpers

export function julianDayFromUnixMs(ms) { return ms / MS_PER_DAY + JD_UNIX_EPOCH; }

function daysInMonth(year, month) { return new Date(Date.UTC(year, month, 0)).getUTCDate(); }

// Day of month of the n-th Sunday (n = 1, 2, ...) of a month.
function nthSunday(year, month, n) {
  const dow1 = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();   // 0 = Sunday
  return 1 + ((7 - dow1) % 7) + 7 * (n - 1);
}

// US daylight saving time (Energy Policy Act 2005, in force since 2007): EDT from 02:00 local
// standard time on the second Sunday of March to 02:00 local daylight time on the first Sunday
// of November. `hours` is the local civil clock reading.
export function isUSDaylightTime(year, month, day, hours) {
  if (month < 3 || month > 11) return false;
  if (month > 3 && month < 11) return true;
  if (month === 3) {
    const start = nthSunday(year, 3, 2);
    return day > start || (day === start && hours >= 2);
  }
  const end = nthSunday(year, 11, 1);
  return day < end || (day === end && hours < 2);
}

// ------------------------------------------------------------------ SimClock

export class SimClock {
  /**
   * @param {object} [o]
   * @param {number} [o.year]  [o.month] [o.day] local civil date (defaults: TIME_DEFAULT)
   * @param {number} [o.hours] local civil time, 0..24
   * @param {number} [o.speed] simulated seconds per real second (1, 60, 600, 3600)
   * @param {boolean} [o.playing]
   * @param {number} [o.lat] [o.lon] observer (defaults: the hero turbine, SITE)
   */
  constructor({
    year = TIME_DEFAULT.year, month = TIME_DEFAULT.month, day = TIME_DEFAULT.day,
    hours = TIME_DEFAULT.hours, speed = 1, playing = false,
    lat = SITE.heroLat, lon = SITE.heroLon,
  } = {}) {
    this.date = { year, month, day };
    this.hours = 0;
    this.speed = speed;
    this.playing = playing;
    this.lat = lat;
    this.lon = lon;
    // Incremented on every discontinuous change (setTime / setDate); consumers use it to
    // detect time jumps (atmosphere re-bakes its environment immediately on a jump).
    this.version = 0;
    this.setDate(month, day, year);
    this.setTime(hours);
  }

  /** Advance the simulated clock by dt real seconds when playing. */
  update(dt) {
    if (this.playing && dt > 0 && this.speed !== 0) this.advance(dt * this.speed);
  }

  /** Move the clock by a signed number of simulated seconds, rolling the date over. */
  advance(seconds) {
    let h = this.hours + seconds / 3600;
    let { year, month, day } = this.date;
    while (h >= 24) {
      h -= 24; day++;
      if (day > daysInMonth(year, month)) { day = 1; month++; if (month > 12) { month = 1; year++; } }
    }
    while (h < 0) {
      h += 24; day--;
      if (day < 1) { month--; if (month < 1) { month = 12; year--; } day = daysInMonth(year, month); }
    }
    this.hours = h;
    this.date.year = year; this.date.month = month; this.date.day = day;
  }

  /** Jump to a local civil time of day (0..24). */
  setTime(hours) {
    this.hours = 0;
    this.advance(hours * 3600);
    this.version++;
  }

  /** Jump to a local civil date (the time of day is kept); the day is clamped to the month. */
  setDate(month, day, year = this.date.year) {
    const m = Math.min(12, Math.max(1, Math.round(month)));
    this.date.year = Math.round(year);
    this.date.month = m;
    this.date.day = Math.min(daysInMonth(this.date.year, m), Math.max(1, Math.round(day)));
    this.version++;
  }

  play(on = true) { this.playing = !!on; }
  pause() { this.playing = false; }

  /** true while the site keeps Eastern Daylight Time. */
  isDaylightTime() { const d = this.date; return isUSDaylightTime(d.year, d.month, d.day, this.hours); }

  /** Offset of local civil time from UTC in hours: -4 (EDT) or -5 (EST). */
  utcOffsetHours() { return this.isDaylightTime() ? SITE.tzDaylight : SITE.tzStandard; }

  /** Milliseconds since 1970-01-01T00:00Z of the current instant. */
  unixMs() {
    const d = this.date;
    return Date.UTC(d.year, d.month - 1, d.day) + (this.hours - this.utcOffsetHours()) * 3600000;
  }

  /** Julian Day (UT) of the current instant, for the ephemerides. */
  julianDay() { return julianDayFromUnixMs(this.unixMs()); }

  /** Sun as seen from the observer: see solarPosition(). */
  sun() { return solarPosition(this.lat, this.lon, this.julianDay()); }

  /** Moon as seen from the observer: see lunarPosition(). */
  moon() { return lunarPosition(this.lat, this.lon, this.julianDay()); }

  /** "2026-06-21 16:30 EDT" */
  label() {
    const d = this.date;
    const totalMin = Math.floor(this.hours * 60 + 1e-6);
    const hh = String(Math.floor(totalMin / 60) % 24).padStart(2, '0');
    const mm = String(totalMin % 60).padStart(2, '0');
    return `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')} ${hh}:${mm} ${this.isDaylightTime() ? 'EDT' : 'EST'}`;
  }
}

// ------------------------------------------------------------------ sidereal time

/** Greenwich mean sidereal time in degrees (Meeus 12.4), jd on UT. */
export function greenwichSiderealTimeDeg(jdUTC) {
  const T = (jdUTC - 2451545.0) / 36525;
  return wrap360(280.46061837 + 360.98564736629 * (jdUTC - 2451545.0) + 0.000387933 * T * T - T * T * T / 38710000);
}

/** Local mean sidereal time in degrees; lon east-positive (the site is at -74.25). */
export function localSiderealTimeDeg(jdUTC, lonDeg) { return wrap360(greenwichSiderealTimeDeg(jdUTC) + lonDeg); }

// ------------------------------------------------------------------ refraction

/** Atmospheric refraction in degrees (NOAA spreadsheet formula) at a true (geometric) elevation. */
export function atmosphericRefractionDeg(e) { return noaaRefractionDeg(e); }

// NOAA spreadsheet refraction, in degrees, as a function of the true (geometric) elevation.
function noaaRefractionDeg(e) {
  if (e > 85) return 0;
  const te = tand(e);
  let arcsec;
  if (e > 5) arcsec = 58.1 / te - 0.07 / (te * te * te) + 0.000086 / Math.pow(te, 5);
  else if (e > -0.575) arcsec = 1735 + e * (-518.2 + e * (103.4 + e * (-12.79 + e * 0.711)));
  else arcsec = -20.772 / te;
  return arcsec / 3600;
}

// ------------------------------------------------------------------ Sun (NOAA)

/**
 * Sun position by the NOAA Solar Calculator equations (gml.noaa.gov/grad/solcalc/calcdetails.html).
 * @param {number} lat  degrees north
 * @param {number} lon  degrees east (west negative)
 * @param {number} jdUTC Julian Day on UT
 * @returns {{azimuthDeg:number, elevationDeg:number, trueElevationDeg:number, refractionDeg:number,
 *   declinationDeg:number, rightAscensionDeg:number, apparentLongitudeDeg:number, hourAngleDeg:number,
 *   equationOfTimeMin:number, distanceAU:number}}
 *   elevationDeg includes refraction (the direction the sun appears in); trueElevationDeg does not.
 */
export function solarPosition(lat, lon, jdUTC) {
  const T = (jdUTC - 2451545) / 36525;
  const L0 = wrap360(280.46646 + T * (36000.76983 + T * 0.0003032));
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const C = sind(M) * (1.914602 - T * (0.004817 + 0.000014 * T)) + sind(2 * M) * (0.019993 - 0.000101 * T) + sind(3 * M) * 0.000289;
  const trueLong = L0 + C;
  const trueAnom = M + C;
  const radius = (1.000001018 * (1 - e * e)) / (1 + e * cosd(trueAnom));
  const omega = 125.04 - 1934.136 * T;
  const appLong = trueLong - 0.00569 - 0.00478 * sind(omega);
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * cosd(omega);
  const ra = wrap360(Math.atan2(cosd(eps) * sind(appLong), cosd(appLong)) * DEG);
  const decl = Math.asin(sind(eps) * sind(appLong)) * DEG;
  const y = tand(eps / 2) ** 2;
  const eqTime = 4 * DEG * (y * sind(2 * L0) - 2 * e * sind(M) + 4 * e * y * sind(M) * cosd(2 * L0)
    - 0.5 * y * y * sind(4 * L0) - 1.25 * e * e * sind(2 * M));
  // True solar time in minutes from the UT time of day.
  const utMin = (((jdUTC + 0.5) % 1) + 1) % 1 * 1440;
  const tst = ((utMin + eqTime + 4 * lon) % 1440 + 1440) % 1440;
  const ha = tst / 4 < 0 ? tst / 4 + 180 : tst / 4 - 180;
  const cosZen = Math.min(1, Math.max(-1, sind(lat) * sind(decl) + cosd(lat) * cosd(decl) * cosd(ha)));
  const zen = Math.acos(cosZen) * DEG;
  const trueEl = 90 - zen;
  const refr = noaaRefractionDeg(trueEl);
  // Azimuth from north, clockwise (NOAA form).
  const den = cosd(lat) * sind(zen);
  let az;
  if (Math.abs(den) < 1e-12) az = lat > 0 ? 180 : 0;
  else {
    const c = Math.min(1, Math.max(-1, (sind(lat) * cosd(zen) - sind(decl)) / den));
    const a = Math.acos(c) * DEG;
    az = ha > 0 ? wrap360(a + 180) : wrap360(540 - a);
  }
  return {
    azimuthDeg: az, elevationDeg: trueEl + refr, trueElevationDeg: trueEl, refractionDeg: refr,
    declinationDeg: decl, rightAscensionDeg: ra, apparentLongitudeDeg: wrap360(appLong), hourAngleDeg: ha,
    equationOfTimeMin: eqTime, distanceAU: radius,
  };
}

// ------------------------------------------------------------------ Moon (low-precision Meeus)

// Meeus table 47.A, the 60 periodic terms for longitude (Σl, 1e-6 deg) and distance (Σr, 1e-3 km):
// multiples of D, M, M', F, then the two coefficients.
const MOON_LR = [
  [0, 0, 1, 0, 6288774, -20905355], [2, 0, -1, 0, 1274027, -3699111], [2, 0, 0, 0, 658314, -2955968],
  [0, 0, 2, 0, 213618, -569925], [0, 1, 0, 0, -185116, 48888], [0, 0, 0, 2, -114332, -3149],
  [2, 0, -2, 0, 58793, 246158], [2, -1, -1, 0, 57066, -152138], [2, 0, 1, 0, 53322, -170733],
  [2, -1, 0, 0, 45758, -204586], [0, 1, -1, 0, -40923, -129620], [1, 0, 0, 0, -34720, 108743],
  [0, 1, 1, 0, -30383, 104755], [2, 0, 0, -2, 15327, 10321], [0, 0, 1, 2, -12528, 0],
  [0, 0, 1, -2, 10980, 79661], [4, 0, -1, 0, 10675, -34782], [0, 0, 3, 0, 10034, -23210],
  [4, 0, -2, 0, 8548, -21636], [2, 1, -1, 0, -7888, 24208], [2, 1, 0, 0, -6766, 30824],
  [1, 0, -1, 0, -5163, -8379], [1, 1, 0, 0, 4987, -16675], [2, -1, 1, 0, 4036, -12831],
  [2, 0, 2, 0, 3994, -10445], [4, 0, 0, 0, 3861, -11650], [2, 0, -3, 0, 3665, 14403],
  [0, 1, -2, 0, -2689, -7003], [2, 0, -1, 2, -2602, 0], [2, -1, -2, 0, 2390, 10056],
  [1, 0, 1, 0, -2348, 6322], [2, -2, 0, 0, 2236, -9884], [0, 1, 2, 0, -2120, 5751],
  [0, 2, 0, 0, -2069, 0], [2, -2, -1, 0, 2048, -4950], [2, 0, 1, -2, -1773, 4130],
  [2, 0, 0, 2, -1595, 0], [4, -1, -1, 0, 1215, -3958], [0, 0, 2, 2, -1110, 0],
  [3, 0, -1, 0, -892, 3258], [2, 1, 1, 0, -810, 2616], [4, -1, -2, 0, 759, -1897],
  [0, 2, -1, 0, -713, -2117], [2, 2, -1, 0, -700, 2354], [2, 1, -2, 0, 691, 0],
  [2, -1, 0, -2, 596, 0], [4, 0, 1, 0, 549, -1423], [0, 0, 4, 0, 537, -1117],
  [4, -1, 0, 0, 520, -1571], [1, 0, -2, 0, -487, -1739], [2, 1, 0, -2, -399, 0],
  [0, 0, 2, -2, -381, -4421], [1, 1, 1, 0, 351, 0], [3, 0, -2, 0, -340, 0],
  [4, 0, -3, 0, 330, 0], [2, -1, 2, 0, 327, 0], [0, 2, 1, 0, -323, 1165],
  [1, 1, -1, 0, 299, 0], [2, 0, 3, 0, 294, 0], [2, 0, -1, -2, 0, 8752],
];
// Meeus table 47.B, the largest 30 terms for latitude (Σb, 1e-6 deg). The omitted terms are
// each below 0.0008 deg; together they stay well under the Moon's 0.26 deg radius.
const MOON_B = [
  [0, 0, 0, 1, 5128122], [0, 0, 1, 1, 280602], [0, 0, 1, -1, 277693], [2, 0, 0, -1, 173237],
  [2, 0, -1, 1, 55413], [2, 0, -1, -1, 46271], [2, 0, 0, 1, 32573], [0, 0, 2, 1, 17198],
  [2, 0, 1, -1, 9266], [0, 0, 2, -1, 8822], [2, -1, 0, -1, 8216], [2, 0, -2, -1, 4324],
  [2, 0, 1, 1, 4200], [2, 1, 0, -1, -3359], [2, -1, -1, 1, 2463], [2, -1, 0, 1, 2211],
  [2, -1, -1, -1, 2065], [0, 1, -1, -1, -1870], [4, 0, -1, -1, 1828], [0, 1, 0, 1, -1794],
  [0, 0, 0, 3, -1749], [0, 1, -1, 1, -1565], [1, 0, 0, 1, -1491], [0, 1, 1, 1, -1475],
  [0, 1, 1, -1, -1410], [0, 1, 0, -1, -1344], [1, 0, 0, -1, -1335], [0, 0, 3, 1, 1107],
  [4, 0, 0, -1, 1021], [4, 0, -1, 1, 833],
];

// Geocentric apparent ecliptic position of the Moon (Meeus ch. 47) for a Julian Ephemeris Day.
function moonGeocentric(jde) {
  const T = (jde - 2451545) / 36525;
  const T2 = T * T, T3 = T2 * T, T4 = T3 * T;
  const Lp = wrap360(218.3164477 + 481267.88123421 * T - 0.0015786 * T2 + T3 / 538841 - T4 / 65194000);
  const D = wrap360(297.8501921 + 445267.1114034 * T - 0.0018819 * T2 + T3 / 545868 - T4 / 113065000);
  const M = wrap360(357.5291092 + 35999.0502909 * T - 0.0001536 * T2 + T3 / 24490000);
  const Mp = wrap360(134.9633964 + 477198.8675055 * T + 0.0087414 * T2 + T3 / 69699 - T4 / 14712000);
  const F = wrap360(93.2720950 + 483202.0175233 * T - 0.0036539 * T2 - T3 / 3526000 + T4 / 863310000);
  const A1 = 119.75 + 131.849 * T, A2 = 53.09 + 479264.290 * T, A3 = 313.45 + 481266.484 * T;
  const E = 1 - 0.002516 * T - 0.0000074 * T2;
  let sl = 0, sr = 0, sb = 0;
  for (const [d, m, mp, f, cl, cr] of MOON_LR) {
    const arg = d * D + m * M + mp * Mp + f * F;
    const eF = m === 0 ? 1 : (Math.abs(m) === 1 ? E : E * E);
    sl += cl * eF * sind(arg);
    sr += cr * eF * cosd(arg);
  }
  for (const [d, m, mp, f, cb] of MOON_B) {
    const eF = m === 0 ? 1 : (Math.abs(m) === 1 ? E : E * E);
    sb += cb * eF * sind(d * D + m * M + mp * Mp + f * F);
  }
  sl += 3958 * sind(A1) + 1962 * sind(Lp - F) + 318 * sind(A2);
  sb += -2235 * sind(Lp) + 382 * sind(A3) + 175 * sind(A1 - F) + 175 * sind(A1 + F) + 127 * sind(Lp - Mp) - 115 * sind(Lp + Mp);
  // Nutation (Meeus ch. 22, low accuracy: 0.5" in longitude, 0.1" in obliquity).
  const Om = 125.04452 - 1934.136261 * T;
  const Ls = 280.4665 + 36000.7698 * T, Lm = 218.3165 + 481267.8813 * T;
  const dPsi = (-17.20 * sind(Om) - 1.32 * sind(2 * Ls) - 0.23 * sind(2 * Lm) + 0.21 * sind(2 * Om)) / 3600;
  const dEps = (9.20 * cosd(Om) + 0.57 * cosd(2 * Ls) + 0.10 * cosd(2 * Lm) - 0.09 * cosd(2 * Om)) / 3600;
  const eps0 = 23.4392911 - 0.0130042 * T - 1.64e-7 * T2 + 5.04e-7 * T3;
  return {
    lambda: wrap360(Lp + sl / 1e6 + dPsi), beta: sb / 1e6, distanceKm: 385000.56 + sr / 1000,
    eps: eps0 + dEps, dPsi,
  };
}

function eclipticToEquatorial(lambda, beta, eps) {
  const ra = wrap360(Math.atan2(sind(lambda) * cosd(eps) - tand(beta) * sind(eps), cosd(lambda)) * DEG);
  const dec = Math.asin(sind(beta) * cosd(eps) + cosd(beta) * sind(eps) * sind(lambda)) * DEG;
  return { ra, dec };
}

/**
 * Moon as seen by an observer at sea level: low-precision Meeus (ch. 47 for the orbit,
 * ch. 40 for topocentric parallax, ch. 48 for the illumination), refraction by Bennett.
 * @returns {{azimuthDeg:number, elevationDeg:number, trueElevationDeg:number,
 *   phase:number, phaseAngleDeg:number, illuminatedFraction:number, brightLimbDeg:number,
 *   elongationDeg:number, distanceKm:number, angularRadiusDeg:number,
 *   rightAscensionDeg:number, declinationDeg:number, waxing:boolean}}
 *   phase: 0 new, 0.25 first quarter, 0.5 full, 0.75 last quarter (as U.uMoonPhase).
 *   phaseAngleDeg: Sun-Moon-Earth angle i (0 = full). brightLimbDeg: position angle of the
 *   midpoint of the bright limb, from celestial north through east (Meeus 48.5).
 */
export function lunarPosition(lat, lon, jdUTC) {
  const jde = jdUTC + DELTA_T_S / 86400;
  const g = moonGeocentric(jde);
  const eq = eclipticToEquatorial(g.lambda, g.beta, g.eps);
  const sun = solarPosition(lat, lon, jdUTC);
  const sunEq = eclipticToEquatorial(sun.apparentLongitudeDeg, 0, g.eps);

  // Illumination (Meeus 48.2, 48.3, 48.1, 48.5).
  const cosPsi = cosd(g.beta) * cosd(g.lambda - sun.apparentLongitudeDeg);
  const psi = Math.acos(Math.min(1, Math.max(-1, cosPsi))) * DEG;
  const Rkm = sun.distanceAU * AU_KM;
  const i = wrap360(Math.atan2(Rkm * sind(psi), g.distanceKm - Rkm * cosd(psi)) * DEG);
  const k = (1 + cosd(i)) / 2;
  const chi = wrap360(Math.atan2(cosd(sunEq.dec) * sind(sunEq.ra - eq.ra),
    sind(sunEq.dec) * cosd(eq.dec) - cosd(sunEq.dec) * sind(eq.dec) * cosd(sunEq.ra - eq.ra)) * DEG);
  const phase = wrap360(g.lambda - sun.apparentLongitudeDeg) / 360;

  // Apparent sidereal time, hour angle, topocentric correction (Meeus 40.1-40.3, sea level).
  const lst = wrap360(localSiderealTimeDeg(jdUTC, lon) + g.dPsi * cosd(g.eps));
  const H = wrap360(lst - eq.ra);
  const sinPi = EARTH_EQ_RADIUS_KM / g.distanceKm;
  const u = Math.atan(0.99664719 * tand(lat));
  const rhoSin = 0.99664719 * Math.sin(u);
  const rhoCos = Math.cos(u);
  const dAlpha = Math.atan2(-rhoCos * sinPi * sind(H), cosd(eq.dec) - rhoCos * sinPi * cosd(H)) * DEG;
  const decT = Math.atan2((sind(eq.dec) - rhoSin * sinPi) * cosd(dAlpha), cosd(eq.dec) - rhoCos * sinPi * cosd(H)) * DEG;
  const HT = H - dAlpha;

  // Horizontal coordinates (Meeus 13.5/13.6; azimuth turned to count from north).
  const alt = Math.asin(Math.min(1, Math.max(-1, sind(lat) * sind(decT) + cosd(lat) * cosd(decT) * cosd(HT)))) * DEG;
  const azS = Math.atan2(sind(HT), cosd(HT) * sind(lat) - tand(decT) * cosd(lat)) * DEG;
  const az = wrap360(azS + 180);
  // Bennett's refraction (arcmin), adequate down to the horizon.
  const refr = alt > -1.5 ? (1 / Math.tan((alt + 7.31 / (alt + 4.4)) * RAD)) / 60 : 0;

  return {
    azimuthDeg: az, elevationDeg: alt + Math.max(0, refr), trueElevationDeg: alt,
    phase, phaseAngleDeg: i, illuminatedFraction: k, brightLimbDeg: chi, elongationDeg: psi,
    distanceKm: g.distanceKm, angularRadiusDeg: Math.asin(MOON_RADIUS_KM / g.distanceKm) * DEG,
    rightAscensionDeg: eq.ra, declinationDeg: eq.dec, waxing: phase < 0.5,
  };
}

// Exposed for checks against Meeus' worked examples.
export const _internal = { moonGeocentric, eclipticToEquatorial, noaaRefractionDeg, wrap180 };
