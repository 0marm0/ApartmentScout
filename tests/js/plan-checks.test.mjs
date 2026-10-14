// node --test tests/js : furniture fit rules (overlaps, doors, clearance zones, TV, headboard, auto-place)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalisePlan } from '../../dashboard/js/plan/model.js';
import { resolve, CATALOG } from '../../dashboard/js/plan/catalog.js';
import { satDepth, overlaps, footprint, rotRect, evaluate, gapRays, swingPoly, tvSeats, fov, viewTag, findSpot, rayPoly, measureZone, obstacles, toWorld } from '../../dashboard/js/plan/checks.js';

// A 12 x 14 ft bedroom: window on the top wall, a door on the bottom wall swinging in.
const ROOM = normalisePlan({
  units: 'ft', ceiling: 9, wall: 0.4, up_bearing: 180,
  rooms: [{ name: 'Bedroom', kind: 'bedroom', x: 0, y: 0, w: 12, h: 14 }],
  windows: [{ room: 'Bedroom', x1: 3, y1: 14, x2: 9, y2: 14, sill: 2, head: 8 }],
  doors: [{ x1: 8, y1: 0, x2: 11, y2: 0, hinge: 'b', swing: '+y', room: 'Bedroom', name: 'bedroom door' }],
  fixtures: [{ kind: 'ac', label: 'AC', x: 0.2, y: 9, w: 0.8, h: 3.5, height: 2, est: true }],
});
const item = (ref, x, y, rot = 0, extra = {}) => resolve({ id: extra.id || ref, ref, x, y, rot, ...extra });
const issues = (ev, id) => ev.items[id].issues.map((i) => i.code);

test('rotated rectangles: separating axis test', () => {
  const a = rotRect(0, 0, 10, 10, 0), b = rotRect(9, 0, 10, 10, 0), c = rotRect(11, 0, 10, 10, 0);
  assert.ok(overlaps(a, b));
  assert.ok(!overlaps(a, c));
  assert.equal(satDepth(a, rotRect(10, 0, 10, 10, 0)), 0); // touching is not overlapping
  // a 45 degree square whose corner just misses the other square's corner
  assert.ok(!overlaps(rotRect(0, 0, 10, 10, 0), rotRect(12.5, 12.5, 10, 10, 45)));
  assert.ok(overlaps(rotRect(0, 0, 10, 10, 0), rotRect(10, 0, 10, 10, 45)));
});

test('footprint follows the rotation convention: rot is the direction the back points', () => {
  const bed = item('queen-bed', 100, 100, 90);
  const xs = footprint(bed).map((p) => p[0]);
  assert.equal(Math.round(Math.max(...xs) - Math.min(...xs)), 84); // depth now runs along x
  const back = toWorld(bed, 0, bed.d / 2);
  assert.equal(Math.round(back[0]), 142); // back is to the right
});

test('ray to polygon distance', () => {
  const sq = [[10, -5], [20, -5], [20, 5], [10, 5]];
  assert.equal(rayPoly([0, 0], [1, 0], sq), 10);
  assert.equal(rayPoly([15, 0], [1, 0], sq), 0);
  assert.equal(rayPoly([0, 0], [-1, 0], sq, 99), 99);
});

test('a bed floating in the room is clear; against the window it breaks the headboard rule', () => {
  const ok = evaluate(ROOM, [item('queen-bed', 60, 84, 270, { id: 'bed' })]);
  assert.equal(ok.items.bed.state, 'clear', JSON.stringify(ok.items.bed.issues));
  const bad = evaluate(ROOM, [item('queen-bed', 72, 168 - 2.4 - 42, 0, { id: 'bed' })]);
  assert.ok(issues(bad, 'bed').includes('headboard-window'));
  assert.equal(bad.items.bed.state, 'blocked');
});

test('walls, overlaps and the outside of the plan are blocked', () => {
  const ev = evaluate(ROOM, [item('dresser', 2, 60, 270, { id: 'd' }), item('nightstand', 60, 60, 0, { id: 'a' }), item('nightstand', 70, 60, 0, { id: 'b' })]);
  assert.ok(issues(ev, 'd').includes('wall'));
  assert.ok(issues(ev, 'a').includes('overlap') && issues(ev, 'b').includes('overlap'));
  const out = evaluate(ROOM, [item('nightstand', -40, 60, 0, { id: 'o' })]);
  assert.ok(issues(out, 'o').includes('outside'));
});

