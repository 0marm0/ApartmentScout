// node --test tests/js : the New search wizard's pure logic (dashboard/js/wizard-model.js)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  STEPS, TASTE, CITIES, contextOf, blankDraft, draftFromCriteria, draftToCriteria, toCriteriaYAML, dumpYAML, validateDraft,
  tasteWeights, applyTaste, selectPreset, weightShares, weightOverrides, tiersFromTarget, diffAgainst, draftToProfile, cliCommands,
  stepSummary, slugify, addDays, firstError, FALLBACK_DIMS, presetWeights, tasteDim,
} from '../../dashboard/js/wizard-model.js';
import { profileOf, applyProfile, validateProfile } from '../../dashboard/js/criteria.js';

const CRIT = JSON.parse(fs.readFileSync(new URL('../../dashboard/data/criteria.json', import.meta.url), 'utf8'));
const ctx = contextOf();
const TODAY = '2026-10-14';
const good = () => {
  const d = blankDraft(ctx, { today: TODAY });
  d.name = 'Boston 2BR';
  d.destinations[0].address = '1 Main St, Boston';
  return d;
};

test('a new draft starts from the questionnaire defaults', () => {
  const d = blankDraft(ctx, { today: TODAY });
  assert.equal(d.city, 'generic');
  assert.equal(d.move_in.earliest, '2026-10-28');
  assert.equal(d.move_in.latest, '2026-12-13');
  assert.deepEqual(d.budget.tiers, [{ name: 'Target', max: 3000 }, { name: 'Stretch', max: 3300 }]);
  assert.equal(d.budget.hard_max, 3500);
  assert.deepEqual(d.unit, { min_beds: 1, sqft_floor: 450, sqft_good: 700, sqft_great: 1000 });
  assert.deepEqual(d.must_have, ['in_unit_wd']);
  assert.equal(d.preset, 'balanced');
  assert.equal(d.weights.cost, 20);
});

test('the steps follow the intake questionnaire order', () => {
  assert.deepEqual(STEPS.map((s) => s.id), ['basics', 'places', 'money', 'home', 'amenities', 'taste', 'weights']);
  assert.deepEqual(STEPS.find((s) => s.id === 'taste').fields.slice(0, 6), TASTE.map((t) => t.id));
});

test('a complete draft validates; an empty one says what is missing', () => {
  assert.deepEqual(validateDraft(good(), ctx), []);
  const e = validateDraft(blankDraft(ctx, { today: TODAY }), ctx);
  assert.deepEqual(e.map((x) => x.field).sort(), ['dest.0.address', 'name']);
  assert.match(firstError(e, 'name'), /name/i);
});

test('validation covers money, size, dates, places, amenities, ratings and weights', () => {
  const d = good();
  d.move_in.latest = '2026-10-01';
  d.budget.tiers = [{ name: 'A', max: 5000 }, { name: 'A', max: 4000 }];
  d.budget.hard_max = 100;
  d.unit = { min_beds: -1, sqft_floor: 900, sqft_good: 700, sqft_great: 600 };
  d.destinations = [{ ...d.destinations[0], lat: 91, lon: 10, arrive_by: '9am', max_minutes: 0, weight: -1 }, { ...d.destinations[0], name: 'Work', address: 'x', lat: null, lon: null }];
  d.must_have = ['gym']; d.nice_to_have = ['gym'];
  d.building_ratings = [{ name: 'Ritz', rating: 9 }, { name: 'Ritz', rating: 3 }];
  d.weights = Object.fromEntries(Object.keys(d.weights).map((k) => [k, 0]));
  const f = validateDraft(d, ctx).map((x) => x.field);
  for (const need of ['move_in.latest', 'tier.1.name', 'tier.1.max', 'hard_max', 'min_beds', 'sqft_good', 'sqft_great', 'dest.0.lat', 'dest.0.arrive_by', 'dest.0.max_minutes', 'dest.0.weight',
    'dest.1.name', 'gym', 'rating.0.rating', 'rating.1.name', 'weights']) assert.ok(f.includes(need), `${need} in ${f}`);
});

