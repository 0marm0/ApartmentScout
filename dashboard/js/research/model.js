// Research view data: reads the optional pipeline files (coverage.json, history.json, watchlist.json) and, when a
// file is missing, derives a smaller honest version from listings.json so the view still works. Pure functions
// except for reading the shared state S; nothing here touches the DOM.
import { S, ACTIVE, cost, score, isSaved, byId, label } from '../app.js';
import { safeUrl, imagesOf } from '../util.js';
import { photoItems } from '../features/photos.js';

export const R = { cov: null, hist: null, watch: null, loaded: false };

// ------------------------------------------------------------------ loading
const EXTRA = ['coverage.json', 'history.json', 'watchlist.json'];
/** Load the extra files the manifest lists. Files it does not list are never requested (no 404 noise). */
export async function loadExtras(loadJSON) {
  const listed = (S.manifest.extra || []).map(String);
  const has = (n) => listed.some((x) => x === n || x.endsWith('/' + n));
  const emb = window.__AS_DATA__;
  const get = (n) => (has(n) || (emb && `${S.base}/${n}` in emb) ? loadJSON(`${S.base}/${n}`, null) : Promise.resolve(null));
  const [cov, hist, watch] = await Promise.all(EXTRA.map(get));
  R.cov = cov && typeof cov === 'object' ? cov : null;
  R.hist = hist && typeof hist === 'object' ? hist : null;
  R.watch = watch && typeof watch === 'object' ? watch : null;
  R.loaded = true;
  return R;
}

