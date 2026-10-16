// node --test tests/js : noise complaints by hour of the day (features/noise-hours-model.js)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hourLabel, windowLabel, classesFromWeek, buildingProfile, series, total, peak, quietest, sources, describe, clockSVG } from '../../dashboard/js/features/noise-hours-model.js';

const zeros = () => Array(24).fill(0);
const hrs = (o) => { const a = zeros(); for (const [h, v] of Object.entries(o)) a[+h] = v; return a; };

test('hour words', () => {
  assert.equal(hourLabel(0), '12 am'); assert.equal(hourLabel(1), '1 am'); assert.equal(hourLabel(12), '12 pm'); assert.equal(hourLabel(23), '11 pm'); assert.equal(hourLabel(24), '12 am'); assert.equal(hourLabel(-1), '11 pm');
  assert.equal(windowLabel(23, 3), '11 pm–2 am'); assert.equal(windowLabel(4, 3), '4 am–7 am'); assert.equal(windowLabel(11, 1), '11 am–12 pm');
});

test('a building\'s calendar week becomes Sun-Thu and Fri-Sat nights: hours before 5 am belong to the evening before', () => {
  const wk = Array.from({ length: 7 }, zeros);
  wk[4][23] = 5;    // Friday 11 pm -> Fri-Sat
  wk[5][0] = 7;     // Saturday 12:xx am -> still Friday night
  wk[5][4] = 1;     // Saturday 4 am -> Friday night
  wk[5][5] = 2;     // Saturday 5 am -> Saturday morning (Fri-Sat class)
  wk[6][1] = 3;     // Sunday 1 am -> Saturday night
  wk[6][5] = 4;     // Sunday 5 am -> Sunday: Sun-Thu
  wk[0][2] = 6;     // Monday 2 am -> Sunday night: Sun-Thu
  wk[2][9] = 8;     // Wednesday 9 am
  const c = classesFromWeek(wk);
  assert.equal(c[1][23], 5); assert.equal(c[1][0], 7); assert.equal(c[1][4], 1); assert.equal(c[1][5], 2); assert.equal(c[1][1], 3);
  assert.equal(c[0][5], 4); assert.equal(c[0][2], 6); assert.equal(c[0][9], 8);
  assert.equal(c[0].reduce((a, b) => a + b) + c[1].reduce((a, b) => a + b), 36);
});

const NZ = (extra = {}) => {
  const wk = Array.from({ length: 7 }, zeros);
  for (const [d, h, v] of [[4, 23, 30], [5, 0, 40], [5, 1, 30], [5, 23, 28], [6, 0, 35], [2, 10, 12], [1, 15, 9], [3, 9, 10]]) wk[d][h] += v;
  const grp = Array.from({ length: 6 }, zeros);
  for (const h of [23, 0, 1]) { grp[0][h] = 50; grp[1][h] = 30; grp[2][h] = 5; }   // bars 50, street 30 each hour in the window
  grp[4][10] = 12; grp[4][9] = 10; grp[4][15] = 9;
  return { by_week: wk, by_hour_group: grp, week_days: [784, 312], radius_m: 150, nearby_total: 194, nearby_per_year: 64.7, ...extra };
};

test('the loudest three hours are found per night, wrapping midnight, and named with the kind of source', () => {
  const p = buildingProfile(NZ());
  assert.equal(total(p), 194);
  const pk = peak(p);
  assert.deepEqual([pk.cls, pk.start, pk.width], [1, 23, 3]);
  assert.equal(pk.count, 30 + 28 + 40 + 35 + 30);
  assert.ok(pk.ratio > 3);
  const s = sources(p, pk);
  assert.deepEqual(s.map((x) => x.id), ['bars', 'street', 'home']);
  assert.ok(Math.abs(s[0].share - 50 / 85) < 1e-9);
  const d = describe(p);
  assert.equal(d.enough, true);
  assert.equal(d.headline, 'Loudest Fri–Sat 11 pm–2 am: mostly bars, clubs and restaurants and street crowds and music.');
  assert.match(d.detail, /× an average hour/);
  assert.match(d.quietLabel, /^Quietest /);
});

test('a flat profile has no loud hour and too few complaints say so', () => {
  const wk = Array.from({ length: 7 }, () => Array(24).fill(2));
  const flat = describe(buildingProfile({ by_week: wk, week_days: [260, 104], radius_m: 150 }));
  assert.equal(flat.headline, 'No clear loud hour: complaints are spread through the day.');
  const few = describe(buildingProfile({ by_week: Array.from({ length: 7 }, () => hrs({ 22: 1 })), week_days: [260, 104] }));
  assert.equal(few.enough, false); assert.match(few.headline, /Too few complaints/);
  assert.equal(buildingProfile({ note: 'no coordinates' }), null);
  assert.equal(describe(null).enough, false);
});

test('rates are per night: Fri-Sat has fewer nights, so the same count there is louder', () => {
  const p = { hours: [hrs({ 22: 100, 23: 100, 0: 100 }), hrs({ 22: 100, 23: 100, 0: 100 })], days: [260, 104], scope: 'building' };
  const s = series(p, 'all');
  assert.ok(Math.abs(s[23] - 200 / 364) < 1e-9);
  const sc = series(p, 1); assert.ok(Math.abs(sc[23] - 100 / 104) < 1e-9);
  assert.equal(peak(p).cls, 1);
  assert.deepEqual(quietest(p).width, 3);
});

test('an area\'s kinds of source are weighted by how much of each four-hour bucket the window covers', () => {
  // buckets: 2-6, 6-10, 10-14, 14-18, 18-22, 22-2 ; groups: bars, street, home, vehicle, build, equip
  const mix = [0, 1].map(() => Array.from({ length: 6 }, () => Array(6).fill(0)));
  mix[1][5] = [80, 40, 0, 0, 0, 0];          // 10 pm-2 am on Fri-Sat
  mix[1][0] = [0, 0, 0, 40, 0, 0];           // 2-6 am
  const p = { hours: [zeros(), hrs({ 23: 30, 0: 30, 1: 30 })], days: [260, 104], scope: 'area', mix, groups: ['bars', 'street', 'home', 'vehicle', 'build', 'equip'] };
  const pk = peak(p);
  assert.equal(pk.start, 23);
  const s = sources(p, pk);                  // hours 23, 0, 1 are all in the 10 pm-2 am bucket
  assert.deepEqual(s.map((x) => x.id), ['bars', 'street']);
  assert.ok(Math.abs(s[0].share - 2 / 3) < 1e-9);
  assert.match(describe(p).headline, /^Loudest Fri–Sat 11 pm–2 am: mostly bars, clubs and restaurants and street crowds and music\.$/);
});

test('the clock draws a spoke per hour with the loud window marked, and escapes nothing it should not', () => {
  const p = buildingProfile(NZ());
  const svg = clockSVG(series(p, 'all'), peak(p), { titles: Array.from({ length: 24 }, (_, h) => `${h} <b>`) });
  assert.equal((svg.match(/class="nh-sp/g) || []).length, 24);
  assert.equal((svg.match(/class="nh-sp pk"/g) || []).length, 3);
  assert.match(svg, /11 pm–2 am/);
  assert.match(svg, /^<svg class="nh-clock"/);
  assert.match(svg, /<title>3 &lt;b&gt;<\/title>/);
});
