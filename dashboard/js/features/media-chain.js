// Where a saved listing photo comes from. A listing's photos are saved paths (`media/<id>/p-1.webp`, `media/shared/<hash>.webp`);
// which copy of a path exists depends on where the page runs, so every saved photo has one fallback chain, always in this order:
//
//   media      media/<path>                   the full set next to the page (`apartmentscout serve` answers it itself; a clone that
//                                             ran scripts/fetch_media.sh; a site built with the photos)
//   lite       media-lite/<path>              the starter set that is in the repository
//   remote     <media_base_url><path>         the published full set (manifest.json, written by `build` from search.media_base_url)
//   orig       the photo's original link      the listing site's own copy, if it still answers
//
// after which the card shows its aerial view or glyph (a dead image is left to its own `onerror`, and `data-media-gone` is set).
// A plain static server of dashboard/ therefore needs nothing but a request per tier; no tier is asked again for a photo that
// already loaded this session, and a tier that has failed DEAD_AFTER times without a single success is skipped from then on.
//
// Pure logic (no DOM) except installMediaFallback(), so `node --test tests/js/` covers the rest. Photos save to the same
// relative paths in every tier, so previews (lqip.json) and flags are keyed by the saved path whichever tier answers.
export const DEAD_AFTER = 3;
export const TIERS = ['media', 'lite', 'remote', 'orig'];

const SAVED = /^media\//;
const LITE = /^media-lite\//;
const cfg = { base: null, local: true, page: null };
const originals = new Map();   // saved path -> original link
const byOriginal = new Map();  // original link -> saved path
const resolved = new Map();    // saved path -> the URL that answered this session (when it was not the first tier)
const seen = Object.fromEntries(TIERS.map((t) => [t, { ok: 0, fail: 0 }]));
let installed = false;

/** The page's base URL for turning relative paths into absolute ones (document.baseURI in a browser). */
const pageUrl = () => cfg.page || (typeof document !== 'undefined' ? document.baseURI : 'http://localhost/');
const abs = (u) => { try { return new URL(u, pageUrl()).href; } catch { return String(u); } };
const rest = (path) => path.slice('media/'.length);

