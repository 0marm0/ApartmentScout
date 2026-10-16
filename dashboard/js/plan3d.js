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
import { chooseHome, homeToRemember, SAVED_KEY } from './features/default-home.js';   // the home the 3D views open: address, session, renter's last, search default
import { editFixture, editWindow, editOrientation } from './plan/architecture.js';
import { canonicalFaces, snapPosition } from './unit/scenario.js';
import { placePlan, windowSkylines, windowBlocked, windowMinutes, windowWithheld } from './plan/city.js';
import { effectiveComponents } from './unit/parts.js';   // [model project] source parts + the assumed override, same as Unit 3D
import { resolveCal, geoFromSite, measuredFromSite } from './unit/calibration.js';   // [model project] measured vs estimated height
import { getPin, pinOption } from './unit/anchor.js';   // [model project] the window pinned in Unit 3D
import { facingSummary } from './plan/facing.js';   // [model project] host facade bearing, bays as a range
import { anchorNoteHTML } from './plan/anchor-note.js';   // [model project] where the plan sits, source vs assumed
import { cityGroup } from './plan/citymesh.js';
import { Player, dayRange, minuteAt, progressOf, yearFrame, yearProgress, sunSentence, unionSegs, segMinutes, sunNow, MONTH_NAMES } from './city3d/timeplay.js';   // [daycycle] play the day and the year
import { mountPlayBar } from './city3d/playbar.js';
import { seasonLabel, SEASON_NOTE } from './city3d/season.js';
import { roomQuality as roomQ } from './room3d/quality.js';
import { phoneClass as phoneQ } from './features/render-quality.js';
import { lateAt } from './city3d/facade-rules.js';   // [daycycle] how late the evening is: fewer lit windows
import { seasonAt, quantise } from './city3d/season.js';   // [season] leaves, autumn colour and bare branches follow the date (a picture only)
import { sunGroupHTML, stripAt, setHandoff } from './room3d/sunlink.js';   // [room3d] sun today in the studio's eye-level views, and the way into Unit 3D
import { accuracyRows, accuracyChip, loadFurnitureMeta } from './room3d/accuracy.js';   // [room3d] the measured-vs-assumed chip, shared with Unit 3D
import { accessRoutes, entryPoint } from './plan/route.js';
import { PRODUCT_MAP, productsFor, shoppingList, shoppingCSV, CHECKED } from './plan/products.js';
import { productFinder, withProduct } from './plan/shop.js';
import { suggestLayout } from './plan/suggest.js';
import { planEmpty, missingNotice } from './features/plan-empty.js';   // [feature C] empty state and missing-plan notice
import { renderOptions } from './plan/options.js';
import { mountDock } from './room3d/dock.js';   // [phone] the time slider within thumb reach
import * as Q3 from './plan/quality3d.js';   // [feature J] render quality (Fast / Visual) and progressive export
import * as RUI from './render/ui.js';   // [render] "Render a photo" and "Make a video" (the renderers load when a button is pressed)
import * as LX from './plan/lighting-ui.js';   // [feature J] daylight grid, glass/surface inputs, luminaires, annual summary
G3.setRealLampsProbe(() => LX.count() > 0);   // [daycycle] a luminaire placed in the Light tab replaces the assumed ceiling lights
import { validateInventory, fitInventory, pieceItem, placedIds } from './plan/inventory.js';   // [furniture] the renter's own pieces
import { inventoryHTML } from './plan/inventory-ui.js';
import { createAr, sectionHTML as arSectionHTML } from './plan/ar-ui.js';   // [ar] View in your room (AR): AR Quick Look on iPhone and iPad, .usdz and .glb downloads elsewhere
import { mountSelbar } from './plan/selbar.js';   // [furniture] the floating toolbar beside the selected piece
import { resolveLayout, applyInventory, savedLayoutFor, samePlaces, chooseGroup } from './plan/placement.js';   // [placement] one rule for where the pieces stand, shared with Unit 3D
import { allViews, stepView, windowGroups } from './plan/viewpoints.js';   // [interior] where to stand to look out of the windows
import { setLookChips, bindLookChips } from './plan/look-ui.js';
import { EYE_IN, nearestWindow, windowStands, windowHit, groupOfWindow } from './plan/walkcore.js';   // [walk] click to walk, go to the window
import { mountStudioMeasure } from './measure/studio-hook.js';   // [measure] the measuring tape, 2D and 3D
import { isMetricSearch } from './measure/core.js';
import { parsePiece, fitReport, pieceFromItem, withPiece, roomKindAt } from './plan/tryfit.js';   // [fit] does it fit?
import { tryFitHTML, fitCardHTML, parseNote } from './plan/tryfit-ui.js';
import { followAttached, isAttachable, isAttached, nearestDesk, seatAtDesk } from './plan/attach.js';   // the office chair goes with its desk (layout item `attach`)
import { choiceState, applyChoice, groupsOf } from './plan/choices.js';   // [bed option] my bed / the storage bed / no bed, saved with the layout
import { reportFor } from './plan/bedfit.js';
import { mountBedControl } from './plan/bed-ui.js';

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
const gone = new Map();   // the pieces of "Your furniture" the renter removed this visit, as they stood: "Add back" and "Shown" put them where they were
let removed = new Set();   // [placement] pieces of the default layout the renter took out (they are not put back)
let inventory = null;   // [furniture] "Your furniture": the renter's pieces (furniture.json, or the ones a project carried)
let MEAS = null;   // [measure]
let model = null, rawPlan = null, projectLibrary = Object.create(null), siteProf = null, items = [], R = [], ev = null, sel = null, flash = null, flashT = 0, loop = false, ready = false;
const undo = [], redo = [];
const isPhone = () => matchMedia('(max-width: 760px)').matches;
const key = (id) => `plan.${S.base}.${id}`;
/** One raw layout item as the studio checks it: the inventory's size and look joined on, then the catalogue's. */
const resolveOne = (it) => resolve(applyInventory([it], inventory)[0]);
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
  window.__plan3d = { get views() { return viewsNow(); }, get cam() { return G3.getCamera(); }, get eye() { return G3.viewMode(); }, get touring() { return G3.touring(); }, get eyeAt() { return G3.eyeState(); }, get marker() { return G3.parts().scene.getObjectByName('walk-marker')?.visible === true; }, canStand: (x, y) => G3.canStand(x, y), get hasCity() { return G3.hasCity(); }, get cityApi() { return G3.cityApi(); }, get parts() { return G3.parts(); }, get view() { return st.view; }, get items() { return applyInventory(items, inventory); }, get raw() { return items; }, get inventory() { return inventory; } };   // `items` as drawn (the inventory's sizes and look joined); `raw` as saved   // [interior] test and debugging handle, like __unit3d
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
            <hr><button type="button" role="menuitem" data-f="ar-usdz">Furnished room for AR<span>.usdz</span></button>
            <button type="button" role="menuitem" data-f="glb">Export 3D model<span>.glb</span></button>
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
            <div class="float ps-cams" id="psCams" role="group" aria-label="Camera">${[['bird', 'Bird’s eye'], ['top', 'Top'], ['bed', 'From bed'], ['sofa', 'From sofa'], ['door', 'From door'], ['walk', 'Walk'], ['window', 'To window']].map(([k, t]) => `<button type="button" data-v="${k}">${t}</button>`).join('')}</div>
            <div class="float ps-walls" id="psWalls" role="group" aria-label="Walls">${[['cut', 'Cut'], ['full', 'Full'], ['outline', 'Outline']].map(([k, t]) => `<button type="button" data-w="${k}">${t}</button>`).join('')}</div>
            <button type="button" class="float ps-full" id="psFull" title="Full screen" aria-label="Full screen" aria-pressed="false"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.5 2.5h4v4M6.5 13.5h-4v-4M13.5 2.5l-4.5 4.5M2.5 13.5L7 9"/></svg></button>
            <div class="float ps-look" id="psLook" role="toolbar" aria-label="Look out of the windows" hidden></div>
            <div class="hud" id="phud"></div>
            <div class="ps-hint" id="psHint"></div>
          </div>
        </div>
        <div class="panel ps-sun" id="ptimePanel"></div>
      </div>
      <aside class="ps-side">
        <div class="panel ps-insp" id="psInsp"></div>
        <div class="panel ps-fit" id="psFit" hidden></div>
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
  const asked = homeToRemember({ want: id, ids });   // a home the address names is the renter's own choice: remember it, it beats the default
  id = chooseHome({ want: id, current: st.id, saved: store.get(SAVED_KEY, null), preferred: S.manifest.default_listing, ids });
  if (asked) store.set(SAVED_KEY, asked);
  $('planSel').value = id;
  if (id !== st.id) await load(id); else syncFromStore();   // [bed option] a choice made in Unit 3D is picked up when the studio comes back
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
  if (!ready) { G3.init($('pgl'), $('pstage'), () => {}); P2.mount($('p2d'), { item: (i) => R.find((x) => x.id === i), select, move: dragTo, commit: () => commit(), locked: () => !!MEAS?.two.active }); bind3D(); mountBars(); mountBedUI(); ready = true; mountMeasure(); LX.attach3D(); Q3.mount({ stage: $('pstage'), model: () => model, toast, store }); mountDock($('pstage'), { min: 300, max: 1230, step: 5, get: () => st.min, set: (v) => { pausePlay(false); st.min = v; const t = $('pTime'); if (t) t.value = String(v); refreshSun(); }, text: () => fmtT(st.min), playing: () => !!st.playing, toggle: () => togglePlay('day') }); mountRenderStudio(); }   // [phone] [render]
  G3.setModel(model); G3.setWallMode(st.wall);
  P2.setModel(model); LX.reattach2D(); Q3.modelChanged(); if (st.mode !== '2d') Q3.opened();   // [feature J] [quality]
  st.city = !!store.get(`plan-city.${S.base}`, false); applyCity();
  // furniture: the saved layout for this plan, else the first preset
  const libLayout = projectLibrary[id]?.layout, savedV = libLayout ? validateLayout(libLayout, { planId: id, lenient: true }) : savedLayoutFor(store, S.base, id);   // [placement] the renter's saved layout, piece by piece
  const light = projectLibrary[id]?.lighting || store.get(`plan-light.${S.base}.${id}`, {});
  st.directSun = light.directSun !== false;
  st.ambient = typeof light.ambient === 'number' && Number.isFinite(light.ambient) ? Math.max(0, Math.min(2, light.ambient)) : 1;
  st.glazing = clampGlazing(light.glazing); st.blinds = blindsOf(light.blinds);
  LX.load(light);   // [feature J] daylight inputs and luminaires
  inventory = await loadInventory(id);   // [furniture]
  if (!model.layouts.length) { try { model.layouts.push(inventory ? ownLayout() : suggestLayout(model)); } catch { /* a plan the placer cannot handle keeps no preset */ } }
  const lay = resolveLayout({ model, inventory, saved: savedV?.ok ? savedV : null });   // [placement] the saved layout, the plan's default for what is not placed, a fit for what has no place yet
  items = lay.items; removed = new Set(lay.removed);
  undo.length = 0; redo.length = 0; sel = null; cancelCompare(); $('psCompare').hidden = true; st.routeKey = null; st.finder = null; routesRes = null;
  G3.setMood(st.mood);
  st.activePreset = lay.source === 'default' ? model.layouts[0]?.id || null : null;
  stamp = layoutStamp();
  if (lay.changed) persist();   // [placement] a layout that was filled in or brought up to date is saved, so it stays as shown
  head(); setMode(st.mode); setWall(st.wall, true); G3.setView(st.view === 'top' ? 'top' : 'bird'); markCams();
  recompute({ all: true }); sunPanel(); refreshSun();
}

