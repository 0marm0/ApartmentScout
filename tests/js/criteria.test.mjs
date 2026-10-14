// node --test tests/js : browser re-evaluation of edited criteria (dashboard/js/criteria.js) and commute mode selection
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  parseDay, budgetAmount, budgetTier, scoreCost, evaluate, profileOf, applyProfile, validateProfile, diffProfile, toYAML,
  amenitiesPart, movePart, modeMinutes, commuteLayerKey, modeOptions, previewImpact, serverSteps, cashFlow, amenityKeys, walkRingMetres, walkEstimate,
} from '../../dashboard/js/criteria.js';

const read = (p) => JSON.parse(fs.readFileSync(new URL(p, import.meta.url), 'utf8'));
const LISTINGS = read('../../dashboard/data/listings.json');
const CRIT = read('../../dashboard/data/criteria.json');
const MANIFEST = read('../../dashboard/data/manifest.json');
const TODAY = parseDay(CRIT.scoring?.as_of || MANIFEST.generated.slice(0, 10));
const close = (a, b, eps = 0.15) => (a == null ? b == null : b != null && Math.abs(a - b) <= eps);

test('unchanged criteria reproduce the scorer: tiers, gates, eligibility and the criteria-driven parts', () => {
  let n = 0;
  for (const L of LISTINGS) {
    const { score: s } = evaluate(L, L.score, CRIT, TODAY);
    assert.equal(s.budget_tier, L.score.budget_tier, `${L.id} tier`);
    assert.deepEqual(s.gates, L.score.gates, `${L.id} gates`);
    assert.equal(s.eligible, L.score.eligible, `${L.id} eligible`);
    for (const k of ['cost', 'amenities', 'move_date', 'commute', 'space']) assert.ok(close(s.parts[k], L.score.parts[k]), `${L.id} ${k}: ${s.parts[k]} vs ${L.score.parts[k]}`);
    assert.ok(close(s.overall, L.score.overall, 0.25), `${L.id} overall ${s.overall} vs ${L.score.overall}`);
    assert.equal(s.confidence, L.score.confidence, `${L.id} confidence`);
    n++;
  }
  assert.ok(n > 500);
});

test('the input score is never mutated', () => {
  const L = LISTINGS[0], before = JSON.stringify(L.score);
  const crit = applyProfile(CRIT, { ...profileOf(CRIT), must_have: ['gym'] });
  evaluate(L, L.score, crit, TODAY);
  assert.equal(JSON.stringify(L.score), before);
});

test('budget basis picks monthly cost, net or gross', () => {
  const c = { monthly: 5073.64, paid_month: 5435, rent: { net: 4938.64, gross: 5300 } };
  assert.equal(budgetAmount(c, 'monthly_cost'), 5073.64);
  assert.equal(budgetAmount(c, 'net'), 4938.64);
  assert.equal(budgetAmount(c, 'gross'), 5435);
  assert.equal(budgetAmount({ monthly: 5000 }, 'gross'), 5000, 'falls back to monthly when the paid month is unknown');
  assert.equal(budgetAmount({}, 'net'), null);
});

test('budget tiers, hard cap and the cost curve follow the scorer', () => {
  const b = { tiers: [{ name: 'Target', max: 5000 }, { name: 'Stretch', max: 5200 }], hard_max: 5450 };
  assert.equal(budgetTier(4999, b), 'Target');
  assert.equal(budgetTier(5200, b), 'Stretch');
  assert.equal(budgetTier(5300, b), 'Above Stretch');
  assert.equal(budgetTier(5500, b), 'Over budget');
  assert.equal(budgetTier(null, b), null);
  assert.equal(scoreCost(4000, b), 100);
  assert.equal(scoreCost(5000, b), 85);
  assert.equal(scoreCost(5450, b), 35);
  assert.ok(scoreCost(6500, b) < 5);
});

test('a lower hard cap makes listings over budget and ineligible', () => {
  const p = profileOf(CRIT);
  p.budget.tiers = [{ name: 'Target', max: 4500 }]; p.budget.hard_max = 4600;
  const crit = applyProfile(CRIT, p);
  const L = LISTINGS.find((x) => x.score.eligible && x.score.monthly_cost > 4700 && x.score.cost.monthly === x.score.monthly_cost);
  const { score: s } = evaluate(L, L.score, crit, TODAY);
  assert.equal(s.budget_tier, 'Over budget');
  assert.equal(s.gates[0], 'over_budget');
  assert.equal(s.eligible, false);
  assert.ok(s.parts.cost < L.score.parts.cost);
});

