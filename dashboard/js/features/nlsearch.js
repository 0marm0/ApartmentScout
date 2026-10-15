// Plain-language search in the command palette: the glue between the pure parser (nlquery.js) and the dashboard.
//
//   nlItem(query)   the palette row "Apply: ≤ $5,000 · ≤ 20 min subway · W/D" with a live count, or null
//   applyParsed()   put the parsed filters on S.filters, the commute lens and the sort, as one undo step
//   initNL()        registers the filter predicate for the filters the rail has no control for, and draws the
//                   chips that show (and clear) them above the results
import { S, ACTIVE, EXTRA_FILTERS, filtered, budgetAmt, setFilter, setCommute, loadJSON, on } from '../app.js';
import { syncTrigger } from '../palette.js';
import { $, esc, toast } from '../util.js';
import { group, announceLast } from './undo.js';
import { parseQuery, toFilters, matchesNL, chipsForNL, withoutKeys } from './nlquery.js';
import { getGeo, ensureGeo } from './places.js';   // [places] street, park and neighbourhood phrases

const SPARK = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M8 1.8l1.3 3.6 3.6 1.3-3.6 1.3L8 11.6 6.7 8 3.1 6.7l3.6-1.3z"/><path d="M12.5 10.5l.6 1.6 1.6.6-1.6.6-.6 1.6-.6-1.6-1.6-.6 1.6-.6z"/></svg>';
const WARN = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M8 2.2l6.2 11H1.8z"/><path d="M8 6.8v3M8 11.8v.2"/></svg>';

// ------------------------------------------------------------------ context for the parser
let ctxCache = null;
function context() {
  if (ctxCache?.n === S.listings.length && ctxCache.geo === getGeo()) return ctxCache.ctx;
  const places = new Set();
  for (const L of S.listings) {
    if (L.neighborhood) places.add(L.neighborhood);
    if (L.building) places.add(L.building);
    if (L.address) places.add(String(L.address).split(',')[0]);
  }
  ctxCache = { n: S.listings.length, geo: getGeo(), ctx: { destinations: S.crit.commute?.destinations || [], places: [...places], geo: getGeo() } };
  return ctxCache.ctx;
}
const base = () => ({ tiers: (S.crit.budget?.tiers || []).map((_, i) => i), status: [...ACTIVE], tierCap: S.crit.budget?.tiers?.length ? Math.max(...S.crit.budget.tiers.map((t) => t.max ?? 0)) : null });

// ------------------------------------------------------------------ price drops need the history file
let drops = new Set(), dropsState = 'idle';   // idle | loading | ready
async function ensureDrops() {
  if (dropsState === 'ready') return;
  if (dropsState === 'loading') return;
  dropsState = 'loading';
  try {
    const m = await import('../research/model.js');
    if (!m.R.loaded) await m.loadExtras(loadJSON);
    drops = new Set(Object.keys(m.R.hist?.price_history || {}).filter((id) => { const p = m.priceHistory(id); return p.length >= 2 && p[p.length - 1].v < p[p.length - 2].v; }));
  } catch { drops = new Set(); }
  dropsState = 'ready';
  // a count shown while it loaded is stale now: nudge the palette to redraw
  document.getElementById('plQ')?.dispatchEvent(new Event('input'));
}

// ------------------------------------------------------------------ preview
/** How many homes the current filters plus a hypothetical parse would show. Nothing is changed or emitted. */
function previewCount(parsed) {
  const plan = toFilters(parsed, base());
  const keep = { filters: S.filters, mode: S.commuteMode, dest: S.destName };
  try {
    S.filters = { ...S.filters, ...plan.filters };
    if (plan.commute?.mode) S.commuteMode = plan.commute.mode;
    if (plan.commute?.dest) S.destName = plan.commute.dest;
    return filtered().length;
  } finally { S.filters = keep.filters; S.commuteMode = keep.mode; S.destName = keep.dest; }
}

