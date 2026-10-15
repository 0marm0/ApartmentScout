// Pure parts of the lighting and render-quality work: heat-map scale and lookups, surface tint, quality settings,
// progressive-export helpers and the annual summary chart. (The three.js and DOM sides are covered in tests/e2e/test_lighting.py.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { ramp, scaleT, SCALES, valueAt, fmtVal, legendHTML, heatCanvas } from '../../dashboard/js/plan/heatmap.js';
import { setSurfaceState, applySurfaceTint, surfaceState } from '../../dashboard/js/plan/surfaces3d.js';
import { settingsFor, readMode, saveMode, halton, jitter, fitScale, sunDisc, MODES, EXPORT_SCALES, MAX_EXPORT_PX } from '../../dashboard/js/features/render-quality.js';
import { annualFor, annualSVG, annualTable, annualBlock, summaryText, yearTotals, panelHTML } from '../../dashboard/js/unit/daylight-annual.js';
import { SUNSHINE } from '../../dashboard/js/sun.js';

test('the heat ramp runs dark purple to yellow and the scale keeps dim areas readable', () => {
  assert.deepEqual(ramp(0), [68, 1, 84]); assert.deepEqual(ramp(1), [253, 231, 37]); assert.deepEqual(ramp(-5), ramp(0)); assert.deepEqual(ramp(7), ramp(1));
  const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  for (let t = 0.1; t <= 1; t += 0.1) assert.ok(lum(ramp(t)) > lum(ramp(t - 0.1)), `luminance rises at ${t}`);
  const s = SCALES.daylight;
  assert.equal(scaleT(0, s), 0); assert.equal(scaleT(s.max, s), 1); assert.equal(scaleT(1e6, s), 1);
  assert.ok(scaleT(s.max / 4, s) > 0.45, 'square-root spacing lifts the low end');
  assert.equal(SCALES.daylight.kind, 'modelled'); assert.equal(SCALES.lux.kind, 'estimate');
});
test('heat-map values are formatted with their unit and looked up by plan point', () => {
  assert.equal(fmtVal(0.46, SCALES.daylight), '0.46%'); assert.equal(fmtVal(4.26, SCALES.daylight), '4.3%'); assert.equal(fmtVal(119.4, SCALES.lux), '119 lx'); assert.equal(fmtVal(null, SCALES.lux), '—');
  const room = { x0In: 10, y0In: 20, stepIn: 12, nx: 3, ny: 2, values: [1, 2, 3, null, 5, 6] };
  assert.equal(valueAt(room, 11, 21), 1); assert.equal(valueAt(room, 35, 21), 3); assert.equal(valueAt(room, 11, 33), null); assert.equal(valueAt(room, 22, 33), 5);
  assert.equal(valueAt(room, 5, 21), null); assert.equal(valueAt(room, 11, 60), null);
  assert.equal(heatCanvas(room, SCALES.lux, null), null, 'no DOM: no canvas');
  const html = legendHTML(SCALES.daylight);
  assert.ok(html.includes('aria-label') && html.includes('modelled') && html.includes('10+'));
});
test('surface reflectance changes the 3D colours only when it differs from the built-in look', () => {
  class Col { constructor(r, g, b) { Object.assign(this, { r, g, b }); } clone() { return new Col(this.r, this.g, this.b); } multiplyScalar(k) { this.r *= k; this.g *= k; this.b *= k; return this; } }
  const C = { wall: new Col(0.5, 0.5, 0.5), wood: new Col(0.4, 0.3, 0.2), tile: new Col(0.6, 0.6, 0.6), carpet: new Col(0.3, 0.3, 0.3), dark: true };
  assert.equal(setSurfaceState({ floor: 0.25, walls: 0.55, ceiling: 0.75 }), false, 'the built-in look: nothing changed'); assert.equal(surfaceState(), null); assert.equal(applySurfaceTint(C), C);
  assert.equal(setSurfaceState(null), false); assert.equal(applySurfaceTint(C), C);
  assert.equal(setSurfaceState({ floor: 0.5, walls: 0.275, ceiling: 0.75 }), true); assert.equal(setSurfaceState({ floor: 0.5, walls: 0.275, ceiling: 0.75 }), false);
  const T = applySurfaceTint(C);
  assert.notEqual(T, C); assert.ok(Math.abs(T.wall.r - 0.25) < 1e-9, 'walls at half the reflectance are half as bright');
  assert.ok(Math.abs(T.wood.r - 0.8) < 1e-9 && T.wood.g <= 1, 'floors at twice the reflectance, clamped'); assert.ok(Math.abs(T.ceiling.r - 0.52) < 1e-9);
  assert.equal(C.wall.r, 0.5, 'the input colours are not mutated'); assert.equal(T.dark, true);
  setSurfaceState({ floor: 0, walls: 2, ceiling: 0.5 }); assert.equal(surfaceState(), null, 'invalid reflectances fall back to the built-in look');
  setSurfaceState(null);
});
test('Fast is the default everywhere and Visual is opt-in; phones get lighter Visual settings', () => {
  const mem = new Map(), store = { get: (k, d) => (mem.has(k) ? mem.get(k) : d), set: (k, v) => mem.set(k, v) };
  assert.equal(readMode(store), 'fast'); saveMode(store, 'visual'); assert.equal(readMode(store), 'visual'); saveMode(store, 'weird'); assert.equal(readMode(store), 'fast');
  assert.equal(readMode({ get() { throw new Error('private window'); } }), 'fast'); assert.doesNotThrow(() => saveMode({ set() { throw new Error('private'); } }, 'visual'));
  const fast = settingsFor('fast', { dpr: 3 }), vis = settingsFor('visual', { maxTexture: 8192, dpr: 2 }), phone = settingsFor('visual', { phone: true, maxTexture: 8192, dpr: 3 });
  assert.equal(fast.mode, 'fast'); assert.equal(fast.environment, false); assert.equal(fast.softShadows, false); assert.equal(fast.pixelRatio, 2); assert.equal(fast.shadowSize, 2048);
  assert.equal(vis.shadowSize, 4096); assert.ok(vis.softShadows && vis.environment && vis.contact);
  assert.ok(phone.shadowSize < vis.shadowSize && phone.pixelRatio <= 1.5 && phone.contact === false);
  assert.equal(settingsFor('visual', { maxTexture: 2048 }).shadowSize, 2048, 'never above the GPU limit');
  assert.deepEqual(Object.keys(MODES), ['fast', 'visual']); assert.ok(MODES.visual.note.includes('look, not extra evidence') || MODES.visual.note.includes('A look'));
  assert.deepEqual(EXPORT_SCALES, [2, 4]);
});
test('progressive export helpers: jitter stays inside a pixel, scale respects the size cap, the sun disc is tiny', () => {
  assert.equal(halton(0, 2), 0.5); assert.equal(halton(1, 2), 0.25); assert.equal(halton(2, 2), 0.75);
  const seen = new Set();
  for (let i = 0; i < 16; i++) { const [x, y] = jitter(i); assert.ok(x >= -0.5 && x < 0.5 && y >= -0.5 && y < 0.5); seen.add(`${x.toFixed(3)},${y.toFixed(3)}`); }
  assert.equal(seen.size, 16, 'every frame samples a different sub-pixel offset');
  assert.equal(fitScale(4, 1000, 500), 4); assert.equal(fitScale(4, 2000, 500), 2.048); assert.equal(fitScale(2, 9000, 500), 1); assert.equal(MAX_EXPORT_PX, 4096);
  for (let i = 0; i < 20; i++) { const [a, b] = sunDisc(i); assert.ok(Math.hypot(a, b) <= 0.0047 + 1e-12); }
});

