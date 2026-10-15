// three.js side of the Floor plan studio: the shell (floors, walls with cuts, glass, doors, fixtures),
// furniture meshes, overlays (clearance zones, dimension lines, sightlines, walking routes), lighting (the
// real sun, sky glow through each window, and warm lamps for evening and night) and the cameras (bird, top,
// eye level from the bed / sofa / door, walk with held keys and furniture collision, and a guided walk
// along an access route).
// Plan coordinates are inches with +y toward the top of the drawing; the world is metres with
// world x = plan x and world z = -plan y.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { MAT, LAMP_K } from './catalog.js';
import { axes, footprint, toWorld, swingPoly } from './checks.js';
import { pointInPoly, fmtIn } from './model.js';
import { applySurfaceTint, setSurfaceState } from './surfaces3d.js';   // [feature J] reflectance -> colours
import * as I3 from './interior3d.js';   // [interior] reveals, sills, casings, framed glass, door frames, baseboards, ceiling trims, floor finishes
import * as SKY from './sky3d.js';   // [interior] the sky and haze behind the city in eye-level views
import * as F3 from './furniture3d.js';   // [interior] low-poly furniture models
import * as R3F from '../room3d/furniture.js';   // [room3d] the shared, refined furniture models (tried first)
import { roomQuality, onRoomQuality } from '../room3d/quality.js';
import { ROOM_HEX } from '../room3d/palette.js';   // [room3d] one paint and floor for both engines
import { roomLightState, moodFor, applyRoomLight, windowGlowLights } from '../room3d/lighting.js';   // [room3d] one light for both engines

export const M = 0.0254;
const DEG = Math.PI / 180;
const W = (x, y, h = 0) => new THREE.Vector3(x * M, h * M, -y * M);
const CUT = { full: null, cut: 36, outline: 1.5 };

let renderer, scene, cam, controls, canvas, stage, sunL, hemi, amb;
let shell, proxies, furn, overlay, labels, glow;
let model = null, colors = null, wallMode = 'cut', dirty = true;
const groups = new Map();
const rig = { mode: 'orbit', view: 'bird', pos: new THREE.Vector3(), yaw: 0, pitch: 0, prevWall: null, fov: 70 };
// lighting mood: 'auto' follows the sun (day when it is up, night when it is down)
const mood = { want: 'auto', sunUp: true, now: 'day' };
let glide = null, tourS = null;

export const markDirty = () => { dirty = true; };
// [feature J] hooks for lighting, surfaces and render quality (plan/lighting3d.js, plan/quality3d.js)
const moodHooks = [];
/** Call fn(moodNow) after every lighting mood update ('day' | 'evening' | 'night'). */
export const onMood = (fn) => { moodHooks.push(fn); };
/** The three.js parts the lighting and quality modules add to. */
export const parts = () => ({ renderer, scene, cam, controls, sunL, hemi, amb, shell, furn, overlay, rig, mood });
/** Reflectances {floor, walls, ceiling} for the room colours (a visual preview), or null for the built-in look. */
export function setSurfaces(rho) { if (setSurfaceState(rho) && model) { colors = applySurfaceTint(themeColors()); texCache.clear(); buildShell(); dirty = true; } }
export const getCamera = () => cam;
export const viewMode = () => rig.mode;

function tok(name, fb) { const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim(); return new THREE.Color(v || fb); }
export function themeColors() {
  const dark = document.documentElement.dataset.theme !== 'light';
  const ink = tok('--ink', '#eef1f6'), s1 = tok('--surface-1', '#0e1015'), s2 = tok('--surface-2', '#13161d'), s3 = tok('--surface-3', '#1a1e27');
  const bg = (dark ? s2 : s3).clone();
  return {
    dark, bg, night: bg.clone().lerp(new THREE.Color(0x000000), dark ? 0.45 : 0.55),
    ground: bg.clone().lerp(ink, dark ? 0.03 : -0.02),
    // [room3d] interior paint: bright white walls and ceiling, white trim, a light oak floor in both themes (room3d/palette.js), so the room reads as a room, not as UI chrome
    wall: new THREE.Color(ROOM_HEX.wall), ceiling: new THREE.Color(ROOM_HEX.ceiling),
    cap: dark ? tok('--ground', '#08090c') : tok('--ink-2', '#4b5261'),
    fixture: new THREE.Color(ROOM_HEX.fixture),
    wood: new THREE.Color(ROOM_HEX.wood), tile: new THREE.Color(ROOM_HEX.tile), carpet: new THREE.Color(ROOM_HEX.carpet),
    label: dark ? 'rgba(18,20,26,.78)' : 'rgba(18,21,28,.62)', label2: dark ? 'rgba(18,20,26,.55)' : 'rgba(18,21,28,.42)',
    accent: tok('--accent', '#8b96ff'), good: tok('--good', '#4fd19a'), warn: tok('--warn', '#f0b04c'), bad: tok('--bad', '#f2735f'), sun: tok('--sun', '#f5b547'),
    hemiDay: dark ? 1.25 : 1.6, hemiNight: dark ? 0.55 : 0.8,
  };
}
const FLOOR_OF = { kitchen: 'tile', bath: 'tile', closet: 'carpet', outdoor: 'tile' };

