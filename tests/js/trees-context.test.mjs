// City context for the 3D views: trees (dashboard/js/unit/trees.js), the street / water helpers
// (unit/context-core.js) and the canvas painters of the ground plate and water mask (unit/groundtex.js).
// Pure maths and a recording canvas: no three.js, no DOM. The three.js side is covered in tests/e2e/test_context3d.py.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const T = await import(new URL('../../dashboard/js/unit/trees.js', import.meta.url));
const C = await import(new URL('../../dashboard/js/unit/context-core.js', import.meta.url));
const X = await import(new URL('../../dashboard/js/unit/groundtex.js', import.meta.url));

const sq = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const FIX = JSON.parse(readFileSync(new URL('../fixtures/tree_allometry.json', import.meta.url), 'utf8'));

// ------------------------------------------------------------------ allometry (twin of geo/trees.py)

test('allometry matches the Python twin on the shared fixture', () => {
  assert.ok(FIX.length > 5);
  for (const [dbh, r, h] of FIX) {
    assert.ok(Math.abs(T.crownRadius(dbh) - r) < 0.005, `crown radius at ${dbh} in`);
    assert.ok(Math.abs(T.treeHeight(dbh) - h) < 0.005, `height at ${dbh} in`);
  }
});

test('allometry grows with the trunk then levels off, and never goes negative', () => {
  const d = [1, 4, 8, 12, 20, 30, 60];
  const r = d.map(T.crownRadius), h = d.map(T.treeHeight);
  assert.deepEqual([...r].sort((a, b) => a - b), r);
  assert.deepEqual([...h].sort((a, b) => a - b), h);
  assert.equal(T.crownRadius(999), T.ALLOMETRY.crownMax / 2);
  assert.equal(T.treeHeight(999), T.ALLOMETRY.heightMax);
  assert.equal(T.treeHeight(-5), T.ALLOMETRY.heightBase);
  assert.equal(T.crownRadius(NaN), T.ALLOMETRY.crownBase / 2);
  // typical open-grown NYC street trees: 8 in ~7.5 m tall and ~4.5 m across, 12 in ~12 m and ~7.5 m, 24 in ~18 m and ~13.5 m
  assert.ok(T.treeHeight(8) > 7.5 && T.treeHeight(8) < 9.5 && 2 * T.crownRadius(8) > 4 && 2 * T.crownRadius(8) < 5.6);
  assert.ok(T.treeHeight(12) > 10.5 && T.treeHeight(12) < 12.5 && 2 * T.crownRadius(12) > 6 && 2 * T.crownRadius(12) < 8);
  assert.ok(T.treeHeight(24) > 17 && T.treeHeight(24) < 20.5 && 2 * T.crownRadius(24) > 11.5 && 2 * T.crownRadius(24) < 14);
  // a Midtown street tree (8 in, plus the decade of growth since the survey, 1 in): 8.5-10.5 m tall, crown 5-6.5 m across
  const grown = 8 + T.GROWTH_IN;
  assert.equal(T.GROWTH_IN, 1);
  assert.ok(T.treeHeight(grown) > 8.5 && T.treeHeight(grown) < 10.5, `height ${T.treeHeight(grown)}`);
  assert.ok(2 * T.crownRadius(grown) > 5 && 2 * T.crownRadius(grown) < 6.5);
});

test('the group list matches geo/trees.py', () => {
  assert.deepEqual(T.GROUPS, ['other', 'plane', 'oak', 'maple', 'locust', 'linden', 'ornamental', 'elm', 'ginkgo', 'conifer']);
  assert.equal(T.CONIFER, 9);
  for (const g of T.GROUPS) assert.ok(T.SHAPE[g], g);
});

// ------------------------------------------------------------------ census decoding

test('decodeCensus reads quantised points and drops broken ones', () => {
  const c = T.decodeCensus({ q_m: 0.5, source: 'NYC census', date: '2015', pts: [20, 40, 8, 1, -10, 6, 14, 2, 'x', 1, 5, 0, 8, 8, 3, 99, 1, 2, 3] });
  assert.equal(c.n, 3);
  assert.deepEqual([c.x[0], c.y[0], c.dbh[0], c.grp[0]], [10, 20, 8, 1]);
  assert.deepEqual([c.x[1], c.y[1]], [-5, 3]);
  assert.equal(c.grp[2], 0);                            // a group out of range falls back to "other"
  assert.equal(c.source, 'NYC census');
  assert.equal(T.decodeCensus(null), null);
  assert.equal(T.decodeCensus({ pts: [] }), null);
  assert.equal(T.decodeCensus({ pts: 'nope' }), null);
  assert.equal(T.decodeCensus({ q_m: -1, pts: [2, 2, 5, 0] }).x[0], 1);   // a nonsense step falls back to 0.5 m
});

