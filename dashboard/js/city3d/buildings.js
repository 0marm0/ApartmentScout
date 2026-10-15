// THE building mesher of the 3D views: every building the renter sees, in Unit 3D (orbit, window, inside) and in the Floor plan studio's
// eye-level views and "City outside", is meshed here and nowhere else, from the same site model (sun.js prepBuildings output), so the
// same building id has the same shape at the same place in both engines.
//
// SINGLE ENTRY POINT: prismsOf(b) turns one prepared building into the solids that draw it. A richer building model (a podium with a
// tower, a setback, a facade with real articulation) is a change to that one function (or a function it calls); the batch meshers below
// (mergeBuildings, edgeGeo, outlineGeo) and both engines pick it up unchanged. Frame: site metres, three.js axes (x east, y up, -z north).
// An optional `matrix` (THREE.Matrix4, affine, rotation about y plus a shift) bakes the geometry into another frame (the studio's plan
// frame) without changing the vertex order, so `ids` / `starts` keep identifying the buildings.
import * as THREE from 'three';

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

/**
 * The prisms that draw building b: its components (podium, tower, setback, bulkhead; each from its own base to its own top, the lowest
 * buried like a footprint) when the site file has them, else the footprint prism. THE single entry point of the building mesher.
 * @returns {{geo: THREE.BufferGeometry, h: number}[]} `h` is the height above the building's ground (the colour ramp's input)
 */
export function prismsOf(b) {
  if (!b.parts) return [{ geo: prism(b), h: b.top - Math.max(b.g, 0) }];
  return b.parts.map((q) => ({ geo: prism(q, q.base_m <= 0.5 ? Math.min(b.g, 0) - 1.5 : q.base, q.top), h: q.top - Math.max(b.g, 0) }));
}

/** One geometry for building b (its components merged), for the target mesh. */
export function solidGeo(b) {
  const list = prismsOf(b);
  if (list.length === 1) return list[0].geo;
  const P = [], N = [];
  for (const { geo } of list) { P.push(...geo.attributes.position.array); N.push(...geo.attributes.normal.array); geo.dispose(); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(N), 3));
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
export function mergeBuildings(B, idx, { pal, matrix = null }) {
  const P = [], N = [], C = [], H = [], starts = [], ids = [], ranges = [], v3 = new THREE.Vector3();
  const nm = matrix ? new THREE.Matrix3().getNormalMatrix(matrix) : null;
  let v = 0;
  for (const i of idx) {
    const v0 = v; starts.push(v); ids.push(i);
    for (const { geo, h } of prismsOf(B[i])) {
      const pos = geo.attributes.position.array, nor = geo.attributes.normal.array;
      const c = heightColor(pal, h), roof = mix(c, pal.white, pal.light ? 0.25 : 0.08);
      for (let k = 0; k < pos.length; k += 3) {
        if (matrix) {
          v3.set(pos[k], pos[k + 1], pos[k + 2]).applyMatrix4(matrix); P.push(v3.x, v3.y, v3.z);
          v3.set(nor[k], nor[k + 1], nor[k + 2]).applyMatrix3(nm).normalize(); N.push(v3.x, v3.y, v3.z);
        } else { P.push(pos[k], pos[k + 1], pos[k + 2]); N.push(nor[k], nor[k + 1], nor[k + 2]); }
        H.push(h);
        const cc = nor[k + 1] > 0.9 ? roof : c; C.push(cc.r, cc.g, cc.b);
      }
      v += pos.length / 3; geo.dispose();
    }
    ranges.push([i, v0, v]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(N), 3));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(C), 3));
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
