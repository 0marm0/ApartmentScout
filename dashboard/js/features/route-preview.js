// Route preview: hover a result card, a map pin or price tag, or a Shortlist row and that home's commute route is
// drawn on the map for the current destination and mode. Walk legs are dashed, subway rides follow the line in its
// official colour, transfers get dots, buses (stops are not in the layers) a dotted approximate chord, and a small
// pill says the time. One GeoJSON source is updated in place (no layers are re-added), the labels are a few pooled
// DOM markers, and the route is kept for the open drawer's listing when nothing is hovered.
import { S, on, dest, modesOf, byId, label } from '../app.js';
import { css, esc, bullet, routeBadge } from '../util.js';
import { buildNetwork, buildRoute, routeGeoJSON, pillDetail } from './route-geometry.js';

const EMPTY = { type: 'FeatureCollection', features: [] };
const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const LAYERS = ['route-case', 'route-walk-case', 'route-walk', 'route-approx', 'route-ride', 'route-dots'];
const FADE = { 'route-case': ['line-opacity'], 'route-walk-case': ['line-opacity'], 'route-walk': ['line-opacity'], 'route-approx': ['line-opacity'], 'route-ride': ['line-opacity'], 'route-dots': ['circle-opacity', 'circle-stroke-opacity'] };

let net = null, netFor = null;
/** The station and line index for the loaded transit layer (rebuilt only if the layer object changes). */
function network() {
  if (!S.transit) return null;
  if (netFor !== S.transit) { net = buildNetwork(S.transit.features); netFor = S.transit; }
  return net;
}
const cache = new Map();
/** Pure-ish: the drawable route for one listing under the current lens (destination + mode); cached. */
export function routeOf(id) {
  const L = byId(id), d = dest(), n = network();
  if (!L || L.lat == null || !n) return null;
  const m = modesOf(L, d), key = `${id}|${d?.name}|${S.commuteMode}`;
  if (cache.has(key)) return cache.get(key);
  const r = buildRoute({ legs: m.legs, origin: [L.lon, L.lat], dest: d?.lat != null ? [d.lon, d.lat] : null, net: n, minutes: m.sel, mode: S.commuteMode });
  if (cache.size > 400) cache.clear();
  cache.set(key, r);
  return r;
}

/** One preview per map. `opts.before()` names the layer the route sits under (pins); `opts.active()` says whether this
 *  map is the one on screen (the main map on Map, the docked mini map on Shortlist). */
