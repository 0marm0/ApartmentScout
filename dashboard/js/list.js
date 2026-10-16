// Shortlist: every filtered listing as one dense, sortable table, ranked live by the renter's weights.
// Units or buildings (building rows expand to their units), two densities, a column picker and keyboard
// row navigation. Rows render in chunks, one animation frame at a time, so 700+ listings stay smooth.
import { S, on, emit, store, byId, filtered, openDrawer, toggleCompare, toggleSave, isSaved, cost, commuteOf, dests, coverage, score, tierIndex, STATUSES } from './app.js';
import { $, esc, money, ICONS } from './util.js';
import { attachSplit, sync as splitSync, shown as splitShown } from './features/split-view.js';   // [features] docked mini map
import { illustration } from './features/empty.js';   // [feature C] empty-state art
import { getDensity, setDensity, onDensity } from './features/density.js';
import { deltaHTML } from './features/rank-ui.js';
import { destLineHTML, combinedOf, multi as multiDest } from './features/multidest.js';   // [multi-destination] a column with every destination
import { ppsf, groupKey, thumb, tierPill, myTierPill, tri, doorman, isMust, floorText, commuteHTML, scoreBar, statusPill, name, gateFails, costUnknown, label } from './views/table-kit.js';

const saved = store.get('list:ui', null) || {};
const st = {
  key: saved.key || 'score', dir: saved.dir || -1, group: saved.group === 'buildings' ? 'buildings' : 'units',
  density: saved.density === 'compact' ? 'compact' : 'comfortable', hidden: new Set(Array.isArray(saved.hidden) ? saved.hidden : ['hood']), open: new Set(),
};
const persist = () => store.set('list:ui', { key: st.key, dir: st.dir, group: st.group, density: st.density, hidden: [...st.hidden] });
let shown = false, gen = 0, pending = 0;
const active = () => shown && S.view === 'list';

// ------------------------------------------------------------------ columns
const ST_ORDER = Object.fromEntries(STATUSES.map(([k], i) => [k, i]));
const tri3 = (v) => (v === true ? 2 : v === false ? 0 : 1);
const DOOR = { 'full-time': 3, 'part-time': 2, virtual: 1.5, none: 0 };
const COLS = [
  { k: 'act', h: '<span class="sr">Save and compare</span>', fixed: true, cell: actCell },
  { k: 'rank', h: '#', label: 'Rank', n: true, sort: (L) => L._rank, dir: 1, cell: (L) => (L._rank ? `<span class="rk">${L._rank}</span>${deltaHTML(L.id)}` : '<span class="faint" title="Not eligible: fails a hard requirement">—</span>') },
  { k: 'thumb', h: '<span class="sr">Photo</span>', label: 'Photo', cell: (L) => `<span class="th">${thumb(L)}</span>` },
  { k: 'name', h: 'Listing', fixed: true, sort: (L) => label(L).toLowerCase(), dir: 1, cell: nameCell },
  { k: 'hood', h: 'Area', label: 'Area', sort: (L) => (L.neighborhood || '').toLowerCase() || null, dir: 1, cell: (L) => (L.neighborhood ? `<span class="hood">${esc(L.neighborhood)}</span>` : '<span class="faint">—</span>') },
  { k: 'cost', h: 'Monthly', fixed: true, n: true, sort: (L) => cost(L), dir: 1, cell: costCell },
  { k: 'tier', h: 'Budget', label: 'Budget tier', sort: (L) => { const t = L.score?.budget_tier; if (!t) return null; const i = tierIndex(L); return i < 0 ? 99 : i; }, dir: 1, cell: (L) => tierPill(L, true) },
  { k: 'sqft', h: 'ft²', label: 'Size', n: true, sort: (L) => L.sqft, dir: -1, cell: (L) => (L.sqft ? Math.round(L.sqft).toLocaleString() : '<span class="faint" title="Size not published">—</span>') },
  { k: 'ppsf', h: '$/ft²', label: '$ per ft²', n: true, sort: ppsf, dir: 1, cell: (L) => (ppsf(L) ? '$' + ppsf(L).toFixed(2) : '<span class="faint">—</span>') },
  { k: 'commute', h: () => `To ${esc(dests()[0] || 'work')}`, label: 'Commute', sort: (L) => commuteOf(L), dir: 1, cell: (L) => commuteHTML(L) },
  { k: 'alld', h: 'All destinations', label: 'Every destination', when: multiDest, sort: (L) => combinedOf(L).score, dir: -1, cell: (L) => destLineHTML(L) },   // [multi-destination]
  { k: 'floor', h: 'Floor', label: 'Floor and exposure', sort: (L) => L.floor, dir: -1, cell: floorText },
  { k: 'wd', h: 'W/D', label: 'In-unit W/D', c: true, sort: (L) => tri3(L.amenities?.in_unit_wd), dir: -1, cell: (L) => tri(L.amenities?.in_unit_wd, { must: isMust('in_unit_wd'), what: 'In-unit washer/dryer' }) },
  { k: 'door', h: '<span title="Doorman">Door</span>', label: 'Doorman', c: true, sort: (L) => DOOR[L.amenities?.doorman] ?? 1, dir: -1, cell: (L) => doorman(L.amenities?.doorman) },
  { k: 'gym', h: 'Gym', label: 'Gym', c: true, sort: (L) => tri3(L.amenities?.gym), dir: -1, cell: (L) => tri(L.amenities?.gym, { what: 'Gym' }) },
  { k: 'score', h: 'Score', fixed: true, sort: (L) => score(L), dir: -1, cell: (L) => scoreBar(score(L)) },
  { k: 'known', h: 'Known', label: 'Known (confidence)', n: true, sort: (L) => L.score?.confidence, dir: -1, cell: knownCell },
  { k: 'status', h: 'Status', label: 'Status', sort: (L) => ST_ORDER[L.status || 'new'], dir: 1, cell: statusPill },
];
const visible = () => COLS.filter((c) => (c.fixed || !st.hidden.has(c.k)) && (!c.when || c.when()));
const colByKey = (k) => COLS.find((c) => c.k === k && c.sort) || COLS.find((c) => c.k === 'score');

