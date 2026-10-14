// Records view: a due-diligence report for one building, built from its public-records dossier
// (NYC built in; other cities via agent research notes) plus the listing and research notes.
import { S, byId, label, loadJSON, openDrawer } from './app.js';
import { $, esc, md, safeUrl, ICONS, ring, scoreColor } from './util.js';
import { buildModel, fmtDate, fmtMonth, SEV_LABEL, SEV_PILL, plural, num } from './records/model.js';
import { mountTimeline, hourChart, barList, noiseTypeBars, makeTip, bindTips } from './records/charts.js';
import { ledgers } from './records/ledgers.js';

const SRC_NAMES = { pluto: 'PLUTO tax lots', hpd_violations: 'HPD violations', hpd_complaints: 'HPD complaints', dob_complaints: 'DOB complaints', ecb_violations: 'ECB violations', dob_now_filings: 'DOB NOW filings', bedbugs: 'Bedbug filings', sr311: '311 requests', nypd_complaints: 'NYPD complaints', footprints: 'Building footprints' };
let current = null, token = 0;
const cache = new Map();

export function init() {
  document.getElementById('view-records').innerHTML = '<div class="view-pad"><div class="rec" id="rec"></div></div>';
  // print: open every collapsed ledger so the report is complete, then restore
  addEventListener('beforeprint', () => document.querySelectorAll('#view-records details:not([open])').forEach((d) => { d.dataset.wasClosed = '1'; d.open = true; }));
  addEventListener('afterprint', () => document.querySelectorAll('#view-records details[data-was-closed]').forEach((d) => { d.open = false; delete d.dataset.wasClosed; }));
  document.addEventListener('click', (e) => { if (!e.target.closest?.('.rec-pick')) closePicker(); });
  $('rec').addEventListener('click', (e) => {
    const d = e.target.closest('[data-drawer]'); if (d) { openDrawer(d.dataset.drawer); return; }
    if (e.target.closest('[data-print]')) print();
  });
}

// ------------------------------------------------------------------ routing
const dossierIds = () => S.manifest.dossiers || [];
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Which dossier answers for this id: the id itself, a listing's own dossier, or another unit in the same building. */
function resolve(want) {
  const ids = dossierIds(), L = byId(want);
  if (ids.includes(want)) return { dossier: want, L: L || null, exact: true };
  if (!L) return { dossier: null, L: null, exact: false, unknown: want };
  if (L.dossier && ids.includes(L.dossier)) return { dossier: L.dossier, L, exact: L.dossier === L.id };
  const sib = ids.map((i) => byId(i)).find((x) => x && ((L.bbl && x.bbl === L.bbl) || (L.bin && x.bin === L.bin)));
  if (sib) return { dossier: sib.id, L, exact: false };
  return { dossier: null, L, exact: false };
}

export async function show(arg) {
  const ids = dossierIds();
  const root = $('rec'); if (!root) return;
  const my = ++token;
  if (!ids.length) { root.innerHTML = emptyHTML({ title: 'No building dossiers yet', body: 'In NYC run <code>apartmentscout dossier --shortlist</code>; elsewhere ask your agent to follow the building-dossier skill.' }, null); return; }
  const want = arg || current || ids[0];
  const r = resolve(want);
  if (r.unknown) { root.innerHTML = emptyHTML({ title: 'No listing with that id', body: `Nothing is tracked as <code>${esc(r.unknown)}</code>. Pick a building above.` }, null); wirePicker(null); return; }
  current = want;
  if (!r.dossier) {
    const L = r.L;
    root.innerHTML = emptyHTML({
      title: 'No records dossier for this listing yet',
      body: `Public records for <b>${esc(label(L))}</b> have not been pulled. In NYC run <code>apartmentscout dossier ${esc(L.id)}</code>; elsewhere ask your agent to follow the building-dossier skill and save findings to <code>research/${esc(L.id)}.md</code>.`,
    }, L);
    wirePicker(L); return;
  }
  root.innerHTML = '<div class="rec-skel"><div class="skeleton" style="height:56px"></div><div class="skeleton" style="height:190px"></div><div class="skeleton" style="height:96px"></div><div class="skeleton" style="height:360px"></div></div>';
  let D = cache.get(r.dossier);
  if (!D) { D = await loadJSON(`${S.base}/dossiers/${r.dossier}.json`, null); if (D) cache.set(r.dossier, D); }
  if (my !== token) return;
  if (!D) { root.innerHTML = emptyHTML({ title: 'Dossier could not be loaded', body: `<code>dossiers/${esc(r.dossier)}.json</code> is listed in the manifest but did not load.` }, r.L); wirePicker(r.L); return; }
  render(D, r);
}

