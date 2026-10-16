// node --test tests/js : the decision report. The builder (dashboard/js/features/report-model.js) prunes homes to the template's schema; the
// rules the page applies live in the template's as-core script, which has no DOM and is loaded here exactly as the page runs it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildReport, parseSchema, inlinePayload, inlineFonts, prunePlan, leaseLines, fileName } from '../../dashboard/js/features/report-model.js';

const read = (p) => JSON.parse(fs.readFileSync(new URL(p, import.meta.url), 'utf8'));
const TEMPLATE = fs.readFileSync(new URL('../../dashboard/report/report.html', import.meta.url), 'utf8');
const SCHEMA = parseSchema(TEMPLATE);
const LISTINGS = read('../../dashboard/data/listings.json');
const CRIT = read('../../dashboard/data/criteria.json');
const PLAN = read('../../dashboard/data/plans/paramount-tower-25e.json');

// the page's rules, as the page runs them
const core = /<script id="as-core">([\s\S]*?)<\/script>/.exec(TEMPLATE)[1];
const mod = { exports: {} };
new Function('module', core)(mod);   // the same realm, so deepEqual compares plain objects
const R = mod.exports;

const IDS = ['paramount-tower-25e', 'the-greywood-4b', 'paramount-tower-41a'];
const build = (extra = {}) => buildReport({ listings: LISTINGS, crit: CRIT, ids: IDS, schema: SCHEMA, generated: '2026-10-15', ...extra });
const TOUR = { observed: '2026-10-14', ceiling: 9, water: 4, noise: { rating: 2, db: 41 }, view: 'Park canopy', note: 'my private visit note', checks: [{ key: 'wd', label: 'Washer/dryer in the unit', verdict: 'differs', kind: 'contradicts', observed: 'none' }] };

test('the template carries a schema, an empty data block and a font block; the payload is inlined safely', () => {
  assert.equal(SCHEMA.version, 1); assert.equal(SCHEMA.max_homes, 4);
  assert.ok(SCHEMA.listing.includes('score') && !SCHEMA.listing.includes('commute') && !SCHEMA.listing.includes('tour') && !SCHEMA.listing.includes('photos_local'));
  const out = inlinePayload(TEMPLATE, { homes: [{ notes: 'a </script><script>alert(1)</script> b  ' }] });
  assert.ok(!/<\/script><script>alert/.test(out) && out.includes('<\\/script>') && out.includes('\\u2028'));
  assert.throws(() => inlinePayload(out, {}), /empty as-data/);
  assert.ok(TEMPLATE.includes('/*as-fonts*/'));
  const f = inlineFonts(TEMPLATE, '@font-face{font-family:"Geist"}');
  assert.ok(f.includes('<style id="as-fonts">@font-face{font-family:"Geist"}</style>') && !f.includes('/*as-fonts*/'));
  assert.equal(inlineFonts(TEMPLATE, ''), TEMPLATE);
});

test('a report holds one to four homes, known to the search, best first', () => {
  const p = build();
  assert.deepEqual(p.homes.map((h) => h.id), ['paramount-tower-25e', 'the-greywood-4b', 'paramount-tower-41a']);   // by fit under the criteria's weights
  assert.equal(p.v, 1); assert.equal(p.paper, 'letter'); assert.equal(p.generated, '2026-10-15'); assert.deepEqual(p.move_in, { earliest: '2026-10-15', latest: '2026-11-01' });
  assert.equal(p.dests[0].name, 'Grand Central'); assert.ok(p.weights.length >= 8);
  assert.ok(p.homes.every((h) => typeof h.fit === 'number' && h.reasons.length && h.commutes?.['Grand Central']));
  assert.throws(() => build({ ids: ['nope'] }), /No listing with id nope/);
  assert.throws(() => build({ ids: [] }), /1 to 4/);
  assert.throws(() => build({ ids: LISTINGS.slice(0, 5).map((L) => L.id) }), /1 to 4/);
  assert.equal(build({ ids: ['the-greywood-4b', 'the-greywood-4b'] }).homes.length, 1, 'a repeated id is one home');
  assert.equal(build({ paper: 'a4' }).paper, 'a4'); assert.equal(build({ paper: 'folio' }).paper, 'letter');
});

