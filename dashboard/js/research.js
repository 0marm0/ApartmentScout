// Research view: what to find out next (queue), what changed, what rented fast, buildings to watch and every image,
// under one coverage header. Sub-tabs deep-link as #research/queue, #research/new, #research/gone, #research/watch
// and #research/media. Pipeline files (coverage.json, history.json, watchlist.json) are optional: when one is
// missing the tab says so, and the queue and coverage fall back to estimates built from listings.json.
import { S, on, loadJSON, store, isSaved } from './app.js';
import { $, esc } from './util.js';
import { R, loadExtras, queueRows, coverageSummary, events, goneRows, watchRows, mediaGroups, fmtDate, ageText, ageDays } from './research/model.js';
import { IC } from './research/ui.js';
import * as queue from './research/queue.js';
import * as changes from './research/changes.js';
import * as gone from './research/gone.js';
import * as watch from './research/watch.js';
import * as media from './research/media.js';

// Records (the building due-diligence report) is the last sub-tab: records.js keeps its own report element and this
// shim parks it in the panel. #research/records/<id> opens it on that building; #records/<id> redirects here.
const records = {
  async render(panel) {
    const m = await import('./records.js');
    if (tab !== 'records') return;
    m.mount(panel);
    await m.show(recId || undefined);
  },
};
const TABS = [
  ['queue', 'Queue', IC.queue, queue], ['new', 'New & changed', IC.pulse, changes], ['gone', 'Gone fast', IC.clock, gone],
  ['watch', 'Watchlist', IC.eye, watch], ['media', 'Media', IC.image, media], ['records', 'Records', IC.pin, records],
];
let tab = 'queue', recId = '', ready = null;
const isOn = () => S.view === 'research';

export function init() {
  ready = loadExtras(loadJSON);
  const again = () => { if (isOn() && tab !== 'media') render(); else updateBadge(); };
  on('saved', again);
  on('weights-settled', again);
}

export async function show(arg) {
  const [t, ...rest] = String(arg || '').split('/');
  recId = t === 'records' ? rest.join('/') : '';
  arg = t;
  const want = TABS.some(([k]) => k === arg) ? arg : store.get('research-tab', 'queue');
  const prev = tab;
  tab = TABS.some(([k]) => k === want) ? want : 'queue';
  // picking another building inside Records swaps the report only: no re-render of the tab strip, scroll stays
  if (tab === 'records' && prev === 'records' && R.loaded && $('view-research').contains($('rec'))) { (await import('./records.js')).show(recId || undefined); return; }
  store.set('research-tab', tab);
  if (!R.loaded) {
    $('view-research').innerHTML = `<div class="view-pad rs"><div class="page-h"><div class="t"><h1>Research</h1><p>Loading research data…</p></div></div><div class="skeleton" style="height:120px"></div><div class="skeleton" style="height:360px;margin-top:16px"></div></div>`;
    await ready;
    if (!isOn()) return;
  }
  render();
}

function counts(rows) {
  const ev = events(), gr = goneRows(), wr = watchRows();
  const mg = mediaGroups(), m = mg.reduce((a, g) => a + g.items.length, 0);
  return { queue: rows.length, new: ev.length, gone: gr.length, watch: wr.length, media: m, records: (S.manifest.dossiers || []).length };
}

function updateBadge(rows = queueRows()) {
  // the nav badge counts saved picks that still have gaps or red flags: the research you said matters
  const n = rows.filter((r) => isSaved(r.L.id) && (r.missing.length || r.maxSev >= 3)).length;
  const b = $('queueCount'); if (!b) return;
  b.hidden = !n; b.textContent = n;
  b.title = n ? `${n} saved pick${n > 1 ? 's' : ''} with facts still to find` : '';
}

function render() {
  const rows = queueRows(), sm = coverageSummary(rows), C = counts(rows);
  updateBadge(rows);
  const root = $('view-research');
  const rec = document.getElementById('rec');   // the Records report lives in this view only while its tab is open
  if (rec && root.contains(rec)) document.querySelector('#view-records .view-pad')?.append(rec);
  root.innerHTML = `<div class="view-pad rs" data-tab="${tab}">
    <div class="page-h"><div class="t"><h1>Research</h1><p>What to find out next, what changed, what rented and how fast, the buildings worth watching, and every image in one place.</p></div>
      <div class="actions"><span class="rs-built">${S.manifest.generated ? 'Data built ' + esc(fmtDate(S.manifest.generated.slice(0, 10))) : 'No build yet'}</span></div></div>
    ${coverageHTML(sm)}
    <div class="rs-tabs" role="tablist" aria-label="Research sections">${TABS.map(([k, t, ic]) => `<button type="button" role="tab" id="rsTab-${k}" aria-controls="rsPanel" aria-selected="${k === tab}" tabindex="${k === tab ? 0 : -1}" class="${k === tab ? 'on' : ''}" data-tab="${k}">${ic}<span>${t}</span><i>${C[k] ?? ''}</i></button>`).join('')}</div>
    <div class="rs-panel" id="rsPanel" role="tabpanel" aria-labelledby="rsTab-${tab}"></div>
  </div>`;
  const tl = root.querySelector('.rs-tabs');
  tl.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => go(b.dataset.tab)));
  tl.addEventListener('keydown', (e) => {
    const ks = TABS.map(([k]) => k), i = ks.indexOf(tab);
    const n = e.key === 'ArrowRight' ? (i + 1) % ks.length : e.key === 'ArrowLeft' ? (i - 1 + ks.length) % ks.length : e.key === 'Home' ? 0 : e.key === 'End' ? ks.length - 1 : -1;
    if (n < 0) return;
    e.preventDefault(); go(ks[n], true);
  });
  const det = root.querySelector('.rs-more');
  det?.addEventListener('toggle', () => store.set('research-more', det.open));
  const mod = TABS.find(([k]) => k === tab)[3];
  mod.render($('rsPanel'), { rows, summary: sm, rerender: render });
  if (go.focus) { root.querySelector(`#rsTab-${tab}`)?.focus(); go.focus = false; }
}
function go(k, focus = false) {
  go.focus = focus;
  if (!location.hash.startsWith(`#research/${k}`)) location.hash = `research/${k}`;
  else show(k === 'records' && recId ? `records/${recId}` : k);
}

