// A way from the Floor plan studio's eye-level views into Unit 3D's city numbers: the direct sun a window gets today (hours and a day strip, from the
// window's own skyline against the shared city), and a hand-off that opens Unit 3D's Inside camera at the same date and time. Pure helpers, no
// three.js; the studio (plan3d.js) feeds them from plan/city.js and sun.js. A model, not a measurement.

const FROM = 300, TO = 1230;   // the strip's range, minutes of the day (5 am to 8:30 pm), as Unit 3D's day strip

/** The lit stretches of a day as percentages of the strip: [{left, width}] from litInfo()'s `segs` ([start, end] minutes). */
export function stripBars(segs, from = FROM, to = TO) {
  const span = to - from, out = [];
  for (const [a, b] of segs || []) {
    const s = Math.max(from, a), e = Math.min(to, b);
    if (e > s) out.push({ left: Math.round(((s - from) / span) * 1000) / 10, width: Math.round(((e - s) / span) * 1000) / 10 });
  }
  return out;
}
/** Where `min` sits on the strip, as a percentage. */
export const stripAt = (min, from = FROM, to = TO) => Math.round(Math.max(0, Math.min(1, (min - from) / (to - from))) * 1000) / 10;

/** "3 h 12", "45 m" or "none" for minutes of sun. */
export function hm(min) {
  if (!min) return 'none';
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return h && m ? `${h} h ${String(m).padStart(2, '0')}` : h ? `${h} h` : `${m} m`;
}

/**
 * The HTML of the studio's "Sun today" group for the look chips. `o` = {minutes: number|null (null: withheld or unknown), segs, min (now), label}.
 * Buttons carry data-act="unit-sun"; the studio's click handler opens Unit 3D.
 */
export function sunGroupHTML(o) {
  const bars = o.minutes == null ? '' : stripBars(o.segs).map((b) => `<i style="left:${b.left}%;width:${b.width}%"></i>`).join('');
  const txt = o.minutes == null ? 'Sun not computed for this window' : `<b>${hm(o.minutes)}</b> of direct sun through ${o.label ? `the ${o.label.toLowerCase()} window` : 'this window'} today`;
  return `<span class="lk-h">Sun today</span><span class="rc-n">${txt}</span>${o.minutes == null ? '' : `<span class="rc-strip" role="img" aria-label="Direct sun through this window across the day">${bars}<u style="left:${stripAt(o.min)}%"></u></span>`}<button type="button" class="lk-act" data-act="unit-sun" title="Open this view in Unit 3D: the full city, the sun path and the sun numbers">Sun path in Unit 3D</button>`;
}

const KEY = 'as:view-handoff';
/** Remember a view for Unit 3D to open (read once, within 30 s): {date, min, mode: 'in', view: the Inside chip key}. */
export function setHandoff(id, view) {
  try { sessionStorage.setItem(KEY, JSON.stringify({ id, t: Date.now(), view })); } catch { /* private window: Unit 3D opens as it was */ }
}
/** The view stored for `id`, once (it is cleared), or null. */
export function takeHandoff(id) {
  try {
    const h = JSON.parse(sessionStorage.getItem(KEY) || 'null'); sessionStorage.removeItem(KEY);
    if (h && h.id === id && Date.now() - h.t < 30000 && h.view && typeof h.view === 'object') return h.view;
  } catch { /* nothing stored */ }
  return null;
}
