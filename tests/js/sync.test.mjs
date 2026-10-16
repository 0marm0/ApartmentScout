// node --test tests/js : the sync model (dashboard/js/sync/sync-model.js): items, times, the deterministic merge, tombstones, old backups,
// the document and its split over files. Pure: no browser, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../../dashboard/js/sync/sync-model.js';

const T = (n) => M.iso(Date.UTC(2026, 9, 14, 12, 0, 0) + n * 1000);   // n seconds after a fixed noon
const live = (v, n, d = 'aaaa') => ({ t: T(n), d, v });
const dead = (n, d = 'aaaa') => ({ t: T(n), d, x: 1 });

// ------------------------------------------------------------------ the registry
test('only the renter\'s own storage keys are synced; settings, tokens and caches are not', () => {
  for (const k of ['picks', 'weights', 'preset', 'compare', 'findings:Search', 'facts:Search', 'trail:Search', 'office:Search', 'tourplan:Search', 'tourday:Search', 'criteria:Search', 'commute:Search',
    'plan.data.paramount-tower-25e', 'plan-projects.data', 'plan-light.data.x', 'plan-city.data', 'furniture-extra.data', 'plan-scenario:x', 'compare-specs:x', 'unit-scenario-use:x', 'view-cal:x', 'model-anchor:x', 'parts-assumed:x', 'measure.data.x']) {
    assert.ok(M.isSynced(k), k);
  }
  for (const k of ['sync.token', 'sync.config', 'sync.ledger', 'theme', 'density', 'comfort', 'destPin', 'filters2', 'list:ui', 'recent', 'tray-collapsed', 'legend-min', 'findings-unsent:Search',
    'plan-tracer-draft.data', 'plan-mood', 'coach', 'visit:Search', 'moves:Search', 'research-queue', 'see-inside', 'view-handoff']) {
    assert.ok(!M.isSynced(k), k);
  }
});

test('item keys keep slashes and percent signs inside one segment', () => {
  const k = M.itemKey('picks', ['a/b', '50%']);
  assert.equal(k, 'picks/a%2Fb/50%25');
  assert.deepEqual(M.parseKey(k), { storageKey: 'picks', path: ['a/b', '50%'] });
  assert.deepEqual(M.parseKey(M.itemKey('findings:A/B', ['h'])), { storageKey: 'findings:A/B', path: ['h'] });
});

// ------------------------------------------------------------------ cutting values into items and back
const roundTrip = (sk, value) => {
  const items = M.flatten(sk, value);
  return M.unflatten(sk, items.map((i) => ({ path: M.parseKey(i.key).path, value: i.value })));
};

test('picks are cut per home and per field; the day stamp is rebuilt, not synced', () => {
  const picks = { a: { saved: true, note: 'north light', tier: 1, updated: '2026-10-01' }, b: { saved: true, tour: '2026-10-20T16:00', updated: '2026-10-02' } };
  const items = M.flatten('picks', picks);
  assert.deepEqual(items.map((i) => i.key).sort(), ['picks/a/note', 'picks/a/saved', 'picks/a/tier', 'picks/b/saved', 'picks/b/tour']);
  assert.equal(items.find((i) => i.key === 'picks/a/note').hint, '2026-10-01T00:00:00.000Z');
  const back = roundTrip('picks', picks);
  assert.deepEqual(back, { a: { saved: true, note: 'north light', tier: 1 }, b: { saved: true, tour: '2026-10-20T16:00' } });
  const fin = M.finishTree('picks', back, [{ path: ['a', 'note'], t: T(5) }, { path: ['a', 'saved'], t: T(1) }, { path: ['b', 'saved'], t: T(2) }]);
  assert.equal(fin.a.updated, '2026-10-14');
});

