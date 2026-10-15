// Render quality for Unit 3D: Fast (as before) or Visual (soft shadows from the larger shadow map and an environment light), the automatic
// lighter level, and a progressive high-resolution render for the snapshot. A look, not evidence: it changes no number, no shadow
// position and no sun hour (features/render-quality.js). The mode, the level and the step-down are ONE setting shared with the studio (room3d/quality.js); this module only draws them onto Unit 3D's renderer.
// The studio-side twin is plan/quality3d.js.
import * as THREE from 'three';
import * as RQ from '../features/render-quality.js';
import { quality } from '../room3d/quality.js';   // [room3d] THE shared setting: mode, level, step-down
import { applyRenderer, forgetRenderer } from '../room3d/quality-apply.js';

let stage = null, ui = null, prog = null, note = null, noteT = 0, toastFn = () => {}, hires = () => {}, mounted = false;
const memo = {};   // what applyRenderer last wrote to this scene

/** Add the Fast / Visual control and the 2x / 4x render buttons to the page header. `o` = {host, stageEl, store, toast, render(scale)}. */
export function mount(o) {
  if (mounted) return; mounted = true;
  toastFn = o.toast; hires = o.render; quality.bind(o.store);
  ui = RQ.modeControl({ mode: quality.mode, inline: true, onChange: (m) => setMode(m, true) });
  ui.el.insertAdjacentHTML('beforeend', '<span class="rnq-lbl rnq-sep" aria-hidden="true">PNG</span>' + RQ.EXPORT_SCALES.map((s) => `<button type="button" data-hires="${s}" title="Render a ${s}\u00d7 PNG, averaging jittered frames for smooth edges and softer shadows" aria-label="Render a ${s} times PNG">${s}\u00d7</button>`).join(''));
  ui.el.insertAdjacentHTML('afterbegin', '<span class="rnq-lbl" aria-hidden="true">Render</span>');
  ui.el.addEventListener('click', (e) => { const b = e.target.closest('[data-hires]'); if (b) hires(+b.dataset.hires); });
  o.host.prepend(ui.el);
  note = document.createElement('div'); note.className = 'float rnq-note'; note.hidden = true; note.setAttribute('role', 'status'); o.stageEl.appendChild(note);
  prog = RQ.progressStrip(o.stageEl);
  RQ.autoNote(o.stageEl);   // "Lighter mode for this device" while the step-down is on, with a way to force full quality
  quality.onChange((s, ch) => { if (ch.mode || ch.pinned) ui.set(s.mode); apply(); });   // the studio, the step-down or the renter changed it
}
/** The UnitStage exists, or its scene was just (re)built by stage.build(): give it the current setting and time its first frames. */
export function adopt(s) {
  stage = s; forgetRenderer(memo);
  quality.attach('unit', { renderer: () => stage?.renderer, scene: () => stage?.scene, kick: () => { if (stage) stage.dirty = true; } });
  if (stage?.maxTex) quality.setDevice({ maxTexture: stage.maxTex });
  apply();
  if (stage?.scene) quality.opened('unit');
}
export const current = () => quality.mode;
/** Unit 3D came to the front (the route entered it): time its first frames again. */
export const opened = () => quality.opened('unit');
/** Once per animation frame while Unit 3D is in front: `drew` = the stage drew a frame, `ms` = how long that took. Returns the step taken, if any. */
export const pulse = (now, drew, ms) => quality.pulse('unit', now, drew, ms);

export function setMode(m, announce) {
  quality.setMode(m, { user: true });   // writes the shared, remembered setting; every subscriber (this page and the studio) follows
  if (announce && note) { const M = RQ.MODES[quality.mode]; note.hidden = false; note.textContent = `${M.label}: ${M.note.replace('and contact shadows (an ambient-occlusion approximation, not screen-space AO)', '')}`; clearTimeout(noteT); noteT = setTimeout(() => { note.hidden = true; }, 7000); }
}
function apply() {
  if (!stage?.renderer || !stage.scene || !stage.sunL) return;   // the scene is built later, by stage.build()
  const r = stage.renderer, s = quality.settings;
  const out = applyRenderer({ renderer: r, scene: stage.scene, sun: stage.sunL }, s, { soft: { radius: 2.5, bias: -0.0002, blurSamples: s.blurSamples }, hard: { radius: 3, bias: -0.00035 }, envIntensity: 0.3 }, memo);
  if (out.shadowRebuilt) stage.shadowBias?.();   // (the Inside camera's tighter bias)
  // the city's sun-study view: filmic tone mapping lifts highlights gently in Visual; the sky dome is its own shader and is left as it was
  const tm = s.cityTone === 'aces' ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
  if (r.toneMapping !== tm || r.toneMappingExposure !== 1.3 || !stage.baseTone) { r.toneMapping = tm; r.toneMappingExposure = 1.3; }
  stage.baseTone = { mapping: tm, exposure: 1.3 }; stage.applyRoomLook?.();   // [room3d] the Inside and Window cameras use the room's own tone mapping and window glow
  stage.setContextQuality?.(quality.city);   // [city context] trees, grass, water and ground textures, facades
  if (out.pixelRatioChanged) stage.resize?.();
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
  quality.hold(true);   // slow frames on purpose: not a measurement of this device
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
  finally { cam.clearViewOffset(); sun.position.copy(sunStart); r.setPixelRatio(pr); stage.resize?.(); stage.dirty = true; stage.frame(true); prog.hide(); quality.hold(false); }
}
