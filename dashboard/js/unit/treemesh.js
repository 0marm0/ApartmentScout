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
//
// THE SEASON (setSeason, city3d/season.js): a picture only. Broadleaf crowns drop leaf-sized clumps as the leaf share falls (a hashed discard in the
// fragment shader, nothing re-meshed), their colour turns tree by tree through October and November, and a bare-branch skeleton (instanced, near
// trees only) shows through; far crowns keep a faint twig haze in winter so a bare park still reads as trees. Conifers do not change. Trees are never
// obstructions in any sun number, in any month.
import * as THREE from 'three';
import { GROUPS, CONIFER } from './trees.js';
import { hash01 } from './green.js';

export const LOD = { nearR: 240, nearMax: 1500, phoneNearR: 130, phoneNearMax: 500, moveM: 12 };

// crown colours by group, as lit sRGB hex; the dark theme keeps them deep and muted so they read without glowing
const LIGHT = { other: 0x4f9648, plane: 0x66a350, oak: 0x3b823d, maple: 0x4a9242, locust: 0x80b058, linden: 0x39854a, ornamental: 0x5aa656, elm: 0x468c43, ginkgo: 0x88ae4c, conifer: 0x2d664a };
const DARK_MIX = 0x0e2418;
// autumn crown colours by group (lit sRGB hex, brighter than the greens because the crown's vertex colours multiply them): each tree picks one by its tone
const AUTUMN = {
  other: [0xe0902e, 0xc4502c, 0xe8bb3f], plane: [0xd6a53f, 0xc08a30], oak: [0xb5662f, 0xa4562c, 0xc27a30], maple: [0xd2432a, 0xe86f22, 0xe29a2c],
  locust: [0xe3cd48], linden: [0xe6cb52], ornamental: [0xd4483f, 0xe8902f], elm: [0xdeb03c], ginkgo: [0xf0cc3c],
};
const TWIG = 0x8a7b6c;   // the colour a bare crown's remaining twigs read as from far away
export function treeColors(light) {
  return GROUPS.map((g) => { const c = new THREE.Color(LIGHT[g]); return light ? c : c.lerp(new THREE.Color(DARK_MIX), 0.5); });
}
/** The colour of the tree of group `g` with tone `tone` (0..1) when `autumn` (0..1) of the way into its colour; `light` is the theme. */
export function autumnColor(g, tone, autumn, light) {
  const name = GROUPS[g], pal = AUTUMN[name], green = new THREE.Color(LIGHT[name] ?? LIGHT.other);
  let c = green;
  if (pal && autumn > 0) {
    const turn = Math.max(0, Math.min(1, autumn * 1.5 - 0.5 * ((tone * 7.31) % 1)));   // trees do not all turn on the same day
    c = green.clone().lerp(new THREE.Color(pal[Math.floor(((tone * 13.7) % 1) * pal.length) % pal.length]), turn);
  }
  return light ? c : c.lerp(new THREE.Color(DARK_MIX), 0.5);
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
// the three lobes reach out to ~1.3 x the unit radius (and the far blob to 1.04): scaled so a near crown spans the same width as the crown the allometry gives, not a third more
const NEAR_SPAN = 0.84;
function withWhite(geo) {
  const n = geo.attributes.position.count, c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const y = geo.attributes.position.getY(i); const t = Math.max(0, Math.min(1, (y + 1) / 2)), k = 0.7 + 0.3 * t; c[3 * i] = c[3 * i + 1] = c[3 * i + 2] = k; }
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3)); return geo;
}


/**
 * The bare-branch skeleton of a broadleaf tree in the unit space of its crown (the crown ellipsoid has radius 1, its centre at the origin): six limbs
 * fork from the top of the trunk, each forks again at its tip and sends a side twig off its middle; tapered three-sided tubes, 216 triangles.
 */
