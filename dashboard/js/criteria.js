// Search criteria in the browser: the editable search profile, a faithful re-evaluation of the parts of the score
// that depend only on the criteria (budget tiers and gates, must-have gates, move-in window, size and commute
// targets), the criteria.yaml export, and destination/mode-consistent commute minutes.
// Pure functions only (no DOM, no app state) so node:test can exercise them. The Python scorer
// (apartmentscout/score.py, listings.py) stays the source of truth; every port below names its original.

export const SERVICE_LEVEL = { 'full-time': 1, 'part-time': 0.6, virtual: 0.35, none: 0 };
export const AMENITY_NAMES = {
  in_unit_wd: 'In-unit W/D', elevator: 'Elevator', doorman: 'Doorman', gym: 'Gym', pool: 'Pool', roof_deck: 'Roof deck',
  outdoor_space: 'Private outdoor space', dishwasher: 'Dishwasher', central_ac: 'Central air', pets: 'Pets allowed',
  parking: 'Parking', bike_room: 'Bike room', package_room: 'Package room', lounge: 'Lounge', coworking: 'Coworking', game_room: 'Game room',
};
export const BASES = [['monthly_cost', 'Monthly cost', 'net rent + recurring fees + one-time fees spread over the lease'], ['net', 'Net rent', 'net-effective rent after free months, fees left out'], ['gross', 'Gross rent', 'the rent in a month you pay, plus known monthly fees']];
export const COMMUTE_MODES = [['best', 'Best'], ['subway', 'Subway'], ['bus', 'Bus'], ['walk', 'Walk']];
const NOW_WORDS = ['now', 'immediate', 'immediately', 'asap', 'available now', 'vacant'];
const DETOUR = 1.25;   // street-network detour on straight-line walking distance (util.walkMinutes uses the same)

const lin = (x, x0, y0, x1, y1) => (x <= x0 ? y0 : x >= x1 ? y1 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0));
const r1 = (x) => Math.round(x * 10) / 10;
const usd = (x) => (x == null ? '?' : '$' + Math.round(x).toLocaleString('en-US'));
const clone = (o) => JSON.parse(JSON.stringify(o ?? null));

// ------------------------------------------------------------------ dates (listings.parse_date)
/** Day number (days since 1970-01-01, UTC) for ISO dates, m/d/yyyy and "Now"-style words (= today); else null. */
export function parseDay(v, today = null) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v;
  const s = String(v).trim(), low = s.toLowerCase();
  if (NOW_WORDS.includes(low) || low.startsWith('now')) return today;
  let m = s.slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return ymd(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) { const y = +m[3]; return ymd(y < 100 ? y + 2000 : y, +m[1], +m[2]); }
  return null;
}
function ymd(y, mo, d) {
  const t = Date.UTC(y, mo - 1, d), dt = new Date(t);
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? Math.round(t / 864e5) : null;
}
export const dayISO = (n) => new Date(n * 864e5).toISOString().slice(0, 10);
const dayLabel = (n) => { const d = new Date(n * 864e5); return `${d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })} ${d.getUTCDate()}`; };

// ------------------------------------------------------------------ money (listings.cost_model, score.budget_tier, score.score_cost)
/** The amount the budget gates read, by basis: monthly_cost (default), net or gross (cost_model's budget_amount). */
export function budgetAmount(cost = {}, basis = 'monthly_cost', monthly = cost?.monthly ?? null) {
  if (basis === 'gross' && cost?.paid_month != null) return cost.paid_month;
  if (basis === 'net' && cost?.rent?.net != null) return cost.rent.net;
  return monthly ?? null;
}
export function budgetTier(amount, budget = {}) {
  if (amount == null) return null;
  const tiers = budget.tiers || [];
  for (const t of tiers) if (amount <= t.max) return t.name;
  if (budget.hard_max && amount <= budget.hard_max && tiers.length) return `Above ${tiers[tiers.length - 1].name}`;
  return 'Over budget';
}
export function headroom(amount, budget = {}) {
  if (amount == null) return {};
  const out = {};
  for (const t of budget.tiers || []) out[t.name] = Math.round((t.max - amount) * 100) / 100;
  if (budget.hard_max && !(budget.tiers || []).some((t) => t.max === budget.hard_max)) out['Hard cap'] = Math.round((budget.hard_max - amount) * 100) / 100;
  return out;
}
export function scoreCost(amount, budget = {}) {
  if (amount == null) return null;
  const tiers = budget.tiers || [];
  const lo = tiers.length ? tiers[0].max : (budget.hard_max || amount);
  const hi = budget.hard_max || (tiers.length ? tiers[tiers.length - 1].max : lo * 1.1);
  if (amount <= lo) return lin(amount, lo * 0.8, 100, lo, 85);
  if (amount <= hi) return lin(amount, lo, 85, hi, 35);
  return Math.max(0, lin(amount, hi, 35, hi * 1.15, 0));
}

