// Tour photos in sync. The photo ENTRIES (id, size, caption, when) are ordinary items and always travel. The BYTES are optional: a small JPEG copy
// (at most LIMITS.photoPx on the long side and LIMITS.photoBytes, as a data URL) rides along as a `blob/...` item, up to a total budget, so the other
// device can show the photo. The full-size original stays where it was taken (this browser, or the search folder). A photo that is deleted takes its
// copy with it. Nothing here runs unless "Include small copies of tour photos" is on.
import * as M from './sync-model.js';
import * as FS from '../features/findings-store.js';

const failed = new Set();   // photos that could not be made small enough: not tried again until the page is reloaded

/** A JPEG data URL of `blob` within the size limit, or null (the picture cannot be decoded, or will not get small enough). */
export async function jpegDataUrl(blob, { px = M.LIMITS.photoPx, max = M.LIMITS.photoBytes } = {}) {
  let bmp;
  try { bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' }); } catch { return null; }
  try {
    for (const [scale, q] of [[1, 0.72], [1, 0.55], [0.75, 0.6], [0.55, 0.55], [0.4, 0.5]]) {
      const k = Math.min(1, (px * scale) / Math.max(bmp.width, bmp.height));
      const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.drawImage(bmp, 0, 0, w, h);
      const uri = c.toDataURL('image/jpeg', q);
      if (uri.startsWith('data:image/jpeg') && uri.length <= max) return uri;
    }
    return null;
  } finally { bmp.close?.(); }
}
export function dataUrlToBlob(uri) {
  const m = /^data:([\w/+.-]+);base64,(.*)$/s.exec(uri || '');
  if (!m) return null;
  try {
    const bin = atob(m[2]), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: m[1] });
  } catch { return null; }
}

/** Where this device keeps a photo ('disk': the search folder, 'idb': this browser), or null when the photo is not in this device's visits. */
function storeOf(findingsKey, home, pid) {
  try {
    const rec = JSON.parse(localStorage.getItem('as:' + findingsKey) || 'null')?.[home];
    return (rec?.photos || []).find((p) => p.id === pid)?.store || null;
  } catch { return null; }
}

/**
 * Bring photo bytes and the merged items in line. `merged` is changed: copies are added for photos that have none, and the copy of a deleted photo is
 * deleted. Photos that arrived with a copy and are missing here are stored in this browser.
 * @returns {Promise<{ added: number, removed: number, stored: number, over: number, bytes: number }>}
 */
export async function reconcilePhotos(merged, { embed, device, clock }) {
  const out = { added: 0, removed: 0, stored: 0, over: 0, bytes: 0 };
  const entries = new Map(), blobs = new Map();
  for (const [key, w] of Object.entries(merged)) {
    if (w.x) continue;
    if (M.isBlobKey(key)) { blobs.set(key, w); continue; }
    const { storageKey, path } = M.parseKey(key);
    if (/^findings:/.test(storageKey) && path.length === 3 && path[1] === 'photos') entries.set(key, w);
  }
  // 1. a copy whose photo is gone is deleted
  for (const [bk, w] of blobs) {
    if (entries.has(M.photoKeyForBlob(bk))) continue;
    merged[bk] = { t: clock.tick(), d: device, x: 1 }; blobs.delete(bk); out.removed++;
  }
  // 2. a copy that arrived for a photo this device does not hold goes into this browser's photo store
  for (const [bk, w] of blobs) {
    const { findingsKey, home, pid } = M.parseBlobKey(bk), where = storeOf(findingsKey, home, pid);
    if (where === 'disk' || where === null) continue;   // the original is in the search folder, or the visit is not on this device (yet)
    if (await FS.syncPhotoHas(findingsKey, home, pid)) continue;
    const blob = dataUrlToBlob(w.v);
    if (blob && await FS.syncPhotoPut(findingsKey, home, pid, blob)) out.stored++;
  }
  if (out.stored) FS.movePhotosToFolder().catch(() => { /* the search folder is not reachable: they stay in this browser */ });
  // 3. a photo without a copy gets one, newest first, while the budget lasts
  let bytes = 0;
  for (const w of blobs.values()) bytes += String(w.v).length;
  out.bytes = bytes;
  if (!embed) return out;
  const want = [...entries.entries()].filter(([k]) => !blobs.has(M.blobKeyForPhoto(k)) && !failed.has(k))
    .sort((a, b) => String(b[1].v?.at || '').localeCompare(String(a[1].v?.at || '')));
  for (const [pk, w] of want) {
    if (blobs.size + out.added >= M.LIMITS.photosMax || bytes >= M.LIMITS.photosTotal) { out.over++; continue; }
    const { storageKey: findingsKey, path } = M.parseKey(pk), home = path[0], pid = path[2], where = storeOf(findingsKey, home, pid);
    if (!where) continue;
    let src = null;
    if (where === 'idb') src = await FS.syncPhotoGet(findingsKey, home, pid);
    else if (where === 'disk' && findingsKey === FS.searchKey()) src = await FS.photoBlob(home, { id: pid, store: 'disk' });
    if (!src) continue;
    const uri = await jpegDataUrl(src);
    if (!uri) { failed.add(pk); out.over++; continue; }
    if (bytes + uri.length > M.LIMITS.photosTotal) { out.over++; continue; }
    merged[M.blobKeyForPhoto(pk)] = { t: clock.tick(), d: device, v: uri };
    bytes += uri.length; out.added++; void w;
  }
  out.bytes = bytes;
  return out;
}

/** Take every copy out of a merged map (the person turned photo copies off and asked for them to be removed). */
export function dropAllCopies(merged, { device, clock }) {
  let n = 0;
  for (const [k, w] of Object.entries(merged)) if (M.isBlobKey(k) && !w.x) { merged[k] = { t: clock.tick(), d: device, x: 1 }; n++; }
  return n;
}
