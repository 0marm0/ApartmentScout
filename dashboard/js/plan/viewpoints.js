// Where to stand to look out: the windows of a plan grouped by room (a bay or a corner is one view, not three
// panes), a standing viewpoint for each, and a seated one for the sofa, the bed and the desk. Pure geometry in plan
// inches (+x right, +y toward the top of the drawing), no DOM and no three.js, shared by the Floor plan studio and Unit 3D's
// Inside camera, so both offer the same rooms and look the same way.
import { pointInPoly } from './model.js';
import { toWorld, piecePoly, satDepth } from './checks.js';

export const EYE_STAND = 63;                         // standing eye height, inches (about 1.6 m)
export const EYE_SEAT = { sofa: 40, chair: 40, bed: 34, desk: 46 };
const DEG = Math.PI / 180;
const CHAIN = 4;                                     // panes whose ends are within 4 in belong to one window

const unit = (v) => { const L = Math.hypot(v[0], v[1]) || 1; return [v[0] / L, v[1] / L]; };
/** Compass-style angle of a direction in the plan (0 = up the drawing, clockwise), degrees. */
export const dirAngle = (d) => ((Math.atan2(d[0], d[1]) / DEG) + 360) % 360;
/** Smallest signed turn from angle a to angle b, degrees. */
export const turnBetween = (a, b) => ((((b - a) % 360) + 540) % 360) - 180;

/**
 * Windows grouped into what a person sees as one window: panes of a room that join end to end.
 * kind: 'flat' (one pane, or parallel ones), 'bay' (the middle pane is square to the facade, the sides angle in)
 * or 'corner' (the glass turns a corner or chamfers one). `mid` is the middle of the run along the glass,
 * `normal` the average outward direction, `spread` the angle between the outermost panes' normals.
 */
export function windowGroups(model) {
  const out = [], byRoom = new Map();
  model.windows.forEach((w, i) => { if (!w.normal) return; const k = w.room || ''; if (!byRoom.has(k)) byRoom.set(k, []); byRoom.get(k).push(i); });
  for (const [room, idx] of byRoom) {
    const left = new Set(idx), near = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]) <= CHAIN;
    while (left.size) {
      const first = left.values().next().value; left.delete(first);
      const chain = [first];
      for (let grew = true; grew;) {
        grew = false;
        for (const j of [...left]) {
          const w = model.windows[j], head = model.windows[chain[0]], tail = model.windows[chain[chain.length - 1]];
          if (near(w.b, head.a) || near(w.a, head.a)) { chain.unshift(j); left.delete(j); grew = true; }
          else if (near(w.a, tail.b) || near(w.b, tail.b)) { chain.push(j); left.delete(j); grew = true; }
        }
      }
      const panes = chain.map((j) => model.windows[j]), total = panes.reduce((s, w) => s + w.len, 0);
      const n = unit(panes.reduce((a, w) => [a[0] + w.normal[0] * w.len, a[1] + w.normal[1] * w.len], [0, 0]));
      const mid = panes.reduce((a, w) => [a[0] + w.mid[0] * w.len / total, a[1] + w.mid[1] * w.len / total], [0, 0]);
      const angs = panes.map((w) => dirAngle(w.normal)), spread = Math.max(...angs.map((a) => Math.abs(turnBetween(dirAngle(n), a)))) * (panes.length > 1 ? 2 : 0);
      const longest = panes.reduce((a, w) => (w.len > a.len ? w : a), panes[0]);
      let kind = 'flat';
      if (panes.length > 1 && spread >= 40) kind = Math.abs(turnBetween(dirAngle(n), dirAngle(longest.normal))) < 12 && panes.length >= 3 ? 'bay' : 'corner';
      out.push({ room, panes: chain, kind, mid, normal: n, len: total, spread: Math.round(spread), sill: Math.min(...panes.map((w) => w.sill)), head: Math.max(...panes.map((w) => w.head)) });
    }
  }
  return out;
}

const ROOM_ORDER = ['living', 'dining', 'bedroom', 'kitchen', 'office', 'hall', 'other'];
const roomRank = (model, name) => { const r = model.rooms.find((q) => q.name === name); const i = ROOM_ORDER.indexOf(r?.kind); return i < 0 ? ROOM_ORDER.length : i; };

/** A standing point back from the glass along `n`, inside the room and clear of the walls. */
function standBack(model, room, mid, n, backs) {
  const r = model.rooms.find((q) => q.name === room);
  for (const back of backs) {
    const p = [mid[0] - n[0] * back, mid[1] - n[1] * back];
    if (r && pointInPoly(p, r.poly) && (back <= 30 || edgeClear(r.poly, p, 14))) return { p, back };
  }
  return null;
}
function edgeClear(poly, p, d) {
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], ex = b[0] - a[0], ey = b[1] - a[1], L2 = ex * ex + ey * ey || 1;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ey) / L2));
    if (Math.hypot(p[0] - (a[0] + ex * t), p[1] - (a[1] + ey * t)) < d) return false;
  }
  return true;
}

/**
 * "Stand at the window": one viewpoint per window group (the room's name), plus a close, wide one for each bay and corner.
 * @returns {{key:string,label:string,room:string,kind:'room'|'bay'|'corner',at:number[],dir:number[],h:number,pitch:number,fov:number,group:number}[]}
 */
