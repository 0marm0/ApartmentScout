// Prints what the dashboard's facts-model makes of renter-typed values on the committed example listings, as JSON, for
// tests/test_renterfacts_parity.py to compare with apartmentscout/score.py + renterfacts.py. Reads { id: { kind: value } } from the
// file named in argv[2]. Not a test itself (the name does not end in .test.mjs), so `node --test tests/js` skips it.
import fs from 'node:fs';
import { applyFacts } from '../../dashboard/js/features/facts-model.js';
import { parseDay } from '../../dashboard/js/criteria.js';

const read = (p) => JSON.parse(fs.readFileSync(new URL(p, import.meta.url), 'utf8'));
const LISTINGS = read('../../dashboard/data/listings.json');
const CRIT = read('../../dashboard/data/criteria.json');
const MANIFEST = read('../../dashboard/data/manifest.json');
const DAY = parseDay(CRIT.scoring?.as_of || MANIFEST.generated.slice(0, 10));
const cases = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const byId = Object.fromEntries(LISTINGS.map((L) => [L.id, L]));

const out = {};
for (const [id, values] of Object.entries(cases)) {
  const L = byId[id];
  const facts = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, { value: v, at: '2026-10-15', source: 'renter' }]));
  const s = applyFacts(L, L.score, CRIT, facts, DAY);
  out[id] = { parts: s.parts, overall: s.overall, eligible: s.eligible, gates: s.gates, monthly_cost: s.monthly_cost, confidence: s.confidence, range: s.range, renter: Object.keys(s.renter || {}) };
}
process.stdout.write(JSON.stringify(out));
