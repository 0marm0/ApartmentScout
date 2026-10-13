// Shared helpers: formatting, colour ramps, grids, tiny DOM utilities.
export const $ = (id) => document.getElementById(id);
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const money = (v) => (v == null || isNaN(v) ? '?' : '$' + Math.round(v).toLocaleString());
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
  score: { fn: ramp([[30, '#c0392b'], [50, '#e39a1b'], [65, '#c9c23a'], [80, '#2e9e62'], [95, '#0c6b47']]), stops: [30, 50, 65, 80, 95], css: 'linear-gradient(90deg,#c0392b,#e39a1b,#c9c23a,#2e9e62,#0c6b47)' },
  commute: { fn: ramp([[8, '#0b6e69'], [18, '#3fae8c'], [28, '#e9d25b'], [40, '#ec7d38'], [55, '#b3197a'], [75, '#5b0b4f']]), stops: [8, 18, 28, 40, 55, 75], css: 'linear-gradient(90deg,#0b6e69,#3fae8c,#e9d25b,#ec7d38,#b3197a,#5b0b4f)' },
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
