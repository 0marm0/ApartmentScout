// Floor plan studio: one view to lay out furniture on a listing's plan and check it fits.
// A synced 2D plan and 3D model (drag in either), a furniture catalogue with real sizes, fit checks
// graded clear / tight / blocked (overlaps, door swings, clearance zones, TV viewing distance, headboard
// and TV-wall rules), eye-level cameras and a walk mode, wall cut modes, layout presets written by
// agents, layout save/load, GLB and PNG export, and the real sun through the windows (switched off
// when the site model says neighbouring buildings block it).
//
// Modules: plan/model.js (plan JSON v1/v2 normaliser), plan/catalog.js (furniture sizes and clearances),
// plan/checks.js (pure fit rules), plan/layout.js (layout file validation), plan/scene3d.js (three.js),
// plan/plan2d.js (SVG plan). All lengths are inches internally.
import { S, on, byId, label, loadJSON, store } from './app.js';
import { $, esc, toast } from './util.js';
import { DEG, sunPos, zonedMs, angDiff, fmtT, prepBuildings, horizonProfile, hAt, facesOf, snapOpen, compass, skyView } from './sun.js';
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
import { placePlan, windowSkylines, windowBlocked, windowMinutes } from './plan/city.js';
import { cityGroup } from './plan/citymesh.js';

const st = {
  id: null, date: '', min: 720, playing: false, site: null, mode: 'both', view: 'bird', wall: 'cut', tab: 'furniture',
  snap: true, zonesAll: false, sight: true, swings: false,
  directSun: true, ambient: 1, glazing: 0.6, blinds: 'open',
};
// onSite: the plan placed on its site; winSky: one skyline per plan window (per-window city occlusion)
let onSite = null, winSky = null, winMin = null, winMinKey = '';
let winSkyView = null;
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
            <button type="button" role="menuitem" data-f="compare">Compare with the other plans</button>
            <hr><button type="button" role="menuitem" data-f="glb">Export 3D model<span>.glb</span></button>
            <button type="button" role="menuitem" data-f="png">Snapshot of the 3D view<span>.png</span></button>
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
            <div class="ps-corner"><span class="ps-north" id="psNorth" title="North"><i></i>N</span><span>1 square = 1 ft</span></div>
          </div>
          <div class="ps-pane canvas-stage" id="pstage">
            <canvas id="pgl" aria-label="3D model of the apartment"></canvas>
            <div class="float ps-cams" id="psCams" role="group" aria-label="Camera">${[['bird', 'Bird’s eye'], ['top', 'Top'], ['bed', 'From bed'], ['sofa', 'From sofa'], ['door', 'From door'], ['walk', 'Walk']].map(([k, t]) => `<button type="button" data-v="${k}">${t}</button>`).join('')}</div>
            <div class="float ps-walls" id="psWalls" role="group" aria-label="Walls">${[['cut', 'Cut'], ['full', 'Full'], ['outline', 'Outline']].map(([k, t]) => `<button type="button" data-w="${k}">${t}</button>`).join('')}</div>
            <div class="hud" id="phud"></div>
            <div class="ps-hint" id="psHint"></div>
          </div>
        </div>
        <div class="panel ps-sun" id="ptimePanel"></div>
      </div>
      <aside class="ps-side">
        <div class="panel ps-insp" id="psInsp"></div>
        <div class="seg ps-tabs" id="psTabs" role="tablist">${[['furniture', 'Furniture'], ['checks', 'Checks'], ['light', 'Light'], ['plan', 'Plan']].map(([k, t]) => `<button type="button" role="tab" data-t="${k}">${t}<span class="n" id="psTabN-${k}"></span></button>`).join('')}</div>
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
  bindChrome();
  on('theme', () => { if (!ready) return; G3.retheme(); recompute({ all: true }); applyCity(); });
}

