// The room's own evening light for a home with no lamp placed: a warm ceiling light in each of its main rooms, so an evening or night room glows (a pool of
// warm light on the floor, the cans' lenses lit) instead of being lit by the sky alone. One definition for both 3D engines (Unit 3D's Inside camera and the
// Floor plan studio). A renter's own lamps (furniture lamps, the Light tab's luminaires) replace it: the lights go out as soon as a real lamp is on.
//
// ASSUMED. The renter's lamps are not known here, so this is a stand-in: one warm 2700 K ceiling light per living room and bedroom, about 1,400 lm each. A VISUAL
// PREVIEW: brightness is a display gain, never lux; no daylight figure, sun hour or score uses it.
import * as THREE from 'three';
import { pointInPoly } from '../plan/model.js';

const M = 0.0254;
const WARM = 0xffb978;                              // 2700 K, a little amber so it reads as lamplight on white walls
const CD = (1400 / (4 * Math.PI)) * 0.14 * 1.15;   // lumens to candela, then the studio's display gain (as plan/scene3d.js lamps) and a little more: a ceiling light fills a room

/** Where the assumed lights go, in plan inches: [{x, y, room}], one per main room (two in a room over 220 square feet), the living rooms first, at most `limit`. Pure. */
export function lampSpots(model, limit = 4) {
  const kinds = ['living', 'bedroom', 'dining', 'office', 'kitchen'], out = [];
  const rooms = model.rooms.filter((r) => !['closet', 'outdoor', 'bath', 'hall'].includes(r.kind) && r.area >= 60 * 60)
    .sort((a, b) => (kinds.indexOf(a.kind) + 1 || 9) - (kinds.indexOf(b.kind) + 1 || 9) || b.area - a.area);
  for (const r of rooms) {
    const xs = r.poly.map((p) => p[0]), ys = r.poly.map((p) => p[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    let c = [(x0 + x1) / 2, (y0 + y1) / 2];
    if (!pointInPoly(c, r.poly)) c = r.label || c;
    const big = r.sqft > 220;
    const pts = big ? (x1 - x0 >= y1 - y0 ? [[x0 + (x1 - x0) * 0.3, c[1]], [x0 + (x1 - x0) * 0.7, c[1]]] : [[c[0], y0 + (y1 - y0) * 0.3], [c[0], y0 + (y1 - y0) * 0.7]]) : [c];
    for (const p of pts) if (out.length < limit) out.push({ x: p[0], y: p[1], room: r.name, kind: r.kind });
  }
  return out;
}

/**
 * The lights as a group in the frame given by `toLocal` (plan inches -> [x, z] metres in the group's parent): PointLights, no shadows, off until set.
 * `ceiling` is the ceiling height in inches; `limit` caps the count (Fast keeps a few: every light costs every lit surface).
 * @returns {{group: THREE.Group, count: number, set(level: number, opts?: {real?: boolean, lensRoot?: THREE.Object3D}): void, dispose(): void}}
 */
export function roomLamps(model, toLocal, { ceiling = model.ceiling, limit = 4 } = {}) {
  const group = new THREE.Group(); group.name = 'assumed room lights';
  const spots = lampSpots(model, limit), lights = [];
  for (const s of spots) {
    const [x, z] = toLocal([s.x, s.y]);
    const L = new THREE.PointLight(WARM, 0, 0, 2); L.position.set(x, (ceiling - 7) * M, z); L.castShadow = false; L.visible = false; L.userData.cd = CD; L.userData.room = s.room;
    group.add(L); lights.push(L);
  }
  group.userData.assumed = true;
  return {
    group, count: lights.length, spots,
    /** level 0..1 (the room light state's `lamps`); `real` = the renter has a lamp on, so the assumed lights stay off; lensRoot: the group that holds the 'ceiling-lenses' cans to light */
    set(level, { real = false, lensRoot = null } = {}) {
      const on = !real && level > 0;
      for (const L of lights) { L.intensity = on ? L.userData.cd * level : 0; L.visible = on; }
      const lens = lensRoot?.getObjectByName('ceiling-lenses');
      if (lens?.material) lens.material.emissiveIntensity = on ? 1.5 * Math.min(1, level) : 0;
    },
    dispose() { /* PointLights own no GPU resources */ },
  };
}
