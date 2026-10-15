// The "look out" chips over a 3D view: one chip per window group (a room, a bay, a corner) to stand at, and one per seat
// (sofa, bed, desk) to look out from. Used by the Floor plan studio and by Unit 3D's Inside camera. Pure string builders and a
// key handler: the radio-group keys (arrows, Home, End) switch the view, and `[` / `]` switch from anywhere in the view.
import { esc } from '../util.js';

const WINDOW_KINDS = ['room', 'bay', 'corner'];

/** The chips as HTML. `views` = viewpoints (plan/viewpoints.js), `current` = the active key or null. */
export function lookChipsHTML(views, current, { label = 'Look out of the window' } = {}) {
  const win = views.filter((v) => WINDOW_KINDS.includes(v.kind)), seat = views.filter((v) => v.kind === 'seat');
  if (!win.length && !seat.length) return '';
  const chip = (v) => `<button type="button" role="radio" class="lk-chip${v.key === current ? ' on' : ''}${v.kind === 'bay' || v.kind === 'corner' ? ' wide' : ''}" data-vp="${esc(v.key)}" aria-checked="${v.key === current}" tabindex="${v.key === current || (!current && v === views[0]) ? 0 : -1}" title="${esc(v.kind === 'seat' ? `Look out of the window from the ${v.label.toLowerCase()}` : `Stand at the ${v.room ? v.room.toLowerCase() + ' ' : ''}window${v.kind === 'room' ? '' : ` (${v.kind})`}`)}">${esc(v.label)}</button>`;
  return `${win.length ? `<div class="lk-grp" role="radiogroup" aria-label="${esc(label)}"><span class="lk-h">Look out of</span>${win.map(chip).join('')}</div>` : ''}${seat.length ? `<div class="lk-grp" role="radiogroup" aria-label="Look out from a seat"><span class="lk-h">From the</span>${seat.map(chip).join('')}</div>` : ''}<span class="lk-keys" aria-hidden="true">← → to switch</span>`;
}

/**
 * Wire the chips in `host` (an element that holds the HTML above). `pick(key)` runs when a chip is chosen, by click or key.
 * Returns a function to call after the chips are redrawn (it restores focus to the active chip when it had it).
 */
export function bindLookChips(host, { pick, order }) {
  host.addEventListener('click', (e) => { const b = e.target.closest('[data-vp]'); if (b) pick(b.dataset.vp); });
  host.addEventListener('keydown', (e) => {
    const b = e.target.closest('[data-vp]'); if (!b || e.altKey || e.ctrlKey || e.metaKey) return;
    const keys = order(); if (!keys.length) return;
    const i = keys.indexOf(b.dataset.vp);
    const next = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? keys[(i + 1) % keys.length] : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? keys[(i - 1 + keys.length) % keys.length] : e.key === 'Home' ? keys[0] : e.key === 'End' ? keys[keys.length - 1] : null;
    if (!next) return;
    e.preventDefault(); e.stopPropagation(); pick(next);
    requestAnimationFrame(() => host.querySelector(`[data-vp="${CSS.escape(next)}"]`)?.focus());
  });
}
