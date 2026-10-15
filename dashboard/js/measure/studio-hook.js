// The measuring tape in the Floor plan studio, 2D and 3D: plan3d.js hands over a bridge (getters for its model and pieces) and
// nothing here reaches into its module state. The 3D pane measures in the scene's own frame (metres, x = plan x, z = -plan y);
// the 2D pane measures on the drawing. Both read and write one list per plan (measure/stores.js).
import * as THREE from 'three';
import { createMeasure3D } from './layer3d.js';
import { createMeasure2D } from './layer2d.js';
import { storeFor, expose } from './stores.js';
import { summarise, snapTargets } from './core.js';

const M = 0.0254;

/** Remember a plan's measurements in this browser (best effort). */
export const persistWith = (store, base) => ({
  load: (key) => store.get(`measure.${base}.${key}`, null),
  save: (key, list) => store.set(`measure.${base}.${key}`, list),
});

/**
 * @param {object} b the bridge from plan3d.js:
 *   G3 (plan/scene3d.js), canvas, stage3d, stage2d, svg, toolbar3d, toolbar2d, toPlan(clientX, clientY),
 *   id() -> current plan id, model() -> normalised plan, items() -> resolved furniture, show3d() / show2d() -> is that pane on screen,
 *   metric() -> bool, store (the app's browser store) and base (the search's id)
 */
export function mountStudioMeasure(b) {
  const persist = persistWith(b.store, b.base);
  const current = () => (b.id() ? storeFor(`plan:${b.id()}`, persist) : null);
  const three = createMeasure3D({
    name: 'studio', canvas: b.canvas, stage: b.stage3d, toolbar: b.toolbar3d, iconButton: true,   // the 3D camera row is already full: an icon, with the label as its tooltip
    camera: () => b.G3.getCamera(), parent: () => b.G3.parts().scene,
    toLocal: (p) => new THREE.Vector3(p[0] * M, (p[2] || 0) * M, -p[1] * M),
    fromLocal: (v) => [v.x / M, -v.z / M, v.y / M],
    targets: () => { const q = b.G3.parts(); return [q.shell, q.furn]; },
    model: () => b.model(), items: () => b.items(), store: current,
    available: () => !!b.model() && b.show3d(), metric: () => b.metric(), redraw: () => b.G3.markDirty(),
  });
  const two = createMeasure2D({
    name: 'studio', svg: b.svg, wrap: b.stage2d, toolbar: b.toolbar2d, toPlan: b.toPlan,
    model: () => b.model(), items: () => b.items(), store: current, metric: () => b.metric(),
    available: () => !!b.model() && b.show2d(),
  });
  // a test and debugging handle, like __plan3d: never used by the page itself
  expose({
    studio3d: three, studio2d: two,
    get studioList() { return summarise(current()?.list || [], { metric: b.metric() }); },
    get studioStore() { return current(); },
    get studioTargets() { return b.model() ? snapTargets(b.model(), b.items() || []) : null; },
  });
  return {
    /** The plan or its pieces changed: labels and snaps follow. */
    changed() { three.tick(); two.redraw(); },
    redraw2D: () => two.redraw(),
    active: () => three.active || two.active,
    get three() { return three; }, get two() { return two; },
  };
}
