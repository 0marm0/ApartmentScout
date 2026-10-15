// Render quality for the Floor plan studio's 3D view: Fast (as before) or Visual (soft shadows from a larger shadow
// map, an environment light, contact shadows under furniture and along the walls), and a progressive high-resolution
// PNG export. A look, not evidence: it changes no number and no modelled sun patch (features/render-quality.js).
import * as THREE from 'three';
import * as G3 from './scene3d.js';
import * as RQ from '../features/render-quality.js';
import { environmentFor, recompileMaterials } from '../features/render-env.js';

const M = 0.0254;
let mode = 'fast', ui = null, prog = null, note = null, noteT = 0, mounted = false, aoRoot = null, getModel = () => null, toastFn = () => {}, store = null, aoTex = null, stripTex = null;

function radial() {
  if (aoTex) return aoTex;
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'), k = g.createRadialGradient(64, 64, 8, 64, 64, 64);
  k.addColorStop(0, 'rgba(0,0,0,0.5)'); k.addColorStop(0.55, 'rgba(0,0,0,0.22)'); k.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = k; g.fillRect(0, 0, 128, 128);
  aoTex = new THREE.CanvasTexture(c); aoTex.colorSpace = THREE.SRGBColorSpace; return aoTex;
}
function strip() {
  if (stripTex) return stripTex;
  const c = document.createElement('canvas'); c.width = 4; c.height = 64; const g = c.getContext('2d'), k = g.createLinearGradient(0, 0, 0, 64);
  k.addColorStop(0, 'rgba(0,0,0,0)'); k.addColorStop(0.5, 'rgba(0,0,0,0.34)'); k.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = k; g.fillRect(0, 0, 4, 64);
  stripTex = new THREE.CanvasTexture(c); stripTex.colorSpace = THREE.SRGBColorSpace; return stripTex;
}

/** Add the Fast / Visual control to the studio's 3D stage. `o` = {stage, model(), toast(msg), store}. */
export function mount(o) {
  if (mounted) return;
  getModel = o.model; toastFn = o.toast; store = o.store; mounted = true;
  mode = RQ.readMode(store);
  ui = RQ.modeControl({ mode, onChange: (m) => setMode(m, true) });
  note = document.createElement('div'); note.className = 'float rnq-note'; note.hidden = true; note.setAttribute('role', 'status');
  o.stage.append(ui.el, note);
  prog = RQ.progressStrip(o.stage);
  G3.onMood(() => { if (mode === 'visual') dimHemi(); });
  if (mode === 'visual') apply();
}
export const current = () => mode;
function dimHemi() { const { hemi } = G3.parts(); hemi.intensity *= 0.62; }

export function setMode(m, announce) {
  mode = m === 'visual' ? 'visual' : 'fast';
  RQ.saveMode(store, mode); ui?.set(mode); apply();
  if (announce && note) { note.hidden = false; note.textContent = `${RQ.MODES[mode].label}: ${RQ.MODES[mode].note}`; clearTimeout(noteT); noteT = setTimeout(() => { note.hidden = true; }, 7000); }
}

function apply() {
  const { renderer, scene, sunL } = G3.parts();
  if (!renderer) return;
  const s = RQ.settingsFor(mode, { phone: RQ.phoneClass(), maxTexture: renderer.capabilities.maxTextureSize, dpr: window.devicePixelRatio });
  renderer.setPixelRatio(s.pixelRatio);
  sunL.shadow.map?.dispose(); sunL.shadow.map = null;
  sunL.shadow.mapSize.set(s.shadowSize, s.shadowSize);
  if (s.softShadows) {
    renderer.shadowMap.type = THREE.VSMShadowMap; sunL.shadow.radius = s.radius; sunL.shadow.blurSamples = s.blurSamples; sunL.shadow.bias = -0.0001; sunL.shadow.normalBias = 0.02;
  } else {
    renderer.shadowMap.type = THREE.PCFSoftShadowMap; sunL.shadow.radius = 3; sunL.shadow.blurSamples = 8; sunL.shadow.bias = -0.0004; sunL.shadow.normalBias = 0.025;
  }
  recompileMaterials(scene);
  scene.environment = s.environment ? environmentFor(renderer, { intensity: 0.35 }) : null;
  rebuildAO(s.contact);
  G3.resize(); G3.setLighting({});   // re-runs the lighting mood so the hemisphere level follows the mode
}

