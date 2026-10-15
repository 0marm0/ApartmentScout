// What place phrases and per-destination commute limits add to the plain-language filter model (nlquery.js), pure.
//
// Both ride in S.filters.nl as one key each, so the existing chips, undo and "Apply: ..." preview carry them unchanged:
//   w:<clause id>   a place clause (places-geo.js evalClause): { op, id, label, ... }
//   c:<destination> a per-destination commute limit: { dest, max, mode }
// nlquery.js calls these four functions from small marked hooks.
import { evalClause } from './places-geo.js';
import { limitLabel, matchesDestLimits } from './multidest-model.js';

/** Merge a parse's place clauses and destination limits into the `nl` object toFilters builds. */
export function addPlus(nl, f) {
  for (const c of f.where || []) nl[`w:${c.id}`] = c;
  for (const c of f.limits || []) nl[`c:${c.dest}`] = c;
  return nl;
}

/** The chips a parse shows: one per place clause and per destination limit. */
export function chipsFromParse(f) {
  return [...(f.where || []).map((c) => ({ key: `w:${c.id}`, label: c.label })), ...(f.limits || []).map((c) => ({ key: `c:${c.dest}`, label: limitLabel(c) }))];
}

/** One chip per applied place clause / destination limit, each clearing its own key. */
export function chipsForPlus(nl) {
  return Object.entries(nl || {}).filter(([k]) => k.startsWith('w:') || k.startsWith('c:'))
    .map(([k, v]) => ({ key: k, label: k.startsWith('w:') ? v.label : limitLabel(v), clear: [k] }));
}

/** Does a home pass the place clauses and destination limits? Homes without coordinates fail a place clause. */
export function matchesPlus(L, nl, { geo = null, dests = [], kmh = 4.8 } = {}) {
  if (!nl) return true;
  for (const [k, c] of Object.entries(nl)) {
    if (!k.startsWith('w:')) continue;
    if (!geo) continue;   // places.json not loaded (yet): the filter waits instead of hiding everything
    if (evalClause(geo, c, L, { kmh }) !== true) return false;
  }
  return matchesDestLimits(L, nl, dests, kmh);
}

/** An undo label for a change that touched a single place clause or destination limit (null: describe it the usual way). */
export function describeNlPlus(a, b) {
  const A = a || {}, B = b || {};
  const keys = [...new Set([...Object.keys(A), ...Object.keys(B)])].filter((k) => JSON.stringify(A[k]) !== JSON.stringify(B[k]));
  if (keys.length !== 1) return null;
  const k = keys[0];
  if (k.startsWith('c:')) return B[k] ? { label: `Commute limit: ${limitLabel(B[k])}`, key: `filters:nl:${k}` } : { label: `Removed the commute limit to ${A[k].dest}`, key: null };
  if (k.startsWith('w:')) return B[k] ? { label: `Place filter: ${B[k].label}`, key: null } : { label: `Removed the place filter: ${A[k].label}`, key: null };
  return null;
}
