// The floating toolbar beside the selected piece in the Floor plan studio, the same in the 2D plan and the 3D view:
// rotate 90 degrees, rotate freely (a dial: a slider with the four square angles), move (an arrow pad for touch and for fine nudges;
// dragging the piece works too) and remove, plus a close button. Keys (R, Delete, Esc, arrows) are the studio's own.
// DOM only; the studio passes what each button does and where the piece is on screen, so both panes share one component.
import { esc } from '../util.js';

const ICON = {
  rot: '<path d="M13 8a5 5 0 1 1-1.9-3.9"/><path d="M13 2.6v3.1h-3.1"/>',
  free: '<circle cx="8" cy="8" r="5.6"/><path d="M8 8l3-3.2"/><path d="M8 2.4v1.4M13.6 8h-1.4M8 13.6v-1.4M2.4 8h1.4" class="tk"/>',
  move: '<path d="M8 2v12M2 8h12M8 2L6.2 3.8M8 2l1.8 1.8M8 14l-1.8-1.8M8 14l1.8-1.8M2 8l1.8-1.8M2 8l1.8 1.8M14 8l-1.8-1.8M14 8l-1.8 1.8"/>',
  dup: '<rect x="5.2" y="5.2" width="8" height="8" rx="1.4"/><path d="M10.8 5.2V3.6a.8.8 0 0 0-.8-.8H3.6a.8.8 0 0 0-.8.8V10a.8.8 0 0 0 .8.8h1.6"/>',
  del: '<path d="M3 4.6h10M6.4 4.6V3h3.2v1.6M4.4 4.6l.6 8.2h6l.6-8.2"/>',
  done: '<path d="M4 4l8 8M12 4l-8 8"/>',
};
const svg = (k) => `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k]}</svg>`;
const btn = (act, label, title, extra = '') => `<button type="button" class="sb-b" data-act="${act}" aria-label="${esc(label)}" title="${esc(title)}" ${extra}>${svg(act)}<span>${esc(label)}</span></button>`;

/** The toolbar's markup. */
export function selbarHTML() {
  return `<div class="sb-name" data-sb="name"></div>
    <div class="sb-row" role="toolbar" aria-label="Selected piece">
      ${btn('rot', 'Rotate 90°', 'Rotate 90° (R; Shift+R turns the other way)')}
      ${btn('free', 'Rotate', 'Rotate to any angle', 'aria-expanded="false" aria-haspopup="true"')}
      ${btn('move', 'Move', 'Move: drag the piece, press the arrow keys, or use the arrows here', 'aria-expanded="false" aria-haspopup="true"')}
      ${btn('dup', 'Duplicate', 'Duplicate: a copy beside it that you can drag into another room (D)')}
      ${btn('del', 'Remove', 'Remove from the layout (Delete; Undo brings it back)')}
      <i class="sb-sep" aria-hidden="true"></i>
      ${btn('done', 'Done', 'Deselect (Esc)')}
    </div>
    <div class="sb-pop" data-pop="free" hidden>
      <label class="sb-dial"><span>Angle</span><input type="range" min="0" max="359" step="1" value="0" data-sb="angle" aria-label="Angle in degrees"><output data-sb="deg">0°</output></label>
      <div class="sb-snaps" role="group" aria-label="Square angles">${[0, 90, 180, 270].map((a) => `<button type="button" data-snap="${a}">${a}°</button>`).join('')}</div>
    </div>
    <div class="sb-pop" data-pop="move" hidden>
      <div class="sb-pad" role="group" aria-label="Nudge">
        <button type="button" data-nx="0" data-ny="1" aria-label="Move up the plan" class="u">▲</button>
        <button type="button" data-nx="-1" data-ny="0" aria-label="Move left" class="l">◀</button>
        <button type="button" data-nx="1" data-ny="0" aria-label="Move right" class="r">▶</button>
        <button type="button" data-nx="0" data-ny="-1" aria-label="Move down the plan" class="d">▼</button>
      </div>
      <div class="sb-step" role="group" aria-label="Step size"><button type="button" data-step="1">1 in</button><button type="button" data-step="6" class="on">6 in</button><button type="button" data-step="12">1 ft</button></div>
    </div>`;
}

