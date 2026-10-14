// Neighbourhood heights for Unit 3D: height classes for the map legend and the 3D Heights layer, the roofs around
// a point summarised by compass direction, which roofs to label, and "what if this building were taller or
// shorter" (a scaled copy of a prepared building that every sun and skyline calculation accepts). Pure functions,
// no DOM, so node tests cover them.

/** Upper bounds (metres above the building's own ground) of the height classes; the last class is open. */
export const HCLASS = [12, 35, 60, 90, 150, 250];
export const HCLASS_LABELS = ['under 12 m', '12–35 m', '35–60 m', '60–90 m', '90–150 m', '150–250 m', '250 m +'];
/** Class index 0..HCLASS.length for a height in metres (non-finite heights fall in class 0). */
export function heightClass(h) {
  const v = Number.isFinite(+h) ? +h : 0;
  let i = 0; while (i < HCLASS.length && v >= HCLASS[i]) i++;
  return i;
}
/** Approximate storeys for a height (3.2 m a floor), for labels such as "62 m · ~19 fl". */
export const storeys = (h, fh = 3.2) => Math.max(1, Math.round(h / fh));
export const toFeet = (m) => Math.round(m * 3.281);

export const DIR8 = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
/** Sector index of a bearing for n equal sectors centred on N (0), NE (1), ... */
export function sectorOf(brg, n = 8) {
  const w = 360 / n;
  return Math.floor(((((+brg % 360) + 360) % 360) + w / 2) / w) % n;
}
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/**
 * Roofs around a point by compass direction. rows: [{h, dist, brg, name?, bi?, future?}] (h: height above the
 * building's ground, dist: metres to the nearest edge, brg: bearing from the point). Returns one entry per sector:
 * {i, dir, from, to, count, tallest, nearest, median, above} where `above` counts roofs higher than `eye` (metres
 * above the street; null skips it). Proposed buildings count only when `future` is true.
 */
export function sectorHeights(rows, { n = 8, radius = 150, eye = null, future = false } = {}) {
  const w = 360 / n, out = Array.from({ length: n }, (_, i) => ({ i, dir: n === 8 ? DIR8[i] : String(Math.round(i * w)), from: (i * w - w / 2 + 360) % 360, to: i * w + w / 2, count: 0, tallest: null, nearest: null, median: null, above: 0, hs: [] }));
  for (const r of rows || []) {
    if (!r || !Number.isFinite(+r.h) || !Number.isFinite(+r.dist) || !Number.isFinite(+r.brg)) continue;
    if (+r.dist > radius || (r.future && !future)) continue;
    const s = out[sectorOf(r.brg, n)];
    s.count++; s.hs.push(+r.h);
    if (!s.tallest || +r.h > s.tallest.h) s.tallest = r;
    if (!s.nearest || +r.dist < s.nearest.dist) s.nearest = r;
    if (eye != null && +r.h > eye) s.above++;
  }
  for (const s of out) { s.median = median(s.hs); delete s.hs; }
  return out;
}

/**
 * Which buildings get a height label on a map or in 3D: the nearest few, then the tallest, skipping any closer
 * than `minSep` metres to one already chosen. rows need {x, y, h, dist}; returns at most `max` rows.
 */
export function pickLabels(rows, { max = 16, near = 6, minSep = 28, radius = 300 } = {}) {
  const pool = (rows || []).filter((r) => r && Number.isFinite(r.x) && Number.isFinite(r.y) && r.dist <= radius && r.h > 0);
  const chosen = [];
  const ok = (r) => chosen.every((c) => Math.hypot(c.x - r.x, c.y - r.y) >= minSep);
  for (const r of [...pool].sort((a, b) => a.dist - b.dist).slice(0, near)) if (chosen.length < max && ok(r)) chosen.push(r);
  for (const r of [...pool].sort((a, b) => b.h - a.h)) { if (chosen.length >= max) break; if (!chosen.includes(r) && ok(r)) chosen.push(r); }
  return chosen;
}

/**
 * A copy of a prepared building (sun.js prepBuildings) whose height above its ground is `newH` metres: the roof
 * and every component's base and top scale by the same factor, so a podium-and-tower keeps its proportions.
 * newH <= 0 flattens it (it no longer blocks anything above its ground).
 */
export function scaleBuilding(b, newH) {
  const h0 = b.top - b.g, h1 = Math.max(0, +newH || 0), k = h0 > 0 ? h1 / h0 : 0;
  const s = (z) => b.g + (z - b.g) * k;
  const out = { ...b, top: h0 > 0 ? s(b.top) : b.g + h1, scaled: { from: h0, to: h1 } };
  if (b.parts) out.parts = b.parts.map((q) => ({ ...q, base: s(q.base), top: s(q.top), base_m: q.base_m * k, top_m: q.top_m * k }));
  return out;
}
/** B with every edited building replaced: edits is a Map(index -> new height in metres). B itself is not changed. */
export function applyEdits(B, edits) {
  if (!edits || !edits.size) return B;
  return B.map((b, i) => (edits.has(i) ? scaleBuilding(b, edits.get(i)) : b));
}

/**
 * The slices of a 360° panorama: n cameras, each `360/n` degrees wide, starting at `start` (a bearing).
 * Returns [{yaw (bearing of the slice centre), x0, x1 (fractions of the strip)}].
 */
export function panoramaSlices(n = 8, start = 0) {
  return Array.from({ length: n }, (_, i) => ({ yaw: (((start + (i + 0.5) * (360 / n)) % 360) + 360) % 360, x0: i / n, x1: (i + 1) / n }));
}
/** Horizontal position (0..1) of a bearing on a strip that starts at `start` and covers 360°. */
export const stripX = (brg, start = 0) => ((((brg - start) % 360) + 360) % 360) / 360;
