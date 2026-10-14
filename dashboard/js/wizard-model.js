// New-search wizard, pure logic (no DOM, no app state) so node:test can exercise it: the draft, its defaults and
// validation, the taste-to-weights mapping, the criteria.yaml writer and the diff against the current search.
// It writes the same file format as `apartmentscout init --interactive` (apartmentscout/intake.py) and follows the same
// questions as config/intake.yaml; tests/test_intake.py checks the two stay in step. The Python loader
// (config.load_criteria) stays the source of truth for what a file means.
import { parseDay, diffProfile, AMENITY_NAMES, BASES, COMMUTE_MODES } from './criteria.js';

export { BASES, COMMUTE_MODES };

// ------------------------------------------------------------------ the steps (ids and fields follow config/intake.yaml)
export const STEPS = [
  { id: 'basics', title: 'Basics', blurb: 'Name the search, pick the city and the move-in window.', fields: ['name', 'city', 'timezone', 'move_in_earliest', 'move_in_latest', 'move_in_hard', 'map_center'] },
  { id: 'places', title: 'Places', blurb: 'Every place you travel to regularly, with arrive-by time, limit and weight.', fields: ['destinations'] },
  { id: 'money', title: 'Money', blurb: 'What you can pay, judged on monthly cost.', fields: ['budget_basis', 'budget_tiers', 'hard_max'] },
  { id: 'home', title: 'Home', blurb: 'Bedrooms and the sizes that would feel small, good and great.', fields: ['min_beds', 'sqft_floor', 'sqft_good', 'sqft_great'] },
  { id: 'amenities', title: 'Amenities', blurb: 'Deal-breakers, strong preferences and nice-to-haves.', fields: ['must_have', 'strongly_prefer', 'nice_to_have'] },
  { id: 'taste', title: 'Building and interior', blurb: 'How much finish, view, light and quiet matter, and any buildings you already rate.', fields: ['luxury', 'renovated', 'appliances', 'view', 'light', 'quiet', 'building_ratings'] },
  { id: 'weights', title: 'Weights', blurb: 'What matters most when units are ranked. Only the ratios count.', fields: ['preset', 'weights'] },
];
export const REVIEW = { id: 'review', title: 'Review', blurb: 'Check the file, then save it or take it to the command line.' };

export const AMENITIES = Object.entries(AMENITY_NAMES).map(([key, label]) => ({ key, label }));
export const TASTE_LEVELS = ['Not important', 'Somewhat', 'Very', 'Essential'];
/** Each answered item sets the weight of its dimension; items on one dimension add up (config/intake.yaml, step taste). */
export const TASTE = [
  { id: 'luxury', label: 'A polished, luxury-level building', hint: 'Lobby, service, finishes', dimension: 'building', weights: [2, 5, 10, 16] },
  { id: 'renovated', label: 'A renovated, modern interior', hint: 'Kitchen and bath finish, flooring, fixtures', dimension: 'interior', weights: [0, 3, 6, 10] },
  { id: 'appliances', label: 'New appliances', hint: 'Dishwasher, range, laundry', dimension: 'interior', weights: [0, 2, 4, 6] },
  { id: 'view', label: 'A good view', hint: 'What the windows look onto', dimension: 'light_view', weights: [0, 2, 5, 8] },
  { id: 'light', label: 'Natural light', hint: 'Direct sun hours and sky view, modelled per unit', dimension: 'light_view', weights: [0, 3, 6, 10] },
  { id: 'quiet', label: 'A quiet home', hint: '311 noise, street and construction exposure', dimension: 'quiet', weights: [0, 3, 6, 10] },
];

// Fallbacks when no search is loaded to read them from. A loaded search's `scoring.dimensions` and `scoring.presets`
// win; tests/test_intake.py checks these stay consistent with apartmentscout/config.py.
export const FALLBACK_DIMS = [['cost', 'Cost'], ['space', 'Space'], ['commute', 'Commute'], ['amenities', 'Amenities'], ['light_view', 'Light & view'],
  ['building', 'Building'], ['quiet', 'Quiet'], ['move_date', 'Move date'], ['renewal_risk', 'Renewal risk'], ['transit_access', 'Transit access']];
export const FALLBACK_PRESETS = {
  balanced: { label: 'Balanced', description: 'Every dimension counts; space and cost lead.', weights: { cost: 20, space: 25, commute: 15, amenities: 15, light_view: 10, building: 10, quiet: 5, move_date: 0, renewal_risk: 0, transit_access: 0 } },
  'biggest-and-nicest': { label: 'Biggest and nicest', description: 'Space first, then light, finishes and service; cost only through the budget gate.', weights: { cost: 3, space: 35, commute: 7, amenities: 20, light_view: 20, building: 10, quiet: 5, move_date: 0, renewal_risk: 0, transit_access: 0 } },
  'cheapest-good-enough': { label: 'Cheapest good enough', description: 'Lowest first-lease cost among homes that clear the must-haves; renewal shock counts.', weights: { cost: 40, space: 15, commute: 15, amenities: 10, light_view: 5, building: 5, quiet: 0, move_date: 5, renewal_risk: 5, transit_access: 0 } },
  'shortest-commute': { label: 'Shortest commute', description: 'Door-to-door time and nearby lines first.', weights: { cost: 15, space: 15, commute: 40, amenities: 10, light_view: 5, building: 5, quiet: 0, move_date: 0, renewal_risk: 0, transit_access: 10 } },
};
export const WEIGHT_MAX = 40;

