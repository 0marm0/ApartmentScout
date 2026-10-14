// Unit 3D: the listing's building and every neighbour in 3D, the sun for any date and time, the view from the
// chosen window (flat or a bay of several panes), the apartment's own floor plan placed inside the city, a
// clickable day strip that names who shades the window, a sun-path chart, eye height against the neighbouring
// roofs, direct-sun hours for every floor, a sortable neighbours table with CSV, photo matching for the facing,
// the other listed units of the building, and the evidence behind each input. Reads sites/<id>.json (v1 or v2;
// every v2 key is optional) and plans/<id>.json when there is one.
import { S, byId, label, loadJSON, on, download } from './app.js';
import { $, esc, css, toast, ICONS, safeUrl } from './util.js';
import {
  DEG, sunPos, zonedMs, zoneAbbr, angDiff, fmtT, prepBuildings, horizonProfile, horizonDir, hAt, litInfo,
  facesOf, snapOpen, streetAhead, rayBlock, compass, dayStates, dayBlockers, blockerMinutes, BAY, paneFacings, inFront,
  distToBuilding, bearingTo, solidsOf, skyView, daylightFactor, SUNSHINE, expectedSun, FIELD_DEG,
} from './sun.js';
import { canonicalFaces, snapPosition, baselineStudyMatches, readScenario, readScenarioExtras, writeScenario, clearScenario } from './unit/scenario.js';
import { UnitStage } from './unit/scene.js';
import { STRIP_FROM, STRIP_TO, STRIP_STEP, stripBar, stripTicks, drawPath, heatHTML, monthBandSVG, table, roofBars } from './unit/charts.js';
import { unitsBoard, neighboursTable, neighboursCSV, sortRows, NB_FIRST_DIR, blockersTable, evidenceExtras, checksBlock, receiptsBlock, dirBearing, fmtDist } from './unit/panels.js';
import { buildInterior, genericPlan } from './unit/interior.js';
import { sectorHeights, sectorOf, applyEdits, HCLASS_LABELS } from './unit/heights.js';
import { heightMapHTML, sectorChartSVG, sectorTable, renderFloorViews, renderPanorama, renderSeasons } from './unit/studies.js';
import { normalisePlan } from './plan/model.js';

let site = null, B0 = [], FUTB = [], edits = new Map(), B = [], T = null, FACES = [], LM = [], FUT = [], BF = null, stage = null, plan = null, interior = null;
const st = {
  id: null, face: 0, t: 0.5, floor: 10, cmp: 20, az: 180, date: '', min: 780, mode: 'orbit', playing: false,
  manual: {}, moved: null, sel: null, first: true, bay: false, src: null, lmSel: new Set(), slabOff: null, inWin: -1,
  nbSort: { key: 'dist', dir: 1 }, nbOpen: false, allLm: false, photo: null, video: false,
  study: 'heights', ifBi: null,
};
let profA = null, profB = null, profF = null, statesA = null, statesB = null, blkA = null, blkRows = [], NBR = [], curSun = null, curHit = null, heat = null, heatTok = 0, loopOn = false, lastT = 0;
const tz = () => site?.timezone || S.crit.search?.timezone || 'America/New_York';
const FH = () => +site?.floor_height_m || +site?.calibration?.floor_height_m || 3.2;
const BASE = () => Math.max(T.g, 0);
// a measured slab height for the listing's floor (site.slab_m) shifts every floor by the same offset
const siteOff = () => { const sm = +site?.slab_m, wf = +site?.window?.floor; if (Number.isFinite(sm) && sm > 0 && wf >= 1) return sm - (BASE() + (wf - 1) * FH()); return +site?.calibration?.lobby_m || +site?.lobby_m || 0; };
const slabOff = () => (st.slabOff != null ? st.slabOff : siteOff());
const maxFloor = () => Math.max(2, Math.floor((T.top - BASE() - Math.max(0, slabOff())) / FH()));
const MONTHS = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ');
const MODES = [['orbit', 'Orbit', 'Orbit the block'], ['win', 'Window', 'From the window'], ['in', 'Inside', 'Inside the apartment: its floor plan at the real floor and bearing'], ['plan', 'Plan', 'Street plan, north up'], ['top', 'Top', 'Top down']];
const PROV = {
  established: ['Established', 'good'], plan: ['Floor plan', 'good'], listing: ['Listing says', 'accent'], agent: ['Agent says', 'accent'],
  'photo-landmarks': ['Photo landmarks', 'accent'], model: ['Model', ''], assumed: ['Assumed', 'warn'], inferred: ['Inferred', 'warn'], manual: ['Your setting', ''],
};
const HSRC = { roof: 'Measured roof height', 'pluto-floors': 'PLUTO floor count × 3.2 m', 'osm-levels': 'OpenStreetMap levels × 3.2 m', 'osm-height': 'OpenStreetMap height tag', default: 'Default height (unknown)' };
const HSHORT = { roof: 'Measured roof', 'pluto-floors': 'PLUTO floors', 'osm-levels': 'OSM levels', 'osm-height': 'OSM height', default: 'Default (unknown)' };
const GSRC = { photogrammetric: 'Measured', manual: 'Mapped by hand', 'other (manual)': 'Mapped by hand', osm: 'OpenStreetMap', proposed: 'Tax lot / filing' };
const DSRC = { 'nyc-footprints': 'NYC Building Footprints', osm: 'OpenStreetMap' };
const STALE_YEARS = 6;
const XKEYS = ['bay', 'src', 'lm', 'slab', 'inWin'];
const ICON = {
  shadows: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="5.5"/><path d="M8 2.5a5.5 5.5 0 010 11z" fill="currentColor"/></svg>',
  labels: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="3.5" width="12" height="6.5" rx="2"/><path d="M8 10v3"/></svg>',
  streets: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M5 2L3 14M11 2l2 12M8 3v2M8 7.5v2M8 12v1.5"/></svg>',
  green: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M8 14V9.5M8 9.5C4.5 9.5 3 7 3 5.2 3 3 5 1.8 8 1.8s5 1.2 5 3.4c0 1.8-1.5 4.3-5 4.3z"/></svg>',
  future: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="2 2"><rect x="4" y="2.5" width="8" height="11" rx="1"/></svg>',
  ray: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="4" r="2"/><path d="M3 13l7-7"/></svg>',
  cone: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 13L2.5 4.5a8 8 0 0111 0z"/></svg>',
  target: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 14V5l4-3 4 3v9z"/><path d="M4 9h8" opacity=".6"/></svg>',
  cam: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 5.5h2.5l1.2-2h4.6l1.2 2H14v7.5H2z"/><circle cx="8" cy="9" r="2.4"/></svg>',
  cube: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M8 1.8l5.5 3v6.4L8 14.2l-5.5-3V4.8z"/><path d="M2.5 4.8L8 7.8l5.5-3M8 7.8v6.4"/></svg>',
  photo: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="M2.5 11l3.2-3.2 2.6 2.6 2-2 3.2 3.2"/><circle cx="10.8" cy="6" r="1.1"/></svg>',
  down: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M8 2.5v8M4.5 7l3.5 3.5L11.5 7M3 13.5h10"/></svg>',
  play: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M4.5 3v10l8.5-5z"/></svg>',
  pause: '<svg viewBox="0 0 16 16" fill="currentColor"><rect x="4" y="3" width="3" height="10" rx="1"/><rect x="9" y="3" width="3" height="10" rx="1"/></svg>',
  reset: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 8a5 5 0 109-3M12 2v3H9"/></svg>',
  heights: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M2.5 13.5V8h3v5.5M6.5 13.5V3h3v10.5M10.5 13.5V6h3v7.5M1.5 13.5h13"/></svg>',
};

// ------------------------------------------------------------------ layout
export function init() {
  const root = document.getElementById('view-unit');
  root.innerHTML = `<div class="view-pad u-pad">
    <header class="page-h u-head">
      <div class="t"><div class="u-eyebrow">Light and view</div><h1 id="uTitle">Unit 3D</h1><div class="u-sub" id="uSub"></div></div>
      <div class="actions"><label class="u-pick"><span class="sr">Listing</span><select id="unitSel"></select></label><span id="uLinks" class="u-links"></span>
        <button class="btn" type="button" id="uSnap" title="Download a PNG of the model with a caption">${ICON.cam}Snapshot</button>
        <button class="btn" type="button" id="uGlb" title="Download the 3D model (.glb) with its assumptions inside">${ICON.cube}3D model</button></div>
    </header>
    <div class="u-units" id="uUnits" hidden></div>
    <div class="u-grid" id="uGrid">
      <div class="u-main">
        <div id="stage" class="canvas-stage u-stage">
          <canvas id="gl" tabindex="0" aria-label="3D model of the building and its neighbours. Arrow keys turn the view, plus and minus zoom."></canvas>
          <img class="u-photo" id="uPhoto" alt="" hidden><video class="u-photo" id="uVid" muted playsinline preload="auto" hidden></video>
          <div class="u-labels" id="uLabels" aria-hidden="true"></div>
          <div class="float u-modes" id="uModes" role="group" aria-label="Camera">${MODES.map(([k, t, tip]) => `<button type="button" data-mode="${k}" title="${tip}" aria-pressed="false">${t}</button>`).join('')}</div>
          <div class="float u-tools" id="uTools" role="group" aria-label="Layers">
            ${[['shadows', 'Shadows'], ['labels', 'Labels'], ['heights', 'Heights: colour by height class, label roofs, 150 m and 300 m rings'], ['streets', 'Street names and centrelines'], ['future', 'Proposed buildings'], ['green', 'Parks and trees (OpenStreetMap; context only, not counted in sun hours)'], ['ray', 'Sun ray'], ['cone', 'View cone']].map(([k, t]) => `<button type="button" data-tg="${k}" title="${t}" aria-label="${t}" aria-pressed="false">${ICON[k]}</button>`).join('')}
            <hr><button type="button" id="uTarget" title="This building: solid" aria-label="This building display: solid">${ICON.target}<i class="u-tmode">S</i></button>
            <button type="button" id="uHome" title="Reset the camera" aria-label="Reset the camera">${ICON.reset}</button>
          </div>
          <button type="button" class="u-compass" id="uCompass" title="North. Click to face north" aria-label="Compass, click to face north"><svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="18.5"/><g id="uNeedle"><path d="M20 5l4 15h-8z" class="n"/><path d="M20 35l4-15h-8z" class="s"/><text x="20" y="4.2" text-anchor="middle">N</text></g></svg></button>
          <div class="hud u-hud" id="hud" aria-live="polite"></div>
          <div class="float u-card" id="uCard" hidden></div>
          <div class="float u-lens" id="uLens" hidden>
            <div class="field u-in-only"><label for="uInWin">Look out of</label><select id="uInWin"></select></div>
            <div class="field"><label for="uFov">Lens <span class="val" id="uFovV"></span></label><input type="range" id="uFov" min="35" max="110" value="70"></div>
            <div class="field"><label for="uYaw">Turn <span class="val" id="uYawV"></span></label><input type="range" id="uYaw" min="-90" max="90" value="0"></div>
            <div class="field"><label for="uPitch">Tilt <span class="val" id="uPitchV"></span></label><input type="range" id="uPitch" min="-15" max="60" value="6"></div>
            <div class="u-photo-ctl u-win-only">
              <label class="btn ghost u-photo-btn" title="Overlay a photo or a video taken from the window (it stays in this browser and is never uploaded)">${ICON.photo}<span id="uPhotoLbl">Match a photo</span><input type="file" id="uPhotoIn" accept="image/*,video/*" class="sr"></label>
              <div class="field" id="uVidT" hidden><label for="uFrame">Video frame <span class="val" id="uFrameV"></span></label><input type="range" id="uFrame" min="0" max="1000" value="0"></div>
              <div class="field" id="uPhotoOp" hidden><label for="uOpac">Overlay <span class="val" id="uOpacV"></span></label><input type="range" id="uOpac" min="0" max="100" value="55"></div>
              <button type="button" class="btn ghost" id="uPhotoX" hidden>Remove overlay</button>
            </div>
          </div>
          <div class="u-loading" id="uLoad"><span class="skeleton"></span>Building the model…</div>
        </div>
        <section class="panel u-time" id="timePanel" aria-label="Date and time"></section>
      </div>
      <aside class="u-side">
        <section class="panel" id="winPanel"></section>
        <section class="panel" id="sunPanel"></section>
        <section class="panel u-if" id="ifPanel" aria-label="What if"></section>
        <section class="panel" id="seePanel"></section>
        <section class="panel"><h3>Sun path against the skyline <span id="pathNote"></span></h3><canvas id="pathCv" class="plot u-path" role="img" aria-label="Sun path against the skyline seen from the window"></canvas>
          <div class="legend-row" id="pathLegend"></div></section>
        <section class="panel" id="heatPanel"></section>
        <section class="panel" id="nbPanel"></section>
        <section class="panel" id="evPanel"></section>
      </aside>
    </div>
    <section class="panel u-studies" id="studyPanel" aria-label="Studies" hidden></section></div>`;
  const ids = S.manifest.sites || [];
  const sel = $('unitSel');
  sel.innerHTML = ids.length ? ids.map((id) => { const L = byId(id); return `<option value="${esc(id)}">${esc(L ? label(L) : id)}${L?.floor ? ' · floor ' + Math.round(L.floor) : ''}</option>`; }).join('') : '<option>No site models yet</option>';
  sel.addEventListener('change', () => { location.hash = '#unit/' + encodeURIComponent(sel.value); });
  $('uSnap').addEventListener('click', snapshot);
  new ResizeObserver(fitGrid).observe(root);
  $('uGlb').addEventListener('click', exportGLB);
  on('theme', () => { stage?.setPalette(); if (site && hasWindow()) { buildApartment(); drawPathChart(); landmarks(); stage.dirty = true; studyStale(true); } });
  // read-only hook for headless checks (Playwright): never used by the page itself
  window.__unit3d = { st, get sun() { return curSun; }, get hit() { return curHit; }, get blockers() { return blkRows; }, get neighbours() { return NBR.length; }, get interior() { return !!stage?.interior; }, get stage() { return stage; } };
}

export async function show(id) {
  const ids = S.manifest.sites || [];
  if (!ids.length) {
    $('uGrid').innerHTML = `<div class="empty"><b>No site models yet</b>Run <code>apartmentscout site &lt;listing-id&gt;</code> for a listing, then <code>apartmentscout build</code>.</div>`;
    $('uSnap').hidden = $('uGlb').hidden = true; return;
  }
  id = id && ids.includes(id) ? id : st.id || ids[0];
  $('unitSel').value = id;
  if (id !== st.id) await load(id);
  stage?.resize(); drawPathChart();
  if (!loopOn) { loopOn = true; requestAnimationFrame(frame); }
}

/**
 * Desktop: the model, its time strip and the inspector fill the first screen exactly and the studies sit below
 * it, so the grid gets an explicit height (the view minus everything above the grid).
 */
function fitGrid() {
  const root = document.getElementById('view-unit'), g = $('uGrid'); if (!root || !g) return;
  if (!matchMedia('(min-width: 1181px)').matches || g.querySelector(':scope > .empty')) { g.style.height = ''; return; }
  const top = g.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop;
  g.style.height = Math.max(560, root.clientHeight - top - 20) + 'px';
}

