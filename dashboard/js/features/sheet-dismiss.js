// Swipe down to close, for the phone's sheets that are not the listing sheet (which has detents, see native.js): the visit sheet, the office
// questions, the search settings, the menu, the install guide. The panel follows the finger down; a pull past the threshold, or a flick, closes it
// by running the sheet's own close (so its focus handling and state stay its own); a short pull springs back. A pull only counts when the
// sheet's content is scrolled to the top (otherwise the content scrolls) or when it starts on the grab bar or the header.
const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.motion === 'reduced';

/** @param {HTMLElement} panel the element that moves
 *  @param {{ scroller?: HTMLElement|string|null, handle?: string|null, close: () => void, threshold?: number }} o `handle`: a selector for the grab bar or header,
 *  where a pull always counts. Returns a function that removes the listeners. */
export function swipeToDismiss(panel, { scroller = null, handle = null, close, threshold = 110 }) {
  let g = null;
  const sc = () => (typeof scroller === 'string' ? panel.querySelector(scroller) : scroller) || panel;   // looked up on each touch: the sheet redraws its content
  const start = (e) => {
    if (e.touches.length !== 1 || e.target.closest('textarea, input, select, [data-no-swipe]')) { g = null; return; }
    const t = e.touches[0];
    g = { x: t.clientX, y: t.clientY, on: false, dy: 0, grab: !!(handle && e.target.closest(handle)), t0: e.timeStamp, last: [{ t: e.timeStamp, y: t.clientY }] };   // event times: a busy page handles the moves late, the finger did not move late
  };
  const move = (e) => {
    if (!g) return;
    const t = e.touches[0], dy = t.clientY - g.y, dx = t.clientX - g.x;
    if (!g.on) {
      const atTop = (sc().scrollTop || 0) <= 0;
      if (dy < -3 || Math.abs(dx) > Math.abs(dy) * 1.2 && Math.abs(dx) > 8) { g = null; return; }
      if (dy < 3) return;
      if (!g.grab && !atTop) { g = null; return; }
      g.on = true; panel.style.transition = 'none';
    }
    if (e.cancelable) e.preventDefault();
    g.dy = Math.max(0, dy);
    g.last.push({ t: e.timeStamp, y: t.clientY }); if (g.last.length > 6) g.last.shift();
    panel.style.transform = `translate3d(0, ${g.dy}px, 0)`;
  };
  const end = (cancelled) => {
    if (!g?.on) { g = null; return; }
    const s = g; g = null;
    const a = s.last[0], b = s.last[s.last.length - 1], v = b.t > a.t ? (b.y - a.y) / (b.t - a.t) : 0;
    const shut = !cancelled && (s.dy > threshold || (v > 0.6 && s.dy > 30));
    if (shut) {
      if (calm()) { panel.style.transform = ''; panel.style.transition = ''; close(); return; }
      panel.style.transition = 'transform 220ms cubic-bezier(.4,0,1,1)'; panel.style.transform = 'translate3d(0, 105%, 0)';
      setTimeout(() => { close(); panel.style.transition = ''; panel.style.transform = ''; }, 200);
    } else {
      panel.style.transition = calm() ? 'none' : 'transform 360ms cubic-bezier(.34,1.3,.64,1)'; panel.style.transform = '';
      setTimeout(() => { panel.style.transition = ''; }, 400);
    }
  };
  const onEnd = () => end(false), onCancel = () => end(true);
  panel.addEventListener('touchstart', start, { passive: true });
  panel.addEventListener('touchmove', move, { passive: false });
  panel.addEventListener('touchend', onEnd); panel.addEventListener('touchcancel', onCancel);
  return () => { panel.removeEventListener('touchstart', start); panel.removeEventListener('touchmove', move); panel.removeEventListener('touchend', onEnd); panel.removeEventListener('touchcancel', onCancel); };
}

/** Close a sheet by its own Escape handling (every sheet in the app answers it), from wherever the sheet listens. */
export const closeByEscape = (el) => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));

const SHEETS = [
  { find: '#visitSheet', panel: '.vs-panel', scroller: '.vs-body', handle: '.vs-h' },
  { find: '#officeSheet', panel: '.of-panel', scroller: '.of-body', handle: '.of-h' },
  { find: '.sheet[role="dialog"]', panel: null, scroller: '.sh-body', handle: '.sh-h' },
  { find: '#appMenu', panel: null, scroller: '.am-body', handle: '.am-grab' },
];

/** Give each of the app's sheets the swipe, as they appear (they are built when opened, and the menu is always there). */
export function attachSheets() {
  const done = new WeakSet();
  const scan = (root) => {
    for (const d of SHEETS) {
      for (const host of root.matches?.(d.find) ? [root] : root.querySelectorAll ? root.querySelectorAll(d.find) : []) {
        const panel = d.panel ? host.querySelector(d.panel) : host;
        if (!panel || done.has(panel)) continue;
        done.add(panel);
        swipeToDismiss(panel, {
          scroller: d.scroller, handle: d.handle,
          close: () => { if (matchMedia('(max-width: 760px)').matches) closeByEscape(panel); },
        });
      }
    }
  };
  scan(document.body);
  new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1) scan(n); }).observe(document.body, { childList: true, subtree: true });
}
