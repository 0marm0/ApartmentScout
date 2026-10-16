// First-run coach marks, pure parts: the steps, whether the tour should start by itself, and where the card goes.
// coach.js owns the DOM; this file has no DOM so node can test the rules.

/** Four steps through the five journeys: find, compare, see inside, decide and set up (the last two share the menu and the Shortlist).
 *  `target` names which element to spotlight; coach.js resolves it for the current screen.
 *  {s}, {x}, {g}, {u} in a body are drawn as key caps and {undo} as the platform's undo shortcut. */
export const JOURNEYS = ['Find', 'Compare', 'See inside', 'Decide', 'Set up'];
export const STEPS = [
  { id: 'find', journeys: [0], target: 'filters', title: 'Find a home', body: 'Budget, commute and must-haves live in the filters, and every slider re-ranks the homes live. Unknown facts stay neutral.' },
  { id: 'compare', journeys: [1], target: 'compare', title: 'Compare your picks', body: 'Star the ones you like with the star or {s}, then add up to four here, or press {x}. Anything can be undone with {undo}.' },
  { id: 'inside', journeys: [2], target: 'unit', title: 'See inside', body: '3D builds the block around a home and shows when the sun reaches its window; the Floor plan studio tests furniture. Press {g} then {u}.' },
  { id: 'decide', journeys: [3, 4], target: 'menu', title: 'Decide, then set up', body: 'Your picks gather in the Shortlist and become a decision report. This menu holds your search, criteria, sync between devices and this tour.' },
];

/**
 * Should the tour start without being asked?
 *   done       it was finished or skipped in this browser before
 *   automated  a browser under automation (tests, screenshots): never block the page with a tour unless asked with ?coach=1
 *   forced     ?coach=1
 */
export function shouldAutoStart({ done = false, automated = false, forced = false, hasListings = true, view = 'map', hasOpen = false, wizardOpen = false } = {}) {
  if (forced) return hasListings;
  if (done || automated || !hasListings || hasOpen || wizardOpen) return false;
  return view === 'map';
}

/** The next step index in a direction, skipping steps whose target is missing (`has[i]` false). -1 when there is none. */
export function nextStep(index, dir, has) {
  for (let i = index + dir; i >= 0 && i < has.length; i += dir) if (has[i]) return i;
  return -1;
}

/**
 * Where the card goes: `rect` is the target, `card` its size, `vp` the viewport. Prefers the right of a tall target
 * (the filter rail), else below, above, left; clamped inside the viewport with a margin. On a phone it docks at the bottom.
 */
export function placeCard(rect, card, vp, { gap = 14, margin = 12 } = {}) {
  if (vp.w <= 760) return { dock: 'bottom', left: margin, top: Math.max(margin, vp.h - card.h - margin) };
  const clampX = (x) => Math.max(margin, Math.min(vp.w - card.w - margin, x));
  const clampY = (y) => Math.max(margin, Math.min(vp.h - card.h - margin, y));
  const tall = rect.h > vp.h * 0.5;
  const options = tall
    ? ['right', 'left', 'below', 'above']
    : ['below', 'above', 'right', 'left'];
  for (const side of options) {
    if (side === 'right' && rect.x + rect.w + gap + card.w + margin <= vp.w) return { dock: 'right', left: rect.x + rect.w + gap, top: clampY(tall ? Math.max(rect.y, margin) + 24 : rect.y + rect.h / 2 - card.h / 2) };
    if (side === 'left' && rect.x - gap - card.w >= margin) return { dock: 'left', left: rect.x - gap - card.w, top: clampY(rect.y + rect.h / 2 - card.h / 2) };
    if (side === 'below' && rect.y + rect.h + gap + card.h + margin <= vp.h) return { dock: 'below', left: clampX(rect.x + rect.w / 2 - card.w / 2), top: rect.y + rect.h + gap };
    if (side === 'above' && rect.y - gap - card.h >= margin) return { dock: 'above', left: clampX(rect.x + rect.w / 2 - card.w / 2), top: rect.y - gap - card.h };
  }
  return { dock: 'center', left: clampX((vp.w - card.w) / 2), top: clampY((vp.h - card.h) / 2) };
}