export async function show(id) {
  const ids = planIds();
  if (!ids.length) {
    $('psTitle').textContent='No floor plans yet';
    $('psSub').textContent='Import a complete plan project through Layout, or ask your research agent to prepare one from a dimensioned plan.';
    return;
  }
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
      const B = prepBuildings(site.b, site.holes && typeof site.holes === 'object' ? site.holes : null, site.components && typeof site.components === 'object' ? site.components : null), T = B[site.target] || B[0];
      const F = canonicalFaces(facesOf(T,8,B),site.faces||[],site.version);
      const pool = F.filter((f) => !f.shared);
      st.site=site;
      if(pool.length) {
      const want = model.up_bearing ?? site.window?.bearing ?? 180;
      const face = pool.reduce((best, f) => (Math.abs(angDiff(f.bearing, want)) < Math.abs(angDiff(best.bearing, want)) - 0.5 || (Math.abs(Math.abs(angDiff(f.bearing, want)) - Math.abs(angDiff(best.bearing, want))) <= 0.5 && f.length > best.length) ? f : best), pool[0]);
      const t = snapPosition(face, face.i === site.window?.face ? site.window?.t ?? 0.5 : 0.5,snapOpen), x = face.a[0] + (face.b[0] - face.a[0]) * t, y = face.a[1] + (face.b[1] - face.a[1]) * t;
      const floor = model.floor || byId(id)?.floor || 5;
      siteProf = horizonProfile(B, x + Math.sin(face.bearing * DEG) * 0.4, y + Math.cos(face.bearing * DEG) * 0.4, T.g + (floor - 1) * (site.floor_height_m || 3.2) + 1.6);
      placeOnSite(site, floor);
      }
    }
  }
  if (!ready) { G3.init($('pgl'), $('pstage'), () => {}); P2.mount($('p2d'), { item: (i) => R.find((x) => x.id === i), select, move: dragTo, commit: () => commit() }); bind3D(); ready = true; }
  G3.setModel(model); G3.setWallMode(st.wall);
  P2.setModel(model);
  st.city = !!store.get(`plan-city.${S.base}`, false); applyCity();
  // furniture: the saved layout for this plan, else the first preset
  const saved = projectLibrary[id]?.layout || store.get(key(id), null), v = saved && validateLayout(saved, { planId: id });
  const light = projectLibrary[id]?.lighting || store.get(`plan-light.${S.base}.${id}`, {});
  st.directSun = light.directSun !== false;
  st.ambient = typeof light.ambient === 'number' && Number.isFinite(light.ambient) ? Math.max(0, Math.min(2, light.ambient)) : 1;
  st.glazing = clampGlazing(light.glazing); st.blinds = blindsOf(light.blinds);
  items = v?.ok ? v.layout.items : (model.layouts[0]?.items || []).map((x) => ({ ...x }));
  undo.length = 0; redo.length = 0; sel = null; cancelCompare(); $('psCompare').hidden = true;
  st.activePreset = v?.ok ? null : model.layouts[0]?.id || null;
  head(); setMode(st.mode); setWall(st.wall, true); G3.setView(st.view === 'top' ? 'top' : 'bird'); markCams();
  recompute({ all: true }); sunPanel(); refreshSun();
}

function head() {
  const L = byId(st.id);
  $('psTitle').innerHTML = `${esc(model.title || (L ? label(L) : st.id))} <span>floor plan</span>`;
  const pv = model.provenance, est = model.fixtures.filter((f) => f.est).length;
  const match = { 'exact-unit': 'Exact unit plan', 'line-tier': 'Same line, other floor', representative: 'Representative plan', 'stated-dims': 'Drawn from stated room sizes', 'photo-estimate': 'Estimated from photos' }[pv.match];
  $('psSub').innerHTML = `${match ? `<span class="pill accent">${esc(match)}</span> ` : ''}${Math.round(model.area)} ft² of rooms drawn${model.up_bearing != null ? ` · windows face ${Math.round(model.windows[0]?.bearing ?? model.up_bearing)}° ${compass(model.windows[0]?.bearing ?? model.up_bearing)}` : ''}${model.floor ? ` · floor ${model.floor}` : ''}${est ? ` · <span class="warnline">${est} fixture${est > 1 ? 's' : ''} estimated</span>` : ''}`;
  const n = $('psNorth'); if (n) { n.hidden = model.up_bearing == null; n.style.setProperty('--rot', `${-(model.up_bearing || 0)}deg`); }
}

