// A camera tour through a floor plan: in at the front door, a pause in the living room, a look into the bedroom, and a finish at a
// window looking out. Pure (no DOM, no three.js, no clock), in plan inches (+x right, +y up the drawing), so node tests read it and
// both 3D views (Unit 3D's Inside camera and the Floor plan studio) fly the very same tour.
//
// The way is plan/walkcore.js's: the walkable floor shrunk by a person's radius, the route around the furniture and through the doors.
// Corners are then rounded and every point of the rounded path is checked against the same floor, so the camera never touches a wall or a
// piece of furniture; a corner that cannot be rounded safely stays a corner. The pace is eased (smooth start, smooth stop at each pause),
// the heading looks ahead along the way and blends into the next pause's view before arriving, and the whole yaw track is low-pass filtered
// so it never snaps. `pose(t)` is a pure function of time: the video renderer asks for frame i at i / fps, however long the frame took.
import { pointInPoly, polyArea } from '../plan/model.js';
import { entryPoint } from '../plan/route.js';
import { windowStands, EYE_IN } from '../plan/walkcore.js';
import { windowGroups } from '../plan/viewpoints.js';

const DEG = Math.PI / 180;
export const TOUR = {
  minSeconds: 10, maxSeconds: 20, defaultSeconds: 16,
  fov: 74,              // a little wider than the walk's 70: rooms read better
  pace: 54,             // inches a second between pauses (about 1.4 m/s), before easing
  look: 96,             // inches ahead the camera looks while moving
  windowBack: 40,       // inches back from the glass at the finish (the walk's 22 puts the frame of a bay in the picture)
  hz: 120,              // the pose table's rate; frames at 30 or 60 fps read it with interpolation
  holds: { door: 0.8, living: 2.4, bedroom: 2.0, window: 2.6 },   // seconds of pause (camera still, view panning) at each stop, before scaling
  pan: { door: 0, living: 26, bedroom: 22, window: 0 },           // degrees the view sweeps across a pause
  pitch: { door: -3, living: -3, bedroom: -3, window: -1 },       // degrees above level
};

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const smooth = (t) => { const u = clamp(t, 0, 1); return u * u * (3 - 2 * u); };
const norm = (a) => ((a % 360) + 360) % 360;
const turn = (a, b) => ((((b - a) % 360) + 540) % 360) - 180;                    // signed shortest turn from a to b, degrees
const bearing = (v) => norm(Math.atan2(v[0], v[1]) / DEG);                       // plan direction -> compass-style bearing (0 = up the drawing, clockwise)
const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);

/** Rooms in the order they are shown: the living room first, then the largest bedroom; any other plan shows its biggest rooms. */
export function roomsToShow(model) {
  const rooms = (model.rooms || []).filter((r) => r.poly?.length >= 3 && !['bath', 'closet', 'outdoor'].includes(r.kind));
  const area = (r) => r.area || Math.abs(polyArea(r.poly));
  const big = (kind) => rooms.filter((r) => r.kind === kind).sort((a, b) => area(b) - area(a))[0];
  const out = [];
  const living = big('living') || big('dining') || [...rooms].sort((a, b) => area(b) - area(a))[0];
  if (living) out.push({ role: 'living', room: living });
  const bed = big('bedroom') || big('office');
  if (bed && bed !== living) out.push({ role: 'bedroom', room: bed });
  return out;
}

/**
 * Where a camera pauses in a room: roomy floor (clear of the walls and furniture) close to the way in, so the room opens up in front of it and the
 * tour does not walk to the middle of every room. `from` is the previous stop; the point is at least `gap` inches from it.
 */
export function standIn(model, space, room, from = null, gap = 70) {
  const xs = room.poly.map((p) => p[0]), ys = room.poly.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys), c = room.label || [(x0 + x1) / 2, (y0 + y1) / 2];
  const cand = [];
  for (let y = y0; y <= y1; y += 6) for (let x = x0; x <= x1; x += 6) {
    if (!pointInPoly([x, y], room.poly) || !space.canStand(x, y)) continue;
    cand.push({ p: [x, y], clear: Math.min(space.clearance ? space.clearance(x, y) : 40, 60) });
  }
  if (!cand.length) return space.snap(c[0], c[1], 60);
  const roomy = Math.min(30, Math.max(...cand.map((q) => q.clear)) * 0.8);
  let pool = cand.filter((q) => q.clear >= roomy);
  if (from) {
    const far = pool.filter((q) => dist(q.p, from) >= gap);
    if (far.length) pool = far;
    pool.sort((a, b) => dist(a.p, from) - dist(b.p, from) || b.clear - a.clear);
    return pool[0].p;
  }
  pool.sort((a, b) => dist(a.p, c) - dist(b.p, c) || b.clear - a.clear);
  return pool[0].p;
}

