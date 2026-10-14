// node --test tests/js : the pure logic behind the results list and filter rail (dashboard/js/features/*-model.js):
// active-filter chips, rank deltas, price history and the windowed list's geometry.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activeChips, removalPatch, defaultFilters, sectionSummaries, budgetCap, statusLabel } from '../../dashboard/js/features/filter-model.js';
import { snapshotRanks, rankDeltas, deltaText, deltaSpeech, createTracker } from '../../dashboard/js/features/rank-model.js';
import { priceSeries, priceStory, dropChip, sparkPath, parseDate } from '../../dashboard/js/features/price-model.js';
import { Layout, includeIndex, flipPlan, nearestScroll, stepIndex } from '../../dashboard/js/features/virtual-model.js';

// ------------------------------------------------------------------ filter chips
const TIERS = [{ name: 'Target', max: 5000 }, { name: 'Stretch', max: 5200 }, { name: 'Slightly over', max: 5450 }];
const STATUSES = [['new', 'New'], ['researching', 'Researching'], ['shortlist', 'Shortlist'], ['touring', 'Touring'], ['applied', 'Applied'], ['rejected', 'Rejected'], ['gone', 'Gone']];
const ACTIVE = ['new', 'researching', 'shortlist', 'touring', 'applied'];
const FEATURES = [['in_unit_wd', 'In-unit washer/dryer'], ['elevator', 'Elevator'], ['gym', 'Gym']];
const money = (v) => '$' + Math.round(v).toLocaleString('en-US');
const base = () => ({ q: '', tiers: [0, 1, 2], over: false, maxCommute: 75, toggles: [], status: [...ACTIVE], savedOnly: false });
const ctx = (f, extra = {}) => ({ filters: { ...base(), ...f }, tiers: TIERS, statuses: STATUSES, defaultStatus: ACTIVE, features: FEATURES, money, commute: { label: 'Subway', dest: 'Grand Central', multiDest: false }, ...extra });

test('the starting state has no chips', () => {
  assert.deepEqual(activeChips(ctx({})), []);
});

test('each kind of filter makes one chip, in the order of the rail', () => {
  const chips = activeChips(ctx({ tiers: [0], maxCommute: 30, toggles: ['gym', 'in_unit_wd'], status: ['shortlist', 'touring'], q: 'park', savedOnly: true }));
  assert.deepEqual(chips.map((c) => c.id), ['budget', 'commute', 'toggle:in_unit_wd', 'toggle:gym', 'status', 'q', 'saved']);
  assert.equal(chips[0].label, 'Target ≤ $5,000');
  assert.equal(chips[1].label, '≤ 30 min · Subway');
  assert.equal(chips[4].label, 'Shortlist, Touring');
  assert.equal(chips[5].label, '“park”');
});

test('budget chips: a cap from several tiers, any price, and the over tile', () => {
  assert.equal(activeChips(ctx({ tiers: [0, 1] }))[0].label, '≤ $5,200');
  assert.equal(activeChips(ctx({ tiers: [] }))[0].label, 'Any price');
  assert.equal(activeChips(ctx({ over: true }))[0].label, 'Any price');
  assert.equal(budgetCap({ over: true, tiers: [0] }, TIERS), null);
  assert.equal(budgetCap({ over: false, tiers: [0, 2] }, TIERS), 5450);
  assert.deepEqual(activeChips(ctx({}, { tiers: [] })), [], 'no tiers in the criteria means no budget filter');
});

test('commute chip names the destination only when there are several', () => {
  const one = activeChips(ctx({ maxCommute: 20 }))[0];
  assert.equal(one.label, '≤ 20 min · Subway');
  assert.match(one.title, /without a computed commute stay/);
  const many = activeChips(ctx({ maxCommute: 20 }, { commute: { label: 'Walk', dest: 'Midtown', multiDest: true } }))[0];
  assert.match(many.title, /by walk to Midtown/);
});

