// The Floor plan header says which way a unit faces from its host facade, with bays as a range, never from the first pane.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../../', import.meta.url);
const { facingSummary } = await import(new URL('dashboard/js/plan/facing.js', root));
const { normalisePlan } = await import(new URL('dashboard/js/plan/model.js', root));

test('a bay is a range around the host facade bearing', () => {
  const model = { windows: [208.7, 164.7, 118.7, 164.1, 118.7, 74.1].map((bearing) => ({ bearing })) };
  const s = facingSummary(model, 118.69);
  assert.deepEqual([s.facade, s.bays], [119, [74, 209]]);
  assert.equal(s.text, 'windows face ESE 119° · bays 74–209°');
  assert.doesNotMatch(s.text, /209° SSW/);
});

test('flat windows give just the facade, and an unknown facade gives nothing', () => {
  assert.equal(facingSummary({ windows: [{ bearing: 180 }, { bearing: 181 }] }, 180).text, 'windows face S 180°');
  assert.deepEqual(facingSummary({ windows: [{ bearing: 180 }] }, null), { facade: null, bays: null, text: '' });
  assert.equal(facingSummary({ windows: [] }, 90).text, 'windows face E 90°');
});

test("Paramount Tower 25E's real plan reads ESE 119°, not SSW 209°", () => {
  const raw = JSON.parse(fs.readFileSync(new URL('examples/nyc-2026/plans/paramount-tower-25e.json', root)));
  const model = normalisePlan(raw);
  assert.equal(Math.round(model.windows[0].bearing), 209, 'the first window is a bay pane that points away from the facade');
  const s = facingSummary(model, model.up_bearing);
  assert.match(s.text, /^windows face ESE 119° · bays \d+–209°$/);
});
