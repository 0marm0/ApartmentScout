// Commute by time of day: the time selector on the map's commute legend and the by-time bars in the listing drawer.
//
//   lens     one slot (morning peak, midday, evening way home, late evening, weekend) at a time; every surface that shows
//            commute minutes follows it, exactly as they follow the mode: the map, pins, cards, filters, sort, Compare
//            (criteria.js modeMinutes reads the lens). Nothing is stored: a reload is back on the arrive-by trip; `?time=pm`
//            opens on a slot, so a link can point at one.
//   map      the heat grid for a slot is the arrive-by grid plus a whole-minute difference grid, fetched when first asked
//            for (layers/commute-<destination>-times.json, listed under manifest.extra) and cached
//   drawer   "By time of day": a bar per slot for this home and mode, and one sentence with the numbers
//
// Scoring is not touched here: the rank reads the arrive-by trip unless criteria.yaml opts in (commute.times.score).
// The arithmetic is in timeofday-model.js; app.js, map.js and criteria.js call the few functions exported here.
import { S, on, emit, store, loadJSON, dest, setCommute, MODE_LABEL } from '../app.js';
import { setTimeLens } from '../criteria.js';
import { $, esc } from '../util.js';
import * as M from './timeofday-model.js';

const dests = () => S.crit.commute?.destinations || [];
let current = null;                               // slot id, or null = the arrive-by trip
const docs = new Map();                            // destination name -> { state: 'loading'|'ready'|'none', doc, grids: Map('mode/slot' -> Uint8Array|'loading') }
const derived = new WeakMap();                     // base layer -> Map(slot id -> derived layer)

/** The slots of this search, when there is more than the arrive-by trip to choose between. */
export const slots = () => { const s = M.slotsOf(S.crit); return s.length > 1 && hasTimes() ? s : []; };
let _has = null;
function hasTimes() {
  if (_has == null || _has.n !== S.listings.length) _has = { n: S.listings.length, v: S.listings.some((L) => Object.values(L.commute || {}).some((e) => e?.times)) };
  return _has.v;
}
export const available = () => slots().length > 0;
const isBase = (s, d) => s && s.kind !== 'depart' && (s.day || 'weekday') === 'weekday' && M.timeOf(s, d) === (d?.arrive_by || '09:00');
const slotOf = (id) => M.slotById(slots(), id);
/** The slot the lens is on, or null while it is on the arrive-by trip. */
export const active = () => (current && !isBase(slotOf(current), dest()) ? slotOf(current) : null);
export const activeId = () => active()?.id || null;
export const modeKeyNow = () => M.modeKey(S.commuteMode);
const walking = () => S.commuteMode === 'walk';

/** Move the lens (null / the arrive-by slot = back to the arrive-by trip). Returns true when it changed. */
export function setSlot(id) {
  const s = id ? slotOf(id) : null;
  const next = s && !isBase(s, dest()) ? s.id : null;
  if (next === current) return false;
  current = next;
  setTimeLens(current ? { slots: slots(), id: current } : null);
  if (current) ensureGrid(dest()?.name, S.commuteMode);   // start fetching the map's difference grid now
  return true;
}
export function init() {
  const q = new URLSearchParams(location.search).get('time');
  if (q && slotOf(q)) setSlot(q);
  on('criteria', () => { if (current && !slotOf(current)) { current = null; setTimeLens(null); } });
}

// ------------------------------------------------------------------ the map's grids
function docFor(d) {
  const name = d?.name; if (!name) return null;
  let e = docs.get(name);
  if (e) return e;
  e = { state: 'loading', doc: null, grids: new Map() };
  docs.set(name, e);
  const file = `layers/${M.timesFile(name)}`;
  if (!(S.manifest.extra || []).includes(file)) { e.state = 'none'; return e; }
  loadJSON(`${S.base}/${file}`, null).then((doc) => { e.doc = doc; e.state = doc ? 'ready' : 'none'; })
    .catch(() => { e.state = 'none'; }).finally(() => { if (current) emit('commute'); });
  return e;
}
const gridMode = (mode) => ({ best: 'transit', transit: 'transit', subway: 'subway', bus: 'bus' }[mode] || null);
/** Start fetching and inflating the difference grid for (destination, mode, current slot); a 'commute' event fires when it is ready. */
function ensureGrid(name, mode) {
  const d = dests().find((x) => x.name === name), gm = gridMode(mode), id = current;
  if (!d || !gm || !id) return null;
  const e = docFor(d);
  if (e.state !== 'ready') return null;
  const key = `${gm}/${id}`, have = e.grids.get(key);
  if (have && have !== 'loading') return have;
  const z = e.doc.grids?.[gm]?.[id];
  if (!z) { e.grids.set(key, null); return null; }
  if (have === 'loading') return null;
  e.grids.set(key, 'loading');
  M.inflate(z).then((bytes) => { e.grids.set(key, bytes); }).catch(() => { e.grids.set(key, null); }).finally(() => { if (current === id) emit('commute'); });
  return null;
}
/** The surface the map draws: the arrive-by `base` layer, or for the lens's slot the base plus its difference grid. While the grid is
 *  on its way the arrive-by surface stays up (the legend says it is loading). */
