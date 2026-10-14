// Decision tray: the pure list operations behind adding, replacing, moving and removing Compare picks.
// The list is the Compare selection (S.compare): at most four ids in column order A to D. No DOM, no imports.

export const MAX = 4;

/** Place `id` at slot `index` of `list`.
 *  - already in the list: it moves to that slot (action 'move', or 'same' when it is already there);
 *  - room left: it is inserted there (the slots after it shift right) -> 'add';
 *  - full and `index` names a slot: it takes that slot and the home there leaves -> 'replace' (with `replaced`);
 *  - full and no slot named (dropped on the dock's edge): nothing changes -> 'full'.
 *  `index` null means "at the end". Returns { list, action, replaced }; the input is never changed. */
export function placeAt(list, id, index = null, max = MAX) {
  const cur = [...list];
  const at = index == null ? null : Math.max(0, Math.min(max - 1, Math.trunc(index)));
  const i = cur.indexOf(id);
  if (i >= 0) {
    const to = Math.min(at ?? cur.length - 1, cur.length - 1);
    if (to === i) return { list: cur, action: 'same', replaced: null };
    cur.splice(i, 1); cur.splice(to, 0, id);
    return { list: cur, action: 'move', replaced: null };
  }
  if (cur.length < max) { cur.splice(Math.min(at ?? cur.length, cur.length), 0, id); return { list: cur, action: 'add', replaced: null }; }
  if (at == null) return { list: cur, action: 'full', replaced: null };
  const replaced = cur[at]; cur[at] = id;
  return { list: cur, action: 'replace', replaced };
}

export const removeId = (list, id) => list.filter((x) => x !== id);

/** Move the item at `from` one place left (-1) or right (+1); stays put at the ends. */
export function nudge(list, from, dir) {
  const to = from + dir;
  if (from < 0 || from >= list.length || to < 0 || to >= list.length) return [...list];
  const cur = [...list]; const [x] = cur.splice(from, 1); cur.splice(to, 0, x);
  return cur;
}

