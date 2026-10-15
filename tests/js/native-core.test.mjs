// node --test tests/js : the phone app's decisions without a DOM (dashboard/js/features/native-core.js): sheet detents, gesture
// axes, pull to refresh, the long-press menu, the share text, the install guide and the offline tile pack.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as N from '../../dashboard/js/features/native-core.js';

const H = N.detentHeights(844);

test('detent heights: peek < half < full, full keeps the map edge, a short phone keeps a usable peek', () => {
  assert.deepEqual(H, { peek: 338, half: 540, full: 743 });
  const small = N.detentHeights(568);
  assert.ok(small.peek >= 300 && small.peek < small.half && small.half < small.full);
});

test('a slow release settles at the nearest detent, a flick goes one detent further', () => {
  assert.equal(N.snapDetent(H.half + 20, 0, H), 'half');
  assert.equal(N.snapDetent(H.half + 120, 0, H), 'full', 'past the midpoint of half and full');
  assert.equal(N.snapDetent(H.half - 20, 0.8, H), 'full', 'a flick up from just under half skips to full');
  assert.equal(N.snapDetent(H.full - 5, -0.9, H), 'half', 'a flick down from full stops at half, not at the bottom');
  assert.equal(N.snapDetent(H.peek, -0.9, H), 'closed', 'a hard flick down from peek closes');
  assert.equal(N.snapDetent(H.peek - 30, 0, H), 'peek');
  assert.equal(N.snapDetent(H.peek * 0.4, 0, H), 'closed', 'dragged well below peek');
  assert.equal(N.snapDetent(H.peek * 0.4, 0.3, H), 'peek', 'the same drag with a little upward momentum comes back to peek');
});

test('above full the sheet rubber-bands and never passes full by much; at the bottom it stops', () => {
  assert.equal(N.dragVisible(H.full - 10, H), H.full - 10);
  const over = N.dragVisible(H.full + 400, H);
  assert.ok(over > H.full && over < H.full + 80);
  assert.equal(N.dragVisible(-50, H), 0);
  assert.ok(N.rubber(10) < 10 && N.rubber(1000) < 160 && N.rubber(0) === 0 && N.rubber(-5) === 0);
});

test('an axis is chosen only after the slop, and a diagonal leans vertical', () => {
  assert.equal(N.lockAxis(3, 4), null);
  assert.equal(N.lockAxis(20, 4), 'x');
  assert.equal(N.lockAxis(4, 20), 'y');
  assert.equal(N.lockAxis(12, 12), 'y', 'a 45 degree drag is a scroll, not a page turn');
});

test('swiping between homes: far or fast commits, left is next, short and slow springs back', () => {
  assert.equal(N.homeSwipe(-130, 0, 390), 1);
  assert.equal(N.homeSwipe(130, 0, 390), -1);
  assert.equal(N.homeSwipe(-60, 0, 390), 0);
  assert.equal(N.homeSwipe(-60, -0.8, 390), 1, 'a quick flick of 60 px counts');
  assert.equal(N.homeSwipe(-20, -0.9, 390), 0, 'but not a twitch');
});

test('neighbours stop at the ends and ignore an id that is not listed', () => {
  const ids = ['a', 'b', 'c'];
  assert.equal(N.neighbour(ids, 'b', 1), 'c');
  assert.equal(N.neighbour(ids, 'b', -1), 'a');
  assert.equal(N.neighbour(ids, 'a', -1), null);
  assert.equal(N.neighbour(ids, 'c', 1), null);
  assert.equal(N.neighbour(ids, 'zz', 1), null);
});

test('pull to refresh is damped, capped, and triggers past its threshold', () => {
  assert.ok(N.pullTravel(40) < 40);
  assert.ok(N.pullTravel(2000) <= N.PULL_MAX);
  assert.equal(N.shouldRefresh(N.pullTravel(60)), false);
  assert.equal(N.shouldRefresh(N.pullTravel(180)), true);
  for (let a = 0, b = 0; a < 600; a += 25) { const t = N.pullTravel(a); assert.ok(t >= b, 'monotonic'); b = t; }
});

