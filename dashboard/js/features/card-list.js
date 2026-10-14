// The results column as a windowed, animated list. Only the cards in view (plus a buffer) exist in the DOM, with
// spacers standing in for the rest so the scroll height and scrollbar are right for hundreds of homes. When weights,
// filters or the sort change, the cards that stay on screen are patched in place (no photo reloads, no lost hover
// or focus) and slide to their new positions with a FLIP animation: measure where each card was, apply the new
// order, then animate from the old position to the new one with transforms only (compositor, 60 fps).
//
// What it owns: the card DOM under #cards, the click / keyboard / hover wiring (delegated, so cards that scroll in
// need no listeners of their own), keyboard stepping through the whole list (arrow keys, Home, End, Page Up and
// Down, plus j / k via cardIds), and revealCard() for "scroll the opened listing into view".
// Geometry is virtual-model.js; the patcher is morph.js.
import { S, emit, openDrawer, toggleSave, toggleCompare } from '../app.js';
import { toast } from '../util.js';
import { Layout, includeIndex, flipPlan, nearestScroll, stepIndex } from './virtual-model.js';
import { morph, parse } from './morph.js';

const BUFFER = 700, FLIP_MS = 380, FLIP_FAST_MS = 240;
const mqReduce = matchMedia('(prefers-reduced-motion: reduce)');   // one query object: it is read on every update
const reduced = () => mqReduce.matches;

let host, topSp, botSp, pad = 4;
let layout = new Layout({ gap: 2, estimate: 131 });
let smoothUntil = 0;                         // a smooth scroll to a card is running: do not fight it with position corrections
let items = [], index = new Map();           // item key -> position
let idPos = new Map();                       // listing id (any unit in a group) -> position
const nodes = new Map();                     // item key -> { el, html }
let win = [0, 0], raf = 0, mounted = false, cooldownUntil = 0, lastUpdate = 0, focusKey = null, hovered = null;

/** Item shape: { key, id, ids, html: (indexInWindow) => string, wrap } (wrap: several top-level elements, see buildings). */

// ------------------------------------------------------------------ DOM nodes
function create(item, html) {
  const el = parse(item.wrap ? `<div class="vgroup">${html}</div>` : html);
  el.dataset.vk = item.key;
  el.addEventListener('mouseenter', () => { hovered = item.key; emit('hover', item.id); });
  el.addEventListener('mouseleave', () => { if (hovered === item.key) hovered = null; emit('hover', null); });
  return { el, html };
}
function patch(rec, item, html) {
  const next = parse(item.wrap ? `<div class="vgroup">${html}</div>` : html);
  next.dataset.vk = item.key;
  if (!morph(rec.el, next)) {
    next.addEventListener('mouseenter', () => { hovered = item.key; emit('hover', item.id); });
    next.addEventListener('mouseleave', () => { if (hovered === item.key) hovered = null; emit('hover', null); });
    rec.el.replaceWith(next); rec.el = next;
  }
  rec.html = html;
}
function annotate(el, item, i) {
  const card = el.classList.contains('card') ? el : el.querySelector('.card');
  if (!card) return;
  const pos = String(i + 1), size = String(items.length);
  if (card.getAttribute('aria-posinset') !== pos) card.setAttribute('aria-posinset', pos);
  if (card.getAttribute('aria-setsize') !== size) card.setAttribute('aria-setsize', size);
}

