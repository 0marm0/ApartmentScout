// Map view: MapLibre GL on keyless OpenFreeMap vector tiles in our own dark/light style, official
// subway lines, contour-band commute heat (masked by water and by the router's no-data cells),
// noise / rent / score surfaces, score-coloured pins, price tags and hover cards.
// Falls back to Esri raster tiles when vector tiles are switched off or fail.
import { S, on, emit, store, filtered, openDrawer, label, cost, commuteOf, loadJSON, dest, score, isSaved, sorted, setCommute, modeSegHTML, MODE_LABEL } from './app.js';
import { commuteLayerKey, walkRingMetres } from './criteria.js';
import { $, esc, money, moneyShort, safeUrl, css, scoreColor, unitGlyph, gridImage, gridValueAt, idwGrid, RAMPS, bullet, aerialHTML, imagesOf, imgFallback } from './util.js';
import { contours } from '../vendor/d3-contour.js';

const CLUSTER_Z = 12;                                 // below this zoom nearby pins merge into count bubbles
const UNCL = ['!', ['has', 'point_count']];
const selFilter = (id) => ['all', UNCL, ['==', ['get', 'id'], id || '']];
/** Starred homes (saved picks, or flagged favorite in the data): gold tags that are always drawn, and pins that never join a count bubble. */
const isStar = (L) => isSaved(L.id) || !!L.favorite;
const hoverState = (id, v) => { if (id != null) for (const source of ['listings', 'starred']) if (map.getSource(source)) map.setFeatureState({ source, id }, { hover: v }); };
const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const layers = {};          // name -> grid json
let map, popup, markers = [], destMarkers = [], inited = null, active = null, heat = 'commute', vector = true, offline = false, tileOk = false, show3d = false, showLines = true, picking = false;
/** The surface for the selected destination and mode (null for walk, or when that grid was never computed). */
const commuteLayer = () => { const k = commuteLayerKey(layers, dest(), S.commuteMode); return k ? layers[k] : null; };
const hasCommute = () => Object.values(layers).some((g) => /^commute/.test(g?.kind || '')) || (S.crit.commute?.destinations || []).some((d) => d.lat != null);
const walkKmh = () => S.crit.commute?.transit?.walk_speed_kmh || 4.8;

const PAL = {
  dark: { land: '#0e1116', park: '#0f1915', water: '#070b11', building: '#141820', buildingLine: '#1a1f29', minor: '#171b23', major: '#1f2530', motor: '#272e3b',
    label: '#5f6878', hood: '#a3acbb', halo: '#0e1116', waterLabel: '#34506d', rail: '#1d222b', station: '#e9edf3', stationLine: '#0e1116', ring: '#c9cfda', pinLine: '#0b0d12', caseOp: 0.55,
    clusterFill: '#0e1015', clusterInk: '#eef1f6' },
  light: { land: '#f0efea', park: '#dfe9d5', water: '#c6d8e6', building: '#e4e2dc', buildingLine: '#d8d5ce', minor: '#ffffff', major: '#ffffff', motor: '#fbeecb',
    label: '#717784', hood: '#5d6370', halo: '#f0efea', waterLabel: '#6c8ba6', rail: '#d9d7d0', station: '#ffffff', stationLine: '#2b303b', ring: '#3a4150', pinLine: '#ffffff', caseOp: 0.12,
    clusterFill: '#ffffff', clusterInk: '#12151c' },
};
const PAINT = [
  ['bg', 'background-color', 'land'], ['park', 'fill-color', 'park'], ['park2', 'fill-color', 'park'], ['water', 'fill-color', 'water'], ['waterway', 'line-color', 'water'],
  ['building', 'fill-color', 'building'], ['building', 'fill-outline-color', 'buildingLine'], ['b3d', 'fill-extrusion-color', 'building'],
  ['rd-minor', 'line-color', 'minor'], ['rd-major', 'line-color', 'major'], ['rd-motor', 'line-color', 'motor'], ['rail', 'line-color', 'rail'],
  ['lbl-road', 'text-color', 'label'], ['lbl-road', 'text-halo-color', 'halo'], ['lbl-hood', 'text-color', 'hood'], ['lbl-hood', 'text-halo-color', 'halo'], ['lbl-hoods', 'text-color', 'hood'], ['lbl-hoods', 'text-halo-color', 'halo'],
  ['lbl-water', 'text-color', 'waterLabel'], ['stations', 'circle-color', 'station'], ['stations', 'circle-stroke-color', 'stationLine'],
  ['lbl-station', 'text-color', 'label'], ['lbl-station', 'text-halo-color', 'halo'], ['walk-rings', 'line-color', 'ring'], ['lbl-rings', 'text-color', 'label'], ['lbl-rings', 'text-halo-color', 'halo'],
  ['line-case', 'line-opacity', 'caseOp'], ['clusters', 'circle-color', 'clusterFill'], ['cl-count', 'text-color', 'clusterInk'],
];
const theme = () => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');

