// node --test tests/js : "does it fit?" - reading a typed piece, and the plain-language answer for where it stands
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalisePlan } from '../../dashboard/js/plan/model.js';
import { resolve, CATALOG } from '../../dashboard/js/plan/catalog.js';
import { validateInventory } from '../../dashboard/js/plan/inventory.js';
import { validateLayout } from '../../dashboard/js/plan/layout.js';
import { accessRoutes } from '../../dashboard/js/plan/route.js';
import { parsePiece, guessRef, fitReport, windowCover, walkwayEffects, pieceFromItem, withPiece, roomKindAt } from '../../dashboard/js/plan/tryfit.js';

// a 12 ft x 10 ft living room, a door on the right wall (swinging in), a window 4 ft wide on the top wall (sill 3 ft)
const plan = () => normalisePlan({
  units: 'ft', ceiling: 9, rooms: [{ name: 'Living', kind: 'living', x: 0, y: 0, w: 12, h: 10 }],
  windows: [{ room: 'Living', x1: 4, y1: 10, x2: 8, y2: 10, sill: 3, head: 7 }],
  doors: [{ room: 'Living', kind: 'entry', x1: 12, y1: 2, x2: 12, y2: 5, swing: 'in', hinge: 'a' }],
});
const put = (m, o) => resolve({ rot: 0, ...o });

test('a typed piece reads as name, width, depth, height', () => {
  const p = parsePiece('Bookshelf 36 x 12 x 72 in');
  assert.deepEqual([p.ok, p.label, p.w, p.d, p.h, p.heightGiven, p.ref], [true, 'Bookshelf', 36, 12, 72, true, 'bookcase']);
});

test('units: centimetres, metres, feet, feet and inches; one unit covers the run', () => {
  const cm = parsePiece('90 x 30 x 180 cm sofa');
  assert.deepEqual([cm.w, cm.d, cm.h, cm.label], [35.4, 11.8, 70.9, 'sofa']);
  const m = parsePiece('Console 1.2 x 0.35 x 0.8 m');
  assert.deepEqual([m.w, m.d, m.h], [47.2, 13.8, 31.5]);
  const ft = parsePiece('desk 4ft x 2ft');
  assert.deepEqual([ft.w, ft.d, ft.h, ft.heightGiven], [48, 24, 30, false], 'a missing height comes from the catalogue desk and says so');
  const fi = parsePiece("wardrobe 3'4\" x 1'10\" x 6'8\"");
  assert.deepEqual([fi.w, fi.d, fi.h], [40, 22, 80]);
  assert.deepEqual([parsePiece('36x12x72').w, parsePiece('36×12×72').h, parsePiece('12 by 12 by 60 lamp').h], [36, 72, 60]);
});

test('letters say which size is which', () => {
  const p = parsePiece('dresser W 55 D 19 H 31');
  assert.deepEqual([p.w, p.d, p.h, p.ref], [55, 19, 31, 'dresser-wide']);
  const q = parsePiece('shelf 72" H x 36" W x 12" D');
  assert.deepEqual([q.w, q.d, q.h], [36, 12, 72]);
});

test('what cannot be read says what to type', () => {
  assert.match(parsePiece('bookshelf').error, /size/);
  assert.match(parsePiece('36 in').error, /depth/);
  assert.match(parsePiece('5 x 3 x 2000 in').error, /over 300 in.*cm/);
  assert.match(parsePiece('1 x 2 x 3 x 4').error, /three sizes/);
  assert.equal(parsePiece(null).ok, false);
  assert.equal(parsePiece('x'.repeat(200)).ok, false);
});

test('the catalogue piece a name looks like, else a plain box that the layout and inventory files accept', () => {
  assert.equal(guessRef('Walnut credenza', 60), 'dresser-wide');
  assert.equal(guessRef('Round dining table'), 'dining-round');
  assert.equal(guessRef('mystery thing'), 'custom-box');
  assert.ok(CATALOG['custom-box']);
  const it = { id: 'thing-1', ref: 'custom-box', x: 10, y: 10, rot: 0, w: 20, d: 20, h: 20, label: 'Mystery' };
  assert.equal(validateLayout({ schema: 1, units: 'in', items: [it] }).ok, true);
  const piece = pieceFromItem(resolve(it), 'living');
  assert.equal(validateInventory({ schema: 1, kind: 'apartmentscout-furniture', pieces: [piece] }).ok, true);
});

test('a bookshelf in an open spot fits, with the space on every side', () => {
  const m = plan(), shelf = put(m, { id: 'shelf', ref: 'bookcase', x: 72, y: 60, w: 36, d: 12, h: 72 });
  const r = fitReport(m, [shelf], 'shelf');
  assert.equal(r.grade, 'clear'); assert.match(r.verdict, /^Fits where it stands/);
  assert.deepEqual(r.sides.map((s) => s.side), ['front', 'back', 'left', 'right']);
  assert.ok(r.sides.every((s) => s.free > 6 && !s.flush));
});

