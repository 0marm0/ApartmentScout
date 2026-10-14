// Draws the site's green space (unit/green.js) for the Unit 3D scene and the Floor plan's "City outside":
// parks, lawns and woods as flat coloured ground patches, and trees as instanced low-poly canopies on thin
// trunks. One mesh for all the patches, two instanced meshes for the trees: a few draw calls however many trees.
// Shared by both views through `place`, which maps a site point (x east, y north) to the view's own ground
// coordinates; three.js world = (px, height, -py), the same convention as the building meshes.
import * as THREE from 'three';
import { greenPlan, treeShape } from './green.js';

const mixC = (a, b, t) => a.clone().lerp(b, t);

/**
 * Colours for the green layer from the surface colour it sits on. `light`: light theme (paler lawns, brighter
 * canopies); dark theme keeps the lawns deep and the canopies muted so they read without glowing.
 */
export function greenColors(ground, light) {
  const hex = (h) => new THREE.Color(h);
  return light
    ? { park: mixC(ground, hex(0x62a85a), 0.62), wood: mixC(ground, hex(0x3f8a4c), 0.7), grass: mixC(ground, hex(0x8cc06a), 0.6), play: mixC(ground, hex(0x9bb88a), 0.4),
        canopy: [hex(0x3f8f4b), hex(0x5aa650), hex(0x7ab85a)], trunk: hex(0x6b5a48) }
    : { park: mixC(ground, hex(0x2f7d46), 0.62), wood: mixC(ground, hex(0x1f6a3a), 0.7), grass: mixC(ground, hex(0x4f9a4c), 0.5), play: mixC(ground, hex(0x56805a), 0.4),
        canopy: [hex(0x2c7a44), hex(0x3a8f4f), hex(0x58a357)], trunk: hex(0x4a3f34) };
}

/**
 * Group with `patches` (merged ground polygons) and `canopies` / `trunks` (instanced trees).
 * opts: place(x, y) -> [px, py]; center [x, y] and radius (metres, site frame) to draw within; y0 ground height;
 * colors from greenColors(); trees (bool, default true); limit (max trees).
 */
export function greenGroup(green, opts = {}) {
  const { place = (x, y) => [x, y], center = [0, 0], radius = 600, y0 = 0, colors, trees = true, limit = 6000 } = opts;
  const plan = greenPlan(green, { center, radius, limit });
  const g = new THREE.Group(); g.name = 'green';
  if (!plan) return g;
  g.userData = { polys: plan.polys.length, trees: plan.trees.length / 2, mapped: plan.mapped, scattered: plan.scattered };
  const col = colors || greenColors(new THREE.Color(0x888888), false);

  // ground patches: each polygon triangulated in the view's own ground plane, one vertex-coloured mesh
  const P = [], C = [];
  for (const p of plan.polys) {
    const ring = p.ring.map(([x, y]) => place(x, y));
    const sh = new THREE.Shape(ring.map(([x, y]) => new THREE.Vector2(x, y)));
    for (const h of p.holes) sh.holes.push(new THREE.Path(h.map(([x, y]) => { const [a, b] = place(x, y); return new THREE.Vector2(a, b); })));
    let geo;
    try { geo = new THREE.ShapeGeometry(sh); } catch { continue; }
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position.array, c = col[p.kind] || col.grass;
    for (let k = 0; k < pos.length; k += 3) { P.push(pos[k], y0 + 0.06, pos[k + 2]); C.push(c.r, c.g, c.b); }
    geo.dispose();
  }
  if (P.length) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(C), 3));
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, fog: true });
    const m = new THREE.Mesh(geo, mat); m.name = 'green-patches'; m.renderOrder = 0; g.add(m);
  }

  // trees: canopy = a squashed low-poly sphere on a trunk, 8-14 m tall, three greens picked per tree
  const n = plan.trees.length / 2;
  if (trees && n) {
    const canopyGeo = new THREE.IcosahedronGeometry(1, 1), trunkGeo = new THREE.CylinderGeometry(0.28, 0.4, 1, 5).translate(0, 0.5, 0);
    const canopies = new THREE.InstancedMesh(canopyGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0, flatShading: true }), n);
    const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: col.trunk, roughness: 1, metalness: 0 }), n);
    canopies.name = 'green-canopies'; trunks.name = 'green-trunks';
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), V = new THREE.Vector3(), tmp = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const [px, py] = place(plan.trees[2 * i], plan.trees[2 * i + 1]), { h, r, tone } = treeShape(plan.trees[2 * i], plan.trees[2 * i + 1]);
      const cy = h - r * 0.8; // canopy centre: its lower third overlaps the trunk top
      Q.setFromAxisAngle(V.set(0, 1, 0), tone * 6.283);
      M.compose(V.set(px, y0 + cy, -py), Q, S.set(r, r * 0.92, r)); canopies.setMatrixAt(i, M);
      M.compose(V.set(px, y0, -py), Q, S.set(1, cy, 1)); trunks.setMatrixAt(i, M);
      const k = tone * (col.canopy.length - 1), a = Math.floor(k);
      canopies.setColorAt(i, tmp.copy(col.canopy[a]).lerp(col.canopy[Math.min(col.canopy.length - 1, a + 1)], k - a));
    }
    canopies.instanceMatrix.needsUpdate = trunks.instanceMatrix.needsUpdate = true;
    if (canopies.instanceColor) canopies.instanceColor.needsUpdate = true;
    canopies.receiveShadow = trunks.receiveShadow = true;
    canopies.frustumCulled = trunks.frustumCulled = false;
    g.add(trunks, canopies);
  }
  return g;
}
