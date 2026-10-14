// Plan tracer and plan editor for the Floor plan studio.
//
// "New plan from image": load a local image or one PDF page (the vendored pdf.js loads only when a PDF
// is chosen; the file itself never leaves the browser), set the scale from a printed dimension and
// check it against a second one, orient the drawing, trace rooms as polygons with 90/45 degree and
// corner snapping, place doors and windows on the derived walls, add fixtures, and save plan JSON v2
// (download, or into the studio's local plan library). "Edit plan" opens an existing plan in the same
// editor (corners, doors, windows, fixtures, ceiling, wall thickness) and saves a labelled local
// version; the search's plan file is never changed.
//
// Hooks into the studio without touching plan3d.js: attach() adds two header buttons and a
// "Use this plan in Unit 3D" item to the Layout menu, and saving reuses the studio's own project
// import input, so the plan opens immediately with the studio's validation.
import { S, store, loadJSON, byId, label as listingLabel } from '../app.js';
import { $, esc, toast } from '../util.js';
import { normalisePlan, UNIT_IN, ROOM_KINDS, FIXTURE_KINDS, pointInPoly, bbox } from './model.js';
import { piecePoly, swingPoly, doorwayPoly } from './checks.js';
import { validateLayout } from './layout.js';
import { serialiseProject } from './project.js';
import { savePlanScenario } from './scenario-bridge.js';
import * as T from './tracer.js';

const NS = 'http://www.w3.org/2000/svg';
const r1 = (v) => Math.round(v * 100) / 100;

const ICON = {
  select: '<path d="M4 2.5l8.5 5-3.8 1 2.3 4.2-1.6.9-2.3-4.2L4.5 12z"/>',
  pan: '<path d="M5.5 8V3.8a1 1 0 012 0V7.5M7.5 7V2.8a1 1 0 012 0V7.5M9.5 7.3V3.8a1 1 0 012 0v5.4c0 2.7-1.8 4.8-4.4 4.8-1.5 0-2.6-.7-3.4-1.9L2 9.4a1 1 0 011.6-1.1l1.9 1.8"/>',
  poly: '<path d="M3 12.5l2-9 7.5 2.5-1 6.5z"/><circle cx="3" cy="12.5" r="1"/><circle cx="5" cy="3.5" r="1"/><circle cx="12.5" cy="6" r="1"/><circle cx="11.5" cy="12.5" r="1"/>',
  rect: '<rect x="2.5" y="3.5" width="11" height="9" rx=".5"/><circle cx="2.5" cy="3.5" r="1"/><circle cx="13.5" cy="12.5" r="1"/>',
  door: '<path d="M3 13.5h10M4 13.5V4.5l6 1v8"/><path d="M4 4.5a9 9 0 019 9" stroke-dasharray="1.6 1.6"/>',
  window: '<path d="M2 6.5h12M2 9.5h12M2 5v6M14 5v6M8 6.5v3"/>',
  fixture: '<rect x="3" y="3" width="10" height="10" rx="1"/><path d="M3 7h10M8 3v4"/>',
  scale: '<path d="M2 11.5l9.5-9.5 2.5 2.5L4.5 14z"/><path d="M5 9.5l1.2 1.2M7 7.5l1.6 1.6M9 5.5l1.2 1.2"/>',
  check: '<path d="M2 8h12M2 5.5v5M14 5.5v5"/><path d="M6 3.5l1.6 1.6L11 1.8" />',
  arrow: '<path d="M8 2l3.5 10L8 9.6 4.5 12z"/>',
  facade: '<path d="M2.5 13.5V4l5.5-2 5.5 2v9.5"/><path d="M5.5 13.5V9h5v4.5"/>',
  undo: '<path d="M5.5 3.5L2.5 6.5l3 3"/><path d="M2.8 6.5H10a3.5 3.5 0 010 7H7"/>',
  redo: '<path d="M10.5 3.5l3 3-3 3"/><path d="M13.2 6.5H6a3.5 3.5 0 000 7h3"/>',
  x: '<path d="M4 4l8 8M12 4l-8 8"/>',
  plus: '<path d="M8 3v10M3 8h10"/>',
  minus: '<path d="M3 8h10"/>',
  fit: '<path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10"/>',
  image: '<rect x="2" y="3" width="12" height="10" rx="1.5"/><circle cx="6" cy="6.5" r="1.2"/><path d="M2.5 12l3.5-3.5 2.5 2.5 2-2 3 3"/>',
  trash: '<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.7 9h5.6l.7-9"/>',
  down: '<path d="M8 2.5v8M4.5 7l3.5 3.5L11.5 7M3 13.5h10"/>',
  cube: '<path d="M8 1.8l5.5 3v6.4L8 14.2l-5.5-3V4.8z"/><path d="M2.5 4.8L8 8l5.5-3.2M8 8v6.2"/>',
  edit: '<path d="M10.5 2.5l3 3-8 8H2.5v-3z"/>',
};
const ic = (k) => `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k]}</svg>`;

const KIND_NAMES = { living: 'Living room', bedroom: 'Bedroom', kitchen: 'Kitchen', dining: 'Dining', bath: 'Bath', hall: 'Hall', closet: 'Closet', office: 'Office', outdoor: 'Outdoor', other: 'Room' };
const FIX_NAMES = { closet: 'Closet', wardrobe: 'Wardrobe', column: 'Column', ac: 'AC unit', ptac: 'PTAC', radiator: 'Radiator', counter: 'Counter', island: 'Island', fridge: 'Fridge', range: 'Range', sink: 'Sink', dishwasher: 'Dishwasher', wd: 'Washer/dryer', tub: 'Tub', shower: 'Shower', toilet: 'Toilet', vanity: 'Vanity', other: 'Other' };
const MATCH_NAMES = { 'exact-unit': 'Exact unit plan', 'line-tier': 'Same line, other floor', representative: 'Representative plan', 'stated-dims': 'Drawn from stated sizes', 'photo-estimate': 'Estimated from photos' };
const STEPS = {
  trace: [['image', 'Image'], ['scale', 'Scale'], ['north', 'North'], ['rooms', 'Rooms'], ['openings', 'Doors & windows'], ['fixtures', 'Fixtures'], ['details', 'Details'], ['save', 'Save']],
  edit: [['rooms', 'Rooms'], ['openings', 'Doors & windows'], ['fixtures', 'Fixtures'], ['details', 'Ceiling & walls'], ['north', 'North'], ['save', 'Save']],
};
const STEP_TOOLS = { image: ['pan'], scale: ['scale', 'check'], north: ['arrow', 'facade'], rooms: ['poly', 'rect'], openings: ['door', 'window'], fixtures: ['fixture'], details: [], save: [] };
const TOOL_NAMES = { select: ['Select and edit', 'V'], pan: ['Pan', 'H'], poly: ['Room outline', 'P'], rect: ['Rectangular room', 'R'], door: ['Door', 'D'], window: ['Window', 'W'], fixture: ['Fixture', 'F'], scale: ['Scale dimension', 'S'], check: ['Check dimension', 'C'], arrow: ['North arrow', 'A'], facade: ['Facade wall', 'B'] };
const HINTS = {
  select: 'Drag a corner to move it · drag an edge dot to add a corner · drag a door or window along its wall',
  pan: 'Drag to pan · scroll or pinch to zoom',
  poly: 'Click each corner · click the first corner or press Enter to close · Backspace removes the last corner',
  rect: 'Drag from one corner to the opposite corner',
  door: 'Click on a wall to place a door',
  window: 'Click on a wall to place a window',
  fixture: 'Drag to draw the fixture',
  scale: 'Click both ends of a printed dimension line',
  check: 'Click both ends of a second printed dimension',
  arrow: 'Click the tail, then the tip, of the plan’s north arrow',
  facade: 'Click an outside wall, then choose the direction it faces',
};
const DRAFT_KEY = () => `plan-tracer-draft.${S.base}`;

const U = {
  open: false, mode: 'trace', step: 'image', tool: 'pan', doc: null, hist: null, sel: null, saved: true,
  draft: [], cursor: null, snap: null, scaleDraft: [], checkDraft: [], arrowDraft: [], facadeWall: null,
  img: null, pdf: null, vb: null, upp: 1, drag: null, pointers: new Map(), pinch: null, space: false,
  fixKind: 'closet', lastFocus: null, origin: null, k: 12, ro: null,
};

// ------------------------------------------------------------------ studio hook
/** Add "New plan from image", "Edit plan" and "Use this plan in Unit 3D" to the Floor plan studio. */
export function attach() {
  const view = $('view-plan');
  const tryAttach = () => {
    const acts = view?.querySelector('.ps-head .actions'); if (!acts) return false;
    if (!$('trNewBtn')) {
      acts.insertAdjacentHTML('beforeend', `<button class="btn" type="button" id="trNewBtn" title="Trace a new floor plan from an image or PDF">${ic('image')}<span>New plan from image</span></button><button class="btn ghost" type="button" id="trEditBtn" title="Edit this plan's rooms, doors, ceiling and walls">${ic('edit')}<span>Edit plan</span></button>`);
      $('trNewBtn').addEventListener('click', () => openTracer('trace'));
      $('trEditBtn').addEventListener('click', () => { const id = currentPlanId(); if (id) openTracer('edit', id); else toast('Open a floor plan first.'); });
    }
    const menu = $('psMenu');
    if (menu && !menu.querySelector('[data-tr]')) {
      const hr = menu.querySelector('hr');
      const b = document.createElement('button');
      b.type = 'button'; b.setAttribute('role', 'menuitem'); b.dataset.tr = 'scenario';
      b.innerHTML = 'Use this plan in Unit 3D<span>local</span>';
      menu.insertBefore(b, hr || null);
      b.addEventListener('click', async (e) => { e.stopPropagation(); menu.hidden = true; $('psFileBtn')?.setAttribute('aria-expanded', 'false'); await studioToUnit3D(); });
    }
    return true;
  };
  if (!tryAttach() && view) {
    const mo = new MutationObserver(() => { if (tryAttach()) mo.disconnect(); });
    mo.observe(view, { childList: true, subtree: true });
  }
}
function currentPlanId() {
  const lib = library(), ok = (v) => v && ((S.manifest.plans || []).includes(v) || lib[v]);
  const [view, arg] = location.hash.replace('#', '').split('/');
  const fromHash = view === 'plan' && arg ? decodeURIComponent(arg) : null;
  return ok(fromHash) ? fromHash : ok($('planSel')?.value) ? $('planSel').value : null;
}
const library = () => { const l = store.get(`plan-projects.${S.base}`, {}); return l && typeof l === 'object' ? l : {}; };
async function rawPlanFor(id) {
  const lib = library();
  if (lib[id]?.plan) return JSON.parse(JSON.stringify(lib[id].plan));
  return loadJSON(`${S.base}/plans/${id}.json`, null);
}
/** The furniture the studio remembers for a plan (inches), else the plan's first preset. */
function furnitureFor(id, raw) {
  const saved = store.get(`plan.${S.base}.${id}`, null) || library()[id]?.layout;
  const v = saved && validateLayout(saved, { planId: id });
  if (v?.ok) return v.layout.items;
  try { return (normalisePlan(raw).layouts[0]?.items || []).map((x) => ({ ...x })); } catch { return []; }
}
const lightingFor = (id) => { const l = store.get(`plan-light.${S.base}.${id}`, {}) || {}; return { directSun: l.directSun !== false, ambient: Number.isFinite(l.ambient) ? Math.max(0, Math.min(2, l.ambient)) : 1 }; };

async function studioToUnit3D() {
  const id = currentPlanId(); if (!id) { toast('Open a floor plan first.'); return; }
  const raw = await rawPlanFor(id);
  if (!raw) { toast('This plan could not be read.'); return; }
  try {
    const project = serialiseProject(raw, furnitureFor(id, raw), lightingFor(id));
    savePlanScenario({ project, base: S.base, label: library()[id] ? 'Local plan project' : 'Search plan with your furniture', from: 'studio' });
    toast(byId(id) ? 'Saved for Unit 3D: the Inside view of this unit can use this plan and furniture.' : 'Saved as a local plan scenario. Unit 3D uses it for the listing with the same id.', 5200);
  } catch (e) { toast(`Could not save the scenario: ${e.message || e}`, 5200); }
}

// ------------------------------------------------------------------ open / close
export async function openTracer(mode = 'trace', planId = null) {
  if (U.open) return;
  let doc;
  if (mode === 'edit') {
    const raw = await rawPlanFor(planId);
    if (!raw) { toast('This plan could not be read.'); return; }
    try { doc = T.fromPlanJSON(raw, { label: `Edited ${T.localDate()}` }); } catch (e) { toast(`Cannot edit this plan: ${e.message || e}`, 5000); return; }
    U.origin = { id: planId, title: doc.title, items: furnitureFor(planId, raw), lighting: lightingFor(planId) };
  } else {
    doc = T.emptyDoc({ units: S.crit?.units === 'metric' ? 'm' : 'ft', id: `traced-${T.localDate()}`, title: 'Traced plan' });
    U.origin = null;
  }
  Object.assign(U, { open: true, nmode: null, sideDown: false, sidePending: false, boxStart: null, mode, doc, hist: new T.History(doc), sel: null, saved: true, draft: [], cursor: null, snap: null, scaleDraft: [], checkDraft: [], arrowDraft: [], facadeWall: null, img: null, pdf: null, drag: null, pinch: null, k: UNIT_IN[doc.units] });
  U.pointers.clear();
  U.lastFocus = document.activeElement;
  mount();
  goStep(STEPS[mode][0][0]);
  fit();
  render();
  $('trClose')?.focus();
}
function closeTracer(force = false) {
  if (!U.open) return;
  if (!force && U.mode === 'edit' && !U.saved && !confirm('Discard your changes to this plan? The original plan is unchanged.')) return;
  U.open = false;
  window.removeEventListener('keydown', onKey, true);
  window.removeEventListener('keyup', onKeyUp, true);
  window.removeEventListener('pointerup', sideUp, true);
  U.ro?.disconnect();
  if (U.img?.url) URL.revokeObjectURL(U.img.url);
  U.img = null; U.pdf = null;
  $('trShell')?.remove();
  document.body.classList.remove('tr-open');
  U.lastFocus?.focus?.();
}

