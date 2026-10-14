// node --test tests/js : "since your last visit" — the diff only reports recorded history, never inferred changes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { diffSinceVisit, pillParts, pillText, hasNews, baselineFor, dayOf, localDay, isLive } from '../../dashboard/js/features/visit-model.js';

const L = (id, extra = {}) => ({ id, status: 'new', price: { gross: 5000 }, ...extra });
const LISTINGS = [L('a'), L('b'), L('c'), L('d', { status: 'gone' }), L('e'), L('f', { listed_at: '2026-10-12' }), L('g', { checked: '2026-10-13' })];
const HIST = {
  events: [
    { id: 'a', date: '2026-10-11', type: 'new', to: 4800 },
    { id: 'b', date: '2026-10-12', type: 'price', field: 'gross', from: 5200, to: 4950 },
    { id: 'c', date: '2026-10-12', type: 'gone', field: 'status', from: 'new', to: 'gone' },
    { id: 'e', date: '2026-10-09', type: 'price', field: 'gross', from: 5000, to: 5100 },
    { id: 'old', date: '2026-10-10', type: 'gone' },
  ],
  price_history: {},
};

test('dayOf accepts dates and datetimes and rejects nonsense', () => {
  assert.equal(dayOf('2026-10-09'), '2026-10-09');
  assert.equal(dayOf('2026-09-29T10:04:00Z'), '2026-09-29');
  assert.equal(dayOf('2026-02-31'), null);
  assert.equal(dayOf(null), null);
  assert.equal(dayOf('yesterday'), null);
  assert.equal(localDay(new Date(2026, 9, 14, 23, 59)), '2026-10-14');
});

test('only events dated after the last visit count, and an empty history is an empty diff', () => {
  const d = diffSinceVisit({ history: HIST, listings: LISTINGS, since: '2026-10-10', today: '2026-10-14' });
  assert.deepEqual(d.new.map((x) => x.id).sort(), ['a', 'f']);   // f: listed_at 12 Oct
  assert.deepEqual(d.drops.map((x) => [x.id, x.from, x.to, x.delta]), [['b', 5200, 4950, -250]]);
  assert.deepEqual(d.gone.map((x) => x.id), ['c']);
  assert.equal(d.rises.length, 0, 'the rise on e happened before the visit');
  assert.deepEqual(d.rechecked.map((x) => x.id), ['g']);
  assert.equal(d.count, 4);
  const none = diffSinceVisit({ history: { events: [], price_history: {} }, listings: [L('x'), L('y')], since: '2026-10-10', today: '2026-10-14' });
  assert.equal(none.count, 0);
  assert.equal(hasNews(none), false);
  assert.equal(pillText(none), '');
  assert.equal(diffSinceVisit({ history: null, listings: [], since: '2026-10-10', today: '2026-10-14' }).count, 0);
});

test('no baseline, a baseline of today or a future baseline never produce changes', () => {
  for (const since of [null, undefined, '', 'garbage', '2026-10-14', '2026-11-01']) assert.equal(diffSinceVisit({ history: HIST, listings: LISTINGS, since, today: '2026-10-14' }).count, 0, String(since));
});

test('events dated in the future (clock skew) are ignored', () => {
  const d = diffSinceVisit({ history: { events: [{ id: 'a', date: '2026-12-01', type: 'new' }] }, listings: [L('a')], since: '2026-10-01', today: '2026-10-14' });
  assert.equal(d.new.length, 0);
});

test('homes that are no longer live are not announced as new or as price moves', () => {
  const h = { events: [{ id: 'd', date: '2026-10-12', type: 'new' }, { id: 'd', date: '2026-10-12', type: 'price', field: 'gross', from: 5, to: 4 }, { id: 'a', date: '2026-10-11', type: 'new' }, { id: 'a', date: '2026-10-12', type: 'gone' }] };
  const d = diffSinceVisit({ history: h, listings: LISTINGS, since: '2026-10-10', today: '2026-10-14' });
  assert.equal(d.new.some((x) => x.id === 'd'), false);
  assert.equal(d.drops.length, 0);
  assert.equal(d.new.some((x) => x.id === 'a'), false, 'new and already gone is news only as gone');
  assert.deepEqual(d.gone.map((x) => x.id), ['a']);
});

