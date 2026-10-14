// node --test tests/js : plain-language queries for the command palette (dashboard/js/features/nlquery.js)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseQuery, toFilters, matchesNL, chipsForNL, withoutKeys, bedsLabel, costLabel } from '../../dashboard/js/features/nlquery.js';

const read = (p) => JSON.parse(fs.readFileSync(new URL(p, import.meta.url), 'utf8'));
const LISTINGS = read('../../dashboard/data/listings.json');
const CRIT = read('../../dashboard/data/criteria.json');

const placeSet = new Set();
for (const L of LISTINGS) {
  if (L.neighborhood) placeSet.add(L.neighborhood);
  if (L.building) placeSet.add(L.building);
  if (L.address) placeSet.add(String(L.address).split(',')[0]);
}
const CTX = { destinations: CRIT.commute.destinations, places: [...placeSet] };
const P = (q, ctx = CTX) => parseQuery(q, ctx);
const labels = (q, ctx) => P(q, ctx).chips.map((c) => c.label);

test('the headline example: every part of the sentence becomes a chip', () => {
  const p = P('2 bd under 5k within 20 min by subway with w/d near grand central');
  assert.deepEqual(p.chips.map((c) => c.label), ['2 bd', '≤ $5,000', '≤ 20 min subway to Grand Central', 'W/D']);
  assert.equal(p.rest, '');
  assert.deepEqual(p.unsupported, []);
  assert.equal(p.summary, '2 bd · ≤ $5,000 · ≤ 20 min subway to Grand Central · W/D');
  assert.deepEqual(p.f, { minBeds: 2, maxBeds: 2, minBaths: null, maxCost: 5000, minCost: null, minSqft: null, minFloor: null, maxMinutes: 20, mode: 'subway', dest: 'Grand Central',
    toggles: ['in_unit_wd'], savedOnly: false, priceDrops: false, text: null, sort: null });
});

test('amenities plus a price: "doorman gym under 4800"', () => {
  const p = P('doorman gym under 4800');
  assert.deepEqual(p.chips.map((c) => c.label), ['≤ $4,800', 'Doorman', 'Gym']);
  assert.deepEqual(p.f.toggles, ['doorman', 'gym']);
  assert.equal(p.rest, '');
});

test('starred and price drops are one-word queries', () => {
  assert.deepEqual(labels('starred'), ['Starred']);
  assert.equal(P('starred').f.savedOnly, true);
  assert.deepEqual(labels('price drops'), ['Price drops']);
  assert.equal(P('price drops').f.priceDrops, true);
  assert.equal(P('recently reduced').f.priceDrops, true);
  assert.equal(P('my picks').f.savedOnly, true);
  assert.equal(P('favorites').f.savedOnly, true);
});

test('east of 3rd ave is recognised, not guessed: it is reported as unsupported', () => {
  const p = P('east of 3rd ave');
  assert.equal(p.found, false);
  assert.deepEqual(p.unsupported, ['east of 3rd ave']);
  const q = P('1 bd under 4k west of fifth avenue');
  assert.deepEqual(q.chips.map((c) => c.label), ['1 bd', '≤ $4,000']);
  assert.deepEqual(q.unsupported, ['west of fifth avenue']);
  assert.equal(P('2 bd between 2nd and 3rd ave').unsupported.length, 1);
});

test('bedrooms: counts, words, ranges, plus, studio', () => {
  const f = (q) => P(q).f;
  assert.deepEqual([f('2 bd').minBeds, f('2 bd').maxBeds], [2, 2]);
  assert.deepEqual([f('two bedroom').minBeds, f('two bedroom').maxBeds], [2, 2]);
  assert.deepEqual([f('1br').minBeds, f('1br').maxBeds], [1, 1]);
  assert.deepEqual([f('2+ beds').minBeds, f('2+ beds').maxBeds], [2, null]);
  assert.deepEqual([f('at least 2 bedrooms').minBeds, f('at least 2 bedrooms').maxBeds], [2, null]);
  assert.deepEqual([f('2 bedrooms or more').minBeds, f('2 bedrooms or more').maxBeds], [2, null]);
  assert.deepEqual([f('up to 2 bd').minBeds, f('up to 2 bd').maxBeds], [null, 2]);
  assert.deepEqual([f('1-2 bd').minBeds, f('1-2 bd').maxBeds], [1, 2]);
  assert.deepEqual([f('studio').minBeds, f('studio').maxBeds], [0, 0]);
  assert.deepEqual([f('studio or 1 bd').minBeds, f('studio or 1 bd').maxBeds], [0, 1]);
  assert.equal(labels('studio')[0], 'Studio');
  assert.equal(labels('1-2 bd')[0], '1–2 bd');
  assert.equal(labels('2+ beds')[0], '2+ bd');
  assert.equal(P('2 bd 2 ba').f.minBaths, 2);
});

