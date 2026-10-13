// Map view: listing pins, commute / noise / rent / score heatmaps, filterable side list.
import { S, on, filtered, openDrawer, label, cost, commuteOf, loadJSON, dests } from './app.js';
import { $, esc, money, mins, RAMPS, rgb, gridImage, gridValueAt, idwGrid, legendHTML, scoreColor, debounce } from './util.js';

let map, tiles, pinLayer, heatOverlay, destLayer;
const layers = {};          // name -> grid json
let heatKey = 'none', pinMode = 'score', opacity = 0.62, inited = false;

export function init() {
  on('filters', () => inited && draw());
  on('theme', () => inited && setTiles());
  on('select', (id) => highlight(id));
}

function setTiles() {
  const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  // Default: OpenStreetMap standard tiles, toned down with a CSS filter so heatmaps stay readable.
  // Set search.tiles in criteria.yaml to use another provider (for example one that needs your own key).
  const url = S.crit.search?.tiles || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  const attribution = S.crit.search?.tiles_attribution || '© OpenStreetMap contributors';
  if (tiles) map.removeLayer(tiles);
  tiles = L.tileLayer(url, { maxZoom: 19, attribution, className: dark ? 'tiles-dark' : 'tiles-light' }).addTo(map);
  tiles.bringToBack();
}

export async function show() {
  if (!inited) {
    inited = true;
    const c = S.crit.search?.map_center;
    const pts = S.listings.filter((x) => x.lat != null);
    map = L.map('map', { zoomControl: true, preferCanvas: true }).setView(c || (pts[0] ? [pts[0].lat, pts[0].lon] : [40.75, -73.98]), S.crit.search?.map_zoom || 13);
    setTiles();
    pinLayer = L.layerGroup().addTo(map);
    destLayer = L.layerGroup().addTo(map);
    for (const name of S.manifest.layers || []) layers[name.replace('.json', '')] = await loadJSON(`${S.base}/layers/${name}`, null);
    buildTools();
    drawDests();
    map.on('mousemove', debounce(readout, 30));
    map.on('mouseout', () => ($('readout').hidden = true));
    const want = new URLSearchParams(location.search).get('layer');
    const first = Object.keys(layers).find((k) => k.startsWith('commute'));
    setHeat(want || (first ?? 'none'));
  }
  setTimeout(() => map.invalidateSize(), 50);
  draw();
}

function buildTools() {
  const opts = [['none', 'No heatmap']];
  for (const k of Object.keys(layers)) {
    const g = layers[k]; if (!g) continue;
    opts.push([k, g.kind === 'commute' ? `Commute to ${g.name}` : g.name]);
  }
  opts.push(['rent', 'Rent per ft² (from listings)'], ['score', 'Score (from listings)']);
  $('mapTools').innerHTML = `<button type="button" class="tools-toggle" id="toolsToggle" aria-expanded="false">Layers and pins ▾</button><h3>Heatmap</h3>
    ${opts.map(([k, t]) => `<label><input type="radio" name="heat" value="${k}" ${k === heatKey ? 'checked' : ''}> ${esc(t)}</label>`).join('')}
    <label class="f-row" style="display:flex;flex-direction:column;align-items:stretch">Opacity<input type="range" id="heatOp" min="0.15" max="0.95" step="0.05" value="${opacity}"></label>
    <h3 style="margin-top:4px">Pins coloured by</h3>
    <div class="chips">${[['score', 'Score'], ['tier', 'Budget'], ['commute', 'Commute']].map(([k, t]) => `<button type="button" class="chip ${k === pinMode ? 'on' : ''}" data-pm="${k}">${t}</button>`).join('')}</div>`;
  $('toolsToggle').addEventListener('click', () => { const o = $('mapTools').classList.toggle('open'); $('toolsToggle').setAttribute('aria-expanded', o); });
  $('mapTools').querySelectorAll('input[name=heat]').forEach((r) => r.addEventListener('change', () => setHeat(r.value)));
  $('heatOp').addEventListener('input', (e) => { opacity = +e.target.value; heatOverlay?.setOpacity(1); setHeat(heatKey); });
  $('mapTools').querySelectorAll('[data-pm]').forEach((b) => b.addEventListener('click', () => { pinMode = b.dataset.pm; buildTools(); draw(); }));
}

