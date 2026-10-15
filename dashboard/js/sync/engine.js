// The sync engine: when to sync, what a cycle does, what the status is. It ties the pure model (sync-model.js), this browser's storage
// (sync-store.js), the GitHub client (gist-client.js) and the photo bytes (photos.js) together. It is quiet by default: nothing is read or sent
// until the renter connects a gist (or exports / imports a file by hand), and then only the sync document goes to api.github.com.
//
// A cycle (gist):  look at the gist (a cheap "not modified" answer when nothing changed there) -> give changed local items their time -> merge ->
//                  write what is newer to this browser -> read the pages' in-memory copies again -> add or store photo copies -> write the gist
//                  files that differ. Everything between the stamp and the write to storage is synchronous, so an edit made while the gist was being
//                  read is never overwritten by the merge; it is picked up by the next cycle.
//
// Offline queue:   a change is stamped in the ledger (kept in this browser) and marks the settings "dirty" before anything is sent. Nothing is
//                  lost by going offline, closing the page or a failed request: the next open, the `online` event, or a retry with a growing pause sends it.
import * as M from './sync-model.js';
import * as St from './sync-store.js';
import { onWrite } from './watch.js';
import { createClient, SyncError, gistIdFrom } from './gist-client.js';
import * as P from './photos.js';
import { refreshApp } from './refresh.js';
import { mergeLine } from './sync-text.js';

// The waits. A browser test shortens them by setting window.__AS_SYNC_TUNING before the page loads (like __AS_BOOT_MS in index.html).
const TUNE = globalThis.__AS_SYNC_TUNING || {};
const DEBOUNCE = TUNE.debounce ?? 5000, MIN_GAP = TUNE.gap ?? 4000, RESUME_AFTER = TUNE.resume ?? 60000, BACKOFF = TUNE.backoff ?? [30000, 60000, 120000, 300000, 600000];

let state = { phase: 'idle', error: null, retryAt: 0 };
let gen = 0, running = null, again = false, timer = 0, stampTimer = 0, lastRun = 0, fails = 0, lastRemote = null, started = false, blocked = false;
let lastResult = null, skipped = [], summaryItems = {}, touched = false;   // touched: a write was heard and not yet looked at (the stamp waits a moment)
const subs = new Set();

export const onChange = (fn) => { subs.add(fn); return () => subs.delete(fn); };
const notify = () => subs.forEach((fn) => { try { fn(status()); } catch { /* a listener must not stop sync */ } });
const setState = (patch) => { state = { ...state, ...patch }; notify(); };
const now = () => M.iso(Date.now());

/** Everything the panel and the menu row show. */
export function status() {
  const c = St.config();
  return {
    target: c.target, phase: c.target === 'gist' ? state.phase : 'idle', error: state.error, retryAt: state.retryAt,
    lastSync: c.lastSync, lastFileOut: c.lastFileOut, lastFileIn: c.lastFileIn, pending: !!c.dirty || touched,
    connected: c.target === 'gist' && !!c.gistId && St.hasToken(), gistId: c.gistId, gistUrl: c.gistUrl, owner: c.owner,
    photos: c.photos, auto: c.auto, device: c.name, deviceId: c.device, devices: lastRemote?.devices || {}, skipped, last: lastResult,
  };
}
/** What would be synced, by group, for the panel. */
export const summary = () => M.summarize(summaryItems);

// ------------------------------------------------------------------ noticing changes
function doStamp() {
  const r = St.stamp();
  skipped = r.skipped;
  summaryItems = r.local;
  if (r.changed.length) { gen++; St.setConfig({ dirty: true }); }
  return r;
}
function onLocalWrite() {
  touched = true;
  if (St.config().target === 'gist') notify();
  clearTimeout(stampTimer);
  stampTimer = setTimeout(() => {
    const r = doStamp();
    touched = false;
    if (r.changed.length) { notify(); schedule(DEBOUNCE); }
  }, 250);
}
function schedule(ms = DEBOUNCE) {
  const c = St.config();
  if (c.target !== 'gist' || !c.auto || blocked || !St.hasToken() || !c.gistId) return;
  clearTimeout(timer);
  const wait = Math.max(ms, lastRun + MIN_GAP - Date.now());
  timer = setTimeout(() => { syncNow('change'); }, wait);
}

// ------------------------------------------------------------------ one cycle
let searchName = null;   // the open search's name (set at start); it only labels the file and picks which search the version-1 fields describe
const activeSearch = () => searchName;

