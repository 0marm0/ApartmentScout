// Unit 3D side panels that are plain HTML from data: the units-in-this-building board with compass dials,
// the neighbours table and its CSV, the main-blockers table, and the evidence extras (outline sources,
// target match, floor-height calibration, model self-checks, source receipts). No DOM access here.
import { esc } from '../util.js';
import { compass } from '../sun.js';

const DIR = { N: 0, NNE: 22.5, NE: 45, ENE: 67.5, E: 90, ESE: 112.5, SE: 135, SSE: 157.5, S: 180, SSW: 202.5, SW: 225, WSW: 247.5, W: 270, WNW: 292.5, NW: 315, NNW: 337.5 };
export const dirBearing = (e) => DIR[String(e || '').toUpperCase()] ?? null;
export const fmtDist = (d) => (d >= 1000 ? (d / 1000).toFixed(1) + ' km' : Math.round(d) + ' m');
export const hm = (min) => { if (!min) return '—'; const h = Math.floor(Math.round(min) / 60), m = Math.round(min) % 60; return h && m ? `${h} h ${String(m).padStart(2, '0')}` : h ? `${h} h` : `${m} m`; };

// ------------------------------------------------------------------ units in this building
const CONFIRMED = new Set(['plan', 'established', 'floor_plan_compass', 'floor-plan']);
const LIKELY = new Set(['listing', 'agent', 'broker', 'photo-landmarks', 'photo_landmarks', 'photo']);
/** Certainty of a unit's facing from its listing fields: [key, label, pill class, next evidence]. */
export function certainty(L) {
  const src = String(L.exposure_source || (L.exposure?.length ? 'listing' : '')).toLowerCase();
  if (L.exposure?.length && CONFIRMED.has(src)) return ['confirmed', 'Confirmed', 'good', 'Check the view on a visit at the same time of day'];
  if (L.exposure?.length && (LIKELY.has(src) || !src)) return ['likely', 'Likely', 'accent', src === 'photo-landmarks' || src === 'photo' ? 'A floor plan with a compass' : 'A floor plan with a compass, or exact-unit photos'];
  return ['unverified', 'Unverified', 'warn', 'Which way it faces: ask for the floor plan'];
}
/** A small compass dial: an arrow for each exposure bearing, or a question mark. */
export function dial(bearings, cls = '') {
  const arms = bearings.map((b) => `<path d="M18 18L${(18 + 12 * Math.sin((b * Math.PI) / 180)).toFixed(2)} ${(18 - 12 * Math.cos((b * Math.PI) / 180)).toFixed(2)}" class="arm"/><circle cx="${(18 + 12 * Math.sin((b * Math.PI) / 180)).toFixed(2)}" cy="${(18 - 12 * Math.cos((b * Math.PI) / 180)).toFixed(2)}" r="2.6" class="tip"/>`).join('');
  return `<svg class="u-dial ${cls}" viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="15.5" class="ring"/><path d="M18 1.8v3.6" class="n"/><text x="18" y="10.6" text-anchor="middle" class="nl">N</text>${arms || '<text x="18" y="22.5" text-anchor="middle" class="q">?</text>'}<circle cx="18" cy="18" r="1.6" class="hub"/></svg>`;
}
/**
 * Card row for the units of one building. units: [{L, cur, site, alias, band}] where band is a floor-plan
 * floor band warning string. Returns '' when the building has only the current unit.
 */
export function unitsBoard(units) {
  if (units.length < 2) return '';
  const cards = units.map(({ L, cur, site, alias, band }) => {
    const exp = (L.exposure || []).map(dirBearing).filter((x) => x != null), [k, t, pc, next] = certainty(L);
    const gone = ['gone', 'rejected'].includes(L.status);
    return `<button type="button" class="u-unit${cur ? ' cur' : ''}${gone ? ' gone' : ''}" data-unit="${esc(L.id)}" title="${esc(cur ? 'This unit' : site ? 'Open its model' : 'Try its floor and facing in this model')}">
      ${dial(exp, k)}
      <span class="u-unit-t"><b>${esc(L.unit || L.id)}</b><small>${L.floor != null ? 'Floor ' + Math.round(L.floor) : 'Floor ?'}${exp.length ? ' · ' + esc(L.exposure.join(' ')) : ''}</small>
        <span class="u-unit-p"><span class="pill ${pc}">${t}</span>${site && !cur ? '<span class="pill">Model</span>' : ''}${gone ? `<span class="pill">${esc(L.status)}</span>` : ''}</span>
        <small class="u-unit-n">${esc(alias ? `Same unit as ${alias}` : band || next)}</small></span></button>`;
  }).join('');
  return `<div class="u-units-h"><span class="u-eyebrow">Units in this building</span><span class="faint">${units.length} listed · dial: which way each unit faces</span></div><div class="u-units-row">${cards}</div>`;
}