function rentGrid() {
  const like = Object.values(layers).find(Boolean);
  if (!like) return null;
  const pts = S.listings.filter((x) => x.lat != null && x.sqft && cost(x)).map((x) => ({ lat: x.lat, lon: x.lon, v: cost(x) / x.sqft }));
  return idwGrid(pts, like, { cellScale: 2, radiusM: 650 });
}
function scoreGrid() {
  const like = Object.values(layers).find(Boolean);
  if (!like) return null;
  const pts = filtered().filter((x) => x.lat != null && x.score?.overall != null).map((x) => ({ lat: x.lat, lon: x.lon, v: x.score.overall }));
  return idwGrid(pts, like, { cellScale: 2, radiusM: 600 });
}

let activeGrid = null;
function setHeat(k) {
  heatKey = k;
  document.querySelectorAll('#mapTools input[name=heat]').forEach((r) => (r.checked = r.value === k));
  if (heatOverlay) { map.removeLayer(heatOverlay); heatOverlay = null; }
  activeGrid = null;
  let img = null, leg = '';
  if (k === 'rent') {
    activeGrid = rentGrid();
    if (activeGrid) { img = gridImage(activeGrid, RAMPS.rent.fn, () => opacity); leg = legendHTML('Monthly cost per ft²', 'rent', ['$3', '$5', '$7', '$9', '$12+']); }
  } else if (k === 'score') {
    activeGrid = scoreGrid();
    if (activeGrid) { img = gridImage(activeGrid, RAMPS.score.fn, () => opacity); leg = legendHTML('Average listing score nearby', 'score', [30, 50, 65, 80, 95]); }
  } else if (layers[k]) {
    activeGrid = layers[k];
    if (activeGrid.kind === 'commute') {
      img = gridImage(activeGrid, RAMPS.commute.fn, () => opacity);
      leg = legendHTML(`Door-to-door to ${activeGrid.name}, arrive ${activeGrid.arrive_by}`, 'commute', [8, 18, 28, 40, 55, '75+'], '') +
        `<div class="muted" style="margin-top:4px">${esc(activeGrid.method)}${activeGrid.feeds?.length ? ' · ' + esc(activeGrid.feeds.join(', ')) : ''}</div>`;
    } else if (activeGrid.kind === 'noise') {
      const per = 12 / (activeGrid.months || 12);
      img = gridImage(activeGrid, RAMPS.noise.fn, (v) => Math.min(opacity + 0.1, 0.25 + Math.log10(v + 1) * 0.3), (v) => (v > 0 ? Math.log10(v * per + 1) : -1));
      leg = legendHTML(`311 noise complaints per year per ${activeGrid.cell_m} m cell`, 'noise', ['0', '10', '100', '1k', '4k']) +
        `<div class="muted" style="margin-top:4px">${activeGrid.total?.toLocaleString()} requests since ${esc(activeGrid.since)}</div>`;
    }
  }
  if (img && activeGrid) {
    const [lo0, la0, lo1, la1] = activeGrid.bbox;
    heatOverlay = L.imageOverlay(img, [[la0, lo0], [la1, lo1]], { opacity: 1, interactive: false, className: 'heat-img' }).addTo(map);
    heatOverlay.getElement()?.style.setProperty('image-rendering', 'pixelated');
  }
  $('legend').innerHTML = leg + pinLegend();
  $('legend').hidden = false;
}

function pinLegend() {
  if (pinMode === 'score') return `<div style="margin-top:8px">${legendHTML('Pins: listing score', 'score', [30, 50, 65, 80, 95])}</div>`;
  if (pinMode === 'commute') return `<div style="margin-top:8px">${legendHTML('Pins: commute minutes', 'commute', [8, 18, 28, 40, 55, '75+'])}</div>`;
  const t = (S.crit.budget?.tiers || []).map((x) => x.name);
  return `<div style="margin-top:8px"><b>Pins: budget tier</b><div>${t.map((n, i) => `<span class="sw" style="background:${TIER_COL[i]}"></span>${esc(n)} `).join('')}<span class="sw" style="background:#c0392b"></span>Over</div></div>`;
}
const TIER_COL = ['#0c6b47', '#2e9e62', '#e39a1b', '#ec7d38'];
function pinColor(Lx) {
  if (pinMode === 'commute') return rgb(RAMPS.commute.fn(commuteOf(Lx) ?? 90));
  if (pinMode === 'tier') {
    const t = (S.crit.budget?.tiers || []).findIndex((x) => x.name === Lx.score?.budget_tier);
    return t >= 0 ? TIER_COL[t] : '#c0392b';
  }
  return scoreColor(Lx.score?.overall);
}