/** Comparator for the active column; listings without a value always sink to the bottom. */
function comparator() {
  const c = colByKey(st.key), dir = st.dir, f = c.sort;
  return (a, b) => {
    const x = f(a), y = f(b), nx = x == null || Number.isNaN(x), ny = y == null || Number.isNaN(y);
    if (nx || ny) return nx && ny ? (score(b) ?? -1) - (score(a) ?? -1) : nx ? 1 : -1;
    const d = typeof x === 'string' ? x.localeCompare(y) : x - y;
    return d ? d * dir : (score(b) ?? -1) - (score(a) ?? -1);
  };
}

// ------------------------------------------------------------------ cells
function actCell(L) {
  const sv = isSaved(L.id), cp = S.compare.includes(L.id);
  return `<span class="acts"><button type="button" class="ib star ${sv ? 'on' : ''}" data-save="${esc(L.id)}" tabindex="-1" aria-pressed="${sv}" aria-label="${sv ? 'Remove from picks' : 'Save to picks'}" title="${sv ? 'Saved (s)' : 'Save (s)'}">${sv ? ICONS.star : ICONS.starO}</button>`
    + `<button type="button" class="ib cmp ${cp ? 'on' : ''}" data-cmp="${esc(L.id)}" tabindex="-1" aria-pressed="${cp}" aria-label="${cp ? 'Remove from compare' : 'Add to compare'}" title="${cp ? 'Comparing (c)' : 'Compare (c)'}">${cp ? ICONS.check : ICONS.plus}</button></span>`;
}
function nameCell(L) {
  const fails = gateFails(L);
  const sub = [L.beds != null ? (L.beds ? `${L.beds} bd` : 'Studio') : null, L.available ? `avail ${esc(L.available)}` : null].filter(Boolean).join(' · ');
  const hood = st.hidden.has('hood') && L.neighborhood ? `<span>${esc(L.neighborhood)}</span>` : '';
  return `<div class="nm">${fails.length ? '<i class="fail-dot" aria-hidden="true"></i>' : ''}<b>${name(L)}</b>${myTierPill(L.id)}</div>`
    + `<div class="sub">${hood}${hood && sub ? '<span class="dot">·</span>' : ''}${sub ? `<span>${sub}</span>` : ''}`
    + fails.map((f) => `<span class="gate bad">${esc(f)}</span>`).join('')
    + '</div>';
}
function costCell(L) {
  const c = cost(L), g = L.price?.gross;
  if (c == null) return `<b class="mny faint">—</b><span class="sub">${costUnknown(L) ? 'cost unknown' : ''}</span>`;
  return `<b class="mny">${money(c)}</b>${g && Math.abs(g - c) > 5 ? `<span class="sub">${money(g)} gross</span>` : '<span class="sub">net</span>'}`;
}
function knownCell(L) {
  const v = L.score?.confidence, cov = coverage(L);
  const tip = `${v ?? 0}% of the ranking weight rests on known facts. ${cov.have}/${cov.total} key facts evidenced${cov.missing.length ? '; still need ' + cov.missing.join(', ').toLowerCase() : ''}.`;
  return `<span class="known" title="${esc(tip)}"><b>${v ?? 0}%</b><span class="kbar">${Array.from({ length: cov.total }, (_, i) => `<i class="${i < cov.have ? 'on' : ''}"></i>`).join('')}</span></span>`;
}

