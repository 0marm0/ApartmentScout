// node --test tests/js/furniture-restore-dup.test.mjs : a hidden or removed piece of "Your furniture" can always be shown again (the Sim rig / Office chair switches
//   never disappear, and the list has a Show / Add back button), and a duplicate (`from`) persists through save/load and looks exactly like its source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalisePlan } from '../../dashboard/js/plan/model.js';
import { validateInventory } from '../../dashboard/js/plan/inventory.js';
import { resolve } from '../../dashboard/js/plan/catalog.js';
import { applyInventory, resolveLayout, chooseGroup } from '../../dashboard/js/plan/placement.js';
import { choiceState, applyChoice } from '../../dashboard/js/plan/choices.js';
import { validateLayout, serialiseLayout, newId } from '../../dashboard/js/plan/layout.js';
import { inventoryHTML } from '../../dashboard/js/plan/inventory-ui.js';
import { rigControlHTML } from '../../dashboard/js/plan/bed-ui.js';
import { serialiseProject, parseProject } from '../../dashboard/js/plan/project.js';

const read = (p) => JSON.parse(fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8'));
const inv = validateInventory(read('examples/nyc-2026/furniture.json')).inventory;
const raw = read('examples/nyc-2026/plans/paramount-tower-25e.json'), m = normalisePlan(raw);
const base = resolveLayout({ model: m, inventory: inv, saved: null }).items;

test('the Sim rig switch stays after the rig is hidden or removed, and Shown brings it back to its spot', () => {
  const spot = base.find((x) => x.id === 'sim-rig');
  const hidden = applyChoice(base, inv, 'sim', 'hidden');
  assert.equal(choiceState(hidden, inv, 'sim').available, true, 'hidden: the switch is there');
  assert.ok(rigControlHTML(choiceState(hidden, inv, 'sim')).includes('data-rig-choice="shown"'), 'with a Shown button');
  // removed (Delete / Remove): the item is gone from the layout, the switch is still there and shows the rig as Hidden
  const removed = hidden.filter((x) => x.id !== 'sim-rig'), st = choiceState(removed, inv, 'sim', { removed: ['sim-rig'] });
  assert.equal(st.available, true); assert.equal(st.current, 'hidden');
  assert.equal(choiceState(removed, inv, 'sim').available, true, 'also for a layout that never held the rig');
  assert.equal(choiceState(removed, inv, 'chair').available, true);
  // Shown puts it back at the spot it had (the renter's own item), else the plan's default spot
  const was = new Map([['sim-rig', { ...spot, x: spot.x + 7 }]]);
  const own = chooseGroup(removed, inv, 'sim', 'shown', { model: m, gone: was }).items.find((x) => x.id === 'sim-rig');
  assert.equal(own.x, spot.x + 7); assert.equal(own.hidden, undefined); assert.equal(own.placed, true);
  const def = chooseGroup(removed, inv, 'sim', 'shown', { model: m });
  assert.deepEqual(def.restored, ['sim-rig']); assert.deepEqual([def.items.at(-1).x, def.items.at(-1).y], [spot.x, spot.y]);
  assert.equal(choiceState(def.items, inv, 'sim').current, 'shown');
  // a bed group still has no control on a layout that cannot hold the candidate bed
  assert.equal(choiceState(removed, inv, 'bed').available, true, 'the 25E layout holds its beds');
});

test('the Your furniture list offers Show for a hidden piece and Add back for a removed one', () => {
  const hiddenItems = applyChoice(base, inv, 'sim', 'hidden'), held = new Set(hiddenItems.map((x) => x.id));
  const html = inventoryHTML(inv, { held, hidden: new Set(hiddenItems.filter((x) => x.hidden).map((x) => x.id)) });
  assert.ok(html.includes('data-inv-show="sim-rig"'), 'Show on the hidden rig');
  const gone = new Set(held); gone.delete('sim-rig');
  const html2 = inventoryHTML(inv, { held: gone, removed: new Set(['sim-rig']) });
  assert.match(html2, /data-inv-add="sim-rig"[^>]*>Add back</);
});

test('a duplicate survives a save/load round trip (layout and project) and looks exactly like its source', () => {
  const desk = base.find((x) => x.id === 'desk'), chair = base.find((x) => x.id === 'desk-chair');
  const copy = { ...desk, id: newId(desk.ref, base), x: desk.x + 12, y: desk.y - 12, placed: true, from: desk.from || desk.id };
  const stripped = { id: copy.id, ref: copy.ref, x: copy.x, y: copy.y, rot: copy.rot, placed: true, from: 'desk' };   // what a copy of a plain default item holds
  for (const dup of [copy, stripped]) {
    const items = [...base, dup];
    const json = JSON.parse(JSON.stringify(serialiseLayout(m.id, items)));
    const v = validateLayout(json, { planId: m.id, lenient: true });
    assert.equal(v.dropped.length, 0); assert.equal(v.layout.items.find((x) => x.id === dup.id).from, 'desk');
    const r = resolveLayout({ model: m, inventory: inv, saved: v });
    const back = r.items.find((x) => x.id === dup.id);
    assert.ok(back, 'the duplicate is still there after a reload'); assert.equal(back.placed, true); assert.equal(back.attach, undefined);
    assert.equal(r.items.length, items.length);
    // the same look, size and set as the original, through the same inventory join
    const [a, b] = applyInventory(r.items, inv).filter((x) => x.id === 'desk' || x.id === dup.id).sort((p, q) => (p.id === 'desk' ? -1 : 1));
    for (const k of ['look', 'set', 'w', 'd', 'h', 'variant', 'label', 'spec']) assert.deepEqual(b[k], a[k], k);
    assert.equal(resolve(b).color, resolve(a).color);
    // the project (browser library / backup document) keeps it too
    const proj = parseProject(JSON.stringify(serialiseProject(raw, items, {}, inv)));
    assert.equal(proj.ok, true, proj.error); assert.ok(proj.layout.items.some((x) => x.id === dup.id && x.from === 'desk'));
  }
  // a duplicate of a piece the layout holds without an inventory entry keeps its own overrides; the attached chair is not duplicated with its desk
  assert.equal(chair.attach, 'desk');
  const items = [...base, stripped], ch = items.filter((x) => x.ref === 'task-chair');
  assert.equal(ch.length, 1, 'duplicating the desk does not duplicate the chair'); assert.equal(ch[0].attach, 'desk');
});

test('every hidden, removed or never-placed piece is listed with a Show / Add back button (also for a layout saved by an older build), and the selection bar has a Hide button', async () => {
  const { offPieces } = await import('../../dashboard/js/plan/choices.js');
  const { offControlHTML } = await import('../../dashboard/js/plan/bed-ui.js');
  const { selbarHTML } = await import('../../dashboard/js/plan/selbar.js');
  assert.equal(inv.options.sim.default, 'hidden'); assert.equal(base.find((x) => x.id === 'sim-rig').hidden, true, 'the rig loads hidden');
  const off = offPieces(base, inv);
  assert.deepEqual(off.map((q) => [q.id, q.name, q.why]), [['sim-rig', 'Sim rig', 'hidden']], 'the default lists the rig, not the beds (the Bed control has them)');
  assert.ok(offControlHTML(off).includes('data-show-piece="sim-rig"') && offControlHTML(off).includes('<b>Show</b> Sim rig'));
  // an older build saved the rig removed (not hidden), or never held it, or hid the office chair: each has the way back
  const saved = (items, removed) => resolveLayout({ model: m, inventory: inv, saved: validateLayout(serialiseLayout('paramount-tower-25e', items, { removed }), { planId: 'paramount-tower-25e', lenient: true }) }).items;
  const noRig = base.filter((x) => x.id !== 'sim-rig');
  assert.equal(offPieces(noRig, inv, { removed: ['sim-rig'] }).find((q) => q.id === 'sim-rig').why, 'removed');
  assert.equal(offPieces(noRig, inv).find((q) => q.id === 'sim-rig').why, 'absent');
  const chairOff = saved(applyChoice(base, inv, 'chair', 'hidden'), []);
  assert.deepEqual(offPieces(chairOff, inv).map((q) => q.id).sort(), ['desk-chair', 'sim-rig']);
  assert.equal(offPieces(applyChoice(base, inv, 'sim', 'shown'), inv).length, 0, 'nothing hidden: no row');
  assert.ok(selbarHTML().includes('data-act="hide"') && /Hide<\/span>/.test(selbarHTML()), 'the selection toolbar has an obvious Hide');
});
