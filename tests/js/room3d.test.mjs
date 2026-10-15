// The shared room and city (dashboard/js/room3d, js/city3d), the pure parts: what a window is made of (no black bar, posts only where the glass needs
// them, 5 cm members), the room's light by mood and quality, the "What's measured vs assumed" rows for Paramount Tower 25E, and the sun strip.
// The three.js side and the cross-engine alignment are covered in tests/e2e/test_one_city.py.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const W = await import(new URL('../../dashboard/js/room3d/windows-core.js', import.meta.url));
const Lt = await import(new URL('../../dashboard/js/room3d/lighting-core.js', import.meta.url));
const A = await import(new URL('../../dashboard/js/room3d/accuracy.js', import.meta.url));
const S = await import(new URL('../../dashboard/js/room3d/sunlink.js', import.meta.url));
const json = (p) => JSON.parse(readFileSync(new URL(`../../dashboard/data/${p}`, import.meta.url), 'utf8'));

// ------------------------------------------------------------------ windows

const pane = (o = {}) => ({ len: 81, sill: 20, head: 94, ...o });

test('a window has a sill and a head member and end posts, and no horizontal bar between them', () => {
  const L = W.windowLayout(pane());
  assert.equal(L.rails.length, 2);
  assert.deepEqual(L.rails.map((r) => r.z), [20, 94 - W.FRAME.member]);                  // the frame's own sill and head, at the glass edges
  assert.ok(L.rails.every((r) => r.h <= W.FRAME.member + 1e-9));
  assert.equal(L.posts.length, 2);                                                       // the two ends: no mullion every 40 in any more
  assert.ok(L.glass.length === 1 && L.glass[0].z0 === 20 && L.glass[0].z1 === 94 && L.glass[0].s1 - L.glass[0].s0 === 81);   // one unbroken pane of glass as wide as the window, no transom in it
});

test('a tall window never gets a transom unless the plan asks for one', () => {
  const tall = W.windowLayout(pane({ sill: 2, head: 96 }));                              // 94 in of glass: the old code put a dark rail across it
  assert.equal(tall.rails.length, 2);
  const asked = W.windowLayout(pane({ sill: 2, head: 96, transom: 70 }));
  assert.equal(asked.rails.length, 3);
  assert.ok(asked.glass.length === 2);                                                   // the rail splits the glass in two, and only then
  assert.equal(W.windowLayout(pane({ transom: 500 })).rails.length, 2);                  // an impossible height is ignored
});

test('members are 5 cm and stay inside the glass span: nothing runs past the ends of the window', () => {
  assert.ok(Math.abs(W.FRAME.member * 0.0254 - 0.05) < 0.002);
  const L = W.windowLayout(pane({ mullions: [0.5] }));
  const half = 81 / 2;
  for (const p of L.posts) assert.ok(Math.abs(p.s) + p.w / 2 <= half + 1e-9 && p.w === W.FRAME.member, `post at ${p.s}`);
  for (const g of L.glass) assert.ok(g.s0 >= -half - 1e-9 && g.s1 <= half + 1e-9 && g.s1 > g.s0);
  assert.equal(L.posts.length, 3);                                                       // two ends and the one the plan lists
  assert.equal(L.glass.length, 2);
});

test('mullions come only from the plan, and only inside the window', () => {
  assert.equal(W.windowLayout(pane({ mullions: [] })).posts.length, 2);
  assert.equal(W.windowLayout(pane({ mullions: [0.01, 0.99, -1, NaN, 'x'] })).posts.length, 2);
  assert.equal(W.windowLayout(pane({ mullions: [0.33, 0.66] })).posts.length, 4);
});

test('where panes of a bay meet, one pane draws the shared post', () => {
  const a = W.windowLayout(pane(), { skipA: false, skipB: false }), b = W.windowLayout(pane(), { skipA: true, skipB: false });
  assert.equal(a.posts.length, 2); assert.equal(b.posts.length, 1);
  assert.ok(b.glass[0].s0 <= -81 / 2 + 1e-9 && b.glass[0].s1 >= 81 / 2 - 1e-9);          // the glass runs right up to the corner the neighbour's post covers
});

test('the Paramount 25E plan has a three-pane bay and its windows carry no transom or mullions', () => {
  const plan = json('plans/paramount-tower-25e.json');
  assert.equal(plan.windows.length, 6);
  assert.ok(plan.windows.every((w) => w.transom == null && w.mullions == null));
});

// ------------------------------------------------------------------ light

test('the room is bright by day and warm and never black after dark', () => {
  const day = Lt.roomLightState({ mood: 'day', sinAlt: 0.95 }), eve = Lt.roomLightState({ mood: 'evening', sinAlt: 0.05 }), night = Lt.roomLightState({ mood: 'night' });
  assert.ok(day.hemiI >= 1.5 && day.ambI >= 0.4 && day.sunI > 6 && day.glowI > 2);        // hemisphere sky light, bounce fill, sun and window glow
  assert.equal(day.lamps, 0); assert.equal(eve.lamps, 0.75); assert.equal(night.lamps, 1);
  assert.equal(night.sunI, 0);
  assert.ok(night.hemiI > 0.3 && night.ambI > 0.25, 'a room with no lamp placed is not black');
  assert.ok(night.ambColor !== day.ambColor && (night.ambColor >> 16) === 0xff && (night.ambColor & 0xff) < 0xb0, 'warm fill after dark');   // red channel full, blue low
  assert.ok(day.exposure < eve.exposure && eve.exposure < night.exposure);
});