// ------------------------------------------------------------------ state changes
/** The Light tab's settings as stored with the plan (display preview values, never measured photometry). */
const lightingOf = () => ({ directSun: st.directSun, ambient: st.ambient, glazing: st.glazing, blinds: st.blinds });
const snapshot = () => JSON.stringify({items,plan:rawPlan,siteProfile:siteProf?Array.from(siteProf):null,lighting:lightingOf()});
function checkpoint() { undo.push(snapshot()); if (undo.length > 80) undo.shift(); redo.length = 0; markUndo(); }
function persist() {
  store.set(key(st.id), serialiseLayout(st.id, items));
  if(projectLibrary[st.id]) {
    const project=serialiseProject(rawPlan,items,lightingOf());
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
    rawPlan=saved.plan;model=normalisePlan(rawPlan);G3.setModel(model);G3.setWallMode(st.wall);P2.setModel(model);
    siteProf=Array.isArray(saved.siteProfile)?Float64Array.from(saved.siteProfile):null;
    if(st.site && siteProf)placeOnSite(st.site,model.floor||byId(st.id)?.floor||5);
    else dropPlacement();
  }
  if(saved.lighting) {st.directSun=saved.lighting.directSun;st.ambient=saved.lighting.ambient;st.glazing=clampGlazing(saved.lighting.glazing);st.blinds=blindsOf(saved.lighting.blinds);}
  if (sel && !items.some((x) => x.id === sel)) sel = null;
  if(projectLibrary[st.id])projectLibrary[st.id]=serialiseProject(rawPlan,items,lightingOf());
  persist(); markUndo(); recompute({ all: true });
  refreshSun();head();
}

/** Re-resolve, re-check and redraw. opts.all rebuilds every 3D item; opts.panels redraws the side. */
function recompute(opts = {}) {
  if (!model) return;
  R = items.map((x) => resolve(x)).filter(Boolean);
  ev = evaluate(model, R);
  G3.setItems(R);
  for (const it of R) G3.setRoomOf(it.id, ev.items[it.id]?.room || '');
  const states = Object.fromEntries(Object.values(ev.items).map((r) => [r.id, r.state]));
  G3.setStatus(states, sel);
  overlays();
  inspector();
  if (opts.panels !== false) tab();
  tabCounts();
}
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
  P2.draw({ items: R, sel, ev, zones, gaps, sights, flash: fl });
  G3.setOverlay({ zones, gaps: G3.viewMode() === 'eye' ? [] : gaps, sights: G3.viewMode() === 'eye' ? [] : sights, flash: fl, swings: st.swings ? model.doorways.map((d) => swingPoly(d, 12)).filter(Boolean) : [] });
}
const gradeRank = (g) => ['clear', 'tight', 'blocked'].indexOf(g);

