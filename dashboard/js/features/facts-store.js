// The renter's own numbers for a home's unknowns: where they live. They are small, so they are kept in this browser's local
// storage and, when the page is served by `apartmentscout serve`, also written to <search>/renter_facts.json through the local
// API (same token and origin guards as the notes and tour findings; a bundled example search is read-only, so its numbers
// stay in the browser). Every value is marked with its source, "renter", and the day it was entered. Storage calls are
// wrapped in try/catch, because private windows, blocked site data and previews make them throw.
import { S, store } from '../app.js';
import { getSession } from '../local-api.js';
import { normalize, KINDS, checkValue, SOURCE } from './facts-model.js';

const listeners = new Set(), statusListeners = new Set();
let recs = {}, key = '', server = false;
const timers = new Map();
let state = { phase: 'idle', where: 'device', error: '' };   // idle | saving | saved | error

export const searchKey = () => `facts:${S.crit0?.search?.name || S.base}`;
/** `fn(id)` when the numbers change: a home's id, or null after a load or an import. */
export const onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
/** `fn()` when saving starts, ends or fails (see status()). */
export const onStatus = (fn) => { statusListeners.add(fn); return () => statusListeners.delete(fn); };
const notify = (id) => listeners.forEach((fn) => { try { fn(id); } catch (e) { console.warn('facts listener failed', e); } });
export const status = () => ({ ...state, server });
export const get = (id) => recs[id] || null;
export const all = () => recs;
export const has = (id) => !!recs[id] && Object.keys(recs[id]).length > 0;
export const ids = () => Object.keys(recs);
const today = () => { const d = new Date(), p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };

const token = () => document.querySelector('meta[name="as-token"]')?.content || '';
async function api(method, path, body) {
  const r = await fetch(path, {
    method, cache: 'no-store', keepalive: true,   // a number typed as the tab closes still goes out
    headers: { 'X-AS-Token': token(), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await r.json(); } catch { /* an error page without JSON */ }
  if (!r.ok) { const e = new Error(data?.error || `The server answered ${r.status}`); e.status = r.status; throw e; }
  return data;
}
const persist = () => store.set(key, recs);
const setState = (patch) => { state = { ...state, ...patch }; statusListeners.forEach((fn) => { try { fn(); } catch { /* a listener must not break saving */ } }); };

async function push(id) {
  if (!server) { setState({ phase: 'saved', where: 'device', error: '' }); return; }
  setState({ phase: 'saving', where: 'folder', error: '' });
  try {
    await api('POST', `/api/facts/${encodeURIComponent(id)}`, { facts: recs[id] || {} });
    if (!timers.size) setState({ phase: 'saved', where: 'folder', error: '' });
  } catch (e) { setState({ phase: 'error', where: 'device', error: String(e.message || e) }); }
}
function write(id, next) {
  const n = normalize(next, today());
  recs = { ...recs };
  if (Object.keys(n).length) recs[id] = n; else delete recs[id];
  persist(); notify(id);
  setState({ phase: 'saving', where: server ? 'folder' : 'device', error: '' });
  clearTimeout(timers.get(id));
  timers.set(id, setTimeout(() => { timers.delete(id); push(id); }, server ? 250 : 40));
}
/** Set one number for a home (it is checked for its kind; false when it is not a usable value). */
export function setFact(id, kind, value) {
  const v = checkValue(kind, value);
  if (v == null || !KINDS.includes(kind)) return false;
  write(id, { ...(recs[id] || {}), [kind]: { value: v, at: today(), source: SOURCE } });
  return true;
}
export function clearFact(id, kind) {
  if (!recs[id]?.[kind]) return;
  const { [kind]: _drop, ...rest } = recs[id];
  write(id, rest);
}
export function flush() { for (const [id, t] of [...timers]) { clearTimeout(t); timers.delete(id); push(id); } }

/** Numbers for a picks backup, and back. */
export const exportFacts = () => Object.fromEntries(Object.entries(recs).map(([id, f]) => [id, f]));
export function importFacts(map) {
  let n = 0;
  for (const [id, raw] of Object.entries(map || {})) {
    if (typeof id !== 'string' || !id || id.length > 120) continue;
    const inc = normalize(raw, today()), cur = recs[id] || {};
    const merged = { ...inc, ...cur };   // what is already here wins: a backup never overwrites a newer entry
    if (JSON.stringify(merged) !== JSON.stringify(cur)) { recs = { ...recs, [id]: merged }; n++; if (server) push(id); }
  }
  if (n) { persist(); notify(null); }
  return n;
}

/** The sync layer wrote this search's numbers to storage (sync/sync-store.js): read them again; those that changed go to the search folder too. */
export function reloadFromStorage() {
  if (!key) return [];
  const local = store.get(key, {}) || {}, next = {};
  for (const [id, f] of Object.entries(local)) { const n = normalize(f, today()); if (Object.keys(n).length) next[id] = n; }
  const changed = [...new Set([...Object.keys(recs), ...Object.keys(next)])].filter((id) => JSON.stringify(recs[id]) !== JSON.stringify(next[id]));
  recs = next;
  if (changed.length) { persist(); notify(null); if (server) for (const id of changed) push(id); }
  return changed;
}

/** Load this search's numbers: from the browser, then merged with the search folder's when the API is there. */
export async function init() {
  key = searchKey();
  const local = store.get(key, {}) || {};
  recs = {};
  for (const [id, f] of Object.entries(local)) { const n = normalize(f, today()); if (Object.keys(n).length) recs[id] = n; }
  const sess = await getSession().catch(() => null);
  if (sess?.facts?.save) {
    server = true;
    try {
      const { facts } = await api('GET', '/api/facts');
      for (const [id, f] of Object.entries(facts || {})) recs[id] = { ...normalize(f, today()), ...(recs[id] || {}) };
      for (const id of Object.keys(recs)) if (!facts?.[id] || JSON.stringify(normalize(facts[id])) !== JSON.stringify(recs[id])) push(id);
    } catch (e) { setState({ phase: 'error', error: String(e.message || e) }); }
  }
  persist();
  notify(null);
  addEventListener('pagehide', flush);
}