/** [measure] The tape in both panes: a bridge of getters, nothing is copied. */
// ------------------------------------------------------------------ [render] photo and video
const VIEW_NAME = { bird: 'Bird\u2019s eye', top: 'Top', bed: 'From the bed', sofa: 'From the sofa', door: 'From the door', walk: 'Walking', tour: 'Walking', window: 'To the window' };
function mountRenderStudio() {
  const sunAltAt = (min) => {
    const c = sunCtx || (() => { const [y, m, d] = st.date.split('-').map(Number); return { y, m, d, lat: st.site?.origin?.lat ?? S.crit.search?.map_center?.[0] ?? 40.75, lon: st.site?.origin?.lon ?? S.crit.search?.map_center?.[1] ?? -73.98, tz: st.site?.timezone || S.crit.search?.timezone || 'America/New_York' }; })();
    return sunPos(zonedMs(c.y, c.m - 1, c.d, min, c.tz), c.lat, c.lon).alt;
  };
  RUI.mountRender({
    id: 'plan', container: (() => { const bar = document.createElement('div'); bar.className = 'float rnd-bar'; bar.setAttribute('role', 'group'); bar.setAttribute('aria-label', 'Photo and video'); $('pstage').appendChild(bar); return bar; })(), store,
    host: async () => (model && G3.parts().renderer && $('pgl').clientWidth ? (await import('./render/hosts.js')).planHost(G3) : null),
    info: () => ({ stem: `${st.id}-${st.view || 'view'}-${st.date}-${String(Math.floor(st.min / 60)).padStart(2, '0')}${String(Math.round(st.min % 60)).padStart(2, '0')}`, title: `${model?.title || st.id} \u00b7 ${VIEW_NAME[st.view] || 'Floor plan'}`, when: `${st.date}, ${fmtT(st.min)}`, date: st.date }),
    video: {
      plan: () => model, space: () => G3.walkFloor(), altAt: sunAltAt, range: [300, 1230], minute: () => st.min,
      prepare() {
        pausePlay(false);
        const cam0 = G3.saveCamera(), min0 = st.min;
        G3.setMood('auto');   // the light follows the sun's height, whichever mood is chosen: golden hour is golden
        return () => { st.min = min0; const t = $('pTime'); if (t) t.value = String(min0); G3.restoreCamera(cam0); G3.setMood(st.mood); refreshSun(); markCams(); };
      },
      applyPose: (p) => G3.poseEye(p),
      setMinute: (m) => { st.min = m; const t = $('pTime'); if (t) t.value = String(m); refreshSun(true); },
    },
  });
}
function mountMeasure() {
  MEAS = mountStudioMeasure({
    G3, canvas: $('pgl'), stage3d: $('pstage'), stage2d: $('p2dWrap'), svg: $('p2d'), toolbar3d: $('psCams'), toolbar2d: $('psDims'),
    toPlan: (x, y) => P2.toPlan(x, y), id: () => st.id, model: () => model, items: () => R,
    show3d: () => st.mode !== '2d', show2d: () => st.mode !== '3d', metric: () => isMetricSearch(S.crit, model), store, base: S.base,
  });
}
// [furniture] "Your furniture" (furniture.json beside the search, or the inventory a project carried)
let fileInventory;
async function loadInventory(id) {
  if (projectLibrary[id]?.inventory) return withExtras(projectLibrary[id].inventory);
  if (fileInventory === undefined) {
    const raw = S.manifest.furniture ? await loadJSON(`${S.base}/furniture.json`, null) : null, v = raw && validateInventory(raw);
    fileInventory = v?.ok ? v.inventory : null;
  }
  return withExtras(fileInventory);
}
/** [fit] Pieces the renter added to their furniture list in this browser (the file beside the search is not touched), kept across plans. */
const extrasKey = () => `furniture-extra.${S.base}`;
function withExtras(inv) {
  const extra = store.get(extrasKey(), []);
  if (!Array.isArray(extra) || !extra.length) return inv;
  const next = extra.reduce((acc, p) => withPiece(acc, p), inv), v = validateInventory(next);
  return v.ok ? v.inventory : inv;
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
const snapshot = () => JSON.stringify({items,removed:[...removed],plan:rawPlan,siteProfile:siteProf?Array.from(siteProf):null,lighting:lightingOf()});
function checkpoint() { undo.push(snapshot()); if (undo.length > 80) undo.shift(); redo.length = 0; markUndo(); }
function persist() {
  store.set(key(st.id), serialiseLayout(st.id, items, { removed: [...removed] })); stamp = layoutStamp();
  if(projectLibrary[st.id]) {
    const project=serialiseProject(rawPlan,items,lightingOf(),inventory,{removed:[...removed]});
    try{saveProjectLibrary(Object.assign(Object.create(null),projectLibrary,{[st.id]:project}));}
    catch(e){toast('Browser project could not be saved. Export a complete project backup.',6000);}
  }
}
function commit() { persist(); markUndo(); recompute({ panels: true }); }

// [bed option] The Bed control, in the 2D plan and in the 3D view: my bed, the storage bed the renter may buy, or no bed. The choice is each piece's own `hidden`
// mark (plan/choices.js), so it is saved with the layout, undone with it and read by Unit 3D; switching never moves a piece.
let bedUIs = [], bedCache = { key: '', rep: null }, stamp = '';
const layoutStamp = () => { try { return JSON.stringify(store.get(key(st.id), null)); } catch { return ''; } };
const groupState = (g) => (inventory && model ? choiceState(items, inventory, g, { removed }) : null);   // the Bed / Sim rig / Office chair switches stay while their group exists, even after the piece was hidden or removed
const bedState = () => groupState('bed');
function bedReport() {
  if (!inventory || !model) return null;
  const k = `${model.id}|${items.map((x) => `${x.id}:${x.x},${x.y},${x.rot},${x.w || ''},${x.d || ''}`).join(';')}`;
  if (bedCache.key !== k) bedCache = { key: k, rep: reportFor(model, items, inventory) };
  return bedCache.rep;
}
function setBed(choice, group = 'bed') {   // group 'sim' (the sim rig) or 'chair' (the office chair): shown or hidden, the same way (a piece's hidden mark)
  if (!inventory) return;
  const r = chooseGroup(items, inventory, group, choice, { model, gone });   // a removed piece comes back at its saved spot (or is fitted)
  if (!r.changed) return;
  checkpoint(); items = r.items; for (const id of r.restored) { removed.delete(id); gone.delete(id); }
  if (sel && !items.some((x) => x.id === sel && !x.hidden)) sel = null;
  commit();
}
function mountBedUI() {
  const o = { state: bedState, report: bedReport, piece: () => inventory?.pieces.find((p) => p.id === 'bed-latitude') || null, choose: (c) => setBed(c),
    rig: { state: () => groupState('sim'), choose: (c) => setBed(c, 'sim') },
    chair: { state: () => groupState('chair'), choose: (c) => setBed(c, 'chair') } };
  bedUIs = [mountBedControl($('p2dWrap'), { ...o, where: 'in-p2d' }), mountBedControl($('pstage'), { ...o, where: 'in-p3d' })];
}
/** The saved layout changed behind this view's back (the Bed control in Unit 3D wrote it): take it up. */
function syncFromStore() {
  if (!model || layoutStamp() === stamp) return false;
  const savedV = savedLayoutFor(store, S.base, st.id);
  if (!savedV?.ok) return false;
  const lay = resolveLayout({ model, inventory, saved: savedV });
  items = lay.items; removed = new Set(lay.removed); stamp = layoutStamp();
  if (sel && !items.some((x) => x.id === sel)) sel = null;
  recompute({ all: true });
  return true;
}
function markUndo() { $('psUndo').disabled = !undo.length; $('psRedo').disabled = !redo.length; }
function doUndo(back = true) {
  const from = back ? undo : redo, to = back ? redo : undo; if (!from.length) return;
  to.push(snapshot());
  const saved=JSON.parse(from.pop());items=saved.items;removed=new Set(saved.removed||[]);
  if(saved.plan) {
    rawPlan=saved.plan;model=normalisePlan(rawPlan);G3.setModel(model);G3.setWallMode(st.wall);P2.setModel(model);LX.reattach2D();
    siteProf=Array.isArray(saved.siteProfile)?Float64Array.from(saved.siteProfile):null;
    if(st.site && siteProf)placeOnSite(st.site,model.floor||byId(st.id)?.floor||5);
    else dropPlacement();
  }
  if(saved.lighting) {st.directSun=saved.lighting.directSun;st.ambient=saved.lighting.ambient;st.glazing=clampGlazing(saved.lighting.glazing);st.blinds=blindsOf(saved.lighting.blinds);LX.load(saved.lighting);}
  if (sel && !items.some((x) => x.id === sel)) sel = null;
  if(projectLibrary[st.id])projectLibrary[st.id]=serialiseProject(rawPlan,items,lightingOf(),inventory,{removed:[...removed]});
  persist(); markUndo(); recompute({ all: true });
  refreshSun();head();
}

/** Re-resolve, re-check and redraw. opts.all rebuilds every 3D item; opts.panels redraws the side. */
/** [ar] What can be shown in AR: the whole layout, and each placed piece (a signature says when its file is stale). */
const arSig = (it, pos) => JSON.stringify([it.ref, it.w, it.d, it.h, it.elev, it.variant, it.product, it.look, it.set, ...(pos ? [Math.round(it.x * 2), Math.round(it.y * 2), Math.round(it.rot)] : [])]);
function arEntries() {
  const list = R.filter((x) => !x.hidden); if (!list.length) return [];
  return [{ key: 'room', label: `${model?.title || 'Furnished room'}, furnished`, sig: list.map((x) => `${x.id}:${arSig(x, true)}`).join(';') }, ...list.map((x) => ({ key: x.id, label: x.name, sig: arSig(x, false) }))];
}
const ar = createAr({ entries: arEntries, build: (ids) => G3.arModel(ids) });
let attachPrev = [];   // where every piece stood at the last recompute: a desk that moved takes the chairs attached to it along (plan/attach.js)
function followDesks() {
  const next = followAttached(attachPrev, items);
  if (next !== items) { items = next; if (!st.dragging) persist(); }
  attachPrev = items.map((x) => ({ id: x.id, x: x.x, y: x.y, rot: x.rot, attach: x.attach }));
}
function recompute(opts = {}) {
  if (!model) return;
  followDesks();
  R = applyInventory(items, inventory).map((x) => resolve(x)).filter(Boolean);   // [furniture] the inventory's size, colour, material and desk set ride on each piece
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
  ensureBars(); bedUIs.forEach((b) => b.update());   // [bed option]
  MEAS?.changed();   // [measure]
  fitCard();   // [fit]
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

// [furniture] The toolbar beside the selected piece, one in each pane (the 2D plan and the 3D view), kept on the piece while the
// camera moves or the plan is panned or zoomed.
let bars = null, barLoop = 0;
function mountBars() {
  const on = { rot: () => rotateSel(90), free: rotateTo, move: (dx, dy) => nudge(dx, dy), dup: () => duplicateSel(), del: () => removeSel(), done: () => select(null), attach: () => toggleAttach() };
  bars = { p2: mountSelbar($('p2dWrap'), on), p3: mountSelbar($('pstage'), on) };
}
function syncBars() {
  const it = bars && sel ? R.find((x) => x.id === sel && !x.hidden) : null;
  if (!it) { bars?.p2.hide(); bars?.p3.hide(); return; }
  const info = { name: it.label || it.name, rot: it.rot, attach: isAttachable(it) ? { on: isAttached(items, it.id) } : null }, shown = (id) => $(id).offsetWidth > 0;
  const r2 = shown('p2dWrap') ? P2.screenRect(it) : null, r3 = shown('pstage') && G3.viewMode() === 'orbit' && !st.dragging ? G3.screenRect(it.id) : null;
  if (r2) bars.p2.show(r2, info); else bars.p2.hide();
  if (r3) bars.p3.show(r3, info); else bars.p3.hide();
}
function ensureBars() {
  if (!sel || barLoop) { if (!sel) syncBars(); return; }
  const tick = () => { syncBars(); barLoop = sel ? requestAnimationFrame(tick) : 0; };
  barLoop = requestAnimationFrame(tick);
}

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
  it.x = Math.round(x); it.y = Math.round(y); it.placed = true;   // [placement] the renter put it here
  if (st.snap) snapToWalls(it);
  recompute({ panels: false });
}
function snapToWalls(it) {
  const r = resolveOne(it); if (!r) return;
  const gaps = gapRays(model, [...R.filter((q) => q.id !== it.id), r], it.id, 6);
  for (const g of gaps) if (g.d > 0.05 && g.d < 4) { it.x += g.u[0] * (g.d - 0.05); it.y += g.u[1] * (g.d - 0.05); }
  it.x = Math.round(it.x * 10) / 10; it.y = Math.round(it.y * 10) / 10;
}
function endDrag() { if (st.dragging) { st.dragging = false; commit(); } }

function mutate(fn, msg) { checkpoint(); fn(); persist(); recompute({ all: true }); if (msg) toast(msg); }
/** Rotate the selected piece to any angle: live while a dial is dragged (one undo step), settled when it is let go. */
function rotateTo(deg, live) {
  const it = items.find((q) => q.id === sel); if (!it) return;
  const set = () => { it.rot = ((Math.round(deg) % 360) + 360) % 360; it.placed = true; };
  if (live) { if (!st.rotating) { checkpoint(); st.rotating = true; } set(); persist(); recompute({ panels: false }); }
  else if (st.rotating) { st.rotating = false; commit(); }
  else mutate(set);
}
function rotateSel(d) { const it = items.find((q) => q.id === sel); if (it) mutate(() => { it.rot = ((Math.round(it.rot || 0) + d) % 360 + 360) % 360; it.placed = true; }); }
function nudge(dx, dy) { const it = items.find((q) => q.id === sel); if (!it) return; if (!st.nudging) { checkpoint(); st.nudging = true; } it.x += dx; it.y += dy; it.placed = true; persist(); recompute({ panels: false }); clearTimeout(st.nudgeT); st.nudgeT = setTimeout(() => { st.nudging = false; tab(); }, 500); }
/** The office chair: attached to its desk (it moves and turns with it, snapped to the desktop) or free (drag it anywhere, duplicate it). */
function toggleAttach() {
  const it = items.find((q) => q.id === sel); if (!it || !isAttachable(it)) return;
  if (isAttached(items, it.id)) { mutate(() => { delete it.attach; }, 'Separate: the chair is free to drag anywhere'); return; }
  const desk = nearestDesk(items, it), dr = desk && R.find((x) => x.id === desk.id);
  if (!dr) { toast('There is no desk in this layout to attach it to'); return; }
  const aside = items.some((x) => x.ref === 'sim-rig' && !x.hidden);
  mutate(() => { Object.assign(it, seatAtDesk(dr, { aside }), { attach: desk.id, placed: true }); }, 'Attached to the desk: it moves and turns with it');
}
function removeSel() { const it = items.find((q) => q.id === sel); if (!it) return; const n = resolveOne(it)?.name || it.ref; mutate(() => { removed.add(it.id); gone.set(it.id, { ...it }); items = items.filter((q) => q.id !== sel); for (const q of items) if (q.attach === it.id) delete q.attach; sel = null; }, `Removed ${n.toLowerCase()}`); }
function duplicateSel() {
  const it = items.find((q) => q.id === sel); if (!it) return;
  const copy = { ...it, id: newId(it.ref, items), x: it.x + 12, y: it.y - 12, placed: true, from: it.from || it.id }; delete copy.attach; delete copy.hidden;   // a copy is a separate piece, an exact copy of its source: `from` joins it to the same inventory piece (size, look, set); an attached chair stays with its own desk
  mutate(() => { items.push(copy); place(copy, roomOf(model, [it.x, it.y]), true); sel = copy.id; });
}
function addRef(ref) {
  const c = CATALOG[ref]; if (!c) return;
  const want = sel ? ev.items[sel]?.room : null;
  const room = want || (model.rooms.find((r) => r.kind === ({ sleep: 'bedroom', work: 'bedroom', storage: 'bedroom' }[c.cat] || 'living')) || [...model.rooms].sort((a, b) => b.area - a.area)[0]).name;
  const rm = model.rooms.find((r) => r.name === room);
  const it = { id: newId(ref, items), ref, x: Math.round(rm.label[0]), y: Math.round(rm.label[1]), rot: 0, placed: true };
  mutate(() => { items.push(it); const ok = place(it, room, true); sel = it.id; toast(ok ? `Added ${c.name.toLowerCase()} to the ${room.toLowerCase()}` : `No clear spot for the ${c.name.toLowerCase()} in the ${room.toLowerCase()}; it is in the middle`); });
}
/** Auto-place an item in a room; returns the grade or null. Mutates the item. */
function place(it, room, quiet = false) {
  const all = applyInventory(items, inventory).map((x) => resolve(x)).filter(Boolean);
  const s = findSpot(model, all, it.id, room);
  if (s) { it.x = Math.round(s.x * 10) / 10; it.y = Math.round(s.y * 10) / 10; it.rot = s.rot; it.placed = true; }
  if (!quiet) toast(s ? (s.grade === 'clear' ? `Placed in the ${room.toLowerCase()}` : `Placed in the ${room.toLowerCase()}, with a ${s.grade} clearance`) : `No spot in the ${room.toLowerCase()} fits it with the rest where it is`);
  return s ? s.grade : null;
}
function applyPreset(lid) {
  const L = model.layouts.find((l) => l.id === lid); if (!L) return;
  // [placement] choosing a layout is the renter placing every piece in it
  mutate(() => { items = L.items.map((x) => ({ ...x, placed: true })); removed = new Set(); sel = null; st.activePreset = lid; }, `Layout: ${L.name}`);
}
/** [furniture] Use the plan's "Your furniture" layout, or fit the renter's pieces into this plan with the checks. */
function useOwn() {
  if (!inventory) return;
  if (!model.layouts.some((l) => l.id === OWN)) { try { model.layouts.unshift(ownLayout()); } catch (e) { toast(`Could not fit your furniture: ${e.message || e}`, 4200); return; } }
  applyPreset(OWN);
}
/** [furniture] Bring one of the renter's pieces back or add it: a hidden piece is shown, a removed one returns to the spot it had, a piece never placed is fitted. */
function showOwn(pid) {
  const p = inventory?.pieces.find((q) => q.id === pid); if (!p) return;
  const g = groupsOf(inventory).find((x) => x.choices.some((c) => c.pieces.includes(pid))), c = g?.choices.find((x) => x.pieces.includes(pid));
  const it = items.find((q) => q.id === pid);
  if (g && c && (!it || it.hidden)) { setBed(c.id, g.id); st.activePreset = null; toast(`${p.label || p.ref} shown`); return; }   // an option group's piece comes back through its own switch
  if (it) { if (it.hidden) mutate(() => { delete it.hidden; }, `${p.label || p.ref} shown`); return; }
  addOwn(pid);
}
/** [furniture] Add one of the renter's pieces (its own size) to the layout, placed in the kind of room it lives in. */
function addOwn(pid) {
  const p = inventory?.pieces.find((q) => q.id === pid); if (!p || items.some((q) => q.id === pid)) return;
  const room = (model.rooms.filter((r) => r.kind === (p.room === 'dining' ? 'living' : p.room)).sort((a, b) => b.area - a.area)[0] || [...model.rooms].sort((a, b) => b.area - a.area)[0]);
  const was = gone.get(pid), it = was ? { ...was, placed: true } : { id: p.id, ref: p.ref, x: Math.round(room.label[0]), y: Math.round(room.label[1]), rot: 0, placed: true };   // [placement] size, label and look come from the inventory; a piece the renter removed returns to its spot
  delete it.hidden;
  mutate(() => { removed.delete(it.id); gone.delete(it.id); items.push(it); const ok = was ? true : place(it, room.name, true); sel = it.id; st.activePreset = null; toast(ok ? `Added ${(p.label || p.ref).toLowerCase()} to the ${room.name.toLowerCase()}` : `No clear spot in the ${room.name.toLowerCase()}; it is in the middle`); });
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
  $('psFull').addEventListener('click', () => { const el = $('pstage'); if (document.fullscreenElement) document.exitFullscreen?.(); else el.requestFullscreen?.().catch(() => {}); });
  document.addEventListener('fullscreenchange', () => $('psFull')?.setAttribute('aria-pressed', String(document.fullscreenElement === $('pstage'))));
  $('psWalls').addEventListener('click', (e) => { const b = e.target.closest('[data-w]'); if (b) setWall(b.dataset.w); });
  bindLookChips($('psLook'), { pick: lookAt, order: () => viewsNow().map((v) => v.key) });   // [interior]
  $('psLook').addEventListener('click', (e) => { if (e.target.closest('[data-act="unit-sun"]')) openInUnit(); else if (e.target.closest('[data-act="to-window"]')) goToWindow(); });   // [room3d] [walk]
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
    mutate(() => { items = r.layout.items.map((x) => ({ ...x, placed: x.placed ?? true })); removed = new Set(r.layout.removed || []); sel = null; st.activePreset = null; }, `Loaded ${r.layout.items.length} pieces`);
  });
  document.addEventListener('keydown', keys);
  $('psInsp').addEventListener('click', inspClick);
  $('psInsp').addEventListener('change', inspChange);
  $('psTab').addEventListener('click', tabClick);
  $('psTab').addEventListener('input', tfInput); $('psTab').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'tfText') { e.preventDefault(); tfDrop('text'); } });
  $('psFit').addEventListener('click', fitClick);
  $('psTab').addEventListener('change', tabChange);
  $('psCompare').addEventListener('click', (e) => { if (e.target.closest('[data-cmp=close]')) { cancelCompare(); $('psCompare').hidden = true; } });
}
function markDims() { $('psDims').querySelectorAll('[data-dm]').forEach((b) => b.classList.toggle('on', b.dataset.dm === st.dims)); }
function setMode(m) {
  st.mode = m; $('psPanes').dataset.mode = m;
  $('psMode').querySelectorAll('[data-m]').forEach((b) => b.classList.toggle('on', b.dataset.m === m));
  MEAS?.changed();   // [measure]
  const reframe = () => { G3.resize(); if (model && G3.viewMode() === 'orbit') G3.setView(st.view === 'top' ? 'top' : 'bird'); G3.markDirty(); };
  if (ready) { reframe(); requestAnimationFrame(reframe); if (m !== '2d') Q3.opened(); }   // [quality] the 3D pane is showing: time its first frames
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
  const hints = { walk: 'Click the floor to walk there · drag to look · hold W S or ↑ ↓ to walk, A D to turn, Q E to sidestep, Shift to hurry · double-click a window to stand at it · Esc to stop', tour: 'Walking the route · drag or W A S D to take over · Esc to stop', bed: 'Drag to look around · scroll to move', sofa: 'Drag to look around · scroll to move', door: 'Drag to look around · scroll to move' };
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
  const cand = new Set((inventory?.pieces || []).filter((p) => p.candidate).map((p) => p.id)), own = items.filter((x) => !cand.has(x.id)).length;   // [bed option] a candidate purchase is not one of the renter's pieces
  const key = [st.id, !!st.site, onSite?.floor, onSite?.t, onSite?.az, onSite?.cal?.state, !!inventory, own, !!furnMeta].join('|');
  if (key === accKey) return; accKey = key;
  accUI.update(accuracyRows({ site: st.site || {}, plan: model, cal: onSite ? { state: onSite.cal.state, fh: onSite.cal.fh, slab: onSite.slab } : null, floor: onSite?.floor, facing: onSite?.az ?? null, t: onSite?.t ?? null,
    furniture: own && inventory ? { name: furnMeta?.name || inventory.name, confirmed: furnMeta?.confirmed || null, count: own, looks: furnMeta?.looks || null, candidates: furnMeta?.candidates || [] } : items.length ? { name: 'A starter layout', confirmed: null, count: items.length } : null }));
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
  el.hidden = !setLookChips(el, viewsNow(), G3.viewMode() === 'eye' ? st.view : null, { extra: ex.html, extraKey: ex.key, walk: true });
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
// [walk] Click the floor to walk there, drag to look, a floor marker where a click will take you, and one click to stand at the nearest window.
const EYE_PITCH = -0.02;
/** Walk from where the eye is to a plan point around the furniture and through the doors, as a smooth glide. `dir` / `pitch` say how to face on arrival. */
function walkTo(p, { dir = null, pitch = null, speed = 72 } = {}) {
  const sp = G3.walkFloor(); if (!sp || G3.viewMode() !== 'eye') return false;
  const route = sp.route(G3.eyeState().at, p, { maxGoal: dir ? 8 : 36 }); if (!route || route.length < 2) return false;
  st.view = 'walk'; markCams();
  const goal = route[route.length - 1];
  G3.setMarker(goal);
  return G3.tour(route, { speed, h: EYE_IN, smooth: true, endDir: dir, endPitch: pitch, onEnd: () => { st.view = 'walk'; G3.setMarker(null); markCams(); overlays(); } });
}
/** Stand at the nearest window looking out: by walking there when already at eye level, else straight to it from the front door. */
function goToWindow(group = null) {
  if (!model) return;
  const sp = G3.walkFloor(); if (!sp) return;
  const from = G3.viewMode() === 'eye' ? G3.eyeState().at : entryDoor().at;
  const spot = group != null ? (() => { const s0 = windowStands(model, sp).find((q) => q.group === group); const r = s0 && sp.route(from, s0.at, { maxGoal: 6 }); return s0 && r ? { ...s0, route: r } : null; })() : nearestWindow(model, sp, from);
  if (!spot) { toast('No clear floor to stand at that window'); return; }
  if (st.mode === '2d') setMode(isPhone() ? '3d' : 'both');
  if (G3.viewMode() === 'eye') { walkTo(spot.at, { dir: spot.dir, pitch: EYE_PITCH }); return; }
  st.view = 'walk';
  G3.setView('look', { at: spot.at, dir: spot.dir, h: EYE_IN, pitch: EYE_PITCH, fov: 76 }); setWall('full', true);
  applyCity(); overlays(); markCams();
}
/** A click on the floor in an eye-level view: walk there (the marker shows where first). */
function clickWalk(e) {
  const fp = G3.floorPoint(e); if (!fp) return false;
  const sp = G3.walkFloor(), at = sp && sp.snap(fp[0], fp[1], 30); if (!at) return false;
  return walkTo(at);
}
let markerAt = 0;
function hoverMarker(e) {
  const now = performance.now(); if (now - markerAt < 40) return; markerAt = now;
  const fp = G3.floorPoint(e), sp = G3.walkFloor(), at = fp && sp ? sp.snap(fp[0], fp[1], 30) : null;
  G3.setMarker(at);
}
function windowDouble(e) {
  if (G3.viewMode() !== 'eye' || !model) return;
  const { o, d } = G3.rayPlan(e), hit = windowHit(model, o, d); if (!hit) return;
  const g = groupOfWindow(model, hit.index); if (g >= 0) goToWindow(g);
}
function camera(v) {
  if (!model) return;
  if (st.mode === '2d') setMode(isPhone() ? '3d' : 'both');
  st.view = v;
  if (v === 'bird' || v === 'top') { G3.setView(v); setWall(G3.currentWallMode(), true); }
  else if (v === 'window') { goToWindow(); return; }
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
  if (f === 'save') saveBlob(new Blob([JSON.stringify(serialiseLayout(st.id, items, { removed: [...removed] }), null, 2)], { type: 'application/json' }), `${st.id}-layout.json`);
  else if(f==='project-save') {
    try { const project=serialiseProject(rawPlan,items,lightingOf(),inventory,{removed:[...removed]});saveBlob(new Blob([JSON.stringify(project,null,2)],{type:'application/json'}),`${st.id}-project.json`); }
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
  } else if (f === 'ar-usdz') {
    if (!arEntries().length) { toast('Place some furniture first.'); return; }
    try { toast('Building the AR model…'); const a = await ar.download('room', 'usdz'); toast(`Saved the furnished room (${a.size.map((m) => Math.round((m / 0.0254 / 12) * 10) / 10).join(' × ')} ft, true size). Open it on an iPhone or iPad for AR.`, 5200); } catch (e) { toast(`Export failed: ${e.message || e}`, 4000); }
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
  } else if (f === 'options') openOptions(); else if (f === 'clear') mutate(() => { for (const q of items) { removed.add(q.id); gone.set(q.id, { ...q }); } items = []; sel = null; }, 'Cleared. Undo brings it back');
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
    const id = MEAS?.three.active ? null : G3.pick(e);   // [measure] with the tape out a click on a piece measures it
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
    if (e.buttons === 0 && G3.viewMode() === 'eye' && e.target === cv && e.pointerType === 'mouse') hoverMarker(e);   // [walk] where a click will take you
  }, true);
  const up = (e) => {
    if (lookP && e.pointerId === lookP.id) { const moved = down ? Math.hypot(e.clientX - down.x, e.clientY - down.y) : 99; lookP = null; if (moved < 5 && e.type === 'pointerup' && e.target === cv) clickWalk(e); down = null; return; }   // [walk] a click, not a drag
    if (drag && e.pointerId === drag.pid) { drag = null; G3.setOrbitEnabled(true); cv.style.cursor = ''; endDrag(); return; }
    if (down && e.pointerId === down.id && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 4 && e.target === cv && G3.viewMode() === 'orbit' && !G3.pick(e)) select(null);
    down = null;
  };
  stage.addEventListener('pointerup', up, true); stage.addEventListener('pointercancel', up, true);
  stage.addEventListener('pointerleave', () => { if (G3.viewMode() === 'eye' && !G3.touring()) G3.setMarker(null); });
  cv.addEventListener('dblclick', windowDouble);   // [walk] double-click a window: stand at it, looking out
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
    ${isAttachable(it) ? `<label class="ps-attach"><input type="checkbox" data-k="attach" ${isAttached(items, it.id) ? 'checked' : ''}><span>Attached to desk <small>moves and turns with it</small></span></label>` : ''}
    <div class="ps-acts">
      <button class="btn" type="button" data-a="rot" title="Turn 90° (R)">${IC.rot}Turn</button>
      <button class="btn" type="button" data-a="dup" title="Duplicate (D)">${IC.dup}Duplicate</button>
      <div class="ps-place"><select id="psRoom" aria-label="Place in room">${model.rooms.filter((x) => !['bath', 'closet'].includes(x.kind)).map((x) => `<option ${x.name === r.room ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select><button class="btn" type="button" data-a="place" title="Find the best spot in this room">${IC.place}Place</button></div>
      <button class="icon-btn" type="button" data-a="hide" title="Hide from the layout" aria-label="Hide">${IC.eyeOff}</button>
      <button class="icon-btn danger" type="button" data-a="del" title="Remove (Del)" aria-label="Remove">${IC.del}</button>
    </div>
    <div class="ps-nudge" aria-label="Nudge">${[['↑', 0, 1, 'up'], ['←', -1, 0, 'left'], ['↓', 0, -1, 'down'], ['→', 1, 0, 'right']].map(([t, x, y, n]) => `<button type="button" data-nx="${x}" data-ny="${y}" aria-label="Nudge ${n}">${t}</button>`).join('')}</div>
    <div class="ps-ar" data-ar="${esc(it.id)}"></div>
    <div class="ps-checks">${issues}${zones}</div>
    <p class="ps-src">${esc(c.src || '')}</p>`;
  ar.touch();
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
  }, p ? `${p.brand} ${shortName(p.name)}: ${fmtIn(resolveOne(it)?.w || 0)} × ${fmtIn(resolveOne(it)?.d || 0)}` : 'Back to the generic size');
}
function inspClick(e) {
  if (ar.onClick(e, toast)) return;
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
  if (k === 'attach') { toggleAttach(); return; }
  if (k === 'variant') { mutate(() => { it.variant = e.target.value; delete it.d; delete it.h; delete it.w; }); return; }
  if (k === 'product') { useProduct(it, e.target.value); return; }
  if (k === 'elev') { const v = parseFloat(e.target.value); if (Number.isFinite(v)) mutate(() => { it.elev = Math.max(0, Math.min(140, v)); }); return; }
  const v = parseFloat(e.target.value); if (!Number.isFinite(v)) return;
  mutate(() => { if (k === 'rot') it.rot = ((v % 360) + 360) % 360; else it[k] = Math.max(1, Math.min(300, v)); });
}

