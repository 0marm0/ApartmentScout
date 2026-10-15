// ApartmentScout dashboard core: data loading, shared state, live ranking, filters rail, result cards,
// listing drawer, saved picks, router, theme and keyboard shortcuts. Views live in their own modules and
// talk to the core through the exports below and the event bus (on/emit).
import { $, esc, money, moneyShort, safeUrl, scoreColor, ring, unitGlyph, bullets, bullet, routeNames, ICONS, toast, LINE_COLORS, aerialHTML, imagesOf, imgFallback, routeBadge, legBadges, miles } from './util.js';
import { COMMUTE_MODES, commuteEntry, modeMinutes, modeOptions, evaluate, applyProfile, profileOf, diffProfile, serverSteps, parseDay, cashFlow, basisLabel } from './criteria.js';
import { initPalette, openPalette, shareListing, syncTrigger } from './palette.js';
import { initEnhance } from './enhance.js';
import { takeEarly } from './perf/early.js';   // [perf] boot data requested before the code loaded (optimised build only)
import { initTheme, flipTheme, initShell, parseRoute, syncSubnav } from './shell.js';
import { initMedia, cardMediaHTML, afterDrawerMedia, mediaTransition } from './features/media.js';   // photos: lightbox, blur-up, counts
import { loadPreviews } from './features/lqip.js';
import './features/comfort.js';
import { initDestPin } from './features/dest-pin-style.js';   // [office pin] gold or classic destination marker   // [feature C] comfort + accent attributes on <html> apply at import, before first paint
import { cardsEmpty } from './features/empty.js';   // [feature C]
// results list and filter rail features (chips, collapsible sections, windowed cards, rank motion, density, price history, worker scoring)
import { initResults, setCardItems, clearCardList, cardIds, cardPos, cardEl, revealCard, decorateRail, railFocus, restoreRailFocus, rescoreWeights, deltaHTML, trendHTML } from './features/results.js';

