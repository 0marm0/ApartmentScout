// The measuring tape, the maths. Pure (no DOM, no three.js), so node:test covers it and the 2D plan, the Floor plan studio's
// 3D view and Unit 3D's Inside camera all share one definition of "a measurement", "what it snaps to" and "how it reads".
//
// Frame: the plan's own, in inches. [x, y, z] with +x to the right of the drawing, +y toward the top of the drawing
// (the plan's `up_bearing`) and z up from the floor. The plan is metre-scale (rooms are drawn from real dimensions), so a
// distance in this frame is a real distance.
import { footprint } from '../plan/checks.js';

export const IN_PER_M = 39.37007874;
const MAX_MEASUREMENTS = 40;

// ------------------------------------------------------------------ reading a length
/** Feet and inches to the nearest half inch: 100.5 -> 8' 4½", 7 -> 7", 24 -> 2'. */
export function fmtFtIn(inches) {
  if (!Number.isFinite(inches)) return '?';
  const sign = inches < 0 ? '-' : '', halves = Math.round(Math.abs(inches) * 2);
  const whole = Math.floor(halves / 2), half = halves % 2, ft = Math.floor(whole / 12), inch = whole % 12;
  const frac = half ? '½' : '';
  if (!ft) return `${sign}${inch || half ? `${inch || ''}${frac}"` : '0"'}`;
  return `${sign}${ft}'${inch || half ? ` ${inch}${frac}"` : ''}`;
}
/** Metres (two decimals) from a metre, centimetres (one decimal) below. */
export function fmtMetric(inches) {
  if (!Number.isFinite(inches)) return '?';
  const m = Math.abs(inches) / IN_PER_M, sign = inches < 0 ? '-' : '';
  return m >= 1 ? `${sign}${m.toFixed(2)} m` : `${sign}${(m * 100).toFixed(m * 100 < 10 ? 1 : 0)} cm`;
}
/** {primary, secondary, title}: feet and inches always, metres as well when the search is metric. */
export function describeLength(inches, { metric = false } = {}) {
  const imp = fmtFtIn(inches), met = fmtMetric(inches);
  return { primary: imp, secondary: metric ? met : '', title: `${imp} = ${met}` };
}

/**
 * Does this search read in metres? The criteria can say so (`search.units: metric`); without a word, a plan that was drawn in
 * metres belongs to a metric country. Feet and inches are always shown.
 */
export function isMetricSearch(crit, model) {
  const u = String(crit?.search?.units ?? crit?.units ?? '').toLowerCase();
  if (u === 'metric' || u === 'si' || u === 'm') return true;
  if (u === 'imperial' || u === 'us' || u === 'ft') return false;
  return model?.units === 'm';
}

// ------------------------------------------------------------------ geometry
export const dist3 = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1], (b[2] || 0) - (a[2] || 0));
export const mid3 = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, ((a[2] || 0) + (b[2] || 0)) / 2];
/** Closest point on segment a-b to p (3D), with its parameter. */
export function closestOnSegment(p, a, b) {
  const d = [b[0] - a[0], b[1] - a[1], (b[2] || 0) - (a[2] || 0)], L = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
  const t = L ? Math.max(0, Math.min(1, ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1] + ((p[2] || 0) - (a[2] || 0)) * d[2]) / L)) : 0;
  return { t, p: [a[0] + d[0] * t, a[1] + d[1] * t, (a[2] || 0) + d[2] * t] };
}

/**
 * Everything one measurement says: the straight-line distance, and how it splits into the run along the floor and the rise.
 * `kind`: 'height' (mostly straight up or down), 'floor' (level) or '3d'.
 */
export function measureInfo(a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = (b[2] || 0) - (a[2] || 0), run = Math.hypot(dx, dy), total = Math.hypot(run, dz);
  const kind = total < 0.25 ? 'floor' : Math.abs(dz) / total > 0.94 ? 'height' : Math.abs(dz) / total < 0.06 ? 'floor' : '3d';
  return { total, run, rise: Math.abs(dz), dx, dy, dz, kind };
}
/** Chip text for a measurement. `detail` explains a slanted one (run and rise) so a diagonal is never mistaken for a wall length. */
export function measureLabel(a, b, { metric = false } = {}) {
  const i = measureInfo(a, b), d = describeLength(i.total, { metric });
  const detail = i.kind === '3d' ? `${fmtFtIn(i.run)} along the floor, ${fmtFtIn(i.rise)} up` : '';
  return { text: d.primary + (d.secondary ? ` · ${d.secondary}` : ''), primary: d.primary, secondary: d.secondary, title: d.title + (detail ? ` (${detail})` : ''), detail, info: i };
}

// ------------------------------------------------------------------ what a point snaps to
const KIND_LABEL = { window: 'Window edge', door: 'Door edge', furniture: 'Furniture edge', fixture: 'Fixture edge', corner: 'Wall corner', wall: 'Wall edge' };
export const snapLabel = (kind) => KIND_LABEL[kind] || 'Point';

