// The buildings of a site file as the 3D views draw them: one list, built from the same prepared buildings (footprints, ground,
// roof height, components) that every sun, skyline and sky-view calculation reads, so Unit 3D, the Floor plan studio's
// "City outside" and the obstruction maths always show and use the SAME buildings. Pure: no three.js, no DOM.
//
// Each entry keeps the building's stable id (its BIN, else its OpenStreetMap element), its parts (podium, tower, setback,
// bulkhead, spire; or one prism for the whole footprint), the facade style chosen from its record, a seed for its window and
// roof-furniture patterns, and whether it is near or far from the viewer (levels of detail).
import { prepBuildings } from '../sun.js';
import { effectiveComponents } from '../unit/parts.js';
import { facadeStyle, seedOf, stableId, NO_WINDOWS } from './facades.js';

const ringOf = (p) => { const r = []; for (let i = 0; i < p.length; i += 2) r.push([p[i], p[i + 1]]); return r; };
export const ringArea = (p) => { let a = 0; const n = p.length / 2; for (let i = 0; i < n; i++) { const j = (i + 1) % n; a += p[2 * i] * p[2 * j + 1] - p[2 * j] * p[2 * i + 1]; } return a / 2; };
export const centroid = (p) => {
  let a = 0, cx = 0, cy = 0; const n = p.length / 2;
  for (let i = 0; i < n; i++) { const j = (i + 1) % n, c = p[2 * i] * p[2 * j + 1] - p[2 * j] * p[2 * i + 1]; a += c; cx += (p[2 * i] + p[2 * j]) * c; cy += (p[2 * i + 1] + p[2 * j + 1]) * c; }
  if (Math.abs(a) < 1e-9) { let sx = 0, sy = 0; for (let i = 0; i < n; i++) { sx += p[2 * i]; sy += p[2 * i + 1]; } return [sx / n, sy / n]; }
  return [cx / (3 * a), cy / (3 * a)];
};
export function inRing(p, x, y) {
  let inside = false;
  for (let i = 0, n = p.length / 2, j = n - 1; i < n; j = i++) {
    const xi = p[2 * i], yi = p[2 * i + 1], xj = p[2 * j], yj = p[2 * j + 1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
/** A point inside the ring (holes ignored): the centroid, else the middle of the first interior chord through it. */
export function repPoint(p) {
  const [cx, cy] = centroid(p);
  if (inRing(p, cx, cy)) return [cx, cy];
  const xs = [], n = p.length / 2;
  for (let i = 0; i < n; i++) { const j = (i + 1) % n, y1 = p[2 * i + 1], y2 = p[2 * j + 1]; if ((y1 > cy) !== (y2 > cy)) xs.push(p[2 * i] + ((cy - y1) * (p[2 * j] - p[2 * i])) / (y2 - y1)); }
  xs.sort((a, b) => a - b);
  return xs.length >= 2 ? [(xs[0] + xs[1]) / 2, cy] : [cx, cy];
}

/** Defaults for the levels of detail (metres from the view centre). */
export const LOD = { nearR: 450 };

/**
 * One entry per building to draw.
 * site: the site file (or null when `o.B` and `o.meta` are given).
 * o: { B (prepared buildings from sun.js prepBuildings, with the assumed parts already merged: the views pass theirs),
 *      meta (the site's bmeta), components (a components map, else the site's effective components),
 *      center [x, y] site metres (distance for LOD and radius), radius (draw buildings whose centre is within, default all),
 *      nearR (the detailed levels of detail, default 450 m), skip / only (Sets of building indices),
 *      decor (generic roof furniture, default true) }
 * Returns { entries, info }.
 */
export function buildingEntries(site, o = {}) {
  const B = o.B || prepBuildings(site.b, site.holes && typeof site.holes === 'object' ? site.holes : null, o.components !== undefined ? o.components : effectiveComponents(site));
  const meta = o.meta || site?.bmeta || [];
  const target = site?.target ?? null;
  const [cx0, cy0] = o.center || (target != null && B[target] ? [(B[target].bb[0] + B[target].bb[2]) / 2, (B[target].bb[1] + B[target].bb[3]) / 2] : [0, 0]);
  const nearR = o.nearR ?? LOD.nearR, radius = o.radius ?? Infinity;
  const entries = [], info = { buildings: 0, parts: 0, near: 0, far: 0, partBuildings: 0, styles: {}, decor: 0, skipped: 0 };
  for (let i = 0; i < B.length; i++) {
    const b = B[i];
    if (o.skip?.has(i) || (o.only && !o.only.has(i))) { info.skipped++; continue; }
    const cx = (b.bb[0] + b.bb[2]) / 2, cy = (b.bb[1] + b.bb[3]) / 2, dist = Math.hypot(cx - cx0, cy - cy0);
    if (dist > radius) { info.skipped++; continue; }
    const m = meta[i] || {};
    const id = stableId(m, i);
    const roof = b.top - Math.max(b.g, 0);
    const raw = b.parts && b.parts.length ? b.parts : null;
    const bmat = raw ? dominant(raw.map((q) => q.mat).filter(Boolean)) : null;
    const style = facadeStyle(m, roof, bmat);
    const seed = seedOf(id);
    const parts = (raw || [wholePart(b)]).map((q) => normalPart(q, b, m, bmat, style, seed)).sort((a, c) => a.top - c.top || a.base - c.base);
    markExposed(parts);
    const near = dist <= nearR;
    const e = { i, id, g: b.g, top: b.top, roof, p: b.p, holes: b.holes || [], bb: b.bb, cx, cy, dist, near, meta: m, style, seed, parts, whole: !raw, floors: +m.floors > 0 ? +m.floors : null };
    e.decor = o.decor === false || !near ? [] : decorFor(e);
    entries.push(e);
    info.buildings++; info.parts += parts.length; info[near ? 'near' : 'far']++; info.decor += e.decor.length;
    if (raw) info.partBuildings++;
    for (const q of parts) { const k = q.style.style; info.styles[k] = (info.styles[k] || 0) + 1; }
  }
  return { entries, info };
}
const dominant = (a) => { if (!a.length) return null; const c = {}; for (const v of a) c[v] = (c[v] || 0) + 1; return Object.entries(c).sort((x, y) => y[1] - x[1])[0][0]; };
const wholePart = (b) => ({ p: b.p, holes: b.holes || [], g: b.g, base: b.g, top: b.top, base_m: 0, top_m: b.top - b.g, kind: 'whole', roof: '', eave_m: null, dir: null, mat: '', col: '', confidence: '', source: '' });

function normalPart(q, b, m, bmat, bstyle, seed) {
  const h = q.top - Math.max(b.g, 0);
  const mat = q.mat || bmat || null;
  const style = q.kind === 'spire' ? { ...bstyle, style: NO_WINDOWS } : mat === bmat ? bstyle : facadeStyle(m, h, mat);
  let roofShape = q.kind === 'spire' ? 'pyramid' : q.roof && q.roof !== 'flat' && q.eave_m != null && q.eave_m > q.base_m + 0.5 && q.eave_m < q.top_m - 0.5 ? q.roof : 'flat';
  if (roofShape === 'hip' || roofShape === 'gable') roofShape = 'pyramid';      // drawn as a hipped roof
  if (roofShape === 'slope' && q.dir == null) roofShape = 'flat';               // no direction: the roof is drawn flat at the eave... and its top
  const eave = roofShape === 'flat' ? q.top_m : q.kind === 'spire' ? q.base_m : q.eave_m;
  return { ...q, g: b.g, h, area: Math.abs(ringArea(q.p)), style, roofShape, eaveM: eave, seed, eaveZ: b.g + eave };
}

/** A part's top is exposed (gets a parapet, may carry roof furniture) unless a taller part of the same building stands over its middle. */
function markExposed(parts) {
  for (const q of parts) {
    const [x, y] = repPoint(q.p);
    q.exposed = !parts.some((r) => r !== q && r.top > q.top + 0.5 && inRing(r.p, x, y));
  }
}

// ------------------------------------------------------------------ generic roof furniture
// Bulkheads and water tanks are drawn on flat roofs the data gives no detail for: a look, not a survey. They are never in the
// parts, the shadows of the numbers or the sky view, and they rise no more than 6 m, so they cannot change an answer.
function decorFor(e) {
  const tops = e.parts.filter((q) => q.exposed && q.roofShape === 'flat' && q.kind !== 'spire' && q.area >= 90);
  if (!tops.length || e.roof < 14) return [];
  const q = tops.reduce((a, c) => (c.top > a.top + 0.5 || (Math.abs(c.top - a.top) <= 0.5 && c.area > a.area) ? c : a), tops[0]);
  const hasBulk = e.parts.some((r) => r.kind === 'bulkhead' && r.top >= q.top - 0.5);
  const out = [];
  const [rx, ry] = repPoint(q.p), s = e.seed;
  const w = Math.min(14, Math.max(3.5, Math.sqrt(q.area) * (0.16 + 0.12 * ((s * 7) % 1))));
  const d = Math.min(12, Math.max(3, w * (0.6 + 0.5 * ((s * 13) % 1))));
  const hh = Math.min(5.5, 2.6 + Math.log10(Math.max(e.roof, 10)) * 1.2 * (0.8 + 0.4 * ((s * 5) % 1)));
  const rot = Math.atan2(q.p[3] - q.p[1], q.p[2] - q.p[0]);   // along the first wall
  if (!hasBulk && inRing(q.p, rx, ry)) out.push({ kind: 'box', x: rx, y: ry, w, d, rot, z0: q.top, z1: q.top + hh });
  const yr = +e.meta.year || 2000, tank = yr < 1945 && e.roof >= 18 && e.roof <= 95 && ((s * 11) % 1) < 0.65;
  if (tank) {
    const ang = rot + 1.2, k = Math.sqrt(q.area) * 0.3;
    const tx = rx + Math.cos(ang) * k, ty = ry + Math.sin(ang) * k;
    if (inRing(q.p, tx, ty)) out.push({ kind: 'tank', x: tx, y: ty, r: 1.9, z0: q.top + 0.0, z1: q.top + 5.6 });
  }
  return out;
}

// ------------------------------------------------------------------ budgets
/** A rough triangle count for entries (walls 2 per edge, caps edges - 2, parapets and decor on near ones): for budgets and tests. */
export function estimateTriangles(entries, { parapets = true } = {}) {
  let t = 0;
  for (const e of entries) {
    for (const q of e.parts) {
      const n = q.p.length / 2, holeN = (q.holes || []).reduce((a, h) => a + h.length / 2, 0);
      t += 2 * (n + holeN) + (n + holeN - 2) + (q.roofShape !== 'flat' ? n : 0);
      if (parapets && e.near && q.exposed && q.roofShape === 'flat' && q.kind !== 'spire') t += 6 * n + 2;
    }
    t += e.decor.reduce((a, d) => a + (d.kind === 'box' ? 10 : 34), 0);
  }
  return t;
}
export { ringOf };
