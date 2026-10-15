// The tree season of the 3D views (dashboard/js/city3d/season.js), the pure part: leaf share and autumn colour by date. The picture (leaves dropped in the
// shader, a bare-branch skeleton) is covered in tests/e2e/test_daycycle.py. Trees stay context: the sun numbers never depend on any of this.
import test from 'node:test';
import assert from 'node:assert/strict';
const S = await import(new URL('../../dashboard/js/city3d/season.js', import.meta.url));

test('leaves are on in summer, bare in winter and turn through October and November', () => {
  const jul = S.seasonAt(7, 15), jan = S.seasonAt(1, 15), dec = S.seasonAt(12, 21);
  assert.equal(jul.leaf, 1); assert.equal(jul.autumn, 0);
  assert.equal(jan.leaf, 0); assert.equal(dec.leaf, 0);
  const oct1 = S.seasonAt(10, 1), oct20 = S.seasonAt(10, 20), nov10 = S.seasonAt(11, 10), nov28 = S.seasonAt(11, 28);
  assert.equal(oct1.autumn, 0, 'still green on October 1');
  assert.ok(oct20.autumn > 0.4 && oct20.leaf > 0.95, 'colour turns before the leaves fall');
  assert.ok(nov10.autumn > 0.95 && nov10.leaf < 0.85 && nov10.leaf > 0.5, 'peak colour with the first leaves down');
  assert.ok(nov28.leaf < 0.35, 'mostly bare by the end of November');
});

test('the leaf share rises from April to late May and never leaves 0..1', () => {
  let prev = -1;
  for (const [m, d] of [[3, 25], [4, 10], [4, 25], [5, 10], [5, 20], [6, 5]]) { const s = S.seasonAt(m, d); assert.ok(s.leaf >= prev, `${m}/${d}`); prev = s.leaf; }
  for (let m = 1; m <= 12; m++) for (const d of [1, 8, 15, 22, 28]) { const s = S.seasonAt(m, d); assert.ok(s.leaf >= 0 && s.leaf <= 1 && s.autumn >= 0 && s.autumn <= 1, `${m}/${d}`); }
});

test('south of the equator the calendar turns over, and a date string reads the same as month and day', () => {
  assert.equal(S.seasonAt(1, 15, -34).leaf, 1, 'January is summer in Sydney');
  assert.equal(S.seasonAt(7, 15, -34).leaf, 0, 'July is winter in Sydney');
  assert.deepEqual(S.seasonOfDate('2026-10-31', 40.7), S.seasonAt(10, 31, 40.7));
  assert.deepEqual(S.seasonOfDate('nonsense'), { leaf: 1, autumn: 0, doy: 180 });
});

test('a play loop re-colours the trees only when the quantised picture changes', () => {
  const a = S.seasonKey(S.seasonAt(7, 1)), b = S.seasonKey(S.seasonAt(7, 20));
  assert.equal(a, b, 'a whole summer is one picture');
  assert.notEqual(S.seasonKey(S.seasonAt(10, 20)), S.seasonKey(S.seasonAt(11, 5)));
  const q = S.quantise({ leaf: 0.51, autumn: 0.49 }, 4);
  assert.deepEqual(q, { leaf: 0.5, autumn: 0.5 });
});

test('the stage names say what the picture shows, and the note says the numbers never count a tree', () => {
  assert.equal(S.seasonLabel(S.seasonAt(7, 4)), 'Leaves on');
  assert.equal(S.seasonLabel(S.seasonAt(10, 25)), 'Autumn colour');
  assert.equal(S.seasonLabel(S.seasonAt(11, 26)), 'Leaves falling');
  assert.equal(S.seasonLabel(S.seasonAt(1, 20)), 'Bare branches');
  assert.equal(S.seasonLabel(S.seasonAt(4, 18)), 'Buds');
  assert.equal(S.seasonLabel(S.seasonAt(5, 8)), 'Leafing out');
  assert.match(S.SEASON_NOTE, /never count a tree/);
});