test('must-haves: unknown is unverified (still eligible), false fails', () => {
  const crit = { must_have: ['gym', 'in_unit_wd'], strongly_prefer: [], nice_to_have: [] };
  const noGym = amenitiesPart({ amenities: { gym: false, in_unit_wd: true } }, crit);
  assert.deepEqual(noGym.fails, ['gym']);
  const unk = amenitiesPart({ amenities: { gym: true } }, crit);
  assert.deepEqual(unk.unknown, ['in_unit_wd']);
  assert.deepEqual(unk.fails, []);
  const door = amenitiesPart({ amenities: { doorman: 'none' } }, { must_have: ['doorman'] });
  assert.deepEqual(door.fails, ['doorman']);
  const waived = amenitiesPart({ amenities: { gym: true, in_unit_wd: false }, waived_must_have: ['in_unit_wd'] }, crit);
  assert.deepEqual(waived.fails, []);

  const p = profileOf(CRIT); p.must_have = ['in_unit_wd', 'elevator', 'gym']; p.strongly_prefer = ['doorman'];
  const c2 = applyProfile(CRIT, p);
  const L = LISTINGS.find((x) => x.amenities?.gym === false && x.score.eligible);
  const { score: s } = evaluate(L, L.score, c2, TODAY);
  assert.ok(s.gates.some((g) => g.startsWith('fails:') && g.includes('gym')));
  assert.equal(s.eligible, false);
  const U = LISTINGS.find((x) => x.amenities?.gym == null && x.score.eligible);
  const r = evaluate(U, U.score, c2, TODAY).score;
  assert.ok(r.gates.some((g) => g.startsWith('unverified:') && g.includes('gym')));
  assert.equal(r.eligible, true);
});

test('move-in window: late is a warning, a hard window fails; "Now" is today', () => {
  const crit = { search: { move_in: { earliest: '2026-10-15', latest: '2026-11-01' } } };
  const today = parseDay('2026-10-13');
  assert.equal(movePart({ available: '2026-10-20' }, crit, today).value, 100);
  assert.equal(movePart({ available: 'Now' }, crit, today).value, 100);
  const late = movePart({ available: '2026-11-20' }, crit, today);
  assert.equal(late.gate, 'move_date:after_window');
  const hard = movePart({ available: '11/20/2026' }, { search: { move_in: { ...crit.search.move_in, hard: true } } }, today);
  assert.equal(hard.gate, 'fails:move_date');
  assert.equal(movePart({ available: 'Lease starts soon' }, crit, today).value, null);
  assert.equal(parseDay('2026-02-30'), null);
});

test('profile round-trip, validation, diff and YAML export', () => {
  const p = profileOf(CRIT);
  assert.deepEqual(validateProfile(p), []);
  const same = applyProfile(CRIT, p);
  assert.equal(same.commute.destinations[0]._stale, undefined, 'an unchanged destination is not stale');
  assert.deepEqual(diffProfile(p, p), []);
  const bad = structuredClone(p);
  bad.budget.tiers[1].max = 100; bad.unit.sqft_good = 2000; bad.destinations.push({ name: '', address: '', lat: null, lon: null, max_minutes: 0, weight: 1 });
  const errs = validateProfile(bad);
  assert.ok(errs.some((e) => /tiers must rise/.test(e)));
  assert.ok(errs.some((e) => /Size targets/.test(e)));
  assert.ok(errs.some((e) => /needs a name/.test(e)));
  const q = structuredClone(p);
  q.destinations.push({ name: 'Gym', address: '', lat: 40.76, lon: -73.98, arrive_by: '18:30', max_minutes: 20, weight: 0.5, mode: 'walk' });
  q.budget.basis = 'net';
  const d = diffProfile(p, q);
  assert.ok(d.some((x) => x.includes('New destination: Gym')));
  assert.ok(d.some((x) => x.includes('Budget basis')));
  const c = applyProfile(CRIT, q);
  assert.equal(c.commute.destinations[1]._stale, true);
  assert.equal(c.commute.transit.walk_speed_kmh, CRIT.commute.transit.walk_speed_kmh, 'transit settings survive');
  const y = toYAML(q, 'Test');
  assert.match(y, /basis: net/);
  assert.match(y, /- name: "Gym"/);
  assert.match(y, /lat: 40\.760000/);
  assert.match(y, /mode: walk/);
  assert.match(y, /must_have: \[in_unit_wd, elevator\]/);
  assert.match(y, /apartmentscout score && apartmentscout build/);
  assert.ok(!/_stale/.test(y));
});

test('a moved destination drops its stored minutes and surfaces until the router reruns', () => {
  const p = profileOf(CRIT);
  p.destinations[0].lat += 0.01;
  const crit = applyProfile(CRIT, p), d = crit.commute.destinations[0];
  const L = LISTINGS[0];
  assert.equal(modeMinutes(L, d, 'best'), null);
  assert.ok(modeMinutes(L, d, 'walk') > 0, 'walking is still estimated from distance');
  const { score: s } = evaluate(L, L.score, crit, TODAY);
  assert.equal(s.parts.commute, null);
  const steps = serverSteps(CRIT, crit, previewImpact(LISTINGS.slice(0, 20), crit, TODAY));
  assert.ok(steps.some((x) => x.cmd === 'apartmentscout commute && apartmentscout score && apartmentscout build'));
  const layers = { 'commute-office': { rows: 1, kind: 'commute', name: 'Office', destination: CRIT.commute.destinations[0] } };
  assert.equal(commuteLayerKey(layers, d, 'best'), null, 'the old surface is not shown for the moved spot');
});

