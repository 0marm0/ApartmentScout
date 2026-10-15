// "Match a photo": a three-step guide in Unit 3D's Window camera that turns a listing photo of the view into measured numbers.
//   1  Pick a photo that shows the view (the unit's own, the same line's, the building's, or one of yours) and the floor it was taken on.
//   2  Mark two or three landmarks in the photo, and say what each is: choose a named tower from the site file, or click it in the 3D view.
//   3  Check the fit (which way the photo looks, tilt, lens, camera height, and how well it fits) and save it as the unit's measured view.
// The maths is unit/view-solver.js; the saved record, its storage and export is unit/view-calibration.js. This file is the interface:
// the photo laid over the 3D view, pins that can be placed, dragged and undone with mouse, touch or keyboard, and the card that guides.
//
// Keyboard: in the photo, arrow keys move the crosshair (shift for big steps), Enter or Space places a pin, Delete removes the last pair,
// Z (or Ctrl/Cmd+Z) undoes, Escape cancels the pair in progress and then closes the guide. Everything the pins do is also in the card.
import { esc } from '../util.js';
import { photoItems } from '../features/photos.js';
import { mediaSrc } from '../features/media-chain.js';
import { solveView, containedPhoto, photoPoint, photoFraction, directionTo, angDiff, describeFit, DEFAULTS } from './view-solver.js';
import { buildViewCal, saveViewCal, exportViewCal, clearLocal, photoLabel, fitLabel } from './view-calibration.js';

const MAX_PAIRS = 6;
const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const compass = (b) => COMPASS[Math.round((((b % 360) + 360) % 360) / 22.5) % 16];
const fmtDist = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);
const STEPS = [['1', 'Pick a photo'], ['2', 'Mark landmarks'], ['3', 'Check and save']];
const THUMBS = 12;

/** The floor a photo was taken on, read from its title ("32E living/dining" -> 32), else null. */
export function floorFromTitle(title) {
  const m = /^\s*(\d{1,2})\s?[A-Z]{1,2}\b/.exec(String(title || ''));
  return m && +m[1] >= 1 && +m[1] <= 200 ? +m[1] : null;
}

/** The unit's photos in gallery order, each {n, url, title, scope, floor}: what the card offers in step 1. */
export function photoChoices(L) {
  if (!L) return [];
  const meta = Array.isArray(L.photos_meta) ? L.photos_meta : [];
  return photoItems(L).filter((it) => it.group !== 'plan').map((it, i) => {
    const m = meta.find((x) => x && (x.local === it.url || x.url === it.url || x.url === it.remote)) || {};
    const scope = m.scope || (it.group === 'unit' ? 'unit' : it.group === 'line' ? 'same-line' : 'same-building');
    const title = String(m.title || '').trim();
    return { n: i + 1, url: it.url, title, scope, group: it.group, floor: scope === 'unit' ? null : floorFromTitle(title) };
  });
}

/**
 * @param {object} B the bridge to Unit 3D:
 *   stageEl, canvasEl, getStage(), hasWindow(), siteId(), listing(), landmarks() [{name, idx, x, y, top}], windowAt(floor) {x, y, z}, eyeAt(floor) metres,
 *   az(), floor(), maxFloor(), mode(), setMode(m), setLook(fov, yaw, pitch), getLook(), previewEye(z|null), nameOf(bi), apply(record), toast(msg),
 *   download(name, data, type), api, saved() record|null, onSaved(record), onCleared(), opened(bool)
 */
