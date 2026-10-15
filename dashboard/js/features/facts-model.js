// Unknowns that move a score, and the renter's own numbers for them: the pure part.
//
// Some facts a home does not state cost it points: an unstated size is estimated from the building's other homes, unknown
// monthly fees are estimated or left out, two sources that disagree on the price are scored at the dearer one, an unknown
// washer/dryer counts half, a floor guessed from the unit number counts for less. This module lists those unknowns for a home
// with the score they span, and re-scores the home from a value the renter types: size (ft²), monthly fees ($), the rent
// they will pay each month ($), an in-unit washer/dryer (yes/no) and the floor.
//
// apartmentscout/renterfacts.py does the same arithmetic for `apartmentscout score` (and writes the values into the score as
// `score.renter`); tests/test_renterfacts_parity.py feeds both the same cases and compares. The browser re-scores through
// criteria.js `evaluate` (the port of the scorer's criteria-driven parts) after adjusting the inputs that evaluate keeps.
// No DOM, no storage, so `node --test` can load it.
import { evaluate, scoreCost, amenitiesPart, amenityValue } from '../criteria.js';

export const VERSION = 1;
export const SOURCE = 'renter';
export const KINDS = ['size', 'price', 'fees', 'wd', 'floor'];
/** Per kind: the dimension it moves, the prompt, and the input. */
export const KIND = {
  size: { label: 'Size', dim: 'space', ask: 'Enter the size', unit: 'ft²', input: 'number', min: 50, max: 20000, step: 1, placeholder: 'e.g. 640', hint: 'Square feet, from the floor plan or the leasing office.' },
  price: { label: 'Monthly rent', dim: 'cost', ask: 'Confirm the price', unit: '$ a month', input: 'number', min: 100, max: 100000, step: 1, placeholder: 'e.g. 4,725', hint: 'The rent you will pay each month after any free months, from a written quote.' },
  fees: { label: 'Monthly fees', dim: 'cost', ask: 'Enter the monthly fees', unit: '$ a month', input: 'number', min: 0, max: 20000, step: 1, placeholder: 'e.g. 135, or 0', hint: 'Required monthly fees (amenity, water, and so on). Enter 0 if there are none.' },
  wd: { label: 'Washer/dryer in the unit', dim: 'amenities', ask: 'Is there a washer/dryer in the unit?', input: 'bool', hint: 'Ask the leasing office, or check the floor plan: shared laundry does not count.' },
  floor: { label: 'Floor', dim: 'light_view', ask: 'Enter the floor', unit: '', input: 'number', min: 1, max: 120, step: 1, placeholder: 'e.g. 12', hint: 'The floor the unit is on.' },
};
export const FEES_HIGH_FALLBACK = 300;   // when nothing comparable is known, "could be this much a month" for the range
const FLOOR_SPREAD = 3;                  // a floor guessed from the unit number may be this many floors off
const clone = (o) => JSON.parse(JSON.stringify(o ?? null));
const r1 = (x) => Math.round(x * 10) / 10;
const r2 = (x) => Math.round(x * 100) / 100;
const clamp = (x) => Math.max(0, Math.min(100, x));
const usd = (x) => `$${Math.round(x).toLocaleString('en-US')}`;
const num = (v) => {
  if (typeof v === 'boolean') return null;
  const x = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v.replace(/[,$\s]/g, '')) : NaN;
  return Number.isFinite(x) ? x : null;
};

// ------------------------------------------------------------------ values (renterfacts.value_of)
/** A typed value validated for its kind, or null. */
export function checkValue(kind, v) {
  if (kind === 'wd') return typeof v === 'boolean' ? v : null;
  const x = num(v);
  if (x == null) return null;
  if (kind === 'size') return x >= 50 && x <= 20000 ? Math.floor(x + 0.5) : null;
  if (kind === 'fees') return x >= 0 && x <= 20000 ? r2(x) : null;
  if (kind === 'price') return x >= 100 && x <= 100000 ? r2(x) : null;
  if (kind === 'floor') return Number.isInteger(x) && x >= 1 && x <= 120 ? x : null;
  return null;
}
/** One home's facts cleaned to the schema: { kind: { value, at, source } }. */
export function normalize(raw, today = new Date().toISOString().slice(0, 10)) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const k of KINDS) {
    const e = raw[k], v = checkValue(k, e && typeof e === 'object' ? e.value : e);
    if (v == null) continue;
    out[k] = { value: v, at: e && typeof e.at === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.at) ? e.at : today, source: SOURCE };
  }
  return out;
}

