// The measured height in the scenario address (unit/scenario.js) and the anchor list HTML (unit/anchor-view.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../../', import.meta.url);
const fx = JSON.parse(fs.readFileSync(new URL('tests/fixtures/model_anchor.json', root)));
const S = await import(new URL('dashboard/js/sun.js', root));
const C = await import(new URL('dashboard/js/unit/calibration.js', root));
const A = await import(new URL('dashboard/js/unit/anchor.js', root));
const SC = await import(new URL('dashboard/js/unit/scenario.js', root));

test('a measured height travels in the scenario address; an invalid one rejects the whole scenario', () => {
  const faces = [{ i: 2, shared: false }], look = { fov: 70, yaw: 0, pitch: 6 };
  const state = { id: 'unit-a', face: 0, t: 0.5, az: 118, floor: 24, cmp: 30, date: '2026-10-15', manual: {}, cal: { kind: 'slab', value: 80.5, floor: 24, spread: 'offset' } };
  const q = SC.writeScenario(new URLSearchParams(), state, faces[0], look, true);
  assert.equal(q.get('cal'), 'slab:80.5:24:offset');
  assert.deepEqual(SC.readScenario(q, 'unit-a', faces, 60).cal, state.cal);
  assert.equal(SC.writeScenario(new URLSearchParams(), { ...state, cal: undefined }, faces[0], look, true).has('cal'), false);
  for (const bad of ['slab:80.5:24', 'slab:x:24:scale', 'eye:900:24:scale', 'floor:1:2:scale']) {
    const bq = SC.writeScenario(new URLSearchParams(), state, faces[0], look, true); bq.set('cal', bad);
    assert.equal(SC.readScenario(bq, 'unit-a', faces, 60), null, bad);
  }
  SC.clearScenario(q); assert.equal(q.has('cal'), false);
  assert.deepEqual(SC.readScenarioExtras(new URLSearchParams('cal=eye:37.6:10:scale')), { cal: { kind: 'eye', value: 37.6, floor: 10, spread: 'scale' } });
});

test('the anchor list is a valid definition list and marks every fact', async () => {
  const View = await import(new URL('dashboard/js/unit/anchor-view.js', root));
  const B = S.prepBuildings(fx.site.b, fx.site.holes || null), T = B[fx.site.target], face = S.facesOf(T, 8, B).find((f) => Math.round(f.bearing) === 180);
  const rec = A.buildAnchor({ site: fx.site, siteId: 'syn', B, T, face, t: 0.5, az: face.bearing, floor: 8, cal: C.resolveCal({ base: 0, fhEst: 3.2 }, { kind: 'slab', value: 25, floor: 8, spread: 'scale' }), prov: { exposure: 'listing', position: 'manual', floor: 'listing' } });
  const html = View.anchorListHTML(rec);
  assert.match(html, /<h4 class="mp-sec-t">Origin<\/h4><dl><div><dt>/);
  assert.ok(!/<dl>(?!<div>)/.test(html), 'a dl holds only div groups of dt and dd');
  for (const label of ['Source', 'Measured', 'Your setting', 'Assumed']) assert.ok(html.includes(`>${label}<`), label);
});