// ------------------------------------------------------------------ amenities (score.part_amenities)
/** Free-text values through a browser version of the wording normalisers; `approx` when that was needed. */
export function amenityValue(k, v) {
  if (typeof v !== 'string') return { v, approx: false };
  const t = v.trim().toLowerCase();
  if (k === 'doorman') {
    if (t in SERVICE_LEVEL) return { v: t, approx: false };
    if (/^(no|n|none|false|0|-)$/.test(t) || /\bno (door|concierge)/.test(t)) return { v: 'none', approx: true };
    if (/virtual|video intercom|remote/.test(t)) return { v: 'virtual', approx: true };
    if (/full|24|around the clock/.test(t)) return { v: 'full-time', approx: true };
    if (/part|hours|evening|daytime/.test(t)) return { v: 'part-time', approx: true };
    if (/door|concierge|attended/.test(t) || /^(yes|y )/.test(t)) return { v: 'full-time', approx: true };
    return { v: null, approx: true };
  }
  if (k === 'in_unit_wd') {
    if (/^(no|none|false)/.test(t) || t === 'n' || t === '0') return { v: false, approx: true };
    if (/building|shared|common|laundry room|on[- ]site/.test(t) && !/in[- ]?(unit|apartment|residence)/.test(t)) return { v: false, approx: true };
    if (/in[- ]?(unit|apartment|residence)|washer|w\/d/.test(t) || /^(yes|y |true)/.test(t) || t === 'y' || t === '1') return { v: true, approx: true };
    return { v: null, approx: true };
  }
  return { v: /^(yes|true)/.test(t) ? true : /^(no|false)/.test(t) ? false : null, approx: false };
}
export function amenitiesPart(L, crit) {
  const raw = L.amenities || {}, am = {};
  let approx = false;
  for (const [k, v] of Object.entries(raw)) { const r = amenityValue(k, v); am[k] = r.v; approx ||= r.approx; }
  const fails = [], unknown = [];
  const waived = new Set(L.waived_must_have || []);   // accepted by the renter without it: scored, not gated
  for (const k of crit.must_have || []) { const v = am[k]; if (v === false || v === 'none') { if (!waived.has(k)) fails.push(k); } else if (v == null) unknown.push(k); }
  let pts = 0, tot = 0, known = 0, have = 0, wanted = 0;
  const items = [];
  for (const [keys, w, tag] of [[crit.must_have || [], 3, 'must-have'], [crit.strongly_prefer || [], 2, 'strong'], [crit.nice_to_have || [], 1, 'nice']]) {
    for (const k of keys) {
      const v = am[k], name = (AMENITY_NAMES[k] || k.replaceAll('_', ' ')).toLowerCase();
      tot += w; wanted += 1;
      if (v == null) { pts += w * 0.5; items.push(`${name} unknown (${tag}, counted half)`); continue; }
      known += 1;
      if (k === 'doorman') {
        const lvl = typeof v === 'string' ? (SERVICE_LEVEL[v] ?? 0.5) : 0.5;
        pts += w * lvl; have += lvl > 0 ? 1 : 0;
        items.push(`doorman: ${typeof v === 'string' ? v : 'yes'} (${tag})`);
      } else { pts += w * (v ? 1 : 0); have += v ? 1 : 0; items.push(`${v ? 'has' : 'no'} ${name} (${tag})`); }
    }
  }
  if (!tot || !known) return { value: null, summary: 'amenities unknown, counted as neutral', items, fails, unknown, approx };
  let summary = `${have} of ${wanted} wanted amenities confirmed`;
  const nm = (k) => (AMENITY_NAMES[k] || k).toLowerCase();
  if (fails.length) summary += '; missing must-have: ' + fails.map(nm).join(', ');
  else if (unknown.length) summary += '; unverified must-have: ' + unknown.map(nm).join(', ');
  return { value: (100 * pts) / tot, summary, items, fails, unknown, approx };
}

// ------------------------------------------------------------------ move-in window (score.part_move_date)
export function movePart(L, crit, today) {
  const mi = crit.search?.move_in || {};
  let earliest = parseDay(mi.earliest), latest = parseDay(mi.latest);
  if (earliest == null && latest == null) return { value: null, summary: 'no move-in window in the criteria', gate: null };
  const avail = parseDay(L.available, today);
  if (avail == null) return { value: null, summary: 'availability unknown, counted as neutral', gate: null };
  earliest ??= latest; latest ??= earliest;
  const now = /^(now|immediate)/i.test(String(L.available || '').trim());
  const when = now ? 'now' : dayLabel(avail), win = `${dayLabel(earliest)}-${dayLabel(latest)}`;
  if (avail < earliest) {
    const early = earliest - avail;
    const v = early <= 14 ? 100 : early <= 45 ? lin(early, 14, 100, 45, 40) : lin(early, 45, 40, 90, 0);
    return { value: v, summary: `available ${when}, ${early} days before your earliest move-in${early <= 14 ? ', landlords often hold that long' : ', expect to pay overlapping rent'}`, gate: null };
  }
  if (avail > latest) {
    const late = avail - latest;
    const v = late <= 14 ? lin(late, 0, 100, 14, 50) : lin(late, 14, 50, 30, 0);
    return { value: v, summary: `available ${when}, ${late} days after your latest move-in`, gate: mi.hard ? 'fails:move_date' : 'move_date:after_window' };
  }
  return { value: 100, summary: `available ${when}, inside your ${win} window`, gate: null };
}

