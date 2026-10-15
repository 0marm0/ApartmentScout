// node --test tests/js : tour findings (dashboard/js/features/findings-model.js) and the decision trail (decisions-model.js)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  normalize, parseFeet, fmtFeet, assess, listedValue, flagsFor, overlay, promote, unpromote, claimOf, annotateScore, livePromotions, shareTour,
  progress, isBlank, totalArea, phrase, TAG, SOURCE,
} from '../../dashboard/js/features/findings-model.js';
import { diffPick, diffPicks, record, clean, merge, withReason, forHome, describe, trailForShare, MERGE_MS, MAX_ENTRIES } from '../../dashboard/js/features/decisions-model.js';

const CASES = JSON.parse(fs.readFileSync(new URL('../fixtures/tour-cases.json', import.meta.url), 'utf8'));
const L = Object.fromEntries(CASES.listings.map((x) => [x.id, x]));
const F = CASES.findings;
const NOW = '2026-10-14T20:00:00Z';

test('normalize keeps what the schema names and drops the rest', () => {
  const n = normalize(F.junk);
  assert.equal(n.observed, undefined, 'a day that does not exist is dropped');
  assert.equal(n.visited_at, undefined);
  assert.equal(n.ceiling, undefined, 'a ceiling over 30 ft is not a ceiling');
  assert.equal(n.water, undefined);
  assert.deepEqual(n.noise, { rating: 3 }, 'a 19 dB reading is below the floor of what a person measures indoors');
  assert.equal(n.signal, 0, 'zero bars is a value, not a blank');
  assert.equal(n.closets, undefined, 'half a closet is not a count');
  assert.deepEqual(n.smells, ['smoke'], '"nothing odd" yields to a real smell');
  assert.equal(n.light, undefined);
  assert.equal(n.view.length, 400);
  assert.equal(n.note.length, 4000);
  assert.equal(n.rooms.length, 12);
  assert.deepEqual(n.rooms[0], { name: '<b>Hall</b>', w: 4.26 }, 'markup stays text; a negative length is dropped');
  assert.deepEqual(n.photos, [{ id: 'okid1234', store: 'idb', w: 640, h: 480, caption: 'c' }]);
  assert.deepEqual(n.checks, { doorman: { verdict: 'differs' }, size: { verdict: 'differs', observed: 650 }, exposure: { verdict: 'differs', observed: 'SSW' } });
  assert.ok(!('extra' in n));
});
test('normalize is idempotent', () => {
  for (const f of Object.values(F)) { const n = normalize(f); assert.deepEqual(normalize(n), n); }
});

test('lengths a thumb types become feet', () => {
  for (const [raw, feet] of CASES.feet) assert.equal(parseFeet(raw), feet, raw);
  assert.equal(fmtFeet(11.5), `11' 6"`);
  assert.equal(fmtFeet(11.99), `12'`);
  assert.equal(fmtFeet(null), '');
});

test('progress and area', () => {
  const n = normalize(F['fx-a']);
  assert.deepEqual(progress(n), { done: 14, total: 14, photos: 1, note: true });
  assert.equal(totalArea(n), Math.round(13.5 * 16) + Math.round(11.5 * 12.25));
  assert.ok(isBlank({ observed: '2026-10-14' }) && !isBlank({ note: 'x' }));
});

test('what the listing says is read the way the scorer reads it', () => {
  assert.equal(listedValue(L['fx-a'], 'wd'), true);
  assert.equal(listedValue(L['fx-c'], 'wd'), false, '"laundry in building" is not in-unit');
  assert.equal(listedValue(L['fx-b'], 'size'), null);
  assert.deepEqual(listedValue(L['fx-c'], 'exposure'), ['E', 'SE']);
});

test('a differing finding is a contradiction; a silent listing is not; small differences are not', () => {
  assert.equal(assess(L['fx-a'], 'wd', { verdict: 'differs', observed: false }).kind, 'contradicts');
  assert.equal(assess(L['fx-a'], 'wd', { verdict: 'match' }).kind, 'matches');
  assert.equal(assess(L['fx-b'], 'wd', { verdict: 'differs', observed: true }).kind, 'adds');
  assert.equal(assess(L['fx-b'], 'wd', { verdict: 'match' }).kind, 'none', 'nothing to match against');
  assert.equal(assess(L['fx-a'], 'size', { verdict: 'differs', observed: 690 }).kind, 'matches', 'within 2 percent');
  assert.equal(assess(L['fx-a'], 'size', { verdict: 'differs', observed: 600 }).kind, 'contradicts');
  assert.equal(assess(L['fx-a'], 'exposure', { verdict: 'differs', observed: 'S' }).kind, 'matches', 'one octant either side is the same facing');
  assert.equal(assess(L['fx-a'], 'exposure', { verdict: 'differs', observed: 'W' }).kind, 'contradicts');
  assert.equal(assess(L['fx-a'], 'doorman', { verdict: 'differs' }).kind, 'none', 'differs with no value is unfinished');
  assert.equal(assess(L['fx-a'], 'doorman', { verdict: 'unsure' }).kind, 'unsure');
});