// ------------------------------------------------------------------ pieces
function emptyHTML({ title, body }, L) {
  return `${toolbarHTML(L, null)}<div class="empty rec-empty"><b>${esc(title)}</b><span>${body}</span>${L?.records?.flags?.length ? `<div class="rec-empty-flags">${L.records.flags.slice(0, 4).map((f) => `<div class="flag">${esc(f)}</div>`).join('')}</div>` : ''}${L ? `<div class="rec-actions"><button class="btn" type="button" data-drawer="${esc(L.id)}">${ICONS.doc}Open listing</button></div>` : ''}</div>`;
}

function optionLabel(id) { const L = byId(id); return L ? { b: L.building || L.address || id, u: L.unit || '', n: L.neighborhood || '', r: L.records?.risk_score } : { b: id, u: '', n: '', r: null }; }

function toolbarHTML(L, picked) {
  const ids = dossierIds();
  const cur = picked || (L ? { b: L.building || L.address, u: L.unit || '' } : null);
  const text = cur ? `${cur.b}${cur.u ? ' · ' + cur.u : ''}` : 'Choose a building';
  const opts = ids.map((id) => ({ id, ...optionLabel(id) })).sort((a, b) => a.b.localeCompare(b.b) || String(a.u).localeCompare(String(b.u), undefined, { numeric: true }));
  return `<div class="rec-bar" id="recBar">
    <div class="rec-pick">
      <button class="rec-pick-btn" type="button" id="recPickBtn" aria-haspopup="listbox" aria-expanded="false"><span class="k">Building</span><span class="v">${esc(text)}</span><svg viewBox="0 0 10 10" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M2 3.5l3 3 3-3"/></svg></button>
      <div class="rec-pop" id="recPop" hidden>
        <input type="search" id="recQ" placeholder="Search ${ids.length} buildings" autocomplete="off" aria-label="Search buildings">
        <ul role="listbox" id="recList">${opts.map((o) => `<li role="option" data-id="${esc(o.id)}" data-q="${esc((o.b + ' ' + o.u + ' ' + o.n).toLowerCase())}" aria-selected="${o.id === L?.id}"><button type="button" tabindex="-1"><span class="b">${esc(o.b)}${o.u ? `<i>${esc(o.u)}</i>` : ''}</span><small>${esc(o.n)}</small></button></li>`).join('')}<li class="rec-nomatch" hidden>No building matches.</li></ul>
      </div>
    </div>
    <div class="rec-nav" id="recNav" aria-label="Report sections"></div>
  </div>`;
}

function scoreBlock(v, name) {
  return `<div class="rec-score">${ring(v, 64, 5)}<div><b>${esc(name)}</b><span>higher is better</span></div></div>`;
}

