// Questions for the leasing office: the part that joins the pieces to the dashboard.
//
// What the renter sees: a "Questions for the leasing office" section in the listing drawer, a small button on every building row of
// the Shortlist (Buildings grouping) and on the Records report, and a side sheet that opens the draft for that building. The sheet
// lists the open questions of the renter's units of interest (the ones the data marks, plus saved and Compare picks and the unit
// they started from) with a checkbox each, grouped as the email will be: building-wide first, then one block per unit. A Copy
// button and a mailto: link carry the checked questions into the renter's own mail app. Nothing is sent from here and no address
// is filled in. "Mark answered" takes a pasted reply, keeps it as a dated, sourced note on the unit, offers the field updates it
// seems to state, and leaves the answered question out of later drafts.
//
// Rules for the draft are in office-model.js (mirrors apartmentscout/office_questions.py); reply parsing is in office-answer.js. This
// file only wires them. It adds itself to the drawer and the building views by watching them, so it needs no change to their code.
import { S, on, byId, store, loadJSON, pick, setPick, reloaders } from '../app.js';
import { $, esc, toast } from '../util.js';
import { watch, reducedMotion } from './dom.js';
import * as M from './office-model.js';
import * as A from './office-answer.js';

const KIND = { dispute: ['Sources disagree', 'warn'], verify: ['Please confirm', 'accent'], flag: ['Flagged', 'warn'], missing: ['Not known yet', ''], standard: ['Standard', ''] };
const FILE = 'questions.json';

let doc = null, entries = {}, nameKey = new Map(), answers = {}, started = false;
let root = null, st = null, inerted = [];

const keyName = () => `office:${S.crit0?.search?.name || S.base}`;
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const today = () => { const d = new Date(), p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };

// ------------------------------------------------------------------ data and answers
function loadAnswers() {
  const v = store.get(keyName(), {}), a = v && typeof v === 'object' && v.answers && typeof v.answers === 'object' ? v.answers : {};
  answers = {};
  for (const [id, r] of Object.entries(a)) if (r && typeof r === 'object' && typeof r.a === 'string' && typeof r.day === 'string') answers[id] = r;
}
const saveAnswers = () => store.set(keyName(), { v: 1, answers });

async function loadDoc() {
  const listed = (S.manifest.extra || []).map(String), emb = window.__AS_DATA__, path = `${S.base}/${FILE}`;
  if (!(listed.some((x) => x === FILE || x.endsWith(`/${FILE}`)) || (emb && path in emb))) return false;
  const d = await loadJSON(path, null);
  if (!d || typeof d !== 'object' || d.schema !== M.SCHEMA) return false;
  doc = d; entries = M.expandDoc(d); nameKey = new Map();
  for (const e of Object.values(entries)) { nameKey.set(norm(e.building), e.building_key); nameKey.set(norm(e.address.split(',')[0]), e.building_key); }
  return true;
}
/** The building key of a listing, even when none of its own units has anything open. */
function keyOf(L) { return entries[L.id]?.building_key || nameKey.get(norm(L.building)) || nameKey.get(norm(String(L.address || '').split(',')[0])) || null; }
const openIn = (u) => u.questions.filter((q) => !answers[q.id]).length;
/** The units a building's draft starts with (the renter's units of interest, plus `id`), their open questions and the answers on file. */
function scopeOf(key, id) {
  const units = M.interestUnits(entries, key, [...mine(), ...(id ? [id] : [])]);
  return { units, open: units.reduce((n, u) => n + openIn(u), 0), done: Object.keys(answers).filter((a) => entries[a.split(':')[0]]?.building_key === key).length };
}

/** Units the renter has shown interest in beyond what the data marks: saved, tiered or in Compare. */
const mine = () => [...new Set([...Object.entries(S.picks).filter(([, p]) => p && (p.saved || p.tier)).map(([id]) => id), ...(S.compare || [])])];

// ------------------------------------------------------------------ the sheet
const X = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>';
const MAIL = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="2" y="3.5" width="12" height="9" rx="1.6"/><path d="M2.6 4.6L8 8.8l5.4-4.2"/></svg>';

