// Blur-up previews: a tiny WebP per leading photo from data/lqip.json (written by `apartmentscout build`), painted
// blurred the moment a card or the drawer renders and cross-faded to the full image by the page's image fade
// (css/enhance.css: an image is invisible until it has loaded, then fades in over what is behind it).
//
// The sidecar is fetched after the first paint, so the main data file stays small. Previews are looked up by the
// photo's saved path or original link (the item's `keys`). Every function is a no-op without a sidecar.
const PREFIX = 'data:image/webp;base64,';
let table = null, started = false;
const subs = new Set();

/** Fetch the sidecar once, in parallel with the main data (it is a separate, small file: the cards must not wait for
 *  it, but it should land before their photos do). `load(path, fallback)` is the app's JSON loader. */
export function loadPreviews(load, base) {
  if (started) return;
  started = true;
  load(`${base}/lqip.json`, null).then((side) => {
    table = side && typeof side.items === 'object' && side.items ? side.items : {};
    subs.forEach((fn) => fn());
  });
}
/** Run `fn` once the sidecar has arrived (immediately when it already has). */
export function whenPreviewsReady(fn) {
  if (table) fn(); else subs.add(fn);
}
export const previewsReady = () => !!table;

/** { src, w, h } for the first key with a preview, else null. `w`/`h` are the source photo's pixel size. */
export function previewFor(keys) {
  if (!table) return null;
  for (const k of keys || []) {
    const r = table[k];
    if (r && r[2]) return { src: PREFIX + r[2], w: r[0], h: r[1] };
  }
  return null;
}
/** Width / height of the source photo from the sidecar, or null (layout hint for galleries). */
export const aspectFor = (keys) => { const p = previewFor(keys); return p && p.w && p.h ? p.w / p.h : null; };

const keysOf = (img) => (img.dataset.lq || '').split('|').filter(Boolean);
const loaded = (img) => img.classList.contains('ld') || (img.complete && img.naturalWidth > 0);

/** Put a blurred preview behind one `<img data-lq="key|key">`: in `host` (default: the image's parent) as an
 *  absolutely positioned `.lq` layer, removed once the full image has faded in. `at` places it in a scrolling
 *  carousel track (the slide's index). Returns true when a preview was painted. */
export function armImage(img, host = img.parentElement, at = null) {
  if (!img || img.dataset.lqDone || !host || loaded(img)) return false;
  const p = previewFor(keysOf(img));
  if (!p) return false;
  img.dataset.lqDone = '1';
  const lq = document.createElement('i');
  lq.className = 'lq';
  lq.setAttribute('aria-hidden', 'true');
  if (at != null) { lq.style.left = `${at * 100}%`; lq.classList.add('slide'); }
  const b = document.createElement('b');
  b.style.backgroundImage = `url(${p.src})`;
  lq.append(b);
  host.append(lq);
  const drop = () => setTimeout(() => lq.remove(), 700);
  img.addEventListener('load', drop, { once: true });
  img.addEventListener('error', drop, { once: true });
  return true;
}

/** Arm every `img[data-lq]` under `root` that sits directly in a card photo well (`.media`). */
export function armCards(root = document) {
  root.querySelectorAll('.media > img[data-lq]').forEach((img) => armImage(img));
}
/** Arm the drawer's carousel: slide i gets the preview of its own photo, in place. */
export function armTrack(track) {
  if (!track) return;
  [...track.querySelectorAll(':scope > img')].forEach((img, i) => { if (img.dataset.lq) armImage(img, track, i); });
}
