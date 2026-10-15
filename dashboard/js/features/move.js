// The move planner: for a chosen home, a dated timeline from today to the lease start (application, approval, lease signing, deposit,
// insurance, movers, utilities and internet, the USPS change of address, the building's move-in reservation and the movers' certificate
// of insurance, key pickup), what the move costs in cash, and a checklist that is kept like the renter's other data. Dates come from the
// criteria's move-in window and the home's availability (move-model.js, pure); this file joins them to the page: a drawer section, a
// side sheet, the saved plan, and the exports (an .ics calendar file and a list for Reminders). Nothing is booked, sent or paid here.
//
// Saved plan: this browser's local storage under `moveplan:<search name>` and the top-level `moveplan` object of a picks backup.
import { S, on, store, byId, download, hooks, openDrawer, isSaved, pick, label as homeLabel } from '../app.js';
import { $, esc, toast } from '../util.js';
import { addDrawerTop } from './drawer-slots.js';
import * as M from './move-model.js';

const X = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>';
export const ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><path d="M1.8 5.2L8 1.8l6.2 3.4V14H1.8zM6 14V9.4h4V14"/></svg>';
const CAL = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="2" y="3" width="12" height="11" rx="1.8"/><path d="M2 6.6h12M5.4 1.6v2.8M10.6 1.6v2.8"/></svg>';
const LIST = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M5.5 4h8M5.5 8h8M5.5 12h8M2.3 4h.1M2.3 8h.1M2.3 12h.1"/></svg>';
const CHECK = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.4 8.4l3 3 6.2-6.6"/></svg>';
const ACTIVE = new Set(['shortlist', 'touring', 'applied']);

let plan = M.normalize(null), started = false, root = null, st = null, inerted = [];
const keyName = () => `${M.KEY}:${S.crit0?.search?.name || S.base}`;
const pad = (n) => String(n).padStart(2, '0');
const localISO = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** Today as an ISO day. `?today=YYYY-MM-DD` pins it (demos and tests), like the other planners' clocks. */
export function today() { const q = new URLSearchParams(location.search).get('today'); return q && /^\d{4}-\d{2}-\d{2}$/.test(q) && M.dayOf(q) != null ? q : localISO(); }
export const savedPlan = () => plan;

// ------------------------------------------------------------------ the saved plan
function load() { plan = M.normalize(store.get(keyName(), null)); }
function save(next) { plan = next; store.set(keyName(), plan); }
const change = (id, patch) => save(M.patchHome(plan, id, patch, today()));
/** The plan for `id` as the sheet shows it right now. */
export const planOf = (id) => { const L = byId(id); return L ? M.planFor({ listing: L, criteria: S.crit, today: today(), plan }) : null; };

// ------------------------------------------------------------------ which homes
function candidates() {
  const seen = new Set(), out = [];
  const add = (L) => { if (L && !seen.has(L.id)) { seen.add(L.id); out.push(L); } };
  if (plan.chosen) add(byId(plan.chosen));
  for (const L of S.listings.filter((x) => x.status === 'applied')) add(L);
  for (const L of S.listings.filter((x) => isSaved(x.id) && pick(x.id).tier !== 'Pass').sort((a, b) => (a.score?.rank ?? 1e9) - (b.score?.rank ?? 1e9))) add(L);
  for (const L of S.listings.filter((x) => ACTIVE.has(x.status)).sort((a, b) => (a.score?.rank ?? 1e9) - (b.score?.rank ?? 1e9))) add(L);
  return out.slice(0, 40);
}
const offersPlan = (L) => !!L && (ACTIVE.has(L.status) || isSaved(L.id) || !!plan.homes[L.id]);

