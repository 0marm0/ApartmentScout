// Park trees and grass for the 3D city: the NYC Parks forestry inventory in the tree plan (unit/trees.js), which polygons get
// invented canopy and which do not (unit/parkfill.js), street vs park classes for the layer controls, and the grass plan
// (unit/grassplan.js). Pure maths: no three.js, no DOM. The three.js side is covered in tests/e2e/test_context3d.py.
import test from 'node:test';
import assert from 'node:assert/strict';
const T = await import(new URL('../../dashboard/js/unit/trees.js', import.meta.url));
const P = await import(new URL('../../dashboard/js/unit/parkfill.js', import.meta.url));
const G = await import(new URL('../../dashboard/js/unit/grassplan.js', import.meta.url));

const sq = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

// ------------------------------------------------------------------ the inventory block

test('decodeForestry reads quantised five-number trees and drops broken ones', () => {
  const f = T.decodeForestry({ q_m: 0.5, source: 'NYC Parks', date: '2026-10-07', pts: [20, 40, 14, 1, 0, -10, 6, 3, 2, 1, 'x', 1, 5, 0, 0, 8, 8, 9, 99, 7, 1, 2, 3] });
  assert.equal(f.n, 3);
  assert.deepEqual([f.x[0], f.y[0], f.dbh[0], f.grp[0], f.loc[0]], [10, 20, 14, 1, 0]);
  assert.deepEqual([f.x[1], f.y[1], f.loc[1]], [-5, 3, 1]);
  assert.equal(f.grp[2], 0, 'a group out of range falls back to other');
  assert.equal(f.loc[2], 0, 'anything but 1 is a park tree');
  assert.equal(f.source, 'NYC Parks');
  assert.equal(T.decodeForestry(null), null);
  assert.equal(T.decodeForestry({ pts: [] }), null);
  assert.equal(T.decodeForestry({ pts: 'no' }), null);
});

const base = (extra = {}) => ({
  polys: [{ kind: 'park', ring: sq(100, 100, 200, 200), holes: [], src: 'parks', on_parks: 1, inv: 2 }],
  trees: [],
  census: { q_m: 0.5, source: 'NYC Street Tree Census', date: '2015', pts: [20, 20, 8, 1, 40, 20, 12, 2] },
  forestry: { q_m: 0.5, source: 'NYC Parks inventory', date: '2026-10-07', pts: [300, 300, 16, 1, 0, 340, 300, 20, 2, 0, 20, 400, 3, 0, 1] },
  ...extra,
});

test('the plan carries the inventory: park trees in parks, street trees planted since the census, sized from the current trunk', () => {
  const p = T.treePlan(base(), { radius: 500, fill: false });
  assert.deepEqual([p.counts.census, p.counts.park, p.counts.street, p.counts.mapped, p.counts.fill], [2, 2, 1, 0, 0]);
  assert.equal(p.counts.streetTrees, 3, 'census trees and the new street tree are street trees');
  assert.equal(p.counts.parkTrees, 2);
  const i = [...Array(p.n).keys()].find((k) => p.src[k] === T.SRC.park && p.dbh[k] === 16);
  assert.ok(i >= 0, 'the Parks inventory is live: no growth is added to its trunk');
  const c = [...Array(p.n).keys()].find((k) => p.src[k] === T.SRC.census && p.dbh[k] === 8 + T.GROWTH_IN);
  assert.ok(c >= 0, 'the 2015 census is: it gets the growth since');
  for (let k = 0; k < p.n; k++) assert.equal(p.cls[k], p.src[k] === T.SRC.park ? T.CLS.park : T.CLS.street);
  assert.equal(p.forestry.source, 'NYC Parks inventory');
});

test('a mapped tree is a park tree inside a park polygon and a street tree outside, and a census or inventory tree beats it', () => {
  // the inventory stands at (150, 150), (170, 150) and (10, 200); the park is (100..200)^2
  const g = base({ trees: [120, 120, 600, 600, 150.5, 150.5] });
  const p = T.treePlan(g, { radius: 900, fill: false });
  const mapped = [...Array(p.n).keys()].filter((k) => p.src[k] === T.SRC.mapped);
  assert.equal(mapped.length, 2, 'the one on the inventory tree at (150, 150) is the same tree and is dropped');
  const at = (x) => mapped.find((k) => Math.abs(p.x[k] - x) < 1);
  assert.equal(p.cls[at(120)], T.CLS.park);
  assert.equal(p.cls[at(600)], T.CLS.street);
});

// ------------------------------------------------------------------ where the fill goes