function draftNow() {
  const us = M.buildingUnits(entries, st.key).filter((u) => st.picked.has(u.id));
  const first = us[0] || M.buildingUnits(entries, st.key)[0];
  const d = M.assemble(st.key, first.building, first.address, us, { answered: Object.keys(answers), standard: M.standardItems(doc), standardOn: false });
  d.selected = [...d.selected.filter((id) => !st.off.has(id)), ...d.standard.filter((s) => st.std.has(s.id)).map((s) => s.id)];
  return d;
}

function questionRow(q, d) {
  const [kt, kc] = KIND[q.kind] || KIND.missing;
  const units = q.units?.length ? `<span class="of-for">For ${esc(q.units.join(', '))}</span>` : '';
  const ev = q.evidence?.length ? `<details class="of-why"><summary>Why this is asked</summary><ul>${q.evidence.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></details>` : '';
  const canAnswer = q.kind !== 'standard';
  return `<li class="of-q" data-q="${esc(q.id)}"><label class="of-chk"><input type="checkbox" data-q-chk="${esc(q.id)}" ${d.selected.includes(q.id) ? 'checked' : ''} ${q.kind === 'standard' ? 'data-std' : ''}><span class="of-t">${units}${esc(q.text)}</span></label>
    <div class="of-qm">${q.kind === 'standard' ? '' : `<span class="pill ${kc}">${esc(kt)}</span>`}${ev}${canAnswer ? `<button type="button" class="btn sm ghost" data-ans-open="${esc(q.id)}" aria-expanded="false">Mark answered</button>` : ''}</div>
    <div class="of-ansbox" data-ans-box="${esc(q.id)}" hidden></div></li>`;
}

function questionsHTML(d) {
  const blocks = [];
  if (d.shared.length) blocks.push(`<section class="of-grp"><h3>${d.units.length > 1 ? 'Across these units' : 'About the building'}</h3><ol class="of-list">${d.shared.map((q) => questionRow(q, d)).join('')}</ol></section>`);
  for (const b of d.by_unit) blocks.push(`<section class="of-grp"><h3>Unit ${esc(b.unit)}</h3><ol class="of-list">${b.questions.map((q) => questionRow(q, d)).join('')}</ol></section>`);
  if (!blocks.length) blocks.push('<p class="of-empty">Nothing is open for the units you picked. Every question here is either answered or already known.</p>');
  blocks.push(`<details class="of-grp of-std"${st.stdOpen || d.standard.some((s) => d.selected.includes(s.id)) ? " open" : ""}><summary>Also worth asking <small>${d.standard.length} standard lease-term questions, unchecked</small></summary><ol class="of-list">${d.standard.map((q) => questionRow(q, d)).join('')}</ol></details>`);
  return blocks.join('');
}

function unitsHTML() {
  const all = M.buildingUnits(entries, st.key);
  return `<div class="of-units" role="group" aria-label="Units to ask about">${all.map((u) => {
    const n = u.questions.filter((q) => !answers[q.id]).length;
    return `<label class="of-unit${st.picked.has(u.id) ? ' on' : ''}"><input type="checkbox" data-unit="${esc(u.id)}" ${st.picked.has(u.id) ? 'checked' : ''}><span>${esc(u.unit)}</span><small>${n} open${u.interest?.length ? ` · ${esc(u.interest[0])}` : ''}</small></label>`;
  }).join('')}</div>`;
}

