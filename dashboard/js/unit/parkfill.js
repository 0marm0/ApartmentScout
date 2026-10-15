// Where the 3D views add canopy that is NOT in a tree inventory, and which polygon a point stands in. Pure and
// deterministic (no DOM, no three.js), shared by unit/trees.js (the tree plan).
//
// Real trees come first: the NYC Street Tree Census and the NYC Parks Forestry inventory (`green.census`,
// `green.forestry`, see geo/trees.py and geo/forestry.py) and trees mapped in OpenStreetMap. A park polygon gets
// invented canopy (a blue-noise "fill") only where no inventory describes it:
//
//   * a polygon outside NYC Parks property (private plazas, the Tudor City Greens, any city but New York) has no
//     inventory behind it: it gets the dense fill, `FILL[kind]`, at a density read off the Parks inventory itself;
//   * a polygon on Parks property (`on_parks`) is covered by the inventory, so its real trees are all it gets, except
//     where the inventory is clearly thin for a park that size (`SPARSE_PER_HA`, e.g. the plane trees of Bryant Park
//     are maintained by a conservancy and are not in it): those get the fill at `TOPUP` of the dense rate, around the
//     real trees;
//   * paved ground (playgrounds, courts, plazas, turf fields) and open lawns inside a park (`open`) get none; the fill is
//     vetoed inside them, so a lawn mapped inside a park stays open. A lawn that stands alone (a planted plaza, a strip
//     beside a ramp) is not inside a park: it gets the `lawn` fill, trees along its edge.
//
// Density targets (trees per hectare) come from the Parks inventory around Midtown: St. Vartan Park holds about 95 a
// hectare, the Tudor City playgrounds and malls 165-245, Dag Hammarskjold Plaza 200, a typical neighbourhood park 60-110.

import { inPoly, ringArea } from './green.js';

/** Parks property is thin in the inventory below this many trees per hectare (and above `SPARSE_MIN_M2`): top up the fill. */
export const SPARSE_PER_HA = 30;
export const SPARSE_MIN_M2 = 1500;
/** The share of the dense fill added to a thin Parks polygon (the inventory trees stay; the fill keeps clear of them). */
export const TOPUP = 0.55;
/** The closest the fill comes to a real tree (m): a real crown is already there. */
export const REAL_CLEAR_M = 4;

/**
 * A grid index over polygons: `at(x, y)` returns the polygons containing the point (holes respected), nearest the
 * front of the list first by index. Polygons are {ring, holes?, ...}; the index keeps them as given.
 */
export function polyIndex(polys, cell = 80) {
  const grid = new Map(), bbs = [];
  polys.forEach((p, i) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of p.ring) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    bbs.push([x0, y0, x1, y1]);
    for (let gx = Math.floor(x0 / cell); gx <= Math.floor(x1 / cell); gx++) for (let gy = Math.floor(y0 / cell); gy <= Math.floor(y1 / cell); gy++) {
      const k = gx + ',' + gy; (grid.get(k) || grid.set(k, []).get(k)).push(i);
    }
  });
  return {
    at(x, y) {
      const out = [];
      for (const i of grid.get(Math.floor(x / cell) + ',' + Math.floor(y / cell)) || []) {
        const b = bbs[i]; if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) continue;
        const p = polys[i]; if (inPoly(x, y, { ring: p.ring, holes: p.holes || [] })) out.push(p);
      }
      return out;
    },
  };
}

/** Area of a polygon's solid part in m² (the ring minus its holes). */
export function polyArea(p) {
  return Math.abs(ringArea(p.ring)) - (p.holes || []).reduce((a, h) => a + Math.abs(ringArea(h)), 0);
}

/**
 * Which polygons get the fill, and how much: [{poly, k, share}] with `share` 1 for the dense rate and TOPUP for a thin
 * Parks polygon. `k` is the polygon's index in `polys` (the random stream is per polygon, so adding one elsewhere moves no tree).
 */
export function fillTargets(polys) {   // `open`: a lawn inside a park (set by treePlan)
  const out = [];
  polys.forEach((p, k) => {
    if (p.hard || p.turf || p.kind === 'play' || p.open) return;
    if (p.on_parks) {
      if (p.kind === 'grass') return;
      const area = polyArea(p), inv = Number.isFinite(+p.inv) ? +p.inv : null;
      if (inv === null || area < SPARSE_MIN_M2 || inv / (area / 1e4) >= SPARSE_PER_HA) return;
      out.push({ poly: p, k, share: TOPUP });
      return;
    }
    out.push({ poly: p, k, share: 1 });
  });
  return out;
}

/** A fast "is a real tree within `clear` metres" test over a list of {x, y} (bucketed on a grid). */
export function treeIndex(clear = REAL_CLEAR_M) {
  const grid = new Map();
  return {
    add(x, y) { const k = Math.floor(x / clear) + ',' + Math.floor(y / clear); (grid.get(k) || grid.set(k, []).get(k)).push([x, y]); },
    near(x, y) {
      const cx = Math.floor(x / clear), cy = Math.floor(y / clear);
      for (let i = cx - 1; i <= cx + 1; i++) for (let j = cy - 1; j <= cy + 1; j++) for (const [qx, qy] of grid.get(i + ',' + j) || []) if (Math.hypot(qx - x, qy - y) < clear) return true;
      return false;
    },
  };
}

