/* ApartmentScout service worker: makes the dashboard installable and usable offline.
 *
 * What it caches, and how
 *   shell + data   Everything listed in precache.json (written by scripts/optimize_site.py at deploy time: the HTML,
 *                  the JS and CSS bundles, MapLibre, the fonts, the icons and the core data files) goes into a cache
 *                  named for the build. A new deploy has a new build id, so it installs its own cache beside the old
 *                  one and the old one is deleted when the new worker takes over. Inside a build every file is
 *                  immutable, so these are served cache-first.
 *   other files    Anything else on this origin and inside the scope (map layers, 3D site models, plans, dossiers) is
 *                  cached the first time it is used, in a cache that also belongs to the build.
 *   navigation     The dashboard page comes from the build's cache, so the page and the hashed files it names stay one
 *                  consistent version and the app opens with no network. The browser's own worker update check
 *                  (sw.js is fetched uncached on every visit) finds a new deploy and the page offers a Reload button.
 *                  Without precache.json the page is network first (4 s timeout), then the cached copy.
 *   photos         Saved listing photos (media/, or the starter set media-lite/) are cached on first view in their own cache, which is not tied to a
 *                  build and is capped (PHOTO_CAP_BYTES, oldest first). Remote photos are not touched.
 *   map tiles      OpenFreeMap's tiles, its TileJSON and label glyphs (tiles.openfreemap.org) go network first (3 s when a saved copy exists), and
 *                  fall back to the offline pack the renter saved in Tour day (js/features/offline-tiles.js writes the cache `as-tiles`; a tile is
 *                  stored under its address without the weekly version folder). The worker only refreshes tiles that are already saved, plus the
 *                  small TileJSON and glyph files; it never saves a tile on its own. Esri's raster basemap (server.arcgisonline.com), whose terms do
 *                  not allow bulk saving, is kept only for what the renter looks at, in `as-tiles-viewed`, capped (TILE_VIEW_CAP_BYTES, oldest first).
 *   explicit reload A request with ?_fresh in its address (the pull-to-refresh check for new data) skips the worker and asks the network.
 *   no precache.json (a plain copy of dashboard/ with no deploy step) the worker caches what the page asks it to
 *                  (message WARM) and serves network-first, so a stale copy never hides new data.
 *
 * Updates: a new build installs in the background and WAITS. If it is already waiting when the app opens, the page (js/pwa.js)
 * switches to it at once (one reload per tab session); a build that arrives while the app is open is offered with a Reload
 * button, and only then sends SKIP_WAITING; the very first install activates at once. Never registered on file:// (browsers do
 * not allow it) or by the local `apartmentscout serve` page (js/pwa-core.js decides).
 *
 * Messages in: SKIP_WAITING, WARM {urls}, SET_PHOTO_CAP {bytes}, STATUS (answers on the MessagePort).
 * Notifications: the page shows a local notification through this worker when the app opens with news (js/features/whatsnew.js; no push
 * server is involved). A tap on it focuses the app and asks it to open What's new, or opens ./?whatsnew=1.
 */
'use strict';

const BUILD = '__AS_BUILD__';            // stamped by scripts/optimize_site.py; the placeholder means "not a built copy"
const BUILT = !BUILD.startsWith('__');
const SCOPE = typeof self !== 'undefined' && self.registration ? self.registration.scope : 'http://localhost/';
const SHELL = 'as-shell-' + BUILD;
const RUNTIME = 'as-runtime-' + BUILD;
const PHOTOS = 'as-photos';
const META = 'as-meta';
const PHOTO_INDEX = new URL('__photo_index__', SCOPE).href;
const NAV_TIMEOUT_MS = 4000;
let photoCap = 50 * 1024 * 1024;          // bytes of saved listing photos kept for offline
const TILES = 'as-tiles';                 // the saved offline pack (never deleted by an update; the page clears it)
const TILES_VIEWED = 'as-tiles-viewed';   // raster tiles the renter looked at (Esri), capped
const TILE_HOST = 'tiles.openfreemap.org';
const VIEWED_HOSTS = ['server.arcgisonline.com'];
const TILE_VIEW_CAP_BYTES = 40 * 1024 * 1024;
const TILE_SAVED_TIMEOUT_MS = 3000;       // a saved tile answers when the network is slower than this (a tunnel, one bar)

