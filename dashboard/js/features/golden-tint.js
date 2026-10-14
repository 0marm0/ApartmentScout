// Golden-hour map tint: a warm wash over the map stage whose strength and side follow the sun's real position at the
// map's centre (golden.js). Off unless the renter turns it on in the settings menu. A 5-minute tick keeps it current.
// `?goldenAt=2026-06-21T23:50:00Z` shows the map as it looks at that instant (for screenshots and tests).
import { S } from '../app.js';
import { goldenTint } from './golden.js';
import { effective, onComfort } from './comfort.js';

let el = null, last = null;

function centre() {
  const c = S.crit.search?.map_center, d = S.crit.commute?.destinations?.[0];
  if (Array.isArray(c) && c.length >= 2) return [+c[0], +c[1]];
  if (d?.lat != null) return [d.lat, d.lon];
  return [40.75, -73.98];
}
function now() {
  const q = new URLSearchParams(location.search).get('goldenAt'), t = q ? Date.parse(q) : NaN;
  return Number.isFinite(t) ? t : Date.now();
}

/** The tint right now (for the menu's status line) regardless of whether it is switched on. */
export function currentTint() { const [lat, lon] = centre(); return goldenTint(now(), lat, lon); }

function update() {
  if (!el) return;
  const on = effective().golden, t = currentTint();
  last = t;
  el.hidden = false;
  el.style.setProperty('--gh', on ? String(t.strength) : '0');
  el.style.setProperty('--gx', t.gx + '%');
  el.style.setProperty('--gy', t.gy + '%');
  el.dataset.phase = on ? t.phase : 'off';
  document.documentElement.style.setProperty('--golden', on ? String(t.strength) : '0');
  const sub = document.getElementById('mnGoldenSub');
  const deg = Math.round(Math.abs(t.alt));
  if (sub) sub.textContent = t.phase === 'day' ? 'The sun is high now, so no tint yet' : t.phase === 'night' ? 'Night now: the tint returns near sunrise' : `${Math.round(t.intensity * 100)}% now, sun ${deg}\u00b0 ${t.alt < 0 ? 'below' : 'above'} the horizon`;
}

export function initGolden() {
  const stage = document.getElementById('view-map');
  if (!stage || el) return;
  el = document.createElement('div');
  el.className = 'golden-tint'; el.id = 'goldenTint'; el.setAttribute('aria-hidden', 'true');
  stage.append(el);
  onComfort(update);
  update();
  setInterval(update, 5 * 60 * 1000);
  // read-only hook for headless checks (Playwright): never used by the page itself
  window.__golden = { get tint() { return last; }, update };
}
