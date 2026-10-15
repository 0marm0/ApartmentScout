// The video recorder: a camera tour (or the day, from a window) drawn frame by frame at 1080p and 30 fps and recorded with canvas.captureStream +
// MediaRecorder (WebM; MP4 on Apple's browsers). Loaded on demand with the photo renderer.
//
// NO STUTTER. MediaRecorder stamps each frame with the moment it ARRIVES, so a frame that took 90 ms to draw would play 90 ms late and the picture would
// hitch. So the recording is made in two passes, offline:
//   1. every frame is drawn at whatever speed it takes (frame i is the view at time i / fps exactly: the tour's pose and the light are functions of time,
//      not of the clock) and kept as a JPEG;
//   2. the JPEGs are played into a canvas at exactly 30 fps and recorded with track.requestFrame(), the encoder with the machine to itself.
// A fast GPU makes pass 1 take a couple of seconds, a phone or software GL much longer; pass 2 always takes the length of the video. Measured in
// Chromium on a Mac, the recorded frames are 33.3 ms apart without exception. The file's duration is written into a WebM header (Chrome leaves it
// out), so the video reports its length and can be scrubbed.
import { createPipeline, prepareLights, LOOK } from './photo.js';
import { pickVideoType, extOf, isApple, videoBitrate, withWebmDuration } from './encode.js';
import { halton } from '../features/render-quality.js';

/** Hand control back to the event loop without a timer's clamp or a hidden tab's throttle. */
const yieldNow = () => new Promise((res) => { const c = new MessageChannel(); c.port1.onmessage = () => res(); c.port2.postMessage(0); });
/** Wait until performance.now() reaches `t` (a timer for the long part, event-loop turns for the last few milliseconds). */
async function sleepUntil(t) {
  for (;;) {
    const d = t - performance.now();
    if (d <= 0.5) return;
    if (d > 8) await new Promise((r) => setTimeout(r, d - 5)); else await yieldNow();
  }
}

/** True when this browser can record a canvas to a video file. */
export function canRecord() {
  try { return typeof MediaRecorder !== 'undefined' && typeof HTMLCanvasElement !== 'undefined' && typeof HTMLCanvasElement.prototype.captureStream === 'function' && !!pickVideoType((t) => MediaRecorder.isTypeSupported(t), { apple: isApple(navigator) }); } catch { return false; }
}

const cancelled = () => Object.assign(new Error('cancelled'), { cancelled: true });
/** The recorder's first frames come late and uneven while its encoder starts: it is fed the first picture and given this long before the clock starts. */
const LEAD_MS = 400;

/**
 * Record frames as a video.
 * @param {object} host a render host (render/hosts.js)
 * @param {{width: number, height: number, fps?: number, frames: number, setFrame: (i: number) => void, look?: 'standard'|'cinematic', samples?: number,
 *   preview?: (canvas: HTMLCanvasElement) => void, signal?: AbortSignal,
 *   onProgress?: (p: {phase: 'draw'|'encode', frame: number, total: number, fraction: number, text: string}) => void}} o
 *   `setFrame(i)` puts the view's state (camera, time of day) at frame i; the recorder then poses the camera and draws. `look: 'cinematic'` adds the photo
 *   renderer's ambient occlusion, bloom, filmic grade and soft sun and sky shadows (`samples` jittered frames averaged per video frame).
 * @returns {Promise<null | {blob: Blob, type: string, ext: string, durationMs: number, width: number, height: number, fps: number, frames: number, renderMs: number, drawMs: number}>} null when cancelled
 */