// ------------------------------------------------------------------ space (score.part_space, bare reported sizes only)
export const spaceValue = (sq, u = {}) => {
  const f = u.sqft_floor ?? 450, g = u.sqft_good ?? 750, gr = u.sqft_great ?? 1050;
  return sq < g ? lin(sq, f, 0, g, 50) : lin(sq, g, 50, gr, 100);
};
/** Exact only for a bare reported `sqft` with a known bedroom count; estimated sizes keep the scorer's value. */
export function spacePart(L, unit = {}) {
  const simple = !(L.size && typeof L.size === 'object') && !L.sqft_basis && !L.sqft_estimate && !L.sqft_range && Number.isFinite(L.sqft) && L.beds != null;
  if (!simple) return null;
  const sq = Math.round(L.sqft);
  let v = spaceValue(sq, unit), summary = `${sq.toLocaleString('en-US')} ft² (reported)`;
  const minBeds = unit.min_beds ?? 0;
  if (L.beds < minBeds) { v *= 0.5; summary += ', below the bedroom minimum'; }
  return { value: v, summary };
}

// ------------------------------------------------------------------ commute (score.part_commute + per-mode minutes)
/** A listing's stored commute entry for a destination, or null when the destination moved or is new. */
export const commuteEntry = (L, d) => (d && !d._stale ? L.commute?.[d.name] || null : null);
export function walkEstimate(L, d, kmh = 4.8) {
  if ([L?.lat, L?.lon, d?.lat, d?.lon].some((v) => v == null)) return null;
  const R = 6371000, r = Math.PI / 180, dl = (d.lat - L.lat) * r, dn = (d.lon - L.lon) * r;
  const a = Math.sin(dl / 2) ** 2 + Math.cos(L.lat * r) * Math.cos(d.lat * r) * Math.sin(dn / 2) ** 2;
  return (2 * R * Math.asin(Math.sqrt(a)) * DETOUR) / ((kmh * 1000) / 60);
}
/** Door-to-door minutes in one mode. best = the router's fastest (the commute-<dest>.json surface); subway and bus
 *  only from the router's per-mode results (never relabelled); walk from the router, else straight line x 1.25. */
export function modeMinutes(L, d, mode = 'best', kmh = 4.8) {
  const e = commuteEntry(L, d), m = e?.modes || {};
  if (mode === 'walk') return m.walk?.minutes ?? (e?.mode === 'walk' ? e.minutes : null) ?? walkEstimate(L, d, kmh);
  if (mode === 'bus') return m.bus?.minutes ?? null;
  if (mode === 'subway') return m.subway?.minutes ?? (e && !e.modes && e.mode !== 'walk' ? e.minutes ?? null : null);
  return e?.minutes ?? null;
}
export function commutePart(L, crit) {
  let tot = 0, wsum = 0;
  const items = [];
  for (const d of crit.commute?.destinations || []) {
    const m = commuteEntry(L, d)?.minutes;
    if (m == null) continue;
    const mx = d.max_minutes ?? 30, w = d.weight ?? 1;
    const s = m <= mx ? lin(m, mx * 0.5, 100, mx, 50) : lin(m, mx, 50, mx * 2, 0);
    tot += s * w; wsum += w;
    items.push([w, `${Math.round(m)} min to ${d.name}${m > mx ? ` (limit ${mx})` : ''}`]);
  }
  if (!wsum) return { value: null, summary: 'commute not computed, counted as neutral', items: [] };
  const top = items.reduce((a, b) => (b[0] > a[0] ? b : a));
  return { value: tot / wsum, summary: top[1] + (items.length > 1 ? ` (+${items.length - 1} more)` : ''), items: items.map((x) => x[1]) };
}
/** Layer file key for a destination and mode: best = kind "commute"; subway / bus = kind "commute-mode" with that mode.
 *  Walk has no surface. A layer whose destination sits more than ~60 m from the edited one is stale and skipped. */
