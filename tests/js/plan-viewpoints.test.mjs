// node --test tests/js : where to stand to look out (rooms, bays, corners, seats), the camera maths and the Inside camera's views
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalisePlan, pointInPoly } from '../../dashboard/js/plan/model.js';
import { resolve } from '../../dashboard/js/plan/catalog.js';
import { windowGroups, lookOutViews, seatViews, allViews, clearSight, stepView, dirAngle, turnBetween, facingWord, EYE_STAND } from '../../dashboard/js/plan/viewpoints.js';
import { insideViews, viewForWindow, lerpAngle } from '../../dashboard/js/unit/inside-views.js';
import { planFrame } from '../../dashboard/js/plan/city.js';
import { lookChipsHTML } from '../../dashboard/js/plan/look-ui.js';

const read = (id) => JSON.parse(fs.readFileSync(new URL(`../../examples/nyc-2026/plans/${id}.json`, import.meta.url), 'utf8'));
const load = (id) => { const m = normalisePlan(read(id)); return { m, R: (m.layouts[0]?.items || []).map((i) => resolve(i)) }; };
const M = 0.0254;

test('panes of one room that join end to end are one window: a bay, a corner or a flat window', () => {
  const { m } = load('paramount-tower-25e'), g = windowGroups(m);
  assert.deepEqual(g.map((x) => [x.room, x.kind, x.panes.length]), [['Bedroom', 'corner', 3], ['Living room', 'bay', 3]]);
  const bay = g.find((x) => x.room === 'Living room');
  assert.ok(Math.abs(bay.normal[0]) < 0.05 && bay.normal[1] > 0.99, 'the bay looks straight out of the facade');
  assert.ok(bay.spread >= 80 && bay.spread <= 100);
  const e = windowGroups(load('emerald-green-1211').m);
  assert.deepEqual(e.map((x) => [x.room, x.kind]), [['Bedroom', 'flat'], ['Living room', 'flat']]);
  const nj = windowGroups(load('paramount-tower-9j').m);
  assert.ok(nj.every((x) => x.kind === 'corner' && x.panes.length === 2));
});

test('every standing view is inside its room, back from the glass, looking out of it, with nothing solid in the way', () => {
  for (const id of ['paramount-tower-25e', 'paramount-tower-9j', 'emerald-green-1211', 'the-greywood-4b']) {
    const { m } = load(id), groups = windowGroups(m);
    const views = lookOutViews(m);
    assert.ok(views.length >= groups.length, id);
    for (const v of views) {
      const g = groups[v.group], room = m.rooms.find((r) => r.name === g.room);
      assert.ok(pointInPoly(v.at, room.poly), `${id} ${v.label}: stands inside the ${g.room}`);
      assert.ok(Math.abs(Math.hypot(...v.dir) - 1) < 1e-6, 'unit direction');
      const toGlass = [g.mid[0] - v.at[0], g.mid[1] - v.at[1]], dist = Math.hypot(...toGlass);
      assert.ok(dist >= 17 && dist <= 100, `${id} ${v.label}: ${Math.round(dist)} in from the glass`);
      const cos = (toGlass[0] * v.dir[0] + toGlass[1] * v.dir[1]) / dist;
      assert.ok(cos > 0.98, `${id} ${v.label}: looks at the glass (cos ${cos.toFixed(3)})`);
      assert.ok(clearSight(m, v.at, g.mid), `${id} ${v.label}: no wall between the eye and the window`);
      assert.equal(v.h, EYE_STAND);
      assert.ok(v.fov >= 60 && v.fov <= 110);
    }
  }
});

test('25E offers Living room, Bay, Bedroom and Corner, then the sofa, bed and desk', () => {
  const { m, R } = load('paramount-tower-25e');
  assert.deepEqual(lookOutViews(m).map((v) => v.label), ['Living room', 'Bay', 'Bedroom', 'Corner']);
  assert.deepEqual(seatViews(m, R).map((v) => v.label), ['Sofa', 'Bed', 'Desk']);
  const all = allViews(m, R);
  assert.equal(new Set(all.map((v) => v.key)).size, all.length, 'unique keys');
  // the bay and corner are closer and wider than the room view of the same window
  const room = all.find((v) => v.key.startsWith('room:Living')), bay = all.find((v) => v.key.startsWith('bay:'));
  assert.ok(bay.fov > room.fov && Math.hypot(bay.at[0] - 95, bay.at[1] - 370) < Math.hypot(room.at[0] - 95, room.at[1] - 370));
});

