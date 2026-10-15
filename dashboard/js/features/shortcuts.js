// Every keyboard shortcut the dashboard answers to, as data: the searchable cheat sheet (cheatsheet.js) renders it and
// node tests keep it honest. Pure. Keep this list in step with the handlers in app.js, shell.js, list.js, unit3d.js,
// plan3d.js, features/keys.js and the views' own listboxes.
import { CHORDS } from './chords.js';

/** Key tokens: 'mod' is Cmd on a Mac and Ctrl elsewhere, 'shift' and 'alt' follow the platform; everything else is shown as is. */
export function keyLabel(token, mac = false) {
  if (token === 'mod') return mac ? '⌘' : 'Ctrl';
  if (token === 'shift') return mac ? '⇧' : 'Shift';
  if (token === 'alt') return mac ? '⌥' : 'Alt';
  return token;
}

const c = (...keys) => keys;   // one combination: keys pressed together, or in order when the row is a chord

/**
 * Groups of rows. `views` limits a group to the views where its keys work (null: everywhere); the sheet lists the
 * current view's group first. A row's `combos` are alternatives; `chord: true` means "press one, then the other".
 */
export const GROUPS = [
  { id: 'global', title: 'Anywhere', views: null, rows: [
    { combos: [c('mod', 'K'), c('/')], desc: 'Search homes, views and actions, or ask in plain words', tags: 'command palette find jump filter query' },
    { combos: [c('?')], desc: 'Open this cheat sheet', tags: 'help keyboard shortcuts keys' },
    { combos: [c('1'), c('2'), c('3'), c('4'), c('5')], desc: 'Switch tab: Map, Shortlist, Compare, Home (Unit 3D or Floor plan; press 4 again to flip), Research', tags: 'navigate view tab number home unit plan', range: '1–5' },
    { combos: [c('t')], desc: 'Flip between the light and dark theme', tags: 'theme appearance' },
    { combos: [c('Esc')], desc: 'Close the open panel, menu or dialog', tags: 'close dismiss cancel' },
    { combos: [c('mod', 'Z')], desc: 'Undo the last pick, compare, filter, weight or commute change', tags: 'undo revert back' },
    { combos: [c('shift', 'mod', 'Z'), c('mod', 'Y')], desc: 'Redo the change you just undid', tags: 'redo again' },
  ] },
  { id: 'go', title: 'Go to a view', views: null, rows: CHORDS.map((h) => ({
    combos: [c('g', h.key)], chord: true, desc: `Go to ${h.label}`, tags: `chord jump navigate ${h.label.toLowerCase()}`,
  })) },
  { id: 'picks', title: 'Picks and Compare', views: null, rows: [
    { combos: [c('s')], desc: 'Star the focused or open home (add it to your picks)', tags: 'save star favourite pick' },
    { combos: [c('x'), c('c')], desc: 'Add the focused or open home to Compare, or take it out', tags: 'compare toggle add remove' },
  ] },
  { id: 'map', title: 'Map and results', views: ['map'], rows: [
    { combos: [c('j'), c('k')], desc: 'Next or previous home in the list (opens it)', tags: 'next previous move list cards' },
    { combos: [c('Enter')], desc: 'Open the focused home card', tags: 'open details drawer' },
    { combos: [c('Esc')], desc: 'Close the home panel or the map card', tags: 'close drawer' },
    { combos: [c('←'), c('→')], desc: 'Previous or next photo while the photos are focused', tags: 'photos carousel gallery' },
  ] },
  { id: 'list', title: 'Shortlist table', views: ['list', 'tours'], rows: [
    { combos: [c('↑'), c('↓')], desc: 'Move between rows', tags: 'table rows navigate' },
    { combos: [c('Home'), c('End')], desc: 'First or last row', tags: 'table jump' },
    { combos: [c('Enter')], desc: 'Open the row’s home, or fold a building group', tags: 'open group' },
    { combos: [c('←'), c('→')], desc: 'Fold or unfold a building group', tags: 'group collapse expand' },
    { combos: [c('j'), c('k')], desc: 'Next or previous row (opens the home)', tags: 'next previous' },
  ] },
  { id: 'compare', title: 'Compare', views: ['compare'], rows: [
    { combos: [c('↑'), c('↓')], desc: 'Move through the homes in the add-a-home list', tags: 'picker add search' },
    { combos: [c('Enter')], desc: 'Add the highlighted home', tags: 'picker add' },
    { combos: [c('Esc')], desc: 'Clear the search, then close the list', tags: 'picker close' },
  ] },
  { id: 'unit', title: 'Unit 3D', views: ['unit'], rows: [
    { combos: [c('p')], desc: 'Play or pause the day', tags: 'sun time animation' },
    { combos: [c(','), c('.')], desc: 'Step the time back or forward 15 minutes', tags: 'sun time step' },
    { combos: [c('←'), c('↑'), c('→'), c('↓')], desc: 'Orbit or look around while the 3D view is focused (Shift for a bigger step)', tags: 'camera orbit look window' },
    { combos: [c('+'), c('−')], desc: 'Zoom in or out', tags: 'camera zoom' },
    { combos: [c('Home'), c('End')], desc: 'Jump to the start or end of the day on the time strip', tags: 'day strip time' },
    { combos: [c('Esc')], desc: 'Close the info card', tags: 'close' },
  ] },
  { id: 'plan', title: 'Floor plan', views: ['plan'], rows: [
    { combos: [c('R'), c('shift', 'R')], desc: 'Turn the selected piece 90° (Shift turns the other way)', tags: 'rotate furniture' },
    { combos: [c('←'), c('↑'), c('→'), c('↓')], desc: 'Nudge the selected piece 1 in (Shift: 6 in)', tags: 'move furniture' },
    { combos: [c('D')], desc: 'Duplicate the selected piece', tags: 'copy furniture' },
    { combos: [c('Del'), c('Backspace')], desc: 'Remove the selected piece', tags: 'delete furniture' },
    { combos: [c('mod', 'Z'), c('shift', 'mod', 'Z')], desc: 'Undo or redo a layout change (this view keeps its own history)', tags: 'undo redo layout' },
    { combos: [c('W'), c('A'), c('S'), c('D')], desc: 'Walk through the room in the eye-level camera (Shift to run, Q and E to look)', tags: 'walk eye camera' },
    { combos: [c('Esc')], desc: 'Deselect the piece, or leave walk mode', tags: 'close' },
  ] },
  { id: 'research', title: 'Research', views: ['research'], rows: [
    { combos: [c('←'), c('→')], desc: 'Previous or next research tab while the tabs are focused', tags: 'tabs queue new gone watch media records' },
    { combos: [c('Home'), c('End')], desc: 'First or last research tab', tags: 'tabs' },
  ] },
  { id: 'palette', title: 'Command menu', views: null, rows: [
    { combos: [c('↑'), c('↓')], desc: 'Move through the results', tags: 'palette search' },
    { combos: [c('Enter')], desc: 'Run the highlighted result, or apply a plain-language search', tags: 'palette apply' },
    { combos: [c('Esc')], desc: 'Close the command menu', tags: 'palette close' },
  ] },
  { id: 'menus', title: 'Menus and tours', views: null, rows: [
    { combos: [c('↑'), c('↓'), c('Home'), c('End')], desc: 'Move through the settings menu', tags: 'settings menu navigate' },
    { combos: [c('←'), c('→')], desc: 'Previous or next step of the guided tour', tags: 'coach tour steps' },
    { combos: [c('Enter')], desc: 'Next step of the guided tour', tags: 'coach tour' },
    { combos: [c('Esc')], desc: 'Skip the guided tour', tags: 'coach tour skip' },
  ] },
];

