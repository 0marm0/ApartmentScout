// node --test tests/js : layout JSON save/load validation
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateLayout, parseLayout, serialiseLayout, asPreset, newId, MAX_ITEMS } from '../../dashboard/js/plan/layout.js';

const good = { schema: 1, plan: 'p1', units: 'in', items: [{ id: 'bed', ref: 'queen-bed', x: 60, y: 120.04, rot: -90 }, { id: 'sofa', ref: 'futon', x: 10, y: 10, variant: 'bed', label: 'Guest bed', hidden: false }] };

test('a good layout round-trips and is cleaned', () => {
  const r = validateLayout(good, { planId: 'p1' });
  assert.equal(r.ok, true);
  assert.equal(r.layout.items[0].rot, 270);
  assert.equal(r.layout.items[0].y, 120);
  assert.equal(r.layout.items[1].variant, 'bed');
  assert.equal('hidden' in r.layout.items[1], false);
  const back = parseLayout(JSON.stringify(serialiseLayout('p1', r.layout.items)), { planId: 'p1' });
  assert.equal(back.ok, true);
  assert.deepEqual(back.layout.items, r.layout.items);
});

test('strict validation rejects bad layouts with a reason', () => {
  const bad = (patch, re) => { const r = validateLayout({ ...good, ...patch }, { planId: 'p1' }); assert.equal(r.ok, false); assert.match(r.error, re); };
  bad({ schema: 2 }, /schema/);
  bad({ units: 'ft' }, /units/);
  bad({ plan: 'other' }, /for plan "other"/);
  bad({ items: 'x' }, /items/);
  bad({ items: [{ ...good.items[0], id: 'a b' }] }, /id must be/);
  bad({ items: [good.items[0], good.items[0]] }, /duplicate/);
  bad({ items: [{ ...good.items[0], ref: 'throne' }] }, /unknown furniture/);
  bad({ items: [{ ...good.items[0], x: 'NaN' }] }, /x and y/);
  bad({ items: [{ ...good.items[0], x: 1e6 }] }, /within 5000/);
  bad({ items: [{ ...good.items[0], w: 0 }] }, /w must be/);
  bad({ items: [{ ...good.items[0], label: '<img src=x>' }] }, /label/);
  bad({ items: [{ ...good.items[1], variant: 'castle' }] }, /variant/);
  bad({ items: Array.from({ length: MAX_ITEMS + 1 }, (_, i) => ({ id: `n${i}`, ref: 'nightstand', x: 0, y: 0 })) }, /Too many/);
  assert.match(parseLayout('{nope').error, /JSON/);
  assert.match(parseLayout('x'.repeat(1_000_001)).error, /1 MB/);
  assert.equal(validateLayout([], {}).ok, false);
});

test('presets are written in the plan units', () => {
  const p = asPreset([{ id: 'bed', ref: 'queen-bed', x: 60, y: 120, rot: 90 }, { id: 'h', ref: 'nightstand', x: 1, y: 1, hidden: true }], { k: 12, name: 'Mine' });
  assert.equal(p.items.length, 1);
  assert.deepEqual([p.items[0].x, p.items[0].y], [5, 10]);
});

test('new ids never clash', () => {
  assert.equal(newId('queen-bed', [{ id: 'queen-bed-1' }]), 'queen-bed-2');
  assert.equal(newId('tv 55!', []), 'tv55-1');
});
