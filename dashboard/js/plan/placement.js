// Where the renter's furniture stands, decided in one place for both 3D engines (the Floor plan studio and Unit 3D's Inside view).
// Pure (no DOM, no three.js), so node:test covers it.
//
// The rule: a piece the renter has placed (dragged, turned, nudged, added, or chosen in a layout) stays exactly where it is, in both
// views, across reloads, until they move it. Nothing automatic may move it. Automatic placement may only fill pieces the renter has not
// placed: a piece that is not placed follows the plan's default layout (its first `layouts` entry, data in the plan file), and a piece
// of "Your furniture" that no layout holds yet is fitted into the free space around the placed ones.
//
// The three inputs, in order of authority:
//   1. the renter's saved layout (browser storage, or the layout a local project carries): `placed` pieces are final;
//   2. the plan's default layout (`model.layouts[0]`), for every piece that is not placed and every piece missing from the saved one;
//   3. an automatic fit (plan/fit.js) for a piece of "Your furniture" that neither holds.
// Which bed is shown (the renter's own, a candidate they may buy, none) is the pieces' own `hidden` marks (plan/choices.js), saved with the layout by this same rule; switching it never moves a piece.
// Sizes, labels, colours and the desk set come from the inventory (furniture.json), joined by id, so a size changed there reaches every
// layout; a size on a layout item is a deliberate override (a variant, a product, a size typed in the inspector).
import { applyLooks } from './looks.js';
import { fitOne } from './fit.js';
import { fitInventory, kitFromInventory } from './inventory.js';
import { suggestLayout } from './suggest.js';
import { resolve } from './catalog.js';
import { validateLayout } from './layout.js';

const SIZE_KEYS = ['w', 'd', 'h', 'elev'];
const near = (a, b, eps = 0.6) => Math.abs(a - b) <= eps;
const angNear = (a, b) => Math.abs((((a || 0) - (b || 0)) % 360 + 540) % 360 - 180) <= 0.6;

/** Key of the renter's saved layout for a plan in browser storage (the studio writes it; Unit 3D reads it). */
export const layoutKey = (base, id) => `plan.${base}.${id}`;
/** Key of the local plan projects (a complete project can carry its own layout). */
export const libraryKey = (base) => `plan-projects.${base}`;

/** The renter's saved layout for a plan, validated piece by piece (one bad piece is skipped, the rest keep their places). Null when there is none. */
export function savedLayoutFor(store, base, id) {
  let raw = null;
  try { const lib = store.get(libraryKey(base), {}); raw = lib && typeof lib === 'object' ? lib[id]?.layout : null; } catch { raw = null; }
  if (!raw) { try { raw = store.get(layoutKey(base, id), null); } catch { raw = null; } }
  if (!raw) return null;
  const v = validateLayout(raw, { planId: id, lenient: true });
  return v.ok ? v : null;
}

/** True when the renter put this piece where it is. */
export const isPlaced = (it) => !!it?.placed;

/** The plan's default layout: its first `layouts` entry, else the renter's own pieces fitted with the checks, else the starter kit. Null when nothing can be placed. */
export function defaultLayout(model, inventory) {
  if (model.layouts?.[0]) return model.layouts[0];
  try {
    if (inventory?.pieces?.length) { const r = fitInventory(model, inventory, { step: 8 }); return { id: 'your-furniture', name: r.name, note: r.note, items: r.items, auto: true }; }
    return suggestLayout(model);
  } catch { return null; }
}

/**
 * Fill an item's missing size, label, variant, product, look and desk set from the renter's piece with the same id and ref. An item
 * that names its own variant or product keeps its own size (the piece's size is for the model it is). Returns new items.
 */
export function applyInventory(items, inventory) {
  const by = new Map((inventory?.pieces || []).map((p) => [p.id, p]));
  const out = (items || []).map((it) => {
    const p = by.get(it.id);
    if (!p || p.ref !== it.ref) return it;
    const o = { ...it }, own = !!(it.variant || it.product);
    if (!own) { for (const k of SIZE_KEYS) if (o[k] == null && p[k] != null) o[k] = p[k]; if (!o.variant && p.variant) o.variant = p.variant; if (!o.product && p.product) o.product = p.product; }
    if (!o.label && p.label) o.label = p.label;
    if (p.set && !o.set) o.set = p.set;
    if (p.spec && !o.spec) o.spec = p.spec;   // [bed option] the maker's dimensions by part (plan/bedspec.js), joined by id like the size
    if (p.states && !o.states) o.states = p.states;   // the piece's own sizes per state (a sofa bed: upright, lounger, bed)
    if (p.assumed && !o.assumed) o.assumed = p.assumed;
    return o;
  });
  return applyLooks(out, inventory);
}

