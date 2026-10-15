// Unit 3D scene: the city as merged prisms with a height ramp, a time-of-day sky dome, sun light with soft
// shadows, footprint outlines, streets, proposed buildings, the target building and its window, the sun and
// its ray, and DOM labels drawn as glass chips. Five cameras: orbit, from the window, inside the apartment
// (the floor plan's shell placed at the real slab height and bearing, lit by the real sun through the city),
// north-up street plan, top down. A bay window draws as a small fan of panes. GLB export of the scene.
// The view module owns the state; this module only draws it.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { DEG } from '../sun.js';
import { css, esc } from '../util.js';
import { heightClass, pickLabels } from './heights.js';
// [city context] ground plate, water, parks and trees (unit/context3d.js) and the river and park labels
import { buildContext } from './context3d.js';
import { contextLabels } from './context-core.js';
import { palette, skyAt, SKY_VS, SKY_FS, glowTexture } from '../city3d/look.js';   // [city3d] the shared look of the city: palette, sky keyframes and dome, sun glow
import { decorate } from '../city3d/facade.js';   // [city3d] the shared facade shader
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { roomLightState, moodFor, applyRoomLight } from '../room3d/lighting.js';   // [room3d] the room's own light, shared with the studio
import { roomQuality, quality } from '../room3d/quality.js';
import { createSky, applySky } from '../city3d/sky.js';   // [city3d] the shared sky
import { createCity } from '../city3d/city.js';   // [city3d] THE city: buildings, outlines, context and ground, shared with the studio
import { shapeOf, prism, prismsOf, solidGeo, heightColor, mergeBuildings, edgeGeo, outlineGeo } from '../city3d/buildings.js';   // [city3d] THE building mesher