// ------------------------------------------------------------------ drawer section
const when = (n) => (n === 0 ? 'today' : n === 1 ? 'tomorrow' : n === -1 ? 'yesterday' : n > 0 ? `in ${n} days` : `${-n} days ago`);
function drawerHTML(L) {
  if (!offersPlan(L)) return '';
  const p = planOf(L.id); if (!p) return '';
  const tl = p.timeline, mine = !!plan.homes[L.id] && (Object.keys(plan.homes[L.id].done || {}).length || plan.homes[L.id].start || plan.homes[L.id].current_end);
  const next = tl.next;
  return `<div class="d-sec" id="dMove"><h3>Move plan <span>${tl.done} of ${tl.total} done</span></h3>
    <p class="mv-lead">Lease starts <b>${esc(M.label(tl.start))}</b>, ${esc(when(tl.days_out))}${p.lease.basis === 'chosen' ? '' : ' (worked out from your move-in window and the listing)'}.${next ? ` Next: ${esc(next.title.toLowerCase())}, ${esc(M.label(next.date))}.` : ''}</p>
    <button type="button" class="btn ${mine ? '' : 'primary '}mv-open" data-move-open="${esc(L.id)}">${ICON}${mine ? 'Open the move plan' : 'Plan the move'}</button></div>`;
}

// ------------------------------------------------------------------ the sheet
const usd = (x) => (x == null ? null : '$' + Math.round(x).toLocaleString('en-US'));
const when2 = (s) => (s.status === 'done' ? `done ${M.label(s.done)}` : when(s.days_out));

function stepHTML(s, homeId) {
  const open = st.open.has(s.id);
  const badges = [s.squeezed ? '<span class="pill warn" title="There is less time than usual before the start date">Squeezed in</span>' : '', s.moved ? '<span class="pill">Your date</span>' : '',
    s.status === 'overdue' ? '<span class="pill bad">Overdue</span>' : s.status === 'today' ? '<span class="pill accent">Today</span>' : ''].join('');
  const costNote = s.cost === 'signing' ? 'Due at signing: see the cash summary.' : s.cost === 'movers' ? 'Your estimate goes in the cash summary.' : s.cost === 'insurance' ? 'Your quote goes in the cash summary.' : '';
  return `<li class="mv-step ${s.status}${open ? ' open' : ''}" data-step="${esc(s.id)}"><button type="button" class="mv-chk" role="checkbox" aria-checked="${s.done ? 'true' : 'false'}" data-act="done" aria-label="${esc(s.title)}: mark ${s.done ? 'not done' : 'done'}">${s.done ? CHECK : ''}</button>
    <div class="mv-d"><b>${esc(M.label(s.date))}</b><small>${esc(when2(s))}</small></div>
    <div class="mv-m"><button type="button" class="mv-t" data-act="toggle" aria-expanded="${open}"><span>${esc(s.title)}</span>${badges}</button>
      ${open ? `<div class="mv-more">${s.detail ? `<p>${esc(s.detail)}</p>` : ''}${costNote ? `<p class="faint">${esc(costNote)}</p>` : ''}
        <div class="mv-row"><label>Date <input type="date" value="${esc(s.date)}" data-act="date" aria-label="Date for ${esc(s.title)}"></label>
          ${s.moved ? '<button type="button" class="btn sm ghost" data-act="reset">Back to the suggested day</button>' : ''}${s.custom ? '<button type="button" class="btn sm ghost" data-act="remove">Remove</button>' : ''}</div></div>` : ''}</div></li>`;
}

