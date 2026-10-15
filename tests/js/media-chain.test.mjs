// The photo resolution chain: media/ -> media-lite/ -> the published copy -> the original link (dashboard/js/features/media-chain.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEAD_AFTER, configureMedia, normalizeBase, chainOf, pathOf, remoteUrl, rememberOriginal, mediaSrc, failed, loaded, isDead, mediaStats, installMediaFallback,
} from '../../dashboard/js/features/media-chain.js';
import { photoItems } from '../../dashboard/js/features/photos.js';

const PAGE = 'http://127.0.0.1:8000/demo/';
const BASE = 'https://pages.example.test/app/demo/media/';
const reset = (o = {}) => configureMedia({ page: PAGE, base: BASE, ...o });

test('normalizeBase keeps http(s) folders with a trailing slash and refuses everything else', () => {
  assert.equal(normalizeBase('https://a.test/x/media'), 'https://a.test/x/media/');
  assert.equal(normalizeBase('  https://a.test/x/media///'), 'https://a.test/x/media/');
  assert.equal(normalizeBase('http://127.0.0.1:9/m/'), 'http://127.0.0.1:9/m/');
  for (const bad of [null, undefined, '', 5, 'javascript:alert(1)', 'data:image/png;base64,AA', '//a.test/m/', 'https://a.test/m/?q=1', 'https://u:p\u0040a.test/m/', 'ftp://a.test/m/']) assert.equal(normalizeBase(bad), null, String(bad));
});

test('the chain is media, media-lite, the published copy, the original link, in that order', () => {
  reset();
  rememberOriginal('media/chain-a/p-1.webp', 'https://cdn.example/1.jpg');
  assert.deepEqual(chainOf('media/chain-a/p-1.webp'), [
    { tier: 'media', url: 'media/chain-a/p-1.webp' }, { tier: 'lite', url: 'media-lite/chain-a/p-1.webp' },
    { tier: 'remote', url: BASE + 'chain-a/p-1.webp' }, { tier: 'orig', url: 'https://cdn.example/1.jpg' }]);
  assert.deepEqual(chainOf('media/chain-b/p-2.webp').map((c) => c.tier), ['media', 'lite', 'remote'], 'no original link known');
  reset({ base: null });
  assert.deepEqual(chainOf('media/chain-a/p-1.webp').map((c) => c.tier), ['media', 'lite', 'orig'], 'no published copy');
  assert.deepEqual(chainOf('https://cdn.example/1.jpg'), [], 'only saved paths have a chain');
});

test('a single file has no media folders beside it: published copy, then the original link', () => {
  reset({ local: false });
  rememberOriginal('media/chain-c/p-1.webp', 'https://cdn.example/c.jpg');
  assert.deepEqual(chainOf('media/chain-c/p-1.webp').map((c) => c.tier), ['remote', 'orig']);
  assert.equal(mediaSrc('media/chain-c/p-1.webp'), BASE + 'chain-c/p-1.webp');
});

test('a site that serves its photos itself does not ask the same address twice', () => {
  configureMedia({ page: 'https://pages.example.test/app/demo/', base: 'https://pages.example.test/app/demo/media/' });
  assert.deepEqual(chainOf('media/chain-d/p-1.webp').map((c) => c.tier), ['media', 'lite'], 'the remote tier is the media tier');
});

test('urls map back to their saved path, whichever tier they belong to', () => {
  reset();
  rememberOriginal('media/chain-e/p-1.webp', 'https://cdn.example/e.jpg');
  for (const u of ['media/chain-e/p-1.webp', 'media-lite/chain-e/p-1.webp', BASE + 'chain-e/p-1.webp', 'https://cdn.example/e.jpg']) assert.equal(pathOf(u), 'media/chain-e/p-1.webp', u);
  assert.equal(pathOf('https://elsewhere.test/x.jpg'), null);
  assert.equal(pathOf(''), null);
  assert.equal(pathOf(null), null);
  assert.equal(pathOf(BASE + 'a%20b/c.webp'), 'media/a b/c.webp');
  assert.equal(remoteUrl('media/a b/c.webp'), BASE + 'a%20b/c.webp');
  assert.equal(remoteUrl('https://x/y.jpg'), null);
});

test('failed() walks the chain once, forward, and ends with null; other images are left alone', () => {
  reset();
  rememberOriginal('media/chain-f/p-1.webp', 'https://cdn.example/f.jpg');
  assert.equal(failed('media/chain-f/p-1.webp'), 'media-lite/chain-f/p-1.webp');
  assert.equal(failed('media-lite/chain-f/p-1.webp'), BASE + 'chain-f/p-1.webp');
  assert.equal(failed(BASE + 'chain-f/p-1.webp'), 'https://cdn.example/f.jpg');
  assert.equal(failed('https://cdn.example/f.jpg'), null, 'the chain is used up');
  assert.equal(failed('https://unrelated.test/a.jpg'), undefined);
  assert.equal(failed(null), undefined);
});