// ------------------------------------------------------------------ pieces of the money model (listings.py)
const feeParts = (c) => {
  if (!c.fees_known) return [0, null];
  const f = c.fees_monthly;
  return Array.isArray(f) ? [f[0], f[1]] : [f ?? 0, f ?? 0];
};
const without = (list, drop) => (list || []).filter((x) => !drop.some((d) => (d instanceof RegExp ? d.test(x) : d === x)));

/** score.part_renewal for a stated net rent against the gross. */
const renewalPart = (gross, net) => (gross == null ? null : net >= gross ? 100 : Math.max(0, 100 - 9 * (100 * (gross - net)) / gross));

/** Settle the money inputs of a score copy `s` for the typed fees and rent (mutates `s`). */
function applyMoney(s, f, L) {
  const c = (s.cost ||= {});
  const before = feeParts(c);
  let known = !!c.fees_known, lo = before[0], hi = before[1];
  if (f.fees) { known = true; lo = hi = f.fees.value; c.fees_known = true; if (lo) c.fees_monthly = lo; else delete c.fees_monthly; }
  const spread = c.one_time_spread || 0, feeLo = known ? lo : 0, feeHi = known ? hi : null;
  let monthly, range;
  if (f.price) {
    const N = f.price.value, gross = c.rent?.gross ?? L.price?.gross ?? N;
    monthly = N + feeLo + spread;
    c.rent = { ...(c.rent || {}), gross, net: N, basis: 'stated' };
    for (const k of ['illustrations', 'net_unverified', 'range', 'free_months']) delete c.rent[k];
    Object.assign(c, { price_basis: 'renter_quote', price_checked: f.price.at, price_source: 'the renter, from a written quote' });
    for (const k of ['price_unverified', 'price_range', 'scenarios', 'dispute', 'concession']) delete c[k];
    range = [monthly, feeHi != null ? N + feeHi + spread : null];
    s.parts = { ...(s.parts || {}), renewal_risk: (() => { const v = renewalPart(gross, N); return v == null ? null : r1(v); })() };
    s.gates = without(s.gates, ['price_dispute', 'unverified:price', 'unverified:lease_term', /^concession:/]);
    s.flags = without(s.flags, ['price_dispute', 'price_unverified', 'net_conditional']);
    s.tags = without(s.tags, ['price unverified', ...(L.conflicts ? [] : ['source conflict'])]);
  } else {
    const d = feeLo - before[0];
    monthly = c.monthly + d;
    range = [Math.min(r2((c.monthly_range?.[0] ?? c.monthly) + d), monthly), monthly];   // typed fees are one number: the top of the range is the amount
    if (c.scenarios) c.scenarios = c.scenarios.map((x) => ({ ...x, monthly: r2(x.monthly - before[0] + feeLo) }));
  }
  if (f.fees) {
    s.gates = without(s.gates, ['unverified:fees']);
    s.flags = without(s.flags, ['fees_unknown']);
  }
  let est = c.fees_estimate;
  if (f.fees) {
    est = est?.condo_part ? { monthly: est.condo_part[0], high: est.condo_part[1], parts: (est.parts || []).filter((p) => /condo/.test(p)), condo_part: est.condo_part } : null;
    if (!est) s.flags = without(s.flags, ['fees_estimated']);
  }
  c.monthly = r2(monthly);
  if (c.rent?.gross != null) c.paid_month = r2(c.rent.gross + feeLo);
  if (est) {
    c.fees_estimate = est;
    c.monthly_expected = r2(monthly + est.monthly);
    c.monthly_range = [c.monthly, r2(monthly + est.high)];
    s.monthly_cost = c.monthly_expected;
  } else {
    delete c.fees_estimate; delete c.monthly_expected;
    c.monthly_range = range.map((x) => (x == null ? null : r2(x)));
    s.monthly_cost = c.monthly;
  }
  return s;
}