function headerHTML(M, r) {
  const { D, L, bi, sm } = M;
  const unit = L?.unit;
  const facts = [
    ['BBL', D.bbl ? `<span class="mono">${esc(D.bbl)}</span>` : null], ['BIN', D.bin ? `<span class="mono">${esc(D.bin)}</span>` : null],
    ['Built', bi.yearbuilt || null], ['Floors', bi.numfloors || null], ['Units', num(bi.unitsres) ? num(bi.unitsres).toLocaleString() : null],
    ['Owner of record', bi.ownername ? esc(bi.ownername) : null], ['Class · zoning', [bi.bldgclass, bi.zonedist1].filter(Boolean).map(esc).join(' · ') || null],
    ['Pulled', fmtDate(M.asOf) + ` · ${D.window_years ?? 3}-yr window`],
  ].filter(([, v]) => v);
  const c = M.counts;
  const reading = c.bad || c.warn ? `${c.bad ? `<span class="pill bad">${c.bad} material</span>` : ''}${c.warn ? `<span class="pill warn">${c.warn} to check</span>` : ''}<span class="faint">of ${M.findings.length} areas reviewed</span>` : `<span class="pill good">Nothing material</span><span class="faint">${M.findings.length} areas reviewed</span>`;
  const siblingNote = !r.exact ? `<div class="rec-banner">${ICONS.doc}<span>Showing the building-wide records pulled for <b>${esc(label(byId(r.dossier) || {}) || r.dossier)}</b>. Public records describe the building and its block, not unit ${esc(unit || '')}.</span></div>` : '';
  return `<header class="panel rec-head" id="rec-summary">
    ${siblingNote}
    <div class="rec-head-grid">
      <div class="rec-title">
        <div class="rec-eyebrow">Public records report</div>
        <h1>${esc(D.building || (L && L.building) || 'Building')}${unit ? ` <span>#${esc(unit)}</span>` : ''}</h1>
        <p>${esc(D.address || L?.address || '')}${L?.neighborhood ? ` · ${esc(L.neighborhood)}` : ''}</p>
      </div>
      <div class="rec-scores">${scoreBlock(sm.risk_score, 'Records score')}${scoreBlock(sm.noise_score, 'Street-noise score')}</div>
    </div>
    <dl class="rec-facts">${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join('')}</dl>
    <div class="rec-reading">${reading}</div>
    ${(sm.flags || []).length ? `<div class="rec-flags">${sm.flags.map((f) => `<div class="flag">${esc(f)}</div>`).join('')}</div>` : ''}
    <div class="rec-actions">
      ${L ? `<button class="btn primary" type="button" data-drawer="${esc(L.id)}">${ICONS.doc}Open listing</button>` : ''}
      ${L && (S.manifest.sites || []).includes(L.id) ? `<a class="btn" href="#unit/${esc(L.id)}">${ICONS.cube}Unit 3D</a>` : ''}
      ${L && (S.manifest.plans || []).includes(L.id) ? `<a class="btn" href="#plan/${esc(L.id)}">${ICONS.plan}Floor plan</a>` : ''}
      ${safeUrl(L?.links?.listing) ? `<a class="btn" href="${esc(safeUrl(L.links.listing))}" target="_blank" rel="noopener">Listing ${ICONS.ext}</a>` : ''}
      <span class="sp"></span>
      <button class="btn ghost rec-noprint" type="button" data-print>Print or save PDF</button>
    </div>
  </header>`;
}

function metricsHTML(M) {
  return `<div class="metrics rec-metrics" role="list">${M.metrics.map((m) => `<div class="metric ${m.tone ? 't-' + m.tone : ''}" role="listitem"><div class="k">${esc(m.k)}</div><div class="v">${esc(m.v)}</div><div class="s">${esc(m.s)}</div></div>`).join('')}</div>`;
}

function findingsHTML(M) {
  return `<section class="rec-sec" id="rec-findings"><h2 class="rec-h">What matters <span>reports are not findings: read the rows before concluding</span></h2>
    <div class="panel flush"><div class="scroll"><table class="rec-table">
      <thead><tr><th>Issue</th><th>Evidence</th><th>Practical significance</th></tr></thead>
      <tbody>${M.findings.map((f) => `<tr data-sev="${f.sev}"><td class="issue" data-l="Issue"><span class="pill ${SEV_PILL[f.sev]}">${SEV_LABEL[f.sev]}</span><b>${esc(f.issue)}</b><span class="kind">${esc(f.kind)}</span></td><td data-l="Evidence">${f.evidence}</td><td data-l="Practical significance" class="sig">${esc(f.signif)}</td></tr>`).join('')}</tbody>
    </table></div></div>
    <p class="rec-foot">Complaints and 311 requests are allegations; violations, ECB penalties and permits are records; bedbug filings are owner self-reports. Severity labels rank what to ask about next, not whether to rent.</p></section>`;
}

const hourName = (i) => `${i % 12 === 0 ? 12 : i % 12} ${i < 12 ? 'am' : 'pm'}`;
function hourStats(nz) {
  const h = nz.by_hour || []; if (!h.length) return '';
  const tot = h.reduce((a, v) => a + v, 0) || 1, peak = h.indexOf(Math.max(...h));
  const night = h.reduce((a, v, i) => a + (i >= 22 || i < 6 ? v : 0), 0);
  return `<div class="metrics rec-minis"><div class="metric"><div class="k">Peak hour</div><div class="v">${hourName(peak)}</div><div class="s">${h[peak]} requests (${Math.round((h[peak] / tot) * 100)}%)</div></div><div class="metric"><div class="k">10 pm to 6 am</div><div class="v">${night}</div><div class="s">${Math.round((night / tot) * 100)}% of requests, 8 of 24 hours</div></div></div>`;
}
function timelineHTML(M) {
  const nz = M.nz, hc = M.hc, dc = M.dc, hv = M.hv, ecb = M.ecb, cr = M.cr;
  const atTypes = Object.entries(nz.at_building_by_type || {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k.replace(/^Noise[:,]?\s*/i, '').replace(/\s*\([A-Z0-9]{2,4}\)\s*$/, '').replace(/^./, (c) => c.toUpperCase()), v]);
  return `<section class="rec-sec" id="rec-timeline"><h2 class="rec-h">Timeline <span>${esc(fmtMonth(M.series.months[0]))} to ${esc(fmtMonth(M.series.months[M.series.months.length - 1]))}</span></h2>
    <div class="panel"><div id="recTl"></div><p class="rec-foot" id="recTlNote"></p></div>
    <div class="rec-grid">
      <div class="panel"><h3>311 noise by hour <span>${Math.round((nz.night_share || 0) * 100)}% from 10 pm to 6 am</span></h3><div class="rec-hour" id="recHour">${hourChart(nz.by_hour, nz.night_share)}</div>${hourStats(nz)}<p class="rec-foot">${(nz.nearby_total ?? 0).toLocaleString()} requests within ${nz.radius_m ?? 150} m over ${M.D.window_years ?? 3} years. Night hours shaded.</p></div>
      <div class="panel"><h3>Nearby noise by type <span>${(nz.nearby_total ?? 0).toLocaleString()}</span></h3>${noiseTypeBars(nz.by_type)}</div>
      <div class="panel"><h3>At this lot <span>${nz.at_building ?? 0} requests</span></h3>${barList(atTypes, { color: 'var(--band-30)', empty: 'No noise requests logged at this lot.' })}</div>
      <div class="panel"><h3>HPD complaints by category <span>${hc.total ?? 0} lines</span></h3>${barList(Object.entries(hc.by_category || {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k.toLowerCase().replace(/^./, (c) => c.toUpperCase()), v]), { color: 'var(--score-2)' })}</div>
      <div class="panel"><h3>HPD violations by class <span>${hv.total ?? 0} issued · ${hv.open ?? 0} open</span></h3>${barList(Object.entries(hv.by_class || {}).sort().map(([k, v]) => ['Class ' + k, v, ({ C: 'immediately hazardous', B: 'hazardous', A: 'non-hazardous' })[k] || '']), { color: 'var(--score-1)', empty: 'No HPD violations in the window.' })}${Object.keys(hv.by_year || {}).length ? `<p class="rec-foot">By year: ${Object.entries(hv.by_year).sort().map(([y, n]) => `${esc(y)} ${n}`).join(' · ')}</p>` : ''}</div>
      <div class="panel"><h3>DOB and ECB <span>${dc.total ?? 0} + ${ecb.total ?? 0}</span></h3>${barList(Object.entries(dc.by_category || {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => ['DOB category ' + k, v]).concat(Object.entries(ecb.by_severity || {}).map(([k, v]) => ['ECB ' + k.toLowerCase().replace(/^class - /, 'class '), v])), { color: 'var(--band-45)', empty: 'No DOB complaints or ECB violations.' })}</div>
      ${cr.last_12m != null ? `<div class="panel"><h3>Reported crime <span>${cr.last_12m.toLocaleString()} within ${cr.radius_m ?? 300} m, 12 mo</span></h3>${barList(Object.entries(cr.top_offenses || {}).map(([k, v]) => [k.toLowerCase().replace(/^./, (c) => c.toUpperCase()), v]), { color: 'var(--ink-3)', limit: 6 })}<p class="rec-foot">${Object.entries(cr.by_level || {}).map(([k, v]) => `${v} ${esc(k.toLowerCase())}`).join(' · ')}. Police complaint reports, not convictions.</p></div>` : ''}
    </div></section>`;
}

function sourcesHTML(M) {
  const D = M.D, src = Object.entries(D.sources || {});
  return `<section class="rec-sec rec-sources" id="rec-sources"><h2 class="rec-h">Sources and method</h2><div class="panel note">
    <p>Pulled ${esc(fmtDate(M.asOf))} for BBL <span class="mono">${esc(D.bbl || '?')}</span> and BIN <span class="mono">${esc(D.bin || '?')}</span>, ${D.window_years ?? 3}-year window; permit filings cover 18 months and crime 12. The dossier keeps the most recent rows of each dataset, so ledgers can be shorter than the headline totals. Row links open the raw dataset query in a new tab.</p>
    ${src.length ? `<p class="rec-srcs">${src.map(([k, u]) => (safeUrl(u) ? `<a href="${esc(safeUrl(u))}" target="_blank" rel="noopener">${esc(SRC_NAMES[k] || k.replace(/_/g, ' '))}</a>` : '')).filter(Boolean).join('')}</p>` : ''}
    <p>Records scores come from violations and complaints per 100 units; the street-noise score from 311 density and night share. They are screening aids, not conclusions about management or any unit.</p></div></section>`;
}

// ------------------------------------------------------------------ research notes
export function notesFor(id, L) {
  const listing = L || byId(id) || {}, b = slug(listing.building);
  const keys = Object.entries(S.notes || {}).filter(([k]) => k.startsWith(id) || (listing.id && k.startsWith(listing.id)) || (b && (k === b || k.startsWith(b + '-'))));
  const rank = (k) => (/due-diligence/.test(k) ? 0 : k === id || k === listing.id ? 1 : /reviews/.test(k) ? 3 : 2);
  return keys.sort((a, b2) => rank(a[0]) - rank(b2[0]) || a[0].localeCompare(b2[0]));
}
const noteTitle = (t, k) => (String(t).match(/^#\s+(.+)$/m)?.[1] || k).replace(/[`*]/g, '').trim();
const noteBody = (t) => String(t).replace(/^#\s+.+\n?/m, '');

function notesHTML(list) {
  if (!list.length) return `<section class="rec-sec" id="rec-notes"><h2 class="rec-h">Research notes</h2><div class="panel note">No research notes saved for this building yet. Ask your agent to follow the <b>building-dossier</b> skill and save findings to <code>research/&lt;id&gt;.md</code>.</div></section>`;
  return `<section class="rec-sec" id="rec-notes"><h2 class="rec-h">Research notes <span>${plural(list.length, 'note')}</span></h2>
    ${list.length > 1 ? `<div class="seg rec-noteseg" id="recNoteSeg" role="tablist">${list.map(([k, t], i) => `<button type="button" role="tab" data-i="${i}" class="${i ? '' : 'on'}" aria-selected="${!i}" title="${esc(noteTitle(t, k))}">${esc(noteTitle(t, k))}</button>`).join('')}</div>` : ''}
    <article class="panel rec-note" id="recNote"></article></section>`;
}

function showNote(list, i) {
  const [k, t] = list[i], host = $('recNote'); if (!host) return;
  host.innerHTML = `<div class="rec-note-h"><h3>${esc(noteTitle(t, k))}</h3><span class="faint mono">${esc(k)}</span></div><div class="rec-note-grid"><nav class="rec-toc" aria-label="In this note" hidden></nav><div class="md"></div></div>`;
  const body = host.querySelector('.md'); body.innerHTML = md(noteBody(t));
  const heads = [...body.querySelectorAll('h4')];
  heads.forEach((h, n) => (h.id = `rn-${i}-${n}`));
  const toc = host.querySelector('.rec-toc');
  if (heads.length >= 3 && heads.length <= 18) {
    toc.hidden = false;
    toc.innerHTML = `<b>In this note</b>${heads.map((h) => `<a href="#${h.id}" data-to="${h.id}">${esc(h.textContent)}</a>`).join('')}`;
    toc.querySelectorAll('a').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); document.getElementById(a.dataset.to)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }));
  } else if (heads.length > 18) {
    body.insertAdjacentHTML('afterbegin', `<p class="faint">${heads.length} entries. Scroll or use your browser search.</p>`);
  }
  // long notes start collapsed so the report stays scannable
  body.classList.toggle('long', t.length > 14000);
  if (t.length > 14000) {
    body.insertAdjacentHTML('afterend', '<button class="btn rec-more" type="button">Show the full note</button>');
    host.querySelector('.rec-more').addEventListener('click', (e) => { body.classList.remove('long'); e.currentTarget.remove(); });
  }
}

