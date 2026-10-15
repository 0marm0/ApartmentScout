// node --test tests/js : several commute destinations (features/multidest-model.js and its hooks in nlquery.js)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDestLimits, destMinutes, combined, limitLabel, limitsOf, matchesDestLimits } from '../../dashboard/js/features/multidest-model.js';
import { describeNlPlus, chipsForPlus } from '../../dashboard/js/features/nlplus.js';
import { parseQuery, toFilters, matchesNL, chipsForNL, withoutKeys } from '../../dashboard/js/features/nlquery.js';
import { commutePart, modeMinutes } from '../../dashboard/js/criteria.js';

const DESTS = [
  { name: 'Work', lat: 40.7527, lon: -73.9772, max_minutes: 25, weight: 1 },
  { name: 'Partner', lat: 40.7681, lon: -73.9819, max_minutes: 35, weight: 2 },
  { name: 'Gym', lat: 40.7359, lon: -73.9906, max_minutes: 15, weight: 0.5 },
];
const entry = (best, subway, bus = null) => ({ minutes: best, mode: 'transit', route: '', modes: { walk: { minutes: best + 12 }, ...(subway != null ? { subway: { minutes: subway } } : {}), ...(bus != null ? { bus: { minutes: bus } } : {}), transit: { minutes: best } } });
const HOME = { id: 'h', lat: 40.75, lon: -73.98, commute: { Work: entry(18, 22), Partner: entry(40, 44, 55), Gym: entry(9, 11) } };
const crit = { commute: { destinations: DESTS } };
const CTX = { destinations: DESTS, places: [] };
const P = (q, ctx = CTX) => parseQuery(q, ctx);

test('per-destination limits in a sentence', () => {
  const r = parseDestLimits(' within 25 min of work and 30 min of partner ', DESTS);
  assert.deepEqual(r.limits, [{ dest: 'Work', max: 25, mode: null }, { dest: 'Partner', max: 30, mode: null }]);
  assert.equal(r.text.replace(/\s+/g, ' ').trim(), 'and');
  assert.deepEqual(parseDestLimits(' 20 min to work, 40 minutes to the gym ', DESTS).limits.map((x) => [x.dest, x.max]), [['Work', 20], ['Gym', 40]]);
  assert.deepEqual(parseDestLimits(' work within 25 min and partner within 30 min ', DESTS).limits.map((x) => [x.dest, x.max]), [['Work', 25], ['Partner', 30]]);
  assert.deepEqual(parseDestLimits(' 25 min by subway to work and 30 min to partner ', DESTS).limits.map((x) => x.mode), ['subway', 'subway'], 'a mode said once applies to both');
  assert.deepEqual(parseDestLimits(' 20 min walk to work and 30 min walking to partner ', DESTS).limits.map((x) => [x.dest, x.max, x.mode]), [['Work', 20, 'walk'], ['Partner', 30, 'walk']]);
  assert.deepEqual(parseDestLimits(' no more than 3 min to work and 20 mins to partner ', DESTS).limits[0].max, 5, 'the slider starts at 5');
});

test('one destination in the sentence is left to the commute lens', () => {
  assert.equal(parseDestLimits(' within 25 min of work ', DESTS), null);
  assert.equal(parseDestLimits(' within 25 min of work ', [{ name: 'Work' }]), null);
  assert.equal(parseDestLimits(' 25 min and 30 min ', DESTS), null);
  assert.equal(parseDestLimits(' hello ', []), null);
  const one = P('within 25 min of work');
  assert.equal(one.f.dest, 'Work');
  assert.equal(one.f.maxMinutes, 25);
  assert.equal(one.f.limits, undefined);
});

test('parseQuery: a chip per destination, a key per limit, nothing else eaten', () => {
  const p = P('2 bd under 5k within 25 min of work and 30 min of partner with doorman');
  assert.deepEqual(p.chips.map((c) => c.label), ['2 bd', '≤ $5,000', 'Doorman', '≤ 25 min to Work', '≤ 30 min to Partner']);
  assert.equal(p.f.maxMinutes, null, 'the commute lens is untouched');
  assert.equal(p.rest, '');
  const plan = toFilters(p, { tiers: [0], status: ['new'], tierCap: null });
  assert.deepEqual(plan.filters.nl['c:Partner'], { dest: 'Partner', max: 30, mode: null });
  assert.equal(plan.filters.maxCommute, 75);
  assert.equal(plan.commute, null);
  const chips = chipsForNL(plan.filters.nl).filter((c) => c.key.startsWith('c:'));
  assert.deepEqual(chips.map((c) => [c.label, c.clear]), [['≤ 25 min to Work', ['c:Work']], ['≤ 30 min to Partner', ['c:Partner']]]);
  assert.deepEqual(Object.keys(withoutKeys(plan.filters.nl, ['c:Work'])).filter((k) => k.startsWith('c:')), ['c:Partner']);
  assert.equal(limitLabel({ dest: 'Gym', max: 15, mode: 'subway' }), '≤ 15 min subway to Gym');
});