// ------------------------------------------------------------------ markup
function mount() {
  $('trShell')?.remove();
  const steps = STEPS[U.mode];
  const title = U.mode === 'edit' ? `Edit plan <span>${esc(U.doc.title)}</span>` : 'New plan <span>from image</span>';
  document.body.insertAdjacentHTML('beforeend', `<div class="tr-shell" id="trShell" role="dialog" aria-modal="true" aria-labelledby="trTitle">
    <header class="tr-head">
      <div class="t"><h1 id="trTitle">${title}</h1><p id="trSub"></p></div>
      <div class="actions">
        <button class="icon-btn" type="button" id="trUndo" title="Undo (Ctrl+Z)" aria-label="Undo">${ic('undo')}</button>
        <button class="icon-btn" type="button" id="trRedo" title="Redo (Shift+Ctrl+Z)" aria-label="Redo">${ic('redo')}</button>
        <button class="btn" type="button" id="trClose">${ic('x')}<span>Close</span></button>
      </div>
    </header>
    <nav class="tr-steps" aria-label="Steps"><ol>${steps.map(([k, t], i) => `<li><button type="button" data-step="${k}"><b>${i + 1}</b>${esc(t)}</button></li>`).join('')}</ol></nav>
    <div class="tr-body">
      <div class="tr-stage" id="trStage">
        <svg id="trSvg" role="img" aria-label="Plan being traced"><defs>
          <pattern id="trgrid" patternUnits="userSpaceOnUse" width="12" height="12"><path d="M12 0H0V12" class="p2-gridline"/></pattern>
          <pattern id="trhatch" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" class="p2-hatchline"/></pattern>
        </defs><g id="trImgG"></g><g id="trStatic"></g><g id="trOver"></g></svg>
        <div class="float tr-tools" id="trTools" role="toolbar" aria-label="Tools"></div>
        <div class="float tr-zoom" role="group" aria-label="Zoom">
          <button type="button" data-z="in" title="Zoom in (+)" aria-label="Zoom in">${ic('plus')}</button>
          <button type="button" data-z="out" title="Zoom out (−)" aria-label="Zoom out">${ic('minus')}</button>
          <button type="button" data-z="fit" title="Fit (0)" aria-label="Fit to view">${ic('fit')}</button>
        </div>
        <div class="hud tr-hud" id="trHud" aria-live="polite"></div>
        <div class="tr-hint" id="trHint"></div>
        <div class="tr-drop" id="trDrop" hidden><span>Drop an image or PDF</span></div>
      </div>
      <aside class="tr-side" id="trSide"></aside>
    </div>
    <input type="file" id="trFile" accept="image/png,image/jpeg,image/webp,image/gif,application/pdf,.pdf" hidden>
  </div>`);
  document.body.classList.add('tr-open');
  bind();
}

function bind() {
  $('trClose').addEventListener('click', () => closeTracer());
  $('trUndo').addEventListener('click', () => undoRedo(true));
  $('trRedo').addEventListener('click', () => undoRedo(false));
  $('trShell').querySelector('.tr-steps').addEventListener('click', (e) => { const b = e.target.closest('[data-step]'); if (b && !b.disabled) goStep(b.dataset.step); });
  $('trTools').addEventListener('click', (e) => { const b = e.target.closest('[data-tool]'); if (b) setTool(b.dataset.tool); });
  $('trShell').querySelector('.tr-zoom').addEventListener('click', (e) => { const b = e.target.closest('[data-z]'); if (!b) return; if (b.dataset.z === 'fit') fit(); else zoomBy(b.dataset.z === 'in' ? 0.7 : 1 / 0.7); render(); });
  const svg = $('trSvg');
  svg.addEventListener('pointerdown', down);
  svg.addEventListener('pointermove', move);
  svg.addEventListener('pointerup', up);
  svg.addEventListener('pointercancel', up);
  svg.addEventListener('pointerleave', () => { if (!U.drag) { U.cursor = null; overlay(); } });
  svg.addEventListener('wheel', wheel, { passive: false });
  svg.addEventListener('dblclick', (e) => { if (U.tool === 'poly' && U.draft.length >= 3) { e.preventDefault(); closePoly(); } });
  const side = $('trSide');
  // a commit on blur must not rebuild the panel between mousedown and click (the click would be lost)
  side.addEventListener('pointerdown', () => { U.sideDown = true; });
  window.addEventListener('pointerup', sideUp, true);
  side.addEventListener('click', sideClick);
  side.addEventListener('change', sideChange);
  side.addEventListener('input', sideInput);
  $('trFile').addEventListener('change', (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) loadFile(f); });
  const stage = $('trStage'), drop = $('trDrop');
  stage.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); drop.hidden = false; } });
  stage.addEventListener('dragleave', (e) => { if (!stage.contains(e.relatedTarget)) drop.hidden = true; });
  stage.addEventListener('drop', (e) => { e.preventDefault(); drop.hidden = true; const f = e.dataTransfer?.files?.[0]; if (f) loadFile(f); });
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('keyup', onKeyUp, true);
  U.ro = new ResizeObserver(() => { if (U.open) render(); });
  U.ro.observe(stage);
}

// ------------------------------------------------------------------ document changes
function commit(label, change = null) {
  if (change && U.mode === 'edit') U.doc.changes = [...U.doc.changes, change].slice(-20);
  if (U.hist.push(U.doc, label)) { U.saved = false; saveDraft(); }
  render();
}
function undoRedo(isUndo) {
  if (isUndo ? !U.hist.canUndo : !U.hist.canRedo) return;
  U.doc = isUndo ? U.hist.undo() : U.hist.redo();
  U.k = UNIT_IN[U.doc.units];
  if (U.sel && !findSel(U.sel)) U.sel = null;
  U.saved = false; saveDraft(); render();
  toast(isUndo ? 'Undone' : 'Redone', 900);
}
let draftT = 0;
function saveDraft() {
  if (U.mode !== 'trace') return;
  clearTimeout(draftT);
  draftT = setTimeout(() => store.set(DRAFT_KEY(), { saved: new Date().toISOString(), doc: U.doc }), 300);
}
function findSel(sel) {
  if (!sel) return null;
  const list = { room: U.doc.rooms, door: U.doc.doors, window: U.doc.windows, fixture: U.doc.fixtures }[sel.type];
  return list?.find((x) => x.id === sel.id) || null;
}
const walls = () => T.deriveWalls(U.doc.rooms, { tol: T.defaultsFor(U.doc.units).grid * 0.6, probe: Math.max(U.doc.wall, T.defaultsFor(U.doc.units).wall) });
const scaled = () => U.mode === 'edit' || (U.doc.cal && !U.doc.cal.provisional);

// ------------------------------------------------------------------ steps and tools
function goStep(step) {
  U.step = step;
  const tools = STEP_TOOLS[step] || [];
  U.draft = []; U.scaleDraft = []; U.checkDraft = []; U.arrowDraft = [];
  setTool(tools[0] || 'select', true);
  $('trShell').querySelectorAll('[data-step]').forEach((b) => { b.classList.toggle('on', b.dataset.step === step); b.setAttribute('aria-current', b.dataset.step === step ? 'step' : 'false'); });
  $('trShell').querySelector(`[data-step="${step}"]`)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  render();
}
function setTool(tool, quiet) {
  if (!scaled() && !['pan', 'select', 'scale', 'check', 'arrow'].includes(tool)) { toast('Set the scale first, so traced rooms have real sizes.'); tool = 'scale'; if (U.step !== 'scale') { goStep('scale'); return; } }
  if (tool !== U.tool) { U.draft = []; U.drag = null; }
  U.tool = tool;
  if (!quiet) render();
}
function toolsMarkup() {
  const list = ['select', 'pan', ...(STEP_TOOLS[U.step] || []).filter((t) => t !== 'pan')];
  return list.map((t) => `<button type="button" data-tool="${t}" class="${U.tool === t ? 'on' : ''}" aria-pressed="${U.tool === t}" title="${esc(TOOL_NAMES[t][0])} (${TOOL_NAMES[t][1]})"${!scaled() && !['pan', 'select', 'scale', 'check', 'arrow'].includes(t) ? ' disabled' : ''}>${ic(t)}<span>${esc(TOOL_NAMES[t][0])}</span></button>`).join('');
}

// ------------------------------------------------------------------ view (pan / zoom); SVG units are inches, y flipped
function contentBox() {
  const pts = U.doc.rooms.flatMap((r) => r.poly);
  for (const o of [...U.doc.doors, ...U.doc.windows]) pts.push(o.a, o.b);
  let b = pts.length ? bbox(pts.map(([x, y]) => [x * U.k, -y * U.k])) : null;
  const c = U.doc.cal;
  if (c && U.img) {
    const p0 = T.imgToPlan(c, [0, 0]), p1 = T.imgToPlan(c, [c.image.w, c.image.h]);
    const ib = bbox([[p0[0] * U.k, -p0[1] * U.k], [p1[0] * U.k, -p1[1] * U.k]]);
    b = b ? { x0: Math.min(b.x0, ib.x0), y0: Math.min(b.y0, ib.y0), x1: Math.max(b.x1, ib.x1), y1: Math.max(b.y1, ib.y1) } : ib;
  }
  return b || { x0: -12, y0: -360, x1: 480, y1: 12 };
}
function fit() {
  const b = contentBox(), pad = Math.max(b.x1 - b.x0, b.y1 - b.y0) * 0.06 + 6;
  U.vb = { x: b.x0 - pad, y: b.y0 - pad, w: b.x1 - b.x0 + 2 * pad, h: b.y1 - b.y0 + 2 * pad };
  applyVB();
}
function applyVB() {
  const svg = $('trSvg'); if (!svg || !U.vb) return;
  svg.setAttribute('viewBox', `${r1(U.vb.x)} ${r1(U.vb.y)} ${r1(U.vb.w)} ${r1(U.vb.h)}`);
  const r = svg.getBoundingClientRect();
  U.upp = r.width && r.height ? Math.max(U.vb.w / r.width, U.vb.h / r.height) : 1;
}
function zoomBy(f, at = null) {
  const v = U.vb, c = at || [v.x + v.w / 2, v.y + v.h / 2];
  const w = Math.max(6, Math.min(40000, v.w * f)), h = (v.h * w) / v.w;
  U.vb = { x: c[0] - ((c[0] - v.x) * w) / v.w, y: c[1] - ((c[1] - v.y) * h) / v.h, w, h };
  applyVB();
}
function svgPt(e) {
  const svg = $('trSvg'), p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY;
  const q = p.matrixTransform(svg.getScreenCTM().inverse()); return [q.x, q.y];
}
const toPlan = ([X, Y]) => [X / U.k, -Y / U.k];
const tolUnits = (px = 9) => (px * U.upp) / U.k;
function wheel(e) {
  e.preventDefault();
  zoomBy(Math.exp((e.ctrlKey ? 0.012 : 0.0018) * e.deltaY), svgPt(e));
  render();
}

// ------------------------------------------------------------------ snapping helpers
function snapCtx(extra = {}) {
  const verts = [], edges = [];
  U.doc.rooms.forEach((r) => r.poly.forEach((p, i) => { verts.push(p); edges.push([p, r.poly[(i + 1) % r.poly.length]]); }));
  return { verts, edges, tol: tolUnits(), grid: T.defaultsFor(U.doc.units).grid, ...extra };
}
function snapDraw(p, e) {
  if (e?.altKey) return { p, kind: 'free', aligned: false };
  const prev = U.draft.length ? U.draft[U.draft.length - 1] : null;
  const ctx = snapCtx({ prev });
  ctx.verts = [...ctx.verts, ...U.draft];
  return T.snapPoint(p, ctx);
}

