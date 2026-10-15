// Undo / redo engine, pure (no DOM, no app imports) so node can test it.
//
// The dashboard keeps a handful of small pieces of renter state in localStorage: picks (star, tier, note, tour
// time), the compare list, the filters, the ranking weights and the commute lens. Instead of teaching every setter
// to push its own inverse, the shell takes a snapshot of those slices after each change and diffs it with the
// previous one. This module owns: the snapshot shape, the diff (with a human label for the toast), and the history
// (one stack, merge of rapid edits such as a slider drag, redo that clears on a new change).

import { describeNlPlus } from './nlplus.js';   // [places] [multi-destination]

/** The slices a snapshot covers, in the order they are reported. */
export const SCOPES = ['picks', 'compare', 'filters', 'weights', 'commute'];

export const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

export function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (!Object.prototype.hasOwnProperty.call(b, k) || !deepEqual(a[k], b[k])) return false;
  return true;
}

/** Copy the undoable slice of the app state. `state` is the shared S object (or a stand-in with the same fields). */
export function snapshot(state) {
  return clone({
    picks: state.picks || {}, compare: state.compare || [], filters: state.filters || {},
    weights: state.weights || {}, preset: state.preset ?? null,
    commute: { mode: state.commuteMode ?? null, dest: state.destName ?? null },
  });
}

const PICK_NOISE = new Set(['updated']);   // setPick stamps today's date on every change: not a renter edit
const strip = (p) => Object.fromEntries(Object.entries(p || {}).filter(([k]) => !PICK_NOISE.has(k)));

const q = (s) => `“${String(s).slice(0, 40)}”`;
const ident = (x) => String(x);
const DEFAULT_NAMES = { listing: ident, dim: ident, feature: ident, mode: ident };

function picksChange(a, b, nm) {
  const ids = [...new Set([...Object.keys(a || {}), ...Object.keys(b || {})])];
  const changed = ids.filter((id) => !deepEqual(strip(a?.[id]), strip(b?.[id])));
  if (!changed.length) return null;
  if (changed.length > 1) return { label: `Updated ${changed.length} picks`, key: null };
  const id = changed[0], pa = strip(a?.[id]), pb = strip(b?.[id]), n = nm.listing(id);
  if (pa.tier !== pb.tier) return { label: pb.tier ? `Set ${n} to tier ${pb.tier}` : `Cleared the tier on ${n}`, key: `picks:tier:${id}` };
  if (!deepEqual(pa.tour, pb.tour)) return { label: pb.tour ? `Set a tour time for ${n}` : `Cleared the tour time for ${n}`, key: `picks:tour:${id}` };
  if ((pa.note || '') !== (pb.note || '')) return { label: `Edited the note on ${n}`, key: `picks:note:${id}` };
  if (!!pa.saved !== !!pb.saved) return { label: pb.saved ? `Starred ${n}` : `Removed ${n} from your picks`, key: `picks:saved:${id}` };
  return { label: `Updated ${n}`, key: `picks:other:${id}` };
}

function compareChange(a, b, nm) {
  const A = a || [], B = b || [];
  const added = B.filter((x) => !A.includes(x)), removed = A.filter((x) => !B.includes(x));
  if (!added.length && !removed.length) return deepEqual(A, B) ? null : { label: 'Reordered Compare', key: null };
  if (added.length === 1 && !removed.length) return { label: `Added ${nm.listing(added[0])} to Compare`, key: null };
  if (removed.length === 1 && !added.length) return { label: `Removed ${nm.listing(removed[0])} from Compare`, key: null };
  if (added.length === 1 && removed.length === 1) return { label: `Added ${nm.listing(added[0])} to Compare, dropped ${nm.listing(removed[0])}`, key: null };
  return { label: B.length ? 'Changed Compare' : 'Cleared Compare', key: null };
}

function filtersChange(a, b, nm) {
  const A = a || {}, B = b || {};
  const keys = [...new Set([...Object.keys(A), ...Object.keys(B)])].filter((k) => !deepEqual(A[k], B[k]));
  if (!keys.length) return null;
  if (keys.length > 1) return { label: `Changed ${keys.length} filters`, key: null };
  const k = keys[0];
  if (k === 'maxCommute') return { label: B.maxCommute >= 75 ? 'Any commute time' : `Commute up to ${B.maxCommute} min`, key: 'filters:maxCommute' };
  if (k === 'toggles') {
    const on = (B.toggles || []).filter((x) => !(A.toggles || []).includes(x)), off = (A.toggles || []).filter((x) => !(B.toggles || []).includes(x));
    if (on.length === 1 && !off.length) return { label: `Must-have on: ${nm.feature(on[0])}`, key: null };
    if (off.length === 1 && !on.length) return { label: `Must-have off: ${nm.feature(off[0])}`, key: null };
    return { label: 'Changed the feature filters', key: null };
  }
  if (k === 'savedOnly') return { label: B.savedOnly ? 'Showing saved picks only' : 'Showing all homes again', key: null };
  if (k === 'q') return { label: B.q ? `Text filter ${q(B.q)}` : 'Cleared the text filter', key: 'filters:q' };
  if (k === 'tiers' || k === 'over') return { label: 'Changed the budget filter', key: null };
  if (k === 'status') return { label: 'Changed the status filter', key: null };
  if (k === 'nl') { const pl = describeNlPlus(A.nl, B.nl); if (pl) return pl; }   // [places] [multi-destination] one place clause or destination limit
  if (k === 'nl') return { label: B.nl ? 'Applied a plain-language search' : 'Cleared the plain-language search', key: null };
  return { label: 'Changed a filter', key: `filters:${k}` };
}

