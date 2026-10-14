// Split view for the Shortlist: an optional docked mini map beside the table (about a third of the width, toggled by a
// "Map" button and remembered in this browser). The map follows the table: it draws exactly the rows the table's filters
// and sort leave, hovering a row pulses its pin (and previews its route), hovering a pin lights its row, and clicking a
// pin scrolls to that row, highlights it and moves keyboard focus there.
// list.js hands in a small API (row order, reveal, focus) through attachSplit(); this module owns everything else.
import { S, on, emit, store, byId, score, cost, commuteOf, dest, label, isSaved, MODE_LABEL } from '../app.js';
import { $, esc, money, scoreColor, css } from '../util.js';
import { basemapStyle } from '../map.js';
import { createRoutePreview, registerPreview, unregisterPreview } from './route-preview.js';
import { boundsOf } from './lens-logic.js';

const KEY = 'list:split';
const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
let enabled = store.get(KEY, false) === true, api = null, mini = null, ready = false, kind = 'auto', route = null, tip = null, pulseMk = null, destMk = null;
let lastSet = '', hovFromMap = null, hlRow = null, ro = null, fitted = false;

const SVG_MAP = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M5.5 3L1.8 4.4v8.6L5.5 11.6M5.5 3l5 1.4M5.5 3v8.6M10.5 4.4l3.7-1.4v8.6l-3.7 1.4M10.5 4.4V13M5.5 11.6l5 1.4"/></svg>';
const SVG_FIT = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4"/></svg>';
const active = () => enabled && S.view === 'list';
const pane = () => $('splitMap');

// ------------------------------------------------------------------ mount
/** Called once by list.js after it built the view. `a`: { ids(), reveal(id) -> Promise<tr|null>, focusRow(tr), rowFor(id) -> tr|null }. */
export function attachSplit(a) {
  api = a;
  const host = $('view-list'), actions = host.querySelector('.page-h .actions');
  if (!host || !actions || $('splitMap')) return;
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'btn split-btn'; b.id = 'lsSplit';
  b.innerHTML = `${SVG_MAP}<span>Map</span>`;
  b.title = 'Dock a map beside the table'; b.setAttribute('aria-controls', 'splitMap');
  b.addEventListener('click', () => set(!enabled));
  actions.prepend(b);
  const el = document.createElement('aside');
  el.id = 'splitMap'; el.className = 'split-map mapstage'; el.hidden = true;
  el.setAttribute('aria-label', 'Map of the homes in the table');
  el.innerHTML = `<div class="split-canvas" id="splitCanvas"></div>
    <div class="float split-n" id="splitN" role="status"></div>
    <div class="float split-ctl"><button type="button" id="splitFit" title="Fit the map to the table" aria-label="Fit the map to the homes in the table">${SVG_FIT}</button></div>
    <div class="float split-key" aria-hidden="true"><i class="d"></i>score <i class="s"></i>saved</div>
    <div class="attrib" id="splitAttrib"></div>`;
  host.append(el);
  $('splitFit').addEventListener('click', () => fit(true));
  on('theme', () => { if (!mini) return; mini.setStyle(basemapStyle(kind), { diff: false }); mini.once('style.load', onStyle); });
  on('hover', onHover);
  on('select', ({ id } = {}) => { if (mini?.getLayer('sp-sel')) mini.setFilter('sp-sel', ['==', ['get', 'id'], id || '']); });
  on('saved', () => { if (active()) sync(true); });
  on('commute', () => { if (active()) { addDest(); sync(true); } });
  set(enabled, true);
}

function set(v, boot = false) {
  enabled = !!v;
  if (!boot) store.set(KEY, enabled);
  const b = $('lsSplit'), host = $('view-list');
  if (!b || !host) return;
  b.classList.toggle('on', enabled); b.setAttribute('aria-pressed', String(enabled));
  b.title = enabled ? 'Hide the docked map' : 'Dock a map beside the table';
  host.classList.toggle('split-on', enabled);
  pane().hidden = !enabled;
  if (enabled) { if (S.view === 'list') start(); } else stop();
}
function stop() {
  if (route) { unregisterPreview(route); route = null; }
  ro?.disconnect(); ro = null;
  tip?.remove(); pulseMk?.remove(); destMk?.remove(); pulseMk = destMk = null;
  mini?.remove(); mini = null; ready = false; lastSet = ''; fitted = false;
}
/** The Shortlist was shown (list.js show()). */
export function shown() { if (enabled) start(); }

