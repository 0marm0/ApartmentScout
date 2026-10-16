// The geometry of a rotating L desk with a two-tier S shelf (the Bestier 51 in rotating desk in furniture.json): a desk (a slab top on one
// full-depth panel leg) and a shelf unit that pivots under the desk's inner end and swings out. Pure (no DOM, no three.js), so node:test
// covers it and the fit checks, the 2D plan and both 3D engines read the same numbers.
//
// The numbers come from the piece's `spec` in furniture.json (each tagged `diagram` for the maker's dimension drawing, `measured` for read
// off the maker's product photos, or `assumed`); the defaults here are the same values, so a desk with no spec is still this desk.
//
// Frames. The item's own frame: origin at the centre of the footprint on the floor, x to the right as seen from the front, z to the FRONT
// (the side a person sits), y up. `hand` is the side the desk's panel leg is on, seen from the front: 'right' (the renter's photos) or 'left'
// (the same desk assembled the other way, which the maker's pictures show too). The shelf unit's own axes: u along its length from the end that
// pivots under the desk (0) to the far end (L), v across it from its rear edge (0) to its front edge (D).
//
// The pivot. The maker publishes no pivot and no overlap. Derived here from the maker's L-shaped box size (51.18 x 46.85 in) and the maker's
// straight product photo: the unit turns about a point `p` in from the desk's inner end and `p` in from its back edge, which is also `p`
// in from the shelf unit's end and rear edge, with p = overlap / 2. Then the shelf's rear edge is flush with the desk's back in both
// shapes, and the L is exactly 51.8 (the desk) x 46.9 (the shelf's length) deep, the published L footprint. The overlap (how far the shelf
// runs under the desk's inner end when straight) follows from the straight length, which is the one number to measure: `straight.total`
// (about 89 in, derived from the maker's photo, not published).

export const ROTATING_STYLE = 'rotating-l';
/** The catalogue variant (on the `desk` entry) that draws this desk. */
export const ROTATING_VARIANT = 'rotating';
export const CONFIGS = ['straight', 'l_shape'];
export const HANDS = ['right', 'left'];

const num = (v, fallback) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/** The spec's numbers with the defaults (the maker's drawing) the model needs. */
export function dimsOf(spec) {
  const t = spec?.top || {}, s = spec?.shelf || {}, st = spec?.straight || {}, l = spec?.leg || {};
  const out = {
    top: { l: num(t.l, 51.8), d: num(t.d, 21.6), t: num(t.t, 1.65), h: num(t.h, 29.1) },
    shelf: { l: num(s.l, 46.9), d: num(s.d, 13.4), h: num(s.h, 27.6), t: num(s.t, 1.65), post: num(s.post_r, 0.5), inset: num(s.post_inset, 3.2), topAtPivot: num(s.top_panel_at_pivot, 1) >= 0.5 },
    leg: { t: num(l.t, 1.65) },
    total: num(st.total, 89.2),
  };
  out.tier = (out.shelf.h - 3 * out.shelf.t) / 2;   // the clear height of each tier: the maker draws 11.3 in
  out.overlap = out.top.l + out.shelf.l - out.total;   // how far the shelf runs under the desk's inner end when straight
  out.pivot = out.overlap / 2;
  return out;
}

/** Footprint of the desk in a configuration: { w, d } in inches. */
export function footprintOf(spec, config = 'straight') {
  const g = dimsOf(spec);
  return config === 'l_shape' ? { w: g.top.l, d: Math.max(g.top.d, g.shelf.l) } : { w: g.total, d: Math.max(g.top.d, g.shelf.d) };
}

/**
 * The boxes and posts of the desk, in the item's frame. `boxes`: {id, x0, x1, z0, z1, y0, y1}; `posts`: {id, x, z, y0, y1, r}.
 * Also `w`, `d`, `h`, the desktop's span, the shelf's span, the pivot, `seatX` (the middle of the desktop clear of the shelf, where a person
 * sits) and `total` (the straight length).
 */