// ------------------------------------------------------------------ [fit] does it fit?
const tf = { text: '', pick: '', room: null };
const tfState = () => { if (!model.rooms.some((r) => r.name === tf.room)) tf.room = (sel && ev?.items[sel]?.room) || [...model.rooms.filter((r) => r.kind === 'living')].sort((a, b) => b.area - a.area)[0]?.name || model.rooms[0].name; return tf; };
function tfInput(e) {
  const f = e.target.dataset.tfField; if (!f) return;
  tf[f] = e.target.value;
  if (f === 'text') { const n = parseNote(tf.text), el = $('tfNote'); if (el) { el.className = `tf-note ${n.tone}`; el.innerHTML = n.html; } }
}
/** Drop a typed piece, or a catalogue piece or product, into the chosen room, auto-placed where it fits best. */
function tfDrop(which) {
  const room = model.rooms.find((r) => r.name === tfState().room); if (!room) return;
  let spec;
  if (which === 'text') {
    const p = parsePiece(tf.text);
    if (!p.ok) { toast(p.error, 5200); $('tfText')?.focus(); return; }
    spec = { ref: p.ref, label: p.label, w: p.w, d: p.d, h: p.h, note: p.heightGiven ? '' : ` (height ${fmtIn(p.h)} assumed)` };
  } else {
    const v = tf.pick || ''; if (!v) { toast('Pick a piece or a product first.'); return; }
    if (v.startsWith('p:')) { const pr = PRODUCT_MAP[v.slice(2)]; if (!pr) return; spec = { ref: pr.ref, product: pr.id, label: `${pr.brand} ${shortName(pr.name)}`.slice(0, 80) }; }
    else { const ref = v.slice(2); if (!CATALOG[ref]) return; spec = { ref }; }
  }
  const it = { id: newId(spec.ref, items), ref: spec.ref, x: Math.round(room.label[0]), y: Math.round(room.label[1]), rot: 0 };
  for (const k of ['w', 'd', 'h', 'label', 'product']) if (spec[k] != null) it[k] = spec[k];
  mutate(() => {
    items.push(it); const g = place(it, room.name, true); sel = it.id; st.activePreset = null;
    const nm = (it.label || CATALOG[it.ref].name).toLowerCase();
    toast(g ? `Dropped the ${nm} into the ${room.name.toLowerCase()}${g === 'clear' ? '' : `, with a ${g} clearance`}. Drag it where you want it: the card shows whether it fits${spec.note || ''}` : `No spot in the ${room.name.toLowerCase()} fits the ${nm} with the rest where it is; it is in the middle, and the card shows what is in the way${spec.note || ''}`, 5200);
  });
}
function addToList() {
  const it = R.find((x) => x.id === sel); if (!it) return;
  const piece = pieceFromItem(it, roomKindAt(model, [it.x, it.y]), { source: `Added in the Floor plan studio on ${new Date().toISOString().slice(0, 10)}` });
  const v = validateInventory(withPiece(inventory, piece));
  if (!v.ok) { toast(`Could not add it to your furniture list: ${v.error}`, 5200); return; }
  const extra = store.get(extrasKey(), []);
  store.set(extrasKey(), [...(Array.isArray(extra) ? extra.filter((p) => p.id !== piece.id) : []), piece].slice(-60));
  inventory = v.inventory; persist(); tab(); fitCard();
  toast(`${piece.label} is in your furniture list, saved in this browser. Download furniture.json to keep it with the search.`, 5200);
}
function downloadList() { if (inventory) saveBlob(new Blob([JSON.stringify(inventory, null, 2)], { type: 'application/json' }), 'furniture.json'); }
function fitClick(e) {
  const b = e.target.closest('[data-tf]'); if (!b) return;
  const a = b.dataset.tf;
  if (a === 'drop-text') tfDrop('text'); else if (a === 'drop-pick') tfDrop('pick'); else if (a === 'add') addToList(); else if (a === 'download') downloadList();
}
/** The answer for the selected piece, under the inspector. The cheap parts follow every drag; the walk from the front door is worked out once it settles. */
let fitT = 0, fitWalk = null;
function fitCard() {
  const el = $('psFit'); if (!el || !model) return;
  const it = sel && R.find((x) => x.id === sel && !x.hidden);
  clearTimeout(fitT);
  if (!it) { el.hidden = true; el.innerHTML = ''; return; }
  const key = `${sel}|${R.map((x) => `${x.id}:${Math.round(x.x * 10)},${Math.round(x.y * 10)},${x.rot},${x.w},${x.d},${x.elev || 0}`).join(';')}`;
  const walk = fitWalk?.key === key ? fitWalk : null;
  const rep = fitReport(model, R, sel, { ev, reach: 96, routesAfter: walk?.after, routesBefore: walk?.before });
  const inList = !!inventory?.pieces.some((p) => p.id === sel);
  el.innerHTML = fitCardHTML(rep, { inList, walkPending: !walk }); el.hidden = false;
  if (!walk) fitT = setTimeout(() => {
    if (st.dragging) { fitCard(); return; }
    try { fitWalk = { key, after: routesRes || accessRoutes(model, R), before: accessRoutes(model, R.filter((x) => x.id !== sel)) }; } catch { fitWalk = { key, after: null, before: null }; }
    fitCard();
  }, 380);
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
  if (st.tab === 'furniture') { el.innerHTML = furnitureTab(); ar.touch(); }
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
      const project=serialiseProject(edited,items,lightingOf(),inventory,{removed:[...removed]});
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
    return `<div class="ps-item${it.id === sel ? ' on' : ''}${it.hidden ? ' off' : ''}" data-id="${esc(it.id)}"><button type="button" class="ps-ib" data-sel="${esc(it.id)}"><span class="ps-sw" style="--c:#${(it.base.color ?? 0x888888).toString(16).padStart(6, '0')}"></span><span class="t"><b>${esc(it.name)}</b><small>${fmtIn(it.w)} × ${fmtIn(it.d)}${it.hidden ? ' · hidden' : r?.room ? ` · ${esc(r.room)}` : ''}</small></span><i class="dot g-${s}" title="${s === 'off' ? 'hidden' : GRADE_TXT[s]}"></i></button><button type="button" class="icon-btn" data-vis="${esc(it.id)}" aria-label="${it.hidden ? 'Show' : 'Hide'}" title="${it.hidden ? 'Show' : 'Hide'}">${it.hidden ? IC.eyeOff : IC.eye}</button>${it.hidden ? '' : `<span class="ar-row" data-ar="${esc(it.id)}" data-ar-compact></span>`}</div>`;
  }).join('') : '<p class="faint">Nothing placed yet.</p>';
  const cat = CATEGORIES.map(([k, t]) => { const refs = Object.entries(CATALOG).filter(([, c]) => c.cat === k); return refs.length ? `<div class="ps-cat"><span class="ps-cat-h">${t}</span><div class="chips">${refs.map(([r, c]) => `<button type="button" class="chip" data-add="${esc(r)}" title="${esc(c.src)}">${IC.plus}${esc(c.name)}</button>`).join('')}</div></div>` : ''; }).join('');
  const own = inventory ? inventoryHTML(inventory, { held: placedIds(inventory, items), hidden: new Set(items.filter((x) => x.hidden).map((x) => x.id)), removed, hasPreset: model.layouts.some((l) => l.id === OWN), active: st.activePreset === OWN }) : '';   // [furniture]
  return `${tryFitHTML({ rooms: model.rooms.filter((r) => !['bath', 'closet', 'hall'].includes(r.kind)), st: tfState() })}${own}${R.some((x) => !x.hidden) ? arSectionHTML(ar.platform) : ''}${pres}<h3 class="label">In this layout <span>${R.filter((x) => !x.hidden).length} pieces</span></h3><div class="ps-list">${list}</div>
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
  if (ar.onClick(e, toast)) return;
  const b = e.target.closest('button, [data-sel]'); if (!b) return;
  if (b.dataset.p) applyPreset(b.dataset.p);
  else if (b.dataset.tf) fitClick(e);
  else if ('invUse' in b.dataset) useOwn();
  else if (b.dataset.invAdd || b.dataset.invShow) showOwn(b.dataset.invAdd || b.dataset.invShow);
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
      <div class="field ps-date"><label for="pDate">Date</label><input type="date" id="pDate" value="${st.date}"></div>
      <div class="field ps-time"><label for="pTime">Sun at <span class="val" id="pTimeV"></span></label><input type="range" id="pTime" min="300" max="1230" step="5" value="${st.min}"></div>
      <div class="seg ps-mood" id="pMood" role="group" aria-label="Lights">${MOODS.map(([k, t]) => `<button type="button" data-mood="${k}" class="${st.mood === k ? 'on' : ''}" aria-pressed="${st.mood === k}" title="${k === 'auto' ? 'Day while the sun is up, lamps after dark' : k === 'night' ? 'Lamps on, no daylight' : k === 'evening' ? 'Low daylight and lamps' : 'Daylight, lamps off'}">${t}</button>`).join('')}</div>
      <div class="seg ps-quick" id="pQuick">${[[mi, 'Move-in'], [`${y}-12-21`, 'Dec 21'], [`${y}-03-20`, 'Mar 20'], [`${y}-06-21`, 'Jun 21']].filter((q) => q[0]).map(([d, t]) => `<button type="button" data-d="${d}">${t}</button>`).join('')}</div>
    </div><div id="pPlayBar"></div>`;
  bar = mountPlayBar($('pPlayBar'), { onToggle: togglePlay, onMonth: (m) => { pausePlay(false); st.date = `${+st.date.slice(0, 4)}-${String(m + 1).padStart(2, '0')}-15`; $('pDate').value = st.date; refreshSun(); }, onScrub: scrubYear });
  $('pDate').addEventListener('change', (e) => { if (e.target.value) { pausePlay(false); st.date = e.target.value; refreshSun(); } });
  $('pTime').addEventListener('input', (e) => { pausePlay(false); st.min = +e.target.value; refreshSun(); });
  $('pQuick').addEventListener('click', (e) => { const b = e.target.closest('[data-d]'); if (!b) return; pausePlay(false); st.date = b.dataset.d; $('pDate').value = st.date; refreshSun(); });
  $('pMood').addEventListener('click', (e) => { const b = e.target.closest('[data-mood]'); if (b) setMood(b.dataset.mood); });
}
// ------------------------------------------------------------------ [daycycle] play the day and the year
// The same sun model asked about a new date or time every frame: the sun, the sky, the shadows, the sun patches, the trees' season. Fast steps coarser; the heavy panels
// (the Light tab, the chips, the per-window minutes) catch up when it pauses.
const player = new Player();
let bar = null, dayRng = null, playMin = 720, liteAt = 0, segsKey = '', segsMemo = null, hoursSrc = null, hoursYear = 0, hoursMemo = null, dcT = 0;
const quant = () => (roomQ() === 'visual' ? 0.5 : phoneQ() ? 5 : 2);   // minutes
const yearSteps = () => (roomQ() === 'visual' ? 104 : 52);
function sunEnv() {
  return { lat: st.site?.origin?.lat ?? S.crit.search?.map_center?.[0] ?? 40.75, lon: st.site?.origin?.lon ?? S.crit.search?.map_center?.[1] ?? -73.98, tz: st.site?.timezone || S.crit.search?.timezone || 'America/New_York' };
}
const winsLit = (env, y, m, d) => { const tab = dayTable(y, m - 1, d, env.lat, env.lon, env.tz, 6); return model.windows.map((w, i) => (winSky[i] && !windowWithheld(winSky, i) ? litInfo(tab, winSky[i].prof, w.bearing, 6).segs : [])); };
/** When the sun reaches the floor of the plan today: the union of the lit stretches of every window (its own skyline), or null when the plan is not placed on a site. */
function floorSegs(env, y, m, d) {
  if (!model || !winSky || winSky.length !== model.windows.length) return null;
  const key = `${y}-${m}-${d}|${winSky.length}|${model.windows.length}`;
  if (key !== segsKey) { segsKey = key; segsMemo = unionSegs(winsLit(env, y, m, d)); }
  return segsMemo;
}
/** Direct-sun hours a day on the 15th of each month on the floor (the union of the windows), cached until the placement changes. */
function monthHoursStudio(env, y) {
  if (!model || !winSky || winSky.length !== model.windows.length) return null;
  if (hoursSrc !== winSky || hoursYear !== y) { hoursSrc = winSky; hoursYear = y; hoursMemo = Array.from({ length: 12 }, (_, mo) => segMinutes(unionSegs(winsLit(env, y, mo + 1, 15))) / 60); }
  return hoursMemo;
}
function playBarSync(s, env) {
  if (!bar) return;
  const [y, m, d] = st.date.split('-').map(Number), segs = floorSegs(env, y, m, d);
  if (segs) {
    bar.setSentence(sunSentence(segs, 'the floor'), sunNow(segs, st.min, s.alt));
    bar.setChart(monthHoursStudio(env, y), { month: m - 1, t: yearProgress(st.date), label: `${MONTH_NAMES[m - 1]} ${d}` });
  } else { bar.setSentence('Place the plan on its site to see when the sun reaches the floor'); bar.setChart(null); }
  bar.setMonth(`${MONTH_NAMES[m - 1]} ${d}`, st.site?.green ? { label: seasonLabel(seasonAt(m, d, env.lat)), note: SEASON_NOTE } : null);
}
function startPlay(kind) {
  if (!model) return;
  const env = sunEnv(), [y, m, d] = st.date.split('-').map(Number);
  if (kind === 'day') { dayRng = dayRange((mi) => sunPos(zonedMs(y, m - 1, d, mi, env.tz), env.lat, env.lon).alt, { from: 300, to: 1235, step: 5 }); player.start('day', progressOf(dayRng, st.min)); }
  else { playMin = st.min; player.start('year', yearProgress(st.date)); }
  st.playing = true; liteAt = 0; bar?.setPlaying(kind);
}
/** Stop the loop; `full` brings the Light tab, the chips and the per-window minutes up to date (a caller about to change the date or time itself passes false). */
function pausePlay(full = true) {
  if (!player.running) return;
  player.stop(); st.playing = false; st.min = Math.round(st.min); bar?.setPlaying(null);
  const t = $('pTime'); if (t) t.value = st.min;
  const dt = $('pDate'); if (dt) dt.value = st.date;
  if (full) { refreshSun(); lookChips(); }
}
function togglePlay(kind = 'day') {
  if (!model) return;
  if (player.running && player.kind === kind) pausePlay(); else { if (player.running) pausePlay(false); startPlay(kind); }
}
function scrubYear(t) {
  pausePlay(false); st.date = yearFrame(+st.date.slice(0, 4), t, 365).iso; const dt = $('pDate'); if (dt) dt.value = st.date; refreshSun(false, true);
  clearTimeout(dcT); dcT = setTimeout(() => { if (!player.running) { refreshSun(); lookChips(); } }, 160);
}
function playFrame(tp) {
  if (player.kind === 'day') { const m = minuteAt(dayRng, tp, quant()); if (m === st.min) return; st.min = m; }
  else { const f = yearFrame(+st.date.slice(0, 4), tp, yearSteps()); if (f.iso === st.date) return; st.date = f.iso; st.min = playMin; }
  const t = $('pTime'); if (t) t.value = st.min;
  const now = performance.now(); if (player.kind === 'year' && now - liteAt > 120) { liteAt = now; const dt = $('pDate'); if (dt) dt.value = st.date; }
  refreshSun(true);
}
function refreshSun(lite = false, scrub = false) {
  if (!model) return;
  const lat = st.site?.origin?.lat ?? S.crit.search?.map_center?.[0] ?? 40.75, lon = st.site?.origin?.lon ?? S.crit.search?.map_center?.[1] ?? -73.98;
  const tz = st.site?.timezone || S.crit.search?.timezone || 'America/New_York';
  const [y, m, d] = st.date.split('-').map(Number);
  const s = sunPos(zonedMs(y, m - 1, d, st.min, tz), lat, lon);
  sunCtx = { lat, lon, tz, y, m, d };   // [room3d]
  G3.setSeason(quantise(seasonAt(m, d, lat)));   // [season]
  G3.setLate(lateAt(st.min));   // [daycycle]
  { const u = document.querySelector('#psLook .rc-strip u'); if (u) u.style.left = `${stripAt(st.min)}%`; if (!lite && sunMemo.key && !sunMemo.key.startsWith(st.date)) lookChips(); }
  const sunny = st.site?.study?.sunshine?.fraction;   // [feature J] lighting tab: the sun now and the place's sunshine table
  if (!lite) LX.refresh({ az: s.az, alt: s.alt, lat, lon, tz, y, m, d, fraction: Array.isArray(sunny) && sunny.length === 12 ? sunny.map(Number) : SUNSHINE[S.crit.search?.city]?.fraction || null, place: st.site?.study?.sunshine?.place || (SUNSHINE[S.crit.search?.city] ? SUNSHINE[S.crit.search.city].place : '') });
  // per-window city occlusion when the plan is placed on its site: only the windows a neighbour blocks lose their sun
  const perWin = up_(s) && winSky && winSky.length === model.windows.length ? model.windows.map((w, i) => windowBlocked(winSky, i, s)) : null;
  const up = s.alt > 0, blocked = perWin ? perWin.every(Boolean) : up && siteProf && s.alt <= hAt(siteProf, s.az);
  G3.setWindowShade(perWin || []);
  const withheld = winSky && winSky.length === model.windows.length ? model.windows.map((w, i) => windowWithheld(winSky, i)) : [];   // [model project]
  const nWh = withheld.filter(Boolean).length, nBlk = perWin ? perWin.filter((b, i) => b && !withheld[i]).length : 0;
  const mk = `${st.date}|${winSky ? winSky.length : 0}`;
  if (!lite && winSky && mk !== winMinKey) { winMinKey = mk; winMin = windowMinutes(winSky, model, y, m - 1, d, lat, lon, tz); }
  const placementKnown=!st.site||!!siteProf;
  const light = lightState({ bearing:placementKnown?model.up_bearing:null, altitude:s.alt, blocked:!!blocked, directSun:st.directSun, ambient:st.ambient });
  const rel = (s.az - (model.up_bearing ?? 0)) * DEG, ca = Math.cos(s.alt * DEG);
  const gz = glazingScale({ transmittance: st.glazing, blinds: st.blinds });
  G3.setLighting({ambient:light.ambient, sun:gz.sun, through:gz.through});
  G3.setSun({ x: Math.sin(rel) * ca, y: Math.cos(rel) * ca, up: Math.sin(s.alt * DEG) }, light.directional, up);
  const tv = $('pTimeV'); if (tv) tv.textContent = fmtT(st.min);
  const t = $('pTime'); if (t) t.style.setProperty('--p', `${((st.min - 300) / 930) * 100}%`);
  playBarSync(s, sunEnv());
  const lamps = R.filter((x) => !x.hidden && x.kind === 'lamp').length + LX.count(), mn = G3.moodNow();
  $('phud').innerHTML = `<span>${esc(st.date)} ${fmtT(st.min)}${mn !== 'day' ? ` · ${mn === 'night' ? 'night' : 'evening'}, ${lamps ? `${lamps} lamp${lamps > 1 ? 's' : ''} on` : 'no lamps placed, a warm ceiling light assumed'}` : ''}</span><span class="${light.directional ? 'lit' : 'shade'}">${!placementKnown ? 'Window placement unresolved · direct sun withheld' : !light.orientationKnown ? 'Orientation unknown · direct sun unresolved' : !up ? 'Night' : blocked ? (perWin ? 'Every window shaded by neighbours' : 'Site observation point shaded') : nWh && nWh === model.windows.length ? 'Windows not in open air · sun withheld' : nBlk ? `Sun blocked at ${nBlk} of ${perWin.length} windows${nWh ? ` · ${nWh} withheld` : ''}` : !st.directSun ? 'Direct sun hidden in preview' : `Sun ${Math.round(s.alt)}° up, ${compass(s.az)}`}</span>`;
  if (lite) return;   // playing: the Light tab waits for the pause
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
  G3.setCity(cityGroup(onSite, { daylight: eye, light: eye || !dark, colors, season: sunCtx ? quantise(seasonAt(sunCtx.m, sunCtx.d, sunCtx.lat)) : undefined }));
}
let cityKey = '';

