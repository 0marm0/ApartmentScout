// Bay and multi-pane windows in dashboard/js/sun.js: the sun is in the room when it is above the skyline
// and in front of at least one pane (the union), side-pane-only slots get their own day-strip state, and
// blocker attribution names the building that shades each slot.
import test from 'node:test';
import assert from 'node:assert/strict';

const S = await import(new URL('../../dashboard/js/sun.js', import.meta.url));
const NYC = { lat: 40.755, lon: -73.993, tz: 'America/New_York' };
const open = new Float32Array(S.NB); // no skyline at all

test('pane facings wrap around north', () => {
  assert.deepEqual(S.paneFacings(10, S.BAY), [325, 10, 55]);
  assert.deepEqual(S.paneFacings(180), [180]);
  assert.ok(S.inFront(80, 180, S.BAY), 'the SE pane of a south bay sees an east sun');
  assert.ok(!S.inFront(80, 180), 'the flat south pane does not');
});

test('a south bay gets more December sun than the flat pane when the SE pane sees the morning', () => {
  const tab = S.dayTable(2026, 11, 15, NYC.lat, NYC.lon, NYC.tz, 6);
  const flat = S.litInfo(tab, open, 180), bay = S.litInfo(tab, open, 180, 6, S.BAY);
  assert.ok(bay.min >= flat.min);
  // a NW facade misses the December sun; its 270 degree bay pane catches the afternoon
  const nwFlat = S.litInfo(tab, open, 315), nwBay = S.litInfo(tab, open, 315, 6, S.BAY);
  assert.ok(nwBay.min > nwFlat.min, `NW bay ${nwBay.min} > flat ${nwFlat.min}`);
  assert.equal(nwBay.panes.length, 3);
  assert.ok(nwBay.min >= Math.max(...nwBay.panes), 'the union is at least the best single pane');
  assert.ok(nwBay.side > 0, 'some minutes come only through a side pane');
  // one pane on its own equals the flat window with that bearing
  assert.equal(nwBay.panes[1], nwFlat.min);
});

test('single-pane calls keep the old result shape', () => {
  const tab = S.dayTable(2026, 5, 21, NYC.lat, NYC.lon, NYC.tz, 6);
  const r = S.litInfo(tab, open, 200);
  assert.deepEqual(Object.keys(r).sort(), ['min', 'segs']);
});

test('day strip: state 4 marks sun through a side pane only', () => {
  const st = S.dayStates(2026, 11, 15, NYC.lat, NYC.lon, NYC.tz, open, 315, 300, 1290, 5, S.BAY);
  const flat = S.dayStates(2026, 11, 15, NYC.lat, NYC.lon, NYC.tz, open, 315, 300, 1290, 5);
  assert.ok(st.includes(4));
  assert.ok(!flat.includes(4));
  for (let k = 0; k < st.length; k++) {
    if (flat[k] === 3) assert.equal(st[k], 3, 'the main pane wins when it is lit');
    if (st[k] === 4) assert.equal(flat[k], 1, 'side-pane sun is behind the flat facade');
  }
});

test('blocker attribution names the box south of the window in every shaded slot', () => {
  // a 60 m box 20 m south of a south-facing window at 10 m: shades the low winter sun
  const box = [60, 0, 0, [-40, -50, 40, -50, 40, -20, -40, -20]];
  const B = S.prepBuildings([box]);
  const pt = { x: 0, y: 0, z: 10 }, prof = S.horizonProfile(B, pt.x, pt.y, pt.z);
  const r = S.dayBlockers(2026, 11, 15, NYC.lat, NYC.lon, NYC.tz, B, pt, prof, 180);
  let shaded = 0;
  for (let k = 0; k < r.states.length; k++) if (r.states[k] === 2) { shaded++; assert.equal(r.bi[k], 0); } else assert.equal(r.bi[k], -1);
  assert.ok(shaded > 20, `shaded slots ${shaded}`);
  const m = S.blockerMinutes(r);
  assert.equal(m.get(0), shaded * 5);
});

test('distance and bearing helpers', () => {
  const B = S.prepBuildings([[30, 0, 0, [10, -5, 20, -5, 20, 5, 10, 5]]]);
  assert.equal(S.distToBuilding(B[0], 0, 0), 10);
  assert.equal(S.distToBuilding(B[0], 15, 0), 0);
  assert.equal(Math.round(S.bearingTo(0, 0, 10, 0)), 90);
  assert.equal(S.skylineSetter(B, 0, 0, 5, 90), 0);
  assert.equal(S.skylineSetter(B, 0, 0, 5, 270), -1);
});
