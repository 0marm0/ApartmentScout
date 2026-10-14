// node --test tests/js : trade-off pad maths. The pad must write the same weights the sliders would, and its live
// ranking must match the dashboard's weighted score.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  CORNERS, toShares, toXY, clampShares, groupTotal, sharesOf, applyShares, nudgeWeights, topDims, defaultAxes, weightedScore, rankIds, rankShift, pctOf, SLIDER_MAX,
} from '../../dashboard/js/features/tradeoff-model.js';

const read = (p) => JSON.parse(fs.readFileSync(new URL(p, import.meta.url), 'utf8'));
const LISTINGS = read('../../dashboard/data/listings.json');
const CRIT = read('../../dashboard/data/criteria.json');
const DIMS = CRIT.scoring.dimensions.map((d) => d[0]);
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

test('corners map to pure shares and back, and the centre is an even split', () => {
  CORNERS.forEach(([x, y], i) => { const s = toShares(x, y); assert.ok(near(s[i], 1) && near(s[(i + 1) % 3], 0), `corner ${i}`); });
  const [cx, cy] = toXY([1, 1, 1]);
  assert.ok(toShares(cx, cy).every((v) => near(v, 1 / 3)));
  for (const s of [[0.2, 0.5, 0.3], [0.6, 0.1, 0.3], [0, 0.5, 0.5]]) { const back = toShares(...toXY(s)); s.forEach((v, i) => assert.ok(near(v, back[i], 1e-9))); }
});

test('a point outside the triangle is pulled onto it and the shares always add up to one', () => {
  for (const [x, y] of [[-1, -1], [2, 2], [0.5, -0.4], [0.5, 3], [0, 0]]) {
    const s = toShares(x, y);
    assert.ok(near(s.reduce((a, b) => a + b, 0), 1) && s.every((v) => v >= 0), `${x},${y}`);
  }
});

test('applyShares keeps the group total, leaves other weights alone and writes whole numbers', () => {
  const W = { cost: 20, space: 15, commute: 10, amenities: 5, light_view: 15, building: 15 };
  const dims = ['cost', 'commute', 'space'];
  assert.equal(groupTotal(W, dims), 45);
  for (const shares of [[1 / 3, 1 / 3, 1 / 3], [0.5, 0.25, 0.25], [0.1, 0.1, 0.8], [0.333, 0.333, 0.334], [0, 0, 1]]) {
    const out = applyShares(W, dims, shares);
    assert.equal(groupTotal(out, dims), 45, JSON.stringify(shares));
    for (const k of dims) assert.ok(Number.isInteger(out[k]) && out[k] >= 0 && out[k] <= SLIDER_MAX, `${k}=${out[k]}`);
    for (const k of ['amenities', 'light_view', 'building']) assert.equal(out[k], W[k]);
  }
  assert.deepEqual(W, { cost: 20, space: 15, commute: 10, amenities: 5, light_view: 15, building: 15 }, 'input untouched');
});

test('a corner is capped at the slider maximum and the excess goes to the other two', () => {
  const W = { cost: 20, space: 15, commute: 10 };
  const out = applyShares(W, ['cost', 'commute', 'space'], [1, 0, 0]);
  assert.equal(out.cost, SLIDER_MAX);
  assert.equal(out.commute + out.space, 5);
  assert.deepEqual(clampShares([0.95, 0.05, 0], 0.5).map((v) => +v.toFixed(3)), [0.5, 0.5, 0]);
  assert.ok(near(clampShares([3, 1, 0], 1).reduce((a, b) => a + b, 0), 1));
});

test('the same shares the sliders hold come back out: dragging to where the dot already is changes nothing', () => {
  const W = { ...CRIT.weights };
  const dims = defaultAxes(W, DIMS);
  assert.deepEqual(dims, ['cost', 'commute', 'space']);
  const s = sharesOf(W, dims);
  const out = applyShares(W, dims, s);
  for (const k of dims) assert.equal(out[k], W[k], k);
});

