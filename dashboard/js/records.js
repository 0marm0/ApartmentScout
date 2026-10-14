// Records view: the public-records dossier for one building (NYC built in; other cities via agent research).
import { S, byId, label, loadJSON } from './app.js';
import { $, esc, css, md } from './util.js';

let current = null;
export function init() {
  document.getElementById('view-records').innerHTML = `<div class="view-pad"><div class="u-picker"><label for="recSel">Building</label><select id="recSel"></select></div> <div id="recBody"></div></div>`;
  const ids = S.manifest.dossiers || [];
  $('recSel').innerHTML = ids.length ? ids.map((id) => `<option value="${esc(id)}">${esc(byId(id) ? label(byId(id)) : id)}</option>`).join('') : '<option>No dossiers yet: run `apartmentscout dossier`</option>';
  $('recSel').addEventListener('change', (e) => (location.hash = '#records/' + e.target.value));
}

export async function show(id) {
  const ids = S.manifest.dossiers || [];
  if (!ids.length) { $('recBody').innerHTML = '<div class="panel">No building dossiers yet. In NYC run <code>apartmentscout dossier</code>; elsewhere ask your agent to follow the building-dossier skill.</div>'; return; }
  id = id && ids.includes(id) ? id : current || ids[0];
  $('recSel').value = id; current = id;
  const D = await loadJSON(`${S.base}/dossiers/${id}.json`, null);
  if (!D) return;
  render(D);
}

function bars(obj, opts = {}) {
  const e = Object.entries(obj || {}).filter(([k]) => k && k !== 'null');
  if (!e.length) return '<p class="muted">None in the window.</p>';
  const max = Math.max(...e.map(([, v]) => v));
  return `<table class="mini">${e.map(([k, v]) => `<tr><td style="width:55%">${esc(k)}</td><td><span class="sbar" style="width:100%;max-width:220px"><i style="width:${(v / max) * 100}%;background:${opts.color || 'var(--accent)'}"></i></span></td><td class="num" style="text-align:right">${v}</td></tr>`).join('')}</table>`;
}

function hourChart(h) {
  if (!h) return '';
  const W = 600, H = 170, l = 30, b = 24, max = Math.max(...h, 1), bw = (W - l - 6) / 24;
  const night = css('--shade'), day = css('--accent');
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Noise complaints by hour">`;
  h.forEach((v, i) => { const bh = (v / max) * (H - b - 10); s += `<rect x="${l + i * bw + 1}" y="${H - b - bh}" width="${bw - 2}" height="${bh}" fill="${i >= 22 || i < 6 ? night : day}" rx="2"><title>${i}:00, ${v}</title></rect>`; });
  [0, 6, 12, 18].forEach((i) => (s += `<text x="${l + i * bw + bw / 2}" y="${H - 6}" text-anchor="middle">${i === 0 ? '12am' : i === 12 ? '12pm' : (i % 12) + (i < 12 ? 'am' : 'pm')}</text>`));
  s += `<text x="${l - 4}" y="14" text-anchor="end">${max}</text></svg>`;
  return s;
}
function monthChart(m) {
  const e = Object.entries(m || {}); if (!e.length) return '';
  const W = 600, H = 150, l = 30, b = 22, max = Math.max(...e.map(([, v]) => v), 1), bw = (W - l - 6) / e.length;
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Noise complaints by month">`;
  e.forEach(([k, v], i) => { const bh = (v / max) * (H - b - 10); s += `<rect x="${l + i * bw + 1}" y="${H - b - bh}" width="${Math.max(1, bw - 2)}" height="${bh}" fill="${css('--shade')}" rx="1"><title>${k}: ${v}</title></rect>`; if (k.endsWith('-01')) s += `<text x="${l + i * bw}" y="${H - 6}">${k.slice(0, 4)}</text>`; });
  return s + '</svg>';
}