// ------------------------------------------------------------------ procedural textures (no image files)
const texCache = new Map();
function seeded(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
/** Canvas textures for floors and fabric, tiled in metres (ShapeGeometry UVs are world metres). */
export function texture(kind, base) {
  const key = `${kind}|${base.getHexString()}`; if (texCache.has(key)) return texCache.get(key);
  const c = document.createElement('canvas'), N = 512; c.width = c.height = N; const g = c.getContext('2d'), rnd = seeded(kind.length * 977 + 13);
  const col = (k, a = 1) => { const x = base.clone().multiplyScalar(k); return `rgba(${Math.min(255, x.r * 255) | 0},${Math.min(255, x.g * 255) | 0},${Math.min(255, x.b * 255) | 0},${a})`; };
  let size = 1.22;
  if (kind === 'wood') { // 5 in planks with staggered butt joints and soft grain
    const rows = 10, h = N / rows;
    for (let r = 0; r < rows; r++) {
      let x = -rnd() * N * 0.6;
      while (x < N) { const L = N * (0.45 + rnd() * 0.5); g.fillStyle = col(0.9 + rnd() * 0.14); g.fillRect(x, r * h, L, h);
        for (let k = 0; k < 7; k++) { g.strokeStyle = col(0.84 + rnd() * 0.1, 0.22); g.lineWidth = 1 + rnd(); g.beginPath(); const y = r * h + rnd() * h; g.moveTo(x, y); g.bezierCurveTo(x + L * 0.3, y + (rnd() - 0.5) * 6, x + L * 0.7, y + (rnd() - 0.5) * 6, x + L, y); g.stroke(); }
        g.fillStyle = col(0.62, 0.55); g.fillRect(x, r * h, 1.5, h); x += L; }
      g.fillStyle = col(0.6, 0.6); g.fillRect(0, r * h, N, 1.4);
    }
    size = 1.27; // 10 planks of 5 in
  } else if (kind === 'tile') { // 12 in tiles with grout
    g.fillStyle = col(1); g.fillRect(0, 0, N, N); const n = 4, s = N / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { g.fillStyle = col(0.95 + rnd() * 0.08); g.fillRect(i * s + 2, j * s + 2, s - 4, s - 4); }
    g.strokeStyle = col(0.72); g.lineWidth = 3; for (let i = 0; i <= n; i++) { g.beginPath(); g.moveTo(i * s, 0); g.lineTo(i * s, N); g.stroke(); g.beginPath(); g.moveTo(0, i * s); g.lineTo(N, i * s); g.stroke(); }
    size = 1.22;
  } else { // carpet / fabric: fine noise
    g.fillStyle = col(1); g.fillRect(0, 0, N, N); const im = g.getImageData(0, 0, N, N);
    for (let i = 0; i < im.data.length; i += 4) { const k = 0.9 + rnd() * 0.18; im.data[i] *= k; im.data[i + 1] *= k; im.data[i + 2] *= k; }
    g.putImageData(im, 0, 0); size = 0.5;
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1 / size, 1 / size); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  t.userData.shared = true; texCache.set(key, t); return t;
}

// ------------------------------------------------------------------ renderer
export function init(canvasEl, stageEl, onChange) {
  canvas = canvasEl; stage = stageEl;
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
  RectAreaLightUniformsLib.init();
  scene = new THREE.Scene();
  cam = new THREE.PerspectiveCamera(42, 1.6, 0.05, 400);
  controls = new OrbitControls(cam, canvas);
  controls.enableDamping = false; controls.maxPolarAngle = Math.PI * 0.495; controls.minDistance = 1.5; controls.maxDistance = 60;
  controls.addEventListener('change', () => { dirty = true; onChange?.(); });
  controls.addEventListener('start', () => { glide = null; });
  hemi = new THREE.HemisphereLight(0xf2f4f8, 0x8a7a68, 2); scene.add(hemi);
  amb = new THREE.AmbientLight(0xfff3e6, 0.55); scene.add(amb);
  sunL = new THREE.DirectionalLight(0xfff1d6, 6); sunL.castShadow = true; sunL.shadow.mapSize.set(2048, 2048);
  sunL.shadow.bias = -0.0004; sunL.shadow.normalBias = 0.025; sunL.shadow.radius = 3;
  scene.add(sunL); scene.add(sunL.target);
  for (const n of ['shell', 'proxies', 'furn', 'overlay', 'labels', 'glow']) { const g = new THREE.Group(); g.name = n; scene.add(g); }
  [shell, proxies, furn, overlay, labels, glow] = ['shell', 'proxies', 'furn', 'overlay', 'labels', 'glow'].map((n) => scene.getObjectByName(n));
  for (const o of SKY.objects()) { o.visible = false; scene.add(o); }   // [interior] sky dome and sun glow, shown in eye-level views
  new ResizeObserver(resize).observe(stage);
}
export function resize() {
  if (!renderer) return; const w = stage.clientWidth, h = stage.clientHeight; if (!w || !h) return;
  renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); dirty = true;
}
/** Draw when something changed; also advances camera glides and the guided walk. */
export function render(force = false) {
  if (!renderer) return false;
  const now = performance.now();
  if (glide) stepGlide(now);
  if (tourS) stepTour(now);
  if (!dirty && !force) return false;
  dirty = false; SKY.follow(cam.position); renderer.render(scene, cam); return true;
}

function clear(g) {
  while (g.children.length) {
    const c = g.children.pop();
    c.traverse((o) => { o.geometry?.dispose(); const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : []; for (const m of ms) { if (m.map && !m.map.userData?.shared) m.map.dispose(); if (!m.userData.shared) m.dispose(); } o.dispose?.(); });
  }
}
const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...o });