function answeredHTML() {
  const rows = Object.entries(answers).filter(([id]) => entries[id.split(':')[0]]?.building_key === st.key || (st.units.has(id.split(':')[0])));
  if (!rows.length) return '';
  const withChanges = rows.filter(([, r]) => r.changes?.length);
  return `<details class="of-grp of-done" ${rows.length <= 3 ? 'open' : ''}><summary>Answered <small>${rows.length}</small></summary>
    <ul class="of-list">${rows.map(([id, r]) => {
      const e = entries[id.split(':')[0]], q = e?.questions.find((x) => x.id === id);
      return `<li class="of-a"><div><b>${esc(e?.unit || id)}</b> <span class="faint">${esc(r.topic.split(':').at(-1).replace(/_/g, ' '))} · ${esc(r.day)} · ${esc((A.HOW_LABEL[r.how] || '').toLowerCase())}</span></div>
        ${q ? `<p class="of-aq">${esc(q.text)}</p>` : ''}<p class="of-ar">${esc(r.a)}</p>
        ${r.changes?.length ? `<p class="faint">Values you confirmed: ${esc(r.changes.map((c) => `${c.path} = ${Array.isArray(c.value) ? c.value.join('/') : c.value}`).join(', '))}</p>` : ''}
        <div class="of-qm">${r.changes?.length ? `<button type="button" class="btn sm" data-copy-update="${esc(id)}">Copy updates.json entry</button>` : ''}<button type="button" class="btn sm ghost" data-reopen="${esc(id)}">Reopen</button></div></li>`;
    }).join('')}</ul>
    ${withChanges.length > 1 ? `<button type="button" class="btn sm" data-copy-updates-all>Copy updates.json for all ${withChanges.length}</button>` : ''}
    <p class="faint of-hint">Copy an entry into <code>updates.json</code> and run <code>apartmentscout handoff import updates.json --dry-run</code> to put a confirmed value into <code>listings.json</code> as a dated, sourced claim. The dashboard itself does not edit listings.</p></details>`;
}

function shell() {
  return `<div class="of-scrim" data-close></div><section class="of-panel"><header class="of-h"><div><div class="of-k">Leasing office</div><h2 id="ofT" tabindex="-1">Questions for ${esc(st.name)}</h2>
      <p class="of-sub">A draft for you to send. This page sends nothing and fills in no address; the sign-off is a placeholder.</p></div><button type="button" class="of-x" data-close aria-label="Close">${X}</button></header>
    <div class="of-body"><section class="of-sec"><h3>Units</h3><div id="ofUnits"></div></section>
      <section class="of-sec"><h3>Questions <span id="ofCount"></span></h3><div id="ofQs"></div><div id="ofDone"></div></section>
      <section class="of-sec"><h3>Your email</h3><label class="of-lab" for="ofSubj">Subject</label><input id="ofSubj" class="of-inp" type="text" autocomplete="off">
        <label class="of-lab" for="ofText">Message <small id="ofEdited" hidden>edited by you</small></label><textarea id="ofText" class="of-ta" rows="14" spellcheck="true"></textarea>
        <p class="of-hint" id="ofHint"></p></section></div>
    <footer class="of-bar"><button type="button" class="btn primary" id="ofCopy">Copy email</button><a class="btn" id="ofMail" href="mailto:" rel="noopener">${MAIL}Open in my email app</a></footer></section>`;
}

function refreshLists(keepUnits = false) {
  const d = (st.draft = draftNow());
  if (!keepUnits) $('ofUnits').innerHTML = unitsHTML();   // a unit toggle keeps its own checkbox (and the keyboard focus on it)
  $('ofQs').innerHTML = questionsHTML(d);
  $('ofDone').innerHTML = answeredHTML();
  refreshText();
}
function refreshText() {
  const d = (st.draft = draftNow()), sel = d.selected, c = M.counts(d, sel);
  $('ofCount').textContent = `${c.chosen} checked`;
  if (!st.dirtyS) $('ofSubj').value = M.subject(d, sel);
  if (!st.dirty) $('ofText').value = M.renderText(d, sel);
  $('ofEdited').hidden = !st.dirty;
  patchMail();
}
function patchMail() {
  const body = $('ofText').value, subj = $('ofSubj').value, a = $('ofMail');
  const href = M.mailtoHref(subj, body);
  a.href = href; a.toggleAttribute('aria-disabled', !body.trim()); a.classList.toggle('disabled', !body.trim());
  $('ofCopy').disabled = !body.trim();
  const msg = !body.trim() ? 'Check at least one question to write the email.'
    : M.tooLongForMailto(href) ? 'This is long for a mailto: link: some mail apps cut it. Use <b>Copy email</b> and paste it into a new message.'
      : 'The link opens a new message in your own mail app with this subject and text; add the leasing office\'s address yourself and send it when you are ready.';
  $('ofHint').innerHTML = msg + (st.dirty || st.dirtyS ? ' <button type="button" class="of-link" data-reset-text>Rewrite from the checked questions</button>' : '');
}

