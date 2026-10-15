// node --test tests/js : the camera tour of the photo and video renderers (dashboard/js/render/tour.js, shots.js). It must start at the front door, show the living
// room and the bedroom, end at a window looking out, and never touch a wall or a piece of furniture; the motion must be even (no jumps, no snapping turns) and a
// pure function of time, so the video renderer can draw frame i whenever it likes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalisePlan, pointInPoly } from '../../dashboard/js/plan/model.js';
import { validateInventory } from '../../dashboard/js/plan/inventory.js';
import { resolve } from '../../dashboard/js/plan/catalog.js';
import { applyInventory, resolveLayout } from '../../dashboard/js/plan/placement.js';
import { walkSpace } from '../../dashboard/js/plan/walkcore.js';
import { entryPoint } from '../../dashboard/js/plan/route.js';
import { windowGroups } from '../../dashboard/js/plan/viewpoints.js';
import { planTour, roundCorners, resample, atLength, TOUR, roomsToShow } from '../../dashboard/js/render/tour.js';
import { tourSequence, daySequence, bestWindowStand } from '../../dashboard/js/render/shots.js';

const ROOT = new URL('../../', import.meta.url);
const read = (p) => JSON.parse(fs.readFileSync(new URL(p, ROOT), 'utf8'));
const model = normalisePlan(read('examples/nyc-2026/plans/paramount-tower-25e.json'));
const inv = validateInventory(read('examples/nyc-2026/furniture.json')).inventory;
const items = applyInventory(resolveLayout({ model, inventory: inv, saved: null }).items, inv).map((x) => resolve(x));
const space = walkSpace(model, items);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const turn = (a, b) => ((((b - a) % 360) + 540) % 360) - 180;
const room = (name) => model.rooms.find((r) => r.name === name);

test('the tour starts at the front door, shows the living room and the bedroom, and ends at a window looking out', () => {
  const t = planTour(model, space, { seconds: 16 });
  assert.ok(t, 'a tour');
  assert.deepEqual(t.stops.map((s) => s.kind), ['door', 'living', 'bedroom', 'window']);
  const door = entryPoint(model).door, p0 = t.pose(0);
  assert.ok(dist(p0.at, door.mid) < 30, `starts ${Math.round(dist(p0.at, door.mid))} in from the front door`);
  assert.equal(pointInPoly(t.stops[1].at, room('Living room').poly), true, 'the living-room stop is in the living room');
  assert.equal(pointInPoly(t.stops[2].at, room('Bedroom').poly), true, 'the bedroom stop is in the bedroom');
  // the pose track really goes through those rooms
  const seen = new Set(t.frames(30).map((f) => model.rooms.find((r) => pointInPoly(f.at, r.poly))?.name));
  for (const n of ['Foyer', 'Living room', 'Bedroom']) assert.ok(seen.has(n), `passes through ${n}`);
  // the end: standing back from a window of the last room, facing straight out of it
  const end = t.pose(t.seconds), g = windowGroups(model).filter((q) => q.room === t.stops[3].room).sort((a, b) => b.len - a.len)[0];
  assert.ok(g, 'a window group in the last room');
  const toGlass = Math.abs((end.at[0] - g.mid[0]) * g.normal[0] + (end.at[1] - g.mid[1]) * g.normal[1]);
  assert.ok(toGlass > 10 && toGlass < 60, `${Math.round(toGlass)} in from the glass`);
  const bearing = ((Math.atan2(g.normal[0], g.normal[1]) * 180) / Math.PI + 360) % 360;
  assert.ok(Math.abs(turn(end.yaw, bearing)) < 8, `faces out of the window (${Math.round(end.yaw)} vs ${Math.round(bearing)})`);
  assert.ok(t.stops[3].t0 > t.stops[2].t0 && t.stops[2].t0 > t.stops[1].t0 && t.stops[1].t0 > t.stops[0].t0, 'the stops come in order');
});

test('the camera never collides: every frame, at 30 and 60 fps, stands on floor a person fits on', () => {
  for (const seconds of [10, 16, 20]) {
    const t = planTour(model, space, { seconds });
    for (const fps of [30, 60]) for (const f of t.frames(fps)) assert.equal(space.canStand(f.at[0], f.at[1]), true, `${seconds} s at ${fps} fps: frame ${f.i} at ${f.at.map(Math.round)} is inside something`);
  }
});

test('the motion is even: no jumps, a sensible pace, no snapping turns, eye height steady', () => {
  const t = planTour(model, space, { seconds: 16 }), F = t.frames(30);
  let maxStep = 0, maxYaw = 0, maxAcc = 0, prevStep = 0;
  for (let i = 1; i < F.length; i++) {
    const step = dist(F[i].at, F[i - 1].at), yaw = Math.abs(turn(F[i - 1].yaw, F[i].yaw));
    maxStep = Math.max(maxStep, step); maxYaw = Math.max(maxYaw, yaw); maxAcc = Math.max(maxAcc, Math.abs(step - prevStep)); prevStep = step;
    assert.equal(F[i].h, F[0].h);
  }
  assert.ok(maxStep * 30 < 110, `peak pace ${Math.round(maxStep * 30)} in/s (about ${(maxStep * 30 * 0.0254).toFixed(1)} m/s)`);
  assert.ok(maxYaw * 30 < 75, `peak turn ${Math.round(maxYaw * 30)} deg/s`);
  assert.ok(maxAcc < 0.9, `speed changes by at most ${maxAcc.toFixed(2)} in per frame`);
  // eased: it starts and stops still
  assert.ok(dist(F[1].at, F[0].at) < 0.2 && dist(F[F.length - 1].at, F[F.length - 2].at) < 0.2);
});