export async function recordVideo(host, o) {
  if (!canRecord()) throw new Error('This browser cannot record video');
  const W = Math.round(o.width), H = Math.round(o.height), fps = o.fps || 30, n = Math.max(2, Math.round(o.frames)), frameMs = 1000 / fps, signal = o.signal;
  const cine = o.look === 'cinematic', S = Math.max(1, o.samples ?? 3);
  const type = pickVideoType((t) => MediaRecorder.isTypeSupported(t), { apple: isApple(navigator) });
  const r = host.renderer, cam = host.camera(), gl = r.getContext(), t00 = performance.now();
  const rec = document.createElement('canvas'); rec.width = W; rec.height = H;
  const g = rec.getContext('2d', { alpha: false });
  const exposure0 = r.toneMappingExposure;
  let pipe = null, lights = null, fraction = 0;
  const report = (phase, i, text, f) => { fraction = Math.max(fraction, Math.min(0.999, f)); o.onProgress?.({ phase, frame: i, total: n, fraction, text }); };
  host.begin({ boost: cine });
  try {
    host.setOutput(W, H); host.setAspect(W / H);
    if (cine) {
      r.toneMappingExposure = exposure0 * (host.look?.exposure ?? LOOK.exposure);
      lights = prepareLights(host, { skyShadows: true, share: host.look?.skyShare ?? LOOK.skyShare, sunRadius: host.look?.sunRadius ?? LOOK.sunRadius });
      lights.capture();
      pipe = await createPipeline(host, W, H, { ao: true, bloom: true, dof: false });
    }
    const draw = (i) => {
      if (cine) {
        lights.revert(); o.setFrame(i); lights.capture();
        pipe.restart();
        for (let s = 0; s < S; s++) {
          const k = s;   // the same jitter every frame: a pattern that holds still on the walls, not a shimmer
          cam.setViewOffset(W, H, halton(k, 2) - 0.5, halton(k, 3) - 0.5, W, H);
          lights.jitter(k); host.pose(); pipe.frame();
        }
        cam.clearViewOffset(); pipe.toCanvas();
      } else { o.setFrame(i); host.pose(); r.setRenderTarget(null); host.draw(); }
      g.drawImage(r.domElement, 0, 0);
    };
    // warm up: shaders and textures for everything the tour will see compile now, not in the middle of a take
    for (let k = 0; k <= 10; k++) draw(Math.min(n - 1, Math.round((k / 10) * (n - 1))));
    gl.finish();

    // ---- pass 1: draw every frame, keep it as a JPEG
    const store = [], tDraw = performance.now(); let pending = null;
    for (let i = 0; i < n; i++) {
      if (signal?.aborted) throw cancelled();
      draw(i); o.preview?.(rec);
      if (pending) store.push(await pending);
      pending = new Promise((res) => rec.toBlob((b) => res(b), 'image/jpeg', 0.93));   // (toBlob copies the canvas as it is now)
      const spent = performance.now() - tDraw, left = ((n - i - 1) * spent) / (i + 1), play = n * frameMs + LEAD_MS;
      report('draw', i + 1, `Drawing frame ${i + 1} of ${n}`, spent / (spent + left + play));
      await yieldNow();
    }
    store.push(await pending);
    const drawMs = Math.round(performance.now() - tDraw);

    // ---- pass 2: play them into the recorder at exactly fps
    const stream = rec.captureStream(0), track = stream.getVideoTracks()[0], chunks = [];
    const mr = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: videoBitrate(W, H, fps) });
    mr.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    const stopped = new Promise((res) => { mr.onstop = res; });
    const push = () => { if (typeof track.requestFrame === 'function') track.requestFrame(); };
    const stop = async () => { if (mr.state !== 'inactive') mr.stop(); await stopped; stream.getTracks().forEach((t) => t.stop()); };
    mr.start(1000);
    try {
      const tPlay = performance.now();
      { const b0 = await createImageBitmap(store[0]); g.drawImage(b0, 0, 0); b0.close?.(); push(); await sleepUntil(tPlay + LEAD_MS); }
      let next = createImageBitmap(store[0]);
      const t0 = performance.now() + 50;
      for (let i = 0; i < n; i++) {
        if (signal?.aborted) throw cancelled();
        const bmp = await next; if (i + 1 < n) next = createImageBitmap(store[i + 1]);
        store[i] = null;
        if (performance.now() - (t0 + i * frameMs) > frameMs * 1.5 && i < n - 1) { bmp.close?.(); continue; }   // the machine stalled: skip the frame whose slot has passed, so the picture stays in step with the clock instead of bursting
        await sleepUntil(t0 + i * frameMs);
        g.drawImage(bmp, 0, 0); bmp.close?.(); o.preview?.(rec); push();
        const done = performance.now() - tDraw;
        report('encode', i + 1, `Encoding frame ${i + 1} of ${n}`, done / (done + (n - i - 1) * frameMs));
      }
      await sleepUntil(performance.now() + frameMs * 2);
      await stop();
    } catch (e) { await stop().catch(() => {}); throw e; }
    const durationMs = Math.round(n * frameMs + LEAD_MS);
    let blob = new Blob(chunks, { type });
    if (extOf(type) === 'webm') blob = new Blob([withWebmDuration(new Uint8Array(await blob.arrayBuffer()), durationMs)], { type: blob.type || type });
    return { blob, type: blob.type || type, ext: extOf(type), durationMs, width: W, height: H, fps, frames: n, renderMs: Math.round(performance.now() - t00), drawMs };
  } catch (e) {
    if (e?.cancelled) return null;
    throw e;
  } finally {
    cam.clearViewOffset(); pipe?.dispose(); lights?.restore(); r.setRenderTarget(null); r.toneMappingExposure = exposure0;
    host.end();
  }
}