// ------------------------------------------------------------------ shell
export function setModel(m) { model = m; colors = applySurfaceTint(themeColors()); buildShell(); frameLights(); }
export function setWallMode(m) { wallMode = m; if (model) buildShell(); }
export function retheme() { colors = applySurfaceTint(themeColors()); texCache.clear(); if (model) { buildShell(); rebuildAllItems(); } }
let lastItems = [];
let lighting = { ambient: 1, sun: 1, sky: 1 };
// per-window city shade: an invisible shadow caster fills the opening of every window a neighbour blocks
let shades = [], shadeState = [];
export function setWindowShade(blocked = []) {
  shadeState = blocked.slice();
  shades.forEach((m, i) => { m.visible = !!shadeState[i]; });
  applyMood(); dirty = true;
}
// "City outside": the neighbouring buildings around the apartment (plan/citymesh.js), drawn only
let city = null;
export function setCity(group) {
  if (city) { scene.remove(city); city.traverse((o) => { o.geometry?.dispose(); o.material?.dispose?.(); }); }
  city = group || null;
  if (city) { scene.add(city); applyMood(); }   // [city3d] the new city takes the current sun, mood and quality
  cam.far = city ? 12000 : 400; cam.updateProjectionMatrix();   // [city3d] the shared city reaches the horizon (its sky dome is 6 km out)
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
/** [city3d] the city outside follows the sun (the water's light) and the mood (lit windows after dusk, as Unit 3D's). */
function syncCity(now) {
  const api = city?.userData.api; if (!api || !sunL) return;
  const v = sunL.position.clone().sub(sunL.target.position).normalize();
  api.setSun(v, Math.asin(Math.max(-1, Math.min(1, v.y))) / DEG);
  api.setNight(now === 'night' ? 1 : now === 'evening' ? 0.5 : 0);
  api.setQuality(roomQuality());
}
export const hasCity = () => !!city;
/** [city3d] the city outside's handle (setSun, setNight, setQuality, anchorsOf) or null. */
export const cityApi = () => city?.userData.api || null;
export function setLighting(options = {}) {
  if (Number.isFinite(options.ambient)) lighting.ambient = Math.max(0, Math.min(2, options.ambient));
  // glazing x blinds preview: scales the direct-sun patches only (plan/light.js glazingScale)
  if (Number.isFinite(options.sun)) lighting.sun = Math.max(0, Math.min(2, options.sun));
  // light through glass and blinds (0-1) for the sky glow at each window
  if (Number.isFinite(options.through)) lighting.sky = Math.max(0, Math.min(1, options.through / 0.6));
  applyMood(); dirty = true;
}

/**
 * Build a plan's fixed parts into `T` ({shell, proxies, labels} groups). Used by the studio and by the
 * side-by-side compare. Returns the per-window shadow shades.
 */
export function buildShellInto(T, m, C, mode = 'cut', opts = {}) {
  const cut = CUT[mode], H = m.ceiling, out = { shades: [] };
  const b = m.bounds, cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
  if (opts.ground !== false) {
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), std(C.ground, { roughness: 1 }));
    ground.rotation.x = -Math.PI / 2; ground.position.set(cx * M, -0.02, -cy * M); ground.receiveShadow = true; ground.name = 'ground'; ground.visible = !city; T.shell.add(ground);
  }
  for (const r of m.rooms) {
    const shape = new THREE.Shape(r.poly.map(([x, y]) => new THREE.Vector2(x * M, y * M)));
    const g = new THREE.ShapeGeometry(shape); g.rotateX(-Math.PI / 2);
    const fk = r.kind === 'closet' ? 'carpet' : I3.floorKind(r), base = fk === 'carpet' ? C.carpet : I3.floorBase(fk, C);   // [interior] parquet, oak or tile by room type
    const mat = std(0xffffff, { roughness: fk === 'carpet' ? 0.95 : I3.floorRoughness(fk), map: fk === 'carpet' ? texture('carpet', base) : I3.floorTexture(fk, base) });
    const mm = new THREE.Mesh(g, mat); mm.position.y = 0.001; mm.receiveShadow = true; mm.name = `floor: ${r.name}`; T.shell.add(mm);
    if (cut == null) { // ceiling: faces down, so it is culled from above and only seen from inside
      const cg = new THREE.ShapeGeometry(new THREE.Shape(r.poly.map(([x, y]) => new THREE.Vector2(x * M, -y * M)))); cg.rotateX(Math.PI / 2);
      const ce = new THREE.Mesh(cg, std(C.ceiling || C.wall.clone().multiplyScalar(1.04), { roughness: 0.95 })); ce.position.y = H * M - 0.001; ce.name = `ceiling: ${r.name}`; ce.receiveShadow = true; T.shell.add(ce);
    }
    if (opts.grid !== false) floorGrid(T.shell, r, C);
    if (opts.labels !== false) T.labels.add(floorLabel(r, C));
  }
  const wallMat = std(C.wall, { roughness: 0.92 }), capMat = new THREE.MeshBasicMaterial({ color: C.cap });
  const proxyMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
  for (const p of m.pieces) {
    const top = cut == null ? p.z1 : Math.min(p.z1, cut);
    if (top - p.z0 > 0.2) T.shell.add(pieceBox(p, p.z0, top, cut == null ? wallMat : [wallMat, wallMat, capMat, wallMat, wallMat, wallMat], false));
    if (T.proxies) T.proxies.add(pieceBox(p, p.z0, p.z1, proxyMat, true));
  }
  if (T.proxies) {
    const ceil = new THREE.Mesh(new THREE.BoxGeometry((b.x1 - b.x0 + 24) * M, 0.08, (b.y1 - b.y0 + 24) * M), proxyMat);
    ceil.position.set(cx * M, H * M + 0.04, -cy * M); ceil.castShadow = true; T.proxies.add(ceil);
    const shadeMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, side: THREE.DoubleSide });
    m.windows.forEach((w, i) => {
      const s = new THREE.Mesh(new THREE.PlaneGeometry((w.len + 2) * M, (w.head - w.sill + 2) * M), shadeMat);
      s.position.copy(W(w.mid[0], w.mid[1], (w.sill + w.head) / 2)); s.rotation.y = Math.atan2(w.b[1] - w.a[1], w.b[0] - w.a[0]);
      s.castShadow = true; s.visible = !!opts.shadeState?.[i]; s.name = 'window shade'; T.proxies.add(s); out.shades.push(s);
    });
  }
  // [interior] window reveals, sills, casings, framed glass with a soft reflection, door frames, baseboards and ceiling trims
  T.shell.add(I3.detailGroup(m, { cut, dark: C.dark, sheen: opts.sheen !== false, skipCans: opts.skipCans }));
  if (cut != null) for (const w of m.windows) {   // the section line over each opening in a cut-away view
    const top = Math.min(w.head, cut); if (top <= w.sill + 0.5) continue;
    T.shell.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([W(w.a[0], w.a[1], top + 0.3), W(w.b[0], w.b[1], top + 0.3)]), new THREE.LineBasicMaterial({ color: C.cap })));
  }
  const leafMat = std(C.wall.clone().lerp(new THREE.Color(0x8a7560), 0.25), { roughness: 0.6 }), arcMat = new THREE.LineDashedMaterial({ color: C.cap, dashSize: 0.06, gapSize: 0.05, transparent: true, opacity: 0.55 });
  for (const d of m.doorways) {
    if (!d.swingDir) continue;
    const leafH = cut == null ? Math.min(d.head, H) : Math.min(d.head, cut), L = d.leaf;
    const c = [d.hingePt[0] + d.swingDir[0] * L / 2, d.hingePt[1] + d.swingDir[1] * L / 2];
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(L * M, leafH * M, 1.4 * M), leafMat);
    leaf.position.copy(W(c[0], c[1], leafH / 2)); leaf.rotation.y = Math.atan2(d.swingDir[1], d.swingDir[0]); leaf.castShadow = true; leaf.receiveShadow = true; T.shell.add(leaf);
    const sw = swingPoly(d, 16).slice(1), line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(sw.map(([x, y]) => W(x, y, 0.4))), arcMat);
    line.computeLineDistances(); T.shell.add(line);
  }
  for (const f of m.fixtures) {
    const top = cut == null || f.kind === 'ac' || f.kind === 'ptac' || f.kind === 'radiator' || f.height <= 48 ? f.elev + f.height : Math.min(f.elev + f.height, Math.max(cut, f.elev + 6));
    if (top - f.elev < 0.2) continue;
    if (f.kind === 'radiator') { radiatorFixture(T.shell, f, top); continue; }
    const shape = new THREE.Shape(f.poly.map(([x, y]) => new THREE.Vector2(x * M, y * M)));
    const g = new THREE.ExtrudeGeometry(shape, { depth: (top - f.elev) * M, bevelEnabled: false }); g.rotateX(-Math.PI / 2);
    const col = f.kind === 'ac' || f.kind === 'ptac' ? new THREE.Color(MAT.ac) : C.fixture;
    const mats = cut != null && f.height > 48 ? [capMat, std(col, { roughness: 0.8 })] : std(col, { roughness: f.kind === 'counter' || f.kind === 'island' ? 0.35 : 0.8, transparent: f.est, opacity: f.est ? 0.92 : 1 });
    const mm = new THREE.Mesh(g, mats); mm.position.y = f.elev * M; mm.castShadow = true; mm.receiveShadow = true; mm.name = `fixture: ${f.label || f.kind}`; T.shell.add(mm);
    if (f.kind === 'ac' || f.kind === 'ptac') acGrille(T.shell, f, top);
  }
  return out;
}
function buildShell() {
  clear(shell); clear(proxies); clear(labels);
  scene.background = colors.bg.clone();
  shades = buildShellInto({ shell, proxies, labels }, model, colors, wallMode, { shadeState }).shades;
  buildGlow();
  dirty = true;
}
function pieceBox(p, z0, z1, mat, cast) {
  const dx = p.b[0] - p.a[0], dy = p.b[1] - p.a[1], L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L, h = p.t / 2;
  const s0 = p.capA ? -h : 0, s1 = L + (p.capB ? h : 0), mid = [p.a[0] + ux * (s0 + s1) / 2, p.a[1] + uy * (s0 + s1) / 2];
  const m = new THREE.Mesh(new THREE.BoxGeometry((s1 - s0) * M, (z1 - z0) * M, p.t * M), mat);
  m.position.copy(W(mid[0], mid[1], (z0 + z1) / 2)); m.rotation.y = Math.atan2(dy, dx);
  m.castShadow = cast; m.receiveShadow = !cast; m.name = 'wall'; return m;   // [room3d] named so Unit 3D's Inside camera can step walls aside and ray-test them
}
function fixtureFace(f) {
  const n = f.front; if (!n) return null;
  const xs = f.poly.map((p) => p[0]), ys = f.poly.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  return { n, face: n[0] ? [n[0] > 0 ? x1 : x0, (y0 + y1) / 2] : [(x0 + x1) / 2, n[1] > 0 ? y1 : y0], len: n[0] ? y1 - y0 : x1 - x0, deep: n[0] ? x1 - x0 : y1 - y0 };
}
function acGrille(parent, f, top) {
  const F = fixtureFace(f); if (!F) return;
  const mat = std(0x7d7362, { roughness: 0.6 });
  for (let i = 0; i < 5; i++) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry((F.len - 6) * M, 0.5 * M, 0.6 * M), mat);
    bar.position.copy(W(F.face[0] + F.n[0] * 0.3, F.face[1] + F.n[1] * 0.3, f.elev + (top - f.elev) * (0.42 + i * 0.1))); bar.rotation.y = F.n[0] ? Math.PI / 2 : 0; parent.add(bar);
  }
}
function radiatorFixture(parent, f, top) {
  const F = fixtureFace(f), xs = f.poly.map((p) => p[0]), ys = f.poly.map((p) => p[1]);
  const c = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
  const len = F ? F.len : Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const deep = F ? F.deep : Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const along = F ? (F.n[0] ? Math.PI / 2 : 0) : (Math.max(...xs) - Math.min(...xs) >= Math.max(...ys) - Math.min(...ys) ? 0 : Math.PI / 2);
  const g = new THREE.Group(); g.position.copy(W(c[0], c[1], f.elev)); g.rotation.y = along; parent.add(g);
  radiatorMesh(g, len, deep, top - f.elev, 1);
}
function radiatorMesh(g, len, deep, hgt, scale) {
  const mat = std(MAT.radiator, { roughness: 0.55, metalness: 0.15 }), n = Math.max(4, Math.round(len / 2.5));
  for (let i = 0; i < n; i++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(1.6 * M * scale, (hgt - 3) * M * scale, deep * M * scale), mat);
    fin.position.set((-len / 2 + (len * (i + 0.5)) / n) * M * scale, (3 + (hgt - 3) / 2) * M * scale, 0); fin.castShadow = true; fin.receiveShadow = true; g.add(fin);
  }
  for (const y of [4, hgt - 2]) { const rail = new THREE.Mesh(new THREE.BoxGeometry(len * M * scale, 1.5 * M * scale, deep * 0.5 * M * scale), mat); rail.position.set(0, y * M * scale, 0); g.add(rail); }
}
function floorGrid(parent, r, C) {
  const b = { x0: Math.min(...r.poly.map((p) => p[0])), x1: Math.max(...r.poly.map((p) => p[0])), y0: Math.min(...r.poly.map((p) => p[1])), y1: Math.max(...r.poly.map((p) => p[1])) };
  const pos = [], h = 0.12;
  const scan = (vertical, c) => {
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
  const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: C.cap, transparent: true, opacity: C.dark ? 0.09 : 0.06 })); l.name = 'grid'; parent.add(l);
}
function textCanvas(lines, color, color2) {
  const c = document.createElement('canvas'); c.width = 640; c.height = 200; const g = c.getContext('2d');
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = color; g.font = '600 60px Geist, "Geist Fallback", system-ui, sans-serif'; g.fillText(lines[0], 320, lines[1] ? 70 : 100);
  if (lines[1]) { g.fillStyle = color2; g.font = '500 44px "Geist Mono", ui-monospace, monospace'; g.fillText(lines[1], 320, 140); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
function floorLabel(r, C) {
  const b = { w: Math.max(...r.poly.map((p) => p[0])) - Math.min(...r.poly.map((p) => p[0])), h: Math.max(...r.poly.map((p) => p[1])) - Math.min(...r.poly.map((p) => p[1])) };
  const sub = r.stated || (r.rect ? `${fmtIn(b.h)} × ${fmtIn(b.w)}` : `${Math.round(r.sqft)} ft²`);
  const t = textCanvas([r.name, sub], C.label, C.label2);
  const wIn = Math.min(b.w * 0.8, 72), m = new THREE.Mesh(new THREE.PlaneGeometry(wIn * M, (wIn * 200 / 640) * M), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, toneMapped: false }));
  m.rotation.x = -Math.PI / 2; m.position.copy(W(r.label[0], r.label[1], 0.25)); m.renderOrder = 2; m.name = 'label'; return m;
}

