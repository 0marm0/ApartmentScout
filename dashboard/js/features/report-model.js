// Decision report: the pure part. It turns two to four homes into the payload that dashboard/report/report.html draws and writes the
// finished file. apartmentscout/report_doc.py does the same job for `apartmentscout report --homes`; both read the field list from the
// template's own as-schema block and a parity test builds the same payload with each and compares them. The rules the page applies (which
// home leads, what is unknown, the table) live in the template's as-core script, not here: a builder only prunes and attaches.
// It reuses the shortlist page's pruning and scoring (share-model.js). No DOM and no storage, so `node --test` can load it.
import { parseSchema, inlinePayload, pickKeys, pruneHome, pruneCommute, reasonsFor, weightedScore, orderListings, weightRows, dimList, tidy } from './share-model.js';

export { parseSchema, inlinePayload };
export const SOURCE = 'Made with ApartmentScout (dashboard)';
const RENEWAL_DIMS = { renewal: 'renewal_risk', move: 'move_date' };
const FONTS_RE = /(<style id="as-fonts">)\/\*as-fonts\*\/(<\/style>)/;
const isObj = (o) => o != null && typeof o === 'object' && !Array.isArray(o);
const num = (v) => typeof v === 'number' && Number.isFinite(v);
const rnd = (x, d) => { const f = 10 ** d; return Math.floor(x * f + 0.5) / f; };   // half up, like the Python builder
const cut = (s, n) => (typeof s === 'string' && s.length > n ? s.slice(0, Math.max(0, n - 1)).trimEnd() + '…' : s);

/** The template with the font in its as-fonts block (css is a ready @font-face rule, or '' to leave the system fonts). */
export function inlineFonts(template, css) {
  return css ? template.replace(FONTS_RE, (_, a, b) => a + css + b) : template;
}

/** The scorer's sentences about renewal risk and the move date (the table's "Renewal risk" row). */
export function leaseLines(L) {
  const out = {};
  for (const r of L.score?.reasons || []) for (const [key, dim] of Object.entries(RENEWAL_DIMS)) if (r.dim === dim && r.text) out[key] = r.text.includes(': ') ? r.text.slice(r.text.indexOf(': ') + 2) : r.text;
  return out;
}

/** The plan reduced to what the thumbnail draws: rooms (name, kind, polygon), windows and doors, in the plan's own units. */
export function prunePlan(plan) {
  if (!isObj(plan) || !Array.isArray(plan.rooms)) return null;
  const r1 = (v) => rnd(Number(v), 1);
  const rooms = plan.rooms.filter((r) => isObj(r) && Array.isArray(r.poly)).map((r) => {
    const o = {};
    for (const k of ['name', 'kind']) if (k in r) o[k] = r[k];
    o.poly = r.poly.filter((p) => Array.isArray(p) && p.length === 2).map((p) => [r1(p[0]), r1(p[1])]);
    return o;
  });
  if (!rooms.length) return null;
  const seg = (o) => {
    if (!isObj(o)) return null;
    if (['x1', 'y1', 'x2', 'y2'].every((k) => num(o[k]))) return { x1: r1(o.x1), y1: r1(o.y1), x2: r1(o.x2), y2: r1(o.y2) };
    const { a, b } = o;
    return Array.isArray(a) && Array.isArray(b) && a.length === 2 && b.length === 2 ? { a: [r1(a[0]), r1(a[1])], b: [r1(b[0]), r1(b[1])] } : null;
  };
  const out = { units: ['ft', 'in', 'm'].includes(plan.units) ? plan.units : 'in', rooms, windows: (plan.windows || []).map(seg).filter(Boolean), doors: (plan.doors || []).map(seg).filter(Boolean) };
  if (num(plan.up_bearing)) out.up_bearing = r1(plan.up_bearing);
  return Object.fromEntries(Object.entries(out).filter(([, v]) => !(Array.isArray(v) && !v.length)));
}

/**
 * The payload for the homes `ids`. `picks` is { id: { tier, note } }; `photos` maps a listing id to [{ src, credit }] (the adapter resolves
 * thumbnails); `extras` is { id: { tour, trail } } from tour-findings.js; `plans` is { id: plan JSON }; `questions` is { id: [{ text, kind }] }
 * (the leasing-office questions still open); `stills` is { id: { src, floor, face, when } }; `dests` the commute destinations to show.
 */
export function buildReport({ listings, crit, ids, picks = {}, weights = null, includeNotes = false, schema, photos = {}, extras = {}, plans = {}, questions = {}, stills = {}, generated = null,
  paper = 'letter', title = null, source = SOURCE }) {
  const cap = schema.max_homes || 4, dims = dimList(crit), w = { ...(crit.weights || {}), ...(weights || {}) };
  const byId = new Map(listings.map((L) => [L.id, L]));
  const want = [...new Set(ids)];
  const missing = want.filter((i) => !byId.has(i));
  if (missing.length) throw new Error(`No listing with id ${missing.join(', ')} in this search.`);
  if (want.length < 1 || want.length > cap) throw new Error(`A report compares 1 to ${cap} homes; ${want.length} were given.`);
  const chosen = orderListings(want.map((i) => byId.get(i)), w, dims);
  const dests = crit.commute?.destinations || [];
  const homes = chosen.map((L) => {
    const h = pruneHome(L, schema, null, picks[L.id], includeNotes);
    h.reasons = reasonsFor(L, w, dims);
    const fit = weightedScore(L, w, dims);
    if (fit != null) h.fit = rnd(fit, 1);
    const commutes = {};
    for (const d of dests) { const c = d.name ? pruneCommute(L.commute?.[d.name], schema) : null; if (c) commutes[d.name] = c; }
    if (Object.keys(commutes).length) h.commutes = tidy(commutes);
    const lease = leaseLines(L);
    if (Object.keys(lease).length) h.lease = lease;
    const plan = prunePlan(plans[L.id]);
    if (plan) h.plan = plan;
    const qs = (questions[L.id] || []).map((q) => ({ text: cut(q.text, schema.text_max?.question || 260), kind: q.kind }));
    if (qs.length) h.questions = qs;
    const x = extras[L.id];
    if (x?.tour) h.tour = pickKeys(x.tour, schema.tour);
    if (x?.trail?.length) h.trail = x.trail.map((t) => pickKeys(t, schema.trail));
    if (photos[L.id]?.length) h.photos = photos[L.id];
    if (stills[L.id]) h.still = stills[L.id];
    return h;
  });
  const s = crit.search || {}, mi = s.move_in || {};
  const out = {
    v: schema.version, generated: generated || new Date().toISOString().slice(0, 10), source, notes: !!includeNotes, paper: paper === 'a4' ? 'a4' : 'letter', search: { name: s.name ?? null, city: s.city ?? null },
    dests: dests.slice(0, 3).filter((d) => d.name).map((d) => ({ name: d.name })), weights: weightRows(w, dims),
    move_in: Object.fromEntries(['earliest', 'latest'].filter((k) => mi[k]).map((k) => [k, String(mi[k]).slice(0, 10)])), homes,
  };
  if (title) out.title = title;
  return out;
}

/** The sentence that names a report file: report-<search>-<date>.html */
export const fileName = (search, date, ext = 'html') => `decision-report-${String(search || 'search').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'search'}-${date}.${ext}`;
