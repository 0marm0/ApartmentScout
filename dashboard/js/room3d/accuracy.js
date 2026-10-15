// "What's measured vs assumed": a compact chip over both 3D views (Unit 3D and the Floor plan studio) that says, in seven rows, what the picture rests
// on: building heights, the facade bearing, the position along the facade, the floor height, the plan, the finishes and the furniture, each marked
// measured / confirmed / from a source / estimated / assumed. accuracyRows() is pure (no DOM, no three.js), so both engines build the same
// rows from the same site file, and it is testable in node. The chip links to the existing evidence (Unit 3D's "Assumptions and evidence" panel).
import { esc } from '../util.js';
import { normaliseFinishes, finishLeaves } from '../plan/finishes.js';   // [finishes] pure: what the room's floor, paint and kitchen rest on
import { lookBasis, lookSummary, describeLook } from '../plan/looks.js';   // the renter's colours and materials, and which of them are guesses
import { photoLabel, fitLabel } from '../unit/view-calibration.js';

/** Row states, in the order they are counted, with the word the chip uses and a one-line meaning. */
export const STATES = {
  measured: ['measured', 'Taken from a measurement or from photographs you matched'],
  confirmed: ['confirmed', 'Confirmed by you'],
  source: ['from a source', 'Read from a published dataset or drawing'],
  estimated: ['estimated', 'Worked out from other numbers; it can be off'],
  assumed: ['assumed', 'A default or a guess: change it if you know better'],
};

const HSRC = { roof: 'a surveyed roof height', 'pluto-floors': 'the number of floors', 'osm-height': 'an OpenStreetMap height', 'osm-levels': 'OpenStreetMap levels', default: 'a 10 m default' };
const pct = (n, d) => (d ? Math.round((100 * n) / d) : 0);

/**
 * @param {{site: object, plan?: object|null, cal?: {state?: string, fh?: number, slab?: number}|null, floor?: number, pinned?: boolean,
 *   furniture?: {name?: string, source?: string, confirmed?: {by?: string, date?: string}|null, count?: number}|null, facing?: number|null, t?: number|null,
 *   viewCal?: object|null}} o
 *   `site` = the site file; `plan` = the plan JSON (raw or normalised: only `source` and `provenance` are read); `cal` = unit/calibration.js resolveCal();
 *   `facing`/`t` = the window's bearing and position along its facade as the view uses them; `viewCal` = a saved photo match (unit/view-calibration.js),
 *   which turns the bearing row (and the floor-height row when the photo could fix the height) to "measured from photo N"
 * @returns {{key: string, label: string, state: keyof STATES, text: string}[]}
 */
