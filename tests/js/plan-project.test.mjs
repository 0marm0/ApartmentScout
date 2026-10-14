import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseProject, serialiseProject, MAX_PROJECT_BYTES } from '../../dashboard/js/plan/project.js';

const plan = { schema: 2, id: 'test-unit', units: 'ft', ceiling: 9, up_bearing: 180, source: 'Printed room dimensions; HVAC estimated', rooms: [{ name: 'Bedroom', kind: 'bedroom', x: 0, y: 0, w: 14, h: 16, stated: '14 × 16 ft' }], windows: [{ x1: 2, y1: 16, x2: 10, y2: 16, sill: 2, head: 7 }], fixtures: [{ kind: 'ac', x: 10, y: 15, w: 3, h: 1, height: 2, reserve: 1.5, est: true }], provenance: { match: 'stated-dims', estimated: ['HVAC'] } };
const items = [{ id: 'bed', ref: 'queen-bed', x: 72, y: 96, rot: 270, w: 65, d: 85 }];
const project = () => serialiseProject(plan, items, { directSun: false, ambient: 1.2 });

test('complete project round-trips source geometry, inch furniture and display preferences', () => {
  const input = project(), result = parseProject(JSON.stringify(input));
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(result.project.plan, plan);
  assert.deepEqual(result.layout.items, items);
  assert.equal(result.model.fixtures[0].reserve, 18);
  assert.deepEqual(result.project.lighting, { directSun: false, ambient: 1.2 });
  result.project.plan.rooms[0].w = 99;
  assert.equal(input.plan.rooms[0].w, 14);
  assert.equal(plan.rooms[0].w, 14);
});

test('project identity is exact, including an absent or conflicting layout identity', () => {
  assert.match(parseProject(project(), { planId: 'other' }).error, /not other/);
  for (const id of [undefined, 'other']) {
    const p = project(); p.layout.plan = id;
    assert.equal(parseProject(p).ok, false);
  }
});

test('invalid imports fail without mutating the source project', () => {
  const cases = [
    p => { p.extra = 'ignored?'; },
    p => { p.plan.rooms[0].w = Infinity; },
    p => { p.plan.rooms[0].x = 500; },
    p => { p.plan.windows[0].head = 1; },
    p => { p.plan.windows[0].head = 20; },
    p => { p.plan.units = 'cm'; },
    p => { p.plan.rooms[0].w = '14'; },
    p => { p.plan.rooms[0].poly = [[0, 0], [1, 1]]; },
    p => { p.layout.items[0].ref = 'unknown-chair'; },
    p => { p.layout.items[0].x = 6000; },
    p => { p.lighting.ambient = 3; },
    p => { p.lighting.lux = 500; },
    p => { p.lighting.glazing = 1.5; },
    p => { p.lighting.glazing = '0.6'; },
    p => { p.lighting.blinds = 'venetian'; },
    p => { p.plan.source = '<script>'; },
    p => { p.plan.layouts = [{ items: [{ ref: 'queen-bed', x: '2', y: 3 }] }]; },
  ];
  for (const mutate of cases) {
    const p = project(); mutate(p); const before = structuredClone(p);
    assert.equal(parseProject(p).ok, false);
    assert.deepEqual(p, before);
  }
  assert.equal(parseProject('{broken').ok, false);
  assert.equal(parseProject('x'.repeat(MAX_PROJECT_BYTES + 1)).ok, false);
  const cyclic = {}; cyclic.plan = cyclic;
  assert.match(parseProject(cyclic).error, /cycle/);
  assert.equal(parseProject('{"__proto__":{}}').ok, false);
  let called = false;
  const access = {}; Object.defineProperty(access, 'plan', { enumerable: true, get() { called = true; return plan; } });
  assert.equal(parseProject(access).ok, false);
  assert.equal(called, false);
});

test('serialisation rejects non-finite numbers and bad furniture', () => {
  assert.throws(() => serialiseProject(plan, [{ ...items[0], x: NaN }]), /finite/);
  assert.throws(() => serialiseProject(plan, [{ ...items[0], ref: 'unknown' }]), /unknown furniture/);
});

test('geometry units preserve equivalent feet, metres and inches', () => {
  for (const [units, width] of [['in', 168], ['m', 4.2672]]) {
    const p = { schema: 1, id: 'unit', units, rooms: [{ x: 0, y: 0, w: width, h: width }] };
    const r = parseProject(serialiseProject(p, []));
    assert.equal(r.ok, true, r.error);
    assert.ok(Math.abs(r.model.bounds.x1 - 168) < 0.0001);
  }
});

test('glass and blinds preview settings round-trip with the project', () => {
  const r = parseProject(serialiseProject(plan, items, { directSun: true, ambient: 1, glazing: 0.45, blinds: 'half' }));
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.project.lighting, { directSun: true, ambient: 1, glazing: 0.45, blinds: 'half' });
});