test('tour findings: one item per field, one per photo entry; where a photo is stored stays on its device', () => {
  const rec = { h1: { note: 'quiet', noise: { rating: 4 }, rooms: [{ name: 'Living', w: 13.5 }], updated: '2026-10-14T10:00:00Z', v: 1,
    photos: [{ id: 'p2', store: 'disk', w: 800, h: 600, bytes: 1000, at: '2026-10-14T11:00:00Z' }, { id: 'p1', store: 'idb', caption: 'view', at: '2026-10-14T10:00:00Z' }] } };
  const items = M.flatten('findings:S', rec);
  assert.deepEqual(items.map((i) => i.key).sort(), ['findings:S/h1/noise', 'findings:S/h1/note', 'findings:S/h1/photos/p1', 'findings:S/h1/photos/p2', 'findings:S/h1/rooms']);
  assert.ok(items.every((i) => !(i.value && typeof i.value === 'object' && 'store' in i.value)));
  const back = roundTrip('findings:S', rec);
  assert.deepEqual(back.h1.photos.map((p) => p.id), ['p1', 'p2'], 'photos come back in the order they were taken');
  assert.equal(back.h1.updated, undefined);
  const fin = M.finishTree('findings:S', back, [{ path: ['h1', 'note'], t: '2026-10-14T12:30:00.123Z' }]);
  assert.equal(fin.h1.updated, '2026-10-14T12:30:00Z');
  assert.equal(fin.h1.v, 1);
});

test('facts, weights, office answers, the decision trail and whole-value keys round-trip', () => {
  const facts = { h: { rent: { value: 4200, at: '2026-10-01', source: 'renter' }, fee: { value: 150, at: '2026-10-02', source: 'renter' } } };
  assert.deepEqual(roundTrip('facts:S', facts), facts);
  const weights = { cost: 20, space: 10 };
  assert.deepEqual(roundTrip('weights', weights), weights);
  const office = { v: 1, answers: { h: { a: 'yes', day: '2026-10-03' } } };
  assert.deepEqual(roundTrip('office:S', office), office);
  const trail = [{ e: 'b', home: 'h', at: '2026-10-02T00:00:00Z', kind: 'star', to: true }, { e: 'a', home: 'h', at: '2026-10-01T00:00:00Z', kind: 'tier', to: 1 }];
  assert.deepEqual(roundTrip('trail:S', trail).map((e) => e.e), ['a', 'b']);
  const plan = { rooms: [1, 2, 3], items: [{ x: 1 }] };
  assert.deepEqual(roundTrip('plan.data.x', plan), plan);
  assert.deepEqual(M.flatten('plan.data.x', plan).map((i) => i.key), ['plan.data.x']);
  assert.deepEqual(roundTrip('compare', ['a', 'b']), ['a', 'b']);
});

test('the move plan is cut per field of each home, a ticked step per step; what is read in What\'s new is one item', () => {
  const plan = { v: 1, chosen: 'h1', homes: { h1: { start: '2026-12-01', movers: 1100, done: { apply: '2026-10-15', sign: '2026-10-20' }, dates: { book: '2026-11-10' }, custom: [{ id: 'c1', title: 'Cable box', date: '2026-11-30' }], updated: '2026-10-15' } } };
  assert.deepEqual(M.flatten('moveplan:S', plan).map((i) => i.key).sort(), ['moveplan:S/chosen', 'moveplan:S/homes/h1/custom', 'moveplan:S/homes/h1/dates/book', 'moveplan:S/homes/h1/done/apply',
    'moveplan:S/homes/h1/done/sign', 'moveplan:S/homes/h1/movers', 'moveplan:S/homes/h1/start', 'moveplan:S/homes/h1/updated', 'moveplan:S/v']);
  assert.deepEqual(roundTrip('moveplan:S', plan), plan);
  assert.ok(M.isSynced('whatsnew:seen:S') && !M.isSynced('whatsnew:notify:S') && !M.isSynced('whatsnew:notified:S') && !M.isSynced('report-opts'), 'a device\'s notification choice and display options stay put');
  assert.deepEqual(M.flatten('whatsnew:seen:S', 'digest-7').map((i) => i.key), ['whatsnew:seen:S']);
  // two devices tick different steps of one home: both stay
  const mac = { 'moveplan:S/homes/h1/done/apply': live('2026-10-15', 5, 'mac1') }, phone = { 'moveplan:S/homes/h1/done/sign': live('2026-10-16', 6, 'ph01') };
  assert.deepEqual(Object.keys(M.mergeItems(mac, phone)).length, 2);
});

