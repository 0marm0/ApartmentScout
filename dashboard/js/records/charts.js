// Records view charts: monthly timeline (two lanes), 311 by hour of day, breakdown bars, plus a tiny tooltip.
// Colours are token variables in SVG attributes, so a theme switch needs no re-render.
import { esc } from '../util.js';
import { fmtMonth, fmtDate, niceNoise } from './model.js';

export const SERIES = [
  { k: 'hpdC', name: 'HPD complaints', color: 'var(--score-2)', note: 'tenant reports' },
  { k: 'hpdV', name: 'HPD violations', color: 'var(--score-1)', note: 'inspector findings' },
  { k: 'dob', name: 'DOB complaints', color: 'var(--band-20)', note: 'reports' },
  { k: 'ecb', name: 'ECB / OATH', color: 'var(--band-45)', note: 'penalty records' },
];
const NOISE = 'var(--band-30)';
const NIGHT = 'var(--band-45)';

// ------------------------------------------------------------------ tooltip
export function makeTip(host) {
  const el = document.createElement('div');
  el.className = 'rec-tip'; el.setAttribute('role', 'tooltip'); el.hidden = true;
  host.appendChild(el);
  return {
    show(html, clientX, clientY) {
      el.innerHTML = html; el.hidden = false;
      const r = host.getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight;
      let x = clientX - r.left + 14, y = clientY - r.top - h - 10;
      if (x + w > r.width - 4) x = clientX - r.left - w - 14;
      if (x < 4) x = 4;
      if (y < 4) y = clientY - r.top + 18;
      el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    },
    hide() { el.hidden = true; },
  };
}
/** Delegated tooltips for any [data-tip] inside host (text only, \n becomes a line break). */
export function bindTips(host, tip) {
  host.addEventListener('pointermove', (e) => {
    const t = e.target.closest?.('[data-tip]');
    if (!t || !host.contains(t)) { tip.hide(); return; }
    tip.show(esc(t.dataset.tip).replace(/\n/g, '<br>'), e.clientX, e.clientY);
  });
  host.addEventListener('pointerleave', () => tip.hide());
}

const niceMax = (v) => { if (v <= 4) return Math.max(2, Math.ceil(v)); const p = Math.pow(10, Math.floor(Math.log10(v))), f = v / p; return (f <= 1.5 ? 1.5 : f <= 2 ? 2 : f <= 3 ? 3 : f <= 5 ? 5 : 10) * p; };

// ------------------------------------------------------------------ timeline
/**
 * Mounts the two-lane monthly timeline into `host`. Lane 1: 311 noise requests near the building.
 * Lane 2: official records stacked by dataset (toggle datasets in the legend). Hover or touch a month for the numbers.
 */
