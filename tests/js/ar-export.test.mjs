// "View in your room (AR)": the baked, true-scale model and the .usdz a phone opens (dashboard/js/room3d/ar-export.js), the furniture models'
// triangle budgets, and which device gets which action. three.js is vendored (dashboard/vendor/three), not installed, so this file maps the
// bare `three` and `three/addons/...` specifiers to the vendored files for the modules it imports. The browser side (canvas textures, the
// bump-to-normal bake, the links in the studio, the .glb) is covered in tests/e2e/test_ar_view.py.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { readFileSync } from 'node:fs';

const VENDOR = new URL('../../dashboard/vendor/three/', import.meta.url).href;
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, n) {
  if (s === 'three') return { url: ${JSON.stringify(VENDOR)} + 'three.module.min.js', shortCircuit: true };
  if (s.startsWith('three/addons/')) return { url: ${JSON.stringify(VENDOR)} + 'addons/' + s.slice(13), shortCircuit: true };
  return n(s, c); }`));
const THREE = await import('three');
const AR = await import(new URL('../../dashboard/js/room3d/ar-export.js', import.meta.url));
const { build } = await import(new URL('../../dashboard/js/room3d/furniture.js', import.meta.url));
const { resolve } = await import(new URL('../../dashboard/js/plan/catalog.js', import.meta.url));
const { pieceItem } = await import(new URL('../../dashboard/js/plan/inventory.js', import.meta.url));
const INV = JSON.parse(readFileSync(new URL('../../dashboard/data/furniture.json', import.meta.url), 'utf8'));
const IN = 0.0254;

const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...o });
/** A piece of the renter's furniture drawn the way the studio draws it: inches inside a group scaled to metres. */
function piece(id, quality = 'visual') {
  const p = INV.pieces.find((q) => q.id === id), it = resolve(pieceItem(p));
  const g = new THREE.Group(), s = new THREE.Group(); s.scale.setScalar(IN); g.add(s);
  assert.ok(build(it, { s, std, fabric: std, quality }), `${id} is drawn by the shared models`);
  g.name = it.name; return { g, it, p };
}
const tris = (root) => { let t = 0; root.traverse((o) => { if (o.isMesh) t += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; }); return t; };

// ------------------------------------------------------------------ reading the archive back
const dec = new TextDecoder();
function unpack(bytes) {
  const files = AR.listZip(bytes), text = {};
  for (const f of files) text[f.name] = dec.decode(bytes.subarray(f.offset, f.offset + f.size));
  return { files, text, model: text['model.usda'], geoms: Object.fromEntries(Object.entries(text).filter(([k]) => k.startsWith('geometries/'))) };
}
/** World bounds in metres of everything a USDA scene draws: each Object_n's transform (USD's row-vector matrix) applied to its geometry's points. */
function usdaBounds(u) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  const re = /def Xform "Object_\d+" \(\s*prepend references = @\.\/(geometries\/Geometry_\d+\.usda)@[\s\S]*?matrix4d xformOp:transform = \(\s*\(([^)]*)\),\s*\(([^)]*)\),\s*\(([^)]*)\),\s*\(([^)]*)\)\s*\)/g;
  let m, n = 0;
  while ((m = re.exec(u.model))) {
    const M = [2, 3, 4, 5].map((i) => m[i].split(',').map(Number)), geo = u.text[m[1]], pts = /point3f\[\] points = \[([^\]]*)\]/.exec(geo)[1];
    for (const q of pts.matchAll(/\(([^,()]+), ([^,()]+), ([^,()]+)\)/g)) {
      const v = [+q[1], +q[2], +q[3]];
      for (let a = 0; a < 3; a++) { const w = v[0] * M[0][a] + v[1] * M[1][a] + v[2] * M[2][a] + M[3][a]; lo[a] = Math.min(lo[a], w); hi[a] = Math.max(hi[a], w); }
    }
    n++;
  }
  return { lo, hi, size: hi.map((h, i) => h - lo[i]), objects: n };
}

// ------------------------------------------------------------------ which device gets which action
test('iPhone and iPad (including iPadOS in desktop mode) get AR Quick Look; Android and desktops get downloads', () => {
  const ua = (userAgent, platform = '', maxTouchPoints = 0) => AR.arPlatform({ userAgent, platform, maxTouchPoints });
  assert.equal(ua('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'), 'ios');
  assert.equal(ua('Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'), 'ios');
  assert.equal(ua('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15', 'MacIntel', 5), 'ios', 'iPadOS Safari calls itself a Mac but has a touch screen');
  assert.equal(ua('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15', 'MacIntel', 0), 'desktop', 'a real Mac has no touch points');
  assert.equal(ua('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36', 'Linux armv8l', 5), 'android');
  assert.equal(ua('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36', 'Win32'), 'desktop');
  assert.equal(AR.arPlatform(null), 'desktop');
});

// ------------------------------------------------------------------ the archive
test('every piece exports as a valid USDZ: a stored zip, model.usda first, 64-byte aligned, with its geometry files', async () => {
  for (const p of INV.pieces) {
    const { g } = piece(p.id), root = AR.bakeForAR(g, { name: p.id }), bytes = await AR.exportUSDZ(root);
    assert.deepEqual([...bytes.subarray(0, 4)], [0x50, 0x4b, 0x03, 0x04], `${p.id}: a zip`);
    const u = unpack(bytes);
    assert.equal(u.files[0].name, 'model.usda', `${p.id}: the scene file comes first`);
    for (const f of u.files) assert.equal(f.offset % 64, 0, `${p.id}: ${f.name} starts on a 64-byte boundary (USDZ requires it)`);
    assert.ok(u.model.startsWith('#usda 1.0'), `${p.id}: a USD text file`);
    assert.match(u.model, /metersPerUnit = 1\b/); assert.match(u.model, /upAxis = "Y"/); assert.match(u.model, /defaultPrim = "Root"/);
    assert.match(u.model, /preliminary:anchoring:type = "plane"/); assert.match(u.model, /preliminary:planeAnchoring:alignment = "horizontal"/);
    assert.ok(Object.keys(u.geoms).length >= 2, `${p.id}: geometry files`);
    for (const g2 of Object.values(u.geoms)) assert.match(g2, /point3f\[\] points = \[/);
    assert.ok(root.userData.ar.triangles > 100 && root.userData.ar.meshes > 3, `${p.id}: drawn with real geometry`);
  }
});

test('the model is at true scale: its bounds in metres are the piece size from furniture.json', async () => {
  // [id, tolerance in inches]: the desk set adds a chair and a monitor around the desk, so only its width and floor are exact
  const exact = { bed: 0.6, dresser: 0.4, futon: 2.2, coffee: 0.6, 'nightstand-1': 0.6 };
  for (const [id, tol] of Object.entries(exact)) {
    const { g, p } = piece(id), root = AR.bakeForAR(g), u = unpack(await AR.exportUSDZ(root)), b = usdaBounds(u);
    assert.ok(b.objects === root.children.length, `${id}: every mesh is placed in the scene`);
    const want = [p.w * IN, p.h * IN, p.d * IN];
    for (let a = 0; a < 3; a++) assert.ok(Math.abs(b.size[a] - want[a]) <= tol * IN + 1e-6, `${id}: axis ${'xyz'[a]} is ${(b.size[a] / IN).toFixed(2)} in, the file says ${(want[a] / IN).toFixed(2)} in`);
    assert.ok(Math.abs(b.lo[1]) < 0.003, `${id}: stands on the floor (y = 0, within 3 mm: tapered legs are splayed a little)`);
    assert.ok(Math.abs((b.lo[0] + b.hi[0]) / 2) < 0.02 && Math.abs((b.lo[2] + b.hi[2]) / 2) < 0.03, `${id}: centred on the point the phone anchors`);
  }
  const mal = unpack(await AR.exportUSDZ(AR.bakeForAR(piece('dresser').g))), mb = usdaBounds(mal);
  assert.ok(Math.abs(mb.size[0] - 0.70) < 0.002 && Math.abs(mb.size[1] - 1.20) < 0.002 && Math.abs(mb.size[2] - 0.48) < 0.01, 'STORKLINTA: 70 x 120 x 48 cm');
  const desk = usdaBounds(unpack(await AR.exportUSDZ(AR.bakeForAR(piece('desk').g))));
  assert.ok(Math.abs(desk.size[0] - 89.2 * IN) < 1 * IN && Math.abs(desk.lo[1]) < 0.003 && desk.size[1] > 0.95 && desk.size[1] < 1.4, `the desk set: 89.2 in wide, from the floor to the top of the monitor and the chair back (${desk.size.map((v) => (v / IN).toFixed(1))} in)`);
});

test('the wall-mounted TV hangs at its true height: 32 in off the floor, 55-inch class, a thin panel', async () => {
  const { g, p } = piece('tv'), b = usdaBounds(unpack(await AR.exportUSDZ(AR.bakeForAR(g))));
  assert.ok(Math.abs(b.lo[1] - p.elev * IN) < 0.5 * IN || Math.abs(b.lo[1] - 32 * IN) < 0.5 * IN, `its lowest point is ${(b.lo[1] / IN).toFixed(1)} in up`);
  assert.ok(Math.abs(b.size[0] - 48.4 * IN) < 0.5 * IN, 'a 55-inch screen is about 48.4 in wide');
  assert.ok(b.size[2] < 4 * IN, 'a thin set on a low-profile mount');
});

test('materials are baked for USD: base colour, roughness and metalness on a UsdPreviewSurface each, metal really metallic', async () => {
  const { g } = piece('desk'), root = AR.bakeForAR(g), u = unpack(await AR.exportUSDZ(root));
  const mats = u.model.match(/def Material "Material_\d+"/g) || [];
  assert.ok(mats.length >= 4 && mats.length === root.userData.ar.materials, `${mats.length} materials: wood, chair, monitor, metal, desk things`);
  assert.equal((u.model.match(/info:id = "UsdPreviewSurface"/g) || []).length, mats.length);
  for (const k of ['diffuseColor', 'roughness', 'metallic', 'opacity']) assert.equal((u.model.match(new RegExp(`inputs:${k}\\b`, 'g')) || []).length, mats.length, `every material has ${k}`);
  const metal = [...u.model.matchAll(/float inputs:metallic = ([\d.]+)/g)].map((m) => +m[1]);
  assert.ok(metal.some((v) => v >= 0.55), 'the chair frame is metal in AR (Fast draws it near 0.15 because Fast has no environment light)');
  assert.ok(metal.some((v) => v === 0), 'wood, fabric and plastic are not');
  const rough = [...u.model.matchAll(/float inputs:roughness = ([\d.]+)/g)].map((m) => +m[1]);
  assert.ok(rough.every((v) => v > 0 && v <= 1) && new Set(rough).size > 2, 'roughness differs by material');
  const colours = new Set([...u.model.matchAll(/color3f inputs:diffuseColor = (\([^)]*\))/g)].map((m) => m[1]));
  assert.ok(colours.size >= 4, 'a few different colours');
  const black = [...colours].map((c) => c.slice(1, -1).split(',').map(Number)).filter(([r, gg, b]) => Math.max(r, gg, b) < 0.1);
  assert.ok(black.length, 'the chair and monitor are black');
});

// ------------------------------------------------------------------ the bake
test('bakeForAR leaves the source alone, shares identical geometry and materials, and re-bakes what Quick Look cannot read', () => {
  const a = piece('nightstand-1').g, b = piece('nightstand-2').g, one = AR.bakeForAR(a), before = tris(a);
  const room = new THREE.Group(); b.position.set(1, 0, 0.3); room.add(a, b); room.updateMatrixWorld(true);
  const two = AR.bakeForAR(room);
  assert.equal(tris(a), before, 'the source group is untouched');
  assert.equal(two.userData.ar.geometries, one.userData.ar.geometries, 'two nightstands share every geometry');
  assert.equal(two.userData.ar.materials, one.userData.ar.materials, 'and every material');
  assert.equal(two.children.length, one.children.length * 2);
  assert.ok(Math.abs(two.userData.ar.size[0] - (1 + 18 * IN)) < 0.02, 'placed 1 m apart, kept that way');
  // vertex colours (merged books) are split into one mesh per colour; a double-sided sheet gets its other side
  const geo = new THREE.BoxGeometry(1, 1, 1).toNonIndexed(), n = geo.attributes.position.count, col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const c = i < n / 2 ? [1, 0, 0] : [0, 0, 1]; col.set(c, i * 3); }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const src = new THREE.Group(); src.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 })));
  const split = AR.bakeForAR(src, { center: 'none' });
  assert.equal(split.children.length, 2, 'two colours, two meshes'); assert.equal(split.userData.ar.materials, 2);
  assert.deepEqual(split.children.map((m) => m.material.color.getHexString()).sort(), ['0000ff', 'ff0000']);
  assert.equal(tris(split), 12, 'no triangle is lost or doubled');
  const sheet = new THREE.Group(); sheet.add(new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({ side: THREE.DoubleSide })));
  const both = AR.bakeForAR(sheet, { center: 'none' });
  assert.equal(tris(both), 4, 'a sheet is drawn from both sides: 2 triangles and their flipped copies');
  const [f, k] = both.children.map((m) => m.geometry.attributes.normal.getZ(0)); assert.equal(Math.sign(f), -Math.sign(k), 'the copy faces the other way');
  const clear = new THREE.Group(); clear.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ opacity: 0.4, transparent: true })));
  assert.equal(AR.bakeForAR(clear).children[0].material.transparent, true, 'real glass stays see-through');
  const hidden = new THREE.Group(); const m1 = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), std(0xff0000)); m1.name = 'decal'; const m2 = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), std(0x00ff00)); m2.visible = false;
  hidden.add(m1, m2, new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), std(0x0000ff)));
  assert.equal(AR.bakeForAR(hidden).children.length, 1, 'the studio\'s fit-check decal and hidden parts are left out');
});

test('listZip refuses a compressed archive and a file that is not a zip', () => {
  assert.throws(() => AR.listZip(new Uint8Array(64)), /not a zip/);
  const z = new Uint8Array(40); new DataView(z.buffer).setUint32(0, 0x04034b50, true); new DataView(z.buffer).setUint16(8, 8, true);
  assert.throws(() => AR.listZip(z), /compressed/);
});

test('sizes read back as feet and inches, and bytes as KB or MB', () => {
  assert.equal(AR.sizeNote([1.6002, 0.7798, 0.48]), "5' 3\" × 2' 7\" × 1' 7\"");
  assert.equal(AR.fmtBytes(2048), '2 KB'); assert.equal(AR.fmtBytes(3.5 * 1048576), '3.5 MB'); assert.equal(AR.fmtBytes(10), '1 KB');
});

// ------------------------------------------------------------------ triangle budgets of the furniture models
test('every piece stays within its triangle budget: about 1,600 in Fast and 6,000 in Visual', () => {
  for (const p of INV.pieces) {
    const f = tris(piece(p.id, 'fast').g), v = tris(piece(p.id, 'visual').g);
    assert.ok(f <= 1600, `${p.id}: ${f} triangles in Fast`);
    assert.ok(v <= 6000, `${p.id}: ${v} triangles in Visual`);
    assert.ok(v >= f, `${p.id}: Visual is never lighter than Fast`);
  }
  assert.ok(tris(piece('desk', 'visual').g) > tris(piece('desk', 'fast').g) * 2, 'Visual draws the desk set richer (a mesh chair back, a mug, a notebook)');
  assert.ok(tris(piece('futon', 'visual').g) > tris(piece('futon', 'fast').g) * 2, 'and the futon\'s buttoned leather');
});
