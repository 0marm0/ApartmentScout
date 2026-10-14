// Green space for the 3D views (dashboard/js/unit/green.js): reading the site file's `green` block and deciding,
// deterministically, where tree canopies stand. Pure maths, no three.js.
import test from 'node:test';
import assert from 'node:assert/strict';
const G = await import(new URL('../../dashboard/js/unit/green.js', import.meta.url));

const sq = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const park = (x0, y0, x1, y1, extra = {}) => ({ kind: 'park', name: 'Test Park', ring: sq(x0, y0, x1, y1), ...extra });

test('cleanGreen keeps well-formed polygons and trees and drops the rest', () => {
  const g = G.cleanGreen({
    source: 'OSM', fetched: '2026-10-14',
    polys: [park(0, 0, 50, 50, { hard: 1 }), { kind: 'castle', ring: sq(0, 0, 9, 9) }, { kind: 'park', ring: [[0, 0], [1, 1]] }, { kind: 'wood', ring: [[0, 0], [10, 0], [null, 5]] }, null],
    trees: [1, 2, 3, 'x', 5, 6, 7],
  });
  assert.equal(g.polys.length, 1);
  assert.equal(g.polys[0].hard, true);
  assert.deepEqual(g.trees, [1, 2, 5, 6]);               // the NaN pair and the odd last value are dropped
  assert.equal(g.fetched, '2026-10-14');
  assert.equal(G.cleanGreen(null), null);
  assert.equal(G.cleanGreen({ polys: [], trees: [] }), null);
  assert.equal(G.cleanGreen({ polys: 'nope', trees: 5 }), null);
});

test('hash01 is deterministic and spread over [0, 1)', () => {
  assert.equal(G.hash01(3, 4, 5), G.hash01(3, 4, 5));
  assert.notEqual(G.hash01(3, 4, 5), G.hash01(3, 4, 6));
  const v = Array.from({ length: 400 }, (_, i) => G.hash01(i, i * 7, 1));
  assert.ok(v.every((x) => x >= 0 && x < 1));
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  assert.ok(mean > 0.4 && mean < 0.6, `mean ${mean}`);
});

test('point in polygon respects holes', () => {
  const p = { ring: sq(0, 0, 100, 100), holes: [sq(40, 40, 60, 60)] };
  assert.equal(G.inPoly(10, 10, p), true);
  assert.equal(G.inPoly(50, 50, p), false);
  assert.equal(G.inPoly(150, 50, p), false);
  assert.equal(G.ringArea(sq(0, 0, 10, 20)), 200);
});

test('scatterTrees puts canopies inside the polygon, the same ones every time', () => {
  const polys = [{ ...park(0, 0, 90, 90), hard: false, holes: [sq(30, 30, 60, 60)] }];
  const a = G.scatterTrees(polys), b = G.scatterTrees(polys);
  assert.deepEqual(a, b);
  assert.ok(a.length / 2 > 20, `a 90 m park holds trees: ${a.length / 2}`);
  for (let i = 0; i < a.length; i += 2) assert.ok(G.inPoly(a[i], a[i + 1], polys[0]), 'every tree stands on the lawn, not in the courtyard');
  // spacing: no two trees closer than a few metres (jittered grid, 9 m cells for a park)
  let min = Infinity;
  for (let i = 0; i < a.length; i += 2) for (let j = i + 2; j < a.length; j += 2) min = Math.min(min, Math.hypot(a[i] - a[j], a[i + 1] - a[j + 1]));
  assert.ok(min > 2, `closest pair ${min.toFixed(1)} m`);
});

test('hard surfaces and playgrounds get no grid trees; woods are denser than lawns', () => {
  assert.equal(G.scatterTrees([{ ...park(0, 0, 90, 90), hard: true, holes: [] }]).length, 0);
  const dens = (kind) => G.scatterTrees([{ kind, ring: sq(0, 0, 120, 120), hard: false, holes: [] }]).length;
  assert.ok(dens('wood') > dens('park') && dens('park') > dens('grass'), `${dens('wood')} / ${dens('park')} / ${dens('grass')}`);
});

test('scatterTrees honours the radius and the limit', () => {
  const polys = [{ ...park(0, 0, 400, 400), hard: false, holes: [] }];
  const near = G.scatterTrees(polys, { center: [0, 0], radius: 100 });
  for (let i = 0; i < near.length; i += 2) assert.ok(Math.hypot(near[i], near[i + 1]) <= 100);
  assert.ok(near.length < G.scatterTrees(polys).length);
  assert.equal(G.scatterTrees(polys, { limit: 10 }).length / 2 >= 10, true);
  assert.ok(G.scatterTrees(polys, { limit: 0 }).length === 0);
});

test('treeShape stays inside the 8-15 m height and canopy limits and is stable', () => {
  for (let i = 0; i < 200; i++) {
    const t = G.treeShape(i * 3.3, i * 1.7 - 40), u = G.treeShape(i * 3.3, i * 1.7 - 40);
    assert.deepEqual(t, u);
    assert.ok(t.h >= G.TREE.hMin && t.h <= G.TREE.hMax && t.r >= G.TREE.rMin && t.r <= G.TREE.rMax && t.tone >= 0 && t.tone < 1);
    assert.ok(t.h - t.r * 0.8 > 2, 'the canopy centre is well above the ground so the trunk shows');
  }
});

test('greenPlan keeps polygons near the centre and mapped trees first', () => {
  const g = { polys: [park(0, 0, 60, 60), park(900, 900, 960, 960)], trees: [5, 5, 700, 700, 20, 20] };
  const plan = G.greenPlan(g, { center: [0, 0], radius: 300 });
  assert.equal(plan.polys.length, 1);
  assert.equal(plan.mapped, 2);
  assert.deepEqual(plan.trees.slice(0, 4), [5, 5, 20, 20]);
  assert.equal(plan.trees.length / 2, plan.mapped + plan.scattered);
  assert.equal(G.greenPlan(null), null);
  assert.equal(G.greenPlan(g, { center: [0, 0], radius: 300, limit: 2 }).scattered, 0);
});
