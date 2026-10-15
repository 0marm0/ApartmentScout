// The measuring tape in Unit 3D's Inside camera. unit3d.js hands over a bridge of getters; nothing here reaches into its module
// state. The lines live in the apartment's own group (so they move with it when the window does), in the group's frame:
// metres, x = plan x - xc, z = -(plan y - yw), y up (unit/interior.js). Measurements are the plan's, shared with the Floor plan studio.
import * as THREE from 'three';
import { createMeasure3D } from './layer3d.js';
import { storeFor, expose } from './stores.js';
import { persistWith } from './studio-hook.js';
import { summarise, snapTargets } from './core.js';
import { genericPlan } from '../unit/interior.js';

const M = 0.0254;

/**
 * @param {object} b {stage() -> UnitStage, canvas, stageEl, toolbar, mode() -> 'orbit'|'win'|'in'|..., plan() -> normalised plan|null,
 *   items() -> resolved furniture, id() -> site id, metric() -> bool, store, base}
 */
export function mountUnitMeasure(b) {
  const persist = persistWith(b.store, b.base);
  let generic = null;
  const model = () => b.plan() || (generic ||= genericPlan());
  const frame = () => b.stage()?.interior?.frame;
  const current = () => (b.id() ? storeFor(`plan:${b.id()}`, persist) : null);
  const three = createMeasure3D({
    name: 'unit', canvas: b.canvas, stage: b.stageEl, toolbar: b.toolbar, iconButton: true, swallowClick: true,
    camera: () => b.stage()?.winCam || null, parent: () => b.stage()?.interior?.group || null,
    toLocal: (p) => { const f = frame(); return new THREE.Vector3((p[0] - f.xc) * M, (p[2] || 0) * M, -(p[1] - f.yw) * M); },
    fromLocal: (v) => { const f = frame(); return [v.x / M + f.xc, -v.z / M + f.yw, v.y / M]; },
    targets: () => { const g = b.stage()?.interior?.group; return g ? [g] : []; },
    model, items: () => b.items(), store: current,
    available: () => b.mode() === 'in' && !!b.stage()?.interior && b.stage().mode === 'in' && !!frame(),
    metric: () => b.metric(), redraw: () => { const s = b.stage(); if (s) s.dirty = true; },
  });
  // the camera row changes mode without telling us: watch the stage element's data-mode
  new MutationObserver(() => three.tick()).observe(b.stageEl, { attributes: true, attributeFilter: ['data-mode'] });
  expose({
    unit: three,
    get unitList() { return summarise(current()?.list || [], { metric: b.metric() }); },
    get unitStore() { return current(); },
    get unitTargets() { return snapTargets(model(), b.items() || []); },
  });
  return { three, changed: () => three.tick() };
}