test('height-aware: a wall TV above a low dresser does not overlap it', () => {
  const tv = item('tv-55', 72, 168 - 2.4 - 1.75, 0, { id: 'tv' }); // on the top wall, but that has a window
  const solidTv = item('tv-55', 2.4 + 1.75, 60, 270, { id: 'tv' });
  const dresser = item('nightstand', 2.4 + 8, 60, 270, { id: 'dr' });
  const ev = evaluate(ROOM, [solidTv, dresser]);
  assert.ok(!issues(ev, 'tv').includes('overlap'));
  assert.ok(!issues(ev, 'dr').includes('overlap'));
  assert.ok(!issues(ev, 'tv').includes('tv-wall'), JSON.stringify(ev.items.tv.issues));
  const glass = evaluate(ROOM, [tv]);
  assert.ok(issues(glass, 'tv').includes('tv-wall'), 'a TV in front of the window has no solid wall');
  const floating = evaluate(ROOM, [item('tv-55', 72, 84, 0, { id: 'tv' })]);
  assert.match(floating.items.tv.issues.find((i) => i.code === 'tv-wall').text, /Not against a wall/);
});

test('door swing: furniture in the arc is blocked', () => {
  const sw = swingPoly(ROOM.doorways[0]);
  assert.ok(sw.length > 3);
  const ev = evaluate(ROOM, [item('nightstand', 9 * 12, 18, 0, { id: 'n' })]);
  assert.ok(issues(ev, 'n').includes('door'));
  assert.match(ev.items.n.issues[0].text, /bedroom door/);
});

test('clearance zones grade clear, tight and blocked by measured free depth', () => {
  // dresser with its back on the left wall, drawers facing right; a nightstand in front at varying gaps
  const dresser = (gap) => [item('dresser', 2.4 + 9.85, 60, 270, { id: 'dr' }), item('nightstand', 2.4 + 19.7 + gap + 8, 60, 270, { id: 'n' })];
  const grade = (gap) => evaluate(ROOM, dresser(gap)).items.dr.zones[0].grade;
  assert.equal(grade(34), 'clear');
  assert.equal(grade(26), 'tight');
  assert.equal(grade(12), 'blocked');
  const z = evaluate(ROOM, dresser(12)).items.dr.zones[0];
  assert.equal(Math.round(z.free), 12);
  assert.equal(z.blocker.id, 'n');
});

test('bed sides: one free side is enough, both blocked is not', () => {
  const corner = evaluate(ROOM, [item('queen-bed', 2.4 + 32, 2.4 + 42 + 40, 0, { id: 'bed' })]);
  assert.ok(!corner.items.bed.issues.some((i) => /side/.test(i.text)), JSON.stringify(corner.items.bed.issues));
  const squeezed = evaluate(ROOM, [item('queen-bed', 72, 84, 0, { id: 'bed' }), item('wardrobe', 72 - 32 - 6 - 11.45, 84, 270, { id: 'w1', w: 90 }), item('wardrobe', 72 + 32 + 6 + 11.45, 84, 90, { id: 'w2', w: 90 })]);
  assert.ok(squeezed.items.bed.issues.some((i) => /No side/.test(i.text)));
  // nightstands at the head do not block the walk along the bed
  const withStands = evaluate(ROOM, [item('queen-bed', 2.4 + 42, 70, 270, { id: 'bed' }), item('nightstand', 2.4 + 8, 70 - 32 - 9, 270, { id: 'n1' })]);
  assert.equal(withStands.items.bed.state, 'clear', JSON.stringify(withStands.items.bed.issues));
});

test('sofa legroom ignores the coffee table', () => {
  const ev = evaluate(ROOM, [item('sofa-3', 72, 2.4 + 18 + 30, 180, { id: 's' }), item('coffee-table', 72, 2.4 + 36 + 30 + 16 + 12, 0, { id: 't' })]);
  assert.ok(!ev.items.s.issues.some((i) => i.code === 'zone'), JSON.stringify(ev.items.s.issues));
});

test('AC front clearance blames the furniture in it', () => {
  const ev = evaluate(ROOM, [item('nightstand', 12 + 10, 9 * 12 + 21, 270, { id: 'n' })]);
  const ac = ev.fixtures.find((f) => f.fixture.kind === 'ac');
  assert.equal(ac.grade, 'blocked');
  assert.deepEqual(ac.blockers, ['n']);
  assert.ok(issues(ev, 'n').includes('fixture-zone'));
});