export function accuracyRows(o) {
  const site = o.site || {}, P = site.provenance && typeof site.provenance === 'object' ? site.provenance : {}, rows = [];
  // 1. building heights
  const bm = Array.isArray(site.bmeta) ? site.bmeta.filter(Boolean) : [], total = bm.length || (Array.isArray(site.b) ? site.b.length : 0);
  if (total) {
    const counts = {}; for (const m of bm) counts[m.height_src || '?'] = (counts[m.height_src || '?'] || 0) + 1;
    const roof = (counts.roof || 0) + (counts['osm-height'] || 0), guess = (counts.default || 0);
    const parts = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n.toLocaleString()} from ${HSRC[k] || k}`).join(', ');
    rows.push({ key: 'heights', label: 'Building heights', state: bm.length && pct(roof, total) >= 60 ? 'source' : 'estimated',
      text: `${total.toLocaleString()} buildings from the city's footprints and PLUTO${parts ? `: ${parts}` : ''}${guess ? `; ${guess} are a default guess` : ''}. A footprint pushed up to its roof is not the real shape.` });
  } else rows.push({ key: 'heights', label: 'Building heights', state: 'assumed', text: 'No building model for this unit: the city is not drawn.' });
  // 2. facade bearing
  const exp = o.facing != null ? Math.round(o.facing) : site.window?.bearing != null ? Math.round(site.window.bearing) : null;
  const fsrc = P.exposure || (o.plan ? 'plan' : 'assumed');
  const fstate = { 'photo-landmarks': 'measured', manual: 'measured', listing: 'source', plan: 'source', agent: 'estimated', inferred: 'estimated' }[fsrc] || 'assumed';
  const vc = o.viewCal && o.viewCal.result ? o.viewCal : null;
  if (vc) rows.push({ key: 'bearing', label: 'Facade bearing', state: 'measured', text: `${exp != null ? `${exp}°` : `${Math.round(vc.result.bearing_deg)}°`}, measured from ${esc(photoLabel(vc))}: the photo looks toward ${Math.round(vc.result.bearing_deg)}° (${esc(fitLabel(vc))}${vc.result.sigma?.bearing != null ? `, ±${vc.result.sigma.bearing.toFixed(1)}°` : ''}).` });
  else rows.push({ key: 'bearing', label: 'Facade bearing', state: fstate, text: `${exp != null ? `${exp}°` : 'Unknown'}${fsrc === 'photo-landmarks' ? ', matched against landmarks in your photos' : fsrc === 'manual' ? ', set by you' : fsrc === 'listing' ? ', from the listing' : ', not confirmed'}${P.basis ? ` (${esc(P.basis)})` : ''}.` });
  // 3. position along the facade
  const wp = P.window_position || 'assumed', t = o.t ?? site.window?.t;
  rows.push({ key: 'position', label: 'Position along the facade', state: wp === 'manual' ? 'measured' : wp === 'assumed' ? 'assumed' : 'source',
    text: `${t != null ? `${Math.round(t * 100)} % along its facade` : 'Not set'}: ${wp === 'manual' ? 'set by you' : 'where a unit sits along its wall is rarely published, so the model puts the window in the middle of the clear stretch'}.` });
  // 4. floor height
  const cal = o.cal || {}, measured = cal.state === 'measured';
  const fh = Number.isFinite(cal.fh) ? cal.fh : site.floor_height_m;
  const fromPhoto = vc && vc.result.eye_determined && measured && /^photo/.test(String(cal.src || ''));
  rows.push({ key: 'floor-height', label: 'Floor height', state: measured ? 'measured' : 'estimated',
    text: fromPhoto ? `Measured from ${esc(photoLabel(vc))}: the camera stood ${vc.result.eye_height_m.toFixed(1)} m up${vc.result.sigma?.eye != null ? ` (±${vc.result.sigma.eye.toFixed(1)} m)` : ''}${Number.isFinite(cal.slab) ? `, so floor ${Math.round(o.floor || vc.photo.floor)}'s slab is at ${cal.slab.toFixed(1)} m` : ''}.${vc.photo.floor !== Math.round(o.floor || vc.photo.floor) ? ` The photo was taken on floor ${vc.photo.floor}: every storey is scaled to it.` : ''}`
    : vc && !vc.result.eye_determined && !measured ? `${Number.isFinite(fh) ? `${(+fh).toFixed(2)} m a floor` : 'A floor height'}, estimated from the roof height and the floor count. Your photo match could not fix the camera height (its landmarks sit at similar distances), so it stays an estimate.`
    : measured ? `A measured slab or eye height${Number.isFinite(cal.slab) ? ` (slab at ${cal.slab.toFixed(1)} m)` : ''}.` : `${Number.isFinite(fh) ? `${(+fh).toFixed(2)} m a floor` : 'A floor height'}, estimated from the roof height and the floor count${o.floor ? `; floor ${Math.round(o.floor)}'s slab follows from it` : ''}. A measured slab replaces it (Model ▸ Height).` });
  // 5. plan
  const plan = o.plan || null;
  if (plan) {
    const src = String(plan.source || ''), m = plan.provenance?.match;
    const glen = /Glenwood/i.test(src) ? `Glenwood's ${/E[- ]line/i.test(src + (plan.title || '')) ? 'E-line ' : ''}drawing` : src.split(/[.(]/)[0].slice(0, 70) || 'a floor plan';
    rows.push({ key: 'plan', label: 'Floor plan', state: m === 'exact' || m === 'unit' ? 'source' : 'source', text: `${esc(glen)}${m ? `, matched as ${esc(String(m))}` : ''}. A tracing scaled from printed room sizes, not a survey; window sill and head heights are estimated.` });
  } else rows.push({ key: 'plan', label: 'Floor plan', state: 'assumed', text: 'A generic room: no floor plan for this unit.' });
  // 6. finishes: which of the floor, paint, kitchen and window frames come from the unit's photos or the listing and which are defaults
  rows.push(finishesRow(plan));
  // 7. furniture
  const f = o.furniture;
  if (f && f.confirmed) rows.push({ key: 'furniture', label: 'Furniture', state: 'confirmed', text: `${esc(f.name || 'Your furniture')}${f.count ? `: ${f.count} piece${f.count === 1 ? '' : 's'}` : ''}, your own, confirmed${f.confirmed.date ? ` on ${esc(f.confirmed.date)}` : ''}. Sizes are real, from you; positions are placed with the fit checks. ${lookText(f.looks)}` });
  else if (f) rows.push({ key: 'furniture', label: 'Furniture', state: 'assumed', text: `${esc(f.name || 'A starter layout')}: catalogue pieces at typical sizes, not yet confirmed as yours.` });
  else rows.push({ key: 'furniture', label: 'Furniture', state: 'assumed', text: 'No furniture layout for this unit.' });
  return rows;
}

/** One or two sentences on the pieces' colours and materials: how many come from the renter, an example, and what is still a stand-in. */
function lookText(l) {
  if (!l || !l.total) return 'No colours or materials are recorded for them, so every look is a stand-in.';
  const ex = l.example ? ` (${esc(l.example)})` : '', rest = l.assumed ? `${l.assumed} ${l.assumed === 1 ? 'piece has' : 'pieces have'} only a stand-in look` : 'every piece has a look from you';
  return `Colours and materials: ${l.renter} of ${l.total} from you${ex}; ${rest}${l.guesses?.length ? `, and some details (${l.guesses.map(esc).join(', ')}) are still guesses` : ''}.`;
}

const FIN_PHRASE = (l) => `${l.label.toLowerCase()}${l.pattern ? ` (${l.pattern}${l.tone ? `, ${l.tone}` : ''})` : l.colour ? ` (${l.colour})` : l.tone ? ` (${l.tone})` : ''}`;
/** The "Finishes" row: what in the room's floor, walls, ceiling, kitchen, bath, window frames and doors is read from photos or the listing, and what is assumed. Pure. */
export function finishesRow(plan) {
  const { finishes } = normaliseFinishes(plan?.finishes, plan?.floor_finish), leaves = finishLeaves(finishes);
  const base = ['floor', 'walls', 'ceiling', 'window frames', 'doors'];
  if (!plan) return { key: 'finishes', label: 'Finishes', state: 'assumed', text: 'A generic room: oak floor, white walls. No unit to match.' };
  const group = (b) => leaves.filter((l) => l.basis === b);
  const named = (b) => group(b).map(FIN_PHRASE).join(', ');
  const stated = new Set(leaves.map((l) => l.label.toLowerCase())), defaults = [...group('assumed').map((l) => l.label.toLowerCase()), ...base.filter((k) => !stated.has(k))];
  const real = group('renter').length + group('photos').length + group('listing_text').length;
  if (!real) return { key: 'finishes', label: 'Finishes', state: 'assumed', text: `Default finishes (${defaults.length ? esc(defaults.join(', ')) : 'floor, walls, ceiling, kitchen'}): not matched to this unit's photos. Run <code>apartmentscout finishes</code> to read them from the listing photos.` };
  const parts = [];
  if (group('renter').length) parts.push(`set by you: ${esc(named('renter'))}`);
  if (group('photos').length) parts.push(`read from the unit's photos: ${esc(named('photos'))}`);
  if (group('listing_text').length) parts.push(`from the listing text: ${esc(named('listing_text'))}`);
  if (defaults.length) parts.push(`assumed: ${esc(defaults.join(', '))}`);
  const ev = group('photos').filter((l) => l.evidence).slice(0, 3).map((l) => `${esc(l.label.toLowerCase())}: ${esc(l.evidence)}`);
  const state = group('renter').length >= real && real >= defaults.length ? 'confirmed' : real >= defaults.length ? 'source' : 'estimated';
  return { key: 'finishes', label: 'Finishes', state, text: `${parts.join('; ')}.${ev.length ? ` Evidence: ${ev.join('; ')}.` : ''} Photo tones are sampled from lit, often virtually staged marketing pictures, so they can be a shade off.` };
}

/** The chip's one-line summary: "2 measured · 1 confirmed · 2 from a source · …" for the states in use, in a fixed order. */
export function accuracySummary(rows) {
  const n = {}; for (const r of rows) n[r.state] = (n[r.state] || 0) + 1;
  return Object.keys(STATES).filter((k) => n[k]).map((k) => `${n[k]} ${STATES[k][0]}`).join(' · ');
}

/**
 * The chip as a DOM element (a button that opens a small panel) for a host stage. `onOpen()` runs from the panel's "Open the evidence" button.
 * `host` = 'unit' | 'studio' positions it. The element is returned unattached; call update(rows) whenever the facts change.
 */
export function accuracyChip({ host = 'unit', onOpen, openLabel = 'Open the evidence' } = {}) {
  const el = document.createElement('div');
  el.className = 'float acc-chip'; el.dataset.host = host; el.hidden = true;
  const id = `acc-pop-${host}`;
  el.innerHTML = `<button type="button" class="acc-btn" aria-expanded="false" aria-controls="${id}"><span class="acc-dots" aria-hidden="true"></span><span class="acc-t">What's measured vs assumed</span></button>
    <div class="acc-pop" id="${id}" role="region" aria-label="What is measured and what is assumed" hidden><ul class="acc-list"></ul><div class="acc-foot"><span class="acc-sum"></span><button type="button" class="btn acc-open">${esc(openLabel)}</button></div></div>`;
  const btn = el.querySelector('.acc-btn'), pop = el.querySelector('.acc-pop');
  const set = (open) => { pop.hidden = !open; btn.setAttribute('aria-expanded', String(open)); };
  btn.addEventListener('click', () => set(pop.hidden));
  el.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !pop.hidden) { set(false); btn.focus(); e.stopPropagation(); } });
  el.querySelector('.acc-open').addEventListener('click', () => { set(false); onOpen?.(); });
  return {
    el,
    update(rows) {
      el.hidden = !rows?.length;
      el.querySelector('.acc-dots').innerHTML = (rows || []).map((r) => `<i class="acc-${r.state}" title="${esc(r.label)}: ${esc(STATES[r.state][0])}"></i>`).join('');
      el.querySelector('.acc-list').innerHTML = (rows || []).map((r) => `<li data-row="${esc(r.key)}"><div class="acc-k"><b>${esc(r.label)}</b><span class="acc-pill acc-${r.state}" title="${esc(STATES[r.state][1])}">${esc(STATES[r.state][0])}</span></div><p>${r.text}</p></li>`).join('');
      el.querySelector('.acc-sum').textContent = accuracySummary(rows || []);
      btn.setAttribute('aria-label', `What's measured vs assumed: ${accuracySummary(rows || [])}`);
    },
  };
}

