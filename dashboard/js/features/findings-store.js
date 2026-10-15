// Tour findings: where they live. The text of a visit is small: it is kept in this browser's local storage and, when the
// page is served by `apartmentscout serve`, also written to <search>/tours/<id>/findings.json through the local API
// (same token and origin guards as the rest). Photos are larger: with the API they go to <search>/tours/<id>/photos/ (the
// server re-encodes them to WebP and drops their metadata); without it they stay in IndexedDB in this browser. Every
// storage call is wrapped in try/catch, because private windows, blocked site data and previews make all of them throw.
import { S, store } from '../app.js';
import { getSession } from '../local-api.js';
import { normalize, VERSION } from './findings-model.js';

const listeners = new Set();
let recs = {}, key = '', mode = { server: false, photos: false, maxBytes: 12 * 1024 * 1024 }, ready = false;
const timers = new Map(), inflight = new Set(), unsent = new Set();   // unsent: visits whose latest write has not reached the search folder
let state = { phase: 'idle', where: 'device', error: '' };   // idle | saving | saved | error

/** Is this page one that has a local API to save to (served by `apartmentscout serve`)? Static copies keep visits in the browser only. */
export const apiExpected = () => !!token() && location.protocol.startsWith('http');
/** Visits written in this browser that the search folder has not received yet (the API was away). */
export const pending = () => [...unsent];
/** Own key, not `findings:...`: the storage guard reads anything under that name as the visits' object. */
const unsentKey = () => key.replace(/^findings:/, 'findings-unsent:');
function markSent(id) { if (unsent.delete(id)) store.set(unsentKey(), [...unsent]); }
export const searchKey = () => `findings:${S.crit0?.search?.name || S.base}`;
export const onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const notify = (id) => listeners.forEach((fn) => { try { fn(id); } catch (e) { console.warn('findings listener failed', e); } });
const setState = (patch) => { state = { ...state, ...patch }; listeners.forEach((fn) => { try { fn(null); } catch { /* a listener must not break saving */ } }); };
export const status = () => ({ ...state, server: mode.server, photos: mode.photos });
export const isReady = () => ready;
export const nowZ = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');
export const get = (id) => recs[id] || null;
export const all = () => recs;
export const ids = () => Object.keys(recs);
export const has = (id) => !!recs[id];

