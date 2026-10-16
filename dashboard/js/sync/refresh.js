// After a merge wrote new values to storage, the parts of the page that keep their own copy in memory read them again: the picks and what hangs on
// them (cards, tabs, the decision history), the ranking weights, Compare, the tour findings and the renter's numbers directly, and every feature that
// registered in `reloaders` (app.js): the move plan, the leasing-office answers, the tour planner, the tour-day checklist, what's new. Without that a
// feature's next save would write its stale copy over the merge. The floor plan studio, view calibrations and the like are read from storage when their
// view opens; edited criteria and the commute lens are applied once at start, so a reload shows them (the caller offers one). Nothing here is recorded
// as an undo step or as a decision made on this device.

/** @param {string[]} keys storage keys (without `as:`) the merge wrote @returns {Promise<{ reload: boolean }>} */
export async function refreshApp(keys) {
  const out = { reload: false };
  if (!keys.length) return out;
  const set = new Set(keys), app = await import('../app.js'), { S, store, emit, reloaders } = app;
  const name = S.crit0?.search?.name || S.base, mine = (prefix) => set.has(`${prefix}:${name}`);
  let undo = null, trail = null, tf = null, facts = null;
  try { undo = await import('../features/undo.js'); } catch { /* the feature set did not load */ }
  try { trail = await import('../features/decision-trail.js'); tf = await import('../features/findings-store.js'); facts = await import('../features/facts-store.js'); } catch { /* ditto */ }
  const quiet = (fn) => (undo?.quiet ? undo.quiet(fn) : fn());
  quiet(() => {
    if (set.has('picks')) {
      const next = store.get('picks', {}) || {};
      for (const k of Object.keys(S.picks)) delete S.picks[k];
      Object.assign(S.picks, next);
    }
    if (set.has('compare')) S.compare.splice(0, S.compare.length, ...(store.get('compare', []) || []));
    if (set.has('weights') || set.has('preset')) {
      S.weights = { ...(S.crit0?.weights || {}), ...(store.get('weights', null) || {}) };
      S.preset = store.get('preset', null) || S.crit0?.scoring?.preset || null;
      app.rescore();
    }
    if (set.has('picks') || mine('trail')) trail?.reload();
    if (mine('findings')) tf?.reloadFromStorage();
    if (mine('facts')) facts?.reloadFromStorage();
    if (set.has('picks')) emit('saved');
    if (set.has('compare')) emit('compare');
    if (set.has('weights') || set.has('preset')) { app.renderRail(); emit('weights'); emit('weights-settled'); }
  });
  // features that keep their own copy: read it again (they register in `reloaders`), so their next save does not write a stale copy over the merge
  for (const [family, fn] of Object.entries(reloaders)) {
    if (!keys.some((k) => k === `${family}:${name}` || k.startsWith(`${family}:${name}`))) continue;
    try { quiet(() => fn()); } catch (e) { console.warn('could not refresh', family, String(e?.message || e).slice(0, 120)); }
  }
  out.reload = mine('criteria') || mine('commute');   // applied once at start: a reload shows them
  return out;
}