const isLight = () => document.documentElement.dataset.theme === 'light';
const col = (name, fb) => { const v = css(name); return new THREE.Color(/^#[0-9a-f]{3,8}$/i.test(v) ? v.slice(0, 7) : fb); };
const mix = (a, b, t) => a.clone().lerp(b, t);
const W3 = (x, y, z = 0) => new THREE.Vector3(x, z, -y);   // local metres (x east, y north, z up) -> three.js


function disposeTree(o) {
  o.traverse((m) => { m.geometry?.dispose?.(); const ms = Array.isArray(m.material) ? m.material : m.material ? [m.material] : []; ms.forEach((x) => { x.map?.dispose?.(); x.dispose?.(); }); });
}

export class UnitStage {
  constructor(canvas, stageEl, labelsEl) {
    this.cv = canvas; this.el = stageEl; this.labEl = labelsEl;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    RectAreaLightUniformsLib.init();   // [room3d] the windows' sky glow
    this.maxTex = this.renderer.capabilities.maxTextureSize || 4096;
    this.mode = 'orbit'; this.look = { yaw: 0, pitch: 6, fov: 70 }; this.dirty = true; this.tween = null;
    this.opts = { shadows: true, labels: true, streets: true, future: true, green: true, water: true, streetTrees: true, parkTrees: true, cone: false, ray: true, target: 'solid' };   // [park trees] streetTrees / parkTrees switch the two kinds of tree
    this.quality = { visual: false, phone: false };   // [city context] set by unit/quality3d.js (room3d/quality.js cityQualityOf): tree shadows, water glint, tree share, grass detail, texture scale
    this.labels = []; this.pal = palette(); this.onCompass = null;
    this.opts.heights = false;
    // shared facade uniforms (see decorate)
    this.facU = { uNight: { value: 0 }, uFloorH: { value: 3.2 }, uDetail: { value: 1 }, uLitCol: { value: new THREE.Color(1, 0.8, 0.5) } };
    this.stillCam = new THREE.PerspectiveCamera(50, 1, 0.3, 12000);
  }

  // ---------------------------------------------------------------- build
  /** data: {B, T, ti, streets, future, lm, ownLabel, R} */
  build(data) {
    this.data = data;
    if (this.scene) { this.cityObj?.ctx?.dispose(); disposeTree(this.scene); }
    const scene = this.scene = new THREE.Scene();
    this.interior = null; this.inEye = null; this.fanLine = null;
    const { B, T } = data;
    const cx = (T.bb[0] + T.bb[2]) / 2, cy = (T.bb[1] + T.bb[3]) / 2;
    this.center = W3(cx, cy, 0); this.cxy = [cx, cy];
    const pal = this.pal = this.livePalette();

    // cameras and controls
    this.orbitCam = new THREE.PerspectiveCamera(42, 1.6, 2, 12000);
    this.winCam = new THREE.PerspectiveCamera(70, 1.6, 0.3, 12000);
    this.planCam = new THREE.OrthographicCamera(-200, 200, 150, -150, 1, 8000);
    this.planCam.up.set(0, 0, -1);
    this.controls?.dispose(); this.planControls?.dispose();
    this.controls = new OrbitControls(this.orbitCam, this.cv);
    Object.assign(this.controls, { enableDamping: true, dampingFactor: 0.09, maxPolarAngle: Math.PI * 0.495, minDistance: 25, maxDistance: 4200, zoomSpeed: 0.9 });
    this.controls.addEventListener('change', () => (this.dirty = true));
    this.planControls = new OrbitControls(this.planCam, this.cv);
    Object.assign(this.planControls, { enableRotate: false, screenSpacePanning: true, enableDamping: true, dampingFactor: 0.12, minZoom: 0.25, maxZoom: 8 });
    this.planControls.addEventListener('change', () => (this.dirty = true));
    this.resetOrbit(false); this.resetPlan();

    // sky dome, fog, lights
    const SK = this.skyObj = createSky(pal);   // [city3d] the sky the studio's eye-level views share
    this.skyU = SK.U; this.sky = SK.dome; scene.add(SK.dome);
    scene.fog = new THREE.Fog(0x000000, 900, 3600);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.2); scene.add(this.hemi);
    this.amb = new THREE.AmbientLight(0xfff3e6, 0); scene.add(this.amb);   // [room3d] the bounce fill of the room's light (0 outside)
    const sunL = this.sunL = new THREE.DirectionalLight(0xffffff, 2.6);
    sunL.castShadow = true; const ms = Math.min(4096, this.maxTex); sunL.shadow.mapSize.set(ms, ms);
    Object.assign(sunL.shadow.camera, { left: -560, right: 560, top: 560, bottom: -560, near: 10, far: 4200 });
    sunL.shadow.bias = -0.00035; sunL.shadow.normalBias = 0.6; sunL.shadow.radius = 3;
    sunL.target.position.copy(this.center); scene.add(sunL); scene.add(sunL.target);

    // [city3d] ground, buildings, roof and footprint outlines: the city both engines share (city3d/city.js), in the site frame, near ones casting shadows
    const C = this.cityObj = createCity({ B, T, ti: data.ti, meta: data.meta, green: data.green, water: data.water, streets: data.streets }, { pal, center: this.cxy, quality: this.quality, castShadow: true, facU: this.facU });
    Object.assign(this, { groundMat: C.groundMat, groundBase: C.groundBase, bMat: C.bMat, vrange: C.vrange, city: C.meshes, edgeMat: C.edgeMat, edgeIdx: C.edgeIdx, edges: C.edges, outlineMat: C.outlineMat, outlines: C.outlines });
    scene.add(C.group);

    // target building in the accent, with solid / faint / hidden display
    this.tMat = new THREE.MeshStandardMaterial({ color: pal.tBase, roughness: 0.62, metalness: 0.05, transparent: true, opacity: 1 });
    decorate(this.tMat, this.facU, 'unit-target');
    this.tMesh = new THREE.Mesh(this.solidGeo(T), this.tMat); this.tMesh.castShadow = this.tMesh.receiveShadow = true; this.tMesh.userData.bi = data.ti; scene.add(this.tMesh);
    this.tEdgeMat = new THREE.LineBasicMaterial({ color: pal.accent, transparent: true, opacity: 0.9, depthWrite: false });
    this.tEdges = new THREE.LineSegments(this.edgeGeo([data.ti], true), this.tEdgeMat); scene.add(this.tEdges);
    this.tFoot = new THREE.LineSegments(this.outlineGeo([data.ti], 0.35), new THREE.LineBasicMaterial({ color: pal.accent, transparent: true, opacity: 0.95 })); scene.add(this.tFoot);

    // floor bands: chosen floor in sun, compare floor as a thin outline
    const bandGeo = this.wallsGeo(T, 0.6); // unit-height walls, scaled per floor
    this.band = new THREE.Mesh(bandGeo, new THREE.MeshBasicMaterial({ color: pal.sun, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }));
    this.band.renderOrder = 3; scene.add(this.band);
    // x-ray: the chosen floor and the window stay faintly visible when a neighbour hides them
    this.bandX = new THREE.Mesh(bandGeo, new THREE.MeshBasicMaterial({ color: pal.sun, transparent: true, opacity: 0.22, depthWrite: false, depthTest: false, side: THREE.DoubleSide }));
    this.bandX.renderOrder = 8; this.band.add(this.bandX);
    this.cmpBand = new THREE.LineSegments(this.outlineGeo([data.ti], 0), new THREE.LineBasicMaterial({ color: pal.ink, transparent: true, opacity: 0.75 })); scene.add(this.cmpBand);
    this.cmpBand2 = this.cmpBand.clone(); scene.add(this.cmpBand2);

    // window marker, sun ray, blocker highlight, view cone
    this.marker = new THREE.Group();
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 2.3), new THREE.MeshBasicMaterial({ color: pal.sun, side: THREE.DoubleSide }));
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: pal.sun, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending }));
    halo.scale.set(26, 26, 1);
    const paneX = new THREE.Mesh(pane.geometry, new THREE.MeshBasicMaterial({ color: pal.sun, side: THREE.DoubleSide, transparent: true, opacity: 0.55, depthTest: false, depthWrite: false }));
    paneX.renderOrder = 9; this.marker.add(pane, halo, paneX); scene.add(this.marker);
    this.paneMat = pane.material; this.fan = new THREE.Group(); this.marker.add(this.fan); this.panes = [0];
    this.interior = null; this.inEye = null;
    this.rayMat = new THREE.MeshBasicMaterial({ color: pal.sun, transparent: true, opacity: 0.95, depthWrite: false });
    this.ray = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 1, 8, 1, true).translate(0, 0.5, 0), this.rayMat); this.ray.renderOrder = 4; scene.add(this.ray);
    this.hitDot = new THREE.Mesh(new THREE.SphereGeometry(2.2, 16, 12), new THREE.MeshBasicMaterial({ color: pal.bad })); scene.add(this.hitDot);
    this.blockEdges = null;
    this.coneMat = new THREE.MeshBasicMaterial({ color: pal.accent, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false });
    this.cone = new THREE.Mesh(new THREE.CircleGeometry(320, 48, 0, Math.PI * 2 / 3), this.coneMat); this.cone.rotation.x = -Math.PI / 2; scene.add(this.cone);

    // sun disc and glow (drawn far away, never fogged)
    this.sunDisc = this.skyObj.disc; this.sunGlow = this.skyObj.glow; scene.add(this.sunDisc, this.sunGlow);

    // height rings (Heights layer): 150 m and 300 m around the window, drawn on the ground
    this.rings = new THREE.Group();
    this.ringMat = new THREE.LineDashedMaterial({ color: pal.ink, dashSize: 6, gapSize: 4, transparent: true, opacity: 0.55, depthWrite: false });
    for (const r of [150, 300]) {
      const pts = Array.from({ length: 129 }, (_, k) => new THREE.Vector3(Math.cos((k / 128) * Math.PI * 2) * r, 0.4, Math.sin((k / 128) * Math.PI * 2) * r));
      const ln = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), this.ringMat); ln.computeLineDistances(); this.rings.add(ln);
    }
    this.rings.position.copy(this.center); scene.add(this.rings);

    // streets and proposed buildings
    this.streets = this.streetMesh(data.streets || []); if (this.streets) scene.add(this.streets);
    this.future = this.futureGroup(data.future || []); if (this.future) scene.add(this.future);
    this.buildGreen();
    this.buildLabels();
    this.applyOpts(); this.dirty = true;
  }

  /**
   * [city context] The street / sidewalk plate, the water, parks and lawns and the trees (unit/context3d.js): built
   * from the site file's streets, `water` and `green`, rebuilt on a theme change. Context only, never in the sun numbers.
   */
  buildGreen() {
    this.ctx = null; this.greenGrp = null;
    const o = this.opts;
    this.ctx = this.cityObj.buildContext({ pal: this.pal, quality: this.quality, layers: { green: o.green, water: o.water, streetTrees: o.streetTrees, parkTrees: o.parkTrees } });   // [city3d] the same context the studio draws
    if (this.ctx) {
      this.greenGrp = this.ctx.parts.green;
      if (this.lastSun) this.ctx.setSun({ dir: this.sunDir, alt: this.lastSun.alt });
      this.ctx.setInside(this.mode === 'in');
    }
    this.syncGroundBase();
  }
  /** The plate stands in for the base ground where it is on; the base drops under the water so the plate's holes show it. */
  syncGroundBase() { if (this.cityObj) { this.cityObj.layers = { ...this.cityObj.layers, water: this.opts.water }; this.cityObj.syncGroundBase(); } }
  /** [city context] Render quality from unit/quality3d.js: tree shadows (Visual) and the water's sky reflection and sun glint. */
  setContextQuality(q) { this.quality = { ...q, visual: !!q.visual, phone: !!q.phone }; this.ctx?.setQuality(this.quality); if (this.facU.uQual) this.facU.uQual.value = (q.fullFacades ?? q.visual) ? 1 : 0; this.dirty = true; }   // [massing] Visual: full facades
  distTo(b) { return Math.hypot((b.bb[0] + b.bb[2]) / 2 - this.cxy[0], (b.bb[1] + b.bb[3]) / 2 - this.cxy[1]); }
  // [city3d] the buildings are meshed by city3d/buildings.js (prismsOf is its single entry point), the same code the studio uses
  shapeOf(b) { return shapeOf(b); }
  prism(b, z0 = null, z1 = null, grow = 0) { return prism(b, z0, z1, grow); }
  prismsOf(b) { return prismsOf(b); }
  solidGeo(b) { return solidGeo(b); }
  /** Unit-height outward-offset walls (no caps) around b, for floor bands. */
  wallsGeo(b, off) {
    const P = [];
    for (const p of [b.p, ...(b.holes || [])]) {
      const n = p.length / 2; let area = 0;
      for (let i = 0; i < n; i++) { const j = (i + 1) % n; area += p[2 * i] * p[2 * j + 1] - p[2 * j] * p[2 * i + 1]; }
      const sg = (p === b.p ? 1 : -1) * (area > 0 ? 1 : -1);
      for (let j = 0; j < n; j++) {
        const j2 = (j + 1) % n, ax = p[2 * j], ay = p[2 * j + 1], bx = p[2 * j2], by = p[2 * j2 + 1], L = Math.hypot(bx - ax, by - ay) || 1;
        const ox = ((by - ay) / L) * off * sg, oy = (-(bx - ax) / L) * off * sg;
        const q = [[ax + ox, 0, ay + oy], [bx + ox, 0, by + oy], [bx + ox, 1, by + oy], [ax + ox, 1, ay + oy]];
        for (const t of [0, 1, 2, 0, 2, 3]) P.push(q[t][0], q[t][1], -q[t][2]);
      }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3)); return g;
  }
  heightColor(h) { return heightColor(this.pal, h); }
  /** Roof outlines plus vertical lines at real corners. */
  edgeGeo(idx, all = false) { return edgeGeo(this.data.B, idx, all); }
  outlineGeo(idx, z = 0.25) { return outlineGeo(this.data.B, idx, z); }
  streetMesh(streets) {
    if (!streets.length) return null;
    const P = [];
    for (const s of streets) {
      const pts = (s.pts || []).filter((q) => Array.isArray(q) && Number.isFinite(q[0]) && Number.isFinite(q[1]));
      const w = Math.max(1.4, Math.min(3.2, (+s.width_m || 12) * 0.12));
      for (let k = 0; k + 1 < pts.length; k++) {
        const [ax, ay] = pts[k], [bx, by] = pts[k + 1], L = Math.hypot(bx - ax, by - ay); if (L < 0.1) continue;
        const nx = (-(by - ay) / L) * w / 2, ny = ((bx - ax) / L) * w / 2;
        const q = [[ax + nx, ay + ny], [bx + nx, by + ny], [bx - nx, by - ny], [ax - nx, ay - ny]];
        for (const t of [0, 1, 2, 0, 2, 3]) P.push(q[t][0], 0.12, -q[t][1]);
      }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3));
    this.streetMat = new THREE.MeshBasicMaterial({ color: this.pal.street, transparent: true, opacity: this.pal.streetOp, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1 });
    const m = new THREE.Mesh(g, this.streetMat); m.renderOrder = 1; return m;
  }
  futureGroup(list) {
    if (!list.length) return null;
    const grp = new THREE.Group();
    this.futMat = new THREE.LineDashedMaterial({ color: this.pal.warn, dashSize: 4, gapSize: 3, transparent: true, opacity: 0.95 });
    this.futFill = new THREE.MeshBasicMaterial({ color: this.pal.warn, transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide });
    for (const f of list) {
      const ring = (f.ring || []).filter((q) => Array.isArray(q) && Number.isFinite(q[0]) && Number.isFinite(q[1])); const h = +f.h || 0;
      if (ring.length < 3 || h <= 0) continue;
      const P = [];
      for (let j = 0; j < ring.length; j++) {
        const [x, y] = ring[j], [x2, y2] = ring[(j + 1) % ring.length];
        P.push(x, 0.3, -y, x2, 0.3, -y2, x, h, -y, x2, h, -y2, x, 0.3, -y, x, h, -y);
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3));
      const ls = new THREE.LineSegments(g, this.futMat); ls.computeLineDistances(); grp.add(ls);
      const b = { p: ring.flat(), n: ring.length, holes: [], g: 0, top: h, bb: [0, 0, 0, 0] };
      const fill = new THREE.Mesh(this.prism(b, 0, h), this.futFill); fill.renderOrder = 2; grp.add(fill);
    }
    return grp;
  }

  // ---------------------------------------------------------------- labels (DOM glass chips)
  buildLabels() {
    this.labEl.innerHTML = ''; this.labels = [];
    const { T, lm = [], streets = [], future = [], ownLabel } = this.data;
    const add = (html, pos, cls, prio, extra = {}) => {
      const el = document.createElement('div'); el.className = 'u-lab ' + cls; el.innerHTML = html; this.labEl.append(el);
      this.labels.push({ el, pos, prio, cls, w: 0, h: 0, ...extra });
    };
    for (const l of lm) add(`<b>${esc(l.name)}</b><span>${Math.round(l.top)} m</span>`, W3(l.x, l.y, l.top + 6), 'lm', 2, { lm: l });
    add(`<b>${esc(ownLabel)}</b><span>${Math.round(T.top - T.g)} m</span>`, W3(this.cxy[0], this.cxy[1], T.top + 8), 'own', 5);
    // one label per street name at the point nearest the building
    const seen = new Map();
    for (const s of streets) {
      if (!s.name) continue;
      for (const q of s.pts || []) {
        if (!Array.isArray(q)) continue;
        const d = Math.hypot(q[0] - this.cxy[0], q[1] - this.cxy[1]);
        if (d < 360 && (!seen.has(s.name) || d < seen.get(s.name).d)) seen.set(s.name, { d, q });
      }
    }
    [...seen.entries()].sort((a, b) => a[1].d - b[1].d).slice(0, 10).forEach(([name, v]) => add(esc(name), W3(v.q[0], v.q[1], 2), 'street', 1));
    // [city context] the rivers and the large parks, by name
    for (const l of contextLabels({ water: this.data.water, green: this.data.green })) add(esc(l.name), W3(l.x, l.y, l.kind === 'water' ? 1 : 3), l.kind, 1.2);
    for (const f of future) {
      const ring = (f.ring || []).filter(Array.isArray); if (ring.length < 3) continue;
      const x = ring.reduce((a, q) => a + q[0], 0) / ring.length, y = ring.reduce((a, q) => a + q[1], 0) / ring.length;
      add(`<b>${esc(f.name || 'Proposed building')}</b><span>${Math.round(+f.h || 0)} m · ${esc(f.status || 'proposed')}</span>`, W3(x, y, (+f.h || 0) + 6), 'future', 3);
    }
    // roof heights for the Heights layer: the nearest buildings and the tallest within 300 m
    const { B } = this.data, rows = [];
    B.forEach((b, i) => { if (b === T) return; const d = this.distTo(b); if (d < 320) rows.push({ i, x: (b.bb[0] + b.bb[2]) / 2, y: (b.bb[1] + b.bb[3]) / 2, h: b.top - Math.max(b.g, 0), dist: d }); });
    for (const r of pickLabels(rows, { max: 22, near: 10, minSep: 30, radius: 300 })) add(`<b>${Math.round(r.h)} m</b>`, W3(r.x, r.y, B[r.i].top + 3), 'ht', 1.5, { bi: r.i });
    for (const r of [150, 300]) add(`${r} m`, W3(this.cxy[0] + r * Math.SQRT1_2, this.cxy[1] - r * Math.SQRT1_2, 1), 'ring', 1, { r });
    this.winLab = null;
    add('<b>Window</b><span></span>', new THREE.Vector3(), 'win', 9); this.winLab = this.labels[this.labels.length - 1];
    requestAnimationFrame(() => { for (const L of this.labels) { L.w = L.el.offsetWidth; L.h = L.el.offsetHeight; } this.dirty = true; });
  }
  placeLabels(cam) {
    const W = this.el.clientWidth, H = this.el.clientHeight, placed = [], v = new THREE.Vector3();
    const order = [...this.labels].sort((a, b) => b.prio - a.prio);
    // inside the apartment, a label only shows when the glass (not a wall or the ceiling) is in front of it
    const solid = this.mode === 'in' && this.interior ? (this.interior.blockers || []) : null;   // [room3d] the walls, floors and ceilings of the shared shell
    const rc = solid ? new THREE.Raycaster() : null;
    const walled = (pos) => { const d = pos.clone().sub(cam.position), L = d.length(); rc.set(cam.position, d.normalize()); rc.far = L; return rc.intersectObjects(solid, false).length > 0; };
    for (const L of order) {
      let show = this.opts.labels || L.cls === 'win';
      if (L.cls === 'street') show = show && this.opts.streets;
      if (L.cls === 'park') show = show && this.opts.green && this.mode !== 'win' && this.mode !== 'in';
      if (L.cls === 'water') show = show && this.opts.water && this.mode !== 'win' && this.mode !== 'in';   // [city context] (a label cannot be hidden by a building in front of it, so not from the windows)
      if (L.cls === 'future') show = show && this.opts.future;
      if (L.cls === 'ht' || L.cls === 'ring') show = show && this.opts.heights && this.mode !== 'in';
      if (L.cls === 'win') show = this.mode !== 'win' && this.mode !== 'in';
      if (L.cls === 'own' && this.mode === 'in') show = false;
      if (L.cls === 'own' && this.opts.target === 'hidden') show = false;
      if (L.lm && (this.mode === 'win' || this.mode === 'in')) { L.el.classList.toggle('dim', !!L.lm.hidden && !this.showHidden); }
      if (L.lm && L.lm.hidden && !this.showHidden && this.mode === 'in') show = false;
      if (show && solid && (L.cls === 'street' || L.cls === 'water' || L.cls === 'park' || walled(L.pos))) show = false;
      if (show) {
        v.copy(L.pos).project(cam);
        if (v.z > 1 || v.z < -1 || Math.abs(v.x) > 1.05 || Math.abs(v.y) > 1.05) show = false;
      }
      if (show) {
        const x = (v.x + 1) / 2 * W, y = (1 - v.y) / 2 * H, w = L.w || 80, h = L.h || 30;
        const r = L.cls === 'street' || L.cls === 'ring' || L.cls === 'water' || L.cls === 'park' ? [x - w / 2, y - h / 2, x + w / 2, y + h / 2] : [x - w / 2, y - h - 6, x + w / 2, y - 6];
        if (r[0] < 4 || r[2] > W - 4 || r[1] < 4 || r[3] > H - 4) show = L.cls === 'win' || L.cls === 'own' ? show : false;
        if (show && L.cls !== 'win' && placed.some((p) => r[0] < p[2] + 4 && r[2] > p[0] - 4 && r[1] < p[3] + 3 && r[3] > p[1] - 3)) show = false;
        if (show) { placed.push(r); L.el.style.transform = `translate(${Math.round(r[0])}px, ${Math.round(r[1])}px)`; L.sx = r[0]; L.sy = r[1]; }
      }
      L.el.classList.toggle('on', show); L.shown = show;
    }
  }

  // ---------------------------------------------------------------- per-frame state
  applyOpts() {
    const o = this.opts;
    this.renderer.shadowMap.enabled = o.shadows; this.sunL.castShadow = o.shadows;
    [this.bMat, this.groundMat, this.tMat].forEach((m) => (m.needsUpdate = true));
    if (this.streets) this.streets.visible = o.streets;
    if (this.future) this.future.visible = o.future;
    this.ctx?.setLayers({ green: o.green, water: o.water, streetTrees: o.streetTrees, parkTrees: o.parkTrees }); this.syncGroundBase();   // [city context]
    this.rings.visible = !!o.heights && this.mode !== 'win' && this.mode !== 'in';
    this.cone.visible = o.cone && this.mode !== 'win';
    const t = this.mode === 'in' ? 'hidden' : o.target;
    this.tMesh.visible = t !== 'hidden';
    this.tMat.opacity = t === 'faint' ? 0.2 : 1; this.tMat.depthWrite = t !== 'faint'; this.tMesh.castShadow = t === 'solid';
    this.tEdges.visible = t !== 'solid' && this.mode !== 'in'; this.tEdgeMat.opacity = t === 'hidden' ? 0.45 : 0.9;
    if (this.interior) this.interior.group.visible = this.mode === 'in' || o.target !== 'solid';
    this.dirty = true;
  }
  setPalette() {
    const pal = this.pal = this.livePalette();
    if (!this.scene) return;
    this.cityObj.setPalette(pal); this.skyU.gnd.value.copy(pal.ground);
    this.tMat.color.copy(pal.tBase); this.tEdgeMat.color.copy(pal.accent); this.tFoot.material.color.copy(pal.accent);
    this.cmpBand.material.color.copy(pal.ink); this.coneMat.color.copy(pal.accent);
    if (this.streetMat) { this.streetMat.color.copy(pal.street); this.streetMat.opacity = pal.streetOp; }
    this.ringMat.color.copy(pal.ink); this.facU.uLitCol.value.copy(pal.lit);
    this.buildGreen();
    this.recolor();
    if (this.lastSun) this.setSun(this.lastSun);
    this.dirty = true;
  }
  /** Vertex colours of the city: the continuous height ramp, or the height classes when the Heights layer is on. */
  recolor() {
    const pal = this.pal, cls = !!this.opts.heights;
    if (this.facU.uTintMix) this.facU.uTintMix.value = cls ? 0 : 1;   // [massing] the Heights layer shows its class colours, not wall palettes
    for (const m of this.city) {
      const colA = m.geometry.attributes.color, nor = m.geometry.attributes.normal.array, H = m.userData.h, memo = new Map();
      for (let v = 0; v < colA.count; v++) {
        let cr = memo.get(H[v]);
        if (!cr) { const c = cls ? pal.hcls[heightClass(H[v])].clone() : this.heightColor(H[v]); cr = [c, mix(c, pal.white, pal.light ? 0.25 : cls ? 0.12 : 0.08)]; memo.set(H[v], cr); }
        const cc = nor[v * 3 + 1] > 0.9 ? cr[1] : cr[0]; colA.setXYZ(v, cc.r, cc.g, cc.b);
      }
      colA.needsUpdate = true;
    }
    this.dirty = true;
  }
  /** CSS colours of the height classes for the 2D map legend (same as the 3D Heights layer). */
  classColors() { return this.pal.hcls.map((c) => '#' + c.getHexString()); }
  /**
   * Show building bi at a new height above its ground: its vertices in the merged city scale about the ground
   * (k = new height / original height; 0 flattens it), its edges and its height label follow. `B` is the edited
   * building list (sun.js format) the view now uses everywhere; `g` the building's ground.
   */
  setHeight(bi, k, g, B) {
    const r = this.vrange?.get(bi); if (!r) return;
    const [m, a, b] = r, pos = m.geometry.attributes.position, H = m.userData.h;
    if (!m.userData.y0) m.userData.y0 = Float32Array.from({ length: pos.count }, (_, v) => pos.getY(v));
    if (!m.userData.h0) m.userData.h0 = Float32Array.from(H);
    const y0 = m.userData.y0;
    for (let v = a; v < b; v++) { const y = y0[v]; pos.setY(v, y > g + 0.01 ? g + (y - g) * Math.max(0.004, k) : y); H[v] = m.userData.h0[v] * k; }
    pos.needsUpdate = true; m.geometry.computeBoundingSphere();
    this.data.B = B;
    this.edges.geometry.dispose(); this.edges.geometry = this.edgeGeo(this.edgeIdx);
    const L = this.labels.find((x) => x.cls === 'ht' && x.bi === bi);
    if (L) { const nb = B[bi]; L.el.querySelector('b').textContent = `${Math.round(nb.top - Math.max(nb.g, 0))} m`; L.pos.y = nb.top + 3; L.w = 0; requestAnimationFrame(() => { L.w = L.el.offsetWidth; }); }
    this.recolor();
    if (this.selEdges && this.selBi === bi) this.select(bi);
  }
  setFloorH(fh) { this.facU.uFloorH.value = Math.max(2.4, +fh || 3.2); this.dirty = true; }

  // ---------------------------------------------------------------- still renders (view studies)
  /** Hide the markers and overlays for clean study renders; `keepWindow` leaves the window marker and floor band. */
  beginStills(keepWindow = false) {
    // looking out of the window, this building is behind the camera: hide it so a 360° strip sees the city behind it
    this._stillVis = [this.marker, this.band, this.cmpBand, this.cmpBand2, this.ray, this.hitDot, this.cone, this.selEdges, this.blockEdges, this.interior?.group, this.rings, ...(keepWindow ? [] : [this.tMesh, this.tEdges, this.tFoot])].filter(Boolean).map((o) => [o, o.visible]);
    for (const [o] of this._stillVis) if (!(keepWindow && (o === this.marker || o === this.band))) o.visible = false;
    this._stillSun = this.lastSun;
  }
  endStills() {
    for (const [o, v] of this._stillVis || []) o.visible = v;
    this._stillVis = null;
    this.renderer.setViewport(0, 0, this.el.clientWidth, this.el.clientHeight);
    if (this._stillSun) this.setSun(this._stillSun);
    this.dirty = true; this.frame(true);
  }
  /** A window-style camera at local point w {x,y,z} looking along bearing az, tilted up `pitch`, vertical fov. */
  lookCam(w, az, pitch, vfov) {
    const c = this.stillCam; c.fov = vfov; c.near = 0.3; c.position.copy(W3(w.x, w.y, w.z));
    const a = az * DEG, p = pitch * DEG; c.up.set(0, 1, 0);
    c.lookAt(c.position.clone().add(new THREE.Vector3(Math.sin(a) * Math.cos(p), Math.sin(p), -Math.cos(a) * Math.cos(p))));
    return c;
  }
  /** The orbit or plan camera as it is now (for boards that keep the user's view). */
  currentCam() { return this.activeCam(); }
  /**
   * Render the scene with camera `cam` into the lower-left corner of the drawing buffer and copy it into ctx at
   * (dx, dy, dw, dh) in ctx units. The visible canvas is redrawn by endStills() before the browser paints.
   */
  drawStill(cam, ctx, dx, dy, dw, dh) {
    const r = this.renderer, pr = r.getPixelRatio(), cw = this.el.clientWidth, ch = this.el.clientHeight;
    const s = Math.min(1, cw / dw, ch / dh), w = Math.max(1, Math.floor(dw * s)), h = Math.max(1, Math.floor(dh * s));
    const aspect = dw / dh;
    if (cam.isPerspectiveCamera) { const a0 = cam.aspect; cam.aspect = aspect; cam.updateProjectionMatrix(); cam.userData.a0 = a0; }
    else { const o = { l: cam.left, r: cam.right, t: cam.top, b: cam.bottom }; const hh = (cam.top - cam.bottom) / 2, hw = hh * aspect; Object.assign(cam, { left: -hw, right: hw }); cam.updateProjectionMatrix(); cam.userData.o0 = o; }
    r.setViewport(0, 0, w, h); r.setScissor(0, 0, w, h); r.setScissorTest(true);
    const fog = this.scene.fog, ortho = !cam.isPerspectiveCamera || cam === this.orbitCam && this.mode === 'top';
    fog.near = ortho ? 1e5 : 1100; fog.far = ortho ? 2e5 : 4200;
    this.sky.position.copy(cam.position);
    r.render(this.scene, cam);
    r.setScissorTest(false);
    ctx.drawImage(this.cv, 0, this.cv.height - h * pr, w * pr, h * pr, dx, dy, dw, dh);
    if (cam.isPerspectiveCamera) { cam.aspect = cam.userData.a0 ?? cam.aspect; cam.updateProjectionMatrix(); }
    else if (cam.userData.o0) { const o = cam.userData.o0; Object.assign(cam, { left: o.l, right: o.r, top: o.t, bottom: o.b }); cam.updateProjectionMatrix(); }
  }
  /** Screen position (0..1, 0..1, visible) of a local point for camera cam with the given aspect. */
  project(cam, x, y, z, aspect) {
    if (cam.isPerspectiveCamera) { const a0 = cam.aspect; cam.aspect = aspect; cam.updateProjectionMatrix(); const v = W3(x, y, z).project(cam); cam.aspect = a0; cam.updateProjectionMatrix(); return { x: (v.x + 1) / 2, y: (1 - v.y) / 2, ok: v.z < 1 && v.z > -1 }; }
    const v = W3(x, y, z).project(cam); return { x: (v.x + 1) / 2, y: (1 - v.y) / 2, ok: true };
  }

  setSun(s) {
    this.lastSun = s; const pal = this.pal;
    const d = new THREE.Vector3(Math.sin(s.az * DEG) * Math.cos(s.alt * DEG), Math.sin(s.alt * DEG), -Math.cos(s.az * DEG) * Math.cos(s.alt * DEG));
    this.sunDir = d;
    const up = s.alt > 0, k = Math.max(0, Math.min(1, s.alt / 30));
    const focus = this.mode === 'in' && this.interior ? this.interior.group.position : this.center;
    this.sunL.target.position.copy(focus); this.sunL.target.updateMatrixWorld();
    this.sunL.position.copy(focus).addScaledVector(d, 2000);
    this.sunL.color.copy(mix(pal.sun, pal.white, 0.35 + 0.6 * k));
    this.sunL.intensity = up ? pal.sunMax * (0.35 + 0.65 * Math.sin((Math.min(Math.max(s.alt, 0), 60) / 60) * Math.PI / 2)) : 0;
    const { zen, hor } = applySky(this.skyObj, pal, s, d, this.center);   // [city3d]
    this.ctx?.setSun({ dir: d, alt: s.alt });   // [city context] the water's light
    this.scene.fog.color.copy(hor);
    // hemisphere light: the sky's hue at full brightness (its darkness is carried by the intensity)
    const tint = mix(hor, zen, 0.5), mx = Math.max(tint.r, tint.g, tint.b, 1e-3); tint.multiplyScalar(1 / mx);
    this.hemi.color.copy(mix(pal.white, tint, 0.3)); this.hemi.groundColor.copy(mix(pal.white, tint, 0.3)).multiplyScalar(0.45);
    this.hemi.intensity = up ? pal.hemiNight + (pal.hemiDay - pal.hemiNight) * Math.min(1, (s.alt + 2) / 14) : pal.hemiNight * (s.alt > -8 ? 1 : 0.85);
    // lit windows fade in through dusk
    this.facU.uNight.value = Math.max(0, Math.min(1, (3 - s.alt) / 9)) * (pal.light ? 0.75 : 1);
    this.applyRoomLook();   // [room3d]
    this.dirty = true;
  }
  /**
   * [room3d] The Inside and Window cameras are lit by the room's own light (room3d/lighting.js): a hemisphere sky light, a bounce fill, the sun with
   * its soft shadows, the windows' sky glow, ACES (Visual) or a gentle curve (Fast) and warm lamps after dark. It is the Floor plan studio's light
   * look, so the same room and the same city look the same in both engines. The orbit, plan and top cameras keep the sun-study lighting.
   */
  /** The studio's glass and blinds as light scales {sun, sky} (plan/light.js glazingScale), applied to the room's sun and the windows' glow. */
  setRoomScale(sc) { this.roomScale = sc && Number.isFinite(sc.sun) && Number.isFinite(sc.sky) ? { sun: sc.sun, sky: sc.sky } : undefined; this.applyRoomLook(); this.dirty = true; }
  roomLook() { return (this.mode === 'in' || this.mode === 'win') && !!this.lastSun; }
  applyRoomLook() {
    const r = this.renderer;
    if (!this.baseTone) this.baseTone = { mapping: r.toneMapping, exposure: r.toneMappingExposure };
    if (!this.roomLook()) {
      this.amb.intensity = 0; this.roomState = null;
      if (r.toneMapping !== this.baseTone.mapping) r.toneMapping = this.baseTone.mapping;
      r.toneMappingExposure = this.baseTone.exposure;
      for (const L of this.interior?.glow?.children || []) L.intensity = 0;
      if (this.interior?.glow) this.interior.glow.visible = false;   // a light that is off still costs every lit pixel: only the room's own cameras have the window glow
      return;
    }
    const s = this.lastSun, up = s.alt > 0, sin = Math.max(0, Math.sin(s.alt * DEG));
    const st = this.roomState = roomLightState({ mood: moodFor(this.moodWant || 'auto', up, sin), sunOn: up, sinAlt: sin, quality: roomQuality(), envLight: quality.has('environment'), tone: quality.settings.tone, scale: this.roomScale });
    applyRoomLight({ sunL: this.sunL, hemi: this.hemi, amb: this.amb, glow: this.interior?.glow, renderer: r }, st);
    if (this.interior?.glow) this.interior.glow.visible = quality.has('windowGlow');   // [quality] the step-down's level 4 takes the window glow lights out
    // lamps from the layout (floor and table lamps, pendants) come on after dark, like the studio's
    for (const g of this.interior?.furniture?.group.children || []) {
      const l = g.userData.lamp; if (!l) continue;
      l.light.intensity = st.lamps ? l.cd * st.lamps : 0; l.light.visible = st.lamps > 0;
      if (l.shade) l.shade.material.emissiveIntensity = st.lamps ? (st.lamps === 1 ? 1.4 : 1) : 0;
    }
    this.facU.uNight.value = st.lamps === 1 ? 1 : st.lamps ? Math.max(this.facU.uNight.value, 0.5) : this.facU.uNight.value;
  }
  /** w: {x,y,z,fx,fy}, az: window bearing; floorZ / cmpZ: slab heights; fh floor height. */
  setWindow(w, az, floorZ, cmpZ, fh, label, panes = [0]) {
    this.win = { ...w, az, floorZ }; this.setPanes(panes);
    const n = new THREE.Vector3(Math.sin(az * DEG), 0, -Math.cos(az * DEG));
    this.marker.position.copy(W3(w.fx, w.fy, w.z)).addScaledVector(n, 0.35);
    this.marker.lookAt(this.marker.position.clone().add(n));
    this.band.position.y = floorZ; this.band.scale.set(1, Math.max(0.6, fh * 0.92), 1);
    this.cmpBand.position.y = cmpZ; this.cmpBand2.position.y = cmpZ + fh;
    this.rings.position.copy(W3(w.x, w.y, 0));
    for (const L of this.labels) if (L.cls === 'ring') L.pos.copy(W3(w.x + L.r * Math.SQRT1_2, w.y - L.r * Math.SQRT1_2, 1));
    this.cone.position.copy(W3(w.x, w.y, w.z)); this.cone.rotation.z = (90 - az) * DEG - Math.PI / 3;
    this.placeInterior();
    if (this.winLab) { this.winLab.pos.copy(W3(w.fx, w.fy, w.z + 3)); this.winLab.el.querySelector('span').textContent = label; this.winLab.w = 0; requestAnimationFrame(() => { this.winLab.w = this.winLab.el.offsetWidth; this.winLab.h = this.winLab.el.offsetHeight; }); }
    this.dirty = true;
  }
  /** Sun ray from the window: to the sky when lit, to the wall that blocks it otherwise. */
  setRay(state, hit) {
    const show = this.opts.ray && this.win && this.lastSun && this.lastSun.alt > 0 && state !== 'behind';
    this.ray.visible = !!show && this.mode !== 'win' && this.mode !== 'in'; this.hitDot.visible = false;
    if (this.blockEdges) { this.scene.remove(this.blockEdges); this.blockEdges.geometry.dispose(); this.blockEdges = null; }
    if (!show) { this.dirty = true; return; }
    const o = W3(this.win.x, this.win.y, this.win.z), d = this.sunDir;
    let len = 520;
    if (hit) { len = hit.dist / Math.max(0.05, Math.cos(this.lastSun.alt * DEG)); this.hitDot.position.copy(o).addScaledVector(d, len); this.hitDot.visible = this.mode !== 'win' && this.mode !== 'in'; }
    this.ray.position.copy(o); this.ray.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d); this.ray.scale.set(1, len, 1);
    this.rayMat.color.copy(hit ? this.pal.bad : this.pal.sun);
    if (hit && hit.bi != null && hit.bi !== this.data.ti && this.data.B[hit.bi] && this.mode !== 'win' && this.mode !== 'in') {
      this.blockEdges = new THREE.LineSegments(this.edgeGeo([hit.bi], true), new THREE.LineBasicMaterial({ color: this.pal.bad, transparent: true, opacity: 0.9 }));
      this.blockEdges.renderOrder = 6; this.scene.add(this.blockEdges);
    }
    this.dirty = true;
  }
  /** Bay window: one pane per bearing offset, as a small fan of glass with short rays out of each pane. */
  setPanes(panes) {
    const key = (panes || [0]).join(',');
    if (this.fan.userData.key === key) return;
    this.fan.userData.key = key; this.panes = panes || [0];
    while (this.fan.children.length) { const c = this.fan.children.pop(); c.geometry?.dispose(); }
    if (this.panes.length < 2) { this.marker.children[0].visible = this.marker.children[2].visible = true; this.dirty = true; return; }
    this.marker.children[0].visible = this.marker.children[2].visible = false;
    const lineMat = this.fanLine || (this.fanLine = new THREE.LineBasicMaterial({ color: this.pal.sun, transparent: true, opacity: 0.85, depthWrite: false }));
    const maxO = Math.max(...this.panes.map((o) => Math.abs(o))) || 45;
    for (const o of this.panes) {
      const side = o === 0 ? 0 : -Math.sign(o), wPane = o === 0 ? 2.2 : 1.3;
      const g = new THREE.PlaneGeometry(wPane, 2.3), m = new THREE.Mesh(g, this.paneMat);
      m.position.set(side * (1.1 + 0.45 * Math.abs(o) / maxO), 0, o === 0 ? 0.9 : 0.45); m.rotation.y = -o * DEG; this.fan.add(m);
      const n = new THREE.Vector3(Math.sin(-o * DEG), 0, Math.cos(-o * DEG));
      const a = m.position.clone(), b = a.clone().addScaledVector(n, 14);
      this.fan.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), lineMat));
    }
    this.dirty = true;
  }

  // ---------------------------------------------------------------- the apartment inside the city
  /** info: buildInterior() result, or null to remove it. */
  setInterior(info) {
    if (this.interior) { this.scene.remove(this.interior.group); disposeTree(this.interior.group); }
    this.interior = info || null;
    if (info) { this.scene.add(info.group); this.placeInterior(); }
    this.applyMode(); this.dirty = true;
  }
  /** Put the shell at the window's facade point, slab height and facade bearing (walls 0.15 m inside the outline). */
  placeInterior() {
    if (!this.interior || !this.win) return;
    const w = this.win, az = w.az, nx = Math.sin(az * DEG), ny = Math.cos(az * DEG);
    this.interior.group.position.copy(W3(w.fx - nx * 0.15, w.fy - ny * 0.15, w.floorZ));
    this.interior.group.rotation.set(0, -az * DEG, 0);
    this.interior.group.updateMatrixWorld(true); this.dirty = true;
  }
  /** Standing point and look bearing for the interior camera at window k of the shell. */
  setInteriorEye(k) {
    const I = this.interior; if (!I) return;
    const w = I.windows[k] || I.windows.find((x) => x.facade) || I.windows[0];
    if (!w) { this.inEye = null; return; }
    this.inEye = { local: new THREE.Vector3(w.eye[0], 1.6, w.eye[1]), off: w.bearingOff };
    this.dirty = true;
  }

  /**
   * [interior] Stand at an Inside viewpoint (unit/inside-views.js): its place, direction and lens. With `animate` the camera
   * glides there (about 0.75 s, none when the renter prefers reduced motion); between rooms the walls and ceiling step aside
   * while it moves, so the camera never cuts through a wall.
   */
  setInteriorView(v, o = {}) {
    const I = this.interior; if (!I || !v) return;
    const to = { local: new THREE.Vector3(v.local[0], v.h, v.local[1]), off: v.off, yaw: 0, fov: v.fov, pitch: 6 + v.pitch };
    const from = this.inEye ? { local: this.inEye.local.clone(), off: this.inEye.off, yaw: this.look.yaw, fov: this.look.fov, pitch: this.look.pitch } : null;
    const still = o.animate === false || !from || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
    this.endInTween(false);
    if (still) { this.inEye = { local: to.local, off: to.off }; Object.assign(this.look, { yaw: to.yaw, fov: to.fov, pitch: to.pitch }); this.dirty = true; o.onEnd?.(); return; }
    this.inTween = { t0: performance.now(), ms: o.ms ?? 750, from, to, onEnd: o.onEnd, open: !!o.open };
    if (o.open) I.group.traverse((m) => { if (m.name === 'wall' || m.name.startsWith('ceiling')) { m.userData.wasVisible = m.visible; m.visible = false; } });
    this.dirty = true;
  }
  /** Finish or cancel a glide (restores the walls). `land`: jump to the end pose. */
  endInTween(land = true) {
    const tw = this.inTween; if (!tw) return;
    this.inTween = null;
    this.interior?.group.traverse((m) => { if ('wasVisible' in m.userData) { m.visible = m.userData.wasVisible; delete m.userData.wasVisible; } });
    if (land) { this.inEye = { local: tw.to.local.clone(), off: tw.to.off }; Object.assign(this.look, { yaw: tw.to.yaw, fov: tw.to.fov, pitch: tw.to.pitch }); }
    this.dirty = true; tw.onEnd?.();
  }
  stepInTween() {
    const tw = this.inTween; if (!tw) return;
    const k = Math.min(1, (performance.now() - tw.t0) / Math.max(1, tw.ms)), e = k < 0.5 ? 4 * k * k * k : 1 - ((-2 * k + 2) ** 3) / 2;
    if (!this.inEye) this.inEye = { local: tw.from.local.clone(), off: tw.from.off };
    this.inEye.local.lerpVectors(tw.from.local, tw.to.local, e);
    this.inEye.off = tw.from.off + (((((tw.to.off - tw.from.off) % 360) + 540) % 360) - 180) * e;
    this.look.fov = tw.from.fov + (tw.to.fov - tw.from.fov) * e; this.look.yaw = tw.from.yaw * (1 - e); this.look.pitch = tw.from.pitch + (tw.to.pitch - tw.from.pitch) * e;
    this.dirty = true;
    if (k >= 1) this.endInTween(true);
  }

  select(bi) {
    this.selBi = bi;
    if (this.selEdges) { this.scene.remove(this.selEdges); this.selEdges.geometry.dispose(); this.selEdges = null; }
    if (bi != null && this.data.B[bi]) {
      this.selEdges = new THREE.LineSegments(this.edgeGeo([bi], true), new THREE.LineBasicMaterial({ color: this.pal.ink, transparent: true, opacity: 1, depthTest: false }));
      this.selEdges.renderOrder = 7; this.scene.add(this.selEdges);
    }
    this.dirty = true;
  }

  // ---------------------------------------------------------------- cameras
  resetOrbit(animate = true) {
    const { T } = this.data, h = T.top - Math.max(T.g, 0), az = (this.win?.az ?? 200) - 28;
    const dist = Math.max(300, h * 2.7), pos = this.center.clone().add(new THREE.Vector3(Math.sin(az * DEG) * dist, h * 0.9 + dist * 0.42, -Math.cos(az * DEG) * dist));
    const tgt = this.center.clone().setY(h * 0.42);
    this.moveTo(this.orbitCam, this.controls, pos, tgt, animate);
  }
  topDown(animate = true) {
    const { T } = this.data, h = T.top - Math.max(T.g, 0), H = Math.max(420, h * 3.4);
    this.moveTo(this.orbitCam, this.controls, this.center.clone().add(new THREE.Vector3(0, H, H * 0.004)), this.center.clone().setY(0), animate);
  }
  resetPlan() {
    this.planCam.position.copy(this.center).setY(3000); this.planCam.zoom = 1;
    this.planControls.target.copy(this.center); this.planCam.lookAt(this.center); this.planControls.update(); this.fitPlan();
  }
  fitPlan() {
    const W = this.el.clientWidth || 800, H = this.el.clientHeight || 500, R = 250, a = W / H;
    const hh = a >= 1 ? R : R / a, hw = hh * a;
    Object.assign(this.planCam, { left: -hw, right: hw, top: hh, bottom: -hh }); this.planCam.updateProjectionMatrix();
  }
  moveTo(cam, ctl, pos, tgt, animate) {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!animate || reduce) { cam.position.copy(pos); ctl.target.copy(tgt); ctl.update(); this.dirty = true; return; }
    this.tween = { cam, ctl, p0: cam.position.clone(), t0: ctl.target.clone(), p1: pos, t1: tgt, start: performance.now(), dur: 750 };
  }
  /** The window and Inside cameras look out at a bright day (the natural sky, the light colours of city, park and trees) whatever the dashboard's theme; the orbit, plan and top cameras keep the theme's. */
  eyeLevel() { return this.mode === 'in' || this.mode === 'win'; }
  livePalette() { return palette({ daylight: this.eyeLevel() }); }
  setMode(m) {
    const prev = this.mode; this.mode = m;
    if (this.scene && !!this.pal.daylight !== this.eyeLevel()) this.setPalette();   // [daylight] the city, park and sky change look with the camera
    this.controls.enabled = m === 'orbit' || m === 'top'; this.planControls.enabled = m === 'plan';
    if (m === 'top') this.topDown(prev !== 'plan' && prev !== 'win' && prev !== 'in');
    if (m === 'orbit' && (prev === 'top' || prev === 'orbit')) this.resetOrbit(true);
    if (m === 'plan') this.resetPlan();
    this.applyMode();
  }
  /** Per-mode visibility: inside the apartment the target prism, floor bands and window marker step aside
   *  and the sun's shadow camera tightens around the unit so the city's shadows land sharply on the floor. */
  applyMode() {
    const m = this.mode, inside = m === 'in';
    this.marker.visible = this.band.visible = m !== 'win' && !inside;
    this.cmpBand.visible = this.cmpBand2.visible = m === 'orbit' || m === 'top';
    if (this.interior) this.interior.group.visible = inside || this.opts.target !== 'solid';
    const sc = this.sunL.shadow.camera;
    if (inside && this.interior) {
      // bias is in shadow-depth units over a ~4 km range: keep it to a few centimetres so 20 cm walls and the
      // ceiling still cast (the city-scale bias would let the sun through them)
      const r = 34; Object.assign(sc, { left: -r, right: r, top: r, bottom: -r });
    } else {
      Object.assign(sc, { left: -560, right: 560, top: 560, bottom: -560 });
    }
    this.shadowBias();
    sc.updateProjectionMatrix();
    this.winCam.near = inside ? 0.05 : 0.3; this.winCam.updateProjectionMatrix();
    this.ctx?.setInside(inside);   // [city context] no tree shadows on the floor: the sun patches there follow the numbers, which ignore trees
    this.applyOpts();
    if (this.lastSun) this.setSun(this.lastSun);
  }
  /** The sun's shadow bias for the camera in use and the shadow type (set by applyMode, and again after the quality module rebuilds the shadow map). */
  shadowBias() {
    const L = this.sunL, inside = this.mode === 'in' && !!this.interior;
    if (inside) { L.shadow.normalBias = 0.02; L.shadow.bias = -0.000004; }
    else { L.shadow.normalBias = 0.6; L.shadow.bias = this.renderer.shadowMap.type === THREE.VSMShadowMap ? -0.0002 : -0.00035; }
  }
  activeCam() { return this.mode === 'win' || this.mode === 'in' ? this.winCam : this.mode === 'plan' ? this.planCam : this.orbitCam; }
  resize() {
    const w = this.el.clientWidth, h = this.el.clientHeight; if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    for (const c of [this.orbitCam, this.winCam]) if (c) { c.aspect = w / h; c.updateProjectionMatrix(); }
    if (this.planCam) this.fitPlan();
    this.dirty = true;
  }
  compassAz(cam) {
    const f = new THREE.Vector3(); cam.getWorldDirection(f);
    const v = Math.abs(f.y) > 0.97 ? new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion) : f;
    return ((Math.atan2(v.x, -v.z) / DEG) + 360) % 360;
  }
  /** Render if anything changed. Returns true when a frame was drawn. */
  frame(force = false) {
    if (!this.scene) return false;
    if (this.tween) {
      const tw = this.tween, k = Math.min(1, (performance.now() - tw.start) / tw.dur), e = 1 - Math.pow(1 - k, 3);
      tw.cam.position.lerpVectors(tw.p0, tw.p1, e); tw.ctl.target.lerpVectors(tw.t0, tw.t1, e); tw.ctl.update();
      if (k >= 1) this.tween = null; this.dirty = true;
    }
    if (this.inTween) this.stepInTween();   // [interior] the Inside camera gliding to another room
    if (this.mode === 'orbit' || this.mode === 'top') { if (this.controls.update()) this.dirty = true; }
    if (this.mode === 'plan') { if (this.planControls.update()) this.dirty = true; }
    if (!this.dirty && !force) return false;
    this.dirty = false;
    const cam = this.activeCam();
    // [inside] the Inside camera never stands anywhere but in the room: with no standing point yet it takes the first window's, and with no room built
    // (or no plan) it looks out of the window like the Window camera, instead of being left wherever the camera was last (the ground, with no view out)
    if (this.mode === 'in' && this.interior && !this.inEye && this.win) this.setInteriorEye(0);
    const outOfWindow = this.win && (this.mode === 'win' || (this.mode === 'in' && !(this.interior && this.inEye)));
    if (outOfWindow) {
      const az = (this.win.az + this.look.yaw) * DEG, pt = this.look.pitch * DEG;
      cam.position.copy(W3(this.win.x, this.win.y, this.win.z)); cam.fov = this.look.fov; cam.updateProjectionMatrix();
      cam.lookAt(cam.position.clone().add(new THREE.Vector3(Math.sin(az) * Math.cos(pt), Math.sin(pt), -Math.cos(az) * Math.cos(pt))));
    } else if (this.mode === 'in' && this.interior && this.inEye && this.win) {
      const az = (this.win.az + this.inEye.off + this.look.yaw) * DEG, pt = (this.look.pitch - 6) * DEG;
      cam.position.copy(this.interior.group.localToWorld(this.inEye.local.clone())); cam.fov = this.look.fov; cam.updateProjectionMatrix();
      cam.lookAt(cam.position.clone().add(new THREE.Vector3(Math.sin(az) * Math.cos(pt), Math.sin(pt), -Math.cos(az) * Math.cos(pt))));
    }
    const fog = this.scene.fog;
    if (this.mode === 'plan' || this.mode === 'top') { fog.near = 1e5; fog.far = 2e5; } else { fog.near = 1100; fog.far = 4200; }
    this.sky.position.copy(cam.position);
    this.renderer.render(this.scene, cam);
    this.placeLabels(cam);
    this.onCompass?.(this.compassAz(cam));
    return true;
  }
  /** Building index under a client point, or null. */
  pick(clientX, clientY) {
    const r = this.cv.getBoundingClientRect(), cam = this.activeCam();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    const rc = new THREE.Raycaster(); rc.setFromCamera(ndc, cam);
    const objs = [...this.city, ...(this.tMesh.visible ? [this.tMesh] : [])];
    const hit = rc.intersectObjects(objs, false)[0]; if (!hit) return null;
    if (hit.object === this.tMesh) return this.data.ti;
    const { starts, ids } = hit.object.userData, v = hit.face.a;
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= v) lo = mid; else hi = mid - 1; }
    return ids[lo];
  }
  /** [photo match] The model point under a client point, in site metres: {bi, x, y, z} (x east, y north, z up), or null for sky and ground. */
  pickPoint(clientX, clientY) {
    const r = this.cv.getBoundingClientRect(), cam = this.activeCam();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    const rc = new THREE.Raycaster(); rc.setFromCamera(ndc, cam);
    const objs = [...this.city, ...(this.tMesh.visible ? [this.tMesh] : [])];
    const hit = rc.intersectObjects(objs, false)[0]; if (!hit) return null;
    let bi = this.data.ti;
    if (hit.object !== this.tMesh) {
      const { starts, ids } = hit.object.userData, v = hit.face.a;
      let lo = 0, hi = starts.length - 1;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= v) lo = mid; else hi = mid - 1; }
      bi = ids[lo];
    }
    return { bi, x: hit.point.x, y: -hit.point.z, z: hit.point.y };
  }
  // ---------------------------------------------------------------- export
  /** Binary glTF of the city, this building, streets, park and lawn patches, proposed buildings and the apartment shell, with the
   *  model's provenance in the root's userData (extras). Y up, metres, origin at the site origin. */
  async exportGLB(meta = {}) {
    const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
    const root = new THREE.Group(); root.name = meta.name || 'site'; root.userData = meta;
    const city = new THREE.Group(); city.name = 'city';
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
    const plain = (g) => { const q = g.clone(); q.deleteAttribute('aFa'); q.deleteAttribute('aFb'); return q; };   // [massing] facade attributes are shader inputs, not model data
    this.city.forEach((m, i) => { const c = new THREE.Mesh(plain(m.geometry), mat); c.name = i ? 'city-far' : 'city-near'; city.add(c); });
    const t = new THREE.Mesh(plain(this.tMesh.geometry), new THREE.MeshStandardMaterial({ color: this.pal.accent, roughness: 0.6 })); t.name = 'this-building';
    root.add(city, t);
    if (this.streets) { const s = new THREE.Mesh(this.streets.geometry, new THREE.MeshStandardMaterial({ color: this.pal.street, roughness: 1 })); s.name = 'streets'; root.add(s); }
    // parks, lawns and paved playgrounds (every ground layer, flat vertex colours); the instanced canopies stay out of the file
    if (this.opts.green) this.greenGrp?.children.forEach((gp) => { if (gp.isMesh) { const g = new THREE.Mesh(gp.geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide })); g.name = gp.name === 'green-patches' ? 'green' : gp.name.replace('green-patches', 'green'); root.add(g); } });
    if (this.future) { const f = new THREE.Group(); f.name = 'proposed'; this.future.children.forEach((c) => { if (c.isMesh) f.add(new THREE.Mesh(c.geometry, new THREE.MeshStandardMaterial({ color: this.pal.warn, transparent: true, opacity: 0.35 }))); }); root.add(f); }
    if (this.interior) { const a = this.interior.group.clone(); a.visible = true; a.name = 'apartment'; a.traverse((o) => { o.visible = true; }); root.add(a); }
    const w = this.win;
    if (w) { const m = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 2.3), new THREE.MeshStandardMaterial({ color: this.pal.sun, emissive: this.pal.sun, side: THREE.DoubleSide })); m.position.copy(this.marker.position); m.quaternion.copy(this.marker.quaternion); m.name = 'window'; root.add(m); }
    root.updateMatrixWorld(true);
    return new Promise((res, rej) => new GLTFExporter().parse(root, res, rej, { binary: true }));
  }
  dispose() { if (this.scene) disposeTree(this.scene); this.controls?.dispose(); this.planControls?.dispose(); }
}
