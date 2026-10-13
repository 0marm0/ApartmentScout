// Unit 3D: the listing's building and every neighbour in 3D, the sun for any date and time,
// the view from the chosen window, a sun-path chart and direct-sun hours for every floor.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { S, byId, label, loadJSON } from './app.js';
import { $, esc, css } from './util.js';
import { DEG, sunPos, zonedMs, angDiff, fmtT, fmtHM, dayTable, prepBuildings, horizonProfile, horizonDir, hAt, litInfo, facesOf, compass } from './sun.js';

let site = null, B = [], T = null, FACES = [], LM = [];
const st = { id: null, face: 0, t: 0.5, floor: 10, cmp: 20, az: 180, date: '', min: 750, mode: 'orbit', playing: false, fov: 75, yaw: 0, pitch: 8, shadows: true, labels: true, cone: true, ray: true };
let renderer, scene, orbitCam, winCam, controls, sunL, hemi, marker, band, coneMesh, rayLine, labels = [], groundMat, mats = [];
let profA = null, profB = null, curSun = null, dirty = true, heatTok = 0, loopOn = false;
const tz = () => site?.timezone || S.crit.search?.timezone || 'America/New_York';
const FH = () => site?.floor_height_m || 3.2;

export function init() {
  const sel = $('unitSel');
  const ids = S.manifest.sites || [];
  sel.innerHTML = ids.length ? ids.map((id) => `<option value="${esc(id)}">${esc(byId(id) ? label(byId(id)) : id)}</option>`).join('')
    : '<option>No site models yet: run `apartmentscout site <listing-id>`</option>';
  sel.addEventListener('change', () => { location.hash = '#unit/' + sel.value; });
}

export async function show(id) {
  const ids = S.manifest.sites || [];
  if (!ids.length) { $('winPanel').innerHTML = '<p>No site models built yet. Run <code>apartmentscout site &lt;listing-id&gt;</code> for a listing, then <code>apartmentscout build</code>.</p>'; return; }
  id = id && ids.includes(id) ? id : st.id || ids[0];
  $('unitSel').value = id;
  if (id !== st.id) await load(id);
  resize();
  if (!loopOn) { loopOn = true; frame(); }
}

async function load(id) {
  site = await loadJSON(`${S.base}/sites/${id}.json`, null);
  if (!site) return;
  st.id = id;
  B = prepBuildings(site.b);
  T = B[site.target] || B[0];
  FACES = facesOf(T);
  LM = (site.lm || []).map((l) => ({ name: l[0], idx: l[1], x: l[2], y: l[3], top: l[4] }));
  const L = byId(id) || {};
  const qs = new URLSearchParams(location.search);
  const w = site.window || {};
  st.face = Math.max(0, FACES.findIndex((f) => f.i === w.face));
  if (w.face == null) st.face = FACES.reduce((bi, f, i, a) => (f.length > a[bi].length ? i : bi), 0);
  st.t = w.t ?? 0.5;
  const maxF = Math.max(2, Math.floor((T.top - T.g) / FH()));
  st.floor = Math.min(maxF, +(qs.get('floor') || w.floor || L.floor || Math.round(maxF / 2)));
  st.cmp = Math.min(maxF, Math.max(st.floor + 9, Math.round(maxF * 0.85)));
  st.az = FACES[st.face]?.bearing ?? 180;
  st.date = qs.get('date') || (S.crit.search?.move_in?.earliest ? String(S.crit.search.move_in.earliest).slice(0, 10) : new Date().toISOString().slice(0, 10));
  st.min = +(qs.get('min') || 750);
  if (qs.get('mode') === 'window') st.mode = 'win';
  buildScene();
  buildPanels();
  refreshWindow(true);
}