function vectorStyle(p) {
  const font = ['Noto Sans Regular'];
  return {
    version: 8, glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: { omt: { type: 'vector', url: 'https://tiles.openfreemap.org/planet', attribution: '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>' } },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': p.land } },
      { id: 'park', type: 'fill', source: 'omt', 'source-layer': 'landuse', filter: ['in', ['get', 'class'], ['literal', ['park', 'cemetery', 'grass', 'pitch', 'garden']]], paint: { 'fill-color': p.park } },
      { id: 'park2', type: 'fill', source: 'omt', 'source-layer': 'park', paint: { 'fill-color': p.park, 'fill-opacity': 0.9 } },
      { id: 'building', type: 'fill', source: 'omt', 'source-layer': 'building', minzoom: 14, paint: { 'fill-color': p.building, 'fill-outline-color': p.buildingLine, 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 14, 0, 15, 1] } },
      { id: 'rail', type: 'line', source: 'omt', 'source-layer': 'transportation', filter: ['==', ['get', 'class'], 'rail'], paint: { 'line-color': p.rail, 'line-width': 1, 'line-dasharray': [3, 3] } },
      // the commute heat is inserted here: above streets and buildings, below water, so rivers stay clear
      { id: 'water', type: 'fill', source: 'omt', 'source-layer': 'water', paint: { 'fill-color': p.water } },
      { id: 'waterway', type: 'line', source: 'omt', 'source-layer': 'waterway', paint: { 'line-color': p.water, 'line-width': 1.5 } },
      { id: 'rd-minor', type: 'line', source: 'omt', 'source-layer': 'transportation', filter: ['all', ['!=', ['get', 'brunnel'], 'tunnel'], ['in', ['get', 'class'], ['literal', ['minor', 'service', 'tertiary']]]], layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': p.minor, 'line-opacity': 0.7, 'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 12, 0.4, 15, 3, 18, 14] } },
      { id: 'rd-major', type: 'line', source: 'omt', 'source-layer': 'transportation', filter: ['all', ['!=', ['get', 'brunnel'], 'tunnel'], ['in', ['get', 'class'], ['literal', ['primary', 'secondary', 'trunk']]]], layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': p.major, 'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 10, 0.6, 15, 5, 18, 22] } },
      { id: 'rd-motor', type: 'line', source: 'omt', 'source-layer': 'transportation', filter: ['all', ['!=', ['get', 'brunnel'], 'tunnel'], ['==', ['get', 'class'], 'motorway']], layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': p.motor, 'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 10, 1, 15, 6, 18, 26] } },
      { id: 'b3d', type: 'fill-extrusion', source: 'omt', 'source-layer': 'building', minzoom: 14, layout: { visibility: 'none' },
        paint: { 'fill-extrusion-color': p.building, 'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 10], 'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0], 'fill-extrusion-opacity': 0.85 } },
      { id: 'lbl-water', type: 'symbol', source: 'omt', 'source-layer': 'water_name', layout: { 'text-field': ['get', 'name:latin'], 'text-font': ['Noto Sans Italic'], 'text-size': 12, 'text-letter-spacing': 0.15 }, paint: { 'text-color': p.waterLabel } },
      { id: 'lbl-road', type: 'symbol', source: 'omt', 'source-layer': 'transportation_name', minzoom: 14.5, layout: { 'symbol-placement': 'line', 'text-field': ['get', 'name:latin'], 'text-font': font, 'text-size': 10.5 },
        paint: { 'text-color': p.label, 'text-halo-color': p.halo, 'text-halo-width': 1.5 } },
      { id: 'lbl-hood', type: 'symbol', source: 'omt', 'source-layer': 'place', filter: ['in', ['get', 'class'], ['literal', ['neighbourhood', 'suburb', 'quarter']]], minzoom: 12,
        layout: { 'text-field': ['upcase', ['get', 'name:latin']], 'text-font': ['Noto Sans Bold'], 'text-size': ['interpolate', ['linear'], ['zoom'], 12, 9.5, 15, 12], 'text-letter-spacing': 0.14, 'text-max-width': 7, 'text-padding': 6 },
        paint: { 'text-color': p.hood, 'text-halo-color': p.halo, 'text-halo-width': 1.6, 'text-opacity': 0.9 } },
    ],
  };
}
// Esri's keyless Canvas basemaps: the fallback when vector tiles are off or unreachable.
function rasterStyle() {
  const v = theme() === 'light' ? 'Light' : 'Dark', base = `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_${v}_Gray_`;
  const attribution = 'Tiles © Esri — Esri, HERE, Garmin, © OpenStreetMap contributors';
  return { version: 8, glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: { base: { type: 'raster', tiles: [base + 'Base/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 16, attribution }, ref: { type: 'raster', tiles: [base + 'Reference/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 16 } },
    layers: [{ id: 'bg', type: 'background', paint: { 'background-color': PAL[theme()].land } }, { id: 'esri', type: 'raster', source: 'base' }, { id: 'water', type: 'background', layout: { visibility: 'none' }, paint: { 'background-color': 'rgba(0,0,0,0)' } }, { id: 'esri-ref', type: 'raster', source: 'ref' }] };
}
// No tiles at all (offline, behind a proxy, or both tile hosts failing): a plain land colour. Pins, transit lines,
// rings and the heat layers come from local data and still draw on top; the 'esri-ref' stub keeps heat under them.
function offlineStyle() {
  const stub = (id) => ({ id, type: 'background', layout: { visibility: 'none' }, paint: { 'background-color': 'rgba(0,0,0,0)' } });
  return { version: 8, glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf', sources: {},
    layers: [{ id: 'bg', type: 'background', paint: { 'background-color': PAL[theme()].land } }, stub('water'), stub('esri-ref')] };
}
const baseStyle = () => customStyle() || (offline ? offlineStyle() : vector ? vectorStyle(PAL[theme()]) : rasterStyle());
function customStyle() {
  const t = S.crit.search?.tiles;
  if (!t) return null;
  return { version: 8, sources: { base: { type: 'raster', tiles: [t], tileSize: 256, attribution: S.crit.search.tiles_attribution || '' } }, layers: [{ id: 'esri', type: 'raster', source: 'base' }, { id: 'water', type: 'background', layout: { visibility: 'none' }, paint: { 'background-color': 'rgba(0,0,0,0)' } }] };
}

// ------------------------------------------------------------------ heat surfaces
/** Commute layer values: router minutes per cell (row-major from the south-west), -1 where blank. New layers carry
 *  them as base64 bytes of half-minutes (values_u8, 255 = blank); older ones as a plain `values` list. */
function decodeLayer(g) {
  if (!g || g.values || !g.values_u8) return g;
  const bin = atob(g.values_u8), sc = g.scale || 0.5, nd = g.nodata ?? 255, v = new Float32Array(bin.length);
  for (let i = 0; i < bin.length; i++) { const q = bin.charCodeAt(i); v[i] = q === nd ? -1 : q * sc; }
  return { ...g, values: v };
}
/** The surface value at a point, interpolated linearly between the four nearest cell centres exactly as the contours
 *  are, so the readout always agrees with the band under the cursor. null over blank cells (water, off the network). */
function heatValueAt(g, lat, lon) {
  const [lo0, la0, lo1, la1] = g.bbox, { rows, cols, values: V } = g;
  const fy = ((lat - la0) / (la1 - la0)) * rows - 0.5, fx = ((lon - lo0) / (lo1 - lo0)) * cols - 0.5;
  const rn = Math.round(fy), cn = Math.round(fx);
  if (rn < 0 || cn < 0 || rn >= rows || cn >= cols || !(V[rn * cols + cn] >= 0)) return null;
  const r0 = Math.floor(fy), c0 = Math.floor(fx), ty = fy - r0, tx = fx - c0;
  let s = 0, w = 0;
  for (const [dr, dc, k] of [[0, 0, (1 - ty) * (1 - tx)], [0, 1, (1 - ty) * tx], [1, 0, ty * (1 - tx)], [1, 1, ty * tx]]) {
    const r = r0 + dr, c = c0 + dc;
    if (r < 0 || c < 0 || r >= rows || c >= cols) continue;
    const v = V[r * cols + c]; if (v >= 0) { s += v * k; w += k; }
  }
  return w > 0 ? s / w : null;
}
const ringArea = (ring) => { let a = 0; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]); return a / 2; };
function inRing([x, y], ring) {
  let ins = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ins = !ins;
  }
  return ins;
}
/** Rings whose interiors XOR to one band (contour hi minus contour lo, nested level sets) grouped into polygons
 *  (outer ring + holes) by nesting depth, so MapLibre fills each band once and translucent bands never stack. */
function bandPolygons(rings) {
  const R = rings.filter((r) => r.length > 3).map((r) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of r) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
    return { r, b: [x0, y0, x1, y1], p: [(r[0][0] + r[1][0]) / 2, (r[0][1] + r[1][1]) / 2], area: Math.abs(ringArea(r)), depth: 0, parent: null };
  });
  R.sort((a, b) => b.area - a.area);   // a ring can only lie inside a bigger one
  for (let i = 0; i < R.length; i++) {
    const a = R[i];
    for (let j = 0; j < i; j++) {
      const o = R[j];
      if (a.p[0] < o.b[0] || a.p[0] > o.b[2] || a.p[1] < o.b[1] || a.p[1] > o.b[3] || !inRing(a.p, o.r)) continue;
      a.depth++; if (!a.parent || o.area < a.parent.area) a.parent = o;
    }
  }
  const polys = new Map();
  for (const a of R) if (a.depth % 2 === 0) polys.set(a, [ringArea(a.r) > 0 ? a.r : a.r.slice().reverse()]);   // outers counter-clockwise
  for (const a of R) if (a.depth % 2 === 1 && polys.has(a.parent)) polys.get(a.parent).push(ringArea(a.r) < 0 ? a.r : a.r.slice().reverse());
  // drop slivers (a few cm wide, where neighbouring contours squeeze against a blank edge)
  return [...polys.values()].filter((p) => p.reduce((s, r, k) => s + (k ? -1 : 1) * Math.abs(ringArea(r)), 0) > 0.02);
}
const BANDS = [5, 10, 15, 20, 25, 30, 40, 50, 120];   // band upper bounds, minutes (the last band reads "50+")
const LINES = (lim) => BANDS.filter((t) => t <= 50 || t === lim);
const bandLabel = (i) => (i === 0 ? `≤ ${BANDS[0]}` : i === BANDS.length - 1 ? `${BANDS[i - 1]}+` : `${BANDS[i - 1]}–${BANDS[i]}`);
const isoCache = new WeakMap();
/** Commute isochrones as vector polygons: one filled polygon set per 5-minute band (crisp at every zoom) and the
 *  contour lines between them, in lon/lat. The field is the router's own minutes at each cell centre (no blur); blank
 *  cells (water, far from any stop) are pushed out of every band after one ring of edge extension, so fills reach the
 *  shoreline and the basemap's water layer, drawn above, trims them exactly. */
