// Plan JSON normaliser for the Floor plan studio. Pure functions (no DOM, no three.js).
// Accepts schema 1 (rectangle rooms) and schema 2 (polygons, explicit walls, door swings, fixtures,
// keep-out zones, provenance, layout presets) and returns one model with every length in inches,
// in the plan frame: +x to the right of the drawing, +y to the top (toward `up_bearing`).

export const UNIT_IN = { in: 1, ft: 12, m: 39.37007874 };
const FIX_DEFAULT = {
  closet: { height: 84, reserve: 24 }, wardrobe: { height: 84, reserve: 24 }, column: { height: 0, reserve: 0 },
  ac: { height: 24, reserve: 18, est: true }, ptac: { height: 24, reserve: 18, est: true }, radiator: { height: 24, reserve: 6 },
  counter: { height: 36, reserve: 0 }, island: { height: 36, reserve: 0 }, fridge: { height: 70, reserve: 0 }, range: { height: 36, reserve: 0 },
  sink: { height: 36, reserve: 0 }, dishwasher: { height: 34, reserve: 0 }, wd: { height: 38, reserve: 0 }, tub: { height: 20, reserve: 0 },
  shower: { height: 2, reserve: 0 }, toilet: { height: 28, reserve: 0 }, vanity: { height: 34, reserve: 0 }, other: { height: 36, reserve: 0 },
};
export const FIXTURE_KINDS = Object.keys(FIX_DEFAULT);
export const ROOM_KINDS = ['living', 'bedroom', 'kitchen', 'dining', 'bath', 'hall', 'closet', 'office', 'outdoor', 'other'];

const num = (v) => typeof v === 'number' && Number.isFinite(v);
const P = (p) => Array.isArray(p) && p.length >= 2 && num(+p[0]) && num(+p[1]);