// ------------------------------------------------------------------ load
async function load(id) {
  $('uLoad').hidden = false;
  const data = await loadJSON(`${S.base}/sites/${id}.json`, null);
  if (!data || !Array.isArray(data.b) || !data.b.length) {
    $('uLoad').innerHTML = `<div class="empty"><b>This site model could not be read</b>Rebuild it with <code>apartmentscout site ${esc(id)}</code>.</div>`;
    return;
  }
  site = data; st.id = id; st.manual = {}; st.moved = null; st.sel = null; st.src = null; st.slabOff = null; st.inWin = -1; st.lmSel = new Set(); heat = null; NBR = []; blkRows = [];
  plan = null;
  // an edited plan saved from the Floor plan studio or the tracer ("Use this plan in Unit 3D") wins over the source file
  let scen = null;
  try { scen = (await import('./plan/scenario-bridge.js')).getPlanScenario(id, { base: S.base }); } catch { scen = null; }
  if (scen?.plan) { try { plan = normalisePlan(scen.plan); plan._scenario = scen.label || 'edited plan'; } catch { plan = null; } }
  else if ((S.manifest.plans || []).includes(id)) { try { plan = normalisePlan(await loadJSON(`${S.base}/plans/${id}.json`, null)); } catch { plan = null; } }
  B0 = prepBuildings(site.b, site.holes && typeof site.holes === 'object' ? site.holes : null, site.components && typeof site.components === 'object' ? site.components : null);
  T = B0[site.target] || B0[0];
  edits = readEdits(new URLSearchParams(location.search), id);
  if (!edits.size && editsMem.has(id)) edits = new Map(editsMem.get(id)); // kept while you visit other units
  B = applyEdits(B0, edits);
  FACES = canonicalFaces(facesOf(T, 8, B), site.faces, site.version);
  LM = (site.lm || []).filter((l) => Array.isArray(l) && l.length >= 5).map((l) => ({ name: String(l[0]), idx: l[1], x: +l[2], y: +l[3], top: +l[4] }));
  FUT = (Array.isArray(site.future) ? site.future : []).filter((f) => f && Array.isArray(f.ring) && f.ring.length >= 3 && +f.h > 0);
  FUTB = FUT.length ? prepBuildings(FUT.map((f) => [+f.h, 0, 1, f.ring.flat()])) : [];
  BF = FUT.length ? B.concat(FUTB) : null;
  const L = listing(), qs = new URLSearchParams(location.search), w = site.window || {};
  // facade: the site file's choice unless it is a party wall, else the listing's exposure, else the longest open face
  const open = FACES.map((f, i) => [f, i]).filter(([f]) => !f.shared);
  const near = (brg) => open.reduce((best, cur) => { const d = Math.abs(angDiff(cur[0].bearing, brg)), bd = Math.abs(angDiff(best[0].bearing, brg)); return d < bd - 0.5 || (Math.abs(d - bd) <= 0.5 && cur[0].length > best[0].length) ? cur : best; }, open[0]);
  let fi = FACES.findIndex((f) => f.i === w.face);
  if (fi >= 0 && FACES[fi].shared) { st.moved = FACES[fi]; fi = open.length ? near(FACES[fi].bearing)[1] : -1; }
  if (fi < 0 && open.length) {
    const exp = (L.exposure || []).map(dirBearing).filter((x) => x != null);
    fi = exp.length ? near(exp[0])[1] : open.reduce((b, c) => (c[0].length > b[0].length ? c : b), open[0])[1];
  }
  st.face = fi;
  st.t = snapPosition(FACES[fi], w.t ?? 0.5, snapOpen) ?? 0.5;
  st.az = FACES[fi]?.bearing ?? 0;
  if (st.moved) st.manual = { face: true, pos: true };
  st.bay = Array.isArray(w.panes) && w.panes.length > 1;
  const mf = maxFloor();
  const qf = st.first ? +qs.get('floor') : NaN;
  st.floor = Math.max(1, Math.min(mf, Math.round(qf || w.floor || L.floor || mf / 2)));
  st.cmp = Math.min(mf, Math.max(1, st.floor + 9 > mf ? Math.max(1, st.floor - 9) : st.floor + 9));
  if (st.first) {
    const mi = moveIn();
    st.date = /^\d{4}-\d{2}-\d{2}$/.test(qs.get('date') || '') ? qs.get('date') : mi || new Date().toISOString().slice(0, 10);
    st.min = clampMin(+(qs.get('min') || 780));
    const m = qs.get('mode'); st.mode = m === 'window' || m === 'win' ? 'win' : m === 'inside' || m === 'in' ? 'in' : ['plan', 'top', 'orbit'].includes(m) ? m : 'orbit';
    // window settings carried in the page address besides the scenario: bay, photo-matched facing, slab height
    if (!qs.has('sv')) applyScenarioExtras(readScenarioExtras(qs)); // older unversioned links
    st.first = false;
  }
  const restored = readScenario(qs, id, FACES, mf);
  if (restored) {
    Object.assign(st, { face: restored.face, t: snapPosition(FACES[restored.face], restored.t, snapOpen), az: restored.az, cmp: restored.cmp });
    applyScenarioExtras(restored);
    st.manual = { face: true, pos: true, az: true, floor: true };
  }
  st.floor = Math.min(maxFloor(), st.floor); st.cmp = Math.min(maxFloor(), st.cmp);
  header(); fitGrid();
  if (!stage) {
    stage = new UnitStage($('gl'), $('stage'), $('uLabels'));
    stage.onCompass = (az) => { const n = $('uNeedle'); if (n) n.setAttribute('transform', `rotate(${-az} 20 20)`); };
    wireStage();
    new ResizeObserver(() => { stage.resize(); }).observe($('stage'));
    new ResizeObserver(() => drawPathChart()).observe($('pathCv').parentElement);
  }
  stage.opts.streets = true; stage.opts.future = restored?.future ?? true;
  if (restored) Object.assign(stage.look, restored.look);
  await new Promise((r) => requestAnimationFrame(r)); // let the loading state paint before the heavy build
  stage.build({ B: B0, T, ti: B0.indexOf(T), streets: Array.isArray(site.streets) ? site.streets : [], future: FUT, green: site.green || null, lm: LM, ownLabel: site.listing?.building || L.building || 'This building' });
  stage.setFloorH(FH());
  for (const [bi, h] of edits) stage.setHeight(bi, h / Math.max(0.01, B0[bi].top - B0[bi].g), B0[bi].g, B);
  stage.resize();
  $('uSnap').disabled = $('uGlb').disabled = !hasWindow();
  unitsRow(); fitGrid();
  if (!hasWindow()) {
    st.mode = 'orbit'; st.playing = false; ++heatTok;
    profA = profB = profF = statesA = statesB = null; interior = null;
    $('timePanel').innerHTML = ''; $('studyPanel').innerHTML = ''; $('studyPanel').hidden = $('ifPanel').hidden = true; $('winPanel').innerHTML = '<h3>Window unresolved</h3><p>No exposed facade passed the placement checks. The city remains available to inspect; a verified window position is needed for sunlight and outlook estimates.</p>';
    evidencePanel(); syncTools(); setMode('orbit', true); unresolvedWindow();
    stage.resetOrbit(false); closeCard(); $('uLoad').hidden = true; return;
  }
  buildApartment();
  $('studyPanel').hidden = $('ifPanel').hidden = false;
  buildTimePanel(); buildWindowPanel(); buildStudies(); evidencePanel(); syncTools();
  setMode(st.mode, true);
  refreshWindow(true);
  stage.resetOrbit(false); if (st.mode === 'top') stage.topDown(false);
  closeCard();
  $('uLoad').hidden = true;
}
const listing = () => byId(st.id) || site?.listing || {};
const moveIn = () => (S.crit.search?.move_in?.earliest ? String(S.crit.search.move_in.earliest).slice(0, 10) : null);
const clampMin = (m) => Math.max(STRIP_FROM, Math.min(STRIP_TO - STRIP_STEP, Number.isFinite(m) ? m : 780));
const ymd = () => st.date.split('-').map(Number);
const hasWindow = () => !!FACES[st.face] && !FACES[st.face].shared;
function applyScenarioExtras(extra) {
  if (!extra) return;
  for (const k of ['bay', 'src', 'slabOff', 'inWin']) if (Object.hasOwn(extra, k)) st[k] = extra[k];
  if (extra.landmarks) st.lmSel = new Set(extra.landmarks.filter((name) => LM.some((l) => l.name === name)));
}
/** Pane offsets of the window: null for a flat window, the site file's panes or a 45° bay. */
const panes = () => (st.bay ? (Array.isArray(site?.window?.panes) && site.window.panes.length > 1 ? site.window.panes.map(Number) : BAY) : null);
const spread = () => { const p = panes(); return p ? Math.max(...p.map((o) => Math.abs(o))) : 0; };
const offAxis = (az) => Math.min(...paneFacings(st.az, panes()).map((f) => Math.abs(angDiff(az, f))));
const planSaysBay = () => !!plan?.windows?.some((w) => /\bbay\b/i.test(w.note || ''));

function header() {
  const L = listing();
  $('uTitle').innerHTML = `${esc(L.building || site.listing?.building || L.address || st.id)}${L.unit ? ` <span>${esc(L.unit)}</span>` : ''}`;
  const links = [];
  if ((S.manifest.plans || []).includes(st.id)) links.push(`<a class="btn ghost" href="#plan/${esc(st.id)}">${ICONS.plan}Floor plan</a>`);
  if ((S.manifest.dossiers || []).includes(st.id)) links.push(`<a class="btn ghost" href="#records/${esc(st.id)}">${ICONS.doc}Records</a>`);
  $('uLinks').innerHTML = links.join('');
  subline();
}
function provenance() {
  const P = site.provenance && typeof site.provenance === 'object' ? site.provenance : {}, L = listing();
  return {
    exposure: st.src === 'photo-landmarks' ? 'photo-landmarks' : st.manual.face || st.manual.az ? 'manual' : P.exposure || L.exposure_source || (L.exposure?.length ? 'listing' : 'assumed'),
    position: st.manual.pos ? 'manual' : P.window_position || 'assumed',
    floor: st.manual.floor ? 'manual' : P.floor || (L.floor_inferred ? 'inferred' : L.floor != null ? 'listing' : 'assumed'),
  };
}
const provChip = (k) => { const [t, c] = PROV[k] || [String(k), '']; return `<span class="pill ${c}">${esc(t)}</span>`; };
function subline() {
  const L = listing(), p = provenance(), P = site.provenance || {};
  if (!hasWindow()) { $('uSub').textContent = `${L.address || site.listing?.address || ''} · Window unresolved`; return; }
  const tgt = P.target === 'bin' ? 'Matched by BIN' : P.target === 'bbl' ? 'Matched by tax lot' : P.target === 'nearest' ? 'Nearest footprint' : '';
  $('uSub').innerHTML = `<span class="u-addr">${esc(L.address || site.listing?.address || '')}</span>
    <span class="u-fact"><b>Floor ${st.floor}</b>${provChip(p.floor)}</span>
    <span class="u-fact"><b>Faces ${compass(st.az)} ${Math.round(st.az)}°${st.bay ? ' · bay' : ''}</b>${provChip(p.exposure)}</span>
    <span class="u-fact"><b>Window position</b>${provChip(p.position)}</span>
    ${tgt ? `<span class="u-fact"><b>Building</b><span class="pill ${P.target === 'nearest' ? 'warn' : 'good'}" title="${esc(+P.target_offset_m > 10 ? `The address point is ${Math.round(+P.target_offset_m)} m outside the footprint, in the street` : 'How the building was picked from the footprints')}">${tgt}</span></span>` : ''}`;
}

// ------------------------------------------------------------------ units in this building
function sameBuilding() {
  const L = listing(), key = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const bk = key(L.building || site.listing?.building);
  if (!bk) return [];
  return S.listings.filter((x) => key(x.building) === bk);
}
function unitsRow() {
  const all = sameBuilding(), sites = S.manifest.sites || [];
  if (all.length < 2) { $('uUnits').hidden = true; $('uUnits').innerHTML = ''; return; }
  const aliasOf = new Map();
  for (const x of all) for (const a of Array.isArray(x.aliases) ? x.aliases : []) if (a && a !== x.id && !aliasOf.has(x.id)) aliasOf.set(a, x.unit || x.id);
  const band = plan?.provenance?.floor_band, m = /^(\d+)\s*[-–]\s*(\d+)$/.exec(band || '');
  const units = all.map((x) => ({
    L: x, cur: x.id === st.id, site: sites.includes(x.id), alias: aliasOf.get(x.id) || null,
    band: x.id === st.id && m && x.floor != null && (x.floor < +m[1] || x.floor > +m[2]) ? `The floor plan is for floors ${m[1]}–${m[2]}, not floor ${Math.round(x.floor)}` : '',
  })).sort((a, b) => (+['gone', 'rejected'].includes(a.L.status) - +['gone', 'rejected'].includes(b.L.status)) || (b.cur - a.cur) || ((a.L.floor ?? 999) - (b.L.floor ?? 999)));
  $('uUnits').innerHTML = unitsBoard(units); $('uUnits').hidden = false;
}
function tryUnit(id) {
  if (id === st.id) return;
  if ((S.manifest.sites || []).includes(id)) { location.hash = '#unit/' + encodeURIComponent(id); return; }
  const U = byId(id); if (!U || !hasWindow()) return;
  if (U.floor != null) { st.floor = Math.max(1, Math.min(maxFloor(), Math.round(U.floor))); st.manual.floor = true; $('uFloor').value = st.floor; }
  const e = (U.exposure || []).map(dirBearing).filter((x) => x != null);
  if (e.length) {
    const cand = FACES.map((f, i) => [f, i]).filter(([f]) => !f.shared).sort((a, b) => Math.abs(angDiff(a[0].bearing, e[0])) - Math.abs(angDiff(b[0].bearing, e[0])))[0];
    if (cand) { st.face = cand[1]; st.az = cand[0].bearing; st.t = snapPosition(cand[0], st.t, snapOpen) ?? st.t; st.manual.face = true; st.src = null; $('uFace').value = st.face; $('uAz').value = Math.round(st.az); }
  }
  refreshWindow(true);
  toast(`${U.unit || id}: floor ${U.floor != null ? Math.round(U.floor) : '?'}${e.length ? `, facing ${U.exposure.join(' ')}` : ', facing unknown'} in this building's model`);
}

