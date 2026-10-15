// node --test tests/js : walking inside a plan (dashboard/js/plan/walkcore.js), shared by the studio's Walk and Unit 3D's Inside camera:
// where a person can stand, the way around the furniture and through the doors, steps that slide along walls instead of passing through,
// the nearest window to stand at looking out, and which window a click lands on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalisePlan } from '../../dashboard/js/plan/model.js';
import { validateInventory } from '../../dashboard/js/plan/inventory.js';
import { resolve } from '../../dashboard/js/plan/catalog.js';
import { applyInventory, resolveLayout } from '../../dashboard/js/plan/placement.js';
import { walkSpace, windowStands, nearestWindow, windowHit, groupOfWindow, pathLength, pointAlong, ease, EYE_IN, walkItems } from '../../dashboard/js/plan/walkcore.js';

const read = (p) => JSON.parse(fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8'));
const m = normalisePlan(read('examples/nyc-2026/plans/paramount-tower-25e.json')), inv = validateInventory(read('examples/nyc-2026/furniture.json')).inventory;
const items = applyInventory(resolveLayout({ model: m, inventory: inv, saved: null }).items, inv).map((x) => resolve(x));
const sp = walkSpace(m, items);
const DOOR = [133, 14];   // just inside the front door

test('eye height is about 1.6 m', () => { assert.ok(Math.abs(EYE_IN * 0.0254 - 1.6) < 0.01); });

test('a person can stand on open floor, not inside a bed, a desk, a counter or a wall, and not in the gap between a wall and its first inches', () => {
  assert.equal(sp.canStand(100, 150), false, 'the dining table lengthwise by the kitchen is in the way here');
  assert.equal(sp.canStand(60, 250), true, 'open living-room floor');
  assert.equal(sp.canStand(266, 218), false, 'the bed');
  assert.equal(sp.canStand(35, 313), false, 'the desk');
  assert.equal(sp.canStand(30, 40), false, 'the kitchen counter');
  assert.equal(sp.canStand(171.5, 220), false, 'the partition wall');
  assert.equal(sp.canStand(168, 300), false, 'a person is wider than that: 9 in off the wall at least');
  assert.equal(sp.canStand(150, 300), true, 'but 19 in off it is fine');
  assert.equal(sp.canStand(500, 500), false, 'outside the apartment');
  assert.equal(sp.canStand(21.75, 230), false, 'right at the TV wall');
  assert.equal(sp.canStand(60, 230), true, 'a wall TV hung 32 in up is not in the way of the floor');
});

test('the desk\'s chair is in the way too', () => {
  const desk = items.find((i) => i.id === 'desk'), extra = walkItems(items).filter((i) => i.id === 'desk#chair');
  assert.equal(extra.length, 1);
  assert.ok(extra[0].w >= 20 && extra[0].d >= 20);
  assert.equal(sp.canStand(extra[0].x, extra[0].y), false);
  assert.equal(walkItems(items.map((i) => (i.id === 'desk' ? { ...desk, set: { chair: false } } : i))).filter((i) => i.id === 'desk#chair').length, 0, 'no chair, no obstacle');
});

test('the way from the front door to the desk goes around the furniture, through no wall, in straight runs', () => {
  const route = sp.route(DOOR, [75, 315]);
  assert.ok(route && route.length >= 3, JSON.stringify(route));
  for (let i = 1; i < route.length; i++) assert.ok(sp.lineClear(route[i - 1], route[i]) || i === 1, 'each run is standable');
  const end = route[route.length - 1];
  assert.ok(Math.hypot(end[0] - 75, end[1] - 315) < 40, 'it ends at the desk');
  assert.ok(pathLength(route) < 700 && pathLength(route) > 300, `a walk of ${Math.round(pathLength(route))} in`);
  // walking along it never leaves the floor
  for (let d = 0; d <= pathLength(route); d += 6) { const p = pointAlong(route, d).at; assert.ok(sp.canStand(p[0], p[1]) || d === 0, `standable ${d}`); }
});

test('from the living room to the bedroom the route uses the doorway; there is none to a spot outside', () => {
  const route = sp.route([60, 250], [250, 170]);
  assert.ok(route);
  assert.ok(route.some((p) => p[1] < 150 && p[1] > 100), 'through the opening at the foyer, not through the partition');
  assert.equal(sp.route(DOOR, [500, 500]), null);
  assert.equal(sp.route(DOOR, [266, 218], { maxGoal: 4 }), null, 'a click inside the bed, with no floor within 4 in, goes nowhere');
});

test('a step never passes through a wall, however long it is, and slides along it', () => {
  const stop = sp.step([150, 300], 60, 0);
  assert.ok(stop[0] < 165, `stopped at ${stop[0]} before the partition`);
  const slide = sp.step([150, 300], 30, 20);
  assert.ok(slide[1] > 315 && slide[0] < 165, 'sliding along the wall');
  assert.deepEqual(sp.step([60, 250], 0, 0), [60, 250]);
  const free = sp.step([60, 250], 10, 0); assert.ok(Math.abs(free[0] - 70) < 0.01);
  // furniture is as solid as a wall
  const bump = sp.step([200, 218], 70, 0); assert.ok(bump[0] < 227, 'stopped at the foot of the bed');
});

test('the nearest window to stand at looks out, a little back from the glass, on floor a person can stand on', () => {
  const stands = windowStands(m, sp);
  assert.equal(stands.length, 2, 'the bedroom corner and the living-room bay');
  for (const s of stands) {
    assert.ok(sp.canStand(s.at[0], s.at[1]));
    const g = m.windows.filter((_, i) => s.panes.includes(i));
    const dist = Math.min(...g.map((w) => { const ex = w.b[0] - w.a[0], ey = w.b[1] - w.a[1], t = Math.max(0, Math.min(1, ((s.at[0] - w.a[0]) * ex + (s.at[1] - w.a[1]) * ey) / (ex * ex + ey * ey))); return Math.hypot(s.at[0] - (w.a[0] + ex * t), s.at[1] - (w.a[1] + ey * t)); }));
    assert.ok(dist > 9 && dist < 60, `${s.room}: ${Math.round(dist)} in from the glass`);
    assert.ok(s.dir[1] > 0.3, 'looking out, up the drawing');
  }
  const fromBed = nearestWindow(m, sp, [280, 200]), fromSofa = nearestWindow(m, sp, [60, 250]);
  assert.equal(fromBed.room, 'Bedroom'); assert.equal(fromSofa.room, 'Living room');
  assert.ok(fromSofa.route[0][0] === 60 && pathLength(fromSofa.route) < 300);
});

test('a ray through the glass is a window; one over the sill or under the head is not', () => {
  const hit = windowHit(m, [100, 340, 63], [0, 1, 0.02]);
  assert.ok(hit); assert.equal(m.windows[hit.index].room, 'Living room');
  assert.ok(groupOfWindow(m, hit.index) >= 0);
  assert.equal(windowHit(m, [100, 340, 63], [0, 1, 0.9]), null, 'above the head of the window');
  assert.equal(windowHit(m, [100, 340, 63], [0, 1, -1]), null, 'below the sill');
  assert.equal(windowHit(m, [100, 340, 63], [0, -1, 0]), null, 'looking away from it');
});

test('the glide eases in and out and covers the whole path', () => {
  assert.equal(ease(0), 0); assert.equal(ease(1), 1); assert.ok(ease(0.25) < 0.25 && ease(0.75) > 0.75);
  const p = [[0, 0], [100, 0], [100, 50]];
  assert.equal(pathLength(p), 150);
  assert.deepEqual(pointAlong(p, 100).at, [100, 0]); assert.deepEqual(pointAlong(p, 125).at, [100, 25]); assert.deepEqual(pointAlong(p, 999).at, [100, 50]);
  assert.deepEqual(pointAlong(p, 50).dir, [1, 0]);
});