test('fill: dense where no inventory describes the polygon, none on Parks property that has one, a share where it is thin', () => {
  const dense = [{ kind: 'park', ring: sq(0, 0, 100, 100), holes: [] }];                                    // a private park: nothing recorded
  const covered = [{ kind: 'park', on_parks: true, inv: 60, ring: sq(0, 0, 100, 100), holes: [] }];        // 60 trees on a hectare: the inventory describes it
  const thin = [{ kind: 'park', on_parks: true, inv: 1, ring: sq(0, 0, 200, 150), holes: [] }];
  const a = T.fillTrees(dense, {}).length, b = T.fillTrees(covered, {}).length, c = T.fillTrees(thin, {}).length;
  assert.ok(a > 90, `${a} trees in a private hectare`);
  assert.equal(b > 0, false, 'Parks property with an inventory gets only its real trees');
  assert.ok(c > 0 && c / 3 < a * 0.8 && c / 3 > a * 0.3, `a thin Parks polygon gets a share: ${c / 3}/ha against ${a}/ha`);
  assert.equal(T.fillTrees([{ kind: 'park', on_parks: true, inv: 1, ring: sq(0, 0, 30, 30), holes: [] }], {}).length, 0, 'a small Parks polygon is never topped up');
  assert.equal(T.fillTrees([{ kind: 'grass', on_parks: true, inv: 0, ring: sq(0, 0, 100, 100), holes: [] }], {}).length, 0, 'a lawn on Parks property stays open');
  assert.equal(T.fillTrees([{ kind: 'wood', turf: true, ring: sq(0, 0, 100, 100), holes: [] }], {}).length, 0);
});

test('fillTargets reports the share each polygon gets', () => {
  const polys = [{ kind: 'park', ring: sq(0, 0, 50, 50), holes: [] }, { kind: 'play', ring: sq(0, 0, 50, 50), holes: [] }, { kind: 'park', hard: true, ring: sq(0, 0, 50, 50), holes: [] },
    { kind: 'park', on_parks: true, inv: 0, ring: sq(0, 0, 100, 100), holes: [] }, { kind: 'park', on_parks: true, ring: sq(0, 0, 100, 100), holes: [] }];
  const t = P.fillTargets(polys);
  assert.deepEqual(t.map((x) => [x.k, x.share]), [[0, 1], [3, P.TOPUP]]);
});

test('the fill keeps clear of real trees, and out of lawns and paved ground mapped inside a park', () => {
  const g = {
    polys: [{ kind: 'park', ring: sq(0, 0, 200, 200), holes: [] }, { kind: 'grass', ring: sq(60, 60, 140, 140), holes: [] }, { kind: 'play', hard: true, ring: sq(150, 20, 190, 60), holes: [] }],
    forestry: { q_m: 0.5, pts: [20, 20, 12, 0, 0, 40, 40, 12, 0, 0] },    // a real tree at (10, 10) and (20, 20)
  };
  const p = T.treePlan(g, { center: [100, 100], radius: 400 });
  const fill = [...Array(p.n).keys()].filter((k) => p.src[k] === T.SRC.fill);
  assert.ok(fill.length > 40);
  for (const k of fill) {
    assert.ok(!(p.x[k] > 60 && p.x[k] < 140 && p.y[k] > 60 && p.y[k] < 140), 'no tree in the lawn');
    assert.ok(!(p.x[k] > 150 && p.x[k] < 190 && p.y[k] > 20 && p.y[k] < 60), 'no tree on the paved court');
    for (const r of [[10, 10], [20, 20]]) assert.ok(Math.hypot(p.x[k] - r[0], p.y[k] - r[1]) >= P.REAL_CLEAR_M - 1e-6, 'clear of a real crown');
  }
});

test('a lawn inside a park stays open; a lawn that stands alone is planted, all over when small and at its edge when big', () => {
  const inPark = { polys: [{ kind: 'park', ring: sq(0, 0, 200, 200), holes: [] }, { kind: 'grass', ring: sq(60, 60, 140, 140), holes: [] }] };
  const p = T.treePlan(inPark, { center: [100, 100], radius: 400 });
  const lawn = [...Array(p.n).keys()].filter((k) => p.x[k] > 60 && p.x[k] < 140 && p.y[k] > 60 && p.y[k] < 140);
  assert.equal(lawn.length, 0, 'the lawn in the park is open');
  assert.ok(p.counts.fill > 80, 'the park around it is planted');
  const small = T.treePlan({ polys: [{ kind: 'grass', ring: sq(500, 0, 530, 25), holes: [] }] }, { center: [515, 12], radius: 100 });
  assert.ok(small.counts.fill >= 3, `a 750 m2 lawn beside a ramp gets ${small.counts.fill} trees`);
  const big = T.treePlan({ polys: [{ kind: 'grass', ring: sq(0, 0, 120, 100), holes: [] }] }, { center: [60, 50], radius: 200 });
  assert.ok(big.counts.fill > 10);
  for (let k = 0; k < big.n; k++) assert.ok(Math.min(big.x[k], 120 - big.x[k], big.y[k], 100 - big.y[k]) <= 9.5, 'a big lawn is open in the middle');
});

