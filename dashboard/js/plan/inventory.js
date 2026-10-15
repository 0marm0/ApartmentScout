// "Your furniture": the pieces the renter actually has or chose, with real sizes, kept beside the search
// (`furniture.json`) and used by the Floor plan studio as the default kit for every plan. Pure (no DOM, no
// three.js), so node:test covers it.
//
// File format (schema 1):
//   {"schema": 1, "kind": "apartmentscout-furniture", "name": "Your furniture", "source": "where the list came from",
//    "pieces": [{"id": "bed", "ref": "queen-bed", "label": "Queen bed", "room": "bedroom",
//                "w": 64, "d": 84, "h": 40, "elev"?, "variant"?, "product"?, "look"?, "set"?, "assumed"?, "note"?, "source"?}]}
// `ref` is a catalogue id (plan/catalog.js); w, d, h and elev are inches and replace the catalogue's size, so the
// studio draws and checks the piece the renter has, not a generic one. `room` is the kind of room it lived in
// (bedroom, living, dining, office) and steers the auto-placer. `look` (optional, plan/looks.js) is the piece's colour, material and
// finish and who it comes from (the renter or an assumption); both 3D views draw it, joined to the layout item by id.
// `set` (optional, a desk): what stands with it, `{"monitor": 32, "chair": "task"}` (a 32-inch monitor on it, a rolling task chair at it).
// `assumed` (optional): the sizes (`w`, `d`, `h`) the renter did not give, so the studio says "depth assumed".
// `spec` + `spec_basis` (optional, a bed that is not a box): the maker's dimensions by part (plan/bedspec.js reads them) and where each one
// comes from ('spec' = the retailer's specification table, 'diagram' = printed on the maker's drawing, 'measured' = measured off that
// drawing's proportions, 'assumed' = our choice); `candidate` (optional): a piece the renter may buy, not one they own, with its product
// name, brand, retailer, SKU, colour and page. Prices are never recorded.
// `options` (optional, top level): groups of pieces the renter switches between, `{"bed": {"label": "Bed", "default": "mine", "choices":
// [{"id": "mine", "label": "My bed", "pieces": ["bed", "nightstand-1"]}, ...]}}`: a choice shows exactly the pieces it lists (plan/choices.js).
import { CATALOG, resolve } from './catalog.js';
import { fitKit } from './fit.js';
import { validateLook } from './looks.js';

export const MAX_PIECES = 60;
export const MAX_INVENTORY_BYTES = 200_000;
const ID = /^[A-Za-z0-9_-]{1,40}$/;
const ROOM_KINDS = ['living', 'bedroom', 'dining', 'office', 'kitchen', 'other'];
const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const plain = (v, max) => typeof v === 'string' && v.length <= max && !/[<>\u0000-\u001f]/.test(v);
const SPEC_BASES = ['spec', 'diagram', 'measured', 'assumed'];
const KEY = /^[a-z][a-z0-9_]{0,23}$/;