test('only the schema\'s fields travel, and the renter\'s notes only when asked', () => {
  const picks = { 'paramount-tower-25e': { saved: true, tier: 'S', note: 'private pick note', tour: '2026-10-17T10:30' } };
  const extras = { 'paramount-tower-25e': { tour: TOUR, trail: [{ at: '2026-10-14T10:00:00Z', kind: 'star', text: 'starred', why: 'private reason' }] } };
  const quiet = build({ picks, extras: { 'paramount-tower-25e': { tour: { ...TOUR, note: undefined } } } });
  assert.ok(!JSON.stringify(quiet).includes('private pick note') && !JSON.stringify(quiet).includes('my private visit note') && !JSON.stringify(quiet).includes('2026-10-17T10:30'));
  assert.equal(quiet.notes, false);
  const loud = build({ picks, includeNotes: true, extras });
  assert.equal(loud.notes, true);
  assert.equal(loud.homes[0].pick.note, 'private pick note'); assert.equal(loud.homes[0].tour.note, 'my private visit note');
  assert.ok(!JSON.stringify(loud).includes('2026-10-17T10:30'), 'tour times never leave');
  const allowed = new Set([...SCHEMA.listing, 'pick', 'reasons', 'fit', 'commutes', 'lease', 'plan', 'questions', 'tour', 'trail', 'photos', 'still']);
  for (const h of loud.homes) for (const k of Object.keys(h)) assert.ok(allowed.has(k), `unexpected key ${k}`);
  for (const h of loud.homes) for (const k of Object.keys(h.score)) assert.ok(SCHEMA.score.includes(k), `unexpected score key ${k}`);
  for (const h of loud.homes) assert.ok(!('claims' in h) && !('photos_local' in h) && !('commute' in h));
});

test('plans are cut to what the thumbnail draws and the scorer\'s lease sentences are kept', () => {
  const p = prunePlan(PLAN);
  assert.ok(p.rooms.length >= 4 && p.rooms.every((r) => Array.isArray(r.poly) && Object.keys(r).every((k) => ['name', 'kind', 'poly'].includes(k))));
  assert.ok(p.windows.length && p.units && 'up_bearing' in p);
  assert.ok(!('finishes' in p) && !('fixtures' in p) && !('layouts' in p) && !('provenance' in p));
  assert.equal(prunePlan({ rooms: [] }), null); assert.equal(prunePlan(null), null);
  assert.deepEqual(prunePlan({ units: 'm', rooms: [{ name: 'A', poly: [[0.04, 0.05], [1, 0], [1, 1]] }], windows: [{ a: [0, 0], b: [1, 0] }, { x1: 1, y1: 1, x2: 2, y2: 2 }, 'x'] }),
    { units: 'm', rooms: [{ name: 'A', poly: [[0, 0.1], [1, 0], [1, 1]] }], windows: [{ a: [0, 0], b: [1, 0] }, { x1: 1, y1: 1, x2: 2, y2: 2 }] });   // half-up rounding to 0.1, bad entries dropped
  const L = LISTINGS.find((x) => x.id === 'paramount-tower-25e');
  assert.match(leaseLines(L).renewal, /^no concession: renewal starts/);
  const p2 = build({ plans: { 'paramount-tower-25e': PLAN } });
  assert.ok(p2.homes[0].plan.rooms.length && !p2.homes[1].plan);
});

// ------------------------------------------------------------------ the page's rules
test('the side-by-side table marks the best value in each row and leaves unknown as unknown', () => {
  const sections = R.rows(build());
  const row = (label) => sections.flatMap((s) => s.rows).find((r) => r.label === label);
  const money = row('True monthly cost');
  assert.deepEqual(money.best, [1]);                         // the Greywood 4B: $4,877 is the lowest
  assert.equal(money.cells[0].t, '$5,032');
  const size = row('Size');
  assert.equal(size.cells[1], null, 'no published size is unknown, not zero'); assert.deepEqual(size.best, [2]);   // 735 ft² against 715
  const sun = row('Direct sun, Dec / Jun');
  assert.equal(sun.cells[1], null); assert.deepEqual(sun.best, [], 'one known value has nothing to beat');
  const move = row('Move-in cost');
  assert.ok(move.cells.every((c) => /^\+ /.test(c.s) || c.s), 'unknown deposits are said'); assert.deepEqual(move.best, [], 'a floor is not compared when some are unknown');
  assert.ok(sections.map((s) => s.title).includes('Getting around') && row('Commute to Grand Central').best.length);
  const hard = row('Hard requirements').cells;
  assert.equal(hard[0].t, 'All met'); assert.equal(hard[1].tone, 'warn'); assert.equal(hard[2].tone, 'bad');
  assert.equal(row('Noise on your visit'), undefined, 'the visit row appears only when someone has visit notes');
  const withTour = R.rows(build({ extras: { 'paramount-tower-25e': { tour: TOUR } } })).flatMap((s) => s.rows).find((r) => r.label === 'Noise on your visit');
  assert.equal(withTour.cells[0].t, 'Quiet');
});