/** Oldest-first eviction plan: which keys to drop so the total stays within `cap`. Pure; exported for tests. */
function planEviction(index, cap, incoming) {
  const entries = Object.entries(index).sort((a, b) => a[1][1] - b[1][1]);
  let total = entries.reduce((n, e) => n + e[1][0], 0);
  const drop = [];
  for (const [key, [size]] of entries) {
    if (total <= cap) break;
    if (key === incoming) continue;
    drop.push(key); total -= size;
  }
  return { drop, total };
}

/** Is this a saved listing photo (media/, or the starter set media-lite/, under the scope), the one family capped for size? */
function isPhoto(url) {
  return (url.href.startsWith(new URL('media/', SCOPE).href) || url.href.startsWith(new URL('media-lite/', SCOPE).href)) && /\.(?:webp|jpe?g|png|avif|gif)$/i.test(url.pathname);
}

/** A map tile's address without OpenFreeMap's weekly version folder, so a saved tile answers for the same tile of a newer build.
 *  The page has the same rule (js/features/native-core.js normalizeTileUrl); tests/js/native-core.test.mjs checks they agree. */
function normalizeTileUrl(url) {
  return String(url).replace(/^(https:\/\/tiles\.openfreemap\.org\/planet)\/[0-9a-z_]+\/(\d+\/\d+\/\d+\.pbf)(?=$|\?)/, '$1/$2');
}

/** Never cached: the worker itself, its manifest and the local-only API. */
function isBypass(url) {
  const rel = url.href.slice(SCOPE.length);
  return rel === 'sw.js' || rel === 'precache.json' || rel.startsWith('api/');
}

const metaCache = { p: null };
function loadMeta() {
  if (!metaCache.p) {
    metaCache.p = caches.open(SHELL).then((c) => c.match(new URL('precache.json', SCOPE).href)).then((r) => (r ? r.json() : null)).catch(() => null);
  }
  return metaCache.p;
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    // a first install takes over at once; an update waits for the page to say so (the Reload button)
    if (!self.registration.active) self.skipWaiting();
    if (!BUILT) return;
    const res = await fetch(new URL('precache.json', SCOPE).href, { cache: 'no-store' });
    if (!res.ok) return;
    const list = await res.clone().json();
    const cache = await caches.open(SHELL);
    await cache.put(new URL('precache.json', SCOPE).href, res);
    const urls = [...(list.shell || []), ...(list.data || [])].map((u) => new URL(u, SCOPE).href);
    // cache: 'reload' skips the HTTP cache, which may still hold the previous deploy's copy for ten minutes
    await Promise.all(urls.map(async (u) => {
      const r = await fetch(new Request(u, { cache: 'reload' }));
      if (!r.ok) throw new Error('precache ' + r.status + ' ' + u);
      await cache.put(u, r);
    }));
  })());
});

self.addEventListener('activate', (event) => {
  // take the pages over first: until activation is done every request they make (the Reload after an update) waits for it
  event.waitUntil(self.clients.claim());
  // then drop the previous version's caches, alongside rather than in front (not under waitUntil, which would hold activation until it
  // is done): deleting a cache the old worker still has open could take minutes on a busy device. Every activation removes whatever
  // is stale, so a cleanup cut short is finished next time.
  (async () => {
    for (const name of await caches.keys()) {
      if ((name.startsWith('as-shell-') || name.startsWith('as-runtime-')) && name !== SHELL && name !== RUNTIME) await caches.delete(name);
    }
  })().catch(() => { /* the next activation tries again */ });
});

self.addEventListener('message', (event) => {
  const m = event.data || {};
  if (m.type === 'SKIP_WAITING') event.waitUntil(self.skipWaiting());   // kept alive until the switch is done: a busy device may stop an idle worker
  else if (m.type === 'SET_PHOTO_CAP' && m.bytes > 0) photoCap = m.bytes;
  else if (m.type === 'WARM' && Array.isArray(m.urls)) event.waitUntil(tracked('message WARM', warm(m.urls)));
  else if (m.type === 'STATUS' && event.ports[0]) event.waitUntil(status().then((s) => event.ports[0].postMessage(s)));
});

