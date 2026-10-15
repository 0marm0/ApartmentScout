// Sync model: the pure part. What the renter owns is cut into small ITEMS, every item carries the time it was last written and the
// device that wrote it, and two copies of the data are merged item by item. No DOM, no storage and no network are used here, so
// `node --test tests/js/sync.test.mjs` covers all of it; sync-store.js (this browser), gist-client.js (api.github.com) and
// sync-file.js (a file) move the items around.
//
// The model in one paragraph
//   An item is one value at one path inside one of the app's own storage keys, for example the note on one home
//   (`picks/<home>/note`), one renter number (`facts:<search>/<home>/rent`) or one tour photo's entry (`findings:<search>/<home>/photos/<id>`).
//   The registry below (RULES) says which storage keys are the renter's own and how deep they are cut. Everything else (theme, density,
//   filters, map layers, caches, the sync token) is never synced. A merged copy keeps, per item, the write with the newest time; ties are
//   broken by device id and then by the value, so the result does not depend on the order two copies are merged in (the merge is
//   commutative, associative and idempotent). A deletion is an item with `x: 1` and no value (a tombstone): it is a write like any
//   other, so a later edit on another device brings the item back instead of being lost, and an item that is merely missing from one
//   copy is never treated as deleted. Tombstones are forgotten after TOMBSTONE_DAYS.
//
// The document (an extension of the picks backup, `version: 1`, that "Back up picks" writes)
//   { version: 2, search, picks, weights, findings, facts, history, moveplan,  <- what a version-1 reader understands (file export only)
//     sync: { format: 'apartmentscout-sync', schema: 1, device, devices: {id: {name, at}}, saved,
//             items: { <item key>: { t, d, v } | { t, d, x: 1 } } } }
//   A version-1 backup has no `sync` block: its items are derived from the old fields, with the times the data itself carries.

export const FORMAT = 'apartmentscout-sync';
export const SCHEMA = 1;
export const DOC_VERSION = 2;
export const EPOCH = '1970-01-01T00:00:00.000Z';
export const MAIN_FILE = 'apartmentscout-sync.json';
export const PART_RE = /^apartmentscout-sync(?:-(\d{1,3}))?\.json$/;
export const LIMITS = {
  item: 500 * 1024,            // bytes: a bigger item (a very large plan) stays on its device and is listed as skipped
  part: 800 * 1024,            // bytes per gist file; GitHub cuts the content it returns at 1 MB
  photoBytes: 220 * 1024,      // an embedded photo (JPEG, data URL included) is never bigger than this
  photoPx: 1280,
  photosTotal: 6 * 1024 * 1024,
  photosMax: 60,
  tombstoneDays: 120,
  futureSkewMs: 24 * 3600 * 1000,   // a time further ahead than this is a wrong clock, not a write from the future
};

