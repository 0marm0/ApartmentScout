// Two units side by side in live 3D: each its own apartment inside its own city (a UnitStage each, the engine Unit 3D uses), at
// the same date and time, with one camera mode for both (Inside from the main seat, or Window), one time slider and its own
// direct-sun readout. Opened from Compare (#pair/<id>,<id>). On a phone the two panes become one with a toggle: one scene is on
// screen at a time, so the second never costs a frame. The numbers are Unit 3D's: the same horizon profile, window placement,
// calibration and sun table, only worked out for two windows at once.
import { S, byId, label, loadJSON } from '../app.js';
import { $, esc } from '../util.js';
import { sunPos, zonedMs, zoneAbbr, angDiff, fmtT, prepBuildings, horizonProfile, litInfo, facesOf, snapOpen, compass, dayStates, BAY, inFront, rayBlock, paneFacings } from '../sun.js';
import { UnitStage } from './scene.js';
import { canonicalFaces, snapPosition } from './scenario.js';
import { buildInterior, genericPlan } from './interior.js';
import { buildFurniture } from './furniture.js';
import { insideViews } from './inside-views.js';
import { normalisePlan } from '../plan/model.js';
import { resolve as resolveItem } from '../plan/catalog.js';
import { resolveCal, geoFromSite, measuredFromSite } from './calibration.js';
import { effectiveComponents } from './parts.js';
import { getPin } from './anchor.js';
import { windowOpenAir } from './openair.js';
import { table, stripBar, STRIP_FROM, STRIP_TO, STRIP_STEP } from './charts.js';
import { dirBearing, hm } from './panels.js';
import { getPlanScenario } from '../plan/scenario-bridge.js';
import { pickPair } from './pair-core.js';

const DEG = Math.PI / 180;
const MODES = [['in', 'Inside', 'From the main seat of each apartment'], ['win', 'Window', 'From each apartment’s window']];
const SIDES = ['a', 'b'];
const isPhone = () => matchMedia('(max-width: 760px)').matches;
const clampMin = (m) => Math.max(STRIP_FROM, Math.min(STRIP_TO - STRIP_STEP, Number.isFinite(m) ? m : 780));
const ymd = (date) => date.split('-').map(Number);

const st = { date: '', min: 780, mode: 'in', playing: false, shown: 'a' };   // shared by both panes
const sides = { a: null, b: null };
let ids = [], token = 0, loopOn = false, lastT = 0, root = null;
const tz = (side) => side?.site?.timezone || S.crit.search?.timezone || 'America/New_York';

