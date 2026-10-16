// Make a report: the decision report for two to four homes, from Compare, the Shortlist, the menu or the command palette. A side sheet
// lets the renter choose the homes and what goes in (their notes, their visit photos, a 3D view from each window, the paper size), then
// builds one self-contained HTML document from dashboard/report/report.html and opens it in a new tab, where Print gives the PDF, or
// downloads it. Nothing is uploaded; the renter's notes and visit photos stay out unless ticked. The payload is built by report-model.js
// (pure); this file does what needs the page: the template, the font, thumbnails, the 3D stills and the sheet.
import { S, on, store, byId, download, isSaved, pick, score, loadJSON } from '../app.js';
import { $, esc, toast } from '../util.js';
import { thumb, name as nameHTML } from '../views/table-kit.js';
import { parseSchema, inlinePayload, inlineFonts, buildReport, fileName } from './report-model.js';
import { resolvePhotos } from './share.js';
import { captureStills } from './report-stills.js';

const X = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>';
export const ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4 1.8h5.6l2.9 2.9v9.5H4zM9.6 1.8v3h3M6 8h4.5M6 10.5h4.5M6 5.5h1.6"/></svg>';
const MAX = 4, TIER_ORDER = ['S', 'A', 'B', 'C'];
const LABELS = { compare: 'In Compare', saved: 'Saved', top: 'Top ranked' };

let tpl = null, fontCss = null, root = null, st = null, inerted = [], busy = false;
const optKey = 'report-opts';
const defaults = () => ({ notes: false, tourPhotos: false, stills: true, photos: true, paper: 'letter' });
const opts = () => { const v = store.get(optKey, null); return { ...defaults(), ...(v && typeof v === 'object' ? v : {}) }; };
const setOpt = (k, v) => store.set(optKey, { ...opts(), [k]: v });

// ------------------------------------------------------------------ the pieces of the document
async function template() {
  if (tpl) return tpl;
  const emb = window.__AS_DATA__?.['report/report.html'];
  if (typeof emb === 'string') return (tpl = emb);
  const r = await fetch(new URL('report/report.html', document.baseURI), { cache: 'no-cache' });
  if (!r.ok) throw new Error(`the report template did not load (${r.status})`);
  return (tpl = await r.text());
}
/** The Geist font as a ready @font-face rule, read from the page's own style sheets, so a saved report keeps the dashboard's typeface. */
async function geistCss() {
  if (fontCss != null) return fontCss;
  fontCss = '';
  try {
    for (const sheet of document.styleSheets) {
      let rules; try { rules = sheet.cssRules; } catch { continue; }
      for (const r of rules || []) {
        if (r.type !== CSSRule.FONT_FACE_RULE || !/^"?Geist"?$/.test(r.style.getPropertyValue('font-family').trim())) continue;
        const m = /url\(["']?([^"')]+)["']?\)/.exec(r.style.getPropertyValue('src'));
        if (!m) continue;
        let url = m[1];
        if (!url.startsWith('data:')) {
          const base = sheet.href || document.baseURI, res = await fetch(new URL(url, base));
          if (!res.ok) continue;
          const buf = new Uint8Array(await res.arrayBuffer());
          let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
          url = `data:font/woff2;base64,${btoa(bin)}`;
        }
        return (fontCss = `@font-face{font-family:"Geist";src:url("${url}") format("woff2");font-weight:100 900;font-style:normal;font-display:block}`);
      }
    }
  } catch (e) { console.warn('the report keeps the system font', e); }
  return fontCss;
}
async function plansFor(ids) {
  const have = new Set(S.manifest.plans || []), out = {};
  await Promise.all(ids.filter((id) => have.has(id)).map(async (id) => { const p = await loadJSON(`${S.base}/plans/${encodeURIComponent(id)}.json`, null); if (p) out[id] = p; }));
  return out;
}
async function questionsFor(ids) {
  try { const m = await import('./office.js'); return Object.fromEntries(ids.map((id) => [id, m.openQuestionsFor(id)])); } catch { return {}; }
}

