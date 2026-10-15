// Render quality for the 3D views: Fast (the default, what the views always did), Visual (higher-resolution soft shadows,
// an environment light and contact shadows) and a progressive high-resolution PNG export. Shared by the Floor plan
// studio (plan/quality3d.js) and Unit 3D (unit/quality3d.js). Pure (no three.js): the three.js parts are in render-env.js.
//
// VISUAL REALISM IS NOT EVIDENCE. Visual mode makes the picture nicer to look at: it adds no information, changes no
// number, and does not make a modelled sun patch or a skyline more accurate. Evidence confidence is shown separately,
// in the views' provenance and "modelled / estimate / visual preview" labels.

// The mode, its remembered choice, the settings a mode and a level ask for and the automatic step-down live in room3d/quality.js, THE shared
// quality control; they are re-exported here because the export helpers and the small UI below are used with them.
export { MODES, phoneClass, readMode, saveMode, settingsFor } from '../room3d/quality.js';
import { MODES, quality } from '../room3d/quality.js';
export const EXPORT_SCALES = [2, 4];
export const MAX_EXPORT_PX = 4096;       // the longest side of an export, the safe texture size on most GPUs and phones

// ------------------------------------------------------------------ progressive export
/** Halton low-discrepancy sequence value: jitter offsets that cover a pixel evenly after few frames. */
export function halton(i, base) { let f = 1, r = 0, k = i + 1; while (k > 0) { f /= base; r += f * (k % base); k = Math.floor(k / base); } return r; }
/** Sub-pixel offset for frame i, in pixels, both axes in [-0.5, 0.5). */
export const jitter = (i) => [halton(i, 2) - 0.5, halton(i, 3) - 0.5];
/** Largest scale <= `scale` whose longest side stays within `maxPx`. */
export function fitScale(scale, w, h, maxPx = MAX_EXPORT_PX) { return Math.max(1, Math.min(scale, maxPx / Math.max(1, w, h))); }
/** A point in the sun's disc (radius rad) for frame i: tiny penumbra, the real angular size of the sun is about 0.27 deg. */
export function sunDisc(i, rad = 0.0047) { const a = 2 * Math.PI * halton(i, 5), r = rad * Math.sqrt(halton(i, 7)); return [Math.cos(a) * r, Math.sin(a) * r]; }

/**
 * Render a view several times with sub-pixel camera jitter (and, if given, a jitter of the lights) and average the frames.
 * `draw(i, n)` must jitter and render ONE frame into `srcCanvas` (synchronously). Returns an offscreen canvas.
 * Yields to the browser between frames; `signal.aborted` stops early (the partial average is still returned);
 * `onProgress(done, total)` reports.
 */
export async function accumulate({ srcCanvas, draw, frames = 16, onProgress, signal }) {
  const w = srcCanvas.width, h = srcCanvas.height, acc = document.createElement('canvas'); acc.width = w; acc.height = h;
  const g = acc.getContext('2d', { willReadFrequently: false });
  let done = 0;
  for (let i = 0; i < frames; i++) {
    if (signal?.aborted) break;
    draw(i, frames);
    g.globalAlpha = 1 / (i + 1); g.drawImage(srcCanvas, 0, 0); done++;
    onProgress?.(done, frames);
    await new Promise((r) => requestAnimationFrame(() => r()));
  }
  g.globalAlpha = 1;
  return { canvas: acc, frames: done };
}
export const canvasBlob = (c) => new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('The image is too large for this browser'))), 'image/png'));
export function saveBlob(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

// ------------------------------------------------------------------ small shared UI
/**
 * A segmented Fast / Visual control. `onChange(mode)` runs when the renter picks one. Returns {el, set(mode)}.
 * `inline` styles it for a page header (Unit 3D) instead of floating over a canvas.
 */
export function modeControl({ mode, onChange, inline = false, label = 'Render' }) {
  const el = document.createElement('div');
  el.className = inline ? 'rnq-inline' : 'float rnq';
  el.setAttribute('role', 'group'); el.setAttribute('aria-label', 'Render quality');
  el.innerHTML = `${inline ? '' : `<span class="rnq-lbl">${label}</span>`}${Object.entries(MODES).map(([k, m]) => `<button type="button" data-rnq="${k}" title="${m.note.replace(/"/g, '&quot;')}" aria-pressed="false">${m.label}</button>`).join('')}`;
  const set = (m) => el.querySelectorAll('[data-rnq]').forEach((b) => { const on = b.dataset.rnq === m; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
  el.addEventListener('click', (e) => { const b = e.target.closest('[data-rnq]'); if (b) { set(b.dataset.rnq); onChange(b.dataset.rnq); } });
  set(mode);
  return { el, set };
}
/** A progress strip with a Cancel button. Returns {el, show(done,total,text), hide(), signal()} (signal aborts on Cancel). */
export function progressStrip(host) {
  const el = document.createElement('div'); el.className = 'float rnq-prog'; el.hidden = true; el.setAttribute('role', 'status');
  el.innerHTML = '<span class="rnq-t"></span><progress max="1" value="0"></progress><button type="button" class="btn sm">Cancel</button>';
  host.appendChild(el);
  let ctl = null;
  el.querySelector('button').addEventListener('click', () => ctl?.abort());
  return {
    el,
    start() { ctl = new AbortController(); el.hidden = false; return ctl.signal; },
    show(done, total, text) { el.querySelector('progress').value = done / total; el.querySelector('.rnq-t').textContent = text || `Rendering ${done} of ${total}`; },
    hide() { el.hidden = true; ctl = null; },
  };
}

/**
 * The small "Lighter mode for this device" note: shown while the automatic step-down has lowered the quality, with a button that pins the renter's
 * choice at full quality (Visual, or the current mode when Fast is chosen). Unobtrusive: one line in a corner of the stage. Returns {el, sync}.
 */
export function autoNote(host) {
  const el = document.createElement('div');
  el.className = 'float rnq-auto'; el.hidden = true; el.setAttribute('role', 'status');
  el.innerHTML = '<span class="rnq-auto-t">Lighter mode for this device</span><button type="button" class="rnq-auto-b"></button>';
  host.appendChild(el);
  const btn = el.querySelector('button'), txt = el.querySelector('.rnq-auto-t');
  const sync = () => {
    const on = quality.level > 0 && !quality.pinned;
    el.hidden = !on;
    if (!on) return;
    const visual = quality.mode === 'visual';
    btn.textContent = visual ? 'Force Visual' : 'Full detail';
    btn.title = visual ? 'Draw Visual at full quality and stop lowering it automatically. Choose Fast to turn the automatic lighter mode back on.' : 'Draw at full detail and stop lowering it automatically. Choose Fast again later to turn the automatic lighter mode back on.';
    txt.title = `${MODES[quality.mode].label}, level ${quality.level} of 5: ${quality.levelName()}. The picture is drawn lighter because frames took too long here; numbers and sun hours are unchanged.`;
  };
  btn.addEventListener('click', () => { if (quality.mode === 'visual') quality.forceVisual(); else quality.pin(true); sync(); });
  quality.onChange(() => sync());
  sync();
  return { el, sync };
}
