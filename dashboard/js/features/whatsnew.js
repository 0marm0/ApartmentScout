// "What's new": a calm panel of what changed in this search, built from alerts.json (the digest `apartmentscout build` writes from
// `apartmentscout alerts`; the model is whatsnew-model.js). It opens from the "What's new" row of the top-right menu (a dot on the
// menu button says there is something unseen), as a popover on a desktop and a bottom sheet on a phone. Opening it marks the digest
// as seen in this browser. Where the browser has them it also sets the app badge on the Home Screen icon (Badging API) and, only
// after the renter presses the button in the panel, shows one local notification when the installed app opens and finds something new
// (Notification API). Neither needs a server. Alerts while the app is closed come from the GitHub issue (docs/guides/alerts.md).
import { S, store, loadJSON, openDrawer, reloaders } from '../app.js';
import { $, esc, toast } from '../util.js';
import { parseAlerts, badgeCount, shouldNotify, notificationText, sectionsOf, subtitle, notifyState } from './whatsnew-model.js';

const ICON = {
  new: '<path d="M6 2.2v7.6M2.2 6h7.6"/>', fits: '<path d="M2.4 6.4l2.3 2.3 4.9-5.2"/>', drops: '<path d="M6 2.4v7M3 6.9l3 3 3-3"/>', rises: '<path d="M6 9.6v-7M3 5.1l3-3 3 3"/>',
  gone: '<path d="M3 3l6 6M9 3L3 9"/>', back: '<path d="M2.4 6a3.6 3.6 0 106.2-2.5M9.6 1.4v2.4H7.2"/>', jumps: '<path d="M2.5 9l3-3 1.8 1.8L10 4.2M7.4 4.2H10v2.6"/>',
  resolved: '<path d="M4.3 4.4a1.9 1.9 0 113 1.5c-.7.5-1.3.9-1.3 1.6M6 9.4v.1"/>',
};
const MAX_ROWS = 8;

let digest = null, seenId = null, open = false, opener = null, lastBadge = null, loaded = false;

const key = (k) => `whatsnew:${k}:${S.crit0?.search?.name || S.base}`;
const loadSeen = () => store.get(key('seen'), null);
const notifySupported = () => 'Notification' in window;
const permission = () => (notifySupported() ? Notification.permission : 'denied');
const notifyEnabled = () => store.get(key('notify'), false) === true;
const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const phone = () => matchMedia('(max-width: 760px)').matches;

// ------------------------------------------------------------------ data
async function loadAlerts() {
  const listed = (S.manifest.extra || []).map(String).some((x) => x === 'alerts.json' || x.endsWith('/alerts.json'));
  const emb = window.__AS_DATA__;
  if (!listed && !(emb && `${S.base}/alerts.json` in emb)) return null;
  return parseAlerts(await loadJSON(`${S.base}/alerts.json`, null));
}

// ------------------------------------------------------------------ the badge, the dot, the menu row
function setBadge(n) {
  if (n === lastBadge) return;
  lastBadge = n;
  try {
    if (n > 0 && typeof navigator.setAppBadge === 'function') navigator.setAppBadge(n)?.catch?.(() => {});
    else if (typeof navigator.clearAppBadge === 'function') navigator.clearAppBadge()?.catch?.(() => {});
  } catch { /* a browser without the Badging API, or one that needs permission first */ }
}
function paint() {
  const n = badgeCount(digest, seenId);
  const dot = $('newsDot'), btn = $('menuBtn'), row = $('mnNewsN');
  if (dot) dot.hidden = !n;
  if (row) { row.hidden = !digest?.total; row.textContent = digest?.total ? String(digest.total) : ''; row.classList.toggle('unseen', n > 0); }
  if (btn) {
    const base = btn.dataset.baseLabel || (btn.dataset.baseLabel = btn.getAttribute('aria-label') || 'Menu');
    btn.setAttribute('aria-label', n ? `${base}. ${n} new change${n === 1 ? '' : 's'} in What's new` : base);
  }
  setBadge(n);
}

