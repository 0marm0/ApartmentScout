// node --test tests/js : photo grouping, ordering, counts and fallbacks (dashboard/js/features/photos.js)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  GROUP_KEYS, groupOf, photoItems, countsOf, countParts, countLabel, countSentence, heroOf, imageLists, ownFallback, inGroup, tabsOf, captionText,
} from '../../dashboard/js/features/photos.js';
import { imagesOf, imgFallback } from '../../dashboard/js/util.js';

const listing = (o = {}) => ({ id: 'x-1', building: 'X', ...o });
const urls = (L) => photoItems(L).map((it) => it.url);

test('scope strings map to lightbox groups, with a default for missing scopes', () => {
  assert.equal(groupOf('exact-unit', 'building'), 'unit');
  assert.equal(groupOf('same-line', 'unit'), 'line');
  assert.equal(groupOf('same-building', 'unit'), 'building');
  assert.equal(groupOf('building', 'unit'), 'building');
  assert.equal(groupOf('street', 'building'), 'street');
  assert.equal(groupOf(undefined, 'unit'), 'unit');
  assert.equal(groupOf('something-new', 'building'), 'building');
});

test('photos sort unit, same line, building, floor plans, street; the data order holds inside a group', () => {
  const L = listing({
    photos: ['https://a/1.jpg', 'https://a/2.jpg', 'https://a/3.jpg', 'https://a/4.jpg'],
    photos_meta: [{ scope: 'same-building' }, { scope: 'same-line' }, {}, { scope: 'exact-unit' }],
    building_photos: [{ url: 'https://c/s.jpg', scope: 'street' }, { url: 'https://c/b1.jpg', scope: 'building' }, { url: 'https://c/b2.jpg' }],
    floorplan_images: ['https://p/plan.png'],
  });
  assert.deepEqual(urls(L), ['https://a/3.jpg', 'https://a/4.jpg', 'https://a/2.jpg', 'https://a/1.jpg', 'https://c/b1.jpg', 'https://c/b2.jpg', 'https://p/plan.png', 'https://c/s.jpg']);
  assert.deepEqual(photoItems(L).map((it) => it.group), ['unit', 'unit', 'line', 'building', 'building', 'building', 'plan', 'street']);
  assert.deepEqual(GROUP_KEYS, ['unit', 'line', 'building', 'plan', 'street']);
});

test('a photo flagged as carrying a broker mark goes to the end of its own group only', () => {
  const L = listing({
    photos_local: ['media/x-1/p-1.webp', 'media/x-1/p-2.webp', 'media/x-1/p-3.webp'],
    photos: ['https://a/1.jpg', 'https://a/2.jpg', 'https://a/3.jpg'],
    building_photos: [{ url: 'media/x-1/b-1.webp', scope: 'building' }, { url: 'media/x-1/b-2.webp', scope: 'building' }],
    photo_flags: { 'media/x-1/p-1.webp': { watermark: true, why: ['phone number'] }, 'media/x-1/b-1.webp': { watermark: true, why: ['web address'] } },
  });
  assert.deepEqual(urls(L), ['media/x-1/p-2.webp', 'media/x-1/p-3.webp', 'media/x-1/p-1.webp', 'media/x-1/b-2.webp', 'media/x-1/b-1.webp']);
  const flagged = photoItems(L).filter((it) => it.flagged);
  assert.deepEqual(flagged.map((it) => [it.url, it.why]), [['media/x-1/p-1.webp', ['phone number']], ['media/x-1/b-1.webp', ['web address']]]);
  assert.equal(heroOf(L).url, 'media/x-1/p-2.webp');
});

test('a flag may be keyed by the original link as well as the saved path; a flag without watermark does not count', () => {
  const L = listing({ photos_local: ['media/x-1/p-1.webp', 'media/x-1/p-2.webp'], photos: ['https://a/1.jpg', 'https://a/2.jpg'],
    photo_flags: { 'https://a/1.jpg': { watermark: true, why: ['email'] }, 'media/x-1/p-2.webp': { why: ['face'] } } });
  assert.deepEqual(urls(L), ['media/x-1/p-2.webp', 'media/x-1/p-1.webp']);
});

test('a saved copy falls back to its original link; links with no copy have none; unsafe links are dropped', () => {
  const L = listing({ photos_local: ['media/x-1/p-1.webp'], photos: ['https://a/1.jpg', 'https://a/2.jpg', 'javascript:alert(1)', 'ftp://a/4.jpg'] });
  assert.deepEqual(urls(L), ['media/x-1/p-1.webp', 'https://a/2.jpg']);
  assert.equal(ownFallback(L, 0), 'https://a/1.jpg');
  assert.equal(ownFallback(L, 1), null);
  // a missing saved copy no longer needs an onerror attribute: one page-wide listener walks the photo's chain (media-chain.js)
  assert.equal(imgFallback(L, 0), '');
  assert.equal(imgFallback(L, 7), '');
});

test('imagesOf keeps its { own, building } shape, now in display order, without duplicates', () => {
  const L = listing({ photos: ['https://a/1.jpg', 'https://a/1.jpg', 'https://a/2.jpg'], photos_meta: [{ scope: 'same-building' }, { scope: 'same-building' }, {}],
    building_photos: [{ url: 'https://c/b.jpg', author: 'Ann', license: 'CC BY', scope: 'building' }, { url: 'nope' }] });
  const im = imagesOf(L);
  assert.deepEqual(im.own, ['https://a/2.jpg', 'https://a/1.jpg']);
  assert.equal(im.building.length, 1);
  assert.equal(im.building[0].url, 'https://c/b.jpg');
  assert.equal(im.building[0].author, 'Ann');
  assert.deepEqual(imageLists(listing()), { own: [], building: [] });
  assert.deepEqual(imagesOf(listing({ photos: null, building_photos: null })), { own: [], building: [] });
});