function isochrones(g) {
  const lim = dest()?.max_minutes || 30, key = `${lim}`;
  const hit = isoCache.get(g); if (hit?.key === key) return hit;
  const { rows, cols, values: V } = g, W = cols + 2, H = rows + 2, BIG = 1e4;
  const valid = new Uint8Array(W * H), f = new Float64Array(W * H).fill(BIG);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { const v = V[r * cols + c]; if (v >= 0) { f[(r + 1) * W + c + 1] = v; valid[(r + 1) * W + c + 1] = 1; } }
  const ext = f.slice();
  for (let r = 1; r <= rows; r++) for (let c = 1; c <= cols; c++) {
    const i = r * W + c; if (valid[i]) continue;
    let s = 0, n = 0;
    for (const j of [i - 1, i + 1, i - W, i + W]) if (valid[j]) { s += f[j]; n++; }
    if (n) ext[i] = s / n;
  }
  const neg = Array.from(ext, (v) => -v);
  const eps = 1e-3, all = contours().size([W, H]).thresholds(BANDS.map((t) => -(t + eps)))(neg);
  const geom = BANDS.map((t) => all.find((x) => Math.abs(x.value + t + eps) < 1e-9)?.coordinates || []);
  const [lo0, la0, lo1, la1] = g.bbox, dx = (lo1 - lo0) / cols, dy = (la1 - la0) / rows;
  const toLL = ([x, y]) => [+(lo0 + (x - 1) * dx).toFixed(6), +(la0 + (y - 1) * dy).toFixed(6)];
  // group rings in grid units, before rounding to lon/lat: at the blank edge neighbouring contours run a few
  // centimetres apart and rounding would let them touch
  const ringsOf = (mp) => mp.flatMap((poly) => poly);
  const fills = [];
  BANDS.forEach((t, i) => {
    const polys = bandPolygons([...ringsOf(geom[i]), ...(i ? ringsOf(geom[i - 1]) : [])]).map((poly) => poly.map((ring) => ring.map(toLL)));
    if (polys.length) fills.push({ type: 'Feature', properties: { i, t, lo: i ? BANDS[i - 1] : 0 }, geometry: { type: 'MultiPolygon', coordinates: polys } });
  });
  // contour lines, minus the stretches that only trace the edge of the blank area
  const inside = (x, y) => { const c = Math.floor(x - 0.5), r = Math.floor(y - 0.5); return valid[r * W + c] && valid[r * W + c + 1] && valid[(r + 1) * W + c] && valid[(r + 1) * W + c + 1]; };
  const lines = [];
  for (const t of LINES(lim)) {
    const i = BANDS.indexOf(t); if (i < 0) continue;
    const runs = [];
    for (const poly of geom[i]) for (const ring of poly) {
      let cur = [];
      for (const pt of ring) { if (inside(pt[0], pt[1])) cur.push(toLL(pt)); else { if (cur.length > 2) runs.push(cur); cur = []; } }
      if (cur.length > 2) runs.push(cur);
    }
    if (runs.length) lines.push({ type: 'Feature', properties: { t, lim: t === lim, major: t === lim || t % 10 === 0, label: t === lim ? `${t} min limit` : `${t} min` }, geometry: { type: 'MultiLineString', coordinates: runs } });
  }
  const out = { key, fills: { type: 'FeatureCollection', features: fills }, lines: { type: 'FeatureCollection', features: lines } };
  isoCache.set(g, out);
  return out;
}
// colour: discrete, stepped bands. Each neighbour differs in hue AND lightness (CIE dE 18-29 on both basemaps, still
// 8+ under simulated deuteranopia) so a 5-minute step is visible at a glance: deep emerald (under 5), bright green,
// yellow-green, yellow from 15, gold, orange to 30, then red-orange, red and maroon past 50. A data scale like the
// official subway colours; the light basemap gets slightly deeper inks so yellow still reads on pale land.
const BAND_INK = {
  dark: ['#0b8f74', '#35c46a', '#b2dc52', '#faec66', '#eaa52c', '#e8721f', '#d9452d', '#b02638', '#6a1b3d'],
  light: ['#08775f', '#2aa957', '#94c53c', '#ecd21f', '#e09a17', '#dc6a17', '#c93c1f', '#a11d2f', '#5a1433'],
};
/** Fill colour and opacity per band: opaque enough to read as distinct steps; streets and labels draw above them. */
// Commute band palettes: 'rich' is the default; ?palette=balanced|vivid|earth|cool switches for comparison.
const PALETTES = {
  vivid: { ...BAND_INK, a: [0.78, 0.72] },
  rich: {       // default: between 'balanced' and 'vivid'. Three distinct greens to 15 (deep, mid, light), pale yellow
                // 15-20, gold 20-25, orange 25-30, then terracotta, red and maroon; neighbours differ by CIE dE ~20-30
    dark: ['#0a7a5e', '#30b064', '#a8db78', '#f6eb7d', '#eaae3b', '#e67b2e', '#d24e32', '#aa2e3a', '#681e3c'],
    light: ['#08664e', '#269853', '#8bc45c', '#e9d544', '#dc9e24', '#d76e24', '#c04226', '#982431', '#581832'], a: [0.74, 0.68] },
  balanced: {   // default. Middle ground: three distinct greens (deep / mid / light sage) to 15, pale yellow 15-20,
                // gold 20-25, orange 25-30, then terracotta, brick and maroon; neighbours differ by CIE dE ~22-35
    dark: ['#0a6447', '#2c9d5e', '#a3db8c', '#f3ea94', '#e9b84a', '#e3843d', '#cc5638', '#a3363b', '#66223a'],
    light: ['#07563d', '#23864f', '#86c46e', '#e6d86a', '#d9a332', '#d27330', '#b8482e', '#902c33', '#571c31'], a: [0.7, 0.64] },
  earth: {      // closer to the first prototype: muted, earthy
    dark: ['#2b7a52', '#4f9858', '#86ad5c', '#b8b45c', '#cfa651', '#c98748', '#b96643', '#9c4a40', '#6d3337'],
    light: ['#22694a', '#418a4c', '#759f4b', '#a8a446', '#be933c', '#b87436', '#a65533', '#8a3d33', '#5e2a2f'], a: [0.7, 0.62] },
  cool: {       // teal near, warm far
    dark: ['#0f7b72', '#28a08a', '#7cc5a4', '#d4e1a3', '#efd98a', '#efb877', '#e08a62', '#c35e58', '#8d3f55'],
    light: ['#0b665e', '#1f8a74', '#5daf87', '#b9c97a', '#e2c459', '#e39c4f', '#cc6e45', '#ad4744', '#792f45'], a: [0.68, 0.6] },
};
function bandStyle() {
  const light = theme() === 'light', P = PALETTES[new URLSearchParams(location.search).get('palette')] || PALETTES.rich;
  return P[light ? 'light' : 'dark'].map((col) => ({ col, a: P.a[light ? 1 : 0] }));
}
const idwScale = (like) => Math.max(1, Math.round(300 / (like.cell_m || 150)));   // ~300 m cells for listing-based surfaces
function rentGrid() {
  const like = Object.values(layers).find((g) => g?.rows);
  if (!like) return null;
  const pts = S.listings.filter((x) => x.lat != null && x.sqft && cost(x)).map((x) => ({ lat: x.lat, lon: x.lon, v: cost(x) / x.sqft }));
  return { ...idwGrid(pts, like, { cellScale: idwScale(like), radiusM: 650 }), kind: 'rent' };
}
function scoreGrid() {
  const like = Object.values(layers).find((g) => g?.rows);
  if (!like) return null;
  const pts = filtered().filter((x) => x.lat != null && score(x) != null).map((x) => ({ lat: x.lat, lon: x.lon, v: score(x) }));
  return { ...idwGrid(pts, like, { cellScale: idwScale(like), radiusM: 600 }), kind: 'score' };
}
const NOISE = (v) => RAMPS.noise.fn(v);
function heatImages(k) {
  if (k === 'commute') { const g = commuteLayer(); if (!g) return null; return { g, iso: isochrones(g) }; }
  if (k === 'noise') {
    const g = layers.noise; if (!g) return null;
    const per = 12 / (g.months || 12);
    return { g, fill: gridImage(g, NOISE, (v) => Math.min(0.92, 0.25 + Math.log10(v + 1) * 0.3), (v) => (v > 0 ? Math.log10(v * per + 1) : -1)), opacity: 0.75 };
  }
  if (k === 'rent') { const g = rentGrid(); return g && { g, fill: gridImage(g, RAMPS.rent.fn, () => 0.85), opacity: 0.55 }; }
  if (k === 'score') { const g = scoreGrid(); return g && { g, fill: gridImage(g, RAMPS.score.fn, () => 0.85), opacity: 0.5 }; }
  return null;
}
function setHeat(k) {
  heat = k;
  for (const id of ['heat-labels', 'heat-lim', 'heat-lines', 'heat-fill', 'heat']) if (map.getLayer(id)) map.removeLayer(id);
  for (const id of ['heat', 'heat-lines', 'heat-fill']) if (map.getSource(id)) map.removeSource(id);
  active = null;
  const im = heatImages(k);
  if (im) {
    active = im.g;
    const before = map.getLayer('water') && vector ? 'water' : map.getLayer('esri-ref') ? 'esri-ref' : undefined;
    if (im.iso) {
      // commute: vector bands under the water and the streets, thin contour lines, minute labels on the major ones
      const light = theme() === 'light', ink = light ? '#1d2230' : '#ffffff', lim = dest()?.max_minutes || 30, st = bandStyle();
      const byBand = (key) => ['match', ['get', 'i'], ...st.flatMap((x, i) => [i, x[key]]), key === 'a' ? 0 : '#000'];
      map.addSource('heat-fill', { type: 'geojson', data: im.iso.fills, tolerance: 0.2 });
      map.addLayer({ id: 'heat-fill', type: 'fill', source: 'heat-fill', paint: { 'fill-color': byBand('col'), 'fill-opacity': byBand('a'), 'fill-antialias': false } }, before);
      map.addSource('heat-lines', { type: 'geojson', data: im.iso.lines, tolerance: 0.2 });
      // lines above the streets (which would otherwise hide them in Manhattan's dense grid), below every label;
      // they stop short of blank cells, so they never cross water
      const above = vector && map.getLayer('lbl-water') ? 'lbl-water' : before;
      // (line-dasharray cannot be data-driven, so the dashed limit line is its own layer)
      map.addLayer({ id: 'heat-lines', type: 'line', source: 'heat-lines', filter: ['!', ['get', 'lim']], layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': ink, 'line-opacity': ['case', ['get', 'major'], light ? 0.34 : 0.3, light ? 0.18 : 0.15],
          'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.6, 16, ['case', ['get', 'major'], 1.3, 0.9]] } }, above);
      map.addLayer({ id: 'heat-lim', type: 'line', source: 'heat-lines', filter: ['get', 'lim'], layout: { 'line-join': 'round' },
        paint: { 'line-color': ink, 'line-opacity': 0.85, 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 1.5, 16, 2.4], 'line-dasharray': [2.5, 2] } }, above);
      map.addLayer({ id: 'heat-labels', type: 'symbol', source: 'heat-lines', minzoom: 12, filter: ['get', 'major'],
        layout: { 'symbol-placement': 'line', 'symbol-spacing': 380, 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Bold'], 'text-size': ['case', ['get', 'lim'], 11, 10], 'text-keep-upright': true, 'text-padding': 4, 'text-max-angle': 35 },
        paint: { 'text-color': ink, 'text-opacity': ['case', ['get', 'lim'], 0.95, 0.62], 'text-halo-color': light ? '#f0efea' : '#0e1116', 'text-halo-width': 1.6 } }, map.getLayer('line-case') ? 'line-case' : map.getLayer('cl-halo') ? 'cl-halo' : undefined);
    } else {
      const [lo0, la0, lo1, la1] = im.g.bbox, coordinates = [[lo0, la1], [lo1, la1], [lo1, la0], [lo0, la0]];
      map.addSource('heat', { type: 'image', url: im.fill, coordinates });
      map.addLayer({ id: 'heat', type: 'raster', source: 'heat', paint: { 'raster-opacity': im.opacity, 'raster-resampling': 'linear', 'raster-fade-duration': 0 } }, before);
    }
  }
  if (map.getLayer('pins')) map.setPaintProperty('pins', 'circle-color', k === 'commute' ? ['case', ['get', 'fav'], css('--accent'), theme() === 'light' ? '#2b303b' : '#eef1f6'] : ['get', 'col']);
  if (map.getLayer('pins-s')) map.setPaintProperty('pins-s', 'circle-color', k === 'commute' ? css('--accent') : ['get', 'col']);
  renderLegend(); renderSwitch();
}

// ------------------------------------------------------------------ overlays
function circle(lon, lat, m, n = 96) {
  const kx = 111320 * Math.cos((lat * Math.PI) / 180), ky = 110574;
  return Array.from({ length: n + 1 }, (_, i) => { const t = (i / n) * 2 * Math.PI; return [lon + (Math.cos(t) * m) / kx, lat + (Math.sin(t) * m) / ky]; });
}
function pinFeatures(star) {
  return { type: 'FeatureCollection', features: sorted(filtered()).filter((L) => L.lat != null && isStar(L) === star).reverse().map((L) => ({ type: 'Feature', id: L.id,
    properties: { id: L.id, col: scoreColor(score(L)), sc: score(L) ?? 50, fav: !!(isStar(L) || ['shortlist', 'touring', 'applied'].includes(L.status)), gone: L.status === 'gone' },
    geometry: { type: 'Point', coordinates: [L.lon, L.lat] } })) };
}
/** Clustered pins (everything except starred homes) and the always-visible starred pins live in two sources. */
const pinData = () => pinFeatures(false), starData = () => pinFeatures(true);
function setPins() { map.getSource('listings')?.setData(pinData()); map.getSource('starred')?.setData(starData()); }
/** Neighbourhood labels placed at the middle of each neighbourhood's listings (tiles rarely label them at city zoom). */
function hoodPoints() {
  const g = new Map();
  for (const L of S.listings) {
    if (L.lat == null || !L.neighborhood) continue;
    const n = L.neighborhood.split(/\s*[/(]\s*/)[0].trim(); if (!n || n.length > 22) continue;
    const a = g.get(n) || g.set(n, []).get(n); a.push([L.lon, L.lat]);
  }
  const med = (v) => v.sort((x, y) => x - y)[Math.floor(v.length / 2)];
  return { type: 'FeatureCollection', features: [...g].filter(([, pts]) => pts.length >= 3).map(([n, pts]) => ({ type: 'Feature', properties: { n: n.toUpperCase(), k: pts.length }, geometry: { type: 'Point', coordinates: [med(pts.map((q) => q[0])), med(pts.map((q) => q[1]))] } })) };
}
/** Walking rings around the selected destination: 10 and 20 minutes, and up to the commute limit in walk mode.
 *  Radius = minutes at the walking speed over a 1.25 street-detour factor, the same estimate the cards use. */
function ringMinutes() {
  const d = dest(); if (d?.lat == null) return [];
  if (S.commuteMode !== 'walk') return [10, 20];
  const lim = Math.max(20, d.max_minutes || 30);
  return [10, 20, 30, 45, 60].filter((m) => m <= lim + 5);
}
function ringData() {
  const d = dest(), mins = ringMinutes();
  return {
    rings: { type: 'FeatureCollection', features: mins.map((t) => ({ type: 'Feature', properties: { t: `${t} min walk` }, geometry: { type: 'LineString', coordinates: circle(d.lon, d.lat, walkRingMetres(t, walkKmh())) } })) },
    labels: { type: 'FeatureCollection', features: mins.map((t) => ({ type: 'Feature', properties: { t: `${t} min walk` }, geometry: { type: 'Point', coordinates: [d.lon, d.lat + walkRingMetres(t, walkKmh()) / 110574] } })) },
  };
}
function refreshRings() {
  if (!map?.getSource('rings')) return;
  const r = ringData();
  map.getSource('rings').setData(r.rings); map.getSource('ring-labels').setData(r.labels);
  const w = S.commuteMode === 'walk';
  map.setPaintProperty('walk-rings', 'line-opacity', w ? 0.9 : 0.55); map.setPaintProperty('walk-rings', 'line-width', w ? 1.6 : 1.2);
}
function addOverlays() {
  const p = PAL[theme()];
  {
    const r = ringData();
    map.addSource('rings', { type: 'geojson', data: r.rings });
    map.addSource('ring-labels', { type: 'geojson', data: r.labels });
    map.addLayer({ id: 'walk-rings', type: 'line', source: 'rings', paint: { 'line-color': p.ring, 'line-width': 1.2, 'line-opacity': 0.55, 'line-dasharray': [2, 3] } });
    map.addLayer({ id: 'lbl-rings', type: 'symbol', source: 'ring-labels', layout: { 'text-field': ['get', 't'], 'text-font': ['Noto Sans Regular'], 'text-size': 10, 'text-offset': [0, -0.7] }, paint: { 'text-color': p.label, 'text-halo-color': p.halo, 'text-halo-width': 2 } });
    refreshRings();
  }
  if (S.transit) {
    const fs = S.transit.features;
    map.addSource('lines', { type: 'geojson', data: { type: 'FeatureCollection', features: fs.filter((f) => f.properties.kind === 'line') } });
    map.addSource('stations', { type: 'geojson', data: { type: 'FeatureCollection', features: fs.filter((f) => f.properties.kind === 'station') } });
    const vis = showLines ? 'visible' : 'none';
    map.addLayer({ id: 'line-case', type: 'line', source: 'lines', layout: { 'line-join': 'round', 'line-cap': 'round', visibility: vis }, paint: { 'line-color': '#000', 'line-opacity': p.caseOp, 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 3, 15, 7] } });
    map.addLayer({ id: 'line', type: 'line', source: 'lines', layout: { 'line-join': 'round', 'line-cap': 'round', visibility: vis }, paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 1.4, 15, 3.6], 'line-opacity': 0.95 } });
    map.addLayer({ id: 'stations', type: 'circle', source: 'stations', minzoom: 12.5, layout: { visibility: vis }, paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 12.5, 1.8, 16, 4.5], 'circle-color': p.station, 'circle-stroke-color': p.stationLine, 'circle-stroke-width': 1.2 } });
    map.addLayer({ id: 'lbl-station', type: 'symbol', source: 'stations', minzoom: 15, layout: { visibility: vis, 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'text-size': 10.5, 'text-offset': [0, 1.1], 'text-anchor': 'top' }, paint: { 'text-color': p.label, 'text-halo-color': p.halo, 'text-halo-width': 1.5 } });
  }
  // zoomed out (below CLUSTER_Z) nearby pins merge into count bubbles ringed by their average score
  map.addSource('listings', { type: 'geojson', data: pinData(), promoteId: 'id', cluster: true, clusterMaxZoom: CLUSTER_Z - 1, clusterRadius: 36, clusterProperties: { s: ['+', ['get', 'sc']] } });
  const avg = ['/', ['get', 's'], ['get', 'point_count']];
  const avgCol = ['interpolate', ['linear'], avg, 30, css('--score-1'), 50, css('--score-2'), 65, css('--score-3'), 80, css('--score-4'), 95, css('--score-5')];
  map.addLayer({ id: 'cl-halo', type: 'circle', source: 'listings', filter: ['has', 'point_count'], paint: {
    'circle-radius': ['step', ['get', 'point_count'], 14, 10, 16, 40, 18, 120, 20], 'circle-color': avgCol, 'circle-opacity': 0.16, 'circle-blur': 0.25 } });
  map.addLayer({ id: 'clusters', type: 'circle', source: 'listings', filter: ['has', 'point_count'], paint: {
    'circle-radius': ['step', ['get', 'point_count'], 10, 10, 12, 40, 14, 120, 16], 'circle-color': p.clusterFill,
    'circle-stroke-width': ['case', ['boolean', ['feature-state', 'hover'], false], 2.5, 1.5], 'circle-stroke-color': avgCol } });
  map.addLayer({ id: 'cl-count', type: 'symbol', source: 'listings', filter: ['has', 'point_count'], layout: {
    'text-field': ['get', 'point_count_abbreviated'], 'text-font': ['Noto Sans Bold'], 'text-size': ['step', ['get', 'point_count'], 10.5, 40, 11], 'text-allow-overlap': true, 'text-ignore-placement': true },
    paint: { 'text-color': p.clusterInk } });
  map.addLayer({ id: 'pins-halo', type: 'circle', source: 'listings', filter: UNCL, paint: {
    'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, ['case', ['get', 'fav'], 8, 5], 15, ['case', ['get', 'fav'], 16, 12]],
    'circle-color': ['case', ['get', 'fav'], css('--accent'), '#000'], 'circle-blur': 0.9,
    'circle-opacity': ['case', ['get', 'fav'], 0.45, theme() === 'light' ? 0.12 : 0.4] } });
  map.addLayer({ id: 'pin-sel', type: 'circle', source: 'listings', filter: selFilter(S.sel), paint: {
    'circle-radius': 14, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-width': 2.5, 'circle-stroke-color': css('--accent'), 'circle-stroke-opacity': 0.9 } });
  map.addLayer({ id: 'pins', type: 'circle', source: 'listings', filter: UNCL, paint: {
    'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, ['case', ['get', 'fav'], 4, 2.6], 15, ['case', ['get', 'fav'], 9, 6.5]],
    'circle-color': heat === 'commute' ? ['case', ['get', 'fav'], css('--accent'), theme() === 'light' ? '#2b303b' : '#eef1f6'] : ['get', 'col'], 'circle-opacity': ['case', ['get', 'gone'], 0.35, 1],
    'circle-stroke-width': ['case', ['boolean', ['feature-state', 'hover'], false], 3, ['get', 'fav'], 2.2, 1.6],
    'circle-stroke-color': ['case', ['boolean', ['feature-state', 'hover'], false], css('--ink'), p.pinLine] } });
  // starred homes: their own unclustered source, so a count bubble never swallows them at any zoom
  map.addSource('starred', { type: 'geojson', data: starData(), promoteId: 'id' });
  map.addLayer({ id: 'pins-s-halo', type: 'circle', source: 'starred', paint: {
    'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 9, 15, 17], 'circle-color': css('--fav'), 'circle-blur': 0.8, 'circle-opacity': 0.5 } });
  map.addLayer({ id: 'pin-sel-s', type: 'circle', source: 'starred', filter: ['==', ['get', 'id'], S.sel || ''], paint: {
    'circle-radius': 14, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-width': 2.5, 'circle-stroke-color': css('--accent'), 'circle-stroke-opacity': 0.9 } });
  map.addLayer({ id: 'pins-s', type: 'circle', source: 'starred', paint: {
    'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 4.5, 15, 9], 'circle-color': heat === 'commute' ? css('--accent') : ['get', 'col'], 'circle-opacity': ['case', ['get', 'gone'], 0.35, 1],
    'circle-stroke-width': ['case', ['boolean', ['feature-state', 'hover'], false], 3, 2.2],
    'circle-stroke-color': ['case', ['boolean', ['feature-state', 'hover'], false], css('--ink'), p.pinLine] } });
  const hoods = hoodPoints();
  map.addSource('hoods', { type: 'geojson', data: hoods });
  // one label per neighbourhood: where our listing-placed label exists, hide the basemap's copy of the same name
  if (map.getLayer('lbl-hood')) {
    const ALIAS = { "HELL'S KITCHEN": ['CLINTON'], 'HELLS KITCHEN': ['CLINTON'] };   // OSM's older name for the same place
    const names = [...new Set(hoods.features.flatMap(({ properties: { n } }) => [n, n.replace(/['’]/g, ''), n.replace(/'/g, '’'), n.replace(/’/g, "'"), ...(ALIAS[n] || [])]))];
    map.setFilter('lbl-hood', ['all', ['in', ['get', 'class'], ['literal', ['neighbourhood', 'suburb', 'quarter']]], ['!', ['in', ['upcase', ['coalesce', ['get', 'name:latin'], ['get', 'name'], '']], ['literal', names]]]]);
  }
  map.addLayer({ id: 'lbl-hoods', type: 'symbol', source: 'hoods', minzoom: 11.5, layout: { 'text-field': ['get', 'n'], 'text-font': ['Noto Sans Bold'], 'text-size': ['interpolate', ['linear'], ['zoom'], 12, 10, 15, 13], 'text-letter-spacing': 0.12, 'text-max-width': 8, 'symbol-sort-key': ['-', 0, ['get', 'k']], 'text-padding': 8 },
    paint: { 'text-color': p.hood, 'text-halo-color': p.halo, 'text-halo-width': 1.8 } });
  setHeat(heat);
}
let tagIds = new Set();      // tags on the map before this redraw: only new ones animate in
function drawTags() {
  markers.forEach((m) => m.remove()); markers = [];
  const before = tagIds; tagIds = new Set();
  let fresh = 0;
  const F = sorted(filtered()).filter((L) => L.lat != null), pick = new Map();
  F.slice(0, 12).forEach((L) => pick.set(L.id, L));
  F.filter(isStar).forEach((L) => pick.set(L.id, L));
  if (S.sel) { const L = S.listings.find((x) => x.id === S.sel); if (L?.lat != null) pick.set(L.id, L); }
  for (const L of pick.values()) {
    // MapLibre positions a marker by setting `transform` on its root element, so the root stays unstyled and the
    // tag (which animates its own transform on hover and selection) lives inside it; otherwise tags drift on pan.
    const root = document.createElement('div');
    root.className = 'tag-anchor';
    const el = document.createElement('button');
    el.type = 'button';
    el.className = `price-tag ${S.sel === L.id ? 'sel' : ''} ${isStar(L) ? 'fav' : ''}`;
    el.dataset.id = L.id;
    el.setAttribute('aria-label', `${label(L)}, ${money(cost(L))} a month`);
    el.innerHTML = `<i style="--c:${scoreColor(score(L))}">${Math.round(score(L) ?? 0)}</i>${isSaved(L.id) ? '<svg class="st" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 1.6l1.9 4 4.4.5-3.3 3 .9 4.3L8 11.2 4.1 13.4 5 9.1 1.7 6.1l4.4-.5z"/></svg>' : ''}${moneyShort(cost(L))}`;
    el.addEventListener('click', (e) => { e.stopPropagation(); if (!picking) openDrawer(L.id); });
    el.addEventListener('mouseenter', () => emit('hover', L.id));
    el.addEventListener('mouseleave', () => emit('hover', null));
    if (!before.has(L.id) && !reduce()) { el.classList.add('enter'); el.style.animationDelay = `${Math.min(fresh++, 14) * 28}ms`; }
    tagIds.add(L.id);
    root.append(el);
    markers.push(new maplibregl.Marker({ element: root, anchor: 'bottom', offset: [0, -6] }).setLngLat([L.lon, L.lat]).addTo(map));
  }
  declutter();
}
/** Hide price tags that collide with a better-ranked tag (the circle pin underneath stays), and all but the
 *  selected tag while pins are clustered. Starred and selected tags are placed first: they are never hidden, and
 *  an ordinary tag yields to them. Tags fade and settle rather than blink. */
function declutter() {
  const shown = [], low = map.getZoom() < CLUSTER_Z - 0.35;
  const rows = markers.map((m) => { const el = m.getElement(), tag = el.firstElementChild; return { el, tag, r: el.getBoundingClientRect(), fixed: tag.classList.contains('fav') || tag.classList.contains('sel') }; });
  for (const row of [...rows.filter((x) => x.fixed), ...rows.filter((x) => !x.fixed)]) {
    const { r } = row;
    const hide = !row.fixed && (low || shown.some((q) => r.left < q.right + 4 && r.right > q.left - 4 && r.top < q.bottom + 3 && r.bottom > q.top - 3));
    row.el.classList.toggle('hid', hide);
    row.tag.tabIndex = hide ? -1 : 0;
    if (!hide) shown.push(r);
  }
}
let pulseRaf = 0;
function pulse() {
  cancelAnimationFrame(pulseRaf);
  if (!S.sel || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const t0 = performance.now();
  const step = (t) => {
    if (!map.getLayer('pin-sel') || !S.sel) return;
    const k = ((t - t0) % 1600) / 1600;
    for (const id of ['pin-sel', 'pin-sel-s']) if (map.getLayer(id)) { map.setPaintProperty(id, 'circle-radius', 11 + k * 12); map.setPaintProperty(id, 'circle-stroke-opacity', 0.9 * (1 - k)); }
    pulseRaf = requestAnimationFrame(step);
  };
  pulseRaf = requestAnimationFrame(step);
}
// ------------------------------------------------------------------ mini card: the last opened home stays on the map after the drawer closes
let lastSel = null, pendingFly = null;
function flyTo(id) {
  const L = id && S.listings.find((x) => x.id === id);
  if (L?.lat != null && S.view === 'map') map.easeTo({ center: [L.lon, L.lat], zoom: Math.max(map.getZoom(), 14.2), padding: { right: innerWidth > 760 ? 460 : 0, bottom: innerWidth > 760 ? 0 : innerHeight * 0.5 }, duration: reduce() ? 0 : 700 });
}
function showCard(id) {
  const L = id && S.listings.find((x) => x.id === id);
  let el = $('mapCard');
  if (!L || S.view !== 'map') { hideCard(); return; }
  if (!el) {
    el = document.createElement('div');
    el.id = 'mapCard'; el.className = 'float mcard'; el.hidden = true;
    el.setAttribute('role', 'region'); el.setAttribute('aria-label', 'Last opened home');
    $('view-map').append(el);
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-x]')) { hideCard(true); return; }
      if (lastSel) openDrawer(lastSel, { fly: !!e.target.closest('[data-fly]') });
    });
  }
  const im = imagesOf(L), ph = im.own[0] || im.building[0]?.url, sv = score(L), cm = commuteOf(L);
  const cml = S.commuteMode === 'best' ? '' : ' by ' + MODE_LABEL[S.commuteMode].toLowerCase();
  el.innerHTML = `<div class="mc-ph">${ph ? `<img src="${esc(ph)}" alt="" referrerpolicy="no-referrer"${im.own[0] ? imgFallback(L, 0) : ''}>` : L.lat != null ? aerialHTML(L, 88, 88, 18) : `<div class="glyph">${unitGlyph(L, 88, 88)}</div>`}</div>
    <div class="mc-b"><div class="mc-t">${esc(L.building || L.address)} <span>${esc(L.unit || '')}</span></div>
      <div class="mc-s">${esc([L.neighborhood, L.sqft ? Math.round(L.sqft) + ' ft²' : null, cm != null ? `${Math.round(cm)} min${cml} to ${dest()?.name || 'work'}` : null].filter(Boolean).join(' · '))}</div>
      <div class="mc-p"><b>${money(cost(L))}</b><span>/mo</span><i class="mc-sc" style="--c:${scoreColor(sv)}">${sv == null ? '?' : Math.round(sv)}</i></div>
      <div class="mc-a"><button type="button" class="btn sm primary">Details</button><button type="button" class="btn sm ghost" data-fly>Show on map</button></div></div>
    <button type="button" class="icon-btn sm mc-x" data-x aria-label="Dismiss" title="Dismiss (Esc)"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg></button>`;
  el.hidden = false;
  requestAnimationFrame(() => el.classList.add('on'));
}
function hideCard(forget = false) {
  const el = $('mapCard'); if (forget) lastSel = null;
  if (!el || el.hidden) return;
  el.classList.remove('on');
  setTimeout(() => { if (!el.classList.contains('on')) el.hidden = true; }, reduce() ? 0 : 220);
}

/** Map-pin teardrop in the destination green with a filled white briefcase (same artwork as assets/icons/office-pin.svg). */
const DEST_PIN_SVG = '<svg viewBox="0 0 30 38" aria-hidden="true" focusable="false"><path fill="var(--dest-pin)" stroke="#fff" stroke-width="1.4" stroke-linejoin="round" d="M15 .8C7.6.8 1.8 6.7 1.8 14c0 9.4 13.2 23.2 13.2 23.2S28.2 23.4 28.2 14C28.2 6.7 22.4.8 15 .8Z"/><path fill="#fff" fill-rule="evenodd" d="M11.1 9.7V8.4c0-1.1.9-2 2-2h3.8c1.1 0 2 .9 2 2v1.3h-1.9V8.5c0-.1-.1-.2-.2-.2h-3.6c-.1 0-.2.1-.2.2v1.2Z"/><path fill="#fff" d="M9.7 9.5h10.6c1.2 0 2.2 1 2.2 2.2v7.1c0 1.2-1 2.2-2.2 2.2H9.7c-1.2 0-2.2-1-2.2-2.2v-7.1c0-1.2 1-2.2 2.2-2.2Z"/><path fill="var(--dest-pin)" d="M7.5 14h15v1.3h-15Z"/><rect fill="var(--dest-pin)" x="13.4" y="12.9" width="3.2" height="3.5" rx=".6"/></svg>';
function addDest() {
  destMarkers.forEach((m) => m.remove()); destMarkers = [];
  const sel = dest();
  for (const d of S.crit.commute?.destinations || []) {
    if (d.lat == null) continue;
    const on2 = d === sel, el = document.createElement('div');
    el.className = `dest-mk ${on2 ? 'on' : 'off'}`;
    el.innerHTML = `<div class="dest-pin" title="${esc(d.name)}">${DEST_PIN_SVG}</div><div class="dest-label">${esc(d.name)}${on2 ? `<span>${esc((d.address || '').split(',')[0])}${d.arrive_by ? ' · arrive ' + esc(d.arrive_by) : ''}</span>` : ''}</div>`;
    if (!on2) { el.title = `Show the commute to ${d.name}`; el.addEventListener('click', (e) => { e.stopPropagation(); if (!picking) setCommute({ dest: d.name }); }); }
    destMarkers.push(new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([d.lon, d.lat]).addTo(map));
  }
}
/** Let the renter click a spot for a destination; resolves {lat, lon}, or null on Esc / Cancel. */
export function pickPoint(name = 'the destination') {
  return new Promise((resolve) => {
    if (!map) { resolve(null); return; }
    picking = true;
    const cv = map.getCanvas(); cv.style.cursor = 'crosshair'; popup?.remove();
    const hint = document.createElement('div');
    hint.className = 'float pick-hint'; hint.setAttribute('role', 'status');
    hint.innerHTML = `<span>Click the map to place <b>${esc(name)}</b></span><button type="button" class="btn sm ghost">Cancel</button>`;
    $('view-map').append(hint);
    const done = (pt) => { picking = false; cv.style.cursor = ''; map.off('click', onClick); removeEventListener('keydown', onKey, true); hint.remove(); resolve(pt); };
    const onClick = (e) => done({ lat: e.lngLat.lat, lon: e.lngLat.lng });
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(null); } };
    hint.querySelector('button').addEventListener('click', () => done(null));
    map.on('click', onClick); addEventListener('keydown', onKey, true);
  });
}

// ------------------------------------------------------------------ chrome
function renderSwitch() {
  const opts = [['commute', 'Commute', 'linear-gradient(90deg,#1fbf75,#e8a640,#dc5a43)'], ['noise', 'Noise', '#8e4fd6'], ['rent', 'Rent / ft²', '#ee8a3a'], ['score', 'Score', 'var(--score-4)'], ['none', 'None', 'transparent']]
    .filter(([k]) => (k === 'commute' ? hasCommute() : k === 'noise' ? !!layers.noise : true));
  $('layerSwitch').innerHTML = opts.map(([k, t, c]) => `<button type="button" class="${heat === k ? 'on' : ''}" data-layer="${k}" aria-pressed="${heat === k}"><i style="background:${c}"></i>${t}</button>`).join('');
  $('layerSwitch').querySelectorAll('[data-layer]').forEach((b) => b.addEventListener('click', () => setHeat(b.dataset.layer)));
}
const legendMin = () => store.get('legend-min', null) ?? innerWidth < 1180;
function renderLegend() {
  const lineChips = (S.transit?.features || []).filter((f) => f.properties.kind === 'line').flatMap((f) => f.properties.routes.filter((r) => r.length < 3)).map(bullet).join('');
  const g = active, d = dest(), lim = d?.max_minutes || 30, mode = S.commuteMode, ml = MODE_LABEL[mode].toLowerCase();
  let body = '';
  if (heat === 'commute') {
    const st = bandStyle(), ds = S.crit.commute?.destinations || [];
    const what = { best: 'Fastest door-to-door minutes by subway, bus or walking', subway: 'Subway with walking only (no buses)', bus: 'Bus with walking only (no subway)' }[mode];
    body = `<h4>${ds.length > 1 ? `<select class="sel lg-dest" id="lgDest" aria-label="Commute destination">${ds.map((x) => `<option value="${esc(x.name)}" ${x === d ? 'selected' : ''}>To ${esc(x.name)}</option>`).join('')}</select>` : `Door to door to ${esc(d?.name || '')}`} <span>arrive ${esc(d?.arrive_by || '')}</span></h4>
      ${modeSegHTML(d, 'lgMode')}
      ${g ? `<div class="isogrid" role="list" aria-label="Door-to-door minutes by colour band" style="display:grid;grid-template-columns:repeat(3,1fr);gap:5px 10px;margin:2px 0 2px">${BANDS.map((t, i) => {
        const isLim = (i ? BANDS[i - 1] : 0) < lim && lim <= t;
        return `<span role="listitem" style="display:flex;align-items:center;gap:6px;font:500 var(--fs-2xs) var(--font-mono);font-variant-numeric:tabular-nums;color:${isLim ? 'var(--ink)' : 'var(--ink-2)'};white-space:nowrap"><i style="flex:none;width:18px;height:11px;border-radius:3px;background:${st[i].col};${isLim ? 'box-shadow:0 0 0 1.5px var(--ink)' : 'box-shadow:inset 0 0 0 1px rgba(0,0,0,.18)'}"></i>${isLim ? `<b style="font-weight:650" title="Your ${lim}-minute limit">${bandLabel(i)}</b>` : bandLabel(i)}</span>`;
      }).join('')}</div>
      <details class="src-d" ${store.get('legend-src', false) ? 'open' : ''}><summary>How this is computed</summary><div class="src">${what} on the ${esc(g.feeds?.length ? g.feeds.join(', ') + ' timetable' : 'walking network')}, the router's answer every ${esc(Math.round(g.cell_m || 150))} m, averaged over ${g.arrival_offsets_min?.length || 'several'} arrivals${g.arrival_offsets_min?.length ? ` in the ${Math.max(...g.arrival_offsets_min)} minutes before ${esc(d?.arrive_by || 'arrival')}` : ''}. Each colour is a 5-minute band (10-minute bands past 30); the outlined swatch and the dashed line mark your ${lim}-minute limit. ${g.water_masked ? 'Water and areas' : 'Areas'} beyond walking range of a stop are left clear.</div></details>`
      : mode === 'walk' ? `<div class="src">Walking has no timetable surface. The dashed rings are ${ringMinutes().join(', ')} minutes on foot at ${walkKmh()} km/h, straight line with a 1.25 street detour. Cards, filters and columns use the router's walking minutes where it has them, else the same estimate.</div>`
      : `<div class="src">No ${ml} surface for ${esc(d?.name || 'this destination')}${d?._stale ? ' (new or moved in your edited criteria)' : ''}. Run <code>apartmentscout commute</code>${mode === 'bus' ? ' with a bus GTFS feed' : ''} to draw it. Pins, cards and filters use per-listing ${ml} minutes where the router computed them.</div>`}`;
  } else if (heat === 'noise' && g) {
    body = `<h4>311 noise complaints <span>per year, ${esc(g.cell_m)} m cells</span></h4><div class="bar" style="height:8px;border-radius:2px;background:${RAMPS.noise.css}"></div><div class="ticks"><span>0</span><span>10</span><span>100</span><span>1k</span><span>4k</span></div><div class="src">${(g.total || 0).toLocaleString()} requests since ${esc(g.since || '')}. Calls are reports, not findings.</div>`;
  } else if (heat === 'rent') {
    body = `<h4>Monthly cost per ft² <span>from listings</span></h4><div class="bar" style="height:8px;border-radius:2px;background:${RAMPS.rent.css}"></div><div class="ticks"><span>$3</span><span>$5</span><span>$7</span><span>$9</span><span>$12+</span></div>`;
  } else if (heat === 'score') {
    body = `<h4>Average score nearby <span>with your weights</span></h4><div class="bar" style="height:8px;border-radius:2px;background:${RAMPS.score.css}"></div><div class="ticks"><span>30</span><span>50</span><span>65</span><span>80</span><span>95</span></div>`;
  } else body = `<h4>Listings <span>pins coloured by score</span></h4><div class="bar" style="height:8px;border-radius:2px;background:${RAMPS.score.css}"></div><div class="ticks"><span>30</span><span>50</span><span>65</span><span>80</span><span>95</span></div>`;
  // the legend folds to its title and scale (default on narrow screens); the choice is remembered
  const min = legendMin();
  $('legend').classList.toggle('min', min);
  $('legend').innerHTML = `<button type="button" class="lg-tog" id="lgTog" aria-expanded="${!min}" aria-controls="legend" title="${min ? 'Show the full legend' : 'Fold the legend'}" aria-label="${min ? 'Show the full legend' : 'Fold the legend'}"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M4 10l4-4 4 4"/></svg></button>`
    + body + (lineChips && showLines ? `<div class="lines">${lineChips}</div>` : '');
  $('lgTog').addEventListener('click', () => { store.set('legend-min', !min); renderLegend(); $('lgTog')?.focus(); });
  $('legend').querySelector('.src-d')?.addEventListener('toggle', (e) => store.set('legend-src', e.target.open));
  $('lgDest')?.addEventListener('change', (e) => setCommute({ dest: e.target.value }));
  $('legend').querySelectorAll('#lgMode [data-mode]').forEach((b) => b.addEventListener('click', () => setCommute({ mode: b.dataset.mode })));
}
function renderCtl() {
  const b = (id, title, svg, on2) => `<button type="button" data-ctl="${id}" title="${title}" aria-label="${title}" class="${on2 ? 'on' : ''}" aria-pressed="${!!on2}">${svg}</button>`;
  $('mapCtl').innerHTML = b('in', 'Zoom in', '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M8 3v10M3 8h10"/></svg>') +
    b('out', 'Zoom out', '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 8h10"/></svg>') + '<hr>' +
    b('fit', 'Fit the listings', '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4"/></svg>') +
    (S.transit ? b('lines', 'Transit lines', '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="4" y="2" width="8" height="9" rx="2.5"/><path d="M5.5 14l1.2-2.5M10.5 14l-1.2-2.5M4 7h8"/></svg>', showLines) : '') +
    (vector ? b('3d', 'Tilt with 3D buildings', '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 2l5.5 3v6L8 14l-5.5-3V5zM8 8l5.5-3M8 8v6M8 8L2.5 5"/></svg>', show3d) : '') +
    b('base', vector ? 'Switch to the raster basemap' : 'Switch to the vector basemap', '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 2L2 5l6 3 6-3zM2 8l6 3 6-3M2 11l6 3 6-3"/></svg>', !vector);
  $('mapCtl').querySelectorAll('[data-ctl]').forEach((el) => el.addEventListener('click', () => {
    const k = el.dataset.ctl;
    if (k === 'in' || k === 'out') map.easeTo({ zoom: map.getZoom() + (k === 'in' ? 1 : -1), duration: 250 });
    if (k === 'fit') fit();
    if (k === 'lines') { showLines = !showLines; for (const id of ['line-case', 'line', 'stations', 'lbl-station']) map.getLayer(id) && map.setLayoutProperty(id, 'visibility', showLines ? 'visible' : 'none'); renderLegend(); }
    if (k === '3d') { show3d = !show3d; map.setLayoutProperty('b3d', 'visibility', show3d ? 'visible' : 'none'); map.easeTo({ pitch: show3d ? 55 : 0, bearing: show3d ? -17 : 0, zoom: show3d ? Math.max(map.getZoom(), 15) : map.getZoom(), duration: 900 }); }
    if (k === 'base') { if (offline) { offline = false; vector = true; } else vector = !vector; rebuild(); }
    renderCtl();
  }));
}
function fit() {
  const pts = filtered().filter((L) => L.lat != null);
  if (!pts.length) return;
  const b = new maplibregl.LngLatBounds();
  pts.forEach((L) => b.extend([L.lon, L.lat]));
  map.fitBounds(b, { padding: { top: 70, bottom: 70, left: 60, right: S.sel ? 480 : 60 }, duration: 700, maxZoom: 15 });
}
function readout(e) {
  const el = $('readout'), g = active;
  if (!g || !g.rows) { el.hidden = true; return; }
  const r = heat === 'commute' ? { v: heatValueAt(g, e.lngLat.lat, e.lngLat.lng) } : gridValueAt(g, e.lngLat.lat, e.lngLat.lng);
  if (!r || r.v == null || r.v < 0) { el.hidden = true; return; }
  let t;
  if (heat === 'commute') t = `<i aria-hidden="true" style="display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:6px;background:${bandStyle()[Math.max(0, BANDS.findIndex((x) => r.v <= x + 1e-3))].col}"></i><b>${Math.round(r.v)} min</b> <span class="faint">${S.commuteMode === 'best' ? 'door to door' : 'by ' + MODE_LABEL[S.commuteMode].toLowerCase()} to ${esc(dest()?.name || g.name)}</span>`;
  else if (heat === 'noise') t = `<b>${Math.round((r.v * 12) / (g.months || 12))}</b> <span class="faint">noise complaints a year in this ${esc(g.cell_m)} m cell${g.night ? ` (${g.night[r.i] ?? 0} at night)` : ''}</span>`;
  else if (heat === 'rent') t = `<b>$${r.v.toFixed(2)}</b> <span class="faint">per ft² a month nearby</span>`;
  else t = `<b>${Math.round(r.v)}</b> <span class="faint">average score nearby</span>`;
  el.innerHTML = t; el.hidden = false;
}

// ------------------------------------------------------------------ lifecycle
function wire() {
  let hov = null;
  const onPins = (type, fn) => { map.on(type, 'pins', fn); map.on(type, 'pins-s', fn); };
  onPins('mousemove', (e) => {
    const f = e.features[0]; map.getCanvas().style.cursor = 'pointer';
    if (hov !== f.id) { if (hov) hoverState(hov, false); hov = f.id; hoverState(hov, true); }
    const L = S.listings.find((x) => x.id === f.id); if (!L) return;
    const im = imagesOf(L), ph = im.own[0] || im.building[0]?.url;
    if (picking) return;
    const cm = commuteOf(L), cml = S.commuteMode === 'best' ? '' : ' ' + MODE_LABEL[S.commuteMode].toLowerCase();
    popup.setLngLat([L.lon, L.lat]).setHTML(`<div class="hovercard">${ph ? `<img src="${esc(ph)}" alt="" referrerpolicy="no-referrer">` : aerialHTML(L, 236, 118, 18)}<div class="hb"><div class="t">${esc(label(L))}</div><div class="s">${esc(L.neighborhood || '')}${L.sqft ? ' · ' + Math.round(L.sqft) + ' ft²' : ''}</div><div class="p"><b>${money(cost(L))}/mo</b><span>${cm != null ? Math.round(cm) + ' min' + cml + ' · ' : ''}score ${Math.round(score(L) ?? 0)}</span></div></div></div>`).addTo(map);
  });
  onPins('mouseleave', () => { map.getCanvas().style.cursor = ''; if (hov) hoverState(hov, false); hov = null; popup.remove(); });
  onPins('click', (e) => { if (!picking) openDrawer(e.features[0].id); });
  // a count bubble zooms to the level where it splits
  map.on('click', 'clusters', async (e) => {
    if (picking) return;
    const f = e.features[0], src = map.getSource('listings');
    let z = map.getZoom() + 1.5;
    try { z = await src.getClusterExpansionZoom(f.properties.cluster_id); } catch { /* keep the fallback zoom */ }
    map.easeTo({ center: f.geometry.coordinates, zoom: Math.min(z + 0.25, 16), duration: reduce() ? 0 : 650 });
  });
  let hc = null;
  map.on('mousemove', 'clusters', (e) => {
    map.getCanvas().style.cursor = 'pointer';
    const id = e.features[0].id;
    if (hc !== id) { if (hc != null) map.setFeatureState({ source: 'listings', id: hc }, { hover: false }); hc = id; if (id != null) map.setFeatureState({ source: 'listings', id }, { hover: true }); }
  });
  map.on('mouseleave', 'clusters', () => { map.getCanvas().style.cursor = ''; if (hc != null) map.setFeatureState({ source: 'listings', id: hc }, { hover: false }); hc = null; });
  // clicking empty map dismisses the mini card
  map.on('click', (e) => {
    if (picking || !$('mapCard') || $('mapCard').hidden) return;
    if (!map.queryRenderedFeatures(e.point, { layers: ['pins', 'pins-s', 'clusters'].filter((l) => map.getLayer(l)) }).length) hideCard(true);
  });
  map.on('mousemove', readout);
  map.on('mouseout', () => ($('readout').hidden = true));
  let raf = 0;
  map.on('move', () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(declutter); });
}
function onStyle() {
  if (vector) PAINT.forEach(([id, prop, key]) => map.getLayer(id) && map.setPaintProperty(id, prop, PAL[theme()][key]));
  addOverlays(); drawTags();
  $('attrib').innerHTML = (offline ? 'Basemap offline' : vector ? '© <a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>' : 'Tiles © Esri, HERE, Garmin, © OpenStreetMap') + (S.transit ? ' · Transit: agency GTFS' : '');
  if ($('mapOffline')) $('mapOffline').hidden = !offline;
}
function rebuild() {
  // diff: false so 'style.load' always fires and onStyle re-adds the overlays
  tileOk = false; map.setStyle(baseStyle(), { diff: false });
  map.once('style.load', onStyle);
}

export function init() {
  // Esc with the drawer already closed dismisses the mini card (capture: runs before the shell closes the drawer)
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && !S.sel && $('mapCard') && !$('mapCard').hidden && !document.querySelector('.pl-scrim:not([hidden]), .sheet-scrim.on, .kbd-help')) hideCard(true); }, true);
  addEventListener('hashchange', () => { if (!location.hash.startsWith('#map') && location.hash) hideCard(); });
  on('filters', () => { if (!map?.getSource('listings')) return; setPins(); drawTags(); if (heat === 'score') setHeat('score'); });
  on('weights-settled', () => { if (!map?.getSource('listings')) return; setPins(); drawTags(); if (heat === 'score') setHeat('score'); });
  on('saved', () => { if (map?.getSource('listings')) { setPins(); drawTags(); } });   // a star added or removed anywhere lands here
  on('sort', () => map && drawTags());
  on('commute', () => {
    if (!map) return;
    refreshRings(); addDest(); if ($('mapCard') && !$('mapCard').hidden) showCard(lastSel);
    if (heat === 'commute' && map.getSource('listings')) setHeat('commute'); else renderLegend();
    renderSwitch();
  });
  on('theme', () => {
    if (!map) return;
    if (!vector || customStyle()) { rebuild(); return; }
    PAINT.forEach(([id, prop, key]) => map.getLayer(id) && map.setPaintProperty(id, prop, PAL[theme()][key]));
    if (map.getLayer('pins')) map.setPaintProperty('pins', 'circle-stroke-color', ['case', ['boolean', ['feature-state', 'hover'], false], css('--ink'), PAL[theme()].pinLine]);
    setPins();
    if (map.getLayer('pins-s-halo')) map.setPaintProperty('pins-s-halo', 'circle-color', css('--fav'));
    for (const id of ['pin-sel', 'pin-sel-s']) if (map.getLayer(id)) map.setPaintProperty(id, 'circle-stroke-color', css('--accent'));
    if (map.getLayer('pins-s')) map.setPaintProperty('pins-s', 'circle-stroke-color', ['case', ['boolean', ['feature-state', 'hover'], false], css('--ink'), PAL[theme()].pinLine]);
    setHeat(heat);
  });
  on('hover', (id) => {
    document.querySelectorAll('.price-tag.hl').forEach((e) => e.classList.remove('hl'));
    if (!map?.getSource('listings')) return;
    if (init.h) hoverState(init.h, false);
    init.h = id;
    if (id) { hoverState(id, true); document.querySelector(`.price-tag[data-id="${CSS.escape(id)}"]`)?.classList.add('hl'); }
  });
  on('select', ({ id, fly }) => {
    if (id) lastSel = id;
    // a listing opened before the map finished loading (?open=…) is flown to once it has
    if (!map?.loaded()) { pendingFly = id && fly ? id : null; if (!map) return; }
    drawTags();
    if (map.getLayer('pin-sel')) { map.setFilter('pin-sel', selFilter(id)); map.getLayer('pin-sel-s') && map.setFilter('pin-sel-s', ['==', ['get', 'id'], id || '']); pulse(); }
    if (id) hideCard(); else if (lastSel) showCard(lastSel);
    if (fly) flyTo(id);
  });
}

export async function show() {
  if (!inited) inited = boot();
  await inited;
  requestAnimationFrame(() => map.resize());
}
async function boot() {
  {
    for (const name of S.manifest.layers || []) {
      if (name.startsWith('transit')) continue;
      const g = await loadJSON(`${S.base}/layers/${name}`, null);
      if (g) layers[name.replace('.json', '')] = /^commute/.test(g.kind || '') ? decodeLayer(g) : g;
    }
    const want = new URLSearchParams(location.search).get('layer');
    heat = want ? (want.startsWith('commute') ? 'commute' : want) : hasCommute() ? 'commute' : 'none';
    const bm = new URLSearchParams(location.search).get('basemap');
    if (bm === 'raster') vector = false;
    if (bm === 'none' || navigator.onLine === false) { offline = true; vector = false; }
    const c = S.crit.search?.map_center, d = dest();
    const center = c ? [c[1], c[0]] : d?.lat != null ? [d.lon, d.lat] : [-73.98, 40.75];
    map = new maplibregl.Map({ container: 'map', style: baseStyle(), center, zoom: S.crit.search?.map_zoom ? S.crit.search.map_zoom - 0.1 : 12.9,
      minZoom: 9, maxZoom: 18, attributionControl: false, preserveDrawingBuffer: true, dragRotate: true });
    window.__asMap = map;   // for screenshots and debugging
    popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12, maxWidth: '260px' });
    // basemap fallbacks: vector tiles -> Esri raster -> plain offline background. A failure after a tile has
    // loaded is treated as transient; overlay sources (local data) never trigger a switch.
    map.on('sourcedata', (e) => { if (e.tile && ['omt', 'base'].includes(e.sourceId)) tileOk = true; });
    map.on('error', (e) => {
      if (offline || customStyle() || tileOk) return;
      const what = `${e?.error?.message || ''} ${e?.error?.url || ''} ${e?.sourceId || ''}`;
      if (vector && /openfreemap|omt/.test(what)) { vector = false; rebuild(); renderCtl(); }
      else if (!vector && /arcgisonline|\bbase\b|\bref\b/.test(what)) { offline = true; rebuild(); renderCtl(); }
    });
    map.once('style.load', onStyle);
    map.once('load', () => { if (pendingFly && pendingFly === S.sel) flyTo(pendingFly); pendingFly = null; });
    wire(); renderCtl(); renderSwitch(); addDest();
  }
}
