// Price history on the result cards and in the map's hover card: a tiny step-line sparkline, and a "↓ $150" chip
// when the latest recorded change was a drop. It draws only what was recorded (see price-model.js): no history, a
// single price, or an unchanged price shows nothing at all, and nothing is ever extrapolated.
//
// The recorded prices come from the listing's own `price_history` (available at once) and from history.json's
// `price_history` (loaded after the first paint; `apartmentscout build` writes it). Loading it re-renders the
// list once so cards pick the trend up.
import { S, emit, loadJSON } from '../app.js';
import { esc } from '../util.js';
import { priceSeries, priceStory, dropChip, sparkPath } from './price-model.js';

let HIST = null;
const memo = new Map();   // listing id -> series | null
const day = (t) => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const toneOf = (s) => (s.drop > 0 ? 'down' : s.rose > 0 ? 'up' : '');

/** The series for a listing, or null. Memoised per listing until the history changes. */
export function trendOf(L) {
  if (!L) return null;
  let s = memo.get(L.id);
  if (s === undefined) { s = priceSeries(L, HIST?.[L.id]); memo.set(L.id, s); }
  return s;
}

/** Sparkline and drop chip for a result card's second line; '' when there is nothing recorded. */
export function trendHTML(L) {
  const s = trendOf(L); if (!s) return '';
  const p = sparkPath(s, 44, 16, 2), chip = dropChip(s), story = priceStory(s);
  return `<span class="ph ${toneOf(s)}" role="img" aria-label="${esc(story)}" title="${esc(story)}"><svg class="ph-s" width="44" height="16" viewBox="0 0 44 16" aria-hidden="true"><path d="${p.d}"/><circle cx="${p.x}" cy="${p.y}" r="2"/></svg>${chip ? `<b class="ph-d">${esc(chip)}</b>` : ''}</span>`;
}

/** A larger sparkline with the story, for the map's hover card. */
export function hoverTrendHTML(L) {
  const s = trendOf(L); if (!s) return '';
  const p = sparkPath(s, 96, 24, 3), chip = dropChip(s);
  const moved = s.drop > 0 || s.rose > 0 ? `changed ${day(s.pts[s.pts.length - 1].t)}` : '';
  const span = s.pts.length > 2 ? `${s.pts.length} prices since ${day(s.pts[0].t)}` : `since ${day(s.pts[0].t)}`;
  return `<div class="ph-hover ${toneOf(s)}" title="${esc(priceStory(s))}"><svg class="ph-s" width="96" height="24" viewBox="0 0 96 24" aria-hidden="true"><path d="${p.d}"/><circle cx="${p.x}" cy="${p.y}" r="2.4"/></svg><span>${chip ? `<b class="ph-d">${esc(chip)}</b> ` : ''}<span class="faint">${esc([moved, span].filter(Boolean).join(' · '))}</span></span></div>`;
}

/** Load history.json's price history (only when the build wrote it) and re-render the list once. */
export async function initPriceHistory() {
  const listed = (S.manifest.extra || []).map(String), emb = window.__AS_DATA__, path = `${S.base}/history.json`;
  const has = listed.some((x) => x === 'history.json' || x.endsWith('/history.json')) || (emb && path in emb);
  if (!has) return;
  const h = await loadJSON(path, null);
  const ph = h && typeof h === 'object' ? h.price_history : null;
  if (!ph || typeof ph !== 'object' || !Object.keys(ph).length) return;
  HIST = ph; memo.clear();
  emit('filters', { quiet: true });
}
