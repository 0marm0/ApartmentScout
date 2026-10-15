// Lighting model of the Floor plan studio: daylight inputs with assumed/source labels, luminaires, the lamp estimate
// and the sensor-grid adapter. Pure functions only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalisePlan } from '../../dashboard/js/plan/model.js';
import { parseProject, serialiseProject } from '../../dashboard/js/plan/project.js';
import {
  defaultInputs, cleanInputs, isDefaultInputs, sourceCount, presetFor, reflectances, daylightGrids, LUM_TYPES, newLuminaire,
  cleanLuminaires, validateExtras, sourcesOf, luxAt, lampGrids, kelvinRgb, furnitureLuminaires, shareAbove,
} from '../../dashboard/js/plan/lighting-model.js';
import { GLAZING_PRESETS, FRAME_PRESETS } from '../../dashboard/js/features/daylight-core.js';
import { BLINDS, BLINDS_LABEL, blindsOf } from '../../dashboard/js/plan/light.js';

const near = (a, b, msg, rel = 1e-9) => assert.ok(Math.abs(a - b) <= rel * Math.max(1, Math.abs(b)), `${msg}: ${a} vs ${b}`);
const PLAN = { schema: 1, id: 'lx', title: 'Lighting test', units: 'in', ceiling: 108, up_bearing: 0,
  rooms: [{ name: 'Living', kind: 'living', x: 0, y: 0, w: 144, h: 192 }, { name: 'Bedroom', kind: 'bedroom', x: 150, y: 0, w: 120, h: 144 }],
  windows: [{ room: 'Living', x1: 36, y1: 192, x2: 108, y2: 192, sill: 24, head: 84 }] };

