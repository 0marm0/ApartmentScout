// Shortlist table: every filtered listing, sortable on any column.
import { S, on, filtered, openDrawer, label, cost, commuteOf, toggleCompare } from './app.js';
import { $, esc, money, yn, scoreColor } from './util.js';

let sortKey = 'score', dir = -1, shown = false;
const COLS = [
  ['cmp', '', null],
  ['rank', '#', (L) => L.score?.rank ?? 1e9],
  ['name', 'Listing', (L) => label(L).toLowerCase()],
  ['hood', 'Area', (L) => (L.neighborhood || '').toLowerCase()],
  ['cost', '$/mo', (L) => cost(L) ?? 1e9],
  ['tier', 'Budget', (L) => L.score?.budget_tier || 'zz'],
  ['sqft', 'ft²', (L) => L.sqft ?? -1],
  ['ppsf', '$/ft²', (L) => (L.sqft && cost(L) ? cost(L) / L.sqft : 1e9)],
  ['commute', 'Commute', (L) => commuteOf(L) ?? 1e9],
  ['floor', 'Floor', (L) => L.floor ?? -1],
  ['wd', 'W/D', (L) => (L.amenities?.in_unit_wd === true ? 0 : L.amenities?.in_unit_wd === false ? 2 : 1)],
  ['door', 'Doorman', (L) => L.amenities?.doorman || 'zz'],
  ['gym', 'Gym', (L) => (L.amenities?.gym === true ? 0 : 1)],
  ['score', 'Score', (L) => L.score?.overall ?? -1],
  ['conf', 'Known', (L) => L.score?.confidence ?? 0],
  ['status', 'Status', (L) => L.status || ''],
];

export function init() {
  on('filters', () => shown && draw());
  on('compare', () => shown && draw());
}
export function show() { shown = true; draw(); }

function draw() {
  const col = COLS.find((c) => c[0] === sortKey);
  const rows = filtered().sort((a, b) => {
    const x = col[2](a), y = col[2](b);
    return (x < y ? -1 : x > y ? 1 : 0) * dir;
  });
  const t = $('table');
  t.innerHTML = `<thead><tr>${COLS.map(([k, h]) => `<th data-k="${k}" class="${['cost', 'sqft', 'ppsf', 'commute', 'floor', 'score', 'conf', 'rank'].includes(k) ? 'n' : ''}">${h}${k === sortKey ? (dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr></thead>
  <tbody>${rows.slice(0, 800).map((L) => {
    const s = L.score || {}, am = L.amenities || {};
    const fails = (s.gates || []).some((g) => g.startsWith('fails') || g === 'over_budget');
    return `<tr data-id="${esc(L.id)}">
      <td><button type="button" class="add ${S.compare.includes(L.id) ? 'on' : ''}" data-cmp="${esc(L.id)}" title="Add to compare">${S.compare.includes(L.id) ? '✓' : '+'}</button></td>
      <td class="n">${s.rank ?? ''}</td>
      <td>${L.favorite ? '<span style="color:var(--fav)">★</span> ' : ''}<b>${esc(label(L))}</b></td>
      <td>${esc(L.neighborhood || '')}</td>
      <td class="n">${money(cost(L))}</td>
      <td>${s.budget_tier ? `<span class="pill ${s.budget_tier === 'Over budget' ? 'bad' : ''}">${esc(s.budget_tier)}</span>` : ''}</td>
      <td class="n">${L.sqft ? Math.round(L.sqft) : ''}</td>
      <td class="n">${L.sqft && cost(L) ? '$' + (cost(L) / L.sqft).toFixed(2) : ''}</td>
      <td class="n">${commuteOf(L) != null ? Math.round(commuteOf(L)) + ' min' : ''}</td>
      <td class="n">${L.floor ?? ''}</td>
      <td>${yn(am.in_unit_wd)}</td>
      <td>${esc(am.doorman || '?')}</td>
      <td>${yn(am.gym)}</td>
      <td class="n"><span class="sbar"><i style="width:${s.overall ?? 0}%;background:${scoreColor(s.overall)}"></i></span>${s.overall ?? '?'}${fails ? ' <span class="pill bad" title="Fails a gate">!</span>' : ''}</td>
      <td class="n">${s.confidence ?? 0}%</td>
      <td><span class="pill">${esc(L.status || 'new')}</span></td></tr>`;
  }).join('')}</tbody>`;
  t.querySelectorAll('th[data-k]').forEach((th) => th.addEventListener('click', () => {
    const k = th.dataset.k; if (k === 'cmp') return;
    if (k === sortKey) dir = -dir; else { sortKey = k; dir = ['name', 'hood', 'tier', 'status', 'cost', 'commute', 'ppsf', 'rank'].includes(k) ? 1 : -1; }
    draw();
  }));
  t.querySelectorAll('tr[data-id]').forEach((tr) => tr.addEventListener('click', (e) => {
    if (e.target.closest('[data-cmp]')) return;
    openDrawer(tr.dataset.id);
  }));
  t.querySelectorAll('[data-cmp]').forEach((b) => b.addEventListener('click', () => toggleCompare(b.dataset.cmp)));
}
