// The dashboard side of place filters: loads data/places.json once (a search without one simply has no place filters),
// indexes it for places-geo.js and tells the search box when it arrives. All geometry lives in places-geo.js and the
// phrases in places-parse.js; nlsearch.js reads the index through getGeo().
import { S, emit, loadJSON } from '../app.js';
import { indexPlaces } from './places-geo.js';

let geo = null, state = 'idle';   // idle | loading | ready

/** The indexed places.json, or null when the search has none (or it has not loaded yet). */
export const getGeo = () => geo;
export const placesState = () => state;

/** Load places.json once. The palette redraws on arrival so a query typed meanwhile gets its place filters. */
export async function ensureGeo() {
  if (state !== 'idle') return geo;
  state = 'loading';
  try { geo = indexPlaces(await loadJSON(`${S.base}/places.json`, null)); } catch { geo = null; }
  state = 'ready';
  document.getElementById('plQ')?.dispatchEvent(new Event('input'));
  if (geo && Object.keys(S.filters.nl || {}).some((k) => k.startsWith('w:'))) emit('filters', { quiet: true });   // place filters saved in an earlier visit can bite now
  return geo;
}
