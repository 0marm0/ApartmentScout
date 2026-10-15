// Draws a tree plan (unit/trees.js) with instanced meshes in two levels of detail, a handful of draw calls however
// many trees there are:
//   near  (within `nearR` of the camera, nearest first, at most `nearMax`): a three-lobe crown with smooth normals, a
//         darker underside and a leaf mottle, on a five-sided trunk, about 250 triangles a tree;
//   far   everything else: one 80-triangle lobe, same shading, no trunk: a crown seen from hundreds of metres is a
//         lit mass, and 9,000 of them are 720,000 triangles;
//   cones conifers, one 12-triangle cone at every distance.
// The levels are re-sorted when the camera has moved `moveM` metres, by copying precomputed matrices into the
// instance buffers (no allocation per frame). Crowns can cast soft shadows (Visual render quality); trees never
// touch the sun numbers. three.js world = (px, height, -py) where [px, py] = place(x, y), the convention of the
// building meshes, so Unit 3D (place = identity) and the Floor plan's "City outside" (place = plan metres) share it.
import * as THREE from 'three';
import { GROUPS, CONIFER } from './trees.js';
import { hash01 } from './green.js';

export const LOD = { nearR: 240, nearMax: 1500, phoneNearR: 130, phoneNearMax: 500, moveM: 12 };

// crown colours by group, as lit sRGB hex; the dark theme keeps them deep and muted so they read without glowing
const LIGHT = { other: 0x4f9648, plane: 0x66a350, oak: 0x3b823d, maple: 0x4a9242, locust: 0x80b058, linden: 0x39854a, ornamental: 0x5aa656, elm: 0x468c43, ginkgo: 0x88ae4c, conifer: 0x2d664a };
const DARK_MIX = 0x0e2418;
export function treeColors(light) {
  return GROUPS.map((g) => { const c = new THREE.Color(LIGHT[g]); return light ? c : c.lerp(new THREE.Color(DARK_MIX), 0.5); });
}
export const trunkColor = (light) => new THREE.Color(light ? 0x6b5a48 : 0x4a3f34);

/**
 * A crown from overlapping ellipsoid lobes [cx, cy, cz, rx, ry]: smooth normals (leaning up a little, so the top
 * catches the light), a darker underside and a mottle of leaf-sized colour patches in the vertex colours, which the
 * instance colour multiplies. Hashing the unit direction keeps a shared vertex the same colour in every face.
 */
function crownGeometry(lobes, detail, lumpy = 0) {
  const P = [], N = [], C = [];
  lobes.forEach(([cx, cy, cz, rx, ry], li) => {
    const g = new THREE.IcosahedronGeometry(1, detail), pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const ux = pos.getX(i), uy = pos.getY(i), uz = pos.getZ(i), lump = 1 + lumpy * (2 * hash01(Math.round(ux * 40) + li * 13, Math.round(uy * 40) + 5, Math.round(uz * 40) + 9) - 1), y = cy + uy * ry * lump;
      P.push(cx + ux * rx * lump, y, cz + uz * rx * lump);
      const n = new THREE.Vector3(ux / rx, uy / ry + 0.28, uz / rx).normalize(); N.push(n.x, n.y, n.z);
      const t = Math.max(0, Math.min(1, (y + 0.9) / 1.8)), mottle = 0.84 + 0.3 * hash01(Math.round(ux * 40) + li * 7, Math.round(uy * 40), Math.round(uz * 40)), k = (0.66 + 0.4 * t * t * (3 - 2 * t)) * mottle;
      C.push(k, k, k);
    }
    g.dispose();
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(N), 3));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(C), 3));
  return geo;
}
const NEAR_LOBES = [[0, 0, 0, 1, 0.92], [0.62, -0.22, 0.18, 0.66, 0.66], [-0.5, -0.18, -0.38, 0.7, 0.7]];
function withWhite(geo) {
  const n = geo.attributes.position.count, c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const y = geo.attributes.position.getY(i); const t = Math.max(0, Math.min(1, (y + 1) / 2)), k = 0.7 + 0.3 * t; c[3 * i] = c[3 * i + 1] = c[3 * i + 2] = k; }
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3)); return geo;
}