// ------------------------------------------------------------------ scene
function buildScene() {
  const cv = $('gl');
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    new ResizeObserver(resize).observe($('stage'));
  }
  scene = new THREE.Scene();
  orbitCam = new THREE.PerspectiveCamera(45, 1.6, 2, 9000);
  winCam = new THREE.PerspectiveCamera(75, 1.6, 0.4, 9000);
  const cx = (T.bb[0] + T.bb[2]) / 2, cy = (T.bb[1] + T.bb[3]) / 2, h = T.top;
  const fb = (FACES[st.face]?.bearing ?? 200) * DEG;
  orbitCam.position.set(cx + Math.sin(fb) * 330 - 120, h + 190, -(cy + Math.cos(fb) * 330));
  controls?.dispose();
  controls = new OrbitControls(orbitCam, cv);
  controls.target.set(cx, h * 0.45, -cy); controls.maxPolarAngle = Math.PI * 0.495; controls.minDistance = 30; controls.maxDistance = 3000; controls.update();
  controls.addEventListener('change', () => (dirty = true));
  hemi = new THREE.HemisphereLight(0xdfeaf5, 0x7c7f78, 1.4); scene.add(hemi);
  sunL = new THREE.DirectionalLight(0xfff3dc, 3); sunL.castShadow = true; sunL.shadow.mapSize.set(4096, 4096);
  Object.assign(sunL.shadow.camera, { left: -650, right: 650, top: 650, bottom: -650, near: 1, far: 3400 });
  sunL.shadow.bias = -0.0004; sunL.shadow.normalBias = 0.4; scene.add(sunL); scene.add(sunL.target);
  sunL.target.position.set(cx, 0, -cy);
  groundMat = new THREE.MeshStandardMaterial({ color: 0x9ea39b, roughness: 1 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), groundMat); ground.rotation.x = -Math.PI / 2; ground.position.y = -0.05; ground.receiveShadow = true; scene.add(ground);
  const matN = new THREE.MeshStandardMaterial({ color: 0xd5d7d1, roughness: 0.92 });
  const matT = new THREE.MeshStandardMaterial({ color: 0xbac8d6, roughness: 0.6, metalness: 0.1 });
  const matE = new THREE.MeshStandardMaterial({ color: 0x2f62e8, roughness: 0.6 });
  mats = [matN, matT, matE, groundMat];
  const edgeMat = new THREE.LineBasicMaterial({ color: 0x3a423d, transparent: true, opacity: 0.25 });
  for (const b of B) {
    const sh = new THREE.Shape();
    for (let j = 0; j < b.n; j++) { const x = b.p[2 * j], y = b.p[2 * j + 1]; j ? sh.lineTo(x, y) : sh.moveTo(x, y); }
    const h2 = Math.max(1, b.top - b.g);
    const geo = new THREE.ExtrudeGeometry(sh, { depth: h2, bevelEnabled: false });
    const m = new THREE.Mesh(geo, b === T ? matE : (h2 > 120 ? matT : matN));
    m.rotation.x = -Math.PI / 2; m.position.y = b.g;
    const d = Math.hypot((b.bb[0] + b.bb[2]) / 2, (b.bb[1] + b.bb[3]) / 2);
    m.castShadow = d < 950; m.receiveShadow = d < 950;
    scene.add(m);
    if (d < 750) { const e = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 25), edgeMat); e.rotation.x = -Math.PI / 2; e.position.y = b.g; scene.add(e); }
  }
  const sh = new THREE.Shape(); for (let j = 0; j < T.n; j++) { const x = T.p[2 * j], y = T.p[2 * j + 1]; j ? sh.lineTo(x, y) : sh.moveTo(x, y); }
  band = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: FH(), bevelEnabled: false }), new THREE.MeshBasicMaterial({ color: 0xffb43c, transparent: true, opacity: 0.6, depthWrite: false }));
  band.rotation.x = -Math.PI / 2; band.scale.set(1.006, 1.006, 1); band.position.x = -cx * 0.006; band.position.z = cy * 0.006; scene.add(band);
  marker = new THREE.Mesh(new THREE.BoxGeometry(5, 2.6, 0.6), new THREE.MeshBasicMaterial({ color: 0xfff2b0 })); scene.add(marker);
  rayLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 1, 0)]), new THREE.LineBasicMaterial({ color: 0xffb43c })); scene.add(rayLine);
  labels = [];
  for (const l of LM) { const s = mkLabel(l.name, Math.round(l.top) + ' m'); s.position.set(l.x, l.top + 14, -l.y); scene.add(s); labels.push(s); }
  const own = mkLabel(site.listing?.building || 'This building', `${Math.round(T.top - T.g)} m`); own.position.set(cx, T.top + 16, -cy); scene.add(own); labels.push(own);
  coneMesh = null;
  dirty = true;
}
function mkLabel(text, sub) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 128; const g = c.getContext('2d');
  g.fillStyle = 'rgba(14,20,28,.84)'; g.fillRect(0, 0, 512, 128);
  g.fillStyle = '#f4f7fa'; g.font = '600 40px "IBM Plex Sans", sans-serif'; g.textBaseline = 'middle'; g.fillText(text.slice(0, 22), 18, 46);
  g.fillStyle = '#b6c2d0'; g.font = '400 30px "IBM Plex Sans", sans-serif'; g.fillText(sub, 18, 96);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true })); s.renderOrder = 10; return s;
}

