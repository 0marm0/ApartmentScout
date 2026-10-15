// The scenario comparison board: 2-4 scenarios of one window rendered side by side from one fixed camera with identical
// assumptions except the fields that differ, the deltas against the first scenario, one PNG and a JSON receipt.
// The numbers come from compare-core.js. The pictures come from a second, private UnitStage (its own WebGL context and
// scene) so the live Unit 3D view, its camera and its state are never touched. Geometry that differs between scenarios
// (source vs assumed building parts) gets its own build of that stage; sun, window height, facade and proposed
// buildings are set per panel on the same build.
import * as THREE from 'three';
import { UnitStage } from './scene.js';
import { esc, css, toast } from '../util.js';
import { download } from '../app.js';
import { sunPos, zonedMs, compass } from '../sun.js';
import { windowPoint } from './openair.js';
import { resolveCal } from './calibration.js';
import { MIN_SCENARIOS, MAX_SCENARIOS, normaliseSpec, presetSpecs, evaluateAll, deltaRows, sharedAssumptions, buildReceipt, autoLabel, changedFields, FIELDS } from './compare-core.js';

const W3 = (x, y, z = 0) => new THREE.Vector3(x, z, -y);
const DEG = Math.PI / 180;
const PRESETS = [['seasons2', 'Winter vs summer'], ['seasons4', 'Four seasons'], ['floors', 'Floors'], ['facades', 'Facades'], ['proposed', 'Proposed buildings'], ['parts', 'Building parts']];
const STORE = 'as:compare-specs:';
const last = new Map();   // site id -> {specs, results, receipt}: the latest board, for the project export
const hm = (min) => { if (!min) return 'none'; const h = Math.floor(min / 60), m = Math.round(min % 60); return h && m ? `${h} h ${String(m).padStart(2, '0')}` : h ? `${h} h` : `${m} m`; };
const sgn = (v, f = (x) => x) => (v > 0 ? '+' : v < 0 ? '−' : '±') + f(Math.abs(v));
const timeVal = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export const savedScenarios = (id) => { try { const v = JSON.parse(localStorage.getItem(STORE + id) || '[]'); return Array.isArray(v) ? v.slice(0, MAX_SCENARIOS) : []; } catch { return []; } };
const saveScenarios = (id, specs) => { try { localStorage.setItem(STORE + id, JSON.stringify(specs.slice(0, MAX_SCENARIOS))); } catch { /* storage unavailable */ } };
export const lastComparison = (id) => last.get(id)?.receipt ?? null;

/**
 * Open the board. ctx (from unit3d.js compareContext()): {id, site, title, faces, Bsource, Bassumed, FUT, FUTB, ti, geo, measured,
 * panes, lat, lon, tz, fraction, maxFloor, base, streets, green, ownLabel, liveStage}.
 */