test('the folder name is checked when a search folder will be created', () => {
  const d = good();
  assert.deepEqual(validateDraft(d, ctx, { needFolder: true, existing: [] }), []);
  assert.match(firstError(validateDraft(d, ctx, { needFolder: true, existing: ['boston-2br'] }), 'folder'), /already exists/);
  d.folder = '../etc';
  assert.match(firstError(validateDraft(d, ctx, { needFolder: true }), 'folder'), /lowercase/);
});

test('taste answers set weights; a missing dimension folds into building', () => {
  const taste = { luxury: 3, renovated: 2, appliances: null, view: 1, light: 3, quiet: 0 };
  assert.deepEqual(tasteWeights(taste, ctx), { building: 16 + 6, light_view: 2 + 10, quiet: 0 });
  const withInterior = contextOf({ scoring: { dimensions: [...FALLBACK_DIMS, ['interior', 'Interior']] } });
  assert.deepEqual(tasteWeights(taste, withInterior), { building: 16, interior: 6, light_view: 12, quiet: 0 });
  assert.deepEqual(tasteWeights({}, ctx), {});
  const d = good(); d.taste.quiet = 3;
  assert.equal(applyTaste(d, ctx).weights.quiet, 10);
  assert.equal(d.weights.quiet, 5, 'the draft is not mutated');
});

test('clearing a taste answer puts its dimension back to the preset unless another answer still feeds it', () => {
  let d = good(); d.taste.luxury = 3; d.taste.renovated = 2;          // both feed building here (interior folds in)
  d = applyTaste(d, ctx, ['building']);
  assert.equal(d.weights.building, 22);
  d.taste.renovated = null; d = applyTaste(d, ctx, [tasteDim('renovated', ctx)]);
  assert.equal(d.weights.building, 16, 'luxury still answers for building');
  d.taste.luxury = null; d = applyTaste(d, ctx, [tasteDim('luxury', ctx)]);
  assert.equal(d.weights.building, 10, 'back to the balanced preset');
  assert.equal(tasteDim('view', ctx), 'light_view');
});

test('presets replace the weights, then the taste answers go on top', () => {
  const d = good(); d.taste.quiet = 3;
  const s = selectPreset(d, 'shortest-commute', ctx);
  assert.equal(s.preset, 'shortest-commute');
  assert.equal(s.weights.commute, 40);
  assert.equal(s.weights.quiet, 10);
  assert.deepEqual(weightOverrides(s, ctx), { quiet: 10 });
});

test('the weight list is read from the data', () => {
  const dims = [...FALLBACK_DIMS, ['interior', 'Interior']];
  const c = contextOf({ scoring: { dimensions: dims, presets: { balanced: { label: 'Balanced', weights: { cost: 10, interior: 7 } } } } });
  const d = blankDraft(c, { today: TODAY });
  assert.ok('interior' in d.weights);
  assert.equal(d.weights.interior, 7);
  assert.equal(Object.keys(weightShares(d.weights, c)).length, 11);
  assert.equal(Object.values(weightShares(d.weights, c)).reduce((a, b) => a + b, 0) >= 99, true);
});

test('weight shares are percentages of the total', () => {
  const s = weightShares({ cost: 25, space: 25, commute: 50 }, ctx);
  assert.deepEqual([s.cost, s.space, s.commute, s.quiet], [25, 25, 50, 0]);
  assert.equal(weightShares({}, ctx).cost, 0);
});

test('tiers from a target budget round to $25', () => {
  assert.deepEqual(tiersFromTarget(4000), { tiers: [{ name: 'Target', max: 4000 }, { name: 'Stretch', max: 4400 }], hard_max: 4675 });
});

test('criteria carry only what differs from the preset under weights', () => {
  const d = good();
  assert.equal(draftToCriteria(d, ctx).weights, undefined);
  d.weights.cost = 30;
  assert.deepEqual(draftToCriteria(d, ctx).weights, { cost: 30 });
  assert.deepEqual(draftToCriteria(d, ctx).scoring, { preset: 'balanced' });
});

