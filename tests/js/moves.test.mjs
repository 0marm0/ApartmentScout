// node --test tests/js : "why did this move?" (dashboard/js/features/moves-model.js). The model reads the rank history that
// `apartmentscout score` writes (apartmentscout/rankhistory.py), so most cases build a small history by hand in that format and
// the last ones read the committed example's own history, where the Knox 6B fell from #6 to #46.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseRanks, standing, chooseBaseline, runAtOrBefore, change, movers, significant, explain, summary, passedBy, runLabel, cardNote, arrowText, latestRun, localStamp, MOVE_MIN } from '../../dashboard/js/features/moves-model.js';

const read = (p) => JSON.parse(fs.readFileSync(new URL(p, import.meta.url), 'utf8'));
const hex = (v) => (v == null ? 'ff' : Math.round(v).toString(16).padStart(2, '0'));

/** A history in rankhistory.py's columnar format. runs: [{ at, version, w: {dim: weight}, homes: { id: { rank, fit, score, cost, parts: {dim: v}, flags: [] } } }] */
function history(runs, dims = ['cost', 'space', 'light_view', 'interior'], versions = {}) {
  const ids = [...new Set(runs.flatMap((r) => Object.keys(r.homes)))];
  const vocab = [...new Set(runs.flatMap((r) => Object.values(r.homes).flatMap((h) => h.flags || [])))];
  return {
    v: 1, dims, vocab, versions, ids,
    runs: runs.map((r) => ({
      at: r.at, version: r.version || '2.1', k: dims.length, w: dims.map((d) => r.w?.[d] ?? 0), n: Object.values(r.homes).filter((h) => h.rank).length,
      a: ids.map((i) => r.homes[i]?.rank || 0), f: ids.map((i) => r.homes[i]?.fit || r.homes[i]?.rank || 0),
      s: ids.map((i) => (r.homes[i]?.score == null ? -1 : Math.round(r.homes[i].score * 10))), c: ids.map((i) => r.homes[i]?.cost ?? -1),
      p: ids.map((i) => dims.map((d) => hex(r.homes[i]?.parts?.[d])).join('')).join(''),
      g: ids.map((i) => (r.homes[i]?.flags || []).map((f) => vocab.indexOf(f)).join('.')),
    })),
  };
}
const W = { cost: 20, space: 30, light_view: 10, interior: 0 };
const home = (rank, parts, flags = [], cost = 4800) => ({ rank, parts, flags, cost, score: Object.entries(W).reduce((a, [k, w]) => a + w * (parts[k] ?? 50), 0) / Object.values(W).reduce((a, b) => a + b, 0) });
const doc = history([
  { at: '2026-10-13T09:00', version: '2.0', w: W, homes: { a: home(1, { cost: 80, space: 80, light_view: 60 }), b: home(2, { cost: 70, space: 70, light_view: 60 }), c: home(3, { cost: 60, space: 60, light_view: 60 }) } },
  { at: '2026-10-14T20:00', version: '2.1', w: W, homes: { a: home(3, { cost: 80, space: 20, light_view: 60 }, ['size_imputed']), b: home(1, { cost: 70, space: 70, light_view: 60 }), c: home(2, { cost: 60, space: 60, light_view: 60 }) } },
  { at: '2026-10-14T21:00', version: '2.1', w: { ...W, space: 20 }, homes: { a: home(3, { cost: 60, space: 20, light_view: 60 }, ['size_imputed', 'price_dispute'], 5100), b: home(1, { cost: 70, space: 70, light_view: 60 }), c: home(2, { cost: 60, space: 60, light_view: 60 }), d: home(4, { cost: 50, space: 50 }) } },
], undefined, { '2.1': 'estimates a missing size' });
const M = parseRanks(doc);

test('a rank history is read back as the file wrote it, and anything else is refused', () => {
  assert.equal(parseRanks(null), null);
  assert.equal(parseRanks({ v: 2, runs: [], ids: [], dims: [] }), null);
  assert.deepEqual(M.runs.map((r) => r.at), ['2026-10-13T09:00', '2026-10-14T20:00', '2026-10-14T21:00']);
  const s = standing(M, M.runs[2], 'a');
  assert.equal(s.rank, 3); assert.equal(s.parts.cost, 60); assert.equal(s.parts.interior, null); assert.equal(s.cost, 5100);
  assert.deepEqual([...s.flags].sort(), ['price_dispute', 'size_imputed']);
  assert.equal(standing(M, M.runs[0], 'nobody'), null);
  assert.equal(standing(M, M.runs[0], 'd').rank, 0, 'a home the run did not know has no rank');
});

