// node --test tests/js : the measuring tape's maths (readings, snapping, the list of measurements)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalisePlan } from '../../dashboard/js/plan/model.js';
import { resolve } from '../../dashboard/js/plan/catalog.js';
import {
  fmtFtIn, fmtMetric, describeLength, dist3, measureInfo, measureLabel, snapTargets, flattenTargets, pickSnap, createMeasureStore, closestOnSegment, summarise, isMetricSearch, insetPoly,
} from '../../dashboard/js/measure/core.js';

// a 12 ft x 10 ft room, walls 4.8 in thick on the room edges, one window on the top wall, one door on the right wall
const plan = () => normalisePlan({
  units: 'ft', ceiling: 9, rooms: [{ name: 'Living', kind: 'living', x: 0, y: 0, w: 12, h: 10 }],
  windows: [{ room: 'Living', x1: 3, y1: 10, x2: 7, y2: 10, sill: 3, head: 7 }],
  doors: [{ room: 'Living', x1: 12, y1: 2, x2: 12, y2: 5, head: 6.8 }],
});

test('feet and inches read to the nearest half inch', () => {
  assert.equal(fmtFtIn(100), "8' 4\"");
  assert.equal(fmtFtIn(100.5), "8' 4½\"");
  assert.equal(fmtFtIn(24), "2'");
  assert.equal(fmtFtIn(7), '7"');
  assert.equal(fmtFtIn(0.2), '0"');
  assert.equal(fmtFtIn(0.3), '½"');
  assert.equal(fmtFtIn(143.8), "12'", 'rounding up carries into the feet');
  assert.equal(fmtFtIn(-30), "-2' 6\"");
  assert.equal(fmtFtIn(NaN), '?');
});

test('metres from a metre, centimetres below', () => {
  assert.equal(fmtMetric(100), '2.54 m');
  assert.equal(fmtMetric(39.37007874), '1.00 m');
  assert.equal(fmtMetric(10), '25 cm');
  assert.equal(fmtMetric(2), '5.1 cm');
});

test('a metric search reads metres beside the feet; an imperial one keeps them in the tooltip', () => {
  const imp = describeLength(100), met = describeLength(100, { metric: true });
  assert.equal(imp.secondary, '');
  assert.match(imp.title, /2\.54 m/);
  assert.equal(met.secondary, '2.54 m');
  assert.equal(measureLabel([0, 0, 0], [100, 0, 0], { metric: true }).text, "8' 4\" · 2.54 m");
});