const markers = {};
function draw() {
  if (!map) return;
  pinLayer.clearLayers();
  const F = filtered().filter((x) => x.lat != null);
  F.sort((a, b) => (a.score?.overall ?? 0) - (b.score?.overall ?? 0));
  for (const Lx of F) {
    const fav = Lx.favorite || ['shortlist', 'touring', 'applied'].includes(Lx.status);
    const m = L.circleMarker([Lx.lat, Lx.lon], {
      radius: fav ? 9 : 6, weight: fav ? 3 : 1.2, color: fav ? getComputedStyle(document.documentElement).getPropertyValue('--fav').trim() : '#ffffff',
      fillColor: pinColor(Lx), fillOpacity: Lx.status === 'gone' ? 0.35 : 0.95,
    });
    m.bindTooltip(`<b>${esc(label(Lx))}</b><br>${money(cost(Lx))}/mo · score ${Lx.score?.overall ?? '?'}${commuteOf(Lx) != null ? ' · ' + mins(commuteOf(Lx)) : ''}`, { direction: 'top' });
    m.on('click', () => openDrawer(Lx.id));
    m.addTo(pinLayer);
    markers[Lx.id] = m;
  }
  renderSideList(F);
  if (heatKey === 'score') setHeat('score');
}

function drawDests() {
  destLayer.clearLayers();
  for (const d of S.crit.commute?.destinations || []) {
    if (d.lat == null) continue;
    const icon = L.divIcon({ className: '', html: `<div class="pin dest" style="width:26px;height:26px">★</div>`, iconSize: [26, 26], iconAnchor: [13, 13] });
    L.marker([d.lat, d.lon], { icon, zIndexOffset: 1000 }).bindTooltip(`<b>${esc(d.name)}</b><br>${esc(d.address || '')}<br>arrive by ${esc(d.arrive_by || '')}, max ${d.max_minutes || '?'} min`).addTo(destLayer);
  }
}

function renderSideList(F) {
  const rows = [...F].sort((a, b) => {
    const fa = a.favorite ? 1 : 0, fb = b.favorite ? 1 : 0;
    if (S.crit.favorites_first && fa !== fb) return fb - fa;
    return (b.score?.overall ?? -1) - (a.score?.overall ?? -1);
  }).slice(0, 300);
  $('sideList').innerHTML = rows.map((x) => `
    <div class="li" data-id="${esc(x.id)}">
      <div class="ring" style="background:${scoreColor(x.score?.overall)}">${x.score?.overall != null ? Math.round(x.score.overall) : '?'}</div>
      <div style="min-width:0"><div class="t">${x.favorite ? '<span style="color:var(--fav)">★</span> ' : ''}${esc(label(x))}</div>
        <div class="s">${esc(x.neighborhood || '')}${x.sqft ? ' · ' + Math.round(x.sqft) + ' ft²' : ''}${commuteOf(x) != null ? ' · ' + mins(commuteOf(x)) : ''}</div></div>
      <div class="p">${money(cost(x))}<div class="s">${esc(x.score?.budget_tier || '')}</div></div>
    </div>`).join('') + (F.length > 300 ? `<div class="li muted">… ${F.length - 300} more; narrow the filters</div>` : '');
  $('sideList').querySelectorAll('.li[data-id]').forEach((el) => el.addEventListener('click', () => {
    const x = F.find((y) => y.id === el.dataset.id);
    if (x?.lat != null) map.flyTo([x.lat, x.lon], Math.max(map.getZoom(), 15), { duration: 0.5 });
    openDrawer(el.dataset.id);
  }));
}

function highlight(id) {
  document.querySelectorAll('.li.sel').forEach((e) => e.classList.remove('sel'));
  if (!id) return;
  document.querySelector(`.li[data-id="${CSS.escape(id)}"]`)?.classList.add('sel');
  markers[id]?.bringToFront();
}

function readout(e) {
  if (!activeGrid) { $('readout').hidden = true; return; }
  const r = gridValueAt(activeGrid, e.latlng.lat, e.latlng.lng);
  if (!r || r.v == null || r.v < 0) { $('readout').hidden = true; return; }
  let t;
  if (heatKey === 'rent') t = `≈ $${r.v.toFixed(2)} per ft² per month`;
  else if (heatKey === 'score') t = `nearby listings average ${Math.round(r.v)}`;
  else if (activeGrid.kind === 'commute') t = `${r.v} min door-to-door to ${activeGrid.name}`;
  else t = `${Math.round(r.v * 12 / (activeGrid.months || 12))} noise complaints/yr in this ${activeGrid.cell_m} m cell (${activeGrid.night?.[r.i] ?? 0} at night)`;
  $('readout').textContent = t;
  $('readout').hidden = false;
}