function costsHTML(p) {
  const c = p.costs, L = byId(st.id);
  const renterIds = ['movers', 'insurance', 'other'];
  const row = (l) => {
    const input = renterIds.includes(l.id);
    const val = input ? `<span class="mv-amt"><span aria-hidden="true">$</span><input type="number" inputmode="decimal" min="0" step="10" data-cost="${l.id}" value="${l.amount ?? ''}" placeholder="${l.id === 'movers' ? 'estimate' : 'optional'}" aria-label="${esc(l.label)} in dollars"></span>`
      : `<b class="${l.amount == null ? 'unk' : ''}">${l.amount == null ? 'Not known' : esc(usd(l.amount))}</b>`;
    return `<tr><td><span>${esc(l.label)}</span>${l.refundable ? '<small>refundable</small>' : ''}${l.note && (l.amount == null || l.id === 'overlap' || l.id === 'first_month') ? `<small>${esc(l.note)}</small>` : ''}</td><td>${val}</td></tr>`;
  };
  const sign = c.lines.filter((l) => ['first_month', 'deposit', 'other_refundable', 'application_fee', 'broker_fee', 'one_time_fees'].includes(l.id));
  const rest = c.lines.filter((l) => !sign.includes(l));
  const unknownNote = c.unknown.length ? `<p class="mv-warn">Not counted yet: ${esc(c.unknown.join(', ').toLowerCase())}. The totals are a floor until they are known.</p>` : '';
  return `<div class="mv-sub">Due at signing</div><table class="mv-tbl"><tbody>${sign.map(row).join('')}</tbody>
      <tfoot><tr><td>Due at signing${c.signing_unknown.length ? ' <small>and counting</small>' : ''}</td><td><b>${esc(usd(c.due_at_signing) || '$0')}</b></td></tr></tfoot></table>
    <div class="mv-sub">Around the move</div><table class="mv-tbl"><tbody>${rest.map(row).join('')}</tbody>
      <tfoot><tr class="grand"><td>Everything above</td><td><b>${esc(usd(c.total) || '$0')}</b></td></tr></tfoot></table>
    ${unknownNote}
    <p class="mv-hint">${c.paid_month != null ? `Monthly after that: ${esc(usd(c.paid_month))} (rent and required fees).` : 'The monthly rent is not known yet.'} ${L?.score?.cost?.concession?.free_months ? 'Free months are usually credited against later rent, not the first payment. Confirm when.' : ''}</p>`;
}

function shell(L) {
  const list = candidates();
  return `<div class="mv-scrim" data-close></div><section class="mv-panel"><header class="mv-h"><div><div class="mv-k">Move planner</div><h2 id="mvT" tabindex="-1">${esc(homeLabel(L))}</h2>
      <p class="mv-sub-h" id="mvSub"></p></div><button type="button" class="mv-x" data-close aria-label="Close">${X}</button></header>
    <div class="mv-body" id="mvBody"></div>
    <footer class="mv-bar"><button type="button" class="btn primary" data-act="ics">${CAL}Add to calendar (.ics)</button><button type="button" class="btn" data-act="reminders">${LIST}Copy for Reminders</button><button type="button" class="btn ghost" data-act="checklist">Copy checklist</button></footer></section>`;
}

