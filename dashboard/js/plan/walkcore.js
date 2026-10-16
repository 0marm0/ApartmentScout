// Walking around inside a plan: where a person of about 18 in across can stand, the way from here to there around the furniture and
// through the doors, a step that slides along walls and furniture instead of passing through them, and the nearest window to stand
// at looking out. Pure (no DOM, no three.js), in plan inches (+x right, +y up the drawing), shared by the Floor plan studio's Walk
// and Unit 3D's Inside camera so both walk the same floor and bump into the same things.
//
// The floor is the route finder's grid (plan/route.js: 2 in cells, rooms and door openings are floor; walls, window sills, fixtures
// and furniture lower than 30 in are solid) shrunk by the person's radius. A wall TV, a pendant lamp and a rug are not in the way.
import { grid, edt, CELL } from './route.js';
import { toWorld } from './checks.js';
import { windowGroups } from './viewpoints.js';

export const EYE_IN = 63;      // standing eye height: about 1.6 m
export const WALK_R = 9;       // a person's radius: 18 in across, so a 30 in walkway has room to spare
export const CHAIR_IN = 22;    // a desk's task chair, pulled out: 22 in across
const NB = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];

/** The obstacles a walker meets: the resolved items, plus a desk's chair as a piece of its own in front of it. */
export function walkItems(items) {
  const out = [];
  for (const it of items || []) {
    if (it.hidden) continue;
    out.push(it);
    if (it.kind === 'desk' && it.set?.chair !== false) {
      const [x, y] = toWorld(it, it.seatX || 0, -(it.d / 2 + 11));
      out.push({ id: `${it.id}#chair`, kind: 'chair', name: 'desk chair', x, y, rot: it.rot, w: CHAIR_IN, d: CHAIR_IN, h: 38, elev: 0 });
    }
  }
  return out;
}

class Heap {   // min-heap on key
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(k, v) { const a = this.a; a.push([k, v]); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
  pop() { const a = this.a, top = a[0], last = a.pop(); if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } } return top; }
}

/**
 * The walkable floor of a plan with its furniture.
 * @param {object} model normalised plan (plan/model.js)
 * @param {object[]} items resolved furniture (plan/catalog.js resolve)
 * @param {{radius?: number}} [o]
 */
export function walkSpace(model, items, { radius = WALK_R } = {}) {
  const G = grid(model, walkItems(items)), d2 = edt(G), { nx, ny, free, door, near, cx, cy } = G, N = nx * ny;
  const ok = new Uint8Array(N), clr = new Float32Array(N);
  for (let k = 0; k < N; k++) {
    if (!free[k]) continue;
    const c = Math.max(0, (Math.sqrt(d2[k]) - 0.5) * CELL);   // inches from the cell's centre to the nearest solid edge
    clr[k] = c;
    ok[k] = door[k] >= 0 || near[k] || c >= radius ? 1 : 0;
  }
  const idx = (x, y) => { const i = Math.floor((x - G.x0) / CELL), j = Math.floor((y - G.y0) / CELL); return i >= 0 && j >= 0 && i < nx && j < ny ? j * nx + i : -1; };
  const centre = (k) => [cx(k % nx), cy((k / nx) | 0)];
  const space = {
    G, radius,
    /** Can a person stand at this plan point? */
    canStand(x, y) { const k = idx(x, y); return k >= 0 && !!ok[k]; },
    /** Inches from a plan point to the nearest wall or furniture edge (0 outside the floor). A camera tour keeps to the roomy middle with it. */
    clearance(x, y) { const k = idx(x, y); return k >= 0 ? clr[k] : 0; },
    /** The nearest standable point within `max` inches (the point itself when it is standable), or null. */
    snap(x, y, max = 36) {
      const k0 = idx(x, y);
      if (k0 >= 0 && ok[k0]) return [x, y];
      const i0 = Math.floor((x - G.x0) / CELL), j0 = Math.floor((y - G.y0) / CELL), R = Math.ceil(max / CELL);
      let best = -1, bd = Infinity;
      for (let j = j0 - R; j <= j0 + R; j++) for (let i = i0 - R; i <= i0 + R; i++) {
        if (i < 0 || j < 0 || i >= nx || j >= ny) continue;
        const k = j * nx + i; if (!ok[k]) continue;
        const dd = (i - i0) ** 2 + (j - j0) ** 2; if (dd < bd) { bd = dd; best = k; }
      }
      return best < 0 || Math.sqrt(bd) * CELL > max ? null : centre(best);
    },
    /** Is the straight line between two plan points all standable? */
    lineClear(a, b) {
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(L / 1));
      for (let s = 0; s <= n; s++) { const t = s / n; if (!space.canStand(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)) return false; }
      return true;
    },
    /**
     * Move from a point by (dx, dy), in steps of at most 2 in: the whole step if it is standable, else sliding along one axis, else
     * staying put. Returns the new point. A person never passes through a wall or a piece of furniture, however long the step.
     */
    step(from, dx, dy) {
      let [x, y] = from; const n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 2)), sx = dx / n, sy = dy / n;
      for (let s = 0; s < n; s++) {
        if (space.canStand(x + sx, y + sy)) { x += sx; y += sy; }
        else if (sx && space.canStand(x + sx, y)) x += sx;
        else if (sy && space.canStand(x, y + sy)) y += sy;
        else break;
      }
      return [x, y];
    },
    /**
     * The way from one plan point to another around furniture and through the doors, as a short list of points (corners only), or null
     * when there is none. Both ends are snapped to the nearest standable point (the start up to 60 in, the goal up to 36 in).
     */
    route(from, to, { maxGoal = 36 } = {}) {
      const a = space.snap(from[0], from[1], 60), b = space.snap(to[0], to[1], maxGoal);
      if (!a || !b) return null;
      const s = idx(a[0], a[1]), g = idx(b[0], b[1]);
      if (s < 0 || g < 0) return null;
      if (space.lineClear(a, b)) return dedupe([from, a, b]);
      const dist = new Float64Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1), H = new Heap(), gx = g % nx, gy = (g / nx) | 0;
      const h = (k) => { const dx = Math.abs((k % nx) - gx), dy = Math.abs(((k / nx) | 0) - gy); return (dx + dy) + (Math.SQRT2 - 2) * Math.min(dx, dy); };
      dist[s] = 0; H.push(h(s), s);
      while (H.size) {
        const [, k] = H.pop();
        if (k === g) break;
        const i = k % nx, j = (k / nx) | 0, dk = dist[k];
        for (const [di, dj, c] of NB) {
          const p = i + di, q = j + dj; if (p < 0 || q < 0 || p >= nx || q >= ny) continue;
          const m = q * nx + p; if (!ok[m]) continue;
          if (di && dj && (!ok[j * nx + p] || !ok[q * nx + i])) continue;   // no cutting a corner
          const room = clr[m], v = dk + c * (1 + Math.max(0, 22 - room) * 0.05);   // prefer the middle of a passage to hugging the wall
          if (v < dist[m]) { dist[m] = v; prev[m] = k; H.push(v + h(m), m); }
        }
      }
      if (prev[g] < 0 && g !== s) return null;
      const cells = []; for (let k = g; k >= 0; k = prev[k]) cells.push(centre(k)); cells.reverse();
      return dedupe([from, ...pull([a, ...cells.slice(1, -1), b], space)]);
    },
  };
  return space;
}
const dedupe = (pts) => pts.filter((p, i) => !i || Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) > 0.5);
/** String-pulling: drop every point the walker can skip by walking straight to a later one. */
function pull(pts, space) {
  const out = [pts[0]]; let i = 0;
  while (i < pts.length - 1) {
    let j = pts.length - 1;
    while (j > i + 1 && !space.lineClear(pts[i], pts[j])) j--;
    out.push(pts[j]); i = j;
  }
  return out;
}
/** Length of a polyline, inches. */
export const pathLength = (pts) => pts.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0);

