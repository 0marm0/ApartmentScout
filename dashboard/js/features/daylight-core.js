// Relative daylight: sky components per window, a sensor grid in a room and an annual summary. Pure functions (no DOM,
// no three.js). Mirrors apartmentscout/daylight.py; tests/fixtures/daylight_parity.json pins both to the same values.
//
// A RELATIVE MODEL, not photometry. Nothing here is a measured illuminance or has been calibrated against a light meter,
// a weather file or a simulation engine, and the inputs (glass, frames, blinds, surface reflectance) are assumptions
// unless a source is recorded next to them. Use the numbers to compare windows, floors, rooms and settings.
//
//  sky luminance        CIE standard overcast sky (1 + 2 sin alt) / 3, or the CIE standard clear sky (type 12) for a sun position
//  VSC                  vertical sky component: what a vertical window gets from the visible sky, over the horizontal
//                       illuminance of the same unobstructed sky (0.396 for an open window under the overcast sky)
//  sensor grid          sky component at working-plane points of a room, window by window (the window is sampled)
//  inter-reflected      mean inter-reflected component by flux transfer, one number per room
//  relative daylight    T x sky component + inter-reflected, in percent of the unobstructed horizontal sky illuminance
import { DEG, hAt, paneFacings, dayTable, litInfo } from '../sun.js';

export const FIELD_DEG = 90;
export const CLEAR_STEP = 3;
export const OVERCAST_STEP = 1;
export const SENSOR_HEIGHT_M = 0.76;
export const SAMPLES_U = 8;
export const SAMPLES_Z = 6;
export const E_H_OVERCAST = (7 * Math.PI) / 9;
export const MODEL_LABEL = 'relative daylight model (modelled, not measured, not calibrated)';

// ---------------------------------------------------------------------------------------------- input presets
// Typical values, ASSUMED unless a source is recorded. [id, label, value]
export const GLAZING_PRESETS = [
  ['default', 'Model default', 0.6], ['single-clear', 'Single clear', 0.88], ['double-clear', 'Double clear', 0.78],
  ['double-low-e', 'Double low-E', 0.7], ['triple-low-e', 'Triple low-E', 0.62], ['tinted', 'Tinted double', 0.45],
  ['solar-control', 'Reflective / solar control', 0.3],
];
export const FRAME_PRESETS = [
  ['default', 'Model default', 0.8], ['curtain-wall', 'Curtain wall, slim frame', 0.9], ['aluminium', 'Aluminium', 0.85],
  ['wood-vinyl', 'Wood or vinyl', 0.75], ['multi-lite', 'Multi-lite / heavy mullions', 0.65],
];
export const BLINDS_T = { open: 1, sheer: 0.55, half: 0.5, closed: 0.1 };
export const SURFACE_PRESETS = {
  floor: [['dark', 'Dark wood or carpet', 0.15], ['medium', 'Medium wood', 0.25], ['light', 'Light wood or tile', 0.45]],
  walls: [['white', 'White', 0.8], ['light', 'Light', 0.65], ['typical', 'Typical', 0.55], ['mid', 'Mid tone', 0.4], ['dark', 'Dark', 0.15]],
  ceiling: [['white', 'White', 0.85], ['off-white', 'Off-white', 0.75], ['mid', 'Mid tone', 0.5]],
};
export const SURFACE_DEFAULT = { floor: 0.25, walls: 0.55, ceiling: 0.75 };

/** Area-weighted mean reflectance of floor, walls and ceiling. */
export function reflectanceMean(floorM2, wallM2, ceilingM2, rhoFloor, rhoWalls, rhoCeiling) {
  const a = floorM2 + wallM2 + ceilingM2;
  return a > 0 ? (floorM2 * rhoFloor + wallM2 * rhoWalls + ceilingM2 * rhoCeiling) / a : 0;
}

// ---------------------------------------------------------------------------------------------- sky luminance
export const cieOvercast = (altDeg) => (1 + 2 * Math.sin(altDeg * DEG)) / 3;
const cieF = (a) => (a / 2 + Math.sin(2 * a) / 4 - (2 / 3) * Math.cos(a) ** 3) / 3;
const CIE_TOP = cieF(Math.PI / 2);
/** Overcast-sky light on a vertical window from altitudes above h degrees (per radian of azimuth, cosine weighted). */
export const cieAbove = (h) => CIE_TOP - cieF(Math.min(90, Math.max(0, +h || 0)) * DEG);

