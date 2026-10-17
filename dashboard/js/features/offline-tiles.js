// Offline map for Tour day: "Save for offline" downloads the map tiles around today's stops, the destination and the renter's saved homes
// into the browser's Cache Storage (`as-tiles`); the service worker (sw.js) answers the map's tile requests from it when the network is
// down or slow. Nothing is saved until the renter taps the button.
//
// The basemap decides what is allowed (native-core.js basemapPolicy):
//   OpenFreeMap  its terms let an app save an area for offline use, up to 3,000 tiles or 50 MB per download, four requests at a time, with
//                a unique User-Agent. The pack is capped well under both (1,500 tiles, 40 MB, four at a time). A page cannot set a
//                User-Agent; the requests carry the site's own origin and the browser's agent, which is said in the panel.
//   Esri raster  its terms do not allow saving an area, so nothing is downloaded: the worker keeps only the tiles the renter looks at
//                (`as-tiles-viewed`, capped), and the panel says so.
//   own tiles    not saved at all.
import { S, store, dest, byId } from '../app.js';
import * as N from './native-core.js';

const CACHE = 'as-tiles', VIEWED = 'as-tiles-viewed', META = 'offline-pack';
const state = { kind: null, policy: N.basemapPolicy(null), busy: false, done: 0, total: 0, bytes: 0, error: '', viewed: 0, ctrl: null };
const subs = new Set();
const notify = () => subs.forEach((f) => { try { f(); } catch { /* a repaint that failed */ } });
export const subscribe = (fn) => { subs.add(fn); return () => subs.delete(fn); };
export const supported = () => typeof caches !== 'undefined' && typeof fetch === 'function';
export const saved = () => store.get(META, null);
export const progress = () => ({ busy: state.busy, done: state.done, total: state.total, bytes: state.bytes, error: state.error });

/** Where the pack reaches: today's stops first, then the destination, then the renter's saved and compared homes. [{ lat, lon, kind }] */
export function placesFor(stopIds = []) {
  const out = [], seen = new Set();
  const add = (id, lat, lon, kind) => { if (!Number.isFinite(lat) || !Number.isFinite(lon)) return; const k = `${lat.toFixed(4)},${lon.toFixed(4)}`; if (seen.has(k)) return; seen.add(k); out.push({ id, lat, lon, kind }); };
  for (const id of stopIds) { const L = byId(id); if (L) add(id, L.lat, L.lon, 'stop'); }
  const d = dest(); if (d) add(null, d.lat, d.lon, 'dest');
  for (const id of [...Object.keys(S.picks).filter((k) => S.picks[k]?.saved), ...S.compare]) { const L = byId(id); if (L) add(id, L.lat, L.lon, 'shortlist'); }
  return out;
}
export const estimate = (places) => N.planPack(places);

/** Learn which basemap is drawing and how much is saved. Call when the panel opens. */
export async function refresh() {
  try { state.kind = (await import('../map.js')).basemapKind(); } catch { state.kind = null; }
  state.policy = N.basemapPolicy(state.kind);
  if (state.policy.host === 'server.arcgisonline.com' && supported()) state.viewed = await sizeOf(VIEWED);
  notify();
  return state.policy;
}
export const policy = () => state.policy;

async function sizeOf(name) {
  try {
    const c = await caches.open(name);
    let n = 0;
    for (const req of await c.keys()) { const r = await c.match(req); n += (await r.clone().blob()).size; }
    return n;
  } catch { return 0; }
}

/** Save the pack. Resolves with the saved summary; rejects with an Error whose message the panel shows (a cancel rejects with name 'AbortError'). */
export async function save(places, { signal } = {}) {
  if (state.busy) return null;
  if (!supported()) throw new Error('This browser cannot keep files for offline use here.');
  if (!state.policy.pack) throw new Error(state.policy.note);
  if (navigator.onLine === false) throw new Error('You are offline: save the map while you have a connection.');
  const plan = N.planPack(places);
  if (!plan.tiles.length) throw new Error('There is nothing with a location to save yet: add a tour stop or save a home.');
  Object.assign(state, { busy: true, done: 0, total: plan.tiles.length, bytes: 0, error: '' });
  notify();
  const cache = await caches.open(CACHE);
  let inFlight = 0, maxInFlight = 0, failed = 0, consecutive = 0, stored = 0, stop = false, capped = plan.capped;
  const keep = new Set();
  try {
    try { navigator.storage?.persist?.(); } catch { /* best effort: it asks the browser not to evict the pack */ }
    const meta = await fetch(N.TILEJSON_URL, { signal });
    if (!meta.ok) throw new Error('The map server did not answer.');
    const json = await meta.clone().json();
    await cache.put(N.TILEJSON_URL, meta);
    keep.add(N.TILEJSON_URL);
    const template = json.tiles?.[0];
    if (!template) throw new Error('The map server sent an unexpected answer.');
    for (const u of N.glyphUrls()) {   // the label fonts: small, and without them the map has no street names
      try { const r = await fetch(u, { signal }); if (r.ok) { await cache.put(u, r); keep.add(u); } } catch (e) { if (e.name === 'AbortError') throw e; }
    }
    let next = 0;
    const one = async () => {
      while (!stop && !signal?.aborted) {
        const i = next++; if (i >= plan.tiles.length) return;
        const url = N.tileUrl(template, plan.tiles[i]);
        inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
        try {
          const res = await fetch(url, { signal });
          if (!res.ok) { failed++; consecutive++; if (res.status === 404) continue; if (consecutive >= 8) stop = true; continue; }
          const size = (await res.clone().arrayBuffer()).byteLength;
          if (state.bytes + size > N.PACK.maxBytes) { stop = true; capped = true; continue; }
          state.bytes += size;   // reserved before the await: the other downloads check the budget while this tile is being stored
          const key = N.normalizeTileUrl(url);
          try { await cache.put(key, res); } catch (e) { state.bytes -= size; throw e; }
          keep.add(key); stored++; consecutive = 0;
        } catch (e) {
          if (e.name === 'AbortError') throw e;
          failed++; consecutive++; if (consecutive >= 8) stop = true;
        } finally { inFlight--; state.done++; notify(); }
      }
    };
    await Promise.all(Array.from({ length: N.PACK.parallel }, one));
    if (signal?.aborted) throw Object.assign(new Error('Cancelled'), { name: 'AbortError' });
    if (!stored) throw new Error('No map tiles could be downloaded. Check your connection and try again.');
    // an earlier pack's tiles that are not part of this one go
    for (const req of await cache.keys()) if (!keep.has(req.url)) await cache.delete(req);
    const summary = { at: Date.now(), tiles: stored, bytes: state.bytes, places: plan.places, stops: places.filter((p) => p.kind === 'stop').length, capped, failed, maxParallel: maxInFlight };
    store.set(META, summary);
    return summary;
  } catch (e) {
    state.error = e.name === 'AbortError' ? '' : e.message || 'The map could not be saved.';
    throw e;
  } finally {
    state.busy = false; notify();
  }
}

