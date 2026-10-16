// node --test tests/js : the bed the renter may buy (the Latitude Run storage bed in furniture.json) beside their own, in the studio and in Unit 3D.
//   its dimensions are the maker's, in one place (the piece's `spec`), and the fit checks and both 3D engines read them from there;
//   choosing a bed shows exactly the pieces that choice lists (the separate nightstands go with the storage bed) and moves nothing;
//   the choice is the pieces' own `hidden` marks, so it is saved with the layout, and an older saved layout without the bed still loads;
//   the 94 in headboard unit is checked on the wall the renter's bed is on: the wall, the walk, the drawers, the doors, the window, the heat.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalisePlan } from '../../dashboard/js/plan/model.js';
import { validateInventory, kitFromInventory, fitInventory, offByDefault } from '../../dashboard/js/plan/inventory.js';
import { resolve } from '../../dashboard/js/plan/catalog.js';
import { applyInventory, resolveLayout, savedLayoutFor, layoutKey } from '../../dashboard/js/plan/placement.js';
import { validateLayout, serialiseLayout } from '../../dashboard/js/plan/layout.js';
import { applyChoice, choiceState, defaultChoice } from '../../dashboard/js/plan/choices.js';
import { dimsOf, partsOf } from '../../dashboard/js/plan/bedspec.js';
import { partPolys, evaluate, footprint } from '../../dashboard/js/plan/checks.js';
import { bedFit, reportFor, polyGap, sideOf } from '../../dashboard/js/plan/bedfit.js';
import { bedControlHTML, bedFitHTML } from '../../dashboard/js/plan/bed-ui.js';