test('the studio library is cut per project, so two projects saved on two devices both stay', () => {
  const lib = { p1: { name: 'One', rooms: [] }, p2: { name: 'Two', rooms: [] } };
  assert.deepEqual(M.flatten('plan-projects.data', lib).map((i) => i.key).sort(), ['plan-projects.data/p1', 'plan-projects.data/p2']);
  assert.deepEqual(roundTrip('plan-projects.data', lib), lib);
});

test('values of an unexpected shape are cut as far as they go, never thrown on', () => {
  assert.deepEqual(M.flatten('picks', 'junk'), []);
  assert.deepEqual(M.flatten('picks', { a: 'junk', b: { saved: true } }).map((i) => i.key), ['picks/b/saved']);
  assert.deepEqual(M.flatten('tourday:S', { day: '2026-10-14', done: { h: 'x' } }).map((i) => i.key).sort(), ['tourday:S/day', 'tourday:S/done/h']);
  assert.deepEqual(M.flatten('trail:S', { not: 'a list' }), []);
  assert.deepEqual(M.flatten('theme', 'dark'), []);
  assert.equal(M.unflatten('picks', []), undefined);
});

// ------------------------------------------------------------------ times: the ledger
function device(id, start = 0) {
  let n = start;
  const clock = M.makeClock(M.EPOCH, () => Date.UTC(2026, 9, 14, 12, 0, 0) + (n += 1000));
  return { id, clock, ledger: M.newLedger(), tick: () => (n += 1000), run(values, hints = {}) { const r = M.reconcile(this.ledger, values, { clock, device: id, hints, now: M.iso(Date.UTC(2026, 9, 14, 12, 0, 0) + n) }); this.ledger = r.ledger; return r; } };
}

test('the first scan keeps the times the data carries; later edits get the time of the edit', () => {
  const a = device('aaaa');
  const first = a.run({ 'picks/h/note': 'old', 'picks/h/saved': true }, { 'picks/h/note': '2026-10-01T00:00:00.000Z' });
  assert.equal(first.local['picks/h/note'].t, '2026-10-01T00:00:00.000Z', 'a day recorded by the app is the time');
  assert.equal(first.local['picks/h/saved'].t, M.EPOCH, 'nothing recorded: the epoch, so any real write beats it');
  assert.deepEqual(first.changed, []);
  const second = a.run({ 'picks/h/note': 'new', 'picks/h/saved': true });
  assert.deepEqual(second.changed, ['picks/h/note']);
  assert.ok(second.local['picks/h/note'].t > '2026-10-14T00:00:00.000Z');
  assert.equal(second.local['picks/h/saved'].t, M.EPOCH, 'an unchanged item keeps its time');
  const third = a.run({ 'picks/h/note': 'new', 'picks/h/saved': true });
  assert.deepEqual(third.changed, [], 'nothing changed, nothing stamped');
});

test('a change that arrives with its own recent-enough time (a visit read from the search folder) keeps it; a day, or a time of now, does not', () => {
  const a = device('aaaa');
  a.run({ 'findings:S/h/note': 'x' });
  const old = '2026-10-10T09:30:00.000Z';
  const r = a.run({ 'findings:S/h/note': 'x', 'findings:S/h/water': 3, 'picks/h/saved': true }, { 'findings:S/h/water': old, 'picks/h/saved': '2026-10-10T00:00:00.000Z' });
  assert.equal(r.local['findings:S/h/water'].t, old, 'dated by the visit it came from');
  assert.ok(r.local['picks/h/saved'].t > '2026-10-14', 'a bare day is not trusted');
  const fresh = M.iso(Date.UTC(2026, 9, 14, 12, 0, 5));
  const r2 = a.run({ 'findings:S/h/note': 'y' }, { 'findings:S/h/note': fresh });
  assert.notEqual(r2.local['findings:S/h/note'].t, fresh, 'an edit made now is stamped by the clock');
  const r3 = a.run({ 'findings:S/h/note': 'z' }, { 'findings:S/h/note': '2026-10-01T00:00:01.000Z' });
  assert.ok(r3.local['findings:S/h/note'].t > r2.local['findings:S/h/note'].t, 'never older than the write it replaces');
});

