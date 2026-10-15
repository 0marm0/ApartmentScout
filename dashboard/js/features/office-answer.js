// "Mark answered": what to do with a reply pasted from the leasing office. Pure functions, no DOM and no storage.
//
//   proposeChanges(topic, text, day)  the field updates the reply seems to state, for the renter to confirm or edit
//   noteLine(...)                     the dated, sourced line kept in the renter's notes for the unit
//   updateEntry(...) / updatesDoc(...) a unit update in the `apartmentscout-updates/1` shape, ready for
//                                     `apartmentscout handoff import updates.json --dry-run` (the importer appends it as a
//                                     dated, sourced claim and keeps any disagreement for the renter to see)
//
// The dashboard has no editor for rent, fees or size of its own, so a confirmed reply is kept as a note and, when it states
// a value, as an updates.json entry. Nothing is changed in listings.json by this page.

export const HOW = [['email', 'Email'], ['phone', 'Phone call'], ['in_person', 'In person'], ['portal', 'Portal or chat']];
export const HOW_LABEL = Object.fromEntries(HOW);
export const UPDATES_SCHEMA = 'apartmentscout-updates/1';

const WORD = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, half: 0.5 };
const COMPASS = { north: 'N', south: 'S', east: 'E', west: 'W' };
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const toNum = (s) => Number(String(s).replace(/,/g, ''));
const count = (s) => (s == null ? null : WORD[String(s).toLowerCase()] ?? toNum(s));
const dollars = (t) => [...t.matchAll(/\$\s?(\d[\d,]*(?:\.\d+)?)/g)].map((m) => toNum(m[1]));

