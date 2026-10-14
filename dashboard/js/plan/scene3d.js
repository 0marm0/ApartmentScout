// three.js side of the Floor plan studio: the shell (floors, walls with cuts, glass, doors, fixtures),
// furniture meshes, overlays (clearance zones, dimension lines, sightlines), the real-sun light and
// the cameras (bird, top, eye level from the bed / sofa / door, and walk).
// Plan coordinates are inches with +y toward the top of the drawing; the world is metres with
// world x = plan x and world z = -plan y.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { MAT } from './catalog.js';
import { axes, footprint, toWorld, swingPoly } from './checks.js';
import { pointInPoly, fmtIn } from './model.js';

export const M = 0.0254;
const DEG = Math.PI / 180;
const W = (x, y, h = 0) => new THREE.Vector3(x * M, h * M, -y * M);
const CUT = { full: null, cut: 36, outline: 1.5 };

let renderer, scene, cam, controls, canvas, stage, sunL, hemi, amb;
let shell, proxies, furn, overlay, labels;
let model = null, colors = null, wallMode = 'cut', dirty = true;
const groups = new Map();
const rig = { mode: 'orbit', view: 'bird', pos: new THREE.Vector3(), yaw: 0, pitch: 0, prevWall: null };

export const markDirty = () => { dirty = true; };
export const getCamera = () => cam;
export const viewMode = () => rig.mode;

function tok(name, fb) { const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim(); return new THREE.Color(v || fb); }
function themeColors() {
  const dark = document.documentElement.dataset.theme !== 'light';
  const ink = tok('--ink', '#eef1f6'), s1 = tok('--surface-1', '#0e1015'), s2 = tok('--surface-2', '#13161d'), s3 = tok('--surface-3', '#1a1e27');
  const bg = (dark ? s2 : s3).clone();
  return {
    dark, bg, night: bg.clone().lerp(new THREE.Color(0x000000), dark ? 0.35 : 0.08),
    ground: bg.clone().lerp(ink, dark ? 0.03 : -0.02),
    wall: dark ? ink.clone().lerp(s3, 0.2) : s1.clone().lerp(ink, 0.015),
    cap: dark ? tok('--ground', '#08090c') : tok('--ink-2', '#4b5261'),
    fixture: dark ? ink.clone().lerp(s3, 0.38) : s1.clone().lerp(ink, 0.14),
    wood: new THREE.Color(dark ? 0xa58a6c : 0xd2b48f), tile: new THREE.Color(dark ? 0xb4b8bd : 0xe2e3e0), carpet: new THREE.Color(dark ? 0x9a978f : 0xd9d5cc),
    label: dark ? 'rgba(18,20,26,.78)' : 'rgba(18,21,28,.62)', label2: dark ? 'rgba(18,20,26,.55)' : 'rgba(18,21,28,.42)',
    accent: tok('--accent', '#8b96ff'), good: tok('--good', '#4fd19a'), warn: tok('--warn', '#f0b04c'), bad: tok('--bad', '#f2735f'), sun: tok('--sun', '#f5b547'),
    hemiDay: dark ? 1.55 : 2.0, hemiNight: dark ? 0.55 : 0.8,
  };
}
const FLOOR_OF = { kitchen: 'tile', bath: 'tile', closet: 'carpet', outdoor: 'tile' };

// ------------------------------------------------------------------ renderer
export function init(canvasEl, stageEl, onChange) {
  canvas = canvasEl; stage = stageEl;
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  scene = new THREE.Scene();
  cam = new THREE.PerspectiveCamera(42, 1.6, 0.05, 400);
  controls = new OrbitControls(cam, canvas);
  controls.enableDamping = false; controls.maxPolarAngle = Math.PI * 0.495; controls.minDistance = 1.5; controls.maxDistance = 60;
  controls.addEventListener('change', () => { dirty = true; onChange?.(); });
  hemi = new THREE.HemisphereLight(0xf2f4f8, 0x8a8478, 2); scene.add(hemi);
  amb = new THREE.AmbientLight(0xffffff, 0.55); scene.add(amb);
  sunL = new THREE.DirectionalLight(0xfff1d6, 6); sunL.castShadow = true; sunL.shadow.mapSize.set(2048, 2048);
  sunL.shadow.bias = -0.0004; sunL.shadow.normalBias = 0.025; sunL.shadow.radius = 3;
  scene.add(sunL); scene.add(sunL.target);
  for (const n of ['shell', 'proxies', 'furn', 'overlay', 'labels']) { const g = new THREE.Group(); g.name = n; scene.add(g); }
  [shell, proxies, furn, overlay, labels] = ['shell', 'proxies', 'furn', 'overlay', 'labels'].map((n) => scene.getObjectByName(n));
  new ResizeObserver(resize).observe(stage);
}
export function resize() {
  if (!renderer) return; const w = stage.clientWidth, h = stage.clientHeight; if (!w || !h) return;
  renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); dirty = true;
}
export function render(force = false) { if (!renderer || (!dirty && !force)) return false; dirty = false; renderer.render(scene, cam); return true; }