test('an item that appears after the first scan is stamped now, not with the epoch', () => {
  const a = device('aaaa');
  a.run({ 'picks/h/saved': true });
  const r = a.run({ 'picks/h/saved': true, 'picks/g/saved': true });
  assert.deepEqual(r.changed, ['picks/g/saved']);
  assert.ok(r.local['picks/g/saved'].t > '2026-10-14');
});

test('a removed item becomes a tombstone once, and coming back revives it with a newer time', () => {
  const a = device('aaaa');
  a.run({ k: 1 });
  const gone = a.run({});
  assert.deepEqual(gone.changed, ['k']);
  assert.equal(gone.local.k.x, 1);
  const again = a.run({});
  assert.deepEqual(again.changed, []);
  assert.equal(again.local.k.t, gone.local.k.t);
  const back = a.run({ k: 1 });
  assert.deepEqual(back.changed, ['k']);
  assert.ok(back.local.k.t > gone.local.k.t && !back.local.k.x);
});

test('the clock moves past times seen elsewhere, so an edit after a sync wins even from a slow clock', () => {
  const clock = M.makeClock(M.EPOCH, () => Date.UTC(2026, 9, 14, 12, 0, 0));
  clock.see(M.iso(Date.UTC(2026, 9, 14, 12, 5, 0)));
  assert.ok(clock.tick() > M.iso(Date.UTC(2026, 9, 14, 12, 5, 0)));
  const t1 = clock.tick(), t2 = clock.tick();
  assert.ok(t2 > t1, 'strictly increasing');
  clock.see(M.iso(Date.UTC(2031, 0, 1)));
  assert.ok(clock.tick() < M.iso(Date.UTC(2027, 0, 1)), 'a time years ahead is a wrong clock, and is ignored');
});

// ------------------------------------------------------------------ merging
test('concurrent edits to different fields of one home both survive', () => {
  const mac = { 'picks/h/saved': live(true, 1, 'mac1'), 'picks/h/note': live('on the mac', 10, 'mac1') };
  const phone = { 'picks/h/saved': live(true, 1, 'mac1'), 'picks/h/tier': live(1, 12, 'ph01') };
  const m = M.mergeItems(mac, phone);
  assert.equal(m['picks/h/note'].v, 'on the mac');
  assert.equal(m['picks/h/tier'].v, 1);
  assert.deepEqual(M.mergeItems(phone, mac), m);
});

test('concurrent edits to the same field: the newest wins, and both orders agree', () => {
  const a = { k: live('mac', 5, 'mac1') }, b = { k: live('phone', 9, 'ph01') };
  assert.equal(M.mergeItems(a, b).k.v, 'phone');
  assert.equal(M.mergeItems(b, a).k.v, 'phone');
});

test('the same time on two devices is settled by the device id, then by the value', () => {
  const a = { k: live('x', 5, 'aaaa') }, b = { k: live('y', 5, 'bbbb') };
  assert.equal(M.mergeItems(a, b).k.v, 'y');
  assert.equal(M.mergeItems(b, a).k.v, 'y');
  const c = { k: live('x', 5, 'aaaa') }, d = { k: live('y', 5, 'aaaa') };
  assert.deepEqual(M.mergeItems(c, d), M.mergeItems(d, c));
});

test('a deletion is a write: a later edit brings the item back, an earlier one does not', () => {
  const gone = { k: dead(10, 'mac1') };
  assert.ok(M.mergeItems({ k: live('v', 5, 'ph01') }, gone).k.x, 'edited before it was deleted: stays deleted');
  const kept = M.mergeItems({ k: live('v', 15, 'ph01') }, gone);
  assert.ok(!kept.k.x && kept.k.v === 'v', 'edited after it was deleted: stays, no data lost');
  assert.deepEqual(M.mergeItems(gone, { k: live('v', 15, 'ph01') }), kept);
});

