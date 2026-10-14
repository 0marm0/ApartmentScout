// Trade-off pad: a triangle in the weights section of the rail. Drag one dot to trade Cost against Commute against Space
// (or your three heaviest weights); it writes the same integer weights the sliders hold (through setWeights in app.js),
// so every card, pin and score re-ranks live exactly as it does when you drag a slider. Presets sit on the pad as ghost
// dots: hover or focus one to see how the top ten would re-order, click to apply it. The sliders are one click away
// (the Pad / Sliders switch) and stay in step. The maths is in tradeoff-model.js.
import { S, on, store, byId, label, filtered, setWeights, DIMS } from '../app.js';
import { $, esc } from '../util.js';
import { reducedMotion } from './dom.js';
import { CORNERS, toShares, toXY, applyShares, nudgeWeights, sharesOf, groupTotal, defaultAxes, topDims, rankIds, rankShift, pctOf } from './tradeoff-model.js';

// the pad's drawing box (SVG units): the unit triangle scaled to W and placed at (X0, Y0)
const W = 200, X0 = 28, Y0 = 36, VBW = 256, VBH = 252;
const px = ([u, v]) => [X0 + u * W, Y0 + v * W];

let mode = 'pad', axesMode = 'standard', axes = null, block = null, drag = null, raf = 0, settleT = 0, refocus = false;

const keys = () => DIMS.map(([k]) => k);
const nameOf = (k) => DIMS.find(([d]) => d === k)?.[1] || k;
const pct = (k) => pctOf(S.weights, keys(), k);

let frozenTop = null;   // "Top three" is decided when it is switched on, so the corners do not swap while you drag
function chooseAxes() {
  if (axesMode === 'top') axes = frozenTop ||= topDims(S.weights, keys(), 3);
  else { frozenTop = null; axes = defaultAxes(S.crit.weights || S.weights, keys()); }
  return axes;
}
const standardIsTop = () => { const a = defaultAxes(S.crit.weights || S.weights, keys()), t = topDims(S.crit.weights || S.weights, keys(), 3); return a.join() === t.join(); };

// ------------------------------------------------------------------ ranking preview
/** The cards' order with `weights`: homes passing the filters, best match first. */
const order = (weights) => rankIds(filtered(), weights, keys());
function presetList() {
  const P = S.crit.scoring?.presets || {};
  return Object.entries(P).map(([key, p]) => ({ key, label: p.label || key, weights: p.weights || {} }));
}