async function copy(text, done) {
  try { await navigator.clipboard.writeText(text); toast(done); return; } catch { /* fall back below */ }
  const t = Object.assign(document.createElement('textarea'), { value: text });
  t.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
  document.body.append(t); t.select();
  let ok = false; try { ok = document.execCommand('copy'); } catch { /* none */ }
  t.remove();
  toast(ok ? done : 'Could not copy. Select the text and copy it by hand.');
}

// ------------------------------------------------------------------ Mark answered
function answerForm(qid) {
  const q = questionOf(qid); if (!q) return '';
  const targets = (q.unit_ids?.length ? q.unit_ids : [qid.split(':')[0]]).map((id) => entries[id]).filter(Boolean);
  return `<form class="of-form" data-form="${esc(qid)}" novalidate>
    <label class="of-lab" for="ofA-${esc(qid)}">Paste the answer</label>
    <textarea id="ofA-${esc(qid)}" class="of-ta" rows="4" data-ans-text placeholder="What the leasing office wrote or said"></textarea>
    <div class="of-row"><label>How <select data-ans-how>${A.HOW.map(([k, n]) => `<option value="${k}">${n}</option>`).join('')}</select></label>
      <label>Date <input type="date" data-ans-day value="${today()}"></label></div>
    ${targets.length > 1 ? `<fieldset class="of-apply"><legend>Applies to</legend>${targets.map((e) => `<label><input type="checkbox" data-apply="${esc(e.id)}" checked> ${esc(e.unit)}</label>`).join('')}</fieldset>` : ''}
    <div class="of-props" data-props aria-live="polite"></div>
    <div class="of-qm"><button type="submit" class="btn sm primary">Save answer</button><button type="button" class="btn sm ghost" data-ans-cancel>Cancel</button></div>
    <p class="faint of-hint">Saved in this browser as a dated note on the unit${targets.length > 1 ? 's' : ''}; the question stops appearing in drafts.</p></form>`;
}
const BOOL = '<option value="true">Yes</option><option value="false">No</option>';
function propsHTML(props) {
  if (!props.length) return '<p class="faint of-hint">Nothing in the answer reads as a value to record. The whole reply is still kept as a note.</p>';
  return `<div class="of-lab">The answer seems to say <small>tick what to record; edit anything that is off</small></div>${props.map((p, i) => `<label class="of-prop"><input type="checkbox" data-prop="${i}" checked><span>${esc(p.label)}</span>${
    typeof p.value === 'boolean' ? `<select data-propval="${i}">${BOOL.replace(`value="${p.value}"`, `value="${p.value}" selected`)}</select>` : `<input type="text" data-propval="${i}" value="${esc(Array.isArray(p.value) ? p.value.join('/') : p.value)}" inputmode="decimal">`}</label>`).join('')}`;
}
function readProps(form, props) {
  const out = [];
  props.forEach((p, i) => {
    if (!form.querySelector(`[data-prop="${i}"]`)?.checked) return;
    const el = form.querySelector(`[data-propval="${i}"]`); let v = el.value.trim();
    if (typeof p.value === 'boolean') v = v === 'true';
    else if (typeof p.value === 'number') { v = Number(v.replace(/,/g, '')); if (!Number.isFinite(v)) return; }
    else if (Array.isArray(p.value)) v = v.toUpperCase().split(/[\s,/]+/).filter(Boolean);
    out.push({ path: p.path, value: v });
  });
  return out;
}
const questionOf = (qid) => [...st.draft.shared, ...st.draft.by_unit.flatMap((b) => b.questions)].find((x) => x.id === qid);
function saveAnswer(form, q, props) {
  const text = form.querySelector('[data-ans-text]').value.trim();
  const how = form.querySelector('[data-ans-how]').value, day = form.querySelector('[data-ans-day]').value || today();
  const changes = readProps(form, props);
  const ids = q.unit_ids?.length ? q.unit_ids : [q.id.split(':')[0]];
  const apply = form.querySelectorAll('[data-apply]').length ? ids.filter((id) => form.querySelector(`[data-apply="${CSS.escape(id)}"]`)?.checked) : ids;
  if (!apply.length) { toast('Pick at least one unit'); return; }
  for (const uid of apply) {
    answers[`${uid}:${q.topic}`] = { a: text.slice(0, 3000), how, day, topic: q.topic, unit_id: uid, ...(changes.length ? { changes } : {}) };
    if (byId(uid)) {   // the reply, dated and sourced, in the renter's own notes for the unit (it rides along in the picks backup)
      const cur = pick(uid).note || '';
      setPick(uid, { note: (cur ? `${cur}\n\n` : '') + A.noteLine({ day, how, topic: q.topic, text }) });
    }
  }
  saveAnswers();
  toast(`Saved. ${apply.length === 1 ? `${entries[apply[0]]?.unit || 'The unit'}'s` : "The units'"} notes hold the reply.`, 4200);
  refreshLists();
}

// ------------------------------------------------------------------ events
function onClick(e) {
  const t = e.target.closest('button, a'); if (!t || !root.contains(t)) return;
  const d = t.dataset;
  if (d.close != null) { closeSheet(); return; }
  if (t.id === 'ofCopy') { copy($('ofText').value, 'Email copied. Paste it into a new message and add the address yourself.'); return; }
  if (t.id === 'ofMail') { if (!$('ofText').value.trim()) e.preventDefault(); return; }
  if (d.resetText != null) { st.dirty = false; st.dirtyS = false; refreshText(); return; }
  if (d.ansOpen) {
    const box = root.querySelector(`[data-ans-box="${CSS.escape(d.ansOpen)}"]`), open = box.hidden;
    root.querySelectorAll('[data-ans-box]').forEach((b) => { b.hidden = true; b.innerHTML = ''; });
    root.querySelectorAll('[data-ans-open]').forEach((b) => b.setAttribute('aria-expanded', 'false'));
    if (open) { box.innerHTML = answerForm(d.ansOpen); box.hidden = false; t.setAttribute('aria-expanded', 'true'); box.querySelector('textarea')?.focus(); }
    return;
  }
  if (d.ansCancel != null) { const b = t.closest('[data-ans-box]'); b.hidden = true; b.innerHTML = ''; root.querySelector(`[data-ans-open="${CSS.escape(b.dataset.ansBox)}"]`)?.setAttribute('aria-expanded', 'false'); return; }
  if (d.reopen) { delete answers[d.reopen]; saveAnswers(); toast('Reopened. The note on the unit stays; delete it there if you do not want it.', 4200); refreshLists(); return; }
  if (d.copyUpdate) { const r = answers[d.copyUpdate]; if (r) copy(JSON.stringify(A.updatesDoc([updateOf(d.copyUpdate, r)], r.day), null, 1), 'updates.json entry copied'); return; }
  if (t.hasAttribute('data-copy-updates-all')) {
    const rs = Object.entries(answers).filter(([id, r]) => r.changes?.length && entries[id.split(':')[0]]?.building_key === st.key);
    copy(JSON.stringify(A.updatesDoc(rs.map(([id, r]) => updateOf(id, r)), today()), null, 1), `${rs.length} updates.json entries copied`);
  }
}
const updateOf = (id, r) => A.updateEntry({ unit_id: r.unit_id || id.split(':')[0], day: r.day, how: r.how, changes: r.changes, text: r.a });

function onChange(e) {
  const t = e.target;
  if (t.dataset.unit) { t.checked ? st.picked.add(t.dataset.unit) : st.picked.delete(t.dataset.unit); t.closest('label').classList.toggle('on', t.checked); refreshLists(true); return; }
  if (t.dataset.qChk) {
    if (t.hasAttribute('data-std')) t.checked ? st.std.add(t.dataset.qChk) : st.std.delete(t.dataset.qChk);
    else t.checked ? st.off.delete(t.dataset.qChk) : st.off.add(t.dataset.qChk);
    refreshText();
  }
}
function onInput(e) {
  const t = e.target;
  if (t.id === 'ofText') { st.dirty = true; $('ofEdited').hidden = false; patchMail(); return; }
  if (t.id === 'ofSubj') { st.dirtyS = true; patchMail(); return; }
  if (t.matches?.('[data-ans-text], [data-ans-day]')) {
    const form = t.closest('form'); clearTimeout(form._t);
    form._t = setTimeout(() => {
      const q = questionOf(form.dataset.form); if (!q) return;
      const text = form.querySelector('[data-ans-text]').value, box = form.querySelector('[data-props]');
      if (!text.trim()) { box.innerHTML = ''; return; }
      const props = A.proposeChanges(q.topic, text, form.querySelector('[data-ans-day]').value || today());
      form._props = props; form._shown = true; box.innerHTML = propsHTML(props);
    }, 250);
  }
}
function onSubmit(e) {
  const f = e.target.closest('form[data-form]'); if (!f) return;
  e.preventDefault();
  clearTimeout(f._t);
  const q = questionOf(f.dataset.form), ta = f.querySelector('[data-ans-text]');
  if (!q || !ta.value.trim()) { ta.focus(); toast('Paste the answer first'); return; }
  if (!f._shown) {   // saved before the values showed: show them first, so the renter confirms what is recorded
    f._props = A.proposeChanges(q.topic, ta.value, f.querySelector('[data-ans-day]').value || today());
    f._shown = true; f.querySelector('[data-props]').innerHTML = propsHTML(f._props);
    if (f._props.length) { toast('Check the values the answer seems to state, then save'); return; }
  }
  saveAnswer(f, q, f._props || []);
}
function onKey(e) {
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeSheet(); return; }
  if (e.key !== 'Tab') return;
  const f = [...root.querySelectorAll('button:not([disabled]), input:not([hidden]):not([disabled]), textarea, select, a[href]:not(.disabled), summary')].filter((x) => x.offsetParent !== null || x === document.activeElement);
  if (!f.length) return;
  const a = f.indexOf(document.activeElement);
  if (e.shiftKey && a <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && a === f.length - 1) { e.preventDefault(); f[0].focus(); }
}

