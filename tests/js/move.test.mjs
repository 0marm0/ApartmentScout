// node --test tests/js : the move planner (dashboard/js/features/move-model.js): day arithmetic, the lease start, the dated timeline,
// the cash summary read from the scorer's cost model, the saved plan, and the iCalendar and Reminders exports.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  weekday, isBusinessDay, bizOnOrAfter, bizOnOrBefore, addBusinessDays, addDays, daysBetween, dayOf, label, LEAD_DAYS,
  normalize, patchHome, mergePlans, homeState, leaseStart, timeline, overlap, costs, planFor, toICS, toReminders, toChecklistText, STEP_IDS, fileName,
} from '../../dashboard/js/features/move-model.js';

const TODAY = '2026-10-15';   // a Thursday
const byId = (tl, id) => tl.steps.find((s) => s.id === id);
const dateOf = (tl, id) => byId(tl, id)?.date;

test('day arithmetic is calendar arithmetic on whole days: weekdays, business days, no daylight-saving drift', () => {
  assert.equal(weekday(dayOf('2026-10-15')), 4);   // Thursday
  assert.equal(weekday(dayOf('1970-01-01')), 4);
  assert.equal(weekday(dayOf('2026-10-17')), 6);
  assert.ok(isBusinessDay(dayOf('2026-10-16')) && !isBusinessDay(dayOf('2026-10-17')) && !isBusinessDay(dayOf('2026-10-18')));
  assert.equal(bizOnOrAfter(dayOf('2026-10-17')), dayOf('2026-10-19'));    // Saturday -> Monday
  assert.equal(bizOnOrBefore(dayOf('2026-10-18')), dayOf('2026-10-16'));   // Sunday -> Friday
  assert.equal(bizOnOrAfter(dayOf('2026-10-16')), dayOf('2026-10-16'));
  assert.equal(addBusinessDays(dayOf('2026-10-16'), 1), dayOf('2026-10-19'));  // Friday + 1 = Monday
  assert.equal(addBusinessDays(dayOf('2026-10-15'), 3), dayOf('2026-10-20'));
  assert.equal(addBusinessDays(dayOf('2026-10-15'), 0), dayOf('2026-10-15'));
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');        // across the clock change of 2026-11-01: still one calendar day
  assert.equal(addDays('2026-03-07', 2), '2026-03-09');
  assert.equal(daysBetween('2026-10-15', '2026-12-01'), 47);
  assert.equal(label('2026-10-28'), 'Wed, Oct 28');
  assert.equal(label('2026-10-28', { year: true }), 'Wed, Oct 28, 2026');
  assert.equal(label('nonsense'), '');
  assert.equal(dayOf('2026-02-30'), null);   // not a real date
});

