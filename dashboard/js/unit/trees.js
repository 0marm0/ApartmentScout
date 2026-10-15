// Trees for the 3D city views: which trees stand where, and how big. Pure and deterministic (no DOM, no three.js),
// so the same site draws the same trees every time and the maths is testable. Drawing lives in unit/treemesh.js,
// the layer that assembles trees, water and ground is unit/context3d.js.
//
// Four sources, in this order of trust:
//   1. the NYC Street Tree Census in the site file (`green.census`: x, y, trunk diameter in inches, genus group),
//      the street trees the city counted in 2015 and still lists (removed ones are dropped when the site is built),
//      with a crown sized from its trunk by `crownRadius` / `treeHeight`;
//   2. the NYC Parks Forestry inventory (`green.forestry`: x, y, trunk diameter, genus group, park / street): the
//      trees inside parks and on park property, and street trees planted since the census, sized from their current
//      trunk. Park trees are drawn wherever the inventory has them;
//   3. trees mapped in OpenStreetMap (`green.trees`), at the typical street-tree size, skipped where a census or
//      inventory tree stands within `DEDUPE_M` (those are the better record of the same tree);
//   4. fill: park, wood and lawn polygons that no inventory describes get canopies by Poisson-disc sampling (blue-noise
//      spacing, no two crowns closer than the kind's `minDist`), with groves and clearings, denser along the park edge;
//      where it applies is decided in unit/parkfill.js. A drawing aid that shows where a window looks over trees, not a
//      survey: only the first three are records of real trees.
// Every tree is a *street* tree (census, street inventory, mapped trees outside every park) or a *park* tree (park
// inventory, fill, mapped trees inside a park polygon): the layer controls switch the two kinds separately.
// Trees are context only: they are never obstructions in the sun hours (canopies are seasonal and porous).

import { hash01, inRing, inPoly, ringArea } from './green.js';
import { polyIndex, fillTargets, treeIndex, polyArea } from './parkfill.js';
import { labelPoint } from './context-core.js';   // [park trees] which polygons get fill, polygon lookup

/** Crown-colour classes, in the order geo/trees.py stores them. */
export const GROUPS = ['other', 'plane', 'oak', 'maple', 'locust', 'linden', 'ornamental', 'elm', 'ginkgo', 'conifer'];
export const CONIFER = GROUPS.indexOf('conifer');
/** Per group: crown width and height multipliers (ginkgo narrow, elm vase-shaped and wide). Conifers are drawn as cones. */
export const SHAPE = {
  other: { sx: 1, sy: 1 }, plane: { sx: 1.08, sy: 1 }, oak: { sx: 1.1, sy: 0.92 }, maple: { sx: 1, sy: 1 }, locust: { sx: 1.05, sy: 0.88 },
  linden: { sx: 0.95, sy: 1.05 }, ornamental: { sx: 0.9, sy: 0.85 }, elm: { sx: 1.12, sy: 0.95 }, ginkgo: { sx: 0.74, sy: 1.18 }, conifer: { sx: 0.72, sy: 1.3 },
};

// Allometry: the same rule as geo/trees.py (crown_radius_m, tree_height_m), checked against tests/fixtures/tree_allometry.json.
// Crown diameter = 1.2 m + 0.19 m per cm of trunk diameter, capped at 16 m; height = 1.3 m + 0.62 x DBH(cm)^0.82, capped at 24 m
// (rounded typical values for open-grown urban trees; geo/trees.py has the derivation and the figures it was fitted to).
export const CM_PER_IN = 2.54;
export const ALLOMETRY = { crownBase: 1.2, crownPerCm: 0.19, crownMax: 16, heightBase: 1.3, heightCoef: 0.62, heightExp: 0.82, heightMax: 24 };
export const crownRadius = (dbhIn) => Math.min(ALLOMETRY.crownMax, ALLOMETRY.crownBase + ALLOMETRY.crownPerCm * Math.max(0, +dbhIn || 0) * CM_PER_IN) / 2;
export const treeHeight = (dbhIn) => Math.min(ALLOMETRY.heightMax, ALLOMETRY.heightBase + ALLOMETRY.heightCoef * Math.pow(Math.max(0, +dbhIn || 0) * CM_PER_IN, ALLOMETRY.heightExp));

