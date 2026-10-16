// Layout files for the Floor plan studio: the furniture a renter placed on one plan.
// Pure functions (no DOM) so validation is covered by node:test.
//
// Saved layout JSON (schema 1):
//   {"schema": 1, "kind": "apartmentscout-layout", "plan": "<plan id>", "units": "in",
//    "items": [{"id": "bed", "ref": "queen-bed", "x": 66, "y": 190, "rot": 270, "w"?, "d"?, "h"?,
//               "variant"?, "label"?, "hidden"?, "product"?, "attach"?, "look"?}]}
// `look` (optional, plan/looks.js) overrides the look the inventory gives the piece; saved layouts do not store the inventory's looks.
// `product` (optional) names an entry of plan/products.js: its real dimensions replace the catalogue's.
// Positions are inches in the plan frame (+x right, +y toward the top of the drawing); w/d/h are inches.
import { CATALOG } from './catalog.js';
import { validateLook } from './looks.js';

export const MAX_ITEMS = 150;
export const MAX_BYTES = 1_000_000;
/** The layout version this build writes: 2 = items carry `placed` marks (plan/placement.js). */
export const LAYOUT_VER = 2;
const ID = /^[A-Za-z0-9_-]{1,40}$/;
const fin = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Check one layout item. Returns {error} or {item} (the cleaned item). Strict: unknown refs, markup in labels and absurd sizes fail.
 * @param {object} it
 * @param {string} at  how the message names the item ("Item 3")
 * @param {object} catalog
 */
function checkItem(it, at, catalog) {
  if (!it || typeof it !== 'object') return { error: `${at} is not an object` };
  if (typeof it.id !== 'string' || !ID.test(it.id)) return { error: `${at}: id must be 1-40 letters, digits, - or _` };
  const c = catalog[it.ref];
  if (typeof it.ref !== 'string' || !c) return { error: `${at}: unknown furniture "${String(it.ref).slice(0, 40)}"` };
  if (![it.x, it.y].every(fin) || Math.abs(it.x) > 5000 || Math.abs(it.y) > 5000) return { error: `${at}: x and y must be numbers within 5000 in` };
  if (it.rot != null && !fin(it.rot)) return { error: `${at}: rot must be a number` };
  for (const k of ['w', 'd', 'h', 'elev']) if (it[k] != null && (!fin(it[k]) || it[k] < (k === 'elev' ? 0 : 1) || it[k] > 300)) return { error: `${at}: ${k} must be between ${k === 'elev' ? 0 : 1} and 300 in` };
  if (it.variant != null && !(typeof it.variant === 'string' && c.variants?.[it.variant])) return { error: `${at}: unknown variant "${String(it.variant).slice(0, 30)}"` };
  if (it.label != null && (typeof it.label !== 'string' || it.label.length > 80 || /[<>]/.test(it.label))) return { error: `${at}: label must be plain text up to 80 characters` };
  if (it.hidden != null && typeof it.hidden !== 'boolean') return { error: `${at}: hidden must be true or false` };
  if (it.attach != null && !(typeof it.attach === 'string' && ID.test(it.attach))) return { error: `${at}: attach must be the id of the piece it is attached to` };
  if (it.placed != null && typeof it.placed !== 'boolean') return { error: `${at}: placed must be true or false` };
  if (it.product != null && (typeof it.product !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(it.product))) return { error: `${at}: product must be a product id (lowercase letters, digits and -)` };
  const clean = { id: it.id, ref: it.ref, x: round(it.x), y: round(it.y), rot: round(((it.rot || 0) % 360 + 360) % 360) };
  for (const k of ['w', 'd', 'h', 'elev']) if (it[k] != null) clean[k] = round(it[k]);
  if (it.variant) clean.variant = it.variant;
  if (it.label) clean.label = it.label;
  if (it.hidden) clean.hidden = true;
  if (it.placed) clean.placed = true;
  if (it.attach) clean.attach = it.attach;   // attached to this piece (an office chair to its desk): it moves and turns with it (plan/attach.js)
  if (it.product) clean.product = it.product;
  if (it.look != null) { const lk = validateLook(it.look, `${at}: look`); if (!lk.ok) return { error: lk.error }; clean.look = lk.look; }
  return { item: clean };
}