test('limits filter by minutes in their own mode; a home with no minutes is not failed', () => {
  const nl = { 'c:Work': { dest: 'Work', max: 20, mode: null }, 'c:Partner': { dest: 'Partner', max: 45, mode: 'subway' } };
  assert.equal(matchesDestLimits(HOME, nl, DESTS), true, 'Work 18 <= 20, Partner by subway 44 <= 45');
  assert.equal(matchesDestLimits(HOME, { 'c:Partner': { dest: 'Partner', max: 30, mode: null } }, DESTS), false);
  assert.equal(matchesDestLimits(HOME, { 'c:Partner': { dest: 'Partner', max: 40, mode: 'bus' } }, DESTS), false, 'by bus it is 55');
  assert.equal(matchesDestLimits({ ...HOME, commute: { Work: entry(18, 22) } }, { 'c:Partner': { dest: 'Partner', max: 30, mode: null } }, DESTS), true);
  assert.equal(matchesDestLimits(HOME, { 'c:Nowhere': { dest: 'Nowhere', max: 5, mode: null } }, DESTS), true, 'a destination that is gone no longer filters');
  assert.equal(matchesNL(HOME, nl, { dests: DESTS }), true);
  assert.equal(matchesNL(HOME, { 'c:Partner': { dest: 'Partner', max: 30, mode: null } }, { dests: DESTS }), false);
  assert.deepEqual(limitsOf(nl).map((c) => c.dest), ['Work', 'Partner']);
});

test('the combined score is the scorer\'s own weighted commute score', () => {
  const rows = destMinutes(HOME, DESTS, 'best');
  assert.deepEqual(rows.map((r) => [r.name, r.minutes, r.max, r.weight, r.over]), [['Work', 18, 25, 1, false], ['Partner', 40, 35, 2, true], ['Gym', 9, 15, 0.5, false]]);
  const c = combined(rows);
  assert.ok(Math.abs(c.score - commutePart(HOME, crit).value) < 1e-9, `${c.score} vs ${commutePart(HOME, crit).value}`);
  assert.equal(c.used, 3);
  assert.ok(Math.abs(c.weighted - (18 * 1 + 40 * 2 + 9 * 0.5) / 3.5) < 1e-9);
  assert.equal(c.worst, 40);
  // each destination is judged against its own limit
  assert.equal(Math.round(rows[0].score), 78);   // 18 of 25: between half the limit (100) and the limit (50)
  assert.equal(Math.round(rows[1].score), 43);   // 40 of 35: past the limit, towards zero at twice it
  assert.equal(Math.round(rows[2].score), 90);   // 9 of 15
  assert.ok(rows[0].i === 0 && rows[2].i === 2);
});

test('missing minutes are left out of the average, and say so', () => {
  const part = { ...HOME, commute: { Work: entry(18, 22) } };
  const c = combined(destMinutes(part, DESTS, 'best'));
  assert.equal(c.used, 1);
  assert.equal(c.of, 3);
  assert.ok(Math.abs(c.score - commutePart(part, crit).value) < 1e-9);
  assert.deepEqual(combined(destMinutes({ id: 'x', commute: {} }, DESTS.map((d) => ({ ...d, lat: null, lon: null })), 'best')), { score: null, weighted: null, worst: null, used: 0, of: 3 });
  assert.equal(combined(destMinutes(HOME, DESTS.map((d) => ({ ...d, weight: 0 })), 'best')).score, null, 'weight 0 everywhere: no score');
});

test('each mode reads that mode\'s own minutes (never relabelled)', () => {
  assert.deepEqual(destMinutes(HOME, DESTS, 'subway').map((r) => r.minutes), [22, 44, 11]);
  assert.deepEqual(destMinutes(HOME, DESTS, 'bus').map((r) => r.minutes), [null, 55, null]);
  assert.deepEqual(destMinutes(HOME, DESTS, 'walk').map((r) => r.minutes), [30, 52, 21]);
  assert.equal(modeMinutes(HOME, DESTS[1], 'bus'), 55);
});

test('undo names a single place clause or destination limit', () => {
  assert.deepEqual(describeNlPlus(null, { 'c:Work': { dest: 'Work', max: 25, mode: null } }), { label: 'Commute limit: ≤ 25 min to Work', key: 'filters:nl:c:Work' });
  assert.equal(describeNlPlus({ 'c:Work': { dest: 'Work', max: 25 } }, null).label, 'Removed the commute limit to Work');
  assert.equal(describeNlPlus(null, { 'w:a': { label: 'East of 3rd Avenue' } }).label, 'Place filter: East of 3rd Avenue');
  assert.equal(describeNlPlus({ 'w:a': { label: 'East of 3rd Avenue' } }, null).label, 'Removed the place filter: East of 3rd Avenue');
  assert.equal(describeNlPlus(null, { minBeds: 2 }), null);
  assert.equal(describeNlPlus({ 'c:A': { dest: 'A', max: 5 } }, { 'c:B': { dest: 'B', max: 5 } }), null, 'two changes: the generic label');
  assert.deepEqual(chipsForPlus({ minBeds: 2, 'w:x': { label: 'Near the park' }, 'c:Gym': { dest: 'Gym', max: 15, mode: null } }).map((c) => c.label), ['Near the park', '≤ 15 min to Gym']);
});
