// Unit 3D's "Model" panel: the one scene shared by the Floor plan studio and the city. Four folds:
//   Plan and anchor   which plan the Inside camera shows (the source file, or a local scenario with furniture that the
//                     renter sent from the Floor plan studio on purpose), the shared anchor record, and the pin that
//                     makes the studio place the plan at this very window
//   Height            a measured slab or window-eye height beside the floor-count estimate, with export and import
//   Building parts    podium, tower and setback parts, source or assumed, with a form and a JSON editor
//   Compare / Project the scenario comparison board and the exportable model project
// The panel owns no scene state: unit3d.js hands it a snapshot (api.get()) and the actions it may take. It draws only
// its own HTML. Every number it shows comes from the pure modules (anchor, calibration, parts, openair, compare-core).
import { esc, toast, safeUrl } from '../util.js';
import { download } from '../app.js';
import { placePlan } from '../plan/city.js';
import { buildAnchor, getPin, savePin, clearPin } from './anchor.js';
import { anchorListHTML, pill } from './anchor-view.js';
import { calSummary, describeCal, exportCalibration, parseCalibration, normaliseMeasured } from './calibration.js';
import { validateParts, podiumTower, getAssumedParts, isAssumed, assumedBuildings } from './parts.js';
import { buildModelProject, parseModelProject, sha256Hex, bytesToBase64, MAX_PROJECT_BYTES } from './model-project.js';

const KIND = { podium: 'Podium', tower: 'Tower', setback: 'Setback', bulkhead: 'Bulkhead' };
const when = (iso) => { try { return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); } catch { return ''; } };
const round1 = (v) => Math.round(v * 10) / 10;

/** The live anchor record for a snapshot: the placement Unit 3D is showing right now, with the plan's windows. */
export function liveAnchor(c) {
  const { site, st, FACES, B, T, CAL, plan, planInfo } = c, face = FACES[st.face];
  if (!face || face.shared) return null;
  const pinOpt = { face: face.i, t: st.t, az: st.az, cal: CAL.measured };
  let ctx = null;
  if (plan) { try { ctx = placePlan(site, plan, st.floor, { anchor: pinOpt, parts: c.parts ?? undefined }); } catch { ctx = null; } }
  return buildAnchor({ site, siteId: c.id, B, T, face, t: st.t, az: st.az, floor: st.floor, cal: CAL, panes: c.panes, prov: c.prov, plan: plan ? { model: plan, source: planInfo.source, label: planInfo.label, saved: planInfo.saved } : null, ctx, nameOf: c.nameOf });
}

