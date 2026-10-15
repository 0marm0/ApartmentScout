// Noise by hour of the day: the hour slider on the map's noise layer and the clock chart in the listing drawer.
//
//   map      the existing 311 noise surface, for one hour of the day (and Sun-Thu or Fri-Sat nights) instead of all of them;
//            "All hours" is the surface that was always there. Shade is on the same scale as the all-day map, as if every
//            hour of the day were like the chosen one: darker than the all-day map = a louder than average hour.
//   drawer   "Noise by hour": a 24-hour clock of complaints per night around the home, the loudest three hours in words
//            with the kind of source ("Loudest Fri–Sat 11 pm–2 am: mostly bars, clubs and restaurants"), at the address
//            (its dossier, within 150 m over three years) and around it (450 m on the map layer)
//
// These are 311 complaints, not decibels, and every label says so. Data: layers/noise-hours.json (manifest.extra),
// dossiers/<id>.json noise_311.by_week. The arithmetic is in noise-hours-model.js.
import { S, on, emit, loadJSON } from '../app.js';
import { $, esc } from '../util.js';
import * as M from './noise-hours-model.js';

const FILE = 'layers/noise-hours.json';
export const available = () => (S.manifest.extra || []).includes(FILE);
let dec = null, loading = null;
let hour = null, cls = 'all';                       // the map: null = all hours
let scope = 'building', clockCls = 'all';            // the drawer
const dossiers = new Map();                          // listing id -> noise_311 | null | 'loading'

function ensure() {
  if (dec || !available()) return Promise.resolve(dec);
  loading ||= loadJSON(`${S.base}/${FILE}`, null).then((doc) => (doc ? M.decode(doc) : null)).then((d) => { dec = d; return d; })
    .catch(() => null).finally(() => emit('noise-hours'));
  return loading;
}
export const ready = () => !!dec;
export const hourNow = () => hour;

// ------------------------------------------------------------------ the map layer
/** The noise surface for the chosen hour, or `base` itself for all hours (or while the hours load). */
export function mapLayer(base) {
  if (!base || hour == null) return base;
  if (!dec) { ensure(); return base; }
  const counts = M.cellCounts(dec, hour, cls), values = new Float32Array(counts.length);
  for (let i = 0; i < counts.length; i++) values[i] = counts[i] * 24;   // as if every hour of the day were this one: comparable with the all-day map
  return { ...base, values, rows: dec.doc.rows, cols: dec.doc.cols, bbox: dec.doc.bbox, months: dec.doc.months, hourly: true, hour, cls, night: null, total: sumOf(counts) };
}
const sumOf = (a) => { let t = 0; for (let i = 0; i < a.length; i++) t += a[i]; return t; };
export function setHour(h) { hour = h == null ? null : Math.max(0, Math.min(23, Math.round(h))); if (hour != null) ensure(); }
export function setClass(c) { cls = c; }

const dayName = (c) => (c === 'all' ? 'every day' : M.CLASSES[c].short);
/** Hour slider and day chips for the noise legend. */
export function legendHTML() {
  if (!available()) return '';
  const h = hour, all = h == null;
  return `<div class="nh-lg" id="lgHours">
    <div class="nh-lg-row"><span class="nh-lg-k">Hour</span>
      <button type="button" class="nh-all${all ? ' on' : ''}" data-nh-all aria-pressed="${all}">All hours</button>
      <input type="range" id="nhHour" min="0" max="23" step="1" value="${all ? 22 : h}" aria-label="Hour of the day" aria-valuetext="${all ? 'all hours' : esc(M.windowLabel(h, 1))}" ${all ? 'class="idle"' : ''}>
      <output id="nhHourOut" for="nhHour">${all ? '' : esc(M.hourLabel(h))}</output></div>
    <div class="nh-lg-row ${all ? 'idle' : ''}"><span class="nh-lg-k">Nights</span>
      <div class="seg nh-seg">${[['all', 'Every night'], [0, 'Sun–Thu'], [1, 'Fri–Sat']].map(([k, t]) => `<button type="button" data-nh-cls="${k}" class="${k === cls ? 'on' : ''}" aria-pressed="${k === cls}">${t}</button>`).join('')}</div></div>
    <div class="src nh-src">${all ? 'Drag the slider to see one hour of the day.' : `Complaints logged ${esc(M.windowLabel(h, 1))}, ${esc(dayName(cls))}${cls === 'all' ? '' : ' nights'}, shaded as if every hour were like this one. Darker than the all-day map means a louder than average hour.`} Complaints, not decibels. A request logged after midnight counts toward the evening before.</div>
  </div>`;
}
/** Wire the legend: `repaint(full)` redraws the map layer (full = also the legend itself). */
export function wireLegend(root, repaint) {
  const sl = root.querySelector('#nhHour'); if (!sl) return;
  const out = root.querySelector('#nhHourOut');
  sl.addEventListener('input', () => {
    setHour(+sl.value); sl.classList.remove('idle');
    root.querySelector('.nh-all')?.classList.remove('on'); root.querySelector('.nh-all')?.setAttribute('aria-pressed', 'false');
    if (out) out.textContent = M.hourLabel(hour);
    sl.setAttribute('aria-valuetext', M.windowLabel(hour, 1));
    repaint(false);
  });
  sl.addEventListener('change', () => repaint(true));
  root.querySelector('[data-nh-all]')?.addEventListener('click', () => { setHour(hour == null ? +sl.value : null); repaint(true); });
  root.querySelectorAll('[data-nh-cls]').forEach((b) => b.addEventListener('click', () => { setClass(b.dataset.nhCls === 'all' ? 'all' : +b.dataset.nhCls); if (hour == null) setHour(+sl.value); repaint(true); }));
}
export function init() {
  const q = new URLSearchParams(location.search).get('hour');
  if (q != null && /^\d+$/.test(q)) setHour(+q);
  on('noise-hours-open', ({ h } = {}) => { if (h != null) setHour(h); });
}