test('building ratings are written as a map and are optional', () => {
  const d = good();
  assert.equal(draftToCriteria(d, ctx).building_ratings, undefined);
  d.building_ratings = [{ name: 'The Ritz', rating: 4 }, { name: '  ', rating: 2 }];
  assert.deepEqual(draftToCriteria(d, ctx).building_ratings, { 'The Ritz': 4 });
});

test('a new NYC search gets the profile transit feeds; others do not', () => {
  const d = good(); d.city = 'nyc';
  assert.equal(draftToCriteria(d, ctx).commute.transit.feeds.length, 3);
  d.city = 'generic';
  assert.equal(draftToCriteria(d, ctx).commute.transit, undefined);
});

test('the YAML has the template layout and quotes free text', () => {
  let d = blankDraft(ctx, { city: 'nyc', today: TODAY }); d.name = 'Studio: "near" #work'; d.destinations[0].address = '1 Main St, Boston';
  d.taste.quiet = 2; d = applyTaste(d, ctx);
  d.building_ratings = [{ name: 'The "Ritz"', rating: 4 }];
  const y = toCriteriaYAML(d, ctx);
  assert.match(y, /^# ApartmentScout criteria for Studio: "near" #work\./);
  assert.match(y, /\nsearch:\n  name: "Studio: \\"near\\" #work"\n  city: nyc\n  timezone: America\/New_York\n  move_in:\n    earliest: 2026-10-28\n    latest: 2026-12-13\n  map_center: \[40\.7549, -73\.984\]\n  map_zoom: 12\.8\n/);
  assert.match(y, /\nbudget:\n  basis: monthly_cost\n  tiers:\n    - \{name: "Target", max: 3000\}\n    - \{name: "Stretch", max: 3300\}\n  hard_max: 3500\n/);
  assert.match(y, /\nmust_have: \[in_unit_wd\]\nstrongly_prefer: \[dishwasher, elevator\]\nnice_to_have: \[gym, roof_deck, outdoor_space\]\n/);
  assert.match(y, /\n    - name: "Work"\n      address: "1 Main St, Boston"\n      arrive_by: "09:00"\n      max_minutes: 30\n      weight: 1\n/);
  assert.match(y, /\nscoring:\n  preset: balanced\n\nweights:\n  quiet: 6\n/);
  assert.match(y, /\nbuilding_ratings:\n  "The \\"Ritz\\"": 4\n/);
  assert.match(y, /\nfavorites_first: true\n$/);
  assert.match(y, /\ncommute:\n  destinations:\n/);
  assert.match(y, /\n  transit:\n    feeds:\n      - \{name: "NYC Subway", url: "https:\/\/rrgtfsfeeds\.s3/);
});

test('coordinates are written to six places and mode only when it is not best', () => {
  const d = good();
  d.destinations[0] = { ...d.destinations[0], lat: 40.7527263, lon: -73.9772291, mode: 'subway' };
  const y = toCriteriaYAML(d, ctx);
  assert.match(y, /lat: 40\.752726\n      lon: -73\.977229\n/);
  assert.match(y, /mode: subway\n/);
  assert.doesNotMatch(toCriteriaYAML(good(), ctx), /mode:/);
});

test('dumpYAML writes nested data, flow lists and quoted odd keys', () => {
  const y = dumpYAML({ a: 1, b: 'x y', c: [1, 2], d: [{ nm: 'a', u: 'http://x' }, { nm: 'b' }], e: {}, f: [], g: { 'k k': null, h: [[1, 2], [3, 4]] }, date: '2026-11-01' }).join('\n');
  assert.equal(y, ['a: 1', 'b: "x y"', 'c: [1, 2]', 'd:', '  - {nm: a, u: "http://x"}', '  - {nm: b}', 'e: {}', 'f: []', 'g:', '  "k k": null', '  h: [[1, 2], [3, 4]]', 'date: 2026-11-01'].join('\n'));
});

test('editing the open search keeps everything the wizard does not ask about', () => {
  const d = draftFromCriteria(CRIT, contextOf(CRIT));
  const c = draftToCriteria(d, contextOf(CRIT));
  assert.equal(c.search.name, CRIT.search.name);
  assert.deepEqual(c.commute.transit.feeds, CRIT.commute.transit.feeds);
  assert.equal(c.commute.transit.service_date, CRIT.commute.transit.service_date);
  assert.deepEqual(c.budget.tiers, CRIT.budget.tiers);
  assert.deepEqual(c.must_have, CRIT.must_have);
  assert.equal(c.commute.destinations[0].lat, CRIT.commute.destinations[0].lat);
  assert.deepEqual(c.scoring, { preset: 'balanced', stale_days: 21 });
  assert.equal(c.weights, undefined, 'the file already matches the preset');
  assert.deepEqual(validateDraft(d, contextOf(CRIT)), []);
});

test('an unchanged draft differs from the open search by nothing; changes are listed', () => {
  const cx = contextOf(CRIT), d = draftFromCriteria(CRIT, cx);
  assert.deepEqual(diffAgainst(CRIT, d, cx), []);
  d.name = 'Brooklyn 2BR'; d.budget.hard_max = 6000; d.weights.cost = 40; d.building_ratings = [{ name: 'Ritz', rating: 5 }];
  const lines = diffAgainst(CRIT, d, cx);
  assert.ok(lines.some((l) => l.startsWith('Name:')));
  assert.ok(lines.some((l) => l.startsWith('Hard cap')));
  assert.ok(lines.some((l) => l.startsWith('Weights: Cost')));
  assert.ok(lines.some((l) => l.startsWith('Building ratings')));
  assert.deepEqual(diffAgainst({}, d, cx), [], 'nothing to compare against when no search is open');
});

test('a draft converts to the profile the settings sheet and preview use', () => {
  const cx = contextOf(CRIT), d = draftFromCriteria(CRIT, cx);
  assert.deepEqual(draftToProfile(d), profileOf(CRIT));
  assert.deepEqual(validateProfile(draftToProfile(d)), []);
  d.must_have = ['gym']; d.strongly_prefer = []; d.nice_to_have = [];
  const crit = applyProfile(CRIT, draftToProfile(d));
  assert.deepEqual(crit.must_have, ['gym']);
});

test('command lines name the folder, the city and the criteria file', () => {
  const d = good(); d.city = 'nyc';
  const c = cliCommands(d);
  assert.equal(c.path, 'searches/boston-2br');
  assert.equal(c.oneStep[0], 'apartmentscout init searches/boston-2br --city nyc --criteria ~/Downloads/criteria.yaml');
  assert.ok(c.twoStep.includes('cp ~/Downloads/criteria.yaml searches/boston-2br/criteria.yaml'));
  assert.ok(c.then.some((l) => l.startsWith('apartmentscout all --search searches/boston-2br')));
  d.city = 'generic'; d.folder = 'mine';
  assert.equal(cliCommands(d).oneStep[0], 'apartmentscout init searches/mine --criteria ~/Downloads/criteria.yaml');
});

test('step summaries are one short line', () => {
  const d = good();
  assert.equal(stepSummary('basics', d, ctx), 'Boston 2BR · Another city');
  assert.equal(stepSummary('money', d, ctx), '$3,000 / $3,300 · cap $3,500');
  assert.equal(stepSummary('home', d, ctx), '1+ bd · 450-1000 ft²');
  assert.equal(stepSummary('amenities', d, ctx), '1 must · 2 strong · 3 nice');
  assert.equal(stepSummary('taste', d, ctx), 'Not answered yet');
  assert.equal(stepSummary('weights', d, ctx), 'Space 25% · Cost 20%');
});

test('slugs and date arithmetic', () => {
  assert.equal(slugify('Boston 2BR, fall!'), 'boston-2br-fall');
  assert.equal(slugify('   '), 'search');
  assert.equal(slugify('x'.repeat(100)).length, 60);
  assert.equal(addDays('2026-12-25', 10), '2027-01-04');
});

test('the NYC profile copy matches the preset helpers', () => {
  assert.equal(CITIES.find((c) => c.id === 'nyc').feeds.length, 3);
  assert.equal(presetWeights(ctx, 'nope').cost, 20, 'an unknown preset falls back to balanced');
});