test('distance splits into the run along the floor and the rise', () => {
  assert.equal(dist3([0, 0, 0], [3, 4, 12]), 13);
  const up = measureInfo([5, 5, 0], [5, 5, 108]);
  assert.equal(up.kind, 'height'); assert.equal(up.total, 108); assert.equal(up.run, 0);
  const flat = measureInfo([0, 0, 0], [144, 0, 0]);
  assert.equal(flat.kind, 'floor'); assert.equal(flat.total, 144);
  const slant = measureInfo([0, 0, 0], [40, 0, 30]);
  assert.equal(slant.kind, '3d'); assert.equal(slant.total, 50);
  assert.match(measureLabel([0, 0, 0], [40, 0, 30]).title, /3' 4" along the floor, 2' 6" up/);
});

test('wall corners are the faces you see: the clear width of the room, not the centrelines', () => {
  const m = plan(), t = snapTargets(m);
  const inner = t.points.filter((p) => p.kind === 'corner' && p.p[2] === 0);
  const xs = inner.map((p) => p.p[0]), ys = inner.map((p) => p.p[1]);
  const half = m.wallT / 2;
  assert.ok(Math.min(...xs) > 0 && Math.min(...xs) <= half + 0.01, 'inside the left wall');
  assert.ok(Math.max(...xs) < 144 && Math.max(...xs) >= 144 - half - 0.01, 'inside the right wall');
  assert.ok(Math.min(...ys) > 0 && Math.max(...ys) < 120);
  // clear width: 12 ft room minus one wall thickness
  const left = inner.find((p) => Math.abs(p.p[0] - half) < 0.01 && Math.abs(p.p[1] - half) < 0.01);
  const right = inner.find((p) => Math.abs(p.p[0] - (144 - half)) < 0.01 && Math.abs(p.p[1] - half) < 0.01);
  assert.ok(left && right, 'bottom corners at the wall faces');
  assert.ok(Math.abs(dist3(left.p, right.p) - (144 - m.wallT)) < 0.01);
});

test('window and door edges are named and sit at the sill, the head and the floor', () => {
  const t = snapTargets(plan());
  const win = t.points.filter((p) => p.kind === 'window');
  assert.deepEqual([...new Set(win.map((p) => p.p[2]))].sort((a, b) => a - b), [36, 84]);
  assert.equal(win.length, 4);
  // the glass is 4 ft wide (48 in)
  const sill = win.filter((p) => p.p[2] === 36);
  assert.equal(Math.round(dist3(sill[0].p, sill[1].p)), 48);
  const door = t.points.filter((p) => p.kind === 'door');
  assert.deepEqual([...new Set(door.map((p) => p.p[2]))].sort((a, b) => a - b), [0, 81.6]);
});

test('furniture contributes its corners at the floor and at its top; hidden pieces and rugs do not', () => {
  const m = plan();
  const shelf = resolve({ id: 'shelf', ref: 'bookcase', x: 40, y: 20, rot: 0, w: 36, d: 12, h: 72 });
  const rug = resolve({ id: 'rug', ref: 'rug', x: 60, y: 60, rot: 0 });
  const hid = resolve({ id: 'hid', ref: 'dresser', x: 100, y: 60, rot: 0, hidden: true });
  const t = snapTargets(m, [shelf, rug, hid]);
  const fur = t.points.filter((p) => p.kind === 'furniture');
  assert.equal(fur.length, 8);
  assert.deepEqual([...new Set(fur.map((p) => p.p[2]))].sort((a, b) => a - b), [0, 72]);
  const xs = fur.map((p) => p.p[0]);
  assert.equal(Math.min(...xs), 22); assert.equal(Math.max(...xs), 58);   // 36 in wide, centred on x = 40
  assert.ok(t.segments.some((s) => s.kind === 'furniture'));
});

test('the first kind wins where two targets share a spot', () => {
  const m = plan();
  // a column of furniture exactly on a window corner would be named by the window
  const t = snapTargets(m);
  const seen = new Set(); let dupes = 0;
  for (const p of t.points) { const k = p.p.map((v) => Math.round(v * 2)).join('|'); if (seen.has(k)) dupes++; seen.add(k); }
  assert.equal(dupes, 0);
});

// a top-down view: x right, y up the screen, 1 px per inch; the point is "behind" nothing
const top = (p) => [p[0], -p[1]];

test('a pointer near a corner snaps to it; far from everything it stays free', () => {
  const t = snapTargets(plan()), half = 2.4;
  const near = pickSnap(t, [half + 3, half + 2, 0], [half + 3, -(half + 2)], top, { px: 14, world: 30 });
  assert.equal(near.snapped, true); assert.equal(near.kind, 'corner');
  assert.ok(Math.abs(near.p[0] - half) < 0.01 && Math.abs(near.p[1] - half) < 0.01);
  const far = pickSnap(t, [60, 60, 0], [60, -60], top, { px: 14, world: 30 });
  assert.equal(far.snapped, false); assert.equal(far.kind, 'free'); assert.deepEqual(far.p, [60, 60, 0]);
});

test('window edges win over the wall behind them; points beat edges', () => {
  const t = snapTargets(plan());
  // at the window's lower-left corner (x = 36, sill 36) the glass corner is named, not the wall
  const corner = t.points.find((p) => p.kind === 'window' && p.p[2] === 36);
  const front = (p) => [p[0], -p[2]];   // looking at the wall from the room: x across, height up the screen
  const s = pickSnap(t, [corner.p[0] + 2, corner.p[1], 36], front([corner.p[0] + 2, 0, 36]), front, { px: 14, world: 30 });
  assert.equal(s.kind, 'window');
});

test('a corner behind a wall is not taken: it must be near the surface point too', () => {
  const t = { points: [{ p: [0, 0, 0], kind: 'corner' }], segments: [] };
  // on screen the corner is under the pointer, but the pointer's surface point is 200 in away
  const s = pickSnap(t, [200, 0, 0], [0, 0], top, { px: 14, world: 30 });
  assert.equal(s.snapped, false);
});

test('an edge snaps along its length when no corner is close', () => {
  const t = { points: [], segments: [{ a: [0, 0, 0], b: [100, 0, 0], kind: 'furniture' }] };
  const s = pickSnap(t, [50, 3, 0], [50, -3], top, { px: 14, world: 30 });
  assert.equal(s.snapped, true); assert.equal(s.kind, 'furniture'); assert.deepEqual(s.p, [50, 0, 0]);
  assert.deepEqual(closestOnSegment([50, 9, 0], [0, 0, 0], [100, 0, 0]).p, [50, 0, 0]);
});

test('flattened for the 2D plan: heights vanish, vertical edges drop out, duplicates merge', () => {
  const m = plan(), t = snapTargets(m), f = flattenTargets(t);
  assert.ok(f.points.every((p) => p.p[2] === 0));
  assert.ok(f.points.length < t.points.length);
  assert.ok(f.segments.every((s) => Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]) >= 0.5));
});