// ------------------------------------------------------------------ view contract
export function init() {
  root = $('view-pair');
  root.innerHTML = `<div class="view-pad pr-pad">
    <header class="page-h pr-head">
      <div class="t"><div class="u-eyebrow">Compare</div><h1>Side by side in 3D</h1><p id="prSub">Two apartments at the same date and time, in their own blocks.</p></div>
      <div class="actions">
        <label class="u-pick"><span class="sr">First apartment</span><select id="prSelA"></select></label>
        <button class="btn ghost" type="button" id="prSwap" aria-label="Swap the two apartments" title="Swap">⇄</button>
        <label class="u-pick"><span class="sr">Second apartment</span><select id="prSelB"></select></label>
        <a class="btn ghost" href="#compare" id="prBack">Back to Compare</a>
      </div>
    </header>
    <div class="panel pr-ctl" id="prCtl">
      <div class="seg" id="prModes" role="group" aria-label="Camera, the same for both">${MODES.map(([k, t, tip]) => `<button type="button" data-mode="${k}" title="${tip}" aria-pressed="false">${t}</button>`).join('')}</div>
      <div class="pr-time">
        <b id="prClock" aria-live="off"></b>
        <input type="range" id="prTime" min="${STRIP_FROM}" max="${STRIP_TO - STRIP_STEP}" step="${STRIP_STEP}" aria-label="Time of day, for both" value="780">
        <button class="btn" type="button" id="prPlay" aria-pressed="false" title="Play the day (p)">Play day</button>
      </div>
      <div class="pr-date"><input type="date" id="prDate" aria-label="Date, for both"><div class="seg" id="prQuick" role="group" aria-label="Date presets"></div></div>
      <div class="seg pr-which" id="prWhich" role="group" aria-label="Which apartment to show"><button type="button" data-w="a">First</button><button type="button" data-w="b">Second</button></div>
    </div>
    <div class="pr-grid" id="prGrid" data-shown="a">
      ${SIDES.map((k) => `<section class="pr-side" id="prSide-${k}" data-side="${k}" aria-label="${k === 'a' ? 'First' : 'Second'} apartment">
        <div class="canvas-stage pr-stage" id="prStage-${k}"><canvas id="prGl-${k}" tabindex="0" aria-label="${k === 'a' ? 'First' : 'Second'} apartment in 3D. Drag to look around."></canvas><div class="u-labels" id="prLab-${k}" aria-hidden="true"></div>
          <div class="pr-load" id="prLoad-${k}">Building the scene…</div><div class="hud pr-hud" id="prHud-${k}" aria-live="polite"></div></div>
        <div class="panel pr-read" id="prRead-${k}"></div>
      </section>`).join('')}
    </div>
    <p class="u-note pr-note">Direct sun is worked out for each window from the buildings around it, on a clear day, the same way as Unit 3D. Drag in a pane to look around; scroll to zoom the lens.</p>
  </div>`;
  const pick = (k) => (e) => { const next = [...ids]; next[k] = e.target.value; go(next); };
  $('prSelA').addEventListener('change', pick(0)); $('prSelB').addEventListener('change', pick(1));
  $('prSwap').addEventListener('click', () => go([ids[1], ids[0]]));
  $('prModes').addEventListener('click', (e) => { const b = e.target.closest('[data-mode]'); if (b) setMode(b.dataset.mode); });
  $('prTime').addEventListener('input', (e) => setTime(+e.target.value));
  $('prDate').addEventListener('change', (e) => { if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) { st.date = e.target.value; dateChanged(); } });
  $('prQuick').addEventListener('click', (e) => { const b = e.target.closest('[data-d]'); if (b) { st.date = b.dataset.d; $('prDate').value = st.date; dateChanged(); } });
  $('prPlay').addEventListener('click', togglePlay);
  $('prWhich').addEventListener('click', (e) => { const b = e.target.closest('[data-w]'); if (b) showWhich(b.dataset.w); });
  addEventListener('keydown', (e) => {
    if ($('view-pair').hidden || ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'p') { togglePlay(); e.preventDefault(); } else if (e.key === ',' || e.key === '.') { setTime(st.min + (e.key === '.' ? 15 : -15)); e.preventDefault(); }
  });
  for (const k of SIDES) wireLook(k);
  new ResizeObserver(() => { for (const k of SIDES) sides[k]?.stage.resize(); }).observe($('prGrid'));
  matchMedia('(max-width: 760px)').addEventListener?.('change', () => layout());
  window.__pair3d = { st, get sides() { return sides; }, get ids() { return ids; }, setMode, setTime };   // a test and debugging handle, like __unit3d
}

export async function show(arg) {
  const have = S.manifest.sites || [];
  const qs = new URLSearchParams(location.search);
  const want = String(arg || '').split(',').map((x) => x.trim()).filter(Boolean);
  const pair = pickPair(want, have, { compare: S.compare, byId });
  if (!pair) { root.querySelector('.pr-pad').innerHTML = `<div class="empty"><b>Two site models are needed</b>Side by side compares two apartments that each have a site model. Run <code>apartmentscout site &lt;listing-id&gt;</code> for each, then <code>apartmentscout build</code>.</div>`; return; }
  if (!st.date) st.date = /^\d{4}-\d{2}-\d{2}$/.test(qs.get('date') || '') ? qs.get('date') : S.crit.search?.move_in?.earliest ? String(S.crit.search.move_in.earliest).slice(0, 10) : new Date().toISOString().slice(0, 10);
  if (qs.get('min')) st.min = clampMin(+qs.get('min'));
  if (qs.get('cam') === 'window' || qs.get('cam') === 'win') st.mode = 'win';
  if (isPhone()) st.shown = 'a';
  chrome(have);
  if (pair.join(',') !== ids.join(',') || !sides.a || !sides.b) await go(pair, true);
  else { layout(); for (const k of SIDES) sides[k]?.stage.resize(); }
  if (!loopOn) { loopOn = true; requestAnimationFrame(frame); }
}