// ------------------------------------------------------------------ rows
// Cells that do not depend on weights or picks are cached per listing; they are what makes a redraw costly.
const DYNAMIC = new Set(['act', 'rank', 'name', 'score']);
let cache = new WeakMap();
function cellHTML(c, L) {
  if (DYNAMIC.has(c.k)) return c.cell(L);
  let m = cache.get(L); if (!m) cache.set(L, (m = {}));
  return (m[c.k] ??= c.cell(L));
}
function rowHTML(L, kind = 'unit') {
  const fails = gateFails(L).length;
  return `<tr class="r ${kind}${fails ? ' fails' : ''}${S.sel === L.id ? ' sel' : ''}" data-id="${esc(L.id)}" tabindex="-1">${visible().map((c) => `<td class="c-${c.k}${c.n ? ' n' : ''}${c.c ? ' cc' : ''}">${cellHTML(c, L)}</td>`).join('')}</tr>`;
}
const range = (vals, fmt) => {
  const v = vals.filter((x) => x != null && !Number.isNaN(x)); if (!v.length) return null;
  const lo = Math.min(...v), hi = Math.max(...v);
  return Math.round(lo) === Math.round(hi) ? fmt(lo) : `${fmt(lo)}–${fmt(hi)}`;
};
function groupHTML(g) {
  const R = g.rep, open = st.open.has(g.key), U = g.units;
  const cells = {
    act: `<span class="acts"><button type="button" class="ib caret ${open ? 'on' : ''}" data-toggle="${esc(g.key)}" tabindex="-1" aria-expanded="${open}" aria-label="${open ? 'Hide' : 'Show'} ${U.length} units"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M6 3.5L10.5 8 6 12.5"/></svg></button></span>`,
    name: `<div class="nm"><b>${esc(R.building || R.address)}</b><span class="cnt">${U.length} units</span></div><div class="sub"><span>${esc(R.neighborhood || R.address || '')}</span><span class="dot">·</span><span>best ${esc(R.unit || label(R))}</span>${U.some((u) => isSaved(u.id)) ? '<span class="gate fav">saved</span>' : ''}</div>`,
    cost: `<b class="mny">${money(U.map(cost).filter((x) => x != null).sort((a, b) => a - b)[0])}</b><span class="sub">${range(U.map(cost), (v) => '$' + Math.round(v / 100) / 10 + 'k') || ''}</span>`,
    sqft: range(U.map((u) => u.sqft), (v) => Math.round(v).toLocaleString()) || '<span class="faint">—</span>',
    floor: range(U.map((u) => u.floor), (v) => Math.round(v)) || '<span class="faint">—</span>',
  };
  return `<tr class="r group${open ? ' open' : ''}" data-id="${esc(R.id)}" data-key="${esc(g.key)}" tabindex="-1" aria-expanded="${open}">${visible().map((c) => `<td class="c-${c.k}${c.n ? ' n' : ''}${c.c ? ' cc' : ''}">${cells[c.k] ?? cellHTML(c, R)}</td>`).join('')}</tr>`
    + (open ? U.map((u) => rowHTML(u, 'child')).join('') : '');
}

function build() {
  const F = filtered(), cmp = comparator();
  if (st.group !== 'buildings') return { html: F.sort(cmp).map((L) => rowHTML(L)), n: F.length, b: null };
  const m = new Map();
  for (const L of F) { const k = groupKey(L); (m.get(k) || m.set(k, []).get(k)).push(L); }
  const G = [...m.entries()].map(([key, units]) => { units.sort(cmp); return { key, units, rep: units[0] }; }).sort((a, b) => cmp(a.rep, b.rep));
  return { html: G.map((g) => (g.units.length > 1 ? groupHTML(g) : rowHTML(g.rep))), n: F.length, b: G.length };
}

