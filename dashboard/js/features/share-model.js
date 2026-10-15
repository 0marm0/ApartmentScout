// Share shortlist and decision memo: the pure part. It turns the renter's saved picks into the payload that
// dashboard/share/snapshot.html draws, and writes the finished file. apartmentscout/share.py does the same job for
// `apartmentscout share`; both read the field list from the template's own as-schema block, and a parity test builds
// the same payload with each and compares them. No DOM and no imports, so `node --test` can load it.

const SCHEMA_RE = /<script type="application\/json" id="as-schema">\s*([\s\S]*?)\s*<\/script>/;
const DATA_RE = /(<script type="application\/json" id="as-data">)null(<\/script>)/;
export const TIERS = ['S', 'A', 'B', 'C', 'Pass'];
const DEFAULT_DIMS = [['cost', 'Cost'], ['space', 'Space'], ['commute', 'Commute'], ['amenities', 'Amenities'], ['light_view', 'Light & view'], ['building', 'Building'], ['interior', 'Interior'], ['quiet', 'Quiet']];
export const SOURCE = 'Made with ApartmentScout (dashboard)';

const num = (v) => { const x = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN; return Number.isFinite(x) ? x : null; };
const isObj = (o) => o != null && typeof o === 'object' && !Array.isArray(o);
const cut = (s, n) => (typeof s === 'string' && s.length > n ? s.slice(0, Math.max(0, n - 1)).trimEnd() + '\u2026' : s);
const empty = (v) => v == null || (Array.isArray(v) && !v.length) || (isObj(v) && !Object.keys(v).length);

// ------------------------------------------------------------------ template and schema
export function parseSchema(template) {
  const m = SCHEMA_RE.exec(template);
  if (!m) throw new Error('the share template has no as-schema block');
  return JSON.parse(m[1]);
}
/** The template with the payload in its as-data block ('</' and the line separators escaped so it cannot end the tag). */
export function inlinePayload(template, payload) {
  const blob = JSON.stringify(payload).replaceAll('</', '<\\/').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');
  if (!DATA_RE.test(template)) throw new Error('the share template has no empty as-data block');
  return template.replace(DATA_RE, (_, a, b) => a + blob + b);
}

