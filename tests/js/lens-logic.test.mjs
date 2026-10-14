// node --test tests/js : the map lenses' pure logic (dashboard/js/features/lens-logic.js)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { sunHours, hasSunModel, sunColor, sunGradient, sunSummary, SUN_MAX, SUN_STOPS, SUN_UNKNOWN, hoursText, starsOf, stepId, boundsOf, MONTHS } from '../../dashboard/js/features/lens-logic.js';

const withSun = { id: 'a', lat: 40.7, lon: -73.9, site: { sun_hours: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 2.5, 1] } };
const noModel = { id: 'b', lat: 40.71, lon: -73.91 };
const partial = { id: 'c', lat: 40.72, lon: -73.92, site: { file: 'sites/c.json' } };   // a site file but no sun hours yet

test('sun hours: unknown is null, never zero', () => {
  assert.equal(sunHours(withSun, 9), 9); assert.equal(sunHours(withSun, 0), 0);
  assert.equal(sunHours(noModel, 3), null); assert.equal(sunHours(partial, 3), null); assert.equal(sunHours(null, 3), null);
  assert.equal(sunHours({ site: { sun_hours: [null, 'x'] } }, 0), null);
  assert.equal(hasSunModel(withSun), true); assert.equal(hasSunModel(noModel), false); assert.equal(hasSunModel(partial), false);
  assert.equal(hoursText(null), '?'); assert.equal(hoursText(5.24), '5.2 h');
});

test('sun colour: grey for unknown, the scale ends at its stops, monotone in lightness', () => {
  assert.equal(sunColor(null), SUN_UNKNOWN); assert.equal(sunColor(NaN), SUN_UNKNOWN);
  assert.equal(sunColor(0), SUN_STOPS[0][1]); assert.equal(sunColor(SUN_MAX), SUN_STOPS.at(-1)[1]);
  assert.equal(sunColor(50), SUN_STOPS.at(-1)[1]); assert.equal(sunColor(-3), SUN_STOPS[0][1]);   // clamped
  const lum = (h) => { const c = sunColor(h); return 0.2126 * parseInt(c.slice(1, 3), 16) + 0.7152 * parseInt(c.slice(3, 5), 16) + 0.0722 * parseInt(c.slice(5, 7), 16); };
  for (let h = 0.5; h <= SUN_MAX; h += 0.5) assert.ok(lum(h) >= lum(h - 0.5) - 0.5, `lightness rises with sun at ${h} h`);
  assert.notEqual(sunColor(0.2), SUN_UNKNOWN); assert.notEqual(sunColor(9), SUN_UNKNOWN);
  assert.match(sunGradient(), /^linear-gradient\(90deg, #4254d6 0%/);
});

test('sunSummary counts known and unknown homes and the range', () => {
  const s = sunSummary([withSun, noModel, partial], 9);
  assert.deepEqual([s.known, s.unknown, s.total, s.lo, s.hi], [1, 2, 3, 9, 9]);
  assert.deepEqual(sunSummary([noModel], 0), { known: 0, unknown: 1, lo: null, hi: null, total: 1 });
  assert.equal(MONTHS.length, 12);
});

test('stars are the renter\'s saved picks only: the data\'s favorite flag never counts', () => {
  const L = [{ id: 'a', lat: 1, lon: 1 }, { id: 'b', lat: 1, lon: 1, favorite: true }, { id: 'c', lat: null, lon: null }, { id: 'd', lat: 2, lon: 2 }];
  const saved = new Set(['a', 'c']);
  assert.deepEqual(starsOf(L, (id) => saved.has(id)).map((x) => x.id), ['a']);   // c has no coordinates, b is only "favorite" in the data
  assert.deepEqual(starsOf(L, () => false), []);
});

test('stepId walks a ring; with no current id ] goes first and [ goes last', () => {
  const ids = ['a', 'b', 'c'];
  assert.equal(stepId(ids, 'a', 1), 'b'); assert.equal(stepId(ids, 'c', 1), 'a');
  assert.equal(stepId(ids, 'a', -1), 'c'); assert.equal(stepId(ids, 'b', -1), 'a');
  assert.equal(stepId(ids, null, 1), 'a'); assert.equal(stepId(ids, 'zzz', -1), 'c');
  assert.equal(stepId([], 'a', 1), null); assert.equal(stepId(['x'], 'x', 1), 'x');
});

test('boundsOf wraps points and is null for none', () => {
  assert.deepEqual(boundsOf([[-74, 40.7], [-73.9, 40.8], [-73.95, 40.75]]), [[-74, 40.7], [-73.9, 40.8]]);
  assert.equal(boundsOf([]), null);
});

test('real data: six example homes carry a sun model, with 12 months of finite hours', () => {
  const L = JSON.parse(fs.readFileSync(new URL('../../dashboard/data/listings.json', import.meta.url), 'utf8'));
  const known = L.filter(hasSunModel);
  assert.ok(known.length >= 6);
  for (const x of known) for (let m = 0; m < 12; m++) { const h = sunHours(x, m); assert.ok(h >= 0 && h <= 24, `${x.id} month ${m}`); }
});