test('the length is what was asked for, within 10 to 20 seconds, and the pose is a pure function of time', () => {
  for (const [ask, want] of [[5, 10], [10, 10], [15, 15], [20, 20], [60, 20]]) assert.ok(Math.abs(planTour(model, space, { seconds: ask }).seconds - want) < 0.05, `${ask} s -> ${want} s`);
  const a = planTour(model, space, { seconds: 14 }), b = planTour(model, space, { seconds: 14 });
  for (const t of [0, 0.37, 3.3, 9.99, 14]) assert.deepEqual(a.pose(t), b.pose(t));
  assert.deepEqual(a.pose(-5), a.pose(0)); assert.deepEqual(a.pose(99), a.pose(14));
  assert.equal(a.frames(30).length, 420);
});

test('the sequence the video renderer uses: frame i is the pose at i / fps, with no time of day of its own', () => {
  const s = tourSequence(model, space, { seconds: 12, fps: 30 });
  assert.equal(s.n, 360); assert.equal(s.kind, 'tour'); assert.equal(s.minuteAt(10), null);
  assert.deepEqual(s.poseAt(45), s.tour.pose(1.5));
});

test('the day from a window: one window, the time runs from first light to last light, the view sways a few degrees', () => {
  const alt = (m) => 62 * Math.sin(((m - 360) / 840) * Math.PI) - 10;   // a made-up sun: rises about 6:30, sets about 19:30
  const s = daySequence(model, space, alt, { seconds: 12, fps: 30, from: 300, to: 1285 });
  assert.equal(s.n, 360);
  const stand = bestWindowStand(model, space);
  assert.equal(stand.room, 'Living room', 'the living room’s window');
  assert.ok(space.canStand(stand.at[0], stand.at[1]));
  let prev = -Infinity;
  for (let i = 0; i < s.n; i++) { const m = s.minuteAt(i); assert.ok(m >= prev - 1e-9 && m >= 300 && m <= 1285, `minute ${m}`); prev = m; }
  assert.ok(s.minuteAt(0) < 420 && s.minuteAt(s.n - 1) > 1100, `${Math.round(s.minuteAt(0))} to ${Math.round(s.minuteAt(s.n - 1))}`);
  const yaws = Array.from({ length: s.n }, (_, i) => s.poseAt(i).yaw), spread = Math.max(...yaws.map((y) => Math.abs(turn(yaws[0], y))));
  assert.ok(spread > 1 && spread < 10, `sways ${spread.toFixed(1)} degrees`);
  for (let i = 0; i < s.n; i++) assert.deepEqual(s.poseAt(i).at, stand.at);
});

test('every example plan gets a tour that never collides (bare floors, no furniture)', () => {
  let n = 0;
  for (const f of fs.readdirSync(new URL('examples/nyc-2026/plans/', ROOT))) {
    const m = normalisePlan(read(`examples/nyc-2026/plans/${f}`)), sp = walkSpace(m, []), t = planTour(m, sp, { seconds: 15 });
    if (!t) continue;
    n++;
    assert.equal(t.stops[0].kind, 'door', f);
    for (const fr of t.frames(30)) assert.equal(sp.canStand(fr.at[0], fr.at[1]), true, `${f} frame ${fr.i}`);
    for (let i = 1; i < t.stops.length; i++) assert.ok(t.stops[i].t0 >= t.stops[i - 1].t1 - 1e-6, `${f}: stops in order`);
  }
  assert.ok(n >= 5, `${n} plans toured`);
});

test('a plan with no window ends in its last room; a plan with no bedroom shows the living room only', () => {
  const raw = read('examples/nyc-2026/plans/paramount-tower-25e.json');
  const bare = normalisePlan({ ...raw, windows: [] }), sp = walkSpace(bare, []), t = planTour(bare, sp, { seconds: 12 });
  assert.ok(t && t.stops.at(-1).kind !== 'window' && t.warnings.some((w) => /window/.test(w)));
  const studio = normalisePlan({ ...raw, rooms: raw.rooms.filter((r) => r.name !== 'Bedroom'), windows: raw.windows.filter((w) => w.room !== 'Bedroom') });
  assert.deepEqual(roomsToShow(studio).map((r) => r.role), ['living']);
  const t2 = planTour(studio, walkSpace(studio, []), { seconds: 12 });
  assert.ok(t2.stops.some((s) => s.kind === 'living') && !t2.stops.some((s) => s.kind === 'bedroom'));
  assert.equal(planTour({ rooms: [] }, space), null);
});

test('rounded corners stay on floor, and a corner that would clip stays sharp', () => {
  const L = [[0, 0], [100, 0], [100, 100]];
  const r = roundCorners(L, { canStand: () => true }, 30);
  assert.ok(r.length > 3 && dist(r[0], L[0]) < 1e-9 && dist(r.at(-1), L[2]) < 1e-9, 'smoothed, ends kept');
  assert.ok(r.every(([x, y]) => x <= 100.001 && y >= -0.001), 'cuts the inside of the corner only');
  const corridor = { canStand: (x, y) => (Math.abs(y) < 0.3 && x >= -0.3 && x <= 100.3) || (Math.abs(x - 100) < 0.3 && y >= -0.3 && y <= 100.3) };   // a corridor as wide as the line: nothing to cut into
  const sharp = roundCorners(L, corridor, 30);
  assert.deepEqual(sharp, L, 'a corner with no room to round stays a corner');
  const rs = resample(r, 1), a = atLength(rs, rs.length / 2);
  assert.ok(Math.abs(rs.s.at(-1) - rs.length) < 1e-9 && a.at.length === 2 && Math.hypot(...a.dir) > 0.99);
  assert.equal(TOUR.minSeconds, 10); assert.equal(TOUR.maxSeconds, 20);
});
