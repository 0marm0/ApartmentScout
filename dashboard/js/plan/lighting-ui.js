// The lighting design extensions of the Floor plan studio's Light tab: relative daylight on a sensor grid (heat map on
// the plan and on the 3D floor), glass / frame / blinds / surface inputs with assumed-or-source labels, editable
// luminaires with a lamp-light estimate and a night preview, and the annual daylight summary. The studio (plan3d.js)
// owns the state it already had and calls into this module through a small api; everything new lives here.
//
// What each output is (shown next to it): MODELLED = the relative daylight model (not lux, not calibrated);
// ESTIMATE = lamps by inverse-square and cosine (no bounce, no walls, no shadows); VISUAL PREVIEW = brightness, tint and
// glow in the 3D view.
import { esc } from '../util.js';
import { store } from '../app.js';
import { GLAZING_PRESETS, FRAME_PRESETS, SURFACE_PRESETS, BLINDS_T, MODEL_LABEL } from '../features/daylight-core.js';
import {
  defaultInputs, cleanInputs, cleanLuminaires, reflectances, sourceCount, presetFor, daylightGrids, lampGrids, furnitureLuminaires,
  newLuminaire, LUM_TYPES, LUM_ORDER, LUM_LIMITS, kelvinCss, SURFACE_KEYS, LUX_GUIDE,
} from './lighting-model.js';
import { SCALES, heatCanvas, legendHTML, valueAt, fmtVal } from './heatmap.js';
import { pointInPoly } from './model.js';
import * as L3 from './lighting3d.js';
import { annualFor, annualBlock } from '../unit/daylight-annual.js';
import { BLINDS_LABEL } from './light.js';

const NS = 'http://www.w3.org/2000/svg';
const lx = {
  api: null, inputs: defaultInputs(), luminaires: [], view: 'daylight', heat2d: false, heat3d: false, plane: 'floor',
  sel: null, win: 0, info: null, raf: 0, cache: {}, tip: null, ready3d: false, modelId: 0, drag: null,
};
const ids = new WeakMap(); let idSeq = 0;
const idOf = (o) => (o ? ids.get(o) || (ids.set(o, ++idSeq), idSeq) : 0);
const prefKey = () => `plan-lx.${lx.api.base()}`;
const savePrefs = () => store.set(prefKey(), { view: lx.view, heat2d: lx.heat2d, heat3d: lx.heat3d, plane: lx.plane });
const KIND_PILL = { modelled: 'Modelled', estimate: 'Estimate', preview: 'Visual preview' };
const pill = (k) => `<span class="pill lx-kind lx-${k}" title="${k === 'modelled' ? esc(MODEL_LABEL) : k === 'estimate' ? 'Inverse-square and cosine from each lamp, no bounce, no walls, no shadows' : 'What the 3D view shows; brightness and glow are for looking, not measuring'}">${KIND_PILL[k]}</span>`;
const f1 = (v, d = 1) => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(d));
const ft = (inches) => `${(inches / 12).toFixed(1)}`;

// ------------------------------------------------------------------ public api (called by plan3d.js)
/** Wire the module to the studio. `api` supplies the studio's live state (see plan3d.js lightingApi). */
export function init(api) {
  lx.api = api;
  const pref = store.get(prefKey(), {});
  if (pref && typeof pref === 'object') {
    lx.view = ['daylight', 'lamps', 'year'].includes(pref.view) ? pref.view : 'daylight';
    lx.heat2d = !!pref.heat2d; lx.heat3d = !!pref.heat3d; lx.plane = pref.plane === 'work' ? 'work' : 'floor';
  }
  const svg = api.svg();
  svg.addEventListener('pointerdown', down2D, true);
  svg.addEventListener('pointermove', tip2D);
  svg.addEventListener('pointerleave', () => hideTip());
  svg.addEventListener('keydown', key2D);
  window.addEventListener('pointermove', move2D);
  window.addEventListener('pointerup', up2D);
}
/** After the 3D scene exists. */
export function attach3D() { if (!lx.ready3d) { L3.attach(); lx.ready3d = true; } }
/** A plan was loaded or an undo restored `light` (the studio's stored lighting object). */
export function load(light = {}) {
  lx.inputs = cleanInputs(light.daylight); lx.luminaires = cleanLuminaires(light.luminaires);
  lx.sel = null; lx.cache = {}; lx.heatKey = null; lx.modelId = idOf(lx.api.model());
  syncSurfaces(); push3D(); schedule();
}
/** The new keys of the studio's lighting object (only those that differ from the defaults, so saved projects stay small). */
export function extras() {
  const out = {};
  if (JSON.stringify(lx.inputs) !== JSON.stringify(defaultInputs())) out.daylight = lx.inputs;
  if (lx.luminaires.length) out.luminaires = lx.luminaires;
  return out;
}
/** Options for the studio's room daylight table (plan/light.js roomDaylight): the frame factor and the room surfaces. */
export function dfOptions() {
  const d = defaultInputs(), custom = JSON.stringify(reflectances(lx.inputs)) !== JSON.stringify(reflectances(d));
  return {
    glazed: lx.inputs.frame.glazed,
    reflectance: custom ? (room, floorM2, wallM2) => { const r = reflectances(lx.inputs), a = 2 * floorM2 + wallM2; return a > 0 ? (floorM2 * (r.floor + r.ceiling) + wallM2 * r.walls) / a : 0.5; } : 0.5,
    custom,
  };
}
/** The sun moved or the date changed (called from the studio's refreshSun). `info` = {az, alt, lat, lon, tz, y, m, d, fraction, place}. */
export function refresh(info) { lx.info = info; schedule(); }
/** Furniture changed (lamps among them). */
export function itemsChanged() { if (lx.view === 'lamps' || lx.heat2d || lx.heat3d) { lx.cache.lamps = null; schedule(); } }
/** The 2D svg was rebuilt (plan2d.setModel): put the overlay groups back. */
export function reattach2D() { render2D(); }
/** Render the Light tab extensions into `el` (the studio's #psLightX). */
export function panel(el) {
  if (!el || !lx.api) return;
  if (lx.el !== el) { lx.el = el; lx.built = false; }
  if (!lx.built) { build(el); lx.built = true; }
  syncControls();
  scheduleResults();
}
/** True while a luminaire pointer drag is in progress (the studio's drag handlers must stay out of it). */
export const dragging = () => !!lx.drag;
/** Number of luminaires that are switched on (for the studio's HUD line). */
export const count = () => lx.luminaires.filter((l) => l.on !== false).length;