// ------------------------------------------------------------------ render and wiring
function render(D, r) {
  const L = r.L || byId(D.id) || null;
  const M = buildModel(D, L);
  const notes = notesFor(r.dossier, L);
  const root = $('rec');
  root.innerHTML = `${toolbarHTML(L, !L ? optionLabel(r.dossier) : null)}
    <p class="rec-print-h">Public records report · ${esc(D.building || '')} · printed ${esc(new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }))}</p>
    ${headerHTML(M, r)}${metricsHTML(M)}${findingsHTML(M)}${timelineHTML(M)}
    <section class="rec-sec" id="rec-ledgers"><h2 class="rec-h">Ledgers <span>row-level records, open to read</span></h2><div class="rec-leds">${ledgers(M)}</div></section>
    ${notesHTML(notes)}${sourcesHTML(M)}`;
  wirePicker(L, D, r);
  // sections nav
  const secs = [['rec-summary', 'Summary'], ['rec-findings', 'What matters'], ['rec-timeline', 'Timeline'], ['rec-ledgers', 'Ledgers'], ['rec-notes', 'Notes'], ['rec-sources', 'Sources']];
  $('recNav').innerHTML = secs.map(([id, t]) => `<button type="button" data-jump="${id}">${t}</button>`).join('');
  $('recNav').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => document.getElementById(b.dataset.jump)?.scrollIntoView({ behavior: 'smooth', block: 'start' })));
  // charts
  const tlNote = mountTimeline($('recTl'), M); $('recTlNote').textContent = tlNote;
  const hr = $('recHour'); bindTips(hr, makeTip(hr));
  // ledgers: open-only filter
  root.querySelectorAll('.rec-led').forEach((d) => d.querySelectorAll('.rec-led-bar .seg button').forEach((b) => b.addEventListener('click', () => {
    d.dataset.f = b.dataset.f; d.querySelectorAll('.rec-led-bar .seg button').forEach((x) => x.classList.toggle('on', x === b));
  })));
  // open the ledgers that have open items
  root.querySelectorAll('#led-hv, #led-ecb').forEach((d) => { if (d.querySelector('tbody tr:not([data-closed])')) d.open = true; });
  // notes
  if (notes.length) {
    showNote(notes, 0);
    $('recNoteSeg')?.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      $('recNoteSeg').querySelectorAll('button').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-selected', x === b); });
      showNote(notes, +b.dataset.i);
    }));
  }
}