export function openCompareBoard(ctx) {
  document.getElementById('cbDialog')?.remove();
  const env = { site: ctx.site, faces: ctx.faces, B: { source: ctx.Bsource, assumed: ctx.Bassumed }, FUTB: ctx.FUTB, ti: ctx.ti, geo: ctx.geo, baseCal: ctx.measured, panes: ctx.panes, lat: ctx.lat, lon: ctx.lon, tz: ctx.tz, fraction: ctx.fraction, maxFloor: ctx.maxFloor };
  const base = { ...ctx.base };
  const dlg = document.createElement('dialog');
  dlg.id = 'cbDialog'; dlg.className = 'cb'; dlg.setAttribute('aria-labelledby', 'cbTitle');
  const hasFut = ctx.FUT.length > 0, hasParts = !!ctx.Bassumed, hasCal = !!ctx.measured;
  const openFaces = ctx.faces.map((f, i) => [f, i]).filter(([f]) => !f.shared);
  const enabled = { seasons2: 1, seasons4: 1, floors: 1, facades: openFaces.length > 1, proposed: hasFut, parts: hasParts };
  dlg.innerHTML = `<div class="cb-in">
    <header class="cb-h"><div><h2 id="cbTitle">Compare scenarios</h2><p class="cb-sub">${esc(ctx.title)} · one camera, identical assumptions except what you change</p></div><button type="button" class="icon-btn" id="cbX" aria-label="Close the comparison">×</button></header>
    <div class="cb-ctl">
      <div class="cb-presets" role="group" aria-label="Start from a comparison">${PRESETS.map(([k, t]) => `<button type="button" class="btn sm" data-preset="${k}"${enabled[k] ? '' : ` disabled title="${k === 'proposed' ? 'This site has no proposed buildings' : k === 'parts' ? 'Assume building parts first (Model ▸ Building parts)' : 'Needs more than one open facade'}"`}>${t}</button>`).join('')}</div>
      <div class="field cb-cam"><label for="cbCam">Camera</label><select id="cbCam"><option value="current">The orbit view you have now</option><option value="default">Three-quarter view of the window</option><option value="window">From each scenario’s window (same bearing, tilt, lens)</option></select></div>
    </div>
    <ol class="cb-rows" id="cbRows"></ol>
    <div class="cb-acts"><button type="button" class="btn sm" id="cbAdd">Add a scenario</button><span class="cb-msg" id="cbMsg" role="status" aria-live="polite"></span></div>
    <div class="cb-board"><canvas id="cbCv" role="img" aria-label="Scenarios side by side"></canvas><div class="cb-busy" id="cbBusy" hidden><span class="skeleton"></span>Rendering the scenarios…</div></div>
    <div class="cb-tablewrap" tabindex="0" role="region" aria-label="Metrics by scenario"><table class="mini cb-table" id="cbTable"></table></div>
    <p class="u-note" id="cbShared"></p>
    <footer class="cb-f"><button type="button" class="btn primary" id="cbPng">Export PNG</button><button type="button" class="btn" id="cbJson">Export receipt (JSON)</button><button type="button" class="btn ghost" id="cbClose">Close</button></footer>
    <div class="cb-hide" id="cbStageHost" aria-hidden="true"><canvas id="cbGl"></canvas><div id="cbLab"></div></div></div>`;
  document.body.appendChild(dlg);
  const $ = (id) => dlg.querySelector('#' + id);

  // ---------------------------------------------------------------- scenario rows
  let specs = [], results = [], token = 0, stages = new Map(), disposed = false;
  const rowSpec = (s) => ({ label: s.label || '', date: s.date ?? base.date, min: s.min ?? base.min, floor: s.floor ?? base.floor, face: s.face ?? base.face, t: s.t ?? base.t, future: s.future ?? base.future, parts: s.parts ?? base.parts, cal: s.cal });
  const clean = (arr) => arr.map((s) => normaliseSpec(rowSpec(s), env)).filter(Boolean);
  function rowsHTML() {
    return specs.map((s, i) => {
      const id = `cb${i}`, f = (k) => `${id}-${k}`;
      return `<li class="cb-row" data-i="${i}"><div class="cb-n" aria-hidden="true">${i + 1}</div>
        <div class="field cb-f-label"><label for="${f('label')}">Name</label><input type="text" id="${f('label')}" data-k="label" maxlength="60" value="${esc(s.label || '')}" placeholder="${esc(autoLabel(base, s, env))}"></div>
        <div class="field"><label for="${f('date')}">Date</label><input type="date" id="${f('date')}" data-k="date" value="${esc(s.date)}"></div>
        <div class="field"><label for="${f('min')}">Time</label><input type="time" id="${f('min')}" data-k="min" value="${timeVal(s.min)}"></div>
        <div class="field"><label for="${f('floor')}">Floor</label><input type="number" id="${f('floor')}" data-k="floor" min="1" max="${env.maxFloor}" step="1" value="${s.floor}"></div>
        <div class="field cb-f-face"><label for="${f('face')}">Facade</label><select id="${f('face')}" data-k="face">${openFaces.map(([fc, fi]) => `<option value="${fi}"${fi === s.face ? ' selected' : ''}>${compass(fc.bearing)} ${Math.round(fc.bearing)}° · ${Math.round(fc.length)} m</option>`).join('')}</select></div>
        ${hasFut ? `<div class="field"><label for="${f('future')}">Proposed</label><select id="${f('future')}" data-k="future"><option value="0"${s.future ? '' : ' selected'}>Not built</option><option value="1"${s.future ? ' selected' : ''}>Built</option></select></div>` : ''}
        ${hasParts ? `<div class="field"><label for="${f('parts')}">Building parts</label><select id="${f('parts')}" data-k="parts"><option value="source"${s.parts === 'source' ? ' selected' : ''}>Source</option><option value="assumed"${s.parts === 'assumed' ? ' selected' : ''}>Assumed</option></select></div>` : ''}
        ${hasCal ? `<div class="field"><label for="${f('cal')}">Height</label><select id="${f('cal')}" data-k="cal"><option value="base"${s.cal === undefined ? ' selected' : ''}>Measured</option><option value="count"${s.cal === null ? ' selected' : ''}>Floor count</option></select></div>` : ''}
        <button type="button" class="icon-btn cb-del" data-del="${i}" aria-label="Remove scenario ${i + 1}"${specs.length <= MIN_SCENARIOS ? ' disabled' : ''}>×</button></li>`;
    }).join('');
  }
  function drawRows() { $('cbRows').innerHTML = rowsHTML(); $('cbAdd').disabled = specs.length >= MAX_SCENARIOS; }
  function setSpecs(arr, keepRows = false) {
    specs = clean(arr).slice(0, MAX_SCENARIOS);
    if (specs.length < MIN_SCENARIOS) specs = clean([{}, { date: base.date.slice(0, 4) + '-12-21' }]);
    if (!keepRows) drawRows();
    saveScenarios(ctx.id, specs); schedule();
  }
  $('cbRows').addEventListener('input', onRow); $('cbRows').addEventListener('change', onRow);
  function onRow(e) {
    const el = e.target.closest('[data-k]'); if (!el) return;
    const i = +el.closest('.cb-row').dataset.i, k = el.dataset.k, s = { ...specs[i] };
    if (k === 'label') s.label = el.value;
    else if (k === 'date') s.date = el.value;
    else if (k === 'min') { const [h, m] = el.value.split(':').map(Number); s.min = h * 60 + m; }
    else if (k === 'floor') s.floor = Math.round(+el.value);
    else if (k === 'face') s.face = +el.value;
    else if (k === 'future') s.future = el.value === '1';
    else if (k === 'parts') s.parts = el.value;
    else if (k === 'cal') s.cal = el.value === 'count' ? null : undefined;
    const ok = normaliseSpec(rowSpec(s), env);
    if (!ok) { say(k === 'label' ? '' : 'That value is not valid for this site, so the scenario keeps its last good value.'); return; }
    say(''); specs[i] = ok;
    if (k !== 'label') { const ph = el.closest('.cb-row').querySelector('[data-k=label]'); ph.placeholder = autoLabel(base, ok, env); }
    saveScenarios(ctx.id, specs); schedule();
  }
  $('cbRows').addEventListener('click', (e) => { const d = e.target.closest('[data-del]'); if (d && specs.length > MIN_SCENARIOS) { specs.splice(+d.dataset.del, 1); drawRows(); saveScenarios(ctx.id, specs); schedule(); } });
  $('cbAdd').addEventListener('click', () => { if (specs.length >= MAX_SCENARIOS) return; specs.push(normaliseSpec(rowSpec({}), env)); drawRows(); saveScenarios(ctx.id, specs); schedule(); dlg.querySelector(`[data-i="${specs.length - 1}"] input`)?.focus(); });
  dlg.querySelector('.cb-presets').addEventListener('click', (e) => { const b = e.target.closest('[data-preset]'); if (!b || b.disabled) return; setSpecs(presetSpecs(b.dataset.preset, base, env)); dlg.querySelectorAll('[data-preset]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); });
  $('cbCam').addEventListener('change', schedule);
  const say = (m) => { $('cbMsg').textContent = m; };

  // ---------------------------------------------------------------- private stage
  function stageFor(parts) {
    const key = parts === 'assumed' && env.B.assumed ? 'assumed' : 'source';
    if (stages.has(key)) return stages.get(key);
    const B = env.B[key], T = B[env.ti], host = $('cbStageHost'), cv = $('cbGl');
    if (!stages.size) {
      host.style.cssText = 'position:absolute;left:-10000px;top:0;width:1000px;height:700px;pointer-events:none;overflow:hidden';
    }
    const stage = stages.size ? new UnitStage(Object.assign(document.createElement('canvas'), {}), host, $('cbLab')) : new UnitStage(cv, host, $('cbLab'));
    if (stages.size) host.appendChild(stage.cv);
    stage.opts.streets = true;
    stage.build({ B, T, ti: env.ti, streets: Array.isArray(ctx.site.streets) ? ctx.site.streets : [], future: ctx.FUT, green: ctx.site.green || null, lm: [], ownLabel: ctx.ownLabel });
    stage.opts.labels = false; stage.setFloorH(env.geo.fhEst);
    stage.resize(); stages.set(key, stage); return stage;
  }
  const disposeStages = () => { for (const s of stages.values()) { try { s.dispose(); s.renderer.dispose(); s.renderer.forceContextLoss?.(); } catch { /* already gone */ } } stages = new Map(); };

  function cameraFor(stage, mode, w0, az0) {
    const cam = stage.orbitCam;
    if (mode === 'current' && ctx.liveStage?.orbitCam) {
      cam.position.copy(ctx.liveStage.orbitCam.position); cam.fov = ctx.liveStage.orbitCam.fov;
      const tgt = ctx.liveStage.controls?.target || W3(w0.x, w0.y, w0.z); cam.lookAt(tgt);
    } else {
      const b = (az0 + 40) * DEG, Dh = 150, Hh = 45;
      cam.position.copy(W3(w0.fx + Math.sin(b) * Dh, w0.fy + Math.cos(b) * Dh, w0.z + Hh)); cam.fov = 40; cam.lookAt(W3(w0.fx, w0.fy, w0.z));
    }
    cam.near = 1; cam.updateProjectionMatrix(); return cam;
  }

  // ---------------------------------------------------------------- the board
  const W = 1200, PAD = 24, GAP = 14;
  let timer = 0;
  function schedule() { clearTimeout(timer); $('cbBusy').hidden = false; timer = setTimeout(() => render(), 120); }
  async function render() {
    const tok = ++token;
    const rs = evaluateAll(base, specs, env);
    results = rs;
    tableHTML(rs);
    await new Promise((r) => requestAnimationFrame(r));
    if (disposed || tok !== token) return;
    try { await paint(rs, tok); } catch (e) { say(`The pictures could not be drawn: ${e.message || e}`); }
    if (disposed || tok !== token) return;
    $('cbBusy').hidden = true;
    const camera = { kind: $('cbCam').value, yaw: 0, pitch: 6, fov: 70 };
    const receipt = buildReceipt({ siteId: ctx.id, site: ctx.site, base, results: rs, env, camera, assumedParts: ctx.assumedParts });
    last.set(ctx.id, { specs: specs.map((s) => ({ ...s })), results: rs, receipt });
    dlg.dataset.ready = '1';
  }
  function tableHTML(rs) {
    const rows = deltaRows(rs, { hideSame: true });
    $('cbTable').innerHTML = `<caption class="sr">Metrics by scenario with the change from scenario 1</caption><thead><tr><th scope="col">Metric</th>${rs.map((r, i) => `<th scope="col" class="num">${i + 1}. ${esc(r.label)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr><th scope="row">${esc(row.label)}</th>${row.cells.map((c) => c.withheld ? '<td class="num cb-w">withheld</td>' : `<td class="num">${row.key === 'day_min' ? hm(c.value) : c.value}${row.key === 'sky_view' ? '%' : row.key === 'daylight_factor_pct' ? '%' : row.unit === 'h' ? ' h' : row.unit === '°' ? '°' : ''}${c.delta == null ? '' : `<small class="${c.delta > 0 ? 'u-up' : c.delta < 0 ? 'u-down' : ''}">${sgn(c.delta, (v) => (row.key === 'day_min' ? hm(v) : row.key === 'sky_view' ? v + ' pts' : String(v)))}</small>`}</td>`).join('')}</tr>`).join('')}</tbody>`;
    const shared = sharedAssumptions(base, rs, env);
    const NAMES = { date: 'date', min: 'time', floor: 'floor', face: 'facade', t: 'position', az: 'facing', bay: 'window type', future: 'proposed buildings', parts: 'building parts', cal: 'height' };
    const different = [...new Set(rs.flatMap((r) => r.changes))].map((k) => NAMES[k] || k).join(', ') || 'nothing yet';
    $('cbShared').innerHTML = `<b>Identical in every scenario:</b> ${shared.map(([k, v]) => `${esc(k)} ${esc(v)}`).join(' · ')}. <b>Different:</b> ${esc(different)}. Direct sun on a clear day; sky view is a relative overcast model, not lux.${rows.hidden?.length ? ` Not shown because they do not change: ${esc(rows.hidden.join(', ').toLowerCase())}.` : ''}`;
    const withheld = rs.filter((r) => r.metrics.withheld);
    say(withheld.length ? `${withheld.map((r) => r.label).join(', ')}: window not in open air, so no sun or sky numbers are given.` : '');
  }
  async function paint(rs, tok) {
    const n = rs.length, cols = n <= 2 ? n : 2, rowsN = Math.ceil(n / cols), pw = (W - PAD * 2 - GAP * (cols - 1)) / cols, ph = Math.round(pw * 0.62), head = 78, foot = 30;
    const tableRows = deltaRows(rs, { hideSame: true }), th = 28 + tableRows.length * 24 + 12;
    const H = head + rowsN * (ph + GAP) + th + foot + 20;
    const cv = $('cbCv'); cv.width = W; cv.height = H; const g = cv.getContext('2d');
    const ink = css('--ink'), ink2 = css('--ink-2'), ink3 = css('--ink-3'), surf = css('--surface-1'), line = css('--line-strong'), sun = css('--sun'), good = css('--good'), bad = css('--bad'), bg = css('--overlay') || 'rgba(14,16,21,.8)';
    const sans = css('--font-sans') || 'sans-serif', mono = css('--font-mono') || 'monospace';
    g.fillStyle = surf; g.fillRect(0, 0, W, H);
    g.fillStyle = ink; g.font = `600 22px ${sans}`; g.textBaseline = 'alphabetic'; g.textAlign = 'left';
    g.fillText(`Scenario comparison · ${ctx.title}`, PAD, 36);
    g.fillStyle = ink2; g.font = `500 13px ${sans}`;
    const varied = [...new Set(rs.flatMap((r) => r.changes))];
    g.fillText(`${n} scenarios, ${$('cbCam').selectedOptions[0].textContent.toLowerCase()}. Different: ${varied.join(', ') || 'nothing yet'}. Everything else identical.`, PAD, 58);
    const camMode = $('cbCam').value, st0 = rs.find((r) => !r.metrics.withheld)?.state || base;
    let fixed = null;
    for (let i = 0; i < n; i++) {
      if (disposed || tok !== token) return;
      const r = rs[i], c = i % cols, row = Math.floor(i / cols), x = PAD + c * (pw + GAP), y = head + row * (ph + GAP), s = r.state, m = r.metrics;
      g.fillStyle = css('--surface-3'); g.fillRect(x, y, pw, ph);
      if (!m.withheld) {
        const stage = stageFor(s.parts), cal = resolveCal(env.geo, s.cal === undefined ? env.baseCal : s.cal), slab = cal.slabAt(s.floor), face = env.faces[s.face], w = windowPoint(face, s.t, slab);
        stage.opts.future = !!s.future; stage.applyOpts(); stage.setFloorH(cal.fh);
        const [yy, mm, dd] = s.date.split('-').map(Number);
        stage.setSun(sunPos(zonedMs(yy, mm - 1, dd, s.min, env.tz), env.lat, env.lon));
        stage.setWindow(w, s.az, slab, slab, cal.fh, '', s.bay ? env.panes : [0]);
        let cam;
        if (camMode === 'window') cam = stage.lookCam(w, s.az, 6, 70);
        else { const b0 = rs[0].state; if (!fixed) { const f0 = env.faces[b0.face], p0 = windowPoint(f0, b0.t, resolveCal(env.geo, b0.cal === undefined ? env.baseCal : b0.cal).slabAt(b0.floor)); fixed = { w: p0, az: b0.az }; } cam = cameraFor(stage, camMode, fixed.w, fixed.az); }
        stage.beginStills(true);
        stage.drawStill(cam, g, x, y, pw, ph);
        stage.endStills();
      } else {
        g.fillStyle = ink3; g.font = `600 14px ${sans}`; g.textAlign = 'center'; g.fillText('Window not in open air', x + pw / 2, y + ph / 2 - 4); g.font = `500 12px ${sans}`; g.fillText('No sun or sky numbers are given.', x + pw / 2, y + ph / 2 + 16); g.textAlign = 'left';
      }
      // caption chips
      chip(g, x + 10, y + 10, `${i + 1}. ${r.label}`, { bg: i === 0 ? sun : bg, fg: i === 0 ? '#1b1200' : ink, line, font: sans, size: 13 });
      if (!m.withheld) {
        const d = i ? m.day_min - rs[0].metrics.day_min : 0;
        chip(g, x + 10, y + ph - 34, `☀ ${hm(m.day_min)}${i && !rs[0].metrics.withheld ? `  ${sgn(d, hm)}` : ''}  ·  sky ${Math.round(m.sky_view * 100)}%`, { bg, fg: ink, line, font: sans, size: 12 });
      }
    }
    // table
    const ty = head + rowsN * (ph + GAP) + 6;
    g.fillStyle = ink3; g.font = `600 11px ${sans}`; g.textAlign = 'left'; g.fillText('METRIC', PAD, ty + 14);
    const cw = (W - PAD * 2 - 230) / n;
    rs.forEach((r, i) => { g.textAlign = 'right'; g.fillText(`${i + 1}. ${clip(r.label, 26)}`.toUpperCase(), PAD + 230 + (i + 1) * cw - 8, ty + 14); });
    tableRows.forEach((row, k) => {
      const yy = ty + 38 + k * 24;
      g.strokeStyle = line; g.beginPath(); g.moveTo(PAD, yy - 17.5); g.lineTo(W - PAD, yy - 17.5); g.stroke();
      g.textAlign = 'left'; g.fillStyle = ink2; g.font = `500 13px ${sans}`; g.fillText(row.label, PAD, yy);
      row.cells.forEach((c, i) => {
        g.textAlign = 'right'; const xr = PAD + 230 + (i + 1) * cw - 8;
        if (c.withheld) { g.fillStyle = ink3; g.font = `500 12px ${sans}`; g.fillText('withheld', xr, yy); return; }
        const txt = (row.key === 'day_min' ? hm(c.value) : row.key === 'sky_view' || row.key === 'daylight_factor_pct' ? `${c.value}%` : row.unit === 'h' ? `${c.value} h` : row.unit === '°' ? `${c.value}°` : String(c.value));
        const dl = c.delta == null ? '' : sgn(c.delta, (v) => (row.key === 'day_min' ? hm(v) : row.key === 'sky_view' ? `${v} pts` : String(v)));
        g.font = `600 13px ${mono}`;
        if (dl) { g.fillStyle = c.delta > 0 ? good : c.delta < 0 ? bad : ink3; g.fillText(dl, xr, yy); g.fillStyle = ink; g.fillText(txt, xr - g.measureText(dl).width - 12, yy); } else { g.fillStyle = ink; g.fillText(txt, xr, yy); }
      });
    });
    g.textAlign = 'left'; g.fillStyle = ink3; g.font = `500 11.5px ${sans}`;
    g.fillText(`Direct sun on a clear day, 6-minute steps; straight prisms or building parts; sky view is a relative overcast-sky model, not lux. ${(ctx.site.source || 'footprints')}.`, PAD, H - 24);
    g.textAlign = 'right'; g.fillStyle = ink2; g.font = `600 11.5px ${sans}`; g.fillText('ApartmentScout', W - PAD, H - 24);
    void st0;
    cv.setAttribute('aria-label', `${n} scenarios side by side: ${rs.map((r, i) => `${i + 1}, ${r.label}: ${r.metrics.withheld ? 'withheld' : `${hm(r.metrics.day_min)} of direct sun, sky view ${Math.round(r.metrics.sky_view * 100)} percent`}`).join('; ')}.`);
  }
  function chip(g, x, y, text, o) {
    g.font = `600 ${o.size}px ${o.font}`; const tw = g.measureText(text).width, h = o.size + 12, w = tw + 18;
    g.fillStyle = o.bg; g.strokeStyle = o.line; g.lineWidth = 1; g.beginPath(); g.roundRect ? g.roundRect(x + 0.5, y + 0.5, w, h, 8) : g.rect(x, y, w, h); g.fill(); g.stroke();
    g.fillStyle = o.fg; g.textBaseline = 'middle'; g.textAlign = 'left'; g.fillText(text, x + 9, y + h / 2 + 0.5); g.textBaseline = 'alphabetic';
  }
  const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

  // ---------------------------------------------------------------- export, close
  $('cbPng').addEventListener('click', () => {
    if (dlg.dataset.ready !== '1') { toast('Wait for the pictures to finish.'); return; }
    $('cbCv').toBlob((b) => { if (b) { download(`${ctx.id}-compare-${specs.length}-scenarios.png`, b, 'image/png'); toast('Comparison saved as a PNG. Export the receipt for the numbers and assumptions.', 4200); } }, 'image/png');
  });
  $('cbJson').addEventListener('click', () => {
    const rc = last.get(ctx.id)?.receipt; if (!rc) { toast('Wait for the comparison to finish.'); return; }
    download(`${ctx.id}-compare-receipt.json`, JSON.stringify(rc, null, 1), 'application/json'); toast('Receipt saved.');
  });
  const close = () => { disposed = true; clearTimeout(timer); ++token; disposeStages(); dlg.close?.(); dlg.remove(); };
  $('cbX').addEventListener('click', close); $('cbClose').addEventListener('click', close);
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); });

  // start: the saved scenarios for this site if they still fit, else winter against summer
  const saved = savedScenarios(ctx.id).map((s) => normaliseSpec(rowSpec(s), env)).filter(Boolean);
  dlg.showModal();
  setSpecs(saved.length >= MIN_SCENARIOS ? saved : presetSpecs('seasons2', base, env));
  $('cbCam').value = ctx.liveStage ? 'current' : 'default';
  return { close, dialog: dlg, get results() { return results; }, FIELDS, changedFields };
}