// ------------------------------------------------------------------ lights: sun, sky glow at the windows, lamps
function frameLights() {
  const b = model.bounds, cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, span = Math.max(b.x1 - b.x0, b.y1 - b.y0) * M;
  sunL.target.position.copy(W(cx, cy));
  Object.assign(sunL.shadow.camera, { left: -span, right: span, top: span, bottom: -span, near: 1, far: 150 }); sunL.shadow.camera.updateProjectionMatrix();
}
/** One soft area light per window, facing into its room: the overcast-sky glow that daylight brings in. */
function buildGlow() {
  clear(glow);
  for (const L of windowGlowLights(model, (p) => model.rooms.some((r) => pointInPoly(p, r.poly)))) glow.add(L);   // [room3d]
  applyMood();
}
/** dir: unit vector toward the sun in plan terms {x, y, up}; on: direct sun reaches the unit. */
export function setSun(dir, on, up) {
  if (!model) return;
  const v = new THREE.Vector3(dir.x, dir.up, -dir.y).normalize();
  sunL.position.copy(sunL.target.position).addScaledVector(v, 60);
  sunL.userData.on = on; sunL.userData.up = Math.max(0, dir.up);
  mood.sunUp = !!up; mood.alt = Math.max(0, dir.up);
  applyMood();
}
/** 'auto' | 'day' | 'evening' | 'night'. Evening and night switch the lamps on. */
export function setMood(m) { mood.want = ['day', 'evening', 'night'].includes(m) ? m : 'auto'; applyMood(); }
export const moodNow = () => mood.now;
function applyMood() {
  if (!sunL || !colors) return;
  const now = mood.want === 'auto' ? (mood.sunUp ? (mood.alt < 0.12 ? 'evening' : 'day') : 'night') : mood.want;
  mood.now = now;
  syncCity(now);
  const day = now === 'day', eve = now === 'evening', night = now === 'night';
  // [room3d] the room's light is one definition for both engines (room3d/lighting.js)
  const st = roomLightState({ mood: now, sunOn: !!sunL.userData.on && mood.sunUp, sinAlt: sunL.userData.up || 0, quality: roomQuality(), scale: { ambient: lighting.ambient, sun: lighting.sun, sky: lighting.sky } });
  applyRoomLight({ sunL, hemi, amb, glow, renderer }, st, (i) => !!shadeState[i]);
  const lampOn = !day;
  for (const [, g] of groups) {
    const l = g.userData.lamp; if (!l) continue;
    l.light.intensity = lampOn ? l.cd * (night ? 1 : 0.75) : 0; l.light.visible = lampOn;
    if (l.shade) { l.shade.material.emissiveIntensity = lampOn ? (night ? 1.4 : 1) : 0; }
  }
  // from inside, the windows look out at a sky (and the haze fades the far city into it); from above, the backdrop stays the dashboard's
  if (scene) {
    if (rig.mode === 'eye') {
      const sd = sunL.position.clone().sub(sunL.target.position), haze = SKY.setMood(now, sd, mood.sunUp);
      SKY.show(true); scene.background = haze.color; scene.fog = new THREE.Fog(haze.color, haze.near, haze.far);
    } else {
      SKY.show(false); scene.fog = null;
      scene.background = (day ? colors.bg : eve ? colors.bg.clone().lerp(colors.night, 0.5) : colors.night).clone();
    }
  }
  for (const f of moodHooks) f(now);   // [feature J] lamps, quality mode
  dirty = true;
}

