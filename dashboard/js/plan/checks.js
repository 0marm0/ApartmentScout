// Fit checks for the Floor plan studio. Pure functions over the normalised plan model (inches, plan
// frame: +x right, +y toward the top of the drawing) and resolved furniture items (see catalog.resolve).
// Nothing here touches the DOM or three.js, so the rules run under node:test and can be ported to Python.
//
// Grades: 'clear' (fits with the preferred clearance), 'tight' (fits, below preferred), 'blocked'.
import { pointInPoly, segDist, bbox } from './model.js';
import { TV_FOV } from './catalog.js';

export const DEG = Math.PI / 180;
export const GRADES = ['clear', 'tight', 'blocked'];
export const worst = (a, b) => (GRADES.indexOf(a) >= GRADES.indexOf(b) ? a : b);

// ------------------------------------------------------------------ frames and footprints
/** Unit vectors of an item: r = its right (local +x), b = its back (local +y). */
export function axes(rot) { const t = rot * DEG; return { r: [Math.cos(t), -Math.sin(t)], b: [Math.sin(t), Math.cos(t)] }; }
export function toWorld(it, lx, ly) { const { r, b } = axes(it.rot); return [it.x + lx * r[0] + ly * b[0], it.y + lx * r[1] + ly * b[1]]; }
export function localRect(it, x0, y0, x1, y1) { return [toWorld(it, x0, y0), toWorld(it, x1, y0), toWorld(it, x1, y1), toWorld(it, x0, y1)]; }
export function footprint(it) { return localRect(it, -it.w / 2, -it.d / 2, it.w / 2, it.d / 2); }
export function rotRect(cx, cy, w, d, rot) { return footprint({ x: cx, y: cy, w, d, rot }); }
/**
 * The solid pieces a furniture item is made of, each with its own outline and height range: one box for most pieces, several for a model
 * that is not a box (a bed with a tall headboard unit and floating nightstands: `it.parts` from plan/bedspec.js, in the item's frame).
 * @returns {{id: string, kind: string, poly: number[][], z0: number, z1: number}[]}
 */
export function partPolys(it) {
  if (!it.parts?.length) return [{ id: 'body', kind: it.kind, poly: footprint(it), z0: it.elev, z1: it.elev + it.h }];
  return it.parts.map((p) => ({ id: p.id, kind: p.kind, poly: localRect(it, p.x0, p.y0, p.x1, p.y1), z0: it.elev + p.z0, z1: it.elev + p.z1 }));
}
/** The same outlines pulled in by `k` inches (the test for "sticks out past the rooms"). */
function insetParts(it, k = 1) {
  if (!it.parts?.length) return [footprint({ ...it, w: Math.max(1, it.w - 2 * k), d: Math.max(1, it.d - 2 * k) })];
  return it.parts.map((p) => localRect(it, p.x0 + Math.min(k, (p.x1 - p.x0) / 2 - 0.05), p.y0 + Math.min(k, (p.y1 - p.y0) / 2 - 0.05), p.x1 - Math.min(k, (p.x1 - p.x0) / 2 - 0.05), p.y1 - Math.min(k, (p.y1 - p.y0) / 2 - 0.05)));
}
/** Rectangle around a wall piece; ends that close a corner extend by half the thickness. */
export function piecePoly(p) {
  const dx = p.b[0] - p.a[0], dy = p.b[1] - p.a[1], L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, h = p.t / 2;
  const a = [p.a[0] - (p.capA ? ux * h : 0), p.a[1] - (p.capA ? uy * h : 0)], b = [p.b[0] + (p.capB ? ux * h : 0), p.b[1] + (p.capB ? uy * h : 0)];
  return [[a[0] - uy * h, a[1] + ux * h], [b[0] - uy * h, b[1] + ux * h], [b[0] + uy * h, b[1] - ux * h], [a[0] + uy * h, a[1] - ux * h]];
}

