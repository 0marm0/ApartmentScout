// The thumb dock of the 3D views on a phone: a play button, a time-of-day slider and the clock, in a bar at the bottom edge of the picture, where a thumb
// rests, so the time can be moved without scrolling down to the panel under the picture (that panel stays; the dock drives the same state). Shown by CSS
// only at phone widths (css/views/phone3d.css); on a laptop it is display: none and costs nothing (it is not polled while hidden).
// Used by Unit 3D (unit3d.js) and the Floor plan studio (plan3d.js). The page owns the time: the dock only reads it (`get`) and asks to change it (`set`).

const PLAY = '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M5 3.2v9.6L12.8 8z"/></svg>';
const PAUSE = '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M4.5 3h2.6v10H4.5zM8.9 3h2.6v10H8.9z"/></svg>';

/**
 * @param {HTMLElement} host  the stage the dock floats over
 * @param {{min:number, max:number, step:number, get(): number, set(v:number): void, text(): string, playing(): boolean, toggle(): void, label?: string}} o
 * @returns {{el: HTMLElement, sync(): void, dispose(): void}}
 */
export function mountDock(host, o) {
  const el = document.createElement('div');
  el.className = 'float rnq-dock'; el.setAttribute('role', 'group'); el.setAttribute('aria-label', o.label || 'Time of day');
  el.innerHTML = `<button type="button" class="rnq-dock-play" aria-label="Play the day" aria-pressed="false">${PLAY}</button>`
    + `<input type="range" class="rnq-dock-range" aria-label="Time of day" min="${o.min}" max="${o.max}" step="${o.step}">`
    + '<output class="rnq-dock-t" aria-live="off"></output>';
  host.appendChild(el);
  const play = el.querySelector('button'), range = el.querySelector('input'), out = el.querySelector('output');
  let was = null, drag = false;
  const sync = () => {
    if (!el.offsetParent) return;   // hidden (a laptop, or the view is not showing): nothing to draw
    const v = o.get(), on = !!o.playing(), t = o.text();
    if (!drag && +range.value !== v) range.value = String(v);
    range.style.setProperty('--p', `${((v - o.min) / (o.max - o.min)) * 100}%`);
    if (out.textContent !== t) out.textContent = t;
    if (was !== on) { was = on; play.innerHTML = on ? PAUSE : PLAY; play.setAttribute('aria-pressed', String(on)); play.setAttribute('aria-label', on ? 'Pause the day' : 'Play the day'); }
  };
  range.addEventListener('input', () => { o.set(+range.value); sync(); });
  range.addEventListener('pointerdown', () => { drag = true; });
  range.addEventListener('pointerup', () => { drag = false; });
  range.addEventListener('pointercancel', () => { drag = false; });
  play.addEventListener('click', () => { o.toggle(); sync(); });
  const iv = setInterval(sync, 250);   // the time also moves by itself (Play day) and from the panel below: follow it
  sync();
  return { el, sync, dispose() { clearInterval(iv); el.remove(); } };
}
