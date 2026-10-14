// Prints what the wizard model produces as JSON, for tests/test_wizard_parity.py to compare with the Python side.
// Not a test itself (the name does not end in .test.mjs), so `node --test tests/js` skips it.
import fs from 'node:fs';
import {
  STEPS, TASTE, CITIES, AMENITIES, FALLBACK_DIMS, FALLBACK_PRESETS, SIZE_PRESETS, contextOf, blankDraft, draftFromCriteria, draftToCriteria,
  toCriteriaYAML, applyTaste, selectPreset,
} from '../../dashboard/js/wizard-model.js';

const CRIT = JSON.parse(fs.readFileSync(new URL('../../dashboard/data/criteria.json', import.meta.url), 'utf8'));
const ctx = contextOf();
const TODAY = '2026-10-14';
const cases = [];
const add = (name, d, c = ctx) => cases.push({ name, criteria: draftToCriteria(d, c), yaml: toCriteriaYAML(d, c) });

let d = blankDraft(ctx, { today: TODAY });
d.name = 'Minimal'; d.destinations[0].address = '1 Main St';
add('minimal', d);

d = blankDraft(ctx, { city: 'nyc', today: TODAY });
d.name = 'Studio: "near" #work, 2BR'; d.timezone = 'America/New_York'; d.move_in.hard = true;
d.destinations = [
  { name: 'Grand Central', address: 'Grand Central Terminal, 89 E 42nd St', lat: 40.7527263, lon: -73.9772291, arrive_by: '08:30', max_minutes: 25, weight: 1.5, mode: 'subway' },
  { name: 'Gym', address: '', lat: 40.74, lon: -73.99, arrive_by: '', max_minutes: 15, weight: 0.5, mode: 'walk' },
];
d.budget = { basis: 'net', tiers: [{ name: 'Target', max: 4000 }, { name: 'Stretch', max: 4400 }, { name: 'Slightly over', max: 4600 }], hard_max: 4675 };
d.unit = { min_beds: 0, sqft_floor: 300, sqft_good: 450, sqft_great: 600 };
d.must_have = ['in_unit_wd', 'elevator']; d.strongly_prefer = ['doorman']; d.nice_to_have = [];
d.taste = { luxury: 3, renovated: 2, appliances: 1, view: null, light: 2, quiet: 0 };
d = selectPreset(d, 'shortest-commute', ctx);
d.building_ratings = [{ name: 'The "Ritz" Tower', rating: 4 }, { name: 'Old Brick', rating: 2 }];
add('nyc-full', d);

d = applyTaste(d, contextOf({ scoring: { dimensions: [...FALLBACK_DIMS, ['interior', 'Interior']] } }));
d.weights.interior = 9;
add('with-interior', d, contextOf({ scoring: { dimensions: [...FALLBACK_DIMS, ['interior', 'Interior']] }, search: {} }));

const cx = contextOf(CRIT);
d = draftFromCriteria(CRIT, cx);
d.weights.cost = 33;
add('edit-existing', d, cx);

d = blankDraft(ctx, { today: TODAY });
d.name = 'No destinations'; d.destinations = []; d.budget.hard_max = ''; d.move_in = { earliest: '', latest: '', hard: false };
add('no-destinations', d);

console.log(JSON.stringify({
  steps: STEPS.map((s) => ({ id: s.id, fields: s.fields })),
  taste: TASTE, cities: CITIES, amenities: AMENITIES, dims: FALLBACK_DIMS, presets: FALLBACK_PRESETS, sizePresets: SIZE_PRESETS,
  defaults: (() => { const b = blankDraft(ctx, { today: TODAY }); return { budget: b.budget, unit: b.unit, must_have: b.must_have, strongly_prefer: b.strongly_prefer, nice_to_have: b.nice_to_have, preset: b.preset, move_in: b.move_in, dest: b.destinations[0] }; })(),
  cases,
}));