test('a contradiction becomes a gate, a tag and a reason line, and promoting it swaps that for a line about the fact', () => {
  const fl = flagsFor(L['fx-a'], F['fx-a']);
  assert.deepEqual(fl.gates, ['contradicted:in_unit_wd', 'contradicted:sqft', 'contradicted:exposure']);
  assert.deepEqual(fl.tags, [TAG]);
  assert.match(fl.items.amenities[0], /^tour 2026-10-14: no in-unit washer\/dryer observed, the listing says in-unit washer\/dryer\./);
  const p = flagsFor(L['fx-a'], F['fx-a-promoted']);
  assert.deepEqual(p.gates, []);
  assert.deepEqual(p.promoted, ['wd', 'size', 'exposure']);
  assert.match(p.items.space[0], /611 ft² observed and promoted to a fact \(the listing said 700 ft²\)\.$/);
});

test('promoting writes a dated, sourced claim, scoring sees the fact, the listing is left alone, and it can be undone', () => {
  const before = JSON.stringify(L['fx-a']);
  let f = promote(L['fx-a'], F['fx-a'], 'wd', NOW);
  assert.deepEqual(claimOf('wd', f), { field: 'amenities.in_unit_wd', value: false, source: SOURCE, observed_at: '2026-10-14', status: 'live', via: 'tour' });
  const view = overlay(L['fx-a'], f);
  assert.equal(view.amenities.in_unit_wd, false);
  assert.equal(JSON.stringify(L['fx-a']), before, 'the listing is not mutated');
  assert.equal(overlay(L['fx-a'], F['fx-a']), L['fx-a'], 'nothing promoted, nothing overlaid');
  f = unpromote(f, 'wd');
  assert.equal(claimOf('wd', f), null);
  assert.deepEqual(livePromotions(f), {});
  // nothing to promote when the finding agrees with the listing or is unfinished
  assert.deepEqual(promote(L['fx-a'], { checks: { wd: { verdict: 'match' } } }, 'wd', NOW).promoted, undefined);
  // a size promotion replaces an estimate with the measured number
  const est = { ...L['fx-a'], sqft: undefined, size: { sqft: 650, basis: 'ratio_proxy' }, sqft_basis: 'ratio_proxy' };
  const v2 = overlay(est, promote({ ...est, sqft: 700 }, F['fx-a'], 'size', NOW));
  assert.equal(v2.sqft, 611); assert.ok(!('size' in v2) && !('sqft_basis' in v2));
});

test('a promotion stops counting when the renter changes the finding it came from', () => {
  assert.deepEqual(livePromotions(F['fx-a-stale']), {});
  const f = normalize({ ...F['fx-a-promoted'], checks: { ...F['fx-a-promoted'].checks, wd: { verdict: 'differs', observed: true } } });
  assert.ok(!('wd' in livePromotions(f)) && 'size' in livePromotions(f));
});

test('annotateScore applies and replaces the visit lines without touching a number', () => {
  const score = { overall: 61.2, parts: { amenities: 80 }, gates: ['unverified:fees', 'contradicted:old'], tags: ['thin data', TAG], reasons: [{ dim: 'amenities', text: 'x', items: ['keep', 'tour old line'] }, { dim: 'space', text: 'y' }] };
  const out = annotateScore(score, flagsFor(L['fx-a'], F['fx-a']));
  assert.deepEqual(out.gates, ['unverified:fees', 'contradicted:in_unit_wd', 'contradicted:sqft', 'contradicted:exposure']);
  assert.deepEqual(out.tags, ['thin data', TAG]);
  assert.deepEqual(out.reasons[0].items.slice(0, 1), ['keep']); assert.equal(out.reasons[0].items.length, 2);
  assert.equal(out.reasons[1].items.length, 1);
  assert.equal(out.overall, 61.2);
  assert.equal(JSON.stringify(score).includes('contradicted:in_unit_wd'), false, 'the input is not mutated');
  const cleared = annotateScore(out, flagsFor(L['fx-a'], {}));
  assert.deepEqual(cleared.gates, ['unverified:fees']);
  assert.deepEqual(cleared.tags, ['thin data']);
  assert.ok(!('items' in cleared.reasons[1]) && cleared.reasons[0].items.join() === 'keep');
});

test('the share summary leaves the free note out unless asked and labels each check', () => {
  const plain = shareTour(L['fx-a'], F['fx-a-promoted']), withNote = shareTour(L['fx-a'], F['fx-a-promoted'], { notes: true });
  assert.ok(!('note' in plain) && withNote.note.startsWith('Smelled damp'));
  assert.deepEqual(plain.checks.map((c) => [c.key, c.kind, c.promoted]), [['wd', 'contradicts', true], ['doorman', 'matches', false], ['size', 'contradicts', true], ['exposure', 'contradicts', true]]);
  assert.equal(plain.checks[0].listed, 'in-unit washer/dryer'); assert.equal(plain.checks[0].observed, 'no in-unit washer/dryer');
  assert.equal(shareTour(L['fx-a'], { observed: '2026-10-14' }), null);
  assert.equal(phrase('exposure', ['SSW', 'S']), 'faces SSW/S');
});