// ------------------------------------------------------------------ Poisson-disc

test('poissonDisc keeps every point inside, away from holes, at least minDist apart, and is deterministic', () => {
  const ring = sq(0, 0, 120, 90), hole = sq(40, 30, 70, 60);
  const a = T.poissonDisc(ring, [hole], { minDist: 8, seed: 5 }), b = T.poissonDisc(ring, [hole], { minDist: 8, seed: 5 });
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, T.poissonDisc(ring, [hole], { minDist: 8, seed: 6 }));
  assert.ok(a.length > 80, `${a.length} points`);
  for (const [x, y] of a) {
    assert.ok(x >= 0 && x <= 120 && y >= 0 && y <= 90);
    assert.ok(!(x > 40 && x < 70 && y > 30 && y < 60), 'not in the hole');
  }
  let min = Infinity;
  for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) min = Math.min(min, Math.hypot(a[i][0] - a[j][0], a[i][1] - a[j][1]));
  assert.ok(min >= 8 - 1e-9, `closest pair ${min}`);
});

test('poissonDisc fills a polygon of separate lobes and honours the limit and the veto', () => {
  const dumbbell = [[0, 0], [30, 0], [30, 10], [90, 10], [90, 0], [120, 0], [120, 30], [90, 30], [90, 20], [30, 20], [30, 30], [0, 30]];
  const p = T.poissonDisc(dumbbell, [], { minDist: 6, seed: 2 });
  assert.ok(p.some(([x]) => x < 25) && p.some(([x]) => x > 95), 'both ends are filled');
  assert.equal(T.poissonDisc(sq(0, 0, 200, 200), [], { minDist: 6, limit: 30 }).length, 30);
  assert.equal(T.poissonDisc(sq(0, 0, 50, 50), [], { minDist: 6, accept: () => false }).length, 0);
  assert.deepEqual(T.poissonDisc([[0, 0], [1, 1]], [], { minDist: 5 }), []);
});

test('Poisson fill gives believable densities per kind and none on hard surfaces', () => {
  const ha = (n, area) => n / (area / 1e4);
  const area = 100 * 100;
  const count = (kind, extra = {}) => T.fillTrees([{ kind, ring: sq(0, 0, 100, 100), holes: [], ...extra }], {}).length;
  const park = ha(count('park'), area), wood = ha(count('wood'), area), grass = ha(count('grass'), area);
  assert.ok(park > 30 && park < 130, `park ${park}/ha`);
  assert.ok(wood > 120 && wood < 330, `wood ${wood}/ha`);
  assert.ok(grass > 8 && grass < 60, `lawn ${grass}/ha`);
  assert.ok(wood > park && park > grass, 'woods are denser than parks, parks than lawns');
  assert.equal(count('park', { hard: true }), 0);
  assert.equal(count('play'), 0);
});

test('fill trees come with a believable trunk and keep to the radius and clear of buildings', () => {
  const polys = [{ kind: 'park', ring: sq(-200, -200, 200, 200), holes: [] }];
  const all = T.fillTrees(polys, { center: [0, 0], radius: 100 });
  assert.ok(all.length > 20 && all.every((t) => Math.hypot(t.x, t.y) <= 100 + 1e-6));
  assert.ok(all.every((t) => t.dbh >= 3 && t.dbh <= 34));
  const med = [...all].map((t) => t.dbh).sort((a, b) => a - b)[all.length >> 1];
  assert.ok(med > 9 && med < 20, `median trunk ${med} in`);
  const veto = T.fillTrees(polys, { center: [0, 0], radius: 100, avoid: (x) => x > 0 });
  assert.ok(veto.length > 0 && veto.every((t) => t.x <= 0));
  assert.equal(T.fillTrees(polys, { limit: 10 }).length, 10);
});