// ------------------------------------------------------------------ render
function head() {
  return `<tr>${visible().map((c) => {
    const h = typeof c.h === 'function' ? c.h() : c.h, on = c.sort && st.key === c.k;
    const aria = c.sort ? ` aria-sort="${on ? (st.dir > 0 ? 'ascending' : 'descending') : 'none'}"` : '';
    return `<th class="c-${c.k}${c.n ? ' n' : ''}${c.c ? ' cc' : ''}${on ? ' on' : ''}" scope="col"${aria}>${c.sort ? `<button type="button" data-sort="${c.k}">${h}<i class="arr" aria-hidden="true">${on ? (st.dir > 0 ? '↑' : '↓') : ''}</i></button>` : h}</th>`;
  }).join('')}</tr>`;
}
function draw(lite = false) {
  if (!shown) return;
  const my = ++gen, { html, n, b } = build(), t = $('table');
  t.className = `grid lst ${st.density}`;
  t.tHead.innerHTML = head();
  $('lsCount').textContent = `${n.toLocaleString()} ${n === 1 ? 'home' : 'homes'}${b != null ? ` in ${b.toLocaleString()} buildings` : ''}`;
  $('lsEmpty').hidden = !!n;
  t.hidden = !n;
  const body = t.tBodies[0], FIRST = lite ? 40 : 90, CHUNK = 140;
  body.innerHTML = html.slice(0, FIRST).join('');
  splitSync(lite);   // [features] the docked map follows the rows
  let i = FIRST;
  if (lite) return;   // while a weight slider moves, only the visible top re-renders; the rest follows when it settles
  const pump = () => {
    if (my !== gen || i >= html.length) return;
    body.insertAdjacentHTML('beforeend', html.slice(i, i + CHUNK).join('')); i += CHUNK;
    requestAnimationFrame(pump);
  };
  requestAnimationFrame(pump);
  const first = body.querySelector('tr.r.sel') || body.querySelector('tr.r');
  if (first) first.tabIndex = 0;
}
const schedule = () => { if (!active() || pending) return; pending = requestAnimationFrame(() => { pending = 0; draw(); }); };
let settle = 0;
const scheduleLite = () => {
  if (!active()) return;
  if (!pending) pending = requestAnimationFrame(() => { pending = 0; draw(true); });
  clearTimeout(settle); settle = setTimeout(() => active() && draw(), 220);
};

function controls() {
  $('lsGroup').querySelectorAll('button').forEach((b) => { b.classList.toggle('on', b.dataset.g === st.group); b.setAttribute('aria-pressed', b.dataset.g === st.group); });
  $('lsDensity').querySelectorAll('button').forEach((b) => { b.classList.toggle('on', b.dataset.d === st.density); b.setAttribute('aria-pressed', b.dataset.d === st.density); });
  $('lsColMenu').innerHTML = COLS.filter((c) => !c.fixed && (!c.when || c.when())).map((c) => `<label class="tg-row"><input type="checkbox" data-col="${c.k}" ${st.hidden.has(c.k) ? '' : 'checked'}><span>${esc(c.label)}</span></label>`).join('')
    + '<button type="button" class="btn ghost" id="lsColReset">Reset columns</button>';
}

// ------------------------------------------------------------------ interaction
const rowsEls = () => [...$('table').tBodies[0].querySelectorAll('tr.r')];
function focusRow(tr, open) {
  if (!tr) return;
  $('table').tBodies[0].querySelectorAll('tr.r[tabindex="0"]').forEach((x) => (x.tabIndex = -1));
  tr.tabIndex = 0; tr.focus({ preventScroll: true });
  tr.scrollIntoView({ block: 'nearest' });
  if (open && !tr.classList.contains('group')) openDrawer(tr.dataset.id);
}
function step(d, open) {
  const R = rowsEls(); if (!R.length) return;
  const act = document.activeElement?.closest?.('tr.r');
  let i = act ? R.indexOf(act) : R.findIndex((r) => r.dataset.id === S.sel && !r.classList.contains('group'));
  i = i < 0 ? 0 : Math.max(0, Math.min(R.length - 1, i + d));
  focusRow(R[i], open);
}
function toggleGroup(key, force) {
  const open = force ?? !st.open.has(key);
  open ? st.open.add(key) : st.open.delete(key);
  draw();
  const tr = $('table').querySelector(`tr.group[data-key="${CSS.escape(key)}"]`);
  if (tr) focusRow(tr, false);
}
function refreshRows(id) {
  const L = byId(id); if (!L) return;
  $('table').tBodies[0].querySelectorAll(`tr.r[data-id="${CSS.escape(id)}"]:not(.group)`).forEach((tr) => {
    const had = document.activeElement === tr, kind = tr.classList.contains('child') ? 'child' : 'unit', tab = tr.tabIndex;
    tr.insertAdjacentHTML('afterend', rowHTML(L, kind));
    const nx = tr.nextElementSibling; tr.remove(); nx.tabIndex = tab;
    if (had) nx.focus({ preventScroll: true });
  });
}
function syncCompare() {
  $('table').querySelectorAll('[data-cmp]').forEach((b) => {
    const on = S.compare.includes(b.dataset.cmp);
    if (b.classList.contains('on') === on) return;
    b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); b.innerHTML = on ? ICONS.check : ICONS.plus;
    b.setAttribute('aria-label', on ? 'Remove from compare' : 'Add to compare');
  });
}