function clear(g) {
  while (g.children.length) {
    const c = g.children.pop();
    c.traverse((o) => { o.geometry?.dispose(); const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : []; for (const m of ms) { m.map?.dispose(); if (!m.userData.shared) m.dispose(); } });
  }
}
const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...o });

// ------------------------------------------------------------------ shell
export function setModel(m) { model = m; colors = themeColors(); buildShell(); frameLights(); }
export function setWallMode(m) { wallMode = m; if (model) buildShell(); }
export function retheme() { colors = themeColors(); if (model) { buildShell(); rebuildAllItems(); } }
let lastItems = [];
let lighting = { ambient: 1, sun: 1 };
// per-window city shade: an invisible shadow caster fills the opening of every window a neighbour blocks
let shades = [], shadeState = [];
export function setWindowShade(blocked = []) {
  shadeState = blocked.slice();
  shades.forEach((m, i) => { m.visible = !!shadeState[i]; });
  dirty = true;
}
// "City outside": the neighbouring buildings around the apartment (plan/citymesh.js), drawn only
let city = null;
export function setCity(group) {
  if (city) { scene.remove(city); city.traverse((o) => { o.geometry?.dispose(); o.material?.dispose?.(); }); }
  city = group || null;
  if (city) scene.add(city);
  cam.far = city ? 1200 : 400; cam.updateProjectionMatrix();
  const gr = shell?.getObjectByName('ground'); if (gr) gr.visible = !city; // the floor-level ground would hide the street
  controls.maxDistance = city ? 240 : 60;
  // step back so the neighbours come into view (and in again when the layer goes)
  if (rig.mode === 'orbit') {
    const t = controls.target, d = cam.position.clone().sub(t), L = d.length();
    if (city && L < 40) cam.position.copy(t).addScaledVector(d.normalize(), 46);
    else if (!city && L > 60) cam.position.copy(t).addScaledVector(d.normalize(), 24);
    controls.update();
  }
  dirty = true;
}
export const hasCity = () => !!city;
export function setLighting(options = {}) {
  if (Number.isFinite(options.ambient)) lighting.ambient = Math.max(0, Math.min(2, options.ambient));
  // glazing x blinds preview: scales the direct-sun patches only (plan/light.js glazingScale)
  if (Number.isFinite(options.sun)) lighting.sun = Math.max(0, Math.min(2, options.sun));
  dirty = true;
}

