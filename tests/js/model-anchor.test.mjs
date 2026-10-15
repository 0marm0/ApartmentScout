// The shared model anchor (dashboard/js/unit/{anchor,calibration,parts,openair}.js) agrees with the Python model
// (apartmentscout/geo/anchor.py): tests/fixtures/model_anchor.json is written by tests/test_anchor.py.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../../', import.meta.url);
const fx = JSON.parse(fs.readFileSync(new URL('tests/fixtures/model_anchor.json', root)));
const S = await import(new URL('dashboard/js/sun.js', root));
const C = await import(new URL('dashboard/js/unit/calibration.js', root));
const P = await import(new URL('dashboard/js/unit/parts.js', root));
const O = await import(new URL('dashboard/js/unit/openair.js', root));
const A = await import(new URL('dashboard/js/unit/anchor.js', root));
const near = (a, b, msg, tol = 0.011) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
const prep = (comps = null) => S.prepBuildings(fx.site.b, fx.site.holes || null, comps);

test('vertical calibration matches Python, estimate and measurement side by side', () => {
  for (const c of fx.calibration) {
    const measured = c.slab != null ? { kind: 'slab', value: c.slab, floor: c.floor, spread: c.spread } : c.eye != null ? { kind: 'eye', value: c.eye, floor: c.floor, spread: c.spread } : null;
    const cal = C.resolveCal({ base: 0, fhEst: 3.2 }, measured), d = C.describeCal(cal, c.floor);
    for (const k of ['state', 'ground_m', 'slab_m', 'eye_m', 'estimated_slab_m', 'delta_m', 'floor_height_m', 'estimated_floor_height_m']) {
      if (typeof c.cal[k] === 'number') near(d[k], c.cal[k], `${k} ${JSON.stringify(measured)}`, 0.002); else assert.equal(d[k], c.cal[k], k);
    }
    assert.deepEqual(d.measured && { kind: d.measured.kind, floor: d.measured.floor, spread: d.measured.spread }, c.cal.measured && { kind: c.cal.measured.kind, floor: c.cal.measured.floor, spread: c.cal.measured.spread });
    for (const [f, v] of Object.entries(c.slab_at)) near(cal.slabAt(+f), v, `slab_at floor ${f}`, 0.002);
  }
});

test('a measured height never overwrites the estimate and the max floor follows the datum', () => {
  const geo = { base: 0, fhEst: 3.2 };
  const est = C.resolveCal(geo, null), meas = C.resolveCal(geo, { kind: 'slab', value: 36, floor: 10, spread: 'scale' });
  assert.equal(est.state, 'estimated'); assert.equal(meas.state, 'measured');
  near(meas.estimateAt(10), 28.8, 'estimate kept'); near(meas.slabAt(10), 36, 'measured used');
  assert.equal(est.maxFloor(160), 50); assert.equal(meas.maxFloor(160), Math.floor(160 / 4));
  assert.equal(C.resolveCal(geo, { kind: 'eye', value: 37.6, floor: 10, spread: 'scale' }).slabAt(10), 36);
  assert.equal(C.resolveCal(geo, { kind: 'slab', value: -2, floor: 3 }).state, 'estimated');     // impossible values are refused, not clamped
  assert.equal(C.resolveCal(geo, { kind: 'slab', value: 36, floor: 0 }).state, 'estimated');
  assert.equal(C.resolveCal({ base: 0, fhEst: 3.2, lobby: 4 }, null).state, 'assumed');
});

test('calibration travels in the page address and in an export, and a bad one is refused', () => {
  const m = { kind: 'slab', value: 80.1, floor: 24, spread: 'offset' };
  assert.deepEqual(C.calFromParam(C.calToParam(m)), m);
  for (const bad of ['', 'slab:80:24', 'slab:x:24:scale', 'eye:900:24:scale', 'wall:10:3:scale', 'slab:10:0:scale', 'slab:10:3:']) assert.equal(C.calFromParam(bad), null, bad);
  const cal = C.resolveCal({ base: 0, fhEst: 3.08 }, m), ex = C.exportCalibration(cal, { site: 'x', floor: 24, generated: 't' });
  assert.equal(ex.kind, 'apartmentscout-vertical-calibration'); near(ex.estimated_slab_m, 70.84, 'estimate'); near(ex.slab_m, 80.1, 'slab'); assert.ok(ex.drives.some((x) => /city shadows/.test(x)));
  assert.deepEqual(C.parseCalibration(JSON.parse(JSON.stringify(ex))), m);
  assert.equal(C.measuredFromSite({ calibration: { measured: { kind: 'eye', value_m: 37.6, floor: 10, spread: 'scale' } } }).kind, 'eye');
  assert.equal(C.measuredFromSite({ slab_m: 70, window: { floor: 24 } }).floor, 24);
});

test('solid_at is height aware, with and without components', () => {
  const Bf = prep(), Bc = prep(fx.assumed_components);
  fx.probes.points.forEach((p, k) => {
    assert.equal(O.solidAt(Bf, ...p), fx.probes.full[k], `full prism at ${p}`);
    assert.equal(O.solidAt(Bc, ...p), fx.probes.components[k], `components at ${p}`);
  });
});

