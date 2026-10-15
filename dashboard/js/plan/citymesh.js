// "City outside" for the Floor plan studio: the SAME city Unit 3D draws (city3d/city.js: every building of the site model meshed by
// city3d/buildings.js, the street plate, water, parks, grass and trees of unit/context3d.js), baked into the plan's own frame (metres,
// x = plan x, z = -plan y, y up from the apartment floor) so the buildings stand where the shared anchor puts them. Placement comes from
// plan/city.js (placePlan, the same function Unit 3D's anchor uses). Never casts shadows: the per-window skylines decide which windows
// the city shades. A visual preview: nothing here enters a number.
import * as THREE from 'three';
import { createCity, nightAmount } from '../city3d/city.js';
import { palette } from '../city3d/look.js';
import { prism } from '../city3d/buildings.js';
import { quality as Q } from '../room3d/quality.js';
import { phoneClass } from '../features/render-quality.js';

const M = 0.0254;
const legacyQuality = (m) => ({ visual: m === 'visual', phone: phoneClass() });   // a caller that names only 'fast' | 'visual'

/**
 * The matrix taking the context layer's site-frame three.js coordinates (x, up, -y in site metres) to the plan's
 * (x, up, -y in plan metres), from the plan's own site -> plan map (an affine map: a rotation about the anchor and a shift).
 */
export function siteToPlan(ctx) {
  const t = ctx.toPlanM([0, 0]), ex = ctx.toPlanM([1, 0]), ey = ctx.toPlanM([0, 1]);
  const a = ex[0] - t[0], c = ex[1] - t[1], b = ey[0] - t[0], d = ey[1] - t[1];
  return new THREE.Matrix4().set(a, 0, -b, t[0], 0, 1, 0, 0, -c, 0, d, -t[1], 0, 0, 0, 1);
}

/** The frame the shared city is baked into for a placed plan (`ctx` = plan/city.js placePlan): {place, matrix, y0}. */
export const planFrameOf = (ctx) => ({ place: (x, y) => ctx.toPlanM([x, y]), matrix: siteToPlan(ctx), y0: -ctx.slab });

/**
 * The shared city as a group in the plan's frame, plus this building below the apartment as a faint podium.
 * `opts.quality` ('fast' | 'visual', default the shared quality's city settings: room3d/quality.js). userData: context (the context layer's info), green (tree counts),
 * count (neighbours), api {setSun, setNight, setQuality, ids(): building ids with their first vertex, dispose}.
 */
export function cityGroup(ctx, opts = {}) {
  const pal = opts.pal || palette({ daylight: !!opts.daylight });   // [daylight] the eye-level views look out at a bright day
  const q = opts.quality ? legacyQuality(opts.quality) : Q.city;
  const frame = planFrameOf(ctx);
  const C = createCity({ B: ctx.B, T: ctx.T, ti: ctx.ti, meta: ctx.meta, green: ctx.green, water: ctx.water, streets: ctx.streets }, { pal, center: [(ctx.T.bb[0] + ctx.T.bb[2]) / 2, (ctx.T.bb[1] + ctx.T.bb[3]) / 2], frame, quality: q, castShadow: false });   // (the same centre as Unit 3D's: the same trees, the same near and far buildings));
  C.facU.uFloorH.value = Math.max(2.4, +ctx.fh || 3.2);
  C.facU.uToSite = { value: new THREE.Matrix4().copy(C.bakeM).invert() };   // the facade windows are laid out in the site frame, as in Unit 3D
  if (opts.trees !== false) C.buildContext(); else C.syncGroundBase();
  const g = C.group; g.name = 'city';
  // this building below the apartment (its own floors above are left out so the plan stays visible), in the city's own material
  if (ctx.slab > 1) {
    const geo = prism(ctx.T, Math.min(ctx.T.g, 0) - 1.5, ctx.slab - 0.35);
    geo.applyMatrix4(new THREE.Matrix4().makeTranslation(0, frame.y0, 0).multiply(frame.matrix));
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: pal.tBase, transparent: true, opacity: 0.35, roughness: 0.7, depthWrite: false })); m.name = 'this-building'; g.add(m);
  }
  if (C.ctx) { g.userData.green = C.ctx.info.trees; g.userData.context = C.ctx.info; }
  g.userData.count = C.near.length + C.far.length;
  g.userData.api = {
    city: C,
    setSun(dir, alt) { C.ctx?.setSun({ dir, alt }); C.facU.uNight.value = nightAmount(alt, pal); },
    setNight(v) { C.facU.uNight.value = v; },
    setQuality(qq) { C.quality = typeof qq === 'object' && qq ? qq : legacyQuality(qq); C.ctx?.setQuality(C.quality); C.facU.uQual.value = (C.quality.fullFacades ?? C.quality.visual) ? 1 : 0; },   // [massing] Visual: full facades
    /** building id -> its first vertex (world position in the plan frame), for alignment checks */
    anchorsOf(ids) {
      const out = {}; const v = new THREE.Vector3();
      for (const m of C.meshes) { const P = m.geometry.attributes.position; m.userData.ids.forEach((id, k) => { if (!ids || ids.includes(id)) { const i = m.userData.starts[k]; v.fromBufferAttribute(P, i); out[id] = [v.x, v.y, v.z]; } }); }
      return out;
    },
  };
  g.addEventListener('removed', () => C.dispose());   // the studio disposes meshes and materials only: free the textures and tree buffers
  void M;
  return g;
}
