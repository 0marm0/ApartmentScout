// node --test tests/js : boot data requested before the code loaded (js/perf/early.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { takeEarly } from '../../dashboard/js/perf/early.js';

test('without the optimised build there is nothing to take', () => {
  delete globalThis.window;
  assert.equal(takeEarly('data/listings.json'), null);
  globalThis.window = {};
  assert.equal(takeEarly('data/listings.json'), null);
});

test('a pending fetch is handed out once, by exact path', async () => {
  const pending = Promise.resolve([{ id: 'a-1' }]);
  globalThis.window = { __AS_EARLY: { 'data/listings.json': pending } };
  assert.equal(takeEarly('data/criteria.json'), null);
  assert.equal(takeEarly('data/listings.json'), pending);
  assert.deepEqual(await pending, [{ id: 'a-1' }]);
  assert.equal(takeEarly('data/listings.json'), null, 'a second ask fetches normally');
  delete globalThis.window;
});