export function createModelPanel(host, api) {
  const open = { plan: true, height: false, parts: false, tools: false };
  let partsSel = null;
  const sigs = {};
  let pending = null, status = '';

  host.innerHTML = `<h3>Model <span>plan, anchor, height, parts</span></h3>
    <p class="u-note mp-lead">One scene for the Floor plan studio and the city. What is measured, what is source data and what you assumed stays labelled.</p>
    ${[['plan', 'Plan and anchor'], ['height', 'Height'], ['parts', 'Building parts'], ['tools', 'Compare and project']].map(([k, t]) => `<details class="mp-sec" data-sec="${k}"${open[k] ? ' open' : ''}><summary><span>${t}</span><span class="mp-sum" id="mpSum-${k}"></span></summary><div class="mp-body" id="mpBody-${k}"></div></details>`).join('')}
    <div class="sr" id="mpStatus" role="status" aria-live="polite"></div>`;
  const body = (k) => host.querySelector(`#mpBody-${k}`), sum = (k) => host.querySelector(`#mpSum-${k}`);
  const say = (m) => { status = m; host.querySelector('#mpStatus').textContent = m; };

  host.addEventListener('toggle', (e) => { const d = e.target.closest?.('details.mp-sec'); if (d && e.target === d) { open[d.dataset.sec] = d.open; if (d.open) refresh(true); } }, true);
  host.addEventListener('click', (e) => { const b = e.target.closest('[data-act]'); if (b && b.tagName !== 'INPUT') act(b.dataset.act, b, e); });
  host.addEventListener('change', (e) => { const t = e.target; if (t.matches('[data-act]')) act(t.dataset.act, t, e); });

  // ---------------------------------------------------------------- sections
  function planSection(c) {
    const { planInfo, scenario, useScenario } = c;
    const src = planInfo.source === 'local scenario' ? ['assumed', 'Local scenario'] : planInfo.source === 'file' ? ['source', 'Source plan'] : ['assumed', 'Generic room'];
    let h = `<div class="mp-row"><b>Inside view shows</b>${pill(src[0], src[1])}</div>`;
    if (scenario) {
      h += `<fieldset class="mp-radios"><legend class="sr">Plan for the Inside view</legend>
        <label class="mp-radio"><input type="radio" name="mpPlan" value="scenario" data-act="plan-source"${useScenario ? ' checked' : ''}><span><b>Your local scenario</b> “${esc(scenario.label || 'edited plan')}”, saved ${esc(when(scenario.saved))}. Edited rooms, doors, windows and ${scenario.layout?.items?.length ?? 0} pieces of furniture.</span></label>
        <label class="mp-radio"><input type="radio" name="mpPlan" value="file" data-act="plan-source"${useScenario ? '' : ' checked'}${c.hasFilePlan ? '' : ' disabled'}><span><b>The source plan file</b>${c.hasFilePlan ? ', as published for this unit (no furniture)' : ' (this unit has none)'}</span></label></fieldset>`;
    } else if (planInfo.source === 'file') {
      h += `<p class="u-note">The source plan for this unit, no furniture. To test a layout here, open the Floor plan studio and choose <b>Layout ▸ Use this plan in Unit 3D</b>: your edited plan and furniture then appear in the Inside view at this window.</p>`;
    } else {
      h += `<p class="u-note">This unit has no floor plan, so the Inside view uses a generic 5.5 × 7 m room. Trace or load a plan in the Floor plan studio to see the real layout here.</p>`;
    }
    if (planInfo.furniture) h += `<label class="tg mp-tg ${c.st.showFurniture !== false ? 'on' : ''}"><input type="checkbox" class="sr" data-act="furniture"${c.st.showFurniture !== false ? ' checked' : ''}><span class="switch"></span><span class="lbl">Show furniture<small>${planInfo.furniture} piece${planInfo.furniture === 1 ? '' : 's'} from the studio</small></span></label>`;
    h += `<p class="u-note">A plan is used only for the unit it was made for: a scenario saved for another unit is never applied here.</p>`;
    // the shared anchor
    if (open.plan) {
      const rec = liveAnchor(c);
      if (rec) {
        const pin = getPin(c.id, { base: c.base }), same = pin && pin.face === rec.facade.index && Math.abs(pin.t - c.st.t) < 1e-6 && Math.abs(pin.az - c.st.az) < 0.05 && pin.floor === c.st.floor && !!pin.bay === !!c.st.bay && JSON.stringify(pin.cal) === JSON.stringify(c.CAL.measured);
        h += `<div class="label mp-h">Shared anchor <span>${pin ? (same ? 'pinned for the Floor plan' : 'a different window is pinned') : 'not pinned'}</span></div>`;
        h += anchorListHTML(rec);
        if (!rec.air.ok) h += `<p class="u-note warn" role="alert">${esc(rec.air.message)} Sun conclusions are withheld for this window.</p>`;
        if (rec.plan && !rec.plan.open_air) h += `<p class="u-note warn">${rec.plan.withheld.length} plan window${rec.plan.withheld.length > 1 ? 's' : ''} (${rec.plan.withheld.map((i) => esc(rec.plan.windows[i].room || i + 1)).join(', ')}) map outside open air at this placement: no sun is concluded through ${rec.plan.withheld.length > 1 ? 'them' : 'it'}.</p>`;
        h += `<div class="mp-acts"><button type="button" class="btn sm primary" data-act="pin">${pin ? (same ? 'Pinned: refresh' : 'Update the pinned window') : 'Use this window in the Floor plan'}</button>${pin ? '<button type="button" class="btn sm ghost" data-act="unpin">Unpin</button>' : ''}${(c.hasFilePlan || scenario) ? `<a class="btn sm ghost" href="#plan/${esc(c.id)}">Open Floor plan</a>` : ''}</div>
          <p class="u-note">${pin ? 'The Floor plan studio places this plan on the pinned facade, position, facing and height.' : 'Pin it and the Floor plan studio places the plan at exactly this window, facing and height. Without a pin both viewers use the site file’s window.'}</p>`;
        sigs.anchor = rec;
      }
    } else h += '<p class="u-note">Open this section to see the anchor: origin, rotation, slab datum, host facade and which plan window sits where.</p>';
    return h;
  }
  const planSum = (c) => (c.planInfo.source === 'local scenario' ? 'local scenario' : c.planInfo.source === 'file' ? 'source plan' : 'generic room');

  function heightSection(c) {
    const { CAL, st } = c, [state, tone, text] = calSummary(CAL, st.floor), m = CAL.measured, d = describeCal(CAL, st.floor);
    const kind = m?.kind || 'slab', val = m ? m.value : round1(CAL.slabAt(st.floor) + (kind === 'eye' ? 1.6 : 0)), at = m ? m.floor : st.floor;
    return `<div class="mp-row"><b>Floor ${st.floor}</b>${pill(CAL.state === 'measured' ? 'measured' : 'assumed', state)}</div>
      <p class="u-note">${esc(text)}</p>
      <div class="mp-nums"><div><span>Used</span><b>${d.slab_m.toFixed(1)} m</b><small>slab, eye ${d.eye_m.toFixed(1)} m</small></div><div><span>Floor count says</span><b>${d.estimated_slab_m.toFixed(1)} m</b><small>${d.estimated_floor_height_m} m per floor</small></div><div><span>Difference</span><b>${d.delta_m > 0 ? '+' : d.delta_m < 0 ? '−' : ''}${Math.abs(d.delta_m).toFixed(1)} m</b><small>${m ? 'measured − estimated' : 'none'}</small></div></div>
      <div class="mp-grid">
        <div class="field"><label for="mpCalKind">Measured</label><select id="mpCalKind"><option value="slab"${kind === 'slab' ? ' selected' : ''}>Slab (floor level)</option><option value="eye"${kind === 'eye' ? ' selected' : ''}>Window eye level</option></select></div>
        <div class="field"><label for="mpCalVal">Height above the street</label><div class="u-slab-in"><input type="number" id="mpCalVal" step="0.1" min="0" max="700" inputmode="decimal" value="${val}"><span>m</span></div></div>
        <div class="field"><label for="mpCalFloor">at floor</label><input type="number" id="mpCalFloor" min="1" max="200" step="1" inputmode="numeric" value="${at}"></div>
        <div class="field"><label for="mpCalSpread">Other floors</label><select id="mpCalSpread"><option value="scale"${(m?.spread || 'scale') === 'scale' ? ' selected' : ''}>Every storey scaled</option><option value="offset"${m?.spread === 'offset' ? ' selected' : ''}>One constant shift (tall lobby)</option></select></div>
      </div>
      <div class="mp-acts"><button type="button" class="btn sm primary" data-act="cal-apply">Apply measured height</button><button type="button" class="btn sm ghost" data-act="cal-reset"${m ? '' : ' disabled'}>Use the floor count</button><button type="button" class="btn sm" data-act="cal-export">Export calibration</button><label class="btn sm ghost mp-file">Import<input type="file" class="sr" accept=".json,application/json" data-act="cal-import" aria-label="Import a calibration file"></label></div>
      <p class="u-note">A measured height replaces the floor count for the window, the Inside camera, the skyline, sun hours, sky view and the shadows of the city on the apartment. Where it came from (a section drawing, an elevator directory, a laser measure) belongs in your notes; it is not a survey.</p>`;
  }
  const heightSum = (c) => (c.CAL.state === 'measured' ? `measured ${c.CAL.slabAt(c.st.floor).toFixed(0)} m` : 'floor count');

  /** The buildings worth modelling: this one, the one selected on the map, and the main blockers of the window. */
  function partsCandidates(c) {
    const out = [], seen = new Set(), push = (bi, why) => { if (bi == null || bi < 0 || bi >= c.B0.length || seen.has(bi)) return; seen.add(bi); out.push({ bi, why, name: bi === c.site.target ? (c.listing?.building || 'This building') : c.nameOf(bi) }); };
    push(c.site.target, 'this building'); push(c.st.sel, 'selected'); for (const r of c.blockers || []) push(r.bi, 'takes sun');
    for (const bi of Object.keys(getAssumedParts(c.id, { nBuildings: c.site.b.length, base: c.base })?.parts || {})) push(+bi, 'assumed');
    return out;
  }
  function partsSection(c) {
    const { site } = c, cands = partsCandidates(c), bi = cands.some((x) => x.bi === partsSel) ? partsSel : site.target, b = c.B0[bi], parts = b.parts, roof = b.top - b.g;
    const rec = getAssumedParts(c.id, { nBuildings: site.b.length, base: c.base }), ovHere = rec?.parts?.[String(bi)], pr = rec?.preset?.[bi];
    const srcLink = (q) => { const s = q.source || 'source not recorded', u = safeUrl(q.ref); return u && /^https?:/i.test(u) ? `<a href="${esc(u)}" target="_blank" rel="noopener" title="${esc(s)}">${esc(/^osm /i.test(s) ? 'OpenStreetMap' : s.slice(0, 30))}</a>` : `<span title="${esc(s)}">${esc(/^osm /i.test(s) ? 'OpenStreetMap' : /^assumed/i.test(s) ? 'Assumed by you' : /^manual/i.test(s) ? 'Your file' : s.slice(0, 30))}</span>`; };
    const d = { podium_m: pr?.podium_m ?? Math.max(4, Math.min(roof - 4, Math.round(roof * 0.2))), setback_m: pr?.setback_m ?? 10, side_m: pr?.side_m ?? 0 };
    const assumedHere = isAssumed(parts);
    const list = parts ? `<table class="mini mp-parts"><thead><tr><th>Part</th><th class="num">Height</th><th>Source</th><th>Confidence</th></tr></thead><tbody>${[...parts].sort((x, y) => y.top - x.top).slice(0, 8).map((q) => `<tr><td>${esc(KIND[q.kind] || 'Part')}</td><td class="num">${Math.round(q.base_m)}–${Math.round(q.top_m)} m</td><td>${srcLink(q)}</td><td>${pill(q.confidence === 'assumed' ? 'assumed' : q.confidence === 'low' ? 'warn' : 'source', q.confidence || 'n/a')}</td></tr>`).join('')}</tbody></table>`
      : `<p class="u-note">This building is one footprint pushed straight up ${Math.round(roof)} m: no podium, setback or crown. If you know it is a podium with a tower, say so below; the drawing and every sun and sky number then use the parts.</p>`;
    const dropped = cands.filter((x) => rec?.parts?.[String(x.bi)]);
    return `<div class="field"><label for="mpBld">Building</label><select id="mpBld" data-act="parts-bld">${cands.map((x) => `<option value="${x.bi}"${x.bi === bi ? ' selected' : ''}>${esc(x.name)} · ${Math.round(c.B0[x.bi].top - c.B0[x.bi].g)} m · ${x.why}${rec?.parts?.[String(x.bi)] ? ' · assumed' : ''}</option>`).join('')}</select></div>
      <div class="mp-row"><b>${parts ? `${parts.length} part${parts.length > 1 ? 's' : ''}` : 'One prism'}</b>${assumedHere ? pill('assumed', 'Assumed by you') : parts ? pill('source', 'From source data') : pill('assumed', 'Not modelled')}</div>${list}
      <div class="label mp-h">Assume a podium and tower <span>labelled assumed everywhere</span></div>
      <div class="mp-grid">
        <div class="field"><label for="mpPodium">Podium height</label><div class="u-slab-in"><input type="number" id="mpPodium" min="1" max="${Math.max(2, Math.floor(roof) - 1)}" step="1" inputmode="decimal" value="${d.podium_m}"><span>m</span></div></div>
        <div class="field"><label for="mpSetback">Tower set back from the ${bi === site.target ? 'window facade' : 'side facing the window'}</label><div class="u-slab-in"><input type="number" id="mpSetback" min="0" max="200" step="1" inputmode="decimal" value="${d.setback_m}"><span>m</span></div></div>
        <div class="field"><label for="mpSide">Tower set back at the sides</label><div class="u-slab-in"><input type="number" id="mpSide" min="0" max="200" step="1" inputmode="decimal" value="${d.side_m}"><span>m</span></div></div>
      </div>
      <div class="mp-acts"><button type="button" class="btn sm primary" data-act="parts-apply">Model it as podium and tower</button><button type="button" class="btn sm ghost" data-act="parts-drop"${ovHere ? '' : ' disabled'}>Remove for this building</button><button type="button" class="btn sm ghost" data-act="parts-clear"${rec ? '' : ' disabled'}>Remove all my assumptions${dropped.length > 1 ? ` (${dropped.length})` : ''}</button></div>
      <details class="mp-json"><summary>Edit parts as JSON</summary>
        <p class="u-note">A map of building index to its parts (the key <code>target</code> means this building). Rings are [x, y] metres in the site frame (east, north of the address point); heights are above the building’s own ground. Every part needs a <code>source</code>; whatever you add is marked <b>assumed</b>.</p>
        <label class="sr" for="mpPartsJson">Building parts as JSON</label><textarea id="mpPartsJson" rows="9" spellcheck="false" autocomplete="off">${esc(JSON.stringify(rec ? rec.parts : { [String(bi)]: (parts && !assumedHere ? parts.map(({ ring, base_m, top_m, kind, source }) => ({ ring, base_m, top_m, kind, source: `assumed: edited from ${String(source).slice(0, 80)}`, confidence: 'assumed' })) : [{ ring: Array.from({ length: b.p.length / 2 }, (_, i) => [Math.round(b.p[2 * i] * 10) / 10, Math.round(b.p[2 * i + 1] * 10) / 10]), base_m: 0, top_m: Math.round(roof), kind: 'podium', source: 'assumed: describe where this comes from', confidence: 'assumed' }]) }, null, 1))}</textarea>
        <div class="mp-acts"><button type="button" class="btn sm" data-act="parts-json">Apply JSON</button></div><div class="u-note warn" id="mpPartsErr" role="alert"></div></details>
      <p class="u-note">${rec ? `Your assumptions are kept in this browser (saved ${esc(when(rec.saved))}) and used by Unit 3D, the Floor plan studio, exports and the comparison board. ` : ''}Source data is never changed; remove an assumption to go back to it.</p>`;
  }
  const partsSum = (c) => { const n = assumedBuildings(c.B0).length; return n ? `${n} assumed` : c.T.parts ? `${c.T.parts.length} parts` : 'one prism'; };

  function toolsSection(c) {
    return `<div class="mp-acts"><button type="button" class="btn sm primary" data-act="compare">Compare scenarios</button></div>
      <p class="u-note">Two to four scenarios side by side from one fixed camera: winter and summer, floors, facades, proposed buildings, assumed parts, a measured height. Identical assumptions, deltas, one PNG and a JSON receipt.</p>
      <div class="label mp-h">Model project <span>JSON, offline</span></div>
      <label class="tg mp-tg"><input type="checkbox" class="sr" id="mpGlb" data-act="noop"><span class="switch"></span><span class="lbl">Include the 3D model (.glb)<small>adds several MB</small></span></label>
      <div class="mp-acts"><button type="button" class="btn sm primary" data-act="project-export">Export project</button><label class="btn sm mp-file">Import project<input type="file" class="sr" accept=".json,application/json" data-act="project-import" aria-label="Import a model project"></label></div>
      <p class="u-note">One file with the city geometry and its source receipts, the window anchor, plan and furniture, height, assumed parts, saved scenarios and version information. Importing restores the scene without a network, on any browser or port.</p>
      <div id="mpImport" class="mp-import" aria-live="polite">${pending ? importSummary(pending) : ''}</div>
      ${c.imported ? `<div class="mp-card"><b>Restored from an imported project</b><span>This scene lives in this browser only. The site model on disk, if there is one, is not changed.</span><div class="mp-acts"><button type="button" class="btn sm" data-act="project-forget">Forget the imported project</button></div></div>` : ''}`;
  }
  const importSummary = (p) => `<div class="mp-card"><b>${esc(p.project.site.listing?.building || p.project.siteId)}</b><ul>
      <li>${p.project.site.b.length.toLocaleString()} buildings${p.project.parts ? `, ${Object.keys(p.project.parts).length} with assumed parts` : ''}</li>
      <li>${p.project.plan ? `Plan “${esc(p.project.plan.project.plan.title || p.project.plan.id)}” with ${p.project.plan.project.layout.items.length} pieces` : 'No plan'}</li>
      <li>${p.project.cal ? `Measured ${p.project.cal.kind === 'eye' ? 'window eye' : 'slab'} height ${p.project.cal.value} m at floor ${p.project.cal.floor}` : 'Floor-count height'}${p.project.pin ? ', pinned window' : ''}</li>
      <li>${p.project.scenarios.length} comparison scenario${p.project.scenarios.length === 1 ? '' : 's'}${p.project.glb ? ', embedded 3D model' : ''}</li></ul>
      ${p.warnings.length ? `<ul class="mp-warn">${p.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
      <p class="u-note">Restoring replaces this browser’s saved window pin, assumed parts and plan scenario for <b>${esc(p.project.siteId)}</b>${(p.replaces) ? ' and replaces the site model already loaded under that name for this session' : ''}.</p>
      <div class="mp-acts"><button type="button" class="btn sm primary" data-act="project-restore">Restore this project</button><button type="button" class="btn sm ghost" data-act="project-cancel">Cancel</button></div></div>`;

  // ---------------------------------------------------------------- refresh
  let timer = 0;
  /** Redraw the folds whose inputs changed. Dragging a slider fires this many times a second, so unforced calls wait for a pause. */
  function refresh(force = false) {
    clearTimeout(timer);
    if (!force) { timer = setTimeout(() => draw(false), 220); return; }
    draw(true);
  }
  function draw(force) {
    const c = api.get(); if (!c) return;
    const defs = {
      plan: [planSection, planSum, JSON.stringify([c.id, c.planInfo.source, c.planInfo.label, c.scenario?.saved, c.useScenario, c.planInfo.furniture, c.st.showFurniture, c.hasFilePlan, open.plan, c.st.face, round1(c.st.t * 1000), round1(c.st.az), c.st.floor, c.st.bay, c.CAL.measured, getPin(c.id, { base: c.base })?.saved, isAssumed(c.T.parts), c.st.air?.ok, c.planSig])],
      height: [heightSection, heightSum, JSON.stringify([c.CAL.measured, c.CAL.state, c.st.floor, c.CAL.fh])],
      parts: [partsSection, partsSum, JSON.stringify([c.id, partsSel, c.st.sel, (c.blockers || []).map((r) => r.bi), c.B0.filter((b) => b.parts).map((b) => [b.i, b.parts.length, isAssumed(b.parts)]).slice(0, 80), getAssumedParts(c.id, { nBuildings: c.site.b.length, base: c.base })?.saved])],
      tools: [toolsSection, () => '', JSON.stringify([c.id, !!pending, c.imported])],
    };
    const focus = document.activeElement;
    for (const [k, [render, summary, sig]] of Object.entries(defs)) {
      sum(k).textContent = summary(c);
      if (!force && sigs[k] === sig) continue;
      if (!open[k] && k !== 'plan') { sigs[k] = null; continue; }   // closed folds draw when opened
      if (focus && body(k).contains(focus) && ['INPUT', 'TEXTAREA', 'SELECT'].includes(focus.tagName) && !force) continue;   // never pull a field out from under the typist
      body(k).innerHTML = render(c); sigs[k] = sig;
    }
  }

  // ---------------------------------------------------------------- actions
  async function act(name, el, ev) {
    const c = api.get();
    try {
      if (name === 'plan-source') { if (el.checked) api.setUseScenario(el.value === 'scenario'); }
      else if (name === 'furniture') api.setFurniture(el.checked);
      else if (name === 'pin') {
        const rec = liveAnchor(c);
        if (!rec || !rec.air.ok) { toast('This window is not in open air, so it cannot be pinned.'); return; }
        savePin(c.id, { face: rec.facade.index, t: c.st.t, az: c.st.az, floor: c.st.floor, bay: c.st.bay, cal: c.CAL.measured }, { base: c.base });
        say('Window pinned. The Floor plan studio places the plan here.'); toast('Pinned: the Floor plan studio now places this plan at this window, facing and height.', 4200); refresh(true);
      } else if (name === 'unpin') { clearPin(c.id); say('Pin removed.'); toast('Pin removed: both viewers use the site file’s window again.'); refresh(true); }
      else if (name === 'cal-apply') {
        const m = normaliseMeasured({ kind: host.querySelector('#mpCalKind').value, value: parseFloat(host.querySelector('#mpCalVal').value), floor: parseInt(host.querySelector('#mpCalFloor').value, 10), spread: host.querySelector('#mpCalSpread').value, src: 'entered in Unit 3D' });
        if (!m) { say('That height is not valid: use 0 to 700 m and a floor from 1 to 200.'); toast('Enter a height from 0 to 700 m and a floor from 1 to 200.'); return; }
        api.setCal(m); say(`Measured ${m.kind === 'eye' ? 'window eye' : 'slab'} height ${m.value} m at floor ${m.floor} applied.`);
      } else if (name === 'cal-reset') { api.setCal(null); say('Back to the floor count.'); }
      else if (name === 'cal-export') {
        const o = exportCalibration(c.CAL, { site: c.id, floor: c.st.floor });
        download(`${c.id}-vertical-calibration.json`, JSON.stringify(o, null, 1), 'application/json'); toast('Calibration exported.');
      } else if (name === 'cal-import') {
        const f = el.files?.[0]; el.value = ''; if (!f) return;
        if (f.size > 200000) { toast('That file is too large to be a calibration.'); return; }
        let m = null; try { m = parseCalibration(JSON.parse(await f.text())); } catch { m = null; }
        if (!m) { say('That file is not a usable calibration.'); toast('That file is not a usable calibration.'); return; }
        api.setCal(m); say('Calibration imported.');
      } else if (name === 'parts-bld') { partsSel = +el.value; sigs.parts = null; refresh(true); }
      else if (name === 'parts-apply') {
        const bi = +host.querySelector('#mpBld').value, b = c.B0[bi];
        const p = { podium_m: parseFloat(host.querySelector('#mpPodium').value), setback_m: parseFloat(host.querySelector('#mpSetback').value), side_m: parseFloat(host.querySelector('#mpSide').value) || 0 };
        let out = c.FACES[c.st.face].bearing;
        if (bi !== c.site.target) { const w = c.winPoint, cx = (b.bb[0] + b.bb[2]) / 2, cy = (b.bb[1] + b.bb[3]) / 2; out = ((Math.atan2(w.x - cx, w.y - cy) * 180) / Math.PI + 360) % 360; }
        let parts; try { parts = podiumTower(b, { ...p, out_deg: out }); } catch (e) { say(e.message); toast(e.message, 4200); return; }
        const old = getAssumedParts(c.id, { nBuildings: c.site.b.length, base: c.base });
        partsSel = bi;
        api.setParts({ ...(old?.parts || {}), [String(bi)]: parts }, { ...(old?.preset || {}), [bi]: { ...p, out_deg: Math.round(out) } });
      } else if (name === 'parts-drop') {
        const bi = +host.querySelector('#mpBld').value, old = getAssumedParts(c.id, { nBuildings: c.site.b.length, base: c.base }), map = { ...(old?.parts || {}) }; delete map[String(bi)];
        api.setParts(Object.keys(map).length ? map : null, old?.preset);
      } else if (name === 'parts-clear') api.setParts(null);
      else if (name === 'parts-json') {
        const err = host.querySelector('#mpPartsErr'); err.textContent = '';
        let raw; try { raw = JSON.parse(host.querySelector('#mpPartsJson').value); } catch (e) { err.textContent = `Not valid JSON: ${e.message}`; return; }
        const { map, problems } = validateParts(raw, c.site.b.length);
        if (problems.length || !Object.keys(map).length) { err.textContent = problems.slice(0, 4).join(' · ') || 'Nothing to apply.'; return; }
        api.setParts(raw, null);
      } else if (name === 'compare') api.openCompare();
      else if (name === 'project-export') await exportProject(c, host.querySelector('#mpGlb')?.checked);
      else if (name === 'project-import') {
        const f = el.files?.[0]; el.value = ''; if (!f) return;
        if (f.size > MAX_PROJECT_BYTES) { say('That file is larger than 80 MB.'); toast('That file is larger than 80 MB.'); return; }
        const text = await f.text(), r = parseModelProject(text);
        if (!r.ok) { say(`Not restored: ${r.error}`); toast(`Not restored: ${r.error}`, 6000); pending = null; refresh(true); return; }
        pending = { ...r, text, replaces: api.hasSite(r.project.siteId) }; say('Project read. Review it, then restore.'); refresh(true);
      } else if (name === 'project-restore' && pending) {
        const p = pending; pending = null; refresh(true);
        await api.restoreProject(p.project, p.text); say(`Restored ${p.project.siteId}.`);
      } else if (name === 'project-cancel') { pending = null; say('Import cancelled.'); refresh(true); }
      else if (name === 'project-forget') await api.forgetImported(c.id);
    } catch (e) { say(`Failed: ${e.message || e}`); toast(`Failed: ${e.message || e}`, 5200); }
  }

  async function exportProject(c, withGlb) {
    toast('Building the project…');
    const rec = liveAnchor(c);
    let glb = null;
    if (withGlb) { try { const buf = await api.glb(); glb = { data: bytesToBase64(buf), bytes: buf.byteLength, sha256: await sha256Hex(new Uint8Array(buf)) }; } catch (e) { toast(`The 3D model could not be built (${e.message || e}); exporting without it.`, 5000); } }
    const plan = await api.planForExport();
    const project = buildModelProject({
      siteId: c.id, base: c.base, site: c.site, anchor: rec, pin: getPin(c.id, { base: c.base }), cal: exportCalibration(c.CAL, { site: c.id, floor: c.st.floor }),
      parts: getAssumedParts(c.id, { nBuildings: c.site.b.length, base: c.base })?.parts ?? null, plan, scenarios: api.savedScenarios(), results: api.lastComparison(),
      edits: [...c.edits].map(([index, h]) => ({ index, h })), view: { date: c.st.date, min: c.st.min, floor: c.st.floor, cmp: c.st.cmp, mode: c.st.mode, bay: c.st.bay, future: c.future }, glb,
      siteHash: await sha256Hex(JSON.stringify(c.site)), app: { version: c.appVersion },
    });
    const text = JSON.stringify(project);
    download(`${c.id}-model-project.json`, text, 'application/json');
    say(`Project exported (${(text.length / 1048576).toFixed(1)} MB).`); toast(`Project exported: ${(text.length / 1048576).toFixed(1)} MB${glb ? ', with the 3D model' : ''}.`, 4200);
  }

  return { refresh, say, get status() { return status; } };
}

