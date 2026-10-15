// New-search wizard: a step-by-step dialog that sets every criterion (places, money, home, amenities, building and
// interior taste, weights) with manual controls, validates each field inline, keeps a draft in localStorage, and ends in a
// review with a diff against the open search, the criteria.yaml, and what to do with it:
//   - served by `apartmentscout serve`: create the search folder or save criteria.yaml (backup kept), then re-score;
//   - anywhere else (GitHub Pages, a standalone file): download or copy the file and the CLI commands, or apply it as a
//     browser preview on the data that is loaded.
// The wizard reads the same questions as config/intake.yaml; pure logic lives in wizard-model.js, markup in wizard-steps.js.
import { S, store, applyCriteria, download } from './app.js';
import { $, toast } from './util.js';
import { validateProfile } from './criteria.js';
import * as M from './wizard-model.js';
import * as API from './local-api.js';
import { RENDER, I } from './wizard-steps.js';

const ORDER = [...M.STEPS.map((s) => s.id), 'review'];
const TITLES = Object.fromEntries([...M.STEPS, M.REVIEW].map((s) => [s.id, s.title]));
const clone = (o) => JSON.parse(JSON.stringify(o));
const NUMERIC = new Set(['lat', 'lon', 'max_minutes', 'weight']);

let W = null, root = null, lastFocus = null, saveTimer = 0, savedTimer = 0, hideTimer = 0, lastAddrIndex = 0;

// ------------------------------------------------------------------ opening
const draftKey = (mode) => `wizard:${mode}${mode === 'edit' ? ':' + (S.crit0.search?.name || '') : ''}`;
const toCity = (c) => ({ ...(M.CITIES.find((x) => x.id === c.id) || { center: null, zoom: 12.5, note: `City profile ${c.id}` }), ...c, feeds: c.feeds || [] });

/** Open the wizard. mode "new" starts a search (a saved draft is resumed); "edit" edits every criterion of the open search. */
export async function openWizard({ mode = 'new', step = 0, fresh = false } = {}) {
  if (mode === 'edit' && !S.crit0.search) mode = 'new';
  const api = await API.getSession();
  const ctx = M.contextOf(S.crit0, api?.cities?.map(toCity));
  const saved = fresh ? null : store.get(draftKey(mode), null);
  let draft, resumed = false;
  if (mode === 'edit') draft = M.draftFromCriteria(S.crit0, ctx);
  else {
    const cur = S.crit0.search?.city, known = ctx.cities.some((c) => c.id === cur);
    draft = M.blankDraft(ctx, { city: known ? cur : 'generic' });
    if (S.crit0.search?.map_center && known) draft.map_center = [...S.crit0.search.map_center];
  }
  const base = JSON.stringify(draft);   // what an untouched wizard holds; a draft equal to it is not worth keeping
  if (saved?.draft && saved.v === 1) { draft = Object.assign(draft, saved.draft); resumed = true; step = step || saved.step || 0; }
  W = { mode, draft, base, step: Math.min(step, ORDER.length - 1), reached: saved?.reached || 0, touched: new Set(), attempted: new Set(), api, ctx, result: null, busy: false, resumed, serverErrors: [] };
  W.reached = Math.max(W.reached, W.step);
  lastFocus = document.activeElement;
  document.body.classList.remove('rail-open');
  if (!root) build();
  clearTimeout(hideTimer);   // a close still fading out must not hide the dialog we are opening now
  root.hidden = false; root.classList.remove('picking');
  render();
  requestAnimationFrame(() => { root.classList.add('on'); focusStep(); });
}

function build() {
  root = document.createElement('div');
  root.className = 'wz-scrim'; root.id = 'wizard';
  root.addEventListener('mousedown', (e) => { if (e.target === root) close(); });
  root.addEventListener('keydown', onKey, true);
  root.addEventListener('click', onClick);
  root.addEventListener('input', onInput);
  root.addEventListener('change', onChange);
  document.body.append(root);
}
export function closeWizard() { close(); }
function close() {
  if (!root || root.hidden) return;
  flushSave();
  root.classList.remove('on');
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => { if (!root.classList.contains('on')) root.hidden = true; }, 200);
  lastFocus?.focus?.();
  if (W && !W.result && isDirty()) toast('Draft saved. Open New search to continue where you left off.');
}
const isDirty = () => JSON.stringify(W.draft) !== W.base;

