// Small DOM helpers shared by the decision-workflow features (visit pill, decision tray, trade-off pad, share, tour
// planner). They attach to markup the shell and views own, so each helper re-attaches when that markup is rebuilt.
export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Run `fn` now and again whenever `root`'s children change (the owner re-renders with innerHTML). `fn` must be
 *  idempotent. Returns a disconnect function. */
export function watch(root, fn, { subtree = false } = {}) {
  if (!root) return () => {};
  let queued = false;
  const run = () => { queued = false; try { fn(); } catch (e) { console.warn('feature mount failed', e); } };
  const mo = new MutationObserver(() => { if (!queued) { queued = true; queueMicrotask(run); } });
  mo.observe(root, { childList: true, subtree });
  run();
  return () => mo.disconnect();
}

/** Make a button open a popover with the usual keyboard behaviour: Esc closes and returns focus, Tab leaves,
 *  arrows move between the focusable items, a click outside closes. Returns set(open, focus). */
export function popover(btn, pop, { onOpen } = {}) {
  const items = () => [...pop.querySelectorAll('button:not([disabled]), a[href]')];
  const set = (open, focus = false) => {
    if (!open === pop.hidden) return;
    pop.hidden = !open; btn.setAttribute('aria-expanded', String(open));
    if (open) { onOpen?.(); if (focus) items()[0]?.focus(); }
  };
  btn.addEventListener('click', (e) => { e.stopPropagation(); set(pop.hidden, pop.hidden && e.detail === 0); });
  document.addEventListener('click', (e) => { if (!pop.hidden && !pop.contains(e.target) && !btn.contains(e.target)) set(false); });
  pop.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); set(false); btn.focus(); return; }
    const it = items(), i = it.indexOf(document.activeElement);
    const step = { ArrowDown: 1, ArrowUp: -1 }[e.key];
    if (step && it.length) { e.preventDefault(); it[(i + step + it.length) % it.length].focus(); }
    else if (e.key === 'Home') { e.preventDefault(); it[0]?.focus(); }
    else if (e.key === 'End') { e.preventDefault(); it[it.length - 1]?.focus(); }
    else if (e.key === 'Tab') set(false);
  });
  return set;
}