// ------------------------------------------------------------------ small helpers
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const enc = (s) => String(s).replace(/%/g, '%25').replace(/\//g, '%2F');
const dec = (s) => s.replace(/%2F/g, '/').replace(/%25/g, '%');
export const utf8Len = (s) => new TextEncoder().encode(s).length;

/** JSON with the keys of every object in sorted order: the same value always gives the same text. */
export function stable(v) {
  if (Array.isArray(v)) return '[' + v.map((x) => stable(x === undefined ? null : x)).join(',') + ']';
  if (isObj(v)) return '{' + Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
  return JSON.stringify(v === undefined ? null : v);
}
/** A short hash of a value (cyrb53 over its stable text). Used to see whether an item changed, never as a secret. */
export function hash(v) {
  const s = stable(v);
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
export const iso = (ms) => new Date(ms).toISOString();
const ms = (t) => { const x = Date.parse(t); return Number.isFinite(x) ? x : 0; };

// ------------------------------------------------------------------ the registry: which storage keys are the renter's own
// `depth`: how many levels of plain objects are cut into items (0: the whole value is one item). `skip`: fields at the item level that
// are bookkeeping (a day stamp the app rewrites on every change) and are rebuilt after a merge. `lists`: arrays of objects with an id
// that become one item per element. `rootList`: the value itself is such an array. `strict`: a level above the item level must be an object
// (a home that is a string is junk, not an item).
// Storage keys are written by the app as `as:<key>`; the keys here are without the prefix.
export const RULES = [
  { id: 'picks', label: 'Starred homes, tiers, notes and tour times', re: /^picks$/, depth: 2, strict: true, skip: ['updated'] },
  { id: 'weights', label: 'Ranking weights', re: /^weights$/, depth: 1 },
  { id: 'preset', label: 'Weight preset', re: /^preset$/, depth: 0 },
  { id: 'compare', label: 'Homes in Compare', re: /^compare$/, depth: 0 },
  { id: 'findings', label: 'Tour findings and photo entries', re: /^findings:/, depth: 2, strict: true, skip: ['updated', 'v'], lists: { photos: { sortBy: 'at', omit: ['store'] } } },
  { id: 'facts', label: 'Your numbers for unknowns (rent, fees, size)', re: /^facts:/, depth: 2, strict: true },
  { id: 'trail', label: 'Decision history', re: /^trail:/, depth: 1, rootList: { id: 'e', sortBy: 'at' } },
  { id: 'office', label: 'Answers from the leasing office', re: /^office:/, depth: 2 },
  { id: 'moveplan', label: 'Move plan: steps, dates and costs', re: /^moveplan:/, depth: 4 },
  { id: 'seen', label: "What's new: what you have read", re: /^whatsnew:seen:/, depth: 0 },
  { id: 'tourplan', label: 'Tour-day planner', re: /^tourplan:/, depth: 1 },
  { id: 'tourday', label: 'Tour day checklist', re: /^tourday:/, depth: 2 },
  { id: 'criteria', label: 'Search settings you edited here', re: /^criteria:/, depth: 0 },
  { id: 'commute', label: 'Commute mode and destination', re: /^commute:/, depth: 0 },
  { id: 'plan', label: 'Floor plan layouts and furniture', re: /^(plan\.|plan-projects\.|plan-light\.|plan-city\.|furniture-extra\.|plan-scenario:|compare-specs:|unit-scenario-use:)/, depth: 0, plans: true },
  { id: 'views', label: 'View calibrations, model pins and measurements', re: /^(view-cal:|model-anchor:|parts-assumed:|measure\.)/, depth: 0 },
];
const PROJECTS = /^plan-projects\./;   // the studio's project library: one item per project, so two projects saved on two devices both stay

/** The rule for a storage key (without `as:`), or null when the key is not the renter's own. */
export function ruleFor(storageKey) {
  const k = String(storageKey);
  const r = RULES.find((x) => x.re.test(k));
  if (!r) return null;
  return PROJECTS.test(k) ? { ...r, depth: 1 } : r;
}
export const isSynced = (storageKey) => !!ruleFor(storageKey);

/** The item key for a storage key and a path. */
export const itemKey = (storageKey, path = []) => [enc(storageKey), ...path.map(enc)].join('/');
/** The storage key and path of an item key. */
export function parseKey(key) {
  const parts = String(key).split('/').map(dec);
  return { storageKey: parts[0], path: parts.slice(1) };
}
/** Photo bytes travel as items of their own: `blob/<findings key>/<home>/<photo id>`; their value is a JPEG data URL. */
export const BLOB = 'blob';
export const blobKey = (findingsKey, home, pid) => [BLOB, enc(findingsKey), enc(home), enc(pid)].join('/');
export const isBlobKey = (key) => key.startsWith(BLOB + '/');
export function parseBlobKey(key) {
  const [, f, h, p] = key.split('/');
  return { findingsKey: dec(f || ''), home: dec(h || ''), pid: dec(p || '') };
}
/** The item key of one photo entry, and the blob key that goes with it. */
export const photoKeyOf = (findingsKey, home, pid) => itemKey(findingsKey, [home, 'photos', pid]);

// ------------------------------------------------------------------ cutting a storage value into items, and putting it back
const omit = (o, names) => { if (!names?.length) return o; const c = { ...o }; for (const n of names) delete c[n]; return c; };

/** The items of one storage value: [{ key, value, hint }]. `hint` is the time the app itself recorded for the record the item sits in (a pick's day, a
 *  visit's `updated`), used as the time of data that was written before sync existed. A value of an unexpected shape yields what can be cut and nothing else. */
export function flatten(storageKey, value, rule = ruleFor(storageKey)) {
  if (!rule || value === undefined) return [];
  const out = [];
  if (rule.rootList) {
    if (!Array.isArray(value)) return [];
    for (const el of value) {
      const id = isObj(el) ? el[rule.rootList.id] : null;
      if (typeof id === 'string' && id) out.push({ key: itemKey(storageKey, [id]), value: el });
    }
    return out;
  }
  const day = (x) => (typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) ? x + 'T00:00:00.000Z' : typeof x === 'string' && ms(x) ? iso(ms(x)) : undefined);
  if (rule.depth > 0 && !isObj(value)) return [];
  const walk = (node, path) => {
    const d = path.length;
    if (d < rule.depth && isObj(node)) {
      const hint = d === rule.depth - 1 && rule.skip?.includes('updated') ? day(node.updated) : undefined;
      for (const [k, v] of Object.entries(node)) {
        if (v === undefined) continue;
        if (d === rule.depth - 1 && rule.skip?.includes(k)) continue;
        if (rule.strict && d < rule.depth - 1 && !isObj(v)) continue;
        if (d === rule.depth - 1 && rule.lists?.[k] && Array.isArray(v)) {
          for (const el of v) {
            if (isObj(el) && typeof el.id === 'string' && el.id) out.push({ key: itemKey(storageKey, [...path, k, el.id]), value: omit(el, rule.lists[k].omit), hint: day(el.at) });
          }
          continue;
        }
        if (d + 1 === rule.depth || !isObj(v)) { out.push({ key: itemKey(storageKey, [...path, k]), value: v, ...(hint ? { hint } : {}) }); continue; }
        walk(v, [...path, k]);
      }
      return;
    }
    out.push({ key: itemKey(storageKey, path), value: node });
  };
  walk(value, []);
  return out;
}

/** The storage value for a set of live items of one storage key: [{ path, value }] -> the value the app stores (or undefined when empty). */
export function unflatten(storageKey, entries, rule = ruleFor(storageKey)) {
  if (!rule || !entries.length) return undefined;
  if (rule.rootList) {
    const list = entries.map((e) => e.value).filter(isObj);
    const by = rule.rootList.sortBy;
    list.sort((a, b) => (String(a[by] ?? '') < String(b[by] ?? '') ? -1 : String(a[by] ?? '') > String(b[by] ?? '') ? 1 : String(a[rule.rootList.id]) < String(b[rule.rootList.id]) ? -1 : 1));
    return list;
  }
  if (rule.depth === 0) return entries.find((e) => e.path.length === 0)?.value;
  const root = {};
  const lists = rule.lists || {};
  for (const { path, value } of [...entries].sort((a, b) => a.path.length - b.path.length)) {
    if (!path.length) continue;
    const isListEl = path.length === rule.depth + 1 && lists[path[rule.depth - 1]];
    const walkPath = isListEl ? path.slice(0, -1) : path;
    let node = root, ok = true;
    for (let i = 0; i < walkPath.length - 1; i++) {
      const k = walkPath[i];
      if (node[k] === undefined) node[k] = {};
      if (!isObj(node[k])) { ok = false; break; }   // a leaf and a branch under one name: the shorter path wins
      node = node[k];
    }
    if (!ok) continue;
    const last = walkPath[walkPath.length - 1];
    if (isListEl) {
      if (node[last] === undefined) node[last] = [];
      if (Array.isArray(node[last])) node[last].push({ ...(isObj(value) ? value : {}), id: path[path.length - 1] });
    } else if (!(isObj(node[last]) && Object.keys(node[last]).length)) node[last] = value;
  }
  for (const [name, spec] of Object.entries(lists)) {
    const sortList = (rec) => { if (isObj(rec) && Array.isArray(rec[name])) rec[name].sort((a, b) => (String(a[spec.sortBy] ?? '') < String(b[spec.sortBy] ?? '') ? -1 : String(a[spec.sortBy] ?? '') > String(b[spec.sortBy] ?? '') ? 1 : a.id < b.id ? -1 : 1)); };
    if (rule.depth === 2) for (const rec of Object.values(root)) sortList(rec);
  }
  return Object.keys(root).length ? root : undefined;
}

/** The bookkeeping fields the items skip, put back after a merge: a pick's `updated` day, a visit's `updated` time and version. `entries`: the live
 *  items of the storage key as [{ path, t }] (any extra fields are ignored). Returns the tree, changed in place. */
export function finishTree(storageKey, tree, entries) {
  const rule = ruleFor(storageKey);
  if (!rule || !isObj(tree) || rule.depth !== 2 || !rule.skip) return tree;
  const newest = {};
  for (const e of entries) { const home = e.path[0]; if (home !== undefined && (!newest[home] || e.t > newest[home])) newest[home] = e.t; }
  for (const [home, rec] of Object.entries(tree)) {
    if (!isObj(rec) || !newest[home]) continue;
    if (rule.id === 'picks') rec.updated = newest[home].slice(0, 10);
    if (rule.id === 'findings') { rec.updated = newest[home].replace(/\.\d+Z$/, 'Z'); rec.v = 1; }
  }
  return tree;
}

// ------------------------------------------------------------------ times
/** A time for data that was written before sync existed (or imported from an old backup): the day or time the data itself carries, else the epoch. */
export function legacyTime(key, value) {
  const { storageKey, path } = parseKey(key);
  let s = null;
  if (/^facts:/.test(storageKey)) s = isObj(value) ? value.at : null;
  else if (/^trail:/.test(storageKey)) s = isObj(value) ? value.at : null;
  else if (/^findings:/.test(storageKey) && path[1] === 'photos') s = isObj(value) ? value.at : null;
  else if (/^office:/.test(storageKey)) s = isObj(value) ? value.day : null;
  else if (/^view-cal:/.test(storageKey)) s = isObj(value) ? value.saved : null;
  const t = ms(typeof s === 'string' ? (s.length === 10 ? s + 'T00:00:00Z' : s) : '');
  return t ? iso(t) : EPOCH;
}

/** A hybrid clock: never goes backwards, and moves past any time it has seen, so an edit made after a sync is always newer than what it replaced
 *  even when this device's clock is behind the other one. */
export function makeClock(last = EPOCH, now = () => Date.now()) {
  let cur = ms(last);
  return {
    tick() { cur = Math.max(cur + 1, now()); return iso(cur); },
    /** Note a time seen elsewhere (a remote write), unless it is absurdly far in the future. */
    see(t) { const x = ms(t); if (x > cur && x <= now() + LIMITS.futureSkewMs) cur = x; },
    get last() { return iso(cur); },
  };
}

// ------------------------------------------------------------------ the ledger: what was last seen locally, so changes get a time
// ledger = { v: 1, born: <iso | null>, items: { <key>: { t, d, h, x? } } }
export const newLedger = () => ({ v: 1, born: null, items: {} });

/** Compare what is stored now (`values`: key -> value) with the ledger and give every changed item a time. Returns the new ledger, the local
 *  items (live ones with their value, deleted ones as tombstones) and which keys changed. `established` is false on the very first run
 *  of a ledger: items that were already there get the time their data carries, not "now". */
export function reconcile(ledger, values, { clock, device, hints = {}, hold = null, now = iso(Date.now()) }) {
  const old = ledger?.items || {};
  const established = !!ledger?.born;
  const items = {}, local = {}, changed = [];
  for (const [key, value] of Object.entries(values)) {
    const h = hash(value), prev = old[key];
    if (prev && !prev.x && prev.h === h) items[key] = prev;
    else {
      const first = !prev && !established;
      // A change that arrives with a time the data itself carries (a visit read from the search folder keeps its own `updated`, minutes or days old) is
      // dated by it; a change made here carries "now" in that field and gets the clock. A bare day is too coarse to trust: it is never used this way.
      const h0 = hints[key], own = h0 && !/T00:00:00\.000Z$/.test(h0) && ms(h0) < ms(now) - 90000 && (!prev || h0 > prev.t) ? h0 : null;
      items[key] = { t: first ? (hints[key] && legacyTime(key, value) === EPOCH ? hints[key] : legacyTime(key, value)) : own || clock.tick(), d: device, h };
      if (!first) changed.push(key);
    }
    local[key] = { t: items[key].t, d: items[key].d, v: value };
  }
  for (const [key, prev] of Object.entries(old)) {
    if (key in values) continue;
    if (hold?.has(key)) { items[key] = prev; continue; }   // too big to sync, but still here: not a deletion, not sent
    if (prev.x) { items[key] = prev; local[key] = { t: prev.t, d: prev.d, x: 1 }; continue; }
    items[key] = { t: clock.tick(), d: device, h: null, x: 1 };
    local[key] = { t: items[key].t, d: device, x: 1 };
    changed.push(key);
  }
  return { ledger: { v: 1, born: ledger?.born || now, items }, local, changed };
}

// ------------------------------------------------------------------ merging
/** Does write `a` beat write `b`? Newest time; then the higher device id; then a live value over a deletion; then the larger value text. Total, so the merge is deterministic. */
export function beats(a, b) {
  if (a.t !== b.t) return a.t > b.t;
  if ((a.d || '') !== (b.d || '')) return (a.d || '') > (b.d || '');
  if (!!a.x !== !!b.x) return !a.x;
  return stable(a.v) >= stable(b.v);
}
/** The merge of two item maps. Neither argument is changed. */
export function mergeItems(a, b) {
  const out = { ...a };
  for (const [key, w] of Object.entries(b || {})) {
    const cur = out[key];
    if (!cur || (!sameWrite(cur, w) && beats(w, cur))) out[key] = w;
  }
  return out;
}
const sameWrite = (a, b) => a.t === b.t && (a.d || '') === (b.d || '') && !!a.x === !!b.x && stable(a.v) === stable(b.v);
/** Forget deletions older than the retention window (a device that was away longer than that could bring such an item back). */
export function pruneTombstones(items, nowMs = Date.now()) {
  const cut = nowMs - LIMITS.tombstoneDays * 86400000, out = {};
  for (const [k, w] of Object.entries(items)) if (!(w.x && ms(w.t) < cut)) out[k] = w;
  return out;
}
/** What applying a merged map does to a copy that currently holds `local`: items to write, items to remove, and items whose time moved without the value changing. */
export function planChanges(local, merged) {
  const set = [], del = [], meta = [];
  for (const [key, w] of Object.entries(merged)) {
    const l = local[key];
    if (l && sameWrite(l, w)) continue;
    if (w.x) (l && !l.x ? del : meta).push(key);
    else if (!l || l.x || stable(l.v) !== stable(w.v)) set.push(key);
    else meta.push(key);
  }
  return { set, del, meta };
}
/** Items of one store of the document that differ from another (used to tell whether a push would change anything). */
export const sameItems = (a, b) => {
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => b[k] && sameWrite(a[k], b[k]));
};

