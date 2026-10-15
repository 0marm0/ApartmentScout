// Tour findings and decision history: the part that joins the pieces to the dashboard. It adds a "Visit" section to the
// listing drawer (the findings beside the listing's facts, labelled "observed on <date>", a one-click "Use as a fact", the
// renter's status, and the decision trail), a button on every Tours card, the visit sheet (tour-sheet.js), the scoring pass
// (a promoted fact is re-evaluated; an unpromoted contradiction is flagged), and what rides along in the picks backup and
// the shared page. The rules are in findings-model.js and decisions-model.js; this file only wires them.
import { S, on, byId, label, hooks, setPick, pick, applyCriteria, scoreDay, openDrawer } from '../app.js';
import { evaluate } from '../criteria.js';
import { $, esc, toast } from '../util.js';
import { watch } from './dom.js';
import * as FS from './findings-store.js';
import * as Trail from './decision-trail.js';
import * as Sheet from './tour-sheet.js';
import { overlay, livePromotions, flagsFor, annotateScore, assess, phrase, promote, unpromote, claimOf, progress, totalArea, fmtFeet, shareTour, CHECKS, CHECK_KEYS, LAUNDRY, SMELLS, normalize } from './findings-model.js';
import { trailForShare } from './decisions-model.js';

const FIELDS = ['amenities', 'sqft', 'size', 'sqft_basis', 'sqft_estimate', 'sqft_range', 'exposure', 'exposure_source'];
const touched = new Map();   // listing id -> its facts as published, kept while a promoted fact is applied to the listing in memory
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
let sig = '', started = false;

// ------------------------------------------------------------------ the listing as published, and with promoted facts
/** The listing with its own facts, whatever has been promoted (what "the listing says" means everywhere here). */
export function pristine(L) {
  const s = touched.get(L?.id);
  if (!s) return L;
  const o = { ...L };
  for (const k of FIELDS) if (k in s) o[k] = s[k]; else delete o[k];
  return o;
}
function applyFacts(L, f) {
  const live = f ? livePromotions(f) : {};
  if (!Object.keys(live).length) { restoreFacts(L); return false; }
  if (!touched.has(L.id)) touched.set(L.id, Object.fromEntries(FIELDS.filter((k) => k in L).map((k) => [k, clone(L[k])])));
  const v = overlay(pristine(L), f);
  for (const k of FIELDS) if (v[k] !== undefined) L[k] = v[k]; else delete L[k];
  return true;
}
function restoreFacts(L) {
  const s = touched.get(L.id); if (!s) return;
  for (const k of FIELDS) if (k in s) L[k] = clone(s[k]); else delete L[k];
  touched.delete(L.id);
}
/** Runs inside applyCriteria, before the ranking: promoted facts are scored (with the browser's re-evaluation), contradictions
 *  that were not promoted only get a gate, a tag and a reason line. */
function scorePass() {
  for (const L of S.listings) {
    const f = FS.get(L.id);
    if (!f) continue;
    const promoted = Object.keys(livePromotions(f)).length > 0;
    let sc = L.score;
    if (promoted && !S.preview) sc = evaluate(L, L._score0, S.crit, scoreDay()).score;
    L.score = annotateScore(sc, flagsFor(pristine(L), f));
  }
}
/** Put the visits' facts into the listings and re-rank, when anything that matters to scoring changed. */
function refresh() {
  let key = '';
  for (const L of S.listings) {
    const f = FS.get(L.id);
    if (!f && !touched.has(L.id)) continue;
    applyFacts(L, f);
    if (f) key += `${L.id}:${JSON.stringify([livePromotions(f), flagsFor(pristine(L), f).gates])};`;
  }
  if (key === sig) return;
  sig = key;
  applyCriteria(S.preview?.profile ?? null, { quiet: true });
}

