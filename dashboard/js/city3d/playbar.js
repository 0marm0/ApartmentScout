// The "play the sun" bar of both 3D views (Unit 3D's time panel and the Floor plan studio's): a Play day and a Play year button, the sentence that says when the sun
// reaches the floor, the month during a year loop, the tree stage (a picture) and a small strip chart of direct-sun hours by month with a cursor. DOM only: the clock is
// city3d/timeplay.js, and each view drives the bar from its own frame loop. Colours are the dashboard's tokens (css/views/room3d.css).
import { monthBars, MONTH_NAMES } from './timeplay.js';

const NS = 'http://www.w3.org/2000/svg';
const ICON = {
  play: '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M4.5 2.8v10.4L13 8z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M4.5 3h2.6v10H4.5zM8.9 3h2.6v10H8.9z" fill="currentColor"/></svg>',
};
const LETTERS = 'JFMAMJJASOND';

/**
 * Mount the bar in `host`.
 * @param {HTMLElement} host
 * @param {{onToggle(kind: 'day' | 'year'): void, onMonth(month: number): void, onScrub(t: number): void, keys?: {day?: string, year?: string}}} o
 *   onToggle: a Play button was pressed; onMonth: a month bar of the chart was clicked (0..11); onScrub: the chart was dragged to progress t (0..1) of the year
 * @returns {{el: HTMLElement, setPlaying(kind: 'day' | 'year' | null): void, setSentence(text: string, now?: string): void, setMonth(text: string, tree?: {label: string, note: string} | null): void,
 *   setChart(hours: number[] | null, o: {month: number, t: number, label?: string}): void, destroy(): void}}
 */
export function mountPlayBar(host, o) {
  const el = document.createElement('div'); el.className = 'pb'; el.setAttribute('role', 'group'); el.setAttribute('aria-label', 'Play the sun through the day or the year');
  el.innerHTML = `<div class="seg pb-seg">
      <button type="button" data-pb="day" aria-pressed="false" title="Play the day: the sun from first light to last, the sun patches crossing the floor and furniture${o.keys?.day ? ` (${o.keys.day})` : ''}">${ICON.play}<span>Play day</span></button>
      <button type="button" data-pb="year" aria-pressed="false" title="Play the year: the same time of day through twelve months, to see the patch move with the seasons${o.keys?.year ? ` (${o.keys.year})` : ''}">${ICON.play}<span>Play year</span></button>
    </div>
    <div class="pb-read"><span class="pb-sun" role="status"></span><span class="pb-now" hidden></span><span class="pb-when" hidden></span><span class="pb-tree" hidden></span></div>
    <figure class="pb-chart" hidden><svg role="img" aria-label="Direct sun hours by month for this window"></svg><figcaption>Direct sun, hours a day, by month</figcaption></figure>`;
  host.append(el);
  const svg = el.querySelector('.pb-chart svg'), $ = (s) => el.querySelector(s);
  let kind = null;
  el.addEventListener('click', (e) => { const b = e.target.closest('[data-pb]'); if (b) o.onToggle(b.dataset.pb); });
  // the chart: a click on a month bar jumps to the 15th of that month, a drag scrubs the year (and pauses it)
  let drag = false, geo = null;
  const at = (e) => { const r = svg.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / Math.max(1, r.width))); };
  svg.addEventListener('pointerdown', (e) => { drag = true; svg.setPointerCapture(e.pointerId); const m = e.target.dataset?.m; if (m != null) o.onMonth(+m); else o.onScrub(at(e)); });
  svg.addEventListener('pointermove', (e) => { if (drag) o.onScrub(at(e)); });
  svg.addEventListener('pointerup', () => { drag = false; });
  svg.addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { o.onMonth(Math.max(0, Math.min(11, (geo?.month ?? 0) + (e.key === 'ArrowRight' ? 1 : -1)))); e.preventDefault(); } });
  svg.setAttribute('tabindex', '0');

  const api = {
    el,
    setPlaying(k) {
      kind = k;
      for (const b of el.querySelectorAll('[data-pb]')) {
        const on = b.dataset.pb === k, name = b.dataset.pb === 'day' ? 'Play day' : 'Play year';
        b.setAttribute('aria-pressed', String(on)); b.classList.toggle('on', on);
        b.querySelector('span').textContent = on ? 'Pause' : name;
        b.firstElementChild.outerHTML = on ? ICON.pause : ICON.play;
      }
      el.dataset.playing = k || '';
      $('.pb-when').hidden = k !== 'year';
    },
    setSentence(text, now) {
      const s = $('.pb-sun'); if (s.textContent !== text) s.textContent = text;
      const n = $('.pb-now'); n.hidden = !now; if (now) { n.textContent = `now ${now}`; n.dataset.state = now === 'in sun' ? 'sun' : now === 'night' ? 'night' : 'shade'; }
    },
    setMonth(text, tree) {
      const w = $('.pb-when'); w.hidden = !text; if (text && w.textContent !== text) w.textContent = text;
      const t = $('.pb-tree'); t.hidden = !tree;
      if (tree) { if (t.textContent !== tree.label) t.textContent = tree.label; t.title = tree.note; }
    },
    setChart(hours, { month, t, label } = {}) {
      const fig = $('.pb-chart'); fig.hidden = !hours;
      if (!hours) return;
      const g = monthBars(hours, { w: 252, h: 52, pad: 12 }); geo = { month };
      const key = hours.map((v) => v.toFixed(2)).join(',');
      if (svg.dataset.key !== key) {
        svg.dataset.key = key; svg.setAttribute('viewBox', `0 0 ${g.width} ${g.height}`); svg.textContent = '';
        const add = (tag, attrs, text) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); if (text != null) n.textContent = text; svg.append(n); return n; };
        for (const v of g.ticks) add('line', { class: 'pb-grid', x1: 0, x2: g.width, y1: g.chartHeight - (v / g.max) * g.chartHeight, y2: g.chartHeight - (v / g.max) * g.chartHeight });
        g.bars.forEach((b, i) => { const r = add('rect', { class: 'pb-bar', 'data-m': i, x: b.x, y: b.y, width: b.w, height: b.h, rx: 1.5 }); const tt = document.createElementNS(NS, 'title'); tt.textContent = `${MONTH_NAMES[i]}: ${b.hours.toFixed(1)} h of direct sun a day (the 15th)`; r.append(tt); });
        for (let i = 0; i < 12; i++) add('text', { class: 'pb-m', 'data-m': i, x: g.bars[i].x + g.bars[i].w / 2, y: g.height - 1, 'text-anchor': 'middle' }, LETTERS[i]);
        add('text', { class: 'pb-max', x: g.width, y: 8, 'text-anchor': 'end' }, `${g.max} h`);
        add('line', { class: 'pb-cursor', x1: 0, x2: 0, y1: 0, y2: g.chartHeight + 2 });
      }
      svg.querySelectorAll('.pb-bar, .pb-m').forEach((n) => n.classList.toggle('cur', +n.dataset.m === month));
      const cur = svg.querySelector('.pb-cursor'); cur.setAttribute('x1', g.cursor(t)); cur.setAttribute('x2', g.cursor(t));
      svg.setAttribute('aria-label', `Direct sun hours by month for this window${label ? `; now ${label}` : ''}`);
    },
    get playing() { return kind; },
    destroy() { el.remove(); },
  };
  return api;
}
