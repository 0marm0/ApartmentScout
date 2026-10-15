// Render quality for Unit 3D: Fast (as before) or Visual (soft shadows from the larger shadow map and an environment light),
// and a progressive high-resolution render for the snapshot. A look, not evidence: it changes no number, no shadow
// position and no sun hour (features/render-quality.js). The studio-side twin is plan/quality3d.js.
import * as THREE from 'three';
import * as RQ from '../features/render-quality.js';
import { environmentFor, recompileMaterials } from '../features/render-env.js';

let mode = 'fast', stage = null, ui = null, prog = null, store = null, note = null, noteT = 0, toastFn = () => {}, hires = () => {};

/** Add the Fast / Visual control and the 2x / 4x render buttons to the page header. `o` = {host, stageEl, store, toast, render(scale)}. */
export function mount(o) {
  store = o.store; toastFn = o.toast; hires = o.render; mode = RQ.readMode(store);
  ui = RQ.modeControl({ mode, inline: true, onChange: (m) => setMode(m, true) });
  ui.el.insertAdjacentHTML('beforeend', '<span class="rnq-lbl rnq-sep" aria-hidden="true">PNG</span>' + RQ.EXPORT_SCALES.map((s) => `<button type="button" data-hires="${s}" title="Render a ${s}× PNG, averaging jittered frames for smooth edges and softer shadows" aria-label="Render a ${s} times PNG">${s}×</button>`).join(''));
  ui.el.insertAdjacentHTML('afterbegin', '<span class="rnq-lbl" aria-hidden="true">Render</span>');
  ui.el.addEventListener('click', (e) => { const b = e.target.closest('[data-hires]'); if (b) hires(+b.dataset.hires); });
  o.host.prepend(ui.el);
  note = document.createElement('div'); note.className = 'float rnq-note'; note.hidden = true; note.setAttribute('role', 'status'); o.stageEl.appendChild(note);
  prog = RQ.progressStrip(o.stageEl);
}
/** The UnitStage exists, or its scene was just (re)built by stage.build(): give it the current mode. */
export function adopt(s) { stage = s; apply(); }
export const current = () => mode;

export function setMode(m, announce) {
  mode = m === 'visual' ? 'visual' : 'fast'; RQ.saveMode(store, mode); ui?.set(mode); apply();
  if (announce && note) { note.hidden = false; note.textContent = `${RQ.MODES[mode].label}: ${RQ.MODES[mode].note.replace('and contact shadows (an ambient-occlusion approximation, not screen-space AO)', '')}`; clearTimeout(noteT); noteT = setTimeout(() => { note.hidden = true; }, 7000); }
}
function apply() {
  if (!stage?.renderer || !stage.scene || !stage.sunL) return;   // the scene is built later, by stage.build()
  const r = stage.renderer, s = RQ.settingsFor(mode, { phone: RQ.phoneClass(), maxTexture: stage.maxTex, dpr: window.devicePixelRatio });
  r.setPixelRatio(s.pixelRatio);
  const L = stage.sunL;
  L.shadow.map?.dispose(); L.shadow.map = null;
  if (s.softShadows) { r.shadowMap.type = THREE.VSMShadowMap; L.shadow.radius = 2.5; L.shadow.blurSamples = s.blurSamples; L.shadow.bias = -0.0002; }
  else { r.shadowMap.type = THREE.PCFSoftShadowMap; L.shadow.radius = 3; L.shadow.bias = -0.00035; }
  recompileMaterials(stage.scene);
  stage.scene.environment = s.environment ? environmentFor(r, { intensity: 0.3 }) : null;
  stage.resize?.();
  stage.dirty = true;
}

/**
 * Render the stage `scale` x larger (capped at 4096 px) as the average of `frames` jittered frames and return the
 * canvas, or null if it could not be made. Restores the stage afterwards.
 */
export async function renderAccumulated(scale, { frames = 16 } = {}) {
  if (!stage?.renderer || !stage.scene) return null;
  const r = stage.renderer, cv = r.domElement, w = cv.clientWidth, h = cv.clientHeight; if (!w || !h) return null;
  const k = RQ.fitScale(scale, w, h), pr = r.getPixelRatio(), cam = stage.activeCam(), sun = stage.sunL;
  const sunStart = sun.position.clone(), tgt = sun.target.position.clone();
  const dir = sunStart.clone().sub(tgt), len = dir.length(), side = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize(), vert = new THREE.Vector3().crossVectors(side, dir).normalize();
  const signal = prog.start(); prog.show(0, frames, 'Preparing the render…');
  try {
    r.setPixelRatio(k);
    const draw = (i) => {
      const [jx, jy] = RQ.jitter(i), [sx, sy] = RQ.sunDisc(i, 0.008);
      cam.setViewOffset(w, h, jx / k, jy / k, w, h);
      sun.position.copy(tgt).add(dir.clone().addScaledVector(side, sx * len).addScaledVector(vert, sy * len).setLength(len));
      stage.frame(true);
    };
    const out = await RQ.accumulate({ srcCanvas: cv, draw, frames, signal, onProgress: (d, t) => prog.show(d, t, `Rendering ${d} of ${t} · ${Math.round(w * k)} × ${Math.round(h * k)} px`) });
    out.aborted = signal.aborted;
    return out;
  } catch (e) { toastFn(`Render failed: ${e.message || e}`); return null; }
  finally { cam.clearViewOffset(); sun.position.copy(sunStart); r.setPixelRatio(pr); stage.resize?.(); stage.dirty = true; stage.frame(true); prog.hide(); }
}
