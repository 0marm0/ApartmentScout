// Compare view: up to four listings side by side, plus cost-vs-space scatter and per-dimension bars.
import { S, on, byId, label, cost, commuteOf, toggleCompare, openDrawer, dests } from './app.js';
import { $, esc, money, scoreColor, css } from './util.js';

let shown = false;
export function init() {
  document.getElementById('view-compare').innerHTML = `<div class="view-pad"><div class="compare-head"> <h2>Compare</h2> <p class="muted" id="cmpHint">Pick up to four listings with the ＋ button in the shortlist or the listing panel.</p> </div> <div class="cmp-cards" id="cmpCards"></div> <div class="panel"><h3>Cost against space, every eligible listing</h3><div id="scatter" class="chart"></div></div> <div class="panel"><h3>Score by dimension</h3><div id="dimBars" class="chart"></div></div></div>`;
 on('compare', () => shown && draw()); on('theme', () => shown && draw()); }
export function show() { shown = true; draw(); }

const DIMS = [['cost', 'Cost'], ['space', 'Space'], ['commute', 'Commute'], ['amenities', 'Amenities'], ['light_view', 'Light & view'], ['building', 'Building'], ['quiet', 'Quiet']];

function draw() {
  let ids = S.compare.filter(byId);
  if (!ids.length) {
    // sensible default: the four best eligible listings
    ids = S.listings.filter((L) => L.score?.rank).sort((a, b) => a.score.rank - b.score.rank).slice(0, 4).map((L) => L.id);
    $('cmpHint').textContent = 'Showing the four top-ranked listings. Use ＋ in the shortlist or the listing panel to choose your own.';
  } else $('cmpHint').textContent = 'Best value in each row is green. Remove a listing with ✕.';
  const Ls = ids.map(byId);
  const rows = [
    ['Monthly cost', (L) => cost(L), money, 'min'],
    ['Gross rent', (L) => L.price?.gross, money, null],
    ['Size (ft²)', (L) => L.sqft, (v) => (v ? Math.round(v) : '?'), 'max'],
    ['$/ft²', (L) => (L.sqft && cost(L) ? cost(L) / L.sqft : null), (v) => (v ? '$' + v.toFixed(2) : '?'), 'min'],
    ...dests().map((d) => [`Commute: ${d}`, (L) => commuteOf(L, d), (v) => (v != null ? Math.round(v) + ' min' : '?'), 'min']),
    ['Floor', (L) => L.floor, (v) => v ?? '?', 'max'],
    ['Direct sun, Dec (model)', (L) => L.site?.sun_hours?.[11], (v) => (v != null ? v.toFixed(1) + ' h' : '?'), 'max'],
    ['Records score', (L) => L.records?.risk_score, (v) => v ?? '?', 'max'],
    ['Street-noise score', (L) => L.records?.noise_score, (v) => v ?? '?', 'max'],
    ['Overall score', (L) => L.score?.overall, (v) => v ?? '?', 'max'],
  ];
  $('cmpCards').innerHTML = Ls.map((L) => {
    const am = L.amenities || {};
    return `<div class="cmp-card">
      <div style="display:flex;justify-content:space-between;gap:8px"><h4>${esc(label(L))}</h4>${S.compare.includes(L.id) ? `<button class="add" data-rm="${esc(L.id)}" title="Remove">✕</button>` : ''}</div>
      <div class="muted" style="margin-bottom:8px">${esc(L.neighborhood || L.address || '')}</div>
      <div class="ring" style="background:${scoreColor(L.score?.overall)};width:44px;height:44px;font-size:14px;margin-bottom:8px">${L.score?.overall != null ? Math.round(L.score.overall) : '?'}</div>
      ${rows.map(([t, f, fmt, best]) => {
        const v = f(L), vals = Ls.map(f).filter((x) => x != null);
        const isBest = best && v != null && vals.length > 1 && v === (best === 'min' ? Math.min(...vals) : Math.max(...vals));
        return `<div class="cmp-row"><span>${esc(t)}</span><b class="${isBest ? 'best' : ''}">${fmt(v)}</b></div>`;
      }).join('')}
      <div class="cmp-row"><span>W/D · doorman · gym</span><b>${am.in_unit_wd === true ? 'yes' : am.in_unit_wd === false ? 'no' : '?'} · ${esc(am.doorman || '?')} · ${am.gym === true ? 'yes' : am.gym === false ? 'no' : '?'}</b></div>
      <div class="btns"><button class="btn" data-open="${esc(L.id)}">Details</button>${(S.manifest.sites || []).includes(L.id) ? `<a class="btn" href="#unit/${esc(L.id)}">3D</a>` : ''}</div>
    </div>`;
  }).join('');
  $('cmpCards').querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => toggleCompare(b.dataset.rm)));
  $('cmpCards').querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => openDrawer(b.dataset.open)));
  scatter(ids);
  dimBars(Ls);
}