export function layerFor(base, d, mode = S.commuteMode) {
  if (!base || !current || !active() || walking() || base.combo) return base;
  const bytes = ensureGrid(d?.name, mode);
  if (!bytes) return base;
  let by = derived.get(base);
  if (!by) derived.set(base, (by = new Map()));
  if (!by.has(current)) by.set(current, { ...base, values: M.applyDelta(base.values, bytes), tod: current });
  return by.get(current);
}
const loadingNow = () => !!current && active() && !walking() && (() => {
  const d = dest(), e = docs.get(d?.name);
  const gm = gridMode(S.commuteMode);
  return !e || e.state === 'loading' || (e.state === 'ready' && e.grids.get(`${gm}/${current}`) === 'loading') || (e.state === 'ready' && !e.grids.has(`${gm}/${current}`));
})();
const missingNow = () => !!current && active() && !walking() && docs.get(dest()?.name)?.state === 'none';

// ------------------------------------------------------------------ the legend
const sub = (d) => { const s = active(); return s ? `${esc(s.label)} · ${esc(M.phrase(s, d))}` : `arrive ${esc(d?.arrive_by || '')}`; };
/** The h4 subtitle in the legend and the rail: "arrive 9:00" or the slot's name and time. */
export const headSub = (d) => sub(d);
export const railSub = (d) => { const s = active(); return s ? `, ${esc(M.phrase(s, d))}` : (d?.arrive_by ? ', arrive ' + esc(d.arrive_by) : ''); };

/** "Time of day" chips for the commute legend: one per slot, the active one on. Empty when the search has only the arrive-by trip. */
export function legendHTML() {
  const ss = slots(), d = dest();
  if (!ss.length || !d) return '';
  const cur = activeId();
  const baseId = ss.find((s) => isBase(s, d))?.id;
  const on2 = (s) => (cur ? s.id === cur : s.id === baseId);
  const off = walking();
  return `<div class="tod-lg" id="lgTime" role="group" aria-label="Time of day">
    <div class="tod-lg-h"><span>Time of day</span>${loadingNow() ? '<small class="tod-load" role="status">loading…</small>' : ''}</div>
    <div class="seg tod-seg">${ss.map((s) => `<button type="button" data-tod="${esc(s.id)}" class="${on2(s) ? 'on' : ''}" aria-pressed="${on2(s)}" ${off ? 'disabled' : ''} title="${esc(s.label)}: ${esc(M.phrase(s, d))}">${esc(M.chip(s, d))}</button>`).join('')}</div>
    ${off ? '<div class="src">Walking takes the same time at any hour.</div>'
      : missingNow() ? '<div class="src">The map for this time was not built: run <code>apartmentscout commute</code>. Cards and numbers still follow it.</div>'
      : cur ? `<div class="src">${esc(active().label)}: ${active().kind === 'depart' ? 'leaving the destination at that time, on the way home' : 'arriving at the destination by that time'}${active().day === 'weekday' || !active().day ? ' on a weekday' : ' on a ' + esc(active().day)}. Pins, cards and filters follow it.</div>` : ''}
  </div>`;
}
export function wireLegend(root) {
  root.querySelectorAll('#lgTime [data-tod]').forEach((b) => b.addEventListener('click', () => setCommute({ slot: b.dataset.tod })));
}

// ------------------------------------------------------------------ the drawer
const barH = (m, top) => Math.max(6, Math.min(100, (m / top) * 100));
/** "By time of day": a bar per slot for one home, in the drawer's commute mode ('transit' | 'subway' | 'bus' | 'walk'). */
export function drawerHTML(L, d, drawerMode) {
  const ss = slots();
  if (!ss.length || !d || drawerMode === 'walk') return '';
  const mode = drawerMode === 'transit' ? 'best' : drawerMode;
  const entry = L.commute?.[d.name];
  const sm = M.summary(entry, mode, ss, d);
  if (!sm) return '';
  const lim = d.max_minutes ?? 30, top = Math.max(lim * 1.6, ...sm.rows.map((r) => r.minutes || 0)), cur = activeId();
  const baseId = ss.find((s) => isBase(s, d))?.id;
  const on2 = (id) => (cur ? id === cur : id === baseId);
  const on = M.scoredOn(S.crit);
  return `<div class="tod" id="dTod" role="group" aria-label="Door to door by time of day">
    <div class="tod-h"><b>By time of day</b><span class="faint">${esc(MODE_LABEL[mode].toLowerCase())}, door to door</span></div>
    <div class="tod-bars">${sm.rows.map((r) => `<button type="button" class="tod-b${on2(r.id) ? ' on' : ''}${r.minutes != null && r.minutes > lim ? ' over' : ''}${r.minutes == null ? ' na' : ''}" data-tod="${esc(r.id)}" aria-pressed="${on2(r.id)}" title="${esc(r.slot.label)}: ${esc(r.phrase)}${r.minutes != null ? ', ' + Math.round(r.minutes) + ' min' : ': no answer'}">
      <b>${r.minutes == null ? '–' : Math.round(r.minutes)}</b><i style="height:${r.minutes == null ? 0 : barH(r.minutes, top)}%"></i><span>${esc(M.chip(r.slot, d))}</span></button>`).join('')}<u class="tod-lim" style="bottom:calc(${barH(lim, top)}% * .62 + 32px)" title="Your ${lim}-minute limit" aria-hidden="true"></u></div>
    <p class="tod-sum">${esc(sm.text)}.</p>
    <p class="tod-note">${esc(sm.verdict)}${on ? ` The commute score is read from ${on === 'weighted' ? 'a weighted average over the day' : 'the ' + esc(slotOf(on)?.label.toLowerCase() || on) + ' trip'}.` : ' The commute score reads the arrive-by trip.'}</p>
  </div>`;
}
export function wireDrawer(root) {
  root.querySelectorAll('#dTod [data-tod]').forEach((b) => b.addEventListener('click', () => setCommute({ slot: b.dataset.tod === activeId() ? null : b.dataset.tod })));
}