test('price phrases', () => {
  const max = (q) => P(q).f.maxCost, min = (q) => P(q).f.minCost;
  assert.equal(max('under 5k'), 5000);
  assert.equal(max('under $4,500'), 4500);
  assert.equal(max('below 4.5k'), 4500);
  assert.equal(max('less than $5000'), 5000);
  assert.equal(max('up to 5200'), 5200);
  assert.equal(max('max 4800'), 4800);
  assert.equal(max('no more than $5,000 a month'), 5000);
  assert.equal(max('$4,500 or less'), 4500);
  assert.equal(max('5000 or under'), 5000);
  assert.equal(max('$5k'), 5000);
  assert.equal(max('around 4800'), 4800);
  assert.equal(max('budget 5k'), 5000);
  assert.equal(min('over 3k'), 3000);
  assert.equal(min('at least $3,500'), 3500);
  assert.equal(min('$3000+'), 3000);
  const r = P('between 3k and 4.5k').f;
  assert.deepEqual([r.minCost, r.maxCost], [3000, 4500]);
  const r2 = P('$3,000 - $4,500').f;
  assert.deepEqual([r2.minCost, r2.maxCost], [3000, 4500]);
  const r3 = P('3-4.5k').f;
  assert.deepEqual([r3.minCost, r3.maxCost], [3000, 4500]);
  assert.equal(labels('between 3k and 4.5k')[0], '$3,000–$4,500');
  assert.equal(labels('over 3k')[0], '≥ $3,000');
});

test('numbers that are not rent are left alone', () => {
  assert.equal(P('10019').f.maxCost, null);
  assert.equal(P('under 20 min').f.maxCost, null);
  assert.equal(P('under 20 min').f.maxMinutes, 20);
  assert.equal(P('700 sq ft').f.maxCost, null);
  assert.equal(P('floor 12').f.maxCost, null);
  assert.equal(P('2 bd').f.maxCost, null);
});

test('commute: minutes, modes and destinations', () => {
  assert.equal(P('within 20 min').f.maxMinutes, 20);
  assert.equal(P('20 minutes or less').f.maxMinutes, 20);
  assert.equal(P('a 25-minute commute').f.maxMinutes, 25);
  assert.equal(P('20-30 mins').f.maxMinutes, 30);
  assert.equal(P('3 min').f.maxMinutes, 5, 'the slider starts at 5');
  assert.equal(P('over 20 min').f.maxMinutes, null);
  assert.equal(P('by subway').f.mode, 'subway');
  assert.equal(P('by bus').f.mode, 'bus');
  assert.equal(P('walking distance').f.mode, 'walk');
  assert.equal(P('on the subway').f.mode, 'subway');
  assert.equal(P('public transit').f.mode, 'best');
  assert.deepEqual(labels('by subway'), ['by subway']);
  assert.deepEqual(labels('within 20 min'), ['≤ 20 min']);
  assert.deepEqual(labels('near grand central'), ['Commute to Grand Central']);
  assert.deepEqual(labels('30 min walking to grand central'), ['≤ 30 min walking to Grand Central']);
  assert.equal(P('to grand central terminal').f.dest, 'Grand Central', 'a destination matches with or without a trailing "terminal"');
});

test('a second destination is picked by name', () => {
  const ctx = { destinations: [{ name: 'Grand Central' }, { name: 'Hudson Yards Office' }], places: [] };
  assert.equal(P('within 15 min of hudson yards', ctx).f.dest, 'Hudson Yards Office');
  assert.equal(P('to grand central', ctx).f.dest, 'Grand Central');
});

test('feature switches and their spellings', () => {
  const tg = (q) => P(q).f.toggles;
  assert.deepEqual(tg('w/d'), ['in_unit_wd']);
  assert.deepEqual(tg('W / D'), ['in_unit_wd']);
  assert.deepEqual(tg('washer dryer'), ['in_unit_wd']);
  assert.deepEqual(tg('washer/dryer in unit'), ['in_unit_wd']);
  assert.deepEqual(tg('in-unit laundry'), ['in_unit_wd']);
  assert.deepEqual(tg('door man'), ['doorman']);
  assert.deepEqual(tg('fitness center'), ['gym']);
  assert.deepEqual(tg('elevator building'), ['elevator']);
  assert.deepEqual(tg('dish washer'), ['dishwasher']);
  assert.deepEqual(tg('roof deck'), ['roof_deck']);
  assert.deepEqual(tg('pet friendly'), ['pets']);
  assert.deepEqual(tg('doorman, gym and elevator'), ['doorman', 'gym', 'elevator']);
  assert.deepEqual(tg('gym gym'), ['gym']);
});