function winPos(floor) {
  const f = FACES[st.face]; if (!f) return { x: 0, y: 0, z: 10, fx: 0, fy: 0 };
  const x = f.a[0] + (f.b[0] - f.a[0]) * st.t, y = f.a[1] + (f.b[1] - f.a[1]) * st.t;
  const nx = Math.sin(f.bearing * DEG), ny = Math.cos(f.bearing * DEG);
  return { x: x + nx * 0.4, y: y + ny * 0.4, z: T.g + (floor - 1) * FH() + 1.6, fx: x, fy: y };
}
function sunNow() { const [y, m, d] = st.date.split('-').map(Number); return sunPos(zonedMs(y, m - 1, d, st.min, tz()), site.origin.lat, site.origin.lon); }
function skyColor(alt) {
  const n = new THREE.Color(0x0a0f1c), t = new THREE.Color(0xe9a77c), d = new THREE.Color(0xaed4ee);
  if (alt <= -6) return n; if (alt <= 6) return n.clone().lerp(t, (alt + 6) / 12); if (alt <= 18) return t.clone().lerp(d, (alt - 6) / 12); return d;
}
function rebuildCone() {
  if (coneMesh) { scene.remove(coneMesh); coneMesh.geometry.dispose(); coneMesh = null; }
  if (!st.cone) return;
  const w = winPos(st.floor), thC = (90 - st.az) * DEG;
  coneMesh = new THREE.Mesh(new THREE.CircleGeometry(300, 48, thC - 60 * DEG, 120 * DEG), new THREE.MeshBasicMaterial({ color: 0x3f86d9, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }));
  coneMesh.rotation.x = -Math.PI / 2; coneMesh.position.set(w.x, w.z, -w.y); scene.add(coneMesh);
}
function updateScene() {
  const w = winPos(st.floor);
  marker.position.set(w.fx + Math.sin(st.az * DEG) * 0.25, w.z, -(w.fy + Math.cos(st.az * DEG) * 0.25));
  marker.rotation.y = Math.PI - st.az * DEG;
  band.position.y = T.g + (st.floor - 1) * FH();
  const s = sunNow(); curSun = s;
  const sd = new THREE.Vector3(Math.sin(s.az * DEG) * Math.cos(s.alt * DEG), Math.sin(s.alt * DEG), -Math.cos(s.az * DEG) * Math.cos(s.alt * DEG));
  sunL.position.copy(sunL.target.position).addScaledVector(sd, 1600);
  const up = s.alt > 0;
  sunL.intensity = up ? Math.min(3.4, 0.7 + Math.sin(Math.max(s.alt, 0) * DEG) * 3.6) : 0;
  hemi.intensity = up ? 1.1 + Math.min(0.6, s.alt / 60) : 0.45;
  scene.background = skyColor(s.alt);
  const lit = up && Math.abs(angDiff(s.az, st.az)) < 90 && s.alt > hAt(profA, s.az);
  rayLine.geometry.setFromPoints([new THREE.Vector3(w.x, w.z, -w.y), new THREE.Vector3(w.x, w.z, -w.y).addScaledVector(sd, up ? 420 : 0.01)]);
  rayLine.material.color.set(lit ? 0xffb43c : 0xe05a44); rayLine.visible = st.ray && up;
  labels.forEach((l) => (l.visible = st.labels));
  dirty = true;
  const hud = !up ? ['Night', 'shade'] : Math.abs(angDiff(s.az, st.az)) >= 90 ? ['Sun is behind the window', 'shade'] : lit ? ['Direct sun on the window', 'lit'] : ['Window in shadow', 'shade'];
  $('hud').innerHTML = `<span>${esc(st.date)} ${fmtT(st.min)}</span><span>Sun ${Math.round(s.az)}° ${compass(s.az)}, ${up ? Math.round(s.alt) + '° up' : 'below horizon'}</span><span class="${hud[1]}">${hud[0]}</span><span>Floor ${st.floor}, facing ${Math.round(st.az)}° ${compass(st.az)}</span>`;
  return { s, lit, up };
}