// ------------------------------------------------------------------ the map
function start() {
  if (mini) { requestAnimationFrame(() => { mini.resize(); sync(); route?.sync(); }); return; }
  if (!window.maplibregl || !$('splitCanvas')) return;
  const c = S.crit.search?.map_center, d = dest();
  const center = c ? [c[1], c[0]] : d?.lat != null ? [d.lon, d.lat] : [-73.98, 40.75];
  kind = 'auto';
  mini = new maplibregl.Map({ container: 'splitCanvas', style: basemapStyle(kind), center, zoom: 11.2, minZoom: 8, maxZoom: 17, attributionControl: false, preserveDrawingBuffer: true, dragRotate: false });
  mini.touchZoomRotate.disableRotation();
  window.__asSplitMap = mini;   // for screenshots and tests
  tip = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12, maxWidth: '240px', className: 'sp-tip' });
  let tileOk = false;
  mini.on('sourcedata', (e) => { if (e.tile && ['omt', 'base'].includes(e.sourceId)) tileOk = true; });
  mini.on('error', (e) => {   // the same fallback chain as the main map: vector tiles, Esri raster, plain background
    if (tileOk || kind === 'offline') return;
    const what = `${e?.error?.message || ''} ${e?.error?.url || ''} ${e?.sourceId || ''}`;
    if (kind === 'auto' && /openfreemap|omt/.test(what)) { kind = 'raster'; swap(); }
    else if (kind === 'raster' && /arcgisonline|\bbase\b|\bref\b/.test(what)) { kind = 'offline'; swap(); }
  });
  route = createRoutePreview(mini, { before: 'sp-halo', active });
  registerPreview(route);
  mini.once('style.load', onStyle);
  ro = new ResizeObserver(() => mini?.resize());
  ro.observe($('splitCanvas'));
  wire();
}
function swap() { mini.setStyle(basemapStyle(kind), { diff: false }); mini.once('style.load', onStyle); }

