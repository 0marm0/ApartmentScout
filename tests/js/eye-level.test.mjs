// The eye-level look, the pure parts: no plan in the example draws a horizontal bar across a window (unless it asks for a transom, and none does),
// the plan names its floor finish (the real floor of the unit, read from its photos) and the project format carries it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
const W = await import(new URL('../../dashboard/js/room3d/windows-core.js', import.meta.url));
const M = await import(new URL('../../dashboard/js/plan/model.js', import.meta.url));
const P = await import(new URL('../../dashboard/js/plan/project.js', import.meta.url));
const dir = new URL('../../dashboard/data/plans/', import.meta.url);
const plans = readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => [f, JSON.parse(readFileSync(new URL(f, dir), 'utf8'))]);

test('no window of any example plan has a transom or a horizontal bar between its sill and its head', () => {
  assert.ok(plans.length >= 8);
  for (const [name, raw] of plans) {
    const model = M.normalisePlan(raw);
    assert.ok(model.windows.length, name);
    for (const w of model.windows) {
      assert.equal(w.transom ?? null, null, `${name}: window with a transom`);
      const lay = W.windowLayout(w);
      assert.equal(lay.rails.length, 2, `${name}: rails`);
      assert.deepEqual(lay.rails.map((r) => r.z), [w.sill, w.head - W.FRAME.member], name);   // only the frame's own sill and head member
      assert.ok(lay.glass.every((g) => g.z0 === w.sill && g.z1 === w.head), `${name}: the glass runs sill to head in one piece`);
    }
  }
});

test('even a plan that asks for a transom keeps it out of a window that is not tall enough for one', () => {
  assert.equal(W.windowLayout({ len: 60, sill: 20, head: 94, transom: 21 }).rails.length, 2);
  assert.equal(W.windowLayout({ len: 60, sill: 20, head: 94, transom: 93 }).rails.length, 2);
});

test('Paramount Tower 25E names its floor finish: honey basket-weave parquet in every dry room', () => {
  const model = M.normalisePlan(JSON.parse(readFileSync(new URL('paramount-tower-25e.json', dir), 'utf8')));
  assert.equal(model.floor_finish, 'basket');
  assert.equal(M.normalisePlan({ ...JSON.parse(readFileSync(new URL('paramount-tower-25e.json', dir), 'utf8')), floor_finish: 'lava' }).floor_finish, null, 'an unknown finish is ignored');
  assert.equal(M.normalisePlan(JSON.parse(readFileSync(new URL('emerald-green-1211.json', dir), 'utf8'))).floor_finish, null, 'a plan that names none keeps the room-type defaults');
});

test('a project carries the floor finish and refuses an unknown one', () => {
  const raw = JSON.parse(readFileSync(new URL('paramount-tower-25e.json', dir), 'utf8'));
  const items = M.normalisePlan(raw).layouts[0]?.items || [];
  const out = P.serialiseProject(raw, items, {});
  assert.equal(out.plan.floor_finish, 'basket');
  assert.throws(() => P.serialiseProject({ ...raw, floor_finish: 'lava' }, items, {}), /Floor finish/);
});
