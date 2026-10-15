// "Unknowns that move this score": the screen part. For a home the scorer had to estimate or guess (size, monthly fees, a
// disputed price, a washer/dryer nobody confirmed, a floor read off the unit number) the drawer lists each unknown with the
// score range it spans and the ranks it could land in, and lets the renter type the real value. The home re-ranks at once, in
// this browser, and the number is kept as the renter's (source "renter") beside the listing's own facts, which it never
// replaces; facts-store.js keeps it, and `apartmentscout score` reads it from the search folder the same way. The arithmetic
// is in facts-model.js.
import { S, on, hooks, byId, label, applyCriteria, scoreDay, openDrawer } from '../app.js';
import { $, esc, toast } from '../util.js';
import * as FS from './facts-store.js';
import { addDrawerTop } from './drawer-slots.js';
import { applyFacts, unknownsOf, preview, KIND, overallOf, checkValue } from './facts-model.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayText = (iso) => { const m = String(iso).match(/^\d{4}-(\d{2})-(\d{2})/); return m ? `${MONTHS[+m[1] - 1]} ${+m[2]}` : String(iso); };
const money = (v) => `$${Math.round(v).toLocaleString('en-US')}`;
const ctxFor = (L) => ({ weights: S.weights, listings: S.listings, facts: FS.get(L.id) || {}, today: new Date().toISOString().slice(0, 10), day: scoreDay() });
const shown = (kind, v) => (kind === 'wd' ? (v ? 'yes' : 'no') : kind === 'size' ? `${Math.round(v).toLocaleString('en-US')} ft²` : kind === 'floor' ? `floor ${v}` : `${money(v)} a month`);
const rankText = (r) => (r == null ? 'not ranked' : `#${r}`);

// ------------------------------------------------------------------ scoring pass
/** Runs inside applyCriteria, after the scorer's result (and any promoted tour finding) is in place: the renter's numbers are applied. */
function scorePass() {
  for (const L of S.listings) {
    const f = FS.get(L.id);
    if (f) L.score = applyFacts(L, L.score, S.crit, f, scoreDay());
  }
}
let sig = '{}';
/** Re-score and re-rank when the numbers changed (or on first sight of them). */
function refresh(force = false) {
  const key = JSON.stringify(FS.all());
  if (!force && key === sig) return;
  sig = key;
  applyCriteria(S.preview?.profile ?? null, { quiet: true });
}