async function cycle(reason) {
  const c = St.config(), client = createClient({ token: St.getToken() });
  doStamp();
  const etag = !St.config().dirty && lastRemote && c.etag && reason !== 'connect' ? c.etag : null;
  const res = await client.get(c.gistId, { etag });
  let remote;
  if (res.notModified) remote = lastRemote;
  else {
    const j = M.joinParts(res.files);
    remote = { items: j.items, devices: j.devices, files: res.files };
    St.setConfig({ etag: res.etag || '', gistUrl: res.htmlUrl || c.gistUrl, owner: res.owner || c.owner });
  }
  // ---- synchronous from here to the write to storage
  const { local, changed, skipped: big } = St.stamp();
  skipped = big; summaryItems = local;
  if (changed.length) gen++;
  const included = gen;   // every change counted so far is in what is pushed below
  const merged = M.pruneTombstones(M.mergeItems(local, remote.items));
  const noBlob = {};
  for (const [k, w] of Object.entries(merged)) if (!M.isBlobKey(k)) noBlob[k] = w;
  const applied = St.applyMerged(noBlob, local, new Set(big.map((b) => b.key)));
  // ----
  const fx = await refreshApp(applied.storageKeys);
  const cfg = St.config();
  const ph = await P.reconcilePhotos(merged, { embed: cfg.photos, device: cfg.device, clock: St.theClock() });
  let pushed = false;
  if (!M.sameItems(merged, remote.items)) {
    const devices = { ...remote.devices, [cfg.device]: { name: cfg.name, at: now() } };
    const parts = M.splitDoc(M.buildDoc(merged, { device: cfg.device, devices, search: activeSearch() }));
    const next = Object.fromEntries(parts.map((p) => [p.name, p.text]));
    const files = {};
    for (const [n, t] of Object.entries(next)) if (remote.files[n] !== t) files[n] = t;
    for (const n of Object.keys(remote.files)) if (!(n in next) && M.PART_RE.test(n)) files[n] = null;
    const small = Object.values(files).reduce((n, t) => n + (t ? t.length : 0), 0) < 50000;
    const out = await client.update(cfg.gistId, files, { keepalive: small && reason === 'hide' });
    St.setConfig({ etag: out.etag || '' });
    lastRemote = { items: merged, devices, files: next };
    pushed = true;
  } else lastRemote = { ...remote, items: merged };
  summaryItems = { ...local };
  const from = originOf(applied.plan, merged, remote.devices);
  lastResult = { at: now(), pulled: applied.set + applied.del, pushed, from, photos: ph, reason };
  if (applied.set + applied.del > 0) announce(applied, merged, from, fx);
  return included;
}
function originOf(plan, merged, devices) {
  const counts = new Map();
  for (const k of [...plan.set, ...plan.del]) { const d = merged[k]?.d; if (d && d !== St.config().device) counts.set(d, (counts.get(d) || 0) + 1); }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  return (top && devices[top]?.name) || (top === 'backup' ? 'a backup' : 'your other device');
}
async function announce(applied, merged, from, fx) {
  try {
    const { toast } = await import('../util.js');
    const live = applied.plan.set.length, gone = applied.plan.del.length;
    const text = `Updated from ${from}: ${mergeLine({ added: live, removed: gone }) || 'changes'}`;
    toast(text, fx.reload ? 9000 : 3600, fx.reload ? { label: 'Reload', run: () => location.reload() } : null);
  } catch { /* no page to tell */ }
}

// ------------------------------------------------------------------ running cycles
export function syncNow(reason = 'manual') {
  const c = St.config();
  if (c.target !== 'gist' || !St.hasToken() || !c.gistId) return Promise.resolve(false);
  if (blocked && reason !== 'manual' && reason !== 'connect') return Promise.resolve(false);
  clearTimeout(stampTimer);
  doStamp(); touched = false;
  if (running) { again = true; return running; }
  clearTimeout(timer);
  running = run(reason).finally(() => { running = null; if (again) { again = false; schedule(MIN_GAP); } });
  return running;
}
async function run(reason) {
  if (navigator.onLine === false) { setState({ phase: 'offline', error: null }); return false; }
  setState({ phase: 'syncing', error: null, retryAt: 0 });
  lastRun = Date.now();
  try {
    const included = await cycle(reason);
    fails = 0; blocked = false;
    St.setConfig({ lastSync: now(), dirty: gen !== included });   // an edit made while the cycle ran is not in what was sent: still waiting
    setState({ phase: 'synced', error: null, retryAt: 0 });
    if (gen !== included) schedule(DEBOUNCE);
    return true;
  } catch (e) {
    fail(e);
    return false;
  }
}
function fail(e) {
  const kind = e instanceof SyncError ? e.kind : 'shape';
  if (!(e instanceof SyncError)) console.warn('sync failed:', String(e?.message || e).slice(0, 200));   // a message only: never the request, never the token
  const retry = (ms) => { clearTimeout(timer); timer = setTimeout(() => syncNow('retry'), ms); setState({ retryAt: Date.now() + ms }); };
  if (kind === 'network') { setState({ phase: 'offline', error: null }); retry(BACKOFF[Math.min(fails++, BACKOFF.length - 1)]); return; }
  if (kind === 'ratelimit') { const at = e.retryAt || Date.now() + 60000; setState({ phase: 'limited', error: null, retryAt: at }); clearTimeout(timer); timer = setTimeout(() => syncNow('retry'), Math.max(5000, at - Date.now())); return; }
  if (kind === 'server') { setState({ phase: 'error', error: { kind, message: e.message } }); retry(BACKOFF[Math.min(fails++, BACKOFF.length - 1)]); return; }
  blocked = true;   // a token problem, a deleted gist, data GitHub refused: waiting does not fix it; "Sync now" or a new token does
  setState({ phase: 'error', error: { kind, message: e instanceof SyncError ? e.message : 'Sync stopped because of an unexpected error. Your data on this device is safe.' }, retryAt: 0 });
}

