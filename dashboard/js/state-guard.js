// Saved browser state must never stop the app from starting. Every value read back from localStorage goes through
// cleanStored(): it checks the shape (against the default the caller passes, or against a per-key rule for the
// keys that default to null) and returns the default when the value is not usable. Pure: no DOM, no storage.
// Older versions of the app wrote other shapes, and a person can edit or truncate storage by hand; one bad key falls
// back to its default and the rest of the app carries on.

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = (v) => typeof v === 'string';
const strings = (v, max = 200) => (Array.isArray(v) ? v.filter(isStr).slice(0, max) : null);

/** `picks`: { listingId: { saved, note, tier, tour, ... } }. Bad entries are dropped, bad fields inside good ones are removed. */
function cleanPicks(v) {
  if (!isObj(v)) return null;
  const out = {};
  for (const [id, p] of Object.entries(v)) {
    if (!isObj(p)) continue;
    const q = { ...p };
    if ('note' in q && !isStr(q.note)) delete q.note;
    if ('saved' in q) q.saved = q.saved === true;
    if ('updated' in q && !isStr(q.updated)) delete q.updated;
    if ('tier' in q && !(isStr(q.tier) || Number.isFinite(q.tier))) delete q.tier;
    out[id] = q;
  }
  return out;
}
const cleanWeights = (v) => (isObj(v) ? Object.fromEntries(Object.entries(v).filter(([, x]) => Number.isFinite(x) && x >= 0 && x <= 1000)) : null);
/** `filters2`: only the known fields with the right types survive; the rest keep the app's own defaults. */
function cleanFilters(v) {
  if (!isObj(v)) return null;
  const out = {};
  if (isStr(v.q)) out.q = v.q;
  if (Array.isArray(v.tiers)) out.tiers = v.tiers.filter((n) => Number.isInteger(n) && n >= 0 && n < 20);
  if (typeof v.over === 'boolean') out.over = v.over;
  if (Number.isFinite(v.maxCommute)) out.maxCommute = v.maxCommute;
  if (strings(v.toggles)) out.toggles = strings(v.toggles);
  if (strings(v.status)) out.status = strings(v.status);
  if (typeof v.savedOnly === 'boolean') out.savedOnly = v.savedOnly;
  if (v.nl === null || isObj(v.nl)) out.nl = v.nl;
  return out;
}
/** Anything stored under `commute:<search>`: { mode, dest }. */
const cleanCommute = (v) => (isObj(v) ? { mode: isStr(v.mode) ? v.mode : undefined, dest: isStr(v.dest) ? v.dest : null } : null);

// keys (before the first ':' or '.') whose default is null or whose value needs more than a type check
const RULES = {
  picks: cleanPicks,
  weights: cleanWeights,
  filters2: cleanFilters,
  commute: cleanCommute,
  compare: (v) => strings(v, 4),
  recent: (v) => strings(v, 6),
  theme: (v) => (['system', 'dark', 'light'].includes(v) ? v : null),
  preset: (v) => (isStr(v) ? v : null),
  'home-id': (v) => (isStr(v) && v.length <= 200 ? v : null),   // the home Unit 3D and the Floor plan studio opened last (features/default-home.js)
  criteria: (v) => (isObj(v) ? v : null),
  coach: (v) => (isObj(v) ? v : null),
  combo: (v) => (isObj(v) ? v : null),
  'list:ui': (v) => (isObj(v) ? v : null),
  draft: (v) => (isObj(v) ? v : null),
  visit: (v) => (isObj(v) ? v : null),
  tourplan: (v) => (isObj(v) ? v : null),
  findings: (v) => (isObj(v) ? v : null),
  facts: (v) => (isObj(v) ? v : null),
  moves: (v) => (isObj(v) ? v : null),
  moveplan: (v) => (isObj(v) ? v : null),   // the move planner's saved plan (features/move-model.js normalize() checks the rest)
  'report-opts': (v) => (isObj(v) ? v : null),
  trail: (v) => (Array.isArray(v) ? v : null),
  'rail:collapsed': (v) => strings(v),
};
const baseKey = (k) => (k in RULES ? k : String(k).split(/[:.]/)[0]);

/** The default's own type, for keys without a rule: array, object, boolean, string or number. null/undefined defaults accept anything. */
function sameKind(v, d) {
  if (d === null || d === undefined) return true;
  if (Array.isArray(d)) return Array.isArray(v);
  if (typeof d === 'object') return isObj(v);
  if (typeof d === 'number') return Number.isFinite(v);
  return typeof v === typeof d;
}

/** The value to use for storage key `k` (without the `as:` prefix): `v` when it is the right shape, else the default `d`. */
export function cleanStored(k, v, d) {
  const rule = RULES[baseKey(k)];
  if (rule) {
    let out; try { out = rule(v); } catch { out = null; }
    return out == null ? d : out;
  }
  return sameKind(v, d) ? v : d;
}