// ------------------------------------------------------------------ computing
function schedule() { if (lx.raf) return; lx.raf = requestAnimationFrame(() => { lx.raf = 0; flush(); }); }
let resRaf = 0;
function scheduleResults() { if (resRaf) return; resRaf = requestAnimationFrame(() => { resRaf = 0; flush(); }); }

function sunKey() { const i = lx.info; return i && i.alt > 0 ? `${Math.round(i.az)}|${Math.round(i.alt)}` : 'night'; }
function daylightData() {
  const a = lx.api, m = a.model(), skies = a.skies(), i = lx.info;
  if (!m || !skies) return { rooms: [], skipped: [], unavailable: 'no city model for this plan' };
  const clear = lx.inputs.sky === 'clear';
  if (clear && (!i || i.alt <= 0)) return { rooms: [], skipped: [], night: true };
  const vt = a.vt(), blinds = a.blinds();
  const key = [idOf(m), idOf(skies), vt, blinds, JSON.stringify(lx.inputs), clear ? sunKey() : 'oc'].join('|');
  if (lx.cache.daylight?.key === key) return lx.cache.daylight.data;
  const sky = clear ? { kind: 'clear', sunAz: Math.round(i.az), sunAlt: Math.max(1, Math.round(i.alt)) } : null;
  const t0 = performance.now();
  const data = daylightGrids(m, skies, { vt, inputs: lx.inputs, blinds: BLINDS_T[blinds] ?? 1, sky });
  data.ms = Math.round(performance.now() - t0);
  lx.cache.daylight = { key, data };
  return data;
}
function lampData() {
  const a = lx.api, m = a.model();
  if (!m) return { rooms: [] };
  const all = [...lx.luminaires, ...furnitureLuminaires(a.items())];
  const key = [idOf(m), lx.plane, JSON.stringify(all.map((l) => [l.id, l.x, l.y, l.z, l.lm, l.beam, l.on, l.x2, l.y2]))].join('|');
  if (lx.cache.lamps?.key === key) return lx.cache.lamps.data;
  const data = lampGrids(m, all, { plane: lx.plane });
  data.count = all.length; data.fromFurniture = all.filter((l) => l.fromFurniture).length;
  lx.cache.lamps = { key, data };
  return data;
}
const wantsHeat = () => lx.heat2d || lx.heat3d;
const activeSource = () => (lx.view === 'lamps' ? 'lamps' : 'daylight');

function flush() {
  if (!lx.api?.model()) return;
  const live = !!lx.el?.isConnected, src = activeSource();
  const data = wantsHeat() || (live && lx.view !== 'year') ? (src === 'lamps' ? lampData() : daylightData()) : null;
  lx.data = data; lx.dataSrc = src;
  const key = `${src}|${idOf(data)}|${lx.heat2d}|${lx.heat3d}`;
  if (key !== lx.heatKey) {   // the grids (and so the images) only change when their inputs do
    lx.heatKey = key; lx.rooms = [];
    if (data && wantsHeat()) {
      const scale = src === 'lamps' ? SCALES.lux : SCALES.daylight;
      for (const r of data.rooms) {
        const mr = lx.api.model().rooms.find((q) => q.name === r.room);
        if (!mr || !r.stats) continue;
        const canvas = heatCanvas(r, scale);
        lx.rooms.push({ ...r, poly: mr.poly, canvas, url: lx.heat2d && canvas ? canvas.toDataURL() : null });
      }
    }
    render2D();
    if (lx.ready3d) L3.setHeat(lx.heat3d ? lx.rooms : [], 0.82);
  }
  if (live) results();
}
function push3D() {
  if (!lx.ready3d) return;
  L3.setLuminaires(lx.luminaires, lx.api.model()?.ceiling || 108);
  L3.select(lx.sel);
}
function syncSurfaces() { if (lx.api.setSurfaces) lx.api.setSurfaces(reflectances(lx.inputs)); }

