// The phone app's touch behaviour. The rules (where a sheet settles, which way a gesture goes, how far to pull) are in native-core.js;
// this file listens to fingers and moves things.
//   the listing sheet   the drawer on a phone is a bottom sheet with three detents (peek, half, full): drag it, flick it, tap its grab bar;
//                       dragged below peek it closes. At full its content scrolls, and a pull down from the top lowers it again.
//   swipe between homes a sideways swipe on the sheet (not on the photos, which have their own swipe) shows the next or previous home in the
//                       list's order, the content sliding with the finger
//   pull to refresh     pulling the results list down from its top checks for new data and a new version
//   quick actions       resting a finger on a card opens star / compare / see inside / share, with the card lifted
//   the keyboard        when it opens, the tab bar steps aside and the layout stays where it is (html.kbd-open)
// Motion respects prefers-reduced-motion and the Comfort setting; nothing here vibrates.
import { S, on, store, byId, label, openDrawer, closeDrawer, toggleSave, toggleCompare, isSaved } from '../app.js';
import { cardIds } from './results.js';
import { toast } from '../util.js';
import { shareListing } from '../palette.js';
import { goSeeInside, hasInterior } from '../unit/camera-pref.js';
import * as N from './native-core.js';
import { attachSheets } from './sheet-dismiss.js';

const $ = (id) => document.getElementById(id);
const phone = () => matchMedia('(max-width: 760px)').matches;
const coarse = () => matchMedia('(pointer: coarse)').matches;
const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.motion === 'reduced';
const EASE_SPRING = 'cubic-bezier(.34,1.3,.64,1)', EASE_FLICK = 'cubic-bezier(.16,.84,.3,1)';

// ------------------------------------------------------------------ the listing sheet
const sheet = { detent: 'closed', H: 0, heights: null, y: 0, token: 0 };
let dw = null, actions = null;

function metrics() {
  sheet.heights = N.detentHeights(innerHeight);
  sheet.H = sheet.heights.full;
  dw.style.setProperty('--sheet-h', sheet.H + 'px');
}
const closedY = () => sheet.H + 28;
const yFor = (visible) => sheet.H - visible;
const visibleNow = () => Math.max(0, sheet.H - sheet.y);

/** Put the sheet at translate `y` px; the actions bar is moved the other way (up to what the peek hides) so it stays on the screen's bottom
 *  edge while the sheet slides under it, and follows the sheet down only once it goes below peek. */
function place(y, { ms = 0, ease = EASE_SPRING } = {}) {
  sheet.y = y;
  const t = ms && !calm() ? `transform ${ms}ms ${ease}` : 'none';
  const counter = -Math.min(y, sheet.H - sheet.heights.peek);
  for (const el of [dw, actions]) if (el) el.style.transition = t;
  dw.style.transform = `translate3d(0, ${y}px, 0)`;
  if (actions) actions.style.transform = `translate3d(0, ${counter}px, 0)`;
  if (t !== 'none') {
    const token = ++sheet.token;
    setTimeout(() => { if (token === sheet.token) for (const el of [dw, actions]) if (el) el.style.transition = ''; }, ms + 60);
  }
}

const GRAB_LABEL = { peek: 'Listing details, short. Double tap to show more.', half: 'Listing details, half height. Double tap to show more.', full: 'Listing details, full height. Double tap to show less.' };
function setDetent(d, opts = {}) {
  sheet.detent = d; dw.dataset.detent = d;
  if (d === 'closed') place(closedY(), { ms: opts.ms ?? 380, ease: EASE_FLICK });
  else place(yFor(sheet.heights[d]), { ms: opts.ms ?? 440, ease: opts.ease || EASE_SPRING });
  const g = dw.querySelector('.sheet-grab'); if (g) g.setAttribute('aria-label', GRAB_LABEL[d] || 'Listing details');
}

