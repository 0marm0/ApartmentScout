// Records view data model: parsing, derived metrics, monthly series and the "what matters" findings.
// Pure functions (no DOM). Wording rule: complaints and 311 requests are reports (allegations); violations,
// ECB/OATH penalties and permit filings are records; bedbug filings are owner self-reports. Nothing here is a verdict.
import { esc, safeUrl, money } from '../util.js';

// ------------------------------------------------------------------ dates and numbers
export function parseDate(v) {
  if (v == null || v === '') return null;
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return new Date(Date.UTC(+m[3], +m[1] - 1, +m[2]));
  m = s.match(/^(\d{4})(\d{2})(\d{2})/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return null;
}
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const fmtDate = (d) => (d ? `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}` : '');
export const fmtMonth = (key) => { const [y, m] = key.split('-'); return `${MON[+m - 1]} ${y}`; };
export const monthKey = (d) => d.toISOString().slice(0, 7);
export const num = (v) => { const n = parseFloat(String(v ?? '').replace(/[^0-9.-]/g, '')); return Number.isFinite(n) ? n : 0; };
export const plural = (n, one, many = one + 's') => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

const ACRO = /\b(dob|hpd|ecb|oath|nyc|fdny|hvac|llc|mdl|hmc|nypd|bbl|bin)\b/gi;
const CITE = /^(?:§+\s*)?\d[\d\-.,;()\s§]*(?:(?:HMC|ADM CODE|ADM|MDL|RCNY|PHL)\b[\s,;:]*)*[\s:]*/;
/** The code citation an HPD description opens with, e.g. "§ 27-2026 ADM CODE" (for display beside the text). */
export function descCode(t) {
  const s = String(t || '').replace(/\s+/g, ' ').trim();
  if (!/^(?:§|\d+-\d+)/.test(s)) return '';
  const m = s.match(CITE);
  return m ? m[0].replace(/[\s:]+$/, '').slice(0, 60) : '';
}
/** Sentence-case an agency description that arrives in capitals with a code citation in front. */
export function cleanDesc(t, max = 0) {
  let s = String(t || '').replace(/\s+/g, ' ').trim();
  if (/^(?:§|\d+-\d+)/.test(s)) s = s.replace(CITE, '');
  else { const i = s.indexOf(':'); if (i > 0 && i < 120 && /HMC|ADM|MDL|RCNY|§/.test(s.slice(0, i))) s = s.slice(i + 1).trim(); }
  const letters = s.replace(/[^A-Za-z]/g, ''), upper = s.replace(/[^A-Z]/g, '');
  if (letters.length > 12 && upper.length / letters.length > 0.6) s = s.toLowerCase();
  s = s.replace(/(^|[.!?]\s+)([a-z])/g, (m, a, c) => a + c.toUpperCase()).replace(ACRO, (m) => m.toUpperCase()).replace(/\bapt\.? ?#?(\w+)/gi, (m, x) => 'apt ' + x.toUpperCase());
  s = cap(s);
  return max && s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s;
}

/** "Noise - Street/Sidewalk | Loud Music/Party" -> { cat: "Street/Sidewalk", what: "Loud music/party" }. */
export function niceNoise(t) {
  const [a, b] = String(t).split(' | ');
  let cat = (b ? a : 'Noise').replace(/^Noise\s*-?\s*/i, '') || 'General';
  let what = (b || a).replace(/^Noise[:,]?\s*/i, '').replace(/\s*\(([A-Z0-9]{2,4})\)\s*$/, '').trim();
  what = cap(what.toLowerCase()).replace(/\bhvac\b/i, 'HVAC');
  return { cat: cap(cat), what: what || 'Noise' };
}

// ------------------------------------------------------------------ links to raw rows
const ID_RE = /\/(?:d|resource)\/([a-z0-9]{4}-[a-z0-9]{4})/i;
export function datasetUrl(D, key) { return safeUrl(D.sources?.[key]); }
/** Socrata query URL on the same portal as the dossier source, e.g. rows for this BBL. Null when the source is unknown. */
export function socrata(D, key, params = {}) {
  const src = datasetUrl(D, key); if (!src) return null;
  const m = src.match(ID_RE); if (!m) return null;
  let origin; try { origin = new URL(src).origin; } catch { return null; }
  const q = new URLSearchParams(params).toString();
  return safeUrl(`${origin}/resource/${m[1]}.json${q ? '?' + q : ''}`);
}
export const link = (url, text) => (safeUrl(url) ? `<a href="${esc(safeUrl(url))}" target="_blank" rel="noopener">${text}</a>` : text);

// ------------------------------------------------------------------ outcome vocabularies
export function hpdComplaintOutcome(r) {
  const t = String(r.status_description || '').toLowerCase();
  if (/violations? were issued|following conditions\. violation/.test(t)) return { k: 'Violation issued', tone: 'warn' };
  if (/not able to gain access|unable to complete|unable to gain|could not gain/.test(t)) return { k: 'No access', tone: '' };
  if (/more than one complaint/.test(t)) return { k: 'Duplicate (building-wide)', tone: '' };
  if (/did not violate|no violat/.test(t)) return { k: 'No violation found', tone: 'good' };
  if (/heat was not required/.test(t)) return { k: 'Heat not required', tone: '' };
  if (/no heat or hot water/.test(t)) return { k: 'Heat inspection', tone: '' };
  if (/contacted a tenant|indicated that t|someone at that number/.test(t)) return { k: 'Reported resolved', tone: '' };
  return { k: r.complaint_status === 'OPEN' ? 'Open' : 'Closed', tone: '' };
}
export function noiseOutcome(r) {
  const t = String(r.resolution_description || '').toLowerCase();
  if (!t) return { k: 'No outcome logged', tone: '' };
  if (/a violation of law was|observed a violation|issued a summons|summons was issued/.test(t)) return { k: 'Violation or summons', tone: 'bad' };
  if (/took action to fix/.test(t)) return { k: 'Police acted', tone: 'warn' };
  if (/duplicate/.test(t)) return { k: 'Duplicate', tone: '' };
  if (/those responsible for the condition were gone|were gone/.test(t)) return { k: 'Gone on arrival', tone: '' };
  if (/unable to gain entry/.test(t)) return { k: 'No entry', tone: '' };
  if (/not fall under|not within its jurisdiction|jurisdiction/.test(t)) return { k: 'Not their jurisdiction', tone: '' };
  if (/no evidence|didn't observe|did not observe|no criminal violation|observed no|not necessary/.test(t)) return { k: 'No violation found', tone: '' };
  if (/requires contact with the complainant|did not include|returned|at the complainant's request/.test(t)) return { k: 'Needs complainant', tone: '' };
  if (/could be closed|researched/.test(t)) return { k: 'Closed after review', tone: '' };
  return { k: 'Closed', tone: '' };
}

// ------------------------------------------------------------------ the model
const isOpenHpd = (r) => String(r.violationstatus).toLowerCase() === 'open';
const isOpenDob = (r) => !/closed/i.test(String(r.status || ''));
const isOpenEcb = (r) => !/resolve|dismiss|paid|cure/i.test(String(r.ecb_violation_status || ''));

/** Rows dated on or after `cutoff`; `partial` when the retained rows were truncated while still inside the window. */
function since(rows, dateOf, cutoff, total) {
  const dated = rows.map((r) => ({ r, d: parseDate(dateOf(r)) })).filter((x) => x.d);
  const n = dated.filter((x) => x.d >= cutoff).length;
  const oldest = dated.reduce((a, x) => (!a || x.d < a ? x.d : a), null);
  const truncated = total != null && rows.length < total;
  return { n, partial: truncated && oldest && oldest >= cutoff, oldest, truncated };
}

export function buildModel(D, L) {
  const asOf = parseDate(D.generated) || new Date();
  const cutoff = new Date(Date.UTC(asOf.getUTCFullYear() - 1, asOf.getUTCMonth(), asOf.getUTCDate()));
  const bi = D.building_info || {}, hv = D.hpd_violations || {}, hc = D.hpd_complaints || {}, dc = D.dob_complaints || {};
  const ecb = D.ecb_violations || {}, co = D.construction || {}, nz = D.noise_311 || {}, cr = D.crime || {}, sm = D.summary || {};
  const hvRows = hv.recent || [], hcRows = hc.recent || [], dcRows = dc.recent || [], ecbRows = ecb.recent || [];
  const bugRows = (D.bedbugs?.filings || []).slice().sort((a, b) => String(b.filing_date).localeCompare(String(a.filing_date)));

  // monthly series: 311 comes pre-bucketed; official records are bucketed here from the retained rows
  const nzKeys = Object.keys(nz.by_month || {}).sort();
  const first = nzKeys[0] || monthKey(new Date(Date.UTC(asOf.getUTCFullYear() - 3, asOf.getUTCMonth(), 1)));
  const months = []; { let [y, m] = first.split('-').map(Number); const [ey, em] = monthKey(asOf).split('-').map(Number); while (y < ey || (y === ey && m <= em)) { months.push(`${y}-${String(m).padStart(2, '0')}`); if (++m > 12) { m = 1; y++; } } }
  const idx = new Map(months.map((k, i) => [k, i]));
  const zero = () => months.map(() => 0);
  const S = { months, noise: months.map((k) => nz.by_month?.[k] || 0), hpdC: zero(), hpdV: zero(), dob: zero(), ecb: zero() };
  const seen = new Set();
  for (const r of hcRows) { const d = parseDate(r.received_date), i = d ? idx.get(monthKey(d)) : null; const key = r.complaint_id; if (i == null || seen.has(key)) continue; seen.add(key); S.hpdC[i]++; }
  for (const r of hvRows) { const d = parseDate(r.inspectiondate), i = d ? idx.get(monthKey(d)) : null; if (i != null) S.hpdV[i]++; }
  for (const r of dcRows) { const d = parseDate(r.date_entered), i = d ? idx.get(monthKey(d)) : null; if (i != null) S.dob[i]++; }
  for (const r of ecbRows) { const d = parseDate(r.issue_date), i = d ? idx.get(monthKey(d)) : null; if (i != null) S.ecb[i]++; }
  const cov = (rows, dateOf, total) => { const s = since(rows, dateOf, cutoff, total); return { shown: rows.length, total, from: s.truncated ? s.oldest : null }; };
  S.coverage = {
    hpdC: cov(hcRows, (r) => r.received_date, hc.total), hpdV: cov(hvRows, (r) => r.inspectiondate, hv.total),
    dob: cov(dcRows, (r) => r.date_entered, dc.total), ecb: cov(ecbRows, (r) => r.issue_date, ecb.total),
  };

  // headline numbers
  const units = num(sm.units || bi.unitsres) || null;
  const openC = hv.open_by_class?.C || 0, openB = hv.open_by_class?.B || 0, openA = hv.open_by_class?.A || 0;
  const hc12 = since(hcRows.filter((r, i, a) => a.findIndex((q) => q.complaint_id === r.complaint_id) === i), (r) => r.received_date, cutoff, hc.complaints);
  const ecbOpenRows = ecbRows.filter(isOpenEcb);
  const ecbOpenPenalty = ecbOpenRows.reduce((s, r) => s + num(r.penality_imposed), 0);
  const ecbAllPenalty = ecbRows.reduce((s, r) => s + num(r.penality_imposed), 0);
  const latestBug = bugRows[0];
  const nz12 = months.slice(-12).reduce((s, k) => s + (nz.by_month?.[k] || 0), 0);
  const nzPrev12 = months.slice(-24, -12).reduce((s, k) => s + (nz.by_month?.[k] || 0), 0);
  const heavy = co.heavy_construction || [];
  const permits = buildPermits(co);

  const M = {
    D, L, asOf, cutoff, bi, hv, hc, dc, ecb, co, nz, cr, sm, units, series: S, permits, bugRows,
    hvRows, hcRows, dcRows, ecbRows, openC, openB, openA, hc12, ecbOpenRows, ecbOpenPenalty, ecbAllPenalty, latestBug, nz12, nzPrev12, heavy,
  };
  M.metrics = metrics(M);
  M.findings = findings(M);
  M.counts = ['bad', 'warn', 'info', 'ok'].reduce((o, k) => ((o[k] = M.findings.filter((f) => f.sev === k).length), o), {});
  return M;
}

function buildPermits(co) {
  const map = new Map();
  const add = (rows, tag) => { for (const r of rows || []) { const k = r.job_filing_number || JSON.stringify(r); const cur = map.get(k) || { ...r, tags: new Set() }; cur.tags.add(tag); map.set(k, cur); } };
  add(co.lot_recent, 'This lot'); add(co.heavy_construction, 'Heavy'); add(co.major_jobs, 'Major');
  return [...map.values()].sort((a, b) => String(b.filing_date).localeCompare(String(a.filing_date)));
}

// ------------------------------------------------------------------ metric tiles
function metrics(M) {
  const { hv, hc, ecb, co, nz, sm, latestBug } = M;
  const tone = (n, bad, warn) => (n >= bad ? 'bad' : n >= warn ? 'warn' : 'good');
  const openTot = hv.open || 0;
  const t = [];
  t.push({ k: 'Open HPD violations', v: openTot, tone: M.openC ? 'bad' : openTot ? 'warn' : 'good',
    s: hv.total ? `Class C ${M.openC} · B ${M.openB} · A ${M.openA}` : 'None issued in window' });
  t.push({ k: 'HPD complaints, 12 mo', v: `${M.hc12.partial ? '≥' : ''}${M.hc12.n}`, tone: tone(M.hc12.n, 12, 5),
    s: `${plural(hc.complaints ?? 0, 'complaint')} in ${M.D.window_years ?? 3} yr` });
  t.push({ k: 'ECB / OATH penalties', v: money(M.ecbOpenPenalty), tone: M.ecbOpenRows.length ? 'warn' : 'good',
    s: ecb.total ? `${M.ecbOpenRows.length} unresolved of ${ecb.total}` : 'No ECB violations' });
  t.push({ k: 'Permit filings nearby', v: co.block_filings ?? 0, tone: M.heavy.length ? 'warn' : '',
    s: `${M.heavy.length} heavy · ${co.lot_filings ?? 0} on this lot · 18 mo` });
  t.push({ k: 'Bedbug filings', v: latestBug ? num(latestBug.infested_dwelling_unit_count) : '–', tone: latestBug && num(latestBug.infested_dwelling_unit_count) ? 'warn' : latestBug ? 'good' : '',
    s: latestBug ? `infested units, latest of ${M.bugRows.length} filings` : 'No filings retained' });
  t.push({ k: '311 noise / year', v: Math.round(nz.nearby_per_year ?? 0), tone: '',
    s: `within ${nz.radius_m ?? 150} m · ${nz.at_building ?? 0} at this lot` });
  return t;
}

// ------------------------------------------------------------------ findings
const SEV_ORDER = { bad: 0, warn: 1, info: 2, ok: 3 };
export const SEV_LABEL = { bad: 'Material', warn: 'Check', info: 'Context', ok: 'Clear' };
export const SEV_PILL = { bad: 'bad', warn: 'warn', info: 'accent', ok: 'good' };
const top = (obj, n = 3) => Object.entries(obj || {}).filter(([k]) => k && k !== 'null').sort((a, b) => b[1] - a[1]).slice(0, n);
const b = (x) => `<b class="num">${x}</b>`;

function findings(M) {
  const { D, L, hv, hc, dc, ecb, co, nz, cr, bi, sm } = M;
  const out = [];
  const push = (f) => out.push(f);
  const win = `${D.window_years ?? 3} years`, winAdj = `${D.window_years ?? 3}-year`;
  const unit = L?.unit ? String(L.unit).toUpperCase() : null;
  const hvLink = link(socrata(D, 'hpd_violations', { bbl: D.bbl, $order: 'inspectiondate DESC' }), 'rows');
  const hcLink = link(socrata(D, 'hpd_complaints', { bbl: D.bbl, $order: 'receiveddate DESC' }), 'rows');

  // 1. HPD violations: inspector findings
  {
    const open = hv.open || 0, total = hv.total || 0;
    const sev = M.openC ? 'bad' : open ? 'warn' : total ? 'info' : 'ok';
    const cls = Object.entries(hv.open_by_class || {}).map(([k, v]) => `class ${k} ${v}`).join(', ');
    const mine = unit ? M.hvRows.filter((r) => String(r.apartment || '').toUpperCase() === unit && isOpenHpd(r)).length : 0;
    const t1 = top(Object.fromEntries((hv.top || []).map(([t, n]) => [cleanDesc(t, 120), n])), 1)[0];
    const lastOpen = M.hvRows.filter(isOpenHpd).map((r) => parseDate(r.inspectiondate)).filter(Boolean).sort((a, c) => c - a)[0];
    push({
      sev, issue: 'HPD housing violations', kind: 'Inspector findings',
      evidence: total
        ? `${b(open)} open of ${b(total)} issued over ${win}${cls ? ` (${esc(cls)} open)` : ''}.${lastOpen ? ` Latest open one inspected ${fmtDate(lastOpen)}.` : ''}${t1 && t1[1] > 1 ? ` Most repeated: ${esc(t1[0])} (${t1[1]}x).` : ''}${unit ? ` ${mine ? `${b(mine)} open on apt ${esc(unit)}.` : `None open on apt ${esc(unit)} in the retained rows.`}` : ''} ${hvLink}`
        : `No HPD violations issued in the ${winAdj} window. ${hvLink}`,
      signif: M.openC
        ? 'Class C means immediately hazardous (heat, hot water, lead, vermin, no egress). Ask management for the correction certificate dates and whether any are in the unit or on the line above or below it.'
        : open
          ? 'Open class A and B items are usually repairs the owner has not certified yet. Check whether they sit in apartments or common areas, and how old they are.'
          : total ? 'Everything issued has been closed or dismissed. That is the normal end state; the history still shows what tends to break.' : 'A clean violation record is the expected result for a well-run building; it does not cover problems nobody reported.',
    });
  }

  // 2. HPD complaints: tenant reports
  {
    const cats = top(hc.by_category, 4), lines = hc.total || 0;
    const rate = sm.hpd_complaints_per_100_units_yr ?? (M.units ? (lines / M.units / (D.window_years || 3)) * 100 : null);
    const issued = M.hcRows.filter((r) => hpdComplaintOutcome(r).k === 'Violation issued').length;
    const sev = rate != null && rate >= 10 ? 'bad' : rate != null && rate >= 4 ? 'warn' : lines ? 'info' : 'ok';
    push({
      sev, issue: 'HPD tenant complaints', kind: 'Reports, not findings',
      evidence: lines
        ? `${b(hc.complaints ?? 0)} complaints (${plural(lines, 'problem line')}) in ${win}; ${b(M.hc12.partial ? '≥' + M.hc12.n : M.hc12.n)} in the last 12 months${rate != null ? `, ${rate} per 100 units a year` : ''}. ${cats.length ? 'Top categories: ' + cats.map(([k, v]) => `${esc(cap(k.toLowerCase()))} ${v}`).join(', ') + '.' : ''} ${M.hcRows.length ? `Of the ${M.hcRows.length} retained lines, ${issued} ended with an inspector-issued violation.` : ''} ${hcLink}`
        : `No HPD complaints in the ${winAdj} window. ${hcLink}`,
      signif: 'A complaint is a tenant allegation. Closed can mean the inspector found nothing, could not get in, or issued a violation: read the outcome column in the ledger before drawing a conclusion. Repeats of the same category matter more than the total.',
    });
  }

  // 3. heat and hot water
  {
    const key = Object.keys(hc.by_category || {}).find((k) => /heat|hot water/i.test(k));
    const n = key ? hc.by_category[key] : 0;
    if (n) {
      const heatMonths = M.hcRows.filter((r) => /heat|hot water/i.test(r.major_category || '')).map((r) => parseDate(r.received_date)).filter(Boolean);
      const inSeason = heatMonths.filter((d) => d.getUTCMonth() >= 9 || d.getUTCMonth() <= 4).length;
      push({
        sev: n >= 3 ? 'warn' : 'info', issue: 'Heat and hot water', kind: 'Reports, not findings',
        evidence: `${b(n)} complaint ${n === 1 ? 'line' : 'lines'} about heat or hot water in ${win}${heatMonths.length ? `; ${inSeason} of ${heatMonths.length} retained rows fall in the 1 Oct to 31 May heat season` : ''}.`,
        signif: 'Heat is the one service with a legal minimum in winter. Ask whether the building has a central plant or in-unit units, which risers were affected, and test hot-water delay at the tour.',
      });
    }
  }

  // 4. ECB / OATH
  {
    const total = ecb.total || 0, open = M.ecbOpenRows.length;
    const class1 = M.ecbOpenRows.some((r) => /CLASS - 1/i.test(r.severity));
    const sev = open && class1 ? 'bad' : open ? 'warn' : total ? 'info' : 'ok';
    const first = M.ecbOpenRows[0] || M.ecbRows[0];
    const sev1 = top(ecb.by_severity, 3).map(([k, v]) => `${esc(cap(k.toLowerCase()).replace(/^class\s*-\s*/i, 'Class '))} ${v}`).join(', ');
    push({
      sev, issue: 'ECB / OATH violations', kind: 'Penalty records',
      evidence: total
        ? `${b(open)} unresolved of ${b(total)}${sev1 ? ` (${sev1})` : ''}; ${b(money(M.ecbOpenPenalty))} imposed on unresolved ones, ${money(M.ecbAllPenalty)} across all retained rows.${first ? ` Example: ${esc(cleanDesc(first.violation_description, 150))} (${fmtDate(parseDate(first.issue_date))}).` : ''} ${link(socrata(D, 'ecb_violations', { bin: D.bin }), 'rows')}`
        : `No ECB or OATH violations on this building in the window. ${link(socrata(D, 'ecb_violations', { bin: D.bin }), 'rows')}`,
      signif: open
        ? 'These are enforcement actions against the owner, often for use or occupancy, equipment or construction. They rarely touch daily comfort but can signal illegal conversions, short-term use or deferred safety work. Ask what the cure status is.'
        : total ? 'Resolved ECB items are history; look for repeats of the same violation type.' : 'Nothing to chase here.',
    });
  }

  // 5. DOB complaints
  {
    const total = dc.total || 0, open = M.dcRows.filter(isOpenDob).length;
    const cats = top(dc.by_category, 3).map(([k, v]) => `category ${esc(k)} ${v}`).join(', ');
    push({
      sev: open ? 'warn' : total >= 15 ? 'info' : total ? 'info' : 'ok', issue: 'DOB complaints', kind: 'Reports, not findings',
      evidence: total ? `${b(total)} complaints to the Department of Buildings in ${win}; ${b(open)} not closed. ${cats ? 'Mostly ' + cats + '.' : ''} ${link(socrata(D, 'dob_complaints', { bin: D.bin }), 'rows')}` : `No DOB complaints in the window. ${link(socrata(D, 'dob_complaints', { bin: D.bin }), 'rows')}`,
      signif: 'DOB complaints cover construction, elevators, illegal use and facade issues. Look up the category codes in the DOB reference before reading anything into the count; a closed complaint with an inspection date is a real check that found nothing actionable or was resolved.',
    });
  }

  // 6. construction nearby
  {
    const heavy = M.heavy, bf = co.block_filings ?? 0;
    const cNoise = Object.entries(nz.by_type || {}).filter(([k]) => /construction|jack ?hammer/i.test(k)).reduce((s, [, v]) => s + v, 0);
    const h0 = heavy[0];
    const sev = heavy.length ? 'warn' : bf >= 60 ? 'info' : bf ? 'info' : 'ok';
    push({
      sev, issue: 'Construction on the block', kind: 'Permit filings',
      evidence: `${b(bf)} DOB NOW filings on the block and ${b(co.lot_filings ?? 0)} on this lot in the last 18 months; ${b(heavy.length)} heavy (demolition, new building, excavation).${h0 ? ` Example: ${esc(cleanDesc(h0.job_description, 110))} at ${esc(String(h0.house_no || ''))} ${esc(String(h0.street_name || '').replace(/\s+/g, ' ').trim())}, filed ${fmtDate(parseDate(h0.filing_date))}.` : ''}${cNoise ? ` ${b(cNoise)} of the nearby 311 noise requests concern construction.` : ''}`,
      signif: heavy.length
        ? 'Filing is not the same as work happening, but demolition and foundation jobs are the loud, long ones. Ask which direction your windows face relative to the site and check the permit dates.'
        : 'Most filings are interior alterations that make little street noise. Scan the permit ledger for scaffolds, excavation or crane work.',
    });
  }

  // 7. bedbugs
  {
    const bugs = M.bugRows, last = M.latestBug;
    if (last) {
      const inf = num(last.infested_dwelling_unit_count), era = num(last.eradicated_unit_count), re = num(last.re_infested_dwelling_unit);
      const earlier = bugs.slice(1).filter((r) => num(r.infested_dwelling_unit_count) > 0).length;
      const per = (d) => fmtDate(parseDate(d));
      push({
        sev: inf ? 'warn' : earlier ? 'info' : 'ok', issue: 'Bedbug history', kind: 'Owner self-reports',
        evidence: `Latest annual filing (${per(last.filing_period_start_date)} to ${per(last.filling_period_end_date)}): ${b(inf)} of ${num(last.of_dwelling_units).toLocaleString()} units infested, ${era} eradicated, ${re} re-infested. ${bugs.length > 1 ? `${earlier} of ${bugs.length - 1} earlier filings also reported infested units.` : ''} ${link(socrata(D, 'bedbugs', { bbl: D.bbl }), 'rows')}`,
        signif: 'Owners file once a year, so this is a lagging, self-reported snapshot. A building-wide count of one or two units is common in large towers; the question is how quickly units are cleared. Ask for the last 12 months and the treatment policy.',
      });
    }
  }

  // 8. street noise (311)
  {
    const per = Math.round(nz.nearby_per_year ?? 0), night = Math.round((nz.night_share || 0) * 100);
    const tops = top(nz.by_type, 3).map(([k, v]) => { const t = niceNoise(k); return `${esc(t.what)} (${esc(t.cat.toLowerCase())}) ${v}`; });
    const trend = M.nzPrev12 ? Math.round(((M.nz12 - M.nzPrev12) / M.nzPrev12) * 100) : null;
    const score = sm.noise_score;
    const sev = score != null && score < 40 ? 'bad' : score != null && score < 60 ? 'warn' : per > 120 ? 'warn' : 'info';
    push({
      sev, issue: 'Street and neighbourhood noise', kind: 'Reports, not findings',
      evidence: `${b(per)} 311 noise requests a year within ${nz.radius_m ?? 150} m (${b(nz.nearby_total ?? 0)} in ${win}); ${b(nz.at_building ?? 0)} logged at this lot${sm.noise_at_building_per_100_units_yr != null ? `, ${sm.noise_at_building_per_100_units_yr} per 100 units a year` : ''}. ${night}% fall between 10 pm and 6 am.${trend != null ? ` Last 12 months ${trend >= 0 ? 'up' : 'down'} ${Math.abs(trend)}% on the 12 before (${M.nz12} vs ${M.nzPrev12}).` : ''} Most common: ${tops.join('; ')}. ${link(socrata(D, 'sr311', { bbl: D.bbl, $where: "complaint_type like 'Noise%'", $order: 'created_date DESC' }), 'rows at this lot')}`,
      signif: 'These count calls about the area, not the sound in your bedroom; a few repeat callers can dominate. Weigh the night share, then test the unit: windows closed at 10 pm on a weekend, and which side faces the street or loading areas.',
    });
  }

  // 9. crime context
  if (cr.last_12m != null) {
    const lv = Object.entries(cr.by_level || {}).sort((a, c) => c[1] - a[1]).map(([k, v]) => `${v} ${k.toLowerCase()}`).join(', ');
    const tops = top(cr.top_offenses, 3).map(([k, v]) => `${esc(cap(k.toLowerCase()))} ${v}`).join(', ');
    push({
      sev: 'info', issue: 'Reported crime nearby', kind: 'Police complaint reports',
      evidence: `${b(cr.last_12m.toLocaleString())} NYPD complaints within ${cr.radius_m ?? 300} m in the last 12 months (${esc(lv)}). Largest groups: ${tops}.`,
      signif: 'Counts follow foot traffic and commercial density, so busy blocks always rank high. Use it to compare your finalists on the same radius, then walk the route at night.',
    });
  }

  // 10. owner and building
  {
    const owner = String(bi.ownername || '').trim(), llc = /LLC|L\.L\.C|LP\b|CORP|TRUST/i.test(owner);
    const alt = bi.yearalter1 ? `, altered ${bi.yearalter1}` : '';
    push({
      sev: 'info', issue: 'Owner and building', kind: 'City registry (PLUTO)',
      evidence: `Owner of record: ${esc(owner || 'not listed')}. Built ${bi.yearbuilt ?? 'unknown'}${alt}, ${bi.numfloors ?? '?'} floors, ${num(bi.unitsres) ? num(bi.unitsres).toLocaleString() : '?'} residential units, building class ${esc(bi.bldgclass || '?')}, zoning ${esc(bi.zonedist1 || '?')}${bi.histdist ? `, historic district ${esc(bi.histdist)}` : ''}${bi.landmark ? ', landmark' : ''}.`,
      signif: /UNAVAILABLE/i.test(owner) ? 'The tax record hides the owner. The HPD registration lists the managing agent; ask for it by name.' : llc ? 'An LLC of record is normal for large buildings and says little about the management company. The HPD registration names the managing agent; look them up.' : 'Confirm the managing agent in the HPD registration and ask who handles repair requests.',
    });
  }

  // 11. resident reviews (listing level)
  if (L?.reviews?.risk) {
    const rs = L.reviews.risk_score;
    push({
      sev: rs != null && rs < 50 ? 'warn' : 'info', issue: 'Resident reviews', kind: 'Reports, not findings',
      evidence: `${esc(L.reviews.risk)}${rs != null ? ` (review risk score ${Math.round(rs)}, higher is better)` : ''}.${L.reviews.summary ? ' ' + esc(L.reviews.summary) : ''}`,
      signif: 'Review sites mix tenants, former tenants and unverified posts. Treat them as hypotheses to test against the records above and at the tour.',
    });
  }

  out.forEach((f, i) => (f.i = i));
  return out.sort((a, c) => SEV_ORDER[a.sev] - SEV_ORDER[c.sev] || a.i - c.i);
}