const [CA, CB, CC, CD, CE] = [-1, -0.32, 10, -3, 0.45]; // CIE standard clear sky, type 12
const gradation = (zenith) => { const c = Math.cos(zenith); return c < 1e-6 ? 1 : 1 + CA * Math.exp(CB / c); };
const indicatrix = (chi) => 1 + CC * (Math.exp(CD * chi) - Math.exp((CD * Math.PI) / 2)) + CE * Math.cos(chi) ** 2;
/** Relative luminance of the CIE standard clear sky (zenith = 1) at (az, alt) for a sun at (sunAz, sunAlt), degrees. */
export function cieClear(altDeg, azDeg, sunAltDeg, sunAzDeg) {
  const cz = Math.sin(altDeg * DEG); // cos of the zenith angle
  const cosChi = cz * Math.sin(sunAltDeg * DEG) + Math.cos(altDeg * DEG) * Math.cos(sunAltDeg * DEG) * Math.cos((azDeg - sunAzDeg) * DEG);
  const chi = Math.acos(Math.max(-1, Math.min(1, cosChi)));
  const grad = cz < 1e-6 ? 1 : 1 + CA * Math.exp(CB / Math.max(cz, 1e-6));
  return (indicatrix(chi) * grad) / (indicatrix((90 - sunAltDeg) * DEG) * gradation(0));
}
export const isClear = (sky) => !!sky && sky.kind === 'clear';
/** A sky spec: null / {kind:'overcast'} or {kind:'clear', sunAz, sunAlt}. */
export const skyLuminance = (alt, az, sky) => (isClear(sky) ? cieClear(alt, az, sky.sunAlt, sky.sunAz) : cieOvercast(alt));

const N_ALT = Math.round(90 / CLEAR_STEP), N_AZ = Math.round(360 / CLEAR_STEP);
const eh = new Map();
/** Horizontal illuminance of the unobstructed sky, in the luminance units of skyLuminance. */
export function horizontalIlluminance(sky) {
  if (!isClear(sky)) return E_H_OVERCAST;
  const key = `${sky.sunAz.toFixed(6)}|${sky.sunAlt.toFixed(6)}`;
  let v = eh.get(key);
  if (v === undefined) {
    v = 0;
    const d2 = (CLEAR_STEP * DEG) ** 2;
    for (let k = 0; k < N_AZ; k++) {
      const az = (k + 0.5) * CLEAR_STEP;
      for (let j = 0; j < N_ALT; j++) { const mid = j * CLEAR_STEP + CLEAR_STEP / 2; v += cieClear(mid, az, sky.sunAlt, sky.sunAz) * Math.sin(mid * DEG) * Math.cos(mid * DEG) * d2; }
    }
    if (eh.size > 512) eh.clear();
    eh.set(key, v);
  }
  return v;
}

const offAxis = (az, fs) => { let d = 180; for (const f of fs) d = Math.min(d, Math.abs((((az - f + 540) % 360) + 360) % 360 - 180)); return d; };
/**
 * Vertical sky component as a fraction (0.396 for an unobstructed window under the overcast sky): the vertical
 * illuminance on the window from the sky above its skyline, over the horizontal illuminance of the same unobstructed
 * sky. A bay takes the union of its panes' fields. `prof` is a 720-bin skyline in degrees (0.5 degree bins).
 */
export function verticalSkyComponent(prof, facing, panes = null, sky = null, field = FIELD_DEG) {
  const fs = paneFacings(facing, panes);
  let num = 0;
  if (!isClear(sky)) {
    const step = OVERCAST_STEP;
    for (let k = 0, n = Math.round(360 / step); k < n; k++) {
      const az = (k + 0.5) * step, d = offAxis(az, fs);
      if (d >= field) continue;
      num += Math.cos(d * DEG) * cieAbove(hAt(prof, az)) * step * DEG;
    }
    return num / E_H_OVERCAST;
  }
  const step = CLEAR_STEP;
  for (let k = 0; k < N_AZ; k++) {
    const az = (k + 0.5) * step, d = offAxis(az, fs);
    if (d >= field) continue;
    const h = hAt(prof, az), cd = Math.cos(d * DEG);
    for (let j = 0; j < N_ALT; j++) {
      const lo = j * step, cover = Math.min(1, Math.max(0, (lo + step - Math.max(h, lo)) / step));
      if (cover <= 0) continue;
      const mid = lo + step / 2, ca = Math.cos(mid * DEG);
      num += cieClear(mid, az, sky.sunAlt, sky.sunAz) * ca * ca * cd * cover * (step * DEG) ** 2;
    }
  }
  return num / horizontalIlluminance(sky);
}

