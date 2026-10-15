// Tour day: the pure part. Which homes are on today's route and in what order, the directions link and the hop to the next stop,
// the checklist for one home (built from the renter's criteria and what the listing leaves unknown), how an answer lands in the
// tour findings (findings-model.js owns the schema; nothing here widens it), the phone-microphone noise estimate, and the summary
// card for comparing homes later. No DOM, no storage: `node --test` loads it (tests/js/tourday.test.mjs).
import { toMin, clock12, autoOrder, reconcile, moveStop, leg, stationAccess, bookedMin } from './tour-model.js';
import { normalize, listedValue, COMPASS8, fmtFeet } from './findings-model.js';
import { amenityValue } from '../criteria.js';

export { toMin, clock12, moveStop, reconcile };

// ------------------------------------------------------------------ today's tours
const pad = (n) => String(n).padStart(2, '0');
/** The local calendar day as YYYY-MM-DD. */
export const localDay = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** The tour time of a pick ('YYYY-MM-DDTHH:MM', as the Tours board saves it): its day and minutes after midnight. */
export function tourWhen(tour) {
  const m = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?/.exec(String(tour || ''));
  return m ? { day: m[1], min: m[2] ? toMin(m[2]) : null } : null;
}
/** Listing ids with a tour booked on `day`, earliest first. A pick marked Pass is left out. */
export function toursOn(picks, day, exists = () => true) {
  return Object.entries(picks || {})
    .filter(([id, p]) => p && p.tier !== 'Pass' && exists(id) && tourWhen(p.tour)?.day === day)
    .sort((a, b) => (tourWhen(a[1].tour).min ?? 1e4) - (tourWhen(b[1].tour).min ?? 1e4) || (a[0] < b[0] ? -1 : 1))
    .map(([id]) => id);
}
/** Homes the renter can add to the day: saved or touring picks, not Pass, not already on it. */
export function addable(picks, ids, exists = () => true) {
  const on = new Set(ids);
  return Object.entries(picks || {}).filter(([id, p]) => p && !on.has(id) && p.tier !== 'Pass' && exists(id) && (p.saved || p.tier || p.tour || p.status === 'touring')).map(([id]) => id);
}

/** The saved state of Tour day, cleaned: `picked` (ids the renter added) belongs to one day, `ex` (answers the findings schema has
 *  no field for) and `done` live on. */
export function normalizeState(raw, day) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const ids = (a) => (Array.isArray(a) ? a.filter((x) => typeof x === 'string' && x && x.length <= 120) : []);
  const fresh = r.day === day;
  return {
    day, mode: r.mode === 'near' ? 'near' : 'time',
    picked: fresh ? ids(r.picked) : [], order: fresh ? ids(r.order) : [], removed: fresh ? ids(r.removed) : [],
    done: r.done && typeof r.done === 'object' ? Object.fromEntries(Object.entries(r.done).filter(([k, v]) => typeof k === 'string' && typeof v === 'string')) : {},
    ex: r.ex && typeof r.ex === 'object' ? r.ex : {},
  };
}
/** Everyone on today's route: booked today (unless removed) plus the ones added by hand. */
export const routeIds = (state, booked) => [...booked.filter((id) => !state.removed.includes(id)), ...state.picked.filter((id) => !booked.includes(id))];

/** A home as a stop for tour-model.js: key, place, and the booked time on `day`. */
export function stopOf(L, pick, crit, destName) {
  const D = (crit?.commute?.destinations || []).find((d) => d.name === destName) || (crit?.commute?.destinations || [])[0];
  return { key: L.id, id: L.id, name: L.building || L.address || L.id, unit: L.unit || '', address: L.address || '', lat: L.lat, lon: L.lon,
    access: stationAccess(L.commute?.[D?.name]) ?? undefined, units: [{ id: L.id, label: L.unit || '', tour: pick?.tour || null }], L };
}
/** The order of the route. `time` puts booked homes in time order, then the rest by name; `near` keeps booked homes first and
 *  walks the rest to the nearest next one. A saved order is kept where it still applies. */
