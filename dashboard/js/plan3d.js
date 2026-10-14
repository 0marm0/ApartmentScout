// Floor plan 3D: extrude a simple room plan, cut window and door openings, and light it with the
// real sun. When the listing also has a site model, the sun is switched off whenever the
// neighbouring buildings block it, so patches on the floor match the city around the unit.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { S, byId, label, loadJSON } from './app.js';
import { $, esc, css } from './util.js';
import { DEG, sunPos, zonedMs, angDiff, fmtT, prepBuildings, horizonProfile, hAt, facesOf, compass } from './sun.js';

const KIND_COL = { living: 0xe9dcc4, bedroom: 0xd9e4ee, kitchen: 0xe8e2d6, bath: 0xd8e6e3, hall: 0xe4e2dd, closet: 0xdcd8d0, outdoor: 0xc8d8bf };
let plan = null, siteProf = null, renderer, scene, cam, controls, sunL, hemi, dirty = true, loop = false, patchMeshes = [];
const st = { id: null, date: '', min: 720, playing: false, view: 'bird', site: null };
const U = () => (plan?.units === 'm' ? 1 : 0.3048); // plan units -> metres

export function init() {
  document.getElementById('view-plan').innerHTML = `<div class="view-pad"><div class="u-grid"> <div class="u-left"> <div class="u-picker"><label for="planSel">Floor plan</label><select id="planSel"></select></div> <div id="pstage" class="canvas-stage"><canvas id="pgl"></canvas><div class="hud" id="phud"></div></div> <div class="panel" id="ptimePanel"></div> </div> <div class="u-right"> <div class="panel" id="planInfo"></div> <div class="panel" id="planRooms"></div> <div class="panel note" id="planNotes"></div> </div> </div></div>`;
  const ids = S.manifest.plans || [];
  $('planSel').innerHTML = ids.length ? ids.map((id) => `<option value="${esc(id)}">${esc(byId(id) ? label(byId(id)) : id)}</option>`).join('') : '<option>No floor plans yet: add plans/&lt;listing-id&gt;.json</option>';
  $('planSel').addEventListener('change', (e) => (location.hash = '#plan/' + e.target.value));
}

export async function show(id) {
  const ids = S.manifest.plans || [];
  if (!ids.length) { $('planInfo').innerHTML = '<p>No floor plans yet. See <code>docs/guides/floor-plans.md</code> for the simple JSON format, or ask your agent to draw one from the listing plan.</p>'; return; }
  id = id && ids.includes(id) ? id : st.id || ids[0];
  $('planSel').value = id;
  if (id !== st.id) await load(id);
  resize();
  if (!loop) { loop = true; frame(); }
}

async function load(id) {
  plan = await loadJSON(`${S.base}/plans/${id}.json`, null);
  st.id = id;
  const qs = new URLSearchParams(location.search);
  st.date = qs.get('date') || (S.crit.search?.move_in?.earliest ? String(S.crit.search.move_in.earliest).slice(0, 10) : new Date().toISOString().slice(0, 10));
  st.min = +(qs.get('pmin') || 720);
  st.site = null; siteProf = null;
  if ((S.manifest.sites || []).includes(id)) {
    const site = await loadJSON(`${S.base}/sites/${id}.json`, null);
    if (site) {
      const B = prepBuildings(site.b), T = B[site.target], F = facesOf(T);
      const want = plan.up_bearing ?? site.window?.bearing ?? 180;
      const face = F.reduce((best, f) => (Math.abs(angDiff(f.bearing, want)) < Math.abs(angDiff(best.bearing, want)) ? f : best), F[0]);
      const t = site.window?.t ?? 0.5, x = face.a[0] + (face.b[0] - face.a[0]) * t, y = face.a[1] + (face.b[1] - face.a[1]) * t;
      const floor = plan.floor || byId(id)?.floor || 5;
      siteProf = horizonProfile(B, x + Math.sin(face.bearing * DEG) * 0.4, y + Math.cos(face.bearing * DEG) * 0.4, T.g + (floor - 1) * (site.floor_height_m || 3.2) + 1.6);
      st.site = site;
    }
  }
  build();
  panels();
  refresh();
}