const read = (p) => JSON.parse(fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8'));
const FILE = read('examples/nyc-2026/furniture.json'), PLAN = read('examples/nyc-2026/plans/paramount-tower-25e.json');
const inv = () => { const r = validateInventory(structuredClone(FILE)); assert.ok(r.ok, r.error); return r.inventory; };
const model = () => normalisePlan(structuredClone(PLAN));
const raw = () => resolveLayout({ model: model(), inventory: inv(), saved: null }).items;
const shown = (items, choice) => applyInventory(applyChoice(items, inv(), 'bed', choice), inv()).map((x) => resolve(x));
const ids = (items) => items.filter((x) => !x.hidden).map((x) => x.id).sort();
const storage = (items) => items.find((x) => x.id === 'bed-latitude');
const near = (a, b, eps = 0.6) => Math.abs(a - b) <= eps;

// ------------------------------------------------------------------ the maker's dimensions, once
test('the storage bed is modelled to the maker\'s dimensions, which live in one place and every part is read from them', () => {
  const piece = inv().pieces.find((p) => p.id === 'bed-latitude'), s = piece.spec;
  assert.deepEqual([piece.w, piece.d, piece.h], [94, 83.3, 47.4], 'overall 94 wide x 83.3 long x 47.4 tall');
  assert.deepEqual(s.overall, { w: 94, d: 83.3, h: 47.4 });
  assert.equal(s.headboard.depth, 3.9); assert.equal(s.headboard.tower_w, 16.7);
  assert.deepEqual([s.nightstand.w, s.nightstand.d, s.nightstand.h], [16.7, 17, 8.3]);
  assert.deepEqual([s.nightstand.drawer_w, s.nightstand.drawer_d, s.nightstand.drawer_h], [11.3, 13.9, 3.4]);
  assert.deepEqual([s.frame.w, s.frame.rail_h, s.frame.clearance, s.frame.centre_legs], [60.5, 13, 4.5, 3]);
  assert.deepEqual(s.mattress, { w: 60, d: 80, h: 12 });
  assert.deepEqual([s.drawers.per_side, s.drawers.front_l, s.drawers.front_h], [2, 30.7, 11.8]);
  assert.deepEqual([s.drawers.basket_l, s.drawers.basket_w, s.drawers.basket_h], [25.4, 17, 4.7]);
  // every figure says whether it is in the retailer's table, printed on the drawing, measured off its proportions, or our choice
  const leaves = Object.entries(s).filter(([g]) => g !== 'overall').flatMap(([g, v]) => Object.keys(v).map((k) => `${g}.${k}`)).concat(['overall.w', 'overall.d', 'overall.h']);
  assert.deepEqual([...leaves].sort(), Object.keys(piece.spec_basis).sort());
  assert.deepEqual(Object.entries(piece.spec_basis).filter(([, b]) => b === 'spec').map(([k]) => k).sort(), ['drawers.per_side', 'frame.centre_legs', 'frame.clearance', 'frame.rail_h', 'mattress.d', 'mattress.w', 'overall.d', 'overall.h', 'overall.w']);
  assert.equal(piece.source, 'manufacturer');
  assert.deepEqual([piece.candidate.sku, piece.candidate.brand, piece.candidate.colour, piece.candidate.size], ['BHLT1182', 'Latitude Run', 'Brown Oak', 'Queen']);
  assert.match(piece.candidate.status, /candidate purchase, not owned/);
  assert.ok(!/price|\$/i.test(JSON.stringify(piece.candidate).replace(/Prices are deliberately not recorded\./, '')), 'no price is stored');

  const it = shown(raw(), 'storage').find((x) => x.id === 'bed-latitude'), g = dimsOf(it.spec), parts = Object.fromEntries(partsOf(it.spec, it.w, it.d).map((p) => [p.id, p]));
  const dx = (p) => p.x1 - p.x0, dy = (p) => p.y1 - p.y0, dz = (p) => p.z1 - p.z0;
  assert.ok(near(dx(parts['tower-left']), 16.7, 0.01) && near(dx(parts['tower-right']), 16.7, 0.01));
  assert.ok(near(dx(parts['nightstand-left']), 16.7, 0.01) && near(dy(parts['nightstand-left']) + g.head.towerDepth, 17, 0.01), 'the nightstand is 17 in out from the wall');
  assert.ok(near(dz(parts['nightstand-left']), 8.3, 0.01) && near(parts['nightstand-left'].z0, 13.8, 0.01), 'the nightstand floats 13.8 in up, its top level with the mattress top');
  assert.ok(near(parts['nightstand-left'].z1, g.mattressTop, 2), 'about level with the top of the mattress, as in the maker\'s photos');
  assert.ok(near(dx(parts.frame), 60.5, 0.01) && near(dy(parts.frame) + parts.headboard.y1 - parts.headboard.y0, 83.3, 0.01), 'the platform and the panel are the 83.3 in');
  assert.ok(near(parts.frame.z0, 1.2, 0.01) && near(g.rim, 13, 0.01), 'the oak box is 13 in from the floor, on black feet');
  assert.ok(near(parts.headboard.y1 - parts.headboard.y0, 3.9, 0.01) && near(parts.headboard.z1, 47.4, 0.01));
  assert.ok(near(g.mattressTop - g.slat, 12, 0.01) && near(g.centreBottom - g.slat, 12, 0.01), 'a 12 in mattress on slats 12 in under the headboard\'s band: it fills the gap exactly');
  const xs = Object.values(parts).flatMap((p) => [p.x0, p.x1]), ys = Object.values(parts).flatMap((p) => [p.y0, p.y1]);
  assert.ok(near(Math.max(...xs) - Math.min(...xs), 94, 0.01) && near(Math.max(...ys) - Math.min(...ys), 83.3, 0.01), 'the parts fill exactly 94 x 83.3');
  assert.ok(Math.max(...Object.values(parts).map((p) => p.z1)) <= 47.4 + 1e-9);
  // one source: change the data and the model follows (nothing in the code repeats a size)
  const wider = structuredClone(it.spec); wider.nightstand.d = 20; wider.headboard.tower_w = 18;
  const w2 = Object.fromEntries(partsOf(wider, it.w, it.d).map((p) => [p.id, p]));
  assert.ok(near(dx(w2['tower-left']), 18, 0.01) && near(w2['nightstand-left'].y1 - w2['nightstand-left'].y0 + g.head.towerDepth, 20, 0.01));
  // the 2D plan and the checks use the same parts: the footprint of the checks' parts is the maker's outline, not a 94 x 83 block
  const pp = partPolys(it);
  assert.equal(pp.length, 8);
  const area = pp.reduce((a, p) => a + Math.abs(p.poly.reduce((s2, q, i) => s2 + q[0] * p.poly[(i + 1) % 4][1] - p.poly[(i + 1) % 4][0] * q[1], 0)) / 2, 0);
  assert.ok(area < 94 * 83.3 * 0.85, 'the corners beside the foot of the bed are free');
});

test('the catalogue and the renter\'s data agree: the storage bed is a bed with towers, its zones measure the platform and the drawer runs', () => {
  const it = storage(shown(raw(), 'storage')), zones = Object.fromEntries(it.zones.map((z) => [z.key + z.side, z]));
  assert.equal(it.kind, 'bed'); assert.equal(it.base.style, 'tower-storage');
  assert.ok(zones.drawer_pullleft && zones.drawer_pullright, 'a pull-out zone on each side');
  for (const z of [zones.drawer_pullleft, zones.drawer_pullright]) { assert.equal(z.preferred, 31, 'the drawers pull out 17 in and want about 31 in'); assert.equal(z.min, 24); assert.equal(z.mode, 'full'); }
  // the lanes beside the bed hang off the 60.5 in platform, not the 94 in headboard unit
  assert.equal(Math.abs(zones.bed_sideleft.at), 30.25); assert.equal(zones.bed_footfront.width, 60.5);
  assert.ok(near(zones.drawer_pullleft.along[1] - zones.drawer_pullleft.along[0], 61.4, 0.01), 'the two drawer fronts, 2 x 30.7 in, from the foot end');
});

// ------------------------------------------------------------------ the toggle
test('the Bed control shows exactly the pieces its choice lists: the storage bed brings its own nightstands, "No bed" keeps the separate ones', () => {
  const items = raw();
  assert.equal(defaultChoice(inv()), 'mine');
  assert.deepEqual(ids(items), ['bed', 'coffee', 'desk', 'desk-chair', 'dining', 'dresser', 'futon', 'nightstand-1', 'nightstand-2', 'sim-rig', 'tv', 'tv-bed'], 'my bed is what loads (the sim rig and the office chair are shown by default too)');
  assert.deepEqual(choiceState(items, inv()), { group: 'bed', label: 'Bed', available: true, current: 'mine', exact: true, choices: [{ id: 'mine', label: 'My bed' }, { id: 'storage', label: 'Latitude Run storage bed' }, { id: 'none', label: 'No bed' }] });
  const st = applyChoice(items, inv(), 'bed', 'storage');
  assert.deepEqual(ids(st), ['bed-latitude', 'coffee', 'desk', 'desk-chair', 'dining', 'dresser', 'futon', 'sim-rig', 'tv', 'tv-bed'], 'the separate nightstands are hidden with it: it has its own');
  assert.equal(choiceState(st, inv()).current, 'storage');
  const none = applyChoice(st, inv(), 'bed', 'none');
  assert.deepEqual(ids(none), ['coffee', 'desk', 'desk-chair', 'dining', 'dresser', 'futon', 'nightstand-1', 'nightstand-2', 'sim-rig', 'tv', 'tv-bed'], 'no bed: both beds hidden, the nightstands stand on their own');
  assert.equal(choiceState(none, inv()).current, 'none');
  assert.deepEqual(ids(applyChoice(none, inv(), 'bed', 'mine')), ids(items), 'and back: nothing is lost on the way');
  assert.ok(applyChoice(items, inv(), 'bed', 'mine').every((x, i) => x === items[i]), 'choosing what is shown changes nothing (every piece comes back as the same object)');
  assert.equal(applyChoice(items, inv(), 'bed', 'nonsense'), items);
  // a piece shown or hidden by hand is "closest match", never a surprise
  const odd = items.map((x) => (x.id === 'nightstand-2' ? { ...x, hidden: true } : x));
  const s = choiceState(odd, inv()); assert.equal(s.current, 'mine'); assert.equal(s.exact, false);
});

test('choosing a bed moves nothing: every position, turn, size and mark of every piece is what it was', () => {
  const items = raw(), strip = (list) => list.map(({ hidden, ...rest }) => rest);
  for (const c of ['storage', 'none', 'mine']) {
    const next = applyChoice(items, inv(), 'bed', c);
    assert.deepEqual(strip(next), strip(items), `${c}: the same pieces in the same order at the same places`);
    assert.ok(next.every((x) => x.placed === true), 'still all placed by the renter');
  }
  // and the other pieces' fit verdicts do not change when only the bed does
  const m = model(), mine = evaluate(m, shown(items, 'mine')), alt = evaluate(m, shown(items, 'storage'));
  for (const id of ['tv', 'dresser', 'desk', 'futon', 'dining', 'coffee']) assert.deepEqual(alt.items[id].issues.map((i) => i.text), mine.items[id].issues.map((i) => i.text), `${id} reads the same with either bed`);
  // the bed the renter may buy stands on the same wall, centred where their own bed is
  const res = shown(items, 'storage'), mineBed = res.find((x) => x.id === 'bed'), cand = storage(res);
  assert.equal(cand.rot, mineBed.rot); assert.equal(cand.y, mineBed.y, 'centred on the same line along the wall');
  assert.ok(near(cand.x + cand.d / 2, mineBed.x + mineBed.d / 2, 0.1), 'the headboard end is where the headboard end of their bed is');
});

test('the choice is saved with the layout, comes back from it, and a layout saved before the bed existed still loads', () => {
  const m = model(), items = applyChoice(raw(), inv(), 'bed', 'storage');
  const saved = serialiseLayout(PLAN.id, items, { removed: [] }), v = validateLayout(JSON.parse(JSON.stringify(saved)), { planId: PLAN.id, lenient: true });
  assert.ok(v.ok); assert.equal(v.layout.items.find((x) => x.id === 'bed').hidden, true); assert.ok(!v.layout.items.find((x) => x.id === 'bed-latitude').hidden);
  const back = resolveLayout({ model: m, inventory: inv(), saved: v });
  assert.equal(back.source, 'saved'); assert.equal(choiceState(back.items, inv()).current, 'storage', 'remembered');
  assert.equal(back.changed, false, 'nothing needs rewriting');
  // a layout saved by the studio before the bed was a piece: the missing piece is filled from the default (hidden), the rest keep their places
  const old = { schema: 1, kind: 'apartmentscout-layout', plan: PLAN.id, units: 'in', ver: 2, items: raw().filter((x) => x.id !== 'bed-latitude').map((x) => ({ ...x, x: x.x + 1 })) };
  const r = resolveLayout({ model: m, inventory: inv(), saved: validateLayout(old, { planId: PLAN.id, lenient: true }) });
  assert.deepEqual(r.filled, ['bed-latitude']); assert.equal(storage(r.items).hidden, true, 'my bed stays the choice');
  assert.ok(near(r.items.find((x) => x.id === 'tv').x, raw().find((x) => x.id === 'tv').x + 1, 0.1), 'the pieces the renter placed do not move');
  assert.equal(choiceState(r.items, inv()).current, 'mine');
  // storage lookup uses the same key the studio writes
  const store = { get: (k, d) => (k === layoutKey('data', PLAN.id) ? JSON.parse(JSON.stringify(saved)) : d) };
  assert.equal(savedLayoutFor(store, 'data', PLAN.id).layout.items.find((x) => x.id === 'bed').hidden, true);
});

test('a plan whose layout has no storage bed has nothing to switch to, and the bed is never fitted beside the renter\'s own', () => {
  const m = normalisePlan(read('examples/nyc-2026/plans/emerald-green-1211.json')), r = resolveLayout({ model: m, inventory: inv(), saved: null });
  assert.equal(r.items.some((x) => x.id === 'bed-latitude'), false);
  assert.equal(choiceState(r.items, inv()).available, false, 'no control');
  // nor does an automatic fit invent one for a saved layout that lacks it
  const s = validateLayout({ schema: 1, kind: 'apartmentscout-layout', plan: m.id, units: 'in', ver: 2, items: r.items.filter((x) => x.id !== 'coffee') }, { planId: m.id, lenient: true });
  assert.equal(resolveLayout({ model: m, inventory: inv(), saved: s }).items.some((x) => x.id === 'bed-latitude'), false);
  assert.equal(offByDefault(inv(), 'bed-latitude'), true); assert.equal(offByDefault(inv(), 'bed'), false);
  assert.ok(!kitFromInventory(inv()).some((k) => k.id === 'bed-latitude'));
  const j = fitInventory(normalisePlan(read('examples/nyc-2026/plans/paramount-tower-9j.json')), inv(), { step: 10 });
  assert.ok(!j.items.some((x) => x.id === 'bed-latitude') && /^Your 11 pieces/.test(j.note));
});

// ------------------------------------------------------------------ the checks see the bed's real shape
test('the checks measure each solid part at its own height: a floating nightstand clears a low box, a tall one is a collision', () => {
  const m = model(), items = shown(raw(), 'storage'), bed = storage(items);
  const nsRight = partPolys(bed).find((p) => p.id === 'nightstand-right'), c0 = nsRight.poly.reduce((a, q) => [a[0] + q[0] / 4, a[1] + q[1] / 4], [0, 0]), c = [c0[0] - 3.75, c0[1]];   // under the front of the nightstand, in front of the closed box that stands to the floor
  const box = (h) => resolve({ id: 'box', ref: 'custom-box', x: c[0], y: c[1], rot: 0, w: 4, d: 4, h, placed: true });
  const under = evaluate(m, [...items.filter((x) => x.id !== 'tv-bed'), box(8)]), through = evaluate(m, [...items.filter((x) => x.id !== 'tv-bed'), box(18)]);
  assert.ok(!under.items['bed-latitude'].issues.some((i) => /box|piece/i.test(i.text)), 'an 8 in box fits under the nightstand (it floats from 13.8 in up)');
  assert.ok(through.items['bed-latitude'].issues.some((i) => i.code === 'overlap'), 'an 18 in one runs into it');
  // the corners beside the foot are free: a stool there is not "overlapping the bed"
  const foot = resolve({ id: 'stool', ref: 'custom-box', x: bed.x - 35, y: bed.y + (bed.rot === 90 ? 40 : 0), rot: 0, w: 10, d: 10, h: 18, placed: true });
  assert.equal(footprint(bed).length, 4, 'the outline for selection and dragging is still the 94 x 83.3 block');
  assert.ok(foot.x < bed.x);
});

// ------------------------------------------------------------------ the fit checks for the 94 in unit on that wall
test('Paramount 25E: the 94 in storage bed fits the headboard wall, centred where the renter\'s bed is, with its walk, drawers, doors, window and heat', () => {
  const m = model(), items = shown(raw(), 'storage'), rep = bedFit(m, items), by = Object.fromEntries(rep.rows.map((r) => [r.key, r]));
  assert.ok(rep.fits, rep.summary);
  assert.equal(rep.grade, 'clear', 'every question is clear: the tall dresser stands beside the foot of the bed, not in front of it');
  // the wall: 22 in to the closet-side corner (left, as you lie in it) and 8 in to the window (right)
  assert.equal(by.wall.grade, 'clear');
  assert.ok(near(by.wall.left, 22, 0.8) && near(by.wall.right, 8, 0.8), `left ${by.wall.left}, right ${by.wall.right}`);
  assert.match(by.wall.text, /Fits: the 94 in headboard unit has 22 in to spare on the left \(to the wall\) and 8 in to spare on the right \(to the window\)\./);
  // the length against the walk to the TV wall: the STORKLINTA dresser is on that wall but beside the bed's foot, so the walk is the whole 51 in to the wall
  assert.equal(by.walk.grade, 'clear'); assert.ok(near(by.walk.free, 51, 1), `${by.walk.free}`);
  assert.match(by.walk.text, /from its foot to a wall: fits/);
  // the drawers pull out 17 in and want about 31: both sides have it (39 in on the closet side, more than 60 on the window side)
  assert.equal(by.drawers.grade, 'clear'); assert.ok(by.drawers.sides.left >= 31 && by.drawers.sides.right >= 31); assert.ok(near(by.drawers.sides.left, 38.75, 0.8), `${by.drawers.sides.left}`);
  assert.match(by.drawers.text, /pull out 17 in and want about 31 in/);
  // doors: the bedroom door's swing and the way in to the closet both clear it, and the text says what an open drawer does
  assert.equal(by.doors.grade, 'clear');
  const closet = by.doors.doors.find((d) => d.closet), bedroom = by.doors.doors.find((d) => /bedroom door/.test(d.name));
  assert.ok(closet && bedroom && closet.gap > 8 && bedroom.gap > 8, JSON.stringify(by.doors.doors.map((d) => [d.name, d.gap])));
  assert.match(by.doors.text, /left drawer pulled right out reaches \d+ in into its 30 in approach/);
  // the window starts 8 in past the right tower; the towers rise 47 in over a 20 in sill
  assert.equal(by.windows.grade, 'clear'); assert.match(by.windows.text, /starts 8 in past the right tower \(sill 20 in; the towers rise 47 in\)/);
  // heat: the bedroom AC is far from the bed and its 18 in of clearance is free; the plan has no radiator, and says so
  assert.equal(by.heat.grade, 'clear'); assert.match(by.heat.text, /The Bedroom AC is \d+ in from the bed, and the 18 in in front of it is clear/); assert.match(by.heat.text, /the plan has no radiator/);
  // the studio's own checks agree: nothing blocked, the bed itself is clear, and no other piece is worse off than with the renter's bed
  const ev = evaluate(m, items); assert.equal(ev.counts.blocked, 0); assert.equal(ev.items['bed-latitude'].state, 'clear');
  assert.equal(rep.wall.name, 'the south-west wall');
  assert.equal(reportFor(m, raw(), inv()).alternative, null, 'it fits, so no other wall is proposed');
});

test('which side is which: left and right are the person\'s, lying in the bed, and the windows are on the right', () => {
  const m = model(), bed = storage(shown(raw(), 'storage')), win = m.windows.find((w) => w.room === 'Bedroom');
  const to = [win.mid[0] - bed.x, win.mid[1] - bed.y], len = Math.hypot(...to);
  assert.equal(sideOf(bed, [to[0] / len, to[1] / len]), 'right');
  assert.equal(polyGap([[0, 0], [1, 0], [1, 1], [0, 1]], [[3, 0], [4, 0], [4, 1], [3, 1]]), 2);
  assert.equal(polyGap([[0, 0], [2, 0], [2, 2], [0, 2]], [[1, 1], [3, 1], [3, 3], [1, 3]]), 0);
});

test('when the wall is too short the report says so plainly, says by how much, and proposes the best other wall with its own answers', () => {
  const m = model(), items = raw();
  // slide the unit along the wall until its south tower stands in front of the bay window: that does not fit
  const moved = items.map((x) => (x.id === 'bed-latitude' ? { ...x, y: x.y + 14 } : x));
  const rep = reportFor(m, moved, inv()), by = Object.fromEntries(rep.rows.map((r) => [r.key, r]));
  assert.equal(rep.fits, false); assert.equal(rep.grade, 'blocked');
  assert.equal(by.windows.grade, 'blocked'); assert.match(by.windows.text, /in from the end of the right tower, so the tower would stand in front of the glass/);
  assert.equal(by.wall.grade, 'blocked'); assert.match(by.wall.text, /^Does not fit this wall: the 94 in headboard unit is \d+ in short on the right, where the window is in the way\./);
  assert.match(rep.summary, /^Does not fit as placed: the wall, the window/);
  // two suggestions, neither applied: slide it back along the same wall (toward the closet side), or use another wall
  assert.ok(rep.alternative.slide, 'a slide along the same wall fits'); assert.equal(rep.alternative.slide.toward, 'left');
  assert.ok(rep.alternative.slide.by >= 8 && rep.alternative.slide.by <= 20, `${rep.alternative.slide.by}`);
  assert.ok(rep.alternative.slide.report.fits); assert.match(rep.alternative.text, /^Sliding it \d+ in toward your left along the same wall fits: /);
  assert.ok(rep.alternative.wall && rep.alternative.wall.report.fits, 'and another wall is proposed with its own answers');
  assert.notEqual(rep.alternative.wall.item.rot, moved.find((x) => x.id === 'bed-latitude').rot, 'a different wall, not the same one');
  assert.match(rep.alternative.text, /The best other wall in this room is the [a-z-]+ wall: Fits: /);
  // too wide for any wall in the room: say that, do not move it
  const wide = structuredClone(inv()); wide.pieces.find((p) => p.id === 'bed-latitude').spec.overall.w = 140; wide.pieces.find((p) => p.id === 'bed-latitude').w = 140;
  const big = reportFor(m, items, wide);
  assert.equal(big.fits, false); assert.match(big.rows.find((r) => r.key === 'wall').text, /^Does not fit this wall/);
  // and the renter's bed is still where they put it: the report never writes to the layout
  assert.deepEqual(raw().find((x) => x.id === 'bed'), items.find((x) => x.id === 'bed'));
});

// ------------------------------------------------------------------ the words in the control
test('the control lists the three choices with the right one on, and the card prints every question once', () => {
  const st = choiceState(raw(), inv()), html = bedControlHTML(st, { fit: 'tight' });
  assert.match(html, /aria-checked="true" data-bed-choice="mine"/); assert.match(html, /aria-checked="false" data-bed-choice="storage"/);
  assert.match(html, />Latitude Run storage bed</); assert.match(html, />My bed</); assert.match(html, />No bed</); assert.match(html, /bd-dot g-tight/);
  assert.equal(bedControlHTML({ ...st, available: false }), '', 'no storage bed in this layout: no control');
  const rep = reportFor(model(), raw(), inv()), card = bedFitHTML(rep, inv().pieces.find((p) => p.id === 'bed-latitude'));
  for (const k of ['wall', 'walk', 'drawers', 'doors', 'windows', 'heat']) assert.equal((card.match(new RegExp(`data-bed-row="${k}"`, 'g')) || []).length, 1, k);
  assert.match(card, /candidate purchase, not owned/); assert.match(card, /SKU BHLT1182/); assert.match(card, /94 x 83\.3 x 47\.4 in/);
  assert.match(card, /href="https:\/\/www\.wayfair\.com\/[^"]+" target="_blank" rel="noopener noreferrer"/);
  assert.ok(!/<script/i.test(card));
  assert.match(bedFitHTML(null, null), /not in this layout/);
});
