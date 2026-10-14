// Map features that hang off map.js through small, marked hooks: the route preview on hover, the starred-only lens
// (a "★ N" chip in the layer switch, fit-to-stars and [ / ] to step through stars) and the sun lens (pins coloured by
// direct-sun hours where a site model exists). map.js passes in what it owns through bind(); everything else lives here.
import { S, on, filtered, openDrawer, isSaved, setFilter, sorted } from '../app.js';
import { $, esc, css, ICONS, toast } from '../util.js';
import { createRoutePreview, registerPreview } from './route-preview.js';
import { MONTHS, MONTH_NAMES, sunHours, hasSunModel, sunColor, sunGradient, sunSummary, SUN_MAX, SUN_UNKNOWN, starsOf, stepId, boundsOf, hoursText } from './lens-logic.js';

let ctx = null, route = null;
let starLens = false, sunMonth = new Date().getMonth(), wasSun = false;
const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const map = () => ctx?.map();
const heat = () => ctx?.heat();
const isSun = () => heat() === 'sun';
const pinLine = () => (document.documentElement.dataset.theme === 'light' ? '#ffffff' : '#0b0d12');   // the basemap's pin outline (map.js PAL.pinLine)

// ------------------------------------------------------------------ the set of homes the map draws
const stars = () => starsOf(S.listings, isSaved);
const lensOn = () => starLens && stars().length > 0;
/** What the map draws: the filtered homes, or every starred home when the lens is on. */
export function mapListings() { return lensOn() ? stars() : filtered(); }
export const inMapSet = (id) => !lensOn() || isSaved(id);