/** The grab bar (a real button, so a screen reader and a tap can change the detent) and the "3 / 289" counter; rebuilt with the drawer's content. */
function chrome() {
  if (!phone() || !dw) return;
  if (!dw.querySelector(':scope > .sheet-grab')) {
    const g = document.createElement('button');
    g.type = 'button'; g.className = 'sheet-grab'; g.setAttribute('aria-label', GRAB_LABEL[sheet.detent] || 'Listing details'); g.innerHTML = '<i aria-hidden="true"></i>';
    g.addEventListener('click', () => { if (sheet.detent === 'closed' || suppressTap) return; setDetent(sheet.detent === 'full' ? 'half' : sheet.detent === 'peek' ? 'half' : 'full'); });
    dw.prepend(g);
  }
  if (!dw.querySelector(':scope > .sheet-pos')) { const p = document.createElement('span'); p.className = 'sheet-pos'; p.setAttribute('aria-hidden', 'true'); dw.append(p); }
  const ids = cardIds(), i = ids.indexOf(S.sel), pos = dw.querySelector(':scope > .sheet-pos');
  pos.textContent = i >= 0 ? `${i + 1} / ${ids.length}` : '';
  pos.hidden = i < 0;
  actions = dw.querySelector('.d-actions');
  if (actions) { actions.style.transition = 'none'; const counter = -Math.min(sheet.y, sheet.H - sheet.heights.peek); actions.style.transform = `translate3d(0, ${counter}px, 0)`; }
}

let suppressTap = false;
function initSheet() {
  dw = $('drawer'); if (!dw) return;
  const layout = () => {
    if (phone()) { metrics(); if (!dw.classList.contains('open')) { sheet.detent = 'closed'; dw.dataset.detent = 'closed'; } place(dw.classList.contains('open') ? yFor(sheet.heights[sheet.detent === 'closed' ? 'half' : sheet.detent]) : closedY()); chrome(); }
    else { sheet.detent = 'closed'; delete dw.dataset.detent; dw.style.transform = dw.style.transition = ''; dw.style.removeProperty('--sheet-h'); if (actions) { actions.style.transform = actions.style.transition = ''; } dw.querySelectorAll(':scope > .sheet-grab, :scope > .sheet-pos').forEach((n) => n.remove()); }
  };
  layout();
  addEventListener('resize', layout);
  matchMedia('(max-width: 760px)').addEventListener?.('change', layout);

  // open / close follow the drawer's own class, so every way of opening a home (card, pin, link, palette) gets the sheet
  new MutationObserver(() => {
    if (!phone()) return;
    const open = dw.classList.contains('open');
    if (open && sheet.detent === 'closed') { chrome(); setDetent('half'); }
    else if (!open && sheet.detent !== 'closed') setDetent('closed');
  }).observe(dw, { attributes: true, attributeFilter: ['class'] });
  new MutationObserver(() => chrome()).observe(dw, { childList: true });
  on('select', () => chrome());

  initSheetTouch();
}

function hScrollable(target) {
  // the sheet's own scroller (overflow-y: auto makes its overflow-x auto too) is not a sideways scroller; the photos, the section tabs and the like are
  for (let el = target; el && el !== dw && !el.classList?.contains('d-scroll'); el = el.parentElement) {
    if (el.nodeType !== 1) continue;
    if (el.scrollWidth > el.clientWidth + 2) { const ox = getComputedStyle(el).overflowX; if (ox === 'auto' || ox === 'scroll') return el; }
  }
  return null;
}

