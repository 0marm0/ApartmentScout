// The measuring tape in a three.js view: click two points on the floor, a wall or a piece of furniture and read the distance
// in feet and inches (and metres when the search is metric). Used by the Floor plan studio's 3D pane and by Unit 3D's Inside
// camera through a small adapter; everything else (what a click means, what it snaps to, how a length reads) is measure/core.js.
//
// The pointer: a click (a press and release that barely moves) places a point; a drag still orbits or looks around, because
// this layer never captures the pointer. Esc finishes. Backspace or Delete removes the last measurement.
import * as THREE from 'three';
import { measureLabel, snapTargets, pickSnap, snapLabel } from './core.js';
import { mountMeasureButtons, mountHint } from './ui.js';
import { ribbon, setRibbonSize } from './ribbon.js';

const HINT = 'Click two points to measure. It snaps to wall corners, window edges and furniture edges. Backspace removes the last one, Esc finishes.';
const CLICK_PX = 5;

let dotTex = null;
function dotTexture() {
  if (dotTex) return dotTex;
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.beginPath(); g.arc(32, 32, 26, 0, Math.PI * 2); g.fill();
  dotTex = new THREE.CanvasTexture(c); dotTex.colorSpace = THREE.SRGBColorSpace; dotTex.userData.shared = true; return dotTex;
}
const cssColor = (name, fallback) => { try { const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim(); return /^#|^rgb|^hsl/i.test(v) ? v : fallback; } catch { return fallback; } };

/**
 * @param {object} ad the adapter
 * @param {string} ad.name 'studio' | 'unit' (the id prefix of the buttons)
 * @param {HTMLCanvasElement} ad.canvas @param {HTMLElement} ad.stage the element the labels live in
 * @param {HTMLElement|null} ad.toolbar the toolbar the Measure button joins (null: a floating group); `iconButton`: it is a column of icons
 * @param {() => THREE.Camera} ad.camera
 * @param {() => THREE.Object3D|null} ad.parent where the lines live; plan points are converted to its local space
 * @param {(p: number[]) => THREE.Vector3} ad.toLocal plan inches [x, y, z] -> parent-local
 * @param {(v: THREE.Vector3) => number[]} ad.fromLocal parent-local -> plan inches
 * @param {() => THREE.Object3D[]} ad.targets what a click can land on
 * @param {() => object|null} ad.model normalised plan @param {() => object[]} ad.items resolved furniture
 * @param {() => import('./stores.js').storeFor} ad.store the store of what is on screen
 * @param {() => boolean} ad.available is there something to measure in this view right now
 * @param {() => boolean} ad.metric @param {() => void} ad.redraw ask the host to draw a frame
 * @param {boolean} [ad.swallowClick] keep a measuring click from reaching the host's own click handler
 */
export function createMeasure3D(ad) {
  const group = new THREE.Group(); group.name = 'measure'; group.userData.measure = true;
  group.clone = () => new THREE.Group();   // a scene export (the apartment's .glb) clones its parent: the tape is not part of the model
  const labelsEl = Object.assign(document.createElement('div'), { className: 'ms-labels' }); labelsEl.setAttribute('aria-hidden', 'false');
  ad.stage.appendChild(labelsEl);
  const hint = mountHint(ad.stage, HINT);
  const tip = Object.assign(document.createElement('div'), { className: 'ms-tip', hidden: true }); ad.stage.appendChild(tip);
  const btn = mountMeasureButtons(ad.toolbar, ad.stage, { label: 'Measure', icon: !!ad.iconButton, id: `${ad.name}Measure`, onToggle: (on) => setActive(on), onClear: () => ad.store()?.clear() });

  let active = false, hover = null, raf = 0, down = null, store = null, unsub = null, chips = new Map(), lastCam = '', geoKey = '', cache = { sig: '', t: null };
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), tmp = new THREE.Vector3();
  const color = () => cssColor('--accent', '#f0b429');

  // ---------------------------------------------------------------- state
  function bind() {   // follow whichever store is on screen (another unit, another plan)
    const s = ad.store();
    if (s === store) return;
    unsub?.(); store = s; unsub = s?.subscribe(() => { geoKey = ''; lastCam = ''; btn.count(store.count); kick(); }) || null;
    geoKey = ''; lastCam = ''; btn.count(store?.count || 0); kick();
  }
  function setActive(on) {
    active = !!on && ad.available();
    btn.set(active); hover = null; hint.show(active); tip.hidden = true;
    ad.canvas.style.cursor = active ? 'crosshair' : '';
    if (!active) store?.cancelPending();
    geoKey = ''; kick(); ad.redraw();
  }
  function visible() { return ad.available() && !!ad.parent(); }
  const kick = () => { if (!raf) raf = requestAnimationFrame(tick); };

  // ---------------------------------------------------------------- picking
  const rect = () => ad.canvas.getBoundingClientRect();
  function usable(o) {
    if (!o.isMesh || o.userData.measure) return false;
    for (let q = o; q; q = q.parent) if (q.visible === false) return false;
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    if (!m || m.colorWrite === false || m.visible === false || (m.transparent && m.opacity < 0.05)) return false;
    return !/^(decal|outline|zone|grid)$/.test(o.name || '');
  }
  /** Bring the camera's and the parent's matrices up to date once per operation (not per point). */
  function prep() {
    const cam = ad.camera(), par = ad.parent(); if (!cam || !par) return false;
    cam.updateMatrixWorld(); cam.matrixWorldInverse.copy(cam.matrixWorld).invert(); par.updateWorldMatrix(true, false);
    return true;
  }
  function hitAt(ev) {
    const r = rect(), cam = ad.camera(); if (!cam || !r.width || !prep()) return null;
    ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, cam);
    const hits = ray.intersectObjects(ad.targets().filter(Boolean), true);
    const h = hits.find((x) => usable(x.object)); if (!h) return null;
    const par = ad.parent(); if (!par) return null;
    return ad.fromLocal(par.worldToLocal(h.point.clone()));
  }
  function targets() {
    const m = ad.model(); if (!m) return { points: [], segments: [] };
    const items = ad.items() || [], sig = `${m.id}|${m.rooms.length}|${m.windows.length}|${items.map((i) => `${i.id}:${i.x},${i.y},${i.rot},${i.w},${i.d},${i.h},${i.elev || 0},${i.hidden ? 1 : 0}`).join(';')}`;
    if (cache.sig !== sig) cache = { sig, t: snapTargets(m, items) };
    return cache.t;
  }
  /** Screen position (px inside the canvas) of a plan point, or null behind the camera. */
  function screenOf(p) {
    const cam = ad.camera(), par = ad.parent(), r = rect(); if (!cam || !par || !r.width) return null;
    tmp.copy(ad.toLocal(p)).applyMatrix4(par.matrixWorld).project(cam);
    if (tmp.z > 1 || tmp.z < -1) return null;
    return [((tmp.x + 1) / 2) * r.width, ((1 - tmp.y) / 2) * r.height];
  }
  function snapFor(ev) {
    const hit = hitAt(ev); if (!hit) return null;
    const r = rect(), cam = ad.camera(), par = ad.parent();
    const camPlan = ad.fromLocal(par.worldToLocal(cam.getWorldPosition(new THREE.Vector3()))), far = Math.hypot(camPlan[0] - hit[0], camPlan[1] - hit[1], camPlan[2] - hit[2]);
    return pickSnap(targets(), hit, [ev.clientX - r.left, ev.clientY - r.top], screenOf, { px: 14, world: Math.max(24, far * 0.06) });
  }

  // ---------------------------------------------------------------- pointer
  const onDown = (ev) => {
    if (!active || ev.button !== 0 || ev.target !== ad.canvas) { down = null; return; }
    down = { x: ev.clientX, y: ev.clientY, id: ev.pointerId, t: performance.now() };
  };
  const onMove = (ev) => {
    if (!active || ev.target !== ad.canvas) return;
    if (ev.pointerType === 'touch' && ev.buttons) return;
    hover = snapFor(ev);
    const r = rect(); tip.hidden = !hover?.snapped; if (hover?.snapped) { tip.textContent = snapLabel(hover.kind); tip.style.left = `${ev.clientX - r.left + 14}px`; tip.style.top = `${ev.clientY - r.top + 16}px`; }
    geoKey = ''; kick();
  };
  const onUp = (ev) => {
    const d = down; down = null;
    if (!active || !d || ev.pointerId !== d.id || ev.target !== ad.canvas) return;
    if (Math.hypot(ev.clientX - d.x, ev.clientY - d.y) > CLICK_PX || performance.now() - d.t > 900) return;
    const s = snapFor(ev); if (!s) return;
    if (ad.swallowClick) ev.stopPropagation();   // Unit 3D opens a building card on a click: not when the click is a measurement (its camera is the look-around one, which needs no pointerup)
    ad.store().place(s.p, s.kind);
    hover = s; geoKey = ''; kick();
  };
  const onKey = (ev) => {
    if (!active) return;
    const tag = ev.target?.tagName;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || ev.metaKey || ev.ctrlKey || ev.altKey) return;
    if (ev.key === 'Escape') { ev.preventDefault(); ev.stopImmediatePropagation(); setActive(false); }
    else if (ev.key === 'Backspace' || ev.key === 'Delete') { ev.preventDefault(); ev.stopImmediatePropagation(); ad.store().removeLast(); }
  };
  ad.stage.addEventListener('pointerdown', onDown, true);
  ad.stage.addEventListener('pointermove', onMove, true);
  ad.stage.addEventListener('pointerup', onUp, true);
  ad.stage.addEventListener('pointerleave', () => { hover = null; tip.hidden = true; geoKey = ''; kick(); });
  window.addEventListener('keydown', onKey, true);
  labelsEl.addEventListener('click', (e) => { const x = e.target.closest('[data-ms-del]'); if (x) ad.store().remove(+x.dataset.msDel); });

  // ---------------------------------------------------------------- drawing
  let mats = null;
  function materials() {
    const c = new THREE.Color(color());
    if (mats && mats.c === c.getHex()) return mats;
    mats?.dispose();
    const dot = new THREE.PointsMaterial({ color: c, size: 10, sizeAttenuation: false, map: dotTexture(), alphaTest: 0.4, depthTest: false, depthWrite: false, transparent: true, toneMapped: false });
    const snap = new THREE.PointsMaterial({ color: 0xffffff, size: 14, sizeAttenuation: false, map: dotTexture(), alphaTest: 0.4, depthTest: false, depthWrite: false, transparent: true, toneMapped: false });
    mats = { c: c.getHex(), dot, snap, dispose() { for (const m of [dot, snap]) m.dispose(); } };
    return mats;
  }
  function clearGroup() { while (group.children.length) { const o = group.children.pop(); o.geometry?.dispose(); if (o.userData.ribbon) o.material.dispose(); } }
  function rebuild() {
    clearGroup();
    const M = materials(), S = store; if (!S) return;
    const ends = [], pairs = [];
    for (const m of S.list) { const a = ad.toLocal(m.a), b = ad.toLocal(m.b); pairs.push([a, b]); ends.push(a, b); }
    const col = new THREE.Color(color());
    if (pairs.length) { const l = ribbon(pairs, { color: col, width: 3 }); l.renderOrder = 30; group.add(l); }
    if (ends.length) { const p = new THREE.Points(new THREE.BufferGeometry().setFromPoints(ends), M.dot); p.renderOrder = 31; p.frustumCulled = false; group.add(p); }
    if (active && S.pending) {
      const a = ad.toLocal(S.pending.p), pA = new THREE.Points(new THREE.BufferGeometry().setFromPoints([a]), M.dot); pA.renderOrder = 31; pA.frustumCulled = false; group.add(pA);
      if (hover) { const l = ribbon([[a, ad.toLocal(hover.p)]], { color: col, width: 2.5, dash: 7, opacity: 0.9 }); l.renderOrder = 30; group.add(l); }
    }
    if (active && hover?.snapped) { const s = new THREE.Points(new THREE.BufferGeometry().setFromPoints([ad.toLocal(hover.p)]), M.snap); s.renderOrder = 32; s.frustumCulled = false; group.add(s); }
    else if (active && hover) { const s = new THREE.Points(new THREE.BufferGeometry().setFromPoints([ad.toLocal(hover.p)]), M.dot); s.renderOrder = 32; s.frustumCulled = false; group.add(s); }
    const r = rect(); setRibbonSize(group, r.width || 800, r.height || 600);
    ad.redraw();
  }
  function chipFor(key, cls) {
    let c = chips.get(key);
    if (!c) { c = document.createElement('div'); c.className = `ms-chip ${cls}`; labelsEl.appendChild(c); chips.set(key, c); }
    return c;
  }
  function layout() {
    const S = store, seen = new Set(), opts = { metric: ad.metric() };
    prep(); { const r = rect(); setRibbonSize(group, r.width || 800, r.height || 600); }
    const place = (key, a, b, cls, id) => {
      const L = measureLabel(a, b, opts), m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, ((a[2] || 0) + (b[2] || 0)) / 2], s = screenOf(m);
      const c = chipFor(key, cls); seen.add(key);
      const html = `<b>${L.primary}</b>${L.secondary ? `<span>${L.secondary}</span>` : ''}${L.detail ? `<small>${L.detail}</small>` : ''}${id != null ? `<button type="button" data-ms-del="${id}" aria-label="Remove this measurement" title="Remove">×</button>` : ''}`;
      if (c.dataset.html !== html) { c.innerHTML = html; c.dataset.html = html; c.title = L.title; }
      c.hidden = !s; if (s) { c.style.left = `${s[0]}px`; c.style.top = `${s[1]}px`; }
    };
    for (const m of S?.list || []) place(`m${m.id}`, m.a, m.b, 'done', m.id);
    if (active && S?.pending && hover) place('live', S.pending.p, hover.p, 'live', null);
    for (const [k, c] of chips) if (!seen.has(k)) { c.remove(); chips.delete(k); }
  }
  function tick() {
    raf = 0;
    bind();
    const par = ad.parent(), show = visible();
    if (par && group.parent !== par) { group.removeFromParent(); par.add(group); geoKey = ''; }
    if (!par) group.removeFromParent();
    group.visible = show; labelsEl.hidden = !show;
    btn.show(ad.available());
    if (!ad.available() && active) setActive(false);
    if (!show) { for (const [, c] of chips) c.remove(); chips.clear(); lastCam = ''; return; }
    const gk = `${store?.list.length}|${store?.pending ? 1 : 0}|${hover ? hover.p.join(',') : ''}|${active}|${color()}`;
    if (gk !== geoKey || !group.children.length && (store?.count || active)) { geoKey = gk; rebuild(); }
    const cam = ad.camera();
    if (cam) {
      cam.updateMatrixWorld();
      const ck = `${cam.matrixWorld.elements.map((v) => v.toFixed(3)).join(',')}|${cam.fov}|${cam.aspect}|${geoKey}|${ad.metric()}`;
      if (ck !== lastCam) { lastCam = ck; layout(); }
    }
    if (store?.count || active || chips.size) kick();   // follow the camera while there is something to label
  }

  bind(); kick();
  return {
    group, button: btn,
    get active() { return active; },
    setActive, screenOf, tick: kick,
    /** Plan point -> client pixels, for tests. */
    clientOf(p) { const s = screenOf(p), r = rect(); return s ? [r.left + s[0], r.top + s[1]] : null; },
    dispose() { unsub?.(); group.removeFromParent(); clearGroup(); labelsEl.remove(); hint.remove(); tip.remove(); window.removeEventListener('keydown', onKey, true); mats?.dispose(); },
  };
}
