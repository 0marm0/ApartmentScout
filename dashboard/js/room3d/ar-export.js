// [room3d] "See it in your room": turn the renter's furniture (one piece, or the whole furnished layout) into a file a phone can place on
// the real floor at true size. iPhone and iPad open a .usdz in AR Quick Look (an `<a rel="ar">` link does it); a .glb is the Android and
// desktop route (Scene Viewer, Blender, any glTF viewer).
//
// THE MODEL a phone gets is not the one on screen. bakeForAR() flattens a group of pieces into plain meshes in metres (the studio's
// pieces are drawn in inches inside a scaled child), and re-bakes what AR Quick Look cannot read:
//   - every material becomes a MeshStandardMaterial (UsdPreviewSurface): base colour, roughness, metalness, a colour map and a normal
//     map; a bump map (the leather grain) is turned into a normal map; metal gets its real metalness (Fast draws it near 0.15 because
//     Fast has no environment light, but Quick Look lights the room with the camera feed); a transparent mesh is made opaque (Quick Look
//     sorts transparency badly);
//   - vertex colours (merged books) are split into one mesh per colour, because USD preview materials have no vertex colour input;
//   - double-sided cloth (the duvet, leaves) gets a second, flipped copy of its triangles, because USD materials here are one-sided;
//   - identical geometry and identical materials are shared, so two nightstands are one geometry file and one material;
//   - the pieces are centred on the floor point where the phone will anchor them (x and z), y = 0 at the floor.
// Everything that touches three.js's USDZExporter and GLTFExporter is a dynamic import, so this module loads in Node (the unit tests
// register the vendored three) and costs nothing until someone taps AR. The exporters are three.js r160's own, vendored unmodified.
import * as THREE from 'three';

export const USDZ_MIME = 'model/vnd.usdz+zip';
export const GLB_MIME = 'model/gltf-binary';

// ------------------------------------------------------------------ which device is this
/** 'ios' (iPhone, iPod, iPad, including iPadOS Safari that calls itself a Mac), 'android' or 'desktop'. */
export function arPlatform(nav = typeof navigator !== 'undefined' ? navigator : null) {
  if (!nav) return 'desktop';
  const ua = String(nav.userAgent || '');
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && (nav.maxTouchPoints || 0) > 1)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'desktop';
}

// ------------------------------------------------------------------ baking
/** A normal map (tangent space, +y up, canvas orientation of the source) from a height map canvas. Browser only; null without a DOM. */
export function heightToNormalCanvas(src, strength = 2) {
  if (typeof document === 'undefined' || !src || !src.width) return null;
  const k = Math.min(1, 512 / Math.max(src.width, src.height)), w = Math.max(1, Math.round(src.width * k)), h = Math.max(1, Math.round(src.height * k)), c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'), s = document.createElement('canvas'); s.width = w; s.height = h;
  const sg = s.getContext('2d'); sg.drawImage(src, 0, 0, w, h);
  const A = sg.getImageData(0, 0, w, h).data, out = g.createImageData(w, h), O = out.data, H = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) H[i] = (0.2126 * A[i * 4] + 0.7152 * A[i * 4 + 1] + 0.0722 * A[i * 4 + 2]) / 255;
  const at = (x, y) => H[((y + h) % h) * w + ((x + w) % w)];   // the textures tile, so the edges wrap
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (at(x + 1, y) - at(x - 1, y)) * 0.5 * strength, dy = (at(x, y + 1) - at(x, y - 1)) * 0.5 * strength;   // image y runs down, v runs up
    const nx = -dx, ny = dy, nz = 1, l = Math.hypot(nx, ny, nz), i = (y * w + x) * 4;
    O[i] = Math.round((nx / l * 0.5 + 0.5) * 255); O[i + 1] = Math.round((ny / l * 0.5 + 0.5) * 255); O[i + 2] = Math.round((nz / l * 0.5 + 0.5) * 255); O[i + 3] = 255;
  }
  g.putImageData(out, 0, 0);
  return c;
}

/**
 * A colour map multiplied by the material's colour, baked into the pixels (browser only; null without a DOM or an image). three.js
 * tints a map by `material.color`; USD does it with a `scale` on the texture reader, which Apple's own importers ignore, so a near-white
 * wood grain with a dark brown colour came out pale. The product is taken in linear light, as the renderer does, and the material's
 * colour becomes white.
 */
export function tintedMapCanvas(map, color, max = 512) {
  const img = map?.image;
  if (typeof document === 'undefined' || !img || !img.width) return null;
  const k = Math.min(1, max / Math.max(img.width, img.height)), w = Math.max(1, Math.round(img.width * k)), h = Math.max(1, Math.round(img.height * k));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0, w, h);
  const im = g.getImageData(0, 0, w, h), D = im.data, lin = new Float32Array(256);
  for (let i = 0; i < 256; i++) { const v = i / 255; lin[i] = v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }
  const enc = (v) => Math.round(255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055)), t = [color.r, color.g, color.b];
  for (let i = 0; i < D.length; i += 4) for (let j = 0; j < 3; j++) D[i + j] = enc(Math.min(1, lin[D[i + j]] * t[j]));
  g.putImageData(im, 0, 0);
  return c;
}