// ------------------------------------------------------------------ furniture
export function setItems(items) { lastItems = items; const ids = new Set(items.map((i) => i.id)); for (const [id, g] of groups) if (!ids.has(id)) { furn.remove(g); disposeGroup(g); groups.delete(id); } for (const it of items) syncItem(it, true); applyMood(); dirty = true; }
function disposeGroup(g) { g.traverse((o) => { o.geometry?.dispose(); if (o.material && !o.material.userData?.shared) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { if (m.map && !m.map.userData?.shared) m.map.dispose(); m.dispose(); }); o.dispose?.(); }); }
onRoomQuality(() => { if (typeof rebuildAllItems === 'function' && groups.size) rebuildAllItems(); });   // [room3d] the furniture models are simpler in Fast, richer in Visual
function rebuildAllItems() { for (const [, g] of groups) { furn.remove(g); disposeGroup(g); } groups.clear(); setItems(lastItems); }
const sigOf = (it) => `${it.ref}|${it.w}|${it.d}|${it.h}|${it.elev}|${it.variant || ''}|${it.product || ''}|${it.look ? JSON.stringify(it.look) : ''}`;
/** Update an item's transform, rebuilding its meshes when its shape changed. */
export function syncItem(it, rebuild = false) {
  let g = groups.get(it.id);
  const sig = sigOf(it);
  if (!g || g.userData.sig !== sig) { if (g) { furn.remove(g); disposeGroup(g); } g = buildItem(it, { ceiling: model?.ceiling }); g.userData.sig = sig; groups.set(it.id, g); furn.add(g); }
  g.position.copy(W(it.x, it.y)); g.rotation.y = -it.rot * DEG; g.visible = !it.hidden;
  g.name = `${it.name} (${it.ref})`; g.userData.itemId = it.id; g.userData.ref = it.ref; g.userData.product = it.product || '';
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

const fabricMat = (color, o = {}) => std(color, { roughness: 0.95, map: texture('fabric', new THREE.Color(0xffffff)), ...o });
/**
 * Meshes for one resolved item, in a group whose origin is the item's centre on the floor (local inches
 * scaled to metres; local +z = the item's front). Exported for the side-by-side compare.
 */
export function buildItem(it, env = {}) {
  const g = new THREE.Group(), s = new THREE.Group(); s.scale.setScalar(M); g.add(s);
  const mk = (geo, color, x, y, z, o) => { const m = new THREE.Mesh(geo, color?.isMaterial ? color : std(color, o)); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; s.add(m); return m; };
  const box = (w, h, d, color, x, y, z, o) => mk(new THREE.BoxGeometry(w, h, d), color, x, y, z, o);
  const cyl = (r, h, color, x, y, z, seg = 24, r2 = r) => mk(new THREE.CylinderGeometry(r, r2, h, seg), color, x, y, z);
  const { w, d, h, kind } = it, col = it.base?.color ?? 0x8899aa, hw = w / 2, hd = d / 2;
  if (R3F.build(it, { s, std, fabric: fabricMat, quality: roomQuality(), texture }) || F3.build(it, { s, std, fabric: fabricMat })) { /* [interior] drawn by plan/furniture3d.js: rounded cushions, arms, headboards, drawers */ }
  else if (kind === 'bed') {
    const [mw0, md0] = it.productInfo?.mattress || it.base.mattress || [w - 4, d - 4], mw = Math.min(mw0, w - 2), md = Math.min(md0, d - 3);
    const storage = !!it.base.storage, deck = storage ? 14 : 11;
    box(w, h, 3, fabricMat(MAT.fabric), 0, h / 2, -hd + 1.5);
    box(w - 1, deck, d - 3, storage ? fabricMat(MAT.fabric) : MAT.woodDark, 0, deck / 2, 1.5);
    box(mw, 10, md, MAT.linen, 0, deck + 5, 1.5);
    box(mw + 0.6, 2.4, md * 0.64, fabricMat(MAT.duvet), 0, deck + 11.2, 1.5 + md * 0.18);
    for (const sx of [-1, 1]) box(mw / 2 - 5, 5, 15, MAT.pillow, sx * mw / 4, deck + 12.5, -hd + 13);
    if (storage) { // drawer fronts and pulls on the drawer sides
      const sides = it.variant === 'foot' ? ['foot'] : it.variant === 'left' ? ['left'] : it.variant === 'right' ? ['right'] : ['left', 'right'];
      for (const sd of sides) {
        if (sd === 'foot') { for (const sx of [-1, 1]) { box(w / 2 - 4, deck - 4, 0.6, MAT.oak, sx * w / 4, deck / 2, hd + 0.3); box(6, 0.8, 0.8, MAT.metal, sx * w / 4, deck / 2 + 2, hd + 0.9); } continue; }
        const sx = sd === 'left' ? -1 : 1;
        for (const k of [-1, 1]) { box(0.6, deck - 4, d / 2 - 8, MAT.oak, sx * (hw + 0.3), deck / 2, 6 + k * (d / 4 - 1)); box(0.8, 0.8, 6, MAT.metal, sx * (hw + 0.9), deck / 2 + 2, 6 + k * (d / 4 - 1)); }
      }
    }
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
    const flat = it.variant === 'bed', arm = kind === 'chair' ? 5 : 5.5, seatH = flat ? h - 2 : 17, fm = fabricMat(col);
    box(arm, flat ? h : 25, d, fm, -hw + arm / 2, (flat ? h : 25) / 2, 0); box(arm, flat ? h : 25, d, fm, hw - arm / 2, (flat ? h : 25) / 2, 0);
    box(w - 2 * arm, seatH - 5, d - 1, MAT.woodDark, 0, (seatH - 5) / 2, 0);
    if (flat) box(w - 2 * arm, 6, d - 2, fm, 0, seatH - 2, 0.5);
    else { box(w - 2 * arm, 6, d - 10, fm, 0, seatH - 2, 4.5); box(w - 2 * arm, h - 12, 9, fm, 0, 12 + (h - 12) / 2 - 1, -hd + 4.5); }
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
    const cz = hd + 8; cyl(10, 1.2, MAT.metal, 0, 0.6, cz, 16); cyl(1.2, 15, MAT.metal, 0, 8, cz, 10); box(18, 2.5, 18, fabricMat(MAT.fabric), 0, 17, cz); box(18, 17, 2, fabricMat(MAT.fabric), 0, 28, cz + 8);
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
    const e = it.elev || 0;
    box(w, h, d, MAT.ac, 0, e + h / 2, 0); box(w - 4, h * 0.5, 0.6, 0x9a8f7c, 0, e + h * 0.62, hd + 0.2);
    for (let i = 0; i < 5; i++) box(w - 8, 0.5, 0.7, 0x7d7362, 0, e + h * 0.42 + i * h * 0.1, hd + 0.4);
  } else if (kind === 'radiator') {
    const r = new THREE.Group(); s.add(r); r.scale.setScalar(1 / M); radiatorMesh(r, w, d, h, 1);
  } else if (kind === 'rug') {
    const round = it.variant === 'round6' || Math.abs(w - d) < 0.5 && it.variant === 'round6';
    const t = texture('fabric', new THREE.Color(col));
    const rm = std(0xffffff, { map: t, roughness: 1 }), border = std(new THREE.Color(col).multiplyScalar(0.72), { roughness: 1 });
    if (round) { const m1 = cyl(hw, 0.4, border, 0, 0.2, 0, 48); m1.castShadow = false; const m2 = cyl(hw - 4, 0.42, rm, 0, 0.21, 0, 48); m2.castShadow = false; }
    else { const b1 = box(w, 0.4, d, border, 0, 0.2, 0); b1.castShadow = false; const b2 = box(w - 8, 0.42, d - 8, rm, 0, 0.21, 0); b2.castShadow = false; }
  } else if (kind === 'art') {
    const e = it.elev || 0;
    box(w, h, 1.2, MAT.frame, 0, e + h / 2, -hd + 0.6, { roughness: 0.5 });
    const art = new THREE.Mesh(new THREE.PlaneGeometry(w - 3, h - 3), new THREE.MeshStandardMaterial({ map: artTexture(it.id), roughness: 0.9 }));
    art.position.set(0, e + h / 2, -hd + 1.25); s.add(art);
  } else if (kind === 'lamp') {
    lampMesh(g, s, it, env, { box, cyl });
  } else box(w, h, d, col, 0, h / 2, 0);
  // status decal and outline on the floor
  const decal = new THREE.Mesh(new THREE.PlaneGeometry(w + 2, d + 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }));
  decal.rotation.x = -Math.PI / 2; decal.position.y = 0.6; decal.name = 'decal'; decal.visible = false; s.add(decal);
  const ol = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([[-hw - 1, -hd - 1], [hw + 1, -hd - 1], [hw + 1, hd + 1], [-hw - 1, hd + 1]].map(([x, z]) => new THREE.Vector3(x, 0.8, z))), new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, toneMapped: false }));
  ol.name = 'outline'; ol.visible = false; ol.renderOrder = 6; s.add(ol);
  s.traverse((o) => { o.userData.itemId = it.id; });
  return g;
}
function lampMesh(g, s, it, env, { box, cyl }) {
  const { w, h } = it, e = it.elev || 0, type = it.base.lamp, kcol = LAMP_K[it.base.light?.k] ?? LAMP_K[2700];
  const shadeMat = new THREE.MeshStandardMaterial({ color: MAT.shade, roughness: 0.8, emissive: new THREE.Color(kcol), emissiveIntensity: 0, side: THREE.DoubleSide, transparent: true, opacity: 0.94 });
  let shade, at;
  if (type === 'floor') {
    cyl(w / 2, 1, MAT.metal, 0, 0.5, 0, 24); cyl(0.5, h - 12, MAT.metal, 0, (h - 12) / 2, 0, 8);
    shade = cyl(7, 11, shadeMat, 0, h - 6, 0, 28, 8); at = h - 7;
  } else if (type === 'table') {
    cyl(3.5, 8, MAT.brass, 0, e + 4, 0, 20, 4.5); cyl(0.4, 4, MAT.metal, 0, e + 10, 0, 8);
    shade = cyl(4, h - 11, shadeMat, 0, e + 11 + (h - 11) / 2, 0, 24, w / 2); at = e + 13;
  } else if (type === 'pendant') {
    const top = env.ceiling || 108; cyl(0.15, Math.max(1, top - e - h), MAT.metal, 0, (top + e + h) / 2, 0, 6);
    shade = cyl(2, h, shadeMat, 0, e + h / 2, 0, 28, w / 2); at = e + 2;
  } else { // ceiling
    shade = cyl(w / 2, h, shadeMat, 0, e + h / 2, 0, 32, w / 2 - 1); at = e - 1;
  }
  shade.castShadow = false;
  // lumens to candela for an isotropic source (cd = lm / 4π), then a display gain so it reads at room scale
  const cd = (it.base.light?.lm || 800) / (4 * Math.PI) * 0.14;
  const light = new THREE.PointLight(kcol, 0, 0, 2); light.position.set(0, at, 0); light.castShadow = false; light.visible = false; s.add(light);
  g.userData.lamp = { light, shade, cd };
}
const artCache = new Map();
function artTexture(id) {
  if (artCache.has(id)) return artCache.get(id);
  const c = document.createElement('canvas'); c.width = 256; c.height = 192; const g = c.getContext('2d'), rnd = seeded([...id].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7));
  g.fillStyle = '#ece6da'; g.fillRect(0, 0, 256, 192);
  const pal = ['#c46a4a', '#2f4b5e', '#d9a441', '#7a8f7a', '#a9b8c7', '#3c3a36'];
  for (let i = 0; i < 5; i++) { g.fillStyle = pal[Math.floor(rnd() * pal.length)]; g.globalAlpha = 0.85; const x = rnd() * 200, y = rnd() * 140; if (rnd() > 0.5) { g.beginPath(); g.arc(x + 20, y + 20, 14 + rnd() * 40, 0, Math.PI * 2); g.fill(); } else g.fillRect(x, y, 30 + rnd() * 90, 20 + rnd() * 70); }
  g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.userData.shared = true; artCache.set(id, t); return t;
}
/** Chair positions [x, z, angle] in the table's local frame (inches, +z = front). */
F3.setChairSpots((it) => chairSpots(it));
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
const basic = (o) => new THREE.MeshBasicMaterial({ toneMapped: false, ...o });
/** zones: [{poly, grade}], gaps: [{from, to, d}], sights: [{from, to, label}], flash: poly, routes: [{path, grade, pinch, width}] */
export function setOverlay({ zones = [], gaps = [], sights = [], flash = null, swings = [], routes = [] } = {}) {
  clear(overlay);
  const gc = GRADE_COL();
  for (const z of zones) {
    const shape = new THREE.Shape(z.poly.map(([x, y]) => new THREE.Vector2(x * M, y * M))), g = new THREE.ShapeGeometry(shape); g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, basic({ color: gc[z.grade] || colors.good, transparent: true, opacity: z.grade === 'clear' ? 0.16 : 0.26, depthWrite: false }));
    m.position.y = 0.6 * M + 0.002; m.renderOrder = 3; overlay.add(m);
  }
  for (const s of swings) {
    const shape = new THREE.Shape(s.map(([x, y]) => new THREE.Vector2(x * M, y * M))), g = new THREE.ShapeGeometry(shape); g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, basic({ color: colors.cap, transparent: true, opacity: colors.dark ? 0.1 : 0.06, depthWrite: false })); m.position.y = 0.004; overlay.add(m);
  }
  for (const r of routes) {
    if (r.path.length < 2) continue;
    const pts = r.path.map(([x, y]) => W(x, y, 1.2));
    const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.2);
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(16, pts.length * 6), 0.022, 6, false), basic({ color: gc[r.grade], transparent: true, opacity: 0.85, depthWrite: false }));
    tube.renderOrder = 7; overlay.add(tube);
    const end = pts[pts.length - 1], dot = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 12), basic({ color: gc[r.grade] })); dot.position.copy(end); overlay.add(dot);
    if (r.pinch && Number.isFinite(r.width)) overlay.add(sprite(`${Math.round(r.width)} in`, W(r.pinch[0], r.pinch[1], 14), gc[r.grade], r.grade !== 'blocked'));
  }
  for (const gp of gaps) {
    if (gp.d < 0.75) continue;
    const a = W(gp.from[0], gp.from[1], 6), b = W(gp.to[0], gp.to[1], 6);
    const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), new THREE.LineBasicMaterial({ color: colors.accent, depthTest: false, toneMapped: false })); l.renderOrder = 8; overlay.add(l);
    overlay.add(sprite(fmtIn(gp.d), a.clone().lerp(b, 0.5).setY(10 * M), colors.accent));
  }
  for (const sl of sights) {
    const a = W(sl.from[0], sl.from[1], 38), b = W(sl.to[0], sl.to[1], 38);
    const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), new THREE.LineDashedMaterial({ color: colors.sun, dashSize: 0.12, gapSize: 0.08, depthTest: false, toneMapped: false }));
    l.computeLineDistances(); l.renderOrder = 8; overlay.add(l);
    if (sl.label) overlay.add(sprite(sl.label, a.clone().lerp(b, 0.62).setY(44 * M), colors.sun, true));
  }
  if (flash) {
    const shape = new THREE.Shape(flash.map(([x, y]) => new THREE.Vector2(x * M, y * M))), g = new THREE.ShapeGeometry(shape); g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, basic({ color: colors.bad, transparent: true, opacity: 0.45, depthWrite: false, depthTest: false })); m.position.y = 0.01; m.renderOrder = 9; overlay.add(m);
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
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true, sizeAttenuation: false, toneMapped: false }));
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
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
/** Glide the camera from where it is to a pose over `ms`; the look target is interpolated too. */
function glideTo(pos, target, fov, ms = 650, after = null) {
  const from = { pos: cam.position.clone(), target: rig.mode === 'orbit' ? controls.target.clone() : cam.position.clone().add(cam.getWorldDirection(new THREE.Vector3())), fov: cam.fov };
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) ms = 0;
  glide = { t0: performance.now(), ms, from, to: { pos, target, fov }, after }; dirty = true;
}
function stepGlide(now) {
  const g = glide, t = g.ms ? Math.min(1, (now - g.t0) / g.ms) : 1, k = ease(t);
  cam.position.lerpVectors(g.from.pos, g.to.pos, k); const tg = g.from.target.clone().lerp(g.to.target, k);
  cam.fov = g.from.fov + (g.to.fov - g.from.fov) * k; cam.updateProjectionMatrix(); cam.lookAt(tg);
  if (rig.mode === 'orbit') controls.target.copy(tg);
  dirty = true;
  if (t >= 1) { glide = null; if (rig.mode === 'orbit') controls.update(); g.after?.(); }
}
/**
 * Camera presets. 'bird' and 'top' orbit; 'eye' looks from a point at eye height toward a direction.
 * @param {string} v view name
 * @param {object} [eye] {at:[x,y], dir:[dx,dy], h: inches, pitch}
 * @param {{instant?: boolean}} [o]
 */
