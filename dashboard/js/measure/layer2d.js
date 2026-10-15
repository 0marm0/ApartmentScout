// The measuring tape on the Floor plan studio's 2D drawing: click two points and read the distance along the floor, snapping to
// wall corners, window and door edges and furniture edges. Same store, snaps and readings as the 3D view (measure/core.js), so a
// measurement made here is in the room too. Drawn into the plan's own SVG (SVG y = -plan y), at a constant size on screen.
import { measureLabel, snapTargets, flattenTargets, pickSnap, snapLabel } from './core.js';
import { mountMeasureButtons, mountHint } from './ui.js';

const NS = 'http://www.w3.org/2000/svg';
const CLICK_PX = 5;
const el = (tag, attrs = {}, text) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (text != null) e.textContent = text; return e; };

/**
 * @param {object} ad {svg, wrap, toolbar, toPlan(clientX, clientY) -> [x, y], model(), items(), store(), metric(), available(), isLocked?}
 */
export function createMeasure2D(ad) {
  const hint = mountHint(ad.wrap, 'Click two points to measure along the floor. It snaps to wall corners, window edges and furniture edges. Esc finishes.');
  const btn = mountMeasureButtons(ad.toolbar, ad.wrap, { label: 'Measure', id: `${ad.name || 'plan'}Measure2d`, onToggle: (on) => setActive(on), onClear: () => ad.store()?.clear() });
  let active = false, hover = null, down = null, store = null, unsub = null, g = null, cache = { sig: '', t: null };
  const point = ad.svg.createSVGPoint();

  function bind() {
    const s = ad.store(); if (s === store) return;
    unsub?.(); store = s; unsub = s?.subscribe(() => { btn.count(store.count); draw(); }) || null; btn.count(store?.count || 0);
  }
  function setActive(on) {
    active = !!on && ad.available(); btn.set(active); hint.show(active); hover = null;
    ad.svg.style.cursor = active ? 'crosshair' : '';
    if (!active) store?.cancelPending();
    draw();
  }
  function targets() {
    const m = ad.model(); if (!m) return { points: [], segments: [] };
    const items = ad.items() || [], sig = `${m.id}|${m.rooms.length}|${items.map((i) => `${i.id}:${i.x},${i.y},${i.rot},${i.w},${i.d},${i.hidden ? 1 : 0}`).join(';')}`;
    if (cache.sig !== sig) cache = { sig, t: flattenTargets(snapTargets(m, items)) };
    return cache.t;
  }
  const clientOf = (p) => { const m = ad.svg.getScreenCTM(); if (!m) return null; point.x = p[0]; point.y = -p[1]; const q = point.matrixTransform(m); return [q.x, q.y]; };
  function snapFor(ev) {
    const m = ad.svg.getScreenCTM(); if (!m) return null;
    const xy = ad.toPlan(ev.clientX, ev.clientY), hit = [xy[0], xy[1], 0];
    return pickSnap(targets(), hit, [ev.clientX, ev.clientY], clientOf, { px: 12, world: 1e9 });
  }

  // ---------------------------------------------------------------- pointer
  const inSvg = (ev) => ad.svg.contains(ev.target);
  ad.wrap.addEventListener('pointerdown', (ev) => { down = active && ev.button === 0 && inSvg(ev) && !ev.target.closest?.('[data-ms-del]') ? { x: ev.clientX, y: ev.clientY, id: ev.pointerId, t: performance.now() } : null; }, true);
  ad.wrap.addEventListener('pointermove', (ev) => {
    if (!active || !inSvg(ev) || (ev.pointerType === 'touch' && ev.buttons)) return;
    hover = snapFor(ev); draw();
  }, true);
  ad.wrap.addEventListener('pointerleave', () => { hover = null; draw(); });
  ad.wrap.addEventListener('pointerup', (ev) => {
    const d = down; down = null;
    if (!active || !d || ev.pointerId !== d.id || !inSvg(ev)) return;
    if (Math.hypot(ev.clientX - d.x, ev.clientY - d.y) > CLICK_PX || performance.now() - d.t > 900) return;
    const s = snapFor(ev); if (!s) return;
    ad.store().place(s.p, s.kind); hover = s; draw();
  }, true);
  window.addEventListener('keydown', (ev) => {
    if (!active) return;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(ev.target?.tagName) || ev.metaKey || ev.ctrlKey || ev.altKey) return;
    if (ev.key === 'Escape') { ev.preventDefault(); ev.stopImmediatePropagation(); setActive(false); }
    else if (ev.key === 'Backspace' || ev.key === 'Delete') { ev.preventDefault(); ev.stopImmediatePropagation(); ad.store().removeLast(); }
  }, true);
  new MutationObserver(() => draw()).observe(ad.svg, { attributes: true, attributeFilter: ['viewBox'] });

  // ---------------------------------------------------------------- drawing
  function draw() {
    bind();
    if (!g || g.ownerSVGElement !== ad.svg) { g?.remove(); g = el('g', { id: 'p2measure', class: 'ms-g2d' }); }
    if (g.parentNode !== ad.svg || g.nextSibling) ad.svg.appendChild(g);   // always on top, also after the plan was rebuilt
    btn.show(ad.available());
    if (!ad.available()) { g.replaceChildren(); return; }
    const m = ad.svg.getScreenCTM(), k = m ? Math.max(0.05, m.a) : 1, fs = 11 / k, opts = { metric: ad.metric() };
    const out = [], S = store;
    const dot = (p, cls = '') => el('circle', { cx: p[0], cy: -p[1], r: 4 / k, class: `ms2-dot ${cls}` });
    const line = (a, b, cls = '') => el('line', { x1: a[0], y1: -a[1], x2: b[0], y2: -b[1], class: `ms2-line ${cls}`, 'vector-effect': 'non-scaling-stroke' });
    const chip = (a, b, cls, id) => {
      const L = measureLabel(a, b, opts), mx = (a[0] + b[0]) / 2, my = -(a[1] + b[1]) / 2, text = L.primary + (L.secondary ? ` · ${L.secondary}` : '');
      const w = text.length * fs * 0.6 + fs * 1.4 + (id != null ? fs * 1.4 : 0), h = fs * 1.9, grp = el('g', { class: `ms2-chip ${cls}` });
      const t = el('title'); t.textContent = L.title; grp.append(t);
      grp.append(el('rect', { x: mx - w / 2, y: my - h / 2, width: w, height: h, rx: h / 2 }), el('text', { x: mx - (id != null ? fs * 0.7 : 0), y: my + fs * 0.34, 'font-size': fs, 'text-anchor': 'middle' }, text));
      if (id != null) { const x = el('g', { class: 'ms2-del', 'data-ms-del': id, role: 'button', 'aria-label': 'Remove this measurement' }); x.append(el('circle', { cx: mx + w / 2 - fs * 1.1, cy: my, r: fs * 0.62 }), el('text', { x: mx + w / 2 - fs * 1.1, y: my + fs * 0.34, 'font-size': fs, 'text-anchor': 'middle' }, '×')); grp.append(x); }
      return grp;
    };
    for (const mm of S?.list || []) out.push(line(mm.a, mm.b), dot(mm.a), dot(mm.b), chip(mm.a, mm.b, 'done', mm.id));
    if (active && S?.pending) {
      out.push(dot(S.pending.p));
      if (hover) out.push(line(S.pending.p, hover.p, 'live'), chip(S.pending.p, hover.p, 'live', null));
    }
    if (active && hover) { out.push(el('circle', { cx: hover.p[0], cy: -hover.p[1], r: (hover.snapped ? 7 : 4) / k, class: `ms2-snap${hover.snapped ? ' on' : ''}` })); if (hover.snapped) out.push(el('text', { x: hover.p[0] + 11 / k, y: -hover.p[1] - 9 / k, 'font-size': fs * 0.92, class: 'ms2-tip' }, snapLabel(hover.kind))); }
    g.replaceChildren(...out);
  }
  ad.svg.addEventListener('click', (ev) => { const x = ev.target.closest?.('[data-ms-del]'); if (x) { ev.stopPropagation(); ad.store().remove(+x.getAttribute('data-ms-del')); } }, true);
  bind();
  return {
    button: btn, redraw: draw, setActive,
    get active() { return active; },
    clientOf,
  };
}