export const store = {
  get(k, d) { try { const v = localStorage.getItem('as:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('as:' + k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};

export const ACTIVE = ['new', 'researching', 'shortlist', 'touring', 'applied'];
export const STATUSES = [['new', 'New'], ['researching', 'Researching'], ['shortlist', 'Shortlist'], ['touring', 'Touring'], ['applied', 'Applied'], ['rejected', 'Rejected'], ['gone', 'Gone']];
export const DIMS = [['cost', 'Cost'], ['space', 'Space'], ['commute', 'Commute'], ['amenities', 'Amenities'], ['light_view', 'Light & view'], ['building', 'Building'], ['interior', 'Interior'], ['quiet', 'Quiet']];
export const TIER_VARS = ['--tier-1', '--tier-2', '--tier-3'];
export const FEATURES = [
  ['in_unit_wd', 'In-unit washer/dryer'], ['elevator', 'Elevator'], ['doorman', 'Full-time doorman'], ['gym', 'Gym'],
  ['floor10', 'Floor 10 or higher'], ['sized', 'Size known'], ['light', 'Light model'], ['dishwasher', 'Dishwasher'], ['roof_deck', 'Roof deck'], ['pets', 'Pets allowed'],
];

export const S = {
  listings: [], crit: {}, manifest: {}, notes: {}, base: 'data',
  filters: { q: '', tiers: null, over: false, maxCommute: 75, toggles: [], status: ACTIVE, savedOnly: false, nl: null },
  weights: {}, compare: store.get('compare', []), picks: store.get('picks', {}),
  sel: null, sort: 'match', group: 'units', view: 'map', listeners: {},
  // commute lens shared by the map surface, pins, cards, filters, KPIs, Shortlist and Compare: mode + destination
  commuteMode: 'best', destName: null,
  crit0: {}, preview: null,   // criteria.json as loaded, and the applied browser preview of edited criteria (or null)
};
export const on = (ev, fn) => ((S.listeners[ev] ||= []).push(fn));
export const emit = (ev, x) => (S.listeners[ev] || []).forEach((f) => f(x));
export const byId = (id) => S.listings.find((L) => L.id === id);
const allDests = () => S.crit.commute?.destinations || [];
/** The selected destination (the commute lens), else the first. */
export const dest = () => allDests().find((d) => d.name === S.destName) || allDests()[0];
/** Destination names, the selected one first (views that show one destination read dests()[0]). */
export const dests = () => { const a = dest(); return a ? [a.name, ...allDests().filter((d) => d !== a).map((d) => d.name)] : []; };
const walkKmh = () => S.crit.commute?.transit?.walk_speed_kmh || 4.8;
export const MODE_LABEL = Object.fromEntries(COMMUTE_MODES);
/** Door-to-door minutes for a listing in the selected mode (best / subway / bus / walk) to a destination name. */
export function commuteOf(L, d = dest()?.name, mode = S.commuteMode) {
  const D = allDests().find((x) => x.name === d);
  return D ? modeMinutes(L, D, mode, walkKmh()) : L.commute?.[d]?.minutes ?? null;
}
export const label = (L) => `${L.building || L.address}${L.unit ? ' ' + L.unit : ''}`;
export const cost = (L) => L.score?.monthly_cost;
export const score = (L) => L._s ?? L.score?.overall;
/** Door-to-door minutes by mode for a listing and destination: walk / subway / bus from the router (walk from
 *  distance when the router has none), the fastest of them, and `sel` = minutes in the selected mode. */
export function modesOf(L, d = dest()) {
  const c = commuteEntry(L, d) || {}, m = c.modes || {}, kmh = walkKmh(), mode = S.commuteMode;
  const walk = modeMinutes(L, d, 'walk', kmh), subway = modeMinutes(L, d, 'subway', kmh), bus = modeMinutes(L, d, 'bus', kmh);
  const opts = [['walk', walk], ['subway', subway], ['bus', bus]].filter(([, v]) => v != null).sort((x, y) => x[1] - y[1]);
  const pick = mode === 'best' ? m.transit : mode === 'walk' ? null : m[mode];
  return { walk, subway, bus, best: opts[0]?.[1] ?? null, bestMode: opts[0]?.[0] ?? null, route: pick?.route || (mode === 'best' ? m.subway?.route || c.route : null),
    legs: pick?.legs || null, modes: m, transit: m.transit?.minutes ?? null, mode, sel: modeMinutes(L, d, mode, kmh) };
}
const searchKey = (k) => `${k}:${S.crit0.search?.name || S.base}`;
/** Switch the commute lens; every surface that shows minutes follows. */
export function setCommute({ mode, dest: dn } = {}) {
  if (mode && MODE_LABEL[mode]) S.commuteMode = mode;
  if (dn && allDests().some((d) => d.name === dn)) S.destName = dn;
  fitMode(!!dn && !mode);
  store.set(searchKey('commute'), { mode: S.commuteMode, dest: S.destName });
  drawerMode = S.commuteMode === 'best' ? 'transit' : S.commuteMode;
  renderRail(); renderKPIs(); renderCards();
  emit('commute'); emit('filters', { quiet: true }); emit('weights');
  if (S.sel) reopenDrawer();
}
/** Keep the lens on a mode the selected destination has data for; on a destination switch, prefer its preferred mode. */
function fitMode(preferDest) {
  const d = dest(), ch = modeOptions({}, S.listings, d), ok = (m) => ch.find((o) => o.mode === m)?.enabled;
  if (preferDest && d?.mode && ok(d.mode)) S.commuteMode = d.mode;
  if (!ok(S.commuteMode)) S.commuteMode = ch.find((o) => o.enabled)?.mode || 'best';
  drawerMode = S.commuteMode === 'best' ? 'transit' : S.commuteMode;
}
/** Mode buttons for a destination: enabled when the router left minutes for that mode (walk: when it has coordinates). */
export function modeChoices(d = dest()) {
  return modeOptions({}, S.listings, d).map((o) => ({ ...o, on: o.mode === S.commuteMode }));
}

// ------------------------------------------------------------------ edited criteria (browser preview)
/** The day the scorer evaluated "Now" and move-in windows against. */
export const scoreDay = () => parseDay(S.crit0.scoring?.as_of || S.manifest.generated?.slice(0, 10) || new Date().toISOString().slice(0, 10));
/** Apply an edited profile (or null to go back to criteria.json): re-evaluate gates, tiers, eligibility and the
 *  criteria-driven parts in the browser, re-rank, and re-render everything. Nothing is written to disk. */
export function applyCriteria(profile, { quiet = false } = {}) {
  const base = profileOf(S.crit0);
  if (profile && !diffProfile(base, profile).length) profile = null;
  const today = scoreDay(), nTiers = (S.crit.budget?.tiers || []).length;
  if (profile) {
    S.crit = applyProfile(S.crit0, profile);
    let kept = {};
    for (const L of S.listings) { const r = evaluate(L, L._score0, S.crit, today); L.score = r.score; for (const k of r.kept) kept[k] = (kept[k] || 0) + 1; }
    S.preview = { profile, changes: diffProfile(base, profile), steps: serverSteps(S.crit0, S.crit, { kept }) };
    store.set(searchKey('criteria'), profile);
  } else {
    S.crit = S.crit0; S.preview = null;
    for (const L of S.listings) L.score = L._score0;
    store.set(searchKey('criteria'), null);
  }
  if (!allDests().some((d) => d.name === S.destName)) S.destName = allDests()[0]?.name || null;
  fitMode(!!profile && !quiet);
  store.set(searchKey('commute'), { mode: S.commuteMode, dest: S.destName });
  if ((S.crit.budget?.tiers || []).length !== nTiers) { S.filters.tiers = (S.crit.budget?.tiers || []).map((_, i) => i); S.filters.over = false; saveFilters(); }
  rescore(); renderRail(); renderKPIs(); renderCards(); renderSearchSwitch();
  emit('criteria'); emit('commute'); emit('filters', { quiet: true }); emit('weights'); emit('weights-settled');
  if (S.sel) reopenDrawer();
  if (!quiet) toast(profile ? 'Previewing your edited criteria in this browser' : 'Back to the criteria in criteria.yaml');
}
function renderSearchSwitch() {
  const b = $('searchSwitch'); if (!b) return;
  b.classList.toggle('pv', !!S.preview);
  b.title = S.preview ? 'Searches and settings: previewing edited criteria in this browser' : 'Searches, settings and New search';
}
export async function openSettings() { (await import('./settings.js')).openSettings(); }
/** The New search wizard (mode 'new', or 'edit' for every criterion of the open search). */
export async function openWizard(o) { (await import('./onboarding.js')).openWizard(o); }
function reopenDrawer() {
  const sc = $('drawer').querySelector('.d-scroll'), y = sc?.scrollTop || 0;
  openDrawer(S.sel); const s2 = $('drawer').querySelector('.d-scroll'); if (s2) s2.scrollTop = y;
}
export const tierIndex = (L) => (S.crit.budget?.tiers || []).findIndex((t) => t.name === L.score?.budget_tier);
export const isSaved = (id) => !!S.picks[id]?.saved;
export const pick = (id) => S.picks[id] || {};

// ------------------------------------------------------------------ ranking (re-runs live as weights move)
/** Overall score from the dimension scores and the current weights; unknown dimensions count as a neutral 50. */
export function rescore() {
  const W = S.weights, tot = Object.values(W).reduce((a, b) => a + b, 0) || 1;
  for (const L of S.listings) {
    const p = L.score?.parts || {};
    L._s = p && Object.keys(p).length ? DIMS.reduce((a, [k]) => a + (W[k] || 0) * (p[k] ?? 50), 0) / tot : L.score?.overall;
  }
  // ranks: score desc, then confidence desc, then lower monthly cost, then id (same tie-break as score.py)
  const cmp = (a, b) => (b._s ?? -1) - (a._s ?? -1) || (b.score?.confidence ?? 0) - (a.score?.confidence ?? 0) || (cost(a) ?? 1e9) - (cost(b) ?? 1e9) || (a.id < b.id ? -1 : 1);
  const cap = S.crit.budget?.tiers?.[0]?.max ?? Infinity;
  for (const L of S.listings) L._ranks = {};
  S.listings.filter((L) => L._s != null).sort(cmp).forEach((L, i) => (L._ranks.fit = i + 1));
  const act = S.listings.filter((L) => L.score?.eligible).sort(cmp);
  act.forEach((L, i) => (L._ranks.action = i + 1));
  act.filter((L) => (L.score?.cost?.budget_amount ?? cost(L) ?? Infinity) <= cap).forEach((L, i) => (L._ranks.budget = i + 1));
  const seen = new Map();
  for (const L of act) { const k = (L.building || L.address || L.id).toLowerCase(); if (!seen.has(k)) seen.set(k, seen.size + 1); L._ranks.building = seen.get(k); }
  for (const L of S.listings) L._rank = L._ranks.action ?? null;
}
const DIM_LABEL = () => Object.fromEntries(DIMS);
/** "Why it ranks here" with the current weights: the scorer's sentences, points recomputed live. */
export function reasons(L) {
  const W = S.weights, tot = Object.values(W).reduce((a, b) => a + b, 0) || 1, p = L.score?.parts || {}, lab = DIM_LABEL();
  const src = L.score?.reasons || DIMS.map(([k]) => ({ dim: k, text: `${lab[k]}: ${p[k] == null ? 'unknown, counted as neutral' : Math.round(p[k]) + ' / 100'}` }));
  return src.map((r) => {
    const pts = ((p[r.dim] ?? 50) - 50) * (W[r.dim] || 0) / tot;
    const tail = String(r.text || '').includes(': ') ? r.text.slice(r.text.indexOf(': ') + 2) : r.text;
    return { ...r, pts, weight: W[r.dim] || 0, label: lab[r.dim] || r.dim, sentence: tail };
  }).filter((r) => r.weight > 0).sort((a, b) => Math.abs(b.pts) - Math.abs(a.pts));
}
export const GATE_LABEL = (g) => {
  const [k, v] = String(g).split(':');
  const m = { over_budget: 'Over budget', unknown_cost: 'Cost unknown', price_dispute: 'Price claims disagree', 'concession': 'Concession may not apply', 'move_date': 'Available after your window', stale: 'Not rechecked recently' };
  if (k === 'unverified') return { fees: 'Fees unknown', lease_term: 'Lease term unknown' }[v] || `Unconfirmed: ${String(v || '').replaceAll('_', ' ')}`;
  if (k === 'fails') return `Fails: ${String(v || '').replaceAll('_', ' ')}`;
  if (k === 'stale') return `Last checked ${String(v || '').replace('checked_', '').replaceAll('_', ' ')}`;
  return m[k] || String(g).replaceAll('_', ' ').replace(':', ': ');
};
/** Points each dimension adds or removes versus a neutral listing, with the current weights. */
export function drivers(L) {
  const W = S.weights, tot = Object.values(W).reduce((a, b) => a + b, 0) || 1, p = L.score?.parts || {};
  return DIMS.map(([k, n]) => ({ k, n, v: p[k], pts: p[k] == null ? 0 : ((p[k] - 50) * (W[k] || 0)) / tot }));
}
/** Which of the ten facts a finalist needs are known for this listing. */
export function coverage(L) {
  const am = L.amenities || {};
  const facts = [
    ['Monthly cost', cost(L) != null], ['Size', !!L.sqft], ['Floor', L.floor != null && !L.floor_inferred], ['Exposure', !!L.exposure?.length],
    ['In-unit W/D', am.in_unit_wd != null], ['Elevator', am.elevator != null], ['Doorman', am.doorman != null],
    ['Commute', commuteOf(L, undefined, 'best') != null], ['Building records', !!L.records?.flags || (S.manifest.dossiers || []).includes(L.id)], ['Reviews', !!L.reviews?.summary],
  ];
  return { have: facts.filter((f) => f[1]).length, total: facts.length, missing: facts.filter((f) => !f[1]).map((f) => f[0]) };
}

// ------------------------------------------------------------------ filters
function tierCap() {
  const t = S.crit.budget?.tiers || [], sel = S.filters.tiers;
  if (S.filters.over) return null;
  if (!sel?.length) return t.length ? null : null;
  return Math.max(...sel.map((i) => t[i]?.max ?? 0));
}
function featureOk(L, k) {
  const am = L.amenities || {};
  if (k === 'floor10') return L.floor >= 10;
  if (k === 'sized') return !!L.sqft;
  if (k === 'light') return !!L.site?.sun_hours;
  if (k === 'doorman') return am.doorman === 'full-time';
  return am[k] === true;
}
/** [feature C] Extra filter predicates `(listing, filters) => boolean`; the plain-language search registers one for S.filters.nl. */
export const EXTRA_FILTERS = [];
export function filtered() {
  const f = S.filters, q = f.q.trim().toLowerCase(), cap = tierCap(), st = new Set(f.status);
  return S.listings.filter((L) => {
    if (!st.has(L.status || 'new')) return false;
    if (f.savedOnly && !isSaved(L.id)) return false;
    if (q && !`${L.building} ${L.unit} ${L.address} ${L.neighborhood}`.toLowerCase().includes(q)) return false;
    if (cap != null && (budgetAmt(L) == null || budgetAmt(L) > cap)) return false;
    if (f.maxCommute < 75 && commuteOf(L) != null && commuteOf(L) > f.maxCommute) return false;
    for (const k of f.toggles) if (!featureOk(L, k)) return false;
    for (const fn of EXTRA_FILTERS) if (!fn(L, f)) return false;
    return true;
  });
}
const SORTS = {
  match: (a, b) => (score(b) ?? -1) - (score(a) ?? -1),
  cost: (a, b) => (cost(a) ?? 1e9) - (cost(b) ?? 1e9),
  commute: (a, b) => (commuteOf(a) ?? 1e9) - (commuteOf(b) ?? 1e9),
  size: (a, b) => (b.sqft ?? -1) - (a.sqft ?? -1),
  ppsf: (a, b) => (a.sqft && cost(a) ? cost(a) / a.sqft : 1e9) - (b.sqft && cost(b) ? cost(b) / b.sqft : 1e9),
};
export const sorted = (F, key = S.sort) => [...F].sort(SORTS[key] || SORTS.match);
export function setFilter(k, v) { S.filters[k] = v; saveFilters(); emit('filters'); }
function saveFilters() { store.set('filters2', S.filters); }

// ------------------------------------------------------------------ picks, compare
export function toggleCompare(id) {
  const i = S.compare.indexOf(id);
  if (i >= 0) S.compare.splice(i, 1); else { S.compare.push(id); if (S.compare.length > 4) S.compare.shift(); }
  store.set('compare', S.compare); emit('compare');
}
export function setPick(id, patch) {
  S.picks[id] = { ...(S.picks[id] || {}), ...patch, updated: new Date().toISOString().slice(0, 10) };
  if (!S.picks[id].saved && !S.picks[id].note && !S.picks[id].tier && !S.picks[id].tour) delete S.picks[id];
  store.set('picks', S.picks); emit('saved', id);
}
export function toggleSave(id) { setPick(id, { saved: !isSaved(id) }); toast(isSaved(id) ? 'Saved to your picks' : 'Removed from your picks'); }
export function exportPicks() {
  download(`apartmentscout-picks-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ version: 1, search: S.crit.search?.name, picks: S.picks, weights: S.weights }, null, 1), 'application/json');
}
export async function importPicks(file) {
  try {
    const js = JSON.parse(await file.text());
    if (!js || typeof js.picks !== 'object') throw new Error('not a picks file');
    for (const [id, p] of Object.entries(js.picks)) if (typeof id === 'string' && p && typeof p === 'object') S.picks[id] = { ...(S.picks[id] || {}), ...p };
    store.set('picks', S.picks); emit('saved'); toast(`Imported ${Object.keys(js.picks).length} picks`);
  } catch (e) { toast('That file is not an ApartmentScout picks backup'); }
}
export function download(name, text, type = 'text/plain') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function exportCSV() {
  const cols = [['id', (L) => L.id], ['building', (L) => L.building], ['unit', (L) => L.unit], ['address', (L) => L.address], ['neighborhood', (L) => L.neighborhood],
    ['status', (L) => L.status], ['score', (L) => score(L)?.toFixed(1)], ['rank', (L) => L._rank], ['monthly_cost', (L) => cost(L)?.toFixed(0)], ['gross', (L) => L.price?.gross],
    ['budget_tier', (L) => L.score?.budget_tier], ['sqft', (L) => L.sqft], ['beds', (L) => L.beds], ['floor', (L) => L.floor], ['exposure', (L) => (L.exposure || []).join(' ')],
    [`commute_${dests()[0] || ''}_${S.commuteMode}`, (L) => commuteOf(L)?.toFixed(0)], ['in_unit_wd', (L) => L.amenities?.in_unit_wd], ['doorman', (L) => L.amenities?.doorman], ['gym', (L) => L.amenities?.gym],
    ['saved', (L) => (isSaved(L.id) ? 'yes' : '')], ['my_tier', (L) => pick(L.id).tier], ['my_note', (L) => pick(L.id).note], ['checked', (L) => L.checked], ['listing_url', (L) => safeUrl(L.links?.listing)]];
  // spreadsheet formula injection: text starting with = + - @ (or tab / CR) is prefixed with an apostrophe
  const guard = (v) => (typeof v === 'string' && /^[=+\-@\t\r]/.test(v) ? "'" + v : v);
  const q = (v0) => { const v = guard(v0); return v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v); };
  const rows = sorted(filtered()).map((L) => cols.map(([, f]) => q(f(L))).join(','));
  download(`apartmentscout-${new Date().toISOString().slice(0, 10)}.csv`, [cols.map((c) => c[0]).join(','), ...rows].join('\n'), 'text/csv');
  toast(`Exported ${rows.length} listings`);
}

async function getJSON(p, fallback) {
  // standalone builds embed every data file so the page also works when opened as a file
  const emb = window.__AS_DATA__;
  if (emb) return p in emb ? emb[p] : fallback;
  const early = takeEarly(p);   // [perf]
  if (early) { try { return await early; } catch { /* fall through to a normal fetch */ } }
  try { const r = await fetch(p, { cache: 'no-cache' }); if (!r.ok) throw new Error(r.status); return await r.json(); } catch { return fallback; }
}
export const loadJSON = getJSON;

// ------------------------------------------------------------------ KPI strip
function median(a) { const s = a.filter((v) => v != null).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; }
function renderKPIs() {
  const act = S.listings.filter((L) => ACTIVE.includes(L.status)), F = filtered();
  const elig = S.listings.filter((L) => L.score?.eligible);
  const top = [...elig].sort((a, b) => a._rank - b._rank)[0];
  const short = S.listings.filter((L) => ['shortlist', 'touring', 'applied'].includes(L.status)).length;
  const noGeo = act.filter((L) => L.lat == null).length;
  const mc = median(F.map((L) => commuteOf(L)));
  const pv = S.preview ? `<div class="kpi pv-banner" role="status"><i aria-hidden="true"></i><b>Browser preview of your edited criteria</b><span class="faint">${S.preview.changes.length} change${S.preview.changes.length === 1 ? '' : 's'} · files unchanged</span><button type="button" class="btn sm" data-pv="edit">Edit</button><button type="button" class="btn sm ghost" data-pv="reset">Reset</button></div>` : '';
  const toDest = esc(dests()[0] || 'work'), byMode = S.commuteMode === 'best' ? '' : ' by ' + MODE_LABEL[S.commuteMode].toLowerCase();
  // p1 stays on every width; p2 and p3 fold into the "all figures" popover on narrow screens (see shell.css)
  const items = [
    ['p2', `${S.listings.length}<small>${act.length} active</small>`, 'tracked'], ['p1 lead', `${F.length}`, 'match filters'], ['p2', `${elig.length}`, 'eligible'],
    ['p2', `${short}`, 'shortlisted'], ['p1', `${money(median(F.map(cost)))}`, 'median / mo'],
    ['p1', mc != null ? `${Math.round(mc)}<small>min</small>` : '—', `median${byMode}<span class="to"> to ${toDest}</span>`],
  ];
  const built = S.manifest.generated ? 'Data built ' + esc(S.manifest.generated.slice(0, 10)) : 'No data yet: run apartmentscout build';
  const awaiting = noGeo ? ` · ${noGeo} awaiting coordinates` : '';
  const topLink = top ? `<a href="#" data-open="${esc(top.id)}">${esc(label(top))}</a>` : '';
  $('kpis').innerHTML = `<div class="kpi-row">${pv}${items.map(([p, v, k]) => `<div class="kpi ${p}"><span class="v">${v}</span><span class="k">${k}</span></div>`).join('')}` +
    (top ? `<div class="kpi p3"><span class="k">Top match</span>${topLink}</div>` : '') +
    `<span class="spacer"></span><span class="gen p3" title="Listings come from the sources your agent swept; this is not a census of the market.">${built}${awaiting}<span class="cen"> · not a market census</span></span></div>` +
    `<div class="kpi-wrap"><button type="button" class="kpi-more" aria-haspopup="true" aria-expanded="false" aria-controls="kpiPop" aria-label="All figures" title="All figures"><svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><circle cx="3.5" cy="8" r="1.3"/><circle cx="8" cy="8" r="1.3"/><circle cx="12.5" cy="8" r="1.3"/></svg></button>` +
    `<div class="kpi-pop menu-pop" id="kpiPop" role="group" aria-label="All figures" hidden>${items.map(([, v, k]) => `<div class="kpi-i"><span class="k">${k}</span><span class="v">${v}</span></div>`).join('')}` +
    (top ? `<div class="kpi-i"><span class="k">Top match</span><span class="v">${topLink}</span></div>` : '') +
    `<p class="kpi-note">${built}${awaiting}<br>Listings come from the sources your agent swept; this is not a market census.</p></div></div>`;
  $('kpis').querySelectorAll('[data-open]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); openDrawer(e.currentTarget.dataset.open, { fly: true }); }));
  $('kpis').querySelector('[data-pv=edit]')?.addEventListener('click', openSettings);
  $('kpis').querySelector('[data-pv=reset]')?.addEventListener('click', () => applyCriteria(null));
  emit('kpis');   // [features/visit.js] the strip was rebuilt: features that add to it re-attach
}

// ------------------------------------------------------------------ filter rail
function hist(values, lo, hi, bins, cut) {
  const h = new Array(bins).fill(0);
  for (const v of values) if (v != null && v >= lo && v <= hi) h[Math.min(bins - 1, Math.floor(((v - lo) / (hi - lo)) * bins))]++;
  const m = Math.max(...h, 1);
  return `<div class="hist" aria-hidden="true">${h.map((n, i) => `<i class="${cut != null && lo + ((i + 0.5) * (hi - lo)) / bins > cut ? 'off' : ''}" style="height:${Math.max(6, (n / m) * 100)}%"></i>`).join('')}</div>`;
}
const pct = (v, lo, hi) => `--p:${((v - lo) / (hi - lo)) * 100}%`;
function renderRail() {
  const keepFocus = railFocus($('rail'));   // results/rail features: the rebuild below must not drop keyboard focus
  const tiers = S.crit.budget?.tiers || [], f = S.filters;
  const act = S.listings.filter((L) => f.status.includes(L.status || 'new'));
  const cnt = (fn) => act.filter(fn).length;
  const sel = new Set(f.tiers || []);
  const cap = tierCap();
  const tot = Object.values(S.weights).reduce((a, b) => a + b, 0) || 1;
  const costs = act.map(budgetAmt).filter((v) => v != null).sort((a, b) => a - b);
  const lo = Math.floor((costs[Math.floor(costs.length * 0.02)] || 2000) / 250) * 250, hi = Math.ceil((costs[Math.floor(costs.length * 0.98)] || 8000) / 250) * 250;
  const d = dest(), ds = allDests();
  const must = new Set(S.crit.must_have || []);
  $('rail').innerHTML = `
    <div class="sec search-sec"><button type="button" class="srch-row ${S.preview ? 'pv' : ''}" id="railSettings" aria-label="Search settings">
      <span class="t"><b>${esc(S.crit.search?.name || 'Your search')}</b><small>${esc(searchSummary())}</small></span><span class="go">${S.preview ? '<span class="pill warn">Preview</span>' : ''}Edit</span></button></div>
    ${tiers.length ? `<div class="sec"><div class="sec-h"><h3>Budget</h3><button class="reset" type="button" data-reset="tiers">${f.over || !sel.size ? 'Within budget' : 'Any price'}</button></div>
      <div class="tiers">${tiers.map((t, i) => `<button type="button" class="tier ${sel.has(i) ? 'on' : ''}" data-tier="${i}" aria-pressed="${sel.has(i)}"><b><i style="background:var(${TIER_VARS[i] || '--tier-3'})"></i>≤ ${money(t.max)}</b><span>${esc(t.name)} · ${cnt((L) => budgetAmt(L) != null && budgetAmt(L) <= t.max)}</span></button>`).join('')}
        <button type="button" class="tier ${f.over ? 'on' : ''}" data-over aria-pressed="${f.over}"><b><i style="background:var(--tier-over)"></i>Over</b><span>${cnt((L) => budgetAmt(L) > (S.crit.budget?.hard_max ?? 1e9))} over the cap</span></button></div>
      <div class="range"><div class="range-h"><span>${esc(BASIS_RAIL[S.crit.budget?.basis] || BASIS_RAIL.monthly_cost)}</span><b>${cap ? '≤ ' + money(cap) : 'Any'}</b></div>${hist(costs, lo, hi, 36, cap)}</div></div>` : ''}
    ${d ? `<div class="sec"><div class="sec-h"><h3>Commute</h3>${ds.length > 1 ? `<select class="sel cm-dest" id="rDest" aria-label="Commute destination">${ds.map((x) => `<option value="${esc(x.name)}" ${x === d ? 'selected' : ''}>to ${esc(x.name)}</option>`).join('')}</select>` : `<span class="faint" style="font-size:var(--fs-xs)">to ${esc(d.name)}</span>`}</div>
      ${modeSegHTML(d, 'rMode')}
      <div class="range-h"><span>${esc(MODE_LABEL[S.commuteMode])} door to door${d.arrive_by ? ', arrive ' + esc(d.arrive_by) : ''}</span><b id="comVal">${f.maxCommute >= 75 ? 'Any' : '≤ ' + f.maxCommute + ' min'}</b></div>
      ${hist(act.map((L) => commuteOf(L)), 0, 60, 30, f.maxCommute < 75 ? f.maxCommute : null)}
      <input type="range" id="rCom" min="5" max="75" value="${f.maxCommute}" style="${pct(f.maxCommute, 5, 75)}" aria-label="Maximum commute in minutes"></div>` : ''}
    <div class="sec"><div class="sec-h"><h3>Must-haves and features</h3>${f.toggles.length ? '<button class="reset" type="button" data-reset="toggles">Clear</button>' : ''}</div>
      <div class="toggles">${FEATURES.map(([k, t]) => `<label class="tg ${f.toggles.includes(k) ? 'on' : ''}" data-tg="${k}" role="switch" aria-checked="${f.toggles.includes(k)}" tabindex="0"><span class="switch"></span><span class="lbl">${t}</span>${must.has(k) ? '<span class="tag">must</span>' : ''}<span class="n">${cnt((L) => featureOk(L, k))}</span></label>`).join('')}
      <label class="tg ${f.savedOnly ? 'on' : ''}" data-saved role="switch" aria-checked="${f.savedOnly}" tabindex="0"><span class="switch"></span><span class="lbl">Saved picks only</span><span class="n">${Object.values(S.picks).filter((p) => p.saved).length}</span></label></div></div>
    <div class="sec"><div class="sec-h"><h3>Status</h3></div>
      <div class="chips">${STATUSES.map(([k, t]) => `<button type="button" class="chip ${f.status.includes(k) ? 'on' : ''}" data-st="${k}" aria-pressed="${f.status.includes(k)}">${t}<span class="n">${S.listings.filter((L) => (L.status || 'new') === k).length}</span></button>`).join('')}</div></div>
    <div class="sec"><div class="sec-h"><h3>Ranking weights</h3><button class="reset" type="button" data-reset="weights">Reset</button></div>
      ${presetsHTML()}
      <div class="weights">${DIMS.map(([k, t]) => `<div class="w-row"><span>${t}</span><input type="range" min="0" max="40" value="${S.weights[k] || 0}" data-w="${k}" style="${pct(S.weights[k] || 0, 0, 40)}" aria-label="${t} weight"><b>${Math.round(((S.weights[k] || 0) / tot) * 100)}%</b></div>`).join('')}</div>
      <p class="w-note">Results re-rank as you drag. Unknown facts count as a neutral 50 and widen the score range. Your weights stay in this browser; <a href="#" id="dlCrit">download them</a> to put in criteria.yaml.</p></div>`;
  const R = $('rail');
  R.querySelectorAll('[data-tier]').forEach((b) => b.addEventListener('click', () => {
    const s = new Set(S.filters.tiers || []), i = +b.dataset.tier; s.has(i) ? s.delete(i) : s.add(i);
    S.filters.over = false; setFilter('tiers', [...s].sort());
  }));
  R.querySelector('[data-over]')?.addEventListener('click', () => setFilter('over', !S.filters.over));
  const tg = (el, fn) => { el.addEventListener('click', (e) => { e.preventDefault(); fn(); }); el.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); fn(); } }); };
  R.querySelectorAll('[data-tg]').forEach((el) => tg(el, () => { const s = new Set(S.filters.toggles), k = el.dataset.tg; s.has(k) ? s.delete(k) : s.add(k); setFilter('toggles', [...s]); }));
  R.querySelectorAll('[data-saved]').forEach((el) => tg(el, () => setFilter('savedOnly', !S.filters.savedOnly)));
  R.querySelectorAll('[data-st]').forEach((b) => b.addEventListener('click', () => { const s = new Set(S.filters.status), k = b.dataset.st; s.has(k) ? s.delete(k) : s.add(k); setFilter('status', [...s]); }));
  R.querySelectorAll('[data-w]').forEach((r) => r.addEventListener('input', () => { S.weights[r.dataset.w] = +r.value; store.set('weights', S.weights); refreshRailValues(); rescoreWeights(); }));
  R.querySelectorAll('[data-w]').forEach((r) => r.addEventListener('change', () => renderRail()));
  R.querySelector('[data-reset=weights]').addEventListener('click', () => { S.weights = { ...(S.crit.weights || {}) }; S.preset = S.crit.scoring?.preset || null; store.set('weights', null); store.set('preset', null); rescore(); renderRail(); emit('weights'); emit('weights-settled'); });
  R.querySelector('[data-reset=tiers]')?.addEventListener('click', () => { S.filters.over = false; setFilter('tiers', (S.filters.over || !(S.filters.tiers || []).length) ? tiers.map((_, i) => i) : []); });
  R.querySelector('[data-reset=toggles]')?.addEventListener('click', () => setFilter('toggles', []));
  $('rCom')?.addEventListener('input', (e) => { S.filters.maxCommute = +e.target.value; saveFilters(); refreshRailValues(); emit('filters', { quiet: true }); });
  $('rCom')?.addEventListener('change', () => renderRail());
  $('rDest')?.addEventListener('change', (e) => setCommute({ dest: e.target.value }));
  R.querySelectorAll('#rMode [data-mode]').forEach((b) => b.addEventListener('click', () => setCommute({ mode: b.dataset.mode })));
  $('railSettings')?.addEventListener('click', openSettings);
  $('presetSel')?.addEventListener('change', (e) => {
    const p = S.crit.scoring?.presets?.[e.target.value]; if (!p) return;
    S.preset = e.target.value; S.weights = { ...p.weights }; store.set('preset', S.preset); store.set('weights', S.weights);
    rescore(); renderRail(); emit('weights'); emit('weights-settled'); toast(`${p.label} weights`);
  });
  $('dlCrit').addEventListener('click', (e) => {
    e.preventDefault();
    download('weights.yaml', `# paste into criteria.yaml\n${S.preset ? `scoring:\n  preset: ${S.preset}\n` : ''}weights:\n${DIMS.map(([k]) => `  ${k}: ${S.weights[k] || 0}`).join('\n')}\n`, 'text/yaml');
  });
  emit('rail');   // [features/tradeoff.js] the rail was rebuilt: features that add a block to it re-attach
  decorateRail(R); restoreRailFocus(R, keepFocus);   // results/rail features: collapsible sections, keep focus
}
const BASIS_RAIL = { monthly_cost: 'Monthly cost, net of concessions', net: 'Net-effective rent (fees left out)', gross: 'Gross rent in a paid month, plus known fees' };
/** The amount budget tiers compare: the scorer's budget_amount (by basis), else the monthly cost. */
export const budgetAmt = (L) => L.score?.cost?.budget_amount ?? cost(L);
function searchSummary() {
  const t = S.crit.budget?.tiers?.[0], m = (S.crit.must_have || []).length, n = allDests().length;
  return [t ? `${t.name} ${money(t.max)}` : null, `${m} must-have${m === 1 ? '' : 's'}`, `${n} destination${n === 1 ? '' : 's'}`].filter(Boolean).join(' · ');
}
/** Best / Subway / Bus / Walk buttons; a mode without router minutes is disabled and says why. */
export function modeSegHTML(d, id) {
  return `<div class="seg cm-seg" id="${id}" role="group" aria-label="Commute mode">${modeChoices(d).map((o) => `<button type="button" data-mode="${o.mode}" class="${o.on ? 'on' : ''}" aria-pressed="${o.on}" ${o.enabled ? '' : `disabled title="No ${o.label.toLowerCase()} times for ${esc(d?.name || 'this destination')}: run apartmentscout commute with a ${o.label.toLowerCase()} feed"`}>${o.label}</button>`).join('')}</div>`;
}
function presetsHTML() {
  const P = S.crit.scoring?.presets; if (!P) return '';
  const cur = S.preset && P[S.preset], same = cur && DIMS.every(([k]) => (cur.weights[k] || 0) === (S.weights[k] || 0));
  return `<div class="preset"><select class="sel" id="presetSel" aria-label="Weight preset">${Object.entries(P).map(([k, p]) => `<option value="${esc(k)}" ${k === S.preset ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}</select>
    <span class="faint">${cur ? (same ? `v${cur.version}` : 'customised') : 'custom'}</span></div>${cur?.description ? `<p class="w-note" style="margin:0 0 10px">${esc(cur.description)}</p>` : ''}`;
}
function refreshRailValues() {
  const tot = Object.values(S.weights).reduce((a, b) => a + b, 0) || 1;
  document.querySelectorAll('[data-w]').forEach((r) => { r.style.setProperty('--p', `${(r.value / 40) * 100}%`); r.parentElement.querySelector('b').textContent = Math.round(((S.weights[r.dataset.w] || 0) / tot) * 100) + '%'; });
  const rc = $('rCom'); if (rc) { rc.style.setProperty('--p', `${((rc.value - 5) / 70) * 100}%`); $('comVal').textContent = S.filters.maxCommute >= 75 ? 'Any' : '≤ ' + S.filters.maxCommute + ' min'; }
}

/** [features/tradeoff.js] Set the ranking weights from outside the rail (the trade-off pad). Same path as dragging a
 *  slider: store, re-rank, move the slider thumbs and shares, tell the views; `settled` rebuilds the rail like a slider's
 *  release does. Returns the weights now in force. */
export function setWeights(w, { settled = false } = {}) {
  S.weights = { ...S.weights, ...w }; store.set('weights', S.weights);
  rescore(); refreshRailValues(); emit('weights');
  if (settled) { renderRail(); emit('weights-settled'); }
  return S.weights;
}

// ------------------------------------------------------------------ result cards
function modesHTML(L) {
  const d = dest(); if (!d) return '';
  const m = modesOf(L, d);
  if (m.best == null) return '<div class="c-modes"><span class="faint">Commute not computed</span></div>';
  // the selected mode is outlined; the fastest is green
  const chip = (k, icon, v, label) => `<span class="mode ${m.bestMode === k ? 'best' : ''} ${m.mode === k ? 'on' : ''} ${v == null ? 'na' : ''}" title="${label}: ${v == null ? 'not computed' : Math.round(v) + ' min door to door'}">${icon}<b>${v == null ? '—' : Math.round(v)}</b></span>`;
  return `<div class="c-modes">${chip('walk', ICONS.walk, m.walk, 'Walk')}${chip('subway', ICONS.train, m.subway, 'Subway')}${chip('bus', ICONS.bus, m.bus, 'Bus')}<span class="line-bullets">${m.mode === 'walk' ? '' : m.legs ? legBadges(m.legs, 3) : bullets(m.route, 3)}</span><span class="to" title="minutes to ${esc(d.name)}">${allDests().length > 1 ? `min to ${esc(d.name)}` : 'min'}</span></div>`;
}
function mediaHTML(L, im) {
  const fx = cardMediaHTML(L, im); if (fx) return fx;   // features/media.js: ordered photo, blur-up preview, count by group
  if (im.own.length) return `<img src="${esc(im.own[0])}" alt="" loading="lazy" referrerpolicy="no-referrer"${imgFallback(L, 0)}><span class="nph">${im.own.length} photo${im.own.length > 1 ? 's' : ''}</span>`;
  if (im.building.length) return `<img src="${esc(im.building[0].url)}" alt="" loading="lazy" referrerpolicy="no-referrer"><span class="kind">Building</span>`;
  if (L.lat != null) return `${aerialHTML(L, 136, 108, 18)}<span class="kind">Aerial</span>`;
  return `<div class="glyph">${unitGlyph(L)}</div>`;
}
export function cardHTML(L, i = 0) {
  const im = imagesOf(L);
  const am = L.amenities || {}, t = tierIndex(L), saved = isSaved(L.id);
  const b = [];
  if (am.in_unit_wd) b.push('W/D');
  if (am.doorman === 'full-time') b.push('Doorman');
  if (am.gym) b.push('Gym');
  if (L.floor) b.push(`Fl ${Math.round(L.floor)}${L.exposure?.length ? ' · ' + L.exposure.join('/') : ''}`);
  const sun = L.site?.sun_hours, mi = new Date().getMonth();
  const c = commuteOf(L), route = L.commute?.[dests()[0]]?.route;
  const gate = (L.score?.gates || []).find((g) => g.startsWith('fails') || g === 'over_budget');
  const my = pick(L.id).tier, inCmp = S.compare.includes(L.id), has = (k) => (S.manifest[k] || []).includes(L.id);
  return `<article class="card ${S.sel === L.id ? 'sel' : ''} ${inCmp ? 'cmp' : ''}" data-id="${esc(L.id)}" tabindex="0" aria-label="${esc(label(L))}, ${esc(money(cost(L)))} a month${score(L) != null ? ', score ' + Math.round(score(L)) : ''}" style="animation-delay:${Math.min(i, 12) * 22}ms">
    <div class="media">${mediaHTML(L, im)}
      ${L._rank ? `<span class="rank">#${L._rank}</span>${deltaHTML(L.id)}` : ''}
      <button type="button" class="save ${saved ? 'on' : ''}" data-save="${esc(L.id)}" aria-pressed="${saved}" aria-label="${saved ? 'Remove from picks' : 'Save to picks'}">${saved ? ICONS.star : ICONS.starO}</button></div>
    <div class="c-body">
      <div class="c-top"><div style="min-width:0;flex:1"><div class="c-title">${esc(L.building || L.address)} <span>${esc(L.unit || '')}</span>${my ? ` <span class="pill accent">${esc(my)}</span>` : ''}</div>
        <div class="c-sub"><span class="t">${esc(L.neighborhood || '')}${L.sqft ? ' · ' + Math.round(L.sqft) + ' ft²' : ''}${L.beds != null ? ' · ' + (L.beds ? L.beds + ' bd' : 'Studio') : ''}</span>${trendHTML(L)}</div></div>${ring(score(L))}</div>
      <div class="c-price"><b>${money(cost(L))}</b><span class="per">/mo${L.score?.cost?.fees_estimate ? ' <abbr title="Includes estimated fees: no fee sheet yet">est.</abbr>' : ''}</span>${L.price?.gross && cost(L) && Math.abs(L.price.gross - cost(L)) > 5 ? `<span class="gross">${money(L.price.gross)} gross</span>` : ''}
        ${L.score?.budget_tier ? `<span class="tierpill" style="color:var(${t >= 0 ? TIER_VARS[t] : '--tier-over'})"><i></i>${esc(L.score.budget_tier)}</span>` : ''}</div>
      ${modesHTML(L)}
      <div class="c-badges">${gate ? `<span class="bdg bad">${esc(GATE_LABEL(gate))}</span>` : ''}${(L.score?.tags || []).map((t) => `<span class="bdg warn">${esc(t)}</span>`).join('')}${sun ? `<span class="bdg sun" title="Modelled direct sun on the window this month">${ICONS.sun}${sun[mi].toFixed(1)} h</span>` : ''}${b.map((x) => `<span class="bdg">${esc(x)}</span>`).join('')}</div>
      <div class="c-acts" role="group" aria-label="Quick actions for ${esc(label(L))}">
        <button type="button" class="qa ${inCmp ? 'on' : ''}" data-cmp="${esc(L.id)}" aria-pressed="${inCmp}" title="${inCmp ? 'In Compare: click to remove' : 'Add to Compare'}" aria-label="${inCmp ? 'Remove from Compare' : 'Add to Compare'}">${inCmp ? ICONS.check : ICONS.plus}<span>${inCmp ? 'Comparing' : 'Compare'}</span></button>
        ${has('sites') ? `<a class="qa" href="#unit/${esc(L.id)}" title="Unit 3D: the unit in its block, with the sun" aria-label="Open Unit 3D">${ICONS.cube}</a>` : ''}${has('plans') ? `<a class="qa" href="#plan/${esc(L.id)}" title="Floor plan" aria-label="Open the floor plan">${ICONS.plan}</a>` : ''}${has('dossiers') ? `<a class="qa" href="#research/records/${esc(L.id)}" title="Building records" aria-label="Open the building records">${ICONS.doc}</a>` : ''}</div>
    </div></article>`;
}
function buildingGroups(F) {
  const g = new Map();
  for (const L of F) { const k = (L.building || L.address || L.id).toLowerCase(); (g.get(k) || g.set(k, []).get(k)).push(L); }
  return [...g.values()].map((units) => ({ units: sorted(units), best: sorted(units)[0] }));
}
export function resetFilters() {
  Object.assign(S.filters, { q: '', toggles: [], savedOnly: false, maxCommute: 75, status: [...ACTIVE], over: false, nl: null, tiers: (S.crit.budget?.tiers || []).map((_, i) => i) });
  if ($('q')) $('q').value = '';
  saveFilters(); syncTrigger(); emit('filters');
}
/** Compare toggles from anywhere update the cards in place (no re-render, so hover and scroll stay put). */
function syncCompareCards() {
  document.querySelectorAll('#cards .card').forEach((c) => {
    const on2 = S.compare.includes(c.dataset.id), b = c.querySelector('[data-cmp]');
    c.classList.toggle('cmp', on2); if (!b) return;
    b.classList.toggle('on', on2); b.setAttribute('aria-pressed', on2);
    b.title = on2 ? 'In Compare: click to remove' : 'Add to Compare'; b.setAttribute('aria-label', on2 ? 'Remove from Compare' : 'Add to Compare');
    b.innerHTML = `${on2 ? ICONS.check : ICONS.plus}<span>${on2 ? 'Comparing' : 'Compare'}</span>`;
  });
}
const unitsMoreHTML = (g) => (g.units.length > 1 ? `<div class="units-more">${g.units.slice(1, 3).map((u) => `<button type="button" class="unit-row" data-open="${esc(u.id)}"><span>${esc(u.unit || label(u))}</span><span class="faint">${u.sqft ? Math.round(u.sqft) + ' ft²' : ''}</span><b>${money(cost(u))}</b><span class="mini-score" style="color:${scoreColor(score(u))}">${Math.round(score(u) ?? 0)}</span></button>`).join('')}${g.units.length > 3 ? `<span class="faint more">+ ${g.units.length - 3} more units</span>` : ''}</div>` : '');
export function renderCards() {
  const F = sorted(filtered()), el = $('cards');
  $('listTitle').innerHTML = `${F.length} ${S.group === 'buildings' ? 'homes in ' + new Set(F.map((L) => L.building)).size + ' buildings' : 'homes'} <span>· ${S.sort === 'match' ? 'ranked by your weights' : 'sorted'}</span>`;
  if (!F.length) {
    clearCardList();
    el.innerHTML = cardsEmpty({ q: S.filters.q, savedOnly: S.filters.savedOnly, hasPicks: Object.values(S.picks).some((p) => p.saved) });   // [feature C] illustrated empty state
    $('resetFilters').addEventListener('click', resetFilters); return;
  }
  // the windowed card list (features/card-list.js) renders only the cards in view, keyed by listing, and animates re-ranks
  if (S.group === 'buildings') {
    const G = buildingGroups(F).sort((a, b) => SORTS[S.sort](a.best, b.best));
    setCardItems(G.map((g) => ({ key: 'g:' + g.best.id, id: g.best.id, ids: g.units.map((u) => u.id), wrap: true, html: () => cardHTML(g.best) + unitsMoreHTML(g) })));
  } else {
    setCardItems(F.map((L) => ({ key: L.id, id: L.id, html: () => cardHTML(L) })));
  }
}

// ------------------------------------------------------------------ drawer
function legsHTML(route) {
  return String(route || '').split('→').map((x) => x.trim()).filter(Boolean).map((seg) => {
    const w = seg.match(/^walk (\d+) min to (.+)$/i), r = seg.match(/^([A-Z0-9/]{1,9}) to (.+)$/);
    if (w) return `<div class="leg"><span class="ic walk"></span><span>Walk to ${esc(w[2])}</span><span class="m">${w[1]} min</span></div>`;
    if (r) return `<div class="leg"><span class="ic">${routeNames(seg).slice(0, 3).map(bullet).join('')}</span><span>Ride to ${esc(r[2])}</span><span class="m"></span></div>`;
    return `<div class="leg"><span class="ic walk"></span><span>${esc(seg)}</span><span class="m"></span></div>`;
  }).join('');
}
const MODE_META = [['transit', 'Best', ICONS.check], ['subway', 'Subway', ICONS.train], ['bus', 'Bus', ICONS.bus], ['walk', 'Walk', ICONS.walk]];
let drawerMode = 'transit';
function legRows(legs) {
  return legs.map((l) => {
    if (l.mode === 'walk') return `<div class="leg"><span class="ic walk"></span><span>${l.to === 'destination' ? 'Walk to ' + esc(dest()?.name || 'destination') : 'Walk to ' + esc(l.to)}${l.m ? ` <span class="faint">${miles(l.m)}</span>` : ''}</span><span class="m">${Math.round(l.min)} min</span></div>`;
    if (l.mode === 'transfer') return `<div class="leg"><span class="ic walk"></span><span>Transfer${l.at ? ' at ' + esc(l.at) : ''}</span><span class="m">${Math.round(l.min)} min</span></div>`;
    return `<div class="leg ride"><span class="ic">${routeBadge(l)}</span><span>${esc(l.from)} → ${esc(l.to)}${l.board ? ` <span class="faint">${esc(l.board)}–${esc(l.alight)}</span>` : ''}${l.wait ? ` <span class="faint">· wait ${Math.round(l.wait)}</span>` : ''}</span><span class="m">${Math.round(l.min)} min</span></div>`;
  }).join('');
}
function commuteSection(L, d) {
  if (!d) return '';
  const c = commuteEntry(L, d), mo = modesOf(L, d);
  if (!c && mo.walk == null) return '';
  const stale = d._stale ? `<p class="money-note">${esc(d.name)} is new or moved in your edited criteria: transit times need <code>apartmentscout commute</code>; walking is estimated from distance.</p>` : '';
  const M = c?.modes || {};
  const avail = MODE_META.filter(([k]) => (k === 'walk' ? mo.walk != null : M[k]?.minutes != null || (k === 'transit' && c?.minutes != null)));
  if (!avail.some(([k]) => k === drawerMode)) drawerMode = avail[0]?.[0] || 'walk';
  const val = (k) => (k === 'walk' ? mo.walk : k === 'transit' ? (M.transit?.minutes ?? c?.minutes) : M[k]?.minutes);
  const sel = M[drawerMode] || (drawerMode === 'transit' ? { minutes: c?.minutes, route: c?.route } : null);
  const live = L.address ? `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(L.address)}&destination=${encodeURIComponent(d.address || `${d.lat},${d.lon}`)}&travelmode=${drawerMode === 'walk' ? 'walking' : 'transit'}` : null;
  const obs = (L.commute_observations || []).map((o) => `<div class="leg"><span class="ic walk"></span><span>${esc(o.provider || 'Checked')} ${esc(o.mode || '')}${o.departure ? ', ' + esc(o.departure) : ''}</span><span class="m">${esc(o.minutes)} min</span></div>`).join('');
  const best = Math.min(...avail.map(([k]) => val(k)).filter((v) => v != null));
  return `<div class="d-sec" id="dCommute" data-tab="Commute"><h3>Commute to ${esc(d.name)} <span>arrive ${esc(d.arrive_by || '')}${sel?.range ? ` · ${Math.round(sel.range[0])}–${Math.round(sel.range[1])} min across departures` : ''}</span></h3>
    <div class="mode-tiles" role="tablist">${avail.map(([k, n, ic]) => `<button type="button" role="tab" aria-selected="${k === drawerMode}" class="mt ${k === drawerMode ? 'on' : ''} ${val(k) === best ? 'best' : ''}" data-mode="${k}">${ic}<b>${Math.round(val(k))}<small>min</small></b><span>${n}</span></button>`).join('')}</div>
    <div class="route">${drawerMode === 'walk' ? `<div class="leg"><span class="ic walk"></span><span>Walk the whole way <span class="faint">${miles((M.walk?.m) ?? null)}</span></span><span class="m">${Math.round(mo.walk)} min</span></div>` : sel?.legs ? legRows(sel.legs) : legsHTML(sel?.route || '')}${obs}</div>
    ${sel?.transfers != null && drawerMode !== 'walk' ? `<div class="faint" style="font-size:var(--fs-xs);margin-top:8px">${sel.transfers ? sel.transfers + ' transfer' + (sel.transfers > 1 ? 's' : '') : 'One-seat ride'} · ${Math.round(sel.walk_min ?? 0)} min walking · ${Math.round(sel.ride_min ?? 0)} min riding${sel.wait_min ? ` · ${Math.round(sel.wait_min)} min waiting` : ''}</div>` : ''}
    ${stale}${live ? `<a class="d-link" href="${esc(live)}" target="_blank" rel="noopener">Check the live route ${ICONS.ext}</a>` : ''}</div>`;
}
function moneySection(L) {
  const s = L.score || {}, p = L.price || {}, c = s.cost || {}, am = L.amenities || {}, sz = L.size || {};
  const rng = c.monthly_range, open = rng && rng[1] == null;
  const sizeTxt = sz.range ? `~${Math.round(sz.range[0])}–${Math.round(sz.range[1])} ft²` : L.sqft ? Math.round(L.sqft) + ' ft²' : '—';
  const basis = { reported: 'reported', exact_plan: 'exact plan', line_band_plan: 'same-line plan', main_rooms_sum: 'main rooms only', ratio_proxy: 'estimate' }[sz.basis] || '';
  const pv0 = typeof s.ppsf === 'object' && s.ppsf ? s.ppsf.value : s.ppsf;   // v2: {value, range, basis}
  const pv = Number.isFinite(pv0) ? pv0 : null;
  const ppsf = pv ?? (L.sqft && cost(L) && (!sz.basis || ['reported', 'exact_plan'].includes(sz.basis)) ? cost(L) / L.sqft : null);
  const head = Object.entries(c.headroom || {}).map(([k, v]) => `<span class="pill ${v >= 0 ? 'good' : 'bad'}">${esc(k)} ${v >= 0 ? '+' : '−'}${money(Math.abs(v)).slice(1) ? money(Math.abs(v)) : '$0'}</span>`).join('');
  const conc = c.concession || {}, cf = cashFlow(L), mo = cf.monthly, sg = cf.signing, ls = cf.lease;
  const unk = '<span class="pill warn">unknown</span>';
  const row = (k, v, sub = '', cls = '') => `<div class="cf-row ${cls}"><span>${k}${sub ? `<small>${sub}</small>` : ''}</span><b>${v}</b></div>`;
  const feeTxt = mo.fees == null ? unk : Array.isArray(mo.fees) ? `${money(mo.fees[0])}–${money(mo.fees[1])}` : mo.fees ? money(mo.fees) : 'None';
  const bb = S.crit.budget?.basis || 'monthly_cost';
  const cn = c.concession_needed, cnT = cn && Object.entries(cn).filter(([k, v]) => /^\d+$/.test(k) && v?.rent_only_ask != null && v.rent_only_ask > 0);
  return `<div class="d-sec" id="dMoney" data-tab="Money"><h3>Money <span>${c.rent?.lease_months ? Math.round(c.rent.lease_months) + '-month lease' : 'lease term unknown'}</span></h3>
    <div class="money"><div><div class="k">Monthly cost</div><div class="v big">${money(c.monthly_expected ?? c.monthly ?? cost(L))}${c.fees_estimate ? `<small class="plus">incl. ~${money(c.fees_estimate.monthly)} est. fees</small>` : open ? '<small class="plus">+ fees?</small>' : ''}</div></div>
      <div><div class="k">Gross rent</div><div class="v">${money(c.rent?.gross ?? p.gross)}</div></div>
      <div><div class="k">${c.rent?.basis === 'conditional' ? 'Net (if eligible)' : 'Paid month'}</div><div class="v">${money(c.rent?.basis === 'conditional' ? c.rent?.illustrations?.[0]?.net : c.paid_month ?? p.gross)}</div></div></div>
    ${c.fees_estimate ? `<p class="money-note">No fee sheet yet, so ranking adds an estimate from similar buildings: ${esc(c.fees_estimate.parts.join('; '))}. Documented so far: ${money(c.monthly)}.</p>` : ''}
    ${c.rent?.basis === 'conditional' ? `<p class="money-note">Free months are advertised without a lease term, so the net depends on it: ${(c.rent.illustrations || []).map((i) => `${esc(i.lease_months)} months → ${money(i.net)}`).join(' · ')}.</p>` : ''}
    ${conc.notes?.length || conc.excluded ? `<p class="money-note">${esc([...(conc.notes || []), ...(conc.excluded ? [conc.excluded] : [])].join(' · '))}</p>` : ''}
    ${c.scenarios?.length ? `<p class="money-note">Sources disagree: ${c.scenarios.map((x) => `${esc(x.label || x.source || 'claim')} ${money(x.monthly ?? x.gross)}`).join(' vs ')} (ranked on the higher one).</p>` : ''}
    <div class="cashflow">
      <div class="cf-col"><h4>Every month <span>recurring</span></h4>
        ${row('Rent', money(mo.gross), mo.free ? 'in a month you pay' : '')}${row('Monthly fees', feeTxt, mo.fees == null ? (c.fees_estimate ? `ranking assumes ~${money(c.fees_estimate.monthly)}` : 'not added, not assumed') : '')}
        ${row('Cash each month', `${money(mo.paid ?? mo.gross)}${mo.fees == null ? '<small class="plus">+ fees</small>' : ''}`, '', 'tot')}
        ${mo.free && mo.net != null ? row('Net effective', money(mo.net), `${esc(mo.free)} month${mo.free === 1 ? '' : 's'} free, averaged`) : ''}</div>
      <div class="cf-col"><h4>At signing <span>once</span></h4>
        ${sg.lines.map(([k, v, t]) => row(esc(k), v == null ? unk : money(v), t === 'refundable' ? 'refundable' : '')).join('')}
        ${row('Documented so far', `${money(sg.total)}${sg.unknown.length ? '<small class="plus">+ unknowns</small>' : ''}`, '', 'tot')}</div></div>
    ${sg.unknown.length || mo.fees == null ? `<p class="money-note cf-unknown">Still undocumented: ${esc([...(mo.fees == null ? ['monthly fees'] : []), ...sg.unknown].join(', '))}. Ask the leasing office before you compare finalists.</p>` : ''}
    <div class="lease-total"><span class="k">Over the lease</span>${ls.term ? `<b>${money(ls.total)}</b><span class="faint">${ls.term} months${ls.assumed ? ' (assumed; lease term unknown)' : ''} · rent, known fees and one-time fees${ls.feesUnknown ? ' · monthly fees unknown' : ''} · plus a refundable deposit${ls.deposit != null ? ' of ' + money(ls.deposit) : ''}</span>`
      : `<b>${ls.options.map((o) => `${money(o.total)} <small>/ ${o.months} mo</small>`).join(' · ')}</b><span class="faint">depends on the lease term${ls.feesUnknown ? ' · monthly fees unknown' : ''}</span>`}</div>
    <div class="facts">
      <div><div class="k">Size</div><div class="v">${sizeTxt}${basis ? `<small> ${basis}</small>` : ''}</div></div><div><div class="k">$ / ft²</div><div class="v">${ppsf ? '$' + ppsf.toFixed(2) : '—'}</div></div>
      <div><div class="k">Floor</div><div class="v">${L.floor != null ? Math.round(L.floor) + (L.floor_inferred ? '?' : '') : '—'}${L.exposure?.length ? ' · ' + esc(L.exposure.join('/')) : ''}</div></div>
      <div><div class="k">W/D</div><div class="v">${am.in_unit_wd ? 'In unit' : am.in_unit_wd === false ? 'No' : '?'}</div></div><div><div class="k">Doorman</div><div class="v">${esc(am.doorman || '?')}</div></div><div><div class="k">Gym</div><div class="v">${am.gym ? 'Yes' : am.gym === false ? 'No' : '?'}</div></div><div><div class="k">Elevator</div><div class="v">${am.elevator ? 'Yes' : am.elevator === false ? 'No' : '?'}</div></div></div>
    ${head ? `<div class="headroom"><span class="faint">Headroom${bb !== 'monthly_cost' ? ' on ' + esc(basisLabel(bb)) : ''}</span>${head}</div>` : ''}
    ${cnT?.length ? `<p class="money-note">To reach ${money(cn.target)}, ask for about <b>${cnT.map(([t, v]) => `${v.rent_only_ask} free month${v.rent_only_ask === 1 ? '' : 's'} on ${t}`).join(', ')}</b> (rent only).</p>` : ''}</div>`;
}
function whySection(L) {
  const s = L.score || {}, R = reasons(L), cov = coverage(L);
  const range = s.range && s.range[0] !== s.range[1] ? `range ${Math.round(s.range[0])}–${Math.round(s.range[1])}` : '';
  return `<div class="d-sec" id="dWhy" data-tab="Why"><h3>Why it ranks here <span>${s.confidence ?? 0}% of weight known${range ? ' · ' + range : ''}</span></h3>
    <div class="reasons">${R.map((r) => { const v = s.parts?.[r.dim]; return `<details class="rsn"><summary><b class="${r.pts > 0.05 ? 'pos' : r.pts < -0.05 ? 'neg' : 'zero'}">${r.pts > 0.05 ? '+' : r.pts < -0.05 ? '−' : ''}${Math.abs(r.pts).toFixed(1)}</b><span class="lab">${esc(r.label)}</span><span class="txt">${esc(r.sentence)}</span><span class="bar ${v == null ? 'unk' : ''}"><i style="width:${v ?? 0}%;background:${scoreColor(v)}"></i></span></summary>${r.items?.length ? `<ul>${r.items.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}</details>`; }).join('')}</div>
    <div class="coverage"><div class="cov-bar">${Array.from({ length: cov.total }, (_, i) => `<i class="${i < cov.have ? 'on' : ''}"></i>`).join('')}</div><span><b>${cov.have}/${cov.total}</b> key facts evidenced${cov.missing.length ? ` · still need ${esc(cov.missing.slice(0, 4).join(', ').toLowerCase())}${cov.missing.length > 4 ? '…' : ''}` : ''}</span></div></div>`;
}
const SHARE_ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M6.8 9.2a3 3 0 004.2 0l2-2a3 3 0 00-4.2-4.2l-.9.9M9.2 6.8a3 3 0 00-4.2 0l-2 2a3 3 0 004.2 4.2l.9-.9"/></svg>';
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
/** Drawer photo carousel: scroll-snap track (touch swipes natively), arrows, dots, arrow keys and mouse drag. */
function carousel(tr, n, onIndex) {
  const idx = () => Math.round(tr.scrollLeft / Math.max(1, tr.clientWidth));
  const go = (i) => tr.scrollTo({ left: Math.max(0, Math.min(n - 1, i)) * tr.clientWidth, behavior: reducedMotion() ? 'auto' : 'smooth' });
  const prev = $('dPrev'), next = $('dNext'), dots = [...($('dDots')?.children || [])];
  let last = -1;
  const sync = () => {
    const i = idx(); if (i === last) return; last = i;
    onIndex(i);
    if (prev) prev.disabled = i <= 0;
    if (next) next.disabled = i >= n - 1;
    dots.forEach((d, j) => d.classList.toggle('on', j === i));
  };
  tr.addEventListener('scroll', sync, { passive: true });
  prev?.addEventListener('click', () => go(idx() - 1));
  next?.addEventListener('click', () => go(idx() + 1));
  tr.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); go(idx() + (e.key === 'ArrowRight' ? 1 : -1)); }
  });
  // mouse drag: scroll-snap only follows touch and trackpads, so a mouse gets a drag with a snap on release
  let drag = null;
  tr.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse' || e.button !== 0 || n < 2) return; drag = { x: e.clientX, l: tr.scrollLeft, moved: false }; tr.setPointerCapture(e.pointerId); });
  tr.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    if (!drag.moved && Math.abs(dx) > 4) { drag.moved = true; tr.classList.add('dragging'); }
    if (drag.moved) tr.scrollLeft = drag.l - dx;
  });
  const end = (e) => {
    if (!drag) return;
    const d = drag; drag = null; tr.classList.remove('dragging');
    if (!d.moved) return;
    const dx = e.clientX - d.x, i0 = Math.round(d.l / tr.clientWidth);
    go(Math.abs(dx) > tr.clientWidth * 0.12 ? i0 + (dx < 0 ? 1 : -1) : i0);
  };
  tr.addEventListener('pointerup', end); tr.addEventListener('pointercancel', end);
  sync();
}
/** Sticky section bar: a compact header (name, price, score) appears once the title scrolls away, and the
 *  section tabs jump to and follow Overview, Money, Why, Commute, Light, Records and Notes. */