export function setView(v, eye, o = {}) {
  rig.view = v; tourS = null;
  const b = model.bounds, cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, span = Math.max(b.x1 - b.x0, b.y1 - b.y0) * M;
  const instant = o.instant || !cam.position.lengthSq();
  if (eye) {
    if (rig.mode !== 'eye') rig.prevWall = wallMode;
    rig.mode = 'eye'; controls.enabled = false;
    rig.pos.copy(W(eye.at[0], eye.at[1], eye.h || 62)); rig.yaw = Math.atan2(eye.dir[0], eye.dir[1]); rig.pitch = eye.pitch ?? -0.08;
    if (wallMode !== 'full') setWallMode('full');
    const cp = Math.cos(rig.pitch), tgt = new THREE.Vector3(rig.pos.x + Math.sin(rig.yaw) * cp, rig.pos.y + Math.sin(rig.pitch), rig.pos.z - Math.cos(rig.yaw) * cp);
    rig.fov = eye.fov || 70;
    if (instant) { cam.fov = rig.fov; cam.updateProjectionMatrix(); applyEye(); } else glideTo(rig.pos.clone(), tgt, rig.fov, eye.ms ?? 750, applyEye);
    applyMood(); return;
  }
  if (rig.mode === 'eye' && rig.prevWall && rig.prevWall !== wallMode) setWallMode(rig.prevWall);
  rig.mode = 'orbit'; controls.enabled = true;
  const vf = 42 * DEG, hf = 2 * Math.atan(Math.tan(vf / 2) * (cam.aspect || 1.6)), f = Math.min(vf, hf);
  const dist = (span * 0.72) / Math.tan(f / 2);
  const tgt = new THREE.Vector3(cx * M, 0, -cy * M);
  let pos;
  if (v === 'top') pos = new THREE.Vector3(cx * M, dist + model.ceiling * M, -cy * M + 0.001);
  else { const d = new THREE.Vector3(-0.3, 0.8, 0.6).normalize().multiplyScalar(dist * 0.95); pos = new THREE.Vector3(cx * M + d.x, d.y, -cy * M + d.z); }
  if (instant) { cam.fov = 42; cam.updateProjectionMatrix(); cam.position.copy(pos); controls.target.copy(tgt); controls.update(); dirty = true; }
  else glideTo(pos, tgt, 42, 650);
  applyMood();
}
export const currentWallMode = () => wallMode;
export const eyeWallRestore = () => rig.prevWall;
function applyEye() {
  const cp = Math.cos(rig.pitch); cam.position.copy(rig.pos);
  cam.fov = rig.fov; cam.updateProjectionMatrix();
  cam.lookAt(rig.pos.x + Math.sin(rig.yaw) * cp, rig.pos.y + Math.sin(rig.pitch), rig.pos.z - Math.cos(rig.yaw) * cp); dirty = true;
}
export function look(dx, dy) { if (rig.mode !== 'eye') return; glide = null; tourS = null; rig.yaw += dx * 0.005; rig.pitch = Math.max(-1.2, Math.min(1.2, rig.pitch - dy * 0.005)); applyEye(); }
/** Can a person stand here (plan inches)? Inside a room or a doorway, and not inside furniture lower than 30 in. */
export function canStand(x, y) {
  if (!model) return false;
  const inside = model.rooms.some((q) => pointInPoly([x, y], q.poly)) || model.doorways.some((d) => Math.hypot(x - d.mid[0], y - d.mid[1]) < d.len / 2 + 6);
  if (!inside) return false;
  for (const it of lastItems) {
    if (it.hidden || it.flat || it.elev >= 30 || it.h < 8) continue;
    const fp = footprint({ ...it, w: it.w + 8, d: it.d + 8 });
    if (pointInPoly([x, y], fp)) return false;
  }
  return true;
}
/** Walk forward (inches, negative = back), turn and strafe; stays inside the rooms and out of the furniture. */
export function walk(fwd, turn = 0, strafe = 0) {
  if (rig.mode !== 'eye') return;
  glide = null; tourS = null;
  rig.yaw += turn;
  const f = [Math.sin(rig.yaw), Math.cos(rig.yaw)], r = [f[1], -f[0]];
  const x = rig.pos.x / M, y = -rig.pos.z / M, dx = f[0] * fwd + r[0] * strafe, dy = f[1] * fwd + r[1] * strafe;
  // slide along obstacles: try the full step, then each axis
  for (const [sx, sy] of [[dx, dy], [dx, 0], [0, dy]]) { if ((sx || sy) && canStand(x + sx, y + sy)) { rig.pos.x = (x + sx) * M; rig.pos.z = -(y + sy) * M; break; } }
  applyEye();
}
export const eyeState = () => ({ at: [rig.pos.x / M, -rig.pos.z / M], yaw: rig.yaw });

