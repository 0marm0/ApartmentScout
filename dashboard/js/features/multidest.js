// Several commute destinations, everywhere minutes appear (work and a partner's work, a gym).
//
//   rail      "All destinations": a limit slider per destination (carried in S.filters.nl as `c:<name>`, so chips, undo and
//             the "Apply: ..." preview already know them)
//   cards     a compact line of minutes to every destination and the combined commute score
//   drawer    a table of every destination: minutes, limit, weight, score, and the combined score
//   sort      "Best combined commute"
//   map       the heat surface can show the worst of all destinations or their weighted average
//             (layers/commute-combined-<mode>.json, written by `apartmentscout build`)
//
// With one destination none of this appears. The arithmetic is in multidest-model.js; map.js and app.js call the few
// functions exported here from small marked hooks.
import { S, on, emit, store, SORTS, renderRail, loadJSON, setFilter } from '../app.js';
import { $, esc } from '../util.js';
import { decorateRail } from './results.js';
import { destMinutes, combined, limitsOf } from './multidest-model.js';

const dests = () => S.crit.commute?.destinations || [];
const kmh = () => S.crit.commute?.transit?.walk_speed_kmh || 4.8;
const NO_LIMIT = 75;   // the slider's last stop means "no limit", like the commute slider
export const multi = () => dests().length > 1;
const modeKey = () => (S.commuteMode === 'best' ? null : S.commuteMode);
const short = (n) => n;   // the card's CSS ellipsises long names
const min = (v) => (v == null ? '—' : String(Math.round(v)));

/** Minutes to every destination in the lens's mode, plus the combined figures, for one home. */
export function rowsOf(L) { return destMinutes(L, dests(), S.commuteMode, kmh()); }
export const combinedOf = (L) => combined(rowsOf(L));

// ------------------------------------------------------------------ cards
/** The compact line under a card's own commute row: "Work 18 · Partner 26 · Gym 9 · 78 combined". */
export function destLineHTML(L) {
  if (!multi()) return '';
  const rows = rowsOf(L), c = combined(rows), lens = S.destName || dests()[0]?.name;
  const cell = (r) => `<span class="cd${r.over ? ' over' : ''}${r.minutes == null ? ' na' : ''}${r.name === lens ? ' lens' : ''}" title="${esc(r.name)}: ${r.minutes == null ? 'not computed' : Math.round(r.minutes) + ' min'}${r.over ? ` (over your ${r.max} min limit)` : ''}"><span class="cd-n">${esc(short(r.name))}</span><b>${min(r.minutes)}</b>${r.over ? '<i aria-hidden="true">▲</i><span class="sr"> over the limit</span>' : ''}</span>`;
  const shown = rows.slice(0, 3), more = rows.length - shown.length;
  const all = c.score == null ? '' : `<span class="cd-all" title="Combined commute score ${Math.round(c.score)} of 100: each destination scored against its own limit, then averaged by weight${c.used < c.of ? `; ${c.used} of ${c.of} destinations have times for this home` : ''}">Σ <b>${Math.round(c.score)}</b></span>`;
  return `<div class="md-line" role="group" aria-label="Minutes to each destination">${shown.map(cell).join('')}${more > 0 ? `<span class="cd-more" title="${esc(rows.slice(3).map((r) => `${r.name} ${min(r.minutes)} min`).join(', '))}">+${more}</span>` : ''}${all}</div>`;
}