export function commuteLayerKey(layers, d, mode = 'best') {
  if (!d || mode === 'walk') return null;
  for (const [k, g] of Object.entries(layers || {})) {
    if (!g?.rows) continue;
    const gd = g.destination || { name: g.name };
    if ((gd.name ?? g.name) !== d.name) continue;
    if (gd.lat != null && d.lat != null && Math.hypot((gd.lat - d.lat) * 111000, (gd.lon - d.lon) * 85000) > 60) continue;
    if (mode === 'best' && g.kind === 'commute') return k;
    if (mode !== 'best' && g.kind === 'commute-mode' && g.mode === mode) return k;
  }
  return null;
}
/** Which modes can be shown for a destination: a surface (layer), per-listing minutes, both or neither. */
export function modeOptions(layers, listings, d) {
  return COMMUTE_MODES.map(([mode, label]) => {
    const layer = commuteLayerKey(layers, d, mode);
    const listing = mode === 'walk' ? d?.lat != null : (listings || []).some((L) => modeMinutes(L, d, mode) != null);
    return { mode, label, layer, listing, enabled: !!(layer || listing) };
  });
}
/** Radius in metres of a walking ring of `min` minutes, consistent with walkEstimate. */
export const walkRingMetres = (min, kmh = 4.8) => (min * kmh * 1000) / 60 / DETOUR;

// ------------------------------------------------------------------ the editable profile
/** The editable part of the criteria. */
export function profileOf(crit = {}) {
  const b = crit.budget || {}, u = crit.unit || {}, mi = crit.search?.move_in || {};
  return {
    budget: { basis: b.basis || 'monthly_cost', tiers: (b.tiers || []).map((t) => ({ name: t.name, max: t.max })), hard_max: b.hard_max ?? null },
    must_have: [...(crit.must_have || [])], strongly_prefer: [...(crit.strongly_prefer || [])], nice_to_have: [...(crit.nice_to_have || [])],
    move_in: { earliest: mi.earliest || '', latest: mi.latest || '', hard: !!mi.hard },
    unit: { min_beds: u.min_beds ?? 0, sqft_floor: u.sqft_floor ?? 450, sqft_good: u.sqft_good ?? 750, sqft_great: u.sqft_great ?? 1050 },
    destinations: (crit.commute?.destinations || []).map((d) => ({ name: d.name || '', address: d.address || '', lat: d.lat ?? null, lon: d.lon ?? null,
      arrive_by: d.arrive_by || '', max_minutes: d.max_minutes ?? 30, weight: d.weight ?? 1, mode: d.mode || 'best' })),
  };
}
const sameSpot = (a, b) => a && b && a.lat != null && b.lat != null && Math.abs(a.lat - b.lat) < 5e-4 && Math.abs(a.lon - b.lon) < 5e-4;
/** New criteria = the original with the profile laid over it. Destinations that are new, renamed, moved or have a
 *  new arrival time are marked `_stale`: their stored minutes and surfaces no longer apply. Never mutates `crit`. */