// ------------------------------------------------------------------ words
const day = (iso) => { const d = new Date(String(iso).slice(0, 10) + 'T12:00:00'); return isNaN(d) ? iso : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); };
const labelOf = (list, v) => (list.find(([k]) => k === v) || [])[1] || v;
function facts(f) {
  const out = [], t = totalArea(f);
  if (f.rooms?.length) out.push(['Rooms', t ? `${t} ft² measured` : `${f.rooms.length} room${f.rooms.length === 1 ? '' : 's'}`, f.rooms.filter((r) => r.w && r.l).map((r) => `${r.name} ${fmtFeet(r.w)} × ${fmtFeet(r.l)}`).join(' · ')]);
  if (f.ceiling != null) out.push(['Ceiling', fmtFeet(f.ceiling)]);
  if (f.water != null) out.push(['Water pressure', `${f.water} of 5`]);
  if (f.noise) out.push(['Noise at the window', [f.noise.rating != null ? `${f.noise.rating} of 5` : null, f.noise.db != null ? `${f.noise.db} dB` : null].filter(Boolean).join(' · ')]);
  if (f.signal != null) out.push(['Cell signal', `${f.signal} bar${f.signal === 1 ? '' : 's'}`]);
  if (f.closets != null) out.push(['Closets', String(f.closets)]);
  if (f.laundry) out.push(['Laundry', labelOf(LAUNDRY, f.laundry)]);
  if (f.smells?.length) out.push(['Smells', f.smells.map((s) => labelOf(SMELLS, s)).join(', ')]);
  if (f.light) out.push(['Light', [f.light.rating != null ? `${f.light.rating} of 5` : null, f.light.time ? `at ${f.light.time}` : null, f.light.facing ? `window faces ${f.light.facing}` : null].filter(Boolean).join(' · ')]);
  if (f.view) out.push(['View', f.view]);
  return out;
}