// ------------------------------------------------------------------ pointer input
function down(e) {
  if (e.button === 2) return;
  const svg = $('trSvg');
  svg.setPointerCapture?.(e.pointerId);
  U.pointers.set(e.pointerId, [e.clientX, e.clientY]);
  if (U.pointers.size === 2) {
    const [a, b] = [...U.pointers.values()];
    U.pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), vb: { ...U.vb } };
    U.drag = null; return;
  }
  const P = svgPt(e), p = toPlan(P);
  const start = { cx: e.clientX, cy: e.clientY, P, p, moved: false, vb: { ...U.vb } };
  if (e.button === 1 || U.space || U.tool === 'pan') { U.drag = { kind: 'pan', ...start }; return; }
  const hit = e.target.closest?.('[data-k]')?.dataset.k || '';
  if (U.tool === 'select') {
    const [type, id, idx] = hit.split(':');
    if (type === 'v' || type === 'm') {
      const r = U.doc.rooms.find((x) => x.id === id); if (!r) return;
      let i = +idx;
      if (type === 'm') { r.poly = T.insertVertex(r.poly, i); i += 1; }
      const at = r.poly[i];
      const shared = U.doc.rooms.flatMap((q) => q.poly.map((v, j) => [q.id, j, v])).filter(([qid, j, v]) => !(qid === r.id && j === i) && Math.hypot(v[0] - at[0], v[1] - at[1]) < 1e-6).map(([qid, j]) => [qid, j]);
      U.drag = { kind: 'vertex', room: r.id, i, shared: e.altKey ? [] : shared, inserted: type === 'm', ...start };
      return;
    }
    if (type === 'door' || type === 'window') {
      U.sel = { type, id }; const o = findSel(U.sel);
      const m = [(o.a[0] + o.b[0]) / 2, (o.a[1] + o.b[1]) / 2], w = T.nearestWall(m, walls(), tolUnits(4) + U.doc.wall);
      U.drag = { kind: 'opening', type, id, wall: w?.wall || null, width: Math.hypot(o.b[0] - o.a[0], o.b[1] - o.a[1]), ...start };
      render(); return;
    }
    if (type === 'fixture' || type === 'room') {
      const already = U.sel?.type === type && U.sel.id === id;
      U.sel = { type, id };
      U.drag = already ? { kind: 'move', type, id, orig: JSON.parse(JSON.stringify(findSel(U.sel))), ...start } : { kind: 'pan', ...start };
      render(); return;
    }
    U.drag = { kind: 'pan', deselect: true, ...start };
    return;
  }
  if (U.tool === 'rect' || U.tool === 'fixture') {
    const s = T.snapPoint(p, snapCtx());
    U.drag = { kind: 'box', a: s.p, b: s.p, ...start }; U.snap = s; return;
  }
  U.drag = { kind: 'click', ...start };
}

function move(e) {
  if (U.pointers.has(e.pointerId)) U.pointers.set(e.pointerId, [e.clientX, e.clientY]);
  if (U.pinch && U.pointers.size === 2) {
    const [a, b] = [...U.pointers.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
    if (d > 0) { U.vb = { ...U.pinch.vb }; applyVB(); zoomBy(U.pinch.d / d, svgPt({ clientX: (a[0] + b[0]) / 2, clientY: (a[1] + b[1]) / 2 })); render(); }
    return;
  }
  const P = svgPt(e), p = toPlan(P), D = U.drag;
  U.cursor = p;
  if (!D) { hover(p, e); return; }
  if (!D.moved && Math.hypot(e.clientX - D.cx, e.clientY - D.cy) > 4) D.moved = true;
  if (!D.moved) return;
  if (D.kind === 'pan' || D.kind === 'click') {
    D.kind = 'pan';
    const sc = U.upp;
    U.vb = { ...D.vb, x: D.vb.x - (e.clientX - D.cx) * sc, y: D.vb.y - (e.clientY - D.cy) * sc };
    applyVB(); render(); return;
  }
  if (D.kind === 'vertex') {
    const r = U.doc.rooms.find((x) => x.id === D.room);
    const ctx = snapCtx();
    const skip = new Set([`${D.room}:${D.i}`, ...D.shared.map(([q, j]) => `${q}:${j}`)]);
    ctx.verts = U.doc.rooms.flatMap((q) => q.poly.filter((_, j) => !skip.has(`${q.id}:${j}`)));
    ctx.edges = U.doc.rooms.flatMap((q) => q.poly.map((v, j) => [v, q.poly[(j + 1) % q.poly.length], q.id, j])).filter(([, , qid, j]) => !skip.has(`${qid}:${j}`) && !skip.has(`${qid}:${(j + 1) % (U.doc.rooms.find((x) => x.id === qid).poly.length)}`)).map(([a, b]) => [a, b]);
    const s = e.altKey ? { p, kind: 'free' } : T.snapPoint(p, ctx);
    U.snap = s;
    r.poly[D.i] = s.p;
    for (const [qid, j] of D.shared) { const q = U.doc.rooms.find((x) => x.id === qid); if (q) q.poly[j] = [...s.p]; }
    drawStatic(); overlay(); return;
  }
  if (D.kind === 'opening') {
    const o = findSel({ type: D.type, id: D.id }); if (!o || !D.wall) return;
    const w = T.nearestWall(p, walls(), tolUnits(14)) || { wall: D.wall };
    const placed = T.placeOpening(w.wall, p, D.width);
    if (placed) { o.a = placed.a; o.b = placed.b; D.wall = w.wall; }
    drawStatic(); overlay(); return;
  }
  if (D.kind === 'move') {
    const g = T.defaultsFor(U.doc.units).grid, dx = Math.round((p[0] - D.p[0]) / g) * g, dy = Math.round((p[1] - D.p[1]) / g) * g;
    const o = findSel({ type: D.type, id: D.id });
    if (D.type === 'room') o.poly = D.orig.poly.map(([x, y]) => [+(x + dx).toFixed(6), +(y + dy).toFixed(6)]);
    else if (o.poly) o.poly = D.orig.poly.map(([x, y]) => [x + dx, y + dy]);
    else { o.x = +(D.orig.x + dx).toFixed(6); o.y = +(D.orig.y + dy).toFixed(6); }
    drawStatic(); overlay(); return;
  }
  if (D.kind === 'box') {
    const s = T.snapPoint(p, snapCtx({ prev: null })); U.snap = s; D.b = s.p; overlay(); return;
  }
}
function hover(p, e) {
  U.snap = null;
  if (U.tool === 'poly') U.snap = snapDraw(p, e);
  else if (['scale', 'check'].includes(U.tool)) {
    const d = U.tool === 'scale' ? U.scaleDraft : U.checkDraft;
    const prev = d.length === 1 ? T.imgToPlan(U.doc.cal, d[0]) : null;
    U.snap = prev ? T.snapPoint(p, { prev, tol: tolUnits(), angle: !e.altKey }) : { p, kind: 'free' };
  } else if (['rect', 'fixture'].includes(U.tool)) U.snap = T.snapPoint(p, snapCtx());
  else if (['door', 'window', 'facade'].includes(U.tool)) {
    const w = T.nearestWall(p, walls(), tolUnits(14));
    U.snap = w ? { p: w.q, kind: 'wall', wall: w.wall } : null;
  }
  overlay();
}
function up(e) {
  U.pointers.delete(e.pointerId);
  if (U.pinch) { if (U.pointers.size < 2) U.pinch = null; return; }
  const D = U.drag; U.drag = null;
  if (!D) return;
  const p = toPlan(svgPt(e));
  if (D.kind === 'pan') { if (!D.moved && D.deselect) { U.sel = null; render(); } return; }
  if (D.kind === 'vertex') {
    if (!D.moved && !D.inserted) { U.sel = { type: 'room', id: D.room }; render(); return; }
    const r = U.doc.rooms.find((x) => x.id === D.room);
    r.poly = T.cleanPoly(r.poly, 1e-6);
    for (const [qid] of D.shared) { const q = U.doc.rooms.find((x) => x.id === qid); if (q) q.poly = T.cleanPoly(q.poly, 1e-6); }
    U.sel = { type: 'room', id: r.id };
    commit(D.inserted ? 'Add corner' : 'Move corner', `${r.name}: ${D.inserted ? 'corner added' : 'corner moved'}`); return;
  }
  if (D.kind === 'opening') {
    if (D.moved) { const o = findSel({ type: D.type, id: D.id }); commit(`Move ${D.type}`, `${o.name || (D.type === 'door' ? 'Door' : 'Window')} moved`); }
    return;
  }
  if (D.kind === 'move') { if (D.moved) commit(`Move ${D.type}`, `${findSel({ type: D.type, id: D.id }).name || findSel({ type: D.type, id: D.id }).label || FIX_NAMES[findSel({ type: D.type, id: D.id }).kind] || 'Item'} moved`); return; }
  if (D.kind === 'box') {
    const a = D.a, b = D.moved ? D.b : null;
    if (!b) { // click-click: first click sets the corner, the next click finishes
      if (!U.boxStart) { U.boxStart = a; overlay(); return; }
      finishBox(U.boxStart, a); U.boxStart = null; return;
    }
    U.boxStart = null; finishBox(a, b); return;
  }
  if (D.kind === 'click') click(p, e);
}

// ------------------------------------------------------------------ tool actions
function click(p, e) {
  const t = U.tool;
  if (t === 'poly') {
    const s = snapDraw(p, e);
    if (U.draft.length >= 3 && Math.hypot(s.p[0] - U.draft[0][0], s.p[1] - U.draft[0][1]) < 1e-6) { closePoly(); return; }
    U.draft.push(s.p); overlay(); hud(); return;
  }
  if (t === 'scale' || t === 'check') {
    const d = t === 'scale' ? U.scaleDraft : U.checkDraft, c = U.doc.cal;
    if (!c) { toast('Load the plan image first.'); return; }
    const prev = d.length === 1 ? T.imgToPlan(c, d[0]) : null;
    const s = prev && !e.altKey ? T.snapPoint(p, { prev, tol: tolUnits(), angle: true }) : { p };
    if (d.length >= 2) d.length = 0;
    d.push(T.planToImg(c, s.p).map((v) => Math.round(v * 10) / 10));
    render();
    if (d.length === 2) setTimeout(() => $(t === 'scale' ? 'trScaleLen' : 'trCheckLen')?.focus({ preventScroll: true }), 0);
    return;
  }
  if (t === 'arrow') {
    if (U.arrowDraft.length >= 2) U.arrowDraft = [];
    U.arrowDraft.push(p);
    if (U.arrowDraft.length === 2) {
      const b = T.bearingFromArrow(U.arrowDraft[0], U.arrowDraft[1]);
      if (b != null) { U.doc.up_bearing = b; U.doc.bearing = { method: 'arrow' }; commit('North arrow', `Orientation from the north arrow: top faces ${b}°`); return; }
    }
    overlay(); return;
  }
  if (t === 'facade') {
    const w = T.nearestWall(p, walls(), tolUnits(14));
    if (!w) { hud('Click on an outside wall'); return; }
    if (!w.wall.exterior) { hud('That wall has rooms on both sides; pick an outside wall'); return; }
    U.facadeWall = w.wall; render();
    setTimeout(() => $('trFacadeDir')?.focus({ preventScroll: true }), 0);
    return;
  }
  if (t === 'door' || t === 'window') {
    const w = T.nearestWall(p, walls(), tolUnits(14));
    if (!w) { hud('Click on a wall'); return; }
    const d = T.defaultsFor(U.doc.units), placed = T.placeOpening(w.wall, p, t === 'door' ? d.door : d.window);
    if (!placed) return;
    const side = Math.sign((p[0] - w.q[0]) * w.wall.n[0] + (p[1] - w.q[1]) * w.wall.n[1]) || 1;
    const id = T.newId(t === 'door' ? 'd' : 'n');
    if (t === 'door') {
      const sides = T.sidesOf(placed, U.doc.rooms), into = (side > 0 ? sides.left : sides.right) ? side : -side;
      const o = { id, a: placed.a, b: placed.b, hinge: 'a', ...T.swingInto(placed, into, U.doc.rooms), name: '' };
      U.doc.doors = [...U.doc.doors, o];
    } else {
      const sides = T.sidesOf(placed, U.doc.rooms);
      U.doc.windows = [...U.doc.windows, { id, a: placed.a, b: placed.b, sill: +d.sill.toFixed(3), head: +d.head.toFixed(3), room: sides.left || sides.right || '' }];
    }
    U.sel = { type: t, id };
    commit(`Add ${t}`, `${t === 'door' ? 'Door' : 'Window'} added`); return;
  }
}
function closePoly() {
  const poly = T.cleanPoly(U.draft);
  U.draft = [];
  if (poly.length < 3 || T.roomArea(poly) < 1e-6) { toast('A room needs at least three corners.'); overlay(); return; }
  if (T.selfIntersects(poly)) toast('That outline crosses itself; drag a corner to fix it.', 3200);
  addRoom(poly);
}
function finishBox(a, b) {
  const x = Math.min(a[0], b[0]), y = Math.min(a[1], b[1]), w = Math.abs(b[0] - a[0]), h = Math.abs(b[1] - a[1]);
  const min = T.defaultsFor(U.doc.units).grid * 3;
  if (w < min || h < min) { overlay(); hud('Drag a larger rectangle'); return; }
  if (U.tool === 'rect') { addRoom([[x, y], [x + w, y], [x + w, y + h], [x, y + h]]); return; }
  const id = T.newId('f'), kind = U.fixKind;
  U.doc.fixtures = [...U.doc.fixtures, { id, kind, label: '', x: +x.toFixed(6), y: +y.toFixed(6), w: +w.toFixed(6), h: +h.toFixed(6), ...(kind === 'ac' || kind === 'ptac' ? { est: true } : {}) }];
  U.sel = { type: 'fixture', id };
  commit('Add fixture', `${FIX_NAMES[kind]} added`);
}
function addRoom(poly) {
  const id = T.newId('r'), n = U.doc.rooms.length + 1;
  U.doc.rooms = [...U.doc.rooms, { id, name: `Room ${n}`, kind: 'other', poly, stated: '', est: false }];
  U.sel = { type: 'room', id };
  commit('Add room', `Room ${n} added`);
  setTimeout(() => { const el = $('trRoomName'); el?.focus({ preventScroll: true }); el?.select(); }, 0);
}
function deleteSel() {
  const s = U.sel; if (!s) return;
  const key = { room: 'rooms', door: 'doors', window: 'windows', fixture: 'fixtures' }[s.type], it = findSel(s);
  U.doc[key] = U.doc[key].filter((x) => x.id !== s.id);
  U.sel = null;
  commit(`Delete ${s.type}`, `${it?.name || it?.label || s.type} removed`);
}

// ------------------------------------------------------------------ keyboard
function onKey(e) {
  if (!U.open) return;
  e.stopPropagation(); // the studio and the app shortcuts stay quiet while the tracer is open
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName || '') || e.target?.isContentEditable;
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); undoRedo(!e.shiftKey); return; }
  if (mod && e.key.toLowerCase() === 'y' && !typing) { e.preventDefault(); undoRedo(false); return; }
  if (e.key === 'Escape') {
    e.preventDefault();
    if (typing) { e.target.blur(); return; }
    if (U.draft.length || U.boxStart || U.scaleDraft.length === 1 || U.checkDraft.length === 1 || U.arrowDraft.length === 1) { U.draft = []; U.boxStart = null; if (U.scaleDraft.length === 1) U.scaleDraft = []; if (U.checkDraft.length === 1) U.checkDraft = []; U.arrowDraft = []; overlay(); return; }
    if (U.sel) { U.sel = null; render(); return; }
    closeTracer(); return;
  }
  if (typing) return;
  if (e.key === 'Enter' && U.tool === 'poly' && U.draft.length >= 3) { e.preventDefault(); closePoly(); return; }
  if (e.key === 'Backspace' || e.key === 'Delete') {
    e.preventDefault();
    if (U.tool === 'poly' && U.draft.length) { U.draft.pop(); overlay(); return; }
    deleteSel(); return;
  }
  if (e.key === ' ') { e.preventDefault(); U.space = true; $('trStage')?.classList.add('panning'); return; }
  if (e.key === '+' || e.key === '=') { zoomBy(0.7); render(); return; }
  if (e.key === '-' || e.key === '_') { zoomBy(1 / 0.7); render(); return; }
  if (e.key === '0') { fit(); render(); return; }
  if (mod || e.altKey) return;
  const tool = Object.entries(TOOL_NAMES).find(([, [, k]]) => k.toLowerCase() === e.key.toLowerCase())?.[0];
  if (tool) {
    const step = Object.entries(STEP_TOOLS).find(([s, ts]) => ts.includes(tool) && STEPS[U.mode].some(([k]) => k === s))?.[0];
    if (tool === 'select' || tool === 'pan' || (STEP_TOOLS[U.step] || []).includes(tool)) setTool(tool);
    else if (step) { goStep(step); setTool(tool); }
  }
}
function onKeyUp(e) { if (!U.open) return; e.stopPropagation(); if (e.key === ' ') { U.space = false; $('trStage')?.classList.remove('panning'); } }