// ------------------------------------------------------------------ the local API
const token = () => document.querySelector('meta[name="as-token"]')?.content || '';
async function api(method, path, body, raw) {
  const r = await fetch(path, {
    method, cache: 'no-store', keepalive: !raw,   // a visit saved as the tab closes still goes out
    headers: { 'X-AS-Token': token(), ...(raw ? { 'Content-Type': raw.type || 'image/webp' } : body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: raw ? raw : body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await r.json(); } catch { /* an error page without JSON */ }
  if (!r.ok) { const e = new Error(data?.error || `The server answered ${r.status}`); e.status = r.status; throw e; }
  return data;
}

// ------------------------------------------------------------------ this browser
function persist() { store.set(key, recs); }
/** Newest of two versions of one visit; photos from both are kept (a photo exists once, wherever it was taken). */
export function mergeRecord(a, b) {
  if (!a || !b) return a || b || null;
  const [new_, old] = (b.updated || '') > (a.updated || '') ? [b, a] : [a, b];
  const photos = [...(new_.photos || [])];
  for (const p of old.photos || []) if (!photos.some((x) => x.id === p.id)) photos.push(p);
  return normalize({ ...new_, photos });
}

// ------------------------------------------------------------------ IndexedDB photos
let dbp = null;
function db() {
  if (dbp) return dbp;
  dbp = new Promise((resolve) => {
    try {
      const q = indexedDB.open('as-tours', 1);
      q.onupgradeneeded = () => q.result.createObjectStore('photos', { keyPath: 'k' });
      q.onsuccess = () => resolve(q.result);
      q.onerror = () => resolve(null);
      q.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
  return dbp;
}
const pk = (id, pid) => `${key}|${id}|${pid}`;
async function idb(fn) {
  const d = await db();
  if (!d) return null;
  return new Promise((resolve) => {
    try { const tx = d.transaction('photos', 'readwrite'); const r = fn(tx.objectStore('photos')); tx.oncomplete = () => resolve(r?.result ?? true); tx.onerror = tx.onabort = () => resolve(null); } catch { resolve(null); }
  });
}
const idbPut = (id, pid, blob) => idb((s) => s.put({ k: pk(id, pid), blob, type: blob.type, at: nowZ() }));
export const idbGet = async (id, pid) => (await idb((s) => s.get(pk(id, pid))))?.blob || null;
const idbDel = (id, pid) => idb((s) => s.delete(pk(id, pid)));
// For the sync layer (sync/photos.js): the bytes of a photo of any search's visits, named by that search's findings key.
const pkFor = (k, id, pid) => `${k}|${id}|${pid}`;
export const syncPhotoPut = (k, id, pid, blob) => idb((s) => s.put({ k: pkFor(k, id, pid), blob, type: blob.type, at: nowZ() }));
export const syncPhotoHas = async (k, id, pid) => !!(await idb((s) => s.get(pkFor(k, id, pid))))?.blob;
export const syncPhotoGet = async (k, id, pid) => (await idb((s) => s.get(pkFor(k, id, pid))))?.blob || null;
export const syncPhotoDel = (k, id, pid) => idb((s) => s.delete(pkFor(k, id, pid)));

// ------------------------------------------------------------------ saving
async function push(id) {
  if (!mode.server) { setState({ phase: 'saved', where: 'device', error: '' }); return; }
  inflight.add(id);
  setState({ phase: 'saving', where: 'folder', error: '' });
  try {
    const f = recs[id];
    await api('POST', `/api/tours/${encodeURIComponent(id)}`, { findings: f });
    inflight.delete(id); markSent(id);
    if (!inflight.size && !timers.size) setState({ phase: 'saved', where: 'folder', error: '' });
  } catch (e) {
    inflight.delete(id);
    setState({ phase: 'error', where: 'device', error: String(e.message || e) });
  }
}
/** Change one visit: `fn(current)` returns the next record. Written to this browser at once and to the search folder after
 *  a short pause (typing does not send a request per key). */
export function update(id, fn) {
  const cur = recs[id] || {};
  const day = new Date(), p = (n) => String(n).padStart(2, '0');
  const fresh = cur.observed ? {} : { observed: `${day.getFullYear()}-${p(day.getMonth() + 1)}-${p(day.getDate())}`, visited_at: `${day.getFullYear()}-${p(day.getMonth() + 1)}-${p(day.getDate())}T${p(day.getHours())}:${p(day.getMinutes())}` };
  const next = normalize({ ...fresh, ...fn(cur), updated: nowZ(), v: VERSION });
  recs = { ...recs, [id]: next };
  if (apiExpected()) { unsent.add(id); store.set(unsentKey(), [...unsent]); }
  persist();
  notify(id);
  setState({ phase: 'saving', where: mode.server ? 'folder' : 'device', error: '' });
  clearTimeout(timers.get(id));
  timers.set(id, setTimeout(() => { timers.delete(id); push(id); }, mode.server ? 600 : 60));
  return next;
}
export function flush() {
  for (const [id, t] of [...timers]) { clearTimeout(t); timers.delete(id); push(id); }
}
/** Replace records wholesale (an import): newest wins per visit. */
export function importRecords(map) {
  let n = 0;
  for (const [id, raw] of Object.entries(map || {})) {
    if (typeof id !== 'string' || !id || id.length > 120 || !raw || typeof raw !== 'object') continue;
    const inc = normalize({ ...raw, photos: [] });   // photos never travel in a backup
    const merged = mergeRecord(recs[id], inc);
    if (merged && JSON.stringify(merged) !== JSON.stringify(recs[id])) { recs = { ...recs, [id]: merged }; n++; if (mode.server) push(id); }
  }
  if (n) { persist(); notify(null); }
  return n;
}
/** The sync layer wrote this search's visits to storage (sync/sync-store.js): read them again. Visits that changed go to the search folder too,
 *  and photos that were deleted on the other device are deleted here. Returns the ids that changed. */
export function reloadFromStorage() {
  if (!ready) return [];
  const local = store.get(key, {}) || {}, next = {};
  for (const [id, f] of Object.entries(local)) { const n = normalize(f); if (Object.keys(n).length > 1) next[id] = n; }
  const changed = [...new Set([...Object.keys(recs), ...Object.keys(next)])].filter((id) => JSON.stringify(recs[id]) !== JSON.stringify(next[id]));
  for (const id of changed) {
    for (const p of recs[id]?.photos || []) {
      if ((next[id]?.photos || []).some((x) => x.id === p.id)) continue;
      if (p.store === 'idb') idbDel(id, p.id);
      else if (p.store === 'disk' && mode.server) api('POST', `/api/tours/${encodeURIComponent(id)}/photos/delete`, { photo: p.id }).catch(() => {});
    }
  }
  recs = next;
  if (changed.length) { persist(); notify(null); if (mode.server) for (const id of changed) if (next[id]) push(id); }
  return changed;
}
/** The visits for a picks backup: everything except photos, which stay where they were taken. */
export function exportRecords() {
  return Object.fromEntries(Object.entries(recs).map(([id, f]) => { const { photos: _p, ...rest } = f; return [id, rest]; }));
}

// ------------------------------------------------------------------ photos
/** A photo shrunk to 1600 px and encoded as WebP (JPEG where the browser cannot write WebP), EXIF rotation applied and
 *  metadata dropped by the redraw. */
export async function prepare(file) {
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch {
    bmp = await new Promise((resolve, reject) => { const im = new Image(), u = URL.createObjectURL(file); im.onload = () => { URL.revokeObjectURL(u); resolve(im); }; im.onerror = () => { URL.revokeObjectURL(u); reject(new Error('not an image')); }; im.src = u; });
  }
  const w0 = bmp.width || bmp.naturalWidth, h0 = bmp.height || bmp.naturalHeight, k = Math.min(1, 1600 / Math.max(w0, h0)), w = Math.max(1, Math.round(w0 * k)), h = Math.max(1, Math.round(h0 * k));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  c.getContext('2d').drawImage(bmp, 0, 0, w, h); bmp.close?.();
  const enc = (type, q) => new Promise((resolve) => c.toBlob(resolve, type, q));
  let blob = await enc('image/webp', 0.82);
  if (!blob || blob.type !== 'image/webp') blob = await enc('image/jpeg', 0.85);
  if (!blob) throw new Error('the photo could not be encoded');
  return { blob, w, h };
}
const rid = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, '0')).join('');

/** Add a photo to a visit. With the API it goes to the search folder; if that fails (or there is no API) it stays in this
 *  browser. Returns the entry added to the record. */
export async function addPhoto(id, file) {
  const { blob, w, h } = await prepare(file);
  if (mode.server && mode.photos && blob.size <= mode.maxBytes) {
    try {
      const r = await api('POST', `/api/tours/${encodeURIComponent(id)}/photos`, undefined, blob);
      update(id, (cur) => ({ ...cur, photos: [...(cur.photos || []), r.photo] }));
      return r.photo;
    } catch (e) { setState({ phase: 'error', error: `The photo could not go to the search folder (${e.message}); it is kept in this browser.` }); }
  }
  const entry = { id: rid(), store: 'idb', w, h, bytes: blob.size, at: nowZ() };
  if (!(await idbPut(id, entry.id, blob))) throw new Error('This browser would not store the photo. Allow site data, or open the dashboard with `apartmentscout serve`.');
  update(id, (cur) => ({ ...cur, photos: [...(cur.photos || []), entry] }));
  return entry;
}
const urls = new Map();
/** A URL for showing one photo (a blob URL for a photo kept in the browser), or null when it cannot be found. */
export async function photoUrl(id, p) {
  if (p.store === 'disk') return `/tours/${encodeURIComponent(id)}/photos/${p.id}.webp`;
  const k = pk(id, p.id);
  if (urls.has(k)) return urls.get(k);
  const b = await idbGet(id, p.id);
  if (!b) return null;
  const u = URL.createObjectURL(b); urls.set(k, u);
  return u;
}
/** The bytes of a photo (for the share page's thumbnails), or null. */
export async function photoBlob(id, p) {
  if (p.store === 'idb') return idbGet(id, p.id);
  try { const r = await fetch(`/tours/${encodeURIComponent(id)}/photos/${p.id}.webp`, { cache: 'no-store' }); return r.ok ? await r.blob() : null; } catch { return null; }
}
export async function deletePhoto(id, p) {
  if (p.store === 'disk') {
    try { await api('POST', `/api/tours/${encodeURIComponent(id)}/photos/delete`, { photo: p.id }); } catch (e) { if (e.status !== 404) throw e; }
  } else { await idbDel(id, p.id); const u = urls.get(pk(id, p.id)); if (u) { URL.revokeObjectURL(u); urls.delete(pk(id, p.id)); } }
  update(id, (cur) => ({ ...cur, photos: (cur.photos || []).filter((x) => x.id !== p.id) }));
}
export const setCaption = (id, pid, caption) => update(id, (cur) => ({ ...cur, photos: (cur.photos || []).map((x) => (x.id === pid ? { ...x, caption } : x)) }));

/** Photos kept in the browser while the API was away go to the search folder once it is back. */
async function syncPhotos() {
  if (!mode.server || !mode.photos) return;
  for (const [id, f] of Object.entries(recs)) {
    for (const p of f.photos || []) {
      if (p.store !== 'idb') continue;
      const b = await idbGet(id, p.id);
      if (!b || b.size > mode.maxBytes) continue;
      try {
        const r = await api('POST', `/api/tours/${encodeURIComponent(id)}/photos`, undefined, b);
        await idbDel(id, p.id);
        update(id, (cur) => ({ ...cur, photos: (cur.photos || []).map((x) => (x.id === p.id ? { ...r.photo, ...(x.caption ? { caption: x.caption } : {}) } : x)) }));
      } catch { return; }
    }
  }
}

/** Photos that arrived in this browser (from another device, through sync) go to the search folder when there is one. */
export const movePhotosToFolder = () => syncPhotos();

// ------------------------------------------------------------------ start
/** Reach the local API (if there is one): merge its visits with this browser's and send whatever it lacks. */
async function connect(force = false) {
  const sess = await getSession(force).catch(() => null);
  if (!sess?.tours?.save) return false;
  mode = { server: true, photos: !!sess.tours.photos, maxBytes: sess.tours.max_photo_bytes || mode.maxBytes };
  try {
    const { tours } = await api('GET', '/api/tours');
    for (const [id, f] of Object.entries(tours || {})) {
      const remote = normalize(f), mine = recs[id], merged = mergeRecord(mine, remote);
      recs[id] = merged;
      if (mine && (mine.updated || '') > (remote.updated || '')) push(id);
    }
    for (const [id, f] of Object.entries(recs)) if (!tours?.[id] && Object.keys(f).length > 1) push(id);
    for (const id of [...unsent]) if (recs[id] && !inflight.has(id)) push(id);
  } catch (e) { setState({ phase: 'error', error: String(e.message || e) }); return false; }
  return true;
}
/** Try again to reach the API and send what is waiting (a phone that was offline, or a server that was restarted). Resolves with
 *  how many visits are still waiting. Quiet when this page has no API at all. */
export async function resync() {
  if (!ready || !apiExpected()) return unsent.size;
  if (mode.server) { for (const id of [...unsent]) if (recs[id] && !inflight.has(id)) await push(id); }
  else if (await connect(true)) { persist(); notify(null); setTimeout(syncPhotos, 300); await new Promise((r) => setTimeout(r, 800)); }
  return unsent.size;
}

/** Load this search's visits: from the browser, then merged with the search folder's when the API is there. */
export async function init() {
  key = searchKey();
  const local = store.get(key, {}) || {};
  recs = {};
  for (const [id, f] of Object.entries(local)) { const n = normalize(f); if (Object.keys(n).length > 1) recs[id] = n; }
  unsent.clear();
  for (const id of store.get(unsentKey(), []) || []) if (typeof id === 'string' && recs[id]) unsent.add(id);
  await connect();
  persist();
  ready = true;
  notify(null);
  if (mode.server) setTimeout(syncPhotos, 1500);
  addEventListener('pagehide', flush);
}
