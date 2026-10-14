// Shared helpers: formatting, colour ramps, grids, tiny DOM utilities.
export const $ = (id) => document.getElementById(id);
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const money = (v) => (v == null || isNaN(v) ? '—' : '$' + Math.round(v).toLocaleString());
export const moneyShort = (v) => (v == null || isNaN(v) ? '—' : v >= 1000 ? '$' + (v / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : '$' + Math.round(v));
// Only http(s) links, or photos saved inside the search's media/ folder, become hrefs or image sources:
// agent-written data must never run script.
export const safeUrl = (u) => { const v = String(u ?? '').trim(); return /^https?:\/\//i.test(v) || /^media\/[\w./-]+$/.test(v) && !v.includes('..') ? v : null; };
export const mins = (v) => (v == null ? '?' : Math.round(v) + ' min');
export const yn = (v) => (v === true ? '<span class="yes">yes</span>' : v === false ? '<span class="no">no</span>' : '<span class="unk">?</span>');
export const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

function hex(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function ramp(stops) {
  // stops: [[value, '#rrggbb'], ...] ascending
  const s = stops.map(([v, c]) => [v, hex(c)]);
  return (v) => {
    if (v == null || isNaN(v)) return null;
    if (v <= s[0][0]) return s[0][1];
    for (let i = 1; i < s.length; i++) {
      if (v <= s[i][0]) {
        const t = (v - s[i - 1][0]) / (s[i][0] - s[i - 1][0]);
        return s[i - 1][1].map((a, k) => Math.round(a + (s[i][1][k] - a) * t));
      }
    }
    return s[s.length - 1][1];
  };
}
export const RAMPS = {
  score: { fn: ramp([[30, '#e5604f'], [50, '#ee9b45'], [65, '#d7c95a'], [80, '#67c68a'], [95, '#2fb383']]), stops: [30, 50, 65, 80, 95], css: 'linear-gradient(90deg,#e5604f,#ee9b45,#d7c95a,#67c68a,#2fb383)' },
  commute: { fn: ramp([[10, '#3be8b5'], [20, '#27c2c4'], [30, '#3a93e0'], [45, '#6a55b8'], [60, '#7d3a72']]), stops: [10, 20, 30, 45, 60], css: 'linear-gradient(90deg,#3be8b5,#27c2c4,#3a93e0,#6a55b8,#7d3a72)' },
  noise: { fn: ramp([[0, '#f2e6ff'], [1, '#c79cf0'], [2, '#8e4fd6'], [3, '#5b1aa8'], [3.6, '#2d0a5c']]), stops: [0, 1, 2, 3, 3.6], css: 'linear-gradient(90deg,#f2e6ff,#c79cf0,#8e4fd6,#5b1aa8,#2d0a5c)' },
  rent: { fn: ramp([[3, '#2b6cb0'], [5, '#5aa9d6'], [7, '#f1d36b'], [9, '#ee8a3a'], [12, '#c2412b']]), stops: [3, 5, 7, 9, 12], css: 'linear-gradient(90deg,#2b6cb0,#5aa9d6,#f1d36b,#ee8a3a,#c2412b)' },
};
export const rgb = (c, a = 1) => (c ? `rgba(${c[0]},${c[1]},${c[2]},${a})` : 'transparent');
export const scoreColor = (v) => rgb(RAMPS.score.fn(v ?? 50));

// Paint a regular lat/lon grid (layer.values row-major from the south-west) into a canvas data URL.
export function gridImage(layer, colorFn, alphaFn = () => 0.75, valueFn = (v) => v) {
  const { rows, cols, values } = layer;
  const c = document.createElement('canvas');
  c.width = cols; c.height = rows;
  const g = c.getContext('2d');
  const img = g.createImageData(cols, rows);
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < cols; k++) {
      const v = valueFn(values[r * cols + k], r * cols + k);
      const o = ((rows - 1 - r) * cols + k) * 4;
      if (v == null || v < 0 || isNaN(v)) { img.data[o + 3] = 0; continue; }
      const col = colorFn(v);
      if (!col) { img.data[o + 3] = 0; continue; }
      img.data[o] = col[0]; img.data[o + 1] = col[1]; img.data[o + 2] = col[2];
      img.data[o + 3] = Math.round(255 * alphaFn(v));
    }
  }
  g.putImageData(img, 0, 0);
  return c.toDataURL();
}
export function gridValueAt(layer, lat, lon) {
  const [lo0, la0, lo1, la1] = layer.bbox;
  const r = Math.floor((lat - la0) / (la1 - la0) * layer.rows);
  const c = Math.floor((lon - lo0) / (lo1 - lo0) * layer.cols);
  if (r < 0 || c < 0 || r >= layer.rows || c >= layer.cols) return null;
  return { v: layer.values[r * layer.cols + c], i: r * layer.cols + c };
}

// Inverse-distance interpolation of listing values onto a grid shaped like `like`.
export function idwGrid(points, like, { cellScale = 2, radiusM = 700, power = 2, minPts = 2 } = {}) {
  const rows = Math.ceil(like.rows / cellScale), cols = Math.ceil(like.cols / cellScale);
  const [lo0, la0, lo1, la1] = like.bbox;
  const dla = (la1 - la0) / rows, dlo = (lo1 - lo0) / cols;
  const kx = 111320 * Math.cos(((la0 + la1) / 2) * Math.PI / 180), ky = 110574;
  const values = new Array(rows * cols).fill(-1);
  for (let r = 0; r < rows; r++) {
    const la = la0 + (r + 0.5) * dla;
    for (let c = 0; c < cols; c++) {
      const lo = lo0 + (c + 0.5) * dlo;
      let ws = 0, vs = 0, n = 0;
      for (const p of points) {
        const dx = (p.lon - lo) * kx, dy = (p.lat - la) * ky, d = Math.hypot(dx, dy);
        if (d > radiusM) continue;
        const w = 1 / Math.pow(Math.max(d, 40), power);
        ws += w; vs += w * p.v; n++;
      }
      if (n >= minPts) values[r * cols + c] = vs / ws;
    }
  }
  return { bbox: like.bbox, rows, cols, values };
}

export function debounce(fn, ms = 150) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

export function legendHTML(title, rampKey, ticks, unit = '') {
  return `<b>${esc(title)}</b><div class="bar" style="background:${RAMPS[rampKey].css}"></div><div class="ticks">${ticks.map((t) => `<span>${t}${unit}</span>`).join('')}</div>`;
}

// Minimal, safe markdown for research notes: headings, lists, tables, bold, italics, code, links, quotes.
export function md(src) {
  const inline = (t) => esc(t)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  const out = []; let list = null, table = null;
  const flush = () => { if (list) { out.push(`<${list.t}>${list.items.map((i) => `<li>${i}</li>`).join('')}</${list.t}>`); list = null; } if (table) { out.push(`<div class="scroll"><table class="mini">${table.map((r, i) => `<tr>${r.map((c) => (i ? `<td>${inline(c)}</td>` : `<th>${inline(c)}</th>`)).join('')}</tr>`).join('')}</table></div>`); table = null; } };
  for (const raw of String(src).split('\n')) {
    const line = raw.trimEnd();
    let m;
    if (/^\s*\|/.test(line)) { if (/^\s*\|[\s:|-]+\|\s*$/.test(line)) continue; const cells = line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()); if (!table) { flush(); table = []; } table.push(cells); continue; }
    if ((m = line.match(/^(#{1,4})\s+(.*)/))) { flush(); out.push(`<h${Math.min(6, m[1].length + 2)}>${inline(m[2])}</h${Math.min(6, m[1].length + 2)}>`); continue; }
    if ((m = line.match(/^\s*([-*]|\d+\.)\s+(.*)/))) { const t = /\d/.test(m[1]) ? 'ol' : 'ul'; if (!list || list.t !== t) { flush(); list = { t, items: [] }; } list.items.push(inline(m[2])); continue; }
    if ((m = line.match(/^>\s?(.*)/))) { flush(); out.push(`<blockquote>${inline(m[1])}</blockquote>`); continue; }
    if (!line.trim()) { flush(); continue; }
    flush(); out.push(`<p>${inline(line)}</p>`);
  }
  flush();
  return out.join('\n');
}


// ------------------------------------------------------------------ shared visual pieces
export function toast(msg, ms = 2200) {
  const el = document.getElementById('toast'); if (!el) return;
  el.textContent = msg; el.classList.add('on');
  clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('on'), ms);
}

/** Score ring: arc in the score scale with the number in the middle. */
export function ring(v, size = 38, stroke = 3.5) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r, f = Math.max(0, Math.min(1, (v ?? 0) / 100));
  return `<div class="ring ${size > 50 ? 'lg' : ''}" title="Score ${v == null ? 'unknown' : Math.round(v)}"><svg width="${size}" height="${size}" aria-hidden="true"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--surface-3)" stroke-width="${stroke}"/><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${scoreColor(v)}" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${c * f} ${c}"/></svg><b>${v == null ? '?' : Math.round(v)}</b></div>`;
}

export const COMPASS = { N: 0, NNE: 22.5, NE: 45, ENE: 67.5, E: 90, ESE: 112.5, SE: 135, SSE: 157.5, S: 180, SSW: 202.5, SW: 225, WSW: 247.5, W: 270, WNW: 292.5, NW: 315, NNW: 337.5 };
let glyphN = 0;
/** Placeholder art for listings without photos: the tower with this unit's floor lit, and the window exposure. */
export function unitGlyph(L, w = 136, h = 108) {
  if (w > 300) return heroGlyph(L, w, h);
  const id = 'ug' + glyphN++;
  const fl = Math.round(L.floor || 0), n = Math.min(44, Math.max(14, fl + 6));
  const bx = w * 0.2, bw = w * 0.3, top = 12, bot = h - 10, fh = (bot - top) / n;
  let floors = '';
  for (let i = 0; i < n; i++) {
    const y = bot - (i + 1) * fh, lit = i + 1 === fl;
    floors += `<rect x="${bx + 3}" y="${y + 0.6}" width="${bw - 6}" height="${Math.max(0.8, fh - 1.4)}" rx="0.6" fill="${lit ? 'var(--sun)' : 'var(--ink-4)'}" opacity="${lit ? 1 : 0.22}"/>`;
  }
  const cx = w * 0.74, cy = h * 0.42, r = Math.min(w, h) * 0.17;
  const rays = (L.exposure || []).map((e) => COMPASS[e]).filter((a) => a != null).map((a) => {
    const t = (a - 90) * Math.PI / 180;
    return `<line x1="${cx}" y1="${cy}" x2="${cx + Math.cos(t) * r * 0.95}" y2="${cy + Math.sin(t) * r * 0.95}" stroke="var(--sun)" stroke-width="2.4" stroke-linecap="round"/>`;
  }).join('');
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--surface-3)"/><stop offset="1" stop-color="var(--surface-2)"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#${id})"/>
    <rect x="${bx}" y="${top - 2}" width="${bw}" height="${bot - top + 2}" rx="2" fill="var(--surface-1)" stroke="var(--line-strong)"/>${floors}
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--line-strong)"/><text x="${cx}" y="${cy - r - 4}" text-anchor="middle" font-size="8" font-family="var(--font-mono)" fill="var(--ink-3)">N</text>${rays || `<text x="${cx}" y="${cy + 3}" text-anchor="middle" font-size="9" fill="var(--ink-3)">?</text>`}
    <text x="${cx}" y="${h - 14}" text-anchor="middle" font-size="9.5" font-family="var(--font-mono)" fill="var(--ink-3)">${fl ? 'FL ' + fl : 'FLOOR ?'}</text></svg>`;
}
function heroGlyph(L, w, h) {
  const id = 'hg' + glyphN++;
  const fl = Math.round(L.floor || 0), n = Math.min(48, Math.max(16, fl + 8));
  const bx = 56, bw = 64, top = 26, bot = h - 18, fh = (bot - top) / n;
  let floors = '';
  for (let i = 0; i < n; i++) {
    const y = bot - (i + 1) * fh, lit = i + 1 === fl;
    floors += `<rect x="${bx + 5}" y="${y + 0.8}" width="${bw - 10}" height="${Math.max(0.8, fh - 1.8)}" rx="0.8" fill="${lit ? 'var(--sun)' : 'var(--ink-4)'}" opacity="${lit ? 1 : 0.18}"/>`;
  }
  const ly = bot - fl * fh + fh / 2, cx = w - 92, cy = h / 2 - 6, r = 46;
  const ticks = Array.from({ length: 16 }, (_, i) => { const t = (i * 22.5 - 90) * Math.PI / 180, r0 = i % 4 ? r - 4 : r - 8; return `<line x1="${cx + Math.cos(t) * r0}" y1="${cy + Math.sin(t) * r0}" x2="${cx + Math.cos(t) * r}" y2="${cy + Math.sin(t) * r}" stroke="var(--ink-4)" stroke-width="1"/>`; }).join('');
  const rays = (L.exposure || []).map((e) => COMPASS[e]).filter((a) => a != null).map((a) => { const t = (a - 90) * Math.PI / 180, k = r * 0.86; return `<path d="M${cx} ${cy} L${cx + Math.cos(t - 0.32) * k} ${cy + Math.sin(t - 0.32) * k} A${k} ${k} 0 0 1 ${cx + Math.cos(t + 0.32) * k} ${cy + Math.sin(t + 0.32) * k} Z" fill="var(--sun)" opacity=".85"/>`; }).join('');
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><defs><radialGradient id="${id}" cx=".75" cy=".3" r=".9"><stop offset="0" stop-color="color-mix(in srgb, var(--sun) 10%, var(--surface-3))"/><stop offset="1" stop-color="var(--surface-2)"/></radialGradient></defs><rect width="${w}" height="${h}" fill="url(#${id})"/>
    <rect x="${bx}" y="${top - 4}" width="${bw}" height="${bot - top + 4}" rx="3" fill="var(--surface-1)" stroke="var(--line-strong)"/>${floors}
    ${fl ? `<line x1="${bx + bw + 6}" y1="${ly}" x2="${bx + bw + 30}" y2="${ly}" stroke="var(--sun)" stroke-width="1.2"/><text x="${bx + bw + 36}" y="${ly + 4}" font-size="12" font-weight="600" font-family="var(--font-sans)" fill="var(--ink)">Floor ${fl}</text>` : ''}
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="var(--surface-1)" stroke="var(--line-strong)"/>${ticks}${rays}<circle cx="${cx}" cy="${cy}" r="3" fill="var(--ink-2)"/>
    <text x="${cx}" y="${cy - r - 8}" text-anchor="middle" font-size="10" font-weight="600" font-family="var(--font-mono)" fill="var(--ink-3)">N</text>
    <text x="${cx}" y="${cy + r + 20}" text-anchor="middle" font-size="12" font-family="var(--font-sans)" fill="var(--ink-2)">${L.exposure?.length ? 'Windows face ' + esc(L.exposure.join(' / ')) : 'Exposure unknown'}</text>
    <text x="${bx}" y="${h - 4}" font-size="10.5" font-family="var(--font-sans)" fill="var(--ink-3)">No listing photos saved</text></svg>`;
}