test('commute modes: best, subway, bus and walk read the router, and bus is never a relabelled transit time', () => {
  const d = CRIT.commute.destinations[0];
  const L = LISTINGS.find((x) => x.commute?.[d.name]?.modes?.bus);
  const m = L.commute[d.name];
  assert.equal(modeMinutes(L, d, 'best'), m.minutes);
  assert.equal(modeMinutes(L, d, 'subway'), m.modes.subway.minutes);
  assert.equal(modeMinutes(L, d, 'bus'), m.modes.bus.minutes);
  assert.equal(modeMinutes(L, d, 'walk'), m.modes.walk.minutes);
  const legacy = { lat: 40.75, lon: -73.98, commute: { [d.name]: { minutes: 21, mode: 'transit', route: 'walk 5 min to X → 6 to Y' } } };
  assert.equal(modeMinutes(legacy, d, 'subway'), 21);
  assert.equal(modeMinutes(legacy, d, 'bus'), null);
  assert.ok(Math.abs(modeMinutes(legacy, d, 'walk') - walkEstimate(legacy, d)) < 1e-9);
  const walker = { lat: 40.752, lon: -73.975, commute: { [d.name]: { minutes: 3, mode: 'walk' } } };
  assert.equal(modeMinutes(walker, d, 'walk'), 3);
  assert.equal(modeMinutes(walker, d, 'subway'), null);
  assert.ok(Math.abs(walkRingMetres(10) - 640) < 1e-9);
});

test('mode layers: best / subway / bus surfaces by destination; walk has none; missing bus grid is not faked', () => {
  const d = CRIT.commute.destinations[0];
  const g = (kind, mode) => ({ rows: 2, cols: 2, kind, mode, name: d.name, destination: { name: d.name, lat: d.lat, lon: d.lon } });
  const layers = { 'commute-office': g('commute', 'transit'), 'commute-office-subway': g('commute-mode', 'subway'), 'commute-office-bus': g('commute-mode', 'bus') };
  assert.equal(commuteLayerKey(layers, d, 'best'), 'commute-office');
  assert.equal(commuteLayerKey(layers, d, 'subway'), 'commute-office-subway');
  assert.equal(commuteLayerKey(layers, d, 'bus'), 'commute-office-bus');
  assert.equal(commuteLayerKey(layers, d, 'walk'), null);
  delete layers['commute-office-bus'];
  assert.equal(commuteLayerKey(layers, d, 'bus'), null);
  const noBus = [{ commute: { [d.name]: { minutes: 20, modes: { subway: { minutes: 20 } } } } }];
  const opts = Object.fromEntries(modeOptions(layers, noBus, d).map((o) => [o.mode, o]));
  assert.equal(opts.bus.enabled, false);
  assert.equal(opts.walk.layer, null);
  assert.equal(opts.walk.enabled, true);
  assert.equal(commuteLayerKey(layers, { name: 'Gym', lat: 40.7, lon: -74 }, 'best'), null);
});

test('preview impact counts what moved', () => {
  const p = profileOf(CRIT); p.must_have = [...p.must_have, 'gym'];
  const crit = applyProfile(CRIT, p);
  const im = previewImpact(LISTINGS, crit, TODAY);
  assert.ok(im.lost.length > 0);
  assert.equal(im.eligibleBefore - im.lost.length + im.gained.length, im.eligibleAfter);
  const same = previewImpact(LISTINGS, applyProfile(CRIT, profileOf(CRIT)), TODAY);
  assert.equal(same.lost.length + same.gained.length, 0);
});

test('cash flow keeps recurring, signing and lease totals apart and lists unknowns', () => {
  const L = LISTINGS.find((x) => x.id === 'the-horizon-35d');
  const f = cashFlow(L);
  assert.equal(f.monthly.fees, null, 'unknown monthly fees stay unknown');
  assert.equal(f.signing.total, L.score.cost.move_in_min);
  assert.ok(f.signing.lines.some(([t, v]) => /Amenity/.test(t) && v === 2085));
  assert.ok(f.signing.unknown.includes('deposit'));
  assert.equal(f.lease.assumed, true);
  assert.equal(f.lease.total, Math.round(L.score.cost.monthly * 12));
  const K = LISTINGS.find((x) => x.score.cost.fees_known && x.score.cost.rent.lease_months);
  const k = cashFlow(K);
  assert.equal(k.lease.assumed, false);
  assert.ok(k.monthly.fees != null);
});

test('amenity keys come from the data and the criteria', () => {
  const keys = amenityKeys(LISTINGS, CRIT).map((x) => x.k);
  for (const k of ['in_unit_wd', 'elevator', 'doorman', 'gym', 'pool', 'game_room']) assert.ok(keys.includes(k), k);
});