// ------------------------------------------------------------------ files: images and PDF pages (local only)
async function loadFile(file) {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  if (!isPdf && !/^image\//.test(file.type)) { toast('Choose a PNG, JPEG, WebP or PDF file.'); return; }
  if (file.size > 60 * 1024 * 1024) { toast('That file is larger than 60 MB.'); return; }
  if (isPdf) {
    try {
      hud('Loading the PDF reader…');
      const lib = await loadPdfJs();
      const pdf = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false, disableFontFace: false }).promise;
      U.pdf = { doc: pdf, name: file.name, pages: pdf.numPages, page: 1 };
      await renderPdfPage(1);
    } catch (e) { toast(`Could not read that PDF: ${e.message || e}`, 5200); hud(''); }
    return;
  }
  U.pdf = null;
  await setImage(URL.createObjectURL(file), file.name, null);
}
let pdfLib = null;
async function loadPdfJs() {
  if (pdfLib) return pdfLib;
  // pdfjs-dist 4.10.38, vendored in dashboard/vendor/pdfjs/ and named in the page's import map (a data: URL
  // in the standalone file, where the worker is turned into a blob URL because a worker needs a real URL)
  const lib = await import('pdfjs-dist');
  const worker = import.meta.resolve('pdfjs-dist/worker');
  lib.GlobalWorkerOptions.workerSrc = worker.startsWith('data:')
    ? URL.createObjectURL(await (await fetch(worker)).blob()) : worker;
  pdfLib = lib;
  return pdfLib;
}
async function renderPdfPage(n) {
  const page = await U.pdf.doc.getPage(n), v1 = page.getViewport({ scale: 1 });
  const scale = Math.min(4, 2400 / Math.max(v1.width, v1.height)), vp = page.getViewport({ scale });
  const canvas = document.createElement('canvas'); canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
  const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
  U.pdf.page = n;
  await setImage(URL.createObjectURL(blob), U.pdf.name, n);
}
async function setImage(url, name, page) {
  const im = new Image();
  try { await new Promise((res, rej) => { im.onload = res; im.onerror = () => rej(new Error('not an image')); im.src = url; }); } catch (e) { URL.revokeObjectURL(url); toast(`Could not open that image: ${e.message}`); return; }
  if (U.img?.url) URL.revokeObjectURL(U.img.url);
  U.img = { url, w: im.naturalWidth, h: im.naturalHeight, name: T.plainText(name, 120), page, opacity: U.img?.opacity ?? 0.6, hidden: false };
  const image = { name: U.img.name, w: U.img.w, h: U.img.h, ...(page ? { page } : {}) };
  const c = U.doc.cal;
  if (c && c.image.w === image.w && c.image.h === image.h) { U.doc.cal = { ...c, image }; hud('Same image size as the saved trace: the scale is kept.'); }
  else if (!c || c.provisional || !U.doc.rooms.length) U.doc.cal = T.provisionalCal(image, U.doc.units);
  else { U.doc.cal = { ...c, image }; toast('This image has a different size from the one traced; set the scale again to realign.', 5200); }
  U.scaleDraft = []; U.checkDraft = [];
  commit('Load image');
  fit(); render();
}

// ------------------------------------------------------------------ scale, check, orientation
function applyScale() {
  const c = U.doc.cal, len = T.parseLength($('trScaleLen')?.value, U.doc.units);
  const anchors = U.scaleDraft.length === 2 ? U.scaleDraft : c?.anchors;
  if (!c || !anchors) { toast('Click both ends of a printed dimension first.'); return; }
  if (!len) { toast(`Type the printed length, for example ${U.doc.units === 'm' ? '4.25 m' : '14\'6"'}.`); $('trScaleLen')?.focus({ preventScroll: true }); return; }
  const check = c.check ? { anchors: c.check.anchors, length: c.check.length } : null;
  const cal = T.makeCal({ image: c.image, anchors, length: len, check, origin: c.origin });
  if (!cal) { toast('The two points are on top of each other.'); return; }
  U.doc = T.recalibrate(U.doc, cal);
  U.scaleDraft = [];
  commit('Set scale');
  fit(); render();
}
function applyCheck() {
  const c = U.doc.cal, len = T.parseLength($('trCheckLen')?.value, U.doc.units);
  const anchors = U.checkDraft.length === 2 ? U.checkDraft : c?.check?.anchors;
  if (!c || c.provisional) { toast('Set the scale first.'); return; }
  if (!anchors) { toast('Click both ends of a second printed dimension first.'); return; }
  if (!len) { toast('Type the printed length of the check dimension.'); $('trCheckLen')?.focus({ preventScroll: true }); return; }
  U.doc.cal = T.makeCal({ image: c.image, anchors: c.anchors, length: c.length, check: { anchors, length: len }, origin: c.origin });
  U.checkDraft = [];
  commit('Check dimension');
}
function setFacade(faces) {
  const w = U.facadeWall; if (!w || !Number.isFinite(faces)) return;
  const inside = w.left ? 1 : -1, n = [-w.n[0] * inside, -w.n[1] * inside];
  const b = T.bearingFromFacade(n, faces);
  U.doc.up_bearing = b; U.doc.bearing = { method: 'facade', faces: T.norm360(faces), wall: w.left || w.right || '' };
  commit('Facade bearing', `Orientation from the ${U.doc.bearing.wall || 'outside'} wall facing ${T.norm360(faces)}°`);
}

// ------------------------------------------------------------------ rendering
function render() {
  if (!U.open) return;
  applyVB();
  $('trTools').innerHTML = toolsMarkup();
  $('trUndo').disabled = !U.hist.canUndo; $('trRedo').disabled = !U.hist.canRedo;
  const stage = $('trStage');
  stage.dataset.tool = U.space ? 'pan' : U.tool;
  $('trHint').textContent = HINTS[U.tool] || '';
  drawImage(); drawStatic(); overlay(); side(); sub(); hud();
  $('trShell').querySelectorAll('[data-step]').forEach((b) => {
    const k = b.dataset.step;
    b.classList.toggle('done', stepDone(k));
    b.disabled = !scaled() && !['image', 'scale', 'north'].includes(k) && U.mode === 'trace';
  });
}
function stepDone(k) {
  const d = U.doc;
  return { image: !!d.cal, scale: scaled(), north: Number.isFinite(d.up_bearing), rooms: d.rooms.length > 0, openings: d.doors.length + d.windows.length > 0, fixtures: d.fixtures.length > 0, details: !!d.title, save: false }[k];
}
function sub() {
  const d = U.doc, area = d.rooms.reduce((s, r) => s + T.roomArea(r.poly), 0);
  const bits = [];
  if (d.rooms.length) bits.push(`<b>${esc(T.fmtArea(area, d.units))}</b> in ${d.rooms.length} room${d.rooms.length === 1 ? '' : 's'}`);
  if (U.mode === 'trace') bits.push(scaled() ? confidencePill() : '<span class="pill warn">Scale not set</span>');
  if (Number.isFinite(d.up_bearing)) bits.push(`top faces ${Math.round(d.up_bearing)}° ${T.compass16(d.up_bearing)}`);
  if (U.mode === 'edit') bits.push('<span class="pill accent">Local edit</span> the search file is unchanged');
  $('trSub').innerHTML = bits.join(' · ') || 'Load a floor plan image or PDF to start. It stays in this browser.';
}
function confidencePill() {
  const c = U.doc.cal, conf = T.confidenceOf(c?.check?.error_pct);
  if (conf === 'unchecked') return '<span class="pill">Scale set · unchecked</span>';
  const cls = { high: 'good', medium: 'warn', low: 'bad' }[conf];
  return `<span class="pill ${cls}">Scale ${conf === 'high' ? 'checked' : conf === 'medium' ? 'roughly checked' : 'disagrees'} · ${Math.abs(c.check.error_pct).toFixed(1)}%</span>`;
}

function drawImage() {
  const g = $('trImgG'), c = U.doc.cal;
  $('trSvg').classList.toggle('has-img', !!(U.img && c && !U.img.hidden));
  if (!U.img || !c || U.img.hidden) { g.innerHTML = ''; return; }
  const p0 = T.imgToPlan(c, [0, 0]), K = U.k, w = (c.image.w / c.scale) * K, h = (c.image.h / c.scale) * K;
  g.innerHTML = `<image href="${esc(U.img.url)}" x="${r1(p0[0] * K)}" y="${r1(-p0[1] * K)}" width="${r1(w)}" height="${r1(h)}" preserveAspectRatio="none" opacity="${U.img.opacity}" class="tr-img" id="trImg"/>`;
}