// ------------------------------------------------------------------ panel markup
const rowHTML = (g, r) => {
  const inner = `<span class="wn-n">${esc(r.name)}${r.hood ? ` <small>${esc(r.hood)}</small>` : ''}</span>
    <span class="wn-r">${r.right ? `<b class="${r.tone || ''}">${esc(r.right)}</b>` : ''}${r.sub ? `<span class="wn-v">${esc(r.sub)}</span>` : ''}</span>`;
  return r.static ? `<li><span class="wn-row static">${inner}</span></li>`
    : `<li><a href="#" class="wn-row" data-home="${esc(r.id)}">${inner}</a></li>`;
};
function sectionHTML(s) {
  const more = s.rows.length - MAX_ROWS;
  return `<section class="wn-g"><h4><i class="wn-ic ${s.key}"><svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">${ICON[s.key]}</svg></i>${esc(s.title)}<span>${s.count}</span></h4>
    <ul>${s.rows.slice(0, MAX_ROWS).map((r) => rowHTML(s.key, r)).join('')}</ul>${more > 0 ? `<p class="wn-more">${more} more in the same digest (see the GitHub issue or <code>apartmentscout alerts</code>)</p>` : ''}</section>`;
}
function notifyHTML() {
  const st = notifyState({ supported: notifySupported(), permission: permission(), enabled: notifyEnabled(), ios: isIos(), standalone: isStandalone() });
  if (st.kind === 'none') return '';
  const btn = st.kind === 'off' ? '<button type="button" class="btn sm primary" data-wn="notify-on">Turn on</button>'
    : st.kind === 'on' ? '<button type="button" class="btn sm" data-wn="notify-off">Turn off</button>' : '';
  return `<div class="wn-dev" data-state="${st.kind}"><div><b>On this device</b><p>${esc(st.text)}</p></div>${btn}</div>`;
}
function panelHTML() {
  const d = digest, secs = sectionsOf(d);
  const body = !d ? '<p class="wn-empty">No alerts file in this search yet. Run <code>apartmentscout alerts</code>, then <code>apartmentscout build</code>.</p>'
    : secs.length ? secs.map(sectionHTML).join('') : `<p class="wn-empty">${esc(subtitle(d))}</p>`;
  const quiet = d?.quietNew ? `<p class="wn-quiet">${d.quietNew} other new home${d.quietNew === 1 ? '' : 's'} did not fit your criteria and ${d.quietNew === 1 ? 'is' : 'are'} not listed.</p>` : '';
  return `<span class="am-grab" aria-hidden="true"></span>
    <header class="wn-h"><div><b id="wnTitle" tabindex="-1">What's new</b></div><button type="button" class="icon-btn wn-x" data-wn="close" aria-label="Close What's new"><svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M3 3l6 6M9 3L3 9"/></svg></button></header>
    ${d && secs.length ? `<p class="wn-sub">${esc(subtitle(d))}</p>` : ''}
    <div class="wn-body">${body}${quiet}</div>
    <footer class="wn-f">${notifyHTML()}<p class="wn-how">${d ? `${d.tracked} homes tracked, ${d.fitting} fit your criteria. ` : ''}A phone alert while the app is closed comes from the daily GitHub issue.</p></footer>`;
}

// ------------------------------------------------------------------ open and close
const popEl = () => document.getElementById('wnPop');
function render() { const p = popEl(); if (p) p.innerHTML = panelHTML(); }