function drawerChrome(dw) {
  const sc = dw.querySelector('.d-scroll'), bar = $('dBar'), nav = $('dTabs');
  const secs = [...dw.querySelectorAll('[data-tab]')];
  nav.innerHTML = secs.map((s) => `<a href="#${s.id}" data-to="${s.id}">${esc(s.dataset.tab)}</a>`).join('');
  const links = [...nav.querySelectorAll('a')];
  nav.addEventListener('click', (e) => {
    const a = e.target.closest('a'); if (!a) return;
    e.preventDefault(); e.stopPropagation();
    const t = $(a.dataset.to); if (!t) return;
    const top = t.id === 'dOverview' ? 0 : t.offsetTop - bar.offsetHeight + 1;
    pin = t;   // short last sections cannot reach the top: keep the tab that was clicked lit
    sc.scrollTo({ top, behavior: reducedMotion() ? 'auto' : 'smooth' });
    const h = t.querySelector('h3, h2'); if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); }
    spy();
  });
  let cur = null, raf = 0, pin = null;
  for (const ev of ['wheel', 'touchstart', 'keydown']) sc.addEventListener(ev, () => { pin = null; }, { passive: true });
  const spy = () => {
    raf = 0;
    const y = sc.scrollTop, stuck = y > 0 && y >= bar.offsetTop - 1;
    bar.classList.toggle('stuck', stuck);
    const line = y + bar.offsetHeight + 24;
    let on2 = secs[0];
    for (const s of secs) if (s.offsetTop <= line) on2 = s;
    if (sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 2) on2 = secs[secs.length - 1];
    if (pin) on2 = pin;
    if (on2 !== cur) {
      cur = on2;
      links.forEach((a) => { const m = a.dataset.to === on2?.id; a.classList.toggle('on', m); m ? a.setAttribute('aria-current', 'true') : a.removeAttribute('aria-current'); });
      const a = links.find((x) => x.classList.contains('on'));
      if (a && nav.scrollWidth > nav.clientWidth) nav.scrollTo({ left: a.offsetLeft - 24, behavior: 'auto' });
    }
  };
  sc.addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(spy); }, { passive: true });
  spy();
}
export function openDrawer(id, opt = {}) {
  const L = byId(id); if (!L) return;
  if (mediaTransition(id, opt, () => openDrawer(id, { ...opt, noVT: true }))) return;   // card photo grows into the hero
  const prevSel = S.sel;
  S.sel = id;
  const s = L.score || {}, p = L.price || {}, am = L.amenities || {}, rv = L.reviews || {}, rec = L.records || {};
  const im = imagesOf(L), t = tierIndex(L), d = dest();
  const slides = [...im.own.map((u) => ({ url: u, kind: 'Photo' })), ...im.building.map((b) => ({ url: b.url, kind: 'Building', b })),
    ...(L.floorplan_images || []).map(safeUrl).filter(Boolean).map((u) => ({ url: u, kind: 'Floor plan', plan: true }))].slice(0, 20);
  const route = L.commute?.[d?.name]?.route || '', sun = L.site?.sun_hours, my = pick(L.id);
  const dr = drivers(L).filter((x) => x.v != null).sort((a, b) => b.pts - a.pts);
  const cov = coverage(L);
  const hasSite = (S.manifest.sites || []).includes(L.id), hasPlan = (S.manifest.plans || []).includes(L.id), hasDos = (S.manifest.dossiers || []).includes(L.id);
  const ratings = (rv.ratings || []).slice(0, 3).map((r) => { const m = String(r.value).match(/([\d.]+)\/5\s*·?\s*(\d+)?/); const u = safeUrl(r.url); const lab = `${esc(r.label)}${m?.[2] ? ' · ' + m[2] : ''}`; return `<div><b>${m ? m[1] : esc(r.value)}</b><span>${u ? `<a href="${esc(u)}" target="_blank" rel="noopener">${lab}</a>` : lab}</span></div>`; }).join('');
  const links = Object.entries(L.links || {}).map(([k, u]) => [k, safeUrl(u)]).filter(([, u]) => u);
  const live = d && L.address ? `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(L.address)}&destination=${encodeURIComponent(d.address || `${d.lat},${d.lon}`)}&travelmode=transit` : null;
  const obs = (L.commute_observations || []).map((o) => `<div class="leg"><span class="ic walk"></span><span>${esc(o.provider || 'Checked')} ${esc(o.mode || '')}${o.departure ? ', ' + esc(o.departure) : ''}</span><span class="m">${esc(o.minutes)} min</span></div>`).join('');
  const range = s.range && s.range[0] !== s.range[1] ? `range ${Math.round(s.range[0])}–${Math.round(s.range[1])}` : '';
  // re-rendering the open listing (save, compare, tier, commute mode) keeps the reader's place
  const dw = $('drawer'), keep = prevSel === id && dw.classList.contains('open') ? { y: dw.querySelector('.d-scroll')?.scrollTop || 0, x: $('dTrack')?.scrollLeft || 0 } : null;
  const many = slides.length > 1;
  dw.setAttribute('aria-label', `Details for ${label(L)}`);
  dw.innerHTML = `<div class="d-scroll">
    <div class="d-hero">${slides.length ? `<div class="track" id="dTrack" tabindex="0" role="group" aria-roledescription="carousel" aria-label="Photos of ${esc(label(L))}${many ? ': arrow keys move between them' : ''}">${slides.map((x, i) => `<img src="${esc(x.url)}" alt="${esc(x.kind)} ${i + 1} of ${slides.length}, ${esc(label(L))}" referrerpolicy="no-referrer" draggable="false" class="${x.plan ? 'plan' : ''}" ${i > 1 ? 'loading="lazy"' : ''}${x.kind === 'Photo' ? imgFallback(L, i) : ''}>`).join('')}</div><div class="shade"></div>
        ${many ? `<button type="button" class="h-nav prev" id="dPrev" aria-label="Previous photo" disabled><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M10 3L5 8l5 5"/></svg></button><button type="button" class="h-nav next" id="dNext" aria-label="Next photo"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M6 3l5 5-5 5"/></svg></button>
        ${slides.length <= 12 ? `<div class="h-dots" id="dDots" aria-hidden="true">${slides.map((_, i) => `<i class="${i ? '' : 'on'}"></i>`).join('')}</div>` : ''}` : ''}
        <span class="count" id="dCount" aria-live="polite">1 / ${slides.length}</span><span class="credit" id="dCredit"></span>`
      : L.lat != null ? `${aerialHTML(L, 448, 232, 19)}<div class="shade"></div><span class="kind">Aerial view${L.floor ? ` · floor ${Math.round(L.floor)}` : ''}${L.exposure?.length ? ' · faces ' + esc(L.exposure.join('/')) : ''}</span>` : unitGlyph(L, 448, 232)}
      <div class="hero-btns"><button type="button" id="dShare" aria-label="Copy a link to this home" title="Copy a link to this home">${SHARE_ICON}</button><button type="button" id="dSave" aria-pressed="${!!my.saved}" aria-label="${my.saved ? 'Remove from picks' : 'Save to picks'}" title="${my.saved ? 'Saved: click to remove (s)' : 'Save to picks (s)'}" class="${my.saved ? 'on' : ''}">${my.saved ? ICONS.star : ICONS.starO}</button><button type="button" id="dClose" aria-label="Close" title="Close (Esc)">${ICONS.x}</button></div></div>
    <div class="d-head" id="dOverview" data-tab="Overview"><div class="t"><h2>${esc(L.building || L.address)} <span>${esc(L.unit || '')}</span></h2><p>${esc(L.address || '')}${L.neighborhood ? ' · ' + esc(L.neighborhood) : ''}</p></div>${ring(score(L), 64, 5)}</div>
    <div class="d-tags">${L._ranks?.fit ? `<span class="pill accent" title="Fit ranks quality on your weights; Action adds the must-haves; Budget keeps your first tier">Fit #${L._ranks.fit}${L._ranks.action ? ` · Action #${L._ranks.action}` : ''}${L._ranks.budget ? ` · Budget #${L._ranks.budget}` : ''}</span>` : ''}${s.budget_tier ? `<span class="tierpill" style="color:var(${t >= 0 ? TIER_VARS[t] : '--tier-over'});background:var(--surface-3)"><i></i>${esc(s.budget_tier)}</span>` : ''}<span class="pill">${esc(L.status || 'new')}</span>${L.stage && String(L.stage).toLowerCase() !== String(L.status || '').toLowerCase() ? `<span class="pill">${esc(L.stage)}</span>` : ''}${L.available ? `<span class="pill">Available ${esc(L.available)}</span>` : ''}${(s.gates || []).map((g) => `<span class="pill ${g.startsWith('fails') || g === 'over_budget' ? 'bad' : 'warn'}">${esc(GATE_LABEL(g))}</span>`).join('')}${(s.tags || []).map((t) => `<span class="pill warn">${esc(t)}</span>`).join('')}</div>
    <div class="d-bar" id="dBar"><div class="d-mini" aria-hidden="true"><span class="mt-t"><b>${esc(L.building || L.address)}</b> ${esc(L.unit || '')}</span><span class="mt-p">${money(cost(L))}<small>/mo</small></span><i class="mt-s" style="--c:${scoreColor(score(L))}">${score(L) == null ? '?' : Math.round(score(L))}</i><button type="button" class="mt-x" tabindex="-1" aria-hidden="true">${ICONS.x}</button></div>
      <nav class="d-tabs" id="dTabs" aria-label="Sections"></nav></div>
${moneySection(L)}
${whySection(L)}
    ${commuteSection(L, d)}
    ${sun ? `<div class="d-sec" id="dLight" data-tab="Light"><h3>Direct sun on the window <span>floor ${esc(L.site.floor)}, facing ${Math.round(L.site.bearing)}°</span></h3><div class="sunbars">${sun.map((h, i) => `<div title="${h.toFixed(1)} h possible${L.site.sun_hours_expected?.[i] != null ? ` · ${(+L.site.sun_hours_expected[i]).toFixed(1)} h expected on a typical month` : ''}"><i style="height:${Math.max(3, (h / 9) * 100)}%"></i><span>${'JFMAMJJASOND'[i]}</span></div>`).join('')}</div><div class="faint" style="font-size:var(--fs-xs);margin-top:8px">Hours of possible (clear-sky) direct sun on the 15th${L.site.sun_year?.expected != null ? ` · a year: ${Number(L.site.sun_year.possible).toLocaleString()} h possible, about ${Number(L.site.sun_year.expected).toLocaleString()} h expected with typical cloud` : ''}</div><div class="faint" style="font-size:var(--fs-xs);margin-top:4px">Skyline straight ahead ${esc(L.site.skyline_ahead_deg)}° · ${L.site.open_sky_share != null ? Math.round(L.site.open_sky_share * 100) + '% open sky in view' : ''}${L.site.sky_view != null ? ` · sky view ${Math.round(L.site.sky_view * 100)}% (overcast sky)` : ''}${L.site.daylight_factor_est != null ? ` · estimated daylight factor ≈${esc(L.site.daylight_factor_est)}%, not measured` : ''}</div></div>` : ''}
    ${rec.flags?.length ? `<div class="d-sec" id="dRecords" data-tab="Records"><h3>Public records <span>reports, not findings</span></h3>${rec.flags.slice(0, 4).map((x) => `<div class="flag">${esc(x)}</div>`).join('')}</div>` : ''}
    ${rv.summary ? `<div class="d-sec" ${rec.flags?.length ? '' : 'id="dRecords" data-tab="Records"'}><h3>Residents say</h3>${ratings ? `<div class="reviews">${ratings}</div>` : ''}<p class="muted" style="margin:0;font-size:var(--fs-sm)">${esc(rv.summary)}</p></div>` : ''}
    ${L.notes ? `<div class="d-sec" id="dNotes" data-tab="Notes"><h3>Open questions</h3><p class="muted" style="margin:0;font-size:var(--fs-sm)">${esc(L.notes)}</p></div>` : ''}
    <div class="d-sec" ${L.notes ? '' : 'id="dNotes" data-tab="Notes"'}><h3>Your notes <span>kept in this browser</span></h3>
      <div class="seg" id="dTier" role="group" aria-label="Your tier">${['S', 'A', 'B', 'C', 'Pass'].map((x) => `<button type="button" data-tier="${x}" class="${my.tier === x ? 'on' : ''}">${x}</button>`).join('')}</div>
      <textarea id="dNote" rows="3" placeholder="What you liked, what to ask, tour impressions" style="width:100%;margin-top:10px">${esc(my.note || '')}</textarea></div>
    <p class="faint" style="font-size:var(--fs-xs);padding:0 20px 18px;margin:0">Last checked ${esc(L.checked || '?')} · <span class="mono">${esc(L.id)}</span>${links.length ? ' · ' + links.map(([k, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(k)}</a>`).join(' · ') : ''}</p>
    </div>
    <div class="d-actions">${hasSite ? `<a class="btn primary" href="#unit/${esc(L.id)}">${ICONS.cube}Unit 3D</a>` : ''}${hasPlan ? `<a class="btn" href="#plan/${esc(L.id)}">${ICONS.plan}Plan</a>` : ''}${hasDos ? `<a class="btn" href="#research/records/${esc(L.id)}">${ICONS.doc}Records</a>` : ''}<button class="btn ${S.compare.includes(L.id) ? 'primary' : ''}" type="button" id="dCmp">${S.compare.includes(L.id) ? ICONS.check + 'Comparing' : ICONS.plus + 'Compare'}</button>${safeUrl(L.links?.listing) ? `<a class="btn" href="${esc(safeUrl(L.links.listing))}" target="_blank" rel="noopener">Listing ${ICONS.ext}</a>` : ''}</div>`;
  $('dCommute')?.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => { drawerMode = b.dataset.mode; const y = $('drawer').querySelector('.d-scroll').scrollTop; openDrawer(L.id); $('drawer').querySelector('.d-scroll').scrollTop = y; }));
  $('dClose').addEventListener('click', closeDrawer);
  dw.querySelector('.mt-x').addEventListener('click', closeDrawer);
  $('dShare').addEventListener('click', () => shareListing(L.id));
  $('dSave').addEventListener('click', () => { toggleSave(L.id); openDrawer(L.id); });
  $('dCmp').addEventListener('click', () => { toggleCompare(L.id); openDrawer(L.id); });
  $('dTier').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { setPick(L.id, { tier: my.tier === b.dataset.tier ? null : b.dataset.tier, saved: true }); openDrawer(L.id); }));
  $('dNote').addEventListener('change', (e) => setPick(L.id, { note: e.target.value.slice(0, 4000), saved: true }));
  const tr = $('dTrack');
  const credit = (i) => {
    const x = slides[i]; if (!x) return;
    $('dCount').textContent = `${i + 1} / ${slides.length}${x.kind !== 'Photo' ? ' · ' + x.kind : ''}`;
    const b = x.b, page = b && safeUrl(b.page), lic = b && safeUrl(b.license_url);
    $('dCredit').innerHTML = b ? `${page ? `<a href="${esc(page)}" target="_blank" rel="noopener">${esc(b.author || 'Wikimedia Commons')}</a>` : esc(b.author || '')}${b.license ? ' · ' + (lic ? `<a href="${esc(lic)}" target="_blank" rel="noopener">${esc(b.license)}</a>` : esc(b.license)) : ''}` : '';
  };
  if (tr) { credit(0); carousel(tr, slides.length, credit); if (keep?.x) tr.scrollLeft = keep.x; }
  afterDrawerMedia(dw, L, slides);   // features/media.js: blur-up per slide, full-screen viewer, group captions
  $('drawer').querySelectorAll('a[href^="#"]').forEach((a) => a.addEventListener('click', closeDrawer));
  drawerChrome(dw);
  dw.classList.toggle('fresh', !keep && !reducedMotion());
  if (opt.focus) requestAnimationFrame(() => { const h = dw.querySelector('.d-head h2'); h.tabIndex = -1; h.focus({ preventScroll: true }); });
  if (keep) dw.querySelector('.d-scroll').scrollTop = keep.y;
  $('drawer').classList.add('open');
  document.querySelectorAll('.card').forEach((c) => c.classList.toggle('sel', c.dataset.id === id));
  revealCard(id, !!opt.instant);   // scrolls the windowed list, also to a card that is not rendered yet
  emit('select', { id, fly: opt.fly });
}
export function closeDrawer() {
  // focus that was inside the drawer goes back to the card it came from, not to the top of the page
  if (S.sel && $('drawer').contains(document.activeElement)) { revealCard(S.sel, true); cardEl(S.sel)?.focus({ preventScroll: true }); }   // the card may be outside the rendered window
  S.sel = null; $('drawer').classList.remove('open');
  document.querySelectorAll('.card.sel').forEach((c) => c.classList.remove('sel'));
  emit('select', { id: null });
}