test('the recommendation is the best fit that meets the hard requirements, with the reasons it beats the runner-up', () => {
  const p = build(), rec = R.recommend(p);
  assert.equal(p.homes[rec.leader].id, 'paramount-tower-25e'); assert.equal(p.homes[rec.runner].id, 'the-greywood-4b');
  assert.equal(rec.margin, Math.round((p.homes[0].fit - p.homes[1].fit) * 10) / 10); assert.equal(rec.close, false);
  assert.match(rec.headline, /^Paramount Tower 25E fits your priorities best: \$5,032 a month, 10 minutes to Grand Central, and 3\.1 hours of direct sun in December\.$/);
  assert.ok(rec.why.length >= 2 && rec.why.every((w) => w.pts > 0 && w.vs === 'The Greywood 4B' && typeof w.label === 'string'));
  assert.equal(rec.why[0].label, 'Light & view'); assert.ok(rec.why[0].pts >= rec.why[1].pts);
  assert.ok(rec.watch.some((w) => /security deposit/.test(w)));
  // a home that fails a hard requirement never leads, even with the best fit
  const q = build({ ids: ['paramount-tower-25e', 'the-greywood-4b'] }); q.homes[1].fit = 99; q.homes[1].score = { ...q.homes[1].score, gates: ['over_budget'] };
  const r2 = R.recommend(q);
  assert.equal(q.homes[r2.leader].id, 'paramount-tower-25e'); assert.deepEqual(r2.order, [0, 1]); assert.match(r2.watch.join(' '), /You rated|tie|close|Unknown/);
});
test('a close call is said to be one, and the renter\'s own tier S is named when it disagrees', () => {
  const p = build({ picks: { 'the-greywood-4b': { saved: true, tier: 'S' } } });
  p.homes[1].fit = p.homes[0].fit - 1;
  const rec = R.recommend(p);
  assert.ok(rec.close); assert.match(rec.watch[0], /^A close call: It leads The Greywood 4B by 1\.0 points/);
  assert.ok(rec.watch.some((w) => /You rated The Greywood 4B tier S/.test(w)));
  p.homes[1].fit = p.homes[0].fit;
  assert.match(R.recommend(p).watch[0], /tie with The Greywood 4B/);
  const one = R.recommend(build({ ids: ['paramount-tower-25e'] }));
  assert.equal(one.runner, null); assert.equal(one.margin, null); assert.ok(one.why.every((w) => w.vs === null));
});

test('what is still unknown comes from the score\'s gates, flags and cost model, and is never a guess', () => {
  const [a, b, c] = build().homes.map(R.unknownsFor).map((l) => l.map((x) => x.t));
  assert.ok(a.includes('The security deposit is not known') && a.includes('The size is estimated from a plan') && a.includes('The floor is inferred from the unit number'));
  assert.ok(b.includes('Monthly fees are not documented') && b.includes('The security deposit is not known'));
  assert.ok(c.some((t) => /washer\/dryer|Unconfirmed/i.test(t)) || c.length >= 2);
  const synth = R.unknownsFor({ score: { gates: ['unverified:price', 'contradicted:exposure', 'unverified:lease_term'], flags: ['exposure_assumed'], parts: {}, cost: { unknown: ['free months'], move_in_unknown: ['one-time fees'] } }, amenities: { elevator: true } });
  const t = synth.map((x) => x.t);
  assert.ok(t.includes('The rent is not verified from the unit page') && t.includes('The lease length is not stated') && t.includes('The number of free months is open') && t.includes('Move-in and application fees are not known'));
  assert.ok(t.includes('Differs on tour: exposure') && t.includes('Which way the windows face and how much sun they get') && t.includes('Whether there is an in-unit washer/dryer'));
  assert.ok(!t.includes('Whether there is an elevator'));
  assert.deepEqual(R.unknownsFor({ score: { parts: { move_date: 80, space: 70, light_view: 60 } }, available: 'Now', amenities: { in_unit_wd: true, elevator: true }, records: { risk_score: 80 } }), []);
});

