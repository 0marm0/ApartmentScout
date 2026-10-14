// node --test tests/js : the share builder (dashboard/js/features/share-model.js). The template's as-schema block is the
// single list of what may travel; these tests check that nothing else does, that the renter's notes and tour times only
// leave when asked, and that the map algorithm agrees with the one in apartmentscout/share.py (a shared fixture).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  parseSchema, inlinePayload, pruneHome, buildPayload, orderListings, reasonsFor, weightedScore, weightRows, simplifyLines, homeBbox, photoCandidates, fileSlug, dimList,
} from '../../dashboard/js/features/share-model.js';

const read = (p) => JSON.parse(fs.readFileSync(new URL(p, import.meta.url), 'utf8'));
const TEMPLATE = fs.readFileSync(new URL('../../dashboard/share/snapshot.html', import.meta.url), 'utf8');
const SCHEMA = parseSchema(TEMPLATE);
const LISTINGS = read('../../dashboard/data/listings.json');
const CRIT = read('../../dashboard/data/criteria.json');
const TRANSIT = read('../../dashboard/data/layers/transit-lines.json').features;
const byId = (id) => LISTINGS.find((L) => L.id === id);
const PICKS = {
  'paramount-tower-25e': { saved: true, tier: 'S', note: 'private view note', tour: '2026-10-17T10:30' },
  'orion-condominium-23a': { saved: true, tier: 'A' },
  'emerald-green-24d': { saved: true },
  'the-max-621': { saved: true, tier: 'Pass', note: 'too small' },
  'not-in-the-data': { saved: true },
};
const build = (extra = {}) => buildPayload({ listings: LISTINGS, crit: CRIT, picks: PICKS, schema: SCHEMA, transit: TRANSIT, generated: '2026-10-14', ...extra });

test('the template carries a schema and an empty data block, and the payload is inlined safely', () => {
  assert.equal(SCHEMA.version, 1);
  assert.ok(SCHEMA.listing.includes('score') && !SCHEMA.listing.includes('commute_grid') && !SCHEMA.listing.includes('tour'));
  const out = inlinePayload(TEMPLATE, { homes: [{ notes: 'a </script><script>alert(1)</script> b  ' }] });
  assert.ok(!/<\/script><script>alert/.test(out), 'a note cannot close the data block');
  const m = out.match(/id="as-data">([\s\S]*?)<\/script>/);
  assert.equal(JSON.parse(m[1]).homes[0].notes, 'a </script><script>alert(1)</script> b  ');
  assert.throws(() => inlinePayload(out, {}), /no empty as-data/, 'a filled template is not filled twice');
});

test('picks become homes: unknown ids and Pass are left out, order follows the weights', () => {
  const p = build();
  assert.deepEqual(p.homes.map((h) => h.id), ['paramount-tower-25e', 'orion-condominium-23a', 'emerald-green-24d']);
  const s = p.homes.map((h) => h.score.overall);
  assert.ok(s[0] >= s[1] && s[1] >= s[2]);
  // heavy weight on cost reorders them under the same builder
  const cost = build({ weights: { cost: 40, space: 0, commute: 0, amenities: 0, light_view: 0, building: 0, interior: 0, quiet: 0 } });
  assert.notDeepEqual(cost.homes.map((h) => h.id), p.homes.map((h) => h.id));
  assert.equal(cost.homes.length, 3);
  assert.deepEqual(p.weights.find((w) => w.k === 'cost'), { k: 'cost', label: 'Cost', w: 20, pct: 20 });
});

test("the renter's notes leave only when asked, and tour times and private fields never do", () => {
  const without = JSON.stringify(build());
  assert.ok(!without.includes('private view note') && !without.includes('too small'));
  assert.ok(!without.includes('2026-10-17T10:30') && !without.includes('"tour"'));
  const withNotes = build({ includeNotes: true });
  assert.equal(withNotes.homes[0].pick.note, 'private view note');
  assert.equal(withNotes.notes, true);
  assert.ok(!JSON.stringify(withNotes).includes('2026-10-17T10:30'));
  for (const h of withNotes.homes) {
    for (const k of Object.keys(h)) assert.ok(SCHEMA.listing.includes(k) || ['pick', 'reasons', 'commute', 'photos'].includes(k), `unexpected field ${k}`);
    assert.ok(!('stations' in h) && !('legacy_score' in h) && !('bbl' in h) && !('photos_local' in h));
  }
});