// ------------------------------------------------------------------ router
// Views load on first visit, so one that fails to load (a missing or blocked script) never blanks the app.
// Six tabs in the top bar; Tours lives under Shortlist (#list/tours) and Records under Research (#research/records/<id>).
// The old #tours and #records/<id> links are rewritten to those by parseRoute() (shell.js).
const VIEWS = { map: () => import('./map.js'), list: () => import('./list.js'), compare: () => import('./compare.js'), unit: () => import('./unit3d.js'),
  plan: () => import('./plan3d.js').then((m) => (import('./plan/tracer-ui.js').then((t) => t.attach()).catch(() => {}), m)), tours: () => import('./tours.js'), research: () => import('./research.js') };
const loaded = {};
async function viewModule(v) {
  if (!loaded[v]) loaded[v] = VIEWS[v]().then((m) => { m.init?.(); return m; });
  return loaded[v];
}
async function route() {
  const r = parseRoute(), view = r.view, arg = r.arg;
  const v = VIEWS[view] ? view : 'map', group = VIEWS[view] ? r.group : 'map';
  S.view = v; document.body.dataset.view = v; document.body.dataset.group = group; document.body.classList.remove('rail-open');
  document.querySelectorAll('.view').forEach((el) => (el.hidden = el.id !== 'view-' + v));
  document.querySelectorAll('#tabs a').forEach((a) => { a.classList.toggle('on', a.dataset.view === group); a.toggleAttribute('aria-current', a.dataset.view === group); });
  syncSubnav(v);
  if (v !== 'map' && v !== 'list') closeDrawer();
  if (v === 'map' && route.last && route.last !== 'map') renderCards();   // cards may be stale after edits in other views
  route.last = v;
  try { (await viewModule(v)).show?.(arg ? decodeURIComponent(arg) : null); } catch (e) {
    loaded[v]?.catch(() => delete loaded[v]);   // a failed import is tried again on the next visit (or Retry)
    document.getElementById('view-' + v).innerHTML = `<div class="view-pad"><div class="empty view-err" role="alert"><svg class="empty-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M12 3.5l9.5 16.5h-19z"/><path d="M12 10v4.5M12 17.2v.3"/></svg><b>This view could not load</b><span>A script this view needs did not load. Reload the page, or try again; if you opened a copy of the dashboard, check that its vendor/ and js/ folders came with it.</span><code class="mono">${esc(String(e?.message || e))}</code><button type="button" class="btn sm" data-retry>Try again</button></div></div>`;
    document.querySelector(`#view-${v} [data-retry]`)?.addEventListener('click', () => { document.getElementById('view-' + v).innerHTML = ''; route(); });
  }
}