function bodyHTML(p) {
  const L = byId(st.id), tl = p.timeline, ls = p.lease, state = p.state, list = candidates();
  const opts = list.map((x) => `<option value="${esc(x.id)}" ${x.id === st.id ? 'selected' : ''}>${esc(homeLabel(x))}</option>`).join('');
  const notes = ls.notes.map((n) => `<li>${esc(n)}</li>`).join('');
  const win = S.crit.search?.move_in || {};
  const groups = tl.steps.map((s) => stepHTML(s, L.id)).join('');
  const pct = tl.total ? Math.round((tl.done / tl.total) * 100) : 0;
  return `<section class="mv-sec"><label class="mv-lab" for="mvHome">Home</label><select class="sel mv-home" id="mvHome" data-act="home" aria-label="Home to plan the move for">${opts}</select>
      <div class="mv-grid"><label>Lease starts <input type="date" id="mvStart" value="${esc(tl.start)}" data-field="start"></label>
        <label>Current lease or stay ends <input type="date" id="mvEnd" value="${esc(state.current_end || '')}" data-field="current_end"></label>
        ${state.current_end ? `<label>Notice your lease asks for (days) <input type="number" min="0" max="365" step="1" id="mvNotice" value="${state.notice_days ?? M.NOTICE_DAYS}" data-field="notice_days"></label>` : ''}</div>
      <p class="mv-basis">${state.start ? `You chose this date. <button type="button" class="mv-link" data-act="unstart">Use the suggested one</button>` : ls.basis === 'available' ? 'Taken from when the home is available.' : ls.basis === 'window' ? `Taken from your move-in window${win.earliest ? ` (opens ${esc(M.label(String(win.earliest).slice(0, 10)))})` : ''}.` : 'Worked out from today: a move needs about two weeks to arrange.'}</p>
      ${notes ? `<ul class="mv-notes" role="note">${notes}</ul>` : ''}</section>
    <section class="mv-sec"><h3>Steps <span id="mvProg">${tl.done} of ${tl.total} done</span></h3><div class="mv-bar-p" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="Steps done"><i style="width:${pct}%"></i></div>
      <ol class="mv-steps" id="mvSteps">${groups}</ol>
      <form class="mv-add" id="mvAdd" autocomplete="off"><input type="text" id="mvAddT" placeholder="Add your own step, for example: return the cable box" maxlength="120" aria-label="A step of your own"><input type="date" id="mvAddD" value="${esc(tl.start)}" aria-label="Date for your step"><button type="submit" class="btn sm">Add</button></form></section>
    <section class="mv-sec"><h3>Cash <span>${esc(usd(p.costs.total) || '$0')} so far</span></h3><div id="mvCosts">${costsHTML(p)}</div></section>
    <section class="mv-sec"><h3>Take it with you</h3><p class="mv-hint">The calendar file has one all-day event for every step that is not done yet, with a reminder at 9:00. The Reminders list has one line for each. Nothing is booked, sent or paid from here; confirm every date with the people involved.</p></section>`;
}

function render(focus) {
  const L = byId(st.id); if (!L || !root) return;
  const p = planOf(st.id);
  st.p = p;
  $('mvBody').innerHTML = bodyHTML(p);
  $('mvSub').textContent = `${L.address || ''}${L.address ? ' · ' : ''}Lease starts ${M.label(p.timeline.start, { year: true })} (${when(p.timeline.days_out)})`;
  $('mvT').textContent = homeLabel(L);
  if (focus) { const el = root.querySelector(focus); if (el) el.focus({ preventScroll: true }); }
}
const metaOf = (L) => ({ home: homeLabel(L), address: L.address || '', now: new Date() });

async function copy(text, done) {
  try { await navigator.clipboard.writeText(text); toast(done); return; } catch { /* the clipboard may be blocked: select the text instead */ }
  const ta = Object.assign(document.createElement('textarea'), { value: text }); ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;left:-9999px';
  document.body.append(ta); ta.select();
  try { document.execCommand('copy'); toast(done); } catch { toast('Could not copy: select the text and copy it yourself'); }
  ta.remove();
}

