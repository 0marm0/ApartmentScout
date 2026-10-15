// Tour findings: the pure part. What the renter observes while standing in a home (tape-measured rooms, ceiling height,
// water pressure, noise at the window, cell signal, closets, laundry, smells, light with a compass direction, the view,
// and whether the listing's claims about W/D, doorman, size and exposure hold) is kept BESIDE the listing's facts and
// never overwrites them. The renter can promote a differing finding to a fact: that writes a dated, sourced claim (kept
// in `promoted`) and only then does scoring read it. Until then a contradiction is surfaced as a gate, a tag and a line
// in the reasons, with no change to any score.
//
// apartmentscout/tours.py does the same job for `apartmentscout score` and `apartmentscout share`; tests/test_tours.py
// feeds both the same cases and compares. No DOM, no storage and nothing but criteria.js imported, so `node --test` can
// load it.
import { amenityValue } from '../criteria.js';

export const VERSION = 1;
export const COMPASS8 = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export const COMPASS16 = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export const LEVELS = ['full-time', 'part-time', 'virtual', 'none'];
export const LAUNDRY = [['in_unit', 'In the unit'], ['on_floor', 'On the floor'], ['building', 'In the building'], ['none', 'None']];
export const SMELLS = [['none', 'Nothing odd'], ['smoke', 'Smoke'], ['damp', 'Damp or mildew'], ['pets', 'Pets'], ['cooking', 'Cooking'], ['sewage', 'Drains'], ['chemical', 'Paint or chemicals']];
export const TAG = 'differs on tour';
export const SOURCE = 'renter, observed on a tour';
export const MAX = { rooms: 12, photos: 40, view: 400, note: 4000, caption: 120, name: 40 };

/** The four listing claims a visit can check, in display order. `field` is the listing field the claim is about. */
export const CHECKS = {
  wd: { field: 'in_unit_wd', path: 'amenities.in_unit_wd', label: 'Washer/dryer in the unit', dim: 'amenities' },
  doorman: { field: 'doorman', path: 'amenities.doorman', label: 'Doorman', dim: 'amenities' },
  size: { field: 'sqft', path: 'sqft', label: 'Size', dim: 'space' },
  exposure: { field: 'exposure', path: 'exposure', label: 'Which way the windows face', dim: 'light_view' },
};
export const CHECK_KEYS = Object.keys(CHECKS);
const VERDICTS = ['match', 'differs', 'unsure'];

// ------------------------------------------------------------------ small helpers
const rnd = (x, d) => { const f = 10 ** d; return Math.floor(x * f + 0.5) / f; };
const isObj = (o) => o != null && typeof o === 'object' && !Array.isArray(o);
// eslint-disable-next-line no-control-regex
const CTRL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const text = (v, n) => { if (typeof v !== 'string') return null; const t = v.replace(CTRL, '').trim(); return t ? t.slice(0, n) : null; };
const flt = (v, lo, hi, d) => { const x = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN; return Number.isFinite(x) && x > lo && x <= hi ? rnd(x, d) : null; };
const int = (v, lo, hi) => { const x = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN; return Number.isInteger(x) && x >= lo && x <= hi ? x : null; };
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const date = (v) => { if (typeof v !== 'string' || !DATE_RE.test(v)) return null; const d = new Date(v + 'T00:00:00Z'); return !isNaN(d) && d.toISOString().slice(0, 10) === v ? v : null; };
const dateTime = (v) => { const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(typeof v === 'string' ? v : ''); return m && date(m[1]) && +m[2] < 24 && +m[3] < 60 ? `${m[1]}T${m[2]}:${m[3]}` : null; };
const clock = (v) => { const m = /^(\d{2}):(\d{2})$/.exec(typeof v === 'string' ? v : ''); return m && +m[1] < 24 && +m[2] < 60 ? v : null; };
const stamp = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z?$/.test(v) && v.length <= 32 ? v : null);
const ID_RE = /^[a-z0-9]{6,32}$/;
const sizeOf = (v) => flt(v, 0, 20000, 0);