// ------------------------------------------------------------------ annual chart
const prof = new Float64Array(720).fill(15);
const args = { prof, facing: 180, panes: null, year: 2026, lat: 40.75, lon: -73.98, tz: 'America/New_York', skyViewShare: 0.7, fraction: SUNSHINE.nyc.fraction, place: 'New York Central Park' };
test('annual summary: three separate series, expected below possible, no mixing', () => {
  const a = annualFor(args);
  assert.equal(a.direct_sun.possible_h_per_day.length, 12); assert.equal(a.relative_daylight.clear_pct.length, 12);
  a.direct_sun.expected_h_per_day.forEach((e, i) => assert.ok(e < a.direct_sun.possible_h_per_day[i]));
  assert.equal(a.sky_visibility.share, 0.7); assert.equal(a.relative_daylight.mixed_pct, undefined); assert.ok(a.sunshine.place.includes('Central Park'));
  assert.equal(annualFor(args), a, 'cached by skyline identity and inputs');
  assert.notEqual(annualFor({ ...args, skyViewShare: 0.5 }), a);
  assert.equal(annualFor({ ...args, prof: new Float64Array(720).fill(15), fraction: null }).direct_sun.expected_h_per_day, null);
  const t = yearTotals(a); assert.ok(t.expected < t.possible);
});
test('annual chart: accessible, labelled as modelled, no inline colours, numbers also in a table', () => {
  const a = annualFor(args), svg = annualSVG(a), html = annualBlock(a, 'floor 24 window'), table = annualTable(a);
  assert.ok(svg.includes('role="img"') && svg.includes('aria-label=') && svg.includes('Modelled, not measured'));
  assert.ok(!/style=|fill="#|stroke="#/.test(svg), 'colours come from CSS tokens');
  assert.equal((svg.match(/<rect class="lx-poss"/g) || []).length, 12); assert.equal((svg.match(/<rect class="lx-exp"/g) || []).length, 12);
  assert.equal((svg.match(/<circle class="lx-dot"/g) || []).length, 12);
  for (const w of ['Direct sun, hours a day', 'Sky visibility', 'Relative daylight', 'overcast sky']) assert.ok(svg.includes(w), w);
  assert.ok(html.includes('never averaged') && html.includes('Modelled') && html.includes('<details'));
  assert.equal((table.match(/<tr>/g) || []).length, 6, 'header plus five rows (possible, expected, sky visibility, two daylight)');
  assert.ok(summaryText(a).includes('Modelled, not measured'));
  const noExp = annualSVG(annualFor({ ...args, fraction: null, prof: new Float64Array(720).fill(14) })); assert.ok(noExp.includes('possible, clear sky') && !noExp.includes('lx-exp'));
});
test('the Unit 3D panel computes only while open and survives a failing computation', () => {
  let calls = 0;
  const closed = panelHTML({ open: false, who: 'floor 24', compute: () => { calls++; return annualFor(args); } });
  assert.equal(calls, 0); assert.ok(closed.includes('modelled · not lux') && closed.includes('Show the chart') && !closed.includes('<svg'));
  const open = panelHTML({ open: true, who: 'floor 24', compute: () => { calls++; return annualFor(args); } });
  assert.equal(calls, 1); assert.ok(open.includes('<svg') && open.includes(' open'));
  assert.ok(panelHTML({ open: true, who: 'x', compute: () => { throw new Error('boom'); } }).includes('could not be computed: boom'));
});