// ------------------------------------------------------------------ stage wiring
function wireStage() {
  $('uModes').querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
  $('uTools').querySelectorAll('[data-tg]').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.tg; stage.opts[k] = !stage.opts[k]; stage.applyOpts(); syncTools();
    if (k === 'heights') { stage.recolor(); if (st.study === 'heights') renderStudy(); return; }
    if (k === 'future' && FUT.length) { refreshWindow(false); ifPanel(); } else refreshTime();
  }));
  $('uTarget').addEventListener('click', () => {
    const order = ['solid', 'faint', 'hidden']; stage.opts.target = order[(order.indexOf(stage.opts.target) + 1) % 3]; stage.applyOpts(); syncTools();
    if (!hasWindow()) unresolvedWindow();
  });
  $('uHome').addEventListener('click', () => { if (st.mode === 'plan') stage.resetPlan(); else if (st.mode === 'top') stage.topDown(true); else if (st.mode === 'win' || st.mode === 'in') { setLook(70, 0, 6); } else stage.resetOrbit(true); });
  $('uCompass').addEventListener('click', faceNorth);
  for (const [id, k] of [['uFov', 'fov'], ['uYaw', 'yaw'], ['uPitch', 'pitch']]) $(id).addEventListener('input', (e) => { stage.look[k] = +e.target.value; syncLens(); stage.dirty = true; syncUrlSoon(); if (st.study === 'floors') studyStale(); });
  $('uInWin').addEventListener('change', (e) => { st.inWin = +e.target.value; stage.setInteriorEye(st.inWin); setLook(stage.look.fov, 0, 6); hud(curSun, hudState()); });
  // photo matching: the file is read in this browser only (an object URL), never uploaded or stored
  // a video works the same way: pick the frame that shows the skyline best with the frame slider
  $('uPhotoIn').addEventListener('change', (e) => {
    const f = e.target.files?.[0]; e.target.value = ''; if (!f) return;
    const vid = /^video\//.test(f.type);
    if (!vid && !/^image\//.test(f.type)) { toast('Choose an image or a video file'); return; }
    if (st.photo) URL.revokeObjectURL(st.photo);
    st.photo = URL.createObjectURL(f); st.video = vid;
    const img = $('uPhoto'), v = $('uVid');
    if (vid) { img.removeAttribute('src'); v.src = st.photo; v.addEventListener('loadedmetadata', () => { $('uFrame').max = Math.max(1, Math.floor(v.duration * 10)); $('uFrame').value = 0; syncFrame(); }, { once: true }); }
    else { v.removeAttribute('src'); v.load?.(); img.src = st.photo; }
    overlayVisible(); overlayOpacity();
    $('uPhotoOp').hidden = $('uPhotoX').hidden = false; $('uVidT').hidden = !vid; $('uPhotoLbl').textContent = vid ? 'Another photo or video' : 'Another photo';
    stage.showHidden = true; st.allLm = true; landmarks(); stage.dirty = true; fill($('uOpac')); $('uOpacV').textContent = $('uOpac').value + '%';
    toast(`${vid ? 'Video' : 'Photo'} overlaid. ${vid ? 'Pick a frame, then t' : 'T'}urn, tilt and zoom until the skyline lines up, then tick the landmarks you can see`, 4200);
  });
  $('uFrame').addEventListener('input', syncFrame);
  $('uOpac').addEventListener('input', (e) => { overlayOpacity(); $('uOpacV').textContent = e.target.value + '%'; fill(e.target); });
  $('uPhotoX').addEventListener('click', clearPhoto);
  $('uUnits').addEventListener('click', (e) => { const b = e.target.closest('[data-unit]'); if (b) tryUnit(b.dataset.unit); });
  $('ifPanel').addEventListener('click', (e) => { const x = e.target.closest('[data-unedit]'); if (x) { setEdit(+x.dataset.unedit, null, true); ifPanel(true); syncUrl(); } if (e.target.closest('#uIfReset')) { resetEdits(); syncUrl(); } });
  $('sunPanel').addEventListener('click', (e) => { if (e.target.closest('#uSamples')) samplesCSV(); });
  // click to inspect a building; drag to look around in window and inside modes
  const cv = $('gl'); let down = null;
  const looking = () => st.mode === 'win' || st.mode === 'in';
  cv.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, yaw: stage.look.yaw, pitch: stage.look.pitch, id: e.pointerId }; if (looking()) cv.setPointerCapture(e.pointerId); });
  cv.addEventListener('pointermove', (e) => {
    if (!down || !looking() || !(e.buttons & 1)) return;
    const k = 70 / (cv.clientHeight || 500) * (stage.look.fov / 70);
    setLook(stage.look.fov, down.yaw - (e.clientX - down.x) * k, down.pitch + (e.clientY - down.y) * k);
  });
  cv.addEventListener('pointerup', (e) => {
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5) { const bi = stage.pick(e.clientX, e.clientY); bi == null ? closeCard() : openCard(bi); }
    down = null;
  });
  cv.addEventListener('keydown', onStageKey);
  addEventListener('keydown', (e) => {
    if ($('view-unit').hidden || !site) return;
    const tag = e.target.tagName;
    if (e.key === 'Escape' && !$('uCard').hidden) { closeCard(); return; }
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'p') { togglePlay(); e.preventDefault(); }
    else if (e.key === ',' || e.key === '.') { setTime(st.min + (e.key === '.' ? 15 : -15)); e.preventDefault(); }
  });
  // side panels: delegated clicks (blockers, neighbours, landmarks, roof bars)
  for (const id of ['sunPanel', 'seePanel', 'nbPanel']) $(id).addEventListener('click', sideClick);
  $('seePanel').addEventListener('change', (e) => {
    const c = e.target.closest('[data-lm]'); if (!c) return;
    if (c.checked) st.lmSel.add(c.dataset.lm); else st.lmSel.delete(c.dataset.lm);
    syncUrl(); const n = $('uLmN'); if (n) n.textContent = lmMatchedTxt();
  });
  $('seePanel').addEventListener('toggle', (e) => { if (e.target.matches?.('.u-all-lm')) st.allLm = e.target.open; }, true);
  $('nbPanel').addEventListener('toggle', (e) => { if (e.target.matches?.('.u-nb-d')) st.nbOpen = e.target.open; }, true);
}
function sideClick(e) {
  const s = e.target.closest('[data-sort]');
  if (s) { const k = s.dataset.sort; st.nbSort = { key: k, dir: st.nbSort.key === k ? -st.nbSort.dir : NB_FIRST_DIR[k] || 1 }; neighboursPanel(); return; }
  if (e.target.closest('#uNbCsv')) { csvNeighbours(); return; }
  if (e.target.closest('#uUseFace')) { useFacade(); return; }
  const r = e.target.closest('[data-bi]');
  if (r && !e.target.closest('input')) { const bi = +r.dataset.bi; if (bi >= 0 && bi < B.length) { openCard(bi); if (st.mode === 'win' || st.mode === 'in') aimAt(bi); } }
}
function aimAt(bi) {
  const b = B[bi], w = winPos(st.floor), az = bearingTo(w.x, w.y, (b.bb[0] + b.bb[2]) / 2, (b.bb[1] + b.bb[3]) / 2);
  const off = st.mode === 'in' ? (interior?.windows[st.inWin]?.bearingOff || 0) : 0;
  setLook(stage.look.fov, angDiff(az, st.az + off), stage.look.pitch);
}
function onStageKey(e) {
  const k = e.key, step = e.shiftKey ? 15 : 5;
  if (st.mode === 'win' || st.mode === 'in') {
    const L = stage.look;
    if (k === 'ArrowLeft') setLook(L.fov, L.yaw - step, L.pitch); else if (k === 'ArrowRight') setLook(L.fov, L.yaw + step, L.pitch);
    else if (k === 'ArrowUp') setLook(L.fov, L.yaw, L.pitch + step); else if (k === 'ArrowDown') setLook(L.fov, L.yaw, L.pitch - step);
    else if (k === '+' || k === '=') setLook(L.fov - 5, L.yaw, L.pitch); else if (k === '-') setLook(L.fov + 5, L.yaw, L.pitch);
    else return;
  } else {
    const cam = stage.activeCam(), ctl = st.mode === 'plan' ? stage.planControls : stage.controls;
    if (st.mode === 'plan') {
      const d = 25 / cam.zoom, mv = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, -d], ArrowDown: [0, d] }[k];
      if (mv) { cam.position.x += mv[0]; ctl.target.x += mv[0]; cam.position.z += mv[1]; ctl.target.z += mv[1]; }
      else if (k === '+' || k === '=') cam.zoom = Math.min(8, cam.zoom * 1.2); else if (k === '-') cam.zoom = Math.max(0.25, cam.zoom / 1.2); else return;
      cam.updateProjectionMatrix(); ctl.update();
    } else {
      const off = cam.position.clone().sub(ctl.target), r = off.length();
      let th = Math.atan2(off.x, off.z), ph = Math.acos(Math.max(-1, Math.min(1, off.y / r)));
      if (k === 'ArrowLeft') th -= step * DEG; else if (k === 'ArrowRight') th += step * DEG;
      else if (k === 'ArrowUp') ph = Math.max(0.02, ph - step * DEG); else if (k === 'ArrowDown') ph = Math.min(Math.PI * 0.49, ph + step * DEG);
      else if (k === '+' || k === '=' || k === '-') { const f = k === '-' ? 1.15 : 1 / 1.15; off.multiplyScalar(f); cam.position.copy(ctl.target).add(off); ctl.update(); stage.dirty = true; e.preventDefault(); return; }
      else return;
      cam.position.set(ctl.target.x + r * Math.sin(ph) * Math.sin(th), ctl.target.y + r * Math.cos(ph), ctl.target.z + r * Math.sin(ph) * Math.cos(th)); ctl.update();
    }
  }
  stage.dirty = true; e.preventDefault();
}
function faceNorth() {
  if (st.mode === 'win') { setLook(stage.look.fov, angDiff(0, st.az), stage.look.pitch); return; }
  if (st.mode === 'in') { setLook(stage.look.fov, angDiff(0, st.az + (interior?.windows[st.inWin]?.bearingOff || 0)), stage.look.pitch); return; }
  if (st.mode === 'plan') return;
  const cam = stage.orbitCam, ctl = stage.controls, off = cam.position.clone().sub(ctl.target), r = Math.hypot(off.x, off.z);
  cam.position.set(ctl.target.x, cam.position.y, ctl.target.z + r); ctl.update(); stage.dirty = true;
}
function setLook(fov, yaw, pitch) {
  stage.look.fov = Math.max(35, Math.min(110, fov)); stage.look.yaw = Math.max(-90, Math.min(90, yaw)); stage.look.pitch = Math.max(-15, Math.min(60, pitch));
  $('uFov').value = stage.look.fov; $('uYaw').value = stage.look.yaw; $('uPitch').value = stage.look.pitch; syncLens(); stage.dirty = true;
  syncUrlSoon(); if (st.study === 'floors') studyStale();
}
function syncLens() {
  const L = stage.look;
  $('uFov').value = L.fov; $('uYaw').value = L.yaw; $('uPitch').value = L.pitch;
  $('uFovV').textContent = Math.round(L.fov) + '°'; $('uYawV').textContent = (L.yaw > 0 ? '+' : '') + Math.round(L.yaw) + '°'; $('uPitchV').textContent = Math.round(L.pitch) + '°';
  for (const id of ['uFov', 'uYaw', 'uPitch']) fill($(id));
}
function setMode(m, quiet = false) {
  if (!hasWindow() && (m === 'win' || m === 'in')) m = 'orbit';
  if (m === 'in' && !interior) buildApartment();
  st.mode = m; stage.setMode(m);
  $('uModes').querySelectorAll('[data-mode]').forEach((b) => { b.disabled = !hasWindow() && (b.dataset.mode === 'win' || b.dataset.mode === 'in'); b.classList.toggle('on', b.dataset.mode === m); b.setAttribute('aria-pressed', String(b.dataset.mode === m)); });
  $('uLens').hidden = m !== 'win' && m !== 'in'; $('stage').dataset.mode = m;
  overlayVisible();
  if (m === 'win' || m === 'in') syncLens();
  if (!quiet) { refreshTime(); syncUrl(); }
}
function syncTools() {
  $('uTools').querySelectorAll('[data-tg]').forEach((b) => {
    const k = b.dataset.tg, on = !!stage.opts[k];
    const na = (k === 'streets' && !(site.streets || []).length) || (k === 'future' && !FUT.length) || (k === 'green' && !site.green);
    b.classList.toggle('on', on && !na); b.setAttribute('aria-pressed', String(on && !na)); b.disabled = na;
    if (na) b.title = k === 'streets' ? 'No street centrelines in this site file' : k === 'green' ? 'No parks or trees in this site file: rebuild it with apartmentscout site' : 'No proposed buildings in this site file';
  });
  const t = stage.opts.target, nm = { solid: 'solid', faint: 'faint', hidden: 'hidden' }[t];
  $('uTarget').title = `This building: ${nm} (click to change)${interior ? '. Faint or hidden shows the apartment inside' : ''}`; $('uTarget').setAttribute('aria-label', `This building display: ${nm}`);
  $('uTarget').querySelector('.u-tmode').textContent = t[0].toUpperCase(); $('uTarget').classList.toggle('on', t !== 'solid');
}
function overlayVisible() { $('uPhoto').hidden = st.mode !== 'win' || !st.photo || st.video; $('uVid').hidden = st.mode !== 'win' || !st.photo || !st.video; }
function overlayOpacity() { const o = $('uOpac').value / 100; $('uPhoto').style.opacity = o; $('uVid').style.opacity = o; }
function syncFrame() {
  const v = $('uVid'), t = +$('uFrame').value / 10;
  if (Number.isFinite(v.duration)) v.currentTime = Math.min(t, Math.max(0, v.duration - 0.05));
  $('uFrameV').textContent = `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}.${Math.floor((t * 10) % 10)}`; fill($('uFrame'));
}
function clearPhoto() {
  if (st.photo) URL.revokeObjectURL(st.photo);
  st.photo = null; st.video = false; const img = $('uPhoto'); img.hidden = true; img.removeAttribute('src');
  const v = $('uVid'); v.hidden = true; v.removeAttribute('src'); v.load?.();
  $('uPhotoOp').hidden = $('uPhotoX').hidden = $('uVidT').hidden = true; $('uPhotoLbl').textContent = 'Match a photo';
  stage.showHidden = false; stage.dirty = true;
}

// ------------------------------------------------------------------ the apartment in the city
function buildApartment() {
  if (!stage?.scene || !site || !hasWindow()) return;
  interior = buildInterior(plan || genericPlan(), { generic: !plan });
  stage.setInterior(interior);
  const ws = interior.windows;
  if (st.inWin < 0 || st.inWin >= ws.length) {
    const front = ws.map((w, i) => [w, i]).filter(([w]) => w.facade);
    st.inWin = (front.find(([w]) => /living/i.test(w.room)) || front[0] || [null, 0])[1];
  }
  stage.setInteriorEye(st.inWin);
  $('uInWin').innerHTML = ws.map((w, i) => `<option value="${i}">${esc(w.room)}${w.note ? ' · ' + esc(w.note) : ''}${w.facade ? '' : ' (side)'}</option>`).join('');
  $('uInWin').value = st.inWin;
  syncTools();
}

// ------------------------------------------------------------------ geometry helpers
function winPos(floor, t = st.t) {
  const f = FACES[st.face]; if (!f) return { x: 0, y: 0, z: 10, fx: 0, fy: 0 };
  const x = f.a[0] + (f.b[0] - f.a[0]) * t, y = f.a[1] + (f.b[1] - f.a[1]) * t;
  const nx = Math.sin(f.bearing * DEG), ny = Math.cos(f.bearing * DEG);
  return { x: x + nx * 0.4, y: y + ny * 0.4, z: slabZ(floor) + 1.6, fx: x, fy: y };
}
const slabZ = (floor) => BASE() + (floor - 1) * FH() + slabOff();
const sunAt = (min) => { const [y, m, d] = ymd(); return sunPos(zonedMs(y, m - 1, d, min, tz()), site.origin.lat, site.origin.lon); };
const tableFor = (step = 6) => { const [y, m, d] = ymd(); return table(y, m - 1, d, site.origin.lat, site.origin.lon, tz(), step); };
const blockerSet = () => (stage.opts.future && BF ? BF : B);
const centre = (b) => [(b.bb[0] + b.bb[2]) / 2, (b.bb[1] + b.bb[3]) / 2];

// ------------------------------------------------------------------ time panel and day strip
function buildTimePanel() {
  const mi = moveIn(), y = +st.date.slice(0, 4);
  const presets = [[mi, 'Move-in'], [`${y}-12-21`, 'Dec 21'], [`${y}-03-20`, 'Mar 20'], [`${y}-06-21`, 'Jun 21'], [`${y}-09-22`, 'Sep 22']].filter((q) => q[0]);
  $('timePanel').innerHTML = `<div class="u-time-top">
      <div class="u-clock"><b id="uClock"></b><span id="uDateTxt"></span></div>
      <div class="u-date-ctl"><input type="date" id="uDate" aria-label="Date" value="${esc(st.date)}">
        <div class="seg" id="uQuick" role="group" aria-label="Date presets">${presets.map(([d, t]) => `<button type="button" data-d="${esc(d)}">${t}</button>`).join('')}</div></div>
      <button class="btn" type="button" id="uPlay" aria-pressed="false" title="Play the day (p)">${ICON.play}<span>Play day</span></button>
    </div>
    <div class="u-strip">
      <div class="u-strip-keys"><span id="uKeyA"></span><span id="uKeyB"></span></div>
      <div class="u-strip-track" id="uStrip" role="slider" tabindex="0" aria-label="Time of day" aria-valuemin="${STRIP_FROM}" aria-valuemax="${STRIP_TO}">
        <div class="u-strip-bar" id="uBarA"></div><div class="u-strip-bar cmp" id="uBarB"></div>
        <div class="u-strip-axis">${stripTicks()}</div>
        <div class="u-strip-cur" id="uCur"><i></i></div>
      </div>
    </div>
    <div class="legend-row u-strip-legend"><span><i class="sw s3"></i>Direct sun on the window</span><span id="uKeySide" hidden><i class="sw s4"></i>Through a side pane</span><span><i class="sw s2"></i>Shaded by buildings (hover to see which)</span><span><i class="sw s1"></i>Sun behind the facade</span><span><i class="sw s0"></i>Night</span><span class="faint">Click or drag the strip to set the time. Arrow keys step 5 minutes.</span></div>`;
  $('uDate').addEventListener('change', (e) => { if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) { st.date = e.target.value; dateChanged(); } });
  $('uQuick').querySelectorAll('[data-d]').forEach((b) => b.addEventListener('click', () => { st.date = b.dataset.d; $('uDate').value = st.date; dateChanged(); }));
  $('uPlay').addEventListener('click', togglePlay);
  const tr = $('uStrip');
  const fromX = (e) => { const r = tr.getBoundingClientRect(); return STRIP_FROM + Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * (STRIP_TO - STRIP_FROM); };
  tr.addEventListener('pointerdown', (e) => { tr.setPointerCapture(e.pointerId); tr.focus({ preventScroll: true }); setTime(Math.round(fromX(e) / 5) * 5); });
  tr.addEventListener('pointermove', (e) => { if (tr.hasPointerCapture(e.pointerId)) setTime(Math.round(fromX(e) / 5) * 5); });
  tr.addEventListener('keydown', (e) => {
    const d = { ArrowLeft: -5, ArrowDown: -5, ArrowRight: 5, ArrowUp: 5, PageDown: -60, PageUp: 60 }[e.key];
    if (d) setTime(st.min + (e.shiftKey ? d * 6 : d)); else if (e.key === 'Home') setTime(STRIP_FROM); else if (e.key === 'End') setTime(STRIP_TO - STRIP_STEP); else return;
    e.preventDefault();
  });
}
function setTime(m) { st.min = clampMin(m); refreshTime(); syncUrlSoon(); if (st.study !== 'heights') studyStale(); }
function dateChanged() { statesA = statesB = null; refreshStrip(); refreshTime(); if (heat && heat.year !== +st.date.slice(0, 4)) computeHeat(); else drawHeat(); ifPanel(); studyStale(); syncUrl(); }
function togglePlay() {
  if (!hasWindow()) return;
  st.playing = !st.playing; lastT = 0;
  const b = $('uPlay'); b.classList.toggle('primary', st.playing); b.setAttribute('aria-pressed', String(st.playing));
  b.innerHTML = st.playing ? `${ICON.pause}<span>Pause</span>` : `${ICON.play}<span>Play day</span>`;
}
/** Short description of a blocker for tooltips: "326 W 37th St, 70 m tall, 57 m away". */
function blkName(bi) {
  if (bi == null || bi < 0) return 'buildings';
  const BB = blockerSet(), b = BB[bi]; if (!b) return 'buildings';
  const w = winPos(st.floor), d = distToBuilding(b, w.x, w.y);
  return `${bname(bi, true)}, ${Math.round(b.top - Math.max(b.g, 0))} m tall, ${Math.round(d)} m away`;
}
function refreshStrip() {
  if (!hasWindow()) return;
  const [y, m, d] = ymd(), o = site.origin, P = panes(), BB = blockerSet(), w = winPos(st.floor);
  const run = (yy, mm, dd) => dayBlockers(yy, mm, dd, o.lat, o.lon, tz(), BB, w, profF && stage.opts.future ? profF : profA, st.az, STRIP_FROM, STRIP_TO, STRIP_STEP, P);
  const today = run(y, m - 1, d);
  statesA = today.states; blkA = today.bi;
  statesB = dayStates(y, m - 1, d, o.lat, o.lon, tz(), profB, st.az, STRIP_FROM, STRIP_TO, STRIP_STEP, P);
  $('uBarA').innerHTML = stripBar(statesA, blkA, blkName); $('uBarB').innerHTML = stripBar(statesB);
  $('uKeyA').textContent = 'Fl ' + st.floor; $('uKeyB').textContent = 'Fl ' + st.cmp;
  $('uKeySide').hidden = !P;
  // the buildings that take the most sun: today, and on the 15th of December and of June
  const mt = blockerMinutes(today), md = blockerMinutes(run(y, 11, 15)), mj = blockerMinutes(run(y, 5, 15));
  const ids = new Set([...mt.keys(), ...md.keys(), ...mj.keys()]);
  blkRows = [...ids].map((bi) => {
    const b = BB[bi], dd = distToBuilding(b, w.x, w.y);
    return { bi, name: bname(bi, true), sub: `${Math.round(b.top - Math.max(b.g, 0))} m tall · ${Math.round(dd)} m away${bi >= B.length ? ' · proposed' : ''}`, today: mt.get(bi) || 0, dec: md.get(bi) || 0, jun: mj.get(bi) || 0 };
  }).sort((a, b) => b.today - a.today || b.dec + b.jun - a.dec - a.jun).slice(0, 5);
}