// ------------------------------------------------------------------ markup
function padSVG() {
  const A = CORNERS.map(px), tri = A.map((p) => p.map((v) => v.toFixed(1)).join(',')).join(' ');
  const lines = [];
  for (let c = 0; c < 3; c++) for (const k of [0.25, 0.5, 0.75]) {
    const a = [0, 0, 0], b = [0, 0, 0]; a[c] = b[c] = k; a[(c + 1) % 3] = 1 - k; b[(c + 2) % 3] = 1 - k;
    const [p, q] = [a, b].map((s) => px(toXY(s)));
    lines.push(`<line x1="${p[0].toFixed(1)}" y1="${p[1].toFixed(1)}" x2="${q[0].toFixed(1)}" y2="${q[1].toFixed(1)}"/>`);
  }
  const [t, l, r] = A;
  return `<svg class="tp-svg" viewBox="0 0 ${VBW} ${VBH}" role="group" aria-label="Trade-off pad: drag the dot between ${axes.map(nameOf).join(', ')}">
    <defs><radialGradient id="tpGlow"><stop offset="0" stop-color="var(--accent)" stop-opacity=".30"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></radialGradient></defs>
    <polygon class="tp-tri" points="${tri}"/><g class="tp-grid" aria-hidden="true">${lines.join('')}</g>
    <circle class="tp-glow" cx="0" cy="0" r="70" fill="url(#tpGlow)" aria-hidden="true"/>
    <g class="tp-lab" aria-hidden="true"><text class="n" x="${t[0]}" y="${t[1] - 20}" text-anchor="middle" data-lab="0">${esc(nameOf(axes[0]))}</text><text class="p" x="${t[0]}" y="${t[1] - 7}" text-anchor="middle" data-pct="0"></text>
      <text class="n" x="${l[0] - 20}" y="${l[1] + 17}" text-anchor="start" data-lab="1">${esc(nameOf(axes[1]))}</text><text class="p" x="${l[0] - 20}" y="${l[1] + 30}" text-anchor="start" data-pct="1"></text>
      <text class="n" x="${r[0] + 20}" y="${r[1] + 17}" text-anchor="end" data-lab="2">${esc(nameOf(axes[2]))}</text><text class="p" x="${r[0] + 20}" y="${r[1] + 30}" text-anchor="end" data-pct="2"></text></g>
    <g class="tp-ghosts"></g>
    <g class="tp-dot" tabindex="0" role="slider" aria-roledescription="2-D trade-off pad" aria-label="Weight split" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" aria-describedby="tpHelp"><circle class="halo" r="15"/><circle class="core" r="8"/></g>
  </svg>`;
}
function blockHTML() {
  const T = groupTotal(S.weights, axes);
  const std = standardIsTop();
  return `<div class="tp-head"><div class="seg tp-seg" role="group" aria-label="How to set the weights"><button type="button" data-m="pad" aria-pressed="${mode === 'pad'}" class="${mode === 'pad' ? 'on' : ''}">Pad</button><button type="button" data-m="sliders" aria-pressed="${mode === 'sliders'}" class="${mode === 'sliders' ? 'on' : ''}">Sliders</button></div>
      ${std ? '' : `<button type="button" class="tp-chip${axesMode === 'top' ? ' on' : ''}" data-a="${axesMode === 'top' ? 'standard' : 'top'}" aria-pressed="${axesMode === 'top'}" title="Trade off your three heaviest weights instead of Cost, Commute and Space">Top three</button>`}</div>
    <div class="tp-pad"${mode === 'pad' ? '' : ' hidden'}>
      ${T > 0 ? `<div class="tp-stage">${padSVG()}</div>
        <p class="tp-live" id="tpLive" aria-live="polite"></p>
        <p class="tp-help" id="tpHelp">Drag the dot or use the arrow keys to shift weight between ${esc(axes.map(nameOf).join(', ').replace(/, ([^,]*)$/, ' and $1'))}. Rings are presets: point at one to preview how the top ten re-orders, click to apply.</p>`
        : `<p class="tp-none">${esc(axes.map(nameOf).join(', '))} all have no weight, so there is nothing to trade off. Raise one on the sliders.</p>`}
    </div>`;
}

// ------------------------------------------------------------------ the dot
const pos = () => { const s = sharesOf(S.weights, axes); return s ? toXY(s) : null; };
/** Move the dot, the glow and the labels to unit position (u, v), and print the shares of the current weights. */
function place(u, v) {
  if (!block) return;
  const [x, y] = px([u, v]), dot = block.querySelector('.tp-dot');
  if (!dot) return;
  dot.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
  const g = block.querySelector('.tp-glow'); g.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
  axes.forEach((k, i) => { const t = block.querySelector(`[data-pct="${i}"]`); if (t) t.textContent = `${pct(k)}%`; });
  const text = axes.map((k) => `${nameOf(k)} ${pct(k)}%`).join(', ');
  dot.setAttribute('aria-valuenow', String(pct(axes[0]))); dot.setAttribute('aria-valuetext', text);
}
function syncDot(snap = true) {
  const p = pos(); if (!p || !block) return;
  const dot = block.querySelector('.tp-dot');
  const glow = block.querySelector('.tp-glow');
  if (snap && dot && !reducedMotion()) { dot.classList.add('snap'); glow?.classList.add('snap'); setTimeout(() => { dot.classList.remove('snap'); glow?.classList.remove('snap'); }, 280); }
  place(p[0], p[1]);
  drawGhosts();
}
function live() {
  const el = block?.querySelector('#tpLive'); if (!el) return;
  const now = order(S.weights), top = byId(now[0]);
  const moved = drag?.base ? rankShift(drag.base, now, 10).changed : null;
  el.innerHTML = top ? `<span class="tl-n"><span>Top match</span> <b>${esc(label(top))}</b></span>${moved ? `<span class="tl-m">${moved}/10 moved</span>` : ''}` : '';
}