test('a tier that keeps failing without ever answering is skipped for the rest of the session', () => {
  reset();
  for (let i = 0; i < DEAD_AFTER; i++) { assert.equal(isDead('media'), false); failed(`media/chain-g/p-${i}.webp`); }
  assert.equal(isDead('media'), true);
  assert.equal(mediaSrc('media/chain-g/p-9.webp'), 'media-lite/chain-g/p-9.webp', 'new images start at the next tier');
  for (let i = 0; i < DEAD_AFTER; i++) failed(`media-lite/chain-g/p-${i}.webp`);
  assert.equal(mediaSrc('media/chain-g/p-10.webp'), BASE + 'chain-g/p-10.webp');
  assert.equal(failed('media/chain-g/p-11.webp'), BASE + 'chain-g/p-11.webp', 'dead tiers are jumped over mid-chain too');
  assert.deepEqual(mediaStats().media, { ok: 0, fail: DEAD_AFTER + 1 });
});

test('a tier that has answered once is never written off', () => {
  reset();
  loaded('media/chain-h/p-0.webp');
  for (let i = 0; i < 10; i++) failed(`media/chain-h/p-${i + 1}.webp`);
  assert.equal(isDead('media'), false);
  assert.equal(mediaSrc('media/chain-h/p-99.webp'), 'media/chain-h/p-99.webp');
});

test('what answered is remembered, so re-rendering a card does not walk the chain again', () => {
  reset();
  const p = 'media/chain-i/p-1.webp';
  assert.equal(mediaSrc(p), p);
  loaded('media-lite/chain-i/p-1.webp');
  assert.equal(mediaSrc(p), 'media-lite/chain-i/p-1.webp');
  loaded(BASE + 'chain-i/p-1.webp');
  assert.equal(mediaSrc(p), BASE + 'chain-i/p-1.webp');
  failed(BASE + 'chain-i/p-1.webp');                      // it stops answering: the memory is dropped
  assert.equal(mediaSrc(p), p);
  loaded(p);
  assert.equal(mediaSrc(p), p);
  assert.equal(mediaSrc('https://cdn.example/x.jpg'), 'https://cdn.example/x.jpg');
  assert.equal(mediaSrc(undefined), undefined);
});

test('configureMedia forgets what was learned about the previous search', () => {
  reset();
  for (let i = 0; i < DEAD_AFTER; i++) failed(`media/chain-j/p-${i}.webp`);
  loaded('media-lite/chain-j/ok.webp');
  reset();
  assert.equal(isDead('media'), false);
  assert.equal(mediaSrc('media/chain-j/ok.webp'), 'media/chain-j/ok.webp');
});

test('the photo model tells the chain each photo\'s original link', () => {
  reset();
  const L = { photos_local: ['media/chain-k/p-1.webp', 'media/chain-k/p-2.webp'], photos: ['https://cdn.example/k1.jpg', 'https://cdn.example/k2.jpg'] };
  photoItems(L);
  assert.equal(chainOf('media/chain-k/p-1.webp').at(-1).url, 'https://cdn.example/k1.jpg');
  assert.equal(chainOf('media/chain-k/p-2.webp').at(-1).url, 'https://cdn.example/k2.jpg');
});

// ------------------------------------------------------------------ the page-wide listener
function fakeDoc() {
  const on = {};
  return { addEventListener: (type, fn, capture) => { assert.equal(capture, true, `${type} must be captured: image errors do not bubble`); (on[type] ||= []).push(fn); }, on };
}
const fakeImg = (src) => ({ tagName: 'IMG', dataset: {}, attrs: { src }, getAttribute(k) { return this.attrs[k]; }, set src(v) { this.attrs.src = v; }, get src() { return this.attrs.src; } });
const fire = (doc, type, img) => { const e = { target: img, stopped: false, stopImmediatePropagation() { this.stopped = true; } }; for (const fn of doc.on[type] || []) fn(e); return e; };

test('the listener steps an image along its chain, swallowing each error but the last', () => {
  reset();
  rememberOriginal('media/chain-l/p-1.webp', 'https://cdn.example/l.jpg');
  const doc = fakeDoc();
  installMediaFallback(doc);
  const img = fakeImg('media/chain-l/p-1.webp');
  for (const want of ['media-lite/chain-l/p-1.webp', BASE + 'chain-l/p-1.webp', 'https://cdn.example/l.jpg']) {
    const e = fire(doc, 'error', img);
    assert.equal(img.src, want);
    assert.equal(e.stopped, true, 'the image\'s own onerror must not run while there is a next tier');
  }
  const last = fire(doc, 'error', img);
  assert.equal(last.stopped, false, 'the chain is used up: the image\'s own handler runs');
  assert.equal(img.dataset.mediaGone, '1');
  assert.equal(img.src, 'https://cdn.example/l.jpg');
  fire(doc, 'load', fakeImg('media-lite/chain-l/p-1.webp'));
  const other = fakeImg('https://elsewhere.test/a.jpg');
  assert.equal(fire(doc, 'error', other).stopped, false);
  assert.equal(other.src, 'https://elsewhere.test/a.jpg');
  const notImg = { tagName: 'SCRIPT', getAttribute: () => 'media/x.webp' };
  assert.equal(fire(doc, 'error', notImg).stopped, false);
  const again = fakeDoc();
  installMediaFallback(again);
  assert.deepEqual(again.on, {}, 'installed once per page');
});
