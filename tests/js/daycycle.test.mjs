// Playing the day and the year, and the night city, the pure parts (dashboard/js/city3d/timeplay.js, facade-rules.js night rules, lampplan.js, room3d/lighting-core.js,
// room3d/roomlamps.js spots). The three.js side (the sun moving, the trees, the lamps drawn) is covered in tests/e2e/test_daycycle.py.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const T = await import(new URL('../../dashboard/js/city3d/timeplay.js', import.meta.url));
const F = await import(new URL('../../dashboard/js/city3d/facade-rules.js', import.meta.url));
const LP = await import(new URL('../../dashboard/js/city3d/lampplan.js', import.meta.url));
const L = await import(new URL('../../dashboard/js/room3d/lighting-core.js', import.meta.url));
const Sun = await import(new URL('../../dashboard/js/sun.js', import.meta.url));
const site = JSON.parse(readFileSync(new URL('../../dashboard/data/sites/paramount-tower-25e.json', import.meta.url), 'utf8'));
const alt = (y, m, d) => (min) => Sun.sunPos(Sun.zonedMs(y, m, d, min, 'America/New_York'), 40.7479, -73.9748).alt;

// ------------------------------------------------------------------ the loop

test('a day loop plays from the first light to the last, holds, and goes round again; pausing stops it', () => {
  const p = new T.Player({ seconds: 10, holdMs: 500 });
  assert.equal(p.tick(1000), null, 'not running: nothing moves');
  p.start('day', 0);
  let t = 0, top = 0, wrapped = false;
  for (let now = 1000; now < 30000 && !wrapped; now += 16) { const r = p.tick(now); if (r >= 1) top++; if (top && r < 0.05) wrapped = true; t = r; }
  assert.ok(top >= 25 && top <= 40, `held at the end for about half a second: ${top} frames`);
  assert.ok(wrapped, 'and began again');
  assert.ok(p.stop() === true && p.tick(40000) === null, 'paused: no more ticks');
  assert.ok(p.stop() === false, 'a second stop is a no-op');
  assert.ok(t >= 0 && t <= 1);
});

test('a slow frame never jumps the loop more than 100 ms', () => {
  const p = new T.Player({ seconds: 10 }); p.start('day', 0); p.tick(1000);
  assert.ok(p.tick(60000) - 0 < 0.0125, 'a one-minute stall moves it by a hundredth, not the whole loop');
});

test('the stretch to play runs from first light to last light and follows the seasons', () => {
  const dec = T.dayRange(alt(2026, 11, 21)), jun = T.dayRange(alt(2026, 5, 21));
  assert.ok(dec.start >= 400 && dec.start <= 430 && dec.end >= 1000 && dec.end <= 1030, JSON.stringify(dec));   // 6:52 am to 4:56 pm
  assert.ok(jun.start === 300 && jun.end >= 1240, JSON.stringify(jun));                                       // from 5:00 (the strip's start) to dusk
  assert.ok(dec.rise > dec.start && dec.set < dec.end, 'the sky is seen going through dawn and dusk');
  assert.ok(T.minuteAt(dec, 0) === dec.start && T.minuteAt(dec, 1) === dec.end && T.minuteAt(dec, 0.5, 5) % 5 === 0);
  assert.equal(T.progressOf(dec, 100), 0, 'a minute before first light starts at the beginning');
  const mid = (dec.start + dec.end) / 2; assert.ok(Math.abs(T.progressOf(dec, mid) - 0.5) < 0.01);
});