/** A value for one check, validated for its kind (or null). */
export function checkValue(key, v) {
  if (key === 'wd') return typeof v === 'boolean' ? v : null;
  if (key === 'doorman') return LEVELS.includes(v) ? v : null;
  if (key === 'size') return sizeOf(v);
  if (key === 'exposure') { const t = typeof v === 'string' ? v.toUpperCase() : ''; return COMPASS16.includes(t) ? t : null; }
  return null;
}

/** Feet from what a thumb types: 11.5, 11'6", 11-6, 11ft 6in, 3.4 m. Null when it is not a length. */
export function parseFeet(s) {
  const t = String(s ?? '').trim().toLowerCase().replace(/[′’]/g, "'").replace(/[″”]/g, '"');
  if (!t) return null;
  let m = /^(\d+(?:\.\d+)?)\s*m(?:eters?|etres?)?$/.exec(t);
  if (m) return rnd(+m[1] * 3.28084, 2);
  m = /^(\d+)\s*(?:'|ft|feet|-)\s*(\d+(?:\.\d+)?)?\s*(?:"|in|inch(?:es)?)?$/.exec(t);
  if (m) return rnd(+m[1] + (m[2] ? +m[2] / 12 : 0), 2);
  m = /^(\d+(?:\.\d+)?)\s*(?:'|ft|feet)?$/.exec(t);
  return m ? rnd(+m[1], 2) : null;
}
/** 11.5 as 11' 6" for people. */
export function fmtFeet(x) {
  if (x == null || !Number.isFinite(+x)) return '';
  let ft = Math.floor(+x), inch = Math.round((+x - ft) * 12);
  if (inch === 12) { ft += 1; inch = 0; }
  return inch ? `${ft}' ${inch}"` : `${ft}'`;
}

// ------------------------------------------------------------------ normalise
/** A findings record cleaned to the schema (unknown keys dropped, numbers clamped, empty groups left out). Anything the
 *  renter typed is data, never markup. */
export function normalize(raw) {
  const f = isObj(raw) ? raw : {};
  const out = { v: VERSION };
  const put = (k, v) => { if (v != null && !(Array.isArray(v) && !v.length) && !(isObj(v) && !Object.keys(v).length)) out[k] = v; };
  put('observed', date(f.observed));
  put('visited_at', dateTime(f.visited_at));
  put('updated', stamp(f.updated));
  put('rooms', (Array.isArray(f.rooms) ? f.rooms : []).slice(0, MAX.rooms * 4).filter(isObj).map((r) => ({ name: text(r.name, MAX.name), w: flt(r.w, 0, 200, 2), l: flt(r.l, 0, 200, 2) })).filter((r) => r.name)
    .map((r) => Object.fromEntries(Object.entries(r).filter(([, v]) => v != null))).slice(0, MAX.rooms));
  put('ceiling', flt(f.ceiling, 0, 30, 2));
  put('water', int(f.water, 1, 5));
  const nz = isObj(f.noise) ? f.noise : {}, noise = {};
  if (int(nz.rating, 1, 5) != null) noise.rating = int(nz.rating, 1, 5);
  if (flt(nz.db, 20, 140, 1) != null) noise.db = flt(nz.db, 20, 140, 1);
  put('noise', noise);
  put('signal', int(f.signal, 0, 4));
  put('closets', int(f.closets, 0, 30));
  put('laundry', LAUNDRY.some(([k]) => k === f.laundry) ? f.laundry : null);
  let sm = SMELLS.map(([k]) => k).filter((k) => Array.isArray(f.smells) && f.smells.includes(k));
  if (sm.length > 1) sm = sm.filter((k) => k !== 'none');
  put('smells', sm);
  const lt = isObj(f.light) ? f.light : {}, light = {};
  if (int(lt.rating, 1, 5) != null) light.rating = int(lt.rating, 1, 5);
  if (clock(lt.time)) light.time = lt.time;
  if (COMPASS8.includes(lt.facing)) light.facing = lt.facing;
  put('light', light);
  put('view', text(f.view, MAX.view));
  const checks = {};
  for (const key of CHECK_KEYS) {
    const c = isObj(f.checks) && isObj(f.checks[key]) ? f.checks[key] : null;
    if (!c || !VERDICTS.includes(c.verdict)) continue;
    const e = { verdict: c.verdict }, ov = c.verdict === 'differs' ? checkValue(key, c.observed) : null;
    if (ov != null) e.observed = ov;
    checks[key] = e;
  }
  put('checks', checks);
  put('note', text(f.note, MAX.note));
  const seen = new Set(), photos = [];
  for (const p of Array.isArray(f.photos) ? f.photos : []) {
    if (!isObj(p) || typeof p.id !== 'string' || !ID_RE.test(p.id) || seen.has(p.id) || photos.length >= MAX.photos) continue;
    seen.add(p.id);
    const e = { id: p.id, store: p.store === 'idb' ? 'idb' : 'disk' };
    for (const [k, v] of [['w', int(p.w, 1, 20000)], ['h', int(p.h, 1, 20000)], ['bytes', int(p.bytes, 0, 1e9)], ['caption', text(p.caption, MAX.caption)], ['at', stamp(p.at)]]) if (v != null) e[k] = v;
    photos.push(e);
  }
  put('photos', photos);
  const promoted = {};
  for (const key of CHECK_KEYS) {
    const p = isObj(f.promoted) && isObj(f.promoted[key]) ? f.promoted[key] : null, v = p ? checkValue(key, p.value) : null;
    if (!p || v == null) continue;
    const e = { value: v };
    for (const [k, x] of [['observed_at', date(p.observed_at)], ['promoted_at', stamp(p.promoted_at)], ['source', text(p.source, 120)]]) if (x != null) e[k] = x;
    promoted[key] = e;
  }
  put('promoted', promoted);
  return out;
}

/** How much of the checklist is filled, for a progress line. */
export function progress(f) {
  const n = normalize(f), has = [n.rooms?.some((r) => r.w && r.l), n.ceiling != null, n.water != null, n.noise?.rating != null, n.signal != null, n.closets != null, !!n.laundry, !!n.smells?.length, n.light?.rating != null || !!n.light?.facing, !!n.view,
    ...CHECK_KEYS.map((k) => !!n.checks?.[k])];
  return { done: has.filter(Boolean).length, total: has.length, photos: n.photos?.length || 0, note: !!n.note };
}
/** True when a record holds nothing the renter entered. */
export const isBlank = (f) => { const n = normalize(f); return !Object.keys(n).some((k) => !['v', 'observed', 'visited_at', 'updated'].includes(k)); };
export const roomArea = (r) => (r && r.w && r.l ? rnd(r.w * r.l, 0) : null);
export const totalArea = (f) => { const a = (normalize(f).rooms || []).map(roomArea).filter((x) => x != null); return a.length ? a.reduce((x, y) => x + y, 0) : null; };

// ------------------------------------------------------------------ the listing's claim and the renter's finding
const bearing = (c) => COMPASS16.indexOf(c) * 22.5;
const arc = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
const SIZE_TOLERANCE = 0.02;

/** What the listing says about one checked item (a normalised value), or null when it says nothing. */
export function listedValue(L, key) {
  if (key === 'wd') { const v = amenityValue('in_unit_wd', L?.amenities?.in_unit_wd).v; return typeof v === 'boolean' ? v : null; }
  if (key === 'doorman') { const v = amenityValue('doorman', L?.amenities?.doorman).v; return LEVELS.includes(v) ? v : null; }
  if (key === 'size') return typeof L?.sqft === 'number' && Number.isFinite(L.sqft) && L.sqft > 0 ? L.sqft : null;
  if (key === 'exposure') { const e = (Array.isArray(L?.exposure) ? L.exposure : []).map((x) => String(x).toUpperCase()).filter((x) => COMPASS16.includes(x)); return e.length ? e : null; }
  return null;
}
const same = (key, listed, obs) => {
  if (key === 'size') return Math.abs(obs - listed) / listed <= SIZE_TOLERANCE;
  if (key === 'exposure') return listed.some((e) => arc(bearing(e), bearing(obs)) <= 45);
  return listed === obs;
};
/** How the renter's check compares with the listing: kind is 'matches', 'contradicts' (the listing says otherwise),
 *  'adds' (the listing is silent), 'unsure' or 'none' (nothing usable was entered). */
export function assess(L, key, check) {
  const listed = listedValue(L, key);
  if (!check || !VERDICTS.includes(check.verdict)) return { kind: 'none', listed, observed: null };
  if (check.verdict === 'unsure') return { kind: 'unsure', listed, observed: null };
  if (check.verdict === 'match') return listed == null ? { kind: 'none', listed, observed: null } : { kind: 'matches', listed, observed: listed };
  const obs = checkValue(key, check.observed);
  if (obs == null) return { kind: 'none', listed, observed: null };
  if (listed == null) return { kind: 'adds', listed, observed: obs };
  return { kind: same(key, listed, obs) ? 'matches' : 'contradicts', listed, observed: obs };
}

/** A fact in words, the same in the dashboard, the reasons and the memo. */
export function phrase(key, v) {
  if (v == null) return 'not stated';
  if (key === 'wd') return v ? 'in-unit washer/dryer' : 'no in-unit washer/dryer';
  if (key === 'doorman') return `doorman: ${v}`;
  if (key === 'size') return `${Math.round(v)} ft²`;
  return `faces ${[].concat(v).join('/')}`;
}

/** The promotions that still stand: a promoted value counts only while the renter's check still says the same. */
export function livePromotions(f) {
  const n = normalize(f), out = {};
  for (const key of CHECK_KEYS) {
    const p = n.promoted?.[key], c = n.checks?.[key];
    if (p && c?.verdict === 'differs' && c.observed === p.value) out[key] = p.value;
  }
  return out;
}

/** The listing as scoring should see it: promoted facts applied to a copy; the original is never touched. */
export function overlay(L, f) {
  const live = livePromotions(f);
  if (!Object.keys(live).length) return L;
  const out = { ...L, amenities: { ...(L.amenities || {}) } };
  if ('wd' in live) out.amenities.in_unit_wd = live.wd;
  if ('doorman' in live) out.amenities.doorman = live.doorman;
  if ('size' in live) { out.sqft = live.size; delete out.size; delete out.sqft_basis; delete out.sqft_estimate; delete out.sqft_range; }
  if ('exposure' in live) { out.exposure = [live.exposure]; out.exposure_source = 'tour'; }
  return out;
}
/** The dated, sourced claim a promotion writes (the same shape as a listing's `claims[]` entries). */
export function claimOf(key, f) {
  const p = normalize(f).promoted?.[key];
  if (!p) return null;
  const v = key === 'exposure' ? [p.value] : p.value;
  return { field: CHECKS[key].path, value: v, source: p.source || SOURCE, observed_at: p.observed_at || null, status: 'live', via: 'tour' };
}
/** Promote the finding for `key` (it must differ from, or add to, what the listing says). Returns a new record, or the
 *  same one when there is nothing to promote. */
export function promote(L, f, key, now) {
  const n = normalize(f), a = assess(L, key, n.checks?.[key]);
  if (!['contradicts', 'adds'].includes(a.kind)) return n;
  return normalize({ ...n, promoted: { ...(n.promoted || {}), [key]: { value: a.observed, observed_at: n.observed || null, promoted_at: now, source: SOURCE } } });
}
export function unpromote(f, key) {
  const n = normalize(f);
  if (!n.promoted?.[key]) return n;
  const p = { ...n.promoted }; delete p[key];
  return normalize({ ...n, promoted: p });
}

// ------------------------------------------------------------------ gates, tags and reasons (scoring's side of it)
/** What a visit adds to a listing's score without changing a number: `gates` and `tags` for the contradictions the renter
 *  has not promoted, and `items` (lines for the reasons, by dimension). `L` is the listing as published, before any
 *  promoted fact is applied. A promoted fact is read by scoring itself (see overlay()); here it only gets a line. */
export function flagsFor(L, f) {
  const n = normalize(f), live = livePromotions(n), out = { gates: [], tags: [], items: {}, promoted: [] };
  const when = n.observed || 'an undated visit';
  for (const key of CHECK_KEYS) {
    const a = assess(L, key, n.checks?.[key]), c = CHECKS[key], line = [];
    if (key in live) {
      out.promoted.push(key);
      line.push(`tour ${when}: ${phrase(key, a.observed ?? live[key])} observed and promoted to a fact (${a.listed == null ? 'the listing was silent' : 'the listing said ' + phrase(key, a.listed)}).`);
    } else if (a.kind === 'contradicts') {
      out.gates.push(`contradicted:${c.field}`);
      line.push(`tour ${when}: ${phrase(key, a.observed)} observed, the listing says ${phrase(key, a.listed)}. Not scored until you promote it.`);
    } else if (a.kind === 'adds') {
      line.push(`tour ${when}: ${phrase(key, a.observed)} observed (the listing is silent). Not scored until you promote it.`);
    }
    if (line.length) (out.items[c.dim] ||= []).push(...line);
  }
  if (out.gates.length) out.tags.push(TAG);
  return out;
}
export const isTourItem = (s) => typeof s === 'string' && s.startsWith('tour ');
export const isTourGate = (g) => typeof g === 'string' && g.startsWith('contradicted:');
/** A score with the visit's gates, tag and reason lines applied (and any earlier ones replaced). Pure: returns a copy. */
export function annotateScore(score, fl) {
  const s = JSON.parse(JSON.stringify(score || {}));
  s.gates = [...(s.gates || []).filter((g) => !isTourGate(g)), ...(fl?.gates || [])];
  const tags = (s.tags || []).filter((t) => t !== TAG);
  s.tags = [...tags, ...(fl?.tags || [])];
  if (Array.isArray(s.reasons)) {
    s.reasons = s.reasons.map((r) => {
      const items = [...(r.items || []).filter((x) => !isTourItem(x)), ...(fl?.items?.[r.dim] || [])];
      const { items: _drop, ...rest } = r;
      return items.length ? { ...rest, items } : rest;
    });
  }
  return s;
}

// ------------------------------------------------------------------ the memo and the share page
/** A visit as the shared page shows it. `listing` is the listing as published (so "the listing said" stays true after a
 *  promotion). The free note travels only with the renter's notes; photos are attached by the adapter. */
export function shareTour(L, f, { notes = false } = {}) {
  const n = normalize(f), live = livePromotions(n);
  if (isBlank(n)) return null;
  const out = {};
  for (const k of ['observed', 'visited_at']) if (n[k]) out[k] = n[k];
  for (const k of ['rooms', 'ceiling', 'water', 'noise', 'signal', 'closets', 'laundry', 'smells', 'light', 'view']) if (n[k] != null) out[k] = n[k];
  const checks = [];
  for (const key of CHECK_KEYS) {
    const c = n.checks?.[key]; if (!c) continue;
    const a = assess(L, key, c);
    checks.push({ key, label: CHECKS[key].label, verdict: c.verdict, kind: a.kind, listed: a.listed == null ? null : phrase(key, a.listed), observed: a.kind === 'matches' && c.verdict === 'match' ? null : a.observed == null ? null : phrase(key, a.observed), promoted: key in live });
  }
  if (checks.length) out.checks = checks;
  if (notes && n.note) out.note = n.note.slice(0, 2000);
  return out;
}