// ------------------------------------------------------------------ window panel
function buildWindowPanel() {
  const mf = maxFloor(), shared = FACES.filter((f) => f.shared).length, streets = site.streets || [];
  // shared walls stay listed, disabled, with the reason (a rejected hypothesis is still worth seeing)
  const opts = FACES.map((f, i) => [f, i]).sort((a, b) => a[0].shared - b[0].shared || a[0].bearing - b[0].bearing || b[0].length - a[0].length).map(([f, i]) => {
    const mid = [(f.a[0] + f.b[0]) / 2, (f.a[1] + f.b[1]) / 2], s = f.shared ? null : streetAhead(streets, mid[0], mid[1], f.bearing);
    return `<option value="${i}"${f.shared ? ' disabled' : ''}>${compass(f.bearing)} ${Math.round(f.bearing)}° · ${Math.round(f.length)} m${f.shared ? ' · shared wall, no windows' : ''}${f.court ? ' · light court' : ''}${s ? ' · ' + esc(s.name) : ''}</option>`;
  }).join('');
  const sitePanes = Array.isArray(site.window?.panes) && site.window.panes.length > 1;
  $('winPanel').innerHTML = `<h3>Window <span id="uWinProv"></span></h3>
    <div class="field"><label for="uFace">Facade</label><select id="uFace">${opts}</select></div>
    ${shared ? `<p class="u-note">${shared} shared wall${shared > 1 ? 's are' : ' is'} listed but cannot be chosen: a neighbour is built against ${shared > 1 ? 'them' : 'it'}, so ${shared > 1 ? 'they have' : 'it has'} no windows.</p>` : ''}
    ${st.moved ? `<p class="u-note warn">The site file put the window on a shared wall (${Math.round(st.moved.bearing)}°). Moved to the nearest open facade.</p>` : ''}
    <div class="u-sliders">
      <div class="field"><label for="uPos">Position along facade <span class="val" id="uPosV"></span></label><input type="range" id="uPos" min="2" max="98" value="${Math.round(st.t * 100)}"></div>
      <div class="field"><label for="uFloor">Floor <span class="val" id="uFloorV"></span></label><input type="range" id="uFloor" min="1" max="${mf}" value="${st.floor}"></div>
      <div class="field"><label for="uCmp">Compare floor <span class="val" id="uCmpV"></span></label><input type="range" id="uCmp" min="1" max="${mf}" value="${st.cmp}"></div>
      <div class="field"><label for="uAz">Window faces <span class="val" id="uAzV"></span></label><input type="range" id="uAz" min="0" max="359" value="${Math.round(st.az)}"></div>
    </div>
    <div class="u-win-row">
      <label class="tg u-bay ${st.bay ? 'on' : ''}"><input type="checkbox" class="sr" id="uBay" ${st.bay ? 'checked' : ''}><span class="switch"></span><span class="lbl">Bay window<small id="uBayTxt"></small></span></label>
      <div class="field u-slab"><label for="uSlab"><span>Floor <span id="uSlabF"></span> above the street</span><span id="uSlabSrc"></span></label><div class="u-slab-in"><input type="number" id="uSlab" step="0.1" min="0" max="600" inputmode="decimal" aria-describedby="uSlabHelp"><span>m</span></div><small id="uSlabHelp"></small></div>
    </div>
    ${planSaysBay() && !sitePanes ? `<p class="u-note" id="uBayNote">The floor plan marks a bay window. <button type="button" class="u-link" id="uBayHint">Count its side panes</button></p>` : ''}
    <div class="u-win-foot"><span class="faint" id="uWinFoot"></span><button type="button" class="btn ghost" id="uWinReset" hidden>${ICON.reset}Back to the listing</button></div>`;
  $('uFace').value = st.face;
  $('uFace').addEventListener('change', (e) => { st.face = +e.target.value; st.t = snapPosition(FACES[st.face], st.t, snapOpen); st.az = FACES[st.face].bearing; st.manual.face = true; st.manual.az = false; st.src = null; $('uAz').value = Math.round(st.az); $('uPos').value = Math.round(st.t * 100); refreshWindow(true); });
  $('uPos').addEventListener('input', (e) => { st.t = snapPosition(FACES[st.face], +e.target.value / 100, snapOpen); st.manual.pos = true; refreshWindow(true); });
  $('uPos').addEventListener('change', () => { $('uPos').value = Math.round(st.t * 100); fill($('uPos')); });
  $('uFloor').addEventListener('input', (e) => { st.floor = +e.target.value; st.manual.floor = true; refreshWindow(false); });
  $('uCmp').addEventListener('input', (e) => { st.cmp = +e.target.value; refreshWindow(false); });
  $('uAz').addEventListener('input', (e) => { st.az = +e.target.value; st.manual.az = true; st.src = null; refreshWindow(true); });
  $('uBay').addEventListener('change', (e) => setBay(e.target.checked));
  $('uBayHint')?.addEventListener('click', () => setBay(true));
  $('uSlab').addEventListener('change', (e) => {
    const v = parseFloat(e.target.value); if (!Number.isFinite(v) || v < 0 || v > 600) { e.target.value = slabZ(st.floor).toFixed(1); return; }
    st.slabOff = v - (BASE() + (st.floor - 1) * FH()); refreshWindow(true);
  });
  $('uWinReset').addEventListener('click', () => {
    const qs = clearScenario(new URLSearchParams(location.search)); qs.delete('floor'); for (const k of XKEYS) qs.delete(k);
    history.replaceState(history.state, '', `${location.pathname}?${qs}#unit/${encodeURIComponent(st.id)}`);
    st.src = null; st.slabOff = null; st.lmSel.clear();
    load(st.id);
  });
}
function setBay(on) {
  st.bay = !!on; const b = $('uBay'); if (b) { b.checked = st.bay; b.closest('.tg').classList.toggle('on', st.bay); }
  refreshWindow(true);
}
function syncWindowPanel() {
  const f = FACES[st.face];
  $('uPosV').textContent = Math.round(st.t * 100) + '%'; $('uFloorV').textContent = st.floor; $('uCmpV').textContent = st.cmp; $('uAzV').textContent = `${Math.round(st.az)}° ${compass(st.az)}`;
  ['uPos', 'uFloor', 'uCmp', 'uAz'].forEach((id) => fill($(id)));
  const w = winPos(st.floor), s = streetAhead(site.streets, w.fx, w.fy, st.az), wall = nearestAhead(w);
  $('uWinFoot').textContent = `${Math.round(st.t * f.length)} m along a ${Math.round(f.length)} m facade · eye level ${Math.round(w.z)} m${s ? ` · ${s.name} centreline ${Math.round(s.dist)} m ahead` : ''}${wall ? ` · first building straight out: ${bname(wall.bi, true)}, ${Math.round(wall.h)} m tall, ${Math.round(wall.d)} m` : ' · nothing taller than your eyes straight out'}`;
  $('uWinReset').hidden = !(st.manual.face || st.manual.pos || st.manual.floor || st.manual.az || st.slabOff != null || st.src);
  $('uWinProv').innerHTML = provChip(provenance().exposure);
  const P = panes();
  $('uBayTxt').textContent = P ? paneFacings(st.az, P).sort((a, b) => a - b).map((x) => Math.round(x) + '°').join(' · ') : 'one flat pane';
  if (document.activeElement !== $('uSlab')) $('uSlab').value = slabZ(st.floor).toFixed(1);
  $('uSlabF').textContent = st.floor;
  const src = site.floor_height_src || site.calibration?.src;
  $('uSlabSrc').innerHTML = st.slabOff != null ? provChip('manual') : '';
  $('uSlabHelp').textContent = `${FH().toFixed(2)} m per floor${src === 'pluto' ? ' (roof ÷ PLUTO floors)' : src === 'default' ? ' (default)' : ''}. Type the real height if you know it.`;
  if (st.bay && $('uBayNote')) $('uBayNote').hidden = true;
}
/** Paint the filled part of a range track (app.css reads --p). */
function fill(el) { if (!el) return; const p = ((+el.value - +el.min) / ((+el.max - +el.min) || 1)) * 100; el.style.setProperty('--p', p + '%'); }

// ------------------------------------------------------------------ refresh
function refreshWindow(heavy) {
  if (!hasWindow()) { unresolvedWindow(); return; }
  const a = winPos(st.floor), b = winPos(st.cmp);
  profA = horizonProfile(B, a.x, a.y, a.z); profB = horizonProfile(B, b.x, b.y, b.z);
  profF = BF && stage.opts.future ? horizonProfile(BF, a.x, a.y, a.z) : null;
  stage.setWindow(a, st.az, slabZ(st.floor), slabZ(st.cmp), FH(), `Floor ${st.floor} · ${compass(st.az)}${st.bay ? ' · bay' : ''}`, panes() || [0]);
  syncWindowPanel(); subline(); refreshStrip(); computeNeighbours(); landmarks(); neighboursPanel(); refreshTime();
  if (heavy || !heat) computeHeat(); else drawHeat();
  evidencePanel(); ifPanel(heavy);
  studyStale(true);
  syncUrlSoon();
}
function unresolvedWindow() {
  st.playing = false; stage.win = null; blkRows = []; NBR = [];
  for (const key of ['marker', 'band', 'cmpBand', 'cmpBand2', 'cone', 'ray', 'hitDot']) if (stage[key]) stage[key].visible = false;
  stage.labels = stage.labels.filter((l) => { if (l.cls !== 'win') return true; l.el.remove(); return false; });
  $('uSnap').disabled = $('uGlb').disabled = true;
  $('hud').textContent = 'Window unresolved · City context only';
  $('sunPanel').innerHTML = '<h3>Sunlight unresolved</h3><p>No valid window placement. No unit-specific sunlight estimate is available.</p>';
  $('seePanel').innerHTML = '<h3>Outlook unresolved</h3><p>Inspect the building context in Orbit or Plan. This does not establish an apartment view.</p>';
  $('heatPanel').innerHTML = ''; $('nbPanel').innerHTML = '';
  const cv = $('pathCv'); cv.getContext('2d')?.clearRect(0, 0, cv.width, cv.height);
  $('pathNote').textContent = ''; $('pathLegend').innerHTML = '';
  subline(); stage.dirty = true;
}
function refreshTime() {
  if (!site) return;
  if (!hasWindow()) { unresolvedWindow(); return; }
  const s = curSun = sunAt(st.min), up = s.alt > 0, P = panes(), front = inFront(s.az, st.az, P);
  const w = winPos(st.floor);
  curHit = up && front ? rayBlock(blockerSet(), w.x, w.y, w.z, s.az, s.alt) : null;
  const lit = up && front && !curHit, side = lit && P && Math.abs(angDiff(s.az, st.az)) >= 90;
  const state = !up ? 'night' : !front ? 'behind' : lit ? (side ? 'side' : 'lit') : 'shade';
  stage.setSun(s); stage.setRay(state === 'side' ? 'lit' : state, curHit);
  // clock, strip cursor
  const [y, m, d] = ymd(), zn = zoneAbbr(y, m - 1, d, st.min, tz());
  $('uClock').textContent = fmtT(st.min);
  $('uDateTxt').textContent = `${new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}${zn ? ' · ' + zn : ''}`;
  const tr = $('uStrip'), frac = (st.min - STRIP_FROM) / (STRIP_TO - STRIP_FROM);
  $('uCur').style.left = frac * 100 + '%';
  const msg = { night: 'night', behind: 'sun behind the facade', lit: 'direct sun on the window', side: 'direct sun through a side pane', shade: 'window shaded by ' + (curHit ? bname(curHit.bi, true) : 'buildings') }[state];
  tr.setAttribute('aria-valuenow', String(st.min)); tr.setAttribute('aria-valuetext', `${fmtT(st.min)}, ${msg}`);
  hud(s, state);
  sunPanel(s, state);
  drawPathChart();
}
function hud(s, state) {
  if (!s || !hasWindow()) return;
  const tag = { night: ['Night', 'shade'], behind: ['Sun behind the window', 'shade'], lit: ['Direct sun on the window', 'lit'], side: ['Sun through a side pane', 'lit'], shade: ['Window in shadow', 'shade'] }[state];
  const blk = state === 'shade' && curHit ? bname(curHit.bi, true) : '';
  const inside = st.mode === 'in' && interior ? `<span class="u-hud-x">Inside · ${esc(interior.generic ? 'generic room, no floor plan' : plan?.title || 'floor plan')}${interior.windows[st.inWin] ? ' · ' + esc(interior.windows[st.inWin].room) : ''}</span>` : '';
  $('hud').innerHTML = `<span class="${tag[1]}">${tag[0]}${blk ? ` · ${esc(blk)}` : ''}</span><span>Sun ${Math.round(s.az)}° ${compass(s.az)} · ${s.alt > 0 ? Math.round(s.alt) + '° up' : 'below horizon'}</span><span class="u-hud-x">Floor ${st.floor} · faces ${Math.round(st.az)}° ${compass(st.az)}</span>${inside}${st.mode === 'win' || st.mode === 'in' ? '<span class="u-hud-x">Drag to look around</span>' : ''}`;
}
/** A short name for building bi: landmark name, footprint name, address, or "a 61 m building". */
function bname(bi, short = false) {
  if (bi == null || bi < 0) return '';
  if (bi === B.indexOf(T)) return listing().building || 'this building';
  if (bi >= B.length) { const f = FUT[bi - B.length]; return f?.name || 'a proposed building'; }
  const m = site.bmeta?.[bi], l = LM.find((x) => x.idx === bi);
  const h = Math.round(B[bi].top - Math.max(B[bi].g, 0));
  if (l) return l.name; if (m?.name) return m.name; if (m?.address) return short ? m.address.replace(/,.*$/, '') : m.address;
  return `a ${h} m building`;
}

