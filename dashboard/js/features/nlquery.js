// Plain-language queries for the command palette, pure (no DOM, no app imports) so node can test every phrase.
//
//   parseQuery('2 bd under 5k within 20 min by subway with w/d near grand central', ctx)
//     -> chips  [2 bd] [≤ $5,000] [≤ 20 min subway to Grand Central] [W/D]
//
// What it understands: bedrooms (2 bd, studio, 1-2 br, 2+ beds), baths, price (under 5k, $4,500 or less, over 3k,
// between 3k and 4.5k), commute (within 20 min, by subway / bus / walking, to or near a destination), size
// (700 sq ft+), floor (high floor, floor 12+), the feature switches (W/D, doorman, gym, elevator, dishwasher,
// roof deck, pets), starred homes, price drops, a place (a neighbourhood, building or street already in the data)
// and a sort (cheapest, closest, largest, best value). Anything it cannot place is returned in `rest`, and phrases
// it recognises but cannot filter on yet (east of 3rd Ave) in `unsupported`, so the preview never pretends.
//
// `ctx` = { destinations: [{ name }], places: [string], geo? } where `places` are neighbourhood, building and street names and
// `geo` is the indexed places.json (features/places-geo.js indexPlaces): with it "east of 3rd ave", "between 30th and 45th
// street", "near Central Park" and "in Murray Hill" become filters (f.where) and an unknown street is reported in `unknown`;
// without it those phrases stay in `unsupported`. With two or more destinations, "25 min to work and 30 min to partner"
// becomes a limit per destination (f.limits).

import { parsePlaces } from './places-parse.js';   // [places] street, park and neighbourhood phrases
import { parseDestLimits } from './multidest-model.js';   // [multi-destination] "25 min to work and 30 min to partner"
import { addPlus, chipsFromParse, chipsForPlus, matchesPlus } from './nlplus.js';

export const FEATURE_LABEL = {
  in_unit_wd: 'W/D', elevator: 'Elevator', doorman: 'Doorman', gym: 'Gym', dishwasher: 'Dishwasher', roof_deck: 'Roof deck', pets: 'Pets',
};
const MODE_WORD = { subway: 'subway', train: 'subway', metro: 'subway', bus: 'bus', walking: 'walk', foot: 'walk', transit: 'best' };
const MODE_LABEL = { subway: 'subway', bus: 'bus', walk: 'walking', best: 'transit' };
const NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
const SORT_LABEL = { cost: 'Cheapest first', commute: 'Closest first', size: 'Largest first', ppsf: 'Best $/ft\u00b2 first', match: 'Best match first' };
const GENERIC_PLACE = new Set(['park', 'parks', 'square', 'plaza', 'garden', 'gardens', 'river', 'street', 'avenue']);   // a kind of place, never read as part of one name
const FILLER = new Set(['with', 'and', 'the', 'a', 'an', 'in', 'at', 'near', 'by', 'within', 'for', 'that', 'has', 'have', 'having', 'w', 'i', 'want', 'looking', 'find', 'show', 'me', 'my',
  'home', 'homes', 'apartment', 'apartments', 'apt', 'apts', 'place', 'places', 'listing', 'listings', 'unit', 'units', 'please', 'only', 'just', 'of', 'to', 'from', 'around', 'on', 'is',
  'are', 'it', 'its', 'get', 'give', 'need', 'prefer', 'ideally', 'also', 'plus', 'or', 'some', 'any', 'all', 'but', 'close', 'next', 'than', 'less', 'more', 'then', 'be', 'so']);