// ------------------------------------------------------------------ 2D overlay
function ensureGroup(svg, id, before) {
  let g = svg.querySelector('#' + id);
  if (!g) { g = document.createElementNS(NS, 'g'); g.id = id; if (before) svg.insertBefore(g, before); else svg.appendChild(g); }
  return g;
}
const pts = (poly) => poly.map(([x, y]) => `${Math.round(x * 10) / 10},${Math.round(-y * 10) / 10}`).join(' ');
function render2D() {
  const svg = lx.api?.svg(); if (!svg || !lx.api.model()) return;
  const heat = ensureGroup(svg, 'p2heat', svg.querySelector('.p2-grids'));
  if (lx.heat2d && lx.rooms?.length) {
    heat.innerHTML = lx.rooms.map((r, i) => r.url ? `<clipPath id="lxclip${i}"><polygon points="${pts(r.poly)}"/></clipPath><image class="lx-heat" href="${r.url}" x="${r.x0In}" y="${-(r.y0In + r.ny * r.stepIn)}" width="${r.nx * r.stepIn}" height="${r.ny * r.stepIn}" preserveAspectRatio="none" clip-path="url(#lxclip${i})"><title>${esc(r.room)}</title></image>` : '').join('');
  } else heat.innerHTML = '';
  svg.setAttribute('role', lx.luminaires.length ? 'group' : 'img');   // an image may not contain focusable luminaires
  const g = ensureGroup(svg, 'p2lum');
  // the glyphs are redrawn on every change: keep keyboard focus on the one the renter is moving
  const fid = lx.focusId || document.activeElement?.closest?.('[data-lum]')?.getAttribute('data-lum');
  g.innerHTML = lx.luminaires.map(glyph).join('');
  lx.focusId = null;
  if (fid) [...g.querySelectorAll('[data-lum]')].find((n) => n.getAttribute('data-lum') === fid)?.focus({ preventScroll: true });
}
function glyph(l) {
  const sel = l.id === lx.sel, c = kelvinCss(l.k), dim = l.on === false ? ' off' : '';
  const label = `${l.label}, ${LUM_TYPES[l.type].name.toLowerCase()}, ${Math.round(l.lm)} lumens, ${Math.round(l.k)} kelvin${l.on === false ? ', off' : ''}`;
  const head = `<g class="lx-g${sel ? ' sel' : ''}${dim}" data-lum="${esc(l.id)}" tabindex="0" role="button" aria-label="${esc(label)}">`;
  if (l.type === 'strip') {
    return `${head}<line class="lx-strip-hit" x1="${l.x}" y1="${-l.y}" x2="${l.x2}" y2="${-l.y2}"/><line class="lx-strip-halo" x1="${l.x}" y1="${-l.y}" x2="${l.x2}" y2="${-l.y2}"/><line class="lx-strip" style="stroke:${c}" x1="${l.x}" y1="${-l.y}" x2="${l.x2}" y2="${-l.y2}"/>${sel ? `<circle class="lx-end" data-lum-end="${esc(l.id)}" cx="${l.x2}" cy="${-l.y2}" r="4.5"/><circle class="lx-sel-ring" cx="${l.x}" cy="${-l.y}" r="8"/>` : ''}<title>${esc(label)}</title></g>`;
  }
  const r = l.type === 'floor' ? 5 : l.type === 'pendant' ? 6 : 3.4;
  return `${head}<circle class="lx-hit" cx="${l.x}" cy="${-l.y}" r="11"/>${sel ? `<circle class="lx-sel-ring" cx="${l.x}" cy="${-l.y}" r="${r + 5}"/>` : ''}<circle class="lx-body ${l.type}" cx="${l.x}" cy="${-l.y}" r="${r}" style="fill:${c}"/>${l.type === 'recessed' ? `<circle class="lx-dot" cx="${l.x}" cy="${-l.y}" r="1.3"/>` : ''}${l.type === 'floor' ? `<path class="lx-rays" d="M${l.x - 9} ${-l.y}h-4M${l.x + 9} ${-l.y}h4M${l.x} ${-l.y - 9}v-4M${l.x} ${-l.y + 9}v4"/>` : ''}<title>${esc(label)}</title></g>`;
}

// 2D interaction: drag a luminaire, hover readout, keyboard nudge
function down2D(e) {
  const g = e.target.closest?.('[data-lum]'), end = e.target.closest?.('[data-lum-end]');
  if (!g && !end) return;
  const id = (end || g).getAttribute(end ? 'data-lum-end' : 'data-lum'), l = lx.luminaires.find((q) => q.id === id);
  if (!l || e.button > 0) return;
  e.stopPropagation(); e.preventDefault();
  const p = lx.api.toPlan(e.clientX, e.clientY);
  lx.api.checkpoint(); lx.focusId = id;
  lx.drag = { id, end: !!end, ox: (end ? l.x2 : l.x) - p[0], oy: (end ? l.y2 : l.y) - p[1], moved: false, x0: e.clientX, y0: e.clientY };
  select(id, false);
}
function move2D(e) {
  const d = lx.drag; if (!d) return;
  if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 3) return;
  d.moved = true;
  const l = lx.luminaires.find((q) => q.id === d.id); if (!l) return;
  const p = lx.api.toPlan(e.clientX, e.clientY), nx = Math.round(p[0] + d.ox), ny = Math.round(p[1] + d.oy);
  if (d.end) { l.x2 = nx; l.y2 = ny; }
  else { if (l.type === 'strip') { const dx = nx - l.x, dy = ny - l.y; l.x2 += dx; l.y2 += dy; } l.x = nx; l.y = ny; }
  lampsChanged(false);
}
function up2D() { if (!lx.drag) return; const moved = lx.drag.moved; lx.drag = null; if (moved) { lampsChanged(true); } }
function key2D(e) {
  const g = e.target.closest?.('[data-lum]'); if (!g) return;
  const l = lx.luminaires.find((q) => q.id === g.getAttribute('data-lum')); if (!l) return;
  const n = e.shiftKey ? 6 : 1;
  const mv = { ArrowLeft: [-n, 0], ArrowRight: [n, 0], ArrowUp: [0, n], ArrowDown: [0, -n] }[e.key];
  if (mv) { e.preventDefault(); e.stopPropagation(); lx.api.checkpoint(); l.x += mv[0]; l.y += mv[1]; if (l.type === 'strip') { l.x2 += mv[0]; l.y2 += mv[1]; } lampsChanged(true); }
  else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); e.stopPropagation(); remove(l.id); }
  else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(l.id, true); }
}
function tip2D(e) {
  if (!lx.api.model() || lx.drag || !(lx.heat2d && lx.rooms?.length)) { hideTip(); return; }
  const [x, y] = lx.api.toPlan(e.clientX, e.clientY), r = lx.rooms.find((q) => pointInPoly([x, y], q.poly));
  const v = r ? valueAt(r, x, y) : null;
  if (v == null) { hideTip(); return; }
  const sc = lx.dataSrc === 'lamps' ? SCALES.lux : SCALES.daylight, wrap = lx.api.svg().parentElement;
  if (!lx.tip) { lx.tip = document.createElement('div'); lx.tip.className = 'lx-tip'; lx.tip.setAttribute('aria-hidden', 'true'); wrap.appendChild(lx.tip); }
  const b = wrap.getBoundingClientRect();
  lx.tip.hidden = false; lx.tip.style.left = `${Math.min(b.width - 140, e.clientX - b.left + 12)}px`; lx.tip.style.top = `${Math.max(4, e.clientY - b.top - 34)}px`;
  lx.tip.innerHTML = `<b>${fmtVal(v, sc)}</b> ${sc.kind}`;
}
const hideTip = () => { if (lx.tip) lx.tip.hidden = true; };