// ------------------------------------------------------------------ separating axis test
/** Penetration depth of two convex polygons along their best separating axis (0 = apart or touching). */
export function satDepth(A, B) {
  let min = Infinity;
  for (const P of [A, B]) {
    for (let i = 0; i < P.length; i++) {
      const p1 = P[i], p2 = P[(i + 1) % P.length];
      let nx = p2[1] - p1[1], ny = p1[0] - p2[0]; const L = Math.hypot(nx, ny); if (L < 1e-9) continue; nx /= L; ny /= L;
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
      for (const q of A) { const v = q[0] * nx + q[1] * ny; a0 = Math.min(a0, v); a1 = Math.max(a1, v); }
      for (const q of B) { const v = q[0] * nx + q[1] * ny; b0 = Math.min(b0, v); b1 = Math.max(b1, v); }
      const o = Math.min(a1, b1) - Math.max(a0, b0);
      if (o <= 0) return 0;
      min = Math.min(min, o);
    }
  }
  return min === Infinity ? 0 : min;
}
export const overlaps = (A, B, eps = 0.5) => satDepth(A, B) > eps;
const zHit = (a0, a1, b0, b1) => Math.min(a1, b1) - Math.max(a0, b0) > 0.25;

// ------------------------------------------------------------------ rays
/** Distance along a ray from o in direction u to the first edge of poly (0 if o is inside). */
export function rayPoly(o, u, poly, max = Infinity) {
  if (pointInPoly(o, poly)) return 0;
  let best = max;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], ex = b[0] - a[0], ey = b[1] - a[1];
    const den = u[0] * ey - u[1] * ex; if (Math.abs(den) < 1e-12) continue;
    const wx = a[0] - o[0], wy = a[1] - o[1], t = (wx * ey - wy * ex) / den, s = (wx * u[1] - wy * u[0]) / den;
    if (t >= -1e-9 && s >= -1e-9 && s <= 1 + 1e-9 && t < best) best = Math.max(0, t);
  }
  return best;
}
function rayHitsBox(o, u, b, max) {
  let t0 = 0, t1 = max;
  for (const [oi, ui, lo, hi] of [[o[0], u[0], b.x0, b.x1], [o[1], u[1], b.y0, b.y1]]) {
    if (Math.abs(ui) < 1e-12) { if (oi < lo - 0.01 || oi > hi + 0.01) return false; continue; }
    let a = (lo - oi) / ui, c = (hi - oi) / ui; if (a > c) [a, c] = [c, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, c); if (t0 > t1 + 0.01) return false;
  }
  return true;
}
function cast(o, u, obs, max) {
  let best = max, hit = null;
  for (const ob of obs) {
    if (!rayHitsBox(o, u, ob.bb, best)) continue;
    const t = rayPoly(o, u, ob.poly, best);
    if (t < best) { best = t; hit = ob; }
  }
  return { t: best, hit };
}

// ------------------------------------------------------------------ obstacles
/** Everything solid in the unit: wall pieces, fixtures and the visible furniture. */
export function obstacles(model, items) {
  const out = [];
  for (const p of model.pieces) { const poly = piecePoly(p); out.push({ type: 'wall', kind: p.kind === 'sill' ? 'sill' : 'wall', poly, bb: bbox(poly), z0: p.z0, z1: p.z1, label: p.kind === 'sill' ? 'the window sill' : 'a wall', piece: p }); }
  for (const f of model.fixtures) out.push({ type: 'fixture', kind: f.kind, poly: f.poly, bb: bbox(f.poly), z0: f.elev, z1: f.elev + (f.height || model.ceiling), label: f.label || FIX_NAMES[f.kind] || f.kind, fixture: f });
  for (const it of items) { if (it.hidden || it.flat) continue; for (const p of partPolys(it)) out.push({ type: 'item', kind: it.kind, id: it.id, part: p.id, poly: p.poly, bb: bbox(p.poly), z0: p.z0, z1: p.z1, label: it.name, item: it }); }
  return out;
}
export const FIX_NAMES = { closet: 'Closet', wardrobe: 'Built-in wardrobe', column: 'Column', ac: 'AC unit', ptac: 'AC unit', radiator: 'Radiator', counter: 'Counter', island: 'Island', fridge: 'Fridge', range: 'Range', sink: 'Sink', dishwasher: 'Dishwasher', wd: 'Washer/dryer', tub: 'Tub', shower: 'Shower', toilet: 'Toilet', vanity: 'Vanity', other: 'Fixture' };