test('a year loop visits every month in order and its date is a real date', () => {
  const months = new Set(); let prev = '';
  for (let i = 0; i < 400; i++) { const f = T.yearFrame(2026, i / 400, 104); months.add(f.m); assert.ok(f.iso >= prev, 'in order'); prev = f.iso; assert.match(f.iso, /^2026-\d\d-\d\d$/); }
  assert.equal(months.size, 12);
  assert.equal(T.dateOfYear(2026, 1).iso, '2026-01-01'); assert.equal(T.dateOfYear(2026, 365).iso, '2026-12-31'); assert.equal(T.dateOfYear(2024, 366).iso, '2024-12-31');
  assert.equal(T.doyOf('2026-10-15'), 288);
  assert.equal(T.monthOf(2026, 0.0), 0); assert.equal(T.monthOf(2026, 0.99), 11);
  assert.ok(Math.abs(T.yearProgress('2026-07-02') - 0.5) < 0.01);
});

// ------------------------------------------------------------------ the sentence and the chart

test('the sun sentence names when the sun reaches the floor, merges the gaps of a mast, and says when there is none', () => {
  assert.equal(T.sunSentence([[580, 795]]), 'Sun on the floor 9:40 am to 1:15 pm');
  assert.equal(T.sunSentence([[580, 640], [660, 795]]), 'Sun on the floor 9:40 am to 10:40 am and 11:00 am to 1:15 pm');
  assert.equal(T.sunSentence([[580, 640], [646, 795]]), 'Sun on the floor 9:40 am to 1:15 pm', 'a six-minute gap does not split it');
  assert.equal(T.sunSentence([]), 'No direct sun on the floor');
  assert.equal(T.sunSentence([[600, 602]]), 'No direct sun on the floor', 'a two-minute flash is not sun on the floor');
  assert.equal(T.clock12(0), '12:00 am'); assert.equal(T.clock12(1275), '9:15 pm');
});

test('several windows reach the floor together: their stretches are merged', () => {
  const u = T.unionSegs([[[580, 640]], [[620, 700], [900, 960]], null]);
  assert.deepEqual(u, [[580, 700], [900, 960]]);
  assert.equal(T.segMinutes(u), 180);
  assert.equal(T.sunNow(u, 600, 30), 'in sun'); assert.equal(T.sunNow(u, 800, 30), 'in shade'); assert.equal(T.sunNow(u, 1300, -20), 'night');
});

test('the month chart has twelve bars scaled to a round maximum', () => {
  const g = T.monthBars([1, 2, 3, 4, 5, 6, 7, 6, 5, 4, 3, 2]);
  assert.equal(g.bars.length, 12); assert.equal(g.max, 8);
  assert.ok(g.bars[6].h > g.bars[0].h && g.bars[6].y < g.bars[0].y);
  assert.equal(T.monthBars(new Array(12).fill(0)).max, 2, 'a window with no sun still has a scale');
  assert.equal(g.cursor(0.5), g.width / 2);
});

// ------------------------------------------------------------------ the night

test('windows are lit after dark by use: offices cool and fewer late, homes warm and fewer late, and an off window stays off', () => {
  const N = 4000, share = (use, late) => { let k = 0; for (let i = 0; i < N; i++) if (F.windowLit(use, late, ((i * 7919) % N) / N, ((i * 104729) % N) / N)) k++; return k / N; };
  for (const use of ['office', 'residential', 'other']) assert.ok(share(use, 1) < share(use, 0) * 0.6, `${use}: fewer lit late`);
  assert.ok(share('office', 1) < 0.1, 'a few cleaners\' floors by the dead of night');
  assert.ok(share('residential', 0) > 0.3 && share('residential', 0) < 0.45);
  assert.ok(share('residential', 0) > share('other', 0));
  for (let i = 0; i < 300; i++) { const w = i / 300, f = (i * 37 % 300) / 300; if (!F.windowLit('residential', 0.4, w, f)) assert.ok(!F.windowLit('residential', 0.9, w, f), 'once off, off for the night'); }
  assert.ok(F.litShare('office', 0) > F.litShare('office', 1));
  assert.equal(F.USE_CODE.office, 1); assert.equal(F.USE_CODE.residential, 2);
});

test('the evening is early until 7 pm and deep night from 11:30 pm', () => {
  assert.equal(F.lateAt(1000), 0); assert.equal(F.lateAt(1140), 0); assert.equal(F.lateAt(1500), 1);
  assert.ok(F.lateAt(1230) > 0 && F.lateAt(1230) < F.lateAt(1320));
});