// ------------------------------------------------------------------ luminaire edits
function lampsChanged(commit) {
  lx.cache.lamps = null;
  push3D(); render2D(); schedule();
  if (commit) { lx.api.persist(); syncEditor(); }
}
function select(id, focusEditor) {
  lx.sel = id; L3.select?.(id); render2D();
  if (lx.view !== 'lamps') setView('lamps'); else { syncEditor(); }
  if (focusEditor) lx.el?.querySelector('[data-lf="label"]')?.focus();
}
/** A point in the room not on top of an existing luminaire: the label point, else the first free spot on a 4 ft ring around it. */
function freeSpot(room, existing) {
  const [cx, cy] = room.label, ring = [[0, 0], [48, 0], [-48, 0], [0, 48], [0, -48], [48, 48], [-48, -48], [48, -48], [-48, 48], [96, 0], [-96, 0], [0, 96], [0, -96]];
  for (const [dx, dy] of ring) {
    const x = cx + dx, y = cy + dy;
    if (pointInPoly([x, y], room.poly) && !existing.some((l) => Math.hypot(l.x - x, l.y - y) < 30)) return [x, y];
  }
  return [cx, cy];
}
function add(type) {
  const m = lx.api.model(); if (!m) return;
  lx.api.checkpoint();
  const room = m.rooms.filter((r) => r.kind !== 'closet' && r.kind !== 'outdoor').sort((a, b) => b.area - a.area)[0] || m.rooms[0];
  if (lx.luminaires.length >= LUM_LIMITS.count) { lx.api.toast(`Keep at most ${LUM_LIMITS.count} luminaires`); return; }
  const at = freeSpot(room, lx.luminaires), l = newLuminaire(type, at[0], at[1], m.ceiling || 108, lx.luminaires);
  lx.luminaires.push(l); lx.sel = l.id; lx.cache.lamps = null;
  if (!lx.heat2d && !lx.heat3d) { lx.heat2d = true; lx.heat3d = true; savePrefs(); }
  push3D(); render2D(); lx.api.persist(); setView('lamps', true);
  lx.api.toast(`Added a ${LUM_TYPES[type].name.toLowerCase()} (${LUM_TYPES[type].lm} lm, ${LUM_TYPES[type].k} K, assumed). Drag it on the plan or edit it here.`);
}
function remove(id) {
  lx.api.checkpoint(); lx.luminaires = lx.luminaires.filter((l) => l.id !== id); if (lx.sel === id) lx.sel = null;
  lx.cache.lamps = null; push3D(); render2D(); lx.api.persist(); setView('lamps', true);
}
function patch(id, key, value) {
  const l = lx.luminaires.find((q) => q.id === id); if (!l) return;
  l[key] = value; const c = cleanLuminaires([l])[0]; if (c) Object.assign(l, c, { id: l.id });
  lampsChanged(true);
}

// ------------------------------------------------------------------ panel
const SUB = [['daylight', 'Daylight'], ['lamps', 'Lamps'], ['year', 'Year']];
function setView(v, rebuild) { lx.view = v; savePrefs(); if (lx.el) { lx.built = false; build(lx.el); lx.built = true; syncControls(); } if (v === 'lamps') lx.cache.lamps = null; schedule(); if (rebuild) scheduleResults(); }

