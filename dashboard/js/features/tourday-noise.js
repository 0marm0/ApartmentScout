// A 10-second noise check with the phone's microphone (Web Audio API). The microphone is asked for only when the renter taps
// "Measure"; nothing is recorded or kept (the audio is read in short blocks into one number and thrown away) and nothing is
// uploaded. The level is APPROXIMATE: phone microphones are not calibrated (see MIC_OFFSET_DB in tourday-model.js).
import { rmsDb, summarizeLevels, MIC_SECONDS } from './tourday-model.js';

/** Can this browser try? (Needs a secure page: https, or localhost.) */
export const supported = () => !!(navigator.mediaDevices?.getUserMedia && (window.AudioContext || window.webkitAudioContext));

/** Measure for `seconds`. `onTick({ elapsed, level })` runs about ten times a second. `signal` (an AbortSignal) stops it early.
 *  Resolves with { leq, peak, quiet, n }; rejects with an Error whose `kind` is 'denied', 'unsupported', 'busy' or 'aborted'. */
export async function measure({ seconds = MIC_SECONDS, onTick = () => {}, signal } = {}) {
  if (!supported()) throw Object.assign(new Error('This browser cannot use the microphone here.'), { kind: 'unsupported' });
  let stream;
  try {
    // no echo cancelling, noise suppression or automatic gain: they would hide the very thing being measured
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false });
  } catch (e) {
    const denied = ['NotAllowedError', 'SecurityError', 'PermissionDeniedError'].includes(e?.name);
    throw Object.assign(new Error(denied ? 'The microphone is blocked. Allow it for this site in the browser settings, then try again.' : 'No microphone could be opened.'), { kind: denied ? 'denied' : 'busy' });
  }
  const Ctx = window.AudioContext || window.webkitAudioContext, ctx = new Ctx();
  try {
    if (ctx.state === 'suspended') await ctx.resume();
    const src = ctx.createMediaStreamSource(stream), an = ctx.createAnalyser();
    an.fftSize = 2048; an.smoothingTimeConstant = 0;
    src.connect(an);   // not connected to the speakers
    const buf = new Float32Array(an.fftSize), levels = [], t0 = performance.now();
    await new Promise((resolve, reject) => {
      const timer = setInterval(() => {
        an.getFloatTimeDomainData(buf);
        const level = rmsDb(buf);
        levels.push(level);
        const elapsed = Math.min(seconds, (performance.now() - t0) / 1000);
        try { onTick({ elapsed, level }); } catch { /* a drawing error must not stop the measurement */ }
        if (elapsed >= seconds) { clearInterval(timer); resolve(); }
      }, 100);
      signal?.addEventListener('abort', () => { clearInterval(timer); reject(Object.assign(new Error('Stopped.'), { kind: 'aborted' })); }, { once: true });
    });
    return summarizeLevels(levels);
  } finally {
    stream.getTracks().forEach((t) => t.stop());
    ctx.close().catch(() => {});
  }
}