/**
 * Validate a parsed layout object. Strict by default: unknown refs, duplicate ids, markup in labels or absurd sizes fail the whole
 * layout. With `lenient`, a piece that fails is skipped (and listed in `dropped`) and every other piece keeps its place: a saved
 * layout must not fall back to the default, and so move everything, because one piece in it is unreadable.
 * @returns {{ok: true, layout: object, dropped: {id: string|null, error: string}[]} | {ok: false, error: string}}
 */
export function validateLayout(obj, { planId = null, catalog = CATALOG, lenient = false } = {}) {
  const fail = (error) => ({ ok: false, error });
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return fail('Not a layout object');
  if (obj.schema !== 1) return fail('Unsupported layout schema (expected 1)');
  if (obj.units !== 'in') return fail('Layout units must be "in"');
  if (planId && obj.plan && obj.plan !== planId) return fail(`This layout is for plan "${String(obj.plan).slice(0, 60)}", not "${planId}"`);
  if (!Array.isArray(obj.items)) return fail('Layout has no items list');
  if (obj.items.length > MAX_ITEMS) return fail(`Too many items (max ${MAX_ITEMS})`);
  if (obj.ver != null && !(Number.isInteger(obj.ver) && obj.ver >= 1 && obj.ver <= LAYOUT_VER)) return fail(`Unsupported layout version (expected 1 to ${LAYOUT_VER})`);
  if (obj.removed != null && (!Array.isArray(obj.removed) || obj.removed.length > MAX_ITEMS || !obj.removed.every((x) => typeof x === 'string' && ID.test(x)))) return fail('removed must be a list of piece ids');
  const seen = new Set(), items = [], dropped = [];
  for (const [i, it] of obj.items.entries()) {
    const r = checkItem(it, `Item ${i + 1}`, catalog);
    if (!r.error && seen.has(it.id)) r.error = `Item ${i + 1}: duplicate id "${it.id}"`;
    if (r.error) { if (!lenient) return fail(r.error); dropped.push({ id: typeof it?.id === 'string' ? it.id.slice(0, 40) : null, error: r.error }); continue; }
    seen.add(it.id); items.push(r.item);
  }
  const layout = { schema: 1, kind: 'apartmentscout-layout', plan: planId || obj.plan || null, units: 'in', items };
  if (obj.ver != null) layout.ver = obj.ver;
  if (obj.removed?.length) layout.removed = [...new Set(obj.removed)];
  return { ok: true, layout, dropped };
}

/** Parse layout text (from a file or storage) with a size limit. */
export function parseLayout(text, opts) {
  if (typeof text !== 'string') return { ok: false, error: 'Nothing to read' };
  if (text.length > MAX_BYTES) return { ok: false, error: 'File is larger than 1 MB' };
  let obj;
  try { obj = JSON.parse(text); } catch { return { ok: false, error: 'Not valid JSON' }; }
  return validateLayout(obj, opts);
}

/** The layout as it is saved: version 2, each piece with its `placed` mark, and the ids the renter took out (`removed`). */
export function serialiseLayout(planId, items, { removed = [] } = {}) {
  const out = { schema: 1, kind: 'apartmentscout-layout', plan: planId, units: 'in', ver: LAYOUT_VER, saved: new Date().toISOString().slice(0, 19), items: items.map(strip) };
  const gone = [...new Set(removed)].filter((id) => !items.some((it) => it.id === id));
  if (gone.length) out.removed = gone;
  return out;
}

/** Express a layout as a preset for the plan file's `layouts` (positions in the plan's units). */
export function asPreset(items, { k = 12, id = 'my-layout', name = 'My layout', note = '' } = {}) {
  return { id, name, note, items: items.filter((it) => !it.hidden).map((it) => { const s = strip(it); s.x = round(s.x / k, 2); s.y = round(s.y / k, 2); s.placed = true; return s; }) };   // a layout the renter copies out is theirs: every piece placed
}

function strip(it) {
  const o = { id: it.id, ref: it.ref, x: round(it.x), y: round(it.y), rot: round(it.rot || 0) };
  for (const k of ['w', 'd', 'h', 'elev', 'variant', 'label', 'hidden', 'placed', 'product', 'attach']) if (it[k] != null && it[k] !== false) o[k] = typeof it[k] === 'number' ? round(it[k]) : it[k];
  return o;
}
const round = (v, n = 1) => Math.round(v * 10 ** n) / 10 ** n;

/** A fresh id for a new item of the given ref that does not clash with existing ids. */
export function newId(ref, items) {
  const base = ref.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 30) || 'item';
  let i = 1; const ids = new Set(items.map((x) => x.id));
  while (ids.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}