/** The census is from 2015: the 1,195 census trees matched to the live NYC Parks inventory grew a median 1.0 in in about a decade, so a census tree is sized from its surveyed diameter plus this (geo/trees.py GROWTH_IN). */
export const GROWTH_IN = 1;
/** Where one tree is dropped in favour of another: an OpenStreetMap tree this close to a census tree is the same tree. */
export const DEDUPE_M = 2.5;
/** Typical trunk diameter (inches) of a mapped OpenStreetMap tree, which carries no size. */
export const MAPPED_DBH_IN = 9;

/**
 * Poisson-disc fill per polygon kind: `minDist` is the closest two crowns stand (m, centre to centre), `dbh` the
 * trunk diameter in inches [median, spread], `grove` carves clearings out of the fill with low-frequency noise (about
 * a sixth of a park is open), `edge` plants the boundary regardless (park perimeters are tree-lined). Calibrated to the
 * NYC Parks inventory around Midtown (St. Vartan Park about 95 trees a hectare, malls and playgrounds 165-245): a park
 * about 120-140 trees per hectare, a wood about 220, a lawn about 22. Playgrounds and hard surfaces get none.
 */
export const FILL = {
  park: { minDist: 6.8, dbh: [14, 0.45], grove: true, edge: 9, noiseScale: 55 },
  wood: { minDist: 5.4, dbh: [10, 0.4], grove: false, edge: 0, noiseScale: 70 },
  grass: { minDist: 18, dbh: [12, 0.4], grove: false, edge: 6, noiseScale: 70 },
  lawn: { minDist: 8.5, dbh: [11, 0.4], grove: false, edge: 9, ring: 1500, noiseScale: 70 },   // a lawn that stands alone: planted at its edge (a small one all over)
  play: { minDist: 16, dbh: [11, 0.4], grove: false, edge: 6, noiseScale: 70 },
};
export const MAX_FILL_PER_POLY = 900;

// ------------------------------------------------------------------ census

const fin = (v) => Number.isFinite(+v) && v !== null && v !== '' && v !== true && v !== false;

/**
 * Decode the site file's `green.census` into parallel arrays {n, x, y, dbh, grp} (metres, inches, group index), or null.
 * Malformed quadruples (non-finite numbers, a group out of range) are dropped; the group falls back to `other`.
 */
export function decodeCensus(block) {
  if (!block || typeof block !== 'object' || !Array.isArray(block.pts)) return null;
  const q = fin(block.q_m) && +block.q_m > 0 ? +block.q_m : 0.5, p = block.pts, n = Math.floor(p.length / 4);
  const x = [], y = [], dbh = [], grp = [];
  for (let i = 0; i < n; i++) {
    const a = p[4 * i], b = p[4 * i + 1], d = p[4 * i + 2], g = p[4 * i + 3];
    if (!fin(a) || !fin(b) || !fin(d)) continue;
    x.push(+a * q); y.push(+b * q); dbh.push(Math.max(0, +d)); grp.push(Number.isInteger(+g) && +g >= 0 && +g < GROUPS.length ? +g : 0);
  }
  return x.length ? { n: x.length, x, y, dbh, grp, source: block.source || null, date: block.date || null, groups: Array.isArray(block.groups) ? block.groups : GROUPS } : null;
}

/**
 * Decode `green.forestry` (the NYC Parks inventory) into parallel arrays {n, x, y, dbh, grp, loc} where `loc` is 0 for a park
 * tree and 1 for a street tree planted since the census, or null. Five numbers a tree: x, y (multiples of `q_m` m), trunk
 * diameter (in), group, loc. Malformed entries are dropped.
 */
export function decodeForestry(block) {
  if (!block || typeof block !== 'object' || !Array.isArray(block.pts)) return null;
  const q = fin(block.q_m) && +block.q_m > 0 ? +block.q_m : 0.5, p = block.pts, n = Math.floor(p.length / 5);
  const x = [], y = [], dbh = [], grp = [], loc = [];
  for (let i = 0; i < n; i++) {
    const a = p[5 * i], b = p[5 * i + 1], d = p[5 * i + 2], g = p[5 * i + 3], l = p[5 * i + 4];
    if (!fin(a) || !fin(b) || !fin(d)) continue;
    x.push(+a * q); y.push(+b * q); dbh.push(Math.max(0, +d)); grp.push(Number.isInteger(+g) && +g >= 0 && +g < GROUPS.length ? +g : 0); loc.push(+l === 1 ? 1 : 0);
  }
  return x.length ? { n: x.length, x, y, dbh, grp, loc, source: block.source || null, date: block.date || null } : null;
}