/**
 * The point `d` inches along a polyline and the direction there. `ease` shapes the pace (smooth start and stop).
 * @returns {{at: number[], dir: number[]}}
 */
export function pointAlong(pts, d) {
  let rest = Math.max(0, d);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (rest <= L || i === pts.length - 1) { const t = L ? Math.min(1, rest / L) : 1; return { at: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], dir: L ? [(b[0] - a[0]) / L, (b[1] - a[1]) / L] : [0, 1] }; }
    rest -= L;
  }
  return { at: pts[0], dir: [0, 1] };
}
/** Smooth start and stop: 0..1 in, 0..1 out. */
export const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2);

/** How far back from the glass a person stands "by the window": close enough to see straight down to the street. */
export const WINDOW_BACK = 22;

/**
 * Where to stand to look out of each window group: `back` inches inside the glass, facing out (the group's outward normal), moved to
 * standable floor. Groups the furniture shuts off (no floor within reach) are left out.
 * @returns {{group: number, room: string, kind: string, panes: number[], at: number[], dir: number[], mid: number[]}[]}
 */
export function windowStands(model, space, { back = WINDOW_BACK } = {}) {
  const out = [];
  windowGroups(model).forEach((g, gi) => {
    for (const b of [back, back + 8, back + 16, back + 26, back + 40]) {
      const want = [g.mid[0] - g.normal[0] * b, g.mid[1] - g.normal[1] * b], at = space.snap(want[0], want[1], 18);
      if (at) { out.push({ group: gi, room: g.room, kind: g.kind, panes: g.panes, at, dir: g.normal, mid: g.mid }); break; }
    }
  });
  return out;
}

/** The window stand nearest by walking to `from` (a plan point), with the way there; null when no window can be reached. */
export function nearestWindow(model, space, from, opts) {
  let best = null;
  for (const s of windowStands(model, space, opts)) {
    const route = space.route(from, s.at, { maxGoal: 6 }); if (!route) continue;
    const len = pathLength(route); if (!best || len < best.len) best = { ...s, route, len };
  }
  return best;
}

/**
 * Which window a ray passes through. `o` and `d` are the ray's origin and direction in the plan frame with a third component up (z,
 * inches); a window is its glass: the segment between its ends from its sill up to its head. Returns the window index and the distance, or null.
 */
export function windowHit(model, o, d) {
  let best = null;
  model.windows.forEach((w, i) => {
    if (!w.a || !w.b) return;
    const ex = w.b[0] - w.a[0], ey = w.b[1] - w.a[1], den = d[0] * -ey + d[1] * ex;   // solve o + t d = a + s e in the plan
    if (Math.abs(den) < 1e-9) return;
    const rx = w.a[0] - o[0], ry = w.a[1] - o[1], t = (rx * -ey + ry * ex) / den, s = (d[0] * ry - d[1] * rx) / den;
    if (t <= 0 || s < 0 || s > 1) return;
    const z = o[2] + t * d[2];
    if (z < (w.sill ?? 20) || z > (w.head ?? 84)) return;
    if (!best || t < best.t) best = { index: i, t };
  });
  return best;
}
/** The window group a window (by index) belongs to. */
export const groupOfWindow = (model, i) => windowGroups(model).findIndex((g) => g.panes.includes(i));
