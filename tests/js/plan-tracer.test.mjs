import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseLength, fmtLen, fmtArea, scaleFromAnchors, checkScale, confidenceOf, makeCal, provisionalCal, imgToPlan, planToImg, recalibrate,
  bearingFromArrow, bearingFromFacade, snapPoint, roomArea, cleanPoly, selfIntersects, asRect, insertVertex, deriveWalls, nearestWall,
  placeOpening, resizeOpening, swingToward, swingInto, swingSide, emptyDoc, fromPlanJSON, toPlanJSON, reviewDoc, History, plainText, slugId, mapDoc, localDate,
} from '../../dashboard/js/plan/tracer.js';
import { normalisePlan } from '../../dashboard/js/plan/model.js';
import { parseProject, serialiseProject } from '../../dashboard/js/plan/project.js';
import { savePlanScenario, getPlanScenario, scenarioKey, removePlanScenario } from '../../dashboard/js/plan/scenario-bridge.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
const nearPt = (p, q, eps = 1e-6) => { near(p[0], q[0], eps); near(p[1], q[1], eps); };

// A synthetic one-bedroom: living room 14 x 12 below a bedroom 14 x 11, bath 6 x 8 to the right.
const living = [[0, 0], [14, 0], [14, 12], [0, 12]];
const bedroom = [[0, 12], [14, 12], [14, 23], [0, 23]];
const bath = [[14, 4], [20, 4], [20, 12], [14, 12]];
function oneBed() {
  const doc = emptyDoc({ id: 'Synthetic 1BR', title: 'Synthetic one-bedroom' });
  doc.cal = makeCal({ image: { name: 'synthetic.png', w: 1400, h: 1000 }, anchors: [[100, 900], [660, 900]], length: 14, check: { anchors: [[100, 900], [100, 420]], length: 12 } });
  doc.rooms = [
    { id: 'r1', name: 'Living room', kind: 'living', poly: living, stated: "14'0\" x 12'0\"" },
    { id: 'r2', name: 'Bedroom', kind: 'bedroom', poly: bedroom },
    { id: 'r3', name: 'Bath', kind: 'bath', poly: bath, est: true },
  ];
  return doc;
}

test('typed lengths: feet-inches, inches, metric and bare numbers', () => {
  near(parseLength("12'6\""), 12.5);
  near(parseLength("12' 6"), 12.5);
  near(parseLength('12 ft 6 in'), 12.5);
  near(parseLength("12'-6 1/2\""), 12 + 6.5 / 12);
  near(parseLength('12’6”'), 12.5);
  near(parseLength('150"'), 12.5);
  near(parseLength('30 1/2 in'), 30.5 / 12);
  near(parseLength('3.81 m'), 3.81 * 39.37007874 / 12);
  near(parseLength('381 cm', 'm'), 3.81);
  near(parseLength('3810 mm', 'm'), 3.81);
  near(parseLength("12'", 'm'), 12 * 12 / 39.37007874);
  near(parseLength('14'), 14);
  near(parseLength('3,5', 'm'), 3.5);
  for (const bad of ['', 'abc', '-3', "0'", '1/0"', '12 parsecs', null]) assert.equal(parseLength(bad), null, String(bad));
  assert.equal(fmtLen(12.5), "12'6\"");
  assert.equal(fmtLen(3.8, 'm'), '3.80 m');
  assert.equal(fmtArea(168), '168 ft²');
  assert.equal(fmtArea(15.6, 'm'), '15.6 m²');
});

test('scale from two anchors, a check dimension and its disagreement', () => {
  const s = scaleFromAnchors([100, 900], [660, 900], 14);
  near(s, 40);
  assert.equal(scaleFromAnchors([1, 1], [1, 1], 14), null);
  assert.equal(scaleFromAnchors([0, 0], [10, 0], 0), null);
  const c = checkScale(s, [100, 900], [100, 410], 12);
  near(c.measured, 12.25);
  near(c.error_pct, 2.0833333, 1e-6);
  assert.equal(confidenceOf(1.2), 'high');
  assert.equal(confidenceOf(-3), 'medium');
  assert.equal(confidenceOf(6), 'low');
  assert.equal(confidenceOf(undefined), 'unchecked');
  const cal = makeCal({ image: { name: 'a.png', w: 1400, h: 1000 }, anchors: [[100, 900], [660, 900]], length: 14 });
  nearPt(imgToPlan(cal, [100, 900]), [2.5, 2.5]);
  nearPt(planToImg(cal, imgToPlan(cal, [321, 456])), [321, 456]);
  assert.equal(makeCal({ image: { w: 10, h: 10 }, anchors: [[0, 0], [0, 0]], length: 3 }), null);
  assert.ok(provisionalCal({ w: 800, h: 600 }).provisional);
});