// ------------------------------------------------------------------ noise, random streams

/** Smooth value noise in [0, 1] at (x, y) with feature size `scale` metres, from an integer seed. */
export function valueNoise(x, y, scale, seed = 0) {
  const u = x / scale, v = y / scale, i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j;
  const s = (t) => t * t * (3 - 2 * t), a = s(fu), b = s(fv);
  const h = (di, dj) => hash01(i + di, j + dj, seed + 4001);
  return (h(0, 0) * (1 - a) + h(1, 0) * a) * (1 - b) + (h(0, 1) * (1 - a) + h(1, 1) * a) * b;
}
/** A small deterministic random stream (mulberry32) from an integer seed. */
export function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function edgeDistance(x, y, ring) {
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x1, y1] = ring[j], [x2, y2] = ring[i], dx = x2 - x1, dy = y2 - y1, t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy + 1e-12)));
    best = Math.min(best, Math.hypot(x - x1 - t * dx, y - y1 - t * dy));
  }
  return best;
}

// ------------------------------------------------------------------ Poisson-disc fill

/**
 * Poisson-disc samples inside a polygon (Bridson's algorithm with several starting seeds, so a polygon of separate
 * lobes fills completely): no two points closer than `minDist`, deterministic for a given `seed`.
 * `ring`/`holes` are [[x, y], ...]; `accept(x, y)` may veto a point (returns a probability 0..1, or a boolean);
 * `limit` caps the count. Returns [[x, y], ...].
 */
export function poissonDisc(ring, holes, { minDist, seed = 1, accept = null, limit = MAX_FILL_PER_POLY, tries = 24 } = {}) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of ring) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  if (!(x1 > x0 && y1 > y0)) return [];
  const rand = rng(seed), cell = minDist / Math.SQRT2, gw = Math.ceil((x1 - x0) / cell) + 1, gh = Math.ceil((y1 - y0) / cell) + 1;
  if (gw * gh > 4e6) return [];
  const grid = new Int32Array(gw * gh).fill(-1), pts = [], active = [], poly = { ring, holes: holes || [] };
  const ok = (x, y) => {
    if (!inPoly(x, y, poly)) return false;
    const gx = Math.floor((x - x0) / cell), gy = Math.floor((y - y0) / cell);
    for (let i = Math.max(0, gx - 2); i <= Math.min(gw - 1, gx + 2); i++) for (let j = Math.max(0, gy - 2); j <= Math.min(gh - 1, gy + 2); j++) {
      const k = grid[j * gw + i]; if (k >= 0 && Math.hypot(pts[k][0] - x, pts[k][1] - y) < minDist) return false;
    }
    if (accept) { const a = accept(x, y); if (a === false || (a !== true && rand() > a)) return false; }
    return true;
  };
  const add = (x, y) => { pts.push([x, y]); active.push(pts.length - 1); grid[Math.floor((y - y0) / cell) * gw + Math.floor((x - x0) / cell)] = pts.length - 1; };
  // starting seeds on a coarse lattice, so every lobe of the polygon gets one
  const lat = minDist * 3;
  for (let gx = x0 + lat / 2; gx < x1 && pts.length < limit; gx += lat) for (let gy = y0 + lat / 2; gy < y1 && pts.length < limit; gy += lat) {
    const x = gx + (rand() - 0.5) * lat * 0.8, y = gy + (rand() - 0.5) * lat * 0.8;
    if (ok(x, y)) add(x, y);
  }
  while (active.length && pts.length < limit) {
    const ai = Math.floor(rand() * active.length), [px, py] = pts[active[ai]];
    let found = false;
    for (let t = 0; t < tries; t++) {
      const a = rand() * Math.PI * 2, r = minDist * (1 + rand()), x = px + Math.cos(a) * r, y = py + Math.sin(a) * r;
      if (ok(x, y)) { add(x, y); found = true; break; }
    }
    if (!found) { active[ai] = active[active.length - 1]; active.pop(); }
  }
  return pts;
}

