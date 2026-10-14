// node --test tests/js : interior pass of the Floor plan studio: storage-bed drawers, rugs, wall art, window AC,
// TV height, table lamps, products and the bed finder, the shopping list, access routes and the suggested layout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalisePlan } from '../../dashboard/js/plan/model.js';
import { resolve, CATALOG } from '../../dashboard/js/plan/catalog.js';
import { evaluate, axes, toWorld } from '../../dashboard/js/plan/checks.js';
import { PRODUCTS, PRODUCT_MAP, productsFor, shoppingList, shoppingCSV } from '../../dashboard/js/plan/products.js';
import { productFinder, withProduct } from '../../dashboard/js/plan/shop.js';
import { accessRoutes, delivery, gradeWidth, entryPoint, grid, edt, CELL } from '../../dashboard/js/plan/route.js';
import { suggestLayout, starterKit } from '../../dashboard/js/plan/suggest.js';
import { validateLayout, serialiseLayout } from '../../dashboard/js/plan/layout.js';
import { parseProject, serialiseProject } from '../../dashboard/js/plan/project.js';

// A 12 x 14 ft bedroom: window on the top wall (sill 24 in), the front door on the bottom wall swinging in.
const RAW = {
  schema: 2, id: 'test-room', units: 'ft', ceiling: 9, wall: 0.4, up_bearing: 180,
  rooms: [{ name: 'Bedroom', kind: 'bedroom', x: 0, y: 0, w: 12, h: 14 }],
  windows: [{ room: 'Bedroom', x1: 3, y1: 14, x2: 9, y2: 14, sill: 2, head: 8 }],
  doors: [{ x1: 8, y1: 0, x2: 11, y2: 0, hinge: 'b', swing: '+y', room: 'Bedroom', name: 'front door', kind: 'entry' }],
};
const ROOM = normalisePlan(RAW);
const item = (ref, x, y, rot = 0, extra = {}) => resolve({ id: extra.id || ref, ref, x, y, rot, ...extra });
const codes = (ev, id) => ev.items[id].issues.map((i) => i.code);
const texts = (ev, id) => ev.items[id].issues.map((i) => i.text).join(' | ');

