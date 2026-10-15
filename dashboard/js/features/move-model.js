// Move planner: the pure part. From a chosen home, the criteria's move-in window and today's date it works out the day each step
// of a move should happen (application, approval, lease signing, deposit, insurance, movers, utilities and internet, the USPS
// change of address, the building's move-in reservation and the movers' certificate of insurance, key pickup), what the move costs
// in cash (read from the scorer's cost model, never recomputed), the checklist state the renter keeps, and the two exports: an
// iCalendar file and a list that pastes into Reminders. No DOM, no storage: `node --test` loads it as is.
//
// The renter's own data lives under ONE key. In this browser it is `as:moveplan:<search name>`; in a picks backup it is the
// top-level `moveplan` object (see docs/guides/data-model.md, "Move plan"). Its shape is documented at normalize().
//
// Dates are ISO days (YYYY-MM-DD) and arithmetic runs on day numbers (days since 1970-01-01, UTC), so no time zone or daylight-saving
// change can shift a date. "Business day" means Monday to Friday; public holidays are not known and are not skipped.
import { parseDay, dayISO } from '../criteria.js';
import { icsText, icsFold, icsUTC } from './tour-model.js';

export const VERSION = 1;
export const KEY = 'moveplan';
export const LEAD_DAYS = 14;        // the least notice a move can sensibly have: apply, be approved, sign, book movers and the lift
export const IDEAL_LEAD_DAYS = 35;  // the notice the timeline is drawn for when there is time
export const SQUEEZE_DAYS = 5;      // a step later than its ideal day by more than this is "squeezed in"
export const NOTICE_DAYS = 30;     // days of notice the renter's current lease asks for, unless they say otherwise
export const MAX_CUSTOM = 30;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const num = (v) => { const x = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN; return Number.isFinite(x) ? x : null; };
const money = (v, lo = 0, hi = 1e7) => { const x = num(v); return x != null && x >= lo && x <= hi ? Math.round(x * 100) / 100 : null; };
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const iso = (v) => (typeof v === 'string' && ISO.test(v.slice(0, 10)) && parseDay(v.slice(0, 10)) != null ? v.slice(0, 10) : null);
const text = (v, n) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '');
const sid = (v) => (typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(v) ? v : null);

// ------------------------------------------------------------------ day arithmetic
/** ISO day to a day number (null when it is not a real date). */
export const dayOf = (s) => (s == null ? null : parseDay(s));
export const weekday = (n) => (((n + 4) % 7) + 7) % 7;   // 0 = Sunday; 1970-01-01 was a Thursday
export const isBusinessDay = (n) => { const w = weekday(n); return w >= 1 && w <= 5; };
/** `n` itself when it is a weekday, else the next Monday. */
export const bizOnOrAfter = (n) => { let d = n; while (!isBusinessDay(d)) d++; return d; };
/** `n` itself when it is a weekday, else the Friday before. */
export const bizOnOrBefore = (n) => { let d = n; while (!isBusinessDay(d)) d--; return d; };
/** `n` plus `k` business days (k >= 0): Friday + 1 is Monday. */
export function addBusinessDays(n, k) {
  let d = n, left = k;
  while (left > 0) { d++; if (isBusinessDay(d)) left--; }
  return d;
}
export const daysBetween = (a, b) => dayOf(b) - dayOf(a);
export const addDays = (s, k) => dayISO(dayOf(s) + k);
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "Wed, Oct 28" (the year too with `year`). */
export function label(s, { year = false } = {}) {
  const n = dayOf(s); if (n == null) return '';
  const d = new Date(n * 864e5);
  return `${DOW[d.getUTCDay()]}, ${MON[d.getUTCMonth()]} ${d.getUTCDate()}${year ? `, ${d.getUTCFullYear()}` : ''}`;
}

