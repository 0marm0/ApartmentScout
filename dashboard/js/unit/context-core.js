// Pure helpers for the city context (no DOM, no three.js): the street ribbons of the ground plate, the water
// polygons read from the site file, and where to put labels for large parks and rivers. Drawing is in
// unit/groundtex.js (canvas) and unit/context3d.js (three.js), so all of this is testable in node.
import { inRing, ringArea } from './green.js';

const fin = (v) => Number.isFinite(+v) && v !== null && v !== '' && v !== true && v !== false;

// ------------------------------------------------------------------ streets: roadbed and sidewalks

/** Sidewalk width (m) beside each kerb of a street, by how it is built: none for highways, ramps, tunnels and alleys. */
export function sidewalkWidth(street) {
  const w = fin(street?.width_m) ? +street.width_m : 0, name = String(street?.name || '');
  if (/\b(Dr|Drive|Expwy|Pkwy|Fwy|Tunl|Tunnel|Exit|Entrance|Ramp|Bridge|Br|Hwy|Alley)\b/i.test(name) || /^Alley$/i.test(name) || (w && w < 6.5)) return 0;
  return w >= 18 ? 4.6 : 4.0;   // Manhattan: ~4 m on a 60 ft street, ~4.6 m on an avenue
}
/** Default roadbed width (m) when the street data carries none. */
export const DEFAULT_ROAD_M = 10.5;

/** Cleaned street polylines for painting: [{pts: [[x, y], ...], road: roadbed width, walk: sidewalk width each side}]. */
export function streetStrokes(streets) {
  const out = [];
  for (const s of Array.isArray(streets) ? streets : []) {
    const pts = (Array.isArray(s?.pts) ? s.pts : []).filter((q) => Array.isArray(q) && fin(q[0]) && fin(q[1])).map((q) => [+q[0], +q[1]]);
    if (pts.length < 2) continue;
    const road = fin(s.width_m) && +s.width_m > 0 ? Math.min(40, +s.width_m) : DEFAULT_ROAD_M;
    out.push({ pts, road, walk: sidewalkWidth({ ...s, width_m: road }), name: s.name || null });
  }
  return out;
}

// ------------------------------------------------------------------ water

/**
 * The site file's `water` block as arrays of [x, y] rings in metres (the file stores integer multiples of `q_m`),
 * or null. {half, polys: [{name, rings}], labels: [{name, x, y}]}.
 */
export function decodeWater(w) {
  if (!w || typeof w !== 'object' || !Array.isArray(w.polys)) return null;
  const q = fin(w.q_m) && +w.q_m > 0 ? +w.q_m : 0.5, half = fin(w.half_m) && +w.half_m > 0 ? +w.half_m : 800;
  const polys = [];
  for (const p of w.polys) {
    const rings = [];
    for (const r of Array.isArray(p?.rings) ? p.rings : []) {
      if (!Array.isArray(r) || r.length < 6) continue;
      const ring = []; for (let i = 0; i + 1 < r.length; i += 2) if (fin(r[i]) && fin(r[i + 1])) ring.push([+r[i] * q, +r[i + 1] * q]);
      if (ring.length >= 3) rings.push(ring);
    }
    if (rings.length) polys.push({ name: typeof p.name === 'string' ? p.name : null, rings });
  }
  if (!polys.length) return null;
  const labels = (Array.isArray(w.labels) ? w.labels : []).filter((l) => l && typeof l.name === 'string' && fin(l.x) && fin(l.y)).map((l) => ({ name: l.name, x: +l.x, y: +l.y }));
  return { half, polys, labels, source: w.source || null, fetched: w.fetched || null };
}

// ------------------------------------------------------------------ labels

/**
 * A good spot for a label inside a polygon: the sampled point farthest from its edges (a grid approximation of the
 * pole of inaccessibility), so the label sits in the middle of a long thin park rather than on its centroid.
 */
export function labelPoint(ring, holes = [], cells = 16) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of ring) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const edges = [ring, ...holes], dist = (x, y) => {
    let best = Infinity;
    for (const r of edges) for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [ax, ay] = r[j], [bx, by] = r[i], dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy + 1e-12)));
      best = Math.min(best, Math.hypot(x - ax - t * dx, y - ay - t * dy));
    }
    return best;
  };
  let best = null, bd = -1;
  for (let i = 0; i <= cells; i++) for (let j = 0; j <= cells; j++) {
    const x = x0 + ((x1 - x0) * i) / cells, y = y0 + ((y1 - y0) * j) / cells;
    if (!inRing(x, y, ring) || holes.some((h) => inRing(x, y, h))) continue;
    const d = dist(x, y) - 1e-3 * Math.hypot(x - (x0 + x1) / 2, y - (y0 + y1) / 2);   // ties (a long thin park) go to the middle
    if (d > bd) { bd = d; best = [x, y]; }
  }
  return best || [(x0 + x1) / 2, (y0 + y1) / 2];
}

/** Named parks big enough to label: [{kind: 'park', name, x, y, area}], largest first, at most `max`. */
export function parkLabels(green, { minArea = 5000, max = 5 } = {}) {
  const out = [];
  for (const p of Array.isArray(green?.polys) ? green.polys : []) {
    if (!p || typeof p.name !== 'string' || !p.name.trim() || !Array.isArray(p.ring) || p.ring.length < 3 || p.kind === 'play') continue;
    const area = Math.abs(ringArea(p.ring)); if (area < minArea) continue;
    const [x, y] = labelPoint(p.ring, Array.isArray(p.holes) ? p.holes : []);
    out.push({ kind: 'park', name: p.name.trim(), x, y, area });
  }
  return out.sort((a, b) => b.area - a.area).slice(0, max);
}

/** Water labels from the site file: [{kind: 'water', name, x, y}]. */
export function waterLabels(water, { max = 3 } = {}) {
  const w = decodeWater(water);
  return (w?.labels || []).slice(0, max).map((l) => ({ kind: 'water', name: l.name, x: l.x, y: l.y }));
}

/** Every label the city context offers, rivers first: [{kind: 'water' | 'park', name, x, y}] in site metres. */
export function contextLabels(site) {
  return [...waterLabels(site?.water), ...parkLabels(site?.green).map(({ kind, name, x, y }) => ({ kind, name, x, y }))];
}

/** Half the side (m) of the square window the ground and water textures cover. */
export function windowHalf(site, fallback = 800) {
  const h = +site?.water?.half_m; return fin(h) && h > 0 ? h : fallback;
}