test('status chip labels', () => {
  assert.equal(statusLabel(ACTIVE, STATUSES), '5 statuses');
  assert.equal(statusLabel(STATUSES.map(([k]) => k), STATUSES), 'All statuses');
  assert.equal(statusLabel(['gone'], STATUSES), 'Gone');
  assert.equal(statusLabel([], STATUSES), 'No status');
  assert.equal(activeChips(ctx({ status: [...ACTIVE].reverse() })).length, 0, 'order does not matter');
});

test('long text is shortened in the chip and kept in the tooltip', () => {
  const c = activeChips(ctx({ q: 'a very long search phrase that keeps going' }))[0];
  assert.ok(c.label.length <= 27 && c.label.includes('…'));
  assert.match(c.title, /that keeps going/);
});

test('removing a chip undoes only that filter, and Clear all restores the starting state', () => {
  const c = ctx({ tiers: [0], maxCommute: 30, toggles: ['gym', 'elevator'], status: ['gone'], q: 'x', savedOnly: true, over: false });
  const apply = (id) => ({ ...c.filters, ...removalPatch(id, c) });
  assert.deepEqual(apply('budget').tiers, [0, 1, 2]);
  assert.equal(apply('commute').maxCommute, 75);
  assert.deepEqual(apply('toggle:gym').toggles, ['elevator']);
  assert.deepEqual(apply('status').status, ACTIVE);
  assert.equal(apply('q').q, '');
  assert.equal(apply('saved').savedOnly, false);
  assert.deepEqual(removalPatch('nope', c), {});
  assert.deepEqual(defaultFilters(c), base());
  // every patch together equals the defaults
  let f = c.filters;
  for (const ch of activeChips(c)) f = { ...f, ...removalPatch(ch.id, { ...c, filters: f }) };
  assert.deepEqual(f, base());
  assert.deepEqual(activeChips({ ...c, filters: f }), []);
});

test('section summaries for the collapsed rail', () => {
  const s = sectionSummaries({ ...ctx({}), search: { name: 'Manhattan 1BR' }, weights: { cost: 20, space: 5, commute: 25 }, dims: [['cost', 'Cost'], ['space', 'Space'], ['commute', 'Commute']], preset: null });
  assert.equal(s.budget, 'Within budget ≤ $5,450');
  assert.equal(s.commute, 'Any · Subway');
  assert.equal(s.features, 'None');
  assert.equal(s.status, 'Active');
  assert.equal(s.weights, 'Commute 50% · Cost 40%');
  assert.equal(s.search, 'Manhattan 1BR');
  const t = sectionSummaries({ ...ctx({ tiers: [0], maxCommute: 25, toggles: ['gym'], savedOnly: true, status: ['gone'] }), search: { name: 'S', preview: true }, weights: {}, dims: [], preset: { label: 'Balanced', same: false } });
  assert.equal(t.budget, '≤ $5,000');
  assert.equal(t.commute, '≤ 25 min · Subway');
  assert.equal(t.features, '2 on');
  assert.equal(t.status, 'Gone');
  assert.equal(t.weights, 'Balanced, edited');
  assert.equal(t.search, 'S · preview');
});

// ------------------------------------------------------------------ rank deltas
test('rank deltas: positive is a move up, only listings ranked both times, nothing for no move', () => {
  const before = snapshotRanks([{ id: 'a', _rank: 1 }, { id: 'b', _rank: 2 }, { id: 'c', _rank: 3 }, { id: 'd', _rank: null }, { id: 'e', _rank: 4 }]);
  const after = snapshotRanks([{ id: 'a', _rank: 3 }, { id: 'b', _rank: 1 }, { id: 'c', _rank: 2 }, { id: 'd', _rank: 4 }, { id: 'e', _rank: 4 }]);
  const d = rankDeltas(before, after);
  assert.deepEqual([...d], [['a', -2], ['b', 1], ['c', 1]]);
  assert.equal(deltaText(3), '▲3');
  assert.equal(deltaText(-2), '▼2');
  assert.equal(deltaText(0), '');
  assert.equal(deltaSpeech(1), 'Moved up 1 place');
  assert.equal(deltaSpeech(-4), 'Moved down 4 places');
});

