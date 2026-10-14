// node --test tests/js : the tour-day planner (dashboard/js/features/tour-model.js): travel estimates, the timeline with
// booked times and leave-by, per-stop buffers, ordering, and the iCalendar and text exports.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULTS, toMin, fmtMin, clock12, metres, walkMinutes, transitEstimate, leg, visitMin, bookedMin, stationAccess, autoOrder, reconcile, moveStop, buildTimeline,
  icsLocal, icsText, icsFold, toICS, planText,
} from '../../dashboard/js/features/tour-model.js';

const A = { lat: 40.75, lon: -73.98 };
const at = (dLat, dLon = 0, extra = {}) => ({ lat: A.lat + dLat, lon: A.lon + dLon, ...extra });
const mk = (key, dLat, dLon = 0, extra = {}) => ({ key, name: key.toUpperCase() + ' Tower', address: `${key} Street, New York`, units: [{ id: key + '-1', label: '12B', price: 4800, tour: null }], ...at(dLat, dLon), ...extra });
const FROM = { name: 'Grand Central', ...at(-0.004) };

test('clock helpers round-trip and wrap past midnight', () => {
  assert.equal(toMin('09:05'), 545); assert.equal(toMin('9:05'), 545); assert.equal(toMin('24:00'), null); assert.equal(toMin('nope'), null); assert.equal(toMin(null), null);
  assert.equal(fmtMin(545), '09:05'); assert.equal(fmtMin(1500), '01:00'); assert.equal(fmtMin(-30), '23:30');
  assert.equal(clock12(0), '12:00 am'); assert.equal(clock12(12 * 60 + 5), '12:05 pm'); assert.equal(clock12(13 * 60 + 40), '1:40 pm');
});

test('walking uses the dashboard model: straight line x 1.25 at 4.8 km/h', () => {
  const b = at(0.0072);   // about 800 m north
  assert.ok(Math.abs(metres(A, b) - 796) < 5);
  const w = walkMinutes(A, b);
  assert.ok(Math.abs(w - (796 * 1.25) / 80) < 0.2, String(w));
  assert.equal(walkMinutes(A, { lat: null }), null);
});

test('a transit hop is each end\'s walk to the station, a wait and a ride; auto takes the faster, but never for a short hop', () => {
  const far = at(0.05, 0, { access: 4 }), here = { ...A, access: 5 };
  const t = transitEstimate(here, far);
  assert.equal(t.access, 9); assert.equal(t.wait, DEFAULTS.transitWait);
  assert.ok(Math.abs(t.ride - ((metres(here, far) * 1.2) / 1000 / 25) * 60) < 0.01);
  assert.equal(leg(here, far, 'auto').kind, 'transit', 'about 5.5 km: the train beats walking');
  assert.equal(leg(here, far, 'walk').kind, 'walk');
  assert.ok(leg(here, far, 'walk').min > leg(here, far, 'transit').min);
  assert.equal(leg(A, at(0.002), 'auto').kind, 'walk', 'a short hop is walked even if the estimate is lower');
  assert.equal(leg(A, at(0.002), 'transit').kind, 'transit', 'unless the renter says otherwise');
  assert.ok(leg(A, far).estimated === true);
  assert.equal(leg(A, { lat: null }).kind, 'none');
});

test('stations come from the first walking leg of the router\'s route', () => {
  assert.equal(stationAccess({ modes: { subway: { legs: [{ mode: 'walk', min: 4.6, to: 'Lexington Av/63 St' }, { mode: 'subway' }] } } }), 4.6);
  assert.equal(stationAccess({ modes: { subway: { legs: [{ mode: 'walk', min: 9.5, to: 'destination' }] } } }), null, 'walking the whole way says nothing about a station');
  assert.equal(stationAccess(null), null);
});

test('viewing time: 25 minutes for the first unit, 10 for each more, unless set', () => {
  assert.equal(visitMin(mk('a', 0)), 25);
  assert.equal(visitMin({ ...mk('a', 0), units: [{}, {}, {}] }), 45);
  assert.equal(visitMin(mk('a', 0), DEFAULTS, { a: 40 }), 40);
  const s = { ...mk('a', 0), units: [{ tour: '2026-10-17T14:30' }, { tour: '2026-10-18T09:00' }, { tour: '2026-10-17T11:15' }] };
  assert.equal(bookedMin(s, '2026-10-17'), 11 * 60 + 15, 'the earliest booking on that day');
  assert.equal(bookedMin(s, '2026-10-19'), null);
});