function build() {
  const cv = $('pgl');
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    new ResizeObserver(resize).observe($('pstage'));
  }
  const u = U(), H = (plan.ceiling || 9) * u, wt = (plan.wall || 0.4) * u;
  scene = new THREE.Scene(); scene.background = new THREE.Color(0xdfe6ee);
  const xs = plan.rooms.flatMap((r) => [r.x, r.x + r.w]), ys = plan.rooms.flatMap((r) => [r.y, r.y + r.h]);
  const minX = Math.min(...xs) * u, maxX = Math.max(...xs) * u, minY = Math.min(...ys) * u, maxY = Math.max(...ys) * u;
  st.bounds = { minX, maxX, minY, maxY, H };
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  cam = new THREE.PerspectiveCamera(45, 1.6, 0.05, 500);
  controls?.dispose();
  controls = new OrbitControls(cam, cv); controls.target.set(cx, 0.6, -cy); controls.maxPolarAngle = Math.PI * 0.49;
  controls.addEventListener('change', () => (dirty = true));
  setView(st.view);
  hemi = new THREE.HemisphereLight(0xf2f4f8, 0x8a8478, 2.2); scene.add(hemi); scene.add(new THREE.AmbientLight(0xffffff, 0.7));
  sunL = new THREE.DirectionalLight(0xfff1d6, 6); sunL.castShadow = true; sunL.shadow.mapSize.set(2048, 2048);
  Object.assign(sunL.shadow.camera, { left: -15, right: 15, top: 15, bottom: -15, near: 0.5, far: 120 }); sunL.shadow.bias = -0.0005; sunL.shadow.normalBias = 0.02;
  scene.add(sunL); scene.add(sunL.target); sunL.target.position.set(cx, 0, -cy);
  // floors
  for (const r of plan.rooms) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(r.w * u, r.h * u), new THREE.MeshStandardMaterial({ color: KIND_COL[r.kind] || 0xe4e2dd, roughness: 0.85 }));
    m.rotation.x = -Math.PI / 2; m.position.set((r.x + r.w / 2) * u, 0.002, -(r.y + r.h / 2) * u); m.receiveShadow = true; scene.add(m);
    const lab = flatLabel(r.name, `${fmtLen(r.w)} × ${fmtLen(r.h)}`), sc = Math.min(r.w * u * 0.85, r.h * u * 2.4, 2.8) / 1.9;
    lab.scale.set(sc, sc, sc); lab.position.set((r.x + r.w / 2) * u, 0.03, -(r.y + r.h / 2) * u); scene.add(lab);
  }
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: 0xb9bdb6 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.03; ground.receiveShadow = true; scene.add(ground);
  // walls with openings
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xf6f5f2, roughness: 0.9 });
  const segs = new Map();
  const key = (a, b) => [a, b].map((p) => p.map((v) => v.toFixed(2)).join(',')).sort().join('|');
  for (const r of plan.rooms) {
    const P = [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]];
    for (let i = 0; i < 4; i++) { const a = P[i], b = P[(i + 1) % 4]; segs.set(key(a, b), [a, b]); }
  }
  const cuts = [...(plan.windows || []).map((w) => ({ ...w, type: 'win' })), ...(plan.doors || []).map((d) => ({ ...d, type: 'door', sill: 0, head: d.head || 6.9 })), ...(plan.open_walls || []).map((d) => ({ ...d, type: 'open', sill: 0, head: plan.ceiling || 9 }))];
  for (const [a, b] of segs.values()) {
    const horiz = Math.abs(a[1] - b[1]) < 1e-6;
    const c0 = horiz ? Math.min(a[0], b[0]) : Math.min(a[1], b[1]), c1 = horiz ? Math.max(a[0], b[0]) : Math.max(a[1], b[1]), fixed = horiz ? a[1] : a[0];
    const mine = cuts.filter((c) => {
      const ch = Math.abs(c.y1 - c.y2) < 1e-6;
      if (ch !== horiz) return false;
      if (Math.abs((horiz ? c.y1 : c.x1) - fixed) > 0.05) return false;
      const s0 = horiz ? Math.min(c.x1, c.x2) : Math.min(c.y1, c.y2), s1 = horiz ? Math.max(c.x1, c.x2) : Math.max(c.y1, c.y2);
      return s1 > c0 && s0 < c1;
    }).map((c) => ({ ...c, s0: Math.max(c0, horiz ? Math.min(c.x1, c.x2) : Math.min(c.y1, c.y2)), s1: Math.min(c1, horiz ? Math.max(c.x1, c.x2) : Math.max(c.y1, c.y2)) })).sort((p, q) => p.s0 - q.s0);
    const box = (s0, s1, z0, z1) => {
      if (s1 - s0 < 1e-3 || z1 - z0 < 1e-3) return;
      const len = (s1 - s0) * u, mid = (s0 + s1) / 2 * u;
      const g = new THREE.BoxGeometry(horiz ? len : wt, (z1 - z0) * u, horiz ? wt : len);
      const m = new THREE.Mesh(g, wallMat); m.castShadow = true; m.receiveShadow = true;
      m.position.set(horiz ? mid : fixed * u, (z0 + z1) / 2 * u, -(horiz ? fixed * u : mid)); scene.add(m);
    };
    const Hc = plan.ceiling || 9;
    let pos = c0;
    for (const c of mine) {
      box(pos, c.s0, 0, Hc);
      if (c.type !== 'open') { box(c.s0, c.s1, 0, c.sill); box(c.s0, c.s1, c.head, Hc); }
      if (c.type === 'win') {
        const gl = new THREE.Mesh(new THREE.PlaneGeometry((c.s1 - c.s0) * u, (c.head - c.sill) * u), new THREE.MeshStandardMaterial({ color: 0x9fc6e8, transparent: true, opacity: 0.18, roughness: 0.1, side: THREE.DoubleSide }));
        gl.position.set(horiz ? (c.s0 + c.s1) / 2 * u : fixed * u, (c.sill + c.head) / 2 * u, -(horiz ? fixed * u : (c.s0 + c.s1) / 2 * u));
        if (!horiz) gl.rotation.y = Math.PI / 2;
        scene.add(gl);
      }
      pos = c.s1;
    }
    box(pos, c1, 0, Hc);
  }
  // invisible ceiling: blocks sky light from above but is never drawn
  const ceil = new THREE.Mesh(new THREE.BoxGeometry(maxX - minX + 1, 0.1, maxY - minY + 1), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
  ceil.position.set(cx, H + 0.06, -cy); ceil.castShadow = true; scene.add(ceil);
  // compass rose on the ground
  const up = (plan.up_bearing ?? 0) * DEG;
  const north = new THREE.Vector3(Math.sin(-up), 0, -Math.cos(-up));
  const arrow = new THREE.ArrowHelper(north, new THREE.Vector3(maxX + 1.2, 0.05, -minY - 0.6), 1.4, 0xd4378c, 0.45, 0.3); scene.add(arrow);
  const nl = flatLabel('N', ''); nl.position.copy(new THREE.Vector3(maxX + 1.2, 0.05, -minY - 0.6).addScaledVector(north, 1.9)); nl.scale.set(0.9, 0.45, 1); scene.add(nl);
  dirty = true;
}
function fmtLen(v) { if (plan.units === 'm') return v.toFixed(1) + ' m'; const ft = Math.floor(v + 1e-6), inch = Math.round((v - ft) * 12); return inch === 12 ? `${ft + 1}'0"` : `${ft}'${inch}"`; }
function flatLabel(a, b) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 160; const g = c.getContext('2d');
  g.fillStyle = '#24303d'; g.font = '600 54px "IBM Plex Sans", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(a, 256, 58);
  if (b) { g.fillStyle = '#5b6573'; g.font = '400 40px "IBM Plex Mono", monospace'; g.fillText(b, 256, 118); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.6), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, depthTest: false }));
  m.rotation.x = -Math.PI / 2; m.renderOrder = 5; return m;
}