// ------------------------------------------------------------------ picker
function closePicker() { const p = $('recPop'); if (p && !p.hidden) { p.hidden = true; $('recPickBtn')?.setAttribute('aria-expanded', 'false'); } }
function wirePicker(L) {
  const btn = $('recPickBtn'), pop = $('recPop'), q = $('recQ'), list = $('recList');
  if (!btn) return;
  const items = () => [...list.querySelectorAll('li[data-id]')].filter((li) => !li.hidden);
  const go = (id) => { closePicker(); if (id) location.hash = '#records/' + id; };
  let active = -1;
  const mark = (n) => { const it = items(); it.forEach((li, i) => li.classList.toggle('act', i === n)); active = n; it[n]?.scrollIntoView({ block: 'nearest' }); };
  btn.addEventListener('click', () => {
    const open = pop.hidden; pop.hidden = !open; btn.setAttribute('aria-expanded', String(open));
    if (open) { q.value = ''; filter(); q.focus(); const cur = items().findIndex((li) => li.dataset.id === (current || L?.id)); mark(Math.max(0, cur)); }
  });
  function filter() {
    const t = q.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    let n = 0; list.querySelectorAll('li[data-id]').forEach((li) => { const ok = t.every((w) => li.dataset.q.includes(w)); li.hidden = !ok; if (ok) n++; });
    list.querySelector('.rec-nomatch').hidden = n > 0; mark(n ? 0 : -1);
  }
  q.addEventListener('input', filter);
  q.addEventListener('keydown', (e) => {
    const it = items();
    if (e.key === 'ArrowDown') { e.preventDefault(); mark(Math.min(it.length - 1, active + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); mark(Math.max(0, active - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); go(it[active]?.dataset.id); }
    else if (e.key === 'Escape') { closePicker(); btn.focus(); }
  });
  list.addEventListener('click', (e) => go(e.target.closest('li[data-id]')?.dataset.id));
}