test('the timeline runs forward: leave, travel, view, buffer, next', () => {
  const stops = [mk('a', 0.0), mk('b', 0.006), mk('c', 0.012)];
  const tl = buildTimeline(stops, ['a', 'b', 'c'], { start: '10:00', day: '2026-10-17', from: FROM, defaultBuffer: 10 });
  assert.equal(tl.entries.length, 3);
  const [a, b, c] = tl.entries;
  assert.equal(a.leaveBy, 600);
  assert.equal(a.arrive, 600 + a.leg.min); assert.equal(a.start, a.arrive); assert.equal(a.end, a.start + 25); assert.equal(a.depart, a.end + 10);
  assert.equal(b.arrive, a.depart + b.leg.min); assert.equal(c.arrive, b.depart + c.leg.min);
  assert.equal(b.leaveBy, a.depart, 'with nothing booked you leave the moment the previous stop ends');
  assert.equal(tl.finish, c.end);
  assert.equal(tl.walk + tl.transit, a.leg.min + b.leg.min + c.leg.min);
  assert.equal(tl.viewing, 75); assert.equal(tl.lateStops, 0);
});

test('a per-stop buffer pushes every later stop back and the others stay put', () => {
  const stops = [mk('a', 0.0), mk('b', 0.006)];
  const base = buildTimeline(stops, ['a', 'b'], { start: '10:00', from: FROM, defaultBuffer: 10 });
  const more = buildTimeline(stops, ['a', 'b'], { start: '10:00', from: FROM, defaultBuffer: 10, buffer: { a: 25 } });
  assert.equal(more.entries[0].start, base.entries[0].start);
  assert.equal(more.entries[1].start, base.entries[1].start + 15);
  assert.equal(more.entries[0].buffer, 25);
  assert.equal(buildTimeline(stops, ['a', 'b'], { start: '10:00', from: FROM, defaultBuffer: 0 }).entries[1].start, base.entries[1].start - 10);
});

test('a booked stop waits for its time when you are early and reports minutes behind when you are late', () => {
  const day = '2026-10-17';
  const booked = (key, d, hhmm) => mk(key, d, 0, { units: [{ id: key, label: '5A', price: 4000, tour: `${day}T${hhmm}` }] });
  const early = buildTimeline([booked('a', 0.006, '11:30')], ['a'], { start: '10:00', day, from: FROM });
  const e = early.entries[0];
  assert.equal(e.start, 11 * 60 + 30); assert.equal(e.wait, 11 * 60 + 30 - e.arrive); assert.ok(e.wait > 0); assert.equal(e.late, 0);
  assert.equal(e.leaveBy, 11 * 60 + 30 - e.leg.min, 'the latest moment to set off');
  const late = buildTimeline([booked('a', 0.006, '10:00')], ['a'], { start: '10:00', day, from: FROM });
  assert.equal(late.entries[0].late, late.entries[0].arrive - 600); assert.ok(late.entries[0].late > 0); assert.equal(late.lateStops, 1);
  // a booking on another day is ignored
  assert.equal(buildTimeline([booked('a', 0.006, '11:30')], ['a'], { start: '10:00', day: '2026-10-18', from: FROM }).entries[0].booked, null);
  // a booked stop in the middle holds the next one back
  const chain = buildTimeline([mk('a', 0.0), booked('b', 0.006, '12:00'), mk('c', 0.012)], ['a', 'b', 'c'], { start: '10:00', day, from: FROM });
  assert.equal(chain.entries[1].start, 720); assert.ok(chain.entries[2].start > 720 + 25);
});

test('with no start place the first stop is where the day begins', () => {
  const tl = buildTimeline([mk('a', 0), mk('b', 0.006)], ['a', 'b'], { start: '09:30', from: null });
  assert.equal(tl.entries[0].leg.kind, 'none'); assert.equal(tl.entries[0].start, 570); assert.ok(tl.entries[1].leg.min > 0);
});

test('a leg can be fixed to walking or transit and the timeline follows', () => {
  const stops = [mk('a', 0), mk('b', 0.05)];
  const auto = buildTimeline(stops, ['a', 'b'], { start: '10:00', from: FROM });
  const walk = buildTimeline(stops, ['a', 'b'], { start: '10:00', from: FROM, modes: { b: 'walk' } });
  assert.equal(auto.entries[1].leg.kind, 'transit'); assert.equal(walk.entries[1].leg.kind, 'walk');
  assert.ok(walk.finish > auto.finish);
});