// ------------------------------------------------------------------ panels
function buildPanels() {
  const L = byId(st.id) || {};
  const maxF = Math.max(2, Math.floor((T.top - T.g) / FH()));
  $('winPanel').innerHTML = `<h3>Window</h3>
    <div class="field"><label for="uFace">Which facade (the building's outline from city data)</label>
      <select id="uFace">${FACES.map((f, i) => `<option value="${i}">${Math.round(f.bearing)}° ${compass(f.bearing)} facade, ${Math.round(f.length)} m long</option>`).join('')}</select></div>
    <div class="row"><div class="field"><label for="uPos">Position along facade <span class="val" id="uPosV"></span></label><input type="range" id="uPos" min="3" max="97" value="${Math.round(st.t * 100)}"></div>
      <div class="field"><label for="uFloor">Floor <span class="val" id="uFloorV"></span></label><input type="range" id="uFloor" min="2" max="${maxF}" value="${st.floor}"></div></div>
    <div class="row"><div class="field"><label for="uCmp">Compare with floor <span class="val" id="uCmpV"></span></label><input type="range" id="uCmp" min="2" max="${maxF}" value="${st.cmp}"></div>
      <div class="field"><label for="uAz">Window faces <span class="val" id="uAzV"></span></label><input type="range" id="uAz" min="0" max="359" value="${Math.round(st.az)}"></div></div>
    <p class="muted" style="margin:10px 0 0;font-size:12.5px">${site.window ? `Facade chosen from the listing's exposure (${esc((L.exposure || []).join(', '))}).` : 'Exposure unknown: pick the facade the unit is on. Ask the agent for a floor plan with a compass.'} Floor height ${FH()} m.</p>`;
  $('uFace').value = st.face;
  $('uFace').addEventListener('change', (e) => { st.face = +e.target.value; st.az = FACES[st.face].bearing; $('uAz').value = Math.round(st.az); refreshWindow(true); });
  $('uPos').addEventListener('input', (e) => { st.t = +e.target.value / 100; refreshWindow(true); });
  $('uFloor').addEventListener('input', (e) => { st.floor = +e.target.value; refreshWindow(false); });
  $('uCmp').addEventListener('input', (e) => { st.cmp = +e.target.value; refreshWindow(false); });
  $('uAz').addEventListener('input', (e) => { st.az = +e.target.value; refreshWindow(true); });

  const mi = S.crit.search?.move_in?.earliest ? String(S.crit.search.move_in.earliest).slice(0, 10) : null;
  const y = +(st.date.slice(0, 4));
  $('timePanel').innerHTML = `<h3>Time and camera</h3>
    <div class="row"><div class="seg"><button type="button" id="mOrbit">Orbit model</button><button type="button" id="mWin">From the window</button></div>
      <div class="chips">${[['shadows', 'Shadows'], ['labels', 'Labels'], ['cone', 'View cone'], ['ray', 'Sun ray']].map(([k, t]) => `<button type="button" class="chip ${st[k] ? 'on' : ''}" data-tg="${k}">${t}</button>`).join('')}</div></div>
    <div class="row"><div class="field" style="flex:0 1 170px"><label for="uDate">Date</label><input type="date" id="uDate" value="${st.date}"></div>
      <div class="field" style="flex:2 1 260px"><label for="uTime">Time <span class="val" id="uTimeV"></span></label><input type="range" id="uTime" min="300" max="1230" step="5" value="${st.min}"></div>
      <button class="btn" type="button" id="uPlay">Play day</button></div>
    <div class="row"><span class="lbl">Jump to</span><div class="seg" id="uQuick">${[[mi, 'Move-in'], [`${y}-12-21`, 'Dec 21'], [`${y}-03-20`, 'Mar 20'], [`${y}-06-21`, 'Jun 21'], [`${y}-09-22`, 'Sep 22']].filter((q) => q[0]).map(([d, t]) => `<button type="button" data-d="${d}">${t}</button>`).join('')}</div></div>
    <div class="row" id="uWinOnly" ${st.mode === 'win' ? '' : 'hidden'}><div class="field"><label for="uFov">Lens width <span class="val" id="uFovV">${st.fov}°</span></label><input type="range" id="uFov" min="35" max="110" value="${st.fov}"></div>
      <div class="field"><label for="uYaw">Turn <span class="val" id="uYawV">${st.yaw}°</span></label><input type="range" id="uYaw" min="-90" max="90" value="${st.yaw}"></div>
      <div class="field"><label for="uPitch">Tilt <span class="val" id="uPitchV">${st.pitch}°</span></label><input type="range" id="uPitch" min="-10" max="50" value="${st.pitch}"></div></div>`;
  const setMode = (m) => { st.mode = m; $('mOrbit').classList.toggle('on', m === 'orbit'); $('mWin').classList.toggle('on', m === 'win'); $('uWinOnly').hidden = m !== 'win'; dirty = true; };
  $('mOrbit').addEventListener('click', () => setMode('orbit')); $('mWin').addEventListener('click', () => setMode('win')); setMode(st.mode);
  $('timePanel').querySelectorAll('[data-tg]').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.tg; st[k] = !st[k]; b.classList.toggle('on', st[k]);
    if (k === 'shadows') { renderer.shadowMap.enabled = st.shadows; mats.forEach((m) => (m.needsUpdate = true)); }
    if (k === 'cone') rebuildCone();
    refreshTime();
  }));
  $('uDate').addEventListener('change', (e) => { if (e.target.value) { st.date = e.target.value; refreshTime(); } });
  $('uTime').addEventListener('input', (e) => { st.min = +e.target.value; refreshTime(); });
  $('uQuick').querySelectorAll('[data-d]').forEach((b) => b.addEventListener('click', () => { st.date = b.dataset.d; $('uDate').value = st.date; refreshTime(); }));
  $('uPlay').addEventListener('click', () => { st.playing = !st.playing; $('uPlay').textContent = st.playing ? 'Pause' : 'Play day'; $('uPlay').classList.toggle('primary', st.playing); });
  for (const [id, k] of [['uFov', 'fov'], ['uYaw', 'yaw'], ['uPitch', 'pitch']]) $(id).addEventListener('input', (e) => { st[k] = +e.target.value; $(id + 'V').textContent = st[k] + '°'; dirty = true; });
  $('pathLegend').innerHTML = `<span><span class="sw" style="background:var(--shade)"></span>Buildings blocking the sky from this floor</span><span><span class="sw" style="background:var(--sun)"></span>Chosen date</span><span><span class="sw" style="background:var(--muted)"></span>Dec 21, Mar 20, Jun 21</span><span>Dashed: skyline from compare floor</span>`;
  $('unitNotes').innerHTML = `<h3>How this is modelled</h3>Buildings: ${esc(site.source)} outlines and roof heights, drawn as straight prisms (no setbacks or spires). The window sits ${FH()} m per floor up the facade you pick, 1.6 m above the floor. Direct sun only: no reflections, trees or haze. A window counts as lit when the sun is within 90° of the way it faces and above every building in that direction. Treat it as a strong estimate, then check on a tour at the same time of day.`;
}

