// App shell pieces that sit around the views: the three-way theme (system, dark, light), the one top-right menu (js/app-menu.js
// opens and navigates it; the choices are handled here), the "more figures" popover of the stats strip, the sub-tabs under the
// top bar (Shortlist / Tours, and Unit 3D / Floor plan under the Home tab), and the route table that keeps the old deep links
// (#tours, #records/<id>) working as redirects to their new homes.
import { S, on, emit, store, openSettings, exportPicks } from './app.js';
import { $ } from './util.js';
import { openPalette } from './palette.js';
import { setDensity } from './features/density.js';
import { initAppMenu } from './app-menu.js';

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
  return { view: v, arg, group: HOME_VIEWS.includes(v) ? 'home' : v };   // Unit 3D and Floor plan are two sides of the Home tab
}
/** The views the Home tab holds. Their own routes (#unit/<id>, #plan/<id>) are unchanged. */
export const HOME_VIEWS = ['unit', 'plan'];

// ------------------------------------------------------------------ sub-tabs: Shortlist / Tours, and Unit 3D / Floor plan under Home
const savedN = () => Object.values(S.picks).filter((p) => p.saved).length;
const lastHome = () => (store.get('home-last', 'unit') === 'plan' ? 'plan' : 'unit');
/** The home a sub-tab or the Home tab should open: the one being looked at, if it has the other view's data. */
function homeHref(view, arg) {
  const m = S.manifest || {}, has = (k) => (m[k] || []).includes(arg);
  const id = arg && (view === 'unit' ? has('plans') : has('sites')) ? '/' + arg : '';
  return `#${view}${id}`;
}
const hashArg = () => decodeURIComponent(location.hash.replace(/^#/, '').split('/').slice(1).join('/').split('?')[0]);
/** Where the `4` key goes: the Home view open last; from a Home view, the other one (on the same home when it has that data). */
export function homeTarget() {
  const here = HOME_VIEWS.includes(S.view);
  return homeHref(here ? (S.view === 'unit' ? 'plan' : 'unit') : lastHome(), here ? hashArg() : '').slice(1);
}
/** The thin tab row under the top bar: Shortlist / Tours for the Shortlist group, Unit 3D / Floor plan for the Home tab;
 *  hidden for every other view. The Home tab itself opens whichever of the two was open last. */
export function syncSubnav(view = S.view) {
  const el = $('subnav'); if (!el) return;
  const home = HOME_VIEWS.includes(view), short = view === 'list' || view === 'tours';
  if (home) { store.set('home-last', view); const t = $('tabHome'); if (t) t.setAttribute('href', `#${view}`); }
  else { const t = $('tabHome'); if (t) t.setAttribute('href', `#${lastHome()}`); }
  el.hidden = !(home || short);
  el.dataset.kind = home ? 'home' : short ? 'shortlist' : '';
  document.body.toggleAttribute('data-sub', home || short);
  if (home) {
    const arg = hashArg();
    el.setAttribute('aria-label', 'Home views');
    const a = (v, label) => `<a href="${homeHref(v, arg)}" data-sub="${v}" ${view === v ? 'class="on" aria-current="page"' : ''}>${label}</a>`;
    el.innerHTML = a('unit', 'Unit 3D') + a('plan', 'Floor plan');
    return;
  }
  el.setAttribute('aria-label', 'Shortlist sections');
  if (!short) return;
  const n = savedN();
  el.innerHTML = `<a href="#list" ${view === 'list' ? 'class="on" aria-current="page"' : ''}>Shortlist</a><a href="#list/tours" ${view === 'tours' ? 'class="on" aria-current="page"' : ''}>Tours${n ? `<i>${n}</i>` : ''}</a>`;
}

// ------------------------------------------------------------------ the menu's choices and the stats popover
export function initShell() {
  // Close the menu after a choice unless the control keeps it open (data-keep: accent, comfort, text size, office pin; the "Switch
  // search" row). Theme and density keep it open too, so you see the change and then press Esc.
  const menu = $('appMenu'), api = initAppMenu();
  menu.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.themeMode) { setThemeMode(b.dataset.themeMode); return; }
    if (b.dataset.density) { setDensity(b.dataset.density); return; }
    if (b.hasAttribute('data-keep') || b.id === 'mnSwitch') return;
    api.close();
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
