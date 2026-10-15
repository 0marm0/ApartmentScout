// node --test tests/js : Tour day (dashboard/js/features/tourday-model.js): today's route, directions links, the checklist built from the
// criteria and the unknowns, how answers land in the tour findings (and the note), the microphone maths and the summary card.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  localDay, tourWhen, toursOn, addable, normalizeState, routeIds, stopOf, routeOrder, routeLegs, hopText, isApple, directionsUrl,
  buildChecklist, allItems, valueOf, progress, wdCheck, noiseFindings, applyToFindings, setExtra, splitNote, joinNote, noteBlock, NOTE_MARK,
  rmsDb, summarizeLevels, noiseWord, suggestRating, summaryChips, openQuestions, summaryText, MIC_OFFSET_DB,
} from '../../dashboard/js/features/tourday-model.js';
import { normalize, assess } from '../../dashboard/js/features/findings-model.js';

const DAY = '2026-10-15';
const L = (id, extra = {}) => ({ id, building: id.toUpperCase(), unit: '12B', address: `${id} Street, New York, NY`, lat: 40.75, lon: -73.98, amenities: { in_unit_wd: true, elevator: null, gym: true }, ...extra });
const CRIT = { must_have: ['in_unit_wd', 'elevator'], strongly_prefer: ['doorman', 'gym'], nice_to_have: ['roof_deck', 'dishwasher'], weights: { light_view: 15, quiet: 5, interior: 0 } };

test('today is the local calendar day and a tour time splits into day and minutes', () => {
  assert.equal(localDay(new Date(2026, 9, 5, 23, 59)), '2026-10-05');
  assert.deepEqual(tourWhen('2026-10-15T09:45'), { day: DAY, min: 585 });
  assert.deepEqual(tourWhen('2026-10-15'), { day: DAY, min: null });
  assert.equal(tourWhen('soon'), null); assert.equal(tourWhen(null), null);
});

test('toursOn lists the homes booked today in time order and leaves out Pass, other days and unknown homes', () => {
  const picks = {
    b: { saved: true, tour: `${DAY}T14:00` }, a: { saved: true, tour: `${DAY}T09:30` }, c: { saved: true, tour: '2026-10-16T09:00' },
    d: { tier: 'Pass', tour: `${DAY}T11:00` }, e: { saved: true, tour: `${DAY}T10:00` }, x: { saved: true, tour: `${DAY}T08:00` }, n: { saved: true, tour: DAY },
  };
  assert.deepEqual(toursOn(picks, DAY, (id) => id !== 'x'), ['a', 'e', 'b', 'n']);
  assert.deepEqual(toursOn({}, DAY), []);
});

test('addable offers saved or touring homes that are not already on the route', () => {
  const picks = { a: { saved: true }, b: { saved: true, tier: 'Pass' }, c: { tier: 'Top' }, d: { note: 'just a note' }, e: { saved: true } };
  assert.deepEqual(addable(picks, ['e'], () => true), ['a', 'c']);
});

test('the saved state keeps the day\'s picks for today only, and the answers and done marks for good', () => {
  const raw = { day: '2026-10-14', picked: ['a'], order: ['a'], removed: ['b'], done: { a: '2026-10-14', bad: 3 }, ex: { a: { yn: { am_gym: true } } }, mode: 'near' };
  const s = normalizeState(raw, DAY);
  assert.deepEqual([s.picked, s.order, s.removed], [[], [], []]);
  assert.deepEqual(s.done, { a: '2026-10-14' }); assert.deepEqual(s.ex, raw.ex); assert.equal(s.mode, 'near');
  assert.deepEqual(normalizeState({ ...raw, day: DAY }, DAY).picked, ['a']);
  assert.deepEqual(normalizeState('junk', DAY), { day: DAY, mode: 'time', picked: [], order: [], removed: [], done: {}, ex: {} });
  assert.deepEqual(routeIds({ removed: ['b'], picked: ['c', 'a'] }, ['a', 'b']), ['a', 'c']);
});