// Transit route bullets. Colours come from the transit-lines layer when it is loaded.
export const LINE_COLORS = {};
const DARK_TEXT = new Set(['#F6BC26', '#FCCC0A', '#F6BC26'.toLowerCase(), '#fccc0a']);
export function routeNames(route) {
  const names = [];
  for (const seg of String(route || '').split('→')) {
    const t = seg.trim(), m = t.match(/^([A-Z0-9/]{1,9}) to /);
    if (m && !/^walk/i.test(t)) names.push(...m[1].split('/'));
  }
  return names;
}
export function bullet(n) {
  const c = LINE_COLORS[n] || '#7c858c';
  return `<span class="lb" style="background:${c};${DARK_TEXT.has(c) ? 'color:#111' : ''}">${esc(n)}</span>`;
}
export const bullets = (route, max = 4) => routeNames(route).slice(0, max).map(bullet).join('');

export const ICONS = {
  star: '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 1.6l1.9 4 4.4.5-3.3 3 .9 4.3L8 11.2 4.1 13.4 5 9.1 1.7 6.1l4.4-.5z"/></svg>',
  starO: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M8 1.6l1.9 4 4.4.5-3.3 3 .9 4.3L8 11.2 4.1 13.4 5 9.1 1.7 6.1l4.4-.5z"/></svg>',
  sun: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="8" cy="8" r="3"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6L13 13M13 3l-1.4 1.4M4.4 11.6L3 13"/></svg>',
  x: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
  ext: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M6 3H3v10h10v-3M9 3h4v4M13 3L7 9"/></svg>',
  plus: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M8 3v10M3 8h10"/></svg>',
  check: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M3 8.5l3 3 7-7"/></svg>',
  cube: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M8 2l5.5 3v6L8 14l-5.5-3V5zM8 8l5.5-3M8 8v6M8 8L2.5 5"/></svg>',
  doc: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4 1.5h5.5L12.5 4.5v10h-8.5zM9.5 1.5v3h3M6 8h4.5M6 10.5h4.5"/></svg>',
  plan: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="2" y="2" width="12" height="12" rx="1.5"/><path d="M2 8h5V2M10 14V9h4"/></svg>',
};