function setupKeys() {
  addEventListener('keydown', (e) => {
    const tag = e.target.tagName;
    if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); return; }
    if (e.key === 'Escape') { if (document.querySelector('.kbd-help')) document.querySelector('.kbd-help').remove(); else closeDrawer(); document.body.classList.remove('rail-open'); return; }
    if ((['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) && !e.target.readOnly) || e.target.isContentEditable || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === '/') { e.preventDefault(); openPalette(); return; }
    if ((e.key === 'j' || e.key === 'k') && S.view === 'map') {
      const cs = cardIds(); if (!cs.length) return;   // the whole list, not only the cards currently rendered
      const i = cardPos(S.sel) ?? -1, n = Math.max(0, Math.min(cs.length - 1, i + (e.key === 'j' ? 1 : -1)));
      openDrawer(cs[i < 0 ? 0 : n], { fly: true }); return;
    }
    if (e.key === 's' && S.sel) { toggleSave(S.sel); openDrawer(S.sel); return; }
    if (e.key === 'c' && S.sel) { toggleCompare(S.sel); openDrawer(S.sel); return; }
    if (e.key === 't') { flipTheme(); return; }
    const views = ['map', 'list', 'compare', 'unit', 'plan', 'research'];
    if (/^[1-6]$/.test(e.key)) { location.hash = views[+e.key - 1]; return; }
    if (e.key === '?') {
      if (!dispatchEvent(new CustomEvent('as:cheatsheet', { cancelable: true }))) return;   // [feature C] the searchable cheat sheet (features/keys.js) answers this; the list below is the fallback
      const old = document.querySelector('.kbd-help'); if (old) { old.remove(); return; }
      const el = document.createElement('div'); el.className = 'kbd-help'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Keyboard shortcuts');
      el.innerHTML = `<div class="panel"><h3>Keyboard</h3><dl>${[['⌘K /', 'Search homes, views and actions'], ['j k', 'Next or previous listing'], ...(S.view === 'map' ? [['↑ ↓ Home End', 'Move through the result cards']] : []), ['s', 'Save the open listing'], ['c', 'Add it to compare'], ['1–6', 'Switch view'], ['t', 'Light or dark'], ['Esc', 'Close'], ...(S.view === 'plan' ? [['R', 'Turn the selected piece'], ['← →', 'Nudge 1 in (Shift 6 in)'], ['D', 'Duplicate'], ['Del', 'Remove'], ['⌘Z', 'Undo'], ['W A S D', 'Walk mode']] : []), ...(S.view === 'unit' ? [['p', 'Play or pause the day'], [', .', 'Step 15 minutes']] : [])].map(([k, t]) => `<dt>${k.split(' ').map((x) => `<kbd>${x}</kbd>`).join(' ')}</dt><dd style="margin:0">${t}</dd>`).join('')}</dl></div>`;
      el.addEventListener('click', () => el.remove()); document.body.append(el);
    }
  });
}

async function boot() {
  const qs = new URLSearchParams(location.search);
  S.base = qs.get('data') || 'data';
  loadPreviews(getJSON, S.base);   // features/lqip.js: blur-up previews load beside the main data, not inside it
  const [listings, crit, manifest, notes] = await Promise.all([
    getJSON(`${S.base}/listings.json`, []), getJSON(`${S.base}/criteria.json`, {}), getJSON(`${S.base}/manifest.json`, {}), getJSON(`${S.base}/notes.json`, {}),
  ]);
  Object.assign(S, { listings, crit, manifest, notes, crit0: crit });
  for (const L of listings) L._score0 = L.score;   // the scorer's result; a browser preview never overwrites it
  if (crit.scoring?.dimensions?.length) DIMS.splice(0, DIMS.length, ...crit.scoring.dimensions);
  const cm = store.get(searchKey('commute'), null);
  if (cm) { if (MODE_LABEL[cm.mode]) S.commuteMode = cm.mode; S.destName = cm.dest || null; }
  const qm = qs.get('mode'); if (MODE_LABEL[qm]) S.commuteMode = qm;
  drawerMode = S.commuteMode === 'best' ? 'transit' : S.commuteMode;
  S.weights = { ...(crit.weights || {}), ...(store.get('weights', null) || {}) };
  S.preset = store.get('preset', null) || crit.scoring?.preset || null;
  const saved = store.get('filters2', null);
  if (saved) Object.assign(S.filters, saved);
  if (S.filters.tiers == null) S.filters.tiers = (crit.budget?.tiers || []).map((_, i) => i);
  S.filters.q = '';
  const lines = (manifest.layers || []).find((n) => n.startsWith('transit'));
  if (lines) {
    const g = await getJSON(`${S.base}/layers/${lines}`, null);
    S.transit = g;
    for (const f of g?.features || []) if (f.properties.kind === 'line') for (const r of f.properties.routes) LINE_COLORS[r] = f.properties.color;
  }
  $('searchName').textContent = crit.search?.name || 'Your search';
  document.title = crit.search?.name ? `${crit.search.name} · ApartmentScout` : 'ApartmentScout';
  initTheme();
  const prof = store.get(searchKey('criteria'), null);
  if (prof) { try { applyCriteria(prof, { quiet: true }); } catch { store.set(searchKey('criteria'), null); S.crit = S.crit0; for (const L of listings) L.score = L._score0; } }
  if (!allDests().some((d) => d.name === S.destName)) S.destName = allDests()[0]?.name || null;
  fitMode(false);
  $('searchSwitch').setAttribute('aria-haspopup', 'menu'); $('searchSwitch').setAttribute('aria-expanded', 'false');
  for (const id of ['searchSwitch', 'searchMenuBtn']) $(id)?.addEventListener('click', async () => (await import('./onboarding.js')).openSearchMenu($(id)));
  renderSearchSwitch();
  rescore(); initResults(); renderRail(); renderKPIs(); renderCards();
  on('filters', (o) => { renderKPIs(); renderCards(); if (!o?.quiet) renderRail(); });
  // weight sliders fire on every pixel: coalesce to one render per frame, and render the full card list once the drag settles
  let wRaf = 0, wTimer = 0;
  on('weights', () => {
    cancelAnimationFrame(wRaf); wRaf = requestAnimationFrame(() => { renderKPIs(); if (S.view === 'map') renderCards(); });
    clearTimeout(wTimer); wTimer = setTimeout(() => emit('weights-settled'), 220);
  });
  // tab counters pulse when they change, so a save or compare from a card visibly lands in its tab
  const bump = (el, n) => { if (el.textContent !== String(n) && !el.hidden && n) { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); } el.hidden = !n; el.textContent = n; };
  on('saved', () => { renderCards(); bump($('savedCount'), Object.values(S.picks).filter((p) => p.saved).length); });
  on('compare', () => { bump($('cmpCount'), S.compare.length); syncCompareCards(); });
  emit('compare'); emit('saved');
  // the top-bar search box opens the command palette; the text filter it sets shows here with a clear button
  initPalette(); initEnhance(); initMedia({ S, loadJSON, openDrawer, label });
  initDestPin();
  import('./features/index.js').then((m) => m.initFeatures()).catch((e) => console.warn('features unavailable', e));   // [features] decision workflow
  const q = $('q'), openQ = (seed = '') => openPalette(seed || S.filters.q || '');
  q.addEventListener('click', () => openQ());
  q.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); openQ(); }
    else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); openPalette(e.key); }
    else if ((e.key === 'Backspace' || e.key === 'Delete') && S.filters.q) { q.value = ''; setFilter('q', ''); syncTrigger(); }
  });
  $('qClear')?.addEventListener('click', (e) => { e.stopPropagation(); q.value = ''; setFilter('q', ''); syncTrigger(); });
  $('plBtn')?.addEventListener('click', () => openQ());
  const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  document.querySelectorAll('.cmdk kbd, #plBtn kbd').forEach((k) => (k.textContent = mac ? '⌘K' : 'Ctrl K'));
  syncTrigger();
  $('sortSel').addEventListener('change', (e) => { S.sort = e.target.value; renderCards(); emit('sort'); });
  $('groupSeg').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { S.group = b.dataset.g; $('groupSeg').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); renderCards(); }));
  $('csvBtn').addEventListener('click', exportCSV);
  $('filtersBtn').addEventListener('click', () => document.body.classList.toggle('rail-open'));
  setupKeys();
  initShell(); syncSubnav();
  addEventListener('hashchange', route);
  await route();
  viewModule('map');   // the map keeps pins in sync even while another view is open
  import('./onboarding.js').then((m) => m.initOnboarding()).catch(() => {});   // empty state, ?new=1
  if (qs.get('open')) openDrawer(qs.get('open'), { fly: true, instant: true });
  import('./features/extras.js').then((m) => m.initExtras()).catch((e) => console.warn('feature extras unavailable', e));   // [feature C] undo, chords, cheat sheet, plain-language search, coach marks, settings
  import('./pwa.js').then((m) => m.initPwa()).catch(() => {});   // [pwa] installable app: service worker, update prompt, Install item
}
boot();
// [feature C] seams for ./features/*: the rail redraw and the feature list the filters offer
export { renderRail };