function sunPanel(s, state) {
  const P = panes(), tab = tableFor(6), A = litInfo(tab, profA, st.az, 6, P), Bc = litInfo(tab, profB, st.az, 6, P), F = profF ? litInfo(tab, profF, st.az, 6, P) : null;
  const [, mo] = ymd(), baseline = baselineStudyMatches(site, st, FACES[st.face]) && !P && st.slabOff == null;
  const rng = baseline ? site.study?.sun_hours_range : null;
  let why;
  if (state === 'night') why = `At ${fmtT(st.min)} the sun is below the horizon.`;
  else if (state === 'behind') why = `At ${fmtT(st.min)} the sun is at ${Math.round(s.az)}° ${compass(s.az)}, behind a window that faces ${Math.round(st.az)}°${P ? ` (its panes face ${paneFacings(st.az, P).map((x) => Math.round(x) + '°').join(', ')})` : ''}.`;
  else if (state === 'lit' || state === 'side') why = `At ${fmtT(st.min)} the sun is ${Math.round(s.alt)}° up and clears every building in that direction (skyline ${Math.round(hAt(profA, s.az))}°)${state === 'side' ? ': it reaches the room through a side pane of the bay' : ''}.`;
  else why = `At ${fmtT(st.min)} the sun is ${Math.round(s.alt)}° up but ${esc(bname(curHit?.bi))}${curHit ? `, ${Math.round(curHit.dist)} m away,` : ''} blocks it, so the window is in shadow.`;
  const segs = A.segs.length ? `Floor ${st.floor} gets direct sun ${A.segs.map((q) => `<b>${fmtT(q[0])}</b> to <b>${fmtT(Math.min(q[1], 1439))}</b>`).join(', ')}.` : `Floor ${st.floor} gets no direct sun on this date.`;
  const lo = rng?.lo?.[mo - 1], hi = rng?.hi?.[mo - 1];
  const rangeTxt = lo != null && hi != null ? `<div class="u-range"><span class="pill">Range</span><b>${(+lo).toFixed(1)}–${(+hi).toFixed(1)} h</b> on ${MONTHS[mo - 1]} 15 across ${rangeScope(rng)}. The exact window position is the biggest unknown.</div>` : '';
  const vals = heat?.[st.floor] || (baseline ? site.study?.sun_hours : null);
  const dayLbl = new Date(Date.UTC(...ymd().map((v, i) => (i === 1 ? v - 1 : v)))).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  $('sunPanel').innerHTML = `<h3>Sun on this window <span>${esc(dayLbl)}</span></h3>
    <div class="metrics ${F ? 'm4' : 'm3'}">
      <div class="metric"><div class="k">Sun now</div><div class="v">${s.alt > 0 ? Math.round(s.alt) + '°' : '—'}<small>${s.alt > 0 ? compass(s.az) : 'set'}</small></div><div class="s ${state === 'lit' || state === 'side' ? 'u-lit' : ''}">${{ night: 'Night', behind: 'Behind facade', lit: 'On the window', side: 'Side pane', shade: 'Blocked' }[state]}</div></div>
      <div class="metric"><div class="k">Floor ${st.floor}</div><div class="v">${hm(A.min)}</div><div class="s">${P && A.side ? `${hm(A.side)} via side panes` : 'direct sun today'}</div></div>
      <div class="metric"><div class="k">Floor ${st.cmp}</div><div class="v">${hm(Bc.min)}</div><div class="s">${Bc.min > A.min ? '+' + hm(Bc.min - A.min) : Bc.min < A.min ? '−' + hm(A.min - Bc.min) : 'same'}</div></div>
      ${F ? `<div class="metric"><div class="k">With proposed</div><div class="v">${hm(F.min)}</div><div class="s">${F.min < A.min ? '−' + hm(A.min - F.min) : 'no change'}</div></div>` : ''}
    </div>
    <p class="u-why">${why}</p><p class="u-segs">${segs}</p>
    ${P ? `<p class="u-note">Bay window: the sun counts when it is in front of any of its ${P.length} panes. Each pane on its own: ${A.panes.map((v, i) => `<b>${Math.round(paneFacings(st.az, P)[i])}°</b> ${hm(v)}`).join(' · ')}.</p>` : ''}
    ${rangeTxt}${!baseline && site.study?.sun_hours_range ? '<p class="u-note">The saved uncertainty band belongs to the original window, floor and study year. It is hidden for this edited scenario.</p>' : ''}
    ${daylightBlock(vals, mo - 1)}
    ${blockersTable(blkRows, dayLbl)}
    <div class="u-band-wrap"><div class="label">By month · floor ${st.floor} <span>${rng ? 'bar: this window · band: range' : 'hours on the 15th'}</span></div>${monthBandSVG(vals, rng, mo - 1)}</div>
    <div class="u-nb-foot"><button type="button" class="btn" id="uSamples" title="Every 10 minutes on this date and the solstices and equinoxes: sun position, state and the building in the way">${ICON.down}Sun samples CSV</button></div>`;
}
/** Sunshine fraction by month for the site's city (the site file's table, else the built-in one), or null. */
const sunshineFrac = () => { const f = site?.study?.sunshine?.fraction; return Array.isArray(f) && f.length === 12 ? f.map(Number) : SUNSHINE[S.crit.search?.city]?.fraction || null; };
/**
 * Diffuse daylight for the current window (relative CIE overcast model, not lux) and possible vs expected direct
 * sun. `vals`: direct-sun hours on the 15th of each month for this floor (null while it is being computed).
 */
function daylightBlock(vals, mi) {
  const sv = skyView(profA, st.az, panes()), df = daylightFactor(sv), frac = sunshineFrac();
  const poss = Array.isArray(vals) && vals.length === 12 ? vals : null, yr = poss ? expectedSun(poss, frac) : null;
  const m = MONTHS[mi], h1 = (v) => (v == null ? '—' : (+v).toFixed(1));
  const src = site?.study?.sunshine?.place || (frac ? 'New York Central Park' : '');
  return `<div class="u-daylight"><div class="label">Daylight <span>relative model · not lux</span></div>
    <div class="metrics m3">
      <div class="metric"><div class="k">Sky view</div><div class="v">${Math.round(sv * 100)}<small>%</small></div><div class="s">overcast sky, ±${FIELD_DEG}°</div></div>
      <div class="metric"><div class="k">Daylight factor</div><div class="v">≈${df < 1 ? df.toFixed(2) : df.toFixed(1)}<small>%</small></div><div class="s">estimated, not measured</div></div>
      <div class="metric"><div class="k">Sun in ${m}</div><div class="v">${h1(poss?.[mi])}<small>h</small></div><div class="s">${frac && poss ? `possible · ≈${h1(poss[mi] * frac[mi])} h expected` : 'possible, clear sky'}</div></div>
    </div>
    <p class="u-note"><b>Sky view</b>: share of an unobstructed window's overcast-sky light. <b>Daylight factor</b>: that sky on an assumed 4 × 5 m room with 3 m² of glass; use it to compare windows. ${frac ? `<b>Expected</b>: possible (clear-sky) sun × the ${Math.round(frac[mi] * 100)}% of ${m} daylight that is sunny (${esc(src)}, NOAA normals).` : '<b>Possible</b>: clear-sky direct sun on the 15th.'}${yr ? ` A year: ${yr.possible.toLocaleString()} h possible${yr.expected != null ? `, about ${yr.expected.toLocaleString()} h expected` : ''}.` : ''}</p></div>`;
}
const hm = (min) => { if (!min) return 'none'; const h = Math.floor(Math.round(min) / 60), m = Math.round(min) % 60; return h && m ? `${h} h ${String(m).padStart(2, '0')} m` : h ? `${h} h` : `${m} m`; };
function rangeScope(r) {
  const p = Array.isArray(r.positions) && r.positions.length ? `positions ${Math.round(Math.min(...r.positions) * 100)}–${Math.round(Math.max(...r.positions) * 100)}% along the facade` : 'window positions';
  const f = Array.isArray(r.floors) && r.floors.length ? `floors ${Math.min(...r.floors)}–${Math.max(...r.floors)}` : 'nearby floors';
  return `${p} and ${f}`;
}

// ------------------------------------------------------------------ what the window sees
function landmarks() {
  if (!hasWindow()) return;
  const w = winPos(st.floor), sp = spread();
  let open = 0, tot = 0;
  for (let a = st.az - 60 - sp; a <= st.az + 60 + sp; a++) { open += 60 - Math.min(60, hAt(profA, a)); tot += 60; }
  const rows = LM.map((l) => {
    const dx = l.x - w.x, dy = l.y - w.y, dist = Math.hypot(dx, dy), az = ((Math.atan2(dx, dy) / DEG) + 360) % 360;
    const block = horizonDir(B, w.x, w.y, w.z, az, l.idx), topA = Math.atan2(l.top - w.z, dist) / DEG;
    const from = Math.max(0, w.z + dist * Math.tan(block * DEG)), off = offAxis(az);
    const behind = off >= 90, hidden = !behind && topA <= block + 0.2;
    l.hidden = behind || hidden;
    const vis = behind ? ['Behind the window', '', 3] : hidden ? ['Hidden', 'bad', 2] : [l.top - from > l.top * 0.98 ? 'Whole tower' : `Top ${Math.round(l.top - from)} m`, 'good', off > 60 ? 1 : 0];
    return { l, az, dist, vis, html: `<li class="u-lm${vis[2] >= 2 ? ' off' : ''}" data-bi="${l.idx}"><div><b>${esc(l.name)}</b><span>${Math.round(l.top)} m · ${compass(az)} ${Math.round(az)}° · ${fmtDist(dist)}</span></div><span class="pill ${vis[1]}">${vis[0]}${vis[2] === 1 ? ' · to the side' : ''}</span></li>` };
  }).sort((a, b) => a.vis[2] - b.vis[2] || a.dist - b.dist);
  const behind = rows.filter((r) => r.vis[2] === 3), nv = rows.filter((r) => r.vis[2] < 2).length, wall = nearestAhead(w), s = streetAhead(site.streets, w.fx, w.fy, st.az);
  // every landmark by bearing, for matching a photo taken from the window
  const byBrg = [...rows].sort((a, b) => a.az - b.az);
  const allLm = LM.length ? `<details class="u-all-lm"${st.allLm ? ' open' : ''}><summary>All landmarks by bearing <span>for matching a photo</span></summary>
      <p class="u-note">In the Window view, load a photo taken from the window (Match a photo, in the lens panel; it stays in this browser), line the skyline up with turn, tilt and lens, then tick what the photo shows.</p>
      <table class="mini u-lm-t"><thead><tr><th><span class="sr">Seen</span></th><th>Landmark</th><th class="num">Bearing</th><th class="num">Away</th><th>From here</th></tr></thead><tbody>
      ${byBrg.map((r) => `<tr data-bi="${r.l.idx}"><td><input type="checkbox" data-lm="${esc(r.l.name)}" aria-label="Seen in the photo: ${esc(r.l.name)}" ${st.lmSel.has(r.l.name) ? 'checked' : ''}></td><td>${esc(r.l.name)}</td><td class="num">${Math.round(r.az)}° <small>${compass(r.az)}</small></td><td class="num">${fmtDist(r.dist)}</td><td><span class="pill ${r.vis[1]}">${r.vis[2] === 3 ? 'Behind' : r.vis[2] === 2 ? 'Hidden' : r.vis[2] === 1 ? 'To the side' : 'Visible'}</span></td></tr>`).join('')}
      </tbody></table>
      <div class="u-use"><span class="faint" id="uLmN">${lmMatchedTxt()}</span><button type="button" class="btn" id="uUseFace">Use this facade</button></div></details>` : '';
  $('seePanel').innerHTML = `<h3>What the window sees <span>${nv} of ${LM.length} landmarks</span></h3>
    <div class="metrics m3">
      <div class="metric"><div class="k">Open sky</div><div class="v">${Math.round((100 * open) / tot)}<small>%</small></div><div class="s">in a ±${60 + sp}° view</div></div>
      <div class="metric"><div class="k">Skyline ahead</div><div class="v">${Math.round(hAt(profA, st.az))}°<small>up</small></div><div class="s">straight out</div></div>
      <div class="metric"><div class="k">Nearest wall</div><div class="v">${wall ? Math.round(wall.d) + '<small>m</small>' : '—'}</div><div class="s">${wall ? `${Math.round(wall.h)} m tall` : 'clear to the edge'}</div></div>
    </div>
    ${s ? `<p class="u-note">Looks onto <b>${esc(s.name)}</b>, ${Math.round(s.dist)} m to the centreline.</p>` : ''}
    ${roofsBlock(w)}
    <ul class="u-lms">${rows.filter((r) => r.vis[2] < 3).map((r) => r.html).join('') || (LM.length ? '' : '<li class="faint">No landmark towers in range.</li>')}</ul>
    ${behind.length ? `<p class="u-note u-behind"><b>Behind the window:</b> ${behind.map((r) => esc(r.l.name)).join(', ')}.</p>` : ''}
    ${allLm}`;
  stage.dirty = true;
}
const lmMatchedTxt = () => (st.lmSel.size ? `Seen in the photo: ${[...st.lmSel].join(', ')}` : 'Tick the landmarks the photo shows');
function useFacade() {
  st.src = 'photo-landmarks'; st.manual.face = true;
  syncWindowPanel(); subline(); evidencePanel(); syncUrl();
  toast(`Facing ${Math.round(st.az)}° ${compass(st.az)} recorded from photo landmarks${st.lmSel.size ? ': ' + [...st.lmSel].join(', ') : ''}. It is kept in the page address.`, 4200);
}
/** Eye height against the roofs of the nearest buildings in the facing sector (±45° of any pane, 150 m). */
function roofsBlock(w) {
  const rows = NBR.filter((r) => r.off <= 45 && r.dist <= 150 && r.dist > 0.5).sort((a, b) => a.dist - b.dist).slice(0, 8);
  if (!rows.length) return '';
  const eyes = [{ label: `Fl ${st.floor}`, z: w.z, kind: 'cur' }];
  if (st.cmp !== st.floor) eyes.push({ label: `Fl ${st.cmp}`, z: winPos(st.cmp).z, kind: 'cmp' });
  const seen = new Set([st.floor, st.cmp]);
  for (const U of sameBuilding()) {
    const f = U.floor != null ? Math.round(U.floor) : null;
    if (U.id === st.id || f == null || seen.has(f) || f > maxFloor() || ['gone', 'rejected'].includes(U.status)) continue;
    seen.add(f); eyes.push({ label: String(U.unit || U.id), z: winPos(f).z, kind: 'unit' });
  }
  const solid = rows.filter((r) => !r.future), top = solid.length ? solid.reduce((a, b) => (b.h > a.h ? b : a)) : null;
  let clear = '';
  if (top) {
    const need = Math.ceil((top.h + 0.5 - 1.6 - BASE() - slabOff()) / FH()) + 1, mf = maxFloor();
    clear = need <= 1 ? 'The view clears every neighbouring roof in front from the lowest floor.' : need > mf ? `No floor of this building sees over the ${Math.round(top.h)} m roof of ${esc(top.name)}.` : `The view clears the neighbours in front from <b>floor ${need}</b> (the ${Math.round(top.h)} m roof of ${esc(top.name)}).${need <= st.floor ? ' This floor is above them.' : ` This floor is ${need - st.floor} floor${need - st.floor > 1 ? 's' : ''} short.`}`;
    const fut = rows.filter((r) => r.future && r.h > top.h);
    if (fut.length) clear += ` A proposed ${Math.round(fut[0].h)} m building would raise that.`;
  }
  return `<div class="u-roofs-wrap"><div class="label">Eyes against the roofs in front <span>nearest ${rows.length} · 150 m</span></div>${roofBars(rows.map((r) => ({ name: r.name, h: r.h, dist: r.dist, future: r.future, bi: r.future ? null : r.bi })), eyes)}
    <div class="legend-row"><span><i class="sw u-sw-sun"></i>Floor ${st.floor} eyes</span>${eyes.length > 1 ? '<span><i class="sw u-sw-cmp2"></i>Other floors and units</span>' : ''}<span><i class="sw u-sw-above"></i>Roof above your eyes</span><span><i class="sw u-sw-below"></i>Below</span></div>
    ${clear ? `<p class="u-note">${clear}</p>` : ''}</div>`;
}
function nearestAhead(w) {
  const ux = Math.sin(st.az * DEG), uy = Math.cos(st.az * DEG); let best = 1e9, top = 0, bi = -1;
  for (let b0i = 0; b0i < B.length; b0i++) {
    const b0 = B[b0i];
    if (b0 === T) continue;
    for (const b of solidsOf(b0)) for (const p of [b.p, ...(b.holes || [])]) {
      const n = p.length / 2;
      for (let j = 0; j < n; j++) {
        const ax = p[2 * j], ay = p[2 * j + 1], j2 = (j + 1) % n, ex = p[2 * j2] - ax, ey = p[2 * j2 + 1] - ay;
        const den = ux * ey - uy * ex; if (Math.abs(den) < 1e-9) continue;
        const wx = ax - w.x, wy = ay - w.y, t = (wx * ey - wy * ex) / den, s = (wx * uy - wy * ux) / den;
        if (t > 0.5 && s >= 0 && s <= 1 && t < best && b.top > w.z) { best = t; top = b0.top - Math.max(b0.g, 0); bi = b0i; }
      }
    }
  }
  return best < 1e9 ? { d: best, h: top, bi } : null;
}

// ------------------------------------------------------------------ neighbours
function computeNeighbours() {
  const w = winPos(st.floor), out = [], now = new Date().getFullYear();
  const add = (b, bi, fut) => {
    const d = distToBuilding(b, w.x, w.y); if (d > 300) return;
    const [cx, cy] = centre(b), brg = bearingTo(w.x, w.y, cx, cy), off = offAxis(brg), h = b.top - Math.max(b.g, 0);
    let view = off >= 90 ? 'behind' : off > 60 ? 'side' : 'in view';
    if (view !== 'behind' && !fut) { const blk = horizonDir(B, w.x, w.y, w.z, brg, bi), topA = Math.atan2(b.top - w.z, Math.max(d, 1)) / DEG; if (topA <= blk + 0.2 && d > 2) view = 'hidden'; }
    const m = fut ? {} : site.bmeta?.[bi] || {}, lm = fut ? null : LM.find((x) => x.idx === bi), f = fut ? FUT[bi - B.length] : null;
    const edited = m.edited != null ? String(m.edited).slice(0, 4) : '';
    const gs = String(m.geom_src || '').toLowerCase();
    out.push({
      bi, name: fut ? f.name || 'Proposed building' : lm?.name || m.name || (m.address ? m.address.replace(/,.*$/, '') : `${Math.round(h)} m building`),
      sub: fut ? `proposed · ${f.status || ''}` : lm || m.name ? m.address || '' : '', lmName: lm?.name || m.name || '', address: m.address || '', bin: m.bin, bbl: m.bbl,
      h, g: b.g, dist: d, brg, off, view, floors: m.floors || m.numfloors || null, hsrc: fut ? f.h_src || 'filing' : m.height_src || (b.eg ? 'default' : ''),
      geom: fut ? 'proposed' : gs.includes('manual') ? 'manual' : gs.includes('photo') ? 'photogrammetric' : m.src === 'osm' ? 'osm' : gs || '', src: fut ? f.source : m.src,
      year: m.year, edited, stale: !!edited && now - +edited >= STALE_YEARS, future: fut, sel: st.sel === bi,
    });
  };
  B.forEach((b, i) => { if (b !== T) add(b, i, false); });
  if (BF) for (let i = B.length; i < BF.length; i++) add(BF[i], i, true);
  NBR = out;
}
function neighboursPanel() {
  if (!hasWindow()) return;
  const all = NBR, inV = all.filter((r) => r.view === 'in view' || r.view === 'side').length;
  const rows = sortRows(all, st.nbSort.key, st.nbSort.dir).slice(0, 30);
  const near = [...all].sort((a, b) => a.dist - b.dist)[0];
  $('nbPanel').innerHTML = `<h3>Neighbours <span>${all.length} within 300 m · ${inV} in the window's field</span></h3>
    <p class="u-note">${near ? `Nearest: <b>${esc(near.name)}</b>, ${fmtDist(near.dist)} ${compass(near.brg)}, roof ${Math.round(near.h)} m. ` : ''}Every building around the window with its height and where the numbers come from. Click a row to find it in the model.</p>
    <details class="u-nb-d"${st.nbOpen ? ' open' : ''}><summary>Show the nearest ${Math.min(30, all.length)} <span>sortable</span></summary>${neighboursTable(rows, st.nbSort, HSHORT, GSRC)}</details>
    <div class="u-nb-foot"><button type="button" class="btn" id="uNbCsv">${ICON.down}Download all ${all.length} as CSV</button></div>`;
}
function csvNeighbours() {
  const rows = [...NBR].sort((a, b) => a.dist - b.dist);
  download(`${st.id}-surroundings-floor${st.floor}.csv`, neighboursCSV(rows), 'text/csv');
  toast(`${rows.length} buildings saved as CSV`);
}