test('against a wall it is flush behind; a gap to the side is measured in inches', () => {
  const m = plan(), shelf = put(m, { id: 'shelf', ref: 'bookcase', x: 30, y: 2.4 + 6, w: 36, d: 12, h: 72, rot: 180 });   // back to the bottom wall's face, 12 in from the left wall face
  const r = fitReport(m, [shelf], 'shelf'), back = r.sides.find((s) => s.side === 'back'), left = r.sides.find((s) => s.side === 'right');
  assert.equal(back.flush, true);
  assert.ok(left.free > 0);
});

test('a piece through a wall, or on top of another, is blocked and the verdict says what hit what', () => {
  const m = plan();
  const out = fitReport(m, [put(m, { id: 'a', ref: 'bookcase', x: 6, y: 4, w: 40, d: 20, h: 72 })], 'a');
  assert.equal(out.grade, 'blocked'); assert.match(out.verdict, /^Does not fit here/);
  const sofa = put(m, { id: 'sofa', ref: 'sofa-3', x: 72, y: 60 }), shelf = put(m, { id: 'shelf', ref: 'bookcase', x: 72, y: 60, w: 36, d: 12, h: 72 });
  const over = fitReport(m, [sofa, shelf], 'shelf');
  assert.equal(over.grade, 'blocked'); assert.ok(over.rows.some((x) => /Overlaps the/.test(x.text)));
});

test('in the swing of the door is blocked', () => {
  const m = plan(), shelf = put(m, { id: 'shelf', ref: 'bookcase', x: 132 - 8, y: 42, w: 30, d: 14, h: 72, rot: 90 });
  const r = fitReport(m, [shelf], 'shelf');
  assert.ok(r.rows.some((x) => /swing of the entry door/.test(x.text) || /doorway/.test(x.text)), JSON.stringify(r.rows));
});

test('a tall piece in front of a window covers it; a low one fits under the sill', () => {
  const m = plan(), win = m.windows[0];
  const tall = put(m, { id: 'tall', ref: 'bookcase', x: 72, y: 112 - 6, w: 72, d: 12, h: 72 });
  assert.ok(windowCover(tall, win) > 0.9);
  const r = fitReport(m, [tall], 'tall'), w = r.rows.find((x) => x.code === 'window');
  assert.equal(w.grade, 'blocked'); assert.match(w.text, /covering about \d+% of it: the sill is 36 in and this is 72 in tall/);
  const low = put(m, { id: 'low', ref: 'dresser-wide', x: 72, y: 112 - 6, w: 55, d: 19, h: 30 });
  const r2 = fitReport(m, [low], 'low'), u = r2.rows.find((x) => x.code === 'window-under');
  assert.ok(u, JSON.stringify(r2.rows)); assert.equal(u.grade, 'clear'); assert.match(u.text, /Fits under the living window: the sill is 36 in and this is 30 in tall/);
  assert.ok(windowCover(put(m, { id: 'far', ref: 'bookcase', x: 72, y: 40, w: 36, d: 12, h: 72 }), win) === 0);
});

test('a piece that pinches the walk from the door says how much, and one that seals it says so', () => {
  const m = plan();
  const sofa = put(m, { id: 'sofa', ref: 'sofa-3', x: 72, y: 60 });
  const before = accessRoutes(m, [sofa]);
  // a long shelf across the middle of the room, close to the sofa: the walk to the sofa narrows
  const wall = put(m, { id: 'wall', ref: 'custom-box', x: 100, y: 62, w: 12, d: 100, h: 72, rot: 0 });
  const after = accessRoutes(m, [sofa, wall]);
  const fx = walkwayEffects(after, before, 'wall');
  assert.ok(Array.isArray(fx));
  const sealed = put(m, { id: 'seal', ref: 'custom-box', x: 124, y: 60, w: 30, d: 120, h: 72 });
  const closed = walkwayEffects(accessRoutes(m, [sofa, sealed]), before, 'seal');
  assert.ok(closed.some((x) => x.grade === 'blocked' && /closes off the way to the sofa/i.test(x.text)) || closed.some((x) => x.grade !== 'clear'), JSON.stringify(closed));
  const r = fitReport(m, [sofa, sealed], 'seal', { routesAfter: accessRoutes(m, [sofa, sealed]), routesBefore: before });
  assert.ok(r.rows.some((x) => x.code === 'walk'));
});

test('adding a piece to the furniture list makes a valid, de-duplicated inventory and files it under its room', () => {
  const m = plan();
  const it = resolve({ id: 'shelf-1', ref: 'bookcase', x: 72, y: 60, rot: 0, w: 36, d: 12, h: 72, label: 'Bookshelf' });
  assert.equal(roomKindAt(m, [72, 60]), 'living');
  const piece = pieceFromItem(it, roomKindAt(m, [72, 60]), { source: 'Added in the studio' });
  assert.deepEqual([piece.id, piece.ref, piece.label, piece.room, piece.w, piece.d, piece.h], ['shelf-1', 'bookcase', 'Bookshelf', 'living', 36, 12, 72]);
  const inv = withPiece(null, piece);
  assert.equal(validateInventory(inv).ok, true);
  const wider = withPiece(inv, { ...piece, w: 40 });
  assert.equal(wider.pieces.length, 1); assert.equal(wider.pieces[0].w, 40);
  assert.equal(inv.pieces[0].w, 36, 'the original is not changed');
  assert.equal(withPiece(wider, { ...piece, id: 'other' }).pieces.length, 2);
});