/** A usable remote base: an http(s) folder URL with a trailing slash, else null (never a data: or javascript: URL). */
export function normalizeBase(v) {
  if (typeof v !== 'string' || !/^https?:\/\//i.test(v.trim())) return null;
  try { const u = new URL(v.trim()); if (u.search || u.hash || u.username || u.password) return null; u.pathname = u.pathname.replace(/\/+$/, '') + '/'; return u.href; } catch { return null; }
}

/** Set up for a search: `base` is manifest.media_base_url, `local` is false for a single file with no media folder beside it,
 *  `page` (tests) replaces document.baseURI. Forgets what was learned about the previous search. */
export function configureMedia({ base = null, local = true, page = null } = {}) {
  cfg.base = normalizeBase(base);
  cfg.local = local !== false;
  cfg.page = page;
  resolved.clear();
  for (const t of TIERS) seen[t] = { ok: 0, fail: 0 };
}
export const mediaConfig = () => ({ ...cfg });

/** Is this a saved photo path (`media/...`)? */
export const isSavedPath = (u) => typeof u === 'string' && SAVED.test(u);

/** Tell the chain a saved path's original link, so the last tier is known. Called by the photo model. */
export function rememberOriginal(path, original) {
  if (!isSavedPath(path) || typeof original !== 'string' || !/^https?:\/\//i.test(original)) return;
  originals.set(path, original);
  byOriginal.set(original, path);
}

/** The published copy of a saved path, or null without a base. */
export const remoteUrl = (path) => (cfg.base && isSavedPath(path) ? cfg.base + rest(path).split('/').map(encodeURIComponent).join('/') : null);

/** Every place a saved path can be fetched from, in order: [{ tier, url }], duplicates of the same address dropped (on a site that
 *  serves its photos itself the remote tier is the media tier). */
export function chainOf(path) {
  if (!isSavedPath(path)) return [];
  const raw = [];
  if (cfg.local) raw.push({ tier: 'media', url: path }, { tier: 'lite', url: 'media-lite/' + rest(path) });
  const r = remoteUrl(path);
  if (r) raw.push({ tier: 'remote', url: r });
  if (originals.has(path)) raw.push({ tier: 'orig', url: originals.get(path) });
  const done = new Set();
  return raw.filter((c) => { const k = abs(c.url); if (done.has(k)) return false; done.add(k); return true; });
}

/** The saved path a URL stands for (the path itself, its media-lite copy, its published copy or its original link), else null. */
export function pathOf(src) {
  if (typeof src !== 'string' || !src) return null;
  if (SAVED.test(src)) return src;
  if (LITE.test(src)) return 'media/' + src.slice('media-lite/'.length);
  if (byOriginal.has(src)) return byOriginal.get(src);
  if (cfg.base && src.startsWith(cfg.base)) { try { return 'media/' + src.slice(cfg.base.length).split('/').map(decodeURIComponent).join('/'); } catch { return null; } }
  return null;
}

/** Has this tier failed enough, without ever answering, that asking it again is a waste? */
export const isDead = (tier) => seen[tier].fail >= DEAD_AFTER && seen[tier].ok === 0;

/** The URL to put in `src` for a saved path: what answered earlier this session, else the first tier not known to be dead.
 *  Anything that is not a saved path comes back unchanged. */
export function mediaSrc(path) {
  if (!isSavedPath(path)) return path;
  const hit = resolved.get(path);
  if (hit) return hit;
  for (const c of chainOf(path)) if (!isDead(c.tier)) return c.url;
  return path;
}

/** An image at `src` failed. Returns the next URL to try, `null` when the chain is used up, or `undefined` when `src` is not
 *  part of any chain (the caller leaves the error alone). */
export function failed(src) {
  const path = pathOf(src);
  if (!path) return undefined;
  const chain = chainOf(path), want = abs(src), i = chain.findIndex((c) => abs(c.url) === want);
  if (i < 0) return undefined;
  seen[chain[i].tier].fail++;
  if (resolved.get(path) && abs(resolved.get(path)) === want) resolved.delete(path);
  for (let j = i + 1; j < chain.length; j++) if (!isDead(chain[j].tier)) return chain[j].url;
  return null;
}

/** An image at `src` loaded: count it for its tier and remember it when a later tier had to answer. */
export function loaded(src) {
  const path = pathOf(src);
  if (!path) return;
  const chain = chainOf(path), want = abs(src), i = chain.findIndex((c) => abs(c.url) === want);
  if (i < 0) return;
  seen[chain[i].tier].ok++;
  if (i > 0) resolved.set(path, chain[i].url); else resolved.delete(path);
}

/** What the chain has learned so far: { media: { ok, fail }, ... } (for tests and the console). */
export const mediaStats = () => JSON.parse(JSON.stringify(seen));

/** One page-wide pair of listeners (capture phase: image errors do not bubble) drives the chain for every `<img>` whose source is
 *  a saved photo, wherever it was rendered: cards, the drawer, the lightbox, the map, the palette, tours, the share dialog. A
 *  step to the next tier swallows the event, so the image's own `onerror` (remove it, show a notice) runs only when the chain is
 *  used up, once. */
export function installMediaFallback(doc = document) {
  if (installed || !doc?.addEventListener) return;
  installed = true;
  doc.addEventListener('error', (e) => {
    const img = e.target;
    if (!img || img.tagName !== 'IMG') return;
    const next = failed(img.getAttribute('src'));
    if (next === undefined) return;
    if (next === null) { img.dataset.mediaGone = '1'; return; }
    e.stopImmediatePropagation();
    img.src = next;
  }, true);
  doc.addEventListener('load', (e) => {
    const img = e.target;
    if (img && img.tagName === 'IMG') { loaded(img.getAttribute('src')); delete img.dataset.mediaGone; }
  }, true);
}
