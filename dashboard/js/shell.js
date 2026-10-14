// App shell pieces that sit around the views: the three-way theme (system, dark, light), the settings menu in the top
// bar, the "more figures" popover of the stats strip, the Shortlist / Tours sub-tabs, and the route table that keeps
// the old deep links (#tours, #records/<id>) working as redirects to their new homes.
import { S, on, emit, store, openSettings, exportPicks } from './app.js';
import { $ } from './util.js';
import { openPalette } from './palette.js';

// ------------------------------------------------------------------ theme
const MODES = ['system', 'dark', 'light'];
const mq = matchMedia('(prefers-color-scheme: light)');
let mode = 'dark';

export const themeMode = () => mode;
const effective = () => (mode === 'system' ? (mq.matches ? 'light' : 'dark') : mode);

function applyTheme(announce) {
  const root = document.documentElement, eff = effective(), changed = root.dataset.theme !== eff;
  root.dataset.theme = eff; root.dataset.themePref = mode;
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', getComputedStyle(root).getPropertyValue('--ground').trim());
  document.querySelectorAll('button[data-theme-mode]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.themeMode === mode)));
  if (changed && announce) emit('theme');
}
/** Choose system, dark or light; the choice is remembered in this browser. */
export function setThemeMode(m) {
  mode = MODES.includes(m) ? m : 'dark';
  store.set('theme', mode);
  applyTheme(true);
}
/** The `t` key and the palette command: flip whatever is showing now to the other theme. */
export function flipTheme() { setThemeMode(effective() === 'dark' ? 'light' : 'dark'); }
/** ?theme=system|dark|light wins over the remembered choice; the default stays dark. */
export function initTheme() {
  const q = new URLSearchParams(location.search).get('theme'), saved = store.get('theme', null);
  mode = MODES.includes(q) ? q : MODES.includes(saved) ? saved : 'dark';
  applyTheme(false);
  mq.addEventListener?.('change', () => { if (mode === 'system') applyTheme(true); });
}

// ------------------------------------------------------------------ routes
/** Resolve a hash to the view the shell shows. Old deep links are rewritten in place (no new history entry):
 *  #tours becomes #list/tours and #records/<id> becomes #research/records/<id>. */
export function parseRoute(hash = location.hash) {
  const raw = hash.replace(/^#/, '') || 'map';
  const [head, ...rest] = raw.split('/');
  let canon = raw;
  if (head === 'tours') canon = 'list/tours';
  else if (head === 'records') canon = 'research/records' + (rest.length ? '/' + rest.join('/') : '');
  if (canon !== raw) { try { history.replaceState(null, '', '#' + canon); } catch { location.replace('#' + canon); } }
  const [v, ...r2] = canon.split('/'), arg = r2.join('/');
  if (v === 'list' && arg === 'tours') return { view: 'tours', arg: '', group: 'list' };
  return { view: v, arg, group: v };
}

// ------------------------------------------------------------------ Shortlist / Tours sub-tabs
const savedN = () => Object.values(S.picks).filter((p) => p.saved).length;
/** The thin tab row under the top bar for the Shortlist group; hidden for every other view. */
export function syncSubnav(view = S.view) {
  const el = $('subnav'); if (!el) return;
  const on2 = view === 'list' || view === 'tours';
  el.hidden = !on2;
  document.body.toggleAttribute('data-sub', on2);
  if (!on2) return;
  const n = savedN();
  el.innerHTML = `<a href="#list" ${view === 'list' ? 'class="on" aria-current="page"' : ''}>Shortlist</a><a href="#list/tours" ${view === 'tours' ? 'class="on" aria-current="page"' : ''}>Tours${n ? `<i>${n}</i>` : ''}</a>`;
}

// ------------------------------------------------------------------ settings menu and the stats popover
function popover(btn, pop) {
  const items = () => [...pop.querySelectorAll('button:not([disabled]), a[href]')];
  const set = (open, focus = false) => {
    pop.hidden = !open; btn.setAttribute('aria-expanded', String(open));
    if (open && focus) (pop.querySelector('[aria-checked="true"]') || items()[0])?.focus();
  };
  btn.addEventListener('click', (e) => { e.stopPropagation(); set(pop.hidden, pop.hidden && e.detail === 0); });
  document.addEventListener('click', (e) => { if (!pop.hidden && !pop.contains(e.target) && !btn.contains(e.target)) set(false); });
  pop.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); set(false); btn.focus(); return; }
    const it = items(), i = it.indexOf(document.activeElement);
    const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
    if (step && it.length) { e.preventDefault(); it[(i + step + it.length) % it.length].focus(); }
    else if (e.key === 'Home') { e.preventDefault(); it[0]?.focus(); }
    else if (e.key === 'End') { e.preventDefault(); it[it.length - 1]?.focus(); }
    else if (e.key === 'Tab') set(false);
  });
  return set;
}

export function initShell() {
  // settings menu
  const btn = $('setBtn'), menu = $('setMenu');
  const setMenu = popover(btn, menu);
  menu.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.themeMode) { setThemeMode(b.dataset.themeMode); return; }   // the menu stays open: see the change, then Esc
    if (b.hasAttribute('data-keep')) return;   // [feature C] accent, comfort switches and text size also keep the menu open
    setMenu(false);
    if (b.id === 'mnSearch') openSettings();
    else if (b.id === 'mnPicks') exportPicks();
    else if (b.id === 'mnPalette') openPalette();
    else if (b.id === 'mnKeys') dispatchEvent(new KeyboardEvent('keydown', { key: '?' }));
  });
  applyTheme(false);   // radios reflect the mode chosen before the menu existed
  // stats strip: the rest of the figures behind one button. The strip re-renders on every filter change, so the
  // popover is driven from the persistent container (one set of listeners) and re-reads its nodes each time.
  const strip = $('kpis');
  let timer = 0;
  const pop = () => strip.querySelector('.kpi-pop'), more = () => strip.querySelector('.kpi-more');
  const setKpi = (open) => {
    clearTimeout(timer);
    const p = pop(), b = more(); if (!p || !b) return;
    p.hidden = !open; b.setAttribute('aria-expanded', String(open));
  };
  strip.addEventListener('click', (e) => {
    if (e.target.closest('[data-open]')) { setKpi(false); return; }
    if (e.target.closest('.kpi-more')) { e.stopPropagation(); setKpi(pop()?.hidden !== false); }
  });
  strip.addEventListener('pointerover', (e) => { if (e.pointerType === 'mouse' && e.target.closest('.kpi-wrap')) { clearTimeout(timer); timer = setTimeout(() => setKpi(true), 140); } });
  strip.addEventListener('pointerout', (e) => { if (e.pointerType === 'mouse' && e.target.closest('.kpi-wrap') && !e.relatedTarget?.closest?.('.kpi-wrap')) { clearTimeout(timer); timer = setTimeout(() => setKpi(false), 260); } });
  strip.addEventListener('keydown', (e) => { if (e.key === 'Escape' && pop() && !pop().hidden) { e.stopPropagation(); setKpi(false); more()?.focus(); } });
  document.addEventListener('click', (e) => { if (pop() && !pop().hidden && !e.target.closest('.kpi-wrap')) setKpi(false); });
  on('saved', () => syncSubnav());
}
