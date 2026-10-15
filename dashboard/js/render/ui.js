// "Render a photo" and "Make a video" for the 3D views: two buttons in each view, a sheet with the few choices, a progress bar with Cancel, and the result with
// Download and (on a phone) Share. The renderers (render/photo.js, render/video.js) and their three.js addons are fetched only when a button is pressed;
// this file is small and is the only part of the feature in the page's first load. A view mounts it with a bridge (see `mount`).
import { esc } from '../util.js';
import { quality, phoneClass } from '../room3d/quality.js';
import { TIMES, timeOfDay, clock } from './timeofday.js';
import { fileName, canShareFiles, videoSize } from './encode.js';

const ICON = {
  photo: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><path d="M2 5.2h2.4l1.1-1.8h5l1.1 1.8H14v7.3H2z"/><circle cx="8" cy="8.8" r="2.3"/><path d="M12 7.4h.01" stroke-linecap="round"/></svg>',
  film: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="3.4" width="12" height="9.2" rx="1.4"/><path d="M6.6 6l3.6 2-3.6 2z" fill="currentColor" stroke="none"/></svg>',
};
const bridges = {};
let sheet = null;

const OPT_KEY = 'render-sheet';
const SIZES = [{ k: 'std', scale: 1.5, name: 'Screen' }, { k: 'large', scale: 2.5, name: 'Large' }, { k: 'poster', scale: 4, name: 'Poster' }];
const BUDGETS = [{ k: 'quick', s: 5, name: 'Quick' }, { k: 'fine', s: 12, name: 'Fine' }, { k: 'best', s: 20, name: 'Best' }];
const DEFAULTS = { size: 'large', budget: 'fine', dof: false, shot: 'tour', time: 'golden', seconds: 15, look: 'cinematic', res: 1080 };

const nextTick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const blobOf = (canvas, type, q) => new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('The picture is too large for this browser'))), type, q));
const fmtMB = (b) => `${(b / 1048576).toFixed(b > 10485760 ? 0 : 1)} MB`;

/** The quality the picture is made at: Visual at full level, whatever the view was set to, put back afterwards (nothing is remembered: the choice is not changed). */
async function withVisual(fn) {
  const prev = { mode: quality.mode, level: quality.level };
  quality.hold(true);
  try {
    if (prev.mode !== 'visual') quality.setMode('visual', { persist: false });
    if (quality.level) quality.setLevel(0, 'render');
    await nextTick(250);   // the views re-apply the setting (shadow maps, environment light, trees) on their next frame
    return await fn();
  } finally {
    if (prev.mode !== quality.mode) quality.setMode(prev.mode, { persist: false });
    if (prev.level && quality.level !== prev.level) quality.setLevel(prev.level, 'render');
    quality.hold(false);
  }
}

let heic = null;
/** Does this browser encode HEIC from a canvas (Safari may one day; nothing else does)? */
async function heicOk() {
  if (heic !== null) return heic;
  try { const c = document.createElement('canvas'); c.width = c.height = 2; const b = await new Promise((r) => c.toBlob(r, 'image/heic', 0.9)); heic = !!b && b.type === 'image/heic'; } catch { heic = false; }
  return heic;
}

// ------------------------------------------------------------------ the two jobs (also what the tests call)
/**
 * A photo of the view. `o`: {size: 'std'|'large'|'poster' | scale: number, seconds, dof, width, height (exact pixels), signal, onProgress}.
 * Returns {canvas, samples, ms, width, height, aborted}, or null when the view has nothing to draw.
 */
export async function makePhoto(id, o = {}) {
  const b = bridges[id]; if (!b) throw new Error(`no ${id} view mounted`);
  const [{ renderPhoto, photoSize, maxPhotoPx }] = await Promise.all([import('./photo.js')]);
  return withVisual(async () => {
    const host = await b.host(); if (!host) return null;
    const view = host.view(), scale = o.scale ?? SIZES.find((s) => s.k === o.size)?.scale ?? 2.5;
    const size = o.width && o.height ? { w: o.width, h: o.height } : photoSize(view, scale, maxPhotoPx(host.renderer, phoneClass()));
    return renderPhoto(host, { width: size.w, height: size.h, seconds: o.seconds ?? 12, dof: !!o.dof, ao: o.ao !== false, bloom: o.bloom !== false, skyShadows: o.skyShadows !== false, minSamples: o.minSamples, maxSamples: o.maxSamples, signal: o.signal, onProgress: o.onProgress });
  });
}