export function lookOutViews(model) {
  const groups = windowGroups(model), views = [];
  const multi = (kind) => groups.filter((g) => g.kind === kind).length > 1;
  groups.forEach((g, gi) => {
    const wide = g.kind !== 'flat';
    const far = standBack(model, g.room, g.mid, g.normal, wide ? [96, 84, 72, 60, 48, 36, 24] : [84, 72, 60, 48, 36, 24]);
    if (!far) return;
    views.push({ key: `room:${g.room}:${gi}`, label: g.room || 'Window', room: g.room, kind: 'room', at: far.p, dir: g.normal, h: EYE_STAND, pitch: -0.02, fov: wide ? 78 : 70, group: gi });
    if (wide) {
      const near = standBack(model, g.room, g.mid, g.normal, [30, 24, 18]);
      if (near) views.push({ key: `${g.kind}:${g.room}:${gi}`, label: multi(g.kind) ? `${g.room.split(' ')[0]} ${g.kind}` : g.kind === 'bay' ? 'Bay' : 'Corner', room: g.room, kind: g.kind, at: near.p, dir: g.normal, h: EYE_STAND, pitch: 0, fov: 100, group: gi });
    }
  });
  const rank = (v) => roomRank(model, v.room) * 10 + (v.kind === 'room' ? 0 : 1);
  const sorted = views.map((v, i) => [v, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([v]) => v);
  // two windows of one room (a corner room) get the way they face, so no two chips share a name
  for (const v of sorted) if (sorted.some((o) => o !== v && o.label === v.label)) v.label = `${v.label}, ${facingWord(model, v.dir)}`;
  return sorted;
}

const POINTS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
/** How a direction in the plan faces: a compass point when the plan's bearing is known, else which side of the drawing. */
export function facingWord(model, d) {
  if (model.up_bearing != null) return POINTS[Math.round((((model.up_bearing + dirAngle(d)) % 360) + 360) % 360 / 45) % 8];
  const a = dirAngle(d); return ['top', 'top right', 'right', 'bottom right', 'bottom', 'bottom left', 'left', 'top left'][Math.round(a / 45) % 8] + ' side';
}

/** The first visible item of a kind (or any of several kinds), or null. */
const firstOf = (R, ...kinds) => R.find((x) => !x.hidden && kinds.includes(x.kind)) || null;

/** The point and height a person sits at for each kind of piece. */
export function seatPoint(it) {
  if (it.kind === 'desk') return { at: toWorld(it, 0, -(it.d / 2 + 14)), h: EYE_SEAT.desk, facing: toWorld(it, 0, 0) };
  const s = it.seats?.[0];
  return { at: s ? toWorld(it, s[1], s[2]) : [it.x, it.y], h: it.kind === 'bed' ? EYE_SEAT.bed : EYE_SEAT.sofa, facing: null };
}

/**
 * "From the sofa / bed / desk": the seat's eye looking out of the window group in the same room (else the nearest one).
 * `R` are the resolved items. Seats with no window to look at are left out.
 */
export function seatViews(model, R) {
  const groups = windowGroups(model); if (!groups.length) return [];
  const out = [];
  const make = (key, label, it) => {
    if (!it) return;
    const { at, h } = seatPoint(it), room = model.rooms.find((r) => pointInPoly(at, r.poly))?.name || '';
    const same = groups.map((g, i) => [g, i]).filter(([g]) => g.room === room);
    const pool = same.length ? same : groups.map((g, i) => [g, i]);
    const [g, gi] = pool.reduce((a, b) => (Math.hypot(b[0].mid[0] - at[0], b[0].mid[1] - at[1]) < Math.hypot(a[0].mid[0] - at[0], a[0].mid[1] - at[1]) ? b : a));
    const dir = unit([g.mid[0] - at[0], g.mid[1] - at[1]]);
    out.push({ key: `seat:${key}`, label, room, kind: 'seat', seat: key, id: it.id, at, dir, h, pitch: -0.02, fov: 74, group: gi });
  };
  make('sofa', 'Sofa', firstOf(R, 'sofa', 'chair'));
  make('bed', 'Bed', firstOf(R, 'bed'));
  make('desk', 'Desk', firstOf(R, 'desk'));
  return out;
}

/** True when nothing solid and tall stands between two points at eye height (walls only, ignoring window panes and doors). */
export function clearSight(model, a, b) {
  const ab = [b[0] - a[0], b[1] - a[1]], L = Math.hypot(ab[0], ab[1]) || 1, u = [ab[0] / L, ab[1] / L], nrm = [-u[1], u[0]];
  // a thin rectangle along the sight line; solid wall pieces that reach eye height block it
  const rect = [[a[0] + nrm[0] * 0.5, a[1] + nrm[1] * 0.5], [b[0] + nrm[0] * 0.5, b[1] + nrm[1] * 0.5], [b[0] - nrm[0] * 0.5, b[1] - nrm[1] * 0.5], [a[0] - nrm[0] * 0.5, a[1] - nrm[1] * 0.5]];
  for (const p of model.pieces) if (p.kind === 'solid' && p.z1 > EYE_SEAT.bed && satDepth(rect, piecePoly(p)) > 0.2) return false;
  return true;
}

/** Everything the camera chips offer, in one list: windows by room (with bays and corners), then the seats. */
export function allViews(model, R = []) { return [...lookOutViews(model), ...seatViews(model, R)]; }

/** Yaw (radians, 0 = looking up the drawing, clockwise) and the unit eye direction for a viewpoint's `dir`. */
export const yawOf = (v) => Math.atan2(v.dir[0], v.dir[1]);
/** The viewpoint at `step` places from `current` in `views` (wraps around); `current` null starts at the first or last. */
export function stepView(views, current, step) {
  if (!views.length) return null;
  const i = views.findIndex((v) => v.key === current);
  return views[(i < 0 ? (step > 0 ? 0 : views.length - 1) : (i + step + views.length) % views.length)];
}
