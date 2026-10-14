// node --test tests/js : the pure undo / redo engine behind the toast and Cmd+Z (dashboard/js/features/undo-core.js)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapshot, describeChange, createHistory, deepEqual, clone, slice, SCOPES } from '../../dashboard/js/features/undo-core.js';

const names = {
  listing: (id) => ({ a: 'Emerald Green 1211', b: 'Orion 23A' })[id] || id,
  dim: (k) => ({ cost: 'Cost', quiet: 'Quiet' })[k] || k,
  feature: (k) => ({ doorman: 'Doorman', in_unit_wd: 'In-unit washer/dryer' })[k] || k,
  mode: (k) => ({ best: 'Best', subway: 'Subway' })[k] || k,
};
const base = () => ({
  picks: {}, compare: [], filters: { q: '', tiers: [0, 1, 2], over: false, maxCommute: 75, toggles: [], status: ['new'], savedOnly: false },
  weights: { cost: 20, quiet: 10 }, preset: 'balanced', commuteMode: 'best', destName: 'Grand Central',
});
const change = (mut) => { const a = snapshot(base()), s = base(); mut(s); return describeChange(a, snapshot(s), names); };

test('snapshot is a deep copy of the undoable slice and nothing else', () => {
  const s = base(); s.picks.a = { saved: true }; s.extra = 'ignored';
  const snap = snapshot(s);
  assert.deepEqual(Object.keys(snap).sort(), ['commute', 'compare', 'filters', 'picks', 'preset', 'weights']);
  s.picks.a.saved = false; s.filters.toggles.push('gym');
  assert.equal(snap.picks.a.saved, true);
  assert.deepEqual(snap.filters.toggles, []);
  assert.deepEqual(snap.commute, { mode: 'best', dest: 'Grand Central' });
});

test('deepEqual compares structure, not identity', () => {
  assert.ok(deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] }));
  assert.ok(!deepEqual({ a: [1] }, { a: [1, 2] }));
  assert.ok(!deepEqual({ a: 1 }, { b: 1 }));
  assert.ok(!deepEqual([], {}));
  assert.ok(deepEqual(null, null) && !deepEqual(null, {}));
});

test('no difference means no change, including the updated stamp setPick adds', () => {
  const a = snapshot({ ...base(), picks: { a: { saved: true, updated: '2026-10-01' } } });
  const b = snapshot({ ...base(), picks: { a: { saved: true, updated: '2026-10-14' } } });
  assert.equal(describeChange(a, b, names), null);
});

test('pick labels: star, unstar, tier, note, tour', () => {
  assert.deepEqual(change((s) => { s.picks.a = { saved: true }; }), { scopes: ['picks'], label: 'Starred Emerald Green 1211', key: 'picks:saved:a' });
  const starred = snapshot({ ...base(), picks: { a: { saved: true } } });
  const un = describeChange(starred, snapshot(base()), names);
  assert.equal(un.label, 'Removed Emerald Green 1211 from your picks');
  const t = describeChange(starred, snapshot({ ...base(), picks: { a: { saved: true, tier: 'S' } } }), names);
  assert.equal(t.label, 'Set Emerald Green 1211 to tier S');
  const t2 = describeChange(snapshot({ ...base(), picks: { a: { saved: true, tier: 'S' } } }), starred, names);
  assert.equal(t2.label, 'Cleared the tier on Emerald Green 1211');
  assert.equal(describeChange(starred, snapshot({ ...base(), picks: { a: { saved: true, note: 'quiet side' } } }), names).label, 'Edited the note on Emerald Green 1211');
  assert.equal(describeChange(starred, snapshot({ ...base(), picks: { a: { saved: true, tour: '2026-10-20T10:30' } } }), names).label, 'Set a tour time for Emerald Green 1211');
  assert.equal(change((s) => { s.picks.a = { saved: true }; s.picks.b = { saved: true }; }).label, 'Updated 2 picks');
});

