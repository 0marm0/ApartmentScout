// node --test tests/js : the worker's scoring (dashboard/js/features/rescore-core.js) must give exactly the numbers
// and ranks that rescore() in app.js gives. The reference below is that function's body, lifted unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { packScores, packWeights, scoreAll, applyScores, workerSource } from '../../dashboard/js/features/rescore-core.js';

const read = (p) => JSON.parse(fs.readFileSync(new URL(p, import.meta.url), 'utf8'));
const LISTINGS = read('../../dashboard/data/listings.json');
const CRIT = read('../../dashboard/data/criteria.json');
const DIMS = (CRIT.scoring?.dimensions || []).map((d) => (Array.isArray(d) ? d : [d.key, d.label]));
const DIM_KEYS = DIMS.map(([k]) => k);

const cost = (L) => L.score?.monthly_cost;
/** rescore() from dashboard/js/app.js, with S and DIMS passed in. */
function reference(listings, weights, dims, crit) {
  const W = weights, tot = Object.values(W).reduce((a, b) => a + b, 0) || 1;
  for (const L of listings) {
    const p = L.score?.parts || {};
    L._s = p && Object.keys(p).length ? dims.reduce((a, [k]) => a + (W[k] || 0) * (p[k] ?? 50), 0) / tot : L.score?.overall;
  }
  const cmp = (a, b) => (b._s ?? -1) - (a._s ?? -1) || (b.score?.confidence ?? 0) - (a.score?.confidence ?? 0) || (cost(a) ?? 1e9) - (cost(b) ?? 1e9) || (a.id < b.id ? -1 : 1);
  const cap = crit.budget?.tiers?.[0]?.max ?? Infinity;
  for (const L of listings) L._ranks = {};
  listings.filter((L) => L._s != null).sort(cmp).forEach((L, i) => (L._ranks.fit = i + 1));
  const act = listings.filter((L) => L.score?.eligible).sort(cmp);
  act.forEach((L, i) => (L._ranks.action = i + 1));
  act.filter((L) => (L.score?.cost?.budget_amount ?? cost(L) ?? Infinity) <= cap).forEach((L, i) => (L._ranks.budget = i + 1));
  const seen = new Map();
  for (const L of act) { const k = (L.building || L.address || L.id).toLowerCase(); if (!seen.has(k)) seen.set(k, seen.size + 1); L._ranks.building = seen.get(k); }
  for (const L of listings) L._rank = L._ranks.action ?? null;
}

const clone = (a) => a.map((L) => ({ ...L }));
function viaCore(listings, weights, dims, crit) {
  const keys = dims.map(([k]) => k), d = packScores(listings, keys), { wv, tot } = packWeights(weights, keys);
  applyScores(listings, d.hasParts, scoreAll(d, wv, tot, crit.budget?.tiers?.[0]?.max ?? Infinity));
}
function same(a, b, label) {
  for (let i = 0; i < a.length; i++) {
    assert.ok(Object.is(a[i]._s, b[i]._s) || (a[i]._s == null && b[i]._s == null), `${label} ${a[i].id} _s ${a[i]._s} vs ${b[i]._s}`);
    assert.deepEqual(a[i]._ranks, b[i]._ranks, `${label} ${a[i].id} ranks`);
    assert.equal(a[i]._rank, b[i]._rank, `${label} ${a[i].id} _rank`);
  }
}
let seed = 7;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

test('the example data has dimensions and listings to test against', () => {
  assert.ok(LISTINGS.length > 500);
  assert.ok(DIM_KEYS.length >= 6, DIM_KEYS.join());
});

test('worker scoring matches rescore() for the criteria weights and 40 random weight sets', () => {
  const sets = [{ ...CRIT.weights }];
  for (let r = 0; r < 40; r++) sets.push(Object.fromEntries(DIM_KEYS.map((k) => [k, Math.round(rnd() * 40)])));
  for (const [i, W] of sets.entries()) {
    const a = clone(LISTINGS), b = clone(LISTINGS);
    reference(a, W, DIMS, CRIT); viaCore(b, W, DIMS, CRIT);
    same(a, b, `set ${i}`);
  }
});