/** Guided walk at eye height along a plan path (inches), about 2.5 ft a second; looks ahead along the path. */
export function tour(path, { speed = 30, h = 63, onEnd } = {}) {
  if (!model || !path || path.length < 2) return false;
  const pts = path.map(([x, y]) => new THREE.Vector2(x, y)), lens = [0];
  for (let i = 1; i < pts.length; i++) lens.push(lens[i - 1] + pts[i].distanceTo(pts[i - 1]));
  if (rig.mode !== 'eye') rig.prevWall = wallMode;
  rig.mode = 'eye'; rig.view = 'tour'; controls.enabled = false; if (wallMode !== 'full') setWallMode('full');
  glide = null; tourS = { pts, lens, total: lens[lens.length - 1], t0: performance.now() + 200, speed, h, onEnd };
  rig.fov = 70; cam.fov = 70; cam.updateProjectionMatrix(); applyMood(); stepTour(performance.now()); return true;
}
export const touring = () => !!tourS;
export function stopTour() { tourS = null; }
function at(s, d) {
  d = Math.max(0, Math.min(s.total, d)); let i = 1; while (i < s.lens.length - 1 && s.lens[i] < d) i++;
  const a = s.pts[i - 1], b = s.pts[i], t = (d - s.lens[i - 1]) / Math.max(1e-6, s.lens[i] - s.lens[i - 1]); return a.clone().lerp(b, Math.max(0, Math.min(1, t)));
}
function stepTour(now) {
  const s = tourS, d = Math.max(0, (now - s.t0) / 1000) * s.speed, p = at(s, d), ahead = at(s, d + 36);
  const v = ahead.clone().sub(p); if (v.lengthSq() > 1) { const want = Math.atan2(v.x, v.y); let dy = want - rig.yaw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI; rig.yaw += dy * 0.12; }
  rig.pitch += (-0.1 - rig.pitch) * 0.1;
  rig.pos.copy(W(p.x, p.y, s.h)); applyEye();
  if (d >= s.total) { tourS = null; s.onEnd?.(); }
}