test('TV viewing distance by field of view, per seat', () => {
  assert.equal(viewTag(fov(48.4, 60)), 'close');
  assert.equal(viewTag(fov(48.4, 90)), 'ideal');
  assert.equal(viewTag(fov(48.4, 120)), 'workable');
  assert.equal(viewTag(fov(48.4, 200)), 'too far');
  const tv = item('tv-55', 2.4 + 1.75, 84, 270, { id: 'tv' });
  const bed = item('queen-bed', 144 - 2.4 - 42, 84, 90, { id: 'bed' });
  const seats = tvSeats(ROOM, [tv, bed], tv);
  assert.equal(seats.length, 2);
  const pillows = seats.find((s) => s.seat === 'Bed, pillows');
  assert.ok(Math.abs(pillows.dist - (144 - 2.4 - 42 + 20 - (2.4 + 3.5))) < 1);
  assert.equal(Math.round(pillows.off), 0);
});

test('gap rays measure free space on each side of the selection', () => {
  const items = [item('dresser', 2.4 + 9.85, 60, 270, { id: 'dr' }), item('nightstand', 2.4 + 19.7 + 20 + 8, 60, 270, { id: 'n' })];
  const g = gapRays(ROOM, items, 'dr');
  const front = g.find((r) => r.side === 'front');
  assert.equal(Math.round(front.d), 20);
  assert.equal(g.find((r) => r.side === 'back')?.d ?? 0, 0);
});

test('measureZone ignores the item itself and low wall-mounted things', () => {
  const bed = item('queen-bed', 60, 2.4 + 42, 180, { id: 'bed' });
  const tv = item('tv-55', 60, 2.4 + 84 + 15, 0, { id: 'tv' }); // mounted 34 in up, in the foot zone
  const obs = obstacles(ROOM, [tv, bed]);
  const foot = measureZone(bed, bed.zones.find((z) => z.side === 'front'), obs);
  assert.equal(foot.grade, 'clear');
});

test('auto-place finds a clear spot with the back to a wall', () => {
  const items = [item('queen-bed', 72, 84, 270, { id: 'bed' }), item('dresser', 72, 84, 0, { id: 'dr' })];
  const s = findSpot(ROOM, items, 'dr', 'Bedroom');
  assert.ok(s, 'a spot exists');
  const placed = items.map((x) => (x.id === 'dr' ? { ...x, ...s } : x));
  const ev = evaluate(ROOM, placed);
  assert.notEqual(ev.items.dr.state, 'blocked', JSON.stringify(ev.items.dr.issues));
});

test('every catalogue item resolves with positive sizes and known zone sides', () => {
  for (const ref of Object.keys(CATALOG)) {
    const r = resolve({ id: 'x', ref, x: 0, y: 0, rot: 0 });
    assert.ok(r.w > 0 && r.d > 0 && r.h > 0, ref);
    for (const z of r.zones) assert.ok(['front', 'back', 'left', 'right'].includes(z.side) && z.min <= z.preferred, `${ref} ${z.name}`);
    assert.ok(CATALOG[ref].src, `${ref} cites a source`);
  }
  assert.equal(resolve({ id: 'f', ref: 'futon', x: 0, y: 0, variant: 'bed' }).d, 55.125);
  assert.equal(resolve({ id: 'f', ref: 'nope', x: 0, y: 0 }), null);
});

test('the documented example plan and the shipped presets fit cleanly', async () => {
  const fs = await import('node:fs');
  const md = fs.readFileSync(new URL('../../docs/guides/floor-plans.md', import.meta.url), 'utf8');
  const doc = JSON.parse(md.match(/```json\n(\{\n {2}"schema": 2[\s\S]*?\n\})\n```/)[1]);
  const ship = JSON.parse(fs.readFileSync(new URL('../../examples/nyc-2026/plans/emerald-green-1211.json', import.meta.url), 'utf8'));
  for (const raw of [doc, ship]) {
    const m = normalisePlan(raw);
    for (const L of m.layouts) {
      const ev = evaluate(m, L.items.map((x) => resolve(x)));
      assert.equal(ev.counts.blocked + ev.counts.tight, 0, `${raw.id} ${L.id}: ${JSON.stringify(Object.values(ev.items).flatMap((r) => r.issues.map((i) => `${r.id}: ${i.text}`)))}`);
    }
  }
});