/** Free months stated in a reply: "1 month free", "two months of rent free", "a free month", "1.5 free months". */
export function freeMonths(t) {
  let m = /(\d+(?:\.\d+)?|a|an|one|two|three|four)\s+(?:and a half\s+)?(?:free\s+months?|months?\s+(?:of\s+rent\s+)?free)/i.exec(t);
  if (!m) return null;
  let n = count(m[1]);
  if (/and a half/i.test(m[0])) n += 0.5;
  return Number.isFinite(n) ? n : null;
}
/** The lease length stated: "10-month lease", "lease of 12 months", "12 month term". */
export function leaseMonths(t) {
  const m = /(\d{1,2})[\s-]*months?\s+(?:lease|term)\b/i.exec(t) || /\blease\s+(?:term\s+)?(?:of|for)\s+(\d{1,2})\s+months?/i.exec(t) || /\bon\s+a\s+(\d{1,2})[\s-]*months?\b(?!\s+free)/i.exec(t);
  return m ? toNum(m[1]) : null;
}
/** A date like "October 15", "Oct 15, 2026", "2026-10-15" or "10/15" as YYYY-MM-DD, the year taken from `day` (the date of the reply). */
export function dateIn(t, day) {
  const yr = Number(String(day).slice(0, 4)), iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(t);
  if (iso) return iso[0];
  let m = new RegExp(`\\b(${MONTHS.map((x) => x.slice(0, 3)).join('|')})[a-z]*\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`, 'i').exec(t), mo, d, y;
  if (m) { mo = MONTHS.findIndex((x) => x.startsWith(m[1].toLowerCase())) + 1; d = +m[2]; y = m[3] ? +m[3] : yr; }
  else if ((m = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(t))) { mo = +m[1]; d = +m[2]; y = m[3] ? (+m[3] < 100 ? 2000 + +m[3] : +m[3]) : yr; }
  else return null;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const p = (n) => String(n).padStart(2, '0');
  return `${y}-${p(mo)}-${p(d)}`;
}
function yesNo(t) {
  const neg = /\b(no|not|isn't|is not|doesn't|does not|don't|without|none|shared|common|unavailable)\b/i.test(t);
  const pos = /\b(yes|yep|yeah|has|have|there is|there's|included|in[- ]unit|in the unit|inside the unit|available|allowed)\b/i.test(t);
  return neg === pos ? null : pos;
}
function compass(t) {
  const m = /\b(north|south)(?:[\s-]*(east|west))?\b|\b(east|west)\b/i.exec(t);
  if (!m) return null;
  return m[3] ? COMPASS[m[3].toLowerCase()] : COMPASS[m[1].toLowerCase()] + (m[2] ? COMPASS[m[2].toLowerCase()] : '');
}

/** What a reply seems to say about the fields a question informs: [{ path, value, label }]. Empty when nothing is clear: the
 *  renter's note still keeps the whole reply. Every value is a suggestion for the renter to confirm or edit. */
export function proposeChanges(topic, text, day = '') {
  const t = String(text || ''), out = [];
  const add = (path, value, label) => { if (value != null && value !== '' && !(typeof value === 'number' && !Number.isFinite(value))) out.push({ path, value, label }); };
  const base = String(topic).split(':')[0], key = String(topic).includes(':') ? String(topic).split(':')[1] : null;
  if (base === 'price' || base === 'concession') {
    const rent = dollars(t).find((x) => x >= 500);
    if (base === 'price') add('price.gross', rent, 'Rent per month');
    add('price.free_months', freeMonths(t) ?? (/\b(no|zero)\s+(?:free\s+months?|concession)/i.test(t) ? 0 : null), 'Free months');
    add('price.lease_months', leaseMonths(t), 'Lease length in months');
  } else if (base === 'fees') {
    const amounts = dollars(t).filter((x) => x < 500);
    if (amounts.length) add('price.fees_monthly', Math.round(amounts.reduce((a, b) => a + b, 0) * 100) / 100, amounts.length > 1 ? `Monthly fees (${amounts.length} amounts added up)` : 'Monthly fees');
    else if (/\b(no|zero|none)\b[^.]*\bfees?\b/i.test(t)) add('price.fees_monthly', 0, 'Monthly fees');
  } else if (base === 'size') {
    const m = /(\d{3,5})\s*(?:sq\.?\s?ft\.?|sqft|sf\b|square\s+f(?:ee|oo)t|ft²|ft2)/i.exec(t);
    add('sqft', m ? toNum(m[1]) : null, 'Square feet');
  } else if (base === 'floor') {
    const m = /(\d{1,3})(?:st|nd|rd|th)\s+floor/i.exec(t) || /\bfloor\s*(?:number\s*)?(\d{1,3})\b/i.exec(t);
    add('floor', m ? toNum(m[1]) : null, 'Floor');
  } else if (base === 'exposure') {
    const c = compass(t);
    add('exposure', c ? [c] : null, 'Window direction');
  } else if (base === 'in_unit_wd') {
    add('amenities.in_unit_wd', yesNo(t), 'In-unit washer/dryer');
  } else if (base === 'amenity' && key === 'doorman') {
    const m = /\b(full[- ]time|24[\s/-]?7|part[- ]time|virtual|no doorman|none)\b/i.exec(t);
    const v = m ? (/full|24/i.test(m[1]) ? 'full-time' : /part/i.test(m[1]) ? 'part-time' : /virtual/i.test(m[1]) ? 'virtual' : 'none') : null;
    add('amenities.doorman', v, 'Doorman');
  } else if (base === 'amenity' && key) {
    add(`amenities.${key}`, yesNo(t), key.replace(/_/g, ' '));
  } else if (base === 'start' || base === 'availability') {
    add('available', dateIn(t, day), 'Available from');
  }
  return out;
}

const clip = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

/** The line added to the unit's notes. */
export const noteLine = ({ day, how, topic, text }) => `Leasing office reply, ${day} (${(HOW_LABEL[how] || 'reply').toLowerCase()}), re ${String(topic).split(':').at(-1).replace(/_/g, ' ')}: ${clip(text, 1500)}`;

/** The unit-update record for `apartmentscout handoff import`: values the renter confirmed, with a source and a date. */
export function updateEntry({ unit_id, day, how, changes, text }) {
  const o = {};
  for (const c of changes) o[c.path] = c.value;
  return {
    id: unit_id, checked_at: day, source: `leasing office reply (${(HOW_LABEL[how] || 'reply').toLowerCase()}), ${day}`,
    changes: o, note: clip(text, 600),
  };
}
export const updatesDoc = (entries, day) => ({ schema: UPDATES_SCHEMA, from: 'renter', generated_at: day, unit_updates: entries });
