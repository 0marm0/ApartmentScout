// node --test tests/js/sim-rig.test.mjs : the renter's sim-racing cockpit (Next Level Racing F-GT Lite in GT mode, Fanatec direct-drive base and Formula wheel).
//   its footprint is the conservative planning envelope (195 x 85 x 130 cm), the published conflicting figures are kept with their sources and status,
//   the pedal end is low enough to slide under the desktop, and the fit checks treat that as allowed (and still catch a rig that really hits the desk).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalisePlan } from '../../dashboard/js/plan/model.js';
import { validateInventory } from '../../dashboard/js/plan/inventory.js';
import { resolve } from '../../dashboard/js/plan/catalog.js';
import { evaluate, partPolys, overlaps } from '../../dashboard/js/plan/checks.js';
import { applyInventory, resolveLayout } from '../../dashboard/js/plan/placement.js';
import { choiceState, applyChoice } from '../../dashboard/js/plan/choices.js';
import { layoutOf, ENVELOPE } from '../../dashboard/js/plan/rigspec.js';

const read = (p) => JSON.parse(fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8'));
const m = normalisePlan(read('examples/nyc-2026/plans/paramount-tower-25e.json')), inv = validateInventory(read('examples/nyc-2026/furniture.json')).inventory;
const cm = (v) => Math.round(v * 2.54);
const build = (layoutItems) => applyInventory(layoutItems, inv).map((x) => resolve(x));
const base = resolveLayout({ model: m, inventory: inv, saved: null }).items;
const items = build(base), by = Object.fromEntries(items.map((i) => [i.id, i]));

test('the piece is the 195 x 85 x 130 cm planning envelope, with every published figure kept beside its source and status', () => {
  const p = inv.pieces.find((x) => x.id === 'sim-rig'), r = by['sim-rig'];
  assert.deepEqual([cm(r.w), cm(r.d), cm(r.h)], [85, 195, 130], 'width 85, length 195, height 130 cm');
  assert.deepEqual(ENVELOPE, { w: 33.5, d: 76.8, h: 51.2 });
  assert.equal(p.look.basis, 'renter'); assert.match(p.label, /F-GT Lite \(GT\).*Fanatec/);
  const s = p.spec, b = p.spec_basis;
  assert.deepEqual([s.gt_support_cm.l, s.gt_support_cm.w, s.gt_support_cm.h], [175, 75, 127]); assert.equal(b['gt_support_cm.l'], 'spec');
  assert.deepEqual([s.formula_support_cm.l, s.formula_support_cm.w, s.formula_support_cm.h], [164, 75, 94]);
  assert.deepEqual([s.space_graphic_cm.l, s.space_graphic_cm.w, s.space_graphic_cm.h], [185, 85, 125]); assert.equal(b['space_graphic_cm.l'], 'diagram');
  assert.deepEqual([s.reseller_cm.gt_l, s.reseller_cm.formula_l], [185.3, 192.4]); assert.equal(b['reseller_cm.gt_l'], 'listing');
  assert.deepEqual([s.folded_cm.l, s.folded_cm.w, s.folded_cm.h], [75, 40, 87]);
  assert.equal(b['envelope_cm.l'], 'assumed', 'the envelope is a planning choice, not a published size');
  assert.ok(s.envelope_cm.l >= Math.max(s.gt_support_cm.l, s.space_graphic_cm.l, s.reseller_cm.gt_l, s.reseller_cm.formula_l), 'the envelope covers every published length');
});

test('the pedal plate and pedals sit below the desktop\'s underside, under it in plan, and the fit checks allow that', () => {
  const rig = by['sim-rig'], desk = by.desk, top = desk.deskGeo.boxes.find((b) => b.id === 'desktop');
  const under = top.y0;   // the desktop slab's underside, about 27.4 in
  assert.ok(Math.abs(under - 27.45) < 0.1, `desktop underside ${under}`);
  const pedals = partPolys(rig).filter((q) => ['pedal-plate', 'pedals'].includes(q.id));
  assert.equal(pedals.length, 2);
  for (const q of pedals) assert.ok(q.z1 < under - 5, `${q.id} tops out at ${q.z1} in, well below the desktop`);
  // in plan the pedal plate lies under the desktop
  const desktop = partPolys(desk).find((q) => q.id === 'desktop');
  assert.ok(pedals.every((q) => overlaps(q.poly, desktop.poly, 0.5)), 'the pedals are under the desktop in plan');
  // everything that reaches the desktop's height stays out from under it: the front 17 in (the desk is 21.6 in deep, the rig front sits ~4 in off the wall)
  const hit = partPolys(rig).filter((q) => q.z1 > under - 0.25 && overlaps(q.poly, desktop.poly, 0.5));
  assert.deepEqual(hit.map((q) => q.id), [], 'nothing of the rig that is as tall as the desktop is under it');
  // so the checks call it clear, not an overlap, and the desk's chair zone is not read as blocked by the rig
  const ev = evaluate(m, items);
  assert.equal(ev.items['sim-rig'].state, 'clear', JSON.stringify(ev.items['sim-rig'].issues));
  assert.equal(ev.items.desk.state, 'clear', JSON.stringify(ev.items.desk.issues));
  assert.equal(ev.counts.blocked, 0);
  // the seat faces the desk: the rig's front is toward the desk (the pedal end), its back away from it
  assert.ok(rig.x > desk.x, 'the rig stands in front of the desk');
});

test('a rig turned across the desk, so its tall parts meet the desk, is not clear (the under-desk allowance is about height, not a free pass)', () => {
  const moved = base.map((x) => (x.id === 'sim-rig' ? { ...x, x: 50, rot: 0 } : x));
  const ev = evaluate(m, build(moved)), r = ev.items['sim-rig'];
  assert.notEqual(r.state, 'clear');
  assert.ok(r.issues.some((i) => /desk|wall|overlaps/i.test(i.text)), JSON.stringify(r.issues.map((i) => i.text)));
});

test('Formula mode reclines the seat and lowers the wheel and the pedals rise, with the same footprint; GT is the default', () => {
  const gt = layoutOf('gt'), f = layoutOf('formula');
  assert.equal(by['sim-rig'].variant, undefined, 'GT by default');
  assert.deepEqual([gt.w, gt.d], [f.w, f.d]);
  assert.ok(f.dims.deck.z0 < gt.dims.deck.z0 - 8, 'a lower wheel');
  assert.ok(f.dims.pedals.z1 > gt.dims.pedals.z1 + 3, 'pedals higher');
  assert.ok(f.dims.back.lean > gt.dims.back.lean + 15, 'a reclined back');
  assert.ok(f.h < gt.h);
  assert.ok(f.frontHeight(17) < 27.4 && gt.frontHeight(17) < 27.4, 'the pedal end passes under a 27.4 in desktop in both modes');
  const fm = resolve({ id: 'sim-rig', ref: 'sim-rig', variant: 'formula', x: 62.4, y: 327, rot: 90 });
  assert.equal(fm.h, 37); assert.equal(fm.rigGeo.mode, 'formula');
});

test('the rig can be shown or hidden like the bed options, without moving anything, and a hidden rig brings the desk chair back', () => {
  const st = choiceState(base, inv, 'sim');
  assert.equal(st.available, true); assert.equal(st.current, 'shown'); assert.equal(st.exact, true);
  const off = applyChoice(base, inv, 'sim', 'hidden');
  assert.equal(off.find((x) => x.id === 'sim-rig').hidden, true);
  assert.deepEqual(off.filter((x) => x.id !== 'sim-rig').map((x) => [x.id, x.x, x.y, x.rot]), base.filter((x) => x.id !== 'sim-rig').map((x) => [x.id, x.x, x.y, x.rot]), 'nothing else moves');
  assert.equal(choiceState(off, inv, 'sim').current, 'hidden');
  assert.equal(applyChoice(off, inv, 'sim', 'shown').find((x) => x.id === 'sim-rig').hidden, undefined);
  assert.equal(build(base).find((x) => x.id === 'desk').chairAside, true, 'the shown rig takes the chair\'s place');
  assert.equal(build(off).find((x) => x.id === 'desk').chairAside, undefined, 'hidden: the desk chair is back');
  assert.equal(evaluate(m, build(off)).items['sim-rig'], undefined, 'a hidden rig is not checked');
});
