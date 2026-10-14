// Bed finder and product fitting for the Floor plan studio's Shop tab. Pure (no DOM), so node:test covers it.
// Tries every real product of a piece's family in the spot the piece occupies now (headboard or back kept
// against the same wall), grades it with the same checks as the studio, and, when it does not fit there,
// looks for another spot in the same room.
import { resolve } from './catalog.js';
import { evaluate, findSpot, axes, roomOf } from './checks.js';
import { PRODUCTS, familyOf } from './products.js';

const RANK = { clear: 0, tight: 1, blocked: 2 };

/** The item with a product swapped in, its back edge kept where it was (a longer bed grows toward its foot). */
export function withProduct(item, product) {
  const before = resolve(item);
  const next = { ...item, ref: product.ref, product: product.id };
  delete next.w; delete next.d; delete next.h; delete next.variant;
  const after = resolve(next);
  if (!before || !after) return next;
  const { b } = axes(before.rot), shift = (before.d - after.d) / 2;
  next.x = Math.round((item.x + b[0] * shift) * 10) / 10; next.y = Math.round((item.y + b[1] * shift) * 10) / 10;
  return next;
}

/**
 * Grade every product that could replace `id` (same family), in place and, failing that, elsewhere in its room.
 * @param {object} model normalised plan
 * @param {object[]} items raw layout items ({id, ref, x, y, rot, ...})
 * @param {string} id the piece to replace
 * @returns {object[]} rows {product, grade, issues, where: 'here'|'moved'|null, item, w, d}
 */
export function productFinder(model, items, id, products = PRODUCTS) {
  const cur = items.find((x) => x.id === id); if (!cur) return [];
  const fam = familyOf(cur.ref), others = items.filter((x) => x.id !== id && !x.hidden).map((x) => resolve(x)).filter(Boolean);
  const room = roomOf(model, [cur.x, cur.y]), out = [];
  for (const p of products.filter((q) => fam.includes(q.ref))) {
    const cand = withProduct(cur, p), r = resolve(cand); if (!r) continue;
    let ev = evaluate(model, [...others, r]).items[id], where = 'here', item = cand;
    if (!ev || ev.state !== 'clear') {
      const s = findSpot(model, [...others, r], id, room, 8);
      if (s && (!ev || RANK[s.grade] < RANK[ev.state])) {
        item = { ...cand, x: s.x, y: s.y, rot: s.rot };
        ev = evaluate(model, [...others, resolve(item)]).items[id]; where = 'moved';
      }
    }
    out.push({ product: p, grade: ev?.state || 'blocked', issues: (ev?.issues || []).map((x) => x.text), where, item, w: r.w, d: r.d, h: r.h });
  }
  return out.sort((a, b) => RANK[a.grade] - RANK[b.grade] || (a.where === 'here' ? 0 : 1) - (b.where === 'here' ? 0 : 1) || (a.product.price ?? 1e9) - (b.product.price ?? 1e9));
}
