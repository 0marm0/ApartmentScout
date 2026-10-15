// The photo view solver (dashboard/js/unit/view-solver.js): synthetic photos with known answers, noise tolerance, and what the
// clicks cannot determine. A seeded generator keeps every number reproducible.
import test from 'node:test';
import assert from 'node:assert/strict';

const root = new URL('../../', import.meta.url);
const V = await import(new URL('dashboard/js/unit/view-solver.js', root));

// mulberry32: a small seeded generator
const rng = (seed) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const gauss = (r) => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (tol ${tol})`);

// the "truth": a window on the east side of a tower, floor 24
const TRUE = { bearing: 119, tilt: 4, vfov: 52, x: 34, y: 0.4, z: 72 };
const ASPECT = 1.5;
// landmarks by (bearing offset from the optical axis, horizontal distance, height of the point): near, middle and far
const spec = (offs, dists, tops) => offs.map((o, i) => {
  const b = (TRUE.bearing + o) * V.DEG;
  return { name: `L${i + 1}`, x: TRUE.x + Math.sin(b) * dists[i], y: TRUE.y + Math.cos(b) * dists[i], z: tops[i] };
});
const photoOf = (cam, lms, noise = 0, r = null) => lms.map((l) => {
  const q = V.project(cam, l); assert.ok(q, `${l.name} is in front of the camera`);
  return { ...l, px: { x: q.x + (noise ? gauss(r) * noise : 0), y: q.y + (noise ? gauss(r) * noise : 0) } };
});
const LMS3 = () => spec([-22, 3, 20], [220, 700, 2100], [95, 190, 320]);
const LMS4 = () => spec([-24, -8, 6, 22], [150, 480, 1100, 2400], [60, 140, 240, 380]);

test('photo coordinates round-trip and a point on the axis lands at the centre', () => {
  const p = V.photoPoint(0.25, 0.4, 1.5);
  near(p.x, -0.375, 1e-12, 'x'); near(p.y, 0.1, 1e-12, 'y');
  const f = V.photoFraction(p, 1.5); near(f.u, 0.25, 1e-12, 'u'); near(f.v, 0.4, 1e-12, 'v');
  const a = V.directionTo(TRUE, { x: TRUE.x + Math.sin(119 * V.DEG) * 500, y: TRUE.y + Math.cos(119 * V.DEG) * 500, z: TRUE.z + 500 * Math.tan(4 * V.DEG) });
  const q = V.project(TRUE, { x: TRUE.x + Math.sin(119 * V.DEG) * 500, y: TRUE.y + Math.cos(119 * V.DEG) * 500, z: TRUE.z + 500 * Math.tan(4 * V.DEG) });
  near(q.x, 0, 1e-9, 'centre x'); near(q.y, 0, 1e-9, 'centre y'); near(a.elevation, 4, 1e-9, 'elevation');
  const back = V.rayAt(TRUE, 0.2, -0.1), q2 = V.project(TRUE, { x: TRUE.x + Math.sin(back.bearing * V.DEG) * 100 * Math.cos(back.elevation * V.DEG), y: TRUE.y + Math.cos(back.bearing * V.DEG) * 100 * Math.cos(back.elevation * V.DEG), z: TRUE.z + 100 * Math.sin(back.elevation * V.DEG) });
  near(q2.x, 0.2, 1e-9, 'rayAt inverts project x'); near(q2.y, -0.1, 1e-9, 'rayAt inverts project y');
});

test('field of view helpers agree', () => {
  near(V.hfovOf(52, 1.5), 2 * Math.atan(1.5 * Math.tan(26 * V.DEG)) / V.DEG, 1e-9, 'hfov');
  near(V.vfovFromHfov(V.hfovOf(52, 1.5), 1.5), 52, 1e-9, 'vfov from hfov');
  near(V.vfovFromFocal(V.focalOf(70)), 70, 1e-9, 'focal');
});

test('three exact landmarks recover bearing, tilt, lens and eye height', () => {
  const r = V.solveView({ landmarks: photoOf(TRUE, LMS3()), eye: { x: TRUE.x, y: TRUE.y, z: 66 }, aspect: ASPECT });
  assert.ok(r.ok);
  near(r.bearing_deg, 119, 0.02, 'bearing'); near(r.tilt_deg, 4, 0.05, 'tilt'); near(r.vfov_deg, 52, 0.2, 'lens'); near(r.eye_height_m, 72, 0.5, 'eye');
  assert.ok(r.rms_deg < 0.02, `exact clicks fit exactly: ${r.rms_deg}`);
  assert.equal(r.eye_determined, true); assert.equal(r.lens_determined, true); assert.equal(r.quality, 'good');
  near(r.hfov_deg, V.hfovOf(52, ASPECT), 0.4, 'hfov');
});

test('two landmarks with a known lens recover bearing, tilt and eye height', () => {
  const lms = photoOf(TRUE, spec([-18, 17], [160, 2200], [70, 330]));
  const r = V.solveView({ landmarks: lms, eye: { x: TRUE.x, y: TRUE.y, z: 66 }, aspect: ASPECT, vfov0: 52 });
  assert.ok(r.ok); assert.equal(r.free.includes('vfov'), false);
  near(r.bearing_deg, 119, 0.05, 'bearing'); near(r.tilt_deg, 4, 0.1, 'tilt'); near(r.eye_height_m, 72, 1, 'eye');
  assert.equal(r.eye_determined, true);
  assert.ok(r.warnings.some((w) => /third|Two landmarks/i.test(w)), 'two landmarks say there is nothing to check against');
});

test('two landmarks at the same distance cannot fix the eye height: the model height is kept and says so', () => {
  const lms = photoOf(TRUE, spec([-15, 16], [900, 900], [150, 260]));
  const r = V.solveView({ landmarks: lms, eye: { x: TRUE.x, y: TRUE.y, z: 66 }, aspect: ASPECT, vfov0: 52 });
  assert.ok(r.ok);
  assert.equal(r.eye_determined, false); assert.equal(r.sigma.eye, null);
  assert.equal(r.eye_height_m, 66, 'the model height is kept');
  near(r.bearing_deg, 119, 0.3, 'the bearing is still measured');
  assert.ok(r.warnings.some((w) => /same distance/.test(w)));
});

test('a wrong lens guess biases two landmarks only a little in bearing', () => {
  const lms = photoOf(TRUE, spec([-18, 17], [160, 2200], [70, 330]));
  const r = V.solveView({ landmarks: lms, eye: { x: TRUE.x, y: TRUE.y, z: 66 }, aspect: ASPECT, vfov0: 60 });
  near(r.bearing_deg, 119, 3, 'bearing with an 8 degree wrong lens');
});

test('noise tolerance: click errors of 0.3% of the photo height over many trials', () => {
  const r = rng(7), N = 120, errs = { bearing: [], tilt: [], eye: [], vfov: [], rms: [] };
  for (let t = 0; t < N; t++) {
    const lms = photoOf(TRUE, LMS4(), 0.003, r);
    const s = V.solveView({ landmarks: lms, eye: { x: TRUE.x, y: TRUE.y, z: 64 }, aspect: ASPECT });
    assert.ok(s.ok);
    errs.bearing.push(V.angDiff(s.bearing_deg, 119)); errs.tilt.push(s.tilt_deg - 4); errs.eye.push(s.eye_height_m - 72); errs.vfov.push(s.vfov_deg - 52); errs.rms.push(s.rms_deg);
  }
  const rmsOf = (a) => Math.sqrt(a.reduce((x, y) => x + y * y, 0) / a.length), mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  assert.ok(rmsOf(errs.bearing) < 0.2, `bearing rms error ${rmsOf(errs.bearing)}`);
  assert.ok(rmsOf(errs.tilt) < 0.35, `tilt rms error ${rmsOf(errs.tilt)}`);
  assert.ok(rmsOf(errs.vfov) < 0.6, `lens rms error ${rmsOf(errs.vfov)}`);
  assert.ok(rmsOf(errs.eye) < 1.5, `eye rms error ${rmsOf(errs.eye)}`);
  assert.ok(Math.abs(mean(errs.bearing)) < 0.1, 'no bias in bearing');
  assert.ok(mean(errs.rms) < 0.3, `the residual stays small: ${mean(errs.rms)}`);
});

test('the reported uncertainty is honest: about two thirds of eye heights fall within one sigma', () => {
  const r = rng(11); let within = 0, total = 0;
  for (let t = 0; t < 150; t++) {
    const s = V.solveView({ landmarks: photoOf(TRUE, LMS4(), 0.003, r), eye: { x: TRUE.x, y: TRUE.y, z: 70 }, aspect: ASPECT });
    if (s.eye_determined) { total++; if (Math.abs(s.eye_height_m - 72) <= s.sigma.eye * 1.5) within++; }
  }
  assert.ok(total > 100, `the eye height is determined for these landmarks (${total}/150)`);
  assert.ok(within / total > 0.75, `1.5 sigma covers ${within}/${total}`);
});

test('a mismatched landmark shows up as a large residual and a poor grade', () => {
  const lms = photoOf(TRUE, LMS4());
  lms[1] = { ...lms[1], px: { x: lms[1].px.x + 0.18, y: lms[1].px.y - 0.05 } };   // the renter clicked the wrong tower
  const s = V.solveView({ landmarks: lms, eye: { x: TRUE.x, y: TRUE.y, z: 72 }, aspect: ASPECT });
  assert.ok(s.ok);
  assert.ok(s.max_deg > 1.5, `max residual ${s.max_deg}`);
  assert.notEqual(s.quality, 'good');
});

test('fewer than two landmarks, a landmark at the window, and a missing eye are refused with a reason', () => {
  const e = { x: 0, y: 0, z: 50 };
  assert.equal(V.solveView({ landmarks: [], eye: e }).ok, false);
  const one = V.solveView({ landmarks: [{ x: 0, y: 500, z: 100, px: { x: 0, y: 0 } }], eye: e });
  assert.equal(one.ok, false); assert.match(one.reason, /one more|two/i);
  assert.equal(V.solveView({ landmarks: [{ x: 0, y: 0.2, z: 100, px: { x: 0, y: 0 } }, { x: 0, y: 500, z: 100, px: { x: 0, y: 0 } }], eye: e }).ok, false);
  assert.equal(V.solveView({ landmarks: [], eye: { x: NaN, y: 0, z: 1 } }).ok, false);
});

test('a bearing near north (wrap-around) is solved and normalised to 0-360', () => {
  const cam = { bearing: 358, tilt: -3, vfov: 50, x: 0, y: 0, z: 60 };
  const lms = ((offs, dists, tops) => offs.map((o, i) => { const b = (358 + o) * V.DEG; return { name: `N${i}`, x: Math.sin(b) * dists[i], y: Math.cos(b) * dists[i], z: tops[i] }; }))([-20, 2, 19], [200, 650, 1900], [90, 150, 300]);
  const s = V.solveView({ landmarks: photoOf(cam, lms), eye: { x: 0, y: 0, z: 60 }, aspect: ASPECT });
  near(V.angDiff(s.bearing_deg, 358), 0, 0.03, 'bearing'); assert.ok(s.bearing_deg >= 0 && s.bearing_deg < 360);
});

test('held values stay held', () => {
  const s = V.solveView({ landmarks: photoOf(TRUE, LMS3()), eye: { x: TRUE.x, y: TRUE.y, z: 66 }, aspect: ASPECT, fixed: { vfov: 52 } });
  assert.equal(s.vfov_deg, 52); assert.equal(s.free.includes('vfov'), false);
  const h = V.solveView({ landmarks: photoOf(TRUE, LMS3()), eye: { x: TRUE.x, y: TRUE.y, z: 66 }, aspect: ASPECT, fixed: { h: 72 } });
  assert.equal(h.eye_height_m, 72); near(h.bearing_deg, 119, 0.03, 'bearing');
});

test('a photo contained in a wider or taller canvas keeps its scale', () => {
  const a = V.containedPhoto(52, 1.5, 900, 450);   // canvas wider than the photo: full height shows, letterboxed at the sides
  near(a.vfov, 52, 1e-9, 'vfov'); near(a.rect.h, 450, 1e-9, 'height'); near(a.rect.w, 675, 1e-9, 'width'); near(a.rect.x, 112.5, 1e-9, 'x');
  const b = V.containedPhoto(52, 1.5, 600, 600);   // a taller canvas: the photo's width fills it, the camera sees more above and below
  assert.ok(b.vfov > 52); near(b.rect.w, 600, 1e-9, 'width');
  // same focal length in pixels
  near(V.focalOf(b.vfov) * 600, V.focalOf(52) * b.rect.h, 1e-6, 'focal pixels');
});

test('describeFit puts the answer in words', () => {
  const s = V.solveView({ landmarks: photoOf(TRUE, LMS3()), eye: { x: TRUE.x, y: TRUE.y, z: 66 }, aspect: ASPECT });
  const t = V.describeFit(s);
  assert.match(t, /Looks toward 119° ESE/); assert.match(t, /4\.0° up/); assert.match(t, /fits within/);
  assert.match(V.describeFit({ ok: false, reason: 'Mark at least two landmarks.' }), /Mark at least two/);
});