/**
 * Put a toolbar into `host` (a positioned pane). `on` = {rot(), free(deg, live), move(dx, dy), dup(), del(), done()}.
 * @returns {{el: HTMLElement, show(rect, info): void, hide(): void, closePops(): void, visible: boolean}}
 */
export function mountSelbar(host, on) {
  const el = document.createElement('div');
  el.className = 'float selbar'; el.hidden = true; el.innerHTML = selbarHTML(); el.setAttribute('role', 'group'); el.setAttribute('aria-label', 'Selected piece');
  host.appendChild(el);
  const $ = (s) => el.querySelector(s), pops = { free: $('[data-pop=free]'), move: $('[data-pop=move]') };
  let step = 6, rotating = false;
  const closePops = () => { for (const [k, p] of Object.entries(pops)) { p.hidden = true; $(`[data-act=${k}]`).setAttribute('aria-expanded', 'false'); $(`[data-act=${k}]`).classList.remove('on'); } };
  const toggle = (k) => { const open = pops[k].hidden; closePops(); if (open) { pops[k].hidden = false; $(`[data-act=${k}]`).setAttribute('aria-expanded', 'true'); $(`[data-act=${k}]`).classList.add('on'); } };
  // the stage's own pointer handlers (orbit, drag a piece, clear the selection) must not see clicks on the bar
  for (const t of ['pointerdown', 'pointerup', 'click', 'dblclick', 'wheel']) el.addEventListener(t, (e) => e.stopPropagation());
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.act) {
      const a = b.dataset.act;
      if (a === 'rot') on.rot(); else if (a === 'free') toggle('free'); else if (a === 'move') toggle('move'); else if (a === 'dup') on.dup?.(); else if (a === 'del') on.del(); else if (a === 'done') on.done();
    } else if (b.dataset.nx != null) on.move(+b.dataset.nx * step, +b.dataset.ny * step);
    else if (b.dataset.step) { step = +b.dataset.step; el.querySelectorAll('[data-step]').forEach((x) => x.classList.toggle('on', x === b)); }
    else if (b.dataset.snap != null) { const v = +b.dataset.snap; $('[data-sb=angle]').value = v; $('[data-sb=deg]').textContent = `${v}°`; on.free(v, true); on.free(v, false); }
  });
  const dial = $('[data-sb=angle]');
  dial.addEventListener('input', () => { rotating = true; $('[data-sb=deg]').textContent = `${dial.value}°`; on.free(+dial.value, true); });
  dial.addEventListener('change', () => { rotating = false; on.free(+dial.value, false); });
  el.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); if (pops.free.hidden && pops.move.hidden) on.done(); else closePops(); } });
  const api = {
    el, closePops, visible: false,
    /** `rect` = the piece's box in the host's pixels ({x0, y0, x1, y1}); `info` = {name, rot}. */
    show(rect, info = {}) {
      el.hidden = false; api.visible = true;
      $('[data-sb=name]').textContent = info.name || '';
      if (!rotating && info.rot != null) { const r = Math.round(((info.rot % 360) + 360) % 360); if (+dial.value !== r) dial.value = r; $('[data-sb=deg]').textContent = `${r}°`; }
      const W = host.clientWidth, H = host.clientHeight, bw = el.offsetWidth, bh = el.offsetHeight;
      let x = (rect.x0 + rect.x1) / 2 - bw / 2, y = rect.y0 - bh - 12;
      if (y < 52) y = Math.min(H - bh - 8, rect.y1 + 12);   // no room above (the camera chips sit there): below the piece
      x = Math.max(8, Math.min(W - bw - 8, x)); y = Math.max(52, Math.min(H - bh - 8, y));
      el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    },
    hide() { if (!el.hidden) { el.hidden = true; closePops(); } api.visible = false; },
  };
  return api;
}