export function routeOrder(stops, state) {
  return state.order.length ? reconcile(state.order, stops) : autoOrder(stops, { day: state.day, mode: state.mode });
}
export const autoRoute = (stops, day, mode) => autoOrder(stops, { day, mode });
/** The route as entries: the stop, its booked minute today, and the hop from the previous stop (an estimate, labelled so). */
export function routeLegs(stops, order, day) {
  const by = new Map(stops.map((s) => [s.key, s]));
  let prev = null;
  return order.map((k) => by.get(k)).filter(Boolean).map((s) => {
    const hop = prev ? leg(prev, s) : null, booked = bookedMin(s, day);
    const e = { stop: s, booked, hop: hop && hop.kind !== 'none' ? hop : null, leaveBy: booked != null && hop && hop.kind !== 'none' ? booked - hop.min : null };
    prev = s;
    return e;
  });
}
/** "12 min on foot" / "9 min by transit", always an estimate. */
export const hopText = (hop) => (hop ? `${hop.min} min ${hop.kind === 'transit' ? 'by transit' : 'on foot'}` : '');

// ------------------------------------------------------------------ directions
/** True on iPhone, iPad and iPod (Apple Maps is the one that opens there). */
export const isApple = (ua = '', platform = '', touchPoints = 0) => /iPhone|iPad|iPod/.test(ua) || (/Mac/.test(platform) && touchPoints > 1);
/** A maps link from the address (no API key, nothing sent anywhere until the renter taps it). `kind`: walk, transit or drive.
 *  The start is the phone's own position, which the maps app fills in. */
export function directionsUrl({ address, lat, lon }, { kind = 'walk', apple = false } = {}) {
  const to = String(address || '').trim() || (lat != null && lon != null ? `${lat},${lon}` : '');
  if (!to) return null;
  const q = encodeURIComponent(to);
  if (apple) return `https://maps.apple.com/?daddr=${q}&dirflg=${kind === 'transit' ? 'r' : kind === 'drive' ? 'd' : 'w'}`;
  return `https://www.google.com/maps/dir/?api=1&destination=${q}&travelmode=${kind === 'transit' ? 'transit' : kind === 'drive' ? 'driving' : 'walking'}`;
}

// ------------------------------------------------------------------ the checklist
export const AMENITY_LABEL = {
  in_unit_wd: 'Washer/dryer in the unit', elevator: 'Elevator', doorman: 'Doorman', gym: 'Gym', roof_deck: 'Roof deck', pool: 'Pool', lounge: 'Lounge',
  game_room: 'Game room', dishwasher: 'Dishwasher', pets: 'Pets allowed', laundry: 'Laundry in the building', parking: 'Parking', balcony: 'Balcony',
  outdoor_space: 'Outdoor space', ac: 'Air conditioning', storage: 'Storage',
};
const amenityName = (k) => AMENITY_LABEL[k] || String(k).replaceAll('_', ' ').replace(/^./, (c) => c.toUpperCase());
const ASKS = {
  'unverified:fees': ['fees', 'Ask: monthly fees', 'Amenity, package and other monthly fees. The listing leaves them out.'],
  'unverified:lease_term': ['lease', 'Ask: lease length and free months', 'The lease term is not confirmed, so the concession cannot be priced.'],
  'unverified:price': ['price', 'Ask: is this price current?', 'The price was not read from the unit page or the office.'],
  price_dispute: ['dispute', 'Ask: which price is right?', 'Two sources disagree on the rent.'],
  concession: ['concession', 'Ask: does the free month still apply?', 'The concession may not apply to this lease.'],
  stale: ['avail', 'Ask: is it still available?', 'It was not rechecked recently.'],
};
export const SCALES = {
  light: ['Dark', '', 'OK', '', 'Bright'], noise: ['Silent', '', 'Some', '', 'Loud'], water: ['Weak', '', 'OK', '', 'Strong'],
};

