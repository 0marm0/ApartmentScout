// The block-parquet floor (plan/floor-wood.js) and the facade palettes' mix (city3d/facade-rules.js): pure parts only, no canvas.
import test from 'node:test';
import assert from 'node:assert/strict';
import { basketPlan, tone, BLOCKS, SLATS, BLOCK_IN, TILE_M } from '../../dashboard/js/plan/floor-wood.js';
import { paletteOf, seedOf, PALETTES } from '../../dashboard/js/city3d/facade-rules.js';

test('a basket-weave tile is 4 x 4 blocks of 9 in with three slats each, alternating direction', () => {
  assert.equal(BLOCKS, 4); assert.equal(SLATS, 3); assert.equal(BLOCK_IN, 9);
  assert.ok(Math.abs(TILE_M - 0.9144) < 1e-9);
  const { blocks } = basketPlan();
  assert.equal(blocks.length, 16);
  for (const b of blocks) assert.equal(b.horiz, (b.bx + b.by) % 2 === 0, 'neighbouring blocks run at right angles');
  assert.ok(blocks.every((b) => b.slats.length === SLATS));
});

test('every block has its own tone: the floor is never one flat colour, and the plan is repeatable', () => {
  const a = basketPlan(), b = basketPlan();
  assert.deepEqual(a, b);
  const t = a.blocks.map((x) => x.tone), mean = t.reduce((s, v) => s + v, 0) / t.length, sd = Math.sqrt(t.reduce((s, v) => s + (v - mean) ** 2, 0) / t.length);
  assert.ok(sd > 0.05 && sd < 0.2, `tone spread ${sd}`);
  assert.ok(new Set(a.blocks.map((x) => x.warm.toFixed(2))).size > 10, 'blocks differ in warmth too');
  assert.notDeepEqual(basketPlan(1).blocks.map((x) => x.tone), a.blocks.map((x) => x.tone), 'another seed, another floor');
});

// a stand-in for THREE.Color: linear floats, with the three methods tone() uses
const lin = (v) => Math.pow(v / 255, 2.2), srgb = (v) => Math.pow(v, 1 / 2.2);
class Col {
  constructor(r, g, b) { Object.assign(this, { r, g, b }); }
  clone() { return new Col(this.r, this.g, this.b); }
  multiplyScalar(k) { this.r *= k; this.g *= k; this.b *= k; return this; }
  convertLinearToSRGB() { this.r = srgb(this.r); this.g = srgb(this.g); this.b = srgb(this.b); return this; }
}
test('tone() returns sRGB bytes of the honey base, warmer when asked', () => {
  const base = new Col(lin(0x91), lin(0x6b), lin(0x42));
  const c = tone(base, 1), warm = tone(base, 1, 1), cool = tone(base, 1, -1);
  assert.ok(c.every((v) => Number.isInteger(v) && v >= 0 && v <= 255));
  assert.ok(Math.abs(c[0] - 0x91) <= 2 && Math.abs(c[1] - 0x6b) <= 2 && Math.abs(c[2] - 0x42) <= 2, `base reproduced: ${c}`);
  assert.ok(warm[2] < cool[2] && warm[0] >= cool[0], 'warm = more amber, cool = more straw');
});

test('post-war residential facades are mostly cream and buff, red-brown a minority', () => {
  const N = 2000, count = [0, 0, 0, 0];
  for (let i = 0; i < N; i++) count[paletteOf(seedOf('bin' + i), 1)]++;
  assert.ok(count[3] / N < 0.2 && count[3] / N > 0.05, `red-brown share ${count[3] / N}`);
  assert.ok((count[0] + count[1]) / N > 0.55, 'cream + buff are the majority');
  // the other styles keep an even four-way mix, and every palette index stays in 0..3
  const other = [0, 0, 0, 0]; for (let i = 0; i < N; i++) other[paletteOf(seedOf('x' + i), 3)]++;
  assert.ok(other.every((n) => n / N > 0.18 && n / N < 0.32));
  assert.ok(PALETTES.every((st) => st.length === 4 && st.every(([w, g]) => w.length === 3 && g.length === 3)));
});
