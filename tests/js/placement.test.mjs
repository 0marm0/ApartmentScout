// node --test tests/js : where the renter's furniture stands. A piece they placed stays exactly there, in both 3D views, until they
// move it; automatic placement only fills pieces they have not placed (dashboard/js/plan/placement.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalisePlan } from '../../dashboard/js/plan/model.js';
import { validateInventory } from '../../dashboard/js/plan/inventory.js';
import { validateLayout, serialiseLayout } from '../../dashboard/js/plan/layout.js';
import { resolve } from '../../dashboard/js/plan/catalog.js';
import { evaluate } from '../../dashboard/js/plan/checks.js';
import { parseProject, serialiseProject } from '../../dashboard/js/plan/project.js';
import { resolveLayout, applyInventory, savedLayoutFor, samePlaces, defaultLayout, layoutKey } from '../../dashboard/js/plan/placement.js';

const read = (p) => JSON.parse(fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8'));
const ID = 'paramount-tower-25e';
const raw = () => read(`examples/nyc-2026/plans/${ID}.json`);
const inv = () => validateInventory(read('examples/nyc-2026/furniture.json')).inventory;
const model = () => normalisePlan(raw());
const saved = (layout) => { const v = validateLayout(layout, { planId: ID, lenient: true }); assert.ok(v.ok, v.error); return v; };
const lay = (items, extra = {}) => ({ schema: 1, kind: 'apartmentscout-layout', plan: ID, units: 'in', items, ...extra });
const at = (items, id) => items.find((i) => i.id === id);

test('with nothing saved, the plan\'s own first layout is what loads, and it is the renter\'s: every piece placed', () => {
  const m = model(), r = resolveLayout({ model: m, inventory: inv(), saved: null });
  assert.equal(r.source, 'default');
  assert.equal(r.changed, false, 'a default alone is not written to storage');
  assert.equal(r.items.length, 11, 'the renter\'s ten pieces and the candidate storage bed');
  assert.ok(r.items.every((i) => i.placed), 'the layout file says the renter placed them');
  assert.deepEqual(r.items.filter((i) => i.hidden).map((i) => i.id), ['bed-latitude'], 'the bed they may buy is in the layout but not shown: their own bed is the default');
  assert.equal(m.layouts[0].id, 'your-furniture');
});

test('a piece the renter placed stays exactly where it is, whatever the default says', () => {
  const m = model(), d = at(m.layouts[0].items, 'bed');
  const s = saved(lay([{ id: 'bed', ref: 'queen-bed', x: 111.1, y: 222.2, rot: 180, placed: true }], { ver: 2 }));
  const r = resolveLayout({ model: m, inventory: inv(), saved: s });
  const bed = at(r.items, 'bed');
  assert.deepEqual([bed.x, bed.y, bed.rot], [111.1, 222.2, 180]);
  assert.notEqual(bed.x, d.x);
  assert.equal(r.source, 'saved');
});

test('a piece that is not placed follows the default layout; one that is placed does not', () => {
  const m = model(), d = (id) => at(m.layouts[0].items, id);
  const s = saved(lay([
    { id: 'bed', ref: 'queen-bed', x: 1, y: 2, rot: 0, placed: true },
    { id: 'dresser', ref: 'dresser-malm-6', x: 5, y: 6, rot: 0 },   // saved, never placed by the renter
  ], { ver: 2 }));
  const r = resolveLayout({ model: m, inventory: inv(), saved: s });
  assert.deepEqual([at(r.items, 'bed').x, at(r.items, 'bed').y], [1, 2]);
  assert.deepEqual([at(r.items, 'dresser').x, at(r.items, 'dresser').y], [d('dresser').x, d('dresser').y], 'the unplaced chest goes where the default puts it');
  assert.deepEqual(r.followed, ['dresser']);
  assert.ok(r.changed);
});

test('pieces missing from a saved layout are filled from the default, except the ones the renter took out', () => {
  const m = model();
  const s = saved(lay([{ id: 'bed', ref: 'queen-bed', x: 1, y: 2, rot: 0, placed: true }], { ver: 2, removed: ['nightstand-2', 'coffee'] }));
  const r = resolveLayout({ model: m, inventory: inv(), saved: s });
  const ids = r.items.map((i) => i.id).sort();
  assert.ok(!ids.includes('nightstand-2') && !ids.includes('coffee'), 'taken out stays out');
  assert.equal(ids.length, 9);
  assert.ok(r.filled.includes('desk') && r.filled.includes('futon'));
  assert.deepEqual([at(r.items, 'bed').x, at(r.items, 'bed').y], [1, 2], 'filling never moves a placed piece');
});

test('a layout the renter emptied stays empty', () => {
  const r = resolveLayout({ model: model(), inventory: inv(), saved: saved(lay([], { ver: 2, removed: ['bed'] })) });
  assert.equal(r.items.length, 0);
});

test('a piece of "Your furniture" that no layout holds is fitted into the free space around the placed ones, which do not move', () => {
  const m = model(), i = inv();
  const d = m.layouts[0].items.filter((x) => x.id !== 'coffee'), mm = { ...m, layouts: [{ ...m.layouts[0], items: d }] };
  const sv = saved(lay(m.layouts[0].items.filter((x) => x.id !== 'coffee').map((x) => ({ ...x, placed: true })), { ver: 2 })), items = sv.layout.items;
  const r = resolveLayout({ model: mm, inventory: i, saved: sv });
  const c = at(r.items, 'coffee'); assert.ok(c, 'the coffee table got a place');
  assert.deepEqual(r.filled, ['coffee']);
  for (const x of items) { const y = at(r.items, x.id); assert.deepEqual([y.x, y.y, y.rot], [x.x, x.y, x.rot], `${x.id} did not move`); }
  const ev = evaluate(m, applyInventory(r.items, i).map((q) => resolve(q)));
  assert.notEqual(ev.items.coffee.state, 'blocked');
});

test('a layout saved before pieces were marked: the untouched copy of the old default moves to the new one, a piece the renter moved stays', () => {
  const m = model();
  const legacy = lay([
    { id: 'bed', ref: 'queen-bed', x: 230, y: 238.5, rot: 270, w: 64, d: 84, h: 40, label: 'Queen bed' },    // exactly the old default: never touched
    { id: 'desk', ref: 'desk', x: 140, y: 100, rot: 0, w: 60, d: 24, h: 30 },                              // moved by the renter, with the old size baked in
    { id: 'futon', ref: 'futon', x: 118, y: 238.5, rot: 90, w: 80, d: 36, h: 34 },                         // the old default again
  ]);
  const r = resolveLayout({ model: m, inventory: inv(), saved: saved(legacy) });
  assert.equal(r.legacy, true); assert.ok(r.changed, 'it is saved again in the new form');
  const d = (id) => at(m.layouts[0].items, id);
  assert.deepEqual([at(r.items, 'bed').x, at(r.items, 'bed').y, at(r.items, 'bed').rot], [d('bed').x, d('bed').y, d('bed').rot], 'the untouched bed follows the new default');
  assert.deepEqual([at(r.items, 'futon').x, at(r.items, 'futon').y], [d('futon').x, d('futon').y]);
  assert.deepEqual([at(r.items, 'desk').x, at(r.items, 'desk').y, at(r.items, 'desk').rot], [140, 100, 0], 'the desk the renter moved stays where they put it');
  assert.ok(at(r.items, 'desk').placed, 'and it is marked as the renter\'s from now on');
  // and the stale 60 x 24 baked in by the old build is gone: the renter's desk is 71 in long
  const desk = applyInventory(r.items, inv()).find((x) => x.id === 'desk');
  assert.deepEqual([desk.w, desk.d], [71, 30]);
});

test('one unreadable piece in a saved layout does not send the others back to the default', () => {
  const m = model();
  const bad = lay([{ id: 'bed', ref: 'queen-bed', x: 7, y: 8, rot: 90, placed: true }, { id: 'ghost', ref: 'hovercraft', x: 1, y: 1 }], { ver: 2 });
  assert.equal(validateLayout(bad, { planId: ID }).ok, false, 'strict validation still refuses it');
  const s = saved(bad);
  assert.deepEqual(s.dropped.map((x) => x.id), ['ghost']);
  const r = resolveLayout({ model: m, inventory: inv(), saved: s });
  assert.deepEqual([at(r.items, 'bed').x, at(r.items, 'bed').y], [7, 8]);
});

test('inventory sizes reach every layout: a size changed in furniture.json shows in a saved layout, a deliberate override wins', () => {
  const i = inv(), items = [{ id: 'desk', ref: 'desk', x: 1, y: 1, rot: 0, placed: true }, { id: 'futon', ref: 'futon', x: 2, y: 2, rot: 0, placed: true, variant: 'bed' }];
  const out = applyInventory(items, i);
  assert.deepEqual([out[0].w, out[0].d, out[0].h], [71, 30, 30]);
  assert.deepEqual(out[0].set, { monitor: 32, chair: 'task' });
  assert.equal(out[0].look.color, 'brown');
  assert.equal(resolve(out[1]).d, 41.7, 'the futon opened as a bed keeps the state\'s depth (the renter\'s sofa bed, 41.7), not the sofa\'s');
  assert.equal(applyInventory([{ id: 'desk', ref: 'desk', x: 0, y: 0, rot: 0, w: 48 }], i)[0].w, 48, 'a size on the item is the renter\'s override');
});

test('serialising keeps the marks: version 2, placed, and the pieces taken out; a project carries them too', () => {
  const items = [{ id: 'bed', ref: 'queen-bed', x: 1, y: 2, rot: 90, placed: true }, { id: 'tv', ref: 'tv-55', x: 3, y: 4, rot: 0 }];
  const out = serialiseLayout(ID, items, { removed: ['coffee', 'bed'] });
  assert.equal(out.ver, 2); assert.deepEqual(out.removed, ['coffee'], 'a piece that is back in the layout is not "removed"');
  assert.equal(out.items[0].placed, true); assert.equal(out.items[1].placed, undefined);
  const back = validateLayout(JSON.parse(JSON.stringify(out)), { planId: ID });
  assert.ok(back.ok, back.error); assert.deepEqual(back.layout.removed, ['coffee']); assert.equal(back.layout.ver, 2);
  const project = serialiseProject(raw(), items, {}, inv(), { removed: ['coffee'] });
  assert.equal(project.layout.ver, 2); assert.deepEqual(project.layout.removed, ['coffee']);
  assert.ok(parseProject(JSON.stringify(project)).ok);
  assert.equal(validateLayout(lay(items, { ver: 9 })).ok, false); assert.equal(validateLayout(lay(items, { removed: ['<b>'] })).ok, false);
});

test('savedLayoutFor reads the studio\'s browser key, and a local project\'s layout first', () => {
  const mem = new Map(), store = { get: (k, d) => (mem.has(k) ? JSON.parse(mem.get(k)) : d), set: (k, v) => mem.set(k, JSON.stringify(v)) };
  assert.equal(savedLayoutFor(store, 'data', ID), null);
  store.set(layoutKey('data', ID), serialiseLayout(ID, [{ id: 'bed', ref: 'queen-bed', x: 5, y: 6, rot: 0, placed: true }]));
  assert.equal(savedLayoutFor(store, 'data', ID).layout.items[0].x, 5);
  store.set('plan-projects.data', { [ID]: { layout: serialiseLayout(ID, [{ id: 'bed', ref: 'queen-bed', x: 9, y: 9, rot: 0 }]) } });
  assert.equal(savedLayoutFor(store, 'data', ID).layout.items[0].x, 9);
  store.set(layoutKey('data', 'other'), { schema: 2 });
  assert.equal(savedLayoutFor(store, 'data', 'other'), null, 'a layout of the wrong shape is ignored');
});

test('both views resolve the same layout from the same inputs, so they place every piece identically', () => {
  const m = model(), i = inv(), s = saved(lay([{ id: 'desk', ref: 'desk', x: 99, y: 88, rot: 0, placed: true }, { id: 'bed', ref: 'queen-bed', x: 230, y: 238.5, rot: 270 }], { ver: 2 }));
  const studio = resolveLayout({ model: m, inventory: i, saved: s }), unit = resolveLayout({ model: normalisePlan(raw()), inventory: validateInventory(read('examples/nyc-2026/furniture.json')).inventory, saved: saved(JSON.parse(JSON.stringify(s.layout))) });
  assert.ok(samePlaces(studio.items, unit.items));
  assert.deepEqual(applyInventory(studio.items, i).map((x) => [x.id, x.w, x.d, x.h]), applyInventory(unit.items, i).map((x) => [x.id, x.w, x.d, x.h]));
});

test('a plan with no layouts and an inventory gets the checks\' fit, the same one every time', () => {
  const m = { ...normalisePlan(read('examples/nyc-2026/plans/paramount-tower-9j.json')), layouts: [] };
  const a = defaultLayout(m, inv()), b = defaultLayout(m, inv());
  assert.ok(a.auto); assert.deepEqual(a.items.map((x) => [x.id, x.x, x.y, x.rot]), b.items.map((x) => [x.id, x.x, x.y, x.rot]));
});
