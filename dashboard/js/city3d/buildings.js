// The city's buildings as three.js meshes, for every 3D view: Unit 3D, the Floor plan studio's "City outside" and anything
// that needs the skyline. One entry point, buildBuildings(site, opts), draws every building of a site file from the SAME
// prepared buildings and parts the sun and skyline maths read (see city3d/model.js), with
//   * facades drawn in the shader (no per-window meshes): a window grid per floor height, curtain-wall or punched style by
//     the building's class and era, spandrels and mullions, masonry or glass tint, sky reflection, lit windows at night,
//     and a darker foot of every wall as cheap ambient occlusion (city3d/facades.js);
//   * parapets, pitched, domed and sloped roofs, spires, and generic roof furniture (city3d/geometry.js);
//   * two levels of detail: buildings within `nearR` of the viewer's centre get the detail and cast shadows, the rest are plain
//     prisms with a flat tint, and the shader fades windows to their average as they shrink under a few pixels.
// Everything drawn is a look. Nothing here enters a sun hour, a skyline, a sky view or a score.
import * as THREE from 'three';
import { buildingEntries } from './model.js';
import { buildPack } from './geometry.js';
import { STYLE_PARAMS, TINTS, GLASS, VERT_PARS, VERT_MAIN, FRAG_PARS, FRAG_COLOR, FRAG_ROUGH, FRAG_EMISSIVE } from './facades.js';

/** The default height ramp (low to tall, dark theme or light) when the caller gives no colorFor. */
export function defaultColorFor({ light = false, low, high, roof } = {}) {
  const lo = new THREE.Color(low ?? (light ? 0x9aa3b4 : 0x3a404c)), hi = new THREE.Color(high ?? (light ? 0xd5dbe6 : 0x8f97a6)), rf = new THREE.Color(roof ?? (light ? 0xe6eaf1 : 0xb5bcc8));
  return (h, isRoof) => {
    const t = Math.max(0, Math.min(1, Math.log(Math.max(h, 6) / 6) / Math.log(260 / 6))), c = lo.clone().lerp(hi, Math.pow(t, 0.85));
    if (isRoof) c.lerp(rf, 0.5);
    return [c.r, c.g, c.b];
  };
}

/** The ear-clipping triangulator the geometry builder needs, from three's ShapeUtils. */
export function triangulate(outer, holes) {
  const v = (a) => a.map(([x, y]) => new THREE.Vector2(x, y));
  try { return THREE.ShapeUtils.triangulateShape(v(outer), holes.map(v)); } catch { return []; }
}

const sharedUniforms = () => ({
  uNight: { value: 0 }, uDetail: { value: 0 }, uTintMix: { value: 1 },
  uLitCol: { value: new THREE.Color(1, 0.8, 0.5) }, uSkyCol: { value: new THREE.Color(0.6, 0.72, 0.9) },
  uSty: { value: STYLE_PARAMS.map((s) => new THREE.Vector4(...s.win)) }, uSty2: { value: STYLE_PARAMS.map((s) => new THREE.Vector4(...s.opt)) },
  uTint: { value: TINTS.map((c) => new THREE.Vector3(...c)) }, uGlass: { value: GLASS.map((c) => new THREE.Vector3(...c)) },
});

/** Give a standard material the facade shader (windows, tints, night lights). `U` = shared uniforms, `lod` 0 detailed | 1 far. Returns the material. */
export function patchMaterial(m, U, lod, key) {
  const uni = { ...U, uLod: { value: lod } };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uni);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_PARS}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${VERT_MAIN}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_PARS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAG_COLOR}`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>\n${FRAG_ROUGH}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${FRAG_EMISSIVE}`);
  };
  m.customProgramCacheKey = () => key;
  m.userData.uniforms = uni;
  m.needsUpdate = true;
  return m;
}
const makeMaterial = (U, lod, key) => patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0 }), U, lod, key);

function meshOf(pack, material, name, cast) {
  const a = pack.arrays, g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(a.position, 3)); g.setAttribute('normal', new THREE.BufferAttribute(a.normal, 3));
  g.setAttribute('color', new THREE.BufferAttribute(a.color, 3)); g.setAttribute('aFa', new THREE.BufferAttribute(a.fa, 4)); g.setAttribute('aFb', new THREE.BufferAttribute(a.fb, 4));
  g.setIndex(new THREE.BufferAttribute(a.index, 1));
  g.computeBoundingSphere();
  const m = new THREE.Mesh(g, material); m.name = name; m.castShadow = cast; m.receiveShadow = true;
  // the contract Unit 3D's picking, recolouring and "what if this were taller" read: per-vertex heights, and where each building starts
  m.userData.starts = pack.starts; m.userData.ids = pack.ids; m.userData.h = a.h;
  return m;
}