test('choosing a tier on an unstarred home is one change labelled by the tier', () => {
  const c = change((s) => { s.picks.a = { saved: true, tier: 'A' }; });
  assert.equal(c.label, 'Set Emerald Green 1211 to tier A');
});

test('compare labels', () => {
  assert.equal(change((s) => { s.compare = ['a']; }).label, 'Added Emerald Green 1211 to Compare');
  const had = snapshot({ ...base(), compare: ['a', 'b'] });
  assert.equal(describeChange(had, snapshot({ ...base(), compare: ['b'] }), names).label, 'Removed Emerald Green 1211 from Compare');
  assert.equal(describeChange(had, snapshot({ ...base(), compare: ['b', 'c'] }), names).label, 'Added c to Compare, dropped Emerald Green 1211');
  assert.equal(describeChange(had, snapshot({ ...base(), compare: [] }), names).label, 'Cleared Compare');
  assert.equal(describeChange(had, snapshot({ ...base(), compare: ['b', 'a'] }), names).label, 'Reordered Compare');
});

test('filter labels', () => {
  assert.deepEqual(change((s) => { s.filters.maxCommute = 20; }), { scopes: ['filters'], label: 'Commute up to 20 min', key: 'filters:maxCommute' });
  assert.equal(change((s) => { s.filters.q = 'x'; }).label, 'Text filter “x”');
  assert.equal(change((s) => { s.filters.toggles = ['doorman']; }).label, 'Must-have on: Doorman');
  const on = snapshot({ ...base(), filters: { ...base().filters, toggles: ['doorman'] } });
  assert.equal(describeChange(on, snapshot(base()), names).label, 'Must-have off: Doorman');
  assert.equal(change((s) => { s.filters.savedOnly = true; }).label, 'Showing saved picks only');
  assert.equal(change((s) => { s.filters.tiers = [0]; }).label, 'Changed the budget filter');
  assert.equal(change((s) => { s.filters.maxCommute = 20; s.filters.savedOnly = true; }).label, 'Changed 2 filters');
  assert.equal(change((s) => { s.filters.nl = { maxCost: 5000 }; }).label, 'Applied a plain-language search');
});

test('weight labels name the dimension; a preset swap is one change', () => {
  assert.deepEqual(change((s) => { s.weights.cost = 28; }), { scopes: ['weights'], label: 'Weight: Cost', key: 'weights:cost' });
  assert.equal(change((s) => { s.weights = { cost: 5, quiet: 30 }; s.preset = 'quiet'; }).label, 'Changed the weight preset');
  assert.equal(change((s) => { s.weights = { cost: 5, quiet: 30 }; }).label, 'Changed the ranking weights');
});

test('commute lens label', () => {
  const c = change((s) => { s.commuteMode = 'subway'; });
  assert.equal(c.label, 'Commute: subway to Grand Central');
  assert.deepEqual(c.scopes, ['commute']);
});

test('a change in several slices reports them all', () => {
  const c = change((s) => { s.commuteMode = 'subway'; s.filters.maxCommute = 20; });
  assert.deepEqual(c.scopes, ['filters', 'commute']);
  assert.match(c.label, /^Commute up to 20 min and 1 more change$/);
  assert.equal(c.key, null);
});

test('slice returns fresh copies of just the asked scopes (weights bring their preset)', () => {
  const snap = snapshot({ ...base(), picks: { a: { saved: true } } });
  const out = slice(snap, ['weights', 'picks']);
  assert.deepEqual(Object.keys(out).sort(), ['picks', 'preset', 'weights']);
  out.picks.a.saved = false; out.weights.cost = 1;
  assert.equal(snap.picks.a.saved, true); assert.equal(snap.weights.cost, 20);
  assert.ok(SCOPES.every((s) => ['picks', 'compare', 'filters', 'weights', 'commute'].includes(s)));
});

// ------------------------------------------------------------------ history
const snapWith = (mut) => { const s = base(); mut(s); return snapshot(s); };

