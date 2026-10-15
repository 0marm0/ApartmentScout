// Green space for the 3D city views: reads the site file's `green` block (OpenStreetMap parks, lawns,
// playgrounds, woods and mapped street trees in the site's metre frame) and decides where tree canopies stand.
// Pure and deterministic (no DOM, no three.js), so the same city draws the same trees every time and the
// maths is testable. The ground is drawn by unit/grassmesh.js, the trees by unit/treemesh.js.
//
// Mapped trees come straight from the file. Most real trees are not mapped, so park, wood and lawn areas also
// get canopies on a jittered grid: a drawing aid that shows where a window looks over trees, not a survey.
// Trees are context only: they are not obstructions in the sun hours.

export const KINDS = ['park', 'play', 'grass', 'wood'];
/** Per kind: grid spacing (m) and the chance a cell holds a tree. Playgrounds and `hard` surfaces get none from the grid. */
export const SCATTER = { park: [9, 0.75], wood: [7, 0.9], grass: [10, 0.4], play: [14, 0.12] };
export const TREE = { hMin: 8, hMax: 15, rMin: 3.4, rMax: 6.2 };
const MAX_PER_POLY = 900;

const num = (v) => Number.isFinite(+v) && v !== null && v !== '' && v !== true && v !== false;
const okPt = (q) => Array.isArray(q) && num(q[0]) && num(q[1]);
const okRing = (r) => Array.isArray(r) && r.length >= 3 && r.every(okPt);

/** A cleaned copy of site.green: only well-formed polygons of known kinds and finite tree coordinates (`turf`, `src` and `on_parks` are kept for the grass layers, unit/grassplan.js). */
export function cleanGreen(g) {
  if (!g || typeof g !== 'object') return null;
  const polys = (Array.isArray(g.polys) ? g.polys : []).filter((p) => p && KINDS.includes(p.kind) && okRing(p.ring))
    .map((p) => ({ kind: p.kind, name: typeof p.name === 'string' ? p.name : null, hard: !!p.hard, turf: !!p.turf, src: typeof p.src === 'string' ? p.src : null, on_parks: !!p.on_parks, ring: p.ring.map((q) => [+q[0], +q[1]]), holes: (Array.isArray(p.holes) ? p.holes : []).filter(okRing).map((h) => h.map((q) => [+q[0], +q[1]])) }));
  const t = Array.isArray(g.trees) ? g.trees : [], trees = [];
  for (let i = 0; i + 1 < t.length; i += 2) if (num(t[i]) && num(t[i + 1])) trees.push(+t[i], +t[i + 1]);
  if (!polys.length && !trees.length) return null;
  return { polys, trees, source: g.source || null, fetched: g.fetched || null };
}

/** 32-bit integer hash of up to three integers, as a number in [0, 1). */
export function hash01(a, b = 0, c = 0) {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function inRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi) inside = !inside;
  }
  return inside;
}
export const inPoly = (x, y, p) => inRing(x, y, p.ring) && !p.holes.some((h) => inRing(x, y, h));

/** Shoelace area of a ring (positive for counter-clockwise), in m². */
export function ringArea(r) {
  let a = 0;
  for (let i = 0; i < r.length; i++) { const [x1, y1] = r[i], [x2, y2] = r[(i + 1) % r.length]; a += x1 * y2 - x2 * y1; }
  return a / 2;
}

/**
 * Tree positions inside the polygons on a jittered grid, as a flat [x, y, x, y, ...] array. The stream is
 * deterministic per polygon index, so adding or removing a polygon elsewhere does not move the others.
 * `center`/`radius` keep only trees within `radius` metres of the centre; `limit` caps the total.
 */
export function scatterTrees(polys, { center = null, radius = Infinity, limit = 6000 } = {}) {
  const out = [];
  polys.forEach((p, k) => {
    if (p.hard || out.length / 2 >= limit) return;
    const [step, prob] = SCATTER[p.kind] || SCATTER.grass;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of p.ring) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    let n = 0;
    for (let ix = Math.floor(x0 / step); ix <= Math.ceil(x1 / step) && n < MAX_PER_POLY; ix++) {
      for (let iy = Math.floor(y0 / step); iy <= Math.ceil(y1 / step) && n < MAX_PER_POLY; iy++) {
        if (hash01(ix, iy, k + 11) > prob) continue;
        const x = (ix + 0.15 + 0.7 * hash01(ix, iy, k + 101)) * step, y = (iy + 0.15 + 0.7 * hash01(ix, iy, k + 211)) * step;
        if (center && Math.hypot(x - center[0], y - center[1]) > radius) continue;
        if (!inPoly(x, y, p)) continue;
        out.push(x, y); n++;
      }
    }
  });
  return out;
}

/** Height, canopy radius and a colour pick (0..1) for the tree at (x, y): the same tree every time. */
export function treeShape(x, y) {
  const a = hash01(Math.round(x * 4), Math.round(y * 4), 7), b = hash01(Math.round(x * 4), Math.round(y * 4), 19), c = hash01(Math.round(x * 4), Math.round(y * 4), 31);
  const h = TREE.hMin + (TREE.hMax - TREE.hMin) * a;
  const r = TREE.rMin + (TREE.rMax - TREE.rMin) * (0.4 * a + 0.6 * b);
  return { h, r, tone: c };
}

/**
 * Everything the 3D views draw: the cleaned polygons within the radius (a polygon is kept when any vertex or
 * its bounding box centre is near) and all tree positions (mapped trees plus the scattered ones) within it.
 */
export function greenPlan(g, { center = [0, 0], radius = 600, limit = 6000 } = {}) {
  const c = cleanGreen(g);
  if (!c) return null;
  const near = (x, y) => Math.hypot(x - center[0], y - center[1]) <= radius;
  const polys = c.polys.filter((p) => p.ring.some(([x, y]) => near(x, y)));
  const mapped = [];
  for (let i = 0; i < c.trees.length; i += 2) if (near(c.trees[i], c.trees[i + 1])) mapped.push(c.trees[i], c.trees[i + 1]);
  const room = Math.max(0, limit - mapped.length / 2);
  const scattered = scatterTrees(polys, { center, radius, limit: room });
  return { polys, trees: mapped.concat(scattered), mapped: mapped.length / 2, scattered: scattered.length / 2, source: c.source, fetched: c.fetched };
}
