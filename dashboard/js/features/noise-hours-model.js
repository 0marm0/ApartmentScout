// Noise complaints by hour of the day: the arithmetic, with no page in it (tested by tests/js/noise-hours.test.mjs).
//
// Data (apartmentscout/noise_hours.py writes it; see there for the conventions):
//   layers/noise-hours.json   311 noise requests per 150 m cell by hour, for two kinds of night -- Sun-Thu (class 0) and
//                             Fri-Sat (class 1), where an hour after midnight counts toward the evening before -- as
//                             log-quantised bytes; and, on 450 m cells, the same by four-hour bucket and kind of source.
//   dossiers/<id>.json        noise_311.by_week (7 x 24 calendar counts, Monday first) and by_hour_group (6 x 24) for the
//                             requests within 150 m of one building over three years.
// These are complaints, not decibels: they say when people phone 311, which follows noise but also who lives nearby.
import { inflate } from './timeofday-model.js';

export const CLASSES = [{ id: 'sunthu', short: 'Sun–Thu', long: 'Sun–Thu nights' }, { id: 'frisat', short: 'Fri–Sat', long: 'Fri–Sat nights' }];
export const SHIFT_H = 5;
/** Phrases for the kinds of source, in the order of the layer's groups (noise_hours.GROUPS). */
export const GROUP_PHRASE = {
  bars: 'bars, clubs and restaurants', street: 'street crowds and music', home: 'neighbours (music, banging, voices)',
  vehicle: 'traffic, horns and helicopters', build: 'construction', equip: 'alarms, dogs and building equipment',
};
export const BUCKET_START = [2, 6, 10, 14, 18, 22];   // noise_hours.BUCKETS: four hours each, from 2 am

export const hourLabel = (h) => { const x = ((Math.round(h) % 24) + 24) % 24; return x === 0 ? '12 am' : x < 12 ? `${x} am` : x === 12 ? '12 pm' : `${x - 12} pm`; };
/** hourLabel(23) .. 3 hours -> '11 pm–2 am': the window ends on the hour after its last hour. */
export const windowLabel = (start, width = 3) => `${hourLabel(start)}–${hourLabel(start + width)}`;

// ------------------------------------------------------------------ decoding
const LUT = new Map();
function lut(k) {
  if (!LUT.has(k)) { const t = new Float32Array(256); for (let q = 0; q < 256; q++) t[q] = Math.round(Math.expm1(q / k)); LUT.set(k, t); }
  return LUT.get(k);
}
/** The layer document with its byte arrays inflated: { doc, cells, hours: [Uint8Array(24*cells) x2], mix: Uint8Array, k, days }. */
export async function decode(doc) {
  const cells = doc.rows * doc.cols;
  const hours = [];
  for (const z of doc.hours_z) hours.push(await inflate(z));
  const mix = await inflate(doc.mix.z);
  return { doc, cells, hours, mix, k: doc.log_k, days: doc.days };
}
/** Counts per cell (Float32Array) for one hour (0-23, or 'all') and class (0, 1, or 'all'). */
export function cellCounts(dec, hour = 'all', cls = 'all') {
  const t = lut(dec.k), out = new Float32Array(dec.cells), classes = cls === 'all' ? [0, 1] : [cls];
  const hs = hour === 'all' ? Array.from({ length: 24 }, (_, i) => i) : [hour];
  for (const c of classes) for (const h of hs) { const o = h * dec.cells, q = dec.hours[c]; for (let i = 0; i < dec.cells; i++) out[i] += t[q[o + i]]; }
  return out;
}

/** The cell (row, col) a point falls in, or null outside the layer; the layer is stretched over its bbox like the other heat layers. */
export function cellAt(doc, lat, lon) {
  const [lo0, la0, lo1, la1] = doc.bbox;
  const r = Math.floor(((lat - la0) / (la1 - la0)) * doc.rows), c = Math.floor(((lon - lo0) / (lo1 - lo0)) * doc.cols);
  return r < 0 || c < 0 || r >= doc.rows || c >= doc.cols ? null : { r, c };
}
/** Hours [class][24] summed over the (2*ring+1)^2 cells around a point (ring 1 = about 450 m), the kinds of source
 *  [class][bucket][group] of the coarse cell it is in, and how many cells with any complaints went in. null outside the layer. */