// ------------------------------------------------------------------ the light and view dimension (score.part_light)
/** Light & view for a floor, from what the scorer recorded about everything but the floor (`light_hint`). null without a hint. */
export function lightWithFloor(hint, floor) {
  if (!hint || hint.rest == null) return null;
  const raw = clamp(hint.rest + Math.min(20, floor * 0.8)), a = hint.assumed ? 50 + 0.5 * (raw - 50) : raw;
  return hint.pv != null ? 0.5 * a + 0.5 * hint.pv : a;
}

// ------------------------------------------------------------------ re-scoring from typed values
const DIM_OF = { size: 'space', fees: 'cost', price: 'cost', wd: 'amenities', floor: 'light_view' };
const SAY = {
  size: (v) => `you entered ${Math.round(v).toLocaleString('en-US')} ft²`, fees: (v) => `you entered ${usd(v)} a month in fees`,
  price: (v) => `you entered ${usd(v)} a month for the rent`, wd: (v) => (v ? 'you confirmed an in-unit washer/dryer' : 'you confirmed no in-unit washer/dryer'),
  floor: (v) => `you entered floor ${v}`,
};

/**
 * The home's score with the renter's numbers applied (a copy; `score` and `L` are untouched). `facts` is { kind: { value, at } };
 * `day` is the scorer's day as criteria.js numbers it (scoreDay()).
 * A fact the scorer already used (score.renter has the same value) is not applied twice.
 */
export function applyFacts(L, score, crit, facts, day) {
  const f = {};
  for (const k of KINDS) {
    const e = facts?.[k];
    if (e && checkValue(k, e.value) != null && score?.renter?.[k]?.value !== e.value) f[k] = { ...e, at: e.at || new Date().toISOString().slice(0, 10) };
  }
  if (!Object.keys(f).length) return score;
  const s = clone(score), V = { ...L, amenities: { ...(L.amenities || {}) } };
  s.flags = s.flags || []; s.gates = s.gates || []; s.tags = s.tags || []; s.parts = s.parts || {}; s.part_ranges = s.part_ranges || {};
  if (f.size) {
    V.sqft = f.size.value;
    for (const k of ['size', 'sqft_basis', 'sqft_estimate', 'sqft_range']) delete V[k];
    s.flags = without(s.flags, ['size_imputed', 'size_estimated', 'size_proxy']);
  }
  if (f.wd) V.amenities.in_unit_wd = f.wd.value;
  if (f.floor) {
    V.floor = f.floor.value; V.floor_inferred = false;
    const v = lightWithFloor(s.light_hint, f.floor.value);
    if (v != null) { s.parts.light_view = r1(v); delete s.part_ranges.light_view; }
    s.flags = without(s.flags, ['floor_inferred']);
  }
  if (f.fees || f.price) applyMoney(s, f, V);
  const out = evaluate(V, s, crit, day).score;
  out.renter = { ...(score.renter || {}), ...Object.fromEntries(Object.entries(f).map(([k, e]) => [k, { value: e.value, at: e.at, source: SOURCE }])) };
  out.flags = [...new Set([...(out.flags || []), ...Object.keys(f).map((k) => `renter:${k}`)])].sort();
  for (const r of out.reasons || []) {
    const lines = Object.keys(f).filter((k) => DIM_OF[k] === r.dim).map((k) => SAY[k](f[k].value));
    if (lines.length) r.items = [...lines, ...(r.items || []).filter((x) => !/^you (entered|confirmed)/.test(x))];
  }
  return out;
}

// ------------------------------------------------------------------ scores and ranks under the live weights
/** rescore(): the overall score from dimension parts and weights; an unknown dimension counts 50. */
export function overallOf(parts, weights) {
  const tot = Object.values(weights).reduce((a, b) => a + b, 0) || 1;
  return Object.entries(weights).reduce((a, [k, w]) => a + w * (parts?.[k] ?? 50), 0) / tot;
}
/** The action rank a home would hold with this overall score among the others now (null when it would not be eligible). */
export function rankIf(listings, id, overall, eligible = true) {
  if (!eligible || overall == null) return null;
  let ahead = 0;
  for (const o of listings) if (o.id !== id && o.score?.eligible && (o._s ?? o.score?.overall ?? -1) > overall) ahead++;
  return ahead + 1;
}