// ------------------------------------------------------------------ geometry and measuring
const scrollTop = () => host.scrollTop;
const viewH = () => host.clientHeight;
function ensureSpacers() {
  if (topSp?.parentNode === host && botSp?.parentNode === host) return;
  host.replaceChildren();
  nodes.clear();
  topSp = document.createElement('div'); topSp.className = 'vsp vsp-top'; topSp.setAttribute('aria-hidden', 'true');
  botSp = document.createElement('div'); botSp.className = 'vsp vsp-bot'; botSp.setAttribute('aria-hidden', 'true');
  host.append(topSp, botSp);
  readMetrics();
}
/** The list's row gap and top padding come from the stylesheet (density changes them): read them, never assume. */
function readMetrics() {
  const cs = getComputedStyle(host), gap = parseFloat(cs.rowGap) || 0;
  pad = parseFloat(cs.paddingTop) || 0;
  layout.gap = gap;
  if (topSp) { topSp.style.marginBottom = -gap + 'px'; botSp.style.marginTop = -gap + 'px'; }   // the gap sits between neighbours only
}
function setSpacers() {
  topSp.style.height = layout.offset(win[0]) + 'px';
  botSp.style.height = Math.max(0, layout.total - layout.offset(win[1])) + 'px';
}
/** Measure rendered cards once the DOM has been laid out; true when any height differs from what the layout assumed. */
function measure() {
  if (!viewH()) return false;   // hidden (another view is open): offsetHeight would be 0
  let changed = false;
  for (const [key, rec] of nodes) if (layout.measure(key, rec.el.getBoundingClientRect().height)) changed = true;
  return changed;
}
function wanted() {
  // after a filter shrinks the list the old scroll position can be past the new end (the browser clamps it later)
  const top = Math.min(scrollTop(), Math.max(0, layout.total + 2 * pad - viewH()));
  let r = layout.range(top - pad, viewH(), BUFFER);
  if (focusKey != null && index.has(focusKey)) r = includeIndex(r, index.get(focusKey), items.length);
  return r;
}

// ------------------------------------------------------------------ reconcile the window with the DOM
function reconcile(a, b, rebuild = true) {
  ensureSpacers();
  const keep = new Set();
  for (let i = a; i < b; i++) keep.add(items[i].key);
  const active = document.activeElement, had = host.contains(active) ? active : null;
  for (const [key, rec] of nodes) if (!keep.has(key)) { rec.el.remove(); nodes.delete(key); if (hovered === key) { hovered = null; emit('hover', null); } }
  let ref = topSp.nextSibling;
  const fresh = [];
  for (let i = a; i < b; i++) {
    const it = items[i];
    let rec = nodes.get(it.key);
    if (!rec) { rec = create(it, it.html(i - a)); nodes.set(it.key, rec); fresh.push(it.key); }
    else if (rebuild) { const html = it.html(i - a); if (rec.html !== html) patch(rec, it, html); }
    if (rec.el !== ref) host.insertBefore(rec.el, ref); else ref = ref.nextSibling;
    annotate(rec.el, it, i);
  }
  win = [a, b];
  // the spacers must match the new window before anything forces a layout: a layout with stale spacers is shorter
  // than the list, and the browser would clamp the scroll position to it
  setSpacers();
  if (had && had.isConnected && document.activeElement !== had) had.focus({ preventScroll: true });   // moving a node blurs it
  return fresh;
}

// ------------------------------------------------------------------ the update that follows a change of data or order
/** Show these items. `animate` is true for the changes the renter made (weights, filters, sort), false for a plain redraw. */
export function setCardItems(next, { animate = true } = {}) {
  if (!host) return;
  const t0 = performance.now();
  ensureSpacers();
  const canMove = animate && mounted && !reduced() && t0 >= cooldownUntil && viewH() > 0;
  // 1. where every rendered card is right now (a card in mid-animation counts where it appears, not where it will land)
  let first = null;
  const oldIndex = index, oldPrefix = layout.prefix;
  if (canMove) {
    first = new Map();
    const hr = host.getBoundingClientRect(), st = scrollTop();
    for (const [key, rec] of nodes) first.set(key, rec.el.getBoundingClientRect().top - hr.top + st);
  }
  // 2. new order
  items = [...new Map(next.map((it) => [it.key, it])).values()];   // one card per key, whatever the data holds
  index = new Map(items.map((it, i) => [it.key, i]));
  idPos = new Map();
  items.forEach((it, i) => { for (const id of it.ids || [it.id]) idPos.set(id, i); });
  layout.setKeys(items.map((it) => it.key));
  const st0 = scrollTop();
  let [a, b] = wanted();
  const fresh = reconcile(a, b);
  // 3. measure, and keep the reader's place if estimates for cards above the window changed
  const anchor = Math.max(0, layout.indexAt(st0 - pad)), before = layout.offset(anchor);
  if (measure()) {
    layout.relayout();
    const shift = layout.offset(anchor) - before;
    if (Math.abs(shift) > 0.5 && st0 > 0 && performance.now() > smoothUntil) host.scrollTop = st0 + shift;
    [a, b] = wanted();
    if (a !== win[0] || b !== win[1]) { reconcile(a, b, false); if (measure()) layout.relayout(); }
  }
  setSpacers();
  // 4. FLIP
  if (canMove) {
    const view = { top: scrollTop(), height: viewH() }, after = new Map(), before2 = new Map();
    for (const [key, rec] of nodes) {
      after.set(key, rec.el.offsetTop);
      let from = first.get(key);
      if (from == null && oldIndex.has(key)) from = oldPrefix[oldIndex.get(key)] + pad;
      if (from != null) before2.set(key, from);
    }
    const plan = flipPlan(before2, after, view);
    const dur = t0 - lastUpdate < 120 ? FLIP_FAST_MS : FLIP_MS;
    for (const m of plan.moves) {
      const el = nodes.get(m.key)?.el; if (!el?.animate) continue;
      el.getAnimations().forEach((x) => { if (!(x instanceof CSSTransition) && !(x instanceof CSSAnimation)) x.cancel(); });   // ours only, not the hover transitions
      const frames = m.appear ? [{ transform: `translateY(${m.dy}px)`, opacity: 0 }, { transform: 'none', opacity: 1 }] : [{ transform: `translateY(${m.dy}px)` }, { transform: 'none' }];
      el.animate(frames, { duration: dur, easing: 'cubic-bezier(.2,.8,.2,1)' });
    }
    enter(plan.entering.filter((k) => fresh.includes(k)));
  } else if (!mounted || animate) enter(fresh);
  mounted = true;
  lastUpdate = t0;
  // a slow update (a big list on a slow device) skips the motion for a moment instead of dropping frames
  if (performance.now() - t0 > 9) cooldownUntil = performance.now() + 160;
}