/** The checklist for one home. `core` is the same everywhere (light, noise shut and open, water, signal, W/D, closets), each
 *  with the reason it matters to this renter; `unknowns` are yes/no questions for wanted amenities the listing does not state; `asks`
 *  are questions for the leasing office that the score is unsure about. Items carry `kind`: rate, compass, bars, yn, count or ask. */
export function buildChecklist(L, crit = {}) {
  const W = crit.weights || {}, wt = (dim) => (W[dim] > 0 ? `You weight ${DIM_NAME[dim] || dim} ${Math.round(W[dim])}.` : '');
  const must = new Set(crit.must_have || []), strong = new Set(crit.strongly_prefer || []);
  const listedWd = listedValue(L, 'wd'), expo = Array.isArray(L?.exposure) && L.exposure.length ? L.exposure.join('/') : '';
  const core = [
    { key: 'light', kind: 'rate', scale: SCALES.light, label: 'Light at the window', hint: 'Right now. The time is saved with it.', why: wt('light_view') },
    { key: 'facing', kind: 'compass', label: 'Window faces', hint: `Compass app, back to the room.${expo ? ` Listing: ${expo}.` : ' The listing does not say.'}`, why: wt('light_view') },
    { key: 'noise_shut', kind: 'rate', scale: SCALES.noise, label: 'Noise, windows shut', hint: 'Listen for 10 seconds, or measure it.', meter: 'shut', why: wt('quiet') },
    { key: 'noise_open', kind: 'rate', scale: SCALES.noise, label: 'Noise, windows open', hint: 'Street, neighbours, the building.', meter: 'open', why: wt('quiet') },
    { key: 'water', kind: 'rate', scale: SCALES.water, label: 'Water pressure', hint: 'Run the kitchen and the shower together.', why: '' },
    { key: 'signal', kind: 'bars', label: 'Cell signal', hint: 'Bars on your phone, inside.', why: '' },
    { key: 'wd', kind: 'yn', label: 'Washer/dryer in the unit', hint: listedWd == null ? 'The listing does not say.' : `Listing: ${listedWd ? 'in the unit' : 'not in the unit'}.`,
      why: must.has('in_unit_wd') ? 'A must-have in your criteria.' : strong.has('in_unit_wd') ? 'A strong preference.' : '', yes: 'In the unit', no: 'Not in the unit' },
    { key: 'closets', kind: 'count', label: 'Closets', hint: 'How many, not counting the entry coat closet if it is shared.', unit: '', why: wt('interior') },
  ];
  const unknowns = [], seen = new Set(['in_unit_wd']);
  for (const [list, tier] of [[crit.must_have, 'a must-have'], [crit.strongly_prefer, 'a strong preference'], [crit.nice_to_have, 'nice to have']]) {
    for (const k of list || []) {
      if (seen.has(k)) continue;
      seen.add(k);
      if (amenityValue(k, L?.amenities?.[k]).v != null) continue;
      unknowns.push({ key: `am_${k}`, kind: 'yn', label: `${amenityName(k)}?`, hint: `${tier[0].toUpperCase()}${tier.slice(1)}; the listing does not say.`, why: 'The score counts it as half until you know.', yes: 'Yes', no: 'No' });
    }
  }
  const asks = [], askSeen = new Set();
  for (const g of L?.score?.gates || []) {
    const a = ASKS[g] || ASKS[String(g).split(':')[0]];
    if (a && !askSeen.has(a[0])) { askSeen.add(a[0]); asks.push({ key: `ask_${a[0]}`, kind: 'ask', label: a[1], hint: a[2], why: '' }); }
  }
  return { core, unknowns: unknowns.slice(0, 8), asks };
}
const DIM_NAME = { light_view: 'light and view', quiet: 'quiet', interior: 'interior', amenities: 'amenities', space: 'space' };
export const allItems = (c) => [...c.core, ...c.unknowns, ...c.asks];