/** Profiles in config/cities. The dashboard cannot read that folder; when it is served by `apartmentscout serve` the
 *  session API sends the real list, otherwise this copy is used (checked against config/cities/nyc.yaml in the tests). */
export const CITIES = [
  { id: 'nyc', name: 'New York City', timezone: 'America/New_York', center: [40.7549, -73.984], zoom: 12.8,
    note: 'Switches on NYC Open Data: building records, footprints, 311 noise layer, subway entrances.',
    feeds: [{ name: 'NYC Subway', url: 'https://rrgtfsfeeds.s3.amazonaws.com/gtfs_subway.zip', mode: 'subway' },
      { name: 'NYC Bus Manhattan', url: 'https://rrgtfsfeeds.s3.amazonaws.com/gtfs_m.zip', mode: 'bus' },
      { name: 'MTA Bus Company', url: 'https://rrgtfsfeeds.s3.amazonaws.com/gtfs_busco.zip', mode: 'bus', exclude_routes: ['^(BxM|BM|QM|SIM|X)[0-9]'] }] },
  { id: 'generic', name: 'Another city', timezone: '', center: null, zoom: 12.5, note: 'Runs on the generic modules. Add your transit agency\'s GTFS feeds to criteria.yaml afterwards.', feeds: [] },
];
/** Quick starts for "Another city": fills the map centre and time zone. Nothing else is stored. */
export const PLACES = [
  ['Boston', 42.3601, -71.0589, 'America/New_York'], ['Washington, DC', 38.9072, -77.0369, 'America/New_York'], ['Philadelphia', 39.9526, -75.1652, 'America/New_York'],
  ['Chicago', 41.8781, -87.6298, 'America/Chicago'], ['Austin', 30.2672, -97.7431, 'America/Chicago'], ['Denver', 39.7392, -104.9903, 'America/Denver'],
  ['San Francisco', 37.7749, -122.4194, 'America/Los_Angeles'], ['Los Angeles', 34.0522, -118.2437, 'America/Los_Angeles'], ['Seattle', 47.6062, -122.3321, 'America/Los_Angeles'],
  ['Toronto', 43.6532, -79.3832, 'America/Toronto'], ['London', 51.5072, -0.1276, 'Europe/London'],
];
export const TIMEZONES = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix', 'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu',
  'America/Toronto', 'America/Vancouver', 'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Asia/Tokyo', 'Asia/Singapore', 'Australia/Sydney'];
export const SIZE_PRESETS = [[0, 'Studio', 300, 450, 600], [1, 'One bed', 450, 700, 1000], [2, 'Two bed', 650, 950, 1300], [3, 'Three bed', 900, 1200, 1600]];
const TOP_LEVEL = new Set(['search', 'budget', 'unit', 'must_have', 'strongly_prefer', 'nice_to_have', 'commute', 'scoring', 'weights', 'building_ratings', 'favorites_first']);

const clone = (o) => JSON.parse(JSON.stringify(o ?? null));
const num = (v) => (v === '' || v == null ? null : Number.isFinite(+v) ? +v : NaN);
const r25 = (v) => Math.round(v / 25) * 25;

// ------------------------------------------------------------------ dates
export function todayISO(d = new Date()) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
export function addDays(iso, n) { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
export const slugify = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '') || 'search';

// ------------------------------------------------------------------ context: dimensions and presets from the loaded search
/** `{ dims: [[key, label]...], presets: {name: {label, weights...}}, cities }` from a loaded criteria.json, else fallbacks. */
export function contextOf(crit = {}, cities = null) {
  const dims = crit.scoring?.dimensions?.length ? crit.scoring.dimensions.map(([k, t]) => [k, t]) : FALLBACK_DIMS;
  const presets = crit.scoring?.presets && Object.keys(crit.scoring.presets).length ? crit.scoring.presets : FALLBACK_PRESETS;
  return { dims, presets, cities: cities?.length ? cities : CITIES };
}
const dimKeys = (ctx) => ctx.dims.map((d) => d[0]);
export const presetWeights = (ctx, name) => { const p = ctx.presets[name] || ctx.presets.balanced || Object.values(ctx.presets)[0]; return Object.fromEntries(dimKeys(ctx).map((k) => [k, +(p.weights?.[k] ?? 0)])); };

// ------------------------------------------------------------------ the draft
const blankDest = (n = 1) => ({ name: n === 1 ? 'Work' : `Place ${n}`, address: '', lat: null, lon: null, arrive_by: '09:00', max_minutes: 30, weight: 1, mode: 'best' });
export { blankDest };