test('the route is booked homes in time order, or booked first then the nearest next; a saved order is kept; hops are estimates', () => {
  const homes = [L('far', { lat: 40.78 }), L('mid', { lat: 40.76 }), L('near', { lat: 40.751 })];
  const picks = { mid: { tour: `${DAY}T11:00` }, near: { tour: `${DAY}T09:00` }, far: { tour: null } };
  const stops = homes.map((h) => stopOf(h, picks[h.id], {}, null));
  const state = { day: DAY, mode: 'time', order: [] };
  assert.deepEqual(routeOrder(stops, state), ['near', 'mid', 'far']);
  assert.deepEqual(routeOrder(stops, { ...state, mode: 'near' }), ['near', 'mid', 'far']);
  assert.deepEqual(routeOrder(stops, { ...state, order: ['far', 'near', 'gone'] }), ['far', 'near', 'mid']);
  const legs = routeLegs(stops, ['near', 'mid', 'far'], DAY);
  assert.equal(legs[0].hop, null); assert.equal(legs[0].booked, 540);
  assert.ok(legs[1].hop.min >= 1 && legs[1].hop.estimated); assert.equal(legs[1].leaveBy, 660 - legs[1].hop.min); assert.equal(legs[2].booked, null);
  assert.match(hopText(legs[1].hop), /^\d+ min (on foot|by transit)$/); assert.equal(hopText(null), '');
});

test('directions links carry the address, the mode and no key; Apple Maps is chosen on iPhone and iPad', () => {
  const to = { address: '515 West 38th Street, New York, NY', lat: 40.7, lon: -74 };
  assert.equal(directionsUrl(to), 'https://www.google.com/maps/dir/?api=1&destination=515%20West%2038th%20Street%2C%20New%20York%2C%20NY&travelmode=walking');
  assert.match(directionsUrl(to, { kind: 'transit' }), /travelmode=transit$/);
  assert.equal(directionsUrl(to, { apple: true, kind: 'transit' }), 'https://maps.apple.com/?daddr=515%20West%2038th%20Street%2C%20New%20York%2C%20NY&dirflg=r');
  assert.match(directionsUrl({ lat: 40.7, lon: -74 }), /destination=40\.7%2C-74/);
  assert.equal(directionsUrl({}), null);
  assert.ok(isApple('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)', 'iPhone', 5)); assert.ok(isApple('Mozilla/5.0 (Macintosh)', 'MacIntel', 5));
  assert.ok(!isApple('Mozilla/5.0 (Macintosh)', 'MacIntel', 0)); assert.ok(!isApple('Mozilla/5.0 (Linux; Android 14)', 'Linux armv8l', 5));
});

test('the checklist is the core questions, the wanted amenities the listing does not state, and the office questions the score is unsure about', () => {
  const c = buildChecklist(L('a', { score: { gates: ['unverified:fees', 'unverified:lease_term', 'over_budget', 'unverified:fees'] } }), CRIT);
  assert.deepEqual(c.core.map((i) => i.key), ['light', 'facing', 'noise_shut', 'noise_open', 'water', 'signal', 'wd', 'closets']);
  assert.deepEqual(c.unknowns.map((i) => i.key), ['am_elevator', 'am_doorman', 'am_roof_deck', 'am_dishwasher']);   // W/D and gym are stated
  assert.deepEqual(c.asks.map((i) => i.key), ['ask_fees', 'ask_lease']);
  assert.match(c.core[0].why, /light and view 15/); assert.equal(c.core.find((i) => i.key === 'closets').why, '');   // weight 0 says nothing
  assert.match(c.core.find((i) => i.key === 'wd').why, /must-have/);
  assert.match(c.core[1].hint, /does not say/); assert.match(buildChecklist(L('b', { exposure: ['SSW'] }), CRIT).core[1].hint, /Listing: SSW/);
  assert.equal(allItems(c).length, 14);
  assert.deepEqual(buildChecklist(L('c', { amenities: {} }), {}).unknowns, []);   // nothing wanted, nothing asked
});

test('an answer lands in the findings fields the visit sheet already has; the schema does not grow', () => {
  const home = L('a');
  let f = {};
  f = applyToFindings(f, 'light', 4, { L: home }); f = applyToFindings(f, 'facing', 'SW', { L: home });
  f = applyToFindings(f, 'water', 3, { L: home }); f = applyToFindings(f, 'signal', 0, { L: home }); f = applyToFindings(f, 'closets', 2, { L: home });
  const n = normalize(f);
  assert.equal(n.light.rating, 4); assert.match(n.light.time, /^\d\d:\d\d$/); assert.equal(n.light.facing, 'SW');
  assert.equal(n.water, 3); assert.equal(n.signal, 0); assert.equal(n.closets, 2);
  const cleared = normalize(applyToFindings(applyToFindings(f, 'water', null, { L: home }), 'facing', null, { L: home }));
  assert.equal(cleared.water, undefined); assert.equal(cleared.light.facing, undefined); assert.equal(cleared.light.rating, 4);
  for (const k of Object.keys(normalize(f))) assert.ok(['v', 'light', 'water', 'signal', 'closets'].includes(k), k);
});