test('rounding is exact for awkward totals', () => {
  for (let T = 3; T < 60; T += 7) {
    const W = { a: T, b: 0, c: 0 };
    for (let i = 0; i < 40; i++) {
      const s = [Math.random(), Math.random(), Math.random()];
      const out = applyShares(W, ['a', 'b', 'c'], s);
      assert.equal(out.a + out.b + out.c, Math.min(T, 120), `T=${T}`);
    }
  }
  assert.deepEqual(applyShares({ a: 0, b: 0, c: 0 }, ['a', 'b', 'c'], [0.2, 0.3, 0.5]), { a: 0, b: 0, c: 0 }, 'no weight in the group: nothing to split');
  assert.equal(sharesOf({ a: 0, b: 0, c: 0 }, ['a', 'b', 'c']), null);
});

test('top three weights and the default axes', () => {
  assert.deepEqual(topDims({ cost: 20, space: 15, commute: 10, light_view: 15, building: 15 }, ['cost', 'space', 'commute', 'light_view', 'building']), ['cost', 'space', 'light_view']);
  assert.deepEqual(defaultAxes({ a: 1, b: 5, c: 3, d: 4 }, ['a', 'b', 'c', 'd']), ['b', 'd', 'c'], 'no cost/commute/space: the top three');
});

test('the preview ranking uses the dashboard formula and matches the scorer at the criteria weights', () => {
  const act = LISTINGS.filter((L) => L.score?.eligible);
  const W = CRIT.weights;
  let checked = 0;
  for (const L of act.slice(0, 200)) {
    const s = weightedScore(L, W, DIMS);
    assert.ok(Math.abs(s - L.score.overall) < 0.35, `${L.id}: ${s} vs ${L.score.overall}`);
    checked++;
  }
  assert.ok(checked > 100);
  const ids = rankIds(act, W, DIMS);
  assert.equal(ids.length, act.length);
  // a different weighting reorders; all-cost puts the cheapest-scoring homes first
  const costOnly = rankIds(act, { cost: 40 }, DIMS), by = (id) => act.find((L) => L.id === id).score.parts.cost ?? 50;
  assert.ok(by(costOnly[0]) >= by(costOnly[50]) && by(costOnly[50]) >= by(costOnly[200]));
});

test('rankShift reports climbers, fallers, new entrants and who dropped out of the top n', () => {
  const before = ['a', 'b', 'c', 'd', 'e'], after = ['c', 'a', 'x', 'b', 'e'];
  const r = rankShift(before, after, 3);
  assert.deepEqual(r.rows.map((x) => [x.id, x.rank, x.was, x.delta]), [['c', 1, 3, 2], ['a', 2, 1, -1], ['x', 3, null, null]]);
  assert.deepEqual(r.out, [{ id: 'b', was: 2, now: 4 }]);
  assert.equal(r.changed, 3);
  assert.equal(rankShift(before, before, 5).changed, 0);
});

test('keyboard nudges move whole slider notches, keep the total and respect the ends', () => {
  const W = { cost: 20, commute: 10, space: 15, light_view: 15 }, dims = ['cost', 'commute', 'space'];
  const up = nudgeWeights(W, dims, 'up');
  assert.deepEqual([up.cost, up.commute, up.space], [21, 10, 14], 'taken from the heavier of the other two');
  const down = nudgeWeights(W, dims, 'down', 2);
  assert.deepEqual([down.cost, down.commute, down.space], [18, 12, 15], 'given to the lighter of the other two');
  assert.equal(groupTotal(down, dims), 45);
  const right = nudgeWeights(W, dims, 'right', 3);
  assert.deepEqual([right.commute, right.space], [7, 18]);
  assert.deepEqual([nudgeWeights(W, dims, 'left').commute, nudgeWeights(W, dims, 'left').space], [11, 14]);
  assert.equal(nudgeWeights({ a: 40, b: 3, c: 2 }, ['a', 'b', 'c'], 'up').a, 40, 'the slider maximum holds');
  assert.deepEqual(nudgeWeights({ a: 0, b: 5, c: 5 }, ['a', 'b', 'c'], 'down'), { a: 0, b: 5, c: 5 });
  assert.equal(nudgeWeights(W, dims, 'up').light_view, 15, 'other weights untouched');
});

test('pctOf prints the share the sliders print', () => {
  assert.equal(pctOf({ a: 20, b: 20, c: 60 }, ['a', 'b', 'c'], 'c'), 60);
  assert.equal(pctOf({}, ['a'], 'a'), 0);
});