test('the run to compare with: a chosen run, the last visit, else the first', () => {
  const [r0, r1, r2] = M.runs;
  assert.equal(chooseBaseline(M, { chosen: r1.at }).run, r1);
  assert.equal(chooseBaseline(M, { chosen: r1.at }).why, 'chosen');
  assert.equal(chooseBaseline(M, { visit: '2026-10-13' }).run, r0, 'a visit on a day compares with the last run of that day');
  assert.equal(chooseBaseline(M, { visit: '2026-10-14T20:30' }).run, r1);
  assert.equal(chooseBaseline(M, { visit: '2026-10-15' }).why, 'first', 'the latest run is already seen: fall back to the first');
  assert.equal(chooseBaseline(M, {}).run, r0);
  assert.equal(chooseBaseline(parseRanks(history([{ at: '2026-10-13T09:00', homes: { a: home(1, {}) } }])), {}), null, 'one run has nothing to compare');
  assert.equal(runAtOrBefore(M, '2026-10-12'), null);
  assert.equal(runLabel(M, r0), 'Oct 13'); assert.equal(runLabel(M, r1), 'Oct 14, 8:00 pm'); assert.equal(runLabel(M, r2), 'Oct 14, 9:00 pm');
  assert.equal(localStamp(new Date(2026, 9, 14, 21, 5)), '2026-10-14T21:05');
});

test('how far a home moved, and which moves are worth a note', () => {
  const [r0, , r2] = M.runs;
  assert.deepEqual(change(M, r0, r2, 'a'), { id: 'a', kind: 'moved', from: 1, to: 3, delta: -2, fromScore: change(M, r0, r2, 'a').fromScore, toScore: change(M, r0, r2, 'a').toScore });
  assert.equal(change(M, r0, r2, 'd').kind, 'entered');
  assert.equal(change(M, r2, r0, 'd').kind, 'left');
  assert.equal(change(M, r0, r2, 'zzz'), null);
  assert.equal(arrowText(-40), '↓40'); assert.equal(arrowText(12), '↑12');
  const c = { kind: 'moved', delta: -40, from: 6, to: 46 };
  assert.equal(significant(c, 301), true);
  assert.equal(significant({ ...c, delta: -9 }, 301), false, 'under ten places is not news');
  assert.equal(significant({ kind: 'moved', delta: -30, from: 200, to: 230 }, 301), false, 'a move deep in the list is not news');
  assert.equal(significant({ kind: 'moved', delta: 30, from: 200, to: 170 }, 301), false);
  assert.equal(significant({ kind: 'moved', delta: 30, from: 90, to: 60 }, 301), true, 'top quarter of 301 is 75');
  assert.equal(MOVE_MIN, 10);
  // on a list this short nothing is ten places away
  assert.equal(movers(M, r0, r2).size, 0);
  assert.equal(movers(M, r0, r2, { min: 1 }).size, 2);
  assert.equal(cardNote(c, r0, M), '↓40 since Oct 13');
});

