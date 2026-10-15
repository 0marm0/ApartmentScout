// Prints the share payload the browser builder makes for a picks file, from the committed example data, so that
// tests/test_share.py can compare it with the one apartmentscout/share.py makes. Usage:
//   node tests/js/emit-share-payload.mjs picks.json [--notes]
import fs from 'node:fs';
import { parseSchema, buildPayload } from '../../dashboard/js/features/share-model.js';
import { shareTour, normalize } from '../../dashboard/js/features/findings-model.js';
import { trailForShare } from '../../dashboard/js/features/decisions-model.js';

const read = (p) => JSON.parse(fs.readFileSync(new URL(p, import.meta.url), 'utf8'));
const args = process.argv.slice(2);
const picksDoc = JSON.parse(fs.readFileSync(args[0], 'utf8'));
const template = fs.readFileSync(new URL('../../dashboard/share/snapshot.html', import.meta.url), 'utf8');
const LISTINGS = read('../../dashboard/data/listings.json');
// visits and the decision trail in the backup (tests/test_tours.py): the same shaping the dashboard does before it builds the page
const notes = args.includes('--notes'), extras = {};
for (const id of Object.keys(picksDoc.picks)) {
  const L = LISTINGS.find((x) => x.id === id), f = picksDoc.findings?.[id];
  const tour = L && f ? shareTour(L, normalize(f), { notes }) : null, trail = trailForShare(picksDoc.history || [], id, { notes });
  if (tour || trail.length) extras[id] = { ...(tour ? { tour } : {}), ...(trail.length ? { trail } : {}) };
}
const payload = buildPayload({
  extras, listings: LISTINGS, crit: read('../../dashboard/data/criteria.json'), picks: picksDoc.picks, weights: picksDoc.weights || null,
  includeNotes: args.includes('--notes'), transit: read('../../dashboard/data/layers/transit-lines.json').features, generated: '2026-10-14', schema: parseSchema(template),
});
process.stdout.write(JSON.stringify(payload));
