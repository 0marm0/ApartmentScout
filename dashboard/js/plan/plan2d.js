// SVG overhead plan for the Floor plan studio: rooms, walls with windows, door swings, fixtures with
// their clearances, keep-out zones and the furniture (drag to move). Drawn in inches: SVG x = plan x,
// SVG y = -plan y. Colours come from CSS classes in css/views/plan.css (design tokens only).
import { esc } from '../util.js';
import { piecePoly, swingPoly, doorwayPoly } from './checks.js';
import { fmtIn } from './model.js';
import { chairSpots } from './scene3d.js';

const NS = 'http://www.w3.org/2000/svg';
let svg, model, vb = null, fit = null, handlers = {};
const pts = (poly) => poly.map(([x, y]) => `${r1(x)},${r1(-y)}`).join(' ');
const r1 = (v) => Math.round(v * 10) / 10;

export function mount(svgEl, h) {
  svg = svgEl; handlers = h;
  svg.setAttribute('xmlns', NS);
  svg.addEventListener('pointerdown', down);
  svg.addEventListener('pointermove', move);
  svg.addEventListener('pointerup', up); svg.addEventListener('pointercancel', up);
  svg.addEventListener('wheel', wheel, { passive: false });
  svg.addEventListener('dblclick', (e) => { if (!e.target.closest('[data-id]')) { vb = { ...fit }; applyVB(); } });
}

/** Plan point (inches) under a client position. */
export function toPlan(cx, cy) {
  const p = svg.createSVGPoint(); p.x = cx; p.y = cy;
  const q = p.matrixTransform(svg.getScreenCTM().inverse()); return [q.x, -q.y];
}

export function setModel(m) {
  model = m;
  const b = m.bounds, pad = 30;
  fit = { x: b.x0 - pad, y: -b.y1 - pad, w: b.x1 - b.x0 + 2 * pad, h: b.y1 - b.y0 + 2 * pad };
  vb = { ...fit }; applyVB();
  svg.innerHTML = staticMarkup(m, 'p2') + '<g id="p2furn"></g><g id="p2over"></g>';
}

/** Markup for the fixed parts of a plan (rooms, walls, windows, doors, fixtures, labels). */
export function staticMarkup(m, pre = 'p2') {
  const wall = m.pieces.filter((p) => p.z0 < 1);
  const solid = wall.filter((p) => p.kind === 'solid'), sills = wall.filter((p) => p.kind === 'sill');
  const doors = m.doorways.map((d) => {
    const sw = swingPoly(d, 14);
    if (sw) { const end = sw[sw.length - 1]; return `<polyline class="p2-arc" points="${pts(sw.slice(1))}"/><line class="p2-leaf" x1="${r1(d.hingePt[0])}" y1="${r1(-d.hingePt[1])}" x2="${r1(end[0])}" y2="${r1(-end[1])}"/>`; }
    if (['slide', 'pocket', 'none'].includes(d.swing)) return '';
    return `<polygon class="p2-doorway" style="fill:url(#${pre}hatch)" points="${pts(doorwayPoly(d, 18))}"/>`;
  }).join('');
  const fx = m.fixtures.map((f) => {
    const xs = f.poly.map((p) => p[0]), ys = f.poly.map((p) => p[1]), cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const small = Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) < 16;
    return `${f.reservePoly ? `<polygon class="p2-reserve${f.kind === 'ac' || f.kind === 'ptac' ? ' ac' : ''}" points="${pts(f.reservePoly)}"/>` : ''}<g class="p2-fx k-${esc(f.kind)}${f.est ? ' est' : ''}"><polygon points="${pts(f.poly)}"/>${small ? '' : `<text x="${r1(cx)}" y="${r1(-cy)}">${esc(f.label || f.kind)}</text>`}</g>`;
  }).join('');
  const labels = m.rooms.map((r) => {
    const big = Math.min(...['x', 'y'].map((_, k) => Math.max(...r.poly.map((p) => p[k])) - Math.min(...r.poly.map((p) => p[k])))) > 60;
    return `<g class="p2-rl${big ? '' : ' sm'}"><text x="${r1(r.label[0])}" y="${r1(-r.label[1] - 3)}">${esc(r.name)}</text>${r.stated ? `<text class="d" x="${r1(r.label[0])}" y="${r1(-r.label[1] + 8)}">${esc(r.stated)}</text>` : ''}</g>`;
  }).join('');
  return `<defs>
      <pattern id="${pre}grid" patternUnits="userSpaceOnUse" width="12" height="12"><path d="M12 0H0V12" class="p2-gridline"/></pattern>
      <pattern id="${pre}hatch" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" class="p2-hatchline"/></pattern>
    </defs>
    <g class="p2-rooms">${m.rooms.map((r) => `<polygon class="p2-room k-${esc(r.kind)}" points="${pts(r.poly)}"/>`).join('')}</g>
    <g class="p2-grids">${m.rooms.map((r) => `<polygon points="${pts(r.poly)}" fill="url(#${pre}grid)"/>`).join('')}</g>
    <g class="p2-keep">${m.keepout.map((k) => `<polygon style="fill:url(#${pre}hatch)" points="${pts(k.poly)}"><title>${esc(k.name)}</title></polygon>`).join('')}</g>
    <g class="p2-doors">${doors}</g>
    <g class="p2-fixtures">${fx}</g>
    <g class="p2-labels">${labels}</g>
    <g id="${pre}zones"></g>
    <g class="p2-walls">${solid.map((p) => `<polygon points="${pts(piecePoly(p))}"/>`).join('')}</g>
    <g class="p2-wins">${sills.map((p) => `<polygon points="${pts(piecePoly(p))}"/><line x1="${r1(p.a[0])}" y1="${r1(-p.a[1])}" x2="${r1(p.b[0])}" y2="${r1(-p.b[1])}"/>`).join('')}</g>`;
}

