// The scenario comparison board's numbers (unit/compare-core.js), the exportable model project (unit/model-project.js)
// and the plan placement that follows the shared anchor (plan/city.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../../', import.meta.url);
const fx = JSON.parse(fs.readFileSync(new URL('tests/fixtures/model_anchor.json', root)));
const S = await import(new URL('dashboard/js/sun.js', root));
const K = await import(new URL('dashboard/js/unit/compare-core.js', root));
const MP = await import(new URL('dashboard/js/unit/model-project.js', root));
const P = await import(new URL('dashboard/js/unit/parts.js', root));
const City = await import(new URL('dashboard/js/plan/city.js', root));
const { normalisePlan } = await import(new URL('dashboard/js/plan/model.js', root));
const { serialiseProject } = await import(new URL('dashboard/js/plan/project.js', root));

const prep = (comps = null) => S.prepBuildings(fx.site.b, fx.site.holes || null, comps);
const site = { ...fx.site, generated: '2026-10-14', source: 'synthetic', listing: { id: 'syn-1' } };
function envFor(withAssumed = true) {
  const Bs = prep(), faces = S.facesOf(Bs[site.target], 8, Bs);
  return { site, faces, B: { source: Bs, assumed: withAssumed ? prep(P.mergeParts(null, fx.assumed_components, site.target)) : null }, FUTB: [], ti: site.target, geo: { base: 0, fhEst: 3.2 }, baseCal: null, panes: S.BAY, lat: 40.7549, lon: -73.984, tz: 'America/New_York', fraction: S.SUNSHINE.nyc.fraction, maxFloor: 18 };
}
const baseState = (env, extra = {}) => { const fi = env.faces.findIndex((f) => Math.round(f.bearing) === 180); return { date: '2026-10-15', min: 780, floor: 5, face: fi, t: 0.5, az: 180, bay: false, future: false, parts: 'source', faceBearings: env.faces.map((f) => f.bearing), ...extra }; };

test('winter and summer differ, identical assumptions otherwise, deltas are against the first scenario', () => {
  const env = envFor(), base = baseState(env), specs = K.presetSpecs('seasons2', base, env).map((s) => K.normaliseSpec(s, env));
  assert.deepEqual(specs.map((s) => s.date), ['2026-12-21', '2026-06-21']);
  const res = K.evaluateAll(base, specs, env);
  assert.equal(res.length, 2); assert.deepEqual(res.map((r) => r.label), ['Dec 21', 'Jun 21']);
  assert.ok(res.every((r) => r.changes.length === 1 && r.changes[0] === 'date'));
  assert.equal(res[0].metrics.sky_view, res[1].metrics.sky_view, 'sky view does not depend on the date');
  assert.notEqual(res[0].metrics.day_min, res[1].metrics.day_min);
  const rows = K.deltaRows(res), day = rows.find((r) => r.key === 'day_min');
  assert.equal(day.cells[0].delta, null); assert.equal(day.cells[1].delta, res[1].metrics.day_min - res[0].metrics.day_min);
  const shared = Object.fromEntries(K.sharedAssumptions(base, res, env));
  assert.ok(!('Date' in shared) && shared.Floor === '5' && shared.Facade.includes('180'));
});

test('floors, facades and proposed buildings are scenarios too, at most four', () => {
  const env = envFor(), base = baseState(env);
  const floors = K.presetSpecs('floors', base, env);
  assert.ok(floors.length >= 2 && floors.length <= 4);
  const res = K.evaluateAll(base, floors.map((s) => K.normaliseSpec(s, env)), env);
  const sky = res.map((r) => r.metrics.sky_view);
  assert.ok(sky.some((v, i) => i && v !== sky[0]), 'a higher floor sees more sky');
  const faces = K.presetSpecs('facades', base, env);
  assert.ok(faces.length >= 2 && faces.length <= 4 && faces[0].face === base.face);
  assert.deepEqual(K.presetSpecs('proposed', base, env).map((s) => [s.future, s.label]), [[false, 'Without proposed'], [true, 'With proposed']]);
  assert.deepEqual(floors.map((s) => s.label), floors.map((s) => `Floor ${s.floor}`)); assert.match(faces[0].label, /^[A-Z]+ facade \d+°$/);
  assert.equal(K.normaliseSpec({ floor: 99 }, env), null); assert.equal(K.normaliseSpec({ date: '2026-13-40' }, env), null);
  assert.equal(K.normaliseSpec({ parts: 'assumed' }, envFor(false)), null, 'no assumed parts to compare against');
  assert.equal(K.normaliseSpec({ face: 99 }, env), null); assert.equal(K.normaliseSpec({ cal: { kind: 'slab', value: 9999, floor: 3 } }, env), null);
});

