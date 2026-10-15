// The paint and finishes of the room, the same in both 3D engines and in both UI themes: bright white walls and ceiling, white trim and a light
// oak floor. (The Floor plan studio's light look is the baseline everywhere; the dark, murky room of the old Inside view is gone.)
// Hex values are the single source; colours() turns them into THREE.Color on demand. A VISUAL PREVIEW.
import * as THREE from 'three';

export const ROOM_HEX = {
  wall: 0xf7f4ef, ceiling: 0xffffff, trim: 0xfbf9f4, leaf: 0xf4f1ea,
  wood: 0xd8bc96, tile: 0xe2e3e0, carpet: 0xd9d5cc, fixture: 0xe4e1dc, slab: 0xe9e6e0,
};

/** The room's colours as THREE.Color: {wall, ceiling, trim, leaf, wood, tile, carpet, fixture, slab}. */
export function roomColors() {
  const out = {};
  for (const [k, v] of Object.entries(ROOM_HEX)) out[k] = new THREE.Color(v);
  return out;
}
