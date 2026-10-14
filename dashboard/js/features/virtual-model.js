// Geometry for the windowed results list: where every item sits, which ones to render for a scroll position, and
// the FLIP plan when the order changes. Pure functions on numbers (no DOM, no imports), tested in node.
//
// Every item has a slot of (height + gap) pixels. Heights are measured when an item is rendered and remembered by
// key; items never rendered use an estimate (the median of what was measured, or a default), so the scrollbar is
// right from the first frame in a list of identical cards and settles quickly in a list of mixed ones.

export class Layout {
  constructor({ gap = 2, estimate = 133 } = {}) {
    this.gap = gap; this.fallback = estimate; this.heights = new Map(); this.keys = []; this.prefix = new Float64Array(1); this._est = null; this._sorted = null;
  }
  /** Replace the item order. Cached heights stay (keyed), so a re-sort costs nothing to lay out again. */
  setKeys(keys) { this.keys = keys; this._rebuild(); }
  /** Record a measured height (without the gap). Returns true when it changed the layout. */
  measure(key, h) {
    if (!(h > 0)) return false;
    const old = this.heights.get(key);
    if (old != null && Math.abs(old - h) < 0.5) return false;
    this.heights.set(key, h); this._est = null;
    return true;
  }
  /** Forget every measurement (density, width or font change). */
  clear() { this.heights.clear(); this._est = null; this._rebuild(); }
  /** The height assumed for an item that was never rendered. */
  estimate() {
    if (this._est != null) return this._est;
    if (!this.heights.size) return (this._est = this.fallback);
    const v = [...this.heights.values()].sort((a, b) => a - b);
    return (this._est = v[v.length >> 1]);
  }
  slot(i) { return (this.heights.get(this.keys[i]) ?? this.estimate()) + this.gap; }
  _rebuild() {
    const n = this.keys.length, p = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) p[i + 1] = p[i] + this.slot(i);
    this.prefix = p;
  }
  /** Recompute offsets after measurements changed. */
  relayout() { this._rebuild(); }
  get count() { return this.keys.length; }
  get total() { return this.prefix[this.keys.length]; }
  offset(i) { return this.prefix[Math.max(0, Math.min(this.keys.length, i))]; }
  /** Index of the item whose slot contains y. */
  indexAt(y) {
    const p = this.prefix, n = this.keys.length;
    if (n === 0 || y <= 0) return 0;
    if (y >= p[n]) return n - 1;
    let lo = 0, hi = n - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (p[mid] <= y) lo = mid; else hi = mid - 1; }
    return lo;
  }
  /** The half-open index range to render for a viewport: what is visible plus `buffer` pixels either side. */
  range(top, height, buffer) {
    const n = this.keys.length;
    if (!n) return [0, 0];
    const a = this.indexAt(top - buffer);
    let b = this.indexAt(top + height + buffer) + 1;
    b = Math.min(n, Math.max(b, a + 1));
    return [a, b];
  }
}

/** Widen [a, b) so it covers index i when i is within `max` items of the window (focus must not vanish while scrolling). */
export function includeIndex(range, i, n, max = 60) {
  let [a, b] = range;
  if (i == null || i < 0 || i >= n) return [a, b];
  if (i < a && a - i <= max) a = i;
  else if (i >= b && i - b < max) b = i + 1;
  return [a, b];
}

/**
 * FLIP plan: for every rendered item, how far to slide it from where it was to where it is now.
 *  before / after: Map key -> top in px (content coordinates). `before` may include items that were not rendered
 *  (their layout position); `after` holds the rendered ones. view: { top, height } of the scrolled viewport.
 * Items that nobody sees at either end are skipped. An item that was on screen slides from its true old place
 * (clamped to a viewport and a bit, so a card leaving for far away does not stretch the scroll area). An item that
 * arrives from out of sight does not travel through the others: it appears with a short rise (`appear`). Items that
 * were not in the old list at all are returned in `entering`.
 * Returns { moves: [{ key, dy, appear }], entering: [key] }
 */
export function flipPlan(before, after, view, { maxSlide = view.height + 120, minMove = 1, reach = 1.25, appear = 40 } = {}) {
  const lo = view.top - view.height * (reach - 1) / 2, hi = view.top + view.height * (1 + (reach - 1) / 2);
  const seen = (y, h = 120) => y + h >= lo && y <= hi;
  const moves = [], entering = [];
  for (const [key, to] of after) {
    const from = before.get(key);
    if (from == null) { if (seen(to)) entering.push(key); continue; }
    const dy = from - to;
    if (Math.abs(dy) < minMove) continue;
    const sf = seen(from), st = seen(to);
    if (!sf && !st) continue;
    if (!sf) { moves.push({ key, dy: dy > 0 ? appear : -appear, appear: true }); continue; }
    moves.push({ key, dy: Math.max(-maxSlide, Math.min(maxSlide, dy)), appear: false });
  }
  return { moves, entering };
}

/** Where to scroll so that an item is visible with the least movement (like scrollIntoView block: nearest). */
export function nearestScroll(top, viewH, itemTop, itemH, pad = 4) {
  if (itemTop - pad < top) return Math.max(0, itemTop - pad);
  if (itemTop + itemH + pad > top + viewH) return itemTop + itemH + pad - viewH;
  return top;
}

/** Window the keyboard moves through: next index for ArrowDown/Up/Home/End/PageDown/PageUp. */
export function stepIndex(i, key, n, page = 5) {
  if (!n) return -1;
  const cur = i < 0 ? 0 : i;
  const t = { ArrowDown: cur + 1, ArrowUp: cur - 1, Home: 0, End: n - 1, PageDown: cur + page, PageUp: cur - page }[key];
  return t == null ? -1 : Math.max(0, Math.min(n - 1, t));
}