function applyVB() { if (svg && vb) svg.setAttribute('viewBox', `${r1(vb.x)} ${r1(vb.y)} ${r1(vb.w)} ${r1(vb.h)}`); }
export function resetView() { if (fit) { vb = { ...fit }; applyVB(); } }

// ------------------------------------------------------------------ furniture glyphs (local: x right, y down, back at -d/2)
function glyph(it) {
  const w = it.w, d = it.d, x = -w / 2, y = -d / 2, k = it.kind;
  const R = (cls, X, Y, W, H, rx = 1.5) => `<rect class="${cls}" x="${r1(X)}" y="${r1(Y)}" width="${r1(Math.max(0.5, W))}" height="${r1(Math.max(0.5, H))}" rx="${rx}"/>`;
  const L = (x1, y1, x2, y2) => `<line class="g-ln" x1="${r1(x1)}" y1="${r1(y1)}" x2="${r1(x2)}" y2="${r1(y2)}"/>`;
  let o = '';
  if (k === 'bed') {
    const mw = Math.min(it.base.mattress?.[0] || w - 4, w - 2), pw = mw / 2 - 5;
    o = R('g-base', x, y, w, d, 3) + R('g-dk', x, y, w, 3.5, 1.5) + R('g-lt', -mw / 2 + 2.5, y + 6, pw, 13, 4) + R('g-lt', 2.5, y + 6, pw, 13, 4) + L(-mw / 2, y + d * 0.42, mw / 2, y + d * 0.42);
  } else if (k === 'sofa' || k === 'chair') {
    const flat = it.variant === 'bed';
    o = R('g-base', x, y, w, d, 4) + (flat ? '' : R('g-dk', x, y, w, 9, 3)) + R('g-dk', x, y, 5.5, d, 3) + R('g-dk', x + w - 5.5, y, 5.5, d, 3);
    if (k === 'sofa' && !flat) for (let i = 1; i < 3; i++) o += L(x + 5.5 + ((w - 11) * i) / 3, y + 9, x + 5.5 + ((w - 11) * i) / 3, y + d);
  } else if (k === 'tv') {
    o = it.mount === 'wall' ? R('g-tv', x, y, w, d, 1) : R('g-base', x, y, w, d, 2) + R('g-tv', -(it.screen || w) / 2, -1.5, it.screen || w, 3, 1);
  } else if (k === 'desk') {
    o = `<circle class="g-chair" cx="0" cy="${r1(d / 2 + 9)}" r="9"/>` + R('g-base', x, y, w, d, 2) + R('g-lt', -6.5, y + d * 0.45, 13, 9, 1);
  } else if (k === 'table') {
    o = chairSpots(it).map(([cx, cz]) => R('g-chair', cx - 8.5, cz - 8.5, 17, 17, 3)).join('');
    o += it.base.round ? `<circle class="g-base" cx="0" cy="0" r="${r1(w / 2)}"/>` : R('g-base', x, y, w, d, 2);
  } else if (k === 'table-low') {
    o = R('g-base', x, y, w, d, 2) + R('g-ln', x + 4, y + 4, w - 8, d - 8, 1);
  } else if (k === 'dresser' || k === 'nightstand') {
    o = R('g-base', x, y, w, d, 1.5) + L(x + 2, d / 2 - 2.5, x + w - 2, d / 2 - 2.5);
  } else if (k === 'wardrobe') {
    o = R('g-base', x, y, w, d, 1) + L(0, y + 1, 0, d / 2) + L(x + 2, d / 2 - 2, x + w - 2, d / 2 - 2);
  } else if (k === 'bookcase') {
    o = R('g-base', x, y, w, d, 1); for (let i = 1; i < 6; i++) o += L(x + (w * i) / 6, y + 1, x + (w * i) / 6, d / 2 - 1);
  } else if (k === 'ac') {
    o = R('g-base', x, y, w, d, 1.5); for (let i = 1; i < 5; i++) o += L(x + 3, y + (d * i) / 5, x + w - 3, y + (d * i) / 5);
  } else o = R('g-base', x, y, w, d, 2);
  return o;
}
const SHORT = { 'Queen bed': 'Queen', 'Full bed': 'Full', 'King bed': 'King', 'Dresser, 4 drawers': 'Dresser', 'Dresser, 6 drawers': 'Dresser', 'Sofa, 3 seats': 'Sofa', 'TV 55 in, wall-mounted': 'TV 55', 'TV 65 in, wall-mounted': 'TV 65', 'TV 55 in on a console': 'TV', 'Dining table, 4 seats': 'Dining', 'Round table, 4 seats': 'Dining', 'Dining table, 6 seats': 'Dining', 'Desk and chair': 'Desk', 'AC / heater unit': 'AC', 'Sleeper sofa': 'Sofa bed' };

