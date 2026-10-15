// Which camera Unit 3D opens in. A home with an interior model (a floor plan) opens INSIDE, standing at the main seat and looking
// out of the windows: seeing the unit from the inside is what the renter came for. Everything else keeps its say, in this order:
//   1. a page address that names the camera (?mode=orbit|window|inside|plan|top),
//   2. "See inside" (a button in the drawer, on a card, in the command palette): always inside, once,
//   3. the camera the renter chose last (orbit, window or inside; remembered in this browser),
//   4. inside when the home has a plan, else the outside orbit.
// Pure functions plus two tiny session-storage helpers wrapped in try/catch (storage can be blocked). No DOM, no three.js.

/** The five cameras (keys as Unit 3D keeps them in its state). */
export const CAMERAS = ['orbit', 'win', 'in', 'plan', 'top'];
/** The ones worth remembering: the street plan and the top-down view are tools, not a way of looking at the home. */
export const SAVED_CAMERAS = ['orbit', 'win', 'in'];
/** The local-storage key (the app's store adds its `as:` prefix). */
export const CAMERA_KEY = 'unit-cam';

/** A `mode` query value as a camera key, or null (absent or unknown). */
export function askedCamera(value) {
  const m = String(value ?? '').toLowerCase();
  if (m === 'window' || m === 'win') return 'win';
  if (m === 'inside' || m === 'in') return 'in';
  return ['plan', 'top', 'orbit'].includes(m) ? m : null;
}
/** The query value for a camera key (the inverse of askedCamera). */
export const cameraParam = (mode) => (mode === 'win' ? 'window' : mode === 'in' ? 'inside' : mode);

/**
 * The camera to open in.
 * @param {{asked?: string|null, intent?: boolean, saved?: string|null, hasPlan: boolean}} o
 *   asked: camera named by the page address; intent: "See inside" was pressed for this home; saved: the camera chosen last.
 */
export function openingCamera({ asked = null, intent = false, saved = null, hasPlan }) {
  if (asked) return asked;
  if (intent && hasPlan) return 'in';
  if (saved === 'in') return hasPlan ? 'in' : 'orbit';   // the inside of a home with no plan is a generic room: not worth landing in
  if (saved === 'orbit' || saved === 'win') return saved;
  return hasPlan ? 'in' : 'orbit';
}

/** The viewpoint to stand at when Inside opens with no window named: the main seat looking out of the window ("Sofa, window"; with
 *  no TV in line the plain Sofa already looks out), else the living room, else the first room. */
export function mainViewpoint(views) {
  const list = Array.isArray(views) ? views : [];
  return list.find((v) => v.kind === 'seat' && v.seat === 'sofa' && /-window$/.test(v.key || ''))
    || list.find((v) => v.kind === 'seat' && v.seat === 'sofa')
    || list.find((v) => v.kind === 'room' && /living/i.test(v.room || v.label || ''))
    || list.find((v) => v.kind === 'room') || list[0] || null;
}

const KEY = 'as:see-inside';
const TTL = 30000;
/** "See inside" for `id` was pressed: Unit 3D reads it once, within 30 s of the press. */
export function markSeeInside(id, now = Date.now()) {
  try { sessionStorage.setItem(KEY, JSON.stringify({ id, t: now })); } catch { /* storage blocked: the home opens in its default camera, which is inside when it has a plan */ }
}
/** True once when "See inside" was pressed for `id` (the mark is cleared either way). */
export function takeSeeInside(id, now = Date.now()) {
  try {
    const h = JSON.parse(sessionStorage.getItem(KEY) || 'null'); sessionStorage.removeItem(KEY);
    return !!h && h.id === id && now - h.t < TTL;
  } catch { return false; }
}

/** Open Unit 3D inside `id`: mark the intent, then go there (a hashchange is sent by hand when the page address is already that home's). */
export function goSeeInside(id) {
  markSeeInside(id);
  const h = '#unit/' + encodeURIComponent(id);
  if (location.hash === h) dispatchEvent(new HashChangeEvent('hashchange')); else location.hash = h;
}

/** The shared "this home has an interior model" test: a site model (Unit 3D) and a floor plan, both in the manifest. */
export const hasInterior = (manifest, id) => !!manifest && (manifest.sites || []).includes(id) && (manifest.plans || []).includes(id);

/** The See inside button's markup: an anchor to Unit 3D whose click marks the intent (see wireSeeInside). */
export function seeInsideLink(id, { cls = 'btn primary', icon = '', label = 'See inside', title = 'Stand inside the apartment, on the sofa, and look out of the windows' } = {}) {
  const e = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  return `<a class="${e(cls)}" href="#unit/${encodeURIComponent(id)}" data-see-inside="${e(id)}" title="${e(title)}">${icon}${e(label)}</a>`;
}
/** One delegated listener: pressing any [data-see-inside] link marks the intent before the hash changes. */
export function wireSeeInside(root = document) {
  root.addEventListener('click', (e) => {
    const a = e.target.closest?.('[data-see-inside]');
    if (a) markSeeInside(a.dataset.seeInside);
  }, true);
}