/** The palette row for a query that reads like a search, or null. A lone place name is left to the existing text filter. */
export function nlItem(query) {
  if (query.length > 400) return null;   // a pasted paragraph is not a search
  const parsed = parseQuery(query, context());
  if ((parsed.unsupported.length || parsed.unknown.length) && !parsed.found) {   // [places] unknown places are reported, never guessed
    const what = [...parsed.unknown, ...parsed.unsupported].join(', '), unk = parsed.unknown.length > 0;
    return { group: 'Ask', id: 'nl', icon: WARN, title: unk ? `No place “${esc(parsed.unknown.join(', '))}” in this search’s map data` : `Can’t filter by “${esc(what)}” yet`,
      sub: getGeo() ? 'Try a street, park or neighbourhood the map knows, or a building name' : 'Run apartmentscout places, then build, to filter by street, park or neighbourhood', meta: '',
      run: () => toast(unk ? `No place “${parsed.unknown.join(', ')}” in the map data: try another name` : `Filtering by “${what}” is not supported yet: type a neighbourhood or street name`) };
  }
  const real = parsed.chips.filter((c) => c.key !== 'text');
  if (!parsed.found || (!real.length && parsed.chips.length < 2)) return null;
  if (parsed.f.priceDrops) ensureDrops();
  const n = parsed.f.priceDrops && dropsState !== 'ready' ? null : previewCount(parsed);
  const total = S.listings.filter((L) => ACTIVE.includes(L.status || 'new')).length;
  const notes = [];
  notes.push(n == null ? 'Counting…' : n === 0 ? 'No home matches' : `${n} of ${total} active homes`);
  if (parsed.unsupported.length) notes.push(`can’t filter by “${parsed.unsupported.join(', ')}” yet`);
  if (parsed.unknown.length) notes.push(`no place “${parsed.unknown.join(', ')}” in the map data`);   // [places]
  if (parsed.rest) notes.push(`not understood: “${parsed.rest}”`);
  if (parsed.f.priceDrops && dropsState === 'ready' && !drops.size) notes.push('no price history recorded yet');
  return {
    group: 'Ask', id: 'nl', icon: SPARK,
    title: `Apply: <span class="nl-sum">${esc(parsed.summary)}</span>`,
    sub: esc(notes.join(' · ')), meta: '<kbd>↵</kbd>',
    run: () => applyParsed(parsed),
  };
}

// ------------------------------------------------------------------ apply
export async function applyParsed(parsed) {
  if (parsed.f.priceDrops) await ensureDrops();
  const plan = toFilters(parsed, base());
  if (!['map', 'list'].includes(S.view)) location.hash = 'map';
  const count = () => filtered().length;
  let n = 0;
  const changed = group('Applied a plain-language search', () => {
    if (plan.commute) setCommute(plan.commute);
    Object.assign(S.filters, plan.filters);
    setFilter('nl', plan.filters.nl);   // saves the filters and redraws once
    const q = $('q'); if (q) q.value = S.filters.q;
    syncTrigger();
    if (plan.sort) { const sel = $('sortSel'); if (sel) { sel.value = plan.sort; sel.dispatchEvent(new Event('change')); } }
    n = count();
  }, { quietToast: true });
  // the group's toast is replaced by one that says what the search found
  if (!changed) { toast('Nothing changed: those filters are already on'); return; }
  announceLast(`${parsed.chips.length} filter${parsed.chips.length === 1 ? '' : 's'} applied · ${n} home${n === 1 ? '' : 's'}`);
}

// ------------------------------------------------------------------ chips above the results
function renderChips() {
  const host = $('nlChips'); if (!host) return;
  const chips = chipsForNL(S.filters.nl);
  host.hidden = !chips.length;
  if (!chips.length) { host.innerHTML = ''; return; }
  host.innerHTML = `<span class="nl-lbl">From your search</span>${chips.map((c) => `<button type="button" class="nl-chip" data-clear="${esc(c.clear.join(','))}" aria-label="Remove the filter: ${esc(c.label)}" title="Remove this filter">${esc(c.label)}<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M3 3l6 6M9 3L3 9"/></svg></button>`).join('')}
    <button type="button" class="nl-clear" data-clear="*">Clear</button>`;
}

export function initNL() {
  EXTRA_FILTERS.push((L, f) => matchesNL(L, f.nl, { price: budgetAmt, drops, geo: getGeo(), dests: S.crit.commute?.destinations || [], kmh: S.crit.commute?.transit?.walk_speed_kmh || 4.8 }));   // [places] [multi-destination]
  ensureGeo();   // [places] loads data/places.json in the background
  const results = document.getElementById('results'), head = results?.querySelector('.results-h');
  if (head && !$('nlChips')) {
    const host = document.createElement('div');
    host.id = 'nlChips'; host.className = 'nl-chips'; host.hidden = true; host.setAttribute('role', 'group'); host.setAttribute('aria-label', 'Filters from your plain-language search');
    head.after(host);
    host.addEventListener('click', (e) => {
      const b = e.target.closest('[data-clear]'); if (!b) return;
      const keys = b.dataset.clear === '*' ? Object.keys(S.filters.nl || {}) : b.dataset.clear.split(',');
      const label = b.dataset.clear === '*' ? 'Cleared the plain-language filters' : `Removed the filter: ${b.textContent.trim()}`;
      group(label, () => setFilter('nl', withoutKeys(S.filters.nl, keys)));
    });
  }
  if (S.filters.nl?.priceDrops) ensureDrops();
  on('filters', renderChips);
  renderChips();
}