function branchGeometry() {
  const P = [], N = [];
  const tube = (a, b, r0, r1) => {
    const d = new THREE.Vector3().subVectors(b, a).normalize(), up = Math.abs(d.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const u = new THREE.Vector3().crossVectors(d, up).normalize(), v = new THREE.Vector3().crossVectors(d, u).normalize();
    const ring = (c, r) => [0, 1, 2].map((k) => { const t = (k / 3) * Math.PI * 2; return { p: c.clone().addScaledVector(u, Math.cos(t) * r).addScaledVector(v, Math.sin(t) * r), n: u.clone().multiplyScalar(Math.cos(t)).addScaledVector(v, Math.sin(t)) }; });
    const A = ring(a, r0), B = ring(b, r1);
    for (let k = 0; k < 3; k++) {
      const k2 = (k + 1) % 3;
      for (const q of [A[k], B[k], B[k2], A[k], B[k2], A[k2]]) { P.push(q.p.x, q.p.y, q.p.z); N.push(q.n.x, q.n.y, q.n.z); }
    }
  };
  const V = (x, y, z) => new THREE.Vector3(x, y, z), root = V(0, -0.22, 0);
  for (let k = 0; k < 6; k++) {
    const t = (k / 6) * Math.PI * 2 + 0.4 * hash01(k, 3, 5), rad = 0.5 + 0.12 * hash01(k, 7, 5), top = 0.34 + 0.34 * hash01(k, 9, 5);
    const mid = V(Math.cos(t) * rad * 0.5, -0.22 + (top + 0.22) * 0.55, Math.sin(t) * rad * 0.5), tip = V(Math.cos(t) * rad, top, Math.sin(t) * rad);
    tube(root, mid, 0.05, 0.036); tube(mid, tip, 0.036, 0.024);
    for (const s of [-1, 1]) {   // the fork at the tip: two twigs, fanned either side and lifted
      const t2 = t + s * 0.5, end = V(Math.cos(t2) * (rad + 0.34), top + 0.2 + 0.1 * hash01(k, s + 3, 11), Math.sin(t2) * (rad + 0.34));
      tube(tip, end, 0.02, 0.008);
    }
    const t3 = t + (k % 2 ? 0.9 : -0.9), side = V(Math.cos(t3) * (rad * 0.5 + 0.34), mid.y + 0.22, Math.sin(t3) * (rad * 0.5 + 0.34));
    tube(mid, side, 0.022, 0.008);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(N), 3));
  return geo;
}

/**
 * A crown material that drops leaf-sized clumps (about 0.6 m) as `leafU.value` falls from 1 to 0, in the fragment shader: a clump stays while its hash is
 * under the leaf share (or under `floor`, the twig haze a far crown keeps in winter). Nothing is re-meshed and nothing changes at full leaf.
 */
function leafMaterial(leafU, floor) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.95, metalness: 0 });
  const U = { uLeaf: leafU, uFloor: { value: floor } };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vLeafP;')
      .replace('#include <project_vertex>', '#include <project_vertex>\n#ifdef USE_INSTANCING\nvLeafP = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;\n#else\nvLeafP = (modelMatrix * vec4(transformed, 1.0)).xyz;\n#endif');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uLeaf; uniform float uFloor; varying vec3 vLeafP;\nfloat leafHash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }')
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (uLeaf < 0.995 && leafHash(floor(vLeafP * 1.7)) > max(uLeaf, uFloor)) discard;');
  };
  m.customProgramCacheKey = () => `leaf${floor > 0 ? 'f' : 'n'}`;
  return m;
}

/**
 * The tree layer. `plan` comes from treePlan(). Options: place(x, y) -> [px, py] (default identity), y0 ground height,
 * light (theme), phone (lighter LOD budget), shadows (crowns cast shadows), season ({leaf, autumn}, default full green leaf), limit (use only the first `limit` trees of
 * the plan, which is sorted nearest first). Returns
 * {group, update(camera, force), setTheme(light), setShadows(bool), setSeason({leaf, autumn}), setPhone(bool), stats(), dispose()}.
 */
