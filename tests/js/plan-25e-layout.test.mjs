// node --test tests/js : the default layout of Paramount Tower 25E is what the renter described, and these tests pin it:
//   the futon's back against a solid wall, facing the living-room TV on the opposite wall;
//   the bed's headboard on a side wall with the windows on the right of a person lying in it, the bedroom TV on the opposite wall facing the bed;
//   nightstands either side, the MALM chest on a free wall (under the TV);
//   the Bestier rotating desk (straight, about 89 in) with the chair behind its desktop and room to pull it out, beside a window and not blocking it.
// The plan file and the furniture file are data; no placement is decided in code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalisePlan } from '../../dashboard/js/plan/model.js';
import { validateInventory } from '../../dashboard/js/plan/inventory.js';
import { resolve } from '../../dashboard/js/plan/catalog.js';
import { evaluate, axes, footprint, toWorld, piecePoly, satDepth } from '../../dashboard/js/plan/checks.js';
import { accessRoutes } from '../../dashboard/js/plan/route.js';
import { applyInventory, resolveLayout } from '../../dashboard/js/plan/placement.js';
import { windowGroups } from '../../dashboard/js/plan/viewpoints.js';
import { pointInPoly } from '../../dashboard/js/plan/model.js';

const read = (p) => JSON.parse(fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8'));
const m = normalisePlan(read('examples/nyc-2026/plans/paramount-tower-25e.json')), inv = validateInventory(read('examples/nyc-2026/furniture.json')).inventory;
const items = applyInventory(resolveLayout({ model: m, inventory: inv, saved: null }).items, inv).map((x) => resolve(x));
const by = Object.fromEntries(items.map((i) => [i.id, i]));
const ev = evaluate(m, items);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]], dot = (a, b) => a[0] * b[0] + a[1] * b[1], len = (a) => Math.hypot(a[0], a[1]), unit = (a) => [a[0] / len(a), a[1] / len(a)];
const back = (it) => axes(it.rot).b, front = (it) => [-back(it)[0], -back(it)[1]];
const wallT = m.wallT;

/** Inches between an item's back face and the nearest wall piece behind it (negative: inside the wall); also the wall's span along the item. */
function gapToWall(it) {
  const b = back(it), c = toWorld(it, 0, it.d / 2);   // the middle of the back face
  let best = Infinity;
  for (const p of m.pieces) {
    if (p.kind !== 'solid' || p.z1 < it.elev + 20) continue;
    const poly = piecePoly(p);
    for (let t = 0; t <= 14; t += 0.25) { const q = [c[0] + b[0] * t, c[1] + b[1] * t]; if (pointInPoly(q, poly)) { best = Math.min(best, t); break; } }
  }
  return best;
}
/** The sides a room's windows are on, seen by a person lying in a bed (their head at the headboard, feet toward the foot): the bed's own right-hand direction. */
const personRight = (bed) => { const f = front(bed); return [f[1], -f[0]]; };   // facing `f`, the right-hand side (y up the drawing)

test('the futon stands with its back flat against a solid wall in the living room, facing the TV on the opposite wall', () => {
  const futon = by.futon, tv = by.tv, living = m.rooms.find((r) => r.kind === 'living');
  assert.ok(pointInPoly([futon.x, futon.y], living.poly) && pointInPoly([tv.x, tv.y], living.poly), 'both are in the living room');
  const g = gapToWall(futon);
  assert.ok(g >= -0.5 && g <= 1.5, `the futon's back is ${g} in from a solid wall`);
  // the wall is a real partition (not a window wall): no window pane within the futon's span
  for (const w of m.windows) assert.ok(len(sub(w.mid, [futon.x, futon.y])) > 120, 'no window beside the futon');
  const to = unit(sub([tv.x, tv.y], [futon.x, futon.y]));
  assert.ok(dot(to, front(futon)) > 0.98, 'the futon faces the TV');
  assert.ok(dot(front(tv), unit(sub([futon.x, futon.y], [tv.x, tv.y]))) > 0.98, 'the TV faces the futon');
  assert.ok(gapToWall(tv) <= 1.5, 'the TV hangs on its wall');
  assert.ok(dot(back(futon), back(tv)) < -0.99, 'the TV is on the opposite wall');
  assert.equal(ev.items.futon.state, 'clear');
});

test('the bed\'s headboard is on a side wall, the windows are on the right of a person lying in it, and the TV on the opposite wall faces the bed', () => {
  const bed = by.bed, tv = by['tv-bed'], bedroom = m.rooms.find((r) => r.kind === 'bedroom');
  const g = gapToWall(bed); assert.ok(g >= -0.5 && g <= 2, `the headboard is ${g} in from a solid wall`);
  // a side wall: the one the room's long windows are not on (the windows are along the top of the drawing; the headboard wall runs up it)
  assert.ok(Math.abs(back(bed)[0]) > 0.99, 'the headboard is on a wall that runs up and down the drawing, a side wall');
  const right = personRight(bed), wins = windowGroups(m).filter((w) => w.room === bedroom.name);
  assert.ok(wins.length >= 1);
  for (const w of wins) assert.ok(dot(unit(sub(w.mid, [bed.x, bed.y])), right) > 0.5, `the ${w.kind} window is on the right of someone lying in the bed`);
  // and not on their left: the bedroom windows all lie on the right side of the bed's centre line
  for (const w of m.windows.filter((q) => q.room === bedroom.name)) assert.ok(dot(sub(w.mid, [bed.x, bed.y]), right) > 0);
  // the TV on the opposite side wall, facing the bed
  assert.ok(dot(back(bed), back(tv)) < -0.99, 'the TV is on the opposite wall');
  assert.ok(dot(front(tv), unit(sub([bed.x, bed.y], [tv.x, tv.y]))) > 0.98, 'the TV faces the bed');
  assert.ok(gapToWall(tv) <= 1.5);
  assert.ok(Math.abs(tv.y - bed.y) < 3, 'centred on the bed');
  // the headboard is not against a window
  const fp = footprint({ ...bed, d: bed.d + 8 });
  for (const w of m.windows) { const seg = [[w.a[0], w.a[1]], [w.b[0], w.b[1]]]; assert.ok(![0, 0.25, 0.5, 0.75, 1].some((t) => pointInPoly([seg[0][0] + (seg[1][0] - seg[0][0]) * t, seg[0][1] + (seg[1][1] - seg[0][1]) * t], fp)), 'no window behind the bed'); }
});

