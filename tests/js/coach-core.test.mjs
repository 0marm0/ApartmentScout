// node --test tests/js : first-run coach marks, the rules without the DOM (dashboard/js/features/coach-core.js)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STEPS, JOURNEYS, shouldAutoStart, nextStep, placeCard } from '../../dashboard/js/features/coach-core.js';

test('four steps through the five journeys: find, compare, see inside, decide and set up', () => {
  assert.deepEqual(STEPS.map((s) => s.id), ['find', 'compare', 'inside', 'decide']);
  for (const s of STEPS) { assert.ok(s.title.length < 40, s.title); assert.ok(s.body.length > 40 && s.body.length < 200, s.id); assert.equal(typeof s.target, 'string'); }
  assert.match(STEPS[1].body, /\{undo\}/);
  assert.deepEqual([...new Set(STEPS.flatMap((s) => s.journeys))].sort(), JOURNEYS.map((_, i) => i), 'every journey is named by a step');
});

test('the tour starts by itself once, on the Map, in a normal browser with homes loaded', () => {
  assert.equal(shouldAutoStart({}), true);
  assert.equal(shouldAutoStart({ done: true }), false);
  assert.equal(shouldAutoStart({ automated: true }), false);
  assert.equal(shouldAutoStart({ hasListings: false }), false);
  assert.equal(shouldAutoStart({ view: 'unit' }), false);
  assert.equal(shouldAutoStart({ hasOpen: true }), false, 'a shared link to one home is not interrupted');
  assert.equal(shouldAutoStart({ wizardOpen: true }), false);
});

test('?coach=1 forces it, even after it was finished or under automation, but still needs homes', () => {
  assert.equal(shouldAutoStart({ forced: true, done: true, automated: true }), true);
  assert.equal(shouldAutoStart({ forced: true, hasListings: false }), false);
});

test('nextStep skips steps with nothing to point at', () => {
  const has = [true, false, true, true, false];
  assert.equal(nextStep(0, 1, has), 2);
  assert.equal(nextStep(2, 1, has), 3);
  assert.equal(nextStep(3, 1, has), -1);
  assert.equal(nextStep(3, -1, has), 2);
  assert.equal(nextStep(2, -1, has), 0);
  assert.equal(nextStep(0, -1, has), -1);
});

const vp = { w: 1600, h: 1000 }, card = { w: 320, h: 200 };
test('placeCard: a tall target (the rail) gets the card on its right', () => {
  const p = placeCard({ x: 0, y: 48, w: 288, h: 900 }, card, vp);
  assert.equal(p.dock, 'right'); assert.ok(p.left >= 288); assert.ok(p.top >= 12 && p.top + card.h <= vp.h - 12);
});

test('placeCard: a small target gets the card below it, or above when there is no room below', () => {
  const below = placeCard({ x: 900, y: 200, w: 40, h: 40 }, card, vp);
  assert.equal(below.dock, 'below'); assert.ok(below.top > 240);
  const above = placeCard({ x: 900, y: 880, w: 40, h: 40 }, card, vp);
  assert.equal(above.dock, 'above'); assert.ok(above.top + card.h < 880);
});

test('placeCard: always inside the viewport, even at the edges', () => {
  for (const r of [{ x: 0, y: 0, w: 40, h: 40 }, { x: 1560, y: 0, w: 40, h: 40 }, { x: 1560, y: 960, w: 40, h: 40 }, { x: 0, y: 960, w: 40, h: 40 }]) {
    const p = placeCard(r, card, vp);
    assert.ok(p.left >= 12 && p.left + card.w <= vp.w - 12, JSON.stringify(p));
    assert.ok(p.top >= 12 && p.top + card.h <= vp.h - 12, JSON.stringify(p));
  }
});

test('placeCard: on a phone the card docks at the bottom', () => {
  const p = placeCard({ x: 20, y: 100, w: 60, h: 40 }, { w: 300, h: 180 }, { w: 390, h: 844 });
  assert.equal(p.dock, 'bottom'); assert.equal(p.top, 844 - 180 - 12);
});
