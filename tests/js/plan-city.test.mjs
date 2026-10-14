// The floor plan placed on its site (dashboard/js/plan/city.js): windows map onto the real facade, each window
// gets its own skyline, and only the window with a tall neighbour in front of it loses its sun.
import test from 'node:test';
import assert from 'node:assert/strict';
const { placePlan, windowSkylines, windowBlocked, windowMinutes, planFrame } = await import(new URL('../../dashboard/js/plan/city.js', import.meta.url));
const { normalisePlan } = await import(new URL('../../dashboard/js/plan/model.js', import.meta.url));

// target: 40 m wide, 20 m deep, south facade along y = 0 (faces 180°); window placed mid-facade
const target = [60, 0, 0, [-20, 0, -20, 20, 20, 20, 20, 0]];
// a 90 m tower 12 m south of the east half only (x 2..20)
const tower = [90, 0, 0, [2, -40, 20, -40, 20, -12, 2, -12]];
const site = { version: 2, target: 0, b: [target, tower], faces: [], floor_height_m: 3, window: { face: null, t: 0.5 } };
// plan: two rooms side by side, both windows on the facade (top of the drawing faces south)
const plan = normalisePlan({
  units: 'm', up_bearing: 180, floor: 4, ceiling: 2.7, wall: 0.2,
  rooms: [{ name: 'West room', kind: 'bedroom', x: 0, y: 0, w: 6, h: 5 }, { name: 'East room', kind: 'living', x: 6, y: 0, w: 6, h: 5 }],
  windows: [{ room: 'West room', x1: 1, y1: 5, x2: 5, y2: 5 }, { room: 'East room', x1: 7, y1: 5, x2: 11, y2: 5 }],
});

test('the plan frame sits on the window wall, centred on the facade windows', () => {
  const fr = planFrame(plan);
  assert.equal(Math.round(fr.xc), Math.round(6 / 0.0254));
  assert.equal(Math.round(fr.yw), Math.round(5 / 0.0254));
});

test('windows map onto the facade with the plan turned to the facade bearing', () => {
  const ctx = placePlan(site, plan, 4);
  assert.ok(ctx);
  assert.equal(Math.round(ctx.az), 180);
  const sk = windowSkylines(ctx, plan);
  // looking out south your right hand points west, so plan +x (the East room) maps to smaller x (west)
  assert.ok(sk[0].x > sk[1].x, `west room window x ${sk[0].x} should be east of the east room's when the plan faces south`);
  for (const w of sk) { assert.ok(w.y < 0 && w.y > -1, 'just outside the south facade'); assert.equal(Math.round(w.z * 10) / 10, 9 + 1.6); }
});

test('only the window with the tower in front loses its sun', () => {
  const ctx = placePlan(site, plan, 4), sk = windowSkylines(ctx, plan);
  // plan +x runs west when the plan faces south, so the "East room" (plan x 6..12) is in the west half
  const behindTower = sk.findIndex((w) => w.x > 2), clear = 1 - behindTower;
  const noon = { az: 180, alt: 30 };
  assert.equal(windowBlocked(sk, behindTower, noon), true);
  assert.equal(windowBlocked(sk, clear, noon), false);
  const mins = windowMinutes(sk, plan, 2026, 11, 15, 40.75, -73.99, 'America/New_York');
  assert.ok(mins[clear] > mins[behindTower], `the shaded window gets fewer hours: ${mins}`);
});

test('a site without an open facade gives no placement', () => {
  assert.equal(placePlan({ ...site, faces: [0, 1, 2, 3].map((i) => ({ i, shared: true })) }, plan, 4), null);
});
