// Access routes for the Floor plan studio: can you walk from the front door to the bed, the sofa, the desk,
// the kitchen and the bathroom with a comfortable width, and can the big pieces get in through the doors?
// Pure (no DOM, no three.js), so node:test covers it.
//
// Method: rasterise the unit on a 2 in grid (floor = inside a room or a door opening; solid = walls, sills,
// fixtures and furniture lower than 30 in, so wall TVs and pendants do not block), take the Euclidean
// distance transform, and find the widest path (maximin) from the entry to each destination. Door openings
// and the area right around them are exempt from the width (their size is the building's, reported
// separately), so the bottleneck is what the furniture and the room shapes leave. Widths: 36 in preferred,
// 30 in minimum (CLEARANCE.walkway).
import { pointInPoly, bbox } from './model.js';
import { footprint, piecePoly, partPolys } from './checks.js';
import { CLEARANCE } from './catalog.js';

export const CELL = 2;
const LOW = 30; // anything whose underside is below this blocks walking
const FLATPACK_KINDS = new Set(['bed', 'dresser', 'wardrobe', 'bookcase', 'desk', 'table', 'table-low', 'nightstand']);

/** The entry door: where you stand just inside it and which way you face. Pure version of the studio's camera helper. */
export function entryPoint(model) {
  const ds = model.doorways || [];
  const outsideAt = (x) => { const n = [-(x.b[1] - x.a[1]) / x.len, (x.b[0] - x.a[0]) / x.len]; return [1, -1].some((s) => !model.rooms.some((r) => pointInPoly([x.mid[0] + n[0] * s * 18, x.mid[1] + n[1] * s * 18], r.poly))); };
  const d = ds.find((x) => x.kind === 'entry') || ds.find((x) => /front|entry/i.test(x.name || '')) || ds.find(outsideAt) || ds[0];
  if (!d) return { at: model.rooms[0].label, dir: [0, 1], door: null };
  const n = [-(d.b[1] - d.a[1]) / d.len, (d.b[0] - d.a[0]) / d.len];
  const inward = d.swingDir || ([1, -1].map((s) => [n[0] * s, n[1] * s]).find((v) => model.rooms.some((r) => pointInPoly([d.mid[0] + v[0] * 24, d.mid[1] + v[1] * 24], r.poly))) || n);
  const at = [d.mid[0] + inward[0] * 14, d.mid[1] + inward[1] * 14];
  const main = [...model.rooms].filter((r) => r.kind === 'living').sort((a, b) => b.area - a.area)[0] || [...model.rooms].sort((a, b) => b.area - a.area)[0];
  const v = [main.label[0] - at[0], main.label[1] - at[1]], L = Math.hypot(...v);
  return { at, dir: L > 24 ? [v[0] / L, v[1] / L] : inward, door: d };
}

/** Rasterise the unit. `skip` is an item id left out of the obstacles (the destination itself). */
export function grid(model, items, skip = null) {
  const b0 = model.bounds, x0 = b0.x0 - 12, y0 = b0.y0 - 12;
  const nx = Math.ceil((b0.x1 - b0.x0 + 24) / CELL), ny = Math.ceil((b0.y1 - b0.y0 + 24) / CELL), N = nx * ny;
  const free = new Uint8Array(N), door = new Int16Array(N).fill(-1), owner = new Int16Array(N).fill(-1), near = new Uint8Array(N);
  const cx = (i) => x0 + (i + 0.5) * CELL, cy = (j) => y0 + (j + 0.5) * CELL;
  const fill = (poly, fn) => {
    const bb = bbox(poly), i0 = Math.max(0, Math.floor((bb.x0 - x0) / CELL)), i1 = Math.min(nx - 1, Math.ceil((bb.x1 - x0) / CELL));
    const j0 = Math.max(0, Math.floor((bb.y0 - y0) / CELL)), j1 = Math.min(ny - 1, Math.ceil((bb.y1 - y0) / CELL));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (pointInPoly([cx(i), cy(j)], poly)) fn(j * nx + i);
  };
  for (const r of model.rooms) fill(r.poly, (k) => { free[k] = 1; });
  const t = (model.wallT || 5) / 2 + 3;
  (model.doorways || []).forEach((d, di) => {
    const u = [(d.b[0] - d.a[0]) / d.len, (d.b[1] - d.a[1]) / d.len], n = [-u[1], u[0]];
    const rect = [[d.a[0] + n[0] * t, d.a[1] + n[1] * t], [d.b[0] + n[0] * t, d.b[1] + n[1] * t], [d.b[0] - n[0] * t, d.b[1] - n[1] * t], [d.a[0] - n[0] * t, d.a[1] - n[1] * t]];
    fill(rect, (k) => { free[k] = 1; door[k] = di; });
    const R = d.len / 2 + 14, circ = Array.from({ length: 16 }, (_, q) => [d.mid[0] + R * Math.cos((q * Math.PI) / 8), d.mid[1] + R * Math.sin((q * Math.PI) / 8)]);
    fill(circ, (k) => { near[k] = 1; });
  });
  const obs = [];
  for (const p of model.pieces) if (p.z0 < LOW) obs.push({ poly: piecePoly(p), label: p.kind === 'sill' ? 'the window wall' : 'a wall', type: 'wall' });
  for (const f of model.fixtures) if (f.elev < LOW) obs.push({ poly: f.poly, label: (f.label || f.kind).toLowerCase(), type: 'fixture' });
  for (const it of items) if (!it.hidden && !it.flat && it.id !== skip) for (const p of partPolys(walkPrint(it))) if (p.z0 < LOW) obs.push({ poly: p.poly, label: (it.name || it.ref || 'furniture').toLowerCase(), type: 'item', id: it.id });   // [bed option] each solid part at its own height
  obs.forEach((o, oi) => fill(o.poly, (k) => { free[k] = 0; owner[k] = oi; }));
  return { x0, y0, nx, ny, free, door, near, owner, obs, cx, cy };
}

