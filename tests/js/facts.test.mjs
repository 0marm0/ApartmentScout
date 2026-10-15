// node --test tests/js : the renter's own numbers for a home's unknowns (dashboard/js/features/facts-model.js). The Python side
// is compared in tests/test_renterfacts_parity.py; here: validation, which unknowns a home has and the score and ranks each
// spans, and what typing a value does, on the committed example's Knox 6B (an unlisted size, two disagreeing prices, a floor
// guessed from the unit number).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { checkValue, normalize, applyFacts, unknownsOf, preview, detect, partSpan, lightWithFloor, overallOf, rankIf, KIND } from '../../dashboard/js/features/facts-model.js';
import { parseDay } from '../../dashboard/js/criteria.js';

const read = (p) => JSON.parse(fs.readFileSync(new URL(p, import.meta.url), 'utf8'));
const LISTINGS = read('../../dashboard/data/listings.json');
const CRIT = read('../../dashboard/data/criteria.json');
const MANIFEST = read('../../dashboard/data/manifest.json');
const DAY = parseDay(CRIT.scoring?.as_of || MANIFEST.generated.slice(0, 10));
const WEIGHTS = { ...CRIT.weights };
for (const L of LISTINGS) L._s = overallOf(L.score.parts, WEIGHTS);
const KNOX = LISTINGS.find((L) => L.id === 'the-knox-6b');
const ctx = (facts = {}) => ({ weights: WEIGHTS, listings: LISTINGS, facts, today: '2026-10-15', day: DAY });
const fact = (v) => ({ value: v, at: '2026-10-15', source: 'renter' });

test('values are checked for their kind', () => {
  assert.equal(checkValue('size', '640'), 640); assert.equal(checkValue('size', '1,050.4'), 1050); assert.equal(checkValue('size', 10), null); assert.equal(checkValue('size', 'big'), null);
  assert.equal(checkValue('fees', '$135.456'), 135.46); assert.equal(checkValue('fees', 0), 0); assert.equal(checkValue('fees', -1), null);
  assert.equal(checkValue('price', 4725), 4725); assert.equal(checkValue('price', 12), null);
  assert.equal(checkValue('wd', true), true); assert.equal(checkValue('wd', 'yes'), null);
  assert.equal(checkValue('floor', 7), 7); assert.equal(checkValue('floor', 6.5), null); assert.equal(checkValue('floor', 0), null);
  assert.equal(checkValue('size', true), null);
  const n = normalize({ size: '640', wd: false, bogus: 1, floor: { value: 9, at: '2026-10-01' } }, '2026-10-15');
  assert.deepEqual(n, { size: { value: 640, at: '2026-10-15', source: 'renter' }, wd: { value: false, at: '2026-10-15', source: 'renter' }, floor: { value: 9, at: '2026-10-01', source: 'renter' } });
  assert.deepEqual(normalize(null), {});
});