test('quick actions follow what the home has and its state', () => {
  const keys = (has, st) => N.quickActions(has, st).map((a) => a.key);
  assert.deepEqual(keys({}, {}), ['save', 'compare', 'share', 'open']);
  assert.deepEqual(keys({ interior: true, site: true }, {}), ['save', 'compare', 'inside', 'share', 'open']);
  assert.deepEqual(keys({ site: true }, {}), ['save', 'compare', 'unit', 'share', 'open']);
  const a = N.quickActions({}, { saved: true, comparing: true });
  assert.equal(a[0].label, 'Remove from picks'); assert.equal(a[1].label, 'Remove from compare'); assert.ok(a[0].on && a[1].on);
});

test('the share text carries the facts and nothing private', () => {
  const t = N.shareSummary({ name: 'Paramount Tower 25E', address: '240 East 39th Street', neighborhood: 'Murray Hill', beds: 1, cost: 5031.6, commuteMin: 10.4, commuteTo: 'Grand Central', score: 76.8, note: 'secret' });
  assert.equal(t, 'Paramount Tower 25E\n240 East 39th Street, Murray Hill\n1 bd · $5,032/mo · 10 min to Grand Central · score 77');
  assert.ok(!t.includes('secret'));
  assert.equal(N.shareSummary({ name: 'X' }), 'X');
  assert.match(N.shareSummary({ name: 'S', beds: 0 }), /studio/);
});

const SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
test('iPhone browsers are told apart; an iPad posing as a Mac is still an iPad', () => {
  assert.equal(N.iosBrowser(SAFARI), 'safari');
  assert.equal(N.iosBrowser(SAFARI.replace('Version/17.5', 'CriOS/126.0') ), 'chrome');
  assert.equal(N.iosBrowser(SAFARI + ' FxiOS/127'), 'firefox');
  assert.equal(N.iosBrowser(SAFARI + ' Instagram 300'), 'inapp');
  assert.equal(N.iosBrowser('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605 Version/17 Safari/605', 'MacIntel', 5), 'safari');
  assert.equal(N.iosBrowser('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605', 'MacIntel', 0), null, 'a real Mac');
  assert.equal(N.iosBrowser('Mozilla/5.0 (Linux; Android 14) Chrome/126'), null);
});

test('the install guide waits for a return visit, backs off after "not now", and never shows once installed', () => {
  const g = (o) => N.guideDecision({ browser: 'safari', visits: 2, now: 1e12, ...o });
  assert.equal(g({}), 'show');
  assert.equal(g({ visits: 1 }), 'first-visit');
  assert.equal(g({ standalone: true }), 'installed');
  assert.equal(g({ browser: null }), 'not-ios');
  assert.equal(g({ browser: 'inapp' }), 'in-app');
  assert.equal(g({ never: true }), 'never');
  assert.equal(g({ dismissedAt: 1e12 - 3 * 86400000 }), 'snoozed');
  assert.equal(g({ dismissedAt: 1e12 - 15 * 86400000 }), 'show', 'asked again after two weeks');
  assert.equal(g({ forced: true, visits: 1, never: true }), 'show');
  assert.equal(g({ forced: true, standalone: true }), 'installed', 'even forced, an installed app has nothing to install');
});

// ------------------------------------------------------------------ tiles
test('a lon/lat falls in the tile the slippy-map maths says (Grand Central at zoom 14)', () => {
  assert.deepEqual(N.lonLatToTile(-73.9772, 40.7527, 14), { x: 4825, y: 6157 });
  assert.deepEqual(N.lonLatToTile(-73.9772, 40.7527, 0), { x: 0, y: 0 });
});

test('a circle covers the tiles it touches, at least the one it stands on', () => {
  const t = N.tilesAround(40.7527, -73.9772, 14, 1100);
  assert.ok(t.some((x) => x.x === 4825 && x.y === 6157));
  assert.ok(t.length >= 1 && t.length <= 9);
  assert.ok(t.every((x) => x.z === 14));
});

