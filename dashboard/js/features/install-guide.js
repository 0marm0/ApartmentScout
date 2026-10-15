// "Add to Home Screen" for iOS. Safari has no install prompt, so on an iPhone (or iPad) that is not running the installed app this shows the
// three steps with a picture of each: Share, Add to Home Screen, Add. It opens by itself on a return visit, never while something else is
// open, can be put off ("Got it": asked again after two weeks) or switched off for good, and stays reachable from the menu
// ("Add to Home Screen"). Once the app is installed (display-mode standalone) none of this shows. The decisions are native-core.js
// (iosBrowser, guideDecision); a ?installguide=1 link opens it on an iPhone whatever its state.
import { store } from '../app.js';
import * as N from './native-core.js';
import { swipeToDismiss } from './sheet-dismiss.js';

const SHARE = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 10V2.2M5 5l3-3 3 3M3.4 8.4v4.2a1 1 0 001 1h7.2a1 1 0 001-1V8.4"/></svg>';
const PLUS = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><rect x="2" y="2" width="12" height="12" rx="3"/><path d="M8 5v6M5 8h6"/></svg>';
const KEY = 'install-guide';
const env = () => ({ browser: N.iosBrowser(navigator.userAgent, navigator.platform, navigator.maxTouchPoints), standalone: matchMedia('(display-mode: standalone)').matches || navigator.standalone === true });
const forced = () => new URLSearchParams(location.search).get('installguide') === '1';
let el = null, opener = null, inerted = [];

/** The pictures: small drawings of what the renter will see, in the app's own colours. */
function pic(kind, browser) {
  if (kind === 'share') {
    return browser === 'safari' || browser === 'other'
      ? `<svg viewBox="0 0 300 92" role="img" aria-label="Safari's bottom toolbar, with the Share button highlighted"><rect class="bg" width="300" height="92" rx="12"/>
          <rect x="22" y="14" width="256" height="20" rx="10" class="bar"/><text class="tx" x="150" y="28" text-anchor="middle">Your page</text>
          <rect class="bar" x="14" y="44" width="272" height="38" rx="14"/>
          <path class="ln" d="M46 63l-6 6 6 6"/><path class="ln" d="M96 63l6 6-6 6" opacity=".45"/>
          <circle class="hl" cx="150" cy="63" r="17"/><circle class="pulse" cx="150" cy="63" r="17"/>
          <g class="ac" transform="translate(141 54) scale(1.12)"><path d="M8 10V2.2M5 5l3-3 3 3M3.4 8.4v4.2a1 1 0 001 1h7.2a1 1 0 001-1V8.4"/></g>
          <rect class="ln" x="196" y="55" width="14" height="16" rx="2" style="fill:none"/><rect class="ln" x="246" y="55" width="16" height="16" rx="3" style="fill:none"/></svg>`
      : `<svg viewBox="0 0 300 92" role="img" aria-label="The browser's address bar, with the Share button highlighted"><rect class="bg" width="300" height="92" rx="12"/>
          <rect class="bar" x="14" y="14" width="272" height="38" rx="19"/><text class="tx" x="40" y="37">Your page</text>
          <circle class="hl" cx="258" cy="33" r="15"/><circle class="pulse" cx="258" cy="33" r="15"/>
          <g class="ac" transform="translate(250 25) scale(1)"><path d="M8 10V2.2M5 5l3-3 3 3M3.4 8.4v4.2a1 1 0 001 1h7.2a1 1 0 001-1V8.4"/></g>
          <rect class="row" x="14" y="62" width="272" height="8" rx="4" opacity=".5"/></svg>`;
  }
  if (kind === 'add') {
    return `<svg viewBox="0 0 300 118" role="img" aria-label="The share sheet, with Add to Home Screen highlighted"><rect class="bg" width="300" height="118" rx="12"/>
      <rect class="row" x="14" y="10" width="272" height="26" rx="8"/><text class="tx" x="28" y="27">Copy</text>
      <rect class="row" x="14" y="40" width="272" height="26" rx="8" opacity=".7"/><text class="tx" x="28" y="57">Add to Bookmarks</text>
      <rect class="hl" x="14" y="70" width="272" height="30" rx="9"/><text class="tx a" x="28" y="89">Add to Home Screen</text>
      <g class="ac" transform="translate(252 76) scale(1.1)"><rect x="2" y="2" width="12" height="12" rx="3"/><path d="M8 5v6M5 8h6"/></g>
      <rect class="row" x="14" y="104" width="272" height="8" rx="4" opacity=".4"/></svg>`;
  }
  return `<svg viewBox="0 0 300 108" role="img" aria-label="The Add to Home Screen sheet, with Add highlighted"><rect class="bg" width="300" height="108" rx="12"/>
    <rect class="row" x="14" y="10" width="272" height="88" rx="12"/>
    <text class="tx" x="30" y="30">Cancel</text><text class="tx b" x="150" y="30" text-anchor="middle">Add to Home Screen</text>
    <rect class="hl" x="236" y="16" width="42" height="20" rx="10"/><text class="tx a" x="257" y="30" text-anchor="middle">Add</text>
    <image href="assets/pwa/icon-192.png" x="30" y="46" width="40" height="40"/><rect x="30" y="46" width="40" height="40" rx="9" class="ln" style="fill:none"/>
    <text class="tx b" x="84" y="62">ApartmentScout</text><text class="tx" x="84" y="78">Opens full screen, like an app</text></svg>`;
}