test('re-calibrating moves traced geometry with the image', () => {
  const doc = oneBed();
  const old = doc.cal;
  const twice = makeCal({ image: old.image, anchors: old.anchors, length: 28 }); // the same anchors now span 28 ft
  const next = recalibrate(doc, twice);
  nearPt(next.rooms[0].poly[1], [28, 0]);
  nearPt(next.rooms[1].poly[2], [28, 46]);
  assert.equal(doc.rooms[0].poly[1][0], 14, 'source document unchanged');
});

test('north arrow and facade bearing give the bearing of the drawing top', () => {
  near(bearingFromArrow([0, 0], [0, 5]), 0);
  near(bearingFromArrow([0, 0], [5, 0]), 270); // north points right: the top faces west
  near(bearingFromArrow([0, 0], [-5, 0]), 90);
  near(bearingFromArrow([0, 0], [0, -5]), 180);
  assert.equal(bearingFromArrow([1, 1], [1, 1]), null);
  near(bearingFromFacade([0, 1], 180), 180);   // the top wall faces south
  near(bearingFromFacade([1, 0], 180), 90);    // the right wall faces south, so the top faces east
  near(bearingFromFacade([0, -1], 0), 180);
  // agrees with the normaliser's window bearing
  const plan = { schema: 2, units: 'ft', up_bearing: bearingFromFacade([1, 0], 200), rooms: [{ name: 'A', x: 0, y: 0, w: 10, h: 10 }], windows: [{ x1: 10, y1: 2, x2: 10, y2: 6 }] };
  near(normalisePlan(plan).windows[0].bearing, 200, 1e-6);
});

test('snapping: vertices, 90 and 45 degree rays, alignment, edges and grid', () => {
  const verts = [[0, 0], [10, 0], [10, 8]];
  assert.deepEqual(snapPoint([10.2, 7.9], { verts, tol: 0.5 }), { p: [10, 8], kind: 'vertex', aligned: false });
  let r = snapPoint([6.1, 0.3], { verts: [], prev: [0, 0], tol: 0.5 });
  assert.equal(r.kind, 'square'); nearPt(r.p, [6.1, 0]);
  r = snapPoint([0.2, 5], { prev: [0, 0], tol: 0.5 });
  assert.equal(r.kind, 'square'); near(r.p[0], 0);
  r = snapPoint([4.2, 3.8], { prev: [0, 0], tol: 0.5 });
  assert.equal(r.kind, 'diagonal'); near(r.p[0], r.p[1]);
  r = snapPoint([9.8, 3], { prev: [0, 3], verts, tol: 0.5 }); // along a horizontal ray, x lines up with the wall at x=10
  assert.equal(r.kind, 'square'); assert.equal(r.aligned, true); nearPt(r.p, [10, 3]);
  r = snapPoint([5, 7.8], { verts, edges: [], tol: 0.5 }); // free point: y lines up with (10, 8)
  assert.equal(r.aligned, true); near(r.p[1], 8);
  r = snapPoint([5, 0.3], { edges: [[[0, 0], [10, 0]]], tol: 0.5 });
  assert.equal(r.kind, 'edge'); nearPt(r.p, [5, 0]);
  r = snapPoint([3.04, 6.96], { grid: 1 / 12, tol: 0.01 });
  assert.equal(r.kind, 'free'); nearPt(r.p, [3, 7], 1e-5);
  r = snapPoint([7, 3], { prev: [0, 0], tol: 0.2, angle: true }); // 23 degrees off any ray: free
  assert.equal(r.kind, 'free');
});

