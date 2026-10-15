// Floor plan studio: one view to lay out furniture on a listing's plan and check it fits.
// A synced 2D plan and 3D model (drag in either), a furniture catalogue with real sizes, fit checks
// graded clear / tight / blocked (overlaps, door swings, clearance zones, TV viewing distance, headboard
// and TV-wall rules), eye-level cameras and a walk mode, wall cut modes, layout presets written by
// agents, layout save/load, GLB and PNG export, and the real sun through the windows (switched off
// when the site model says neighbouring buildings block it).
// Interior pass: real products with a bed finder and a shopping list (Shop tab), walking routes from the
// front door with a delivery check and a guided eye-level walk (Checks tab), storage beds, rugs, wall art,
// lamps, radiators and window AC units, Day / Evening / Night lighting with lamp light and window sky glow,
// room dimension strings, a layout option sheet, a suggested layout for plans without presets, 3D side-by-
// side plan compare, and 2x / 4K snapshots.
//
// Modules: plan/model.js (plan JSON v1/v2 normaliser), plan/catalog.js (furniture sizes and clearances),
// plan/checks.js (pure fit rules), plan/layout.js (layout file validation), plan/scene3d.js (three.js),
// plan/plan2d.js (SVG plan), plan/route.js (access routes), plan/products.js + plan/shop.js (products, bed
// finder), plan/suggest.js (suggested layout), plan/options.js (option sheet), plan/compare3d.js (3D compare).
// All lengths are inches internally.
import { S, on, byId, label, loadJSON, store } from './app.js';
import { $, esc, toast, safeUrl } from './util.js';
import { DEG, sunPos, zonedMs, angDiff, fmtT, prepBuildings, horizonProfile, hAt, facesOf, snapOpen, compass, skyView, SUNSHINE, dayTable, litInfo } from './sun.js';
import { normalisePlan, fmtIn, pointInPoly } from './plan/model.js';
import { CATALOG, CATEGORIES, CLEARANCE, TV_FOV, resolve } from './plan/catalog.js';
import { evaluate, gapRays, findSpot, roomOf, axes, toWorld, swingPoly, FIX_NAMES } from './plan/checks.js';
import { parseLayout, validateLayout, serialiseLayout, asPreset, newId, MAX_BYTES } from './plan/layout.js';
import * as G3 from './plan/scene3d.js';
import * as P2 from './plan/plan2d.js';
import { renderCompare, cancelCompare } from './plan/compare.js';
import { lightState, windowReach, glazingScale, roomDaylight, clampGlazing, blindsOf, BLINDS_LABEL, GLAZING_DEFAULT } from './plan/light.js';
import { parseProject, serialiseProject } from './plan/project.js';
import { editFixture, editWindow, editOrientation } from './plan/architecture.js';
import { canonicalFaces, snapPosition } from './unit/scenario.js';
import { placePlan, windowSkylines, windowBlocked, windowMinutes, windowWithheld } from './plan/city.js';
import { effectiveComponents } from './unit/parts.js';   // [model project] source parts + the assumed override, same as Unit 3D
import { resolveCal, geoFromSite, measuredFromSite } from './unit/calibration.js';   // [model project] measured vs estimated height
import { getPin, pinOption } from './unit/anchor.js';   // [model project] the window pinned in Unit 3D
import { facingSummary } from './plan/facing.js';   // [model project] host facade bearing, bays as a range
import { anchorNoteHTML } from './plan/anchor-note.js';   // [model project] where the plan sits, source vs assumed
import { cityGroup } from './plan/citymesh.js';
import { sunGroupHTML, stripAt, setHandoff } from './room3d/sunlink.js';   // [room3d] sun today in the studio's eye-level views, and the way into Unit 3D
import { accuracyRows, accuracyChip, loadFurnitureMeta } from './room3d/accuracy.js';   // [room3d] the measured-vs-assumed chip, shared with Unit 3D
import { accessRoutes, entryPoint } from './plan/route.js';
import { PRODUCT_MAP, productsFor, shoppingList, shoppingCSV, CHECKED } from './plan/products.js';
import { productFinder, withProduct } from './plan/shop.js';
import { suggestLayout } from './plan/suggest.js';
import { planEmpty, missingNotice } from './features/plan-empty.js';   // [feature C] empty state and missing-plan notice
import { renderOptions } from './plan/options.js';
import * as Q3 from './plan/quality3d.js';   // [feature J] render quality (Fast / Visual) and progressive export
import * as LX from './plan/lighting-ui.js';   // [feature J] daylight grid, glass/surface inputs, luminaires, annual summary
import { validateInventory, fitInventory, pieceItem, placedIds } from './plan/inventory.js';   // [furniture] the renter's own pieces
import { inventoryHTML } from './plan/inventory-ui.js';
import { allViews, stepView, windowGroups } from './plan/viewpoints.js';   // [interior] where to stand to look out of the windows
import { setLookChips, bindLookChips } from './plan/look-ui.js';

const st = {
  id: null, date: '', min: 720, playing: false, site: null, mode: 'both', view: 'bird', wall: 'cut', tab: 'furniture',
  snap: true, zonesAll: false, sight: true, swings: false,
  directSun: true, ambient: 1, glazing: 0.6, blinds: 'open',
  dims: 'sel', routes: false, routeKey: null, mood: 'auto', finder: null,
};
const held = new Set();
let routesRes = null, routeT = 0, lastFrame = 0;
// onSite: the plan placed on its site; winSky: one skyline per plan window (per-window city occlusion)
let onSite = null, winSky = null, winMin = null, winMinKey = '';
let winSkyView = null;
let inventory = null;   // [furniture] "Your furniture": the renter's pieces (furniture.json, or the ones a project carried)
let model = null, rawPlan = null, projectLibrary = Object.create(null), siteProf = null, items = [], R = [], ev = null, sel = null, flash = null, flashT = 0, loop = false, ready = false;
const undo = [], redo = [];
const isPhone = () => matchMedia('(max-width: 760px)').matches;
const key = (id) => `plan.${S.base}.${id}`;
const libraryKey = () => `plan-projects.${S.base}`;
function saveProjectLibrary(next) {
  const text=JSON.stringify(next);
  if(new TextEncoder().encode(text).length>3*1024*1024)throw Error('Local plan library is full. Export and remove a project first.');
  localStorage.setItem('as:'+libraryKey(),text);
  projectLibrary=next;
}
const planIds = () => [...new Set([...(S.manifest.plans || []), ...Object.keys(projectLibrary)])];
function planOptions() {
  $('planSel').innerHTML = planIds().map(id=>`<option value="${esc(id)}">${esc(projectLibrary[id]?.plan.title || (byId(id) ? label(byId(id)) : id))}${projectLibrary[id] ? ' · local project' : ''}</option>`).join('') || '<option>No floor plans yet</option>';
}
const IC = {
  undo: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M5.5 3.5L2.5 6.5l3 3"/><path d="M2.8 6.5H10a3.5 3.5 0 010 7H7"/></svg>',
  redo: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M10.5 3.5l3 3-3 3"/><path d="M13.2 6.5H6a3.5 3.5 0 000 7h3"/></svg>',
  rot: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M13 8a5 5 0 11-1.6-3.7"/><path d="M13 2.5v3h-3"/></svg>',
  dup: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="5" y="5" width="8.5" height="8.5" rx="1.5"/><path d="M3 10.5V3.8C3 3.3 3.3 3 3.8 3h6.7"/></svg>',
  del: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.7 9h5.6l.7-9"/></svg>',
  eye: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/></svg>',
  eyeOff: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M2 2l12 12M6.6 3.7A6.6 6.6 0 018 3.5c4.1 0 6.5 4.5 6.5 4.5a11 11 0 01-1.8 2.3M4.2 5A11 11 0 001.5 8s2.4 4.5 6.5 4.5c.9 0 1.7-.2 2.4-.5"/></svg>',
  place: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M8 14s4.5-4.2 4.5-7.5a4.5 4.5 0 00-9 0C3.5 9.8 8 14 8 14z"/><circle cx="8" cy="6.5" r="1.6"/></svg>',
  down: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M8 2.5v8M4.5 7l3.5 3.5L11.5 7M3 13.5h10"/></svg>',
  up: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M8 11V3M4.5 6.5L8 3l3.5 3.5M3 13.5h10"/></svg>',
  more: '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><circle cx="3.5" cy="8" r="1.3"/><circle cx="8" cy="8" r="1.3"/><circle cx="12.5" cy="8" r="1.3"/></svg>',
  x: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
  plus: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M8 3v10M3 8h10"/></svg>',
  play: '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M5 3.2v9.6L12.8 8z"/></svg>',
  pause: '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="4" y="3" width="2.8" height="10" rx=".8"/><rect x="9.2" y="3" width="2.8" height="10" rx=".8"/></svg>',
};
const GRADE_TXT = { clear: 'Clear', tight: 'Tight', blocked: 'Blocked' };
const PILL = { clear: 'good', tight: 'warn', blocked: 'bad' };

// ------------------------------------------------------------------ view contract
export function init() {
  window.__plan3d = { get views() { return viewsNow(); }, get cam() { return G3.getCamera(); }, get eye() { return G3.viewMode(); }, get hasCity() { return G3.hasCity(); }, get view() { return st.view; }, get items() { return items; }, get inventory() { return inventory; } };   // [interior] test and debugging handle, like __unit3d
  $('view-plan').innerHTML = `<div class="view-pad ps">
    <header class="page-h ps-head">
      <div class="t"><h1 id="psTitle">Floor plan</h1><p id="psSub">Lay out your furniture at true size and check it fits.</p></div>
      <div class="actions">
        <select id="planSel" aria-label="Floor plan"></select>
        <div class="seg" id="psMode" role="group" aria-label="Panes">${[['both', 'Both'], ['2d', '2D'], ['3d', '3D']].map(([k, t]) => `<button type="button" data-m="${k}">${t}</button>`).join('')}</div>
        <button class="icon-btn" type="button" id="psUndo" title="Undo (Ctrl+Z)" aria-label="Undo">${IC.undo}</button>
        <button class="icon-btn" type="button" id="psRedo" title="Redo (Shift+Ctrl+Z)" aria-label="Redo">${IC.redo}</button>
        <div class="ps-menu-wrap"><button class="btn" type="button" id="psFileBtn" aria-haspopup="menu" aria-expanded="false">${IC.down}Layout</button>
          <div class="ps-menu" id="psMenu" role="menu" hidden>
            <button type="button" role="menuitem" data-f="save">Save layout file<span>.json</span></button>
            <button type="button" role="menuitem" data-f="load">Load layout file…</button>
            <button type="button" role="menuitem" data-f="project-save">Save complete plan project<span>.json</span></button>
            <button type="button" role="menuitem" data-f="project-load">Import complete plan project…</button>
            <button type="button" role="menuitem" data-f="project-restore">Remove local project override</button>
            <button type="button" role="menuitem" data-f="preset">Copy as plan preset</button>
            <button type="button" role="menuitem" data-f="compare">Compare with the other plans, 2D and 3D</button>
            <button type="button" role="menuitem" data-f="options">Compare the layout options</button>
            <hr><button type="button" role="menuitem" data-f="glb">Export 3D model<span>.glb</span></button>
            <button type="button" role="menuitem" data-f="png">Snapshot of the 3D view<span>.png</span></button>
            <button type="button" role="menuitem" data-f="png2">High-resolution snapshot<span>2× .png</span></button>
            <button type="button" role="menuitem" data-f="png4k">Poster snapshot<span>4K .png</span></button>
            <button type="button" role="menuitem" data-f="render2">Render image, progressive<span>2× .png</span></button>
            <button type="button" role="menuitem" data-f="render4">Render image, progressive<span>4× .png</span></button>
            <button type="button" role="menuitem" data-f="csv">Shopping list<span>.csv</span></button>
            <hr><button type="button" role="menuitem" data-f="clear">Clear all furniture</button>
          </div></div>
        <input type="file" id="psFile" accept=".json,application/json" hidden>
        <input type="file" id="psProjectFile" accept=".json,application/json" hidden>
      </div>
    </header>
    <div class="ps-grid">
      <div class="ps-main">
        <div class="ps-panes" id="psPanes" data-mode="both">
          <div class="ps-pane ps-2d" id="p2dWrap">
            <svg id="p2d" role="img" aria-label="Floor plan from above with furniture"></svg>
            <div class="float ps-dims" id="psDims" role="group" aria-label="Dimensions">${[['sel', 'Selection'], ['all', 'All rooms'], ['off', 'Off']].map(([k, t]) => `<button type="button" data-dm="${k}">${t}</button>`).join('')}</div>
            <div class="ps-corner"><span class="ps-north" id="psNorth" title="North"><i></i>N</span><span>1 square = 1 ft</span></div>
          </div>
          <div class="ps-pane canvas-stage" id="pstage">
            <canvas id="pgl" aria-label="3D model of the apartment"></canvas>
            <div class="float ps-cams" id="psCams" role="group" aria-label="Camera">${[['bird', 'Bird’s eye'], ['top', 'Top'], ['bed', 'From bed'], ['sofa', 'From sofa'], ['door', 'From door'], ['walk', 'Walk']].map(([k, t]) => `<button type="button" data-v="${k}">${t}</button>`).join('')}</div>
            <div class="float ps-walls" id="psWalls" role="group" aria-label="Walls">${[['cut', 'Cut'], ['full', 'Full'], ['outline', 'Outline']].map(([k, t]) => `<button type="button" data-w="${k}">${t}</button>`).join('')}</div>
            <div class="float ps-look" id="psLook" role="toolbar" aria-label="Look out of the windows" hidden></div>
            <div class="hud" id="phud"></div>
            <div class="ps-hint" id="psHint"></div>
          </div>
        </div>
        <div class="panel ps-sun" id="ptimePanel"></div>
      </div>
      <aside class="ps-side">
        <div class="panel ps-insp" id="psInsp"></div>
        <div class="seg ps-tabs" id="psTabs" role="tablist">${[['furniture', 'Furniture'], ['checks', 'Checks'], ['shop', 'Shop'], ['light', 'Light'], ['plan', 'Plan']].map(([k, t]) => `<button type="button" role="tab" data-t="${k}">${t}<span class="n" id="psTabN-${k}"></span></button>`).join('')}</div>
        <div class="panel ps-tab" id="psTab" role="tabpanel"></div>
      </aside>
    </div>
    <section class="panel ps-compare" id="psCompare" hidden aria-label="Compare plans"></section>
  </div>`;
  const savedProjects = store.get(libraryKey(), {});
  for (const [id, value] of Object.entries(savedProjects && typeof savedProjects === 'object' ? savedProjects : {}).slice(0,20)) {
    const parsed=parseProject(value,{planId:id});
    if(parsed.ok)projectLibrary[id]=parsed.project;
  }
  planOptions();
  $('planSel').addEventListener('change', (e) => (location.hash = '#plan/' + encodeURIComponent(e.target.value)));
  st.mode = isPhone() ? '2d' : 'both';
  st.mood = ['auto', 'day', 'evening', 'night'].includes(store.get('plan-mood', 'auto')) ? store.get('plan-mood', 'auto') : 'auto';
  bindChrome();
  LX.init(lightingApi);   // [feature J]
  on('theme', () => { if (!ready) return; G3.retheme(); recompute({ all: true }); applyCity(); });
}

