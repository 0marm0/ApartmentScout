// node --test tests/js/desk-chair.test.mjs : the renter's rolling office chair is a piece of its own (not part of the desk set). It is shown or hidden with the
//   "Office chair" switch, and either attached to the desk (it moves and turns with the desk, keeping its offset) or free (a plain piece), saved as `attach` on the item.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalisePlan } from '../../dashboard/js/plan/model.js';
import { validateInventory } from '../../dashboard/js/plan/inventory.js';
import { resolve } from '../../dashboard/js/plan/catalog.js';
import { evaluate, toWorld } from '../../dashboard/js/plan/checks.js';
import { applyInventory, resolveLayout } from '../../dashboard/js/plan/placement.js';
import { choiceState, applyChoice } from '../../dashboard/js/plan/choices.js';
import { validateLayout, serialiseLayout } from '../../dashboard/js/plan/layout.js';
import { followAttached, seatAtDesk, isAttached, nearestDesk } from '../../dashboard/js/plan/attach.js';

const read = (p) => JSON.parse(fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8'));
const inv = validateInventory(read('examples/nyc-2026/furniture.json')).inventory;
const m = normalisePlan(read('examples/nyc-2026/plans/paramount-tower-25e.json'));
const base = resolveLayout({ model: m, inventory: inv, saved: null }).items;
const build = (list) => applyInventory(list, inv).map((x) => resolve(x));
const close = (a, b, eps = 0.15) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

test('the office chair is its own piece, not part of the desk set; a rolling chair of the renter\'s, black as an assumption', () => {
  const p = inv.pieces.find((x) => x.id === 'desk-chair'), desk = inv.pieces.find((x) => x.id === 'desk');
  assert.equal(p.ref, 'task-chair'); assert.equal(p.label, 'Office chair (rolling task chair)');
  assert.equal(p.look.basis, 'renter'); assert.ok(p.look.assumed.includes('color'), 'the black is an assumption');
  assert.equal(desk.set.chair, false, 'removed from the desk set');
  const r = build(base), ch = r.find((x) => x.id === 'desk-chair'), dk = r.find((x) => x.id === 'desk');
  assert.equal(ch.kind, 'taskchair'); assert.ok(ch.parts.length, 'its seat and back are separate solids for the fit checks');
  assert.equal(r.filter((x) => x.kind === 'chair').length, 0);
  assert.equal(dk.set.chair, false);
});

test('25E: the chair stands at the desk\'s shelf end, beside the rig, attached to the desk, and nothing is blocked; both are shown by default', () => {
  const r = build(base), ev = evaluate(m, r), ch = base.find((x) => x.id === 'desk-chair');
  assert.equal(ch.attach, 'desk'); assert.equal(isAttached(base, 'desk-chair'), true);
  assert.equal(ev.counts.blocked, 0, JSON.stringify(Object.values(ev.items).filter((i) => i.state === 'blocked').map((i) => i.issues.map((q) => q.text))));
  assert.equal(ev.items['desk-chair'].state, 'clear'); assert.equal(ev.items['sim-rig'].state, 'clear');
  assert.equal(choiceState(base, inv, 'chair').current, 'shown'); assert.equal(choiceState(base, inv, 'sim').current, 'shown');
  const off = applyChoice(base, inv, 'chair', 'hidden');
  assert.equal(off.find((x) => x.id === 'desk-chair').hidden, true); assert.equal(off.find((x) => x.id === 'sim-rig').hidden, undefined, 'the rig is unaffected');
  assert.equal(evaluate(m, build(off)).items['desk-chair'], undefined, 'a hidden chair is not checked');
});

test('an attached chair moves and turns rigidly with its desk, keeping its offset; a free chair, or one dragged on its own, does not follow', () => {
  const desk0 = base.find((x) => x.id === 'desk'), moved = (list, patch) => list.map((x) => (x.id === 'desk' ? { ...x, ...patch } : x));
  const rel = (list) => { const d = list.find((x) => x.id === 'desk'), c = list.find((x) => x.id === 'desk-chair'), D = build([d])[0]; return [Math.hypot(c.x - d.x, c.y - d.y), ((c.rot - d.rot) % 360 + 360) % 360, D.rot]; };
  const slid = followAttached(base, moved(base, { x: desk0.x + 40, y: desk0.y - 25 }));
  const c0 = base.find((x) => x.id === 'desk-chair'), c1 = slid.find((x) => x.id === 'desk-chair');
  close(c1.x - c0.x, 40); close(c1.y - c0.y, -25); assert.equal(c1.rot, c0.rot);
  const turned = followAttached(base, moved(base, { rot: (desk0.rot + 90) % 360 })), c2 = turned.find((x) => x.id === 'desk-chair');
  close(rel(turned)[0], rel(base)[0], 0.2); close(rel(turned)[1], rel(base)[1], 0.2);
  assert.equal(c2.rot, (c0.rot + 90) % 360, 'it turns with the desk');
  // free: no attach, no follow
  const free = base.map((x) => { if (x.id !== 'desk-chair') return x; const o = { ...x }; delete o.attach; return o; });
  const stayed = followAttached(free, moved(free, { x: desk0.x + 40 }));
  assert.equal(stayed.find((x) => x.id === 'desk-chair').x, c0.x, 'a separate chair stays where it is');
  // the chair itself moved in the same step (undo, loading a layout, a drag): it is not moved twice
  const both = moved(base.map((x) => (x.id === 'desk-chair' ? { ...x, x: 100 } : x)), { x: desk0.x + 40 });
  assert.equal(followAttached(base, both).find((x) => x.id === 'desk-chair').x, 100);
});

test('attaching snaps the chair to the desktop facing the desk (or beside the shelf when the rig takes the seat); the choice is saved as `attach`', () => {
  const dk = build(base).find((x) => x.id === 'desk'), at = seatAtDesk(dk), aside = seatAtDesk(dk, { aside: true });
  const [wx, wy] = toWorld(dk, dk.seatX, -(dk.d / 2 + 10));
  close(at.x, wx); close(at.y, wy); assert.equal(at.rot, (dk.rot + 180) % 360, 'turned to face the desk');
  assert.ok(Math.hypot(aside.x - at.x, aside.y - at.y) > 30, 'the shelf end is the other side of the desk');
  assert.equal(nearestDesk(base, { id: 'desk-chair', x: aside.x, y: aside.y }).id, 'desk');
  const saved = JSON.parse(JSON.stringify(serialiseLayout('paramount-tower-25e', base)));
  assert.equal(saved.items.find((x) => x.id === 'desk-chair').attach, 'desk');
  const back = validateLayout(saved, { planId: 'paramount-tower-25e' });
  assert.equal(back.ok, true); assert.equal(back.layout.items.find((x) => x.id === 'desk-chair').attach, 'desk');
  assert.equal(validateLayout({ ...saved, items: saved.items.map((x) => (x.id === 'desk-chair' ? { ...x, attach: '<b>' } : x)) }).ok, false, 'attach must be a piece id');
});
