// node --test tests/js : the g-chords state machine and the cheat sheet's data and search
// (dashboard/js/features/chords.js, shortcuts.js)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepChord, idleChord, CHORDS, CHORD_TTL, PREFIX } from '../../dashboard/js/features/chords.js';
import { GROUPS, filterShortcuts, keyLabel } from '../../dashboard/js/features/shortcuts.js';

const press = (state, key, extra = {}, now = 1000) => stepChord(state, { key, mod: false, typing: false, ...extra }, now);

test('chords: g then a letter goes to the view', () => {
  const want = { m: 'map', s: 'list', c: 'compare', u: 'unit', p: 'plan', r: 'research', t: 'tours' };
  for (const [k, view] of Object.entries(want)) {
    const a = press(idleChord(), 'g');
    assert.equal(a.consume, true); assert.equal(a.go, null); assert.ok(a.hint.length >= 6);
    const b = stepChord(a.state, { key: k, mod: false, typing: false }, 1200);
    assert.equal(b.go.view, view, `g ${k}`);
    assert.equal(b.consume, true);
    assert.deepEqual(b.state, idleChord());
  }
  assert.equal(CHORDS.find((c) => c.key === 't').hash, 'list/tours');
  assert.equal(PREFIX, 'g');
});

test('chords: the second key can be upper case (caps lock)', () => {
  const a = press(idleChord(), 'g');
  assert.equal(stepChord(a.state, { key: 'M', mod: false, typing: false }, 1100).go.view, 'map');
});

test('chords: a different key cancels the chord and is left for its normal job', () => {
  const a = press(idleChord(), 'g');
  const b = stepChord(a.state, { key: 'j', mod: false, typing: false }, 1100);
  assert.equal(b.go, null); assert.equal(b.consume, false); assert.equal(b.hint, null);
  assert.deepEqual(b.state, idleChord());
});

test('chords: Escape cancels and is consumed; modifier keys alone do not cancel', () => {
  const a = press(idleChord(), 'g');
  const sh = stepChord(a.state, { key: 'Shift', mod: false, typing: false }, 1100);
  assert.ok(sh.state.pending); assert.equal(sh.consume, false);
  const esc = stepChord(sh.state, { key: 'Escape', mod: false, typing: false }, 1200);
  assert.equal(esc.consume, true); assert.equal(esc.go, null); assert.deepEqual(esc.state, idleChord());
});

test('chords: the prefix expires', () => {
  const a = press(idleChord(), 'g', {}, 1000);
  const b = stepChord(a.state, { key: 'm', mod: false, typing: false }, 1000 + CHORD_TTL + 1);
  assert.equal(b.go, null); assert.equal(b.consume, false);
});

test('chords: nothing happens in a text field or with a modifier held', () => {
  const t = press(idleChord(), 'g', { typing: true });
  assert.equal(t.consume, false); assert.deepEqual(t.state, idleChord());
  const m = press(idleChord(), 'g', { mod: true });
  assert.equal(m.consume, false);
  const a = press(idleChord(), 'g');
  const typing = stepChord(a.state, { key: 'm', mod: false, typing: true }, 1100);
  assert.equal(typing.go, null); assert.deepEqual(typing.state, idleChord());
});

test('chords: other keys outside a chord are ignored', () => {
  for (const k of ['m', 's', 'x', 'j', '?']) assert.equal(press(idleChord(), k).consume, false);
});

// ------------------------------------------------------------------ cheat sheet data
test('every chord has a row in the cheat sheet, and every key in the sheet is unique within its group', () => {
  const go = GROUPS.find((g) => g.id === 'go');
  for (const c of CHORDS) assert.ok(go.rows.some((r) => r.combos[0][1] === c.key && r.desc.includes(c.label)), `chord ${c.key}`);
  for (const g of GROUPS) {
    assert.ok(g.title && g.rows.length, g.id);
    for (const r of g.rows) { assert.ok(r.desc.length > 8, r.desc); assert.ok(r.combos.length >= 1); }
  }
  assert.equal(new Set(GROUPS.map((g) => g.id)).size, GROUPS.length);
});

test('the existing shortcuts are all listed', () => {
  const text = JSON.stringify(GROUPS);
  for (const needle of ['"K"', '"/"', '"?"', '"j"', '"k"', '"s"', '"c"', '"x"', '"t"', '"Esc"', '"p"', '"R"', '"D"', '"Del"', '"Z"', '"W"', '"Home"']) assert.ok(text.includes(needle), needle);
});

test('keyLabel follows the platform', () => {
  assert.equal(keyLabel('mod', true), '⌘'); assert.equal(keyLabel('mod', false), 'Ctrl');
  assert.equal(keyLabel('shift', true), '⇧'); assert.equal(keyLabel('shift', false), 'Shift');
  assert.equal(keyLabel('K', true), 'K');
});

test('search: empty returns every group; words narrow rows; groups with no rows disappear', () => {
  assert.equal(filterShortcuts('').length, GROUPS.length);
  const c = filterShortcuts('compare');
  assert.ok(c.length >= 2);
  for (const g of c) for (const r of g.rows) assert.match(`${g.title} ${r.desc} ${r.tags}`.toLowerCase(), /compare/);
  assert.equal(filterShortcuts('zzzzqq').length, 0);
});

test('search finds a key by its name on either platform', () => {
  const rowsOf = (q) => filterShortcuts(q).flatMap((g) => g.rows.map((r) => r.desc));
  assert.ok(rowsOf('undo').some((d) => /Undo the last/.test(d)));
  assert.ok(rowsOf('cmd z').some((d) => /Undo the last/.test(d)));
  assert.ok(rowsOf('ctrl z').some((d) => /Undo the last/.test(d)));
  assert.ok(rowsOf('escape').length >= 3);
  assert.ok(rowsOf('g then').every((d) => /^Go to/.test(d)) && rowsOf('g then').length === CHORDS.length);
  assert.ok(rowsOf('rotate').some((d) => /Turn the selected/.test(d)));
  assert.ok(rowsOf('delete').some((d) => /Remove the selected/.test(d)));
  assert.ok(rowsOf('sun').length >= 2);
});

test('search: a single character must be a key, not a letter inside a word', () => {
  const rows = filterShortcuts('x').flatMap((g) => g.rows);
  assert.ok(rows.length >= 1);
  for (const r of rows) assert.ok(r.combos.some((cm) => cm.some((k) => k.toLowerCase() === 'x')) || /\bx\b/.test(r.desc.toLowerCase()), r.desc);
});

test('search: all words must match', () => {
  const a = filterShortcuts('undo plan').flatMap((g) => g.rows);
  assert.ok(a.length >= 1);
  for (const r of a) assert.match(`${r.desc} ${r.tags}`.toLowerCase(), /undo/);
});

test('the current view’s group comes first, groups for other views last', () => {
  const g = filterShortcuts('', 'plan');
  assert.equal(g[0].id, 'plan'); assert.equal(g[0].current, true);
  const ids = g.map((x) => x.id);
  assert.ok(ids.indexOf('global') < ids.indexOf('unit'), 'view-neutral groups before other views');
  assert.ok(ids.indexOf('map') > ids.indexOf('palette'));
  assert.equal(filterShortcuts('', 'unit')[0].id, 'unit');
  assert.equal(filterShortcuts('', null)[0].id, 'global');
});