test('polygon area, cleaning, self-intersection, rectangles and inserted vertices', () => {
  near(roomArea(living), 168);
  near(roomArea([...living].reverse()), 168);
  const L = [[0, 0], [10, 0], [10, 4], [4, 4], [4, 10], [0, 10]];
  near(roomArea(L), 64);
  const dirty = [[0, 0], [5, 0], [10, 0], [10, 0], [10, 10], [0, 10]].reverse();
  const c = cleanPoly(dirty);
  assert.equal(c.length, 4);
  assert.ok(roomArea(c) === 100);
  assert.equal(selfIntersects([[0, 0], [10, 10], [10, 0], [0, 10]]), true);
  assert.equal(selfIntersects(L), false);
  assert.deepEqual(asRect([[2, 1], [2, 5], [8, 5], [8, 1]]), { x: 2, y: 1, w: 6, h: 4 });
  assert.equal(asRect(L), null);
  assert.equal(asRect([[0, 0], [10, 0], [12, 5], [0, 5]]), null);
  const ins = insertVertex(living, 0);
  assert.equal(ins.length, 5); assert.deepEqual(ins[1], [7, 0]); near(roomArea(ins), 168);
});

test('walls are derived from room edges and shared edges merge into one interior wall', () => {
  const doc = oneBed();
  const walls = deriveWalls(doc.rooms, { tol: 0.05, probe: 0.3 });
  // the line y=12 is shared by the living room, bedroom and bath top: one wall from x=0 to x=20
  const mid = walls.filter((w) => Math.abs(w.a[1] - 12) < 1e-6 && Math.abs(w.b[1] - 12) < 1e-6);
  assert.equal(mid.length, 1);
  near(mid[0].len, 20);
  // x=14: the living room's right edge, the bath's left edge and the bedroom's right edge are one line
  const x14 = walls.filter((w) => Math.abs(w.a[0] - 14) < 1e-6 && Math.abs(w.b[0] - 14) < 1e-6);
  assert.equal(x14.length, 1);
  near(x14[0].len, 23);
  const outer = walls.find((w) => Math.abs(w.a[1]) < 1e-6 && Math.abs(w.b[1]) < 1e-6);
  assert.equal(outer.exterior, true);
  const shared = nearestWall([7, 12.1], walls, 0.5).wall;
  assert.equal(shared.exterior, false);
  assert.deepEqual([shared.left, shared.right].sort(), ['Bedroom', 'Living room']);
  assert.equal(nearestWall([7, 6], walls, 0.5), null);
});

test('doors and windows sit on walls, stay inside them and swing into the chosen room', () => {
  const doc = oneBed();
  const walls = deriveWalls(doc.rooms, { probe: 0.3 });
  const hit = nearestWall([3, 12.2], walls, 0.5);
  const d = placeOpening(hit.wall, [3, 12.2], 32 / 12);
  near(Math.hypot(d.b[0] - d.a[0], d.b[1] - d.a[1]), 32 / 12);
  near(d.a[1], 12); near(d.b[1], 12);
  const end = placeOpening(hit.wall, [0.2, 12], 3); // near the wall end: kept inside
  near(Math.min(end.a[0], end.b[0]), 0);
  const tiny = placeOpening({ a: [0, 0], b: [2, 0], len: 2, u: [1, 0] }, [1, 0], 3);
  near(tiny.width, 2);
  const wide = resizeOpening({ a: [2, 12], b: [5, 12] }, 4);
  nearPt(wide.a, [1.5, 12]); nearPt(wide.b, [5.5, 12]);
  assert.equal(swingToward([2, 12], [5, 12], [3, 20]), '+y');
  assert.equal(swingToward([2, 12], [5, 12], [3, 0]), '-y');
  assert.equal(swingToward([14, 2], [14, 5], [20, 3]), '+x');
  assert.equal(swingToward([0, 0], [3, 3], [0, 3]), null);
  const door = { a: [2, 12], b: [5, 12], hinge: 'a' };
  const into = swingInto(door, 1, doc.rooms);
  assert.deepEqual(into, { swing: '+y', room: 'Bedroom' });
  assert.equal(swingSide({ ...door, ...into }, doc.rooms), 1);
  assert.deepEqual(swingInto(door, -1, doc.rooms), { swing: '-y', room: 'Living room' });
  // an angled wall falls back to "in" with the room name
  const bay = [[0, 0], [10, 0], [12, 3], [12, 7], [10, 10], [0, 10]];
  const ang = swingInto({ a: [10, 0], b: [12, 3] }, 1, [{ name: 'Bay room', poly: bay }]);
  assert.deepEqual(ang, { swing: 'in', room: 'Bay room' });
  // the normaliser cuts the wall at the door and keeps the swing
  const plan = toPlanJSON({ ...doc, doors: [{ id: 'd1', ...door, ...into }] });
  const m = normalisePlan(plan);
  assert.equal(m.doors[0].swing, '+y');
  assert.ok(m.pieces.some((p) => p.kind === 'head'), 'door head piece cut into the wall');
});