const SYN = { mod: 'cmd command ctrl control \u2318', shift: 'shift \u21e7', alt: 'alt option \u2325', Esc: 'esc escape', Del: 'delete del', Enter: 'enter return \u21b5' };

/** Searchable text of a row: description, tags and every key label on both platforms, with the names people type. */
function haystack(row, group) {
  const keys = row.combos.flatMap((cmb) => cmb.flatMap((k) => [keyLabel(k, true), keyLabel(k, false), k, SYN[k] || '']));
  return `${group.title} ${row.desc} ${row.tags || ''} ${keys.join(' ')} ${row.chord ? 'then chord' : ''} ${row.range || ''}`.toLowerCase();
}
/** A word of two or more letters matches anywhere in the row; a single character must be one of its keys. */
function hits(h, w) { return w.length > 1 ? h.includes(w) : h.split(/\s+/).includes(w); }

/**
 * The groups to show: rows that contain every word of `query` (empty query: everything), the group for `view` first
 * and groups that do not apply to the current view after the ones that do. Empty groups are dropped.
 */
export function filterShortcuts(query = '', view = null, groups = GROUPS) {
  const ws = String(query).toLowerCase().split(/\s+/).filter(Boolean);
  const out = groups
    .map((g) => ({ ...g, rows: g.rows.filter((r) => { const h = haystack(r, g); return ws.every((w) => hits(h, w)); }) }))
    .filter((g) => g.rows.length);
  const here = (g) => (g.views && view ? (g.views.includes(view) ? 0 : 2) : 1);
  return out.map((g, i) => ({ g, i, rank: here(g) })).sort((a, b) => a.rank - b.rank || a.i - b.i).map((x) => ({ ...x.g, current: x.rank === 0 }));
}
