// node --test tests/js : the GitHub client (js/sync/gist-client.js), the words of the panel (sync-text.js) and this browser's side of sync
// (sync-store.js) with a fake localStorage standing in for two devices. No network: `fetch` is a function the test passes in.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../dashboard/js/sync/gist-client.js';
import * as T from '../../dashboard/js/sync/sync-text.js';
import * as M from '../../dashboard/js/sync/sync-model.js';

const TOKEN = 'github_pat_FAKETOKENFORTESTS_unit';
const json = (data, status = 200, headers = {}) => new Response(data === null ? null : JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } });
function client(handler, opts = {}) {
  const calls = [];
  const fetchFn = async (url, init) => { calls.push({ url, init }); return handler(url, init, calls); };
  return { c: G.createClient({ token: TOKEN, fetch: fetchFn, now: () => 1_000_000, ...opts }), calls };
}

// ------------------------------------------------------------------ the client
test('every call goes to api.github.com with the token in the Authorization header only', async () => {
  const { c, calls } = client(() => json({ files: {}, html_url: 'https://gist.github.com/x/abc' }));
  await c.get('abc123');
  const { url, init } = calls[0];
  assert.equal(url, 'https://api.github.com/gists/abc123');
  assert.equal(init.headers.Authorization, `Bearer ${TOKEN}`);
  assert.ok(!url.includes(TOKEN) && !JSON.stringify(init.body || '').includes(TOKEN));
  assert.equal(init.credentials, 'omit');
  assert.equal(init.cache, 'no-store');
  assert.equal(init.referrerPolicy, 'no-referrer');
});

test('a gist is created secret, with the sync files and nothing else', async () => {
  const { c, calls } = client(() => json({ id: 'f'.repeat(32), html_url: 'https://gist.github.com/me/' + 'f'.repeat(32), owner: { login: 'me' } }, 201, { etag: 'W/"1"' }));
  const made = await c.create({ [M.MAIN_FILE]: '{"a":1}' });
  const body = JSON.parse(calls[0].init.body);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(body.public, false);
  assert.deepEqual(Object.keys(body.files), [M.MAIN_FILE]);
  assert.equal(body.files[M.MAIN_FILE].content, '{"a":1}');
  assert.deepEqual(made, { id: 'f'.repeat(32), etag: 'W/"1"', htmlUrl: 'https://gist.github.com/me/' + 'f'.repeat(32), owner: 'me' });
});

test('update sets files and removes others with null', async () => {
  const { c, calls } = client(() => json({ html_url: 'u' }, 200, { etag: 'W/"2"' }));
  const out = await c.update('abc', { [M.MAIN_FILE]: 'x', 'apartmentscout-sync-2.json': null });
  assert.equal(calls[0].init.method, 'PATCH');
  assert.deepEqual(JSON.parse(calls[0].init.body), { files: { [M.MAIN_FILE]: { content: 'x' }, 'apartmentscout-sync-2.json': null } });
  assert.equal(out.etag, 'W/"2"');
});

test('get returns the sync files only, answers "not modified" for a matching etag, and refuses a truncated file', async () => {
  const { c, calls } = client((url, init) => (init.headers['If-None-Match'] === 'W/"7"' ? json(null, 304, { etag: 'W/"7"' })
    : json({ files: { [M.MAIN_FILE]: { content: '{}', truncated: false }, 'notes.txt': { content: 'x' } }, html_url: 'h' }, 200, { etag: 'W/"7"' })));
  const r = await c.get('abc');
  assert.deepEqual(Object.keys(r.files), [M.MAIN_FILE]);
  assert.equal(r.etag, 'W/"7"');
  assert.deepEqual(await c.get('abc', { etag: 'W/"7"' }), { notModified: true, etag: 'W/"7"' });
  assert.equal(calls[1].init.headers['If-None-Match'], 'W/"7"');
  const t = client(() => json({ files: { [M.MAIN_FILE]: { content: 'cut', truncated: true } } })).c;
  await assert.rejects(t.get('abc'), (e) => e.kind === 'shape' && /larger than GitHub returns/.test(e.message));
});

