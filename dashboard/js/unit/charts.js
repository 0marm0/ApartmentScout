// Unit 3D charts: the clickable day strip, the sun path against the skyline, the floor-by-month heatmap
// and the monthly sun band. Pure drawing from data the view passes in; colours come from the tokens.
import { css } from '../util.js';
import { dayTable, hAt, fmtT, compass } from '../sun.js';

export const STRIP_FROM = 300, STRIP_TO = 1290, STRIP_STEP = 5;
const STATE_NAMES = ['night', 'sun behind the facade', 'shaded by buildings', 'direct sun'];

/** Run-length segments of a day-state array as positioned divs. */
export function stripBar(states) {
  const n = states.length; let h = '';
  for (let k = 0; k < n;) {
    let j = k; while (j < n && states[j] === states[k]) j++;
    const a = STRIP_FROM + k * STRIP_STEP, b = STRIP_FROM + j * STRIP_STEP;
    h += `<i class="s${states[k]}" style="left:${(k / n) * 100}%;width:${((j - k) / n) * 100}%" title="${fmtT(a)} to ${fmtT(b)}: ${STATE_NAMES[states[k]]}"></i>`;
    k = j;
  }
  return h;
}
export function stripTicks() {
  let h = '';
  for (let m = 360; m <= 1260; m += 180) h += `<span style="left:${((m - STRIP_FROM) / (STRIP_TO - STRIP_FROM)) * 100}%">${fmtT(m).replace(':00', '')}</span>`;
  return h;
}
export const stateAt = (states, min) => states[Math.max(0, Math.min(states.length - 1, Math.floor((min - STRIP_FROM) / STRIP_STEP)))];
export const STATE_LABEL = STATE_NAMES;

/**
 * Sun path against the skyline. o: {lat, lon, tz, date:'YYYY-MM-DD', az (window bearing), profA, profB, profF, sun:{az,alt}}
 */