let lastModel = null;
function drawStatic() {
  const g = $('trStatic'), d = U.doc, K = U.k, u = U.upp;
  const P = (poly) => poly.map(([x, y]) => `${r1(x * K)},${r1(-y * K)}`).join(' ');
  const Pin = (poly) => poly.map(([x, y]) => `${r1(x)},${r1(-y)}`).join(' ');
  let m = null;
  try { m = d.rooms.length ? normalisePlan(T.toPlanJSON(d, { origin: false })) : null; } catch { m = null; }
  lastModel = m;
  const rooms = d.rooms.map((r) => `<polygon class="p2-room k-${esc(r.kind)} tr-room${U.sel?.type === 'room' && U.sel.id === r.id ? ' sel' : ''}" data-k="room:${esc(r.id)}" points="${P(r.poly)}"/>`).join('');
  const grid = d.rooms.map((r) => `<polygon points="${P(r.poly)}" fill="url(#trgrid)" pointer-events="none"/>`).join('');
  let walls = '', wins = '', doors = '', fx = '';
  if (m) {
    const low = m.pieces.filter((p) => p.z0 < 1);
    walls = low.filter((p) => p.kind === 'solid').map((p) => `<polygon points="${Pin(piecePoly(p))}"/>`).join('');
    wins = low.filter((p) => p.kind === 'sill').map((p) => `<polygon points="${Pin(piecePoly(p))}"/><line x1="${r1(p.a[0])}" y1="${r1(-p.a[1])}" x2="${r1(p.b[0])}" y2="${r1(-p.b[1])}"/>`).join('');
    doors = m.doors.map((md) => {
      const sw = swingPoly(md, 14);
      if (sw) { const end = sw[sw.length - 1]; return `<polyline class="p2-arc" points="${Pin(sw.slice(1))}"/><line class="p2-leaf" x1="${r1(md.hingePt[0])}" y1="${r1(-md.hingePt[1])}" x2="${r1(end[0])}" y2="${r1(-end[1])}"/>`; }
      if (['slide', 'pocket', 'none'].includes(md.swing)) return '';
      return `<polygon class="p2-doorway" points="${Pin(doorwayPoly(md, 18))}"/>`;
    }).join('');
    fx = m.fixtures.map((f, i) => {
      const src = d.fixtures[i];
      return `${f.reservePoly ? `<polygon class="p2-reserve${f.kind === 'ac' || f.kind === 'ptac' ? ' ac' : ''}" points="${Pin(f.reservePoly)}"/>` : ''}<g class="p2-fx k-${esc(f.kind)}${f.est ? ' est' : ''}"><polygon data-k="fixture:${esc(src?.id || '')}" class="tr-hit-fx" points="${Pin(f.poly)}"/></g>`;
    }).join('');
  }
  // invisible wide hit lines so thin openings are easy to grab
  const hits = [...d.doors.map((o) => ['door', o]), ...d.windows.map((o) => ['window', o])].map(([t, o]) => `<line class="tr-hit" data-k="${t}:${esc(o.id)}" x1="${r1(o.a[0] * K)}" y1="${r1(-o.a[1] * K)}" x2="${r1(o.b[0] * K)}" y2="${r1(-o.b[1] * K)}"/>`).join('');
  const fs = 12 * u, fs2 = 10.5 * u;
  const labels = d.rooms.map((r, i) => {
    const at = m?.rooms[i]?.label || [((bbox(r.poly).x0 + bbox(r.poly).x1) / 2) * K, ((bbox(r.poly).y0 + bbox(r.poly).y1) / 2) * K];
    const bb = bbox(r.poly), small = Math.min(bb.x1 - bb.x0, bb.y1 - bb.y0) * K < 46 * u;
    const f1 = small ? fs * 0.85 : fs, f2 = small ? fs2 * 0.85 : fs2, area = T.fmtArea(T.roomArea(r.poly), d.units);
    const cw = Math.max(r.name.length * f1 * 0.58, area.length * f2 * 0.62) + 10 * u, ch = f1 + f2 + 10 * u;
    return `<g class="tr-label${small ? ' sm' : ''}"><rect class="tr-chip" x="${r1(at[0] - cw / 2)}" y="${r1(-at[1] - fs * 0.3 - f1 * 0.95 - 3 * u)}" width="${r1(cw)}" height="${r1(ch)}" rx="${r1(5 * u)}"/><text x="${r1(at[0])}" y="${r1(-at[1] - fs * 0.3)}" style="font-size:${r1(f1)}px">${esc(r.name)}</text><text class="a" x="${r1(at[0])}" y="${r1(-at[1] + fs2 * 1.05)}" style="font-size:${r1(small ? fs2 * 0.85 : fs2)}px">${esc(T.fmtArea(T.roomArea(r.poly), d.units))}</text></g>`;
  }).join('');
  const fxLabels = d.fixtures.map((f, i) => {
    const mf = m?.fixtures[i]; if (!mf) return '';
    const b = bbox(mf.poly); if (Math.min(b.x1 - b.x0, b.y1 - b.y0) < 26 * u) return '';
    return `<text class="tr-fxl" x="${r1((b.x0 + b.x1) / 2)}" y="${r1(-(b.y0 + b.y1) / 2)}" style="font-size:${r1(9.5 * u)}px">${esc(f.label || FIX_NAMES[f.kind] || f.kind)}</text>`;
  }).join('');
  g.innerHTML = `<g class="tr-rooms">${rooms}</g><g class="p2-grids">${grid}</g><g class="p2-doors">${doors}</g><g class="p2-fixtures">${fx}</g><g class="p2-walls">${walls}</g><g class="p2-wins">${wins}</g><g class="tr-hits">${hits}</g><g class="tr-labels">${labels}${fxLabels}</g>`;
}

function overlay() {
  const g = $('trOver'); if (!g) return;
  const d = U.doc, K = U.k, u = U.upp, X = (p) => r1(p[0] * K), Y = (p) => r1(-p[1] * K);
  const R = 5.5 * u, out = [];
  // selection
  const s = findSel(U.sel);
  if (s && U.sel.type === 'room') {
    out.push(`<polygon class="tr-sel-room" points="${s.poly.map((p) => `${X(p)},${Y(p)}`).join(' ')}"/>`);
    if (U.tool === 'select') {
      s.poly.forEach((p, i) => { const q = s.poly[(i + 1) % s.poly.length], mid = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]; out.push(`<circle class="tr-mid" data-k="m:${esc(s.id)}:${i}" cx="${X(mid)}" cy="${Y(mid)}" r="${r1(R * 0.7)}"><title>Drag to add a corner</title></circle>`); });
      s.poly.forEach((p, i) => out.push(`<circle class="tr-vtx" data-k="v:${esc(s.id)}:${i}" cx="${X(p)}" cy="${Y(p)}" r="${r1(R)}"><title>Drag to move this corner</title></circle>`));
    }
  } else if (s && (U.sel.type === 'door' || U.sel.type === 'window')) {
    out.push(`<line class="tr-sel-line" x1="${X(s.a)}" y1="${Y(s.a)}" x2="${X(s.b)}" y2="${Y(s.b)}"/>`);
    if (U.sel.type === 'door') {
      const ends = [['A', s.a], ['B', s.b]];
      for (const [t, p] of ends) out.push(`<g class="tr-end${(s.hinge || 'a').toUpperCase() === t ? ' on' : ''}"><circle cx="${X(p)}" cy="${Y(p)}" r="${r1(R * 1.25)}"/><text x="${X(p)}" y="${Y(p)}" style="font-size:${r1(8.5 * u)}px">${t}</text></g>`);
    }
  } else if (s && U.sel.type === 'fixture' && lastModel) {
    const i = d.fixtures.indexOf(s), mf = lastModel.fixtures[i];
    if (mf) out.push(`<polygon class="tr-sel-room" points="${mf.poly.map(([x, y]) => `${r1(x)},${r1(-y)}`).join(' ')}"/>`);
  }
  // all corners while drawing, so snapping targets are visible
  if (['poly', 'rect', 'fixture'].includes(U.tool)) for (const r of d.rooms) for (const p of r.poly) out.push(`<circle class="tr-dot" cx="${X(p)}" cy="${Y(p)}" r="${r1(2.2 * u)}"/>`);
  // walls highlight for door/window/facade tools
  if (['door', 'window', 'facade'].includes(U.tool) && U.snap?.wall) {
    const w = U.snap.wall; out.push(`<line class="tr-wall-hi${U.tool === 'facade' && !w.exterior ? ' bad' : ''}" x1="${X(w.a)}" y1="${Y(w.a)}" x2="${X(w.b)}" y2="${Y(w.b)}"/>`);
    if (U.tool !== 'facade') {
      const dd = T.defaultsFor(d.units), pl = T.placeOpening(w, U.snap.p, U.tool === 'door' ? dd.door : dd.window);
      if (pl) out.push(`<line class="tr-ghost" x1="${X(pl.a)}" y1="${Y(pl.a)}" x2="${X(pl.b)}" y2="${Y(pl.b)}"/>`);
    }
  }
  if (U.facadeWall && U.step === 'north') { const w = U.facadeWall; out.push(`<line class="tr-wall-hi on" x1="${X(w.a)}" y1="${Y(w.a)}" x2="${X(w.b)}" y2="${Y(w.b)}"/>`); }
  // draft polygon
  if (U.tool === 'poly' && (U.draft.length || U.snap)) {
    const pts = [...U.draft, ...(U.snap ? [U.snap.p] : [])];
    if (pts.length > 1) out.push(`<polyline class="tr-draft" points="${pts.map((p) => `${X(p)},${Y(p)}`).join(' ')}"/>`);
    if (U.draft.length >= 2 && U.snap) out.push(`<line class="tr-draft close" x1="${X(U.snap.p)}" y1="${Y(U.snap.p)}" x2="${X(U.draft[0])}" y2="${Y(U.draft[0])}"/>`);
    U.draft.forEach((p, i) => out.push(`<circle class="tr-vtx${i === 0 && U.draft.length >= 3 ? ' first' : ''}" cx="${X(p)}" cy="${Y(p)}" r="${r1(i === 0 ? R * 1.15 : R * 0.8)}"/>`));
    if (U.snap && U.draft.length) {
      const a = U.draft[U.draft.length - 1], b = U.snap.p, L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L > 0) out.push(dimLabel(a, b, T.fmtLen(L, d.units), u));
    }
  }
  if (U.snap && ['poly', 'rect', 'fixture'].includes(U.tool)) out.push(snapMark(U.snap, X, Y, R));
  // rectangles being drawn
  const box = U.drag?.kind === 'box' ? [U.drag.a, U.drag.b] : U.boxStart && U.snap ? [U.boxStart, U.snap.p] : null;
  if (box) {
    const [a, b] = box, x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
    out.push(`<polygon class="tr-draft fill" points="${X([x0])},${Y([0, y0])} ${X([x1])},${Y([0, y0])} ${X([x1])},${Y([0, y1])} ${X([x0])},${Y([0, y1])}"/>`);
    out.push(dimLabel([x0, y0], [x1, y0], T.fmtLen(x1 - x0, d.units), u, -1), dimLabel([x1, y0], [x1, y1], T.fmtLen(y1 - y0, d.units), u, -1));
  }
  // scale and check dimensions (image pixels -> plan)
  const c = d.cal;
  if (c && !c.provisional && c.anchors && !U.scaleDraft.length) out.push(dimLine(T.imgToPlan(c, c.anchors[0]), T.imgToPlan(c, c.anchors[1]), `${T.fmtLen(c.length, d.units)} scale`, 'scale', u));
  if (c && U.scaleDraft.length) {
    const a = T.imgToPlan(c, U.scaleDraft[0]), b = U.scaleDraft[1] ? T.imgToPlan(c, U.scaleDraft[1]) : U.tool === 'scale' && U.snap ? U.snap.p : null;
    out.push(b ? dimLine(a, b, U.scaleDraft[1] ? 'Type its length' : '', 'scale draft', u) : `<circle class="tr-anchor" cx="${X(a)}" cy="${Y(a)}" r="${r1(R)}"/>`);
  }
  if (c?.check && !U.checkDraft.length) {
    const conf = T.confidenceOf(c.check.error_pct);
    out.push(dimLine(T.imgToPlan(c, c.check.anchors[0]), T.imgToPlan(c, c.check.anchors[1]), `${T.fmtLen(c.check.measured, d.units)} vs ${T.fmtLen(c.check.length, d.units)} printed`, `check ${conf}`, u));
  }
  if (c && U.checkDraft.length) {
    const a = T.imgToPlan(c, U.checkDraft[0]), b = U.checkDraft[1] ? T.imgToPlan(c, U.checkDraft[1]) : U.tool === 'check' && U.snap ? U.snap.p : null;
    out.push(b ? dimLine(a, b, `measures ${T.fmtLen(Math.hypot(b[0] - a[0], b[1] - a[1]), d.units)}`, 'check draft', u) : `<circle class="tr-anchor" cx="${X(a)}" cy="${Y(a)}" r="${r1(R)}"/>`);
  }
  // north arrow
  if (U.step === 'north' && U.tool === 'arrow' && U.arrowDraft.length) {
    const a = U.arrowDraft[0], b = U.arrowDraft[1] || U.cursor;
    out.push(`<circle class="tr-anchor" cx="${X(a)}" cy="${Y(a)}" r="${r1(R)}"/>`);
    if (b) out.push(`<line class="tr-north" x1="${X(a)}" y1="${Y(a)}" x2="${X(b)}" y2="${Y(b)}" marker-end="url(#trArrowHead)"/>`);
  }
  g.innerHTML = `<defs><marker id="trArrowHead" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" class="tr-north-head"/></marker></defs>${out.join('')}`;
  hud();
}
function snapMark(s, X, Y, R) {
  const cls = { vertex: 'v', square: 'a', diagonal: 'a', edge: 'e', free: 'f' }[s.kind] || 'f';
  return `<circle class="tr-snap ${cls}${s.aligned ? ' al' : ''}" cx="${X(s.p)}" cy="${Y(s.p)}" r="${r1(R * (cls === 'v' ? 1.5 : 1.1))}"/>`;
}
function dimLabel(a, b, text, u, side = 1) {
  const K = U.k, m = [((a[0] + b[0]) / 2) * K, ((a[1] + b[1]) / 2) * K], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const n = [-(b[1] - a[1]) / L, (b[0] - a[0]) / L], off = 14 * u * side;
  return `<text class="tr-dim" x="${r1(m[0] + n[0] * off)}" y="${r1(-(m[1] + n[1] * off))}" style="font-size:${r1(10.5 * u)}px">${esc(text)}</text>`;
}
function dimLine(a, b, text, cls, u) {
  const K = U.k, L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, n = [(-(b[1] - a[1]) / L) * 7 * u, ((b[0] - a[0]) / L) * 7 * u];
  const A = [a[0] * K, -a[1] * K], B = [b[0] * K, -b[1] * K], N = [n[0], -n[1]];
  const tick = (p) => `<line x1="${r1(p[0] - N[0])}" y1="${r1(p[1] - N[1])}" x2="${r1(p[0] + N[0])}" y2="${r1(p[1] + N[1])}"/>`;
  return `<g class="tr-dimline ${cls}"><line x1="${r1(A[0])}" y1="${r1(A[1])}" x2="${r1(B[0])}" y2="${r1(B[1])}"/>${tick(A)}${tick(B)}<circle cx="${r1(A[0])}" cy="${r1(A[1])}" r="${r1(3 * u)}"/><circle cx="${r1(B[0])}" cy="${r1(B[1])}" r="${r1(3 * u)}"/>${text ? dimLabel(a, b, text, u, 1.6) : ''}</g>`;
}
function hud(msg) {
  const el = $('trHud'); if (!el) return;
  const bits = [];
  if (msg) bits.push(`<span>${esc(msg)}</span>`);
  const s = U.snap;
  if (s && ['poly', 'rect', 'fixture', 'scale', 'check'].includes(U.tool)) {
    const t = { vertex: 'Corner', square: '90°', diagonal: '45°', edge: 'On edge', wall: 'On wall' }[s.kind];
    if (t) bits.push(`<span>${t}${s.aligned ? ' · lined up' : ''}</span>`);
  }
  if (U.tool === 'poly' && U.draft.length) bits.push(`<span>${U.draft.length} corner${U.draft.length === 1 ? '' : 's'}</span>`);
  if (U.cursor && scaled() && !msg) bits.push(`<span>${esc(T.fmtLen(U.cursor[0], U.doc.units))}, ${esc(T.fmtLen(U.cursor[1], U.doc.units))}</span>`);
  el.innerHTML = bits.join('');
}

