// The saved photo match (dashboard/js/unit/view-calibration.js): a strict record, its storage, the measured height it stands for, and what the
// accuracy chip says about it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../../', import.meta.url);
const VC = await import(new URL('dashboard/js/unit/view-calibration.js', root));
const V = await import(new URL('dashboard/js/unit/view-solver.js', root));
const A = await import(new URL('dashboard/js/room3d/accuracy.js', root));
const C = await import(new URL('dashboard/js/unit/calibration.js', root));
const site = JSON.parse(fs.readFileSync(new URL('examples/nyc-2026/sites/paramount-tower-25e.json', root)));

const CAM = { bearing: 121, tilt: 4, vfov: 52, x: 34, y: 0.4, z: 99 };
const lm = (off, d, z, name) => { const b = (121 + off) * V.DEG; return { name, x: 34 + Math.sin(b) * d, y: 0.4 + Math.cos(b) * d, z }; };
const LMS = [lm(-20, 160, 120, 'A'), lm(2, 700, 200, 'B'), lm(18, 2000, 330, 'C')].map((l) => { const q = V.project(CAM, l); return { ...l, px: q && { x: q.x, y: q.y } }; });
const result = V.solveView({ landmarks: LMS, eye: { x: 34, y: 0.4, z: 96 }, aspect: 1.5 });
const record = (over = {}) => VC.buildViewCal({
  site: 'paramount-tower-25e', photo: { n: 1, path: 'media/shared/x.webp', title: '32E living/dining (E line, virtually staged)', scope: 'same-line', floor: 32, aspect: 1.5, source: 'listing' },
  eye: { x: 34, y: 0.4, z: 96 }, landmarks: LMS.map((l, i) => ({ name: l.name, kind: i === 2 ? 'picked' : 'named', x: l.x, y: l.y, z: l.z, u: V.photoFraction(l.px, 1.5).u, v: V.photoFraction(l.px, 1.5).v })),
  result, applied: { az_deg: 121, floor: 24, facade_offset_deg: 2.3 }, saved: '2026-10-15T12:00:00.000Z', ...over,
});

test('a record is built, rounded and validated', () => {
  const r = record();
  assert.ok(r); assert.equal(r.kind, VC.VIEWCAL_KIND); assert.equal(r.schema, 1);
  assert.ok(Math.abs(r.result.bearing_deg - 121) < 0.05 && r.result.n === 3 && r.landmarks.length === 3);
  assert.equal(VC.parseViewCal(JSON.stringify(r)).ok, true);
  assert.deepEqual(VC.parseViewCal(JSON.stringify(r)).record, r);   // normalising twice changes nothing
});

test('anything out of range or malformed refuses the whole record', () => {
  const r = record();
  const bad = [
    { ...r, kind: 'other' }, { ...r, schema: 2 }, { ...r, site: '../etc' }, { ...r, landmarks: r.landmarks.slice(0, 1) },
    { ...r, photo: { ...r.photo, floor: 0 } }, { ...r, result: { ...r.result, bearing_deg: 400 } }, { ...r, result: { ...r.result, rms_deg: NaN } },
    { ...r, landmarks: r.landmarks.map((l) => ({ ...l, u: 'x' })) }, null, 'text', [],
  ];
  for (const b of bad) assert.equal(VC.normaliseViewCal(b), null, JSON.stringify(b)?.slice(0, 60));
  assert.equal(VC.parseViewCal('{not json').ok, false);
  assert.equal(VC.parseViewCal('x'.repeat(300000)).ok, false);
});

test('text fields never carry markup', () => {
  const r = VC.normaliseViewCal({ ...record(), photo: { ...record().photo, title: '<img src=x onerror=alert(1)>' } });
  assert.ok(!/[<>]/.test(r.photo.title));
});

test('a determined eye height becomes a measured eye height at the photo floor; an undetermined one measures nothing', () => {
  const r = record({ result: { ...result, eye_determined: true, sigma: { ...result.sigma, eye: 2.5 } } });
  const m = VC.measuredFromViewCal(r);
  assert.equal(m.kind, 'eye'); assert.equal(m.floor, 32); assert.equal(m.spread, 'scale'); assert.match(m.src, /^photo 1, ±2\.5 m/);
  assert.ok(C.resolveCal({ base: 0, fhEst: 3.08 }, m).state === 'measured');
  assert.equal(VC.measuredFromViewCal(record({ result: { ...result, eye_determined: false } })), null);
  const s = VC.stateFromViewCal(r);
  assert.equal(s.az, 121); assert.equal(s.floor, 32); assert.equal(s.photoN, 1);
});

test('labels read well', () => {
  const r = record();
  assert.equal(VC.photoLabel(r), 'photo 1 (32E living/dining (E line, virtually staged))'.replace(' (virtually staged)', ''));
  assert.match(VC.fitLabel(r), /^fits within 0\.\d+° on 3 landmarks$/);
});