// ------------------------------------------------------------------ derived
const stepId = () => ORDER[W.step];
const errs = () => M.validateDraft(W.draft, W.ctx, { needFolder: W.mode === 'new' && !!W.api && W.step === ORDER.length - 1, existing: (W.api?.searches || []).map((s) => s.folder) });
function msgFor(all, code) {
  const e = all.find((x) => x.field === code);
  return e && (W.touched.has(code) || W.attempted.has(e.step) || e.step === 'review') ? e.msg : '';
}
const errCode = (c) => c.replace(/^unit\./, '').replace(/^map\.(lat|lon)$/, 'map_center');
const slug = () => W.draft.folder || M.slugify(W.draft.name);
const fileName = () => `criteria-${M.slugify(W.draft.name)}.yaml`;
const canPreview = () => S.listings.length > 0 && (W.mode === 'edit' || W.draft.city === S.crit0.search?.city);

function reviewModel(all) {
  const d = W.draft, d2 = { ...d, folder: slug() }, file = `~/Downloads/${fileName()}`;
  const edit = W.mode === 'edit', path = edit ? W.api?.search?.path || 'searches/<folder>' : undefined;
  const cmds = edit ? { ...M.editCommands(path, file) } : M.cliCommands(d2, { file });
  return { errors: all, diff: S.crit0.search ? M.diffAgainst(S.crit0, d, W.ctx) : null, yaml: M.toCriteriaYAML(d, W.ctx, edit ? 'Saved from the dashboard\'s New search wizard' : undefined),
    cmds, api: W.api, result: W.result, folder: slug(), server: W.serverErrors };
}

// ------------------------------------------------------------------ rendering
function render({ keepScroll = true } = {}) {
  const all = errs(), id = stepId(), last = W.step === ORDER.length - 1;
  const main = root.querySelector('.wz-main'), y = keepScroll && main ? main.scrollTop : 0;
  const key = focusKey();
  const X = { ctx: W.ctx, api: W.api, msg: (c) => msgFor(all, c), review: id === 'review' ? reviewModel(all) : null, currentName: S.crit0.search?.name };
  const visibleErrors = all.filter((e) => e.step !== 'review');
  root.innerHTML = `<div class="wz" role="dialog" aria-modal="true" aria-labelledby="wzTitle">
    <header class="wz-h"><div class="wz-t"><span class="wz-eyebrow">${W.mode === 'edit' ? 'Edit search' : 'New search'}</span><h2 id="wzTitle">${W.mode === 'edit' ? esc2(S.crit0.search?.name || 'Your search') : 'Start a search'}</h2></div>
      <span class="wz-saved" id="wzSaved" aria-live="polite"></span>
      <button type="button" class="icon-btn wz-x" data-act="close" aria-label="Close the wizard (Esc)">${I.x}</button></header>
    <div class="wz-pips" role="presentation"><b>Step ${W.step + 1} of ${ORDER.length}</b><span>${TITLES[id]}</span><div>${ORDER.map((s, i) => `<i class="${i < W.step ? 'done' : i === W.step ? 'on' : ''}"></i>`).join('')}</div></div>
    <div class="wz-b"><nav class="wz-steps" aria-label="Steps"><ol>${ORDER.map((s, i) => railItem(s, i, all)).join('')}</ol>
        <p class="wz-side">${W.api ? 'Served by <code>apartmentscout serve</code>: this page can save for you.' : 'This page cannot write files, so you will download or copy the result.'}</p></nav>
      <div class="wz-main" id="wzMain" tabindex="-1">${W.resumed && W.step === 0 && W.mode === 'new' && !W.result ? `<div class="wz-note" role="status"><span>Picked up your unfinished draft.</span><button type="button" class="wz-link" data-act="fresh">Start over</button></div>` : ''}${RENDER[id](W, X)}</div></div>
    <footer class="wz-f">${footer(last, visibleErrors)}</footer></div>`;
  const m = root.querySelector('.wz-main'); if (m) m.scrollTop = y;
  if (key) refocus(key);
}
const esc2 = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function railItem(id, i, all) {
  const cur = i === W.step, visited = i < W.reached || cur || i <= W.reached, bad = visited && !cur && all.some((e) => e.step === id) && id !== 'review';
  const done = i < W.reached && !bad && id !== 'review' && !cur;
  const sum = id === 'review' ? reviewSummary(all) : M.stepSummary(id, W.draft, W.ctx);
  return `<li><button type="button" class="wz-st ${cur ? 'on' : ''} ${done ? 'done' : ''} ${bad ? 'bad' : ''}" data-goto="${id}" ${cur ? 'aria-current="step"' : ''}>
    <span class="no" aria-hidden="true">${done ? I.check : bad ? '!' : i + 1}</span><span class="tx"><b>${TITLES[id]}</b><small data-sum="${id}">${esc2(sum)}</small></span></button></li>`;
}
const reviewSummary = (all) => (W.reached < ORDER.length - 1 ? 'Check and save' : all.length ? `${all.length} to fix` : 'Ready');
function footer(last, visibleErrors) {
  const back = W.step > 0 ? `<button type="button" class="btn" data-act="back">${I.left}Back</button>` : `<button type="button" class="btn ghost" data-act="close">Cancel</button>`;
  if (!last) return `${back}<span class="wz-fnote">Draft saved in this browser</span><button type="button" class="btn primary" data-act="next">${TITLES[ORDER[W.step + 1]]}${I.right}</button>`;
  const r = W.result, api = W.api;
  let primary;
  if (r?.kind === 'created') primary = `<button type="button" class="btn primary" data-act="open-new">Open this search${I.right}</button>`;
  else if (r?.kind === 'saved') primary = r.job?.state === 'done' ? `<button type="button" class="btn primary" data-act="reload">${I.check}Show new ranking</button>`
    : S.listings.length ? `<button type="button" class="btn primary" data-act="rescore" ${r.job?.state === 'running' ? 'disabled' : ''}>${r.job?.state === 'running' ? 'Re-scoring…' : 'Re-score now'}</button>` : `<button type="button" class="btn primary" data-act="close">Done</button>`;
  else if (api && W.mode === 'new') primary = `<button type="button" class="btn primary" data-act="create" ${W.busy ? 'disabled' : ''}>${W.busy ? 'Creating…' : 'Create search'}</button>`;
  else if (api && W.mode === 'edit' && api.can_save) primary = `<button type="button" class="btn primary" data-act="save" ${W.busy ? 'disabled' : ''}>${W.busy ? 'Saving…' : 'Save criteria.yaml'}</button>`;
  else primary = `<button type="button" class="btn primary" data-act="download">${I.dl}Download criteria.yaml</button>`;
  const second = [];
  if (!r) {
    if (primary.indexOf('data-act="download"') < 0) second.push(`<button type="button" class="btn" data-act="download">${I.dl}Download</button>`);
    second.push(`<button type="button" class="btn" data-copy="yaml">${I.copy}Copy YAML</button>`);
    if (canPreview()) second.push(`<button type="button" class="btn" data-act="preview" title="Re-evaluates the loaded listings in this browser. Files stay unchanged.">Apply as preview</button>`);
  }
  const note = W.mode === 'edit' && api && !api.can_save && !r ? `<span class="wz-fnote warn">${api.example ? 'This is a bundled example, so it is read-only.' : 'This search cannot be saved from here.'}</span>` : '';
  return `${back}<span class="wz-fseg">${second.join('')}</span>${note}${primary}`;
}

