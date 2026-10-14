// Command-palette actions that belong to this feature set, in the palette's own shape:
// [name, description, icon, key hint, run]. palette.js spreads extraActions() into its Actions group.
import { undo, redo, canUndo, canRedo, peek } from './undo.js';
import { openCheatSheet } from './cheatsheet.js';

const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const IC = {
  undo: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M5.5 3.5L2.5 6.5l3 3"/><path d="M2.8 6.5H10a3.5 3.5 0 010 7H7"/></svg>',
  redo: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M10.5 3.5l3 3-3 3"/><path d="M13.2 6.5H6a3.5 3.5 0 000 7h3"/></svg>',
  tour: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="8" cy="8" r="6"/><path d="M8 7.2v3.6M8 5.2v.1"/></svg>',
  keys: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><rect x="1.5" y="4" width="13" height="8.5" rx="1.8"/><path d="M4 7h1M7 7h1M10 7h2M4.5 10h7"/></svg>',
};

export function extraActions() {
  const p = peek();
  return [
    canUndo() && [`Undo: ${p.undo}`, 'Put back what it was before this change', IC.undo, mac ? '⌘Z' : 'Ctrl Z', () => undo()],
    canRedo() && [`Redo: ${p.redo}`, 'Do the change you just undid', IC.redo, mac ? '⇧⌘Z' : 'Ctrl Shift Z', () => redo()],
    ['Take the tour', 'Five short steps: filters, weights, stars, Compare and Unit 3D', IC.tour, '', () => import('./coach.js').then((m) => m.startCoach({ force: true }))],
    ['Search the keyboard shortcuts', 'The cheat sheet: every key, searchable', IC.keys, '?', () => openCheatSheet()],
  ].filter(Boolean);
}
