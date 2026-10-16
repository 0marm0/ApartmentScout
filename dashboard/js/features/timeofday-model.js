// Commute by time of day: the arithmetic, with no page in it (tested by tests/js/timeofday.test.mjs).
//
// The router answers the arrive-by trip (say 9:00) and a few other times of day: midday, the evening way home, late
// evening, a weekend morning. A listing carries them as short lists in slot order,
//   L.commute[dest].times = { transit: [18, 17, 22, 37, 24], subway: [...], bus: [...] }
// and the heat map as one whole-minute difference grid per slot and mode (layers/commute-<dest>-times.json) from the
// arrive-by grid. The slots in force are in criteria.json: commute.times = { slots, score, weights }.
// scoredMinutes() is the same arithmetic as commute/slots.py scored_minutes: the arrive-by trip unless the renter opted in.

export const BASE = 'am';
const MODE_KEY = { best: 'transit', transit: 'transit', subway: 'subway', bus: 'bus' };
export const modeKey = (mode) => MODE_KEY[mode] || null;   // walk has no times: it is the same at every hour

/** The slots of a search (criteria.json commute.times.slots), [] when it has none. */
export const slotsOf = (crit) => (crit?.commute?.times?.slots || []).filter((s) => s && s.id);
export const slotById = (slots, id) => slots.find((s) => s.id === id) || null;
const indexOf = (slots, id) => slots.findIndex((s) => s.id === id);

/** '09:00' -> '9:00'; '18:30' -> '18:30'. */
export const clock = (t) => (t ? String(t).replace(/^0(\d:)/, '$1') : '');
/** The slot's clock time for a destination: its own, else the destination's arrive_by. */
export const timeOf = (slot, dest) => slot?.time || dest?.arrive_by || '09:00';
const DAY = { saturday: 'Saturday', sunday: 'Sunday' };
/** 'arrive 9:00' / 'leave 18:00' / 'arrive 11:00 Saturday'. */
export function phrase(slot, dest) {
  if (!slot) return '';
  return `${slot.kind === 'depart' ? 'leave' : 'arrive'} ${clock(timeOf(slot, dest))}${DAY[slot.day] ? ' ' + DAY[slot.day] : ''}`;
}
/** A short chip label: '9:00', '18:00 home', 'Sat 11:00'. */
export function chip(slot, dest) {
  if (!slot) return '';
  const t = clock(timeOf(slot, dest)), d = slot.day === 'saturday' ? 'Sat ' : slot.day === 'sunday' ? 'Sun ' : '';
  return `${d}${t}${slot.kind === 'depart' ? ' home' : ''}`;
}

/** The per-slot minutes of one listing entry for a commute mode ('best' | 'subway' | 'bus'), or null (walk, or no times). */
export function timesFor(entry, mode) {
  const k = modeKey(mode);
  const t = k && entry?.times?.[k];
  return Array.isArray(t) ? t : null;
}
/** Minutes at one slot (null when the slot has no answer for this home). */
export function minutesAt(entry, mode, slots, slotId) {
  const t = timesFor(entry, mode), i = indexOf(slots, slotId);
  return t && i >= 0 && Number.isFinite(t[i]) ? t[i] : null;
}

/** The minutes the commute SCORE reads (commute/slots.py scored_minutes): the arrive-by trip's `minutes` by default, a
 *  slot's when criteria.commute.times.score names one, the weighted average over the day for "weighted". */
export function scoredMinutes(entry, crit) {
  const base = entry?.minutes ?? null, cfg = crit?.commute?.times || {};
  const choice = String(cfg.score || BASE).toLowerCase();
  if (choice === BASE || cfg.enabled === false) return base;
  const t = entry?.times?.transit, slots = slotsOf(crit);
  if (!Array.isArray(t) || !slots.length) return base;
  if (choice === 'weighted') {
    let num = 0, den = 0;
    slots.forEach((s, i) => { const w = Math.max(0, Number(cfg.weights?.[s.id] ?? 1)); if (Number.isFinite(t[i]) && w > 0) { num += t[i] * w; den += w; } });
    return den ? num / den : base;
  }
  const i = indexOf(slots, choice);
  return i >= 0 && Number.isFinite(t[i]) ? t[i] : base;
}

/** What the drawer says: "18 min to arrive at 9:00, 22 min leaving at 18:00 ..." plus the fastest and slowest. */
export function summary(entry, mode, slots, dest) {
  const t = timesFor(entry, mode);
  if (!t || !slots.length) return null;
  const rows = slots.map((s, i) => ({ slot: s, id: s.id, minutes: Number.isFinite(t[i]) ? t[i] : null, phrase: phrase(s, dest) }));
  const have = rows.filter((r) => r.minutes != null);
  if (have.length < 2) return null;
  const fast = have.reduce((a, b) => (b.minutes < a.minutes ? b : a)), slow = have.reduce((a, b) => (b.minutes > a.minutes ? b : a));
  const spread = Math.round(slow.minutes) - Math.round(fast.minutes);
  return {
    rows, fast, slow, spread,
    text: have.map((r) => `${Math.round(r.minutes)} min to ${r.slot.kind === 'depart' ? 'leave at' : 'arrive at'} ${clock(timeOf(r.slot, dest))}${DAY[r.slot.day] ? ' ' + DAY[r.slot.day] : ''}`).join(', '),
    verdict: spread < 3 ? 'About the same at every time of day.'
      : `Fastest ${fast.phrase} (${Math.round(fast.minutes)} min), slowest ${slow.phrase} (${Math.round(slow.minutes)} min).`,
  };
}

/** Which slot the score reads, for the "scored on" note: null (the arrive-by trip), 'weighted', or the slot. */
export function scoredOn(crit) {
  const c = String(crit?.commute?.times?.score || BASE).toLowerCase();
  return c === BASE || crit?.commute?.times?.enabled === false ? null : c;
}

// ------------------------------------------------------------------ the difference grids
/** zlib-deflated base64 -> bytes (browser: DecompressionStream; node: zlib). */
export async function inflate(b64) {
  const bin = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
  if (typeof DecompressionStream === 'function') {
    return new Uint8Array(await new Response(new Blob([bin]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer());
  }
  const node = 'node:zlib';   // node:test only; not a literal, so the bundler leaves it alone
  return new Uint8Array((await import(node)).inflateSync(bin));
}

export const SENTINEL = -128;
/** Minutes per cell (-1 = blank) for a slot: the arrive-by grid's values (-1 blank) plus the whole-minute differences. */
export function applyDelta(base, delta) {
  const out = new Float32Array(base.length);
  for (let i = 0; i < base.length; i++) {
    const b = base[i], d = (delta[i] << 24) >> 24;   // the byte as a signed int8
    out[i] = b < 0 || d === SENTINEL ? -1 : Math.max(0, Math.min(127, b + d));
  }
  return out;
}
/** The doc's file name for a destination ('Grand Central' -> 'commute-grand-central-times.json'); the same slug as the CLI. */
export const timesFile = (name) => `commute-${String(name).replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'listing'}-times.json`;