test('the checklist asks the leasing office the leader\'s open questions, then covers the signing and the move', () => {
  const p = build({ questions: { 'paramount-tower-25e': [{ text: 'Is the deposit one month?', kind: 'missing' }], 'the-greywood-4b': [{ text: 'Is the lease 12 months?', kind: 'verify' }] } });
  const g = R.checklist(p);
  assert.equal(g[0].title, 'Confirm with the leasing office'); assert.equal(g[0].sub, 'Paramount Tower 25E'); assert.equal(g[0].items[0].t, 'Is the deposit one month?');
  assert.ok(g[0].items.length >= 3 && g[0].items.length <= 6);
  assert.deepEqual(g.map((x) => x.title).slice(1, 3), ['Before you sign', 'Move-in day']);
  assert.match(g[1].items.at(-1).t, /^The start date fits your window \(2026-10-15 to 2026-11-01\)/);
  const inst = g.filter((x) => /^If you choose/.test(x.title));
  assert.deepEqual(inst.map((x) => x.title), ['If you choose B instead', 'If you choose C instead']);
  assert.equal(inst[0].items[0].t, 'Is the lease 12 months?');
});

test('the floor plan thumbnail draws rooms, windows and a north arrow, and escapes what it prints', () => {
  const svg = R.planSvg(prunePlan(PLAN));
  assert.match(svg, /^<svg viewBox="[-\d. ]+"/); assert.ok((svg.match(/<polygon /g) || []).length >= 5);
  assert.ok(svg.includes('stroke="#3b8fe0"') && svg.includes('rotate(-118.7)') && svg.includes('>N</text>'));
  assert.ok(svg.includes('>Living room</text>') && /\d+′\d*″? × \d+′/.test(svg) || /×/.test(svg));
  const evil = R.planSvg({ units: 'ft', rooms: [{ name: '<script>alert(1)</script>', kind: 'living', poly: [[0, 0], [20, 0], [20, 15], [0, 15]] }] });
  assert.ok(!evil.includes('<script>') && evil.includes('&lt;script&gt;') && !evil.includes('rotate'));
  assert.equal(R.planSvg({ rooms: [] }), ''); assert.equal(R.planSvg(null), '');
  assert.equal(R.fmtIn(276), '23′'); assert.equal(R.fmtIn(149), '12′5″');
  assert.match(R.sunBars({ site: { sun_hours: [3.5, 4.7, 7.2, 8, 8.1, 8.5, 8.7, 7.9, 7.4, 6, 3.7, 3.1] } }), /<svg viewBox="0 0 84 24"/);
  assert.equal(R.sunBars({}), '');
});

test('small helpers: money, gate words, ratings, compass', () => {
  assert.equal(R.usd(5032.4), '$5,032'); assert.equal(R.usd(null), null); assert.equal(R.esc('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  assert.equal(R.GATE('unverified:fees'), 'Fees unknown'); assert.equal(R.GATE('fails:in_unit_wd'), 'Fails: in unit wd'); assert.equal(R.GATE('over_budget'), 'Over budget');
  assert.equal(R.compass(119), 'ESE'); assert.equal(R.compass(-10), 'N');
  assert.deepEqual(R.rating({ reviews: { ratings: [{ label: 'Google', value: '4.0/5 · 100' }, { label: 'Yelp', value: '3.0/5 · 100' }] } }), { v: 3.5, n: 200, src: 'Google, Yelp' });
  assert.equal(R.rating({}), null); assert.equal(R.cut('x'.repeat(30), 10), 'xxxxxxxxx…');
  assert.equal(fileName('Manhattan 1BR, fall 2026', '2026-10-15'), 'decision-report-manhattan-1br-fall-2026-2026-10-15.html');
});