function onClick(e) {
  if (e.target.closest('[data-close]')) { close(); return; }
  const act = e.target.closest('[data-act]'); if (!act) return;
  const id = st.id, L = byId(id), a = act.dataset.act, stepEl = act.closest('[data-step]'), sid = stepEl?.dataset.step;
  if (a === 'ics') { download(M.fileName(homeLabel(L), 'ics'), M.toICS(st.p.timeline, metaOf(L)), 'text/calendar'); toast('Calendar file saved: open it to add the steps to your calendar'); return; }
  if (a === 'reminders') { copy(M.toReminders(st.p.timeline, metaOf(L)), 'Copied: paste it into Reminders and each line becomes a reminder'); return; }
  if (a === 'checklist') { copy(M.toChecklistText(st.p.timeline, st.p.costs, metaOf(L)), 'Checklist copied'); return; }
  if (a === 'unstart') { change(id, { start: null }); render(); return; }
  if (!sid) return;
  const s = st.p.timeline.steps.find((x) => x.id === sid); if (!s) return;
  const sel = `[data-step="${CSS.escape(sid)}"] [data-act="${a}"]`;
  if (a === 'toggle') { st.open.has(sid) ? st.open.delete(sid) : st.open.add(sid); render(sel); }
  else if (a === 'done') {
    if (s.custom) save(M.normalize({ ...plan, homes: { ...plan.homes, [id]: { ...M.homeState(plan, id), updated: today(), custom: M.homeState(plan, id).custom.map((c) => (c.id === sid ? { ...c, ...(s.done ? { done: undefined } : { done: today() }) } : c)) } } }));
    else { const done = { ...M.homeState(plan, id).done }; if (s.done) delete done[sid]; else done[sid] = today(); change(id, { done: Object.keys(done).length ? done : null }); }
    render(sel); refreshDrawer();
  } else if (a === 'reset') { const dates = { ...M.homeState(plan, id).dates }; delete dates[sid]; change(id, { dates: Object.keys(dates).length ? dates : null }); render(sel); }
  else if (a === 'remove') { save(M.normalize({ ...plan, homes: { ...plan.homes, [id]: { ...M.homeState(plan, id), updated: today(), custom: M.homeState(plan, id).custom.filter((c) => c.id !== sid) } } })); render(); }
}
function onChange(e) {
  const t = e.target, id = st.id;
  if (t.dataset.act === 'home') { setHome(t.value); return; }
  if (t.dataset.field) {
    const f = t.dataset.field, v = t.value;
    if (f === 'notice_days') change(id, { notice_days: v === '' ? null : Math.max(0, Math.min(365, Math.round(+v))) });
    else change(id, { [f]: v && M.dayOf(v) != null ? v : null });
    render(`#${t.id}`); refreshDrawer(); return;
  }
  if (t.dataset.cost) { const v = t.value === '' ? null : Math.max(0, +t.value); change(id, { [t.dataset.cost]: Number.isFinite(v) ? v : null }); render(`[data-cost="${t.dataset.cost}"]`); return; }
  if (t.dataset.act === 'date') {
    const sid = t.closest('[data-step]').dataset.step, s = st.p.timeline.steps.find((x) => x.id === sid);
    if (!s || !t.value || M.dayOf(t.value) == null) return;
    if (s.custom) save(M.normalize({ ...plan, homes: { ...plan.homes, [id]: { ...M.homeState(plan, id), updated: today(), custom: M.homeState(plan, id).custom.map((c) => (c.id === sid ? { ...c, date: t.value } : c)) } } }));
    else change(id, { dates: { ...M.homeState(plan, id).dates, [sid]: t.value } });
    render(`[data-step="${CSS.escape(sid)}"] [data-act="toggle"]`);
  }
}
function onSubmit(e) {
  if (e.target.id !== 'mvAdd') return;
  e.preventDefault();
  const title = $('mvAddT').value.trim(), d = $('mvAddD').value; if (!title) { $('mvAddT').focus(); return; }
  const id = st.id, cur = M.homeState(plan, id);
  const nid = `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  save(M.normalize({ ...plan, homes: { ...plan.homes, [id]: { ...cur, updated: today(), custom: [...cur.custom, { id: nid, title, date: d && M.dayOf(d) != null ? d : null }] } } }));
  render('#mvAddT'); toast('Step added');
}
function setHome(id) {
  if (!byId(id)) return;
  st.id = id; st.open = new Set();
  save(M.normalize({ ...plan, chosen: id }));
  render('#mvHome');
}
const refreshDrawer = () => { if (S.sel && document.getElementById('dMove')) openDrawer(S.sel, { instant: true, noVT: true }); };

export const isOpen = () => !!root;
function onKey(e) {
  if (!root) return;
  if (e.key === 'Escape') { e.stopPropagation(); close(); return; }
  if (e.key !== 'Tab') return;
  const f = [...root.querySelectorAll('button:not([disabled]), input:not([disabled]), select, a[href]')].filter((x) => x.offsetParent !== null);
  if (!f.length) return;
  const a = f.indexOf(document.activeElement);
  if (!root.contains(document.activeElement)) { e.preventDefault(); f[0].focus(); }
  else if (e.shiftKey && a <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && a === f.length - 1) { e.preventDefault(); f[0].focus(); }
}
/** Open the planner for listing `id` (the home the plan was last made for, else the first likely one, when none is given). */
export function open(id = null) {
  const L = byId(id) || byId(plan.chosen) || candidates()[0];
  if (!L) { toast('Save or shortlist a home first, then plan its move'); return; }
  if (root) close(true);
  st = { id: L.id, open: new Set(), p: null };
  if (plan.chosen !== L.id) save(M.normalize({ ...plan, chosen: L.id }));
  root = document.createElement('div');
  root.className = 'mv'; root.id = 'movePlanner'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-labelledby', 'mvT');
  root.innerHTML = shell(L);
  document.body.append(root);
  inerted = [];
  for (const n of document.body.children) if (n !== root && !n.inert && !['SCRIPT', 'STYLE', 'LINK'].includes(n.tagName) && n.id !== 'toast') { n.inert = true; inerted.push(n); }
  root.addEventListener('click', onClick); root.addEventListener('change', onChange); root.addEventListener('submit', onSubmit);
  document.addEventListener('keydown', onKey, true);   // on the document: a redrawn list drops the focused control, and the key would never reach the sheet
  render();
  document.documentElement.classList.add('mv-open-html');
  requestAnimationFrame(() => { root?.classList.add('on'); $('mvT')?.focus({ preventScroll: true }); });
}
export function close(quick = false) {
  if (!root) return;
  const r = root; root = null; st = null;
  document.removeEventListener('keydown', onKey, true);
  r.classList.remove('on');
  for (const n of inerted) n.inert = false;
  inerted = [];
  document.documentElement.classList.remove('mv-open-html');
  if (quick) r.remove(); else setTimeout(() => r.remove(), 260);
  refreshDrawer();
}

// ------------------------------------------------------------------ entry points
function mountMenu() {
  const menu = $('appMenu'), after = $('mnReport') || $('mnMemo') || $('mnRestore');
  if (!menu || !after || menu.querySelector('#mnMove')) return;
  const b = document.createElement('button');
  b.type = 'button'; b.role = 'menuitem'; b.id = 'mnMove'; b.innerHTML = `${ICON}<span>Plan my move</span>`;
  b.addEventListener('click', () => open());
  after.after(b);
}
export function init() {
  if (started) return;
  started = true;
  load();
  addDrawerTop('move', drawerHTML, 45);
  const ex = hooks.exportExtra, im = hooks.importExtra;
  hooks.exportExtra = () => ({ ...(ex?.() || {}), ...(M.hasPlan(plan) ? { [M.KEY]: plan } : {}) });
  hooks.importExtra = (js) => { im?.(js); if (js && typeof js[M.KEY] === 'object') { save(M.mergePlans(plan, js[M.KEY])); refreshDrawer(); } };
  document.addEventListener('click', (e) => {
    const b = e.target.closest?.('[data-move-open]'); if (!b || root?.contains(b)) return;
    e.preventDefault(); e.stopPropagation(); open(b.dataset.moveOpen);
  }, true);
  mountMenu();
  on('select', ({ id } = {}) => { if (id) queueMicrotask(() => { if (S.sel && !document.getElementById('dMove') && offersPlan(byId(S.sel))) openDrawer(S.sel, { instant: true, noVT: true }); }); });
  if (S.sel) openDrawer(S.sel, { instant: true, noVT: true });   // opened by ?open= before this module loaded
  const want = new URLSearchParams(location.search).get('move');   // ?move=<listing id> opens the planner (used by links and tests)
  if (want && byId(want)) queueMicrotask(() => open(want));
}
