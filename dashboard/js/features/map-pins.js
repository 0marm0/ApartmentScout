// What the map draws as pins, decided in one place and free of DOM and map code so it can be tested on its own.
//
// Four kinds of pin, from most to least prominent:
//   stars     the renter's own saved picks (gold). Never clustered, never grouped, never hidden.
//   top       the best-ranked homes in the current sort (and the open one). Plain pins that stay on the map
//             at any zoom; a count bubble never swallows them.
//   buildings a building with two or more of the remaining homes is ONE pin that carries the unit count
//             and the lowest monthly cost ("6 units · from $4,995"), so a tower does not paint a stack of
//             identical dots on top of each other.
//   singles   every other home.
// Buildings and singles go into the clustered source: zoomed out, nearby ones merge into a bubble that
// counts HOMES (a building contributes its units) and shows the lowest cost inside.

export const TOP_N = 10;
/** Sentinel for "no price known": larger than any rent, so a minimum over a cluster ignores it. */
export const NO_PRICE = 1e9;

const clean = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
/** One building: the same name (or address) at the same spot to about 10 m. */
export const buildingKey = (L) => `${clean(L.building || L.address || L.id)}@${L.lat.toFixed(4)},${L.lon.toFixed(4)}`;
export const buildingId = (key) => `b:${key}`;
export const isBuildingId = (id) => typeof id === 'string' && id.startsWith('b:');

/** The lowest monthly cost among the units still on the market (any unit when all are gone); null when none has a price. */
export function lowestCost(units, cost) {
  const priced = (arr) => arr.map(cost).filter((v) => Number.isFinite(v));
  const live = priced(units.filter((L) => L.status !== 'gone'));
  const all = live.length ? live : priced(units);
  return all.length ? Math.min(...all) : null;
}
export const dollars = (v) => `$${Math.round(v).toLocaleString('en-US')}`;
/** "6 units · from $4,995" (or just "6 units" when no unit has a price). */
export const unitsLabel = (n, price) => `${n} ${n === 1 ? 'unit' : 'units'}${price != null ? ` · from ${dollars(price)}` : ''}`;

/**
 * Split an ordered list of homes (best first, all with coordinates) into the four kinds of pin.
 * @param {object[]} list homes in the current sort order
 * @param {{isStar:(L:object)=>boolean, split?:(L:object)=>boolean, keep?:(L:object)=>boolean, topN?:number}} opts
 *   split: homes drawn by another layer (the sun lens), left out here; keep: homes that must stay visible (the open one)
 */
export function pinPlan(list, { isStar, split = () => false, keep = () => false, topN = TOP_N }) {
  const stars = [], top = [], groups = new Map();
  let n = 0;
  for (const L of list) {
    if (isStar(L)) { stars.push(L); continue; }
    if (split(L)) continue;
    const isTop = n < topN && L.status !== 'gone';
    if (isTop) n++;
    if (isTop || keep(L)) { top.push(L); continue; }
    const k = buildingKey(L), g = groups.get(k);
    if (g) g.push(L); else groups.set(k, [L]);
  }
  const featured = new Set([...stars, ...top].map(buildingKey));
  const singles = [], buildings = [];
  for (const [key, units] of groups) {
    if (units.length < 2) { singles.push(units[0]); continue; }
    buildings.push({ key, id: buildingId(key), units, lon: units[0].lon, lat: units[0].lat, shifted: featured.has(key) });
  }
  return { stars, top, singles, buildings };
}

/** Lowest cost to a short label for tests and the legend: "$3,900". */
export const fromText = (price) => (price == null ? '' : `from ${dollars(price)}`);