export function applyProfile(crit, p) {
  const c = clone(crit) || {};
  const orig = Object.fromEntries((crit?.commute?.destinations || []).map((d) => [d.name, d]));
  c.budget = { ...(c.budget || {}), basis: p.budget.basis, tiers: p.budget.tiers.map((t) => ({ name: t.name, max: +t.max })) };
  if (p.budget.hard_max != null && p.budget.hard_max !== '') c.budget.hard_max = +p.budget.hard_max; else delete c.budget.hard_max;
  c.must_have = [...p.must_have]; c.strongly_prefer = [...p.strongly_prefer]; c.nice_to_have = [...p.nice_to_have];
  c.search = { ...(c.search || {}), move_in: { ...(c.search?.move_in || {}), earliest: p.move_in.earliest || null, latest: p.move_in.latest || null } };
  if (p.move_in.hard) c.search.move_in.hard = true; else delete c.search.move_in.hard;
  c.unit = { ...(c.unit || {}), ...Object.fromEntries(Object.entries(p.unit).map(([k, v]) => [k, +v])) };
  c.commute = { ...(c.commute || {}), destinations: p.destinations.map((d) => {
    const o = orig[d.name];
    const out = { ...(o || {}), name: d.name, address: d.address || undefined, lat: d.lat == null || d.lat === '' ? null : +d.lat, lon: d.lon == null || d.lon === '' ? null : +d.lon,
      arrive_by: d.arrive_by || undefined, max_minutes: +d.max_minutes, weight: +d.weight, mode: d.mode && d.mode !== 'best' ? d.mode : undefined };
    if (!o || !sameSpot(o, out) || (o.arrive_by || '') !== (d.arrive_by || '')) out._stale = true;
    return out;
  }) };
  return c;
}
/** Problems that block Apply, as readable sentences. */
export function validateProfile(p) {
  const e = [], b = p.budget, tiers = b.tiers;
  if (!tiers.length) e.push('Add at least one budget tier.');
  tiers.forEach((t, i) => {
    if (!String(t.name || '').trim()) e.push(`Budget tier ${i + 1} needs a name.`);
    if (!(+t.max > 0)) e.push(`Budget tier ${t.name || i + 1} needs a positive amount.`);
    if (i && +t.max <= +tiers[i - 1].max) e.push(`Budget tiers must rise: ${t.name || i + 1} is not above ${tiers[i - 1].name}.`);
  });
  if (new Set(tiers.map((t) => t.name)).size !== tiers.length) e.push('Budget tier names must differ.');
  if (b.hard_max != null && b.hard_max !== '' && tiers.length && +b.hard_max < +tiers[tiers.length - 1].max) e.push('The hard cap is below the last tier.');
  const { earliest, latest } = p.move_in;
  if (earliest && parseDay(earliest) == null) e.push('Earliest move-in is not a date.');
  if (latest && parseDay(latest) == null) e.push('Latest move-in is not a date.');
  if (earliest && latest && parseDay(latest) < parseDay(earliest)) e.push('Latest move-in is before the earliest.');
  const u = p.unit;
  if (!(+u.sqft_floor < +u.sqft_good && +u.sqft_good < +u.sqft_great)) e.push('Size targets must rise: floor < good < great.');
  if (+u.min_beds < 0) e.push('Minimum bedrooms cannot be negative.');
  const names = p.destinations.map((d) => String(d.name || '').trim());
  if (names.some((n) => !n)) e.push('Every destination needs a name.');
  if (new Set(names).size !== names.length) e.push('Destination names must differ.');
  p.destinations.forEach((d) => {
    const has = d.lat != null && d.lat !== '' && d.lon != null && d.lon !== '';
    if (has && (Math.abs(+d.lat) > 90 || Math.abs(+d.lon) > 180 || Number.isNaN(+d.lat) || Number.isNaN(+d.lon))) e.push(`${d.name || 'A destination'}: latitude or longitude is out of range.`);
    if (!has && !String(d.address || '').trim()) e.push(`${d.name || 'A destination'}: give an address or pick the spot on the map.`);
    if (d.arrive_by && !/^\d{1,2}:\d{2}$/.test(d.arrive_by)) e.push(`${d.name || 'A destination'}: arrive-by should look like 09:00.`);
    if (!(+d.max_minutes > 0)) e.push(`${d.name || 'A destination'}: the commute limit must be positive.`);
    if (!(+d.weight >= 0)) e.push(`${d.name || 'A destination'}: weight cannot be negative.`);
  });
  const all = [...p.must_have, ...p.strongly_prefer, ...p.nice_to_have];
  if (new Set(all).size !== all.length) e.push('An amenity can only sit in one group.');
  return e;
}
/** Human list of what changed between two profiles. */
export function diffProfile(a, b) {
  const out = [], nm = (k) => AMENITY_NAMES[k] || k;
  if (a.budget.basis !== b.budget.basis) out.push(`Budget basis: ${basisLabel(a.budget.basis)} → ${basisLabel(b.budget.basis)}`);
  const ta = a.budget.tiers.map((t) => `${t.name} ${usd(+t.max)}`).join(', '), tb = b.budget.tiers.map((t) => `${t.name} ${usd(+t.max)}`).join(', ');
  if (ta !== tb) out.push(`Budget tiers: ${tb}`);
  if (+a.budget.hard_max !== +b.budget.hard_max) out.push(`Hard cap: ${usd(+b.budget.hard_max || null)}`);
  for (const [k, t] of [['must_have', 'Must-haves'], ['strongly_prefer', 'Strongly prefer'], ['nice_to_have', 'Nice to have']]) {
    if (a[k].join() !== b[k].join()) out.push(`${t}: ${b[k].map(nm).join(', ') || 'none'}`);
  }
  if (a.move_in.earliest !== b.move_in.earliest || a.move_in.latest !== b.move_in.latest || a.move_in.hard !== b.move_in.hard) out.push(`Move-in: ${b.move_in.earliest || '?'} to ${b.move_in.latest || '?'}${b.move_in.hard ? ' (hard)' : ''}`);
  if (JSON.stringify(a.unit) !== JSON.stringify(b.unit)) out.push(`Size: ${b.unit.min_beds}+ bd, ${b.unit.sqft_floor} / ${b.unit.sqft_good} / ${b.unit.sqft_great} ft²`);
  const da = Object.fromEntries(a.destinations.map((d) => [d.name, d]));
  for (const d of b.destinations) {
    const o = da[d.name];
    if (!o) out.push(`New destination: ${d.name}`);
    else if (JSON.stringify(o) !== JSON.stringify(d)) out.push(`Destination ${d.name}: ${['address', 'lat', 'lon', 'arrive_by', 'max_minutes', 'weight', 'mode'].filter((k) => String(o[k] ?? '') !== String(d[k] ?? '')).join(', ').replaceAll('_', ' ')} changed`);
  }
  for (const n of Object.keys(da)) if (!b.destinations.some((d) => d.name === n)) out.push(`Removed destination: ${n}`);
  return out;
}
export const basisLabel = (k) => (BASES.find((b) => b[0] === k) || BASES[0])[1].toLowerCase();