test('export is plan JSON v2 accepted by the normaliser and the strict project validator', () => {
  const doc = oneBed();
  doc.up_bearing = 180; doc.bearing = { method: 'arrow' };
  const walls = deriveWalls(doc.rooms, { probe: 0.3 });
  const top = nearestWall([7, 23], walls, 0.5).wall;
  const win = placeOpening(top, [7, 23], 4);
  doc.windows = [{ id: 'n1', ...win, sill: 2, head: 7, room: 'Bedroom' }];
  doc.doors = [{ id: 'd1', ...placeOpening(walls.find((w) => Math.abs(w.a[1]) < 1e-6 && Math.abs(w.b[1]) < 1e-6), [4, 0], 3), hinge: 'b', ...swingInto({ a: [2.5, 0], b: [5.5, 0] }, 1, doc.rooms), kind: 'entry', name: 'front door' }];
  doc.fixtures = [{ id: 'f1', kind: 'ac', label: 'Bedroom AC', x: 5, y: 22.2, w: 3.5, h: 0.8, est: true }, { id: 'f2', kind: 'closet', x: 10, y: 21, w: 4, h: 2, doors: 'sliding' }];
  const plan = toPlanJSON(doc, { date: '2026-10-13' });
  assert.equal(plan.schema, 2);
  assert.equal(plan.id, 'synthetic-1br');
  assert.deepEqual(plan.rooms[0], { name: 'Living room', kind: 'living', x: 0, y: 0, w: 14, h: 12, stated: "14'0\" x 12'0\"" });
  assert.equal(plan.rooms[2].est, true);
  assert.equal(plan.provenance.trace.by, 'user');
  assert.equal(plan.provenance.trace.image, 'synthetic.png');
  assert.equal(plan.provenance.trace.confidence, 'high');
  assert.deepEqual(plan.provenance.trace.anchors, [[100, 900], [660, 900]]);
  near(plan.provenance.trace.check.error_pct, 0);
  assert.match(plan.source, /Traced by the renter from "synthetic.png"/);
  assert.match(plan.source, /not a survey/);
  assert.deepEqual(plan.provenance.printed, ["Living room 14'0\" x 12'0\""]);
  const m = normalisePlan(plan);
  assert.equal(m.rooms.length, 3);
  near(m.area, 168 + 154 + 48);
  near(m.windows[0].bearing, 180);
  assert.equal(m.doors[0].kind, 'entry');
  const project = serialiseProject(plan, [], { directSun: true });
  const r = parseProject(JSON.stringify(project), { planId: 'synthetic-1br' });
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.project.plan.provenance.trace, plan.provenance.trace);
  const issues = reviewDoc(doc);
  assert.equal(issues.filter((i) => i.level === 'error').length, 0, JSON.stringify(issues));
});

test('a new tracing is exported with its rooms starting at the origin; the image anchoring moves with it', () => {
  const doc = oneBed();
  const shifted = mapDoc(doc, ([x, y]) => [x + 2.5, y + 2.5]); // as traced: the image's corner is the origin
  const plan = toPlanJSON(shifted, { date: '2026-10-13' });
  assert.deepEqual([plan.rooms[0].x, plan.rooms[0].y], [0, 0]);
  const t = plan.provenance.trace, toImg = ([x, y]) => [x * t.scale + t.origin_px[0], t.origin_px[1] - y * t.scale];
  // the living room's corner lands on the same image pixel before and after the shift
  nearPt(toImg([0, 0]), planToImg(shifted.cal, [2.5, 2.5]), 0.11);
  const edit = { ...shifted, mode: 'edit' };
  assert.equal(toPlanJSON(edit, { date: '2026-10-13' }).rooms[0].x, 2.5, 'edits keep their coordinates');
  assert.match(localDate(new Date(2026, 9, 13, 23, 30)), /^2026-10-13$/);
});