/** Header controls, date presets and the toggle for a phone. */
function chrome(have) {
  const opts = have.map((id) => { const L = byId(id); return `<option value="${esc(id)}">${esc(L ? label(L) : id)}${L?.floor ? ' · floor ' + Math.round(L.floor) : ''}</option>`; }).join('');
  $('prSelA').innerHTML = opts; $('prSelB').innerHTML = opts;
  const y = +st.date.slice(0, 4), mi = S.crit.search?.move_in?.earliest ? String(S.crit.search.move_in.earliest).slice(0, 10) : null;
  $('prQuick').innerHTML = [[mi, 'Move-in'], [`${y}-12-21`, 'Dec 21'], [`${y}-03-20`, 'Mar 20'], [`${y}-06-21`, 'Jun 21']].filter((q) => q[0]).map(([d, t]) => `<button type="button" data-d="${esc(d)}">${t}</button>`).join('');
  $('prDate').value = st.date; $('prTime').value = st.min;
  syncChrome();
}
function syncChrome() {
  $('prModes').querySelectorAll('[data-mode]').forEach((b) => { b.classList.toggle('on', b.dataset.mode === st.mode); b.setAttribute('aria-pressed', String(b.dataset.mode === st.mode)); });
  $('prWhich').querySelectorAll('[data-w]').forEach((b) => { b.classList.toggle('on', b.dataset.w === st.shown); b.textContent = (sides[b.dataset.w]?.short || (b.dataset.w === 'a' ? 'First' : 'Second')); });
  $('prGrid').dataset.shown = st.shown;
  $('prClock').textContent = fmtT(st.min); $('prTime').value = st.min;
  const [y, m, d] = ymd(st.date), zn = zoneAbbr(y, m - 1, d, st.min, tz(sides.a));
  $('prClock').title = `${new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}${zn ? ' · ' + zn : ''}`;
  if (ids[0]) { $('prSelA').value = ids[0]; $('prSelB').value = ids[1]; }
}
function layout() {
  $('prGrid').dataset.shown = st.shown;
  $('prGrid').dataset.phone = String(isPhone());
  for (const k of SIDES) { const s = sides[k]; if (s) { s.stage.resize(); s.stage.dirty = true; } }
}
function showWhich(w) { st.shown = w; syncChrome(); layout(); }

async function go(next, silent = false) {
  if (next.length !== 2 || !next[0] || !next[1]) return;
  ids = next;
  const qs = new URLSearchParams(location.search); qs.set('date', st.date); qs.set('min', String(st.min)); qs.set('cam', st.mode === 'win' ? 'window' : 'inside');
  if (!silent || location.hash !== `#pair/${ids.map(encodeURIComponent).join(',')}`) history.replaceState(history.state, '', `${location.pathname}?${qs}#pair/${ids.map(encodeURIComponent).join(',')}`);
  const my = ++token;
  syncChrome();
  await Promise.all(SIDES.map((k, i) => buildSide(k, ids[i], my)));
  if (my !== token) return;
  applyMode(); refreshDay(); refreshTime(); syncChrome(); layout();
  $('prSub').textContent = `${sides.a.title} and ${sides.b.title}, ${sides.a.hasWindow && sides.b.hasWindow ? 'the same date, time and camera' : 'where each has a window in open air'}.`;
}

