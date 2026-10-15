// THE building mesher of the 3D views: every building the renter sees, in Unit 3D (orbit, window, inside) and in the Floor plan studio's
// eye-level views and "City outside", is meshed here and nowhere else, from the same site model (sun.js prepBuildings output), so the
// same building id has the same shape at the same place in both engines.
//
// SINGLE ENTRY POINT: prismsOf(b) turns one prepared building into the solids that draw it. A richer building model (a podium with a
// tower, a setback, a facade with real articulation) is a change to that one function (or a function it calls); the batch meshers below
// (mergeBuildings, edgeGeo, outlineGeo) and both engines pick it up unchanged. Frame: site metres, three.js axes (x east, y up, -z north).
// An optional `matrix` (THREE.Matrix4, affine, rotation about y plus a shift) bakes the geometry into another frame (the studio's plan
// frame) without changing the vertex order, so `ids` / `starts` keep identifying the buildings.
// [massing] A building is drawn from its entry in city3d/model.js (id, parts, facade style, roof furniture) by city3d/geometry.js: walls with facade
// attributes, flat caps, parapets, pitched roofs, spires. The facade shader (city3d/facade.js) reads those attributes. `b.meta` (the site's bmeta entry,
// attached by createCity) gives the class, year and floors that choose the style; without it a building still draws, in the default style.
import * as THREE from 'three';
import { entryOf } from './model.js';
import { entryParts, nonIndexed } from './geometry.js';
import { prepBuildings } from '../sun.js';
import { effectiveComponents } from '../unit/parts.js';
import { decorate } from './facade.js';

const mix = (a, b, t) => a.clone().lerp(b, t);

export function shapeOf(b) {
  const sh = new THREE.Shape();
  for (let j = 0; j < b.n; j++) { const x = b.p[2 * j], y = b.p[2 * j + 1]; j ? sh.lineTo(x, y) : sh.moveTo(x, y); }
  for (const h of b.holes || []) { const pa = new THREE.Path(); for (let j = 0; j < h.length / 2; j++) { j ? pa.lineTo(h[2 * j], h[2 * j + 1]) : pa.moveTo(h[2 * j], h[2 * j + 1]); } sh.holes.push(pa); }
  return sh;
}

/** A prism geometry for b in world space (bottom buried a little so buildings on lower ground do not float). */
export function prism(b, z0 = null, z1 = null, grow = 0) {
  const bottom = z0 ?? Math.min(b.g, 0) - 1.5, top = z1 ?? b.top;
  const geo = new THREE.ExtrudeGeometry(shapeOf(b), { depth: Math.max(0.5, top - bottom), bevelEnabled: false, curveSegments: 1 });
  geo.rotateX(-Math.PI / 2); geo.translate(0, bottom, 0);
  if (grow) { // push outward a little for the floor band so it sits on the facade
    geo.computeBoundingBox(); const c = new THREE.Vector3(); geo.boundingBox.getCenter(c);
    const s = 1 + grow / Math.max(8, Math.max(b.bb[2] - b.bb[0], b.bb[3] - b.bb[1]));
    geo.translate(-c.x, 0, -c.z); geo.scale(s, 1, s); geo.translate(c.x, 0, c.z);
  }
  return geo;
}

/** The ear-clipping triangulator the geometry builder needs, from three's ShapeUtils. */
export function triangulate(outer, holes) {
  const v = (a) => a.map(([x, y]) => new THREE.Vector2(x, y));
  try { return THREE.ShapeUtils.triangulateShape(v(outer), holes.map(v)); } catch { return []; }
}
const PLACEHOLDER = () => [1, 1, 1];   // the colour ramp is applied by mergeBuildings from each solid's height; only a part with its own colour carries one