test('footprintIndex finds the point inside a footprint but not in its light court', () => {
  const B = [{ p: [0, 0, 40, 0, 40, 40, 0, 40], bb: [0, 0, 40, 40], holes: [[15, 15, 25, 15, 25, 25, 15, 25]] }, { p: [100, 0, 120, 0, 120, 20, 100, 20], bb: [100, 0, 120, 20], holes: [] }];
  const idx = T.footprintIndex(B);
  assert.ok(idx.hits(5, 5) && idx.hits(110, 10));
  assert.ok(!idx.hits(20, 20), 'a light court is open air');
  assert.ok(!idx.hits(60, 5) && !idx.hits(-5, -5));
  assert.ok(!T.footprintIndex(null).hits(0, 0));
});

// ------------------------------------------------------------------ the plan

const green = (extra = {}) => ({
  polys: [{ kind: 'park', name: 'Test Park', ring: sq(60, 60, 160, 160) }],
  trees: [10, 10, 300, 0],
  census: { q_m: 0.5, source: 'NYC Street Tree Census', date: '2015', pts: [40, 40, 8, 1, 60, 60, 12, 2, 200, 20, 4, 9] },
  ...extra,
});

test('treePlan orders census, mapped and fill trees, sized from the trunk', () => {
  const p = T.treePlan(green(), { center: [0, 0], radius: 500, cap: 5000 });
  assert.equal(p.counts.census, 3);
  assert.equal(p.counts.mapped, 2);
  assert.ok(p.counts.fill > 20 && p.counts.total === p.n);
  const i = [...Array(p.n).keys()].find((k) => p.src[k] === 0 && p.dbh[k] === 8 + T.GROWTH_IN);
  assert.ok(i >= 0, 'a census tree is sized from its trunk plus the growth since 2015');
  assert.ok(Math.abs(p.h[i] - T.treeHeight(8 + T.GROWTH_IN)) < 0.3 * p.h[i], 'height follows the allometry (within the per-tree jitter)');
  assert.equal(p.census.date, '2015');
  for (let k = 1; k < p.n; k++) assert.ok(Math.hypot(p.x[k] - 0, p.y[k]) >= Math.hypot(p.x[k - 1], p.y[k - 1]) - 1e-4, 'nearest first');
});

test('treePlan drops a mapped tree that stands on a census tree, and fill on top of one', () => {
  const g = green({ polys: [], trees: [10.5, 10.5, 150, 150], census: { q_m: 0.5, pts: [21, 21, 8, 1] } });
  const p = T.treePlan(g, { center: [0, 0], radius: 500 });
  assert.equal(p.counts.census, 1);
  assert.equal(p.counts.mapped, 1, 'the mapped tree within 2.5 m of a census tree is the same tree');
});

test('treePlan caps the total, fill first, and keeps trees out of buildings and out of range', () => {
  const g = green({ polys: [{ kind: 'wood', ring: sq(-300, -300, 300, 300) }] });
  const full = T.treePlan(g, { center: [0, 0], radius: 400, cap: 9000 });
  const cut = T.treePlan(g, { center: [0, 0], radius: 400, cap: 200 });
  assert.equal(cut.n, 200);
  assert.equal(cut.counts.census + cut.counts.mapped, full.counts.census + full.counts.mapped, 'the real trees survive the cap');
  assert.equal(cut.counts.total, 200);
  const B = [{ p: [-1000, -1000, 1000, -1000, 1000, 1000, -1000, 1000], bb: [-1000, -1000, 1000, 1000], holes: [] }];
  assert.equal(T.treePlan(g, { center: [0, 0], radius: 400, B }).n, 0, 'every tree would stand inside the one huge building');
  const far = T.treePlan(green(), { center: [5000, 5000], radius: 300 });
  assert.equal(far.n, 0);
  assert.equal(T.treePlan(null).n, 0);
  assert.equal(T.treePlan({ polys: [], trees: [] }).n, 0);
});

test('treePlan is deterministic and fill can be switched off', () => {
  const a = T.treePlan(green(), { radius: 500 }), b = T.treePlan(green(), { radius: 500 });
  assert.deepEqual([...a.x], [...b.x]);
  assert.deepEqual([...a.h], [...b.h]);
  assert.equal(T.treePlan(green(), { radius: 500, fill: false }).counts.fill, 0);
});

