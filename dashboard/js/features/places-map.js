// Draws what the active place filters refer to on the map: the street a "east of 3rd Ave" is measured against, the two
// streets of a "between", the outline of a park or neighbourhood. An accent line or outline with the name, under the
// pins, gone when the chip is removed. (Solid, with a contrasting casing: the commute heat's own limit lines are dashed.) map.js passes in its map through bind() and calls refresh() after every style or
// heat change (a theme switch rebuilds the style and with it these layers).
import { S, on } from '../app.js';
import { css } from '../util.js';
import { getGeo } from './places.js';
import { clauseGeometry } from './places-geo.js';

const SRC = 'place-filter', SRC_L = 'place-filter-labels', IDS = ['pf-fill', 'pf-casing', 'pf-line', 'pf-label'];   // outlines and labels live in two sources: one that mixes polygons and points draws the polygons wrongly
let getMap = null;

export function bind(mapOf) {
  getMap = mapOf;
  on('filters', refresh);
}

const none = { type: 'FeatureCollection', features: [] };
function features() {
  const geo = getGeo();
  if (!geo) return { shapes: none, labels: none };
  const clauses = Object.entries(S.filters.nl || {}).filter(([k]) => k.startsWith('w:')).map(([, c]) => c);
  const all = clauses.flatMap((c) => clauseGeometry(geo, c));
  return { shapes: { type: 'FeatureCollection', features: all.filter((f) => f.properties.kind !== 'label') }, labels: { type: 'FeatureCollection', features: all.filter((f) => f.properties.kind === 'label') } };
}

/** Bring the layers in line with the filters (adds them when needed, empties them when there is nothing to show). */
export function refresh() {
  const m = getMap?.();
  if (!m) return;
  try {
    if (!m.isStyleLoaded?.() && !m.getStyle?.()) return;
    const data = features(), light = document.documentElement.dataset.theme === 'light', accent = css('--accent-strong') || css('--accent') || '#a6aeff';
    if (!m.getSource(SRC)) {
      if (!data.shapes.features.length) return;
      m.addSource(SRC, { type: 'geojson', data: data.shapes, tolerance: 0 });   // the outlines are already simplified to a few metres; MapLibre's own simplification mangles a closed ring
      const before = m.getLayer('pins') ? 'pins' : undefined;
      m.addLayer({ id: 'pf-fill', type: 'fill', source: SRC, filter: ['==', ['get', 'kind'], 'area'], paint: { 'fill-color': accent, 'fill-opacity': 0.16 } }, before);
      m.addLayer({ id: 'pf-casing', type: 'line', source: SRC, filter: ['in', ['get', 'kind'], ['literal', ['street', 'area']]], layout: { 'line-join': 'round' },
        paint: { 'line-color': light ? '#ffffff' : '#0b0d12', 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 4.4, 16, 7], 'line-opacity': 0.85 } }, before);
      m.addLayer({ id: 'pf-line', type: 'line', source: SRC, filter: ['in', ['get', 'kind'], ['literal', ['street', 'area']]], layout: { 'line-join': 'round' },
        paint: { 'line-color': accent, 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 2, 16, 3.4], 'line-opacity': 1 } }, before);
      m.addSource(SRC_L, { type: 'geojson', data: data.labels });
      m.addLayer({ id: 'pf-label', type: 'symbol', source: SRC_L,
        layout: { 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Bold'], 'text-size': 11, 'text-padding': 6, 'text-allow-overlap': false },
        paint: { 'text-color': accent, 'text-halo-color': light ? '#f0efea' : '#0e1116', 'text-halo-width': 1.6 } }, before);
    } else {
      m.getSource(SRC).setData(data.shapes);
      m.getSource(SRC_L)?.setData(data.labels);
      m.setPaintProperty('pf-fill', 'fill-color', accent);
      m.setPaintProperty('pf-line', 'line-color', accent);
      m.setPaintProperty('pf-casing', 'line-color', light ? '#ffffff' : '#0b0d12');
      m.setPaintProperty('pf-label', 'text-color', accent);
      m.setPaintProperty('pf-label', 'text-halo-color', light ? '#f0efea' : '#0e1116');
    }
  } catch { /* the style is being rebuilt: the next refresh draws it */ }
}
export const layerIds = () => IDS;