// ------------------------------------------------------------------ re-evaluation
const KEEP_GATE = /^(unknown_cost$|unverified:(fees|lease_term|price)$|concession|price_dispute$)/;   // price-basis hook: unverified:price is a price gate, kept
/**
 * Re-evaluate one listing's server score under edited criteria, in the browser. Recomputes what depends only on
 * the criteria: cost part (budget amount by basis), budget tier, headroom, over-budget gate, must-have gates and
 * the amenities part, the move-in part and gate, the size part (bare reported sizes), the commute part (stored
 * minutes with edited limits and weights), overall / confidence / range, and eligibility. `base` is the score
 * from listings.json and is never mutated. `kept` lists dimensions left at the scorer's value.
 */
export function evaluate(L, base, crit, today) {
  const s = clone(base) || {};
  const W = crit.weights || {}, dims = (crit.scoring?.dimensions || []).map((d) => d[0]);
  const DIMS = dims.length ? dims : Object.keys(s.parts || {});
  const c = s.cost || {}, budget = crit.budget || {};
  const parts = { ...(s.parts || {}) }, pr = { ...(s.part_ranges || {}) }, kept = [];
  const reasons = Object.fromEntries((s.reasons || []).map((r) => [r.dim, r]));
  const say = (dim, value, summary, items) => {
    parts[dim] = value == null ? null : r1(value); delete pr[dim];
    reasons[dim] = { dim, pts: 0, text: `0 ${dim.replaceAll('_', ' ')}: ${summary}`, ...(items?.length ? { items } : {}) };
  };
  // cost
  const amount = budgetAmount(c, budget.basis || 'monthly_cost', s.monthly_cost ?? c.monthly ?? null);
  if (amount == null) say('cost', null, 'monthly cost unknown, counted as neutral', reasons.cost?.items);
  else {
    const v = scoreCost(amount, budget), tier = budgetTier(amount, budget);
    say('cost', v, `${usd(amount)}/mo on your ${basisLabel(budget.basis)} basis, ${/^(Above|Over)/.test(tier) ? tier.toLowerCase() : 'inside ' + tier}${c.fees_known ? '' : ', fees unknown'}`, reasons.cost?.items);
    const [lo, hi] = c.monthly_range || [null, null];
    if (lo != null && (lo !== amount || (hi != null && hi !== amount))) {
      const best = scoreCost(lo, budget), worst = hi != null ? scoreCost(hi, budget) : v;
      pr.cost = [r1(Math.min(worst, v)), r1(Math.max(best, v))];
    }
  }
  c.budget_amount = amount;
  c.headroom = headroom(amount, budget);
  if ((base?.cost?.concession_needed?.target ?? null) !== (budget.tiers?.[0]?.max ?? null)) delete c.concession_needed;
  s.cost = c;
  s.budget_tier = budgetTier(amount, budget);
  // amenities and must-haves
  const am = amenitiesPart(L, crit);
  say('amenities', am.value, am.summary, am.items);
  if (am.approx) kept.push('amenity wording');
  // size
  const sp = spacePart(L, crit.unit || {});
  if (sp) say('space', sp.value, sp.summary); else if (L.sqft != null || L.size) kept.push('space');
  // move-in
  const mv = movePart(L, crit, today);
  say('move_date', mv.value, mv.summary);
  // commute
  const cp = commutePart(L, crit);
  say('commute', cp.value, cp.summary, cp.items);
  // overall, confidence, range (scorer weights)
  const wtot = DIMS.reduce((a, k) => a + (W[k] || 0), 0) || 1;
  const knownW = DIMS.reduce((a, k) => a + (parts[k] != null ? W[k] || 0 : 0), 0);
  s.overall = knownW ? r1(DIMS.reduce((a, k) => a + (W[k] || 0) * (parts[k] ?? 50), 0) / wtot) : null;
  s.confidence = Math.round((100 * (knownW - (c.price_unverified && parts.cost != null ? (W.cost || 0) / 2 : 0))) / wtot);   // price-basis hook: a weak price counts half
  const bound = (k, end) => (parts[k] == null ? 100 * end : pr[k] ? pr[k][end] : parts[k]);
  s.range = [r1(DIMS.reduce((a, k) => a + (W[k] || 0) * bound(k, 0), 0) / wtot), r1(DIMS.reduce((a, k) => a + (W[k] || 0) * bound(k, 1), 0) / wtot)];
  s.parts = parts; s.part_ranges = pr;
  s.reasons = (s.reasons || []).map((r) => reasons[r.dim] || r);
  for (const k of ['cost', 'amenities', 'space', 'move_date', 'commute']) if (reasons[k] && !s.reasons.some((r) => r.dim === k)) s.reasons.push(reasons[k]);
  // gates, in the scorer's order
  const active = !['gone', 'rejected'].includes(L.status);
  const old = base?.gates || [];
  const gates = [];
  if (amount != null && budget.hard_max && amount > budget.hard_max) gates.push('over_budget');
  if (am.fails.length) gates.push('fails:' + am.fails.join(','));
  if (mv.gate === 'fails:move_date') gates.push(mv.gate);
  if (am.unknown.length) gates.push('unverified:' + am.unknown.join(','));
  gates.push(...old.filter((g) => KEEP_GATE.test(g)));
  if (active && mv.gate === 'move_date:after_window') gates.push(mv.gate);
  gates.push(...old.filter((g) => g.startsWith('stale')));
  s.gates = gates;
  s.eligible = active && !gates.some((g) => g.startsWith('over_budget') || g.startsWith('fails'));
  return { score: s, kept };
}
/** What the edited criteria change across all listings, for the Preview panel. */
export function previewImpact(listings, crit, today) {
  const out = { eligibleBefore: 0, eligibleAfter: 0, gained: [], lost: [], tierChanged: 0, overBudget: 0, failsMust: 0, unverifiedMust: 0, lateMove: 0, kept: {} };
  for (const L of listings) {
    const base = L._score0 || L.score;
    const { score: s, kept } = evaluate(L, base, crit, today);
    if (base?.eligible) out.eligibleBefore++;
    if (s.eligible) out.eligibleAfter++;
    if (s.eligible && !base?.eligible) out.gained.push(L.id);
    if (!s.eligible && base?.eligible) out.lost.push(L.id);
    if (s.budget_tier !== base?.budget_tier) out.tierChanged++;
    if (s.gates.includes('over_budget')) out.overBudget++;
    if (s.gates.some((g) => g.startsWith('fails:') && g !== 'fails:move_date')) out.failsMust++;
    if (s.gates.some((g) => g.startsWith('unverified:') && !/^unverified:(fees|lease_term|price)$/.test(g))) out.unverifiedMust++;
    if (s.gates.some((g) => g.includes('move_date'))) out.lateMove++;
    for (const k of kept) out.kept[k] = (out.kept[k] || 0) + 1;
  }
  return out;
}
/** Steps the browser cannot do, each with the exact command. */
export function serverSteps(crit0, crit1, impact = { kept: {} }) {
  const steps = [];
  const stale = (crit1.commute?.destinations || []).filter((d) => d._stale);
  if (stale.length) steps.push({ what: `Commute minutes and the commute surface for ${stale.map((d) => d.name).join(', ')} (new, renamed, moved or a new arrival time): the commute part leaves ${stale.length > 1 ? 'them' : 'it'} out until recomputed.`, cmd: 'apartmentscout commute && apartmentscout score && apartmentscout build' });
  const u0 = crit0.unit || {}, u1 = crit1.unit || {};
  if (impact.kept.space && ['sqft_floor', 'sqft_good', 'sqft_great', 'min_beds'].some((k) => (u0[k] ?? null) !== (u1[k] ?? null))) steps.push({ what: `Space for ${impact.kept.space} listings with estimated sizes keeps the scorer's value.`, cmd: 'apartmentscout score && apartmentscout build' });
  if (impact.kept['amenity wording']) steps.push({ what: `${impact.kept['amenity wording']} listings describe an amenity in words; the browser reads them approximately.`, cmd: 'apartmentscout score && apartmentscout build' });
  if ((crit1.commute?.destinations || []).some((d) => d.mode)) steps.push({ what: 'Preferred mode sets the map, filters and columns here; the score still ranks the commute on the fastest transit time, as apartmentscout score does.', cmd: null });
  steps.push({ what: 'Your files are unchanged. To make this the real ranking, paste the exported snippet into criteria.yaml and rescore.', cmd: 'apartmentscout score && apartmentscout build' });
  return steps;
}