test('find picks the newest gist that has a sync file, across pages', async () => {
  const page = (n, mine) => Array.from({ length: n }, (_, i) => ({ id: `${mine}${i}`, updated_at: `2026-10-0${(i % 9) + 1}T00:00:00Z`, files: mine === 'a' ? { 'other.txt': {} } : { [M.MAIN_FILE]: {} }, html_url: 'h' }));
  const { c, calls } = client((url) => json(url.endsWith('&page=1') ? page(100, 'a') : [{ id: 'new', updated_at: '2026-12-01T00:00:00Z', files: { [M.MAIN_FILE]: {} }, html_url: 'u', owner: { login: 'me' } }, ...page(3, 'b')]));
  const f = await c.find();
  assert.equal(f.id, 'new');
  assert.equal(calls.length, 2);
  assert.equal(await client(() => json([])).c.find(), null);
});

test('GitHub failures become plain kinds, and the token never appears in a message', async () => {
  const kinds = async (res) => { try { await client(() => res).c.get('abc'); } catch (e) { return e; } return null; };
  assert.equal((await kinds(json({ message: 'Bad credentials' }, 401))).kind, 'auth');
  assert.equal((await kinds(json({ message: 'Resource not accessible by personal access token' }, 403))).kind, 'forbidden');
  assert.equal((await kinds(json({ message: 'Not Found' }, 404))).kind, 'notfound');
  assert.equal((await kinds(json({ message: 'Validation Failed' }, 422))).kind, 'invalid');
  assert.equal((await kinds(json({ message: 'boom' }, 502))).kind, 'server');
  const limited = await kinds(json({ message: 'API rate limit exceeded' }, 403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1000060' }));
  assert.equal(limited.kind, 'ratelimit');
  assert.equal(limited.retryAt, 1_000_060_000);
  const retry = await kinds(json({ message: 'secondary rate limit' }, 403, { 'retry-after': '30' }));
  assert.equal(retry.kind, 'ratelimit');
  assert.equal(retry.retryAt, 1_000_000 + 30_000);
  const tooMany = await kinds(json({}, 429));
  assert.equal(tooMany.kind, 'ratelimit');
  assert.ok(tooMany.retryAt >= 1_000_000 + 5000, 'never an instant retry');
  const echo = await kinds(json({ message: `bad ${TOKEN} here` }, 418));
  assert.ok(!echo.message.includes(TOKEN), 'a message that echoes the token is redacted');
});

test('a dropped connection and a timeout are "network", not a crash', async () => {
  const c1 = G.createClient({ token: TOKEN, fetch: async () => { throw new TypeError('Failed to fetch'); } });
  await assert.rejects(c1.get('x'), (e) => e.kind === 'network');
  const c2 = G.createClient({ token: TOKEN, fetch: (u, i) => new Promise((_, rej) => i.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })))), timeoutMs: 20 });
  await assert.rejects(c2.get('x'), (e) => e.kind === 'network' && /did not answer/.test(e.message));
});

test('user() is null when the token may not ask, and the other helpers read what people paste', async () => {
  assert.equal(await client(() => json({ message: 'no' }, 403)).c.user(), null);
  assert.equal(await client(() => json({ login: 'renter' })).c.user(), 'renter');
  const id = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
  assert.equal(G.gistIdFrom(id), id);
  assert.equal(G.gistIdFrom(`https://gist.github.com/renter/${id}`), id);
  assert.equal(G.gistIdFrom(`https://gist.github.com/renter/${id}/revisions`), id);
  assert.equal(G.gistIdFrom('hello'), null);
  assert.equal(G.looksLikeToken(TOKEN), true);
  assert.equal(G.looksLikeToken('ghp_' + 'a'.repeat(36)), true);
  assert.equal(G.looksLikeToken('password123'), false);
  assert.throws(() => G.createClient({ token: '' }), /No token/);
});

// ------------------------------------------------------------------ the words
test('relative times read like a person says them', () => {
  const now = Date.UTC(2026, 9, 15, 12, 0, 0);
  assert.equal(T.ago(M.iso(now - 10_000), now), 'just now');
  assert.equal(T.ago(M.iso(now - 2 * 60_000), now), '2 min ago');
  assert.equal(T.ago(M.iso(now - 3 * 3600_000), now), '3 h ago');
  assert.equal(T.ago(M.iso(now - 30 * 3600_000), now), 'yesterday');
  assert.equal(T.ago(M.iso(now - 4 * 86400_000), now), '4 days ago');
  assert.equal(T.ago('', now), 'never');
});

