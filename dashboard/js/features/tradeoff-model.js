// Trade-off pad: the pure maths. A triangle whose corners are three ranking dimensions (Cost, Commute, Space, or the
// renter's top three weights). A point in the triangle is a split of the group's weight between the three corners
// (barycentric coordinates); the other weights stay where they are. The result is the same integer weights object the
// weight sliders write, so the live re-rank and the slider thumbs follow without a second code path.
// No DOM and no imports, so `node --test` can load it.

export const SLIDER_MAX = 40;   // the rail's sliders run 0..40
const H = Math.sqrt(3) / 2;
/** Corner positions in a unit box: top, bottom-left, bottom-right (an equilateral triangle, width 1, height 0.866). */
export const CORNERS = [[0.5, 0], [0, H], [1, H]];
export const HEIGHT = H;

const sum = (a) => a.reduce((x, y) => x + y, 0);
const num = (v) => (Number.isFinite(+v) ? +v : 0);

/** Barycentric shares [a, b, c] (sum 1) of the point (x, y); points outside the triangle are pulled to its edge. */
export function toShares(x, y, corners = CORNERS) {
  const [[x1, y1], [x2, y2], [x3, y3]] = corners;
  const d = (y2 - y3) * (x1 - x3) + (x3 - x2) * (y1 - y3);
  let a = ((y2 - y3) * (x - x3) + (x3 - x2) * (y - y3)) / d;
  let b = ((y3 - y1) * (x - x3) + (x1 - x3) * (y - y3)) / d;
  let c = 1 - a - b;
  [a, b, c] = [a, b, c].map((v) => Math.max(0, v));
  const t = a + b + c || 1;
  return [a / t, b / t, c / t];
}
/** The point for a split of shares [a, b, c]. */
export function toXY(shares, corners = CORNERS) {
  const t = sum(shares) || 1;
  return [0, 1].map((k) => sum(shares.map((s, i) => (s / t) * corners[i][k])));
}

/** No share above `cap` (a slider cannot go past its maximum): the excess goes to the others in proportion. */
export function clampShares(shares, cap = 1) {
  let s = shares.map((v) => Math.max(0, v));
  const t = sum(s) || 1; s = s.map((v) => v / t);
  if (cap >= 1) return s;
  const fixed = new Set();
  for (let guard = 0; guard < 4; guard++) {
    const over = s.findIndex((v, i) => !fixed.has(i) && v > cap + 1e-12);
    if (over < 0) break;
    fixed.add(over);
    const free = s.map((_, i) => i).filter((i) => !fixed.has(i));
    const excess = s[over] - cap; s[over] = cap;
    const room = sum(free.map((i) => s[i]));
    for (const i of free) s[i] += room > 0 ? (excess * s[i]) / room : excess / free.length;
  }
  return s;
}

/** The weight the three dimensions hold between them (rounded: sliders are whole numbers). */
export const groupTotal = (weights, dims) => Math.round(sum(dims.map((k) => num(weights[k]))));
/** Their current split as shares, or null when none of them has any weight. */
export function sharesOf(weights, dims) {
  const w = dims.map((k) => num(weights[k])), t = sum(w);
  return t > 0 ? w.map((v) => v / t) : null;
}

/** New weights for a split of the group's total: the three dimensions get whole numbers that add up to the same total
 *  (largest remainder), none above `max`; every other dimension is left alone. */
export function applyShares(weights, dims, shares, { max = SLIDER_MAX } = {}) {
  const total = Math.min(groupTotal(weights, dims), max * dims.length);
  const cap = total > 0 ? Math.min(1, max / total) : 1;
  const s = clampShares(shares, cap), raw = s.map((v) => v * total), fl = raw.map(Math.floor);
  let left = total - sum(fl);
  const order = raw.map((v, i) => [v - fl[i], i]).sort((p, q) => q[0] - p[0] || p[1] - q[1]);
  for (let k = 0; left > 0 && k < order.length; k++, left--) fl[order[k][1]]++;
  const out = { ...weights };
  dims.forEach((k, i) => { out[k] = Math.min(max, fl[i]); });
  return out;
}

