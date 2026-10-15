// Which camera Unit 3D opens in: Inside for a home with a floor plan, unless the page address, "See inside" or the renter's saved
// choice says otherwise. Pure logic (dashboard/js/unit/camera-pref.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  askedCamera, cameraParam, openingCamera, mainViewpoint, hasInterior, seeInsideLink, markSeeInside, takeSeeInside, CAMERAS, SAVED_CAMERAS,
} from '../../dashboard/js/unit/camera-pref.js';

test('a page address names a camera: window, inside, outside (orbit), plan and top; anything else names none', () => {
  assert.equal(askedCamera('inside'), 'in');
  assert.equal(askedCamera('in'), 'in');
  assert.equal(askedCamera('window'), 'win');
  assert.equal(askedCamera('win'), 'win');
  for (const m of ['orbit', 'plan', 'top']) assert.equal(askedCamera(m), m);
  for (const m of [null, undefined, '', 'sideways']) assert.equal(askedCamera(m), null);
  assert.equal(askedCamera('Inside'), 'in');
  for (const k of CAMERAS) assert.equal(askedCamera(cameraParam(k)), k, `${k} round-trips through the address`);
});

test('a home with a plan opens Inside, a home without one opens Outside', () => {
  assert.equal(openingCamera({ hasPlan: true }), 'in');
  assert.equal(openingCamera({ hasPlan: false }), 'orbit');
});

test('the renter who chose Outside (or Window view) last time gets it back, even on a home with a plan', () => {
  assert.equal(openingCamera({ saved: 'orbit', hasPlan: true }), 'orbit');
  assert.equal(openingCamera({ saved: 'win', hasPlan: true }), 'win');
  assert.equal(openingCamera({ saved: 'in', hasPlan: true }), 'in');
  assert.equal(openingCamera({ saved: 'win', hasPlan: false }), 'win');
});

test('a saved Inside is not a reason to open a home with no floor plan in a generic room', () => {
  assert.equal(openingCamera({ saved: 'in', hasPlan: false }), 'orbit');
});

test('a page address beats the saved camera and "See inside"; "See inside" beats the saved camera when there is a plan', () => {
  assert.equal(openingCamera({ asked: 'orbit', saved: 'in', intent: true, hasPlan: true }), 'orbit');
  assert.equal(openingCamera({ asked: 'top', hasPlan: true }), 'top');
  assert.equal(openingCamera({ intent: true, saved: 'orbit', hasPlan: true }), 'in');
  assert.equal(openingCamera({ intent: true, saved: 'orbit', hasPlan: false }), 'orbit');
});

test('an unknown saved value is ignored', () => {
  assert.equal(openingCamera({ saved: 'plan', hasPlan: true }), 'in');
  assert.equal(openingCamera({ saved: 'banana', hasPlan: false }), 'orbit');
  assert.deepEqual(SAVED_CAMERAS, ['orbit', 'win', 'in']);
});

test('Inside stands on the sofa first, else in the living room, else in the first room', () => {
  const views = [
    { key: 'room:Bedroom', kind: 'room', room: 'Bedroom', label: 'Bedroom' },
    { key: 'room:Living room', kind: 'room', room: 'Living room', label: 'Living room' },
    { key: 'seat:bed', kind: 'seat', seat: 'bed', label: 'Bed' },
    { key: 'seat:sofa', kind: 'seat', seat: 'sofa', label: 'Sofa' },
  ];
  assert.equal(mainViewpoint(views).key, 'seat:sofa');
  assert.equal(mainViewpoint(views.filter((v) => v.kind !== 'seat')).key, 'room:Living room');
  assert.equal(mainViewpoint(views.slice(0, 1)).key, 'room:Bedroom');
  assert.equal(mainViewpoint([]), null);
  assert.equal(mainViewpoint(undefined), null);
});

test('an interior model needs both a site model and a floor plan in the manifest', () => {
  const m = { sites: ['a', 'b'], plans: ['b', 'c'] };
  assert.equal(hasInterior(m, 'b'), true);
  assert.equal(hasInterior(m, 'a'), false);
  assert.equal(hasInterior(m, 'c'), false);
  assert.equal(hasInterior({}, 'a'), false);
  assert.equal(hasInterior(null, 'a'), false);
});

test('the See inside link goes to Unit 3D, carries the intent marker and escapes the id', () => {
  const html = seeInsideLink('paramount-tower-25e', { icon: '<svg></svg>' });
  assert.match(html, /href="#unit\/paramount-tower-25e"/);
  assert.match(html, /data-see-inside="paramount-tower-25e"/);
  assert.match(html, />See inside<\/a>$/);
  assert.match(seeInsideLink('x"><b>'), /data-see-inside="x&quot;&gt;&lt;b&gt;"/);
});

test('"See inside" is read once, for that home, within 30 seconds; storage that throws means no intent, never an error', () => {
  const mem = new Map();
  globalThis.sessionStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k) };
  markSeeInside('a', 1000);
  assert.equal(takeSeeInside('b', 2000), false, 'another home');
  markSeeInside('a', 1000);
  assert.equal(takeSeeInside('a', 2000), true);
  assert.equal(takeSeeInside('a', 2000), false, 'read once');
  markSeeInside('a', 1000);
  assert.equal(takeSeeInside('a', 1000 + 31000), false, 'too old');
  globalThis.sessionStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
  assert.doesNotThrow(() => markSeeInside('a'));
  assert.equal(takeSeeInside('a'), false);
  delete globalThis.sessionStorage;
});