// ------------------------------------------------------------------ heatmap
function computeHeat() {
  const tok = ++heatTok, mf = maxFloor(), y = +st.date.slice(0, 4), o = site.origin, P = panes();
  heat = { year: y };
  const tabs = Array.from({ length: 12 }, (_, m) => table(y, m, 15, o.lat, o.lon, tz(), 6));
  let fl = 1;
  const step = () => {
    if (tok !== heatTok) return;
    const t0 = performance.now();
    while (fl <= mf && performance.now() - t0 < 24) {
      const w = winPos(fl), prof = fl === st.floor ? profA : horizonProfile(B, w.x, w.y, w.z);
      heat[fl] = tabs.map((t) => litInfo(t, prof, st.az, 6, P).min / 60); fl++;
    }
    drawHeat(fl <= mf);
    if (fl <= mf) setTimeout(step, 0); else if (curSun) sunPanel(curSun, hudState());
  };
  drawHeat(true); setTimeout(step, 0);
}
const hudState = () => { const s = curSun; if (!s || s.alt <= 0) return 'night'; if (!inFront(s.az, st.az, panes())) return 'behind'; if (curHit) return 'shade'; return panes() && Math.abs(angDiff(s.az, st.az)) >= 90 ? 'side' : 'lit'; };
function drawHeat(busy = false) {
  const mf = maxFloor(), [, mo] = ymd();
  const first = !$('uHeatBox');
  if (first) {
    $('heatPanel').innerHTML = `<h3>Direct sun by floor and month <span id="uHeatNote"></span></h3>
      <p class="u-note">Hours of direct sun on the 15th of each month at this facade, position and bearing. Click a cell to jump to that floor and month.</p>
      <div class="u-heat-box" id="uHeatBox"></div>
      <div class="legend-row"><span><i class="sw u-sw-cur"></i>Your floor</span><span><i class="sw u-sw-cmp"></i>Compare floor</span><span class="u-heat-scale"><i></i>0 h → 9 h</span></div>`;
    $('uHeatBox').addEventListener('click', (e) => {
      const c = e.target.closest('[data-fl]'); if (!c) return;
      st.floor = +c.dataset.fl; st.manual.floor = true; $('uFloor').value = st.floor;
      if (c.dataset.m != null) { const y = +st.date.slice(0, 4); st.date = `${y}-${String(+c.dataset.m + 1).padStart(2, '0')}-15`; $('uDate').value = st.date; statesA = null; }
      refreshWindow(false); syncUrl();
    });
  }
  const box = $('uHeatBox'), keep = box.scrollTop;
  box.innerHTML = heatHTML(heat, mf, st.floor, st.cmp, mo - 1, busy);
  $('uHeatNote').textContent = busy ? 'Calculating…' : `${mf} floors${st.bay ? ' · bay' : ''}`;
  if (first || box.dataset.floor !== String(st.floor)) {
    const cur = box.querySelector('.fl.cur'); if (cur) box.scrollTop = Math.max(0, cur.offsetTop - box.clientHeight / 2);
    box.dataset.floor = String(st.floor);
  } else box.scrollTop = keep;
}

// ------------------------------------------------------------------ sun path chart
function drawPathChart() {
  if (!site || !profA || $('view-unit').hidden || !hasWindow()) return;
  drawPath($('pathCv'), { lat: site.origin.lat, lon: site.origin.lon, tz: tz(), date: st.date, az: st.az, profA, profB, profF, sun: curSun, spread: spread() });
  $('pathNote').textContent = `floor ${st.floor}`;
  $('pathLegend').innerHTML = `<span><i class="sw u-sw-sky"></i>Skyline from floor ${st.floor}</span><span><i class="sw u-sw-cmp2"></i>From floor ${st.cmp}</span><span><i class="sw u-sw-sun"></i>${esc(st.date)} (faint where blocked)</span><span><i class="sw u-sw-ref"></i>Jun 21 · Mar 20 · Dec 21</span>${profF ? '<span><i class="sw u-sw-fut"></i>With proposed buildings</span>' : ''}${st.bay ? '<span>Hollow ticks: side panes</span>' : ''}`;
}

// ------------------------------------------------------------------ building card
function openCard(bi) {
  st.sel = bi; stage.select(bi);
  const b = bi < B.length ? B[bi] : null; if (!b) return;
  if (!hasWindow()) {
    const m = site.bmeta?.[bi];
    $('uCard').innerHTML = `<button type="button" class="u-card-x" id="uCardX" aria-label="Close">×</button><h3>${esc(m?.address || 'Building context')}</h3><p>${Math.round(b.top - b.g)} m roof height · ${esc(HSRC[m?.height_src] || 'height source unknown')}</p><p>Window placement unresolved; distance and outlook from the apartment are unavailable.</p>`;
    $('uCard').hidden = false; $('uCardX').addEventListener('click', closeCard); return;
  }
  const m = site.bmeta?.[bi] || null, isT = b === T, h = b.top - Math.max(b.g, 0), w = winPos(st.floor);
  const [cx, cy] = centre(b), dist = distToBuilding(b, w.x, w.y), az = bearingTo(w.x, w.y, cx, cy);
  const lm = LM.find((x) => x.idx === bi), off = offAxis(az);
  const title = isT ? (listing().building || 'This building') : lm?.name || m?.name || m?.address || 'Building';
  const gs = String(m?.geom_src || '').toLowerCase(), edited = m?.edited != null ? String(m.edited).slice(0, 4) : '';
  const chips = [
    gs.includes('manual') ? ['Manually mapped outline', 'warn', 'The city drew this outline by hand rather than from the aerial survey'] : null,
    edited && new Date().getFullYear() - +edited >= STALE_YEARS ? [`Height last edited ${edited}`, 'warn', 'Newer additions or demolitions may be missing'] : null,
    m?.height_src === 'default' ? ['Height unknown', 'bad', 'A default height: the real building may be much taller or shorter'] : null,
    ['5100', '1003'].includes(String(m?.fcode)) || /construct/i.test(String(m?.status || '')) ? ['Under construction', 'warn', 'The footprint data marks this as under construction: its height may change'] : null,
    String(m?.fcode) === '1006' ? ['Cantilevered', '', 'Part of this building overhangs its footprint'] : null,
    isT && ['bin', 'bbl'].includes(site.provenance?.target) ? [site.provenance.target === 'bin' ? 'Matched by BIN' : 'Matched by tax lot', 'good', 'Picked by the listing’s building number, not the address point'] : null,
  ].filter(Boolean);
  const blkMin = blkRows.find((r) => r.bi === bi);
  const rows = [
    ['Roof', `${Math.round(h)} m · ${Math.round(h * 3.281)} ft${Math.abs(b.g) > 1 ? ` <span class="faint">(ground ${b.g > 0 ? '+' : ''}${b.g.toFixed(0)} m)</span>` : ''}`],
    ['Height from', esc(m?.height_src ? HSRC[m.height_src] || m.height_src : b.eg ? 'Estimated' : 'Roof height in the footprint data')],
    ['Data', esc(m?.src ? DSRC[m.src] || m.src : site.source || 'Footprints')],
    gs ? ['Outline', esc(GSRC[gs] || m.geom_src)] : null,
    m?.address && (lm || isT || m?.name) ? ['Address', esc(m.address)] : null,
    m?.bin ? ['BIN', `<span class="mono">${esc(m.bin)}</span>`] : null,
    m?.bbl ? ['BBL', `<span class="mono">${esc(m.bbl)}</span>`] : null,
    m?.year ? ['Built', esc(m.year)] : null,
    m?.floors || m?.numfloors ? ['Floors', esc(m.floors || m.numfloors)] : null,
    !isT ? ['From your window', `${fmtDist(dist)} · ${compass(az)} ${Math.round(az)}° · ${off >= 90 ? 'behind the window' : off > 60 ? 'off to the side' : 'in view'}`] : null,
    blkMin ? ['Takes your sun', `${hm(blkMin.today)} today · ${hm(blkMin.dec)} Dec 15 · ${hm(blkMin.jun)} Jun 15`] : null,
  ].filter(Boolean);
  const blocks = curHit && curHit.bi === bi;
  const parts = b.parts ? partsBlock(b) : '';
  $('uCard').innerHTML = `<div class="u-card-h"><div><div class="u-eyebrow">${isT ? 'This building' : lm ? 'Landmark' : 'Building'}</div><b>${esc(title)}</b></div><button type="button" class="icon-btn" id="uCardX" aria-label="Close">${ICONS.x}</button></div>
    ${chips.length ? `<div class="u-card-chips">${chips.map(([t, c, tip]) => `<span class="pill ${c}"${tip ? ` title="${esc(tip)}"` : ''}>${esc(t)}</span>`).join('')}</div>` : ''}
    ${blocks ? `<div class="u-card-flag">Blocks the sun on your window at ${fmtT(st.min)}</div>` : ''}
    <dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
    ${parts}
    ${isT && !b.parts ? '<p class="faint u-card-foot">Drawn as its footprint pushed straight up: setbacks and crowns are not modelled.</p>' : ''}`;
  $('uCard').hidden = false;
  $('uCardX').addEventListener('click', closeCard);
  $('nbPanel').querySelectorAll('tr[data-bi]').forEach((r) => r.classList.toggle('on', +r.dataset.bi === bi));
}
const KIND = { podium: 'Podium', tower: 'Tower', setback: 'Setback', bulkhead: 'Bulkhead' };
/** The components a building is modelled with: kind, height band, source and confidence. */
function partsBlock(b) {
  const list = [...b.parts].sort((p, q) => q.top - p.top), shown = list.slice(0, 6);
  const srcLink = (q) => {
    const src = q.source || 'source not recorded', u = safeUrl(q.ref), short = /^osm /i.test(src) ? 'OpenStreetMap' : /^manual/i.test(src) ? 'Your file' : src;
    return u && /^https?:/i.test(u) ? `<a href="${esc(u)}" target="_blank" rel="noopener" title="${esc(src)}">${esc(short)}</a>` : `<span title="${esc(src)}">${esc(short)}</span>`;
  };
  const conf = (c) => (c ? `<span class="pill ${c === 'high' ? 'good' : c === 'low' ? 'warn' : ''}">${esc(c)}</span>` : '');
  return `<div class="u-card-parts"><div class="label">Modelled as ${b.parts.length} part${b.parts.length > 1 ? 's' : ''} <span>used for shade</span></div>
    <table class="mini"><tbody>${shown.map((q) => `<tr><td>${KIND[q.kind] || 'Part'}</td><td class="num">${Math.round(q.base_m)}–${Math.round(q.top_m)} m</td><td class="u-part-src">${srcLink(q)}</td><td>${conf(q.confidence)}</td></tr>`).join('')}</tbody></table>
    ${list.length > shown.length ? `<p class="faint">and ${list.length - shown.length} lower part${list.length - shown.length > 1 ? 's' : ''}</p>` : ''}</div>`;
}
function closeCard() { st.sel = null; stage?.select(null); $('uCard').hidden = true; $('nbPanel')?.querySelectorAll('tr.on').forEach((r) => r.classList.remove('on')); }

// ------------------------------------------------------------------ evidence
function evidencePanel() {
  const p = provenance(), L = listing(), P = site.provenance || {};
  const area = Math.abs((() => { let a = 0; for (let i = 0; i < T.n; i++) { const j = (i + 1) % T.n; a += T.p[2 * i] * T.p[2 * j + 1] - T.p[2 * j] * T.p[2 * i + 1]; } return a / 2; })());
  const bm = Array.isArray(site.bmeta) ? site.bmeta.filter(Boolean) : [];
  const count = (k) => bm.reduce((acc, m) => ((acc[m[k] || '?'] = (acc[m[k] || '?'] || 0) + 1), acc), {});
  const srcs = bm.length ? Object.entries(count('src')).map(([k, n]) => `${n.toLocaleString()} from ${esc(DSRC[k] || k)}`).join(', ') : `${esc(site.source || 'building footprints')}`;
  const hs = bm.length ? Object.entries(count('height_src')).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n.toLocaleString()} ${esc((HSRC[k] || k).toLowerCase())}`).join(', ') : null;
  const manualAll = bm.filter((m) => String(m.geom_src || '').toLowerCase().includes('manual')).length;
  const field = NBR.filter((r) => r.view !== 'behind' && !r.future);
  const sector = { n: field.length, manual: field.filter((r) => r.geom === 'manual').length, stale: field.filter((r) => r.stale).length, def: field.filter((r) => r.hsrc === 'default').length };
  const nParts = B.filter((b) => b.parts).length, ci = site.components_info || {};
  const nMan = B.filter((b) => b.parts?.some((q) => /^manual/i.test(q.source))).length;
  const partSrc = nParts ? ` (${nMan ? `${nMan} from your components file, ` : ''}${nParts - nMan} from OpenStreetMap building parts${ci.partial || ci.height_mismatch ? `; ${(ci.partial || 0) + (ci.height_mismatch || 0)} with incomplete or conflicting parts left whole` : ''})` : '';
  const ex = evidenceExtras(site, { sector: bm.length && hasWindow() ? sector : null, staleYears: STALE_YEARS, fh: FH(), floor: st.floor, slab: hasWindow() ? slabZ(st.floor) : null, slabManual: st.slabOff != null });
  const ev = [
    ['Exposure', p.exposure, st.src === 'photo-landmarks' ? `Matched against a photo from the window${st.lmSel.size ? `: ${esc([...st.lmSel].join(', '))}` : ''}.` : P.basis && p.exposure !== 'manual' ? `${esc(P.basis[0].toUpperCase() + P.basis.slice(1))}.${P.evidence ? ' ' + esc(P.evidence) : ''}` : L.exposure?.length ? `Listing gives ${esc(L.exposure.join(', '))}.` : 'No exposure on the listing: the model starts on the longest open facade.'],
    ['Window position', p.position, 'Where the unit sits along its facade is rarely published. The model puts the window at the point you choose.'],
    ['Floor', p.floor, p.floor === 'inferred' ? 'Guessed from the unit number.' : L.floor != null ? `Listing gives floor ${esc(Math.round(L.floor))}.` : 'No floor on the listing.'],
  ];
  if (edits.size) ev.push(['Neighbour heights', 'manual', `What-if scenario: ${[...edits].map(([bi, h]) => `${esc(bname(bi, true))} at ${Math.round(h)} m instead of ${Math.round(h0Of(bi))} m`).join('; ')}. Every number on the page uses it.`]);
  if (st.bay && hasWindow()) ev.push(['Bay window', Array.isArray(site.window?.panes) && site.window.panes.length > 1 ? 'model' : 'manual', `Counted as ${panes().length} panes at ${paneFacings(st.az, panes()).map((x) => Math.round(x) + '°').join(', ')}, all sharing one skyline point.${planSaysBay() ? ' The floor plan marks a bay.' : ''}`]);
  $('evPanel').innerHTML = `<h3>Assumptions and evidence</h3>
    <ul class="u-ev">${ev.map(([k, v, t]) => `<li><div class="u-ev-k">${k}${provChip(v)}</div><p>${t}</p></li>`).join('')}${ex.notes.join('')}</ul>
    ${P.notes ? `<p class="u-note">${esc(P.notes)}</p>` : ''}
    ${checksBlock(site.checks)}
    <div class="u-caveat"><b>A footprint is not the tower's real shape.</b> ${nParts ? `${nParts.toLocaleString()} building${nParts > 1 ? 's are' : ' is'} split into podium, tower and setback parts${partSrc}; every other building is its outline pushed straight up to its roof height.` : 'Every building is its outline pushed straight up to its roof height: no setbacks, crowns, podiums or bays.'} ${T.parts ? 'This building is drawn from its parts.' : area > 2500 ? `This building's footprint covers ${Math.round(area).toLocaleString()} m², likely more than one mass on one lot, so use the faint or hidden display to check the window.` : 'Shade from a stepped tower can be overstated.'}</div>
    <dl class="u-src">
      <dt>Buildings</dt><dd>${B.length.toLocaleString()} footprints: ${srcs}${manualAll ? `; ${manualAll.toLocaleString()} outlines mapped by hand` : ''}.</dd>
      ${hs ? `<dt>Heights</dt><dd>${hs}.</dd>` : ''}
      ${ex.rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}
      ${greenRow()}
      ${(site.streets || []).length ? `<dt>Streets</dt><dd>${site.streets.length} centrelines (centre of the road, not the kerb).</dd>` : ''}
      ${FUT.length ? `<dt>Proposed</dt><dd>${FUT.map((f) => `${esc(f.name || 'Unnamed')} (${Math.round(f.h)} m, ${esc(f.status || 'proposed')}${safeLink(f.url)})`).join('; ')}.</dd>` : ''}
      <dt>Sun</dt><dd>Standard solar formulas, ${esc(tz())} with daylight saving. Direct sun on a clear day: no reflections, trees or haze; “expected” hours scale it by the month's sunshine share. Daylight is a relative overcast-sky model (sky view and an estimated daylight factor), not lux. A window counts as lit when the sun is within 90° of the way ${st.bay ? 'one of its panes' : 'it'} faces and above every building in that direction.</dd>
      ${hasWindow() ? `<dt>Inside</dt><dd>${plan ? `The floor plan (${esc(plan.provenance?.match || 'unverified match')}) sits with its window wall on the facade at the window position, turned to ${Math.round(st.az)}°.` : 'No floor plan for this unit: the Inside view uses a generic 5.5 × 7 m room.'} The rest of this building does not cast shadows into it.</dd>` : ''}
    </dl>
    ${receiptsBlock(site.sources || site.receipts, safeUrl)}
    <p class="u-rule">Only a floor plan with a compass, exact-unit photos or the building's own data establish which way a unit faces. Everything else is a working assumption: check it on a visit at the same time of day.</p>`;
}
/** The Parks and trees row of the evidence panel: what was drawn, from where, and what the window sees of it. */
function greenRow() {
  const g = site.green;
  if (!g || typeof g !== 'object') return '';
  const c = g.counts || {}, gv = site.study?.green_view, seen = Array.isArray(gv?.green) ? gv.green.slice(0, 3).map((r) => `${esc(r.name || `unnamed ${r.kind}`)} (${Math.round(r.visible_m2)} m², ${Math.round(r.dist_m?.[0] ?? 0)}-${Math.round(r.dist_m?.[1] ?? 0)} m)`).join(', ') : '';
  return `<dt>Parks and trees</dt><dd>${(c.polys ?? (g.polys || []).length).toLocaleString()} parks, lawns and playgrounds and ${(c.trees ?? (g.trees || []).length / 2).toLocaleString()} mapped trees from ${esc(g.source || 'OpenStreetMap')}${g.fetched ? `, fetched ${esc(g.fetched)}` : ''}. Trees mapped in OpenStreetMap are few, so park and lawn areas also get canopies at about 8-14 m: the picture shows where green lies, not how many trees. Context only: not counted as shade in the sun hours.${seen ? ` From this window, in a ${gv.fov_deg ?? 90}° view: ${seen}.` : ''}</dd>`;
}
function safeLink(u) { const v = safeUrl(u); return v && /^https?:/i.test(v) ? `, <a href="${esc(v)}" target="_blank" rel="noopener">source</a>` : ''; }