test('two clicks make a measurement; several stay until cleared; a point is not a measurement', () => {
  let changes = 0;
  const s = createMeasureStore(() => { changes++; });
  assert.equal(s.place([0, 0, 0]), null); assert.deepEqual(s.pending.p, [0, 0, 0]);
  assert.equal(s.place([0, 0, 0.1]), null, 'the same spot twice is nothing');
  const m1 = s.place([120, 0, 0], 'corner');
  assert.ok(m1 && m1.id === 1 && s.pending === null && s.count === 1);
  s.place([0, 0, 0]); const m2 = s.place([0, 0, 96], 'wall');
  assert.equal(s.count, 2); assert.equal(m2.id, 2);
  assert.deepEqual(summarise(s.list).map((r) => r.text), ["10'", "8'"]);
  assert.equal(summarise(s.list)[0].inches, 120); assert.equal(summarise(s.list)[1].kind, 'height');
  s.remove(1); assert.equal(s.count, 1);
  s.place([1, 1, 0]); s.removeLast(); assert.equal(s.pending, null, 'removeLast cancels the waiting point first');
  s.removeLast(); assert.equal(s.count, 0);
  s.place([0, 0, 0]); s.place([5, 0, 0]); s.clear(); assert.equal(s.count, 0); assert.equal(s.pending, null);
  assert.ok(changes > 8);
});

test('the list is bounded and loads back', () => {
  const s = createMeasureStore();
  for (let i = 0; i < 60; i++) { s.place([0, 0, 0]); s.place([10 + i, 0, 0]); }
  assert.equal(s.count, 40);
  const keep = s.list.slice(0, 3); s.clear(); s.load(keep);
  assert.equal(s.count, 3);
  s.place([0, 0, 0]); const next = s.place([9, 0, 0]);
  assert.ok(next.id > Math.max(...keep.map((m) => m.id)), 'ids keep counting');
});

test('a search is metric when its criteria say so, or when its plan was drawn in metres', () => {
  assert.equal(isMetricSearch({ search: { units: 'metric' } }, { units: 'ft' }), true);
  assert.equal(isMetricSearch({ search: { units: 'imperial' } }, { units: 'm' }), false);
  assert.equal(isMetricSearch({}, { units: 'm' }), true);
  assert.equal(isMetricSearch({}, { units: 'ft' }), false);
  assert.equal(isMetricSearch(undefined, null), false);
});

test('an L-shaped room insets at every corner, reflex ones included', () => {
  const L = [[0, 0], [100, 0], [100, 50], [50, 50], [50, 100], [0, 100]];
  const inner = insetPoly(L, 2);
  assert.deepEqual(inner[0].map(Math.round), [2, 2]);
  assert.deepEqual(inner[3].map(Math.round), [48, 48], 'the reflex corner stays on the room side of the notch');
  assert.deepEqual(inner[2].map(Math.round), [98, 48]);
});
