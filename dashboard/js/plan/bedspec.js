// The geometry of a bed that is more than a box: a platform bed with a tall headboard unit, two side towers and a floating nightstand on
// each tower (the Latitude Run storage bed in furniture.json, a candidate purchase). Pure (no DOM, no three.js), so node:test covers it
// and the fit checks, the 2D plan and both 3D engines read the same numbers.
//
// The numbers come from the piece's `spec` in furniture.json (manufacturer dimensions, each tagged `spec` for the retailer's
// specification table or `diagram` for read off the maker's drawing); nothing here is a second copy of them. Without a `spec` a bed is
// the plain rectangle w x d the catalogue gives it.
//
// Frames. The item's own frame is the catalogue's: origin at the centre of the footprint, local +x to the right, local +y to the BACK (the
// headboard wall). `wall distance` s is the distance from the headboard's back face toward the foot: s = d/2 - y. Heights are inches
// above the floor. A part is {id, kind, x0, x1, y0, y1, z0, z1} in that frame.

/** The key a catalogue entry uses for this model. */
export const TOWER_STYLE = 'tower-storage';

const num = (v, fallback) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/** The spec's numbers with the defaults the model needs: everything the drawing code and the checks read, in one place. Null without a spec. */
export function dimsOf(spec) {
  if (!spec || typeof spec !== 'object') return null;
  const o = spec.overall || {}, h = spec.headboard || {}, n = spec.nightstand || {}, f = spec.frame || {}, m = spec.mattress || {}, dr = spec.drawers || {};
  const W = num(o.w, 94), D = num(o.d, 83.3), H = num(o.h, 47.4);
  const out = {
    W, D, H,
    head: { depth: num(h.depth, 3.9), towerW: num(h.tower_w, 16.7), towerDepth: num(h.tower_depth, 6.5), gap: num(h.centre_gap, 12), band: num(h.band_h, 3), rail: num(h.top_rail_h, 3), lid: num(h.cubby_lid_h, 5.1), pad: num(h.panel_pad, 1.2) },
    stand: { w: num(n.w, 16.7), d: num(n.d, 17), h: num(n.h, 8.3), bottom: num(n.bottom, 12), drawerW: num(n.drawer_w, 11.3), drawerD: num(n.drawer_d, 13.9), drawerH: num(n.drawer_h, 3.4) },
    frame: { w: num(f.w, 60.5), rail: num(f.rail_h, 13), clear: num(f.clearance, 4.5), slatInset: num(f.slat_inset, 2), legs: num(f.centre_legs, 3), board: num(f.board_t, 0.25) },
    mattress: { w: num(m.w, 60), d: num(m.d, 80), h: num(m.h, 12) },
    drawers: { perSide: num(dr.per_side, 2), l: num(dr.front_l, 30.7), h: num(dr.front_h, 11.8), basket: { l: num(dr.basket_l, 25.4), w: num(dr.basket_w, 17), h: num(dr.basket_h, 4.7) }, pull: num(dr.pull, 17), caster: num(dr.caster_d, 2) },
  };
  out.rim = out.frame.clear + out.frame.rail;                        // the top of the side rails
  out.slat = out.rim - out.frame.slatInset;                          // the top of the slats the mattress lies on
  out.mattressTop = out.slat + out.mattress.h;
  out.drawerRun = out.drawers.perSide * out.drawers.l;               // how much of each side the drawer fronts take, from the foot end
  out.drawerStart = D - out.drawerRun;                               // wall distance where the drawer run begins (nearest the headboard)
  return out;
}

/** The part rectangles of a bed with a spec, in the item's frame (+y back), or null when the item has no spec. `w`, `d` are the item's resolved size. */
export function partsOf(spec, w, d) {
  const g = dimsOf(spec); if (!g) return null;
  const hd = d / 2, hw = w / 2, tw = g.head.towerW, fw = g.frame.w / 2;
  const P = (id, kind, x0, x1, s0, s1, z0, z1) => ({ id, kind, x0, x1, y0: hd - s1, y1: hd - s0, z0, z1 });
  const out = [P('headboard', 'headboard', -fw, fw, 0, g.head.depth, g.mattressTop, g.H)];   // the centre section: from the mattress top up
  for (const sx of [-1, 1]) {
    out.push(P(sx < 0 ? 'tower-left' : 'tower-right', 'tower', sx < 0 ? -hw : hw - tw, sx < 0 ? -hw + tw : hw, 0, g.head.towerDepth, 0, g.H));
    out.push(P(sx < 0 ? 'nightstand-left' : 'nightstand-right', 'nightstand', sx < 0 ? -hw : hw - g.stand.w, sx < 0 ? -hw + g.stand.w : hw, g.head.towerDepth, g.stand.d, g.stand.bottom, g.stand.bottom + g.stand.h));
  }
  out.push(P('frame', 'frame', -fw, fw, g.head.depth, g.D, g.frame.clear, g.mattressTop));   // the platform and the mattress on it
  return out;
}

/** The side-drawer runs as a clearance zone's `at` (local x of the frame's side) and `along` (local y range): from the foot end to where the nightstands begin. */
export function drawerRun(spec, d) {
  const g = dimsOf(spec); if (!g) return null;
  return { at: g.frame.w / 2, along: [-d / 2, d / 2 - g.drawerStart] };
}

/** The sleeping part's rectangle in the item's frame, [x0, x1, y0, y1]: the lanes beside it and the foot zone hang off this. */
export function sleepRect(spec, d) {
  const g = dimsOf(spec); if (!g) return null;
  return [-g.frame.w / 2, g.frame.w / 2, -d / 2, d / 2 - g.head.depth];
}
