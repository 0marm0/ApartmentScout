// node --test tests/js : the renter's Bestier rotating desk (plan/deskspec.js): the sizes are the maker's drawing, the straight length is one
// derived data value, the L and straight shapes are one set of parts turned about a pivot, and the 25E layout puts it on the living-room wall.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { dimsOf, layoutOf, footprintOf } from '../../dashboard/js/plan/deskspec.js';
import { validateInventory } from '../../dashboard/js/plan/inventory.js';
import { resolve } from '../../dashboard/js/plan/catalog.js';
import { normalisePlan, pointInPoly } from '../../dashboard/js/plan/model.js';
import { evaluate, footprint } from '../../dashboard/js/plan/checks.js';
import { applyInventory, resolveLayout } from '../../dashboard/js/plan/placement.js';

const read = (p) => JSON.parse(fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8'));
const inv = validateInventory(read('examples/nyc-2026/furniture.json')).inventory, piece = inv.pieces.find((p) => p.id === 'desk');
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
const box = (L, id) => L.boxes.find((b) => b.id === id);

test('the data is the maker\'s drawing: 51.8 x 21.6 desk, 29.1 high, 46.9 x 13.4 x 27.6 shelf with two 11.3 in tiers, panels 1.65 in', () => {
  const g = dimsOf(piece.spec);
  assert.deepEqual([g.top.l, g.top.d, g.top.h, g.top.t], [51.8, 21.6, 29.1, 1.65]);
  assert.deepEqual([g.shelf.l, g.shelf.d, g.shelf.h], [46.9, 13.4, 27.6]);
  assert.ok(near(g.tier, 11.3, 0.05), `each tier is ${g.tier}`);
  assert.equal(piece.spec_basis['straight.total'], 'derived', 'the straight length is marked derived, not published');
  assert.equal(piece.spec_basis['top.l'], 'diagram');
  assert.equal(piece.set.config, 'straight');
  assert.match(piece.note, /B07V9QXDSN/);
  const L = layoutOf(piece.spec);
  assert.deepEqual([L.w, L.d, L.h], [piece.w, piece.d, piece.h], 'the sizes in furniture.json are the geometry\'s');
  const r = resolve({ ...piece, ref: 'desk', x: 0, y: 0, rot: 0 });
  assert.deepEqual([r.w, r.d, r.h], [89.2, 21.6, 29.1]);
});

test('straight is one number: desk + shelf - overlap, which the renter can change; the L is 51.8 x 46.9 like the maker\'s box', () => {
  assert.ok(near(footprintOf(piece.spec).w, 51.8 + 46.9 - dimsOf(piece.spec).overlap));
  const longer = { ...piece.spec, straight: { total: 92 } }, L = layoutOf(longer);
  assert.equal(L.w, 92);
  assert.ok(near(L.shelf.x1 - L.shelf.x0, 46.9), 'the shelf keeps its size');
  assert.ok(near(L.desk.x1 - L.desk.x0, 51.8), 'and so does the desk');
  const l = layoutOf(piece.spec, { config: 'l_shape' });
  assert.deepEqual([l.w, l.d], [51.8, 46.9]);
});

test('the shelf is lower than the desktop and under its inner end; straight and L are the same parts turned a quarter about the pivot', () => {
  const s = layoutOf(piece.spec), l = layoutOf(piece.spec, { config: 'l_shape' });
  assert.ok(box(s, 'shelf-top').y1 <= box(s, 'desktop').y0 + 0.2, 'the shelf\'s top board is at the desktop\'s underside, below its top');
  assert.ok(box(s, 'shelf-top').y1 < box(s, 'desktop').y1 - 1.4);
  assert.ok(near(box(s, 'desktop').y1, 29.1) && near(box(s, 'shelf-top').y1, 27.6));
  for (const L of [s, l]) {
    assert.equal(L.boxes.length, 7, 'desktop, leg, three boards, two end panels');
    assert.equal(L.posts.length, 4, 'silver posts: two at the open end of each tier');
    for (const id of ['shelf-top', 'shelf-middle', 'shelf-bottom']) assert.ok(near(box(L, id).z1 - box(L, id).z0, 13.4) || near(box(L, id).x1 - box(L, id).x0, 13.4), 'the shelf is 13.4 across');
    assert.ok(near(box(L, 'desktop').z1 - box(L, 'desktop').z0, 21.6));
  }
  // straight: the shelf runs the same way as the desk, out past its inner end; L: across it, toward the front
  assert.ok(near(s.shelf.x1 - s.shelf.x0, 46.9) && near(s.desk.x1 - s.desk.x0, 51.8));
  assert.ok(near(l.shelf.z1 - l.shelf.z0, 46.9) && near(l.shelf.x1 - l.shelf.x0, 13.4));
  const over = Math.min(s.desk.x1, s.shelf.x1) - Math.max(s.desk.x0, s.shelf.x0);
  assert.ok(near(over, dimsOf(piece.spec).overlap, 1e-6), `the overlap is ${over}`);
  // the pivot is the same point of the shelf unit in both shapes: p in from its pivot end and rear edge
  const p = dimsOf(piece.spec).pivot;
  assert.ok(near(s.pivot.x - s.desk.x0, p) && near(s.pivot.z - s.desk.z0, p));
  assert.ok(near(l.pivot.x - l.desk.x0, p) && near(l.pivot.z - l.desk.z0, p));
  // the S: the top tier is closed at one end of the unit and the bottom tier at the other
  const pt = box(s, 'panel-top-tier'), pb = box(s, 'panel-bottom-tier');
  assert.ok(Math.abs((pt.x0 + pt.x1) / 2 - (pb.x0 + pb.x1) / 2) > 40, 'the two end panels are at opposite ends');
  // the leg is on the side `hand` says; a left-hand desk is the mirror image
  const m = layoutOf(piece.spec, { hand: 'left' });
  assert.ok(near(box(m, 'leg').x0, -box(s, 'leg').x1) && near(m.seatX, -s.seatX));
});

test('25E: along the living-room wall by the bay window, straight, clear, the chair behind the desktop, and the walkways kept', () => {
  const model = normalisePlan(read('examples/nyc-2026/plans/paramount-tower-25e.json'));
  const items = applyInventory(resolveLayout({ model, inventory: inv, saved: null }).items, inv).map((x) => resolve(x));
  const desk = items.find((i) => i.id === 'desk'), ev = evaluate(model, items);
  assert.equal(desk.variant, 'rotating');
  assert.equal(ev.items.desk.state, 'clear', JSON.stringify(ev.items.desk.issues));
  assert.equal(ev.counts.blocked, 0);
  const living = model.rooms.find((r) => r.kind === 'living');
  assert.ok(pointInPoly([desk.x, desk.y], living.poly), 'it stands in the living room');
  assert.ok(desk.w > 86 && desk.w < 92, 'about 89 in of wall');
  // the chair's pull-out is measured in front of the desktop part, clear of the shelf
  const zone = ev.items.desk.zones.find((z) => z.key === 'desk_chair');
  assert.ok(zone.along && zone.along[0] > 0, 'the chair zone starts past the shelf, at the desktop');
  assert.equal(zone.grade, 'clear');
  // the dining table and the futon keep a walk past it (nothing is blocked, the desk and the TV share the wall without touching)
  const tv = items.find((i) => i.id === 'tv'), a = footprint(desk).map((q) => q[1]), b = footprint(tv).map((q) => q[1]);
  assert.ok(Math.min(...a) > Math.max(...b) + 2 || Math.max(...a) < Math.min(...b) - 2, 'the desk and the wall TV do not overlap along the wall');
});
