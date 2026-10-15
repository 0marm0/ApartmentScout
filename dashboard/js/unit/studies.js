// Unit 3D studies: the neighbourhood heights map (north up, buildings coloured by height class with labelled
// roofs, 150 m and 300 m rings, the window and its facing), roofs by compass direction (chart and table), views
// from the window at several floors side by side, a rendered 360° skyline strip with landmarks, and a
// season × time board from a fixed camera. The heights map and charts are strings (SVG + HTML); the renders draw
// into a 2D canvas through UnitStage.drawStill, so the live view is untouched.
import { esc } from '../util.js';
import { compass } from '../sun.js';
import { heightClass, HCLASS_LABELS, pickLabels, panoramaSlices, stripX, DIR8, toFeet } from './heights.js';

const fmtD = (d) => (d >= 1000 ? (d / 1000).toFixed(1) + ' km' : Math.round(d) + ' m');
const short = (s, n = 22) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

// ------------------------------------------------------------------ heights map
/**
 * North-up map of every footprint within `radius` of the window point. o: {B, ti, w:{x,y}, az, spread, colors[7],
 * names: (bi) => string, future: [{ring, h, name}], streets: [{name, pts}], radius, sel, edits: Map}.
 * Returns HTML: an SVG in a 640-unit square plus HTML labels positioned in percent so they stay readable on a phone.
 */
export function heightMapHTML(o) {
  const R = o.radius || 300, S = 640, k = S / (2 * (R + 20)), cx = o.w.x, cy = o.w.y;
  const X = (x) => (x - cx) * k + S / 2, Y = (y) => S / 2 - (y - cy) * k;
  const ring = (p) => { let d = ''; for (let j = 0; j < p.length / 2; j++) d += (j ? 'L' : 'M') + X(p[2 * j]).toFixed(1) + ' ' + Y(p[2 * j + 1]).toFixed(1); return d + 'Z'; };
  const rows = [];
  let paths = '';
  o.B.forEach((b, i) => {
    const bx = (b.bb[0] + b.bb[2]) / 2, by = (b.bb[1] + b.bb[3]) / 2, half = Math.max(b.bb[2] - b.bb[0], b.bb[3] - b.bb[1]) / 2;
    const dc = Math.hypot(bx - cx, by - cy);
    if (dc - half > R + 20) return;
    const h = b.top - Math.max(b.g, 0), isT = i === o.ti, ed = o.edits?.has(i);
    const d = [b.p, ...(b.holes || [])].map(ring).join('');
    const nm = o.names(i);
    paths += `<path d="${d}" data-bi="${i}" class="${isT ? 't' : ''}${o.sel === i ? ' sel' : ''}${ed ? ' ed' : ''}" ${isT ? '' : `fill="${o.colors[heightClass(h)]}"`}><title>${esc(`${nm}: ${Math.round(h)} m (${toFeet(h)} ft)${ed ? ' · what-if height' : ''}`)}</title></path>`;
    if (!isT) rows.push({ i, x: bx, y: by, h, dist: Math.max(0, dc - half * 0.5) });
  });
  let fut = '';
  for (const f of o.future || []) {
    const r = (f.ring || []).filter(Array.isArray); if (r.length < 3) continue;
    fut += `<path class="fut" d="${ring(r.flat())}"><title>${esc(`${f.name || 'Proposed building'}: ${Math.round(+f.h || 0)} m, proposed`)}</title></path>`;
  }
  let st = '';
  for (const s of o.streets || []) {
    const pts = (s.pts || []).filter((q) => Array.isArray(q) && Number.isFinite(q[0]));
    if (pts.length > 1) st += `<polyline points="${pts.map((q) => X(q[0]).toFixed(1) + ',' + Y(q[1]).toFixed(1)).join(' ')}"/>`;
  }
  const rings = [150, 300].filter((r) => r <= R).map((r) => `<circle cx="${S / 2}" cy="${S / 2}" r="${r * k}" class="ring"/>`).join('');
  // facing: an arrow 110 m long (a bay shows its outer panes as thin rays)
  const ray = (a, len, cls) => { const x2 = X(cx + Math.sin(a * Math.PI / 180) * len), y2 = Y(cy + Math.cos(a * Math.PI / 180) * len); return `<line x1="${S / 2}" y1="${S / 2}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" class="${cls}"/>`; };
  const face = (o.spread ? ray(o.az - o.spread, 80, 'fan') + ray(o.az + o.spread, 80, 'fan') : '') + ray(o.az, 110, 'face');
  const ah = (() => { const a = o.az * Math.PI / 180, tx = X(cx + Math.sin(a) * 110), ty = Y(cy + Math.cos(a) * 110), l = 9, w = 5.5, ux = Math.sin(a), uy = -Math.cos(a); return `<path class="faceh" d="M${(tx + ux * 3).toFixed(1)} ${(ty + uy * 3).toFixed(1)}L${(tx - ux * l - uy * w).toFixed(1)} ${(ty - uy * l + ux * w).toFixed(1)}L${(tx - ux * l + uy * w).toFixed(1)} ${(ty - uy * l - ux * w).toFixed(1)}Z"/>`; })();
  const labs = pickLabels(rows, { max: 18, near: 8, minSep: 34, radius: R }).map((r) => {
    const px = (X(r.x) / S) * 100, py = (Y(r.y) / S) * 100;
    if (px < 3 || px > 97 || py < 3 || py > 97) return '';
    return `<span class="u-hm-l${o.edits?.has(r.i) ? ' ed' : ''}" style="left:${px.toFixed(2)}%;top:${py.toFixed(2)}%" data-bi="${r.i}">${Math.round(r.h)}<small> m</small></span>`;
  }).join('');
  const ringLab = [150, 300].filter((r) => r <= R).map((r) => `<span class="u-hm-r" style="left:${((S / 2 + r * k * Math.SQRT1_2) / S * 100).toFixed(2)}%;top:${((S / 2 + r * k * Math.SQRT1_2) / S * 100).toFixed(2)}%">${r} m</span>`).join('');
  const bar = 100 * k / S * 100; // 100 m as a percentage of the width
  return `<div class="u-hm"><svg viewBox="0 0 ${S} ${S}" role="img" aria-label="Map of building heights within ${R} metres, north up">
      <g class="st">${st}</g><g class="bl">${paths}</g><g class="fu">${fut}</g>${rings}${face}${ah}<circle cx="${S / 2}" cy="${S / 2}" r="5" class="win"/></svg>
      ${labs}${ringLab}<span class="u-hm-n" aria-hidden="true">N</span><span class="u-hm-sc"><i style="width:${bar.toFixed(2)}%"></i>100 m</span></div>
    <div class="u-hm-legend" aria-label="Height classes">${o.colors.map((c, i) => `<span><i style="background:${c}"></i>${HCLASS_LABELS[i]}</span>`).join('')}<span><i class="t"></i>This building</span>${o.future?.length ? '<span><i class="fu"></i>Proposed</span>' : ''}<span><i class="face"></i>Window faces ${Math.round(o.az)}° ${compass(o.az)}</span></div>`;
}