test('the project validator rejects a malformed trace block', () => {
  const plan = toPlanJSON(oneBed(), { date: '2026-10-13' });
  for (const bad of [{ scale: 'x' }, { anchors: [[1, 2, 3]] }, { page: 0 }, { image: '<b>x</b>' }, { extra: 1 }, { check: { anchors: [[0, 0], [1, 1]], error_pct: NaN } }]) {
    const p = structuredClone(plan); Object.assign(p.provenance.trace, bad);
    assert.throws(() => serialiseProject(p, []), undefined, JSON.stringify(bad));
  }
});

test('review flags a missing scale, crossings, overlaps and stray openings', () => {
  const doc = emptyDoc();
  assert.ok(reviewDoc(doc).some((i) => i.level === 'error' && /room/.test(i.text)));
  assert.ok(reviewDoc(doc).some((i) => i.level === 'error' && /scale/.test(i.text)));
  const d2 = oneBed();
  d2.rooms.push({ id: 'x', name: 'Bowtie', kind: 'other', poly: [[30, 0], [40, 10], [40, 0], [30, 10]] });
  d2.rooms.push({ id: 'y', name: 'Inside', kind: 'other', poly: [[2, 2], [6, 2], [6, 6], [2, 6]] });
  d2.doors.push({ id: 'z', a: [50, 50], b: [53, 50] });
  d2.cal.check.error_pct = 7;
  const t = reviewDoc(d2).map((i) => i.text).join('\n');
  assert.match(t, /crosses itself/);
  assert.match(t, /Inside overlaps Living room/);
  assert.match(t, /not on a room edge/);
  assert.match(t, /7.0% off/);
});

test('editing an existing plan keeps rectangles, openings, fixtures and layouts, and leaves the source alone', () => {
  const raw = {
    schema: 2, id: 'unit-12b', title: 'Unit 12B', units: 'ft', ceiling: 9, wall: 0.4, up_bearing: 180, source: 'Listing plan, dimensions as printed',
    provenance: { match: 'exact-unit', printed: ['Bedroom 11 x 12'], estimated: ['AC unit'] },
    rooms: [{ name: 'Living', kind: 'living', x: 0, y: 0, w: 14, h: 12 }, { name: 'Bedroom', kind: 'bedroom', poly: [[0, 12], [14, 12], [14, 23], [0, 23]] }],
    windows: [{ room: 'Bedroom', x1: 2, y1: 23, x2: 8, y2: 23, sill: 2, head: 8 }],
    doors: [{ x1: 2, y1: 12, x2: 4.5, y2: 12, hinge: 'a', swing: '+y', room: 'Bedroom' }],
    fixtures: [{ kind: 'column', x: 13, y: 0, w: 1, h: 1 }], keepout: [{ name: 'Path', x: 1, y: 1, w: 2, h: 2 }],
    layouts: [{ id: 'a', name: 'A', note: '', items: [{ ref: 'queen-bed', x: 7, y: 18, rot: 0 }] }],
  };
  const before = JSON.stringify(raw);
  const doc = fromPlanJSON(raw, { label: 'Wider bedroom door' });
  assert.equal(doc.mode, 'edit');
  assert.equal(doc.rooms[0].poly.length, 4);
  const h = new History(doc);
  const d1 = h.doc; d1.doors[0] = resizeOpening(d1.doors[0], 3); d1.changes.push("Bedroom door 3'0\""); h.push(d1, 'Door width');
  const d2 = h.doc; d2.ceiling = 10; d2.wall = 0.5; d2.changes.push('Ceiling 10 ft'); h.push(d2, 'Ceiling');
  const d3 = h.doc; d3.rooms[1].poly[2] = [15, 23]; h.push(d3, 'Move corner');
  assert.equal(h.canUndo, true);
  h.undo(); assert.deepEqual(h.doc.rooms[1].poly[2], [14, 23]);
  h.redo(); assert.deepEqual(h.doc.rooms[1].poly[2], [15, 23]);
  const plan = toPlanJSON(h.doc, { date: '2026-10-13' });
  assert.equal(JSON.stringify(raw), before, 'source plan object unchanged');
  assert.deepEqual(plan.rooms[0], { name: 'Living', kind: 'living', x: 0, y: 0, w: 14, h: 12 });
  assert.ok(plan.rooms[1].poly, 'moved corner keeps a polygon');
  near(plan.doors[0].x2 - plan.doors[0].x1, 3);
  assert.equal(plan.doors[0].swing, '+y');
  assert.equal(plan.ceiling, 10); assert.equal(plan.wall, 0.5);
  assert.deepEqual(plan.keepout, raw.keepout); assert.deepEqual(plan.layouts, raw.layouts);
  assert.equal(plan.provenance.match, 'exact-unit');
  assert.deepEqual(plan.provenance.estimated, ['AC unit']);
  assert.equal(plan.provenance.trace.mode, 'edit');
  assert.equal(plan.provenance.trace.label, 'Wider bedroom door');
  assert.deepEqual(plan.provenance.trace.changes, ["Bedroom door 3'0\"", 'Ceiling 10 ft']);
  assert.match(plan.source, /^Listing plan, dimensions as printed · Edited in the browser \(Wider bedroom door\): 2 changes/);
  const r = parseProject(serialiseProject(plan, []));
  assert.equal(r.ok, true, r.error);
  assert.equal(r.model.ceiling, 120);
});