test('the pack is capped, de-duplicated, wide zooms first, and stays under the provider\'s limits', () => {
  const places = [{ lat: 40.7527, lon: -73.9772 }, { lat: 40.7527, lon: -73.9772 }, { lat: 40.7455, lon: -73.9788 }, { lat: 40.7305, lon: -73.9905 }];
  const p = N.planPack(places);
  assert.equal(new Set(p.tiles.map(N.tileKey)).size, p.tiles.length, 'no tile twice');
  assert.equal(p.places, 4);
  assert.ok(p.tiles[0].z < 14, 'the wide zooms come first');
  assert.equal(p.tiles.at(-1).z, 14);
  assert.ok(p.tiles.length <= N.PACK.maxTiles && N.PACK.maxTiles < N.PACK.policyTiles);
  assert.ok(N.PACK.maxBytes < N.PACK.policyBytes && N.PACK.parallel <= 4);
  const wide = N.planPack(Array.from({ length: 400 }, (_, i) => ({ lat: 40.0 + (i % 20) * 0.06, lon: -75 + Math.floor(i / 20) * 0.06 })));
  assert.equal(wide.tiles.length, N.PACK.maxTiles); assert.equal(wide.capped, true);
  assert.deepEqual(N.planPack([{ lat: NaN, lon: 1 }, null]).tiles, []);
});

test('a tile url keeps its place when the weekly version folder changes', () => {
  const t = { z: 14, x: 4825, y: 6156 };
  assert.equal(N.tileUrl('https://tiles.openfreemap.org/planet/20261011_080001_pt/{z}/{x}/{y}.pbf', t), 'https://tiles.openfreemap.org/planet/20261011_080001_pt/14/4825/6156.pbf');
  const a = N.normalizeTileUrl('https://tiles.openfreemap.org/planet/20261011_080001_pt/14/4825/6156.pbf');
  const b = N.normalizeTileUrl('https://tiles.openfreemap.org/planet/20261018_080001_pt/14/4825/6156.pbf');
  assert.equal(a, 'https://tiles.openfreemap.org/planet/14/4825/6156.pbf'); assert.equal(a, b);
  assert.equal(N.normalizeTileUrl('https://tiles.openfreemap.org/planet'), 'https://tiles.openfreemap.org/planet');
  assert.equal(N.normalizeTileUrl('https://other.example/planet/2026_x/1/2/3.pbf'), 'https://other.example/planet/2026_x/1/2/3.pbf');
});

test('sw.js normalises tile urls exactly as the page does', () => {
  globalThis.self ??= { registration: { scope: 'https://u.github.io/app/demo/' }, addEventListener() {}, location: { href: 'https://u.github.io/app/demo/sw.js' } };
  const sw = createRequire(import.meta.url)('../../dashboard/sw.js');
  for (const u of ['https://tiles.openfreemap.org/planet/20261011_080001_pt/14/4825/6156.pbf', 'https://tiles.openfreemap.org/planet', 'https://tiles.openfreemap.org/fonts/Noto%20Sans%20Bold/0-255.pbf',
    'https://server.arcgisonline.com/x/tile/3/1/2', 'https://tiles.openfreemap.org/planet/20261011_080001_pt/14/4825/6156.pbf?x=1']) {
    assert.equal(sw.normalizeTileUrl(u), N.normalizeTileUrl(u), u);
  }
});

test('which basemap allows a saved area: only OpenFreeMap', () => {
  assert.equal(N.basemapPolicy('openfreemap').pack, true);
  for (const k of ['esri', 'custom', 'offline', undefined]) assert.equal(N.basemapPolicy(k).pack, false, String(k));
  assert.match(N.basemapPolicy('esri').note, /only the part of the map you look at/i);
  assert.equal(N.glyphUrls().length, 6);
});

test('byte labels', () => {
  assert.equal(N.bytesLabel(900), '900 B'); assert.equal(N.bytesLabel(2048), '2 KB'); assert.equal(N.bytesLabel(5 * 1048576), '5.0 MB'); assert.equal(N.bytesLabel(38 * 1048576), '38 MB');
});