// ------------------------------------------------------------------ the document
export function buildDoc(items, { device, devices = {}, search = null, saved = iso(Date.now()), legacy = null } = {}) {
  const doc = { version: DOC_VERSION, ...(search ? { search } : {}) };
  if (legacy) Object.assign(doc, legacy);
  doc.sync = { format: FORMAT, schema: SCHEMA, device, devices, saved, items };
  return doc;
}

/** The version-1 fields (what "Back up picks" has always written) for the active search, built from live items. */
export function legacyView(items, search) {
  const byKey = new Map();
  for (const [key, w] of Object.entries(items)) {
    if (w.x || isBlobKey(key)) continue;
    const { storageKey, path } = parseKey(key);
    if (!byKey.has(storageKey)) byKey.set(storageKey, []);
    byKey.get(storageKey).push({ path, value: w.v });
  }
  const tree = (sk) => (byKey.has(sk) ? unflatten(sk, byKey.get(sk)) : undefined);
  const out = {};
  const picks = tree('picks'); if (picks) out.picks = picks; else out.picks = {};
  const weights = tree('weights'); if (weights) out.weights = weights;
  if (search) {
    const findings = tree(`findings:${search}`), facts = tree(`facts:${search}`), trail = tree(`trail:${search}`);
    if (findings) out.findings = findings;
    if (facts) out.facts = facts;
    if (trail?.length) out.history = trail;
    const moveplan = tree(`moveplan:${search}`); if (moveplan) out.moveplan = moveplan;
  }
  return out;
}