// ------------------------------------------------------------------ roofs by direction
/**
 * Bar chart: one column per compass direction (unit/heights.js sectorHeights), the tallest roof as the bar in its
 * height-class colour, the median as a tick, the eye height of this floor as a line; the facing sector is marked.
 */
export function sectorChartSVG(sec, o) {
  const W = 640, H = 210, L = 34, top = 26, bot = 40, cw = (W - L - 8) / sec.length;
  const max = Math.max(o.eye * 1.15, 20, ...sec.map((s) => s.tallest?.h || 0)) * 1.08;
  const Y = (v) => top + (H - top - bot) * (1 - Math.min(max, Math.max(0, v)) / max);
  let s = '';
  const step = max > 300 ? 100 : max > 120 ? 50 : 20;
  for (let v = 0; v <= max; v += step) s += `<line x1="${L}" x2="${W}" y1="${Y(v)}" y2="${Y(v)}" class="gl"/><text x="${L - 6}" y="${Y(v) + 3}" text-anchor="end" class="ax">${v}</text>`;
  sec.forEach((q, i) => {
    const x = L + 4 + i * cw, bw = Math.min(46, cw * 0.56), bx = x + (cw - bw) / 2, face = o.facing.includes(i);
    if (face) s += `<rect x="${x + 2}" y="${top - 18}" width="${cw - 4}" height="${H - top - bot + 18}" rx="6" class="facebg"/>`;
    if (q.tallest) {
      const h = q.tallest.h, c = o.colors[heightClass(h)];
      s += `<g class="col" data-bi="${q.tallest.bi ?? ''}"><title>${esc(`${q.dir}: tallest ${q.tallest.name}, ${Math.round(h)} m, ${fmtD(q.tallest.dist)} away · ${q.count} buildings within ${o.radius} m · ${q.above} above your eyes`)}</title>
        <rect x="${bx}" y="${Y(h)}" width="${bw}" height="${Math.max(2, Y(0) - Y(h))}" rx="4" fill="${c}" class="${q.tallest.future ? 'fut' : ''}"/>
        ${q.median != null ? `<line x1="${bx - 3}" x2="${bx + bw + 3}" y1="${Y(q.median)}" y2="${Y(q.median)}" class="med"/>` : ''}
        <text x="${bx + bw / 2}" y="${Y(h) - 5}" text-anchor="middle" class="v">${Math.round(h)}</text></g>`;
    } else s += `<text x="${x + cw / 2}" y="${Y(0) - 6}" text-anchor="middle" class="none">open</text>`;
    s += `<text x="${x + cw / 2}" y="${H - bot + 16}" text-anchor="middle" class="dir${face ? ' on' : ''}">${q.dir}</text>`;
    s += `<text x="${x + cw / 2}" y="${H - bot + 30}" text-anchor="middle" class="sub">${q.count ? `${q.above}/${q.count} above` : '—'}</text>`;
  });
  s += `<line x1="${L}" x2="${W}" y1="${Y(o.eye)}" y2="${Y(o.eye)}" class="eye"/><text x="${L + 2}" y="${top - 12}" class="eyel">— ${esc(o.eyeLabel)}: ${Math.round(o.eye)} m above the street</text>`;
  return `<svg class="u-sec" viewBox="0 0 ${W} ${H}" role="img" aria-label="Tallest and median roof in each compass direction within ${o.radius} metres, against your eye height">${s}</svg>`;
}
export function sectorTable(sec, o) {
  const cell = (r) => (r ? `<b>${esc(short(r.name))}</b><small>${Math.round(r.h)} m · ${fmtD(r.dist)}${r.future ? ' · proposed' : ''}</small>` : '<span class="faint">—</span>');
  return `<table class="mini u-sec-t"><thead><tr><th>Direction</th><th>Tallest</th><th>Nearest</th><th class="num">Median</th><th class="num">Above your eyes</th></tr></thead><tbody>
    ${sec.map((q, i) => `<tr${o.facing.includes(i) ? ' class="face"' : ''}${q.tallest?.bi != null ? ` data-bi="${q.tallest.bi}"` : ''}><td>${q.dir}${o.facing.includes(i) ? ' <span class="pill accent">window</span>' : ''}</td><td>${cell(q.tallest)}</td><td>${cell(q.nearest)}</td><td class="num">${q.median != null ? Math.round(q.median) + ' m' : '—'}</td><td class="num">${q.count ? `${q.above} of ${q.count}` : '—'}</td></tr>`).join('')}
  </tbody></table>`;
}

