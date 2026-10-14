// Tours: the renter's saved picks as a tier board (drag between S/A/B/C/Pass or use the tier buttons), notes
// and a tour time per pick, a suggested visiting order with walking minutes and a Google Maps route, and a
// printable call sheet per building. Picks live in this browser; backup and restore go through app.js.
import { S, on, byId, dest, cost, setPick, pick, exportPicks, importPicks, openDrawer, toggleCompare, score } from './app.js';
import { $, esc, money, ICONS, toast, scoreColor } from './util.js';
import { TIERS, groupKey, thumb, name, label, commuteHTML, gateFails, gateUnverified, walkMin } from './views/table-kit.js';

const PIN = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="3" y="2" width="10" height="12" rx="1.5"/><path d="M6 5h1M9 5h1M6 8h1M9 8h1M7 14v-3h2v3"/></svg>';

const LANES = [['', 'To sort', 'Saved, not tiered yet'], ['S', 'S', 'Top choices'], ['A', 'A', 'Strong'], ['B', 'B', 'Maybe'], ['C', 'C', 'Long shots'], ['Pass', 'Pass', 'Not for me']];
let shown = false, order = 'near', quiet = false;
const isOn = () => shown && S.view === 'tours';

const picks = () => Object.entries(S.picks).filter(([id, p]) => byId(id) && (p.saved || p.tier)).map(([id, p]) => ({ id, p, L: byId(id) }));
const fmtWhen = (v) => {
  if (!v) return '';
  const d = new Date(v); if (isNaN(d)) return esc(v);
  return d.toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
};

// ------------------------------------------------------------------ board
function cardHTML({ id, p, L }) {
  const c = cost(L);
  return `<article class="tc" draggable="true" tabindex="-1" data-id="${esc(id)}" aria-label="${esc(label(L))}">
    <div class="tc-top"><span class="th">${thumb(L, 48, 40)}</span>
      <div class="tc-t"><button type="button" class="tc-name" data-open="${esc(id)}">${name(L)}</button><span>${esc(L.neighborhood || L.address || '')}</span></div>
      <span class="tc-s" style="color:${scoreColor(score(L))}" title="Score with your weights">${Math.round(score(L) ?? 0)}</span></div>
    <div class="tc-meta"><b>${money(c)}</b>${L.sqft ? `<span>${Math.round(L.sqft)} ft²</span>` : ''}${commuteHTML(L)}</div>
    ${gateFails(L).length ? `<div class="tc-warn">${gateFails(L).map(esc).join(' · ')}</div>` : ''}
    <div class="tc-tiers" role="group" aria-label="Your tier for ${esc(label(L))}">${TIERS.map((t) => `<button type="button" data-tier="${t}" class="${p.tier === t ? 'on' : ''}" aria-pressed="${p.tier === t}">${t}</button>`).join('')}</div>
    <label class="tc-when"><span>Tour</span><input type="datetime-local" data-when="${esc(id)}" value="${esc(p.tour || '')}" aria-label="Tour date and time for ${esc(label(L))}"></label>
    <textarea class="tc-note" data-note="${esc(id)}" rows="2" maxlength="4000" placeholder="Notes: what you liked, what to ask" aria-label="Notes for ${esc(label(L))}">${esc(p.note || '')}</textarea>
    <div class="tc-acts"><button type="button" class="lnk" data-open="${esc(id)}">Details</button><button type="button" class="lnk" data-cmp="${esc(id)}">${S.compare.includes(id) ? 'Comparing' : 'Compare'}</button><span class="sp"></span><button type="button" class="lnk rm" data-rm="${esc(id)}" aria-label="Remove ${esc(label(L))} from your picks">${ICONS.x}</button></div>
  </article>`;
}
function boardHTML(P) {
  const byLane = (t) => P.filter((x) => (x.p.tier || '') === t).sort((a, b) => String(a.p.tour || '~').localeCompare(String(b.p.tour || '~')) || (score(b.L) ?? 0) - (score(a.L) ?? 0));
  return `<div class="tb">${LANES.map(([t, n, d]) => {
    const C = byLane(t);
    return `<section class="lane${C.length ? '' : ' is-empty'}${t === 'Pass' ? ' pass' : ''}" data-lane="${t}" aria-label="${esc(n)}: ${esc(d)}">
      <header><b class="lt${t ? ' t-' + t : ''}">${esc(n)}</b><span>${esc(d)}</span><i>${C.length}</i></header>
      <div class="lane-body">${C.map(cardHTML).join('') || '<div class="drop">Drag a pick here</div>'}</div></section>`;
  }).join('')}</div>`;
}