// ------------------------------------------------------------------ drawer
function spanText(u) {
  if (u.lo == null) return '';
  const lo = u.lo.toFixed(1), hi = u.hi.toFixed(1);
  const now = overallOf(S.listings.find((x) => x.id === u.id)?.score?.parts, S.weights);
  const ranks = u.dropsOut
    ? `if it is not there it leaves your ranking (it would fail a must-have); if it is, ${rankText(u.rankBest)}`
    : u.rankBest != null && u.rankWorst != null ? `${rankText(u.rankBest)} to ${rankText(u.rankWorst)}` : '';
  return `Could put this home anywhere from <b>${lo}</b> to <b>${hi}</b>${Number.isFinite(now) ? ` (it scores ${now.toFixed(1)} now)` : ''}${ranks ? `, so ${u.dropsOut ? '' : 'rank '}<b>${esc(ranks)}</b>` : ''}.`;
}
function inputHTML(u) {
  const k = KIND[u.kind], v = u.entered?.value;
  if (k.input === 'bool') {
    return `<div class="uk-yn" role="group" aria-label="${esc(k.label)}"><button type="button" class="btn sm ${v === true ? 'primary' : ''}" data-uk-set="${u.kind}" data-v="true" aria-pressed="${v === true}">Yes, it has one</button><button type="button" class="btn sm ${v === false ? 'primary' : ''}" data-uk-set="${u.kind}" data-v="false" aria-pressed="${v === false}">No</button></div>`;
  }
  return `<form class="uk-form" data-uk-form="${u.kind}" novalidate><label class="uk-in"><span class="sr-only">${esc(k.label)}${k.unit ? ' in ' + esc(k.unit) : ''}</span>
    <input name="v" type="text" inputmode="decimal" autocomplete="off" spellcheck="false" placeholder="${esc(k.placeholder || '')}" value="${v != null ? esc(String(v)) : ''}" data-uk-in="${u.kind}" aria-label="${esc(k.label)}${k.unit ? ', ' + esc(k.unit) : ''}">${k.unit ? `<i>${esc(k.unit)}</i>` : ''}</label>
    <button type="submit" class="btn sm primary" ${v != null ? '' : 'disabled'} data-uk-save>${v != null ? 'Update' : 'Save'}</button></form>`;
}
function rowHTML(u, L) {
  const k = KIND[u.kind], entered = u.entered;
  if (entered) {
    return `<li class="uk entered" data-uk="${u.kind}"><div class="uk-top"><b class="uk-ask">${esc(k.label)}: ${esc(shown(u.kind, entered.value))}</b><span class="uk-now">You entered this${entered.at ? ' on ' + esc(dayText(entered.at)) : ''} (source: renter). The listing's own facts are unchanged.</span></div>
      ${inputHTML(u)}<p class="uk-live" aria-live="polite"></p>
      <div class="uk-acts">${u.baked ? '<span class="uk-baked">Part of the last <code>apartmentscout score</code> run</span>' : ''}<button type="button" class="btn sm ghost" data-uk-clear="${u.kind}">Clear</button></div></li>`;
  }
  let extra = '';
  if (u.kind === 'wd') {
    const ctx = ctxFor(L), y = preview(L, L.score, S.crit, 'wd', true, ctx), n = preview(L, L.score, S.crit, 'wd', false, ctx);
    extra = `<p class="uk-live">If yes: ${y ? `score ${y.overall.toFixed(1)}, rank ${rankText(y.rank)}` : '?'}. If no: ${n ? (n.eligible ? `score ${n.overall.toFixed(1)}, rank ${rankText(n.rank)}` : 'it leaves your ranking (it fails a must-have)') : '?'}.</p>`;
  } else extra = '<p class="uk-live" aria-live="polite"></p>';
  return `<li class="uk" data-uk="${u.kind}"><div class="uk-top"><b class="uk-ask">${esc(u.ask)}</b><span class="uk-now">${esc(u.now)}</span></div>
    <p class="uk-span">${spanText({ ...u, id: L.id })}</p><p class="uk-hint">${esc(k.hint || '')}</p>${inputHTML(u)}${extra}</li>`;
}
function unknownRows(L) {
  const rows = unknownsOf(L, L.score, S.crit, ctxFor(L));
  return rows.sort((a, b) => ((b.hi ?? 0) - (b.lo ?? 0)) - ((a.hi ?? 0) - (a.lo ?? 0)) || (a.entered ? 1 : 0) - (b.entered ? 1 : 0));
}
function drawerHTML(L) {
  const rows = unknownRows(L);
  if (!rows.length) return '';
  const open = rows.filter((r) => !r.entered).length, st = FS.status();
  return `<div class="d-sec uk-sec" id="dUnknowns" data-tab="Unknowns"><h3>Unknowns that move this score <span>${open ? `${open} to fill in` : 'all filled in'}</span></h3>
    <p class="uk-lead">Type what you know and the home re-ranks at once. Your number is kept as yours (source: renter) and never replaces what the listing says. ${st.server ? 'It is saved to your search folder.' : 'It is kept in this browser.'}</p>
    <ul class="uk-list">${rows.map((u) => rowHTML(u, L)).join('')}</ul></div>`;
}

