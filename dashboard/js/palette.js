// Command palette (⌘K, Ctrl+K or "/"): jump to any listing by name, address or neighbourhood, filter the
// results, switch view, and run the shell's actions (theme, search settings, export, shortcuts, the open
// listing's save / compare / share). One modal; the query input keeps focus and the options are a listbox.
import { S, on, store, openDrawer, label, cost, score, isSaved, toggleSave, toggleCompare, setFilter, openSettings, filtered, openWizard } from './app.js';
import { flipTheme } from './shell.js';
import { $, esc, money, ICONS, imagesOf, mediaSrc, scoreColor, toast } from './util.js';
import { nlItem } from './features/nlsearch.js';   // [feature C] plain-language search row
import { hasInterior, goSeeInside } from './unit/camera-pref.js';   // [camera] the See inside command
import { extraActions } from './features/palette-actions.js';   // [feature C] undo, redo, tour, cheat sheet

const VIEWS = [['map', 'Map', 'Pins, commute surface and price tags'], ['list', 'Shortlist', 'Every home in a sortable table'], ['compare', 'Compare', 'Up to four homes side by side'],
  ['unit', 'Unit 3D', 'The unit in its block, with the sun; inside it when there is a floor plan (3D tab)'], ['plan', 'Floor plan', 'Plan studio and tracer (3D tab)'],
  ['research', 'Research', 'What to find out next'], ['list/tours', 'Tours', 'Plan visits and decide (under Shortlist)'], ['research/records', 'Records', 'Building records and reviews (under Research)']];
const hereView = (k) => (k === 'list/tours' ? S.view === 'tours' : k === 'research/records' ? S.view === 'research' && location.hash.startsWith('#research/records') : S.view === k && !(k === 'research' && location.hash.startsWith('#research/records')));
const IC = {
  view: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="2" y="2.5" width="12" height="11" rx="2"/><path d="M2 6h12"/></svg>',
  filter: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M2.5 3.5h11l-4.2 5v4l-2.6 1.2V8.5z"/></svg>',
  search: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/></svg>',
  theme: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M13.5 9.5A5.5 5.5 0 016.5 2.5a5.5 5.5 0 107 7z"/></svg>',
  gear: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M2.5 4.5h7M12.5 4.5h1M2.5 11.5h1M6.5 11.5h7"/><circle cx="11" cy="4.5" r="1.6"/><circle cx="5" cy="11.5" r="1.6"/></svg>',
  dl: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M8 2v8M4.5 6.5L8 10l3.5-3.5M3 13h10"/></svg>',
  key: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><rect x="1.5" y="4" width="13" height="8.5" rx="1.8"/><path d="M4 7h1M7 7h1M10 7h2M4.5 10h7"/></svg>',
  link: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M6.8 9.2a3 3 0 004.2 0l2-2a3 3 0 00-4.2-4.2l-.9.9M9.2 6.8a3 3 0 00-4.2 0l-2 2a3 3 0 004.2 4.2l.9-.9"/></svg>',
  inside: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true"><path d="M1.8 7.2L8 2l6.2 5.2M3.2 6.3V14h9.6V6.3"/><path d="M6.6 14V9.6h2.8V14"/></svg>',
  clock: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="8" cy="8" r="6"/><path d="M8 4.5V8l2.5 1.5"/></svg>',
  rail: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M2.5 4h11M2.5 8h11M2.5 12h11"/><circle cx="5" cy="4" r="1.3" fill="currentColor"/><circle cx="10.5" cy="8" r="1.3" fill="currentColor"/><circle cx="7" cy="12" r="1.3" fill="currentColor"/></svg>',
};
const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
let root = null, items = [], act = 0, lastFocus = null, recent = [];

/** Called once from app.js boot: remember recently opened listings for the empty-query state. */
export function initPalette() {
  recent = store.get('recent', []);
  on('select', ({ id }) => {
    if (!id) return;
    recent = [id, ...recent.filter((x) => x !== id)].slice(0, 6);
    store.set('recent', recent);
  });
}