test('window open-air checks match Python (host, neighbour, height)', () => {
  const Bf = prep(), faces = S.facesOf(Bf[fx.site.target], 8, Bf);
  for (const c of fx.windows) {
    const B = c.components ? prep(c.components) : Bf, ti = c.components ? 0 : fx.site.target;
    const face = c.lot || faces.find((f) => f.i === c.face), [fx0, fy0] = O.facadePoint(face, c.t);
    const r = O.windowOpenAir(B, ti, fx0, fy0, c.bearing ?? face.bearing, c.z[0], c.z[1]);
    assert.deepEqual(r, c.result, c.name);
  }
});

test('a window pushed into the host is flagged, not skipped', () => {
  const B = prep(), face = S.facesOf(B[1], 8, B).find((f) => Math.round(f.bearing) === 180), [x, y] = O.facadePoint(face, 0.5);
  assert.equal(O.windowOpenAir(B, 1, x, y, 0, 10, 12).reason, 'host');
  assert.match(O.airReason({ ok: false, reason: 'host' }), /inside its own building/);
  assert.match(O.airReason({ ok: false, reason: 'neighbour', building: 2 }, () => 'the Annex'), /the Annex/);
  assert.equal(O.airReason({ ok: true }), '');
});

test('the podium-and-tower preset matches Python', () => {
  const B = prep(), pt = fx.podium_tower, parts = P.podiumTower(B[0], pt);
  assert.equal(parts.length, 2);
  parts.forEach((q, i) => {
    const e = pt.parts[i];
    assert.equal(q.kind, e.kind); near(q.base_m, e.base_m, 'base'); near(q.top_m, e.top_m, 'top'); assert.equal(q.source, e.source); assert.equal(q.confidence, 'assumed');
    assert.equal(q.ring.length, e.ring.length);
    q.ring.forEach((p, k) => { near(p[0], e.ring[k][0], 'x'); near(p[1], e.ring[k][1], 'y'); });
  });
  assert.throws(() => P.podiumTower(B[0], { podium_m: 20, setback_m: 60, out_deg: 0 }), /no tower/);
  assert.throws(() => P.podiumTower(B[0], { podium_m: 200, setback_m: 5, out_deg: 0 }), /between 0 and the 100 m roof/);
  assert.throws(() => P.podiumTower(B[0], { podium_m: 20, setback_m: -1, out_deg: 0 }), /negative/);
});

test('component validation names every problem and repairs nothing', () => {
  const good = { ring: [[0, 0], [10, 0], [10, 10]], base_m: 0, top_m: 20, kind: 'podium', source: 'zoning diagram' };
  const { map, problems } = P.validateParts({ 0: [good, { ...good, source: '' }, { ...good, top_m: 0 }, { ...good, ring: [[0, 0]] }, { ...good, top_m: 1e6 }, 'x'], 99: [good], zz: [good], 1: [] }, 3);
  assert.equal(map[0].length, 1); assert.equal(map[0][0].confidence, 'assumed'); assert.deepEqual(Object.keys(map), ['0']);
  assert.equal(problems.length, 8); assert.ok(problems.some((p) => /source is required/.test(p)) && problems.some((p) => /no such building/.test(p)));
  assert.deepEqual(Object.keys(P.validateParts([good]).map), ['target']);
  assert.ok(P.validateParts('nope').problems.length);
  assert.deepEqual(P.validateParts(JSON.parse('{"__proto__":[1]}')).map, {});
});

test('an assumed podium and tower changes the sun hours and sky view against the full-footprint tower', () => {
  const Bf = prep(), Ba = prep(P.mergeParts(null, fx.assumed_components, fx.site.target));
  const face = S.facesOf(Bf[1], 8, Bf).find((f) => Math.round(f.bearing) === 180), tz = 'America/New_York';
  const w = O.windowPoint(face, 0.5, 4 * 3.2);
  const hours = (B) => Array.from({ length: 12 }, (_, m) => S.litInfo(S.dayTable(2026, m, 15, 40.7549, -73.984, tz, 6), S.horizonProfile(B, w.x, w.y, w.z), 180, 6).min / 60);
  const full = hours(Bf), split = hours(Ba);
  near(full.reduce((a, b) => a + b), fx.sun.full.hours.reduce((a, b) => a + b), 'full prism year hours vs Python', 0.1);
  near(split.reduce((a, b) => a + b), fx.sun.assumed.hours.reduce((a, b) => a + b), 'assumed parts year hours vs Python', 0.1);
  assert.ok(split.reduce((a, b) => a + b) > full.reduce((a, b) => a + b) + 5, 'a slimmer tower leaves more sun');
  assert.ok(S.skyView(S.horizonProfile(Ba, w.x, w.y, w.z), 180) > S.skyView(S.horizonProfile(Bf, w.x, w.y, w.z), 180));
});

