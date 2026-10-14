import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalisePlan } from '../../dashboard/js/plan/model.js';
import { editFixture, editWindow, editOrientation } from '../../dashboard/js/plan/architecture.js';

const source = () => ({ schema: 2, id: 'unit', units: 'ft', ceiling: 9, source: 'Original printed plan', provenance: { match: 'exact-unit', checked: '2026-10-13', estimated: ['Closet position'] }, rooms: [{ x: 0, y: 0, w: 20, h: 20 }], fixtures: [{ kind: 'ac', x: 2, y: 3, w: 4, h: 1, height: 2, reserve: 1.5, est: false, note: 'Broker location, no size measurement' }], windows: [{ x1: 2, y1: 20, x2: 8, y2: 20, sill: 2, head: 7 }] });

test('inch fixture edits retain source units, provenance and source without mutation', () => {
  const raw = source(), before = structuredClone(raw);
  const out = editFixture(raw, 0, { width: 60, depth: 18, height: 30, reserve: 0, x: 36, y: 48 });
  assert.deepEqual(raw, before);
  assert.deepEqual([out.fixtures[0].x, out.fixtures[0].y, out.fixtures[0].w, out.fixtures[0].h, out.fixtures[0].height, out.fixtures[0].reserve], [3, 4, 5, 1.5, 2.5, 0]);
  assert.equal(out.fixtures[0].est, true);
  assert.equal(out.source, before.source);
  assert.equal(out.fixtures[0].note, before.fixtures[0].note);
  assert.equal(out.provenance.match, 'exact-unit');
  assert.equal(out.provenance.checked, '2026-10-13');
  assert.match(out.provenance.estimated.at(-1), /not measured/);
});

test('polygon fixtures retain their shape while scaling and translating', () => {
  const raw = source(); raw.fixtures = [{ kind: 'counter', poly: [[1, 1], [3, 1], [3, 2], [2, 2], [2, 3], [1, 3]] }];
  const out = editFixture(raw, 0, { width: 48, depth: 12, x: 24, y: 36 });
  assert.deepEqual(out.fixtures[0].poly, [[2, 3], [6, 3], [6, 3.5], [4, 3.5], [4, 4], [2, 4]]);
  assert.equal(raw.fixtures[0].poly[0][0], 1);
});

test('window widths retain endpoint anchor and direction, and explicit vertical dimensions', () => {
  const raw = source(); raw.windows = [{ a: [2, 2], b: [5, 6], sill: 2, head: 7 }];
  const out = editWindow(raw, 0, { width: 120, sill: 0, head: 96 });
  assert.deepEqual(out.windows[0].a, [2, 2]);
  assert.deepEqual(out.windows[0].b, [8, 10]);
  assert.equal(out.windows[0].sill, 0);
  assert.equal(out.windows[0].head, 8);
  assert.deepEqual(raw.windows[0].b, [5, 6]);
  const coord = editWindow(source(), 0, { width: 36 });
  assert.deepEqual([coord.windows[0].x1, coord.windows[0].x2], [2, 5]);
});

test('orientation edits create a separate assumption and update normalized window bearing', () => {
  const raw = source(), out = editOrientation(raw, 235);
  assert.equal(raw.up_bearing, undefined);
  assert.equal(normalisePlan(out).windows[0].bearing, 235);
  assert.match(out.provenance.estimated.at(-1), /Orientation.*not measured/);
});

test('edits fail before mutation on malformed dimensions, opening heights and limits', () => {
  const raw = source(), before = structuredClone(raw);
  for (const value of [0, -1, NaN, Infinity, '36', 5001]) assert.throws(() => editFixture(raw, 0, { width: value }));
  for (const changes of [{ sill: 84, head: 84 }, { head: 109 }, { width: 0 }, { sill: -1 }, { width: 5001 }]) assert.throws(() => editWindow(raw, 0, changes));
  assert.throws(() => editFixture(raw, 0, { height: 109 }));
  assert.throws(() => editFixture(raw, 0, { reserve: -1 }));
  assert.throws(() => editFixture(raw, 3, { width: 20 }));
  assert.throws(() => editFixture(raw, 0, { measured: true }));
  for (const value of [360, -1, NaN, '90']) assert.throws(() => editOrientation(raw, value));
  assert.deepEqual(raw, before);
});

test('metres and inches produce the same physical edited dimensions', () => {
  for (const units of ['in', 'm']) {
    const raw = { schema: 2, id: 'unit', units, rooms: [{ x: 0, y: 0, w: units === 'in' ? 240 : 6.096, h: units === 'in' ? 240 : 6.096 }], fixtures: [{ kind: 'ac', x: 0, y: 0, w: 1, h: 1 }] };
    const out = editFixture(raw, 0, { width: 48, depth: 12, reserve: 18 });
    const f = normalisePlan(out).fixtures[0];
    assert.ok(Math.abs(Math.max(...f.poly.map(p => p[0])) - 48) < 1e-8);
    assert.ok(Math.abs(f.reserve - 18) < 1e-8);
  }
});
