// What a window is made of, as pure data (no three.js, so node tests can read it): the frame's size, where the posts stand and which clear panes
// are left. Shared by room3d/windows.js. Plan frame: inches.
export const FRAME = { member: 2, depth: 2.6, colour: 0x3b3a38 };   // inches: 2 in is about 5 cm

/**
 * What a window is made of, from the window's own data. Pure (no three.js), so it is testable.
 * @param {{len:number, sill:number, head:number, mullions?:number[], transom?:number|null}} w  inches; `mullions` fractions in (0,1) along the window
 * @param {{skipA?:boolean, skipB?:boolean}} joins  true at an end where a neighbouring pane draws the shared post
 * @returns {{posts: {s:number, w:number}[], rails: {z:number, h:number}[], glass: {s0:number, s1:number, z0:number, z1:number}[]}}
 *   s = offset along the window from its middle (inches); rails are horizontal members (`z` = bottom height, `h` thickness), glass the clear panes
 */
export function windowLayout(w, joins = {}) {
  const m = FRAME.member, half = w.len / 2, posts = [], rails = [];
  // the outer ends: a post flush inside the end. Where a neighbouring pane joins, one pane draws the shared post (so it is drawn once).
  if (!joins.skipA) posts.push({ s: -half + m / 2, w: m });
  if (!joins.skipB) posts.push({ s: half - m / 2, w: m });
  const marks = [...new Set((Array.isArray(w.mullions) ? w.mullions : []).filter((f) => Number.isFinite(f) && f > 0.04 && f < 0.96).map((f) => Math.round(f * 1000) / 1000))].sort((a, b) => a - b);
  for (const f of marks) posts.push({ s: -half + f * w.len, w: m });
  rails.push({ z: w.sill, h: m }, { z: w.head - m, h: m });                                   // the frame's own sill and head, at the glass edges
  if (Number.isFinite(w.transom) && w.transom > w.sill + m && w.transom < w.head - 2 * m) rails.push({ z: w.transom - m / 2, h: m });   // only when the plan says so
  // glass: one pane between the posts, running into the frame's rebate (the frame members overlap its edges), so its width is the window's width
  const cuts = [-half, ...posts.filter((p) => Math.abs(p.s) < half - m).map((p) => p.s).sort((a, b) => a - b), half];
  const glass = [];
  const zs = [w.sill, w.head, ...rails.filter((r) => r.z > w.sill + m && r.z < w.head - 2 * m).map((r) => r.z + r.h / 2)].sort((a, b) => a - b);
  for (let i = 0; i + 1 < cuts.length; i++) for (let j = 0; j + 1 < zs.length; j++) {
    const s0 = cuts[i], s1 = cuts[i + 1];
    if (s1 - s0 > 1 && zs[j + 1] - zs[j] > 1) glass.push({ s0, s1, z0: zs[j], z1: zs[j + 1] });
  }
  return { posts, rails, glass };
}