// ------------------------------------------------------------------ zones
const SIDE_DIR = { front: [0, -1], back: [0, 1], left: [-1, 0], right: [1, 0] };
/** World polygon of a clearance zone and the face samples and direction used to measure it. */
export function zoneGeom(it, z, depth = z.preferred) {
  // `at` (the local coordinate of the face the zone starts from) and `along` (its extent along that face, [from, to]) let a model that is not a
  // box say where its own sides are: the side drawers of a bed stand 30 in in from the ends of a 94 in headboard unit
  const hw = it.w / 2, hd = it.d / 2, W = z.width ? Math.min(z.width, z.side === 'left' || z.side === 'right' ? it.d : it.w) / 2 : null;
  const { r, b } = axes(it.rot); const [sx, sy] = SIDE_DIR[z.side]; const u = [sx * r[0] + sy * b[0], sx * r[1] + sy * b[1]];
  let rect, face, span;
  if (z.side === 'front' || z.side === 'back') {
    const [a0, a1] = z.along || [-(W ?? hw), W ?? hw], y0 = z.at ?? (sy < 0 ? -hd : hd);
    rect = localRect(it, a0, y0, a1, y0 + sy * depth);
    face = (t) => toWorld(it, a0 + 2 + (a1 - a0 - 4) * t, y0); span = a1 - a0;
  } else {
    const [a0, a1] = z.along || [-(W ?? hd), W ?? hd], x0 = z.at ?? (sx < 0 ? -hw : hw);
    rect = localRect(it, x0, a0, x0 + sx * depth, a1);
    face = (t) => toWorld(it, x0, a0 + 2 + (a1 - a0 - 4) * t); span = a1 - a0;
  }
  return { poly: rect, u, face, span };
}
function quantile(arr, q) { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1) + 0.5)))]; }
/** Free depth in front of a face, its grade and the obstacle that limits it most often. */
export function measureZone(it, z, obs, opts = {}) {
  const g = zoneGeom(it, z), n = Math.max(3, Math.min(14, Math.round(g.span / 6)));
  const ignore = new Set(opts.ignoreKinds || []);
  const use = obs.filter((o) => o.id !== it.id && !(o.type === 'item' && ignore.has(o.kind)) && o.z0 < 30 && o.z1 > 0.5);
  const free = [], hits = new Map();
  for (let i = 0; i < n; i++) {
    const p = g.face(n === 1 ? 0.5 : i / (n - 1)), o = [p[0] + g.u[0] * 0.05, p[1] + g.u[1] * 0.05];
    const { t, hit } = cast(o, g.u, use, z.preferred);
    free.push(t);
    if (hit && t < z.preferred - 0.5) hits.set(hit, (hits.get(hit) || 0) + 1);
  }
  const v = z.mode === 'full' ? quantile(free, 0.1) : quantile(free, 0.5);
  const grade = v >= z.preferred - 0.5 ? 'clear' : v >= z.min - 0.5 ? 'tight' : 'blocked';
  const blocker = [...hits.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  return { ...z, free: Math.max(0, v), grade, poly: g.poly, blocker: blocker ? { type: blocker.type, id: blocker.id, label: blocker.label } : null };
}

// ------------------------------------------------------------------ doors
/** Quarter-circle swing of a door leaf as a convex polygon (hinge plus arc points). */
export function swingPoly(d, steps = 8) {
  if (!d.swingDir) return null;
  const h = d.hingePt, f = d.freePt, R = d.leaf || Math.hypot(f[0] - h[0], f[1] - h[1]);
  const a0 = Math.atan2(f[1] - h[1], f[0] - h[0]), a1 = Math.atan2(d.swingDir[1], d.swingDir[0]);
  let da = a1 - a0; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
  const pts = [h];
  for (let i = 0; i <= steps; i++) { const a = a0 + (da * i) / steps; pts.push([h[0] + R * Math.cos(a), h[1] + R * Math.sin(a)]); }
  return pts;
}
/** Keep-clear rectangle on both sides of a doorway whose swing is unknown. */
export function doorwayPoly(d, depth = 24) {
  const dx = d.b[0] - d.a[0], dy = d.b[1] - d.a[1], L = Math.hypot(dx, dy) || 1, nx = -dy / L * depth, ny = dx / L * depth;
  return [[d.a[0] + nx, d.a[1] + ny], [d.b[0] + nx, d.b[1] + ny], [d.b[0] - nx, d.b[1] - ny], [d.a[0] - nx, d.a[1] - ny]];
}
export const doorName = (d, model) => d.name || (d.kind === 'entry' ? 'entry door' : d.room ? `${d.room.toLowerCase()} door` : 'door');

// ------------------------------------------------------------------ rooms
export function roomOf(model, p) {
  const r = model.rooms.find((x) => pointInPoly(p, x.poly));
  if (r) return r.name;
  let best = null, bd = Infinity;
  for (const x of model.rooms) for (let i = 0; i < x.poly.length; i++) { const d = segDist(p, x.poly[i], x.poly[(i + 1) % x.poly.length]); if (d < bd) { bd = d; best = x.name; } }
  return best;
}
function nearRoom(model, p, tol) {
  if (model.rooms.some((x) => pointInPoly(p, x.poly))) return true;
  for (const x of model.rooms) for (let i = 0; i < x.poly.length; i++) if (segDist(p, x.poly[i], x.poly[(i + 1) % x.poly.length]) <= tol) return true;
  return false;
}

// ------------------------------------------------------------------ TV viewing
/** Horizontal field of view (degrees) a screen of width W fills at distance D. */
export const fov = (W, D) => (2 * Math.atan(W / 2 / Math.max(D, 1))) / DEG;
export function viewTag(f) { return f >= TV_FOV.close ? 'close' : f >= TV_FOV.ideal ? 'ideal' : f >= TV_FOV.workable ? 'workable' : 'too far'; }
/** Each seat in the TV's room: distance from the screen, field of view, off-axis angle and whether the seat faces it. */
export function tvSeats(model, items, tv) {
  const room = roomOf(model, [tv.x, tv.y]), { b } = axes(tv.rot), fwd = [-b[0], -b[1]];
  const scr = toWorld(tv, 0, -tv.d / 2), W = tv.screen || tv.w, out = [];
  for (const s of items) {
    if (s.hidden || s.id === tv.id || !s.seats?.length) continue;
    for (const [name, lx, ly] of s.seats) {
      const p = toWorld(s, lx, ly);
      if (roomOf(model, p) !== room) continue;
      const vx = p[0] - scr[0], vy = p[1] - scr[1], D = Math.hypot(vx, vy);
      if (D < 12) continue;
      const off = Math.acos(Math.max(-1, Math.min(1, (vx * fwd[0] + vy * fwd[1]) / D))) / DEG;
      if (off > 80) continue;
      const sb = axes(s.rot).b, sf = [-sb[0], -sb[1]];
      const face = Math.acos(Math.max(-1, Math.min(1, (-vx * sf[0] + -vy * sf[1]) / D))) / DEG;
      const f = fov(W, D), tag = viewTag(f);
      const eye = EYE[s.kind] ?? 40, cz = screenCentre(tv), up = Math.atan2(cz - eye, D) / DEG;
      out.push({ seat: name, seatId: s.id, at: p, from: scr, dist: D, fov: f, off, face, tag, eye, centre: cz, up, grade: tag === 'ideal' && off <= 35 && face <= 50 && up <= TV_UP_MAX ? 'clear' : tag === 'too far' ? 'blocked' : 'tight' });
    }
  }
  return out;
}

/** Seated eye height (in) by seat kind: sofa and chair about 40 in, propped up in bed about 34 in. */
export const EYE = { sofa: 40, chair: 40, bed: 34 };
/** Comfortable upward viewing angle to the screen centre (degrees); above it the neck tilts back. */
export const TV_UP_MAX = 15;
/** Height of a TV screen's centre above the floor (in). */
export function screenCentre(tv) {
  if (tv.mount === 'wall') return tv.elev + tv.h / 2;
  const scrW = tv.screen || tv.w; return tv.h + 3 + (scrW * 0.574) / 2;
}
/** Gallery rule: art centre at 57 in, give or take 3 in. */
export const ART_CENTRE = { ideal: 57, tol: 3, aboveMin: 6, aboveMax: 12 };

// ------------------------------------------------------------------ evaluate everything
const issue = (grade, code, text, extra = {}) => ({ grade, code, text, ...extra });

/** Issues and measured clearance zones of one item against the given obstacles (it is skipped in them). */
export function itemIssues(model, it, obs) {
  const issues = [], zones = [];
  const add = (x) => { if (!issues.some((y) => y.text === x.text)) issues.push(x); };
  const z0 = it.elev, z1 = it.elev + it.h, parts = partPolys(it);   // [bed option] a model that is not a box checks each solid part at its own height
  const hit = (poly, p, eps) => parts.some((q) => zHit(q.z0, q.z1, p.z0, p.z1) && overlaps(q.poly, poly, eps));
  // walls and sills
  let wallHit = null;
  for (const o of obs) if (o.type === 'wall' && hit(o.poly, o, 0.75)) { wallHit = o; break; }
  if (wallHit) add(issue('blocked', 'wall', wallHit.kind === 'sill' ? 'Runs into the window wall' : 'Runs into a wall', { at: wallHit.poly }));
  // fixtures, then other furniture (height-aware: a wall TV above a low dresser is fine)
  for (const o of obs) if (o.type === 'fixture' && hit(o.poly, o, 0.5)) add(issue('blocked', 'fixture', `Overlaps the ${o.label.toLowerCase()}`, { at: o.poly }));
  for (const o of obs) if (!it.flat && o.type === 'item' && o.id !== it.id && hit(o.poly, o, 0.5)) add(issue('blocked', 'overlap', `Overlaps the ${o.label.toLowerCase()}`, { other: o.id, at: o.poly }));
  // outside the rooms
  if (!wallHit && insetParts(it).some((poly) => poly.some((p) => !nearRoom(model, p, model.wallT + 0.5)))) add(issue('blocked', 'outside', 'Sticks out past the rooms on the plan'));
  // doors
  if (z0 < 80) for (const d of model.doorways) {
    const sw = swingPoly(d);
    if (sw) { if (parts.some((q) => overlaps(q.poly, sw, 1))) add(it.flat ? issue('tight', 'door', `Under the swing of the ${doorName(d, model)}: a thick rug can catch the door`, { at: sw }) : issue('blocked', 'door', `In the swing of the ${doorName(d, model)}`, { at: sw })); }
    else if (!it.flat && !['slide', 'pocket', 'none'].includes(d.swing) && parts.some((q) => overlaps(q.poly, doorwayPoly(d), 1))) add(issue('tight', 'doorway', `In front of a doorway (${doorName(d, model)})`, { at: doorwayPoly(d) }));
  }
  // keep-out zones
  for (const k of model.keepout) if (!it.flat && z0 < 80 && parts.some((q) => overlaps(q.poly, k.poly, 1))) add(issue(k.grade, 'keepout', `In the keep-out zone: ${k.name}`, { at: k.poly }));
  // rules
  if (it.rules.includes('no-window-behind')) {
    const n = 9; let hit = false;
    for (let i = 0; i < n && !hit; i++) for (const off of [2, 6, 10]) {
      const p = toWorld(it, -it.w / 2 + 3 + ((it.w - 6) * i) / (n - 1), it.d / 2 + off);
      if (model.windows.some((w) => w.sill < it.h && segDist(p, w.a, w.b) < 4)) { hit = true; break; }
    }
    if (hit) add(issue('blocked', 'headboard-window', 'Headboard against a window'));
  }
  if (it.rules.includes('solid-wall-behind') && it.mount === 'wall') {
    const n = 8; let ok = 0;
    for (let i = 0; i < n; i++) {
      const p = toWorld(it, -it.w / 2 + 2 + ((it.w - 4) * i) / (n - 1), it.d / 2 + 2);
      if (model.pieces.some((q) => q.z0 <= z0 + 0.5 && q.z1 >= z1 - 0.5 && segDist(p, q.a, q.b) <= q.t / 2 + 3.5)) ok++;
    }
    if (ok / n < 0.85) add(issue('blocked', 'tv-wall', ok ? 'Needs a solid wall behind it, not glass or an opening' : 'Not against a wall, so it cannot be wall-mounted'));
  }
  if (it.rules.includes('art-height')) {
    const c = z0 + it.h / 2, A = ART_CENTRE;
    if (Math.abs(c - A.ideal) > A.tol) add(issue('tight', 'art-height', `Centre is ${Math.round(c)} in up; hang art with its centre about ${A.ideal} in (eye level)`));
    // furniture standing under it: 6-12 in of wall between its top and the frame reads as one group
    const below = obs.filter((o) => o.type === 'item' && o.id !== it.id && o.z1 <= z0 + 0.5 && o.z1 > 12 && lateralUnder(it, o.item));
    if (below.length) {
      const top = Math.max(...below.map((o) => o.z1)), gap = z0 - top, name = below.find((o) => o.z1 === top).label.toLowerCase();
      if (gap < A.aboveMin) add(issue('tight', 'art-above', `Only ${Math.round(gap)} in above the ${name}; leave ${A.aboveMin}-${A.aboveMax} in`));
      else if (gap > 18) add(issue('tight', 'art-above', `${Math.round(gap)} in above the ${name}, so it floats; ${A.aboveMin}-${A.aboveMax} in ties them together`));
    }
  }
  if (it.rules.includes('in-window')) {
    const back = [toWorld(it, -it.w / 4, it.d / 2 + 2), toWorld(it, 0, it.d / 2 + 2), toWorld(it, it.w / 4, it.d / 2 + 2)];
    const win = model.windows.find((w) => back.every((p) => segDist(p, w.a, w.b) < 5));
    if (!win) add(issue('blocked', 'in-window', 'A window unit has to sit in a window opening'));
    else if (Math.abs(z0 - win.sill) > 3) add(issue('tight', 'in-window', `Set its height to the sill: ${Math.round(win.sill)} in (now ${Math.round(z0)} in)`));
  }
  if (it.kind === 'lamp' && it.base?.lamp === 'table') {
    const c = [it.x, it.y], under = obs.find((o) => o.type === 'item' && o.id !== it.id && Math.abs(o.z1 - z0) <= 3 && pointInPoly(c, o.poly));
    if (!under) add(issue('tight', 'lamp-surface', `Nothing ${Math.round(z0)} in tall under it: put it on a nightstand or table, or change its height`));
  }
  // clearance zones
  const groups = {};
  for (const z of it.zones) {
    const m = measureZone(it, z, obs, { ignoreKinds: it.ignore });
    zones.push(m);
    if (z.group) (groups[z.group] ||= []).push(m);
    else if (m.grade !== 'clear') add(issue(m.grade, 'zone', `${m.name}: ${Math.round(m.free)} in free, ${m.grade === 'tight' ? `${m.preferred} preferred` : `needs ${m.min}`}${m.blocker ? ` (${m.blocker.label.toLowerCase()})` : ''}`, { zone: m }));
  }
  for (const g of Object.values(groups)) {
    const best = g.reduce((a, b) => (GRADES.indexOf(a.grade) <= GRADES.indexOf(b.grade) ? a : b));
    if (best.grade !== 'clear') add(issue(best.grade, 'zone', best.grade === 'blocked' ? `No side with ${best.min} in free to get in (best ${Math.round(best.free)} in)` : `Best side has ${Math.round(best.free)} in free, ${best.preferred} preferred`, { zone: best }));
  }
  return { issues, zones };
}

/**
 * Grade every visible item and fixture clearance.
 * @param {object} model normalised plan
 * @param {object[]} items resolved items (catalog.resolve)
 * @returns {{items: Object<string, object>, fixtures: object[], tv: object[], counts: object}}
 */
export function evaluate(model, items) {
  const vis = items.filter((it) => !it.hidden);
  const obs = obstacles(model, vis);
  const res = {};
  for (const it of vis) res[it.id] = { id: it.id, name: it.name, room: roomOf(model, [it.x, it.y]), ...itemIssues(model, it, obs), state: 'clear' };
  const add = (id, x) => { const r = res[id]; if (!r) return; if (!r.issues.some((y) => y.text === x.text)) r.issues.push(x); };

  // fixture clearances (AC fronts, closet doors): blame the furniture standing in them
  const fixtures = [];
  for (const f of model.fixtures) {
    if (!f.reservePoly || !f.front) continue;
    const pseudo = fixtureAsItem(f);
    const z = { side: 'front', name: `${f.label || FIX_NAMES[f.kind]} front`, min: Math.round(f.reserve * (f.kind === 'ac' || f.kind === 'ptac' ? 2 / 3 : 0.75)), preferred: f.reserve, mode: 'full' };
    const m = measureZone(pseudo, z, obs.filter((o) => o.type === 'item'), {});
    const blockers = vis.filter((it) => partPolys(it).some((q) => overlaps(q.poly, m.poly, 0.5) && q.z0 < f.elev + f.height + 12)).map((it) => it.id);
    fixtures.push({ fixture: f, ...m, blockers });
    if (m.grade !== 'clear') for (const id of blockers) add(id, issue(m.grade, 'fixture-zone', `In the ${f.reserve} in clearance in front of the ${(f.label || FIX_NAMES[f.kind]).toLowerCase()}${f.est ? ' (estimated)' : ''}`, { at: m.poly }));
  }

  // TVs
  const tv = vis.filter((it) => it.kind === 'tv').map((t) => ({ id: t.id, name: t.name, seats: tvSeats(model, vis, t) }));
  for (const t of tv) {
    if (!t.seats.length) { add(t.id, issue('tight', 'tv-seat', 'No seat faces it in this room')); continue; }
    const best = t.seats.reduce((a, b) => (GRADES.indexOf(a.grade) <= GRADES.indexOf(b.grade) ? a : b));
    if (best.grade !== 'clear') add(t.id, issue('tight', 'tv-seat', `Best seat (${best.seat.toLowerCase()}) is ${(best.dist / 12).toFixed(1)} ft away, ${best.tag}${best.off > 35 ? `, ${Math.round(best.off)}° off-axis` : ''}${best.up > TV_UP_MAX ? `, screen centre ${Math.round(best.up)}° above eye level` : ''}`));
    const high = t.seats.filter((x) => x.up > TV_UP_MAX + 10);
    if (high.length && high.length === t.seats.length) add(t.id, issue('tight', 'tv-height', `Mounted high: its centre is ${Math.round(high[0].centre)} in up, ${Math.round(high[0].up)}° above a seated eye (${high[0].eye} in) from the ${high[0].seat.toLowerCase()}; ${TV_UP_MAX}° or less is comfortable`));
  }

  const counts = { clear: 0, tight: 0, blocked: 0 };
  for (const r of Object.values(res)) { r.state = r.issues.reduce((a, x) => worst(a, x.grade), 'clear'); counts[r.state]++; }
  return { items: res, fixtures, tv, counts };
}

/** True when furniture `o` stands in front of wall-hung item `it` (within 14 in of its wall, overlapping along it). */
export function lateralUnder(it, o) {
  const { r, b } = axes(it.rot), fp = footprint(o);
  const along = fp.map((p) => (p[0] - it.x) * r[0] + (p[1] - it.y) * r[1]), out = fp.map((p) => -((p[0] - it.x) * b[0] + (p[1] - it.y) * b[1]));
  const a0 = Math.min(...along), a1 = Math.max(...along), o0 = Math.min(...out);
  return a1 > -it.w / 2 + 2 && a0 < it.w / 2 - 2 && o0 < 14 + it.d / 2 && Math.max(...out) > -it.d;
}

/** A fixture as a pseudo-item so its front clearance can be measured like furniture. */
export function fixtureAsItem(f) {
  const b = bbox(f.poly), [nx, ny] = f.front, rot = Math.round(((Math.atan2(-nx, -ny) / DEG) + 360) % 360);
  const along = Math.abs(nx) > 0 ? b.y1 - b.y0 : b.x1 - b.x0, deep = Math.abs(nx) > 0 ? b.x1 - b.x0 : b.y1 - b.y0;
  return { id: f.id, x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2, rot, w: along, d: deep, h: f.height, elev: f.elev, kind: f.kind };
}

// ------------------------------------------------------------------ live dimension lines
/** Free distance from each side of an item to the nearest wall, fixture or piece. */
export function gapRays(model, items, id, max = 240) {
  const it = items.find((x) => x.id === id); if (!it || it.hidden) return [];
  const obs = obstacles(model, items.filter((x) => !x.hidden)).filter((o) => o.id !== it.id && zHit(it.elev, it.elev + Math.max(it.h, 1), o.z0, o.z1) && !(o.type === 'item' && it.ignore?.includes(o.kind)));
  const out = [];
  for (const side of ['front', 'back', 'left', 'right']) {
    const g = zoneGeom(it, { side, preferred: max }), n = Math.max(3, Math.min(12, Math.round(g.span / 5)));
    let best = { t: Infinity };
    for (let i = 0; i < n; i++) {
      const p = g.face(i / (n - 1)), { t, hit } = cast([p[0] + g.u[0] * 0.05, p[1] + g.u[1] * 0.05], g.u, obs, max);
      if (t < best.t) best = { t, from: p, hit };
    }
    if (best.t < max) out.push({ side, d: best.t, from: best.from, to: [best.from[0] + g.u[0] * best.t, best.from[1] + g.u[1] * best.t], u: g.u, label: best.hit?.label });
  }
  return out;
}

// ------------------------------------------------------------------ auto-place
/**
 * Search a room for a spot where the item fits: back to a wall, clearances respected, facing the TV
 * or seating, without spoiling the rest of the layout. Returns {x, y, rot, grade} or null.
 */
export function findSpot(model, items, id, roomName, step = 6, only = null) {
  const it = items.find((x) => x.id === id); if (!it) return null;
  const room = model.rooms.find((r) => r.name === roomName) || model.rooms.find((r) => pointInPoly([it.x, it.y], r.poly)) || model.rooms[0];
  const b = bbox(room.poly), others = items.filter((x) => x.id !== id && !x.hidden), obs = obstacles(model, others), solid = obs.filter((o) => o.type !== 'item');
  const lp = room.label, seen = new Set(), cands = [];
  const rots = only || (it.kind === 'table' && it.w === it.d ? [0] : [0, 90, 180, 270]);   // `only`: just these turns (the bed report asks for another wall)
  const partner = it.kind === 'tv' ? others.filter((o) => o.seats?.length && pointInPoly([o.x, o.y], room.poly)) : it.seats?.length ? others.filter((o) => o.kind === 'tv' && pointInPoly([o.x, o.y], room.poly)) : [];
  for (const rot of rots) for (let x = b.x0 + 2; x <= b.x1 - 2; x += step) for (let y = b.y0 + 2; y <= b.y1 - 2; y += step) {
    const c = { ...it, x, y, rot };
    if (!footprint(c).every((p) => pointInPoly(p, room.poly))) continue;
    // slide flush to the wall behind (tables stay where they are)
    let gap = 60;
    if (it.kind !== 'table') {
      const back = zoneGeom(c, { side: 'back', preferred: 60 });
      for (let i = 0; i < 3; i++) gap = Math.min(gap, cast(back.face(i / 2), back.u, solid, 60).t);
      if (gap < 60 && gap > 0.25) { const s2 = gap - 0.25; c.x += back.u[0] * s2; c.y += back.u[1] * s2; gap = 0.25; }
    }
    const key = `${Math.round(c.x)}|${Math.round(c.y)}|${rot}`;
    if (seen.has(key)) continue; seen.add(key);
    const own = itemIssues(model, c, obs);
    if (own.issues.some((x) => x.grade === 'blocked')) continue;
    let score = own.issues.length * 400 + (it.kind === 'table' ? 0 : gap * 5) + Math.hypot(c.x - lp[0], c.y - lp[1]) * 0.12;
    if (partner.length) {
      const p = partner[0], v = [p.x - c.x, p.y - c.y], L = Math.hypot(...v) || 1, f = axes(rot).b;
      const ang = Math.acos(Math.max(-1, Math.min(1, -(v[0] * f[0] + v[1] * f[1]) / L))) / DEG;
      score += ang > 40 ? 300 : ang * 2;
      if (it.kind === 'tv') score += Math.abs(L - (it.screen || it.w) / 2 / Math.tan(17 * DEG)) * 1.2;
    }
    cands.push({ x: c.x, y: c.y, rot, score });
  }
  if (!cands.length) return null;
  cands.sort((a, b2) => a.score - b2.score);
  const base = penalty(evaluate(model, others));
  let best = null;
  for (const c of cands.slice(0, 24)) {
    const all = evaluate(model, [...others, { ...it, x: c.x, y: c.y, rot: c.rot }]);
    const s2 = c.score + Math.max(0, penalty(all) - base - (all.items[id]?.issues.length || 0)) * 600;
    if (!best || s2 < best.s) best = { ...c, s: s2, grade: all.items[id]?.state || 'clear' };
  }
  return best && { x: best.x, y: best.y, rot: best.rot, grade: best.grade };
}
const penalty = (ev) => Object.values(ev.items).reduce((n, r) => n + r.issues.reduce((m, x) => m + (x.grade === 'blocked' ? 3 : 1), 0), 0);
