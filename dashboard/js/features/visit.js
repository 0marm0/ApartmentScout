// "Since your last visit": a pill at the left of the stats strip ("3 new · 2 price drops · 1 gone") that opens a popover
// listing the changes with links. The browser remembers the day it last saw this search; everything shown comes from
// recorded history (history.json events and price history, listed_at, checked dates). With nothing recorded since, the
// pill is not drawn at all. The diff itself is in visit-model.js.
import { S, on, store, loadJSON, openDrawer } from '../app.js';
import { $, esc, money } from '../util.js';
import { diffSinceVisit, pillParts, pillText, hasNews, baselineFor, localDay } from './visit-model.js';

const SESSION_KEY = 'as:visit-base';
const ICON = {
  new: '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M6 2.2v7.6M2.2 6h7.6"/></svg>',
  drops: '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M6 2.4v7M3 6.9l3 3 3-3"/></svg>',
  rises: '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M6 9.6v-7M3 5.1l3-3 3 3"/></svg>',
  gone: '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M3 3l6 6M9 3L3 9"/></svg>',
  relisted: '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M2.4 6a3.6 3.6 0 106.2-2.5M9.6 1.4v2.4H7.2"/></svg>',
  rechecked: '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M2.4 6.4l2.3 2.3 4.9-5.2"/></svg>',
};
const GROUPS = [
  ['new', 'New listings', 'Homes without a price had none recorded when they appeared'],
  ['drops', 'Price drops', ''], ['gone', 'No longer available', ''], ['rises', 'Price rises', ''], ['relisted', 'Back on the market', ''],
];
const MAX_ROWS = 6;

let hist = null, base = null, diff = null, open = false;

// ------------------------------------------------------------------ remembered visit
const key = () => `visit:${S.crit0?.search?.name || S.base}`;
function sessionBase() { try { return JSON.parse(sessionStorage.getItem(SESSION_KEY + ':' + key()) || 'null'); } catch { return null; } }
function setSessionBase(v) { try { sessionStorage.setItem(SESSION_KEY + ':' + key(), JSON.stringify(v)); } catch { /* private mode */ } }
const stamp = () => ({ at: new Date().toISOString(), day: localDay() });
/** Leave a stamp for the next visit. Called when the page is hidden or closed. */
function leave() { store.set(key(), stamp()); }

// ------------------------------------------------------------------ history
async function loadHistory() {
  const listed = (S.manifest.extra || []).map(String).some((x) => x === 'history.json' || x.endsWith('/history.json'));
  const emb = window.__AS_DATA__;
  if (!listed && !(emb && `${S.base}/history.json` in emb)) return null;
  const h = await loadJSON(`${S.base}/history.json`, null);
  return h && typeof h === 'object' ? h : null;
}

// ------------------------------------------------------------------ markup
const dayText = (d) => { const t = new Date(d + 'T12:00:00'); return isNaN(t) ? d : t.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }); };
const nameOf = (r) => (r.L ? `${r.L.building || r.L.address || r.id}${r.L.unit ? ' ' + r.L.unit : ''}` : r.id);
function rowHTML(g, r) {
  const sub = r.L?.neighborhood ? esc(r.L.neighborhood) : '';
  let right = '';
  if (g === 'drops' || g === 'rises') right = `<b class="vp-d ${g === 'drops' ? 'dn' : 'up'}">${r.delta < 0 ? '−' : '+'}${money(Math.abs(r.delta))}</b><span class="vp-v">${money(r.from)} → ${money(r.to)}${r.basis === 'net' ? ' net' : ''}</span>`;
  else if (g === 'new') right = r.price ? `<b>${money(r.price)}</b><span class="vp-v">${esc(dayText(r.date))}</span>` : `<span class="vp-v">${esc(dayText(r.date))}</span>`;
  else right = `<span class="vp-v">${esc(dayText(r.date))}</span>`;
  const label = `${esc(nameOf(r))}${sub ? ` <small>${sub}</small>` : ''}`;
  return r.L
    ? `<li><a href="#" class="vp-row" data-open="${esc(r.id)}"><span class="vp-n">${label}</span><span class="vp-r">${right}</span></a></li>`
    : `<li><span class="vp-row static"><span class="vp-n">${esc(r.id)} <small>no longer in your data</small></span><span class="vp-r">${right}</span></span></li>`;
}
function popHTML() {
  const groups = GROUPS.filter(([k]) => diff[k].length).map(([k, title, note]) => {
    const rows = diff[k], more = rows.length - MAX_ROWS;
    return `<section class="vp-g"><h4><i class="vp-ic ${k}">${ICON[k]}</i>${title}<span>${rows.length}</span></h4>${note && k === 'new' && rows.some((r) => !r.price) ? `<p class="vp-note">${note}</p>` : ''}
      <ul>${rows.slice(0, MAX_ROWS).map((r) => rowHTML(k, r)).join('')}</ul>${more > 0 ? `<a class="vp-more" href="#research/new">${more} more in Research</a>` : ''}</section>`;
  }).join('');
  const rc = diff.rechecked.length;
  const foot = rc ? `<p class="vp-chk"><i class="vp-ic rechecked">${ICON.rechecked}</i>${rc} home${rc === 1 ? ' was' : 's were'} checked again since then, from their recorded check dates.</p>` : '';
  return `<header class="vp-h"><div><b>Since your last visit</b><span>${esc(dayText(base))}</span></div></header>
    <div class="vp-body">${groups}${foot}</div>
    <footer class="vp-f"><a href="#research/new" class="vp-all">All changes</a><button type="button" class="btn sm" data-seen>Mark as seen</button></footer>`;
}