function pinData() {
  const feats = [];
  for (const id of api.ids()) {
    const L = byId(id); if (!L || L.lat == null) continue;
    feats.push({ type: 'Feature', id, properties: { id, col: scoreColor(score(L)), star: isSaved(id), gone: L.status === 'gone' }, geometry: { type: 'Point', coordinates: [L.lon, L.lat] } });
  }
  return { type: 'FeatureCollection', features: feats.reverse() };   // best-ranked drawn last, on top
}
function onStyle() {
  ready = true;
  const p = css('--ink'), line = document.documentElement.dataset.theme === 'light' ? '#ffffff' : '#0b0d12';
  if (S.transit) {
    const fs = S.transit.features.filter((f) => f.properties.kind === 'line');
    mini.addSource('sp-lines', { type: 'geojson', data: { type: 'FeatureCollection', features: fs } });
    mini.addLayer({ id: 'sp-line', type: 'line', source: 'sp-lines', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-opacity': 0.8, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1, 15, 3] } });
  }
  mini.addSource('sp-pins', { type: 'geojson', data: pinData(), promoteId: 'id' });
  const hover = ['boolean', ['feature-state', 'hover'], false];
  mini.addLayer({ id: 'sp-halo', type: 'circle', source: 'sp-pins', filter: ['get', 'star'], paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 7, 15, 15], 'circle-color': css('--fav'), 'circle-blur': 0.8, 'circle-opacity': 0.5 } });
  mini.addLayer({ id: 'sp-sel', type: 'circle', source: 'sp-pins', filter: ['==', ['get', 'id'], S.sel || ''], paint: { 'circle-radius': 12, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-width': 2.5, 'circle-stroke-color': css('--accent') } });
  mini.addLayer({ id: 'sp-pins', type: 'circle', source: 'sp-pins', paint: {
    'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, ['case', hover, 5, 2.4], 12, ['case', hover, 8, 4.2], 15, ['case', hover, 10, 7]],
    'circle-color': ['get', 'col'], 'circle-opacity': ['case', ['get', 'gone'], 0.35, 1],
    'circle-stroke-width': ['case', hover, 3, ['get', 'star'], 2.2, 1.4], 'circle-stroke-color': ['case', hover, p, ['get', 'star'], css('--fav'), line] } });
  route.ensure();
  addDest();
  $('splitAttrib').innerHTML = kind === 'offline' ? 'Basemap offline' : (kind === 'raster' ? 'Tiles © Esri, © OpenStreetMap' : '© <a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>');
  lastSet = ''; sync();
  route.sync();
}
function addDest() {
  destMk?.remove(); destMk = null;
  const d = dest(); if (!mini || d?.lat == null) return;
  const el = document.createElement('div');
  el.className = 'sp-dest'; el.title = d.name;
  el.innerHTML = `<i aria-hidden="true"></i><span>${esc(d.name)}</span>`;
  destMk = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([d.lon, d.lat]).addTo(mini);
}

/** Redraw the pins from the table's rows; fit the map when the set of rows changed (not on a re-sort or a star). */
export function sync(lite = false) {
  if (!enabled || !api) return;
  if (!mini && S.view === 'list') start();
  if (!mini || !ready || !mini.getSource('sp-pins')) return;
  const data = pinData();
  mini.getSource('sp-pins').setData(data);
  const n = data.features.length;
  $('splitN').innerHTML = `<b>${n.toLocaleString()}</b> ${n === 1 ? 'home' : 'homes'} on the map`;
  if (lite) return;
  const key = n + ':' + data.features.map((f) => f.id).sort().join('|');
  if (key !== lastSet) { lastSet = key; fit(false); }
}
function fit(force) {
  if (!mini) return;
  const pts = api.ids().map(byId).filter((L) => L?.lat != null).map((L) => [L.lon, L.lat]);
  const b = boundsOf(pts);
  if (!b) return;
  mini.resize();
  const first = !fitted; fitted = true;
  if (b[0][0] === b[1][0] && b[0][1] === b[1][1]) { mini.easeTo({ center: b[0], zoom: 14.5, duration: reduce() ? 0 : 500 }); return; }
  mini.fitBounds(b, { padding: 44, maxZoom: 14.5, duration: reduce() || first ? 0 : 550 });
}

// ------------------------------------------------------------------ table <-> map
function setHover(id, v) { if (id && mini?.getSource('sp-pins')) mini.setFeatureState({ source: 'sp-pins', id }, { hover: v }); }
let hovId = null;
/** A row (or a pin, or a card) is hovered: pulse its pin. The route preview listens to the same event. */
function onHover(id) {
  if (!mini || !ready) return;
  if (hovId) setHover(hovId, false);
  hovId = id || null;
  if (hovId) setHover(hovId, true);
  pulseMk?.remove(); pulseMk = null;
  if (!hovId || hovId === hovFromMap || !active()) return;
  const L = byId(hovId); if (L?.lat == null || !mini.getBounds().contains([L.lon, L.lat])) return;
  const el = document.createElement('div');
  el.className = 'sp-pulse'; el.setAttribute('aria-hidden', 'true');
  el.innerHTML = '<i></i><i></i>';
  pulseMk = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([L.lon, L.lat]).addTo(mini);
}
function flash(tr) {
  tr.classList.remove('pin-flash'); void tr.offsetWidth; tr.classList.add('pin-flash');
  setTimeout(() => tr.classList.remove('pin-flash'), 1700);
}
function lightRow(id) {
  hlRow?.classList.remove('map-hl'); hlRow = null;
  if (!id) return;
  const tr = api.rowFor(id);
  if (tr) { tr.classList.add('map-hl'); hlRow = tr; }
}
function wire() {
  mini.on('mousemove', 'sp-pins', (e) => {
    const f = e.features[0]; if (!f) return;
    mini.getCanvas().style.cursor = 'pointer';
    if (hovFromMap !== f.id) {
      hovFromMap = f.id; emit('hover', f.id); lightRow(f.id);
      const L = byId(f.id);
      if (L) {
        const cm = commuteOf(L), ml = S.commuteMode === 'best' ? '' : ' ' + MODE_LABEL[S.commuteMode].toLowerCase();
        tip.setLngLat([L.lon, L.lat]).setHTML(`<div class="hovercard sp-tipc"><div class="hb"><div class="t">${esc(label(L))}</div><div class="s">${esc(L.neighborhood || '')}${L.sqft ? ' · ' + Math.round(L.sqft) + ' ft²' : ''}</div><div class="p"><b>${money(cost(L))}/mo</b><span>${cm != null ? Math.round(cm) + ' min' + ml + ' · ' : ''}score ${Math.round(score(L) ?? 0)}</span></div></div></div>`).addTo(mini);
      }
    }
  });
  mini.on('mouseleave', 'sp-pins', () => {
    mini.getCanvas().style.cursor = ''; tip.remove();
    hovFromMap = null; emit('hover', null); lightRow(null);
  });
  mini.on('click', 'sp-pins', async (e) => {
    const id = e.features[0]?.id; if (!id) return;
    const tr = await api.reveal(id); if (!tr) return;
    tr.scrollIntoView({ block: 'center', behavior: reduce() ? 'auto' : 'smooth' });
    flash(tr); api.focusRow(tr);
  });
}