test('default inputs are all assumptions; nothing is a source until the renter says so', () => {
  const d = defaultInputs();
  assert.equal(d.glazing.source, 'assumed'); assert.equal(d.frame.glazed, 0.8);
  assert.deepEqual(sourceCount(d), { source: 0, total: 6 });
  assert.ok(isDefaultInputs(d, 0.6)); assert.ok(!isDefaultInputs(d, 0.7));
  assert.deepEqual(reflectances(d), { floor: 0.25, walls: 0.55, ceiling: 0.75 });
});
test('stored inputs are cleaned: unknown presets become custom, numbers are clamped, markup is stripped', () => {
  const c = cleanInputs({ sky: 'weird', glazing: { preset: 'nope', source: 'maybe', note: '<b>spec sheet</b>' }, frame: { preset: 'custom', glazed: 5 }, surfaces: { walls: { preset: 'custom', rho: 2, source: 'source', note: 'Benjamin Moore sample' } } });
  assert.equal(c.sky, 'overcast'); assert.equal(c.glazing.preset, 'default'); assert.equal(c.glazing.source, 'assumed');
  assert.ok(!/[<>]/.test(c.glazing.note)); assert.equal(c.frame.glazed, 1); assert.equal(c.surfaces.walls.rho, 0.98);
  assert.equal(c.surfaces.walls.source, 'source'); assert.equal(c.surfaces.floor.preset, 'medium');
  assert.deepEqual(cleanInputs(null), defaultInputs());
  assert.equal(cleanInputs({ sky: 'clear' }).sky, 'clear');
});
test('presets are found by value, otherwise custom', () => {
  assert.equal(presetFor(GLAZING_PRESETS, 0.78), 'double-clear'); assert.equal(presetFor(GLAZING_PRESETS, 0.5), 'custom');
  assert.equal(presetFor(FRAME_PRESETS, 0.85), 'aluminium');
});
test('sheer blinds exist in the studio controls and are accepted by saved projects', () => {
  assert.equal(BLINDS.sheer, 0.55); assert.equal(BLINDS_LABEL.sheer, 'Sheer'); assert.equal(blindsOf('sheer'), 'sheer'); assert.equal(blindsOf('wat'), 'open');
  const raw = JSON.parse(JSON.stringify(PLAN));
  const p = serialiseProject(raw, [], { blinds: 'sheer', glazing: 0.7, daylight: cleanInputs({ sky: 'clear' }), luminaires: [newLuminaire('recessed', 72, 96)] });
  assert.equal(p.lighting.blinds, 'sheer'); assert.equal(p.lighting.luminaires.length, 1);
  assert.equal(parseProject(JSON.stringify(p)).ok, true);
  assert.equal(parseProject({ ...p, lighting: { ...p.lighting, luminaires: [{ type: 'laser', x: 1, y: 1 }] } }).ok, false);
  assert.equal(parseProject({ ...p, lighting: { ...p.lighting, daylight: { sky: 'purple' } } }).ok, false);
  assert.equal(parseProject({ ...p, lighting: { ...p.lighting, luminaires: [{ type: 'recessed', x: 1, y: 1, lm: 1e9 }] } }).ok, false);
});
test('luminaires: sensible defaults per type, bounded and cleaned', () => {
  for (const t of Object.keys(LUM_TYPES)) {
    const l = newLuminaire(t, 50, 60, 108, []);
    assert.equal(l.type, t); assert.ok(l.lm > 0 && l.k >= 1800 && l.beam >= 20); assert.equal(l.source, 'assumed');
  }
  assert.equal(newLuminaire('recessed', 1, 1, 108).z, 107); assert.equal(newLuminaire('pendant', 1, 1, 108).z, 78);
  const strip = newLuminaire('strip', 10, 20); assert.ok(Number.isFinite(strip.x2));
  const ids = new Set(); for (let i = 0; i < 20; i++) ids.add(newLuminaire('floor', 0, 0, 108, [...ids].map((id) => ({ id }))).id); assert.equal(ids.size, 20);
  const c = cleanLuminaires([{ type: 'recessed', x: 1, y: 2, lm: 1e9, k: 10, beam: 1 }, { type: 'bogus', x: 1, y: 1 }, { type: 'floor', x: NaN, y: 1 }, null, { type: 'floor', x: 5, y: 5, id: 'a b<c>' }]);
  assert.equal(c.length, 2); assert.equal(c[0].lm, 12000); assert.equal(c[0].k, 1800); assert.equal(c[0].beam, 20); assert.equal(c[1].id, 'abc');
  assert.equal(cleanLuminaires(new Array(40).fill({ type: 'floor', x: 1, y: 1 })).length, 24);
  assert.deepEqual(cleanLuminaires('x'), []);
  assert.throws(() => validateExtras({ luminaires: [{ type: 'floor', x: 1, y: 1, k: 99999 }] }), /from 1800 to 6500/);
});
test('an isotropic lamp straight overhead follows the inverse-square law', () => {
  const l = { type: 'floor', x: 100, y: 100, z: 100, lm: 1000, k: 2700, beam: 360, on: true };
  const src = sourcesOf(l), h = (100 - 0) * 0.0254;
  near(luxAt(100 * 0.0254, 100 * 0.0254, 0, src), 1000 / (4 * Math.PI) / (h * h), 'E = I / h^2');
  near(luxAt(100 * 0.0254, 100 * 0.0254, 0, sourcesOf({ ...l, lm: 2000 })), 2 * luxAt(100 * 0.0254, 100 * 0.0254, 0, src), 'doubling lumens doubles lux');
  const h2 = (200 - 0) * 0.0254; near(luxAt(100 * 0.0254, 100 * 0.0254, 0, sourcesOf({ ...l, z: 200 })), 1000 / (4 * Math.PI) / (h2 * h2), 'height');
  assert.equal(sourcesOf({ ...l, on: false }).length, 0);
});
test('the lamp distribution integrates back to its lumens', () => {
  // flux through a big horizontal plane below a downlight = lumens (all of its light is in the lower hemisphere)
  for (const beam of [30, 70, 120, 160]) {
    const l = { type: 'recessed', x: 0, y: 0, z: 100, lm: 800, k: 3000, beam, on: true }, src = sourcesOf(l);
    let flux = 0; const a = 0.05, N = 600;
    for (let i = -N; i < N; i++) for (let j = -N; j < N; j++) flux += luxAt((i + 0.5) * a, (j + 0.5) * a, 0, src) * a * a;
    assert.ok(Math.abs(flux / 800 - 1) < 0.03, `beam ${beam}: ${flux}`);
  }
});
test('a narrower beam puts more light straight below and less to the side', () => {
  const mk = (beam) => sourcesOf({ type: 'recessed', x: 0, y: 0, z: 100, lm: 800, k: 3000, beam, on: true });
  assert.ok(luxAt(0, 0, 0, mk(30)) > luxAt(0, 0, 0, mk(120)));
  assert.ok(luxAt(2, 0, 0, mk(30)) < luxAt(2, 0, 0, mk(120)));
  const half = luxAt(100 * 0.0254 * Math.tan(15 * Math.PI / 180) * 1, 0, 0, mk(30)) / luxAt(0, 0, 0, mk(30));
  assert.ok(half > 0.3 && half < 0.9, `${half}`);   // the beam angle is the full angle at half intensity
});
test('a strip splits its lumens along its run', () => {
  const l = newLuminaire('strip', 0, 0); const s = sourcesOf(l);
  assert.equal(s.length, 5); near(s.reduce((a, q) => a + q.cd * 4 * Math.PI, 0) > 0 ? 1 : 0, 1, 'has output');
  assert.ok(s[0].x < s[4].x && s.every((q) => q.y === 0));
});
test('lampGrids lights only the room a lamp stands in, and nothing is invented for an empty room', () => {
  const model = normalisePlan(PLAN);
  const g = lampGrids(model, [{ ...newLuminaire('recessed', 72, 96), id: 'a' }]);
  const living = g.rooms.find((r) => r.room === 'Living'), bed = g.rooms.find((r) => r.room === 'Bedroom');
  assert.ok(living.stats.max > 20 && living.lamps[0] === 'a'); assert.equal(bed.stats.max, 0); assert.equal(bed.lamps.length, 0);
  const peak = living.values.filter((v) => v != null).reduce((a, v) => Math.max(a, v), 0);
  assert.ok(peak < 800 * 4 / (1 * 1) / 4, 'plausible magnitude');
  const work = lampGrids(model, [newLuminaire('recessed', 72, 96)], { plane: 'work' }).rooms[0];
  assert.ok(work.stats.max > living.stats.max, 'closer to the lamp on the work plane');
  assert.equal(lampGrids(model, []).rooms[0].stats.max, 0);
});
test('furniture lamps count in the estimate with their catalogue lumens', () => {
  const items = [{ id: 'f1', kind: 'lamp', x: 40, y: 40, h: 60, elev: 0, name: 'Floor lamp', base: { lamp: 'floor', light: { lm: 1100, k: 2700 } } },
    { id: 'f2', kind: 'sofa', x: 0, y: 0, base: {} }, { id: 'f3', kind: 'lamp', hidden: true, x: 1, y: 1, base: { lamp: 'floor', light: { lm: 1, k: 2700 } } }];
  const f = furnitureLuminaires(items);
  assert.equal(f.length, 1); assert.equal(f[0].lm, 1100); assert.equal(f[0].z, 53); assert.ok(f[0].fromFurniture);
});
test('warm light is redder than cool light', () => {
  const warm = kelvinRgb(2700), cool = kelvinRgb(6500);
  assert.ok(warm[0] >= warm[1] && warm[1] > warm[2]); assert.ok(cool[2] >= 250); assert.ok(warm[2] < cool[2]);
});
test('daylight grids come from window skylines, skip rooms without windows and need an orientation', () => {
  const model = normalisePlan(PLAN), open = { prof: new Float64Array(720) };
  const g = daylightGrids(model, [open], { vt: 0.7, inputs: defaultInputs(), blinds: 1 });
  assert.equal(g.rooms.length, 1); assert.equal(g.rooms[0].room, 'Living'); assert.deepEqual(g.skipped, [{ room: 'Bedroom', reason: 'no window' }]);
  assert.ok(g.rooms[0].stats.max > g.rooms[0].stats.min && g.rooms[0].stats.mean > 0.5);
  const lo = daylightGrids(model, [{ prof: new Float64Array(720).fill(50) }], { vt: 0.7, inputs: defaultInputs(), blinds: 1 }).rooms[0].stats.mean;
  assert.ok(lo < g.rooms[0].stats.mean / 2, 'a skyline at 50 degrees takes most of it');
  assert.equal(daylightGrids(normalisePlan({ ...PLAN, up_bearing: undefined }), [open], { vt: 0.7, inputs: defaultInputs(), blinds: 1 }).rooms.length, 0);
  assert.equal(daylightGrids(model, [null], { vt: 0.7, inputs: defaultInputs(), blinds: 1 }).skipped[0].reason, 'no skyline for its windows');
  assert.ok(shareAbove(g.rooms[0].values, 0) === 1 && shareAbove(g.rooms[0].values, 1e9) === 0);
});