// ------------------------------------------------------------------ one pane: load and build (Unit 3D's own steps, for one window)
async function loadPlan(id) {
  let plan = null, layout = null;
  let scenario = null; try { scenario = getPlanScenario(id, { base: S.base }); } catch { scenario = null; }
  let pref = null; try { pref = localStorage.getItem('as:unit-scenario-use:' + id); } catch { pref = null; }
  if (scenario && pref !== '0') { try { plan = normalisePlan(scenario.plan); layout = scenario.layout; } catch { plan = null; } }
  if (!plan && (S.manifest.plans || []).includes(id)) {
    try { plan = normalisePlan(await loadJSON(`${S.base}/plans/${id}.json`, null)); const L0 = plan.layouts[0]; layout = L0 ? { items: L0.items } : null; } catch { plan = null; }
  }
  return { plan, layout };
}

async function buildSide(k, id, my) {
  const old = sides[k];
  if (old) { try { old.stage.dispose(); old.stage.renderer.dispose(); old.stage.renderer.forceContextLoss?.(); } catch { /* already gone */ } sides[k] = null; replaceCanvas(k); }
  $(`prLoad-${k}`).hidden = false; $(`prLoad-${k}`).textContent = 'Building the scene…';
  const site = await loadJSON(`${S.base}/sites/${id}.json`, null);
  if (my !== token) return;
  if (!site?.b?.length) { $(`prLoad-${k}`).textContent = 'This site model could not be read.'; sides[k] = { id, failed: true, title: id, stage: { resize() {}, frame: () => false } }; return; }
  const { plan, layout } = await loadPlan(id);
  const B = prepBuildings(site.b, site.holes && typeof site.holes === 'object' ? site.holes : null, effectiveComponents(site)), T = B[site.target] || B[0];
  const FACES = canonicalFaces(facesOf(T, 8, B), site.faces, site.version);
  const FUT = (Array.isArray(site.future) ? site.future : []).filter((f) => f && Array.isArray(f.ring) && f.ring.length >= 3 && +f.h > 0);
  const FUTB = FUT.length ? prepBuildings(FUT.map((f) => [+f.h, 0, 1, f.ring.flat()])) : [], BF = FUT.length ? B.concat(FUTB) : null;
  const L = byId(id) || site.listing || {}, w = site.window || {};
  const open = FACES.map((f, i) => [f, i]).filter(([f]) => !f.shared);
  const near = (brg) => open.reduce((best, cur) => { const d = Math.abs(angDiff(cur[0].bearing, brg)), bd = Math.abs(angDiff(best[0].bearing, brg)); return d < bd - 0.5 || (Math.abs(d - bd) <= 0.5 && cur[0].length > best[0].length) ? cur : best; }, open[0]);
  let fi = FACES.findIndex((f) => f.i === w.face);
  if (fi >= 0 && FACES[fi].shared) fi = open.length ? near(FACES[fi].bearing)[1] : -1;
  if (fi < 0 && open.length) { const exp = (L.exposure || []).map(dirBearing).filter((x) => x != null); fi = exp.length ? near(exp[0])[1] : open.reduce((b, c) => (c[0].length > b[0].length ? c : b), open[0])[1]; }
  const geo = geoFromSite(site, T.g);
  const s = { id, site, plan, B, T, FACES, FUT, BF, face: fi, t: 0.5, az: FACES[fi]?.bearing ?? 0, bay: Array.isArray(w.panes) && w.panes.length > 1, cal: undefined, floor: 10 };
  if (fi >= 0) s.t = snapPosition(FACES[fi], w.t ?? 0.5, snapOpen) ?? 0.5;
  let CAL = resolveCal(geo, measuredFromSite(site));
  s.floor = Math.max(1, Math.min(CAL.maxFloor(T.top), Math.round(w.floor || L.floor || CAL.maxFloor(T.top) / 2)));
  const pin = getPin(id, { base: S.base }), pf = pin ? FACES.findIndex((f) => f.i === pin.face && !f.shared) : -1;   // the window pinned for the Floor plan studio
  if (pf >= 0) { Object.assign(s, { face: pf, t: snapPosition(FACES[pf], pin.t, snapOpen) ?? pin.t, az: pin.az, bay: pin.bay, cal: pin.cal }); CAL = resolveCal(geo, s.cal !== undefined ? s.cal : measuredFromSite(site)); s.floor = Math.max(1, Math.min(CAL.maxFloor(T.top), pin.floor)); }
  s.CAL = CAL;
  s.title = byId(id) ? label(byId(id)) : site.listing?.building || id;
  s.short = (byId(id)?.unit ? String(byId(id).unit) : '') || s.title.split(' ').slice(-1)[0];
  s.panes = s.bay ? (Array.isArray(w.panes) && w.panes.length > 1 ? w.panes.map(Number) : BAY) : null;
  // a window must be in open air to give sun numbers at all
  const f = FACES[s.face], pos = f && !f.shared ? winPos(s) : null;
  if (pos) { const z = CAL.slabAt(s.floor), r = windowOpenAir(B, B.indexOf(T), pos.fx, pos.fy, s.az, z + 0.6, z + 2.2); s.hasWindow = r.ok; } else s.hasWindow = false;
  // the stage
  const stage = s.stage = new UnitStage($(`prGl-${k}`), $(`prStage-${k}`), $(`prLab-${k}`));
  stage.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));   // two scenes share the GPU: a lower ceiling keeps both smooth
  stage.opts.streets = true; stage.opts.future = true;
  await new Promise((r) => requestAnimationFrame(r));
  if (my !== token) { stage.dispose(); return; }
  stage.build({ B, T, ti: B.indexOf(T), meta: site.bmeta, streets: Array.isArray(site.streets) ? site.streets : [], future: FUT, green: site.green || null, water: site.water || null, lm: [], ownLabel: site.listing?.building || L.building || 'This building' });
  stage.opts.labels = false; stage.applyOpts(); stage.setFloorH(CAL.fh);
  stage.sunL.shadow.mapSize.set(2048, 2048);   // before the first frame: half the shadow memory of Unit 3D's 4096
  if (s.hasWindow) {
    stage.setWindow(pos, s.az, CAL.slabAt(s.floor), CAL.slabAt(s.floor), CAL.fh, `Floor ${s.floor} · ${compass(s.az)}${s.bay ? ' · bay' : ''}`, s.panes || [0]);
    s.prof = horizonProfile(B, pos.x, pos.y, pos.z); s.profF = BF ? horizonProfile(BF, pos.x, pos.y, pos.z) : null;
    // the apartment and its furniture
    const model = plan || genericPlan(), items = (layout?.items?.length ? layout.items : []).map((x) => resolveItem(x)).filter(Boolean);
    const interior = buildInterior(model, { generic: !plan });
    if (plan && layout?.items?.length) { const F = buildFurniture(layout.items, plan, interior.frame); interior.group.add(F.group); interior.furniture = F; }
    stage.setInterior(interior);
    s.views = insideViews(model, items, interior.frame);
    s.seat = s.views.find((v) => v.kind === 'seat' && /sofa|loveseat|armchair/i.test(`${v.label} ${v.key}`)) || s.views.find((v) => v.kind === 'seat') || s.views.find((v) => v.kind === 'room') || s.views[0] || null;
  }
  stage.resize();
  sides[k] = s;
  $(`prLoad-${k}`).hidden = true;
}
function replaceCanvas(k) {   // a lost WebGL context cannot be reused: a fresh canvas for the next scene
  const old = $(`prGl-${k}`), c = old.cloneNode(false); c.id = old.id; old.replaceWith(c); wireLook(k);
}