function refreshWindow(heavy) {
  $('uPosV').textContent = Math.round(st.t * 100) + '%'; $('uFloorV').textContent = st.floor; $('uCmpV').textContent = st.cmp; $('uAzV').textContent = Math.round(st.az) + '° ' + compass(st.az);
  const a = winPos(st.floor), b = winPos(st.cmp);
  profA = horizonProfile(B, a.x, a.y, a.z); profB = horizonProfile(B, b.x, b.y, b.z);
  rebuildCone(); refreshTime(); landmarks();
  if (heavy || !heatData) computeHeat(); else drawHeat();
}
function refreshTime() { $('uTimeV').textContent = fmtT(st.min); const info = updateScene(); sunPanel(info); drawPath(); }

function sunPanel(info) {
  const [y, m, d] = st.date.split('-').map(Number);
  const tab = dayTable(y, m - 1, d, site.origin.lat, site.origin.lon, tz());
  const A = litInfo(tab, profA, st.az), Bc = litInfo(tab, profB, st.az), s = info.s;
  let why;
  if (!info.up) why = `The sun is below the horizon at ${fmtT(st.min)}.`;
  else if (Math.abs(angDiff(s.az, st.az)) >= 90) why = `At ${fmtT(st.min)} the sun is at ${Math.round(s.az)}°, behind a window facing ${Math.round(st.az)}°.`;
  else { const h = hAt(profA, s.az); why = info.lit ? `At ${fmtT(st.min)} the sun is ${Math.round(s.alt)}° up and clears the buildings in that direction (${Math.round(h)}°).` : `At ${fmtT(st.min)} the sun is ${Math.round(s.alt)}° up but buildings in that direction reach ${Math.round(h)}°, so the window is in shadow.`; }
  $('sunPanel').innerHTML = `<h3>Sun on this window</h3>
    <div class="stats"><div class="stat"><div class="k">Sun now</div><div class="v">${info.up ? Math.round(s.alt) + '° up' : 'below horizon'}</div></div>
      <div class="stat"><div class="k">Direct sun this date, floor ${st.floor}</div><div class="v">${A.min ? fmtHM(A.min) : 'none'}</div></div>
      <div class="stat"><div class="k">Same date, floor ${st.cmp}</div><div class="v">${Bc.min ? fmtHM(Bc.min) : 'none'}</div></div></div>
    <p style="margin:10px 0 4px">${why}</p>
    <p class="muted" style="margin:0">${A.segs.length ? `Floor ${st.floor} gets direct sun ${A.segs.map((q) => fmtT(q[0]) + ' to ' + fmtT(q[1])).join(', ')}.` : `Floor ${st.floor} gets no direct sun on this date.`}</p>`;
}

