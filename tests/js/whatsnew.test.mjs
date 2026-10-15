// node --test tests/js : the "What's new" panel's pure part (dashboard/js/features/whatsnew-model.js): reading alerts.json, the badge
// count, when a local notification is allowed, the rows and the wording of the notification control.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseAlerts, badgeCount, shouldNotify, notificationText, rowOf, sectionsOf, subtitle, notifyState, dayText } from '../../dashboard/js/features/whatsnew-model.js';

const doc = (over = {}) => ({
  schema_version: 1, kind: 'alerts', id: 'abc123', title: 'ApartmentScout: 1 new, 2 price drops', headline: '1 new, 2 price drops', since: '2026-10-14', generated: '2026-10-15',
  first_run: false, pending: false, top: 10, tracked: 400, fitting: 120, quiet_new: 2, note: null,
  groups: {
    new: [{ id: 'a', name: 'Tower 12B', hood: 'Chelsea', gross: 4800, rank: 3 }],
    drops: [{ id: 'b', name: 'Orion 23A', gross: 4895, from: 5000, to: 4895, delta: -105, basis: 'rent' }, { id: 'c', name: 'Knox 6B', from: 5200, to: 5100, delta: -100, basis: 'monthly cost' }],
  }, ...over,
});

test('parseAlerts keeps a digest and refuses anything else', () => {
  const d = parseAlerts(doc());
  assert.equal(d.total, 3);
  assert.deepEqual(Object.keys(d.groups), ['new', 'fits', 'drops', 'rises', 'gone', 'back', 'jumps', 'resolved']);
  assert.equal(d.groups.rises.length, 0);
  for (const bad of [null, undefined, 'x', {}, { ...doc(), kind: 'monitor' }, { ...doc(), schema_version: 2 }]) assert.equal(parseAlerts(bad), null);
  assert.equal(parseAlerts(doc({ groups: { new: [{ name: 'no id' }, null, { id: 'ok' }] } })).total, 1);
  assert.equal(parseAlerts(doc({ groups: 'damaged' })).total, 0);
});

test('the badge counts the changes until this digest has been seen', () => {
  const d = parseAlerts(doc());
  assert.equal(badgeCount(d, null), 3);
  assert.equal(badgeCount(d, 'older'), 3);
  assert.equal(badgeCount(d, 'abc123'), 0);
  assert.equal(badgeCount(parseAlerts(doc({ groups: {} })), null), 0);
  assert.equal(badgeCount(null, null), 0);
});

test('a notification needs permission, the opt-in, something new and a digest it has not shown or the renter has not seen', () => {
  const d = parseAlerts(doc());
  const ok = { digest: d, permission: 'granted', enabled: true, notifiedId: null, seenId: null };
  assert.equal(shouldNotify(ok), true);
  for (const off of [{ permission: 'default' }, { permission: 'denied' }, { enabled: false }, { notifiedId: 'abc123' }, { seenId: 'abc123' }, { digest: null }, { digest: parseAlerts(doc({ groups: {} })) }]) {
    assert.equal(shouldNotify({ ...ok, ...off }), false, JSON.stringify(Object.keys(off)));
  }
  assert.deepEqual(notificationText(d), { title: 'ApartmentScout', body: '1 new, 2 price drops' });
  assert.equal(notificationText(parseAlerts(doc({ headline: '' }))).body, 'Something changed in your search');
});

test('rows say what changed in the renter\'s words', () => {
  assert.deepEqual(rowOf('new', { id: 'a', name: 'Tower 12B', hood: 'Chelsea', gross: 4800, rank: 3 }), { id: 'a', name: 'Tower 12B', hood: 'Chelsea', right: '$4,800', sub: 'ranked #3' });
  const drop = rowOf('drops', { id: 'b', name: 'O', from: 5000, to: 4895, delta: -105, basis: 'rent' });
  assert.equal(drop.right, '−$105'); assert.equal(drop.sub, '$5,000 → $4,895'); assert.equal(drop.tone, 'good');
  assert.equal(rowOf('rises', { id: 'b', name: 'O', from: 4900, to: 5050, delta: 150, basis: 'monthly cost' }).sub, '$4,900 → $5,050 monthly cost');
  assert.equal(rowOf('fits', { id: 'f', name: 'F', gross: 4650, rank: 76, why: 'was over budget', from: 5295, delta: -645 }).sub, 'ranked #76 · was over budget before · down from $5,295');
  assert.equal(rowOf('gone', { id: 'g', name: 'G', was_rank: 3 }).sub, 'was ranked #3');
  assert.equal(rowOf('gone', { id: 'g', name: 'G', removed: true }).static, true);
  assert.equal(rowOf('jumps', { id: 'j', name: 'J', from: 11, to: 10 }).right, '#11 → #10');
  assert.equal(rowOf('resolved', { id: 'r', name: 'R', resolved: ['price', 'monthly fees'] }).sub, 'now known: price, monthly fees');
  assert.equal(rowOf('new', { id: 'n', name: 'N' }).right, 'price unknown');
});

test('sections keep reading order and drop empty groups', () => {
  const secs = sectionsOf(parseAlerts(doc()));
  assert.deepEqual(secs.map((s) => [s.key, s.title, s.count]), [['new', 'New homes that fit', 1], ['drops', 'Price drops', 2]]);
  assert.equal(sectionsOf(parseAlerts(doc({ top: 5, groups: { jumps: [{ id: 'j', name: 'J', from: 9, to: 4 }] } })))[0].title, 'Into the top 5');
  assert.deepEqual(sectionsOf(null), []);
});

test('the sentence under the heading', () => {
  assert.equal(subtitle(parseAlerts(doc())), 'Since Oct 14: 1 new, 2 price drops.');
  assert.match(subtitle(parseAlerts(doc({ first_run: true, groups: {}, since: null }))), /^Alerts start here: 400 homes tracked, 120 fit/);
  assert.match(subtitle(parseAlerts(doc({ groups: {}, note: 'Nothing changed.' }))), /^Nothing changed\.$/);
  assert.equal(subtitle(null), '');
  assert.equal(dayText('2026-10-05T07:00:00'), 'Oct 5');
});

test('the notification control follows what the browser offers', () => {
  const base = { supported: true, permission: 'default', enabled: false, ios: false, standalone: false };
  assert.equal(notifyState(base).kind, 'off');
  assert.equal(notifyState({ ...base, permission: 'granted', enabled: true }).kind, 'on');
  assert.equal(notifyState({ ...base, permission: 'granted', enabled: false }).kind, 'off');
  assert.equal(notifyState({ ...base, permission: 'denied' }).kind, 'blocked');
  assert.equal(notifyState({ ...base, supported: false }).kind, 'none');
  assert.equal(notifyState({ ...base, supported: false, ios: true }).kind, 'install');
  assert.equal(notifyState({ ...base, supported: false, ios: true, standalone: true }).kind, 'none');
});

test('the service worker answers a tap on the notification', () => {
  const sw = fs.readFileSync(new URL('../../dashboard/sw.js', import.meta.url), 'utf8');
  assert.match(sw, /addEventListener\('notificationclick'/);
  assert.match(sw, /OPEN_WHATSNEW/);
  assert.match(sw, /\.\/\?whatsnew=1/);
});