// ------------------------------------------------------------------ typing, saving
function liveText(L, kind, raw) {
  const out = document.querySelector(`#dUnknowns [data-uk="${kind}"] .uk-live`); if (!out) return;
  const v = checkValue(kind, raw);
  if (!String(raw).trim()) { out.textContent = ''; return; }
  if (v == null) { out.textContent = `That does not look like a usable ${KIND[kind].label.toLowerCase()}.`; return; }
  const p = preview(L, L.score, S.crit, kind, v, ctxFor(L));
  if (!p) { out.textContent = ''; return; }
  out.innerHTML = p.eligible
    ? `With <b>${esc(shown(kind, v))}</b>: score <b>${p.overall.toFixed(1)}</b> (now ${p.nowOverall.toFixed(1)}), rank <b>${esc(rankText(p.rank))}</b> (now ${esc(rankText(p.nowRank))}).`
    : `With <b>${esc(shown(kind, v))}</b> this home would leave your ranking: it fails a must-have.`;
}
function save(L, kind, raw) {
  const v = checkValue(kind, raw);
  if (v == null) { const out = document.querySelector(`#dUnknowns [data-uk="${kind}"] .uk-live`); if (out) out.textContent = `Enter a number between ${KIND[kind].min} and ${KIND[kind].max.toLocaleString('en-US')}.`; return; }
  const before = FS.get(L.id)?.[kind]?.value, was = L._rank;
  FS.setFact(L.id, kind, v);
  refresh();
  const now = byId(L.id)?._rank;
  toast(`Saved ${shown(kind, v)} for ${label(L)}: ${now ? `now #${now}${was ? `, was #${was}` : ''}` : 'it is not ranked'}`, 6200, {
    label: 'Undo', run: () => { if (before == null) FS.clearFact(L.id, kind); else FS.setFact(L.id, kind, before); refresh(); },
  });
}
function clear(L, kind) {
  const before = FS.get(L.id)?.[kind]?.value;
  FS.clearFact(L.id, kind);
  refresh();
  toast(`Cleared your ${KIND[kind].label.toLowerCase()} for ${label(L)}`, 5200, before == null ? null : { label: 'Undo', run: () => { FS.setFact(L.id, kind, before); refresh(); } });
}

function wire() {
  const dr = $('drawer'); if (!dr) return;
  dr.addEventListener('input', (e) => {
    const i = e.target.closest?.('[data-uk-in]'); if (!i || !S.sel) return;
    const L = byId(S.sel); if (!L) return;
    const b = i.closest('form')?.querySelector('[data-uk-save]'); if (b) b.disabled = !String(i.value).trim();
    liveText(L, i.dataset.ukIn, i.value);
  });
  dr.addEventListener('submit', (e) => {
    const f = e.target.closest?.('[data-uk-form]'); if (!f || !S.sel) return;
    e.preventDefault();
    const L = byId(S.sel); if (L) save(L, f.dataset.ukForm, f.querySelector('input').value);
  });
  dr.addEventListener('click', (e) => {
    const L = S.sel && byId(S.sel); if (!L) return;
    const s = e.target.closest?.('[data-uk-set]');
    if (s) { save(L, s.dataset.ukSet, s.dataset.v === 'true'); return; }
    const c = e.target.closest?.('[data-uk-clear]');
    if (c) clear(L, c.dataset.ukClear);
  });
}

// ------------------------------------------------------------------ start
export async function init() {
  hooks.score2 = scorePass;
  addDrawerTop('unknowns', drawerHTML, 20);
  const ex = hooks.exportExtra, im = hooks.importExtra;
  hooks.exportExtra = () => { const facts = FS.exportFacts(); return { ...(ex?.() || {}), ...(Object.keys(facts).length ? { facts } : {}) }; };
  hooks.importExtra = (js) => { im?.(js); if (js?.facts && typeof js.facts === 'object') { FS.importFacts(js.facts); refresh(); } };
  wire();
  await FS.init();
  FS.onChange((id) => { if (id === null) refresh(); });
  refresh();
  if (S.sel) openDrawer(S.sel, { instant: true, noVT: true });   // opened by ?open= before this module loaded
  on('weights-settled', () => { const el = $('dUnknowns'); if (el && S.sel && !el.querySelector(':focus')) openDrawer(S.sel, { instant: true, noVT: true }); });
}