function landmarks() {
  const w = winPos(st.floor);
  let open = 0, tot = 0;
  for (let a = st.az - 60; a <= st.az + 60; a++) { open += 60 - Math.min(60, hAt(profA, a)); tot += 60; }
  const rows = LM.map((l) => {
    const dx = l.x - w.x, dy = l.y - w.y, dist = Math.hypot(dx, dy), az = ((Math.atan2(dx, dy) / DEG) + 360) % 360;
    const block = horizonDir(B, w.x, w.y, w.z, az, l.idx), topA = Math.atan2(l.top - w.z, dist) / DEG;
    const from = Math.max(0, w.z + dist * Math.tan(block * DEG));
    const inView = Math.abs(angDiff(az, st.az)) <= 60, behind = Math.abs(angDiff(az, st.az)) >= 90;
    const res = behind ? '<span class="muted">Behind the window</span>' : topA <= block + 0.2 ? '<span class="hid">Hidden by nearer buildings</span>'
      : `<span class="ok">${l.top - from > l.top * 0.98 ? 'Whole tower' : 'Top ' + Math.round(l.top - from) + ' m'}</span>${inView ? '' : ' <span class="muted">(off to the side)</span>'}`;
    return `<tr><td>${esc(l.name)}</td><td class="num">${Math.round(l.top)} m</td><td class="num">${Math.round(az)}°</td><td class="num">${Math.round(dist)} m</td><td>${res}</td></tr>`;
  }).join('');
  $('seePanel').innerHTML = `<h3>What the window sees</h3>
    <div class="stats" style="margin-bottom:10px"><div class="stat"><div class="k">Open sky in a ±60° view</div><div class="v">${Math.round(100 * open / tot)}%</div></div>
      <div class="stat"><div class="k">Skyline straight ahead</div><div class="v">${Math.round(hAt(profA, st.az))}° up</div></div>
      <div class="stat"><div class="k">Nearest wall ahead</div><div class="v">${nearestAhead(w)}</div></div></div>
    <div class="scroll"><table class="mini"><thead><tr><th>Tallest towers in range</th><th>Height</th><th>Bearing</th><th>Distance</th><th>From this floor</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
function nearestAhead(w) {
  const ux = Math.sin(st.az * DEG), uy = Math.cos(st.az * DEG); let best = 1e9, top = 0;
  for (const b of B) {
    if (b === T) continue;
    for (let j = 0; j < b.n; j++) {
      const ax = b.p[2 * j], ay = b.p[2 * j + 1], j2 = (j + 1) % b.n, ex = b.p[2 * j2] - ax, ey = b.p[2 * j2 + 1] - ay;
      const den = ux * ey - uy * ex; if (Math.abs(den) < 1e-9) continue;
      const wx = ax - w.x, wy = ay - w.y, t = (wx * ey - wy * ex) / den, s = (wx * uy - wy * ux) / den;
      if (t > 0.5 && s >= 0 && s <= 1 && t < best && b.top > w.z) { best = t; top = b.top; }
    }
  }
  return best < 1e9 ? `${Math.round(best)} m (${Math.round(top)} m tall)` : 'none';
}

let heatData = null;
function computeHeat() {
  const tok = ++heatTok; heatData = {};
  const maxF = Math.max(2, Math.floor((T.top - T.g) / FH()));
  const y = +st.date.slice(0, 4);
  const tabs = Array.from({ length: 12 }, (_, m) => dayTable(y, m, 15, site.origin.lat, site.origin.lon, tz()));
  let fl = 2;
  const step = () => {
    if (tok !== heatTok) return;
    const t0 = performance.now();
    while (fl <= maxF && performance.now() - t0 < 28) {
      const w = winPos(fl), prof = horizonProfile(B, w.x, w.y, w.z);
      heatData[fl] = tabs.map((t) => litInfo(t, prof, st.az).min / 60); fl++;
    }
    drawHeat(fl <= maxF);
    if (fl <= maxF) setTimeout(step, 0);
  };
  step();
}
function drawHeat(busy) {
  const maxF = Math.max(2, Math.floor((T.top - T.g) / FH()));
  let h = '<div class="hd"></div>' + 'JFMAMJJASOND'.split('').map((m) => `<div class="hd">${m}</div>`).join('');
  for (let fl = maxF; fl >= 2; fl--) {
    const row = heatData?.[fl];
    h += `<div class="fl">${fl}</div>`;
    for (let m = 0; m < 12; m++) {
      if (!row) { h += '<div></div>'; continue; }
      const v = row[m], pct = Math.round(Math.min(1, v / 9) * 100);
      h += `<div class="${fl === st.floor ? 'cur' : fl === st.cmp ? 'cmp' : ''}" style="background:color-mix(in srgb, var(--sun) ${pct}%, var(--panel));color:${pct > 55 ? '#1b1200' : 'var(--ink)'}">${v < 0.05 ? '0' : v.toFixed(1)}</div>`;
    }
  }
  $('heatPanel').innerHTML = `<h3>Direct sun by floor and month</h3><p class="muted" style="margin:0 0 8px;font-size:12.5px">Hours per day on the 15th of each month, same facade and position. ${busy ? 'Calculating…' : 'Solid outline: your floor. Dashed: compare floor.'}</p><div class="scroll"><div class="heat">${h}</div></div>`;
}

function drawPath() {
  const c = $('pathCv'); const dpr = devicePixelRatio || 1, cw = c.clientWidth || 640;
  c.width = Math.round(cw * dpr); c.height = Math.round(cw * (cw < 520 ? 0.78 : 0.46) * dpr);
  const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const W = cw, H = c.height / dpr, fg = css('--ink'), mu = css('--muted'), ln = css('--line'), sun = css('--sun'), sh = css('--shade'), pn = css('--panel');
  g.fillStyle = pn; g.fillRect(0, 0, W, H);
  const L0 = 44, R = 12, T0 = 12, Bm = 34, pw = W - L0 - R, ph = H - T0 - Bm, a0 = st.az - 110, a1 = st.az + 110, amax = 75;
  const X = (a) => L0 + (a - a0) / (a1 - a0) * pw, Y = (al) => T0 + ph - (al / amax) * ph;
  g.font = `${cw < 520 ? 10 : 11}px "IBM Plex Mono", monospace`; g.textBaseline = 'middle'; g.lineWidth = 1;
  for (let al = 0; al <= amax; al += 15) { g.strokeStyle = ln; g.beginPath(); g.moveTo(L0, Y(al)); g.lineTo(W - R, Y(al)); g.stroke(); g.fillStyle = mu; g.textAlign = 'right'; g.fillText(al + '°', L0 - 5, Y(al)); }
  for (let a = Math.ceil(a0 / 30) * 30; a <= a1; a += 30) { const aa = ((a % 360) + 360) % 360; g.strokeStyle = ln; g.beginPath(); g.moveTo(X(a), T0); g.lineTo(X(a), T0 + ph); g.stroke(); g.fillStyle = mu; g.textAlign = 'center'; g.fillText(`${aa}° ${compass(aa)}`, X(a), H - Bm + 15); }
  g.setLineDash([4, 4]); g.strokeStyle = mu; [st.az - 90, st.az + 90].forEach((a) => { g.beginPath(); g.moveTo(X(a), T0); g.lineTo(X(a), T0 + ph); g.stroke(); }); g.setLineDash([]);
  const prof = (p, col, fill) => {
    g.beginPath(); let first = true;
    for (let a = a0; a <= a1; a += 0.5) { const x = X(a), yy = Y(Math.min(amax, hAt(p, a))); if (first) { g.moveTo(x, T0 + ph); g.lineTo(x, yy); first = false; } else g.lineTo(x, yy); }
    if (fill) { g.lineTo(X(a1), T0 + ph); g.closePath(); g.fillStyle = col; g.globalAlpha = 0.55; g.fill(); g.globalAlpha = 1; } else { g.strokeStyle = col; g.lineWidth = 1.5; g.setLineDash([5, 4]); g.stroke(); g.setLineDash([]); g.lineWidth = 1; }
  };
  prof(profA, sh, true); prof(profB, fg, false);
  const wrap = (az) => { let a = az; while (a < a0 - 180) a += 360; while (a > a1 + 180) a -= 360; return a; };
  const mk = (y, mo, d, col, w, hrs) => {
    const t = dayTable(y, mo, d, site.origin.lat, site.origin.lon, tz()); g.beginPath(); let f = true;
    for (const [, az, al] of t) { const a = wrap(az); if (a < a0 || a > a1) { f = true; continue; } const x = X(a), yy = Y(Math.min(al, amax)); if (f) { g.moveTo(x, yy); f = false; } else g.lineTo(x, yy); }
    g.strokeStyle = col; g.lineWidth = w; g.stroke(); g.lineWidth = 1;
    if (hrs) { g.fillStyle = col; g.textAlign = 'center'; for (const [m, az, al] of t) { if (m % 60) continue; const a = wrap(az); if (a < a0 || a > a1) continue; g.beginPath(); g.arc(X(a), Y(Math.min(al, amax)), 3, 0, 6.3); g.fill(); g.fillText(fmtT(m).replace(':00', ''), X(a), Y(Math.min(al, amax)) - 11); } }
  };
  const y = +st.date.slice(0, 4);
  mk(y, 11, 21, mu, 1.2); mk(y, 2, 20, mu, 1.2); mk(y, 5, 21, mu, 1.2);
  const [yy, mm, dd] = st.date.split('-').map(Number); mk(yy, mm - 1, dd, sun, 2.6, true);
  if (curSun && curSun.alt > 0) { const a = wrap(curSun.az); if (a >= a0 && a <= a1) { g.beginPath(); g.arc(X(a), Y(Math.min(curSun.alt, amax)), 7, 0, 6.3); g.fillStyle = sun; g.fill(); g.lineWidth = 2; g.strokeStyle = fg; g.stroke(); g.lineWidth = 1; } }
  g.strokeStyle = ln; g.strokeRect(L0, T0, pw, ph);
}

// ------------------------------------------------------------------ loop
function resize() {
  if (!renderer) return;
  const el = $('stage'), w = el.clientWidth, h = el.clientHeight; if (!w || !h) return;
  renderer.setSize(w, h, false);
  for (const c of [orbitCam, winCam]) if (c) { c.aspect = w / h; c.updateProjectionMatrix(); }
  dirty = true;
  if (site && profA) drawPath();
}
function frame() {
  requestAnimationFrame(frame);
  if ($('view-unit').hidden || !scene) return;
  if (st.playing) { st.min += 4; if (st.min > 1230) st.min = 300; $('uTime').value = st.min; refreshTime(); }
  if (!dirty) return; dirty = false;
  let cam = orbitCam;
  if (st.mode === 'win') {
    const w = winPos(st.floor), az = (st.az + st.yaw) * DEG, pt = st.pitch * DEG;
    winCam.position.set(w.x, w.z, -w.y); winCam.fov = st.fov; winCam.updateProjectionMatrix();
    winCam.lookAt(winCam.position.clone().add(new THREE.Vector3(Math.sin(az) * Math.cos(pt), Math.sin(pt), -Math.cos(az) * Math.cos(pt))));
    cam = winCam;
  }
  for (const l of labels) { if (!l.visible) continue; const d = cam.position.distanceTo(l.position); const sc = Math.max(18, d * (st.mode === 'win' ? 0.15 : 0.19)); l.scale.set(sc, sc / 4, 1); }
  marker.visible = band.visible = st.mode !== 'win'; if (coneMesh) coneMesh.visible = st.mode !== 'win';
  renderer.render(scene, cam);
}