test('the W/D answer matches the listing, differs from it, or adds to a silent one; a changed answer withdraws a promotion', () => {
  const yes = L('a'), silent = L('b', { amenities: {} });
  assert.deepEqual(wdCheck(yes, true), { verdict: 'match' }); assert.deepEqual(wdCheck(yes, false), { verdict: 'differs', observed: false });
  assert.deepEqual(wdCheck(silent, true), { verdict: 'differs', observed: true }); assert.equal(wdCheck(yes, null), null);
  const f1 = applyToFindings({}, 'wd', false, { L: yes });
  assert.equal(assess(yes, 'wd', normalize(f1).checks.wd).kind, 'contradicts');
  const promoted = { ...f1, promoted: { wd: { value: false, observed_at: DAY } } };
  assert.ok(normalize(promoted).promoted.wd);
  assert.equal(normalize(applyToFindings(promoted, 'wd', true, { L: yes })).promoted, undefined);   // it now matches: nothing left to promote
  assert.equal(normalize(applyToFindings(promoted, 'wd', null, { L: yes })).checks, undefined);
});

test('noise: shut and open are kept apart, the louder one is the findings rating and the higher reading the dB', () => {
  let ex = setExtra({}, 'noise', 'shut', { r: 2 }); ex = setExtra(ex, 'noise', 'open', { r: 4, db: 58 });
  assert.deepEqual(noiseFindings(ex), { rating: 4, db: 58 });
  ex = setExtra(ex, 'noise', 'shut', { db: 41 });
  assert.deepEqual(noiseFindings(ex), { rating: 4, db: 58 });
  const f = normalize(applyToFindings({}, 'noise_open', 4, { L: L('a'), ex }));
  assert.deepEqual(f.noise, { rating: 4, db: 58 });
  assert.deepEqual(noiseFindings(setExtra(setExtra({}, 'noise', 'shut', { r: null }), 'noise', 'open', { r: null })), { rating: null, db: null });
  assert.equal(setExtra(setExtra({}, 'noise', 'shut', { r: 3 }), 'noise', 'shut', { r: null }).noise, undefined);
});

test('extras: yes/no answers and "asked" ticks come and go without leaving empty sections', () => {
  let ex = setExtra({}, 'yn', 'am_gym', true); ex = setExtra(ex, 'yn', 'am_pool', false); ex = setExtra(ex, 'ask', 'fees', true);
  assert.deepEqual(ex, { yn: { am_gym: true, am_pool: false }, ask: { fees: true } });
  ex = setExtra(ex, 'yn', 'am_gym', null); ex = setExtra(ex, 'ask', 'fees', false);
  assert.deepEqual(ex, { yn: { am_pool: false } });
  assert.deepEqual(setExtra(ex, 'yn', 'am_pool', null), {});
});

test('the note keeps the renter\'s text first and a generated block after a marker; both survive a round trip', () => {
  const c = buildChecklist(L('a', { score: { gates: ['unverified:fees'] } }), CRIT);
  let ex = setExtra({}, 'noise', 'open', { r: 4, db: 58 }); ex = setExtra(ex, 'yn', 'am_roof_deck', true); ex = setExtra(ex, 'yn', 'am_dishwasher', false); ex = setExtra(ex, 'ask', 'fees', true);
  const block = noteBlock(c, ex);
  assert.equal(block, 'Noise, windows open: 4 of 5, about 58 dB (phone microphone, approximate).\nRoof deck: yes.\nDishwasher: no.\nAsked the office: monthly fees.');
  const note = joinNote('Friendly super.', block);
  assert.ok(note.startsWith('Friendly super.\n\n' + NOTE_MARK));
  assert.deepEqual(splitNote(note), { text: 'Friendly super.', block });
  assert.deepEqual(splitNote('only mine'), { text: 'only mine', block: '' }); assert.equal(joinNote('', ''), ''); assert.equal(joinNote('mine', ''), 'mine');
  assert.equal(normalize({ note }).note, note, 'the findings schema keeps it whole');
  assert.ok(joinNote('x'.repeat(5000), block).length <= 4000);
});