/** How many pieces have a look from the renter, one example, and the details still guessed (from each look's `assumed` list). */
export function looksMeta(pieces) {
  if (!Array.isArray(pieces)) return null;
  const ok = pieces.filter((p) => p && typeof p === 'object'), sum = lookSummary({ pieces: ok }), guesses = new Set();
  for (const p of ok) if (lookBasis(p.look) === 'renter' && Array.isArray(p.look.assumed)) for (const g of p.look.assumed.slice(0, 6)) if (typeof g === 'string' && g.length < 24) guesses.add(g);
  const eg = ok.find((p) => p.id === 'futon' && p.look) || ok.find((p) => lookBasis(p.look) === 'renter');
  return { ...sum, example: eg ? `the ${String(eg.label || eg.id).split(',')[0].toLowerCase()} is ${describeLook({ color: eg.look.color, material: eg.look.material })}` : '', guesses: [...guesses].filter((g) => !/^(finish|shade)$/.test(g)).slice(0, 6) };
}

let furnitureMeta;
/** The renter's furniture file's name, source and confirmation ({name, source, confirmed, count}), or null; read once per page. */
export async function loadFurnitureMeta(base, manifest) {
  if (furnitureMeta !== undefined) return furnitureMeta;
  furnitureMeta = null;
  if (!manifest?.furniture) return null;
  try {
    const raw = await (await fetch(`${base}/furniture.json`)).json();
    if (raw && raw.kind === 'apartmentscout-furniture') furnitureMeta = { name: typeof raw.name === 'string' ? raw.name : 'Your furniture', source: typeof raw.source === 'string' ? raw.source : '', confirmed: raw.confirmed && typeof raw.confirmed === 'object' ? { by: String(raw.confirmed.by || ''), date: String(raw.confirmed.date || '') } : null, count: Array.isArray(raw.pieces) ? raw.pieces.length : 0, looks: looksMeta(raw.pieces) };
  } catch { furnitureMeta = null; }
  return furnitureMeta;
}