/** Round the corners of a polyline with quadratic curves, each checked against the walkable floor (a corner that would clip stays sharp). */
export function roundCorners(pts, space, radius = 30) {
  if (pts.length < 3) return pts.map((p) => [...p]);
  const out = [[...pts[0]]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1], b = pts[i], c = pts[i + 1], la = dist(a, b), lc = dist(b, c);
    let r = Math.min(radius, la * 0.45, lc * 0.45), done = false;
    while (r >= 3 && !done) {
      const p0 = [b[0] + ((a[0] - b[0]) / la) * r, b[1] + ((a[1] - b[1]) / la) * r], p2 = [b[0] + ((c[0] - b[0]) / lc) * r, b[1] + ((c[1] - b[1]) / lc) * r], seg = [];
      let ok = true;
      for (let k = 0; k <= 24 && ok; k++) {
        const t = k / 24, q = [(1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * b[0] + t * t * p2[0], (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * b[1] + t * t * p2[1]];
        if (!space.canStand(q[0], q[1])) ok = false; else seg.push(q);
      }
      if (ok) { out.push(...seg); done = true; } else r /= 2;
    }
    if (!done) out.push([...b]);
  }
  out.push([...pts[pts.length - 1]]);
  return out;
}

/** A point a person can stand on with a margin of an inch each way (the floor grid is 2 in: this is every cell a point 1 in off could be in). */
export const safeAt = (space, x, y) => {
  for (const dx of [0, -1, 1]) for (const dy of [0, -1, 1]) if (!space.canStand(x + dx, y + dy)) return false;
  return true;
};
/** The nearest point that is safe (within `max` inches), or null. */
function nearestSafe(space, p, max = 8) {
  if (safeAt(space, p[0], p[1])) return p;
  let best = null, bd = Infinity;
  for (let r = 0.5; r <= max; r += 0.5) for (let a = 0; a < 360; a += 15) {
    const q = [p[0] + r * Math.cos((a * Math.PI) / 180), p[1] + r * Math.sin((a * Math.PI) / 180)];
    if (r < bd && safeAt(space, q[0], q[1])) { bd = r; best = q; }
  }
  return best;
}
/**
 * Move the few points of a resampled path that are not safe (a jamb, a corner of a piece of furniture) to the nearest point that is, then smooth the path
 * over five points where the smoothed point is safe too. Deterministic in the point, so the end of one leg and the start of the next, which are the same
 * point, move to the same place.
 */
export function mend(space, pts) {
  const out = pts.map((p) => nearestSafe(space, p) || p);
  const sm = out.map((p, i) => {
    if (i === 0 || i === out.length - 1) return p;
    let x = 0, y = 0, n = 0;
    const w = Math.min(2, i, out.length - 1 - i);   // (a window that shrinks toward the ends, so the ends stay put and a straight path stays straight)
    for (let k = -w; k <= w; k++) { const q = out[i + k]; x += q[0]; y += q[1]; n++; }
    return safeAt(space, x / n, y / n) ? [x / n, y / n] : p;
  });
  return sm;
}

/** A polyline as points `step` inches apart (the first and last kept), with the running length at each. */
export function resample(pts, step = 1) {
  const P = [[...pts[0]]], S = [0];
  let s = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], L = dist(a, b), n = Math.max(1, Math.ceil(L / step));
    for (let k = 1; k <= n; k++) { const t = k / n; P.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); s += L / n; S.push(s); }
  }
  return { pts: P, s: S, length: s };
}