// ------------------------------------------------------------------ side panel
const opt = (v, t, cur) => `<option value="${esc(v)}"${String(v) === String(cur) ? ' selected' : ''}>${esc(t)}</option>`;
const lenVal = (v) => (Number.isFinite(v) ? T.fmtLen(v, U.doc.units) : '');
function sideUp() { if (!U.sideDown) return; setTimeout(() => { U.sideDown = false; if (U.sidePending) { U.sidePending = false; side(); } }, 0); }
function side() {
  const el = $('trSide'); if (!el) return;
  if (U.sideDown) { U.sidePending = true; return; }
  const active = document.activeElement, keepId = el.contains(active) ? active.id : null, caret = keepId && active.selectionStart != null ? [active.selectionStart, active.selectionEnd] : null;
  const steps = STEPS[U.mode], i = steps.findIndex(([k]) => k === U.step);
  const nav = `<div class="tr-nav">${i > 0 ? `<button class="btn ghost" type="button" data-act="step" data-to="${steps[i - 1][0]}">Back</button>` : '<span></span>'}${i < steps.length - 1 ? `<button class="btn" type="button" data-act="step" data-to="${steps[i + 1][0]}">Next: ${esc(steps[i + 1][1])}</button>` : ''}</div>`;
  el.innerHTML = `${panel()}${U.step !== 'save' ? selPanel() + listPanel() : ''}${nav}`;
  if (keepId) { const n = $(keepId); if (n) { n.focus({ preventScroll: true }); if (caret && n.setSelectionRange) try { n.setSelectionRange(...caret); } catch { /* not a text input */ } } }
}
function panel() {
  const d = U.doc, c = d.cal;
  switch (U.step) {
    case 'image': {
      const draft = store.get(DRAFT_KEY(), null), hasDraft = draft?.doc?.rooms?.length && !d.rooms.length;
      return `<section class="panel"><h3>Plan image</h3>
        <div class="tr-file">
          <button class="btn primary" type="button" data-act="file">${ic('image')}Choose image or PDF</button>
          <p class="tr-note">PNG, JPEG, WebP or one page of a PDF. The file stays in this browser and is never uploaded${U.pdf ? '' : '; reading a PDF loads the open-source pdf.js reader from a CDN'}.</p>
        </div>
        ${U.img ? `<div class="tr-imgmeta"><span class="mono">${esc(U.img.name)}${U.img.page ? ` · page ${U.img.page}` : ''}</span><span class="mono">${U.img.w} × ${U.img.h} px</span></div>
        ${U.pdf && U.pdf.pages > 1 ? `<div class="row tr-pages"><button class="btn sm" type="button" data-act="page" data-d="-1"${U.pdf.page <= 1 ? ' disabled' : ''}>Previous page</button><span class="mono">Page ${U.pdf.page} of ${U.pdf.pages}</span><button class="btn sm" type="button" data-act="page" data-d="1"${U.pdf.page >= U.pdf.pages ? ' disabled' : ''}>Next page</button></div>` : ''}
        <div class="field"><label for="trOpacity">Image strength <b>${Math.round(U.img.opacity * 100)}%</b></label><input type="range" id="trOpacity" min="0.1" max="1" step="0.05" value="${U.img.opacity}" style="--p:${Math.round(((U.img.opacity - 0.1) / 0.9) * 100)}%"></div>` : ''}
        <div class="field"><span class="lbl">Units</span><div class="seg" role="group" aria-label="Units">${[['ft', 'Feet and inches'], ['m', 'Metres']].map(([k, t]) => `<button type="button" data-act="units" data-u="${k}" class="${d.units === k ? 'on' : ''}"${d.rooms.length ? ' disabled' : ''}>${t}</button>`).join('')}</div></div>
      </section>
      ${hasDraft ? `<section class="panel tr-resume"><h3>Unfinished trace</h3><p class="tr-note">${draft.doc.rooms.length} room${draft.doc.rooms.length === 1 ? '' : 's'} from ${esc(new Date(draft.saved).toLocaleString())}. Load the same image again to see it underneath.</p><div class="row"><button class="btn" type="button" data-act="resume">Resume</button><button class="btn ghost" type="button" data-act="discard-draft">Discard</button></div></section>` : ''}
      ${!U.img ? `<section class="panel note"><h3>How tracing works</h3><ol class="tr-howto"><li>Set the scale from one printed dimension and check it with a second.</li><li>Mark north, then click around each room's corners.</li><li>Click walls to add doors and windows, then save. The studio opens it straight away.</li></ol></section>` : ''}`;
    }
    case 'scale': {
      const ready = U.scaleDraft.length === 2 || (c?.anchors && !c.provisional);
      const chk = c?.check, conf = T.confidenceOf(chk?.error_pct);
      return `<section class="panel"><h3>Scale <span>${scaled() ? `${(c.scale).toFixed(1)} px per ${d.units === 'm' ? 'metre' : 'foot'}` : 'not set'}</span></h3>
        <p class="tr-note">${U.scaleDraft.length === 2 ? 'Now type the printed length between the two points.' : U.scaleDraft.length === 1 ? 'Click the other end of the dimension.' : 'Click both ends of the longest printed dimension you can find (an overall width is best).'}</p>
        <div class="row"><div class="field"><label for="trScaleLen">Printed length</label><input type="text" id="trScaleLen" inputmode="decimal" autocomplete="off" placeholder="${d.units === 'm' ? '4.25 m' : '14\'6"'}" value="${esc(c && !c.provisional ? lenVal(c.length) : '')}"></div>
        <button class="btn primary" type="button" data-act="scale"${ready ? '' : ' disabled'}>Set scale</button></div>
      </section>
      <section class="panel"><h3>Check dimension <span>optional</span></h3>
        <p class="tr-note">${U.checkDraft.length === 2 ? 'Type the printed length of this second dimension.' : 'Click both ends of a second printed dimension, ideally at right angles to the first. The disagreement shows how far to trust the trace.'}</p>
        <div class="row"><div class="field"><label for="trCheckLen">Printed length</label><input type="text" id="trCheckLen" inputmode="decimal" autocomplete="off" placeholder="${d.units === 'm' ? '3.60 m' : '12\'0"'}" value="${esc(chk ? lenVal(chk.length) : '')}"${scaled() ? '' : ' disabled'}></div>
        <button class="btn" type="button" data-act="check"${scaled() && (U.checkDraft.length === 2 || chk) ? '' : ' disabled'}>Check</button></div>
        ${chk ? `<div class="metrics tr-metrics"><div class="metric"><div class="k">Measures</div><div class="v">${esc(T.fmtLen(chk.measured, d.units))}</div></div><div class="metric"><div class="k">Printed</div><div class="v">${esc(T.fmtLen(chk.length, d.units))}</div></div><div class="metric"><div class="k">Off by</div><div class="v tr-conf ${conf}">${Math.abs(chk.error_pct).toFixed(1)}<small>%</small></div><div class="s">${{ high: 'High confidence', medium: 'Usable; re-check the anchors', low: 'Re-place the scale anchors' }[conf]}</div></div></div>` : ''}
      </section>`;
    }
    case 'north': {
      const b = d.up_bearing, method = d.bearing?.method || (U.tool === 'facade' ? 'facade' : 'arrow');
      return `<section class="panel"><h3>Orientation</h3>
        <div class="tr-compass">${compassSvg(b)}<div><div class="tr-big">${Number.isFinite(b) ? `${Math.round(b)}° <span>${T.compass16(b)}</span>` : 'Unknown'}</div><p class="tr-note">${Number.isFinite(b) ? `The top of the drawing faces ${Math.round(b)}° (${T.compass16(b)}). Windows get their sun from this.` : 'Sun and window bearings need it. Leave unknown if the plan has no north arrow and you do not know which way the windows face.'}</p></div></div>
        <div class="field"><span class="lbl">From</span><div class="seg" role="group" aria-label="Orientation source">${[['arrow', 'North arrow'], ['facade', 'A facade'], ['typed', 'Type it']].map(([k, t]) => `<button type="button" data-act="nmode" data-m="${k}" class="${(U.nmode || method) === k ? 'on' : ''}">${t}</button>`).join('')}</div></div>
        ${(U.nmode || method) === 'arrow' ? `<p class="tr-note">${U.mode === 'edit' && !U.img ? 'Draw an arrow on the plan pointing the way north lies.' : 'Click the tail, then the tip, of the north arrow printed on the plan.'}</p>` : ''}
        ${(U.nmode || method) === 'facade' ? `<p class="tr-note">${U.facadeWall ? `Selected the outside wall of ${esc(U.facadeWall.left || U.facadeWall.right || 'the unit')}. Which way does it face?` : 'Click an outside wall (for example the main window wall), then choose the direction it faces.'}</p>
          <div class="row"><div class="field"><label for="trFacadeDir">Faces</label><select id="trFacadeDir"${U.facadeWall ? '' : ' disabled'}>${opt('', 'Choose…', '')}${T.COMPASS16.map((n, j) => opt(j * 22.5, `${n} · ${j * 22.5}°`, d.bearing?.method === 'facade' ? d.bearing.faces : '')).join('')}</select></div></div>` : ''}
        ${(U.nmode || method) === 'typed' ? `<div class="row"><div class="field"><label for="trBearing">Top of the drawing faces (degrees)</label><input type="number" id="trBearing" min="0" max="359.9" step="0.5" value="${Number.isFinite(b) ? b : ''}"></div></div>` : ''}
        ${Number.isFinite(b) ? '<button class="btn ghost sm" type="button" data-act="clear-bearing">Clear orientation</button>' : ''}
      </section>`;
    }
    case 'rooms': return `<section class="panel"><h3>Rooms</h3><p class="tr-note">${U.tool === 'rect' ? 'Drag across a rectangular room from corner to corner.' : 'Click each corner of a room. Corners snap to other rooms, to 90° and 45°, and line up with nearby corners; hold Alt for a free point.'} Trace each room on its inside wall face or on the wall centreline; shared edges become one wall.</p></section>`;
    case 'openings': return `<section class="panel"><h3>Doors and windows</h3><p class="tr-note">Click on a wall to place a ${U.tool === 'window' ? `window (${esc(T.fmtLen(T.defaultsFor(d.units).window, d.units))} wide)` : `door (${esc(T.fmtLen(T.defaultsFor(d.units).door, d.units))} wide)`}. Select it to set the width${U.tool === 'window' ? ', sill and head' : ', hinge side and which room it opens into'}; drag it along the wall to move it.</p></section>`;
    case 'fixtures': return `<section class="panel"><h3>Fixtures</h3><div class="field"><label for="trFixKind">Next fixture</label><select id="trFixKind">${FIXTURE_KINDS.map((k) => opt(k, FIX_NAMES[k] || k, U.fixKind)).join('')}</select></div><p class="tr-note">Drag to draw it. Closets and AC units keep clear space in front (24 in and 18 in); AC sizes are marked estimated unless you measured them.</p></section>`;
    case 'details': return detailsPanel();
    case 'save': return savePanel();
    default: return '';
  }
}
function detailsPanel() {
  const d = U.doc, listings = (S.listings || []).filter((L) => L.id).slice(0, 400);
  return `<section class="panel"><h3>${U.mode === 'edit' ? 'Ceiling and walls' : 'Plan details'}</h3>
    <div class="row"><div class="field"><label for="trCeiling">Ceiling height</label><input type="text" id="trCeiling" value="${esc(lenVal(d.ceiling))}" autocomplete="off"></div>
    <div class="field"><label for="trWall">Wall thickness</label><input type="text" id="trWall" value="${esc(lenVal(d.wall))}" autocomplete="off"></div></div>
    <div class="row"><div class="field"><label for="trFloor">Floor (storey)</label><input type="number" id="trFloor" min="-10" max="200" step="1" value="${Number.isInteger(d.floor) ? d.floor : ''}"></div>
    <div class="field"><label for="trMatch">Plan matches the unit as</label><select id="trMatch">${opt('', 'Not stated', d.match)}${Object.entries(MATCH_NAMES).map(([k, t]) => opt(k, t, d.match)).join('')}</select></div></div>
  </section>
  <section class="panel"><h3>${U.mode === 'edit' ? 'Local version' : 'Name and listing'}</h3>
    ${U.mode === 'edit' ? `<div class="field"><label for="trLabel">Label for this version</label><input type="text" id="trLabel" maxlength="60" value="${esc(d.label)}" autocomplete="off"></div>` : ''}
    <div class="field"><label for="trTitleIn">Title</label><input type="text" id="trTitleIn" maxlength="80" value="${esc(d.title)}" autocomplete="off"></div>
    <div class="row"><div class="field"><label for="trListing">For listing</label><select id="trListing">${opt('', 'No listing (its own plan)', '')}${listings.map((L) => opt(L.id, listingLabel(L), d.id)).join('')}</select></div></div>
    <div class="field"><label for="trId">Plan id <span>letters, digits, - and _</span></label><input type="text" id="trId" maxlength="80" value="${esc(d.id)}" autocomplete="off" spellcheck="false"></div>
    <p class="tr-note">${U.mode === 'edit' && U.origin && d.id === U.origin.id ? 'Saving keeps this id, so the studio shows your version of this plan (marked “local project”) until you remove it with Layout ▸ Remove local project override.' : 'Use a listing’s id so the studio and Unit 3D attach this plan to that unit. Agents can also save the downloaded file as plans/&lt;id&gt;.json.'}</p>
    <div class="field"><label for="trNote">Source note <span>optional</span></label><textarea id="trNote" rows="2" maxlength="200" placeholder="Where the image came from, what was unclear">${esc(d.note)}</textarea></div>
  </section>`;
}
function savePanel() {
  const d = U.doc, issues = T.reviewDoc(d), errors = issues.filter((x) => x.level === 'error');
  let plan = null; try { plan = T.toPlanJSON(d); } catch { plan = null; }
  const tr = plan?.provenance?.trace || {}, area = d.rooms.reduce((s, r) => s + T.roomArea(r.poly), 0);
  const prov = [
    ['Traced by', U.mode === 'edit' ? 'You, editing an existing plan' : 'You, in the plan tracer'],
    ...(tr.image ? [['Source image', `${tr.image}${tr.page ? ` · page ${tr.page}` : ''}`]] : []),
    ...(d.cal && !d.cal.provisional ? [['Scale', `${T.fmtLen(d.cal.length, d.units)} between two anchors · ${d.cal.scale.toFixed(1)} px/${d.units}`]] : []),
    ...(d.cal?.check ? [['Check', `${Math.abs(d.cal.check.error_pct).toFixed(1)}% off · ${T.confidenceOf(d.cal.check.error_pct)} confidence`]] : U.mode === 'trace' ? [['Check', 'none (unchecked)']] : []),
    ['Orientation', Number.isFinite(d.up_bearing) ? `top faces ${Math.round(d.up_bearing)}° ${T.compass16(d.up_bearing)}${d.bearing?.method ? ` (${d.bearing.method === 'arrow' ? 'north arrow' : d.bearing.method === 'facade' ? 'facade bearing' : 'typed'})` : ''}` : 'unknown'],
    ...(U.mode === 'edit' ? [['Changes', d.changes.length ? d.changes.slice(-4).join(' · ') : 'none yet']] : []),
  ];
  return `<section class="panel"><h3>Review</h3>
    <div class="metrics"><div class="metric"><div class="k">Area</div><div class="v">${esc(T.fmtArea(area, d.units))}</div></div><div class="metric"><div class="k">Rooms</div><div class="v">${d.rooms.length}</div></div><div class="metric"><div class="k">Doors · windows</div><div class="v">${d.doors.length} · ${d.windows.length}</div></div></div>
    ${issues.length ? `<ul class="tr-issues">${issues.map((x) => `<li class="${x.level}"><span class="pill ${x.level === 'error' ? 'bad' : x.level === 'warn' ? 'warn' : ''}">${x.level === 'error' ? 'Fix' : x.level === 'warn' ? 'Check' : 'Note'}</span>${esc(x.text)}</li>`).join('')}</ul>` : '<p class="tr-note">No problems found.</p>'}
  </section>
  <section class="panel"><h3>Provenance <span>written into the plan</span></h3><dl class="tr-prov">${prov.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl><p class="tr-note">${esc(plan?.source || '')}</p></section>
  <section class="panel tr-actions"><h3>Save</h3>
    <button class="btn primary" type="button" data-act="save-studio"${errors.length ? ' disabled' : ''}>Save and open in the studio</button>
    <button class="btn" type="button" data-act="download"${errors.length ? ' disabled' : ''}>${ic('down')}Download plan JSON<span class="mono">${esc(d.id)}.json</span></button>
    <button class="btn" type="button" data-act="unit3d"${errors.length ? ' disabled' : ''}>${ic('cube')}Use this plan in Unit 3D</button>
    <p class="tr-note">Everything is saved in this browser only. The downloaded file is plan JSON v2; an agent can save it as <span class="mono">plans/${esc(d.id)}.json</span> in the search folder.</p>
  </section>`;
}
function selPanel() {
  const s = findSel(U.sel); if (!s) return '';
  const d = U.doc, del = `<button class="btn ghost sm tr-del" type="button" data-act="delete">${ic('trash')}Delete</button>`;
  if (U.sel.type === 'room') {
    return `<section class="panel tr-selp"><h3>Room <span>${esc(T.fmtArea(T.roomArea(s.poly), d.units))} · ${s.poly.length} corners</span></h3>
      <div class="field"><label for="trRoomName">Name</label><input type="text" id="trRoomName" maxlength="60" value="${esc(s.name)}" autocomplete="off"></div>
      <div class="tr-kinds" role="group" aria-label="Room kind">${ROOM_KINDS.map((k) => `<button type="button" class="chip${s.kind === k ? ' on' : ''}" data-act="kind" data-kind="${k}">${esc(KIND_NAMES[k] === 'Room' ? 'Other' : KIND_NAMES[k])}</button>`).join('')}</div>
      <div class="row"><div class="field"><label for="trStated">Printed size <span>optional</span></label><input type="text" id="trStated" maxlength="60" value="${esc(s.stated || '')}" placeholder="14'0&quot; x 12'0&quot;" autocomplete="off"></div></div>
      <label class="tr-check"><input type="checkbox" id="trEst"${s.est ? ' checked' : ''}> Size or position is a guess</label>
      <div class="tr-selfoot"><span class="tr-note">Drag a corner to move it; drag an edge dot to add one. Select again and drag to move the room.</span>${del}</div></section>`;
  }
  if (U.sel.type === 'door') {
    const sides = T.sidesOf(s, d.rooms), cur = ['slide', 'pocket', 'none'].includes(s.swing) ? s.swing : s.swing == null ? 'unknown' : String(T.swingSide(s, d.rooms));
    const width = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]);
    return `<section class="panel tr-selp"><h3>Door <span>${esc(T.fmtLen(width, d.units))}</span></h3>
      <div class="row"><div class="field"><label for="trOpenW">Width</label><input type="text" id="trOpenW" value="${esc(lenVal(width))}" autocomplete="off"></div>
      <div class="field"><span class="lbl">Hinge</span><div class="seg" role="group" aria-label="Hinge end">${[['a', 'End A'], ['b', 'End B']].map(([k, t]) => `<button type="button" data-act="hinge" data-h="${k}" class="${(s.hinge || 'a') === k ? 'on' : ''}">${t}</button>`).join('')}</div></div></div>
      <div class="field"><label for="trSwing">Opens into</label><select id="trSwing">${opt('1', sides.left || 'Outside the unit', cur)}${opt('-1', sides.right || 'Outside the unit', cur)}${opt('slide', 'Sliding door', cur)}${opt('pocket', 'Pocket door', cur)}${opt('none', 'Opening with no door', cur)}${opt('unknown', 'Not drawn (keep both sides clear)', cur)}</select></div>
      <div class="row"><div class="field"><label for="trDoorName">Name <span>optional</span></label><input type="text" id="trDoorName" maxlength="60" value="${esc(s.name || '')}" placeholder="bedroom door" autocomplete="off"></div></div>
      <label class="tr-check"><input type="checkbox" id="trEntry"${s.kind === 'entry' ? ' checked' : ''}> Front door (the studio's “From door” camera)</label>
      <div class="tr-selfoot"><span class="tr-note">Drag the door along its wall to move it.</span>${del}</div></section>`;
  }
  if (U.sel.type === 'window') {
    const width = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]);
    return `<section class="panel tr-selp"><h3>Window <span>${esc(T.fmtLen(width, d.units))}${s.room ? ` · ${esc(s.room)}` : ''}</span></h3>
      <div class="row"><div class="field"><label for="trOpenW">Width</label><input type="text" id="trOpenW" value="${esc(lenVal(width))}" autocomplete="off"></div>
      <div class="field"><label for="trSill">Sill</label><input type="text" id="trSill" value="${esc(lenVal(s.sill))}" autocomplete="off"></div>
      <div class="field"><label for="trHead">Head</label><input type="text" id="trHead" value="${esc(lenVal(s.head))}" autocomplete="off"></div></div>
      <div class="tr-selfoot"><span class="tr-note">Heights from the floor. Drag the window along its wall to move it.</span>${del}</div></section>`;
  }
  if (U.sel.type === 'fixture') {
    const rect = !s.poly;
    return `<section class="panel tr-selp"><h3>Fixture <span>${esc(FIX_NAMES[s.kind] || s.kind)}</span></h3>
      <div class="row"><div class="field"><label for="trFxKind">Kind</label><select id="trFxKind">${FIXTURE_KINDS.map((k) => opt(k, FIX_NAMES[k] || k, s.kind)).join('')}</select></div>
      <div class="field"><label for="trFxLabel">Label <span>optional</span></label><input type="text" id="trFxLabel" maxlength="60" value="${esc(s.label || '')}" autocomplete="off"></div></div>
      ${rect ? `<div class="row"><div class="field"><label for="trFxW">Width (across)</label><input type="text" id="trFxW" value="${esc(lenVal(s.w))}" autocomplete="off"></div><div class="field"><label for="trFxH">Depth (up the plan)</label><input type="text" id="trFxH" value="${esc(lenVal(s.h))}" autocomplete="off"></div></div>` : ''}
      <div class="row"><div class="field"><label for="trFxHeight">Height <span>blank: default</span></label><input type="text" id="trFxHeight" value="${esc(lenVal(s.height))}" autocomplete="off"></div>
      <div class="field"><label for="trFxReserve">Clear in front <span>blank: default</span></label><input type="text" id="trFxReserve" value="${esc(lenVal(s.reserve))}" autocomplete="off"></div></div>
      ${['closet', 'wardrobe'].includes(s.kind) ? `<div class="field"><label for="trFxDoors">Doors</label><select id="trFxDoors">${opt('', 'Not shown', s.doors || '')}${[['hinged', 'Hinged'], ['bifold', 'Bi-fold'], ['sliding', 'Sliding'], ['none', 'None (open)']].map(([k, t]) => opt(k, t, s.doors || '')).join('')}</select></div>` : ''}
      <label class="tr-check"><input type="checkbox" id="trFxEst"${s.est ? ' checked' : ''}> Size or position is a guess</label>
      <div class="tr-selfoot"><span class="tr-note">Select again and drag to move it.</span>${del}</div></section>`;
  }
  return '';
}
function listPanel() {
  const d = U.doc; if (!d.rooms.length) return '';
  const total = d.rooms.reduce((s, r) => s + T.roomArea(r.poly), 0);
  return `<section class="panel tr-list"><h3>Rooms <span>${esc(T.fmtArea(total, d.units))} total</span></h3><table class="mini"><tbody>${d.rooms.map((r) => `<tr class="${U.sel?.type === 'room' && U.sel.id === r.id ? 'on' : ''}" data-act="pick" data-id="${esc(r.id)}"><td><button type="button" class="tr-link" data-act="pick" data-id="${esc(r.id)}">${esc(r.name)}</button>${r.est ? ' <span class="pill warn">est</span>' : ''}</td><td class="k">${esc(KIND_NAMES[r.kind] === 'Room' ? 'other' : r.kind)}</td><td class="n">${esc(T.fmtArea(T.roomArea(r.poly), d.units))}</td></tr>`).join('')}</tbody></table>
    ${d.doors.length + d.windows.length + d.fixtures.length ? `<p class="tr-note">${d.doors.length} door${d.doors.length === 1 ? '' : 's'} · ${d.windows.length} window${d.windows.length === 1 ? '' : 's'} · ${d.fixtures.length} fixture${d.fixtures.length === 1 ? '' : 's'}</p>` : ''}</section>`;
}
function compassSvg(b) {
  const ok = Number.isFinite(b), rot = ok ? -b : 0; // north relative to the drawing's top
  return `<svg class="tr-rose" viewBox="-30 -30 60 60" aria-hidden="true"><circle r="27" class="ring"/>${[0, 90, 180, 270].map((a) => `<line class="tk" x1="0" y1="-27" x2="0" y2="-22" transform="rotate(${a})"/>`).join('')}<g transform="rotate(${rot})">${ok ? '<path class="n" d="M0 -21L5 4L0 0L-5 4z"/><text y="-12.5" class="nl" transform="translate(0 -11)">N</text>' : '<text class="q" y="5">?</text>'}</g><text class="up" y="-24.5" x="0">top</text></svg>`;
}