// ------------------------------------------------------------------ renders
/** Size a canvas to its CSS box at the device pixel ratio; returns {ctx, w, h} in CSS pixels. */
export function fitCanvas(cv, w, h) {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); cv.style.height = h + 'px';
  const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); return { ctx, w, h };
}
function chip(ctx, x, y, text, o = {}) {
  ctx.font = `${o.weight || 600} ${o.size || 11}px ${o.font || 'sans-serif'}`;
  const tw = ctx.measureText(text).width, ph = (o.size || 11) + 8, pw = tw + 14;
  let bx = Math.round(x - (o.align === 'left' ? 0 : pw / 2)), by = Math.round(y - ph);
  if (o.clamp) { bx = Math.max(o.clamp[0], Math.min(o.clamp[1] - pw, bx)); }
  ctx.fillStyle = o.bg || 'rgba(14,16,21,.78)'; ctx.strokeStyle = o.line || 'rgba(255,255,255,.14)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.roundRect ? ctx.roundRect(bx + 0.5, by + 0.5, pw, ph, 7) : ctx.rect(bx, by, pw, ph); ctx.fill(); ctx.stroke();
  ctx.fillStyle = o.fg || '#eef1f6'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.fillText(text, bx + 7, by + ph / 2 + 0.5);
  return [bx, by, bx + pw, by + ph];
}

/**
 * Views from the window at several floors, same bearing, turn, tilt, lens and time. o: {stage, cv, width, floors:
 * [{w, label, sub}], az, yaw, pitch, fov, theme:{font, bg, fg, line, sun}}. Returns the cell rectangles.
 */