/**
 * The tree layer. `plan` comes from treePlan(). Options: place(x, y) -> [px, py] (default identity), y0 ground height,
 * light (theme), phone (lighter LOD budget), shadows (crowns cast shadows), limit (use only the first `limit` trees of
 * the plan, which is sorted nearest first). Returns
 * {group, update(camera, force), setTheme(light), setShadows(bool), setPhone(bool), stats(), dispose()}.
 */
export function treeLayer(plan, opts = {}) {
  const { place = (x, y) => [x, y], y0 = 0 } = opts;
  let light = !!opts.light, phone = !!opts.phone, shadows = !!opts.shadows;
  const N = Math.min(plan.n, opts.limit ?? plan.n), group = new THREE.Group(); group.name = 'trees';
  const wx = new Float32Array(N), wz = new Float32Array(N);
  const broad = [], cones = [];
  for (let i = 0; i < N; i++) { const [px, py] = place(plan.x[i], plan.y[i]); wx[i] = px; wz[i] = -py; (plan.grp[i] === CONIFER ? cones : broad).push(i); }

  // precomputed instance matrices: near crown, far blob, trunk (16 floats a tree) and base colour
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), S = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
  const nearM = new Float32Array(N * 16), farM = new Float32Array(N * 16), trunkM = new Float32Array(N * 16), coneM = new Float32Array(N * 16);
  const crownMid = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const h = plan.h[i], r = plan.r[i], bole = plan.bole[i], ch = Math.max(1.5, h - bole), mid = y0 + bole + ch / 2;
    crownMid[i] = mid;
    Q.setFromAxisAngle(Y, plan.tone[i] * 6.283);
    M.compose(V.set(wx[i], mid, wz[i]), Q, S.set(r, ch / 2 * 1.08, r)); M.toArray(nearM, i * 16);
    M.compose(V.set(wx[i], mid, wz[i]), Q, S.set(r * 1.04, ch / 2, r * 1.04)); M.toArray(farM, i * 16);
    const tr = Math.max(0.6, plan.dbh[i] * 0.0254 / 2 / 0.21);
    M.compose(V.set(wx[i], y0, wz[i]), Q, S.set(tr, bole + ch * 0.4, tr)); M.toArray(trunkM, i * 16);
    // a conifer is a cone from the ground up to the top
    M.compose(V.set(wx[i], y0 + (h + 0.6) / 2, wz[i]), Q, S.set(r * 0.95, (h - 0.6) / 2, r * 0.95)); M.toArray(coneM, i * 16);
  }
  const base = new Float32Array(N * 3);
  const paint = () => {
    const cols = treeColors(light), tmp = new THREE.Color();
    for (let i = 0; i < N; i++) {
      const k = 0.8 + 0.4 * plan.tone[i], c = cols[plan.grp[i]] || cols[0];
      tmp.copy(c).multiplyScalar(k); base[3 * i] = tmp.r; base[3 * i + 1] = tmp.g; base[3 * i + 2] = tmp.b;
    }
    trunkMat.color.copy(trunkColor(light));
  };

  const canopyMat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.95, metalness: 0 });
  const trunkMat = new THREE.MeshStandardMaterial({ color: trunkColor(light), roughness: 1, metalness: 0 });
  const geos = { near: crownGeometry(NEAR_LOBES, 1, 0.13), far: crownGeometry([[0, 0, 0, 1, 1]], 1, 0.09), trunk: new THREE.CylinderGeometry(0.16, 0.26, 1, 5).translate(0, 0.5, 0), cone: withWhite(new THREE.ConeGeometry(1, 2, 6, 1)) };
  const mk = (geo, mat, cap, name, colored = true) => {
    const m = new THREE.InstancedMesh(geo, mat, Math.max(1, cap)); m.name = name; m.count = 0; m.frustumCulled = false;
    if (colored) m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, cap) * 3), 3);
    m.receiveShadow = true; return m;
  };
  const budget = () => (phone ? [LOD.phoneNearR, LOD.phoneNearMax] : [LOD.nearR, LOD.nearMax]);
  const nearCap = Math.min(broad.length, Math.max(LOD.nearMax, LOD.phoneNearMax));
  const nearMesh = mk(geos.near, canopyMat, nearCap, 'tree-crowns-near'), trunkMesh = mk(geos.trunk, trunkMat, nearCap, 'tree-trunks', false);
  const farMesh = mk(geos.far, canopyMat, broad.length, 'tree-crowns-far'), coneMesh = mk(geos.cone, canopyMat, cones.length, 'tree-cones');
  trunkMesh.receiveShadow = false;
  group.add(trunkMesh, nearMesh, farMesh, coneMesh);
  const setCast = () => { nearMesh.castShadow = farMesh.castShadow = coneMesh.castShadow = shadows; };

  const last = new THREE.Vector3(Infinity, Infinity, Infinity), st = { near: 0, far: 0, cones: 0, n: N, dropped: 0 };
  const put = (mesh, k, i, mat16) => { mesh.instanceMatrix.array.set(mat16.subarray(i * 16, i * 16 + 16), k * 16); const c = mesh.instanceColor?.array; if (c) { c[3 * k] = base[3 * i]; c[3 * k + 1] = base[3 * i + 1]; c[3 * k + 2] = base[3 * i + 2]; } };

  // the cones never change level: fill once (and again on a theme change)
  const fillCones = () => { cones.forEach((i, k) => put(coneMesh, k, i, coneM)); coneMesh.count = cones.length; coneMesh.instanceMatrix.needsUpdate = true; coneMesh.instanceColor.needsUpdate = true; st.cones = cones.length; };

  function update(camera, force = false) {
    if (!N) return;
    const persp = !!camera?.isPerspectiveCamera;
    if (persp && !force && last.distanceTo(camera.position) < LOD.moveM) return;
    if (!persp && !force && Number.isFinite(last.x)) return;      // a plan or top-down camera keeps the last sort
    if (persp) last.copy(camera.position); else last.set(0, 1e5, 0);
    const [R, MAX] = budget(), R2 = persp ? R * R : -1, px = last.x, py = last.y, pz = last.z;
    let cand = [];
    if (persp) for (const i of broad) { const dx = wx[i] - px, dz = wz[i] - pz, dy = crownMid[i] - py, d2 = dx * dx + dz * dz + dy * dy; if (d2 < R2) cand.push([d2, i]); }
    if (cand.length > MAX) { cand.sort((a, b) => a[0] - b[0]); cand = cand.slice(0, MAX); }
    const isNear = new Uint8Array(N);
    cand.forEach(([, i], k) => { isNear[i] = 1; put(nearMesh, k, i, nearM); put(trunkMesh, k, i, trunkM); });
    let f = 0;
    for (const i of broad) if (!isNear[i]) put(farMesh, f++, i, farM);
    nearMesh.count = trunkMesh.count = cand.length; farMesh.count = f;
    for (const m of [nearMesh, trunkMesh, farMesh]) m.instanceMatrix.needsUpdate = true;
    nearMesh.instanceColor.needsUpdate = farMesh.instanceColor.needsUpdate = true;
    st.near = cand.length; st.far = f;
  }

  paint(); fillCones(); setCast();
  return {
    group, update,
    stats: () => ({ ...st }),
    setTheme(l) { light = !!l; paint(); fillCones(); last.set(Infinity, Infinity, Infinity); },   // the next update() re-colours the buffers
    setShadows(on) { shadows = !!on; setCast(); },
    setPhone(on) { phone = !!on; last.set(Infinity, Infinity, Infinity); },
    dispose() { Object.values(geos).forEach((g) => g.dispose()); canopyMat.dispose(); trunkMat.dispose(); nearMesh.dispose(); trunkMesh.dispose(); farMesh.dispose(); coneMesh.dispose(); },
  };
}
