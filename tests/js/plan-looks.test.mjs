// What each piece of the renter's furniture looks like: colour, material, finish and who said so (plan/looks.js), and that the example
// furniture.json carries the renter's own answers while the layout draws every piece, the TVs on walls that face the seating.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const L = await import(new URL('../../dashboard/js/plan/looks.js', import.meta.url));
const I = await import(new URL('../../dashboard/js/plan/inventory.js', import.meta.url));
const Lay = await import(new URL('../../dashboard/js/plan/layout.js', import.meta.url));
const { resolve } = await import(new URL('../../dashboard/js/plan/catalog.js', import.meta.url));
const read = (p) => JSON.parse(readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8'));

const inv = () => { const v = I.validateInventory(read('examples/nyc-2026/furniture.json')); assert.ok(v.ok, v.error); return v.inventory; };
const piece = (id) => inv().pieces.find((p) => p.id === id);

test('colours are names or hex codes, and nothing else', () => {
  assert.equal(L.parseColor('black'), L.COLOR_NAMES.black);
  assert.equal(L.parseColor('Dark Brown'), L.COLOR_NAMES['dark-brown']);
  assert.equal(L.parseColor('#ff8800'), 0xff8800);
  assert.equal(L.parseColor('#f80'), 0xff8800);
  for (const bad of ['', 'plaid', '#12', '#gggggg', null, {}, -1, 0x1000000, 1.5]) assert.equal(L.parseColor(bad), null, String(bad));
  assert.equal(L.hexOf(0x1a1b1d), '#1a1b1d');
});

test('a look is checked: known material, finish and basis, plain text, named parts', () => {
  const ok = L.validateLook({ color: 'black', material: 'leather', finish: 'sheen', basis: 'renter', assumed: ['finish'], parts: { frame: { color: '#101010', material: 'metal' } } });
  assert.ok(ok.ok); assert.equal(ok.look.parts.frame.material, 'metal');
  for (const bad of [{ color: 'plaid' }, { material: 'unobtainium' }, { finish: 'wet' }, { basis: 'guess' }, { assumed: 'finish' }, { note: '<b>x</b>' }, { parts: { 'Frame 1': {} } }, { parts: { frame: { color: 'nope' } } }, [], 'black'])
    assert.equal(L.validateLook(bad).ok, false, JSON.stringify(bad));
});

test('who a look comes from: the renter, or an assumption, field by field', () => {
  assert.equal(L.lookBasis(null), 'assumed');
  assert.equal(L.lookBasis({ color: 'black' }), 'assumed');
  const l = { basis: 'renter', assumed: ['finish', 'frame'] };
  assert.equal(L.lookBasis(l), 'renter');
  assert.equal(L.lookBasis(l, 'color'), 'renter');
  assert.equal(L.lookBasis(l, 'finish'), 'assumed');
  assert.equal(L.describeLook({ color: 'black', material: 'leather', finish: 'sheen' }), 'black leather, sheen finish');
});

test('looks join onto layout items by piece id; an item with its own look keeps it; the input is not changed', () => {
  const i = inv(), items = [{ id: 'futon', ref: 'futon', x: 1, y: 2 }, { id: 'desk', ref: 'desk', x: 1, y: 2, look: { color: 'white' } }, { id: 'ghost', ref: 'desk', x: 0, y: 0 }, { id: 'bed', ref: 'dresser', x: 0, y: 0 }];
  const out = L.applyLooks(items, i);
  assert.equal(out[0].look.material, 'leather');
  assert.deepEqual(out[1].look, { color: 'white' });
  assert.equal(out[2].look, undefined);
  assert.equal(out[3].look, undefined, 'a piece id with another ref is not the same piece');
  assert.equal(items[0].look, undefined);
  assert.equal(L.applyLooks(items, { pieces: [] }), items);
});

test('the example furniture holds the renter\'s answers: black leather futon, dark brown laminate desk, black STORKLINTA dresser, black nightstands, grey bed with black bedding', () => {
  const want = {
    futon: ['black', 'leather'], desk: ['#402e23', 'laminate'], dresser: ['#1b1918', 'laminate'], 'nightstand-1': ['black', 'paint'], 'nightstand-2': ['black', 'paint'],
    bed: ['#55565a', 'fabric'], coffee: ['brown', 'wood'], dining: ['brown', 'wood'],
  };
  for (const [id, [color, material]] of Object.entries(want)) {
    const p = piece(id);
    assert.equal(p.look.color, color, id); assert.equal(p.look.material, material, id); assert.equal(L.lookBasis(p.look), 'renter', `${id} comes from the renter`);
  }
  // a futon is a black leather mattress on a frame that is NOT wood (the frame is a stand-in, said so)
  const f = piece('futon').look;
  assert.equal(f.parts.frame.material, 'metal'); assert.ok(f.assumed.includes('frame') && f.assumed.includes('finish'));
  assert.equal(L.lookBasis(f, 'color'), 'renter'); assert.equal(L.lookBasis(f, 'frame'), 'assumed');
  // what the renter did not say stays an assumption: the TVs' casing, the office chair (its own piece now), the dining chairs
  assert.equal(L.lookBasis(piece('tv').look), 'assumed'); assert.equal(L.lookBasis(piece('tv-bed').look), 'assumed');
  assert.ok(piece('desk-chair').look.assumed.includes('color')); assert.equal(L.lookBasis(piece('desk-chair').look, 'color'), 'assumed'); assert.ok(piece('dining').look.assumed.includes('chairs'));
  // every piece has a look, and every look resolves to something drawable
  for (const p of inv().pieces) { assert.ok(p.look, p.id); assert.ok(L.resolveLook(p.look)?.color != null, p.id); }
});

test('an inventory rejects a bad look with a message that names the piece', () => {
  const raw = read('examples/nyc-2026/furniture.json'); raw.pieces[0].look = { color: 'plaid' };
  const v = I.validateInventory(raw); assert.equal(v.ok, false); assert.match(v.error, /Piece 1: look\.color/);
  raw.pieces[0].look = { material: 'wood', finish: 'wet' }; assert.equal(I.validateInventory(raw).ok, false);
  // pieceItem carries the look to the layout item the studio places
  assert.equal(I.pieceItem(piece('futon')).look.material, 'leather');
  // a layout item may carry its own look; the layout validator checks it too
  const lay = { schema: 1, units: 'in', items: [{ id: 'a', ref: 'futon', x: 1, y: 1, look: { color: 'plaid' } }] };
  assert.equal(Lay.validateLayout(lay).ok, false);
  lay.items[0].look = { color: 'black', material: 'leather' }; assert.equal(Lay.validateLayout(lay).layout.items[0].look.color, 'black');
  // a resolved item keeps its look for the 3D builders
  assert.equal(resolve({ ...I.pieceItem(piece('futon')), x: 0, y: 0 }).look.color, 'black');
});

test('the layout places every piece the renter owns, at their sizes, and each is drawn from the same items in both 3D views', () => {
  const i = inv(), plan = read('examples/nyc-2026/plans/paramount-tower-25e.json'), L0 = plan.layouts.find((l) => l.id === 'your-furniture');
  assert.deepEqual(L0.items.map((x) => x.id).sort(), i.pieces.map((p) => p.id).sort(), 'nothing is left out of the layout');
  for (const p of i.pieces) {
    const it = L0.items.find((x) => x.id === p.id);
    assert.equal(it.ref, p.ref, p.id); assert.deepEqual([it.w, it.d, it.h], [p.w, p.d, p.h], `${p.id} keeps the renter's size`);
    assert.ok(!it.hidden || p.candidate || p.id === 'sim-rig', `${p.id} is not hidden (the candidate bed and the sim rig wait until the renter switches to them)`);
    assert.ok(resolve(it), `${p.id} is a known catalogue piece (both 3D views draw it)`);
  }
  // Unit 3D reads plans/<id>.json from the dashboard's data folder: the same layout
  assert.deepEqual(read('dashboard/data/plans/paramount-tower-25e.json').layouts.find((l) => l.id === 'your-furniture'), L0);
  assert.deepEqual(read('dashboard/data/furniture.json'), read('examples/nyc-2026/furniture.json'));
});

test('both TVs hang on a wall at their mounting height, facing the seating they serve', () => {
  const plan = read('examples/nyc-2026/plans/paramount-tower-25e.json'), L0 = plan.layouts.find((l) => l.id === 'your-furniture'), by = Object.fromEntries(L0.items.map((x) => [x.id, x]));
  const back = (it) => [Math.sin((it.rot * Math.PI) / 180), Math.cos((it.rot * Math.PI) / 180)];   // the way an item's back points (rot 0 = up the drawing)
  for (const [tvId, seatId] of [['tv', 'futon'], ['tv-bed', 'bed']]) {
    const tv = by[tvId], seat = by[seatId], b = back(tv), to = [seat.x - tv.x, seat.y - tv.y], d = Math.hypot(...to);
    assert.equal(tv.elev, 32, `${tvId} is mounted 32 in off the floor`); assert.equal(resolve(tv).mount, 'wall'); assert.ok(tv.d <= 4, `${tvId} is a thin panel`);
    assert.ok(-(to[0] * b[0] + to[1] * b[1]) / d > 0.97, `${tvId} faces ${seatId}`);
    // its back is against a wall: a room edge within a few inches behind it
    const wallX = tv.x + b[0] * (tv.d / 2 + 0.5), wallY = tv.y + b[1] * (tv.d / 2 + 0.5), edges = [];
    for (const r of plan.rooms) r.poly.forEach((p, k) => edges.push([p, r.poly[(k + 1) % r.poly.length]]));
    const dist = Math.min(...edges.map(([a, c]) => { const ex = c[0] - a[0], ey = c[1] - a[1], t = Math.max(0, Math.min(1, ((wallX - a[0]) * ex + (wallY - a[1]) * ey) / (ex * ex + ey * ey || 1))); return Math.hypot(wallX - (a[0] + ex * t), wallY - (a[1] + ey * t)); }));
    assert.ok(dist < 4, `${tvId} hangs on a wall (${dist.toFixed(1)} in from the nearest room edge)`);
  }
});
