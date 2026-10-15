// node --test tests/js : commute by time of day (features/timeofday-model.js, and the lens in criteria.js)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { slotsOf, timeOf, phrase, chip, clock, timesFor, minutesAt, scoredMinutes, summary, scoredOn, applyDelta, timesFile, modeKey, inflate } from '../../dashboard/js/features/timeofday-model.js';
import { modeMinutes, commutePart, setTimeLens } from '../../dashboard/js/criteria.js';

const SLOTS = [
  { id: 'am', label: 'Morning peak', kind: 'arrive', time: null, day: 'weekday' },
  { id: 'mid', label: 'Midday', kind: 'arrive', time: '13:00', day: 'weekday' },
  { id: 'pm', label: 'Evening peak, home', kind: 'depart', time: '18:00', day: 'weekday' },
  { id: 'late', label: 'Late evening, home', kind: 'depart', time: '22:00', day: 'weekday' },
  { id: 'wknd', label: 'Weekend', kind: 'arrive', time: '11:00', day: 'saturday' },
];
const DEST = { name: 'Office', arrive_by: '09:00', max_minutes: 30, weight: 1 };
const crit = (times = {}) => ({ commute: { destinations: [DEST], times: { slots: SLOTS, score: 'am', weights: { am: 3, pm: 3, mid: 1, late: 1, wknd: 1 }, ...times } } });
const ENTRY = { minutes: 20, modes: { transit: { minutes: 20 }, subway: { minutes: 22 }, walk: { minutes: 60 } }, times: { transit: [20, 24, 30, 40, null], subway: [22, 26, 31, 52, 30] } };
const HOME = { id: 'h', commute: { Office: ENTRY } };

test('labels: the destination arrive_by fills the first slot, direction and day read in words', () => {
  assert.deepEqual(slotsOf(crit()).map((s) => s.id), ['am', 'mid', 'pm', 'late', 'wknd']);
  assert.deepEqual(slotsOf({}), []);
  assert.equal(clock('09:00'), '9:00'); assert.equal(clock('18:30'), '18:30');
  assert.equal(timeOf(SLOTS[0], { arrive_by: '08:30' }), '08:30');
  assert.equal(phrase(SLOTS[0], DEST), 'arrive 9:00');
  assert.equal(phrase(SLOTS[2], DEST), 'leave 18:00');
  assert.equal(phrase(SLOTS[4], DEST), 'arrive 11:00 Saturday');
  assert.deepEqual(SLOTS.map((s) => chip(s, DEST)), ['9:00', '13:00', '18:00 home', '22:00 home', 'Sat 11:00']);
});

test('per-mode lists: best reads transit, walking has none, a missing answer is null', () => {
  assert.equal(modeKey('best'), 'transit'); assert.equal(modeKey('walk'), null);
  assert.deepEqual(timesFor(ENTRY, 'best'), [20, 24, 30, 40, null]);
  assert.equal(timesFor(ENTRY, 'walk'), null); assert.equal(timesFor({ minutes: 5 }, 'best'), null);
  assert.equal(minutesAt(ENTRY, 'subway', SLOTS, 'late'), 52);
  assert.equal(minutesAt(ENTRY, 'best', SLOTS, 'wknd'), null);
  assert.equal(minutesAt(ENTRY, 'best', SLOTS, 'nope'), null);
});

test('scoredMinutes: unchanged by default, a slot or the weighted day when the renter opts in (same numbers as score.scored_minutes)', () => {
  assert.equal(scoredMinutes(ENTRY, crit()), 20);
  assert.equal(scoredMinutes(ENTRY, {}), 20);
  assert.equal(scoredMinutes(ENTRY, crit({ score: 'pm' })), 30);
  assert.equal(scoredMinutes(ENTRY, crit({ score: 'wknd' })), 20);                  // no answer for that slot: the arrive-by trip
  assert.ok(Math.abs(scoredMinutes(ENTRY, crit({ score: 'weighted' })) - (20 * 3 + 24 + 30 * 3 + 40) / 8) < 1e-9);
  assert.equal(scoredMinutes(ENTRY, crit({ score: 'weighted', weights: { am: 1, pm: 1, mid: 0, late: 0, wknd: 0 } })), 25);
  assert.equal(scoredMinutes({ minutes: 18 }, crit({ score: 'pm' })), 18);           // an old run without times
  assert.equal(scoredMinutes(ENTRY, crit({ score: 'pm', enabled: false })), 20);
  assert.equal(scoredOn(crit()), null); assert.equal(scoredOn(crit({ score: 'weighted' })), 'weighted'); assert.equal(scoredOn(crit({ score: 'pm' })), 'pm');
});