test('assumed building parts against the source geometry change the numbers', () => {
  const env = envFor(), base = baseState(env), res = K.evaluateAll(base, K.presetSpecs('parts', base, env).map((s) => K.normaliseSpec(s, env)), env);
  assert.ok(res[1].metrics.year_possible_h > res[0].metrics.year_possible_h + 5);
  assert.ok(res[1].metrics.sky_view > res[0].metrics.sky_view);
  assert.equal(res[1].label, 'Assumed building parts');
});

test('a measured height is a scenario: it lifts the window over a neighbour that the floor count does not', () => {
  const env = envFor(), base = baseState(env, { floor: 6 });
  const res = K.evaluateAll(base, [{}, { cal: { kind: 'slab', value: 30, floor: 6, spread: 'scale' } }].map((s) => K.normaliseSpec(s, env)), env);
  assert.equal(res[0].metrics.datum, 'estimated'); assert.equal(res[1].metrics.datum, 'measured');
  assert.ok(res[1].metrics.eye_m > res[0].metrics.eye_m); assert.ok(res[1].metrics.year_possible_h >= res[0].metrics.year_possible_h);
});

test('a window that is not in open air is withheld, never computed', () => {
  const env = envFor(), base = baseState(env), res = K.evaluateAll(base, [{}, { az: 0 }].map((s) => K.normaliseSpec(s, env)), env);
  assert.equal(res[0].metrics.withheld, false); assert.equal(res[1].metrics.withheld, true);
  assert.match(res[1].metrics.reason, /inside its own building/); assert.ok(!('day_min' in res[1].metrics));
  assert.equal(K.deltaRows(res).find((r) => r.key === 'day_min').cells[1].withheld, true);
});

test('the receipt records inputs, shared assumptions, per-scenario state and metrics, deltas and method', () => {
  const env = envFor(), base = baseState(env), specs = K.presetSpecs('seasons4', base, env).map((s) => K.normaliseSpec(s, env));
  assert.equal(specs.length, 4);
  const res = K.evaluateAll(base, specs, env), rc = K.buildReceipt({ siteId: 'syn-1', site, base, results: res, env, camera: { kind: 'window', yaw: 0, pitch: 6, fov: 70 }, created: 't' });
  assert.equal(rc.kind, 'apartmentscout-compare-receipt'); assert.equal(rc.scenarios.length, 4); assert.equal(rc.reference, 's1');
  assert.equal(rc.camera.note, 'one fixed camera for every panel'); assert.ok(rc.deltas.every((d) => d.values.length === 4 && d.delta_vs_first[0] === null));
  assert.match(rc.method, /not lux/); assert.deepEqual(JSON.parse(JSON.stringify(rc)), rc);
  assert.equal(rc.shared.Floor, '5'); assert.equal(rc.datum.state, 'estimated');
});

// ------------------------------------------------------------------ the model project

const planRaw = { schema: 2, id: 'syn-1', title: 'Syn 1', units: 'ft', ceiling: 9, wall: 0.4, up_bearing: 180, floor: 5, rooms: [{ name: 'Room', kind: 'living', x: 0, y: 0, w: 12, h: 14 }], windows: [{ room: 'Room', x1: 2, y1: 14, x2: 10, y2: 14, sill: 2, head: 7 }] };
function project(extra = {}) {
  return MP.buildModelProject({ siteId: 'syn-1', base: 'data', site, anchor: { kind: 'apartmentscout-model-anchor' }, pin: { face: 1, t: 0.5, az: 180, floor: 5, bay: false, cal: null }, cal: { measured: { kind: 'slab', value_m: 30, floor: 6, spread: 'scale' } },
    parts: { 0: fx.assumed_components['0'] }, plan: { id: 'syn-1', source: 'local scenario', label: 'My edits', saved: '2026-10-14', project: serialiseProject(planRaw, [{ id: 'bed-1', ref: 'queen-bed', x: 80, y: 80, rot: 0 }], { directSun: true, ambient: 1 }) },
    scenarios: [{ label: 'Dec', date: '2026-12-21' }], edits: [{ index: 2, h: 40 }], view: { date: '2026-10-15', min: 780, mode: 'inside' }, created: '2026-10-14T00:00:00Z', ...extra });
}

