// THE city of the 3D views: the full site model (every building, meshed by city3d/buildings.js), roof and footprint outlines, the street /
// sidewalk plate, water, parks, grass and trees (unit/context3d.js buildContext, with the street and park tree layers) and the ground,
// assembled once and used by BOTH engines: Unit 3D (unit/scene.js: orbit, window and Inside cameras) and the Floor plan studio (plan/citymesh.js:
// its eye-level views and "City outside"). The same site file therefore gives the same buildings (same ids, same places), the same materials,
// the same colours and the same context in both; only the frame differs. Frame: site metres in three.js axes (x east, y up, -z north), or any
// affine frame given by `frame` (the studio's plan frame). A VISUAL PREVIEW: nothing here enters a sun hour, a skyline or a score.
import * as THREE from 'three';
import { buildContext } from '../unit/context3d.js';
import { loadTreeLayers } from '../unit/treelayers.js';
import { decorate } from './facade.js';
import { mergeBuildings, edgeGeo, outlineGeo } from './buildings.js';

export const CITY_RADIUS_M = 640;     // trees, parks and grass are drawn within this many metres of the building
export const NEAR_M = 900;            // buildings closer than this cast shadows (Unit 3D); farther ones are a second, cheaper mesh

/** The shared facade-shader uniforms: uNight 0..1 (lit windows after dusk), uFloorH, uDetail, uLitCol. */
export const facadeUniforms = (pal) => ({ uNight: { value: 0 }, uFloorH: { value: 3.2 }, uDetail: { value: 1 }, uLitCol: { value: (pal?.lit || new THREE.Color(1, 0.8, 0.5)).clone() } });

/** Lit windows fade in through dusk: 0 by day, 1 when the sun is 6 degrees under the horizon. */
export const nightAmount = (alt, pal) => Math.max(0, Math.min(1, (3 - alt) / 9)) * (pal?.light ? 0.75 : 1);

/**
 * The context layer (plate, water, parks, grass, trees) with the options both engines use.
 * @param {{green, water, streets, B}} data  site file blocks and prepared buildings
 * @param {{pal: object, center: number[], frame?: {place, matrix, y0}, quality?: {visual, phone}, layers?: object, radius?: number}} o
 */
export function buildCityContext(data, o) {
  const any = data.green || data.water || (data.streets || []).length;
  if (!any) return null;
  const f = o.frame || {}, q = o.quality || {}, pal = o.pal;
  return buildContext({ green: data.green, water: data.water, streets: data.streets }, {
    B: data.B, place: f.place, matrix: f.matrix, center: o.center, radius: o.radius ?? CITY_RADIUS_M, y0: f.y0 ?? 0,
    ground: pal.ground, light: pal.light, blue: pal.blue, visual: !!q.visual, phone: !!q.phone,
    layers: { green: true, water: true, ...loadTreeLayers(), ...(o.layers || {}) },
  });
}

/**
 * Build the city.
 * @param {{B: object[], T: object, ti: number, green?, water?, streets?}} data  prepared buildings (sun.js prepBuildings), the target and its index
 * @param {{pal: object, center: number[], frame?: {place, matrix, y0}, quality?, layers?, castShadow?: boolean, facU?: object, skip?: number[]}} o
 *   `center` = [x, y] site metres of the target; `frame` = null for the site frame, or {place(x, y) -> [px, py], matrix (Matrix4: site three coords -> view), y0}
 * @returns {{group, bMat, facU, meshes: THREE.Mesh[], near: number[], far: number[], vrange: Map, edges, outlines, edgeIdx, ctx, groundBase, groundMat, syncGroundBase(), setPalette(pal), dispose()}}
 */
