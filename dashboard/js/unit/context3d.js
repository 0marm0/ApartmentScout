// CITY CONTEXT for the 3D views: everything around the buildings that is not a building. One layer, shared by
// Unit 3D (unit/scene.js) and the Floor plan studio's "City outside" (plan/citymesh.js), built from the site file:
//
//   ground  a street / sidewalk / block plate (streets from `site.streets`, widths from the data), painted into one
//           texture, with holes where the water is (`unit/groundtex.js`);
//   water   a blue plane 0.4 m under the plate, masked by the water polygons (`site.water`): flat colour in Fast,
//           a soft sky reflection and a sun glint in Visual;
//   green   park, lawn and wood patches (`site.green.polys`);
//   trees   street trees from the NYC Street Tree Census sized from trunk diameter, OpenStreetMap trees, and
//           Poisson-disc fill in parks, in two instanced levels of detail (`unit/trees.js`, `unit/treemesh.js`).
//
// Context only. Nothing here enters a sun hour, a skyline, a daylight number or a score: trees and water are never
// obstructions (canopies are seasonal and porous; the numbers use buildings alone), and the tree shadows of Visual
// quality are a picture, not a measurement.
//
// API
//   const ctx = buildContext(site, {
//     B,                    // prepared buildings (sun.js prepBuildings): keeps trees out of footprints
//     place,                // (x, y) -> [px, py], site metres to the view's ground plane (default identity)
//     matrix,               // THREE.Matrix4 taking site-frame three coords (x, h, -y) to the view's (default identity)
//     center, radius,       // [x, y] and metres of the site frame to draw trees and parks within (default [0, 0], 640)
//     y0,                   // ground height (default 0)
//     ground, light, blue,  // THREE.Color of the plain ground, the theme flag and the theme's blue
//     visual, phone,        // render quality: tree shadows and the water glint; the phone-class LOD budget
//     layers,               // {ground, water, green, trees} booleans, default all true
//   });
//   ctx.group               THREE.Group to add to the scene (children named 'ground-plate', 'water', 'green', 'trees')
//   ctx.watch(obj)          make the tree LOD follow the camera while `obj` (or an ancestor) is in a scene
//   ctx.update(camera)      re-sort the tree LOD for this camera (called for you once watched)
//   ctx.setLayers({...})    show / hide layers; ctx.hasGround says whether the plate replaces the base ground
//   ctx.setQuality({visual, phone}), ctx.setTheme({ground, light, blue}), ctx.setSun({dir, alt})
//   ctx.setInside(bool)     true while the camera is inside the apartment: crowns stop casting shadows, so the sun patches on the floor match the
//                           numbers (trees are never obstructions)
//   ctx.labels              [{kind: 'water' | 'park', name, x, y}] in site metres (large parks and the rivers)
//   ctx.info                {trees: {census, mapped, fill, total, dropped}, waterBodies, streets, textures, ...}
//   ctx.dispose()
import * as THREE from 'three';
import { greenGroup, greenColors } from './greenmesh.js';
import { treePlan } from './trees.js';
import { treeLayer } from './treemesh.js';
import { decodeWater, windowHalf, contextLabels, streetStrokes } from './context-core.js';
import { paintPlate, paintMask, TEX_SIZE } from './groundtex.js';

export const PLATE_HALF_M = 800;     // half the side of the street plate (streets are surveyed to ~600 m); the water mask reaches further
export const WATER_BELOW_M = 0.4;   // the water plane sits this far under the street plate
export const TREE_CAP = { desktop: 9000, phone: 4500 };

/** Plate, water and tree colours for a theme, from the plain ground colour. */
export function contextColors(ground, light, blue = new THREE.Color(0x3a93e0)) {
  const W = new THREE.Color(1, 1, 1), K = new THREE.Color(0, 0, 0), mix = (a, b, t) => a.clone().lerp(b, t);
  return light
    ? { block: ground.clone(), walk: mix(ground, W, 0.55), road: mix(ground, K, 0.14), quay: mix(ground, W, 0.85), water: mix(blue, K, 0.24), deep: mix(blue, K, 0.4), sky: mix(blue, W, 0.55) }
    : { block: ground.clone(), walk: mix(ground, W, 0.09), road: mix(ground, K, 0.32), quay: mix(ground, W, 0.24), water: mix(blue, ground, 0.42), deep: mix(blue, K, 0.5), sky: mix(blue, ground, 0.15) };
}
const css = (c) => '#' + c.getHexString();

