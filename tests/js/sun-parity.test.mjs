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
    const tab = S.dayTable(y, m - 1, d, fx.lat, fx.lon, fx.tz), r = S.litInfo(tab, S.horizonProfile(B, ...c.point), c.facing);
    assert.equal(tab.length, c.samples); assert.equal(r.min, c.minutes, c.date); assert.deepEqual(r.segs, c.segs);
  }
});
test('facade faces match', () => {
  const B = S.prepBuildings(fx.site.b, fx.site.holes);
  const F = S.facesOf(B[fx.site.target]);
  assert.deepEqual(F.map((f) => [f.i, +f.bearing.toFixed(1), +f.length.toFixed(1)]), fx.faces.map((f) => [f.i, f.bearing, f.length]));
});