function scatter(sel) {
  const pts = S.listings.filter((L) => L.score?.eligible && L.sqft && cost(L));
  if (!pts.length) { $('scatter').innerHTML = '<p class="muted">Needs listings with size and cost.</p>'; return; }
  const W = Math.max(360, $('scatter').clientWidth || 900), H = Math.round(Math.min(420, W * 0.45)), l = 64, r = 20, t = 14, b = 44;
  const xs = pts.map((L) => L.sqft), ys = pts.map(cost);
  const x0 = Math.min(...xs) * 0.95, x1 = Math.max(...xs) * 1.03, y0 = Math.min(...ys) * 0.97, y1 = Math.max(...ys) * 1.02;
  const X = (v) => l + (v - x0) / (x1 - x0) * (W - l - r), Y = (v) => H - b - (v - y0) / (y1 - y0) * (H - t - b);
  const ink = css('--ink'), line = css('--line'), fav = css('--fav');
  const ticks = (a, z, n) => { const s = (z - a) / n, p = Math.pow(10, Math.floor(Math.log10(s))), st = [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= s); const o = []; for (let v = Math.ceil(a / st) * st; v <= z; v += st) o.push(v); return o; };
  const hard = S.crit.budget?.hard_max;
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Monthly cost against size for eligible listings">`;
  for (const v of ticks(x0, x1, 8)) svg += `<line x1="${X(v)}" x2="${X(v)}" y1="${t}" y2="${H - b}" stroke="${line}"/><text x="${X(v)}" y="${H - b + 16}" text-anchor="middle">${Math.round(v)}</text>`;
  for (const v of ticks(y0, y1, 6)) svg += `<line x1="${l}" x2="${W - r}" y1="${Y(v)}" y2="${Y(v)}" stroke="${line}"/><text x="${l - 6}" y="${Y(v) + 4}" text-anchor="end">$${Math.round(v).toLocaleString()}</text>`;
  if (hard && hard <= y1) svg += `<line x1="${l}" x2="${W - r}" y1="${Y(hard)}" y2="${Y(hard)}" stroke="${css('--bad')}" stroke-dasharray="5 4"/><text x="${W - r}" y="${Y(hard) - 5}" text-anchor="end">hard budget</text>`;
  svg += `<text x="${(l + W - r) / 2}" y="${H - 6}" text-anchor="middle">size, ft²</text>`;
  for (const L of pts) {
    const on = sel.includes(L.id);
    svg += `<circle cx="${X(L.sqft)}" cy="${Y(cost(L))}" r="${on ? 8 : 5}" fill="${scoreColor(L.score.overall)}" fill-opacity="${on ? 1 : 0.75}" stroke="${on ? ink : (L.favorite ? fav : 'none')}" stroke-width="${on ? 2.5 : 1.5}" data-id="${esc(L.id)}" style="cursor:pointer"><title>${esc(label(L))}: ${money(cost(L))}, ${Math.round(L.sqft)} ft², score ${L.score.overall}</title></circle>`;
  }
  for (const id of sel) { const L = byId(id); if (L?.sqft && cost(L)) svg += `<text x="${X(L.sqft) + 10}" y="${Y(cost(L)) - 8}" style="fill:${ink};font-weight:600">${esc(label(L))}</text>`; }
  svg += '</svg>';
  $('scatter').innerHTML = svg;
  $('scatter').querySelectorAll('circle[data-id]').forEach((c) => c.addEventListener('click', () => openDrawer(c.dataset.id)));
}

function dimBars(Ls) {
  const W = Math.max(360, $('dimBars').clientWidth || 900), rowH = 34, l = 110, H = DIMS.length * rowH + 20;
  const pal = ['#1f4fd8', '#d4378c', '#11845b', '#e09100'];
  const bw = (rowH - 8) / Math.max(1, Ls.length);
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Scores by dimension">`;
  DIMS.forEach(([k, t], i) => {
    const y = 10 + i * rowH;
    svg += `<text x="${l - 8}" y="${y + rowH / 2}" text-anchor="end">${t}</text>`;
    Ls.forEach((L, j) => {
      const v = L.score?.parts?.[k];
      const w = ((v ?? 0) / 100) * (W - l - 60);
      svg += v == null ? `<rect x="${l}" y="${y + j * bw}" width="${W - l - 60}" height="${bw - 2}" fill="none" stroke="${pal[j]}" stroke-dasharray="3 3"/>`
        : `<rect x="${l}" y="${y + j * bw}" width="${w}" height="${bw - 2}" fill="${pal[j]}" rx="2"/><text x="${l + w + 4}" y="${y + j * bw + bw / 2 + 2}">${Math.round(v)}</text>`;
    });
  });
  svg += `</svg><div class="legend-row">${Ls.map((L, j) => `<span><span class="sw" style="background:${pal[j]}"></span>${esc(label(L))}</span>`).join('')}<span>Dashed: unknown</span></div>`;
  $('dimBars').innerHTML = svg;
}