// ------------------------------------------------------------------ frame loop
function frame(ts) {
  requestAnimationFrame(frame);
  if ($('view-plan').hidden || !model) return;
  if (player.running) { const tp = player.tick(ts ?? performance.now()); if (tp != null) playFrame(tp); }
  if (flash && performance.now() > flashT) { flash = null; overlays(); }
  const now = performance.now(), dt = Math.min(0.05, (now - (lastFrame || now)) / 1000); lastFrame = now;
  if (held.size && G3.viewMode() === 'eye') {
    const h = (k) => held.has(k), v = (h('shift') ? 72 : 36) * dt; // inches per second: a stroll, or a brisk walk
    const fwd = (h('w') || h('arrowup') ? v : 0) - (h('s') || h('arrowdown') ? v : 0), turn = ((h('d') || h('arrowright') ? 1 : 0) - (h('a') || h('arrowleft') ? 1 : 0)) * 1.6 * dt, side = ((h('e') ? 1 : 0) - (h('q') ? 1 : 0)) * v;
    if (fwd || turn || side) G3.walk(fwd, turn, side);
  }
  const t0 = performance.now(), drew = G3.render();
  if (st.mode !== '2d') Q3.pulse(t0, drew, performance.now() - t0);   // [quality] the step-down times the frames that are really drawn
}