export async function show(id) {
  const ids = planIds();
  if (!ids.length) {
    $('psTitle').textContent='No floor plans yet';
    $('psSub').textContent='Import a complete plan project through Layout, or ask your research agent to prepare one from a dimensioned plan.';
    planEmpty(true);
    return;
  }
  planEmpty(false);
  if (id && id !== 'compare' && !ids.includes(id)) missingNotice('floor plan', id);
  const wantCompare = id === 'compare';
  id = id && ids.includes(id) ? id : st.id || ids[0];
  $('planSel').value = id;
  if (id !== st.id) await load(id);
  G3.resize(); G3.markDirty();
  if (!loop) { loop = true; requestAnimationFrame(frame); }
  if (wantCompare && model) openCompare();
}

// ------------------------------------------------------------------ loading
async function load(id) {
  const raw = projectLibrary[id]?.plan || await loadJSON(`${S.base}/plans/${id}.json`, null);
  st.id = id;
  if ($('planSel') && $('planSel').value !== id) $('planSel').value = id;   // keep the picker on the plan shown (e.g. after an import)
  try { model = normalisePlan(raw); rawPlan=JSON.parse(JSON.stringify(raw)); } catch (e) {
    model = null;
    $('psTitle').textContent = 'Floor plan';
    $('psInsp').innerHTML = `<div class="empty"><b>This plan could not be read</b>${esc(e.message || e)}</div>`;
    return;
  }
  const qs = new URLSearchParams(location.search);
  st.date = qs.get('date') || (S.crit.search?.move_in?.earliest ? String(S.crit.search.move_in.earliest).slice(0, 10) : new Date().toISOString().slice(0, 10));
  st.min = +(qs.get('pmin') || 720);
  st.site = null; siteProf = null; onSite = winSky = winMin = null; winMinKey = '';
  if ((S.manifest.sites || []).includes(id)) {
    const site = await loadJSON(`${S.base}/sites/${id}.json`, null);
    if (site?.b?.length && site.b[site.target]) {
      const B = prepBuildings(site.b, site.holes && typeof site.holes === 'object' ? site.holes : null, effectiveComponents(site)), T = B[site.target] || B[0];
      const F = canonicalFaces(facesOf(T,8,B),site.faces||[],site.version);
      const pool = F.filter((f) => !f.shared);
      st.site=site;
      if(pool.length) {
      const want = model.up_bearing ?? site.window?.bearing ?? 180;
      const pin = getPin(id, { base: S.base }), pinned = pin ? pool.find((f) => f.i === pin.face) : null;   // [model project]
      const face = pinned || pool.reduce((best, f) => (Math.abs(angDiff(f.bearing, want)) < Math.abs(angDiff(best.bearing, want)) - 0.5 || (Math.abs(Math.abs(angDiff(f.bearing, want)) - Math.abs(angDiff(best.bearing, want))) <= 0.5 && f.length > best.length) ? f : best), pool[0]);
      const t = snapPosition(face, pinned ? pin.t : face.i === site.window?.face ? site.window?.t ?? 0.5 : 0.5,snapOpen), x = face.a[0] + (face.b[0] - face.a[0]) * t, y = face.a[1] + (face.b[1] - face.a[1]) * t;
      const floor = pin?.floor ?? (model.floor || byId(id)?.floor || 5);   // [model project] a pinned window carries its own floor
      const cal = resolveCal(geoFromSite(site, T.g), pinned && Object.hasOwn(pin, 'cal') ? pin.cal : measuredFromSite(site));
      siteProf = horizonProfile(B, x + Math.sin(face.bearing * DEG) * 0.4, y + Math.cos(face.bearing * DEG) * 0.4, cal.slabAt(floor) + 1.6);
      placeOnSite(site, floor);
      }
    }
  }
  if (!ready) { G3.init($('pgl'), $('pstage'), () => {}); P2.mount($('p2d'), { item: (i) => R.find((x) => x.id === i), select, move: dragTo, commit: () => commit() }); bind3D(); ready = true; LX.attach3D(); Q3.mount({ stage: $('pstage'), model: () => model, toast, store }); }
  G3.setModel(model); G3.setWallMode(st.wall);
  P2.setModel(model); LX.reattach2D(); Q3.modelChanged();   // [feature J]
  st.city = !!store.get(`plan-city.${S.base}`, false); applyCity();
  // furniture: the saved layout for this plan, else the first preset
  const saved = projectLibrary[id]?.layout || store.get(key(id), null), v = saved && validateLayout(saved, { planId: id });
  const light = projectLibrary[id]?.lighting || store.get(`plan-light.${S.base}.${id}`, {});
  st.directSun = light.directSun !== false;
  st.ambient = typeof light.ambient === 'number' && Number.isFinite(light.ambient) ? Math.max(0, Math.min(2, light.ambient)) : 1;
  st.glazing = clampGlazing(light.glazing); st.blinds = blindsOf(light.blinds);
  LX.load(light);   // [feature J] daylight inputs and luminaires
  inventory = await loadInventory(id);   // [furniture]
  if (!model.layouts.length) { try { model.layouts.push(inventory ? ownLayout() : suggestLayout(model)); } catch { /* a plan the placer cannot handle keeps no preset */ } }
  items = v?.ok ? v.layout.items : (model.layouts[0]?.items || []).map((x) => ({ ...x }));
  undo.length = 0; redo.length = 0; sel = null; cancelCompare(); $('psCompare').hidden = true; st.routeKey = null; st.finder = null; routesRes = null;
  G3.setMood(st.mood);
  st.activePreset = v?.ok ? null : model.layouts[0]?.id || null;
  head(); setMode(st.mode); setWall(st.wall, true); G3.setView(st.view === 'top' ? 'top' : 'bird'); markCams();
  recompute({ all: true }); sunPanel(); refreshSun();
}

// [furniture] "Your furniture" (furniture.json beside the search, or the inventory a project carried)
let fileInventory;
async function loadInventory(id) {
  if (projectLibrary[id]?.inventory) return projectLibrary[id].inventory;
  if (fileInventory === undefined) {
    const raw = S.manifest.furniture ? await loadJSON(`${S.base}/furniture.json`, null) : null, v = raw && validateInventory(raw);
    fileInventory = v?.ok ? v.inventory : null;
  }
  return fileInventory;
}
/** The renter's pieces fitted into this plan with the checks, as a layout preset. */
function ownLayout() { const r = fitInventory(model, inventory, { step: 8 }); return { id: 'your-furniture', name: r.name, note: r.note, items: r.items, auto: true }; }
const OWN = 'your-furniture';

function head() {
  const L = byId(st.id);
  $('psTitle').innerHTML = `${esc(model.title || (L ? label(L) : st.id))} <span>floor plan</span>`;
  const pv = model.provenance, est = model.fixtures.filter((f) => f.est).length;
  const match = { 'exact-unit': 'Exact unit plan', 'line-tier': 'Same line, other floor', representative: 'Representative plan', 'stated-dims': 'Drawn from stated room sizes', 'photo-estimate': 'Estimated from photos' }[pv.match];
  $('psSub').innerHTML = `${match ? `<span class="pill accent">${esc(match)}</span> ` : ''}${Math.round(model.area)} ft² of rooms drawn${facingSummary(model, onSite?.az ?? model.up_bearing).text ? ` · ${facingSummary(model, onSite?.az ?? model.up_bearing).text}` : ''}${model.floor ? ` · floor ${model.floor}` : ''}${est ? ` · <span class="warnline">${est} fixture${est > 1 ? 's' : ''} estimated</span>` : ''}`;
  const n = $('psNorth'); if (n) { n.hidden = model.up_bearing == null; n.style.setProperty('--rot', `${-(model.up_bearing || 0)}deg`); }
}

// ------------------------------------------------------------------ state changes
/** The Light tab's settings as stored with the plan (display preview values, never measured photometry). */
const lightingOf = () => ({ directSun: st.directSun, ambient: st.ambient, glazing: st.glazing, blinds: st.blinds, ...LX.extras() });   // [feature J] extras: daylight inputs, luminaires

// [feature J] what plan/lighting-ui.js needs from the studio (live state through getters, so nothing is copied)
let fallbackSkies = null;
/** One skyline per plan window: each window's own when the plan is placed on its site, else the one assumed point. */
function skiesNow() {
  if (!model || (st.site && !siteProf)) return null;
  if (winSky && winSky.length === model.windows.length) return winSky;
  if (siteProf && model.up_bearing != null) {
    if (fallbackSkies?.src !== siteProf || fallbackSkies.n !== model.windows.length) fallbackSkies = { src: siteProf, n: model.windows.length, v: model.windows.map(() => ({ prof: siteProf })) };
    return fallbackSkies.v;
  }
  return null;
}
const persistLight = () => { store.set(`plan-light.${S.base}.${st.id}`, lightingOf()); if (projectLibrary[st.id]) persist(); refreshSun(); };
const lightingApi = {
  base: () => S.base, model: () => model, items: () => R, skies: skiesNow, vt: () => st.glazing, blinds: () => st.blinds,
  setVt: (v) => { st.glazing = clampGlazing(v); },
  svg: () => $('p2d'), toPlan: (x, y) => P2.toPlan(x, y), checkpoint: () => checkpoint(), persist: persistLight, toast,
  setMood: (m) => setMood(m), setSurfaces: (rho) => G3.setSurfaces(rho), skyView: (i) => windowSky()?.[i] ?? null,
};
const snapshot = () => JSON.stringify({items,plan:rawPlan,siteProfile:siteProf?Array.from(siteProf):null,lighting:lightingOf()});
function checkpoint() { undo.push(snapshot()); if (undo.length > 80) undo.shift(); redo.length = 0; markUndo(); }
function persist() {
  store.set(key(st.id), serialiseLayout(st.id, items));
  if(projectLibrary[st.id]) {
    const project=serialiseProject(rawPlan,items,lightingOf(),inventory);
    try{saveProjectLibrary(Object.assign(Object.create(null),projectLibrary,{[st.id]:project}));}
    catch(e){toast('Browser project could not be saved. Export a complete project backup.',6000);}
  }
}
function commit() { persist(); markUndo(); recompute({ panels: true }); }
function markUndo() { $('psUndo').disabled = !undo.length; $('psRedo').disabled = !redo.length; }
function doUndo(back = true) {
  const from = back ? undo : redo, to = back ? redo : undo; if (!from.length) return;
  to.push(snapshot());
  const saved=JSON.parse(from.pop());items=saved.items;
  if(saved.plan) {
    rawPlan=saved.plan;model=normalisePlan(rawPlan);G3.setModel(model);G3.setWallMode(st.wall);P2.setModel(model);LX.reattach2D();
    siteProf=Array.isArray(saved.siteProfile)?Float64Array.from(saved.siteProfile):null;
    if(st.site && siteProf)placeOnSite(st.site,model.floor||byId(st.id)?.floor||5);
    else dropPlacement();
  }
  if(saved.lighting) {st.directSun=saved.lighting.directSun;st.ambient=saved.lighting.ambient;st.glazing=clampGlazing(saved.lighting.glazing);st.blinds=blindsOf(saved.lighting.blinds);LX.load(saved.lighting);}
  if (sel && !items.some((x) => x.id === sel)) sel = null;
  if(projectLibrary[st.id])projectLibrary[st.id]=serialiseProject(rawPlan,items,lightingOf(),inventory);
  persist(); markUndo(); recompute({ all: true });
  refreshSun();head();
}