test('an item missing from one copy is not a deletion', () => {
  const m = M.mergeItems({ a: live(1, 1) }, { b: live(2, 2, 'bbbb') });
  assert.deepEqual(Object.keys(m).sort(), ['a', 'b']);
});

test('merging is idempotent, commutative and associative on random copies', () => {
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const devs = ['aaaa', 'bbbb', 'cccc'];
  const copy = () => {
    const o = {};
    for (let i = 0; i < 12; i++) if (rnd() < 0.6) {
      const t = Math.floor(rnd() * 6), d = devs[Math.floor(rnd() * 3)];
      o[`k${i}`] = rnd() < 0.2 ? dead(t, d) : live(Math.floor(rnd() * 3), t, d);
    }
    return o;
  };
  for (let n = 0; n < 200; n++) {
    const a = copy(), b = copy(), c = copy();
    assert.deepEqual(M.mergeItems(a, a), a, 'idempotent');
    assert.deepEqual(M.mergeItems(a, b), M.mergeItems(b, a), 'commutative');
    assert.deepEqual(M.mergeItems(M.mergeItems(a, b), c), M.mergeItems(a, M.mergeItems(b, c)), 'associative');
    const ab = M.mergeItems(a, b);
    assert.deepEqual(M.mergeItems(ab, b), ab, 'merging again changes nothing');
    assert.deepEqual(M.mergeItems(ab, a), ab);
  }
});

test('two devices that keep syncing end up identical, whatever the order', () => {
  const mac = device('mac1'), phone = device('ph01');
  let macVals = { 'picks/h/saved': true }, phoneVals = {};
  let remote = {};
  const sync = (dev, vals) => {
    const r = dev.run(vals);
    const merged = M.mergeItems(r.local, remote);
    remote = merged;
    const out = {};
    for (const [k, w] of Object.entries(merged)) if (!w.x) out[k] = w.v;
    // what the device now holds
    const resync = dev.run(out);   // applying the merge: values that equal the merge's are not "changes" of the merge
    return { vals: out, merged, ledgerChanged: resync.changed };
  };
  macVals = sync(mac, macVals).vals;
  phoneVals = sync(phone, phoneVals).vals;
  assert.equal(phoneVals['picks/h/saved'], true, 'the phone sees the star');
  // both edit the same home while apart
  macVals = { ...macVals, 'picks/h/note': 'mac note' };
  phoneVals = { ...phoneVals, 'picks/h/tier': 2, 'picks/h/saved': false };
  macVals = sync(mac, macVals).vals;
  phoneVals = sync(phone, phoneVals).vals;
  macVals = sync(mac, macVals).vals;
  assert.deepEqual(macVals, phoneVals);
  assert.deepEqual(macVals, { 'picks/h/saved': false, 'picks/h/note': 'mac note', 'picks/h/tier': 2 });
});

test('tombstones are forgotten after the retention window, live items never', () => {
  const now = Date.UTC(2027, 0, 1);
  const items = { old: { t: M.iso(now - 200 * 86400000), d: 'a', x: 1 }, recent: { t: M.iso(now - 10 * 86400000), d: 'a', x: 1 }, keep: { t: M.iso(now - 400 * 86400000), d: 'a', v: 1 } };
  assert.deepEqual(Object.keys(M.pruneTombstones(items, now)).sort(), ['keep', 'recent']);
});

test('planChanges says what applying a merge does here', () => {
  const local = { a: live(1, 1), b: live(2, 2), c: dead(3), d: live(4, 4) };
  const merged = { a: live(1, 1), b: live(9, 5, 'bbbb'), c: live('back', 6, 'bbbb'), d: dead(7, 'bbbb'), e: live('new', 8, 'bbbb'), f: dead(9, 'bbbb') };
  const p = M.planChanges(local, merged);
  assert.deepEqual(p.set.sort(), ['b', 'c', 'e']);
  assert.deepEqual(p.del, ['d']);
  assert.deepEqual(p.meta, ['f'], 'a deletion of something never held here is only noted');
  assert.deepEqual(M.planChanges(merged, merged), { set: [], del: [], meta: [] });
  const sameValueNewerTime = M.planChanges({ a: live(1, 1) }, { a: live(1, 5, 'bbbb') });
  assert.deepEqual(sameValueNewerTime, { set: [], del: [], meta: ['a'] });
});

