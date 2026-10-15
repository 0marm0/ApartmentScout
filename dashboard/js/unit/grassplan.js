// Which ground layer each green polygon is drawn on, and how that layer is textured. Pure (no DOM, no three.js), so the
// ordering is testable; the drawing is unit/grassmesh.js.
//
// The green polygons of a site overlap: the city's park property (NYC Parks Properties) under an OpenStreetMap park
// under a mapped lawn under a mapped court. Drawn in one pass they would fight for the same pixels, so each goes on
// a layer and the layers are drawn back to front, each a little higher and with its own polygon offset:
//
//   base   parks, gardens, woods, greenstreets, planted plazas: lush grass (woods darker, mottled)
//   paved  city playgrounds, courts, fields and piers (NYC Parks says so): paved ground
//   lawn   lawns mapped inside a park (OpenStreetMap landuse=grass, meadow ...): brighter, mown in stripes
//   court  courts, pitches and plazas OpenStreetMap marks paved (surface, playground): paved ground over any lawn
//   turf   artificial-turf fields and field-sport pitches with no surface tag: flat green, no trees

export const KINDS = ['park', 'play', 'grass', 'wood'];
export const LAYER = { base: 0, paved: 1, lawn: 2, court: 3, turf: 4 };
/**
 * Texture parameters per layer, read by the shader: `patch` the amplitude of the large (25 m) tone patches, `fine` the
 * metre-scale and blade-scale detail (faded out with distance), `stripe` the amplitude of mowing stripes, `hue` how far the
 * patches drift toward yellow-green. Paved layers are nearly flat with a faint speckle.
 */
export const STYLE = {
  base: { patch: 0.2, fine: 0.17, stripe: 0, hue: 0.55 },
  paved: { patch: 0.05, fine: 0.05, stripe: 0, hue: 0 },
  lawn: { patch: 0.15, fine: 0.12, stripe: 0.07, hue: 0.4 },
  court: { patch: 0.05, fine: 0.05, stripe: 0, hue: 0 },
  turf: { patch: 0.05, fine: 0.03, stripe: 0.1, hue: 0 },
};

const num = (v) => Number.isFinite(+v) && v !== null && v !== '' && v !== true && v !== false;
const okRing = (r) => Array.isArray(r) && r.length >= 3 && r.every((q) => Array.isArray(q) && num(q[0]) && num(q[1]));

/** The layer a polygon belongs on (see the header). */
export function layerOf(p) {
  if (p.hard && p.turf) return 'turf';
  if (p.hard) return p.src === 'parks' ? 'paved' : 'court';
  return p.kind === 'grass' ? 'lawn' : 'base';
}

/**
 * [{layer, name, polys}] drawn back to front: only the layers that have polygons, malformed ones dropped, holes kept
 * when well formed. Each poly keeps its own `ring` array.
 */
export function grassPlan(polys) {
  const by = {};
  for (const p of Array.isArray(polys) ? polys : []) {
    if (!p || !KINDS.includes(p.kind) || !okRing(p.ring)) continue;
    const name = layerOf(p);
    (by[name] || (by[name] = [])).push({ ...p, ring: p.ring, holes: (Array.isArray(p.holes) ? p.holes : []).filter(okRing) });
  }
  return Object.keys(by).map((name) => ({ layer: LAYER[name], name, polys: by[name] })).sort((a, b) => a.layer - b.layer);
}