// ------------------------------------------------------------------ focus handling across re-renders
function focusKey() {
  const a = document.activeElement;
  if (!a || !root.contains(a)) return null;
  if (a.id) return `#${CSS.escape(a.id)}`;
  if (a.dataset.set) return `[data-set="${CSS.escape(a.dataset.set)}"][data-v="${CSS.escape(a.dataset.v)}"]`;
  if (a.dataset.taste) return `[data-taste="${a.dataset.taste}"][data-lv="${a.dataset.lv}"]`;
  if (a.dataset.city) return `[data-city="${CSS.escape(a.dataset.city)}"]`;
  if (a.dataset.preset) return `[data-preset="${CSS.escape(a.dataset.preset)}"]`;
  if (a.dataset.add) return `[data-add="${a.dataset.add}"]`;
  if (a.dataset.toggle) return `[data-toggle="${a.dataset.toggle}"]`;
  if (a.dataset.act) return `[data-act="${a.dataset.act}"]`;
  if (a.dataset.goto) return `[data-goto="${a.dataset.goto}"]`;
  return null;
}
function refocus(sel) { try { root.querySelector(sel)?.focus({ preventScroll: true }); } catch { /* selector no longer matches */ } }
function focusStep() { const h = root.querySelector('#wzStepTitle'); (h || root.querySelector('.wz-main'))?.focus({ preventScroll: true }); }
function focusFirstError() { const el = root.querySelector('.wz-main [aria-invalid="true"], .wz-field.bad input'); (el || root.querySelector('#wzStepTitle'))?.focus(); el?.scrollIntoView({ block: 'center', behavior: 'smooth' }); }