/** Re-resolve, re-check and redraw. opts.all rebuilds every 3D item; opts.panels redraws the side. */
function recompute(opts = {}) {
  if (!model) return;
  R = items.map((x) => resolve(x)).filter(Boolean);
  ev = evaluate(model, R);
  G3.setItems(R); LX.itemsChanged(); Q3.itemsChanged();   // [feature J]
  for (const it of R) G3.setRoomOf(it.id, ev.items[it.id]?.room || '');
  const states = Object.fromEntries(Object.values(ev.items).map((r) => [r.id, r.state]));
  G3.setStatus(states, sel);
  if (opts.panels === false) { clearTimeout(routeT); routeT = setTimeout(() => { computeRoutes(); overlays(); if (st.tab === 'checks') tab(); }, 260); }
  else computeRoutes();
  overlays();
  inspector();
  if (opts.panels !== false) tab();
  tabCounts(); lookChips();   // [interior]
}
function computeRoutes() { try { routesRes = accessRoutes(model, R); } catch { routesRes = null; } }
const shownRoutes = () => (routesRes ? routesRes.routes.filter((r) => st.routes || r.key === st.routeKey) : []);
function overlays() {
  const zones = [], gaps = sel ? gapRays(model, R, sel) : [], sights = [];
  for (const r of Object.values(ev.items)) if (st.zonesAll || r.id === sel) for (const z of r.zones) zones.push(z);
  for (const f of ev.fixtures) if (st.zonesAll || f.grade !== 'clear' || (sel && f.blockers.includes(sel))) zones.push(f);
  if (st.sight) for (const t of ev.tv) {
    const show = !sel || sel === t.id || t.seats.some((s) => s.seatId === sel);
    if (!show || !t.seats.length) continue;
    const pool = sel && sel !== t.id ? t.seats.filter((s) => s.seatId === sel) : t.seats;
    const list = [pool.reduce((a, b) => (gradeRank(a.grade) <= gradeRank(b.grade) ? a : b))];
    for (const s of list) sights.push({ from: s.from, to: s.at, label: `${(s.dist / 12).toFixed(1)} ft · ${s.tag}` });
  }
  const fl = flash && performance.now() < flashT ? flash : null;
  const routes = shownRoutes();
  P2.draw({ items: R, sel, ev, zones, gaps, sights, flash: fl, routes, dims: st.dims });
  const eye = G3.viewMode() === 'eye';
  G3.setOverlay({ zones: eye ? [] : zones, gaps: eye || st.dims === 'off' ? [] : gaps, sights: eye ? [] : sights, flash: fl, swings: st.swings ? model.doorways.map((d) => swingPoly(d, 12)).filter(Boolean) : [], routes: eye ? [] : routes });
}
const gradeRank = (g) => ['clear', 'tight', 'blocked'].indexOf(g);

function select(id) {
  if (sel === id) return;
  sel = id; recompute({ panels: st.tab === 'furniture' || st.tab === 'shop' });
  if (st.tab === 'furniture') markList();
}
function markList() { document.querySelectorAll('#psTab .ps-item').forEach((el) => el.classList.toggle('on', el.dataset.id === sel)); }

/** Live drag (2D or 3D): snap to the inch, and flush to a wall face when within 4 in. */
function dragTo(id, x, y) {
  const it = items.find((q) => q.id === id); if (!it) return;
  if (!st.dragging) { checkpoint(); st.dragging = true; }
  it.x = Math.round(x); it.y = Math.round(y);
  if (st.snap) snapToWalls(it);
  recompute({ panels: false });
}
function snapToWalls(it) {
  const r = resolve(it); if (!r) return;
  const gaps = gapRays(model, [...R.filter((q) => q.id !== it.id), r], it.id, 6);
  for (const g of gaps) if (g.d > 0.05 && g.d < 4) { it.x += g.u[0] * (g.d - 0.05); it.y += g.u[1] * (g.d - 0.05); }
  it.x = Math.round(it.x * 10) / 10; it.y = Math.round(it.y * 10) / 10;
}
function endDrag() { if (st.dragging) { st.dragging = false; commit(); } }

function mutate(fn, msg) { checkpoint(); fn(); persist(); recompute({ all: true }); if (msg) toast(msg); }
function rotateSel(d) { const it = items.find((q) => q.id === sel); if (it) mutate(() => { it.rot = ((Math.round(it.rot || 0) + d) % 360 + 360) % 360; }); }
function nudge(dx, dy) { const it = items.find((q) => q.id === sel); if (!it) return; if (!st.nudging) { checkpoint(); st.nudging = true; } it.x += dx; it.y += dy; persist(); recompute({ panels: false }); clearTimeout(st.nudgeT); st.nudgeT = setTimeout(() => { st.nudging = false; tab(); }, 500); }
function removeSel() { const it = items.find((q) => q.id === sel); if (!it) return; const n = resolve(it)?.name || it.ref; mutate(() => { items = items.filter((q) => q.id !== sel); sel = null; }, `Removed ${n.toLowerCase()}`); }
function duplicateSel() {
  const it = items.find((q) => q.id === sel); if (!it) return;
  const copy = { ...it, id: newId(it.ref, items), x: it.x + 12, y: it.y - 12 };
  mutate(() => { items.push(copy); place(copy, roomOf(model, [it.x, it.y]), true); sel = copy.id; });
}
function addRef(ref) {
  const c = CATALOG[ref]; if (!c) return;
  const want = sel ? ev.items[sel]?.room : null;
  const room = want || (model.rooms.find((r) => r.kind === ({ sleep: 'bedroom', work: 'bedroom', storage: 'bedroom' }[c.cat] || 'living')) || [...model.rooms].sort((a, b) => b.area - a.area)[0]).name;
  const rm = model.rooms.find((r) => r.name === room);
  const it = { id: newId(ref, items), ref, x: Math.round(rm.label[0]), y: Math.round(rm.label[1]), rot: 0 };
  mutate(() => { items.push(it); const ok = place(it, room, true); sel = it.id; toast(ok ? `Added ${c.name.toLowerCase()} to the ${room.toLowerCase()}` : `No clear spot for the ${c.name.toLowerCase()} in the ${room.toLowerCase()}; it is in the middle`); });
}
/** Auto-place an item in a room; returns the grade or null. Mutates the item. */
function place(it, room, quiet = false) {
  const all = items.map((x) => resolve(x)).filter(Boolean);
  const s = findSpot(model, all, it.id, room);
  if (s) { it.x = Math.round(s.x * 10) / 10; it.y = Math.round(s.y * 10) / 10; it.rot = s.rot; }
  if (!quiet) toast(s ? (s.grade === 'clear' ? `Placed in the ${room.toLowerCase()}` : `Placed in the ${room.toLowerCase()}, with a ${s.grade} clearance`) : `No spot in the ${room.toLowerCase()} fits it with the rest where it is`);
  return s ? s.grade : null;
}
function applyPreset(lid) {
  const L = model.layouts.find((l) => l.id === lid); if (!L) return;
  mutate(() => { items = L.items.map((x) => ({ ...x })); sel = null; st.activePreset = lid; }, `Layout: ${L.name}`);
}
/** [furniture] Use the plan's "Your furniture" layout, or fit the renter's pieces into this plan with the checks. */
function useOwn() {
  if (!inventory) return;
  if (!model.layouts.some((l) => l.id === OWN)) { try { model.layouts.unshift(ownLayout()); } catch (e) { toast(`Could not fit your furniture: ${e.message || e}`, 4200); return; } }
  applyPreset(OWN);
}
/** [furniture] Add one of the renter's pieces (its own size) to the layout, placed in the kind of room it lives in. */
function addOwn(pid) {
  const p = inventory?.pieces.find((q) => q.id === pid); if (!p || items.some((q) => q.id === pid)) return;
  const room = (model.rooms.filter((r) => r.kind === (p.room === 'dining' ? 'living' : p.room)).sort((a, b) => b.area - a.area)[0] || [...model.rooms].sort((a, b) => b.area - a.area)[0]);
  const it = pieceItem(p, { x: Math.round(room.label[0]), y: Math.round(room.label[1]), rot: 0 });
  mutate(() => { items.push(it); const ok = place(it, room.name, true); sel = it.id; st.activePreset = null; toast(ok ? `Added ${(p.label || p.ref).toLowerCase()} to the ${room.name.toLowerCase()}` : `No clear spot in the ${room.name.toLowerCase()}; it is in the middle`); });
}
function flashPoly(poly) { flash = poly; flashT = performance.now() + 2400; overlays(); setTimeout(() => { if (performance.now() >= flashT) { flash = null; overlays(); } }, 2500); }

