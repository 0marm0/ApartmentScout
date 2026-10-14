import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalFaces, snapPosition, baselineStudyMatches, writeScenario, readScenario, readScenarioExtras, clearScenario } from '../../dashboard/js/unit/scenario.js';
const faces = [{ i: 2, shared: false }, { i: 4, shared: false }];
test('canonical walls stay rejected, including when every facade is shared', () => {
  const all = canonicalFaces(faces, faces.map((f) => ({ i: f.i, shared: true })), 2);
  assert.ok(all.every((f) => f.shared));
  assert.equal(snapPosition(all[0], .5, () => .5), null);
  assert.equal(faces[0].shared, false);
});
test('canonical clear stretch supersedes browser samples and excludes its boundary', () => {
  const [f] = canonicalFaces(faces, [{ i: 2, open: [.6, .8] }], 2);
  assert.ok(snapPosition(f, .2, () => .2) > .6);
  assert.ok(snapPosition(f, .9, () => .9) < .8);
  assert.equal(canonicalFaces(faces, [{ i: 2, open: null }], 2)[0].shared, true);
});
const state = { id: 'unit-a', face: 0, t: .7, az: 209, floor: 12, cmp: 21, date: '2026-10-15', manual: {} };
const look = { fov: 70, yaw: 23, pitch: 6 };
test('complete URL scenario round-trips and cannot apply to another site or a shared facade', () => {
  const q = writeScenario(new URLSearchParams('theme=light'), state, faces[0], look, false);
  assert.deepEqual(readScenario(q, 'unit-a', faces, 30), { face: 0, t: .7, az: 209, cmp: 21, future: false, look });
  assert.equal(readScenario(q, 'unit-b', faces, 30), null);
  assert.equal(readScenario(q, 'unit-a', [{ ...faces[0], shared: true }], 30), null);
  assert.equal(clearScenario(q).get('theme'), 'light'); assert.equal(q.has('sv'), false);
});
test('malformed and out-of-bounds scenarios are rejected as a whole', () => {
  for (const [k, v] of [['pos', 'NaN'], ['pos', '-1'], ['cmp', '31'], ['future', '2'], ['fov', ''], ['yaw', '91'], ['sv', '2']]) {
    const q = writeScenario(new URLSearchParams(), state, faces[0], look, true); q.set(k, v);
    assert.equal(readScenario(q, 'unit-a', faces, 30), null);
  }
});
test('baseline uncertainty requires exact source scenario, floor and study year', () => {
  const site = { generated: '2026-10-13', window: { face: 2, t: .7, bearing: 209, floor: 12 } };
  assert.equal(baselineStudyMatches(site, state, faces[0]), true);
  for (const patch of [{ floor: 13 }, { t: .6 }, { date: '2027-10-15' }, { manual: { face: true } }, { moved: {} }])
    assert.equal(baselineStudyMatches(site, { ...state, ...patch }, faces[0]), false);
  assert.equal(baselineStudyMatches({ ...site, generated: undefined }, state, faces[0]), false);
});

test('optional interior, bay, slab and matched-landmark settings round-trip at full precision', () => {
  const extras = { bay: true, slabOff: 2.34567, inWin: 2, src: 'photo-landmarks', lmSel: new Set(['Empire State', 'Hudson Yards']) };
  const q = writeScenario(new URLSearchParams(), { ...state, ...extras }, faces[0], look, true);
  const out = readScenario(q, state.id, faces, 30);
  assert.equal(out.bay, true); assert.equal(out.slabOff, 2.34567); assert.equal(out.inWin, 2);
  assert.equal(out.src, 'photo-landmarks'); assert.deepEqual(out.landmarks, [...extras.lmSel]);
  clearScenario(q); for (const k of ['bay', 'slab', 'inWin', 'src', 'lm']) assert.equal(q.has(k), false);
});

test('invalid optional settings reject the whole versioned scenario', () => {
  for (const [k, v] of [['bay', 'true'], ['slab', '60'], ['slab', 'NaN'], ['slab', ''], ['inWin', '64'], ['inWin', '1.5'], ['src', 'established'], ['lm', '<unsafe>'], ['lm', Array(41).fill('a').join('|')]]) {
    const q = writeScenario(new URLSearchParams(), state, faces[0], look, true); q.set(k, v);
    assert.equal(readScenario(q, state.id, faces, 30), null, k + '=' + v);
  }
});

test('older unversioned extra links use the same validation without requiring new fields', () => {
  assert.deepEqual(readScenarioExtras(new URLSearchParams('bay=0&slab=-2&inWin=1')), { bay: false, slabOff: -2, inWin: 1 });
  assert.deepEqual(readScenarioExtras(new URLSearchParams()), {});
});