/**
 * Snap targets of a plan with its furniture: points (corners, window and door edges, furniture corners) and segments (the
 * edges between them). Wall corners are the corners of the faces you can see, not the centrelines the plan is drawn on, so a
 * measurement from wall face to wall face reads the clear width of the room.
 * @param {object} model normalised plan (plan/model.js)
 * @param {object[]} [items] resolved furniture (plan/catalog.js resolve), hidden ones are skipped
 * @returns {{points: {p: number[], kind: string}[], segments: {a: number[], b: number[], kind: string}[]}}
 */
export function snapTargets(model, items = []) {
  const points = [], segments = [], seen = new Map();
  const addPoint = (p, kind) => {
    const key = `${Math.round(p[0] * 2)}|${Math.round(p[1] * 2)}|${Math.round((p[2] || 0) * 2)}`;
    if (seen.has(key)) return;   // the first kind wins: windows and doors, then furniture, then the plain wall corner
    seen.set(key, kind); points.push({ p: [p[0], p[1], p[2] || 0], kind });
  };
  const addSeg = (a, b, kind) => { if (dist3(a, b) > 0.5) segments.push({ a: [a[0], a[1], a[2] || 0], b: [b[0], b[1], b[2] || 0], kind }); };
  const half = (model.wallT || 4.8) / 2;

  // windows: the four corners of the glass on the room side of the wall, and its frame
  for (const w of model.windows) {
    const n = w.normal || [0, 0], off = (p) => [p[0] - n[0] * half, p[1] - n[1] * half];
    const a = off(w.a), b = off(w.b), s = w.sill, h = w.head;
    const c = [[a[0], a[1], s], [b[0], b[1], s], [b[0], b[1], h], [a[0], a[1], h]];
    c.forEach((p) => addPoint(p, 'window'));
    for (let i = 0; i < 4; i++) addSeg(c[i], c[(i + 1) % 4], 'window');
  }
  // doors: the jambs from the floor to the head
  for (const d of model.doors) {
    const a = d.a, b = d.b, hd = d.head;
    [[a, 0], [b, 0], [a, hd], [b, hd]].forEach(([p, z]) => addPoint([p[0], p[1], z], 'door'));
    addSeg([a[0], a[1], 0], [a[0], a[1], hd], 'door'); addSeg([b[0], b[1], 0], [b[0], b[1], hd], 'door'); addSeg([a[0], a[1], hd], [b[0], b[1], hd], 'door');
  }
  // fixtures: closets, counters, columns
  for (const f of model.fixtures) {
    const lo = f.elev || 0, hi = lo + (f.height || 0);
    f.poly.forEach((p, i) => {
      const q = f.poly[(i + 1) % f.poly.length];
      addPoint([p[0], p[1], lo], 'fixture'); if (hi > lo) addPoint([p[0], p[1], hi], 'fixture');
      addSeg([p[0], p[1], lo], [q[0], q[1], lo], 'fixture'); if (hi > lo) { addSeg([p[0], p[1], hi], [q[0], q[1], hi], 'fixture'); addSeg([p[0], p[1], lo], [p[0], p[1], hi], 'fixture'); }
    });
  }
  // furniture: the footprint at the floor (or where it hangs) and at its top
  for (const it of items) {
    if (!it || it.hidden || it.flat) continue;
    const fp = footprint(it), lo = it.elev || 0, hi = lo + it.h;
    fp.forEach((p, i) => {
      const q = fp[(i + 1) % fp.length];
      addPoint([p[0], p[1], lo], 'furniture'); addPoint([p[0], p[1], hi], 'furniture');
      addSeg([p[0], p[1], lo], [q[0], q[1], lo], 'furniture'); addSeg([p[0], p[1], hi], [q[0], q[1], hi], 'furniture'); addSeg([p[0], p[1], lo], [p[0], p[1], hi], 'furniture');
    });
  }
  // wall faces: each room inset by half the wall thickness (the walls stand on the room's edges), at the floor and at the ceiling
  for (const room of model.rooms) {
    const face = insetPoly(room.poly, half);
    face.forEach((p, i) => {
      const q = face[(i + 1) % face.length];
      for (const z of [0, model.ceiling]) { addPoint([p[0], p[1], z], 'corner'); addSeg([p[0], p[1], z], [q[0], q[1], z], 'wall'); }
      addSeg([p[0], p[1], 0], [p[0], p[1], model.ceiling], 'wall');
    });
  }
  return { points, segments };
}