test('treeShape gives the same tree every time, narrow for ginkgo and wide for elm, with a clear trunk', () => {
  assert.deepEqual(T.treeShape(10, 20, 10, 3), T.treeShape(10, 20, 10, 3));
  const gi = T.treeShape(10, 20, 10, T.GROUPS.indexOf('ginkgo')), el = T.treeShape(10, 20, 10, T.GROUPS.indexOf('elm'));
  assert.ok(gi.r < el.r && gi.h / gi.r > el.h / el.r);
  for (const dbh of [2, 8, 20, 40]) { const s = T.treeShape(1, 2, dbh, 0); assert.ok(s.bole >= 1 && s.bole < s.h && s.tone >= 0 && s.tone < 1); }
});

// ------------------------------------------------------------------ streets, water, labels

test('sidewalks: wider beside avenues, none on highways, ramps, tunnels and alleys', () => {
  assert.equal(C.sidewalkWidth({ name: '3 Ave', width_m: 21.3 }), 4.6);
  assert.equal(C.sidewalkWidth({ name: 'E 38 St', width_m: 9.8 }), 4);
  assert.equal(C.sidewalkWidth({ name: 'Franklin D Roosevelt Dr', width_m: 9.1 }), 0);
  assert.equal(C.sidewalkWidth({ name: 'Queens Midtown Tunl Exit', width_m: 10.7 }), 0);
  assert.equal(C.sidewalkWidth({ name: 'Alley', width_m: 4.6 }), 0);
  assert.equal(C.sidewalkWidth({ name: 'W 57 St', width_m: 5 }), 0);
  assert.equal(C.sidewalkWidth({ name: 'Main St' }), 4);
});

test('streetStrokes cleans polylines and fills a default roadbed', () => {
  const s = C.streetStrokes([{ name: 'E 38 St', width_m: 9.8, pts: [[0, 0], [10, 0], ['x', 1], [20, 5]] }, { name: 'a', pts: [[0, 0]] }, { name: 'b', pts: [[0, 0], [1, 1]] }, null, { name: 'Wide', width_m: 400, pts: [[0, 0], [5, 5]] }]);
  assert.equal(s.length, 3);
  assert.deepEqual(s[0].pts, [[0, 0], [10, 0], [20, 5]]);
  assert.equal(s[0].road, 9.8); assert.equal(s[0].walk, 4);
  assert.equal(s[1].road, C.DEFAULT_ROAD_M);
  assert.equal(s[2].road, 40);                          // an absurd width is capped
  assert.deepEqual(C.streetStrokes(null), []);
});

test('decodeWater reads quantised rings and drops broken ones', () => {
  const w = C.decodeWater({ q_m: 0.5, half_m: 1600, source: 'NYC hydro', polys: [{ name: 'East River', rings: [[0, 0, 40, 0, 40, 40, 0, 40], [1, 2]] }, { rings: 'x' }, null], labels: [{ name: 'East River', x: 100, y: -50 }, { name: 'x' }] });
  assert.equal(w.half, 1600);
  assert.equal(w.polys.length, 1);
  assert.deepEqual(w.polys[0].rings[0][1], [20, 0]);
  assert.equal(w.polys[0].rings.length, 1);
  assert.deepEqual(w.labels, [{ name: 'East River', x: 100, y: -50 }]);
  assert.equal(C.decodeWater(null), null);
  assert.equal(C.decodeWater({ polys: [] }), null);
  assert.equal(C.decodeWater({ polys: [{ rings: [[1, 2]] }] }), null);
  assert.equal(C.windowHalf({ water: { half_m: 1200 } }), 1200);
  assert.equal(C.windowHalf({}), 800);
});

test('labelPoint sits in the middle of a long thin park, away from its hole', () => {
  const [x, y] = C.labelPoint(sq(0, 0, 400, 40));
  assert.ok(x > 100 && x < 300 && y > 15 && y < 25, `${x}, ${y}`);
  const ring = sq(0, 0, 100, 100), hole = sq(30, 30, 70, 70);
  const p = C.labelPoint(ring, [hole]);
  assert.ok(!(p[0] > 30 && p[0] < 70 && p[1] > 30 && p[1] < 70), 'not inside the courtyard');
});