// ------------------------------------------------------------------ navigation
function go(i, { validate = true } = {}) {
  if (i === W.step) return;
  const all = errs();
  if (validate && i > W.step) {
    // forward: every step on the way must be clean
    for (let k = W.step; k < i; k++) {
      const id = ORDER[k];
      if (all.some((e) => e.step === id)) { W.attempted.add(id); W.step = k; render(); announce(`${TITLES[id]} needs attention`); focusFirstError(); return; }
    }
  }
  W.step = i; W.reached = Math.max(W.reached, i);
  render({ keepScroll: false });
  root.querySelector('.wz-main').scrollTop = 0;
  focusStep();
  announce(`Step ${i + 1} of ${ORDER.length}, ${TITLES[ORDER[i]]}`);
  scheduleSave();
}
function announce(t) { const s = $('wzSaved'); if (s) { s.textContent = t; s.classList.add('show'); clearTimeout(savedTimer); savedTimer = setTimeout(() => s.classList.remove('show'), 1800); } }

// ------------------------------------------------------------------ draft persistence
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 350);
}
function flushSave() {
  clearTimeout(saveTimer);
  if (!W || W.result?.kind === 'created') return;
  if (!isDirty()) { store.set(draftKey(W.mode), null); return; }
  store.set(draftKey(W.mode), { v: 1, draft: W.draft, step: W.step, reached: W.reached, at: Date.now() });
  const s = $('wzSaved'); if (s && W.step < ORDER.length) { s.textContent = 'Draft saved'; s.classList.add('show'); clearTimeout(savedTimer); savedTimer = setTimeout(() => s.classList.remove('show'), 1400); }
}
function clearDraft() { store.set(draftKey(W.mode), null); }

// ------------------------------------------------------------------ editing the draft
function setField(code, raw) {
  const d = W.draft; let m;
  if (code === 'name') d.name = raw;
  else if (code === 'city_name') {   // [onboarding] a city without a profile: the typed name decides the id
    d.city_name = raw; d.lookup = null;
    d.city = M.slugCity(raw) || 'generic';
  } else if ((m = code.match(/^feed\.(\d+)\.(name|url)$/))) { const f = d.feeds[+m[1]]; if (f) { f[m[2]] = raw; f.check = ''; } }
  else if (code === 'timezone') d.timezone = raw.trim();
  else if ((m = code.match(/^move_in\.(earliest|latest)$/))) d.move_in[m[1]] = raw;
  else if ((m = code.match(/^map\.(lat|lon)$/))) {
    const c = d.map_center ? [...d.map_center] : [null, null]; c[m[1] === 'lat' ? 0 : 1] = raw === '' ? null : Number.isFinite(+raw) ? +raw : NaN;
    d.map_center = c[0] == null && c[1] == null ? null : c;
  } else if ((m = code.match(/^dest\.(\d+)\.(\w+)$/))) { const p = d.destinations[+m[1]]; if (p) p[m[2]] = NUMERIC.has(m[2]) ? (raw === '' ? null : +raw) : raw; }
  else if ((m = code.match(/^tier\.(\d+)\.(name|max)$/))) { const t = d.budget.tiers[+m[1]]; if (t) t[m[2]] = m[2] === 'max' ? (raw === '' ? '' : +raw) : raw; }
  else if (code === 'hard_max') d.budget.hard_max = raw === '' ? null : +raw;
  else if ((m = code.match(/^unit\.(\w+)$/))) d.unit[m[1]] = raw === '' ? '' : +raw;
  else if ((m = code.match(/^rating\.(\d+)\.name$/))) { const r = d.building_ratings[+m[1]]; if (r) r.name = raw; }
  else if (code === 'folder') d.folder = raw.trim().toLowerCase();
}
function setChoice(path, v) {
  const d = W.draft; let m;
  const val = /^-?\d+(\.\d+)?$/.test(v) && !/\.(mode)$/.test(path) && path !== 'budget.basis' ? +v : v;
  if (path.startsWith('am:')) {
    const k = path.slice(3);
    for (const g of ['must_have', 'strongly_prefer', 'nice_to_have']) d[g] = d[g].filter((x) => x !== k);
    if (v !== 'off') d[v].push(k);
  } else if (path === 'budget.basis') d.budget.basis = v;
  else if (path === 'unit.min_beds') d.unit.min_beds = val;
  else if ((m = path.match(/^dest\.(\d+)\.(weight|mode)$/))) d.destinations[+m[1]][m[2]] = m[2] === 'weight' ? +val : v;
  else if ((m = path.match(/^rating\.(\d+)\.rating$/))) d.building_ratings[+m[1]].rating = +val;
}
function refreshInline() {
  const all = errs(), main = root.querySelector('.wz-main');
  main.querySelectorAll('[data-err]').forEach((p) => {
    const msg = msgFor(all, p.dataset.err); p.textContent = msg;
    const f = p.closest('.wz-field'); f?.classList.toggle('bad', !!msg);
    const input = f ? f.querySelector('input, select') : p.previousElementSibling;
    input?.toggleAttribute?.('aria-invalid', !!msg); if (!msg) input?.removeAttribute?.('aria-invalid'); else input?.setAttribute?.('aria-invalid', 'true');
  });
  root.querySelectorAll('[data-sum]').forEach((s) => { const id = s.dataset.sum; s.textContent = id === 'review' ? reviewSummary(all) : M.stepSummary(id, W.draft, W.ctx); });
  root.querySelectorAll('.wz-st').forEach((b) => {
    const id = b.dataset.goto, i = ORDER.indexOf(id), bad = i <= W.reached && i !== W.step && id !== 'review' && all.some((e) => e.step === id);
    b.classList.toggle('bad', bad); b.querySelector('.no').innerHTML = bad ? '!' : b.classList.contains('done') ? I.check : String(i + 1);
  });
}
function shareRefresh() {
  const sh = M.weightShares(W.draft.weights, W.ctx);
  root.querySelectorAll('[data-share]').forEach((b) => { b.textContent = `${sh[b.dataset.share]}%`; });
  root.querySelectorAll('[data-w]').forEach((r) => { const k = r.dataset.w; r.style.setProperty('--p', `${((+W.draft.weights[k] || 0) / M.WEIGHT_MAX) * 100}%`); r.setAttribute('aria-valuetext', `${+W.draft.weights[k] || 0}, ${sh[k]} percent`); });
  const bar = root.querySelector('.wz-share');
  if (bar) { const order = W.ctx.dims.map(([k]) => k).sort((a, b) => sh[b] - sh[a]); bar.innerHTML = order.filter((k) => sh[k]).map((k, i) => `<i style="flex:${sh[k]};opacity:${Math.max(0.28, 1 - i * 0.13)}"></i>`).join(''); }
}