test('Visual tone-maps with ACES, Fast with a gentler curve, and both are the same brightness class', () => {
  const v = Lt.roomLightState({ mood: 'day', quality: 'visual' }), f = Lt.roomLightState({ mood: 'day', quality: 'fast' });
  assert.equal(v.tone, 'aces'); assert.equal(f.tone, 'reinhard');
  assert.ok(v.hemiI < f.hemiI);                                                          // Visual adds an environment light, so the hemisphere steps back
  assert.ok(f.exposure > v.exposure && f.exposure < v.exposure * 2);
});

test('the Light tab scales (glazing, blinds, ambient) reach the sun, the glow and the fill', () => {
  const base = Lt.roomLightState({ mood: 'day', sinAlt: 0.8 }), dim = Lt.roomLightState({ mood: 'day', sinAlt: 0.8, scale: { sun: 0.1, sky: 0.1, ambient: 0.5 } });
  assert.ok(dim.sunI < base.sunI * 0.15 && dim.glowI < base.glowI * 0.15 && dim.hemiI < base.hemiI * 0.6);
  assert.equal(Lt.roomLightState({ mood: 'day', shaded: true }).glowI, Lt.roomLightState({ mood: 'day' }).glowI * 0.55);
});

test('auto mood follows the sun: day, a low evening sun, night', () => {
  assert.equal(Lt.moodFor('auto', true, 0.9), 'day');
  assert.equal(Lt.moodFor('auto', true, 0.05), 'evening');
  assert.equal(Lt.moodFor('auto', false, 0), 'night');
  assert.equal(Lt.moodFor('night', true, 0.9), 'night');
});

// ------------------------------------------------------------------ what is measured and what is assumed

test('Paramount 25E: six rows with the states the task names', () => {
  const site = json('sites/paramount-tower-25e.json'), plan = json('plans/paramount-tower-25e.json');
  const rows = A.accuracyRows({ site, plan, cal: { state: 'estimated', fh: 3.08, slab: 70.8 }, floor: 25, facing: 118.7, t: 0.55, furniture: { name: 'Your furniture', confirmed: { by: 'renter', date: '2026-10-15' }, count: 10 } });
  const by = Object.fromEntries(rows.map((r) => [r.key, r]));
  assert.deepEqual(rows.map((r) => r.key), ['heights', 'bearing', 'position', 'floor-height', 'plan', 'furniture']);
  assert.equal(by.heights.state, 'source'); assert.match(by.heights.text, /PLUTO/);
  assert.equal(by.bearing.state, 'measured'); assert.match(by.bearing.text, /119°.*photos/);
  assert.equal(by.position.state, 'assumed');
  assert.equal(by['floor-height'].state, 'estimated'); assert.match(by['floor-height'].text, /3\.08 m/);
  assert.equal(by.plan.state, 'source'); assert.match(by.plan.text, /Glenwood(?:'|&#39;)s E-line drawing/);
  assert.equal(by.furniture.state, 'confirmed'); assert.match(by.furniture.text, /2026-10-15/);
  assert.match(A.accuracySummary(rows), /1 measured · 1 confirmed · 2 from a source · 1 estimated · 1 assumed/);
});

test('a measured slab, a generic room and no furniture each change their row', () => {
  const site = json('sites/paramount-tower-25e.json');
  const rows = A.accuracyRows({ site, plan: null, cal: { state: 'measured', fh: 3.2, slab: 70 }, floor: 25, furniture: null });
  const by = Object.fromEntries(rows.map((r) => [r.key, r]));
  assert.equal(by['floor-height'].state, 'measured'); assert.equal(by.plan.state, 'assumed'); assert.equal(by.furniture.state, 'assumed');
  assert.equal(A.accuracyRows({ site: {}, plan: null }).find((r) => r.key === 'heights').state, 'assumed');   // no building model: said so
});

test('row text never carries markup from a data file', () => {
  const site = { b: [], bmeta: [], provenance: { exposure: 'photo-landmarks', basis: '<img src=x onerror=alert(1)>' } };
  const t = A.accuracyRows({ site, plan: { source: '<b>x</b>', provenance: {} } }).map((r) => r.text).join(' ');
  assert.ok(!t.includes('<img') && !t.includes('<b>'));
});

// ------------------------------------------------------------------ the sun strip

test('the sun strip draws the lit stretches of the day and where the clock is', () => {
  const bars = S.stripBars([[420, 600], [900, 1000]]);
  assert.equal(bars.length, 2);
  assert.ok(bars[0].left > 10 && bars[0].left < 20 && bars[0].width > 15 && bars[0].width < 22);
  assert.deepEqual(S.stripBars([[0, 200], [1300, 1400]]), []);                          // outside the strip's range
  assert.equal(S.stripAt(300), 0); assert.equal(S.stripAt(1230), 100); assert.equal(S.stripAt(0), 0);
  assert.equal(S.hm(0), 'none'); assert.equal(S.hm(192), '3 h 12'); assert.equal(S.hm(45), '45 m'); assert.equal(S.hm(120), '2 h');
});

test('the sun group says withheld windows have no sun number and links into Unit 3D', () => {
  assert.match(S.sunGroupHTML({ minutes: null }), /not computed/);
  const h = S.sunGroupHTML({ minutes: 192, segs: [[420, 600]], min: 780, label: 'Living room' });
  assert.match(h, /3 h 12/); assert.match(h, /living room window/); assert.match(h, /data-act="unit-sun"/);
});