test('a nightstand either side of the bed against the same wall, the MALM chest under the bedroom TV, and the bed and the chest clear', () => {
  const bed = by.bed, right = personRight(bed), n1 = by['nightstand-1'], n2 = by['nightstand-2'];
  const side = (n) => dot(sub([n.x, n.y], [bed.x, bed.y]), right);
  assert.ok(side(n1) * side(n2) < 0, 'one on each side of the bed');
  for (const n of [n1, n2]) { assert.ok(Math.abs(side(n)) < bed.w / 2 + n.w / 2 + 3 && Math.abs(side(n)) > bed.w / 2, 'beside the mattress'); assert.ok(gapToWall(n) <= 2, 'on the headboard wall'); assert.equal(ev.items[n.id].state, 'clear'); }
  const d = by.dresser;
  assert.deepEqual([d.w, d.d, d.h], [63, 18.9, 30.7], 'the IKEA MALM 6-drawer chest');
  assert.equal(d.ref, 'dresser-malm-6');
  assert.ok(gapToWall(d) <= 1.5, 'on a free wall'); assert.ok(dot(back(d), back(by['tv-bed'])) > 0.99, 'on the TV wall');
  assert.ok(Math.abs(d.y - by['tv-bed'].y) < 6 && d.h < by['tv-bed'].elev, 'the TV hangs above the chest');
  assert.equal(ev.items.dresser.state, 'clear'); assert.equal(ev.items.bed.state, 'clear');
});

test('the rotating desk is about 89 in straight with the chair behind its desktop and room to pull it out, beside a window and not blocking it', () => {
  const desk = by.desk, win = m.windows.filter((w) => w.room === 'Living room');
  assert.deepEqual([desk.w, desk.d, desk.h], [89.2, 21.6, 29.1]);
  assert.deepEqual(desk.set, { monitor: 32, chair: 'task', config: 'straight', hand: 'right' });
  assert.equal(ev.items.desk.state, 'clear', 'the chair\'s pull-out zone is free');
  const zone = ev.items.desk.zones.find((z) => /chair/i.test(z.name || '') || z.key === 'desk_chair') || ev.items.desk.zones[0];
  assert.ok(zone, 'a chair zone is measured');
  // the chair sits on the front side (-back), clear of the wall behind the desk
  const g = gapToWall(desk); assert.ok(g >= -0.5 && g <= 1.5, 'the desk\'s back is on a wall');
  const chair = toWorld(desk, desk.seatX, -(desk.d / 2 + 11));
  assert.ok(m.rooms.some((r) => pointInPoly(chair, r.poly)), 'the chair stands in the room');
  // the window is beside it: within about a desk length, and no glass over the desktop (a sill under 30 in must not meet the desk's footprint)
  const near = win.filter((w) => len(sub(w.mid, [desk.x, desk.y])) < 110);
  assert.ok(near.length >= 1, 'a window is beside the desk');
  const top = footprint(desk);
  for (const w of m.windows) assert.ok(satDepth(top, [[w.a[0] - 1, w.a[1] - 1], [w.b[0] - 1, w.b[1] - 1], [w.b[0] + 1, w.b[1] + 1], [w.a[0] + 1, w.a[1] + 1]]) <= 0.5, 'the desk does not run into the glass');
});

test('every piece is placed, none blocked, the two TVs are the only tight ones (a 55-inch is "workable" at 9 to 10 ft), and every piece can be reached and carried in', () => {
  assert.deepEqual(Object.keys(by).sort(), inv.pieces.map((p) => p.id).sort());
  assert.equal(ev.counts.blocked, 0);
  assert.deepEqual(Object.values(ev.items).filter((r) => r.state === 'tight').map((r) => r.id).sort(), ['tv', 'tv-bed']);
  for (const id of ['tv', 'tv-bed']) { assert.equal(by[id].w, 48.4); assert.equal(by[id].h, 27.8); assert.equal(by[id].elev, 32); assert.equal(by[id].base.screen, 48.4, '55-inch class'); }
  const routes = accessRoutes(m, items).routes;
  assert.ok(routes.every((r) => r.reachable && r.grade !== 'blocked' && r.delivery?.grade !== 'blocked' || !r.itemId), JSON.stringify(routes.map((r) => [r.label, r.grade, r.width])));
  assert.ok(routes.find((r) => r.itemId === 'desk').width >= 30, 'the walk from the door to the desk is at least 30 in wide');
});

test('the default layout is data: every piece in the plan file is placed by the renter, and the plan copy Unit 3D loads is the same', () => {
  const L = read('examples/nyc-2026/plans/paramount-tower-25e.json').layouts[0];
  assert.equal(L.id, 'your-furniture'); assert.ok(L.items.every((i) => i.placed === true));
  assert.deepEqual(read('dashboard/data/plans/paramount-tower-25e.json').layouts[0], L);
  assert.ok(L.replaces[0].length === 10, 'the earlier default\'s positions are kept, so a layout saved from it unchanged moves to this one');
  void wallT;
});
