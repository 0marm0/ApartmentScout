// node --test tests/js : which homes get a pin of their own and which share a building pin (dashboard/js/features/map-pins.js)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pinPlan, buildingKey, lowestCost, unitsLabel, dollars, fromText, isBuildingId, TOP_N } from '../../dashboard/js/features/map-pins.js';

const home = (id, building, over = {}) => ({ id, building, unit: id, lat: 40.75, lon: -73.98, status: 'new', ...over });
const cost = (L) => L.cost;
/** n homes in one building, then `others` single-home buildings, all ordered best first. */
function city(nTower, others, extra = []) {
  const list = [];
  for (let i = 0; i < nTower; i++) list.push(home(`tower-${i}`, 'The Tower', { cost: 5000 + i * 10 }));
  for (let i = 0; i < others; i++) list.push(home(`solo-${i}`, `Solo ${i}`, { lat: 40.76 + i * 0.001, lon: -73.97, cost: 4000 + i }));
  return [...list, ...extra];
}
const none = () => false;

test('a building with several homes is one pin carrying the count and the lowest cost', () => {
  const plan = pinPlan(city(6, 0), { isStar: none, topN: 0 });
  assert.equal(plan.buildings.length, 1);
  assert.equal(plan.buildings[0].units.length, 6);
  assert.equal(plan.singles.length, 0);
  assert.equal(lowestCost(plan.buildings[0].units, cost), 5000);
  assert.equal(unitsLabel(6, 4995), '6 units · from $4,995');
  assert.equal(unitsLabel(2, null), '2 units');
  assert.ok(isBuildingId(plan.buildings[0].id));
});

test('homes in different buildings stay single pins, even a few metres apart', () => {
  const list = [home('a', 'Alpha'), home('b', 'Beta'), home('c', 'Alpha', { lat: 40.7502 })];   // 22 m north: another place
  const plan = pinPlan(list, { isStar: none, topN: 0 });
  assert.equal(plan.buildings.length, 0);
  assert.equal(plan.singles.length, 3);
});

test('the same building name written differently still groups', () => {
  const plan = pinPlan([home('a', 'VIA 57 West'), home('b', 'via 57  west.')], { isStar: none, topN: 0 });
  assert.equal(plan.buildings.length, 1);
  assert.equal(buildingKey(home('a', 'VIA 57 West')), buildingKey(home('b', 'via 57  west.')));
});

test('saved picks are never grouped or hidden: each keeps its own pin, even inside a tower', () => {
  const list = city(6, 3);
  const saved = new Set(['tower-2', 'solo-1']);
  const plan = pinPlan(list, { isStar: (L) => saved.has(L.id), topN: 0 });
  assert.deepEqual(plan.stars.map((L) => L.id).sort(), ['solo-1', 'tower-2']);
  const grouped = plan.buildings.flatMap((b) => b.units.map((L) => L.id));
  assert.ok(!grouped.includes('tower-2') && !plan.singles.some((L) => L.id === 'solo-1'));
  assert.equal(plan.buildings[0].units.length, 5);            // the tower lost the saved unit, not its count
  assert.equal(plan.buildings[0].shifted, true);              // and its pin is drawn aside so the gold pin shows
});

test('the best-ranked homes stay as their own pins, the rest group', () => {
  const list = city(14, 20);
  const plan = pinPlan(list, { isStar: none });
  assert.equal(plan.top.length, TOP_N);
  assert.deepEqual(plan.top.map((L) => L.id), list.slice(0, TOP_N).map((L) => L.id));
  assert.equal(plan.buildings.reduce((n, b) => n + b.units.length, 0), 14 - TOP_N);   // the tower's other four homes share one pin
  assert.equal(plan.singles.length, 20);
  const ids = [...plan.stars, ...plan.top, ...plan.singles, ...plan.buildings.flatMap((b) => b.units)].map((L) => L.id);
  assert.equal(new Set(ids).size, list.length);              // every home is drawn exactly once
});

test('homes that are gone never take a top spot, and the open home is always kept', () => {
  const list = [home('gone-1', 'Old', { status: 'gone' }), ...city(3, 2)];
  const plan = pinPlan(list, { isStar: none, topN: 2, keep: (L) => L.id === 'tower-2' });
  assert.ok(!plan.top.some((L) => L.id === 'gone-1'));
  assert.deepEqual(plan.top.map((L) => L.id), ['tower-0', 'tower-1', 'tower-2']);   // two ranked + the open one
});

test('homes drawn by another layer (the sun lens) are left out', () => {
  const plan = pinPlan(city(4, 2), { isStar: none, topN: 0, split: (L) => L.id.startsWith('tower') });
  assert.equal(plan.buildings.length, 0);
  assert.equal(plan.singles.length, 2);
});

test('the lowest cost ignores units that are gone, falls back when all are, and tolerates unknown prices', () => {
  const u = [{ status: 'gone', cost: 3000 }, { status: 'new', cost: 5200 }, { status: 'new', cost: null }, { status: 'new', cost: 5100 }];
  assert.equal(lowestCost(u, cost), 5100);
  assert.equal(lowestCost([{ status: 'gone', cost: 3000 }, { status: 'gone', cost: 3500 }], cost), 3000);
  assert.equal(lowestCost([{ cost: undefined }], cost), null);
  assert.equal(lowestCost([], cost), null);
  assert.equal(dollars(4995.4), '$4,995'); assert.equal(fromText(null), ''); assert.equal(fromText(1200), 'from $1,200');
});