/**
 * Fill canopies for the polygons that no inventory describes (unit/parkfill.js `fillTargets`): [{x, y, dbh}] with a
 * believable trunk size per kind. Paved polygons (plazas, courts, turf fields) and playgrounds get none, a thin Parks polygon
 * gets a share of the dense rate. `center`/`radius` keep trees near the site; `avoid(x, y)` vetoes a point (a building
 * or a real tree stands there, or it lies in a lawn or on paved ground); `limit` caps the count. The stream is per polygon
 * (its index and first vertex), so adding or removing a polygon elsewhere moves no other tree.
 */
export function fillTrees(polys, { center = null, radius = Infinity, avoid = null, limit = 6000 } = {}) {
  const out = [];
  for (const { poly: p, k, share } of fillTargets(polys)) {
    if (out.length >= limit) break;
    const f = FILL[p.fill || p.kind] || FILL.grass, seed = Math.floor(hash01(k, Math.round(p.ring[0][0]), Math.round(p.ring[0][1])) * 1e9) + 1;
    const accept = (x, y) => {
      if (center && Math.hypot(x - center[0], y - center[1]) > radius) return false;
      if (avoid && avoid(x, y)) return false;
      let a = 1;
      if (f.ring && polyArea(p) > f.ring && edgeDistance(x, y, p.ring) > f.edge) return false;   // a big lawn is open in the middle
      if (f.grove) a = smooth(0.28, 0.4, valueNoise(x, y, f.noiseScale, seed & 1023));
      if (f.edge && a < 1 && edgeDistance(x, y, p.ring) < f.edge) a = Math.max(a, 0.9);
      return a;
    };
    const pts = poissonDisc(p.ring, p.holes, { minDist: f.minDist / Math.sqrt(share), seed, accept, limit: MAX_FILL_PER_POLY });
    const r = rng(seed ^ 0x9e3779b9);
    for (const [x, y] of pts) {
      if (out.length >= limit) break;
      // log-normal-ish trunk: median f.dbh[0], spread f.dbh[1] (a sum of uniforms is close enough to a bell)
      const g = (r() + r() + r() - 1.5) * 1.15, dbh = Math.max(3, Math.min(34, f.dbh[0] * Math.exp(g * f.dbh[1])));
      out.push({ x, y, dbh });
    }
  }
  return out;
}

// ------------------------------------------------------------------ footprints (keep trees out of buildings)

/** A fast "is this point inside a building footprint" test over prepared buildings (sun.js prepBuildings), bucketed on a grid. */
export function footprintIndex(B, cell = 60) {
  const grid = new Map();
  (B || []).forEach((b, i) => {
    if (!b?.bb || !b.p) return;
    for (let gx = Math.floor(b.bb[0] / cell); gx <= Math.floor(b.bb[2] / cell); gx++) for (let gy = Math.floor(b.bb[1] / cell); gy <= Math.floor(b.bb[3] / cell); gy++) {
      const k = gx + ',' + gy; (grid.get(k) || grid.set(k, []).get(k)).push(i);
    }
  });
  const flat = (p) => { const r = []; for (let i = 0; i + 1 < p.length; i += 2) r.push([p[i], p[i + 1]]); return r; };
  const rings = new Map();
  return {
    /** True when (x, y) is inside a footprint's solid part (not in a light court). */
    hits(x, y) {
      const list = grid.get(Math.floor(x / cell) + ',' + Math.floor(y / cell)); if (!list) return false;
      for (const i of list) {
        const b = B[i]; if (x < b.bb[0] || x > b.bb[2] || y < b.bb[1] || y > b.bb[3]) continue;
        let r = rings.get(i); if (!r) { r = { o: flat(b.p), h: (b.holes || []).map(flat) }; rings.set(i, r); }
        if (inRing(x, y, r.o) && !r.h.some((h) => inRing(x, y, h))) return true;
      }
      return false;
    },
  };
}

// ------------------------------------------------------------------ the plan

/** True when a ring's bounding box comes within `radius` of `center` (a big park whose corners are all far away can still reach in). */
function bboxNear(ring, center, radius) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of ring) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const dx = Math.max(x0 - center[0], 0, center[0] - x1), dy = Math.max(y0 - center[1], 0, center[1] - y1);
  return Math.hypot(dx, dy) <= radius;
}