export function areaProfile(dec, lat, lon, ring = 1) {
  const { doc } = dec, at = cellAt(doc, lat, lon);
  if (!at) return null;
  const t = lut(dec.k), hours = [Array(24).fill(0), Array(24).fill(0)];
  let cells = 0;
  for (let dr = -ring; dr <= ring; dr++) for (let dc = -ring; dc <= ring; dc++) {
    const r = at.r + dr, c = at.c + dc;
    if (r < 0 || c < 0 || r >= doc.rows || c >= doc.cols) continue;
    const i = r * doc.cols + c;
    let any = false;
    for (let k = 0; k < 2; k++) for (let h = 0; h < 24; h++) { const v = t[dec.hours[k][h * dec.cells + i]]; if (v) { hours[k][h] += v; any = true; } }
    if (any) cells++;
  }
  const m = doc.mix, mi = Math.floor(at.r / m.block) * m.cols + Math.floor(at.c / m.block), nb = m.buckets.length, ng = m.groups.length, mt = lut(m.log_k);
  const mixes = Array.from({ length: 2 }, (_, k) => Array.from({ length: nb }, (_, b) => Array.from({ length: ng }, (_, g) => mt[dec.mix[(((k * nb + b) * ng + g) * m.rows * m.cols) + mi]])));
  return { hours, mix: mixes, cells, days: doc.days, groups: m.groups.map((g) => g.id), scope: 'area', radiusM: Math.round(doc.cell_m * (2 * ring + 1)), months: doc.months };
}

/** A building's 7 x 24 calendar counts as [class][hour], with the night rule (hours before 5 am count to the day before). */
export function classesFromWeek(byWeek) {
  const out = [Array(24).fill(0), Array(24).fill(0)];
  for (let wd = 0; wd < 7; wd++) for (let h = 0; h < 24; h++) {
    const day = h >= SHIFT_H ? wd : (wd + 6) % 7;
    out[day === 4 || day === 5 ? 1 : 0][h] += byWeek?.[wd]?.[h] || 0;
  }
  return out;
}
/** The profile of one building from its dossier's noise_311, or null when the dossier has no by-hour data yet. */
export function buildingProfile(nz) {
  if (!nz?.by_week) return null;
  return { hours: classesFromWeek(nz.by_week), groupHours: nz.by_hour_group || null, days: nz.week_days || [1, 1], scope: 'building', radiusM: nz.radius_m,
    total: nz.nearby_total, years: nz.nearby_total && nz.nearby_per_year ? Math.round(nz.nearby_total / nz.nearby_per_year * 10) / 10 : null };
}

// ------------------------------------------------------------------ reading a profile
const sum = (a) => a.reduce((x, y) => x + y, 0);
/** The series to draw: complaints per night for each hour, for 'all' nights or one class (0 / 1). */
export function series(profile, cls = 'all') {
  const d = profile.days.map((n) => Math.max(1, n));
  if (cls === 'all') return Array.from({ length: 24 }, (_, h) => (profile.hours[0][h] + profile.hours[1][h]) / (d[0] + d[1]));
  return profile.hours[cls].map((v) => v / d[cls]);
}
export const total = (profile) => sum(profile.hours[0]) + sum(profile.hours[1]);

/** The loudest `width` consecutive hours (wrapping midnight) by complaints per night: { cls, start, width, rate, count, share, ratio }
 *  (noise_hours.peak_window). share = the window's part of its class's complaints; ratio = times the average hour. */
export function peak(profile, width = 3) {
  const tot = total(profile);
  if (tot <= 0) return null;
  const d = profile.days.map((n) => Math.max(1, n));
  let best = null;
  for (let k = 0; k < 2; k++) for (let s = 0; s < 24; s++) {
    let w = 0; for (let i = 0; i < width; i++) w += profile.hours[k][(s + i) % 24];
    const rate = w / d[k];
    if (!best || rate > best.rate) best = { cls: k, start: s, width, rate, count: w, share: w / Math.max(1, sum(profile.hours[k])) };
  }
  const meanHour = tot / (24 * Math.max(1, (d[0] + d[1]) / 2));
  best.ratio = meanHour ? best.rate / width / meanHour : null;
  return best;
}
/** The quietest `width` hours over all nights, as { start, width }. */
export function quietest(profile, width = 3) {
  const s = series(profile, 'all');
  let best = null;
  for (let a = 0; a < 24; a++) { let w = 0; for (let i = 0; i < width; i++) w += s[(a + i) % 24]; if (!best || w < best.w) best = { start: a, width, w }; }
  return best && { start: best.start, width };
}

/** Which kinds of source make up a window of hours: [{ id, share }] biggest first, from an area's four-hour buckets
 *  (weighted by how much of each bucket the window covers) or a building's group-by-hour counts. */