// ------------------------------------------------------------------ answers
/** What the renter's answer for `item` is, read from the findings `f` and the extras `ex` (null when not answered). */
export function valueOf(item, f = {}, ex = {}) {
  const n = normalize(f), k = item.key;
  if (k === 'light') return n.light?.rating ?? null;
  if (k === 'facing') return n.light?.facing ?? null;
  if (k === 'noise_shut' || k === 'noise_open') return ex.noise?.[item.meter]?.r ?? null;
  if (k === 'water') return n.water ?? null;
  if (k === 'signal') return n.signal ?? null;
  if (k === 'closets') return n.closets ?? null;
  if (k === 'wd') { const c = n.checks?.wd; return !c ? null : c.verdict === 'differs' && typeof c.observed === 'boolean' ? c.observed : c.verdict === 'match' ? 'match' : null; }
  if (item.kind === 'yn') return typeof ex.yn?.[k] === 'boolean' ? ex.yn[k] : null;
  if (item.kind === 'ask') return !!ex.ask?.[k.slice(4)];
  return null;
}
/** Answered items out of all, for the progress line. */
export function progress(c, f, ex) {
  const items = allItems(c), done = items.filter((i) => { const v = valueOf(i, f, ex); return i.kind === 'ask' ? v === true : v != null; });
  return { done: done.length, total: items.length, core: c.core.filter((i) => valueOf(i, f, ex) != null).length, coreTotal: c.core.length };
}

/** The W/D answer as a findings check: it matches what the listing says, differs from it, or adds to a silent listing. */
export function wdCheck(L, said) {
  const listed = listedValue(L, 'wd');
  if (said === null) return null;
  return listed != null && listed === said ? { verdict: 'match' } : { verdict: 'differs', observed: said };
}
/** The loudest of the two noise answers goes to the findings' single noise rating and dB (the visit sheet has one "noise at the
 *  window"); the split between shut and open stays in the extras. */
export function noiseFindings(ex) {
  const rs = ['shut', 'open'].map((w) => ex.noise?.[w]?.r).filter((x) => x != null), dbs = ['shut', 'open'].map((w) => ex.noise?.[w]?.db).filter((x) => x != null);
  return { rating: rs.length ? Math.max(...rs) : null, db: dbs.length ? Math.max(...dbs) : null };
}
const without = (o, k) => { const c = { ...o }; delete c[k]; return c; };
/** A findings record with `value` applied for the item `key`. Returns the next record (the store normalises it). `ex` is the
 *  extras AFTER this change, for the noise merge. */
export function applyToFindings(f, key, value, { L, ex = {} } = {}) {
  const cur = { ...f };
  if (key === 'light') { const l = { ...(cur.light || {}) }; if (value == null) delete l.rating; else { l.rating = value; if (!l.time) l.time = new Date().toTimeString().slice(0, 5); } cur.light = l; }
  else if (key === 'facing') { const l = { ...(cur.light || {}) }; if (value == null) delete l.facing; else l.facing = value; cur.light = l; }
  else if (key === 'water') { if (value == null) delete cur.water; else cur.water = value; }
  else if (key === 'signal') { if (value == null) delete cur.signal; else cur.signal = value; }
  else if (key === 'closets') { if (value == null) delete cur.closets; else cur.closets = value; }
  else if (key === 'wd') {
    const c = wdCheck(L, value), checks = { ...(cur.checks || {}) };
    if (c) checks.wd = c; else delete checks.wd;
    cur.checks = checks;
    const p = cur.promoted?.wd;   // a promotion rests on the value found: a changed answer withdraws it
    if (p && p.value !== c?.observed) cur.promoted = without(cur.promoted, 'wd');
  } else if (key === 'noise_shut' || key === 'noise_open') {
    const m = noiseFindings(ex), nz = { ...(cur.noise || {}) };
    if (m.rating == null) delete nz.rating; else nz.rating = m.rating;
    if (m.db == null) delete nz.db; else nz.db = m.db;
    cur.noise = nz;
  }
  return cur;
}