// ------------------------------------------------------------------ neighbours
export const NB_COLS = [['name', 'Building'], ['h', 'Roof'], ['dist', 'Away'], ['brg', 'Bearing'], ['view', 'View']];
export const NB_FIRST_DIR = { h: -1 }; // tallest first on the first click
const VIEW_ORDER = { 'in view': 0, side: 1, hidden: 2, behind: 3 };
export function sortRows(rows, key, dir) {
  const v = (r) => (key === 'view' ? VIEW_ORDER[r.view] : r[key]);
  return [...rows].sort((a, b) => { const x = v(a), y = v(b); return (typeof x === 'string' ? String(x).localeCompare(String(y)) : x - y) * dir || a.dist - b.dist; });
}
export function neighboursTable(rows, sort, HS, GS) {
  const th = NB_COLS.map(([k, t]) => `<th class="${['h', 'dist', 'brg'].includes(k) ? 'num' : ''}" aria-sort="${sort.key === k ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none'}"><button type="button" data-sort="${k}">${t}${sort.key === k ? `<i>${sort.dir > 0 ? '↑' : '↓'}</i>` : ''}</button></th>`).join('');
  const tr = rows.map((r) => {
    const src = [HS[r.hsrc] || r.hsrc, GS[r.geom] ? `outline ${GS[r.geom].toLowerCase()}` : ''].filter(Boolean).join(' · ');
    return `<tr data-bi="${r.bi}"${r.sel ? ' class="on"' : ''}><td><b>${esc(r.name)}</b><small>${esc(src || '—')}${r.stale ? ` · <span class="warnline">height edited ${esc(r.edited)}</span>` : ''}</small></td><td class="num">${Math.round(r.h)} m<small>${Math.round(r.h * 3.281)} ft${r.floors ? ' · ' + esc(r.floors) + ' fl' : ''}</small></td><td class="num">${fmtDist(r.dist)}</td><td class="num">${Math.round(r.brg)}° ${compass(r.brg)}</td><td><span class="u-vw ${r.view.replace(' ', '-')}">${r.view}</span></td></tr>`;
  }).join('');
  return `<div class="u-nb-wrap"><table class="mini u-nb"><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table></div>`;
}
const csvCell = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export function neighboursCSV(rows) {
  const cols = ['index', 'name', 'address', 'bin', 'bbl', 'roof_m', 'roof_ft', 'floors', 'ground_m', 'distance_m', 'bearing_deg', 'from_window', 'height_src', 'geom_src', 'data_src', 'year', 'edited', 'proposed'];
  const lines = [cols.join(',')];
  for (const r of rows) lines.push([r.bi, r.lmName || '', r.address || '', r.bin || '', r.bbl || '', r.h.toFixed(1), Math.round(r.h * 3.281), r.floors || '', (r.g ?? 0).toFixed(1), r.dist.toFixed(1), r.brg.toFixed(1), r.view, r.hsrc || '', r.geom || '', r.src || '', r.year || '', r.edited || '', r.future ? 'yes' : ''].map(csvCell).join(','));
  return lines.join('\n') + '\n';
}

// ------------------------------------------------------------------ main blockers
/** rows: [{bi, name, sub, today, dec, jun}] (minutes). */
export function blockersTable(rows, dayLabel) {
  if (!rows.length) return '';
  return `<div class="u-blk"><div class="label">Main blockers <span>minutes of sun each building takes</span></div>
    <table class="mini u-blk-t"><thead><tr><th>Building</th><th class="num">${esc(dayLabel)}</th><th class="num">Dec 15</th><th class="num">Jun 15</th></tr></thead><tbody>
    ${rows.map((r) => `<tr data-bi="${r.bi}"><td><button type="button" data-bi="${r.bi}"><b>${esc(r.name)}</b>${r.sub ? `<small>${esc(r.sub)}</small>` : ''}</button></td><td class="num">${hm(r.today)}</td><td class="num">${hm(r.dec)}</td><td class="num">${hm(r.jun)}</td></tr>`).join('')}
    </tbody></table></div>`;
}