test('a seat looks out of the window of its own room, from the height a person sits', () => {
  const { m, R } = load('paramount-tower-25e'), groups = windowGroups(m);
  const by = Object.fromEntries(seatViews(m, R).map((v) => [v.seat, v]));
  assert.equal(m.rooms.find((r) => pointInPoly(by.bed.at, r.poly)).name, 'Bedroom');
  assert.equal(groups[by.bed.group].room, 'Bedroom');
  assert.equal(groups[by.sofa.group].room, 'Living room');
  assert.ok(by.sofa.h < EYE_STAND && by.bed.h < by.sofa.h + 10);
  for (const v of Object.values(by)) {
    const g = groups[v.group], to = [g.mid[0] - v.at[0], g.mid[1] - v.at[1]], d = Math.hypot(...to);
    assert.ok((to[0] * v.dir[0] + to[1] * v.dir[1]) / d > 0.999, `${v.label} faces the window`);
    assert.ok(clearSight(m, v.at, g.mid), `${v.label}: a clear line to the window`);
  }
  // no sofa in the layout, no sofa view
  assert.deepEqual(seatViews(m, R.filter((x) => x.kind !== 'sofa')).map((v) => v.seat), ['bed', 'desk']);
  // a plan with no windows has no views at all
  const blind = normalisePlan({ units: 'ft', rooms: [{ name: 'Box', kind: 'living', x: 0, y: 0, w: 10, h: 10 }] });
  assert.deepEqual(allViews(blind, []), []);
});

test('two windows of one room get different names (the way each faces)', () => {
  const { m } = load('the-greywood-4b'), labels = lookOutViews(m).map((v) => v.label);
  assert.equal(new Set(labels).size, labels.length, labels.join(' | '));
  assert.ok(labels.some((l) => /south-west|north|east|west|south/.test(l)));
  assert.equal(facingWord({ up_bearing: 119 }, [0, 1]), 'south-east');
  assert.equal(facingWord({ up_bearing: null }, [-1, 0]), 'left side');
});

test('angle helpers and stepping through the views', () => {
  assert.equal(Math.round(dirAngle([0, 1])), 0); assert.equal(Math.round(dirAngle([1, 0])), 90); assert.equal(Math.round(dirAngle([-1, 0])), 270);
  assert.equal(turnBetween(350, 10), 20); assert.equal(turnBetween(10, 350), -20); assert.equal(Math.round(Math.abs(turnBetween(0, 180))), 180);
  assert.equal(Math.round(lerpAngle(350, 10, 0.5)), 360);   // the short way round, through north
  const vs = [{ key: 'a' }, { key: 'b' }, { key: 'c' }];
  assert.equal(stepView(vs, 'a', 1).key, 'b'); assert.equal(stepView(vs, 'c', 1).key, 'a'); assert.equal(stepView(vs, 'a', -1).key, 'c');
  assert.equal(stepView(vs, null, 1).key, 'a'); assert.equal(stepView(vs, null, -1).key, 'c'); assert.equal(stepView([], 'a', 1), null);
});

test("Unit 3D's Inside views are the same rooms in the interior's own frame (metres from the facade windows)", () => {
  const { m, R } = load('paramount-tower-25e'), fr = planFrame(m), views = insideViews(m, R, fr), plan = allViews(m, R);
  assert.deepEqual(views.map((v) => v.label), [...plan.map((v) => v.label), 'Into the room']);
  for (const [i, v] of plan.entries()) {
    const w = views[i];
    assert.ok(Math.abs(w.local[0] - (v.at[0] - fr.xc) * M) < 1e-9 && Math.abs(w.local[1] + (v.at[1] - fr.yw) * M) < 1e-9, v.label);
    assert.ok(Math.abs(turnBetween(w.off, dirAngle(v.dir))) < 1e-6 && Number.isInteger(w.win) && w.win < m.windows.length, v.label);
    assert.ok(Math.abs(w.h - 63 * M) < 1e-9 || v.kind === 'seat');
  }
  const bay = views.find((v) => v.kind === 'bay');
  assert.ok(Math.abs(turnBetween(bay.off, 0)) < 1, 'the bay looks straight out (offset 0 from the facade)');
  const back = views.find((v) => v.kind === 'inward'), main = views.find((v) => v.kind === 'room');
  assert.ok(Math.abs(Math.abs(turnBetween(back.off, main.off)) - 180) < 1e-6, 'Into the room faces the other way');
  // the stored window index stands for a room view; no index starts in the living room
  assert.equal(viewForWindow(views, -1).label, 'Living room');
  assert.equal(viewForWindow(views, views.find((v) => v.room === 'Bedroom' && v.kind === 'room').win).label, 'Bedroom');
  assert.equal(viewForWindow([], 0), null);
});

test('the chips: a radio group per kind, the active one in the tab order, arrows switch', () => {
  const { m, R } = load('paramount-tower-25e'), vs = allViews(m, R), html = lookChipsHTML(vs, 'seat:bed');
  assert.equal((html.match(/role="radiogroup"/g) || []).length, 2);
  assert.equal((html.match(/data-vp=/g) || []).length, vs.length);
  assert.match(html, /aria-checked="true"[^>]*tabindex="0"|tabindex="0"[^>]*aria-checked="true"/);
  assert.equal((html.match(/tabindex="0"/g) || []).length, 1);
  assert.match(html, /← → to switch/);
  assert.equal(lookChipsHTML([], null), '');
  assert.ok(!/<script/i.test(lookChipsHTML([{ key: 'x"><script>', label: '<img src=x onerror=1>', kind: 'room', room: 'A' }], null)), 'escaped');
});