test('every product names a catalogue ref, a size and an https link', () => {
  assert.ok(PRODUCTS.length >= 20);
  const ids = new Set();
  for (const p of PRODUCTS) {
    assert.ok(CATALOG[p.ref], `${p.id}: unknown ref ${p.ref}`);
    assert.ok(!ids.has(p.id), `duplicate ${p.id}`); ids.add(p.id);
    assert.match(p.id, /^[a-z0-9][a-z0-9-]{0,63}$/);
    assert.match(p.url, /^https:\/\//);
    assert.ok(!/[?#]/.test(p.url), `${p.id}: tracking query in url`);
    assert.ok(Number.isFinite(p.dims.w) && p.dims.w > 1, `${p.id}: width`);
    assert.equal(typeof p.verified, 'boolean');
    if (p.variant) assert.ok(CATALOG[p.ref].variants?.[p.variant], `${p.id}: variant ${p.variant}`);
  }
  assert.ok(productsFor('queen-storage-bed').length >= 3);
});

test('a product swaps in its real size; a different variant the renter picks wins over it', () => {
  const malm = PRODUCT_MAP['ikea-malm-high-storage-queen'];
  const r = resolve({ id: 'b', ref: 'queen-storage-bed', x: 0, y: 0, product: malm.id });
  assert.equal(r.w, malm.dims.w); assert.equal(r.d, malm.dims.d);
  assert.equal(r.productInfo.id, malm.id);
  // MALM boxes are 23.3 in deep: the pull-out zone grows to fit them
  const z = r.zones.find((x) => x.key === 'drawer_pull');
  assert.ok(z.min >= 27 && z.preferred >= 33);
  const sleeper = resolve({ id: 's', ref: 'futon', x: 0, y: 0, product: 'ikea-nyhamn-sleeper-foam', variant: 'bed' });
  assert.equal(sleeper.d, CATALOG.futon.variants.bed.d);
  // a product for another ref is ignored
  assert.equal(resolve({ id: 'x', ref: 'queen-bed', x: 0, y: 0, product: malm.id }).productInfo, null);
});

test('storage bed: the drawer side against a wall with 18 in free is blocked, the open side is clear', () => {
  // back to the right wall (rot 90); its left side faces the top wall 18 in away
  const yc = 168 - 18 - 64 / 2;
  const left = item('queen-storage-bed', 144 - 42, yc, 90, { id: 'bed', variant: 'left', product: 'ikea-malm-high-storage-queen' });
  const ev = evaluate(ROOM, [left]);
  assert.equal(ev.items.bed.state, 'blocked', texts(ev, 'bed'));
  assert.match(texts(ev, 'bed'), /Drawers, left/);
  const right = item('queen-storage-bed', 144 - 42, yc, 90, { id: 'bed', variant: 'right', product: 'ikea-malm-high-storage-queen' });
  const ev2 = evaluate(ROOM, [right]);
  assert.ok(!/Drawers/.test(texts(ev2, 'bed')), texts(ev2, 'bed'));
});

test('rugs are not obstacles: furniture stands on them; a rug under a door swing is only tight', () => {
  const rug = item('rug', 72, 84, 0, { id: 'rug' }), sofa = item('sofa-3', 72, 84, 0, { id: 'sofa' });
  const ev = evaluate(ROOM, [rug, sofa]);
  assert.ok(!codes(ev, 'sofa').includes('overlap'));
  assert.ok(!codes(ev, 'rug').includes('overlap'));
  const atDoor = item('rug', 110, 24, 0, { id: 'rug', w: 60, d: 40 });
  const ev2 = evaluate(ROOM, [atDoor]);
  assert.equal(ev2.items.rug.state, 'tight');
  assert.match(texts(ev2, 'rug'), /catch the door/);
});

test('wall art: centre at about 57 in is clear, a frame hung at 70 in is tight', () => {
  const art = (elev) => item('wall-art', 0.75, 84, 270, { id: 'art', elev });
  assert.ok(!codes(evaluate(ROOM, [art(45)]), 'art').includes('art-height'));
  const ev = evaluate(ROOM, [art(70)]);
  assert.ok(codes(ev, 'art').includes('art-height'));
  assert.ok(!codes(ev, 'art').includes('tv-wall'), 'a solid wall is behind it');
});

test('wall art over a sofa wants 6-12 in between them', () => {
  const sofa = item('sofa-3', 18, 84, 270, { id: 'sofa' });
  const low = item('wall-art', 0.75, 84, 270, { id: 'art', elev: 36 });
  assert.match(texts(evaluate(ROOM, [sofa, low]), 'art'), /Only 2 in above the sofa/);
  const ok = item('wall-art', 0.75, 84, 270, { id: 'art', elev: 42 });
  assert.ok(!codes(evaluate(ROOM, [sofa, ok]), 'art').includes('art-above'));
});

test('window AC: in the window at sill height is fine, off the sill is tight, on a plain wall is blocked', () => {
  const ac = (x, y, rot, elev) => item('window-ac', x, y, rot, { id: 'ac', elev });
  assert.ok(!codes(evaluate(ROOM, [ac(72, 168 - 4.5, 0, 24)]), 'ac').includes('in-window'));
  assert.equal(evaluate(ROOM, [ac(72, 168 - 4.5, 0, 30)]).items.ac.issues.find((i) => i.code === 'in-window').grade, 'tight');
  assert.equal(evaluate(ROOM, [ac(144 - 4.5, 84, 90, 24)]).items.ac.issues.find((i) => i.code === 'in-window').grade, 'blocked');
});

test('TV mounted high is flagged with the angle above a seated eye', () => {
  const sofa = item('sofa-3', 72, 30, 180, { id: 'sofa' });
  const tv = (elev) => item('tv-55', 72, 168 - 1.75, 0, { id: 'tv', elev });
  // windows are on the top wall in this room; put the TV on the left wall instead
  const tvL = (elev) => item('tv-55', 1.75, 84, 270, { id: 'tv', elev });
  const sofaL = item('sofa-3', 80, 84, 90, { id: 'sofa' });
  assert.ok(!codes(evaluate(ROOM, [sofaL, tvL(30)]), 'tv').includes('tv-height'));
  const ev = evaluate(ROOM, [sofaL, tvL(60)]);
  assert.ok(codes(ev, 'tv').includes('tv-height'), texts(ev, 'tv'));
  const seat = ev.tv[0].seats[0];
  assert.ok(seat.up > 25 && seat.eye === 40);
  void sofa; void tv;
});

test('a table lamp needs something to stand on at its height', () => {
  const ns = item('nightstand', 30, 100, 270, { id: 'ns' });
  const lamp = item('table-lamp', 30, 100, 0, { id: 'lamp' });
  assert.ok(!codes(evaluate(ROOM, [ns, lamp]), 'lamp').includes('lamp-surface'));
  assert.ok(codes(evaluate(ROOM, [lamp]), 'lamp').includes('lamp-surface'));
});

test('withProduct keeps the back edge where it was', () => {
  const raw = { id: 'bed', ref: 'queen-bed', x: 72, y: 100, rot: 0 };
  const before = resolve(raw), back0 = toWorld(before, 0, before.d / 2);
  const next = withProduct(raw, PRODUCT_MAP['ikea-brimnes-storage-headboard-queen']);
  const after = resolve(next), back1 = toWorld(after, 0, after.d / 2);
  assert.equal(next.ref, 'queen-storage-bed');
  assert.ok(Math.abs(back0[1] - back1[1]) < 0.2 && Math.abs(back0[0] - back1[0]) < 0.2);
  assert.notEqual(before.d, after.d);
});

test('bed finder grades every bed product, clear ones first', () => {
  const items = [{ id: 'bed', ref: 'queen-bed', x: 72, y: 168 - 42 - 30, rot: 0 }];
  const rows = productFinder(ROOM, items, 'bed');
  assert.equal(rows.length, PRODUCTS.filter((p) => ['queen-bed', 'queen-storage-bed'].includes(p.ref)).length);
  const rank = { clear: 0, tight: 1, blocked: 2 };
  for (let i = 1; i < rows.length; i++) assert.ok(rank[rows[i - 1].grade] <= rank[rows[i].grade]);
  assert.ok(rows.some((r) => r.grade === 'clear'));
});

test('shopping list totals priced pieces and quotes CSV fields', () => {
  const items = [resolve({ id: 'bed', ref: 'queen-storage-bed', x: 0, y: 0, product: 'ikea-brimnes-storage-queen' }), resolve({ id: 'ns', ref: 'nightstand', x: 0, y: 0 }), resolve({ id: 'sofa', ref: 'sofa-3', x: 0, y: 0, product: 'article-sven-88-sofa' })];
  const list = shoppingList(items);
  assert.equal(list.rows.length, 3); assert.equal(list.priced, 2); assert.equal(list.unpriced, 1);
  assert.equal(list.total, PRODUCT_MAP['ikea-brimnes-storage-queen'].price + PRODUCT_MAP['article-sven-88-sofa'].price);
  const csv = shoppingCSV(list, 'Test, "plan"');
  assert.match(csv, /^Piece,Product,/);
  assert.match(csv, /"Sven 88"" Tufted Sofa - Stone Gray"/);
  assert.match(csv, /"Test, ""plan"""/);
  assert.equal(csv.trim().split('\n').length, 5);
});

test('access route: open room is clear; furniture closing the room to a 20 in gap blocks the bed', () => {
  assert.equal(gradeWidth(40), 'clear'); assert.equal(gradeWidth(32), 'tight'); assert.equal(gradeWidth(24), 'blocked');
  const e = entryPoint(ROOM);
  assert.ok(e.at[1] > 0 && e.at[1] < 30, 'stands just inside the front door');
  const bed = item('queen-bed', 72, 168 - 42 - 6, 0, { id: 'bed' });
  const open = accessRoutes(ROOM, [bed]).routes.find((r) => r.itemId === 'bed');
  assert.ok(open.reachable); assert.equal(open.grade, 'clear');
  // two wardrobes across the room leave a 20 in slot between them
  const wa = item('wardrobe', 31, 84, 0, { id: 'w1', w: 62 }), wb = item('wardrobe', 144 - 31, 84, 0, { id: 'w2', w: 62 });
  const r2 = accessRoutes(ROOM, [bed, wa, wb]).routes.find((r) => r.itemId === 'bed');
  assert.ok(r2.reachable);
  assert.equal(r2.grade, 'blocked', r2.text);
  assert.ok(r2.width >= 16 && r2.width <= 22, `width ${r2.width}`);
  assert.match(r2.text, /wardrobe/);
  // closing it completely
  const wc = item('wardrobe', 72, 84, 0, { id: 'w3', w: 24 });
  const r3 = accessRoutes(ROOM, [bed, wa, wb, wc]).routes.find((r) => r.itemId === 'bed');
  assert.equal(r3.reachable, false); assert.equal(r3.grade, 'blocked');
});

test('distance transform measures free width in a corridor', () => {
  const corridor = normalisePlan({ units: 'in', ceiling: 100, wall: 4, rooms: [{ name: 'Hall', kind: 'hall', x: 0, y: 0, w: 36, h: 200 }] });
  const G = grid(corridor, []), d2 = edt(G);
  const i = Math.floor((18 - G.x0) / CELL), j = Math.floor((100 - G.y0) / CELL);
  const w = 2 * (Math.sqrt(d2[j * G.nx + i]) - 0.5) * CELL;
  assert.ok(Math.abs(w - 32) <= 3, `measured ${w}`); // 36 in between wall centrelines, 4 in walls
});

test('delivery: flat-packed pieces always pass; a 34 in deep sofa does not fit a 30 in door', () => {
  const door = { name: 'front door', width: 30 };
  assert.equal(delivery(item('queen-bed', 0, 0), door).grade, 'clear');
  assert.equal(delivery(item('sofa-3', 0, 0), door).grade, 'blocked');
  assert.equal(delivery(item('armchair', 0, 0, 0, { h: 29 }), door).grade, 'tight');
  assert.equal(delivery(item('armchair', 0, 0, 0, { h: 26 }), door).grade, 'clear');
});

test('suggested layout places a starter kit and explains it', () => {
  const ONE = normalisePlan({
    units: 'ft', ceiling: 9, wall: 0.4,
    rooms: [{ name: 'Living room', kind: 'living', x: 0, y: 0, w: 15, h: 14 }, { name: 'Bedroom', kind: 'bedroom', x: 15.4, y: 0, w: 12, h: 14 }],
    doors: [{ x1: 15, y1: 2, x2: 15, y2: 4.8, hinge: 'a', swing: '+x', name: 'bedroom door' }, { x1: 15.4, y1: 2, x2: 15.4, y2: 4.8 }, { x1: 4, y1: 0, x2: 7, y2: 0, kind: 'entry', name: 'front door', swing: '+y', hinge: 'a' }],
  });
  const kit = starterKit(ONE);
  assert.ok(kit.some((k) => k.ref === 'queen-bed') && kit.some((k) => k.ref === 'sofa-3'));
  const s = suggestLayout(ONE);
  assert.equal(s.id, 'suggested');
  assert.ok(s.items.length >= 6, `${s.items.length} placed`);
  assert.ok(s.reasons.length >= 2);
  assert.match(s.note, /Auto-placed starter kit/);
  const bed = s.items.find((x) => x.ref === 'queen-bed');
  assert.ok(bed.x > 15 * 12, 'the bed goes in the bedroom');
  // presets are valid layouts
  assert.ok(validateLayout({ schema: 1, kind: 'apartmentscout-layout', units: 'in', items: s.items }).ok);
});

test('layout and project files carry an optional product id', () => {
  const items = [{ id: 'bed', ref: 'queen-storage-bed', x: 10, y: 20, rot: 0, product: 'ikea-malm-high-storage-queen' }];
  const v = validateLayout(serialiseLayout('test-room', items), { planId: 'test-room' });
  assert.ok(v.ok); assert.equal(v.layout.items[0].product, 'ikea-malm-high-storage-queen');
  assert.equal(validateLayout({ schema: 1, units: 'in', items: [{ ...items[0], product: 'Bad Id!' }] }).ok, false);
  // a layout without products (schema 1, as before) still validates
  assert.ok(validateLayout({ schema: 1, units: 'in', items: [{ id: 'b', ref: 'queen-bed', x: 0, y: 0 }] }).ok);
  const p = serialiseProject(RAW, items, {});
  const back = parseProject(JSON.stringify(p));
  assert.ok(back.ok, back.error); assert.equal(back.project.layout.items[0].product, 'ikea-malm-high-storage-queen');
});

test('new catalogue kinds resolve with sensible heights', () => {
  assert.equal(item('table-lamp', 0, 0).elev, 24);
  assert.equal(item('window-ac', 0, 0).elev, 30);
  assert.equal(item('wall-art', 0, 0, 0, { variant: 'l' }).elev, 39);
  assert.equal(item('rug', 0, 0, 0, { variant: '8x10' }).w, 120);
  assert.ok(item('rug', 0, 0).flat);
  assert.equal(axes(0).b[1], 1);
});
