// This browser's side of sync: what is stored (the renter's own `as:` keys), the sync settings, the token, the ledger of item times, and the
// two operations the engine needs: take a snapshot of the stored values (stamping what changed), and write a merged result back.
// Every storage call is wrapped, because private windows, blocked site data and previews make them throw.
import * as M from './sync-model.js';
import { quietly } from './watch.js';

const CONFIG = 'as:sync.config', TOKEN = 'as:sync.token', LEDGER = 'as:sync.ledger';

const read = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k, v) => { try { localStorage.setItem(k, v); return true; } catch { return false; } };
const parse = (t, d) => { if (t == null) return d; try { const v = JSON.parse(t); return v ?? d; } catch { return d; } };

// ------------------------------------------------------------------ settings
const rid = (n = 4) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, '0')).join('');
export function deviceName(ua = navigator.userAgent || '', platform = navigator.platform || '', touch = navigator.maxTouchPoints || 0) {
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua) || (/Mac/.test(platform) && touch > 1)) return 'iPad';
  if (/Android/.test(ua)) return 'Android phone';
  if (/Mac/.test(platform + ua)) return 'Mac';
  if (/Win/.test(platform + ua)) return 'Windows PC';
  if (/Linux|X11/.test(platform + ua)) return 'Linux PC';
  return 'This device';
}
const DEFAULTS = { v: 1, device: '', name: '', target: 'off', gistId: '', gistUrl: '', owner: '', photos: true, auto: true, lastSync: '', lastFileOut: '', lastFileIn: '', etag: '', dirty: false, clock: M.EPOCH };

let cfg = null;
export function config() {
  if (!cfg) {
    cfg = { ...DEFAULTS, ...parse(read(CONFIG), {}) };
    if (!cfg.device) { cfg.device = rid(4); cfg.name = deviceName(); write(CONFIG, JSON.stringify(cfg)); }
  }
  return cfg;
}
export function setConfig(patch) {
  cfg = { ...config(), ...patch };
  write(CONFIG, JSON.stringify(cfg));
  return cfg;
}
/** The token lives in this key only, never in the settings object, the ledger or any synced item, and is read only by the sync layer. */
export const getToken = () => parse(read(TOKEN), '') || '';
export function setToken(t) { if (t) return write(TOKEN, JSON.stringify(String(t))); try { localStorage.removeItem(TOKEN); } catch { /* ignore */ } return true; }
export const hasToken = () => !!getToken();

// ------------------------------------------------------------------ the clock and the ledger
let clock = null;
export function theClock() {
  if (!clock) clock = M.makeClock(config().clock);
  return clock;
}
const saveClock = () => { const last = theClock().last; if (last !== config().clock) setConfig({ clock: last }); };

let ledger = null;
function loadLedger() {
  if (!ledger) { const l = parse(read(LEDGER), null); ledger = l && l.v === 1 && l.items && typeof l.items === 'object' ? l : M.newLedger(); }
  return ledger;
}
function saveLedger() { if (!write(LEDGER, JSON.stringify(ledger))) { /* the ledger is rebuilt from the data if it cannot be kept */ } }
/** Forget what the ledger knows (the boot-recovery reset does this on its own; so does Disconnect when asked to start over). */
export function resetLedger() { ledger = M.newLedger(); try { localStorage.removeItem(LEDGER); } catch { /* ignore */ } }

// ------------------------------------------------------------------ reading what is stored
/** The synced storage keys currently in localStorage and the items they hold. */
export function snapshot() {
  const values = {}, hints = {}, skipped = [], storageKeys = [];
  let n = 0;
  try { n = localStorage.length; } catch { return { values, hints, skipped, storageKeys }; }
  for (let i = 0; i < n; i++) {
    let k; try { k = localStorage.key(i); } catch { break; }
    if (!k || !k.startsWith('as:')) continue;
    const sk = k.slice(3), rule = M.ruleFor(sk);
    if (!rule) continue;
    const v = parse(read(k), null);
    if (v === null) continue;
    storageKeys.push(sk);
    for (const it of M.flatten(sk, v, rule)) {
      const len = JSON.stringify(it.value)?.length ?? 0;
      if (len > M.LIMITS.item / 2 && M.utf8Len(JSON.stringify(it.value)) > M.LIMITS.item) { skipped.push({ key: it.key, bytes: len }); continue; }
      values[it.key] = it.value;
      if (it.hint) hints[it.key] = it.hint;
    }
  }
  return { values, hints, skipped, storageKeys };
}