test('the park beside Paramount Tower is as full as the inventory: St. Vartan Park holds about 95 trees a hectare, and the fill is not added on top', () => {
  const ring = sq(0, 0, 100, 100);
  const pts = []; for (let i = 0; i < 95; i++) pts.push(2 * (5 + (i % 10) * 9.5), 2 * (5 + Math.floor(i / 10) * 9.5), 18, 1, 0);
  const g = { polys: [{ kind: 'park', src: 'parks', on_parks: 1, inv: 95, ring, holes: [] }], forestry: { q_m: 0.5, pts } };
  const p = T.treePlan(g, { center: [50, 50], radius: 200 });
  assert.equal(p.counts.park, 95);
  assert.equal(p.counts.fill, 0);
});

test('polyIndex finds the polygons a point stands in, holes respected', () => {
  const polys = [{ ring: sq(0, 0, 100, 100), holes: [sq(40, 40, 60, 60)], name: 'a' }, { ring: sq(50, 50, 300, 300), name: 'b' }];
  const idx = P.polyIndex(polys);
  assert.deepEqual(idx.at(10, 10).map((q) => q.name), ['a']);
  assert.deepEqual(idx.at(50, 50).map((q) => q.name), ['b']);
  assert.deepEqual(idx.at(80, 80).map((q) => q.name), ['a', 'b']);
  assert.deepEqual(idx.at(-5, -5), []);
  assert.equal(Math.round(P.polyArea(polys[0])), 9600);
  const t = P.treeIndex(4); t.add(10, 10);
  assert.ok(t.near(12, 10) && !t.near(20, 10));
});

// ------------------------------------------------------------------ the grass plan

test('the grass plan puts each polygon on a layer: parks under paved ground under lawns under courts', () => {
  const polys = [
    { kind: 'park', ring: sq(0, 0, 100, 100), holes: [] },
    { kind: 'wood', ring: sq(0, 0, 50, 50), holes: [] },
    { kind: 'grass', ring: sq(10, 10, 30, 30), holes: [] },
    { kind: 'play', hard: true, src: 'parks', ring: sq(60, 60, 90, 90), holes: [] },
    { kind: 'play', hard: true, ring: sq(70, 70, 80, 80), holes: [] },
    { kind: 'grass', hard: true, turf: true, ring: sq(20, 20, 28, 28), holes: [] },
    { kind: 'park', hard: true, src: 'parks', cat: 'Waterfront Facility', ring: sq(0, 0, 10, 10), holes: [] },
  ];
  const plan = G.grassPlan(polys);
  const layerOf = (i) => plan.find((l) => l.polys.some((q) => q.ring === polys[i].ring)).layer;
  assert.equal(layerOf(0), G.LAYER.base); assert.equal(layerOf(1), G.LAYER.base);
  assert.equal(layerOf(2), G.LAYER.lawn);
  assert.equal(layerOf(3), G.LAYER.paved);
  assert.equal(layerOf(4), G.LAYER.court);
  assert.equal(layerOf(5), G.LAYER.turf);
  assert.ok(G.LAYER.base < G.LAYER.paved && G.LAYER.paved < G.LAYER.lawn && G.LAYER.lawn < G.LAYER.court);
  assert.deepEqual(plan.map((l) => l.layer), [...plan.map((l) => l.layer)].sort((a, b) => a - b), 'drawn back to front');
});

test('the grass plan drops malformed polygons, keeps holes and styles every layer', () => {
  const plan = G.grassPlan([{ kind: 'park', ring: [[0, 0], [1, 1]] }, { kind: 'bogus', ring: sq(0, 0, 9, 9) }, { kind: 'park', ring: sq(0, 0, 20, 20), holes: [sq(5, 5, 9, 9), [[1, 1]]] }, null]);
  assert.equal(plan.length, 1);
  assert.equal(plan[0].polys.length, 1);
  assert.equal(plan[0].polys[0].holes.length, 1);
  for (const k of Object.keys(G.LAYER)) assert.ok(G.STYLE[k], `style for ${k}`);
});

test('layer toggles are remembered: a bad or missing store gives both on', async () => {
  const L = await import(new URL('../../dashboard/js/unit/treelayers.js', import.meta.url));
  const mem = new Map();
  const store = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)) };
  assert.deepEqual(L.loadTreeLayers(store), { streetTrees: true, parkTrees: true });
  L.saveTreeLayers({ streetTrees: false, parkTrees: true }, store);
  assert.deepEqual(L.loadTreeLayers(store), { streetTrees: false, parkTrees: true });
  mem.set(L.KEY, '{nonsense'); assert.deepEqual(L.loadTreeLayers(store), { streetTrees: true, parkTrees: true });
  mem.set(L.KEY, JSON.stringify({ streetTrees: 0, parkTrees: 'x' })); assert.deepEqual(L.loadTreeLayers(store), { streetTrees: true, parkTrees: true }, 'only booleans are trusted');
  assert.deepEqual(L.loadTreeLayers({ getItem() { throw new Error('denied'); } }), { streetTrees: true, parkTrees: true });
  assert.doesNotThrow(() => L.saveTreeLayers({ streetTrees: false }, { setItem() { throw new Error('full'); } }));
  assert.deepEqual(L.loadTreeLayers(null), { streetTrees: true, parkTrees: true });
});