export function drawPath(c, o) {
  const dpr = devicePixelRatio || 1, cw = c.clientWidth || 380, ch = Math.round(Math.min(340, Math.max(230, cw * 0.66)));
  c.width = Math.round(cw * dpr); c.height = Math.round(ch * dpr); c.style.height = ch + 'px';
  const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, cw, ch);
  const ink = css('--ink'), ink2 = css('--ink-2'), ink3 = css('--ink-3'), ink4 = css('--ink-4'), line = css('--line-strong'), sun = css('--sun'), warn = css('--warn'), panel = css('--surface-1');
  const L0 = 34, R = 8, T0 = 10, Bm = 26, pw = cw - L0 - R, ph = ch - T0 - Bm, a0 = o.az - 105, a1 = o.az + 105, amax = 75;
  const X = (a) => L0 + ((a - a0) / (a1 - a0)) * pw, Y = (al) => T0 + ph - (Math.max(0, Math.min(amax, al)) / amax) * ph;
  g.font = `500 10px ${css('--font-mono') || 'monospace'}`; g.textBaseline = 'middle'; g.lineWidth = 1;
  for (let al = 0; al <= amax; al += 15) { g.strokeStyle = line; g.globalAlpha = al ? 0.5 : 1; g.beginPath(); g.moveTo(L0, Y(al) + 0.5); g.lineTo(cw - R, Y(al) + 0.5); g.stroke(); g.globalAlpha = 1; g.fillStyle = ink3; g.textAlign = 'right'; g.fillText(al + '°', L0 - 6, Y(al)); }
  for (let a = Math.ceil(a0 / 45) * 45; a <= a1; a += 45) { const aa = ((a % 360) + 360) % 360; g.fillStyle = ink3; g.textAlign = 'center'; g.fillText(`${compass(aa)} ${aa}°`, X(a), ch - Bm + 15); }
  // facade edges (sun behind the window beyond these)
  g.fillStyle = ink4; g.globalAlpha = 0.16;
  g.fillRect(L0, T0, X(o.az - 90) - L0, ph); g.fillRect(X(o.az + 90), T0, cw - R - X(o.az + 90), ph); g.globalAlpha = 1;
  g.setLineDash([3, 4]); g.strokeStyle = ink3; [o.az - 90, o.az + 90].forEach((a) => { g.beginPath(); g.moveTo(X(a) + 0.5, T0); g.lineTo(X(a) + 0.5, T0 + ph); g.stroke(); }); g.setLineDash([]);
  const prof = (p, fill, stroke, dash) => {
    if (!p) return;
    g.beginPath(); g.moveTo(X(a0), T0 + ph);
    for (let a = a0; a <= a1; a += 0.5) g.lineTo(X(a), Y(hAt(p, a)));
    if (fill) { g.lineTo(X(a1), T0 + ph); g.closePath(); g.fillStyle = fill; g.fill(); }
    if (stroke) {
      g.beginPath(); for (let a = a0; a <= a1; a += 0.5) (a === a0 ? g.moveTo : g.lineTo).call(g, X(a), Y(hAt(p, a)));
      g.strokeStyle = stroke; g.lineWidth = 1.4; g.setLineDash(dash || []); g.stroke(); g.setLineDash([]); g.lineWidth = 1;
    }
  };
  if (o.profF) prof(o.profF, null, warn, [2, 3]);
  g.globalAlpha = 0.62; prof(o.profA, ink4, null); g.globalAlpha = 1; prof(o.profA, null, ink3);
  prof(o.profB, null, ink2, [5, 4]);
  const wrap = (az) => { let a = az; while (a < a0 - 180) a += 360; while (a > a1 + 180) a -= 360; return a; };
  const curve = (y, mo, d, colr, w, hrs) => {
    const t = table(y, mo, d, o.lat, o.lon, o.tz, 4); let prev = null;
    g.lineWidth = w; g.lineCap = 'round';
    for (const [m, az, al] of t) {
      const a = wrap(az); if (a < a0 || a > a1) { prev = null; continue; }
      const p = [X(a), Y(al)], lit = Math.abs(a - o.az) < 90 && al > hAt(o.profA, az);
      if (prev) { g.strokeStyle = colr; g.globalAlpha = hrs && !lit ? 0.38 : 1; g.beginPath(); g.moveTo(prev[0], prev[1]); g.lineTo(p[0], p[1]); g.stroke(); }
      prev = p;
    }
    g.globalAlpha = 1; g.lineWidth = 1;
    if (hrs) {
      g.font = `600 10px ${css('--font-sans') || 'sans-serif'}`; g.textAlign = 'center';
      for (const [m, az, al] of t) {
        if (m % 120) continue; const a = wrap(az); if (a < a0 || a > a1) continue;
        g.fillStyle = colr; g.beginPath(); g.arc(X(a), Y(al), 2.6, 0, 6.3); g.fill();
        g.fillStyle = ink2; g.fillText(fmtT(m).replace(':00', '').replace(' ', ''), X(a), Y(al) - 10);
      }
    }
    return t;
  };
  const y = +o.date.slice(0, 4);
  g.setLineDash([]); [[5, 21, 'Jun 21'], [2, 20, 'Mar 20'], [11, 21, 'Dec 21']].forEach(([mo, d, n]) => {
    g.globalAlpha = 0.9; curve(y, mo, d, ink3, 1, false); g.globalAlpha = 1;
    // label each reference curve at its peak
    const t = table(y, mo, d, o.lat, o.lon, o.tz, 10); let best = null;
    for (const r of t) { const a = wrap(r[1]); if (a >= a0 + 8 && a <= a1 - 8 && (!best || r[2] > best[2])) best = [a, 0, r[2]]; }
    if (best) { g.fillStyle = ink3; g.textAlign = 'center'; g.font = `500 9.5px ${css('--font-mono') || 'monospace'}`; g.fillText(n, X(best[0]), Y(best[2]) - 8); }
  });
  const [yy, mm, dd] = o.date.split('-').map(Number);
  curve(yy, mm - 1, dd, sun, 2.6, true);
  if (o.sun && o.sun.alt > 0) {
    const a = wrap(o.sun.az);
    if (a >= a0 && a <= a1) { g.beginPath(); g.arc(X(a), Y(o.sun.alt), 6.5, 0, 6.3); g.fillStyle = sun; g.fill(); g.lineWidth = 2; g.strokeStyle = panel; g.stroke(); g.lineWidth = 1; }
  }
  // the window's own bearing: a sun-coloured tick on the axis
  g.fillStyle = sun; g.beginPath(); g.moveTo(X(o.az), T0 + ph - 1); g.lineTo(X(o.az) - 4, T0 + ph + 6); g.lineTo(X(o.az) + 4, T0 + ph + 6); g.closePath(); g.fill();
}

