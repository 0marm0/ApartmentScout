// Option groups: pieces of "Your furniture" the renter switches between, such as their own bed against a bed they may buy. Pure (no DOM, no
// three.js), so node:test covers it and the studio's two panes and Unit 3D answer the same way.
//
// The groups are data (`options` in furniture.json, validated by plan/inventory.js):
//   {"bed": {"label": "Bed", "default": "mine", "choices": [
//      {"id": "mine", "label": "My bed", "pieces": ["bed", "nightstand-1", "nightstand-2"]},
//      {"id": "storage", "label": "Latitude Run storage bed", "pieces": ["bed-latitude"]},
//      {"id": "none", "label": "No bed", "pieces": ["nightstand-1", "nightstand-2"]}]}}
// A choice shows exactly the pieces it lists and hides every other piece of its group. The choice is stored where the renter's other edits
// are: as the pieces' own `hidden` marks in the saved layout (plan/layout.js), so it is remembered with the layout, undone with it, and
// read by every view that reads the layout. Choosing never changes a position, a rotation or a size: no piece moves (plan/placement.js).

/** The groups of an inventory as a list, or []. */
export const groupsOf = (inv) => Object.entries(inv?.options || {}).map(([id, g]) => ({ id, ...g }));

/** The piece ids a group governs: every piece any of its choices names. */
const governed = (g) => [...new Set(g.choices.flatMap((c) => c.pieces))];

/**
 * Where the renter stands in a group: which choice the layout shows now. `available` is false unless the layout holds every piece the group
 * names (a plan whose layout has no storage bed has nothing to switch to); `exact` is false when the renter has since hidden or shown a piece
 * by hand so no choice matches (the closest one is `current`).
 * @returns {{group: string, label: string, available: boolean, current: string|null, exact: boolean, choices: {id: string, label: string}[]}|null}
 */
export function choiceState(items, inv, groupId = 'bed', { removed = [] } = {}) {
  const g = groupsOf(inv).find((x) => x.id === groupId);
  if (!g) return null;
  const by = new Map((items || []).map((it) => [it.id, it])), ids = governed(g), gone = new Set(removed), have = new Set((inv?.pieces || []).map((p) => p.id));
  // A Shown / Hidden switch (a choice that lists no piece: the sim rig, the office chair) stays while the group exists in the inventory, whatever the
  // layout holds: a piece the renter removed, or a layout that never held it, is brought back by choosing "Shown". Any other group (the candidate bed)
  // needs its pieces in the layout, or removed from it by hand.
  const toggle = g.choices.some((c) => !c.pieces.length);
  const available = ids.every((id) => by.has(id) || (have.has(id) && (toggle || gone.has(id))));
  let best = null, bestScore = -1, exact = false;
  for (const c of g.choices) {
    const score = ids.filter((id) => (by.has(id) && !by.get(id).hidden) === c.pieces.includes(id)).length;   // a piece the layout does not hold counts as hidden
    if (score > bestScore) { best = c; bestScore = score; exact = score === ids.length; }
  }
  return { group: g.id, label: g.label, available, current: available ? best?.id ?? null : null, exact, choices: g.choices.map((c) => ({ id: c.id, label: c.label })) };
}

/**
 * The items with a group's choice applied: the pieces the choice lists are shown, every other piece of the group is hidden. Positions,
 * rotations, sizes and every other mark are untouched; items the choice leaves as they are keep their identity. Returns new items.
 */
export function applyChoice(items, inv, groupId, choiceId) {
  const g = groupsOf(inv).find((x) => x.id === groupId), c = g?.choices.find((x) => x.id === choiceId);
  if (!c) return items;
  const ids = new Set(governed(g)), show = new Set(c.pieces);
  return items.map((it) => {
    if (!ids.has(it.id)) return it;
    if (show.has(it.id)) { if (!it.hidden) return it; const o = { ...it }; delete o.hidden; return o; }
    return it.hidden ? it : { ...it, hidden: true };
  });
}

/** The default choice of a group, for a layout that has never been touched. */
export const defaultChoice = (inv, groupId = 'bed') => groupsOf(inv).find((x) => x.id === groupId)?.default ?? null;