/** Items from an old picks backup (no `sync` block). Times come from the data itself; anything without one is the epoch, so a copy that has
 *  the item already keeps its own and a copy that lacks it gets it. */
export function itemsFromLegacy(js, search) {
  const out = {};
  const add = (storageKey, value) => {
    if (value === undefined || value === null) return;
    for (const { key, value: v, hint } of flatten(storageKey, value)) {
      const t = legacyTime(key, v);
      let own = hint;
      if (!own && storageKey.startsWith('moveplan:')) {   // a plan's day is on the home (`homes/<id>/updated`), not on the field
        const day = js.moveplan?.homes?.[parseKey(key).path[1]]?.updated;
        if (typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day)) own = day + 'T00:00:00.000Z';
      }
      out[key] = { t: t === EPOCH && own ? own : t, d: 'backup', v };
    }
  };
  if (isObj(js.picks)) add('picks', js.picks);
  if (isObj(js.weights)) add('weights', js.weights);
  const sk = typeof js.search === 'string' && js.search ? js.search : search;
  if (sk) {
    if (isObj(js.findings)) add(`findings:${sk}`, js.findings);
    if (isObj(js.facts)) add(`facts:${sk}`, js.facts);
    if (Array.isArray(js.history)) add(`trail:${sk}`, js.history);
    if (isObj(js.moveplan)) add(`moveplan:${sk}`, js.moveplan);
  }
  return out;
}