function weightsChange(a, b, preset, nm) {
  const A = a || {}, B = b || {};
  const keys = [...new Set([...Object.keys(A), ...Object.keys(B)])].filter((k) => (A[k] || 0) !== (B[k] || 0));
  if (!keys.length) return preset.a !== preset.b ? { label: 'Changed the weight preset', key: null } : null;
  if (keys.length === 1) return { label: `Weight: ${nm.dim(keys[0])}`, key: `weights:${keys[0]}` };
  return { label: preset.a !== preset.b && preset.b ? 'Changed the weight preset' : 'Changed the ranking weights', key: null };
}

function commuteChange(a, b, nm) {
  const A = a || {}, B = b || {};
  if (deepEqual(A, B)) return null;
  const mode = nm.mode(B.mode || 'best');
  return { label: B.dest ? `Commute: ${String(mode).toLowerCase()} to ${B.dest}` : `Commute: ${String(mode).toLowerCase()}`, key: A.dest === B.dest ? 'commute:mode' : null };
}

/**
 * What changed between two snapshots: `{ scopes, label, key }` or null when nothing the renter did differs.
 * `names` turns ids into words: { listing(id), dim(key), feature(key), mode(key) }.
 */
export function describeChange(a, b, names = {}) {
  const nm = { ...DEFAULT_NAMES, ...names };
  const found = [
    ['picks', picksChange(a.picks, b.picks, nm)],
    ['compare', compareChange(a.compare, b.compare, nm)],
    ['filters', filtersChange(a.filters, b.filters, nm)],
    ['weights', weightsChange(a.weights, b.weights, { a: a.preset ?? null, b: b.preset ?? null }, nm)],
    ['commute', commuteChange(a.commute, b.commute, nm)],
  ].filter(([, c]) => c);
  if (!found.length) return null;
  const scopes = found.map(([s]) => s);
  const first = found[0][1];
  return found.length === 1 ? { scopes, label: first.label, key: first.key } : { scopes, label: `${first.label} and ${found.length - 1} more change${found.length > 2 ? 's' : ''}`, key: null };
}

/** Put the named scopes of `snap` back into a state-like object's plain-data form (returns fresh copies). */
export function slice(snap, scopes) {
  const out = {};
  for (const s of scopes) {
    if (s === 'weights') { out.weights = clone(snap.weights); out.preset = snap.preset ?? null; }
    else out[s] = clone(snap[s]);
  }
  return out;
}

/**
 * One undo stack. `record(before, after, meta)` adds an entry; an entry with the same non-null `key` as the top
 * one within `mergeMs` is folded into it (dragging a slider is one undo step, not sixty), and folding that lands
 * back on the starting state removes the entry. Recording after an undo drops the redo list.
 */
export function createHistory({ limit = 100, mergeMs = 900, now = () => Date.now() } = {}) {
  const undos = [], redos = [];
  return {
    record(before, after, { label = 'Change', key = null, scopes = [] } = {}) {
      if (deepEqual(before, after)) return null;
      const t = now(), top = undos[undos.length - 1];
      redos.length = 0;
      if (key && top && top.key === key && t - top.t <= mergeMs) {
        top.after = after; top.t = t; top.label = label;
        if (deepEqual(top.before, top.after)) { undos.pop(); return null; }
        return top;
      }
      const e = { label, key, scopes, before, after, t };
      undos.push(e);
      if (undos.length > limit) undos.shift();
      return e;
    },
    undo() { const e = undos.pop(); if (e) redos.push(e); return e || null; },
    redo() { const e = redos.pop(); if (e) undos.push(e); return e || null; },
    peekUndo: () => undos[undos.length - 1] || null,
    peekRedo: () => redos[redos.length - 1] || null,
    get canUndo() { return undos.length > 0; },
    get canRedo() { return redos.length > 0; },
    get size() { return undos.length; },
    clear() { undos.length = 0; redos.length = 0; },
  };
}
