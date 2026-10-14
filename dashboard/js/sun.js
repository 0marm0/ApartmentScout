// Solar position and skyline math shared by the Unit 3D and Floor plan views.
// Mirrors apartmentscout/sun.py so the dashboard and reports agree.
export const DEG = Math.PI / 180;
const dayMs = 864e5, J1970 = 2440588, J2000 = 2451545, OBL = DEG * 23.4397;

export function sunPos(ms, lat, lon) {
  const d = ms / dayMs - 0.5 + J1970 - J2000, lw = DEG * -lon, phi = DEG * lat;
  const M = DEG * (357.5291 + 0.98560028 * d);
  const C = DEG * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const L = M + C + DEG * 102.9372 + Math.PI;
  const dec = Math.asin(Math.sin(L) * Math.sin(OBL));
  const ra = Math.atan2(Math.sin(L) * Math.cos(OBL), Math.cos(L));
  const H = DEG * (280.16 + 360.9856235 * d) - lw - ra;
  const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi));
  const alt = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  return { az: ((az / DEG + 180) % 360 + 360) % 360, alt: alt / DEG };
}

// Local wall-clock time in an IANA zone -> UTC ms (handles DST without a library).
export function zonedMs(y, mo, d, minutes, tz) {
  const guess = Date.UTC(y, mo, d, 0, 0) + minutes * 60000;
  const off = tzOffsetMin(guess, tz);
  const first = guess - off * 60000;
  const off2 = tzOffsetMin(first, tz);
  return guess - off2 * 60000;
}
const fmtCache = {};
function tzOffsetMin(ms, tz) {
  const f = fmtCache[tz] || (fmtCache[tz] = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }));
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute);
  return Math.round((asUTC - ms) / 60000);
}
/** Short zone name (EDT, EST, CET ...) for a local date and time, for captions. */
export function zoneAbbr(y, mo, d, minutes, tz) {
  try {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' }).formatToParts(new Date(zonedMs(y, mo, d, minutes, tz)));
    return p.find((x) => x.type === 'timeZoneName')?.value || '';
  } catch { return ''; }
}

export const angDiff = (a, b) => ((a - b + 540) % 360) - 180;
export const fmtT = (m) => { m = Math.round(m); let h = Math.floor(m / 60), mm = m % 60; const ap = h >= 12 && h < 24 ? 'pm' : 'am'; h = h % 12 || 12; return h + ':' + String(mm).padStart(2, '0') + ' ' + ap; };
export const fmtHM = (min) => { const h = Math.floor(min / 60), m = Math.round(min % 60); return h + ' h ' + String(m).padStart(2, '0') + ' m'; };

export function dayTable(y, mo, d, lat, lon, tz, step = 6) {
  const a = [];
  for (let m = 0; m < 1440; m += step) { const s = sunPos(zonedMs(y, mo, d, m, tz), lat, lon); if (s.alt > 0) a.push([m, s.az, s.alt]); }
  return a;
}

// ------------------------------------------------------------------ buildings
const flat = (ring) => (Array.isArray(ring?.[0]) ? ring.flat() : ring || []);