export function mountTimeline(host, M) {
  const S = M.series, N = S.months.length;
  const on = new Set(SERIES.map((s) => s.k).filter((k) => S[k].some(Boolean)));
  host.classList.add('rec-tl');
  host.innerHTML = '<div class="rec-tl-legend" id="recTlLeg"></div><div class="rec-chart"><svg role="img"></svg></div>';
  const svg = host.querySelector('svg'), wrap = host.querySelector('.rec-chart'), leg = host.querySelector('#recTlLeg');
  const tip = makeTip(wrap);

  const padL = 34, padR = 6;
  const A = { y: 26, h: 108 }, B = { y: A.y + A.h + 46, h: 84 }, H = B.y + B.h + 26;
  let W = 0;

  function draw() {
    W = Math.max(300, Math.round(wrap.clientWidth || 880));
    const plotW = W - padL - padR, bw = plotW / N;
    const maxA = niceMax(Math.max(...S.noise, 1));
    const stack = S.months.map((_, i) => SERIES.filter((s) => on.has(s.k)).reduce((t, s) => t + S[s.k][i], 0));
    const maxB = niceMax(Math.max(...stack, 1));
    const xs = (i) => padL + i * bw;
    let g = `<defs><pattern id="recHatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="var(--ink-4)" stroke-width="1" opacity=".45"/></pattern></defs>`;
    // lane titles and grid
    const lane = (L, max, title, sub) => {
      let s = `<text x="${padL}" y="${L.y - 11}" class="rec-lt">${esc(title)}</text><text x="${W - padR}" y="${L.y - 11}" text-anchor="end" class="rec-ls">${esc(sub)}</text>`;
      for (const f of [0, 0.5, 1]) {
        const y = L.y + L.h - f * L.h;
        s += `<line x1="${padL}" x2="${W - padR}" y1="${y}" y2="${y}" stroke="var(--line${f ? '' : '-strong'})"/><text x="${padL - 6}" y="${y + 3.5}" text-anchor="end" class="rec-ax">${Math.round(max * f * 10) / 10}</text>`;
      }
      return s;
    };
    g += lane(A, maxA, '311 noise requests', `within ${M.nz.radius_m ?? 150} m, per month`);
    g += lane(B, maxB, 'Official records', 'count per month, by dataset');
    // lane A bars
    let peak = 0;
    S.noise.forEach((v, i) => { if (v > S.noise[peak]) peak = i; });
    S.noise.forEach((v, i) => { const h = (v / maxA) * A.h; g += `<rect x="${xs(i) + 1}" y="${A.y + A.h - h}" width="${Math.max(1, bw - 2)}" height="${h}" rx="1.5" fill="${NOISE}" opacity="${i === peak ? 1 : 0.62}"/>`; });
    if (S.noise[peak] > 0) {
      const px = xs(peak) + bw / 2, anchor = px > W - 90 ? 'end' : px < padL + 60 ? 'start' : 'middle';
      g += `<text x="${px}" y="${A.y + A.h - (S.noise[peak] / maxA) * A.h - 5}" text-anchor="${anchor}" class="rec-peak">${S.noise[peak]} · ${esc(fmtMonth(S.months[peak]))}</text>`;
    }
    // lane B partial coverage hatch (older rows not retained)
    const onCov = SERIES.filter((s) => on.has(s.k)).map((s) => S.coverage[s.k]?.from).filter(Boolean);
    if (onCov.length) {
      const latest = onCov.reduce((a, d) => (d > a ? d : a));
      const key = latest.toISOString().slice(0, 7), ci = S.months.indexOf(key);
      if (ci > 1) g += `<rect x="${padL}" y="${B.y}" width="${ci * bw}" height="${B.h}" fill="url(#recHatch)"/><text x="${padL + 6}" y="${B.y + 13}" class="rec-ax">older rows not retained</text>`;
    }
    // lane B stacked bars
    S.months.forEach((_, i) => {
      let y = B.y + B.h;
      for (const s of SERIES) {
        if (!on.has(s.k)) continue;
        const v = S[s.k][i]; if (!v) continue;
        const h = (v / maxB) * B.h; y -= h;
        g += `<rect x="${xs(i) + 1}" y="${y}" width="${Math.max(1, bw - 2)}" height="${Math.max(2, h - 1)}" rx="1.5" fill="${s.color}"/>`;
      }
    });
    // x axis
    let lastLabel = -99;
    S.months.forEach((k, i) => {
      const m = +k.slice(5), x = xs(i) + bw / 2;
      if ((m !== 1 && m !== 7 && i !== 0) || x - lastLabel < 52) return;
      lastLabel = x;
      g += `<text x="${x}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : 'middle'}" class="rec-ax">${m === 1 ? k.slice(0, 4) : fmtMonth(k).replace(/ \d\d(\d\d)$/, " '$1")}</text>`;
    });
    g += `<g id="recHl" style="display:none"><rect id="recHlR" y="${A.y - 4}" height="${B.y + B.h - A.y + 8}" width="${bw}" fill="var(--ink)" opacity=".07" rx="2"/></g>`;
    g += `<rect id="recHit" x="${padL}" y="0" width="${plotW}" height="${H}" fill="transparent" style="cursor:crosshair;touch-action:pan-y"/>`;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('aria-label', `Monthly timeline, ${fmtMonth(S.months[0])} to ${fmtMonth(S.months[N - 1])}: 311 noise peaks at ${S.noise[peak]} in ${fmtMonth(S.months[peak])}; official records by dataset below.`);
    svg.innerHTML = g;

    const hl = svg.querySelector('#recHl'), hlr = svg.querySelector('#recHlR'), hit = svg.querySelector('#recHit');
    const at = (e) => { const r = svg.getBoundingClientRect(); const x = ((e.clientX - r.left) / r.width) * W; return Math.max(0, Math.min(N - 1, Math.floor((x - padL) / bw))); };
    const move = (e) => {
      const i = at(e); hl.style.display = ''; hlr.setAttribute('x', xs(i));
      const rows = [`<b>${esc(fmtMonth(S.months[i]))}</b>`, `<span class="rec-tr"><i class="sw" style="background:${NOISE}"></i>311 noise nearby<b>${S.noise[i]}</b></span>`]
        .concat(SERIES.filter((s) => on.has(s.k)).map((s) => `<span class="rec-tr"><i class="sw" style="background:${s.color}"></i>${esc(s.name)}<b>${S[s.k][i]}</b></span>`));
      const hatch = SERIES.some((s) => on.has(s.k) && S.coverage[s.k]?.from && new Date(Date.UTC(+S.months[i].slice(0, 4), +S.months[i].slice(5) - 1, 28)) < S.coverage[s.k].from);
      if (hatch) rows.push('<span class="rec-tn">Some older rows not retained</span>');
      tip.show(rows.join(''), e.clientX, e.clientY);
    };
    hit.addEventListener('pointermove', move); hit.addEventListener('pointerdown', move);
    hit.addEventListener('pointerleave', () => { hl.style.display = 'none'; tip.hide(); });
  }

  function legend() {
    leg.innerHTML = `<span class="rec-lg fixed"><i class="sw" style="background:${NOISE}"></i>311 noise (lane 1)</span>` + SERIES.map((s) => {
      const has = S[s.k].some(Boolean), cv = S.coverage[s.k];
      const part = cv?.from ? ` · latest ${cv.shown} of ${cv.total} rows` : '';
      return `<button type="button" class="chip ${on.has(s.k) ? 'on' : ''}" data-k="${s.k}" ${has ? '' : 'disabled'} aria-pressed="${on.has(s.k)}" title="${esc(s.note)}${esc(part)}"><i class="sw" style="background:${s.color}"></i>${esc(s.name)}<span class="n">${has ? S[s.k].reduce((a, v) => a + v, 0) : 0}</span></button>`;
    }).join('');
    leg.querySelectorAll('button[data-k]').forEach((btn) => btn.addEventListener('click', () => {
      const k = btn.dataset.k; on.has(k) ? on.delete(k) : on.add(k); legend(); draw();
    }));
  }
  legend(); draw();
  let lastW = W;
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => { const w = Math.round(wrap.clientWidth); if (w && Math.abs(w - lastW) > 8) { lastW = w; draw(); } }).observe(wrap);

  const parts = SERIES.filter((s) => S.coverage[s.k]?.from).map((s) => `${s.name}: latest ${S.coverage[s.k].shown} of ${S.coverage[s.k].total} rows since ${fmtDate(S.coverage[s.k].from)}`);
  return parts.length ? `The dossier keeps the most recent rows of each dataset, so older months are hatched. ${parts.join('; ')}.` : '';
}