/** Footprint used for walking: dining chairs tucked in still stand about 8 in proud of the table edge. */
export function walkPrint(it) {
  if (it.kind !== 'table') return it;
  const all = it.base?.chairs === 'all' || it.base?.round;
  return { ...it, w: it.w + (all ? 16 : 0), d: it.d + 16 };
}

/** Exact squared Euclidean distance transform (Felzenszwalb) to the nearest non-free cell, in cells². */
export function edt(G) {
  const { nx, ny, free } = G, INF = 1e12, f = new Float64Array(Math.max(nx, ny)), d2 = new Float64Array(nx * ny);
  for (let k = 0; k < nx * ny; k++) d2[k] = free[k] ? INF : 0;
  const pass = (n, get, set) => {
    for (let q = 0; q < n; q++) f[q] = get(q);
    const v = new Int32Array(n), z = new Float64Array(n + 1); let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < n; q++) {
      let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
      k++; v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; set(q, (q - v[k]) * (q - v[k]) + f[v[k]]); }
  };
  for (let i = 0; i < nx; i++) pass(ny, (j) => d2[j * nx + i], (j, val) => { d2[j * nx + i] = val; });
  for (let j = 0; j < ny; j++) pass(nx, (i) => d2[j * nx + i], (i, val) => { d2[j * nx + i] = val; });
  return d2;
}

/** Free width (inches) a cell offers: twice its distance to the nearest solid edge. */
const widthOf = (d2) => Math.max(0, 2 * (Math.sqrt(d2) - 0.5) * CELL);

class Heap { // max-heap on key
  constructor() { this.a = []; }
  push(k, v) { const a = this.a; a.push([k, v]); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] >= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
  pop() { const a = this.a, top = a[0], last = a.pop(); if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && a[l][0] > a[m][0]) m = l; if (r < a.length && a[r][0] > a[m][0]) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } } return top; }
  get size() { return this.a.length; }
}
const NB = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];

/**
 * Widest path from `start` (plan point) to any cell for which `isGoal(k)` holds.
 * @returns {{width:number, path:number[][], pinch:number[]|null, between:string[], doors:number[]}|null}
 */