// ------------------------------------------------------------------ evidence extras
const TARGET = {
  bin: ['Matched by BIN', 'good', 'The building was picked by its city building number (BIN), not by the address point.'],
  bbl: ['Matched by tax lot', 'good', 'The building was picked by its tax lot (BBL), not by the address point.'],
  point: ['Address point', '', 'The address point falls inside this footprint.'],
  nearest: ['Nearest footprint', 'warn', 'The address point is not inside any footprint; the nearest one was used. Check it is the right building.'],
};
const FH_SRC = { pluto: 'roof height ÷ PLUTO floor count', 'osm-levels': 'roof height ÷ OpenStreetMap levels', default: 'a default 3.2 m', manual: 'a measured slab height', listing: 'the listing', calibrated: 'a calibration' };
/** Lines for the evidence panel's source list from optional v2 keys. Returns {notes, rows}. */
export function evidenceExtras(site, ctx) {
  const P = site.provenance || {}, rows = [], notes = [];
  const t = TARGET[P.target];
  if (t) notes.push(`<li><div class="u-ev-k">Which building<span class="pill ${t[1]}">${t[0]}</span></div><p>${t[2]}${+P.target_offset_m > 10 ? ` The address point is ${Math.round(+P.target_offset_m)} m outside it, in the street.` : ''}</p></li>`);
  if (ctx.sector && ctx.sector.n) {
    const { n, manual, stale, def } = ctx.sector;
    const bits = [manual ? `${manual} with a manually mapped outline` : '', stale ? `${stale} with heights last edited ${ctx.staleYears}+ years ago` : '', def ? `${def} with a default (unknown) height` : ''].filter(Boolean);
    rows.push(['In front', `${n} buildings within 300 m in front of the window${bits.length ? ': ' + bits.join(', ') : ', all with measured outlines and recent heights'}.`]);
  }
  const fh = ctx.fh, src = site.floor_height_src || site.calibration?.src;
  rows.push(['Floors', `${fh.toFixed(2).replace(/0$/, '')} m each${src ? ` (${esc(FH_SRC[src] || src)})` : ''}; eye level 1.6 m above the floor${ctx.slab != null ? `; floor ${ctx.floor} at ${ctx.slab.toFixed(1)} m${ctx.slabManual ? ' (your setting)' : ''}` : ''}.`]);
  return { notes, rows };
}
const CHECK_PILL = { pass: ['good', 'Pass'], ok: ['good', 'Pass'], warn: ['warn', 'Warn'], fail: ['bad', 'Fail'], error: ['bad', 'Fail'] };
const CHECK_NAMES = { origin: 'Address point', ground: 'Ground level', storey: 'Floor height', anchor: 'Window anchor', outside: 'Open air outside', 'outside-future': 'Open air with proposed', streets: 'Streets around', 'future-overlap': 'Proposed vs this building', heights: 'Heights in front', limits: 'Query limits', future: 'Proposed buildings', target: 'Target building', components: 'Building parts', 'window-component': 'Window on a part' };
const checkName = (c) => { const k = String(c.label || c.name || c.id || 'check').toLowerCase(); return CHECK_NAMES[k] || k.replace(/[_-]+/g, ' ').replace(/^./, (m) => m.toUpperCase()); };
/** Model self-checks: a badge line and the list of anything that did not pass. */
export function checksBlock(checks) {
  if (!Array.isArray(checks) || !checks.length) return '';
  const st = (c) => String(c.status || c.result || (c.ok === true ? 'pass' : c.ok === false ? 'fail' : 'warn')).toLowerCase();
  const pass = checks.filter((c) => ['pass', 'ok'].includes(st(c))).length, bad = checks.filter((c) => !['pass', 'ok'].includes(st(c)));
  return `<div class="u-checks"><div class="u-ev-k">Model self-checks<span class="pill ${bad.length ? (bad.some((c) => ['fail', 'error'].includes(st(c))) ? 'bad' : 'warn') : 'good'}">${pass} of ${checks.length} pass</span></div>
    <ul>${(bad.length ? bad : checks).map((c) => { const [pc, t] = CHECK_PILL[st(c)] || ['', st(c)]; return `<li><span class="pill ${pc}">${t}</span><span><b>${esc(checkName(c))}</b>${c.detail || c.msg || c.note ? ` ${esc(c.detail || c.msg || c.note)}` : ''}</span></li>`; }).join('')}</ul></div>`;
}
/** Source receipts: dataset, rows, when it was fetched, when the dataset itself was last updated, limit warnings. */
export function receiptsBlock(list, safeUrl) {
  if (!Array.isArray(list) || !list.length) return '';
  const d = (v) => (v ? esc(String(v).slice(0, 10)) : '—');
  const row = (r) => {
    const qs = Array.isArray(r.queries) ? r.queries : [];
    const u = safeUrl(r.url || r.query_url || qs.find((q) => q.url)?.url || '');
    const name = r.name || r.dataset_name || r.dataset || r.id || 'Query';
    const hashes = qs.map((q) => q.sha256).filter(Boolean).concat(r.sha256 ? [r.sha256] : []);
    const hit = r.limit_hit || qs.some((q) => q.limit_hit);
    return `<tr><td>${u ? `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(name)}</a>` : esc(name)}<small class="mono">${esc(r.dataset || '')}${r.calls > 1 ? ` · ${+r.calls} calls` : ''}</small>${hit ? '<small class="warnline">hit the row limit: may be incomplete</small>' : ''}${hashes.length ? `<small class="mono" title="sha256 of the cached responses: ${esc(hashes.join(', '))}">sha256 ${esc(String(hashes[0]).slice(0, 10))}${hashes.length > 1 ? ` +${hashes.length - 1}` : ''}</small>` : ''}</td><td class="num">${r.rows != null ? (+r.rows).toLocaleString() : '—'}</td><td>${d(r.retrieved || r.retrieved_at || r.fetched)}</td><td>${d(r.rows_updated || r.rows_updated_utc || r.updated)}</td></tr>`;
  };
  return `<details class="u-rcpt"><summary>Source receipts <span>${list.length} dataset${list.length > 1 ? 's' : ''}</span></summary><table class="mini"><thead><tr><th>Data</th><th class="num">Rows</th><th>Fetched</th><th>Data updated</th></tr></thead><tbody>${list.map(row).join('')}</tbody></table></details>`;
}
