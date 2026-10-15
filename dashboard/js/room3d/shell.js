// The shell of a room, one builder for both 3D engines: floors by room type (parquet, oak, tile), walls with the plan's thickness, per-room ceilings,
// doors with their leaves and swings, the fixtures (kitchen counters, the AC and radiators under the bay) and the architecture of plan/interior3d.js and
// room3d/windows.js (baseboards, casings, framed glass), plus invisible shadow casters for the walls and the ceiling. The Floor plan studio builds its room
// with plan/scene3d.js buildShellInto; Unit 3D's Inside camera calls THIS, which calls the same function, so the two rooms are the same room.
// Frame of the result: metres, x = (plan x - ox) * M, z = -(plan y - oy) * M, y up from the floor, for `origin` [ox, oy] in plan inches.
import * as THREE from 'three';
import { buildShellInto, themeColors } from '../plan/scene3d.js';
import { applySurfaceTint } from '../plan/surfaces3d.js';

const M = 0.0254;

/**
 * @param {object} model  normalised plan (plan/model.js)
 * @param {{origin?: number[], castShadows?: boolean, colors?: object}} o  `castShadows`: add the invisible casters for walls and ceiling (Unit 3D: the city's shadows fall on the floor)
 * @returns {{group: THREE.Group, blockers: THREE.Object3D[], height: number}}
 *   `blockers` = the meshes a line of sight cannot pass (walls, floors, ceilings, not glass): what a label test raycasts against
 */
export function roomShell(model, o = {}) {
  const [ox, oy] = o.origin || [0, 0], C = o.colors || applySurfaceTint(themeColors());
  const T = { shell: new THREE.Group(), proxies: o.castShadows ? new THREE.Group() : null, labels: new THREE.Group() };
  buildShellInto(T, model, C, 'full', { ground: false, grid: false, labels: false, sheen: true });
  const group = new THREE.Group(); group.name = 'room shell';
  T.shell.name = 'shell'; group.add(T.shell);
  if (T.proxies) { T.proxies.name = 'shadow casters'; group.add(T.proxies); }
  group.position.set(-ox * M, 0, oy * M);   // plan frame (x, -y) -> the origin's frame
  const blockers = [];
  group.traverse((m) => {
    if (!m.isMesh) return;
    if (m.name === 'wall' || m.name.startsWith('ceiling') || m.name.startsWith('floor')) { m.userData.blocks = true; blockers.push(m); }
  });
  if (T.proxies) group.traverse((m) => { if (m.isMesh && m.parent === T.proxies) { m.userData.blocks = true; blockers.push(m); } });
  return { group, blockers, height: model.ceiling * M };
}