function select(id) {
  if (sel === id) return;
  sel = id; recompute({ panels: st.tab === 'furniture' });
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
  $('psCams').addEventListener('click', (e) => { const b = e.target.closest('[data-v]'); if (b) camera(b.dataset.v); });
  $('psWalls').addEventListener('click', (e) => { const b = e.target.closest('[data-w]'); if (b) setWall(b.dataset.w); });
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
  const hints = { walk: 'Drag to look · W S or ↑ ↓ to walk · A D to turn · Esc to stop', bed: 'Drag to look around · scroll to move', sofa: 'Drag to look around · scroll to move', door: 'Drag to look around · scroll to move' };
  $('psHint').textContent = hints[st.view] || (isPhone() ? 'Drag a piece to move it · drag the floor to orbit' : 'Drag a piece to move it · drag the floor to orbit · right-drag to pan');
}
function entryDoor() {
  const ds = model.doorways;
  const d = ds.find((x) => x.kind === 'entry') || ds.find((x) => /front|entry/i.test(x.name)) || ds.find((x) => { const n = [-(x.b[1] - x.a[1]) / x.len, (x.b[0] - x.a[0]) / x.len]; return [1, -1].some((s) => !model.rooms.some((r) => pointInPoly([x.mid[0] + n[0] * s * 18, x.mid[1] + n[1] * s * 18], r.poly))); }) || ds[0];
  if (!d) return { at: model.rooms[0].label, dir: [0, 1] };
  const n = [-(d.b[1] - d.a[1]) / d.len, (d.b[0] - d.a[0]) / d.len];
  const inward = d.swingDir || ([1, -1].map((s) => [n[0] * s, n[1] * s]).find((v) => model.rooms.some((r) => pointInPoly([d.mid[0] + v[0] * 24, d.mid[1] + v[1] * 24], r.poly))) || n);
  const at = [d.mid[0] + inward[0] * 14, d.mid[1] + inward[1] * 14];
  // look toward the main room rather than straight ahead, which is often a hallway wall
  const main = [...model.rooms].filter((r) => r.kind === 'living').sort((a, b) => b.area - a.area)[0] || [...model.rooms].sort((a, b) => b.area - a.area)[0];
  const v = [main.label[0] - at[0], main.label[1] - at[1]], L = Math.hypot(...v);
  return { at, dir: L > 24 ? [v[0] / L, v[1] / L] : inward };
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
  overlays(); markCams();
}

async function fileAction(f) {
  if(f==='project-load') { $('psProjectFile').click(); return; }
  if (!model) return;
  if (f === 'save') saveBlob(new Blob([JSON.stringify(serialiseLayout(st.id, items), null, 2)], { type: 'application/json' }), `${st.id}-layout.json`);
  else if(f==='project-save') {
    try { const project=serialiseProject(rawPlan,items,lightingOf());saveBlob(new Blob([JSON.stringify(project,null,2)],{type:'application/json'}),`${st.id}-project.json`); }
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
  } else if (f === 'png') {
    if (st.mode === '2d') { setMode('both'); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); }
    const a = document.createElement('a'); a.href = G3.snapshotPNG(); a.download = `${st.id}-${st.view}.png`; document.body.append(a); a.click(); a.remove();
  } else if (f === 'clear') mutate(() => { items = []; sel = null; }, 'Cleared. Undo brings it back');
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
  if ((e.metaKey || e.ctrlKey) && k.toLowerCase() === 'z') { e.preventDefault(); doUndo(!e.shiftKey); return; }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const stop = () => { e.preventDefault(); e.stopPropagation(); };
  if (eye) {
    const step = e.shiftKey ? 24 : 8;
    if (k === 'w' || k === 'W' || k === 'ArrowUp') { stop(); G3.walk(step); return; }
    if (k === 's' || k === 'S' || k === 'ArrowDown') { stop(); G3.walk(-step); return; }
    if (k === 'a' || k === 'A' || k === 'ArrowLeft') { stop(); G3.walk(0, -0.08); return; }
    if (k === 'd' || k === 'D' || k === 'ArrowRight') { stop(); G3.walk(0, 0.08); return; }
    if (k === 'Escape') { stop(); camera('bird'); return; }
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
  const variants = c.variants ? `<div class="field"><label for="psVar">Variant</label><select id="psVar" data-k="variant">${Object.entries(c.variants).map(([k, v]) => `<option value="${esc(k)}" ${(it.variant || Object.keys(c.variants)[0]) === k ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}</select></div>` : '';
  el.innerHTML = `<div class="ps-ih"><span class="ps-sw" style="--c:#${(c.color ?? 0x888888).toString(16).padStart(6, '0')}"></span><div class="t"><b>${esc(it.name)}</b><small>${esc(r.room || '')}${c.est ? ' · size estimated' : ''}</small></div>${statePill(r.state)}<button class="icon-btn" type="button" data-a="close" aria-label="Deselect">${IC.x}</button></div>
    <div class="ps-fields" data-id="${esc(it.id)}">
      ${['w', 'd', 'h'].map((k) => `<div class="field"><label for="psF${k}">${{ w: 'Width', d: 'Depth', h: 'Height' }[k]} <span>in</span></label><input type="number" id="psF${k}" data-k="${k}" min="1" max="300" step="0.5" value="${+it[k].toFixed(1)}"></div>`).join('')}
      <div class="field"><label for="psFr">Turn <span>°</span></label><input type="number" id="psFr" data-k="rot" step="15" value="${Math.round(it.rot)}"></div>
      ${variants}
    </div>
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
      const project=serialiseProject(edited,items,lightingOf());
      saveProjectLibrary(Object.assign(Object.create(null),projectLibrary,{[st.id]:project}));
      checkpoint();rawPlan=project.plan;model=normalisePlan(rawPlan);
      G3.setModel(model);G3.setWallMode(st.wall);P2.setModel(model);
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
  return `${pres}<h3 class="label">In this layout <span>${R.filter((x) => !x.hidden).length} pieces</span></h3><div class="ps-list">${list}</div>
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
    ${roomRows || '<p class="faint">Place some furniture to see the checks.</p>'}${tv}${fx}${rules}`;
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
  else if (b.dataset.sel) { select(b.dataset.sel === sel ? null : b.dataset.sel); markList(); }
  else if (b.dataset.vis) { const it = items.find((q) => q.id === b.dataset.vis); if (it) mutate(() => { it.hidden = !it.hidden; if (it.hidden && sel === it.id) sel = null; }); }
  else if (b.dataset.add) addRef(b.dataset.add);
  else if (b.dataset.ck) { select(b.dataset.ck); const x = ev.items[b.dataset.ck]?.issues[+b.dataset.i]; flashPoly(x?.at || x?.zone?.poly || null); }
  else if (b.dataset.file) fileAction(b.dataset.file);
}
function tabChange(e) {
  const k = e.target.dataset.opt; if (!k) return;
  st[k] = e.target.checked; e.target.closest('.tg')?.classList.toggle('on', st[k]); overlays();
}