export function layoutOf(spec, { config = 'straight', hand = 'right' } = {}) {
  const g = dimsOf(spec), straight = config !== 'l_shape', sgn = hand === 'left' ? -1 : 1;
  const { w, d } = footprintOf(spec, config), { top, shelf, leg, tier } = g;
  const zBack = -d / 2;
  // right-hand frame first (the leg at +x), mirrored at the end for a left-hand desk
  const dx0 = straight ? w / 2 - top.l : -w / 2, dx1 = dx0 + top.l;
  const desk = { x0: dx0, x1: dx1, z0: zBack, z1: zBack + top.d };
  // the shelf: a rectangle in (u, v) -> the frame. Straight: u runs toward -x from the pivot end under the desk; L: u runs toward the front.
  const xi = dx0;   // the desk's inner end
  const endU = straight ? xi + g.overlap : null;   // where the pivot end of the shelf is, when straight
  const at = (u0, u1, v0, v1) => (straight
    ? { x0: endU - u1, x1: endU - u0, z0: zBack + v0, z1: zBack + v1 }
    : { x0: xi + v0, x1: xi + v1, z0: zBack + u0, z1: zBack + u1 });
  const boxes = [], posts = [];
  const B = (id, r, y0, y1) => boxes.push({ id, ...r, y0, y1 });
  const topT = top.t, H = top.h;
  B('desktop', desk, H - topT, H);
  B('leg', { x0: dx1 - leg.t, x1: dx1, z0: desk.z0, z1: desk.z1 }, 0, H - topT);
  const L = shelf.l, D = shelf.d, t = shelf.t, y1 = t, y2 = t + tier, y3 = 2 * t + tier, y4 = 2 * t + 2 * tier;   // bottom board [0,t], middle [y2,y3], top [y4, y4+t]
  B('shelf-bottom', at(0, L, 0, D), 0, t);
  B('shelf-middle', at(0, L, 0, D), y2, y3);
  B('shelf-top', at(0, L, 0, D), y4, shelf.h);
  // the S: one end panel on each tier, at opposite ends
  const upperEnd = shelf.topAtPivot ? [0, t] : [L - t, L], lowerEnd = shelf.topAtPivot ? [L - t, L] : [0, t];
  B('panel-top-tier', at(upperEnd[0], upperEnd[1], 0, D), y3, y4);
  B('panel-bottom-tier', at(lowerEnd[0], lowerEnd[1], 0, D), y1, y2);
  // silver posts at the open end of each tier, front and back
  const openU = (isTop) => ((isTop ? shelf.topAtPivot : !shelf.topAtPivot) ? L - g.shelf.inset : g.shelf.inset);
  for (const isTop of [true, false]) {
    const u = openU(isTop), [py0, py1] = isTop ? [y3, y4] : [y1, y2];
    for (const [side, v] of [['rear', g.shelf.inset], ['front', D - g.shelf.inset]]) {
      const r = at(u, u, v, v);
      posts.push({ id: `post-${isTop ? 'top' : 'bottom'}-${side}`, x: r.x0, z: r.z0, y0: py0, y1: py1, r: shelf.post });
    }
  }
  const shelfRect = at(0, L, 0, D);
  // mirror for a left-hand desk
  const mx = (r) => (sgn < 0 ? { ...r, x0: -r.x1, x1: -r.x0 } : r);
  const outBoxes = boxes.map((b) => ({ ...b, ...mx(b) })), outPosts = posts.map((p) => ({ ...p, x: p.x * sgn }));
  const usable = [xi + (straight ? g.overlap : D), dx1 - leg.t];   // the desktop clear of the shelf unit, where a person sits
  const seat = (usable[0] + usable[1]) / 2;
  return {
    config: straight ? 'straight' : 'l_shape', hand: sgn < 0 ? 'left' : 'right', w, d, h: H,
    boxes: outBoxes, posts: outPosts, desk: mx(desk), shelf: mx(shelfRect), seatX: seat * sgn, usable: mx({ x0: usable[0], x1: usable[1] }),
    pivot: { x: sgn * (xi + g.pivot), z: zBack + g.pivot },
    total: g.total, overlap: g.overlap, tier, dims: g,
  };
}