/** A starting draft for a new search. The values are the defaults in config/intake.yaml. */
export function blankDraft(ctx = contextOf(), { city = 'generic', today = todayISO() } = {}) {
  const c = ctx.cities.find((x) => x.id === city) || ctx.cities.find((x) => x.id === 'generic') || CITIES[1];
  const preset = 'balanced';
  return {
    name: '', city: c.id, timezone: c.timezone || '', map_center: c.center ? [...c.center] : null, map_zoom: c.zoom || 12.5,
    move_in: { earliest: addDays(today, 14), latest: addDays(today, 60), hard: false },
    destinations: [blankDest(1)],
    budget: { basis: 'monthly_cost', tiers: [{ name: 'Target', max: 3000 }, { name: 'Stretch', max: 3300 }], hard_max: 3500 },
    unit: { min_beds: 1, sqft_floor: 450, sqft_good: 700, sqft_great: 1000 },
    must_have: ['in_unit_wd'], strongly_prefer: ['dishwasher', 'elevator'], nice_to_have: ['gym', 'roof_deck', 'outdoor_space'],
    taste: Object.fromEntries(TASTE.map((t) => [t.id, null])),
    building_ratings: [],
    preset, weights: presetWeights(ctx, preset),
    folder: '', extras: {},
  };
}

/** A draft from a loaded criteria.json, to edit the search that is open. Everything the wizard does not ask about
 *  (transit feeds, tiles, landmarks, custom presets ...) rides along in `extras` so saving does not drop it. */
export function draftFromCriteria(crit = {}, ctx = contextOf(crit)) {
  const s = crit.search || {}, b = crit.budget || {}, u = crit.unit || {}, mi = s.move_in || {}, sc = crit.scoring || {};
  const base = blankDraft(ctx, { city: s.city || 'generic' });
  const known = ['name', 'city', 'timezone', 'move_in', 'map_center', 'map_zoom'];
  const preset = sc.preset && ctx.presets[sc.preset] ? sc.preset : 'balanced';
  const custom = Object.fromEntries(Object.entries(sc.presets || {}).filter(([k]) => !FALLBACK_PRESETS[k]));
  const weights = presetWeights(ctx, preset);
  for (const k of dimKeys(ctx)) if (crit.weights?.[k] != null) weights[k] = +crit.weights[k];
  const scoringExtras = {};
  if (sc.stale_days != null) scoringExtras.stale_days = sc.stale_days;
  if (sc.as_of) scoringExtras.as_of = sc.as_of;
  if (Object.keys(custom).length) scoringExtras.presets = custom;
  return {
    ...base,
    name: s.name || '', city: s.city || 'generic', timezone: s.timezone || '', map_center: s.map_center ? [...s.map_center] : null, map_zoom: s.map_zoom ?? 12.5,
    move_in: { earliest: mi.earliest || '', latest: mi.latest || '', hard: !!mi.hard },
    destinations: (crit.commute?.destinations || []).map((d) => {
      const { name, address, lat, lon, arrive_by, max_minutes, weight, mode, _stale, ...rest } = d;
      return { name: name || '', address: address || '', lat: lat ?? null, lon: lon ?? null, arrive_by: arrive_by || '', max_minutes: max_minutes ?? 30, weight: weight ?? 1, mode: mode || 'best', ...(Object.keys(rest).length ? { extra: rest } : {}) };
    }),
    budget: { basis: b.basis || 'monthly_cost', tiers: (b.tiers || []).map((t) => ({ name: t.name, max: t.max })), hard_max: b.hard_max ?? null },
    unit: { min_beds: u.min_beds ?? 0, sqft_floor: u.sqft_floor ?? 450, sqft_good: u.sqft_good ?? 750, sqft_great: u.sqft_great ?? 1050 },
    must_have: [...(crit.must_have || [])], strongly_prefer: [...(crit.strongly_prefer || [])], nice_to_have: [...(crit.nice_to_have || [])],
    building_ratings: Object.entries(crit.building_ratings || {}).map(([name, rating]) => ({ name, rating })),
    preset, weights, folder: '',
    extras: clone({
      search: Object.fromEntries(Object.entries(s).filter(([k]) => !known.includes(k))),
      commute: Object.fromEntries(Object.entries(crit.commute || {}).filter(([k]) => k !== 'destinations')),
      scoring: scoringExtras,
      top: Object.fromEntries(Object.entries(crit).filter(([k]) => !TOP_LEVEL.has(k))),
      favorites_first: crit.favorites_first,
    }),
  };
}

// ------------------------------------------------------------------ taste -> weights
/** Weight per dimension from the importance levels (0-3). Unanswered items change nothing. Dimensions the loaded scorer
 *  does not have (interior, before it ships) fold into `building`. */