// ------------------------------------------------------------------ chrome: modes, cameras, walls, tabs, files, keys
function bindChrome() {
  $('psProjectFile').addEventListener('change',async e=>{
    const file=e.target.files?.[0];e.target.value='';if(!file)return;
    if(file.size>MAX_BYTES) { toast('Complete plan projects must be smaller than 1 MB.');return; }
    const result=parseProject(await file.text());
    if(!result.ok) { toast(`Project not imported: ${result.error}`,6000);return; }
    const id=result.project.plan.id;
    if(!projectLibrary[id]&&Object.keys(projectLibrary).length>=20) { toast('Keep up to 20 local projects. Export and remove one before adding another.');return; }
    try{saveProjectLibrary(Object.assign(Object.create(null),projectLibrary,{[id]:result.project}));}
    catch(e){toast(`Project not imported: ${e.message||e}`,6000);return;}
    store.set(key(id),result.layout);
    store.set(`plan-light.${S.base}.${id}`,result.project.lighting||{});
    planOptions();await load(id);location.hash='#plan/'+encodeURIComponent(id);
    toast('Imported local plan project. The original search files are unchanged.');
  });
  $('psMode').addEventListener('click', (e) => { const b = e.target.closest('[data-m]'); if (b) setMode(b.dataset.m); });
  $('psDims').addEventListener('click', (e) => { const b = e.target.closest('[data-dm]'); if (!b) return; st.dims = b.dataset.dm; store.set('plan-dims', st.dims); markDims(); overlays(); });
  st.dims = ['sel', 'all', 'off'].includes(store.get('plan-dims', 'sel')) ? store.get('plan-dims', 'sel') : 'sel'; markDims();
  document.addEventListener('keyup', (e) => { held.delete(e.key.toLowerCase()); if (!e.shiftKey) held.delete('shift'); });
  window.addEventListener('blur', () => held.clear());
  $('psCams').addEventListener('click', (e) => { const b = e.target.closest('[data-v]'); if (b) camera(b.dataset.v); });
  $('psWalls').addEventListener('click', (e) => { const b = e.target.closest('[data-w]'); if (b) setWall(b.dataset.w); });
  bindLookChips($('psLook'), { pick: lookAt, order: () => viewsNow().map((v) => v.key) });   // [interior]
  $('psLook').addEventListener('click', (e) => { if (e.target.closest('[data-act="unit-sun"]')) openInUnit(); });   // [room3d]
  $('psTabs').addEventListener('click', (e) => { const b = e.target.closest('[data-t]'); if (b) { st.tab = b.dataset.t; tab(); } });
  $('psUndo').addEventListener('click', () => doUndo(true));
  $('psRedo').addEventListener('click', () => doUndo(false));
  const menu = $('psMenu'), mb = $('psFileBtn');
  const close = () => { menu.hidden = true; mb.setAttribute('aria-expanded', 'false'); };
  mb.addEventListener('click', (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; mb.setAttribute('aria-expanded', String(!menu.hidden)); });
  document.addEventListener('click', (e) => { if (!e.target.closest('.ps-menu-wrap')) close(); });
  menu.addEventListener('click', (e) => { const b = e.target.closest('[data-f]'); if (!b) return; close(); fileAction(b.dataset.f); });
  $('psFile').addEventListener('change', async (e) => {
    const f = e.target.files?.[0]; e.target.value = ''; if (!f) return;
    if (f.size > MAX_BYTES) { toast('That file is larger than 1 MB'); return; }
    const r = parseLayout(await f.text(), { planId: st.id });
    if (!r.ok) { toast(`Could not load: ${r.error}`, 4200); return; }
    mutate(() => { items = r.layout.items; sel = null; st.activePreset = null; }, `Loaded ${r.layout.items.length} pieces`);
  });
  document.addEventListener('keydown', keys);
  $('psInsp').addEventListener('click', inspClick);
  $('psInsp').addEventListener('change', inspChange);
  $('psTab').addEventListener('click', tabClick);
  $('psTab').addEventListener('change', tabChange);
  $('psCompare').addEventListener('click', (e) => { if (e.target.closest('[data-cmp=close]')) { cancelCompare(); $('psCompare').hidden = true; } });
}
function markDims() { $('psDims').querySelectorAll('[data-dm]').forEach((b) => b.classList.toggle('on', b.dataset.dm === st.dims)); }
function setMode(m) {
  st.mode = m; $('psPanes').dataset.mode = m;
  $('psMode').querySelectorAll('[data-m]').forEach((b) => b.classList.toggle('on', b.dataset.m === m));
  const reframe = () => { G3.resize(); if (model && G3.viewMode() === 'orbit') G3.setView(st.view === 'top' ? 'top' : 'bird'); G3.markDirty(); };
  if (ready) { reframe(); requestAnimationFrame(reframe); }
}
function setWall(w, quiet) {
  st.wall = w; $('psWalls').querySelectorAll('[data-w]').forEach((b) => b.classList.toggle('on', b.dataset.w === w));
  if (!quiet || G3.currentWallMode() !== w) G3.setWallMode(w);
}
function markCams() {
  $('psCams').querySelectorAll('[data-v]').forEach((b) => {
    b.classList.toggle('on', b.dataset.v === st.view);
    if (b.dataset.v === 'bed') b.disabled = !R.some((x) => x.kind === 'bed' && !x.hidden);
    if (b.dataset.v === 'sofa') b.disabled = !R.some((x) => (x.kind === 'sofa' || x.kind === 'chair') && !x.hidden);
  });
  const hints = { walk: 'Drag to look · hold W S or ↑ ↓ to walk, A D to turn, Q E to step sideways, Shift to hurry · Esc to stop', tour: 'Walking the route · drag or W A S D to take over · Esc to stop', bed: 'Drag to look around · scroll to move', sofa: 'Drag to look around · scroll to move', door: 'Drag to look around · scroll to move' };
  lookChips();   // [interior]
  $('psHint').textContent = hints[st.view] || (G3.viewMode() === 'eye' ? 'Drag to look around · scroll to step · ← → or [ ] switch the view · Esc to leave' : '') || (isPhone() ? 'Drag a piece to move it · drag the floor to orbit' : 'Drag a piece to move it · drag the floor to orbit · right-drag to pan');
}
const entryDoor = () => entryPoint(model);
// [interior] "Look out of": the windows by room (with bays and corners) and the seats, as chips over the 3D view
let viewsKey = '', viewsMemo = [];
function viewsNow() {
  if (!model) return [];
  const k = `${model.id}|${R.filter((x) => !x.hidden && ['sofa', 'chair', 'bed', 'desk'].includes(x.kind)).map((x) => `${x.id}:${Math.round(x.x)},${Math.round(x.y)},${Math.round(x.rot)}`).join(';')}|${model.windows.length}`;
  if (k !== viewsKey) { viewsKey = k; try { viewsMemo = allViews(model, R); } catch { viewsMemo = []; } }
  return viewsMemo;
}
// [room3d] "What's measured vs assumed" over the 3D pane: the same rows as Unit 3D's chip, and a way into Unit 3D's evidence
let accUI = null, accKey = '', furnMeta = null;
function accChip() {
  if (!model) return;
  if (!accUI) { accUI = accuracyChip({ host: 'studio', onOpen: () => { location.hash = `#unit/${st.id}`; }, openLabel: 'Open in Unit 3D' }); $('pstage').appendChild(accUI.el); loadFurnitureMeta(S.base, S.manifest).then((m) => { furnMeta = m; accKey = ''; accChip(); }); }
  const key = [st.id, !!st.site, onSite?.floor, onSite?.t, onSite?.az, onSite?.cal?.state, !!inventory, items.length, !!furnMeta].join('|');
  if (key === accKey) return; accKey = key;
  accUI.update(accuracyRows({ site: st.site || {}, plan: model, cal: onSite ? { state: onSite.cal.state, fh: onSite.cal.fh, slab: onSite.slab } : null, floor: onSite?.floor, facing: onSite?.az ?? null, t: onSite?.t ?? null,
    furniture: items.length && inventory ? { name: furnMeta?.name || inventory.name, confirmed: furnMeta?.confirmed || null, count: items.length } : items.length ? { name: 'A starter layout', confirmed: null, count: items.length } : null }));
}
// [room3d] "Sun today" in the look panel: the direct sun the window of this view gets today (its own skyline against the shared city), with a way into Unit 3D
let sunCtx = null, sunMemo = { key: '', html: '' };
function sunExtra() {
  if (G3.viewMode() !== 'eye' || !winSky || !st.site || !sunCtx) return { key: '', html: '' };
  const v = viewsNow().find((q) => q.key === st.view), g = v ? windowGroups(model)[v.group] : null; if (!g) return { key: '', html: '' };
  const i = g.panes[Math.floor(g.panes.length / 2)], { lat, lon, tz, y, m, d } = sunCtx, key = `${st.date}|${i}|${winSky.length}`;
  if (sunMemo.key === key) return sunMemo;
  let html;
  if (windowWithheld(winSky, i)) html = sunGroupHTML({ minutes: null });
  else { const info = litInfo(dayTable(y, m - 1, d, lat, lon, tz, 6), winSky[i].prof, model.windows[i].bearing, 6); html = sunGroupHTML({ minutes: info.min, segs: info.segs, min: st.min, label: v.room }); }
  return (sunMemo = { key, html });
}
function openInUnit() {
  const v = viewsNow().find((q) => q.key === st.view);
  setHandoff(st.id, { date: st.date, min: st.min, mode: 'in', ...(v ? { inside: v.key } : {}) });
  location.hash = `#unit/${encodeURIComponent(st.id)}`;
}
function lookChips() {
  accChip();
  const el = $('psLook'); if (!el || !model) return;
  const ex = sunExtra();
  el.hidden = !setLookChips(el, viewsNow(), G3.viewMode() === 'eye' ? st.view : null, { extra: ex.html, extraKey: ex.key });
  const on = el.querySelector('.lk-chip.on'); if (on && el.scrollWidth > el.clientWidth + 2) el.scrollLeft = Math.max(0, on.offsetLeft - 24);   // a phone's row scrolls to the active chip
}
function lookAt(key) {
  const v = viewsNow().find((q) => q.key === key); if (!v || !model) return;
  if (st.mode === '2d') setMode(isPhone() ? '3d' : 'both');
  st.view = key;
  G3.setView('look', { at: v.at, dir: v.dir, h: v.h, pitch: v.pitch, fov: v.fov }); setWall('full', true);
  applyCity(); overlays(); markCams();
}
function stepLook(step) {
  const vs = viewsNow(), nx = stepView(vs, G3.viewMode() === 'eye' ? st.view : null, step); if (nx) lookAt(nx.key);
}
function camera(v) {
  if (!model) return;
  if (st.mode === '2d') setMode(isPhone() ? '3d' : 'both');
  st.view = v;
  if (v === 'bird' || v === 'top') { G3.setView(v); setWall(G3.currentWallMode(), true); }
  else {
    let eye = null;
    if (v === 'bed' || v === 'sofa') {
      const it = R.find((x) => !x.hidden && (v === 'bed' ? x.kind === 'bed' : x.kind === 'sofa' || x.kind === 'chair'));
      if (!it) return;
      const [, lx, ly] = it.seats[0]; const p = toWorld(it, lx, ly), b = axes(it.rot).b;
      eye = { at: p, dir: [-b[0], -b[1]], h: v === 'bed' ? 40 : 42, pitch: v === 'bed' ? -0.1 : -0.06 };
    } else eye = { ...entryDoor(), h: 63, pitch: -0.05 };
    G3.setView(v, eye); setWall('full', true);
  }
  applyCity();   // [interior] the city outside comes with every eye-level view
  overlays(); markCams();
}

async function fileAction(f) {
  if(f==='project-load') { $('psProjectFile').click(); return; }
  if (!model) return;
  if (f === 'save') saveBlob(new Blob([JSON.stringify(serialiseLayout(st.id, items), null, 2)], { type: 'application/json' }), `${st.id}-layout.json`);
  else if(f==='project-save') {
    try { const project=serialiseProject(rawPlan,items,lightingOf(),inventory);saveBlob(new Blob([JSON.stringify(project,null,2)],{type:'application/json'}),`${st.id}-project.json`); }
    catch(e) { toast(`Project export failed: ${e.message || e}`,5000); }
  }
  else if(f==='project-restore') {
    if(!projectLibrary[st.id]) { toast('This is the original source plan; no local override exists.'); return; }
    const old=st.id;const remaining=Object.assign(Object.create(null),projectLibrary);delete remaining[old];
    try{saveProjectLibrary(remaining);}catch(e){toast('Could not remove the browser project.',5000);return;}planOptions();
    const next=planIds().includes(old)?old:planIds()[0];
    if(next) { await load(next);location.hash='#plan/'+encodeURIComponent(next); }
    else { st.id=null;model=null;rawPlan=null;$('psTitle').textContent='No floor plans yet';$('psSub').textContent='Import another complete plan project through Layout.'; }
    toast('Removed local project. Source files are unchanged.');
  }
  else if (f === 'load') $('psFile').click();
  else if (f === 'compare') openCompare();
  else if (f === 'preset') {
    const txt = JSON.stringify(asPreset(items, { k: model.k, id: 'my-layout', name: 'My layout', note: '' }), null, 2);
    try { await navigator.clipboard.writeText(txt); toast('Copied. Paste it into "layouts" in the plan file'); } catch { saveBlob(new Blob([txt], { type: 'application/json' }), `${st.id}-preset.json`); }
  } else if (f === 'glb') {
    try { toast('Building the 3D model…'); const buf = await G3.exportGLB(); saveBlob(new Blob([buf], { type: 'model/gltf-binary' }), `${st.id}.glb`); } catch (e) { toast(`Export failed: ${e.message || e}`, 4000); }
  } else if (f === 'png' || f === 'png2' || f === 'png4k') {
    if (st.mode === '2d') { setMode('both'); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); }
    const scale = f === 'png' ? 1 : f === 'png2' ? 2 : 3840 / Math.max(1, $('pstage').clientWidth);
    const a = document.createElement('a'); a.href = G3.snapshotPNG(scale); a.download = `${st.id}-${st.view}${f === 'png' ? '' : f === 'png2' ? '@2x' : '-4k'}.png`; document.body.append(a); a.click(); a.remove();
  } else if (f === 'render2' || f === 'render4') {
    if (st.mode === '2d') { setMode('both'); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); }
    Q3.renderImage(f === 'render2' ? 2 : 4, { name: `${st.id}-${st.view}`, caption: `${model.title || st.id} · ${st.date} ${fmtT(st.min)}` });   // [feature J]
  } else if (f === 'csv') {
    saveBlob(new Blob([shoppingCSV(shoppingList(R), model.title || st.id)], { type: 'text/csv' }), `${st.id}-shopping-list.csv`);
  } else if (f === 'options') openOptions(); else if (f === 'clear') mutate(() => { items = []; sel = null; }, 'Cleared. Undo brings it back');
}
function openOptions() {
  const el = $('psCompare'); cancelCompare(); el.hidden = false;
  renderOptions(el, { model, layouts: model.layouts, current: items, onPick: (id) => { applyPreset(id); openOptions(); } });
  requestAnimationFrame(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }));
}
function openCompare() {
  const el = $('psCompare'); el.hidden = false;
  renderCompare(el, { ids: planIds(), current: st.id, model, items: R, load: (i) => projectLibrary[i]?.plan || loadJSON(`${S.base}/plans/${i}.json`, null), labelOf: (i, m) => m.title || (byId(i) ? label(byId(i)) : i) });
  requestAnimationFrame(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }));
}
function saveBlob(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }

function keys(e) {
  if ($('view-plan').hidden || !model) return;
  const tag = e.target.tagName;
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return;
  const k = e.key, eye = G3.viewMode() === 'eye';
  if ((k === '[' || k === ']') && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); stepLook(k === ']' ? 1 : -1); return; }   // [interior] next / previous window or seat
  if ((e.metaKey || e.ctrlKey) && k.toLowerCase() === 'z') { e.preventDefault(); doUndo(!e.shiftKey); return; }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const stop = () => { e.preventDefault(); e.stopPropagation(); };
  if (eye) {
    const kk = k.toLowerCase();
    if (['w', 's', 'a', 'd', 'q', 'e', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(kk)) { stop(); held.add(kk); if (e.shiftKey) held.add('shift'); if (G3.touring()) { G3.stopTour(); st.view = 'walk'; markCams(); } return; }
    if (k === 'Escape') { stop(); held.clear(); G3.stopTour(); camera('bird'); return; }
  }
  if (k === 'Escape' && sel) { stop(); select(null); return; }
  if (!sel) return;
  const n = e.shiftKey ? 6 : 1;
  if (k === 'ArrowLeft') { stop(); nudge(-n, 0); } else if (k === 'ArrowRight') { stop(); nudge(n, 0); }
  else if (k === 'ArrowUp') { stop(); nudge(0, n); } else if (k === 'ArrowDown') { stop(); nudge(0, -n); }
  else if (k === 'r' || k === 'R') { stop(); rotateSel(e.shiftKey ? -90 : 90); }
  else if (k === 'Delete' || k === 'Backspace') { stop(); removeSel(); }
  else if (k === 'd' || k === 'D') { stop(); duplicateSel(); }
}