// ------------------------------------------------------------------ documents
test('a version-1 picks backup imports as old items: a copy that has the item keeps its own, a copy that lacks it gets it', () => {
  const backup = { version: 1, search: 'S', picks: { h: { saved: true, note: 'from a file', updated: '2026-09-01' } }, weights: { cost: 30 },
    findings: { h: { note: 'visit', updated: '2026-09-02T10:00:00Z' } }, facts: { h: { rent: { value: 4100, at: '2026-09-03', source: 'renter' } } }, history: [{ e: 'x1', home: 'h', at: '2026-09-01T10:00:00Z', kind: 'star', to: true }] };
  const doc = M.parseDoc(backup);
  assert.ok(doc.legacy);
  assert.equal(doc.items['picks/h/note'].t, '2026-09-01T00:00:00.000Z');
  assert.equal(doc.items['weights/cost'].t, M.EPOCH);
  assert.equal(doc.items['facts:S/h/rent'].t, '2026-09-03T00:00:00.000Z');
  assert.equal(doc.items['trail:S/x1'].t, '2026-09-01T10:00:00.000Z');
  assert.equal(doc.items['findings:S/h/note'].t, '2026-09-02T10:00:00.000Z');
  const mine = { 'picks/h/note': live('newer here', 100, 'mac1') };
  const merged = M.mergeItems(mine, doc.items);
  assert.equal(merged['picks/h/note'].v, 'newer here');
  assert.equal(merged['picks/h/saved'].v, true);
  assert.equal(merged['weights/cost'].v, 30);
});

test('a backup with a move plan imports it, dated by each home\'s own day, and the file view carries it back', () => {
  const backup = { version: 1, search: 'S', picks: {}, moveplan: { v: 1, homes: { h1: { start: '2026-12-01', done: { apply: '2026-10-15' }, updated: '2026-10-15' } } } };
  const doc = M.parseDoc(backup);
  assert.equal(doc.items['moveplan:S/homes/h1/start'].t, '2026-10-15T00:00:00.000Z');
  assert.equal(doc.items['moveplan:S/homes/h1/done/apply'].v, '2026-10-15');
  const v1 = M.legacyView(doc.items, 'S');
  assert.deepEqual(v1.moveplan.homes.h1.done, { apply: '2026-10-15' });
});

test('old backups of every shape import without throwing', () => {
  assert.deepEqual(M.parseDoc({ picks: {} }, { search: 'S' }).items, {});
  assert.deepEqual(M.parseDoc({ version: 1, picks: { a: { saved: true } }, extra: 'ignored' }, { search: 'S' }).items, { 'picks/a/saved': { t: M.EPOCH, d: 'backup', v: true } });
  for (const bad of [null, [], 'x', 5, {}, { picks: 'no' }, { sync: { format: 'other', items: {} } }]) assert.throws(() => M.parseDoc(bad), /not an ApartmentScout backup/);
  assert.throws(() => M.parseDoc({ sync: { format: M.FORMAT, schema: 99, items: {} } }), /newer version/);
});

test('a sync document survives a round trip, drops malformed items and keeps tombstones', () => {
  const items = { 'picks/h/saved': live(true, 1, 'mac1'), 'picks/h/note': dead(2, 'mac1') };
  const doc = M.buildDoc(items, { device: 'mac1', devices: { mac1: { name: 'Mac', at: T(2) } }, search: 'S', legacy: M.legacyView(items, 'S') });
  const back = M.parseDoc(JSON.parse(JSON.stringify(doc)));
  assert.deepEqual(back.items, items);
  assert.equal(back.devices.mac1.name, 'Mac');
  assert.equal(doc.version, 2);
  assert.deepEqual(doc.picks, { h: { saved: true } }, 'a version-1 reader still finds the picks');
  const dirty = JSON.parse(JSON.stringify(doc));
  dirty.sync.items.bad = { t: 'not a time', v: 1 };
  dirty.sync.items.worse = 'str';
  dirty.sync.items.nov = { t: T(1), d: 'x' };
  assert.deepEqual(Object.keys(M.parseDoc(dirty).items).sort(), ['picks/h/note', 'picks/h/saved']);
});