/** Size, colour pick and trunk of one tree from its diameter and group (the same tree every time for the same position). */
export function treeShape(x, y, dbh, grp = 0) {
  const a = hash01(Math.round(x * 4), Math.round(y * 4), 7), b = hash01(Math.round(x * 4), Math.round(y * 4), 19), c = hash01(Math.round(x * 4), Math.round(y * 4), 31);
  const sh = SHAPE[GROUPS[grp]] || SHAPE.other, jit = 0.88 + 0.24 * a;
  const h = treeHeight(dbh) * jit * sh.sy, r = crownRadius(dbh) * (0.92 + 0.16 * b) * jit * sh.sx;
  // clear trunk: the crown starts at ~30% of the height, but never below 2.4 m (street trees are limbed up over the pavement)
  const bole = Math.min(h * 0.6, Math.max(2.4, h * 0.3));
  return { h, r, bole, tone: c, grp };
}

/** Where a tree comes from (the `src` of a plan): census, mapped, fill, inventory (park), inventory (street planted since the census). */
export const SRC = { census: 0, mapped: 1, fill: 2, park: 3, street: 4 };
/** Which layer control a tree belongs to: 0 street trees, 1 park trees. */
export const CLS = { street: 0, park: 1 };
const RANK = [0, 2, 3, 1, 0];   // the cap drops last the best records: census, inventory, mapped, then fill

/**
 * Everything the views draw: one list of trees in struct-of-arrays form, nearest the centre first, with the source of
 * each (SRC) and its layer (`cls`: 0 street trees, 1 park trees). `green` is the site's `green` block. Options: `center`
 * [x, y] and `radius` (m) to draw within; `cap` the most trees to return (the real records keep their place, the fill
 * yields first); `B` prepared buildings (trees are kept out of footprints); `fill` (default true) switches the Poisson fill.
 */
