// node --test tests/js : which two apartments the side-by-side view opens with
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickPair } from '../../dashboard/js/unit/pair-core.js';

const L = { 'p-9j': { building: 'Paramount', floor: 9 }, 'p-24e': { building: 'Paramount', floor: 24 }, 'p-41a': { building: 'Paramount', floor: 41 }, 'g-4b': { building: 'Greywood', floor: 4 }, 'x-1': { building: 'Solo', floor: 1 } };
const byId = (id) => L[id];
const have = ['g-4b', 'p-41a', 'p-24e', 'x-1', 'p-9j'];

test('two ids in the address open those two, in that order', () => {
  assert.deepEqual(pickPair(['p-24e', 'p-9j'], have, { byId }), ['p-24e', 'p-9j']);
});
test('ids without a site model are skipped, duplicates collapse', () => {
  assert.deepEqual(pickPair(['nope', 'p-9j', 'p-9j', 'g-4b'], have, { byId }), ['p-9j', 'g-4b']);
});
test('one id is paired with the nearest floor of the same building', () => {
  assert.deepEqual(pickPair(['p-24e'], have, { byId }), ['p-24e', 'p-9j']);
  assert.deepEqual(pickPair(['p-41a'], have, { byId }), ['p-41a', 'p-24e']);
});
test('no ids: the Compare list first, else the two lowest floors of the building with the most site models', () => {
  assert.deepEqual(pickPair([], have, { compare: ['g-4b', 'p-41a', 'zzz'], byId }), ['g-4b', 'p-41a']);
  assert.deepEqual(pickPair([], have, { byId }), ['p-9j', 'p-24e']);
});
test('a lone listing falls back to any other; fewer than two site models is no pair', () => {
  assert.equal(pickPair(['x-1'], have, { byId }).length, 2);
  assert.equal(pickPair([], ['p-9j'], { byId }), null);
  assert.equal(pickPair([], [], { byId }), null);
});
