// node --test tests/js : comfort preferences (dashboard/js/features/comfort-core.js)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePrefs, resolveComfort, htmlAttrs, comfortQuery, DEFAULTS, TEXT_STEPS, ACCENTS } from '../../dashboard/js/features/comfort-core.js';

test('defaults: nothing forced, medium text, iris', () => {
  assert.deepEqual(normalizePrefs(null), DEFAULTS);
  assert.deepEqual(normalizePrefs('junk'), DEFAULTS);
  assert.equal(TEXT_STEPS.length, 3);
  assert.deepEqual(ACCENTS.map((a) => a.id), ['iris', 'jade', 'amber', 'rose']);
});

test('stored values are checked: unknown keys dropped, bad values fall back', () => {
  const p = normalizePrefs({ text: 'huge', accent: 'neon', motion: 'yes', contrast: true, golden: true, extra: 1 });
  assert.deepEqual(p, { transparency: false, contrast: true, motion: false, golden: true, text: 'm', accent: 'iris' });
  assert.equal(normalizePrefs({ text: 'xl', accent: 'rose' }).text, 'xl');
});

test('the OS setting wins and cannot be switched off; the renter can add to it', () => {
  const e = resolveComfort({ motion: false, contrast: true }, { motion: true });
  assert.equal(e.motion, true); assert.equal(e.locked.motion, true);
  assert.equal(e.contrast, true); assert.equal(e.locked.contrast, false);
  assert.equal(e.transparency, false);
  assert.equal(resolveComfort({ motion: true }, {}).motion, true);
});

test('html attributes are always explicit', () => {
  assert.deepEqual(htmlAttrs(DEFAULTS, {}), { 'data-transparency': 'full', 'data-contrast': 'normal', 'data-motion': 'full', 'data-text': 'm', 'data-accent': 'iris' });
  const a = htmlAttrs({ ...DEFAULTS, text: 'xl', accent: 'amber', transparency: true }, { contrast: true });
  assert.equal(a['data-transparency'], 'reduced'); assert.equal(a['data-contrast'], 'high');
  assert.equal(a['data-text'], 'xl'); assert.equal(a['data-accent'], 'amber');
});

test('comfortQuery recognises the media queries the app asks', () => {
  assert.equal(comfortQuery('(prefers-reduced-motion: reduce)'), 'motion');
  assert.equal(comfortQuery('(prefers-reduced-motion:reduce)'), 'motion');
  assert.equal(comfortQuery('(prefers-reduced-transparency: reduce)'), 'transparency');
  assert.equal(comfortQuery('(prefers-contrast: more)'), 'contrast');
  assert.equal(comfortQuery('(max-width: 760px)'), null);
  assert.equal(comfortQuery('(prefers-color-scheme: light)'), null);
});