export function createMatch(B) {
  let root = null, card = null, layer = null, frame = null, img = null, svg = null, cross = null, ro = null;
  const st = { open: false, step: 1, photo: null, pairs: [], sub: 'photo', arm3d: true, opacity: 0.55, result: null, floor: 1, vfovAssumed: DEFAULTS.vfov0, saving: false, status: '', history: [], sel: -1, cur: { u: 0.5, v: 0.5 }, saved: null, lookBefore: null };
  let drag = null, raf = 0, dock = null;

  const lms = () => B.landmarks() || [];
  const pairsDone = () => st.pairs.filter((p) => p.target);
  const aspect = () => (st.photo?.aspect > 0 ? st.photo.aspect : 1.5);
  const snapshot = () => { st.history.push(JSON.stringify(st.pairs)); if (st.history.length > 60) st.history.shift(); };

  // ------------------------------------------------------------------ the fit
  function eyePrior() {
    const w = B.windowAt(st.floor);
    return { x: w.x, y: w.y, z: B.eyeAt(st.floor) };
  }
  function refit() {
    const done = pairsDone();
    st.result = null;
    if (st.photo && done.length >= 2) {
      st.result = solveView({
        landmarks: done.map((p) => ({ name: p.name, x: p.target.x, y: p.target.y, z: p.target.z, px: photoPoint(p.u, p.v, aspect()) })),
        eye: eyePrior(), aspect: aspect(), vfov0: st.vfovAssumed,
        fixed: st.lensHeld ? { vfov: st.vfovAssumed } : {},
      });
    }
    register();
  }
  const scheduleRefit = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; refit(); renderPins(); renderCardLive(); }); };

  /** Put the 3D camera where the photo's camera is (or the assumed one before there is a fit), sized to the photo laid over it. */
  function register() {
    if (!st.open || !st.photo) return;
    const stage = B.getStage(); if (!stage) return;
    const cw = B.canvasEl.clientWidth || 800, ch = B.canvasEl.clientHeight || 500, r = st.result?.ok ? st.result : null;
    const vfov = r ? r.vfov_deg : st.vfovAssumed, c = containedPhoto(vfov, aspect(), cw, ch);
    if (r) { B.previewEye(r.eye_height_m); B.setLook(c.vfov, angDiff(r.bearing_deg, B.az()), r.tilt_deg); }
    else { B.previewEye(B.eyeAt(st.floor)); B.setLook(c.vfov, B.getLook().yaw, B.getLook().pitch); }
    layoutFrame();
  }
  function layoutFrame() {
    if (!frame) return;
    const cw = layer.clientWidth, ch = layer.clientHeight, { rect } = containedPhoto(st.result?.ok ? st.result.vfov_deg : st.vfovAssumed, aspect(), cw, ch);
    Object.assign(frame.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.w}px`, height: `${rect.h}px` });
  }

  // ------------------------------------------------------------------ opening and closing
  function open() {
    if (st.open) { card?.querySelector('[data-focus]')?.focus(); return; }
    if (!B.hasWindow()) { B.toast('Place the window in open air first: this needs a Window camera.'); return; }
    if (B.mode() !== 'win') B.setMode('win');
    const host = B.stageEl;
    st.open = true; st.step = 1; st.photo = null; st.pairs = []; st.history = []; st.result = null; st.sub = 'photo'; st.sel = -1; st.status = '';
    st.floor = B.floor(); st.saved = B.saved(); st.lensHeld = false; st.vfovAssumed = DEFAULTS.vfov0;
    st.lookBefore = { ...B.getLook() };
    root = document.createElement('div'); root.className = 'vm-root'; root.id = 'vmRoot';
    layer = document.createElement('div'); layer.className = 'vm-layer'; layer.hidden = true;
    layer.innerHTML = `<div class="vm-frame" id="vmFrame"><img class="vm-img" id="vmImg" alt="" draggable="false"><svg class="vm-lines" id="vmLines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"></svg><div class="vm-pins" id="vmPins"></div><div class="vm-cross" id="vmCross" aria-hidden="true" hidden></div></div>`;
    layer.tabIndex = 0; layer.setAttribute('role', 'application'); layer.setAttribute('aria-label', 'The photo. Arrow keys move the crosshair, Enter places a landmark, Delete removes the last one, Z undoes.');
    card = document.createElement('section'); card.setAttribute('role', 'dialog'); card.setAttribute('aria-label', 'Match a photo'); card.setAttribute('aria-modal', 'false');
    root.append(layer); host.append(root); place();
    frame = layer.querySelector('#vmFrame'); img = layer.querySelector('#vmImg'); svg = layer.querySelector('#vmLines'); cross = layer.querySelector('#vmCross');
    host.classList.add('vm-on'); B.gridEl?.classList.add('vm-active'); B.opened?.(true);
    wire(); dock = matchMedia('(min-width: 1181px)'); dock.addEventListener?.('change', place);
    document.addEventListener('keydown', docKey);
    ro = new ResizeObserver(() => { if (st.open) { register(); renderPins(); } }); ro.observe(host);
    const stage = B.getStage(); if (stage) { stage.showHidden = true; stage.dirty = true; }
    renderCard(); card.querySelector('[data-focus]')?.focus({ preventScroll: true });
    host.scrollIntoView?.({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });   // the photo and the guide, both in view
  }
  function close({ keepLook = false } = {}) {
    if (!st.open) return;
    st.open = false; ro?.disconnect(); ro = null; cancelAnimationFrame(raf); raf = 0;
    B.stageEl.classList.remove('vm-on', 'vm-picking'); B.gridEl?.classList.remove('vm-active');
    dock?.removeEventListener?.('change', place); dock = null; card?.remove(); document.removeEventListener('keydown', docKey);
    root?.remove(); root = card = layer = frame = img = svg = cross = null;
    if (st.photo?.objectUrl) URL.revokeObjectURL(st.photo.objectUrl);
    B.previewEye(null);
    const stage = B.getStage(); if (stage) { stage.showHidden = false; stage.dirty = true; }
    if (!keepLook && st.lookBefore) B.setLook(st.lookBefore.fov, st.lookBefore.yaw, st.lookBefore.pitch);
    B.opened?.(false);
  }

  // ------------------------------------------------------------------ the card
  /** Wide screens: the card is the first panel of the side column, so the photo has the whole stage. Narrower: a sheet over the stage's lower edge. */
  function place() {
    if (!card) return;
    const wide = matchMedia('(min-width: 1181px)').matches && B.sideEl;
    card.className = wide ? 'panel vm-card vm-docked' : 'float vm-card';
    if (wide) { B.sideEl.prepend(card); B.sideEl.scrollTop = 0; } else root.append(card);
    if (frame) { layoutFrame(); register(); }
  }
  function renderCard() {
    if (!card) return;
    const steps = STEPS.map(([n, t], i) => `<li class="${st.step === i + 1 ? 'on' : ''}${st.step > i + 1 ? ' done' : ''}"${st.step === i + 1 ? ' aria-current="step"' : ''}><button type="button" data-step="${i + 1}" ${i + 1 === 2 && !st.photo ? 'disabled' : ''} ${i + 1 === 3 && !(st.result?.ok) ? 'disabled' : ''}><b>${n}</b><span>${t}</span></button></li>`).join('');
    card.innerHTML = `<header class="vm-h"><div><span class="u-eyebrow">Match a photo</span><h3 id="vmTitle">${esc(STEPS[st.step - 1][1])}</h3></div><div class="vm-hb"><button type="button" class="icon-btn vm-min" data-act="min" aria-label="${st.min ? 'Expand' : 'Collapse'} the guide" aria-expanded="${!st.min}" title="${st.min ? 'Expand' : 'Collapse'}">${st.min ? '▴' : '▾'}</button><button type="button" class="icon-btn" data-act="close" aria-label="Close the guide" title="Close (Esc)">×</button></div></header>
      <ol class="vm-steps" aria-label="Steps">${steps}</ol>
      <div class="vm-body" id="vmBody"${st.min ? ' hidden' : ''}>${st.step === 1 ? stepOne() : st.step === 2 ? stepTwo() : stepThree()}</div>`;
    layer.hidden = !st.photo || st.step === 1;
    B.stageEl.classList.toggle('vm-picking', st.open && st.step === 2 && st.sub === 'target' && st.arm3d);
    layer.style.pointerEvents = st.step === 2 && st.sub === 'photo' ? 'auto' : 'none';
    renderPins();
    if (img && st.photo) { img.style.opacity = st.opacity; }
    // a saved photo this copy of the dashboard does not have (the starter set holds some): say so instead of leaving a blank tile
    card.querySelectorAll('.vm-thumb img').forEach((im) => im.addEventListener('error', () => { const b = im.closest('.vm-thumb'); if (b) { b.disabled = true; b.classList.add('gone'); b.title = 'This photo is not available here'; } }));
  }
  /** Parts of the card that change while a pin is dragged, without rebuilding it (so focus and the slider survive). */
  function renderCardLive() {
    if (!card) return;
    const fit = card.querySelector('#vmFit'); if (fit) fit.innerHTML = fitLine();
    card.querySelectorAll('[data-res]').forEach((el) => { const r = st.result?.ok ? st.result.residuals[+el.dataset.res] : null; el.textContent = r ? `${r.deg < 0.1 ? r.deg.toFixed(2) : r.deg.toFixed(1)}°` : ''; el.classList.toggle('bad', !!r && r.deg > 2); });
    const next = card.querySelector('[data-act="next"]'); if (next) next.disabled = !st.result?.ok;
  }

  function stepOne() {
    const L = B.listing(), items = photoChoices(L), many = items.length > THUMBS;
    const thumbs = items.slice(0, many && !st.allThumbs ? THUMBS : items.length).map((it) => `<button type="button" class="vm-thumb${st.photo?.n === it.n && st.photo.source === 'listing' ? ' on' : ''}" data-photo="${it.n}" ${it === items[0] ? 'data-focus' : ''} aria-label="Photo ${it.n}${it.title ? `: ${esc(it.title)}` : ''}${it.scope === 'unit' ? ', this unit' : it.scope === 'same-line' ? ', same line' : ', same building'}" title="${esc(it.title || `Photo ${it.n}`)}"><img src="${esc(mediaSrc(it.url))}" alt="" draggable="false"><span class="vm-tag s-${esc(it.scope)}">${it.scope === 'unit' ? 'unit' : it.scope === 'same-line' ? 'line' : 'bldg'}</span><i>${it.n}</i></button>`).join('');
    const tip = items.length ? '' : '<p class="u-note">This listing has no saved photos. Use one of your own below.</p>';
    const sv = st.saved ? `<div class="vm-saved"><span>A saved match is in use: ${esc(photoLabel(st.saved))}, ${esc(fitLabel(st.saved))}.</span><button type="button" class="btn sm ghost" data-act="forget">Remove it</button></div>` : '';
    return `${sv}<p class="vm-lead">Choose a photo that shows the view through a window. We will line it up with the 3D model to measure which way it looks and how high it was taken.</p>
      ${tip}<div class="vm-thumbs" role="group" aria-label="Listing photos">${thumbs}</div>
      ${many && !st.allThumbs ? `<button type="button" class="u-link" data-act="all-thumbs">Show all ${items.length} photos</button>` : ''}
      <label class="btn vm-file">Use my own photo<input type="file" accept="image/*" class="sr" data-file></label>
      <p class="u-note">Your own photo stays in this browser and is never uploaded.</p>
      <p class="u-note vm-tip"><b>Best photos</b> show a skyline with two or three towers you can name, at different distances. The view matters more than the room.</p>`;
  }
  function stepTwo() {
    const done = pairsDone().length, p = st.photo, pend = st.pairs.findIndex((q) => !q.target);
    const prompt = pend >= 0
      ? `Pin ${pend + 1} is in the photo. Which landmark is it? Choose a named one, or <b>click it in the 3D view</b>.`
      : done === 0 ? 'Click a landmark in the photo: a tower top or a roof corner that you can also find in the 3D view.'
      : done === 1 ? 'Good. Mark a second landmark, ideally far from the first in the picture and in distance.'
      : done < MAX_PAIRS ? 'Fitted. Mark another to check the fit, drag a pin to adjust it, or go on to the check.' : 'That is the most pins. Drag one to adjust it, or go on to the check.';
    const lmOpts = lms().map((l) => ({ l, d: directionTo(B.windowAt(st.floor), { x: l.x, y: l.y, z: l.top }) }))
      .sort((a, b) => Math.abs(angDiff(a.d.bearing, B.az())) - Math.abs(angDiff(b.d.bearing, B.az())))
      .map(({ l, d }) => `<option value="${esc(l.name)}">${esc(l.name)} · ${compass(d.bearing)} ${Math.round(d.bearing)}° · ${fmtDist(d.dist)}${Math.abs(angDiff(d.bearing, B.az())) > 100 ? ' · behind' : ''}</option>`).join('');
    const target = pend >= 0 ? `<div class="vm-target"><div class="field"><label for="vmLm">Named landmark</label><select id="vmLm" data-focus><option value="">Choose…</option>${lmOpts}</select></div><div class="vm-row"><button type="button" class="btn sm primary" data-act="use-lm" disabled>Use this landmark</button><button type="button" class="btn sm ghost${st.arm3d ? ' on' : ''}" data-act="arm3d" aria-pressed="${st.arm3d}">Click it in the 3D view</button><button type="button" class="btn sm ghost" data-act="cancel-pin">Cancel pin</button></div><p class="u-note">The 3D view is behind the photo: drag it to look around, then click the tower or roof corner. The photo stays visible.</p></div>` : '';
    const list = st.pairs.length ? `<ol class="vm-pairs">${st.pairs.map((q, i) => `<li class="${st.sel === i ? 'on' : ''}"><i class="vm-c${i % 6}">${i + 1}</i><span class="vm-pn">${q.target ? esc(q.name) : '<em>which landmark?</em>'}${q.target && q.kind === 'picked' ? ' <small>clicked in 3D</small>' : ''}</span><span class="vm-res" data-res="${pairsDone().indexOf(q)}"></span><button type="button" class="icon-btn" data-del="${i}" aria-label="Remove pin ${i + 1}" title="Remove">×</button></li>`).join('')}</ol>` : '';
    return `<p class="vm-prompt" id="vmPrompt" aria-live="polite" ${pend < 0 && done === 0 ? 'data-focus tabindex="-1"' : ''}>${prompt}</p>
      ${target}${list}
      <div id="vmFit" class="vm-fit" aria-live="polite">${fitLine()}</div>
      ${floorField()}
      <div class="field vm-op"><label for="vmOp">Photo over the 3D view <span class="val">${Math.round(st.opacity * 100)}%</span></label><input type="range" id="vmOp" min="10" max="100" value="${Math.round(st.opacity * 100)}"></div>
      <div class="vm-row vm-nav"><button type="button" class="btn sm ghost" data-act="back">Back</button><button type="button" class="btn sm ghost" data-act="undo" ${st.history.length ? '' : 'disabled'}>Undo</button><button type="button" class="btn sm ghost" data-act="reset" ${st.pairs.length ? '' : 'disabled'}>Reset</button><button type="button" class="btn sm primary" data-act="next" ${st.result?.ok ? '' : 'disabled'}>Check the fit</button></div>
      <p class="u-note vm-keys">${p ? `${esc(photoText(p))}. ` : ''}Keys in the photo: arrows move the crosshair, Enter places a pin, Z undoes, Esc cancels.</p>`;
  }
  function fitLine() {
    const done = pairsDone().length;
    if (!st.result) return done >= 2 ? '' : `<span class="faint">${done === 0 ? 'Two landmarks are the least; three also fit the lens.' : 'One more landmark gives a first fit.'}</span>`;
    if (!st.result.ok) return `<span class="faint">${esc(st.result.reason)}</span>`;
    const r = st.result;
    return `<span class="pill ${r.quality === 'good' ? 'good' : r.quality === 'fair' ? 'warn' : 'bad'}">${r.quality === 'good' ? 'Fits' : r.quality === 'fair' ? 'Roughly fits' : 'Does not fit'}</span> ${esc(describeFit(r))}`;
  }
  /** "Taken on floor [24]": the floor the camera stood on, which the camera height is measured at. */
  function floorField() {
    const own = st.photo.source === 'file' || st.photo.scope === 'unit', unit = B.floor();
    return `<div class="field vm-floor"><label for="vmFloor">Photo taken on floor</label><input type="number" id="vmFloor" min="1" max="${B.maxFloor()}" step="1" inputmode="numeric" value="${st.floor}"><small>${own ? 'This unit.' : st.floor === unit ? 'The same floor as this unit.' : `This unit is on floor ${unit}.`} The camera height is measured here.</small></div>`;
  }
  const photoText = (p) => (p.source === 'file' ? 'Your own photo' : `Photo ${p.n}${p.title ? `, ${p.title.replace(/\s*\(virtually staged\)\s*$/i, '')}` : ''}`);

  function stepThree() {
    const r = st.result;
    if (!r?.ok) return `<p class="u-note">${esc(r?.reason || 'Mark at least two landmarks first.')}</p><div class="vm-row"><button type="button" class="btn sm ghost" data-act="to2" data-focus>Back to the landmarks</button></div>`;
    const pill = (ok, t) => `<span class="pill ${ok ? 'good' : 'warn'}">${t}</span>`;
    const sg = r.sigma, f = st.floor, own = st.photo.source === 'file' || st.photo.scope === 'unit', unitFloor = B.floor();
    const face = facadeFor(r), faceLine = face.kind === 'match' ? `${Math.round(face.bearing)}° wall, ${Math.abs(face.offset).toFixed(0)}° from the photo's direction` : face.kind === 'oblique' ? `Nearest wall faces ${Math.round(face.bearing)}°, ${Math.abs(face.offset).toFixed(0)}° from the photo (a bay, a corner or a photo taken at an angle): its bearing is kept` : 'no wall of this building within 30° of the photo: check that this is the right building and unit';
    const rows = [
      ['Looks toward', `${Math.round(r.bearing_deg)}° ${compass(r.bearing_deg)} <small>±${sg.bearing < 0.1 ? sg.bearing.toFixed(2) : sg.bearing.toFixed(1)}°</small>`, pill(true, 'measured')],
      ['Tilt', `${r.tilt_deg > 0 ? '+' : ''}${r.tilt_deg.toFixed(1)}° <small>±${sg.tilt.toFixed(1)}°</small>`, pill(true, 'measured')],
      ['Lens', `${r.vfov_deg.toFixed(0)}° tall, ${r.hfov_deg.toFixed(0)}° wide${r.lens_determined ? ` <small>±${sg.vfov.toFixed(0)}°</small>` : ''}`, pill(r.lens_determined, r.lens_determined ? 'measured' : 'assumed')],
      ['Camera height', r.eye_determined ? `${r.eye_height_m.toFixed(1)} m on floor ${f} <small>±${sg.eye.toFixed(1)} m</small>` : `${r.eye_height_m.toFixed(1)} m on floor ${f} <small>(the model's)</small>`, pill(r.eye_determined, r.eye_determined ? 'measured' : 'not fixed')],
    ].map(([k, v, p]) => `<div><dt>${k}</dt><dd>${v} ${p}</dd></div>`).join('');
    const res = r.residuals.map((q, i) => `<tr><td><i class="vm-c${i % 6}">${i + 1}</i> ${esc(q.name)}</td><td class="num">${fmtDist(q.dist)}</td><td class="num ${q.deg > 2 ? 'bad' : ''}">${q.deg < 0.1 ? q.deg.toFixed(2) : q.deg.toFixed(1)}°</td></tr>`).join('');
    const notes = [...r.warnings.map((w) => esc(w)),
      !own && f !== unitFloor ? `This photo was taken on floor ${f}, ${Math.abs(f - unitFloor)} floors ${f > unitFloor ? 'above' : 'below'} this unit${st.photo.scope === 'same-line' ? ' on the same line' : ''}. Its camera height sets the storey height; this unit's eye level follows from it.` : '',
      !own && st.photo.scope !== 'same-line' ? 'This photo shows another unit in the building: a different line can look a different way. Use it for the storey height, and trust the direction only if the facade matches.' : '',
      `Facade: ${esc(faceLine)}.`].filter(Boolean);
    const lens = r.n === 2 || !r.lens_determined ? `<div class="field vm-lens"><label for="vmLens">Lens, vertical <span class="val">${st.vfovAssumed.toFixed(0)}°</span></label><input type="range" id="vmLens" min="30" max="90" step="1" value="${Math.round(st.vfovAssumed)}"><small>Assumed. Wide listing photos are 50 to 65°. Move it until the overlay agrees.</small></div>` : '';
    const saved = st.saved && st.saved.photo.n === (st.photo.n || 0) && st.saved.saved ? '<p class="u-note ok">This match is saved for this unit.</p>' : '';
    return `<dl class="vm-dl">${rows}</dl>
      <p class="vm-fit" id="vmFit">${fitLine()}</p>
      <table class="mini vm-tab"><thead><tr><th>Landmark</th><th class="num">Away</th><th class="num">Off by</th></tr></thead><tbody>${res}</tbody></table>
      ${lens}<ul class="vm-notes">${notes.map((n) => `<li>${n}</li>`).join('')}</ul>
      ${floorField()}
      <div class="field vm-op"><label for="vmOp">Photo over the 3D view <span class="val">${Math.round(st.opacity * 100)}%</span></label><input type="range" id="vmOp" min="0" max="100" value="${Math.round(st.opacity * 100)}"></div>
      ${st.status ? `<p class="u-note ok" role="status">${esc(st.status)}</p>` : saved}
      <div class="vm-row vm-nav"><button type="button" class="btn sm ghost" data-act="to2">Back</button><button type="button" class="btn sm primary" data-act="save" data-focus ${st.saving ? 'disabled' : ''}>Save as this unit's measured view</button><button type="button" class="btn sm ghost" data-act="export">Export file</button>${st.saved ? '<button type="button" class="btn sm ghost" data-act="forget">Remove the saved match</button>' : ''}</div>`;
  }

  /** The wall of this building the photo looks toward, if any: {kind: 'match' | 'oblique' | 'none', bearing, offset}. */
  function facadeFor(r) {
    const f = B.facadeNear(r.bearing_deg);
    if (!f) return { kind: 'none', bearing: null, offset: null };
    const off = angDiff(r.bearing_deg, f.bearing);
    return { kind: Math.abs(off) <= 12 ? 'match' : Math.abs(off) <= 30 ? 'oblique' : 'none', bearing: f.bearing, offset: off };
  }

  // ------------------------------------------------------------------ the pins
  function renderPins() {
    if (!frame) return;
    const pins = frame.querySelector('#vmPins'), done = pairsDone();
    pins.innerHTML = st.pairs.map((q, i) => `<button type="button" class="vm-pin vm-c${i % 6}${q.target ? '' : ' pend'}${st.sel === i ? ' sel' : ''}" data-pin="${i}" style="left:${q.u * 100}%;top:${q.v * 100}%" tabindex="${st.step === 2 ? 0 : -1}" aria-label="Pin ${i + 1}${q.target ? `: ${esc(q.name)}` : ', waiting for its landmark'}. Arrow keys nudge it.">${i + 1}</button>`).join('')
      + (st.result?.ok && st.step >= 2 ? st.result.residuals.map((q, i) => (q.pred ? (() => { const f = photoFraction(q.pred, aspect()); return `<i class="vm-pred vm-c${st.pairs.indexOf(done[i]) % 6}" style="left:${f.u * 100}%;top:${f.v * 100}%" title="Where the model puts ${esc(q.name)}" aria-hidden="true"></i>`; })() : '')).join('') : '');
    svg.innerHTML = st.result?.ok && st.step >= 2 ? st.result.residuals.map((q, i) => { if (!q.pred) return ''; const a = photoFraction(q.obs, aspect()), b = photoFraction(q.pred, aspect()); return `<line x1="${a.u * 100}" y1="${a.v * 100}" x2="${b.u * 100}" y2="${b.v * 100}" class="vm-c${st.pairs.indexOf(done[i]) % 6}"/>`; }).join('') : '';
  }

  function addPin(u, v) {
    if (st.pairs.length >= MAX_PAIRS) { B.toast(`That is the most pins (${MAX_PAIRS}). Drag one to adjust it.`); return; }
    if (st.pairs.some((q) => !q.target)) { B.toast('Say what the last pin is first, or cancel it.'); return; }
    snapshot();
    st.pairs.push({ u: clamp01(u), v: clamp01(v), target: null, name: '', kind: 'picked' });
    st.sub = 'target'; st.sel = st.pairs.length - 1;
    renderCard(); focusTarget();
  }
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  const focusTarget = () => { const s = card?.querySelector('#vmLm'); if (s) s.focus({ preventScroll: true }); };
  function setTarget(i, target, name, kind) {
    const q = st.pairs[i]; if (!q) return;
    snapshot();
    q.target = target; q.name = name; q.kind = kind; st.sub = 'photo'; st.sel = i;
    refit(); renderCard();
    layer?.focus({ preventScroll: true });
  }
  function removePair(i) { if (!st.pairs[i]) return; snapshot(); st.pairs.splice(i, 1); st.sub = st.pairs.some((q) => !q.target) ? 'target' : 'photo'; st.sel = -1; refit(); renderCard(); }
  function undo() {
    const s = st.history.pop(); if (s == null) return;
    st.pairs = JSON.parse(s); st.sub = st.pairs.some((q) => !q.target) ? 'target' : 'photo'; st.sel = -1; refit(); renderCard();
  }
  function reset() { if (!st.pairs.length) return; snapshot(); st.pairs = []; st.sub = 'photo'; st.sel = -1; refit(); renderCard(); }

  /** A click on the 3D canvas while a pin waits for its landmark (called by Unit 3D's pointer handler). */
  function pickIn(clientX, clientY) {
    const i = st.pairs.findIndex((q) => !q.target); if (i < 0) return false;
    const hit = B.getStage().pickPoint(clientX, clientY);
    if (!hit) { B.toast('That is the sky or the ground: click a building, a tower top or a roof corner.'); return true; }
    const nm = B.nameOf(hit.bi);
    setTarget(i, { x: hit.x, y: hit.y, z: hit.z }, `${nm}, ${Math.round(hit.z)} m up`, 'picked');
    return true;
  }
  const isPicking = () => st.open && st.step === 2 && st.pairs.some((q) => !q.target) && st.arm3d;

  // ------------------------------------------------------------------ events
  function wire() {
    card.addEventListener('click', onCard);
    card.addEventListener('input', onInput); card.addEventListener('change', onChange);
    card.addEventListener('keydown', onCardKey);
    const at = (e) => { const r = frame.getBoundingClientRect(); return { u: (e.clientX - r.left) / r.width, v: (e.clientY - r.top) / r.height, inside: e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom }; };
    let down = null;
    layer.addEventListener('pointerdown', (e) => {
      if (st.step !== 2) return;
      const pin = e.target.closest('.vm-pin');
      layer.focus({ preventScroll: true });
      if (pin) { snapshot(); drag = { i: +pin.dataset.pin, moved: false }; st.sel = drag.i; layer.setPointerCapture(e.pointerId); e.preventDefault(); return; }
      down = { x: e.clientX, y: e.clientY, id: e.pointerId };
    });
    layer.addEventListener('pointermove', (e) => {
      const p = at(e);
      if (drag) { const q = st.pairs[drag.i]; if (q) { q.u = clamp01(p.u); q.v = clamp01(p.v); drag.moved = true; if (q.target) scheduleRefit(); else renderPins(); } return; }
      if (st.step === 2 && st.sub === 'photo' && e.pointerType === 'mouse' && p.inside) { st.cur = { u: p.u, v: p.v }; showCross(); }
    });
    layer.addEventListener('pointerup', (e) => {
      if (drag) { const d = drag; drag = null; if (!d.moved) st.history.pop(); else { refit(); renderCard(); } try { layer.releasePointerCapture(e.pointerId); } catch { /* not captured */ } return; }
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 8 && st.sub === 'photo') { const p = at(e); if (p.inside) addPin(p.u, p.v); }
      down = null;
    });
    layer.addEventListener('pointerleave', () => { if (cross) cross.hidden = true; });
    layer.addEventListener('keydown', onLayerKey);
    layer.addEventListener('focus', showCross);
    layer.addEventListener('blur', () => { if (cross) cross.hidden = true; });
  }
  function showCross() { if (!cross || st.step !== 2 || st.sub !== 'photo') return; cross.hidden = false; cross.style.left = `${st.cur.u * 100}%`; cross.style.top = `${st.cur.v * 100}%`; }
  function onLayerKey(e) {
    if (st.step !== 2) return;
    const big = e.shiftKey ? 0.05 : 0.01, pin = e.target.closest?.('.vm-pin');
    const move = { ArrowLeft: [-big, 0], ArrowRight: [big, 0], ArrowUp: [0, -big], ArrowDown: [0, big] }[e.key];
    if (move) {
      if (pin) { const q = st.pairs[+pin.dataset.pin]; if (q) { snapshot(); q.u = clamp01(q.u + move[0]); q.v = clamp01(q.v + move[1]); q.target ? (refit(), renderCardLive(), renderPins()) : renderPins(); pin.focus?.(); } }
      else { st.cur = { u: clamp01(st.cur.u + move[0]), v: clamp01(st.cur.v + move[1]) }; showCross(); }
      e.preventDefault(); return;
    }
    if ((e.key === 'Enter' || e.key === ' ') && !pin && st.sub === 'photo') { addPin(st.cur.u, st.cur.v); e.preventDefault(); return; }
    if (e.key === 'Enter' && pin) { st.sel = +pin.dataset.pin; renderCard(); e.preventDefault(); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { const i = pin ? +pin.dataset.pin : st.pairs.length - 1; if (i >= 0) removePair(i); e.preventDefault(); return; }
    if ((e.key === 'z' || e.key === 'Z') && !e.altKey) { undo(); e.preventDefault(); return; }
    if (e.key === 'Escape') { escape(); e.preventDefault(); e.stopPropagation(); }
  }
  /** Escape from anywhere on the page that has no control of its own focused (the card and the photo handle theirs). */
  function docKey(e) {
    if (e.key !== 'Escape' || e.defaultPrevented || !st.open) return;
    if (e.target !== document.body && e.target !== document.documentElement && !root?.contains(e.target) && !card?.contains(e.target)) return;
    escape(); e.preventDefault();
  }
  function onCardKey(e) {
    if (e.key === 'Escape') { escape(); e.preventDefault(); e.stopPropagation(); return; }
    if ((e.key === 'z' || e.key === 'Z') && (e.ctrlKey || e.metaKey) && st.step === 2) { undo(); e.preventDefault(); }
    if (e.key === 'Enter' && e.target.id === 'vmLm' && e.target.value) { card.querySelector('[data-act="use-lm"]')?.click(); e.preventDefault(); }
  }
  /** Escape: cancel the pin in progress, else step back, else close. */
  function escape() {
    const i = st.pairs.findIndex((q) => !q.target);
    if (st.step === 2 && i >= 0) { removePair(i); return; }
    if (st.step > 1) { st.step -= 1; renderCard(); card.querySelector('[data-focus]')?.focus({ preventScroll: true }); return; }
    close();
  }
  function onInput(e) {
    if (e.target.id === 'vmOp') {
      st.opacity = e.target.value / 100; if (img) img.style.opacity = st.opacity; e.target.closest('.field').querySelector('.val').textContent = `${e.target.value}%`;
    }
    if (e.target.id === 'vmLens') {
      st.vfovAssumed = +e.target.value; st.lensHeld = true; e.target.closest('.field').querySelector('.val').textContent = `${st.vfovAssumed.toFixed(0)}°`;
      refit(); renderPins(); const dl = card.querySelector('.vm-dl'); if (dl) { const keep = e.target; const html = stepThree(); const tmp = document.createElement('div'); tmp.innerHTML = html; dl.replaceWith(tmp.querySelector('.vm-dl')); card.querySelector('.vm-tab')?.replaceWith(tmp.querySelector('.vm-tab')); card.querySelector('#vmFit').innerHTML = fitLine(); keep.focus?.(); }
    }
  }
  function onChange(e) {
    if (e.target.id === 'vmLm') { const b = card.querySelector('[data-act="use-lm"]'); if (b) b.disabled = !e.target.value; }
    if (e.target.id === 'vmFloor') { st.floor = Math.max(1, Math.min(B.maxFloor(), Math.round(+e.target.value) || st.floor)); e.target.value = st.floor; if (st.photo) st.photo.floor = st.floor; refit(); renderCard(); }
    if (e.target.matches?.('[data-file]')) {
      const f = e.target.files?.[0]; e.target.value = ''; if (!f) return;
      if (!/^image\//.test(f.type)) { B.toast('Choose an image file'); return; }
      choose({ n: 0, source: 'file', url: URL.createObjectURL(f), objectUrl: true, title: f.name.replace(/\.[^.]+$/, '').slice(0, 80), scope: 'unit', path: null });
    }
  }
  function onCard(e) {
    const t = e.target.closest('button'); if (!t) return;
    if (t.dataset.photo) { const it = photoChoices(B.listing()).find((x) => x.n === +t.dataset.photo); if (it) choose({ n: it.n, source: 'listing', url: mediaSrc(it.url), path: it.url, title: it.title, scope: it.scope, floor: it.floor }); return; }
    if (t.dataset.step) { const s = +t.dataset.step; if (s === 3 && !st.result?.ok) return; if (s === 2 && !st.photo) return; st.step = s; renderCard(); return; }
    if (t.dataset.del != null) { removePair(+t.dataset.del); return; }
    switch (t.dataset.act) {
      case 'close': close(); break;
      case 'min': st.min = !st.min; renderCard(); break;
      case 'all-thumbs': st.allThumbs = true; renderCard(); break;
      case 'back': st.step = 1; renderCard(); break;
      case 'to2': st.step = 2; renderCard(); break;
      case 'next': if (st.result?.ok) { st.step = 3; st.status = ''; renderCard(); } break;
      case 'undo': undo(); break;
      case 'reset': reset(); break;
      case 'cancel-pin': { const i = st.pairs.findIndex((q) => !q.target); if (i >= 0) removePair(i); break; }
      case 'arm3d': st.arm3d = !st.arm3d; renderCard(); focusTarget(); break;
      case 'use-lm': { const name = card.querySelector('#vmLm')?.value, l = lms().find((x) => x.name === name), i = st.pairs.findIndex((q) => !q.target); if (l && i >= 0) setTarget(i, { x: l.x, y: l.y, z: l.top }, l.name, 'named'); break; }
      case 'save': save(); break;
      case 'export': exportFile(); break;
      case 'forget': forget(); break;
      default: break;
    }
  }

  /** A photo was chosen: load it, ask for its floor, and go to the landmarks. */
  function choose(p) {
    if (st.photo?.objectUrl && st.photo.url !== p.url) URL.revokeObjectURL(st.photo.url);
    const floor = p.floor || B.floor();
    st.photo = { ...p, floor, aspect: 1.5 }; st.floor = floor; st.pairs = []; st.history = []; st.result = null; st.sub = 'photo'; st.sel = -1; st.status = ''; st.lensHeld = false;
    img.onload = () => { st.photo.aspect = img.naturalWidth / (img.naturalHeight || 1) || 1.5; refit(); layoutFrame(); renderPins(); };
    img.onerror = () => { B.toast('That photo could not be loaded. Try another.'); };
    img.src = p.url; img.style.opacity = st.opacity;
    st.step = 2; renderCard(); register();
    const own = p.source === 'file' || p.scope === 'unit';
    if (!own) B.toast(`${p.scope === 'same-line' ? 'This is the same line' : 'This is another unit'}: floor ${floor}. You can change the floor under Check and save.`, 3600);
    layer.focus({ preventScroll: true });
  }

  // ------------------------------------------------------------------ result: save, export, forget
  function record() {
    const r = st.result, done = pairsDone(), f = facadeFor(r), w = B.windowAt(st.floor);
    const ap = { az_deg: f.kind === 'match' ? r.bearing_deg : f.bearing ?? B.az(), floor: B.floor(), facade_offset_deg: f.offset };
    return buildViewCal({
      site: B.siteId(),
      photo: { n: st.photo.n, path: st.photo.path || null, title: st.photo.title || '', scope: st.photo.scope || 'unit', floor: st.floor, aspect: aspect(), source: st.photo.source },
      eye: { x: w.x, y: w.y, z: B.eyeAt(st.floor) },
      landmarks: done.map((p) => ({ name: p.name, kind: p.kind === 'named' ? 'named' : 'picked', x: p.target.x, y: p.target.y, z: p.target.z, u: p.u, v: p.v })),
      result: r, applied: ap,
    });
  }
  async function save() {
    if (!st.result?.ok || st.saving) return;
    const rec = record(); if (!rec) { B.toast('This match has a number out of range and was not saved.'); return; }
    st.saving = true; renderCard();
    try {
      const out = await saveViewCal(rec, { api: B.api });
      st.saved = out.record; B.onSaved(out.record);
      B.apply(out.record); register();
      st.status = out.where === 'search folder' ? `Saved in your search folder (${out.path || 'view-calibrations'}). The unit now uses it.` : 'Saved in this browser and applied. Export the file to keep it with your search (apartmentscout viewcal import).';
      B.toast(`Measured from ${photoLabel(out.record)}: ${fitLabel(out.record)}`, 4200);
    } catch (e) { st.status = ''; B.toast(e.message || 'Could not save'); }
    st.saving = false; if (st.open) renderCard();
  }
  function exportFile() {
    const rec = st.result?.ok ? record() : null; if (!rec) return;
    try { const f = exportViewCal(rec); B.download(f.filename, f.text, f.type); B.toast('Saved the view calibration file'); } catch (e) { B.toast(e.message); }
  }
  function forget() {
    clearLocal(B.siteId()); st.saved = null; B.onCleared(); st.status = 'The saved match was removed from this browser. A copy in the search folder stays until you delete view-calibrations/' + B.siteId() + '.json.';
    renderCard();
  }

  return { open, close, isOpen: () => st.open, isPicking, pickIn, onMode: (m) => { if (st.open && m !== 'win') close({ keepLook: true }); }, state: st };
}