/**
 * Draw the buildings of a site file.
 *
 * @param {object|null} site  the site file (v2: b, holes, components, bmeta, target). May be null when opts.B and opts.meta are given.
 * @param {object} [opts]
 * @param {object[]} [opts.B]            prepared buildings (sun.js prepBuildings) with the assumed parts already merged; default: built from `site`
 * @param {object[]} [opts.meta]         the site's bmeta (class, year, floors, id ...); default site.bmeta
 * @param {number[]} [opts.center]       [x, y] site metres the levels of detail and `radius` are measured from; default the target's centre
 * @param {number}   [opts.radius]       draw only buildings whose centre lies within this many metres of `center`; default all
 * @param {number}   [opts.nearR=450]    buildings within this distance of `center` get the detailed level
 * @param {Set<number>} [opts.skip]      building indices to leave out (the view draws its own building separately)
 * @param {Set<number>} [opts.only]      draw only these building indices
 * @param {boolean}  [opts.decor=true]   generic roof furniture (bulkheads, water tanks) on near flat roofs
 * @param {(h:number,isRoof:boolean)=>number[]} [opts.colorFor]  base colour by roof height; default the standard ramp
 * @param {boolean}  [opts.light]        light theme (for the default ramp)
 * @param {{visual?:boolean, phone?:boolean}} [opts.quality]  Fast (default) or Visual: Visual adds mullions, spandrels, glass reflection and grain
 * @param {boolean}  [opts.shadows=true] the near level casts shadows
 * @param {THREE.Matrix4} [opts.matrix]  an affine map applied to the whole group (the Floor plan studio's site -> plan frame)
 * @param {number}   [opts.night=0]      0..1, the lit windows
 * @param {THREE.Material} [opts.material] a standard material to give the detailed level (the view's own building: translucent, accent-tinted)
 * @param {number}   [opts.tintMix]      how far the style's wall palette replaces the base colour (default 1; 0 = base colour only)
 * @returns {THREE.Group} group 'buildings' with meshes 'buildings-near' and 'buildings-far'. group.userData:
 *   meshes (the two meshes), vrange (Map: building index -> [mesh, firstVertex, endVertex]), uniforms, info {buildings, parts, near, far,
 *   partBuildings, styles, decor, triangles, vertices, ids}, setNight(v), setQuality({visual}), setTintMix(v), recolor(colorFor), dispose().
 */
export function buildBuildings(site, opts = {}) {
  const { entries, info } = buildingEntries(site, opts);
  const colorFor = opts.colorFor || defaultColorFor({ light: !!opts.light });
  const U = sharedUniforms();
  U.uDetail.value = opts.quality?.visual ? 1 : 0; U.uNight.value = opts.night ?? 0; if (opts.tintMix != null) U.uTintMix.value = opts.tintMix;
  if (opts.litColor) U.uLitCol.value.set(opts.litColor);
  const near = entries.filter((e) => e.near), far = entries.filter((e) => !e.near);
  const group = new THREE.Group(); group.name = 'buildings';
  const meshes = [], vrange = new Map(), mats = [opts.material ? patchMaterial(opts.material, U, 0, 'city3d-' + (opts.key || 'own')) : makeMaterial(U, 0, 'city3d-near'), makeMaterial(U, 1, 'city3d-far')];
  let triangles = 0, vertices = 0;
  const parts = [[near, mats[0], 'buildings-near', opts.shadows !== false], [far, mats[1], 'buildings-far', false]];
  parts.forEach(([list, mat, name, cast]) => {
    const pack = buildPack(list, { triangulate, colorFor, parapets: true });
    const m = meshOf(pack, mat, name, cast); meshes.push(m); group.add(m);
    triangles += pack.triangles; vertices += pack.arrays.position.length / 3;
    pack.starts.forEach((s, k) => vrange.set(pack.ids[k], [m, s, k + 1 < pack.starts.length ? pack.starts[k + 1] : pack.arrays.position.length / 3]));
    if (!list.length) m.visible = false;
  });
  if (opts.matrix) { group.matrixAutoUpdate = false; group.matrix.copy(opts.matrix); group.matrixWorldNeedsUpdate = true; }
  const api = {
    meshes, vrange, uniforms: U, entries,
    info: { ...info, triangles, vertices, ids: entries.map((e) => e.id) },
    setNight(v) { U.uNight.value = Math.max(0, Math.min(1, v)); },
    setQuality(q) { U.uDetail.value = q?.visual ? 1 : 0; },
    setTintMix(v) { U.uTintMix.value = v; },
    setLight(c, sky) { if (c) U.uLitCol.value.copy(c); if (sky) U.uSkyCol.value.copy(sky); },
    recolor(fn) {
      for (const m of meshes) {
        const colA = m.geometry.attributes.color, nor = m.geometry.attributes.normal.array, H = m.userData.h;
        for (let v = 0; v < colA.count; v++) { const c = fn(H[v], nor[v * 3 + 1] > 0.9); colA.setXYZ(v, c[0], c[1], c[2]); }
        colA.needsUpdate = true;
      }
    },
    dispose() { for (const m of meshes) m.geometry.dispose(); for (const m of mats) m.dispose(); },
  };
  group.userData = api;
  return group;
}