/** A Pack as a non-indexed three.js geometry with the facade attributes aFa / aFb (and `color` for a part with its own colour). */
function geoOf(pack) {
  const a = nonIndexed(pack), g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(a.position, 3)); g.setAttribute('normal', new THREE.BufferAttribute(a.normal, 3));
  g.setAttribute('aFa', new THREE.BufferAttribute(a.aFa, 4)); g.setAttribute('aFb', new THREE.BufferAttribute(a.aFb, 4));
  if (a.color) g.setAttribute('color', new THREE.BufferAttribute(a.color, 3));
  return g;
}

/** The legacy plain prisms (no facade attributes): the fallback if the rich drawing of a building throws. */
function plainPrismsOf(b) {
  if (!b.parts) return [{ geo: prism(b), h: b.top - Math.max(b.g, 0) }];
  return b.parts.map((q) => ({ geo: prism(q, q.base_m <= 0.5 ? Math.min(b.g, 0) - 1.5 : q.base, q.top), h: q.top - Math.max(b.g, 0) }));
}

/**
 * The solids that draw building b: one per part (podium, tower, setback, bulkhead, spire; each from its own base to its own top, with a pitched
 * or sloped roof where the parts say so, a parapet on an exposed flat top, a tapered spire), else the footprint prism, plus generic roof
 * furniture on the detailed level; every vertex carries the facade attributes. THE single entry point of the building mesher.
 * @param {object} b prepared building (sun.js prepBuildings); `b.meta` = its bmeta entry
 * @param {{near?: boolean, decor?: boolean}} [o] near = the detailed level (parapets, furniture; default true)
 * @returns {{geo: THREE.BufferGeometry, h: number}[]} `h` is the height above the building's ground (the colour ramp's input)
 */
export function prismsOf(b, o = {}) {
  try {
    const e = entryOf(b, b.i ?? 0, b.meta, { near: o.near !== false, decor: o.decor });
    return entryParts(e, { triangulate, colorFor: PLACEHOLDER }).map(({ pack, h }) => ({ geo: geoOf(pack), h }));
  } catch (err) { console.warn('rich building failed, drawing its prism', err); return plainPrismsOf(b); }
}

/** One geometry for building b (its parts merged), for the target mesh: position, normal and the facade attributes. */
export function solidGeo(b) {
  const list = prismsOf(b, { near: true });
  if (list.length === 1) return list[0].geo;
  const keys = ['position', 'normal', 'aFa', 'aFb'], size = { position: 3, normal: 3, aFa: 4, aFb: 4 }, A = Object.fromEntries(keys.map((k) => [k, []]));
  for (const { geo } of list) {
    for (const k of keys) if (geo.attributes[k]) A[k].push(...geo.attributes[k].array); else if (k === 'aFa' || k === 'aFb') A[k].push(...new Array((geo.attributes.position.count) * size[k]).fill(0));
    geo.dispose();
  }
  const g = new THREE.BufferGeometry();
  for (const k of keys) if (A[k].length) g.setAttribute(k, new THREE.BufferAttribute(new Float32Array(A[k]), size[k]));
  g.computeBoundingSphere(); return g;
}

/** The colour ramp of the city: low buildings dark, tall ones light, by log height. `pal` = city3d/look.js palette(). */
export function heightColor(pal, h) {
  const t = Math.max(0, Math.min(1, Math.log(Math.max(h, 6) / 6) / Math.log(260 / 6)));
  return mix(pal.bLow, pal.bHigh, Math.pow(t, 0.85));
}

/**
 * Merge buildings `idx` (indices into B) into one geometry with vertex colours.
 * @param {object[]} B prepared buildings
 * @param {number[]} idx
 * @param {{pal: object, matrix?: THREE.Matrix4}} o
 * @returns {{geometry: THREE.BufferGeometry, starts: Int32Array, ids: Int32Array, H: Float32Array, ranges: [number, number, number][]}} `ranges` = [building, first vertex, end vertex]
 */
