// Tour-day planner: the pure part. Given the stops (saved picks grouped by building), an order, a day and a start time, it
// works out when to leave, when each viewing starts and ends, and how long each hop takes, and it writes the plan as an
// iCalendar file (one VEVENT per stop, with the address) and as plain text.
//
// Travel times are ESTIMATES and are labelled as such. Walking uses the dashboard's walking model (straight line x 1.25
// for the street grid, 4.8 km/h). The subway router does not run in the browser, so a transit hop is estimated from what
// the router already left on each home: the walk to its station, a flat wait, and a straight-line ride at an average
// speed. The faster of walking and that estimate is used unless the renter fixes the mode. No DOM, no imports.

export const DEFAULTS = { visit: 25, extraUnit: 10, buffer: 10, start: '10:00', walkKmh: 4.8, detour: 1.25, transitWait: 4, rideKmh: 25, rideDetour: 1.2, access: 6, startAccess: 3, minTransit: 10 };

// ------------------------------------------------------------------ clock and distance
/** 'HH:MM' to minutes after midnight (null when it is not a time). */
export function toMin(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s ?? '').trim());
  return m && +m[1] < 24 && +m[2] < 60 ? +m[1] * 60 + +m[2] : null;
}
/** Minutes after midnight to 'HH:MM' (wraps past midnight). */
export const fmtMin = (m) => { const t = ((Math.round(m) % 1440) + 1440) % 1440; return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };
/** 'HH:MM' as 9:05 am for people. */
export const clock12 = (m) => { const t = ((Math.round(m) % 1440) + 1440) % 1440, h = Math.floor(t / 60), mm = t % 60; return `${h % 12 || 12}:${String(mm).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`; };
export function metres(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return null;
  const R = 6371000, r = Math.PI / 180, dl = (b.lat - a.lat) * r, dn = (b.lon - a.lon) * r;
  const x = Math.sin(dl / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dn / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
export const walkMinutes = (a, b, o = DEFAULTS) => { const m = metres(a, b); return m == null ? null : (m * o.detour) / ((o.walkKmh * 1000) / 60); };
/** Estimated minutes door to door by transit: each end's walk to a station, a wait, and the ride. */
export function transitEstimate(a, b, o = DEFAULTS) {
  const m = metres(a, b); if (m == null) return null;
  const ride = ((m * o.rideDetour) / 1000 / o.rideKmh) * 60, accessA = a.access ?? o.access, accessB = b.access ?? o.access;
  return { min: accessA + o.transitWait + ride + accessB, access: accessA + accessB, wait: o.transitWait, ride };
}
/** One hop: `mode` 'walk', 'transit' or 'auto' (the faster, never transit for a hop under `minTransit` minutes of walking). */
export function leg(a, b, mode = 'auto', o = DEFAULTS) {
  const w = walkMinutes(a, b, o), t = transitEstimate(a, b, o);
  if (w == null) return { min: 0, kind: 'none', walk: null, transit: null, estimated: true };
  const pickTransit = mode === 'transit' || (mode === 'auto' && t && t.min < w && w >= o.minTransit);
  const use = pickTransit && t ? { min: t.min, kind: 'transit' } : { min: w, kind: 'walk' };
  return { ...use, min: Math.max(1, Math.round(use.min)), walk: Math.round(w), transit: t ? Math.round(t.min) : null, mode, estimated: true, meters: Math.round(metres(a, b)) };
}

// ------------------------------------------------------------------ stops
/** The viewing length for a stop: `visit` for the first unit plus `extraUnit` for each further one, unless set. */
export const visitMin = (stop, o = DEFAULTS, over = {}) => over[stop.key] ?? o.visit + Math.max(0, (stop.units?.length || 1) - 1) * o.extraUnit;
/** A stop's booked time on `day` (minutes after midnight): the earliest tour time among its units that falls on that day. */
export function bookedMin(stop, day) {
  const t = (stop.units || []).map((u) => /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(String(u.tour || ''))).filter((m) => m && m[1] === day).map((m) => toMin(m[2])).filter((v) => v != null);
  return t.length ? Math.min(...t) : null;
}
/** The first leg of a hop from a listing's commute data: minutes of walking to its station, else null. */
export function stationAccess(commuteEntry) {
  for (const k of ['subway', 'transit', 'bus']) {
    const l = commuteEntry?.modes?.[k]?.legs?.[0];
    if (l && l.mode === 'walk' && l.to && l.to !== 'destination' && Number.isFinite(+l.min)) return +l.min;
  }
  return null;
}

/** A sensible first order: homes booked on `day` in time order, then the rest nearest-next from the last of those (or from
 *  `start` when nothing is booked). Returns stop keys. */
export function autoOrder(stops, { start = null, day = null, mode = 'near' } = {}, o = DEFAULTS) {
  const booked = day ? stops.filter((s) => bookedMin(s, day) != null).sort((a, b) => bookedMin(a, day) - bookedMin(b, day)) : [];
  const rest = stops.filter((s) => !booked.includes(s));
  if (mode === 'time') return [...booked, ...rest.sort((a, b) => (a.name < b.name ? -1 : 1))].map((s) => s.key);
  const out = [...booked]; let cur = booked.at(-1) || start || rest[0] || null; const left = [...rest];
  if (!booked.length && !start && left.length) { out.push(left.shift()); cur = out[0]; }
  while (left.length) {
    let bi = 0, bd = Infinity;
    left.forEach((s, i) => { const d = walkMinutes(cur, s, o) ?? Infinity; if (d < bd) { bd = d; bi = i; } });
    cur = left.splice(bi, 1)[0]; out.push(cur);
  }
  return out.map((s) => s.key);
}
/** The saved order, kept where it still applies: unknown keys drop out, new stops go to the end. */
export function reconcile(saved, stops) {
  const keys = new Set(stops.map((s) => s.key)), kept = (saved || []).filter((k) => keys.has(k));
  return [...kept, ...stops.map((s) => s.key).filter((k) => !kept.includes(k))];
}
/** Move the stop at `from` to `to` (both indexes into the order). */
export function moveStop(order, from, to) {
  if (from === to || from < 0 || to < 0 || from >= order.length || to >= order.length) return [...order];
  const out = [...order]; const [x] = out.splice(from, 1); out.splice(to, 0, x); return out;
}

// ------------------------------------------------------------------ the timeline
/** The day laid out. `plan`: { start: 'HH:MM', day, from (a place {name, lat, lon, access?} or null), visit: {key: min},
 *  buffer: {key: min}, modes: {key: 'auto'|'walk'|'transit'} (the hop INTO that stop), defaultBuffer }.
 *  Each entry: { key, stop, leg, leaveBy, arrive, start, end, depart, visit, buffer, wait, late, booked }. A booked
 *  stop starts at its booked time (the renter waits if early; `late` says how many minutes behind if not); `leaveBy` is
 *  the latest minute to set off for it. */
export function buildTimeline(stops, order, plan, o = DEFAULTS) {
  const byKey = new Map(stops.map((s) => [s.key, s]));
  let t = toMin(plan.start) ?? toMin(DEFAULTS.start), prev = plan.from || null;
  const entries = []; let walk = 0, transit = 0, late = 0, wait = 0;
  for (const key of order) {
    const stop = byKey.get(key); if (!stop) continue;
    const hop = prev ? leg(prev, stop, plan.modes?.[key] || 'auto', o) : { min: 0, kind: 'none', walk: null, transit: null, estimated: true };
    const booked = plan.day ? bookedMin(stop, plan.day) : null, arrive = t + hop.min;
    let start = arrive, w = 0, l = 0;
    if (booked != null) { if (arrive <= booked) { w = booked - arrive; start = booked; } else { l = arrive - booked; start = arrive; } }
    const visit = visitMin(stop, o, plan.visit), buf = plan.buffer?.[key] ?? plan.defaultBuffer ?? o.buffer, end = start + visit, depart = end + buf;
    const leaveBy = booked != null ? booked - hop.min : t;
    entries.push({ key, stop, leg: hop, leaveBy, leaveFrom: prev, arrive, start, end, depart, visit, buffer: buf, wait: w, late: l, booked });
    if (hop.kind === 'walk') walk += hop.min; else if (hop.kind === 'transit') transit += hop.min;
    late += l ? 1 : 0; wait += w; t = depart; prev = stop;
  }
  const first = entries[0], last = entries.at(-1);
  return { entries, begin: first ? Math.min(first.leaveBy, toMin(plan.start) ?? first.leaveBy) : toMin(plan.start), finish: last ? last.end : toMin(plan.start), walk, transit, wait, lateStops: late, viewing: entries.reduce((a, e) => a + e.visit, 0) };
}

// ------------------------------------------------------------------ iCalendar
const pad2 = (n) => String(n).padStart(2, '0');
/** 'YYYY-MM-DD' + minutes after midnight to a floating local DATE-TIME ('20261017T103000'): no zone, so the calendar
 *  shows the time the renter typed wherever they open it. Minutes past midnight roll into the next day. */
export function icsLocal(day, min) {
  const [y, m, d] = day.split('-').map(Number), base = new Date(Date.UTC(y, m - 1, d)); base.setUTCMinutes(Math.round(min));
  return `${base.getUTCFullYear()}${pad2(base.getUTCMonth() + 1)}${pad2(base.getUTCDate())}T${pad2(base.getUTCHours())}${pad2(base.getUTCMinutes())}00`;
}
export const icsUTC = (d) => `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}T${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}${pad2(d.getUTCSeconds())}Z`;
/** Escape a TEXT value (RFC 5545): backslash, semicolon, comma and newlines. */
export const icsText = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
/** Fold a content line to at most 75 octets per line (UTF-8 safe: never inside a character); continuation lines start with a space. */
export function icsFold(line) {
  const enc = new TextEncoder(); if (enc.encode(line).length <= 75) return line;
  const out = []; let cur = '', size = 0, limit = 75;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (size + n > limit) { out.push(cur); cur = ' '; size = 1; limit = 75; }
    cur += ch; size += n;
  }
  out.push(cur);
  return out.join('\r\n');
}
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
/** The plan as an .ics file text: one VEVENT per stop with the address as LOCATION, an alarm at the leave-by time, and a
 *  description with the units and the leave-by estimate. `meta`: { day, calName, now: Date, fromName }. */
export function toICS(timeline, meta) {
  const now = meta.now || new Date(), L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ApartmentScout//Tour day planner//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsText(meta.calName || 'Apartment tours')}`];
  timeline.entries.forEach((e, i) => {
    const s = e.stop, units = (s.units || []).map((u) => `${u.label}${u.price != null ? ` ($${Math.round(u.price).toLocaleString('en-US')}/mo)` : ''}`).join(', ');
    const hop = e.leg.kind === 'none' ? '' : `Leave by ${clock12(e.leaveBy)}${meta.fromName || e.leaveFrom?.name ? ' from ' + (e.leaveFrom?.name || meta.fromName) : ''}: about ${e.leg.min} min ${e.leg.kind === 'transit' ? 'by transit' : 'on foot'} (estimate).`;
    const desc = [units && `Units: ${units}.`, hop, e.booked != null ? 'Booked time: confirm it with the leasing office.' : 'Time is a plan, not a booking: confirm it with the leasing office.', 'Travel times are estimates from ApartmentScout, not a schedule.'].filter(Boolean).join('\n');
    L.push('BEGIN:VEVENT', `UID:${slug(s.key)}-${meta.day}-${i + 1}@apartmentscout`, `DTSTAMP:${icsUTC(now)}`, `DTSTART:${icsLocal(meta.day, e.start)}`, `DTEND:${icsLocal(meta.day, e.end)}`,
      `SUMMARY:${icsText(`Tour: ${s.name}${(s.units || []).length === 1 && s.units[0].label ? ' ' + s.units[0].label : ''}`)}`, `LOCATION:${icsText(s.address || s.name)}`, `DESCRIPTION:${icsText(desc)}`, 'STATUS:TENTATIVE', 'TRANSP:OPAQUE');
    if (e.leg.kind !== 'none') L.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsText(`Leave now for ${s.name}`)}`, `TRIGGER:-PT${Math.max(0, Math.round(e.start - e.leaveBy))}M`, 'END:VALARM');
    L.push('END:VEVENT');
  });
  L.push('END:VCALENDAR');
  return L.map(icsFold).join('\r\n') + '\r\n';
}

// ------------------------------------------------------------------ plain text
/** The plan as text to paste into a message: the day, then one block per stop. */
export function planText(timeline, meta) {
  const d = new Date(meta.day + 'T12:00:00'), when = isNaN(d) ? meta.day : d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const out = [`Tour plan for ${when}`, ''];
  if (meta.fromName && timeline.entries[0]) out.push(`${clock12(timeline.entries[0].leaveBy)}  Set off from ${meta.fromName}`);
  timeline.entries.forEach((e, i) => {
    const s = e.stop;
    if (e.leg.kind !== 'none') out.push(`          ${e.leg.kind === 'transit' ? 'Transit' : 'Walk'} about ${e.leg.min} min (estimate)${e.booked != null ? `; leave by ${clock12(e.leaveBy)}` : ''}`);
    out.push(`${clock12(e.start)}  ${i + 1}. ${s.name}${(s.units || []).length ? ` (${s.units.map((u) => u.label).join(', ')})` : ''} until ${clock12(e.end)}${e.booked != null ? ' [booked]' : ''}`);
    if (s.address) out.push(`          ${s.address}`);
    if (e.late) out.push(`          Running ${e.late} min behind the booked time`);
  });
  out.push('', `Finish about ${clock12(timeline.finish)}. ${timeline.entries.length} stop${timeline.entries.length === 1 ? '' : 's'}, ${timeline.walk + timeline.transit} min travelling (estimated), ${timeline.viewing} min viewing.`);
  return out.join('\n');
}
