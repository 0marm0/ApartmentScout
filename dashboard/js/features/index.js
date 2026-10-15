// Decision workflow: what the renter does once the shortlist exists. Each feature lives in its own module and attaches
// to the shell through a few event-bus hooks in app.js; nothing here changes how the views render.
//   visit.js     "Since your last visit" pill in the stats strip
//   tray.js      the decision tray: a dock with the Compare picks, drag to add and reorder
//   tradeoff.js  the 2-D trade-off pad for the ranking weights
//   share.js     Share shortlist (read-only HTML) and the decision memo
//   tour-plan.js the tour-day planner under Shortlist > Tours
//   tour-findings.js visit notes, promoted facts and the decision trail (tour-sheet.js, findings-store.js, decision-trail.js)
//   office.js    questions for the leasing office: a drawer section, building-row chips and a draft sheet (office-model.js, office-answer.js)
//   tourday-entry.js the Tour day button and its full-screen phone mode (tourday.js, tourday-model.js, tourday-noise.js)
//   moves.js     why a home moved: the card note, the drawer section and the rail filter (moves-model.js, ranks.json)
//   ../sync/index.js  keep the picks, notes, findings and plans in step between devices (a private gist, or a file); see docs/guides/sync.md
//   unknowns.js  the unknowns that move a score and the renter's own numbers for them (facts-model.js, facts-store.js); after tour-findings.js, whose backup hooks it extends
const FEATURES = [() => import('./visit.js'), () => import('./tray.js'), () => import('./tradeoff.js'), () => import('./share.js'), () => import('./tour-plan.js'), () => import('./tour-findings.js'), () => import('./office.js'), () => import('./tourday-entry.js'), () => import('./moves.js'), () => import('./unknowns.js'), () => import('../sync/index.js')];

export async function initFeatures() {
  for (const load of FEATURES) {
    try { (await load()).init?.(); } catch (e) { console.warn('a decision-workflow feature failed to start', e); }
  }
}
