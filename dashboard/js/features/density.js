// Global density setting: Comfortable or Compact for the result cards, the filter rail and the tables.
// It is one attribute on <html> (data-density) that css/results-rail.css reads, remembered in this browser. The
// choice lives in the settings menu (#setMenu); the Shortlist's own density buttons follow it and set it.
//
// This module is imported before app.js has finished evaluating, so nothing here touches app.js at load time.
import { store, emit, on } from '../app.js';

const KEY = 'as:density';
const clean = (d) => (d === 'compact' ? 'compact' : 'comfortable');
function readSaved() {
  try { return clean(JSON.parse(localStorage.getItem(KEY))); } catch { return 'comfortable'; }   // storage can be blocked
}

let current = readSaved();

function apply(d) {
  document.documentElement.dataset.density = d;
  document.querySelectorAll('button[data-density]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.density === d)));
}
apply(current);   // before the first paint: no flash of the other density

/** 'comfortable' or 'compact'. */
export const getDensity = () => current;

/** Change the density (remembered per browser) and tell the views that size themselves. */
export function setDensity(d, { remember = true } = {}) {
  d = clean(d);
  const changed = d !== current;
  current = d;
  apply(d);
  if (remember) store.set('density', d);
  if (changed) emit('density', d);
}

/** Run fn(density) whenever the density changes. */
export const onDensity = (fn) => on('density', fn);

/** ?density=compact wins over the remembered choice for this page load, like ?theme does. */
export function initDensity() {
  const q = new URLSearchParams(location.search).get('density');
  if (q === 'compact' || q === 'comfortable') { current = q; apply(q); }
  else apply(current);
}