/** Keyboard steps in whole slider notches, group total unchanged. 'up' gives the top corner `n` more (taken from the
 *  heavier of the other two, a notch at a time), 'down' takes `n` from it (given to the lighter), 'right' moves `n`
 *  from the bottom-left corner to the bottom-right one, 'left' the other way. Nothing goes below 0 or above `max`. */
export function nudgeWeights(weights, dims, dir, n = 1, { max = SLIDER_MAX } = {}) {
  const w = dims.map((k) => Math.round(num(weights[k])));
  const give = (from, to) => { if (w[from] > 0 && w[to] < max) { w[from]--; w[to]++; return true; } return false; };
  for (let i = 0; i < n; i++) {
    if (dir === 'up') { const [a, b] = w[1] >= w[2] ? [1, 2] : [2, 1]; if (!give(a, 0) && !give(b, 0)) break; }
    else if (dir === 'down') { const [a, b] = w[1] <= w[2] ? [1, 2] : [2, 1]; if (!give(0, a) && !give(0, b)) break; }
    else if (dir === 'right') { if (!give(1, 2)) break; }
    else if (dir === 'left') { if (!give(2, 1)) break; }
  }
  const out = { ...weights };
  dims.forEach((k, i) => { out[k] = w[i]; });
  return out;
}

/** The renter's `n` heaviest weights, heaviest first (ties keep the order of `dimKeys`). */
export function topDims(weights, dimKeys, n = 3) {
  return dimKeys.map((k, i) => [k, num(weights[k]), i]).sort((a, b) => b[1] - a[1] || a[2] - b[2]).slice(0, n).map((x) => x[0]);
}
/** Cost, Commute, Space when all three exist, else the top three weights. */
export function defaultAxes(weights, dimKeys) {
  const want = ['cost', 'commute', 'space'];
  return want.every((k) => dimKeys.includes(k)) ? want : topDims(weights, dimKeys, 3);
}

// ------------------------------------------------------------------ ranking previews
/** The overall score the dashboard shows for a listing under `weights`: the dimension scores weighted, an unknown
 *  dimension counting as a neutral 50 (the same formula as rescore() in app.js). */
export function weightedScore(L, weights, dimKeys) {
  const p = L.score?.parts || {}, tot = sum(dimKeys.map((k) => num(weights[k]))) || 1;
  return p && Object.keys(p).length ? sum(dimKeys.map((k) => num(weights[k]) * (p[k] ?? 50))) / tot : L.score?.overall;
}
/** Listing ids best match first under `weights`: score descending, stable for ties (the order the cards use). */
export function rankIds(listings, weights, dimKeys) {
  return listings.map((L, i) => [L, weightedScore(L, weights, dimKeys) ?? -1, i]).sort((a, b) => b[1] - a[1] || a[2] - b[2]).map((x) => x[0].id);
}
/** How the top `n` of `after` moved against `before`: rows { id, rank, was, delta } (was null when the home was not
 *  ranked, delta > 0 means it climbed), and `out`, the homes that fell out of the top `n`. */
export function rankShift(before, after, n = 10) {
  const was = new Map(before.map((id, i) => [id, i + 1])), now = new Map(after.map((id, i) => [id, i + 1]));
  const rows = after.slice(0, n).map((id, i) => ({ id, rank: i + 1, was: was.get(id) ?? null, delta: was.has(id) ? was.get(id) - (i + 1) : null }));
  const out = before.slice(0, n).filter((id) => (now.get(id) ?? Infinity) > n).map((id) => ({ id, was: was.get(id), now: now.get(id) ?? null }));
  return { rows, out, changed: rows.filter((r) => r.delta !== 0).length };
}
/** Share of the whole (every dimension) a dimension holds, in whole percent: what the sliders print. */
export function pctOf(weights, dimKeys, k) {
  const tot = sum(dimKeys.map((d) => num(weights[d])));
  return tot > 0 ? Math.round((num(weights[k]) / tot) * 100) : 0;
}