export function treeLayer(plan, opts = {}) {
  const { place = (x, y) => [x, y], y0 = 0 } = opts;
  let light = !!opts.light, phone = !!opts.phone, shadows = !!opts.shadows, season = { leaf: 1, autumn: 0, ...(opts.season || {}) };
  const leafU = { value: season.leaf };
  const N = Math.min(plan.n, opts.limit ?? plan.n), group = new THREE.Group(); group.name = 'trees';
  const wx = new Float32Array(N), wz = new Float32Array(N);
  // [park trees] street trees and park trees are separate layers (plan.cls: 0 street, 1 park): the lists hold the trees of the layers that are on
  const cls = plan.cls || new Uint8Array(N), on = [opts.streetTrees !== false, opts.parkTrees !== false];
  let broad = [], cones = [], capBroad = 0, capCones = 0;
  for (let i = 0; i < N; i++) { const [px, py] = place(plan.x[i], plan.y[i]); wx[i] = px; wz[i] = -py; if (plan.grp[i] === CONIFER) capCones++; else capBroad++; }
  const sortLists = () => { broad = []; cones = []; for (let i = 0; i < N; i++) if (on[cls[i]]) (plan.grp[i] === CONIFER ? cones : broad).push(i); };
  sortLists();

  // precomputed instance matrices: near crown, far blob, trunk (16 floats a tree) and base colour
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), S = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
  const nearM = new Float32Array(N * 16), farM = new Float32Array(N * 16), trunkM = new Float32Array(N * 16), coneM = new Float32Array(N * 16);
  const crownMid = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const h = plan.h[i], r = plan.r[i], bole = plan.bole[i], ch = Math.max(1.5, h - bole), mid = y0 + bole + ch / 2;
    crownMid[i] = mid;
    Q.setFromAxisAngle(Y, plan.tone[i] * 6.283);
    M.compose(V.set(wx[i], mid, wz[i]), Q, S.set(r * NEAR_SPAN, ch / 2 * 1.08, r * NEAR_SPAN)); M.toArray(nearM, i * 16);
    M.compose(V.set(wx[i], mid, wz[i]), Q, S.set(r * 1.04, ch / 2, r * 1.04)); M.toArray(farM, i * 16);
    const tr = Math.max(0.6, plan.dbh[i] * 0.0254 / 2 / 0.21);
    M.compose(V.set(wx[i], y0, wz[i]), Q, S.set(tr, bole + ch * 0.4, tr)); M.toArray(trunkM, i * 16);
    // a conifer is a cone from the ground up to the top
    M.compose(V.set(wx[i], y0 + (h + 0.6) / 2, wz[i]), Q, S.set(r * 0.95, (h - 0.6) / 2, r * 0.95)); M.toArray(coneM, i * 16);
  }
  const base = new Float32Array(N * 3), baseFar = new Float32Array(N * 3);
  const paint = () => {
    const tmp = new THREE.Color(), twig = new THREE.Color(TWIG), bare = Math.max(0, Math.min(1, 1 - season.leaf * 1.6));
    if (!light) twig.lerp(new THREE.Color(DARK_MIX), 0.5);
    for (let i = 0; i < N; i++) {
      const k = 0.8 + 0.4 * plan.tone[i];
      tmp.copy(autumnColor(plan.grp[i], plan.tone[i], season.autumn, light)).multiplyScalar(k); base[3 * i] = tmp.r; base[3 * i + 1] = tmp.g; base[3 * i + 2] = tmp.b;
      if (plan.grp[i] !== CONIFER) tmp.lerp(twig, bare);   // a bare far crown reads as grey-brown twigs; a conifer stays green
      baseFar[3 * i] = tmp.r; baseFar[3 * i + 1] = tmp.g; baseFar[3 * i + 2] = tmp.b;
    }
    trunkMat.color.copy(trunkColor(light)); branchMat.color.copy(trunkColor(light)).multiplyScalar(0.8);
  };

  const canopyNear = leafMaterial(leafU, 0), canopyFar = leafMaterial(leafU, 0.16), canopyMat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.95, metalness: 0 });   // (canopyMat: the conifers, which keep their needles)
  const trunkMat = new THREE.MeshStandardMaterial({ color: trunkColor(light), roughness: 1, metalness: 0 });
  const geos = { near: crownGeometry(NEAR_LOBES, 1, 0.13), far: crownGeometry([[0, 0, 0, 1, 1]], 1, 0.09), trunk: new THREE.CylinderGeometry(0.16, 0.26, 1, 5).translate(0, 0.5, 0), branches: branchGeometry(), cone: withWhite(new THREE.ConeGeometry(1, 2, 6, 1)) };
  const mk = (geo, mat, cap, name, colored = true) => {
    const m = new THREE.InstancedMesh(geo, mat, Math.max(1, cap)); m.name = name; m.count = 0; m.frustumCulled = false;
    if (colored) m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, cap) * 3), 3);
    m.receiveShadow = true; return m;
  };
  const budget = () => (phone ? [LOD.phoneNearR, LOD.phoneNearMax] : [LOD.nearR, LOD.nearMax]);
  const nearCap = Math.min(capBroad, Math.max(LOD.nearMax, LOD.phoneNearMax));
  const branchMat = new THREE.MeshStandardMaterial({ color: trunkColor(light), roughness: 1, metalness: 0 });
  const nearMesh = mk(geos.near, canopyNear, nearCap, 'tree-crowns-near'), trunkMesh = mk(geos.trunk, trunkMat, nearCap, 'tree-trunks', false), branchMesh = mk(geos.branches, branchMat, nearCap, 'tree-branches', false);
  const farMesh = mk(geos.far, canopyFar, capBroad, 'tree-crowns-far'), coneMesh = mk(geos.cone, canopyMat, capCones, 'tree-cones');
  trunkMesh.receiveShadow = branchMesh.receiveShadow = false;
  group.add(trunkMesh, branchMesh, nearMesh, farMesh, coneMesh);
  // the crowns of a winter tree are mostly air: they cast no shadow picture (the numbers never use one)
  const setCast = () => { nearMesh.castShadow = farMesh.castShadow = shadows && season.leaf > 0.5; coneMesh.castShadow = shadows; };
  const showBranches = () => { branchMesh.visible = season.leaf < 0.97; };

  const last = new THREE.Vector3(Infinity, Infinity, Infinity), st = { near: 0, far: 0, cones: 0, n: N, dropped: 0 };
  const put = (mesh, k, i, mat16, col = base) => { mesh.instanceMatrix.array.set(mat16.subarray(i * 16, i * 16 + 16), k * 16); const c = mesh.instanceColor?.array; if (c) { c[3 * k] = col[3 * i]; c[3 * k + 1] = col[3 * i + 1]; c[3 * k + 2] = col[3 * i + 2]; } };

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
    const withBranches = season.leaf < 0.97;
    cand.forEach(([, i], k) => { isNear[i] = 1; put(nearMesh, k, i, nearM); put(trunkMesh, k, i, trunkM); if (withBranches) put(branchMesh, k, i, nearM); });
    let f = 0;
    for (const i of broad) if (!isNear[i]) put(farMesh, f++, i, farM, baseFar);
    nearMesh.count = trunkMesh.count = cand.length; branchMesh.count = withBranches ? cand.length : 0; farMesh.count = f;
    for (const m of [nearMesh, trunkMesh, branchMesh, farMesh]) m.instanceMatrix.needsUpdate = true;
    nearMesh.instanceColor.needsUpdate = farMesh.instanceColor.needsUpdate = true;
    st.near = cand.length; st.far = f;
  }

  paint(); fillCones(); setCast(); showBranches();
  return {
    group, update,
    stats: () => ({ ...st }),
    setTheme(l) { light = !!l; paint(); fillCones(); last.set(Infinity, Infinity, Infinity); },   // the next update() re-colours the buffers
    setShadows(on) { shadows = !!on; setCast(); },
    /**
     * The season as {leaf, autumn} (city3d/season.js seasonAt): leaves on the broadleaf crowns (0 bare .. 1 full) and how far their colour has turned.
     * A picture only. The next camera pass re-sorts the instances with the new colours, so a caller marks its view dirty.
     */
    setSeason(s = {}) {
      const leaf = Math.max(0, Math.min(1, Number.isFinite(+s.leaf) ? +s.leaf : 1)), autumn = Math.max(0, Math.min(1, Number.isFinite(+s.autumn) ? +s.autumn : 0));
      if (leaf === season.leaf && autumn === season.autumn) return false;
      season = { leaf, autumn }; leafU.value = leaf; paint(); fillCones(); setCast(); showBranches(); last.set(Infinity, Infinity, Infinity);
      return true;
    },
    season: () => ({ ...season }),
    /** [park trees] switch the street-tree and park-tree layers: {street, park} booleans (a missing key stays as it is). */
    setClasses(c = {}) {
      if ('street' in c) on[0] = !!c.street; if ('park' in c) on[1] = !!c.park;
      sortLists(); fillCones(); last.set(Infinity, Infinity, Infinity);
    },
    classes: () => ({ street: on[0], park: on[1] }),
    setPhone(on) { phone = !!on; last.set(Infinity, Infinity, Infinity); },
    dispose() { Object.values(geos).forEach((g) => g.dispose()); canopyMat.dispose(); canopyNear.dispose(); canopyFar.dispose(); trunkMat.dispose(); branchMat.dispose(); nearMesh.dispose(); trunkMesh.dispose(); branchMesh.dispose(); farMesh.dispose(); coneMesh.dispose(); },
  };
}