/** A newer version of this worker is installing, waiting or already active: this one's caches go when it takes over. */
function superseded() {
  const reg = self.registration, me = self.serviceWorker;
  return !!(reg.installing || reg.waiting || (me && reg.active && reg.active !== me));
}

async function warm(urls) {
  const cache = await caches.open(BUILT ? RUNTIME : SHELL);
  for (const raw of urls) {
    // warming a cache the next version deletes on activation only holds that activation up (a slow device took minutes)
    if (superseded()) return;
    try {
      const url = new URL(raw, SCOPE);
      if (url.origin !== new URL(SCOPE).origin || !url.href.startsWith(SCOPE) || isBypass(url) || isPhoto(url)) continue;
      if (await cache.match(url.href)) continue;
      const r = await fetch(url.href);
      if (r.ok && r.type === 'basic') await cache.put(url.href, r);
    } catch { /* a file that cannot be fetched now is fetched when it is needed */ }
  }
}

async function readIndex() {
  const c = await caches.open(META);
  const r = await c.match(PHOTO_INDEX);
  return r ? r.json() : {};
}
async function writeIndex(index) {
  const c = await caches.open(META);
  await c.put(PHOTO_INDEX, new Response(JSON.stringify(index), { headers: { 'content-type': 'application/json' } }));
}

// what this worker is answering right now (STATUS reports it): Chrome hands over to a waiting version only once the active one has
// nothing in flight, so this says what an update that does not take over is waiting for
const inflight = new Map();
let inflightSeq = 0;
function tracked(what, p) {
  const id = ++inflightSeq; inflight.set(id, what);
  return Promise.resolve(p).finally(() => inflight.delete(id));
}

async function status() {
  const index = await readIndex();
  const meta = await loadMeta();
  return { build: BUILD, built: BUILT, shell: meta ? (meta.shell || []).length : 0, photoBytes: Object.values(index).reduce((n, e) => n + e[0], 0), photoCount: Object.keys(index).length, photoCap,
    inflight: inflight.size, busyWith: [...inflight.values()].slice(0, 8) };
}

async function cachePhoto(request, response) {
  const size = Number(response.headers.get('content-length')) || (await response.clone().blob()).size;
  const cache = await caches.open(PHOTOS);
  await cache.put(request, response);
  const index = await readIndex();
  index[request.url] = [size, Date.now()];
  const { drop } = planEviction(index, photoCap, request.url);
  for (const key of drop) { await cache.delete(key); delete index[key]; }
  await writeIndex(index);
}

async function photo(request) {
  const cache = await caches.open(PHOTOS);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok && res.type === 'basic' && res.status === 200) await cachePhoto(request, res.clone()).catch(() => {});
  return res;
}

/** The dashboard's own page (the scope URL or its index.html): the one navigation served from the cache. */
function isHome(url) {
  return url.origin + url.pathname === SCOPE || url.origin + url.pathname === new URL('index.html', SCOPE).href;
}

async function navigate(request) {
  const url = new URL(request.url);
  const meta = await loadMeta();
  const shell = await caches.open(SHELL);
  const cached = async () => (isHome(url)
    ? (await shell.match(request, { ignoreSearch: true })) || (await shell.match(SCOPE)) || (await shell.match(new URL('index.html', SCOPE).href))
    : null);
  if (BUILT && meta) {
    // a built copy is one consistent version (the page and the hashed files it names): serve it, and let the worker
    // update check offer the next version. Only a page the cache does not hold goes to the network.
    return (await cached()) || fetch(request);
  }
  try {
    const net = await Promise.race([fetch(request), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), NAV_TIMEOUT_MS))]);
    if (net.ok && net.type === 'basic' && isHome(url)) shell.put(SCOPE, net.clone()).catch(() => {});
    return net;
  } catch {
    return (await cached()) || Response.error();
  }
}