function initSheetTouch() {
  let g = null;
  const velocityX = (samples) => {   // px/ms, negative = leftwards
    const last = samples[samples.length - 1];
    let first = samples[0];
    for (const p of samples) if (last.t - p.t <= 120) { first = p; break; }
    return (last.x - first.x) / Math.max(1, last.t - first.t);
  };
  const velocity = (samples) => {   // px/ms, positive = the sheet is showing more
    const last = samples[samples.length - 1];
    let first = samples[0];
    for (const p of samples) if (last.t - p.t <= 90) { first = p; break; }
    return -(last.y - first.y) / Math.max(1, last.t - first.t);
  };
  dw.addEventListener('touchstart', (e) => {
    if (!phone() || sheet.detent === 'closed' || e.touches.length !== 1 || e.target.closest('textarea, input, select')) { g = null; return; }
    const t = e.touches[0], sc = dw.querySelector('.d-scroll');
    g = { x: t.clientX, y: t.clientY, axis: null, own: null, sc, h: hScrollable(e.target), grab: !!e.target.closest('.sheet-grab'), samples: [{ t: performance.now(), y: t.clientY, x: t.clientX }], base: null, mode: null, dx: 0 };
    if (!calm()) { for (const el of [dw, actions]) if (el) el.style.transition = 'none'; sheet.token++; }
  }, { passive: true });

  dw.addEventListener('touchmove', (e) => {
    if (!g) return;
    const t = e.touches[0], dx = t.clientX - g.x, dy = t.clientY - g.y;
    g.samples.push({ t: performance.now(), y: t.clientY, x: t.clientX }); if (g.samples.length > 12) g.samples.shift();
    if (!g.axis) {
      // a pull down from the top of a scrolled-out sheet, or any drag of a sheet that is not full, is claimed at once: a touchmove cannot be
      // cancelled after the browser has started to scroll
      const vertical = Math.abs(dy) > Math.abs(dx) * 1.5;
      if (vertical && Math.abs(dy) > 2 && (g.grab || sheet.detent !== 'full' || (dy > 0 && g.sc && g.sc.scrollTop <= 0))) { g.axis = 'y'; g.own = 'sheet'; g.base = { y: t.clientY, vis: visibleNow() }; g.from = sheet.detent; dw.classList.add('dragging'); }
      else {
        const a = N.lockAxis(dx, dy); if (!a) return;
        g.axis = a;
        if (a === 'y') g.own = 'content';
        else if (g.h) g.mode = 'native';
        else g.mode = 'home';
        if (g.mode === 'home') { g.w = dw.clientWidth || innerWidth; g.ids = cardIds(); g.start = { x: t.clientX }; }
      }
    }
    if (g.axis === 'y' && g.own === 'sheet') {
      e.preventDefault();
      const vis = N.dragVisible(g.base.vis - (t.clientY - g.base.y), sheet.heights);
      place(yFor(vis));
      return;
    }
    if (g.axis === 'x' && g.mode === 'home') {
      if (e.cancelable) e.preventDefault();
      const next = N.neighbour(g.ids, S.sel, dx < 0 ? 1 : -1);
      const shown = next ? dx : N.rubber(Math.abs(dx), 120) * Math.sign(dx);
      g.dx = shown;
      if (g.sc) { g.sc.style.transition = 'none'; g.sc.style.transform = `translate3d(${shown}px,0,0)`; g.sc.style.opacity = String(Math.max(0.35, 1 - Math.abs(shown) / (g.w * 0.9))); }
    }
  }, { passive: false });

  const end = (cancelled) => {
    if (!g) return;
    const s = g; g = null;
    if (s.own === 'sheet') {
      dw.classList.remove('dragging');
      suppressTap = true; setTimeout(() => { suppressTap = false; }, 250);
      const last = s.samples[s.samples.length - 1], stale = performance.now() - last.t > 120;
      const v = stale || cancelled ? 0 : velocity(s.samples);
      const to = N.snapDetent(visibleNow(), v, sheet.heights, s.from);
      const flick = Math.abs(v) > 0.4;
      if (to === 'closed') { setDetent('closed', { ms: flick ? 300 : 380, ease: EASE_FLICK }); closeDrawer(); }
      else setDetent(to, { ms: flick ? 360 : 440, ease: flick ? EASE_FLICK : EASE_SPRING });
      return;
    }
    if (s.mode === 'home' && s.sc) {
      const dir = cancelled ? 0 : N.homeSwipe(s.dx, velocityX(s.samples), s.w);
      const next = dir ? N.neighbour(s.ids, S.sel, dir) : null;
      const sc = s.sc;
      if (next) {
        const out = (dir > 0 ? -1 : 1) * (s.w * 0.55);
        sc.style.transition = calm() ? 'none' : 'transform 140ms ease-in, opacity 140ms ease-in'; sc.style.transform = `translate3d(${out}px,0,0)`; sc.style.opacity = '0';
        const go = () => {
          openDrawer(next, { fly: true, noVT: true, instant: true });
          if (!calm()) { dw.classList.add(dir > 0 ? 'swap-next' : 'swap-prev'); setTimeout(() => dw.classList.remove('swap-next', 'swap-prev'), 360); }
        };
        if (calm()) go(); else setTimeout(go, 130);
      } else {
        sc.style.transition = calm() ? 'none' : `transform 380ms ${EASE_SPRING}, opacity 200ms`; sc.style.transform = ''; sc.style.opacity = '';
        setTimeout(() => { sc.style.transition = ''; }, 420);
      }
    }
  };
  dw.addEventListener('touchend', () => end(false));
  dw.addEventListener('touchcancel', () => end(true));
}

