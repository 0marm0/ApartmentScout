// Annual daylight summary for one window: three separate quantities per month, drawn as three small panels and a table.
//   direct sun hours      possible (clear sky) and expected (NOAA sunshine share), from the existing sun model     [modelled]
//   sky visibility        the share of an unobstructed window's sky light the skyline leaves (same every month)    [modelled]
//   relative daylight     the window's vertical sky component, % of the same sky's open horizontal illuminance     [modelled]
// None of it is measured, calibrated or lux. Shared by the Unit 3D Daylight block and the Floor plan studio's Light tab.
import { annualDaylight, monthlyDirectSun, MODEL_LABEL } from '../features/daylight-core.js';

const MONTHS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const cache = new Map();

/**
 * The annual summary for a window; cached by the skyline (identity), facing, panes, year, place and sunshine table.
 * `fraction` = the 12 monthly sunshine shares (or null), `place` names where they come from.
 */
export function annualFor({ prof, facing, panes = null, year, lat, lon, tz, skyViewShare, fraction = null, place = '', source = '' }) {
  const key = `${year}|${lat.toFixed(4)}|${lon.toFixed(4)}|${facing.toFixed(2)}|${(panes || []).join(',')}|${skyViewShare.toFixed(3)}|${fraction ? fraction.join(',') : ''}`;
  const hit = cache.get(prof);
  if (hit && hit.key === key) return hit.value;
  const possible = monthlyDirectSun(prof, facing, panes, year, lat, lon, tz);
  const value = annualDaylight(prof, facing, panes, year, lat, lon, tz, possible, skyViewShare, fraction);
  value.sunshine = fraction ? { place, source: source || 'NOAA climate normals 1961-1990, percent of possible sunshine' } : null;
  cache.set(prof, { key, value });
  return value;
}

const niceMax = (v, steps = [1, 2, 4, 6, 8, 10, 12, 14]) => steps.find((s) => s >= v) ?? Math.ceil(v);

/** Year totals (hours) for the direct sun panel. */
export function yearTotals(a) {
  const days = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const sum = (arr) => Math.round(arr.reduce((t, h, i) => t + h * days[i], 0));
  return { possible: sum(a.direct_sun.possible_h_per_day), expected: a.direct_sun.expected_h_per_day ? sum(a.direct_sun.expected_h_per_day) : null };
}

/**
 * The chart as SVG markup (classes lx-*, coloured by css/views/lighting.css). `a` = annualFor(...). No inline colours.
 */
export function annualSVG(a, { title = 'Daylight through the year' } = {}) {
  const W = 340, L = 30, R = 8, pw = W - L - R, bw = pw / 12;
  const poss = a.direct_sun.possible_h_per_day, exp = a.direct_sun.expected_h_per_day;
  const sunMax = niceMax(Math.max(...poss, 0.5)), rd = a.relative_daylight, clear = rd.clear_pct;
  const rdMax = niceMax(Math.max(...clear, rd.overcast_pct, 0.5) * 1.1, [2, 4, 6, 8, 10, 15, 20, 30, 40, 60, 80, 100]);
  const rows = [
    { y: 22, h: 60, kind: 'sun' },
    { y: 128, h: 18, kind: 'sky' },
    { y: 184, h: 62, kind: 'day' },
  ];
  const X = (i) => L + i * bw;
  const out = [];
  const head = (y, t, k) => `<text class="lx-h" x="${L}" y="${y - 8}">${esc(t)}</text><text class="lx-k" x="${W - R}" y="${y - 8}" text-anchor="end">${esc(k)}</text>`;
  const axis = (r, max, ticks, unit) => ticks.map((v) => `<line class="lx-grid" x1="${L}" x2="${W - R}" y1="${r.y + r.h - (v / max) * r.h}" y2="${r.y + r.h - (v / max) * r.h}"/><text class="lx-t" x="${L - 4}" y="${r.y + r.h - (v / max) * r.h + 3}" text-anchor="end">${v}${unit}</text>`).join('');
  const months = (r) => MONTHS.map((m, i) => `<text class="lx-m" x="${X(i) + bw / 2}" y="${r.y + r.h + 11}" text-anchor="middle">${m}</text>`).join('');
  // 1. direct sun
  let r = rows[0];
  out.push(head(r.y, 'Direct sun, hours a day', exp ? 'possible and expected' : 'possible, clear sky'));
  out.push(axis(r, sunMax, [0, sunMax / 2, sunMax].map((v) => +v.toFixed(1)), ''));
  poss.forEach((h, i) => { const bh = (h / sunMax) * r.h; out.push(`<rect class="lx-poss" x="${X(i) + 2}" y="${r.y + r.h - bh}" width="${bw - 4}" height="${Math.max(0, bh)}" rx="1.5"/>`); });
  if (exp) exp.forEach((h, i) => { const bh = (h / sunMax) * r.h; out.push(`<rect class="lx-exp" x="${X(i) + 5}" y="${r.y + r.h - bh}" width="${bw - 10}" height="${Math.max(0, bh)}" rx="1.5"/>`); });
  out.push(months(r));
  // 2. sky visibility
  r = rows[1];
  out.push(head(r.y, 'Sky visibility', 'same every month'));
  out.push(`<rect class="lx-track" x="${L}" y="${r.y + 2}" width="${pw}" height="10" rx="5"/><rect class="lx-sky" x="${L}" y="${r.y + 2}" width="${Math.max(1, pw * a.sky_visibility.share)}" height="10" rx="5"/><text class="lx-v" x="${L + pw * a.sky_visibility.share + (a.sky_visibility.share > 0.85 ? -6 : 6)}" y="${r.y + 11}" text-anchor="${a.sky_visibility.share > 0.85 ? 'end' : 'start'}">${Math.round(a.sky_visibility.share * 100)}%</text>`);
  // 3. relative daylight
  r = rows[2];
  out.push(head(r.y, 'Relative daylight', 'line: clear sky · dashed: overcast'));
  out.push(axis(r, rdMax, [0, rdMax / 2, rdMax].map((v) => +v.toFixed(1)), ''));
  const yv = (v) => r.y + r.h - (v / rdMax) * r.h;
  out.push(`<line class="lx-oc" x1="${L}" x2="${W - R}" y1="${yv(rd.overcast_pct)}" y2="${yv(rd.overcast_pct)}"/><text class="lx-oc-t" x="${W - R}" y="${yv(rd.overcast_pct) + 11}" text-anchor="end">overcast sky ${rd.overcast_pct}%</text>`);
  out.push(`<polyline class="lx-line" points="${clear.map((v, i) => `${X(i) + bw / 2},${yv(v).toFixed(1)}`).join(' ')}"/>${clear.map((v, i) => `<circle class="lx-dot" cx="${X(i) + bw / 2}" cy="${yv(v).toFixed(1)}" r="2.2"/>`).join('')}`);
  out.push(months(r));
  return `<svg class="lx-annual" viewBox="0 0 ${W} 268" role="img" aria-label="${esc(title)}: ${esc(summaryText(a))}" preserveAspectRatio="xMidYMid meet">${out.join('')}</svg>`;
}