function build(el) {
  el.innerHTML = `<div class="lx" id="lxRoot">
    <div class="seg lx-sub" id="lxSub" role="tablist" aria-label="Lighting design">${SUB.map(([k, t]) => `<button type="button" role="tab" data-lx-view="${k}" aria-selected="${lx.view === k}" class="${lx.view === k ? 'on' : ''}">${t}</button>`).join('')}</div>
    <div class="lx-body" id="lxBody">${lx.view === 'daylight' ? daylightControls() : lx.view === 'lamps' ? lampControls() : ''}</div>
    <div id="lxResults" class="lx-results" aria-live="polite"></div>${lx.view === 'daylight' ? inputsBlock() : ''}</div>`;
  if (!el.__lxBound) { el.__lxBound = true; el.addEventListener('click', onClick); el.addEventListener('change', onChange); el.addEventListener('input', onInput); }
}
function srcControls(grp) {
  const o = grp === 'blinds' ? lx.inputs.blinds : grp === 'glazing' ? lx.inputs.glazing : grp === 'frame' ? lx.inputs.frame : lx.inputs.surfaces[grp];
  return `<div class="lx-src"><select data-lx="src" data-k="${grp}" aria-label="${grp}: where the number comes from"><option value="assumed"${o.source === 'assumed' ? ' selected' : ''}>Assumed</option><option value="source"${o.source === 'source' ? ' selected' : ''}>From a source</option></select>
    <input type="text" data-lx="note" data-k="${grp}" maxlength="120" placeholder="${o.source === 'source' ? 'Source: spec sheet, window label, paint chip…' : 'Optional note'}" value="${esc(o.note)}" aria-label="${grp}: source note"></div>`;
}
function presetSelect(id, list, label, extra = '') {
  return `<select id="${id}" data-lx="${id}" aria-label="${label}">${list.map(([k, t, v]) => `<option value="${k}">${esc(t)} · ${v}</option>`).join('')}<option value="custom">Custom</option>${extra}</select>`;
}
function daylightControls() {
  return `<div class="lx-sec">
    <div class="field lx-sky"><span class="label">Sky ${pill('modelled')}</span>
      <div class="seg" id="lxSky" role="group" aria-label="Sky model"><button type="button" data-lx-sky="overcast" aria-pressed="false">Overcast</button><button type="button" data-lx-sky="clear" aria-pressed="false" title="CIE clear diffuse sky for the sun position shown above">Clear, sun now</button></div></div>
    <div class="lx-tgs"><label class="tg"><input type="checkbox" id="lxHeat2d"> Heat map on the plan</label><label class="tg"><input type="checkbox" id="lxHeat3d"> Tint the 3D floor <span class="tag">preview</span></label></div>
    </div>`;
}
function inputsBlock() {
  return `<details class="lx-inputs" id="lxInputs"><summary>Inputs and sources <span class="lx-count" id="lxSrcCount"></span></summary>
      <p class="ps-note">Every number below is an assumption until you tie it to a source. The label travels with a saved project.</p>
      <div class="lx-in"><label for="glzPreset">Glass, visible transmittance <output id="lxVt"></output></label>${presetSelect('glzPreset', GLAZING_PRESETS, 'Glazing preset')}${srcControls('glazing')}<p class="ps-note faint">Fine-tune with the slider above. Typical catalogue values, not your windows.</p></div>
      <div class="lx-in"><label for="frmPreset">Frame: glazed share of the opening <output id="lxFrame"></output></label>${presetSelect('frmPreset', FRAME_PRESETS, 'Frame preset')}${srcControls('frame')}</div>
      <div class="lx-in"><span class="label">Blinds <output id="lxBlinds"></output></span><p class="ps-note faint">Open, sheer, half and closed buttons are in Glass and blinds above (sheer passes ${Math.round(BLINDS_T.sheer * 100)}%).</p>${srcControls('blinds')}</div>
      ${SURFACE_KEYS.map((k) => `<div class="lx-in"><label for="srf-${k}">${{ floor: 'Floor', walls: 'Walls', ceiling: 'Ceiling' }[k]} reflectance <output id="lxRho-${k}"></output></label>${presetSelect('srf-' + k, SURFACE_PRESETS[k], k + ' preset')}
        <input type="number" class="lx-rho" id="srfv-${k}" data-lx="rho" data-k="${k}" min="0.02" max="0.98" step="0.01" aria-label="${k} reflectance (0 to 1)" hidden>${srcControls(k)}</div>`).join('')}
    </details>`;
}
function lampControls() {
  return `<div class="lx-sec"><span class="label">Luminaires ${pill('estimate')}</span>
    <div class="lx-add" role="group" aria-label="Add a luminaire">${LUM_ORDER.map((t) => `<button type="button" class="btn sm" data-lx-add="${t}">+ ${esc(LUM_TYPES[t].name)}</button>`).join('')}</div>
    <div id="lxList"></div><div id="lxEditor"></div>
    <div class="field lx-plane"><span class="label">Estimate on</span><div class="seg" id="lxPlane" role="group" aria-label="Plane of the estimate"><button type="button" data-lx-plane="floor" aria-pressed="false">The floor</button><button type="button" data-lx-plane="work" aria-pressed="false">Work plane, 0.76 m</button></div></div>
    <div class="lx-tgs"><label class="tg"><input type="checkbox" id="lxHeat2d"> Light map on the plan</label><label class="tg"><input type="checkbox" id="lxHeat3d"> Tint the 3D floor <span class="tag">preview</span></label></div>
    <div class="lx-night"><button type="button" class="btn sm" data-lx-night="night">Preview at night</button><button type="button" class="btn sm ghost" data-lx-night="auto">Back to auto</button> ${pill('preview')}</div></div>`;
}
function onClick(e) {
  const v = e.target.closest('[data-lx-view]'); if (v) { setView(v.dataset.lxView, true); return; }
  const s = e.target.closest('[data-lx-sky]'); if (s) { lx.api.checkpoint(); lx.inputs.sky = s.dataset.lxSky; changed(); return; }
  const a = e.target.closest('[data-lx-add]'); if (a) { add(a.dataset.lxAdd); return; }
  const p = e.target.closest('[data-lx-plane]'); if (p) { lx.plane = p.dataset.lxPlane; savePrefs(); lx.cache.lamps = null; syncControls(); schedule(); return; }
  const n = e.target.closest('[data-lx-night]'); if (n) { lx.api.setMood(n.dataset.lxNight); return; }
  const r = e.target.closest('[data-lx-rm]'); if (r) { remove(r.dataset.lxRm); return; }
  const pick = e.target.closest('[data-lx-pick]'); if (pick && !e.target.closest('input')) { select(pick.dataset.lxPick, false); return; }
  const w = e.target.closest('[data-lx-win]'); if (w) { lx.win = +w.dataset.lxWin; scheduleResults(); }
}
function onInput(e) {
  const t = e.target, f = t.dataset.lf;
  if (f && lx.sel) {
    const id = lx.sel, l = lx.luminaires.find((q) => q.id === id); if (!l) return;
    if (!lx.editing) { lx.api.checkpoint(); lx.editing = true; clearTimeout(lx.editT); }
    clearTimeout(lx.editT); lx.editT = setTimeout(() => { lx.editing = false; }, 700);
    const num = (v) => (v === '' ? NaN : +v);
    if (f === 'label') l.label = t.value.slice(0, 60);
    else if (['x', 'y', 'x2', 'y2'].includes(f)) { const v = num(t.value); if (Number.isFinite(v)) l[f] = Math.round(v * 12); }
    else if (['z', 'lm', 'k', 'beam'].includes(f)) { const v = num(t.value); if (Number.isFinite(v)) l[f] = v; }
    const c = cleanLuminaires([l])[0]; if (c) { const keep = f === 'label' ? l.label : null; Object.assign(l, c, { id: l.id }); if (keep != null) l.label = keep || LUM_TYPES[l.type].name; }
    lx.cache.lamps = null; push3D(); render2D(); lx.api.persist(); schedule(); syncList();
  }
}
function onChange(e) {
  const t = e.target, k = t.dataset.lx;
  if (t.dataset.lf === 'on' || t.dataset.lf === 'source') {
    const l = lx.luminaires.find((q) => q.id === lx.sel); if (!l) return;
    lx.api.checkpoint(); if (t.dataset.lf === 'on') l.on = t.checked; else l.source = t.value === 'source' ? 'source' : 'assumed';
    lampsChanged(true); return;
  }
  if (t.dataset.lxOn) { const l = lx.luminaires.find((q) => q.id === t.dataset.lxOn); if (l) { lx.api.checkpoint(); l.on = t.checked; lampsChanged(true); } return; }
  if (t.id === 'lxHeat2d') { lx.heat2d = t.checked; savePrefs(); schedule(); return; }
  if (t.id === 'lxHeat3d') { lx.heat3d = t.checked; savePrefs(); schedule(); return; }
  if (!k) return;
  lx.api.checkpoint();
  if (k === 'glzPreset') { const hit = GLAZING_PRESETS.find((p) => p[0] === t.value); lx.inputs.glazing.preset = t.value; if (hit) lx.api.setVt(hit[2]); }
  else if (k === 'frmPreset') { const hit = FRAME_PRESETS.find((p) => p[0] === t.value); lx.inputs.frame.preset = t.value; if (hit) lx.inputs.frame.glazed = hit[2]; }
  else if (k.startsWith('srf-')) {
    const key = k.slice(4), hit = SURFACE_PRESETS[key].find((p) => p[0] === t.value);
    lx.inputs.surfaces[key].preset = t.value; if (hit) lx.inputs.surfaces[key].rho = hit[2];
  } else if (k === 'rho') { const v = +t.value; if (Number.isFinite(v)) { lx.inputs.surfaces[t.dataset.k].rho = Math.max(0.02, Math.min(0.98, v)); lx.inputs.surfaces[t.dataset.k].preset = 'custom'; } }
  else if (k === 'src') { const o = grpOf(t.dataset.k); o.source = t.value === 'source' ? 'source' : 'assumed'; }
  else if (k === 'note') { grpOf(t.dataset.k).note = t.value.replace(/[<>]/g, '').slice(0, 120); }
  changed();
}
const grpOf = (g) => (g === 'blinds' ? lx.inputs.blinds : g === 'glazing' ? lx.inputs.glazing : g === 'frame' ? lx.inputs.frame : lx.inputs.surfaces[g]);
function changed() { lx.inputs = cleanInputs(lx.inputs); lx.cache.daylight = null; syncSurfaces(); lx.api.persist(); syncControls(); schedule(); }