/** A bed's `spec`: a few named groups of numbers (inches, or counts). Returns the clean spec or an error string. */
function validateSpec(spec) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return 'spec must be an object';
  const out = {}, groups = Object.entries(spec);
  if (groups.length > 10) return 'spec has too many groups';
  for (const [g, vals] of groups) {
    if (!KEY.test(g) || !vals || typeof vals !== 'object' || Array.isArray(vals)) return `spec.${String(g).slice(0, 24)} must be an object of numbers`;
    out[g] = {};
    for (const [k, v] of Object.entries(vals)) {
      if (!KEY.test(k) || !fin(v) || v < 0 || v > 300) return `spec.${g}.${String(k).slice(0, 24)} must be a number from 0 to 300`;
      out[g][k] = v;
    }
  }
  return out;
}
function validateBasis(basis, spec) {
  if (!basis || typeof basis !== 'object' || Array.isArray(basis)) return 'spec_basis must be an object';
  const out = {};
  for (const [path, v] of Object.entries(basis)) {
    const [g, k] = String(path).split('.');
    if (spec[g]?.[k] === undefined) return `spec_basis: "${String(path).slice(0, 40)}" is not a number in spec`;
    if (!SPEC_BASES.includes(v)) return `spec_basis.${path} must be one of ${SPEC_BASES.join(', ')}`;
    out[path] = v;
  }
  return out;
}
const CANDIDATE_TEXT = { name: 160, brand: 60, retailer: 60, sku: 40, size: 30, colour: 40, status: 80, materials: 240, note: 1200 };
/** A candidate purchase: plain text fields, an https page and a weight capacity; any other field (a price, say) is dropped. */
function validateCandidate(c) {
  if (!c || typeof c !== 'object' || Array.isArray(c)) return 'candidate must be an object';
  const out = {};
  for (const [k, max] of Object.entries(CANDIDATE_TEXT)) if (c[k] != null) { if (!plain(c[k], max)) return `candidate.${k} must be plain text up to ${max} characters`; out[k] = c[k]; }
  if (c.url != null) { if (!(plain(c.url, 600) && /^https:\/\/[^\s]+$/.test(c.url))) return 'candidate.url must be an https address'; out.url = c.url; }
  if (c.weight_capacity_lb != null) { if (!fin(c.weight_capacity_lb) || c.weight_capacity_lb <= 0 || c.weight_capacity_lb > 5000) return 'candidate.weight_capacity_lb must be a number of pounds'; out.weight_capacity_lb = c.weight_capacity_lb; }
  return out;
}
/** The top-level `options`: groups of pieces to switch between. Returns the clean options or an error string. */
function validateOptions(options, ids) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) return 'options must be an object';
  const out = {}, groups = Object.entries(options);
  if (groups.length > 4) return 'options has too many groups';
  for (const [gid, g] of groups) {
    if (!/^[a-z][a-z0-9-]{0,23}$/.test(gid) || !g || typeof g !== 'object') return `options.${String(gid).slice(0, 24)} must be an object`;
    if (!plain(g.label, 40) || !g.label) return `options.${gid}.label must be short plain text`;
    if (!Array.isArray(g.choices) || g.choices.length < 2 || g.choices.length > 5) return `options.${gid}.choices must list 2 to 5 choices`;
    const seen = new Set(), choices = [];
    for (const c of g.choices) {
      if (!c || typeof c !== 'object' || typeof c.id !== 'string' || !/^[a-z][a-z0-9-]{0,23}$/.test(c.id) || seen.has(c.id)) return `options.${gid}: each choice needs its own id`;
      seen.add(c.id);
      if (!plain(c.label, 40) || !c.label) return `options.${gid}.${c.id}.label must be short plain text`;
      if (!Array.isArray(c.pieces) || c.pieces.length > 12 || !c.pieces.every((x) => typeof x === 'string' && ids.has(x))) return `options.${gid}.${c.id}.pieces must name pieces of this file`;
      choices.push({ id: c.id, label: c.label, pieces: [...new Set(c.pieces)] });
    }
    if (typeof g.default !== 'string' || !seen.has(g.default)) return `options.${gid}.default must be one of its choices`;
    out[gid] = { label: g.label, default: g.default, choices };
  }
  return out;
}

/** What stands with a desk: a monitor (its diagonal in inches, 13 to 60) and a chair ('task' for a rolling task chair, or false for none). Returns the clean set or an error string. */
function validateSet(set, c) {
  if (!set || typeof set !== 'object' || Array.isArray(set)) return 'set must be an object';
  if (c.kind !== 'desk') return 'set belongs to a desk';
  const out = {};
  for (const [k, v] of Object.entries(set)) {
    if (k === 'monitor') { if (v === false) out.monitor = false; else if (fin(v) && v >= 13 && v <= 60) out.monitor = Math.round(v * 10) / 10; else return 'set.monitor must be a diagonal from 13 to 60 in, or false'; }
    else if (k === 'chair') { if (v === false || v === 'task') out.chair = v; else return 'set.chair must be "task" or false'; }
    else return `set: unknown field "${String(k).slice(0, 20)}"`;
  }
  return out;
}

/**
 * Validate a parsed inventory. Strict: unknown refs, duplicate ids, markup in text or absurd sizes fail.
 * @returns {{ok: true, inventory: object} | {ok: false, error: string}}
 */