function buildShell() {
  clear(shell); clear(proxies); clear(labels);
  const C = colors, cut = CUT[wallMode], H = model.ceiling;
  scene.background = C.bg.clone();
  const b = model.bounds, cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
  // ground
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), std(C.ground, { roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.position.set(cx * M, -0.02, -cy * M); ground.receiveShadow = true; ground.name = 'ground'; ground.visible = !city; shell.add(ground);
  // floors
  for (const r of model.rooms) {
    const shape = new THREE.Shape(r.poly.map(([x, y]) => new THREE.Vector2(x * M, y * M)));
    const g = new THREE.ShapeGeometry(shape); g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, std(C[FLOOR_OF[r.kind] || 'wood'], { roughness: 0.78 })); m.position.y = 0.001; m.receiveShadow = true; m.name = `floor: ${r.name}`; shell.add(m);
    floorGrid(r);
    labels.add(floorLabel(r));
  }
  // walls: visible pieces cut to the wall mode, plus full-height shadow proxies so the sun stays true
  const wallMat = std(C.wall, { roughness: 0.92 }), capMat = new THREE.MeshBasicMaterial({ color: C.cap });
  const proxyMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
  for (const p of model.pieces) {
    const top = cut == null ? p.z1 : Math.min(p.z1, cut);
    if (top - p.z0 > 0.2) shell.add(pieceBox(p, p.z0, top, cut == null ? wallMat : [wallMat, wallMat, capMat, wallMat, wallMat, wallMat], false));
    proxies.add(pieceBox(p, p.z0, p.z1, proxyMat, true));
  }
  const ceil = new THREE.Mesh(new THREE.BoxGeometry((b.x1 - b.x0 + 24) * M, 0.08, (b.y1 - b.y0 + 24) * M), proxyMat);
  ceil.position.set(cx * M, H * M + 0.04, -cy * M); ceil.castShadow = true; proxies.add(ceil);
  // window shades (shadow casters only), switched per window by setWindowShade
  shades = [];
  const shadeMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, side: THREE.DoubleSide });
  model.windows.forEach((w, i) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry((w.len + 2) * M, (w.head - w.sill + 2) * M), shadeMat);
    m.position.copy(W(w.mid[0], w.mid[1], (w.sill + w.head) / 2)); m.rotation.y = Math.atan2(w.b[1] - w.a[1], w.b[0] - w.a[0]);
    m.castShadow = true; m.visible = !!shadeState[i]; m.name = 'window shade'; proxies.add(m); shades.push(m);
  });
  // glass
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x9fc6e8, transparent: true, opacity: C.dark ? 0.22 : 0.28, roughness: 0.08, side: THREE.DoubleSide, depthWrite: false });
  for (const w of model.windows) {
    const top = cut == null ? w.head : Math.min(w.head, cut); if (top <= w.sill + 0.5) continue;
    const L = w.len, mid = w.mid, gl = new THREE.Mesh(new THREE.PlaneGeometry(L * M, (top - w.sill) * M), glassMat);
    gl.position.copy(W(mid[0], mid[1], (w.sill + top) / 2)); gl.rotation.y = Math.atan2(w.b[1] - w.a[1], w.b[0] - w.a[0]); gl.name = 'glass'; shell.add(gl);
    if (cut != null) { // window line on the cut, like a drafting section
      const pts = [W(w.a[0], w.a[1], top + 0.3), W(w.b[0], w.b[1], top + 0.3)];
      shell.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: C.cap })));
    }
  }
  // doors: open leaf and the swing arc on the floor
  const leafMat = std(C.wall.clone().lerp(C.cap, 0.12), { roughness: 0.7 }), arcMat = new THREE.LineDashedMaterial({ color: C.cap, dashSize: 0.06, gapSize: 0.05, transparent: true, opacity: 0.55 });
  for (const d of model.doorways) {
    if (!d.swingDir) continue;
    const leafH = cut == null ? Math.min(d.head, H) : Math.min(d.head, cut), L = d.leaf;
    const c = [d.hingePt[0] + d.swingDir[0] * L / 2, d.hingePt[1] + d.swingDir[1] * L / 2];
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(L * M, leafH * M, 1.4 * M), leafMat);
    leaf.position.copy(W(c[0], c[1], leafH / 2)); leaf.rotation.y = Math.atan2(d.swingDir[1], d.swingDir[0]); leaf.castShadow = true; leaf.receiveShadow = true; shell.add(leaf);
    const sw = swingPoly(d, 16).slice(1), line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(sw.map(([x, y]) => W(x, y, 0.4))), arcMat);
    line.computeLineDistances(); shell.add(line);
  }
  // fixtures
  for (const f of model.fixtures) {
    const top = cut == null || f.kind === 'ac' || f.kind === 'ptac' || f.height <= 48 ? f.elev + f.height : Math.min(f.elev + f.height, Math.max(cut, f.elev + 6));
    if (top - f.elev < 0.2) continue;
    const shape = new THREE.Shape(f.poly.map(([x, y]) => new THREE.Vector2(x * M, y * M)));
    const g = new THREE.ExtrudeGeometry(shape, { depth: (top - f.elev) * M, bevelEnabled: false }); g.rotateX(-Math.PI / 2);
    const col = f.kind === 'ac' || f.kind === 'ptac' ? new THREE.Color(MAT.ac) : C.fixture;
    const mats = cut != null && f.height > 48 ? [capMat, std(col, { roughness: 0.8 })] : std(col, { roughness: 0.8, transparent: f.est, opacity: f.est ? 0.92 : 1 });
    const m = new THREE.Mesh(g, mats); m.position.y = f.elev * M; m.castShadow = true; m.receiveShadow = true; m.name = `fixture: ${f.label || f.kind}`; shell.add(m);
    if (f.kind === 'ac' || f.kind === 'ptac') acGrille(f, top);
  }
  dirty = true;
}
function pieceBox(p, z0, z1, mat, cast) {
  const dx = p.b[0] - p.a[0], dy = p.b[1] - p.a[1], L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L, h = p.t / 2;
  const s0 = p.capA ? -h : 0, s1 = L + (p.capB ? h : 0), mid = [p.a[0] + ux * (s0 + s1) / 2, p.a[1] + uy * (s0 + s1) / 2];
  const m = new THREE.Mesh(new THREE.BoxGeometry((s1 - s0) * M, (z1 - z0) * M, p.t * M), mat);
  m.position.copy(W(mid[0], mid[1], (z0 + z1) / 2)); m.rotation.y = Math.atan2(dy, dx);
  m.castShadow = cast; m.receiveShadow = !cast; return m;
}
function acGrille(f, top) {
  const n = f.front; if (!n) return;
  const xs = f.poly.map((p) => p[0]), ys = f.poly.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const face = n[0] ? [n[0] > 0 ? x1 : x0, (y0 + y1) / 2] : [(x0 + x1) / 2, n[1] > 0 ? y1 : y0], len = n[0] ? y1 - y0 : x1 - x0;
  const mat = std(0x7d7362, { roughness: 0.6 });
  for (let i = 0; i < 5; i++) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry((len - 6) * M, 0.5 * M, 0.6 * M), mat);
    bar.position.copy(W(face[0] + n[0] * 0.3, face[1] + n[1] * 0.3, f.elev + (top - f.elev) * (0.42 + i * 0.1))); bar.rotation.y = n[0] ? Math.PI / 2 : 0; shell.add(bar);
  }
}
function floorGrid(r) {
  const b = { x0: Math.min(...r.poly.map((p) => p[0])), x1: Math.max(...r.poly.map((p) => p[0])), y0: Math.min(...r.poly.map((p) => p[1])), y1: Math.max(...r.poly.map((p) => p[1])) };
  const pos = [], h = 0.12;
  const scan = (vertical, c) => { // intersections of a grid line with the polygon edges
    const ts = [];
    for (let i = 0; i < r.poly.length; i++) {
      const [ax, ay] = r.poly[i], [bx, by] = r.poly[(i + 1) % r.poly.length];
      const [a, bb, pa, pb] = vertical ? [ax, bx, ay, by] : [ay, by, ax, bx];
      if ((a <= c && bb > c) || (bb <= c && a > c)) ts.push(pa + ((c - a) / (bb - a)) * (pb - pa));
    }
    ts.sort((p, q) => p - q);
    for (let i = 0; i + 1 < ts.length; i += 2) { if (vertical) pos.push(c * M, h * M, -ts[i] * M, c * M, h * M, -ts[i + 1] * M); else pos.push(ts[i] * M, h * M, -c * M, ts[i + 1] * M, h * M, -c * M); }
  };
  for (let x = Math.ceil(b.x0 / 12) * 12; x < b.x1; x += 12) scan(true, x + 0.01);
  for (let y = Math.ceil(b.y0 / 12) * 12; y < b.y1; y += 12) scan(false, y + 0.01);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: colors.cap, transparent: true, opacity: colors.dark ? 0.16 : 0.1 })); l.name = 'grid'; shell.add(l);
}
function textCanvas(lines, color, color2) {
  const c = document.createElement('canvas'); c.width = 640; c.height = 200; const g = c.getContext('2d');
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = color; g.font = '600 60px Geist, "Geist Fallback", system-ui, sans-serif'; g.fillText(lines[0], 320, lines[1] ? 70 : 100);
  if (lines[1]) { g.fillStyle = color2; g.font = '500 44px "Geist Mono", ui-monospace, monospace'; g.fillText(lines[1], 320, 140); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
function floorLabel(r) {
  const b = { w: Math.max(...r.poly.map((p) => p[0])) - Math.min(...r.poly.map((p) => p[0])), h: Math.max(...r.poly.map((p) => p[1])) - Math.min(...r.poly.map((p) => p[1])) };
  const sub = r.stated || (r.rect ? `${fmtIn(b.h)} × ${fmtIn(b.w)}` : `${Math.round(r.sqft)} ft²`);
  const t = textCanvas([r.name, sub], colors.label, colors.label2);
  const wIn = Math.min(b.w * 0.8, 72), m = new THREE.Mesh(new THREE.PlaneGeometry(wIn * M, (wIn * 200 / 640) * M), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.position.copy(W(r.label[0], r.label[1], 0.25)); m.renderOrder = 2; m.name = 'label'; return m;
}

// ------------------------------------------------------------------ lights and sun
function frameLights() {
  const b = model.bounds, cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, span = Math.max(b.x1 - b.x0, b.y1 - b.y0) * M;
  sunL.target.position.copy(W(cx, cy));
  Object.assign(sunL.shadow.camera, { left: -span, right: span, top: span, bottom: -span, near: 1, far: 150 }); sunL.shadow.camera.updateProjectionMatrix();
}
/** dir: unit vector toward the sun in plan terms {x, y, up}; on: direct sun reaches the unit. */
export function setSun(dir, on, up) {
  if (!model) return;
  const v = new THREE.Vector3(dir.x, dir.up, -dir.y).normalize();
  sunL.position.copy(sunL.target.position).addScaledVector(v, 60);
  sunL.intensity = on ? (3.6 + 4 * Math.max(0, dir.up)) * lighting.sun : 0;
  hemi.intensity = (up ? colors.hemiDay : colors.hemiNight) * lighting.ambient;
  amb.intensity = (up ? 0.45 : 0.3) * lighting.ambient;
  scene.background = (up ? colors.bg : colors.night).clone();
  dirty = true;
}

// ------------------------------------------------------------------ furniture
export function setItems(items) { lastItems = items; const ids = new Set(items.map((i) => i.id)); for (const [id, g] of groups) if (!ids.has(id)) { furn.remove(g); disposeGroup(g); groups.delete(id); } for (const it of items) syncItem(it, true); dirty = true; }
function disposeGroup(g) { g.traverse((o) => { o.geometry?.dispose(); if (o.material && !o.material.userData?.shared) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose()); }); }
function rebuildAllItems() { for (const [, g] of groups) { furn.remove(g); disposeGroup(g); } groups.clear(); setItems(lastItems); }
/** Update an item's transform, rebuilding its meshes when its shape changed. */
export function syncItem(it, rebuild = false) {
  let g = groups.get(it.id);
  const sig = `${it.ref}|${it.w}|${it.d}|${it.h}|${it.elev}|${it.variant || ''}`;
  if (!g || g.userData.sig !== sig || rebuild && g.userData.sig !== sig) { if (g) { furn.remove(g); disposeGroup(g); } g = buildItem(it); g.userData.sig = sig; groups.set(it.id, g); furn.add(g); }
  g.position.copy(W(it.x, it.y)); g.rotation.y = -it.rot * DEG; g.visible = !it.hidden;
  g.name = `${it.name} (${it.ref})`; g.userData.itemId = it.id; g.userData.ref = it.ref;
  dirty = true;
}
export function setStatus(states, selId) {
  for (const [id, g] of groups) {
    const st = states[id] || 'clear', sel = id === selId, deco = g.getObjectByName('decal'), ol = g.getObjectByName('outline');
    if (deco) { deco.material.color.copy(st === 'blocked' ? colors.bad : st === 'tight' ? colors.warn : colors.accent); deco.material.opacity = st === 'blocked' ? 0.42 : st === 'tight' ? 0.26 : sel ? 0.22 : 0; deco.visible = deco.material.opacity > 0; }
    if (ol) { ol.visible = sel || st !== 'clear'; ol.material.color.copy(sel ? colors.accent : st === 'blocked' ? colors.bad : colors.warn); }
  }
  dirty = true;
}

function buildItem(it) {
  const g = new THREE.Group(), s = new THREE.Group(); s.scale.setScalar(M); g.add(s);
  const box = (w, h, d, color, x, y, z, o) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), color.isMaterial ? color : std(color, o)); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; s.add(m); return m; };
  const cyl = (r, h, color, x, y, z, seg = 24) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), std(color)); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; s.add(m); return m; };
  const { w, d, h, kind } = it, col = it.base?.color ?? 0x8899aa, hw = w / 2, hd = d / 2;
  if (kind === 'bed') {
    const [mw0, md0] = it.base.mattress || [w - 4, d - 4], mw = Math.min(mw0, w - 2), md = Math.min(md0, d - 3);
    box(w, h, 3, MAT.fabric, 0, h / 2, -hd + 1.5);
    box(w - 1, 11, d - 3, MAT.woodDark, 0, 5.5, 1.5);
    box(mw, 10, md, MAT.linen, 0, 16, 1.5);
    box(mw + 0.6, 2.4, md * 0.64, MAT.duvet, 0, 22.2, 1.5 + md * 0.18);
    for (const sx of [-1, 1]) box(mw / 2 - 5, 5, 15, MAT.pillow, sx * mw / 4, 23.5, -hd + 13);
  } else if (kind === 'nightstand') {
    box(w, h - 1.5, d, col, 0, (h - 1.5) / 2, 0); box(w + 0.5, 1.5, d + 0.5, MAT.woodDark, 0, h - 0.75, 0); box(w * 0.7, 0.6, 0.6, MAT.woodDark, 0, h * 0.62, hd + 0.3);
  } else if (kind === 'dresser') {
    box(w, h, d, col, 0, h / 2, 0); const n = Math.max(3, Math.round(h / 10));
    for (let i = 0; i < n; i++) { const y = 3 + ((h - 6) * (i + 0.5)) / n; box(w - 2, (h - 6) / n - 1, 0.5, MAT.linen, 0, y, hd + 0.25); box(Math.min(6, w / 4), 0.8, 0.8, MAT.metal, 0, y + 1.5, hd + 0.8); }
  } else if (kind === 'wardrobe') {
    box(w, h, d, col, 0, h / 2, 0); box(0.4, h - 4, 0.4, MAT.metal, 0, h / 2, hd + 0.2);
    for (const sx of [-1, 1]) box(0.8, 8, 0.8, MAT.metal, sx * 2, h * 0.55, hd + 0.6);
  } else if (kind === 'bookcase') {
    box(w, h, 1, col, 0, h / 2, -hd + 0.5); box(1, h, d, col, -hw + 0.5, h / 2, 0); box(1, h, d, col, hw - 0.5, h / 2, 0);
    for (let i = 0; i < 6; i++) { const y = 1 + (h - 2) * i / 5; box(w - 2, 0.8, d - 1, col, 0, y, 0.5); if (i < 5) for (let k = 0; k < 4; k++) box(1.2 + (k % 2), 8 + (k % 3), d - 3, [MAT.fabric, MAT.duvet, MAT.fabricWarm, MAT.green][k], -hw + 4 + k * 2.6, y + 5, 0.5); }
  } else if (kind === 'sofa' || kind === 'chair') {
    const flat = it.variant === 'bed', arm = kind === 'chair' ? 5 : 5.5, seatH = flat ? h - 2 : 17;
    box(arm, flat ? h : 25, d, col, -hw + arm / 2, (flat ? h : 25) / 2, 0); box(arm, flat ? h : 25, d, col, hw - arm / 2, (flat ? h : 25) / 2, 0);
    box(w - 2 * arm, seatH - 5, d - 1, MAT.woodDark, 0, (seatH - 5) / 2, 0);
    if (flat) box(w - 2 * arm, 6, d - 2, col, 0, seatH - 2, 0.5);
    else { box(w - 2 * arm, 6, d - 10, col, 0, seatH - 2, 4.5); box(w - 2 * arm, h - 12, 9, col, 0, 12 + (h - 12) / 2 - 1, -hd + 4.5); }
  } else if (kind === 'table-low') {
    box(w, 1.6, d, col, 0, h - 0.8, 0); for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box(1.8, h - 1.6, 1.8, MAT.woodDark, sx * (hw - 2.5), (h - 1.6) / 2, sz * (hd - 2.5));
    box(w - 6, 0.8, d - 6, MAT.woodDark, 0, 5, 0);
  } else if (kind === 'table') {
    if (it.base.round) { cyl(hw, 1.5, col, 0, h - 0.75, 0, 40); cyl(2.5, h - 1.5, MAT.woodDark, 0, (h - 1.5) / 2, 0, 16); cyl(10, 1.2, MAT.woodDark, 0, 0.6, 0, 24); }
    else { box(w, 1.5, d, col, 0, h - 0.75, 0); for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box(2.2, h - 1.5, 2.2, MAT.woodDark, sx * (hw - 3), (h - 1.5) / 2, sz * (hd - 3)); }
    for (const [x, z, a] of chairSpots(it)) dChair(s, x, z, a);
  } else if (kind === 'desk') {
    box(w, 1.4, d, col, 0, h - 0.7, 0); box(1.4, h - 1.4, d - 2, MAT.woodDark, -hw + 1, (h - 1.4) / 2, 0); box(1.4, h - 1.4, d - 2, MAT.woodDark, hw - 1, (h - 1.4) / 2, 0);
    box(w - 4, 10, 0.8, MAT.woodDark, 0, h - 7, -hd + 2);
    const cz = hd + 8; cyl(10, 1.2, MAT.metal, 0, 0.6, cz, 16); cyl(1.2, 15, MAT.metal, 0, 8, cz, 10); box(18, 2.5, 18, MAT.fabric, 0, 17, cz); box(18, 17, 2, MAT.fabric, 0, 28, cz + 8);
    box(13, 0.6, 9, MAT.white, 0, h + 0.3, 2); const lid = box(13, 8.5, 0.5, MAT.metal, 0, h + 4.5, -2.6); lid.rotation.x = -0.25;
  } else if (kind === 'tv') {
    const scrW = it.screen || w, scrH = it.mount === 'wall' ? h : scrW * 0.574;
    if (it.mount === 'wall') {
      box(10, 8, 1.2, MAT.metal, 0, it.elev + h / 2, -hd + 0.6);
      box(scrW, scrH, 2.2, MAT.screen, 0, it.elev + h / 2, -hd + 1.2 + 1.1, { roughness: 0.35 });
      box(scrW - 1.2, scrH - 1.2, 0.2, 0x161b24, 0, it.elev + h / 2, -hd + 2.3 + 0.1, { roughness: 0.15, metalness: 0.2 });
    } else {
      box(w, h - 2, d, col, 0, (h - 2) / 2 + 2, 0); for (const sx of [-1, 1]) box(1.5, 2, d - 2, MAT.metal, sx * (hw - 3), 1, 0);
      box(10, 1, 8, MAT.metal, 0, h + 0.5, 0); box(2, 3, 1, MAT.metal, 0, h + 2.5, 0);
      box(scrW, scrH, 2, MAT.screen, 0, h + 3 + scrH / 2, 0, { roughness: 0.35 });
      box(scrW - 1.2, scrH - 1.2, 0.2, 0x161b24, 0, h + 3 + scrH / 2, 1.1, { roughness: 0.15, metalness: 0.2 });
    }
  } else if (kind === 'ac') {
    box(w, h, d, MAT.ac, 0, h / 2, 0); box(w - 4, h * 0.5, 0.6, 0x9a8f7c, 0, h * 0.62, hd + 0.2);
    for (let i = 0; i < 5; i++) box(w - 8, 0.5, 0.7, 0x7d7362, 0, h * 0.42 + i * h * 0.1, hd + 0.4);
  } else box(w, h, d, col, 0, h / 2, 0);
  // status decal and outline on the floor
  const decal = new THREE.Mesh(new THREE.PlaneGeometry(w + 2, d + 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
  decal.rotation.x = -Math.PI / 2; decal.position.y = 0.35; decal.name = 'decal'; decal.visible = false; s.add(decal);
  const ol = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([[-hw - 1, -hd - 1], [hw + 1, -hd - 1], [hw + 1, hd + 1], [-hw - 1, hd + 1]].map(([x, z]) => new THREE.Vector3(x, 0.6, z))), new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true }));
  ol.name = 'outline'; ol.visible = false; ol.renderOrder = 6; s.add(ol);
  s.traverse((o) => { o.userData.itemId = it.id; });
  return g;
}
/** Chair positions [x, z, angle] in the table's local frame (inches, +z = front). */
export function chairSpots(it) {
  const hw = it.w / 2, hd = it.d / 2, out = [], off = 7;
  if (it.base.round) return [[0, hd + off, Math.PI], [0, -hd - off, 0], [hw + off, 0, -Math.PI / 2], [-hw - off, 0, Math.PI / 2]];
  const n = Math.max(1, Math.floor(it.w / 24));
  for (let i = 0; i < n; i++) { const x = -hw + (it.w * (i + 0.5)) / n; out.push([x, hd + off, Math.PI], [x, -hd - off, 0]); }
  if (it.base.chairs === 'all') out.push([hw + off, 0, -Math.PI / 2], [-hw - off, 0, Math.PI / 2]);
  return out;
}
function dChair(s, x, z, a) {
  const c = new THREE.Group(); c.position.set(x, 0, z); c.rotation.y = a; s.add(c);
  const add = (w, h, d, col, px, py, pz) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), std(col)); m.position.set(px, py, pz); m.castShadow = true; m.receiveShadow = true; c.add(m); };
  add(17, 1.6, 17, MAT.fabric, 0, 17.5, 0); add(17, 15, 1.6, MAT.fabric, 0, 26, -8);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) add(1.4, 17, 1.4, MAT.woodDark, sx * 7.5, 8.5, sz * 7.5);
}