// ------------------------------------------------------------------ route
function stopsOf(P) {
  const m = new Map();
  for (const x of P) {
    if (x.p.tier === 'Pass' || x.L.lat == null || x.L.lon == null) continue;
    const k = groupKey(x.L);
    (m.get(k) || m.set(k, { k, L: x.L, lat: x.L.lat, lon: x.L.lon, units: [] }).get(k)).units.push(x);
  }
  for (const s of m.values()) { s.units.sort((a, b) => String(a.p.tour || '~').localeCompare(String(b.p.tour || '~'))); s.when = s.units.find((u) => u.p.tour)?.p.tour || null; }
  return [...m.values()];
}
function nearest(from, rest) {
  const out = []; let cur = from; const left = [...rest];
  while (left.length) {
    let bi = 0, bd = Infinity;
    left.forEach((s, i) => { const d = walkMin(cur, s); if (d < bd) { bd = d; bi = i; } });
    cur = left.splice(bi, 1)[0]; out.push(cur);
  }
  return out;
}
function plan(P) {
  const D = dest(), all = stopsOf(P);
  const start = D?.lat != null ? { lat: D.lat, lon: D.lon, name: D.name, address: D.address } : null;
  let seq;
  if (order === 'time') {
    const timed = all.filter((s) => s.when).sort((a, b) => a.when.localeCompare(b.when));
    const rest = all.filter((s) => !s.when);
    seq = [...timed, ...nearest(timed.at(-1) || start || rest[0] || {}, rest)];
  } else seq = start ? nearest(start, all) : all.length ? [all[0], ...nearest(all[0], all.slice(1))] : [];
  let prev = start, total = 0;
  for (const s of seq) { s.walk = prev ? walkMin(prev, s) : null; total += s.walk || 0; prev = s; }
  return { start, seq, total };
}
function mapsLinks(start, seq) {
  const pts = [start?.address || (start ? `${start.lat},${start.lon}` : null), ...seq.map((s) => s.L.address || `${s.lat},${s.lon}`)].filter(Boolean);
  const links = [];
  for (let i = 0; i < pts.length - 1; i += 9) {
    const seg = pts.slice(i, i + 10), o = seg[0], d = seg[seg.length - 1], w = seg.slice(1, -1);
    links.push(`https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(o)}&destination=${encodeURIComponent(d)}${w.length ? '&waypoints=' + w.map(encodeURIComponent).join('%7C') : ''}&travelmode=walking`);
  }
  return links;
}
function routeHTML(P) {
  const { start, seq, total } = plan(P);
  if (!seq.length) return `<div class="empty tr-empty"><b>No stops yet</b>Picks you have not passed on, with a location, become stops here.</div>`;
  const links = mapsLinks(start, seq);
  const list = `<ol class="stops">${start ? `<li class="st start"><span class="no">${PIN}</span><div><b>${esc(start.name || 'Start')}</b><span>${esc(start.address || '')}</span></div></li>` : ''}
    ${seq.map((s, i) => `<li class="st${s.walk != null ? ' has-walk' : ''}">${s.walk != null ? `<span class="leg-walk">${Math.round(s.walk)} min walk</span>` : ''}<span class="no">${i + 1}</span><div>
      <b>${esc(s.L.building || s.L.address)}</b><span>${esc(s.L.address || '')}</span>
      <div class="st-units">${s.units.map((u) => `<button type="button" class="st-u" data-open="${esc(u.id)}"><span class="pill ${u.p.tier && u.p.tier !== 'Pass' ? 'accent' : ''}">${esc(u.p.tier || '·')}</span>${esc(u.L.unit || label(u.L))}<b>${money(cost(u.L))}</b>${u.p.tour ? `<span class="when">${fmtWhen(u.p.tour)}</span>` : ''}</button>`).join('')}</div></div></li>`).join('')}</ol>`;
  return `<div class="tr-grid"><div class="tr-list">
      <div class="tr-sum"><div><b>${seq.length}</b><span>stop${seq.length > 1 ? 's' : ''}</span></div><div><b>${Math.round(total)}</b><span>min walking</span></div><div><b>${seq.length * 25}</b><span>min viewing, at ~25 each</span></div></div>
      ${list}
      <div class="tr-links">${links.map((u, i) => `<a class="btn ${i ? '' : 'primary'}" href="${esc(u)}" target="_blank" rel="noopener">${ICONS.ext}${links.length > 1 ? `Route part ${i + 1}` : 'Open route in Google Maps'}</a>`).join('')}</div>
      <p class="tr-note">Walking times are straight-line distance × 1.25 for the street grid at 4.8 km/h. The map link sends addresses only. Confirm every showing with the leasing office.</p>
    </div><div class="tr-map">${routeMap(start, seq)}</div></div>`;
}
function routeMap(start, seq) {
  const pts = [start, ...seq].filter(Boolean);
  const la = pts.map((p) => p.lat), lo = pts.map((p) => p.lon);
  const midLat = (Math.min(...la) + Math.max(...la)) / 2, kx = Math.cos((midLat * Math.PI) / 180);
  let x0 = Math.min(...lo) * kx, x1 = Math.max(...lo) * kx, y0 = Math.min(...la), y1 = Math.max(...la);
  const pad = Math.max((x1 - x0), (y1 - y0), 0.004) * 0.18; x0 -= pad; x1 += pad; y0 -= pad; y1 += pad;
  const W = 520, H = 440, sc = Math.min(W / (x1 - x0), H / (y1 - y0)), ox = (W - (x1 - x0) * sc) / 2, oy = (H - (y1 - y0) * sc) / 2;
  const P = (lat, lon) => [ox + (lon * kx - x0) * sc, H - oy - (lat - y0) * sc];
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Schematic map of the suggested visiting order"><defs><clipPath id="trClip"><rect width="${W}" height="${H}" rx="12"/></clipPath></defs><g clip-path="url(#trClip)"><rect width="${W}" height="${H}" class="bg"/>`;
  for (const f of S.transit?.features || []) {
    if (f.properties?.kind !== 'line') continue;
    const lines = f.geometry?.type === 'MultiLineString' ? f.geometry.coordinates : f.geometry?.type === 'LineString' ? [f.geometry.coordinates] : [];
    const d = lines.map((ln) => ln.map(([lon, lat], i) => { const [x, y] = P(lat, lon); return `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`; }).join('')).join('');
    s += `<path d="${d}" class="tl" stroke="${esc(f.properties.color || 'var(--ink-4)')}"/>`;
  }
  const path = pts.map((p, i) => { const [x, y] = P(p.lat, p.lon); return `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`; }).join('');
  s += `<path d="${path}" class="rt"/>`;
  if (start) { const [x, y] = P(start.lat, start.lon); s += `<g class="sp"><rect x="${x - 9}" y="${y - 9}" width="18" height="18" rx="5"/><text x="${x}" y="${y - 14}" text-anchor="middle">${esc(start.name || 'Start')}</text></g>`; }
  seq.forEach((st, i) => { const [x, y] = P(st.lat, st.lon); s += `<g class="sn" data-open="${esc(st.units[0].id)}"><circle cx="${x}" cy="${y}" r="10"/><text x="${x}" y="${y + 3.6}" text-anchor="middle">${i + 1}</text><title>${esc(st.L.building || '')}</title></g>`; });
  return s + `</g></svg><div class="tr-cap">${S.transit ? 'Subway lines in agency colours' : 'Schematic'} · north up · not to street detail</div>`;
}

// ------------------------------------------------------------------ call sheets
const moveIn = () => S.crit.search?.move_in?.earliest || 'my';
function questions(L) {
  const q = [
    `Exact square footage and a floor plan that shows which way the windows face${L.exposure?.length ? ` (listed as ${L.exposure.join('/')})` : ''}.`,
    `Gross monthly rent${L.price?.gross ? ` (listed at ${money(L.price.gross)})` : ''}, any concession (free months) and the lease lengths it applies to.`,
    'All recurring fees (amenity, gym, pet, water, trash, internet, storage) and one-time fees (application, move-in, broker), with amounts.',
    'Is the unit rent-stabilised or under a regulatory agreement? The legal rent, any preferential rent, renewal terms and lease riders.',
    `Earliest and latest lease start, and whether the concession applies to a ${moveIn()} start.`,
    'Early-termination and sublet policy.',
    'Heating and cooling in the unit, and how utilities are billed.',
    'Construction or facade work planned in or next to the building in the next 12 months.',
    'Refuse pickup times and location (for street-facing units).',
  ];
  const u = gateUnverified(L);
  if (u.length) q.unshift(`Please confirm in writing: ${u.join(', ')}.`);
  if (!L.sqft) q[u.length ? 1 : 0] = 'Square footage is not published: exact square footage and a floor plan with the window orientation.';
  return q;
}
const CHECK = ['Unit number, floor and which way the main windows face (compass app at the window)', 'Measure the bedroom and living room; does the bed, sofa and desk fit?', 'Washer/dryer in the unit and working', 'Water pressure and hot-water time in kitchen and shower', 'HVAC on: how loud in the bedroom? Off: street noise with windows closed, then open', 'Phone signal in each room', 'Light at this hour against the model', 'Hallway, elevator wait, package and trash rooms', 'Amenities open, their hours and fees'];
function sheetHTML(s) {
  const L0 = s.L, noisy = s.units.some((u) => (u.L.records?.noise_score ?? 100) < 60);
  const notes = s.units.filter((u) => u.p.note), open = [...new Set(s.units.map((u) => u.L.notes).filter(Boolean))];
  return `<article class="sheet" data-sheet="${esc(s.k)}">
    <header class="sh-h"><div><span class="sh-k">Call sheet</span><h3>${esc(L0.building || L0.address)}</h3><p>${esc(L0.address || '')}${L0.neighborhood ? ' · ' + esc(L0.neighborhood) : ''}</p></div>
      <button type="button" class="btn no-print" data-print="${esc(s.k)}"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4.5 6V2h7v4M4.5 12H3a1 1 0 01-1-1V7a1 1 0 011-1h10a1 1 0 011 1v4a1 1 0 01-1 1h-1.5M4.5 9.5h7V14h-7z"/></svg>Print</button></header>
    <table class="mini sh-units"><thead><tr><th>Unit</th><th>Your tier</th><th class="n">Monthly</th><th class="n">Gross</th><th class="n">ft²</th><th>Floor</th><th>Available</th><th>Tour</th></tr></thead><tbody>
      ${s.units.map((u) => `<tr><td><b>${esc(u.L.unit || '—')}</b></td><td>${esc(u.p.tier || '—')}</td><td class="n">${money(cost(u.L))}</td><td class="n">${money(u.L.price?.gross)}</td><td class="n">${u.L.sqft ? Math.round(u.L.sqft) : '—'}</td><td>${u.L.floor != null ? Math.round(u.L.floor) + (u.L.floor_inferred ? '?' : '') : '—'}${u.L.exposure?.length ? ' · ' + esc(u.L.exposure.join('/')) : ''}</td><td>${esc(u.L.available || '—')}</td><td>${u.p.tour ? fmtWhen(u.p.tour) : '<span class="blank"></span>'}</td></tr>`).join('')}</tbody></table>
    <div class="sh-cols"><section><h4>Ask the leasing office</h4><ol>${questions(L0).map((q) => `<li>${esc(q)}</li>`).join('')}</ol></section>
      <section>${open.length ? `<h4>Open questions from research</h4>${open.map((n) => `<p class="sh-open">${esc(n)}</p>`).join('')}` : ''}
        ${notes.length ? `<h4>Your notes</h4>${notes.map((u) => `<p class="sh-open"><b>${esc(u.L.unit || '')}</b> ${esc(u.p.note)}</p>`).join('')}` : ''}
        <h4>On the visit</h4><ul class="sh-check">${CHECK.map((c) => `<li>${esc(c)}</li>`).join('')}${noisy ? '<li><b>Night check:</b> visit the block 11:30 pm to 1:30 am; note trucks, bars and horns</li>' : ''}</ul></section></div>
    <div class="sh-lines"><h4>Notes from the call</h4><i></i><i></i><i></i><i></i></div>
  </article>`;
}

// ------------------------------------------------------------------ render
function draw() {
  if (!shown) return;
  const f = document.activeElement, fid = $('view-tours').contains(f) ? f.closest('[data-id]')?.dataset.id : null;
  const fsel = fid && ['tier', 'open', 'cmp'].map((k) => (f.dataset[k] != null ? `[data-${k}="${CSS.escape(f.dataset[k])}"]` : null)).find(Boolean);
  render();
  if (fid) ($('view-tours').querySelector(`.tc[data-id="${CSS.escape(fid)}"] ${fsel || ''}`) || $('view-tours').querySelector(`.tc[data-id="${CSS.escape(fid)}"]`))?.focus({ preventScroll: true });
}
function render() {
  const P = picks(), el = $('trBody');
  const nSaved = P.length, top = P.filter((x) => x.p.tier === 'S' || x.p.tier === 'A').length, booked = P.filter((x) => x.p.tour).length;
  $('trSub').textContent = nSaved ? `${nSaved} saved pick${nSaved > 1 ? 's' : ''} · ${top} in S or A · ${booked} with a tour time. Kept in this browser; back them up below.` : 'Save homes as you research, sort them into tiers, then plan the visits.';
  if (!nSaved) {
    el.innerHTML = `<div class="empty tr-none"><div class="tr-ill" aria-hidden="true">${ICONS.star}</div><b>No saved picks yet</b>
      <span>Star a home on any card or in the listing panel, or press <kbd>s</kbd> with a listing open. Picks appear here, ready to sort into tiers, annotate and route.</span>
      <div class="tr-cta"><a class="btn primary" href="#map">Browse the map</a><a class="btn" href="#list">Open the shortlist</a><label class="btn ghost">Restore a backup<input type="file" accept="application/json,.json" data-import hidden></label></div></div>`;
    return;
  }
  const stops = stopsOf(P);
  el.innerHTML = `${boardHTML(P)}
    <section class="panel tr-route"><h3>Tour plan <span>${stops.length} building${stops.length === 1 ? '' : 's'}, Pass excluded</span></h3>
      <div class="row tr-ctl"><div class="seg" id="trOrder" role="group" aria-label="Visiting order"><button type="button" data-o="near" class="${order === 'near' ? 'on' : ''}" aria-pressed="${order === 'near'}">Nearest next</button><button type="button" data-o="time" class="${order === 'time' ? 'on' : ''}" aria-pressed="${order === 'time'}">By tour time</button></div>
        <span class="faint">${dest() ? `Starting from ${esc(dest().name)}` : 'Starting from the first pick'}</span></div>
      ${routeHTML(P)}</section>
    <section class="tr-sheets"><div class="sheets-h"><h2>Call sheets</h2><p>One page per building: the units, your notes, the research's open questions and what to ask.</p><button type="button" class="btn" data-print="*">Print all</button></div>
      ${stops.length ? plan(P).seq.map(sheetHTML).join('') : '<div class="empty">Call sheets need picks with a location that you have not passed on.</div>'}</section>`;
}

function printSheets(k) {
  document.querySelectorAll('#view-tours .sheet').forEach((s) => s.classList.toggle('print-me', k === '*' || s.dataset.sheet === k));
  document.body.classList.add('tr-printing');
  const done = () => { document.body.classList.remove('tr-printing'); removeEventListener('afterprint', done); };
  addEventListener('afterprint', done);
  window.print();
  setTimeout(done, 1000);
}

export function init() {
  $('view-tours').innerHTML = `<div class="view-pad tr-pad">
    <div class="page-h no-print"><div class="t"><h1>Tours</h1><p id="trSub"></p></div>
      <div class="actions"><button type="button" class="btn" id="trExport"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M8 2v8M4.5 6.5L8 10l3.5-3.5M3 13h10"/></svg>Back up picks</button>
        <label class="btn" id="trImport"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M8 10V2M4.5 5.5L8 2l3.5 3.5M3 13h10"/></svg>Restore<input type="file" accept="application/json,.json" data-import hidden></label></div></div>
    <div id="trBody"></div></div>`;
  const V = $('view-tours');
  V.addEventListener('click', (e) => {
    const t = e.target.closest('[data-open],[data-cmp],[data-rm],[data-tier],[data-o],[data-print],#trExport'); if (!t) return;
    const card = t.closest('[data-id]'), id = card?.dataset.id;
    if (t.id === 'trExport') exportPicks();
    else if (t.dataset.print) printSheets(t.dataset.print);
    else if (t.dataset.o) { order = t.dataset.o; draw(); }
    else if (t.dataset.tier && id) { const cur = pick(id).tier; setPick(id, { tier: cur === t.dataset.tier ? null : t.dataset.tier, saved: true }); }
    else if (t.dataset.rm) { setPick(t.dataset.rm, { saved: false, tier: null }); toast('Removed from your picks'); }
    else if (t.dataset.cmp) toggleCompare(t.dataset.cmp);
    else if (t.dataset.open) openDrawer(t.dataset.open);
  });
  V.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.import != null && t.files?.[0]) { importPicks(t.files[0]); t.value = ''; return; }
    const id = t.dataset.note || t.dataset.when; if (!id) return;
    quiet = true;
    setPick(id, t.dataset.note ? { note: t.value.slice(0, 4000), saved: true } : { tour: t.value || null, saved: true });
    quiet = false;
    if (t.dataset.when) draw();
  });
  // drag a card between tiers
  let dragId = null;
  V.addEventListener('dragstart', (e) => { const c = e.target.closest?.('.tc'); if (!c) return; dragId = c.dataset.id; e.dataTransfer.setData('text/plain', dragId); e.dataTransfer.effectAllowed = 'move'; c.classList.add('dragging'); });
  V.addEventListener('dragend', (e) => { e.target.closest?.('.tc')?.classList.remove('dragging'); V.querySelectorAll('.lane.over').forEach((l) => l.classList.remove('over')); dragId = null; });
  V.addEventListener('dragover', (e) => { const l = e.target.closest('.lane'); if (!l || !dragId) return; e.preventDefault(); V.querySelectorAll('.lane.over').forEach((x) => x !== l && x.classList.remove('over')); l.classList.add('over'); });
  V.addEventListener('drop', (e) => { const l = e.target.closest('.lane'); if (!l) return; e.preventDefault(); const id = dragId || e.dataTransfer.getData('text/plain'); if (id && byId(id)) setPick(id, { tier: l.dataset.lane || null, saved: true }); });
  on('saved', () => { if (isOn() && !quiet) draw(); });
  on('compare', () => isOn() && draw());
  on('weights', () => isOn() && !V.contains(document.activeElement) && draw());
}

export function show() { shown = true; draw(); }