test('tracker measures against the start of the gesture and clears when it has been quiet', () => {
  const t = createTracker({ idleMs: 1000 });
  t.commit(new Map([['a', 1], ['b', 2], ['c', 3]]));
  assert.equal(t.active(), false);
  t.observe(new Map([['a', 2], ['b', 1], ['c', 3]]), 0);
  t.observe(new Map([['a', 3], ['b', 1], ['c', 2]]), 100);     // a second step of the same drag: still measured from the start
  assert.deepEqual([...t.deltas()], [['a', -2], ['b', 1], ['c', 1]]);
  assert.equal(t.delta('a'), -2);
  assert.equal(t.expired(500), false);
  assert.equal(t.expired(1100), true);
  t.settle();
  assert.equal(t.active(), false);
  assert.equal(t.delta('a'), 0);
  // the next gesture starts from the settled ranking
  t.observe(new Map([['a', 3], ['b', 2], ['c', 1]]), 5000);
  assert.deepEqual([...t.deltas()], [['b', -1], ['c', 1]]);
  t.settle();
  t.observe(new Map([['a', 3], ['b', 2], ['c', 1]]), 9000);   // same ranking again: no gesture
  assert.equal(t.active(), false);
  assert.equal(t.expired(99999), false);
});

// ------------------------------------------------------------------ price history
test('no history means no series, and one price or an unchanged price is not a trend', () => {
  assert.equal(priceSeries({ id: 'x', price: { gross: 5000 }, checked: '2026-10-01' }, null), null);
  assert.equal(priceSeries({ id: 'x', price: { gross: 5000 }, checked: '2026-10-01' }, []), null);
  assert.equal(priceSeries({ id: 'x', price: { gross: 5000 }, price_history: [{ date: '2026-09-01', gross: 5000 }] }, null), null);
  assert.equal(priceSeries({ id: 'x', price: { gross: 5000 }, price_history: [{ date: '2026-09-01', gross: 5000 }, { date: '2026-09-10', gross: 5000 }], checked: '2026-10-01' }, null), null);
  assert.equal(priceSeries({ id: 'x' }, [{ date: 'soon', gross: 5 }, { date: '2026-01-01', gross: 'free' }]), null);
});

test('a price drop from history.json: series, drop, chip and story', () => {
  const hist = [{ date: '2026-09-20', gross: 5200, net: null, source: 'snapshot' }, { date: '2026-10-09', gross: 5050, net: null, source: 'snapshot' }];
  const s = priceSeries({ id: 'x', price: { gross: 5050 }, checked: '2026-10-12' }, hist);
  assert.equal(s.measure, 'gross');
  assert.deepEqual(s.pts.map((p) => [p.date, p.v]), [['2026-09-20', 5200], ['2026-10-09', 5050]]);
  assert.equal(s.drop, 150);
  assert.equal(s.total, 150);
  assert.equal(s.lastChange, '2026-10-09');
  assert.equal(parseDate(new Date(s.end).toISOString()), s.end, 'the line runs to the last check');
  assert.equal(dropChip(s), '↓ $150');
  assert.match(priceStory(s), /dropped \$150 on Oct 9/);
  assert.match(priceStory(s), /\$5,200 on Sep 20, then \$5,050 on Oct 9/);
});

test('a rise has no drop chip, a later drop after a rise does', () => {
  const up = priceSeries({ id: 'x' }, [{ date: '2026-09-01', gross: 4800 }, { date: '2026-09-15', gross: 4950 }]);
  assert.equal(up.drop, 0); assert.equal(up.rose, 150); assert.equal(dropChip(up), null);
  assert.match(priceStory(up), /rose \$150/);
  const mixed = priceSeries({ id: 'x' }, [{ date: '2026-09-01', gross: 4800 }, { date: '2026-09-15', gross: 5000 }, { date: '2026-10-01', gross: 4900 }]);
  assert.equal(mixed.drop, 100); assert.equal(mixed.total, -100);
});