test('history ignores no-op pushes and drops the redo branch on a new edit', () => {
  const h = new History({ a: 1 });
  assert.equal(h.push({ a: 1 }), false);
  h.push({ a: 2 }); h.push({ a: 3 }); h.undo();
  h.push({ a: 4 });
  assert.equal(h.canRedo, false);
  assert.deepEqual(h.undo(), { a: 2 });
  assert.deepEqual(h.undo(), { a: 1 });
  assert.equal(h.canUndo, false);
});

test('plain text and ids are safe for the strict validators', () => {
  assert.equal(plainText('<b>Bed</b>\nroom'), 'b Bed /b room');
  assert.equal(slugId('Unit 12B / North'), 'unit-12b-north');
  assert.equal(slugId('***'), 'traced-plan');
});

test('scenario bridge stores one validated plan + furniture per plan id', () => {
  const mem = new Map(), storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
  const plan = toPlanJSON(oneBed(), { date: '2026-10-13' });
  const project = serialiseProject(plan, [{ id: 'bed', ref: 'queen-bed', x: 84, y: 210, rot: 0 }], { directSun: true, ambient: 1 });
  const rec = savePlanScenario({ project, base: 'data', label: 'Traced plan', from: 'tracer', saved: '2026-10-13T12:00:00Z' }, { storage });
  assert.equal(rec.id, 'synthetic-1br');
  assert.ok(mem.has(scenarioKey('synthetic-1br')));
  assert.equal(scenarioKey('x'), 'as:plan-scenario:x');
  const got = getPlanScenario('synthetic-1br', { base: 'data', storage });
  assert.equal(got.label, 'Traced plan');
  assert.equal(got.from, 'tracer');
  assert.equal(got.layout.items[0].ref, 'queen-bed');
  assert.equal(got.model.rooms.length, 3);
  assert.equal(got.plan.provenance.trace.by, 'user');
  assert.equal(getPlanScenario('synthetic-1br', { base: 'data-private', storage }), null, 'other search folder');
  assert.equal(getPlanScenario('other-unit', { storage }), null, 'never a sibling unit');
  mem.set(scenarioKey('broken'), '{"schema":1,"kind":"apartmentscout-plan-scenario","id":"broken","project":{}}');
  assert.equal(getPlanScenario('broken', { storage }), null);
  mem.set(scenarioKey('junk'), 'not json');
  assert.equal(getPlanScenario('junk', { storage }), null);
  assert.equal(getPlanScenario('../x', { storage }), null);
  assert.throws(() => savePlanScenario({ project: { schema: 1 } }, { storage }));
  removePlanScenario('synthetic-1br', { storage });
  assert.equal(getPlanScenario('synthetic-1br', { storage }), null);
});
