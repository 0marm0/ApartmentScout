// Unit 3D: the listing's building and every neighbour in 3D, the sun for any date and time, the view from the
// chosen window, a clickable day strip, a sun-path chart, direct-sun hours for every floor, and the evidence
// behind each input. Reads sites/<id>.json (v1 or v2; every v2 key is optional).
import { S, byId, label, loadJSON, on, download } from './app.js';
import { $, esc, css, toast, ICONS } from './util.js';
import {
  DEG, sunPos, zonedMs, zoneAbbr, angDiff, fmtT, prepBuildings, horizonProfile, horizonDir, hAt, litInfo,
  facesOf, snapOpen, streetAhead, rayBlock, compass, dayStates,
} from './sun.js';
import { UnitStage } from './unit/scene.js';
import { STRIP_FROM, STRIP_TO, STRIP_STEP, stripBar, stripTicks, stateAt, drawPath, heatHTML, monthBandSVG, table } from './unit/charts.js';

let site = null, B = [], T = null, FACES = [], LM = [], FUT = [], BF = null, stage = null;
const st = {
  id: null, face: 0, t: 0.5, floor: 10, cmp: 20, az: 180, date: '', min: 780, mode: 'orbit', playing: false,
  manual: {}, moved: null, sel: null, first: true,
};
let profA = null, profB = null, profF = null, statesA = null, statesB = null, curSun = null, curHit = null, heat = null, heatTok = 0, loopOn = false, lastT = 0;
const tz = () => site?.timezone || S.crit.search?.timezone || 'America/New_York';
const FH = () => +site?.floor_height_m || 3.2;
const maxFloor = () => Math.max(2, Math.floor((T.top - Math.max(T.g, 0)) / FH()));
const MONTHS = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ');
const MODES = [['orbit', 'Orbit', 'Orbit the block'], ['win', 'Window', 'From the window'], ['plan', 'Plan', 'Street plan, north up'], ['top', 'Top', 'Top down']];
const PROV = {
  established: ['Established', 'good'], plan: ['Floor plan', 'good'], listing: ['Listing says', 'accent'], agent: ['Agent says', 'accent'],
  'photo-landmarks': ['Photo landmarks', 'accent'], model: ['Model', ''], assumed: ['Assumed', 'warn'], inferred: ['Inferred', 'warn'], manual: ['Your setting', ''],
};
const HSRC = { roof: 'Measured roof height', 'pluto-floors': 'PLUTO floor count × 3.2 m', 'osm-levels': 'OpenStreetMap levels × 3.2 m', 'osm-height': 'OpenStreetMap height tag', default: 'Default height (unknown)' };
const DSRC = { 'nyc-footprints': 'NYC Building Footprints', osm: 'OpenStreetMap' };
const ICON = {
  shadows: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="5.5"/><path d="M8 2.5a5.5 5.5 0 010 11z" fill="currentColor"/></svg>',
  labels: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="3.5" width="12" height="6.5" rx="2"/><path d="M8 10v3"/></svg>',
  streets: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M5 2L3 14M11 2l2 12M8 3v2M8 7.5v2M8 12v1.5"/></svg>',
  future: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="2 2"><rect x="4" y="2.5" width="8" height="11" rx="1"/></svg>',
  ray: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="4" r="2"/><path d="M3 13l7-7"/></svg>',
  cone: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 13L2.5 4.5a8 8 0 0111 0z"/></svg>',
  target: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 14V5l4-3 4 3v9z"/><path d="M4 9h8" opacity=".6"/></svg>',
  cam: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 5.5h2.5l1.2-2h4.6l1.2 2H14v7.5H2z"/><circle cx="8" cy="9" r="2.4"/></svg>',
  play: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M4.5 3v10l8.5-5z"/></svg>',
  pause: '<svg viewBox="0 0 16 16" fill="currentColor"><rect x="4" y="3" width="3" height="10" rx="1"/><rect x="9" y="3" width="3" height="10" rx="1"/></svg>',
  reset: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 8a5 5 0 109-3M12 2v3H9"/></svg>',
};

// ------------------------------------------------------------------ layout
export function init() {
  const root = document.getElementById('view-unit');
  root.innerHTML = `<div class="view-pad u-pad">
    <header class="page-h u-head">
      <div class="t"><div class="u-eyebrow">Light and view</div><h1 id="uTitle">Unit 3D</h1><div class="u-sub" id="uSub"></div></div>
      <div class="actions"><label class="u-pick"><span class="sr">Listing</span><select id="unitSel"></select></label><span id="uLinks" class="u-links"></span>
        <button class="btn" type="button" id="uSnap" title="Download a PNG of the model with a caption">${ICON.cam}Snapshot</button></div>
    </header>
    <div class="u-grid" id="uGrid">
      <div class="u-main">
        <div id="stage" class="canvas-stage u-stage">
          <canvas id="gl" tabindex="0" aria-label="3D model of the building and its neighbours. Arrow keys turn the view, plus and minus zoom."></canvas>
          <div class="u-labels" id="uLabels" aria-hidden="true"></div>
          <div class="float u-modes" id="uModes" role="group" aria-label="Camera">${MODES.map(([k, t, tip]) => `<button type="button" data-mode="${k}" title="${tip}" aria-pressed="false">${t}</button>`).join('')}</div>
          <div class="float u-tools" id="uTools" role="group" aria-label="Layers">
            ${[['shadows', 'Shadows'], ['labels', 'Labels'], ['streets', 'Street names and centrelines'], ['future', 'Proposed buildings'], ['ray', 'Sun ray'], ['cone', 'View cone']].map(([k, t]) => `<button type="button" data-tg="${k}" title="${t}" aria-label="${t}" aria-pressed="false">${ICON[k]}</button>`).join('')}
            <hr><button type="button" id="uTarget" title="This building: solid" aria-label="This building display: solid">${ICON.target}<i class="u-tmode">S</i></button>
            <button type="button" id="uHome" title="Reset the camera" aria-label="Reset the camera">${ICON.reset}</button>
          </div>
          <button type="button" class="u-compass" id="uCompass" title="North. Click to face north" aria-label="Compass, click to face north"><svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="18.5"/><g id="uNeedle"><path d="M20 5l4 15h-8z" class="n"/><path d="M20 35l4-15h-8z" class="s"/><text x="20" y="4.2" text-anchor="middle">N</text></g></svg></button>
          <div class="hud u-hud" id="hud" aria-live="polite"></div>
          <div class="float u-card" id="uCard" hidden></div>
          <div class="float u-lens" id="uLens" hidden>
            <div class="field"><label for="uFov">Lens <span class="val" id="uFovV"></span></label><input type="range" id="uFov" min="35" max="110" value="70"></div>
            <div class="field"><label for="uYaw">Turn <span class="val" id="uYawV"></span></label><input type="range" id="uYaw" min="-90" max="90" value="0"></div>
            <div class="field"><label for="uPitch">Tilt <span class="val" id="uPitchV"></span></label><input type="range" id="uPitch" min="-15" max="60" value="6"></div>
          </div>
          <div class="u-loading" id="uLoad"><span class="skeleton"></span>Building the model…</div>
        </div>
        <section class="panel u-time" id="timePanel" aria-label="Date and time"></section>
      </div>
      <aside class="u-side">
        <section class="panel" id="winPanel"></section>
        <section class="panel" id="sunPanel"></section>
        <section class="panel" id="seePanel"></section>
        <section class="panel"><h3>Sun path against the skyline <span id="pathNote"></span></h3><canvas id="pathCv" class="plot u-path" role="img" aria-label="Sun path against the skyline seen from the window"></canvas>
          <div class="legend-row" id="pathLegend"></div></section>
        <section class="panel" id="heatPanel"></section>
        <section class="panel" id="evPanel"></section>
      </aside>
    </div></div>`;
  const ids = S.manifest.sites || [];
  const sel = $('unitSel');
  sel.innerHTML = ids.length ? ids.map((id) => { const L = byId(id); return `<option value="${esc(id)}">${esc(L ? label(L) : id)}${L?.floor ? ' · floor ' + Math.round(L.floor) : ''}</option>`; }).join('') : '<option>No site models yet</option>';
  sel.addEventListener('change', () => { location.hash = '#unit/' + encodeURIComponent(sel.value); });
  $('uSnap').addEventListener('click', snapshot);
  on('theme', () => { stage?.setPalette(); if (site) { drawPathChart(); stage.dirty = true; } });
}