// ------------------------------------------------------------------ the renter's saved plan
/**
 * What is kept under the `moveplan` key:
 *   { v: 1, chosen?: listing id, homes: { <listing id>: {
 *       start?: 'YYYY-MM-DD'        the lease start the renter chose (else it is worked out)
 *       current_end?: 'YYYY-MM-DD'  when the current lease or stay ends (overlap rent, the notice to give)
 *       notice_days?: number        the notice the current lease asks for (default 30)
 *       movers?, insurance?, other?: number   what the renter expects to pay, in dollars
 *       done: { <step id>: 'YYYY-MM-DD' }     steps ticked off, with the day
 *       dates: { <step id>: 'YYYY-MM-DD' }    a step moved to another day by the renter
 *       custom: [{ id, title, date, done? }]  steps the renter added
 *       updated: 'YYYY-MM-DD' } } }
 * Anything else is dropped; a value of the wrong shape is dropped, never repaired by guessing.
 */
export function normalize(raw) {
  const out = { v: VERSION, homes: {} };
  if (!isObj(raw)) return out;
  if (sid(raw.chosen)) out.chosen = raw.chosen;
  for (const [id, h] of Object.entries(isObj(raw.homes) ? raw.homes : {})) {
    if (!sid(id) || !isObj(h)) continue;
    const e = { done: {}, dates: {}, custom: [] };
    for (const k of ['start', 'current_end', 'updated']) if (iso(h[k])) e[k] = iso(h[k]);
    const nd = num(h.notice_days); if (nd != null && nd >= 0 && nd <= 365) e.notice_days = Math.round(nd);
    for (const k of ['movers', 'insurance', 'other']) { const m = money(h[k]); if (m != null) e[k] = m; }
    for (const [sidk, d] of Object.entries(isObj(h.done) ? h.done : {})) if (sid(sidk) && iso(d)) e.done[sidk] = iso(d);
    for (const [sidk, d] of Object.entries(isObj(h.dates) ? h.dates : {})) if (sid(sidk) && iso(d)) e.dates[sidk] = iso(d);
    const seen = new Set();
    for (const c of Array.isArray(h.custom) ? h.custom : []) {
      if (!isObj(c) || !sid(c.id) || seen.has(c.id) || e.custom.length >= MAX_CUSTOM) continue;
      const title = text(c.title, 120); if (!title) continue;
      seen.add(c.id);
      e.custom.push({ id: c.id, title, date: iso(c.date) || null, ...(iso(c.done) ? { done: iso(c.done) } : {}) });
    }
    out.homes[id] = e;
  }
  return out;
}
export const emptyHome = () => ({ done: {}, dates: {}, custom: [] });
export const homeState = (plan, id) => normalize({ homes: { [id]: plan?.homes?.[id] || {} } }).homes[id] || emptyHome();
/** Change one home's saved plan: `patch` is merged over what is there (a key set to null is removed). */
export function patchHome(plan, id, patch, today) {
  const cur = homeState(plan, id), next = { ...cur };
  for (const [k, v] of Object.entries(patch || {})) {
    if (v === null || v === undefined || v === '') delete next[k]; else next[k] = v;
  }
  next.updated = today || cur.updated;
  const n = normalize({ ...plan, homes: { ...(plan?.homes || {}), [id]: next } });
  return n;
}
/** Two saved plans in one: per home the newer `updated` wins whole; `chosen` follows the newer plan's home. Used by a backup import. */
export function mergePlans(a, b) {
  const x = normalize(a), y = normalize(b), homes = { ...x.homes };
  for (const [id, h] of Object.entries(y.homes)) if (!homes[id] || (h.updated || '') >= (homes[id].updated || '')) homes[id] = h;
  return normalize({ chosen: y.chosen || x.chosen, homes });
}
export const hasPlan = (plan) => Object.keys(normalize(plan).homes).length > 0;