test('the override layers over the site components, labelled assumed, and the source is not changed', () => {
  const site = { b: fx.site.b, target: 1, listing: { id: 'syn-1' }, components: { 5: [{ ring: [[0, 0], [1, 0], [1, 1]], base_m: 0, top_m: 3, source: 'osm' }] } };
  const mem = new Map(); const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k) };
  assert.equal(P.effectiveComponents(site, { storage }), site.components);
  const rec = P.saveAssumedParts('syn-1', fx.assumed_components, { nBuildings: 3, storage });
  assert.deepEqual(Object.keys(rec.parts), ['0']);
  const eff = P.effectiveComponents(site, { storage });
  assert.deepEqual(Object.keys(eff).sort(), ['0', '5']); assert.ok(P.isAssumed(eff[0])); assert.ok(!P.isAssumed(eff[5]));
  assert.deepEqual(Object.keys(site.components), ['5'], 'source untouched');
  assert.deepEqual(P.assumedBuildings(eff), [0]);
  assert.throws(() => P.saveAssumedParts('syn-1', [{ ring: [[0, 0]], top_m: 5, source: 'x' }], { storage }), /ring/);
  assert.equal(P.getAssumedParts('other-1', { storage }), null);
  P.clearAssumedParts('syn-1', { storage }); assert.equal(P.effectiveComponents(site, { storage }), site.components);
  storage.setItem(P.PARTS_PREFIX + 'syn-1', '{"schema":1,"kind":"apartmentscout-assumed-parts","site":"syn-1","parts":{"0":[{"ring":[[0,0]]}]}}');
  assert.equal(P.getAssumedParts('syn-1', { storage }), null, 'a corrupt override is ignored, not half applied');
});

test('the anchor record carries origin, rotation, datum, host facade, window and what is assumed', () => {
  const B = prep(), T = B[fx.site.target], face = S.facesOf(T, 8, B).find((f) => Math.round(f.bearing) === 180);
  const cal = C.resolveCal({ base: 0, fhEst: 3.2 }, null);
  const rec = A.buildAnchor({ site: fx.site, siteId: 'syn', B, T, face, t: 0.5, az: face.bearing, floor: 8, cal, panes: [-45, 0, 45], prov: {}, plan: { model: { up_bearing: 178 } } });
  const py = fx.anchor;
  for (const k of ['kind', 'schema', 'frame']) assert.equal(rec[k], py[k]);
  assert.deepEqual(rec.origin, py.origin);
  assert.deepEqual({ ...rec.host, assumed_parts: undefined }, { ...py.host, assumed_parts: undefined });
  assert.equal(rec.facade.index, py.facade.index); near(rec.facade.bearing_deg, py.facade.bearing_deg, 'bearing'); near(rec.facade.length_m, py.facade.length_m, 'length', 0.06);
  assert.deepEqual(rec.window.point_m, py.window.point_m); assert.deepEqual(rec.window.panes, py.window.panes);
  assert.deepEqual(rec.north, py.north); assert.deepEqual(rec.sources, py.sources); assert.deepEqual(rec.assumed, py.assumed);
  for (const k of ['state', 'slab_m', 'eye_m', 'estimated_slab_m', 'delta_m', 'floor_height_m']) assert.equal(rec.datum[k], py.datum[k], k);
  assert.equal(rec.air.ok, py.air.ok);
  const rows = A.describeAnchor(rec).flatMap((s) => s.rows);
  assert.ok(rows.some((r) => r.k === 'Slab datum' || /slab/.test(r.k)) && rows.some((r) => r.state === 'assumed'));
  const inward = A.buildAnchor({ site: fx.site, siteId: 'syn', B, T, face, t: 0.5, az: 0, floor: 8, cal, prov: {} });
  assert.equal(inward.air.ok, false); assert.match(inward.air.message, /inside its own building/);
});

test('the pin stores the chosen window per site and rejects anything invalid', () => {
  const mem = new Map(); const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k) };
  const pin = { face: 1, t: 0.55, az: 118.7, floor: 24, bay: true, cal: { kind: 'slab', value: 80, floor: 24, spread: 'scale' } };
  A.savePin('p-1', pin, { base: 'data', storage });
  assert.deepEqual(A.getPin('p-1', { base: 'data', storage }), { ...pin, cal: { ...pin.cal }, saved: A.getPin('p-1', { storage }).saved });
  assert.equal(A.getPin('p-1', { base: 'other', storage }), null, 'another search folder');
  assert.equal(A.getPin('p-2', { storage }), null, 'a sibling unit');
  for (const bad of [{ ...pin, t: 2 }, { ...pin, az: 400 }, { ...pin, floor: 0 }, { ...pin, face: -1 }, { ...pin, cal: { kind: 'slab', value: 9999, floor: 3 } }]) assert.throws(() => A.savePin('p-1', bad, { storage }), /cannot be pinned/);
  assert.deepEqual(A.pinOption(A.getPin('p-1', { storage })).cal, pin.cal);
  A.clearPin('p-1', { storage }); assert.equal(A.getPin('p-1', { storage }), null);
});