// ------------------------------------------------------------------ overlays
const GRADE_COL = () => ({ clear: colors.good, tight: colors.warn, blocked: colors.bad });
/** zones: [{poly, grade}], gaps: [{from, to, d}], sights: [{from, to, label}], flash: poly */
export function setOverlay({ zones = [], gaps = [], sights = [], flash = null, swings = [] } = {}) {
  clear(overlay);
  const gc = GRADE_COL();
  for (const z of zones) {
    const shape = new THREE.Shape(z.poly.map(([x, y]) => new THREE.Vector2(x * M, y * M))), g = new THREE.ShapeGeometry(shape); g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: gc[z.grade] || colors.good, transparent: true, opacity: z.grade === 'clear' ? 0.16 : 0.26, depthWrite: false }));
    m.position.y = 0.3 * M + 0.002; m.renderOrder = 3; overlay.add(m);
  }
  for (const s of swings) {
    const shape = new THREE.Shape(s.map(([x, y]) => new THREE.Vector2(x * M, y * M))), g = new THREE.ShapeGeometry(shape); g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: colors.cap, transparent: true, opacity: colors.dark ? 0.1 : 0.06, depthWrite: false })); m.position.y = 0.004; overlay.add(m);
  }
  for (const gp of gaps) {
    if (gp.d < 0.75) continue;
    const a = W(gp.from[0], gp.from[1], 6), b = W(gp.to[0], gp.to[1], 6);
    const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), new THREE.LineBasicMaterial({ color: colors.accent, depthTest: false })); l.renderOrder = 8; overlay.add(l);
    overlay.add(sprite(fmtIn(gp.d), a.clone().lerp(b, 0.5).setY(10 * M), colors.accent));
  }
  for (const sl of sights) {
    const a = W(sl.from[0], sl.from[1], 38), b = W(sl.to[0], sl.to[1], 38);
    const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), new THREE.LineDashedMaterial({ color: colors.sun, dashSize: 0.12, gapSize: 0.08, depthTest: false }));
    l.computeLineDistances(); l.renderOrder = 8; overlay.add(l);
    if (sl.label) overlay.add(sprite(sl.label, a.clone().lerp(b, 0.62).setY(44 * M), colors.sun, true));
  }
  if (flash) {
    const shape = new THREE.Shape(flash.map(([x, y]) => new THREE.Vector2(x * M, y * M))), g = new THREE.ShapeGeometry(shape); g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: colors.bad, transparent: true, opacity: 0.45, depthWrite: false, depthTest: false })); m.position.y = 0.01; m.renderOrder = 9; overlay.add(m);
  }
  dirty = true;
}
function sprite(text, pos, bg, darkText = false) {
  const c = document.createElement('canvas'), g = c.getContext('2d'), px = 30;
  g.font = `600 ${px}px "Geist Mono", ui-monospace, monospace`; const w = Math.ceil(g.measureText(text).width) + 22; c.width = w; c.height = px + 16;
  g.fillStyle = `#${bg.getHexString()}`; g.beginPath(); g.roundRect(0, 0, c.width, c.height, 9); g.fill();
  g.fillStyle = darkText || !colors.dark ? '#ffffff' : '#0b0d1f'; if (darkText) g.fillStyle = '#1b1200';
  g.font = `600 ${px}px "Geist Mono", ui-monospace, monospace`; g.textBaseline = 'middle'; g.fillText(text, 11, c.height / 2 + 1);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true, sizeAttenuation: false }));
  const k = 0.022; sp.scale.set(k * c.width / c.height, k, 1); sp.position.copy(pos); sp.renderOrder = 10; return sp;
}

