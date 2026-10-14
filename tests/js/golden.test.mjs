// node --test tests/js : golden-hour map tint (dashboard/js/features/golden.js)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { warmth, goldenTint } from '../../dashboard/js/features/golden.js';
import { zonedMs } from '../../dashboard/js/sun.js';

const NYC = [40.75, -73.98], TZ = 'America/New_York';
const at = (y, mo, d, h, m) => zonedMs(y, mo, d, h * 60 + m, TZ);
const tint = (y, mo, d, h, m) => goldenTint(at(y, mo, d, h, m), NYC[0], NYC[1]);

test('warmth curve: nothing high in the sky or deep below the horizon, peak near 3 degrees', () => {
  assert.equal(warmth(40), 0);
  assert.equal(warmth(18), 0);
  assert.equal(warmth(-8), 0);
  assert.equal(warmth(-30), 0);
  assert.equal(warmth(3), 1);
  assert.ok(warmth(10) > 0 && warmth(10) < 1);
  assert.ok(warmth(-3) > 0 && warmth(-3) < 1);
  assert.ok(warmth(8) > warmth(14), 'warmer as the sun sinks');
  assert.ok(warmth(-2) > warmth(-6), 'cooler as the dusk deepens');
  assert.equal(warmth(NaN), 0);
});

test('midsummer noon and midnight in New York have no tint', () => {
  assert.equal(tint(2026, 6, 21, 12, 0).intensity, 0);
  assert.equal(tint(2026, 6, 21, 0, 30).intensity, 0);
  assert.equal(tint(2026, 6, 21, 12, 0).phase, 'day');
  assert.equal(tint(2026, 6, 21, 0, 30).phase, 'night');
});

test('late evening in June and mid-afternoon in December are golden, and the glow is on the west', () => {
  const summer = tint(2026, 6, 21, 20, 5);
  assert.ok(summer.intensity > 0.6, `summer ${summer.intensity}`);
  assert.equal(summer.phase, 'golden');
  assert.ok(summer.gx < 30, `glow leans west, gx=${summer.gx}`);
  const winter = tint(2026, 12, 21, 16, 20);
  assert.ok(winter.intensity > 0.6, `winter ${winter.intensity}`);
  assert.ok(winter.gx < 30);
});

test('sunrise puts the glow on the east side', () => {
  const rise = tint(2026, 6, 21, 5, 30);
  assert.ok(rise.intensity > 0.3, `sunrise ${rise.intensity}`);
  assert.ok(rise.gx > 70, `glow leans east, gx=${rise.gx}`);
});

test('the painted strength is capped and follows the intensity', () => {
  const t = goldenTint(at(2026, 6, 21, 20, 5), NYC[0], NYC[1], 0.4);
  assert.ok(t.strength <= 0.4 && t.strength > 0.2);
  assert.equal(goldenTint(at(2026, 6, 21, 12, 0), NYC[0], NYC[1]).strength, 0);
  assert.ok(Math.abs(t.strength - t.intensity * 0.4) < 0.001);
});

test('the glow position stays near the map', () => {
  for (let h = 0; h < 24; h++) {
    const t = tint(2026, 3, 20, h, 0);
    assert.ok(t.gx >= -10 && t.gx <= 110 && t.gy >= -10 && t.gy <= 110);
  }
});