/** The finished HTML for `ids` with the given options; `progress(text)` says what is being made. Exported for tests and the command palette. */
export async function buildHTML(ids, o = {}, progress = () => {}) {
  const op = { ...opts(), ...o };
  const text = await template(), schema = parseSchema(text), homes = ids.map(byId).filter(Boolean);
  progress('Photos');
  const ph = op.photos ? await resolvePhotos(homes, schema, 'embed') : { photos: {} };
  let extras = {};
  try { extras = await (await import('./tour-findings.js')).shareExtras(ids, { notes: op.notes, photos: op.tourPhotos, cfg: schema.tour_photos }); } catch (e) { console.warn('visit findings left out of the report', e); }
  const [plans, questions] = await Promise.all([plansFor(ids), questionsFor(ids)]);
  let stills = {};
  if (op.stills) {
    const withSite = ids.filter((id) => (S.manifest.sites || []).includes(id));
    stills = await captureStills(withSite, { date: op.stillDate, min: op.stillMin }, (a, b) => progress(`3D view ${a} of ${b}`));
  }
  progress('Typesetting');
  const payload = buildReport({ listings: S.listings, crit: S.crit, ids, picks: S.picks, weights: S.weights, includeNotes: op.notes, schema, photos: ph.photos, extras, plans, questions, stills, paper: op.paper,
    generated: new Date().toISOString().slice(0, 10) });
  const html = inlineFonts(inlinePayload(text, payload), await geistCss());
  return { html, n: payload.homes.length, stills: Object.keys(stills).length, kb: Math.round(html.length / 1024), payload };
}

// ------------------------------------------------------------------ choosing the homes
const tierRank = (id) => { const t = pick(id).tier; const i = TIER_ORDER.indexOf(t); return i < 0 ? 9 : i; };
function candidates() {
  const seen = new Set(), out = [];
  const add = (L, tag) => { if (!L || seen.has(L.id)) return; seen.add(L.id); out.push({ L, tag }); };
  for (const id of S.compare) add(byId(id), 'compare');
  const saved = S.listings.filter((L) => isSaved(L.id) && pick(L.id).tier !== 'Pass').sort((a, b) => tierRank(a.id) - tierRank(b.id) || (score(b) ?? -1) - (score(a) ?? -1));
  for (const L of saved) add(L, 'saved');
  for (const L of S.listings.filter((x) => x._rank).sort((a, b) => a._rank - b._rank).slice(0, 8)) add(L, 'top');
  return out.slice(0, 16);
}
/** What the sheet starts with: the Compare set when it holds two or more, else the best saved picks (tier, then score), else the top ranked. */
function startingIds(c) {
  if (S.compare.filter(byId).length >= 2) return S.compare.filter(byId).slice(0, MAX);
  const saved = c.filter((x) => x.tag === 'saved').slice(0, 3);
  return (saved.length >= 2 ? saved : c.slice(0, 3)).map((x) => x.L.id);
}

