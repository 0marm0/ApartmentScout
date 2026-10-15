// The tree season of the 3D views, as pure data (no three.js, so node tests read it): how much leaf the broadleaf trees carry on a date and how far
// their colour has turned. Leaves are on from late May to early October, turn through October and November, fall by early December, are bare
// until April and bud out through April and May. A northern-hemisphere calendar, shifted six months south of the equator.
//
// A PICTURE, never a number: the trees stay context. They are not obstructions in any sun hour, skyline, daylight figure or score, in any month.
// Conifers (the cone trees) do not change.

const DAYS = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];   // days before each month in a common year
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const sm = (x) => { const t = clamp01(x); return t * t * (3 - 2 * t); };

/** Day of the year (1..366) for a month 1..12 and day of month. February 29 is counted as day 60 (the picture does not care). */
export function dayOfYear(m, d) {
  const mm = Math.max(1, Math.min(12, Math.round(+m) || 1)), dd = Math.max(1, Math.min(31, Math.round(+d) || 1));
  return DAYS[mm - 1] + dd;
}

// [day of year, leaf 0..1, autumn colour 0..1], linear between the points, eased
const CURVE = [
  [1, 0, 0], [91, 0, 0],            // bare until April 1
  [110, 0.12, 0],                   // buds, April 20
  [130, 0.82, 0],                   // leafing out, May 10
  [148, 1, 0],                      // full leaf, May 28
  [278, 1, 0],                      // Oct 5: still green
  [290, 1, 0.38],                   // Oct 17: the turn begins
  [304, 0.96, 0.85],                // Oct 31: peak colour, the first leaves down
  [316, 0.72, 1],                   // Nov 12
  [328, 0.36, 1],                   // Nov 24
  [340, 0.08, 1],                   // Dec 6: nearly bare
  [352, 0, 1], [366, 0, 0],         // bare through the winter
];

/**
 * The tree season on a date. `lat` (degrees, default northern) flips the calendar six months south of the equator.
 * @returns {{leaf: number, autumn: number, doy: number}} leaf: share of the leaves on the branches (0 bare .. 1 full); autumn: how far the colour has turned (0 green .. 1 gold and red)
 */
export function seasonAt(m, d, lat = 40) {
  let doy = dayOfYear(m, d);
  if (Number.isFinite(+lat) && +lat < 0) doy = ((doy + 182 - 1) % 365) + 1;
  for (let i = 1; i < CURVE.length; i++) {
    const [d1, l1, a1] = CURVE[i];
    if (doy <= d1) {
      const [d0, l0, a0] = CURVE[i - 1], t = sm((doy - d0) / Math.max(1, d1 - d0));
      return { leaf: +(l0 + (l1 - l0) * t).toFixed(3), autumn: +(a0 + (a1 - a0) * t).toFixed(3), doy };
    }
  }
  return { leaf: 0, autumn: 0, doy };
}

/** The season of an ISO date 'YYYY-MM-DD' (anything else: full summer leaf). */
export function seasonOfDate(iso, lat = 40) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? seasonAt(+m[2], +m[3], lat) : { leaf: 1, autumn: 0, doy: 180 };
}

/** Snap a season to `n` steps, so a play loop re-colours the trees only when the picture really changes. */
export const quantise = (s, n = 24) => ({ leaf: Math.round(s.leaf * n) / n, autumn: Math.round(s.autumn * n) / n });
/** A key that changes exactly when the quantised picture does. */
export const seasonKey = (s, n = 24) => { const q = quantise(s, n); return `${q.leaf}|${q.autumn}`; };

/** The name of the stage a season is in, for a chip: 'Bare branches' | 'Buds' | 'Leafing out' | 'Leaves on' | 'Autumn colour' | 'Leaves falling'. */
export function seasonLabel(s) {
  const spring = s.doy != null ? s.doy < 200 : false;
  if (s.leaf < 0.04) return 'Bare branches';
  if (s.leaf < 0.97 && spring) return s.leaf < 0.3 ? 'Buds' : 'Leafing out';
  if (s.autumn > 0.12) return s.leaf < 0.6 ? 'Leaves falling' : 'Autumn colour';
  return 'Leaves on';
}

/** The sentence the 3D chips use: the picture follows the season, the numbers never count a tree. */
export const SEASON_NOTE = 'In the picture the trees follow the season: leaves on in summer, autumn colours in October and November, bare branches in winter. The numbers never count a tree: the sun hours, skylines and daylight figures are the same in every month';
