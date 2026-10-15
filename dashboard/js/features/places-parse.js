// Place phrases in a plain-language query, pure: "east of 3rd ave", "south of 14th", "between 30th and 45th street",
// "near Central Park", "within 5 min walk of Bryant Park", "in Murray Hill / Kips Bay", "on the UES".
//
//   parsePlaces(text, geo, { destinations })  ->  { text, clauses, unknown, unsupported }
//
// `text` is the query as nlquery.js normalises it (lower case, ASCII); `geo` is indexPlaces(places.json). The result
// carries the text with every understood phrase blanked out, so the rest of the parser never sees it again.
//   clauses      filter clauses for places-geo.js evalClause, each with a stable `id` and a chip `label`
//   unknown      phrases that name a street or park the search's map data does not have (reported, never guessed)
//   unsupported  phrases that name a place but ask for something the data cannot answer ("north of 3rd Avenue")
// Names are matched against places.json only: nothing is invented, and a street called something we do not have is
// reported rather than approximated. A phrase that might be a commute destination or a building name ("near Grand
// Central") is left alone for the rest of the parser unless it names a park, street or neighbourhood that exists.
import { streetKey, areaKey, endsWithType, TYPE_WORDS, STREET_TYPES, ORD_WORDS, separates, offsetAlong } from './places-geo.js';

