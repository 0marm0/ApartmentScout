// Price history for a listing: turn the recorded prices into a series, a sparkline path and a "dropped $150" fact.
// Pure (no DOM, no imports). The rule is simple and strict: only prices somebody recorded on a date are used, the
// series needs at least two distinct consecutive prices, and nothing is smoothed, extended or guessed. With no
// history there is no series, so the card shows nothing rather than a flat line.
//
// Sources, in order of precedence for the same date:
//   1. history.json `price_history[id]`: [{date, gross, net, source}] from snapshots and dated claims
//   2. the listing's own `price_history`: [{date, gross}] (a portal's earlier prices)
//   3. the listing's current gross rent, dated by `checked`, when it differs from the last recorded price
// Gross rent is plotted (it is what the landlord changes); a series of net-effective numbers is used only when no
// two gross prices exist, and the two are never mixed.

const DAY = 864e5;
export function parseDate(s) {
  const m = typeof s === 'string' && s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null;
}
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const num = (v) => (v != null && v !== '' && Number.isFinite(+v) && +v > 0 ? +v : null);

/** Recorded price points for one measure ('gross' or 'net'), oldest first, one per date. */
function points(L, hist, field) {
  const byDate = new Map();   // date -> value; earlier sources are written first and never overwritten by later ones
  const add = (date, v) => { const t = parseDate(date), x = num(v); if (t != null && x != null && !byDate.has(t)) byDate.set(t, x); };
  for (const p of Array.isArray(hist) ? hist : []) add(p?.date, p?.[field]);
  if (field === 'gross') for (const p of Array.isArray(L?.price_history) ? L.price_history : []) add(p?.date, p?.gross);
  const pts = [...byDate].map(([t, v]) => ({ t, v })).sort((a, b) => a.t - b.t);
  // the current price, dated by the last check, when it is newer than everything recorded and differs
  const cur = field === 'gross' ? num(L?.price?.gross) : num(L?.price?.net_effective), at = parseDate(L?.checked);
  if (pts.length && cur != null && at != null && at > pts[pts.length - 1].t && cur !== pts[pts.length - 1].v) pts.push({ t: at, v: cur });
  return pts;
}

/** Collapse runs of equal prices to the day the price changed; `end` is the last day anything was recorded. */
function changes(pts) {
  const out = [];
  for (const p of pts) if (!out.length || out[out.length - 1].v !== p.v) out.push({ t: p.t, v: p.v });
  return { changes: out, end: pts.length ? pts[pts.length - 1].t : null };
}

/**
 * The price series for a listing, or null when there are not two distinct recorded prices.
 * Returns { measure, pts: [{t, v, date}], end, first, last, prev, drop, total, lastChange, rose }
 *  - drop: how much the latest change lowered the price (positive number), or 0 when the latest change raised it
 *  - total: first minus last (positive = cheaper than the first recorded price)
 */
export function priceSeries(L, hist) {
  for (const measure of ['gross', 'net']) {
    const { changes: ch, end } = changes(points(L, hist, measure));
    if (ch.length < 2) continue;
    const first = ch[0], last = ch[ch.length - 1], prev = ch[ch.length - 2];
    const checked = measure === 'gross' ? parseDate(L?.checked) : null;   // the price still held on the last check
    return {
      measure, pts: ch.map((p) => ({ ...p, date: iso(p.t) })), end: Math.max(end, checked ?? 0),
      first: first.v, last: last.v, prev: prev.v, drop: Math.max(0, prev.v - last.v), rose: Math.max(0, last.v - prev.v),
      total: first.v - last.v, lastChange: iso(last.t),
    };
  }
  return null;
}

const fmtMoney = (v) => '$' + Math.round(v).toLocaleString('en-US');
const fmtDay = (t) => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/** A sentence for the tooltip and the accessible name: what the price did, with real dates and amounts. */
export function priceStory(s) {
  const what = s.measure === 'net' ? 'Net-effective rent' : 'Rent';
  const steps = s.pts.map((p) => `${fmtMoney(p.v)} on ${fmtDay(p.t)}`).join(', then ');
  if (s.drop > 0) return `${what} dropped ${fmtMoney(s.drop)} on ${fmtDay(parseDate(s.lastChange))}: ${steps}.`;
  if (s.rose > 0) return `${what} rose ${fmtMoney(s.rose)} on ${fmtDay(parseDate(s.lastChange))}: ${steps}.`;
  return `${what}: ${steps}.`;
}

/** "↓ $150" for the chip; null when the latest change was not a drop. */
export function dropChip(s) {
  return s && s.drop > 0 ? `↓ ${fmtMoney(s.drop)}` : null;
}

/**
 * A step-line sparkline path for the series in a w x h box with `pad` of room all round. The price holds until it
 * changes, so the line is horizontal then vertical; the final segment runs to the last day recorded.
 * Returns { d, x, y (the last point), min, max }.
 */
export function sparkPath(s, w = 44, h = 16, pad = 2) {
  const t0 = s.pts[0].t, t1 = Math.max(s.end ?? 0, s.pts[s.pts.length - 1].t), span = Math.max(DAY, t1 - t0);
  const vs = s.pts.map((p) => p.v), lo = Math.min(...vs), hi = Math.max(...vs), range = hi - lo || 1;
  const X = (t) => pad + ((t - t0) / span) * (w - 2 * pad), Y = (v) => h - pad - ((v - lo) / range) * (h - 2 * pad);
  const f = (n) => Math.round(n * 10) / 10;
  let d = `M${f(X(s.pts[0].t))} ${f(Y(s.pts[0].v))}`;
  for (let i = 1; i < s.pts.length; i++) d += `H${f(X(s.pts[i].t))}V${f(Y(s.pts[i].v))}`;
  d += `H${f(X(t1))}`;
  return { d, x: f(X(t1)), y: f(Y(s.pts[s.pts.length - 1].v)), min: lo, max: hi };
}