// ------------------------------------------------------------------ side panel events
async function sideClick(e) {
  const b = e.target.closest('[data-act]'); if (!b || b.disabled) return;
  const a = b.dataset.act, d = U.doc, s = findSel(U.sel);
  if (a === 'step') goStep(b.dataset.to);
  else if (a === 'file') $('trFile').click();
  else if (a === 'page' && U.pdf) await renderPdfPage(Math.max(1, Math.min(U.pdf.pages, U.pdf.page + +b.dataset.d)));
  else if (a === 'units' && !d.rooms.length) { convertUnits(b.dataset.u); commit('Units'); }
  else if (a === 'resume') { const dr = store.get(DRAFT_KEY(), null); if (dr?.doc) { U.doc = { ...dr.doc, mode: 'trace' }; U.k = UNIT_IN[U.doc.units]; commit('Resume draft'); fit(); render(); toast('Draft restored. Load the same image to see it underneath.', 3600); } }
  else if (a === 'discard-draft') { store.set(DRAFT_KEY(), null); render(); }
  else if (a === 'scale') applyScale();
  else if (a === 'check') applyCheck();
  else if (a === 'nmode') { U.nmode = b.dataset.m; if (U.nmode === 'arrow') setTool('arrow'); else if (U.nmode === 'facade') setTool('facade'); else setTool('select'); }
  else if (a === 'clear-bearing') { d.up_bearing = null; d.bearing = null; U.arrowDraft = []; U.facadeWall = null; commit('Clear orientation', 'Orientation cleared'); }
  else if (a === 'kind' && s) { const old = s.kind; s.kind = b.dataset.kind; if (/^Room \d+$/.test(s.name) || s.name === KIND_NAMES[old]) s.name = uniqueName(KIND_NAMES[s.kind], s.id); commit('Room kind', `${s.name}: ${s.kind}`); }
  else if (a === 'hinge' && s) { s.hinge = b.dataset.h; commit('Door hinge', `${s.name || 'Door'}: hinge at end ${s.hinge.toUpperCase()}`); }
  else if (a === 'delete') deleteSel();
  else if (a === 'pick') { U.sel = { type: 'room', id: b.dataset.id }; setTool('select', true); render(); }
  else if (a === 'download') download();
  else if (a === 'save-studio') saveToStudio();
  else if (a === 'unit3d') toUnit3D();
}
function uniqueName(base, id) {
  const used = new Set(U.doc.rooms.filter((r) => r.id !== id).map((r) => r.name));
  if (!used.has(base)) return base;
  for (let n = 2; n < 50; n++) if (!used.has(`${base} ${n}`)) return `${base} ${n}`;
  return base;
}
function convertUnits(to) {
  const d = U.doc, f = UNIT_IN[d.units] / UNIT_IN[to], def = T.defaultsFor(to);
  d.units = to; d.ceiling = +def.ceiling.toFixed(3); d.wall = +def.wall.toFixed(3); U.k = UNIT_IN[to];
  if (d.cal) {
    d.cal = { ...d.cal, scale: d.cal.scale / f, ...(d.cal.length ? { length: d.cal.length * f } : {}) };
    if (d.cal.check) d.cal.check = { ...d.cal.check, length: d.cal.check.length * f, measured: d.cal.check.measured * f };
  }
}
function sideInput(e) {
  const t = e.target, s = findSel(U.sel);
  if (t.id === 'trOpacity' && U.img) { U.img.opacity = +t.value; t.style.setProperty('--p', `${Math.round(((+t.value - 0.1) / 0.9) * 100)}%`); drawImage(); const lb = t.closest('.field')?.querySelector('b'); if (lb) lb.textContent = `${Math.round(+t.value * 100)}%`; }
  else if (t.id === 'trRoomName' && s) { s.name = T.plainText(t.value, 60) || s.name; drawStatic(); }
}
function sideChange(e) {
  const t = e.target, d = U.doc, s = findSel(U.sel), L = (v) => T.parseLength(v, d.units);
  const bad = (msg) => { toast(msg); render(); };
  switch (t.id) {
    case 'trRoomName': if (s) { s.name = T.plainText(t.value, 60) || 'Room'; commit('Rename room', `Room renamed ${s.name}`); } break;
    case 'trStated': if (s) { s.stated = T.plainText(t.value, 60); commit('Printed size'); } break;
    case 'trEst': if (s) { s.est = t.checked; commit('Estimate flag'); } break;
    case 'trOpenW': if (s) {
      const w = L(t.value); if (!w) return bad('Type a width such as 2\'8" or 0.8 m.');
      const wall = T.nearestWall([(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2], walls(), d.wall * 2 + 0.01);
      const next = wall ? T.placeOpening(wall.wall, [(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2], w) : T.resizeOpening(s, w);
      const flip = wall && ((next.b[0] - next.a[0]) * (s.b[0] - s.a[0]) + (next.b[1] - next.a[1]) * (s.b[1] - s.a[1]) < 0);
      s.a = flip ? next.b : next.a; s.b = flip ? next.a : next.b;
      commit(`${U.sel.type === 'door' ? 'Door' : 'Window'} width`, `${s.name || (U.sel.type === 'door' ? 'Door' : 'Window')} width ${T.fmtLen(w, d.units)}`);
    } break;
    case 'trSwing': if (s) {
      const v = t.value;
      if (['slide', 'pocket', 'none'].includes(v)) { s.swing = v; delete s.room; }
      else if (v === 'unknown') { delete s.swing; delete s.room; }
      else Object.assign(s, T.swingInto(s, +v, d.rooms));
      if (s.swing == null) delete s.swing;
      commit('Door swing', `${s.name || 'Door'} swing: ${t.selectedOptions[0]?.textContent || v}`);
    } break;
    case 'trDoorName': if (s) { s.name = T.plainText(t.value, 60); commit('Door name'); } break;
    case 'trEntry': if (s) { s.kind = t.checked ? 'entry' : ''; commit('Front door'); } break;
    case 'trSill': case 'trHead': if (s) {
      const v = L(t.value); if (!v && v !== 0) return bad('Type a height such as 2\'0" or 0.6 m.');
      const next = { ...s, [t.id === 'trSill' ? 'sill' : 'head']: v };
      if (next.head <= next.sill) return bad('The window head must be above the sill.');
      if (next.head > d.ceiling) return bad('The window head is above the ceiling.');
      Object.assign(s, next); commit('Window height', `Window ${t.id === 'trSill' ? 'sill' : 'head'} ${T.fmtLen(v, d.units)}`);
    } break;
    case 'trFixKind': U.fixKind = t.value; break;
    case 'trFxKind': if (s) { s.kind = t.value; if (['ac', 'ptac'].includes(s.kind) && s.est == null) s.est = true; commit('Fixture kind'); } break;
    case 'trFxLabel': if (s) { s.label = T.plainText(t.value, 60); commit('Fixture label'); } break;
    case 'trFxW': case 'trFxH': if (s) { const v = L(t.value); if (!v) return bad('Type a size such as 2\'0".'); s[t.id === 'trFxW' ? 'w' : 'h'] = v; commit('Fixture size', `${s.label || FIX_NAMES[s.kind]} resized`); } break;
    case 'trFxHeight': case 'trFxReserve': if (s) {
      const key = t.id === 'trFxHeight' ? 'height' : 'reserve';
      if (!t.value.trim()) delete s[key]; else { const v = /^0+(\.0*)?$/.test(t.value.trim()) ? 0 : L(t.value); if (v == null) return bad('Type a length, or leave it blank for the default.'); s[key] = v; }
      commit(`Fixture ${key}`);
    } break;
    case 'trFxDoors': if (s) { if (t.value) s.doors = t.value; else delete s.doors; commit('Closet doors'); } break;
    case 'trFxEst': if (s) { s.est = t.checked; commit('Estimate flag'); } break;
    case 'trCeiling': { const v = L(t.value); if (!v || v * UNIT_IN[d.units] < 72 || v * UNIT_IN[d.units] > 300) return bad('Type a ceiling height between 6 and 25 ft.'); if (d.windows.some((w) => w.head > v)) return bad('A window head would be above that ceiling.'); d.ceiling = v; commit('Ceiling', `Ceiling ${T.fmtLen(v, d.units)}`); break; }
    case 'trWall': { const v = L(t.value); if (!v || v * UNIT_IN[d.units] > 36) return bad('Type a wall thickness up to 3 ft.'); d.wall = v; commit('Wall thickness', `Walls ${T.fmtLen(v, d.units)} thick`); break; }
    case 'trFloor': { const v = t.value === '' ? null : Math.round(+t.value); d.floor = Number.isInteger(v) && v >= -10 && v <= 200 ? v : null; commit('Floor'); break; }
    case 'trMatch': d.match = t.value; commit('Plan match'); break;
    case 'trLabel': d.label = T.plainText(t.value, 60); commit('Label'); break;
    case 'trTitleIn': d.title = T.plainText(t.value, 80) || d.title; commit('Title'); break;
    case 'trListing': if (t.value) { d.id = t.value; const L0 = byId(t.value); if (L0 && (d.title === 'Traced plan' || !d.title)) d.title = T.plainText(listingLabel(L0), 80); if (L0?.floor && !Number.isInteger(d.floor)) d.floor = Number.isInteger(+L0.floor) ? +L0.floor : d.floor; commit('Listing'); } break;
    case 'trId': d.id = T.slugId(t.value, d.id); commit('Plan id'); break;
    case 'trNote': d.note = T.plainText(t.value, 200); commit('Note'); break;
    case 'trFacadeDir': if (t.value !== '') setFacade(+t.value); break;
    case 'trBearing': { const v = +t.value; if (t.value === '' || !Number.isFinite(v)) return; d.up_bearing = T.norm360(v); d.bearing = { method: 'typed' }; commit('Bearing', `Orientation typed: top faces ${d.up_bearing}°`); break; }
    default: break;
  }
}

// ------------------------------------------------------------------ export
function buildPlan() {
  const issues = T.reviewDoc(U.doc).filter((x) => x.level === 'error');
  if (issues.length) { toast(issues[0].text, 4200); return null; }
  try { return T.toPlanJSON(U.doc); } catch (e) { toast(`Could not build the plan: ${e.message || e}`, 4200); return null; }
}
function buildProject(plan) {
  const sameAsOrigin = U.origin && plan.id === U.origin.id;
  const items = sameAsOrigin ? U.origin.items : [];
  return serialiseProject(plan, items, sameAsOrigin ? U.origin.lighting : { directSun: true, ambient: 1 });
}
function download() {
  const plan = buildPlan(); if (!plan) return;
  try { serialiseProject(plan, []); } catch (e) { toast(`The plan did not pass validation: ${e.message || e}`, 5200); return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(plan, null, 2)], { type: 'application/json' }));
  a.download = `${plan.id}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast(`Downloaded ${plan.id}.json`);
}
async function saveToStudio() {
  const plan = buildPlan(); if (!plan) return;
  let project;
  try { project = buildProject(plan); } catch (e) { toast(`The plan did not pass validation: ${e.message || e}`, 5200); return; }
  const lib = library();
  if (!lib[plan.id] && Object.keys(lib).length >= 20) { toast('The browser keeps up to 20 local plans. Remove one in the studio first.', 5200); return; }
  const input = $('psProjectFile');
  U.saved = true;
  if (U.mode === 'trace') store.set(DRAFT_KEY(), null);
  // Hand the project to the studio's own importer: it validates, stores and opens it in place.
  try {
    if (!input) throw new Error('studio not ready');
    const dt = new DataTransfer();
    dt.items.add(new File([JSON.stringify(project)], `${plan.id}-project.json`, { type: 'application/json' }));
    input.files = dt.files;
    closeTracer(true);
    input.dispatchEvent(new Event('change', { bubbles: true }));
    // the studio does not re-sync its plan selector when the hash is already #plan/<id>
    for (const ms of [400, 1200, 2600]) setTimeout(() => { const sel = $('planSel'); if (sel && [...sel.options].some((o) => o.value === plan.id) && location.hash === `#plan/${encodeURIComponent(plan.id)}`) sel.value = plan.id; }, ms);
  } catch {
    store.set(`plan-projects.${S.base}`, { ...lib, [plan.id]: project });
    store.set(`plan.${S.base}.${plan.id}`, project.layout);
    closeTracer(true);
    location.hash = `#plan/${encodeURIComponent(plan.id)}`;
    location.reload();
  }
}
function toUnit3D() {
  const plan = buildPlan(); if (!plan) return;
  try {
    const project = buildProject(plan);
    savePlanScenario({ project, base: S.base, label: U.mode === 'edit' ? U.doc.label || 'Edited plan' : U.doc.title || 'Traced plan', from: U.mode === 'edit' ? 'edit' : 'tracer' });
    toast(byId(plan.id) ? 'Saved for Unit 3D: this unit’s Inside view can use the plan.' : `Saved as plan scenario “${plan.id}”. Pick a listing in Details so Unit 3D can find it.`, 5200);
  } catch (e) { toast(`Could not save the scenario: ${e.message || e}`, 5200); }
}

// Exposed for tests and the console: the live document (a copy).
export const tracerState = () => (U.open ? JSON.parse(JSON.stringify({ mode: U.mode, step: U.step, tool: U.tool, doc: U.doc })) : null);