/** The sequence a video shows, or null: {kind, n, fps, seconds, poseAt, minuteAt, ...}. */
export async function sequenceFor(id, o = {}) {
  const b = bridges[id], V = b?.video; if (!V) return null;
  const S = await import('./shots.js'), plan = V.plan(), space = V.space();
  if (!plan || !space) return null;
  const fps = o.fps || 30;
  return o.shot === 'day' ? S.daySequence(plan, space, V.altAt, { seconds: o.seconds ?? 14, fps, from: V.range[0], to: V.range[1] }) : S.tourSequence(plan, space, { seconds: o.seconds ?? 15, fps });
}

/**
 * A video. `o`: {shot: 'tour'|'day', time: a TIMES key, seconds, look: 'standard'|'cinematic', res: 1080|720, fps, preview(canvas), signal, onProgress}.
 * Returns {blob, type, ext, durationMs, width, height, fps, frames, seq, when} or null (cancelled, or the plan has no way through).
 */
export async function makeVideo(id, o = {}) {
  const b = bridges[id]; if (!b?.video) throw new Error(`no ${id} view mounted`);
  const [{ recordVideo, canRecord }] = await Promise.all([import('./video.js')]);
  if (!canRecord()) throw new Error('This browser cannot record video');
  const V = b.video, shot = o.shot === 'day' ? 'day' : 'tour', fps = o.fps || 30;
  const restore = V.prepare();
  try {
    const seq = await sequenceFor(id, { ...o, shot, fps }); if (!seq) return null;
    let when = null;
    if (shot === 'tour') { const t = timeOfDay(o.time || 'golden', V.altAt, { from: V.range[0], to: V.range[1], now: V.minute() }); V.setMinute(t.min); when = t; }
    const run = () => (async () => {
      const host = await b.host(); if (!host) return null;
      const { w, h } = videoSize(o.res || 1080, { maxPx: Math.min(4096, host.renderer.capabilities?.maxTextureSize || 4096) });
      const res = await recordVideo(host, { width: w, height: h, fps, frames: seq.n, look: o.look || 'standard', samples: o.samples, signal: o.signal, onProgress: o.onProgress, preview: o.preview,
        setFrame: (i) => { V.applyPose(seq.poseAt(i)); const m = seq.minuteAt(i); if (m != null) V.setMinute(m); } });
      return res ? { ...res, seq, when } : null;
    })();
    return (o.look === 'cinematic' || !phoneClass()) ? await withVisual(() => run()) : await run();
  } finally { restore(); }
}

// ------------------------------------------------------------------ the sheet
function readOpts(store) { try { return { ...DEFAULTS, ...(store?.get(OPT_KEY, {}) || {}) }; } catch { return { ...DEFAULTS }; } }
function saveOpts(store, o) { try { store?.set(OPT_KEY, o); } catch { /* private window */ } }

const seg = (name, items, cur, label) => `<div class="rnd-seg" role="group" aria-label="${esc(label)}" data-seg="${name}">${items.map((i) => `<button type="button" data-v="${esc(i.k)}" aria-pressed="${i.k === cur}"${i.off ? ' disabled' : ''}${i.title ? ` title="${esc(i.title)}"` : ''}>${i.html}</button>`).join('')}</div>`;

function closeSheet() {
  if (!sheet) return;
  sheet.abort?.abort(); sheet.urls.forEach((u) => URL.revokeObjectURL(u)); sheet.el.remove(); document.removeEventListener('keydown', sheet.onKey, true);
  const back = sheet.opener; sheet = null; try { back?.focus({ preventScroll: true }); } catch { /* gone */ }
}