export function widestPath(G, d2, start, isGoal) {
  const { nx, ny, free, door, near, cx, cy } = G, N = nx * ny;
  const idx = (p) => { const i = Math.floor((p[0] - G.x0) / CELL), j = Math.floor((p[1] - G.y0) / CELL); return i >= 0 && j >= 0 && i < nx && j < ny ? j * nx + i : -1; };
  let s = idx(start);
  if (s < 0 || !free[s]) { // nearest free cell within 24 in
    let best = -1, bd = Infinity; const R = 12, i0 = Math.floor((start[0] - G.x0) / CELL), j0 = Math.floor((start[1] - G.y0) / CELL);
    for (let j = j0 - R; j <= j0 + R; j++) for (let i = i0 - R; i <= i0 + R; i++) { if (i < 0 || j < 0 || i >= nx || j >= ny) continue; const k = j * nx + i; const dd = (i - i0) ** 2 + (j - j0) ** 2; if (free[k] && dd < bd) { bd = dd; best = k; } }
    s = best;
  }
  if (s < 0) return null;
  const wOf = (k) => (door[k] >= 0 || near[k] || isGoal(k) ? Infinity : widthOf(d2[k]));
  // 1) maximin bottleneck
  const best = new Float64Array(N).fill(-1), H = new Heap();
  best[s] = wOf(s); H.push(best[s], s);
  let goalW = -1;
  while (H.size) {
    const [w, k] = H.pop(); if (w < best[k]) continue;
    if (isGoal(k)) { goalW = w; break; }
    const i = k % nx, j = (k / nx) | 0;
    for (const [di, dj] of NB) {
      const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= nx || b >= ny) continue;
      const q = b * nx + a; if (!free[q]) continue;
      const nw = Math.min(w, wOf(q)); if (nw > best[q]) { best[q] = nw; H.push(nw, q); }
    }
  }
  if (goalW < 0) return null;
  // 2) shortest path that keeps min(bottleneck, 36 in) everywhere (so it does not detour for extra width)
  const need = Math.min(goalW, CLEARANCE.walkway.preferred) - 0.01;
  const dist = new Float64Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1), H2 = new Heap();
  dist[s] = 0; H2.push(0, s); let g = -1;
  while (H2.size) {
    const [nd, k] = H2.pop(); const dk = -nd; if (dk > dist[k]) continue;
    if (isGoal(k)) { g = k; break; }
    const i = k % nx, j = (k / nx) | 0;
    for (const [di, dj, c] of NB) {
      const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= nx || b >= ny) continue;
      const q = b * nx + a; if (!free[q] || wOf(q) < need) continue;
      const v = dk + c; if (v < dist[q]) { dist[q] = v; prev[q] = k; H2.push(-v, q); }
    }
  }
  if (g < 0) return null;
  const cells = []; for (let k = g; k >= 0; k = prev[k]) cells.push(k); cells.reverse();
  let pinch = null, pw = Infinity; const doors = new Set();
  for (const k of cells) { if (door[k] >= 0) doors.add(door[k]); const w = wOf(k); if (w < pw) { pw = w; pinch = k; } }
  const between = pinch == null || pw === Infinity ? [] : neighbours(G, pinch, Math.sqrt(d2[pinch]) + 2);
  const pts = cells.map((k) => [cx(k % nx), cy((k / nx) | 0)]);
  return { width: pw === Infinity ? Infinity : Math.round(pw), path: simplify(pts), pinch: pinch == null || pw === Infinity ? null : [cx(pinch % nx), cy((pinch / nx) | 0)], between, doors: [...doors] };
}
function neighbours(G, k, r) {
  const { nx, ny, owner, obs } = G, i0 = k % nx, j0 = (k / nx) | 0, R = Math.ceil(r), seen = new Map();
  for (let j = j0 - R; j <= j0 + R; j++) for (let i = i0 - R; i <= i0 + R; i++) {
    if (i < 0 || j < 0 || i >= nx || j >= ny) continue; const q = j * nx + i, o = owner[q];
    if (o < 0) continue; const d = (i - i0) ** 2 + (j - j0) ** 2; if (!seen.has(o) || d < seen.get(o)) seen.set(o, d);
  }
  return [...seen.entries()].sort((a, b) => a[1] - b[1]).map(([o]) => obs[o].label).filter((x, i, a) => a.indexOf(x) === i).slice(0, 2);
}
/** Drop collinear points from a cell path. */
export function simplify(pts) {
  if (pts.length < 3) return pts;
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = out[out.length - 1], b = pts[i], c = pts[i + 1];
    if (Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) > 1e-6) out.push(b);
  }
  out.push(pts[pts.length - 1]); return out;
}

export const gradeWidth = (w) => (w >= CLEARANCE.walkway.preferred - 0.5 ? 'clear' : w >= CLEARANCE.walkway.min - 0.5 ? 'tight' : 'blocked');
const doorClear = (d) => Math.max(0, d.len - 1.5); // stops and the leaf's thickness eat about 1.5 in