// ------------------------------------------------------------------ events
function onInput(e) {
  const t = e.target;
  if (t.dataset.w) { W.draft.weights[t.dataset.w] = +t.value; shareRefresh(); refreshInline(); scheduleSave(); return; }
  const code = t.dataset.f;
  if (!code) return;
  setField(code, t.value);
  W.touched.add(errCode(code));
  W.touched.add(code);
  refreshInline(); scheduleSave();
}
function onChange(e) {
  const t = e.target;
  if (t.dataset.w) { render(); return; }
  if (t.dataset.f?.startsWith('dest.') || t.dataset.f?.startsWith('tier.') || t.dataset.f?.startsWith('unit.')) { refreshInline(); }
}
function onKey(e) {
  if (e.key === 'Escape') { if (document.body.querySelector('.kbd-help')) return; e.stopPropagation(); close(); return; }
  if (e.key === 'Tab') {
    const f = [...root.querySelectorAll('button, [href], input, select, textarea, summary, [tabindex]:not([tabindex="-1"])')].filter((x) => !x.disabled && x.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && (document.activeElement === first || !root.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (document.activeElement === last || !root.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
    return;
  }
  const t = e.target;
  // arrow keys move through a radio group (roving tabindex)
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key) && t.getAttribute?.('role') === 'radio') {
    const group = [...t.closest('[role=radiogroup]').querySelectorAll('[role=radio]')], i = group.indexOf(t), n = group.length;
    const nx = group[(i + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? n - 1 : 1)) % n];
    e.preventDefault(); nx.focus(); nx.click(); return;
  }
  if (e.key === 'Enter' && !e.shiftKey && t.matches?.('input:not([type=range]):not([type=button])') && !t.closest('.wz-fill')) { e.preventDefault(); if (W.step < ORDER.length - 1) go(W.step + 1); return; }
  if (e.key === 'Enter' && t.closest?.('.wz-fill') && t.tagName === 'INPUT') { e.preventDefault(); t.closest('.wz-fill').querySelector('button')?.click(); return; }
  if ((e.key === ' ' || e.key === 'Enter') && t.dataset?.toggle) { e.preventDefault(); t.click(); }
}
function onClick(e) {
  const b = e.target.closest('button, [data-toggle], [data-copy]');
  if (!b || !root.contains(b)) return;
  const d = b.dataset, D = W.draft;
  if (d.act === 'findaddr') lastAddrIndex = +d.i;
  if (d.act) return act(d.act);
  if (d.goto) return go(ORDER.indexOf(d.goto));
  if (d.copy) return copy(d.copy);
  if (d.set) { setChoice(d.set, d.v); W.touched.add(d.set); scheduleSave(); render(); return; }
  if (d.city) { pickCity(d.city); return; }
  if (d.starter !== undefined) { const f = (D.lookup?.starter_feeds || []).filter((x) => !(D.feeds || []).some((y) => y.url === x.url))[+d.starter]; if (f) { D.feeds.push({ name: f.name, url: f.url, ...(f.mode ? { mode: f.mode } : {}) }); scheduleSave(); render(); } return; }
  if (d.place) { const p = M.PLACES.find((x) => x[0] === d.place); D.map_center = [p[1], p[2]]; D.timezone = p[3]; if (!D.name.trim()) D.name = `${p[0]} apartment search`; scheduleSave(); render(); return; }
  if (d.window) { const [a, c] = d.window.split(',').map(Number), t = M.todayISO(); D.move_in.earliest = M.addDays(t, a); D.move_in.latest = M.addDays(t, c); scheduleSave(); render(); return; }
  if (d.toggle) { D.move_in.hard = !D.move_in.hard; scheduleSave(); render(); return; }
  if (d.taste) { const v = +d.lv; D.taste[d.taste] = D.taste[d.taste] === v ? null : v; W.draft = M.applyTaste(D, W.ctx, [M.tasteDim(d.taste, W.ctx)]); scheduleSave(); render(); return; }
  if (d.preset) { W.draft = M.selectPreset(D, d.preset, W.ctx); scheduleSave(); render(); return; }
  if (d.size) { const [beds, a, c, g] = d.size.split(',').map(Number); D.unit = { min_beds: beds, sqft_floor: a, sqft_good: c, sqft_great: g }; scheduleSave(); render(); return; }
  if (d.fill) { fillTiers(); return; }
  if (d.add) { add(d.add); return; }
  if (d.del) { del(d.del, +d.i); return; }
  if (d.pick) { pickOnMap(d.pick, +d.i); return; }
  if (d.clearpin !== undefined) { const p = D.destinations[+d.clearpin]; p.lat = p.lon = null; scheduleSave(); render(); return; }
}
// [onboarding] look the typed city up (the local server asks OpenStreetMap) and fill the time zone, the map centre and the known feeds
async function findCity() {
  const D = W.draft, q = String(D.city_name || '').trim();
  if (!q) { toast('Type a city first'); $('f-city_name')?.focus(); return; }
  W.finding = 'city'; render();
  try {
    const r = await API.findCity(q);
    const prof = W.ctx.cities.find((c) => c.id === r.id && c.id !== 'generic');
    if (prof) { W.finding = null; D.lookup = null; D.city_name = ''; pickCity(prof.id); toast(`${prof.name} has a built-in profile`); return; }
    D.city = r.id; D.city_name = r.name; D.lookup = { name: r.name, timezone: r.timezone, osm: r.osm, missing: r.missing || [], starter_feeds: r.starter_feeds || [] };
    if (r.timezone) D.timezone = r.timezone;
    if (r.center) { D.map_center = [...r.center]; D.map_zoom = r.zoom || 12.5; }
    scheduleSave();
  } catch (e) { D.lookup = { error: e.message }; }
  W.finding = null; render();
}
async function findAddr(i) {
  const D = W.draft, p = D.destinations[i];
  if (!p || !String(p.address || '').trim()) { toast('Type the address first'); return; }
  W.finding = `dest.${i}`; render();
  try {
    const r = await API.findAddress(p.address, D.city_name || D.city);
    p.lat = r.lat; p.lon = r.lon; scheduleSave(); toast(`Found: ${r.label}`);
  } catch (e) { toast(e.message); }
  W.finding = null; render();
}
async function addFeed() {
  const D = W.draft, el = $('wzFeedUrl'), url = (el?.value || '').trim();
  if (!url) { toast('Paste the address of the GTFS zip first'); el?.focus(); return; }
  if (!/^(https?:\/\/\S+|[/~]\S*)$/i.test(url)) { toast('Use a web address (https://...) or the location of a zip on this computer'); return; }
  let check = '';
  if (W.api) {
    try {
      const r = await API.checkFeed(url);
      if (!r.ok) { toast(r.detail); return; }
      check = r.checked ? `${r.detail}${r.size_mb ? `, ${r.size_mb} MB` : ''}` : r.detail;
    } catch { /* unreachable: keep it as typed */ }
  }
  D.feeds.push({ name: M.feedName(url), url, check }); scheduleSave(); render();
}
function pickCity(id) {
  const D = W.draft, prev = W.ctx.cities.find((c) => c.id === D.city), c = W.ctx.cities.find((x) => x.id === id);
  if (!c) return;
  const custom = !prev;   // [onboarding] D.city is a city without a profile (typed by the renter), not one of the cards
  if (id === 'generic' && (custom || D.city === 'generic')) { scheduleSave(); render(); $('f-city_name')?.focus(); return; }   // "Another city" while already on one: keep it
  const same = (a, b) => a && b && Math.abs(a[0] - b[0]) < 1e-3 && Math.abs(a[1] - b[1]) < 1e-3;
  if (!D.timezone || D.timezone === prev?.timezone || custom) D.timezone = c.timezone || '';
  if (!D.map_center || same(D.map_center, prev?.center) || custom) { D.map_center = c.center ? [...c.center] : null; D.map_zoom = c.zoom || 12.5; }
  if (id !== 'generic') { D.city_name = ''; D.lookup = null; D.feeds = []; }
  D.city = id;
  scheduleSave(); render();
}
function add(what) {
  const D = W.draft;
  if (what === 'dest' && D.destinations.length < 4) { D.destinations.push(M.blankDest(D.destinations.length + 1)); render(); root.querySelector(`[data-dest="${D.destinations.length - 1}"] input`)?.focus(); }
  else if (what === 'tier' && D.budget.tiers.length < 4) { const last = D.budget.tiers.at(-1); D.budget.tiers.push({ name: `Tier ${D.budget.tiers.length + 1}`, max: (+last?.max || 3000) + 250 }); render(); }
  else if (what === 'rating') { D.building_ratings.push({ name: '', rating: 4 }); render(); const els = root.querySelectorAll('.wz-rate input'); els[els.length - 1]?.focus(); }
  else if (what === 'amenity') {
    const el = $('wzCustomAm'), k = (el?.value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    if (!k) { toast('Type a key like rooftop_pool'); return; }
    if ([...D.must_have, ...D.strongly_prefer, ...D.nice_to_have].includes(k) || M.AMENITIES.some((a) => a.key === k)) { toast('That amenity is already in the list'); return; }
    D.nice_to_have.push(k); render();
  }
  scheduleSave();
}
function del(what, i) {
  const D = W.draft;
  if (what === 'dest') D.destinations.splice(i, 1);
  else if (what === 'feed') D.feeds.splice(i, 1);
  else if (what === 'tier') D.budget.tiers.splice(i, 1);
  else if (what === 'rating') D.building_ratings.splice(i, 1);
  scheduleSave(); render();
}
function fillTiers() {
  const v = +$('wzTarget')?.value;
  if (!(v > 0)) { toast('Enter a target monthly rent first'); $('wzTarget')?.focus(); return; }
  Object.assign(W.draft.budget, M.tiersFromTarget(v)); scheduleSave(); render();
}

// ------------------------------------------------------------------ the map
async function pickOnMap(what, i) {
  const D = W.draft, p = what === 'dest' ? D.destinations[i] : null;
  root.classList.add('picking'); document.body.classList.add('wz-picking');
  if (S.view !== 'map') location.hash = '#map';
  try {
    const m = await import('./map.js');
    await m.show?.();
    // a new search is usually in another city than the data on screen: look where the search is
    const spot = p && p.lat != null ? [p.lat, p.lon] : D.map_center || (D.destinations.find((x) => x.lat != null) ? [D.destinations.find((x) => x.lat != null).lat, D.destinations.find((x) => x.lat != null).lon] : null);
    if (spot && window.__asMap) window.__asMap.jumpTo({ center: [spot[1], spot[0]], zoom: Math.max(window.__asMap.getZoom(), D.map_zoom || 12.5) });
    const pt = await m.pickPoint(p ? (p.name || 'the destination') : 'the map centre');
    if (pt) {
      if (p) { p.lat = +pt.lat.toFixed(6); p.lon = +pt.lon.toFixed(6); } else { D.map_center = [+pt.lat.toFixed(5), +pt.lon.toFixed(5)]; W.touched.add('map_center'); }
      scheduleSave();
    }
  } catch { toast('The map could not load, so type the coordinates instead'); }
  root.classList.remove('picking'); document.body.classList.remove('wz-picking');
  render();
  root.querySelector(p ? `[data-dest="${i}"] .wz-pin` : '#f-map_center')?.scrollIntoView({ block: 'center' });
}

// ------------------------------------------------------------------ actions
async function act(a) {
  if (a === 'close') return close();
  if (a === 'back') return go(W.step - 1, { validate: false });
  if (a === 'next') return go(W.step + 1);
  if (a === 'fresh') { clearDraft(); const mode = W.mode; W = null; return openWizard({ mode, fresh: true }); }
  if (a === 'download') { if (blocked()) return; download(fileName(), M.toCriteriaYAML(W.draft, W.ctx), 'text/yaml'); toast(`Saved ${fileName()}: the commands below put it in place`); return; }
  if (a === 'preview') return preview();
  if (a === 'create') return create();
  if (a === 'save') return save();
  if (a === 'rescore') return rescore();
  if (a === 'reload') { location.reload(); return; }
  if (a === 'open-new') return openNew();
  if (a === 'findcity') return findCity();
  if (a === 'addfeed') return addFeed();
  if (a === 'findaddr') return findAddr(lastAddrIndex);
}
const blocked = () => {
  const all = errs();
  if (!all.length) return false;
  W.attempted.add('review'); const first = all[0]; for (const e of all) W.attempted.add(e.step);
  render(); announce(`${all.length} thing${all.length === 1 ? '' : 's'} to fix`); root.querySelector('.wz-note.bad')?.scrollIntoView({ block: 'center' });
  return !!first;
};
function preview() {
  if (blocked()) return;
  const profile = M.draftToProfile(W.draft), bad = validateProfile(profile);
  if (bad.length) { W.serverErrors = bad; toast(bad[0]); return; }
  S.weights = { ...S.weights, ...W.draft.weights }; store.set('weights', S.weights); S.preset = W.draft.preset; store.set('preset', S.preset);
  applyCriteria(clone(profile));
  close();
}
async function copy(what) {
  const d = W.draft, r = W.result, all = errs();
  const cmds = W.mode === 'edit' ? M.editCommands(W.api?.search?.path || 'searches/<folder>', `~/Downloads/${fileName()}`) : M.cliCommands({ ...d, folder: slug() }, { file: `~/Downloads/${fileName()}` });
  const text = what === 'yaml' ? M.toCriteriaYAML(d, W.ctx) : what === 'cli1' ? [...cmds.oneStep, ...cmds.then].join('\n') : what === 'cli2' ? [...cmds.twoStep, ...cmds.steps].join('\n') : (r?.next || []).join('\n');
  if (what === 'yaml' && all.length) { blocked(); return; }
  try { await navigator.clipboard.writeText(text); } catch {
    const ta = Object.assign(document.createElement('textarea'), { value: text, style: 'position:fixed;opacity:0' }); document.body.append(ta); ta.select();
    try { document.execCommand('copy'); } catch { toast('Copy is blocked in this browser; select the text and copy by hand'); ta.remove(); return; } ta.remove();
  }
  toast(what === 'yaml' ? 'criteria.yaml copied' : 'Commands copied');
}
async function create() {
  if (blocked()) return;
  W.busy = true; W.serverErrors = []; render();
  try {
    const folder = slug(), r = await API.createSearch(folder, M.toCriteriaYAML(W.draft, W.ctx), W.draft.city);
    W.result = { kind: 'created', path: r.path, folder: r.folder, next: r.next, warnings: r.warnings };
    clearDraft(); await API.getSession(true);
  } catch (e) { W.serverErrors = e.errors?.length ? e.errors : [e.message]; toast(e.message); W.result = null; W.apiError = e.message; }
  W.busy = false; render(); root.querySelector('.wz-main').scrollTop = 0;
  if (!W.result) root.querySelector('.wz-note.bad')?.scrollIntoView?.({ block: 'center' });
}
async function save() {
  if (blocked()) return;
  W.busy = true; render();
  try {
    const r = await API.saveCriteria(M.toCriteriaYAML(W.draft, W.ctx, 'Saved from the dashboard\'s wizard'));
    W.result = { kind: 'saved', backup: r.backup, next: r.next, warnings: r.warnings, job: null };
    clearDraft();
  } catch (e) { toast(e.message); W.serverErrors = e.errors?.length ? e.errors : [e.message]; }
  W.busy = false; render(); root.querySelector('.wz-main').scrollTop = 0;
}
async function rescore() {
  const r = W.result; if (!r) return;
  try {
    const { job: id } = await API.startRescore();
    r.job = { id, state: 'running', steps: [{ name: 'Score every listing', state: 'running' }, { name: 'Rebuild the dashboard data', state: 'waiting' }], seconds: 0 };
    render();
    const j = await API.waitForJob(id, (x) => { r.job = x; render(); });
    r.job = j; render();
    if (j.state === 'done') toast('Re-scored. Reload to see the new ranking.');
  } catch (e) { r.job = { state: 'error', error: e.message, steps: r.job?.steps || [], seconds: 0 }; render(); }
}
async function openNew() {
  const r = W.result; if (!r) return;
  try { await API.activate(r.folder); location.href = location.pathname + '#map'; location.reload(); } catch (e) { toast(e.message); }
}