/** Open the sheet for 'photo' or 'video' in view `id`. */
export function openSheet(id, kind, opener = null) {
  const b = bridges[id]; if (!b) return;
  closeSheet();
  const store = b.store, opts = readOpts(store), phone = phoneClass();
  if (phone) { opts.res = 720; if (opts.size === 'poster') opts.size = 'large'; }
  const el = document.createElement('div');
  el.className = 'rnd-back'; el.dataset.rnd = kind;
  el.innerHTML = `<section class="rnd-sheet" role="dialog" aria-modal="true" aria-labelledby="rndT"><header class="rnd-h"><h2 id="rndT">${kind === 'photo' ? 'Render a photo' : 'Make a video'}</h2><button type="button" class="rnd-x" data-act="close" aria-label="Close">&times;</button></header><div class="rnd-body" aria-live="polite"></div></section>`;
  document.body.appendChild(el);
  const body = el.querySelector('.rnd-body');
  sheet = { el, opener, urls: [], abort: null, kind, id, onKey: (e) => { if (e.key === 'Escape') { e.stopPropagation(); if (sheet?.working) sheet.abort?.abort(); else closeSheet(); } } };
  document.addEventListener('keydown', sheet.onKey, true);
  const S = sheet;
  const set = (html) => { body.innerHTML = html; const f = body.querySelector('[data-primary]') || body.querySelector('button'); f?.focus({ preventScroll: true }); };
  const url = (blob) => { const u = URL.createObjectURL(blob); S.urls.push(u); return u; };

  // ---- options
  const options = async () => {
    S.working = false;
    const info = b.info();
    if (kind === 'photo') {
      const h = await b.host().catch(() => null); if (sheet !== S) return;
      const view = h?.view() || { w: 1200, h: 700 }, { photoSize, maxPhotoPx } = await import('./photo.js'), cap = h ? maxPhotoPx(h.renderer, phone) : 1920;
      const px = (s) => { const z = photoSize(view, s.scale, cap); return `${z.w} × ${z.h}`; };
      set(`<p class="rnd-sub">${esc(info.title)} · ${esc(info.when)}</p>
        <div class="rnd-f"><span class="rnd-l">Size</span>${seg('size', SIZES.filter((s) => !(phone && s.k === 'poster')).map((s) => ({ k: s.k, html: `${s.name}<small>${px(s)}</small>` })), opts.size, 'Picture size')}</div>
        <div class="rnd-f"><span class="rnd-l">Time to spend</span>${seg('budget', BUDGETS.map((s) => ({ k: s.k, html: `${s.name}<small>up to ${s.s} s</small>` })), opts.budget, 'Time to spend')}</div>
        <label class="rnd-c"><input type="checkbox" data-opt="dof"${opts.dof ? ' checked' : ''}> Soft depth of field <span class="rnd-n">blurs what is nearer or farther than the middle of the picture</span></label>
        <p class="rnd-note">Soft shadows from the sun and the sky, ambient occlusion, a little glow on the sun and the windows, and a filmic tone curve. A better-looking picture of the same light: it changes no sun hour and adds no information. To change the light, set the time first.</p>
        <div class="rnd-act"><button type="button" class="btn primary" data-act="go" data-primary>Render</button><button type="button" class="btn ghost" data-act="close">Cancel</button></div>`);
    } else {
      const seq0 = await sequenceFor(id, { shot: 'tour', seconds: opts.seconds }), V = b.video;
      if (sheet !== S) return;
      const hasDay = !!(V.plan() && V.space() && (await sequenceFor(id, { shot: 'day', seconds: 10 })));
      const rec = (await import('./video.js')).canRecord();
      if (!seq0 || !rec) { set(`<p class="rnd-sub">${esc(info.title)}</p><p class="rnd-note">${!rec ? 'This browser cannot record video. Chrome, Edge, Safari and Firefox can.' : 'A video needs this home’s floor plan: the tour walks the plan from the front door to a window. Add a plan in the Floor plan studio.'}</p><div class="rnd-act"><button type="button" class="btn ghost" data-act="close" data-primary>Close</button></div>`); return; }
      if (opts.shot === 'day' && !hasDay) opts.shot = 'tour';
      const times = TIMES.map((t) => { const r = timeOfDay(t.key, V.altAt, { from: V.range[0], to: V.range[1], now: V.minute() }); return { k: t.key, html: `${t.label}<small>${clock(r.min)}</small>`, title: t.note }; });
      const lens = (s) => (s === 'day' ? 'The window the day is watched from' : 'From the front door through the living room and the bedroom to a window');
      set(`<p class="rnd-sub">${esc(info.title)} · ${esc(info.date || info.when)}</p>
        <div class="rnd-f"><span class="rnd-l">Shot</span>${seg('shot', [{ k: 'tour', html: 'Walk-through<small>door to window</small>', title: lens('tour') }, { k: 'day', html: 'The day from a window<small>sunrise to dusk</small>', off: !hasDay, title: lens('day') }], opts.shot, 'Shot')}</div>
        <div class="rnd-f" data-for="tour"><span class="rnd-l">Time of day</span>${seg('time', times, opts.time, 'Time of day')}</div>
        <div class="rnd-f"><span class="rnd-l">Length <b data-out="seconds">${opts.seconds} s</b></span><input type="range" class="rnd-range" data-opt="seconds" min="10" max="20" step="1" value="${opts.seconds}" aria-label="Length in seconds"></div>
        <div class="rnd-f"><span class="rnd-l">Look</span>${seg('look', [{ k: 'standard', html: 'Standard<small>fast</small>' }, { k: 'cinematic', html: 'Cinematic<small>soft shadows, glow</small>' }], opts.look, 'Look')}</div>
        <div class="rnd-f"><span class="rnd-l">Size</span>${seg('res', [{ k: '1080', html: '1080p<small>1920 × 1080</small>' }, { k: '720', html: '720p<small>1280 × 720</small>' }], String(opts.res), 'Size')}</div>
        <p class="rnd-note">30 frames a second, drawn one by one at their exact times and then recorded, so the motion is even on any machine; drawing takes ${phone ? 'a minute or so on a phone' : 'a few seconds to a minute'}, then the video plays through once while it is recorded. Keep this tab open. A look, not a measurement.</p>
        <div class="rnd-act"><button type="button" class="btn primary" data-act="go" data-primary>Make the video</button><button type="button" class="btn ghost" data-act="close">Cancel</button></div>`);
      syncVideo();
    }
  };
  const syncVideo = () => {
    body.querySelectorAll('[data-for="tour"]').forEach((e) => { e.hidden = opts.shot !== 'tour'; });
    const sec = body.querySelector('[data-opt="seconds"]');
    if (sec) { sec.min = opts.shot === 'day' ? '8' : '10'; if (+sec.value < +sec.min) { sec.value = sec.min; opts.seconds = +sec.min; body.querySelector('[data-out="seconds"]').textContent = `${opts.seconds} s`; } }
  };

  // ---- working
  const working = (title) => {
    S.working = true; S.abort = new AbortController();
    set(`<p class="rnd-sub">${esc(title)}</p>${kind === 'video' ? '<canvas class="rnd-prev" aria-label="The video being recorded" width="640" height="360"></canvas>' : ''}<div class="rnd-prog"><progress max="1" value="0" aria-label="Progress"></progress><span class="rnd-pt" role="status">Preparing…</span></div><div class="rnd-act"><button type="button" class="btn ghost" data-act="cancel" data-primary>Cancel</button></div>`);
    const prog = body.querySelector('progress'), txt = body.querySelector('.rnd-pt'), prev = body.querySelector('.rnd-prev'), pg = prev?.getContext('2d');
    return {
      signal: S.abort.signal,
      onProgress: (p) => { if (sheet !== S) return; prog.value = p.fraction; txt.textContent = p.text + (p.fraction > 0.02 && S.t0 ? ` · about ${Math.max(1, Math.round(((Date.now() - S.t0) / p.fraction) * (1 - p.fraction) / 1000))} s left` : ''); },
      preview: prev ? (c) => { pg.drawImage(c, 0, 0, prev.width, prev.height); } : null,
    };
  };
  const fail = (e) => {
    if (sheet !== S) return;
    S.working = false;
    set(`<p class="rnd-sub">Something went wrong</p><p class="rnd-note">${esc(e?.message || String(e))}. Nothing was changed. If this keeps happening, try Quick or the 720p size.</p><div class="rnd-act"><button type="button" class="btn primary" data-act="back" data-primary>Back</button><button type="button" class="btn ghost" data-act="close">Close</button></div>`);
  };

  // ---- photo
  const goPhoto = async () => {
    const w = working(`${info0()}`); S.t0 = Date.now();
    try {
      const sz = SIZES.find((s) => s.k === opts.size) || SIZES[1], bg = BUDGETS.find((s) => s.k === opts.budget) || BUDGETS[1];
      const r = await makePhoto(id, { scale: sz.scale, seconds: bg.s, dof: opts.dof, signal: w.signal, onProgress: w.onProgress });
      if (sheet !== S) return;
      if (!r) { fail(new Error('There is nothing to render in this view yet')); return; }
      const png = await blobOf(r.canvas, 'image/png'); if (sheet !== S) return;
      S.result = { canvas: r.canvas, png, info: b.info() }; S.result.pngUrl = url(png);
      const jpg = await blobOf(r.canvas, 'image/jpeg', 0.92); S.result.jpg = jpg;
      const heicOn = await heicOk(), name = (ext) => fileName([S.result.info.stem], ext);
      const files = [new File([jpg], name('jpg'), { type: 'image/jpeg' })], share = canShareFiles(navigator, files);
      set(`<figure class="rnd-fig"><img src="${S.result.pngUrl}" alt="The rendered photo" width="${r.width}" height="${r.height}"><figcaption>${r.width} × ${r.height} px · ${r.samples} samples in ${(r.ms / 1000).toFixed(1)} s${r.aborted ? ' · stopped early' : ''} · PNG ${fmtMB(png.size)}, JPEG ${fmtMB(jpg.size)}</figcaption></figure>
        <div class="rnd-act">${share ? '<button type="button" class="btn primary" data-act="share" data-primary>Share</button>' : ''}<button type="button" class="btn ${share ? '' : 'primary'}" data-act="dl-png"${share ? '' : ' data-primary'}>Download PNG</button><button type="button" class="btn" data-act="dl-jpg">Download JPEG</button>${heicOn ? '<button type="button" class="btn" data-act="dl-heic">Download HEIC</button>' : ''}<button type="button" class="btn ghost" data-act="back">Render again</button><button type="button" class="btn ghost" data-act="close">Close</button></div>`);
      S.share = async () => { try { await navigator.share({ files, title: S.result.info.title }); } catch (e) { if (e?.name !== 'AbortError') fail(e); } };
    } catch (e) { fail(e); }
  };
  const info0 = () => { const i = b.info(); return `${i.title} · ${i.when}`; };

  // ---- video
  const goVideo = async () => {
    const w = working(`${info0()}`); S.t0 = Date.now();
    try {
      const r = await makeVideo(id, { shot: opts.shot, time: opts.time, seconds: opts.seconds, look: opts.look, res: opts.res, signal: w.signal, onProgress: w.onProgress, preview: w.preview });
      if (sheet !== S) return;
      if (!r) { if (w.signal.aborted) { await options(); return; } fail(new Error('The floor plan has no way through to a window')); return; }
      const name = fileName([b.info().stem, 'tour'], r.ext), file = new File([r.blob], name, { type: r.type.split(';')[0] }), share = canShareFiles(navigator, [file]);
      S.result = { blob: r.blob, name, file }; const u = url(r.blob);
      set(`<figure class="rnd-fig"><video src="${u}" controls playsinline loop muted autoplay width="${r.width}" height="${r.height}"></video><figcaption>${r.width} × ${r.height} · ${r.fps} fps · ${(r.durationMs / 1000).toFixed(1)} s · ${r.ext.toUpperCase()} ${fmtMB(r.blob.size)}${r.when ? ` · ${esc(TIMES.find((t) => t.key === r.when.key)?.label || '')} ${clock(r.when.min)}` : ''}</figcaption></figure>
        <div class="rnd-act">${share ? '<button type="button" class="btn primary" data-act="share" data-primary>Share</button>' : ''}<button type="button" class="btn ${share ? '' : 'primary'}" data-act="dl-video"${share ? '' : ' data-primary'}>Download .${r.ext}</button><button type="button" class="btn ghost" data-act="back">Make another</button><button type="button" class="btn ghost" data-act="close">Close</button></div>
        ${r.ext === 'webm' ? '<p class="rnd-note">WebM plays in Chrome, Edge and Firefox, and in recent Safari. Photos on an iPhone and some chat apps want MP4: record from Safari on the iPhone for that.</p>' : ''}`);
      S.share = async () => { try { await navigator.share({ files: [file], title: b.info().title }); } catch (e) { if (e?.name !== 'AbortError') fail(e); } };
    } catch (e) { fail(e); }
  };

  // ---- events
  const save = (blob, name) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); };
  el.addEventListener('click', async (e) => {
    if (e.target === el) { if (!S.working) closeSheet(); return; }
    const seg1 = e.target.closest('[data-seg] button');
    if (seg1 && !seg1.disabled) {
      const g = seg1.parentElement.dataset.seg; opts[g] = g === 'res' ? +seg1.dataset.v : seg1.dataset.v;
      seg1.parentElement.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === seg1)));
      saveOpts(store, opts); if (g === 'shot') syncVideo(); return;
    }
    const act = e.target.closest('[data-act]')?.dataset.act; if (!act) return;
    if (act === 'close') closeSheet();
    else if (act === 'cancel') S.abort?.abort();
    else if (act === 'back') options();
    else if (act === 'go') kind === 'photo' ? goPhoto() : goVideo();
    else if (act === 'share') S.share?.();
    else if (act === 'dl-png') save(S.result.png, fileName([S.result.info.stem], 'png'));
    else if (act === 'dl-jpg') save(S.result.jpg, fileName([S.result.info.stem], 'jpg'));
    else if (act === 'dl-heic') { const h = await blobOf(S.result.canvas, 'image/heic', 0.9).catch(() => null); if (h) save(h, fileName([S.result.info.stem], 'heic')); }
    else if (act === 'dl-video') save(S.result.blob, S.result.name);
  });
  el.addEventListener('input', (e) => {
    const t = e.target.closest('[data-opt]'); if (!t) return;
    if (t.dataset.opt === 'seconds') { opts.seconds = +t.value; body.querySelector('[data-out="seconds"]').textContent = `${opts.seconds} s`; } else if (t.type === 'checkbox') opts[t.dataset.opt] = t.checked;
    saveOpts(store, opts);
  });
  options().catch(fail);
  return sheet;
}

