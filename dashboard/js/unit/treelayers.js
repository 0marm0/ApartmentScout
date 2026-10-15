// Which tree layers the renter has switched on, remembered per browser: "Street trees" (the 2015 census and street
// trees planted since) and "Park trees" (the NYC Parks inventory and the fill in parks). A per-viewer convenience, so
// every read and write is guarded: private windows and blocked storage fall back to both on.

export const KEY = 'as:unit-tree-layers';
const DEFAULTS = { streetTrees: true, parkTrees: true };

function defaultStore() { try { return globalThis.localStorage || null; } catch { return null; } }

/** {streetTrees, parkTrees} from the store; anything missing or not a boolean means on. */
export function loadTreeLayers(store = defaultStore()) {
  try {
    const v = JSON.parse(store?.getItem(KEY) || 'null');
    if (v && typeof v === 'object') return { streetTrees: typeof v.streetTrees === 'boolean' ? v.streetTrees : true, parkTrees: typeof v.parkTrees === 'boolean' ? v.parkTrees : true };
  } catch { /* storage unavailable or not JSON */ }
  return { ...DEFAULTS };
}

export function saveTreeLayers(v, store = defaultStore()) {
  try { store?.setItem(KEY, JSON.stringify({ streetTrees: v.streetTrees !== false, parkTrees: v.parkTrees !== false })); } catch { /* storage unavailable */ }
}

/** The wording of the two layer buttons: where each kind of tree comes from, and that trees never count as shade. */
export const STREET_TREES_TITLE = 'Street trees: the living street trees of the NYC Street Tree Census (2015), minus those the city now lists as removed, plus the street trees the NYC Parks inventory has added since (mostly young trees), each sized from its trunk diameter. Context only: never counted as shade in the sun hours. In the picture they follow the season (leaves on in summer, autumn colours in October and November, bare branches in winter)';
export const PARK_TREES_TITLE = 'Park trees: the trees in parks and on park property from the NYC Parks forestry inventory, with a blue-noise fill only where no inventory describes a park (private plazas and gardens). Context only: never counted as shade in the sun hours. In the picture they follow the season (leaves on in summer, autumn colours in October and November, bare branches in winter)';