test('answered items count toward progress; "asked" counts only when ticked', () => {
  const c = buildChecklist(L('a', { score: { gates: ['unverified:fees'] } }), CRIT);
  assert.deepEqual(progress(c, {}, {}), { done: 0, total: 13, core: 0, coreTotal: 8 });
  const f = normalize({ water: 4, light: { rating: 3 }, checks: { wd: { verdict: 'match' } } });
  const ex = { noise: { shut: { r: 2 } }, yn: { am_doorman: true }, ask: { fees: true } };
  const p = progress(c, f, ex);
  assert.deepEqual([p.done, p.core], [6, 4]);
  const wd = c.core.find((i) => i.key === 'wd');
  assert.equal(valueOf(wd, f, ex), 'match'); assert.equal(valueOf(c.core[3], f, ex), null);
  assert.equal(valueOf(wd, normalize({ checks: { wd: { verdict: 'differs', observed: false } } }), {}), false);
  assert.equal(valueOf(wd, normalize({ checks: { wd: { verdict: 'unsure' } } }), {}), null);
});

test('the microphone: RMS to an approximate dB, the equivalent level of a run, and the words for it', () => {
  assert.equal(MIC_OFFSET_DB, 100);
  assert.equal(Math.round(rmsDb(new Float32Array(256).fill(0.01))), 60);   // -40 dBFS + 100
  assert.equal(rmsDb(new Float32Array(256)), 20, 'silence is clamped, not minus infinity');
  assert.equal(rmsDb(new Float32Array(256).fill(1)), 100);
  assert.equal(rmsDb(new Float32Array(0)), 20);
  const s = summarizeLevels([40, 40, 40, 60]);
  assert.equal(s.leq, 54); assert.equal(s.peak, 60); assert.equal(s.quiet, 40); assert.equal(s.n, 4);   // loud moments weigh more than a plain mean (45)
  assert.equal(summarizeLevels([]), null); assert.equal(summarizeLevels([NaN]), null);
  assert.deepEqual([30, 40, 50, 60, 70].map(noiseWord), ['very quiet', 'quiet', 'moderate', 'busy', 'loud']);
  assert.deepEqual([30, 40, 50, 60, 70].map(suggestRating), [1, 2, 3, 4, 5]);
});

test('the summary card reads the findings and the extras, flags tones, lists what is still open, and copies as text', () => {
  const home = L('a', { score: { gates: ['unverified:fees'] } }), c = buildChecklist(home, CRIT);
  const f = normalize({ light: { rating: 5, facing: 'S' }, water: 2, signal: 1, closets: 3, ceiling: 9.5, checks: { wd: { verdict: 'differs', observed: false } }, note: joinNote('Loud street.', '') });
  const ex = { noise: { shut: { r: 2, db: 41 }, open: { r: 5 } }, yn: { am_dishwasher: true } };
  const chips = summaryChips(home, f, ex, c), by = Object.fromEntries(chips.map((x) => [x.k, x]));
  assert.deepEqual([by.Light.v, by.Light.tone], ['5 of 5, faces S', 'good']);
  assert.deepEqual([by['Noise, windows shut'].v, by['Noise, windows shut'].tone], ['2 of 5, ~41 dB', 'good']);
  assert.deepEqual([by['Noise, windows open'].v, by['Noise, windows open'].tone], ['5 of 5', 'bad']);
  assert.deepEqual([by['Water pressure'].tone, by['Cell signal'].v, by['Cell signal'].tone], ['bad', '1 bar', 'bad']);
  assert.deepEqual([by['Washer/dryer'].v, by['Washer/dryer'].tone], ['not in the unit', 'bad']);
  assert.equal(by.Closets.v, '3'); assert.equal(by.Ceiling.v, "9' 6\""); assert.equal(by.Dishwasher.v, 'yes');
  const open = openQuestions(c, f, ex);
  assert.ok(open.includes('ask monthly fees') && open.includes('Elevator') && !open.includes('Dishwasher'));
  const text = summaryText('Home A 12B', chips, { note: 'Loud street.', photos: 2, open });
  assert.match(text, /^Home A 12B\n- Light: 5 of 5, faces S\n/); assert.match(text, /- Photos: 2\n- Note: Loud street\.\n- Still to find out: ask monthly fees; /);
  assert.deepEqual(summaryChips(home, {}, {}, c), []);
});
