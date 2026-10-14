// Photo lightbox: a full-screen viewer for a list of photo items (see photos.js). Opened from the drawer carousel,
// the card photo counts and the Research media gallery.
//
//   - tabs: All / Unit / Same line / Building / Floor plans / Street, with counts; the tabs filter the sequence
//   - swipe, arrow keys, thumbnail strip; neighbours are preloaded
//   - pinch, wheel or double-click/tap to zoom; drag to pan; swipe down to close; Esc closes
//   - floor plan: overlay the listing's plan semi-transparently on the photo, or show it side by side
//   - caption with credit and licence, and a "broker mark" note on flagged photos
//   - a dialog: focus is trapped and returned, the page behind is inert, changes are announced politely
//
// Colours come from the theme tokens, so it follows light and dark. Motion is skipped under prefers-reduced-motion.
import { esc, safeUrl } from '../util.js';
import { groupInfo, tabsOf, inGroup, photoItems } from './photos.js';
import { previewFor } from './lqip.js';

const cfg = { openDrawer: null, label: (L) => `${L?.building || L?.address || ''}${L?.unit ? ' ' + L.unit : ''}`.trim() };
/** Wire the lightbox to the app: { openDrawer(id), label(L) }. */
export const configureLightbox = (c) => Object.assign(cfg, c);

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const IC = {
  x: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
  left: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M10 3L5 8l5 5"/></svg>',
  right: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M6 3l5 5-5 5"/></svg>',
  plus: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M8 3v10M3 8h10"/></svg>',
  minus: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M3 8h10"/></svg>',
  home: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M2.5 7.5L8 3l5.5 4.5M4 6.5V13h8V6.5"/></svg>',
  plan: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><rect x="2" y="2.5" width="12" height="11" rx="1"/><path d="M2 8h5V2.5M10 13.5V9h4M7 8v2.5"/></svg>',
  flag: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M3.5 14V2.5M3.5 3h8l-1.6 2.6L11.5 8h-8"/></svg>',
};
let active = null;

export function creditHTML(it) {
  const c = it.credit || {}, L = it.L;
  const a = (u, t) => (u ? `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(t)}</a>` : esc(t));
  const parts = [];
  const who = c.author || c.note;
  if (who) parts.push(a(c.page, who));
  if (c.license) parts.push(a(c.licenseUrl, c.license));
  if (c.source && c.source !== who) parts.push(esc(c.source));
  if (c.year) parts.push(esc(c.year));
  if (!c.page && it.source === 'photo') { const u = safeUrl(L?.links?.listing); if (u) parts.push(a(u, 'Listing')); }
  return parts.join(' · ');
}

/** Open the viewer. `items` are photo items; start at `index` or at the item with `url`. `from` is the element that
 *  opened it (focus returns there). Set `inDrawer` when the drawer already shows the listing. */