// ------------------------------------------------------------------ export
const q = (s) => JSON.stringify(String(s));
/** A criteria.yaml snippet with the edited keys (commute.transit and scoring are left out on purpose). */
export function toYAML(p, name = '') {
  const L = [`# ApartmentScout search criteria${name ? ' for ' + name : ''}, edited in the dashboard.`,
    '# Replace these keys in criteria.yaml (keep commute.transit and scoring as they are),',
    '# then run: apartmentscout score && apartmentscout build',
    '# Added, renamed or moved a destination? Run apartmentscout commute before score.', ''];
  L.push('search:', '  move_in:');
  if (p.move_in.earliest) L.push(`    earliest: ${p.move_in.earliest}`);
  if (p.move_in.latest) L.push(`    latest: ${p.move_in.latest}`);
  if (p.move_in.hard) L.push('    hard: true              # after the window fails the gate instead of warning');
  L.push('', 'budget:', `  basis: ${p.budget.basis}`, '  tiers:');
  for (const t of p.budget.tiers) L.push(`    - {name: ${q(t.name)}, max: ${+t.max}}`);
  if (p.budget.hard_max != null && p.budget.hard_max !== '') L.push(`  hard_max: ${+p.budget.hard_max}`);
  L.push('', 'unit:', ...Object.entries(p.unit).map(([k, v]) => `  ${k}: ${+v}`), '');
  for (const k of ['must_have', 'strongly_prefer', 'nice_to_have']) L.push(`${k}: [${p[k].join(', ')}]`);
  L.push('', 'commute:', '  destinations:');
  for (const d of p.destinations) {
    L.push(`    - name: ${q(d.name)}`);
    if (d.address) L.push(`      address: ${q(d.address)}`);
    if (d.lat != null && d.lat !== '') L.push(`      lat: ${(+d.lat).toFixed(6)}`, `      lon: ${(+d.lon).toFixed(6)}`);
    if (d.arrive_by) L.push(`      arrive_by: ${q(d.arrive_by)}`);
    L.push(`      max_minutes: ${+d.max_minutes}`, `      weight: ${+d.weight}`);
    if (d.mode && d.mode !== 'best') L.push(`      mode: ${d.mode}            # preferred mode for the dashboard; the scorer uses the fastest`);
  }
  if (!p.destinations.length) L[L.length - 1] = '  destinations: []';
  return L.join('\n') + '\n';
}
/** Amenity keys present in the data or the criteria, most often known first. */
export function amenityKeys(listings, crit = {}) {
  const n = new Map();
  for (const L of listings) for (const [k, v] of Object.entries(L.amenities || {})) n.set(k, (n.get(k) || 0) + (v == null ? 0 : 1));
  for (const k of [...(crit.must_have || []), ...(crit.strongly_prefer || []), ...(crit.nice_to_have || [])]) if (!n.has(k)) n.set(k, 0);
  return [...n].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k, known]) => ({ k, known, label: AMENITY_NAMES[k] || k.replaceAll('_', ' ') }));
}