test('a project round-trips through JSON and restores every part offline', () => {
  const out = MP.parseModelProject(JSON.stringify(project()));
  assert.ok(out.ok, out.error); const p = out.project;
  assert.equal(p.siteId, 'syn-1'); assert.equal(p.site.b.length, 3); assert.equal(p.site.target, 1);
  assert.deepEqual(p.pin, { face: 1, t: 0.5, az: 180, floor: 5, bay: false, cal: null });
  assert.deepEqual(p.cal, { kind: 'slab', value: 30, floor: 6, spread: 'scale' });
  assert.deepEqual(Object.keys(p.parts), ['0']); assert.equal(p.parts['0'][1].confidence, 'assumed');
  assert.equal(p.plan.source, 'local scenario'); assert.equal(p.plan.project.layout.items?.length ?? p.plan.project.layout.items.length, 1);
  assert.deepEqual(p.edits, [{ index: 2, h: 40 }]); assert.equal(p.scenarios[0].date, '2026-12-21'); assert.equal(p.view.mode, 'inside');
  assert.equal(out.warnings.length, 0); assert.equal(p.receipts.datasets, 0);
});

test('a bad project is refused with a reason and changes nothing', () => {
  const ok = JSON.parse(JSON.stringify(project()));
  const cases = [
    [{ ...ok, kind: 'something-else' }, /not an ApartmentScout model project/],
    [{ ...ok, schema: 7 }, /Unsupported project version 7/],
    [{ ...ok, site: { ...ok.site, id: 'bad id!' } }, /usable site id/],
    [{ ...ok, site: { ...ok.site, data: { ...ok.site.data, b: [] } } }, /no buildings/],
    [{ ...ok, site: { ...ok.site, data: { ...ok.site.data, b: [[1, 2, 3, [1, 2, 3]]] } } }, /malformed/],
    [{ ...ok, site: { ...ok.site, data: { ...ok.site.data, target: 9 } } }, /valid target/],
    [{ ...ok, site: { ...ok.site, data: { ...ok.site.data, origin: { lat: 200, lon: 0 } } } }, /valid origin/],
    [{ ...ok, site: { ...ok.site, data: { ...ok.site.data, listing: { id: 'other-id' } } } }, /does not match/],
    [{ ...ok, site: { ...ok.site, data: { ...ok.site.data, components: { 0: [{ ring: [[0, 0]], top_m: 5, source: 'x' }] } } } }, /components are invalid/],
  ];
  for (const [obj, re] of cases) { const r = MP.parseModelProject(JSON.stringify(obj)); assert.equal(r.ok, false); assert.match(r.error, re); }
  assert.equal(MP.parseModelProject('{nope').ok, false);
  assert.equal(MP.parseModelProject('{"kind":"apartmentscout-model-project","schema":1,"x":1e999}').ok, false);
  assert.match(MP.parseModelProject('{"__proto__":{"x":1},"kind":"apartmentscout-model-project","schema":1}').error, /unsafe key/);
});

test('damaged optional sections are dropped with a warning, the rest still restores', () => {
  const o = JSON.parse(JSON.stringify(project()));
  o.pin = { face: 1, t: 9, az: 180, floor: 5 }; o.calibration = { measured: { kind: 'slab', value_m: -3, floor: 2 } }; o.assumed_parts = { 0: [{ ring: [[0, 0]], top_m: 2, source: 'x' }] };
  o.plan.project.plan.rooms = []; o.edits = [{ index: 1, h: 10 }, { index: 2, h: -4 }, { index: 7, h: 3 }, { index: 2, h: 30 }]; o.scenarios = [1, null, { date: '2026-12-21' }];
  const r = MP.parseModelProject(o);
  assert.ok(r.ok); assert.equal(r.project.pin, null); assert.equal(r.project.cal, null); assert.equal(r.project.parts, null); assert.equal(r.project.plan, null);
  assert.deepEqual(r.project.edits, [{ index: 2, h: 30 }], 'the target, negative and unknown buildings are ignored');
  assert.equal(r.project.scenarios.length, 1); assert.equal(r.warnings.length, 4);
});

