// The relative-daylight heat map on the floor of the room, for both engines: the studio's Light tab tints its 3D floor with it, and Unit 3D's Inside
// camera can show the same map (computed from the same plan, the same per-window skylines of the shared city, the same glass and blinds the studio
// saved). A MODEL of relative daylight on an overcast sky (percent of an open sky), not lux. Frame of the meshes: metres from `origin` (plan inches).
import * as THREE from 'three';
import { SCALES, heatCanvas } from '../plan/heatmap.js';
import { daylightGrids, defaultInputs, cleanInputs, BLINDS_T } from '../plan/lighting-model.js';
import { placePlan, windowSkylines } from '../plan/city.js';
import { clampGlazing, blindsOf, GLAZING_DEFAULT } from '../plan/light.js';

const M = 0.0254;

/**
 * One tinted plane per room. `rooms` = [{room, poly (plan inches), x0In, y0In, stepIn, nx, ny, canvas}] (canvas from plan/heatmap.js heatCanvas).
 * @param {{origin?: number[], opacity?: number}} o
 */
export function heatMeshes(rooms, { origin = [0, 0], opacity = 0.82 } = {}) {
  const g = new THREE.Group(); g.name = 'floor-tint';
  for (const r of rooms || []) {
    if (!r.canvas) continue;
    const shape = new THREE.Shape(r.poly.map(([x, y]) => new THREE.Vector2((x - origin[0]) * M, (y - origin[1]) * M)));
    const geo = new THREE.ShapeGeometry(shape);
    const pos = geo.attributes.position, uv = geo.attributes.uv, x0 = (r.x0In - origin[0]) * M, y0 = (r.y0In - origin[1]) * M, w = r.nx * r.stepIn * M, h = r.ny * r.stepIn * M;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) - x0) / w, (pos.getY(i) - y0) / h);
    geo.rotateX(-Math.PI / 2);
    const tex = new THREE.CanvasTexture(r.canvas); tex.colorSpace = THREE.SRGBColorSpace; tex.minFilter = tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = false;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const mesh = new THREE.Mesh(geo, mat); mesh.position.y = 0.003; mesh.renderOrder = 1; mesh.name = `heat: ${r.room}`; g.add(mesh);
  }
  return g;
}

/** The glass and blinds the studio saved for a plan (its Light tab), or the defaults: {glazing, blinds, inputs}. */
export function savedLighting(store, base, id) {
  let raw = null; try { raw = store?.get(`plan-light.${base}.${id}`, null); } catch { raw = null; }
  const l = raw && typeof raw === 'object' ? raw : {};
  return { glazing: clampGlazing(l.glazing ?? GLAZING_DEFAULT), blinds: blindsOf(l.blinds), inputs: l.inputs ? cleanInputs(l.inputs) : defaultInputs() };
}

/**
 * The relative-daylight rooms of a plan placed on its site at the anchor `pin` ({face, t, az, cal}): [{room, poly, canvas, stats, ...grid}] and the
 * per-room means, or {rooms: [], reason} when the map cannot be made (no site model, orientation unknown, a window outside open air).
 */
export function daylightRooms(site, plan, floor, pin, light = {}) {
  let ctx = null;
  try { ctx = plan && site ? placePlan(site, plan, floor, { anchor: pin }) : null; } catch { ctx = null; }
  if (!ctx) return { rooms: [], reason: 'No city model for this plan, so its sky view is unknown.' };
  const sk = windowSkylines(ctx, plan);
  const inputs = light.inputs || defaultInputs();
  const data = daylightGrids(plan, sk, { vt: light.glazing ?? GLAZING_DEFAULT, inputs, blinds: BLINDS_T[light.blinds || 'open'] ?? 1, sky: null });
  const rooms = [];
  for (const r of data.rooms) {
    const mr = plan.rooms.find((q) => q.name === r.room); if (!mr || !r.stats) continue;
    rooms.push({ ...r, poly: mr.poly, canvas: heatCanvas(r, SCALES.daylight) });
  }
  return { rooms, skipped: data.skipped || [], reason: rooms.length ? '' : 'No room has a window with a known skyline.' };
}
