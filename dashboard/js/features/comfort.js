// Comfort and personalisation, browser side: reads the stored choices, sets the data attributes on <html> that
// css/comfort.css and css/accents.css key on, and keeps them in step with the OS. It imports nothing from the app
// (app.js loads it first so the attributes are there before the first paint); the settings menu that edits the
// choices lives in settings-menu.js.
import { normalizePrefs, resolveComfort, htmlAttrs, comfortQuery } from './comfort-core.js';

const KEY = 'as:comfort';
const real = window.matchMedia.bind(window);
const MEDIA = { motion: '(prefers-reduced-motion: reduce)', transparency: '(prefers-reduced-transparency: reduce)', contrast: '(prefers-contrast: more)' };
const mqs = Object.fromEntries(Object.entries(MEDIA).map(([k, q]) => [k, real(q)]));
const listeners = new Set();

let prefs = (() => { try { return normalizePrefs(JSON.parse(localStorage.getItem(KEY))); } catch { return normalizePrefs(null); } })();

export const osFlags = () => ({ motion: mqs.motion.matches, transparency: mqs.transparency.matches, contrast: mqs.contrast.matches });
export const getPrefs = () => ({ ...prefs });
export const effective = () => resolveComfort(prefs, osFlags());

function apply() {
  const root = document.documentElement;
  for (const [k, v] of Object.entries(htmlAttrs(prefs, osFlags()))) root.setAttribute(k, v);
  root.toggleAttribute('data-golden', prefs.golden);
  for (const fn of listeners) fn(effective());
}
/** Change one choice ({ motion: true }, { text: 'l' }, { accent: 'jade' } ...); it is kept in this browser. */
export function setPrefs(patch) {
  prefs = normalizePrefs({ ...prefs, ...patch });
  try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* storage unavailable: the choice lasts for this visit */ }
  apply();
}
/** Run `fn(effective)` whenever a choice or the OS setting changes. */
export function onComfort(fn) { listeners.add(fn); return () => listeners.delete(fn); }

// Code that asks matchMedia('(prefers-reduced-motion: reduce)') (the map's easing, the drawer, the palette) sees
// the effective value, so the renter's own switch also stops those JavaScript animations.
window.matchMedia = (q) => {
  const mql = real(q), k = comfortQuery(q);
  if (!k) return mql;
  return new Proxy(mql, {
    get(t, p) {
      if (p === 'matches') return effective()[k];
      const v = t[p];
      return typeof v === 'function' ? v.bind(t) : v;
    },
  });
};

for (const mq of Object.values(mqs)) mq.addEventListener?.('change', apply);
apply();