function show(from) {
  if (open) return;
  opener = from || document.activeElement;
  let scrim = document.getElementById('wnScrim');
  if (!scrim) {
    scrim = document.createElement('div'); scrim.id = 'wnScrim'; scrim.className = 'wn-scrim';
    scrim.addEventListener('click', () => hide(true));
    document.body.append(scrim);
  }
  let pop = popEl();
  if (!pop) {
    pop = document.createElement('div');
    pop.id = 'wnPop'; pop.className = 'menu-pop wn-pop'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-labelledby', 'wnTitle'); pop.tabIndex = -1;
    pop.addEventListener('click', onClick);
    document.body.append(pop);
  }
  pop.innerHTML = panelHTML();
  scrim.hidden = !phone(); pop.hidden = false; open = true;
  document.body.classList.add('wn-open');
  markSeen();
  $('wnTitle')?.focus({ preventScroll: true });
}
function hide(refocus = false) {
  if (!open) return;
  open = false;
  const pop = popEl(), scrim = document.getElementById('wnScrim');
  if (pop) pop.hidden = true;
  if (scrim) scrim.hidden = true;
  document.body.classList.remove('wn-open');
  if (refocus && opener?.isConnected) opener.focus?.();
}
function markSeen() {
  if (!digest) return;
  seenId = digest.id;
  store.set(key('seen'), seenId);
  paint();
}

async function turnOn() {
  if (!notifySupported()) return;
  let perm = Notification.permission;
  if (perm === 'default') { try { perm = await Notification.requestPermission(); } catch { perm = 'denied'; } }
  if (perm === 'granted') {
    store.set(key('notify'), true);
    toast('Notifications are on for this device');
    // the notification for what is already new has been seen, so it is not repeated for this digest
    if (digest) store.set(key('notified'), digest.id);
    paint();
  } else toast('Notifications were not allowed');
  if (open) render();
}
function turnOff() { store.set(key('notify'), false); toast('Notifications are off'); if (open) render(); }

function onClick(e) {
  const a = e.target.closest('[data-home]');
  if (a) { e.preventDefault(); hide(false); openDrawer(a.dataset.home, { fly: true }); return; }
  const act = e.target.closest('[data-wn]')?.dataset.wn;
  if (act === 'close') hide(true);
  else if (act === 'notify-on') turnOn();
  else if (act === 'notify-off') turnOff();
}

// ------------------------------------------------------------------ a local notification when the app opens with news
async function maybeNotify() {
  if (!shouldNotify({ digest, permission: permission(), enabled: notifyEnabled(), notifiedId: store.get(key('notified'), null), seenId })) return;
  const { title, body } = notificationText(digest);
  const opts = { body, tag: 'apartmentscout-whatsnew', icon: new URL('assets/pwa/icon-192.png', document.baseURI).href, data: { open: 'whatsnew' } };
  try {
    const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null;
    if (reg?.showNotification) await reg.showNotification(title, opts);   // the only way on an iPhone, and what a tap on it talks to
    else new Notification(title, opts);
    store.set(key('notified'), digest.id);
  } catch { /* the browser refused: nothing else to do */ }
}

// ------------------------------------------------------------------ start
export async function init() {
  const row = $('mnNews');
  row?.addEventListener('click', () => show($('menuBtn')));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && open) { e.stopPropagation(); hide(true); } }, true);
  document.addEventListener('click', (e) => { if (open && e.target.isConnected && !e.target.closest('#wnPop, #mnNews, #menuBtn')) hide(false); });   // a control that re-drew the panel is detached by now
  addEventListener('resize', () => { const s = document.getElementById('wnScrim'); if (open && s) s.hidden = !phone(); });
  // a tap on the notification: the service worker focuses this tab and sends the message (or opens ?whatsnew=1)
  navigator.serviceWorker?.addEventListener('message', (e) => { if (e.data?.type === 'OPEN_WHATSNEW') show($('menuBtn')); });
  seenId = loadSeen();
  reloaders['whatsnew:seen'] = () => { seenId = loadSeen(); if (loaded) paint(); };   // the sync layer wrote what the other device has read
  digest = await loadAlerts();
  loaded = true;
  paint();
  if (new URLSearchParams(location.search).get('whatsnew') === '1') show($('menuBtn'));
  else maybeNotify();
}

/** For tests and the console. */
export const state = () => ({ digest, seenId, open, badge: lastBadge, loaded });