export function openLightbox({ items, index = 0, url = null, from = null, inDrawer = false } = {}) {
  if (!items?.length) return null;
  active?.close(true);
  const returnTo = from || document.activeElement;
  const root = document.createElement('div');
  root.className = 'lbx';
  root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true');
  const single = new Set(items.map((i) => i.L?.id)).size <= 1;
  root.setAttribute('aria-label', single ? `Photos of ${cfg.label(items[0].L)}` : 'Photo viewer');
  const tabs = tabsOf(items);
  root.innerHTML = `<div class="lbx-bg" aria-hidden="true"></div>
    <header class="lbx-top">
      <div class="lbx-who"><b></b><span></span></div>
      <div class="lbx-tabs" role="tablist" aria-label="Photo groups"></div>
      <div class="lbx-tools">
        <button type="button" class="lbx-btn lbx-open" aria-label="Open listing details" hidden>${IC.home}<span>Open listing</span></button>
        <div class="lbx-zoomctl" role="group" aria-label="Zoom"><button type="button" class="lbx-btn ic" data-z="out" aria-label="Zoom out">${IC.minus}</button><output class="lbx-zv tnum" aria-live="off">100%</output><button type="button" class="lbx-btn ic" data-z="in" aria-label="Zoom in">${IC.plus}</button></div>
        <button type="button" class="lbx-btn ic lbx-close" aria-label="Close photo viewer (Esc)" title="Close (Esc)">${IC.x}</button>
      </div>
    </header>
    <div class="lbx-stage" tabindex="-1" aria-label="Photo. Arrow keys move between photos, plus and minus zoom, Escape closes">
      <div class="lbx-pane main"><div class="lbx-zoom"><div class="lbx-ph" aria-hidden="true"></div><img class="lbx-img" alt="" decoding="async" referrerpolicy="no-referrer" draggable="false"><img class="lbx-ov" alt="" aria-hidden="true" decoding="async" referrerpolicy="no-referrer" draggable="false" hidden></div><div class="lbx-dead" hidden>This image is no longer available at its source.</div></div>
      <div class="lbx-pane side" hidden><img class="lbx-planimg" alt="" decoding="async" referrerpolicy="no-referrer" draggable="false"></div>
      <div class="lbx-plan" role="group" aria-label="Floor plan" hidden>
        <span class="lbx-pl">${IC.plan}Plan</span>
        <button type="button" data-pm="off" aria-pressed="true">Off</button><button type="button" data-pm="overlay" aria-pressed="false">Overlay</button><button type="button" data-pm="side" aria-pressed="false">Side by side</button>
        <input type="range" class="lbx-op" min="15" max="90" value="55" aria-label="Floor plan opacity" hidden>
      </div>
      <button type="button" class="lbx-nav prev" aria-label="Previous photo">${IC.left}</button><button type="button" class="lbx-nav next" aria-label="Next photo">${IC.right}</button>
    </div>
    <footer class="lbx-foot">
      <div class="lbx-cap"><span class="lbx-tag"></span><span class="lbx-ttl"></span><span class="lbx-credit"></span><span class="lbx-flag" hidden>${IC.flag}Broker mark</span><span class="lbx-n tnum"></span></div>
      <div class="lbx-strip" role="group" aria-label="Thumbnails"></div>
    </footer>
    <div class="lbx-live" role="status" aria-live="polite"></div>`;
  const $ = (s) => root.querySelector(s);
  const el = { bg: $('.lbx-bg'), who: $('.lbx-who'), tabs: $('.lbx-tabs'), stage: $('.lbx-stage'), main: $('.lbx-pane.main'), zoom: $('.lbx-zoom'), ph: $('.lbx-ph'),
    img: $('.lbx-img'), ov: $('.lbx-ov'), dead: $('.lbx-dead'), side: $('.lbx-pane.side'), sideImg: $('.lbx-planimg'), plan: $('.lbx-plan'), op: $('.lbx-op'),
    prev: $('.prev'), next: $('.next'), tag: $('.lbx-tag'), ttl: $('.lbx-ttl'), credit: $('.lbx-credit'), flag: $('.lbx-flag'), n: $('.lbx-n'), strip: $('.lbx-strip'),
    live: $('.lbx-live'), zv: $('.lbx-zv'), open: $('.lbx-open'), foot: $('.lbx-foot') };

  // ---- state
  let tab = 'all', view = items, cur = 0, planMode = 'off', planOpacity = 55;
  const z = { s: 1, x: 0, y: 0 };
  const pre = new Map();
  const startAt = url ? items.findIndex((i) => i.url === url) : index;
  cur = Math.max(0, startAt);

  // ---- image preload
  const preload = (it) => {
    if (!it || pre.has(it.url)) return;
    const im = new Image(); im.decoding = 'async'; im.referrerPolicy = 'no-referrer'; im.src = it.url;
    pre.set(it.url, im);
    if (pre.size > 16) pre.delete(pre.keys().next().value);
  };

  // ---- zoom and pan
  // the picture's box: as large as fits the pane (small images are not blown up past 2.5x), the aspect from the file,
  // or from its blur-up preview until the file has loaded
  const fit = () => {
    const pw = el.main.clientWidth, ph = el.main.clientHeight, p = previewFor(view[cur]?.keys);
    const nw = el.img.naturalWidth || p?.w || 4, nh = el.img.naturalHeight || p?.h || 3;
    const k = Math.min(pw / nw, ph / nh, 2.5);
    return { w: nw * k, h: nh * k, pw, ph };
  };
  const layout = () => {
    const f = fit();
    if (!f.pw || !f.ph) return;
    el.zoom.style.setProperty('--fw', `${Math.round(f.w)}px`); el.zoom.style.setProperty('--fh', `${Math.round(f.h)}px`);
    el.zoom.classList.add('fit');
    settle(); apply();
  };
  const bounds = () => { const f = fit(); return { x: Math.max(0, (f.w * z.s - f.pw) / 2), y: Math.max(0, (f.h * z.s - f.ph) / 2) }; };
  const apply = () => {
    el.zoom.style.transform = `translate3d(${z.x}px,${z.y}px,0) scale(${z.s})`;
    root.classList.toggle('zoomed', z.s > 1.001);
    el.zv.textContent = `${Math.round(z.s * 100)}%`;
  };
  const settle = () => { const b = bounds(); z.x = clamp(z.x, -b.x, b.x); z.y = clamp(z.y, -b.y, b.y); };
  const setZoom = (s, px = 0, py = 0, animate = false) => {
    const k = clamp(s, 1, 6) / z.s;
    z.x = px - (px - z.x) * k; z.y = py - (py - z.y) * k; z.s *= k;
    if (z.s < 1.001) { z.s = 1; z.x = 0; z.y = 0; }
    settle();
    if (animate && !reduced()) { el.zoom.style.transition = 'transform 200ms var(--ease-out)'; setTimeout(() => (el.zoom.style.transition = ''), 220); }
    apply();
  };
  const resetZoom = () => { z.s = 1; z.x = 0; z.y = 0; apply(); };
  const rel = (e) => { const r = el.main.getBoundingClientRect(); return [e.clientX - r.left - r.width / 2, e.clientY - r.top - r.height / 2]; };

  // ---- rendering
  const labelOf = (it) => cfg.label(it.L);
  function renderTabs() {
    const all = [{ key: 'all', label: 'All', n: items.length }, ...tabs];
    el.tabs.hidden = tabs.length < 2;
    el.tabs.innerHTML = all.map((t) => `<button type="button" role="tab" id="lbxT-${t.key}" data-tab="${t.key}" aria-selected="${t.key === tab}" tabindex="${t.key === tab ? 0 : -1}">${esc(t.label)}<i class="tnum">${t.n}</i></button>`).join('');
  }
  function renderStrip() {
    el.strip.innerHTML = view.map((it, i) => {
      const p = previewFor(it.keys);
      return `<button type="button" class="lbx-th${it.flagged ? ' flagged' : ''}" data-i="${i}" tabindex="${i === cur ? 0 : -1}" aria-label="Photo ${i + 1} of ${view.length}: ${esc(groupInfo(it.group).long)}${single ? '' : ', ' + esc(labelOf(it))}${it.flagged ? ', carries a broker mark' : ''}"${i === cur ? ' aria-current="true"' : ''}${p ? ` style="background-image:url(${p.src})"` : ''}><img src="${esc(it.url)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer"></button>`;
    }).join('');
    el.strip.querySelectorAll('img').forEach((im) => im.addEventListener('error', () => im.closest('.lbx-th')?.classList.add('err'), { once: true }));
  }
  function markStrip() {
    el.strip.querySelectorAll('.lbx-th').forEach((b, i) => {
      const on = i === cur;
      b.toggleAttribute('aria-current', on); if (on) b.setAttribute('aria-current', 'true');
      b.tabIndex = on ? 0 : -1;
    });
    const b = el.strip.children[cur];
    if (b) { const r = el.strip.getBoundingClientRect(), br = b.getBoundingClientRect(); el.strip.scrollBy({ left: br.left - r.left - (r.width - br.width) / 2, behavior: reduced() ? 'auto' : 'smooth' }); }
  }
  const planOf = (it) => (it.group === 'plan' ? null : photoItems(it.L).find((p) => p.group === 'plan') || null);
  function renderPlan(it) {
    const plan = planOf(it);
    el.plan.hidden = !plan;
    if (!plan) { setPlanMode('off', true); return; }
    if (el.ov.getAttribute('src') !== plan.url) el.ov.src = plan.url;
    if (el.sideImg.getAttribute('src') !== plan.url) el.sideImg.src = plan.url;
    const fb = (im) => im.addEventListener('error', () => { if (plan.remote && im.src !== plan.remote) im.src = plan.remote; }, { once: true });
    fb(el.ov); fb(el.sideImg);
  }
  function setPlanMode(m, quiet = false) {
    planMode = m;
    root.dataset.plan = m;
    el.ov.hidden = m !== 'overlay';
    el.side.hidden = m !== 'side';
    el.op.hidden = m !== 'overlay';
    el.ov.style.opacity = String(planOpacity / 100);
    el.plan.querySelectorAll('[data-pm]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.pm === m)));
    if (m === 'side') resetZoom();
    requestAnimationFrame(layout);
    if (!quiet) say(m === 'off' ? 'Floor plan hidden' : m === 'overlay' ? 'Floor plan overlaid on the photo' : 'Floor plan shown beside the photo');
  }
  function say(t) { el.live.textContent = ''; setTimeout(() => (el.live.textContent = t), 30); }

  function show(i, dir = 0) {
    cur = ((i % view.length) + view.length) % view.length;
    const it = view[cur], info = groupInfo(it.group);
    resetZoom();
    el.dead.hidden = true;
    const p = previewFor(it.keys);
    el.ph.style.backgroundImage = p ? `url(${p.src})` : '';
    root.style.setProperty('--amb', p ? `url(${p.src})` : 'none');
    const done = () => { el.img.classList.add('on'); el.zoom.classList.add('ld'); layout(); };
    el.zoom.classList.remove('ld');
    el.img.onload = done;
    el.img.onerror = () => {
      if (it.remote && !el.img.dataset.fb) { el.img.dataset.fb = '1'; el.img.src = it.remote; return; }
      el.img.classList.remove('on'); el.dead.hidden = false;
    };
    delete el.img.dataset.fb;
    if (el.img.getAttribute('src') !== it.url) { el.img.classList.remove('on'); el.img.src = it.url; }
    layout();
    if (el.img.complete && el.img.naturalWidth) done();
    el.img.alt = `${info.long} photo ${cur + 1} of ${view.length}, ${labelOf(it)}`;
    el.img.classList.toggle('plan', it.group === 'plan');
    // caption
    const who = labelOf(it);
    el.who.firstElementChild.textContent = who;
    el.who.lastElementChild.textContent = it.L?.neighborhood || '';
    el.open.hidden = inDrawer || !it.L?.id || !cfg.openDrawer;
    el.tag.textContent = info.label; el.tag.dataset.g = it.group;
    el.ttl.textContent = it.credit?.title || '';
    el.credit.innerHTML = creditHTML(it);
    el.flag.hidden = !it.flagged;
    el.flag.title = it.flagged ? `Carries a broker mark (${(it.why || []).join(', ') || 'watermark'}); shown last in its group` : '';
    el.n.textContent = `${cur + 1} / ${view.length}`;
    el.prev.disabled = el.next.disabled = view.length < 2;
    el.prev.hidden = el.next.hidden = view.length < 2;
    renderPlan(it);
    markStrip();
    say(`Photo ${cur + 1} of ${view.length}. ${info.long}.${it.credit?.title ? ' ' + it.credit.title + '.' : ''}${it.flagged ? ' Carries a broker mark.' : ''}`);
    // animate in from the side we came from
    if (dir && !reduced()) el.zoom.animate([{ transform: `translate3d(${dir * 56}px,0,0)`, opacity: 0 }, { transform: 'translate3d(0,0,0)', opacity: 1 }], { duration: 280, easing: 'cubic-bezier(.2,.8,.2,1)' });
    for (const d of [1, -1, 2, -2]) preload(view[(cur + d + view.length) % view.length]);
  }
  function setTab(key) {
    if (key === tab) return;
    const keep = view[cur];
    tab = key; view = inGroup(items, tab);
    renderTabs(); renderStrip();
    const at = view.indexOf(keep);
    show(at >= 0 ? at : 0);
    el.tabs.querySelector('[aria-selected="true"]')?.focus();
  }
  const go = (d) => { if (view.length > 1) show(cur + d, d > 0 ? 1 : -1); };

  // ---- gestures: swipe to move, pinch / wheel / double-click to zoom, drag to pan, pull down to close
  const pts = new Map();
  let g = null, lastTap = 0;
  el.stage.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button, input, a, .lbx-plan')) return;
    el.stage.setPointerCapture?.(e.pointerId);
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.size === 2) {
      const [a, b] = [...pts.values()], [mx, my] = rel({ clientX: (a[0] + b[0]) / 2, clientY: (a[1] + b[1]) / 2 });
      g = { kind: 'pinch', d0: Math.hypot(a[0] - b[0], a[1] - b[1]), s0: z.s, x0: z.x, y0: z.y, mx, my };
    } else if (pts.size === 1) {
      const [px, py] = rel(e), f = fit();   // the picture itself, not the letterbox around it
      const onImg = e.target === el.sideImg || (Math.abs(px - z.x) <= (f.w * z.s) / 2 && Math.abs(py - z.y) <= (f.h * z.s) / 2);
      g = { kind: 'pending', x: e.clientX, y: e.clientY, x0: z.x, y0: z.y, t: performance.now(), moved: false, onImg };
    }
  });
  el.stage.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId) || !g) return;
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (g.kind === 'pinch' && pts.size >= 2) {
      const [a, b] = [...pts.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      const [mx, my] = rel({ clientX: (a[0] + b[0]) / 2, clientY: (a[1] + b[1]) / 2 });
      const s = clamp(g.s0 * (d / g.d0), 1, 6), cx = (g.mx - g.x0) / g.s0, cy = (g.my - g.y0) / g.s0;
      z.s = s; z.x = mx - cx * s; z.y = my - cy * s;
      if (s === 1) { z.x = 0; z.y = 0; } else settle();
      apply(); return;
    }
    const dx = e.clientX - g.x, dy = e.clientY - g.y;
    if (g.kind === 'pending') {
      if (Math.hypot(dx, dy) < 8) return;
      g.moved = true;
      g.kind = z.s > 1.001 ? 'pan' : Math.abs(dx) > Math.abs(dy) ? 'swipe' : dy > 0 ? 'pull' : 'none';
    }
    if (g.kind === 'pan') { z.x = g.x0 + dx; z.y = g.y0 + dy; settle(); apply(); }
    else if (g.kind === 'swipe') { z.x = dx; apply(); }
    else if (g.kind === 'pull') { z.y = dy; apply(); root.style.setProperty('--dim', String(clamp(1 - dy / 420, 0.2, 1))); el.zoom.style.scale = String(clamp(1 - dy / 1600, 0.85, 1)); }
  });
  const release = (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    if (!g) return;
    if (g.kind === 'pinch') { if (pts.size < 2) { g = pts.size === 1 ? { kind: 'none' } : null; if (z.s < 1.02) resetZoom(); } return; }
    const gg = g; g = null;
    const dx = e.clientX - gg.x, dy = e.clientY - gg.y, dt = performance.now() - gg.t;
    const back = () => { el.zoom.style.transition = 'transform 220ms var(--ease-out), scale 220ms var(--ease-out)'; setTimeout(() => (el.zoom.style.transition = ''), 240); };
    if (gg.kind === 'swipe') {
      if (Math.abs(dx) > 70 || (Math.abs(dx) > 28 && Math.abs(dx) / dt > 0.45)) { z.x = 0; apply(); go(dx < 0 ? 1 : -1); } else { back(); z.x = 0; apply(); }
    } else if (gg.kind === 'pull') {
      root.style.removeProperty('--dim'); el.zoom.style.scale = '';
      if (dy > 110 || dy / dt > 0.6) close(); else { back(); z.y = 0; apply(); }
    } else if (gg.kind === 'pending' && !gg.moved) {
      // a tap: two quick taps zoom (touch and pen; a mouse has dblclick); a tap on the empty backdrop closes
      const now = performance.now();
      if (e.pointerType !== 'mouse' && now - lastTap < 320 && gg.onImg) { const [px, py] = rel(e); setZoom(z.s > 1.01 ? 1 : 2.6, px, py, true); lastTap = 0; }
      else { lastTap = now; if (!gg.onImg && z.s <= 1.001 && e.target.closest('.lbx-pane, .lbx-stage') && !e.target.closest('.lbx-nav')) close(); }
    }
  };
  el.stage.addEventListener('pointerup', release);
  el.stage.addEventListener('pointercancel', (e) => { g = null; pts.clear(); root.style.removeProperty('--dim'); el.zoom.style.scale = ''; z.x = z.s > 1.001 ? z.x : 0; z.y = z.s > 1.001 ? z.y : 0; apply(); });
  el.stage.addEventListener('dblclick', (e) => { if (e.target.closest('button, input, a, .lbx-plan')) return; const [px, py] = rel(e); setZoom(z.s > 1.01 ? 1 : 2.6, px, py, true); });
  el.stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (!e.ctrlKey && Math.abs(e.deltaX) > Math.abs(e.deltaY) * 1.4 && z.s <= 1.001) {   // a sideways trackpad swipe moves between photos
      const now = performance.now(); if (now - (wheelAt || 0) > 380 && Math.abs(e.deltaX) > 14) { wheelAt = now; go(e.deltaX > 0 ? 1 : -1); } return;
    }
    const [px, py] = rel(e), dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    if (planMode === 'side') return;
    setZoom(z.s * Math.exp(-dy * (e.ctrlKey ? 0.012 : 0.0016)), px, py);
  }, { passive: false });
  let wheelAt = 0;

  // ---- keyboard
  const focusables = () => [...root.querySelectorAll('button:not([disabled]):not([hidden]), a[href], input:not([hidden])')].filter((x) => !x.closest('[hidden]') && x.tabIndex !== -1 || x === document.activeElement);
  const onKey = (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key, inTabs = !!e.target.closest?.('.lbx-tabs'), inRange = e.target === el.op;
    if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (k === 'Tab') {
      const f = focusables(), a = f.indexOf(document.activeElement);
      if (!f.length) return;
      if (e.shiftKey && a <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && (a === f.length - 1 || a === -1)) { e.preventDefault(); f[0].focus(); }
      return;
    }
    if (inRange && (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'ArrowUp' || k === 'ArrowDown')) { e.stopPropagation(); return; }
    if (inTabs && (k === 'ArrowLeft' || k === 'ArrowRight')) {
      e.preventDefault(); e.stopPropagation();
      const keys = [...el.tabs.querySelectorAll('[role=tab]')].map((b) => b.dataset.tab), i = keys.indexOf(tab);
      setTab(keys[(i + (k === 'ArrowRight' ? 1 : -1) + keys.length) % keys.length]); return;
    }
    const used = () => { e.preventDefault(); e.stopPropagation(); };
    if (k === 'ArrowRight') { used(); go(1); } else if (k === 'ArrowLeft') { used(); go(-1); }
    else if (k === 'Home') { used(); show(0, -1); } else if (k === 'End') { used(); show(view.length - 1, 1); }
    else if (k === '+' || k === '=') { used(); setZoom(z.s * 1.5, 0, 0, true); }
    else if (k === '-' || k === '_') { used(); setZoom(z.s / 1.5, 0, 0, true); }
    else if (k === '0') { used(); setZoom(1, 0, 0, true); }
    else if ((k === 'f' || k === 'F') && !el.plan.hidden) { used(); setPlanMode(planMode === 'off' ? 'overlay' : planMode === 'overlay' ? 'side' : 'off'); }
    else if (k.length === 1 && !(e.target.matches?.('input, textarea'))) e.stopPropagation();   // the app's single-key shortcuts stay quiet while the viewer is open
  };

  // ---- wiring
  el.tabs.addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) setTab(b.dataset.tab); });
  el.strip.addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (b) { const i = +b.dataset.i; show(i, i > cur ? 1 : -1); } });
  el.prev.addEventListener('click', () => go(-1)); el.next.addEventListener('click', () => go(1));
  $('.lbx-close').addEventListener('click', () => close());
  el.open.addEventListener('click', () => { const id = view[cur]?.L?.id; close(true); if (id) cfg.openDrawer?.(id, { fly: true }); });
  root.querySelectorAll('[data-z]').forEach((b) => b.addEventListener('click', () => setZoom(z.s * (b.dataset.z === 'in' ? 1.5 : 1 / 1.5), 0, 0, true)));
  el.plan.addEventListener('click', (e) => { const b = e.target.closest('[data-pm]'); if (b) setPlanMode(b.dataset.pm); });
  el.op.addEventListener('input', () => { planOpacity = +el.op.value; el.ov.style.opacity = String(planOpacity / 100); });
  addEventListener('resize', layout);
  document.addEventListener('keydown', onKey, true);

  // ---- open / close
  const inerted = [];
  for (const n of document.body.children) if (!n.inert && !['SCRIPT', 'STYLE', 'LINK'].includes(n.tagName)) { n.inert = true; inerted.push(n); }
  document.body.append(root);
  renderTabs(); renderStrip(); show(cur);
  if (!reduced()) {
    root.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: 'ease-out' });
    el.zoom.animate([{ transform: 'scale(.96)', opacity: 0.2 }, { transform: 'none', opacity: 1 }], { duration: 320, easing: 'cubic-bezier(.2,.8,.2,1)' });
  }
  el.stage.focus({ preventScroll: true });
  setPlanMode('off', true);

  function close(now = false) {
    if (!active || active.root !== root) return;
    active = null;
    document.removeEventListener('keydown', onKey, true);
    removeEventListener('resize', layout);
    const finish = () => {
      root.remove();
      for (const n of inerted) n.inert = false;
      if (returnTo?.isConnected) returnTo.focus?.({ preventScroll: true });
    };
    if (now || reduced()) finish();
    else { for (const n of inerted) n.inert = false; root.style.pointerEvents = 'none'; root.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, easing: 'ease-in' }).finished.then(finish, finish); if (returnTo?.isConnected) returnTo.focus?.({ preventScroll: true }); }
  }
  active = { root, close, show, setTab, get index() { return cur; }, get view() { return view; } };
  return active;
}

/** The viewer that is open now, or null (tests and the Research gallery use it). */
export const currentLightbox = () => active;