const bboxOf = (p) => {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (let j = 0; j < p.length / 2; j++) { const x = p[2 * j], y = p[2 * j + 1]; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  return [x0, y0, x1, y1];
};
export const COMPONENT_KINDS = ['podium', 'tower', 'setback', 'bulkhead'];
/**
 * One component of a building (site JSON "components"): a prism from ground + base_m to ground + top_m with
 * its own ring. Returns null for an unusable entry (fewer than 3 finite points, or not 0 <= base_m < top_m).
 */
export function prepPart(c, g = 0) {
  if (!c || typeof c !== 'object') return null;
  const p = flat(c.ring), base = +(c.base_m ?? 0), top = +c.top_m;
  if (p.length < 6 || !p.every(Number.isFinite) || !Number.isFinite(base) || !Number.isFinite(top) || base < 0 || base >= top) return null;
  const holes = Array.isArray(c.holes) ? c.holes.map(flat).filter((a) => a.length >= 6 && a.every(Number.isFinite)) : [];
  return {
    p, n: p.length / 2, bb: bboxOf(p), holes, g, base: g + base, top: g + top, base_m: base, top_m: top,
    kind: COMPONENT_KINDS.includes(c.kind) ? c.kind : base > 0 ? 'setback' : 'podium',
    source: typeof c.source === 'string' ? c.source : '', confidence: typeof c.confidence === 'string' ? c.confidence : '', ref: typeof c.ref === 'string' ? c.ref : '',
  };
}

/**
 * Buildings: [{i, top, g, eg, p:[x,y,...], n, bb, holes:[[x,y,...], ...], parts}].
 * `holes` is the optional site JSON v2 map {"<index>": [ring, ...]} of inner rings (light courts).
 * `components` is the optional map {"<index>": [{ring, base_m, top_m, kind, source, confidence}, ...]}: when a
 * building has usable components they replace its single prism in every obstruction calculation (`parts`, else
 * null). As in apartmentscout/sun.py each part counts from the ground up in the skyline (one angle per direction).
 */
export function prepBuildings(raw, holes = null, components = null) {
  return raw.map((r, i) => {
    const p = r[3], n = p.length / 2;
    const hs = holes && (holes[i] ?? holes[String(i)]);
    const hl = Array.isArray(hs) ? hs.map(flat).filter((a) => a.length >= 6 && a.every(Number.isFinite)) : [];
    const cs = components && typeof components === 'object' ? components[i] ?? components[String(i)] : null;
    const parts = Array.isArray(cs) ? cs.map((c) => prepPart(c, r[1])).filter(Boolean) : [];
    return { i, top: r[0], g: r[1], eg: r[2], p, n, bb: bboxOf(p), holes: hl, parts: parts.length ? parts : null };
  });
}
/** The prisms that stand for building b in obstruction tests: its components, else the footprint itself. */
export const solidsOf = (b) => b.parts || [b];

/** Point in a flat ring [x,y,x,y,...] (even-odd rule). */
export function ringContains(p, x, y) {
  let inside = false;
  for (let i = 0, n = p.length / 2, j = n - 1; i < n; j = i++) {
    const xi = p[2 * i], yi = p[2 * i + 1], xj = p[2 * j], yj = p[2 * j + 1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
/** Inside the building's solid footprint: inside the outer ring and not inside a light court. */
export function insideBuilding(b, x, y) {
  if (x < b.bb[0] || x > b.bb[2] || y < b.bb[1] || y > b.bb[3]) return false;
  if (!ringContains(b.p, x, y)) return false;
  for (const h of b.holes || []) if (ringContains(h, x, y)) return false;
  return true;
}

export const NB = 720;
export function horizonProfile(B, px, py, pz, skip = -1) {
  const out = new Float32Array(NB);
  for (let k = 0; k < NB; k++) out[k] = Math.atan(rayMax(B, px, py, pz, k * 0.5 * DEG, skip)) / DEG;
  return out;
}
// Distance along a horizontal ray to the first wall of building b (outer ring or court), or 1e9.
function entryDist(b, px, py, ux, uy) {
  let tmin = 1e9;
  const rings = b.holes?.length ? [b.p, ...b.holes] : [b.p];
  for (const p of rings) {
    const n = p.length / 2;
    for (let j = 0; j < n; j++) {
      const ax = p[2 * j], ay = p[2 * j + 1], j2 = (j + 1) % n, ex = p[2 * j2] - ax, ey = p[2 * j2 + 1] - ay;
      const den = ux * ey - uy * ex; if (Math.abs(den) < 1e-9) continue;
      const wx = ax - px, wy = ay - py, t = (wx * ey - wy * ex) / den, s = (wx * uy - wy * ux) / den;
      if (t > 0.01 && s >= 0 && s <= 1 && t < tmin) tmin = t;
    }
  }
  return tmin;
}
function bbRange(b, px, py, ux, uy) {
  let t0 = 0, t1 = 1e9;
  if (Math.abs(ux) < 1e-9) { if (px < b.bb[0] || px > b.bb[2]) return null; } else { let a = (b.bb[0] - px) / ux, c = (b.bb[2] - px) / ux; if (a > c) [a, c] = [c, a]; t0 = Math.max(t0, a); t1 = Math.min(t1, c); }
  if (Math.abs(uy) < 1e-9) { if (py < b.bb[1] || py > b.bb[3]) return null; } else { let a = (b.bb[1] - py) / uy, c = (b.bb[3] - py) / uy; if (a > c) [a, c] = [c, a]; t0 = Math.max(t0, a); t1 = Math.min(t1, c); }
  return t1 < t0 || t1 <= 0.01 ? null : [t0, t1];
}
function rayMax(B, px, py, pz, az, skip) {
  const ux = Math.sin(az), uy = Math.cos(az);
  let best = 0;
  for (let bi = 0; bi < B.length; bi++) {
    if (bi === skip) continue;
    for (const b of solidsOf(B[bi])) {
      const sl = b.top - pz;
      if (sl <= 0) continue;
      const r = bbRange(b, px, py, ux, uy); if (!r) continue;
      if (sl / Math.max(r[0], 0.01) <= best) continue;
      const tmin = entryDist(b, px, py, ux, uy);
      if (tmin < 1e9) { const q = sl / tmin; if (q > best) best = q; }
    }
  }
  return best;
}
export function horizonDir(B, px, py, pz, azDeg, skip) { return Math.atan(rayMax(B, px, py, pz, azDeg * DEG, skip)) / DEG; }
export function hAt(prof, az) { const f = (((az % 360) + 360) % 360) / 0.5, i = Math.floor(f) % NB, j = (i + 1) % NB, w = f - Math.floor(f); return prof[i] * (1 - w) + prof[j] * w; }

/**
 * The building that stops a ray leaving (px,py,pz) at compass azimuth azDeg and altitude altDeg:
 * {bi, dist, z} for the nearest wall the ray meets below its roof, or null when the ray is clear.
 */
export function rayBlock(B, px, py, pz, azDeg, altDeg, skip = -1) {
  const ux = Math.sin(azDeg * DEG), uy = Math.cos(azDeg * DEG), k = Math.tan(Math.max(altDeg, -89) * DEG);
  let best = null;
  for (let bi = 0; bi < B.length; bi++) {
    if (bi === skip) continue;
    for (const b of solidsOf(B[bi])) {
      if (b.top <= pz) continue;
      const r = bbRange(b, px, py, ux, uy); if (!r) continue;
      if (best && r[0] >= best.dist) continue;
      const t = entryDist(b, px, py, ux, uy); if (t >= 1e9) continue;
      const z = pz + t * k;
      if (z < b.top && (!best || t < best.dist)) best = { bi, dist: t, z, part: B[bi].parts ? b : null };
    }
  }
  return best;
}

// ------------------------------------------------------------------ panes (bay windows)
// A window may have several panes: `panes` are bearing offsets from the facade normal (default [0];
// a 45 degree bay is [-45, 0, 45]). The sun is in the room when it is above the skyline at the window
// and in front of at least one pane (the union over panes). Mirrors apartmentscout/sun.py.
export const BAY = [-45, 0, 45];
export const paneFacings = (facing, panes = null) => (panes?.length ? panes : [0]).map((o) => (((facing + +o) % 360) + 360) % 360);
export const inFront = (az, facing, panes = null) => paneFacings(facing, panes).some((f) => Math.abs(angDiff(az, f)) < 90);

/**
 * Direct-sun minutes and lit segments for one day; with `panes` the union over panes, plus `panes`
 * (minutes through each pane on its own) and `side` (minutes when only a side pane sees the sun).
 */
export function litInfo(tab, prof, facing, step = 6, panes = null) {
  let c = 0, side = 0; const segs = []; let cur = null;
  const fs = paneFacings(facing, panes), per = fs.map(() => 0), multi = fs.length > 1;
  for (const [m, az, alt] of tab) {
    const above = alt > hAt(prof, az);
    let any = false;
    for (let i = 0; i < fs.length; i++) if (Math.abs(angDiff(az, fs[i])) < 90) { any = true; if (above) per[i] += step; }
    const lit = any && above;
    if (lit) {
      c += step; if (multi && Math.abs(angDiff(az, facing)) >= 90) side += step;
      if (!cur) { cur = [m, m + step]; segs.push(cur); } else cur[1] = m + step;
    } else cur = null;
  }
  return multi ? { min: c, segs, panes: per, side } : { min: c, segs };
}

/**
 * The state of a window through one day in `step`-minute slots from `from` to `to`:
 * 0 night, 1 sun behind the facade, 2 sun blocked by buildings, 3 direct sun,
 * 4 direct sun through a side pane only (bay windows: the facade normal does not face the sun).
 */
export function dayStates(y, mo, d, lat, lon, tz, prof, facing, from = 300, to = 1290, step = 5, panes = null) {
  const n = Math.ceil((to - from) / step), out = new Uint8Array(n);
  for (let k = 0; k < n; k++) {
    const s = sunPos(zonedMs(y, mo, d, from + k * step + step / 2, tz), lat, lon);
    if (s.alt <= 0) { out[k] = 0; continue; }
    if (!inFront(s.az, facing, panes)) { out[k] = 1; continue; }
    out[k] = s.alt <= hAt(prof, s.az) ? 2 : Math.abs(angDiff(s.az, facing)) < 90 ? 3 : 4;
  }
  return out;
}

/**
 * Who shades the window in each slot of a day strip: for every slot in state 2, the index of the
 * building the sun ray meets first (`rayBlock`), else the building that sets the skyline in that
 * direction; -1 for slots that are not shaded. `B` may include proposed buildings after the city.
 * Returns {states, bi: Int32Array, sun: [{az, alt}] per slot}.
 */
export function dayBlockers(y, mo, d, lat, lon, tz, B, pt, prof, facing, from = 300, to = 1290, step = 5, panes = null) {
  const states = dayStates(y, mo, d, lat, lon, tz, prof, facing, from, to, step, panes);
  const bi = new Int32Array(states.length).fill(-1);
  for (let k = 0; k < states.length; k++) {
    if (states[k] !== 2) continue;
    const s = sunPos(zonedMs(y, mo, d, from + k * step + step / 2, tz), lat, lon);
    const h = rayBlock(B, pt.x, pt.y, pt.z, s.az, s.alt, pt.skip ?? -1);
    bi[k] = h ? h.bi : skylineSetter(B, pt.x, pt.y, pt.z, s.az, pt.skip ?? -1);
  }
  return { states, bi };
}
/** Minutes shaded by each building in a dayBlockers result: Map bi -> minutes. */
export function blockerMinutes(res, step = 5) {
  const m = new Map();
  for (let k = 0; k < res.bi.length; k++) if (res.bi[k] >= 0) m.set(res.bi[k], (m.get(res.bi[k]) || 0) + step);
  return m;
}
/** The building whose wall sets the skyline at azimuth azDeg (largest elevation angle), or -1. */
export function skylineSetter(B, px, py, pz, azDeg, skip = -1) {
  const ux = Math.sin(azDeg * DEG), uy = Math.cos(azDeg * DEG);
  let best = 0, who = -1;
  for (let bi = 0; bi < B.length; bi++) {
    if (bi === skip) continue;
    for (const b of solidsOf(B[bi])) {
      const sl = b.top - pz; if (sl <= 0) continue;
      const r = bbRange(b, px, py, ux, uy); if (!r) continue;
      if (sl / Math.max(r[0], 0.01) <= best) continue;
      const t = entryDist(b, px, py, ux, uy);
      if (t < 1e9 && sl / t > best) { best = sl / t; who = bi; }
    }
  }
  return who;
}

/** Shortest distance from (x, y) to building b's outline (0 inside it). */
export function distToBuilding(b, x, y) {
  if (insideBuilding(b, x, y)) return 0;
  let best = Infinity;
  for (const p of [b.p, ...(b.holes || [])]) {
    const n = p.length / 2;
    for (let j = 0; j < n; j++) {
      const ax = p[2 * j], ay = p[2 * j + 1], j2 = (j + 1) % n, ex = p[2 * j2] - ax, ey = p[2 * j2 + 1] - ay, L = ex * ex + ey * ey;
      const t = L ? Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / L)) : 0;
      best = Math.min(best, Math.hypot(x - ax - ex * t, y - ay - ey * t));
    }
  }
  return best;
}
/** Compass bearing from (x0, y0) to (x1, y1) in the local metre frame. */
export const bearingTo = (x0, y0, x1, y1) => ((Math.atan2(x1 - x0, y1 - y0) / DEG) + 360) % 360;

// ------------------------------------------------------------------ diffuse sky (relative model, not lux)
// Mirrors apartmentscout/sun.py: a vertical window under a CIE standard overcast sky, L(alt) ∝ (1 + 2 sin alt) / 3,
// weighted by cos(incidence) = cos(alt) cos(d) and the solid angle cos(alt) dalt dd. In altitude the integral is
// closed form: G(h) = F(90°) − F(h), F(a) = (a/2 + sin 2a / 4 − (2/3) cos³a) / 3.
export const FIELD_DEG = 80;
export const DAYLIGHT_DEFAULTS = { transmittance: 0.6, glazed_area_m2: 3.0, room_surface_m2: 88.6, reflectance: 0.5 };
const cieF = (a) => (a / 2 + Math.sin(2 * a) / 4 - (2 / 3) * Math.cos(a) ** 3) / 3;
const CIE_TOP = cieF(Math.PI / 2);
/** CIE-overcast, cosine-weighted sky light on a vertical window from altitudes above h degrees. */
export const cieAbove = (h) => CIE_TOP - cieF(Math.min(90, Math.max(0, +h || 0)) * DEG);
/**
 * Visible-sky share for a window (0–1) relative to an unobstructed one: azimuths at the middle of each `step`
 * degree bin within `field` degrees of a pane normal, weighted by the cosine of that angle (the nearest pane).
 */
export function skyView(prof, facing, panes = null, field = FIELD_DEG, step = 1) {
  const fs = paneFacings(facing, panes), full = cieAbove(0);
  let num = 0, den = 0;
  for (let k = 0, n = Math.round(360 / step); k < n; k++) {
    const az = (k + 0.5) * step;
    let d = 180; for (const f of fs) d = Math.min(d, Math.abs(angDiff(az, f)));
    if (d >= field) continue;
    const w = Math.cos(d * DEG);
    num += w * cieAbove(hAt(prof, az)); den += w * full;
  }
  return den ? num / den : 0;
}
/**
 * Indicative average daylight factor (%): BRE T·Aw·θ / (A·(1 − R²)) with θ = 90° × sky view. An estimate from
 * assumed room and glazing values (DAYLIGHT_DEFAULTS unless given), never a measurement.
 */
export function daylightFactor(sv, o = {}) {
  const d = DAYLIGHT_DEFAULTS, T = o.transmittance ?? d.transmittance, Aw = o.glazed_area_m2 ?? d.glazed_area_m2, A = o.room_surface_m2 ?? d.room_surface_m2, R = o.reflectance ?? d.reflectance;
  return (T * Aw * 90 * Math.max(0, Math.min(1, sv))) / (A * (1 - R * R));
}
/** Percent of possible sunshine by month (NOAA, New York Central Park, climate normals 1961–1990). */
export const SUNSHINE = { nyc: { fraction: [0.54, 0.55, 0.57, 0.57, 0.57, 0.57, 0.59, 0.63, 0.59, 0.61, 0.51, 0.48], place: 'New York Central Park', source: 'NOAA climate normals 1961-1990, percent of possible sunshine' } };
export const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
/** Expected direct sun = possible (clear-sky) hours × the month's sunshine fraction; yearly sums use days per month. */
export function expectedSun(possible, fraction = null) {
  const yp = possible.reduce((a, h, i) => a + h * DAYS_IN_MONTH[i], 0);
  if (!fraction || fraction.length !== 12) return { possible: Math.round(yp), expected: null, monthly: null };
  const monthly = possible.map((h, i) => Math.round(h * fraction[i] * 100) / 100);
  return { possible: Math.round(yp), expected: Math.round(possible.reduce((a, h, i) => a + h * fraction[i] * DAYS_IN_MONTH[i], 0)), monthly };
}

// ------------------------------------------------------------------ facades
function signedArea(p) {
  let a = 0; const n = p.length / 2;
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; a += p[2 * i] * p[2 * j + 1] - p[2 * j] * p[2 * i + 1]; }
  return a / 2;
}

/**
 * Facades of the target building with outward bearings: every outer-ring edge at least `minLen` long and,
 * when the footprint has light courts, every court edge (facing into the court, `court: true`).
 * Pass the site's buildings as `B` to find party walls: points sampled 1 m outside each facade that fall inside
 * another footprint mean a neighbour is built against it. Such a face gets `shared: true` (less than 4 m of it
 * is clear) and `open` lists the positions along it (0..1) that are clear, so a window is never put
 * on a shared wall.
 */
export function facesOf(b, minLen = 8, B = null) {
  const out = [];
  const rings = [[b.p, false], ...(b.holes || []).map((h) => [h, true])];
  rings.forEach(([p, court], ri) => {
    const n = p.length / 2, area = signedArea(p);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, x1 = p[2 * i], y1 = p[2 * i + 1], x2 = p[2 * j], y2 = p[2 * j + 1];
      const ex = x2 - x1, ey = y2 - y1, len = Math.hypot(ex, ey);
      if (len < minLen) continue;
      // outer ring: outward is to the right of a counter-clockwise ring; a court ring: into the court
      const ccw = area > 0, nx = court ? (ccw ? -ey : ey) : (ccw ? ey : -ey), ny = court ? (ccw ? ex : -ex) : (ccw ? -ex : ex);
      const brg = ((Math.atan2(nx, ny) / DEG) + 360) % 360;
      const f = { i: ri === 0 ? i : ri * 1000 + i, a: [x1, y1], b: [x2, y2], bearing: brg, length: len, court, shared: false, open: null, openFrac: 1 };
      if (B) {
        const ux = nx / len, uy = ny / len, N = Math.max(5, Math.min(31, Math.round(len / 2)));
        const open = [];
        for (let k = 0; k < N; k++) {
          const t = (k + 0.5) / N, sx = x1 + ex * t + ux * 1.0, sy = y1 + ey * t + uy * 1.0;
          let hit = false;
          for (const o of B) { if (o === b) continue; if (insideBuilding(o, sx, sy)) { hit = true; break; } }
          if (!hit) open.push(t);
        }
        f.open = open; f.openFrac = open.length / N; f.shared = f.openFrac * len < 4; // same rule as apartmentscout/sun.py
      }
      out.push(f);
    }
  });
  return out;
}
/** The clear position on a facade nearest to t (or t itself when the face has no party-wall samples). */
export function snapOpen(face, t) {
  if (!face?.open || !face.open.length) return t;
  let best = face.open[0];
  for (const o of face.open) if (Math.abs(o - t) < Math.abs(best - t)) best = o;
  // inside a clear stretch, keep the user's exact position
  const step = 1 / Math.max(5, Math.min(31, Math.round(face.length / 2)));
  return Math.abs(best - t) <= step / 2 ? t : best;
}

/** Nearest named street a facade looks onto: the first centreline crossed by the outward ray within maxD m. */
export function streetAhead(streets, x, y, bearing, maxD = 70) {
  if (!streets?.length) return null;
  const ux = Math.sin(bearing * DEG), uy = Math.cos(bearing * DEG);
  let best = null;
  for (const s of streets) {
    const pts = s.pts || [];
    for (let k = 0; k + 1 < pts.length; k++) {
      const ax = pts[k][0], ay = pts[k][1], ex = pts[k + 1][0] - ax, ey = pts[k + 1][1] - ay;
      const den = ux * ey - uy * ex; if (Math.abs(den) < 1e-9) continue;
      const wx = ax - x, wy = ay - y, t = (wx * ey - wy * ex) / den, sg = (wx * uy - wy * ux) / den;
      if (t > 0 && t < maxD && sg >= 0 && sg <= 1 && (!best || t < best.dist)) best = { name: s.name, dist: t };
    }
  }
  return best;
}

export const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export const compass = (d) => COMPASS[Math.round(((d % 360) + 360) % 360 / 22.5) % 16];