export function createCity(data, o) {
  const { B, T } = data, pal = o.pal, [cx, cy] = o.center, matrix = o.frame?.matrix || null, y0 = o.frame?.y0 ?? 0;
  // the buildings are baked into the view's frame: the frame's xz map plus the ground height y0 (the context layer takes them separately)
  const bakeM = matrix ? new THREE.Matrix4().makeTranslation(0, y0, 0).multiply(matrix) : y0 ? new THREE.Matrix4().makeTranslation(0, y0, 0) : null;
  const group = new THREE.Group(); group.name = 'city';
  const distTo = (b) => Math.hypot((b.bb[0] + b.bb[2]) / 2 - cx, (b.bb[1] + b.bb[3]) / 2 - cy);
  const skip = new Set(o.skip || []);
  const near = [], far = [];
  B.forEach((b, i) => { if (b === T || skip.has(i)) return; (distTo(b) < NEAR_M ? near : far).push(i); });

  // ground first: the base under everything (the plate sits on it; the water shows it)
  const groundMat = new THREE.MeshStandardMaterial({ color: pal.ground, roughness: 1, metalness: 0 });
  const groundBase = new THREE.Mesh(new THREE.PlaneGeometry(24000, 24000), groundMat);
  groundBase.name = 'ground-base'; groundBase.rotation.x = -Math.PI / 2; groundBase.receiveShadow = true;
  // drawn first and never into the depth buffer: a kilometre out the 24-bit depth cannot tell it from the water plane 0.4 m above (the far river flickered grey)
  groundBase.renderOrder = -3; groundMat.depthWrite = false;
  const place = (x, y) => (o.frame?.place ? o.frame.place(x, y) : [x, y]);
  const [gx, gy] = place(cx, cy);
  groundBase.position.set(gx, y0 - 0.02, -gy); group.add(groundBase);

  // buildings: one material (vertex colours by height, the facade shader), merged near / far
  const facU = o.facU || facadeUniforms(pal);
  const bMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
  facU.uLitCol.value.copy(pal.lit);
  decorate(bMat, facU, 'unit-city');
  const vrange = new Map(), meshes = [];
  for (const [idx, cast, name] of [[near, !!o.castShadow, 'neighbours'], [far, false, 'neighbours-far']]) {
    const { geometry, starts, ids, H, ranges } = mergeBuildings(B, idx, { pal, matrix: bakeM });
    const m = new THREE.Mesh(geometry, bMat); m.castShadow = cast; m.receiveShadow = true; m.name = name;
    m.userData.starts = starts; m.userData.ids = ids; m.userData.h = H;
    for (const [i, a, b] of ranges) vrange.set(i, [m, a, b]);
    meshes.push(m); group.add(m);
  }
  const edgeMat = new THREE.LineBasicMaterial({ color: pal.edge, transparent: true, opacity: pal.edgeOp, depthWrite: false });
  const edgeIdx = near.filter((i) => distTo(B[i]) < 760);
  const edges = new THREE.LineSegments(edgeGeo(B, edgeIdx, false, bakeM), edgeMat); edges.name = 'city-edges'; group.add(edges);
  const outlineMat = new THREE.LineBasicMaterial({ color: pal.outline, transparent: true, opacity: pal.outlineOp, depthWrite: false });
  const outlines = new THREE.LineSegments(outlineGeo(B, near.filter((i) => distTo(B[i]) < 820), 0.25, bakeM), outlineMat); outlines.name = 'city-outlines'; group.add(outlines);

  const c = {
    group, bMat, facU, meshes, near, far, vrange, bakeM, edges, outlines, edgeMat, outlineMat, edgeIdx, groundBase, groundMat, ctx: null,
    /** Build (or rebuild, after a theme or quality change) the context layer and add it to the group. */
    buildContext(extra = {}) {
      if (c.ctx) { group.remove(c.ctx.group); c.ctx.dispose(); c.ctx = null; }
      if (extra.pal) c.pal = extra.pal;
      if (extra.quality) c.quality = extra.quality;
      if (extra.layers) c.layers = { ...c.layers, ...extra.layers };
      c.ctx = buildCityContext(data, { pal: c.pal, center: o.center, frame: o.frame, quality: c.quality, layers: c.layers, ...extra });
      if (c.ctx) { group.add(c.ctx.group); c.ctx.watch(group); }   // (the tree LOD follows the camera once the city's own group is in a scene)
      c.syncGroundBase();
      return c.ctx;
    },
    /** The plate stands in for the base ground where it is on; the base drops under the water so the plate's holes show it. */
    syncGroundBase() { groundBase.position.y = y0 + (c.ctx?.hasGround && c.layers.water !== false ? -0.9 : -0.02); },
    pal, quality: o.quality || { visual: false, phone: false }, layers: o.layers || {},
    setPalette(p) {
      c.pal = p; groundMat.color.copy(p.ground); edgeMat.color.copy(p.edge); edgeMat.opacity = p.edgeOp; outlineMat.color.copy(p.outline); outlineMat.opacity = p.outlineOp; facU.uLitCol.value.copy(p.lit);
    },
    dispose() { group.traverse((m) => { m.geometry?.dispose?.(); }); bMat.dispose(); groundMat.dispose(); edgeMat.dispose(); outlineMat.dispose(); c.ctx?.dispose(); c.ctx = null; },
  };
  return c;
}