// ------------------------------------------------------------------ the lease start
/**
 * The day the lease should start, and why. `move_in` is the criteria's window { earliest, latest, hard }; `available` the listing's
 * availability text ("Now", an ISO date, ...). The renter's own pick wins. Otherwise: the later of the window's earliest day and
 * the availability, but never sooner than LEAD_DAYS from today, because a move needs that long to arrange.
 * Returns { date, basis, in_window, after_window_days, before_window_days, short_notice, notes[] }.
 */
export function leaseStart({ available = null, move_in = {}, today, pick = null }) {
  const t = dayOf(today), earliest = dayOf(move_in?.earliest), latest = dayOf(move_in?.latest ?? move_in?.earliest), av = dayOf(available) ?? (parseDay(available, t));
  const floor = t + LEAD_DAYS, notes = [];
  let n, basis;
  if (pick && dayOf(pick) != null) { n = dayOf(pick); basis = 'chosen'; }
  else {
    const cands = [[earliest, 'window'], [av, 'available']].filter(([v]) => v != null);
    const top = cands.length ? cands.reduce((a, b) => (b[0] > a[0] ? b : a)) : null;
    if (top && top[0] >= floor) { n = top[0]; basis = top[1]; }
    else { n = floor; basis = 'lead'; if (top) notes.push(`${top[1] === 'available' ? 'It is available' : 'Your window opens'} before there is time to arrange a move, so the plan starts ${LEAD_DAYS} days from today.`); }
    if (!top) notes.push('No availability or move-in window is known: the plan starts two weeks from today. Change the date to the one you were quoted.');
  }
  if (basis === 'window' && earliest != null && av != null && av < earliest) notes.push('The home is free before your window opens; the plan follows your window.');
  const after = latest != null && n > latest ? n - latest : 0, before = earliest != null && n < earliest ? earliest - n : 0;
  if (after) notes.push(`${after} day${after === 1 ? '' : 's'} after your latest move-in${move_in?.hard ? ' (a hard limit in your criteria)' : ''}.`);
  if (before) notes.push(`${before} day${before === 1 ? '' : 's'} before your window opens.`);
  const short = n - t < LEAD_DAYS;
  if (short) notes.push(`Only ${Math.max(0, n - t)} day${n - t === 1 ? '' : 's'} from today: steps are squeezed together and the order matters more than the dates.`);
  return { date: dayISO(n), basis, in_window: !after && !before, after_window_days: after, before_window_days: before, short_notice: short, notes };
}

// ------------------------------------------------------------------ the steps
// Each step: id, group, title, detail, and `when(ctx)` -> a day number. ctx has S (start), T (today) and the days already placed.
// `ideal` is how many days before the start the step belongs when there is plenty of time; `min`/`max` clamp it between earlier steps.
export const GROUPS = [['apply', 'Apply'], ['lease', 'Sign and pay'], ['book', 'Book'], ['setup', 'Set up'], ['moveday', 'Move day'], ['after', 'After the move']];

