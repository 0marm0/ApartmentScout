// Render quality for the 3D views: Fast (the default, what the views always did), Visual (higher-resolution soft shadows,
// an environment light and contact shadows) and a progressive high-resolution PNG export. Shared by the Floor plan
// studio (plan/quality3d.js) and Unit 3D (unit/quality3d.js). Pure (no three.js): the three.js parts are in render-env.js.
//
// VISUAL REALISM IS NOT EVIDENCE. Visual mode makes the picture nicer to look at: it adds no information, changes no
// number, and does not make a modelled sun patch or a skyline more accurate. Evidence confidence is shown separately,
// in the views' provenance and "modelled / estimate / visual preview" labels.

export const MODES = {
  fast: { label: 'Fast', note: 'The standard view: the quickest to draw and the one phones start in.' },
  visual: { label: 'Visual', note: 'Soft shadows from a larger shadow map, an environment light and contact shadows (an ambient-occlusion approximation, not screen-space AO). A look, not extra evidence.' },
};
export const EXPORT_SCALES = [2, 4];
export const MAX_EXPORT_PX = 4096;       // the longest side of an export, the safe texture size on most GPUs and phones
const KEY = 'render-quality';

/** A narrow or touch-first device: Fast is the default there, and Visual is lighter. */
export function phoneClass() {
  try { return matchMedia('(max-width: 760px)').matches || (matchMedia('(pointer: coarse)').matches && matchMedia('(max-width: 1100px)').matches); } catch { return false; }
}
/** Stored choice if any, else 'fast' (everywhere: Visual is always opt-in). `store` is app.js's {get,set}. */
export function readMode(store) {
  try { const v = store?.get(KEY, 'fast'); return v === 'visual' ? 'visual' : 'fast'; } catch { return 'fast'; }
}
export function saveMode(store, mode) { try { store?.set(KEY, mode === 'visual' ? 'visual' : 'fast'); } catch { /* private window: the choice lasts for the session */ } }

/** The settings a mode asks for; `phone` lowers them. Pure, so it is testable. */
export function settingsFor(mode, { phone = false, maxTexture = 4096, dpr = 1 } = {}) {
  if (mode !== 'visual') return { mode: 'fast', shadowSize: 2048, softShadows: false, environment: false, contact: false, pixelRatio: Math.min(dpr || 1, 2) };
  return {
    mode: 'visual', shadowSize: Math.min(phone ? 2048 : 4096, maxTexture), softShadows: true, environment: true, contact: !phone,
    pixelRatio: Math.min(dpr || 1, phone ? 1.5 : 2), blurSamples: phone ? 8 : 16, radius: phone ? 3 : 4,
  };
}

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