// ------------------------------------------------------------------ dates
const DAY = 864e5;
export function parseDate(s) {
  const m = typeof s === 'string' && s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null;
}
const todayUTC = () => { const t = new Date(); return Date.UTC(t.getFullYear(), t.getMonth(), t.getDate()); };
export function ageDays(s, ref = todayUTC()) { const d = parseDate(s); return d == null ? null : Math.round((ref - d) / DAY); }
export function ageText(s) {
  const n = ageDays(s);
  if (n == null) return 'never';
  if (n <= 0) return 'today';
  if (n === 1) return 'yesterday';
  if (n < 14) return `${n} days ago`;
  if (n < 60) return `${Math.round(n / 7)} weeks ago`;
  return `${Math.round(n / 30)} months ago`;
}
export function fmtDate(s, long = false) {
  const d = parseDate(s); if (d == null) return '—';
  return new Date(d).toLocaleDateString(undefined, long ? { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' } : { day: 'numeric', month: 'short', timeZone: 'UTC' });
}
export function median(a) { const s = a.filter((v) => v != null && !isNaN(v)).sort((x, y) => x - y); if (!s.length) return null; const m = s.length / 2; return s.length % 2 ? s[Math.floor(m)] : (s[m - 1] + s[m]) / 2; }
export function quantile(a, q) { const s = a.filter((v) => v != null && !isNaN(v)).sort((x, y) => x - y); if (!s.length) return null; const i = (s.length - 1) * q, lo = Math.floor(i); return s[lo] + (s[Math.min(s.length - 1, lo + 1)] - s[lo]) * (i - lo); }

// ------------------------------------------------------------------ coverage standard
/** The facts a finalist needs when coverage.json is absent: key, label, why, test, question. */
const FALLBACK_STD = [
  ['cost', 'Monthly cost', 'Ranking and the budget gate need it', (L) => cost(L) != null, 'What is the current gross rent, and is any concession offered on this unit?'],
  ['fees', 'Recurring fees', 'Fees change the true monthly cost', (L) => L.price?.fees_monthly != null, 'Besides rent, which recurring monthly charges apply (amenity, utilities, pets, storage), and which are mandatory?'],
  ['size', 'Size', 'Unknown size is never ranked as small', (L) => !!L.sqft, 'What is the square footage, and does it come from the floor plan or an estimate?'],
  ['floor', 'Floor', 'Light, view and street noise depend on it', (L) => L.floor != null && !L.floor_inferred, 'Which floor is the unit on?'],
  ['exposure', 'Exposure', 'Which way the windows face drives direct sun', (L) => !!L.exposure?.length, 'Which way do the main windows face, and what is directly across from them?'],
  ['in_unit_wd', 'In-unit W/D', 'Often a must-have', (L) => L.amenities?.in_unit_wd != null, 'Is there a washer and dryer inside the unit itself?'],
  ['elevator', 'Elevator', 'Often a must-have', (L) => L.amenities?.elevator != null, 'Does the building have an elevator?'],
  ['doorman', 'Doorman', 'Packages and security', (L) => L.amenities?.doorman != null, 'Is the lobby staffed, and during which hours?'],
  ['available', 'Move-in date', 'Must fit the move window', (L) => !!L.available, 'When is the unit available, and can the lease start on the date you need?'],
  ['media', 'Photos or plan', 'Condition, layout and light', (L) => hasMedia(L), 'Can you share a floor plan and current photos of this exact unit?'],
  ['records', 'Building records', 'Violations, complaints and noise nearby', (L) => !!L.records?.flags || (S.manifest.dossiers || []).includes(L.id), null],
  ['reviews', 'Resident reviews', 'Management and noise in practice', (L) => !!L.reviews?.summary, null],
];
/** Which score dimension each fact feeds, and how much of that dimension it decides (for the fallback impact). */
const FACT_DIMS = { cost: [['cost', 1]], fees: [['cost', 0.35]], size: [['space', 1]], floor: [['light_view', 0.3], ['quiet', 0.3]], exposure: [['light_view', 0.6]],
  in_unit_wd: [['amenities', 0.4]], elevator: [['amenities', 0.2]], doorman: [['amenities', 0.3]], records: [['building', 0.6]], reviews: [['building', 0.4], ['quiet', 0.2]] };

const humanize = (k) => String(k).replaceAll('_', ' ').replace(/^\w/, (c) => c.toUpperCase());
export function standard() {
  const std = Array.isArray(R.cov?.standard) && R.cov.standard.length ? R.cov.standard : FALLBACK_STD.map(([key, label, why]) => ({ key, label, why }));
  return std.filter((s) => s && s.key != null).map((s) => ({ key: String(s.key), label: String(s.label || humanize(s.key)), why: s.why ? String(s.why) : '' }));
}
export function factLabel(k) { return standard().find((s) => s.key === k)?.label || humanize(k); }

export function hasMedia(L) {
  const im = imagesOf(L);
  return im.own.length + im.building.length > 0 || (L.floorplan_images || []).some((u) => safeUrl(u));
}
export const inQueue = (L) => !['gone', 'rejected'].includes(L.status || 'new');

// ------------------------------------------------------------------ lint and questions (browser fallback)
function lintOf(L) {
  const out = [], p = L.price || {}, c = cost(L);
  if (p.net_effective && p.gross && p.net_effective > p.gross + 1) out.push({ code: 'net_above_gross', severity: 'high', message: 'Net-effective rent is above the gross rent' });
  if (c == null) out.push({ code: 'no_cost', severity: 'high', message: 'No monthly cost, so the unit cannot be ranked on price' });
  if (p.free_months > 0 && !p.lease_months) out.push({ code: 'concession_no_term', severity: 'med', message: 'Free months quoted without a lease length' });
  const big = (L.beds ?? 1) >= 2 ? 3500 : 2200;
  if (L.sqft && (L.sqft < 250 || L.sqft > big)) out.push({ code: 'size_outlier', severity: 'med', message: `${Math.round(L.sqft)} ft² looks implausible for ${L.beds ? L.beds + ' bedroom' + (L.beds > 1 ? 's' : '') : 'a studio'}` });
  const age = ageDays(L.checked);
  if (age == null) out.push({ code: 'never_checked', severity: 'med', message: 'No date for the last availability check' });
  else if (age > 21) out.push({ code: 'stale_check', severity: 'med', message: `Availability last checked ${age} days ago` });
  if (!safeUrl(L.links?.listing)) out.push({ code: 'no_link', severity: 'low', message: 'No listing link to re-verify against' });
  if (L.floor_inferred && L.floor != null) out.push({ code: 'floor_inferred', severity: 'low', message: `Floor ${Math.round(L.floor)} is inferred from the unit number` });
  return out;
}
function derivedRow(L) {
  const W = S.weights, tot = Object.values(W).reduce((a, b) => a + b, 0) || 1;
  const have = [], missing = [], questions = [];
  for (const [key, , , test, q] of FALLBACK_STD) {
    if (test(L)) have.push(key); else { missing.push(key); if (q) questions.push(q); }
  }
  if ((L.price?.free_months || 0) > 0) questions.push('Is the concession taken as free months up front or spread across the lease, and is the renewal priced from the gross or the net rent?');
  const stale = (ageDays(L.checked) ?? 99) > 14 && cost(L) != null ? ['cost'] : [];
  const impact = missing.reduce((a, k) => a + (FACT_DIMS[k] || []).reduce((s, [d, share]) => s + ((W[d] || 0) / tot) * share * 50, 0), 0);
  return { have, missing, stale, score_impact: Math.round(impact * 10) / 10, priority: null, questions, lint: lintOf(L) };
}

// ------------------------------------------------------------------ queue
const SEV = { high: 3, med: 2, low: 1 };
/** One row per listing still in play: facts, gaps, questions, lint and priority. `derived` says it was estimated here. */
export function queueRows() {
  const fromFile = R.cov?.listings && typeof R.cov.listings === 'object';
  const rows = [];
  if (fromFile) {
    for (const [id, c] of Object.entries(R.cov.listings)) {
      const L = byId(id); if (!L || !c || typeof c !== 'object') continue;
      if (c.active === false || (c.active == null && !inQueue(L))) continue;
      const gapImpact = Object.fromEntries((Array.isArray(c.gaps) ? c.gaps : []).filter((g) => g && g.key != null).map((g) => [String(g.key), num(g.impact)]));
      const missing = arr(c.missing).sort((a, b) => (gapImpact[b] ?? 0) - (gapImpact[a] ?? 0));
      const questions = arr(c.questions);
      rows.push({ L, have: arr(c.have), missing, stale: arr(c.stale), impact: num(c.score_impact), priority: Number.isFinite(c.priority) ? c.priority : null, gapImpact,
        reason: c.priority_reason ? String(c.priority_reason) : '', finalist: c.finalist === true,
        questions: questions.length || Array.isArray(c.questions) ? questions : derivedRow(L).questions,
        lint: (Array.isArray(c.lint) ? c.lint : []).filter((x) => x && x.message).map((x) => ({ code: String(x.code || ''), severity: SEV[x.severity] ? x.severity : 'low', message: String(x.message) })) });
    }
  } else {
    for (const L of S.listings) if (inQueue(L)) { const d = derivedRow(L); rows.push({ L, ...d, impact: d.score_impact, gapImpact: {}, reason: '', finalist: false }); }
  }
  if (!rows.some((r) => r.priority != null)) {
    // priority: points at stake, weighted towards homes the renter cares about and can actually take
    // and towards homes that already score well, so a long-shot with many unknowns does not crowd out a near-finalist
    const w = (r) => (r.impact + 2 * r.lint.filter((x) => x.severity === 'high').length) * (isSaved(r.L.id) ? 3 : 1) * (r.L.score?.eligible ? 1.5 : 0.6)
      * (['shortlist', 'touring', 'applied'].includes(r.L.status) ? 2 : 1) * ((score(r.L) ?? 50) / 60) ** 2;
    [...rows].sort((a, b) => w(b) - w(a) || (score(b.L) ?? 0) - (score(a.L) ?? 0)).forEach((r, i) => (r.priority = i + 1));
  }
  for (const r of rows) r.maxSev = Math.max(0, ...r.lint.map((x) => SEV[x.severity] || 0));
  return rows;
}
const arr = (v) => (Array.isArray(v) ? v.filter((x) => x != null).map(String) : []);
const num = (v) => (Number.isFinite(+v) && v !== null && v !== '' ? +v : 0);
export const derivedQueue = () => !(R.cov?.listings && typeof R.cov.listings === 'object');

// ------------------------------------------------------------------ coverage summary
export function coverageSummary(rows) {
  const std = standard();
  const n = rows.length;
  const known = Object.fromEntries(std.map((s) => [s.key, 0]));
  for (const r of rows) for (const k of r.have) if (k in known) known[k]++;
  const sm = R.cov?.summary || {};
  const cnt = (k) => rows.filter((r) => r.missing.includes(k)).length;
  const pick = (v, fb) => (Number.isFinite(+v) && v != null ? +v : fb);
  const total = pick(sm.active, pick(sm.listings, n));
  return {
    total, complete: pick(sm.complete, rows.filter((r) => !r.missing.length).length),
    missing_size: pick(sm.missing_size, cnt('size')), missing_fees: pick(sm.missing_fees, cnt('fees')), missing_media: pick(sm.missing_media, cnt('media')),
    stale: pick(sm.stale, rows.filter((r) => r.stale.length).length),
    claim: typeof R.cov?.claim === 'string' ? R.cov.claim : '', finalists: Number.isFinite(+sm.finalists) && sm.finalists != null ? +sm.finalists : null,
    facts: std.map((s) => ({ ...s, known: known[s.key] || 0, n })),
    sources: sourcesOf(),
    derived: !R.cov,
  };
}
function sourcesOf() {
  if (Array.isArray(R.cov?.sources)) return R.cov.sources.filter((s) => s && s.name).map((s) => ({ name: String(s.name), listings: num(s.listings), checked: typeof s.checked === 'string' ? s.checked : null }));
  const m = new Map();
  for (const L of S.listings) {
    const u = safeUrl(L.links?.listing);
    let host = 'No listing link';
    if (u && /^https?:/i.test(u)) { try { host = new URL(u).hostname.replace(/^www\./, ''); } catch { /* keep the fallback name */ } }
    const s = m.get(host) || m.set(host, { name: host, listings: 0, checked: null }).get(host);
    s.listings++;
    if (L.checked && (!s.checked || L.checked > s.checked)) s.checked = String(L.checked).slice(0, 10);
  }
  return [...m.values()].sort((a, b) => b.listings - a.listings).slice(0, 12);
}

// ------------------------------------------------------------------ history
export const EVENT_TYPES = [['new', 'New'], ['price', 'Price'], ['status', 'Status'], ['gone', 'Gone'], ['relist', 'Relisted'], ['concession', 'Concession'], ['claim', 'Claim']];
export function events() {
  const E = Array.isArray(R.hist?.events) ? R.hist.events : [];
  return E.filter((e) => e && e.id != null && parseDate(e.date) != null && EVENT_TYPES.some(([k]) => k === e.type))
    .map((e) => ({ ...e, id: String(e.id), L: byId(String(e.id)) }))
    .sort((a, b) => (parseDate(b.date) - parseDate(a.date)) || String(a.id).localeCompare(String(b.id)));
}
/** Price points for a listing, oldest first, with the value to plot (net when known, else gross). */
export function priceHistory(id) {
  const P = R.hist?.price_history?.[id];
  if (!Array.isArray(P)) return [];
  return P.filter((p) => p && parseDate(p.date) != null && (Number.isFinite(+p.net) || Number.isFinite(+p.gross)))
    .map((p) => ({ date: p.date, v: Number.isFinite(+p.net) && p.net != null ? +p.net : +p.gross, gross: p.gross, net: p.net, source: p.source }))
    .sort((a, b) => parseDate(a.date) - parseDate(b.date));
}
export function snapshots() {
  return (Array.isArray(R.hist?.snapshots) ? R.hist.snapshots : []).filter((s) => s && parseDate(s.date) != null && Number.isFinite(+s.active)).sort((a, b) => parseDate(a.date) - parseDate(b.date));
}

// ------------------------------------------------------------------ gone fast
const budgetCap = () => S.crit.budget?.hard_max ?? Math.max(0, ...(S.crit.budget?.tiers || []).map((t) => t.max || 0)) ?? null;
export function goneRows() {
  const G = Array.isArray(R.hist?.gone_fast) ? R.hist.gone_fast : [];
  const cap = budgetCap() || null;
  return G.filter((g) => g && g.id != null).map((g) => {
    const L = byId(String(g.id));
    const days = Number.isFinite(+g.days) && g.days != null ? +g.days : (parseDate(g.listed) != null && parseDate(g.gone) != null ? Math.round((parseDate(g.gone) - parseDate(g.listed)) / DAY) : null);
    const price = Number.isFinite(+g.last_price) && g.last_price != null ? +g.last_price : (L ? L.price?.gross ?? null : null);
    const atBudget = cap != null && price != null ? price <= cap : null;
    const sc = L ? score(L) : null;
    const good = sc != null ? sc >= 60 : null;
    return { id: String(g.id), L, listed: g.listed || null, gone: g.gone || null, days, price, atBudget, good, score: sc };
  }).sort((a, b) => (a.days ?? 1e9) - (b.days ?? 1e9));
}
/** The lesson: how fast the units that matter went. Falls back to wider groups when the narrow one is too small. */
export function goneLesson(rows) {
  const known = rows.filter((r) => r.days != null);
  const tiers = [
    [known.filter((r) => r.atBudget && r.good), 'Good units at your budget'],
    [known.filter((r) => r.atBudget), 'Units at your budget'],
    [known, 'Units you tracked'],
  ];
  const [set, who] = tiers.find(([s]) => s.length >= 3) || tiers[2];
  const d = set.map((r) => r.days);
  return { who, n: set.length, median: median(d), p25: quantile(d, 0.25), p75: quantile(d, 0.75), within7: set.filter((r) => r.days <= 7).length, set: new Set(set.map((r) => r.id)), unknown: rows.length - known.length };
}

// ------------------------------------------------------------------ watchlist
export function watchRows() {
  const B = Array.isArray(R.watch?.buildings) ? R.watch.buildings : [];
  return B.filter((b) => b && (b.name || b.address)).map((b, i) => {
    const lat = Number.isFinite(+b.lat) && b.lat != null ? +b.lat : null, lon = Number.isFinite(+b.lon) && b.lon != null ? +b.lon : null;
    const nm = String(b.name || b.address).trim().toLowerCase();
    const units = S.listings.filter((L) => String(L.building || '').trim().toLowerCase() === nm || (lat != null && L.lat != null && distM(lat, lon, L.lat, L.lon) < 35));
    return { i, key: String(b.key || b.name || i), name: String(b.name || b.address), address: b.address ? String(b.address) : '', lat, lon, reason: b.reason ? String(b.reason) : '',
      checked: typeof b.last_checked === 'string' ? b.last_checked : null, age: ageDays(b.last_checked), seen: Number.isFinite(+b.units_seen) && b.units_seen != null ? +b.units_seen : null,
      url: safeUrl(b.url), units };
  });
}
export function distM(a, b, c, d) {
  const r = Math.PI / 180, x = (d - b) * r * Math.cos(((a + c) / 2) * r), y = (c - a) * r;
  return Math.hypot(x, y) * 6371000;
}

// ------------------------------------------------------------------ media
// Every image comes from features/photos.js: scope group (unit, same line, building, floor plan, street), credit, flags.
export const MEDIA_SCOPES = [['all', 'All'], ['unit', 'Unit'], ['line', 'Same line'], ['building', 'Building'], ['plan', 'Floor plans'], ['street', 'Street']];
/** Every image a listing has, in display order: exact unit, same line, building, floor plans, street. */
export const mediaOf = (L) => photoItems(L);
/** Groups of media per listing, best-ranked first; a photo shared by several units is shown once and says so. */
export function mediaGroups() {
  const L0 = S.listings.filter(inQueue).sort((a, b) => (isSaved(b.id) - isSaved(a.id)) || ((a._rank ?? 1e6) - (b._rank ?? 1e6)) || ((score(b) ?? 0) - (score(a) ?? 0)));
  const seen = new Map(), groups = [];
  for (const L of L0) {
    const items = [];
    for (const m of mediaOf(L)) {
      const prev = seen.get(m.url);
      if (prev) { prev.shared = (prev.shared || 1) + 1; continue; }
      const it = { ...m, shared: 1 }; seen.set(m.url, it); items.push(it);
    }
    groups.push({ L, items, aerial: L.lat != null && L.lon != null });
  }
  return groups;
}
export const listingLabel = label;
export { ACTIVE };