test('the commute score follows the renter\'s choice and nothing else', () => {
  const base = commutePart(HOME, crit()).value;
  assert.ok(Math.abs(base - 83.3333) < 0.01);                   // 20 min against a 30 min limit
  assert.ok(commutePart(HOME, crit({ score: 'late' })).value < base);
  assert.equal(commutePart(HOME, crit({ score: 'am' })).value, base);
  setTimeLens({ slots: SLOTS, id: 'late' });                    // looking at late evening on the map does not move the score
  try { assert.equal(commutePart(HOME, crit()).value, base); } finally { setTimeLens(null); }
});

test('the lens: every surface that reads modeMinutes follows the time of day; walking and homes without times do not', () => {
  const d = DEST;
  assert.equal(modeMinutes(HOME, d, 'best'), 20);
  setTimeLens({ slots: SLOTS, id: 'pm' });
  try {
    assert.equal(modeMinutes(HOME, d, 'best'), 30);
    assert.equal(modeMinutes(HOME, d, 'subway'), 31);
    assert.equal(modeMinutes(HOME, d, 'walk'), 60);             // the same at any hour
    assert.equal(modeMinutes(HOME, d, 'bus'), null);
    assert.equal(modeMinutes({ id: 'old', commute: { Office: { minutes: 15, modes: { transit: { minutes: 15 } } } } }, d, 'best'), 15);
    setTimeLens({ slots: SLOTS, id: 'wknd' });
    assert.equal(modeMinutes(HOME, d, 'best'), null);            // no answer then: not a made-up number
  } finally { setTimeLens(null); }
  assert.equal(modeMinutes(HOME, d, 'best'), 20);
});

test('the drawer summary names the numbers and the fastest and slowest times', () => {
  const s = summary(ENTRY, 'best', SLOTS, DEST);
  assert.equal(s.rows.length, 5); assert.equal(s.fast.id, 'am'); assert.equal(s.slow.id, 'late'); assert.equal(s.spread, 20);
  assert.equal(s.text, '20 min to arrive at 9:00, 24 min to arrive at 13:00, 30 min to leave at 18:00, 40 min to leave at 22:00');
  assert.match(s.verdict, /Fastest arrive 9:00 \(20 min\), slowest leave 22:00 \(40 min\)/);
  assert.equal(summary(ENTRY, 'walk', SLOTS, DEST), null);
  assert.equal(summary({ times: { transit: [20, 20.4, 21, 21, 20] } }, 'best', SLOTS, DEST).verdict, 'About the same at every time of day.');
  assert.equal(summary({ times: { transit: [20, null, null, null, null] } }, 'best', SLOTS, DEST), null);
});

test('difference grids add whole minutes to the arrive-by grid, keep blanks, and honour the blank marker', async () => {
  const base = Float32Array.from([10, 22.5, -1, 40, 7]);
  const delta = Int8Array.from([5, -3, 9, -128, 0]);
  const out = applyDelta(base, new Uint8Array(delta.buffer));
  assert.deepEqual(Array.from(out), [15, 19.5, -1, -1, 7]);
  // what the browser does with the file's string: base64 -> inflate -> bytes
  const z = deflateSync(Buffer.from(delta.buffer)).toString('base64');
  assert.deepEqual(Array.from(new Int8Array((await inflate(z)).buffer)), Array.from(delta));
  assert.equal(timesFile('Grand Central'), 'commute-grand-central-times.json');
  assert.equal(timesFile('Mom & Dad\'s'), 'commute-mom-dad-s-times.json');
});