const STEPS = [
  { id: 'notice', group: 'apply', title: 'Give notice at your current home', detail: 'Check your lease for the notice it asks for and send it in writing, so you are not paying for two homes longer than you plan to.', needs: 'current_end' },
  { id: 'apply', group: 'apply', title: 'Submit your application', detail: 'Have ID, proof of income and references ready; ask what the fee covers and how long a decision takes.', kind: 'task' },
  { id: 'approval', group: 'apply', title: 'Approval expected', detail: 'Ask the office for the decision date and follow up if it slips. Do not book movers on an unsigned lease unless the booking is refundable.', kind: 'wait' },
  { id: 'sign', group: 'lease', title: 'Sign the lease', detail: 'Read the rent, term, concession, fees and renewal clauses against what you were quoted; ask for any change in writing before you sign.', kind: 'deadline' },
  { id: 'pay', group: 'lease', title: 'Pay the deposit and first month', detail: 'Usually due at signing, often as a certified payment. Keep the receipt and ask where the deposit is held.', kind: 'deadline', cost: 'signing' },
  { id: 'insurance', group: 'lease', title: "Buy renter's insurance and send the proof", detail: 'Many leases and buildings ask for a policy active from the start date; the building may also want to be named on it.', kind: 'task', cost: 'insurance' },
  { id: 'movers', group: 'book', title: 'Book the movers', detail: 'Get written quotes, ask what is covered and whether they can give the building a certificate of insurance.', kind: 'task', cost: 'movers' },
  { id: 'reserve', group: 'book', title: "Reserve the building's move-in time", detail: 'Many buildings book the elevator or loading area, set move-in hours and may ask for a deposit. Ask for their rules.', kind: 'task' },
  { id: 'coi', group: 'book', title: "Send the movers' certificate of insurance to the building", detail: 'Ask the movers for a certificate naming the owner or manager as the building asks. Buildings often want it days ahead.', kind: 'task' },
  { id: 'internet', group: 'setup', title: 'Book internet for move-in day', detail: 'Installation slots can be a week or more away: ask the provider and the building which are allowed.', kind: 'task' },
  { id: 'utilities', group: 'setup', title: 'Start electric and gas (where they are not included)', detail: 'Ask each utility for service from the start date, in your name.', kind: 'task' },
  { id: 'usps', group: 'setup', title: 'File the USPS change of address', detail: 'Set it to take effect on your start date.', kind: 'task' },
  { id: 'keys', group: 'moveday', title: 'Collect the keys and walk through', detail: 'Photograph every room and any damage before you bring anything in, and send the photos to the office in writing.', kind: 'event' },
  { id: 'move', group: 'moveday', title: 'Move in', detail: 'Confirm the movers, the elevator time and the keys the evening before.', kind: 'event' },
  { id: 'condition', group: 'after', title: 'Send the move-in condition report', detail: 'List anything broken or marked, with the photos, within your first week.', kind: 'task' },
  { id: 'address', group: 'after', title: 'Update your address', detail: 'Bank, employer, insurers, subscriptions and any ID that shows an address.', kind: 'task' },
];
export const STEP_IDS = STEPS.map((s) => s.id);

/**
 * The timeline. `today` and the lease start are ISO days; `state` is one home's saved plan (see normalize). Returns
 * { start, steps[], tight, ... } with each step { id, group, title, detail, kind, date, ideal (the day it would be with
 * plenty of time), squeezed, moved, done, status, overdue, days_out, cost? } ordered by date.
 * A step the renter moved keeps their date; a step they ticked off keeps its done day.
 */
