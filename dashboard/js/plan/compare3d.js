// Side-by-side 3D compare: every plan in one scene at true relative scale, with the same furniture kit
// auto-placed in each (plan/compare.js does the placing), one camera for all, walls cut at 36 in.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildShellInto, buildItem, themeColors, M } from './scene3d.js';

const DEG = Math.PI / 180, GAP = 72; // inches between plans
let R = null; // {renderer, scene, cam, controls, stage, ro, raf, root}

function textSprite(lines, C) {
  const c = document.createElement('canvas'); c.width = 900; c.height = 180; const g = c.getContext('2d');
  g.fillStyle = C.dark ? 'rgba(238,241,246,.95)' : 'rgba(18,21,28,.88)'; g.font = '600 64px Geist, system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(lines[0], 450, 62);
  if (lines[1]) { g.fillStyle = C.dark ? 'rgba(238,241,246,.62)' : 'rgba(18,21,28,.55)'; g.font = '500 44px "Geist Mono", ui-monospace, monospace'; g.fillText(lines[1], 450, 136); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.2), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, toneMapped: false }));
  m.rotation.x = -Math.PI / 2; return m;
}

/** Stop rendering and free the GPU resources of the compare scene. */
export function dispose3D() {
  if (!R) return;
  cancelAnimationFrame(R.raf); R.ro.disconnect(); R.controls.dispose();
  R.scene.traverse((o) => { o.geometry?.dispose(); (Array.isArray(o.material) ? o.material : o.material ? [o.material] : []).forEach((m) => { if (m.map && !m.map.userData?.shared) m.map.dispose(); m.dispose(); }); });
  R.renderer.dispose(); R = null;
}

/**
 * Render the plans side by side into `stage` (a sized element holding a canvas).
 * @param {HTMLElement} stage
 * @param {{name: string, model: object, items: object[], sub?: string}[]} plans resolved items in each plan's frame
 */
export function render3D(stage, plans) {
  dispose3D();
  const canvas = document.createElement('canvas'); stage.querySelector('canvas')?.remove(); stage.prepend(canvas);
  const C = themeColors();
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2)); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
  const scene = new THREE.Scene(); scene.background = C.bg.clone();
  const cam = new THREE.PerspectiveCamera(36, 2, 0.05, 600);
  const controls = new OrbitControls(cam, canvas); controls.maxPolarAngle = Math.PI * 0.49; controls.enableDamping = false;
  scene.add(new THREE.HemisphereLight(0xf2f4f8, 0x8a7a68, C.hemiDay)); scene.add(new THREE.AmbientLight(0xfff3e6, 0.4));
  const sun = new THREE.DirectionalLight(0xfff1d6, 2.2); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004; scene.add(sun); scene.add(sun.target);
  const root = new THREE.Group(); scene.add(root);
  let cursor = 0, maxD = 0;
  for (const p of plans) {
    const b = p.model.bounds, w = b.x1 - b.x0, d = b.y1 - b.y0, cy = (b.y0 + b.y1) / 2;
    const g = new THREE.Group(); g.name = p.name; g.position.set((cursor - b.x0) * M, 0, cy * M); root.add(g);
    const shell = new THREE.Group(), labels = new THREE.Group(); g.add(shell, labels);
    buildShellInto({ shell, labels, proxies: null }, p.model, C, 'cut', { ground: false, grid: false });
    for (const it of p.items) { if (it.hidden) continue; const m = buildItem(it, { ceiling: p.model.ceiling }); m.position.set(it.x * M, 0, -it.y * M); m.rotation.y = -it.rot * DEG; g.add(m); }
    const t = textSprite([p.name, p.sub || ''], C); const tw = Math.min(w, 220) * M; t.scale.set(tw, tw, 1); t.position.set((b.x0 + w / 2) * M, 0.02, -(b.y0 - 34) * M); g.add(t);
    cursor += w + GAP; maxD = Math.max(maxD, d);
  }
  const total = (cursor - GAP) * M, mid = new THREE.Vector3(total / 2, 0, 0);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(total * 3 + 60, maxD * M * 3 + 60), new THREE.MeshStandardMaterial({ color: C.ground, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.position.set(mid.x, -0.02, 0); ground.receiveShadow = true; scene.add(ground);
  sun.target.position.copy(mid); sun.position.copy(mid).add(new THREE.Vector3(-8, 20, 10));
  const span = Math.max(total, maxD * M) * 0.62; Object.assign(sun.shadow.camera, { left: -span, right: span, top: span, bottom: -span, near: 1, far: 80 }); sun.shadow.camera.updateProjectionMatrix();
  R = { renderer, scene, cam, controls, stage, root, mid: mid.clone().setZ(36 * M), total, depth: (maxD + 60) * M, dirty: true, raf: 0 }; // room for the name labels in front
  controls.addEventListener('change', () => { R.dirty = true; });
  const size = () => { const w = stage.clientWidth, h = stage.clientHeight; if (!w || !h) return; renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); R.dirty = true; };
  R.ro = new ResizeObserver(size); R.ro.observe(stage); size();
  view3D('angle');
  const loop = () => { R.raf = requestAnimationFrame(loop); if (R.dirty && stage.isConnected) { R.dirty = false; renderer.render(scene, cam); } if (!stage.isConnected) dispose3D(); };
  loop();
}

/** 'angle' (three-quarter view of the whole row) or 'top'. */
export function view3D(v) {
  if (!R) return;
  const { cam, controls, mid, total, depth } = R, f = (cam.fov * DEG) / 2;
  const fitW = total / 2 / Math.tan(f) / cam.aspect, fitD = depth / 2 / Math.tan(f), dist = Math.max(fitW, fitD) * 0.92;
  if (v === 'top') cam.position.set(mid.x, dist + 2.5, 0.001);
  else cam.position.copy(mid).add(new THREE.Vector3(0, 0.75, 0.66).normalize().multiplyScalar(dist * 1.05));
  controls.target.copy(mid); controls.update(); R.dirty = true;
}
export function snapshot3D() { if (!R) return null; R.renderer.render(R.scene, R.cam); return R.renderer.domElement.toDataURL('image/png'); }