// ------------------------------------------------------------------ the unknowns of one home
const costAt = (amount, crit) => scoreCost(amount, crit.budget || {});
/** The cost part at a monthly amount, minus nothing: the scorer's cost curve. */
function partAfter(kind, L, s, crit, value) {
  if (kind === 'wd') return amenitiesPart({ ...L, amenities: { ...(L.amenities || {}), in_unit_wd: value } }, crit);
  return null;
}

/**
 * Why a kind is an unknown for this home, from the score the scorer wrote: { state, now } or null when it is not.
 * state: estimated | unknown | disputed | unverified | inferred.
 */
export function detect(kind, L, s, crit) {
  const flags = new Set(s?.flags || []), gates = s?.gates || [], c = s?.cost || {};
  const reason = (dim) => (s?.reasons || []).find((r) => r.dim === dim);
  if (kind === 'size') {
    if (flags.has('size_imputed') || flags.has('size_estimated')) {
      const items = reason('space')?.items || [], from = (items.find((x) => /^no size stated: estimated from /.test(x)) || '').replace(/^no size stated: estimated from /, '');
      const mid = (items.find((x) => /ft² middle/.test(x)) || '').match(/([\d,]+) ft² middle/)?.[1];
      return { state: 'estimated', now: mid ? `Estimated at ~${mid} ft²${from ? ` from ${from}` : ''}` : 'Estimated from comparable homes' };
    }
    if (s?.parts?.space == null) return { state: 'unknown', now: 'No size listed and nothing comparable to estimate from; counted as neutral' };
    return null;
  }
  if (kind === 'price') {
    if (gates.includes('price_dispute') || flags.has('price_dispute')) {
      const sc = (c.scenarios || []).map((x) => `${String(x.label).replace(/\s*\d{4}-\d{2}-\d{2}.*$/, '').replace(/:.*$/, '')} ${usd(x.monthly)}`);
      return { state: 'disputed', now: `Two sources disagree${sc.length ? ` (${sc.join(' vs ')})`  : ''}; scoring the higher until a written quote` };
    }
    if (gates.includes('unverified:price') || flags.has('price_unverified')) return { state: 'unverified', now: 'The price comes from a weak source; ranked on the gross rent with a range' };
    return null;
  }
  if (kind === 'fees') {
    if (c.fees_known === false || gates.includes('unverified:fees')) {
      const est = c.fees_estimate;
      return { state: est ? 'estimated' : 'unknown', now: est ? `Fees unknown; counted at ~${usd(est.monthly)} a month from comparable homes` : 'Fees unknown; nothing comparable to estimate from, so they add nothing' };
    }
    return null;
  }
  if (kind === 'wd') {
    const wanted = [...(crit.must_have || []), ...(crit.strongly_prefer || []), ...(crit.nice_to_have || [])].includes('in_unit_wd');
    if (!wanted) return null;
    const v = amenityValue('in_unit_wd', L.amenities?.in_unit_wd).v;
    return v == null ? { state: 'unknown', now: 'Not stated; counted as half of what a confirmed one would earn' } : null;
  }
  if (kind === 'floor') {
    if (!s?.light_hint || L.site?.sun_hours) return null;
    if (flags.has('floor_inferred')) return { state: 'inferred', now: `Floor ${L.floor} is guessed from the unit number` };
    if (L.floor == null) return { state: 'unknown', now: 'Floor unknown' };
    return null;
  }
  return null;
}

/**
 * The part value a kind could take at either end, from what the scorer knows: { lo, hi } of the dimension's 0-100 score, or null.
 * Size and price use the ranges the scorer wrote; fees, washer/dryer and floor are evaluated at the plausible ends.
 */