export function timeline({ start, today, state = {}, bizDays = true }) {
  const S = dayOf(start), T = dayOf(today), st = normalize({ homes: { x: state } }).homes.x || emptyHome();
  const placed = {};
  const clampAfter = (n, lo) => Math.max(n, lo);
  const put = (id, ideal, lo, hi, biz) => {
    // `ideal`: the day with plenty of time; `lo`: not before (today, or an earlier step); `hi`: not after (a day before the start or so)
    let n = Math.max(ideal, lo);
    if (hi != null && n > hi) n = Math.max(lo, hi);
    if (biz && bizDays) { const b = bizOnOrBefore(n); n = b >= lo ? b : bizOnOrAfter(n); }
    placed[id] = { n, ideal, squeezed: n - ideal > SQUEEZE_DAYS };   // "squeezed in": pushed more than a few days later than it would be with time to spare
    return n;
  };
  // ---- the order of the steps follows what depends on what
  const apply = put('apply', S - IDEAL_LEAD_DAYS, T, null, true);
  const approval = addBusinessDays(apply, 3); placed.approval = { n: approval, ideal: approval, squeezed: false };
  const sign = put('sign', S - 28, addBusinessDays(approval, 1), S - 2, true);
  put('pay', sign, sign, sign, false);
  put('insurance', S - 5, sign, S - 1, true);
  const movers = put('movers', S - 21, Math.max(sign, T), S - 7, true);
  const reserve = put('reserve', S - 14, Math.max(sign, T), S - 5, true);
  put('coi', S - 10, Math.max(movers, reserve), S - 3, true);
  put('internet', S - 14, Math.max(sign, T), S - 3, true);
  put('utilities', S - 10, Math.max(sign, T), S - 2, true);
  put('usps', S - 7, Math.max(sign, T), S - 1, true);
  placed.keys = { n: S, ideal: S, squeezed: false };
  placed.move = { n: S, ideal: S, squeezed: false };
  put('condition', S + 5, S, null, true);
  put('address', S + 3, S, null, true);
  let noticeOn = null;
  if (st.current_end) {
    const E = dayOf(st.current_end), nd = st.notice_days ?? NOTICE_DAYS;
    noticeOn = put('notice', E - nd, T, E, true);
  }
  const steps = [];
  let seq = 0;
  for (const s of STEPS) {
    if (s.needs && !st[s.needs]) continue;
    const p = placed[s.id]; if (!p) continue;
    const moved = st.dates[s.id] ? dayOf(st.dates[s.id]) : null, n = moved ?? p.n, done = st.done[s.id] || null;
    steps.push(mk({ ...s, seq: seq++, n, ideal: p.ideal, squeezed: p.squeezed && moved == null, moved: moved != null, done, T, custom: false }));
  }
  for (const c of st.custom) {
    const n = dayOf(c.date) ?? S;
    steps.push(mk({ id: c.id, group: 'custom', title: c.title, detail: '', kind: 'task', seq: seq++, n, ideal: n, squeezed: false, moved: false, done: c.done || null, T, custom: true, dateless: !c.date }));
  }
  steps.sort((a, b) => a.day - b.day || a.seq - b.seq);
  const open = steps.filter((s) => !s.done);
  return {
    start: dayISO(S), today: dayISO(T), days_out: S - T, steps, notice_on: noticeOn != null ? dayISO(noticeOn) : null,
    tight: S - T < LEAD_DAYS, done: steps.length - open.length, total: steps.length,
    next: open[0] || null, overdue: open.filter((s) => s.overdue).length,
  };
}
function mk(s) {
  const { n, T, done } = s, d = n - T;
  const status = done ? 'done' : d < 0 ? 'overdue' : d === 0 ? 'today' : d <= 3 ? 'soon' : 'upcoming';
  return { id: s.id, seq: s.seq, group: s.group, title: s.title, detail: s.detail, kind: s.kind, day: n, date: dayISO(n), ideal: dayISO(s.ideal), squeezed: !!s.squeezed, moved: !!s.moved, done, status,
    overdue: status === 'overdue', days_out: d, ...(s.cost ? { cost: s.cost } : {}), ...(s.custom ? { custom: true } : {}), ...(s.dateless ? { dateless: true } : {}) };
}

// ------------------------------------------------------------------ the money
const clean = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 100) / 100);
/** Rent paid twice: the new home's rent for the days the current lease runs past the start (a day's rent = a month / 30.4375). */
export function overlap({ start, current_end, monthly }) {
  if (!current_end || monthly == null) return { days: 0, rent: null, gap_days: 0 };
  const d = daysBetween(start, current_end);
  return d > 0 ? { days: d, rent: clean((monthly * d) / 30.4375), gap_days: 0 } : { days: 0, rent: 0, gap_days: -d };
}
/**
 * The cash a move takes, from the listing's own money (`listing.score.cost` and `listing.price`: the scorer's model, nothing
 * recomputed) plus what the renter expects to pay for the rest. Returns
 * { lines[], due_at_signing, signing_unknown[], total, unknown[], refundable, monthly }. A line is
 * { id, label, amount (null when unknown), refundable?, source: 'listing' | 'renter' | 'computed', note? }.
 * `total` adds only what is known; `unknown` names what is missing, so the total is a floor, and says so.
 */
