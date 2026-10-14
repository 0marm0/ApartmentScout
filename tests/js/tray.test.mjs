// node --test tests/js : decision tray list operations (add, replace, move, remove, nudge).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placeAt, removeId, nudge, MAX } from '../../dashboard/js/features/tray-model.js';

test('adding to a list with room appends, or inserts at the named slot', () => {
  assert.deepEqual(placeAt([], 'a'), { list: ['a'], action: 'add', replaced: null });
  assert.deepEqual(placeAt(['a', 'b'], 'c').list, ['a', 'b', 'c']);
  assert.deepEqual(placeAt(['a', 'b'], 'c', 0).list, ['c', 'a', 'b']);
  assert.deepEqual(placeAt(['a', 'b'], 'c', 3).list, ['a', 'b', 'c'], 'a slot past the end is the end');
  assert.deepEqual(placeAt(['a'], 'c', 99).list, ['a', 'c']);
  assert.deepEqual(placeAt(['a'], 'c', -4).list, ['c', 'a']);
});

test('a full list is replaced slot by slot, and refuses a drop with no slot', () => {
  const full = ['a', 'b', 'c', 'd'];
  assert.equal(full.length, MAX);
  assert.deepEqual(placeAt(full, 'x', 1), { list: ['a', 'x', 'c', 'd'], action: 'replace', replaced: 'b' });
  assert.deepEqual(placeAt(full, 'x'), { list: full, action: 'full', replaced: null });
  assert.deepEqual(full, ['a', 'b', 'c', 'd'], 'the input is never changed');
});

test('a home already in the list moves instead of duplicating', () => {
  assert.deepEqual(placeAt(['a', 'b', 'c'], 'c', 0), { list: ['c', 'a', 'b'], action: 'move', replaced: null });
  assert.deepEqual(placeAt(['a', 'b', 'c'], 'a', 2).list, ['b', 'c', 'a']);
  assert.equal(placeAt(['a', 'b', 'c'], 'b', 1).action, 'same');
  assert.deepEqual(placeAt(['a', 'b', 'c', 'd'], 'a', 3).list, ['b', 'c', 'd', 'a']);
  assert.deepEqual(placeAt(['a', 'b'], 'a').list, ['b', 'a'], 'no slot named: to the end');
  assert.deepEqual(placeAt(['a', 'b'], 'a', 3).list, ['b', 'a'], 'a slot beyond the picks clamps to the last pick');
});

test('remove and nudge keep the rest in order and stop at the ends', () => {
  assert.deepEqual(removeId(['a', 'b', 'c'], 'b'), ['a', 'c']);
  assert.deepEqual(removeId(['a'], 'zzz'), ['a']);
  assert.deepEqual(nudge(['a', 'b', 'c'], 1, -1), ['b', 'a', 'c']);
  assert.deepEqual(nudge(['a', 'b', 'c'], 1, 1), ['a', 'c', 'b']);
  assert.deepEqual(nudge(['a', 'b', 'c'], 0, -1), ['a', 'b', 'c']);
  assert.deepEqual(nudge(['a', 'b', 'c'], 2, 1), ['a', 'b', 'c']);
  assert.deepEqual(nudge(['a'], 5, 1), ['a']);
});