export async function show(id) {
  const ids = S.manifest.sites || [];
  if (!ids.length) {
    $('uGrid').innerHTML = `<div class="empty"><b>No site models yet</b>Run <code>apartmentscout site &lt;listing-id&gt;</code> for a listing, then <code>apartmentscout build</code>.</div>`;
    $('uSnap').hidden = true; return;
  }
  id = id && ids.includes(id) ? id : st.id || ids[0];
  $('unitSel').value = id;
  if (id !== st.id) await load(id);
  stage?.resize(); drawPathChart();
  if (!loopOn) { loopOn = true; requestAnimationFrame(frame); }
}

// ------------------------------------------------------------------ load
async function load(id) {
  $('uLoad').hidden = false;
  const data = await loadJSON(`${S.base}/sites/${id}.json`, null);
  if (!data || !Array.isArray(data.b) || !data.b.length) {
    $('uLoad').innerHTML = `<div class="empty"><b>This site model could not be read</b>Rebuild it with <code>apartmentscout site ${esc(id)}</code>.</div>`;
    return;
  }
  site = data; st.id = id; st.manual = {}; st.moved = null; st.sel = null; heat = null;
  B = prepBuildings(site.b, site.holes && typeof site.holes === 'object' ? site.holes : null);
  T = B[site.target] || B[0];
  FACES = facesOf(T, 8, B);
  // merge the site file's own party-wall flags (v2)
  // v2 site files carry the Python party-wall verdict per face; it wins over the browser's own sampling
  for (const f of site.faces || []) { const g = f && FACES.find((x) => x.i === f.i); if (!g) continue; if (f.shared) g.shared = true; else if (+site.version >= 2) g.shared = false; }
  if (FACES.every((f) => f.shared)) FACES.forEach((f) => (f.shared = false)); // never leave the picker empty
  LM = (site.lm || []).filter((l) => Array.isArray(l) && l.length >= 5).map((l) => ({ name: String(l[0]), idx: l[1], x: +l[2], y: +l[3], top: +l[4] }));
  FUT = (Array.isArray(site.future) ? site.future : []).filter((f) => f && Array.isArray(f.ring) && f.ring.length >= 3 && +f.h > 0);
  BF = FUT.length ? B.concat(prepBuildings(FUT.map((f) => [+f.h, 0, 1, f.ring.flat()]))) : null;
  const L = listing(), qs = new URLSearchParams(location.search), w = site.window || {};
  // facade: the site file's choice unless it is a party wall, else the listing's exposure, else the longest open face
  const open = FACES.map((f, i) => [f, i]).filter(([f]) => !f.shared);
  const near = (brg) => open.reduce((best, cur) => { const d = Math.abs(angDiff(cur[0].bearing, brg)), bd = Math.abs(angDiff(best[0].bearing, brg)); return d < bd - 0.5 || (Math.abs(d - bd) <= 0.5 && cur[0].length > best[0].length) ? cur : best; }, open[0]);
  let fi = FACES.findIndex((f) => f.i === w.face);
  if (fi >= 0 && FACES[fi].shared) { st.moved = FACES[fi]; fi = near(FACES[fi].bearing)[1]; }
  if (fi < 0) {
    const exp = (L.exposure || []).map((e) => ({ N: 0, NNE: 22.5, NE: 45, ENE: 67.5, E: 90, ESE: 112.5, SE: 135, SSE: 157.5, S: 180, SSW: 202.5, SW: 225, WSW: 247.5, W: 270, WNW: 292.5, NW: 315, NNW: 337.5 })[e]).filter((x) => x != null);
    fi = exp.length ? near(exp[0])[1] : open.reduce((b, c) => (c[0].length > b[0].length ? c : b), open[0])[1];
  }
  st.face = fi;
  st.t = snapOpen(FACES[fi], w.t ?? 0.5);
  st.az = FACES[fi].bearing;
  const mf = maxFloor();
  const qf = st.first ? +qs.get('floor') : NaN;
  st.floor = Math.max(1, Math.min(mf, Math.round(qf || w.floor || L.floor || mf / 2)));
  st.cmp = Math.min(mf, Math.max(1, st.floor + 9 > mf ? Math.max(1, st.floor - 9) : st.floor + 9));
  if (st.first) {
    const mi = moveIn();
    st.date = /^\d{4}-\d{2}-\d{2}$/.test(qs.get('date') || '') ? qs.get('date') : mi || new Date().toISOString().slice(0, 10);
    st.min = clampMin(+(qs.get('min') || 780));
    const m = qs.get('mode'); st.mode = m === 'window' || m === 'win' ? 'win' : ['plan', 'top', 'orbit'].includes(m) ? m : 'orbit';
    st.first = false;
  }
  header();
  if (!stage) {
    stage = new UnitStage($('gl'), $('stage'), $('uLabels'));
    stage.onCompass = (az) => { const n = $('uNeedle'); if (n) n.setAttribute('transform', `rotate(${-az} 20 20)`); };
    wireStage();
    new ResizeObserver(() => { stage.resize(); }).observe($('stage'));
    new ResizeObserver(() => drawPathChart()).observe($('pathCv').parentElement);
  }
  stage.opts.streets = true; stage.opts.future = true;
  await new Promise((r) => requestAnimationFrame(r)); // let the loading state paint before the heavy build
  stage.build({ B, T, ti: B.indexOf(T), streets: Array.isArray(site.streets) ? site.streets : [], future: FUT, lm: LM, ownLabel: site.listing?.building || L.building || 'This building' });
  stage.resize();
  buildTimePanel(); buildWindowPanel(); evidencePanel(); syncTools();
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
    exposure: st.manual.face || st.manual.az ? 'manual' : P.exposure || L.exposure_source || (L.exposure?.length ? 'listing' : 'assumed'),
    position: st.manual.pos ? 'manual' : P.window_position || 'assumed',
    floor: st.manual.floor ? 'manual' : P.floor || (L.floor_inferred ? 'inferred' : L.floor != null ? 'listing' : 'assumed'),
  };
}
const provChip = (k) => { const [t, c] = PROV[k] || [String(k), '']; return `<span class="pill ${c}">${esc(t)}</span>`; };
function subline() {
  const L = listing(), p = provenance();
  $('uSub').innerHTML = `<span class="u-addr">${esc(L.address || site.listing?.address || '')}</span>
    <span class="u-fact"><b>Floor ${st.floor}</b>${provChip(p.floor)}</span>
    <span class="u-fact"><b>Faces ${compass(st.az)} ${Math.round(st.az)}°</b>${provChip(p.exposure)}</span>
    <span class="u-fact"><b>Window position</b>${provChip(p.position)}</span>`;
}

