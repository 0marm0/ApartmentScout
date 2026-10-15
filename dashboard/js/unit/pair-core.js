// Which two apartments the side-by-side view opens with. Pure (no DOM), so node:test covers it.
//
// Asked for two (#pair/a,b) it opens those. Asked for one, or none, it fills in: first from the apartments on the Compare list that
// have a site model, then from the same building (the pair that differs most in floor is the interesting one, but the two lowest
// floors are the stable choice), then any two.

/**
 * @param {string[]} want ids from the address
 * @param {string[]} have ids with a site model
 * @param {{compare?: string[], byId?: (id: string) => object|undefined}} [ctx]
 * @returns {[string, string] | null}
 */
export function pickPair(want, have, { compare = [], byId = () => undefined } = {}) {
  const ok = new Set(have);
  const pick = [];
  const add = (id) => { if (ok.has(id) && !pick.includes(id)) pick.push(id); };
  for (const id of want || []) add(id);
  if (pick.length < 2) for (const id of compare || []) add(id);
  if (pick.length === 1) {   // a partner in the same building, nearest in floor, else any
    const me = byId(pick[0]) || {}, mates = have.filter((id) => id !== pick[0] && byId(id)?.building && byId(id).building === me.building);
    mates.sort((a, b) => Math.abs((byId(a).floor ?? 0) - (me.floor ?? 0)) - Math.abs((byId(b).floor ?? 0) - (me.floor ?? 0)));
    if (mates[0]) pick.push(mates[0]);
  }
  if (pick.length < 2) {
    const groups = new Map();
    for (const id of have) { const b = byId(id)?.building; if (b) groups.set(b, [...(groups.get(b) || []), id]); }
    const best = [...groups.values()].filter((g) => g.length >= 2).sort((a, b) => b.length - a.length)[0];
    if (best) { best.sort((a, b) => (byId(a).floor ?? 0) - (byId(b).floor ?? 0)); for (const id of best) { if (pick.length >= 2) break; add(id); } }
  }
  for (const id of have) { if (pick.length >= 2) break; add(id); }
  return pick.length >= 2 ? [pick[0], pick[1]] : null;
}
