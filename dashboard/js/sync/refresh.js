// After a merge wrote new values to storage, the parts of the page that keep their own copy in memory read them again: the picks and what hangs on
// them (cards, tabs, the decision history), the ranking weights, Compare, the tour findings and the renter's numbers. Everything else (floor plan
// layouts, view calibrations, the tour-day checklist) is read from storage when its view opens; a few settings that are applied once at start
// (edited criteria, the commute lens, the office answers) need a reload, which the caller offers. Nothing here is recorded as an undo step or as
// a decision made on this device.

/** @param {string[]} keys storage keys (without `as:`) the merge wrote @returns {Promise<{ reload: boolean }>} */
export async function refreshApp(keys) {
  const out = { reload: false };
  if (!keys.length) return out;
  const set = new Set(keys), app = await import('../app.js'), { S, store, emit } = app;
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
  out.reload = mine('criteria') || mine('commute') || mine('office') || mine('tourplan');
  return out;
}
