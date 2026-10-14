// ApartmentScout dashboard core: data loading, shared state, live ranking, filters rail, result cards,
// listing drawer, saved picks, router, theme and keyboard shortcuts. Views live in their own modules and
// talk to the core through the exports below and the event bus (on/emit).
import { $, esc, money, moneyShort, safeUrl, scoreColor, ring, unitGlyph, bullets, bullet, routeNames, ICONS, toast, LINE_COLORS, aerialHTML, imagesOf, walkMinutes } from './util.js';

export const store = {
  get(k, d) { try { const v = localStorage.getItem('as:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('as:' + k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};

export const ACTIVE = ['new', 'researching', 'shortlist', 'touring', 'applied'];
export const STATUSES = [['new', 'New'], ['researching', 'Researching'], ['shortlist', 'Shortlist'], ['touring', 'Touring'], ['applied', 'Applied'], ['rejected', 'Rejected'], ['gone', 'Gone']];
export const DIMS = [['cost', 'Cost'], ['space', 'Space'], ['commute', 'Commute'], ['amenities', 'Amenities'], ['light_view', 'Light & view'], ['building', 'Building'], ['quiet', 'Quiet']];
export const TIER_VARS = ['--tier-1', '--tier-2', '--tier-3'];
const FEATURES = [
  ['in_unit_wd', 'In-unit washer/dryer'], ['elevator', 'Elevator'], ['doorman', 'Full-time doorman'], ['gym', 'Gym'],
  ['floor10', 'Floor 10 or higher'], ['sized', 'Size known'], ['light', 'Light model'], ['dishwasher', 'Dishwasher'], ['roof_deck', 'Roof deck'], ['pets', 'Pets allowed'],
];

export const S = {
  listings: [], crit: {}, manifest: {}, notes: {}, base: 'data',
  filters: { q: '', tiers: null, over: false, maxCommute: 75, toggles: [], status: ACTIVE, savedOnly: false },
  weights: {}, compare: store.get('compare', []), picks: store.get('picks', {}),
  sel: null, sort: 'match', group: 'units', view: 'map', listeners: {},
};
export const on = (ev, fn) => ((S.listeners[ev] ||= []).push(fn));
export const emit = (ev, x) => (S.listeners[ev] || []).forEach((f) => f(x));
export const byId = (id) => S.listings.find((L) => L.id === id);
export const dests = () => (S.crit.commute?.destinations || []).map((d) => d.name);
export const dest = () => S.crit.commute?.destinations?.[0];
export const commuteOf = (L, d = dests()[0]) => L.commute?.[d]?.minutes;
export const label = (L) => `${L.building || L.address}${L.unit ? ' ' + L.unit : ''}`;
export const cost = (L) => L.score?.monthly_cost;
export const score = (L) => L._s ?? L.score?.overall;
/** Door-to-door minutes by mode for a listing and destination: walk / subway / bus / best, from the router when it
 *  computed modes, else walk from distance and the stored transit time as subway. */
export function modesOf(L, d = dest()) {
  const c = L.commute?.[d?.name] || {}, m = c.modes || {};
  const routerWalk = c.mode === 'walk' ? c.minutes : null;   // the router found walking faster than any train
  const walk = m.walk?.minutes ?? routerWalk ?? walkMinutes(L.lat, L.lon, d?.lat, d?.lon, (S.crit.commute?.transit?.walk_speed_kmh) || 4.8);
  const subway = m.subway?.minutes ?? (c.mode === 'walk' ? null : c.minutes ?? null);
  const bus = m.bus?.minutes ?? null;
  const opts = [['walk', walk], ['subway', subway], ['bus', bus]].filter(([, v]) => v != null).sort((x, y) => x[1] - y[1]);
  return { walk, subway, bus, best: opts[0]?.[1] ?? null, bestMode: opts[0]?.[0] ?? null, route: m.transit?.route || m.subway?.route || c.route };
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
  [...S.listings].filter((L) => L.score?.eligible).sort((a, b) => b._s - a._s).forEach((L, i) => (L._rank = i + 1));
  S.listings.filter((L) => !L.score?.eligible).forEach((L) => (L._rank = null));
}
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
    ['Commute', commuteOf(L) != null], ['Building records', !!L.records?.flags || (S.manifest.dossiers || []).includes(L.id)], ['Reviews', !!L.reviews?.summary],
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
export function filtered() {
  const f = S.filters, q = f.q.trim().toLowerCase(), cap = tierCap(), st = new Set(f.status);
  return S.listings.filter((L) => {
    if (!st.has(L.status || 'new')) return false;
    if (f.savedOnly && !isSaved(L.id)) return false;
    if (q && !`${L.building} ${L.unit} ${L.address} ${L.neighborhood}`.toLowerCase().includes(q)) return false;
    if (cap != null && (cost(L) == null || cost(L) > cap)) return false;
    if (f.maxCommute < 75 && commuteOf(L) != null && commuteOf(L) > f.maxCommute) return false;
    for (const k of f.toggles) if (!featureOk(L, k)) return false;
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
  download(`apartmentscout-picks-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ version: 1, search: S.crit.search?.name, picks: S.picks }, null, 1), 'application/json');
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
    [`commute_${dests()[0] || ''}`, (L) => commuteOf(L)?.toFixed(0)], ['in_unit_wd', (L) => L.amenities?.in_unit_wd], ['doorman', (L) => L.amenities?.doorman], ['gym', (L) => L.amenities?.gym],
    ['saved', (L) => (isSaved(L.id) ? 'yes' : '')], ['my_tier', (L) => pick(L.id).tier], ['my_note', (L) => pick(L.id).note], ['checked', (L) => L.checked], ['listing_url', (L) => safeUrl(L.links?.listing)]];
  const q = (v) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const rows = sorted(filtered()).map((L) => cols.map(([, f]) => q(f(L))).join(','));
  download(`apartmentscout-${new Date().toISOString().slice(0, 10)}.csv`, [cols.map((c) => c[0]).join(','), ...rows].join('\n'), 'text/csv');
  toast(`Exported ${rows.length} listings`);
}

async function getJSON(p, fallback) {
  // standalone builds embed every data file so the page also works when opened as a file
  const emb = window.__AS_DATA__;
  if (emb) return p in emb ? emb[p] : fallback;
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
  $('kpis').innerHTML = [
    [`${S.listings.length}<small>${act.length} active</small>`, 'tracked'], [`${F.length}`, 'match filters'], [`${elig.length}`, 'eligible'],
    [`${short}`, 'shortlisted'], [`${money(median(F.map(cost)))}`, 'median / mo'], [mc != null ? `${Math.round(mc)}<small>min</small>` : '—', `median to ${esc(dests()[0] || 'work')}`],
  ].map(([v, k]) => `<div class="kpi"><span class="v">${v}</span><span class="k">${k}</span></div>`).join('') +
    (top ? `<div class="kpi"><span class="k">Top match</span><a href="#" data-open="${esc(top.id)}">${esc(label(top))}</a></div>` : '') +
    `<span class="spacer"></span><span class="gen" title="Listings come from the sources your agent swept; this is not a census of the market.">${S.manifest.generated ? 'Data built ' + esc(S.manifest.generated.slice(0, 10)) : 'No data yet: run apartmentscout build'}${noGeo ? ` · ${noGeo} awaiting coordinates` : ''} · not a market census</span>`;
  $('kpis').querySelector('[data-open]')?.addEventListener('click', (e) => { e.preventDefault(); openDrawer(e.currentTarget.dataset.open, { fly: true }); });
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
  const tiers = S.crit.budget?.tiers || [], f = S.filters;
  const act = S.listings.filter((L) => f.status.includes(L.status || 'new'));
  const cnt = (fn) => act.filter(fn).length;
  const sel = new Set(f.tiers || []);
  const cap = tierCap();
  const tot = Object.values(S.weights).reduce((a, b) => a + b, 0) || 1;
  const costs = act.map(cost).filter((v) => v != null).sort((a, b) => a - b);
  const lo = Math.floor((costs[Math.floor(costs.length * 0.02)] || 2000) / 250) * 250, hi = Math.ceil((costs[Math.floor(costs.length * 0.98)] || 8000) / 250) * 250;
  const d = S.crit.commute?.destinations?.[0];
  const must = new Set(S.crit.must_have || []);
  $('rail').innerHTML = `
    ${tiers.length ? `<div class="sec"><div class="sec-h"><h3>Budget</h3><button class="reset" type="button" data-reset="tiers">${f.over || !sel.size ? 'Within budget' : 'Any price'}</button></div>
      <div class="tiers">${tiers.map((t, i) => `<button type="button" class="tier ${sel.has(i) ? 'on' : ''}" data-tier="${i}" aria-pressed="${sel.has(i)}"><b><i style="background:var(${TIER_VARS[i] || '--tier-3'})"></i>≤ ${money(t.max)}</b><span>${esc(t.name)} · ${cnt((L) => cost(L) != null && cost(L) <= t.max)}</span></button>`).join('')}
        <button type="button" class="tier ${f.over ? 'on' : ''}" data-over aria-pressed="${f.over}"><b><i style="background:var(--tier-over)"></i>Over</b><span>${cnt((L) => cost(L) > (S.crit.budget?.hard_max ?? 1e9))} over the cap</span></button></div>
      <div class="range"><div class="range-h"><span>Monthly cost, net of concessions</span><b>${cap ? '≤ ' + money(cap) : 'Any'}</b></div>${hist(costs, lo, hi, 36, cap)}</div></div>` : ''}
    ${d ? `<div class="sec"><div class="sec-h"><h3>Commute</h3><span class="faint" style="font-size:var(--fs-xs)">to ${esc(d.name)}</span></div>
      <div class="range-h"><span>Door to door, arrive ${esc(d.arrive_by || '')}</span><b id="comVal">${f.maxCommute >= 75 ? 'Any' : '≤ ' + f.maxCommute + ' min'}</b></div>
      ${hist(act.map((L) => commuteOf(L)), 0, 60, 30, f.maxCommute < 75 ? f.maxCommute : null)}
      <input type="range" id="rCom" min="5" max="75" value="${f.maxCommute}" style="${pct(f.maxCommute, 5, 75)}" aria-label="Maximum commute in minutes"></div>` : ''}
    <div class="sec"><div class="sec-h"><h3>Must-haves and features</h3>${f.toggles.length ? '<button class="reset" type="button" data-reset="toggles">Clear</button>' : ''}</div>
      <div class="toggles">${FEATURES.map(([k, t]) => `<label class="tg ${f.toggles.includes(k) ? 'on' : ''}" data-tg="${k}" role="switch" aria-checked="${f.toggles.includes(k)}" tabindex="0"><span class="switch"></span><span class="lbl">${t}</span>${must.has(k) ? '<span class="tag">must</span>' : ''}<span class="n">${cnt((L) => featureOk(L, k))}</span></label>`).join('')}
      <label class="tg ${f.savedOnly ? 'on' : ''}" data-saved role="switch" aria-checked="${f.savedOnly}" tabindex="0"><span class="switch"></span><span class="lbl">Saved picks only</span><span class="n">${Object.values(S.picks).filter((p) => p.saved).length}</span></label></div></div>
    <div class="sec"><div class="sec-h"><h3>Status</h3></div>
      <div class="chips">${STATUSES.map(([k, t]) => `<button type="button" class="chip ${f.status.includes(k) ? 'on' : ''}" data-st="${k}" aria-pressed="${f.status.includes(k)}">${t}<span class="n">${S.listings.filter((L) => (L.status || 'new') === k).length}</span></button>`).join('')}</div></div>
    <div class="sec"><div class="sec-h"><h3>Ranking weights</h3><button class="reset" type="button" data-reset="weights">Reset</button></div>
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
  R.querySelectorAll('[data-w]').forEach((r) => r.addEventListener('input', () => { S.weights[r.dataset.w] = +r.value; store.set('weights', S.weights); rescore(); refreshRailValues(); emit('weights'); }));
  R.querySelector('[data-reset=weights]').addEventListener('click', () => { S.weights = { ...(S.crit.weights || {}) }; store.set('weights', null); rescore(); renderRail(); emit('weights'); });
  R.querySelector('[data-reset=tiers]')?.addEventListener('click', () => { S.filters.over = false; setFilter('tiers', (S.filters.over || !(S.filters.tiers || []).length) ? tiers.map((_, i) => i) : []); });
  R.querySelector('[data-reset=toggles]')?.addEventListener('click', () => setFilter('toggles', []));
  $('rCom')?.addEventListener('input', (e) => { S.filters.maxCommute = +e.target.value; saveFilters(); refreshRailValues(); emit('filters', { quiet: true }); });
  $('rCom')?.addEventListener('change', () => renderRail());
  $('dlCrit').addEventListener('click', (e) => {
    e.preventDefault();
    download('weights.yaml', `# paste under criteria.yaml\nweights:\n${DIMS.map(([k]) => `  ${k}: ${S.weights[k] || 0}`).join('\n')}\n`, 'text/yaml');
  });
}
function refreshRailValues() {
  const tot = Object.values(S.weights).reduce((a, b) => a + b, 0) || 1;
  document.querySelectorAll('[data-w]').forEach((r) => { r.style.setProperty('--p', `${(r.value / 40) * 100}%`); r.parentElement.querySelector('b').textContent = Math.round(((S.weights[r.dataset.w] || 0) / tot) * 100) + '%'; });
  const rc = $('rCom'); if (rc) { rc.style.setProperty('--p', `${((rc.value - 5) / 70) * 100}%`); $('comVal').textContent = S.filters.maxCommute >= 75 ? 'Any' : '≤ ' + S.filters.maxCommute + ' min'; }
}

// ------------------------------------------------------------------ result cards
function modesHTML(L) {
  const d = dest(); if (!d) return '';
  const m = modesOf(L, d);
  if (m.best == null) return '<div class="c-modes"><span class="faint">Commute not computed</span></div>';
  const chip = (k, icon, v, label) => `<span class="mode ${m.bestMode === k ? 'best' : ''} ${v == null ? 'na' : ''}" title="${label}: ${v == null ? 'not computed' : Math.round(v) + ' min door to door'}">${icon}<b>${v == null ? '—' : Math.round(v)}</b></span>`;
  return `<div class="c-modes">${chip('walk', ICONS.walk, m.walk, 'Walk')}${chip('subway', ICONS.train, m.subway, 'Subway')}${chip('bus', ICONS.bus, m.bus, 'Bus')}<span class="line-bullets">${bullets(m.route, 3)}</span><span class="to">min to ${esc(d.name)}</span></div>`;
}
function mediaHTML(L, im) {
  if (im.own.length) return `<img src="${esc(im.own[0])}" alt="" loading="lazy" referrerpolicy="no-referrer"><span class="nph">${im.own.length} photo${im.own.length > 1 ? 's' : ''}</span>`;
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
  const my = pick(L.id).tier;
  return `<article class="card ${S.sel === L.id ? 'sel' : ''}" data-id="${esc(L.id)}" tabindex="0" style="animation-delay:${Math.min(i, 12) * 22}ms">
    <div class="media">${mediaHTML(L, im)}
      ${L._rank ? `<span class="rank">#${L._rank}</span>` : ''}
      <button type="button" class="save ${saved ? 'on' : ''}" data-save="${esc(L.id)}" aria-pressed="${saved}" aria-label="${saved ? 'Remove from picks' : 'Save to picks'}">${saved ? ICONS.star : ICONS.starO}</button></div>
    <div class="c-body">
      <div class="c-top"><div style="min-width:0;flex:1"><div class="c-title">${esc(L.building || L.address)} <span>${esc(L.unit || '')}</span>${my ? ` <span class="pill accent">${esc(my)}</span>` : ''}</div>
        <div class="c-sub">${esc(L.neighborhood || '')}${L.sqft ? ' · ' + Math.round(L.sqft) + ' ft²' : ''}${L.beds != null ? ' · ' + (L.beds ? L.beds + ' bd' : 'Studio') : ''}</div></div>${ring(score(L))}</div>
      <div class="c-price"><b>${money(cost(L))}</b><span class="per">/mo</span>${L.price?.gross && cost(L) && Math.abs(L.price.gross - cost(L)) > 5 ? `<span class="gross">${money(L.price.gross)} gross</span>` : ''}
        ${L.score?.budget_tier ? `<span class="tierpill" style="color:var(${t >= 0 ? TIER_VARS[t] : '--tier-over'})"><i></i>${esc(L.score.budget_tier)}</span>` : ''}</div>
      ${modesHTML(L)}
      <div class="c-badges">${gate ? `<span class="bdg bad">${gate === 'over_budget' ? 'Over budget' : 'No ' + esc((gate.split(':')[1] || '').replaceAll('_', ' '))}</span>` : ''}${sun ? `<span class="bdg sun" title="Modelled direct sun on the window this month">${ICONS.sun}${sun[mi].toFixed(1)} h</span>` : ''}${b.map((x) => `<span class="bdg">${esc(x)}</span>`).join('')}</div>
    </div></article>`;
}
function buildingGroups(F) {
  const g = new Map();
  for (const L of F) { const k = (L.building || L.address || L.id).toLowerCase(); (g.get(k) || g.set(k, []).get(k)).push(L); }
  return [...g.values()].map((units) => ({ units: sorted(units), best: sorted(units)[0] }));
}
let shown = 60;
export function renderCards() {
  const F = sorted(filtered()), el = $('cards');
  $('listTitle').innerHTML = `${F.length} ${S.group === 'buildings' ? 'homes in ' + new Set(F.map((L) => L.building)).size + ' buildings' : 'homes'} <span>· ${S.sort === 'match' ? 'ranked by your weights' : 'sorted'}</span>`;
  if (!F.length) { el.innerHTML = `<div class="empty" style="margin:16px"><b>No homes match</b>Loosen a filter on the left, or include more statuses.</div>`; return; }
  if (S.group === 'buildings') {
    const G = buildingGroups(F).sort((a, b) => SORTS[S.sort](a.best, b.best));
    el.innerHTML = G.slice(0, shown).map((g, i) => cardHTML(g.best, i) + (g.units.length > 1 ? `<div class="units-more">${g.units.slice(1, 3).map((u) => `<button type="button" class="unit-row" data-open="${esc(u.id)}"><span>${esc(u.unit || label(u))}</span><span class="faint">${u.sqft ? Math.round(u.sqft) + ' ft²' : ''}</span><b>${money(cost(u))}</b><span class="mini-score" style="color:${scoreColor(score(u))}">${Math.round(score(u) ?? 0)}</span></button>`).join('')}${g.units.length > 3 ? `<span class="faint more">+ ${g.units.length - 3} more units</span>` : ''}</div>` : '')).join('');
  } else {
    el.innerHTML = F.slice(0, shown).map(cardHTML).join('') + (F.length > shown ? `<button type="button" class="btn ghost more-btn" id="moreBtn">Show ${Math.min(60, F.length - shown)} more of ${F.length - shown}</button>` : '');
  }
  el.querySelectorAll('.card').forEach((c) => {
    c.addEventListener('click', (e) => { if (e.target.closest('[data-save]')) return; openDrawer(c.dataset.id, { fly: true }); });
    c.addEventListener('keydown', (e) => { if (e.key === 'Enter') openDrawer(c.dataset.id, { fly: true }); });
    c.addEventListener('mouseenter', () => emit('hover', c.dataset.id));
    c.addEventListener('mouseleave', () => emit('hover', null));
  });
  el.querySelectorAll('[data-save]').forEach((b) => b.addEventListener('click', () => toggleSave(b.dataset.save)));
  el.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => openDrawer(b.dataset.open, { fly: true })));
  $('moreBtn')?.addEventListener('click', () => { shown += 60; renderCards(); });
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
export function openDrawer(id, opt = {}) {
  const L = byId(id); if (!L) return;
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
  $('drawer').innerHTML = `<div class="d-scroll">
    <div class="d-hero">${slides.length ? `<div class="track" id="dTrack">${slides.map((x, i) => `<img src="${esc(x.url)}" alt="${esc(x.kind)} ${i + 1} of ${esc(label(L))}" referrerpolicy="no-referrer" class="${x.plan ? 'plan' : ''}" ${i > 1 ? 'loading="lazy"' : ''}>`).join('')}</div><div class="shade"></div><span class="count" id="dCount">1 / ${slides.length}</span><span class="credit" id="dCredit"></span>`
      : L.lat != null ? `${aerialHTML(L, 448, 232, 19)}<div class="shade"></div><span class="kind">Aerial view${L.floor ? ` · floor ${Math.round(L.floor)}` : ''}${L.exposure?.length ? ' · faces ' + esc(L.exposure.join('/')) : ''}</span>` : unitGlyph(L, 448, 232)}
      <div class="hero-btns"><button type="button" id="dSave" aria-pressed="${!!my.saved}" aria-label="${my.saved ? 'Remove from picks' : 'Save to picks'}" style="${my.saved ? 'color:var(--fav)' : ''}">${my.saved ? ICONS.star : ICONS.starO}</button><button type="button" id="dClose" aria-label="Close">${ICONS.x}</button></div></div>
    <div class="d-head"><div class="t"><h2>${esc(L.building || L.address)} <span>${esc(L.unit || '')}</span></h2><p>${esc(L.address || '')}${L.neighborhood ? ' · ' + esc(L.neighborhood) : ''}</p></div>${ring(score(L), 64, 5)}</div>
    <div class="d-tags">${s.budget_tier ? `<span class="tierpill" style="color:var(${t >= 0 ? TIER_VARS[t] : '--tier-over'});background:var(--surface-3)"><i></i>${esc(s.budget_tier)}</span>` : ''}<span class="pill">${esc(L.status || 'new')}</span>${L.stage ? `<span class="pill">${esc(L.stage)}</span>` : ''}${L.available ? `<span class="pill">Available ${esc(L.available)}</span>` : ''}${L._rank ? `<span class="pill accent">Rank ${L._rank} of ${S.listings.filter((x) => x.score?.eligible).length}</span>` : ''}${(s.gates || []).map((g) => `<span class="pill ${g.startsWith('fails') || g === 'over_budget' ? 'bad' : 'warn'}">${esc({ over_budget: 'Over budget', unknown_cost: 'Cost unknown' }[g] || g.replace(':', ': ').replaceAll('_', ' '))}</span>`).join('')}</div>
    <div class="d-sec"><h3>Money <span>${p.lease_months || 12}-month lease</span></h3>
      <div class="money"><div><div class="k">Monthly cost</div><div class="v big">${money(cost(L))}</div></div><div><div class="k">Gross rent</div><div class="v">${money(p.gross)}</div></div><div><div class="k">Free months</div><div class="v">${p.free_months || 0}</div></div></div>
      <div class="facts"><div><div class="k">Size</div><div class="v">${L.sqft ? Math.round(L.sqft) + ' ft²' : '—'}</div></div><div><div class="k">$ / ft²</div><div class="v">${L.sqft && cost(L) ? '$' + (cost(L) / L.sqft).toFixed(2) : '—'}</div></div><div><div class="k">Floor</div><div class="v">${L.floor != null ? Math.round(L.floor) + (L.floor_inferred ? '?' : '') : '—'}${L.exposure?.length ? ' · ' + esc(L.exposure.join('/')) : ''}</div></div><div><div class="k">Fees / mo</div><div class="v">${p.fees_monthly != null ? money(p.fees_monthly) : '—'}</div></div>
        <div><div class="k">W/D</div><div class="v">${am.in_unit_wd ? 'In unit' : am.in_unit_wd === false ? 'No' : '?'}</div></div><div><div class="k">Doorman</div><div class="v">${esc(am.doorman || '?')}</div></div><div><div class="k">Gym</div><div class="v">${am.gym ? 'Yes' : am.gym === false ? 'No' : '?'}</div></div><div><div class="k">Elevator</div><div class="v">${am.elevator ? 'Yes' : am.elevator === false ? 'No' : '?'}</div></div></div></div>
    <div class="d-sec"><h3>Why it ranks here <span>${s.confidence ?? 0}% of weight known${range ? ' · ' + range : ''}</span></h3>
      <div class="drivers">${dr.slice(0, 3).map((x) => `<span class="pill good">+${x.pts.toFixed(1)} ${esc(x.n)}</span>`).join('')}${dr.slice(-2).filter((x) => x.pts < 0).map((x) => `<span class="pill bad">${x.pts.toFixed(1)} ${esc(x.n)}</span>`).join('')}</div>
      <div class="dims">${DIMS.map(([k, n]) => { const v = s.parts?.[k]; return `<span>${n}</span><span class="bar ${v == null ? 'unk' : ''}"><i style="width:${v ?? 0}%;background:${scoreColor(v)}"></i></span><b>${v == null ? '?' : Math.round(v)}</b>`; }).join('')}</div>
      <div class="coverage"><div class="cov-bar">${Array.from({ length: cov.total }, (_, i) => `<i class="${i < cov.have ? 'on' : ''}"></i>`).join('')}</div><span><b>${cov.have}/${cov.total}</b> key facts evidenced${cov.missing.length ? ` · still need ${esc(cov.missing.slice(0, 4).join(', ').toLowerCase())}${cov.missing.length > 4 ? '…' : ''}` : ''}</span></div></div>
    ${route ? `<div class="d-sec"><h3>Commute to ${esc(d.name)} <span>${Math.round(commuteOf(L))} min door to door</span></h3><div class="route">${legsHTML(route)}${obs}</div>${live ? `<a class="d-link" href="${esc(live)}" target="_blank" rel="noopener">Check the live route ${ICONS.ext}</a>` : ''}</div>` : ''}
    ${sun ? `<div class="d-sec"><h3>Direct sun on the window <span>floor ${esc(L.site.floor)}, facing ${Math.round(L.site.bearing)}°</span></h3><div class="sunbars">${sun.map((h, i) => `<div title="${h.toFixed(1)} h"><i style="height:${Math.max(3, (h / 9) * 100)}%"></i><span>${'JFMAMJJASOND'[i]}</span></div>`).join('')}</div><div class="faint" style="font-size:var(--fs-xs);margin-top:8px">Skyline straight ahead ${esc(L.site.skyline_ahead_deg)}° · ${L.site.open_sky_share != null ? Math.round(L.site.open_sky_share * 100) + '% open sky in view' : ''}</div></div>` : ''}
    ${rec.flags?.length ? `<div class="d-sec"><h3>Public records <span>reports, not findings</span></h3>${rec.flags.slice(0, 4).map((x) => `<div class="flag">${esc(x)}</div>`).join('')}</div>` : ''}
    ${rv.summary ? `<div class="d-sec"><h3>Residents say</h3>${ratings ? `<div class="reviews">${ratings}</div>` : ''}<p class="muted" style="margin:0;font-size:var(--fs-sm)">${esc(rv.summary)}</p></div>` : ''}
    ${L.notes ? `<div class="d-sec"><h3>Open questions</h3><p class="muted" style="margin:0;font-size:var(--fs-sm)">${esc(L.notes)}</p></div>` : ''}
    <div class="d-sec"><h3>Your notes <span>kept in this browser</span></h3>
      <div class="seg" id="dTier" role="group" aria-label="Your tier">${['S', 'A', 'B', 'C', 'Pass'].map((x) => `<button type="button" data-tier="${x}" class="${my.tier === x ? 'on' : ''}">${x}</button>`).join('')}</div>
      <textarea id="dNote" rows="3" placeholder="What you liked, what to ask, tour impressions" style="width:100%;margin-top:10px">${esc(my.note || '')}</textarea></div>
    <p class="faint" style="font-size:var(--fs-xs);padding:0 20px 18px;margin:0">Last checked ${esc(L.checked || '?')} · <span class="mono">${esc(L.id)}</span>${links.length ? ' · ' + links.map(([k, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(k)}</a>`).join(' · ') : ''}</p>
    </div>
    <div class="d-actions">${hasSite ? `<a class="btn primary" href="#unit/${esc(L.id)}">${ICONS.cube}Unit 3D</a>` : ''}${hasPlan ? `<a class="btn" href="#plan/${esc(L.id)}">${ICONS.plan}Plan</a>` : ''}${hasDos ? `<a class="btn" href="#records/${esc(L.id)}">${ICONS.doc}Records</a>` : ''}<button class="btn ${S.compare.includes(L.id) ? 'primary' : ''}" type="button" id="dCmp">${S.compare.includes(L.id) ? ICONS.check + 'Comparing' : ICONS.plus + 'Compare'}</button>${safeUrl(L.links?.listing) ? `<a class="btn" href="${esc(safeUrl(L.links.listing))}" target="_blank" rel="noopener">Listing ${ICONS.ext}</a>` : ''}</div>`;
  $('dClose').addEventListener('click', closeDrawer);
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
  if (tr) { credit(0); tr.addEventListener('scroll', () => credit(Math.round(tr.scrollLeft / tr.clientWidth)), { passive: true }); }
  $('drawer').querySelectorAll('a[href^="#"]').forEach((a) => a.addEventListener('click', closeDrawer));
  $('drawer').classList.add('open');
  document.querySelectorAll('.card').forEach((c) => c.classList.toggle('sel', c.dataset.id === id));
  document.querySelector(`.card[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest', behavior: opt.instant ? 'auto' : 'smooth' });
  emit('select', { id, fly: opt.fly });
}
export function closeDrawer() {
  S.sel = null; $('drawer').classList.remove('open');
  document.querySelectorAll('.card.sel').forEach((c) => c.classList.remove('sel'));
  emit('select', { id: null });
}

// ------------------------------------------------------------------ router
// Views load on first visit, so a slow or blocked CDN (three.js for the 3D views) never blanks the app.
const VIEWS = { map: () => import('./map.js'), list: () => import('./list.js'), compare: () => import('./compare.js'), unit: () => import('./unit3d.js'),
  plan: () => import('./plan3d.js'), records: () => import('./records.js'), tours: () => import('./tours.js') };
const loaded = {};
async function viewModule(v) {
  if (!loaded[v]) loaded[v] = VIEWS[v]().then((m) => { m.init?.(); return m; });
  return loaded[v];
}
async function route() {
  const [view, arg] = (location.hash.replace('#', '') || 'map').split('/');
  const v = VIEWS[view] ? view : 'map';
  S.view = v; document.body.dataset.view = v; document.body.classList.remove('rail-open');
  document.querySelectorAll('.view').forEach((el) => (el.hidden = el.id !== 'view-' + v));
  document.querySelectorAll('#tabs a').forEach((a) => { a.classList.toggle('on', a.dataset.view === v); a.toggleAttribute('aria-current', a.dataset.view === v); });
  if (v !== 'map' && v !== 'list') closeDrawer();
  if (v === 'map' && route.last && route.last !== 'map') renderCards();   // cards may be stale after edits in other views
  route.last = v;
  try { (await viewModule(v)).show?.(arg ? decodeURIComponent(arg) : null); } catch (e) {
    document.getElementById('view-' + v).innerHTML = `<div class="view-pad"><div class="empty"><b>This view could not load</b>${esc(String(e?.message || e))}<br>Check your connection; the 3D views load three.js from a CDN.</div></div>`;
  }
}

function setupTheme() {
  const qs = new URLSearchParams(location.search);
  document.documentElement.dataset.theme = qs.get('theme') || store.get('theme', null) || 'dark';
  const flip = () => {
    document.documentElement.dataset.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    store.set('theme', document.documentElement.dataset.theme);
    document.querySelector('meta[name=theme-color]')?.setAttribute('content', getComputedStyle(document.documentElement).getPropertyValue('--ground').trim());
    emit('theme');
  };
  $('themeBtn').addEventListener('click', flip);
  return flip;
}

function setupKeys(flipTheme) {
  const cards = () => [...document.querySelectorAll('#cards .card')];
  addEventListener('keydown', (e) => {
    const tag = e.target.tagName;
    if (e.key === 'Escape') { if (document.querySelector('.kbd-help')) document.querySelector('.kbd-help').remove(); else closeDrawer(); document.body.classList.remove('rail-open'); return; }
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === '/') { e.preventDefault(); $('q').focus(); return; }
    if ((e.key === 'j' || e.key === 'k') && S.view === 'map') {
      const cs = cards(); if (!cs.length) return;
      const i = cs.findIndex((c) => c.dataset.id === S.sel), n = Math.max(0, Math.min(cs.length - 1, i + (e.key === 'j' ? 1 : -1)));
      openDrawer(cs[i < 0 ? 0 : n].dataset.id, { fly: true }); return;
    }
    if (e.key === 's' && S.sel) { toggleSave(S.sel); openDrawer(S.sel); return; }
    if (e.key === 'c' && S.sel) { toggleCompare(S.sel); openDrawer(S.sel); return; }
    if (e.key === 't') { flipTheme(); return; }
    const views = ['map', 'list', 'compare', 'unit', 'plan', 'records', 'tours'];
    if (/^[1-7]$/.test(e.key)) { location.hash = views[+e.key - 1]; return; }
    if (e.key === '?') {
      const el = document.createElement('div'); el.className = 'kbd-help';
      el.innerHTML = `<div class="panel"><h3>Keyboard</h3><dl>${[['/', 'Search listings'], ['j k', 'Next or previous listing'], ['s', 'Save the open listing'], ['c', 'Add it to compare'], ['1–7', 'Switch view'], ['t', 'Light or dark'], ['Esc', 'Close'], ...(S.view === 'plan' ? [['R', 'Turn the selected piece'], ['← →', 'Nudge 1 in (Shift 6 in)'], ['D', 'Duplicate'], ['Del', 'Remove'], ['⌘Z', 'Undo'], ['W A S D', 'Walk mode']] : []), ...(S.view === 'unit' ? [['p', 'Play or pause the day'], [', .', 'Step 15 minutes']] : [])].map(([k, t]) => `<dt>${k.split(' ').map((x) => `<kbd>${x}</kbd>`).join(' ')}</dt><dd style="margin:0">${t}</dd>`).join('')}</dl></div>`;
      el.addEventListener('click', () => el.remove()); document.body.append(el);
    }
  });
}

async function boot() {
  const qs = new URLSearchParams(location.search);
  S.base = qs.get('data') || 'data';
  const [listings, crit, manifest, notes] = await Promise.all([
    getJSON(`${S.base}/listings.json`, []), getJSON(`${S.base}/criteria.json`, {}), getJSON(`${S.base}/manifest.json`, {}), getJSON(`${S.base}/notes.json`, {}),
  ]);
  Object.assign(S, { listings, crit, manifest, notes });
  S.weights = { ...(crit.weights || {}), ...(store.get('weights', null) || {}) };
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
  const flip = setupTheme();
  rescore(); renderRail(); renderKPIs(); renderCards();
  on('filters', (o) => { renderKPIs(); renderCards(); if (!o?.quiet) renderRail(); });
  // weight sliders fire on every pixel: coalesce to one render per frame, and render the full card list once the drag settles
  let wRaf = 0, wTimer = 0;
  on('weights', () => {
    cancelAnimationFrame(wRaf); wRaf = requestAnimationFrame(() => { renderKPIs(); if (S.view === 'map') renderCards(); });
    clearTimeout(wTimer); wTimer = setTimeout(() => emit('weights-settled'), 220);
  });
  on('saved', () => { renderCards(); const n = Object.values(S.picks).filter((p) => p.saved).length; $('savedCount').hidden = !n; $('savedCount').textContent = n; });
  on('compare', () => { $('cmpCount').hidden = !S.compare.length; $('cmpCount').textContent = S.compare.length; });
  emit('compare'); emit('saved');
  $('q').addEventListener('input', (e) => setFilter('q', e.target.value));
  $('sortSel').addEventListener('change', (e) => { S.sort = e.target.value; renderCards(); emit('sort'); });
  $('groupSeg').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { S.group = b.dataset.g; $('groupSeg').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); renderCards(); }));
  $('csvBtn').addEventListener('click', exportCSV);
  $('filtersBtn').addEventListener('click', () => document.body.classList.toggle('rail-open'));
  setupKeys(flip);
  addEventListener('hashchange', route);
  await route();
  viewModule('map');   // the map keeps pins in sync even while another view is open
  if (qs.get('open')) openDrawer(qs.get('open'), { fly: true, instant: true });
}
boot();
