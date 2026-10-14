// Keyboard additions, installed once from extras.js as a capture-phase listener on window so it sees a key before the
// shell's own handler (setupKeys in app.js) and the views' handlers. It only takes a key over when it has something to
// do with it; everything else (j k s c t 1-6 Esc, the view-specific keys) keeps working exactly as before.
//
//   Cmd/Ctrl+Z, Shift+Cmd/Ctrl+Z (Ctrl+Y)   undo and redo (not in the Floor plan, which keeps its own history)
//   ?                                       the searchable cheat sheet (replaces the old fixed list)
//   g then m / s / c / u / p / r / t        go to a view, with a hint chip while the g is waiting
//   x                                       toggle Compare on the focused or open home
//   s on a focused card                     star that card (the shell's s handles the open home)
import { S, toggleSave, toggleCompare, openDrawer } from '../app.js';
import { toast } from '../util.js';
import { stepChord, idleChord, CHORDS } from './chords.js';
import { undo, redo } from './undo.js';
import { openCheatSheet, closeCheatSheet, cheatOpen } from './cheatsheet.js';

let chord = idleChord();
let hint = null, hintTimer = 0;

/** A text field owns the keys (the readonly search trigger in the top bar does not). */
const typingIn = (el) => !!el && ((['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) && !el.readOnly) || el.isContentEditable);
/** A dialog or the guided tour has the keyboard: shell shortcuts wait. */
const modalOpen = () => !!document.querySelector('.pl-scrim:not([hidden]), .wz-scrim, .sheet-scrim.on, [data-coach]') || cheatOpen();

function showHint() {
  if (!hint) {
    hint = document.createElement('div');
    hint.className = 'chord-hint'; hint.setAttribute('role', 'status'); hint.setAttribute('aria-live', 'polite');
    document.body.append(hint);
  }
  hint.innerHTML = `<span class="ch-k"><kbd>g</kbd><i>then</i></span>${CHORDS.map((c) => `<span class="ch-o"><kbd>${c.key}</kbd>${c.label}</span>`).join('')}`;
  hint.classList.add('on');
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => { hideHint(); chord = idleChord(); }, 1700);
}
function hideHint() { clearTimeout(hintTimer); hint?.classList.remove('on'); }

/** The home a key applies to: the card or table row with focus, else the one open in the panel. */
function targetHome() {
  const a = document.activeElement;
  const card = a?.closest?.('#cards .card[data-id]');
  if (card) return { id: card.dataset.id, focus: 'card' };
  const row = a?.closest?.('tr.r[data-id]');
  if (row) return { id: row.dataset.id, focus: 'row' };
  return S.sel ? { id: S.sel, focus: null } : null;
}

function go(h) {
  let hash = h.hash || h.view;
  // keep looking at the same home when the next view can show it
  const id = targetHome()?.id;
  const list = { unit: 'sites', plan: 'plans' }[h.view];
  if (id && list && (S.manifest[list] || []).includes(id)) hash += '/' + encodeURIComponent(id);
  if (location.hash.replace(/^#/, '') !== hash) location.hash = hash;
}

function onKey(e) {
  if (e.isComposing) return;
  if (e.defaultPrevented && e.key !== 'Escape') { chord = idleChord(); hideHint(); return; }   // another handler used this key: it cannot be the second half of a chord
  const typing = typingIn(e.target), cmd = (e.metaKey || e.ctrlKey) && !e.altKey;
  const stop = () => { e.preventDefault(); e.stopImmediatePropagation(); };

  // undo and redo
  if (cmd) {
    const k = e.key.toLowerCase();
    if ((k === 'z' || (k === 'y' && e.ctrlKey && !e.metaKey)) && !typing && !modalOpen() && S.view !== 'plan') {
      stop(); (k === 'y' || e.shiftKey ? redo : undo)();
    }
    chord = idleChord(); hideHint();
    return;
  }

  // the cheat sheet
  if (e.key === '?' && !typing && !e.altKey && e.target !== window) {   // a key dispatched on window itself (menu, palette) comes through as:cheatsheet
    stop(); toggleCheat();
    return;
  }

  // g then a letter
  const r = stepChord(chord, { key: e.key, mod: e.altKey, typing: typing || modalOpen() || e.repeat }, Date.now());
  chord = r.state;
  if (r.hint) showHint(); else hideHint();
  if (r.consume) stop();
  if (r.go) { go(r.go); return; }
  if (r.consume || e.altKey || typing || modalOpen()) return;

  // x and s on the home that has focus
  if (e.key === 'x' && S.view !== 'plan') {
    const t = targetHome();
    if (!t) { if (['map', 'list'].includes(S.view)) { stop(); toast('Open or focus a home first (click one, or press j), then x adds it to Compare'); } return; }
    stop();
    toggleCompare(t.id);
    if (S.sel === t.id) openDrawer(t.id);
    return;
  }
  if (e.key === 's' && S.view === 'map') {
    const a = document.activeElement?.closest?.('#cards .card[data-id]');
    if (a && a.dataset.id !== S.sel) {
      stop();
      const id = a.dataset.id;
      toggleSave(id);
      document.querySelector(`#cards .card[data-id="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });   // the list redraws on a save
    }
  }
}

function toggleCheat() {
  if (document.querySelector('.pl-scrim:not([hidden]), .wz-scrim, .sheet-scrim.on, [data-coach]')) return;
  hideHint(); chord = idleChord();
  if (cheatOpen()) closeCheatSheet(); else openCheatSheet();
}

export function initKeys() {
  addEventListener('keydown', onKey, true);
  addEventListener('as:cheatsheet', (e) => { e.preventDefault(); toggleCheat(); });   // the menu and the palette ask for it this way
  // a click, a scroll or a blur ends a pending chord
  addEventListener('pointerdown', () => { chord = idleChord(); hideHint(); }, true);
  addEventListener('blur', () => { chord = idleChord(); hideHint(); });
}