export function costs(listing, { start, state = {} } = {}) {
  const sc = listing?.score || {}, c = sc.cost || {}, price = listing?.price || {}, up = c.upfront || {};
  const st = normalize({ homes: { x: state } }).homes.x || emptyHome();
  const gross = num(price.gross) ?? num(c.rent?.gross);
  const first = num(up.first_month) ?? num(c.paid_month) ?? gross;
  const dep = num(up.deposit), one = num(up.one_time_fees), otherRef = num(up.other_refundable);
  const app = num(price.application_fee), broker = num(price.broker_fee);
  const lines = [];
  const add = (id, label, amount, extra = {}) => lines.push({ id, label, amount: clean(amount), source: 'listing', ...extra });
  add('first_month', 'First month’s rent', first, first == null ? { note: 'The rent is not known yet.' } : (c.concession?.free_months ? { note: 'Quoted at the full rent; free months are usually credited later. Confirm when.' } : {}));
  add('deposit', 'Security deposit', dep, dep == null ? { note: 'Not in the listing: ask the office.' } : { refundable: true });
  if (otherRef) add('other_refundable', 'Other refundable deposits', otherRef, { refundable: true });
  // one-time fees: the application and broker fees are part of the scorer's one-time total; show them apart and the rest as one line
  if (one != null) {
    if (app) add('application_fee', 'Application fee', app);
    if (broker) add('broker_fee', 'Broker fee', broker);
    const rest = one - (app || 0) - (broker || 0);
    if (rest > 0.5) add('one_time_fees', 'Other one-time fees', rest);
    if (!app && !broker && rest <= 0.5) add('one_time_fees', 'Application, broker and move-in fees', 0, { note: 'None recorded.' });
  } else add('one_time_fees', 'Application, broker and move-in fees', null, { note: 'Not in the listing: ask the office.' });
  const signingIds = lines.map((l) => l.id);
  const monthly = num(listing?.score?.monthly_cost) ?? num(c.monthly), paid = num(c.paid_month) ?? (gross != null ? gross + (num(price.fees_monthly) || 0) : null);
  const ov = overlap({ start, current_end: st.current_end, monthly: paid });
  const renter = (id, label, v, note) => lines.push({ id, label, amount: v == null ? null : clean(v), source: 'renter', ...(v == null && note ? { note } : {}) });
  renter('movers', 'Movers', st.movers ?? null, 'Add your estimate or a quote.');
  renter('insurance', "Renter's insurance (first payment)", st.insurance ?? null, 'Optional: add the quote.');
  if (st.current_end) lines.push({ id: 'overlap', label: 'Overlap rent', amount: ov.rent, source: 'computed', note: ov.days ? `${ov.days} day${ov.days === 1 ? '' : 's'} where both leases run, at the new rent.` : ov.gap_days ? `No overlap: your stay ends ${ov.gap_days} day${ov.gap_days === 1 ? '' : 's'} before the start, so plan somewhere to stay.` : 'The current lease ends on the start day.' });
  renter('other', 'Anything else you expect', st.other ?? null, 'Optional.');
  const known = (l) => l.amount != null;
  const sum = (ids) => clean(lines.filter((l) => ids.includes(l.id) && known(l)).reduce((a, l) => a + l.amount, 0));
  const unknown = lines.filter((l) => !known(l) && l.id !== 'insurance' && l.id !== 'other').map((l) => l.label);
  return {
    lines, monthly, paid_month: paid, start,
    due_at_signing: sum(signingIds), signing_unknown: lines.filter((l) => signingIds.includes(l.id) && !known(l)).map((l) => l.label),
    total: sum(lines.map((l) => l.id)), unknown, refundable: sum(['deposit', 'other_refundable']),
    overlap: ov, scorer_min: num(c.move_in_min),
  };
}

// ------------------------------------------------------------------ the whole plan for a home
/** Everything the planner shows for one home. `ctx`: { listing, criteria, today (ISO), plan (the saved moveplan object) }. */
export function planFor({ listing, criteria, today, plan }) {
  const id = listing?.id, st = homeState(plan, id);
  const move_in = criteria?.search?.move_in || {};
  const ls = leaseStart({ available: listing?.available ?? null, move_in, today, pick: st.start || null });
  const tl = timeline({ start: ls.date, today, state: st });
  return { id, state: st, lease: ls, timeline: tl, costs: costs(listing, { start: ls.date, state: st }) };
}