const WATER_VS = `uniform float uHalf; varying vec3 vW; varying vec2 vUv;
#include <fog_pars_vertex>
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz;
  vUv = vec2((position.x + uHalf) / (2.0 * uHalf), (-position.z + uHalf) / (2.0 * uHalf));
  vec4 mvPosition = viewMatrix * wp; gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const WATER_FS = `uniform sampler2D uMask; uniform vec3 uShallow; uniform vec3 uSky; uniform vec3 uSunDir; uniform vec3 uSunCol;
uniform float uLight; uniform float uGlint; uniform float uSunUp;
varying vec3 vW; varying vec2 vUv;
#include <fog_pars_fragment>
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y); }
void main() {
  if (texture2D(uMask, vUv).r < 0.5) discard;
  vec3 col = uShallow;
  if (uGlint > 0.5) {
    vec3 V = cameraPosition - vW; float dist = length(V); V /= dist;
    float calm = 1.0 / (1.0 + dist / 220.0);                      // ripples fade with distance (no shimmer)
    vec2 p = vW.xz;
    vec2 g = vec2(vn(p * 0.45) - 0.5 + 0.5 * (vn(p * 1.7 + 7.3) - 0.5), vn(p * 0.45 + 19.0) - 0.5 + 0.5 * (vn(p * 1.7 + 31.0) - 0.5)) * 0.2 * calm;
    g += (vec2(vn(p * 5.0 + 3.1), vn(p * 5.0 + 11.7)) - 0.5) * 0.07 * calm;
    vec3 N = normalize(vec3(g.x, 1.0, g.y));
    float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
    col = mix(uShallow, uSky, clamp(fres * 0.6, 0.0, 0.7));        // the sky shows at grazing angles
    vec3 R = reflect(-V, N), S = normalize(uSunDir);
    float sd = max(dot(R, S), 0.0);
    col += uSunCol * (pow(sd, 160.0) * 1.3 + pow(sd, 18.0) * 0.1) * uSunUp;
  }
  gl_FragColor = vec4(col * uLight, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

function canvasTexture(N, paint) {
  const c = document.createElement('canvas'); c.width = c.height = N;
  paint(c.getContext('2d'));
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

export function buildContext(site, opts = {}) {
  const { B = null, place = (x, y) => [x, y], matrix = null, center = [0, 0], radius = 640, y0 = 0 } = opts;
  let inside = false, light = !!opts.light, visual = !!opts.visual, phone = !!opts.phone, ground = (opts.ground || new THREE.Color(0x272c37)).clone(), blue = (opts.blue || new THREE.Color(0x3a93e0)).clone();
  const vis = { ground: true, water: true, green: true, trees: true, ...(opts.layers || {}) };
  const group = new THREE.Group(); group.name = 'context';
  const water = decodeWater(site?.water), half = PLATE_HALF_M, waterHalf = windowHalf(site, 1600), N = opts.phone ? 1536 : TEX_SIZE,   // a phone's textures are a little coarser (14 MB of GPU memory instead of 32)
     hasStreets = streetStrokes(site?.streets).length > 0;
  const surveyed = Math.min(half, +site?.green?.radius_m || 600);
  const wrap = new THREE.Group(); wrap.name = 'context-ground'; if (matrix) { wrap.matrix.copy(matrix); wrap.matrixAutoUpdate = false; }
  group.add(wrap);
  const parts = { plate: null, water: null, green: null, trees: null }, own = { tex: [], mats: [], geos: [] };
  let colors = contextColors(ground, light, blue), plateTex = null, maskTex = null, waterMat = null;

  // ---- ground plate + water
  const hasGround = !!(water || hasStreets);
  if (hasGround) {
    const plateMat = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, alphaTest: 0.5 });
    const geo = new THREE.PlaneGeometry(2 * half, 2 * half).rotateX(-Math.PI / 2);
    const plate = new THREE.Mesh(geo, plateMat); plate.name = 'ground-plate'; plate.position.y = y0 - 0.02; plate.receiveShadow = true;
    parts.plate = plate; wrap.add(plate); own.geos.push(geo); own.mats.push(plateMat);
    freeWith(plateMat, () => [plateTex]);
    paintAll();
    if (water) {
      waterMat = new THREE.ShaderMaterial({
        vertexShader: WATER_VS, fragmentShader: WATER_FS, fog: true, side: THREE.DoubleSide,
        uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uMask: { value: null }, uHalf: { value: waterHalf }, uShallow: { value: new THREE.Color() }, uSky: { value: new THREE.Color() }, uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color(1, 1, 1) }, uLight: { value: 1 }, uGlint: { value: 0 }, uSunUp: { value: 0 } }]),
      });
      waterMat.uniforms.uMask.value = maskTex;   // (merge() clones textures, so it is set here, on the live object)
      freeWith(waterMat, () => [maskTex]);
      const wgeo = new THREE.PlaneGeometry(24000, 24000).rotateX(-Math.PI / 2);
      const wm = new THREE.Mesh(wgeo, waterMat); wm.name = 'water'; wm.position.y = y0 - 0.02 - WATER_BELOW_M; wm.frustumCulled = false; wm.renderOrder = -1;
      parts.water = wm; wrap.add(wm); own.geos.push(wgeo); own.mats.push(waterMat);
      applyWaterColors();
    }
  }
  function paintAll() {
    colors = contextColors(ground, light, blue);
    const cs = { block: css(colors.block), walk: css(colors.walk), road: css(colors.road), quay: css(colors.quay) };
    const draw = (g) => paintPlate(g, { N, half, colors: cs, streets: site?.streets || [], water, radius: surveyed });
    if (!plateTex) { plateTex = canvasTexture(N, draw); own.tex.push(plateTex); parts.plate.material.map = plateTex; parts.plate.material.needsUpdate = true; }
    else { draw(plateTex.image.getContext('2d')); plateTex.needsUpdate = true; }
    if (water && !maskTex) { maskTex = canvasTexture(N, (g) => paintMask(g, { N, half: waterHalf, water })); maskTex.generateMipmaps = false; maskTex.minFilter = THREE.LinearFilter; own.tex.push(maskTex); }
  }
  function applyWaterColors() {
    if (!waterMat) return;
    waterMat.uniforms.uShallow.value.copy(colors.water); waterMat.uniforms.uSky.value.copy(colors.sky);
    waterMat.uniforms.uGlint.value = visual ? 1 : 0;
  }

  // ---- green patches and trees
  let plan = null, trees = null, patchGroup = null;
  function buildGreen() {
    if (patchGroup) { wrapOut.remove(patchGroup); disposeObj(patchGroup); patchGroup = null; }
    if (!site?.green) return;
    patchGroup = greenGroup(site.green, { place, center, radius, y0, colors: greenColors(ground, light), trees: false });
    patchGroup.visible = vis.green; parts.green = patchGroup; wrapOut.add(patchGroup);
  }
  const wrapOut = new THREE.Group(); wrapOut.name = 'context-green'; group.add(wrapOut);
  function buildTrees() {
    if (trees) { wrapOut.remove(trees.group); trees.dispose(); trees = null; }
    if (!site?.green) return;
    if (!plan) plan = treePlan(site.green, { center, radius, cap: TREE_CAP.desktop, B });
    if (!plan.n) return;
    trees = treeLayer(plan, { place, y0, light, phone, shadows: visual && !inside, limit: phone ? TREE_CAP.phone : TREE_CAP.desktop });
    trees.group.visible = vis.green && vis.trees; parts.trees = trees.group; wrapOut.add(trees.group);
  }
  buildGreen(); buildTrees();

  // ---- labels, info
  const labels = contextLabels(site);
  const info = { trees: plan ? plan.counts : { census: 0, mapped: 0, fill: 0, total: 0, dropped: 0 }, canopy: plan?.census || null, waterBodies: water ? water.polys.length : 0, streets: hasStreets, patches: site?.green?.polys?.length || 0, texture: N, half, waterHalf };

  // ---- camera-driven LOD
  const api = {
    group, parts, labels, info, hasGround,
    update(camera, force = false) { if (!disposed) trees?.update(camera, force); },
    /** Follow the camera while `obj` (or an ancestor) is in a scene: the scene's onBeforeRender re-sorts the tree LOD. */
    watch(obj) {
      const hook = () => { let o = obj; while (o.parent) o = o.parent; if (o.isScene) hookScene(o, api); };
      obj.addEventListener('added', hook); hook();
    },
    setLayers(l) {
      Object.assign(vis, l);
      if (parts.plate) parts.plate.visible = vis.ground !== false && vis.water !== false;
      if (parts.water) parts.water.visible = vis.water !== false;
      if (parts.green) parts.green.visible = !!vis.green;
      if (parts.trees) parts.trees.visible = !!vis.green && !!vis.trees;
    },
    setQuality(q = {}) {
      const was = phone; if ('visual' in q) visual = !!q.visual; if ('phone' in q) phone = !!q.phone;
      applyWaterColors(); trees?.setShadows(visual && !inside);
      if (phone !== was) buildTrees();
    },
    setTheme(t = {}) {
      if ('ground' in t) ground = t.ground.clone(); if ('light' in t) light = !!t.light; if ('blue' in t) blue = t.blue.clone();
      if (hasGround) { paintAll(); applyWaterColors(); }
      buildGreen(); trees?.setTheme(light);
    },
    /** dir: THREE.Vector3 toward the sun in the group's world frame; alt: sun altitude in degrees (lights the water). */
    setSun({ dir, alt }) {
      if (!waterMat) return;
      if (dir) waterMat.uniforms.uSunDir.value.copy(dir);
      const a = Number.isFinite(alt) ? alt : 30;
      waterMat.uniforms.uSunUp.value = Math.max(0, Math.min(1, a / 8));
      waterMat.uniforms.uLight.value = 0.4 + 0.6 * Math.max(0, Math.min(1, (a + 6) / 26));
      waterMat.uniforms.uSunCol.value.setRGB(1, 0.93 - 0.2 * Math.max(0, 1 - a / 25), 0.8 - 0.3 * Math.max(0, 1 - a / 25));
    },
    setInside(on) { inside = !!on; trees?.setShadows(visual && !inside); },
    treeStats: () => trees?.stats() || { near: 0, far: 0, cones: 0, n: 0 },
    dispose() { disposed = true; scenes.forEach((s) => unhook(s, api)); scenes.clear(); trees?.dispose(); disposeObj(group); own.tex.forEach((t) => t.dispose()); own.mats.forEach((m) => m.dispose()); },
  };
  let disposed = false; const scenes = new Set(); api._scenes = scenes;
  api.setLayers(vis);
  return api;
}

// one onBeforeRender wrapper per scene serves every context in it (a theme change rebuilds the context: no chain of wrappers)
function hookScene(scene, ctx) {
  ctx._scenes.add(scene);
  const reg = scene.userData.__contexts || (scene.userData.__contexts = new Set());
  reg.add(ctx);
  if (scene.userData.__ctxHooked) return;
  scene.userData.__ctxHooked = true;
  const prev = scene.onBeforeRender;
  scene.onBeforeRender = function (renderer, s, camera, target) { prev.call(this, renderer, s, camera, target); for (const c of reg) c.update(camera); };
}
function unhook(scene, ctx) { scene.userData.__contexts?.delete(ctx); }

/** A material's dispose() does not free its textures; the Floor plan studio disposes only materials, so tie them together. */
function freeWith(mat, texs) { const d = mat.dispose.bind(mat); mat.dispose = () => { texs().forEach((t) => t?.dispose()); d(); }; }

function disposeObj(o) {
  o.traverse((m) => { m.geometry?.dispose?.(); const ms = Array.isArray(m.material) ? m.material : m.material ? [m.material] : []; ms.forEach((x) => x.dispose?.()); });
}