/**
 * Redraw everything that moves.
 * @param {object} s {items, sel, ev, zones, gaps, sights, flash, showDims}
 */
export function draw(s) {
  if (!svg || !model) return;
  const st = s.ev?.items || {};
  svg.querySelector('#p2furn').innerHTML = furnitureMarkup(s.items, st, s.sel);
  svg.querySelector('#p2zones').innerHTML = (s.zones || []).map((z) => `<polygon class="p2-zone z-${z.grade}" points="${pts(z.poly)}"/>`).join('');
  overlayMarkup(s);
}

/** Markup for furniture pieces, coloured by their check state. */
export function furnitureMarkup(items, st = {}, sel = null, labels = true) {
  return items.filter((it) => !it.hidden).map((it) => {
    const g = st[it.id]?.state || 'clear', on = it.id === sel;
    const small = Math.min(it.w, it.d) < 14 || it.kind === 'tv' && it.mount === 'wall';
    const name = it.label || SHORT[it.name] || it.name;
    const fs = Math.max(4.5, Math.min(8, Math.min(it.w, it.d) / 3.2));
    return `<g class="p2-it st-${g}${on ? ' sel' : ''}" data-id="${esc(it.id)}" transform="translate(${r1(it.x)} ${r1(-it.y)})"><g transform="rotate(${r1(it.rot)})">${glyph(it)}</g>${!labels || small && !on ? '' : `<text class="g-t" y="${r1(on ? -fs * 0.15 : fs * 0.35)}" font-size="${r1(fs)}">${esc(name)}</text>${on ? `<text class="g-t g-d" y="${r1(fs * 1.1)}" font-size="${r1(fs * 0.8)}">${fmtIn(it.w)} × ${fmtIn(it.d)}</text>` : ''}`}</g>`;
  }).join('');
}
function overlayMarkup(s) {
  let over = '';
  for (const gp of s.gaps || []) {
    if (gp.d < 0.75) continue;
    const [a, b] = [gp.from, gp.to], n = [-gp.u[1] * 3, gp.u[0] * 3], m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], t = fmtIn(gp.d), tw = t.length * 3.6 + 5;
    over += `<g class="p2-gap"><line x1="${r1(a[0])}" y1="${r1(-a[1])}" x2="${r1(b[0])}" y2="${r1(-b[1])}"/><line x1="${r1(b[0] - n[0])}" y1="${r1(-b[1] + n[1])}" x2="${r1(b[0] + n[0])}" y2="${r1(-b[1] - n[1])}"/>
      <rect x="${r1(m[0] - tw / 2)}" y="${r1(-m[1] - 4.6)}" width="${r1(tw)}" height="9.2" rx="2.5"/><text x="${r1(m[0])}" y="${r1(-m[1] + 0.2)}">${esc(t)}</text></g>`;
  }
  for (const sl of s.sights || []) {
    const [a, b] = [sl.from, sl.to], m = [a[0] + (b[0] - a[0]) * 0.38, a[1] + (b[1] - a[1]) * 0.38], tw = sl.label.length * 3.3 + 6;
    over += `<g class="p2-sight"><line x1="${r1(a[0])}" y1="${r1(-a[1])}" x2="${r1(b[0])}" y2="${r1(-b[1])}"/><circle cx="${r1(b[0])}" cy="${r1(-b[1])}" r="2.2"/>
      <rect x="${r1(m[0] - tw / 2)}" y="${r1(-m[1] - 4.6)}" width="${r1(tw)}" height="9.2" rx="2.5"/><text x="${r1(m[0])}" y="${r1(-m[1] + 0.2)}">${esc(sl.label)}</text></g>`;
  }
  if (s.flash) over += `<polygon class="p2-flash" points="${pts(s.flash)}"/>`;
  svg.querySelector('#p2over').innerHTML = over;
}