export function sources(profile, pk) {
  if (!pk) return [];
  const hrs = Array.from({ length: pk.width }, (_, i) => (pk.start + i) % 24);
  let by, ids;
  if (profile.scope === 'building') {
    if (!profile.groupHours) return [];
    by = profile.groupHours.map((row) => sum(hrs.map((h) => row[h] || 0)));
    ids = ['bars', 'street', 'home', 'vehicle', 'build', 'equip'];
  } else {
    const nb = profile.mix[0].length, ng = profile.mix[0][0].length;
    by = Array(ng).fill(0);
    for (const h of hrs) { const b = ((h - 2 + 24) % 24) >> 2; for (let g = 0; g < ng; g++) by[g] += (profile.mix[pk.cls][b][g] || 0) / 4 * 1; }
    ids = profile.groups;
  }
  const t = sum(by);
  return t > 0 ? by.map((v, i) => ({ id: ids[i], share: v / t })).filter((x) => x.share > 0).sort((a, b) => b.share - a.share) : [];
}

/** What the drawer says. { headline, detail, quiet, enough, peak, top } -- "Loudest Fri–Sat 11 pm–2 am: mostly bars, clubs and restaurants." */
export function describe(profile) {
  const tot = profile ? total(profile) : 0;
  if (!profile || tot < 25) return { enough: false, total: tot, headline: 'Too few complaints here to read a pattern by the hour.', detail: '', peak: null, top: [], quiet: null };
  const pk = peak(profile), top = sources(profile, pk).filter((x) => x.share >= 0.15).slice(0, 2);
  const cls = CLASSES[pk.cls].short, when = windowLabel(pk.start, pk.width);
  const flat = pk.ratio != null && pk.ratio < 1.35;
  const what = top.length ? `mostly ${top.map((x) => GROUP_PHRASE[x.id] || x.id).join(' and ')}` : '';
  const q = quietest(profile);
  return {
    enough: true, total: tot, peak: pk, top, quiet: q,
    headline: flat ? 'No clear loud hour: complaints are spread through the day.' : `Loudest ${cls} ${when}${what ? ': ' + what : ''}.`,
    detail: flat ? '' : `${Math.round(pk.ratio * 10) / 10}× an average hour${pk.cls === 1 ? '' : ' of the week'}.`,
    quietLabel: q ? `Quietest ${windowLabel(q.start, q.width)}.` : '',
  };
}

// ------------------------------------------------------------------ the clock
/** SVG of a 24-hour clock (midnight at the top, clockwise): a spoke per hour, longer = more complaints per night; the window
 *  `pk` (loudest hours) is drawn in the accent colour. `values` is series(). Returns the markup of one <svg>. */
export function clockSVG(values, pk, { size = 190, titles = null } = {}) {
  const c = size / 2, r0 = size * 0.2, rmax = size * 0.36, max = Math.max(...values, 1e-9);
  const inWin = (h) => pk && Array.from({ length: pk.width }, (_, i) => (pk.start + i) % 24).includes(h);
  const pt = (h, r) => { const a = ((h + 0.5) / 24) * 2 * Math.PI - Math.PI / 2; return [c + Math.cos(a) * r, c + Math.sin(a) * r]; };
  const spokes = values.map((v, h) => {
    const len = (v / max) ** 0.8 * (rmax - r0), [x1, y1] = pt(h, r0), [x2, y2] = pt(h, r0 + Math.max(len, 1.5));
    return `<line class="nh-sp${inWin(h) ? ' pk' : ''}" x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke-width="${(size * 0.027).toFixed(1)}" stroke-linecap="round"><title>${titles ? titles[h] : hourLabel(h)}</title></line>`;
  }).join('');
  const lab = [[0, '12 am'], [6, '6 am'], [12, '12 pm'], [18, '6 pm']].map(([h, t]) => {
    const a = (h / 24) * 2 * Math.PI - Math.PI / 2, x = c + Math.cos(a) * (rmax + size * 0.075), y = c + Math.sin(a) * (rmax + size * 0.075);
    return `<text class="nh-t" x="${x.toFixed(1)}" y="${(y + 3.5).toFixed(1)}" text-anchor="middle">${t}</text>`;
  }).join('');
  return `<svg class="nh-clock" viewBox="0 0 ${size} ${size}" role="img" aria-label="Complaints by hour of the day, midnight at the top">
    <circle class="nh-ring" cx="${c}" cy="${c}" r="${r0 - 4}"/>${spokes}${lab}
    <text class="nh-c1" x="${c}" y="${c - 1}" text-anchor="middle">${pk ? windowLabel(pk.start, pk.width) : ''}</text>
    <text class="nh-c2" x="${c}" y="${c + 12}" text-anchor="middle">${pk ? 'loudest' : ''}</text></svg>`;
}