// ---------------------------------------------------------------------------------------------- sensor points
export function pointInPoly(poly, x, y) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
export function edgeDistance(poly, x, y) {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const [ax, ay] = poly[i], [bx, by] = poly[(i + 1) % poly.length], ex = bx - ax, ey = by - ay, ll = ex * ex + ey * ey;
    const t = ll ? Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / ll)) : 0;
    best = Math.min(best, Math.hypot(x - ax - ex * t, y - ay - ey * t));
  }
  return best;
}
/** Compass bearing of a plan-frame vector when the plan's up direction has bearing upBearing. */
export const bearingOf = (normal, upBearing) => (((upBearing + (Math.atan2(normal[0], normal[1]) * 180) / Math.PI) % 360) + 360) % 360;

/**
 * Sky component (fraction of the unobstructed horizontal illuminance) at sensor p = [x, y, z] metres from one window:
 * win = {a:[x,y], b:[x,y] (plan metres), normal:[x,y] (outward unit), sill, head (metres above the floor)}, `prof` the
 * window's skyline. Samples nu x nz points of the rectangle; each sends L(direction) cos(zenith) cos(incidence) dA / r².
 */
export function sensorSkyComponent(p, win, prof, upBearing, sky = null, nu = SAMPLES_U, nz = SAMPLES_Z) {
  const [ax, ay] = win.a, [bx, by] = win.b, [nx, ny] = win.normal, [px, py, pz] = p;
  if ((px - ax) * nx + (py - ay) * ny >= 0) return 0; // the sensor must be on the room side of the glass
  const da = (Math.hypot(bx - ax, by - ay) * (win.head - win.sill)) / (nu * nz);
  let total = 0;
  for (let i = 0; i < nu; i++) {
    const u = (i + 0.5) / nu, sx = ax + (bx - ax) * u, sy = ay + (by - ay) * u;
    for (let j = 0; j < nz; j++) {
      const sz = win.sill + ((win.head - win.sill) * (j + 0.5)) / nz;
      const vx = sx - px, vy = sy - py, vz = sz - pz, r2 = vx * vx + vy * vy + vz * vz, r = Math.sqrt(r2);
      const cosW = (vx * nx + vy * ny) / r, hor = Math.hypot(vx, vy);
      if (cosW <= 0 || vz <= 0 || hor <= 0) continue;
      const alt = (Math.atan2(vz, hor) * 180) / Math.PI;
      const az = (((upBearing + (Math.atan2(vx, vy) * 180) / Math.PI) % 360) + 360) % 360;
      if (alt <= hAt(prof, az)) continue;
      total += (skyLuminance(alt, az, sky) * (vz / r) * cosW * da) / r2;
    }
  }
  return total / horizontalIlluminance(sky);
}

/** Light passed by glass (visible transmittance), frame (glazed share of the opening) and blinds (a name or a number). */
export const transmission = (vt, glazed, blinds) => vt * glazed * (typeof blinds === 'number' ? blinds : BLINDS_T[blinds] ?? 1);

export function gridStats(vals) {
  if (!vals.length) return null;
  const s = [...vals].sort((a, b) => a - b), n = s.length, mean = s.reduce((a, v) => a + v, 0) / n;
  const median = n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  return { mean, min: s[0], max: s[n - 1], median, uniformity: mean ? s[0] / mean : null, n };
}

/**
 * Relative daylight on a sensor grid in one room (plan metres): poly = the room outline [[x, y], ...]; windows = the
 * room's own openings {a, b, normal, sill, head, prof}. Returns {x0, y0, step, nx, ny, values (percent; null outside the
 * room or within insetM of its walls, row by row from y0), stats, skyComponentMean, reflected, rho, t}.
 */