// ------------------------------------------------------------------ stage wiring
function wireStage() {
  $('uModes').querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
  $('uTools').querySelectorAll('[data-tg]').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.tg; stage.opts[k] = !stage.opts[k]; stage.applyOpts(); syncTools();
    if (k === 'future' && FUT.length) refreshWindow(false); else refreshTime();
  }));
  $('uTarget').addEventListener('click', () => {
    const order = ['solid', 'faint', 'hidden']; stage.opts.target = order[(order.indexOf(stage.opts.target) + 1) % 3]; stage.applyOpts(); syncTools();
  });
  $('uHome').addEventListener('click', () => { if (st.mode === 'plan') stage.resetPlan(); else if (st.mode === 'top') stage.topDown(true); else if (st.mode === 'win') { setLook(0, 6, 70); } else stage.resetOrbit(true); });
  $('uCompass').addEventListener('click', faceNorth);
  for (const [id, k] of [['uFov', 'fov'], ['uYaw', 'yaw'], ['uPitch', 'pitch']]) $(id).addEventListener('input', (e) => { stage.look[k] = +e.target.value; syncLens(); stage.dirty = true; });
  // click to inspect a building; drag to look around in window mode
  const cv = $('gl'); let down = null;
  cv.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, yaw: stage.look.yaw, pitch: stage.look.pitch, id: e.pointerId }; if (st.mode === 'win') cv.setPointerCapture(e.pointerId); });
  cv.addEventListener('pointermove', (e) => {
    if (!down || st.mode !== 'win' || !(e.buttons & 1)) return;
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
}
function onStageKey(e) {
  const k = e.key, step = e.shiftKey ? 15 : 5;
  if (st.mode === 'win') {
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
  if (st.mode === 'plan') return;
  const cam = stage.orbitCam, ctl = stage.controls, off = cam.position.clone().sub(ctl.target), r = Math.hypot(off.x, off.z);
  cam.position.set(ctl.target.x, cam.position.y, ctl.target.z + r); ctl.update(); stage.dirty = true;
}
function setLook(fov, yaw, pitch) {
  stage.look.fov = Math.max(35, Math.min(110, fov)); stage.look.yaw = Math.max(-90, Math.min(90, yaw)); stage.look.pitch = Math.max(-15, Math.min(60, pitch));
  $('uFov').value = stage.look.fov; $('uYaw').value = stage.look.yaw; $('uPitch').value = stage.look.pitch; syncLens(); stage.dirty = true;
}
function syncLens() {
  const L = stage.look;
  $('uFovV').textContent = Math.round(L.fov) + '°'; $('uYawV').textContent = (L.yaw > 0 ? '+' : '') + Math.round(L.yaw) + '°'; $('uPitchV').textContent = Math.round(L.pitch) + '°';
  for (const id of ['uFov', 'uYaw', 'uPitch']) fill($(id));
}
function setMode(m, quiet = false) {
  st.mode = m; stage.setMode(m);
  $('uModes').querySelectorAll('[data-mode]').forEach((b) => { b.classList.toggle('on', b.dataset.mode === m); b.setAttribute('aria-pressed', String(b.dataset.mode === m)); });
  $('uLens').hidden = m !== 'win'; $('stage').dataset.mode = m;
  if (m === 'win') syncLens();
  if (!quiet) { refreshTime(); syncUrl(); }
}
function syncTools() {
  $('uTools').querySelectorAll('[data-tg]').forEach((b) => {
    const k = b.dataset.tg, on = !!stage.opts[k];
    const na = (k === 'streets' && !(site.streets || []).length) || (k === 'future' && !FUT.length);
    b.classList.toggle('on', on && !na); b.setAttribute('aria-pressed', String(on && !na)); b.disabled = na;
    if (na) b.title = k === 'streets' ? 'No street centrelines in this site file' : 'No proposed buildings in this site file';
  });
  const t = stage.opts.target, nm = { solid: 'solid', faint: 'faint', hidden: 'hidden' }[t];
  $('uTarget').title = `This building: ${nm} (click to change)`; $('uTarget').setAttribute('aria-label', `This building display: ${nm}`);
  $('uTarget').querySelector('.u-tmode').textContent = t[0].toUpperCase(); $('uTarget').classList.toggle('on', t !== 'solid');
}

// ------------------------------------------------------------------ geometry helpers
function winPos(floor, t = st.t) {
  const f = FACES[st.face]; if (!f) return { x: 0, y: 0, z: 10, fx: 0, fy: 0 };
  const x = f.a[0] + (f.b[0] - f.a[0]) * t, y = f.a[1] + (f.b[1] - f.a[1]) * t;
  const nx = Math.sin(f.bearing * DEG), ny = Math.cos(f.bearing * DEG);
  return { x: x + nx * 0.4, y: y + ny * 0.4, z: Math.max(T.g, 0) + (floor - 1) * FH() + 1.6, fx: x, fy: y };
}
const slabZ = (floor) => Math.max(T.g, 0) + (floor - 1) * FH();
const sunAt = (min) => { const [y, m, d] = ymd(); return sunPos(zonedMs(y, m - 1, d, min, tz()), site.origin.lat, site.origin.lon); };
const tableFor = (step = 6) => { const [y, m, d] = ymd(); return table(y, m - 1, d, site.origin.lat, site.origin.lon, tz(), step); };

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
    <div class="legend-row u-strip-legend"><span><i class="sw s3"></i>Direct sun on the window</span><span><i class="sw s2"></i>Shaded by buildings</span><span><i class="sw s1"></i>Sun behind the facade</span><span><i class="sw s0"></i>Night</span><span class="faint">Click or drag the strip to set the time. Arrow keys step 5 minutes.</span></div>`;
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
function setTime(m) { st.min = clampMin(m); refreshTime(); syncUrlSoon(); }
function dateChanged() { statesA = statesB = null; refreshStrip(); refreshTime(); if (heat && heat.year !== +st.date.slice(0, 4)) computeHeat(); else drawHeat(); syncUrl(); }
function togglePlay() {
  st.playing = !st.playing; lastT = 0;
  const b = $('uPlay'); b.classList.toggle('primary', st.playing); b.setAttribute('aria-pressed', String(st.playing));
  b.innerHTML = st.playing ? `${ICON.pause}<span>Pause</span>` : `${ICON.play}<span>Play day</span>`;
}
function refreshStrip() {
  const [y, m, d] = ymd(), o = site.origin;
  statesA = dayStates(y, m - 1, d, o.lat, o.lon, tz(), profA, st.az, STRIP_FROM, STRIP_TO, STRIP_STEP);
  statesB = dayStates(y, m - 1, d, o.lat, o.lon, tz(), profB, st.az, STRIP_FROM, STRIP_TO, STRIP_STEP);
  $('uBarA').innerHTML = stripBar(statesA); $('uBarB').innerHTML = stripBar(statesB);
  $('uKeyA').textContent = 'Fl ' + st.floor; $('uKeyB').textContent = 'Fl ' + st.cmp;
}

// ------------------------------------------------------------------ window panel
function buildWindowPanel() {
  const mf = maxFloor(), shared = FACES.filter((f) => f.shared).length, streets = site.streets || [];
  const opts = FACES.map((f, i) => [f, i]).filter(([f]) => !f.shared).sort((a, b) => a[0].bearing - b[0].bearing || b[0].length - a[0].length).map(([f, i]) => {
    const mid = [(f.a[0] + f.b[0]) / 2, (f.a[1] + f.b[1]) / 2], s = streetAhead(streets, mid[0], mid[1], f.bearing);
    return `<option value="${i}">${compass(f.bearing)} ${Math.round(f.bearing)}° · ${Math.round(f.length)} m${f.court ? ' · light court' : ''}${s ? ' · ' + esc(s.name) : ''}</option>`;
  }).join('');
  $('winPanel').innerHTML = `<h3>Window <span id="uWinProv"></span></h3>
    <div class="field"><label for="uFace">Facade</label><select id="uFace">${opts}</select></div>
    ${shared ? `<p class="u-note">${shared} shared wall${shared > 1 ? 's' : ''} hidden: a neighbour is built against ${shared > 1 ? 'them' : 'it'}, so ${shared > 1 ? 'they have' : 'it has'} no windows.</p>` : ''}
    ${st.moved ? `<p class="u-note warn">The site file put the window on a shared wall (${Math.round(st.moved.bearing)}°). Moved to the nearest open facade.</p>` : ''}
    <div class="u-sliders">
      <div class="field"><label for="uPos">Position along facade <span class="val" id="uPosV"></span></label><input type="range" id="uPos" min="2" max="98" value="${Math.round(st.t * 100)}"></div>
      <div class="field"><label for="uFloor">Floor <span class="val" id="uFloorV"></span></label><input type="range" id="uFloor" min="1" max="${mf}" value="${st.floor}"></div>
      <div class="field"><label for="uCmp">Compare floor <span class="val" id="uCmpV"></span></label><input type="range" id="uCmp" min="1" max="${mf}" value="${st.cmp}"></div>
      <div class="field"><label for="uAz">Window faces <span class="val" id="uAzV"></span></label><input type="range" id="uAz" min="0" max="359" value="${Math.round(st.az)}"></div>
    </div>
    <div class="u-win-foot"><span class="faint" id="uWinFoot"></span><button type="button" class="btn ghost" id="uWinReset" hidden>${ICON.reset}Back to the listing</button></div>`;
  $('uFace').value = st.face;
  $('uFace').addEventListener('change', (e) => { st.face = +e.target.value; st.t = snapOpen(FACES[st.face], st.t); st.az = FACES[st.face].bearing; st.manual.face = true; st.manual.az = false; $('uAz').value = Math.round(st.az); $('uPos').value = Math.round(st.t * 100); refreshWindow(true); });
  $('uPos').addEventListener('input', (e) => { st.t = snapOpen(FACES[st.face], +e.target.value / 100); st.manual.pos = true; refreshWindow(true); });
  $('uPos').addEventListener('change', () => { $('uPos').value = Math.round(st.t * 100); fill($('uPos')); });
  $('uFloor').addEventListener('input', (e) => { st.floor = +e.target.value; st.manual.floor = true; refreshWindow(false); });
  $('uCmp').addEventListener('input', (e) => { st.cmp = +e.target.value; refreshWindow(false); });
  $('uAz').addEventListener('input', (e) => { st.az = +e.target.value; st.manual.az = true; refreshWindow(true); });
  $('uWinReset').addEventListener('click', () => load(st.id));
}
function syncWindowPanel() {
  const f = FACES[st.face];
  $('uPosV').textContent = Math.round(st.t * 100) + '%'; $('uFloorV').textContent = st.floor; $('uCmpV').textContent = st.cmp; $('uAzV').textContent = `${Math.round(st.az)}° ${compass(st.az)}`;
  ['uPos', 'uFloor', 'uCmp', 'uAz'].forEach((id) => fill($(id)));
  const w = winPos(st.floor), s = streetAhead(site.streets, w.fx, w.fy, st.az);
  $('uWinFoot').textContent = `${Math.round(st.t * f.length)} m along a ${Math.round(f.length)} m facade · eye level ${Math.round(w.z)} m${s ? ` · ${s.name} ${Math.round(s.dist)} m ahead` : ''}`;
  $('uWinReset').hidden = !(st.manual.face || st.manual.pos || st.manual.floor || st.manual.az);
  $('uWinProv').innerHTML = provChip(provenance().exposure);
}
/** Paint the filled part of a range track (app.css reads --p). */
function fill(el) { if (!el) return; const p = ((+el.value - +el.min) / ((+el.max - +el.min) || 1)) * 100; el.style.setProperty('--p', p + '%'); }

// ------------------------------------------------------------------ refresh
function refreshWindow(heavy) {
  const a = winPos(st.floor), b = winPos(st.cmp);
  profA = horizonProfile(B, a.x, a.y, a.z); profB = horizonProfile(B, b.x, b.y, b.z);
  profF = BF && stage.opts.future ? horizonProfile(BF, a.x, a.y, a.z) : null;
  stage.setWindow(a, st.az, slabZ(st.floor), slabZ(st.cmp), FH(), `Floor ${st.floor} · ${compass(st.az)}`);
  syncWindowPanel(); subline(); refreshStrip(); landmarks(); refreshTime();
  if (heavy || !heat) computeHeat(); else drawHeat();
  syncUrlSoon();
}
function refreshTime() {
  if (!site) return;
  const s = curSun = sunAt(st.min), up = s.alt > 0, front = Math.abs(angDiff(s.az, st.az)) < 90;
  const w = winPos(st.floor), blockers = stage.opts.future && BF ? BF : B;
  curHit = up && front ? rayBlock(blockers, w.x, w.y, w.z, s.az, s.alt) : null;
  const lit = up && front && !curHit;
  const state = !up ? 'night' : !front ? 'behind' : lit ? 'lit' : 'shade';
  stage.setSun(s); stage.setRay(state, curHit);
  // clock, strip cursor
  const [y, m, d] = ymd(), zn = zoneAbbr(y, m - 1, d, st.min, tz());
  $('uClock').textContent = fmtT(st.min);
  $('uDateTxt').textContent = `${new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}${zn ? ' · ' + zn : ''}`;
  const tr = $('uStrip'), frac = (st.min - STRIP_FROM) / (STRIP_TO - STRIP_FROM);
  $('uCur').style.left = frac * 100 + '%';
  const msg = { night: 'night', behind: 'sun behind the facade', lit: 'direct sun on the window', shade: 'window shaded by buildings' }[state];
  tr.setAttribute('aria-valuenow', String(st.min)); tr.setAttribute('aria-valuetext', `${fmtT(st.min)}, ${msg}`);
  hud(s, state);
  sunPanel(s, state);
  drawPathChart();
}
function hud(s, state) {
  const tag = { night: ['Night', 'shade'], behind: ['Sun behind the window', 'shade'], lit: ['Direct sun on the window', 'lit'], shade: ['Window in shadow', 'shade'] }[state];
  const blk = state === 'shade' && curHit ? bname(curHit.bi, true) : '';
  $('hud').innerHTML = `<span class="${tag[1]}">${tag[0]}${blk ? ` · ${esc(blk)}` : ''}</span><span>Sun ${Math.round(s.az)}° ${compass(s.az)} · ${s.alt > 0 ? Math.round(s.alt) + '° up' : 'below horizon'}</span><span class="u-hud-x">Floor ${st.floor} · faces ${Math.round(st.az)}° ${compass(st.az)}</span>${st.mode === 'win' ? '<span class="u-hud-x">Drag to look around</span>' : ''}`;
}
/** A short name for building bi: address, landmark name, or "a 61 m building". */
function bname(bi, short = false) {
  if (bi == null) return '';
  if (bi === B.indexOf(T)) return listing().building || 'this building';
  if (bi >= B.length) { const f = FUT[bi - B.length]; return f?.name || 'a proposed building'; }
  const m = site.bmeta?.[bi], l = LM.find((x) => x.idx === bi);
  const h = Math.round(B[bi].top - Math.max(B[bi].g, 0));
  if (l) return l.name; if (m?.address) return short ? m.address.replace(/,.*$/, '') : m.address;
  return `a ${h} m building`;
}

function sunPanel(s, state) {
  const tab = tableFor(6), A = litInfo(tab, profA, st.az), Bc = litInfo(tab, profB, st.az), F = profF ? litInfo(tab, profF, st.az) : null;
  const [, mo] = ymd(), rng = site.study?.sun_hours_range;
  let why;
  if (state === 'night') why = `At ${fmtT(st.min)} the sun is below the horizon.`;
  else if (state === 'behind') why = `At ${fmtT(st.min)} the sun is at ${Math.round(s.az)}° ${compass(s.az)}, behind a window that faces ${Math.round(st.az)}°.`;
  else if (state === 'lit') why = `At ${fmtT(st.min)} the sun is ${Math.round(s.alt)}° up and clears every building in that direction (skyline ${Math.round(hAt(profA, s.az))}°).`;
  else why = `At ${fmtT(st.min)} the sun is ${Math.round(s.alt)}° up but ${esc(bname(curHit?.bi))}${curHit ? `, ${Math.round(curHit.dist)} m away,` : ''} blocks it, so the window is in shadow.`;
  const segs = A.segs.length ? `Floor ${st.floor} gets direct sun ${A.segs.map((q) => `<b>${fmtT(q[0])}</b> to <b>${fmtT(Math.min(q[1], 1439))}</b>`).join(', ')}.` : `Floor ${st.floor} gets no direct sun on this date.`;
  const lo = rng?.lo?.[mo - 1], hi = rng?.hi?.[mo - 1];
  const rangeTxt = lo != null && hi != null ? `<div class="u-range"><span class="pill">Range</span><b>${(+lo).toFixed(1)}–${(+hi).toFixed(1)} h</b> on ${MONTHS[mo - 1]} 15 across ${rangeScope(rng)}. The exact window position is the biggest unknown.</div>` : '';
  const vals = heat?.[st.floor] || (st.floor === site.window?.floor && !st.manual.face && !st.manual.pos && !st.manual.az ? site.study?.sun_hours : null);
  $('sunPanel').innerHTML = `<h3>Sun on this window <span>${esc(new Date(Date.UTC(...ymd().map((v, i) => (i === 1 ? v - 1 : v)))).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }))}</span></h3>
    <div class="metrics ${F ? 'm4' : 'm3'}">
      <div class="metric"><div class="k">Sun now</div><div class="v">${s.alt > 0 ? Math.round(s.alt) + '°' : '—'}<small>${s.alt > 0 ? compass(s.az) : 'set'}</small></div><div class="s ${state === 'lit' ? 'u-lit' : ''}">${{ night: 'Night', behind: 'Behind facade', lit: 'On the window', shade: 'Blocked' }[state]}</div></div>
      <div class="metric"><div class="k">Floor ${st.floor}</div><div class="v">${hm(A.min)}</div><div class="s">direct sun today</div></div>
      <div class="metric"><div class="k">Floor ${st.cmp}</div><div class="v">${hm(Bc.min)}</div><div class="s">${Bc.min > A.min ? '+' + hm(Bc.min - A.min) : Bc.min < A.min ? '−' + hm(A.min - Bc.min) : 'same'}</div></div>
      ${F ? `<div class="metric"><div class="k">With proposed</div><div class="v">${hm(F.min)}</div><div class="s">${F.min < A.min ? '−' + hm(A.min - F.min) : 'no change'}</div></div>` : ''}
    </div>
    <p class="u-why">${why}</p><p class="u-segs">${segs}</p>
    ${rangeTxt}
    <div class="u-band-wrap"><div class="label">By month · floor ${st.floor} <span>${rng ? 'bar: this window · band: range' : 'hours on the 15th'}</span></div>${monthBandSVG(vals, rng, mo - 1)}</div>`;
}
const hm = (min) => { if (!min) return 'none'; const h = Math.floor(Math.round(min) / 60), m = Math.round(min) % 60; return h && m ? `${h} h ${String(m).padStart(2, '0')} m` : h ? `${h} h` : `${m} m`; };
function rangeScope(r) {
  const p = Array.isArray(r.positions) && r.positions.length ? `positions ${Math.round(Math.min(...r.positions) * 100)}–${Math.round(Math.max(...r.positions) * 100)}% along the facade` : 'window positions';
  const f = Array.isArray(r.floors) && r.floors.length ? `floors ${Math.min(...r.floors)}–${Math.max(...r.floors)}` : 'nearby floors';
  return `${p} and ${f}`;
}

function landmarks() {
  const w = winPos(st.floor);
  let open = 0, tot = 0;
  for (let a = st.az - 60; a <= st.az + 60; a++) { open += 60 - Math.min(60, hAt(profA, a)); tot += 60; }
  const rows = LM.map((l) => {
    const dx = l.x - w.x, dy = l.y - w.y, dist = Math.hypot(dx, dy), az = ((Math.atan2(dx, dy) / DEG) + 360) % 360;
    const block = horizonDir(B, w.x, w.y, w.z, az, l.idx), topA = Math.atan2(l.top - w.z, dist) / DEG;
    const from = Math.max(0, w.z + dist * Math.tan(block * DEG)), off = Math.abs(angDiff(az, st.az));
    const behind = off >= 90, hidden = !behind && topA <= block + 0.2;
    l.hidden = behind || hidden;
    const vis = behind ? ['Behind the window', '', 3] : hidden ? ['Hidden', 'bad', 2] : [l.top - from > l.top * 0.98 ? 'Whole tower' : `Top ${Math.round(l.top - from)} m`, 'good', off > 60 ? 1 : 0];
    return { l, az, dist, vis, html: `<li class="u-lm${vis[2] >= 2 ? ' off' : ''}"><div><b>${esc(l.name)}</b><span>${Math.round(l.top)} m · ${compass(az)} ${Math.round(az)}° · ${dist >= 1000 ? (dist / 1000).toFixed(1) + ' km' : Math.round(dist) + ' m'}</span></div><span class="pill ${vis[1]}">${vis[0]}${vis[2] === 1 ? ' · to the side' : ''}</span></li>` };
  }).sort((a, b) => a.vis[2] - b.vis[2] || a.dist - b.dist);
  const behind = rows.filter((r) => r.vis[2] === 3), nv = rows.filter((r) => r.vis[2] < 2).length, wall = nearestAhead(w), s = streetAhead(site.streets, w.fx, w.fy, st.az);
  $('seePanel').innerHTML = `<h3>What the window sees <span>${nv} of ${LM.length} landmarks</span></h3>
    <div class="metrics m3">
      <div class="metric"><div class="k">Open sky</div><div class="v">${Math.round((100 * open) / tot)}<small>%</small></div><div class="s">in a ±60° view</div></div>
      <div class="metric"><div class="k">Skyline ahead</div><div class="v">${Math.round(hAt(profA, st.az))}°<small>up</small></div><div class="s">straight out</div></div>
      <div class="metric"><div class="k">Nearest wall</div><div class="v">${wall ? Math.round(wall.d) + '<small>m</small>' : '—'}</div><div class="s">${wall ? `${Math.round(wall.h)} m tall` : 'clear to the edge'}</div></div>
    </div>
    ${s ? `<p class="u-note">Looks onto <b>${esc(s.name)}</b>, ${Math.round(s.dist)} m to the centreline.</p>` : ''}
    <ul class="u-lms">${rows.filter((r) => r.vis[2] < 3).map((r) => r.html).join('') || (LM.length ? '' : '<li class="faint">No landmark towers in range.</li>')}</ul>
    ${behind.length ? `<p class="u-note u-behind"><b>Behind the window:</b> ${behind.map((r) => esc(r.l.name)).join(', ')}.</p>` : ''}`;
  stage.dirty = true;
}
function nearestAhead(w) {
  const ux = Math.sin(st.az * DEG), uy = Math.cos(st.az * DEG); let best = 1e9, top = 0;
  for (const b of B) {
    if (b === T) continue;
    for (const p of [b.p, ...(b.holes || [])]) {
      const n = p.length / 2;
      for (let j = 0; j < n; j++) {
        const ax = p[2 * j], ay = p[2 * j + 1], j2 = (j + 1) % n, ex = p[2 * j2] - ax, ey = p[2 * j2 + 1] - ay;
        const den = ux * ey - uy * ex; if (Math.abs(den) < 1e-9) continue;
        const wx = ax - w.x, wy = ay - w.y, t = (wx * ey - wy * ex) / den, s = (wx * uy - wy * ux) / den;
        if (t > 0.5 && s >= 0 && s <= 1 && t < best && b.top > w.z) { best = t; top = b.top - Math.max(b.g, 0); }
      }
    }
  }
  return best < 1e9 ? { d: best, h: top } : null;
}

// ------------------------------------------------------------------ heatmap
function computeHeat() {
  const tok = ++heatTok, mf = maxFloor(), y = +st.date.slice(0, 4), o = site.origin;
  heat = { year: y };
  const tabs = Array.from({ length: 12 }, (_, m) => table(y, m, 15, o.lat, o.lon, tz(), 6));
  let fl = 1;
  const step = () => {
    if (tok !== heatTok) return;
    const t0 = performance.now();
    while (fl <= mf && performance.now() - t0 < 24) {
      const w = winPos(fl), prof = fl === st.floor ? profA : horizonProfile(B, w.x, w.y, w.z);
      heat[fl] = tabs.map((t) => litInfo(t, prof, st.az).min / 60); fl++;
    }
    drawHeat(fl <= mf);
    if (fl <= mf) setTimeout(step, 0); else if (curSun) sunPanel(curSun, hudState());
  };
  drawHeat(true); setTimeout(step, 0);
}
const hudState = () => { const s = curSun; if (!s || s.alt <= 0) return 'night'; if (Math.abs(angDiff(s.az, st.az)) >= 90) return 'behind'; return curHit ? 'shade' : 'lit'; };
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
  $('uHeatNote').textContent = busy ? 'Calculating…' : `${mf} floors`;
  if (first || box.dataset.floor !== String(st.floor)) {
    const cur = box.querySelector('.fl.cur'); if (cur) box.scrollTop = Math.max(0, cur.offsetTop - box.clientHeight / 2);
    box.dataset.floor = String(st.floor);
  } else box.scrollTop = keep;
}

// ------------------------------------------------------------------ sun path chart
function drawPathChart() {
  if (!site || !profA || $('view-unit').hidden) return;
  drawPath($('pathCv'), { lat: site.origin.lat, lon: site.origin.lon, tz: tz(), date: st.date, az: st.az, profA, profB, profF, sun: curSun });
  $('pathNote').textContent = `floor ${st.floor}`;
  $('pathLegend').innerHTML = `<span><i class="sw u-sw-sky"></i>Skyline from floor ${st.floor}</span><span><i class="sw u-sw-cmp2"></i>From floor ${st.cmp}</span><span><i class="sw u-sw-sun"></i>${esc(st.date)} (faint where blocked)</span><span><i class="sw u-sw-ref"></i>Jun 21 · Mar 20 · Dec 21</span>${profF ? '<span><i class="sw u-sw-fut"></i>With proposed buildings</span>' : ''}`;
}

// ------------------------------------------------------------------ building card
function openCard(bi) {
  st.sel = bi; stage.select(bi);
  const b = bi < B.length ? B[bi] : null; if (!b) return;
  const m = site.bmeta?.[bi] || null, isT = b === T, h = b.top - Math.max(b.g, 0), w = winPos(st.floor);
  const cx = (b.bb[0] + b.bb[2]) / 2, cy = (b.bb[1] + b.bb[3]) / 2, dist = Math.hypot(cx - w.x, cy - w.y), az = ((Math.atan2(cx - w.x, cy - w.y) / DEG) + 360) % 360;
  const lm = LM.find((x) => x.idx === bi), off = Math.abs(angDiff(az, st.az));
  const title = isT ? (listing().building || 'This building') : lm?.name || m?.address || 'Building';
  const rows = [
    ['Roof', `${Math.round(h)} m · ${Math.round(h * 3.281)} ft${Math.abs(b.g) > 1 ? ` <span class="faint">(ground ${b.g > 0 ? '+' : ''}${b.g.toFixed(0)} m)</span>` : ''}`],
    ['Height from', esc(m?.height_src ? HSRC[m.height_src] || m.height_src : b.eg ? 'Estimated' : 'Roof height in the footprint data')],
    ['Data', esc(m?.src ? DSRC[m.src] || m.src : site.source || 'Footprints')],
    m?.address && (lm || isT) ? ['Address', esc(m.address)] : null,
    m?.bin ? ['BIN', `<span class="mono">${esc(m.bin)}</span>`] : null,
    m?.bbl ? ['BBL', `<span class="mono">${esc(m.bbl)}</span>`] : null,
    m?.year ? ['Built', esc(m.year)] : null,
    !isT ? ['From your window', `${dist >= 1000 ? (dist / 1000).toFixed(1) + ' km' : Math.round(dist) + ' m'} · ${compass(az)} ${Math.round(az)}° · ${off >= 90 ? 'behind the window' : off > 60 ? 'off to the side' : 'in view'}`] : null,
  ].filter(Boolean);
  const blocks = curHit && curHit.bi === bi;
  $('uCard').innerHTML = `<div class="u-card-h"><div><div class="u-eyebrow">${isT ? 'This building' : lm ? 'Landmark' : 'Building'}</div><b>${esc(title)}</b></div><button type="button" class="icon-btn" id="uCardX" aria-label="Close">${ICONS.x}</button></div>
    ${blocks ? `<div class="u-card-flag">Blocks the sun on your window at ${fmtT(st.min)}</div>` : ''}
    <dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
    ${isT ? '<p class="faint u-card-foot">Drawn as its footprint pushed straight up: setbacks and crowns are not modelled.</p>' : ''}`;
  $('uCard').hidden = false;
  $('uCardX').addEventListener('click', closeCard);
}
function closeCard() { st.sel = null; stage?.select(null); $('uCard').hidden = true; }

// ------------------------------------------------------------------ evidence
function evidencePanel() {
  const p = provenance(), L = listing(), P = site.provenance || {};
  const area = Math.abs((() => { let a = 0; for (let i = 0; i < T.n; i++) { const j = (i + 1) % T.n; a += T.p[2 * i] * T.p[2 * j + 1] - T.p[2 * j] * T.p[2 * i + 1]; } return a / 2; })());
  const bm = Array.isArray(site.bmeta) ? site.bmeta.filter(Boolean) : [];
  const count = (k) => bm.reduce((acc, m) => ((acc[m[k] || '?'] = (acc[m[k] || '?'] || 0) + 1), acc), {});
  const srcs = bm.length ? Object.entries(count('src')).map(([k, n]) => `${n.toLocaleString()} from ${esc(DSRC[k] || k)}`).join(', ') : `${esc(site.source || 'building footprints')}`;
  const hs = bm.length ? Object.entries(count('height_src')).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n.toLocaleString()} ${esc((HSRC[k] || k).toLowerCase())}`).join(', ') : null;
  const ev = [
    ['Exposure', p.exposure, L.exposure?.length ? `Listing gives ${esc(L.exposure.join(', '))}.` : 'No exposure on the listing: the model starts on the longest open facade.'],
    ['Window position', p.position, 'Where the unit sits along its facade is rarely published. The model puts the window at the point you choose.'],
    ['Floor', p.floor, p.floor === 'inferred' ? 'Guessed from the unit number.' : L.floor != null ? `Listing gives floor ${esc(Math.round(L.floor))}.` : 'No floor on the listing.'],
  ];
  $('evPanel').innerHTML = `<h3>Assumptions and evidence</h3>
    <ul class="u-ev">${ev.map(([k, v, t]) => `<li><div class="u-ev-k">${k}${provChip(v)}</div><p>${t}</p></li>`).join('')}</ul>
    ${P.notes ? `<p class="u-note">${esc(P.notes)}</p>` : ''}
    <div class="u-caveat"><b>A footprint is not the tower's real shape.</b> Every building is its outline pushed straight up to its roof height: no setbacks, crowns, podiums or bays. ${area > 2500 ? `This building's footprint covers ${Math.round(area).toLocaleString()} m², likely more than one mass on one lot, so use the faint or hidden display to check the window.` : 'Shade from a stepped tower can be overstated.'}</div>
    <dl class="u-src">
      <dt>Buildings</dt><dd>${B.length.toLocaleString()} footprints: ${srcs}.</dd>
      ${hs ? `<dt>Heights</dt><dd>${hs}.</dd>` : ''}
      ${(site.streets || []).length ? `<dt>Streets</dt><dd>${site.streets.length} centrelines (centre of the road, not the kerb).</dd>` : ''}
      ${FUT.length ? `<dt>Proposed</dt><dd>${FUT.map((f) => `${esc(f.name || 'Unnamed')} (${Math.round(f.h)} m, ${esc(f.status || 'proposed')}${safeLink(f.url)})`).join('; ')}.</dd>` : ''}
      <dt>Sun</dt><dd>Standard solar formulas, ${esc(tz())} with daylight saving. Direct sun only: no reflections, trees or haze. A window counts as lit when the sun is within 90° of the way it faces and above every building in that direction.</dd>
      <dt>Floors</dt><dd>${FH()} m each; eye level 1.6 m above the floor.</dd>
    </dl>
    <p class="u-rule">Only a floor plan with a compass, exact-unit photos or the building's own data establish which way a unit faces. Everything else is a working assumption: check it on a visit at the same time of day.</p>`;
}
function safeLink(u) { return /^https?:\/\//i.test(String(u || '')) ? `, <a href="${esc(u)}" target="_blank" rel="noopener">source</a>` : ''; }

// ------------------------------------------------------------------ URL sync
let urlT = 0;
function syncUrlSoon() { clearTimeout(urlT); urlT = setTimeout(syncUrl, 400); }
function syncUrl() {
  if ($('view-unit').hidden || !st.id) return;
  const qs = new URLSearchParams(location.search);
  qs.set('date', st.date); qs.set('min', String(Math.round(st.min / 5) * 5)); qs.set('floor', String(st.floor));
  if (st.mode === 'orbit') qs.delete('mode'); else qs.set('mode', st.mode === 'win' ? 'window' : st.mode);
  const url = `${location.pathname}?${qs}#unit/${encodeURIComponent(st.id)}`;
  if (url !== location.pathname + location.search + location.hash) history.replaceState(history.state, '', url);
}

// ------------------------------------------------------------------ snapshot
function snapshot() {
  if (!stage || !site) return;
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
  const tab = tableFor(6), A = litInfo(tab, profA, st.az);
  g.fillStyle = css('--surface-1'); g.fillRect(0, h, w, cap);
  g.fillStyle = css('--line-strong'); g.fillRect(0, h, w, Math.max(1, k));
  g.textAlign = 'left'; g.fillStyle = css('--ink'); g.font = `600 ${14 * k}px ${sans}`;
  const state = { night: 'night', behind: 'sun behind the facade', lit: 'direct sun on the window', shade: 'window in shadow' }[hudState()];
  g.fillText(`${label(L) || st.id} · floor ${st.floor} · window faces ${Math.round(st.az)}° ${compass(st.az)} · ${new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })} ${fmtT(st.min)} ${zn}`, 16 * k, h + 22 * k);
  g.fillStyle = css('--ink-2'); g.font = `500 ${11.5 * k}px ${sans}`;
  g.fillText(`${state} · direct sun this date ${hm(A.min)} · exposure: ${(PROV[p.exposure] || [p.exposure])[0].toLowerCase()} · window position: ${(PROV[p.position] || [p.position])[0].toLowerCase()} · ${site.source || 'footprints'} as straight prisms, direct sun only`, 16 * k, h + 45 * k);
  g.textAlign = 'right'; g.fillStyle = css('--ink-3'); g.font = `600 ${11 * k}px ${sans}`; g.fillText('ApartmentScout', w - 16 * k, h + 22 * k);
  const name = `${st.id}-floor${st.floor}-${st.date}-${String(Math.floor(st.min / 60)).padStart(2, '0')}${String(st.min % 60).padStart(2, '0')}-${st.mode === 'win' ? 'window' : st.mode}.png`;
  c.toBlob((blob) => { if (!blob) { toast('Snapshot failed'); return; } download(name, blob, 'image/png'); toast('Snapshot saved'); }, 'image/png');
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