// ------------------------------------------------------------------ drawer
const barPct = (r) => (r.minutes == null ? 0 : Math.max(2, Math.min(100, (r.minutes / (r.max * 2)) * 100)));
export function drawerHTML(L) {
  if (!multi()) return '';
  const rows = rowsOf(L), c = combined(rows), lens = S.destName || dests()[0]?.name;
  const mode = S.commuteMode === 'best' ? 'door to door, fastest way' : S.commuteMode === 'walk' ? 'walking' : S.commuteMode;
  const wsum = rows.reduce((s, r) => s + r.weight, 0) || 1;
  return `<div class="d-sec md-d" id="dDests"><h3>Every destination <span>${esc(mode)}${c.score != null ? ` · combined score ${Math.round(c.score)}` : ''}</span></h3>
    <div class="md-t" role="table" aria-label="Commute to each destination">
      <div class="md-r md-h" role="row"><span role="columnheader">Destination</span><span role="columnheader">Minutes</span><span role="columnheader" title="Against your limit: 100 at half the limit, 50 at the limit, 0 at twice it">Score</span><span role="columnheader" title="How much this destination counts in the combined score">Weight</span></div>
      ${rows.map((r) => `<div class="md-r${r.name === lens ? ' lens' : ''}${r.over ? ' over' : ''}" role="row">
        <button type="button" role="rowheader" data-md-lens="${esc(r.name)}" title="Show the route to ${esc(r.name)}"><span class="md-n">${esc(r.name)}</span><small>limit ${r.max} min${r.arrive_by ? `, arrive ${esc(r.arrive_by)}` : ''}</small></button>
        <span role="cell" class="md-m"><b>${min(r.minutes)}</b>${r.over ? '<i aria-hidden="true">▲</i><span class="sr"> over the limit</span>' : ''}<span class="md-bar" aria-hidden="true"><i style="width:${barPct(r)}%"></i><u style="left:50%"></u></span></span>
        <span role="cell" class="md-s">${r.score == null ? '—' : Math.round(r.score)}</span>
        <span role="cell" class="md-w">×${+(r.weight).toFixed(2)}<small>${Math.round((r.weight / wsum) * 100)}%</small></span></div>`).join('')}
    </div>
    <p class="md-note">${c.score == null ? 'No destination has times for this home yet.' : `Combined ${Math.round(c.score)} of 100${c.used < c.of ? ` on ${c.used} of ${c.of} destinations` : ''}; about ${Math.round(c.weighted)} minutes on average, ${Math.round(c.worst)} to the farthest. Each destination is scored against its own limit and the scores averaged by weight.`}</p></div>`;
}

// ------------------------------------------------------------------ rail
function railHTML() {
  const lim = Object.fromEntries(limitsOf(S.filters.nl).map((c) => [c.dest, c]));
  const any = Object.keys(lim).length;
  return `<div class="sec-h"><h3>Every destination</h3>${any ? '<button class="reset" type="button" data-md-clear>Clear</button>' : ''}</div>
    ${dests().map((d) => {
      const c = lim[d.name], v = c ? c.max : NO_LIMIT, w = d.weight ?? 1;
      return `<div class="md-lim"><div class="range-h"><span class="md-n" title="${esc(d.name)}">${esc(d.name)} <small title="Weight in the combined score">×${+(+w).toFixed(2)}</small></span><b data-md-val="${esc(d.name)}">${v >= NO_LIMIT ? 'Any' : '≤ ' + v + ' min'}</b></div>
        <input type="range" min="5" max="${NO_LIMIT}" value="${v}" data-md-dest="${esc(d.name)}" style="--p:${((v - 5) / (NO_LIMIT - 5)) * 100}%" aria-label="Maximum minutes to ${esc(d.name)}"></div>`;
    }).join('')}
    <p class="md-note">Each limit keeps homes within that many minutes of that destination, in the mode above or the one you name. Weights count in the combined score: <button type="button" class="md-link" data-md-edit>edit destinations</button>.</p>`;
}
function mountRail() {
  const rail = $('rail'); if (!rail) return;
  rail.querySelector('.md-sec')?.remove();
  syncSort();
  const anchor = rail.querySelector('#rCom')?.closest('.sec');
  if (!multi() || !anchor) return;
  const sec = document.createElement('div');
  sec.className = 'sec md-sec'; sec.innerHTML = railHTML();
  anchor.after(sec);
  decorateRail(rail);   // collapsible like its neighbours (a no-op for sections already decorated)
  sec.querySelectorAll('[data-md-dest]').forEach((r) => {
    r.addEventListener('input', () => {
      const name = r.dataset.mdDest, v = +r.value, nl = { ...(S.filters.nl || {}) }, key = `c:${name}`;
      if (v >= NO_LIMIT) delete nl[key]; else nl[key] = { dest: name, max: v, mode: nl[key]?.mode ?? modeKey() };
      S.filters.nl = Object.keys(nl).length ? nl : null;
      store.set('filters2', S.filters);
      r.style.setProperty('--p', `${((v - 5) / (NO_LIMIT - 5)) * 100}%`);
      sec.querySelector(`[data-md-val="${CSS.escape(name)}"]`).textContent = v >= NO_LIMIT ? 'Any' : `≤ ${v} min`;
      emit('filters', { quiet: true });
    });
    r.addEventListener('change', () => renderRail());
  });
  sec.querySelector('[data-md-clear]')?.addEventListener('click', () => {
    const nl = Object.fromEntries(Object.entries(S.filters.nl || {}).filter(([k]) => !k.startsWith('c:')));
    setFilter('nl', Object.keys(nl).length ? nl : null);
  });
  sec.querySelector('[data-md-edit]')?.addEventListener('click', () => $('railSettings')?.click());
}