export function cancel() { state.ctrl?.abort(); }
/** Start a save the panel can cancel; errors land in the panel, not in the caller. */
export function start(places) {
  state.ctrl = new AbortController();
  return save(places, { signal: state.ctrl.signal }).catch(() => null);
}

/** Delete everything saved for offline use: the pack and the tiles kept from viewing. */
export async function clear() {
  if (state.busy) cancel();
  try { await caches.delete(CACHE); await caches.delete(VIEWED); } catch { /* nothing to delete */ }
  store.set(META, null);
  Object.assign(state, { viewed: 0, error: '', done: 0, total: 0, bytes: 0 });
  notify();
}

const when = (t) => { try { return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); } catch { return ''; } };
const MAP_ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><path d="M1.8 3.6l4.1-1.4 4.2 1.4 4.1-1.4v10.2l-4.1 1.4-4.2-1.4-4.1 1.4zM5.9 2.2v10.2M10.1 3.6v10.2"/></svg>';
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** The panel's markup for the route screen. `places` = what a save would cover now. */
export function panelHTML(places) {
  const sv = saved(), p = state.policy, plan = N.planPack(places), stops = places.filter((x) => x.kind === 'stop').length, homes = places.filter((x) => x.kind === 'shortlist').length;
  let body = '';
  if (state.busy) {
    const pct = state.total ? Math.round((state.done / state.total) * 100) : 0;
    body = `<div class="tday-off-bar" role="progressbar" aria-label="Saving the map" aria-valuemin="0" aria-valuemax="${state.total}" aria-valuenow="${state.done}"><i style="width:${pct}%"></i></div>
      <p role="status" class="tday-off-stat"><span><b>${state.done}</b> of ${state.total} tiles</span><span><b>${N.bytesLabel(state.bytes)}</b></span></p>
      <div class="tday-off-row"><button type="button" class="tday-btn" data-off-cancel>Cancel</button></div>`;
  } else if (p.pack) {
    body = sv
      ? `<p class="tday-off-stat" role="status"><span>Saved ${esc(when(sv.at))}</span><span><b>${sv.tiles}</b> tiles</span><span><b>${N.bytesLabel(sv.bytes)}</b> on this phone</span><span>${sv.places} place${sv.places === 1 ? '' : 's'}</span></p>
        ${sv.capped ? '<p class="fine">Some of the wider area did not fit under the size limit; the stops come first.</p>' : ''}
        <div class="tday-off-row"><button type="button" class="tday-btn" data-off-save>Update</button><button type="button" class="tday-btn" data-off-clear>Clear saved map</button></div>`
      : `<p>Save the map around ${stops ? `today's ${stops} stop${stops === 1 ? '' : 's'}` : 'your stops'}${homes ? ` and your ${homes} saved home${homes === 1 ? '' : 's'}` : ''} so it still draws with no signal: about ${plan.tiles.length} tiles, a few MB.</p>
        <div class="tday-off-row"><button type="button" class="tday-btn primary" data-off-save ${plan.tiles.length && navigator.onLine !== false ? '' : 'disabled'}>Save for offline</button></div>
        ${navigator.onLine === false ? '<p class="fine">You are offline: save the map while you have a connection.</p>' : ''}`;
  } else {
    body = `${state.viewed ? `<p class="tday-off-stat" role="status"><span><b>${N.bytesLabel(state.viewed)}</b> of map kept from what you looked at</span></p>
        <div class="tday-off-row"><button type="button" class="tday-btn" data-off-clear>Clear</button></div>` : ''}`;
  }
  return `<h3>${MAP_ICON}Offline map</h3>${body}
    ${state.error ? `<p class="fine" role="alert" style="color:var(--bad)">${esc(state.error)}</p>` : ''}
    <p class="fine">${esc(p.note)}${p.pack ? ' Saved tiles are used only when the network is down or slow. Browsers cannot set a custom User-Agent, so the requests identify this site by its address.' : ''}</p>`;
}