const FNV = (h, v) => Math.imul(h ^ v, 16777619) >>> 0;
/** A content key for a geometry (counts and a hash of the positions), so equal geometry built twice is exported once. */
const KEYS = new WeakMap();
function geometryKey(g) {
  if (KEYS.has(g)) return KEYS.get(g);
  const p = g.attributes.position.array, n = p.length, f = new Float32Array(1), u = new Uint32Array(f.buffer);
  let h = 2166136261;
  for (let i = 0; i < n; i += 1) { f[0] = p[i]; h = FNV(h, u[0]); }
  const k = `${n}|${g.index ? g.index.count : 0}|${g.attributes.uv ? 1 : 0}|${g.attributes.color ? 1 : 0}|${h}`;
  KEYS.set(g, k); return k;
}
const texKey = (t) => (t ? `${t.source?.uuid || t.uuid}|${t.repeat.x},${t.repeat.y}|${t.offset.x},${t.offset.y}|${t.rotation}|${t.wrapS}|${t.flipY}` : '-');

/** A copy of the triangles with the winding reversed and the normals turned (the back side of a double-sided sheet). */
function flippedGeometry(g) {
  const f = g.index ? g.toNonIndexed() : g.clone(), P = f.attributes.position, N = f.attributes.normal, U = f.attributes.uv;
  const swap = (a, i, j) => { for (let k = 0; k < a.itemSize; k++) { const t = a.array[i * a.itemSize + k]; a.array[i * a.itemSize + k] = a.array[j * a.itemSize + k]; a.array[j * a.itemSize + k] = t; } };
  for (let t = 0; t < P.count; t += 3) { swap(P, t + 1, t + 2); if (N) swap(N, t + 1, t + 2); if (U) swap(U, t + 1, t + 2); }
  if (N) for (let i = 0; i < N.array.length; i++) N.array[i] = -N.array[i];
  return f;
}
/** One non-indexed geometry per distinct vertex colour (colour attribute removed); returns [[geometry, THREE.Color], ...]. */
function splitByColor(g) {
  const src = g.index ? g.toNonIndexed() : g, P = src.attributes.position, N = src.attributes.normal, U = src.attributes.uv, C = src.attributes.color, groups = new Map();
  for (let t = 0; t < P.count; t += 3) {
    const k = `${C.getX(t).toFixed(3)},${C.getY(t).toFixed(3)},${C.getZ(t).toFixed(3)}`;   // a colour is flat over a triangle (merged boxes)
    (groups.get(k) || groups.set(k, { c: new THREE.Color(C.getX(t), C.getY(t), C.getZ(t)), tris: [] }).get(k)).tris.push(t);
  }
  const out = [];
  for (const { c, tris } of groups.values()) {
    const n = tris.length * 3, p = new Float32Array(n * 3), nn = N ? new Float32Array(n * 3) : null, uu = U ? new Float32Array(n * 2) : null;
    tris.forEach((t, j) => { for (let i = 0; i < 3; i++) { p.set([P.getX(t + i), P.getY(t + i), P.getZ(t + i)], (j * 3 + i) * 3); if (nn) nn.set([N.getX(t + i), N.getY(t + i), N.getZ(t + i)], (j * 3 + i) * 3); if (uu) uu.set([U.getX(t + i), U.getY(t + i)], (j * 3 + i) * 2); } });
    const q = new THREE.BufferGeometry(); q.setAttribute('position', new THREE.BufferAttribute(p, 3)); if (nn) q.setAttribute('normal', new THREE.BufferAttribute(nn, 3)); if (uu) q.setAttribute('uv', new THREE.BufferAttribute(uu, 2));
    out.push([q, c]);
  }
  if (src !== g) src.dispose();
  return out;
}

/**
 * Flatten `source` (a piece, or a group of pieces) into a group of plain meshes in metres, ready for USDZ and glTF. The source is not
 * touched. `opts.center`: 'floor' (default) moves the result so the middle of its footprint is at x = z = 0 and its lowest point stays
 * where it is (y = 0 is the floor); 'none' keeps the source's own frame. `opts.normalStrength`: how hard a bump map becomes a normal map.
 * @returns {THREE.Group} with `userData.ar` = {meshes, triangles, materials, size: [w, h, d] metres, textures}
 */