/** The questions still open for one unit, as [{ text, kind }] (answered ones left out): what the decision report lists for a home. */
export function openQuestionsFor(id) {
  return (entries[id]?.questions || []).filter((q) => !answers[q.id]).map((q) => ({ text: q.text, kind: q.kind }));
}

// ------------------------------------------------------------------ open and close
export const isOpen = () => !!root;
/** Open the draft for the building of listing `id`. */
export function openFor(id) {
  const L = byId(id); if (!L || !doc) return;
  const key = keyOf(L); if (!key) { toast('No questions are drafted for this building yet'); return; }
  const interest = scopeOf(key, id).units.map((u) => u.id);
  const all = M.buildingUnits(entries, key);
  if (!all.length) { toast('Nothing is open for this building'); return; }
  if (root) closeSheet(true);
  st = { key, name: all[0].building, picked: new Set(interest.length ? interest : all.map((u) => u.id)), units: new Set(all.map((u) => u.id)), off: new Set(), std: new Set(), dirty: false, dirtyS: false, draft: null, opener: document.activeElement };
  root = document.createElement('div');
  root.className = 'of'; root.id = 'officeSheet'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-labelledby', 'ofT');
  root.innerHTML = shell();
  document.body.append(root);
  inerted = [];
  for (const n of document.body.children) if (n !== root && !n.inert && !['SCRIPT', 'STYLE', 'LINK'].includes(n.tagName) && n.id !== 'toast') { n.inert = true; inerted.push(n); }
  root.addEventListener('click', onClick); root.addEventListener('change', onChange); root.addEventListener('input', onInput); root.addEventListener('submit', onSubmit); root.addEventListener('keydown', onKey);
  root.addEventListener('toggle', (e) => { if (e.target.classList?.contains('of-std')) st.stdOpen = e.target.open; }, true);
  refreshLists();
  document.documentElement.classList.add('of-open');
  requestAnimationFrame(() => { root?.classList.add('on'); $('ofT')?.focus({ preventScroll: true }); });
}
export function closeSheet(quick = false) {
  if (!root) return;
  const r = root, opener = st?.opener; root = null; st = null;
  for (const n of inerted) n.inert = false;
  inerted = [];
  document.documentElement.classList.remove('of-open');
  const done = () => { r.remove(); if (opener?.isConnected) opener.focus?.({ preventScroll: true }); mountAll(); };
  if (quick || reducedMotion()) done(); else { r.classList.remove('on'); setTimeout(done, 200); }
}

