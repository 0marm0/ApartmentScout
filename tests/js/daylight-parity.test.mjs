// The browser's relative daylight model (dashboard/js/features/daylight-core.js) must agree with the Python model
// (apartmentscout/daylight.py). Fixture written by tests/test_daylight.py.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../../', import.meta.url);
const C = await import(new URL('dashboard/js/features/daylight-core.js', root));
const S = await import(new URL('dashboard/js/sun.js', root));
const fx = JSON.parse(fs.readFileSync(new URL('tests/fixtures/daylight_parity.json', root)));
const near = (a, b, msg, rel = 1e-9, abs = 1e-12) => assert.ok(Math.abs(a - b) <= Math.max(abs, rel * Math.abs(b)), `${msg}: ${a} vs ${b}`);
const prof = (name) => Float64Array.from(fx.profiles[name]);
const sky = (s) => (s ? { kind: s.kind, sunAz: s.sun_az, sunAlt: s.sun_alt } : null);
const win = (w) => ({ a: w.a, b: w.b, normal: w.normal, sill: w.sill, head: w.head });

test('input presets and constants match Python', () => {
  assert.deepEqual(C.GLAZING_PRESETS, fx.presets.glazing);
  assert.deepEqual(C.FRAME_PRESETS, fx.presets.frame);
  assert.deepEqual(C.BLINDS_T, fx.presets.blinds);
  assert.deepEqual(C.SURFACE_PRESETS, fx.presets.surfaces);
  assert.deepEqual(C.SURFACE_DEFAULT, fx.presets.surface_default);
  assert.equal(C.FIELD_DEG, fx.constants.field_deg); assert.equal(C.CLEAR_STEP, fx.constants.clear_step);
  assert.equal(C.SENSOR_HEIGHT_M, fx.constants.sensor_height_m); assert.deepEqual([C.SAMPLES_U, C.SAMPLES_Z], fx.constants.samples);
  assert.equal(C.MODEL_LABEL, fx.model);
});
test('sky luminance and the horizontal illuminance of the unobstructed sky match Python', () => {
  for (const c of fx.luminance) {
    near(C.cieClear(c.alt, c.az, c.sun_alt, c.sun_az), c.clear, 'clear');
    near(C.cieOvercast(c.alt), c.overcast, 'overcast');
  }
  for (const c of fx.e_h) near(C.horizontalIlluminance(sky(c.sky)), c.value, `E_h ${JSON.stringify(c.sky)}`);
});
test('vertical sky component matches Python (overcast, bay, clear sky)', () => {
  for (const c of fx.vsc) near(C.verticalSkyComponent(prof(c.profile), c.facing, c.panes, sky(c.sky)), c.expected, `${c.profile} ${c.facing}`);
});
test('an unobstructed window under the overcast sky gets the textbook 39.6 %', () => {
  near(C.verticalSkyComponent(new Float64Array(720), 180), 0.396, 'open', 1e-3);
  near(C.verticalSkyComponent(new Float64Array(720).fill(30), 180) / C.verticalSkyComponent(new Float64Array(720), 180), 0.51, 'wall', 0.02);
});
test('the browser VSC agrees with the existing sky view ratio', () => {
  for (const n of ['wall30', 'tower', 'ragged']) {
    const r = C.verticalSkyComponent(prof(n), 180) / C.verticalSkyComponent(prof('open'), 180);
    assert.ok(Math.abs(r - S.skyView(prof(n), 180)) < 0.02, `${n}: ${r} vs ${S.skyView(prof(n), 180)}`);
  }
});
test('sensor sky components match Python', () => {
  for (const c of fx.sensor) c.points.forEach((p, i) => near(C.sensorSkyComponent(p, win(c.win), prof(c.profile), c.up_bearing, sky(c.sky)), c.expected[i], `${c.profile} ${p}`, 1e-9, 1e-12));
});
test('the sensor grid matches Python, cell by cell', () => {
  for (const c of fx.grid) {
    const windows = c.windows.map((w) => ({ ...win(w), prof: prof(w.profile) }));
    const g = C.roomGrid(fx.room, fx.ceiling_m, windows, c.up_bearing, { vt: c.vt, glazed: c.glazed, blinds: c.blinds, surfaces: c.surfaces, sky: sky(c.sky) });
    const e = c.expected;
    for (const [k, kk] of [['x0', 'x0'], ['y0', 'y0'], ['step', 'step'], ['nx', 'nx'], ['ny', 'ny'], ['t', 't'], ['rho', 'rho'], ['reflected', 'reflected'], ['skyComponentMean', 'sky_component_mean']]) near(g[k], e[kk], k);
    assert.equal(g.values.length, e.values.length);
    e.values.forEach((v, i) => { if (v == null) assert.equal(g.values[i], null, `cell ${i} is outside`); else near(g.values[i], v, `cell ${i}`); });
    for (const k of ['mean', 'min', 'max', 'median', 'uniformity', 'n']) near(g.stats[k], e.stats[k], `stats.${k}`);
  }
});
test('annual summary matches Python and keeps three quantities apart', () => {
  const a = fx.annual, p = prof(a.profile);
  assert.deepEqual(C.monthlyDirectSun(p, a.facing, a.panes, a.year, fx.lat, fx.lon, fx.tz).map((h) => Math.round(h * 100) / 100), a.monthly_direct);
  const got = C.annualDaylight(p, a.facing, a.panes, a.year, fx.lat, fx.lon, fx.tz, a.possible, a.sky_view, a.fraction), e = a.expected;
  assert.equal(got.model, e.model);
  assert.deepEqual(got.direct_sun.possible_h_per_day, e.direct_sun.possible_h_per_day);
  got.direct_sun.expected_h_per_day.forEach((v, i) => near(v, e.direct_sun.expected_h_per_day[i], `expected sun ${i}`, 0, 0.0101));
  assert.equal(got.direct_sun.kind, 'modelled');
  assert.deepEqual(got.sky_visibility, e.sky_visibility);
  near(got.relative_daylight.overcast_pct, e.relative_daylight.overcast_pct, 'overcast', 0, 0.011);
  got.relative_daylight.clear_pct.forEach((v, i) => near(v, e.relative_daylight.clear_pct[i], `clear ${i}`, 0, 0.011));
  assert.equal(got.relative_daylight.mixed_pct, undefined);
});
test('blinds scale every cell and surfaces move only the reflected part', () => {
  const w = [{ a: [1, 0], b: [3, 0], normal: [0, -1], sill: 0.9, head: 2.1, prof: new Float64Array(720) }];
  const base = C.roomGrid(fx.room, 2.7, w, 0, { vt: 0.7, glazed: 0.8 }), half = C.roomGrid(fx.room, 2.7, w, 0, { vt: 0.7, glazed: 0.8, blinds: 'half' });
  near(half.stats.mean, base.stats.mean / 2, 'half blinds', 1e-9);
  const dark = C.roomGrid(fx.room, 2.7, w, 0, { vt: 0.7, glazed: 0.8, surfaces: { floor: 0.1, walls: 0.1, ceiling: 0.1 } });
  assert.ok(dark.reflected < base.reflected);
  near(dark.skyComponentMean, base.skyComponentMean, 'sky part is unchanged');
});
test('transmission multiplies glass, frame and blinds; unknown blinds pass everything', () => {
  near(C.transmission(0.7, 0.8, 'sheer'), 0.7 * 0.8 * 0.55, 'sheer');
  near(C.transmission(0.7, 0.8, 0.3), 0.7 * 0.8 * 0.3, 'number');
  near(C.transmission(0.7, 0.8, 'nope'), 0.56, 'unknown');
});