export function tasteWeights(taste = {}, ctx = contextOf()) {
  const have = new Set(dimKeys(ctx)), out = {};
  for (const t of TASTE) {
    const lv = taste[t.id];
    if (lv == null || lv === '') continue;
    const d = have.has(t.dimension) ? t.dimension : 'building';
    out[d] = (out[d] || 0) + t.weights[Math.max(0, Math.min(3, +lv))];
  }
  return out;
}
/** The dimension a taste item feeds in this scorer (interior folds into building when the scorer has no such dimension). */
export function tasteDim(id, ctx = contextOf()) {
  const t = TASTE.find((x) => x.id === id);
  return t && dimKeys(ctx).includes(t.dimension) ? t.dimension : 'building';
}
/** A copy of the draft with the taste answers laid over its weights. `cleared` names dimensions whose answers were just
 *  removed: with no answer left on them they go back to the preset's weight. */
export function applyTaste(draft, ctx = contextOf(), cleared = []) {
  const d = clone(draft), tw = tasteWeights(d.taste, ctx), base = presetWeights(ctx, d.preset);
  Object.assign(d.weights, tw);
  for (const k of cleared) if (!(k in tw)) d.weights[k] = base[k];
  return d;
}
/** A copy with a preset's weights, then the taste answers on top. */
export function selectPreset(draft, name, ctx = contextOf()) {
  const d = clone(draft);
  d.preset = name; d.weights = presetWeights(ctx, name);
  return applyTaste(d, ctx);
}
/** Each dimension's share of the total, in percent (sums to 100 unless every weight is 0). */
export function weightShares(weights = {}, ctx = contextOf()) {
  const keys = dimKeys(ctx), tot = keys.reduce((a, k) => a + (+weights[k] || 0), 0);
  return Object.fromEntries(keys.map((k) => [k, tot ? Math.round(((+weights[k] || 0) / tot) * 100) : 0]));
}
/** Weights that differ from the chosen preset, which is what goes under `weights:` in the file. */
export function weightOverrides(draft, ctx = contextOf()) {
  const base = presetWeights(ctx, draft.preset), out = {};
  for (const k of dimKeys(ctx)) if ((+draft.weights[k] || 0) !== base[k]) out[k] = +draft.weights[k] || 0;
  return out;
}
export const tiersFromTarget = (target) => {
  const t = r25(+target);
  return { tiers: [{ name: 'Target', max: t }, { name: 'Stretch', max: r25(t * 1.1) }], hard_max: r25(t * 1.17) };
};

// ------------------------------------------------------------------ draft -> criteria
const fix = (v) => (v == null || v === '' || Number.isNaN(+v) ? null : +(+v).toFixed(6));
/** The criteria mapping the draft describes (what criteria.yaml holds; weights are only the overrides of the preset). */
export function draftToCriteria(d, ctx = contextOf()) {
  const x = d.extras || {};
  const search = { name: String(d.name || '').trim(), city: d.city || 'generic' };
  if (d.timezone) search.timezone = d.timezone;
  const mi = {};
  if (d.move_in.earliest) mi.earliest = d.move_in.earliest;
  if (d.move_in.latest) mi.latest = d.move_in.latest;
  if (d.move_in.hard) mi.hard = true;
  if (Object.keys(mi).length) search.move_in = mi;
  if (d.map_center) search.map_center = [fix(d.map_center[0]), fix(d.map_center[1])];
  if (d.map_center && d.map_zoom) search.map_zoom = +d.map_zoom;
  Object.assign(search, x.search || {});
  const budget = { basis: d.budget.basis, tiers: d.budget.tiers.map((t) => ({ name: String(t.name).trim(), max: +t.max })) };
  if (d.budget.hard_max != null && d.budget.hard_max !== '') budget.hard_max = +d.budget.hard_max;
  const dests = d.destinations.map((p) => {
    const o = { name: String(p.name).trim() };
    if (String(p.address || '').trim()) o.address = String(p.address).trim();
    if (fix(p.lat) != null && fix(p.lon) != null) { o.lat = fix(p.lat); o.lon = fix(p.lon); }
    if (p.arrive_by) o.arrive_by = p.arrive_by;
    o.max_minutes = +p.max_minutes; o.weight = +p.weight;
    if (p.mode && p.mode !== 'best') o.mode = p.mode;
    return Object.assign(o, p.extra || {});
  });
  const commute = { destinations: dests, ...(x.commute || {}) };
  if (!commute.transit && d.city) {
    const feeds = ctx.cities.find((c) => c.id === d.city)?.feeds;
    if (feeds?.length) commute.transit = { feeds: clone(feeds) };
  }
  const out = { search, budget, unit: Object.fromEntries(Object.entries(d.unit).map(([k, v]) => [k, +v])),
    must_have: [...d.must_have], strongly_prefer: [...d.strongly_prefer], nice_to_have: [...d.nice_to_have], commute };
  const scoring = { preset: d.preset, ...(x.scoring || {}) };
  if (d.preset) out.scoring = scoring; else if (Object.keys(x.scoring || {}).length) out.scoring = x.scoring;
  const over = weightOverrides(d, ctx);
  const w = d.preset ? over : Object.fromEntries(dimKeys(ctx).map((k) => [k, +d.weights[k] || 0]));
  if (Object.keys(w).length) out.weights = w;
  const br = (d.building_ratings || []).filter((r) => String(r.name || '').trim());
  if (br.length) out.building_ratings = Object.fromEntries(br.map((r) => [String(r.name).trim(), +r.rating]));
  out.favorites_first = x.favorites_first ?? true;
  Object.assign(out, x.top || {});
  return out;
}