export function createRoutePreview(map, opts = {}) {
  let want = null, drawn = null, timer = 0, labelTimer = 0, ready = false;
  const pool = [];                        // { marker, el } reused across routes
  let items = [];                         // the labels of the drawn route, with their path length for the zoom check
  const active = () => (opts.active ? opts.active() : true);
  const before = () => { const b = typeof opts.before === 'function' ? opts.before() : opts.before; return b && map.getLayer(b) ? b : undefined; };

  const ink = () => css('--ink'), surf = () => css('--surface-1');
  function ensure() {
    ready = true;
    if (!map.getSource('route')) map.addSource('route', { type: 'geojson', data: EMPTY });
    if (map.getLayer('route-ride')) return;
    const b = before(), w = (a, c, z0 = 11, z1 = 16) => ['interpolate', ['linear'], ['zoom'], z0, a, z1, c];
    const k = (...v) => ['in', ['get', 'kind'], ['literal', v]];
    const line = (id, filter, paint, layout = {}) => map.addLayer({ id, type: 'line', source: 'route', filter, layout: { 'line-join': 'round', 'line-cap': 'round', ...layout }, paint: { 'line-opacity': 0, ...paint } }, b);
    line('route-case', k('ride', 'approx'), { 'line-color': surf(), 'line-width': w(5.5, 11) });
    line('route-walk-case', k('walk'), { 'line-color': surf(), 'line-width': w(4.2, 6.4) });
    line('route-walk', k('walk'), { 'line-color': ink(), 'line-width': w(1.8, 2.8), 'line-dasharray': [1.5, 1.5] }, { 'line-cap': 'butt' });
    line('route-approx', k('approx'), { 'line-color': ['get', 'color'], 'line-width': w(2.6, 4.6), 'line-dasharray': [0.1, 2.1] });
    line('route-ride', k('ride'), { 'line-color': ['get', 'color'], 'line-width': w(3, 7) });
    map.addLayer({ id: 'route-dots', type: 'circle', source: 'route', filter: ['==', ['get', 'kind'], 'dot'], paint: {
      'circle-opacity': 0, 'circle-stroke-opacity': 0,
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, ['match', ['get', 'role'], 'transfer', 3.6, 2.6], 16, ['match', ['get', 'role'], 'transfer', 6.4, 4.4]],
      'circle-color': ['match', ['get', 'role'], 'transfer', ink(), ['coalesce', ['get', 'color'], ink()]],
      'circle-stroke-color': ['match', ['get', 'role'], 'transfer', surf(), ink()],
      'circle-stroke-width': ['match', ['get', 'role'], 'transfer', 2, 1.4] } }, b);
    if (drawn) { map.getSource('route').setData(routeGeoJSON(routeOf(drawn))); fade(false); }
  }
  /** Fade the layers in (or snap in under reduced motion): the geometry already changed in one setData. */
  function fade(animate = true) {
    for (const id of LAYERS) {
      if (!map.getLayer(id)) continue;
      const target = id === 'route-walk-case' ? 0.55 : id === 'route-case' ? 0.6 : id === 'route-approx' ? 0.95 : 1;
      for (const prop of FADE[id]) {
        const t = prop === 'circle-stroke-opacity' ? 1 : target;
        if (!animate || reduce()) { map.setPaintProperty(id, prop + '-transition', { duration: 0, delay: 0 }); map.setPaintProperty(id, prop, t); continue; }
        map.setPaintProperty(id, prop + '-transition', { duration: 0, delay: 0 }); map.setPaintProperty(id, prop, 0);
        requestAnimationFrame(() => { if (!map.getLayer(id)) return; map.setPaintProperty(id, prop + '-transition', { duration: 280, delay: 0 }); map.setPaintProperty(id, prop, t); });
      }
    }
  }
  function hideLayers() {
    for (const id of LAYERS) if (map.getLayer(id)) for (const prop of FADE[id]) { map.setPaintProperty(id, prop + '-transition', { duration: reduce() ? 0 : 160, delay: 0 }); map.setPaintProperty(id, prop, 0); }
  }
  function restyle() {
    if (!map.getLayer('route-ride')) return;
    for (const id of ['route-case', 'route-walk-case']) map.setPaintProperty(id, 'line-color', surf());
    map.setPaintProperty('route-walk', 'line-color', ink());
    map.setPaintProperty('route-dots', 'circle-color', ['match', ['get', 'role'], 'transfer', ink(), ['coalesce', ['get', 'color'], ink()]]);
    map.setPaintProperty('route-dots', 'circle-stroke-color', ['match', ['get', 'role'], 'transfer', surf(), ink()]);
  }

  // ---- labels (DOM markers: they stay crisp and need no glyph server)
  function marker(i) {
    if (pool[i]) return pool[i];
    const el = document.createElement('div');
    el.className = 'rt-mk';
    return (pool[i] = { el, marker: new maplibregl.Marker({ element: el, anchor: 'center' }) });
  }
  const bits = (p) => {
    const rb = (r) => (r.mode === 'subway' ? bullet(r.route) : routeBadge({ mode: 'bus', route: r.route }));
    const parts = [], rides = (p.rides || []).filter((r) => r.route);
    if (rides.length) parts.push(`<span class="rt-r">${rides.map(rb).join('<i aria-hidden="true">→</i>')}</span>`);
    const extra = [p.transfers ? `${p.transfers} transfer${p.transfers > 1 ? 's' : ''}` : '', p.approx && !p.straight ? 'path approximate' : '', p.straight ? 'straight line' : ''].filter(Boolean);
    if (extra.length) parts.push(`<span class="rt-x">${esc(extra.join(' · '))}</span>`);
    return parts.join('');
  };
  function setLabels(r, L) {
    const want2 = [];
    const p = r.pill;
    const mins = p.minutes != null ? Math.round(p.minutes) : null;
    want2.push({ cls: 'rt-pill', coord: p.coord, offset: [0, -24], html: `<b>${mins ?? '?'}</b><span>min</span>${bits(p)}`,
      aria: `${label(L)}: ${mins ?? 'unknown'} minutes${pillDetail(p) ? ', ' + pillDetail(p) : ''}`, px: Infinity });
    for (const b of r.badges) want2.push({ cls: 'rt-badge', coord: b.coord, offset: [0, 0], span: b.span, html: `${b.mode === 'subway' ? bullet(b.route) : routeBadge({ mode: 'bus', route: b.route })}<span>${Math.round(b.min || 0)}′</span>`, px: 70 });
    if (!(p.straight && r.walks.length === 1)) for (const w of r.walks) if (w.min != null && w.min >= 1.5) want2.push({ cls: 'rt-walk', coord: w.coord, offset: [0, 12], span: w.span, html: `${Math.round(w.min)}′ walk`, px: 78 });
    items = want2;
    want2.forEach((it, i) => {
      const m = marker(i);
      m.el.classList.remove('rt-pill', 'rt-badge', 'rt-walk', 'off', 'in'); m.el.classList.add('rt-mk', it.cls); m.el.innerHTML = it.html;   // classList, not className: MapLibre's own marker classes must survive
      if (it.aria) { m.el.setAttribute('role', 'img'); m.el.setAttribute('aria-label', it.aria); } else { m.el.removeAttribute('role'); m.el.removeAttribute('aria-label'); m.el.setAttribute('aria-hidden', 'true'); }
      m.marker.setLngLat(it.coord).setOffset(it.offset);
      if (!m.marker._map) m.marker.addTo(map);
    });
    for (let i = want2.length; i < pool.length; i++) pool[i].marker.remove();
    requestAnimationFrame(sizeCheck);
    requestAnimationFrame(() => pool.slice(0, want2.length).forEach((m) => m.el.classList.add('in')));
  }
  /** Hide small labels on short legs (their pixel length is under the label's room), re-checked while zooming. */
  function sizeCheck() {
    if (!drawn) return;
    const px = (sp) => { if (!sp) return 999; const p = map.project(sp[0]), q = map.project(sp[1]); return Math.hypot(p.x - q.x, p.y - q.y); };
    items.forEach((it, i) => { if (it.cls !== 'rt-pill') pool[i]?.el.classList.toggle('off', px(it.span) < it.px); });
  }
  const clearLabels = () => { pool.forEach((m) => { m.el.classList.remove('in'); }); clearTimeout(labelTimer); labelTimer = setTimeout(() => { if (!drawn) pool.forEach((m) => m.marker.remove()); }, reduce() ? 0 : 220); };

  function draw(id) {
    try { if (ready) ensure(); } catch { return; }   // the style is being swapped: onStyle re-adds the layers and redraws
    const r = id && active() && ready ? routeOf(id) : null;
    if (!r) { if (drawn) { drawn = null; hideLayers(); clearLabels(); } return; }
    drawn = id;
    clearTimeout(labelTimer);
    map.getSource('route').setData(routeGeoJSON(r));
    fade(true);
    setLabels(r, byId(id));
  }
  function effective() { return want ?? (S.sel && active() ? S.sel : null); }
  function schedule(delay) { clearTimeout(timer); timer = setTimeout(() => { const id = effective(); if (id !== drawn || (id && !map.getSource('route')?._data?.features?.length)) draw(id); }, delay); }
  map.on('zoomend', sizeCheck);
  map.on('moveend', sizeCheck);

  return {
    ensure, restyle,
    /** Hover input: an id shows that home's route after a short intent delay; null falls back to the open drawer's home. */
    hover(id) { if (id === want) return; want = id || null; schedule(want ? 60 : 140); },
    /** The drawer opened, closed or moved to another home, or the lens (mode, destination) changed. */
    refresh() { cache.clear(); const id = effective(); drawn = null; schedule(0); if (!id) hideLayers(); },
    sync() { schedule(0); },
    get drawn() { return drawn; },
    destroy() { clearTimeout(timer); pool.forEach((m) => m.marker.remove()); },
  };
}

/** Keep every preview current as the lens changes. Called once from the map and split-view hooks. */
const previews = new Set();
let wired = false;
export function registerPreview(p) {
  previews.add(p);
  if (wired) return p;
  wired = true;
  on('hover', (id) => previews.forEach((x) => x.hover(id)));
  on('select', () => previews.forEach((x) => x.sync()));
  on('commute', () => previews.forEach((x) => x.refresh()));
  on('theme', () => previews.forEach((x) => x.restyle()));
  return p;
}
export const unregisterPreview = (p) => { previews.delete(p); p.destroy(); };
