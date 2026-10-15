// The renter's furniture inside Unit 3D's Inside view: the layout saved with a local plan scenario (Floor plan studio ▸
// Layout ▸ Use this plan in Unit 3D), drawn with the studio's own meshes (plan/scene3d.js buildItem) in the interior
// group's frame, so the pieces sit where the studio put them and move with the apartment when the window moves.
// Plan frame: inches, +x right, +y toward the facade. Group frame: metres, x = plan x, z = -plan y, origin at the
// centre of the facade windows (unit/interior.js toLocal).
import * as THREE from 'three';
import { buildItem } from '../plan/scene3d.js';
import { resolve } from '../plan/catalog.js';
import { toLocal } from './interior.js';
import '../plan/products.js';   // registers the real product sizes (a layout item may name one)

const DEG = Math.PI / 180;

/**
 * A group of furniture for `items` (layout items in plan inches) placed in the interior frame `fr` (planFrame(model)).
 * Items the catalogue does not know are skipped; the count of those is returned as `skipped`.
 * @returns {{group: THREE.Group, count: number, skipped: number, names: string[]}}
 */
export function buildFurniture(items, model, fr) {
  const group = new THREE.Group(); group.name = 'furniture';
  let count = 0, skipped = 0; const names = [];
  for (const raw of items || []) {
    const it = resolve(raw);
    if (!it || it.hidden) { skipped += it ? 0 : 1; continue; }
    const g = buildItem(it, { ceiling: model.ceiling });
    const [x, z] = toLocal(fr, [it.x, it.y]);
    g.position.set(x, 0, z); g.rotation.y = -it.rot * DEG;
    g.name = `${it.name} (${it.ref})`; g.userData = { itemId: it.id, ref: it.ref, furniture: true };
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    for (const n of ['decal', 'outline']) { const o = g.getObjectByName(n); if (o) o.visible = false; }   // fit-check overlays belong to the studio
    group.add(g); count++; names.push(it.name);
  }
  group.userData.interior = true;
  return { group, count, skipped, names };
}

/**
 * One more Inside viewpoint: standing at the window of the main room and looking back into the apartment, so the
 * renter sees their layout and the light falling across it. Appended after the plan's own windows, so saved
 * `inWin` indexes keep their meaning. Returns the extra entry (also pushed onto interior.windows) or null.
 */
export function addRoomView(interior) {
  const base = interior.windows.find((w) => w.facade && /living|bed/i.test(w.room)) || interior.windows.find((w) => w.facade);
  if (!base) return null;
  const v = { room: 'Back into the room', note: `from the ${base.room.toLowerCase()} window`, bearingOff: 180, local: base.local, eye: [base.local[0], base.local[1] + 0.8], facade: true, synthetic: true };
  interior.windows.push(v);
  return v;
}