// ------------------------------------------------------------------ sun lens
export const hasSun = () => S.listings.some(hasSunModel);
/** Pin colour: the sun scale in the sun lens (grey when there is no model), else the caller's score colour. */
export const pinColor = (L, fallback) => (isSun() ? sunColor(sunHours(L, sunMonth)) : fallback);
export const pinUnknown = (L) => isSun() && sunHours(L, sunMonth) == null;
/** In the sun lens homes with a model move to their own unclustered source so a count bubble never swallows them. */
export const pinSplit = (L) => isSun() && hasSunModel(L);
export const swatch = () => sunGradient();
export function tagChip(L) {
  if (!isSun()) return '';
  const h = sunHours(L, sunMonth);
  if (h == null) return `<em class="sun-chip unk" title="Direct sun unknown: no light model for this home" aria-label="Direct sun unknown">${ICONS.sun}?</em>`;
  return `<em class="sun-chip" style="--c:${sunColor(h)}" title="${esc(hoursText(h))} of direct sun on the ${MONTH_NAMES[sunMonth]} 15th">${ICONS.sun}${h.toFixed(1)}</em>`;
}
/** In the sun lens every home with a model keeps its price tag, whatever its rank. */
export const keepTag = (L) => isSun() && hasSunModel(L);
export function hoverLine(L) {
  if (!isSun()) return '';
  const h = sunHours(L, sunMonth);
  return h == null ? '<div class="sunline unk">Direct sun unknown: no light model for this home</div>'
    : `<div class="sunline"><i style="--c:${sunColor(h)}"></i><b>${h.toFixed(1)} h</b> direct sun on the ${esc(MONTHS[sunMonth])} 15th${L.site?.floor != null ? ` · floor ${esc(L.site.floor)}` : ''}</div>`;
}
function sunData() {
  const m = map(); if (!m?.getSource('sunpins')) return;
  const feats = isSun() ? mapListings().filter((L) => L.lat != null && hasSunModel(L) && !isSaved(L.id)).map((L) => ({ type: 'Feature', id: L.id,
    properties: { id: L.id, col: sunColor(sunHours(L, sunMonth)), gone: L.status === 'gone' }, geometry: { type: 'Point', coordinates: [L.lon, L.lat] } })) : [];
  m.getSource('sunpins').setData({ type: 'FeatureCollection', features: feats });
}
/** After the pin data changed (setPins in map.js). */
export const refreshPins = sunData;
const ORIG = {};
function sunPaints(m) {
  // known homes read bigger and solid; unknown ones recede to small, translucent grey. Restored when the lens closes.
  for (const id of ['pins', 'pins-s']) {
    if (!m.getLayer(id)) continue;
    if (!(id in ORIG)) ORIG[id] = { op: m.getPaintProperty(id, 'circle-opacity'), r: m.getPaintProperty(id, 'circle-radius') };
    if (isSun()) {
      m.setPaintProperty(id, 'circle-opacity', ['case', ['get', 'gone'], 0.3, ['get', 'unk'], 0.5, 1]);
      if (id === 'pins') m.setPaintProperty(id, 'circle-radius', ['interpolate', ['linear'], ['zoom'], 11, ['case', ['get', 'unk'], 2.2, 4], 15, ['case', ['get', 'unk'], 5, 8.5]]);
    } else {
      m.setPaintProperty(id, 'circle-opacity', ORIG[id].op); m.setPaintProperty(id, 'circle-radius', ORIG[id].r);
    }
  }
}
function addSunLayers(m) {
  if (!m.getSource('sunpins')) m.addSource('sunpins', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, promoteId: 'id' });
  if (m.getLayer('sun-pins')) return;
  const hover = ['boolean', ['feature-state', 'hover'], false];
  m.addLayer({ id: 'sun-halo', type: 'circle', source: 'sunpins', paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 11, 15, 22], 'circle-color': ['get', 'col'], 'circle-blur': 0.85, 'circle-opacity': 0.42 } });
  m.addLayer({ id: 'sun-sel', type: 'circle', source: 'sunpins', filter: ['==', ['get', 'id'], S.sel || ''], paint: { 'circle-radius': 15, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-width': 2.5, 'circle-stroke-color': css('--accent') } });
  m.addLayer({ id: 'sun-pins', type: 'circle', source: 'sunpins', paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 5.5, 12, 8, 15, 11], 'circle-color': ['get', 'col'], 'circle-opacity': ['case', ['get', 'gone'], 0.35, 1],
    'circle-stroke-width': ['case', hover, 3, 2.2], 'circle-stroke-color': ['case', hover, css('--ink'), pinLine()] } });
}
/** Legend body for the sun lens. */
export function legendHTML() {
  const sum = sunSummary(mapListings(), sunMonth), now = new Date().getMonth();
  return `<h4>Direct sun <span>hours a day on the ${esc(MONTHS[sunMonth])} 15th</span></h4>
    <div class="sun-month" role="group" aria-label="Month shown">
      <button type="button" data-sunm="-1" aria-label="Previous month">${'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M10 3.5L5.5 8 10 12.5"/></svg>'}</button>
      <b aria-live="polite">${esc(MONTH_NAMES[sunMonth])}</b>
      <button type="button" data-sunm="1" aria-label="Next month"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M6 3.5L10.5 8 6 12.5"/></svg></button>
      ${sunMonth === now ? '' : '<button type="button" class="btn sm ghost" data-sunm="now">This month</button>'}
    </div>
    <div class="bar" style="height:8px;border-radius:2px;background:${sunGradient()}" role="img" aria-label="Scale from 0 hours (indigo) to ${SUN_MAX} hours or more (yellow)"></div>
    <div class="sun-ticks" aria-hidden="true">${[0, 2, 4, 6, SUN_MAX].map((t) => `<span style="left:${(t / SUN_MAX) * 100}%">${t === SUN_MAX ? t + '+' : t}</span>`).join('')}</div>
    <div class="sun-key"><i style="background:${SUN_UNKNOWN}"></i><span><b>Grey: unknown.</b> No light model for ${sum.unknown.toLocaleString()} of ${sum.total.toLocaleString()} homes, which is not the same as no sun.</span></div>
    <div class="src">${sum.known ? `${sum.known} ${sum.known === 1 ? 'home has' : 'homes have'} a 3D site model${sum.lo != null ? `, ${hoursText(sum.lo)} to ${hoursText(sum.hi)} in ${esc(MONTHS[sunMonth])}` : ''}.` : 'No home in this view has a light model yet.'} Clear-sky hours of direct sun on the window; build a site model with <code>apartmentscout site</code> to add more.</div>`;
}
export function wireLegend(root) {
  root.querySelectorAll('[data-sunm]').forEach((b) => b.addEventListener('click', () => {
    const v = b.dataset.sunm;
    setSunMonth(v === 'now' ? new Date().getMonth() : sunMonth + +v);
    ctx.renderLegend(); root.querySelector(`[data-sunm="${v === 'now' ? '1' : v}"]`)?.focus();
  }));
}
function setSunMonth(m) { sunMonth = ((m % 12) + 12) % 12; ctx.setPins(); ctx.drawTags(); }
/** After map.js changed the heat layer (setHeat): move between the score and sun colourings and restyle the pins. */
export function afterHeat() {
  const m = map(); if (!m) return;
  sunPaints(m);
  if (isSun() !== wasSun) { wasSun = isSun(); ctx.setPins(); ctx.drawTags(); } else sunData();
}