/** Cards that appear (first render, or a filter that adds homes) rise in with a short stagger. */
function enter(keys) {
  if (reduced() || !keys.length) return;
  const vis = keys.map((k) => nodes.get(k)?.el).filter((el) => el && el.isConnected).slice(0, 14);
  vis.forEach((el, i) => el.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 320, delay: i * 22, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' }));
}

/** Forget every measured height (density, width or font changed) and lay the window out again. */
export function relayoutCardList() {
  if (!host || !items.length) return;
  const st = scrollTop(), at = layout.indexAt(st - pad), intra = st - pad - layout.offset(at);   // keep the card at the top of the view
  readMetrics();
  layout.clear();
  layout.setKeys(items.map((it) => it.key));
  const [a, b] = wanted();
  reconcile(a, b);
  if (measure()) layout.relayout();
  const r = wanted();
  if (r[0] !== win[0] || r[1] !== win[1]) { reconcile(r[0], r[1], false); if (measure()) layout.relayout(); }
  setSpacers();
  host.scrollTop = Math.min(layout.offset(at) + intra + pad, Math.max(0, host.scrollHeight - host.clientHeight));
  const w = wanted();
  if (w[0] !== win[0] || w[1] !== win[1]) { reconcile(w[0], w[1], false); if (measure()) layout.relayout(); setSpacers(); }
}

/** Empty the list (the caller shows its own empty state in #cards). */
export function clearCardList() {
  items = []; index = new Map(); idPos = new Map(); nodes.clear(); win = [0, 0]; topSp = botSp = null; hovered = null;
  layout.setKeys([]);
}

// ------------------------------------------------------------------ scrolling
function syncWindow() {
  if (!items.length) return;
  const [a, b] = wanted();
  if (a === win[0] && b === win[1]) return;
  const st = scrollTop();
  reconcile(a, b, false);
  if (measure()) {
    // estimates above the window were off: keep what the reader is looking at where it is
    const anchor = layout.indexAt(st - pad), before = layout.offset(anchor);
    layout.relayout();
    const shift = layout.offset(anchor) - before;
    if (Math.abs(shift) > 0.5 && performance.now() > smoothUntil) host.scrollTop = st + shift;
  }
  setSpacers();
}
function onScroll() {
  if (raf) return;
  raf = requestAnimationFrame(() => { raf = 0; syncWindow(); });
}

// ------------------------------------------------------------------ public helpers
/** Ids of the items in list order (the best unit of each building in Buildings view). */
export const cardIds = () => items.map((it) => it.id);

/** Position (0-based) of the item that shows a listing id, or undefined. */
export const cardPos = (id) => idPos.get(id);

/** The card element for a listing id, when it is rendered. */
export const cardEl = (id) => {
  const i = idPos.get(id), n = i != null ? nodes.get(items[i]?.key) : null;
  return n ? (n.el.classList.contains('card') ? n.el : n.el.querySelector('.card')) : null;
};

/** Scroll so a listing's card is visible (the least movement), even when it is not rendered yet. */
export function revealCard(id, instant = false) {
  if (!host) return;
  const i = idPos.get(id); if (i == null) return;
  const top = layout.offset(i) + pad, h = (layout.heights.get(items[i].key) ?? layout.estimate()), st = scrollTop(), vh = viewH();
  const to = nearestScroll(st, vh, top, h);
  if (Math.abs(to - st) < 1) return;
  const far = Math.abs(to - st) > vh * 3;
  const jump = instant || far || reduced();
  if (!jump) smoothUntil = performance.now() + 900;
  host.scrollTo({ top: to, behavior: jump ? 'auto' : 'smooth' });
  if (jump) syncWindow();   // render the target now: callers focus it right away
}

/** Move keyboard focus to the card at list position i, rendering it first when it is outside the window. */
function focusAt(i, { open = false } = {}) {
  const it = items[i]; if (!it) return;
  revealCard(it.id, true);
  const [a, b] = wanted();
  if (a !== win[0] || b !== win[1]) { reconcile(a, b, false); if (measure()) layout.relayout(); setSpacers(); }
  const el = cardEl(it.id);
  if (!el) return;
  el.focus({ preventScroll: true });
  const vis = host.getBoundingClientRect(), r = el.getBoundingClientRect();
  if (r.top < vis.top) host.scrollTop -= vis.top - r.top + 4; else if (r.bottom > vis.bottom) host.scrollTop += r.bottom - vis.bottom + 4;
  if (open) openDrawer(it.id, { fly: true });
}

// ------------------------------------------------------------------ wiring
export function initCardList() {
  host = document.getElementById('cards'); if (!host) return;
  host.setAttribute('role', 'feed');
  host.setAttribute('aria-label', 'Homes');
  host.addEventListener('scroll', onScroll, { passive: true });
  let width = host.clientWidth;
  new ResizeObserver(() => {
    // a new width can cross a breakpoint that resizes the cards: measure again; a new height only changes the window
    if (host.clientWidth !== width) { width = host.clientWidth; requestAnimationFrame(relayoutCardList); } else onScroll();   // not in the observer callback itself: that loops
  }).observe(host);
  // card clicks, delegated (composedPath: the quick-action button re-renders its own content during the click)
  host.addEventListener('click', (e) => {
    const path = e.composedPath(), find = (sel) => path.find((n) => n.matches?.(sel) && host.contains(n));
    const sv = find('[data-save]'); if (sv) { toggleSave(sv.dataset.save); return; }
    const cp = find('[data-cmp]');
    if (cp) { const id = cp.dataset.cmp, was = S.compare.includes(id); toggleCompare(id); toast(was ? 'Removed from Compare' : `Added to Compare · ${S.compare.length} of 4`); return; }
    const op = find('[data-open]'); if (op) { openDrawer(op.dataset.open, { fly: true }); return; }
    const card = find('.card'); if (!card || find('.c-acts')) return;
    openDrawer(card.dataset.id, { fly: true });
  });
  host.addEventListener('keydown', (e) => {
    const card = e.target.closest?.('.card');
    if (!card || e.target !== card || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === 'Enter') { openDrawer(card.dataset.id, { fly: true, focus: true }); return; }
    const i = idPos.get(card.dataset.id);
    const page = Math.max(1, Math.floor(viewH() / (layout.estimate() + layout.gap)) - 1);
    const to = stepIndex(i ?? -1, e.key, items.length, page);
    if (to < 0) return;
    e.preventDefault(); e.stopPropagation();
    focusAt(to, { open: !!S.sel });   // with the drawer open, the arrows walk the listings like j / k
  });
  host.addEventListener('focusin', (e) => { const el = e.target.closest?.('[data-vk]'); focusKey = el ? el.dataset.vk : null; });
  host.addEventListener('focusout', (e) => { if (!host.contains(e.relatedTarget)) focusKey = null; });
}
