// First-run coach marks: five short steps (filters, live weights, star, Compare, Unit 3D), shown once per browser,
// skippable at any step, and restartable from the settings menu or the command palette ("Take the tour").
// The tour never starts by itself under browser automation unless the URL has ?coach=1.
import { S, store } from '../app.js';
import { $, esc } from '../util.js';
import { STEPS, shouldAutoStart, nextStep, placeCard } from './coach-core.js';

const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const narrow = () => innerWidth <= 1180;
const phone = () => innerWidth <= 760;

let root = null, spot = null, card = null, idx = 0, has = [], back = null, openedRail = false, raf = 0, railTop = 0;

const TARGETS = {
  filters: () => (narrow() ? $('filtersBtn') : $('rail')),
  weights: () => document.querySelector('#rail .weights')?.closest('.sec') || document.querySelector('#rail .weights'),
  star: () => document.querySelector('#cards .card .save'),
  compare: () => document.querySelector('#cards .card [data-cmp]'),
  unit: () => document.querySelector('#tabs a[data-view="unit"]'),
};

export const coachActive = () => !!root;

/** Resolve a step to an element, opening the filter sheet on narrow screens when the step needs the rail. */
function resolve(step) {
  if (step.target !== 'weights' && $('rail')) $('rail').scrollTop = railTop;   // the weights step scrolls the rail: put it back for the others
  if (step.target === 'weights' && narrow() && !document.body.classList.contains('rail-open')) { document.body.classList.add('rail-open'); openedRail = true; }
  if (step.target !== 'weights' && step.target !== 'filters' && openedRail) { document.body.classList.remove('rail-open'); openedRail = false; }
  const el = TARGETS[step.target]?.();
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? el : null;
}

function layout() {
  if (!root) return;
  const step = STEPS[idx], el = resolve(step);
  if (!el) return;
  el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  const r = el.getBoundingClientRect(), pad = 6;
  const rect = { x: Math.max(4, r.left - pad), y: Math.max(4, r.top - pad), w: Math.min(innerWidth - 8, r.width + pad * 2), h: Math.min(innerHeight - 8, r.height + pad * 2) };
  Object.assign(spot.style, { left: rect.x + 'px', top: rect.y + 'px', width: rect.w + 'px', height: rect.h + 'px' });
  const cr = card.getBoundingClientRect();
  const at = placeCard(rect, { w: cr.width || 320, h: cr.height || 190 }, { w: innerWidth, h: innerHeight });
  card.dataset.dock = at.dock;
  Object.assign(card.style, { left: at.left + 'px', top: at.top + 'px' });
}
const relayout = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(layout); };

function show(i, dir = 1) {
  const step = STEPS[i];
  if (!resolve(step)) {
    const n = nextStep(i, dir, has);
    if (n >= 0) return show(n, dir);
    if (dir > 0) finish();
    return;
  }
  idx = i;
  card.querySelector('#coachStep').textContent = `Step ${i + 1} of ${STEPS.length}`;
  card.querySelector('#coachT').textContent = step.title;
  card.querySelector('#coachB').innerHTML = esc(step.body).replace('{undo}', `<kbd>${mac ? '\u2318' : 'Ctrl'}</kbd><kbd>Z</kbd>`).replace(/\{(\w)\}/g, '<kbd>$1</kbd>');
  card.querySelector('#coachDots').innerHTML = STEPS.map((_, k) => `<i class="${k === i ? 'on' : k < i ? 'seen' : ''}"></i>`).join('');
  card.querySelector('[data-next]').textContent = nextStep(i, 1, has) < 0 ? 'Done' : 'Next';
  card.querySelector('[data-back]').hidden = nextStep(i, -1, has) < 0;
  layout();
  requestAnimationFrame(() => { layout(); card.querySelector('[data-next]').focus({ preventScroll: true }); });
  setTimeout(layout, 400);   // the filter sheet on narrow screens slides in
}

function go(dir) {
  const n = nextStep(idx, dir, has);
  if (n < 0) { if (dir > 0) finish(); return; }
  show(n, dir);
}

