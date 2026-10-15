// node --test tests/js : what a result card says (features/card-model.js): the two telling features, the one reason, the one warning.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { featureShares, pickFeatures, topReason, warnings } from '../../dashboard/js/features/card-model.js';

const home = (am, extra = {}) => ({ amenities: am, ...extra });
const MIX = [
  ...Array.from({ length: 8 }, () => home({ in_unit_wd: false, doorman: 'full-time', gym: true })),
  home({ in_unit_wd: true, doorman: 'full-time', gym: true }),
  home({ in_unit_wd: false, doorman: 'none', gym: false }),
];

test('shares count only the homes that have an answer', () => {
  const s = featureShares([...MIX, home({}), home({})], 9);
  assert.equal(s.wd, 0.1);
  assert.equal(s.doorman, 0.9);
  assert.equal(s.floor, 0.5, 'nobody states a floor: neutral');
});

test('the two features chosen are the ones fewer homes have', () => {
  const s = featureShares(MIX, 9);
  const keys = (L) => pickFeatures(L, s, { month: 9 }).map((f) => f.key);
  assert.deepEqual(keys(MIX[8]), ['wd', 'doorman'], 'a washer/dryer is rare here, so it leads; doorman and gym are common (a tie keeps the listed order)');
  assert.deepEqual(keys(MIX[0]), ['doorman', 'gym']);
  assert.deepEqual(keys(MIX[9]), []);
});

test('sun and a high floor only count when they are notable, and say so in the tooltip', () => {
  const s = featureShares(MIX, 9);
  const L = home({}, { floor: 31, exposure: ['SE'], site: { sun_hours: Array(12).fill(5.25) } });
  const f = pickFeatures(L, s, { month: 9 });
  assert.deepEqual(f.map((x) => x.key).sort(), ['floor', 'sun']);
  assert.equal(f.find((x) => x.key === 'floor').label, 'Fl 31');
  assert.match(f.find((x) => x.key === 'floor').title, /faces SE/);
  assert.equal(f.find((x) => x.key === 'sun').label, '5.3 h');
  assert.deepEqual(pickFeatures(home({}, { floor: 6, site: { sun_hours: Array(12).fill(2) } }), s, { month: 9 }), []);
});

test('the reason is the biggest mover, worded by its sign, and nothing when nothing moved', () => {
  const r = topReason([{ dim: 'space', label: 'Space', pts: -5.04, sentence: '510 ft² (estimated)' }, { dim: 'cost', label: 'Cost', pts: 2 }]);
  assert.deepEqual({ up: r.up, text: r.text, num: r.num, detail: r.detail }, { up: false, text: 'Held back by: space', num: '−5.0', detail: '510 ft² (estimated)' });
  const up = topReason([{ dim: 'interior', label: 'Interior', pts: 6.6 }]);
  assert.equal(up.text, 'Strongest: interior');
  assert.equal(up.num, '+6.6');
  assert.equal(topReason([{ dim: 'quiet', label: 'Quiet', pts: 0.2 }]), null);
  assert.equal(topReason([]), null);
});

test('every warning is one mark; a failed must-have makes it a red one; being over budget is not repeated', () => {
  assert.equal(warnings({ score: { tags: [], gates: ['over_budget', 'unverified:fees'] } }), null);
  const w = warnings({ score: { tags: ['price unverified', 'source conflict'], gates: [] } });
  assert.equal(w.tone, 'warn');
  assert.equal(w.items.length, 2);
  const bad = warnings({ score: { tags: ['thin data'], gates: ['fails:elevator'] } }, (g) => `Fails ${g.split(':')[1]}`);
  assert.equal(bad.tone, 'bad');
  assert.equal(bad.items[0], 'Fails elevator');
});