test('nested fields are pruned to the schema and long text is cut', () => {
  const L = structuredClone(byId('paramount-tower-25e'));
  L.notes = 'x'.repeat(5000);
  L.score.secret = 'nope'; L.price.secret = 'nope'; L.reviews.secret = 'nope';
  const h = pruneHome(L, SCHEMA, 'Grand Central', { tier: 'S' }, false);
  assert.ok(h.notes.length <= SCHEMA.text_max.notes && h.notes.endsWith('…'));
  assert.ok(!('secret' in h.score) && !('secret' in h.price) && !('secret' in h.reviews));
  assert.ok(h.commute.modes.walk.minutes > 0 && Array.isArray(h.commute.modes.transit.legs));
  assert.ok(!('reasons' in h.score), 'the scorer\'s sentences travel as the recomputed reasons, not raw');
  assert.ok(h.links.listing.startsWith('https://'));
});

test('reasons use the live weights and the same formula as the dashboard', () => {
  const dims = dimList(CRIT), L = byId('paramount-tower-25e');
  const r = reasonsFor(L, CRIT.weights, dims);
  assert.ok(r.length >= 4 && r.every((x) => x.weight > 0));
  assert.ok(r.every((x, i) => i === 0 || Math.abs(r[i - 1].pts) >= Math.abs(x.pts)), 'sorted by size of effect');
  const cost = r.find((x) => x.label === 'Cost');
  assert.ok(Math.abs(cost.pts - ((L.score.parts.cost - 50) * 20) / 100) < 0.01);
  const heavy = reasonsFor(L, { ...CRIT.weights, cost: 80 }, dims).find((x) => x.label === 'Cost');
  assert.ok(Math.abs(heavy.pts) > Math.abs(cost.pts));
  assert.ok(Math.abs(weightedScore(L, CRIT.weights, dims) - L.score.overall) < 0.35);
  assert.equal(weightRows(CRIT.weights, dims).reduce((a, w) => a + w.pct, 0) >= 99, true);
  assert.equal(orderListings([byId('atlas-38d'), L], CRIT.weights, dims)[0].id, 'paramount-tower-25e');
});

test('the map algorithm agrees with share.py on the shared fixture', () => {
  const fx = read('../fixtures/share-lines.json');
  for (const c of fx.cases) assert.deepEqual(simplifyLines(fx.features, fx.bbox, c.opts), c.expected, c.name);
  const real = simplifyLines(TRANSIT, homeBbox([[-73.99, 40.74], [-73.97, 40.76]], 0.2), SCHEMA.map);
  assert.ok(real.length >= 3 && real.every((g) => /^#/.test(g.c)));
  assert.ok(real.reduce((a, g) => a + g.d.reduce((b, r) => b + r.length, 0), 0) <= SCHEMA.map.max_points);
});

test('photo candidates: own photos first, local copies with their link, building photos with a credit', () => {
  const c = photoCandidates({ photos_local: ['media/a/1.webp', 'media/a/2.webp'], photos: ['https://x.test/1.jpg', 'media/a/2.webp', 'https://x.test/3.jpg'],
    building_photos: [{ url: 'https://commons.test/b.jpg', author: 'A. Person', license: 'CC BY 4.0' }, { url: 'media/a/b2.webp', local: 'media/a/b2.webp', license: 'private research copy' }] });
  assert.deepEqual(c.map((x) => [x.local, x.ref]), [['media/a/1.webp', 'https://x.test/1.jpg'], ['media/a/2.webp', null], [null, 'https://x.test/3.jpg'], [null, 'https://commons.test/b.jpg'], ['media/a/b2.webp', null]]);
  assert.equal(c[3].credit, 'A. Person · CC BY 4.0');
  assert.equal(c[4].credit, null, 'a private research copy carries no credit line');
  assert.equal(fileSlug('Manhattan 1BR, fall 2026'), 'manhattan-1br-fall-2026');
});

test('the finished payload stays small without photos', () => {
  const kb = JSON.stringify(build()).length / 1024;
  assert.ok(kb < 120, `${kb.toFixed(0)} KB for three homes`);
});