// ------------------------------------------------------------------ export
/** PNG of the current view; `scale` > 1 renders off-screen at that multiple of the canvas size (max 4096 px wide). */
export function snapshotPNG(scale = 1) {
  if (scale <= 1) { renderer.render(scene, cam); return renderer.domElement.toDataURL('image/png'); }
  // render the same canvas at a higher pixel ratio for one frame (synchronous, so nothing flashes), then restore
  const pr = renderer.getPixelRatio(), size = renderer.getSize(new THREE.Vector2());
  const k = Math.min(scale, 4096 / Math.max(1, size.x));
  renderer.setPixelRatio(k); renderer.render(scene, cam);
  const url = renderer.domElement.toDataURL('image/png');
  renderer.setPixelRatio(pr); dirty = true; render(true);
  return url;
}
export async function exportGLB() {
  const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
  const keep = [labels.visible, overlay.visible, proxies.visible, city?.visible, glow.visible]; labels.visible = false; overlay.visible = false; proxies.visible = false; glow.visible = false; if (city) city.visible = false;
  const ground = shell.getObjectByName('ground'); if (ground) ground.visible = false;
  for (const g of groups.values()) { const d = g.getObjectByName('decal'), o = g.getObjectByName('outline'); if (d) d.userData.v = d.visible, d.visible = false; if (o) o.userData.v = o.visible, o.visible = false; }
  const root = new THREE.Group(); root.name = model.title || model.id || 'apartment';
  const sh = shell.clone(); sh.name = 'shell'; const fu = new THREE.Group(); fu.name = 'furniture';
  for (const g of groups.values()) if (g.visible) { const c = g.clone(); c.userData = { itemId: g.userData.itemId, ref: g.userData.ref, room: g.userData.room || '', ...(g.userData.product ? { product: g.userData.product } : {}) }; fu.add(c); }
  root.add(sh, fu);
  const drop = []; root.traverse((o) => { if (o.isLine || o.isSprite || o.isLight || (o.isMesh && !(o.material?.isMeshStandardMaterial || Array.isArray(o.material)))) drop.push(o); });
  for (const o of drop) o.parent?.remove(o);
  try {
    return await new Promise((res, rej) => new GLTFExporter().parse(root, res, rej, { binary: true, onlyVisible: true }));
  } finally {
    labels.visible = keep[0]; overlay.visible = keep[1]; proxies.visible = keep[2]; if (city) city.visible = keep[3] !== false; glow.visible = keep[4]; if (ground) ground.visible = true;
    for (const g of groups.values()) { const d = g.getObjectByName('decal'), o = g.getObjectByName('outline'); if (d) d.visible = !!d.userData.v; if (o) o.visible = !!o.userData.v; }
    dirty = true;
  }
}
export function setRoomOf(id, room) { const g = groups.get(id); if (g) g.userData.room = room; }
export { footprint, toWorld, axes };