// ------------------------------------------------------------------ picking
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
function setRay(e) { const r = canvas.getBoundingClientRect(); ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, cam); }
export function pick(e) {
  setRay(e);
  const hits = ray.intersectObjects([...groups.values()].filter((g) => g.visible), true).filter((h) => h.object.isMesh && h.object.name !== 'decal');
  return hits[0]?.object.userData.itemId || null;
}
/** Plan point (inches) under the pointer on the floor plane, or null. */
export function floorPoint(e, h = 0) {
  setRay(e); floor.constant = -h * M; const p = new THREE.Vector3();
  return ray.ray.intersectPlane(floor, p) ? [p.x / M, -p.z / M] : null;
}
export function setOrbitEnabled(on) { controls.enabled = on && rig.mode === 'orbit'; }

// ------------------------------------------------------------------ cameras
/**
 * Camera presets. 'bird' and 'top' orbit; 'eye' looks from a point at eye height toward a direction.
 * @param {string} v view name
 * @param {object} [eye] {at:[x,y], dir:[dx,dy], h: inches, pitch}
 */
export function setView(v, eye) {
  rig.view = v;
  const b = model.bounds, cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, span = Math.max(b.x1 - b.x0, b.y1 - b.y0) * M;
  if (eye) {
    if (rig.mode !== 'eye') rig.prevWall = wallMode;
    rig.mode = 'eye'; controls.enabled = false;
    rig.pos.copy(W(eye.at[0], eye.at[1], eye.h || 62)); rig.yaw = Math.atan2(eye.dir[0], eye.dir[1]); rig.pitch = eye.pitch ?? -0.08;
    cam.fov = 70; cam.updateProjectionMatrix(); if (wallMode !== 'full') setWallMode('full'); applyEye(); return;
  }
  if (rig.mode === 'eye' && rig.prevWall && rig.prevWall !== wallMode) setWallMode(rig.prevWall);
  rig.mode = 'orbit'; controls.enabled = true; cam.fov = 42; cam.updateProjectionMatrix();
  const vf = cam.fov * DEG, hf = 2 * Math.atan(Math.tan(vf / 2) * (cam.aspect || 1.6)), f = Math.min(vf, hf);
  const dist = (span * 0.72) / Math.tan(f / 2);
  if (v === 'top') { cam.position.set(cx * M, dist + model.ceiling * M, -cy * M + 0.001); controls.target.set(cx * M, 0, -cy * M); }
  else { const d = new THREE.Vector3(-0.3, 0.8, 0.6).normalize().multiplyScalar(dist * 0.95); cam.position.set(cx * M + d.x, d.y, -cy * M + d.z); controls.target.set(cx * M, 0, -cy * M); }
  controls.update(); dirty = true;
}
export const currentWallMode = () => wallMode;
export const eyeWallRestore = () => rig.prevWall;
function applyEye() {
  const cp = Math.cos(rig.pitch); cam.position.copy(rig.pos);
  cam.lookAt(rig.pos.x + Math.sin(rig.yaw) * cp, rig.pos.y + Math.sin(rig.pitch), rig.pos.z - Math.cos(rig.yaw) * cp); dirty = true;
}
export function look(dx, dy) { if (rig.mode !== 'eye') return; rig.yaw += dx * 0.005; rig.pitch = Math.max(-1.2, Math.min(1.2, rig.pitch - dy * 0.005)); applyEye(); }
/** Walk forward (inches, negative = back) and turn; stays inside the rooms. */
export function walk(fwd, turn = 0, strafe = 0) {
  if (rig.mode !== 'eye') return;
  rig.yaw += turn;
  const f = [Math.sin(rig.yaw), Math.cos(rig.yaw)], r = [f[1], -f[0]];
  const nx = rig.pos.x / M + f[0] * fwd + r[0] * strafe, ny = -rig.pos.z / M + f[1] * fwd + r[1] * strafe;
  const inside = model.rooms.some((q) => pointInPoly([nx, ny], q.poly)) || model.doorways.some((d) => Math.hypot(nx - d.mid[0], ny - d.mid[1]) < d.len / 2 + 6);
  if (inside) { rig.pos.x = nx * M; rig.pos.z = -ny * M; }
  applyEye();
}
export const eyeState = () => ({ at: [rig.pos.x / M, -rig.pos.z / M], yaw: rig.yaw });