export function bakeForAR(source, opts = {}) {
  const root = new THREE.Group(); root.name = opts.name || source.name || 'furniture';
  const geos = new Map(), mats = new Map(), normals = new Map(), flips = new Map();
  source.updateWorldMatrix(true, true);
  const inv = new THREE.Matrix4().copy(source.parent ? source.parent.matrixWorld : new THREE.Matrix4()).invert();
  const normalOf = (bump) => {
    if (!bump) return null;
    if (!normals.has(bump)) { const c = heightToNormalCanvas(bump.image, (opts.normalStrength ?? 2)); let t = null; if (c) { t = new THREE.CanvasTexture(c); t.colorSpace = THREE.NoColorSpace; t.wrapS = bump.wrapS; t.wrapT = bump.wrapT; t.repeat.copy(bump.repeat); t.offset.copy(bump.offset); } normals.set(bump, t); }
    return normals.get(bump);
  };
  const tints = new Map();
  const bakeMat = (m, tint) => {
    const arM = m.userData?.arMetalness, metal = arM != null ? arM : (m.metalness ?? 0), tintHex = tint ? tint.getHex() : -1;
    const nm = (m.normalMap && !m.normalMap.isDataTexture ? m.normalMap : null) || (m.bumpMap ? normalOf(m.bumpMap) : null);   // a 1 px flat normal (a painting before its weave is made) has no image the exporter can read
    const key = [m.color?.getHex(), tintHex, +(m.roughness ?? 0.8).toFixed(3), +metal.toFixed(3), texKey(m.map), texKey(nm), m.emissive?.getHex(), +(m.opacity ?? 1).toFixed(2), m.clearcoat || 0, m.side === THREE.DoubleSide ? 2 : 1].join('|');
    if (mats.has(key)) return mats.get(key);
    const o = { color: (m.color || new THREE.Color(0xffffff)).clone(), roughness: THREE.MathUtils.clamp(m.roughness ?? 0.8, 0.04, 1), metalness: THREE.MathUtils.clamp(metal, 0, 1), map: m.map || null, normalMap: nm, emissive: m.emissive ? m.emissive.clone() : new THREE.Color(0), opacity: m.opacity ?? 1 };
    if (tint) o.color.multiply(tint);
    if (o.map && !o.color.equals(new THREE.Color(1, 1, 1))) {   // bake the colour into the map (see tintedMapCanvas)
      const tk = `${texKey(o.map)}|${o.color.getHexString()}`;
      if (!tints.has(tk)) {
        const c = tintedMapCanvas(o.map, o.color); let t = null;
        if (c) { t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = o.map.wrapS; t.wrapT = o.map.wrapT; t.repeat.copy(o.map.repeat); t.offset.copy(o.map.offset); t.rotation = o.map.rotation; t.flipY = o.map.flipY; }
        tints.set(tk, t);
      }
      const t = tints.get(tk); if (t) { o.map = t; o.color = new THREE.Color(1, 1, 1); }
    }
    if (nm) o.normalScale = new THREE.Vector2(1, 1);
    const baked = m.clearcoat > 0 ? new THREE.MeshPhysicalMaterial({ ...o, clearcoat: m.clearcoat, clearcoatRoughness: m.clearcoatRoughness ?? 0.5 }) : new THREE.MeshStandardMaterial(o);
    baked.name = m.name || ''; baked.transparent = (m.opacity ?? 1) < 0.98; baked.userData.arKey = key;
    mats.set(key, baked); return baked;
  };
  const useGeo = (g) => { const k = geometryKey(g); if (!geos.has(k)) geos.set(k, g); return geos.get(k); };
  const out = [];
  const walk = (o, parentVisible) => {
    const vis = parentVisible && o.visible !== false && !o.userData?.arSkip;
    if (!vis || o.name === 'decal' || o.name === 'outline') return;
    if (o.isMesh && o.geometry?.attributes?.position && !o.userData?.noAR) {
      const mArr = Array.isArray(o.material) ? o.material : [o.material], m = mArr[0];
      if (m && (m.isMeshStandardMaterial || m.isMeshPhysicalMaterial || m.isMeshBasicMaterial)) {
        let g = o.geometry; if (!g.attributes.normal) { g = g.clone(); g.computeVertexNormals(); }
        const parts = g.attributes.color && m.vertexColors ? splitByColor(g) : [[g, null]];
        const mw = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
        for (const [pg, tint] of parts) {
          const baked = bakeMat(m, tint), geo = useGeo(pg);
          out.push({ geo, mat: baked, mw });
          if (m.side === THREE.DoubleSide) { const fk = geometryKey(geo) + '|flip'; if (!flips.has(fk)) flips.set(fk, flippedGeometry(geo)); out.push({ geo: useGeo(flips.get(fk)), mat: baked, mw }); }
        }
      }
    }
    for (const c of o.children) walk(c, vis);
  };
  walk(source, true);
  // the studio draws in inches inside a scaled group: bake the scale into the geometry (metres), so every mesh sits in the file at scale 1
  const box = new THREE.Box3(), tmp = new THREE.Box3(), scaled = new Map(), P = new THREE.Vector3(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), SM = new THREE.Matrix4();
  for (const { geo, mat, mw } of out) {
    mw.decompose(P, Q, S);
    const sk = `${geometryKey(geo)}|${S.x.toFixed(6)},${S.y.toFixed(6)},${S.z.toFixed(6)}`;
    if (!scaled.has(sk)) { const g = geo.clone(); if (Math.abs(S.x - 1) + Math.abs(S.y - 1) + Math.abs(S.z - 1) > 1e-6) g.applyMatrix4(SM.makeScale(S.x, S.y, S.z)); g.computeBoundingBox(); scaled.set(sk, g); }
    const g = scaled.get(sk), mesh = new THREE.Mesh(g, mat); mesh.position.copy(P); mesh.quaternion.copy(Q); root.add(mesh);
    mesh.updateMatrix(); tmp.copy(g.boundingBox).applyMatrix4(mesh.matrix); box.union(tmp);
  }
  const shift = new THREE.Vector3();
  if ((opts.center ?? 'floor') === 'floor' && !box.isEmpty()) { shift.set(-(box.min.x + box.max.x) / 2, 0, -(box.min.z + box.max.z) / 2); if (opts.origin) shift.set(-opts.origin[0], 0, -opts.origin[1]); }
  if (shift.lengthSq()) for (const c of root.children) c.position.add(shift);
  root.updateMatrixWorld(true);
  const size = box.isEmpty() ? [0, 0, 0] : box.getSize(new THREE.Vector3()).toArray();
  let triangles = 0; for (const c of root.children) triangles += (c.geometry.index ? c.geometry.index.count : c.geometry.attributes.position.count) / 3;
  root.userData.ar = { meshes: root.children.length, triangles, materials: mats.size, geometries: geos.size, size, textures: new Set([...mats.values()].flatMap((m) => [m.map, m.normalMap]).filter(Boolean)).size,
    min: box.isEmpty() ? [0, 0, 0] : box.min.clone().add(shift).toArray(), max: box.isEmpty() ? [0, 0, 0] : box.max.clone().add(shift).toArray() };
  return root;
}