export function validateInventory(obj, { catalog = CATALOG } = {}) {
  const fail = (error) => ({ ok: false, error });
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return fail('Not a furniture object');
  if (obj.schema !== 1 || obj.kind !== 'apartmentscout-furniture') return fail('Not an apartmentscout-furniture file (schema 1)');
  if (!Array.isArray(obj.pieces)) return fail('No pieces list');
  if (obj.pieces.length > MAX_PIECES) return fail(`Too many pieces (max ${MAX_PIECES})`);
  for (const k of ['name', 'source']) if (obj[k] != null && !plain(obj[k], 600)) return fail(`${k} must be plain text up to 600 characters`);
  const seen = new Set(), pieces = [];
  for (const [i, p] of obj.pieces.entries()) {
    const at = `Piece ${i + 1}`;
    if (!p || typeof p !== 'object') return fail(`${at} is not an object`);
    if (typeof p.id !== 'string' || !ID.test(p.id)) return fail(`${at}: id must be 1-40 letters, digits, - or _`);
    if (seen.has(p.id)) return fail(`${at}: duplicate id "${p.id}"`);
    seen.add(p.id);
    const c = catalog[p.ref];
    if (typeof p.ref !== 'string' || !c) return fail(`${at}: unknown furniture "${String(p.ref).slice(0, 40)}"`);
    for (const k of ['w', 'd', 'h', 'elev']) if (p[k] != null && (!fin(p[k]) || p[k] < (k === 'elev' ? 0 : 1) || p[k] > 300)) return fail(`${at}: ${k} must be between ${k === 'elev' ? 0 : 1} and 300 in`);
    if (p.variant != null && !(typeof p.variant === 'string' && c.variants?.[p.variant])) return fail(`${at}: unknown variant "${String(p.variant).slice(0, 30)}"`);
    if (p.room != null && !ROOM_KINDS.includes(p.room)) return fail(`${at}: room must be one of ${ROOM_KINDS.join(', ')}`);
    for (const k of ['label', 'note', 'source']) if (p[k] != null && !plain(p[k], k === 'label' ? 80 : 400)) return fail(`${at}: ${k} must be plain text`);
    if (p.product != null && !(typeof p.product === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(p.product))) return fail(`${at}: product must be a product id`);
    if (p.set != null) { const st = validateSet(p.set, c); if (typeof st === 'string') return fail(`${at}: ${st}`); }
    let spec = null, basis = null, candidate = null;
    if (p.spec != null) { spec = validateSpec(p.spec); if (typeof spec === 'string') return fail(`${at}: ${spec}`); }
    if (p.spec_basis != null) { if (!spec) return fail(`${at}: spec_basis needs a spec`); basis = validateBasis(p.spec_basis, spec); if (typeof basis === 'string') return fail(`${at}: ${basis}`); }
    if (p.candidate != null) { candidate = validateCandidate(p.candidate); if (typeof candidate === 'string') return fail(`${at}: ${candidate}`); }
    if (p.assumed != null && !(Array.isArray(p.assumed) && p.assumed.length <= 6 && p.assumed.every((x) => ['w', 'd', 'h', 'elev'].includes(x)))) return fail(`${at}: assumed must list sizes among w, d, h, elev`);
    const clean = { id: p.id, ref: p.ref };
    for (const k of ['label', 'room', 'variant', 'product', 'note', 'source']) if (p[k]) clean[k] = p[k];
    if (p.set != null) clean.set = validateSet(p.set, c);
    if (spec) clean.spec = spec;
    if (basis) clean.spec_basis = basis;
    if (candidate) clean.candidate = candidate;
    if (p.assumed?.length) clean.assumed = [...new Set(p.assumed)];
    if (p.look != null) { const lk = validateLook(p.look, `${at}: look`); if (!lk.ok) return fail(lk.error); clean.look = lk.look; }
    for (const k of ['w', 'd', 'h', 'elev']) if (p[k] != null) clean[k] = Math.round(p[k] * 10) / 10;
    pieces.push(clean);
  }
  const inv = { schema: 1, kind: 'apartmentscout-furniture', name: obj.name || 'Your furniture', source: obj.source || '', pieces };
  if (obj.options != null) { const o = validateOptions(obj.options, seen); if (typeof o === 'string') return fail(o); if (Object.keys(o).length) inv.options = o; }
  return { ok: true, inventory: inv };
}