test('the facade shader reads the night rules from one place and darkens the walls after dusk', () => {
  assert.match(F.FRAG_PARS, /#define RES_W0 0\.360/); assert.match(F.FRAG_PARS, /#define NIGHT_DIM 0\.300/);
  assert.ok(F.FRAG_PARS.includes('uLate') && F.FRAG_COLOR.includes('mix(1.0, NIGHT_DIM, uNight)'));
  assert.ok(F.FRAG_COLOR.includes('useK'), 'the use code rides in aFb.x');
});

test('the lamps stand along the streets, the bridges and the river bank, and nowhere on an alley', () => {
  const plan = LP.lampPlan(site, { center: [0, 0] });
  assert.ok(plan.n > 400 && plan.counts[0] > 300, `street lamps: ${plan.counts}`);
  assert.ok(plan.counts[2] > 5, 'the river bank has lights');
  assert.ok(Array.from(plan.x).every(Number.isFinite) && plan.dropped === 0);
  const near = LP.lampPlan(site, { center: [0, 0], radius: 100 }); assert.ok(near.n < plan.n && near.n > 10);
  const capped = LP.lampPlan(site, { center: [0, 0], cap: 50 }); assert.equal(capped.n, 50); assert.ok(capped.dropped > 0);
  // a bridge street gets its own taller, cooler, closer lamps; an alley none
  const synth = { streets: [{ name: 'Queensboro Bridge', width_m: 20, pts: [[0, 0], [200, 0]] }, { name: 'Alley', width_m: 4, pts: [[0, 50], [200, 50]] }] };
  const s = LP.lampPlan(synth, { center: [100, 0], radius: 300 });
  assert.ok(s.counts[1] >= 20 && s.counts[0] === 0, JSON.stringify(s.counts));
  assert.ok(LP.KINDS[1].height > LP.KINDS[0].height);
});

// ------------------------------------------------------------------ the light through the day

test('the room light changes smoothly through a day: no jump where the sun crosses a threshold', () => {
  let prev = null, worst = 0;
  for (let a = -14; a <= 40; a += 0.25) {
    const s = L.roomLightState({ mood: 'auto', alt: a, quality: 'visual' });
    if (prev) for (const k of ['sunI', 'hemiI', 'ambI', 'glowI', 'exposure', 'lamps']) worst = Math.max(worst, Math.abs(s[k] - prev[k]));
    prev = s;
  }
  assert.ok(worst < 0.4, `largest step between quarter-degree altitudes: ${worst}`);
  const night = L.roomLightState({ mood: 'auto', alt: -20 }), day = L.roomLightState({ mood: 'auto', alt: 50 });
  assert.equal(night.sunI, 0); assert.ok(night.lamps === 1 && day.lamps === 0);
  assert.deepEqual(L.roomLightState({ mood: 'day', sinAlt: 0.8 }), L.roomLightState({ mood: 'day', sinAlt: 0.8, alt: 5 }), 'a fixed mood ignores the altitude');
});

test('the sun is amber near the horizon and near white high up, and fades in over the first degrees', () => {
  assert.ok(L.sunTint(1) === 0xff9a4d && L.sunTint(60) === 0xfff1d6);
  const lo = L.sunTint(8), hi = L.sunTint(25); assert.ok((lo & 0xff) < (hi & 0xff), 'more blue as it climbs');
  assert.equal(L.roomLightState({ mood: 'auto', alt: 0 }).sunI, 0);
  assert.ok(L.roomLightState({ mood: 'auto', alt: 1.5 }).sunI < L.roomLightState({ mood: 'auto', alt: 6 }).sunI);
  assert.ok(L.lampsAt(30) === 0 && L.lampsAt(-10) === 1 && L.lampsAt(0) > 0 && L.lampsAt(0) < 0.75);
});