// ------------------------------------------------------------------ where it appears
/** The drawer section: how many questions are open for this building and the button that opens the draft. */
function mountDrawer() {
  const dw = $('drawer'), id = S.sel; if (!dw || !id || !doc) return;
  dw.querySelector('#dOffice')?.remove();
  const L = byId(id), key = L && keyOf(L); if (!key) return;
  const { units, open: n, done } = scopeOf(key, id), own = entries[id] ? openIn(entries[id]) : 0, name = M.buildingUnits(entries, key)[0].building;
  if (!n && !done) return;
  const parts = [own ? `${own} for this home` : '', n - own ? `${n - own} for your other homes at ${esc(name)}` : ''].filter(Boolean).join(' and ');
  const sec = document.createElement('div');
  sec.className = 'd-sec of-sec-d'; sec.id = 'dOffice';
  sec.innerHTML = `<h3>Questions for the leasing office <span>${n} open</span></h3>
    <p class="of-lead">${n ? `${parts}, worded for you to send. Pick what to ask, then copy it or open it in your mail app.` : `Everything open at ${esc(name)} has an answer on file.`}</p>
    <button type="button" class="btn ${n ? 'primary ' : ''}of-open" data-office-unit="${esc(id)}">${MAIL}${n ? `Draft questions for ${esc(name)}` : 'Review the answers'}</button>
    ${done ? `<p class="faint of-hint">${done} answered and kept in your notes.</p>` : ''}`;
  const anchor = dw.querySelector('#dVisit') || [...dw.querySelectorAll('.d-sec')].at(-1);
  if (anchor && anchor.id === 'dVisit') anchor.before(sec); else if (anchor) anchor.after(sec); else dw.querySelector('.d-scroll')?.append(sec);
}
/** Buildings in the Shortlist (grouped by building): a small button on each building row. */
function mountRows() {
  const tb = $('table')?.tBodies?.[0]; if (!tb || !doc) return;
  for (const tr of tb.querySelectorAll('tr.group[data-id]')) {
    if (tr.querySelector('.of-chip')) continue;
    const L = byId(tr.dataset.id), key = L && keyOf(L), n = key ? scopeOf(key).open : 0, host = tr.querySelector('.sub');
    if (!host || !n) continue;
    host.insertAdjacentHTML('beforeend', `<button type="button" class="of-chip" tabindex="-1" data-office-unit="${esc(tr.dataset.id)}" title="Draft the questions to ask this building's leasing office (${n} open)" aria-label="Questions for the leasing office at ${esc(L.building || L.address)}, ${n} open">${MAIL}${n}</button>`);
  }
}
/** The Records report names one building: a button beside Print. */
function mountRecords() {
  const head = document.querySelector('#rec .rec-head'); if (!head || head.querySelector('.of-rec') || !doc) return;
  const id = decodeURIComponent((location.hash.match(/^#research\/records\/([^/?#]+)/) || [])[1] || ''), L = byId(id), key = L && keyOf(L);
  if (!key || !scopeOf(key, id).open) return;
  const print = head.querySelector('[data-print]');
  print?.insertAdjacentHTML('beforebegin', `<button class="btn ghost rec-noprint of-rec" type="button" data-office-unit="${esc(id)}">${MAIL}Questions for the leasing office</button>`);
}
function mountAll() { mountDrawer(); mountRows(); mountRecords(); }

export async function init() {
  if (started) return;
  started = true;
  loadAnswers();
  if (!(await loadDoc())) return;
  reloaders.office = () => { loadAnswers(); refreshLists(true); };   // the sync layer wrote the answers
  document.addEventListener('click', (e) => {   // capture: a building row would otherwise toggle open under the click
    const b = e.target.closest?.('[data-office-unit]'); if (!b || root?.contains(b)) return;
    e.preventDefault(); e.stopPropagation();
    openFor(b.dataset.officeUnit);
  }, true);
  on('select', ({ id } = {}) => { if (id) queueMicrotask(mountDrawer); });
  on('saved', () => queueMicrotask(mountAll));
  const table = $('view-list'); if (table) watch(table, mountRows, { subtree: true });
  const rec = $('view-records'); if (rec) watch(rec, mountRecords, { subtree: true });
  addEventListener('hashchange', () => setTimeout(mountRecords, 0));
  mountAll();
  const want = new URLSearchParams(location.search).get('office');   // ?office=<listing id> opens a draft (used by links and tests)
  if (want && byId(want)) openFor(want);
}
