// Plan tracer geometry: pure functions (no DOM) behind "New plan from image" and "Edit plan".
// The tracer document keeps every length in the plan's own units (ft, m or in) with +x to the right
// of the drawing and +y to its top, exactly like plan JSON v2, so export is a straight copy.
// Image positions (scale anchors, check dimension) stay in image pixels (y down) so a later
// re-calibration can move the traced geometry with the image.
import { UNIT_IN, polyArea, pointInPoly, segDist, mergeSegments, bbox, ROOM_KINDS, FIXTURE_KINDS } from './model.js';

export const TRACER_TOOL = 'apartmentscout-tracer 1';
export const MATCHES = ['exact-unit', 'line-tier', 'representative', 'stated-dims', 'photo-estimate'];
export const SWINGS = ['+x', '-x', '+y', '-y', 'in', 'slide', 'pocket', 'none'];
const DEG = Math.PI / 180;
const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const dist = (p, q) => Math.hypot(q[0] - p[0], q[1] - p[1]);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const clone = (o) => JSON.parse(JSON.stringify(o));
/** Today's date in the renter's time zone, YYYY-MM-DD. */
export const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Defaults per unit system: door and window widths, sill/head, ceiling, wall, grid and snap radius. */
export function defaultsFor(units = 'ft') {
  const k = UNIT_IN[units] || 12, f = (inches) => inches / k;
  return { door: f(32), window: f(48), sill: f(24), head: f(84), ceiling: f(108), wall: units === 'm' ? 0.12 : f(4.8), grid: units === 'm' ? 0.01 : f(1), fixture: f(24) };
}