// ------------------------------------------------------------------ exports
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
const stripDash = (s) => String(s).replace(/-/g, '');
/** The plan as an iCalendar file: one all-day event per step that is not ticked off, with the step's advice as the description and
 *  an alert at 09:00 that day. `meta`: { home (name), address, now (Date), search, all (include steps already done) }. */
export function toICS(tl, meta = {}) {
  const now = meta.now || new Date(), name = meta.home || 'New home';
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ApartmentScout//Move planner//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${icsText(`Move to ${name}`)}`];
  for (const s of tl.steps) {
    if (s.done && !meta.all) continue;
    const next = addDays(s.date, 1);
    const desc = [s.detail, s.squeezed ? 'Squeezed in: there is less time than usual before the start date.' : '', 'A plan from ApartmentScout: confirm every date with the office, the movers and the providers.'].filter(Boolean).join(' ');
    L.push('BEGIN:VEVENT', `UID:${slug(s.id)}-${stripDash(s.date)}-${slug(meta.home) || 'home'}@apartmentscout`, `DTSTAMP:${icsUTC(now)}`, `DTSTART;VALUE=DATE:${stripDash(s.date)}`, `DTEND;VALUE=DATE:${stripDash(next)}`,
      `SUMMARY:${icsText(s.id === 'move' || s.id === 'keys' ? `${s.title}: ${name}` : s.title)}`, ...(meta.address && (s.id === 'keys' || s.id === 'move' || s.id === 'reserve' || s.id === 'sign') ? [`LOCATION:${icsText(meta.address)}`] : []),
      `DESCRIPTION:${icsText(desc)}`, 'TRANSP:TRANSPARENT', 'STATUS:TENTATIVE',
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsText(s.title)}`, 'TRIGGER:PT9H', 'END:VALARM', 'END:VEVENT');
  }
  L.push('END:VCALENDAR');
  return L.map(icsFold).join('\r\n') + '\r\n';
}
/** One line per step, to paste into Reminders (or any list): "Sign the lease (due Fri, Oct 23)". Steps ticked off are left out. */
export function toReminders(tl, meta = {}) {
  const lines = tl.steps.filter((s) => !s.done).map((s) => `${s.title} (due ${label(s.date)})`);
  const head = `Move to ${meta.home || 'the new home'}: lease starts ${label(tl.start, { year: true })}`;
  return meta.header === false ? lines.join('\n') : [head, ...lines].join('\n');
}
/** The plan as a plain checklist with the dates and the cash summary, to paste into a message or a note. */
export function toChecklistText(tl, cost, meta = {}) {
  const usd = (x) => (x == null ? 'to confirm' : '$' + Math.round(x).toLocaleString('en-US'));
  const out = [`Move plan: ${meta.home || 'the new home'}`, `Lease starts ${label(tl.start, { year: true })}${tl.tight ? ' (short notice)' : ''}`, ''];
  for (const s of tl.steps) out.push(`[${s.done ? 'x' : ' '}] ${label(s.date)}  ${s.title}`);
  if (cost) {
    out.push('', 'Cash', ...cost.lines.map((l) => `  ${l.label}: ${usd(l.amount)}${l.refundable ? ' (refundable)' : ''}`),
      `  Due at signing: ${usd(cost.due_at_signing)}${cost.signing_unknown.length ? ` plus ${cost.signing_unknown.join(', ').toLowerCase()}` : ''}`,
      `  Everything above: ${usd(cost.total)}${cost.unknown.length ? ` plus ${cost.unknown.join(', ').toLowerCase()}` : ''}`);
  }
  return out.join('\n');
}
export const fileName = (home, kind) => `move-plan-${slug(home) || 'home'}.${kind}`;