test('the version-1 view of a document holds the active search\'s visits, numbers and history', () => {
  const items = {
    'picks/h/saved': live(true, 1), 'weights/cost': live(30, 1), 'findings:S/h/note': live('n', 1), 'findings:Other/h/note': live('o', 1), 'facts:S/h/rent': live({ value: 1, at: '2026-10-01', source: 'renter' }, 1),
    'trail:S/e1': live({ e: 'e1', home: 'h', at: '2026-10-01T00:00:00Z', kind: 'star', to: true }, 1), 'picks/h/gone': dead(2),
  };
  const v1 = M.legacyView(items, 'S');
  assert.deepEqual(Object.keys(v1).sort(), ['facts', 'findings', 'history', 'picks', 'weights']);
  assert.equal(v1.findings.h.note, 'n');
  assert.equal(v1.picks.h.gone, undefined);
});

test('a document is split over files under the cap and joins back whole', () => {
  const items = {};
  for (let i = 0; i < 400; i++) items[`plan.data.p${String(i).padStart(3, '0')}`] = live({ pad: 'x'.repeat(2000), i }, i);
  items['blob/f/h/p1'] = live('data:image/jpeg;base64,' + 'A'.repeat(100000), 3);
  const doc = M.buildDoc(items, { device: 'mac1', devices: {}, search: 'S' });
  const parts = M.splitDoc(doc, 200 * 1024);
  assert.ok(parts.length > 3);
  assert.equal(parts[0].name, M.MAIN_FILE);
  assert.deepEqual(parts.map((p) => p.name).slice(0, 3), ['apartmentscout-sync.json', 'apartmentscout-sync-2.json', 'apartmentscout-sync-3.json']);
  for (const p of parts) assert.ok(M.utf8Len(p.text) <= 200 * 1024 + 110 * 1024, p.name);   // a single item may overshoot the cap, never by more than itself
  const joined = M.joinParts(Object.fromEntries(parts.map((p) => [p.name, p.text])));
  assert.deepEqual(joined.items, items);
  assert.equal(joined.device, 'mac1');
  assert.throws(() => M.joinParts({ 'apartmentscout-sync-2.json': parts[1].text }), /missing/);
  assert.throws(() => M.joinParts({ [M.MAIN_FILE]: 'not json' }), /not valid JSON/);
});

test('the summary counts live items by group', () => {
  const rows = M.summarize({ 'picks/h/saved': live(true, 1), 'picks/h/note': dead(2), 'facts:S/h/rent': live(1, 1), 'blob/f/h/p1': live('data:', 1), 'theme': live('dark', 1) });
  const n = Object.fromEntries(rows.map((r) => [r.id, r.n]));
  assert.equal(n.picks, 1);
  assert.equal(n.facts, 1);
  assert.equal(n.photos, 1);
});

test('blob keys pair with their photo entries', () => {
  const pk = M.photoKeyOf('findings:S', 'h1', 'abc123');
  assert.equal(pk, 'findings:S/h1/photos/abc123');
  const bk = M.blobKeyForPhoto(pk);
  assert.equal(bk, 'blob/findings:S/h1/abc123');
  assert.ok(M.isBlobKey(bk));
  assert.deepEqual(M.parseBlobKey(bk), { findingsKey: 'findings:S', home: 'h1', pid: 'abc123' });
  assert.equal(M.photoKeyForBlob(bk), pk);
});

test('the hash is stable under key order and sees every change', () => {
  assert.equal(M.hash({ a: 1, b: [1, 2] }), M.hash({ b: [1, 2], a: 1 }));
  assert.notEqual(M.hash({ a: 1 }), M.hash({ a: 2 }));
  assert.notEqual(M.hash('1'), M.hash(1));
  assert.notEqual(M.hash(null), M.hash(undefined === undefined ? 'null' : 0));
});
