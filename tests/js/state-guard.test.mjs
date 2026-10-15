// node --test tests/js : saved browser state is validated before use (dashboard/js/state-guard.js)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanStored } from '../../dashboard/js/state-guard.js';

test('a value of the default\'s type passes; any other type is the default', () => {
  assert.deepEqual(cleanStored('x', [1], []), [1]);
  assert.deepEqual(cleanStored('x', 'oops', []), []);
  assert.deepEqual(cleanStored('x', [], {}), {});
  assert.equal(cleanStored('x', 'a', false), false);
  assert.equal(cleanStored('x', true, false), true);
  assert.equal(cleanStored('x', Number.NaN, 5), 5);
  assert.equal(cleanStored('x', 'abc', 'q'), 'abc');
});

test('picks: bad entries are dropped, bad fields removed, good ones kept', () => {
  const out = cleanStored('picks', { a: { saved: true, note: 'hi', tier: 2 }, b: 'x', c: { saved: 'yes', note: 4, updated: 9 }, d: null, e: [] }, {});
  assert.deepEqual(out, { a: { saved: true, note: 'hi', tier: 2 }, c: { saved: false } });
  assert.deepEqual(cleanStored('picks', [1, 2], {}), {});
  assert.deepEqual(cleanStored('picks', 'x', {}), {});
});

test('compare, recent and weights keep only usable values', () => {
  assert.deepEqual(cleanStored('compare', ['a', 4, 'b', null, 'c', 'd', 'e'], []), ['a', 'b', 'c', 'd']);
  assert.deepEqual(cleanStored('compare', { a: 1 }, []), []);
  assert.deepEqual(cleanStored('weights', { cost: 30, space: 'lots', commute: -1, quiet: Infinity }, null), { cost: 30 });
  assert.equal(cleanStored('weights', 7, null), null);
});

test('filters2 keeps known fields of the right type and nothing else', () => {
  const out = cleanStored('filters2', { q: 4, tiers: [0, 'x', 1.5, 2], over: 'no', maxCommute: '75', toggles: ['gym', 3], status: 'new', savedOnly: true, nl: 'x', evil: 1 }, null);
  assert.deepEqual(out, { tiers: [0, 2], toggles: ['gym'], savedOnly: true });
  assert.equal(cleanStored('filters2', [], null), null);
});

test('keys with a search suffix use the rule of their prefix; null defaults accept only the right kind', () => {
  assert.deepEqual(cleanStored('commute:My search', { mode: 'walk', dest: 5 }, null), { mode: 'walk', dest: null });
  assert.equal(cleanStored('commute:My search', 'walk', null), null);
  assert.equal(cleanStored('criteria:My search', [1], null), null);
  assert.deepEqual(cleanStored('criteria:My search', { a: 1 }, null), { a: 1 });
  assert.deepEqual(cleanStored('findings:s', 'junk', {}), {});
  assert.deepEqual(cleanStored('trail:s', {}, []), []);
  assert.equal(cleanStored('theme', 'purple', null), null);
  assert.equal(cleanStored('theme', 'light', null), 'light');
  assert.deepEqual(cleanStored('rail:collapsed', 'x', []), []);
});
