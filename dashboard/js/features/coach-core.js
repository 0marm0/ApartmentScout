// First-run coach marks, pure parts: the steps, whether the tour should start by itself, and where the card goes.
// coach.js owns the DOM; this file has no DOM so node can test the rules.

/** Five steps. `target` names which element to spotlight; coach.js resolves it for the current screen.
 *  {s}, {x}, {g}, {u} in a body are drawn as key caps and {undo} as the platform's undo shortcut. */
export const STEPS = [
  { id: 'filters', target: 'filters', title: 'Start with the filters', body: 'Budget tiers, commute time and must-haves live here. The list and the map follow every change.' },
  { id: 'weights', target: 'weights', title: 'Weights re-rank live', body: 'Drag a slider and the homes re-order as you go. Raise what matters to you; unknown facts stay neutral.' },
  { id: 'star', target: 'star', title: 'Star the ones you like', body: 'Press the star, or {s}, to keep a home in your picks. Anything you do here can be undone with {undo}.' },
  { id: 'compare', target: 'compare', title: 'Line them up in Compare', body: 'Add up to four homes with this button, or press {x}. Compare marks the best value in every row.' },
  { id: 'unit', target: 'unit', title: 'See the light in the unit', body: 'Home holds Unit 3D, which builds the block around a home and shows when the sun reaches its window, and the Floor plan studio. Press {g} then {u} to jump to Unit 3D.' },
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