test('the Knox 6B has three unknowns that move its score, the biggest first, each with the ranks it could land in', () => {
  const rows = unknownsOf(KNOX, KNOX.score, CRIT, ctx());
  assert.deepEqual(rows.map((r) => r.kind).sort(), ['floor', 'price', 'size']);
  const size = rows.find((r) => r.kind === 'size');
  assert.equal(size.ask, 'Enter the size'); assert.equal(size.state, 'estimated');
  assert.match(size.now, /Estimated at ~562 ft² from the building's other 1-bed units/);
  assert.ok(size.lo < KNOX.score.overall && size.hi > KNOX.score.overall);
  assert.ok(size.rankBest < KNOX.score.ranks.action && size.rankWorst > KNOX.score.ranks.action, `${size.rankBest}-${size.rankWorst} around #${KNOX.score.ranks.action}`);
  const price = rows.find((r) => r.kind === 'price');
  assert.equal(price.state, 'disputed'); assert.match(price.now, /listing price \$4,860 vs .* \$5,038/);
  const widths = rows.map((r) => r.hi - r.lo);
  assert.deepEqual(widths, [...widths].sort((x, y) => y - x), 'sorted by how much each could move it');
  assert.equal(rows.find((r) => r.kind === 'wd'), undefined, 'a washer/dryer that is stated is not an unknown');
});

test('typing a size re-ranks the Knox 6B at once', () => {
  const was = KNOX.score.ranks.action;
  const small = preview(KNOX, KNOX.score, CRIT, 'size', 480, ctx()), big = preview(KNOX, KNOX.score, CRIT, 'size', 800, ctx());
  assert.equal(small.nowRank, was);
  assert.ok(small.rank > was, 'a small home falls further');
  assert.ok(big.rank <= 10 && big.rank < was, `800 ft² puts it back in the top ten (#${big.rank})`);
  assert.ok(big.overall > big.nowOverall);
  assert.equal(preview(KNOX, KNOX.score, CRIT, 'size', 'huge', ctx()), null);
  // the original score and listing are untouched
  assert.equal(KNOX.score.parts.space, 18.7); assert.equal(KNOX.sqft, undefined);
});

test('applying a size replaces the estimate: the part, the range, the flags and the reason', () => {
  const s = applyFacts(KNOX, KNOX.score, CRIT, { size: fact(800) }, DAY);
  assert.equal(s.parts.space, 58.3);
  assert.equal(s.part_ranges.space, undefined, 'a typed size has no range');
  assert.ok(!s.flags.includes('size_imputed') && !s.flags.includes('size_estimated') && s.flags.includes('renter:size'));
  assert.deepEqual(s.renter.size, { value: 800, at: '2026-10-15', source: 'renter' });
  assert.match(s.reasons.find((r) => r.dim === 'space').items[0], /you entered 800 ft²/);
  assert.ok(s.overall > KNOX.score.overall);
  assert.equal(applyFacts(KNOX, s, CRIT, { size: fact(800) }, DAY), s, 'a fact the score already holds is not applied twice');
  const again = applyFacts(KNOX, s, CRIT, { size: fact(900) }, DAY);
  assert.ok(again.parts.space > s.parts.space, 'a changed value replaces the first');
  assert.equal(applyFacts(KNOX, KNOX.score, CRIT, {}, DAY), KNOX.score);
});

test('a confirmed price ends a dispute, and typed fees end the fee estimate', () => {
  const s = applyFacts(KNOX, KNOX.score, CRIT, { price: fact(4725) }, DAY);
  assert.ok(!s.gates.includes('price_dispute') && !s.tags.includes('source conflict') && !s.flags.includes('price_dispute'));
  assert.equal(s.monthly_cost, 4860);   // 4,725 rent + 135 fees
  assert.equal(s.cost.dispute, undefined);
  const noFees = LISTINGS.find((L) => L.score.cost?.fees_known === false && L.score.cost?.fees_estimate && L.score.eligible);
  assert.ok(noFees, 'the example has a home with estimated fees');
  const f = applyFacts(noFees, noFees.score, CRIT, { fees: fact(0) }, DAY);
  assert.ok(!f.gates.includes('unverified:fees') && f.cost.fees_known === true);
  assert.ok(f.monthly_cost <= noFees.score.monthly_cost);
});

test('a washer/dryer answer can leave a home out of the ranking', () => {
  const unknownWd = LISTINGS.find((L) => (L.score.gates || []).some((g) => g.startsWith('unverified:') && g.includes('in_unit_wd')) && L.score.eligible);
  assert.ok(unknownWd);
  const rows = unknownsOf(unknownWd, unknownWd.score, CRIT, ctx());
  const wd = rows.find((r) => r.kind === 'wd');
  assert.ok(wd && wd.dropsOut === true && wd.rankWorst === null);
  const no = preview(unknownWd, unknownWd.score, CRIT, 'wd', false, ctx()), yes = preview(unknownWd, unknownWd.score, CRIT, 'wd', true, ctx());
  assert.equal(no.eligible, false); assert.equal(no.rank, null);
  assert.equal(yes.eligible, true); assert.ok(yes.rank <= unknownWd.score.ranks.action);
});

test('the floor re-scores light & view from what the scorer recorded', () => {
  const h = KNOX.score.light_hint;
  assert.deepEqual([h.rest, h.assumed, h.pv], [53, false, 35]);
  assert.equal(Math.round(lightWithFloor(h, 6) * 10) / 10, KNOX.score.parts.light_view);
  assert.ok(lightWithFloor(h, 30) > lightWithFloor(h, 6));
  assert.equal(lightWithFloor(null, 6), null);
  const s = applyFacts(KNOX, KNOX.score, CRIT, { floor: fact(30) }, DAY);
  assert.ok(s.parts.light_view > KNOX.score.parts.light_view && !s.flags.includes('floor_inferred'));
  assert.equal(detect('floor', { ...KNOX, site: { sun_hours: [3] } }, KNOX.score, CRIT), null, 'a 3D sun study does not read the floor');
});

test('a home with nothing unknown has no rows, and what the renter entered stays as a row', () => {
  const sure = LISTINGS.find((L) => L.score.eligible && !(L.score.flags || []).some((f) => /^(size_|price_|fees_|floor_)/.test(f)) && L.score.cost?.fees_known !== false
    && !(L.score.gates || []).some((g) => g.startsWith('unverified:') && g.includes('in_unit_wd')) && !L.score.light_hint);
  assert.ok(sure);
  assert.deepEqual(unknownsOf(sure, sure.score, CRIT, ctx()), []);
  const s = applyFacts(KNOX, KNOX.score, CRIT, { size: fact(800) }, DAY);
  const rows = unknownsOf({ ...KNOX }, s, CRIT, ctx({ size: fact(800) }));
  const e = rows.find((r) => r.kind === 'size');
  assert.equal(e.state, 'entered'); assert.equal(e.entered.value, 800); assert.equal(e.baked, false);
  assert.equal(unknownsOf(KNOX, s, CRIT, ctx()).find((r) => r.kind === 'size').baked, true, 'a number the scorer already used comes from the score');
  assert.ok(KIND.size.hint && KIND.price.hint);
});

test('ranks among the others', () => {
  const top = LISTINGS.filter((L) => L.score.eligible).sort((a, b) => b._s - a._s)[0];
  assert.equal(rankIf(LISTINGS, 'nobody', top._s + 1), 1);
  assert.equal(rankIf(LISTINGS, 'nobody', -1), LISTINGS.filter((L) => L.score.eligible).length + 1);
  assert.equal(rankIf(LISTINGS, 'x', 50, false), null);
  const span = partSpan('size', KNOX, KNOX.score, CRIT);
  assert.deepEqual([span.lo, span.hi], KNOX.score.part_ranges.space);
});