// ------------------------------------------------------------------ 3D pointer: drag pieces, orbit the room, look around
function bind3D() {
  const cv = $('pgl'), stage = $('pstage');
  let drag = null, down = null, lookP = null;
  stage.addEventListener('pointerdown', (e) => {
    if (e.target !== cv) return;
    down = { x: e.clientX, y: e.clientY, id: e.pointerId };
    if (G3.viewMode() === 'eye') { lookP = { x: e.clientX, y: e.clientY, id: e.pointerId }; cv.setPointerCapture(e.pointerId); e.stopPropagation(); return; }
    if (e.button !== 0 || e.shiftKey) return;
    const id = G3.pick(e);
    if (!id) return;
    const it = items.find((q) => q.id === id), p = G3.floorPoint(e);
    if (!it || !p) return;
    select(id);
    drag = { id, ox: it.x - p[0], oy: it.y - p[1], pid: e.pointerId };
    G3.setOrbitEnabled(false); cv.setPointerCapture(e.pointerId); cv.style.cursor = 'grabbing'; e.stopPropagation();
  }, true);
  stage.addEventListener('pointermove', (e) => {
    if (lookP && e.pointerId === lookP.id) { G3.look(e.clientX - lookP.x, e.clientY - lookP.y); lookP.x = e.clientX; lookP.y = e.clientY; e.stopPropagation(); return; }
    if (drag && e.pointerId === drag.pid) { const p = G3.floorPoint(e); if (p) dragTo(drag.id, p[0] + drag.ox, p[1] + drag.oy); e.stopPropagation(); return; }
    if (e.buttons === 0 && G3.viewMode() === 'orbit' && e.target === cv && e.pointerType === 'mouse') cv.style.cursor = G3.pick(e) ? 'grab' : '';
  }, true);
  const up = (e) => {
    if (lookP && e.pointerId === lookP.id) { lookP = null; return; }
    if (drag && e.pointerId === drag.pid) { drag = null; G3.setOrbitEnabled(true); cv.style.cursor = ''; endDrag(); return; }
    if (down && e.pointerId === down.id && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 4 && e.target === cv && G3.viewMode() === 'orbit' && !G3.pick(e)) select(null);
    down = null;
  };
  stage.addEventListener('pointerup', up, true); stage.addEventListener('pointercancel', up, true);
  cv.addEventListener('wheel', (e) => { if (G3.viewMode() !== 'eye') return; e.preventDefault(); e.stopPropagation(); G3.walk(-e.deltaY * 0.06); }, { passive: false, capture: true });
  // drags in the 2D pane end on pointerup inside plan2d (handlers.commit); 3D drags end here
  $('p2d').addEventListener('pointerup', () => { st.dragging = false; });
}