// ------------------------------------------------------------------ geometry and sun (Unit 3D's formulas)
const slabZ = (s, floor = s.floor) => s.CAL.slabAt(floor);
function winPos(s) {
  const f = s.FACES[s.face]; if (!f) return null;
  const x = f.a[0] + (f.b[0] - f.a[0]) * s.t, y = f.a[1] + (f.b[1] - f.a[1]) * s.t, nx = Math.sin(f.bearing * DEG), ny = Math.cos(f.bearing * DEG);
  return { x: x + nx * 0.4, y: y + ny * 0.4, z: slabZ(s) + 1.6, fx: x, fy: y };
}
const sunAt = (s, min) => { const [y, m, d] = ymd(st.date); return sunPos(zonedMs(y, m - 1, d, min, tz(s)), s.site.origin.lat, s.site.origin.lon); };
const blockers = (s) => (s.BF || s.B);

function applyMode() {
  for (const k of SIDES) {
    const s = sides[k]; if (!s || s.failed || !s.hasWindow) continue;
    const g = s.stage; g.setMode(st.mode);
    if (st.mode === 'in' && s.seat) { g.setInteriorView(s.seat, { animate: false }); g.look.yaw = 0; g.look.pitch = s.seat.pitch + 6; g.look.fov = s.seat.fov; }
    else Object.assign(g.look, { yaw: 0, pitch: 6, fov: 70 });
    g.dirty = true;
  }
  syncChrome();
}
function setMode(m) { if (m !== 'in' && m !== 'win') return; st.mode = m; applyMode(); refreshTime(); syncUrl(); }