// ------------------------------------------------------------------ contact shadows and wall-base shading (an ambient-occlusion approximation)
function rebuildAO(on = mode === 'visual' && !RQ.phoneClass()) {
  const { scene, furn } = G3.parts();
  if (aoRoot) { scene.remove(aoRoot); aoRoot.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); }); aoRoot = null; }
  if (!on || mode !== 'visual') { G3.markDirty(); return; }
  aoRoot = new THREE.Group(); aoRoot.name = 'quality-ao'; scene.add(aoRoot);
  const box = new THREE.Box3(), size = new THREE.Vector3(), ctr = new THREE.Vector3();
  for (const g of furn.children) {
    if (!g.visible) continue;
    box.setFromObject(g); if (box.isEmpty()) continue;
    box.getSize(size); box.getCenter(ctr);
    if (box.min.y > 0.45 || box.max.y < 0.05 || size.x > 6 || size.z > 6) continue;   // wall-mounted, flat rugs and oversized groups get none
    const pad = 0.22, m = new THREE.Mesh(new THREE.PlaneGeometry(size.x + pad * 2, size.z + pad * 2), new THREE.MeshBasicMaterial({ map: radial(), transparent: true, depthWrite: false, toneMapped: false }));
    m.rotation.x = -Math.PI / 2; m.position.set(ctr.x, 0.0042, ctr.z); m.renderOrder = 1; aoRoot.add(m);
  }
  const model = getModel();
  for (const p of model?.pieces || []) {
    if (p.kind !== 'solid' || p.z0 >= 1) continue;
    const dx = p.b[0] - p.a[0], dy = p.b[1] - p.a[1], L = Math.hypot(dx, dy); if (L < 6) continue;
    const t = p.t * M, w = t + 0.34;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(L * M, w), new THREE.MeshBasicMaterial({ map: strip(), transparent: true, depthWrite: false, toneMapped: false }));
    m.rotation.x = -Math.PI / 2; m.rotation.z = Math.atan2(dy, dx); m.position.set(((p.a[0] + p.b[0]) / 2) * M, 0.0038, -((p.a[1] + p.b[1]) / 2) * M); m.renderOrder = 1; aoRoot.add(m);
  }
  G3.markDirty();
}
let aoRaf = 0;
/** The furniture moved or the plan changed: refresh the contact shadows (once per frame at most). */
export function itemsChanged() { if (mode !== 'visual' || !aoRoot) return; if (aoRaf) return; aoRaf = requestAnimationFrame(() => { aoRaf = 0; rebuildAO(); }); }
export function modelChanged() { if (mode === 'visual') itemsChanged(); }

// ------------------------------------------------------------------ progressive export
/** Render the current 3D view at `scale` x the stage size (capped at 4096 px), averaged over jittered frames. */
export async function renderImage(scale, { name = 'floor-plan', caption = '' } = {}) {
  const { renderer, scene, cam, sunL } = G3.parts();
  const cv = renderer.domElement, w = cv.clientWidth, h = cv.clientHeight; if (!w || !h) return;
  const k = RQ.fitScale(scale, w, h), pr = renderer.getPixelRatio(), frames = 16;
  const signal = prog.start(); prog.show(0, frames, 'Preparing the render…');
  const sunStart = sunL.position.clone(), tgt = sunL.target.position.clone();
  const dir = sunStart.clone().sub(tgt), len = dir.length(), up = new THREE.Vector3(0, 1, 0);
  const side = new THREE.Vector3().crossVectors(dir, up).normalize(), vert = new THREE.Vector3().crossVectors(side, dir).normalize();
  try {
    renderer.setPixelRatio(k);
    const draw = (i) => {
      const [jx, jy] = RQ.jitter(i), [sx, sy] = RQ.sunDisc(i, 0.011);
      cam.setViewOffset(w, h, jx / k, jy / k, w, h);
      sunL.position.copy(tgt).add(dir.clone().addScaledVector(side, sx * len).addScaledVector(vert, sy * len).setLength(len));
      renderer.render(scene, cam);
    };
    const { canvas, frames: done } = await RQ.accumulate({ srcCanvas: cv, draw, frames, signal, onProgress: (d, t) => prog.show(d, t, `Rendering ${d} of ${t} · ${Math.round(w * k)} × ${Math.round(h * k)} px`) });
    // a caption strip says what the picture is: a look, with its date and the model's label
    const f = Math.max(1, Math.round(canvas.width / 900)), strip = Math.round(30 * f), out = document.createElement('canvas');
    out.width = canvas.width; out.height = canvas.height + strip;
    const g = out.getContext('2d'); g.drawImage(canvas, 0, 0);
    g.fillStyle = '#12151c'; g.fillRect(0, canvas.height, out.width, strip);
    g.fillStyle = '#eef1f6'; g.font = `600 ${12 * f}px system-ui, sans-serif`; g.textBaseline = 'middle';
    g.fillText(caption || name, 14 * f, canvas.height + strip / 2);
    g.fillStyle = '#a9b1bf'; g.font = `500 ${11 * f}px system-ui, sans-serif`; g.textAlign = 'right';
    g.fillText(`Visual render, ${done} frames · for looking, not a measurement`, out.width - 14 * f, canvas.height + strip / 2);
    RQ.saveBlob(await RQ.canvasBlob(out), `${name}-${Math.round(w * k)}px.png`);
    toastFn(signal.aborted ? `Stopped after ${done} frames; saved what was rendered.` : `Saved a ${Math.round(w * k)} px render.`);
  } catch (e) { toastFn(`Render failed: ${e.message || e}`); }
  finally {
    cam.clearViewOffset(); sunL.position.copy(sunStart); renderer.setPixelRatio(pr); G3.resize(); G3.markDirty(); prog.hide();
  }
}