export function roomGrid(poly, ceilingM, windows, upBearing, o = {}) {
  const { vt = 0.6, glazed = 0.8, blinds = 'open', surfaces = null, sky = null, stepM = 0.3, sensorZ = SENSOR_HEIGHT_M, insetM = 0.15 } = o;
  const s = { ...SURFACE_DEFAULT, ...(surfaces || {}) };
  const xs = poly.map((q) => q[0]), ys = poly.map((q) => q[1]), x0 = Math.min(...xs), y0 = Math.min(...ys);
  const nx = Math.ceil((Math.max(...xs) - x0) / stepM), ny = Math.ceil((Math.max(...ys) - y0) / stepM);
  const t = transmission(vt, glazed, blinds);
  let a2 = 0, per = 0;
  for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length]; a2 += p[0] * q[1] - q[0] * p[1]; per += Math.hypot(q[0] - p[0], q[1] - p[1]); }
  const floorM2 = Math.abs(a2) / 2, wallM2 = per * ceilingM;
  const rho = reflectanceMean(floorM2, wallM2, floorM2, s.floor, s.walls, s.ceiling), totalArea = 2 * floorM2 + wallM2;
  let flux = 0; // opening area x VSC summed over the windows (T is applied once below)
  for (const w of windows) flux += Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]) * (w.head - w.sill) * verticalSkyComponent(w.prof, bearingOf(w.normal, upBearing), null, sky);
  const reflected = totalArea > 0 && rho < 1 ? (t * flux * rho) / (totalArea * (1 - rho)) : 0;
  const values = [], inside = [], scs = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const x = x0 + (i + 0.5) * stepM, y = y0 + (j + 0.5) * stepM;
    if (!pointInPoly(poly, x, y) || edgeDistance(poly, x, y) < insetM) { values.push(null); continue; }
    let sc = 0;
    for (const w of windows) sc += sensorSkyComponent([x, y, sensorZ], w, w.prof, upBearing, sky);
    scs.push(sc * t * 100);
    const v = (sc * t + reflected) * 100;
    values.push(v); inside.push(v);
  }
  return { x0, y0, step: stepM, nx, ny, values, t, rho, reflected: reflected * 100, skyComponentMean: scs.length ? scs.reduce((a, v) => a + v, 0) / scs.length : null, stats: gridStats(inside) };
}

// ---------------------------------------------------------------------------------------------- annual summary
/** Clear-sky VSC (fraction) per month: the mean over the 15th's hourly sun positions, weighted by sin(sun altitude). */
export function monthlyClearComponent(prof, facing, panes, year, lat, lon, tz, day = 15, stepMin = 60) {
  const out = [];
  for (let mo = 0; mo < 12; mo++) {
    let num = 0, den = 0;
    for (const [, saz, salt] of dayTable(year, mo, day, lat, lon, tz, stepMin)) {
      const w = Math.sin(salt * DEG);
      num += w * verticalSkyComponent(prof, facing, panes, { kind: 'clear', sunAz: saz, sunAlt: salt });
      den += w;
    }
    out.push(den ? num / den : 0);
  }
  return out;
}

/** Direct-sun hours per day by month (clear sky, the 15th) for a window: the existing sun model, 6-minute steps. */
export function monthlyDirectSun(prof, facing, panes, year, lat, lon, tz, day = 15) {
  const out = [];
  for (let mo = 0; mo < 12; mo++) out.push(litInfo(dayTable(year, mo, day, lat, lon, tz, 6), prof, facing, 6, panes).min / 60);
  return out;
}

const r2 = (v) => Math.round(v * 100) / 100;
/**
 * Per-month direct sun, sky visibility and relative daylight for one window: three separate quantities.
 * `possible` = direct sun h/day by month (clear sky), `skyViewShare` the window's sky view (0-1), `fraction` NOAA's
 * monthly sunshine share or null (it scales direct sun only). Relative daylight = the window's VSC in percent of the
 * horizontal illuminance of the same unobstructed sky, under the overcast sky and (per month) the clear diffuse sky.
 * The two skies differ in absolute brightness, so they are never averaged.
 */
export function annualDaylight(prof, facing, panes, year, lat, lon, tz, possible, skyViewShare, fraction = null) {
  const oc = verticalSkyComponent(prof, facing, panes, null), cl = monthlyClearComponent(prof, facing, panes, year, lat, lon, tz);
  const have = Array.isArray(fraction) && fraction.length === 12;
  return {
    model: MODEL_LABEL,
    direct_sun: { possible_h_per_day: possible.map(r2), expected_h_per_day: have ? possible.map((h, i) => r2(h * fraction[i])) : null, kind: 'modelled' },
    sky_visibility: { share: Math.round(skyViewShare * 1000) / 1000, kind: 'modelled' },
    relative_daylight: { overcast_pct: r2(oc * 100), clear_pct: cl.map((c) => r2(c * 100)), kind: 'modelled', unit: "percent of the same sky's open horizontal illuminance" },
  };
}