function drawGhosts() {
  const g = block?.querySelector('.tp-ghosts'); if (!g) return;
  g.innerHTML = presetList().map((p) => {
    const s = sharesOf(p.weights, axes); if (!s) return '';
    const [x, y] = px(toXY(s));
    const on2 = S.preset === p.key;
    return `<g class="tp-ghost${on2 ? ' cur' : ''}" tabindex="0" role="button" data-preset="${esc(p.key)}" aria-label="${esc(p.label)} preset${on2 ? ' (current)' : ''}: apply. Hover to preview how the top ten re-orders." transform="translate(${x.toFixed(1)} ${y.toFixed(1)})"><circle class="hit" r="12"/><circle class="ring" r="5"/></g>`;
  }).join('');
}

// ------------------------------------------------------------------ pointer and keyboard
function unitAt(e) {
  const svg = block.querySelector('.tp-svg'), r = svg.getBoundingClientRect(), k = VBW / r.width;
  const x = ((e.clientX - r.left) * k - X0) / W, y = ((e.clientY - r.top) * k - Y0) / W;
  const s = toShares(x, y);   // pulls a point outside the triangle onto it
  return { s, p: toXY(s) };
}
let pending = null;
function push(w) {
  pending = w;
  if (raf) return;
  raf = requestAnimationFrame(() => { raf = 0; const x = pending; pending = null; if (x) { setWeights(x); place(...(drag?.p || pos() || [0.5, 0.3])); live(); } });
}
function onDown(e) {
  if (e.button !== 0 || e.target.closest('.tp-ghost')) return;
  const svg = block.querySelector('.tp-svg');
  svg.setPointerCapture(e.pointerId);
  drag = { id: e.pointerId, base: order(S.weights), p: null };
  block.classList.add('dragging');
  e.preventDefault();
  onMove(e);
  block.querySelector('.tp-dot')?.focus({ preventScroll: true });
}
function onMove(e) {
  if (!drag || e.pointerId !== drag.id) return;
  const { s, p } = unitAt(e);
  drag.p = p;
  place(p[0], p[1]);
  push(applyShares(S.weights, axes, s));
}
function onUp(e) {
  if (!drag || e.pointerId !== drag.id) return;
  drag = null;
  block?.classList.remove('dragging');
  cancelAnimationFrame(raf); raf = 0;
  if (pending) { setWeights(pending); pending = null; }
  settle();
}
/** The release of a drag or a pause in key presses: rebuild the rail the way a slider's release does. */
function settle() {
  clearTimeout(settleT);
  refocus = true;
  setWeights({}, { settled: true });
}
function onKey(e) {
  const dir = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }[e.key];
  if (!dir) return;
  e.preventDefault();
  const next = nudgeWeights(S.weights, axes, dir, e.shiftKey ? 5 : 1);
  if (axes.every((k) => next[k] === S.weights[k])) return;
  setWeights(next); place(...pos()); live();
  clearTimeout(settleT); settleT = setTimeout(() => settle(), 600);
}

// ------------------------------------------------------------------ preset preview
let pop = null;
function showPreview(g) {
  const p = presetList().find((x) => x.key === g.dataset.preset); if (!p) return;
  const before = order(S.weights), after = order({ ...S.weights, ...p.weights });
  const r = rankShift(before, after, 10), cur = keys().every((k) => (+S.weights[k] || 0) === (+p.weights[k] || 0));
  hidePreview();
  pop = document.createElement('div');
  pop.className = 'tp-pop'; pop.setAttribute('role', 'tooltip'); pop.id = 'tpPop';
  const chip = (x) => (x.delta == null ? '<i class="d new">new</i>' : x.delta > 0 ? `<i class="d up">▲${x.delta}</i>` : x.delta < 0 ? `<i class="d dn">▼${-x.delta}</i>` : '<i class="d">=</i>');
  pop.innerHTML = `<header><b>${esc(p.label)}</b><span>${cur ? 'Current weights' : 'Top 10 if applied'}</span></header>
    <ol>${r.rows.map((x) => `<li><span class="n">${x.rank}</span><span class="t">${esc(byId(x.id) ? label(byId(x.id)) : x.id)}</span>${chip(x)}</li>`).join('') || '<li class="none">No homes match the filters</li>'}</ol>
    <footer>${r.changed ? `${r.changed} of 10 places change` : 'The top ten stays the same'}${r.out.length ? ` · ${r.out.length} fall out` : ''}<span>Click to apply</span></footer>`;
  document.body.append(pop);
  const a = g.getBoundingClientRect(), rail = $('rail').getBoundingClientRect(), w = 262;
  let left = rail.right + 10;
  if (left + w > innerWidth - 8) left = Math.max(8, Math.min(a.left - w - 8, innerWidth - w - 8));
  const top = Math.max(8, Math.min(a.top - 40, innerHeight - pop.offsetHeight - 8));
  pop.style.left = `${left}px`; pop.style.top = `${top}px`;
  g.setAttribute('aria-describedby', 'tpPop');
}
function hidePreview() { pop?.remove(); pop = null; block?.querySelectorAll('[aria-describedby="tpPop"]').forEach((n) => n.removeAttribute('aria-describedby')); }
function applyPreset(key) {
  hidePreview();
  const sel = $('presetSel'); if (!sel) return;
  sel.value = key; sel.dispatchEvent(new Event('change', { bubbles: true }));   // the rail's own preset path
}