/** Give every item that changed since the last look the time of the change. Returns the local items (live with their value, deleted as tombstones),
 *  the keys that changed, and the items too big to sync. */
export function stamp() {
  const snap = snapshot(), L = loadLedger();
  const r = M.reconcile(L, snap.values, { clock: theClock(), device: config().device, hints: snap.hints, hold: new Set(snap.skipped.map((s) => s.key)) });
  ledger = r.ledger;
  saveLedger(); saveClock();
  return { local: r.local, changed: r.changed, skipped: snap.skipped };
}

// ------------------------------------------------------------------ writing a merged result back
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Where a tour photo's bytes are (`store`) is a fact about one device, not part of the shared entry: keep it for the photos this device knows, and say
 *  "in this browser" for the ones that arrive. */
function keepLocalFacts(storageKey, tree, current) {
  if (!/^findings:/.test(storageKey) || !isObj(tree)) return tree;
  for (const [home, rec] of Object.entries(tree)) {
    if (!isObj(rec) || !Array.isArray(rec.photos)) continue;
    const had = isObj(current?.[home]) && Array.isArray(current[home].photos) ? current[home].photos : [];
    rec.photos = rec.photos.map((p) => ({ ...p, store: had.find((x) => x.id === p.id)?.store || 'idb' }));
  }
  return tree;
}

/** Write the effect of `merged` (item map without photo bytes) to storage, given the `local` items it was merged with. Updates the ledger.
 *  `held`: items too big to sync, which stay as they are. Returns { storageKeys: the keys written, set, del, meta } with the counts of items. */
export function applyMerged(merged, local, held = new Set()) {
  const ch = M.planChanges(local, merged);
  const touched = new Set([...ch.set, ...ch.del].map((k) => M.parseKey(k).storageKey));
  const L = loadLedger(), clk = theClock();
  const byKey = new Map();
  if (touched.size) {
    for (const [key, w] of Object.entries(merged)) {
      if (w.x) continue;
      const { storageKey, path } = M.parseKey(key);
      if (!touched.has(storageKey)) continue;
      if (!byKey.has(storageKey)) byKey.set(storageKey, []);
      byKey.get(storageKey).push({ path, value: w.v, t: w.t });
    }
  }
  const written = [], failed = new Set();
  quietly(() => {
    for (const sk of touched) {
      const entries = byKey.get(sk) || [];
      const rule = M.ruleFor(sk);
      if (!rule) continue;
      if (held.size) {   // an item that was too big to sync is not in the merge, and must not vanish from the rebuilt value
        const have = new Set(entries.map((e) => M.itemKey(sk, e.path)));
        for (const it of M.flatten(sk, parse(read('as:' + sk), null), rule)) if (held.has(it.key) && !have.has(it.key)) entries.push({ path: M.parseKey(it.key).path, value: it.value, t: M.EPOCH });
      }
      let tree = M.unflatten(sk, entries, rule);
      if (tree !== undefined) { tree = M.finishTree(sk, tree, entries); tree = keepLocalFacts(sk, tree, parse(read('as:' + sk), null)); }
      try { if (tree === undefined) localStorage.removeItem('as:' + sk); else localStorage.setItem('as:' + sk, JSON.stringify(tree)); written.push(sk); } catch { failed.add(sk); /* storage full or blocked: the ledger keeps its old view of these items, so nothing is mistaken for a deletion */ }
    }
  });
  for (const key of [...ch.set, ...ch.del, ...ch.meta]) {
    if (failed.has(M.parseKey(key).storageKey)) continue;
    const w = merged[key];
    L.items[key] = w.x ? { t: w.t, d: w.d, h: null, x: 1 } : { t: w.t, d: w.d, h: M.hash(w.v) };
  }
  for (const w of Object.values(merged)) clk.see(w.t);
  saveLedger(); saveClock();
  return { storageKeys: written, failed: [...failed], set: ch.set.length, del: ch.del.length, meta: ch.meta.length, plan: ch };
}

export const ledgerCount = () => Object.values(loadLedger().items).filter((x) => !x.x).length;