const SIDE = { east: 'east', west: 'west', north: 'north', south: 'south' };
const NEAR_WORDS = new Set(['near', 'nearby', 'around', 'by', 'beside', 'next', 'close', 'adjacent']);
const IN_WORDS = new Set(['in', 'on', 'at', 'inside', 'within']);
const STOP = new Set(['and', 'with', 'under', 'over', 'at', 'in', 'near', 'by', 'within', 'for', 'that', 'has', 'have', 'or', 'from', 'of', 'min', 'mins', 'minute', 'minutes', 'walk', 'walking', 'but', 'than', 'plus', 'around', 'a', 'an']);
const SEP = new Set([',', '/', ';']);
const PARKISH = new Set(['park', 'square', 'plaza', 'gardens', 'garden', 'green', 'common', 'playground', 'commons']);
export const NEAR_MINUTES = 5;   // "near X" means a five-minute walk
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function tokenize(text) {
  const toks = [];
  for (const m of text.matchAll(/[^\s,;/]+|[,;/]/g)) toks.push({ raw: m[0], w: m[0].replace(/^[("']+|[.)"':!?]+$/g, ''), s: m.index, e: m.index + m[0].length });
  return toks;
}

export function parsePlaces(text, geo, { destinations = [] } = {}) {
  const out = { text, clauses: [], unknown: [], unsupported: [] };
  if (!geo) return out;
  const toks = tokenize(text), used = toks.map(() => false);
  const w = (k) => toks[k]?.w;
  const free = (k) => k >= 0 && k < toks.length && !used[k];
  const take = (a, b) => { for (let k = a; k < b; k++) used[k] = true; };
  const destWords = (destinations || []).map((d) => areaKey(typeof d === 'string' ? d : d.name).split(' ').filter(Boolean));
  const isDest = (ws) => ws.length > 0 && destWords.some((dw) => dw.length >= ws.length && dw.some((_, s) => ws.every((x, i) => dw[s + i] === x)));
  const add = (c) => { if (!out.clauses.some((x) => x.id === c.id)) out.clauses.push(c); };
  const span = (a, b) => toks.slice(a, b).map((t) => t.w).join(' ');

  // ---- lookups
  const lookupStreet = (phrase, prefer) => {
    const k = streetKey(phrase.replace(/^the\s+/, ''));
    if (!k) return null;
    if (geo.streetByKey.has(k)) return geo.streetByKey.get(k);
    if (!endsWithType(k)) for (const t of [...prefer, ...TYPE_WORDS]) if (geo.streetByKey.has(`${k} ${t}`)) return geo.streetByKey.get(`${k} ${t}`);
    return null;
  };
  const lookupArea = (phrase, { parkFirst = false, kinds = null } = {}) => {
    const k = areaKey(phrase.replace(/^the\s+/, ''));
    if (!k) return null;
    const tries = parkFirst ? [`${k} park`, k] : [k];
    for (const t of tries) {
      const hit = geo.areaByKey.get(t);
      if (hit && (!kinds || hit.ids.every((id) => kinds.includes(geo.byAreaId.get(id)?.kind)))) return hit;
    }
    return null;
  };
  /** The longest run of tokens from `i` (up to 5) that names something; fn(phrase, tokens, nextWord) returns the hit or null. */
  const longest = (i, fn) => {
    let s = i; if (w(s) === 'the') s++;
    for (let n = Math.min(5, toks.length - s); n >= 1; n--) {
      const part = toks.slice(s, s + n);
      if (part.some((t) => SEP.has(t.w) || used[toks.indexOf(t)]) || STOP.has(part[n - 1].w)) continue;
      const hit = fn(part.map((t) => t.w).join(' '), part, w(s + n));
      if (hit) return { hit, end: s + n, start: s };
    }
    return null;
  };
  const looksStreet = (s, allowBare) => {
    if (w(s) === 'the') s++;
    const t0 = w(s);
    if (!t0 || STOP.has(t0)) return null;
    const ord = /^\d+(?:st|nd|rd|th)$/.test(t0) || t0 in ORD_WORDS || (allowBare && /^\d{1,3}$/.test(t0));
    let e = s + 1;
    for (let n = 0; n < 4 && e <= toks.length; n++, e++) {   // up to a street type word, inclusive
      const x = w(e - 1);
      if (!x || SEP.has(x) || (n && STOP.has(x))) { e--; break; }
      if (x in STREET_TYPES) return { s, e };
    }
    return ord ? { s, e: s + (w(s + 1) in STREET_TYPES ? 2 : 1) } : null;
  };

  /** A street reference at `j`: { street, end } | { unknown, end } | null when it is not a street reference at all. */
  const streetRef = (j, prefer, allowBare = false) => {
    // a shorter run must not leave a street type behind: "99th avenue" is not "99th" (street)
    const r = longest(j, (p, _t, next) => (STREET_TYPES[next] ? null : lookupStreet(p, prefer)));
    if (r) return { street: r.hit, end: r.end, typed: endsWithType(streetKey(span(r.start, r.end))) };
    const l = looksStreet(j, allowBare);
    return l ? { unknown: span(l.s, l.e), end: l.e } : null;
  };
  const nearRef = (j) => {
    const r = longest(j, (p, _t, next) => {
      const a = lookupArea(p, { parkFirst: true });
      if (a) return { area: a };
      const s = STREET_TYPES[next] ? null : lookupStreet(p, ['avenue', 'street']);
      return s ? { street: s } : null;
    });
    if (!r || isDest(toks.slice(r.start, r.end).map((t) => areaKey(t.w)).filter(Boolean))) return null;
    return { ...r.hit, end: r.end, text: span(r.start, r.end) };
  };

  // ---- clause builders
  const sideClause = (dir, st) => ({ op: 'side', id: `side:${dir}:${st.keys[0]}`, dir, street: st.keys[0], label: `${cap(dir)} of ${st.name}` });
  const nearClause = (ref, minutes) => {
    if (ref.area) return { op: 'near', id: `near:${ref.area.ids.join(',')}:${minutes}`, areas: ref.area.ids, minutes, label: `≤ ${minutes} min walk to ${ref.area.name}` };
    return { op: 'near', id: `near:${ref.street.keys[0]}:${minutes}`, street: ref.street.keys[0], minutes, label: `≤ ${minutes} min walk to ${ref.street.name}` };
  };

  const trySide = (i, dir, j, strict = false) => {
    const prefer = dir === 'east' || dir === 'west' ? ['avenue', 'boulevard', 'street'] : ['street', 'avenue'];
    const ref = streetRef(j, prefer, !strict);
    if (!ref) {
      const a = longest(j, (p) => lookupArea(p, { parkFirst: true }));
      if (a && !strict) { out.unsupported.push(`${w(i)} of ${span(a.start, a.end)}`); take(i, a.end); return true; }
      return false;
    }
    if (ref.unknown) { out.unknown.push(`${strict ? w(i) : w(i) + ' of'} ${ref.unknown}`); take(i, ref.end); return true; }
    if (!separates(geo, ref.street, dir)) { out.unsupported.push(`${w(i)}${strict ? '' : ' of'} ${ref.street.name} (it runs ${dir === 'east' || dir === 'west' ? 'east-west' : 'north-south'}, so it has no ${dir} side)`); take(i, ref.end); return true; }
    add(sideClause(dir, ref.street)); take(i, ref.end);
    return true;
  };

  const tryBetween = (i) => {
    const s = w(i + 1) === 'the' ? i + 2 : i + 1;
    let k = s;
    while (k < toks.length && k - s < 5 && !['and', '&'].includes(w(k)) && !SEP.has(w(k))) k++;
    if (!['and', '&'].includes(w(k))) return false;
    const a = toks.slice(s, k), b0 = w(k + 1) === 'the' ? k + 2 : k + 1;
    const bl = looksStreet(b0, true), al = looksStreet(s, true);
    if (!al || !bl || al.e !== k) return false;   // not two street references ("between 3k and 4.5k")
    const typeOf = (x, y) => { for (let q = y - 1; q >= x; q--) if (w(q) in STREET_TYPES) return STREET_TYPES[w(q)]; return null; };
    const ta = typeOf(s, k), tb = typeOf(b0, bl.e);
    const num = (q) => { const t = w(q); return t in ORD_WORDS ? ORD_WORDS[t] : parseInt(t, 10); };
    const guess = ta || tb || (num(s) <= 12 && num(b0) <= 12 ? 'avenue' : 'street');
    const find = (x, y, t) => lookupStreet(`${span(x, y)}${typeOf(x, y) ? '' : ' ' + (t || guess)}`, [guess]);
    const s1 = find(s, k, tb), s2 = find(b0, bl.e, ta);
    take(i, bl.e);
    if (!s1 || !s2) {
      out.unknown.push(`between ${[!s1 && span(s, k), !s2 && span(b0, bl.e)].filter(Boolean).join(' and ')}`);
      return true;
    }
    if (s1 === s2 || s1.cls !== s2.cls) { out.unsupported.push(`between ${s1.name} and ${s2.name} (not two parallel streets)`); return true; }
    const lateral = s1.cls === 'avenue' ? 'east' : 'north', back = s1.cls === 'avenue' ? 'west' : 'south';
    const [lo, hi] = offsetAlong(geo, s1, lateral) <= offsetAlong(geo, s2, lateral) ? [s1, s2] : [s2, s1];
    add({ op: 'between', id: `between:${lo.keys[0]}|${hi.keys[0]}`, a: { dir: lateral, street: lo.keys[0] }, b: { dir: back, street: hi.keys[0] }, label: `Between ${s1.name} and ${s2.name}` });
    return true;
  };

  const tryWalk = (i) => {
    if (!/^\d{1,2}$/.test(w(i)) || !/^(?:min|mins|minute|minutes)$/.test(w(i + 1) || '')) return false;
    let j = i + 2;
    const walk = /^walk(?:ing|s)?$/.test(w(j) || ''); if (walk) j++;
    const within = free(i - 1) && ['within', 'under', 'inside'].includes(w(i - 1));
    if (!(walk || within) || !['of', 'from', 'to'].includes(w(j))) return false;
    const n = +w(i); if (!(n >= 1 && n <= 30)) return false;
    const ref = nearRef(j + 1);
    if (!ref) return false;
    add(nearClause(ref, n)); take(within ? i - 1 : i, ref.end);
    return true;
  };

  const tryNear = (i) => {
    let j = i + 1;
    const x = w(i);
    if (x === 'close' || x === 'next' || x === 'adjacent') { if (w(j) !== 'to') return false; j++; }
    else if (x === 'near' && w(j) === 'to') j++;
    const ref = nearRef(j);
    if (!ref) {
      const l = longest(j, (p, part) => (part.length > 1 && PARKISH.has(part[part.length - 1].w) && !lookupArea(p) ? p : null));
      if (l && !isDest(areaKey(l.hit).split(' '))) { out.unknown.push(`${x} ${l.hit}`); take(i, l.end); return true; }
      return false;
    }
    add(nearClause(ref, NEAR_MINUTES)); take(i, ref.end);
    return true;
  };

  /** One or more neighbourhoods from `j`, joined by "/", ",", "or", "and". */
  const areaList = (j) => {
    const ids = [], names = []; let end = j, k = j;
    for (let guard = 0; guard < 4; guard++) {
      const r = longest(k, (p) => {
        if (isDest(areaKey(p).split(' '))) return null;
        const a = lookupArea(p, { kinds: ['hood'] });
        return a && a.ids.length ? a : null;
      });
      if (!r) break;
      for (const id of r.hit.ids) if (!ids.includes(id)) ids.push(id);
      names.push(r.hit.name); end = r.end;
      if (SEP.has(w(end)) || ['or', 'and', '&'].includes(w(end))) k = end + 1; else break;
    }
    return ids.length ? { ids, names: [...new Set(names)], end } : null;
  };
  const inClause = (l) => ({ op: 'in', id: `in:${[...l.ids].sort().join(',')}`, areas: l.ids, label: `In ${l.names.join(' / ')}` });
  const tryIn = (i) => {
    if (/^\d/.test(w(i + 1) || '')) return false;   // "within 20 min"
    const l = areaList(i + 1);
    if (!l) return false;
    add(inClause(l)); take(i, l.end);
    return true;
  };

  for (let i = 0; i < toks.length; i++) {
    if (used[i]) continue;
    const x = w(i);
    if (x === 'between' && tryBetween(i)) continue;
    if (x in SIDE && w(i + 1) === 'of' && trySide(i, SIDE[x], i + 2)) continue;
    if ((x === 'above' || x === 'below') && trySide(i, x === 'above' ? 'north' : 'south', i + 1, true)) continue;
    if (tryWalk(i)) continue;
    if (NEAR_WORDS.has(x) && tryNear(i)) continue;
    if (IN_WORDS.has(x) && tryIn(i)) continue;
  }
  // a neighbourhood named on its own: "2 bd murray hill under 4k"
  for (let i = 0; i < toks.length; i++) {
    if (used[i] || SEP.has(w(i)) || w(i).length < 3) continue;
    const l = areaList(i);
    if (l && toks.slice(i, l.end).every((t, k) => !used[i + k])) { add(inClause(l)); take(i, l.end); i = l.end - 1; }
  }
  // blank what was understood
  let res = '', at = 0;
  toks.forEach((t, k) => { if (used[k]) { res += text.slice(at, t.s) + ' '.repeat(t.e - t.s); at = t.e; } });
  out.text = res + text.slice(at);
  return out;
}