// ------------------------------------------------------------------ starred-only lens
const SVG_FIT = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4"/></svg>';
/** The "★ N" chip (and, while the lens is on, fit and "also filter the list") appended to the layer switch. */
export function chipsHTML() {
  const n = stars().length, on2 = lensOn(), list = !!S.filters.savedOnly;
  const tip = n ? (on2 ? 'Showing only your starred homes on the map. Click to show all.' : 'Show only your starred homes on the map') : 'Star a home to use this lens (the star on any card)';
  return `<span class="lens-sep" role="separator" aria-hidden="true"></span>`
    + `<button type="button" class="lens-chip star ${on2 ? 'on' : ''}" data-lens="stars" aria-pressed="${on2}" ${n ? '' : 'disabled'} title="${tip}" aria-label="Starred homes only: ${n} starred${on2 ? ', on' : ''}">${ICONS.star}<b>${n}</b></button>`
    + (n ? `<button type="button" class="lens-chip ico" data-lens="fit-stars" title="Fit the map to your starred homes" aria-label="Fit the map to your starred homes">${SVG_FIT}</button>` : '')
    + (on2 ? `<button type="button" class="lens-chip txt ${list ? 'on' : ''}" data-lens="stars-list" aria-pressed="${list}" title="Also filter the results list to your starred homes">+ List</button>` : '');
}
function fitStars() {
  const m = map(), b = boundsOf(stars().map((L) => [L.lon, L.lat]));
  if (!m || !b) { toast('No starred homes yet. Star one with the star on any card.'); return; }
  const wide = innerWidth > 760;
  if (b[0][0] === b[1][0] && b[0][1] === b[1][1]) m.easeTo({ center: b[0], zoom: Math.max(m.getZoom(), 15), duration: reduce() ? 0 : 700 });
  else m.fitBounds(b, { padding: { top: 90, bottom: wide ? 90 : 60, left: 70, right: wide && S.sel ? 480 : 70 }, maxZoom: 15.5, duration: reduce() ? 0 : 750 });
}
function setStarLens(v) {
  starLens = !!v && stars().length > 0;
  ctx.setPins(); ctx.drawTags(); ctx.renderSwitch(); ctx.renderLegend?.();
  if (starLens) fitStars();
}
/** [ and ] fly to the previous or next starred home (in the current sort order) and open its mini card; with the drawer
 *  open they move the drawer instead. */
function stepStar(dir) {
  const ids = sorted(stars()).map((L) => L.id);
  if (!ids.length) { toast('No starred homes yet. Star one with the star on any card.'); return; }
  const id = stepId(ids, S.sel || ctx.lastOpened(), dir);
  if (S.sel) openDrawer(id, { fly: true }); else ctx.peek(id);
}

// ------------------------------------------------------------------ wiring
export function onStyle() {
  const m = map(); if (!m) return;
  addSunLayers(m);
  sunPaints(m); sunData();
  route.ensure(); route.restyle();
}
export function shown() { route?.sync(); }
/** Called once by map.js after it creates the map. `c` is what map.js owns: map(), heat(), setPins, drawTags,
 *  renderSwitch, renderLegend, peek(id) and lastOpened(). */
export function bind(c) {
  ctx = c;
  route = createRoutePreview(c.map(), { before: 'pins-halo', active: () => S.view === 'map' });
  registerPreview(route);
  $('layerSwitch').addEventListener('click', (e) => {
    const b = e.target.closest('[data-lens]'); if (!b || b.disabled) return;
    const k = b.dataset.lens;
    if (k === 'stars') setStarLens(!starLens);
    else if (k === 'fit-stars') fitStars();
    else if (k === 'stars-list') setFilter('savedOnly', !S.filters.savedOnly);
  });
  const redraw = () => { if (!ctx) return; if (starLens && !stars().length) { starLens = false; ctx.setPins(); ctx.drawTags(); } ctx.renderSwitch(); if (isSun()) ctx.renderLegend(); };
  on('saved', redraw);
  on('filters', () => ctx && ctx.renderSwitch());
  on('select', ({ id } = {}) => { const m = map(); if (m?.getLayer('sun-sel')) m.setFilter('sun-sel', ['==', ['get', 'id'], id || '']); });
  on('theme', () => { const m = map(); if (m?.getLayer('sun-pins')) { m.setPaintProperty('sun-pins', 'circle-stroke-color', ['case', ['boolean', ['feature-state', 'hover'], false], css('--ink'), pinLine()]); m.setPaintProperty('sun-sel', 'circle-stroke-color', css('--accent')); } });
  // the shortcuts sheet is built by app.js; add this feature's row to it when it opens on the map
  new MutationObserver((rows) => {
    for (const r of rows) for (const n of r.addedNodes) {
      const dl = n.classList?.contains('kbd-help') && S.view === 'map' ? n.querySelector('dl') : null;
      if (dl) dl.insertAdjacentHTML('beforeend', '<dt><kbd>[</kbd> <kbd>]</kbd></dt><dd style="margin:0">Fly to the previous or next starred home</dd>');
    }
  }).observe(document.body, { childList: true });
  addEventListener('keydown', (e) => {
    if ((e.key !== '[' && e.key !== ']') || S.view !== 'map' || e.metaKey || e.ctrlKey || e.altKey) return;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) || e.target.isContentEditable || document.querySelector('.kbd-help, .pl-scrim:not([hidden]), .sheet-scrim.on')) return;
    e.preventDefault(); stepStar(e.key === ']' ? 1 : -1);
  });
}