// ------------------------------------------------------------------ extras (what the findings schema has no field for)
/** The extras with one answer changed (immutable). Section: 'noise' (value {r?, db?} for `which`), 'yn' or 'ask'. */
export function setExtra(ex = {}, section, key, value) {
  const out = { ...ex };
  if (section === 'noise') {
    const nz = { ...(out.noise || {}) }, cur = { ...(nz[key] || {}), ...value };
    for (const k of Object.keys(cur)) if (cur[k] == null) delete cur[k];
    if (Object.keys(cur).length) nz[key] = cur; else delete nz[key];
    out.noise = nz;
    if (!Object.keys(nz).length) delete out.noise;
  } else {
    const s = { ...(out[section] || {}) };
    if (value == null || value === false && section === 'ask') delete s[key]; else s[key] = value;
    out[section] = s;
    if (!Object.keys(s).length) delete out[section];
  }
  return out;
}

// ------------------------------------------------------------------ the note: the renter's text, then a generated block
export const NOTE_MARK = '— Tour day answers —';
/** Split a findings note into what the renter wrote and the block Tour day keeps up to date after the marker. */
export function splitNote(note) {
  const s = String(note || ''), i = s.indexOf(NOTE_MARK);
  return i < 0 ? { text: s.trim(), block: '' } : { text: s.slice(0, i).trim(), block: s.slice(i + NOTE_MARK.length).trim() };
}
/** The note with `text` as the renter's part and `block` as the generated part (dropped when empty). */
export function joinNote(text, block, max = 4000) {
  const b = block ? `${NOTE_MARK}\n${block}` : '', t = String(text || '').trim();
  return [t.slice(0, Math.max(0, max - b.length - 2)), b].filter(Boolean).join('\n\n');
}
/** The generated lines for the answers that have no findings field. Plain sentences, so the note reads on its own. */
export function noteBlock(c, ex = {}) {
  const lines = [];
  for (const w of ['shut', 'open']) {
    const n = ex.noise?.[w];
    if (n && (n.r != null || n.db != null)) lines.push(`Noise, windows ${w}: ${[n.r != null ? `${n.r} of 5` : null, n.db != null ? `about ${n.db} dB (phone microphone, approximate)` : null].filter(Boolean).join(', ')}.`);
  }
  for (const i of c.unknowns) { const v = ex.yn?.[i.key]; if (typeof v === 'boolean') lines.push(`${i.label.replace(/\?$/, '')}: ${v ? 'yes' : 'no'}.`); }
  const asked = c.asks.filter((i) => ex.ask?.[i.key.slice(4)]).map((i) => i.label.replace(/^Ask: /, ''));
  if (asked.length) lines.push(`Asked the office: ${asked.join('; ')}.`);
  return lines.join('\n');
}

// ------------------------------------------------------------------ the phone microphone
/** Phone microphones are not calibrated. This offset puts a quiet room near 40 dB and speech near 65 dB on a typical phone; the
 *  figure is for comparing homes visited with the same phone, never a meter reading. */
export const MIC_OFFSET_DB = 100;
export const MIC_SECONDS = 10;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
/** One block of samples (-1..1) as a level in dB: RMS in dBFS plus the offset, kept inside 20 to 120. */
export function rmsDb(samples) {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  const rms = samples.length ? Math.sqrt(sum / samples.length) : 0;
  return clamp(20 * Math.log10(Math.max(rms, 1e-5)) + MIC_OFFSET_DB, 20, 120);
}
/** A run of levels as the figures kept: the equivalent level (energy mean), the loudest and the quietest block, in whole dB. */
export function summarizeLevels(levels) {
  const v = (levels || []).filter((x) => Number.isFinite(x));
  if (!v.length) return null;
  const leq = 10 * Math.log10(v.reduce((a, d) => a + 10 ** (d / 10), 0) / v.length);
  return { leq: Math.round(leq), peak: Math.round(Math.max(...v)), quiet: Math.round(Math.min(...v)), n: v.length };
}
/** The level in words, for the result line. */
export const noiseWord = (db) => (db < 35 ? 'very quiet' : db < 45 ? 'quiet' : db < 55 ? 'moderate' : db < 65 ? 'busy' : 'loud');
/** The 1 to 5 rating a level suggests (a starting point the renter can change). */
export const suggestRating = (db) => (db < 35 ? 1 : db < 45 ? 2 : db < 55 ? 3 : db < 65 ? 4 : 5);