test('labels: the rivers first, then named parks big enough to read, largest first, never playgrounds', () => {
  const site = {
    water: { q_m: 0.5, polys: [{ name: 'East River', rings: [[0, 0, 40, 0, 40, 40]] }], labels: [{ name: 'East River', x: 400, y: -300 }] },
    green: { polys: [{ kind: 'park', name: 'Big Park', ring: sq(0, 0, 200, 100) }, { kind: 'park', name: 'Tiny', ring: sq(0, 0, 10, 10) }, { kind: 'park', ring: sq(0, 0, 300, 300) }, { kind: 'play', name: 'Swings', ring: sq(0, 0, 200, 200) }, { kind: 'park', name: 'Medium', ring: sq(0, 0, 90, 80) }] },
  };
  const l = C.contextLabels(site);
  assert.deepEqual(l.map((q) => [q.kind, q.name]), [['water', 'East River'], ['park', 'Big Park'], ['park', 'Medium']]);
  assert.deepEqual(C.contextLabels({}), []);
  assert.equal(C.parkLabels(site.green, { max: 1 }).length, 1);
});

// ------------------------------------------------------------------ canvas painters (a recording 2D context)

function recorder() {
  const log = [];
  const g = new Proxy({}, {
    get: (_, k) => (k === 'log' ? log : (...a) => { log.push([k, ...a]); return k === 'createRadialGradient' ? { addColorStop() {} } : undefined; }),
    set: (_, k, v) => { log.push(['set', k, typeof v === 'object' ? 'gradient' : v]); return true; },
  });
  return g;
}

test('windowMap puts north at the top and the window centre at the canvas centre', () => {
  const m = X.windowMap(800, 2048);
  assert.equal(m.X(0), 1024); assert.equal(m.Y(0), 1024);
  assert.equal(m.X(-800), 0); assert.equal(m.Y(800), 0); assert.equal(m.Y(-800), 2048);
});

test('paintPlate: block grey, sidewalk ribbons under roadbeds, quay line, fade, then the water cut out', () => {
  const g = recorder(), colors = { block: '#222222', walk: '#333333', road: '#111111', quay: '#444444' };
  const water = C.decodeWater({ q_m: 0.5, polys: [{ name: 'R', rings: [[0, 0, 400, 0, 400, 400, 0, 400]] }] });
  X.paintPlate(g, { N: 1000, half: 500, colors, streets: [{ name: 'E 38 St', width_m: 10, pts: [[0, 0], [100, 0]] }, { name: 'FDR Dr', width_m: 9, pts: [[0, 50], [100, 50]] }], water, radius: 400 });
  const ops = g.log.map((e) => e[0] + (e[1] === 'globalCompositeOperation' ? ':' + e[2] : ''));
  const lineWidths = g.log.filter((e) => e[0] === 'set' && e[1] === 'lineWidth').map((e) => e[2]);
  assert.deepEqual(lineWidths.slice(0, 3), [(10 + 8) * 1, 10, 9], 'sidewalk ribbon (road + 2 walks), then the two roadbeds; the highway has no ribbon');
  assert.ok(g.log.some((e) => e[0] === 'fillRect'));
  const iSrcAtop = ops.indexOf('set:source-atop'), iCut = ops.indexOf('set:destination-out');
  assert.ok(iSrcAtop > 0 && iCut > iSrcAtop, 'the fade comes before the water is cut out');
  assert.ok(g.log.some((e) => e[0] === 'fill' && e[1] === 'evenodd'));
  assert.deepEqual(g.log.at(-1), ['restore']);
});

test('paintPlate without water or streets still fills the block colour; paintMask is white water on black', () => {
  const g = recorder();
  X.paintPlate(g, { N: 100, half: 50, colors: { block: '#222222', walk: '#333', road: '#111', quay: '#444' }, streets: [], water: null, radius: 30 });
  assert.ok(!g.log.some((e) => e[0] === 'set' && e[2] === 'destination-out'));
  const m = recorder();
  X.paintMask(m, { N: 100, half: 50, water: C.decodeWater({ polys: [{ rings: [[0, 0, 20, 0, 20, 20]] }] }) });
  const fills = m.log.filter((e) => e[0] === 'set' && e[1] === 'fillStyle').map((e) => e[2]);
  assert.deepEqual(fills.slice(0, 2), ['#000', '#fff']);
  const none = recorder(); X.paintMask(none, { N: 10, half: 5, water: null });
  assert.ok(!none.log.some((e) => e[0] === 'fill'));
});

test('withAlpha converts hex and rgb colours', () => {
  assert.equal(X.withAlpha('#ff8000', 0.5), 'rgba(255,128,0,0.5)');
  assert.equal(X.withAlpha('rgb(1, 2, 3)', 1), 'rgba(1,2,3,1)');
  assert.equal(X.withAlpha('red', 1), 'red');
});