// ------------------------------------------------------------------ the lease start
test('the lease start is the later of the window and the availability, never sooner than the lead time', () => {
  const win = { earliest: '2026-11-01', latest: '2026-12-01' };
  let s = leaseStart({ available: null, move_in: win, today: TODAY });
  assert.equal(s.date, '2026-11-01'); assert.equal(s.basis, 'window'); assert.ok(s.in_window); assert.equal(s.short_notice, false);
  s = leaseStart({ available: '2026-11-20', move_in: win, today: TODAY });
  assert.equal(s.date, '2026-11-20'); assert.equal(s.basis, 'available');
  s = leaseStart({ available: '2026-10-20', move_in: win, today: TODAY });
  assert.equal(s.date, '2026-11-01'); assert.match(s.notes.join(' '), /free before your window opens/);
  // the example search: the window opens today, which leaves no time to arrange anything
  s = leaseStart({ available: 'Now', move_in: { earliest: '2026-10-15', latest: '2026-11-01' }, today: TODAY });
  assert.equal(s.date, '2026-10-29'); assert.equal(s.basis, 'lead'); assert.ok(s.in_window); assert.match(s.notes.join(' '), /14 days from today/);
  assert.equal(daysBetween(TODAY, s.date), LEAD_DAYS);
});
test('a lease start outside the window says so, and a hard window says it is hard', () => {
  let s = leaseStart({ available: '2026-12-10', move_in: { earliest: '2026-11-01', latest: '2026-12-01', hard: true }, today: TODAY });
  assert.equal(s.after_window_days, 9); assert.ok(!s.in_window); assert.match(s.notes.join(' '), /9 days after your latest move-in \(a hard limit/);
  s = leaseStart({ available: null, move_in: { earliest: '2026-11-01', latest: '2026-12-01' }, today: TODAY, pick: '2026-10-25' });
  assert.equal(s.date, '2026-10-25'); assert.equal(s.basis, 'chosen'); assert.equal(s.before_window_days, 7); assert.ok(s.short_notice); assert.match(s.notes.join(' '), /Only 10 days from today/);
  s = leaseStart({ available: null, move_in: {}, today: TODAY });
  assert.equal(s.date, '2026-10-29'); assert.match(s.notes.join(' '), /No availability or move-in window/);
});

// ------------------------------------------------------------------ the timeline
test('with plenty of time every step lands on its ideal business day, in dependency order', () => {
  const tl = timeline({ start: '2026-12-01', today: TODAY });
  assert.equal(tl.tight, false); assert.equal(tl.days_out, 47);
  assert.deepEqual(Object.fromEntries(tl.steps.map((s) => [s.id, s.date])), {
    apply: '2026-10-27', approval: '2026-10-30', sign: '2026-11-03', pay: '2026-11-03', movers: '2026-11-10', reserve: '2026-11-17', internet: '2026-11-17',
    coi: '2026-11-20', utilities: '2026-11-20', usps: '2026-11-24', insurance: '2026-11-26', keys: '2026-12-01', move: '2026-12-01', address: '2026-12-04', condition: '2026-12-04',
  });
  assert.ok(tl.steps.every((s) => !s.squeezed && !s.overdue));
  const dates = tl.steps.map((s) => s.date); assert.deepEqual(dates, [...dates].sort());   // listed in date order
  // the order that matters: apply < approval < sign; movers before the building certificate; everything before the start but the after-move steps
  assert.ok(dateOf(tl, 'apply') < dateOf(tl, 'approval') && dateOf(tl, 'approval') < dateOf(tl, 'sign'));
  assert.ok(dateOf(tl, 'movers') <= dateOf(tl, 'coi') && dateOf(tl, 'reserve') <= dateOf(tl, 'coi'));
  assert.ok(['apply', 'approval', 'sign', 'pay', 'insurance', 'movers', 'reserve', 'coi', 'internet', 'utilities', 'usps'].every((id) => dateOf(tl, id) < '2026-12-01'));
  assert.ok(['apply', 'sign', 'coi', 'usps'].every((id) => isBusinessDay(dayOf(dateOf(tl, id)))));
  assert.equal(tl.next.id, 'apply'); assert.equal(tl.total, 15); assert.equal(tl.done, 0);
});
test('a short notice squeezes the steps against today but keeps their order', () => {
  const tl = timeline({ start: '2026-10-22', today: TODAY });   // a week away
  assert.ok(tl.tight);
  assert.equal(dateOf(tl, 'apply'), TODAY); assert.ok(byId(tl, 'apply').squeezed);
  assert.equal(dateOf(tl, 'approval'), '2026-10-20');
  assert.equal(dateOf(tl, 'sign'), '2026-10-21');
  for (const s of tl.steps) assert.ok(s.date >= TODAY, `${s.id} is not in the past`);
  for (const id of ['insurance', 'movers', 'reserve', 'coi', 'internet', 'utilities', 'usps']) assert.ok(dateOf(tl, id) >= dateOf(tl, 'sign'), `${id} after the signing`);
  assert.ok(dateOf(tl, 'coi') >= dateOf(tl, 'movers') && dateOf(tl, 'coi') >= dateOf(tl, 'reserve'));
  assert.ok(byId(tl, 'movers').squeezed);
  assert.equal(tl.overdue, 0);
});
test('a start 14 days out is not short notice; 13 is', () => {
  assert.equal(timeline({ start: '2026-10-29', today: TODAY }).tight, false);
  assert.equal(timeline({ start: '2026-10-28', today: TODAY }).tight, true);
});
test('the notice to the current landlord appears only with a current end date and uses the notice period', () => {
  assert.ok(!byId(timeline({ start: '2026-12-01', today: TODAY }), 'notice'));
  const st = { current_end: '2026-12-15', notice_days: 60 };
  const tl = timeline({ start: '2026-12-01', today: TODAY, state: st });
  assert.equal(dateOf(tl, 'notice'), '2026-10-16'); assert.equal(tl.notice_on, '2026-10-16');   // Oct 16 = Dec 15 minus 60 days, a Friday
  const late = timeline({ start: '2026-12-01', today: TODAY, state: { current_end: '2026-11-01' } });   // the notice date (Oct 2) has passed: it is today
  assert.equal(dateOf(late, 'notice'), TODAY); assert.ok(byId(late, 'notice').squeezed);
});
test('done steps keep their day, moved steps keep the renter\'s date, and overdue means past and not done', () => {
  const st = { done: { apply: '2026-10-15' }, dates: { movers: '2026-11-30', usps: '2026-10-01' }, custom: [{ id: 'c1', title: 'Buy a rug, measure first', date: '2026-11-05' }, { id: 'c2', title: 'Return the cable box' }] };
  const tl = timeline({ start: '2026-12-01', today: TODAY, state: st });
  assert.equal(byId(tl, 'apply').status, 'done'); assert.equal(tl.done, 1); assert.equal(tl.next.id, 'usps', 'the overdue step comes first');
  assert.equal(dateOf(tl, 'movers'), '2026-11-30'); assert.ok(byId(tl, 'movers').moved); assert.ok(!byId(tl, 'movers').squeezed);
  assert.equal(byId(tl, 'usps').status, 'overdue'); assert.equal(tl.overdue, 1);
  assert.equal(byId(tl, 'c1').date, '2026-11-05'); assert.ok(byId(tl, 'c1').custom);
  assert.equal(byId(tl, 'c2').date, '2026-12-01'); assert.ok(byId(tl, 'c2').dateless);   // no date: placed on the start
  const today = timeline({ start: '2026-12-01', today: '2026-10-27' });
  assert.equal(byId(today, 'apply').status, 'today');
  assert.equal(timeline({ start: '2026-12-01', today: '2026-10-25' }).steps.find((s) => s.id === 'apply').status, 'soon');
});
test('the timeline never invents a step outside its table and every id is stable', () => {
  assert.equal(STEP_IDS.length, new Set(STEP_IDS).size);
  const tl = timeline({ start: '2026-12-01', today: TODAY, state: { current_end: '2026-12-10' } });
  assert.ok(tl.steps.every((s) => STEP_IDS.includes(s.id)));
});

// ------------------------------------------------------------------ the money
const LISTING = {
  id: 'ex-1', building: 'The Example', unit: '12B', address: '1 Example St, New York, NY', available: '2026-11-15',
  price: { gross: 5000, fees_monthly: 50, application_fee: 20, deposit: 5000 },
  score: { monthly_cost: 4800, cost: { monthly: 4800, paid_month: 5050, rent: { gross: 5000 }, upfront: { first_month: 5050, deposit: 5000, one_time_fees: 520 }, move_in_min: 10570, move_in_unknown: [] } },
};
test('the cash summary reads the scorer\'s cost model: first month, deposit, application, other one-time fees', () => {
  const c = costs(LISTING, { start: '2026-11-15' });
  const L = Object.fromEntries(c.lines.map((l) => [l.id, l]));
  assert.equal(L.first_month.amount, 5050); assert.equal(L.deposit.amount, 5000); assert.ok(L.deposit.refundable);
  assert.equal(L.application_fee.amount, 20); assert.equal(L.one_time_fees.amount, 500);
  assert.equal(c.due_at_signing, 5050 + 5000 + 20 + 500);
  assert.equal(c.due_at_signing, c.scorer_min, 'the planner and the scorer agree on the cash to move in');
  assert.deepEqual(c.signing_unknown, []);
  assert.equal(c.refundable, 5000);
  assert.deepEqual(c.unknown, ['Movers']);   // the renter has not given an estimate yet; insurance and "anything else" are optional
  assert.equal(c.total, c.due_at_signing);
});
test('what the renter adds is counted; what nobody knows is named, never counted as zero', () => {
  const st = { movers: 900, insurance: 18, other: 150 };
  const c = costs(LISTING, { start: '2026-11-15', state: st });
  assert.equal(c.total, 10570 + 900 + 18 + 150); assert.deepEqual(c.unknown, []);
  // a listing with no deposit and no fee schedule: both are unknown, and the total is a floor
  const bare = { id: 'b', price: { gross: 4000 }, score: { cost: { paid_month: 4000, upfront: { first_month: 4000, deposit: null, one_time_fees: null }, move_in_unknown: ['deposit', 'one-time fees'] } } };
  const b = costs(bare, { start: '2026-11-15' });
  assert.equal(b.due_at_signing, 4000); assert.deepEqual(b.signing_unknown, ['Security deposit', 'Application, broker and move-in fees']);
  assert.deepEqual(b.unknown, ['Security deposit', 'Application, broker and move-in fees', 'Movers']);
  assert.equal(b.lines.find((l) => l.id === 'deposit').amount, null);
  assert.match(toChecklistText(timeline({ start: '2026-11-15', today: TODAY }), b, { home: 'Bare' }), /Due at signing: \$4,000 plus security deposit, application, broker and move-in fees/);
});
test('overlap rent is the new rent for the days both leases run; a gap is named, not priced', () => {
  const o = overlap({ start: '2026-11-01', current_end: '2026-11-16', monthly: 6000 });
  assert.equal(o.days, 15); assert.equal(o.rent, Math.round((6000 * 15 / 30.4375) * 100) / 100); assert.equal(o.gap_days, 0);
  const gap = overlap({ start: '2026-11-16', current_end: '2026-11-10', monthly: 6000 });
  assert.equal(gap.days, 0); assert.equal(gap.rent, 0); assert.equal(gap.gap_days, 6);
  assert.deepEqual(overlap({ start: '2026-11-01', current_end: null, monthly: 6000 }), { days: 0, rent: null, gap_days: 0 });
  const c = costs(LISTING, { start: '2026-11-15', state: { current_end: '2026-11-30', movers: 800 } });
  const line = c.lines.find((l) => l.id === 'overlap');
  assert.equal(line.amount, Math.round((5050 * 15 / 30.4375) * 100) / 100); assert.match(line.note, /15 days where both leases run/);
  assert.equal(c.total, c.due_at_signing + 800 + line.amount);
});

test('planFor joins the lease start, the timeline and the cash for a home', () => {
  const p = planFor({ listing: LISTING, criteria: { search: { move_in: { earliest: '2026-11-01', latest: '2026-12-01' } } }, today: TODAY, plan: null });
  assert.equal(p.lease.date, '2026-11-15'); assert.equal(p.lease.basis, 'available');
  assert.equal(p.timeline.start, '2026-11-15'); assert.equal(p.costs.start, '2026-11-15');
  const mine = planFor({ listing: LISTING, criteria: {}, today: TODAY, plan: { homes: { 'ex-1': { start: '2026-12-01' } } } });
  assert.equal(mine.lease.date, '2026-12-01'); assert.equal(mine.lease.basis, 'chosen');
});

// ------------------------------------------------------------------ what is saved
test('normalize keeps only the documented shape', () => {
  const raw = { v: 9, chosen: 'ex-1', extra: 1, homes: {
    'ex-1': { start: '2026-11-15', current_end: 'soon', notice_days: 45.4, movers: '900', insurance: -5, other: 1e12, done: { apply: '2026-10-15', bad: 'x', '': '2026-10-01' }, dates: { sign: '2026-11-02', 'bad id!': '2026-11-02' },
      custom: [{ id: 'c1', title: '  Buy   a rug ', date: '2026-11-05', done: '2026-11-06' }, { id: 'c1', title: 'dup' }, { id: 'c2', title: '' }, 'x'], updated: '2026-10-15', note: 'secret' },
    'bad id': { start: '2026-11-15' }, 'ex-2': 'nope' } };
  const n = normalize(raw);
  assert.deepEqual(n, { v: 1, chosen: 'ex-1', homes: { 'ex-1': { done: { apply: '2026-10-15' }, dates: { sign: '2026-11-02' }, custom: [{ id: 'c1', title: 'Buy a rug', date: '2026-11-05', done: '2026-11-06' }], start: '2026-11-15', updated: '2026-10-15', notice_days: 45, movers: 900 } } });
  assert.deepEqual(normalize(null), { v: 1, homes: {} }); assert.deepEqual(normalize([]), { v: 1, homes: {} }); assert.deepEqual(normalize({ homes: 7 }), { v: 1, homes: {} });
  assert.equal(JSON.stringify(normalize(n)), JSON.stringify(n), 'normalising twice changes nothing');
});
test('patchHome sets, removes and stamps; mergePlans keeps the newer home', () => {
  let p = patchHome(null, 'ex-1', { start: '2026-11-15', movers: 900 }, '2026-10-15');
  assert.equal(p.homes['ex-1'].start, '2026-11-15'); assert.equal(p.homes['ex-1'].updated, '2026-10-15');
  p = patchHome(p, 'ex-1', { start: null, done: { apply: '2026-10-15' } }, '2026-10-16');
  assert.equal(p.homes['ex-1'].start, undefined); assert.equal(p.homes['ex-1'].movers, 900); assert.deepEqual(p.homes['ex-1'].done, { apply: '2026-10-15' });
  assert.deepEqual(homeState(null, 'zzz'), { done: {}, dates: {}, custom: [] });
  const a = { chosen: 'a', homes: { a: { movers: 1, updated: '2026-10-01' }, b: { movers: 2, updated: '2026-10-09' } } }, b = { chosen: 'b', homes: { a: { movers: 5, updated: '2026-10-05' }, b: { movers: 7, updated: '2026-10-02' } } };
  const m = mergePlans(a, b);
  assert.equal(m.homes.a.movers, 5); assert.equal(m.homes.b.movers, 2); assert.equal(m.chosen, 'b');
});

// ------------------------------------------------------------------ exports
const unfold = (s) => s.replace(/\r\n /g, '');
test('the iCalendar export is well formed: balanced, CRLF, folded at 75 octets, escaped, one all-day event per open step', () => {
  const tl = timeline({ start: '2026-12-01', today: TODAY, state: { done: { apply: '2026-10-15' }, custom: [{ id: 'c1', title: 'Rug; measure, then buy', date: '2026-11-05' }] } });
  const ics = toICS(tl, { home: 'The Example 12B', address: '1 Example St, New York, NY', now: new Date('2026-10-15T12:00:00Z') });
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n') && ics.endsWith('END:VCALENDAR\r\n'));
  assert.ok(!/[^\r]\n/.test(ics), 'every line ends in CRLF');
  for (const line of ics.split('\r\n')) assert.ok(new TextEncoder().encode(line).length <= 75, `folded: ${line.length}`);
  const text = unfold(ics), lines = text.split('\r\n').filter(Boolean);
  const stack = [];
  for (const l of lines) { if (l.startsWith('BEGIN:')) stack.push(l.slice(6)); else if (l.startsWith('END:')) assert.equal(stack.pop(), l.slice(4)); }
  assert.deepEqual(stack, []);
  const events = text.split('BEGIN:VEVENT').slice(1);
  assert.equal(events.length, tl.steps.filter((s) => !s.done).length);   // the ticked-off step is left out
  const uids = new Set();
  for (const e of events) {
    assert.match(e, /\r\nUID:[a-z0-9.-]+@apartmentscout\r\n/); uids.add(/UID:(.*)\r\n/.exec(e)[1]);
    assert.match(e, /DTSTAMP:20261015T120000Z/);
    const s = /DTSTART;VALUE=DATE:(\d{8})/.exec(e)[1], d = /DTEND;VALUE=DATE:(\d{8})/.exec(e)[1];
    assert.equal(daysBetween(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}`, `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`), 1, 'an all-day event ends the next day');
    assert.match(e, /BEGIN:VALARM\r\nACTION:DISPLAY\r\nDESCRIPTION:.+\r\nTRIGGER:PT9H\r\nEND:VALARM/);
  }
  assert.equal(uids.size, events.length, 'UIDs are unique');
  assert.ok(text.includes('SUMMARY:Rug\\; measure\\, then buy'), 'semicolons and commas are escaped');
  assert.ok(text.includes('LOCATION:1 Example St\\, New York\\, NY'));
  assert.ok(text.includes('SUMMARY:Move in: The Example 12B'));
  assert.ok(!text.includes('SUMMARY:Submit your application'));
  assert.ok(toICS(tl, { home: 'x', all: true, now: new Date(0) }).includes('SUMMARY:Submit your application'));
});
test('the Reminders text is one line per open step, with its due day; the header can be left out', () => {
  const tl = timeline({ start: '2026-12-01', today: TODAY, state: { done: { apply: '2026-10-15' } } });
  const t = toReminders(tl, { home: 'The Example 12B' }).split('\n');
  assert.equal(t[0], 'Move to The Example 12B: lease starts Tue, Dec 1, 2026');
  assert.equal(t.length, 1 + tl.steps.length - 1);
  assert.ok(t.includes('Sign the lease (due Tue, Nov 3)'));
  assert.ok(!t.some((l) => l.startsWith('Submit your application')));
  assert.equal(toReminders(tl, { header: false }).split('\n').length, tl.steps.length - 1);
});
test('the checklist text lists every step with its day and the cash lines', () => {
  const tl = timeline({ start: '2026-12-01', today: TODAY, state: { done: { apply: '2026-10-15' } } });
  const t = toChecklistText(tl, costs(LISTING, { start: '2026-12-01', state: { movers: 900 } }), { home: 'The Example 12B' });
  assert.match(t, /^Move plan: The Example 12B\nLease starts Tue, Dec 1, 2026/);
  assert.match(t, /\[x\] Tue, Oct 27  Submit your application/);
  assert.match(t, /\[ \] Tue, Nov 3  Sign the lease/);
  assert.match(t, /Security deposit: \$5,000 \(refundable\)/);
  assert.match(t, /Movers: \$900/);
  assert.equal(fileName('The Example 12B', 'ics'), 'move-plan-the-example-12b.ics');
});