test('size and floor', () => {
  assert.equal(P('over 700 sq ft').f.minSqft, 700);
  assert.equal(P('700 sqft+').f.minSqft, 700);
  assert.equal(P('at least 650 ft²').f.minSqft, 650);
  assert.equal(P('800 square feet').f.minSqft, 800);
  assert.equal(P('high floor').f.minFloor, 10);
  assert.equal(P('floor 15+').f.minFloor, 15);
  assert.equal(P('above the 12th floor').f.minFloor, 12);
  assert.equal(P('20th floor or higher').f.minFloor, 20);
  assert.deepEqual(labels('high floor'), ['Floor 10+']);
});

test('sorting words', () => {
  assert.equal(P('cheapest').f.sort, 'cost');
  assert.equal(P('lowest rent').f.sort, 'cost');
  assert.equal(P('closest to grand central').f.sort, 'commute');
  assert.equal(P('shortest commute').f.sort, 'commute');
  assert.equal(P('largest').f.sort, 'size');
  assert.equal(P('best value').f.sort, 'ppsf');
  assert.equal(P('sorted by cheapest').f.sort, 'cost');
  assert.deepEqual(labels('cheapest'), ['Cheapest first']);
});

test('places come from the data and keep the spelling the text filter needs', () => {
  const p = P('doorman in hells kitchen');
  assert.equal(p.f.text, "Hell's Kitchen");
  assert.deepEqual(p.chips.map((c) => c.label), ['Doorman', 'In “Hell’s Kitchen”'.replace('’', "'")]);
  assert.equal(P('near murray hill under 5k').f.text, 'Murray Hill');
  assert.equal(P('upper west side 1 bd').f.text, 'Upper West Side');
  assert.equal(P('emerald green').f.text, 'Emerald Green');
  assert.equal(P('chelsea', { places: ['Chelsea', 'Hell\'s Kitchen'] }).f.text, 'Chelsea');
});

test('words that are not understood are returned, not swallowed', () => {
  const p = P('under 5k with a telescope on the moon');
  assert.equal(p.f.maxCost, 5000);
  assert.match(p.rest, /telescope/);
  assert.match(p.rest, /moon/);
  assert.equal(P('').found, false);
  assert.equal(P('   ').found, false);
  assert.equal(P('hello there').found, false);
  assert.equal(P('hello there').rest, 'hello there');
});

test('plain words and the existing palette commands are not mistaken for filters', () => {
  for (const q of ['compare', 'map', 'light', 'shortlist', 'unit 3d', 'floor plan', 'research', 'records', 'theme', 'export']) assert.equal(P(q).found, false, q);
});

test('casing, punctuation and extra spaces do not matter', () => {
  const a = P('2 BD, UNDER $5K;  W/D !!');
  assert.deepEqual(a.chips.map((c) => c.label), ['2 bd', '≤ $5,000', 'W/D']);
  assert.equal(P('Under  5K').f.maxCost, 5000);
});

test('"within 20" is minutes only with a unit; a bare number is not a commute', () => {
  assert.equal(P('within 20').f.maxMinutes, null);
});

// ------------------------------------------------------------------ toFilters
const BASE = { tiers: [0, 1, 2], status: ['new', 'researching', 'shortlist', 'touring', 'applied'], tierCap: 5450 };

test('toFilters: a query is a whole new search, with defaults for everything it does not name', () => {
  const out = toFilters(P('2 bd under 5k within 20 min by subway with w/d near grand central'), BASE);
  assert.deepEqual(out.filters, { q: '', toggles: ['in_unit_wd'], savedOnly: false, maxCommute: 20, status: BASE.status, tiers: [0, 1, 2], over: false, nl: { minBeds: 2, maxBeds: 2, maxCost: 5000 } });
  assert.deepEqual(out.commute, { mode: 'subway', dest: 'Grand Central' });
  assert.equal(out.sort, null);
});

test('toFilters: a price above every budget tier lifts the tier cap so it does not hide what was asked for', () => {
  assert.equal(toFilters(P('under 6k'), BASE).filters.over, true);
  assert.equal(toFilters(P('under 5k'), BASE).filters.over, false);
  assert.equal(toFilters(P('over 3k'), BASE).filters.over, false);
});

