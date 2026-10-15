// Tour day, the way in: a "Tour day" button on the main screen while there are tours booked for today (read from the same Tour
// field the Tours board sets), `?tourday=1` for a home-screen shortcut, and openTourDay() for the command palette. The mode itself
// (tourday.js) loads only when it is opened; once there are tours today it is fetched ahead in idle time, so an installed copy has
// it cached before the renter is standing in the street with no signal.
import { S, on, byId } from '../app.js';
import { esc } from '../util.js';
import { toursOn, tourWhen, localDay, clock12 } from './tourday-model.js';

const ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M8 14.2S3 9.6 3 6.3a5 5 0 0110 0c0 3.3-5 7.9-5 7.9z"/><circle cx="8" cy="6.3" r="1.7"/></svg>';
let fab = null, warmed = false, midnight = null;

/** Open the mode (from the palette, the button or the URL). */
export async function openTourDay(opts) {
  const m = await import('./tourday.js');
  await ready();
  m.open(opts);
}
/** Wait until the tour findings have loaded (the checklist reads and writes them). */
async function ready() {
  const FS = await import('./findings-store.js');
  for (let i = 0; i < 100 && !FS.isReady(); i++) await new Promise((r) => setTimeout(r, 50));
}
const today = () => toursOn(S.picks, localDay(), byId);

function sync() {
  const ids = today();
  if (!ids.length) { fab?.remove(); fab = null; return; }
  const next = ids.map((id) => tourWhen(S.picks[id].tour)?.min).filter((m) => m != null).sort((a, b) => a - b)[0];
  if (!fab) {
    fab = document.createElement('button');
    fab.type = 'button'; fab.id = 'tourDayBtn'; fab.className = 'tday-fab';
    fab.addEventListener('click', () => openTourDay());
    document.body.append(fab);
  }
  fab.setAttribute('aria-label', `Tour day: ${ids.length} tour${ids.length === 1 ? '' : 's'} today${next != null ? `, first at ${clock12(next)}` : ''}`);
  fab.innerHTML = `<i>${ICON}</i><span><b>Tour day</b><small>${ids.length} today${next != null ? ` · ${esc(clock12(next))}` : ''}</small></span>`;
  if (!warmed) { warmed = true; (window.requestIdleCallback || ((f) => setTimeout(f, 2500)))(() => { import('./tourday.js').catch(() => {}); }); }
}
function schedule() {
  clearTimeout(midnight);
  const n = new Date(), t = new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1, 0, 0, 5) - n;
  midnight = setTimeout(() => { sync(); schedule(); }, Math.min(t, 2 ** 30));
}

export function init() {
  on('saved', sync); on('kpis', sync);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') sync(); });
  document.addEventListener('tourday:closed', sync);
  schedule();
  sync();
  if (new URLSearchParams(location.search).get('tourday') === '1') openTourDay();
}
/** For tests and the console. */
export const state = () => ({ today: today(), button: !!fab });