test('floor plans: the saved copy is shown with its link as fallback; links alone are shown when there is no copy', () => {
  const both = listing({ floorplan_images: ['https://p/fp.webp', 'media/x-1/fp-1.webp'] });
  const [p] = photoItems(both);
  assert.equal(photoItems(both).length, 1);
  assert.deepEqual([p.url, p.remote, p.group], ['media/x-1/fp-1.webp', 'https://p/fp.webp', 'plan']);
  const only = listing({ floorplan_images: ['https://p/fp.webp'], links: { floorplan: 'https://p/other.png' } });
  assert.deepEqual(urls(only), ['https://p/fp.webp', 'https://p/other.png']);
  assert.equal(heroOf(only), null, 'a plan is never a card photo');
});

test('counts by group, card labels and the spoken breakdown', () => {
  const mk = (u, l, b, p, s) => ({ unit: u, line: l, building: b, plan: p, street: s });
  assert.deepEqual(countParts(mk(8, 0, 22, 1, 0)), [{ n: 8, word: 'unit' }, { n: 22, word: 'building' }]);
  assert.equal(countLabel(mk(8, 0, 22, 1, 0)), '8 unit · 22 building');
  assert.equal(countLabel(mk(12, 0, 0, 0, 0)), '12 photos');
  assert.equal(countLabel(mk(1, 0, 0, 0, 0)), '1 photo');
  assert.equal(countLabel(mk(0, 0, 20, 0, 0)), '20 building');
  assert.equal(countLabel(mk(0, 0, 0, 3, 0)), '', 'plans are not photos');
  assert.equal(countLabel(mk(2, 1, 24, 1, 0)), '2 unit · 24 building', 'three groups: the two largest, in display order');
  assert.equal(countLabel(mk(5, 9, 3, 0, 0)), '5 unit · 9 same line');
  assert.equal(countSentence(mk(8, 2, 22, 1, 0)), '8 of the unit, 2 of the same line, 22 of the building, 1 floor plan');
  const L = listing({ photos: ['https://a/1.jpg', 'https://a/2.jpg'], building_photos: [{ url: 'https://c/b.jpg' }] });
  assert.deepEqual(countsOf(photoItems(L)), { unit: 2, line: 0, building: 1, plan: 0, street: 0 });
});

test('tabs list only groups that have images; inGroup filters', () => {
  const L = listing({ photos: ['https://a/1.jpg'], building_photos: [{ url: 'https://c/b.jpg' }, { url: 'https://c/s.jpg', scope: 'street' }] });
  const items = photoItems(L);
  assert.deepEqual(tabsOf(items).map((t) => [t.key, t.label, t.n]), [['unit', 'Unit', 1], ['building', 'Building', 1], ['street', 'Street', 1]]);
  assert.equal(inGroup(items, 'all').length, 3);
  assert.deepEqual(inGroup(items, 'street').map((i) => i.url), ['https://c/s.jpg']);
});

test('captions carry title, author, licence and source; generic building titles are left out', () => {
  const L = listing({ building_photos: [{ url: 'https://c/b.jpg', title: 'X · building image', author: 'Ann', license: 'CC BY 4.0', license_url: 'https://cc/by', page: 'https://commons/x', source: 'Wikimedia Commons' }],
    photos: ['https://a/1.jpg'], photos_meta: [{ title: '25E living room', credit: 'Renter photo', source: 'renter', page: 'https://s/x' }] });
  const [own, bld] = photoItems(L);
  assert.equal(captionText(own), '25E living room · Renter photo · renter');
  assert.equal(captionText(bld), 'Ann · CC BY 4.0 · Wikimedia Commons');
  assert.equal(bld.credit.licenseUrl, 'https://cc/by');
  assert.equal(photoItems(listing({ photos: ['https://a/1.jpg'] }))[0].credit.note, 'Listing photo, copyright its owner');
});

test('the shipped example: every listing sorts cleanly and flagged photos trail their groups', () => {
  const rows = JSON.parse(fs.readFileSync(new URL('../../examples/nyc-2026/listings.json', import.meta.url), 'utf8'));
  let flagged = 0, photos = 0;
  for (const L of rows) {
    const items = photoItems(L);
    photos += items.length;
    let lastGroup = -1;
    const seenFlag = {};
    for (const it of items) {
      const g = GROUP_KEYS.indexOf(it.group);
      assert.ok(g >= lastGroup, `${L.id}: groups out of order`);
      lastGroup = g;
      if (it.flagged) { flagged++; seenFlag[it.group] = true; } else assert.ok(!seenFlag[it.group], `${L.id}: a clean photo follows a flagged one in ${it.group}`);
      assert.match(it.url, /^(https?:\/\/|media\/)/);
    }
    assert.deepEqual([...new Set(imagesOf(L).own)], imagesOf(L).own);
    const h = heroOf(L);
    if (h) assert.notEqual(h.group, 'plan');
  }
  assert.ok(flagged > 300, `expected the review's flags in the data, saw ${flagged}`);
  assert.ok(photos > 5000);
});
