// node --test tests/js : every accent (iris, jade, amber, rose) keeps WCAG AA text contrast in both themes.
// Reads the real token files (dashboard/css/tokens.css and accents.css), so a colour edit that breaks AA fails here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ACCENTS } from '../../dashboard/js/features/comfort-core.js';

const css = (p) => fs.readFileSync(new URL('../../dashboard/css/' + p, import.meta.url), 'utf8');
const TOKENS = css('tokens.css'), ACC = css('accents.css');

/** `{ --name: value }` of the first block whose selector is exactly `sel`. */
function block(src, sel) {
  const re = new RegExp(`(^|\\n)${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`);
  const m = src.match(re);
  if (!m) return null;
  return Object.fromEntries([...m[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((x) => [x[1], x[2].trim()]));
}
const rgba = (v) => {
  let m = v.match(/^#([0-9a-f]{6})$/i);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)).concat(1);
  m = v.match(/^rgba?\(([^)]+)\)$/);
  if (m) { const p = m[1].split(',').map((x) => parseFloat(x)); return [p[0], p[1], p[2], p[3] ?? 1]; }
  throw new Error('colour ' + v);
};
const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const over = (fg, bg) => [0, 1, 2].map((i) => fg[i] * fg[3] + bg[i] * (1 - fg[3]));

const base = { dark: block(TOKENS, ':root'), light: block(TOKENS, ':root[data-theme="light"]') };
const SURF = ['--ground', '--surface-1', '--surface-2', '--surface-3'];

function tokensFor(id, theme) {
  if (id === 'iris') return { ...base[theme] };
  const sel = theme === 'dark' ? `:root[data-accent="${id}"]` : `:root[data-theme="light"][data-accent="${id}"]`;
  const b = block(ACC, sel);
  assert.ok(b, `accents.css has a ${theme} block for ${id}`);
  return { ...base[theme], ...b };
}

test('the four accents are defined for both themes', () => {
  assert.deepEqual(ACCENTS.map((a) => a.id), ['iris', 'jade', 'amber', 'rose']);
  for (const a of ACCENTS) for (const th of ['dark', 'light']) assert.ok(tokensFor(a.id, th)['--accent'], `${a.id} ${th}`);
});

for (const a of ACCENTS) for (const theme of ['dark', 'light']) {
  test(`${a.id} (${theme}): accent text and text on the accent are AA`, () => {
    const t = tokensFor(a.id, theme), acc = rgba(t['--accent']), strong = rgba(t['--accent-strong']), ink = rgba(t['--accent-ink']);
    for (const s of SURF) {
      const bg = rgba(t[s]);
      assert.ok(ratio(acc, bg) >= 4.5, `${a.id} ${theme}: --accent on ${s} = ${ratio(acc, bg).toFixed(2)}`);
      assert.ok(ratio(strong, bg) >= 4.5, `${a.id} ${theme}: --accent-strong on ${s} = ${ratio(strong, bg).toFixed(2)}`);
      // accent text on its own soft wash (active chips, selected tabs)
      const wash = over(rgba(t['--accent-soft']), bg);
      assert.ok(ratio(acc, wash) >= 4.5, `${a.id} ${theme}: --accent on soft wash over ${s} = ${ratio(acc, wash).toFixed(2)}`);
    }
    // secondary text inside a selected chip or tier button: the wash must not push --ink-3 under AA
    const washed = over(rgba(t['--accent-soft']), rgba(t['--surface-1']));
    assert.ok(ratio(rgba(t['--ink-3']), washed) >= 4.5, `${a.id} ${theme}: --ink-3 on soft wash over --surface-1 = ${ratio(rgba(t['--ink-3']), washed).toFixed(2)}`);
    assert.ok(ratio(ink, acc) >= 4.5, `${a.id} ${theme}: --accent-ink on --accent = ${ratio(ink, acc).toFixed(2)}`);
    assert.ok(ratio(ink, strong) >= 4.5, `${a.id} ${theme}: --accent-ink on --accent-strong = ${ratio(ink, strong).toFixed(2)}`);
  });
}

test('the settings-menu swatches preview exactly the accent values', () => {
  for (const theme of ['dark', 'light']) {
    const sw = theme === 'dark' ? block(ACC, ':root') : block(ACC, ':root[data-theme="light"]');
    assert.ok(sw, `swatch tokens for ${theme}`);
    for (const a of ACCENTS) {
      const t = tokensFor(a.id, theme);
      assert.equal(sw[`--sw-${a.id}`].toLowerCase(), t['--accent'].toLowerCase(), `${a.id} ${theme} swatch`);
      assert.equal(sw[`--sw-${a.id}-ink`].toLowerCase(), t['--accent-ink'].toLowerCase(), `${a.id} ${theme} swatch ink`);
    }
  }
});

test('the non-default accents are distinguishable from each other and from iris', () => {
  for (const theme of ['dark', 'light']) {
    const cols = ACCENTS.map((a) => rgba(tokensFor(a.id, theme)['--accent']));
    for (let i = 0; i < cols.length; i++) for (let j = i + 1; j < cols.length; j++) {
      const d = Math.hypot(cols[i][0] - cols[j][0], cols[i][1] - cols[j][1], cols[i][2] - cols[j][2]);
      assert.ok(d > 60, `${ACCENTS[i].id} vs ${ACCENTS[j].id} (${theme}) are ${d.toFixed(0)} apart`);
    }
  }
});