test('the status line covers every state', () => {
  const now = Date.UTC(2026, 9, 15, 12, 0, 0), last = M.iso(now - 2 * 60_000);
  const line = (s) => T.statusLine({ target: 'gist', phase: 'synced', lastSync: last, pending: false, ...s }, now);
  assert.deepEqual(line({}), { text: 'Synced 2 min ago', tone: 'ok' });
  assert.equal(line({ pending: true }).text, 'Synced 2 min ago · changes waiting');
  assert.deepEqual(line({ phase: 'offline', pending: true }), { text: 'Offline: will sync when you are back', tone: 'warn' });
  assert.equal(line({ phase: 'syncing' }).tone, 'busy');
  assert.match(line({ phase: 'limited', retryAt: now + 60_000 }).text, /asked for a pause/);
  assert.deepEqual(line({ phase: 'error', error: { message: 'GitHub does not accept this token.' } }), { text: 'GitHub does not accept this token.', tone: 'bad' });
  assert.deepEqual(T.statusLine({ target: 'off' }, now), { text: 'Sync is off', tone: 'off' });
  assert.match(T.statusLine({ target: 'file', lastFileOut: last }, now).text, /exported 2 min ago/);
  assert.match(T.statusLine({ target: 'file' }, now).text, /not exported yet/);
});

test('merge lines and sizes', () => {
  assert.equal(T.mergeLine({ added: 3, updated: 2, removed: 1 }), '3 new, 2 updated, 1 removed');
  assert.equal(T.mergeLine({ added: 0, updated: 1 }), '1 updated');
  assert.equal(T.mergeLine({}), '');
  assert.equal(T.size(512), '512 B');
  assert.equal(T.size(220 * 1024), '220 KB');
  assert.equal(T.size(6 * 1024 * 1024), '6 MB');
});

// ------------------------------------------------------------------ this browser's side, as two devices
class FakeStorage {
  constructor() { this.m = new Map(); }
  get length() { return this.m.size; }
  key(i) { return [...this.m.keys()][i] ?? null; }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(String(k), String(v)); }
  removeItem(k) { this.m.delete(k); }
  clear() { this.m.clear(); }
}
const hadStorage = 'localStorage' in globalThis;
after(() => { if (!hadStorage) delete globalThis.localStorage; });   // the other node tests in this process never saw one
async function makeDevice(name) {
  const storage = new FakeStorage();
  globalThis.localStorage = storage;
  const St = await import(`../../dashboard/js/sync/sync-store.js?device=${name}`);
  St.setConfig({ device: name, name });
  const use = () => { globalThis.localStorage = storage; };
  const put = (k, v) => { use(); storage.setItem('as:' + k, JSON.stringify(v)); };
  const get = (k) => { const t = storage.getItem('as:' + k); return t == null ? undefined : JSON.parse(t); };
  const drop = (k) => { use(); storage.removeItem('as:' + k); };
  /** One cycle against a shared remote item map, the way engine.js does it. */
  const sync = (remote) => {
    use();
    const { local, skipped } = St.stamp();
    const merged = M.pruneTombstones(M.mergeItems(local, remote.items));
    const applied = St.applyMerged(merged, local, new Set(skipped.map((s) => s.key)));
    remote.items = merged;
    return applied;
  };
  return { St, storage, put, get, drop, sync, name, use };
}

test('two devices: edits to different things merge, the same thing takes the newer, a deletion travels', async () => {
  const remote = { items: {} };
  const mac = await makeDevice('mac1'), phone = await makeDevice('ph01');
  mac.put('picks', { h1: { saved: true, note: 'mac note', updated: '2026-10-01' } });
  mac.sync(remote);
  phone.sync(remote);
  assert.deepEqual(phone.get('picks').h1.note, 'mac note');
  assert.equal(phone.get('picks').h1.updated, '2026-10-01', 'the day stamp of a pick is rebuilt for the page');
  // both edit while apart
  mac.use(); mac.put('picks', { h1: { saved: true, note: 'mac edit', updated: '2026-10-02' } });
  phone.put('picks', { h1: { saved: true, note: 'mac note', tier: 2, updated: '2026-10-02' }, h2: { saved: true, updated: '2026-10-02' } });
  mac.sync(remote); phone.sync(remote); mac.sync(remote);
  assert.deepEqual(mac.get('picks').h1.note, 'mac edit');
  assert.deepEqual(phone.get('picks').h1.note, 'mac edit', 'the Mac wrote the note after the phone last saw it');
  assert.equal(mac.get('picks').h1.tier, 2);
  assert.equal(phone.get('picks').h1.tier, 2);
  assert.ok(mac.get('picks').h2.saved, 'a home starred only on the phone reaches the Mac');
  // the Mac removes a home; the phone sees it go
  mac.put('picks', { h1: mac.get('picks').h1 });
  mac.sync(remote); phone.sync(remote);
  assert.equal(phone.get('picks').h2, undefined);
  assert.ok(phone.get('picks').h1);
});