/** An item as a default layout holds it, without the sizes and label the inventory supplies (the inventory is the one place for those). */
function fromDefault(d, by) {
  const p = by.get(d.id), o = { ...d }; delete o.look;
  if (p && p.ref === d.ref && !d.variant && !d.product) { for (const k of [...SIZE_KEYS, 'label']) delete o[k]; }
  return o;
}

/** Did a layout saved before `placed` marks hold this piece at a position an earlier default gave it (so the renter never moved it)? */
function untouched(it, replaces) {
  return (replaces || []).some((set) => set.some((r) => r.id === it.id && near(r.x, it.x) && near(r.y, it.y) && angNear(r.rot, it.rot)));
}

/**
 * The layout to show: the renter's saved layout with the default and the automatic fit filling only what is not placed.
 * @param {{model: object, inventory?: object|null, saved?: {layout: object}|null}} a  `saved` is validateLayout(..., {lenient: true})'s result
 * @returns {{items: object[], source: 'default'|'saved', changed: boolean, filled: string[], followed: string[], removed: string[], legacy: boolean}}
 *   `changed`: the result differs from what was saved, so the studio saves it (a default alone is not saved until the renter acts)
 */
export function resolveLayout({ model, inventory = null, saved = null }) {
  const def = defaultLayout(model, inventory), defItems = def?.items || [], by = new Map((inventory?.pieces || []).map((p) => [p.id, p]));
  const defBy = new Map(defItems.map((d) => [d.id, d]));
  if (!saved?.layout) return { items: defItems.map((d) => fromDefault(d, by)), source: 'default', changed: false, filled: [], followed: [], removed: [], legacy: false };

  const lay = saved.layout, legacy = !(lay.ver >= 2), removed = new Set(lay.removed || []), replaces = model.layouts?.[0]?.replaces;
  const out = [], filled = [], followed = [], seen = new Set();
  let changed = !!saved.dropped?.length || legacy;
  for (const raw of lay.items) {
    seen.add(raw.id);
    let it = { ...raw };
    const p = by.get(it.id);
    if (legacy && p && p.ref === it.ref && !it.variant && !it.product) { for (const k of [...SIZE_KEYS, 'label']) delete it[k]; delete it.look; }   // sizes baked in by an older build are stale: the inventory knows the real ones
    const placed = legacy ? !untouched(raw, replaces) : isPlaced(raw);
    if (placed) it.placed = true; else delete it.placed;
    if (!placed) {   // not placed by the renter: it follows the plan's default layout, when there is a piece for it there
      const d = defBy.get(it.id);
      if (d) {   // the default's own piece, even when it is another model now (the renter's dresser was corrected from a MALM to a STORKLINTA)
        const next = { ...fromDefault(d, by), ...(it.hidden ? { hidden: true } : {}) };
        if (!near(next.x, it.x, 0.05) || !near(next.y, it.y, 0.05) || !angNear(next.rot, it.rot)) { followed.push(it.id); changed = true; }
        it = next;
      }
    }
    out.push(it);
  }
  if (!legacy && lay.items.length) {
    for (const d of defItems) if (!seen.has(d.id) && !removed.has(d.id)) { out.push(fromDefault(d, by)); seen.add(d.id); filled.push(d.id); changed = true; }
    if (inventory?.pieces?.length) {   // a piece of "Your furniture" that no layout holds: fitted into the free space around the others, which stay where they are
      const kit = new Map(kitFromInventory(inventory).map((q) => [q.id, q]));
      for (const piece of inventory.pieces) {
        if (seen.has(piece.id) || removed.has(piece.id) || !kit.has(piece.id)) continue;
        const placedNow = applyInventory(out, inventory).map((x) => resolve(x)).filter(Boolean);
        const spot = fitOne(model, placedNow, kit.get(piece.id));
        if (spot) { out.push({ id: piece.id, ref: piece.ref, x: Math.round(spot.x * 10) / 10, y: Math.round(spot.y * 10) / 10, rot: spot.rot }); seen.add(piece.id); filled.push(piece.id); changed = true; }
      }
    }
  }
  return { items: out, source: 'saved', changed, filled, followed, removed: [...removed], legacy };
}

/** `a` and `b` place every piece at the same spot (position to a tenth of an inch, rotation to a degree). */
export function samePlaces(a, b) {
  if (a.length !== b.length) return false;
  const by = new Map(b.map((x) => [x.id, x]));
  return a.every((x) => { const y = by.get(x.id); return y && y.ref === x.ref && near(x.x, y.x, 0.06) && near(x.y, y.y, 0.06) && angNear(x.rot, y.rot) && !!x.hidden === !!y.hidden; });
}