// ------------------------------------------------------------------ cash flow (drawer)
/** Recurring monthly cash, cash at signing and the total over the lease, from score.cost and price fields only. */
export function cashFlow(L) {
  const c = L.score?.cost || {}, p = L.price || {}, rent = c.rent || {}, up = c.upfront || {};
  const fm = c.fees_monthly ?? p.fees_monthly ?? null;
  const feeLo = Array.isArray(fm) ? fm[0] : typeof fm === 'number' ? fm : null;
  const monthly = {
    gross: rent.gross ?? p.gross ?? null,
    fees: c.fees_known ? (fm ?? 0) : null,
    paid: c.paid_month ?? null,
    net: rent.net ?? null, basis: rent.basis || null, free: rent.free_months ?? p.free_months ?? null,
    equiv: c.monthly ?? L.score?.monthly_cost ?? null, open: !!(c.monthly_range && c.monthly_range[1] == null),
  };
  const lines = [['First month', up.first_month ?? null, monthly.fees ? 'rent + monthly fees' : 'rent'], ['Security deposit', up.deposit ?? null, 'refundable']];
  for (const [k, t] of [['broker_fee', 'Broker fee'], ['application_fee', 'Application fee'], ['fees_one_time', 'Amenity / move-in fees']]) if (p[k] != null) lines.push([t, +p[k], 'once']);
  if (p.upfront?.nonrefundable != null) lines.push(['Other one-time', +p.upfront.nonrefundable, 'once']);
  const listed = lines.slice(2).reduce((a, x) => a + (x[1] || 0), 0);
  if (up.one_time_fees != null && Math.abs(up.one_time_fees - listed) > 1) lines.push([listed ? 'Other one-time fees' : 'One-time fees', up.one_time_fees - listed, 'once']);
  if (up.other_refundable) lines.push(['Other refundable', up.other_refundable, 'refundable']);
  const unknown = (c.move_in_unknown || []).map((u) => (u === 'one-time fees' ? 'one-time fees (broker, application, amenity or move-in)' : u));
  const signing = { lines, total: c.move_in_min ?? null, unknown };
  const term = rent.lease_months || null, n = term || 12;
  let lease;
  if (rent.basis === 'conditional' && rent.illustrations?.length) {
    const one = up.one_time_fees || 0;
    lease = { term: null, options: rent.illustrations.map((x) => ({ months: x.lease_months, total: Math.round((x.net + (feeLo || 0)) * x.lease_months + one) })), feesUnknown: !c.fees_known };
  } else lease = { term: n, assumed: !term, total: monthly.equiv != null ? Math.round(monthly.equiv * n) : null, feesUnknown: !c.fees_known, deposit: up.deposit ?? null };
  return { monthly, signing, lease };
}