/** Once per date or window: the day's direct-sun hours, the strip and the segments. */
function refreshDay() {
  const [y, m, d] = ymd(st.date);
  for (const k of SIDES) {
    const s = sides[k]; if (!s || s.failed) continue;
    if (!s.hasWindow) { s.day = null; continue; }
    const o = s.site.origin, P = s.panes, prof = s.profF && s.stage.opts.future ? s.profF : s.prof;
    s.day = litInfo(table(y, m - 1, d, o.lat, o.lon, tz(s), 6), prof, s.az, 6, P);
    s.states = dayStates(y, m - 1, d, o.lat, o.lon, tz(s), prof, s.az, STRIP_FROM, STRIP_TO, STRIP_STEP, P);
  }
}
/** Every time change: the sun, its ray, the readouts. */
function refreshTime() {
  for (const k of SIDES) {
    const s = sides[k]; if (!s || s.failed) continue;
    if (!s.hasWindow) { readout(k, null); continue; }
    const sun = sunAt(s, st.min), up = sun.alt > 0, P = s.panes, front = inFront(sun.az, s.az, P), w = winPos(s);
    const hit = up && front ? rayBlock(blockers(s), w.x, w.y, w.z, sun.az, sun.alt) : null;
    const lit = up && front && !hit, side = lit && P && Math.abs(angDiff(sun.az, s.az)) >= 90;
    const state = !up ? 'night' : !front ? 'behind' : lit ? (side ? 'side' : 'lit') : 'shade';
    s.state = state; s.sun = sun;
    s.stage.setSun(sun); s.stage.setRay(state === 'side' ? 'lit' : state, hit);
    readout(k, { sun, state });
  }
  syncChrome();
}
const STATE_TXT = { night: ['Night', 'shade'], behind: ['Sun behind the window', 'shade'], lit: ['Direct sun on the window', 'lit'], side: ['Sun through a side pane', 'lit'], shade: ['Window in shadow', 'shade'] };
function readout(k, now) {
  const s = sides[k], el = $(`prRead-${k}`), hud = $(`prHud-${k}`);
  if (!s || s.failed) { el.innerHTML = '<p class="u-note">This site model could not be read.</p>'; return; }
  const head = `<h3>${esc(s.title)} <span>floor ${s.floor} · faces ${Math.round(s.az)}° ${compass(s.az)}${s.bay ? ' · bay' : ''}</span></h3>`;
  if (!s.hasWindow) { el.innerHTML = `${head}<p class="u-note warn" role="alert">This window is not in open air, so no sun or sky numbers are given for it.</p>`; hud.textContent = 'Window unresolved'; return; }
  const day = s.day, segs = day?.segs?.length ? day.segs.map((q) => `${fmtT(q[0])} to ${fmtT(Math.min(q[1], 1439))}`).join(', ') : 'no direct sun on this date';
  const [tag, cls] = STATE_TXT[now.state];
  el.innerHTML = `${head}
    <div class="pr-sun"><b class="pr-hours" data-hours="${Math.round(day?.min || 0)}">${day?.min ? hm(day.min) : '0 h'}</b><span>of direct sun on this date<small>${esc(segs)}</small></span></div>
    <div class="pr-strip" role="img" aria-label="Sun through the day: ${esc(segs)}">${stripBar(s.states)}<div class="pr-cur" style="left:${((st.min - STRIP_FROM) / (STRIP_TO - STRIP_FROM)) * 100}%"><i></i></div></div>
    <div class="pr-now ${cls}">${tag}<small> · ${fmtT(st.min)} · sun ${Math.round(now.sun.az)}° ${compass(now.sun.az)}, ${now.sun.alt > 0 ? Math.round(now.sun.alt) + '° up' : 'below the horizon'}</small></div>`;
  hud.innerHTML = `<span class="${cls}">${tag}</span><span>${esc(s.short)} · floor ${s.floor}</span>`;
}

