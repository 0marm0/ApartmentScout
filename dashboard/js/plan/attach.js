// A piece attached to another: the renter's office chair follows their desk. Pure (no DOM, no three.js), so node:test covers it and the
// studio, the plan's default layout and the saved layout all answer the same way.
//
// The data is one field on a layout item: `attach: "<id of the desk>"`. An attached piece keeps its own position and turn in the layout like
// any piece (every view, check and export reads it as an ordinary item); what the mark adds is that when its desk moves or turns the piece
// moves and turns with it as one rigid body, keeping its offset at the desktop. A free piece (no `attach`) never follows anything. The rule
// of plan/placement.js stands: a piece the renter placed never moves by itself; an attached piece moves only with its desk, and only when
// the desk moved and the piece itself did not (so undo, loading a layout or dragging the chair on its own are never "followed" twice).
import { axes } from './checks.js';

const near = (a, b) => Math.abs(a - b) < 1e-6;
const same = (p, q) => near(p.x, q.x) && near(p.y, q.y) && near((((p.rot || 0) % 360) + 360) % 360, (((q.rot || 0) % 360) + 360) % 360);
/** The pieces that can be attached (an office chair). */
export const isAttachable = (it) => it?.ref === 'task-chair';
/** The pieces a chair can be attached to (a desk). */
export const isDesk = (it) => it?.ref === 'desk';

/** Point `p` in the frame of item `o` ({x, y, rot}): [across, along] as toWorld (plan/checks.js) takes them. */
function toLocal(o, p) {
  const { r, b } = axes(o.rot || 0), dx = p[0] - o.x, dy = p[1] - o.y;
  return [dx * r[0] + dy * r[1], dx * b[0] + dy * b[1]];
}
function toWorldAt(o, l) {
  const { r, b } = axes(o.rot || 0);
  return [o.x + l[0] * r[0] + l[1] * b[0], o.y + l[0] * r[1] + l[1] * b[1]];
}

/**
 * Items after a desk moved or turned: every piece attached to it that did not move itself goes along, rigidly. `prev` is the items before
 * (anything with id, x, y, rot), `next` the items now. Returns `next` itself when nothing follows, else a new list with new items for the
 * pieces that moved (the others keep their identity).
 */
export function followAttached(prev, next) {
  if (!prev?.length || !next?.length || !next.some((x) => x.attach)) return next;
  const was = new Map(prev.map((x) => [x.id, x])), now = new Map(next.map((x) => [x.id, x]));
  let changed = false;
  const out = next.map((it) => {
    if (!it.attach) return it;
    const desk = now.get(it.attach), d0 = was.get(it.attach), me = was.get(it.id);
    if (!desk || !d0 || !me || !same(me, it) || same(d0, desk)) return it;   // no desk, or it moved itself, or the desk stayed
    const [x, y] = toWorldAt(desk, toLocal(d0, [it.x, it.y]));
    changed = true;
    return { ...it, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, rot: ((Math.round(((it.rot || 0) + (desk.rot || 0) - (d0.rot || 0)) * 10) / 10) % 360 + 360) % 360 };
  });
  return changed ? out : next;
}

/** Is this chair attached to a desk that is in the layout? */
export const isAttached = (items, id) => { const c = items.find((x) => x.id === id); return !!(c?.attach && items.some((x) => x.id === c.attach && isDesk(x))); };

/** The desk nearest to a piece: the item to attach it to, or null. `list` = items, hidden ones included. */
export function nearestDesk(list, it) {
  let best = null, bd = Infinity;
  for (const d of list) if (isDesk(d) && d.id !== it.id) { const k = Math.hypot(d.x - it.x, d.y - it.y); if (k < bd) { bd = k; best = d; } }
  return best;
}

/**
 * Where a chair stands at a desk: pulled up to the desktop in front of the middle of the desktop clear of the shelf (`desk.seatX`), turned to face
 * it; with `aside` (a sim rig takes that spot) at the other end of the desk, beside the shelf. `desk` is the resolved desk (x, y, rot, d, seatX).
 * @returns {{x: number, y: number, rot: number}}
 */
export function seatAtDesk(desk, { aside = false } = {}) {
  const lx = aside ? -(desk.seatX || 0) : desk.seatX || 0, ly = -(desk.d / 2 + 10);
  const [x, y] = toWorldAt(desk, [lx, ly]);
  return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, rot: (((desk.rot || 0) + 180) % 360 + 360) % 360 };
}