/** One sentence for screen readers and the caption. */
export function summaryText(a) {
  const t = yearTotals(a), rd = a.relative_daylight;
  return `direct sun ${t.possible} hours a year possible${t.expected != null ? `, about ${t.expected} expected with typical cloud` : ''}; the window sees ${Math.round(a.sky_visibility.share * 100)}% of an unobstructed window's sky light; relative daylight ${rd.overcast_pct}% under an overcast sky, ${Math.min(...rd.clear_pct)} to ${Math.max(...rd.clear_pct)}% under a clear diffuse sky. Modelled, not measured.`;
}

/** The numbers behind the chart as a table (also the keyboard and screen-reader route). */
export function annualTable(a) {
  const exp = a.direct_sun.expected_h_per_day, rd = a.relative_daylight;
  const row = (label, vals, f = (v) => v) => `<tr><th scope="row">${label}</th>${vals.map((v) => `<td class="num">${v == null ? '—' : f(v)}</td>`).join('')}</tr>`;
  return `<table class="mini lx-annual-table"><thead><tr><th></th>${MONTH_NAMES.map((m) => `<th class="num" scope="col">${m}</th>`).join('')}</tr></thead><tbody>
    ${row('Sun possible (h/day)', a.direct_sun.possible_h_per_day)}
    ${exp ? row('Sun expected (h/day)', exp) : ''}
    ${row('Sky visibility (%)', MONTH_NAMES.map(() => Math.round(a.sky_visibility.share * 100)))}
    ${row('Daylight, overcast (%)', MONTH_NAMES.map(() => rd.overcast_pct))}
    ${row('Daylight, clear sky (%)', rd.clear_pct)}</tbody></table>`;
}

/** The whole block: chart, caption and the table in a details element. `who` names the window. */
export function annualBlock(a, who = '') {
  const t = yearTotals(a), sun = a.sunshine;
  return `<div class="lx-annual-wrap">${annualSVG(a, { title: `Daylight through the year${who ? ', ' + who : ''}` })}
    <ul class="lx-sum"><li><b>${t.possible} h</b> direct sun a year possible${t.expected != null ? `, about <b>${t.expected} h</b> expected` : ''}</li>
    <li><b>${Math.round(a.sky_visibility.share * 100)}%</b> of an unobstructed window's sky light is visible</li>
    <li>Relative daylight <b>${a.relative_daylight.overcast_pct}%</b> under an overcast sky</li></ul>
    <p class="lx-cap"><span class="pill">Modelled</span> Three separate quantities, not combined. ${esc(MODEL_LABEL)}. Direct sun is the clear-sky geometric number${sun ? `, scaled by ${esc(sun.source)} (${esc(sun.place)}) for the expected bars` : ''}. Relative daylight is a vertical sky component under the CIE overcast sky (one value) and the CIE clear diffuse sky (by month, as the sun's position changes); the two skies differ in absolute brightness, so they are never averaged.</p>
    <details class="lx-more"><summary>Numbers by month</summary>${annualTable(a)}</details></div>`;
}

/**
 * The panel for Unit 3D: a heading, one line of what it is, and a details element that holds the chart. The chart is
 * only computed while the details element is open (`compute()` returns annualFor(...)), so a closed panel costs nothing.
 */
export function panelHTML({ open, who, compute }) {
  const body = open ? (() => { try { return annualBlock(compute(), who); } catch (e) { return `<p class="u-note">The annual summary could not be computed: ${esc(e.message || e)}</p>`; } })() : '';
  return `<h3>Daylight through the year <span>modelled · not lux</span></h3>
    <p class="u-note">Direct sun hours, sky visibility and relative daylight for ${esc(who)}, month by month, kept as three separate quantities.</p>
    <details class="lx-more lx-year" id="uAnnualDetails"${open ? ' open' : ''}><summary>${open ? 'Hide the chart' : 'Show the chart'}</summary>${body}</details>`;
}