// ------------------------------------------------------------------ criteria -> YAML text (same layout as apartmentscout.intake.render_criteria)
const PLAIN = /^[A-Za-z_][A-Za-z0-9_./+-]*$/;
const RESERVED = new Set(['true', 'false', 'null', 'yes', 'no', 'on', 'off', 'y', 'n', '~']);
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v);
const isScalar = (v) => v === null || ['string', 'number', 'boolean'].includes(typeof v);
const flowable = (v) => isScalar(v) || (Array.isArray(v) && v.every(flowable));
const scalar = (v) => (v === null ? 'null' : typeof v === 'string' ? ((PLAIN.test(v) && !RESERVED.has(v.toLowerCase())) || isDate(v) ? v : JSON.stringify(v)) : String(v));
const key = (k) => (PLAIN.test(k) && !RESERVED.has(k.toLowerCase()) ? k : JSON.stringify(k));
const flow = (v) => (Array.isArray(v) ? `[${v.map(flow).join(', ')}]` : scalar(v));
const flowMap = (o) => `{${Object.entries(o).map(([k, v]) => `${key(k)}: ${flow(v)}`).join(', ')}}`;
const plainMap = (v) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length > 0 && Object.values(v).every(flowable);
const quoted = (s) => JSON.stringify(String(s));
/** Block-style YAML for a plain JSON value (objects, arrays, scalars). */
export function dumpYAML(obj, ind = 0) {
  const pad = ' '.repeat(ind), out = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    if (isScalar(v)) out.push(`${pad}${key(k)}: ${scalar(v)}`);
    else if (Array.isArray(v)) {
      if (!v.length) out.push(`${pad}${key(k)}: []`);
      else if (flowable(v)) out.push(`${pad}${key(k)}: ${flow(v)}`);
      else {
        out.push(`${pad}${key(k)}:`);
        for (const item of v) {
          if (flowable(item)) out.push(`${pad}  - ${flow(item)}`);
          else if (plainMap(item)) out.push(`${pad}  - ${flowMap(item)}`);
          else { const sub = dumpYAML(item, ind + 4); sub[0] = `${pad}  - ${sub[0].slice(ind + 4)}`; out.push(...sub); }
        }
      }
    } else if (!Object.keys(v).length) out.push(`${pad}${key(k)}: {}`);
    else { out.push(`${pad}${key(k)}:`); out.push(...dumpYAML(v, ind + 2)); }
  }
  return out;
}
/** criteria.yaml text for a criteria mapping from draftToCriteria. */
export function criteriaToYAML(c, note = 'Written by the dashboard\'s New search wizard') {
  const s = c.search, L = [`# ApartmentScout criteria${s.name ? ' for ' + s.name : ''}.`, `# ${note.replace(/\.$/, '')}. Edit freely, then check it: apartmentscout criteria --check criteria.yaml`, ''];
  const sec = (lines) => { L.push(...lines, ''); };
  const { name, city, timezone, move_in, map_center, map_zoom, ...restSearch } = s;
  const sl = ['search:', `  name: ${quoted(name)}`, `  city: ${scalar(city)}`];
  if (timezone) sl.push(`  timezone: ${scalar(timezone)}`);
  if (move_in) sl.push('  move_in:', ...Object.entries(move_in).map(([k, v]) => `    ${k}: ${scalar(v)}`));
  if (map_center) sl.push(`  map_center: [${map_center.join(', ')}]`);
  if (map_zoom) sl.push(`  map_zoom: ${map_zoom}`);
  sl.push(...dumpYAML(restSearch, 2));
  sec(sl);
  const b = c.budget, bl = ['budget:', `  basis: ${b.basis}`, '  tiers:', ...b.tiers.map((t) => `    - {name: ${quoted(t.name)}, max: ${t.max}}`)];
  if (b.hard_max != null) bl.push(`  hard_max: ${b.hard_max}`);
  sec(bl);
  sec(['unit:', ...Object.entries(c.unit).map(([k, v]) => `  ${k}: ${v}`)]);
  L.push(`must_have: ${flow(c.must_have)}`, `strongly_prefer: ${flow(c.strongly_prefer)}`, `nice_to_have: ${flow(c.nice_to_have)}`, '');
  const { destinations, ...restCommute } = c.commute;
  const cl = ['commute:'];
  if (!destinations.length) cl.push('  destinations: []');
  else {
    cl.push('  destinations:');
    for (const p of destinations) {
      const { name: n, address, lat, lon, arrive_by, max_minutes, weight, mode, ...rest } = p;
      cl.push(`    - name: ${quoted(n)}`);
      if (address) cl.push(`      address: ${quoted(address)}`);
      if (lat != null) cl.push(`      lat: ${lat}`, `      lon: ${lon}`);
      if (arrive_by) cl.push(`      arrive_by: ${quoted(arrive_by)}`);
      cl.push(`      max_minutes: ${max_minutes}`, `      weight: ${weight}`);
      if (mode) cl.push(`      mode: ${mode}`);
      cl.push(...dumpYAML(rest, 6));
    }
  }
  cl.push(...dumpYAML(restCommute, 2));
  sec(cl);
  if (c.scoring) sec(['scoring:', ...dumpYAML(c.scoring, 2)]);
  if (c.weights) sec(['weights:', ...Object.entries(c.weights).map(([k, v]) => `  ${key(k)}: ${v}`)]);
  if (c.building_ratings) sec(['building_ratings:', ...Object.entries(c.building_ratings).map(([k, v]) => `  ${quoted(k)}: ${v}`)]);
  const known = new Set(['search', 'budget', 'unit', 'must_have', 'strongly_prefer', 'nice_to_have', 'commute', 'scoring', 'weights', 'building_ratings', 'favorites_first']);
  L.push(`favorites_first: ${c.favorites_first}`);
  const rest = Object.fromEntries(Object.entries(c).filter(([k]) => !known.has(k)));
  if (Object.keys(rest).length) L.push('', ...dumpYAML(rest));
  return L.join('\n') + '\n';
}
export const toCriteriaYAML = (draft, ctx = contextOf(), note) => criteriaToYAML(draftToCriteria(draft, ctx), note);