test('an embedded GLB is carried as base64 and comes back byte for byte', async () => {
  const bytes = new Uint8Array(70000).map((_, i) => (i * 31) % 251), b64 = MP.bytesToBase64(bytes.buffer);
  const r = MP.parseModelProject(project({ glb: { data: b64, bytes: bytes.length, sha256: await MP.sha256Hex(bytes) } }));
  assert.ok(r.ok); assert.deepEqual(MP.base64ToBytes(r.project.glb.data), bytes);
  assert.equal(r.project.glb.sha256, await MP.sha256Hex(bytes)); assert.equal(await MP.sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  const noisy = JSON.parse(JSON.stringify(project({ glb: { data: 'AAAA', bytes: 3 } }))); noisy.glb.data = 'AA<script>';
  assert.equal(MP.parseModelProject(noisy).project.glb, null);
});

// ------------------------------------------------------------------ the plan follows the pinned anchor

const plan = normalisePlan(planRaw);
const synSite = { version: 2, target: 1, listing: { id: 'syn-1' }, b: fx.site.b, faces: [], floor_height_m: 3.2, window: { face: null, t: 0.5 } };

test('placePlan follows a pinned facade, position, facing and measured height; unpinned it follows the site', () => {
  const free = City.placePlan(synSite, plan, 5);
  assert.equal(free.pinned, false); assert.equal(Math.round(free.az), 180); near(free.slab, 4 * 3.2);
  const pinned = City.placePlan(synSite, plan, 5, { anchor: { face: free.face.i, t: 0.3, az: 175, cal: { kind: 'slab', value: 20, floor: 5, spread: 'scale' } } });
  assert.equal(pinned.pinned, true); near(pinned.t, 0.3); near(pinned.az, 175); near(pinned.slab, 20); near(pinned.cal.fh, 5);
  assert.ok(Math.hypot(pinned.anchor[0] - free.anchor[0], pinned.anchor[1] - free.anchor[1]) > 1, 'the plan moved along the facade');
  const stale = City.placePlan(synSite, plan, 5, { anchor: { face: 999, t: 0.3, az: 10 } });
  assert.equal(stale.pinned, false, 'a pin for a facade this site does not have is ignored');
  const keep = City.placePlan(synSite, plan, 5, { anchor: { face: free.face.i, t: 0.5, az: 180 } });
  near(keep.slab, 4 * 3.2); near(keep.anchor[0], free.anchor[0]); near(keep.anchor[1], free.anchor[1]);
});

test('placePlan and the sun maths use the same assumed parts', () => {
  const asm = City.placePlan(synSite, plan, 5, { parts: P.mergeParts(null, fx.assumed_components, 1) }), src = City.placePlan(synSite, plan, 5, { parts: null });
  assert.ok(asm.B[0].parts && !src.B[0].parts);
  const a = City.windowSkylines(asm, plan), b = City.windowSkylines(src, plan);
  assert.ok(Math.max(...a[0].prof) <= Math.max(...b[0].prof));
});

test('a plan window that maps into the host is withheld, not given the host-free skyline', () => {
  const wide = normalisePlan({ ...planRaw, rooms: [{ name: 'Wide', kind: 'living', x: 0, y: 0, w: 60, h: 14 }], windows: [{ room: 'Wide', x1: 2, y1: 14, x2: 8, y2: 14, sill: 2, head: 7 }, { room: 'Wide', x1: 0, y1: 4, x2: 0, y2: 10, sill: 2, head: 7 }] });
  const ctx = City.placePlan(synSite, wide, 5), sk = City.windowSkylines(ctx, wide);
  assert.equal(sk[0].air.ok, true); assert.equal(City.windowWithheld(sk, 0), false);
  assert.equal(sk[1].air.ok, false, 'the side window lands in the host or the neighbour'); assert.equal(City.windowWithheld(sk, 1), true);
  assert.equal(City.windowBlocked(sk, 1, { az: 180, alt: 60 }), true, 'no sun is established through a window outside open air');
  assert.equal(City.windowMinutes(sk, wide, 2026, 5, 21, 40.75, -73.98, 'America/New_York')[1], null);
});
function near(a, b, tol = 0.011) { assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`); }