/**
 * Mount the two buttons into `container` and register the view.
 * @param {{id: 'unit'|'plan', container: HTMLElement, store: {get, set}, host: () => Promise<object|null>, info: () => {stem: string, title: string, when: string, date?: string},
 *   video: null | {plan(): object|null, space(): object|null, altAt(min: number): number, range: [number, number], minute(): number, prepare(): () => void, applyPose(pose): void, setMinute(min: number): void}}} o
 */
export function mountRender(o) {
  bridges[o.id] = o;
  const mk = (kind, icon, label, title) => `<button type="button" data-rnd="${kind}" title="${esc(title)}" aria-label="${esc(title)}">${icon}<span>${label}</span></button>`;
  o.container.insertAdjacentHTML('beforeend', `<span class="rnq-sep rnd-sep" aria-hidden="true"></span>${mk('photo', ICON.photo, 'Photo', 'Render a photo: soft shadows, ambient occlusion and a filmic look, in about 5 to 20 seconds')}${mk('video', ICON.film, 'Video', 'Make a video: a walk-through from the front door to a window, or the day from a window')}`);
  o.container.addEventListener('click', (e) => { const b = e.target.closest('[data-rnd]'); if (b) openSheet(o.id, b.dataset.rnd, b); });
  try { window.__render = { ...(window.__render || {}), [o.id]: { photo: (x) => makePhoto(o.id, x), video: (x) => makeVideo(o.id, x), sequence: (x) => sequenceFor(o.id, x), open: (k) => openSheet(o.id, k) } }; } catch { /* no window */ }
}