// ------------------------------------------------------------------ validation
/** Problems as `{ step, field, msg }`. Field names are what the wizard marks inline; the rules mirror
 *  apartmentscout/criteria_check.py (which the server runs again before it writes anything). */
export function validateDraft(d, ctx = contextOf(), { needFolder = false, existing = [] } = {}) {
  const e = [], add = (step, field, msg) => e.push({ step, field, msg });
  if (!String(d.name || '').trim()) add('basics', 'name', 'Give the search a name.');
  else if (String(d.name).trim().length > 80) add('basics', 'name', 'Keep the name under 80 characters.');
  if (!ctx.cities.some((c) => c.id === d.city)) add('basics', 'city', 'Pick a city.');
  if (d.timezone && !/^[A-Za-z]+(\/[A-Za-z0-9_+-]+)+$/.test(d.timezone) && d.timezone !== 'UTC') add('basics', 'timezone', 'Use an IANA zone such as America/Chicago.');
  const { earliest, latest } = d.move_in;
  if (earliest && parseDay(earliest) == null) add('basics', 'move_in.earliest', 'Use a date like 2026-12-01.');
  if (latest && parseDay(latest) == null) add('basics', 'move_in.latest', 'Use a date like 2027-01-15.');
  if (earliest && latest && parseDay(earliest) != null && parseDay(latest) != null && parseDay(latest) < parseDay(earliest)) add('basics', 'move_in.latest', 'The latest date is before the earliest.');
  if (d.map_center) {
    const [la, lo] = d.map_center.map(num);
    if (Number.isNaN(la) || Number.isNaN(lo) || la == null || lo == null || Math.abs(la) > 90 || Math.abs(lo) > 180) add('basics', 'map_center', 'Latitude is within 90 and longitude within 180.');
  }
  const names = d.destinations.map((p) => String(p.name || '').trim());
  d.destinations.forEach((p, i) => {
    const f = (k) => `dest.${i}.${k}`, label = names[i] || `Place ${i + 1}`;
    if (!names[i]) add('places', f('name'), 'Give this place a name.');
    else if (names.indexOf(names[i]) !== i) add('places', f('name'), 'Another place has this name.');
    const la = num(p.lat), lo = num(p.lon), has = la != null && lo != null;
    if ((la == null) !== (lo == null)) add('places', f('lat'), 'Give both latitude and longitude, or neither.');
    else if (has && (Number.isNaN(la) || Number.isNaN(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180)) add('places', f('lat'), 'Latitude is within 90 and longitude within 180.');
    if (!has && !String(p.address || '').trim()) add('places', f('address'), `${label}: type an address or place it on the map.`);
    if (p.arrive_by && !/^([01]?\d|2[0-3]):[0-5]\d$/.test(p.arrive_by)) add('places', f('arrive_by'), 'Use a 24-hour time like 09:00.');
    if (!(num(p.max_minutes) > 0)) add('places', f('max_minutes'), 'The limit must be more than 0 minutes.');
    else if (+p.max_minutes > 180) add('places', f('max_minutes'), 'Three hours is the longest limit.');
    if (!(num(p.weight) >= 0)) add('places', f('weight'), 'Weight cannot be negative.');
  });
  if (d.destinations.length > 4) add('places', 'destinations', 'Four places is the most the dashboard shows.');
  const b = d.budget, tiers = b.tiers;
  if (!tiers.length) add('money', 'tiers', 'Add at least one budget tier.');
  tiers.forEach((t, i) => {
    if (!String(t.name || '').trim()) add('money', `tier.${i}.name`, 'Name this tier.');
    else if (tiers.findIndex((x) => String(x.name).trim() === String(t.name).trim()) !== i) add('money', `tier.${i}.name`, 'Tier names must differ.');
    if (!(num(t.max) > 0)) add('money', `tier.${i}.max`, 'Enter an amount above $0.');
    else if (i && num(tiers[i - 1].max) > 0 && +t.max <= +tiers[i - 1].max) add('money', `tier.${i}.max`, `Must be above ${tiers[i - 1].name || 'the tier before'}.`);
  });
  const hm = num(b.hard_max);
  if (b.hard_max !== '' && b.hard_max != null) {
    if (!(hm > 0)) add('money', 'hard_max', 'Enter an amount above $0, or leave it empty.');
    else if (tiers.length && num(tiers[tiers.length - 1].max) > 0 && hm < +tiers[tiers.length - 1].max) add('money', 'hard_max', 'The cap is below your last tier.');
  }
  const u = d.unit;
  if (!(num(u.min_beds) >= 0) || num(u.min_beds) > 10) add('home', 'min_beds', 'Use 0 for a studio, or up to 10 bedrooms.');
  for (const k of ['sqft_floor', 'sqft_good', 'sqft_great']) if (!(num(u[k]) > 0)) add('home', k, 'Enter a size in square feet.');
  if (num(u.sqft_floor) > 0 && num(u.sqft_good) > 0 && num(u.sqft_great) > 0) {
    if (!(+u.sqft_floor < +u.sqft_good)) add('home', 'sqft_good', 'Good must be larger than the floor.');
    if (!(+u.sqft_good < +u.sqft_great)) add('home', 'sqft_great', 'Great must be larger than good.');
  }
  const seen = new Map();
  for (const g of ['must_have', 'strongly_prefer', 'nice_to_have']) for (const k of d[g]) { if (seen.has(k)) add('amenities', k, `${AMENITY_NAMES[k] || k} is in two groups.`); seen.set(k, g); }
  const rn = (d.building_ratings || []).map((r) => String(r.name || '').trim());
  (d.building_ratings || []).forEach((r, i) => {
    if (!rn[i] && r.rating) add('taste', `rating.${i}.name`, 'Name the building.');
    else if (rn[i] && rn.indexOf(rn[i]) !== i) add('taste', `rating.${i}.name`, 'This building is rated twice.');
    if (rn[i] && !(+r.rating >= 1 && +r.rating <= 5)) add('taste', `rating.${i}.rating`, 'Rate from 1 to 5.');
  });
  const w = dimKeys(ctx).reduce((a, k) => a + (+d.weights[k] || 0), 0);
  if (!(w > 0)) add('weights', 'weights', 'At least one weight must be above zero.');
  if (needFolder) {
    const f = d.folder || slugify(d.name);
    if (!/^[a-z0-9][a-z0-9-]{0,59}$/.test(f)) add('review', 'folder', 'Use lowercase letters, digits and hyphens, up to 60 characters.');
    else if (existing.includes(f)) add('review', 'folder', `A search folder called ${f} already exists.`);
  }
  return e;
}
export const errorsFor = (errors, step) => errors.filter((x) => x.step === step);
export const firstError = (errors, field) => errors.find((x) => x.field === field)?.msg || '';
/** Steps with problems, in order. */
export const badSteps = (errors) => [...new Set(errors.map((x) => x.step))];

// ------------------------------------------------------------------ summaries, diff, commands
const usd = (x) => '$' + Math.round(x).toLocaleString('en-US');
const joinNames = (keys) => keys.map((k) => AMENITY_NAMES[k] || k.replaceAll('_', ' ')).join(', ');
/** One line per step for the step list. */
export function stepSummary(id, d, ctx = contextOf()) {
  const filled = d.destinations.filter((p) => String(p.name).trim());
  switch (id) {
    case 'basics': return [d.name.trim() || 'Unnamed', ctx.cities.find((c) => c.id === d.city)?.name].filter(Boolean).join(' · ');
    case 'places': return filled.length ? filled.map((p) => p.name).join(', ') : 'No destinations';
    case 'money': return `${d.budget.tiers.map((t) => usd(+t.max || 0)).join(' / ')}${d.budget.hard_max ? ` · cap ${usd(+d.budget.hard_max)}` : ''}`;
    case 'home': return `${+d.unit.min_beds === 0 ? 'Studio' : d.unit.min_beds + '+ bd'} · ${d.unit.sqft_floor}-${d.unit.sqft_great} ft²`;
    case 'amenities': return `${d.must_have.length} must · ${d.strongly_prefer.length} strong · ${d.nice_to_have.length} nice`;
    case 'taste': { const n = TASTE.filter((t) => d.taste[t.id] != null).length; return n || d.building_ratings.length ? `${n} of ${TASTE.length} answered${d.building_ratings.length ? ` · ${d.building_ratings.length} rated` : ''}` : 'Not answered yet'; }
    case 'weights': { const sh = weightShares(d.weights, ctx), top = Object.entries(sh).sort((a, b) => b[1] - a[1]).slice(0, 2).filter((x) => x[1]); return top.map(([k, v]) => `${(ctx.dims.find((x) => x[0] === k) || [k, k])[1]} ${v}%`).join(' · ') || 'All zero'; }
    default: return '';
  }
}
/** The profile the dashboard's search settings and preview machinery use (criteria.js profileOf shape). */
export function draftToProfile(d) {
  return {
    budget: { basis: d.budget.basis, tiers: d.budget.tiers.map((t) => ({ name: t.name, max: t.max })), hard_max: d.budget.hard_max === '' ? null : d.budget.hard_max },
    must_have: [...d.must_have], strongly_prefer: [...d.strongly_prefer], nice_to_have: [...d.nice_to_have],
    move_in: { earliest: d.move_in.earliest || '', latest: d.move_in.latest || '', hard: !!d.move_in.hard },
    unit: { min_beds: +d.unit.min_beds, sqft_floor: +d.unit.sqft_floor, sqft_good: +d.unit.sqft_good, sqft_great: +d.unit.sqft_great },
    destinations: d.destinations.map((p) => ({ name: p.name, address: p.address || '', lat: fix(p.lat), lon: fix(p.lon), arrive_by: p.arrive_by || '', max_minutes: +p.max_minutes, weight: +p.weight, mode: p.mode || 'best' })),
  };
}
/** What differs between the open search and the draft, as readable lines. */
export function diffAgainst(crit0, d, ctx = contextOf(crit0)) {
  if (!crit0?.search) return [];
  const a = draftFromCriteria(crit0, ctx), out = [];
  if (a.name !== d.name.trim()) out.push(`Name: ${a.name || 'unnamed'} → ${d.name.trim() || 'unnamed'}`);
  if (a.city !== d.city) out.push(`City: ${a.city} → ${d.city}`);
  if ((a.timezone || '') !== (d.timezone || '')) out.push(`Time zone: ${a.timezone || 'none'} → ${d.timezone || 'none'}`);
  out.push(...diffProfile(draftToProfile(a), draftToProfile(d)));
  const sa = weightShares(a.weights, ctx), sb = weightShares(d.weights, ctx), lab = (k) => (ctx.dims.find((x) => x[0] === k) || [k, k])[1];
  const moved = dimKeys(ctx).filter((k) => sa[k] !== sb[k]);
  if (moved.length) out.push(`Weights: ${moved.map((k) => `${lab(k)} ${sa[k]}% → ${sb[k]}%`).join(', ')}`);
  const ra = JSON.stringify(Object.fromEntries(a.building_ratings.map((r) => [r.name, +r.rating]))), rb = JSON.stringify(Object.fromEntries(d.building_ratings.filter((r) => r.name.trim()).map((r) => [r.name.trim(), +r.rating])));
  if (ra !== rb) out.push(`Building ratings: ${d.building_ratings.filter((r) => r.name.trim()).map((r) => `${r.name.trim()} ${r.rating}`).join(', ') || 'none'}`);
  return out;
}
/** Commands to run after downloading criteria.yaml for a new search. */
export function cliCommands(d, { file = '~/Downloads/criteria.yaml', path } = {}) {
  const folder = d.folder || slugify(d.name), at = path || `searches/${folder}`, city = /^[a-z0-9_-]+$/.test(d.city || '') ? d.city : 'generic';
  const withCity = city === 'generic' ? '' : ` --city ${city}`;
  return {
    path: at,
    oneStep: [`apartmentscout init ${at}${withCity} --criteria ${file}`, `apartmentscout criteria --check ${at}/criteria.yaml`],
    twoStep: [`apartmentscout init ${at}${withCity}`, `cp ${file} ${at}/criteria.yaml`, `apartmentscout criteria --check ${at}/criteria.yaml`],
    then: [`apartmentscout import listings.csv --search ${at}   # or ask your agent to find listings`, `apartmentscout all --search ${at}`, `apartmentscout serve --search ${at}`],
    steps: [`apartmentscout geocode --search ${at}`, `apartmentscout commute --search ${at}`, `apartmentscout score --search ${at}`, `apartmentscout build --search ${at}`],
  };
}
/** Commands to apply a downloaded criteria.yaml to a search that already exists. */
export function editCommands(path, file = '~/Downloads/criteria.yaml') {
  return {
    oneStep: [`cp ${file} ${path}/criteria.yaml`, `apartmentscout criteria --check ${path}/criteria.yaml`, `apartmentscout commute --search ${path}   # only if a destination moved or is new`, `apartmentscout score --search ${path} && apartmentscout build --search ${path}`],
    twoStep: [`apartmentscout criteria --check ${file}`, `cp ${path}/criteria.yaml ${path}/criteria.backup.yaml`, `cp ${file} ${path}/criteria.yaml`],
    then: [`apartmentscout all --search ${path}`], steps: [`apartmentscout score --search ${path}`, `apartmentscout build --search ${path}`],
  };
}
export const rescoreCommands = (path = 'searches/<folder>') => [`apartmentscout score --search ${path}`, `apartmentscout build --search ${path}`];