/** Floor x month heatmap (hours of direct sun on the 15th). */
export function heatHTML(heat, maxF, floor, cmp, month, busy) {
  let h = '<div class="hd"></div>' + 'JFMAMJJASOND'.split('').map((m, i) => `<div class="hd${i === month ? ' now' : ''}">${m}</div>`).join('');
  for (let fl = maxF; fl >= 2; fl--) {
    const row = heat?.[fl], cls = fl === floor ? ' cur' : fl === cmp ? ' cmp' : '';
    h += `<div class="fl${cls}" data-fl="${fl}">${fl}</div>`;
    for (let m = 0; m < 12; m++) {
      if (!row) { h += `<div class="c pend${cls}"></div>`; continue; }
      const v = row[m], pct = Math.round(Math.min(1, v / 9) * 100);
      h += `<div class="c${cls}${pct > 52 ? ' hi' : ''}${m === month ? ' mon' : ''}" data-fl="${fl}" data-m="${m}" style="--p:${pct}%" title="Floor ${fl}, ${'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ')[m]} 15: ${v.toFixed(1)} h">${v < 0.05 ? '0' : v.toFixed(1)}</div>`;
    }
  }
  return `<div class="u-heat${busy ? ' busy' : ''}">${h}</div>`;
}

/** Twelve months of direct sun for the window: model bars plus the lo-hi range band when the site has one. */
export function monthBandSVG(vals, range, month) {
  const W = 340, H = 92, pad = 18, top = 8, bw = (W - 6) / 12, max = 10;
  const Y = (v) => top + (H - pad - top) * (1 - Math.min(max, Math.max(0, v)) / max);
  let s = '';
  for (let m = 0; m < 12; m++) {
    const x = 3 + m * bw, cx = x + bw / 2;
    if (range?.lo?.length === 12 && range?.hi?.length === 12) {
      const lo = +range.lo[m] || 0, hi = +range.hi[m] || 0;
      s += `<rect x="${x + 3}" y="${Y(hi)}" width="${bw - 6}" height="${Math.max(2, Y(lo) - Y(hi))}" rx="3" fill="var(--sun)" opacity=".2"/>`;
      s += `<line x1="${x + 3}" x2="${x + bw - 3}" y1="${Y(hi)}" y2="${Y(hi)}" stroke="var(--sun)" stroke-opacity=".55"/><line x1="${x + 3}" x2="${x + bw - 3}" y1="${Y(lo)}" y2="${Y(lo)}" stroke="var(--sun)" stroke-opacity=".55"/>`;
    }
    const v = vals?.[m];
    if (v != null) s += `<rect x="${cx - 3}" y="${Y(v)}" width="6" height="${Math.max(1.5, H - pad - Y(v))}" rx="2" fill="var(--sun)"/>`;
    s += `<text x="${cx}" y="${H - 4}" text-anchor="middle" class="${m === month ? 'now' : ''}">${'JFMAMJJASOND'[m]}</text>`;
  }
  for (const v of [3, 6, 9]) s += `<line x1="0" x2="${W}" y1="${Y(v)}" y2="${Y(v)}" class="gl"/><text x="${W}" y="${Y(v) - 2}" text-anchor="end" class="yl">${v} h</text>`;
  return `<svg class="u-band" viewBox="0 0 ${W} ${H}" role="img" aria-label="Direct sun hours by month">${s}</svg>`;
}

// day tables are pure functions of date and place: memoise them so play-day redraws stay cheap
const memo = new Map();
export function table(y, mo, d, lat, lon, tz, step) {
  const k = `${y}-${mo}-${d}-${lat}-${lon}-${tz}-${step}`;
  if (!memo.has(k)) { if (memo.size > 120) memo.clear(); memo.set(k, dayTable(y, mo, d, lat, lon, tz, step)); }
  return memo.get(k);
}