// ------------------------------------------------------------------ pull to refresh
const REFRESH_ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13.2 8A5.2 5.2 0 113.9 4.8"/><path d="M3.6 1.9v3.2h3.2"/></svg>';
let refreshing = false;

/** Check for a new deploy and for new data. Returns 'busy', 'offline', 'new' (something new is ready: the page offers a reload) or 'current'. */
export async function refreshData() {
  if (refreshing) return 'busy';
  refreshing = true;
  try {
    if (navigator.onLine === false) return 'offline';
    const reg = await navigator.serviceWorker?.getRegistration?.().catch(() => null);
    reg?.update?.().catch(() => {});
    let fresh = false;
    try {
      const r = await fetch(`${S.base}/manifest.json`, { cache: 'reload' });   // 'reload' goes past the worker and the HTTP cache
      if (r.ok) { const m = await r.json(); fresh = !!m.generated && m.generated !== S.manifest?.generated; }
    } catch { return 'offline'; }
    await new Promise((res) => setTimeout(res, reg ? 600 : 0));   // a moment for the worker to say whether a new build is installing
    if (reg?.waiting || reg?.installing) fresh = true;
    if (fresh) toast('New data is ready', 7000, { label: 'Reload', run: () => location.reload() });
    return fresh ? 'new' : 'current';
  } finally { refreshing = false; }
}

function initPull() {
  const host = $('cards'), results = $('results'); if (!host || !results) return;
  const ind = document.createElement('div');
  ind.className = 'ptr'; ind.setAttribute('aria-hidden', 'true'); ind.innerHTML = REFRESH_ICON;
  results.append(ind);
  let st = null, travel = 0;
  const reset = (animate) => {
    host.classList.toggle('pulled', animate); host.style.transform = '';
    setTimeout(() => host.classList.remove('pulled'), 320);
    travel = 0;
  };
  host.addEventListener('touchstart', (e) => {
    if (!coarse() || e.touches.length !== 1 || host.scrollTop > 0 || refreshing) { st = null; return; }
    st = { x: e.touches[0].clientX, y: e.touches[0].clientY, on: false };
    ind.style.setProperty('--ptr-top', `${host.offsetTop}px`);
  }, { passive: true });
  host.addEventListener('touchmove', (e) => {
    if (!st) return;
    const t = e.touches[0], dy = t.clientY - st.y, dx = t.clientX - st.x;
    if (!st.on) {
      if (dy < -3 || host.scrollTop > 0 || Math.abs(dx) > Math.abs(dy) * 1.2 && Math.abs(dx) > 6) { st = null; return; }
      if (dy < 2) return;
      st.on = true; host.classList.remove('pulled'); ind.className = 'ptr on';
    }
    if (e.cancelable) e.preventDefault();
    travel = N.pullTravel(dy);
    host.style.transform = `translate3d(0, ${travel}px, 0)`;
    const p = Math.min(1, travel / N.PULL_THRESHOLD);
    ind.style.setProperty('--ptr-y', `${travel}px`); ind.style.setProperty('--ptr-s', String(0.6 + 0.4 * p)); ind.style.setProperty('--ptr-r', String(p * 220));
    ind.dataset.ready = N.shouldRefresh(travel) ? '1' : '0';
  }, { passive: false });
  const end = async () => {
    if (!st?.on) { st = null; return; }
    st = null;
    if (!N.shouldRefresh(travel)) { reset(true); ind.className = 'ptr out'; setTimeout(() => { ind.className = 'ptr'; }, 280); return; }
    reset(true); ind.className = 'ptr busy';
    const [r] = await Promise.all([refreshData(), new Promise((res) => setTimeout(res, calm() ? 0 : 700))]);
    ind.className = 'ptr out'; setTimeout(() => { ind.className = 'ptr'; }, 300);
    if (r === 'current') toast('Up to date', 1800);
    else if (r === 'offline') toast('Offline: showing the saved copy', 2600);
  };
  host.addEventListener('touchend', end);
  host.addEventListener('touchcancel', () => { if (st?.on) { reset(true); ind.className = 'ptr'; } st = null; });
}