// ------------------------------------------------------------------ what if: neighbour heights
/** Height edits in the page address: wh=<site id>|<index>:<metres>,... (only for the same site). */
function readEdits(qs, id) {
  const out = new Map(), raw = qs.get('wh') || '', [sid, list] = raw.split('|');
  if (sid !== id || !list) return out;
  for (const part of list.split(',')) {
    const [i, h] = part.split(':').map(Number);
    if (Number.isInteger(i) && i >= 0 && i < B0.length && i !== B0.indexOf(T) && Number.isFinite(h) && h >= 0 && h <= 900) out.set(i, h);
  }
  return out;
}
const h0Of = (bi) => B0[bi].top - B0[bi].g;
const editsMem = new Map();
/** Set building bi to h metres (its original height clears the edit), then re-run everything that depends on it. */
function setEdit(bi, h, heavy = false) {
  if (bi == null || !B0[bi] || B0[bi] === T) return;
  const h0 = h0Of(bi);
  if (h == null || Math.abs(h - h0) < 0.5) edits.delete(bi); else edits.set(bi, Math.max(0, h));
  editsMem.set(st.id, new Map(edits));
  B = applyEdits(B0, edits); BF = FUT.length ? B.concat(FUTB) : null;
  stage.setHeight(bi, (edits.get(bi) ?? h0) / Math.max(0.01, h0), B0[bi].g, B);
  heat = heavy ? null : heat;
  refreshWindow(false);
  if (heavy) computeHeat();
}
function resetEdits() {
  const ids = [...edits.keys()]; edits.clear(); editsMem.delete(st.id); B = applyEdits(B0, edits); BF = FUT.length ? B.concat(FUTB) : null;
  for (const bi of ids) stage.setHeight(bi, 1, B0[bi].g, B);
  refreshWindow(false); computeHeat(); ifPanel(true);
}
/** Buildings worth testing: the main blockers, the selected building, then the nearest in the window's field. */
function ifCandidates() {
  const out = [], seen = new Set(), push = (bi, why) => { if (bi == null || bi < 0 || bi >= B0.length || B0[bi] === T || seen.has(bi)) return; seen.add(bi); out.push({ bi, why }); };
  for (const r of blkRows) push(r.bi, 'takes sun');
  if (st.sel != null) push(st.sel, 'selected');
  for (const bi of edits.keys()) push(bi, 'edited');
  for (const r of NBR.filter((x) => !x.future && (x.view === 'in view' || x.view === 'side')).sort((a, b) => a.dist - b.dist).slice(0, 12)) push(r.bi, 'in view');
  return out;
}
let ifTok = 0;
function ifPanel(rebuild = false) {
  if (!hasWindow()) return;
  const cands = ifCandidates();
  if (st.ifBi == null || !cands.some((c) => c.bi === st.ifBi)) { st.ifBi = cands[0]?.bi ?? null; rebuild = true; }
  if (rebuild || !$('uIfSel')) {
    $('ifPanel').innerHTML = `<h3>What if <span>neighbour heights</span></h3>
      <p class="u-note">Make a building taller, shorter or gone and every number on this page (hours, the strip, the floor table, the views) re-runs with it. Use it for a rumoured addition, a tower going up, or a height you doubt.</p>
      ${cands.length ? `<div class="field"><label for="uIfSel">Building</label><select id="uIfSel">${cands.map((c) => `<option value="${c.bi}">${esc(bname(c.bi, true))} · ${Math.round(h0Of(c.bi))} m · ${c.why}</option>`).join('')}</select></div>
      <div class="field u-if-h"><label for="uIfH">Height <span class="val" id="uIfHV"></span></label><input type="range" id="uIfH" min="0" max="100" step="1"></div>
      <div class="u-if-acts"><button type="button" class="btn ghost sm" id="uIfZero">Remove it</button><button type="button" class="btn ghost sm" id="uIfOne">As built</button>${FUT.length ? `<label class="tg u-if-fut ${stage.opts.future ? 'on' : ''}"><input type="checkbox" class="sr" id="uIfFut" ${stage.opts.future ? 'checked' : ''}><span class="switch"></span><span class="lbl">Proposed buildings</span></label>` : ''}</div>` : '<p class="u-note">No building in front of this window to test.</p>'}
      <div id="uIfRes"></div>`;
    if (cands.length) {
      $('uIfSel').value = st.ifBi;
      $('uIfSel').addEventListener('change', (e) => { st.ifBi = +e.target.value; st.sel = st.ifBi; openCard(st.ifBi); ifPanel(true); });
      let raf = 0;
      $('uIfH').addEventListener('input', (e) => { const v = +e.target.value; ifSlider(v); cancelAnimationFrame(raf); raf = requestAnimationFrame(() => setEdit(st.ifBi, v)); });
      $('uIfH').addEventListener('change', (e) => { setEdit(st.ifBi, +e.target.value, true); syncUrl(); });
      $('uIfZero').addEventListener('click', () => { setEdit(st.ifBi, 0, true); ifPanel(true); syncUrl(); });
      $('uIfOne').addEventListener('click', () => { setEdit(st.ifBi, null, true); ifPanel(true); syncUrl(); });
      $('uIfFut')?.addEventListener('change', (e) => { stage.opts.future = e.target.checked; e.target.closest('.tg').classList.toggle('on', e.target.checked); stage.applyOpts(); syncTools(); refreshWindow(false); computeHeat(); });
    }
  }
  if (st.ifBi != null && $('uIfH')) {
    const h0 = h0Of(st.ifBi), max = Math.ceil(Math.max(h0 * 2, h0 + 60, edits.get(st.ifBi) || 0));
    const sl = $('uIfH'); sl.max = max;
    if (document.activeElement !== sl) sl.value = Math.round(edits.get(st.ifBi) ?? h0);
    ifSlider(+sl.value);
  }
  const tok = ++ifTok;
  clearTimeout(ifPanel.t); ifPanel.t = setTimeout(() => { if (tok === ifTok) ifResults(); }, 60);
}
function ifSlider(v) {
  const h0 = h0Of(st.ifBi), d = v - h0;
  $('uIfHV').textContent = `${Math.round(v)} m${Math.abs(d) >= 0.5 ? ` (${d > 0 ? '+' : '−'}${Math.round(Math.abs(d))})` : ' · as built'}`;
  fill($('uIfH'));
}
/** As built vs this scenario: direct sun at this floor today and on Dec 15 / Jun 15, and the sky view. */
function ifResults() {
  const box = $('uIfRes'); if (!box) return;
  const on = edits.size > 0;
  const o = site.origin, w = winPos(st.floor), P = panes(), y = +st.date.slice(0, 4), [, mo, d] = ymd();
  const fut = stage.opts.future && FUTB.length;
  const prof0 = on ? horizonProfile(fut ? B0.concat(FUTB) : B0, w.x, w.y, w.z) : null, prof1 = profF && stage.opts.future ? profF : profA;
  const days = [['Today', mo - 1, d], ['Dec 15', 11, 15], ['Jun 15', 5, 15]];
  const cell = (lbl, m, dd) => {
    const tab = table(y, m, dd, o.lat, o.lon, tz(), 6), now = litInfo(tab, prof1, st.az, 6, P).min, was = on ? litInfo(tab, prof0, st.az, 6, P).min : now;
    const dl = now - was;
    return `<div class="metric"><div class="k">${lbl}</div><div class="v">${hm(now)}</div><div class="s ${dl > 0 ? 'u-up' : dl < 0 ? 'u-down' : ''}">${on ? (Math.abs(dl) < 1 ? 'no change' : `${dl > 0 ? '+' : '−'}${hm(Math.abs(dl))} vs as built`) : 'as built'}</div></div>`;
  };
  const sv1 = skyView(prof1, st.az, P), sv0 = on ? skyView(prof0, st.az, P) : sv1;
  box.innerHTML = `<div class="metrics m4 u-if-m">${days.map((x) => cell(...x)).join('')}
      <div class="metric"><div class="k">Sky view</div><div class="v">${Math.round(sv1 * 100)}<small>%</small></div><div class="s ${sv1 > sv0 + 0.005 ? 'u-up' : sv1 < sv0 - 0.005 ? 'u-down' : ''}">${on ? (Math.abs(sv1 - sv0) < 0.005 ? 'no change' : `${sv1 > sv0 ? '+' : '−'}${Math.round(Math.abs(sv1 - sv0) * 100)} pts`) : 'as built'}</div></div></div>
    ${on ? `<div class="u-if-list"><span class="label">Scenario</span>${[...edits].map(([bi, h]) => `<button type="button" class="chip" data-unedit="${bi}" title="Back to as built">${esc(bname(bi, true))}: ${Math.round(h0Of(bi))} → ${Math.round(h)} m <span aria-hidden="true">×</span></button>`).join('')}<button type="button" class="btn ghost sm" id="uIfReset">Reset all</button></div>` : ''}`;
}

