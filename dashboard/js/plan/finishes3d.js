// The finishes of a plan (plan/finishes.js) as three.js colours and meshes, shared by both 3D engines through plan/scene3d.js buildShellInto: wall and
// ceiling paint, door leaves, kitchen cabinets with their stone tops and a backsplash, bath vanities. Floors are chosen in plan/interior3d.js
// (floorKind, floorTone) and window frames in room3d/windows.js, from the same `model.finishes`. Nothing here changes a number; a VISUAL PREVIEW.
import * as THREE from 'three';
import { resolveFinishes } from './finishes.js';
import { segDist } from './model.js';
import { ROOM_HEX } from '../room3d/palette.js';

const M = 0.0254;

/**
 * `C` (the studio's colour set) with the plan's wall and ceiling paint, and `C.fin` = the resolved finishes (hex numbers or null).
 * The Light tab's reflectance tint is kept: it scales the built-in colours, and the same ratio is applied to the plan's.
 * Returns `C` itself when the plan states no finishes.
 */
export function applyFinishes(C, m) {
  const fin = resolveFinishes(m?.finishes);
  if (!fin) return C;
  const ratio = (cur, ref) => (cur && cur.g > 0 ? cur.g / new THREE.Color(ref).g : 1);
  const kw = ratio(C.wall, ROOM_HEX.wall), kc = C.ceiling ? ratio(C.ceiling, ROOM_HEX.ceiling) : kw;
  const paint = (hex, k) => { const c = new THREE.Color(hex); if (Math.abs(k - 1) > 1e-6) { c.multiplyScalar(k); c.r = Math.min(1, c.r); c.g = Math.min(1, c.g); c.b = Math.min(1, c.b); } return c; };
  return { ...C, fin, wall: fin.walls != null ? paint(fin.walls, kw) : C.wall, ceiling: fin.ceiling != null ? paint(fin.ceiling, kc) : C.ceiling };
}

/** The colour of a door leaf: the plan's, else `fallback`. */
export const doorColour = (C, fallback) => (C.fin?.doors != null ? new THREE.Color(C.fin.doors) : fallback);

/**
 * What colours a fixture takes from the finishes: `{body, top}` (THREE.Color or null). Counters and islands are a cabinet body with a stone top;
 * a vanity takes the bath's vanity colour. null when the plan says nothing about it.
 */
export function fixtureFinish(f, C) {
  const fin = C.fin; if (!fin) return null;
  if (f.kind === 'counter' || f.kind === 'island') return fin.cabinets != null || fin.counters != null ? { body: fin.cabinets != null ? new THREE.Color(fin.cabinets) : null, top: fin.counters != null ? new THREE.Color(fin.counters) : null } : null;
  if (f.kind === 'vanity') return fin.vanity != null ? { body: new THREE.Color(fin.vanity), top: null } : null;
  return null;
}

/** The thickness of the stone top of a counter, inches. */
export const TOP_T = 1.5;
const BACKSPLASH_H = 18;

/**
 * A thin backsplash on the wall behind each counter run, from the top of the counter up 18 in (full-height tile to the upper cabinets' line).
 * `W` = (x, y, z) in plan inches -> THREE.Vector3 (the engine's own mapping). Returns the meshes (empty when the plan names no backsplash).
 */
export function backsplashMeshes(m, C, W, cut = null) {
  const out = [], col = C.fin?.backsplash;
  if (col == null) return out;
  const mat = new THREE.MeshStandardMaterial({ color: col, roughness: 0.3, metalness: 0.05 });
  const low = m.pieces.filter((q) => q.z0 < 1);
  for (const f of m.fixtures) {
    if (f.kind !== 'counter' || f.height > 40) continue;
    const top = f.elev + f.height, z1 = cut == null ? top + BACKSPLASH_H : Math.min(top + BACKSPLASH_H, cut);
    if (z1 - top < 1) continue;
    const poly = f.poly, cen = f.center;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length], dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy); if (len < 10) continue;
      const ux = dx / len, uy = dy / len, mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const wall = low.find((q) => { const wx = q.b[0] - q.a[0], wy = q.b[1] - q.a[1], wl = Math.hypot(wx, wy) || 1; return Math.abs((wx * ux + wy * uy) / wl) > 0.97 && segDist(mid, q.a, q.b) - q.t / 2 < 2.5; });
      if (!wall) continue;
      let nx = -uy, ny = ux; if ((cen[0] - mid[0]) * nx + (cen[1] - mid[1]) * ny < 0) { nx = -nx; ny = -ny; }   // towards the cabinet: the wall face is the edge itself
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(len * M, (z1 - top) * M, 0.8 * M), mat);
      mesh.position.copy(W(mid[0] + nx * 0.4, mid[1] + ny * 0.4, (top + z1) / 2)); mesh.rotation.y = Math.atan2(dy, dx); mesh.name = 'backsplash'; mesh.receiveShadow = true;
      out.push(mesh);
    }
  }
  return out;
}