// ------------------------------------------------------------------ pruning
export function pickKeys(obj, keys) {
  const out = {};
  if (!isObj(obj)) return out;
  for (const k of keys) if (k in obj && obj[k] != null) out[k] = obj[k];
  return out;
}
/** Round floats the way share.py does: coordinates and small numbers to 5 decimals, big ones to 2. */
export function tidy(v) {
  if (typeof v === 'number' && !Number.isInteger(v)) return Math.abs(v) < 1000 ? Math.round(v * 1e5) / 1e5 : Math.round(v * 100) / 100;
  if (Array.isArray(v)) return v.map(tidy);
  if (isObj(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, tidy(x)]));
  return v;
}
export function pruneCommute(entry, schema) {
  if (!isObj(entry)) return null;
  const out = pickKeys(entry, schema.commute.filter((k) => k !== 'modes')), modes = {};
  for (const mode of schema.commute_modes) {
    const m = entry.modes?.[mode];
    if (!isObj(m)) continue;
    const mm = pickKeys(m, schema.commute_mode.filter((k) => k !== 'legs'));
    if (Array.isArray(m.legs)) mm.legs = m.legs.filter(isObj).map((l) => pickKeys(l, schema.commute_leg));
    modes[mode] = mm;
  }
  if (Object.keys(modes).length) out.modes = modes;
  return Object.keys(out).length ? out : null;
}
/** One listing reduced to the schema's fields (nested fields too). `pick` is the renter's { tier, note }. */
export function pruneHome(L, schema, destName, pick, includeNotes) {
  const tm = schema.text_max;
  const h = pickKeys(L, schema.listing);
  for (const k of ['price', 'score', 'size', 'site', 'records', 'reviews', 'photo_review', 'building_facts', 'links']) if (k in h) h[k] = pickKeys(h[k], schema[k]);
  h.notes = h.notes ? cut(h.notes, tm.notes) : null;
  if (h.reviews) { h.reviews.summary = cut(h.reviews.summary, tm.summary); h.reviews.questions = cut(h.reviews.questions, tm.questions); }
  if (h.photo_review?.evidence) h.photo_review.evidence = cut(h.photo_review.evidence, tm.evidence);
  if (h.records?.flags) h.records.flags = h.records.flags.slice(0, 5).map((f) => cut(f, tm.flag));
  if (h.links) h.links = Object.fromEntries(Object.entries(h.links).filter(([, v]) => typeof v === 'string' && /^https?:\/\//.test(v)));
  const c = destName ? pruneCommute(L.commute?.[destName], schema) : null;
  if (c) h.commute = c;
  const p = {};
  if (pick) {
    if (TIERS.includes(pick.tier)) p.tier = pick.tier;
    if (includeNotes && pick.note) p.note = cut(String(pick.note), tm.pick_note);
  }
  const out = {};
  for (const [k, v] of Object.entries(h)) if (!empty(v)) out[k] = tidy(v);
  out.pick = p;
  return out;
}

// ------------------------------------------------------------------ scores and reasons
export const dimList = (crit) => (crit?.scoring?.dimensions?.length ? crit.scoring.dimensions.map((d) => [d[0], d[1]]) : DEFAULT_DIMS);
/** The overall score under `weights` (the formula of rescore() in app.js): unknown dimensions count as 50. */
export function weightedScore(L, weights, dims) {
  const parts = L.score?.parts || {}, tot = dims.reduce((a, [k]) => a + (num(weights[k]) || 0), 0) || 1;
  if (parts && Object.keys(parts).length) return dims.reduce((a, [k]) => a + (num(weights[k]) || 0) * (parts[k] ?? 50), 0) / tot;
  return L.score?.overall ?? null;
}
/** Listings best first: score, then confidence, lower monthly cost, then id (the scorer's tie-break). */
export function orderListings(list, weights, dims) {
  const key = (L) => { const s = weightedScore(L, weights, dims), sc = L.score || {}; return [s != null ? s : -1, sc.confidence || 0, sc.monthly_cost ?? 1e9, L.id || '']; };
  return [...list].sort((a, b) => { const x = key(a), y = key(b); return (y[0] - x[0]) || (y[1] - x[1]) || (x[2] - y[2]) || (x[3] < y[3] ? -1 : x[3] > y[3] ? 1 : 0); });
}
/** "Why it ranks here": the scorer's sentences with points recomputed under `weights` (reasons() in app.js). */
export function reasonsFor(L, weights, dims) {
  const labels = Object.fromEntries(dims), sc = L.score || {}, parts = sc.parts || {}, tot = dims.reduce((a, [k]) => a + (num(weights[k]) || 0), 0) || 1;
  const src = sc.reasons?.length ? sc.reasons : dims.map(([k]) => ({ dim: k, text: `${labels[k]}: ${parts[k] == null ? 'unknown, counted as neutral' : Math.round(parts[k]) + ' / 100'}` }));
  const out = [];
  for (const r of src) {
    const w = num(weights[r.dim]) || 0;
    if (w <= 0) continue;
    const pts = (((parts[r.dim] ?? 50) - 50) * w) / tot, text = String(r.text || '');
    out.push({ label: labels[r.dim] || r.dim, pts: Math.round(pts * 100) / 100, sentence: text.includes(': ') ? text.slice(text.indexOf(': ') + 2) : text, weight: w });
  }
  return out.sort((a, b) => Math.abs(b.pts) - Math.abs(a.pts));
}
export function weightRows(weights, dims) {
  const tot = dims.reduce((a, [k]) => a + (num(weights[k]) || 0), 0);
  return dims.map(([k, label]) => ({ k, label, w: num(weights[k]) || 0, pct: tot ? Math.round(((num(weights[k]) || 0) / tot) * 100) : 0 }));
}

// ------------------------------------------------------------------ the map
const rnd = (x, d) => { const f = 10 ** d; return Math.floor(x * f + 0.5) / f; };
const metres = (a, b) => Math.hypot((b[0] - a[0]) * Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180) * 111320, (b[1] - a[1]) * 110574);
/** Subway line geometry reduced for the page (same algorithm as simplify_lines in share.py): only what crosses
 *  `bbox` [west, south, east, north], vertices closer than min_spacing_m thinned, coordinates rounded, grouped by
 *  colour; the spacing doubles until the total fits max_points. */
export function simplifyLines(features, bbox, opts) {
  const d = opts.decimals, [w, s, e, n] = bbox;
  const inside = (p) => p[0] >= w && p[0] <= e && p[1] >= s && p[1] <= n;
  const runsOf = (line, spc) => {
    const flags = line.map(inside), keep = line.map((_, i) => flags[i] || (i > 0 && flags[i - 1]) || (i + 1 < line.length && flags[i + 1]));
    const runs = []; let cur = [];
    line.forEach((p, i) => { if (keep[i]) cur.push(p); else if (cur.length) { runs.push(cur); cur = []; } });
    if (cur.length) runs.push(cur);
    const out = [];
    for (const run of runs) {
      const thin = [run[0]];
      for (const p of run.slice(1, -1)) if (metres(thin[thin.length - 1], p) >= spc) thin.push(p);
      if (run.length > 1) thin.push(run[run.length - 1]);
      if (thin.length >= 2) out.push(thin.map((p) => [rnd(p[0], d), rnd(p[1], d)]));
    }
    return out;
  };
  const lines = [];
  for (const f of features || []) {
    const pr = f.properties || {}, g = f.geometry || {};
    if (pr.kind !== 'line') continue;
    const ls = g.type === 'MultiLineString' ? g.coordinates : g.type === 'LineString' ? [g.coordinates] : [];
    lines.push([String(pr.color || ''), (ls || []).filter((x) => x && x.length)]);
  }
  let spacing = Number(opts.min_spacing_m), groups = new Map();
  for (let i = 0; i < 6; i++) {
    groups = new Map(); let total = 0;
    for (const [color, ls] of lines) for (const ln of ls) for (const run of runsOf(ln, spacing)) { if (!groups.has(color)) groups.set(color, []); groups.get(color).push(run); total += run.length; }
    if (total <= opts.max_points) break;
    spacing *= 2;
  }
  return [...groups].map(([c, d2]) => ({ c, d: d2 }));
}
/** [west, south, east, north] around [lon, lat] points, padded by `pad` of the larger span (at least 0.006 degrees). */
export function homeBbox(points, pad) {
  const lons = points.map((p) => p[0]), lats = points.map((p) => p[1]);
  const span = Math.max(Math.max(...lons) - Math.min(...lons), Math.max(...lats) - Math.min(...lats), 0.006), m = span * pad * 1.6;
  return [Math.min(...lons) - m, Math.min(...lats) - m, Math.max(...lons) + m, Math.max(...lats) + m];
}

// ------------------------------------------------------------------ photos
/** The home's own photos first, then licensed building photos: [{ local, ref, credit }] (same rules as share.py). */
export function photoCandidates(L) {
  const loc = (L.photos_local || []).filter((u) => typeof u === 'string'), web = (L.photos || []).filter((u) => typeof u === 'string');
  const out = [], http = (u) => typeof u === 'string' && /^https?:\/\//.test(u);
  for (let i = 0; i < Math.max(loc.length, web.length); i++) {
    const w = i < web.length ? web[i] : null;
    const local = i < loc.length ? loc[i] : w && w.startsWith('media/') ? w : null, ref = http(w) ? w : null;
    if (local || ref) out.push({ local, ref, credit: null });
  }
  for (const b of L.building_photos || []) {
    if (!isObj(b)) continue;
    const u = typeof b.url === 'string' ? b.url : null;
    const local = typeof b.local === 'string' && b.local.startsWith('media/') ? b.local : u && u.startsWith('media/') ? u : null;
    const credit = b.author || b.license_url ? [b.author, b.license].filter(Boolean).join(' · ') : null;
    if (local || http(u)) out.push({ local, ref: http(u) ? u : null, credit });
  }
  const seen = new Set();
  return out.filter((c) => { const k = c.local || c.ref; if (seen.has(k)) return false; seen.add(k); return true; });
}

// ------------------------------------------------------------------ the payload
/** The payload for a set of picks. `picks` is { id: { tier, note, saved } }; `photos` maps a listing id to
 *  [{ src, credit }] (the adapter resolves thumbnails). `destName` is the commute destination to show. */
export function buildPayload({ listings, crit, picks, weights = null, includeNotes = false, view = 'cards', title = null, transit = [], generated = null, photos = {},
  schema, commuteMode = 'best', destName = null, source = SOURCE, extras = {} }) {   // extras: { id: { tour, trail } } from tour-findings.js
  const dims = dimList(crit), w = { ...(crit.weights || {}), ...(weights || {}) };
  const byId = new Map(listings.map((L) => [L.id, L]));
  const ids = Object.entries(picks).filter(([id, p]) => (p.saved || p.tier) && p.tier !== 'Pass' && byId.has(id)).map(([id]) => id);
  const dests = crit.commute?.destinations || [];
  const d0 = (destName && dests.find((d) => d.name === destName)) || dests[0] || null;
  const chosen = orderListings(ids.map((id) => byId.get(id)), w, dims);
  const homes = chosen.map((L) => {
    const h = pruneHome(L, schema, d0?.name || null, picks[L.id], includeNotes);
    h.reasons = reasonsFor(L, w, dims);
    if (photos[L.id]?.length) h.photos = photos[L.id];
    const x = extras[L.id];   // the renter's visit and decision trail, cut to the schema's fields
    if (x?.tour) h.tour = pickKeys(x.tour, schema.tour);
    if (x?.trail?.length) h.trail = x.trail.map((t) => pickKeys(t, schema.trail));
    return h;
  });
  const dest = d0 && d0.lat != null ? { name: d0.name, lat: d0.lat, lon: d0.lon, arrive_by: d0.arrive_by ?? null } : null;
  const pts = homes.filter((h) => h.lat != null && h.lon != null).map((h) => [h.lon, h.lat]).concat(dest ? [[dest.lon, dest.lat]] : []);
  const map = {};
  if (pts.length && transit?.length) map.lines = simplifyLines(transit, homeBbox(pts, schema.map.pad), schema.map);
  const s = crit.search || {};
  const out = { v: schema.version, view, generated: generated || new Date().toISOString().slice(0, 10), source, notes: !!includeNotes, search: { name: s.name ?? null, city: s.city ?? null }, dest,
    commute: { mode: commuteMode }, weights: weightRows(w, dims), homes, map };
  if (title) out.title = title;
  return out;
}
export const fileSlug = (s) => String(s || 'search').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'search';