// ------------------------------------------------------------------ files
/** AR Quick Look: a USDZ archive (uncompressed zip, 64-byte aligned, `model.usda` first) as bytes. `root` comes from bakeForAR().
 *  `opts.alignment`: 'horizontal' (the default: the phone puts it on the floor) or 'vertical'. */
export async function exportUSDZ(root, opts = {}) {
  const { USDZExporter } = await import('three/addons/exporters/USDZExporter.js');
  root.updateMatrixWorld(true);
  return new USDZExporter().parse(root, { ar: { anchoring: { type: 'plane' }, planeAnchoring: { alignment: opts.alignment || 'horizontal' } }, quickLookCompatible: opts.quickLookCompatible !== false });
}
/** Binary glTF (Android Scene Viewer, Blender, a web viewer) as an ArrayBuffer. */
export async function exportGLB(root) {
  const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
  root.updateMatrixWorld(true);
  return new Promise((res, rej) => new GLTFExporter().parse(root, res, rej, { binary: true, onlyVisible: true, maxTextureSize: 1024 }));
}
export const usdzBlob = (bytes) => new Blob([bytes], { type: USDZ_MIME });
export const glbBlob = (buf) => new Blob([buf], { type: GLB_MIME });

/** "3.4 MB" for a byte count. */
export const fmtBytes = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
/** A size in metres as feet and inches, `5'4" × 7' × 3'4"`-style, for the AR note ("it will be this big in your room"). */
export function sizeNote(sizeM) { const I = (m) => Math.round(m / 0.0254), f = (n) => `${Math.floor(n / 12)}'${n % 12 ? ` ${n % 12}"` : ''}`; return sizeM.map((m) => f(I(m))).join(' × '); }

// ------------------------------------------------------------------ reading a USDZ back (for the tests and for a sanity check)
/** The files of an uncompressed (stored) zip: [{name, offset, size}]. Throws when an entry is compressed or the archive is not a zip. */
export function listZip(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), out = [];
  let p = 0;
  while (p + 30 <= bytes.length && v.getUint32(p, true) === 0x04034b50) {
    const method = v.getUint16(p + 8, true), size = v.getUint32(p + 18, true), nameLen = v.getUint16(p + 26, true), extraLen = v.getUint16(p + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 30, p + 30 + nameLen)), offset = p + 30 + nameLen + extraLen;
    if (method !== 0) throw new Error(`${name} is compressed: a USDZ keeps its files stored`);
    out.push({ name, offset, size }); p = offset + size;
  }
  if (!out.length) throw new Error('not a zip archive');
  return out;
}