export function mergeBuildings(B, idx, { pal, matrix = null, near = true }) {
  const P = [], N = [], C = [], H = [], FA = [], FB = [], starts = [], ids = [], ranges = [], v3 = new THREE.Vector3();
  const nm = matrix ? new THREE.Matrix3().getNormalMatrix(matrix) : null;
  let v = 0;
  for (const i of idx) {
    const v0 = v; starts.push(v); ids.push(i);
    for (const { geo, h } of prismsOf(B[i], { near })) {
      const pos = geo.attributes.position.array, nor = geo.attributes.normal.array, own = geo.attributes.color?.array, fa = geo.attributes.aFa?.array, fb = geo.attributes.aFb?.array;
      const c = heightColor(pal, h), roof = mix(c, pal.white, pal.light ? 0.25 : 0.08);
      for (let k = 0; k < pos.length; k += 3) {
        if (matrix) {
          v3.set(pos[k], pos[k + 1], pos[k + 2]).applyMatrix4(matrix); P.push(v3.x, v3.y, v3.z);
          v3.set(nor[k], nor[k + 1], nor[k + 2]).applyMatrix3(nm).normalize(); N.push(v3.x, v3.y, v3.z);
        } else { P.push(pos[k], pos[k + 1], pos[k + 2]); N.push(nor[k], nor[k + 1], nor[k + 2]); }
        H.push(h);
        if (own) C.push(own[k], own[k + 1], own[k + 2]); else { const cc = nor[k + 1] > 0.9 ? roof : c; C.push(cc.r, cc.g, cc.b); }
        const q = (k / 3) * 4;
        if (fa) FA.push(fa[q], fa[q + 1], fa[q + 2], fa[q + 3]); else FA.push(0, 0, 1, 3.2);
        if (fb) FB.push(fb[q], fb[q + 1], fb[q + 2], fb[q + 3]); else FB.push(9, 0.5, 2, 0);   // no facade attributes: a plain surface
      }
      v += pos.length / 3; geo.dispose();
    }
    ranges.push([i, v0, v]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(N), 3));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(C), 3));
  g.setAttribute('aFa', new THREE.BufferAttribute(new Float32Array(FA), 4));
  g.setAttribute('aFb', new THREE.BufferAttribute(new Float32Array(FB), 4));
  g.computeBoundingSphere();
  return { geometry: g, starts: Int32Array.from(starts), ids: Int32Array.from(ids), H: Float32Array.from(H), ranges };
}

const bake = (P, matrix) => {
  if (!matrix) return;
  const v = new THREE.Vector3();
  for (let k = 0; k < P.length; k += 3) { v.set(P[k], P[k + 1], P[k + 2]).applyMatrix4(matrix); P[k] = v.x; P[k + 1] = v.y; P[k + 2] = v.z; }
};

/** Roof outlines plus vertical lines at real corners (all corners with `all`). */
export function edgeGeo(B, idx, all = false, matrix = null) {
  const P = [];
  for (const i of idx) {
    const B0 = B[i];
    for (const b of B0.parts || [B0]) {
      const bot = b === B0 || b.base_m <= 0.5 ? Math.min(B0.g, 0) - 1.5 : b.base;
      for (const p of [b.p, ...(b.holes || [])]) {
        const n = p.length / 2;
        for (let j = 0; j < n; j++) {
          const j2 = (j + 1) % n, j0 = (j - 1 + n) % n;
          const x = p[2 * j], y = p[2 * j + 1], x2 = p[2 * j2], y2 = p[2 * j2 + 1];
          P.push(x, b.top, -y, x2, b.top, -y2);
          const a1 = Math.atan2(y - p[2 * j0 + 1], x - p[2 * j0]), a2 = Math.atan2(y2 - y, x2 - x);
          if (all || Math.abs(((a2 - a1 + 3 * Math.PI) % (2 * Math.PI)) - Math.PI) > 0.4) P.push(x, bot, -y, x, b.top, -y);
        }
      }
    }
  }
  bake(P, matrix);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3)); return g;
}