/** The point at running length `d` along a resampled path and the unit direction of travel there. */
export function atLength(path, d) {
  const { pts, s } = path, n = pts.length;
  if (d <= 0) return { at: pts[0], dir: dirAt(pts, 0) };
  if (d >= s[n - 1]) return { at: pts[n - 1], dir: dirAt(pts, n - 2) };
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (s[m] <= d) lo = m; else hi = m; }
  const t = (d - s[lo]) / Math.max(1e-9, s[hi] - s[lo]);
  return { at: [pts[lo][0] + (pts[hi][0] - pts[lo][0]) * t, pts[lo][1] + (pts[hi][1] - pts[lo][1]) * t], dir: dirAt(pts, lo) };
}
function dirAt(pts, i) {
  const a = pts[Math.max(0, i)], b = pts[Math.min(pts.length - 1, i + 1)], L = dist(a, b) || 1;
  return [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
}

/**
 * Plan a tour.
 * @param {object} model normalised plan (plan/model.js)
 * @param {object} space plan/walkcore.js walkSpace for the plan with its furniture
 * @param {{seconds?: number, fov?: number, eye?: number, minSeconds?: number}} [o] `minSeconds` lowers the 10 s floor (the tests record short videos)
 * @returns {null | {seconds, fov, eye, stops, path, length, timeline, pose(t), frames(fps), warnings}}
 */
export function planTour(model, space, o = {}) {
  const seconds = clamp(+o.seconds || TOUR.defaultSeconds, o.minSeconds ?? TOUR.minSeconds, TOUR.maxSeconds), fov = o.fov || TOUR.fov, eye = o.eye || EYE_IN, warnings = [];
  if (!model?.rooms?.length || !space) return null;

  // ---- the stops: the door, the rooms, the window
  const ent = entryPoint(model), startAt = space.snap(ent.at[0], ent.at[1], 40) || space.snap(model.rooms[0].label[0], model.rooms[0].label[1], 60);
  if (!startAt) return null;
  const groups = windowGroups(model);
  const stops = [{ kind: 'door', room: model.rooms.find((r) => pointInPoly(startAt, r.poly))?.name || '', label: 'Front door', at: startAt, heading: bearing(ent.dir) }];
  const roomLook = (room, from) => {   // look toward the window of this room (the light and the view), else on along the way in
    const g = groups.filter((q) => q.room === room.name).sort((a, b) => b.len - a.len)[0];
    return g ? bearing([g.mid[0] - from[0], g.mid[1] - from[1]]) : null;
  };
  let prev = startAt;
  for (const { role, room } of roomsToShow(model)) {
    const at = standIn(model, space, room, prev);
    if (!at || dist(at, prev) < 12) continue;
    stops.push({ kind: role, room: room.name, label: room.name, at, heading: roomLook(room, at) ?? bearing([at[0] - prev[0], at[1] - prev[1]]) });
    prev = at;
  }
  // the finish: the largest window of the last room shown, else the window nearest the last stop
  const stands = windowStands(model, space, { back: TOUR.windowBack });
  const lastRoom = stops[stops.length - 1].room;
  const gl = (st) => groups[st.group]?.len || 0;
  const pick = stands.filter((q) => q.room === lastRoom).sort((a, b) => gl(b) - gl(a))[0] || stands.map((q) => ({ q, d: dist(q.at, prev) })).sort((a, b) => a.d - b.d)[0]?.q;
  if (pick) stops.push({ kind: 'window', room: pick.room, label: `${pick.room || 'Window'} window`, at: pick.at, heading: bearing(pick.dir), group: pick.group, windowKind: pick.kind });
  else warnings.push('no window can be reached');

  // ---- the way: each leg routed around the furniture, its corners rounded, the legs joined at the stops
  const legs = [];
  let kept = [stops[0]];
  for (let i = 1; i < stops.length; i++) {
    const route = dist(kept[kept.length - 1].at, stops[i].at) < 1 ? [kept[kept.length - 1].at, stops[i].at] : space.route(kept[kept.length - 1].at, stops[i].at, { maxGoal: 8 });
    if (!route) { warnings.push(`no way to the ${stops[i].label.toLowerCase()}`); continue; }
    legs.push(resample(mend(space, resample(roundCorners(route, space), 1).pts), 1));
    kept.push({ ...stops[i], at: route[route.length - 1] });
  }
  if (kept.length < 2) return null;
  const length = legs.reduce((t, l) => t + l.length, 0);

  // ---- the clock: pauses at the stops (scaled to fill the length asked for at a natural pace), eased legs between
  const baseHold = kept.map((s) => TOUR.holds[s.kind] ?? 1.5), holdSum = baseHold.reduce((a, b) => a + b, 0);
  const travel0 = length / TOUR.pace;
  const scale = clamp((seconds - travel0) / holdSum, 0.45, 2.2);
  const holds = baseHold.map((h) => h * scale);
  let travel = seconds - holds.reduce((a, b) => a + b, 0);
  if (travel < 1.5) { const k = (seconds - 1.5) / holds.reduce((a, b) => a + b, 0); for (let i = 0; i < holds.length; i++) holds[i] *= k; travel = 1.5; }
  const timeline = [];
  let t = 0;
  kept.forEach((s, i) => {
    timeline.push({ type: 'hold', stop: i, t0: t, t1: t + holds[i] }); t += holds[i];
    if (i < legs.length) { const d = (travel * legs[i].length) / length; timeline.push({ type: 'leg', leg: i, from: i, to: i + 1, t0: t, t1: t + d }); t += d; }
  });
  const total = t;

  // ---- the pose table: position from the eased clock, a target heading from the look-ahead and the pauses, then a low-pass filter
  const hz = TOUR.hz, N = Math.round(total * hz) + 1, X = new Float32Array(N), Y = new Float32Array(N), YAW = new Float32Array(N), PITCH = new Float32Array(N);
  const pause = (i) => TOUR.pan[kept[i].kind] || 0;
  const pitchOf = (i) => (TOUR.pitch[kept[i].kind] ?? -2);
  const target = (time) => {
    const seg = timeline.find((q) => time >= q.t0 && time <= q.t1) || timeline[timeline.length - 1];
    if (seg.type === 'hold') {
      const u = (time - seg.t0) / Math.max(1e-6, seg.t1 - seg.t0), s = kept[seg.stop], leg = seg.stop < legs.length ? legs[seg.stop] : legs[legs.length - 1];
      const at = seg.stop < legs.length ? leg.pts[0] : leg.pts[leg.pts.length - 1];
      return { at, yaw: s.heading + pause(seg.stop) * (smooth(u) * 2 - 1), pitch: pitchOf(seg.stop) };
    }
    const u = clamp((time - seg.t0) / Math.max(1e-6, seg.t1 - seg.t0), 0, 1), leg = legs[seg.leg], d = leg.length * smooth(u), here = atLength(leg, d);
    // look as far ahead as the camera can see along the way: round a corner the look-ahead shortens to the corner, so the view is the doorway and not the wall beside it
    const at = (la) => atLength(leg, Math.min(leg.length, d + la)).at;
    let ahead = at(TOUR.look);
    if (!space.lineClear(here.at, ahead)) { let lo = 24, hi = TOUR.look; for (let k = 0; k < 6; k++) { const mid = (lo + hi) / 2; if (space.lineClear(here.at, at(mid))) lo = mid; else hi = mid; } ahead = at(lo); }
    let want = dist(ahead, here.at) > 4 ? bearing([ahead[0] - here.at[0], ahead[1] - here.at[1]]) : bearing(here.dir);
    const toStop = kept[seg.to], fromStop = kept[seg.from];
    const arrive = toStop.heading - pause(seg.to), leave = fromStop.heading + pause(seg.from);
    want += turn(want, arrive) * smooth((u - 0.8) / 0.2);        // into the next view in the last fifth of the way (earlier, the camera would face the wall it is walking past)
    want += turn(want, leave) * (1 - smooth(u / 0.2));           // and out of the last one
    return { at: here.at, yaw: want, pitch: pitchOf(seg.from) + (pitchOf(seg.to) - pitchOf(seg.from)) * smooth(u) };
  };
  const tau = 0.2, k = 1 - Math.exp(-1 / (hz * tau));
  let y1 = null, y2 = null;
  for (let i = 0; i < N; i++) {
    const g = target(i / hz);
    if (y1 == null) y1 = y2 = g.yaw;
    y1 += turn(y1, g.yaw) * k; y2 += turn(y2, y1) * k;
    X[i] = g.at[0]; Y[i] = g.at[1]; YAW[i] = norm(y2); PITCH[i] = g.pitch;
  }
  const tour = {
    seconds: total, fov, eye, stops: kept.map((s, i) => ({ ...s, t0: timeline.find((q) => q.type === 'hold' && q.stop === i).t0, t1: timeline.find((q) => q.type === 'hold' && q.stop === i).t1 })),
    path: legs, length, timeline, warnings, hz,
    /** The camera at time t seconds: plan point (inches), compass-style yaw (0 = up the drawing, clockwise, degrees), pitch (degrees above level), eye height (inches), vertical fov. */
    pose(time) {
      const f = clamp(time, 0, total) * hz, i = Math.min(N - 2, Math.floor(f)), w = f - i;
      return { at: [X[i] + (X[i + 1] - X[i]) * w, Y[i] + (Y[i + 1] - Y[i]) * w], yaw: norm(YAW[i] + turn(YAW[i], YAW[i + 1]) * w), pitch: PITCH[i] + (PITCH[i + 1] - PITCH[i]) * w, h: eye, fov };
    },
    /** Every frame of the tour at `fps`: [{i, t, ...pose}]. */
    frames(fps = 30) { const n = Math.max(1, Math.round(total * fps)); return Array.from({ length: n }, (_, i) => ({ i, t: i / fps, ...tour.pose(Math.min(total, i / fps)) })); },
  };
  return tour;
}

/** A tour as the numbers a person can read: the stops with their times, and how far and how fast it goes. */
export function describeTour(tour) {
  if (!tour) return 'No tour';
  return `${tour.stops.map((s) => `${s.label} ${s.t0.toFixed(1)}s`).join(' → ')} · ${Math.round(tour.seconds)} s · ${Math.round((tour.length * 0.0254) * 10) / 10} m`;
}