test('all-zero weights, one weight only and weights for keys outside the dimension list', () => {
  const zero = Object.fromEntries(DIM_KEYS.map((k) => [k, 0]));
  const one = { ...zero, commute: 40 };
  const extra = { ...CRIT.weights, mystery: 12 };   // counts toward the total, like rescore()
  for (const [name, W] of [['zero', zero], ['one', one], ['extra', extra]]) {
    const a = clone(LISTINGS), b = clone(LISTINGS);
    reference(a, W, DIMS, CRIT); viaCore(b, W, DIMS, CRIT);
    same(a, b, name);
  }
});

test('missing parts, scores and ties follow the same rules', () => {
  const L = [
    { id: 'b', building: 'Tower', score: { parts: { cost: 70, space: 50 }, overall: 61, eligible: true, confidence: 80, monthly_cost: 4000 } },
    { id: 'a', building: 'tower', score: { parts: { cost: 70, space: 50 }, overall: 61, eligible: true, confidence: 80, monthly_cost: 4000 } },   // full tie: id decides
    { id: 'c', building: 'Other', score: { parts: {}, overall: 55, eligible: true, confidence: 10, monthly_cost: null } },                        // no parts: overall
    { id: 'd', address: '1 Main', score: { parts: null, overall: null, eligible: false } },                                                       // no score at all
    { id: 'e', building: 'Other', score: { parts: { cost: null, space: 90 }, eligible: true, confidence: 80, monthly_cost: 4000 } },              // null part counts as 50
    { id: 'f' },
    { id: 'g', building: 'Z', score: { parts: { cost: 70, space: 50 }, eligible: true, confidence: 90, monthly_cost: 3000, cost: { budget_amount: 9999 } } },
  ];
  const dims = [['cost', 'Cost'], ['space', 'Space']];
  for (const W of [{ cost: 10, space: 10 }, { cost: 0, space: 0 }, { cost: 3, space: 30 }]) {
    for (const crit of [{ budget: { tiers: [{ max: 4200 }] } }, {}]) {
      const a = clone(L), b = clone(L);
      reference(a, W, dims, crit); viaCore(b, W, dims, crit);
      same(a, b, JSON.stringify(W) + JSON.stringify(crit));
    }
  }
  const a = clone(L); viaCore(a, { cost: 10, space: 10 }, dims, {});
  assert.equal(a.find((x) => x.id === 'a')._rank < a.find((x) => x.id === 'b')._rank, true, 'ties break on id');
  assert.equal(a.find((x) => x.id === 'f')._rank, null);
});

test('the worker source is a valid script that scores like the function it was built from', () => {
  const src = workerSource();
  const posted = [];
  const scope = {};
  new Function('self', 'postMessage', `${src}\nself.onmessage = onmessage;`)(scope, (m) => posted.push(m));
  const L = clone(LISTINGS), keys = DIM_KEYS, d = packScores(L, keys), { wv, tot } = packWeights(CRIT.weights, keys);
  scope.onmessage({ data: { t: 'data', d, v: 1 } });
  scope.onmessage({ data: { t: 'score', seq: 3, v: 1, w: wv, tot, cap: 5000 } });
  assert.equal(posted[0].t, 'ready');
  assert.equal(posted[1].t, 'result');
  assert.equal(posted[1].seq, 3);
  const direct = scoreAll(d, wv, tot, 5000);
  for (const k of ['s', 'fit', 'action', 'budget', 'building']) assert.deepEqual(Array.from(posted[1].out[k], (x) => (Number.isNaN(x) ? 'nan' : x)), Array.from(direct[k], (x) => (Number.isNaN(x) ? 'nan' : x)), k);
});
