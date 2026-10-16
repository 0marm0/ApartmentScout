// node --test tests/js/paintings.test.mjs : the renter's paintings (room3d/paintings.js). The pieces are valid furniture with assumed sizes,
//   hang flush on a wall in 25E without a fit-check flag, a triptych splits into three panels with its gaps cut out, a picture is cropped to
//   the canvas (never stretched), the private image is looked for only among the files the local server lists, and without one the
//   builder still draws every canvas (the placeholder path; textures themselves are browser-only).
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { readFileSync } from 'node:fs';

const VENDOR = new URL('../../dashboard/vendor/three/', import.meta.url).href;
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, n) {
  if (s === 'three') return { url: ${JSON.stringify(VENDOR)} + 'three.module.min.js', shortCircuit: true };
  if (s.startsWith('three/addons/')) return { url: ${JSON.stringify(VENDOR)} + 'addons/' + s.slice(13), shortCircuit: true };
  return n(s, c); }`));
const THREE = await import('three');
const P = await import(new URL('../../dashboard/js/room3d/paintings.js', import.meta.url));
const { build } = await import(new URL('../../dashboard/js/room3d/furniture.js', import.meta.url));
const { validateInventory, pieceItem } = await import(new URL('../../dashboard/js/plan/inventory.js', import.meta.url));
const { resolve } = await import(new URL('../../dashboard/js/plan/catalog.js', import.meta.url));
const { normalisePlan } = await import(new URL('../../dashboard/js/plan/model.js', import.meta.url));
const { evaluate } = await import(new URL('../../dashboard/js/plan/checks.js', import.meta.url));
const { applyInventory } = await import(new URL('../../dashboard/js/plan/placement.js', import.meta.url));
const read = (p) => JSON.parse(readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8'));
const ART = ['central-park-triptych', 'seascape', 'monet-red-boats'];

test('the three paintings are valid pieces with assumed sizes, hung in 25E without a fit-check flag', () => {
  const v = validateInventory(read('examples/nyc-2026/furniture.json')); assert.ok(v.ok, v.error);
  const by = Object.fromEntries(v.inventory.pieces.map((p) => [p.id, p]));
  for (const id of ART) {
    const p = by[id]; assert.equal(p.ref, 'canvas-painting'); assert.ok(P.PAINTINGS[p.art], `${id} has a placeholder`);
    assert.deepEqual(p.assumed, ['w', 'h', 'elev']); assert.equal(p.d, 1.5);
    assert.ok(Object.values(p.spec_basis).every((b) => ['spec', 'diagram', 'measured', 'assumed'].includes(b)));
    assert.equal(pieceItem(p).art, p.art);
  }
  assert.deepEqual([by['central-park-triptych'].w, by['central-park-triptych'].h], [3 * 24 + 2 * 2, 36]);
  const plan = read('examples/nyc-2026/plans/paramount-tower-25e.json'), m = normalisePlan(plan);
  const items = applyInventory(m.layouts[0].items, v.inventory).map((i) => resolve(i));
  const ev = evaluate(m, items.filter((i) => !i.hidden));
  for (const id of ART) {
    const it = items.find((i) => i.id === id); assert.ok(it, id); assert.equal(it.mount, 'wall'); assert.equal(it.art, by[id].art, 'the inventory joins the picture by id');
    assert.equal(ev.items[id].state, 'clear', `${id}: ${JSON.stringify(ev.items[id].issues.map((x) => x.text))}`);
  }
});

test('a triptych is three panels with the gaps cut out; a picture is cropped to the canvas, never stretched', () => {
  const L = P.panelLayout({ canvas: { panels: 3, gap: 2 } }, 76, 36);
  assert.deepEqual(L.map((p) => p.w), [24, 24, 24]); assert.deepEqual(L.map((p) => p.x), [-26, 0, 26]);
  assert.ok(Math.abs(L[1].u0 - 26 / 76) < 1e-9 && Math.abs(L[2].u1 - 1) < 1e-9);
  assert.equal(P.panelLayout(null, 30, 24).length, 1);
  const c = P.coverCrop(1467, 1224, 30 / 24); assert.ok(Math.abs(c.sw / c.sh - 1.25) < 1e-9 && c.sw === 1467 && c.sy > 0, 'a taller picture loses a strip top and bottom');
  const t = P.coverCrop(1000, 1500, 24 / 36); assert.deepEqual([t.sw, t.sh], [1000, 1500]);
});

test('the private image is chosen only from the files the local server lists, else the placeholder stays', () => {
  const names = ['central-park-1.jpg', 'central-park-2.jpg', 'central-park-3.jpg', 'seascape.jpg', 'seascape-2x.jpg', 'notes.txt', '../monet-red-boats.jpg'];
  assert.deepEqual(P.artSources('central-park', names, 3), { panels: [1, 2, 3].map((i) => `data-private/art/central-park-${i}.jpg`) });
  assert.deepEqual(P.artSources('seascape', names), { whole: 'data-private/art/seascape-2x.jpg' }, 'the upscaled copy first');
  assert.equal(P.artSources('monet-red-boats', names), null, 'a name with a path is ignored');
  assert.equal(P.artSources('seascape', []), null);
  // without a browser the builder still hangs every canvas flush on the wall (no textures, no throw)
  const it = resolve({ ...pieceItem(read('examples/nyc-2026/furniture.json').pieces.find((p) => p.id === 'central-park-triptych')), x: 0, y: 0 });
  const s = new THREE.Group(), std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, ...o });
  assert.equal(build(it, { s, std, quality: 'visual' }), true);
  const panels = s.children.filter((o) => /^canvas-/.test(o.name)); assert.equal(panels.length, 3);
  const box = new THREE.Box3().setFromObject(panels[0]); assert.ok(Math.abs(box.min.z + 0.75) < 1e-6 && Math.abs(box.max.z - 0.75) < 1e-6, 'back on the wall, 1.5 in deep');
  assert.ok(Math.abs(box.min.y - 44) < 1e-6 && Math.abs(box.max.y - 80) < 1e-6);
  assert.equal(build({ ...it, art: undefined }, { s: new THREE.Group(), std }), false, 'plain wall art keeps the studio\'s simple frame');
});