function html(browser) {
  const where = browser === 'safari' || browser === 'other' ? 'in the toolbar at the bottom' : 'next to the address bar';
  const warn = browser === 'inapp' ? '<p class="ig-warn" role="note">This browser is inside another app, and those cannot add to the home screen. Open this page in <b>Safari</b> first (the Share button, then <b>Open in Safari</b>), then follow these steps.</p>' : '';
  return `<div class="ig-scrim" data-ig-close></div>
  <section class="ig-card" role="dialog" aria-modal="true" aria-labelledby="igT" aria-describedby="igS">
    <button type="button" class="ig-grab" data-ig-close aria-label="Close the install guide"><i aria-hidden="true"></i></button>
    <header class="ig-head"><img class="ig-icon" src="assets/pwa/icon-192.png" width="56" height="56" alt="">
      <div><h2 id="igT" tabindex="-1">Install ApartmentScout</h2><p id="igS">Add it to your home screen: it opens full screen, loads fast and works without a connection.</p></div></header>
    ${warn}
    <ol class="ig-steps">
      <li class="ig-step"><span class="ig-n" aria-hidden="true">1</span><h3>Tap Share ${SHARE} ${where}</h3><div class="ig-pic">${pic('share', browser)}</div></li>
      <li class="ig-step"><span class="ig-n" aria-hidden="true">2</span><h3>Scroll down and tap <b>Add to Home Screen</b> ${PLUS}</h3><div class="ig-pic">${pic('add', browser)}</div></li>
      <li class="ig-step"><span class="ig-n" aria-hidden="true">3</span><h3>Tap <b>Add</b> in the top corner</h3><div class="ig-pic">${pic('confirm', browser)}</div></li>
    </ol>
    <div class="ig-foot"><button type="button" class="ig-btn primary" data-ig="done">Got it</button><button type="button" class="ig-btn text" data-ig="never">Do not show this again</button></div>
    <p class="ig-note">Your picks and notes stay on this phone either way.</p>
  </section>`;
}

function close(how) {
  if (!el) return;
  const root = el; el = null;
  const st = store.get(KEY, {}) || {};
  if (how === 'never') store.set(KEY, { ...st, never: true });
  else if (how !== 'manual') store.set(KEY, { ...st, at: Date.now() });
  document.removeEventListener('keydown', onKey, true);
  for (const n of inerted) n.inert = false;
  inerted = [];
  const done = () => { root.remove(); if (opener?.isConnected) opener.focus?.({ preventScroll: true }); opener = null; };
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.motion === 'reduced') done();
  else { root.classList.add('closing'); setTimeout(done, 280); }
}
function onKey(e) {
  if (!el) return;
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close('later'); return; }
  if (e.key !== 'Tab') return;
  const f = [...el.querySelectorAll('button')].filter((b) => b.offsetParent !== null);
  if (!f.length) return;
  const i = f.indexOf(document.activeElement);
  if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
}

/** Open the guide. `auto` = it opened by itself (a manual open from the menu does not change when it next appears on its own). */
export function openGuide({ auto = false } = {}) {
  if (el) return;
  const { browser, standalone } = env();
  if (!browser || standalone) return;
  opener = document.activeElement;
  el = document.createElement('div');
  el.className = 'ig'; el.id = 'installGuide'; el.innerHTML = html(browser);
  document.body.append(el);
  inerted = [];
  for (const n of document.body.children) if (n !== el && !n.inert && !['SCRIPT', 'STYLE', 'LINK'].includes(n.tagName) && n.id !== 'toast') { n.inert = true; inerted.push(n); }
  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-ig-close]')) { close(auto ? 'later' : 'manual'); return; }
    const b = e.target.closest('[data-ig]'); if (!b) return;
    close(b.dataset.ig === 'never' ? 'never' : auto ? 'later' : 'manual');
  });
  const card = el.querySelector('.ig-card');
  swipeToDismiss(card, { scroller: card, handle: '.ig-grab', close: () => close(auto ? 'later' : 'manual') });
  document.addEventListener('keydown', onKey, true);
  requestAnimationFrame(() => el?.querySelector('#igT')?.focus({ preventScroll: true }));
}
export const isOpen = () => !!el;

const busy = () => !!(document.getElementById('drawer')?.classList.contains('open') || document.documentElement.classList.contains('tday-open') ||
  document.querySelector('[role="dialog"]:not(#installGuide .ig-card), .am-scrim:not([hidden]), .kbd-help, .coach'));

function menuItem() {
  const keys = document.getElementById('mnKeys'); if (!keys || document.getElementById('mnAddHome')) return;
  const b = document.createElement('button');
  b.type = 'button'; b.id = 'mnAddHome'; b.setAttribute('role', 'menuitem');
  b.innerHTML = `${PLUS.replace('<svg ', '<svg width="15" height="15" ')}<span>Add to Home Screen</span>`;
  b.addEventListener('click', () => { document.getElementById('menuBtn')?.click?.(); setTimeout(() => openGuide({ auto: false }), 120); });
  keys.after(b);
}

export function init() {
  const { browser, standalone } = env();
  if (!browser || standalone) return;
  menuItem();
  // count a visit once per browser session (a reload is not a return)
  let visits = Number(store.get('visits', 0)) || 0;
  try { if (!sessionStorage.getItem('as:visit-counted')) { visits += 1; store.set('visits', visits); sessionStorage.setItem('as:visit-counted', '1'); } } catch { /* storage unavailable: the guide waits for another time */ }
  const st = store.get(KEY, {}) || {};
  const decide = () => N.guideDecision({ browser, standalone, visits, dismissedAt: st.at ?? null, never: !!st.never, forced: forced() });
  if (decide() !== 'show') return;
  let tries = 0;
  const attempt = () => { if (el) return; if (busy() && tries++ < 6) { setTimeout(attempt, 6000); return; } if (!busy()) openGuide({ auto: true }); };
  setTimeout(attempt, forced() ? 600 : 7000);
}