export function treePlan(green, { center = [0, 0], radius = 640, cap = 9000, B = null, fill = true } = {}) {
  const g = green && typeof green === 'object' ? green : null;
  if (!g) return emptyPlan();
  const near = (x, y) => Math.hypot(x - center[0], y - center[1]) <= radius, idx = B ? footprintIndex(B) : null, avoid = idx ? (x, y) => idx.hits(x, y) : null;
  const T = []; // {x, y, dbh, grp, src, cls}
  const seen = new Map(), cs = DEDUPE_M, key = (x, y) => Math.floor(x / cs) + ',' + Math.floor(y / cs);
  const note = (x, y) => { const k = key(x, y); (seen.get(k) || seen.set(k, []).get(k)).push([x, y]); };
  const real = treeIndex();           // the fill keeps clear of every real tree
  const cen = decodeCensus(g.census);
  if (cen) for (let i = 0; i < cen.n; i++) {
    const x = cen.x[i], y = cen.y[i]; if (!near(x, y) || (avoid && avoid(x, y))) continue;
    T.push({ x, y, dbh: cen.dbh[i] + GROWTH_IN, grp: cen.grp[i], src: SRC.census, cls: CLS.street });
    note(x, y); real.add(x, y);
  }
  const close = (x, y) => { const cx = Math.floor(x / cs), cy = Math.floor(y / cs); for (let i = cx - 1; i <= cx + 1; i++) for (let j = cy - 1; j <= cy + 1; j++) for (const [qx, qy] of seen.get(i + ',' + j) || []) if (Math.hypot(qx - x, qy - y) < cs) return true; return false; };
  // the Parks inventory: park trees and street trees planted since the census (already deduped against the census when the site was built)
  const inv = decodeForestry(g.forestry);
  if (inv) for (let i = 0; i < inv.n; i++) {
    const x = inv.x[i], y = inv.y[i]; if (!near(x, y) || (avoid && avoid(x, y))) continue;
    const park = inv.loc[i] === 0;
    T.push({ x, y, dbh: inv.dbh[i], grp: inv.grp[i], src: park ? SRC.park : SRC.street, cls: park ? CLS.park : CLS.street });
    note(x, y); real.add(x, y);
  }
  const polys = (Array.isArray(g.polys) ? g.polys : []).filter((p) => p && FILL[p.kind] && Array.isArray(p.ring) && p.ring.length >= 3)
    .map((p) => ({ kind: p.kind, hard: !!p.hard, turf: !!p.turf, on_parks: !!p.on_parks, inv: p.inv, ring: p.ring, holes: Array.isArray(p.holes) ? p.holes : [] }));
  const pidx = polyIndex(polys);
  // a lawn inside a park stays open; a lawn that stands alone is planted like a small park (FILL.lawn)
  const parkish = polyIndex(polys.filter((p) => !p.hard && !p.turf && (p.kind === 'park' || p.kind === 'wood')));
  for (const p of polys) if (p.kind === 'grass' && !p.hard && !p.turf) { const [lx, ly] = labelPoint(p.ring, p.holes); if (parkish.at(lx, ly).length) p.open = true; else p.fill = 'lawn'; }
  const t = Array.isArray(g.trees) ? g.trees : [];
  let mapped = 0;
  for (let i = 0; i + 1 < t.length; i += 2) {
    if (!fin(t[i]) || !fin(t[i + 1])) continue;
    const x = +t[i], y = +t[i + 1]; if (!near(x, y) || close(x, y) || (avoid && avoid(x, y))) continue;
    T.push({ x, y, dbh: MAPPED_DBH_IN, grp: 0, src: SRC.mapped, cls: pidx.at(x, y).length ? CLS.park : CLS.street }); mapped++;
    real.add(x, y);
  }
  let filled = 0;
  if (fill) {
    const live = polys.filter((p) => bboxNear(p.ring, center, radius));
    // the fill stays out of buildings, away from real trees, and out of lawns and paved ground mapped inside a park
    const open = polyIndex(polys.filter((p) => p.hard || p.turf || p.open || p.kind === 'play'));
    const veto = (x, y) => (avoid ? avoid(x, y) : false) || close(x, y) || real.near(x, y) || open.at(x, y).length > 0;
    for (const f of fillTrees(live, { center, radius, avoid: veto, limit: Math.max(0, cap - T.length) })) { T.push({ ...f, grp: 0, src: SRC.fill, cls: CLS.park }); filled++; }
  }
  T.forEach((q) => { q.d = Math.hypot(q.x - center[0], q.y - center[1]); });
  T.sort((a, b) => RANK[a.src] === RANK[b.src] ? a.d - b.d : RANK[a.src] - RANK[b.src]);
  const keep = T.slice(0, cap).sort((a, b) => a.d - b.d), n = keep.length;
  const P = { n, x: new Float32Array(n), y: new Float32Array(n), h: new Float32Array(n), r: new Float32Array(n), bole: new Float32Array(n), tone: new Float32Array(n), grp: new Uint8Array(n), src: new Uint8Array(n), cls: new Uint8Array(n), dbh: new Float32Array(n) };
  keep.forEach((q, i) => {
    const s = treeShape(q.x, q.y, q.dbh, q.grp);
    P.x[i] = q.x; P.y[i] = q.y; P.h[i] = s.h; P.r[i] = s.r; P.bole[i] = s.bole; P.tone[i] = s.tone; P.grp[i] = q.grp; P.src[i] = q.src; P.cls[i] = q.cls; P.dbh[i] = q.dbh;
  });
  const by = [0, 0, 0, 0, 0], byCls = [0, 0]; for (let i = 0; i < n; i++) { by[P.src[i]]++; byCls[P.cls[i]]++; }
  return { ...P, counts: { census: by[SRC.census], mapped: by[SRC.mapped], fill: by[SRC.fill], park: by[SRC.park], street: by[SRC.street], streetTrees: byCls[CLS.street], parkTrees: byCls[CLS.park], total: n, dropped: T.length - n },
    census: cen ? { source: cen.source, date: cen.date } : null, forestry: inv ? { source: inv.source, date: inv.date } : null };
}
export function emptyPlan() {
  return { n: 0, x: new Float32Array(0), y: new Float32Array(0), h: new Float32Array(0), r: new Float32Array(0), bole: new Float32Array(0), tone: new Float32Array(0), grp: new Uint8Array(0), src: new Uint8Array(0), cls: new Uint8Array(0), dbh: new Float32Array(0), counts: { census: 0, mapped: 0, fill: 0, park: 0, street: 0, streetTrees: 0, parkTrees: 0, total: 0, dropped: 0 }, census: null, forestry: null };
}

/** Canopy cover (m²) of a plan: the sum of crown discs (overlaps counted twice), for the legend. */
export function canopyArea(plan) { let a = 0; for (let i = 0; i < plan.n; i++) a += Math.PI * plan.r[i] * plan.r[i]; return a; }
export { ringArea };