test('the reasons name the dimensions that moved, with the points each took, and they add up', () => {
  const [r0, r1, r2] = M.runs;
  const labels = { cost: 'Cost', space: 'Space', light_view: 'Light & view', interior: 'Interior' };
  const score = { reasons: [{ dim: 'space', text: '-5 space: ~510-710 ft² (estimated)', items: ['no size stated: estimated from the building\'s other 1-bed units (3 known)', 'scored at the 562 ft² middle; the range is kept in the score range'] }] };
  const e = explain(M, r0, r1, 'a', { labels, score });
  assert.deepEqual(e.rank, { from: 1, to: 3, delta: -2 });
  const space = e.lines.find((l) => l.dim === 'space');
  assert.match(space.text, /size now estimated at ~562 ft² \(no size listed\)/);
  assert.ok(space.pts < -5);
  assert.deepEqual(e.lines.map((l) => l.dim), ['space'], 'only what moved is named');
  assert.equal(e.versionChanged, true);
  assert.match(e.extras[0], /Scoring changed from 2\.0 to 2\.1: it estimates a missing size/);
  const before = (r, i) => Object.entries(r.w).reduce((x, [d, w]) => x + w * (standing(M, r, i).parts[d] ?? 50), 0) / r.wtot;
  assert.ok(Math.abs(e.total - (before(r1, 'a') - before(r0, 'a'))) < 1e-9, 'the lines add up to the change in the score');
  // a price dispute and a changed weight, one run later
  const cost = { cost: { scenarios: [{ label: 'listing price', monthly: 4860 }, { label: 'building page', monthly: 5100 }] } };
  const f = explain(M, r1, r2, 'a', { labels, score: cost });
  const dims = f.lines.map((l) => l.dim);
  assert.ok(dims.includes('cost') && dims.includes('weights'), dims.join());
  assert.match(f.lines.find((l) => l.dim === 'cost').text, /two prices disagree: scoring the higher \(\$5,100 a month\) until you have a written quote, not \$4,860/);
  assert.match(f.lines.find((l) => l.dim === 'weights').text, /weights in your criteria changed \(Space 50% → 40%/);
  assert.equal(f.extras.length, 0, 'same scoring version: no version note');
  assert.deepEqual(f.lines.map((l) => l.pts), [...f.lines.map((l) => l.pts)].sort((x, y) => Math.abs(y) - Math.abs(x)), 'biggest first');
  assert.equal(explain(M, r0, r2, 'nobody'), null);
});

test('the headline and the home that others passed', () => {
  const [r0, , r2] = M.runs;
  const s = summary(M, r0, r2, 'a', { labels: {}, score: {} });
  assert.equal(s.head, '↓2 since Oct 13: #1 → #3');
  assert.match(s.sub, /^Score \d+\.\d → \d+\.\d \(−\d+\.\d\)$/);
  assert.deepEqual(passedBy(M, r0, r2, 'a'), { n: 2, fresh: 0 }, 'b and c now rank above a');
  assert.deepEqual(passedBy(M, r0, r2, 'b'), { n: 0, fresh: 0 });
  const d = summary(M, r0, r2, 'd', { labels: {}, score: {} });
  assert.match(d.head, /Ranked #4 now; it was not ranked on Oct 13/);
});

test('numbers the renter typed are named in the reasons', () => {
  const dims = ['cost', 'space'];
  const mk = (flags, parts) => history([
    { at: '2026-10-13T09:00', w: { cost: 1, space: 1 }, homes: { a: { rank: 2, parts: { cost: 50, space: 20 }, flags: [], cost: 4000, score: 35 }, b: { rank: 1, parts: { cost: 50, space: 40 }, flags: [], cost: 4000, score: 45 } } },
    { at: '2026-10-14T09:00', w: { cost: 1, space: 1 }, homes: { a: { rank: 1, parts, flags, cost: 4000, score: 55 }, b: { rank: 2, parts: { cost: 50, space: 40 }, flags: [], cost: 4000, score: 45 } } },
  ], dims);
  const m = parseRanks(mk(['renter:size'], { cost: 50, space: 90 }));
  const e = explain(m, m.runs[0], m.runs[1], 'a', { labels: { space: 'Space' }, score: { reasons: [{ dim: 'space', text: '+20 space: 800 ft² (reported)' }] } });
  assert.match(e.lines[0].text, /you entered the size \(800 ft² \(reported\)\)/);
});

// ------------------------------------------------------------------ the committed example
const EX = parseRanks(read('../../dashboard/data/ranks.json'));
const LISTINGS = read('../../dashboard/data/listings.json');
const CRIT = read('../../dashboard/data/criteria.json');
const LABELS = Object.fromEntries(CRIT.scoring.dimensions);

test('the example remembers the Knox 6B at #6 on Oct 13 and #46 now, and says why', () => {
  assert.ok(EX.runs.length >= 3);
  const base = chooseBaseline(EX, {}).run, now = latestRun(EX);
  assert.equal(runLabel(EX, base), 'Oct 13');
  const knox = LISTINGS.find((L) => L.id === 'the-knox-6b');
  assert.equal(change(EX, base, now, 'the-knox-6b').to, knox.score.ranks.action, 'the latest run is the committed scoring');
  const s = summary(EX, base, now, 'the-knox-6b', { labels: LABELS, score: knox.score });
  assert.equal(s.head, '↓40 since Oct 13: #6 → #46');
  assert.equal(s.sub, 'Score 72.8 → 67.2 (−5.6)');
  const text = s.lines.map((l) => `${l.label}: ${l.text}`).join('\n');
  assert.match(text, /Space: size now estimated at ~562 ft² \(no size listed\)/);
  assert.match(text, /Cost: two prices disagree: scoring the higher/);
  assert.match(text, /Light & view: .*unit's own photos now count.*floor is inferred/);
  assert.match(text, /Interior: scoring 2\.1 added interior/);
  assert.ok(s.lines.some((l) => l.dim === 'weights'));
  assert.ok(Math.abs(s.total - (s.score.to - s.score.from)) < 0.2, `the points add up (${s.total} vs ${s.score.to - s.score.from})`);
  assert.match(s.extras[0], /Scoring changed from 2\.0 to 2\.1/);
  assert.ok(movers(EX, base, now).has('the-knox-6b'));
});

test('the example\'s moves are a calm minority, not every home', () => {
  const base = chooseBaseline(EX, {}).run, now = latestRun(EX);
  const m = movers(EX, base, now);
  assert.ok(m.size > 10 && m.size < now.n / 2, `${m.size} of ${now.n} ranked homes`);
  // since the second run, only the price audit moved anything: the Knox fell 14 places
  const late = EX.runs.find((r) => r.at === '2026-10-14T20:39');
  const k = change(EX, late, now, 'the-knox-6b');
  assert.deepEqual([k.from, k.to], [32, 46]);
  const e = explain(EX, late, now, 'the-knox-6b', { labels: LABELS, score: LISTINGS.find((L) => L.id === 'the-knox-6b').score });
  assert.deepEqual(e.lines.map((l) => l.dim), ['cost']);
  assert.equal(e.versionChanged, false);
});