test('a portal price history on the listing, with today\'s price as the last point only when it differs and is newer', () => {
  const L = { id: 'x', price: { gross: 4700 }, checked: '2026-10-10', price_history: [{ date: '2026-08-01', gross: 5000 }, { date: '2026-09-01', gross: 4900 }] };
  const s = priceSeries(L, null);
  assert.deepEqual(s.pts.map((p) => p.v), [5000, 4900, 4700]);
  assert.equal(s.drop, 200);
  // same price as the last recorded one: nothing added, still a series from the two recorded prices
  const t = priceSeries({ ...L, price: { gross: 4900 } }, null);
  assert.deepEqual(t.pts.map((p) => p.v), [5000, 4900]);
  // unchecked listings never get an invented "today" point
  const u = priceSeries({ ...L, checked: null }, null);
  assert.deepEqual(u.pts.map((p) => p.v), [5000, 4900]);
});

test('history.json wins over the listing on the same date; equal runs collapse to the day the price changed', () => {
  const L = { id: 'x', price_history: [{ date: '2026-09-01', gross: 5000 }, { date: '2026-09-10', gross: 5000 }, { date: '2026-09-20', gross: 4800 }] };
  const s = priceSeries(L, [{ date: '2026-09-20', gross: 4750 }]);
  assert.deepEqual(s.pts.map((p) => [p.date, p.v]), [['2026-09-01', 5000], ['2026-09-20', 4750]]);
});

test('gross and net are never mixed: net is plotted only when no two gross prices exist', () => {
  const s = priceSeries({ id: 'x' }, [{ date: '2026-09-01', gross: 5000, net: 4600 }, { date: '2026-09-10', gross: 5000, net: 4500 }]);
  assert.equal(s.measure, 'net');
  assert.equal(s.drop, 100);
  const g = priceSeries({ id: 'x' }, [{ date: '2026-09-01', gross: 5000, net: 4600 }, { date: '2026-09-10', gross: 4900, net: 4500 }]);
  assert.equal(g.measure, 'gross');
});

test('sparkline path is a step line inside its box and ends at the last price', () => {
  const s = priceSeries({ id: 'x', checked: '2026-10-20', price: { gross: 4800 } }, [{ date: '2026-09-20', gross: 5200 }, { date: '2026-10-09', gross: 4800 }]);
  const p = sparkPath(s, 44, 16, 2);
  assert.match(p.d, /^M2 2H\d+(\.\d)?V14H42$/);
  assert.equal(p.x, 42); assert.equal(p.y, 14);
  assert.equal(p.min, 4800); assert.equal(p.max, 5200);
  for (const m of p.d.matchAll(/[HV]([\d.]+)/g)) assert.ok(+m[1] >= 0 && +m[1] <= 44);
});

// ------------------------------------------------------------------ windowing geometry
const keys = (n) => Array.from({ length: n }, (_, i) => 'k' + i);

test('layout: uniform slots, totals and the visible range', () => {
  const L = new Layout({ gap: 2, estimate: 131 });
  L.setKeys(keys(300));
  assert.equal(L.total, 300 * 133);
  assert.equal(L.offset(10), 1330);
  assert.equal(L.indexAt(0), 0);
  assert.equal(L.indexAt(1329), 9);
  assert.equal(L.indexAt(1330), 10);
  assert.equal(L.indexAt(1e9), 299);
  const [a, b] = L.range(2660, 870, 700);   // card 20 at the top, 870 px tall viewport
  assert.ok(a <= 15 && a >= 13, `start ${a}`);
  assert.ok(b >= 31 && b <= 34, `end ${b}`);
  assert.deepEqual(L.range(0, 870, 700).slice(0, 1), [0]);
  assert.equal(L.range(1e9, 870, 700)[1], 300);
  assert.deepEqual(new Layout().range(0, 800, 100), [0, 0]);
});

