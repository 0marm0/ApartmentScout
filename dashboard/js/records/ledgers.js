// Records view ledgers: collapsible row-level tables (violations, complaints, permits, bedbugs, 311 at the lot).
import { esc, ICONS, money } from '../util.js';
import {
  parseDate, fmtDate, num, cleanDesc, descCode, link, socrata, datasetUrl,
  hpdComplaintOutcome, noiseOutcome, niceNoise,
} from './model.js';

const pill = (text, tone = '') => `<span class="pill ${tone}">${esc(text)}</span>`;
const date = (v) => `<span class="num rec-date">${esc(fmtDate(parseDate(v)) || '–')}</span>`;
const rowLink = (D, key, params, text) => {
  const u = socrata(D, key, params);
  return u ? `<a class="rec-id mono" href="${esc(u)}" target="_blank" rel="noopener" title="Raw dataset row">${esc(text)}</a>` : `<span class="mono">${esc(text)}</span>`;
};

function ledger({ id, title, count, shown, D, source, cols, rows, filterable, note, openByDefault }) {
  const src = datasetUrl(D, source);
  const body = rows.length
    ? `<div class="scroll rec-scroll"><table class="mini rec-ledger"><thead><tr>${cols.map((c) => `<th class="${c.cls || ''}">${esc(c.h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr ${r.closed ? 'data-closed="1"' : ''}>${r.cells.map((c, i) => `<td class="${cols[i].cls || ''}" data-l="${esc(cols[i].h)}">${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
    : '<p class="muted rec-none">No rows in the window.</p>';
  return `<details class="panel flush rec-led" id="${id}" data-f="all" ${openByDefault ? 'open' : ''}>
    <summary><span class="t">${esc(title)}</span><span class="pill">${count}</span><span class="sp"></span>${src ? `<a class="rec-src" href="${esc(src)}" target="_blank" rel="noopener">Dataset ${ICONS.ext}</a>` : ''}<svg class="chev" viewBox="0 0 10 10" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M2 3.5l3 3 3-3"/></svg></summary>
    <div class="rec-led-b">
      <div class="rec-led-bar">${filterable ? '<div class="seg" role="group" aria-label="Filter rows"><button type="button" data-f="all" class="on">All</button><button type="button" data-f="open">Open only</button></div>' : ''}<span class="faint">${shown != null ? esc(shown) : ''}</span></div>
      ${body}${note ? `<p class="rec-note-s">${note}</p>` : ''}
    </div></details>`;
}

export function ledgers(M) {
  const { D, L } = M, out = [];
  const unit = L?.unit ? String(L.unit).toUpperCase() : null;
  const retained = (rows, total) => `${rows} of ${total ?? rows} rows retained${total != null && rows < total ? ' (latest first)' : ''}`;

  // HPD violations
  {
    const rows = M.hvRows.slice().sort((a, b) => String(b.inspectiondate).localeCompare(String(a.inspectiondate)));
    out.push(ledger({
      id: 'led-hv', title: 'HPD violations', count: M.hv.total ?? 0, D, source: 'hpd_violations', filterable: true,
      shown: retained(rows.length, M.hv.total),
      cols: [{ h: 'Inspected' }, { h: 'Class' }, { h: 'Where' }, { h: 'Violation' }, { h: 'Status' }],
      rows: rows.map((r) => {
        const open = String(r.violationstatus).toLowerCase() === 'open', mine = unit && String(r.apartment || '').toUpperCase() === unit;
        return { closed: !open, cells: [
          date(r.inspectiondate),
          pill(r.class || '?', r.class === 'C' ? 'bad' : r.class === 'B' ? 'warn' : ''),
          `${r.apartment ? 'Apt ' + esc(r.apartment) : 'Common area'}${r.story ? `<small>Story ${esc(r.story)}</small>` : ''}${mine ? '<small class="rec-mine">this unit</small>' : ''}`,
          `${esc(cleanDesc(r.novdescription, 190))}${descCode(r.novdescription) ? `<small class="mono">${esc(descCode(r.novdescription))}</small>` : ''}${r.rentimpairing === 'Y' ? ' ' + pill('rent impairing', 'bad') : ''}`,
          `${pill(open ? 'Open' : 'Closed', open ? 'warn' : 'good')}<small>${esc(cleanDesc(r.currentstatus))}</small> ${rowLink(D, 'hpd_violations', { violationid: r.violationid }, '#' + r.violationid)}`,
        ] };
      }),
      note: 'Class C is immediately hazardous, B hazardous, A non-hazardous. A closed row means the city recorded the condition as corrected or dismissed.',
    }));
  }

  // HPD complaints (one row per problem line, grouped by complaint id on the left)
  {
    const rows = M.hcRows.slice().sort((a, b) => String(b.received_date).localeCompare(String(a.received_date)));
    out.push(ledger({
      id: 'led-hc', title: 'HPD complaints', count: M.hc.total ?? 0, D, source: 'hpd_complaints', filterable: true,
      shown: retained(rows.length, M.hc.total) + ' · one row per problem line',
      cols: [{ h: 'Received' }, { h: 'Problem' }, { h: 'Where' }, { h: 'Outcome' }],
      rows: rows.map((r) => {
        const o = hpdComplaintOutcome(r), open = r.complaint_status === 'OPEN';
        return { closed: !open, cells: [
          date(r.received_date),
          `${esc(String(r.major_category || '').toLowerCase().replace(/^./, (c) => c.toUpperCase()))}${r.minor_category ? `<small>${esc(String(r.minor_category).toLowerCase())}</small>` : ''}`,
          r.apartment ? `Apt ${esc(r.apartment)}` : 'Building',
          `${pill(open ? 'Open' : o.k, open ? 'warn' : o.tone)}${open ? `<small>${esc(o.k)}</small>` : ''} ${rowLink(D, 'hpd_complaints', { complaint_id: r.complaint_id }, '#' + r.complaint_id)}`,
        ] };
      }),
      note: 'Each row is something a tenant reported. "No access" and "Duplicate" outcomes do not mean the condition was absent, and "No violation found" means the inspector saw nothing at that visit.',
    }));
  }

  // DOB complaints
  {
    const rows = M.dcRows.slice().sort((a, b) => (parseDate(b.date_entered) || 0) - (parseDate(a.date_entered) || 0));
    out.push(ledger({
      id: 'led-dc', title: 'DOB complaints', count: M.dc.total ?? 0, D, source: 'dob_complaints', filterable: true,
      shown: retained(rows.length, M.dc.total),
      cols: [{ h: 'Entered' }, { h: 'Category' }, { h: 'Status' }, { h: 'Inspected' }, { h: 'Disposition' }],
      rows: rows.map((r) => {
        const open = !/closed/i.test(r.status || '');
        return { closed: !open, cells: [
          date(r.date_entered), `<span class="mono">${esc(r.complaint_category || '?')}</span>`,
          `${pill(open ? esc(r.status || 'Open') : 'Closed', open ? 'warn' : 'good')} ${rowLink(D, 'dob_complaints', { complaint_number: r.complaint_number }, '#' + r.complaint_number)}`,
          date(r.inspection_date || r.disposition_date), `<span class="mono">${esc(r.disposition_code || '–')}</span>`,
        ] };
      }),
      note: `Category and disposition codes are defined in the ${link('https://www.nyc.gov/assets/buildings/pdf/complaint_category.pdf', 'DOB complaint category reference')}.`,
    }));
  }

  // ECB / OATH
  {
    const rows = M.ecbRows.slice().sort((a, b) => String(b.issue_date).localeCompare(String(a.issue_date)));
    out.push(ledger({
      id: 'led-ecb', title: 'ECB / OATH violations', count: M.ecb.total ?? 0, D, source: 'ecb_violations', filterable: true,
      shown: retained(rows.length, M.ecb.total),
      cols: [{ h: 'Issued' }, { h: 'Severity' }, { h: 'Violation' }, { h: 'Status' }, { h: 'Penalty', cls: 'n' }],
      rows: rows.map((r) => {
        const open = /active|default|hearing|pending/i.test(r.ecb_violation_status || '') || !/resolve|dismiss|paid|cure/i.test(r.ecb_violation_status || '');
        return { closed: !open, cells: [
          date(r.issue_date), pill(String(r.severity || '?').replace(/^CLASS - /i, 'Class '), /CLASS - 1/i.test(r.severity) ? 'bad' : 'warn'),
          esc(cleanDesc(r.violation_description, 210)),
          `${pill(open ? 'Unresolved' : 'Resolved', open ? 'warn' : 'good')} ${rowLink(D, 'ecb_violations', { ecb_violation_number: r.ecb_violation_number }, '#' + r.ecb_violation_number)}`,
          `<span class="num">${num(r.penality_imposed) ? money(num(r.penality_imposed)) : '–'}</span>`,
        ] };
      }),
    }));
  }

  // permits
  {
    const rows = M.permits;
    out.push(ledger({
      id: 'led-pm', title: 'DOB NOW permit filings nearby', count: M.co.block_filings ?? rows.length, D, source: 'dob_now_filings',
      shown: `${rows.length} notable filings shown (lot, heavy and major jobs) of ${M.co.block_filings ?? '?'} on the block in 18 months`,
      cols: [{ h: 'Filed' }, { h: 'Where' }, { h: 'Type and status' }, { h: 'Work described' }, { h: 'Est. cost', cls: 'n' }],
      rows: rows.map((r) => ({ cells: [
        date(r.filing_date),
        `${esc(r.house_no || '')} ${esc(String(r.street_name || '').replace(/\s+/g, ' ').trim())}${[...r.tags].includes('This lot') ? '<small class="rec-mine">this lot</small>' : ''}`,
        `${esc(r.job_type || '')}<small>${esc(r.filing_status || '')}</small>${[...r.tags].includes('Heavy') ? ' ' + pill('Heavy', 'warn') : ''}`,
        `${esc(cleanDesc(r.job_description, 200))} ${rowLink(D, 'dob_now_filings', { job_filing_number: r.job_filing_number }, r.job_filing_number || '')}`,
        `<span class="num">${num(r.initial_cost) ? money(num(r.initial_cost)) : '–'}</span>`,
      ] })),
      note: 'A filing is a request to do work, not proof that work is under way. Heavy means demolition, new building or excavation.',
    }));
  }

  // bedbugs
  {
    const rows = M.bugRows;
    out.push(ledger({
      id: 'led-bb', title: 'Bedbug annual filings', count: rows.length, D, source: 'bedbugs',
      shown: 'Owner self-reports, newest first',
      cols: [{ h: 'Filing period' }, { h: 'Filed' }, { h: 'Units', cls: 'n' }, { h: 'Infested', cls: 'n' }, { h: 'Eradicated', cls: 'n' }, { h: 'Re-infested', cls: 'n' }],
      rows: rows.map((r) => ({ cells: [
        `${esc(fmtDate(parseDate(r.filing_period_start_date)))} to ${esc(fmtDate(parseDate(r.filling_period_end_date)))}`, date(r.filing_date),
        `<span class="num">${num(r.of_dwelling_units).toLocaleString()}</span>`,
        `<span class="num">${num(r.infested_dwelling_unit_count) ? pill(num(r.infested_dwelling_unit_count), 'warn') : '0'}</span>`,
        `<span class="num">${num(r.eradicated_unit_count)}</span>`, `<span class="num">${num(r.re_infested_dwelling_unit)}</span>`,
      ] })),
    }));
  }

  // 311 at the lot
  {
    const rows = (M.nz.at_building_recent || []).slice();
    const tally = {};
    rows.forEach((r) => { const k = noiseOutcome(r).k; tally[k] = (tally[k] || 0) + 1; });
    const sum = Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${v} ${k.toLowerCase()}`).join(', ');
    out.push(ledger({
      id: 'led-311', title: '311 noise requests logged at this lot', count: M.nz.at_building ?? rows.length, D, source: 'sr311',
      shown: `${rows.length} most recent${sum ? ' · ' + sum : ''}`,
      cols: [{ h: 'When' }, { h: 'Type' }, { h: 'Outcome logged' }],
      rows: rows.map((r) => {
        const t = niceNoise(`${r.complaint_type} | ${r.descriptor}`), o = noiseOutcome(r);
        return { cells: [
          `<span class="num rec-date">${esc(String(r.created_date || '').slice(0, 16).replace('T', ' '))}</span>`,
          `${esc(t.what)}<small>${esc(t.cat)}</small>`,
          `${pill(o.k, o.tone)}`,
        ] };
      }),
      note: 'Each row is a call to 311. "Closed" does not mean the noise was fixed: an agency visit that finds nothing at that moment still closes the request.',
    }));
  }
  return out.join('');
}