export function renderFloorViews(o) {
  const n = o.floors.length, gap = 10, cols = o.width < 560 ? 2 : n, rowsN = Math.ceil(n / cols);
  const cw = (o.width - gap * (cols - 1)) / cols, ch = Math.round(cw * 0.72), capH = 44;
  const { ctx } = fitCanvas(o.cv, o.width, rowsN * (ch + capH) + (rowsN - 1) * gap);
  ctx.clearRect(0, 0, o.width, rowsN * (ch + capH + gap));
  o.stage.beginStills(false);
  o.floors.forEach((f, i) => {
    const c = i % cols, r = Math.floor(i / cols), x = c * (cw + gap), y = r * (ch + capH + gap);
    const cam = o.stage.lookCam(f.w, o.az + o.yaw, o.pitch, o.fov);
    o.stage.drawStill(cam, ctx, x, y, cw, ch);
    ctx.save(); ctx.beginPath(); ctx.rect(x, y, cw, ch); ctx.clip();
    chip(ctx, x + 8, y + 26, f.label, { align: 'left', font: o.theme.font, bg: f.cur ? o.theme.sun : o.theme.bg, fg: f.cur ? '#1b1200' : o.theme.fg, line: o.theme.line });
    ctx.restore();
    ctx.fillStyle = o.theme.fg; ctx.font = `600 12.5px ${o.theme.font}`; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(f.sub[0], x + 2, y + ch + 18);
    ctx.fillStyle = o.theme.ink3; ctx.font = `500 11.5px ${o.theme.font}`; ctx.fillText(f.sub[1], x + 2, y + ch + 35);
  });
  o.stage.endStills();
}

/**
 * A rendered 360° strip from the window, 12 slices of 30°, starting so the window's facing sits in the middle.
 * Landmarks are drawn as chips at their bearing (dimmed when hidden), compass points along the bottom, and the half
 * of the circle behind the window shaded. o: {stage, cv, width, height, w, az, spread, pitch, lm:[{name, x, y, top,
 * hidden}], theme}.
 */
export function renderPanorama(o) {
  const H = o.height, axis = 22, { ctx } = fitCanvas(o.cv, o.width, H + axis), start = o.az - 180;
  const N = 12, half = 180 / N, sl = panoramaSlices(N, start), sw = o.width / N;
  const vfov = 2 * Math.atan(Math.tan(half * Math.PI / 180) * (H / sw)) * 180 / Math.PI;
  o.stage.beginStills(false);
  const placed = [];
  const chips = [];
  for (const s of sl) {
    const cam = o.stage.lookCam(o.w, s.yaw, o.pitch, vfov);
    o.stage.drawStill(cam, ctx, Math.floor(s.x0 * o.width), 0, Math.ceil(sw) + 1, H);
    for (const l of o.lm) {
      const brg = (Math.atan2(l.x - o.w.x, l.y - o.w.y) * 180 / Math.PI + 360) % 360, d = ((brg - s.yaw + 540) % 360) - 180;
      if (Math.abs(d) > half) continue;
      const p = o.stage.project(cam, l.x, l.y, l.top, sw / H);
      if (!p.ok) continue;
      chips.push({ l, x: stripX(brg, start) * o.width, y: Math.max(26, Math.min(H - 8, p.y * H - 4)), dist: Math.hypot(l.x - o.w.x, l.y - o.w.y) });
    }
  }
  o.stage.endStills();
  // behind the window: shade the half of the circle the window cannot see
  const field = 90 + (o.spread || 0);
  ctx.fillStyle = o.theme.shade;
  const a0 = stripX(o.az - field, start) * o.width, a1 = stripX(o.az + field, start) * o.width;
  if (a0 > 0) ctx.fillRect(0, 0, a0, H);
  if (a1 < o.width) ctx.fillRect(a1, 0, o.width - a1, H);
  ctx.strokeStyle = o.theme.sun; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
  for (const x of [a0, a1]) { if (x > 0 && x < o.width) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); } }
  ctx.setLineDash([]);
  // landmark chips: visible ones first, nearest first; skip overlaps
  chips.sort((a, b) => (a.l.hidden - b.l.hidden) || a.dist - b.dist);
  for (const c of chips) {
    ctx.font = `600 11px ${o.theme.font}`; const w = ctx.measureText(c.l.name).width + 14;
    const r = [c.x - w / 2, c.y - 19, c.x + w / 2, c.y];
    if (placed.some((p) => r[0] < p[2] + 4 && r[2] > p[0] - 4 && r[1] < p[3] + 2 && r[3] > p[1] - 2)) continue;
    ctx.globalAlpha = c.l.hidden ? 0.55 : 1;
    placed.push(chip(ctx, c.x, c.y, c.l.name, { font: o.theme.font, bg: o.theme.bg, fg: c.l.hidden ? o.theme.ink3 : o.theme.fg, line: o.theme.line, clamp: [2, o.width - 2] }));
    ctx.strokeStyle = o.theme.line; ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(c.x, c.y + 6); ctx.stroke();
    ctx.globalAlpha = 1;
  }
  // window facing marker and compass axis
  const fx = stripX(o.az, start) * o.width;
  ctx.fillStyle = o.theme.sun; ctx.beginPath(); ctx.moveTo(fx, H - 1); ctx.lineTo(fx - 6, H + 9); ctx.lineTo(fx + 6, H + 9); ctx.closePath(); ctx.fill();
  ctx.fillStyle = o.theme.surface; ctx.fillRect(0, H, o.width, axis);
  ctx.font = `500 10.5px ${o.theme.mono}`; ctx.textBaseline = 'middle';
  for (let b = 0; b < 360; b += 45) {
    const x = stripX(b, start) * o.width; ctx.fillStyle = b === 0 ? o.theme.bad : o.theme.ink3; ctx.textAlign = x < 14 ? 'left' : x > o.width - 14 ? 'right' : 'center';
    ctx.fillText(DIR8[b / 45], x, H + axis / 2 + 1);
    ctx.fillRect(x, H, 1, 4);
  }
  ctx.fillStyle = o.theme.sun; ctx.textAlign = 'center'; ctx.font = `600 10.5px ${o.theme.mono}`;
  ctx.fillText(`${Math.round(o.az)}°`, Math.max(20, Math.min(o.width - 20, fx + (Math.abs(fx - stripX(Math.round(o.az / 45) * 45, start) * o.width) < 24 ? 26 : 0))), H + axis / 2 + 1);
}

