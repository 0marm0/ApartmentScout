import { test } from 'node:test';
import assert from 'node:assert/strict';
import { heightClass, HCLASS, HCLASS_LABELS, sectorOf, sectorHeights, pickLabels, scaleBuilding, applyEdits, panoramaSlices, stripX, storeys } from '../../dashboard/js/unit/heights.js';
import { prepBuildings, horizonDir, rayBlock } from '../../dashboard/js/sun.js';

test('height classes cover every height with one label each', () => {
  assert.equal(HCLASS_LABELS.length, HCLASS.length + 1);
  assert.equal(heightClass(0), 0);
  assert.equal(heightClass(11.9), 0);
  assert.equal(heightClass(12), 1);
  assert.equal(heightClass(77), 3);
  assert.equal(heightClass(400), HCLASS.length);
  assert.equal(heightClass(NaN), 0);
  assert.equal(storeys(77), 24);
});

test('sectors are centred on the compass points', () => {
  assert.equal(sectorOf(0), 0); assert.equal(sectorOf(359), 0); assert.equal(sectorOf(22.4), 0); assert.equal(sectorOf(22.6), 1);
  assert.equal(sectorOf(180), 4); assert.equal(sectorOf(209), 5); assert.equal(sectorOf(-90), 6);
});

test('sector summary: tallest, nearest, median, roofs above the eyes, radius and proposed filter', () => {
  const rows = [
    { name: 'A', h: 50, dist: 20, brg: 200 }, { name: 'B', h: 87, dist: 60, brg: 215 }, { name: 'C', h: 30, dist: 40, brg: 190 },
    { name: 'far', h: 300, dist: 400, brg: 200 }, { name: 'P', h: 120, dist: 30, brg: 205, future: true }, { name: 'N', h: 10, dist: 5, brg: 10 },
  ];
  const s = sectorHeights(rows, { eye: 37, radius: 150 });
  assert.equal(s.length, 8);
  const sw = s[sectorOf(209)], ss = s[sectorOf(190)];
  assert.equal(ss.dir, 'S');
  assert.equal(ss.count, 2); assert.equal(ss.tallest.name, 'A'); assert.equal(ss.nearest.name, 'A'); assert.equal(ss.median, 40); assert.equal(ss.above, 1);
  assert.equal(sw.count, 1); assert.equal(sw.tallest.name, 'B');
  assert.equal(s[0].count, 1); assert.equal(s[0].above, 0);
  const withFut = sectorHeights(rows, { eye: 37, future: true });
  assert.equal(withFut[sectorOf(205)].tallest.name, 'P');
  assert.equal(s[2].tallest, null); assert.equal(s[2].median, null);
});

test('labels: nearest first, then tallest, never two within the separation', () => {
  const rows = [
    { id: 1, x: 10, y: 0, h: 20, dist: 10 }, { id: 2, x: 12, y: 0, h: 25, dist: 12 }, { id: 3, x: 200, y: 0, h: 250, dist: 200 },
    { id: 4, x: 0, y: 100, h: 90, dist: 100 }, { id: 5, x: 500, y: 0, h: 400, dist: 500 },
  ];
  const l = pickLabels(rows, { max: 3, near: 1, minSep: 20 });
  assert.deepEqual(l.map((r) => r.id), [1, 3, 4]);
  assert.ok(!l.some((r) => r.id === 5)); // beyond the radius
});

// a 40 m tall box 20 m south of a window at 37 m: blocks low winter sun; scaled to 30 m it no longer rises above the eye
const raw = [[40, 0, 0, [-20, -30, 20, -30, 20, -20, -20, -20]], [77, 0, 0, [-10, 0, 10, 0, 10, 10, -10, 10]]];
test('scaled buildings change every obstruction calculation and leave the original alone', () => {
  const B = prepBuildings(raw);
  const before = horizonDir(B, 0, 0, 37, 180, 1);
  assert.ok(before > 5);
  const B2 = applyEdits(B, new Map([[0, 30]]));
  assert.equal(B[0].top, 40); assert.equal(B2[0].top, 30); assert.equal(B2[1], B[1]);
  assert.equal(horizonDir(B2, 0, 0, 37, 180, 1), 0);
  const B3 = applyEdits(B, new Map([[0, 80]]));
  assert.ok(horizonDir(B3, 0, 0, 37, 180, 1) > before);
  assert.ok(rayBlock(B3, 0, 0, 37, 180, 30, 1));
  assert.equal(applyEdits(B, new Map()), B);
  assert.equal(scaleBuilding(B[0], 0).top, 0);
});

test('components scale with their building', () => {
  const B = prepBuildings(raw, null, { 0: [{ ring: [[-20, -30], [20, -30], [20, -20], [-20, -20]], base_m: 0, top_m: 20, kind: 'podium' }, { ring: [[-5, -30], [5, -30], [5, -20], [-5, -20]], base_m: 20, top_m: 40, kind: 'tower' }] });
  const s = scaleBuilding(B[0], 20);
  assert.deepEqual(s.parts.map((q) => [q.base, q.top]), [[0, 10], [10, 20]]);
  assert.equal(s.scaled.from, 40); assert.equal(s.scaled.to, 20);
});

test('panorama slices tile the full circle', () => {
  const p = panoramaSlices(8, 0);
  assert.equal(p.length, 8); assert.equal(p[0].yaw, 22.5); assert.equal(p[7].x1, 1);
  assert.equal(stripX(90, 0), 0.25); assert.equal(stripX(10, 20), 350 / 360);
});