// ------------------------------------------------------------------ the drawer
/** The section's shell (filled by mount() once the data is in); '' when the search has no noise-by-hour data. */
export function drawerHTML(L) {
  const hasDos = (S.manifest.dossiers || []).includes(L.id);
  if (!available() && !hasDos) return '';
  return `<div class="d-sec nh" id="dNoise"><h3>Noise by hour <span>311 complaints, not decibels</span></h3><div class="nh-body" aria-busy="true"><div class="nh-skel" aria-hidden="true"></div></div></div>`;
}
async function profiles(L) {
  let bld = null;
  if ((S.manifest.dossiers || []).includes(L.id)) {
    if (!dossiers.has(L.id)) dossiers.set(L.id, loadJSON(`${S.base}/dossiers/${L.id}.json`, null).then((D) => D?.noise_311 || null).catch(() => null));
    bld = M.buildingProfile(await dossiers.get(L.id));
  }
  const d = await ensure();
  const area = d && L.lat != null ? M.areaProfile(d, L.lat, L.lon, 1) : null;
  return { building: bld, area: area && M.total(area) > 0 ? area : null };
}
const fmt = (n) => Math.round(n).toLocaleString('en-US');
function bodyHTML(p, L) {
  const have = { building: p.building, area: p.area };
  if (!have.building && !have.area) return '<p class="nh-note">No 311 noise data by the hour for this address.</p>';
  if (!have[scope]) scope = have.building ? 'building' : 'area';
  const prof = have[scope], ds = M.describe(prof);
  const vals = M.series(prof, clockCls), pk = ds.enough ? (clockCls === 'all' ? ds.peak : M.peak({ ...prof, hours: prof.hours.map((h, k) => (clockCls === k ? h : Array(24).fill(0))) })) : null;
  const per100 = (h) => `${M.hourLabel(h)}: ${fmt(prof.hours[0][h] + prof.hours[1][h])} complaints in all`;
  const titles = Array.from({ length: 24 }, (_, h) => per100(h));
  const years = scope === 'building' ? (prof.years ? `${prof.years} years` : 'three years') : `${prof.months || 12} months`;
  const count = scope === 'building' ? `${fmt(M.total(prof))} complaints within ${prof.radiusM} m of this address over ${years}` : `${fmt(M.total(prof))} complaints in about ${fmt(prof.radiusM)} m around it over ${years}`;
  const seg = (items, attr, cur) => `<div class="seg nh-seg">${items.map(([k, t]) => `<button type="button" ${attr}="${k}" class="${String(k) === String(cur) ? 'on' : ''}" aria-pressed="${String(k) === String(cur)}">${t}</button>`).join('')}</div>`;
  return `${have.building && have.area ? `<div class="nh-scope">${seg([['building', 'At this address'], ['area', 'Around it']], 'data-nh-scope', scope)}</div>` : ''}
    <div class="nh-main">${M.clockSVG(vals, pk, { titles })}
      <div class="nh-text"><p class="nh-h">${esc(ds.headline)}</p>${ds.detail || ds.quietLabel ? `<p class="nh-d">${esc(ds.detail)} ${esc(ds.quietLabel)}</p>` : ''}
        ${ds.enough ? seg([['all', 'Every night'], [0, 'Sun–Thu'], [1, 'Fri–Sat']], 'data-nh-clock', clockCls) : ''}
        ${available() && ds.enough ? `<button type="button" class="d-link nh-map" data-nh-map="${pk ? pk.start : 22}">See it on the map by hour</button>` : ''}</div></div>
    <p class="nh-note">${esc(count)}. Spokes show complaints per night for each hour; the highlighted spokes are the loudest three hours. These are reports to 311 (by phone or app), not decibel readings, and they follow who lives nearby and how readily they call as well as the noise itself. A request logged after midnight counts toward the evening before.</p>`;
}
const cache = new Map();
/** Fill the section the drawer just rendered. */
export async function mount(L, root = document) {
  const el = root.querySelector('#dNoise .nh-body'); if (!el) return;
  let p = cache.get(L.id);
  if (!p) { p = await profiles(L); cache.set(L.id, p); }
  const live = root.querySelector('#dNoise .nh-body');
  if (!live || S.sel !== L.id) return;
  const paint = () => {
    live.innerHTML = bodyHTML(p, L); live.removeAttribute('aria-busy');
    live.querySelectorAll('[data-nh-scope]').forEach((b) => b.addEventListener('click', () => { scope = b.dataset.nhScope; paint(); }));
    live.querySelectorAll('[data-nh-clock]').forEach((b) => b.addEventListener('click', () => { clockCls = b.dataset.nhClock === 'all' ? 'all' : +b.dataset.nhClock; paint(); }));
    live.querySelector('[data-nh-map]')?.addEventListener('click', (e) => {
      const h = +e.currentTarget.dataset.nhMap;
      setHour(h); location.hash = '#map'; emit('noise-hours-open', { h });
    });
  };
  paint();
}
