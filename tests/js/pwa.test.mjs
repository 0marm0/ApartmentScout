// node --test tests/js : the installable app's decisions that need no browser (js/pwa-core.js) and the service worker's
// pure helpers (sw.js: which files are photos, which are never cached, and which saved photos to evict first).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { shouldRegister, warmList, sizeLabel } from '../../dashboard/js/pwa-core.js';

const env = (o = {}) => ({ protocol: 'https:', hostname: 'user.github.io', search: '', hasToken: false, hasApi: true, hasBuild: true, ...o });

test('registers on https for a deliberate build, and nowhere else by accident', () => {
  assert.equal(shouldRegister(env()), true);
  assert.equal(shouldRegister(env({ hasBuild: false })), false, 'a plain copy of dashboard/ never registers by itself');
  assert.equal(shouldRegister(env({ hasBuild: false, search: '?pwa=1' })), true, '?pwa=1 opts a plain copy in');
  assert.equal(shouldRegister(env({ search: '?pwa=0' })), false, '?pwa=0 wins over a build');
  assert.equal(shouldRegister(env({ protocol: 'file:', hostname: '' })), false, 'the standalone file has no service workers');
  assert.equal(shouldRegister(env({ protocol: 'http:', hostname: 'example.com' })), false, 'plain http off localhost is not a secure context');
  assert.equal(shouldRegister(env({ hasApi: false })), false);
});

test('localhost development is allowed, the local `apartmentscout serve` page is not', () => {
  for (const hostname of ['localhost', '127.0.0.1', '[::1]', 'app.localhost']) assert.equal(shouldRegister(env({ protocol: 'http:', hostname })), true, hostname);
  assert.equal(shouldRegister(env({ protocol: 'http:', hostname: '127.0.0.1', hasToken: true })), false, 'the as-token meta marks the local server');
});

test('warmList keeps same-origin files in scope and drops the worker, the API and photos', () => {
  const origin = 'https://u.github.io', scope = 'https://u.github.io/app/demo/';
  const names = [
    scope + 'dist/chunks/unit3d-ABC.js', scope + 'data/layers/noise.json', scope + 'sw.js', scope + 'precache.json', scope + 'api/session',
    scope + 'media/a-1/p-1.webp', 'https://tiles.example.com/14/1/2.pbf', 'https://u.github.io/other/x.js', scope + 'vendor/three/three.module.min.js?v=1', 'not a url',
  ];
  assert.deepEqual(warmList(names, origin, scope), ['/app/demo/dist/chunks/unit3d-ABC.js', '/app/demo/data/layers/noise.json', '/app/demo/vendor/three/three.module.min.js']);
});

test('sizeLabel reads naturally', () => {
  assert.equal(sizeLabel(900), '900 B');
  assert.equal(sizeLabel(2048), '2 KB');
  assert.equal(sizeLabel(5 * 1048576), '5.0 MB');
});

// ------------------------------------------------------------------ sw.js
globalThis.self = { registration: { scope: 'https://u.github.io/app/demo/' }, addEventListener() {}, location: { href: 'https://u.github.io/app/demo/sw.js' } };
const sw = createRequire(import.meta.url)('../../dashboard/sw.js');

test('the worker treats only saved listing photos under its scope as photos', () => {
  const u = (p) => new URL(p, 'https://u.github.io/app/demo/');
  assert.equal(sw.isPhoto(u('media/a-1/p-1.webp')), true);
  assert.equal(sw.isPhoto(u('media/shared/x.JPG')), true);
  assert.equal(sw.isPhoto(u('media-lite/shared/x.webp')), true, 'the starter set is a photo family too');
  assert.equal(sw.isPhoto(u('media-lite/MANIFEST.json')), false);
  assert.equal(sw.isPhoto(u('data/listings.json')), false);
  assert.equal(sw.isPhoto(u('media/a-1/notes.txt')), false);
  assert.equal(sw.isPhoto(new URL('https://u.github.io/app/media/a.webp')), false, 'outside the scope');
});

test('the worker never caches itself, its manifest or the local API', () => {
  const u = (p) => new URL(p, 'https://u.github.io/app/demo/');
  for (const p of ['sw.js', 'precache.json', 'api/session']) assert.equal(sw.isBypass(u(p)), true, p);
  assert.equal(sw.isBypass(u('data/listings.json')), false);
});

test('eviction drops the oldest photos first and keeps the one just saved', () => {
  const index = { a: [400, 1], b: [400, 2], c: [400, 3], d: [400, 4] };
  assert.deepEqual(sw.planEviction(index, 2000, 'd'), { drop: [], total: 1600 }, 'under the cap: nothing goes');
  assert.deepEqual(sw.planEviction(index, 1000, 'd'), { drop: ['a', 'b'], total: 800 });
  assert.deepEqual(sw.planEviction({ a: [900, 1], b: [900, 2] }, 500, 'b'), { drop: ['a'], total: 900 }, 'the incoming photo stays even when it alone is over the cap');
  assert.deepEqual(sw.planEviction({}, 100, 'x'), { drop: [], total: 0 });
});
