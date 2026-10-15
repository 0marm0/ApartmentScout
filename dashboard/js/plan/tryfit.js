// "Does it fit?": a piece the catalogue does not have ("Bookshelf 36 x 12 x 72 in"), or a catalogue piece or product, dropped
// into a room, and a plain-language answer for where it stands: the studio's fit checks (walls, fixtures, other pieces, door
// swings, clearance zones), the space on each side of it, how it sits against a window sill, and what it does to the walk from the
// front door. Pure (no DOM, no three.js), so node:test covers it; the Furniture tab only draws what this returns.
//
// Sizes are inches in the plan frame, as everywhere in the studio.
import { CATALOG } from './catalog.js';
import { evaluate, gapRays, footprint, worst } from './checks.js';
import { pointInPoly, segDist } from './model.js';

export const MAX_SIZE = 300;
const UNITS = [
  [/^(?:inches|inch|in|″|")$/i, 1], [/^(?:feet|foot|ft|′|')$/i, 12], [/^(?:centimetres|centimeters|cm)$/i, 1 / 2.54],
  [/^(?:millimetres|millimeters|mm)$/i, 1 / 25.4], [/^(?:metres|meters|metre|meter|m)$/i, 39.37007874],
];
const unitFactor = (u) => { for (const [re, k] of UNITS) if (re.test(u)) return k; return null; };
const AXIS = { w: 'w', wide: 'w', width: 'w', l: 'w', long: 'w', length: 'w', d: 'd', deep: 'd', depth: 'd', h: 'h', high: 'h', tall: 'h', height: 'h' };

/**
 * Read a typed piece: a name and up to three sizes. "Bookshelf 36 x 12 x 72 in", "90 x 30 x 180 cm sofa", "desk 4ft x 2ft",
 * "dresser W 55 D 19 H 31", "wardrobe 3'4\" x 1'10\" x 6'8\"". Three sizes read as width x depth x height, two as width x depth
 * (the height then comes from the catalogue's idea of that piece); a letter W, D, H or L next to a size says which it is. A
 * size without its own unit takes the nearest unit written beside the run, else inches.
 * @returns {{ok: true, label: string, w: number, d: number, h: number, heightGiven: boolean, ref: string, text: string} | {ok: false, error: string}}
 */
export function parsePiece(input) {
  if (typeof input !== 'string') return { ok: false, error: 'Type a piece and its size, like "Bookshelf 36 x 12 x 72 in".' };
  const raw = input.replace(/\s+/g, ' ').trim();
  if (raw.length > 120) return { ok: false, error: 'That is too long: a name and up to three sizes is enough.' };
  const s = raw.replace(/[×✕*]/g, ' x ').replace(/\bby\b/gi, ' x ');
  // numbers: feet'inches" first, else a number with an optional unit; an axis letter may come before or after
  const re = /(?:(?<pre>\b(?:width|depth|height|length|w|d|h|l)\b)\s*[:=]?\s*)?(?:(?<ft>\d+(?:\.\d+)?)\s*(?:ft\b|feet\b|foot\b|′|')\s*(?<in>\d+(?:\.\d+)?)?\s*(?:inches\b|inch\b|in\b|″|")?|(?<n>\d+(?:[.,]\d+)?)\s*(?<u>inches\b|inch\b|in\b|″|"|centimetres\b|centimeters\b|cm\b|millimetres\b|millimeters\b|mm\b|metres\b|meters\b|metre\b|meter\b|m\b|feet\b|foot\b|ft\b|′|')?)(?:\s*(?<post>(?:wide\b|deep\b|high\b|tall\b|long\b|(?<![a-z])[whdl](?![a-z]))(?!\s*[:=]?\s*\d)))?/gi;
  const found = []; let m;
  while ((m = re.exec(s))) {
    const g = m.groups; let value, unit = null;
    if (g.ft != null) { value = +g.ft * 12 + (g.in != null ? +g.in : 0); unit = 'ft'; }
    else { value = +String(g.n).replace(',', '.'); unit = g.u || null; }
    const axisWord = (g.pre || g.post || '').toLowerCase();
    found.push({ value, unit, axis: AXIS[axisWord] || null, at: m.index, end: m.index + m[0].length, compound: g.ft != null });
  }
  if (!found.length) return { ok: false, error: 'Add its size, like "Bookshelf 36 x 12 x 72 in" (width x depth x height).' };
  if (found.length > 3) return { ok: false, error: 'Use up to three sizes: width x depth x height.' };
  // units: each size's own, else the nearest unit in the run (the one after it first), else inches
  const run = found.map((f) => f.unit ? unitFactor(f.unit) : null);
  found.forEach((f, i) => {
    if (run[i] != null || f.compound) { f.k = f.compound ? 1 : run[i]; return; }
    let k = null; for (let j = i + 1; j < found.length && k == null; j++) k = run[j] ?? (found[j].compound ? 1 : null);
    for (let j = i - 1; j >= 0 && k == null; j--) k = run[j] ?? (found[j].compound ? 1 : null);
    f.k = k ?? 1;
  });
  for (const f of found) f.inches = f.compound ? f.value : f.value * f.k;
  // the name is what is left once the sizes and their joining x's are taken out
  let label = ''; let pos = 0;
  for (const f of found) { label += s.slice(pos, f.at); pos = f.end; }
  label += s.slice(pos);
  label = label.replace(/\s+x\s+/gi, ' ').replace(/[:,;()\[\]]/g, ' ').replace(/\b(?:size|sized|dimensions?|dims?|approx|approximately|about)\b/gi, ' ').replace(/\s+/g, ' ').replace(/^[\s\-–—x]+|[\s\-–—x]+$/gi, '').trim();
  label = label.slice(0, 80);
  // which size is which
  const dims = { w: null, d: null, h: null }, order = ['w', 'd', 'h'], free = [];
  for (const f of found) { if (f.axis && dims[f.axis] == null) dims[f.axis] = f.inches; else free.push(f); }
  for (const f of free) { const slot = order.find((k) => dims[k] == null); if (slot) dims[slot] = f.inches; }
  const ref = guessRef(label, dims.w);
  const fallbackH = CATALOG[ref]?.h ?? 30;
  const heightGiven = dims.h != null;
  if (dims.w == null || dims.d == null) {
    if (dims.w == null && dims.d == null) return { ok: false, error: 'Give at least a width and a depth.' };
    if (dims.d == null) return { ok: false, error: 'Give a depth as well, like "36 x 12 x 72 in" (width x depth x height).' };
  }
  const out = { w: dims.w, d: dims.d, h: dims.h ?? fallbackH };
  for (const k of ['w', 'd', 'h']) {
    if (!(out[k] >= 1)) return { ok: false, error: 'Every size must be at least 1 in.' };
    if (out[k] > MAX_SIZE) return { ok: false, error: `${k === 'w' ? 'Width' : k === 'd' ? 'Depth' : 'Height'} is over ${MAX_SIZE} in. Add the unit (cm, m, ft) if it was metric, like "90 x 30 x 180 cm".` };
    out[k] = Math.round(out[k] * 10) / 10;
  }
  return { ok: true, label: label || 'Piece', ...out, heightGiven, ref, text: `${out.w} × ${out.d} × ${out.h} in` };
}

const KEYS = [
  [/\b(?:book ?shelf|book ?shelves|book ?case|shelving|etag[eè]re|shelf)\b/i, 'bookcase'],
  [/\bking\b.*\bbed\b|\bbed\b.*\bking\b/i, 'king-bed'], [/\b(?:full|double)\b.*\bbed\b/i, 'full-bed'], [/\b(?:queen\b.*\bbed|bed ?frame|bed)\b/i, 'queen-bed'],
  [/\b(?:night ?stand|bedside|side table|end table)\b/i, 'nightstand'],
  [/\b(?:dresser|chest of drawers|tall ?boy|high ?boy|low ?boy|credenza|sideboard|buffet)\b/i, 'dresser'],
  [/\b(?:wardrobe|armoire|closet|cabinet|cupboard|pax)\b/i, 'wardrobe'],
  [/\b(?:desk|work ?station)\b/i, 'desk'],
  [/\b(?:sleeper|futon)\b/i, 'futon'], [/\b(?:love ?seat)\b/i, 'loveseat'], [/\b(?:sofa|couch|settee|sectional)\b/i, 'sofa-3'],
  [/\b(?:arm ?chair|recliner|accent chair|lounge chair|chair)\b/i, 'armchair'],
  [/\b(?:coffee table|ottoman)\b/i, 'coffee-table'],
  [/\b(?:tv stand|media console|tv console|console)\b/i, 'tv-console'], [/\b(?:tv|television)\b/i, 'tv-55'],
  [/\bround\b.*\btable\b|\btable\b.*\bround\b/i, 'dining-round'], [/\b(?:dining|kitchen|table)\b/i, 'dining-4'],
  [/\b(?:rug|carpet)\b/i, 'rug'], [/\bfloor lamp\b|\blamp\b/i, 'floor-lamp'], [/\b(?:plant|fig|palm)\b/i, 'plant-floor'], [/\bradiator\b/i, 'radiator'],
];
/** The catalogue piece a typed name most looks like (for how it is drawn and which clearances it needs), else a plain box. */
export function guessRef(label, width = null) {
  const t = String(label || '');
  for (const [re, ref] of KEYS) if (re.test(t)) {
    if (ref === 'dresser' && width != null && width >= 40) return 'dresser-wide';
    if (ref === 'dining-4' && width != null && width >= 66) return 'dining-6';
    return ref;
  }
  return 'custom-box';
}

// ------------------------------------------------------------------ the answer
const SIDE_NAME = { front: 'In front', back: 'Behind', left: 'To its left', right: 'To its right' };
const WINDOW_REACH = 14;   // a piece closer than this to a window's glass stands in front of it

/** How much of a window's width a piece stands in front of, 0 to 1 (nine samples along the glass, three depths in). */
export function windowCover(item, win) {
  const fp = footprint(item), n = win.normal || [0, 0];
  let hit = 0; const N = 9;
  for (let i = 0; i < N; i++) {
    const t = (i + 0.5) / N, p = [win.a[0] + (win.b[0] - win.a[0]) * t, win.a[1] + (win.b[1] - win.a[1]) * t];
    if ([2, 8, WINDOW_REACH].some((k) => pointInPoly([p[0] - n[0] * k, p[1] - n[1] * k], fp))) hit++;
  }
  return hit / N;
}

/**
 * Walks from the front door that a piece narrows or closes: compare the routes with the piece in the room against the routes
 * without it (plan/route.js accessRoutes for each). A route the piece itself is the destination of is reported as it is.
 * @returns {{grade: string, text: string}[]}
 */
export function walkwayEffects(after, before, id) {
  const out = [];
  if (!after?.routes) return out;
  const was = new Map((before?.routes || []).map((r) => [r.key, r]));
  for (const r of after.routes) {
    if (r.key === id) { out.push({ grade: r.grade, text: `From the front door to it: ${r.text.charAt(0).toLowerCase()}${r.text.slice(1)}`, code: 'walk-to' }); continue; }
    const b = was.get(r.key); if (!b) continue;
    if (!r.reachable && b.reachable) { out.push({ grade: 'blocked', text: `It closes off the way to the ${r.label.toLowerCase()}`, code: 'walk' }); continue; }
    if (!r.reachable || !b.reachable || !Number.isFinite(r.width)) continue;
    const bw = Number.isFinite(b.width) ? b.width : Infinity, drop = bw - r.width;
    if (r.grade !== 'clear' && (r.width < bw - 0.5 || b.grade === 'clear')) out.push({ grade: r.grade, text: `The walk to the ${r.label.toLowerCase()} ${bw === Infinity ? 'pinches' : `narrows from ${Math.round(bw)} in`} to ${Math.round(r.width)} in (36 in is comfortable, 30 in the minimum)`, code: 'walk' });
    else if (drop >= 6 && Number.isFinite(bw)) out.push({ grade: 'clear', text: `The walk to the ${r.label.toLowerCase()} narrows from ${Math.round(bw)} in to ${Math.round(r.width)} in, still comfortable`, code: 'walk' });
  }
  return out;
}

/**
 * Everything the studio can say about where a piece stands.
 * @param {object} model normalised plan
 * @param {object[]} items resolved furniture (catalog.resolve), the piece included
 * @param {string} id the piece
 * @param {{ev?: object, routesAfter?: object, routesBefore?: object, reach?: number}} [o] a precomputed evaluate(), and the routes with and without the piece
 * @returns {null | {id, name, room, grade, verdict, rows, sides, size}}
 */
export function fitReport(model, items, id, o = {}) {
  const vis = items.filter((x) => !x.hidden), it = vis.find((x) => x.id === id);
  if (!it) return null;
  const ev = o.ev || evaluate(model, vis), res = ev.items[id];
  if (!res) return null;
  const rows = res.issues.map((x) => ({ grade: x.grade, text: x.text, code: x.code }));
  // the space on each side: to the nearest wall, fixture or piece (nothing within `reach` reads as "open")
  const reach = o.reach ?? 120, gaps = gapRays(model, vis, id, reach), by = Object.fromEntries(gaps.map((g) => [g.side, g]));
  const sides = ['front', 'back', 'left', 'right'].map((side) => {
    const g = by[side];
    return { side, name: SIDE_NAME[side], free: g ? Math.round(g.d * 10) / 10 : null, open: !g, what: g?.label ? g.label.toLowerCase() : '', flush: !!g && g.d < 0.75 };
  });
  // windows: standing in front of the glass, or tucked under the sill
  const top = (it.elev || 0) + it.h;
  for (const [i, w] of model.windows.entries()) {
    const cover = windowCover(it, w);
    if (cover < 0.1) continue;
    const name = `${w.room ? w.room.toLowerCase() + ' ' : ''}window`, pct = Math.round(cover * 100);
    if (it.flat || it.mount === 'wall' && (it.elev || 0) >= w.head - 1) continue;
    if (top <= w.sill + 0.5) rows.push({ grade: 'clear', text: `Fits under the ${name}: the sill is ${Math.round(w.sill)} in and this is ${Math.round(top)} in tall`, code: 'window-under', window: i });
    else {
      const hides = cover >= 0.7;
      rows.push({ grade: hides ? 'blocked' : 'tight', text: `Stands in front of the ${name}, covering about ${pct}% of it: the sill is ${Math.round(w.sill)} in and this is ${Math.round(top)} in tall${top >= w.head ? ', so it reaches the top of the glass' : ''}`, code: 'window', window: i });
    }
  }
  for (const x of walkwayEffects(o.routesAfter, o.routesBefore, id)) rows.push(x);
  const grade = rows.reduce((a, x) => (x.code === 'window-under' || x.code === 'walk' && x.grade === 'clear' ? a : worst(a, x.grade)), 'clear');
  const bad = rows.filter((x) => x.grade === grade && x.code !== 'window-under')[0];
  const verdict = grade === 'blocked' ? `Does not fit here: ${lc(bad?.text || 'it collides with something')}` : grade === 'tight' ? `Fits, but tight: ${lc(bad?.text || 'a clearance is below the comfortable figure')}` : 'Fits where it stands, with its clearances respected';
  rows.sort((a, b) => rank(b.grade) - rank(a.grade));
  return { id, name: it.name, room: res.room || '', grade, verdict, rows, sides, size: { w: it.w, d: it.d, h: it.h }, state: res.state };
}
const rank = (g) => ['clear', 'tight', 'blocked'].indexOf(g);
const lc = (t) => (t ? t.charAt(0).toLowerCase() + t.slice(1) : t);

// ------------------------------------------------------------------ the renter's furniture list
/**
 * The piece of furniture.json for a placed item: its catalogue ref, the size it has here, the kind of room it lives in.
 * @param {object} it resolved item
 * @param {string} roomKind 'living' | 'bedroom' | 'dining' | 'office' | 'kitchen' | 'other'
 * @param {{source?: string}} [o]
 */
export function pieceFromItem(it, roomKind = 'living', o = {}) {
  const p = { id: it.id, ref: it.ref, label: String(it.label || it.name || it.ref).replace(/[<>\u0000-\u001f]/g, '').slice(0, 80) };
  if (['living', 'bedroom', 'dining', 'office', 'kitchen', 'other'].includes(roomKind)) p.room = roomKind;
  for (const k of ['w', 'd', 'h']) p[k] = Math.round(it[k] * 10) / 10;
  if (it.elev) p.elev = Math.round(it.elev * 10) / 10;
  if (it.variant) p.variant = it.variant;
  if (it.product) p.product = it.product;
  p.source = (o.source || 'Added in the Floor plan studio').slice(0, 400);
  return p;
}
/** The room kind a piece should be filed under: the kind of room it stands in (a bath or closet becomes "other"). */
export function roomKindAt(model, p) {
  const r = model.rooms.find((x) => pointInPoly(p, x.poly));
  if (!r) { let best = null, bd = Infinity; for (const x of model.rooms) for (let i = 0; i < x.poly.length; i++) { const d = segDist(p, x.poly[i], x.poly[(i + 1) % x.poly.length]); if (d < bd) { bd = d; best = x; } } return best?.kind === 'bedroom' ? 'bedroom' : best?.kind === 'dining' ? 'dining' : best?.kind === 'office' ? 'office' : best?.kind === 'kitchen' ? 'kitchen' : 'living'; }
  return ['living', 'bedroom', 'dining', 'office', 'kitchen'].includes(r.kind) ? r.kind : 'other';
}
/**
 * Add (or update) a piece in an inventory. Returns a new inventory object, not a mutated one.
 * @param {object|null} inv a validated inventory (plan/inventory.js) or null
 * @param {object} piece from pieceFromItem
 */
export function withPiece(inv, piece) {
  const base = inv || { schema: 1, kind: 'apartmentscout-furniture', name: 'Your furniture', source: 'Pieces added in the Floor plan studio', pieces: [] };
  const i = base.pieces.findIndex((q) => q.id === piece.id);
  const pieces = i >= 0 ? base.pieces.map((q, j) => (j === i ? { ...q, ...piece } : q)) : [...base.pieces, piece];
  return { ...base, pieces };
}