function setView(v) {
  st.view = v; const b = st.bounds; if (!b || !cam) return;
  const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2, span = Math.max(b.maxX - b.minX, b.maxY - b.minY);
  if (v === 'top') { cam.position.set(cx, span * 1.55, -cy + 0.01); controls.target.set(cx, 0, -cy); }
  else if (v === 'eye') { cam.position.set(cx, 1.6, -b.minY - 0.8); controls.target.set(cx, 1.4, -b.maxY); }
  else { cam.position.set(cx - span * 0.35, span * 1.25, -cy + span * 0.8); controls.target.set(cx, 0, -cy - span * 0.05); }
  cam.fov = v === 'eye' ? 70 : 45; cam.updateProjectionMatrix(); controls.update(); dirty = true;
}

function panels() {
  const L = byId(st.id) || {};
  const area = plan.rooms.reduce((s, r) => s + r.w * r.h, 0);
  $('planInfo').innerHTML = `<h3>${esc(plan.title || label(L))}</h3>
    <div class="stats"><div class="stat"><div class="k">Area of rooms drawn</div><div class="v">${Math.round(area)} ${plan.units === 'm' ? 'm²' : 'ft²'}</div></div>
      <div class="stat"><div class="k">Windows face</div><div class="v">${plan.up_bearing != null ? Math.round(plan.up_bearing) + '° ' + compass(plan.up_bearing) : '?'}</div></div>
      <div class="stat"><div class="k">Neighbours modelled</div><div class="v">${st.site ? 'yes, floor ' + (plan.floor || L.floor || '?') : 'no site model'}</div></div></div>
    <p class="muted" style="margin:10px 0 0;font-size:12.5px">${esc(plan.source || '')}</p>`;
  const y = +st.date.slice(0, 4), mi = S.crit.search?.move_in?.earliest ? String(S.crit.search.move_in.earliest).slice(0, 10) : null;
  $('ptimePanel').innerHTML = `<h3>Sun inside the apartment</h3>
    <div class="row"><div class="seg">${[['bird', 'Bird’s eye'], ['top', 'Top down'], ['eye', 'Standing inside']].map(([k, t]) => `<button type="button" data-v="${k}" class="${k === st.view ? 'on' : ''}">${t}</button>`).join('')}</div></div>
    <div class="row"><div class="field" style="flex:0 1 170px"><label for="pDate">Date</label><input type="date" id="pDate" value="${st.date}"></div>
      <div class="field" style="flex:2 1 260px"><label for="pTime">Time <span class="val" id="pTimeV"></span></label><input type="range" id="pTime" min="300" max="1230" step="5" value="${st.min}"></div>
      <button class="btn" type="button" id="pPlay">Play day</button></div>
    <div class="row"><span class="lbl">Jump to</span><div class="seg" id="pQuick">${[[mi, 'Move-in'], [`${y}-12-21`, 'Dec 21'], [`${y}-03-20`, 'Mar 20'], [`${y}-06-21`, 'Jun 21']].filter((q) => q[0]).map(([d, t]) => `<button type="button" data-d="${d}">${t}</button>`).join('')}</div></div>`;
  $('ptimePanel').querySelectorAll('[data-v]').forEach((b) => b.addEventListener('click', () => { $('ptimePanel').querySelectorAll('[data-v]').forEach((x) => x.classList.toggle('on', x === b)); setView(b.dataset.v); }));
  $('pDate').addEventListener('change', (e) => { if (e.target.value) { st.date = e.target.value; refresh(); } });
  $('pTime').addEventListener('input', (e) => { st.min = +e.target.value; refresh(); });
  $('pQuick').querySelectorAll('[data-d]').forEach((b) => b.addEventListener('click', () => { st.date = b.dataset.d; $('pDate').value = st.date; refresh(); }));
  $('pPlay').addEventListener('click', () => { st.playing = !st.playing; $('pPlay').textContent = st.playing ? 'Pause' : 'Play day'; $('pPlay').classList.toggle('primary', st.playing); });
  $('planNotes').innerHTML = `<h3>Plan format</h3>Rooms are rectangles in ${plan.units === 'm' ? 'metres' : 'feet'}, windows and doors are segments on room edges, and <span class="mono">up_bearing</span> is the compass direction the top of the drawing faces. Agents can draw one from a listing floor plan; see <span class="mono">docs/guides/floor-plans.md</span>.`;
}

