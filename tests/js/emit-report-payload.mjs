// Prints the decision-report payload the browser builder makes for some homes, from the committed example data, so that
// tests/test_report.py can compare it with the one apartmentscout/report_doc.py makes. Usage:
//   node tests/js/emit-report-payload.mjs ID,ID,ID [--notes]
import fs from 'node:fs';
import { buildReport, parseSchema } from '../../dashboard/js/features/report-model.js';
import { shareTour, normalize } from '../../dashboard/js/features/findings-model.js';

const read = (p) => JSON.parse(fs.readFileSync(new URL(p, import.meta.url), 'utf8'));
const args = process.argv.slice(2), ids = args[0].split(',');
const template = fs.readFileSync(new URL('../../dashboard/report/report.html', import.meta.url), 'utf8');
const plans = {};
for (const id of ids) { const f = new URL(`../../dashboard/data/plans/${id}.json`, import.meta.url); if (fs.existsSync(f)) plans[id] = JSON.parse(fs.readFileSync(f, 'utf8')); }
const notes = args.includes('--notes');
const picks = { [ids[0]]: { saved: true, tier: 'S', note: 'private pick note', tour: '2026-10-17T10:30' } };
const LISTINGS = read('../../dashboard/data/listings.json'), visit = { observed: '2026-10-14', ceiling: 9, water: 4, note: 'my visit note' };
const extras = { [ids[0]]: { tour: shareTour(LISTINGS.find((x) => x.id === ids[0]), normalize(visit), { notes }) } };
const payload = buildReport({ listings: LISTINGS, crit: read('../../dashboard/data/criteria.json'), ids, picks, includeNotes: notes, plans, extras, generated: '2026-10-15', schema: parseSchema(template) });
process.stdout.write(JSON.stringify(payload));
