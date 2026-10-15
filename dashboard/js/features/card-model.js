// What a result card says, decided in one place and kept free of the DOM so it can be tested: which two features are worth a
// chip (the ones that tell this home apart from the others), the single "why" line, and the one warning mark.
// The card itself (app.js cardHTML) only lays these out.

/** Candidate feature chips, in the order that breaks ties. `has` reads one listing; `month` is 0-11. */
const FEATURES = [
  { key: 'wd', label: 'W/D', title: 'In-unit washer/dryer', has: (L) => (L.amenities || {}).in_unit_wd === true, known: (L) => (L.amenities || {}).in_unit_wd != null },
  { key: 'doorman', label: 'Doorman', title: 'Full-time doorman', has: (L) => (L.amenities || {}).doorman === 'full-time', known: (L) => (L.amenities || {}).doorman != null },
  { key: 'gym', label: 'Gym', title: 'Gym in the building', has: (L) => (L.amenities || {}).gym === true, known: (L) => (L.amenities || {}).gym != null },
  { key: 'sun', label: (L, m) => `${sunNow(L, m).toFixed(1)} h`, title: (L, m) => `Modelled direct sun on the window this month: ${sunNow(L, m).toFixed(1)} hours a day`,
    has: (L, m) => sunNow(L, m) >= SUN_MIN, known: (L) => Array.isArray(L.site?.sun_hours) },
  { key: 'floor', label: (L) => `Fl ${Math.round(L.floor)}`, title: (L) => `Floor ${Math.round(L.floor)}${L.exposure?.length ? `, faces ${L.exposure.join('/')}` : ''}`,
    has: (L) => Number(L.floor) >= HIGH_FLOOR, known: (L) => Number(L.floor) > 0 },
];
export const SUN_MIN = 4, HIGH_FLOOR = 20;
const sunNow = (L, m) => Number(L.site?.sun_hours?.[m]) || 0;
const textOf = (v, L, m) => (typeof v === 'function' ? v(L, m) : v);

/** How common each feature is among the listings that have an answer for it: `{ wd: 0.24, doorman: 0.54, ... }`. */
export function featureShares(listings, month = new Date().getMonth()) {
  const out = {};
  for (const f of FEATURES) {
    let known = 0, have = 0;
    for (const L of listings) if (f.known(L, month)) { known++; if (f.has(L, month)) have++; }
    out[f.key] = known ? have / known : 0.5;
  }
  return out;
}
let memo = { ref: null, n: -1, month: -1, shares: null };
/** `featureShares` for the loaded listings, computed once per list (the array is replaced when the data is). */
export function sharesFor(listings, month = new Date().getMonth()) {
  if (memo.ref !== listings || memo.n !== listings.length || memo.month !== month) memo = { ref: listings, n: listings.length, month, shares: featureShares(listings, month) };
  return memo.shares;
}

/** The (at most) `n` features this home has that fewer of the other homes have: `[{ key, label, title }]`. */
export function pickFeatures(L, shares, { n = 2, month = new Date().getMonth() } = {}) {
  return FEATURES
    .map((f, i) => ({ f, i, rarity: 1 - (shares[f.key] ?? 0.5) }))
    .filter(({ f }) => f.has(L, month))
    .sort((a, b) => b.rarity - a.rarity || a.i - b.i)
    .slice(0, n)
    .map(({ f }) => ({ key: f.key, label: textOf(f.label, L, month), title: textOf(f.title, L, month) }));
}

/** The one-line reason for the score: the dimension that moved it most, from `reasons(L)` (sorted by size).
 *  Null when nothing moved it by half a point or more (then the card says nothing rather than something vague). */
export function topReason(reasons, minPts = 0.5) {
  const r = (reasons || []).find((x) => Number.isFinite(x.pts) && Math.abs(x.pts) >= minPts);
  if (!r) return null;
  const up = r.pts > 0, label = String(r.label || r.dim || '').toLowerCase(), pts = Math.abs(r.pts);
  return { up, label, pts, text: `${up ? 'Strongest' : 'Held back by'}: ${label}`, num: `${up ? '+' : '−'}${pts >= 10 ? Math.round(pts) : pts.toFixed(1)}`, detail: String(r.sentence || '') };
}

const TAG_TEXT = { 'price unverified': 'Price unverified: read from a weak source', 'source conflict': 'Sources disagree on the price', 'thin data': 'Thin data: few facts are confirmed' };
/** Everything worth a warning on a card, as one mark: `{ tone: 'warn' | 'bad', items: [text] } | null`. A failed must-have is
 *  `bad`. Being over budget is not repeated here: the budget tier on the card says it. */
export function warnings(L, gateLabel = (g) => g) {
  const s = L.score || {}, items = [];
  const fail = (s.gates || []).find((g) => String(g).startsWith('fails'));
  if (fail) items.push(gateLabel(fail));
  for (const t of s.tags || []) items.push(TAG_TEXT[t] || t);
  return items.length ? { tone: fail ? 'bad' : 'warn', items } : null;
}
