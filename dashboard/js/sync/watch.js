// Hears about writes to the app's own localStorage keys (`as:...`) so the sync layer can stamp them with a time, whichever module made the
// write (the shared `store`, or a view that calls localStorage directly). Tiny and dependency-free apart from the key registry, because
// app.js imports it at the very start. It only observes: every call goes through to the browser's own method first, and a failure in a
// listener never reaches the caller.
import { isSynced } from './sync-model.js';

const listeners = new Set();
const early = new Set();   // keys written before anyone listened
let muted = 0, installed = false;

function note(key) {
  if (muted || typeof key !== 'string' || !key.startsWith('as:')) return;
  const sk = key.slice(3);
  if (!isSynced(sk)) return;
  if (!listeners.size) { early.add(sk); return; }
  for (const fn of listeners) { try { fn(sk); } catch { /* a listener must not break a save */ } }
}

/** Call `fn(storageKey)` for every later write to a synced key (and once per key written before this call). Returns a function that stops listening. */
export function onWrite(fn) {
  listeners.add(fn);
  for (const k of [...early]) { early.delete(k); try { fn(k); } catch { /* ignore */ } }
  return () => listeners.delete(fn);
}
/** Run `fn` with writes not reported (the sync layer's own writes). */
export function quietly(fn) { muted++; try { return fn(); } finally { muted--; } }

export function installWatch() {
  if (installed) return;
  try {
    const proto = Object.getPrototypeOf(localStorage), set = proto.setItem, rem = proto.removeItem, clear = proto.clear;
    proto.setItem = function setItem(k, v) { const r = set.call(this, k, v); if (this === localStorage) note(String(k)); return r; };
    proto.removeItem = function removeItem(k) { const r = rem.call(this, k); if (this === localStorage) note(String(k)); return r; };
    proto.clear = function clearAll() { const r = clear.call(this); if (this === localStorage) for (const l of listeners) { try { l('*'); } catch { /* ignore */ } } return r; };
    installed = true;
  } catch { /* storage unavailable (a private window): nothing to watch */ }
}
installWatch();
