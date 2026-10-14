// Pure logic for the map lenses (no DOM, no map): the sun colour scale and the starred-homes helpers.
// Starred means the renter's own saved picks only; the `favorite` field in the data never counts.

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// ------------------------------------------------------------------ sun
/** Hours of direct sun for one month, or null when the home has no site model (unknown is never zero). */
export function sunHours(L, month) {
  const v = L?.site?.sun_hours?.[month];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
export const hasSunModel = (L) => Array.isArray(L?.site?.sun_hours) && L.site.sun_hours.some((v) => typeof v === 'number' && Number.isFinite(v));

/** The scale tops out here, like the drawer's sun bars: a high south-facing floor reaches 9 h on a midsummer 15th. */
export const SUN_MAX = 9;
/** Shade to sun: indigo, violet, apricot, sun. Blue to orange stays legible in simulated colour-blindness. */
export const SUN_STOPS = [[0, '#4254d6'], [2.5, '#7d6fd3'], [5, '#e79a52'], [SUN_MAX, '#ffd23f']];
export const SUN_UNKNOWN = '#8a90a0';

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const toHex = (c) => '#' + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
/** Colour for a sun-hours value (hours of direct sun a day); the grey for null. */
export function sunColor(h) {
  if (h == null || !Number.isFinite(h)) return SUN_UNKNOWN;
  const x = Math.max(0, Math.min(SUN_MAX, h));
  for (let i = 1; i < SUN_STOPS.length; i++) {
    const [t1, c1] = SUN_STOPS[i];
    if (x <= t1) {
      const [t0, c0] = SUN_STOPS[i - 1], k = (x - t0) / (t1 - t0), a = hex(c0), b = hex(c1);
      return toHex(a.map((v, j) => v + (b[j] - v) * k));
    }
  }
  return SUN_STOPS.at(-1)[1];
}
/** CSS gradient for the legend bar, matching sunColor stop for stop. */
export const sunGradient = () => `linear-gradient(90deg, ${SUN_STOPS.map(([t, c]) => `${c} ${(t / SUN_MAX) * 100}%`).join(', ')})`;
/** "5.2 h" style text, one decimal. */
export const hoursText = (h) => (h == null ? '?' : `${h.toFixed(1)} h`);

/** How many of `listings` have a model for `month`, and the range of their values. */
export function sunSummary(listings, month) {
  let known = 0, lo = Infinity, hi = -Infinity;
  for (const L of listings) { const h = sunHours(L, month); if (h == null) continue; known++; if (h < lo) lo = h; if (h > hi) hi = h; }
  return { known, unknown: listings.length - known, lo: known ? lo : null, hi: known ? hi : null, total: listings.length };
}

// ------------------------------------------------------------------ stars
/** The renter's starred homes among `listings`, in the order given, that can be placed on a map. */
export const starsOf = (listings, isSaved) => listings.filter((L) => L.lat != null && L.lon != null && isSaved(L.id));

/** The next (dir +1) or previous (dir -1) id in a ring. With no current id, `]` goes to the first and `[` to the last. */
export function stepId(ids, current, dir) {
  if (!ids.length) return null;
  const i = ids.indexOf(current);
  if (i < 0) return dir > 0 ? ids[0] : ids[ids.length - 1];
  return ids[(i + dir + ids.length) % ids.length];
}

/** [[west, south], [east, north]] around points [lon, lat], or null for none. */
export function boundsOf(points) {
  if (!points.length) return null;
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [x, y] of points) { if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y; }
  return [[w, s], [e, n]];
}