test('ordering: booked homes first in time order, the rest nearest-next; saved orders are reconciled; moves are clean', () => {
  const day = '2026-10-17';
  const stops = [mk('far', 0.03), mk('near', 0.001), mk('mid', 0.01), mk('late', 0.02, 0, { units: [{ tour: `${day}T15:00` }] }), mk('early', 0.025, 0, { units: [{ tour: `${day}T09:00` }] })];
  const order = autoOrder(stops, { start: FROM, day });
  assert.deepEqual(order.slice(0, 2), ['early', 'late'], 'booked ones in time order first');
  assert.equal(new Set(order).size, 5);
  assert.deepEqual(autoOrder([mk('far', 0.03), mk('near', 0.001), mk('mid', 0.01)], { start: FROM }), ['near', 'mid', 'far']);
  assert.deepEqual(autoOrder(stops, { start: FROM, day, mode: 'time' }).slice(0, 2), ['early', 'late']);
  assert.deepEqual(reconcile(['mid', 'gone', 'far'], stops), ['mid', 'far', 'near', 'late', 'early']);
  assert.deepEqual(moveStop(['a', 'b', 'c'], 0, 2), ['b', 'c', 'a']); assert.deepEqual(moveStop(['a', 'b', 'c'], 2, 0), ['c', 'a', 'b']); assert.deepEqual(moveStop(['a'], 0, 4), ['a']);
});

test('iCalendar: one event per stop with the address, valid line endings, folded long lines, escaped text, an alarm at the leave-by time', () => {
  const day = '2026-10-17';
  const stops = [mk('a', 0.0, 0, { name: 'Emerald, Green; Tower', address: '320 West 38 St, New York, NY' }), mk('b', 0.006, 0, { units: [{ label: '4A', price: 5000, tour: `${day}T11:30` }, { label: '9C', price: 5100 }] })];
  const tl = buildTimeline(stops, ['a', 'b'], { start: '10:00', day, from: FROM });
  const ics = toICS(tl, { day, calName: 'Apartment tours, fall', now: new Date(Date.UTC(2026, 9, 14, 12, 0, 0)), fromName: 'Grand Central' });
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n') && ics.endsWith('END:VCALENDAR\r\n'));
  assert.ok(!/(^|[^\r])\n/.test(ics), 'every line break is CRLF');
  for (const line of ics.split('\r\n')) assert.ok(new TextEncoder().encode(line).length <= 75, `too long: ${line}`);
  const unfolded = ics.replace(/\r\n /g, '');
  assert.equal((unfolded.match(/BEGIN:VEVENT/g) || []).length, 2); assert.equal((unfolded.match(/END:VEVENT/g) || []).length, 2);
  assert.ok(unfolded.includes('LOCATION:320 West 38 St\\, New York\\, NY'));
  assert.ok(unfolded.includes('SUMMARY:Tour: Emerald\\, Green\\; Tower 12B'));
  assert.ok(unfolded.includes('X-WR-CALNAME:Apartment tours\\, fall'));
  assert.ok(unfolded.includes('DTSTAMP:20261014T120000Z'));
  assert.ok(unfolded.includes(`DTSTART:${icsLocal(day, tl.entries[0].start)}`) && unfolded.includes(`DTEND:${icsLocal(day, tl.entries[0].end)}`));
  assert.ok(unfolded.includes('DTSTART:20261017T113000'), 'the booked stop starts at its booked time');
  assert.ok(unfolded.includes('Units: 4A ($5\\,000/mo)\\, 9C ($5\\,100/mo).'));
  assert.ok(unfolded.includes(`TRIGGER:-PT${tl.entries[1].leg.min}M`), 'the alarm fires when it is time to set off');
  assert.equal(new Set([...unfolded.matchAll(/UID:(.*)/g)].map((m) => m[1])).size, 2);
  assert.ok(/estimate/i.test(unfolded));
});

test('icsText, icsFold and icsLocal behave', () => {
  assert.equal(icsText('a,b;c\\d\ne'), 'a\\,b\\;c\\\\d\\ne');
  const long = 'DESCRIPTION:' + 'é'.repeat(80);
  const folded = icsFold(long).split('\r\n');
  assert.ok(folded.length > 1 && folded.slice(1).every((l) => l.startsWith(' ')));
  assert.equal(folded.map((l, i) => (i ? l.slice(1) : l)).join(''), long, 'unfolding gives the original back, no character split');
  assert.equal(icsLocal('2026-10-17', 10 * 60 + 5), '20261017T100500');
  assert.equal(icsLocal('2026-10-17', 24 * 60 + 30), '20261018T003000', 'past midnight rolls into the next day');
});

test('the text plan reads as a message', () => {
  const day = '2026-10-17', stops = [mk('a', 0), mk('b', 0.006, 0, { units: [{ label: '4A', price: 5000, tour: `${day}T11:30` }] })];
  const tl = buildTimeline(stops, ['a', 'b'], { start: '10:00', day, from: FROM });
  const t = planText(tl, { day, fromName: 'Grand Central' });
  assert.ok(t.startsWith('Tour plan for Saturday, October 17'));
  assert.ok(t.includes('Set off from Grand Central') && t.includes('1. A Tower') && t.includes('2. B Tower (4A)') && t.includes('[booked]') && t.includes('(estimate)'));
  assert.ok(/Finish about \d+:\d\d (am|pm)\. 2 stops/.test(t));
});
