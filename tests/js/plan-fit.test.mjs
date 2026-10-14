// node --test tests/js : fitting a furniture kit into another plan
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalisePlan } from '../../dashboard/js/plan/model.js';
import { resolve } from '../../dashboard/js/plan/catalog.js';
import { fitKit, roomOrder } from '../../dashboard/js/plan/fit.js';

const plan = (w, h) => normalisePlan({
  units: 'ft', rooms: [{ name: 'Living', kind: 'living', x: 0, y: 0, w, h }, { name: 'Bedroom', kind: 'bedroom', x: w + 0.4, y: 0, w: 11, h: 12 }, { name: 'Bath', kind: 'bath', x: w + 11.8, y: 0, w: 5, h: 8 }],
  doors: [{ x1: w, y1: 1, x2: w, y2: 4 }, { x1: w + 0.4, y1: 1, x2: w + 0.4, y2: 4 }],
});
const kit = [
  { ...resolve({ id: 'bed', ref: 'queen-bed', x: 0, y: 0 }), roomKind: 'bedroom' },
  { ...resolve({ id: 'sofa', ref: 'sofa-3', x: 0, y: 0 }), roomKind: 'living' },
  { ...resolve({ id: 'table', ref: 'dining-6', x: 0, y: 0 }), roomKind: 'living' },
];

test('rooms of the same kind come first and baths are never used', () => {
  const order = roomOrder(plan(14, 16), 'bedroom').map((r) => r.name);
  assert.deepEqual(order, ['Bedroom', 'Living']);
});

test('a roomy plan fits the kit; a cramped one does not fit everything cleanly', () => {
  const big = fitKit(plan(16, 18), kit);
  assert.equal(big.rows.bed.room, 'Bedroom');
  assert.equal(big.rows.sofa.room, 'Living');
  assert.equal(big.counts.clear, 3, JSON.stringify(big.rows));
  const small = fitKit(plan(8, 9), kit);
  assert.ok(small.counts.clear < 3, JSON.stringify(small.rows));
});