// ------------------------------------------------------------------ drawer section
function checkRow(L, f, key) {
  const c = f.checks?.[key]; if (!c) return '';
  const a = assess(L, key, c), live = livePromotions(f), isLive = key in live, name = CHECKS[key].label;
  let line, cls = '';
  if (isLive) { line = `Used as a fact: <b>${esc(phrase(key, live[key]))}</b> <small>(the listing says ${esc(phrase(key, a.listed))})</small>`; cls = 'ok'; }
  else if (a.kind === 'contradicts') { line = `Found <b>${esc(phrase(key, a.observed))}</b>, the listing says ${esc(phrase(key, a.listed))}`; cls = 'bad'; }
  else if (a.kind === 'adds') { line = `Found <b>${esc(phrase(key, a.observed))}</b>, the listing is silent`; cls = 'warn'; }
  else if (a.kind === 'matches') { line = 'Matches the listing'; cls = 'ok'; }
  else line = 'Not sure';
  const act = isLive ? `<button type="button" class="btn sm" data-vf-unpromote="${key}">Undo</button>` : ['contradicts', 'adds'].includes(a.kind) ? `<button type="button" class="btn sm primary" data-vf-promote="${key}">Use as a fact</button>` : '';
  return `<li class="vf-chk ${cls}"><span class="n">${esc(name)}</span><span class="v">${line}</span>${act}</li>`;
}
export function sectionHTML(L) {
  const f = FS.get(L.id), pk = pick(L.id), p = f ? progress(f) : null, P = pristine(L);
  const g = facts(f || {});
  const cta = f ? `Open visit notes <small>${p.done} of ${p.total}</small>` : 'Start visit notes';
  const flagged = f && CHECK_KEYS.some((k) => assess(P, k, f.checks?.[k]).kind === 'contradicts' && !(k in livePromotions(f)));
  return `<div class="d-sec" id="dVisit" data-tab="Visit"><h3>Visit and decisions <span>${f?.observed ? 'observed on ' + esc(day(f.observed)) : 'this device'}</span></h3>
    ${f ? `<p class="vf-lead${flagged ? ' warn' : ''}">${flagged ? 'Something you found differs from the listing. It is flagged on the home and does not change its score until you use it as a fact.' : 'What you saw and measured. It sits beside the listing\'s facts and never replaces them.'}</p>` : '<p class="vf-lead">Measure rooms, test the water, listen at the window, check the listing\'s claims. Built for one hand on a phone.</p>'}
    <button type="button" class="btn vf-open ${f ? '' : 'primary'}" data-vf-open="${esc(L.id)}">${cta}</button>
    ${f ? `${g.length ? `<dl class="vf-grid">${g.map(([k, v, s]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}${s ? `<small>${esc(s)}</small>` : ''}</dd></div>`).join('')}</dl>` : ''}
      ${CHECK_KEYS.some((k) => f.checks?.[k]) ? `<ul class="vf-chks">${CHECK_KEYS.map((k) => checkRow(P, f, k)).join('')}</ul>` : ''}
      ${f.photos?.length ? `<div class="vf-ph" data-vf-photos="${esc(L.id)}">${f.photos.slice(0, 4).map((x) => `<button type="button" data-vf-open="${esc(L.id)}" aria-label="Open the visit notes, photo ${esc(x.caption || '')}"><img data-vf-img="${x.id}" alt="${esc(x.caption || 'Photo from the visit')}"></button>`).join('')}${f.photos.length > 4 ? `<span>+${f.photos.length - 4}</span>` : ''}</div>` : ''}
      ${f.note ? `<p class="vf-note">${esc(f.note.length > 220 ? f.note.slice(0, 219) + '…' : f.note)}</p>` : ''}` : ''}
    <div class="vf-dec"><label class="vf-status"><span>Your status</span><select id="dStatus" class="sel" aria-label="Your status for this home">${Trail.statusOptions(pk.status)}</select></label></div>
    <h4 class="vf-h4">Decision history</h4><div id="vfTrail">${Trail.trailHTML(L.id)}</div></div>`;
}
async function fillThumbs(scope) {
  const L = S.sel && byId(S.sel), f = L && FS.get(L.id); if (!f) return;
  for (const img of scope.querySelectorAll('img[data-vf-img]')) {
    const p = (f.photos || []).find((x) => x.id === img.dataset.vfImg); if (!p) continue;
    const u = await FS.photoUrl(L.id, p); if (u) img.src = u;
  }
}
function redrawSection() {
  const el = $('dVisit'), L = S.sel && byId(S.sel);
  if (!el || !L || el.querySelector('.tr-why input:focus')) return;
  const sc = document.querySelector('#drawer .d-scroll'), y = sc?.scrollTop;
  el.outerHTML = sectionHTML(L);
  if (sc && y != null) sc.scrollTop = y;
  fillThumbs($('dVisit'));
}

// ------------------------------------------------------------------ the sheet's controller
const controller = {
  listing: (id) => pristine(byId(id)),
  label: (id) => { const L = byId(id); return L ? label(L) : id; },
  promote: (id, key) => promoteFinding(id, key),
  unpromote: (id, key) => unpromoteFinding(id, key),
  closed: (id) => { if (S.sel === id) redrawSection(); },
};
export function openVisit(id) {
  if (!byId(id)) return;
  Sheet.open(id, controller);
}
function promoteFinding(id, key) {
  const L = byId(id), f = FS.get(id); if (!L || !f) return;
  const P = pristine(L), a = assess(P, key, f.checks?.[key]);
  if (!['contradicts', 'adds'].includes(a.kind)) return;
  const now = FS.nowZ();
  FS.update(id, (cur) => promote(P, cur, key, now));
  Trail.record({ home: id, kind: 'promote', from: a.listed == null ? null : phrase(key, a.listed), to: phrase(key, a.observed) }, now);
  toast(`Using “${phrase(key, a.observed)}” as a fact for ${label(L)}`, 6200, { label: 'Undo', run: () => unpromoteFinding(id, key, true) });
}
function unpromoteFinding(id, key, quiet = false) {
  const L = byId(id), f = FS.get(id); if (!L || !f?.promoted?.[key]) return;
  const P = pristine(L), v = f.promoted[key].value;
  FS.update(id, (cur) => unpromote(cur, key));
  Trail.record({ home: id, kind: 'unpromote', to: phrase(key, v) });
  if (!quiet) toast(`No longer using “${phrase(key, v)}” as a fact`, 4200);
}

// ------------------------------------------------------------------ Tours board
function mountBoard() {
  const V = $('view-tours'); if (!V) return;
  for (const card of V.querySelectorAll('.tc[data-id]')) {
    if (card.querySelector('.vf-tc')) continue;
    const id = card.dataset.id, f = FS.get(id), L = byId(id); if (!L) continue;
    const p = f ? progress(f) : null, P = pristine(L), bad = f ? CHECK_KEYS.filter((k) => assess(P, k, f.checks?.[k]).kind === 'contradicts' && !(k in livePromotions(f))) : [];
    const el = document.createElement('div');
    el.className = 'vf-tc';
    el.innerHTML = `<button type="button" class="btn sm ${f ? '' : 'ghost'}" data-vf-open="${esc(id)}">${f ? `Visit notes · ${p.done}/${p.total}` : 'Start visit notes'}</button>${bad.length ? `<span class="pill warn" title="Found different from the listing">Differs: ${bad.map((k) => esc(CHECKS[k].label.split(' ')[0].toLowerCase())).join(', ')}</span>` : ''}`;
    card.querySelector('.tc-acts')?.before(el);
  }
}

// ------------------------------------------------------------------ the shared page and the backup
/** Per home, what the share page and memo add: the visit (photos only when asked) and the decision trail. */
export async function shareExtras(ids, { notes = false, photos = false, cfg = null } = {}) {
  const C = { max_per_home: 4, thumb_px: 560, quality: 0.74, budget_kb: 600, ...(cfg || {}) };
  const out = {};
  for (const id of ids) {
    const L = byId(id), f = FS.get(id);
    const tour = L && f ? shareTour(pristine(L), f, { notes }) : null;
    if (tour && photos && f.photos?.length) {
      const got = []; let bytes = 0;
      for (const p of f.photos.slice(0, C.max_per_home)) {
        const blob = await FS.photoBlob(id, p); if (!blob) continue;
        const uri = await thumb(blob, C.thumb_px, C.quality); if (!uri || bytes + uri.length > C.budget_kb * 1024) continue;
        bytes += uri.length; got.push({ src: uri, ...(p.caption ? { caption: p.caption } : {}) });
      }
      if (got.length) tour.photos = got;
    }
    const trail = trailForShare(Trail.all(), id, { notes });
    if (tour || trail.length) out[id] = { ...(tour ? { tour } : {}), ...(trail.length ? { trail } : {}) };
  }
  return out;
}
async function thumb(blob, px, quality) {
  try {
    const bmp = await createImageBitmap(blob), k = Math.min(1, px / bmp.width), w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.drawImage(bmp, 0, 0, w, h); bmp.close?.();
    return c.toDataURL('image/jpeg', quality);
  } catch { return null; }
}
export const photoCount = (ids) => ids.reduce((n, id) => n + (FS.get(id)?.photos?.length || 0), 0);

// ------------------------------------------------------------------ start
export async function init() {
  if (started) return;
  started = true;
  Trail.init();
  hooks.drawer = (L) => sectionHTML(L);
  hooks.score = scorePass;
  hooks.exportExtra = () => {
    const findings = FS.exportRecords(), history = Trail.exportEntries();
    return { ...(Object.keys(findings).length ? { findings } : {}), ...(history.length ? { history } : {}) };
  };
  hooks.importExtra = (js) => {
    if (Array.isArray(js.history)) Trail.importEntries(js.history);
    if (js.findings && typeof js.findings === 'object') FS.importRecords(js.findings);
  };
  if (S.sel && !$('dVisit')) openDrawer(S.sel, { instant: true, noVT: true });   // opened by ?open= before this module loaded
  const dr = $('drawer');
  dr?.addEventListener('click', (e) => {
    const t = e.target.closest('[data-vf-open],[data-vf-promote],[data-vf-unpromote],[data-why]'); if (!t || !dr.contains(t) || !S.sel) return;
    if (t.dataset.vfOpen) openVisit(t.dataset.vfOpen);
    else if (t.dataset.vfPromote) promoteFinding(S.sel, t.dataset.vfPromote);
    else if (t.dataset.vfUnpromote) unpromoteFinding(S.sel, t.dataset.vfUnpromote);
    else if (t.dataset.why) Trail.askFor(t);
  });
  dr?.addEventListener('change', (e) => {
    if (e.target.id !== 'dStatus' || !S.sel) return;
    setPick(S.sel, { status: e.target.value || null, saved: true });
  });
  on('select', ({ id }) => { if (id) fillThumbs($('drawer')); });
  Trail.onChange(redrawSection);
  on('saved', () => { if (S.sel) queueMicrotask(redrawSection); mountBoard(); });
  await FS.init();
  FS.onChange((id) => { if (id === null || id === undefined || !Sheet.isOpen()) { /* a sync or import */ } refresh(); redrawSection(); mountBoard(); });
  const V = $('view-tours'); if (V) watch(V, mountBoard, { subtree: true });
  V?.addEventListener('click', (e) => { const b = e.target.closest('[data-vf-open]'); if (b && V.contains(b)) openVisit(b.dataset.vfOpen); });
  refresh();
  redrawSection(); mountBoard();
  fillThumbs($('drawer'));
  const want = new URLSearchParams(location.search).get('visit');
  if (want && byId(want)) openVisit(want);
}
export { FS, Trail, Sheet, claimOf, normalize };