export function finish() {
  if (!root) return;
  store.set('coach', { done: true, at: new Date().toISOString().slice(0, 10) });
  removeEventListener('resize', relayout); removeEventListener('scroll', relayout, true);
  document.removeEventListener('keydown', onKey, true);
  root.classList.remove('on');
  const r = root; root = null;
  setTimeout(() => r.remove(), matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 200);
  delete document.body.dataset.coach;
  if (openedRail) { document.body.classList.remove('rail-open'); openedRail = false; }
  if (back?.isConnected && back !== document.body) back.focus?.({ preventScroll: true });
  back = null;
}

function onKey(e) {
  if (!root) return;
  const k = e.key;
  if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(); }
  else if (k === 'ArrowRight' || k === 'Enter' && e.target?.tagName !== 'BUTTON') { e.preventDefault(); e.stopPropagation(); go(1); }
  else if (k === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); go(-1); }
  else if (k === 'Tab') {
    const f = [...card.querySelectorAll('button:not([hidden])')], i = f.indexOf(document.activeElement);
    e.stopPropagation();
    if (!f.length) return;
    if (i < 0) { e.preventDefault(); f[0].focus(); }
    else if (e.shiftKey && i === 0) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
  } else if (k.length === 1 || k === 'Backspace') e.stopPropagation();   // the tour owns the keyboard while it is up
}

/** Start the tour. `force` restarts it even when it was finished before (settings menu, palette). */
export async function startCoach({ force = false } = {}) {
  if (root) return;
  if (!force && store.get('coach', null)?.done) return;
  if (S.view !== 'map') { location.hash = 'map'; await new Promise((r) => setTimeout(r, 450)); }
  document.body.classList.remove('rail-open');
  back = document.activeElement;
  railTop = $('rail')?.scrollTop || 0;
  root = document.createElement('div');
  root.className = 'coach'; root.dataset.coach = '';
  root.innerHTML = `<div class="coach-shield"></div><div class="coach-spot" aria-hidden="true"></div>
    <div class="coach-card" role="dialog" aria-modal="true" aria-labelledby="coachT" aria-describedby="coachB" tabindex="-1">
      <div class="coach-top"><span id="coachStep" class="coach-step"></span><span id="coachDots" class="coach-dots" aria-hidden="true"></span></div>
      <h3 id="coachT"></h3><p id="coachB"></p>
      <div class="coach-act"><button type="button" class="btn ghost sm" data-skip>Skip tour</button><span class="sp"></span><button type="button" class="btn sm" data-back>Back</button><button type="button" class="btn primary sm" data-next>Next</button></div></div>`;
  document.body.append(root);
  document.body.dataset.coach = '';
  spot = root.querySelector('.coach-spot'); card = root.querySelector('.coach-card');
  root.querySelector('[data-skip]').addEventListener('click', finish);
  root.querySelector('[data-next]').addEventListener('click', () => go(1));
  root.querySelector('[data-back]').addEventListener('click', () => go(-1));
  document.addEventListener('keydown', onKey, true);
  addEventListener('resize', relayout); addEventListener('scroll', relayout, true);
  has = STEPS.map((s) => !!TARGETS[s.target]?.());   // which steps have something to point at on this screen
  const first = has.findIndex(Boolean);
  if (first < 0) { finish(); return; }
  show(first);
  requestAnimationFrame(() => root?.classList.add('on'));
}

/** Called once after boot: starts the tour for a first visit, in a normal browser, on the Map. */
export function initCoach() {
  const qs = new URLSearchParams(location.search);
  const ok = shouldAutoStart({
    done: !!store.get('coach', null)?.done, automated: !!navigator.webdriver, forced: qs.get('coach') === '1', hasListings: S.listings.length > 0,
    view: S.view, hasOpen: !!qs.get('open'), wizardOpen: !!document.querySelector('.wz-scrim') || qs.has('new') || qs.has('wizard'),
  });
  if (ok) setTimeout(() => startCoach({ force: qs.get('coach') === '1' }), 1400);
}