test('local storage round-trips and ignores a damaged entry', () => {
  const mem = new Map(), storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k) };
  const r = record();
  assert.ok(VC.saveLocal(r, { storage }));
  assert.deepEqual(VC.loadLocal('paramount-tower-25e', { storage }), r);
  mem.set(VC.VC_PREFIX + 'paramount-tower-25e', '{"kind":"x"}');
  assert.equal(VC.loadLocal('paramount-tower-25e', { storage }), null);
  mem.set(VC.VC_PREFIX + 'paramount-tower-25e', 'not json');
  assert.equal(VC.loadLocal('paramount-tower-25e', { storage }), null);
  assert.equal(VC.loadLocal('../x', { storage }), null);
  assert.equal(VC.saveLocal(r, { storage: null }), null);
});

test('saving goes to the search folder when the local API takes it, else to the browser, and a read-only example falls back', async () => {
  const mem = new Map(), storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k) };
  const r = record();
  const ok = { available: async () => true, saveViewCal: async () => ({ path: 'view-calibrations/paramount-tower-25e.json' }) };
  const a = await VC.saveViewCal(r, { api: ok, storage });
  assert.equal(a.where, 'search folder'); assert.match(a.path, /view-calibrations/);
  const ro = { available: async () => true, saveViewCal: async () => { throw Object.assign(new Error('read-only example'), { status: 403 }); } };
  assert.equal((await VC.saveViewCal(r, { api: ro, storage })).where, 'this browser');
  assert.equal((await VC.saveViewCal(r, { api: null, storage })).where, 'this browser');
  const broken = { available: async () => true, saveViewCal: async () => { throw Object.assign(new Error('boom'), { status: 500 }); } };
  await assert.rejects(VC.saveViewCal(r, { api: broken, storage }), /boom/);
  await assert.rejects(VC.saveViewCal({ nope: 1 }, { storage }), /not valid/);
});

test('loading takes the search folder copy and this browser copy, the newer one', async () => {
  const mem = new Map(), storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k) };
  const older = record({ saved: '2026-10-01T00:00:00.000Z' }), newer = record({ saved: '2026-10-15T00:00:00.000Z' });
  VC.saveLocal(older, { storage });
  const fetchJSON = async () => newer;
  const got = await VC.loadViewCal('paramount-tower-25e', { base: 'data', manifest: { view_calibrations: ['paramount-tower-25e'] }, fetchJSON, storage });
  assert.equal(got.saved, newer.saved);
  const none = await VC.loadViewCal('paramount-tower-25e', { base: 'data', manifest: {}, fetchJSON, storage });
  assert.equal(none.saved, older.saved);   // not listed in the manifest: the file is not even asked for
  assert.equal(await VC.loadViewCal('other-unit', { manifest: {}, fetchJSON, storage }), null);
});

test('export is the record as a file the CLI can import', () => {
  const f = VC.exportViewCal(record());
  assert.equal(f.filename, 'paramount-tower-25e.view-calibration.json');
  assert.equal(VC.parseViewCal(f.text).ok, true);
  assert.throws(() => VC.exportViewCal({}), /not valid/);
});

test('the accuracy chip says "measured from photo N" for the bearing and, when the photo fixed it, the floor height', () => {
  const r = record({ result: { ...result, eye_determined: true, sigma: { ...result.sigma, eye: 2.5 } } });
  const measured = VC.measuredFromViewCal(r), cal = C.resolveCal({ base: 0, fhEst: 3.08 }, measured);
  const rows = A.accuracyRows({ site, plan: null, cal: { state: cal.state, fh: cal.fh, slab: cal.slabAt(24), src: measured.src }, floor: 24, facing: 121, t: 0.55, viewCal: r });
  const by = Object.fromEntries(rows.map((x) => [x.key, x]));
  assert.equal(by.bearing.state, 'measured'); assert.match(by.bearing.text, /measured from photo 1/); assert.match(by.bearing.text, /fits within/);
  assert.equal(by['floor-height'].state, 'measured'); assert.match(by['floor-height'].text, /Measured from photo 1.*floor 32/);
  // a photo that could not fix the height leaves the floor height an estimate and says why
  const weak = record({ result: { ...result, eye_determined: false } });
  const rows2 = A.accuracyRows({ site, plan: null, cal: { state: 'estimated', fh: 3.08, slab: 70.8 }, floor: 24, facing: 121, viewCal: weak });
  const h = rows2.find((x) => x.key === 'floor-height');
  assert.equal(h.state, 'estimated'); assert.match(h.text, /could not fix the camera height/);
  assert.equal(rows2.find((x) => x.key === 'bearing').state, 'measured');
  // markup in a stored title never reaches the chip
  const t = VC.normaliseViewCal({ ...record(), photo: { ...record().photo, title: '<b>x</b>' } });
  assert.ok(!A.accuracyRows({ site, plan: null, viewCal: t }).map((x) => x.text).join(' ').includes('<b>'));
});