test('price history wins over bare events and compares the right basis', () => {
  const h = {
    events: [],
    price_history: {
      a: [{ date: '2026-10-01', gross: 5000, net: 4600 }, { date: '2026-10-13', gross: 5000, net: 4400 }],   // net dropped, gross flat
      b: [{ date: '2026-10-01', gross: 5000, net: null }, { date: '2026-10-08', gross: 5200, net: null }],   // rose, but before the visit
      c: [{ date: '2026-10-01', gross: 5000, net: null }, { date: '2026-10-12', gross: 5300, net: null }, { date: '2026-10-13', gross: 5400, net: null }],
    },
  };
  const d = diffSinceVisit({ history: h, listings: LISTINGS, since: '2026-10-10', today: '2026-10-14' });
  assert.deepEqual(d.drops.map((x) => [x.id, x.basis, x.from, x.to]), [['a', 'net', 4600, 4400]]);
  assert.deepEqual(d.rises.map((x) => [x.id, x.from, x.to]), [['c', 5000, 5400]]);
});

test('a price that goes down and back up is not a drop', () => {
  const h = { events: [{ id: 'a', date: '2026-10-11', type: 'price', field: 'gross', from: 5000, to: 4800 }, { id: 'a', date: '2026-10-12', type: 'price', field: 'gross', from: 4800, to: 5000 }] };
  const d = diffSinceVisit({ history: h, listings: LISTINGS, since: '2026-10-10', today: '2026-10-14' });
  assert.equal(d.drops.length + d.rises.length, 0);
});

test('relisted homes are reported once and gone events keep ids that left the data', () => {
  const h = { events: [{ id: 'a', date: '2026-10-12', type: 'relist' }, { id: 'a', date: '2026-10-13', type: 'relist' }, { id: 'zzz', date: '2026-10-12', type: 'gone', note: 'row removed' }] };
  const d = diffSinceVisit({ history: h, listings: LISTINGS, since: '2026-10-10', today: '2026-10-14' });
  assert.equal(d.relisted.length, 1);
  assert.equal(d.gone[0].id, 'zzz');
  assert.equal(d.gone[0].L, null);
});

test('the pill shows at most three pieces in order, singular and plural, and rechecked only when alone', () => {
  const d = diffSinceVisit({ history: HIST, listings: LISTINGS, since: '2026-10-10', today: '2026-10-14' });
  assert.equal(pillText(d), '2 new · 1 price drop · 1 gone');
  const onlyChecked = diffSinceVisit({ history: null, listings: [L('g', { checked: '2026-10-13' }), L('h', { checked: '2026-10-12' })], since: '2026-10-10', today: '2026-10-14' });
  assert.equal(pillText(onlyChecked), '2 rechecked');
  assert.equal(onlyChecked.count, 0, 'rechecked alone is not counted as a change');
  assert.deepEqual(pillParts({ new: [], drops: [], gone: [], rises: [1, 2], relisted: [1], rechecked: [1] }).map((x) => x.key), ['rises', 'relisted']);
});

test('the baseline prefers the tab session over the stored stamp, and is null on a first visit', () => {
  assert.equal(baselineFor({ day: '2026-10-10' }, { day: '2026-10-05' }), '2026-10-05');
  assert.equal(baselineFor({ day: '2026-10-10' }, null), '2026-10-10');
  assert.equal(baselineFor(null, null), null);
  assert.equal(baselineFor({ day: 'nope' }, null), null);
  assert.equal(isLive({ status: 'gone' }), false);
  assert.equal(isLive({}), true);
});

test('the committed example data has no recorded changes, so the pill stays hidden', () => {
  const read = (p) => JSON.parse(fs.readFileSync(new URL(p, import.meta.url), 'utf8'));
  const hist = read('../../dashboard/data/history.json'), listings = read('../../dashboard/data/listings.json');
  const latest = listings.map((x) => dayOf(String(x.checked || ''))).filter(Boolean).sort().at(-1);
  const d = diffSinceVisit({ history: hist, listings, since: latest, today: '2099-01-01' });
  assert.equal(d.count, 0);
  assert.equal(hasNews(d), false);
});