// ------------------------------------------------------------------ inspector
function inspector() {
  const el = $('psInsp');
  const it = sel && R.find((x) => x.id === sel);
  if (!it) {
    const c = ev?.counts || { clear: 0, tight: 0, blocked: 0 }, n = R.filter((x) => !x.hidden).length;
    el.innerHTML = `<div class="ps-sum">
      <div class="metrics"><div class="metric"><div class="k">Blocked</div><div class="v ${c.blocked ? 'bad' : ''}">${c.blocked}</div></div><div class="metric"><div class="k">Tight</div><div class="v ${c.tight ? 'warn' : ''}">${c.tight}</div></div><div class="metric"><div class="k">Clear</div><div class="v">${c.clear}</div></div></div>
      <p>${n ? `${n} piece${n > 1 ? 's' : ''} placed.` : 'No furniture yet. Pick a layout or add pieces below.'} Select one in the plan or the 3D view. Drag to move, <kbd>R</kbd> to turn, arrows nudge 1 in (<kbd>Shift</kbd> 6 in), <kbd>D</kbd> duplicates, <kbd>Del</kbd> removes.</p></div>`;
    return;
  }
  const r = ev.items[it.id] || { issues: [], zones: [], state: 'clear' }, c = it.base;
  const active = document.activeElement && el.contains(document.activeElement) && el.querySelector('.ps-fields')?.dataset.id === it.id;
  const issues = r.issues.length ? `<ul class="ps-issues">${r.issues.map((x, i) => `<li class="g-${x.grade}"><button type="button" data-flash="${i}">${esc(x.text)}</button></li>`).join('')}</ul>` : `<p class="ps-ok">Fits, with its clearances respected.</p>`;
  const zones = r.zones.length ? `<div class="ps-zones">${r.zones.map((z) => `<span class="ps-z g-${z.grade}" title="${esc(z.src || '')}"><b>${esc(z.name)}</b> ${Math.round(z.free)}${z.free >= z.preferred - 0.5 ? '+' : ''} in <small>/ ${z.preferred}</small></span>`).join('')}</div>` : '';
  if (active) { // keep the inputs the user is typing in; refresh the rest
    el.querySelector('.ps-state').outerHTML = statePill(r.state);
    el.querySelector('.ps-checks').innerHTML = issues + zones;
    return;
  }
  const prods = productsFor(it.ref), p = it.productInfo;
  const product = prods.length ? `<div class="field ps-prod-f"><label for="psProd">Product <span>real size</span></label><select id="psProd" data-k="product"><option value="">Generic size (${esc(c.name.toLowerCase())})</option>${prods.map((q) => `<option value="${esc(q.id)}" ${q.id === it.product ? 'selected' : ''}>${esc(q.brand)} · ${esc(shortName(q.name))}${q.price != null ? ` · $${Math.round(q.price)}` : ''}${q.verified ? '' : ' · unverified'}</option>`).join('')}</select></div>` : '';
  const prodLine = p ? `<p class="ps-prodline">${productLink(p)}<span>${fmtIn(it.w)} × ${fmtIn(it.d)} × ${fmtIn(it.h)}${p.price != null ? ` · $${p.price.toLocaleString('en-US')}` : ''} · ${p.verified ? `checked ${esc(CHECKED)}` : '<span class="warnline">dimensions not confirmed</span>'}</span></p>` : '';
  const variants = c.variants ? `<div class="field"><label for="psVar">Variant</label><select id="psVar" data-k="variant">${Object.entries(c.variants).map(([k, v]) => `<option value="${esc(k)}" ${(it.variant || Object.keys(c.variants)[0]) === k ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}</select></div>` : '';
  el.innerHTML = `<div class="ps-ih"><span class="ps-sw" style="--c:#${(c.color ?? 0x888888).toString(16).padStart(6, '0')}"></span><div class="t"><b>${esc(it.name)}</b><small>${esc(r.room || '')}${c.est ? ' · size estimated' : ''}</small></div>${statePill(r.state)}<button class="icon-btn" type="button" data-a="close" aria-label="Deselect">${IC.x}</button></div>
    <div class="ps-fields" data-id="${esc(it.id)}">
      ${['w', 'd', 'h'].map((k) => `<div class="field"><label for="psF${k}">${{ w: 'Width', d: 'Depth', h: 'Height' }[k]} <span>in</span></label><input type="number" id="psF${k}" data-k="${k}" min="1" max="300" step="0.5" value="${+it[k].toFixed(1)}"></div>`).join('')}
      <div class="field"><label for="psFr">Turn <span>°</span></label><input type="number" id="psFr" data-k="rot" step="15" value="${Math.round(it.rot)}"></div>
      ${variants}${product}${it.elev || ['art', 'lamp', 'tv', 'ac'].includes(it.kind) ? `<div class="field"><label for="psFe">Off floor <span>in</span></label><input type="number" id="psFe" data-k="elev" min="0" max="140" step="0.5" value="${+(it.elev || 0).toFixed(1)}"></div>` : ''}
    </div>${prodLine}
    <div class="ps-acts">
      <button class="btn" type="button" data-a="rot" title="Turn 90° (R)">${IC.rot}Turn</button>
      <button class="btn" type="button" data-a="dup" title="Duplicate (D)">${IC.dup}Duplicate</button>
      <div class="ps-place"><select id="psRoom" aria-label="Place in room">${model.rooms.filter((x) => !['bath', 'closet'].includes(x.kind)).map((x) => `<option ${x.name === r.room ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select><button class="btn" type="button" data-a="place" title="Find the best spot in this room">${IC.place}Place</button></div>
      <button class="icon-btn" type="button" data-a="hide" title="Hide from the layout" aria-label="Hide">${IC.eyeOff}</button>
      <button class="icon-btn danger" type="button" data-a="del" title="Remove (Del)" aria-label="Remove">${IC.del}</button>
    </div>
    <div class="ps-nudge" aria-label="Nudge">${[['↑', 0, 1, 'up'], ['←', -1, 0, 'left'], ['↓', 0, -1, 'down'], ['→', 1, 0, 'right']].map(([t, x, y, n]) => `<button type="button" data-nx="${x}" data-ny="${y}" aria-label="Nudge ${n}">${t}</button>`).join('')}</div>
    <div class="ps-checks">${issues}${zones}</div>
    <p class="ps-src">${esc(c.src || '')}</p>`;
}
const statePill = (s) => `<span class="pill ${PILL[s]} ps-state">${GRADE_TXT[s]}</span>`;
const shortName = (n) => (n.split(',')[0].length >= 12 ? n.split(',')[0] : n).replace(/\s*-\s*[A-Z][a-z]+ [A-Z][a-z]+$/, '').slice(0, 52);
const productLink = (p) => { const u = safeUrl(p.url); return u ? `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(p.brand)} ${esc(shortName(p.name))}</a>` : `<b>${esc(p.brand)} ${esc(shortName(p.name))}</b>`; };
/** Swap a placed piece to a real product (or back to the generic size), keeping its back where it was. */
function useProduct(it, pid) {
  const p = pid ? PRODUCT_MAP[pid] : null;
  mutate(() => {
    if (!p) { delete it.product; delete it.w; delete it.d; delete it.h; return; }
    const next = withProduct(it, p); for (const k of Object.keys(it)) if (!(k in next)) delete it[k]; Object.assign(it, next);
  }, p ? `${p.brand} ${shortName(p.name)}: ${fmtIn(resolve(it)?.w || 0)} × ${fmtIn(resolve(it)?.d || 0)}` : 'Back to the generic size');
}
function inspClick(e) {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.flash != null) { const x = ev.items[sel]?.issues[+b.dataset.flash]; if (x) flashPoly(x.at || x.zone?.poly || null); return; }
  if (b.dataset.nx != null) { nudge(+b.dataset.nx * 3, +b.dataset.ny * 3); return; }
  const a = b.dataset.a; const it = items.find((q) => q.id === sel);
  if (a === 'close') select(null);
  else if (a === 'rot') rotateSel(90);
  else if (a === 'dup') duplicateSel();
  else if (a === 'del') removeSel();
  else if (a === 'hide' && it) mutate(() => { it.hidden = true; sel = null; }, 'Hidden. Show it again from the furniture list');
  else if (a === 'place' && it) mutate(() => { place(it, $('psRoom').value); });
}
function inspChange(e) {
  const k = e.target.dataset.k; const it = items.find((q) => q.id === sel); if (!k || !it) return;
  if (k === 'variant') { mutate(() => { it.variant = e.target.value; delete it.d; delete it.h; delete it.w; }); return; }
  if (k === 'product') { useProduct(it, e.target.value); return; }
  if (k === 'elev') { const v = parseFloat(e.target.value); if (Number.isFinite(v)) mutate(() => { it.elev = Math.max(0, Math.min(140, v)); }); return; }
  const v = parseFloat(e.target.value); if (!Number.isFinite(v)) return;
  mutate(() => { if (k === 'rot') it.rot = ((v % 360) + 360) % 360; else it[k] = Math.max(1, Math.min(300, v)); });
}

// ------------------------------------------------------------------ side tabs
function tabCounts() {
  const c = ev?.counts || {}; const n = $('psTabN-checks');
  if (n) { n.textContent = c.blocked ? c.blocked : c.tight ? c.tight : ''; n.className = `n ${c.blocked ? 'bad' : c.tight ? 'warn' : ''}`; }
  const f = $('psTabN-furniture'); if (f) f.textContent = R.filter((x) => !x.hidden).length || '';
}
function tab() {
  if (!model) return;
  $('psTabs').querySelectorAll('[data-t]').forEach((b) => { b.classList.toggle('on', b.dataset.t === st.tab); b.setAttribute('aria-selected', String(b.dataset.t === st.tab)); });
  const el = $('psTab');
  if (st.tab === 'furniture') el.innerHTML = furnitureTab();
  else if (st.tab === 'checks') el.innerHTML = checksTab();
  else if (st.tab === 'shop') el.innerHTML = shopTab();
  else if (st.tab === 'light') { el.innerHTML = '<div id="psLight"></div>'; refreshSun(); }
  else { el.innerHTML = planTab() + architecturePanel(); bindArchitecture(); }
  markCams();
}
function architecturePanel() {
  return `<details class="ps-architecture"><summary>Edit geometry assumptions</summary><p class="ps-note">Test fixture sizes, window openings or orientation. Edits are unmeasured local scenarios; the source plan stays unchanged. Dimensions below are in inches.</p><div class="field"><label for="psArchTarget">Element</label><select id="psArchTarget"><option value="orientation">Plan orientation</option>${(rawPlan.fixtures||[]).map((f,i)=>`<option value="fx:${i}">${esc(f.label||f.kind||'Fixture')} · ${i+1}</option>`).join('')}${(rawPlan.windows||[]).map((w,i)=>`<option value="win:${i}">Window · ${esc(w.room||i+1)}</option>`).join('')}</select></div><div id="psArchFields"></div><button class="btn" type="button" id="psArchApply">Apply local scenario</button></details>`;
}
function bindArchitecture() {
  const target=$('psArchTarget');if(!target)return;
  const field=(key,title,value)=>`<div class="field"><label for="psArch-${key}">${title}</label><input id="psArch-${key}" data-arch="${key}" type="number" step="0.1" value="${value==null?'':(+value).toFixed(2)}"></div>`;
  const draw=()=>{
    const [kind,index]=target.value.split(':');const i=+index;
    if(kind==='orientation')$('psArchFields').innerHTML=field('bearing','Top of plan faces · degrees from north',model.up_bearing);
    else if(kind==='fx') {
      const f=model.fixtures.find(f=>f.id===`fx${i}`);if(!f){$('psArchFields').textContent='This fixture has unresolved geometry.';return;}
      const xs=f.poly.map(p=>p[0]),ys=f.poly.map(p=>p[1]);
      $('psArchFields').innerHTML=[field('width','Width',Math.max(...xs)-Math.min(...xs)),field('depth','Depth',Math.max(...ys)-Math.min(...ys)),field('height','Height',f.height),field('reserve','Front clearance reserve',f.reserve),field('x','Plan X',Math.min(...xs)),field('y','Plan Y',Math.min(...ys))].join('');
    }else {const w=model.windows[i];$('psArchFields').innerHTML=w?[field('width','Opening width',w.len),field('sill','Sill above floor',w.sill),field('head','Window head above floor',w.head)].join(''):'Window geometry unresolved.';}
  };target.onchange=draw;draw();
  $('psArchApply').onclick=()=>{
    try {
      const values={};for(const el of $('psArchFields').querySelectorAll('[data-arch]')){if(el.value.trim()==='')throw Error('Enter a value for each dimension.');values[el.dataset.arch]=+el.value;}
      const [kind,index]=target.value.split(':');const edited=kind==='fx'?editFixture(rawPlan,+index,values):kind==='win'?editWindow(rawPlan,+index,values):editOrientation(rawPlan,values.bearing);
      const project=serialiseProject(edited,items,lightingOf(),inventory);
      saveProjectLibrary(Object.assign(Object.create(null),projectLibrary,{[st.id]:project}));
      checkpoint();rawPlan=project.plan;model=normalisePlan(rawPlan);
      G3.setModel(model);G3.setWallMode(st.wall);P2.setModel(model);LX.reattach2D();
      if(kind==='orientation') { siteProf=null; dropPlacement(); } else if (st.site && siteProf) placeOnSite(st.site, model.floor || byId(st.id)?.floor || 5);
      planOptions();$('planSel').value=st.id;persist();head();recompute({all:true});refreshSun();
      toast('Local geometry scenario applied. Undo restores the previous geometry.');
    }catch(e){toast(`Geometry unchanged: ${e.message||e}`,6000);}
  };
}
function furnitureTab() {
  const pres = model.layouts.length ? `<h3 class="label">Layouts <span>written for this plan</span></h3><div class="ps-presets">${model.layouts.map((l) => `<button type="button" class="ps-preset${st.activePreset === l.id ? ' on' : ''}" data-p="${esc(l.id)}"><b>${esc(l.name)}</b>${l.note ? `<span>${esc(l.note)}</span>` : ''}</button>`).join('')}</div>` : '';
  const list = R.length ? R.map((it) => {
    const r = ev.items[it.id], s = it.hidden ? 'off' : r?.state || 'clear';
    return `<div class="ps-item${it.id === sel ? ' on' : ''}${it.hidden ? ' off' : ''}" data-id="${esc(it.id)}"><button type="button" class="ps-ib" data-sel="${esc(it.id)}"><span class="ps-sw" style="--c:#${(it.base.color ?? 0x888888).toString(16).padStart(6, '0')}"></span><span class="t"><b>${esc(it.name)}</b><small>${fmtIn(it.w)} × ${fmtIn(it.d)}${it.hidden ? ' · hidden' : r?.room ? ` · ${esc(r.room)}` : ''}</small></span><i class="dot g-${s}" title="${s === 'off' ? 'hidden' : GRADE_TXT[s]}"></i></button><button type="button" class="icon-btn" data-vis="${esc(it.id)}" aria-label="${it.hidden ? 'Show' : 'Hide'}" title="${it.hidden ? 'Show' : 'Hide'}">${it.hidden ? IC.eyeOff : IC.eye}</button></div>`;
  }).join('') : '<p class="faint">Nothing placed yet.</p>';
  const cat = CATEGORIES.map(([k, t]) => { const refs = Object.entries(CATALOG).filter(([, c]) => c.cat === k); return refs.length ? `<div class="ps-cat"><span class="ps-cat-h">${t}</span><div class="chips">${refs.map(([r, c]) => `<button type="button" class="chip" data-add="${esc(r)}" title="${esc(c.src)}">${IC.plus}${esc(c.name)}</button>`).join('')}</div></div>` : ''; }).join('');
  const own = inventory ? inventoryHTML(inventory, { held: placedIds(inventory, items), hasPreset: model.layouts.some((l) => l.id === OWN), active: st.activePreset === OWN }) : '';   // [furniture]
  return `${own}${pres}<h3 class="label">In this layout <span>${R.filter((x) => !x.hidden).length} pieces</span></h3><div class="ps-list">${list}</div>
    <h3 class="label">Add furniture <span>real sizes, hover for the source</span></h3>${cat}
    <div class="ps-opts">${[['snap', 'Snap to walls'], ['zonesAll', 'Show every clearance zone'], ['sight', 'Show TV sightlines'], ['swings', 'Shade door swings in 3D']].map(([k, t]) => `<label class="tg ${st[k] ? 'on' : ''}"><input type="checkbox" class="sr" data-opt="${k}" ${st[k] ? 'checked' : ''}><span class="switch"></span><span class="lbl">${t}</span></label>`).join('')}</div>`;
}
function checksTab() {
  const c = ev.counts, rows = {};
  for (const r of Object.values(ev.items)) for (const [i, x] of r.issues.entries()) (rows[r.room || 'Elsewhere'] ||= []).push({ ...x, id: r.id, name: r.name, i });
  const rooms = model.rooms.filter((r) => rows[r.name] || R.some((it) => !it.hidden && ev.items[it.id]?.room === r.name));
  const roomRows = rooms.map((rm) => {
    const list = (rows[rm.name] || []).sort((a, b) => gradeRank(b.grade) - gradeRank(a.grade));
    const n = R.filter((it) => !it.hidden && ev.items[it.id]?.room === rm.name).length;
    return `<div class="ps-room"><h4>${esc(rm.name)} <span>${rm.stated ? esc(rm.stated) + ' · ' : ''}${Math.round(rm.sqft)} ft² · ${n} piece${n === 1 ? '' : 's'}</span></h4>${list.length ? `<ul class="ps-ck">${list.map((x) => `<li><button type="button" data-ck="${esc(x.id)}" data-i="${x.i}"><span class="pill ${PILL[x.grade]}">${GRADE_TXT[x.grade]}</span><span><b>${esc(x.name)}</b> ${esc(x.text)}</span></button></li>`).join('')}</ul>` : '<p class="ps-ok">Everything here fits with its clearances.</p>'}</div>`;
  }).join('');
  const fx = ev.fixtures.length ? `<h3 class="label">Fixture clearances</h3><table class="mini"><tbody>${ev.fixtures.map((f) => `<tr><td>${esc(f.fixture.label || FIX_NAMES[f.fixture.kind])}${f.fixture.est ? ' <span class="faint">est.</span>' : ''}</td><td class="num">${Math.round(f.free)}${f.grade === 'clear' ? '+' : ''} / ${f.preferred} in</td><td><span class="pill ${PILL[f.grade]}">${GRADE_TXT[f.grade]}</span></td></tr>`).join('')}</tbody></table>` : '';
  const tv = ev.tv.filter((t) => t.seats.length).length ? `<h3 class="label">TV viewing <span>${esc(TV_FOV.src.split('(')[0].trim())}</span></h3><table class="mini"><thead><tr><th>Seat</th><th class="num">Distance</th><th class="num">View</th><th></th></tr></thead><tbody>${ev.tv.flatMap((t) => t.seats.map((s) => `<tr><td>${esc(s.seat)}<br><small class="faint">${esc(t.name)}</small></td><td class="num">${(s.dist / 12).toFixed(1)} ft</td><td class="num">${Math.round(s.fov)}°${s.off > 20 ? `<br><small class="faint">${Math.round(s.off)}° off</small>` : ''}</td><td><span class="pill ${s.tag === 'ideal' ? 'good' : s.tag === 'too far' ? 'bad' : 'warn'}">${s.tag}</span></td></tr>`)).join('')}</tbody></table><p class="ps-note">Ideal is a screen filling ${TV_FOV.ideal}° to ${TV_FOV.close}° of your view: about ${(48.4 / 2 / Math.tan((TV_FOV.close / 2) * DEG) / 12).toFixed(1)} to ${(48.4 / 2 / Math.tan((TV_FOV.ideal / 2) * DEG) / 12).toFixed(1)} ft for a 55-inch set.</p>` : '';
  const rules = `<details class="ps-rules"><summary>The rules and where the numbers come from</summary><ul>${Object.values(CLEARANCE).map((x) => `<li><b>${x.min}–${x.preferred} in</b> ${esc(x.src)}</li>`).join('')}<li>Headboards should not sit against a window with a sill below the headboard; wall-mounted TVs need a solid wall behind the whole set.</li><li>Furniture in a door's swing blocks it; unknown swings get a 24 in keep-clear on both sides of the doorway.</li></ul></details>`;
  return `<p class="ps-note ps-cm">${c.blocked ? `<b class="no">${c.blocked} blocked</b> · ` : ''}${c.tight ? `<b class="unk">${c.tight} tight</b> · ` : ''}${c.clear} clear. Click a row to show it on the plan.</p>
    ${routesBlock()}${roomRows || '<p class="faint">Place some furniture to see the checks.</p>'}${tv}${fx}${rules}`;
}
function routesBlock() {
  const rs = routesRes?.routes || []; if (!rs.length) return '';
  const pill = (g) => `<span class="pill ${PILL[g]}">${GRADE_TXT[g]}</span>`;
  return `<h3 class="label">Walking from the front door <span>36 in comfortable, 30 in minimum</span></h3>
    <label class="tg ps-rt-all ${st.routes ? 'on' : ''}"><input type="checkbox" class="sr" data-opt="routes" ${st.routes ? 'checked' : ''}><span class="switch"></span><span class="lbl">Show every route on the plan</span></label>
    <ul class="ps-routes">${rs.map((r) => `<li class="${st.routeKey === r.key ? 'on' : ''}"><button type="button" class="ps-rt" data-rt="${esc(r.key)}">${pill(r.grade)}<span><b>${esc(r.label)}</b> ${esc(r.text)}${r.delivery && r.delivery.grade !== 'clear' ? `<br><small class="g-${r.delivery.grade}">${esc(r.delivery.text)}</small>` : ''}</span><span class="num">${r.reachable ? (Number.isFinite(r.width) ? `${Math.round(r.width)} in` : 'open') : '—'}</span></button>${r.reachable && r.path.length > 1 ? `<button type="button" class="icon-btn" data-tour="${esc(r.key)}" title="Walk this route at eye level" aria-label="Walk to ${esc(r.label)}">${IC.play}</button>` : ''}</li>`).join('')}</ul>
    <p class="ps-note faint">Widest path on a 2 in grid around walls, fixtures and furniture under 30 in (tucked dining chairs count). Door openings are the building's and are listed with deliveries, not counted in the width.</p>`;
}
function shopTab() {
  const list = shoppingList(R), fmt$ = (v) => `$${Math.round(v).toLocaleString('en-US')}`;
  const beds = R.filter((x) => !x.hidden && x.kind === 'bed'), target = R.find((x) => x.id === st.finder) || (sel && R.find((x) => x.id === sel && productsFor(x.ref).length)) || beds[0];
  const rows = list.rows.map((r) => `<tr><td><button type="button" class="ps-linkbtn" data-sel="${esc(r.id)}">${esc(r.name)}</button><br><small class="faint">${r.product ? productLink(r.product) : r.options ? `${r.options} product${r.options > 1 ? 's' : ''} to choose from` : 'generic size'}</small></td><td class="num">${fmtIn(r.w)} × ${fmtIn(r.d)}${r.product && !r.product.verified ? '<br><small class="warnline">unconfirmed</small>' : ''}</td><td class="num">${r.price != null ? fmt$(r.price) : '<span class="faint">—</span>'}</td></tr>`).join('');
  let finder = '';
  if (target) {
    const fr = productFinder(model, items, target.id);
    finder = `<h3 class="label">${target.kind === 'bed' ? 'Bed finder' : 'Product finder'} <span>tried in its spot</span></h3>
      ${beds.length > 1 || (target.kind !== 'bed' && beds.length) ? `<div class="chips ps-finder-pick">${[...new Map([...beds, target].map((b) => [b.id, b])).values()].map((b) => `<button type="button" class="chip ${b.id === target.id ? 'on' : ''}" data-finder="${esc(b.id)}">${esc(b.name)}</button>`).join('')}</div>` : ''}
      <ul class="ps-finder">${fr.map((x) => `<li class="${x.product.id === target.product ? 'cur' : ''}"><div class="t"><b>${productLink(x.product)}</b><small>${fmtIn(x.w)} × ${fmtIn(x.d)}${x.product.drawers?.count ? ` · ${x.product.drawers.count} drawers${x.product.drawers.pull_in ? `, ${x.product.drawers.pull_in} in deep` : ''}` : ''}${x.product.price != null ? ` · ${fmt$(x.product.price)}` : ''}${x.product.verified ? '' : ' · <span class="warnline">unconfirmed size</span>'}</small>${x.issues[0] ? `<small class="g-${x.grade}">${esc(x.issues[0])}</small>` : x.where === 'moved' ? '<small class="faint">Fits after moving it within the room</small>' : ''}</div><span class="pill ${PILL[x.grade]}">${x.where === 'moved' && x.grade === 'clear' ? 'Fits moved' : GRADE_TXT[x.grade]}</span>${x.product.id === target.product ? '<span class="pill accent">Chosen</span>' : `<button type="button" class="btn" data-use="${esc(x.product.id)}" data-for="${esc(target.id)}" data-where="${x.where}">Use</button>`}</li>`).join('')}</ul>
      <p class="ps-note faint">Storage beds need their drawers' depth plus room to kneel on every drawer side. Sizes come from each retailer's product page on ${esc(CHECKED)}; prices change.</p>`;
  }
  const chosen = list.rows.filter((r) => r.product).length;
  return `<div class="metrics ps-shop-m"><div class="metric"><div class="k">Products chosen</div><div class="v">${chosen}<small> of ${list.rows.length}</small></div></div><div class="metric"><div class="k">Priced total</div><div class="v">${list.priced ? fmt$(list.total) : '—'}</div></div></div>
    ${finder}
    <h3 class="label">Shopping list <span>pick a product in each piece's inspector</span></h3>
    <table class="mini ps-shop"><thead><tr><th>Piece</th><th class="num">Size</th><th class="num">Price</th></tr></thead><tbody>${rows || '<tr><td colspan="3" class="faint">Nothing placed yet.</td></tr>'}</tbody></table>
    <div class="ps-files"><button class="btn" type="button" data-file="csv">${IC.down}Shopping list .csv</button></div>
    <p class="ps-note faint">Dimensions are the maker's published measurements; prices are a snapshot from ${esc(CHECKED)} and change. No product photos are stored.</p>`;
}
function planTab() {
  const pv = model.provenance, L = byId(st.id);
  const unk = model.doorways.filter((d) => !d.swingDir && !['slide', 'pocket', 'none'].includes(d.swing)).length;
  const est = model.fixtures.filter((f) => f.est), estRooms = model.rooms.filter((r) => r.est);
  return `<p class="ps-srcline">${esc(model.source || 'No source given.')}</p>
    ${pv.printed.length ? `<h3 class="label">Printed on the plan</h3><ul class="ps-bul">${pv.printed.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    ${pv.estimated.length || est.length || estRooms.length ? `<h3 class="label">Estimated <span>measure these on a tour</span></h3><ul class="ps-bul warn">${pv.estimated.map((x) => `<li>${esc(x)}</li>`).join('')}${est.length ? `<li>${est.map((f) => esc(f.label || FIX_NAMES[f.kind])).join(', ')}</li>` : ''}${estRooms.length ? `<li>Room sizes: ${estRooms.map((r) => esc(r.name)).join(', ')}</li>` : ''}</ul>` : ''}
    <table class="mini ps-rooms"><thead><tr><th>Room</th><th>Printed</th><th class="num">Drawn</th></tr></thead><tbody>${model.rooms.map((r) => `<tr><td>${esc(r.name)}</td><td>${esc(r.stated || '—')}</td><td class="num">${Math.round(r.sqft)} ft²</td></tr>`).join('')}</tbody></table>
    <div class="metrics ps-pm"><div class="metric"><div class="k">Ceiling</div><div class="v">${fmtIn(model.ceiling)}</div></div><div class="metric"><div class="k">Windows</div><div class="v">${model.windows.length}</div></div><div class="metric"><div class="k">Doors</div><div class="v">${model.doorways.length}${unk ? `<small>${unk} swing unknown</small>` : ''}</div></div></div>
    ${pv.match || pv.checked ? `<p class="faint ps-note">Plan match: ${esc(pv.match || '?')}${pv.floor_band ? ` · floors ${esc(pv.floor_band)}` : ''}${pv.checked ? ` · checked ${esc(pv.checked)}` : ''}</p>` : ''}
    <p class="faint ps-note">Plan file: <span class="mono">plans/${esc(st.id)}.json</span>${model.schema === 1 ? ' (schema 1: rectangles; upgrade to schema 2 for doors, fixtures and layouts)' : ''}. Format: <span class="mono">docs/guides/floor-plans.md</span>.${L ? '' : ''}</p>
    <div class="ps-files"><button class="btn" type="button" data-file="save">${IC.down}Save layout</button><button class="btn" type="button" data-file="load">${IC.up}Load layout</button><button class="btn" type="button" data-file="glb">Export .glb</button><button class="btn ghost" type="button" data-file="preset">Copy as preset</button><button class="btn ghost" type="button" data-file="compare">Compare plans</button></div>`;
}
function tabClick(e) {
  const b = e.target.closest('button, [data-sel]'); if (!b) return;
  if (b.dataset.p) applyPreset(b.dataset.p);
  else if ('invUse' in b.dataset) useOwn();
  else if (b.dataset.invAdd) addOwn(b.dataset.invAdd);
  else if (b.dataset.sel) { select(b.dataset.sel === sel ? null : b.dataset.sel); markList(); }
  else if (b.dataset.vis) { const it = items.find((q) => q.id === b.dataset.vis); if (it) mutate(() => { it.hidden = !it.hidden; if (it.hidden && sel === it.id) sel = null; }); }
  else if (b.dataset.add) addRef(b.dataset.add);
  else if (b.dataset.ck) { select(b.dataset.ck); const x = ev.items[b.dataset.ck]?.issues[+b.dataset.i]; flashPoly(x?.at || x?.zone?.poly || null); }
  else if (b.dataset.file) fileAction(b.dataset.file);
  else if (b.dataset.rt) { st.routeKey = st.routeKey === b.dataset.rt ? null : b.dataset.rt; overlays(); tab(); }
  else if (b.dataset.tour) walkRoute(b.dataset.tour);
  else if (b.dataset.finder) { st.finder = b.dataset.finder; tab(); }
  else if (b.dataset.use) {
    const it = items.find((q) => q.id === b.dataset.for), p = PRODUCT_MAP[b.dataset.use]; if (!it || !p) return;
    if (b.dataset.where === 'moved') { const row = productFinder(model, items, it.id).find((x) => x.product.id === p.id); if (row) mutate(() => { for (const k of Object.keys(it)) if (!(k in row.item)) delete it[k]; Object.assign(it, row.item); }, `${p.brand} ${shortName(p.name)}, moved to fit`); }
    else useProduct(it, p.id);
  }
}
/** Guided eye-level walk from the front door along an access route. */
function walkRoute(key) {
  const r = routesRes?.routes.find((x) => x.key === key); if (!r || r.path.length < 2) return;
  if (st.mode === '2d') setMode(isPhone() ? '3d' : 'both');
  st.routeKey = key; st.view = 'tour'; overlays(); markCams();
  G3.tour([routesRes.start, ...r.path], { onEnd: () => { st.view = 'walk'; markCams(); } });
  toast(`Walking to the ${r.label.toLowerCase()}: ${r.text.charAt(0).toLowerCase() + r.text.slice(1)}`);
}
function tabChange(e) {
  const k = e.target.dataset.opt; if (!k) return;
  st[k] = e.target.checked; e.target.closest('.tg')?.classList.toggle('on', st[k]); overlays();
}
function setMood(m) { st.mood = m; store.set('plan-mood', m); G3.setMood(m); document.querySelectorAll('[data-mood]').forEach((b) => { b.classList.toggle('on', b.dataset.mood === m); b.setAttribute('aria-pressed', String(b.dataset.mood === m)); }); refreshSun(); }
const MOODS = [['auto', 'Auto'], ['day', 'Day'], ['evening', 'Evening'], ['night', 'Night']];

// ------------------------------------------------------------------ sun
function sunPanel() {
  const y = +st.date.slice(0, 4), mi = S.crit.search?.move_in?.earliest ? String(S.crit.search.move_in.earliest).slice(0, 10) : null;
  $('ptimePanel').innerHTML = `<div class="ps-sunrow">
      <button class="icon-btn ps-play" type="button" id="pPlay" aria-label="Play the day">${IC.play}</button>
      <div class="field ps-date"><label for="pDate">Date</label><input type="date" id="pDate" value="${st.date}"></div>
      <div class="field ps-time"><label for="pTime">Sun at <span class="val" id="pTimeV"></span></label><input type="range" id="pTime" min="300" max="1230" step="5" value="${st.min}"></div>
      <div class="seg ps-mood" id="pMood" role="group" aria-label="Lights">${MOODS.map(([k, t]) => `<button type="button" data-mood="${k}" class="${st.mood === k ? 'on' : ''}" aria-pressed="${st.mood === k}" title="${k === 'auto' ? 'Day while the sun is up, lamps after dark' : k === 'night' ? 'Lamps on, no daylight' : k === 'evening' ? 'Low daylight and lamps' : 'Daylight, lamps off'}">${t}</button>`).join('')}</div>
      <div class="seg ps-quick" id="pQuick">${[[mi, 'Move-in'], [`${y}-12-21`, 'Dec 21'], [`${y}-03-20`, 'Mar 20'], [`${y}-06-21`, 'Jun 21']].filter((q) => q[0]).map(([d, t]) => `<button type="button" data-d="${d}">${t}</button>`).join('')}</div>
    </div>`;
  $('pDate').addEventListener('change', (e) => { if (e.target.value) { st.date = e.target.value; refreshSun(); } });
  $('pTime').addEventListener('input', (e) => { st.min = +e.target.value; refreshSun(); });
  $('pQuick').addEventListener('click', (e) => { const b = e.target.closest('[data-d]'); if (!b) return; st.date = b.dataset.d; $('pDate').value = st.date; refreshSun(); });
  $('pMood').addEventListener('click', (e) => { const b = e.target.closest('[data-mood]'); if (b) setMood(b.dataset.mood); });
  $('pPlay').addEventListener('click', () => { st.playing = !st.playing; $('pPlay').innerHTML = st.playing ? IC.pause : IC.play; $('pPlay').classList.toggle('on', st.playing); });
}
function refreshSun() {
  if (!model) return;
  const lat = st.site?.origin?.lat ?? S.crit.search?.map_center?.[0] ?? 40.75, lon = st.site?.origin?.lon ?? S.crit.search?.map_center?.[1] ?? -73.98;
  const tz = st.site?.timezone || S.crit.search?.timezone || 'America/New_York';
  const [y, m, d] = st.date.split('-').map(Number);
  const s = sunPos(zonedMs(y, m - 1, d, st.min, tz), lat, lon);
  sunCtx = { lat, lon, tz, y, m, d };   // [room3d]
  { const u = document.querySelector('#psLook .rc-strip u'); if (u) u.style.left = `${stripAt(st.min)}%`; if (sunMemo.key && !sunMemo.key.startsWith(st.date)) lookChips(); }
  const sunny = st.site?.study?.sunshine?.fraction;   // [feature J] lighting tab: the sun now and the place's sunshine table
  LX.refresh({ az: s.az, alt: s.alt, lat, lon, tz, y, m, d, fraction: Array.isArray(sunny) && sunny.length === 12 ? sunny.map(Number) : SUNSHINE[S.crit.search?.city]?.fraction || null, place: st.site?.study?.sunshine?.place || (SUNSHINE[S.crit.search?.city] ? SUNSHINE[S.crit.search.city].place : '') });
  // per-window city occlusion when the plan is placed on its site: only the windows a neighbour blocks lose their sun
  const perWin = up_(s) && winSky && winSky.length === model.windows.length ? model.windows.map((w, i) => windowBlocked(winSky, i, s)) : null;
  const up = s.alt > 0, blocked = perWin ? perWin.every(Boolean) : up && siteProf && s.alt <= hAt(siteProf, s.az);
  G3.setWindowShade(perWin || []);
  const withheld = winSky && winSky.length === model.windows.length ? model.windows.map((w, i) => windowWithheld(winSky, i)) : [];   // [model project]
  const nWh = withheld.filter(Boolean).length, nBlk = perWin ? perWin.filter((b, i) => b && !withheld[i]).length : 0;
  const mk = `${st.date}|${winSky ? winSky.length : 0}`;
  if (winSky && mk !== winMinKey) { winMinKey = mk; winMin = windowMinutes(winSky, model, y, m - 1, d, lat, lon, tz); }
  const placementKnown=!st.site||!!siteProf;
  const light = lightState({ bearing:placementKnown?model.up_bearing:null, altitude:s.alt, blocked:!!blocked, directSun:st.directSun, ambient:st.ambient });
  const rel = (s.az - (model.up_bearing ?? 0)) * DEG, ca = Math.cos(s.alt * DEG);
  const gz = glazingScale({ transmittance: st.glazing, blinds: st.blinds });
  G3.setLighting({ambient:light.ambient, sun:gz.sun, through:gz.through});
  G3.setSun({ x: Math.sin(rel) * ca, y: Math.cos(rel) * ca, up: Math.sin(s.alt * DEG) }, light.directional, up);
  const tv = $('pTimeV'); if (tv) tv.textContent = fmtT(st.min);
  const t = $('pTime'); if (t) t.style.setProperty('--p', `${((st.min - 300) / 930) * 100}%`);
  const lamps = R.filter((x) => !x.hidden && x.kind === 'lamp').length + LX.count(), mn = G3.moodNow();
  $('phud').innerHTML = `<span>${esc(st.date)} ${fmtT(st.min)}${mn !== 'day' ? ` · ${mn === 'night' ? 'night' : 'evening'}, ${lamps ? `${lamps} lamp${lamps > 1 ? 's' : ''} on` : 'no lamps placed'}` : ''}</span><span class="${light.directional ? 'lit' : 'shade'}">${!placementKnown ? 'Window placement unresolved · direct sun withheld' : !light.orientationKnown ? 'Orientation unknown · direct sun unresolved' : !up ? 'Night' : blocked ? (perWin ? 'Every window shaded by neighbours' : 'Site observation point shaded') : nWh && nWh === model.windows.length ? 'Windows not in open air · sun withheld' : nBlk ? `Sun blocked at ${nBlk} of ${perWin.length} windows${nWh ? ` · ${nWh} withheld` : ''}` : !st.directSun ? 'Direct sun hidden in preview' : `Sun ${Math.round(s.alt)}° up, ${compass(s.az)}`}</span>`;
  const el = $('psLight'); if (!el) return;
  if (!el.querySelector('#psLightResults')) {
    el.innerHTML = `<div class="ps-light-controls"><label class="tg"><input id="psDirectSun" type="checkbox"> Show directional sunlight</label>${onSite ? `<label class="tg ps-city-tg"><input id="psCityTg" type="checkbox"> Show the city in the bird’s-eye view too</label>` : ''}<div class="field"><label for="psAmbient">Background light preview <span id="psAmbientValue"></span></label><input id="psAmbient" type="range" min="0" max="2" step="0.05"></div><p class="ps-note faint">Background intensity is a display preference, not measured brightness or lux.</p>
      <div class="ps-glaze"><div class="label">Glass and blinds <span class="pill">Preview</span></div>
        <div class="field"><label for="psGlazing">Glazing transmittance <span id="psGlazingValue"></span></label><input id="psGlazing" type="range" min="0.05" max="1" step="0.05" aria-describedby="psGlazeNote"></div>
        <div class="seg ps-blinds" id="psBlinds" role="group" aria-label="Blinds">${Object.entries(BLINDS_LABEL).map(([k, t]) => `<button type="button" data-b="${k}" aria-pressed="false">${t}</button>`).join('')}</div>
        <p class="ps-note faint" id="psGlazeNote">Assumed: ${GLAZING_DEFAULT} is typical double glazing; half blinds pass about half the light, closed about a tenth. Scales the sun patches and the daylight estimate; not a material model.</p></div></div><div id="psLightResults"></div><div id="psLightX" class="lx-host"></div>`;
    const saveLight=()=>{store.set(`plan-light.${S.base}.${st.id}`,lightingOf());if(projectLibrary[st.id])persist();refreshSun();};
    $('psGlazing').oninput=e=>{st.glazing=clampGlazing(+e.target.value);saveLight();};
    $('psBlinds').onclick=e=>{const b=e.target.closest('[data-b]');if(!b)return;st.blinds=blindsOf(b.dataset.b);saveLight();};
    $('psDirectSun').onchange=e=>{st.directSun=e.target.checked;saveLight();};
    $('psAmbient').oninput=e=>{st.ambient=+e.target.value;saveLight();};
    $('psCityTg')?.addEventListener('change', (e) => { st.city = e.target.checked; store.set(`plan-city.${S.base}`, st.city); applyCity(); });
    el.addEventListener('toggle', (e) => { if (e.target.classList?.contains('ps-anchor')) { st.anchorOpen = e.target.open; if (e.target.open) refreshSun(); } }, true);   // [model project]
  }
  if ($('psCityTg')) $('psCityTg').checked = !!st.city;
  $('psDirectSun').checked=st.directSun;
  $('psDirectSun').disabled=!light.orientationKnown;
  $('psAmbient').value=st.ambient;
  $('psAmbientValue').textContent=st.ambient.toFixed(2)+'×';
  $('psGlazing').value=st.glazing; $('psGlazingValue').textContent=st.glazing.toFixed(2);
  $('psGlazing').style.setProperty('--p', `${((st.glazing - 0.05) / 0.95) * 100}%`);
  $('psBlinds').querySelectorAll('[data-b]').forEach((b) => { const on = b.dataset.b === st.blinds; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
  const dfOpts = LX.dfOptions(), sky = windowSky(), rooms = sky ? roomDaylight(model, sky, { transmittance: st.glazing, blinds: st.blinds, ...dfOpts }) : [];
  const rows = model.windows.map((w, wi) => {
    const reach=windowReach({bearing:w.bearing,sunAzimuth:s.az,altitude:s.alt,head:w.head,orientationKnown:light.orientationKnown,blocked:perWin ? perWin[wi] : !!blocked});
    const status={'orientation-unknown':'Orientation unresolved',night:'Night','site-blocked':perWin ? 'Shaded by neighbours' : 'Site observation point shaded',behind:'Sun behind this wall',unresolved:'Window dimensions unresolved'}[reach.state];
    const today = winMin && winMin[wi] != null && light.orientationKnown ? hmShort(winMin[wi]) : '—';
    return `<tr><td>${esc(w.room || 'Window')}${w.note ? `<br><small class="faint">${esc(w.note)}</small>` : ''}</td><td class="num">${light.orientationKnown ? Math.round(w.bearing)+'° '+compass(w.bearing) : 'Unknown'}</td><td>${withheld[wi] ? '<span class="faint">Not in open air here · sun withheld</span>' : reach.inches!=null ? `<span>${fmtIn(reach.inches)} unoccluded reach</span>` : `<span class="faint">${status}</span>`}</td>${winSky ? `<td class="num">${today}</td>` : ''}</tr>`;
  }).join('');
  $('psLightResults').innerHTML = `<p class="ps-sunline">${esc(st.date)} at ${fmtT(st.min)}: sun ${Math.round(s.az)}° ${compass(s.az)}, ${up ? Math.round(s.alt) + '° up' : 'below the horizon'}.</p>
    ${st.site && onSite ? anchorNoteHTML({ onSite, model, site: st.site, siteId: st.id, base: S.base, floor: onSite.floor, planSource: projectLibrary[st.id] ? 'local scenario' : 'file', planLabel: projectLibrary[st.id] ? 'Local plan project' : '', open: !!st.anchorOpen }) : ''}
    ${!light.orientationKnown ? `<p class="ps-note">${!placementKnown ? 'The city model does not resolve a valid window observation point for this edited plan. Re-establish its placement before interpreting sunlight.' : 'Confirm the plan orientation to enable directional sunlight. No north-facing assumption is applied.'}</p>` : ''}
    <table class="mini"><thead><tr><th>Window</th><th class="num">Faces</th><th>Geometric estimate</th>${winSky ? '<th class="num">Sun today</th>' : ''}</tr></thead><tbody>${rows}</tbody></table>
    ${daylightTable(rooms, sky)}
    <p class="ps-note faint">${winSky ? `Each window has its own skyline from the city model: the plan's window wall is placed on the ${Math.round(onSite.az)}° facade at the site's window position, floor ${esc(model.floor || byId(st.id)?.floor || '?')}, so a neighbour in front of one window shades only that window. Where the unit sits along the facade is an assumption.` : siteProf ? 'Neighbour shading uses one assumed observation point from the city model. It does not resolve each individual window or a multi-facade apartment.' : 'No resolved neighbouring-window observation point is available for this plan.'} Floor reach is an unoccluded projection from window-head height, not actual room penetration. Walls and furniture can intercept it. Rendered shadows are approximate. Glass and blinds are preview multipliers, the daylight factor is an overcast-sky estimate, and clouds, reflections and real photometry are not simulated.</p>`;
  LX.panel($('psLightX'));   // [feature J] daylight grid, inputs, luminaires, annual summary
}

/** Sky view (CIE overcast, relative) per plan window: its own skyline when placed on the site, else the one assumed point. */
function windowSky() {
  if (!model || (st.site && !siteProf)) return null;
  if (winSky && winSky.length === model.windows.length) {
    if (winSkyView?.src !== winSky) winSkyView = { src: winSky, v: model.windows.map((w, i) => (winSky[i] ? skyView(winSky[i].prof, w.bearing) : null)) };
    return winSkyView.v;
  }
  if (siteProf && model.up_bearing != null) return model.windows.map((w) => skyView(siteProf, w.bearing));
  return null;
}
function daylightTable(rooms, sky) {
  const dfOpts = LX.dfOptions();
  if (!sky) return '<p class="ps-note faint">No city model for this plan, so its sky view and daylight are unknown.</p>';
  if (!rooms.length) return '';
  const gz = glazingScale({ transmittance: st.glazing, blinds: st.blinds });
  return `<h3 class="label ps-df-h">Estimated daylight factor <span class="pill">Preview</span></h3>
    <table class="mini ps-df"><thead><tr><th>Room</th><th class="num">Glass</th><th class="num" title="Share of an unobstructed window's overcast-sky light">Sky view</th><th class="num">DF est.</th></tr></thead><tbody>${rooms.map((r) => `<tr><td>${esc(r.room)}</td><td class="num">${r.glazed_m2.toFixed(1)} m²</td><td class="num" title="visible sky angle ${Math.round(r.theta)}°">${Math.round((r.theta / 90) * 100)}%</td><td class="num"><b>${r.df < 1 ? r.df.toFixed(2) : r.df.toFixed(1)}%</b></td></tr>`).join('')}</tbody></table>
    <p class="ps-note faint">Average daylight factor (BRE formula T·Aw·θ / A(1 − R²)) from this plan's room and window sizes, the sky each window sees under an overcast sky (θ = 90° × sky view), ${Math.round(gz.through * 100)}% of light through glass and blinds, ${Math.round(dfOpts.glazed * 100)}% of each opening glazed (frame factor), reflectance ${dfOpts.custom ? 'from the surfaces set under Daylight' : '0.5 (model default)'}. For comparing rooms and settings: not a measurement, not lux.${winSky ? '' : ' One assumed observation point stands in for every window.'}</p>`;
}
// ------------------------------------------------------------------ the plan on its site (per-window skylines, city outside)
const up_ = (s) => s.alt > 0;
const hmShort = (min) => { if (!min) return 'none'; const h = Math.floor(min / 60), mm = Math.round(min % 60); return h && mm ? `${h} h ${String(mm).padStart(2, '0')}` : h ? `${h} h` : `${mm} m`; };
function placeOnSite(site, floor) {
  try { const pin = getPin(st.id, { base: S.base }); onSite = placePlan(site, model, pin?.floor ?? floor, { anchor: pinOption(pin) }); winSky = onSite ? windowSkylines(onSite, model) : null; } catch { onSite = winSky = null; }
  winMin = null; winMinKey = ''; cityKey = '';
  if (ready) applyCity();
}
function dropPlacement() { onSite = winSky = winMin = null; winMinKey = ''; cityKey = ''; G3.setWindowShade([]); applyCity(); }
function applyCity() {
  if (!ready) return;
  // [interior] the real city outside is always there from inside (every eye-level view); the toggle is for the bird's-eye view
  const eye = G3.viewMode() === 'eye', want = !!onSite && (eye || st.city), key = `${eye ? 'eye' : 'orbit'}|${document.documentElement.dataset.theme}`;
  if (!want) { if (G3.hasCity()) G3.setCity(null); cityKey = ''; return; }
  if (cityKey === key && G3.hasCity()) return;
  cityKey = key;
  const dark = document.documentElement.dataset.theme !== 'light', css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const colors = eye ? { low: '#7f8996', high: '#b9c2cf', roof: '#dde1e7', own: css('--accent'), ground: '#6e7378' }
    : { low: dark ? css('--surface-3') : css('--ink-4'), high: css('--ink-3'), roof: dark ? css('--ink-3') : css('--surface-1'), own: css('--accent'), ground: dark ? css('--surface-1') : css('--surface-3') };
  G3.setCity(cityGroup(onSite, { daylight: eye, light: eye || !dark, colors }));
}
let cityKey = '';

// ------------------------------------------------------------------ frame loop
function frame() {
  requestAnimationFrame(frame);
  if ($('view-plan').hidden || !model) return;
  if (st.playing) { st.min += 3; if (st.min > 1230) st.min = 300; const t = $('pTime'); if (t) t.value = st.min; refreshSun(); }
  if (flash && performance.now() > flashT) { flash = null; overlays(); }
  const now = performance.now(), dt = Math.min(0.05, (now - (lastFrame || now)) / 1000); lastFrame = now;
  if (held.size && G3.viewMode() === 'eye') {
    const h = (k) => held.has(k), v = (h('shift') ? 72 : 36) * dt; // inches per second: a stroll, or a brisk walk
    const fwd = (h('w') || h('arrowup') ? v : 0) - (h('s') || h('arrowdown') ? v : 0), turn = ((h('d') || h('arrowright') ? 1 : 0) - (h('a') || h('arrowleft') ? 1 : 0)) * 1.6 * dt, side = ((h('e') ? 1 : 0) - (h('q') ? 1 : 0)) * v;
    if (fwd || turn || side) G3.walk(fwd, turn, side);
  }
  G3.render();
}