/** [features] Everything the docked mini map needs from the table: rows in table order, and a way to reach a row. */
const tableIds = () => filtered().sort(comparator()).map((L) => L.id);
const rowFor = (id) => rowsEls().find((r) => r.dataset.id === id && !r.classList.contains('group')) || null;
async function reveal(id) {
  let tr = rowFor(id);
  if (!tr && st.group === 'buildings') { const L = byId(id); if (L) { st.open.add(groupKey(L)); draw(); } }
  for (let i = 0; i < 45 && !tr; i++) { await new Promise((r) => requestAnimationFrame(r)); tr = rowFor(id); }   // rows render in chunks
  return tr;
}

export function init() {
  st.density = getDensity();   // the global density setting (settings menu) drives the table too, and follows these buttons
  onDensity((d) => { st.density = d; if ($('table')) { persist(); controls(); $('table').className = `grid lst ${d}`; } });
  $('view-list').innerHTML = `<div class="view-pad list-pad">
    <div class="page-h"><div class="t"><h1>Shortlist <span id="lsCount"></span></h1>
      <p>Ranked live by your weights. Click a row for the full picture; <kbd>↑</kbd> <kbd>↓</kbd> move, <kbd>Enter</kbd> opens, <kbd>s</kbd> saves, <kbd>c</kbd> compares.</p></div>
      <div class="actions">
        <button type="button" class="btn" id="lsReport" data-make-report="shortlist" title="A typeset decision report for two to four homes: print it or save it as a PDF">${ICONS.doc}Make a report</button>
        <div class="seg" id="lsGroup" role="group" aria-label="Group rows"><button type="button" data-g="units">Units</button><button type="button" data-g="buildings">Buildings</button></div>
        <div class="seg" id="lsDensity" role="group" aria-label="Row density">
          <button type="button" data-d="comfortable" title="Comfortable rows" aria-label="Comfortable rows"><svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="2.5" y="2.5" width="11" height="4" rx="1"/><rect x="2.5" y="9.5" width="11" height="4" rx="1"/></svg></button>
          <button type="button" data-d="compact" title="Compact rows" aria-label="Compact rows"><svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M2.5 3.5h11M2.5 6.5h11M2.5 9.5h11M2.5 12.5h11"/></svg></button></div>
        <details class="colpick" id="lsCols"><summary class="btn"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="2" y="2.5" width="12" height="11" rx="1.5"/><path d="M6 2.5v11M10 2.5v11"/></svg>Columns</summary><div class="menu" id="lsColMenu"></div></details>
      </div></div>
    <div class="panel flush tbl-wrap" id="lsWrap"><table class="grid lst" id="table" aria-label="Listings that match your filters"><thead></thead><tbody></tbody></table>
      <div class="empty ls-empty has-ill" id="lsEmpty" hidden>${illustration('filters')}<b>No homes match your filters</b>Loosen a budget tier, the commute limit or a must-have on the left, or include more statuses.</div></div>
  </div>`;
  controls();
  const t = $('table');
  t.tHead.addEventListener('click', (e) => {
    const b = e.target.closest('[data-sort]'); if (!b) return;
    const c = colByKey(b.dataset.sort);
    if (st.key === c.k) st.dir = -st.dir; else { st.key = c.k; st.dir = c.dir; }
    persist(); draw();
  });
  t.tBodies[0].addEventListener('click', (e) => {
    const sv = e.target.closest('[data-save]'), cp = e.target.closest('[data-cmp]'), tg = e.target.closest('[data-toggle]');
    if (sv) { toggleSave(sv.dataset.save); return; }
    if (cp) { toggleCompare(cp.dataset.cmp); return; }
    const tr = e.target.closest('tr.r'); if (!tr) return;
    if (tg || tr.classList.contains('group')) { toggleGroup(tg?.dataset.toggle || tr.dataset.key); return; }
    focusRow(tr, true);
  });
  t.tBodies[0].addEventListener('keydown', (e) => {
    const tr = e.target.closest('tr.r'); if (!tr || e.metaKey || e.ctrlKey || e.altKey) return;
    const grp = tr.classList.contains('group'), id = tr.dataset.id;
    const k = e.key, R = rowsEls();
    const done = () => { e.preventDefault(); e.stopPropagation(); };
    if (k === 'ArrowDown') { done(); step(1, !!S.sel); } else if (k === 'ArrowUp') { done(); step(-1, !!S.sel); }
    else if (k === 'Home') { done(); focusRow(R[0], false); } else if (k === 'End') { done(); focusRow(R[R.length - 1], false); }
    else if (k === 'Enter') { done(); grp ? toggleGroup(tr.dataset.key) : openDrawer(id); }
    else if (k === 'ArrowRight' && grp) { done(); toggleGroup(tr.dataset.key, true); }
    else if (k === 'ArrowLeft' && grp) { done(); toggleGroup(tr.dataset.key, false); }
    else if (k === 's' && !grp) { done(); toggleSave(id); if (S.sel === id) openDrawer(id); }
    else if (k === 'c' && !grp) { done(); toggleCompare(id); if (S.sel === id) openDrawer(id); }
  });
  // j / k walk the table (in table order) instead of the hidden map cards while this view is open
  addEventListener('keydown', (e) => {
    if (!active() || (e.key !== 'j' && e.key !== 'k')) return;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) || e.target.isContentEditable || e.metaKey || e.ctrlKey || e.altKey || document.querySelector('.kbd-help')) return;
    e.preventDefault(); e.stopPropagation();
    step(e.key === 'j' ? 1 : -1, true);
  }, true);
  $('lsGroup').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; st.group = b.dataset.g; persist(); controls(); draw(); });
  $('lsDensity').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; st.density = b.dataset.d; persist(); controls(); $('table').className = `grid lst ${st.density}`; setDensity(st.density); });
  $('lsColMenu').addEventListener('change', (e) => {
    const k = e.target.dataset.col; if (!k) return;
    e.target.checked ? st.hidden.delete(k) : st.hidden.add(k);
    persist(); draw();
  });
  $('lsColMenu').addEventListener('click', (e) => { if (e.target.id === 'lsColReset') { st.hidden = new Set(['hood']); persist(); controls(); draw(); } });
  document.addEventListener('click', (e) => { const d = $('lsCols'); if (d?.open && !d.contains(e.target)) d.open = false; });
  $('lsCols').addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); $('lsCols').open = false; $('lsCols').querySelector('summary').focus(); } });

  // [features] hovering or focusing a row says which home it is: the docked map pulses its pin and previews its route
  let hovRow = null;
  const tell = (id) => { if (id !== hovRow) emit('hover', (hovRow = id)); };
  t.tBodies[0].addEventListener('mouseover', (e) => tell(e.target.closest('tr.r')?.dataset.id || null));
  t.tBodies[0].addEventListener('mouseleave', () => tell(null));
  t.tBodies[0].addEventListener('focusin', (e) => tell(e.target.closest('tr.r')?.dataset.id || null));
  t.tBodies[0].addEventListener('focusout', (e) => { if (!e.relatedTarget?.closest?.('tr.r')) tell(null); });
  attachSplit({ ids: tableIds, reveal, focusRow, rowFor });
  on('filters', schedule);
  on('weights', scheduleLite);
  on('compare', () => active() && syncCompare());
  on('saved', (id) => { if (!active()) return; if (!id || S.filters.savedOnly || st.group === 'buildings') schedule(); else refreshRows(id); });
  on('select', ({ id } = {}) => {
    if (!active()) return;
    $('table').tBodies[0].querySelectorAll('tr.r.sel').forEach((r) => r.classList.remove('sel'));
    if (id) $('table').tBodies[0].querySelectorAll(`tr.r[data-id="${CSS.escape(id)}"]:not(.group)`).forEach((r) => r.classList.add('sel'));
  });
}

export function show() {
  shown = true;
  draw();
  splitShown();
}
