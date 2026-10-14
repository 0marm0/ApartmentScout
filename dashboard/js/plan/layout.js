// Layout files for the Floor plan studio: the furniture a renter placed on one plan.
// Pure functions (no DOM) so validation is covered by node:test.
//
// Saved layout JSON (schema 1):
//   {"schema": 1, "kind": "apartmentscout-layout", "plan": "<plan id>", "units": "in",
//    "items": [{"id": "bed", "ref": "queen-bed", "x": 66, "y": 190, "rot": 270, "w"?, "d"?, "h"?,
//               "variant"?, "label"?, "hidden"?, "product"?}]}
// `product` (optional) names an entry of plan/products.js: its real dimensions replace the catalogue's.
// Positions are inches in the plan frame (+x right, +y toward the top of the drawing); w/d/h are inches.
import { CATALOG } from './catalog.js';

export const MAX_ITEMS = 150;
export const MAX_BYTES = 1_000_000;
const ID = /^[A-Za-z0-9_-]{1,40}$/;
const fin = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Validate a parsed layout object. Strict: unknown refs, duplicate ids, markup in labels or absurd sizes fail.
 * @returns {{ok: true, layout: object} | {ok: false, error: string}}
 */
export function validateLayout(obj, { planId = null, catalog = CATALOG } = {}) {
  const fail = (error) => ({ ok: false, error });
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return fail('Not a layout object');
  if (obj.schema !== 1) return fail('Unsupported layout schema (expected 1)');
  if (obj.units !== 'in') return fail('Layout units must be "in"');
  if (planId && obj.plan && obj.plan !== planId) return fail(`This layout is for plan "${String(obj.plan).slice(0, 60)}", not "${planId}"`);
  if (!Array.isArray(obj.items)) return fail('Layout has no items list');
  if (obj.items.length > MAX_ITEMS) return fail(`Too many items (max ${MAX_ITEMS})`);
  const seen = new Set(), items = [];
  for (const [i, it] of obj.items.entries()) {
    const at = `Item ${i + 1}`;
    if (!it || typeof it !== 'object') return fail(`${at} is not an object`);
    if (typeof it.id !== 'string' || !ID.test(it.id)) return fail(`${at}: id must be 1-40 letters, digits, - or _`);
    if (seen.has(it.id)) return fail(`${at}: duplicate id "${it.id}"`);
    seen.add(it.id);
    const c = catalog[it.ref];
    if (typeof it.ref !== 'string' || !c) return fail(`${at}: unknown furniture "${String(it.ref).slice(0, 40)}"`);
    if (![it.x, it.y].every(fin) || Math.abs(it.x) > 5000 || Math.abs(it.y) > 5000) return fail(`${at}: x and y must be numbers within 5000 in`);
    if (it.rot != null && !fin(it.rot)) return fail(`${at}: rot must be a number`);
    for (const k of ['w', 'd', 'h', 'elev']) if (it[k] != null && (!fin(it[k]) || it[k] < (k === 'elev' ? 0 : 1) || it[k] > 300)) return fail(`${at}: ${k} must be between ${k === 'elev' ? 0 : 1} and 300 in`);
    if (it.variant != null && !(typeof it.variant === 'string' && c.variants?.[it.variant])) return fail(`${at}: unknown variant "${String(it.variant).slice(0, 30)}"`);
    if (it.label != null && (typeof it.label !== 'string' || it.label.length > 80 || /[<>]/.test(it.label))) return fail(`${at}: label must be plain text up to 80 characters`);
    if (it.hidden != null && typeof it.hidden !== 'boolean') return fail(`${at}: hidden must be true or false`);
    if (it.product != null && (typeof it.product !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(it.product))) return fail(`${at}: product must be a product id (lowercase letters, digits and -)`);
    const clean = { id: it.id, ref: it.ref, x: round(it.x), y: round(it.y), rot: round(((it.rot || 0) % 360 + 360) % 360) };
    for (const k of ['w', 'd', 'h', 'elev']) if (it[k] != null) clean[k] = round(it[k]);
    if (it.variant) clean.variant = it.variant;
    if (it.label) clean.label = it.label;
    if (it.hidden) clean.hidden = true;
    if (it.product) clean.product = it.product;
    items.push(clean);
  }
  return { ok: true, layout: { schema: 1, kind: 'apartmentscout-layout', plan: planId || obj.plan || null, units: 'in', items } };
}

/** Parse layout text (from a file or storage) with a size limit. */
export function parseLayout(text, opts) {
  if (typeof text !== 'string') return { ok: false, error: 'Nothing to read' };
  if (text.length > MAX_BYTES) return { ok: false, error: 'File is larger than 1 MB' };
  let obj;
  try { obj = JSON.parse(text); } catch { return { ok: false, error: 'Not valid JSON' }; }
  return validateLayout(obj, opts);
}

export function serialiseLayout(planId, items) {
  return { schema: 1, kind: 'apartmentscout-layout', plan: planId, units: 'in', saved: new Date().toISOString().slice(0, 19), items: items.map(strip) };
}

/** Express a layout as a preset for the plan file's `layouts` (positions in the plan's units). */
export function asPreset(items, { k = 12, id = 'my-layout', name = 'My layout', note = '' } = {}) {
  return { id, name, note, items: items.filter((it) => !it.hidden).map((it) => { const s = strip(it); s.x = round(s.x / k, 2); s.y = round(s.y / k, 2); return s; }) };
}

function strip(it) {
  const o = { id: it.id, ref: it.ref, x: round(it.x), y: round(it.y), rot: round(it.rot || 0) };
  for (const k of ['w', 'd', 'h', 'elev', 'variant', 'label', 'hidden', 'product']) if (it[k] != null && it[k] !== false) o[k] = typeof it[k] === 'number' ? round(it[k]) : it[k];
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
