// The times of day a render can be made at, as minutes of the viewed date. Pure: `altAt(min)` is the view's own sun model (degrees above the horizon),
// so "golden hour" is wherever the sun is low and warm on THAT date and place, not a clock time.

export const TIMES = [
  { key: 'golden', label: 'Golden hour', note: 'The evening sun low and warm' },
  { key: 'morning', label: 'Morning', note: 'Soon after sunrise' },
  { key: 'noon', label: 'Midday', note: 'The sun at its highest' },
  { key: 'blue', label: 'Blue hour', note: 'Just after sunset, lamps on' },
  { key: 'night', label: 'Night', note: 'The darkest the day strip reaches' },
  { key: 'now', label: 'As it is now', note: 'The time set in the view' },
];

/**
 * The minute for a preset.
 * @param {string} key one of TIMES
 * @param {(min: number) => number} altAt the sun's altitude in degrees at a minute of the day
 * @param {{from?: number, to?: number, step?: number, now?: number}} [o] the range the view can show (minutes) and the time it is set to
 * @returns {{min: number, alt: number, key: string}}
 */
export function timeOfDay(key, altAt, { from = 300, to = 1285, step = 5, now = 780 } = {}) {
  const mins = []; for (let m = from; m <= to; m += step) mins.push(m);
  const alts = mins.map(altAt), top = alts.indexOf(Math.max(...alts)), res = (i) => ({ min: mins[i], alt: alts[i], key });
  if (key === 'now') return { min: now, alt: altAt(now), key };
  if (key === 'noon') return res(top);
  const after = (pred, i0) => { for (let i = i0; i < mins.length; i++) if (pred(alts[i])) return i; return -1; };
  if (key === 'morning') { const i = after((a) => a >= 9, 0); return res(i < 0 ? top : Math.min(i, top)); }
  if (key === 'golden') {   // the last minute the sun is still 6.5 degrees up on its way down
    let i = -1; for (let k = mins.length - 1; k >= top; k--) if (alts[k] >= 6.5) { i = k; break; }
    return res(i < 0 ? top : i);
  }
  if (key === 'blue') { const i = after((a) => a <= -3, top); return res(i < 0 ? mins.length - 1 : i); }
  if (key === 'night') { const i = after((a) => a <= -12, top); return res(i < 0 ? alts.indexOf(Math.min(...alts.slice(top))) : i); }
  return { min: now, alt: altAt(now), key: 'now' };
}

/** "5:42 pm" for minutes after midnight. */
export function clock(min) { const m = Math.round(min), h = Math.floor(m / 60) % 24, mm = m % 60; return `${h % 12 || 12}:${String(mm).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`; }