async function assets(request) {
  const meta = await loadMeta();
  const shell = await caches.open(SHELL), runtime = await caches.open(RUNTIME);
  if (BUILT && meta) {
    const hit = (await shell.match(request, { ignoreSearch: true })) || (await runtime.match(request, { ignoreSearch: true }));
    if (hit) return hit;
    const res = await fetch(request);
    if (res.ok && res.type === 'basic') runtime.put(request, res.clone()).catch(() => {});
    return res;
  }
  // not a built copy: never let a cached file hide a newer one
  try {
    const res = await fetch(request);
    if (res.ok && res.type === 'basic') shell.put(request, res.clone()).catch(() => {});
    return res;
  } catch {
    const hit = await shell.match(request, { ignoreSearch: true });
    if (hit) return hit;
    throw new Error('offline and not cached');
  }
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const mine = all.find((c) => c.url.startsWith(SCOPE));
    if (mine) {
      await mine.focus();
      mine.postMessage({ type: 'OPEN_WHATSNEW' });
    } else await self.clients.openWindow(new URL('./?whatsnew=1', SCOPE).href);
  })());
});

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

/** OpenFreeMap tiles: the network first, the saved pack when the network fails or is slow. Only a tile that is already saved is refreshed,
 *  and the TileJSON and the label glyphs (small, needed to draw anything) are kept; the worker never saves other tiles by itself. */
async function packTile(request, url) {
  const cache = await caches.open(TILES), key = normalizeTileUrl(request.url);
  const saved = await cache.match(key);
  const small = url.pathname === '/planet' || url.pathname.startsWith('/fonts/');
  try {
    const res = await (saved ? withTimeout(fetch(request), TILE_SAVED_TIMEOUT_MS) : fetch(request));
    if (res.ok && (saved || small)) cache.put(key, res.clone()).catch(() => {});
    return res;
  } catch (err) {
    if (saved) return saved;
    throw err;
  }
}

let viewedIndex = null, viewedTimer = 0;
async function loadViewedIndex() {
  if (!viewedIndex) viewedIndex = await (async () => { const c = await caches.open(META), r = await c.match(new URL('__tile_index__', SCOPE).href); return r ? r.json() : {}; })().catch(() => ({}));
  return viewedIndex;
}
function persistViewedSoon() {
  clearTimeout(viewedTimer);
  viewedTimer = setTimeout(async () => {
    const c = await caches.open(META);
    await c.put(new URL('__tile_index__', SCOPE).href, new Response(JSON.stringify(viewedIndex || {}), { headers: { 'content-type': 'application/json' } })).catch(() => {});
  }, 1500);
}
/** Raster tiles from a provider whose terms do not allow saving an area: only what the renter looks at, newest kept, capped. */
async function viewedTile(request) {
  const cache = await caches.open(TILES_VIEWED);
  try {
    const res = await fetch(request);
    if (res.ok && res.status === 200) {
      const size = Number(res.headers.get('content-length')) || 0;
      const copy = res.clone();
      (async () => {
        await cache.put(request.url, copy);
        const index = await loadViewedIndex();
        index[request.url] = [size || (await (await cache.match(request.url)).clone().blob()).size, Date.now()];
        for (const key of planEviction(index, TILE_VIEW_CAP_BYTES, request.url).drop) { await cache.delete(key); delete index[key]; }
        persistViewedSoon();
      })().catch(() => {});
    }
    return res;
  } catch (err) {
    const hit = await cache.match(request.url);
    if (hit) return hit;
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  const url = new URL(req.url);
  if (url.hostname === TILE_HOST) { event.respondWith(tracked(req.url, packTile(req, url))); return; }
  if (VIEWED_HOSTS.includes(url.hostname)) { event.respondWith(tracked(req.url, viewedTile(req))); return; }
  if (url.searchParams.has('_fresh')) return;   // an explicit "ask the network" (the pull-to-refresh check marks its request); everything else is served as before
  if (url.origin !== new URL(SCOPE).origin || !url.href.startsWith(SCOPE) || isBypass(url)) return;
  if (req.mode === 'navigate') event.respondWith(tracked(req.url, navigate(req)));
  else if (isPhoto(url)) event.respondWith(tracked(req.url, photo(req)));
  else event.respondWith(tracked(req.url, assets(req)));
});

if (typeof module !== 'undefined') module.exports = { planEviction, isPhoto, isBypass, normalizeTileUrl };