test('layout: measured heights are remembered by key through a re-sort, unmeasured items use the median', () => {
  const L = new Layout({ gap: 2, estimate: 100 });
  L.setKeys(['a', 'b', 'c', 'd']);
  assert.equal(L.measure('a', 131), true);
  assert.equal(L.measure('a', 131.2), false);
  L.measure('b', 131); L.measure('c', 200);
  L.relayout();
  assert.equal(L.estimate(), 131);
  assert.equal(L.slot(3), 133, 'd is unmeasured: the median');
  assert.equal(L.slot(2), 202);
  L.setKeys(['c', 'a', 'b', 'd']);   // re-sorted
  assert.equal(L.slot(0), 202);
  assert.equal(L.offset(1), 202);
  assert.equal(L.measure('x', 0), false, 'zero (hidden) is never a measurement');
  L.clear();
  assert.equal(L.estimate(), 100);
});

test('includeIndex keeps a focused item rendered while it is near the window and lets go when it is far', () => {
  assert.deepEqual(includeIndex([20, 30], 25, 100), [20, 30]);
  assert.deepEqual(includeIndex([20, 30], 12, 100), [12, 30]);
  assert.deepEqual(includeIndex([20, 30], 44, 100), [20, 45]);
  assert.deepEqual(includeIndex([20, 30], 2, 100, 10), [20, 30]);
  assert.deepEqual(includeIndex([20, 30], 95, 100), [20, 30]);
  assert.deepEqual(includeIndex([20, 30], null, 100), [20, 30]);
});

test('flip plan: visible movers slide, unseen ones are skipped or just appear, new ones enter', () => {
  const before = new Map([['a', 0], ['b', 133], ['c', 266], ['far', 9000], ['gone', 400]]);
  const after = new Map([['b', 0], ['a', 133], ['c', 266], ['far', 9133], ['new', 399], ['jump', 133 * 2 + 3000]]);
  const p = flipPlan(before, after, { top: 0, height: 870 });
  const byKey = Object.fromEntries(p.moves.map((m) => [m.key, m]));
  assert.equal(byKey.b.dy, 133);
  assert.equal(byKey.a.dy, -133);
  assert.equal(byKey.c, undefined, 'did not move');
  assert.equal(byKey.far, undefined, 'off-screen before and after');
  assert.deepEqual(p.entering, ['new']);
  // a card arriving from far away does not fly through the others: it appears with a short rise
  const q = flipPlan(new Map([['m', 6000]]), new Map([['m', 100]]), { top: 0, height: 870 });
  assert.deepEqual(q.moves, [{ key: 'm', dy: 40, appear: true }]);
  const r = flipPlan(new Map([['m', -4000]]), new Map([['m', 100]]), { top: 0, height: 870 });
  assert.deepEqual(r.moves, [{ key: 'm', dy: -40, appear: true }]);
  // a card that was on screen and leaves for far away slides out, clamped to about a viewport
  const l = flipPlan(new Map([['m', 100]]), new Map([['m', 9000]]), { top: 0, height: 870 });
  assert.equal(l.moves.length, 1);
  assert.equal(l.moves[0].appear, false);
  assert.equal(l.moves[0].dy, -990);
});

test('nearest scroll and keyboard stepping', () => {
  assert.equal(nearestScroll(500, 800, 600, 133), 500, 'already visible');
  assert.equal(nearestScroll(500, 800, 300, 133), 296, 'above: align to the top');
  assert.equal(nearestScroll(500, 800, 1200, 133), 537, 'below: align to the bottom');
  assert.equal(nearestScroll(0, 800, 0, 133), 0);
  assert.equal(stepIndex(3, 'ArrowDown', 10), 4);
  assert.equal(stepIndex(0, 'ArrowUp', 10), 0);
  assert.equal(stepIndex(9, 'ArrowDown', 10), 9);
  assert.equal(stepIndex(3, 'End', 10), 9);
  assert.equal(stepIndex(3, 'Home', 10), 0);
  assert.equal(stepIndex(3, 'PageDown', 100, 6), 9);
  assert.equal(stepIndex(3, 'PageUp', 100, 6), 0);
  assert.equal(stepIndex(-1, 'ArrowDown', 10), 1, 'nothing focused yet: counts from the first item');
  assert.equal(stepIndex(3, 'q', 10), -1);
  assert.equal(stepIndex(0, 'ArrowDown', 0), -1);
});
