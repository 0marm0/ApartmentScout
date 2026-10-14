// Rank-change badges: a small ▲3 or ▼2 beside a card's "#rank" (and in the Shortlist table's rank column) for the
// homes whose rank moved while the renter adjusted weights or criteria. The badge fades in, stays while they keep
// adjusting, and fades out after a few quiet seconds. The numbers come from rank-model.js; the card moves
// themselves are card-list.js. Nothing here draws unless a rank actually changed.
import { S, on } from '../app.js';
import { snapshotRanks, deltaText, deltaSpeech, createTracker } from './rank-model.js';

const IDLE_MS = 4000;
const tracker = createTracker({ idleMs: IDLE_MS });
let timer = 0;

/** The badge for a listing id, or '' when its rank did not move. For cardHTML and the Shortlist rank cell. */
export function deltaHTML(id) {
  const d = tracker.delta(id); if (!d) return '';
  return `<span class="rk-d ${d > 0 ? 'up' : 'down'}" role="img" aria-label="${deltaSpeech(d)}" title="${deltaSpeech(d)}">${deltaText(d)}</span>`;
}

function fadeOut() {
  timer = 0;
  tracker.settle();
  const els = document.querySelectorAll('.rk-d');
  els.forEach((el) => el.classList.add('out'));
  setTimeout(() => { if (!tracker.active()) document.querySelectorAll('.rk-d.out').forEach((el) => el.remove()); }, 260);
}

function onRanks() {
  const ranks = snapshotRanks(S.listings), had = tracker.active();
  tracker.observe(ranks, performance.now());
  if (tracker.active()) { clearTimeout(timer); timer = setTimeout(fadeOut, IDLE_MS); }
  else if (had) fadeOut();
}

export function initRankDeltas() {
  tracker.commit(snapshotRanks(S.listings));
  on('weights', onRanks);
}