// ------------------------------------------------------------------ the summary card
const tone = {
  high: (v) => (v >= 4 ? 'good' : v <= 2 ? 'bad' : 'warn'), low: (v) => (v <= 2 ? 'good' : v >= 4 ? 'bad' : 'warn'),
};
/** The card for comparing homes later: short labelled values with a tone, from the findings and the extras. */
export function summaryChips(L, f = {}, ex = {}, c = null) {
  const n = normalize(f), chips = [], add = (k, v, t = '') => chips.push({ k, v, tone: t });
  if (n.light?.rating != null || n.light?.facing) add('Light', [n.light.rating != null ? `${n.light.rating} of 5` : null, n.light.facing ? `faces ${n.light.facing}` : null].filter(Boolean).join(', '), n.light.rating != null ? tone.high(n.light.rating) : '');
  for (const w of ['shut', 'open']) {
    const x = ex.noise?.[w];
    if (x && (x.r != null || x.db != null)) add(`Noise, windows ${w}`, [x.r != null ? `${x.r} of 5` : null, x.db != null ? `~${x.db} dB` : null].filter(Boolean).join(', '), x.r != null ? tone.low(x.r) : x.db != null ? tone.low(suggestRating(x.db)) : '');
  }
  if (n.water != null) add('Water pressure', `${n.water} of 5`, tone.high(n.water));
  if (n.signal != null) add('Cell signal', `${n.signal} bar${n.signal === 1 ? '' : 's'}`, n.signal >= 3 ? 'good' : n.signal === 2 ? 'warn' : 'bad');
  const wd = n.checks?.wd;
  if (wd) add('Washer/dryer', wd.verdict === 'match' ? 'in the unit, as listed' : wd.verdict === 'differs' && typeof wd.observed === 'boolean' ? (wd.observed ? 'in the unit' : 'not in the unit') : 'not sure', wd.verdict === 'differs' && wd.observed === false ? 'bad' : wd.verdict === 'unsure' ? 'warn' : 'good');
  if (n.closets != null) add('Closets', String(n.closets));
  if (n.ceiling != null) add('Ceiling', fmtFeet(n.ceiling));
  for (const i of c?.unknowns || []) { const v = ex.yn?.[i.key]; if (typeof v === 'boolean') add(i.label.replace(/\?$/, ''), v ? 'yes' : 'no', v ? 'good' : 'warn'); }
  return chips;
}
/** Questions still open for the card: unanswered asks and unknowns. */
export function openQuestions(c, f, ex) {
  return [...c.asks.filter((i) => !ex.ask?.[i.key.slice(4)]).map((i) => i.label.replace(/^Ask: (.)/, (_, c0) => `ask ${c0.toLowerCase()}`).replace(/\?$/, '')),
    ...c.unknowns.filter((i) => valueOf(i, f, ex) == null).map((i) => i.label.replace(/\?$/, ''))];
}
/** The summary as text to paste into a message or a note. */
export function summaryText(name, chips, { note = '', photos = 0, open = [] } = {}) {
  const lines = [name, ...chips.map((x) => `- ${x.k}: ${x.v}`)];
  if (photos) lines.push(`- Photos: ${photos}`);
  if (note) lines.push(`- Note: ${note.length > 240 ? note.slice(0, 239) + '…' : note}`);
  if (open.length) lines.push(`- Still to find out: ${open.join('; ')}`);
  return lines.join('\n');
}
export { COMPASS8 };