/** Share link for a listing: this page with ?open=<id>, keeping the data / theme parameters. */
export function shareUrl(id) {
  const u = new URL(location.href);
  u.searchParams.set('open', id);
  if (!u.hash || u.hash === '#') u.hash = '#map';
  return u.toString();
}
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* clipboard blocked: fall back below */ }
  const ta = Object.assign(document.createElement('textarea'), { value: text });
  ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
  document.body.append(ta); ta.select();
  let ok = false; try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove(); return ok;
}
export async function shareListing(id) {
  const ok = await copyText(shareUrl(id));
  toast(ok ? 'Link copied: it opens this home' : 'Could not copy: your browser blocked the clipboard');
}

// ------------------------------------------------------------------ search
const norm = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
function matchListings(q, n = 7) {
  const toks = norm(q).split(/\s+/).filter(Boolean);
  if (!toks.length) return [];
  const out = [];
  for (const L of S.listings) {
    const name = norm(label(L)), hay = `${name} ${norm(L.address)} ${norm(L.neighborhood)} ${norm(L.id)}`;
    if (!toks.every((t) => hay.includes(t))) continue;
    // name-prefix and word-prefix matches first, then the live rank
    let s = 0;
    for (const t of toks) s += name.startsWith(t) ? 6 : new RegExp(`(^|[^a-z0-9])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(name) ? 4 : name.includes(t) ? 2 : 1;
    if (L.score?.eligible) s += 1;
    out.push([s, L._rank ?? 9999, L]);
  }
  return out.sort((a, b) => b[0] - a[0] || a[1] - b[1]).slice(0, n).map((x) => x[2]);
}
function listingItem(L, group) {
  const im = imagesOf(L), ph = im.own[0] || im.building[0]?.url, sv = score(L);
  return {
    group, id: 'l:' + L.id,
    icon: ph ? `<img src="${esc(mediaSrc(ph))}" alt="" referrerpolicy="no-referrer" loading="lazy">` : `<span class="pl-gly">${ICONS.doc}</span>`,
    title: `${esc(L.building || L.address)} <span>${esc(L.unit || '')}</span>${isSaved(L.id) ? `<span class="pl-star">${ICONS.star}</span>` : ''}`,
    sub: esc([L.neighborhood, L.beds != null ? (L.beds ? L.beds + ' bd' : 'Studio') : null, L.sqft ? Math.round(L.sqft) + ' ft²' : null, L._rank ? '#' + L._rank : null].filter(Boolean).join(' · ')),
    meta: `<b>${money(cost(L))}</b><i class="pl-score" style="--c:${scoreColor(sv)}">${sv == null ? '?' : Math.round(sv)}</i>`,
    run: () => { if (!['map', 'list'].includes(S.view)) location.hash = 'map'; openDrawer(L.id, { fly: true }); },
  };
}
function build(q) {
  const out = [], t = q.trim(), nq = norm(t);
  const has = (s) => !nq || norm(s).includes(nq);
  if (t) {
    const ask = nlItem(t); if (ask) out.push(ask);   // [feature C]
    const n = S.listings.filter((L) => `${L.building} ${L.unit} ${L.address} ${L.neighborhood}`.toLowerCase().includes(t.toLowerCase())).length;
    out.push({ group: 'Filter', id: 'filter', icon: IC.filter, title: `Show the homes matching <q>${esc(t)}</q>`, sub: n ? `${n} home${n === 1 ? '' : 's'} by name, address or neighbourhood` : 'No home matches: the list would be empty', meta: '<kbd>↵</kbd>',
      run: () => applyFilter(t) });
    for (const L of matchListings(t)) out.push(listingItem(L, 'Homes'));
  } else {
    const rec = recent.map((id) => S.listings.find((L) => L.id === id)).filter(Boolean).slice(0, 4);
    for (const L of rec) out.push({ ...listingItem(L, 'Recent'), id: 'r:' + L.id });
    const seen = new Set(rec.map((L) => L.id));
    const top = [...S.listings].filter((L) => L._rank && !seen.has(L.id)).sort((a, b) => a._rank - b._rank).slice(0, rec.length ? 3 : 5);
    for (const L of top) out.push(listingItem(L, 'Top matches'));
  }
  VIEWS.forEach(([k, n, d], i) => { if (has(n) || has(d) || has(k)) out.push({ group: 'Go to', id: 'v:' + k, name: n, icon: IC.view, title: esc(n), sub: esc(d), meta: `${hereView(k) ? '<span class="pl-on">Current</span>' : ''}${i < 6 ? `<kbd>${i + 1}</kbd>` : ''}`, run: () => { location.hash = k; } }); });
  const sel = S.sel && S.listings.find((L) => L.id === S.sel);
  // [camera] "See inside": the open home when it has an interior model, else the home Unit 3D is on, else the best-ranked one that has one
  const hashId = decodeURIComponent((location.hash.match(/^#unit\/([^/?]+)/) || [])[1] || '');
  const seeIn = [sel, S.listings.find((L) => L.id === hashId), ...[...S.listings].filter((L) => L._rank).sort((a, b) => a._rank - b._rank)].find((L) => L && hasInterior(S.manifest, L.id)) || null;
  const acts = [
    seeIn && ['See inside ' + label(seeIn), 'Stand in the apartment and look out of its windows (Unit 3D, Inside camera)', IC.inside, '', () => goSeeInside(seeIn.id)],
    sel && ['Save or unsave the open home', isSaved(sel.id) ? 'Remove ' + label(sel) + ' from your picks' : 'Save ' + label(sel) + ' to your picks', ICONS.starO, 's', () => toggleSave(sel.id)],
    sel && [S.compare.includes(sel.id) ? 'Remove the open home from Compare' : 'Add the open home to Compare', label(sel), ICONS.plus, 'c', () => toggleCompare(sel.id)],
    sel && ['Copy a link to the open home', 'Opens ' + label(sel) + ' for whoever you send it to', IC.link, '', () => shareListing(sel.id)],
    S.filters.q && ['Clear the text filter', `Now showing homes matching “${S.filters.q}”`, IC.filter, '', () => applyFilter('')],
    ['Switch to ' + (document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark') + ' theme', 'Light or dark', IC.theme, 't', () => flipTheme()],
    ['New search', 'Step-by-step wizard for a fresh set of criteria', ICONS.plus, '', () => openWizard({ mode: 'new' })],
    ['Search settings', 'Budget, must-haves, destinations and weights', IC.gear, '', () => openSettings()],
    innerWidth <= 1180 && ['Filters and ranking weights', 'Open the filter rail', IC.rail, '', () => { if (!['map', 'list'].includes(S.view)) location.hash = 'map'; document.body.classList.add('rail-open'); }],
    ['Export the filtered homes as CSV', `${filtered().length} homes`, IC.dl, '', () => $('csvBtn')?.click()],
    ['Keyboard shortcuts', 'Every key the dashboard listens for', IC.key, '?', () => dispatchEvent(new KeyboardEvent('keydown', { key: '?' }))],
    ...extraActions(),   // [feature C]
  ].filter(Boolean);
  for (const [n, d, ic, k, run] of acts) if (has(n) || has(d)) out.push({ group: 'Actions', id: 'a:' + n, name: n, icon: ic, title: esc(n), sub: esc(d), meta: k ? `<kbd>${esc(k)}</kbd>` : '', run });
  // a query that names a view or an action ("compare", "light") puts those commands ahead of the text filter
  const strong = nq.length >= 3 && out.some((it) => it.name && norm(it.name).split(/\s+/).some((w) => w.startsWith(nq)));
  const rank = strong ? { Ask: -1, 'Go to': 0, Actions: 1, Filter: 2, Homes: 3 } : { Ask: -1, Recent: 0, 'Top matches': 1, Filter: 0, Homes: 1, 'Go to': 2, Actions: 3 };
  return out.map((it, i) => [rank[it.group] ?? 9, i, it]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map((x) => x[2]);
}
function applyFilter(t) {
  const q = $('q'); if (q) q.value = t;
  if (!['map', 'list'].includes(S.view)) location.hash = 'map';
  setFilter('q', t);
  syncTrigger();
}
/** The top-bar search box mirrors the text filter and shows a clear button while one is active. */
export function syncTrigger() {
  const box = document.querySelector('.cmdk'); if (!box) return;
  box.classList.toggle('has-q', !!S.filters.q);
}

// ------------------------------------------------------------------ modal
export function openPalette(initial = '') {
  if (!root) {
    root = document.createElement('div');
    root.className = 'pl-scrim'; root.hidden = true;
    root.innerHTML = `<div class="pl" role="dialog" aria-modal="true" aria-label="Command menu">
      <div class="pl-in">${IC.search}<input id="plQ" type="text" role="combobox" aria-expanded="true" aria-controls="plList" aria-autocomplete="list" autocomplete="off" spellcheck="false" placeholder="Search homes, or ask: 2 bd under 5k by subway"><kbd>esc</kbd></div>
      <div class="pl-list" id="plList" role="listbox" aria-label="Results"></div>
      <div class="pl-foot"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>↵</kbd> open</span><span><kbd>esc</kbd> close</span><span class="sp"></span><span>${S.listings.length} homes</span></div></div>`;
    document.body.append(root);
    const inp = root.querySelector('#plQ');
    inp.addEventListener('input', () => { act = 0; render(inp.value); });
    inp.addEventListener('keydown', onKey);
    root.addEventListener('mousedown', (e) => { if (e.target === root) close(); });
    root.querySelector('.pl-list').addEventListener('mousemove', (e) => { const o = e.target.closest('[role=option]'); if (o && +o.dataset.i !== act) { act = +o.dataset.i; mark(false); } });
    root.querySelector('.pl-list').addEventListener('click', (e) => { const o = e.target.closest('[role=option]'); if (o) choose(+o.dataset.i); });
  }
  if (!root.hidden) { root.querySelector('#plQ').select(); return; }
  lastFocus = document.activeElement;
  root.hidden = false; act = 0;
  const inp = root.querySelector('#plQ');
  inp.value = initial; render(initial);
  requestAnimationFrame(() => { root.classList.add('on'); inp.focus(); inp.select(); });
}
function close(restore = true) {
  if (!root || root.hidden) return;
  root.classList.remove('on');
  setTimeout(() => { root.hidden = true; }, reduce() ? 0 : 140);
  if (restore && lastFocus?.isConnected && lastFocus !== document.body) lastFocus.focus?.({ preventScroll: true });
}
function render(q) {
  items = build(q);
  const list = root.querySelector('.pl-list');
  if (!items.length) { list.innerHTML = `<div class="pl-empty"><b>Nothing matches “${esc(q)}”</b><span>Try a building name, a street, a neighbourhood or a view.</span></div>`; root.querySelector('#plQ').removeAttribute('aria-activedescendant'); return; }
  let g = null;
  list.innerHTML = items.map((it, i) => {
    const head = it.group !== g ? `<div class="pl-g" role="presentation">${esc(it.group)}</div>` : '';
    g = it.group;
    return `${head}<div class="pl-it" role="option" id="pl-o${i}" data-i="${i}" aria-selected="false"><span class="pl-ic">${it.icon}</span><span class="pl-t"><b>${it.title}</b>${it.sub ? `<small>${it.sub}</small>` : ''}</span><span class="pl-m">${it.meta || ''}</span></div>`;
  }).join('');
  mark(true);
}
function mark(scroll) {
  root.querySelectorAll('[role=option]').forEach((o) => { const on2 = +o.dataset.i === act; o.setAttribute('aria-selected', on2); o.classList.toggle('on', on2); if (on2 && scroll) o.scrollIntoView({ block: 'nearest' }); });
  root.querySelector('#plQ').setAttribute('aria-activedescendant', 'pl-o' + act);
}
function onKey(e) {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (!items.length) return; act = (act + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length; mark(true); }
  else if (e.key === 'Home' && e.metaKey) { act = 0; mark(true); }
  else if (e.key === 'Enter') { e.preventDefault(); choose(act); }
  else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
  else if (e.key === 'Tab') e.preventDefault();   // focus stays in the query; arrows move through the options
}
function choose(i) {
  const it = items[i]; if (!it) return;
  close(true);
  if (root.contains(document.activeElement)) document.activeElement.blur();
  setTimeout(() => it.run(), 0);
}