/** A counter-clockwise polygon moved `d` inward along every edge (mitred corners). A spike that would fold over is nudged along one edge only. */
export function insetPoly(poly, d) {
  const n = poly.length, out = [];
  const inward = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1; return [-dy / L, dx / L]; };
  for (let i = 0; i < n; i++) {
    const prev = poly[(i + n - 1) % n], v = poly[i], next = poly[(i + 1) % n], n1 = inward(prev, v), n2 = inward(v, next);
    const den = 1 + n1[0] * n2[0] + n1[1] * n2[1];
    out.push(den < 0.2 ? [v[0] + n2[0] * d, v[1] + n2[1] * d] : [v[0] + (d * (n1[0] + n2[0])) / den, v[1] + (d * (n1[1] + n2[1])) / den]);
  }
  return out;
}

/** The same targets flattened onto the floor, for the 2D plan (heights do not exist there). */
export function flattenTargets(t) {
  const seen = new Set(), points = [], segments = [];
  for (const q of t.points) { const key = `${Math.round(q.p[0] * 2)}|${Math.round(q.p[1] * 2)}`; if (seen.has(key)) continue; seen.add(key); points.push({ p: [q.p[0], q.p[1], 0], kind: q.kind }); }
  const segSeen = new Set();
  for (const s of t.segments) {
    if (Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]) < 0.5) continue;   // a vertical edge is a point on the plan
    const k = [s.a, s.b].map((p) => `${Math.round(p[0] * 2)},${Math.round(p[1] * 2)}`).sort().join('>');
    if (segSeen.has(k)) continue; segSeen.add(k);
    segments.push({ a: [s.a[0], s.a[1], 0], b: [s.b[0], s.b[1], 0], kind: s.kind });
  }
  return { points, segments };
}

/**
 * The snap for a pointer. `hit` is where the pointer's ray meets a surface (plan inches), `cursor` the pointer in pixels and
 * `project(p)` maps a plan point to pixels (or null when it is behind the camera). Points beat edges; among points the one
 * nearest the pointer on screen wins. A candidate must also be near the surface point (`world` inches) so a corner behind a
 * wall is never taken for one in front of it.
 * @returns {{p: number[], kind: string, snapped: boolean}}
 */
export function pickSnap(targets, hit, cursor, project, { px = 14, world = 30 } = {}) {
  const screen = (p) => { const q = project(p); return q ? Math.hypot(q[0] - cursor[0], q[1] - cursor[1]) : Infinity; };
  let best = null;
  for (const t of targets.points) {
    if (dist3(t.p, hit) > world) continue;
    const d = screen(t.p); if (d <= px && (!best || d < best.d)) best = { d, p: t.p, kind: t.kind };
  }
  if (best) return { p: best.p, kind: best.kind, snapped: true };
  for (const s of targets.segments) {
    const c = closestOnSegment(hit, s.a, s.b);
    if (dist3(c.p, hit) > world * 0.5) continue;
    const d = screen(c.p); if (d <= px * 0.7 && (!best || d < best.d)) best = { d, p: c.p, kind: s.kind };
  }
  return best ? { p: best.p, kind: best.kind, snapped: true } : { p: hit, kind: 'free', snapped: false };
}

// ------------------------------------------------------------------ the list of measurements
/**
 * The measurements of one view, with the point waiting for its partner. Pure state with a change callback.
 * Each measurement is {id, a, b, ka, kb} (points in plan inches; ka/kb what each end snapped to).
 */
export function createMeasureStore(onChange = () => {}) {
  let n = 0, list = [], pending = null;
  const emit = () => onChange(api);
  const api = {
    get list() { return list; },
    get pending() { return pending; },
    get count() { return list.length; },
    /** Place a point: the first starts a measurement, the second finishes it. Returns the finished measurement or null. */
    place(p, kind = 'free') {
      if (!pending) { pending = { p: [...p], kind }; emit(); return null; }
      if (dist3(pending.p, p) < 0.25) return null;   // the same point twice is not a measurement
      const m = { id: ++n, a: pending.p, b: [...p], ka: pending.kind, kb: kind };
      list = [...list, m].slice(-MAX_MEASUREMENTS); pending = null; emit(); return m;
    },
    cancelPending() { if (pending) { pending = null; emit(); } },
    remove(id) { list = list.filter((m) => m.id !== id); emit(); },
    removeLast() { if (pending) { pending = null; emit(); return; } list = list.slice(0, -1); emit(); },
    clear() { list = []; pending = null; emit(); },
    /** Replace everything (restoring what a view had). */
    load(next, nextPending = null) { list = (next || []).slice(0, MAX_MEASUREMENTS); n = Math.max(n, ...list.map((m) => m.id), 0); pending = nextPending; emit(); },
  };
  return api;
}

/** The measurements as a plain list for a test or a copy-out: label and inches. */
export function summarise(list, opts) {
  return list.map((m) => { const l = measureLabel(m.a, m.b, opts); return { id: m.id, inches: Math.round(l.info.total * 100) / 100, text: l.primary, metres: Math.round((l.info.total / IN_PER_M) * 1000) / 1000, kind: l.info.kind }; });
}