// ------------------------------------------------------------------ mount
function mount() {
  const rail = $('rail'), wts = rail?.querySelector('.weights');
  if (!wts) { block = null; return; }
  const sec = wts.parentElement;
  rail.querySelectorAll('.tp').forEach((n) => n.remove());
  chooseAxes();
  block = document.createElement('div');
  block.className = 'tp'; block.dataset.mode = mode;
  block.innerHTML = blockHTML();
  sec.insertBefore(block, wts);
  sec.dataset.tp = mode;
  wire();
  syncDot(false);
  live();
  if (refocus) { refocus = false; block.querySelector('.tp-dot')?.focus({ preventScroll: true }); }
}
function wire() {
  block.querySelectorAll('[data-m]').forEach((b) => b.addEventListener('click', () => {
    mode = b.dataset.m; store.set('tp-mode', mode);
    block.dataset.mode = mode; block.parentElement.dataset.tp = mode;
    block.querySelector('.tp-pad').hidden = mode !== 'pad';
    block.querySelectorAll('[data-m]').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', String(x === b)); });
    if (mode === 'pad') syncDot(false);
  }));
  block.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', () => { axesMode = b.dataset.a; frozenTop = null; store.set('tp-axes', axesMode); mount(); }));
  const svg = block.querySelector('.tp-svg'); if (!svg) return;
  svg.addEventListener('pointerdown', onDown);
  svg.addEventListener('pointermove', onMove);
  svg.addEventListener('pointerup', onUp);
  svg.addEventListener('pointercancel', onUp);
  svg.addEventListener('keydown', (e) => { if (e.target.closest('.tp-dot')) onKey(e); });
  const gh = svg.querySelector('.tp-ghosts');
  gh.addEventListener('pointerover', (e) => { const g = e.target.closest('.tp-ghost'); if (g && e.pointerType !== 'touch' && !drag) showPreview(g); });
  gh.addEventListener('pointerout', (e) => { if (e.target.closest('.tp-ghost') && !e.relatedTarget?.closest?.('.tp-ghost')) hidePreview(); });
  gh.addEventListener('focusin', (e) => { const g = e.target.closest('.tp-ghost'); if (g) showPreview(g); });
  gh.addEventListener('focusout', hidePreview);
  gh.addEventListener('click', (e) => { const g = e.target.closest('.tp-ghost'); if (g) applyPreset(g.dataset.preset); });
  gh.addEventListener('keydown', (e) => { const g = e.target.closest('.tp-ghost'); if (g && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); applyPreset(g.dataset.preset); } });
}

export function init() {
  mode = store.get('tp-mode', 'pad') === 'sliders' ? 'sliders' : 'pad';
  axesMode = store.get('tp-axes', 'standard') === 'top' ? 'top' : 'standard';
  on('rail', mount);
  // weights moved from somewhere else (a slider, a preset, Reset): follow them
  on('weights', () => { if (!drag && block?.isConnected) { syncDot(); live(); } });
  on('filters', () => { if (block?.isConnected) live(); });
  addEventListener('scroll', hidePreview, true);
  mount();
}
export const state = () => ({ mode, axes, weights: { ...S.weights } });