export function partSpan(kind, L, s, crit) {
  const dim = KIND[kind].dim, now = s?.parts?.[dim], pr = s?.part_ranges?.[dim], c = s?.cost || {};
  if (kind === 'size') return pr ? { lo: pr[0], hi: pr[1] } : now == null ? { lo: 0, hi: 100 } : null;
  if (kind === 'price') {
    if (c.price_range && c.price_range[0] != null) return { lo: Math.min(costAt(c.price_range[0], crit), costAt(c.price_range[1], crit)), hi: Math.max(costAt(c.price_range[0], crit), costAt(c.price_range[1], crit)) };
    return pr ? { lo: pr[0], hi: pr[1] } : null;
  }
  if (kind === 'fees') {
    const est = c.fees_estimate, base = (c.monthly_expected ?? c.monthly) - (est?.monthly ?? 0), top = base + (est?.high ?? FEES_HIGH_FALLBACK);
    return { lo: Math.min(costAt(base, crit), costAt(top, crit)), hi: Math.max(costAt(base, crit), costAt(top, crit)) };
  }
  if (kind === 'wd') {
    const yes = partAfter('wd', L, s, crit, true).value, no = partAfter('wd', L, s, crit, false).value;
    return yes == null || no == null ? null : { lo: Math.min(yes, no), hi: Math.max(yes, no) };
  }
  if (kind === 'floor') {
    const f = L.floor, a = lightWithFloor(s.light_hint, Math.max(1, (f ?? 20) - FLOOR_SPREAD)), b = lightWithFloor(s.light_hint, (f ?? 20) + (f == null ? 20 : FLOOR_SPREAD));
    return a == null || b == null ? null : { lo: Math.min(a, b), hi: Math.max(a, b) };
  }
  return null;
}

/**
 * The unknowns that move this home's score, with the span each one covers under the live weights.
 * ctx: { weights, listings (with _s and score), facts ({kind: {value, at}}), labels }
 * Each row: { kind, state, ask, now, dim, entered (the renter's fact, if any), lo, hi (overall score), rankBest, rankWorst (action ranks) }.
 * A row the renter already answered stays, with `entered` set, so it can be changed or cleared.
 */
export function unknownsOf(L, s, crit, ctx) {
  const out = [], { weights, listings, facts = {} } = ctx;
  const parts = s?.parts || {}, tot = Object.values(weights).reduce((a, b) => a + b, 0) || 1, cur = overallOf(parts, weights);
  for (const kind of KINDS) {
    const entered = facts[kind] || s?.renter?.[kind] || null;
    const d = entered ? null : detect(kind, L, s, crit);
    if (!d && !entered) continue;
    const row = { kind, ask: KIND[kind].ask, dim: KIND[kind].dim, label: KIND[kind].label, entered, baked: !!(entered && !facts[kind]), state: d?.state || 'entered', now: d?.now || '' };
    if (d) {
      const span = partSpan(kind, L, s, crit);
      if (!span) continue;
      const w = weights[row.dim] || 0, at = (v) => cur + (w * (v - (parts[row.dim] ?? 50))) / tot;
      row.lo = r1(Math.min(at(span.lo), cur)); row.hi = r1(Math.max(at(span.hi), cur));
      if (row.hi - row.lo < 0.05) continue;   // it would not move the score
      row.dropsOut = kind === 'wd' && (crit.must_have || []).includes('in_unit_wd');   // "no" fails a must-have: it leaves the ranking
      row.rankBest = rankIf(listings, L.id, row.hi, s.eligible);
      row.rankWorst = row.dropsOut ? null : rankIf(listings, L.id, row.lo, s.eligible);
    }
    out.push(row);
  }
  return out;
}

/**
 * What typing `value` for `kind` would do: the score, the overall under the live weights, the rank it would hold, the rank now.
 * Pure: nothing is stored. ctx: { weights, listings, facts, today (ISO date), day (scoreDay()) }
 */
export function preview(L, base, crit, kind, value, ctx) {
  const v = checkValue(kind, value);
  if (v == null) return null;
  const facts = { ...(ctx.facts || {}), [kind]: { value: v, at: ctx.today, source: SOURCE } };
  const score = applyFacts(L, base, crit, facts, ctx.day);
  const overall = overallOf(score.parts, ctx.weights), nowOverall = overallOf(base.parts, ctx.weights);
  return { score, overall: r1(overall), nowOverall: r1(nowOverall), rank: rankIf(ctx.listings, L.id, overall, score.eligible), nowRank: rankIf(ctx.listings, L.id, nowOverall, base.eligible), eligible: score.eligible };
}
