// The measurements of each plan, kept in one place so the 2D plan, the Floor plan studio's 3D view and Unit 3D's Inside camera
// show the same tape: a measurement made on the drawing is there in the room, and the other way round. They are in plan
// inches, so they mean the same in every view of the same plan. Remembered in this browser (best effort), cleared with Clear.
import { createMeasureStore } from './core.js';

const stores = new Map();

/**
 * The store for a plan. `persist` = {load(key) -> list | null, save(key, list)} (optional): where it is remembered.
 * @returns {ReturnType<typeof createMeasureStore> & {subscribe: (fn: Function) => () => void, key: string}}
 */
export function storeFor(key, persist = null) {
  if (stores.has(key)) return stores.get(key);
  const subs = new Set();
  const base = createMeasureStore((s) => {
    for (const fn of subs) { try { fn(s); } catch { /* a view that went away */ } }
    if (s.loading) return;
    try { persist?.save(key, s.list); } catch { /* storage unavailable or full: it lasts for this page */ }
  });
  const api = Object.assign(base, {
    key,
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
    loading: false,
  });
  let saved = null;
  try { saved = persist?.load(key); } catch { saved = null; }
  if (Array.isArray(saved) && saved.length) {
    const ok = saved.filter((m) => m && Array.isArray(m.a) && Array.isArray(m.b) && m.a.length >= 2 && m.b.length >= 2 && [...m.a, ...m.b].every((v) => typeof v === 'number' && Number.isFinite(v)));
    api.loading = true; api.load(ok.map((m, i) => ({ id: Number.isInteger(m.id) ? m.id : i + 1, a: [m.a[0], m.a[1], m.a[2] || 0], b: [m.b[0], m.b[1], m.b[2] || 0], ka: m.ka || 'free', kb: m.kb || 'free' }))); api.loading = false;
  }
  stores.set(key, api);
  return api;
}

/** Forget the in-memory stores (tests). */
export const resetStores = () => stores.clear();

/** Publish a test and debugging handle on window.__measure (like __unit3d): getters stay getters. Never used by the page itself. */
export function expose(src) {
  const t = (window.__measure = window.__measure || {});
  for (const k of Object.keys(src)) Object.defineProperty(t, k, { ...Object.getOwnPropertyDescriptor(src, k), configurable: true, enumerable: true });
}
