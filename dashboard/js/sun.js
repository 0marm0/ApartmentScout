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

/**
 * Buildings: [{i, top, g, eg, p:[x,y,...], n, bb, holes:[[x,y,...], ...]}].
 * `holes` is the optional site JSON v2 map {"<index>": [ring, ...]} of inner rings (light courts).
 */
export function prepBuildings(raw, holes = null) {
  return raw.map((r, i) => {
    const p = r[3], n = p.length / 2;
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (let j = 0; j < n; j++) { const x = p[2 * j], y = p[2 * j + 1]; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const hs = holes && (holes[i] ?? holes[String(i)]);
    const hl = Array.isArray(hs) ? hs.map(flat).filter((a) => a.length >= 6 && a.every(Number.isFinite)) : [];
    return { i, top: r[0], g: r[1], eg: r[2], p, n, bb: [x0, y0, x1, y1], holes: hl };
  });
}

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
    const b = B[bi], sl = b.top - pz;
    if (sl <= 0) continue;
    const r = bbRange(b, px, py, ux, uy); if (!r) continue;
    if (sl / Math.max(r[0], 0.01) <= best) continue;
    const tmin = entryDist(b, px, py, ux, uy);
    if (tmin < 1e9) { const q = sl / tmin; if (q > best) best = q; }
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
    const b = B[bi]; if (b.top <= pz) continue;
    const r = bbRange(b, px, py, ux, uy); if (!r) continue;
    if (best && r[0] >= best.dist) continue;
    const t = entryDist(b, px, py, ux, uy); if (t >= 1e9) continue;
    const z = pz + t * k;
    if (z < b.top && (!best || t < best.dist)) best = { bi, dist: t, z };
  }
  return best;
}

export function litInfo(tab, prof, facing, step = 6) {
  let c = 0; const segs = []; let cur = null;
  for (const [m, az, alt] of tab) {
    const lit = Math.abs(angDiff(az, facing)) < 90 && alt > hAt(prof, az);
    if (lit) { c += step; if (!cur) { cur = [m, m + step]; segs.push(cur); } else cur[1] = m + step; } else cur = null;
  }
  return { min: c, segs };
}

/**
 * The state of a window through one day in `step`-minute slots from `from` to `to`:
 * 0 night, 1 sun behind the facade, 2 sun blocked by buildings, 3 direct sun.
 */
export function dayStates(y, mo, d, lat, lon, tz, prof, facing, from = 300, to = 1290, step = 5) {
  const n = Math.ceil((to - from) / step), out = new Uint8Array(n);
  for (let k = 0; k < n; k++) {
    const s = sunPos(zonedMs(y, mo, d, from + k * step + step / 2, tz), lat, lon);
    out[k] = s.alt <= 0 ? 0 : Math.abs(angDiff(s.az, facing)) >= 90 ? 1 : s.alt <= hAt(prof, s.az) ? 2 : 3;
  }
  return out;
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