test('a key that holds nothing any more is removed from storage, not left as an empty object', async () => {
  const remote = { items: {} };
  const mac = await makeDevice('mac2'), phone = await makeDevice('ph02');
  mac.put('weights', { cost: 20 });
  mac.sync(remote); phone.sync(remote);
  assert.deepEqual(phone.get('weights'), { cost: 20 });
  mac.drop('weights');
  mac.sync(remote); phone.sync(remote);
  assert.equal(phone.get('weights'), undefined);
});

test('tour photos: the entry travels, and where the bytes are stays a fact about each device', async () => {
  const remote = { items: {} };
  const mac = await makeDevice('mac3'), phone = await makeDevice('ph03');
  mac.put('findings:S', { h: { note: 'n', updated: '2026-10-14T10:00:00Z', v: 1, photos: [{ id: 'abc123', store: 'disk', w: 800, h: 600, bytes: 9000, at: '2026-10-14T10:00:00Z' }] } });
  mac.sync(remote); phone.sync(remote);
  assert.deepEqual(phone.get('findings:S').h.photos, [{ id: 'abc123', w: 800, h: 600, bytes: 9000, at: '2026-10-14T10:00:00Z', store: 'idb' }]);
  assert.equal(phone.get('findings:S').h.updated.endsWith('Z'), true);
  // a later sync on the Mac must not turn its 'disk' photo into 'idb'
  phone.put('findings:S', { h: { ...phone.get('findings:S').h, water: 3 } });
  phone.sync(remote); mac.sync(remote);
  assert.equal(mac.get('findings:S').h.photos[0].store, 'disk');
  assert.equal(mac.get('findings:S').h.water, 3);
});

test('the sync token, ledger and settings are never read as data', async () => {
  const mac = await makeDevice('mac4');
  mac.St.setToken('github_pat_SECRETSECRETSECRETSECRET');
  mac.put('picks', { h: { saved: true } });
  mac.put('theme', 'light');
  const { local } = (mac.use(), mac.St.stamp());
  assert.deepEqual(Object.keys(local), ['picks/h/saved']);
  assert.ok(!JSON.stringify(local).includes('SECRET'));
  assert.equal(mac.St.getToken(), 'github_pat_SECRETSECRETSECRETSECRET');
  mac.St.setToken('');
  assert.equal(mac.St.hasToken(), false);
});

test('an item too big to sync stays on the device, is not sent, and is not mistaken for a deletion', async () => {
  const remote = { items: {} };
  const mac = await makeDevice('mac5'), phone = await makeDevice('ph05');
  mac.put('plan.data.big', { pad: 'x'.repeat(M.LIMITS.item + 10) });
  mac.put('plan.data.small', { pad: 'y' });
  mac.use();
  const first = mac.St.stamp();
  assert.deepEqual(first.skipped.map((s) => s.key), ['plan.data.big']);
  mac.sync(remote);
  assert.deepEqual(Object.keys(remote.items), ['plan.data.small']);
  assert.ok(mac.get('plan.data.big'), 'still on the device after a sync');
  phone.sync(remote);
  assert.equal(phone.get('plan.data.big'), undefined);
  assert.deepEqual(phone.get('plan.data.small'), { pad: 'y' });
  mac.sync(remote);
  assert.ok(!remote.items['plan.data.big'], 'never sent, never tombstoned');
});

test('a full write to storage that fails does not turn into a deletion later', async () => {
  const remote = { items: {} };
  const mac = await makeDevice('mac6'), phone = await makeDevice('ph06');
  mac.put('picks', { h: { saved: true, note: 'keep me' } });
  mac.sync(remote);
  phone.use();
  const realSet = phone.storage.setItem.bind(phone.storage);
  phone.storage.setItem = (k, v) => { if (k === 'as:picks') throw new Error('QuotaExceededError'); return realSet(k, v); };
  const applied = phone.sync(remote);
  assert.deepEqual(applied.failed, ['picks']);
  phone.storage.setItem = realSet;
  phone.sync(remote);   // the next cycle brings it in; nothing was recorded as held-then-deleted
  assert.equal(phone.get('picks').h.note, 'keep me');
  mac.sync(remote);
  assert.ok(!remote.items['picks/h/note'].x, 'the item was never deleted anywhere');
});