export function rectPoly(x, y, w, h) { return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]; }
export function polyArea(poly) { let a = 0; for (let i = 0; i < poly.length; i++) { const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length]; a += x1 * y2 - x2 * y1; } return a / 2; }
export function pointInPoly([x, y], poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
export function segDist([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
export function bbox(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return { x0, y0, x1, y1 };
}
// A label point well inside a polygon (L-shapes, bays): the grid point farthest from the edges.
export function labelPoint(poly) {
  const b = bbox(poly), n = 24; let best = null, bd = -1;
  for (let i = 1; i < n; i++) for (let j = 1; j < n; j++) {
    const p = [b.x0 + ((b.x1 - b.x0) * i) / n, b.y0 + ((b.y1 - b.y0) * j) / n];
    if (!pointInPoly(p, poly)) continue;
    let d = Infinity; for (let k = 0; k < poly.length; k++) d = Math.min(d, segDist(p, poly[k], poly[(k + 1) % poly.length]));
    // prefer the centre when the inner distance ties (rectangles)
    d -= Math.hypot(p[0] - (b.x0 + b.x1) / 2, p[1] - (b.y0 + b.y1) / 2) * 0.02;
    if (d > bd) { bd = d; best = p; }
  }
  return best || [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
}

// Merge collinear, overlapping wall segments (two rooms sharing an edge give one wall).
export function mergeSegments(segs, tol = 0.6) {
  const groups = new Map();
  for (const s of segs) {
    let [a, b] = [s.a, s.b];
    let ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    if (ang < -1e-9) ang += Math.PI; if (ang >= Math.PI - 1e-9) ang -= Math.PI;
    const ux = Math.cos(ang), uy = Math.sin(ang), off = a[0] * -uy + a[1] * ux;
    const key = `${Math.round(ang * 200)}|${Math.round(off / tol)}|${s.t}`;
    const s0 = a[0] * ux + a[1] * uy, s1 = b[0] * ux + b[1] * uy;
    if (!groups.has(key)) groups.set(key, { ux, uy, off, t: s.t, iv: [] });
    groups.get(key).iv.push([Math.min(s0, s1), Math.max(s0, s1)]);
  }
  const out = [];
  for (const g of groups.values()) {
    g.iv.sort((p, q) => p[0] - q[0]);
    let cur = null;
    const emit = () => cur && out.push({ a: [cur[0] * g.ux - g.off * g.uy, cur[0] * g.uy + g.off * g.ux], b: [cur[1] * g.ux - g.off * g.uy, cur[1] * g.uy + g.off * g.ux], t: g.t });
    for (const iv of g.iv) { if (cur && iv[0] <= cur[1] + tol) cur[1] = Math.max(cur[1], iv[1]); else { emit(); cur = [...iv]; } }
    emit();
  }
  return out;
}

// Cut a wall into pieces around the openings that lie on it. Each piece is {a, b, t, z0, z1, kind}.
export function wallPieces(wall, openings, ceiling) {
  const dx = wall.b[0] - wall.a[0], dy = wall.b[1] - wall.a[1], L = Math.hypot(dx, dy);
  if (L < 0.5) return [];
  const ux = dx / L, uy = dy / L, tol = Math.max(wall.t / 2 + 1.5, 3);
  const at = (s) => [wall.a[0] + ux * s, wall.a[1] + uy * s];
  const cuts = [];
  for (const o of openings) {
    const ox = o.b[0] - o.a[0], oy = o.b[1] - o.a[1], oL = Math.hypot(ox, oy);
    if (oL < 0.5 || Math.abs((ox * uy - oy * ux) / oL) > 0.05) continue; // not parallel
    const da = Math.abs((o.a[0] - wall.a[0]) * -uy + (o.a[1] - wall.a[1]) * ux), db = Math.abs((o.b[0] - wall.a[0]) * -uy + (o.b[1] - wall.a[1]) * ux);
    if (da > tol || db > tol) continue;
    const s0 = (o.a[0] - wall.a[0]) * ux + (o.a[1] - wall.a[1]) * uy, s1 = (o.b[0] - wall.a[0]) * ux + (o.b[1] - wall.a[1]) * uy;
    const lo = Math.max(0, Math.min(s0, s1)), hi = Math.min(L, Math.max(s0, s1));
    if (hi - lo > 0.5) cuts.push({ lo, hi, o });
  }
  cuts.sort((p, q) => p.lo - q.lo);
  // capA / capB: the piece ends where the wall ends, so the obstacle extends t/2 to close the corner
  const out = [], piece = (s0, s1, z0, z1, kind, o) => { if (s1 - s0 > 0.25 && z1 - z0 > 0.25) out.push({ a: at(s0), b: at(s1), t: wall.t, z0, z1, kind, capA: s0 < 0.01, capB: s1 > L - 0.01, ...(o ? { opening: o } : {}) }); };
  let pos = 0;
  for (const c of cuts) {
    if (c.lo > pos) piece(pos, c.lo, 0, ceiling, 'solid');
    const lo = Math.max(pos, c.lo);
    if (c.o.type === 'window') { piece(lo, c.hi, 0, c.o.sill, 'sill', c.o); piece(lo, c.hi, c.o.head, ceiling, 'head', c.o); }
    else if (c.o.type === 'door') piece(lo, c.hi, c.o.head, ceiling, 'head', c.o);
    pos = Math.max(pos, c.hi);
  }
  if (pos < L) piece(pos, L, 0, ceiling, 'solid');
  return out;
}

const SIDES = { '+x': [1, 0], '-x': [-1, 0], '+y': [0, 1], '-y': [0, -1] };

function cleanStr(s, max = 200) { return typeof s === 'string' ? s.slice(0, max) : s == null ? '' : String(s).slice(0, max); }

/**
 * Normalise a plan file (schema 1 or 2) into the studio model. Throws on unusable input.
 * @param {object} raw parsed plan JSON
 * @returns {object} model with lengths in inches
 */
export function normalisePlan(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Plan is not an object');
  const units = raw.units || 'ft';
  const k = UNIT_IN[units];
  if (!k) throw new Error(`Unknown units "${units}" (use ft, m or in)`);
  const L = (v, d) => (num(+v) && v !== null && v !== '' ? +v * k : d);
  const pt = (p) => [+p[0] * k, +p[1] * k];
  const ceiling = L(raw.ceiling, 108), wallT = L(raw.wall, 4.8);
  const warnings = [];

  // rooms
  const rooms = [];
  for (const [i, r] of (raw.rooms || []).entries()) {
    let poly = null;
    if (Array.isArray(r.poly) && r.poly.length >= 3 && r.poly.every(P)) poly = r.poly.map(pt);
    else if ([r.x, r.y, r.w, r.h].every((v) => num(+v)) && r.w > 0 && r.h > 0) poly = rectPoly(r.x * k, r.y * k, r.w * k, r.h * k);
    if (!poly) { warnings.push(`Room ${i + 1} has no usable rectangle or polygon`); continue; }
    if (polyArea(poly) < 0) poly.reverse();
    const area = polyArea(poly);
    rooms.push({ name: cleanStr(r.name || `Room ${i + 1}`, 60), kind: ROOM_KINDS.includes(r.kind) ? r.kind : 'other', poly, area, sqft: area / 144, label: labelPoint(poly), stated: cleanStr(r.stated || '', 60), est: !!r.est, rect: !r.poly });
  }
  if (!rooms.length) throw new Error('Plan has no rooms');

  // openings
  const seg = (o) => (P([o.x1, o.y1]) && P([o.x2, o.y2]) ? { a: pt([o.x1, o.y1]), b: pt([o.x2, o.y2]) } : P(o.a) && P(o.b) ? { a: pt(o.a), b: pt(o.b) } : null);
  const windows = (raw.windows || []).map((w) => { const s = seg(w); return s && { ...s, type: 'window', room: cleanStr(w.room, 60), note: cleanStr(w.note, 80), sill: L(w.sill, 24), head: L(w.head, 84) }; }).filter(Boolean);
  const doors = (raw.doors || []).map((d) => {
    const s = seg(d); if (!s) return null;
    const len = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]);
    return { ...s, type: 'door', head: L(d.head, 82.8), hinge: d.hinge === 'b' ? 'b' : 'a', swing: d.swing ?? null, leaf: Math.min(L(d.leaf, len), len), room: cleanStr(d.room, 60), kind: cleanStr(d.kind || '', 20), name: cleanStr(d.name || '', 60) };
  }).filter(Boolean);
  const open = (raw.open_walls || []).map((o) => { const s = seg(o); return s && { ...s, type: 'open' }; }).filter(Boolean);

  // walls: explicit, or derived from room edges
  let walls;
  if (Array.isArray(raw.walls) && raw.walls.length) {
    walls = raw.walls.map((w) => (P(w.a) && P(w.b) ? { a: pt(w.a), b: pt(w.b), t: L(w.t, wallT) } : null)).filter(Boolean);
  } else {
    const segs = [];
    for (const r of rooms) for (let i = 0; i < r.poly.length; i++) segs.push({ a: r.poly[i], b: r.poly[(i + 1) % r.poly.length], t: wallT });
    walls = mergeSegments(segs);
  }
  const openings = [...windows, ...doors, ...open];
  const pieces = walls.flatMap((w) => wallPieces(w, openings, ceiling));

  const allPts = rooms.flatMap((r) => r.poly);
  const bounds = bbox(allPts);
  const centre = [(bounds.x0 + bounds.x1) / 2, (bounds.y0 + bounds.y1) / 2];
  const roomAt = (p) => rooms.find((r) => pointInPoly(p, r.poly));

  // window facing: the outward normal points away from the window's room (or the plan centre)
  for (const w of windows) {
    const dx = w.b[0] - w.a[0], dy = w.b[1] - w.a[1], len = Math.hypot(dx, dy) || 1;
    let nx = dy / len, ny = -dx / len;
    const mid = [(w.a[0] + w.b[0]) / 2, (w.a[1] + w.b[1]) / 2];
    const room = rooms.find((r) => r.name === w.room) || roomAt([mid[0] - nx * 12, mid[1] - ny * 12]) || roomAt([mid[0] + nx * 12, mid[1] + ny * 12]);
    const inside = room ? pointInPoly([mid[0] + nx * 12, mid[1] + ny * 12], room.poly) : (mid[0] + nx - centre[0]) ** 2 + (mid[1] + ny - centre[1]) ** 2 < (mid[0] - centre[0]) ** 2 + (mid[1] - centre[1]) ** 2;
    if (inside) { nx = -nx; ny = -ny; }
    w.normal = [nx, ny]; w.len = len; w.mid = mid;
    w.bearing = (((num(raw.up_bearing) ? raw.up_bearing : 0) + (Math.atan2(nx, ny) * 180) / Math.PI) % 360 + 360) % 360;
    if (!w.room && room) w.room = room.name;
  }

  // doors: swing geometry. The leaf rotates about the hinge end into the swing side.
  for (const d of doors) {
    const dx = d.b[0] - d.a[0], dy = d.b[1] - d.a[1], len = Math.hypot(dx, dy) || 1;
    d.len = len; d.mid = [(d.a[0] + d.b[0]) / 2, (d.a[1] + d.b[1]) / 2];
    let n = null;
    if (SIDES[d.swing]) n = SIDES[d.swing];
    else if (d.swing === 'in' || (d.swing == null && d.room)) {
      const r = rooms.find((x) => x.name === d.room);
      const cand = [[dy / len, -dx / len], [-dy / len, dx / len]];
      n = r ? cand.find((c) => pointInPoly([d.mid[0] + c[0] * 18, d.mid[1] + c[1] * 18], r.poly)) || null : null;
    }
    d.swingDir = n; // null: unknown swing, or slide/pocket/none
    d.hingePt = d.hinge === 'b' ? d.b : d.a;
    d.freePt = d.hinge === 'b' ? d.a : d.b;
  }
  // merge v1 door pairs (one segment on each face of a thick wall) into doorways for the checks
  const doorways = [];
  for (const d of doors) {
    const twin = doorways.find((w) => Math.abs(w.len - d.len) < 2 && Math.hypot(w.mid[0] - d.mid[0], w.mid[1] - d.mid[1]) < wallT * 2.6 + 1);
    if (twin) { if (!twin.swingDir && d.swingDir) Object.assign(twin, d); continue; }
    doorways.push({ ...d });
  }

  // fixtures
  const fixtures = [];
  for (const [i, f] of (raw.fixtures || []).entries()) {
    const kind = FIXTURE_KINDS.includes(f.kind) ? f.kind : 'other', def = FIX_DEFAULT[kind];
    let poly = null;
    if (Array.isArray(f.poly) && f.poly.length >= 3 && f.poly.every(P)) poly = f.poly.map(pt);
    else if ([f.x, f.y, f.w, f.h].every((v) => num(+v)) && f.w > 0 && f.h > 0) poly = rectPoly(f.x * k, f.y * k, f.w * k, f.h * k);
    if (!poly) { warnings.push(`Fixture ${i + 1} has no rectangle or polygon`); continue; }
    if (polyArea(poly) < 0) poly.reverse();
    const height = kind === 'column' ? L(f.height, ceiling) : L(f.height, def.height);
    const fx = { kind, label: cleanStr(f.label || '', 60), poly, height, elev: L(f.elev, 0), est: f.est ?? !!def.est, reserve: L(f.reserve, def.reserve), doors: cleanStr(f.doors || '', 20), note: cleanStr(f.note || '', 120), id: `fx${i}` };
    if (fx.doors === 'sliding' || fx.doors === 'none' || fx.doors === 'open') fx.reserve = L(f.reserve, 0);
    fx.front = SIDES[f.front] || inferFront(poly, pieces);
    const b = bbox(poly); fx.center = [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
    fx.room = roomAt(fx.center)?.name || '';
    if (fx.reserve > 0 && fx.front) fx.reservePoly = reservePoly(poly, fx.front, fx.reserve);
    fixtures.push(fx);
  }

  const keepout = (raw.keepout || []).map((z, i) => {
    let poly = null;
    if (Array.isArray(z.poly) && z.poly.length >= 3 && z.poly.every(P)) poly = z.poly.map(pt);
    else if ([z.x, z.y, z.w, z.h].every((v) => num(+v))) poly = rectPoly(z.x * k, z.y * k, z.w * k, z.h * k);
    return poly && { name: cleanStr(z.name || `Keep-out ${i + 1}`, 60), poly, grade: z.grade === 'blocked' ? 'blocked' : 'tight' };
  }).filter(Boolean);

  const layouts = (raw.layouts || []).map((l, i) => ({
    id: cleanStr(l.id || `layout-${i + 1}`, 40), name: cleanStr(l.name || `Layout ${i + 1}`, 80), note: cleanStr(l.note || '', 240),
    items: (l.items || []).filter((it) => it && typeof it.ref === 'string' && num(+it.x) && num(+it.y)).map((it, j) => ({
      id: /^[A-Za-z0-9_-]{1,40}$/.test(it.id || '') ? it.id : `${it.ref}-${j + 1}`, ref: it.ref, x: +it.x * k, y: +it.y * k, rot: num(+it.rot) ? +it.rot : 0,
      ...(num(it.w) ? { w: it.w } : {}), ...(num(it.d) ? { d: it.d } : {}), ...(num(it.h) ? { h: it.h } : {}), ...(num(it.elev) && it.elev >= 0 ? { elev: it.elev } : {}),   // [furniture] a wall TV's own height off the floor
      ...(typeof it.product === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(it.product) ? { product: it.product } : {}),
      ...(typeof it.variant === 'string' ? { variant: it.variant } : {}), ...(typeof it.label === 'string' ? { label: cleanStr(it.label, 80) } : {}), ...(it.hidden ? { hidden: true } : {}),
    })),
  }));

  const pv = raw.provenance && typeof raw.provenance === 'object' ? raw.provenance : {};
  const provenance = {
    match: cleanStr(pv.match || '', 30), floor_band: cleanStr(pv.floor_band || '', 30), checked: cleanStr(pv.checked || '', 30),
    printed: Array.isArray(pv.printed) ? pv.printed.map((s) => cleanStr(s, 80)).slice(0, 20) : [],
    estimated: Array.isArray(pv.estimated) ? pv.estimated.map((s) => cleanStr(s, 120)).slice(0, 20) : [],
    bedroom_door_drawn: pv.bedroom_door_drawn, wd_drawn: pv.wd_drawn,
  };

  return {
    schema: raw.schema === 2 ? 2 : 1, id: cleanStr(raw.id || '', 80), title: cleanStr(raw.title || '', 80), units, k,
    ceiling, wallT, up_bearing: num(raw.up_bearing) ? raw.up_bearing : null, floor: num(raw.floor) ? raw.floor : null,
    source: cleanStr(raw.source || '', 600), provenance,
    rooms, walls, pieces, windows, doors, doorways, open, fixtures, keepout, layouts, bounds, centre, warnings,
    area: rooms.reduce((s, r) => s + r.sqft, 0),
  };
}

// The back of a fixture is the side most fully against a wall (the longer side wins a tie, so a unit
// in a corner faces the room, not the side wall); its front faces the other way.
function inferFront(poly, pieces) {
  const b = bbox(poly), low = pieces.filter((q) => q.z0 < 1);
  const sides = [
    [[0, 1], (t) => [b.x0 + (b.x1 - b.x0) * t, b.y1], b.x1 - b.x0], [[0, -1], (t) => [b.x0 + (b.x1 - b.x0) * t, b.y0], b.x1 - b.x0],
    [[1, 0], (t) => [b.x1, b.y0 + (b.y1 - b.y0) * t], b.y1 - b.y0], [[-1, 0], (t) => [b.x0, b.y0 + (b.y1 - b.y0) * t], b.y1 - b.y0],
  ];
  let best = null, bs = 0;
  for (const [n, at, len] of sides) {
    let c = 0; for (let i = 0; i < 5; i++) { const p = at(0.1 + 0.2 * i); if (low.some((q) => segDist(p, q.a, q.b) - q.t / 2 < 3)) c++; }
    const score = c * 1000 + len;
    if (c && score > bs) { bs = score; best = n; }
  }
  return best ? [-best[0] || 0, -best[1] || 0] : null;
}
function reservePoly(poly, [nx, ny], depth) {
  const b = bbox(poly);
  if (nx > 0) return rectPoly(b.x1, b.y0, depth, b.y1 - b.y0);
  if (nx < 0) return rectPoly(b.x0 - depth, b.y0, depth, b.y1 - b.y0);
  if (ny > 0) return rectPoly(b.x0, b.y1, b.x1 - b.x0, depth);
  return rectPoly(b.x0, b.y0 - depth, b.x1 - b.x0, depth);
}

// Feet-and-inches for display. Inches in, string out: 64 -> 5'4"
export function fmtIn(v, metric = false) {
  if (v == null || !Number.isFinite(v)) return '?';
  if (metric) return v * 2.54 >= 100 ? (v * 0.0254).toFixed(2) + ' m' : Math.round(v * 2.54) + ' cm';
  const s = v < 0 ? '-' : ''; let t = Math.round(Math.abs(v));
  const f = Math.floor(t / 12), i = t % 12;
  return f ? `${s}${f}'${i ? i + '"' : ''}` : `${s}${i}"`;
}
export const fmtFtIn = (v) => { const t = Math.round(v), f = Math.floor(t / 12), i = t % 12; return `${f}'${i}"`; };
