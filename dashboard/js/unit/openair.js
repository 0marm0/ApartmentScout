// Is the air just outside a window open? A height-aware test that a point is not inside the host building, a neighbour
// or one of their components. A window whose outside lies inside a solid is not a window (the facade was chosen
// through a setback, the plan was pushed through the wall, a party wall): sun and view conclusions for it are withheld.
// Pure; apartmentscout/geo/anchor.py (solid_at, window_open_air) is the Python twin and tests/fixtures/model_anchor.json
// pins both to the same answers. B is sun.js prepBuildings(); heights are metres above the target's ground (z up).
import { insideBuilding, solidsOf, DEG } from '../sun.js';

export const OUT_M = 0.4;
/** The solids of building b as [{part, lo, hi}], absolute z: its components, else the footprint prism (buried 1.5 m). */
const solids = (b) => (b.parts ? b.parts.map((q) => ({ part: q, lo: q.base, hi: q.top })) : [{ part: b, lo: b.g - 1.5, hi: b.top }]);

/** Index of the building whose solid contains (x, y, z), else null. `skip` leaves one building out. */
export function solidAt(B, x, y, z, skip = -1) {
  for (let i = 0; i < B.length; i++) {
    if (i === skip) continue;
    for (const s of solids(B[i])) if (z >= s.lo && z <= s.hi && insideBuilding(s.part, x, y)) return i;
  }
  return null;
}
/** {open, host, other}: whether a point outside a window is open air, inside the host (index ti) or inside another building. */
export function openAirAt(B, ti, x, y, z) {
  const hit = solidAt(B, x, y, z);
  return { open: hit == null, host: hit != null && hit === ti, other: hit != null && hit !== ti ? hit : null };
}
/**
 * Is the air outside a window at (fx, fy) (a point on the facade) open? It is tested `out` metres from the glass along
 * the bearing `az`, at zLo, the middle and zHi. Returns {ok, reason: null | 'host' | 'neighbour', building}.
 */
export function windowOpenAir(B, ti, fx, fy, az, zLo, zHi, out = [OUT_M, 1.0]) {
  const nx = Math.sin(az * DEG), ny = Math.cos(az * DEG);
  for (const z of [zLo, (zLo + zHi) / 2, zHi]) {
    for (const d of out) {
      const r = openAirAt(B, ti, fx + nx * d, fy + ny * d, z);
      if (!r.open) return { ok: false, reason: r.host ? 'host' : 'neighbour', building: r.host ? ti : r.other };
    }
  }
  return { ok: true, reason: null, building: null };
}
/** The point on a face at t along it (face from sun.js facesOf: {a, b}). */
export const facadePoint = (face, t) => [face.a[0] + (face.b[0] - face.a[0]) * t, face.a[1] + (face.b[1] - face.a[1]) * t];

/**
 * The observation point of a window on `face` at t along it: `out` metres outside the glass (along the facade's own
 * normal, as Unit 3D does) at eye level above slab height `slab`. Returns {x, y, z, fx, fy}.
 */
export function windowPoint(face, t, slab, out = OUT_M) {
  const [fx, fy] = facadePoint(face, t), nx = Math.sin(face.bearing * DEG), ny = Math.cos(face.bearing * DEG);
  return { x: fx + nx * out, y: fy + ny * out, z: slab + 1.6, fx, fy };
}

/** A sentence for a failed check, naming the building when the caller knows its name. */
export function airReason(res, nameOf = (i) => `building ${i}`) {
  if (!res || res.ok) return '';
  return res.reason === 'host'
    ? 'The air just outside this window is inside its own building: the facade or its outward direction is wrong here, or the window sits behind a setback.'
    : `The air just outside this window is inside ${nameOf(res.building)}: a party wall or a neighbour built against the facade at this height.`;
}