/** Footprint outlines at height z. */
export function outlineGeo(B, idx, z = 0.25, matrix = null) {
  const P = [];
  for (const i of idx) for (const p of [B[i].p, ...(B[i].holes || [])]) { const n = p.length / 2; for (let j = 0; j < n; j++) { const j2 = (j + 1) % n; P.push(p[2 * j], z, -p[2 * j + 1], p[2 * j2], z, -p[2 * j2 + 1]); } }
  bake(P, matrix);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3)); return g;
}

/**
 * buildBuildings(site, opts): the buildings of a site file as a THREE.Group, for a consumer that does not need the whole city (createCity in
 * city3d/city.js is the full one and uses the same prismsOf, mergeBuildings and facade shader). Group 'buildings' with meshes 'buildings-near'
 * (casts shadows) and 'buildings-far'. group.userData: {vrange (building -> [mesh, firstVertex, endVertex]), ids, uniforms (the shared facade
 * uniforms: uNight 0..1, uQual 0 Fast | 1 Visual), info, dispose()}. Each building keeps its site index and stable id (its BIN).
 * @param {object|null} site the site file (null when opts.B is given)
 * @param {{B?: object[], meta?: object[], pal?: object, center?: number[], nearR?: number, skip?: Set<number>, only?: Set<number>, matrix?: THREE.Matrix4, quality?: {visual: boolean}, night?: number}} [opts]
 *   B: prepared buildings (default from the site and its effective components); meta: bmeta (default site.bmeta); pal: city3d/look.js palette
 *   (default a plain one); center: [x, y] site metres for the levels of detail (default the target); nearR: detailed level radius (default 900 m).
 */
export function buildBuildings(site, opts = {}) {
  const B = opts.B || prepBuildings(site.b, site.holes && typeof site.holes === 'object' ? site.holes : null, effectiveComponents(site));
  const meta = opts.meta || site?.bmeta || [];
  B.forEach((b, i) => { if (meta[i]) b.meta = meta[i]; });
  const T = site?.target != null ? B[site.target] : null, [cx, cy] = opts.center || (T ? [(T.bb[0] + T.bb[2]) / 2, (T.bb[1] + T.bb[3]) / 2] : [0, 0]);
  const pal = opts.pal || { bLow: new THREE.Color(0x3a404c), bHigh: new THREE.Color(0x8f97a6), white: new THREE.Color(1, 1, 1), light: false, lit: new THREE.Color(1, 0.8, 0.5) };
  const near = [], far = [];
  B.forEach((b, i) => {
    if (opts.skip?.has(i) || (opts.only && !opts.only.has(i))) return;
    (Math.hypot((b.bb[0] + b.bb[2]) / 2 - cx, (b.bb[1] + b.bb[3]) / 2 - cy) <= (opts.nearR ?? 900) ? near : far).push(i);
  });
  const U = { uNight: { value: opts.night ?? 0 }, uFloorH: { value: 3.2 }, uDetail: { value: 1 }, uLitCol: { value: pal.lit.clone() }, uQual: { value: opts.quality?.visual ? 1 : 0 }, uTintMix: { value: 1 } };
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
  decorate(mat, U, 'city3d-buildings');
  const group = new THREE.Group(); group.name = 'buildings';
  const vrange = new Map(), meshes = [], ids = [];
  for (const [idx, cast, name, nearLevel] of [[near, true, 'buildings-near', true], [far, false, 'buildings-far', false]]) {
    const { geometry, starts, ids: mids, H, ranges } = mergeBuildings(B, idx, { pal, matrix: opts.matrix || null, near: nearLevel });
    const m = new THREE.Mesh(geometry, mat); m.name = name; m.castShadow = cast; m.receiveShadow = true;
    m.userData.starts = starts; m.userData.ids = mids; m.userData.h = H;
    for (const [i, a, b] of ranges) { vrange.set(i, [m, a, b]); ids.push(i); }
    meshes.push(m); group.add(m);
  }
  group.userData = { meshes, vrange, ids: ids.sort((a, b) => a - b), uniforms: U, info: { buildings: ids.length, near: near.length, far: far.length }, dispose() { for (const m of meshes) m.geometry.dispose(); mat.dispose(); } };
  return group;
}