// ------------------------------------------------------------------ connecting
/** Check the token, find this account's sync gist (or make one), keep the token in this browser and run the first cycle. Throws SyncError. */
export async function connect(tokenText, gistText = '') {
  const token = String(tokenText || '').trim();
  if (!token) throw new SyncError('auth', 'Paste the token first.');
  if (/\s/.test(token)) throw new SyncError('auth', 'That does not look like one token. Copy just the token, without spaces.');
  const client = createClient({ token });
  const owner = await client.user();
  let id = gistIdFrom(gistText), htmlUrl = '';
  if (gistText.trim() && !id) throw new SyncError('invalid', 'That is not a gist link or id.');
  if (!id) { const found = await client.find(); if (found) { id = found.id; htmlUrl = found.htmlUrl || ''; } }
  if (!id) {
    const { local } = St.stamp();
    const cfg = St.config();
    const parts = M.splitDoc(M.buildDoc(local, { device: cfg.device, devices: { [cfg.device]: { name: cfg.name, at: now() } }, search: activeSearch() }));
    const made = await client.create(Object.fromEntries(parts.map((p) => [p.name, p.text])));
    id = made.id; htmlUrl = made.htmlUrl || '';
  }
  St.setToken(token);
  St.setConfig({ target: 'gist', gistId: id, gistUrl: htmlUrl, owner: owner || '', etag: '', dirty: true });
  lastRemote = null; blocked = false; fails = 0;
  setState({ phase: 'idle', error: null });
  await syncNow('connect');
}
/** Stop syncing: the token is removed from this browser; the data stays where it is. The gist stays on GitHub until the renter deletes it there. */
export function disconnect() {
  clearTimeout(timer);
  St.setToken('');
  St.setConfig({ target: 'off', gistId: '', gistUrl: '', owner: '', etag: '', dirty: false });
  lastRemote = null; blocked = false; fails = 0; lastResult = null;
  setState({ phase: 'idle', error: null, retryAt: 0 });
}
export function setOption(name, value) {
  if (!['photos', 'auto'].includes(name)) return;
  St.setConfig({ [name]: !!value });
  if (name === 'auto' && value) schedule(1000);
  notify();
}
/** Photo copies were turned off and the renter asked for the copies on GitHub to go: the next cycle removes them. */
export async function removePhotoCopies() {
  if (!St.hasToken() || !St.config().gistId) return 0;
  const client = createClient({ token: St.getToken() });
  const res = await client.get(St.config().gistId);
  const j = M.joinParts(res.files);
  const merged = { ...j.items };
  const n = P.dropAllCopies(merged, { device: St.config().device, clock: St.theClock() });
  if (!n) return 0;
  const cfg = St.config(), devices = { ...j.devices, [cfg.device]: { name: cfg.name, at: now() } };
  const parts = M.splitDoc(M.buildDoc(merged, { device: cfg.device, devices, search: activeSearch() }));
  const next = Object.fromEntries(parts.map((p) => [p.name, p.text])), files = { ...next };
  for (const f of Object.keys(res.files)) if (!(f in next) && M.PART_RE.test(f)) files[f] = null;
  const out = await client.update(cfg.gistId, files);
  St.setConfig({ etag: out.etag || '' });
  lastRemote = { items: merged, devices, files: next };
  return n;
}