function setTime(m) { st.min = clampMin(m); refreshTime(); syncUrlSoon(); }
function dateChanged() { refreshDay(); refreshTime(); syncUrl(); }
function togglePlay() {
  st.playing = !st.playing; lastT = 0;
  const b = $('prPlay'); b.classList.toggle('primary', st.playing); b.setAttribute('aria-pressed', String(st.playing)); b.textContent = st.playing ? 'Pause' : 'Play day';
}
let urlT = 0;
function syncUrlSoon() { clearTimeout(urlT); urlT = setTimeout(syncUrl, 400); }
function syncUrl() {
  const qs = new URLSearchParams(location.search); qs.set('date', st.date); qs.set('min', String(st.min)); qs.set('cam', st.mode === 'win' ? 'window' : 'inside');
  try { history.replaceState(history.state, '', `${location.pathname}?${qs}${location.hash}`); } catch { /* a sandboxed frame */ }
}

// ------------------------------------------------------------------ looking around
function wireLook(k) {
  const cv = $(`prGl-${k}`); if (!cv) return;
  let down = null;
  cv.addEventListener('pointerdown', (e) => { const s = sides[k]; if (!s?.hasWindow) return; down = { x: e.clientX, y: e.clientY, yaw: s.stage.look.yaw, pitch: s.stage.look.pitch }; cv.setPointerCapture(e.pointerId); });
  cv.addEventListener('pointermove', (e) => {
    const s = sides[k]; if (!down || !s?.hasWindow || !(e.buttons & 1)) return;
    const f = 70 / (cv.clientHeight || 500) * (s.stage.look.fov / 70), L = s.stage.look;
    L.yaw = down.yaw - (e.clientX - down.x) * f; L.pitch = Math.max(-30, Math.min(75, down.pitch + (e.clientY - down.y) * f)); s.stage.dirty = true;
  });
  cv.addEventListener('pointerup', () => { down = null; });
  cv.addEventListener('wheel', (e) => { const s = sides[k]; if (!s?.hasWindow) return; e.preventDefault(); const L = s.stage.look; L.fov = Math.max(35, Math.min(110, L.fov + Math.sign(e.deltaY) * 4)); s.stage.dirty = true; }, { passive: false });
}

// ------------------------------------------------------------------ the loop: one rAF for both panes, only a pane on screen draws
function frame(t) {
  requestAnimationFrame(frame);
  if ($('view-pair').hidden) return;
  if (st.playing) {
    const dt = lastT ? Math.min(100, t - lastT) : 16; lastT = t;
    st.min += dt * 0.09; if (st.min >= STRIP_TO - STRIP_STEP) st.min = STRIP_FROM;
    refreshTime();
  }
  for (const k of SIDES) {
    const s = sides[k]; if (!s || s.failed || !s.stage.scene) continue;
    if (isPhone() && st.shown !== k) continue;
    s.stage.frame();
  }
}
