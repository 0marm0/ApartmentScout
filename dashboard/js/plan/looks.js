// How a piece of furniture LOOKS: colour, material and finish, kept in the renter's furniture.json beside its size, so a colour the
// renter tells you later is a data edit, not a code change. Pure (no DOM, no three.js), so node:test covers it and both 3D engines
// read the same answer.
//
// A piece's `look` (every field optional):
//   {"color": "black" | "#14110f", "material": "leather", "finish": "sheen", "basis": "renter" | "assumed" | "manufacturer",
//    "assumed": ["finish", "frame"], "parts": {"frame": {"color": "black", "material": "metal", "finish": "satin"}}, "note": "..."}
// `basis` says who the look comes from: "renter" (they told us), "manufacturer" (read from the maker's product pictures and words, for a piece they may buy) or "assumed" (a stand-in the model chose; the default). `assumed`
// lists the fields (or part names) of a renter look that are still guesses, for example the finish. `parts` styles named parts of
// a model (the futon's `frame`, the desk's `chair`, the dining table's `chairs`, `pulls` on a chest); a part that is not named keeps
// the model's own default, which is always an assumption. The look rides on the layout item (`it.look`); applyLooks() joins it by
// piece id from the inventory, so plans never repeat it.

export const MATERIALS = ['leather', 'fabric', 'wood', 'metal', 'paint', 'laminate', 'plastic', 'glass'];
export const FINISHES = ['matte', 'satin', 'sheen', 'gloss'];
export const BASES = ['renter', 'assumed', 'manufacturer'];

/** Colour names a person may write instead of a hex code (sRGB, tuned to read right under the room's light). */
export const COLOR_NAMES = {
  black: 0x1a1b1d, charcoal: 0x3b3e43, 'dark-grey': 0x55595f, grey: 0x7d8187, 'light-grey': 0xb4b7ba, silver: 0xc2c5c8,
  white: 0xeeece7, cream: 0xe8dfcc, beige: 0xcdbfa6, tan: 0xb18d62, taupe: 0x8c7b6c,
  brown: 0x74492c, 'dark-brown': 0x4b3020, 'light-brown': 0x9a6f48, walnut: 0x5a3a28, oak: 0xc9a77c, espresso: 0x32221a, 'natural-wood': 0xb08a62,
  navy: 0x24344f, blue: 0x3f6593, green: 0x4f7a5a, sage: 0x8fa38b, red: 0x9b3a32, rust: 0xa5603c, yellow: 0xd0a443, orange: 0xc77a3a,
};

const plain = (v, max) => typeof v === 'string' && v.length <= max && !/[<>\u0000-\u001f]/.test(v);
const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** A colour as a 0xRRGGBB number from a name, '#rgb', '#rrggbb' or a number, else null. */
export function parseColor(c) {
  if (typeof c === 'number') return Number.isInteger(c) && c >= 0 && c <= 0xffffff ? c : null;
  if (typeof c !== 'string') return null;
  const k = c.trim().toLowerCase().replace(/[\s_]+/g, '-');
  if (Object.prototype.hasOwnProperty.call(COLOR_NAMES, k)) return COLOR_NAMES[k];
  const m = HEX.exec(k);
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((x) => x + x).join('') : m[1];
  return parseInt(h, 16);
}

/** `#rrggbb` for a number. */
export const hexOf = (n) => `#${(n ?? 0).toString(16).padStart(6, '0')}`;

function cleanPart(p, at, fail) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return fail(`${at} must be an object`);
  const o = {};
  if (p.color != null) { const n = parseColor(p.color); if (n == null) return fail(`${at}.color is not a colour name or hex code`); o.color = typeof p.color === 'string' ? p.color.trim().toLowerCase() : hexOf(n); }
  if (p.material != null) { if (!MATERIALS.includes(p.material)) return fail(`${at}.material must be one of ${MATERIALS.join(', ')}`); o.material = p.material; }
  if (p.finish != null) { if (!FINISHES.includes(p.finish)) return fail(`${at}.finish must be one of ${FINISHES.join(', ')}`); o.finish = p.finish; }
  return o;
}

/**
 * Validate a `look` object. Strict: unknown colour, material or finish names fail, text is plain.
 * @returns {{ok: true, look: object} | {ok: false, error: string}}
 */