function refresh() {
  $('pTimeV').textContent = fmtT(st.min);
  const lat = st.site?.origin.lat ?? S.crit.search?.map_center?.[0] ?? 40.75, lon = st.site?.origin.lon ?? S.crit.search?.map_center?.[1] ?? -73.98;
  const tz = st.site?.timezone || S.crit.search?.timezone || 'America/New_York';
  const [y, m, d] = st.date.split('-').map(Number);
  const s = sunPos(zonedMs(y, m - 1, d, st.min, tz), lat, lon);
  const up = s.alt > 0;
  const blocked = up && siteProf && s.alt <= hAt(siteProf, s.az);
  // sun direction in plan coordinates: plan +y points to up_bearing
  const rel = (s.az - (plan.up_bearing ?? 0)) * DEG;
  const dir = new THREE.Vector3(Math.sin(rel) * Math.cos(s.alt * DEG), Math.sin(s.alt * DEG), -Math.cos(rel) * Math.cos(s.alt * DEG));
  sunL.position.copy(sunL.target.position).addScaledVector(dir, 60);
  sunL.intensity = up && !blocked ? 4 + 4 * Math.sin(s.alt * DEG) : 0;
  hemi.intensity = up ? 2.2 : 0.7;
  scene.background = new THREE.Color(up ? 0xdfe6ee : 0x1a2230);
  // how far sun reaches into each windowed room
  const rows = (plan.windows || []).map((w) => {
    const horiz = Math.abs(w.y1 - w.y2) < 1e-6;
    const nb = horiz ? (w.y1 >= st.bounds.maxY / U() - 0.01 ? 0 : 180) : (w.x1 >= st.bounds.maxX / U() - 0.01 ? 90 : 270);
    const facing = ((plan.up_bearing ?? 0) + nb) % 360, da = Math.abs(angDiff(s.az, facing));
    const ok = up && !blocked && da < 90;
    const depth = ok ? (w.head * Math.cos(da * DEG)) / Math.tan(Math.max(1, s.alt) * DEG) : 0;
    return `<tr><td>${esc(w.room || '')}${w.note ? ' <span class="muted">(' + esc(w.note) + ')</span>' : ''}</td><td class="num">${Math.round(facing)}° ${compass(facing)}</td><td>${ok ? `<span class="ok">sun reaches ${fmtLen(Math.min(depth, 40))} in</span>` : `<span class="muted">${!up ? 'night' : blocked ? 'blocked by neighbours' : 'sun behind this wall'}</span>`}</td></tr>`;
  }).join('');
  $('planRooms').innerHTML = `<h3>Windows right now</h3>
    <p style="margin:0 0 8px">${st.date} at ${fmtT(st.min)}: sun ${Math.round(s.az)}° ${compass(s.az)}, ${up ? Math.round(s.alt) + '° up' : 'below the horizon'}${blocked ? ', <b>behind nearby buildings</b> (from the site model)' : ''}.</p>
    <div class="scroll"><table class="mini"><thead><tr><th>Window</th><th>Faces</th><th>Direct sun</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  $('phud').innerHTML = `<span>${st.date} ${fmtT(st.min)}</span><span class="${up && !blocked ? 'lit' : 'shade'}">${!up ? 'Night' : blocked ? 'Sun blocked by neighbours' : 'Sun ' + Math.round(s.alt) + '° up'}</span>`;
  dirty = true;
}

function resize() {
  if (!renderer) return; const el = $('pstage'), w = el.clientWidth, h = el.clientHeight; if (!w || !h) return;
  renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); dirty = true;
}
function frame() {
  requestAnimationFrame(frame);
  if ($('view-plan').hidden || !scene) return;
  if (st.playing) { st.min += 3; if (st.min > 1230) st.min = 300; $('pTime').value = st.min; refresh(); }
  if (!dirty) return; dirty = false;
  renderer.render(scene, cam);
}
