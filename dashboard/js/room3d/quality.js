// The render quality both 3D engines share for the room: 'fast' (the default, what phones start in) or 'visual'. The engines'
// own quality modules (plan/quality3d.js, unit/quality3d.js) write it, so the room's meshes and lights can ask without importing
// either engine. A look, not a measurement.
let q = 'fast';
const subs = new Set();
/** 'fast' | 'visual'. */
export const roomQuality = () => q;
/** Set the quality; true when it changed. Subscribers run after a change. */
export function setRoomQuality(m) {
  const next = m === 'visual' ? 'visual' : 'fast';
  if (next === q) return false;
  q = next;
  for (const f of subs) { try { f(q); } catch { /* a subscriber must not break the engine */ } }
  return true;
}
/** Call fn(quality) after every change; returns the unsubscribe function. */
export function onRoomQuality(fn) { subs.add(fn); return () => subs.delete(fn); }