// ------------------------------------------------------------------ pointer: drag furniture, pan and zoom the view
let drag = null, pan = null; const ptrs = new Map(); let pinch0 = 0;
function down(e) {
  ptrs.set(e.pointerId, [e.clientX, e.clientY]);
  if (ptrs.size === 2) { drag = null; pan = null; const [a, b] = [...ptrs.values()]; pinch0 = Math.hypot(a[0] - b[0], a[1] - b[1]); return; }
  const g = e.target.closest('[data-id]');
  svg.setPointerCapture(e.pointerId);
  if (g) {
    const id = g.dataset.id, p = toPlan(e.clientX, e.clientY);
    const it = handlers.item(id); if (!it) return;
    drag = { id, ox: it.x - p[0], oy: it.y - p[1], moved: false, sx: e.clientX, sy: e.clientY };
    handlers.select(id); e.preventDefault(); return;
  }
  pan = { x: e.clientX, y: e.clientY, vb: { ...vb }, moved: false };
}
function move(e) {
  if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, [e.clientX, e.clientY]);
  if (ptrs.size === 2 && pinch0) {
    const [a, b] = [...ptrs.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
    zoomAt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, pinch0 / d); pinch0 = d; return;
  }
  if (drag) {
    if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 3) return;
    drag.moved = true; const p = toPlan(e.clientX, e.clientY);
    handlers.move(drag.id, p[0] + drag.ox, p[1] + drag.oy); return;
  }
  if (pan) {
    const r = svg.getBoundingClientRect(), k = Math.max(pan.vb.w / r.width, pan.vb.h / r.height);
    const dx = e.clientX - pan.x, dy = e.clientY - pan.y; if (Math.hypot(dx, dy) > 3) pan.moved = true;
    if (pan.moved) { vb = { ...pan.vb, x: pan.vb.x - dx * k, y: pan.vb.y - dy * k }; applyVB(); }
  }
}
function up(e) {
  ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch0 = 0;
  if (drag) { if (drag.moved) handlers.commit(drag.id); drag = null; return; }
  if (pan) { if (!pan.moved) handlers.select(null); pan = null; }
}
function wheel(e) { e.preventDefault(); zoomAt(e.clientX, e.clientY, Math.exp(e.deltaY * 0.0015)); }
function zoomAt(cx, cy, k) {
  const p = svg.createSVGPoint(); p.x = cx; p.y = cy; const q = p.matrixTransform(svg.getScreenCTM().inverse());
  const nw = Math.max(fit.w * 0.18, Math.min(fit.w * 2.5, vb.w * k)), s = nw / vb.w;
  vb = { x: q.x - (q.x - vb.x) * s, y: q.y - (q.y - vb.y) * s, w: vb.w * s, h: vb.h * s }; applyVB();
}
