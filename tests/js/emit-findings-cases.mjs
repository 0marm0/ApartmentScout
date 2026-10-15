// Prints what the dashboard's tour-findings and decision-trail models make of tests/fixtures/tour-cases.json (and of
// generated findings on the committed example listings), as JSON, for tests/test_tours.py to compare with
// apartmentscout/tours.py. Not a test itself (the name does not end in .test.mjs), so `node --test tests/js` skips it.
import fs from 'node:fs';
import { normalize, flagsFor, overlay, shareTour, claimOf, assess, annotateScore, CHECK_KEYS, listedValue } from '../../dashboard/js/features/findings-model.js';
import { clean, trailForShare } from '../../dashboard/js/features/decisions-model.js';
import { evaluate, parseDay, spacePart } from '../../dashboard/js/criteria.js';

const read = (p) => JSON.parse(fs.readFileSync(new URL(p, import.meta.url), 'utf8'));
const cases = read('../fixtures/tour-cases.json');
const LISTINGS = read('../../dashboard/data/listings.json');
const CRIT = read('../../dashboard/data/criteria.json');
const MANIFEST = read('../../dashboard/data/manifest.json');
const TODAY = parseDay(CRIT.scoring?.as_of || MANIFEST.generated.slice(0, 10));
const byId = Object.fromEntries(cases.listings.map((L) => [L.id, L]));

const out = { normalized: {}, pairs: [], trail: {}, scoring: [], ids: [] };
for (const [k, f] of Object.entries(cases.findings)) out.normalized[k] = normalize(f);
for (const [lid, fid] of cases.pairs) {
  const L = byId[lid], f = cases.findings[fid];
  out.pairs.push({
    listing: lid, finding: fid, flags: flagsFor(L, f), overlay: overlay(L, f), share: shareTour(L, f), share_notes: shareTour(L, f, { notes: true }),
    claims: Object.fromEntries(CHECK_KEYS.map((k) => [k, claimOf(k, f)])), assess: Object.fromEntries(CHECK_KEYS.map((k) => [k, assess(L, k, normalize(f).checks?.[k])])),
    listed: Object.fromEntries(CHECK_KEYS.map((k) => [k, listedValue(L, k)])),
  });
}
out.trail = {
  cleaned: clean(cases.trail), plain: trailForShare(cases.trail, 'fx-a'), notes: trailForShare(cases.trail, 'fx-a', { notes: true }), other: trailForShare(cases.trail, 'fx-b'),
};

// generated findings on the example listings: the same ones the Python side builds, then scored by each side
export function generated() {
  const out2 = [];
  LISTINGS.forEach((L, i) => {
    if (i % 9 !== 0 || out2.length >= 40) return;
    const checks = {}, promoted = {};
    const wd = listedValue(L, 'wd');
    checks.wd = { verdict: 'differs', observed: wd == null ? true : !wd };
    if (L.sqft) checks.size = { verdict: 'differs', observed: Math.round(L.sqft) + 80 };
    const dm = listedValue(L, 'doorman');
    if (dm) checks.doorman = { verdict: 'differs', observed: dm === 'none' ? 'full-time' : 'none' };
    const e = listedValue(L, 'exposure');
    checks.exposure = { verdict: 'differs', observed: e && e[0] !== 'N' ? 'N' : 'S' };
    // promote some, leave others as plain contradictions
    if (i % 2 === 0) promoted.wd = { value: checks.wd.observed, observed_at: '2026-10-14' };
    if (i % 3 === 0 && checks.size) promoted.size = { value: checks.size.observed, observed_at: '2026-10-14' };
    if (i % 4 === 0 && checks.doorman) promoted.doorman = { value: checks.doorman.observed, observed_at: '2026-10-14' };
    if (i % 5 === 0) promoted.exposure = { value: checks.exposure.observed, observed_at: '2026-10-14' };
    out2.push({ id: L.id, finding: { observed: '2026-10-14', checks, promoted } });
  });
  return out2;
}
for (const { id, finding } of generated()) {
  const L = LISTINGS.find((x) => x.id === id), L2 = overlay(L, finding);
  const ev = evaluate(L2, L.score, CRIT, TODAY).score, ann = annotateScore(ev, flagsFor(L, finding));
  const items = Object.fromEntries((ann.reasons || []).filter((r) => r.items?.some((x) => x.startsWith('tour '))).map((r) => [r.dim, r.items.filter((x) => x.startsWith('tour '))]));
  out.scoring.push({ id, finding, gates: ann.gates, tags: ann.tags, amenities: ann.parts.amenities, space: ann.parts.space, spaceExact: spacePart(L2, CRIT.unit || {}) != null, items });
}
process.stdout.write(JSON.stringify(out));
