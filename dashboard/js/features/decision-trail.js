// Decision history, in the browser: after every change to the renter's picks it works out what was decided (a star, a tier, a
// status, a note, a tour time) and appends a revision with a timestamp; promoted findings are added by tour-findings.js. A
// small prompt offers to attach a reason to the decisions that deserve one, and every revision can be given one later in the
// drawer. The pure rules (diffing, folding rapid note edits, caps, the words) are in decisions-model.js.
import { S, on, store, byId, label } from '../app.js';
import { $, esc } from '../util.js';
import { diffPicks, record as addEntries, withReason, forHome as homeEntries, clean, merge, describe, STATUS_CHOICES, MAX_ENTRIES } from './decisions-model.js';

let entries = [], prev = {}, key = '', quiet = false, ask = null;
const listeners = new Set();
const clone = (v) => JSON.parse(JSON.stringify(v ?? {}));
const searchKey = () => `trail:${S.crit0?.search?.name || S.base}`;
export const onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const notify = () => listeners.forEach((fn) => { try { fn(); } catch (e) { console.warn('trail listener failed', e); } });
const persist = () => store.set(key, entries);
export const all = () => entries;
export const forHome = (home) => homeEntries(entries, home);
export const exportEntries = () => entries;

/** Record decisions made elsewhere (a promoted finding). Returns the new entry. */
export function record(change, now = new Date().toISOString().replace(/\.\d+Z$/, 'Z')) {
  entries = addEntries(entries, [change], now);
  persist(); notify();
  return entries.findLast((x) => x.home === change.home && x.kind === change.kind) || null;
}
export function setReason(e, why) { entries = withReason(entries, e, why); persist(); notify(); }
/** Entries from a picks backup, merged into this browser's trail. The next picks change is the import itself, not a decision. */
export function importEntries(list) {
  quiet = true; setTimeout(() => { quiet = false; }, 0);
  const before = entries.length;
  entries = merge(entries, list);
  persist(); notify();
  return entries.length - before;
}

/** The sync layer wrote the trail and the picks to storage (sync/sync-store.js): read the trail again and take the picks as the new baseline, so what
 *  arrived from another device is not recorded here as a decision made on this one. Call after S.picks has been replaced. */
export function reload() {
  if (!key) return;
  quiet = true; setTimeout(() => { quiet = false; }, 0);
  entries = clean(store.get(key, []));
  prev = clone(S.picks);
  notify();
}

// ------------------------------------------------------------------ watching the picks
const WORTH_ASKING = new Set(['tier', 'status', 'promote']);
function onSaved(id) {
  const next = S.picks;
  if (quiet) { prev = clone(next); return; }
  const changes = diffPicks(prev, next);
  prev = clone(next);
  if (!changes.length) return;
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const before = new Set(entries.map((x) => x.e));
  entries = addEntries(entries, changes, now);
  persist(); notify();
  // a reason is offered for a single deliberate action, not for an undo or an import that changes many things at once
  if (id && changes.every((c) => c.home === id)) {
    const main = changes.find((c) => WORTH_ASKING.has(c.kind)) || changes.find((c) => c.kind === 'star' && c.to === false);
    const e = main && entries.findLast((x) => !before.has(x.e) && x.home === main.home && x.kind === main.kind);
    if (e) offer(e);
  }
}

// ------------------------------------------------------------------ the reason prompt
function closeAsk() { clearTimeout(ask?.t); ask?.el.remove(); ask = null; }
function offer(e) {
  closeAsk();
  const L = byId(e.home), el = document.createElement('div');
  el.className = 'trail-ask'; el.setAttribute('role', 'group'); el.setAttribute('aria-label', 'Add a reason for this decision');
  el.innerHTML = `<p aria-live="polite"><b>${esc(describe(e))}</b><span>${L ? esc(label(L)) : ''}</span></p>
    <label class="tk-f"><span class="sr">Reason</span><input type="text" maxlength="400" placeholder="Why? (optional)" autocomplete="off" enterkeyhint="done"></label>
    <div class="tk-b"><button type="button" class="btn sm primary" data-save>Save reason</button><button type="button" class="btn sm ghost" data-skip>Skip</button></div>`;
  document.body.append(el);
  const input = el.querySelector('input');
  const done = (save) => { if (save && input.value.trim()) setReason(e.e, input.value); closeAsk(); };
  el.querySelector('[data-save]').addEventListener('click', () => done(true));
  el.querySelector('[data-skip]').addEventListener('click', () => done(false));
  el.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); done(true); } else if (ev.key === 'Escape') { ev.stopPropagation(); done(false); } });
  // typing or tapping in it holds it open; left alone it goes away
  const hold = () => { clearTimeout(ask.t); ask.t = setTimeout(() => closeAsk(), 14000); };
  ask = { el, t: 0 };
  hold();
  input.addEventListener('focus', () => clearTimeout(ask?.t)); input.addEventListener('blur', hold);
  requestAnimationFrame(() => el.classList.add('on'));
}

// ------------------------------------------------------------------ markup for the drawer
const fmtAt = (s) => { const d = new Date(s); return isNaN(d) ? '' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };
const ICON = { star: '★', tier: 'T', status: '●', note: '✎', tour: '◷', promote: '✓', unpromote: '↺' };
function itemHTML(x) {
  return `<li class="tr-it k-${x.kind}" data-e="${esc(x.e)}"><i aria-hidden="true">${ICON[x.kind] || '·'}</i>
    <div><p>${esc(describe(x))}</p><small><time datetime="${esc(x.at)}">${esc(fmtAt(x.at))}</time></small>
      ${x.why ? `<blockquote>${esc(x.why)}</blockquote>` : `<button type="button" class="lnk" data-why="${esc(x.e)}">Add a reason</button>`}</div></li>`;
}
/** The trail of one home, newest first; the first few in view, the rest folded. */
export function trailHTML(home) {
  const list = forHome(home);
  if (!list.length) return '<p class="faint tr-none">Nothing decided yet. Stars, tiers, status changes, notes and promoted findings are recorded here, with the time and your reason.</p>';
  const head = list.slice(0, 5), rest = list.slice(5);
  return `<ol class="trail">${head.map(itemHTML).join('')}</ol>${rest.length ? `<details class="tr-more"><summary>${rest.length} earlier</summary><ol class="trail">${rest.map(itemHTML).join('')}</ol></details>` : ''}`;
}
export const statusOptions = (cur) => `<option value="">Not set</option>${STATUS_CHOICES.map(([v, n]) => `<option value="${v}" ${cur === v ? 'selected' : ''}>${n}</option>`).join('')}`;

/** Click handling for the trail's "Add a reason" buttons, wired by the drawer section. */
export function askFor(btn) {
  const li = btn.closest('li'), e = btn.dataset.why;
  const f = document.createElement('form'); f.className = 'tr-why';
  f.innerHTML = '<label><span class="sr">Reason</span><input type="text" maxlength="400" placeholder="Why?" autocomplete="off"></label><button type="submit" class="btn sm primary">Save</button>';
  btn.replaceWith(f);
  const input = f.querySelector('input'); input.focus();
  f.addEventListener('submit', (ev) => { ev.preventDefault(); input.blur(); if (input.value.trim()) setReason(e, input.value); else notify(); });
  input.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { ev.stopPropagation(); input.blur(); notify(); } });
  return li;
}

export function init() {
  key = searchKey();
  entries = clean(store.get(key, []));
  prev = clone(S.picks);
  on('saved', onSaved);
  window.__trail = { get entries() { return entries; } };   // read-only, for headless checks

}
export { MAX_ENTRIES };