/** The items of a parsed JSON document: a sync document, or a picks backup of any age. Throws an Error with a plain message for anything else. */
export function parseDoc(js, { search = null } = {}) {
  if (!isObj(js)) throw new Error('That file is not an ApartmentScout backup.');
  const s = js.sync;
  if (isObj(s) && s.format === FORMAT && isObj(s.items)) {
    if (s.schema > SCHEMA) throw new Error('That file was made by a newer version of ApartmentScout. Update this one first.');
    const items = {};
    for (const [key, w] of Object.entries(s.items)) {
      if (!isObj(w) || typeof w.t !== 'string' || !ms(w.t) || typeof key !== 'string' || key.length > 400) continue;
      if (w.x) items[key] = { t: w.t, d: String(w.d || ''), x: 1 };
      else if ('v' in w) items[key] = { t: w.t, d: String(w.d || ''), v: w.v };
    }
    return { items, devices: isObj(s.devices) ? s.devices : {}, device: String(s.device || ''), search: js.search || null, legacy: false };
  }
  if (isObj(js.picks)) return { items: itemsFromLegacy(js, search), devices: {}, device: '', search: js.search || null, legacy: true };
  throw new Error('That file is not an ApartmentScout backup.');
}

// ------------------------------------------------------------------ splitting a document over several files (a gist keeps a file whole only up to 1 MB)
export const partName = (i) => (i === 0 ? MAIN_FILE : `apartmentscout-sync-${i + 1}.json`);
/** Cut the items into parts of at most `cap` bytes. Part 0 carries the head of the document; the others carry `sync.part` and their items. */
export function splitDoc(doc, cap = LIMITS.part) {
  const head = { ...doc, sync: { ...doc.sync, items: {} } };
  const keys = Object.keys(doc.sync.items).sort((a, b) => (isBlobKey(a) === isBlobKey(b) ? (a < b ? -1 : 1) : isBlobKey(a) ? 1 : -1));
  const parts = [{ ...head, sync: { ...head.sync, items: {} } }];
  let size = utf8Len(JSON.stringify(parts[0]));
  for (const k of keys) {
    const w = doc.sync.items[k], len = utf8Len(JSON.stringify(k) + JSON.stringify(w)) + 2;
    let cur = parts[parts.length - 1];
    if (size + len > cap && Object.keys(cur.sync.items).length) {
      cur = { sync: { format: FORMAT, schema: SCHEMA, part: parts.length + 1, items: {} } };
      parts.push(cur); size = utf8Len(JSON.stringify(cur));
    }
    cur.sync.items[k] = w; size += len;
  }
  return parts.map((p, i) => ({ name: partName(i), text: JSON.stringify(p) }));
}
/** The document back from its parts: parse each, merge the items. `files`: { name: text }. */
export function joinParts(files) {
  const names = Object.keys(files).filter((n) => PART_RE.test(n));
  if (!names.includes(MAIN_FILE)) throw new Error('The sync data is missing from that gist.');
  const items = {};
  let head = null;
  for (const n of names.sort()) {
    let js;
    try { js = JSON.parse(files[n]); } catch { throw new Error(`The sync file ${n} is not valid JSON.`); }
    const p = parseDoc(js);
    Object.assign(items, mergeItems(items, p.items));
    if (n === MAIN_FILE) head = p;
  }
  return { items, devices: head?.devices || {}, device: head?.device || '' };
}

