// "Does my furniture fit this apartment?": place a kit of furniture into a plan one piece at a time with
// the auto-placer, preferring a room of the kind it came from. Pure (no DOM), so node:test covers it.
import { findSpot, evaluate } from './checks.js';

const HABITABLE = ['living', 'bedroom', 'dining', 'office', 'other'];
const SIZE = (it) => it.w * it.d;

/** Rooms to try for a piece: the same kind first (largest first), then the other habitable rooms. */
export function roomOrder(model, kind) {
  const rooms = model.rooms.filter((r) => HABITABLE.includes(r.kind)).sort((a, b) => b.area - a.area);
  return [...rooms.filter((r) => r.kind === kind), ...rooms.filter((r) => r.kind !== kind)];
}

/**
 * Fit one more piece into a plan that already holds `placed`. Returns the placed copy or null.
 * @param {object} model normalised plan
 * @param {object[]} placed resolved items already in the plan
 * @param {object} item resolved item (its `roomKind` says where it lived before)
 */
export function fitOne(model, placed, item, step = 8) {
  let best = null;
  for (const room of roomOrder(model, item.roomKind || 'living')) {
    const it = { ...item, x: room.label[0], y: room.label[1], rot: 0 };
    const s = findSpot(model, [...placed, it], it.id, room.name, step);
    if (!s) continue;
    const cand = { ...it, x: s.x, y: s.y, rot: s.rot, _grade: s.grade, _room: room.name };
    if (!best || rank(cand._grade) < rank(best._grade)) best = cand;
    // stay in a room of the piece's own kind unless nothing fits there
    if (best._grade === 'clear' || (room.kind === (item.roomKind || 'living') && best._grade !== 'blocked')) break;
  }
  return best;
}
const rank = (g) => ['clear', 'tight', 'blocked'].indexOf(g);

/** Fit a whole kit, biggest pieces first. Returns {items, rows: {id: {room, grade}}, counts}. */
export function fitKit(model, kit, step = 8) {
  const placed = [], rows = {};
  for (const item of [...kit].sort((a, b) => SIZE(b) - SIZE(a))) {
    const p = fitOne(model, placed, item, step);
    if (p) placed.push(p); else rows[item.id] = { room: null, grade: 'none' };
  }
  return finish(model, placed, rows);
}
export function finish(model, placed, rows = {}) {
  const ev = evaluate(model, placed);
  for (const p of placed) rows[p.id] = { room: p._room, grade: ev.items[p.id]?.state || p._grade };
  const counts = { clear: 0, tight: 0, blocked: 0, none: 0 };
  for (const r of Object.values(rows)) counts[r.grade]++;
  return { items: placed, rows, counts, ev };
}