function homeRow(x) {
  const L = x.L, on = st.sel.has(L.id), full = st.sel.size >= MAX && !on;
  const m = L.score?.monthly_cost, sc = score(L);
  return `<label class="rp-home${on ? ' on' : ''}${full ? ' off' : ''}"><input type="checkbox" data-home="${esc(L.id)}" ${on ? 'checked' : ''} ${full ? 'disabled' : ''}>
    <span class="rp-th">${thumb(L, 56, 44)}</span><span class="rp-t"><b>${nameHTML(L)}</b><small>${esc([L.neighborhood, m != null ? `$${Math.round(m).toLocaleString('en-US')}/mo` : '', sc != null ? `fit ${Math.round(sc)}` : ''].filter(Boolean).join(' · '))}</small></span>
    <span class="rp-tag">${esc(LABELS[x.tag])}</span></label>`;
}
function optionsHTML() {
  const o = opts(), sites = [...st.sel].filter((id) => (S.manifest.sites || []).includes(id)).length;
  return `<label class="rp-o"><input type="checkbox" data-opt="stills" ${o.stills ? 'checked' : ''}><span><b>A 3D view from each window</b><small>${sites} of ${st.sel.size} selected have a site model. It takes a few seconds for each home, and nothing is uploaded.</small></span></label>
    <label class="rp-o"><input type="checkbox" data-opt="photos" ${o.photos ? 'checked' : ''}><span><b>Listing photos</b><small>One photo per home, embedded in the file.</small></span></label>
    <label class="rp-o"><input type="checkbox" data-opt="notes" ${o.notes ? 'checked' : ''}><span><b>My notes</b><small>Your pick notes and visit notes. Left out unless ticked; the report also has a switch to hide them again.</small></span></label>
    <label class="rp-o"><input type="checkbox" data-opt="tourPhotos" ${o.tourPhotos ? 'checked' : ''}><span><b>My visit photos</b><small>The photos you took on tours, as small thumbnails.</small></span></label>
    <label class="rp-o rp-sel"><span><b>Paper</b></span><select class="sel" data-opt="paper" aria-label="Paper size"><option value="letter" ${o.paper === 'letter' ? 'selected' : ''}>US Letter</option><option value="a4" ${o.paper === 'a4' ? 'selected' : ''}>A4</option></select></label>`;
}
function shell() {
  return `<div class="rp-scrim" data-close></div><section class="rp-panel"><header class="rp-h"><div><div class="rp-k">Decision report</div><h2 id="rpT" tabindex="-1">Make a report</h2>
      <p class="rp-sub">Two to four homes, typeset to print or save as a PDF: the recommendation and why, a side-by-side table, a page for each home and a checklist for the leasing office.</p></div><button type="button" class="rp-x" data-close aria-label="Close">${X}</button></header>
    <div class="rp-body"><section class="rp-sec"><h3>Homes <span id="rpCount"></span></h3><div id="rpHomes" class="rp-homes" role="group" aria-label="Homes to compare"></div></section>
      <section class="rp-sec"><h3>Include</h3><div id="rpOpts"></div><p class="rp-hint">Your notes and visit photos never leave this browser unless you tick them, and the file you make is yours to send or not. Nothing is sent from here.</p></section></div>
    <footer class="rp-bar"><span class="rp-status" id="rpStatus" role="status" aria-live="polite"></span><button type="button" class="btn" id="rpFile">Download HTML</button><button type="button" class="btn primary" id="rpOpen">Open report</button></footer></section>`;
}
function refresh() {
  $('rpHomes').innerHTML = st.cands.map(homeRow).join('');
  $('rpCount').textContent = `${st.sel.size} of ${MAX} chosen`;
  $('rpOpts').innerHTML = optionsHTML();
  const ok = st.sel.size >= 2 && st.sel.size <= MAX;
  for (const id of ['rpFile', 'rpOpen']) { const b = $(id); b.disabled = !ok || busy; b.title = ok ? '' : 'Choose two to four homes'; }
  if (!busy) $('rpStatus').textContent = ok ? '' : 'Choose two to four homes.';
}

// ------------------------------------------------------------------ making it
function status(t) { const el = $('rpStatus'); if (el) el.textContent = t; }
async function make(act) {
  if (busy || !st || st.sel.size < 2) return;
  busy = true; refresh();
  const ids = [...st.sel];
  let win = null;
  if (act === 'open') {   // opened now, while the click still counts: browsers block a tab opened after the wait
    try { win = window.open('', '_blank'); win?.document.write('<title>Making your report</title><body style="font:16px system-ui;margin:40px;color:#444">Making your report…'); } catch { win = null; }
  }
  try {
    const r = await buildHTML(ids, {}, status);
    const size = r.kb >= 1024 ? `${(r.kb / 1024).toFixed(1)} MB` : `${r.kb} KB`;
    if (act === 'open' && win) {
      const url = URL.createObjectURL(new Blob([r.html], { type: 'text/html' }));
      win.location.href = url;
      setTimeout(() => URL.revokeObjectURL(url), 300000);
      toast(`Report ready: ${r.n} homes, ${size}. Use Print and choose Save as PDF.`, 3800);
    } else {
      download(fileName(S.crit.search?.name, new Date().toISOString().slice(0, 10)), r.html, 'text/html');
      toast(`Report saved: ${r.n} homes, ${size}${r.stills ? `, ${r.stills} 3D view${r.stills === 1 ? '' : 's'}` : ''}.`, 3800);
      try { win?.close(); } catch { /* nothing to close */ }
    }
    close();
  } catch (e) {
    try { win?.close(); } catch { /* nothing to close */ }
    status(`Could not make the report: ${e?.message || e}`);
  } finally { busy = false; if (root) refresh(); }
}

