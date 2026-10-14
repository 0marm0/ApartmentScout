// "Since your last visit": the pure part. Given the recorded history (history.json: events and price history), the
// listings (listed_at, checked, status) and the day of the renter's previous visit, work out what changed since.
// Only recorded facts count: an event dated after that day, a listed_at after it, a checked date after it. Nothing is
// inferred, so a search with no history and no new check dates produces an empty result and the pill stays hidden.
// No DOM and no imports, so `node --test` can load it.

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})/;
/** 'YYYY-MM-DD' from a date string or datetime string, else null. */
export function dayOf(s) {
  const m = typeof s === 'string' && s.match(DAY_RE);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? `${m[1]}-${m[2]}-${m[3]}` : null;
}
/** The local calendar day of a Date, as YYYY-MM-DD (visits are remembered in the renter's own day). */
export function localDay(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export const isLive = (L) => !!L && !['gone', 'rejected'].includes(L.status || 'new');
const after = (date, since) => { const d = dayOf(date); return d != null && d > since; };
const num = (v) => (v != null && v !== '' && Number.isFinite(+v) ? +v : null);

/** Price points for an id from history.price_history: oldest first, with gross and net where known. */
function pricePoints(history, id) {
  const P = history?.price_history?.[id];
  if (!Array.isArray(P)) return [];
  return P.filter((p) => p && dayOf(p.date) && (num(p.gross) != null || num(p.net) != null))
    .map((p) => ({ date: dayOf(p.date), gross: num(p.gross), net: num(p.net) })).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
/** The price move for one listing between the visit and now: { from, to, basis } or null. The price history wins
 *  (it merges snapshots and dated price claims); the bare events are the fallback. */
function priceMove(history, events, id, since, today) {
  const pts = pricePoints(history, id);
  if (pts.length >= 2) {
    const last = pts[pts.length - 1];
    if (last.date > since && last.date <= today) {
      const base = [...pts].reverse().find((p) => p.date <= since);
      if (base) {
        for (const basis of ['net', 'gross']) {
          if (base[basis] != null && last[basis] != null) return base[basis] === last[basis] ? null : { from: base[basis], to: last[basis], basis, date: last.date };
        }
        return null;
      }
    }
  }
  // fallback: events, oldest first, net before gross
  for (const basis of ['net', 'gross']) {
    const ev = events.filter((e) => e.id === id && e.type === 'price' && e.field === basis && after(e.date, since) && dayOf(e.date) <= today && num(e.from) != null && num(e.to) != null)
      .sort((a, b) => (dayOf(a.date) < dayOf(b.date) ? -1 : 1));
    if (ev.length) {
      const from = num(ev[0].from), to = num(ev[ev.length - 1].to);
      return from === to ? null : { from, to, basis, date: dayOf(ev[ev.length - 1].date) };
    }
  }
  return null;
}

/** What changed since `since` (YYYY-MM-DD, the day of the last visit).
 *  Returns { since, new, drops, rises, gone, relisted, rechecked, count } where each list holds
 *  { id, L, date, ... } sorted newest first; `count` is the total number of changes. */
export function diffSinceVisit({ history = null, listings = [], since, today = localDay() } = {}) {
  const empty = { since: since || null, new: [], drops: [], rises: [], gone: [], relisted: [], rechecked: [], count: 0 };
  const s = dayOf(since);
  if (!s || s >= today) return empty;
  const byId = new Map(listings.map((L) => [L.id, L]));
  const events = (Array.isArray(history?.events) ? history.events : []).filter((e) => e && e.id != null && dayOf(e.date)).map((e) => ({ ...e, id: String(e.id) }));
  const inRange = (e) => after(e.date, s) && dayOf(e.date) <= today;
  const out = { ...empty, new: [], drops: [], rises: [], gone: [], relisted: [], rechecked: [] };
  const seen = { new: new Set(), gone: new Set(), relisted: new Set() };
  const goneIds = new Set(events.filter((e) => e.type === 'gone' && inRange(e)).map((e) => e.id));

  for (const e of events) {
    if (!inRange(e)) continue;
    const L = byId.get(e.id) || null;
    if (e.type === 'gone' && !seen.gone.has(e.id)) { seen.gone.add(e.id); out.gone.push({ id: e.id, L, date: dayOf(e.date), note: e.note || null }); }
    else if (e.type === 'relist' && !seen.relisted.has(e.id) && isLive(L)) { seen.relisted.add(e.id); out.relisted.push({ id: e.id, L, date: dayOf(e.date) }); }
    else if (e.type === 'new' && !seen.new.has(e.id) && isLive(L) && !goneIds.has(e.id)) { seen.new.add(e.id); out.new.push({ id: e.id, L, date: dayOf(e.date), price: num(e.to) }); }
  }
  // listed_at is the date the source says the unit went up: a recorded first-seen date even without a snapshot
  for (const L of listings) {
    const d = dayOf(L.listed_at || L.first_seen);
    if (d && d > s && d <= today && isLive(L) && !seen.new.has(L.id) && !seen.relisted.has(L.id) && !goneIds.has(L.id)) { seen.new.add(L.id); out.new.push({ id: L.id, L, date: d, price: num(L.price?.gross) }); }
  }
  // price moves, only for homes still on the market
  const ids = new Set([...events.filter((e) => e.type === 'price' || e.type === 'claim').map((e) => e.id), ...Object.keys(history?.price_history || {})]);
  for (const id of ids) {
    const L = byId.get(id);
    if (!isLive(L) || seen.new.has(id)) continue;
    const m = priceMove(history, events, id, s, today);
    if (m) (m.to < m.from ? out.drops : out.rises).push({ id, L, date: m.date, from: m.from, to: m.to, basis: m.basis, delta: m.to - m.from });
  }
  // checked dates: a home an agent looked at again since the visit
  for (const L of listings) {
    const d = dayOf(typeof L.checked === 'string' ? L.checked : null);
    if (d && d > s && d <= today && isLive(L)) out.rechecked.push({ id: L.id, L, date: d });
  }
  const newest = (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.id < b.id ? -1 : 1);
  for (const k of ['new', 'gone', 'relisted', 'rechecked']) out[k].sort(newest);
  out.drops.sort((a, b) => a.delta - b.delta || (a.id < b.id ? -1 : 1));
  out.rises.sort((a, b) => b.delta - a.delta || (a.id < b.id ? -1 : 1));
  out.count = out.new.length + out.drops.length + out.rises.length + out.gone.length + out.relisted.length;
  return out;
}

/** The pill's pieces in reading order: [{ key, n, one, many }]. "Rechecked" shows only when it is all there is,
 *  since an agent re-reading pages is not news on its own. At most three pieces. */
export function pillParts(d) {
  const p = [
    ['new', d.new.length, 'new', 'new'], ['drops', d.drops.length, 'price drop', 'price drops'], ['gone', d.gone.length, 'gone', 'gone'],
    ['rises', d.rises.length, 'price rise', 'price rises'], ['relisted', d.relisted.length, 'back', 'back'],
  ].filter((x) => x[1] > 0);
  if (!p.length && d.rechecked.length) p.push(['rechecked', d.rechecked.length, 'rechecked', 'rechecked']);
  return p.slice(0, 3).map(([key, n, one, many]) => ({ key, n, label: n === 1 ? one : many }));
}
export const pillText = (d) => pillParts(d).map((x) => `${x.n} ${x.label}`).join(' · ');
/** Is there anything worth a pill? */
export const hasNews = (d) => pillParts(d).length > 0;

/** Which day a page compares against. `session` is the baseline this tab already fixed (so a reload keeps the pill),
 *  `stored` is the stamp the previous visit left behind. A first visit has no baseline. */
export function baselineFor(stored, session) {
  const s = dayOf(session?.day ?? null), t = dayOf(stored?.day ?? null);
  return s || t || null;
}