// ------------------------------------------------------------------ export
export function snapshotPNG() { renderer.render(scene, cam); return renderer.domElement.toDataURL('image/png'); }
export async function exportGLB() {
  const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
  const keep = [labels.visible, overlay.visible, proxies.visible, city?.visible]; labels.visible = false; overlay.visible = false; proxies.visible = false; if (city) city.visible = false;
  const ground = shell.getObjectByName('ground'); if (ground) ground.visible = false;
  for (const g of groups.values()) { const d = g.getObjectByName('decal'), o = g.getObjectByName('outline'); if (d) d.userData.v = d.visible, d.visible = false; if (o) o.userData.v = o.visible, o.visible = false; }
  const root = new THREE.Group(); root.name = model.title || model.id || 'apartment';
  const sh = shell.clone(); sh.name = 'shell'; const fu = new THREE.Group(); fu.name = 'furniture';
  for (const g of groups.values()) if (g.visible) { const c = g.clone(); c.userData = { itemId: g.userData.itemId, ref: g.userData.ref, room: g.userData.room || '' }; fu.add(c); }
  root.add(sh, fu);
  const drop = []; root.traverse((o) => { if (o.isLine || o.isSprite || (o.isMesh && !(o.material?.isMeshStandardMaterial || Array.isArray(o.material)))) drop.push(o); });
  for (const o of drop) o.parent?.remove(o);
  try {
    return await new Promise((res, rej) => new GLTFExporter().parse(root, res, rej, { binary: true, onlyVisible: true }));
  } finally {
    labels.visible = keep[0]; overlay.visible = keep[1]; proxies.visible = keep[2]; if (city) city.visible = keep[3] !== false; if (ground) ground.visible = true;
    for (const g of groups.values()) { const d = g.getObjectByName('decal'), o = g.getObjectByName('outline'); if (d) d.visible = !!d.userData.v; if (o) o.visible = !!o.userData.v; }
    dirty = true;
  }
}
export function setRoomOf(id, room) { const g = groups.get(id); if (g) g.userData.room = room; }
export { footprint, toWorld, axes };
