// Installable app: registers the service worker (sw.js), offers an update when a new version has been deployed,
// adds "Install app" to the settings menu where the browser supports it, and says so when the connection drops.
// Loaded lazily by app.js after the first render. It does nothing on file:// (the standalone file), on the local
// `apartmentscout serve` page, or where service workers do not exist; see pwa-core.js.
import { toast } from './util.js';
import { shouldRegister, warmList } from './pwa-core.js';

const $ = (id) => document.getElementById(id);
let deferredInstall = null;   // the browser's beforeinstallprompt event, kept for the menu item
let reloadOnTakeover = false; // only reload for a controller change the renter asked for

/** Show the "new version" prompt once for this waiting worker. */
function offerUpdate(worker) {
  if ($('pwaUpdate')) return;
  const el = document.createElement('div');
  el.id = 'pwaUpdate'; el.className = 'pwa-update'; el.setAttribute('role', 'status');
  el.innerHTML = '<i class="pwa-dot" aria-hidden="true"></i><span class="pwa-msg"><b>A new version is ready.</b> Reload to use it; your picks are kept.</span>' +
    '<button type="button" class="btn sm primary" data-pwa="reload">Reload</button><button type="button" class="btn sm ghost" data-pwa="later">Later</button>';
  el.addEventListener('click', (e) => {
    const act = e.target.closest('[data-pwa]')?.dataset.pwa;
    if (act === 'later') el.remove();
    if (act === 'reload') { reloadOnTakeover = true; worker.postMessage({ type: 'SKIP_WAITING' }); el.querySelector('.pwa-msg').textContent = 'Updating…'; }
  });
  document.body.append(el);
}

/** A newer version that was already downloaded when the app opened: switch to it now (one reload), instead of running an old
 *  copy until someone notices the prompt. Once per tab session, so a worker that fails to take over cannot loop; then the prompt. */
function applyAtOpen(worker) {
  try { if (sessionStorage.getItem('as:sw-applied') === '1') return false; sessionStorage.setItem('as:sw-applied', '1'); } catch { return false; }
  reloadOnTakeover = true;
  worker.postMessage({ type: 'SKIP_WAITING' });
  return true;
}

function watchUpdates(reg) {
  const check = () => { if (reg.waiting && navigator.serviceWorker.controller && !applyAtOpen(reg.waiting)) offerUpdate(reg.waiting); };
  check();
  reg.addEventListener('updatefound', () => {
    const w = reg.installing; if (!w) return;
    w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) offerUpdate(w); });
  });
  // a long-lived tab or an installed app that stays open: look for a new deploy when it comes back to the front
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
}

/** Ask the worker to cache what the page has loaded so far (needed only where precache.json does not exist). */
function warm() {
  const sw = navigator.serviceWorker.controller; if (!sw) return;
  const scope = new URL('./', document.baseURI).href;
  sw.postMessage({ type: 'WARM', urls: warmList(performance.getEntriesByType('resource').map((e) => e.name), location.origin, scope) });
}

function installMenu() {
  const keys = $('mnKeys'); if (!keys || $('mnInstall')) return;
  const b = document.createElement('button');
  b.type = 'button'; b.id = 'mnInstall'; b.setAttribute('role', 'menuitem'); b.hidden = true;
  b.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M8 2v7.5M4.8 6.6L8 9.8l3.2-3.2M3 12.5h10"/></svg><span>Install app</span>';
  b.addEventListener('click', async () => {
    const ev = deferredInstall; if (!ev) return;
    deferredInstall = null; b.hidden = true;
    ev.prompt();
    try { const r = await ev.userChoice; if (r?.outcome === 'accepted') toast('Installing ApartmentScout…'); } catch { /* dismissed */ }
  });
  keys.after(b);
}

export function initPwa() {
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  document.documentElement.toggleAttribute('data-installed', standalone);   // CSS hook (the shell can drop its browser-only chrome)
  addEventListener('offline', () => toast('You are offline: showing the saved copy of your search', 3600));
  addEventListener('online', () => toast('Back online', 1800));
  addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall = e; installMenu(); const b = $('mnInstall'); if (b) b.hidden = false; });
  addEventListener('appinstalled', () => { deferredInstall = null; const b = $('mnInstall'); if (b) b.hidden = true; toast('ApartmentScout is installed'); });

  const ok = shouldRegister({ protocol: location.protocol, hostname: location.hostname, search: location.search,
    hasToken: !!document.querySelector('meta[name="as-token"]'), hasApi: 'serviceWorker' in navigator,
    hasBuild: !!document.querySelector('meta[name="as-build"]') });
  if (!ok) return;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (reloadOnTakeover) location.reload(); else setTimeout(warm, 800); });
  const url = new URL('sw.js', document.baseURI);
  navigator.serviceWorker.register(url, { scope: new URL('./', url).pathname, updateViaCache: 'none' })
    .then((reg) => {
      watchUpdates(reg);
      // let the app settle, then cache whatever it loaded that the build did not list
      setTimeout(warm, 4000);
      addEventListener('hashchange', () => setTimeout(warm, 2500));
    })
    .catch((e) => console.warn('service worker unavailable', e));
}