/** Destinations worth walking to: every bed, the first sofa, desk and dining table, the kitchen and each bathroom. */
export function destinations(model, items) {
  const vis = items.filter((it) => !it.hidden && !it.flat), out = [];
  for (const it of vis.filter((x) => x.kind === 'bed')) out.push({ key: it.id, label: it.name, item: it });
  for (const k of ['sofa', 'desk', 'table']) { const it = vis.find((x) => x.kind === k); if (it) out.push({ key: it.id, label: it.name, item: it }); }
  const kit = model.rooms.find((r) => r.kind === 'kitchen'); if (kit) out.push({ key: `room:${kit.name}`, label: kit.name, room: kit });
  model.rooms.filter((r) => r.kind === 'bath').slice(0, 2).forEach((r) => out.push({ key: `room:${r.name}`, label: r.name, room: r }));
  return out;
}

/**
 * Walk from the entry to each destination.
 * @param {object} model normalised plan
 * @param {object[]} items resolved items (catalog.resolve)
 * @returns {{start:number[], routes:object[]}}
 */
export function accessRoutes(model, items, dests = destinations(model, items)) {
  const entry = entryPoint(model), routes = [];
  let shared = null;
  for (const dst of dests) {
    const G = dst.item ? grid(model, items, dst.item.id) : (shared ||= grid(model, items));
    const d2 = dst.item ? edt(G) : (G.d2 ||= edt(G));
    let goal;
    if (dst.item) { const fp = footprint(dst.item); goal = (k) => pointInPoly([G.cx(k % G.nx), G.cy((k / G.nx) | 0)], fp); }
    else goal = (k) => pointInPoly([G.cx(k % G.nx), G.cy((k / G.nx) | 0)], dst.room.poly);
    const memo = new Int8Array(G.nx * G.ny); const isGoal = (k) => (memo[k] ? memo[k] > 0 : (memo[k] = goal(k) ? 1 : -1) > 0);
    const r = widestPath(G, d2, entry.at, isGoal);
    const doors = r ? r.doors.map((i) => model.doorways[i]).filter((d) => d && d !== entry.door) : [];
    const doorsAll = entry.door ? [entry.door, ...doors] : doors;
    const narrowest = doorsAll.length ? doorsAll.reduce((a, b) => (doorClear(a) <= doorClear(b) ? a : b)) : null;
    const res = { key: dst.key, label: dst.label, itemId: dst.item?.id || null, reachable: !!r, width: r ? r.width : 0, grade: r ? gradeWidth(r.width) : 'blocked', path: r ? r.path : [], pinch: r?.pinch || null, between: r?.between || [], narrowestDoor: narrowest ? { name: narrowest.name || (narrowest === entry.door ? 'entry door' : 'door'), width: Math.round(doorClear(narrowest) * 10) / 10 } : null };
    res.delivery = dst.item ? delivery(dst.item, res.narrowestDoor) : null;
    res.text = describe(res);
    routes.push(res);
  }
  return { start: entry.at, routes };
}

/**
 * Can a piece get through the narrowest door on its route? Flat-packed kinds always can. Otherwise the piece
 * goes through on its side: its smallest dimension must pass the door's clear width.
 */
export function delivery(it, door) {
  if (!door) return null;
  const flat = it.base?.flatpack ?? FLATPACK_KINDS.has(it.kind);
  if (flat) return { grade: 'clear', text: `Usually ships flat-packed, so it gets through the ${Math.round(door.width)} in ${door.name}` };
  const dims = [it.w, it.d, it.h].sort((a, b) => a - b), small = dims[0];
  if (small <= door.width - 2) return { grade: 'clear', text: `Fits through the ${Math.round(door.width)} in ${door.name} on its side (${Math.round(small)} in)` };
  if (small <= door.width) return { grade: 'tight', text: `Only just fits the ${Math.round(door.width)} in ${door.name} (${Math.round(small)} in); check its diagonal depth` };
  return { grade: 'blocked', text: `Its smallest side (${Math.round(small)} in) is wider than the ${Math.round(door.width)} in ${door.name}: needs removable legs or arms, or a door off its hinges` };
}

function describe(r) {
  if (!r.reachable) return `No way through from the entry: furniture closes the route`;
  if (r.width === Infinity) return 'Open route from the entry';
  const w = `${Math.round(r.width)} in`;
  const at = r.between.length === 2 ? ` between ${r.between[0]} and ${r.between[1]}` : r.between.length ? ` beside ${r.between[0]}` : '';
  return r.grade === 'clear' ? `Narrowest ${w}${at}` : r.grade === 'tight' ? `Narrows to ${w}${at}; 36 in is comfortable` : `Pinches to ${w}${at}; a walkway needs 30 in`;
}