// ------------------------------------------------------------------ the trail
test('diffPick names each decision that changed', () => {
  assert.deepEqual(diffPick({}, { saved: true, tier: 'A' }), [{ kind: 'star', from: false, to: true }, { kind: 'tier', from: null, to: 'A' }]);
  assert.deepEqual(diffPick({ saved: true, tier: 'A', note: 'x', tour: 'a' }, { saved: true, tier: 'A', note: 'x', tour: 'a', updated: '2026-10-14' }), [], 'the updated stamp is not a decision');
  assert.deepEqual(diffPick({ saved: true, status: 'touring' }, { saved: true, status: 'applied' }), [{ kind: 'status', from: 'touring', to: 'applied' }]);
  assert.deepEqual(diffPicks({ a: { saved: true }, b: { saved: true } }, { a: { saved: true, tier: 'S' }, c: { saved: true } }).map((c) => [c.home, c.kind]), [['a', 'tier'], ['b', 'star'], ['c', 'star']]);
});

test('record adds revisions, folds rapid note edits and drops an edit that undoes itself', () => {
  const mk = (() => { let i = 0; return () => `id-${String(++i).padStart(3, '0')}`; })();
  let t = record([], [{ home: 'a', kind: 'star', from: false, to: true }, { home: 'a', kind: 'tier', from: null, to: 'A', why: 'light' }], '2026-10-14T10:00:00Z', mk);
  assert.equal(t.length, 2); assert.equal(t[1].why, 'light');
  t = record(t, [{ home: 'a', kind: 'note', from: null, to: 'ab' }], '2026-10-14T10:01:00Z', mk);
  t = record(t, [{ home: 'a', kind: 'note', from: 'ab', to: 'abc' }], '2026-10-14T10:02:00Z', mk);
  assert.equal(t.filter((x) => x.kind === 'note').length, 1, 'two edits within minutes are one revision');
  assert.equal(t.at(-1).to, 'abc'); assert.equal(t.at(-1).from, undefined);
  t = record(t, [{ home: 'a', kind: 'note', from: 'abc', to: null }], '2026-10-14T10:03:00Z', mk);
  assert.equal(t.filter((x) => x.kind === 'note').length, 0, 'typed and deleted inside the window leaves nothing');
  t = record(t, [{ home: 'a', kind: 'note', from: null, to: 'later' }], new Date(Date.parse('2026-10-14T10:03:00Z') + MERGE_MS + 1000).toISOString(), mk);
  t = record(t, [{ home: 'a', kind: 'tier', from: 'A', to: 'S' }, { home: 'a', kind: 'note', from: 'later', to: 'later!' }], '2026-10-15T10:00:00Z', mk);
  assert.equal(t.filter((x) => x.kind === 'note').length, 2, 'an edit after a different decision starts a new revision');
});

test('a reason attaches to its revision, and the trail is capped, merged and cleaned', () => {
  const t = record([], [{ home: 'a', kind: 'tier', from: 'A', to: 'B' }], NOW, () => 'rev-0001');
  assert.equal(withReason(t, 'rev-0001', '  damp  ')[0].why, 'damp');
  assert.equal(withReason(t, 'rev-0001', '   ')[0].why, undefined);
  assert.equal(merge(t, t).length, 1, 'importing the same trail twice adds nothing');
  const many = Array.from({ length: MAX_ENTRIES + 50 }, (_, i) => ({ e: `e-${String(i).padStart(5, '0')}`, home: 'a', at: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(), kind: 'star', to: true }));
  assert.equal(clean(many).length, MAX_ENTRIES); assert.equal(clean(many).at(-1).e, many.at(-1).e);
  assert.equal(clean(CASES.trail).length, 10, 'bad ids, bad kinds, bad dates and duplicates are dropped');
  assert.deepEqual(forHome(CASES.trail, 'fx-b').map((x) => x.kind), ['star']);
});

test('the share trail carries text and reasons only with the notes', () => {
  const plain = trailForShare(CASES.trail, 'fx-a'), notes = trailForShare(CASES.trail, 'fx-a', { notes: true });
  assert.ok(plain.every((x) => !('why' in x)) && notes.some((x) => x.why === 'Damp smell and no W/D'));
  assert.equal(plain.find((x) => x.kind === 'note').text, 'Note edited');
  assert.match(notes.find((x) => x.kind === 'note').text, /^Note: Prefer the bigger unit/);
  assert.equal(describe({ kind: 'promote', from: null, to: 'faces N' }), 'Promoted to a fact: faces N (the listing was silent)');
  assert.equal(describe({ kind: 'tier', from: 'A' }), 'Tier A cleared');
  assert.equal(describe({ kind: 'star', to: false }), 'Removed from your picks');
});