/**
 * Season × time board from a fixed camera. o: {stage, cv, width, aspect, cam, rows: [{label, cells: [{sun, label,
 * state}]}], theme}. state: 'lit' | 'side' | 'shade' | 'behind' | 'night'.
 */
export function renderSeasons(o) {
  const cols = o.rows[0]?.cells.length || 1, lw = o.width < 560 ? 0 : 58, gap = 6;
  const cw = (o.width - lw - gap * (cols - 1)) / cols, ch = Math.round(cw / o.aspect), headH = 20;
  const total = headH + o.rows.length * (ch + gap) + (lw ? 0 : o.rows.length * 18);
  const { ctx } = fitCanvas(o.cv, o.width, total);
  const narrow = cw < 140;
  const tag = { lit: [narrow ? 'Sun' : 'Sun on window', o.theme.sun, '#1b1200'], side: [narrow ? 'Side' : 'Side pane', o.theme.sun, '#1b1200'], shade: ['Shaded', o.theme.blue, '#fff'], behind: [narrow ? 'Behind' : 'Behind facade', o.theme.bg, o.theme.fg], night: ['Night', o.theme.bg, o.theme.ink3] };
  const season0 = o.stage.season;   // [season] a row's trees follow its date; the stage goes back to the live date after
  o.stage.beginStills(true);
  ctx.font = `600 11px ${o.theme.font}`; ctx.fillStyle = o.theme.ink3; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
  o.rows[0]?.cells.forEach((c, j) => ctx.fillText(c.label, lw + j * (cw + gap) + cw / 2, headH / 2));
  let y = headH;
  for (const r of o.rows) {
    if (!lw) { ctx.fillStyle = o.theme.fg; ctx.textAlign = 'left'; ctx.font = `600 11.5px ${o.theme.font}`; ctx.fillText(r.label, 2, y + 9); y += 18; }
    else { ctx.fillStyle = o.theme.fg; ctx.textAlign = 'left'; ctx.font = `600 12px ${o.theme.font}`; ctx.fillText(r.label, 0, y + ch / 2); }
    if (r.season) o.stage.setSeason(r.season);
    r.cells.forEach((c, j) => {
      const x = lw + j * (cw + gap);
      o.stage.setSun(c.sun);
      o.stage.drawStill(o.cam, ctx, x, y, cw, ch);
      const [t, bg, fg] = tag[c.state] || tag.night;
      ctx.save(); ctx.beginPath(); ctx.rect(x, y, cw, ch); ctx.clip();
      chip(ctx, x + (narrow ? 4 : 6), y + ch - (narrow ? 4 : 6), t, { align: 'left', size: narrow ? 9 : 10, font: o.theme.font, bg, fg, line: o.theme.line });
      ctx.restore();
    });
    y += ch + gap;
  }
  if (season0) o.stage.setSeason(season0);
  o.stage.endStills();
}