function syncControls() {
  const el = lx.el; if (!el) return;
  const q = (s) => el.querySelector(s);
  el.querySelectorAll('[data-lx-sky]').forEach((b) => { const on = b.dataset.lxSky === lx.inputs.sky; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
  el.querySelectorAll('[data-lx-plane]').forEach((b) => { const on = b.dataset.lxPlane === lx.plane; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
  el.querySelectorAll('#lxHeat2d').forEach((c) => { c.checked = lx.heat2d; });
  el.querySelectorAll('#lxHeat3d').forEach((c) => { c.checked = lx.heat3d; });
  if (lx.view === 'daylight') {
    const vt = lx.api.vt(), gp = presetFor(GLAZING_PRESETS, vt);
    if (q('#glzPreset')) { q('#glzPreset').value = gp; lx.inputs.glazing.preset = gp; }
    if (q('#lxVt')) q('#lxVt').textContent = `${vt.toFixed(2)} (${lx.inputs.glazing.source === 'source' ? 'source' : 'assumed'})`;
    const fp = presetFor(FRAME_PRESETS, lx.inputs.frame.glazed);
    if (q('#frmPreset')) q('#frmPreset').value = fp;
    if (q('#lxFrame')) q('#lxFrame').textContent = lx.inputs.frame.glazed.toFixed(2);
    const b = lx.api.blinds();
    if (q('#lxBlinds')) q('#lxBlinds').textContent = `${BLINDS_LABEL[b] || b}, passes ${Math.round((BLINDS_T[b] ?? 1) * 100)}%`;
    for (const k of SURFACE_KEYS) {
      const s = lx.inputs.surfaces[k], sel = q('#srf-' + k), num = q('#srfv-' + k);
      if (sel) sel.value = s.preset; if (num) { num.hidden = s.preset !== 'custom'; num.value = s.rho; }
      if (q('#lxRho-' + k)) q('#lxRho-' + k).textContent = s.rho.toFixed(2);
    }
    const sc = sourceCount(lx.inputs);
    if (q('#lxSrcCount')) q('#lxSrcCount').textContent = `${sc.source} of ${sc.total} sourced`;
    el.querySelectorAll('select[data-lx=src]').forEach((s) => { const o = grpOf(s.dataset.k); s.value = o.source; const inp = s.parentElement.querySelector('input[data-lx=note]'); if (inp && document.activeElement !== inp) inp.value = o.note; if (inp) inp.placeholder = o.source === 'source' ? 'Source: spec sheet, window label, paint chip…' : 'Optional note'; });
  }
  if (lx.view === 'lamps') { syncList(); syncEditor(); }
}
function syncList() {
  const el = lx.el?.querySelector('#lxList'); if (!el) return;
  const fur = furnitureLuminaires(lx.api.items());
  const sig = JSON.stringify([lx.sel, lx.luminaires.map((l) => [l.id, l.label, l.type, l.lm, l.k, l.on]), fur.map((l) => [l.id, l.lm])]);
  if (el.dataset.sig === sig) return;
  el.dataset.sig = sig;
  el.innerHTML = lx.luminaires.length || fur.length ? `<ul class="lx-list">${lx.luminaires.map((l) => `<li class="${l.id === lx.sel ? 'on' : ''}" data-lx-pick="${esc(l.id)}"><i class="lx-sw" style="background:${kelvinCss(l.k)}"></i><button type="button" class="lx-name" data-lx-pick="${esc(l.id)}">${esc(l.label)}</button><span class="lx-meta">${esc(LUM_TYPES[l.type].name)} · ${Math.round(l.lm)} lm · ${Math.round(l.k)} K</span><label class="lx-on"><input type="checkbox" data-lx-on="${esc(l.id)}" ${l.on === false ? '' : 'checked'} aria-label="${esc(l.label)} on"> on</label><button type="button" class="icon-btn lx-rm" data-lx-rm="${esc(l.id)}" aria-label="Remove ${esc(l.label)}" title="Remove">×</button></li>`).join('')}
    ${fur.map((l) => `<li class="from-furn"><i class="lx-sw" style="background:${kelvinCss(l.k)}"></i><span class="lx-name">${esc(l.label)}</span><span class="lx-meta">From Furniture · ${Math.round(l.lm)} lm · ${Math.round(l.k)} K</span></li>`).join('')}</ul>` : '<p class="ps-note">No luminaires yet. Add one, then drag it on the plan. Floor and table lamps from the Furniture and Shop tabs count too.</p>';
}
function syncEditor() {
  const el = lx.el?.querySelector('#lxEditor'); if (!el) return;
  const l = lx.luminaires.find((q) => q.id === lx.sel);
  if (!l) { el.innerHTML = ''; return; }
  if (el.dataset.for === l.id && el.contains(document.activeElement)) { return; }
  el.dataset.for = l.id;
  const field = (key, label, val, o = {}) => `<div class="field"><label for="lf-${key}">${label}</label><input id="lf-${key}" data-lf="${key}" type="${o.type || 'number'}" ${o.type === 'text' ? 'maxlength="60"' : `step="${o.step || 1}" min="${o.min ?? ''}" max="${o.max ?? ''}"`} value="${esc(val)}"></div>`;
  el.innerHTML = `<div class="lx-edit" role="group" aria-label="Edit ${esc(l.label)}">
    ${field('label', 'Name', l.label, { type: 'text' })}
    <div class="lx-grid2">${field('x', 'X (ft)', ft(l.x), { step: 0.1 })}${field('y', 'Y (ft)', ft(l.y), { step: 0.1 })}
    ${l.type === 'strip' ? field('x2', 'End X (ft)', ft(l.x2), { step: 0.1 }) + field('y2', 'End Y (ft)', ft(l.y2), { step: 0.1 }) : ''}
    ${field('z', 'Height (in)', Math.round(l.z), { min: LUM_LIMITS.z[0], max: LUM_LIMITS.z[1] })}${field('lm', 'Lumens', Math.round(l.lm), { min: LUM_LIMITS.lm[0], max: LUM_LIMITS.lm[1], step: 10 })}
    ${field('k', 'Colour temp (K)', Math.round(l.k), { min: LUM_LIMITS.k[0], max: LUM_LIMITS.k[1], step: 50 })}${field('beam', l.beam >= 355 ? 'Beam (360 = all ways)' : 'Beam angle (°)', Math.round(l.beam), { min: LUM_LIMITS.beam[0], max: LUM_LIMITS.beam[1] })}</div>
    <div class="lx-srcrow"><label class="tg"><input type="checkbox" data-lf="on" ${l.on === false ? '' : 'checked'}> On</label>
      <select data-lf="source" aria-label="Where these lamp numbers come from"><option value="assumed"${l.source === 'assumed' ? ' selected' : ''}>Assumed (typical ${esc(LUM_TYPES[l.type].name.toLowerCase())})</option><option value="source"${l.source === 'source' ? ' selected' : ''}>From a product or spec sheet</option></select></div>
    <p class="ps-note faint">${esc(LUM_TYPES[l.type].note)} Beam angle is the full angle at half intensity.</p></div>`;
}

// ------------------------------------------------------------------ results region
function roomTable(data, scale) {
  const lamp = scale.key === 'lux';
  const rows = data.rooms.filter((r) => r.stats && (!lamp || r.lamps.length)).map((r) => {
    const st = r.stats;
    return `<tr><td>${esc(r.room)}${lamp && r.lamps.length ? `<br><small class="faint">${r.lamps.length} lamp${r.lamps.length > 1 ? 's' : ''} · ${Math.round(r.lm)} lm</small>` : ''}</td><td class="num"><b>${fmtVal(st.mean, scale)}</b></td><td class="num nw">${fmtVal(st.min, scale)} – ${fmtVal(st.max, scale)}</td><td class="num" title="lowest point over the room average">${st.uniformity == null ? '—' : st.uniformity.toFixed(2)}</td></tr>`;
  }).join('');
  return `<table class="mini lx-table"><thead><tr><th>Room</th><th class="num">Average</th><th class="num">Low – high</th><th class="num" title="Lowest sensor over the average">Even</th></tr></thead><tbody>${rows}</tbody></table>`;
}
function results() {
  const el = lx.el?.querySelector('#lxResults'); if (!el) return;
  if (lx.view === 'year') { yearResults(el); return; }
  const src = lx.view === 'lamps' ? 'lamps' : 'daylight', data = lx.data, scale = src === 'lamps' ? SCALES.lux : SCALES.daylight;
  if (!data || lx.dataSrc !== src) { el.innerHTML = ''; return; }
  let h = '';
  if (src === 'daylight') {
    if (data.unavailable) h = `<p class="ps-note">No daylight grid: ${esc(data.unavailable)}. Place the plan on its site (the plan must have a city model and a known orientation).</p>`;
    else if (data.night) h = '<p class="ps-note">The sun is below the horizon, so there is no clear-sky daylight to map. Move the time slider to daytime or use the overcast sky.</p>';
    else if (!data.rooms.length) h = `<p class="ps-note">No room has a window with a known skyline${data.skipped?.length ? ` (${data.skipped.map((s) => `${esc(s.room)}: ${esc(s.reason)}`).join('; ')})` : ''}.</p>`;
    else {
      const clear = lx.inputs.sky === 'clear';
      h = `${legendHTML(scale)}${roomTable(data, scale)}
        <p class="ps-note"><b>Average</b> is the room's mean relative daylight at table height (0.76 m), in percent of the unobstructed ${clear ? 'clear diffuse' : 'overcast'} sky's horizontal illuminance: a daylight factor for comparing rooms and settings, <b>not lux</b>. It is the sky seen through each window (with its own skyline) times the glass, frame and blinds, plus one inter-reflected figure per room from the surfaces' reflectance. Not calibrated; no glare, no ground reflection, no wall between a sensor and its window.${data.skipped?.length ? ` Not mapped: ${data.skipped.map((s) => `${esc(s.room)} (${esc(s.reason)})`).join(', ')}.` : ''}</p>`;
    }
  } else {
    const any = data.rooms.some((r) => r.lamps.length);
    const unlit = data.rooms.filter((r) => r.stats && !r.lamps.length).map((r) => r.room);
    h = `${legendHTML(scale)}${any ? roomTable(data, scale) : ''}
      <p class="ps-note">${any ? (unlit.length ? `No lamp in: ${esc(unlit.join(', '))}. ` : '') : 'No lamp lights any room yet. '}<b>Estimate on ${data.plane === 'work' ? 'the 0.76 m work plane' : 'the floor'}</b>: each lamp lights the room it stands in by inverse-square and cosine from its lumens and beam, nothing else (no bounce off walls, no shadows, no furniture, no dimming). ${data.fromFurniture ? `${data.fromFurniture} lamp${data.fromFurniture > 1 ? 's' : ''} from Furniture included. ` : ''}Rules of thumb on the work plane: ${LUX_GUIDE.map(([n, lo, hi]) => `${n.toLowerCase()} ${lo}–${hi} lx`).join('; ')}. Use them to compare layouts, not to certify a lighting plan.</p>`;
  }
  el.innerHTML = h;
}
function yearResults(el) {
  const a = lx.api, m = a.model(), skies = a.skies(), i = lx.info;
  if (!m || !skies || !i || m.up_bearing == null) { el.innerHTML = '<p class="ps-note">The annual summary needs the plan placed on its site, with a known orientation. It uses each window\'s own skyline.</p>'; return; }
  const ws = m.windows.map((w, k) => [w, k]).filter(([, k]) => skies[k]?.prof);
  if (!ws.length) { el.innerHTML = '<p class="ps-note">No window has a skyline from the city model.</p>'; return; }
  if (!ws.some(([, k]) => k === lx.win)) lx.win = ws[0][1];
  const w = m.windows[lx.win], prof = skies[lx.win].prof;
  const skyShare = lx.api.skyView(lx.win);
  const ann = annualFor({ prof, facing: w.bearing, panes: null, year: i.y, lat: i.lat, lon: i.lon, tz: i.tz, skyViewShare: skyShare ?? 0, fraction: i.fraction, place: i.place });
  const who = `${w.room || 'window'} window facing ${Math.round(w.bearing)}°`;
  el.innerHTML = `${ws.length > 1 ? `<div class="lx-wins" role="group" aria-label="Window">${ws.map(([ww, k]) => `<button type="button" class="chip${k === lx.win ? ' on' : ''}" data-lx-win="${k}" aria-pressed="${k === lx.win}">${esc(ww.room || 'Window')} ${Math.round(ww.bearing)}°</button>`).join('')}</div>` : ''}
    <h3 class="label">${esc(who)} ${pill('modelled')}</h3>${annualBlock(ann, who)}`;
}
export function _state() { return lx; }
