// Two-key chords ("g" then "m" for the Map), as a pure state machine so node can test it. keys.js feeds it key
// events and acts on what it returns; this module knows nothing about the DOM.

export const PREFIX = 'g';
/** Second key -> where it goes. `view` is the route head; `hash` the full hash when it is not just the view. */
export const CHORDS = [
  { key: 'm', view: 'map', label: 'Map' },
  { key: 's', view: 'list', label: 'Shortlist' },
  { key: 'c', view: 'compare', label: 'Compare' },
  { key: 'u', view: 'unit', label: 'Unit 3D' },
  { key: 'p', view: 'plan', label: 'Floor plan' },
  { key: 'r', view: 'research', label: 'Research' },
  { key: 't', view: 'tours', hash: 'list/tours', label: 'Tours' },
];
export const CHORD_TTL = 1600;

const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'AltGraph']);

export const idleChord = () => ({ pending: null });

/**
 * One key event in, one decision out.
 *   ev    { key, mod (ctrl, meta or alt held), typing (focus is in a text field or a dialog owns the keys) }
 *   state { pending: null | { at } }
 * Returns { state, consume, go, hint }:
 *   consume  the event was part of a chord: the caller should preventDefault and stop it reaching other handlers
 *   go       a CHORDS entry to navigate to (the chord completed)
 *   hint     the list of second keys to show while the prefix is waiting, or null
 */
export function stepChord(state, ev, now = Date.now(), ttl = CHORD_TTL) {
  const live = state.pending && now - state.pending.at <= ttl ? state.pending : null;
  const none = { pending: null };
  if (ev.mod || ev.typing) return { state: none, consume: false, go: null, hint: null };
  if (MODIFIER_KEYS.has(ev.key)) return { state: live ? { pending: live } : none, consume: false, go: null, hint: live ? CHORDS : null };
  if (live) {
    if (ev.key === 'Escape') return { state: none, consume: true, go: null, hint: null };
    const hit = CHORDS.find((c) => c.key === ev.key.toLowerCase());
    if (hit) return { state: none, consume: true, go: hit, hint: null };
    return { state: none, consume: false, go: null, hint: null };   // not a chord after all: let the key do its normal job
  }
  if (ev.key === PREFIX) return { state: { pending: { at: now } }, consume: true, go: null, hint: CHORDS };
  return { state: none, consume: false, go: null, hint: null };
}