const pillEl = () => $('kpis')?.querySelector('.visit-pill'), popEl = () => $('kpis')?.querySelector('.visit-pop');
function setOpen(v, focus = false) {
  const b = pillEl(), p = popEl(); if (!b || !p) { open = false; return; }
  open = v; p.hidden = !v; b.setAttribute('aria-expanded', String(v));
  if (v && focus) p.querySelector('a, button')?.focus();
}
function mount() {
  const strip = $('kpis'); if (!strip) return;
  const prev = strip.querySelector('.visit-pop');
  if (prev) open = !prev.hidden;
  strip.querySelector('.visit-wrap')?.remove();
  diff = base ? diffSinceVisit({ history: hist, listings: S.listings, since: base }) : null;
  if (!diff || !hasNews(diff)) { open = false; return; }
  const parts = pillParts(diff), text = pillText(diff);
  const wrap = document.createElement('div');
  wrap.className = 'visit-wrap';
  wrap.innerHTML = `<button type="button" class="visit-pill" id="visitPill" aria-haspopup="true" aria-expanded="${open}" aria-controls="visitPop" aria-label="Since your last visit, ${esc(dayText(base))}: ${esc(text)}" title="Changes recorded since your last visit on ${esc(dayText(base))}">
      <i class="vp-dot" aria-hidden="true"></i>${parts.map((p) => `<span class="vp-i ${p.key}"><span class="vp-ic">${ICON[p.key]}</span><b>${p.n}</b><span class="vp-w"> ${esc(p.label)}</span></span>`).join('<span class="vp-sep" aria-hidden="true">·</span>')}</button>
    <div class="menu-pop visit-pop" id="visitPop" role="dialog" aria-label="Changes since your last visit" ${open ? '' : 'hidden'}>${popHTML()}</div>`;
  strip.prepend(wrap);
}

/** The renter has seen these: the baseline moves to today and the pill goes away. */
function markSeen() {
  const s = stamp();
  base = s.day; setSessionBase(s); store.set(key(), s);
  open = false; mount();
}

function wire() {
  const strip = $('kpis');
  strip.addEventListener('click', (e) => {
    if (e.target.closest('.visit-pill')) { e.stopPropagation(); setOpen(popEl()?.hidden !== false, e.detail === 0); return; }
    const pop = e.target.closest('.visit-pop'); if (!pop) return;
    const a = e.target.closest('[data-open]');
    if (a) { e.preventDefault(); setOpen(false); openDrawer(a.dataset.open, { fly: true }); return; }
    if (e.target.closest('a[href^="#"]')) { setOpen(false); return; }
    if (e.target.closest('[data-seen]')) markSeen();
  });
  document.addEventListener('click', (e) => { if (open && !e.target.closest('.visit-wrap')) setOpen(false); });
  strip.addEventListener('keydown', (e) => {
    if (!e.target.closest('.visit-wrap')) return;
    if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false); pillEl()?.focus(); return; }
    const pop = popEl(); if (!pop || pop.hidden || !['ArrowDown', 'ArrowUp'].includes(e.key)) return;
    const it = [...pop.querySelectorAll('a[href], button')], i = it.indexOf(document.activeElement);
    e.preventDefault(); it[(i + (e.key === 'ArrowDown' ? 1 : -1) + it.length) % it.length]?.focus();
  });
}

export async function init() {
  const stored = store.get(key(), null);
  base = baselineFor(stored, sessionBase());
  // this tab keeps comparing against the same day until it is closed, so a reload does not lose the pill
  if (base) setSessionBase({ day: base });
  if (!stored) leave();
  addEventListener('pagehide', leave);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') leave(); });
  wire();
  on('kpis', mount);
  mount();
  hist = await loadHistory();
  mount();
}

/** For tests and the console: what the pill is based on. */
export const state = () => ({ base, diff, hist });