function render(D) {
  const s = D.summary || {}, bi = D.building_info || {}, hv = D.hpd_violations || {}, hc = D.hpd_complaints || {}, nz = D.noise_311 || {}, co = D.construction || {}, cr = D.crime || {}, ecb = D.ecb_violations || {}, dob = D.dob_complaints || {};
  const L = byId(D.id) || {};
  const colorOf = (v) => (v >= 75 ? 'var(--good)' : v >= 55 ? 'var(--warn)' : 'var(--bad)');
  $('recBody').innerHTML = `
  <div class="panel">
    <h2>${esc(D.building || label(L))}</h2>
    <div class="muted">${esc(D.address || '')} · BBL <span class="mono">${esc(D.bbl)}</span> · BIN <span class="mono">${esc(D.bin || '?')}</span> · last ${D.window_years} years · pulled ${esc(D.generated)}</div>
    <div class="stats" style="margin-top:12px">
      <div class="stat"><div class="k">Records score</div><div class="big" style="color:${colorOf(s.risk_score)}">${s.risk_score ?? '?'}</div></div>
      <div class="stat"><div class="k">Street-noise score</div><div class="big" style="color:${colorOf(s.noise_score)}">${s.noise_score ?? '?'}</div></div>
      <div class="stat"><div class="k">Built / floors / units</div><div class="v">${bi.yearbuilt ?? '?'} / ${bi.numfloors ?? '?'} / ${bi.unitsres ?? '?'}</div></div>
      <div class="stat"><div class="k">HPD violations per 100 units/yr</div><div class="v">${s.hpd_violations_per_100_units_yr ?? '?'}</div></div>
      <div class="stat"><div class="k">HPD complaints per 100 units/yr</div><div class="v">${s.hpd_complaints_per_100_units_yr ?? '?'}</div></div>
      <div class="stat"><div class="k">Noise reqs within ${nz.radius_m ?? 150} m / yr</div><div class="v">${nz.nearby_per_year ?? '?'}</div></div>
    </div>
    ${(s.flags || []).map((f) => `<div class="flag">${esc(f)}</div>`).join('') || '<p class="ok">No red flags in the public records for this window.</p>'}
    <p class="muted" style="font-size:12.5px;margin:8px 0 0">Owner of record: ${esc(bi.ownername || '?')} · class ${esc(bi.bldgclass || '?')} · zoning ${esc(bi.zonedist1 || '?')}. Reports are not findings: read the rows before concluding.</p>
  </div>
  <div class="rec-grid">
    <div class="panel"><h3>311 noise within ${nz.radius_m ?? 150} m, by hour</h3>${hourChart(nz.by_hour)}<p class="muted" style="font-size:12.5px">${nz.nearby_total ?? 0} requests, ${nz.at_building ?? 0} logged at this lot. ${Math.round((nz.night_share || 0) * 100)}% between 10 pm and 6 am (blue).</p></div>
    <div class="panel"><h3>311 noise by month</h3>${monthChart(nz.by_month)}</div>
    <div class="panel"><h3>Nearby noise by type</h3>${bars(nz.by_type, { color: 'var(--shade)' })}</div>
    <div class="panel"><h3>HPD complaints by category</h3>${bars(hc.by_category)}<p class="muted" style="font-size:12.5px">${hc.complaints ?? 0} complaints, ${hc.total ?? 0} problem lines.</p></div>
    <div class="panel"><h3>HPD violations</h3><p>${hv.total ?? 0} issued, <b>${hv.open ?? 0} open</b>. Class C is immediately hazardous, B hazardous, A non-hazardous.</p>${bars(hv.by_class)}${(hv.top || []).length ? '<h3 style="margin-top:10px">Most common</h3><table class="mini">' + hv.top.map(([t, n]) => `<tr><td>${esc(t)}</td><td class="num">${n}</td></tr>`).join('') + '</table>' : ''}</div>
    <div class="panel"><h3>Construction on the block (18 months)</h3><p>${co.block_filings ?? 0} DOB NOW filings on the block, ${co.lot_filings ?? 0} on this lot.</p>
      <table class="mini">${[...(co.heavy_construction || []), ...(co.major_jobs || [])].filter((r, i, a) => a.findIndex((q) => q.job_filing_number === r.job_filing_number) === i).slice(0, 10).map((r) => `<tr><td class="num">${esc((r.filing_date || '').slice(0, 10))}</td><td>${esc(r.house_no)} ${esc(r.street_name)}</td><td>${esc((r.job_description || '').slice(0, 120))}</td></tr>`).join('')}</table></div>
    <div class="panel"><h3>DOB complaints and ECB violations</h3><p>${dob.total ?? 0} DOB complaints, ${ecb.total ?? 0} ECB/OATH violations (${ecb.open ?? 0} not resolved).</p><table class="mini">${(dob.recent || []).slice(0, 8).map((r) => `<tr><td class="num">${esc((r.date_entered || '').slice(0, 10))}</td><td>category ${esc(r.complaint_category || '?')}</td><td class="muted">${esc(r.status || '')}</td></tr>`).join('')}</table><p class="muted" style="font-size:12px">DOB category codes are listed in the DOB complaint code reference.</p></div>
    <div class="panel"><h3>Reported crime within ${cr.radius_m ?? 300} m, 12 months</h3><p>${cr.last_12m ?? '?'} NYPD complaints. ${Object.entries(cr.by_level || {}).map(([k, v]) => `${esc(k.toLowerCase())} ${v}`).join(', ')}.</p>${bars(cr.top_offenses, { color: 'var(--muted)' })}</div>
    <div class="panel"><h3>Most recent 311 noise at this lot</h3><div class="scroll"><table class="mini"><thead><tr><th>When</th><th>Type</th><th>Outcome</th></tr></thead><tbody>${(nz.at_building_recent || []).slice(0, 14).map((r) => `<tr><td class="num">${esc(r.created_date.slice(0, 16).replace('T', ' '))}</td><td>${esc(r.descriptor || '')}</td><td class="muted">${esc((r.resolution_description || '').slice(0, 90))}</td></tr>`).join('')}</tbody></table></div></div>
  </div>
  ${notesFor(D.id).map(([k, t]) => `<details class="panel notes"><summary><b>Research note:</b> ${esc(k)}</summary><div class="md">${md(t)}</div></details>`).join('')}
  <div class="panel note">Sources: ${Object.entries(D.sources || {}).map(([k, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(k.replaceAll('_', ' '))}</a>`).join(' · ')}</div>`;
}

export function notesFor(id) {
  const L = byId(id) || {}, b = (L.building || '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return Object.entries(S.notes || {}).filter(([k]) => k.startsWith(id) || (b && k.startsWith(b)));
}