// ------------------------------------------------------------------ studies (heights map, views, panorama, seasons)
const STUDY_TABS = [['heights', 'Heights around'], ['floors', 'Views by floor'], ['pano', '360° skyline'], ['seasons', 'Seasons']];
let studyT = 0, studyDirty = true, studyIO = null, studyVisible = false;
function buildStudies() {
  $('studyPanel').innerHTML = `<div class="u-st-h"><h3>Studies <span id="uStNote"></span></h3>
      <div class="seg" id="uStTabs" role="tablist" aria-label="Study">${STUDY_TABS.map(([k, t]) => `<button type="button" role="tab" data-st="${k}" aria-selected="${k === st.study}">${t}</button>`).join('')}</div>
      <div class="u-st-acts"><button type="button" class="btn ghost sm" id="uStGo" title="Render again from the current settings">${ICON.reset}Refresh</button><button type="button" class="btn ghost sm" id="uStPng" title="Save this study as a PNG">${ICON.down}PNG</button></div></div>
    <div class="u-st-body" id="uStBody"></div>`;
  $('uStTabs').addEventListener('click', (e) => { const b = e.target.closest('[data-st]'); if (!b) return; st.study = b.dataset.st; $('uStTabs').querySelectorAll('[data-st]').forEach((x) => x.setAttribute('aria-selected', String(x.dataset.st === st.study))); studyDirty = true; renderStudy(); });
  $('uStGo').addEventListener('click', () => renderStudy());
  $('uStPng').addEventListener('click', studyPNG);
  $('uStBody').addEventListener('click', (e) => { const r = e.target.closest('[data-bi]'); if (r && r.dataset.bi !== '') { const bi = +r.dataset.bi; if (bi >= 0 && bi < B.length) { openCard(bi); if (st.mode === 'win' || st.mode === 'in') aimAt(bi); } } });
  if (!studyIO) {
    studyIO = new IntersectionObserver((es) => { studyVisible = es.some((x) => x.isIntersecting); if (studyVisible && studyDirty) studyStale(); }, { rootMargin: '120px' });
    studyIO.observe($('studyPanel'));
  }
  studyDirty = true; renderStudy();
}
/** Mark the open study out of date; it re-renders after a pause when it is on screen (never while the day plays). */
function studyStale(soon = false) {
  studyDirty = true; clearTimeout(studyT);
  if (!site || !hasWindow() || !$('uStBody')) return;
  if (st.study === 'heights' && soon) { renderStudy(); return; }
  studyT = setTimeout(() => { if (studyVisible && !st.playing && !$('view-unit').hidden) renderStudy(); }, st.study === 'heights' ? 150 : 650);
}
const themeInk = () => ({ font: css('--font-sans') || 'sans-serif', mono: css('--font-mono') || 'monospace', bg: css('--overlay') || 'rgba(14,16,21,.8)', fg: css('--ink'), ink3: css('--ink-3'), line: css('--line-strong'), sun: css('--sun'), bad: css('--bad'), blue: css('--band-30'), surface: css('--surface-1'), shade: document.documentElement.dataset.theme === 'light' ? 'rgba(20,24,32,.42)' : 'rgba(4,5,8,.55)' });
function studyFloors() {
  const mf = maxFloor(), want = [Math.max(2, Math.round(mf * 0.12)), st.floor, st.cmp, mf];
  return [...new Set(want)].sort((a, b) => a - b).slice(0, 4);
}
function renderStudy() {
  const body = $('uStBody'); if (!body || !site || !hasWindow()) return;
  clearTimeout(studyT); studyDirty = false;
  const W = Math.max(280, body.clientWidth || 600), k = st.study, note = $('uStNote');
  if (k === 'heights') {
    const w = winPos(st.floor), eye = w.z - BASE();
    const rows = NBR.map((r) => ({ ...r, bi: r.future ? null : r.bi }));
    const sec = sectorHeights(rows, { radius: 150, eye, future: !!stage.opts.future });
    const facing = [...new Set(paneFacings(st.az, panes()).map((a) => sectorOf(a)))];
    const colors = stage.classColors();
    body.innerHTML = `<div class="u-hm-grid"><div>${heightMapHTML({ B, ti: B.indexOf(T), w, az: st.az, spread: spread(), colors, names: (i) => bname(i, true), future: stage.opts.future ? FUT : [], streets: site.streets || [], radius: 300, sel: st.sel, edits })}</div>
      <div class="u-hm-side"><div class="label">Tallest roof in each direction <span>within 150 m · bar: tallest · tick: median</span></div>${sectorChartSVG(sec, { eye, eyeLabel: `Floor ${st.floor} eyes`, colors, facing, radius: 150 })}
      <p class="u-note">${secSummary(sec, facing, eye)}</p>
      <details class="u-sec-d"${W > 1100 ? ' open' : ''}><summary>Roofs by direction <span>table</span></summary>${sectorTable(sec, { facing })}</details></div></div>
      <p class="u-note">City roof heights above each building's own ground, from the footprint data (see Assumptions). Heights edited in What if show here too. Click a building or a bar to inspect it.</p>`;
    note.textContent = `300 m · ${HCLASS_LABELS.length} height classes`;
    return;
  }
  if (!body.querySelector('canvas.u-st-cv')) body.innerHTML = '<canvas class="u-st-cv" role="img" aria-label="Rendered study"></canvas><p class="u-note" id="uStCap"></p>';
  const canvas = body.querySelector('canvas.u-st-cv'), th = themeInk(), cap = $('uStCap');
  if (k === 'floors') {
    const o = site.origin, tab = tableFor(6), P = panes();
    const floors = studyFloors().map((f) => {
      const w = winPos(f), prof = f === st.floor ? profA : f === st.cmp ? profB : horizonProfile(B, w.x, w.y, w.z);
      const sv = skyView(prof, st.az, P), sun = litInfo(tab, prof, st.az, 6, P).min;
      return { w, cur: f === st.floor, label: `Floor ${f}${f === st.floor ? ' · this unit' : f === st.cmp ? ' · compare' : ''}`, sub: [`Eyes ${Math.round(w.z)} m · sky ${Math.round(sv * 100)}% · skyline ${Math.round(hAt(prof, st.az))}°`, `Direct sun ${hm(sun)} on ${fmtDay()}`] };
    });
    renderFloorViews({ stage, cv: canvas, width: W, floors, az: st.az, yaw: stage.look.yaw, pitch: stage.look.pitch, fov: stage.look.fov, theme: th });
    cap.textContent = `Same bearing (${Math.round(st.az + stage.look.yaw)}° ${compass(st.az + stage.look.yaw)}), tilt, lens and time (${fmtT(st.min)}, ${fmtDay()}) from each floor at this window position. Turn and zoom with the lens controls in the Window view.`;
    note.textContent = `${floors.length} floors · ${fmtT(st.min)}`;
  } else if (k === 'pano') {
    const w = winPos(st.floor), H = Math.round(Math.min(300, Math.max(170, W * 0.24)));
    renderPanorama({ stage, cv: canvas, width: W, height: H, w, az: st.az, spread: spread(), pitch: 10, lm: LM.map((l) => ({ ...l, hidden: !!l.hidden })), theme: th });
    const vis = LM.filter((l) => !l.hidden).length;
    cap.textContent = `All the way round from the window on floor ${st.floor} at ${fmtT(st.min)}, ${fmtDay()}. The shaded half is behind the window. ${vis} of ${LM.length} landmarks can be seen from this floor; faint chips are hidden behind nearer buildings.`;
    note.textContent = `floor ${st.floor} · centred on ${Math.round(st.az)}°`;
  } else if (k === 'seasons') {
    const y = +st.date.slice(0, 4), o = site.origin, w = winPos(st.floor), P = panes();
    const dates = [[2, 20, 'Mar 20'], [5, 21, 'Jun 21'], [8, 22, 'Sep 22'], [11, 21, 'Dec 21']], times = [540, 720, 900, 1080];
    const rows = dates.map(([m, d, lbl]) => ({ label: lbl, cells: times.map((min) => {
      const s = sunPos(zonedMs(y, m, d, min, tz()), o.lat, o.lon), up = s.alt > 0, fr = inFront(s.az, st.az, P);
      const hit = up && fr ? rayBlock(blockerSet(), w.x, w.y, w.z, s.az, s.alt) : null;
      const state = !up ? 'night' : !fr ? 'behind' : hit ? 'shade' : P && Math.abs(angDiff(s.az, st.az)) >= 90 ? 'side' : 'lit';
      return { sun: s, label: fmtT(min), state };
    }) }));
    const cam = stage.currentCam(), aspect = Math.max(1.2, Math.min(1.9, ($('stage').clientWidth || 16) / ($('stage').clientHeight || 10)));
    renderSeasons({ stage, cv: canvas, width: W, aspect, cam, rows, theme: th });
    cap.textContent = `The current ${{ orbit: 'orbit', win: 'window', in: 'inside', plan: 'plan', top: 'top-down' }[st.mode]} camera on the solstices and equinoxes at 9 am, noon, 3 pm and 6 pm (clock time, daylight saving included). Badges: the window on floor ${st.floor}. Move the camera and press Refresh to compare another view.`;
    note.textContent = `${{ orbit: 'Orbit', win: 'Window', in: 'Inside', plan: 'Plan', top: 'Top' }[st.mode]} camera · floor ${st.floor}`;
  }
}
const fmtDay = () => { const [y, m, d] = ymd(); return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }); };
function secSummary(sec, facing, eye) {
  const f = facing.map((i) => sec[i]).filter((q) => q.tallest);
  const tall = [...sec].filter((q) => q.tallest).sort((a, b) => b.tallest.h - a.tallest.h)[0];
  const open = sec.filter((q) => !q.count || q.above === 0).map((q) => q.dir);
  const parts = [];
  if (f.length) parts.push(`Toward the window (${f.map((q) => q.dir).join(', ')}): ${f.map((q) => `${q.above} of ${q.count} roofs above your eyes, tallest ${esc(short(q.tallest.name))} at ${Math.round(q.tallest.h)} m`).join('; ')}.`);
  if (tall) parts.push(`Tallest nearby: ${esc(short(tall.tallest.name))}, ${Math.round(tall.tallest.h)} m to the ${tall.dir}.`);
  if (open.length) parts.push(`Nothing above eye level (${Math.round(eye)} m) to the ${open.join(', ')} within 150 m.`);
  return parts.join(' ');
}
const short = (s, n = 26) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s));
function studyPNG() {
  const k = st.study, name = `${st.id}-floor${st.floor}-${k}.png`;
  if (k !== 'heights') { const cv = $('uStBody').querySelector('canvas'); if (!cv) return; cv.toBlob((b) => { if (b) { download(name, b, 'image/png'); toast('Study saved'); } }, 'image/png'); return; }
  // heights: rasterise the SVG map with its labels drawn on top
  const svg = $('uStBody').querySelector('.u-hm svg'); if (!svg) return;
  const S = 1280, c = document.createElement('canvas'); c.width = S; c.height = S;
  const g = c.getContext('2d'), clone = svg.cloneNode(true);
  // inline the computed styles the SVG relies on
  clone.querySelectorAll('*').forEach((el, i) => { const src = svg.querySelectorAll('*')[i], cs = getComputedStyle(src); el.setAttribute('style', `fill:${cs.fill};stroke:${cs.stroke};stroke-width:${cs.strokeWidth};stroke-dasharray:${cs.strokeDasharray};opacity:${cs.opacity};fill-opacity:${cs.fillOpacity}`); });
  clone.setAttribute('width', S); clone.setAttribute('height', S);
  const img = new Image();
  img.onload = () => {
    g.fillStyle = css('--surface-1'); g.fillRect(0, 0, S, S); g.drawImage(img, 0, 0, S, S);
    g.font = `600 22px ${css('--font-sans') || 'sans-serif'}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    $('uStBody').querySelectorAll('.u-hm-l').forEach((l) => { const x = parseFloat(l.style.left) / 100 * S, y = parseFloat(l.style.top) / 100 * S; g.lineWidth = 5; g.strokeStyle = css('--surface-1'); g.strokeText(l.textContent, x, y); g.fillStyle = css('--ink'); g.fillText(l.textContent, x, y); });
    c.toBlob((b) => { if (b) { download(name, b, 'image/png'); toast('Heights map saved'); } }, 'image/png');
  };
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(clone));
}

// ------------------------------------------------------------------ sun samples CSV (every 10 minutes, with blockers)
function samplesCSV() {
  if (!hasWindow()) return;
  const o = site.origin, y = +st.date.slice(0, 4), [, mo, d] = ymd(), w = winPos(st.floor), P = panes(), BB = blockerSet();
  const prof = profF && stage.opts.future ? profF : profA, step = 10;
  const days = [[mo - 1, d], [2, 20], [5, 21], [8, 22], [11, 21]].filter((x, i, a) => a.findIndex((q) => q[0] === x[0] && q[1] === x[1]) === i);
  const names = ['night', 'behind facade', 'shaded', 'direct sun', 'direct sun (side pane)'];
  const lines = ['date,time,sun_azimuth_deg,sun_altitude_deg,state,blocker,blocker_height_m,blocker_distance_m,floor,eye_m,facing_deg,scenario'];
  const esc2 = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const scen = edits.size ? [...edits].map(([bi, h]) => `${bname(bi, true)} ${Math.round(h0Of(bi))}->${Math.round(h)} m`).join('; ') : 'as built';
  for (const [m, dd] of days) {
    const res = dayBlockers(y, m, dd, o.lat, o.lon, tz(), BB, w, prof, st.az, STRIP_FROM, STRIP_TO, step, P);
    const date = `${y}-${String(m + 1).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
    for (let k = 0; k < res.states.length; k++) {
      const min = STRIP_FROM + k * step + step / 2, s = sunPos(zonedMs(y, m, dd, min, tz()), o.lat, o.lon), bi = res.bi[k], b = bi >= 0 ? BB[bi] : null;
      lines.push([date, `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(Math.floor(min % 60)).padStart(2, '0')}`, s.az.toFixed(1), s.alt.toFixed(1), names[res.states[k]], b ? bname(bi, true) : '', b ? (b.top - Math.max(b.g, 0)).toFixed(1) : '', b ? distToBuilding(b, w.x, w.y).toFixed(1) : '', st.floor, w.z.toFixed(1), Math.round(st.az), scen].map(esc2).join(','));
    }
  }
  download(`${st.id}-floor${st.floor}-sun-samples.csv`, lines.join('\n') + '\n', 'text/csv');
  toast(`${lines.length - 1} samples saved (every ${step} minutes, ${days.length} dates)`);
}

// ------------------------------------------------------------------ URL sync
let urlT = 0;
function syncUrlSoon() { clearTimeout(urlT); urlT = setTimeout(syncUrl, 400); }
function syncUrl() {
  if ($('view-unit').hidden || !st.id) return;
  const qs = new URLSearchParams(location.search);
  writeScenario(qs, st, FACES[st.face], stage.look, stage.opts.future);
  qs.set('date', st.date); qs.set('min', String(Math.round(st.min / 5) * 5)); qs.set('floor', String(st.floor));
  if (edits.size) qs.set('wh', `${st.id}|${[...edits].map(([bi, h]) => `${bi}:${Math.round(h * 10) / 10}`).join(',')}`); else qs.delete('wh');
  if (st.mode === 'orbit') qs.delete('mode'); else qs.set('mode', st.mode === 'win' ? 'window' : st.mode === 'in' ? 'inside' : st.mode);
  const url = `${location.pathname}?${qs}#unit/${encodeURIComponent(st.id)}`;
  if (url !== location.pathname + location.search + location.hash) history.replaceState(history.state, '', url);
}

// ------------------------------------------------------------------ snapshot and 3D model
function snapshot() {
  if (!stage || !site || !hasWindow()) return;
  stage.frame(true);
  const src = $('gl'), w = src.width, h = src.height, k = w / (src.clientWidth || w), cap = Math.round(66 * k);
  const c = document.createElement('canvas'); c.width = w; c.height = h + cap;
  const g = c.getContext('2d'); g.drawImage(src, 0, 0);
  const sans = css('--font-sans') || 'sans-serif';
  // labels as chips
  g.textBaseline = 'middle';
  for (const L of stage.labels) {
    if (!L.shown) continue;
    const x = L.sx * k, y = L.sy * k, lw = (L.w || 80) * k, lh = (L.h || 28) * k;
    if (L.cls === 'street') {
      g.font = `600 ${9.5 * k}px ${sans}`; g.textAlign = 'left'; g.lineWidth = 3 * k; g.strokeStyle = css('--ground'); g.fillStyle = css('--ink-2');
      const t = L.el.textContent.toUpperCase(); g.strokeText(t, x, y + lh / 2); g.fillText(t, x, y + lh / 2); continue;
    }
    g.fillStyle = L.cls === 'win' ? css('--sun') : css('--overlay') || 'rgba(14,16,21,.8)'; g.strokeStyle = L.cls === 'future' ? css('--warn') : css('--line-strong') || 'rgba(255,255,255,.1)';
    g.beginPath(); g.roundRect ? g.roundRect(x, y, lw, lh, 7 * k) : g.rect(x, y, lw, lh); g.fill(); g.stroke();
    const b = L.el.querySelector('b')?.textContent || L.el.textContent, s = L.el.querySelector('span')?.textContent || '';
    g.fillStyle = L.cls === 'win' ? '#1b1200' : L.cls === 'future' ? css('--warn') : L.cls === 'own' ? css('--accent') : css('--ink'); g.font = `600 ${11 * k}px ${sans}`; g.textAlign = 'left';
    g.fillText(b, x + 8 * k, s ? y + lh * 0.36 : y + lh / 2);
    if (s) { g.fillStyle = L.cls === 'win' ? 'rgba(27,18,0,.75)' : css('--ink-2'); g.font = `500 ${10 * k}px ${sans}`; g.fillText(s, x + 8 * k, y + lh * 0.72); }
  }
  // caption strip
  const L = listing(), [y, m, d] = ymd(), zn = zoneAbbr(y, m - 1, d, st.min, tz()), p = provenance();
  const tab = tableFor(6), A = litInfo(tab, profA, st.az, 6, panes());
  g.fillStyle = css('--surface-1'); g.fillRect(0, h, w, cap);
  g.fillStyle = css('--line-strong'); g.fillRect(0, h, w, Math.max(1, k));
  g.textAlign = 'left'; g.fillStyle = css('--ink'); g.font = `600 ${14 * k}px ${sans}`;
  const state = { night: 'night', behind: 'sun behind the facade', lit: 'direct sun on the window', side: 'direct sun through a side pane', shade: 'window in shadow' }[hudState()];
  g.fillText(`${label(L) || st.id} · floor ${st.floor} · window faces ${Math.round(st.az)}° ${compass(st.az)}${st.bay ? ' (bay)' : ''} · ${new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })} ${fmtT(st.min)} ${zn}`, 16 * k, h + 22 * k);
  g.fillStyle = css('--ink-2'); g.font = `500 ${11.5 * k}px ${sans}`;
  g.fillText(`${state} · direct sun this date ${hm(A.min)} · exposure: ${(PROV[p.exposure] || [p.exposure])[0].toLowerCase()} · window position: ${(PROV[p.position] || [p.position])[0].toLowerCase()} · ${site.source || 'footprints'} as ${B.some((b) => b.parts) ? 'prisms and building parts' : 'straight prisms'}, direct sun only${edits.size ? ` · what-if: ${edits.size} neighbour height${edits.size > 1 ? 's' : ''} changed` : ''}`, 16 * k, h + 45 * k);
  g.textAlign = 'right'; g.fillStyle = css('--ink-3'); g.font = `600 ${11 * k}px ${sans}`; g.fillText('ApartmentScout', w - 16 * k, h + 22 * k);
  const name = `${st.id}-floor${st.floor}-${st.date}-${String(Math.floor(st.min / 60)).padStart(2, '0')}${String(st.min % 60).padStart(2, '0')}-${{ win: 'window', in: 'inside' }[st.mode] || st.mode}.png`;
  c.toBlob((blob) => { if (!blob) { toast('Snapshot failed'); return; } download(name, blob, 'image/png'); toast('Snapshot saved'); }, 'image/png');
}
async function exportGLB() {
  if (!stage || !site || !hasWindow()) return;
  const L = listing(), p = provenance();
  const meta = {
    name: `${st.id} site model`, listing: st.id, building: L.building || site.listing?.building || '', unit: L.unit || '', floor: st.floor,
    facade_bearing_deg: Math.round(st.az * 10) / 10, panes_deg: paneFacings(st.az, panes()).map((x) => Math.round(x * 10) / 10),
    window_position: Math.round(st.t * 100) / 100, slab_height_m: Math.round(slabZ(st.floor) * 10) / 10, floor_height_m: FH(),
    provenance: { exposure: p.exposure, window_position: p.position, floor: p.floor, target: site.provenance?.target || null },
    apartment: interior ? (interior.generic ? 'generic room' : plan?.title || 'floor plan') : null,
    height_edits: edits.size ? [...edits].map(([bi, h]) => ({ index: bi, name: bname(bi, true), original_m: Math.round(h0Of(bi) * 10) / 10, scenario_m: Math.round(h * 10) / 10 })) : [],
    source: site.source || '', site_generated: site.generated || null, exported: new Date().toISOString(),
    frame: 'metres; glTF Y up; x east, -z north; origin at the site origin', geometry: B.some((b) => b.parts) ? 'footprints extruded to roof height; buildings with components (OpenStreetMap building parts or a manual file) drawn as stacked prisms' : 'footprints extruded to roof height (no setbacks or crowns)',
  };
  try {
    toast('Building the 3D model…');
    const buf = await stage.exportGLB(meta);
    download(`${st.id}-floor${st.floor}.glb`, buf, 'model/gltf-binary'); toast('3D model saved (.glb)');
  } catch (e) { toast(`Export failed: ${e.message || e}`, 4000); }
}

// ------------------------------------------------------------------ loop
function frame(t) {
  requestAnimationFrame(frame);
  if ($('view-unit').hidden || !stage?.scene) return;
  if (st.playing) {
    const dt = lastT ? Math.min(100, t - lastT) : 16; lastT = t;
    st.min += dt * 0.09; if (st.min >= STRIP_TO - STRIP_STEP) st.min = STRIP_FROM;
    refreshTime(); syncUrlSoon();
  }
  stage.frame();
}