// ------------------------------------------------------------------ the sync file
/** The whole state as one JSON document (a picks backup with the sync block added). Returns { text, name, items, photos }. */
export async function buildExport({ photos = St.config().photos } = {}) {
  const { local } = doStamp();
  const cfg = St.config(), items = { ...local };
  const ph = await P.reconcilePhotos(items, { embed: photos, device: cfg.device, clock: St.theClock() });
  const search = activeSearch();
  const doc = M.buildDoc(items, { device: cfg.device, devices: { [cfg.device]: { name: cfg.name, at: now() } }, search, legacy: M.legacyView(items, search) });
  const day = new Date(), p = (n) => String(n).padStart(2, '0');
  const copies = Object.keys(items).filter((k) => M.isBlobKey(k) && !items[k].x).length;
  return { text: JSON.stringify(doc), name: `apartmentscout-sync-${day.getFullYear()}-${p(day.getMonth() + 1)}-${p(day.getDate())}.json`, items: Object.keys(items).filter((k) => !M.isBlobKey(k) && !items[k].x).length, photos: copies, over: ph.over };
}
export const markExported = () => { St.setConfig({ lastFileOut: now(), ...(St.config().target === 'off' ? { target: 'file' } : {}) }); notify(); };

/** Merge a sync file (or any picks backup) into this browser. Returns what changed. Throws an Error with a plain message for a file that is not one. */
export async function importText(text) {
  let js;
  try { js = JSON.parse(text); } catch { throw new Error('That file is not an ApartmentScout backup.'); }
  const doc = M.parseDoc(js, { search: activeSearch() });
  const { local, skipped: big } = doStamp();
  const merged = M.pruneTombstones(M.mergeItems(local, doc.items));
  const noBlob = {};
  for (const [k, w] of Object.entries(merged)) if (!M.isBlobKey(k)) noBlob[k] = w;
  const applied = St.applyMerged(noBlob, local, new Set(big.map((b) => b.key)));
  const fx = await refreshApp(applied.storageKeys);
  const ph = await P.reconcilePhotos(merged, { embed: false, device: St.config().device, clock: St.theClock() });
  let added = 0, updated = 0;
  for (const k of applied.plan.set) { if (local[k] && !local[k].x) updated++; else added++; }
  const kept = Object.keys(doc.items).filter((k) => !M.isBlobKey(k) && local[k] && !local[k].x && !doc.items[k].x && merged[k] === local[k] && M.stable(local[k].v) !== M.stable(doc.items[k].v)).length;
  St.setConfig({ lastFileIn: now(), dirty: St.config().dirty || applied.set + applied.del > 0, ...(St.config().target === 'off' ? { target: 'file' } : {}) });
  doStamp();
  if (St.config().target === 'gist') schedule(DEBOUNCE);
  notify();
  return { added, updated, removed: applied.del, kept, photos: ph.stored, legacy: doc.legacy, reload: fx.reload, from: doc.devices?.[doc.device]?.name || '' };
}

// ------------------------------------------------------------------ start
async function whenStoresReady() {
  const FS = await import('../features/findings-store.js').catch(() => null);
  for (let i = 0; i < 40 && FS && !FS.isReady(); i++) await new Promise((r) => setTimeout(r, 100));
}
export async function init() {
  if (started) return;
  started = true;
  St.config();
  try { const app = await import('../app.js'); searchName = app.S.crit0?.search?.name || app.S.base || null; } catch { /* no page data */ }
  onWrite(onLocalWrite);
  addEventListener('storage', (e) => { if (e.key && e.key.startsWith('as:') && M.isSynced(e.key.slice(3))) onLocalWrite(); });
  await whenStoresReady();
  doStamp();
  addEventListener('online', () => { if (St.config().target === 'gist') syncNow('online'); });
  addEventListener('offline', () => { if (St.config().target === 'gist') setState({ phase: 'offline' }); });
  document.addEventListener('visibilitychange', () => {
    const c = St.config();
    if (document.visibilityState === 'hidden') { clearTimeout(stampTimer); doStamp(); if (c.target === 'gist' && St.config().dirty) syncNow('hide'); }
    else if (c.target === 'gist' && Date.now() - Date.parse(c.lastSync || 0) > RESUME_AFTER) syncNow('resume');
  });
  addEventListener('pagehide', () => { clearTimeout(stampTimer); doStamp(); });
  if (St.config().target === 'gist' && St.hasToken() && St.config().gistId) {
    if (navigator.onLine === false) setState({ phase: 'offline' });
    setTimeout(() => syncNow('open'), 600);
  }
  notify();
}

/** For headless checks: a read-only handle on the state. Never used by the page. */
export const probe = () => ({ status: status(), ledger: St.ledgerCount(), skipped });