export const norm = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[\u2019\u2018`\u00b4]/g, "'").replace(/\s+/g, ' ').trim();
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const noApos = (s) => s.replace(/'/g, '');
const money = (n) => '$' + Math.round(n).toLocaleString('en-US');
const titleCase = (s) => s.replace(/(^|[\s-])([a-z])/g, (_, a, b) => a + b.toUpperCase());

// ------------------------------------------------------------------ chip labels (shared by the preview and the applied-filter chips)
export function bedsLabel(min, max) {
  if (min == null && max == null) return null;
  if (min === 0 && max === 0) return 'Studio';
  if (min != null && max != null) return min === max ? `${min} bd` : `${min}\u2013${max} bd`;
  return min != null ? `${min}+ bd` : `\u2264 ${max} bd`;
}
export function costLabel(min, max) {
  if (min != null && max != null) return `${money(min)}\u2013${money(max)}`;
  if (max != null) return `\u2264 ${money(max)}`;
  return min != null ? `\u2265 ${money(min)}` : null;
}
const sqftLabel = (n) => `\u2265 ${n.toLocaleString('en-US')} ft\u00b2`;

/** "5k", "4.5k", "4800", "$5000" -> dollars; null when it does not look like a monthly rent. */
function dollars(num, k, dollar) {
  let n = parseFloat(String(num));
  if (!Number.isFinite(n)) return null;
  if (k) n *= 1000;
  return n >= (dollar || k ? 100 : 500) && n <= 99999 ? n : null;
}

function normalise(text) {
  return ' ' + norm(text)
    .replace(/(\d),(\d{3})\b/g, '$1$2')
    .replace(/\u2264|<=/g, ' under ').replace(/\u2265|>=/g, ' at least ').replace(/</g, ' under ').replace(/>/g, ' over ')
    .replace(/\bw\s*\/\s*d\b|\bw\s*&\s*d\b|\bwasher\s*(?:\/|&|and|-)?\s*dryer\b|\bin[- ]unit\s+(?:laundry|washer|w\/?d)\b|\blaundry\s+in[- ](?:the[- ])?unit\b/g, ' wd ')
    .replace(/\bsq\.?\s*ft\.?\b|\bsquare\s+(?:feet|foot|ft)\b|\bft\u00b2|\bft2\b|\bsf\b/g, ' sqft ')
    .replace(/\bbed\s*rooms?\b/g, ' bedroom ').replace(/\bbath\s*rooms?\b/g, ' bathroom ')
    .replace(/\s*,\s*/g, ' , ') + ' ';
}

/**
 * Parse a query. Returns:
 *   found        true when at least one filter, sort or place was recognised
 *   f            { minBeds, maxBeds, minBaths, maxCost, minCost, minSqft, minFloor, maxMinutes, mode, dest, toggles[], savedOnly, priceDrops, text, sort }
 *   chips        [{ key, label }] in display order (what the preview row prints)
 *   rest         words that were not understood
 *   unsupported  phrases recognised as a request but not filterable yet (east of 3rd ave)
 *   summary      the chip labels joined with " · "
 */
export function parseQuery(text, ctx = {}) {
  const f = { minBeds: null, maxBeds: null, minBaths: null, maxCost: null, minCost: null, minSqft: null, minFloor: null, maxMinutes: null, mode: null, dest: null, toggles: [], savedOnly: false, priceDrops: false, text: null, sort: null };
  const unsupported = [];
  let t = normalise(text);
  /** Replace every match of `re` with a space, unless the callback returns false (then the text stays for later steps). */
  const eat = (re, cb) => { t = t.replace(re, (...a) => (cb(a) === false ? a[0] : ' ')); };

  // [places] [multi-destination] phrases that name a street, park, neighbourhood or a limit per destination
  const unknown = [];
  if (ctx.geo) {
    const pl = parsePlaces(t, ctx.geo, { destinations: ctx.destinations });
    t = pl.text; unknown.push(...pl.unknown); unsupported.push(...pl.unsupported);
    if (pl.clauses.length) f.where = pl.clauses;
  }
  const dl = parseDestLimits(t, ctx.destinations);
  if (dl) { t = dl.text; f.limits = dl.limits; }

  // 1. requests we recognise but cannot filter on: say so instead of guessing
  const ORD = '(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)';
  eat(new RegExp(String.raw`\b(?:(?:east|west|north|south)\s+of|between)\s+(?:the\s+)?(?:\d{1,3}(?:st|nd|rd|th)?|${ORD})\s+(?:ave(?:nue)?|st(?:reet)?)(?:\s+and\s+(?:the\s+)?(?:\d{1,3}(?:st|nd|rd|th)?|${ORD})\s+(?:ave(?:nue)?|st(?:reet)?))?`), (a) => { unsupported.push(a[0].trim()); });
  eat(new RegExp(String.raw`\bbetween\s+(?:the\s+)?(?:\d{1,3}(?:st|nd|rd|th)?|${ORD})\s+and\s+(?:the\s+)?(?:\d{1,3}(?:st|nd|rd|th)?|${ORD})\s+(?:ave(?:nue)?|st(?:reet)?)`), (a) => { unsupported.push(a[0].trim()); });
  eat(/\b(?:east|west|north|south)\s+of\s+(?:the\s+)?(?:park|lexington|madison|broadway|amsterdam|columbus|central park|riverside|river|fdr|west end|york)(?:\s+(?:ave(?:nue)?|drive|park))?/, (a) => { unsupported.push(a[0].trim()); });

  // 2. commute minutes ("within 20 min", "20-minute commute", "20-30 mins", "30 minutes or less")
  eat(/\b(\d{1,3})\s*(?:-|to)\s*(\d{1,3})\s*[- ]?(?:minutes?|mins?)\b/, (a) => { f.maxMinutes = Math.max(5, +a[1], +a[2]); });
  eat(/(?:\b(over|more than|at least)\s+)?(?:\b(?:within|under|less than|up to|at most|no more than|max(?:imum)?|in|about|around)\s+)?\b(\d{1,3})\s*[- ]?\s*(?:minutes?|mins?)\b(?:\s+(?:or less|or under|max(?:imum)?|tops))?(?:\s+(?:commute|ride|trip|away|door[- ]to[- ]door))?/, (a) => {
    if (a[1]) return false;   // "over 20 min" is not something the filter can express
    const n = +a[2]; if (!(n > 0)) return false;
    f.maxMinutes = Math.max(5, n);
  });

  // 3. mode and destination
  eat(/\b(?:by|via|on|using|take(?:s)? the|taking)\s+(?:the\s+|a\s+)?(subway|train|metro|bus|walking|foot|transit)\b(?:\s+(?:ride|commute|trip|line))?/, (a) => { f.mode = MODE_WORD[a[1]]; });
  eat(/\b(public transit|transit)\b/, () => { f.mode ||= 'best'; });
  eat(/\b(subway|metro)\b(?:\s+(?:commute|ride|access|distance))?/, () => { f.mode ||= 'subway'; });
  eat(/\b(walking distance|walkable|walk(?:ing)?)\b/, () => { f.mode ||= 'walk'; });
  eat(/\b(bus)\b/, () => { f.mode ||= 'bus'; });
  const TAIL = new Set(['terminal', 'station', 'office', 'hq', 'building', 'center', 'centre', 'campus']);
  for (const name of (ctx.destinations || []).map((d) => d.name).filter(Boolean)) {
    if (f.dest) break;
    const words = norm(name).split(' ').filter(Boolean);
    const forms = [words];
    if (words.length > 1 && TAIL.has(words[words.length - 1])) forms.push(words.slice(0, -1));
    for (const w of forms) {
      const re = new RegExp(String.raw`(?:\b(?:to|from|near|close to|next to|around|by|at|commute to)\s+)?\b${w.map(esc).join('\\s+')}\b`);
      eat(re, () => { if (f.dest) return false; f.dest = name; });
      if (f.dest) break;
    }
  }

  // 4. bedrooms, baths, studio
  let studio = false;
  eat(/\bstudios?\b/, () => { studio = true; });
  eat(/\b(\d)\s*(?:-|to|or)\s*(\d)\s*[- ]?(?:bd|bds|br|brs|bed|beds|bdrm|bedroom)s?\b/, (a) => { f.minBeds = Math.min(+a[1], +a[2]); f.maxBeds = Math.max(+a[1], +a[2]); });
  eat(/(?:\b(at least|min(?:imum)?|up to|at most|max(?:imum)?|no more than)\s+)?\b(\d|one|two|three|four|five|six)\s*(\+|plus)?\s*[- ]?(?:bd|bds|br|brs|bed|beds|bdrm|bedroom)s?\b(?:\s+(or more|or fewer|or less|\+))?/, (a) => {
    const n = NUM[a[2]] ?? +a[2], pre = a[1] || '', plus = !!a[3] || /more|\+/.test(a[4] || ''), less = /up to|at most|max|no more/.test(pre) || /fewer|less/.test(a[4] || '');
    if (less) f.maxBeds = n; else if (plus || /least|min/.test(pre)) f.minBeds = n; else { f.minBeds = n; f.maxBeds = n; }
  });
  if (studio) { if (f.minBeds == null) { f.minBeds = 0; f.maxBeds = 0; } else f.minBeds = 0; }
  eat(/\b(\d(?:\.\d)?)\s*(\+)?\s*[- ]?(?:ba|bath|baths|bathroom|bathrooms)\b/, (a) => { f.minBaths = +a[1]; });

  // 5. size
  eat(/(?:\b(?:over|above|more than|at least|min(?:imum)?)\s+)?\b(\d{3,5})\s*\+?\s*sqft\b(?:\s+(?:or more|or bigger|or larger|plus|and up))?/, (a) => { f.minSqft = +a[1]; });

  // 6. floor
  eat(/\b(?:above|over|higher than|at least|from)\s+(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+floor\b/, (a) => { f.minFloor = +a[1]; });
  eat(/\b(\d{1,2})(?:st|nd|rd|th)?\s+floor(?:\s+(?:or\s+)?(?:and\s+)?(?:above|higher|up|\+))?/, (a) => { f.minFloor = +a[1]; });
  eat(/\bfloors?\s+(\d{1,2})\s*(?:\+|or (?:higher|above|up))?/, (a) => { f.minFloor = +a[1]; });
  eat(/\b(\d{1,2})\s*\+\s*floors?\b/, (a) => { f.minFloor = +a[1]; });
  eat(/\b(?:high(?:er)?[- ]floors?|top floors?|upper floors?|high up)\b/, () => { f.minFloor ??= 10; });

  // 7. price
  const N = String.raw`(\$)?\s*(\d{1,3}(?:\.\d+)?|\d{3,6}(?:\.\d+)?)\s*(k|grand|thousand)?\b`;
  eat(new RegExp(String.raw`(?:\bbetween\s+)?${N}\s*(?:-|\u2013|to|and)\s*${N}`), (a) => {
    let lo = dollars(a[2], a[3], a[1]);
    const hi = dollars(a[5], a[6], a[4]);
    if (a[6] && !a[3] && +a[2] < 100) lo = dollars(a[2], a[6], a[1]);   // "3-4.5k"
    if (lo == null || hi == null) return false;
    f.minCost = Math.min(lo, hi); f.maxCost = Math.max(lo, hi);
  });
  eat(new RegExp(String.raw`\b(?:under|below|less than|cheaper than|up to|upto|max(?:imum)?|at most|no more than|not more than|budget(?: of| is)?|within|around|about)\s*${N}`), (a) => {
    const v = dollars(a[2], a[3], a[1]); if (v == null) return false; f.maxCost = v;
  });
  eat(new RegExp(String.raw`\b(?:over|above|more than|at least|min(?:imum)?|starting at|starting from)\s*${N}`), (a) => {
    const v = dollars(a[2], a[3], a[1]); if (v == null) return false; f.minCost = v;
  });
  eat(new RegExp(String.raw`${N}\s*(?:or less|or under|or below|and under|and below|max(?:imum)?|tops)\b`), (a) => {
    const v = dollars(a[2], a[3], a[1]); if (v == null) return false; f.maxCost = v;
  });
  eat(new RegExp(String.raw`${N}\s*(?:\+|or more|and up|and above|or over)(?=\s|$)`), (a) => {
    const v = dollars(a[2], a[3], a[1]); if (v == null || !(a[1] || a[3])) return false; f.minCost = v;
  });
  eat(new RegExp(String.raw`(?:^|\s)(\$\s*\d{1,3}(?:\.\d+)?\s*k?|\$\s*\d{3,6}|\d{1,2}(?:\.\d+)?\s*k)\b(?:\s*(?:/|a|per)\s*(?:mo|month))?`), (a) => {
    const m = a[1].match(/^(\$)?\s*([\d.]+)\s*(k)?$/); if (!m) return false;
    const v = dollars(m[2], m[3], m[1]); if (v == null) return false;
    f.maxCost ??= v;
  });

  // 8. feature switches
  const t0 = t, featureRe = {};
  const feature = (key, re) => { featureRe[key] = re; eat(re, () => { if (!f.toggles.includes(key)) f.toggles.push(key); }); };
  feature('in_unit_wd', /\bwd\b/);
  feature('elevator', /\b(?:elevators?|lifts?)\b/);
  feature('doorman', /\b(?:door ?man|full[- ]time door ?man|door staff)\b/);
  feature('gym', /\b(?:gym|fitness(?: center| centre| room)?)\b/);
  feature('dishwasher', /\bdish ?washers?\b/);
  feature('roof_deck', /\broof ?(?:deck|top)\b|\brooftop\b/);
  feature('pets', /\bpet[- ]?friendly\b|\bpets?(?: allowed| ok| welcome)?\b|\bdogs?\b|\bcats?\b/);

  f.toggles.sort((a, b) => t0.search(featureRe[a]) - t0.search(featureRe[b]));   // in the order they were asked for

  // 9. picks, price drops, sort
  eat(/\b(?:starred|stars|saved|favou?rites?|favou?rited|my picks|picks)\b/, () => { f.savedOnly = true; });
  eat(/\b(?:price[- ]?(?:drops?|cuts?|reductions?|decreases?)|(?:recently )?(?:dropped|reduced|marked down|lowered)(?: price)?|prices? (?:dropped|fell|down))\b/, () => { f.priceDrops = true; });
  const BY = String.raw`(?:sort(?:ed)? by |order(?:ed)? by |ranked by )?`;
  eat(new RegExp(String.raw`\b${BY}(best value|best \$ ?/ ?sqft|price per (?:foot|sqft)|cheapest per (?:foot|sqft))\b`), () => { f.sort = 'ppsf'; });
  eat(new RegExp(String.raw`\b${BY}(cheapest|lowest (?:price|cost|rent)|least expensive)\b`), () => { f.sort ||= 'cost'; });
  eat(new RegExp(String.raw`\b${BY}(closest|nearest|shortest commute|quickest commute|fastest commute)\b`), () => { f.sort ||= 'commute'; });
  eat(new RegExp(String.raw`\b${BY}(largest|biggest|roomiest|most space|most spacious)\b`), () => { f.sort ||= 'size'; });
  eat(new RegExp(String.raw`\b${BY}(best match)\b`), () => { f.sort ||= 'match'; });

  // 10. a place that exists in the data: the longest run of left-over words that is part of a known name ("park" alone is any park, not Park Avenue or Gramercy Park)
  let words = t.replace(/[,;.!?()]/g, ' ').split(/\s+/).filter(Boolean);
  const places = (ctx.places || []).map((p) => ({ raw: String(p), key: noApos(norm(p)) }));
  const content = words.map((w, i) => (FILLER.has(w) ? -1 : i)).filter((i) => i >= 0);
  let hit = null;
  outer: for (let n = Math.min(4, content.length); n >= 1; n--) {
    for (let s = 0; s + n <= content.length; s++) {
      const idx = content.slice(s, s + n);
      if (idx[n - 1] - idx[0] > n - 1 + (n > 1 ? 1 : 0)) continue;   // the words must sit together as typed (one filler word may sit between)
      const phrase = noApos(idx.map((i) => words[i]).join(' '));
      if (phrase.length < 4 || /^[\d\s]+$/.test(phrase) || GENERIC_PLACE.has(phrase)) continue;
      const re = new RegExp(`(^|[^a-z0-9])${esc(phrase)}`);
      const place = places.find((p) => re.test(p.key));
      if (place) { hit = { phrase, idx, place }; break outer; }
    }
  }
  if (hit) {
    // the text filter compares with the data as written ("Hell's Kitchen"), so take that spelling from the place
    const loose = new RegExp([...hit.phrase].map((ch) => (ch === ' ' ? '\\s+' : esc(ch))).join("['\u2019]?"), 'i');
    const m = hit.place.raw.match(loose);
    f.text = m ? m[0] : hit.phrase;
    words = words.filter((_, i) => !hit.idx.includes(i));
  }

  // 11. whatever is left
  const rest = words.filter((w) => !FILLER.has(w) && !/^[$~\-+/&]*$/.test(w)).join(' ');

  const chips = [];
  const beds = bedsLabel(f.minBeds, f.maxBeds); if (beds) chips.push({ key: 'beds', label: beds });
  const cost = costLabel(f.minCost, f.maxCost); if (cost) chips.push({ key: 'cost', label: cost });
  if (f.maxMinutes != null || f.mode || f.dest) {
    const parts = [];
    if (f.maxMinutes != null) parts.push(`\u2264 ${f.maxMinutes} min`);
    if (f.mode) parts.push(f.maxMinutes != null ? MODE_LABEL[f.mode] : `by ${MODE_LABEL[f.mode]}`);
    if (f.dest) parts.push((parts.length ? 'to ' : 'Commute to ') + f.dest);
    chips.push({ key: 'commute', label: parts.join(' ') });
  }
  for (const k of f.toggles) chips.push({ key: 'tg:' + k, label: FEATURE_LABEL[k] || k });
  if (f.minSqft != null) chips.push({ key: 'sqft', label: sqftLabel(f.minSqft) });
  if (f.minFloor != null) chips.push({ key: 'floor', label: `Floor ${f.minFloor}+` });
  if (f.minBaths != null) chips.push({ key: 'baths', label: `${f.minBaths}+ bath` });
  if (f.savedOnly) chips.push({ key: 'saved', label: 'Starred' });
  if (f.priceDrops) chips.push({ key: 'drops', label: 'Price drops' });
  if (f.text) chips.push({ key: 'text', label: `In \u201c${titleCase(norm(f.text))}\u201d` });
  chips.push(...chipsFromParse(f));   // [places] [multi-destination]
  if (f.sort) chips.push({ key: 'sort', label: SORT_LABEL[f.sort] });

  return { found: chips.length > 0, f, chips, rest, unsupported, unknown, summary: chips.map((c) => c.label).join(' \u00b7 ') };
}

// ------------------------------------------------------------------ from a parse to the dashboard's filter model
/**
 * The filter state a parse asks for. `base` = { tiers: [index of every budget tier], status: [...ACTIVE], tierCap }.
 * A query is a whole new search: every filter it does not name goes back to its default.
 * Returns { filters, commute, sort }: `filters` is assigned over S.filters (the ones the rail has no control for ride in
 * `filters.nl`), `commute` goes to setCommute() and `sort` to the sort selector (null when the query said nothing).
 */
export function toFilters(parsed, base) {
  const f = parsed.f;
  const nl = {};
  for (const k of ['minBeds', 'maxBeds', 'minBaths', 'maxCost', 'minCost', 'minSqft', 'minFloor']) if (f[k] != null) nl[k] = f[k];
  if (f.priceDrops) nl.priceDrops = true;
  addPlus(nl, f);   // [places] [multi-destination]
  const aboveTiers = f.maxCost != null && base.tierCap != null && f.maxCost > base.tierCap;   // the tiers would hide what was asked for
  return {
    filters: {
      q: f.text || '', toggles: [...f.toggles], savedOnly: f.savedOnly, maxCommute: f.maxMinutes != null && f.maxMinutes < 75 ? f.maxMinutes : 75,
      status: [...base.status], tiers: [...base.tiers], over: aboveTiers, nl: Object.keys(nl).length ? nl : null,
    },
    commute: f.mode || f.dest ? { mode: f.mode || undefined, dest: f.dest || undefined } : null,
    sort: f.sort,
  };
}

/**
 * Does a listing pass the `nl` filters? `price(L)` is the amount the budget compares and `drops` the set of listing ids
 * whose latest price move was down. Unknown facts fail a filter that asks about them: asking for "2 bd" must not
 * return a home whose bedrooms nobody recorded.
 */
export function matchesNL(L, nl, { price = () => null, drops = new Set(), geo = null, dests = [], kmh = 4.8 } = {}) {
  if (!nl) return true;
  if (!matchesPlus(L, nl, { geo, dests, kmh })) return false;   // [places] [multi-destination]
  const p = price(L);
  if (nl.maxCost != null && (p == null || p > nl.maxCost)) return false;
  if (nl.minCost != null && (p == null || p < nl.minCost)) return false;
  if (nl.minBeds != null && !(L.beds != null && L.beds >= nl.minBeds)) return false;
  if (nl.maxBeds != null && !(L.beds != null && L.beds <= nl.maxBeds)) return false;
  if (nl.minBaths != null && !(L.baths != null && L.baths >= nl.minBaths)) return false;
  if (nl.minSqft != null && !(L.sqft != null && L.sqft >= nl.minSqft)) return false;
  if (nl.minFloor != null && !(L.floor != null && L.floor >= nl.minFloor)) return false;
  if (nl.priceDrops && !drops.has(L.id)) return false;
  return true;
}

/** One chip per applied `nl` constraint, each with the keys that clearing it removes. */
export function chipsForNL(nl) {
  if (!nl) return [];
  const out = [];
  const beds = bedsLabel(nl.minBeds ?? null, nl.maxBeds ?? null); if (beds) out.push({ key: 'beds', label: beds, clear: ['minBeds', 'maxBeds'] });
  const cost = costLabel(nl.minCost ?? null, nl.maxCost ?? null); if (cost) out.push({ key: 'cost', label: cost, clear: ['minCost', 'maxCost'] });
  if (nl.minSqft != null) out.push({ key: 'sqft', label: sqftLabel(nl.minSqft), clear: ['minSqft'] });
  if (nl.minFloor != null) out.push({ key: 'floor', label: `Floor ${nl.minFloor}+`, clear: ['minFloor'] });
  if (nl.minBaths != null) out.push({ key: 'baths', label: `${nl.minBaths}+ bath`, clear: ['minBaths'] });
  if (nl.priceDrops) out.push({ key: 'drops', label: 'Price drops', clear: ['priceDrops'] });
  out.push(...chipsForPlus(nl));   // [places] [multi-destination]
  return out;
}

/** `nl` without the given keys, or null when nothing is left. */
export function withoutKeys(nl, keys) {
  const out = Object.fromEntries(Object.entries(nl || {}).filter(([k]) => !keys.includes(k)));
  return Object.keys(out).length ? out : null;
}
