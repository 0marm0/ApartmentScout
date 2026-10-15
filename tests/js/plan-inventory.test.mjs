// node --test tests/js : "Your furniture" (examples/nyc-2026/furniture.json) and its fit in the example plans
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalisePlan } from '../../dashboard/js/plan/model.js';
import { resolve } from '../../dashboard/js/plan/catalog.js';
import { evaluate } from '../../dashboard/js/plan/checks.js';
import { accessRoutes } from '../../dashboard/js/plan/route.js';
import { validateInventory, parseInventory, fitInventory, kitFromInventory, pieceItem, placedIds, MAX_PIECES } from '../../dashboard/js/plan/inventory.js';
import { inventoryHTML } from '../../dashboard/js/plan/inventory-ui.js';
import { parseProject, serialiseProject } from '../../dashboard/js/plan/project.js';

const read = (p) => JSON.parse(fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8'));
const FILE = read('examples/nyc-2026/furniture.json');
const plan = (id) => read(`examples/nyc-2026/plans/${id}.json`);
const inv = () => { const r = validateInventory(FILE); assert.ok(r.ok, r.error); return r.inventory; };

test('the example furniture file is valid, sourced, and carries no personal paths', () => {
  const v = inv();
  assert.equal(v.pieces.length, 11, 'the renter\'s ten pieces and the candidate storage bed');
  assert.ok(v.source.length > 40);
  assert.ok(!/\/Users\/|~\/|C:\\/.test(JSON.stringify(FILE)), 'no absolute paths in the file');
  for (const p of v.pieces) assert.ok(p.source, `${p.id} names where it came from`);
});

test('the renter\'s pieces keep their own sizes when resolved', () => {
  const by = Object.fromEntries(inv().pieces.map((p) => [p.id, resolve(pieceItem(p))]));
  assert.deepEqual([by.bed.w, by.bed.d, by.bed.h], [64, 84, 40]);
  assert.deepEqual([by.dresser.w, by.dresser.d, by.dresser.h], [63, 18.9, 30.7]);   // the IKEA MALM 6-drawer chest
  assert.deepEqual([by.desk.w, by.desk.d], [71, 30]);   // 180 cm long; the depth is assumed
  assert.deepEqual([by.futon.w, by.futon.d], [80, 36]);
  assert.deepEqual([by.tv.w, by.tv.h, by.tv.elev], [48.4, 27.8, 32]);
  assert.equal(by['tv-bed'].name, '55-inch TV, bedroom');
});

test('validation refuses unknown furniture, duplicates, markup and absurd sizes', () => {
  const bad = (mut) => { const o = structuredClone(FILE); mut(o); return validateInventory(o); };
  assert.match(bad((o) => { o.pieces[0].ref = 'hovercraft'; }).error, /unknown furniture/);
  assert.match(bad((o) => { o.pieces[1].id = o.pieces[0].id; }).error, /duplicate id/);
  assert.match(bad((o) => { o.pieces[0].label = '<img src=x>'; }).error, /plain text/);
  assert.match(bad((o) => { o.pieces[0].w = 9000; }).error, /between 1 and 300/);
  assert.match(bad((o) => { o.pieces[0].room = 'garage'; }).error, /room must be/);
  assert.match(bad((o) => { o.pieces[0].variant = 'nope'; }).error, /unknown variant/);
  assert.match(bad((o) => { o.pieces = Array.from({ length: MAX_PIECES + 1 }, (_, i) => ({ id: `p${i}`, ref: 'nightstand' })); }).error, /Too many/);
  assert.match(bad((o) => { o.kind = 'something'; }).error, /apartmentscout-furniture/);
  assert.equal(parseInventory('{nope').error, 'Not valid JSON');
  assert.ok(parseInventory(JSON.stringify(FILE)).ok);
});

// the plans the studio opens with this furniture: the default layout of the unit is the renter's own
for (const id of ['paramount-tower-25e', 'emerald-green-1211']) {
  test(`${id}: "Your furniture" is the first, default layout and every piece in it fits`, () => {
    const raw = plan(id), m = normalisePlan(raw), v = inv();
    assert.equal(m.layouts[0].id, 'your-furniture');
    assert.equal(m.layouts[0].name, 'Your furniture');
    const items = m.layouts[0].items;
    const want = v.pieces.filter((p) => id === 'paramount-tower-25e' || !p.candidate);   // only Paramount 25E has the storage bed to try
    assert.deepEqual(items.map((i) => i.id).sort(), want.map((p) => p.id).sort(), 'all of the renter\'s pieces, nothing invented');
    for (const it of items) {   // same ref and the same real size as the inventory
      const p = v.pieces.find((q) => q.id === it.id);
      assert.equal(it.ref, p.ref); assert.equal(it.w, p.w); assert.equal(it.d, p.d); assert.equal(it.h, p.h);
      assert.equal(it.elev, p.elev);   // a wall TV keeps its own height off the floor through the plan normaliser
    }
    const R = items.map((i) => resolve(i)), ev = evaluate(m, R);
    assert.equal(ev.counts.blocked, 0, JSON.stringify(Object.values(ev.items).filter((r) => r.state === 'blocked').map((r) => [r.id, r.issues.map((x) => x.text)])));
    // 25E's rooms are too narrow to sit a 55-inch TV closer than 9 to 10 ft, so its two TVs read "workable", the best the room allows; every other piece is clear
    const tvTag = id === 'paramount-tower-25e' ? 'workable' : 'ideal', tight = id === 'paramount-tower-25e' ? 2 : 0;
    assert.equal(ev.counts.clear, 10 - tight, JSON.stringify(ev.counts));
    assert.equal(ev.counts.tight, tight);
    if (tight) assert.deepEqual(Object.values(ev.items).filter((r) => r.state === 'tight').map((r) => r.id).sort(), ['tv', 'tv-bed']);
    // the living-room TV is watchable from the futon, every bed seat can see the bedroom TV
    const tvs = Object.fromEntries(ev.tv.map((t) => [t.id, t]));
    assert.ok(tvs.tv.seats.length === 1 && tvs.tv.seats[0].tag === tvTag, JSON.stringify(tvs.tv.seats.map((s) => [s.seat, s.tag])));
    assert.equal(tvs['tv-bed'].seats.find((s) => s.seat.includes('pillows')).tag, tvTag);
    // every piece can be reached from the front door and carried in
    const routes = accessRoutes(m, R).routes;
    assert.ok(routes.every((r) => r.reachable !== false && r.grade !== 'blocked'), JSON.stringify(routes.map((r) => [r.label, r.grade])));
  });
}

test('fitInventory places the pieces in a plan that has no layout and says what it could not', () => {
  const m = normalisePlan(plan('paramount-tower-9j')), r = fitInventory(m, inv(), { step: 10 });
  assert.equal(r.id, 'your-furniture');
  assert.ok(r.items.length + r.missing.length === 10);
  for (const it of r.items) assert.ok(it.w && it.d, 'sizes travel with the item');
  assert.match(r.note, /^Your 10 pieces/);
  const kit = kitFromInventory(inv());
  assert.equal(kit.find((k) => k.id === 'bed').roomKind, 'bedroom');
  assert.equal(kit.find((k) => k.id === 'futon').roomKind, 'living');
});

test('placedIds marks the pieces a layout holds; the studio section lists them', () => {
  const v = inv(), held = placedIds(v, [{ id: 'bed' }, { id: 'tv' }, { id: 'nothing' }]);
  assert.deepEqual([...held].sort(), ['bed', 'tv']);
  const html = inventoryHTML(v, { held, hasPreset: true, active: false });
  assert.match(html, /Use your furniture layout/);
  assert.match(html, /2 of 10 placed/);
  assert.equal((html.match(/data-inv-add=/g) || []).length, 8);
  assert.match(inventoryHTML(v, { held, hasPreset: false }), /Fit your furniture here/);
  assert.equal(inventoryHTML({ pieces: [] }), '');
});

test('a complete plan project carries the renter\'s furniture, and refuses a bad inventory', () => {
  const raw = plan('paramount-tower-25e'), m = normalisePlan(raw), v = inv();
  const project = serialiseProject(raw, m.layouts[0].items, {}, v);
  assert.equal(project.inventory.pieces.length, 11);
  assert.ok(project.inventory.options.bed.choices.length === 3 && project.inventory.pieces.find((p) => p.id === 'bed-latitude').spec.overall.w === 94, 'the options and the maker\'s dimensions travel with the project');
  const back = parseProject(JSON.stringify(project));
  assert.ok(back.ok, back.error);
  assert.equal(back.inventory.pieces[0].label, 'Queen bed');
  assert.equal(parseProject(serialiseProject(raw, m.layouts[0].items, {})).inventory, null);   // no inventory, none invented
  const poisoned = structuredClone(project); poisoned.inventory.pieces[0].ref = 'nope';
  assert.equal(parseProject(JSON.stringify(poisoned)).ok, false);
  const extra = structuredClone(project); extra.inventory.pieces[0].url = 'https://example.com';
  assert.match(parseProject(JSON.stringify(extra)).error, /unsupported field url/);
});