// ------------------------------------------------------------------ long press: quick actions on a card
const ICO = {
  star: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><path d="M8 1.8l1.9 4 4.4.5-3.3 3 .9 4.3L8 11.4l-3.9 2.2.9-4.3-3.3-3 4.4-.5z"/></svg>',
  compare: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="2.5" width="5" height="11" rx="1.2"/><rect x="9" y="2.5" width="5" height="11" rx="1.2"/></svg>',
  inside: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><path d="M2 7.4L8 2.6l6 4.8M3.4 6.6V13h9.2V6.6"/><path d="M6.6 13V9.4h2.8V13"/></svg>',
  unit: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><path d="M8 1.8l5.6 3.2v6L8 14.2 2.4 11V5z"/><path d="M2.6 5.1L8 8.2l5.4-3.1M8 8.2v6"/></svg>',
  share: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 10V2.2M5 5l3-3 3 3M3.4 8.4v4.2a1 1 0 001 1h7.2a1 1 0 001-1V8.4"/></svg>',
  open: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5.6 3L10.6 8l-5 5"/></svg>',
};
let menu = null, suppressUntil = 0;

function closeMenu(restoreFocus = true) {
  if (!menu) return;
  const m = menu; menu = null;
  m.nodes.forEach((n) => n.remove());
  document.removeEventListener('keydown', m.onKey, true);
  if (restoreFocus) m.opener?.focus?.({ preventScroll: true });
}

function openMenu(id, card) {
  closeMenu(false);
  const L = byId(id); if (!L) return;
  const has = { interior: hasInterior(S.manifest, id), site: (S.manifest.sites || []).includes(id) };
  const list = N.quickActions(has, { saved: isSaved(id), comparing: S.compare.includes(id) });
  const r = card.getBoundingClientRect(), nodes = [];
  const scrim = document.createElement('div'); scrim.className = 'qa-scrim'; nodes.push(scrim);
  const clone = card.cloneNode(true);
  clone.removeAttribute('id'); clone.classList.remove('lp-held'); clone.classList.add('lp-lift'); clone.setAttribute('aria-hidden', 'true'); clone.inert = true;
  Object.assign(clone.style, { position: 'fixed', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px', margin: '0', zIndex: '41', pointerEvents: 'none', animation: 'none' });
  nodes.push(clone);
  const el = document.createElement('div');
  el.className = 'qa-menu'; el.setAttribute('role', 'menu'); el.setAttribute('aria-label', `Actions for ${label(L)}`);
  el.innerHTML = list.map((a) => {
    const toggle = a.key === 'save' || a.key === 'compare';
    return `<button type="button" role="${toggle ? 'menuitemcheckbox' : 'menuitem'}" ${toggle ? `aria-checked="${!!a.on}" aria-pressed="${!!a.on}"` : ''} data-qa="${a.key}">${ICO[a.key === 'save' ? 'star' : a.key] || ICO.open}<span>${a.label}</span></button>`;
  }).join('');
  nodes.push(el);
  document.body.append(...nodes);
  const mh = el.offsetHeight, gap = 10, below = r.bottom + gap + mh <= innerHeight - 12, w = el.offsetWidth;
  const left = Math.max(16, Math.min(innerWidth - w - 16, r.left + r.width / 2 - w / 2));
  el.style.left = left + 'px';
  el.style.top = (below ? r.bottom + gap : Math.max(12, r.top - gap - mh)) + 'px';
  el.style.setProperty('--qa-oy', below ? '0%' : '100%');
  const opener = document.activeElement;
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(); return; }
    const items = [...el.querySelectorAll('button')], i = items.indexOf(document.activeElement), step = { ArrowDown: 1, ArrowUp: -1 }[e.key];
    if (step) { e.preventDefault(); items[(i + step + items.length) % items.length].focus(); }
    else if (e.key === 'Tab') { e.preventDefault(); items[(i + (e.shiftKey ? -1 : 1) + items.length) % items.length].focus(); }
  };
  document.addEventListener('keydown', onKey, true);
  menu = { nodes, onKey, opener, id };
  // the finger that opened the menu is still down: its release is a click on whatever is under it (the scrim, or a menu item the menu was
  // drawn beneath it). The menu answers taps only once that finger has been up for a moment.
  el.dataset.armed = '0';
  const arm = () => { document.removeEventListener('pointerup', arm, true); document.removeEventListener('pointercancel', arm, true); setTimeout(() => { el.dataset.armed = '1'; }, 350); };
  document.addEventListener('pointerup', arm, true); document.addEventListener('pointercancel', arm, true);
  const armed = () => el.dataset.armed === '1';
  scrim.addEventListener('click', () => { if (armed()) closeMenu(false); });
  scrim.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-qa]'); if (!b || !armed()) return;
    const key = b.dataset.qa;
    closeMenu(false);
    if (key === 'save') toggleSave(id);
    else if (key === 'compare') toggleCompare(id);
    else if (key === 'inside') goSeeInside(id);
    else if (key === 'unit') location.hash = '#unit/' + encodeURIComponent(id);
    else if (key === 'share') shareListing(id);
    else if (key === 'open') openDrawer(id, { fly: true, noVT: true });
  });
  el.querySelector('button')?.focus({ preventScroll: true });
}

