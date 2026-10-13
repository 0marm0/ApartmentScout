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

export const angDiff = (a, b) => ((a - b + 540) % 360) - 180;
export const fmtT = (m) => { m = Math.round(m); let h = Math.floor(m / 60), mm = m % 60; const ap = h >= 12 && h < 24 ? 'pm' : 'am'; h = h % 12 || 12; return h + ':' + String(mm).padStart(2, '0') + ' ' + ap; };
export const fmtHM = (min) => { const h = Math.floor(min / 60), m = Math.round(min % 60); return h + ' h ' + String(m).padStart(2, '0') + ' m'; };

export function dayTable(y, mo, d, lat, lon, tz, step = 6) {
  const a = [];
  for (let m = 0; m < 1440; m += step) { const s = sunPos(zonedMs(y, mo, d, m, tz), lat, lon); if (s.alt > 0) a.push([m, s.az, s.alt]); }
  return a;
}

// Buildings: [{top, g, eg, p:[x,y,...], n, bb}]
export function prepBuildings(raw) {
  return raw.map((r, i) => {
    const p = r[3], n = p.length / 2;
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (let j = 0; j < n; j++) { const x = p[2 * j], y = p[2 * j + 1]; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    return { i, top: r[0], g: r[1], eg: r[2], p, n, bb: [x0, y0, x1, y1] };
  });
}

export const NB = 720;
export function horizonProfile(B, px, py, pz, skip = -1) {
  const out = new Float32Array(NB);
  for (let k = 0; k < NB; k++) out[k] = Math.atan(rayMax(B, px, py, pz, k * 0.5 * DEG, skip)) / DEG;
  return out;
}
function rayMax(B, px, py, pz, az, skip) {
  const ux = Math.sin(az), uy = Math.cos(az);
  let best = 0;
  for (let bi = 0; bi < B.length; bi++) {
    if (bi === skip) continue;
    const b = B[bi], sl = b.top - pz;
    if (sl <= 0) continue;
    let t0 = 0, t1 = 1e9;
    if (Math.abs(ux) < 1e-9) { if (px < b.bb[0] || px > b.bb[2]) continue; } else { let a = (b.bb[0] - px) / ux, c = (b.bb[2] - px) / ux; if (a > c) [a, c] = [c, a]; t0 = Math.max(t0, a); t1 = Math.min(t1, c); }
    if (Math.abs(uy) < 1e-9) { if (py < b.bb[1] || py > b.bb[3]) continue; } else { let a = (b.bb[1] - py) / uy, c = (b.bb[3] - py) / uy; if (a > c) [a, c] = [c, a]; t0 = Math.max(t0, a); t1 = Math.min(t1, c); }
    if (t1 < t0 || t1 <= 0.01) continue;
    if (sl / Math.max(t0, 0.01) <= best) continue;
    const p = b.p, n = b.n;
    let tmin = 1e9;
    for (let j = 0; j < n; j++) {
      const ax = p[2 * j], ay = p[2 * j + 1], j2 = (j + 1) % n, ex = p[2 * j2] - ax, ey = p[2 * j2 + 1] - ay;
      const den = ux * ey - uy * ex; if (Math.abs(den) < 1e-9) continue;
      const wx = ax - px, wy = ay - py, t = (wx * ey - wy * ex) / den, s = (wx * uy - wy * ux) / den;
      if (t > 0.01 && s >= 0 && s <= 1 && t < tmin) tmin = t;
    }
    if (tmin < 1e9) { const q = sl / tmin; if (q > best) best = q; }
  }
  return best;
}
export function horizonDir(B, px, py, pz, azDeg, skip) { return Math.atan(rayMax(B, px, py, pz, azDeg * DEG, skip)) / DEG; }
export function hAt(prof, az) { const f = (((az % 360) + 360) % 360) / 0.5, i = Math.floor(f) % NB, j = (i + 1) % NB, w = f - Math.floor(f); return prof[i] * (1 - w) + prof[j] * w; }

export function litInfo(tab, prof, facing, step = 6) {
  let c = 0; const segs = []; let cur = null;
  for (const [m, az, alt] of tab) {
    const lit = Math.abs(angDiff(az, facing)) < 90 && alt > hAt(prof, az);
    if (lit) { c += step; if (!cur) { cur = [m, m + step]; segs.push(cur); } else cur[1] = m + step; } else cur = null;
  }
  return { min: c, segs };
}

// Facades of the target building with outward bearings.
export function facesOf(b, minLen = 8) {
  const p = b.p, n = b.n; let area = 0;
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; area += p[2 * i] * p[2 * j + 1] - p[2 * j] * p[2 * i + 1]; }
  const out = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, x1 = p[2 * i], y1 = p[2 * i + 1], x2 = p[2 * j], y2 = p[2 * j + 1];
    const ex = x2 - x1, ey = y2 - y1, len = Math.hypot(ex, ey);
    if (len < minLen) continue;
    const nx = area > 0 ? ey : -ey, ny = area > 0 ? -ex : ex;
    const brg = ((Math.atan2(nx, ny) / DEG) + 360) % 360;
    out.push({ i, a: [x1, y1], b: [x2, y2], bearing: brg, length: len });
  }
  return out;
}
export const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export const compass = (d) => COMPASS[Math.round(((d % 360) + 360) % 360 / 22.5) % 16];