let fileInv = null;
/** furniture.json beside the search, validated, read once per page; null when the search has none (Unit 3D uses it for the pieces' looks). */
export function loadInventoryFile(base, manifest, loadJSON) {
  if (!manifest?.furniture) return Promise.resolve(null);
  fileInv ||= Promise.resolve(loadJSON(`${base}/furniture.json`, null)).then((raw) => { const v = raw && validateInventory(raw); return v?.ok ? v.inventory : null; }, () => null);
  return fileInv;
}

export function parseInventory(text, opts) {
  if (typeof text !== 'string') return { ok: false, error: 'Nothing to read' };
  if (text.length > MAX_INVENTORY_BYTES) return { ok: false, error: 'File is larger than 200 KB' };
  let obj;
  try { obj = JSON.parse(text); } catch { return { ok: false, error: 'Not valid JSON' }; }
  return validateInventory(obj, opts);
}

/** A piece as a layout item (without a position): the catalogue ref plus the renter's own sizes and label. */
export function pieceItem(p, pos = { x: 0, y: 0, rot: 0 }) {
  const o = { id: p.id, ref: p.ref, x: pos.x, y: pos.y, rot: pos.rot };
  for (const k of ['w', 'd', 'h', 'elev', 'variant', 'product']) if (p[k] != null) o[k] = p[k];
  if (p.label) o.label = p.label;
  if (p.set) o.set = p.set;
  if (p.spec) o.spec = p.spec;
  if (p.assumed) o.assumed = p.assumed;
  if (p.look) o.look = p.look;
  return o;
}

/** The kit for the auto-placer: resolved items that remember the room kind they live in. */
export function kitFromInventory(inv) {
  return inv.pieces.filter((p) => !offByDefault(inv, p.id)).map((p) => ({ ...resolve(pieceItem(p)), roomKind: p.room || (['sleep', 'storage'].includes(CATALOG[p.ref]?.cat) ? 'bedroom' : CATALOG[p.ref]?.cat === 'work' ? 'bedroom' : CATALOG[p.ref]?.cat === 'dining' ? 'living' : 'living') }));
}

/**
 * Place the renter's pieces on a plan with the studio's fit checks. Returns a layout preset (positions in inches)
 * with the checks' verdict in the note.
 * @returns {{id: string, name: string, note: string, items: object[], counts: object, missing: string[]}}
 */
export function fitInventory(model, inv, { step = 8, id = 'your-furniture', name = 'Your furniture' } = {}) {
  const res = fitKit(model, kitFromInventory(inv), step);
  const byId = new Map(inv.pieces.map((p) => [p.id, p]));
  const items = res.items.map((q) => ({ ...pieceItem(byId.get(q.id), { x: Math.round(q.x * 10) / 10, y: Math.round(q.y * 10) / 10, rot: q.rot }) }));
  const missing = Object.entries(res.rows).filter(([, r]) => r.grade === 'none').map(([pid]) => byId.get(pid)?.label || pid);
  const c = res.counts, n = kitFromInventory(inv).length;
  const note = `Your ${n} piece${n === 1 ? '' : 's'}, placed with the fit checks: ${c.clear} clear${c.tight ? `, ${c.tight} tight` : ''}${c.blocked ? `, ${c.blocked} blocked` : ''}${missing.length ? `, no room for ${missing.join(', ').toLowerCase()}` : ''}.`;
  return { id, name, note, items, counts: c, missing, ev: res.ev };
}

/** Which of the inventory's pieces a layout holds, by id (the studio's "placed / not placed" marks). */
export function placedIds(inv, items) {
  const have = new Set(items.map((i) => i.id));
  return new Set(inv.pieces.filter((p) => have.has(p.id)).map((p) => p.id));
}

/** True when an option group's default choice leaves this piece out (the candidate bed): auto-fitting must not place it beside the renter's own. */
export function offByDefault(inv, id) {
  return Object.values(inv?.options || {}).some((g) => g.choices.some((c) => c.pieces.includes(id)) && !g.choices.find((c) => c.id === g.default)?.pieces.includes(id));
}