test('history: record, undo and redo walk one stack in order', () => {
  const h = createHistory();
  const s0 = snapWith(() => {}), s1 = snapWith((s) => { s.picks.a = { saved: true }; }), s2 = snapWith((s) => { s.picks.a = { saved: true }; s.compare = ['a']; });
  h.record(s0, s1, { label: 'one', scopes: ['picks'] });
  h.record(s1, s2, { label: 'two', scopes: ['compare'] });
  assert.ok(h.canUndo && !h.canRedo && h.size === 2);
  assert.equal(h.undo().label, 'two');
  assert.ok(h.canRedo);
  assert.equal(h.peekUndo().label, 'one');
  assert.equal(h.undo().label, 'one');
  assert.equal(h.undo(), null);
  assert.equal(h.redo().label, 'one');
  assert.equal(h.redo().label, 'two');
  assert.equal(h.redo(), null);
});

test('history: a new change after an undo clears the redo list', () => {
  const h = createHistory();
  const s0 = snapWith(() => {}), s1 = snapWith((s) => { s.compare = ['a']; }), s2 = snapWith((s) => { s.compare = ['b']; });
  h.record(s0, s1, { label: 'a' });
  h.undo();
  assert.ok(h.canRedo);
  h.record(s0, s2, { label: 'b' });
  assert.ok(!h.canRedo);
});

test('history: identical before and after is not recorded', () => {
  const h = createHistory();
  const s0 = snapWith(() => {});
  assert.equal(h.record(s0, clone(s0), { label: 'noop' }), null);
  assert.ok(!h.canUndo);
});

test('history: a slider drag (same key, close in time) is one step; dragging back to the start leaves none', () => {
  let t = 1000;
  const h = createHistory({ now: () => t, mergeMs: 900 });
  const w = (v) => snapWith((s) => { s.weights.cost = v; });
  h.record(w(20), w(21), { label: 'Weight: Cost', key: 'weights:cost' });
  t += 100; h.record(w(21), w(24), { label: 'Weight: Cost', key: 'weights:cost' });
  t += 100; h.record(w(24), w(30), { label: 'Weight: Cost', key: 'weights:cost' });
  assert.equal(h.size, 1);
  const e = h.peekUndo();
  assert.equal(e.before.weights.cost, 20); assert.equal(e.after.weights.cost, 30);
  t += 100; h.record(w(30), w(20), { label: 'Weight: Cost', key: 'weights:cost' });
  assert.equal(h.size, 0);
});

test('history: the same key after a pause, or a different key, starts a new step', () => {
  let t = 0;
  const h = createHistory({ now: () => t, mergeMs: 900 });
  const w = (v) => snapWith((s) => { s.weights.cost = v; });
  h.record(w(20), w(22), { label: 'x', key: 'weights:cost' });
  t += 2000; h.record(w(22), w(25), { label: 'x', key: 'weights:cost' });
  assert.equal(h.size, 2);
  t += 10; h.record(w(25), snapWith((s) => { s.weights.cost = 25; s.weights.quiet = 30; }), { label: 'y', key: 'weights:quiet' });
  assert.equal(h.size, 3);
});

test('history: entries without a key never merge', () => {
  const h = createHistory({ now: () => 0 });
  h.record(snapWith(() => {}), snapWith((s) => { s.compare = ['a']; }), { label: 'a' });
  h.record(snapWith((s) => { s.compare = ['a']; }), snapWith((s) => { s.compare = ['a', 'b']; }), { label: 'b' });
  assert.equal(h.size, 2);
});

test('history: the stack is bounded', () => {
  const h = createHistory({ limit: 3, now: () => 0 });
  for (let i = 0; i < 6; i++) h.record(snapWith((s) => { s.compare = Array(i).fill('x'); }), snapWith((s) => { s.compare = Array(i + 1).fill('x'); }), { label: `s${i}` });
  assert.equal(h.size, 3);
  assert.equal(h.peekUndo().label, 's5');
});
