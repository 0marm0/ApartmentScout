// Undo for picks, Compare, filters, ranking weights and the commute lens: one stack, a toast with an Undo button
// after every change, and Cmd/Ctrl+Z (Shift for redo) wired up in keys.js.
//
// It watches the shell's own events (saved, compare, filters, weights, commute), takes a snapshot of the small piece
// of state those cover and diffs it with the last one (undo-core.js), so no setter needed to change: whatever route a
// change took (a card star, the drawer, a shortcut, the palette, a slider), it is one undo step with a readable name.
import { S, on, emit, store, label, byId, setCommute, openDrawer, renderRail, rescore, FEATURES, MODE_LABEL, DIMS } from '../app.js';
import { syncTrigger } from '../palette.js';
import { toast } from '../util.js';
import { snapshot, describeChange, createHistory, slice } from './undo-core.js';

const history = createHistory();
let base = null;          // the snapshot the next change is compared with
let restoring = false;    // true while undo / redo writes state back, so that is not recorded as a change
let depth = 0;            // > 0 inside group(): record one entry for the whole block
const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

const names = {
  listing: (id) => { const L = byId(id); return L ? label(L) : id; },
  dim: (k) => (DIMS.find(([d]) => d === k) || [k, k])[1],
  feature: (k) => (FEATURES.find(([f]) => f === k) || [k, k])[1],
  mode: (k) => MODE_LABEL[k] || k,
};

export const canUndo = () => history.canUndo;
export const canRedo = () => history.canRedo;
export const peek = () => ({ undo: history.peekUndo()?.label || null, redo: history.peekRedo()?.label || null });

let timer = 0;
/** The toast for a recorded change. Rapid, mergeable edits (a slider drag) wait until the hand stops. */
function announce(entry, extra = '') {
  clearTimeout(timer);
  const show = () => {
    const tail = entry.scopes?.length === 1 && entry.scopes[0] === 'compare' ? ` · ${S.compare.length} of 4` : '';
    toast(entry.label + tail + extra, 5200, { label: 'Undo', hint: mac ? '⌘Z' : 'Ctrl Z', run: undo });
  };
  if (entry.key) timer = setTimeout(show, 450); else timer = setTimeout(show, 0);   // 0: after the caller's own toast, which this replaces
}

function capture() {
  if (restoring || depth || !base) return;
  const now = snapshot(S), d = describeChange(base, now, names);
  if (!d) { base = now; return; }
  const e = history.record(base, now, d);
  base = now;
  if (e) announce(e);
}

/** Run `fn`; every change it makes becomes a single undo step called `label`. */
export function group(label, fn, { quietToast = false } = {}) {
  if (!base) { fn(); return false; }
  const before = snapshot(S);
  depth++;
  try { fn(); } finally { depth--; }
  if (depth) return true;
  const after = snapshot(S), d = describeChange(before, after, names);
  base = after;
  if (!d) return false;
  const e = history.record(before, after, { ...d, label, key: null });
  if (e && !quietToast) announce(e);
  return true;
}

/** Say something about the change just made, with the Undo button (the group's own toast is skipped with quietToast). */
export function announceLast(text) {
  clearTimeout(timer);
  timer = setTimeout(() => toast(text, 5200, { label: 'Undo', hint: mac ? '\u2318Z' : 'Ctrl Z', run: undo }), 0);
}

const replace = (target, next) => { for (const k of Object.keys(target)) delete target[k]; Object.assign(target, next); };

function restore(snap, scopes) {
  restoring = true;
  try {
    const part = slice(snap, scopes);
    if (part.picks) { replace(S.picks, part.picks); store.set('picks', S.picks); }
    if (part.compare) { S.compare.splice(0, S.compare.length, ...part.compare); store.set('compare', S.compare); }
    if (part.filters) {
      replace(S.filters, part.filters); store.set('filters2', S.filters);
      const q = document.getElementById('q'); if (q) q.value = S.filters.q || '';
      syncTrigger();
    }
    if (part.weights) { S.weights = part.weights; S.preset = part.preset; store.set('weights', S.weights); store.set('preset', S.preset); rescore(); }
    if (part.commute) setCommute({ mode: part.commute.mode || undefined, dest: part.commute.dest || undefined });
    if (part.picks) emit('saved');
    if (part.compare) emit('compare');
    if (part.filters) emit('filters');
    if (part.weights) { renderRail(); emit('weights'); emit('weights-settled'); }
    if (S.sel) openDrawer(S.sel);
  } finally { restoring = false; base = snapshot(S); }
}

function move(entry, snap, verb) {
  restore(snap, entry.scopes);
  clearTimeout(timer);
  const other = verb === 'Undid' ? 'Redo' : 'Undo';
  toast(`${verb}: ${entry.label}`, 4200, { label: other, hint: verb === 'Undid' ? (mac ? '⇧⌘Z' : 'Ctrl Shift Z') : (mac ? '⌘Z' : 'Ctrl Z'), run: verb === 'Undid' ? redo : undo });
}

export function undo() {
  const e = history.undo();
  if (!e) { toast('Nothing to undo'); return false; }
  move(e, e.before, 'Undid');
  return true;
}
export function redo() {
  const e = history.redo();
  if (!e) { toast('Nothing to redo'); return false; }
  move(e, e.after, 'Redid');
  return true;
}

/** Run `fn` (a change that came from somewhere else, such as another device through sync) without making it an undo step. */
export function quiet(fn) {
  const was = restoring; restoring = true;
  try { fn(); } finally { restoring = was; base = snapshot(S); }
}

export function initUndo() {
  base = snapshot(S);
  for (const ev of ['saved', 'compare', 'filters', 'weights', 'commute']) on(ev, capture);
  // read-only hook for headless checks (Playwright): never used by the page itself
  window.__undo = { get size() { return history.size; }, get canUndo() { return history.canUndo; }, get canRedo() { return history.canRedo; }, peek, undo, redo };
}