test('toFilters: picks, place text, sort and no commute change', () => {
  const o = toFilters(P('starred cheapest in murray hill'), BASE);
  assert.equal(o.filters.savedOnly, true);
  assert.equal(o.filters.q, 'Murray Hill');
  assert.equal(o.sort, 'cost');
  assert.equal(o.commute, null);
  assert.equal(o.filters.nl, null);
  assert.equal(o.filters.maxCommute, 75);
});

test('toFilters does not share arrays with its inputs', () => {
  const o = toFilters(P('gym'), BASE);
  o.filters.status.push('gone'); o.filters.tiers.push(9);
  assert.equal(BASE.status.length, 5); assert.equal(BASE.tiers.length, 3);
});

// ------------------------------------------------------------------ matchesNL on the real example data
const price = (L) => L.score?.cost?.budget_amount ?? L.score?.monthly_cost;
const count = (nl, extra) => LISTINGS.filter((L) => matchesNL(L, nl, { price, ...extra })).length;

test('matchesNL: no constraints passes everything', () => {
  assert.equal(count(null), LISTINGS.length);
  assert.equal(count({}), LISTINGS.length);
});

test('matchesNL: bedrooms, price and size agree with a hand count', () => {
  const two = LISTINGS.filter((L) => L.beds === 2).length;
  assert.ok(two > 5);
  assert.equal(count({ minBeds: 2, maxBeds: 2 }), two);
  assert.equal(count({ minBeds: 2 }), LISTINGS.filter((L) => L.beds >= 2).length);
  assert.equal(count({ maxCost: 5000 }), LISTINGS.filter((L) => price(L) != null && price(L) <= 5000).length);
  assert.equal(count({ minBeds: 0, maxBeds: 0 }), LISTINGS.filter((L) => L.beds === 0).length);
  assert.equal(count({ minSqft: 700 }), LISTINGS.filter((L) => L.sqft >= 700).length);
  assert.equal(count({ minFloor: 10 }), LISTINGS.filter((L) => L.floor >= 10).length);
});

test('matchesNL: unknown facts fail a filter that asks about them', () => {
  assert.equal(matchesNL({ id: 'x' }, { minBeds: 1 }), false);
  assert.equal(matchesNL({ id: 'x', beds: 1 }, { maxCost: 5000 }, { price: () => null }), false);
  assert.equal(matchesNL({ id: 'x', sqft: null }, { minSqft: 500 }), false);
  assert.equal(matchesNL({ id: 'x' }, { priceDrops: true }), false);
  assert.equal(matchesNL({ id: 'x' }, { priceDrops: true }, { drops: new Set(['x']) }), true);
});

test('matchesNL: the headline example narrows step by step', () => {
  const nl = toFilters(P('2 bd under 5k'), BASE).filters.nl;
  const n = count(nl);
  assert.ok(n <= count({ minBeds: 2, maxBeds: 2 }));
  assert.ok(n <= count({ maxCost: 5000 }));
  assert.equal(n, LISTINGS.filter((L) => L.beds === 2 && price(L) != null && price(L) <= 5000).length);
});

// ------------------------------------------------------------------ chips for applied filters
test('chipsForNL labels each applied constraint and says which keys clearing it removes', () => {
  const c = chipsForNL({ minBeds: 2, maxBeds: 2, maxCost: 5000, minSqft: 700, priceDrops: true });
  assert.deepEqual(c.map((x) => x.label), ['2 bd', '≤ $5,000', '≥ 700 ft²', 'Price drops']);
  assert.deepEqual(c[0].clear, ['minBeds', 'maxBeds']);
  assert.deepEqual(chipsForNL(null), []);
  assert.deepEqual(chipsForNL({}), []);
});

test('withoutKeys drops the named keys and returns null when empty', () => {
  assert.deepEqual(withoutKeys({ minBeds: 2, maxBeds: 2, maxCost: 5000 }, ['minBeds', 'maxBeds']), { maxCost: 5000 });
  assert.equal(withoutKeys({ maxCost: 5000 }, ['maxCost']), null);
  assert.equal(withoutKeys(null, ['x']), null);
});

test('label helpers', () => {
  assert.equal(bedsLabel(null, null), null);
  assert.equal(bedsLabel(0, 0), 'Studio');
  assert.equal(bedsLabel(1, 3), '1–3 bd');
  assert.equal(bedsLabel(null, 2), '≤ 2 bd');
  assert.equal(costLabel(null, null), null);
  assert.equal(costLabel(3000, null), '≥ $3,000');
});