// ------------------------------------------------------------------ what is synced, for the panel
/** Counts by group for the panel: [{ id, label, n }] over live items (blobs counted as photos). */
export function summarize(items) {
  const n = new Map();
  for (const [key, w] of Object.entries(items)) {
    if (w.x) continue;
    const id = isBlobKey(key) ? 'photos' : ruleFor(parseKey(key).storageKey)?.id;
    if (id) n.set(id, (n.get(id) || 0) + 1);
  }
  const rows = RULES.map((r) => ({ id: r.id, label: r.label, n: n.get(r.id) || 0 }));
  rows.push({ id: 'photos', label: 'Small copies of tour photos', n: n.get('photos') || 0 });
  return rows;
}
/** The storage keys a set of item keys belongs to. */
export const storageKeysOf = (keys) => [...new Set(keys.filter((k) => !isBlobKey(k)).map((k) => parseKey(k).storageKey))];

/** Which tour photos still have bytes worth embedding, and which embedded copies have lost their photo. `entries`: live photo items' keys; `blobs`: live blob item keys. */
export function blobKeyForPhoto(photoItemKey) {
  const { storageKey, path } = parseKey(photoItemKey);
  return blobKey(storageKey, path[0], path[2]);
}
export function photoKeyForBlob(bk) {
  const { findingsKey, home, pid } = parseBlobKey(bk);
  return photoKeyOf(findingsKey, home, pid);
}