// ------------------------------------------------------------------ coverage header
function coverageHTML(sm) {
  const pct = sm.total ? Math.round((sm.complete / sm.total) * 100) : 0;
  const m = (k, v, s, tone = '') => `<div class="metric ${tone}"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${s}</div></div>`;
  const share = (v) => (sm.total ? `${Math.round((v / sm.total) * 100)}% of ${sm.total}` : '—');
  const open = store.get('research-more', false);
  const facts = sm.facts.map((f) => {
    const p = f.n ? f.known / f.n : 0;
    return `<div class="rs-fact" title="${esc(f.why)}"><span>${esc(f.label)}</span><span class="rs-fbar" aria-hidden="true"><i style="width:${(p * 100).toFixed(1)}%"></i></span><b>${Math.round(p * 100)}%</b></div>`;
  }).join('');
  const src = sm.sources.map((s) => {
    const age = ageDays(s.checked);
    return `<tr><td>${esc(s.name)}</td><td class="n">${s.listings.toLocaleString()}</td><td class="${age == null || age > 14 ? 'rs-stale' : ''}">${s.checked ? `${esc(fmtDate(s.checked))} <span class="faint">· ${esc(ageText(s.checked))}</span>` : '<span class="faint">no check date</span>'}</td></tr>`;
  }).join('');
  return `<section class="panel rs-cov" aria-label="Research coverage">
    <div class="rs-cov-top">
      <div class="rs-meter">
        <div class="label">Finalist standard <span>${sm.derived ? 'estimated in the browser' : 'from coverage.json'}</span></div>
        <div class="rs-meter-v"><b>${pct}<small>%</small></b><span><b>${sm.complete.toLocaleString()}</b> of ${sm.total.toLocaleString()} homes still in play have every fact a finalist needs${sm.finalists != null ? ` · ${sm.finalists.toLocaleString()} finalist${sm.finalists === 1 ? '' : 's'}` : ''}</span></div>
        <div class="rs-bar" role="meter" aria-label="Homes with every finalist fact" aria-valuemin="0" aria-valuemax="${sm.total}" aria-valuenow="${sm.complete}"><i style="width:${pct}%"></i></div>
      </div>
      <div class="metrics rs-m">
        ${m('Missing size', sm.missing_size.toLocaleString(), share(sm.missing_size), sm.missing_size ? 'warn' : '')}
        ${m('Missing fees', sm.missing_fees.toLocaleString(), share(sm.missing_fees), sm.missing_fees ? 'warn' : '')}
        ${m('Missing media', sm.missing_media.toLocaleString(), share(sm.missing_media), sm.missing_media ? 'warn' : '')}
        ${m('Stale checks', sm.stale.toLocaleString(), 'known, but due a recheck')}
      </div>
    </div>
    <details class="rs-more"${open ? ' open' : ''}><summary>${IC.chev}<span>Fact by fact and sources</span><span class="faint">${sm.facts.length} facts · ${sm.sources.length} source${sm.sources.length === 1 ? '' : 's'}</span></summary>
      <div class="rs-more-b"><div class="rs-facts">${facts}</div>
        <div class="scroll rs-src"><table class="mini"><thead><tr><th>Source</th><th class="n">Listings</th><th>Last checked</th></tr></thead><tbody>${src || '<tr><td colspan="3" class="faint">No sources recorded</td></tr>'}</tbody></table></div></div>
    </details>
    <p class="rs-census">${sm.claim ? esc(sm.claim) : 'Counts cover the listings your agent captured from these sources. <b>This is not a market census:</b> units that were never captured do not appear, so a short list here does not mean a thin market.'}${sm.derived ? ' Without <span class="mono">coverage.json</span> these numbers are estimated from listings.json.' : ''}</p>
  </section>`;
}