/** Plain text for names and notes: no markup, no control characters, trimmed and capped. */
export function plainText(s, max = 80) {
  return String(s ?? '').replace(/[<>\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}
/** A plan id: lowercase letters, digits, - and _ only. */
export function slugId(s, fallback = 'traced-plan') {
  const id = String(s ?? '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  return id || fallback;
}

// ------------------------------------------------------------------ lengths
/**
 * Read a typed length into plan units. Accepts 12'6", 12' 6, 12 ft 6 in, 12'-6 1/2", 150", 150 in,
 * 3.81 m, 381 cm, 3810 mm, or a bare number (already in plan units). Returns null when unreadable.
 */
export function parseLength(input, units = 'ft') {
  const k = UNIT_IN[units]; if (!k) return null;
  const pos = (v) => (fin(v) && v > 0 ? v : null);
  if (typeof input === 'number') return pos(input);
  const s = String(input ?? '').trim().toLowerCase().replace(/[’′‘]/g, "'").replace(/[”″“]/g, '"').replace(/''/g, '"').replace(/(\d),(\d)/g, '$1.$2');
  if (!s) return null;
  let m;
  if ((m = s.match(/^(\d+(?:\.\d+)?)\s*(mm|cm|m|meters?|metres?)$/))) {
    const f = m[2] === 'mm' ? 0.001 : m[2] === 'cm' ? 0.01 : 1;
    return pos((+m[1] * f * UNIT_IN.m) / k);
  }
  if ((m = s.match(/^(\d+(?:\.\d+)?)\s*(?:'|ft\.?|feet|foot)\s*-?\s*(?:(\d+(?:\.\d+)?)(?:\s+(\d+)\/(\d+))?\s*(?:"|in\.?|inch|inches)?)?$/))) {
    const frac = m[3] ? +m[3] / +m[4] : 0;
    return pos((+m[1] * 12 + (m[2] ? +m[2] : 0) + frac) / k);
  }
  if ((m = s.match(/^(\d+(?:\.\d+)?)(?:\s+(\d+)\/(\d+))?\s*(?:"|in\.?|inch|inches)$/))) return pos((+m[1] + (m[2] ? +m[2] / +m[3] : 0)) / k);
  if ((m = s.match(/^(\d+(?:\.\d+)?)$/))) return pos(+m[1]);
  return null;
}
/** Display a length in plan units: feet-inches for ft/in plans, metres for m plans. */
export function fmtLen(v, units = 'ft') {
  if (!fin(v)) return '?';
  if (units === 'm') return `${v.toFixed(2)} m`;
  const t = Math.round(Math.abs(v) * (UNIT_IN[units] || 12)), f = Math.floor(t / 12), i = t % 12;
  return `${v < 0 ? '-' : ''}${f}'${i}"`;
}
/** Display an area given in square plan units. */
export function fmtArea(a, units = 'ft') {
  if (!fin(a)) return '?';
  if (units === 'm') return `${a.toFixed(1)} m²`;
  const sqft = (a * (UNIT_IN[units] || 12) ** 2) / 144;
  return `${Math.round(sqft).toLocaleString('en-US')} ft²`;
}

// ------------------------------------------------------------------ calibration
/** Pixels per plan unit from two anchor points (image pixels) and the real length between them. */
export function scaleFromAnchors(p, q, length) {
  const d = p && q ? dist(p, q) : 0;
  return d > 0 && fin(length) && length > 0 ? d / length : null;
}
/** What a second, known dimension measures at a given scale, and how far off it is (percent). */
export function checkScale(scale, p, q, length) {
  if (!(scale > 0) || !(length > 0) || !p || !q) return null;
  const measured = dist(p, q) / scale;
  return { measured, error_pct: ((measured - length) / length) * 100 };
}
/** Confidence label from the check dimension's disagreement. */
export function confidenceOf(errPct) {
  if (!fin(errPct)) return 'unchecked';
  const e = Math.abs(errPct);
  return e <= 1.5 ? 'high' : e <= 4 ? 'medium' : 'low';
}
/**
 * Build a calibration. `image` is {name, w, h, page?}; `anchors` are two image-pixel points; `length`
 * is the real distance in plan units. The plan origin sits at the image's bottom-left corner.
 */
export function makeCal({ image, anchors, length, check = null, origin = null }) {
  const scale = scaleFromAnchors(anchors?.[0], anchors?.[1], length);
  if (!scale) return null;
  const cal = { image: { ...image }, anchors: anchors.map((p) => [...p]), length, scale, origin: origin ? [...origin] : [0, image?.h || 0] };
  if (check?.anchors?.length === 2 && check.length > 0) cal.check = { anchors: check.anchors.map((p) => [...p]), length: check.length, ...checkScale(scale, check.anchors[0], check.anchors[1], check.length) };
  return cal;
}
/** A provisional calibration before the renter sets the scale: the image is about 40 ft (12 m) wide. */
export function provisionalCal(image, units = 'ft') {
  const span = (40 * 12) / (UNIT_IN[units] || 12);
  return { image: { ...image }, anchors: null, length: null, scale: (image.w || 1000) / span, origin: [0, image.h || 0], provisional: true };
}
export function imgToPlan(cal, [px, py]) { return [(px - cal.origin[0]) / cal.scale, (cal.origin[1] - py) / cal.scale]; }
export function planToImg(cal, [x, y]) { return [x * cal.scale + cal.origin[0], cal.origin[1] - y * cal.scale]; }

/** Apply a point mapping to every horizontal coordinate in a document (rooms, openings, fixtures). */
export function mapDoc(doc, f) {
  const d = clone(doc);
  for (const r of d.rooms) r.poly = r.poly.map(f);
  for (const o of [...d.doors, ...d.windows]) { o.a = f(o.a); o.b = f(o.b); }
  for (const fx of d.fixtures) {
    if (fx.poly) { fx.poly = fx.poly.map(f); continue; }
    const c = [f([fx.x, fx.y]), f([fx.x + fx.w, fx.y + fx.h])];
    fx.x = Math.min(c[0][0], c[1][0]); fx.y = Math.min(c[0][1], c[1][1]); fx.w = Math.abs(c[1][0] - c[0][0]); fx.h = Math.abs(c[1][1] - c[0][1]);
  }
  return d;
}
/** Move traced geometry onto a new calibration: plan -> image pixels (old) -> plan (new). */
export function recalibrate(doc, newCal) {
  const old = doc.cal;
  const next = old ? mapDoc(doc, (p) => imgToPlan(newCal, planToImg(old, p))) : clone(doc);
  next.cal = clone(newCal);
  return next;
}

// ------------------------------------------------------------------ orientation
/** Compass bearing the top of the drawing faces, from a north arrow drawn tail -> head in plan space. */
export function bearingFromArrow(tail, head) {
  const dx = head[0] - tail[0], dy = head[1] - tail[1];
  if (Math.hypot(dx, dy) < 1e-9) return null;
  const theta = Math.atan2(dx, dy) / DEG; // north's direction, clockwise from the top of the drawing
  return norm360(-theta);
}
/** Bearing of the drawing's top, from one wall's outward normal and the compass bearing that wall faces. */
export function bearingFromFacade(normal, faces) {
  if (!fin(faces) || !normal) return null;
  return norm360(faces - Math.atan2(normal[0], normal[1]) / DEG);
}
export const norm360 = (b) => Math.round((((b % 360) + 360) % 360) * 10) / 10 % 360;
export const COMPASS16 = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export const compass16 = (b) => COMPASS16[Math.round(norm360(b) / 22.5) % 16];

// ------------------------------------------------------------------ snapping
/**
 * Snap a pointer position while tracing. In order: an existing vertex; the previous vertex's 90° or
 * 45° ray; alignment of x or y with another vertex; an existing edge; then the grid.
 * @param {number[]} p pointer, plan units
 * @param {{verts?: number[][], edges?: number[][][], prev?: number[]|null, tol?: number, angle?: boolean, grid?: number}} o
 * @returns {{p: number[], kind: 'vertex'|'square'|'diagonal'|'edge'|'free', aligned: boolean}}
 */
export function snapPoint(p, o = {}) {
  const { verts = [], edges = [], prev = null, tol = 0.5, angle = true, grid = 0 } = o;
  let best = null, bd = tol;
  for (const v of verts) { const d = dist(p, v); if (d <= bd) { bd = d; best = v; } }
  if (best) return { p: [best[0], best[1]], kind: 'vertex', aligned: false };
  let q = [p[0], p[1]], kind = 'free', dir = null;
  if (prev && angle) {
    const dx = p[0] - prev[0], dy = p[1] - prev[1], L = Math.hypot(dx, dy);
    if (L > 1e-9) {
      const a = Math.atan2(dy, dx), s = Math.round(a / (Math.PI / 4)) * (Math.PI / 4), off = Math.abs(a - s);
      if (off <= 7 * DEG || L * Math.sin(off) <= tol) {
        dir = [Math.cos(s), Math.sin(s)].map((c) => (Math.abs(c) < 1e-9 ? 0 : c));
        const along = L * Math.cos(off);
        q = [prev[0] + dir[0] * along, prev[1] + dir[1] * along];
        kind = dir[0] === 0 || dir[1] === 0 ? 'square' : 'diagonal';
      }
    }
  }
  const freeX = kind === 'free' || (kind === 'square' && dir[1] === 0);
  const freeY = kind === 'free' || (kind === 'square' && dir[0] === 0);
  let ax = null, ay = null;
  for (const v of verts) {
    if (freeX && Math.abs(v[0] - q[0]) <= tol && (ax == null || Math.abs(v[0] - q[0]) < Math.abs(ax - q[0]))) ax = v[0];
    if (freeY && Math.abs(v[1] - q[1]) <= tol && (ay == null || Math.abs(v[1] - q[1]) < Math.abs(ay - q[1]))) ay = v[1];
  }
  if (ax != null) q[0] = ax;
  if (ay != null) q[1] = ay;
  if (kind === 'free' && ax == null && ay == null) {
    let e = null, ed = tol;
    for (const [a, b] of edges) { const d = segDist(q, a, b); if (d <= ed) { ed = d; e = [a, b]; } }
    if (e) { const pr = project(q, e[0], e[1]); return { p: pr.q, kind: 'edge', aligned: false }; }
  }
  if (grid > 0) {
    if (freeX && ax == null) q[0] = Math.round(q[0] / grid) * grid;
    if (freeY && ay == null) q[1] = Math.round(q[1] / grid) * grid;
  }
  return { p: q.map((v) => +v.toFixed(6)), kind, aligned: ax != null || ay != null };
}
/** Project a point on segment a-b: {q, s (distance from a), t (0..1), d (distance to the segment)}. */
export function project(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy, L = Math.sqrt(L2);
  const t = L2 ? clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2, 0, 1) : 0;
  const q = [a[0] + dx * t, a[1] + dy * t];
  return { q, t, s: t * L, d: dist(p, q) };
}

// ------------------------------------------------------------------ polygons
/** Area of a polygon in square plan units (always positive). */
export const roomArea = (poly) => Math.abs(polyArea(poly));
/** Drop repeated and collinear points and orient counter-clockwise (+y up). */
export function cleanPoly(poly, eps = 1e-6) {
  let pts = poly.filter((p, i) => dist(p, poly[(i + poly.length - 1) % poly.length]) > eps);
  let changed = true;
  while (changed && pts.length > 3) {
    changed = false;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i + pts.length - 1) % pts.length], b = pts[i], c = pts[(i + 1) % pts.length];
      const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
      if (Math.abs(cross) <= eps * Math.max(1, dist(a, c))) { pts.splice(i, 1); changed = true; break; }
    }
  }
  if (polyArea(pts) < 0) pts = pts.reverse();
  return pts.map((p) => [p[0], p[1]]);
}
function segsCross(a, b, c, d) {
  const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}
/** True when two non-adjacent edges of the polygon cross. */
export function selfIntersects(poly) {
  const n = poly.length;
  for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) {
    if (i === 0 && j === n - 1) continue;
    if (segsCross(poly[i], poly[(i + 1) % n], poly[j], poly[(j + 1) % n])) return true;
  }
  return false;
}
/** An axis-aligned rectangle {x, y, w, h} when the polygon is one, else null. */
export function asRect(poly, eps = 1e-6) {
  if (poly.length !== 4) return null;
  const b = bbox(poly);
  const corners = [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]];
  if (!poly.every((p) => corners.some((c) => dist(p, c) <= eps)) || b.x1 - b.x0 <= eps || b.y1 - b.y0 <= eps) return null;
  return { x: b.x0, y: b.y0, w: b.x1 - b.x0, h: b.y1 - b.y0 };
}
/** Insert a vertex at the midpoint of edge i (between poly[i] and poly[i+1]). */
export function insertVertex(poly, i) {
  const a = poly[i], b = poly[(i + 1) % poly.length];
  const out = poly.map((p) => [...p]); out.splice(i + 1, 0, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
  return out;
}

// ------------------------------------------------------------------ walls and openings
/**
 * Wall centrelines from room edges: shared edges merge into one wall. Each wall knows its length,
 * direction, left normal and whether a room lies on each side at its midpoint.
 * @param {{poly: number[][], name?: string}[]} rooms
 * @param {{tol?: number, probe?: number}} o tol: merge tolerance; probe: how far to look for rooms on each side
 */
export function deriveWalls(rooms, { tol = 0.05, probe = 0.25 } = {}) {
  const segs = [];
  for (const r of rooms) for (let i = 0; i < r.poly.length; i++) segs.push({ a: r.poly[i], b: r.poly[(i + 1) % r.poly.length], t: 1 });
  return mergeSegments(segs, tol).map((w, i) => {
    const len = dist(w.a, w.b), u = [(w.b[0] - w.a[0]) / len, (w.b[1] - w.a[1]) / len], n = [-u[1], u[0]];
    const mid = [(w.a[0] + w.b[0]) / 2, (w.a[1] + w.b[1]) / 2];
    const at = (s) => rooms.find((r) => pointInPoly([mid[0] + n[0] * probe * s, mid[1] + n[1] * probe * s], r.poly)) || null;
    const left = at(1), right = at(-1);
    return { id: `w${i}`, a: w.a.map((v) => +v.toFixed(6)), b: w.b.map((v) => +v.toFixed(6)), len, u, n, left: left?.name ?? null, right: right?.name ?? null, exterior: !left || !right };
  }).filter((w) => w.len > 1e-6);
}
/** The wall nearest a point, within tol: {wall, ...project()}. */
export function nearestWall(p, walls, tol = Infinity) {
  let best = null;
  for (const w of walls) { const pr = project(p, w.a, w.b); if (pr.d <= tol && (!best || pr.d < best.d)) best = { wall: w, ...pr }; }
  return best;
}
/**
 * Place an opening of `width` on a wall, centred where the pointer projects and kept inside the wall.
 * Returns {a, b, width} with a -> b running along the wall's direction, or null if there is no wall.
 */
export function placeOpening(wall, p, width) {
  if (!wall || !(width > 0)) return null;
  const L = wall.len, wd = Math.min(width, L);
  const s = clamp(project(p, wall.a, wall.b).s, wd / 2, L - wd / 2);
  const at = (v) => [wall.a[0] + wall.u[0] * v, wall.a[1] + wall.u[1] * v].map((c) => +c.toFixed(6));
  return { a: at(s - wd / 2), b: at(s + wd / 2), width: wd };
}
/** Keep an opening's centre and direction, change its width. */
export function resizeOpening(o, width) {
  const L = dist(o.a, o.b); if (!(L > 0) || !(width > 0)) return { ...o };
  const u = [(o.b[0] - o.a[0]) / L, (o.b[1] - o.a[1]) / L], m = [(o.a[0] + o.b[0]) / 2, (o.a[1] + o.b[1]) / 2];
  return { ...o, a: [m[0] - (u[0] * width) / 2, m[1] - (u[1] * width) / 2], b: [m[0] + (u[0] * width) / 2, m[1] + (u[1] * width) / 2] };
}
/** Swing code (+x, -x, +y, -y) for a leaf opening toward a point, or null when the wall is not square. */
export function swingToward(a, b, toward) {
  const L = dist(a, b); if (!(L > 0)) return null;
  const n = [-(b[1] - a[1]) / L, (b[0] - a[0]) / L], m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const s = Math.sign((toward[0] - m[0]) * n[0] + (toward[1] - m[1]) * n[1]) || 1, v = [n[0] * s, n[1] * s];
  if (Math.abs(v[0]) > 0.999) return v[0] > 0 ? '+x' : '-x';
  if (Math.abs(v[1]) > 0.999) return v[1] > 0 ? '+y' : '-y';
  return null;
}
/** The rooms on each side of an opening (at its midpoint): {left, right} names or null. */
export function sidesOf(o, rooms, probe = 0.4) {
  const L = dist(o.a, o.b) || 1, n = [-(o.b[1] - o.a[1]) / L, (o.b[0] - o.a[0]) / L], m = [(o.a[0] + o.b[0]) / 2, (o.a[1] + o.b[1]) / 2];
  const at = (s) => rooms.find((r) => pointInPoly([m[0] + n[0] * probe * s, m[1] + n[1] * probe * s], r.poly))?.name ?? null;
  return { left: at(1), right: at(-1), n, m };
}
/**
 * Door swing fields for "opens into <side>": side +1 = the left of a->b, -1 = the right. Square walls
 * use +x/-x/+y/-y; angled walls use "in" with the room name.
 */
export function swingInto(o, side, rooms, probe = 0.4) {
  const s = sidesOf(o, rooms, probe), toward = [s.m[0] + s.n[0] * side, s.m[1] + s.n[1] * side];
  const code = swingToward(o.a, o.b, toward), room = side > 0 ? s.left : s.right;
  if (code) return { swing: code, room: room || '' };
  return room ? { swing: 'in', room } : { swing: null, room: '' };
}
/** Which side (+1 left, -1 right) a door currently swings into, or 0 when unknown. */
export function swingSide(o, rooms, probe = 0.4) {
  const s = sidesOf(o, rooms, probe);
  const SIDES = { '+x': [1, 0], '-x': [-1, 0], '+y': [0, 1], '-y': [0, -1] };
  if (SIDES[o.swing]) return Math.sign(SIDES[o.swing][0] * s.n[0] + SIDES[o.swing][1] * s.n[1]) || 0;
  if (o.swing === 'in' && o.room) return o.room === s.left ? 1 : o.room === s.right ? -1 : 0;
  return 0;
}

// ------------------------------------------------------------------ the tracer document
let seq = 0;
export const newId = (p) => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`;

/** A blank document for tracing a new plan. */
export function emptyDoc({ units = 'ft', id = 'traced-plan', title = 'Traced plan' } = {}) {
  const d = defaultsFor(units);
  return { mode: 'trace', id: slugId(id), title: plainText(title), units, ceiling: +d.ceiling.toFixed(3), wall: +d.wall.toFixed(3), up_bearing: null, bearing: null, floor: null,
    match: 'representative', note: '', label: '', rooms: [], doors: [], windows: [], fixtures: [], extra: {}, provenance: {}, source: '', cal: null, changes: [] };
}

const PASS = ['walls', 'open_walls', 'keepout', 'layouts'];
/** Open an existing plan JSON (schema 1 or 2) for editing. The original object is not changed. */
export function fromPlanJSON(raw, { label = '' } = {}) {
  if (!raw || typeof raw !== 'object') throw new Error('Plan is not an object');
  const units = UNIT_IN[raw.units || 'ft'] ? raw.units || 'ft' : null;
  if (!units) throw new Error('Unknown plan units');
  const d = defaultsFor(units), P = (p) => Array.isArray(p) && p.length >= 2 && fin(+p[0]) && fin(+p[1]);
  const seg = (o) => (P([o.x1, o.y1]) && P([o.x2, o.y2]) ? { a: [+o.x1, +o.y1], b: [+o.x2, +o.y2] } : P(o.a) && P(o.b) ? { a: [+o.a[0], +o.a[1]], b: [+o.b[0], +o.b[1]] } : null);
  const rooms = (raw.rooms || []).map((r, i) => {
    let poly = null;
    if (Array.isArray(r.poly) && r.poly.length >= 3 && r.poly.every(P)) poly = r.poly.map((p) => [+p[0], +p[1]]);
    else if ([r.x, r.y, r.w, r.h].every((v) => fin(+v)) && r.w > 0 && r.h > 0) poly = [[+r.x, +r.y], [+r.x + +r.w, +r.y], [+r.x + +r.w, +r.y + +r.h], [+r.x, +r.y + +r.h]];
    if (!poly) return null;
    if (polyArea(poly) < 0) poly.reverse();
    return { id: `r${i}`, name: plainText(r.name || `Room ${i + 1}`, 60), kind: ROOM_KINDS.includes(r.kind) ? r.kind : 'other', poly, stated: plainText(r.stated || '', 60), est: !!r.est };
  }).filter(Boolean);
  const keep = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] != null).map((k) => [k, o[k]]));
  const doors = (raw.doors || []).map((o, i) => { const s = seg(o); return s && { id: `d${i}`, ...s, ...keep(o, ['hinge', 'swing', 'leaf', 'head', 'room', 'kind', 'name']) }; }).filter(Boolean);
  const windows = (raw.windows || []).map((o, i) => { const s = seg(o); return s && { id: `n${i}`, ...s, sill: fin(o.sill) ? o.sill : +d.sill.toFixed(3), head: fin(o.head) ? o.head : +d.head.toFixed(3), ...keep(o, ['room', 'note']) }; }).filter(Boolean);
  const fixtures = (raw.fixtures || []).map((f, i) => ({ id: `f${i}`, ...clone(f), kind: FIXTURE_KINDS.includes(f.kind) ? f.kind : 'other' }));
  const extra = {}; for (const k of PASS) if (raw[k] != null) extra[k] = clone(raw[k]);
  const pv = raw.provenance && typeof raw.provenance === 'object' ? clone(raw.provenance) : {};
  return {
    mode: 'edit', id: slugId(raw.id || 'plan'), title: plainText(raw.title || raw.id || 'Plan'), units,
    ceiling: fin(raw.ceiling) ? raw.ceiling : +d.ceiling.toFixed(3), wall: fin(raw.wall) ? raw.wall : +d.wall.toFixed(3),
    up_bearing: fin(raw.up_bearing) ? raw.up_bearing : null, bearing: pv.trace?.bearing ? clone(pv.trace.bearing) : null, floor: Number.isInteger(raw.floor) ? raw.floor : null,
    match: MATCHES.includes(pv.match) ? pv.match : '', note: '', label: plainText(label, 60), rooms, doors, windows, fixtures, extra, provenance: pv,
    source: typeof raw.source === 'string' ? raw.source.slice(0, 600) : '', cal: null, changes: [], schema: raw.schema === 2 ? 2 : 1,
  };
}

const rnd = (units) => { const q = units === 'm' ? 1000 : units === 'in' ? 10 : 1000; return (v) => Math.round(v * q) / q; };
const text = (s, max = 600) => plainText(s, max);

/**
 * Plan JSON v2 for the document: rectangles stay rectangles, polygons stay polygons, and the
 * provenance carries a `trace` block (who traced it, from which image, scale anchors, check error).
 * @param {object} doc tracer document
 * @param {{date?: string, origin?: boolean}} o date of the trace (YYYY-MM-DD); origin: false keeps the
 *   document's coordinates (the editor draws from it), true shifts a new tracing to start at (0, 0)
 */
export function toPlanJSON(doc, { date = localDate(), origin = true } = {}) {
  if (origin) doc = toOrigin(doc);
  const R = rnd(doc.units), pt = (p) => [R(p[0]), R(p[1])];
  const rooms = doc.rooms.map((r) => {
    const rect = asRect(r.poly), out = { name: text(r.name, 60) || 'Room', kind: ROOM_KINDS.includes(r.kind) ? r.kind : 'other' };
    if (rect) Object.assign(out, { x: R(rect.x), y: R(rect.y), w: R(rect.w), h: R(rect.h) }); else out.poly = r.poly.map(pt);
    if (r.stated) out.stated = text(r.stated, 60);
    if (r.est) out.est = true;
    return out;
  });
  const seg = (o) => { const a = pt(o.a), b = pt(o.b); return { x1: a[0], y1: a[1], x2: b[0], y2: b[1] }; };
  const windows = doc.windows.map((w) => ({ ...(w.room ? { room: text(w.room, 60) } : {}), ...(w.note ? { note: text(w.note, 80) } : {}), ...seg(w), sill: R(w.sill), head: R(w.head) }));
  const doors = doc.doors.map((o) => {
    const out = { ...seg(o) };
    if (o.hinge === 'a' || o.hinge === 'b') out.hinge = o.hinge;
    if (SWINGS.includes(o.swing)) out.swing = o.swing;
    if (o.room) out.room = text(o.room, 60);
    if (o.kind) out.kind = text(o.kind, 20);
    if (o.name) out.name = text(o.name, 60);
    if (fin(o.leaf)) out.leaf = R(o.leaf);
    if (fin(o.head)) out.head = R(o.head);
    if (out.swing === 'in' && !out.room) delete out.swing;
    return out;
  });
  const fixtures = doc.fixtures.map((f) => {
    const out = { kind: FIXTURE_KINDS.includes(f.kind) ? f.kind : 'other' };
    if (f.label) out.label = text(f.label, 60);
    if (Array.isArray(f.poly)) out.poly = f.poly.map(pt); else Object.assign(out, { x: R(f.x), y: R(f.y), w: R(f.w), h: R(f.h) });
    for (const k of ['height', 'elev', 'reserve']) if (fin(f[k]) && f[k] >= 0) out[k] = R(f[k]);
    for (const k of ['doors', 'front', 'note']) if (f[k]) out[k] = text(f[k], k === 'note' ? 120 : 20);
    if (typeof f.est === 'boolean') out.est = f.est;
    return out;
  });
  const pv = doc.provenance || {};
  const printed = doc.rooms.filter((r) => r.stated).map((r) => text(`${r.name} ${r.stated}`, 80));
  const estimated = [...new Set([...(Array.isArray(pv.estimated) ? pv.estimated : []), ...doc.rooms.filter((r) => r.est).map((r) => `${r.name} size or position`)].map((s) => text(s, 120)))].slice(0, 20);
  const provenance = {};
  if (doc.match) provenance.match = doc.match;
  for (const k of ['floor_band']) if (pv[k]) provenance[k] = text(pv[k], 30);
  provenance.checked = date;
  const allPrinted = [...new Set([...(Array.isArray(pv.printed) ? pv.printed.map((s) => text(s, 80)) : []), ...printed])].slice(0, 20);
  if (allPrinted.length) provenance.printed = allPrinted;
  if (estimated.length) provenance.estimated = estimated;
  for (const k of ['bedroom_door_drawn', 'wd_drawn']) if (typeof pv[k] === 'boolean') provenance[k] = pv[k];
  provenance.trace = traceBlock(doc, date);
  const plan = { schema: 2, id: slugId(doc.id), title: text(doc.title, 80) || slugId(doc.id), units: doc.units, ceiling: R(doc.ceiling), wall: R(doc.wall) };
  if (fin(doc.up_bearing)) plan.up_bearing = norm360(doc.up_bearing);
  if (Number.isInteger(doc.floor)) plan.floor = doc.floor;
  plan.source = sourceText(doc);
  plan.provenance = provenance;
  plan.rooms = rooms;
  if (windows.length) plan.windows = windows;
  if (doors.length) plan.doors = doors;
  if (fixtures.length) plan.fixtures = fixtures;
  for (const k of PASS) if (doc.extra?.[k] != null) plan[k] = clone(doc.extra[k]);
  return plan;
}

function sourceText(doc) {
  const c = doc.cal, note = doc.note ? ` ${text(doc.note, 200)}` : '';
  if (doc.mode === 'edit') {
    const base = text(doc.source, 360) || 'Source plan';
    return text(`${base} · Edited in the browser${doc.label ? ` (${doc.label})` : ''}: ${doc.changes.length} change${doc.changes.length === 1 ? '' : 's'}; the source file is unchanged.${note}`);
  }
  if (!c || c.provisional) return text(`Traced by the renter without a scale; sizes are not measured.${note}`);
  const chk = c.check ? ` A ${fmtLen(c.check.length, doc.units)} check dimension measures ${fmtLen(c.check.measured, doc.units)} (${c.check.error_pct >= 0 ? '+' : ''}${c.check.error_pct.toFixed(1)}%).` : ' No check dimension.';
  return text(`Traced by the renter from ${c.image?.name ? `"${text(c.image.name, 80)}"` : 'an image'}${c.image?.page ? ` page ${c.image.page}` : ''}, scale from a printed ${fmtLen(c.length, doc.units)} dimension.${chk} A tracing, not a survey.${note}`);
}

/**
 * A new tracing starts at the image's bottom-left corner; on export it is shifted so the rooms start at
 * (0, 0), and the calibration origin moves with it. Edited plans keep their coordinates (furniture and
 * presets depend on them).
 */
export function toOrigin(doc) {
  if (doc.mode === 'edit' || !doc.rooms.length) return doc;
  const b = bbox(doc.rooms.flatMap((r) => r.poly)), sx = b.x0, sy = b.y0;
  if (Math.abs(sx) < 1e-9 && Math.abs(sy) < 1e-9) return doc;
  const out = mapDoc(doc, (p) => [p[0] - sx, p[1] - sy]);
  if (doc.cal) out.cal = { ...clone(doc.cal), origin: planToImg(doc.cal, [sx, sy]) };
  return out;
}

/** The `provenance.trace` block: plain JSON numbers and strings, accepted by the project validator. */
export function traceBlock(doc, date = localDate()) {
  const c = doc.cal, t = { by: 'user', tool: TRACER_TOOL, mode: doc.mode === 'edit' ? 'edit' : 'trace', date };
  const r1 = (v) => Math.round(v * 10) / 10;
  if (c && !c.provisional) {
    if (c.image?.name) t.image = text(c.image.name, 120);
    if (Number.isInteger(c.image?.page)) t.page = c.image.page;
    if (fin(c.image?.w) && fin(c.image?.h)) t.image_px = [Math.round(c.image.w), Math.round(c.image.h)];
    t.origin_px = c.origin.map(r1);
    t.scale = Math.round(c.scale * 10000) / 10000;
    t.anchors = c.anchors.map((p) => p.map(r1));
    t.length = rnd(doc.units)(c.length);
    if (c.check) t.check = { anchors: c.check.anchors.map((p) => p.map(r1)), length: rnd(doc.units)(c.check.length), measured: rnd(doc.units)(c.check.measured), error_pct: Math.round(c.check.error_pct * 100) / 100 };
    t.confidence = confidenceOf(c.check?.error_pct);
  } else if (doc.mode !== 'edit') t.confidence = 'unchecked';
  if (doc.bearing && typeof doc.bearing === 'object') {
    const b = { method: ['arrow', 'facade', 'typed'].includes(doc.bearing.method) ? doc.bearing.method : 'typed' };
    if (fin(doc.bearing.faces)) b.faces = norm360(doc.bearing.faces);
    if (doc.bearing.wall) b.wall = text(doc.bearing.wall, 60);
    t.bearing = b;
  }
  if (doc.label) t.label = text(doc.label, 60);
  if (doc.changes?.length) t.changes = doc.changes.slice(-20).map((s) => text(s, 120));
  return t;
}

// ------------------------------------------------------------------ checks before export
/** Problems worth showing before export: {level: 'error'|'warn'|'info', text}. */
export function reviewDoc(doc) {
  const out = [], u = doc.units, d = defaultsFor(u);
  if (!doc.rooms.length) out.push({ level: 'error', text: 'Trace at least one room.' });
  if (doc.mode !== 'edit' && (!doc.cal || doc.cal.provisional)) out.push({ level: 'error', text: 'Set the scale from a printed dimension before saving.' });
  const conf = confidenceOf(doc.cal?.check?.error_pct);
  if (doc.mode !== 'edit' && doc.cal && !doc.cal.provisional) {
    if (conf === 'unchecked') out.push({ level: 'info', text: 'Add a second printed dimension to check the scale.' });
    else if (conf === 'low') out.push({ level: 'warn', text: `The check dimension is ${Math.abs(doc.cal.check.error_pct).toFixed(1)}% off. Re-place the scale anchors on the dimension line ends.` });
  }
  const names = new Map();
  for (const r of doc.rooms) {
    if (selfIntersects(r.poly)) out.push({ level: 'error', text: `${r.name}: the outline crosses itself.` });
    if (roomArea(r.poly) < (d.grid * 12) ** 2) out.push({ level: 'error', text: `${r.name} has almost no area.` });
    names.set(r.name, (names.get(r.name) || 0) + 1);
  }
  for (const [n, c] of names) if (c > 1) out.push({ level: 'warn', text: `${c} rooms are called "${n}". Door swings and windows find rooms by name.` });
  for (const a of doc.rooms) for (const b of doc.rooms) {
    if (a === b) continue;
    const inside = a.poly.filter((p) => pointInPoly(p, b.poly) && b.poly.every((q, i) => segDist(p, q, b.poly[(i + 1) % b.poly.length]) > d.grid * 2)).length;
    if (inside) { out.push({ level: 'warn', text: `${a.name} overlaps ${b.name}.` }); break; }
  }
  const walls = deriveWalls(doc.rooms, { tol: d.grid * 0.6, probe: d.wall });
  for (const o of [...doc.doors.map((x) => ['Door', x]), ...doc.windows.map((x) => ['Window', x])]) {
    const m = [(o[1].a[0] + o[1].b[0]) / 2, (o[1].a[1] + o[1].b[1]) / 2], w = nearestWall(m, walls, d.wall);
    if (!w) out.push({ level: 'warn', text: `${o[0]} ${o[1].name || ''} is not on a room edge, so it will not cut a wall.`.replace('  ', ' ') });
  }
  for (const w of doc.windows) if (w.head > doc.ceiling) out.push({ level: 'error', text: 'A window head is above the ceiling.' });
  for (const w of doc.windows) if (w.head <= w.sill) out.push({ level: 'error', text: 'A window head must be above its sill.' });
  if (!fin(doc.up_bearing)) out.push({ level: 'info', text: 'Orientation unknown: sun and window bearings need the north arrow or a facade bearing.' });
  if (doc.extra?.walls?.length) out.push({ level: 'info', text: 'This plan lists its walls explicitly; moving room corners does not move those walls.' });
  return out;
}

// ------------------------------------------------------------------ history
/** Snapshot undo/redo for the tracer document. Each entry carries a label for the change log. */
export class History {
  constructor(doc, limit = 120) { this.stack = [JSON.stringify(doc)]; this.labels = ['Start']; this.i = 0; this.limit = limit; }
  get doc() { return JSON.parse(this.stack[this.i]); }
  push(doc, label = 'Edit') {
    const s = JSON.stringify(doc);
    if (s === this.stack[this.i]) return false;
    this.stack.splice(this.i + 1); this.labels.splice(this.i + 1);
    this.stack.push(s); this.labels.push(label);
    if (this.stack.length > this.limit) { this.stack.shift(); this.labels.shift(); }
    this.i = this.stack.length - 1;
    return true;
  }
  get canUndo() { return this.i > 0; }
  get canRedo() { return this.i < this.stack.length - 1; }
  undo() { if (this.canUndo) this.i--; return this.doc; }
  redo() { if (this.canRedo) this.i++; return this.doc; }
}
