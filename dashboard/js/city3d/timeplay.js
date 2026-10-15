// Playing the day and the year in the 3D views, as pure logic (no three.js, no DOM, so node tests read it): the stretch of the day to play (from the first
// light to the last), the clock of a loop, the dates of a year, the sentence that says when the sun reaches the floor and the bars of the strip chart. Unit 3D and
// the Floor plan studio both drive it from their own frame loop; city3d/playbar.js is the DOM. A VISUAL PREVIEW over the same sun model as every sun hour: playing
// changes only which date and time the existing model is asked about.

export const LOOP = { daySeconds: 14, yearSeconds: 20, holdMs: 800 };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const clamp01 = (x) => Math.max(0, Math.min(1, x));

/** "9:40 am" for minutes after midnight (the whole day: 0 is "12:00 am", 720 "12:00 pm"). */
export function clock12(min) {
  const m = Math.round(((min % 1440) + 1440) % 1440), h = Math.floor(m / 60), mm = m % 60;
  return `${h % 12 || 12}:${String(mm).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}

/**
 * The stretch of a day to play: from the first light (the sun `dawnAlt` degrees under the horizon, so the sky is seen going through dawn) to the last light, inside
 * the strip's range. `altAt(min)` gives the sun's altitude in degrees at a minute of the day. Where the sun never rises (or never sets) it plays the whole range.
 * @returns {{start: number, end: number, rise: number|null, set: number|null, noon: number}} minutes
 */
export function dayRange(altAt, { from = 300, to = 1290, step = 5, dawnAlt = -5, duskAlt = -5 } = {}) {
  // a coarse scan (every 8 minutes: the sun model is not free, Intl time zones are slow) and a bisection of each crossing down to the minute
  const N = 8, A = (m) => altAt(Math.max(0, Math.min(1439, m))), ms = [];
  for (let m = 0; m <= 1440; m += N) ms.push(m);
  const vals = ms.map(A);
  const cross = (level, up) => {   // the minute the altitude crosses `level` going up (first) or down (last)
    for (let k = up ? 0 : ms.length - 2; up ? k < ms.length - 1 : k >= 0; k += up ? 1 : -1) {
      const a = vals[k], b = vals[k + 1];
      if (up ? a <= level && b > level : a > level && b <= level) {
        let lo = ms[k], hi = ms[k + 1];
        while (hi - lo > 1) { const mid = Math.floor((lo + hi) / 2), v = A(mid); if (up ? v > level : v <= level) hi = mid; else lo = mid; }
        return up ? hi : lo;
      }
    }
    return null;
  };
  let noon = 0, hi = -Infinity;
  vals.forEach((v, k) => { if (v > hi) { hi = v; noon = ms[k]; } });
  const rise = cross(0, true), set = cross(0, false);
  let start = cross(dawnAlt, true), end = cross(duskAlt, false);
  if (start == null && vals[0] > dawnAlt) start = 0;
  if (end == null && vals[vals.length - 1] > duskAlt) end = 1439;
  if (start == null || end == null || end - start < 30) return { start: from, end: to - step, rise, set, noon };
  start = Math.max(from, start); end = Math.min(to - step, end);
  return { start, end: Math.max(end, start + 30), rise, set, noon };
}

/**
 * The clock of a loop: progress t from 0 to 1 at a steady pace, a short hold at the end, then round again. `tick(now)` is called from the frame loop with a
 * timestamp in ms and returns the new progress, or null when it is not running. A slow frame moves it by at most 100 ms of the loop (it never jumps).
 */
export class Player {
  constructor({ seconds = LOOP.daySeconds, holdMs = LOOP.holdMs } = {}) { this.seconds = seconds; this.holdMs = holdMs; this.running = false; this.t = 0; this.kind = null; this.last = 0; this.hold = 0; }
  /** Start (or restart) a loop of `kind` ('day' | 'year') from progress t0. */
  start(kind, t0 = 0, seconds = kind === 'year' ? LOOP.yearSeconds : LOOP.daySeconds) { this.kind = kind; this.seconds = seconds; this.t = clamp01(t0); this.running = true; this.last = 0; this.hold = 0; return this.t; }
  stop() { const was = this.running; this.running = false; this.last = 0; this.hold = 0; return was; }
  tick(now) {
    if (!this.running) return null;
    const dt = this.last ? Math.max(0, Math.min(100, now - this.last)) : 16; this.last = now;
    if (this.hold > 0) { this.hold -= dt; if (this.hold <= 0) { this.t = 0; this.hold = 0; } return this.t; }
    this.t += dt / (this.seconds * 1000);
    if (this.t >= 1) { this.t = 1; this.hold = this.holdMs; }
    return this.t;
  }
}

/** The minute of the day at progress t of a day loop over `range`, snapped to `snap` minutes (0: not at all). */
export function minuteAt(range, t, snap = 0) {
  const m = range.start + clamp01(t) * (range.end - range.start);
  return snap > 0 ? Math.round(m / snap) * snap : m;
}
/** Progress of a minute inside a range (0 when the minute is outside it, so a loop begins at the first light). */
export const progressOf = (range, min) => (min >= range.start && min < range.end ? (min - range.start) / (range.end - range.start) : 0);

const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
export const daysIn = (y) => (new Date(Date.UTC(y, 1, 29)).getUTCDate() === 29 ? 366 : 365);
/** The date of day `doy` (1-based) of year y: {y, m (1..12), d, iso}. A day past the end wraps to the start. */
export function dateOfYear(y, doy) {
  const n = daysIn(y); let k = ((Math.round(doy) - 1) % n + n) % n, m = 0;
  const dm = DAYS.slice(); dm[1] = n === 366 ? 29 : 28;
  while (k >= dm[m]) { k -= dm[m]; m++; }
  const d = k + 1;
  return { y, m: m + 1, d, iso: `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`, label: `${MONTHS[m]} ${d}` };
}
/** Day of the year (1-based) of an ISO date. */
export function doyOf(iso) {
  const [y, m, d] = String(iso).split('-').map(Number), dm = DAYS.slice(); dm[1] = daysIn(y) === 366 ? 29 : 28;
  return dm.slice(0, m - 1).reduce((t, v) => t + v, 0) + d;
}
/** The date at progress t of a year loop made of `steps` dates (every few days; Fast uses fewer): {y, m, d, iso, label, step}. */
export function yearFrame(y, t, steps = 104) {
  const k = Math.min(steps - 1, Math.floor(clamp01(t) * steps)), doy = 1 + Math.floor(((k + 0.5) / steps) * daysIn(y));
  return { ...dateOfYear(y, doy), step: k };
}
/** Progress of an ISO date inside its year loop (where a loop started at that date would begin). */
export const yearProgress = (iso) => { const y = +String(iso).slice(0, 4); return Math.min(0.999, (doyOf(iso) - 0.5) / daysIn(y)); };

/** Merge lit stretches ([start, end] minutes) from several windows into one list: the sun reaches the floor when it reaches any window. */
export function unionSegs(lists) {
  const all = [];
  for (const l of lists) for (const [a, b] of l || []) if (b > a) all.push([a, b]);
  all.sort((x, y) => x[0] - y[0]);
  const out = [];
  for (const [a, b] of all) { const last = out[out.length - 1]; if (last && a <= last[1] + 0.5) last[1] = Math.max(last[1], b); else out.push([a, b]); }
  return out;
}
/** Total minutes in a list of stretches. */
export const segMinutes = (segs) => (segs || []).reduce((t, [a, b]) => t + (b - a), 0);
/** Is minute `min` inside one of the stretches? */
export const inSegs = (segs, min) => (segs || []).some(([a, b]) => min >= a && min < b);

/**
 * The sentence that says when the sun reaches the floor, e.g. "Sun on the floor 9:40 am to 1:15 pm" (several stretches joined with "and"; none: "No direct sun on
 * the floor"). Stretches shorter than 5 minutes are left out. `label` is what the sun reaches ("the floor", "this window").
 */
export function sunSentence(segs, label = 'the floor') {
  const merged = [];   // a gap of a few minutes (a mast, a gap between towers) does not split the sentence
  for (const [a, b] of segs || []) { const last = merged[merged.length - 1]; if (last && a - last[1] <= 12) last[1] = Math.max(last[1], b); else merged.push([a, b]); }
  const s = merged.filter(([a, b]) => b - a >= 5);
  if (!s.length) return `No direct sun on ${label}`;
  return `Sun on ${label} ${s.map(([a, b]) => `${clock12(a)} to ${clock12(b)}`).join(' and ')}`;
}

/** Where the sun is relative to the stretches now: 'in sun' | 'in shade' (up but not on the floor) | 'night'. */
export const sunNow = (segs, min, alt) => (alt <= 0 ? 'night' : inSegs(segs, min) ? 'in sun' : 'in shade');

/**
 * The strip chart of direct-sun hours by month: `hours` = 12 numbers; returns {bars: [{x, y, w, h, hours, month}], max, ticks: [hours], cursor(t)} in a w x h box with
 * `pad` below for the month letters. `max` is a round number above the biggest month (at least 2).
 */
export function monthBars(hours, { w = 240, h = 46, pad = 12, gap = 3 } = {}) {
  const vals = Array.from({ length: 12 }, (_, i) => Math.max(0, +hours?.[i] || 0)), top = Math.max(...vals, 0.5);
  const max = [2, 4, 6, 8, 10, 12, 14, 16].find((s) => s >= top) || Math.ceil(top), bw = (w - gap * 11) / 12, ch = h - pad;
  const bars = vals.map((v, i) => { const bh = Math.max(v > 0 ? 1.5 : 0, (v / max) * ch); return { x: i * (bw + gap), y: ch - bh, w: bw, h: bh, hours: v, month: i }; });
  return { bars, max, ticks: [0, max / 2, max], width: w, height: h, chartHeight: ch, cursor: (t) => clamp01(t) * w };
}
/** The month (0..11) a year-loop progress falls in. */
export const monthOf = (y, t) => dateOfYear(y, 1 + Math.floor(clamp01(t) * daysIn(y) * 0.9999)).m - 1;