// ------------------------------------------------------------------ 311 by hour of day
export function hourChart(hours, night) {
  if (!hours?.length) return '<p class="muted">No hourly data.</p>';
  const W = 400, H = 230, l = 28, bt = 26, bb = 28, max = Math.max(...hours, 1), step = (W - l - 6) / 24, ph = H - bt - bb;
  const fmt = (i) => `${i === 0 ? 12 : i > 12 ? i - 12 : i}${i < 12 ? ' am' : ' pm'}`;
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="311 noise requests by hour of day; ${Math.round((night || 0) * 100)} percent between 10 pm and 6 am">`;
  // night bands (0-6 and 22-24)
  s += `<rect x="${l}" y="${bt - 6}" width="${step * 6}" height="${ph + 6}" fill="${NIGHT}" opacity=".10" rx="3"/><rect x="${l + step * 22}" y="${bt - 6}" width="${step * 2}" height="${ph + 6}" fill="${NIGHT}" opacity=".10" rx="3"/>`;
  s += `<text x="${l + 4}" y="${bt - 10}" class="rec-ax">night</text>`;
  for (const f of [0, 0.5, 1]) { const y = bt + ph - f * ph; s += `<line x1="${l}" x2="${W - 6}" y1="${y}" y2="${y}" stroke="var(--line)"/><text x="${l - 5}" y="${y + 3.5}" text-anchor="end" class="rec-ax">${Math.round(max * f)}</text>`; }
  hours.forEach((v, i) => {
    const h = (v / max) * ph, isNight = i >= 22 || i < 6;
    s += `<rect x="${l + i * step + 1.5}" y="${bt + ph - h}" width="${step - 3}" height="${Math.max(1, h)}" rx="2" fill="${isNight ? NIGHT : NOISE}" opacity="${isNight ? 1 : 0.7}" data-tip="${fmt(i)} to ${fmt((i + 1) % 24)}\n${v} requests${isNight ? ' (night)' : ''}" tabindex="-1"/>`;
  });
  [0, 6, 12, 18].forEach((i) => (s += `<text x="${l + i * step}" y="${H - 8}" class="rec-ax" text-anchor="start">${i === 0 ? '12 am' : i === 12 ? '12 pm' : fmt(i)}</text>`));
  return s + '</svg>';
}

// ------------------------------------------------------------------ breakdown bars
/** entries: [[label, value, sublabel?]]. */
export function barList(entries, { color = 'var(--accent)', max, empty = 'None in the window.', limit = 8 } = {}) {
  const e = entries.filter(([k]) => k && k !== 'null').slice(0, limit);
  if (!e.length) return `<p class="muted rec-none">${esc(empty)}</p>`;
  const m = max || Math.max(...e.map(([, v]) => v), 1);
  return `<ul class="rec-bars">${e.map(([k, v, sub]) => `<li><span class="l">${esc(k)}${sub ? `<small>${esc(sub)}</small>` : ''}</span><span class="t"><i style="width:${Math.max(2, (v / m) * 100)}%;background:${color}"></i></span><b class="num">${v.toLocaleString()}</b></li>`).join('')}</ul>`;
}
export function noiseTypeBars(byType) {
  const entries = Object.entries(byType || {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => { const t = niceNoise(k); return [t.what, v, t.cat]; });
  return barList(entries, { color: NOISE, limit: 8 });
}