export function validateLook(look, at = 'look') {
  let err = null; const fail = (e) => { err = e; return null; };
  if (!look || typeof look !== 'object' || Array.isArray(look)) return { ok: false, error: `${at} must be an object` };
  const o = cleanPart(look, at, fail); if (err) return { ok: false, error: err };
  if (look.basis != null) { if (!BASES.includes(look.basis)) return { ok: false, error: `${at}.basis must be renter, manufacturer or assumed` }; o.basis = look.basis; }
  if (look.assumed != null) {
    if (!Array.isArray(look.assumed) || look.assumed.length > 12 || !look.assumed.every((x) => plain(x, 30))) return { ok: false, error: `${at}.assumed must be a short list of field or part names` };
    o.assumed = [...look.assumed];
  }
  if (look.note != null) { if (!plain(look.note, 300)) return { ok: false, error: `${at}.note must be plain text` }; o.note = look.note; }
  if (look.parts != null) {
    if (!look.parts || typeof look.parts !== 'object' || Array.isArray(look.parts) || Object.keys(look.parts).length > 8) return { ok: false, error: `${at}.parts must be an object of named parts` };
    o.parts = {};
    for (const [name, p] of Object.entries(look.parts)) {
      if (!/^[a-z][a-z0-9-]{0,23}$/.test(name)) return { ok: false, error: `${at}.parts: "${String(name).slice(0, 24)}" is not a part name` };
      const c = cleanPart(p, `${at}.parts.${name}`, fail); if (err) return { ok: false, error: err };
      o.parts[name] = c;
    }
  }
  return { ok: true, look: o };
}

/** A look ready to draw: colour as a number, plus the material and finish when given. Null when there is nothing to draw from. */
export function resolveLook(look) {
  if (!look || typeof look !== 'object') return null;
  const color = parseColor(look.color), out = {};
  if (color != null) out.color = color;
  if (MATERIALS.includes(look.material)) out.material = look.material;
  if (FINISHES.includes(look.finish)) out.finish = look.finish;
  return Object.keys(out).length ? out : null;
}

/** The resolved look of a layout item (`it.look`), or null. */
export const lookOf = (it) => resolveLook(it?.look);

/** The resolved look of one named part of a piece (`look.parts[name]`), or null: the model then uses its own default. */
export const partLook = (it, name) => resolveLook(it?.look?.parts?.[name]);

/**
 * Where a piece's look comes from, for the accuracy chip and the inventory list: 'renter' when the renter gave it, 'manufacturer' when it is read from a maker's pictures, else 'assumed'.
 * With `field` (a field or part name), a renter look still says 'assumed' for the fields its `assumed` list names.
 */
export function lookBasis(look, field = null) {
  if (look?.basis === 'manufacturer') return 'manufacturer';
  if (!look || look.basis !== 'renter') return 'assumed';
  if (field && Array.isArray(look.assumed) && look.assumed.includes(field)) return 'assumed';
  return 'renter';
}

const label = (c) => (typeof c === 'string' ? c.replace(/-/g, ' ') : c);
/** A short phrase for a look: "black leather, sheen finish". Empty when the piece has no look. */
export function describeLook(look) {
  if (!look) return '';
  const head = [look.color != null ? label(typeof look.color === 'number' ? hexOf(look.color) : look.color) : '', look.material || ''].filter(Boolean).join(' ');
  return [head, look.finish ? `${look.finish} finish` : ''].filter(Boolean).join(', ');
}

/**
 * Join the inventory's looks onto layout items by id (and ref): an item's own `look` wins, a piece with no look leaves the item
 * alone. Returns new items; the inputs are not changed.
 */
export function applyLooks(items, inv) {
  const by = new Map((inv?.pieces || []).filter((p) => p.look).map((p) => [p.id, p]));
  if (!by.size) return items;
  return (items || []).map((it) => { const p = by.get(it.id) || (it.from ? by.get(it.from) : null); return p && p.ref === it.ref && !it.look ? { ...it, look: p.look } : it; });
}

/** Counts of the inventory's looks by basis: how many pieces have a look from the renter, how many only a stand-in. */
export function lookSummary(inv) {
  const pieces = (inv?.pieces || []).filter((p) => !p.candidate); let renter = 0, assumed = 0;   // a candidate purchase is not one of the renter's pieces
  for (const p of pieces) (lookBasis(p.look) === 'renter' ? renter++ : assumed++);
  return { renter, assumed, total: pieces.length };
}