// ------------------------------------------------------------------ the sheet
export const isOpen = () => !!root;
function onKey(e) {
  if (!root) return;
  if (e.key === 'Escape') { e.stopPropagation(); if (!busy) close(); return; }
  if (e.key !== 'Tab') return;
  const f = [...root.querySelectorAll('button:not([disabled]), input:not([disabled]), select')].filter((x) => x.offsetParent !== null);
  if (!f.length) return;
  const a = f.indexOf(document.activeElement);
  if (!root.contains(document.activeElement)) { e.preventDefault(); f[0].focus(); }
  else if (e.shiftKey && a <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && a === f.length - 1) { e.preventDefault(); f[0].focus(); }
}
export function open({ ids = null } = {}) {
  if (root) return;
  const c = candidates();
  if (!c.length) { toast('Star or compare a few homes first, then make a report'); return; }
  const want = (ids || startingIds(c)).filter(byId).slice(0, MAX);
  for (const id of want) if (!c.some((x) => x.L.id === id)) c.unshift({ L: byId(id), tag: 'compare' });
  st = { cands: c, sel: new Set(want) };
  root = document.createElement('div');
  root.className = 'rp'; root.id = 'reportSheet'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-labelledby', 'rpT');
  root.innerHTML = shell();
  document.body.append(root);
  inerted = [];
  for (const n of document.body.children) if (n !== root && !n.inert && !['SCRIPT', 'STYLE', 'LINK'].includes(n.tagName) && n.id !== 'toast') { n.inert = true; inerted.push(n); }
  root.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) { if (!busy) close(); return; }
    if (e.target.closest('#rpOpen')) make('open'); else if (e.target.closest('#rpFile')) make('file');
  });
  root.addEventListener('change', (e) => {
    const h = e.target.closest('[data-home]'), o = e.target.closest('[data-opt]');
    if (h) { if (h.checked && st.sel.size < MAX) st.sel.add(h.dataset.home); else st.sel.delete(h.dataset.home); refresh(); }
    else if (o) { setOpt(o.dataset.opt, o.type === 'checkbox' ? o.checked : o.value); if (o.dataset.opt === 'stills') refresh(); }
  });
  document.addEventListener('keydown', onKey, true);   // on the document: a redrawn list drops the focused row, and the key would never reach the sheet
  refresh();
  document.documentElement.classList.add('rp-open');
  requestAnimationFrame(() => { root?.classList.add('on'); $('rpT')?.focus({ preventScroll: true }); });
}
export function close() {
  if (!root) return;
  const r = root; root = null; st = null;
  document.removeEventListener('keydown', onKey, true);
  r.classList.remove('on');
  for (const n of inerted) n.inert = false;
  inerted = [];
  document.documentElement.classList.remove('rp-open');
  setTimeout(() => r.remove(), 260);
}

// ------------------------------------------------------------------ the buttons
function mountMenu() {
  const menu = $('appMenu'), after = $('mnMemo') || $('mnRestore');
  if (!menu || !after || menu.querySelector('#mnReport')) return;
  const b = document.createElement('button');
  b.type = 'button'; b.role = 'menuitem'; b.id = 'mnReport'; b.innerHTML = `${ICON}<span>Make a decision report</span>`;
  b.addEventListener('click', () => open());
  after.after(b);
}
export function init() {
  document.addEventListener('click', (e) => {
    const b = e.target.closest?.('[data-make-report]'); if (!b || root?.contains(b)) return;
    e.preventDefault(); e.stopPropagation();
    open({ ids: b.dataset.makeReport === 'compare' && S.compare.filter(byId).length >= 2 ? S.compare.filter(byId) : null });
  }, true);
  mountMenu();
  on('compare', () => { const b = $('cmpReport'); if (b) b.title = S.compare.length >= 2 ? `Make a report for the ${S.compare.length} homes in Compare` : 'Make a report: choose two to four homes'; });
  const want = new URLSearchParams(location.search).get('report');   // ?report=1 opens the sheet (used by links and tests)
  if (want) queueMicrotask(() => open());
}
