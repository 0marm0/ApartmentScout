// Several commute destinations, pure (no DOM, no app imports) so node can test every rule.
//
//   parseDestLimits(text, destinations)   "within 25 min of work and 30 min of partner" -> a limit per destination
//   destMinutes(L, dests, mode, kmh)      one row per destination: minutes, limit, weight, the 0-100 commute score
//   combined(rows)                        weighted score (the scorer's own recipe), weighted minutes, worst minutes
//   matchesDestLimits(L, nl, dests, kmh)  the per-destination limits a search carries in S.filters.nl (`c:<name>` keys)
//
// The score of one destination is score.part_commute / criteria.commutePart: 100 at half the limit, 50 at the limit and
// 0 at twice the limit, so a 15-minute gym and a 45-minute office are judged against their own limits. Destinations
// without minutes for a home are left out of the average and the home says how many it was scored on.
import { modeMinutes } from '../criteria.js';

const MODE_WORD = { subway: 'subway', train: 'subway', metro: 'subway', bus: 'bus', walking: 'walk', walk: 'walk', foot: 'walk', transit: 'best' };
const MODE_LABEL = { subway: 'subway', bus: 'bus', walk: 'walking', best: '' };
const TAIL = new Set(['terminal', 'station', 'office', 'hq', 'building', 'center', 'centre', 'campus']);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const norm = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[’‘`´]/g, "'").replace(/\s+/g, ' ').trim();
const lin = (x, x0, y0, x1, y1) => (x <= x0 ? y0 : x >= x1 ? y1 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0));

/** The label of one per-destination limit: "≤ 25 min to Work", "≤ 30 min subway to Partner". */
export const limitLabel = (c) => `≤ ${c.max} min${c.mode && MODE_LABEL[c.mode] ? ' ' + MODE_LABEL[c.mode] : ''} to ${c.dest}`;

/**
 * Pull "N min ... <destination>" pairs out of a normalised query. Only when two or more destinations each get their own
 * limit: with one the existing commute lens already covers it ("within 20 min of grand central"), and this returns null.
 * Returns { text, limits: [{ dest, max, mode }] } with the matched phrases blanked out of the text.
 */
export function parseDestLimits(text, destinations) {
  const dests = (destinations || []).map((d) => d.name).filter(Boolean);
  if (dests.length < 2) return null;
  let t = text;
  const found = [];
  const forms = (name) => {
    const words = norm(name).split(' ').filter(Boolean), out = [words];
    if (words.length > 1 && TAIL.has(words[words.length - 1])) out.push(words.slice(0, -1));
    return out;
  };
  const order = dests.map((n) => ({ n, f: forms(n) })).sort((a, b) => Math.max(...b.f.map((x) => x.length)) - Math.max(...a.f.map((x) => x.length)));
  const UP = String.raw`(?:\b(?:within|under|up to|less than|at most|max(?:imum)?|no more than|about|around)\s+)?`;
  const MIN = String.raw`\b(\d{1,3})\s*[- ]?(?:minutes?|mins?)\b(?:\s+(?:or less|or under|max(?:imum)?|tops))?`;
  const BY = String.raw`(?:\s+(?:by|via|on)\s+(?:the\s+)?(subway|bus|train|metro|walking|foot|transit))?(?:\s+(?:commute|ride|trip|walk(?:ing)?|away|door[- ]to[- ]door))*`;
  for (const { n, f } of order) {
    for (const w of f) {
      const name = w.map(esc).join('\\s+');
      const r1 = new RegExp(`${UP}${MIN}${BY}\\s+(?:to|from|of|near|at|for)\\s+(?:the\\s+)?${name}\\b`);
      const r2 = new RegExp(`\\b${name}\\b\\s*(?:within|under|up to|less than|at most|max(?:imum)?|no more than|:)?\\s*(\\d{1,3})\\s*[- ]?(?:minutes?|mins?)\\b(?:\\s+(?:or less|or under|max(?:imum)?|tops))?`);
      for (const [re, modeIdx] of [[r1, 2], [r2, 0]]) {
        const m = t.match(re);
        if (!m) continue;
        found.push({ dest: n, max: Math.max(5, +m[1]), mode: modeIdx ? MODE_WORD[m[modeIdx]] || null : null });
        t = t.replace(m[0], ' ');
        break;
      }
      if (found.some((x) => x.dest === n)) break;
    }
  }
  if (found.length < 2) return null;
  const mode = found.find((x) => x.mode)?.mode ?? null;
  return { text: t, limits: found.map((x) => ({ ...x, mode: x.mode ?? mode })).map((x) => ({ ...x, mode: x.mode === 'best' ? null : x.mode })) };
}

/** One row per destination for a home: { name, minutes, max, weight, score, over, i }. `mode` = best | subway | bus | walk. */
export function destMinutes(L, dests, mode = 'best', kmh = 4.8) {
  return (dests || []).map((d, i) => {
    const minutes = modeMinutes(L, d, mode, kmh);
    const max = d.max_minutes ?? 30, weight = d.weight ?? 1;
    const score = minutes == null ? null : minutes <= max ? lin(minutes, max * 0.5, 100, max, 50) : lin(minutes, max, 50, max * 2, 0);
    return { i, name: d.name, minutes, max, weight, score, over: minutes != null && minutes > max, arrive_by: d.arrive_by || null };
  });
}

/** Weighted score (0-100), weighted minutes and worst minutes over the rows that have minutes; null when none do. */
export function combined(rows) {
  const ok = rows.filter((r) => r.minutes != null && r.weight > 0);
  if (!ok.length) return { score: null, weighted: null, worst: null, used: 0, of: rows.length };
  const w = ok.reduce((s, r) => s + r.weight, 0);
  return {
    score: ok.reduce((s, r) => s + r.score * r.weight, 0) / w, weighted: ok.reduce((s, r) => s + r.minutes * r.weight, 0) / w,
    worst: Math.max(...ok.map((r) => r.minutes)), used: ok.length, of: rows.length,
  };
}

/** Per-destination limits in S.filters.nl as [{ dest, max, mode }] (the `c:<name>` keys). */
export const limitsOf = (nl) => Object.entries(nl || {}).filter(([k]) => k.startsWith('c:')).map(([, v]) => v);

/** Homes without minutes for a destination stay in, like the slider (a missing figure is not a failed limit). */
export function matchesDestLimits(L, nl, dests, kmh = 4.8) {
  for (const c of limitsOf(nl)) {
    const D = (dests || []).find((d) => d.name === c.dest);
    if (!D) continue;
    const m = modeMinutes(L, D, c.mode || 'best', kmh);
    if (m != null && m > c.max) return false;
  }
  return true;
}