// ------------------------------------------------------------------ sort
const BEST = 'combined';
function syncSort() {
  const sel = $('sortSel'); if (!sel) return;
  const has = [...sel.options].some((o) => o.value === BEST);
  if (multi() && !has) sel.add(new Option('Best combined commute', BEST));
  if (!multi() && has) { sel.querySelector(`option[value="${BEST}"]`).remove(); if (S.sort === BEST) { S.sort = 'match'; sel.value = 'match'; } }
  if (multi()) sel.value = S.sort;
}

// ------------------------------------------------------------------ heat map: worst of all, weighted
// state = which surface (null = the selected destination's own), kept with the destination it was chosen on so that
// picking a destination anywhere (a pin, the rail) returns to that destination's own surface
let combo = null, comboDest = null;
const cache = new Map();   // mode -> { state: 'loading' | 'ready' | 'none', doc, worst, weighted }
const files = () => (S.manifest.extra || []).filter((f) => /^layers\/commute-combined-[a-z]+\.json$/.test(f));
export const hasCombos = () => multi() && files().length > 0;
export const comboOn = () => !!combo && multi() && comboDest === (S.destName || dests()[0]?.name);
export const comboKind = () => (comboOn() ? combo : null);

async function inflate(b64) {
  const bin = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
  const buf = await new Response(new Blob([bin]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer();
  return new Uint8Array(buf);
}
const toValues = (q, nd, sc) => { const v = new Float32Array(q.length); for (let i = 0; i < q.length; i++) v[i] = q[i] === nd ? -1 : q[i] * sc; return v; };
function load(mode) {
  const e = { state: 'loading' }; cache.set(mode, e);
  (async () => {
    const doc = files().includes(`layers/commute-combined-${mode}.json`) ? await loadJSON(`${S.base}/layers/commute-combined-${mode}.json`, null) : null;
    if (!doc) { e.state = 'none'; return; }
    const base = { kind: 'commute', rows: doc.rows, cols: doc.cols, bbox: doc.bbox, cell_m: doc.cell_m, feeds: doc.feeds, arrival_offsets_min: doc.arrival_offsets_min, water_masked: doc.water_masked };
    e.doc = doc;
    e.worst = { ...base, name: 'the farthest of your destinations', combo: 'the farthest of your destinations', limit: doc.limit_worst, values: toValues(await inflate(doc.worst_z), doc.nodata, doc.scale) };
    e.weighted = { ...base, name: 'your destinations, weighted', combo: 'your destinations, weighted', limit: doc.limit_weighted, values: toValues(await inflate(doc.weighted_z), doc.nodata, doc.scale) };
    e.state = 'ready';
  })().catch(() => { e.state = 'none'; }).finally(() => { if (comboOn()) emit('commute'); });
  return e;
}
const same = (a, b) => a.length === b.length && a.every((x, i) => x.name === b[i].name && Math.abs(x.lat - b[i].lat) < 5e-4 && Math.abs(x.lon - b[i].lon) < 5e-4);
const live = () => dests().filter((d) => !d._stale);
/** Why the combined surface can not be drawn right now, or null when it can. */
function problem() {
  const mode = S.commuteMode;
  if (mode === 'walk') return 'Walking has no timetable surface to combine.';
  const e = cache.get(mode) || load(mode);
  if (e.state === 'loading') return 'Loading the combined surface…';
  if (e.state === 'none') return `No combined ${mode === 'best' ? '' : mode + ' '}surface: it needs a ${mode === 'best' ? '' : mode + ' '}grid for every destination. Run apartmentscout commute, then build.`;
  if (!same(live(), e.doc.destinations) || live().length !== dests().length) return 'Your destinations changed after the build: rebuild to refresh the combined surface.';
  return null;
}
/** The layer map.js draws when a combined surface is selected (and drawable), else null. */
export function comboLayer() {
  if (!comboOn() || problem()) return null;
  return cache.get(S.commuteMode)[combo];
}
/** Pieces of the legend for a combined surface, or null for an ordinary destination. */
export function legendHead() {
  if (!comboOn()) return null;
  const e = cache.get(S.commuteMode), w = e?.doc?.destinations || [], stale = e?.doc && w.some((x, i) => Math.abs((dests()[i]?.weight ?? 1) - x.weight) > 1e-9);
  const names = dests().map((d) => d.name);
  return {
    sub: combo === 'worst' ? `longest of ${names.length}` : `weighted mean of ${names.length}`,
    what: combo === 'worst' ? `The longest trip to any of ${names.join(', ')}` : `The average minutes to ${names.map((n, i) => `${n} (×${+(+(dests()[i].weight ?? 1)).toFixed(2)})`).join(', ')}`,
    arrive: dests().map((d) => d.arrive_by).filter(Boolean).join(' / '), note: problem() || (combo === 'weighted' && stale ? 'The weights changed after the build: rebuild to refresh this surface.' : null),
  };
}
/** The <option>s of the legend's destination menu: each destination, then the combined surfaces. */
export function destOptions(ds, d) {
  const on1 = !comboOn();
  const own = ds.map((x) => `<option value="${esc(x.name)}" ${on1 && x === d ? 'selected' : ''}>To ${esc(x.name)}</option>`).join('');
  if (!hasCombos()) return own;
  return `${own}<optgroup label="All destinations"><option value="*worst" ${combo === 'worst' && comboOn() ? 'selected' : ''}>Farthest of all ${ds.length}</option><option value="*weighted" ${combo === 'weighted' && comboOn() ? 'selected' : ''}>Weighted average</option></optgroup>`;
}
/** A pick in the legend's menu: a combined surface, or a destination (which ends the combined view). */
export function pickDest(value, setCommute) {
  if (value.startsWith('*')) {
    combo = value.slice(1); comboDest = S.destName || dests()[0]?.name;
    store.set('combo', { mode: combo, dest: comboDest });
    if (!cache.has(S.commuteMode)) load(S.commuteMode);
    emit('commute');
  } else { combo = null; store.set('combo', null); setCommute({ dest: value }); }
}

// ------------------------------------------------------------------ start
export function init() {
  const saved = store.get('combo', null);
  if (saved?.mode && ['worst', 'weighted'].includes(saved.mode)) { combo = saved.mode; comboDest = saved.dest; }
  SORTS[BEST] = (a, b) => (combinedOf(b).score ?? -1) - (combinedOf(a).score ?? -1);
  on('rail', mountRail);
  document.addEventListener('click', (e) => {   // a destination row in the drawer: show that route
    const b = e.target.closest?.('[data-md-lens]'); if (!b) return;
    import('../app.js').then((m) => m.setCommute({ dest: b.dataset.mdLens }));
  });
  on('commute', () => { if ($('cards')) syncSort(); });
  mountRail();
}
