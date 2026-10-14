// The dashboard's sun and skyline maths (dashboard/js/sun.js) must agree with the Python model.
// Fixture written by tests/test_sun_parity.py: sun positions, DST-correct times, horizon profiles
// (including a light court and a party wall), lit minutes and facade faces.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../../', import.meta.url);
const S = await import(new URL('dashboard/js/sun.js', root));
const fx = JSON.parse(fs.readFileSync(new URL('tests/fixtures/sun_parity.json', root)));
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-3, `${msg}: ${a} vs ${b}`);

test('sun position matches Python', () => {
  for (const s of fx.sun) { const p = S.sunPos(s.ms, fx.lat, fx.lon); near(p.az, s.az, `az ${s.local}`); near(p.alt, s.alt, `alt ${s.local}`); }
});
test('local times convert with daylight saving', () => {
  for (const z of fx.zoned) { const [y, m, d] = z.date.split('-').map(Number); assert.equal(S.zonedMs(y, m - 1, d, z.minutes, fx.tz), z.ms, `${z.date} ${z.minutes}`); }
});
test('horizon profiles match, courts open and party walls closed', () => {
  const B = S.prepBuildings(fx.site.b, fx.site.holes);
  for (const p of fx.points) { const prof = S.horizonProfile(B, ...p.p); p.az.forEach((a, k) => near(S.hAt(prof, a), p.expected[k], `${p.name} az ${a}`)); }
  const full = S.horizonProfile(B, ...fx.points[0].p);
  full.forEach((v, k) => near(v, fx.profile_court_centre[k], `court profile ${k}`));
});
test('direct-sun minutes and lit segments match', () => {
  const B = S.prepBuildings(fx.site.b, fx.site.holes);
  for (const c of fx.lit) {
    const [y, m, d] = c.date.split('-').map(Number);
    const panes = Array.isArray(c.panes) ? c.panes : null;
    const tab = S.dayTable(y, m - 1, d, fx.lat, fx.lon, fx.tz), r = S.litInfo(tab, S.horizonProfile(B, ...c.point), c.facing, fx.step_min ?? 6, panes);
    assert.equal(tab.length, c.samples); assert.equal(r.min, c.minutes, `${c.date}${panes ? ' panes ' + panes : ''}`); assert.deepEqual(r.segs, c.segs);
    // bay windows: minutes through each pane on its own, when the fixture records them
    if (panes && Array.isArray(c.pane_minutes)) assert.deepEqual(r.panes, c.pane_minutes, `${c.date} per pane`);
  }
});
test('bay windows: the fixture carries a multi-pane case once the Python side writes one', (t) => {
  const bay = (fx.lit || []).filter((c) => Array.isArray(c.panes) && c.panes.length > 1);
  if (!bay.length) { t.skip('no bay case in tests/fixtures/sun_parity.json yet'); return; }
  const B = S.prepBuildings(fx.site.b, fx.site.holes);
  for (const c of bay) {
    const [y, m, d] = c.date.split('-').map(Number), tab = S.dayTable(y, m - 1, d, fx.lat, fx.lon, fx.tz), prof = S.horizonProfile(B, ...c.point);
    const flat = S.litInfo(tab, prof, c.facing), bayR = S.litInfo(tab, prof, c.facing, fx.step_min ?? 6, c.panes);
    assert.ok(bayR.min >= flat.min, `the union over panes never loses sun (${bayR.min} vs ${flat.min})`);
  }
});
test('facade faces match', () => {
  const B = S.prepBuildings(fx.site.b, fx.site.holes);
  const F = S.facesOf(B[fx.site.target]);
  assert.deepEqual(F.map((f) => [f.i, +f.bearing.toFixed(1), +f.length.toFixed(1)]), fx.faces.map((f) => [f.i, f.bearing, f.length]));
});
test('component buildings: podium + set-back tower match Python and differ from the prism', () => {
  const site = fx.components_site, c = fx.components_profile;
  const B = S.prepBuildings(site.b, site.holes, site.components), P = S.prepBuildings(site.b, site.holes);
  assert.equal(B[0].parts.length, 2); assert.equal(B[1].parts, null); assert.equal(P[0].parts, null);
  assert.deepEqual(B[0].parts.map((p) => [p.kind, p.base, p.top]), [['podium', 0, 20], ['tower', 20, 100]]);
  const prof = S.horizonProfile(B, ...c.point), pp = S.horizonProfile(P, ...c.point);
  c.az.forEach((a, k) => { near(S.hAt(prof, a), c.expected[k], `components az ${a}`); near(S.hAt(pp, a), c.prism[k], `prism az ${a}`); });
  for (const l of fx.components_lit) {
    const [y, m, d] = l.date.split('-').map(Number), tab = S.dayTable(y, m - 1, d, fx.lat, fx.lon, fx.tz);
    const r = S.litInfo(tab, S.horizonProfile(B, ...l.point), l.facing), r0 = S.litInfo(tab, S.horizonProfile(P, ...l.point), l.facing);
    assert.equal(r.min, l.minutes, l.date); assert.deepEqual(r.segs, l.segs); assert.equal(r0.min, l.prism_minutes);
    assert.ok(r.min > r0.min, `components give more sun than the full-footprint prism on ${l.date}`);
  }
  for (const b of fx.components_blockers) {
    const h = S.rayBlock(B, ...b.point, b.az, b.alt);
    assert.equal(h ? h.bi : null, b.owner, `blocker at ${b.alt}°`);
    if (h) { near(h.dist, b.dist, 'blocker distance'); assert.ok(h.part, 'the hit names its component'); }
  }
  // malformed components are ignored, never thrown on
  const bad = S.prepBuildings(site.b, null, { 0: [{ ring: [[0, 0], [1, 1]], top_m: 5 }, { ring: site.components['0'][0].ring, base_m: 9, top_m: 3 }], 7: [] });
  assert.equal(bad[0].parts, null);
});
test('sky view (CIE overcast, relative) and daylight factor estimate match Python', () => {
  const sites = { site: S.prepBuildings(fx.site.b, fx.site.holes), comp: S.prepBuildings(fx.components_site.b, null, fx.components_site.components), prism: S.prepBuildings(fx.components_site.b) };
  for (const c of fx.sky) {
    const sv = S.skyView(S.horizonProfile(sites[c.site], ...c.point), c.facing, c.panes);
    assert.ok(Math.abs(sv - c.sky_view) < 2e-5, `${c.site} ${c.facing}: ${sv} vs ${c.sky_view}`);
    assert.ok(Math.abs(S.daylightFactor(sv) - c.df) < 1e-4, 'daylight factor');
  }
  assert.ok(Math.abs(S.skyView(new Float32Array(S.NB), 77) - 1) < 1e-9, 'an open horizon is 1');
  assert.ok(Math.abs(S.daylightFactor(0.5, { transmittance: 0.3 }) - S.daylightFactor(0.5) / 2) < 1e-12, 'linear in transmittance');
  assert.deepEqual(S.SUNSHINE.nyc.fraction, fx.sunshine);
  const e = fx.expected_sun, js = S.expectedSun(e.possible_hours, fx.sunshine);
  assert.equal(js.possible, e.possible); assert.equal(js.expected, e.expected);
  js.monthly.forEach((v, i) => assert.ok(Math.abs(v - e.monthly[i]) < 0.006, `month ${i}`));
});
