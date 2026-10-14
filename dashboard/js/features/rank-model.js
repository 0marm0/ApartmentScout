// Rank-change bookkeeping: how far each listing moved in the ranking since the renter started adjusting weights.
// Pure (no DOM, no imports). rank-ui.js owns the timers and the badges.
//
// Ranks are the numbers on the cards ("#3"): 1 is best, so a smaller number is a move up. A delta is positive for
// a move up (shown ▲3) and negative for a move down (▼2). Only listings ranked both before and after have a delta;
// unranked (not eligible) listings never get one, and a listing that did not move gets none.

/** id -> rank for every listing that has one. */
export function snapshotRanks(listings, rankOf = (L) => L._rank) {
  const m = new Map();
  for (const L of listings) { const r = rankOf(L); if (Number.isFinite(r) && r > 0) m.set(L.id, r); }
  return m;
}

/** id -> delta (baseline rank minus current rank) for the listings whose rank changed. */
export function rankDeltas(baseline, current) {
  const out = new Map();
  for (const [id, now] of current) {
    const was = baseline.get(id);
    if (was != null && was !== now) out.set(id, was - now);
  }
  return out;
}

/** "▲3" / "▼2", or '' when there is no movement. */
export function deltaText(d) {
  if (!d) return '';
  return `${d > 0 ? '▲' : '▼'}${Math.abs(d)}`;
}

/** Spoken form for the aria-label and tooltip. */
export function deltaSpeech(d) {
  if (!d) return '';
  const n = Math.abs(d);
  return `${d > 0 ? 'Moved up' : 'Moved down'} ${n} place${n === 1 ? '' : 's'}`;
}

/**
 * A gesture groups quick successive changes (a slider drag, several clicks): deltas are measured against the
 * ranking at the start of the gesture and clear after `idleMs` without a change. The clock is injected so tests
 * need no timers: `now` is a time in ms.
 */
export function createTracker({ idleMs = 4000 } = {}) {
  let committed = new Map(), baseline = null, deltas = new Map(), last = 0, cur = null;
  return {
    /** The settled ranking to compare against when a gesture starts (call once after the first ranking). */
    commit(ranks) { committed = new Map(ranks); baseline = null; deltas = new Map(); },
    /** A ranking change: returns the deltas against the gesture's starting ranking. */
    observe(ranks, now) {
      cur = ranks;
      const d = rankDeltas(baseline ?? committed, ranks);
      if (baseline == null && !d.size) return deltas;   // nothing moved: no gesture starts
      if (baseline == null) baseline = committed;
      deltas = d; last = now;
      return deltas;
    },
    /** True once the gesture has been quiet for idleMs and has something to clear. */
    expired(now) { return baseline != null && now - last >= idleMs; },
    /** End the gesture: the current ranking becomes the settled one. Returns the cleared deltas. */
    settle() {
      const old = deltas;
      if (cur) committed = new Map(cur);
      baseline = null; deltas = new Map();
      return old;
    },
    deltas: () => deltas,
    delta: (id) => deltas.get(id) || 0,
    active: () => baseline != null,
  };
}
