// node --test tests/js : plan JSON normaliser (schema 1 and 2)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalisePlan, mergeSegments, wallPieces, pointInPoly, polyArea, labelPoint, fmtIn } from '../../dashboard/js/plan/model.js';

const read = (p) => JSON.parse(fs.readFileSync(new URL(p, import.meta.url), 'utf8'));
const V1 = {
  id: 'v1', units: 'ft', ceiling: 9, wall: 0.4, up_bearing: 180,
  rooms: [{ name: 'Living', kind: 'living', x: 0, y: 0, w: 10, h: 12 }, { name: 'Bed', kind: 'bedroom', x: 10, y: 0, w: 10, h: 12 }],
  windows: [{ room: 'Living', x1: 2, y1: 12, x2: 8, y2: 12, sill: 2, head: 8 }],
  doors: [{ x1: 10, y1: 2, x2: 10, y2: 5 }],
};

test('schema 1 rectangles become polygons in inches', () => {
  const m = normalisePlan(V1);
  assert.equal(m.schema, 1);
  assert.equal(m.rooms.length, 2);
  assert.deepEqual(m.rooms[0].poly[2], [120, 144]);
  assert.equal(Math.round(m.rooms[0].sqft), 120);
  assert.equal(m.ceiling, 108);
  assert.equal(Math.round(m.area), 240);
});

test('shared room edges merge into one wall', () => {
  const m = normalisePlan(V1);
  // outer rectangle (4 sides, the long ones merged across both rooms) plus the shared middle wall
  assert.equal(m.walls.length, 5);
  const mid = m.walls.find((w) => Math.abs(w.a[0] - 120) < 1e-6 && Math.abs(w.b[0] - 120) < 1e-6);
  assert.ok(mid, 'middle wall at x = 120 in');
});

test('openings cut wall pieces: windows keep a sill and a head, doors a head', () => {
  const m = normalisePlan(V1);
  const sill = m.pieces.filter((p) => p.kind === 'sill');
  assert.equal(sill.length, 1);
  assert.equal(sill[0].z1, 24);
  const heads = m.pieces.filter((p) => p.kind === 'head');
  assert.equal(heads.length, 2); // window head + door head
  const door = heads.find((p) => p.opening.type === 'door');
  assert.ok(Math.abs(door.z0 - 82.8) < 1e-6);
});

test('window facing comes from the outward normal and up_bearing', () => {
  const m = normalisePlan(V1);
  assert.equal(Math.round(m.windows[0].bearing), 180); // top wall faces up_bearing
  const m2 = normalisePlan({ ...V1, windows: [{ x1: 0, y1: 2, x2: 0, y2: 8 }] });
  assert.equal(Math.round(m2.windows[0].bearing), 90); // left wall: up 180 - 90
  assert.equal(m2.windows[0].room, 'Living');
});

test('polygon rooms, metres, explicit walls', () => {
  const m = normalisePlan({ units: 'm', rooms: [{ name: 'Bay', kind: 'living', poly: [[0, 0], [4, 0], [4, 3], [3, 4], [1, 4], [0, 3]] }], walls: [{ a: [0, 0], b: [4, 0] }] });
  assert.equal(m.rooms[0].rect, false);
  assert.ok(Math.abs(m.rooms[0].sqft - (15 * 39.37007874 ** 2) / 144) < 0.01);
  assert.equal(m.walls.length, 1);
  assert.ok(Math.abs(m.walls[0].t - 4.8) < 1e-6, 'default wall thickness 4.8 in');
  assert.ok(pointInPoly(m.rooms[0].label, m.rooms[0].poly));
});

test('door swing direction, hinge and v1 pairs merged into one doorway', () => {
  const m = normalisePlan({
    ...V1, doors: [{ x1: 10, y1: 2, x2: 10, y2: 5, hinge: 'b', swing: '+x', room: 'Bed', name: 'bedroom door' }, { x1: 10.4, y1: 2, x2: 10.4, y2: 5 }],
  });
  assert.equal(m.doors.length, 2);
  assert.equal(m.doorways.length, 1);
  const d = m.doorways[0];
  assert.deepEqual(d.swingDir, [1, 0]);
  assert.deepEqual(d.hingePt, [120, 60]);
  const inferred = normalisePlan({ ...V1, doors: [{ x1: 10, y1: 2, x2: 10, y2: 5, swing: 'in', room: 'Living' }] });
  assert.deepEqual(inferred.doorways[0].swingDir.map(Math.round), [-1, 0]);
});

test('fixtures: defaults, inferred front and reserve zone', () => {
  const m = normalisePlan({ ...V1, fixtures: [{ kind: 'ac', x: 0.2, y: 4, w: 0.8, h: 3.5 }, { kind: 'closet', x: 12, y: 0.2, w: 4, h: 2, doors: 'sliding' }, { kind: 'mystery', x: 5, y: 5, w: 1, h: 1 }] });
  const [ac, closet, other] = m.fixtures;
  assert.equal(ac.est, true);
  assert.equal(ac.reserve, 18);
  assert.deepEqual(ac.front, [1, 0]); // back against the left wall
  assert.ok(ac.reservePoly);
  assert.equal(closet.reserve, 0); // sliding doors need no swing room
  assert.equal(other.kind, 'other');
});

test('layout presets convert positions to inches and keep sizes in inches', () => {
  const m = normalisePlan({ ...V1, layouts: [{ id: 'a', name: 'A', items: [{ ref: 'queen-bed', x: 5, y: 6, rot: 90, w: 60 }, { ref: 'bad' }] }] });
  assert.equal(m.layouts[0].items.length, 1);
  assert.deepEqual([m.layouts[0].items[0].x, m.layouts[0].items[0].y, m.layouts[0].items[0].w], [60, 72, 60]);
  assert.equal(m.layouts[0].items[0].id, 'queen-bed-1');
});

test('bad input is rejected or reported', () => {
  assert.throws(() => normalisePlan(null));
  assert.throws(() => normalisePlan({ rooms: [] }), /no rooms/);
  assert.throws(() => normalisePlan({ units: 'yd', rooms: V1.rooms }), /units/);
  const m = normalisePlan({ rooms: [...V1.rooms, { name: 'Broken' }] });
  assert.equal(m.warnings.length, 1);
});

test('helpers', () => {
  assert.equal(polyArea([[0, 0], [2, 0], [2, 2], [0, 2]]), 4);
  assert.equal(mergeSegments([{ a: [0, 0], b: [5, 0], t: 4 }, { a: [8, 0], b: [3, 0], t: 4 }]).length, 1);
  assert.equal(wallPieces({ a: [0, 0], b: [100, 0], t: 4 }, [{ type: 'open', a: [40, 1], b: [60, 1] }], 96).length, 2);
  assert.deepEqual(labelPoint([[0, 0], [10, 0], [10, 10], [0, 10]]).map(Math.round), [5, 5]);
  assert.equal(fmtIn(64), `5'4"`);
  assert.equal(fmtIn(11), '11"');
});

test('the shipped example plans normalise cleanly', () => {
  for (const p of ['../../examples/nyc-2026/plans/emerald-green-1211.json', '../../dashboard/data/plans/emerald-green-1211.json']) {
    const m = normalisePlan(read(p));
    assert.equal(m.schema, 2);
    assert.deepEqual(m.warnings, []);
    assert.ok(m.layouts.length >= 2);
    assert.ok(m.fixtures.some((f) => f.kind === 'ac' && f.est));
  }
});