function initLongPress() {
  const host = $('cards'); if (!host) return;
  let lp = null;
  const stop = () => { if (!lp) return; clearTimeout(lp.timer); clearTimeout(lp.hold); lp.card.classList.remove('lp-held'); lp = null; };
  host.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch' || !e.isPrimary) return;
    const card = e.target.closest('.card');
    if (!card || e.target.closest('button, a, input, select, textarea')) return;
    stop();
    lp = { id: card.dataset.id, card, x: e.clientX, y: e.clientY };
    lp.hold = setTimeout(() => { if (!calm()) card.classList.add('lp-held'); }, 140);
    lp.timer = setTimeout(() => {
      const { id, card: c } = lp; lp = null;
      c.classList.remove('lp-held');
      suppressUntil = performance.now() + 900;
      openMenu(id, c);
    }, N.LONG_PRESS_MS);
  }, { passive: true });
  host.addEventListener('pointermove', (e) => { if (lp && Math.hypot(e.clientX - lp.x, e.clientY - lp.y) > N.TOUCH_SLOP) stop(); }, { passive: true });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) host.addEventListener(ev, stop, { passive: true });
  host.addEventListener('scroll', stop, { passive: true });
  // the finger lifting after the menu opened would otherwise open the home too
  host.addEventListener('click', (e) => { if (performance.now() < suppressUntil) { e.stopPropagation(); e.preventDefault(); } }, true);
  host.addEventListener('contextmenu', (e) => { if (coarse()) e.preventDefault(); });
}

// ------------------------------------------------------------------ the keyboard
function initKeyboard() {
  const vv = window.visualViewport; if (!vv) return;
  const field = () => { const a = document.activeElement; return !!a && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable) && !(a.type && /^(checkbox|radio|range|button|file)$/.test(a.type)); };
  const sync = () => {
    const kb = Math.max(0, innerHeight - vv.height - vv.offsetTop);
    const open = coarse() && kb > 120 && field();
    document.documentElement.classList.toggle('kbd-open', open);
    document.documentElement.style.setProperty('--kbd', open ? kb + 'px' : '0px');
  };
  vv.addEventListener('resize', sync); vv.addEventListener('scroll', sync);
  document.addEventListener('focusin', () => setTimeout(sync, 60)); document.addEventListener('focusout', () => setTimeout(sync, 60));
}

// ------------------------------------------------------------------ start
export function init() {
  initSheet();   // on any width: it only acts while the window is phone-sized (a narrowed desktop window gets the sheet too)
  initPull();
  initLongPress();
  initKeyboard();
  attachSheets();
  document.documentElement.dataset.native = coarse() ? 'touch' : 'pointer';
  addEventListener('hashchange', () => closeMenu(false));
  on('select', () => closeMenu(false));
}
export const sheetState = () => ({ ...sheet });
export { closeMenu as closeQuickActions };