// ------------------------------------------------------------------ sun
function sunPanel() {
  const y = +st.date.slice(0, 4), mi = S.crit.search?.move_in?.earliest ? String(S.crit.search.move_in.earliest).slice(0, 10) : null;
  $('ptimePanel').innerHTML = `<div class="ps-sunrow">
      <button class="icon-btn ps-play" type="button" id="pPlay" aria-label="Play the day">${IC.play}</button>
      <div class="field ps-date"><label for="pDate">Date</label><input type="date" id="pDate" value="${st.date}"></div>
      <div class="field ps-time"><label for="pTime">Sun at <span class="val" id="pTimeV"></span></label><input type="range" id="pTime" min="300" max="1230" step="5" value="${st.min}"></div>
      <div class="seg ps-quick" id="pQuick">${[[mi, 'Move-in'], [`${y}-12-21`, 'Dec 21'], [`${y}-03-20`, 'Mar 20'], [`${y}-06-21`, 'Jun 21']].filter((q) => q[0]).map(([d, t]) => `<button type="button" data-d="${d}">${t}</button>`).join('')}</div>
    </div>`;
  $('pDate').addEventListener('change', (e) => { if (e.target.value) { st.date = e.target.value; refreshSun(); } });
  $('pTime').addEventListener('input', (e) => { st.min = +e.target.value; refreshSun(); });
  $('pQuick').addEventListener('click', (e) => { const b = e.target.closest('[data-d]'); if (!b) return; st.date = b.dataset.d; $('pDate').value = st.date; refreshSun(); });
  $('pPlay').addEventListener('click', () => { st.playing = !st.playing; $('pPlay').innerHTML = st.playing ? IC.pause : IC.play; $('pPlay').classList.toggle('on', st.playing); });
}
function refreshSun() {
  if (!model) return;
  const lat = st.site?.origin?.lat ?? S.crit.search?.map_center?.[0] ?? 40.75, lon = st.site?.origin?.lon ?? S.crit.search?.map_center?.[1] ?? -73.98;
  const tz = st.site?.timezone || S.crit.search?.timezone || 'America/New_York';
  const [y, m, d] = st.date.split('-').map(Number);
  const s = sunPos(zonedMs(y, m - 1, d, st.min, tz), lat, lon);
  // per-window city occlusion when the plan is placed on its site: only the windows a neighbour blocks lose their sun
  const perWin = up_(s) && winSky && winSky.length === model.windows.length ? model.windows.map((w, i) => windowBlocked(winSky, i, s)) : null;
  const up = s.alt > 0, blocked = perWin ? perWin.every(Boolean) : up && siteProf && s.alt <= hAt(siteProf, s.az);
  G3.setWindowShade(perWin || []);
  const nBlk = perWin ? perWin.filter(Boolean).length : 0;
  const mk = `${st.date}|${winSky ? winSky.length : 0}`;
  if (winSky && mk !== winMinKey) { winMinKey = mk; winMin = windowMinutes(winSky, model, y, m - 1, d, lat, lon, tz); }
  const placementKnown=!st.site||!!siteProf;
  const light = lightState({ bearing:placementKnown?model.up_bearing:null, altitude:s.alt, blocked:!!blocked, directSun:st.directSun, ambient:st.ambient });
  const rel = (s.az - (model.up_bearing ?? 0)) * DEG, ca = Math.cos(s.alt * DEG);
  const gz = glazingScale({ transmittance: st.glazing, blinds: st.blinds });
  G3.setLighting({ambient:light.ambient, sun:gz.sun});
  G3.setSun({ x: Math.sin(rel) * ca, y: Math.cos(rel) * ca, up: Math.sin(s.alt * DEG) }, light.directional, up);
  const tv = $('pTimeV'); if (tv) tv.textContent = fmtT(st.min);
  const t = $('pTime'); if (t) t.style.setProperty('--p', `${((st.min - 300) / 930) * 100}%`);
  $('phud').innerHTML = `<span>${esc(st.date)} ${fmtT(st.min)}</span><span class="${light.directional ? 'lit' : 'shade'}">${!placementKnown ? 'Window placement unresolved · direct sun withheld' : !light.orientationKnown ? 'Orientation unknown · direct sun unresolved' : !up ? 'Night' : blocked ? (perWin ? 'Every window shaded by neighbours' : 'Site observation point shaded') : nBlk ? `Sun blocked at ${nBlk} of ${perWin.length} windows` : !st.directSun ? 'Direct sun hidden in preview' : `Sun ${Math.round(s.alt)}° up, ${compass(s.az)}`}</span>`;
  const el = $('psLight'); if (!el) return;
  if (!el.querySelector('#psLightResults')) {
    el.innerHTML = `<div class="ps-light-controls"><label class="tg"><input id="psDirectSun" type="checkbox"> Show directional sunlight</label>${onSite ? `<label class="tg ps-city-tg"><input id="psCityTg" type="checkbox"> Show the city outside</label>` : ''}<div class="field"><label for="psAmbient">Background light preview <span id="psAmbientValue"></span></label><input id="psAmbient" type="range" min="0" max="2" step="0.05"></div><p class="ps-note faint">Background intensity is a display preference, not measured brightness or lux.</p>
      <div class="ps-glaze"><div class="label">Glass and blinds <span class="pill">Preview</span></div>
        <div class="field"><label for="psGlazing">Glazing transmittance <span id="psGlazingValue"></span></label><input id="psGlazing" type="range" min="0.05" max="1" step="0.05" aria-describedby="psGlazeNote"></div>
        <div class="seg ps-blinds" id="psBlinds" role="group" aria-label="Blinds">${Object.entries(BLINDS_LABEL).map(([k, t]) => `<button type="button" data-b="${k}" aria-pressed="false">${t}</button>`).join('')}</div>
        <p class="ps-note faint" id="psGlazeNote">Assumed: ${GLAZING_DEFAULT} is typical double glazing; half blinds pass about half the light, closed about a tenth. Scales the sun patches and the daylight estimate; not a material model.</p></div></div><div id="psLightResults"></div>`;
    const saveLight=()=>{store.set(`plan-light.${S.base}.${st.id}`,lightingOf());if(projectLibrary[st.id])persist();refreshSun();};
    $('psGlazing').oninput=e=>{st.glazing=clampGlazing(+e.target.value);saveLight();};
    $('psBlinds').onclick=e=>{const b=e.target.closest('[data-b]');if(!b)return;st.blinds=blindsOf(b.dataset.b);saveLight();};
    $('psDirectSun').onchange=e=>{st.directSun=e.target.checked;saveLight();};
    $('psAmbient').oninput=e=>{st.ambient=+e.target.value;saveLight();};
    $('psCityTg')?.addEventListener('change', (e) => { st.city = e.target.checked; store.set(`plan-city.${S.base}`, st.city); applyCity(); });
  }
  if ($('psCityTg')) $('psCityTg').checked = !!st.city;
  $('psDirectSun').checked=st.directSun;
  $('psDirectSun').disabled=!light.orientationKnown;
  $('psAmbient').value=st.ambient;
  $('psAmbientValue').textContent=st.ambient.toFixed(2)+'×';
  $('psGlazing').value=st.glazing; $('psGlazingValue').textContent=st.glazing.toFixed(2);
  $('psGlazing').style.setProperty('--p', `${((st.glazing - 0.05) / 0.95) * 100}%`);
  $('psBlinds').querySelectorAll('[data-b]').forEach((b) => { const on = b.dataset.b === st.blinds; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
  const sky = windowSky(), rooms = sky ? roomDaylight(model, sky, { transmittance: st.glazing, blinds: st.blinds }) : [];
  const rows = model.windows.map((w, wi) => {
    const reach=windowReach({bearing:w.bearing,sunAzimuth:s.az,altitude:s.alt,head:w.head,orientationKnown:light.orientationKnown,blocked:perWin ? perWin[wi] : !!blocked});
    const status={'orientation-unknown':'Orientation unresolved',night:'Night','site-blocked':perWin ? 'Shaded by neighbours' : 'Site observation point shaded',behind:'Sun behind this wall',unresolved:'Window dimensions unresolved'}[reach.state];
    const today = winMin && winMin[wi] != null && light.orientationKnown ? hmShort(winMin[wi]) : '—';
    return `<tr><td>${esc(w.room || 'Window')}${w.note ? `<br><small class="faint">${esc(w.note)}</small>` : ''}</td><td class="num">${light.orientationKnown ? Math.round(w.bearing)+'° '+compass(w.bearing) : 'Unknown'}</td><td>${reach.inches!=null ? `<span>${fmtIn(reach.inches)} unoccluded reach</span>` : `<span class="faint">${status}</span>`}</td>${winSky ? `<td class="num">${today}</td>` : ''}</tr>`;
  }).join('');
  $('psLightResults').innerHTML = `<p class="ps-sunline">${esc(st.date)} at ${fmtT(st.min)}: sun ${Math.round(s.az)}° ${compass(s.az)}, ${up ? Math.round(s.alt) + '° up' : 'below the horizon'}.</p>
    ${!light.orientationKnown ? `<p class="ps-note">${!placementKnown ? 'The city model does not resolve a valid window observation point for this edited plan. Re-establish its placement before interpreting sunlight.' : 'Confirm the plan orientation to enable directional sunlight. No north-facing assumption is applied.'}</p>` : ''}
    <table class="mini"><thead><tr><th>Window</th><th class="num">Faces</th><th>Geometric estimate</th>${winSky ? '<th class="num">Sun today</th>' : ''}</tr></thead><tbody>${rows}</tbody></table>
    ${daylightTable(rooms, sky)}
    <p class="ps-note faint">${winSky ? `Each window has its own skyline from the city model: the plan's window wall is placed on the ${Math.round(onSite.az)}° facade at the site's window position, floor ${esc(model.floor || byId(st.id)?.floor || '?')}, so a neighbour in front of one window shades only that window. Where the unit sits along the facade is an assumption.` : siteProf ? 'Neighbour shading uses one assumed observation point from the city model. It does not resolve each individual window or a multi-facade apartment.' : 'No resolved neighbouring-window observation point is available for this plan.'} Floor reach is an unoccluded projection from window-head height, not actual room penetration. Walls and furniture can intercept it. Rendered shadows are approximate. Glass and blinds are preview multipliers, the daylight factor is an overcast-sky estimate, and clouds, reflections and real photometry are not simulated.</p>`;
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
  if (!sky) return '<p class="ps-note faint">No city model for this plan, so its sky view and daylight are unknown.</p>';
  if (!rooms.length) return '';
  const gz = glazingScale({ transmittance: st.glazing, blinds: st.blinds });
  return `<h3 class="label ps-df-h">Estimated daylight factor <span class="pill">Preview</span></h3>
    <table class="mini ps-df"><thead><tr><th>Room</th><th class="num">Glass</th><th class="num" title="Share of an unobstructed window's overcast-sky light">Sky view</th><th class="num">DF est.</th></tr></thead><tbody>${rooms.map((r) => `<tr><td>${esc(r.room)}</td><td class="num">${r.glazed_m2.toFixed(1)} m²</td><td class="num" title="visible sky angle ${Math.round(r.theta)}°">${Math.round((r.theta / 90) * 100)}%</td><td class="num"><b>${r.df < 1 ? r.df.toFixed(2) : r.df.toFixed(1)}%</b></td></tr>`).join('')}</tbody></table>
    <p class="ps-note faint">Average daylight factor (BRE formula T·Aw·θ / A(1 − R²)) from this plan's room and window sizes, the sky each window sees under an overcast sky (θ = 90° × sky view), ${Math.round(gz.through * 100)}% of light through glass and blinds, 80% of each opening glazed, reflectance 0.5. For comparing rooms and settings: not a measurement, not lux.${winSky ? '' : ' One assumed observation point stands in for every window.'}</p>`;
}
// ------------------------------------------------------------------ the plan on its site (per-window skylines, city outside)
const up_ = (s) => s.alt > 0;
const hmShort = (min) => { if (!min) return 'none'; const h = Math.floor(min / 60), mm = Math.round(min % 60); return h && mm ? `${h} h ${String(mm).padStart(2, '0')}` : h ? `${h} h` : `${mm} m`; };
function placeOnSite(site, floor) {
  try { onSite = placePlan(site, model, floor); winSky = onSite ? windowSkylines(onSite, model) : null; } catch { onSite = winSky = null; }
  winMin = null; winMinKey = '';
  if (ready) applyCity();
}
function dropPlacement() { onSite = winSky = winMin = null; winMinKey = ''; G3.setWindowShade([]); applyCity(); }
function applyCity() {
  if (!ready) return;
  if (!st.city || !onSite) { if (G3.hasCity()) G3.setCity(null); return; }
  const dark = document.documentElement.dataset.theme !== 'light', css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  G3.setCity(cityGroup(onSite, { colors: { low: dark ? css('--surface-3') : css('--ink-4'), high: css('--ink-3'), roof: dark ? css('--ink-3') : css('--surface-1'), own: css('--accent'), ground: dark ? css('--surface-1') : css('--surface-3') } }));
}

// ------------------------------------------------------------------ frame loop
function frame() {
  requestAnimationFrame(frame);
  if ($('view-plan').hidden || !model) return;
  if (st.playing) { st.min += 3; if (st.min > 1230) st.min = 300; const t = $('pTime'); if (t) t.value = st.min; refreshSun(); }
  if (flash && performance.now() > flashT) { flash = null; overlays(); }
  G3.render();
}
