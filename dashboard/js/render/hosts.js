// What the photo and video renderers need from a 3D view, behind one small interface, for the two views that have renderers: Unit 3D (unit/scene.js UnitStage)
// and the Floor plan studio (plan/scene3d.js). A host owns the renderer while a render runs (`begin()` ... `end()`): the page's own loop and resize observer
// stand aside, the overlays that are not part of the picture (markers, outlines, the walk ring, labels) are hidden, and the sun disc is made bright enough to bloom.
//
//   host.renderer, host.scene, host.hemi, host.sun        three.js objects
//   host.camera()                                         the camera the view looks through
//   host.view()                                           {w, h}: the visible canvas in CSS pixels (the picture's aspect and size basis)
//   host.pose()                                           put the camera, haze and sky where the view's state says, without drawing
//   host.draw()                                           draw the scene into the render target that is bound
//   host.setAspect(a)                                     the camera's aspect (and an orthographic camera's extent) for a picture of a different shape
//   host.setOutput(w, h)                                  size the canvas for a video frame (pixel ratio 1); end() puts the view back
//   host.begin({boost}) / host.end()                      take the renderer over / give it back (boost: a bright sun disc, for the bloom)
//   host.skip() / host.aoRadius() / host.focus()          objects ambient occlusion ignores; its radius in metres; the distance to focus on (metres)
import * as THREE from 'three';
import { LOOK } from './photo.js';

const hideAll = (list) => list.map((o) => [o, o.visible]).filter(([o]) => o);

/** The distance from the camera to the first solid, opaque surface at the middle of the picture, or null. */
export function focusDistance(scene, cam, ignore = []) {
  const rc = new THREE.Raycaster(), skip = new Set(ignore);
  rc.setFromCamera(new THREE.Vector2(0, 0), cam);
  rc.far = 400;
  const pool = [];
  scene.traverse((o) => { if (o.isMesh && o.visible && !skip.has(o) && !o.material?.transparent && o.material?.side !== THREE.BackSide) pool.push(o); });
  const hit = rc.intersectObjects(pool, false).find((h) => h.distance > cam.near * 3);
  return hit ? hit.distance : null;
}

function overlays(scene, extra) {
  const hidden = [];
  scene.traverse((o) => { if ((o.isLine || o.isLineSegments) && o.visible) hidden.push([o, true]); });
  for (const o of extra) if (o && o.visible) hidden.push([o, true]);
  return hidden;
}

/** Unit 3D. `stage` is unit/scene.js UnitStage. */
export function unitHost(stage) {
  let hidden = [], disc = null, size0 = null;
  const host = {
    name: 'unit', renderer: stage.renderer, scene: stage.scene, hemi: stage.hemi, sun: stage.sunL, look: { ...LOOK },
    camera: () => stage.activeCam(),
    view: () => ({ w: stage.el.clientWidth || 800, h: stage.el.clientHeight || 500 }),
    pose: () => stage.poseCamera(),
    draw: () => { stage.renderer.render(stage.scene, stage.activeCam()); },
    setAspect(a) {
      const c = stage.activeCam();
      if (c.isPerspectiveCamera) c.aspect = a;
      else { const hh = (c.top - c.bottom) / 2; c.left = -hh * a; c.right = hh * a; }
      c.updateProjectionMatrix();
    },
    setOutput(w, h) { const r = stage.renderer; r.setPixelRatio(1); r.setSize(w, h, false); },
    skip: () => [stage.sky, stage.sunDisc, stage.sunGlow].filter(Boolean),
    aoRadius: () => (stage.mode === 'in' || stage.mode === 'win' ? 0.9 : 7),
    focus: () => focusDistance(stage.scene, stage.activeCam(), [stage.sky, stage.sunDisc, stage.sunGlow]),
    begin(o = {}) {
      stage.busy = true;
      size0 = { pr: stage.renderer.getPixelRatio() };
      hidden = overlays(stage.scene, [stage.marker, stage.band, stage.cmpBand, stage.cmpBand2, stage.ray, stage.hitDot, stage.cone, stage.selEdges, stage.blockEdges, stage.rings]);
      for (const [o] of hidden) o.visible = false;
      disc = stage.sunDisc?.material?.color.clone(); if (disc && o.boost !== false) stage.sunDisc.material.color.multiplyScalar(host.look.sunBoost);
    },
    end() {
      for (const [o] of hidden) o.visible = true;
      hidden = [];
      if (disc) stage.sunDisc.material.color.copy(disc);
      stage.busy = false; stage.renderer.setPixelRatio(size0?.pr ?? stage.renderer.getPixelRatio()); stage.resizeLater = false; stage.resize();
      stage.dirty = true; stage.frame(true);
    },
  };
  return host;
}

/** The Floor plan studio. `G3` is plan/scene3d.js. */
export function planHost(G3) {
  let hidden = [], disc = null, pr = 1;
  const P = () => G3.parts();
  const host = {
    name: 'plan', get renderer() { return P().renderer; }, get scene() { return P().scene; }, get hemi() { return P().hemi; }, get sun() { return P().sunL; }, look: { ...LOOK, skyShare: 0.5 },
    camera: () => P().cam,
    view: () => { const el = P().renderer.domElement; return { w: el.clientWidth || 800, h: el.clientHeight || 500 }; },
    pose: () => G3.poseForRender(),
    draw: () => { const { renderer, scene, cam } = P(); renderer.render(scene, cam); },
    setAspect(a) { const c = P().cam; c.aspect = a; c.updateProjectionMatrix(); },
    setOutput(w, h) { const r = P().renderer; r.setPixelRatio(1); r.setSize(w, h, false); },
    skip() { const s = P().scene, out = []; s.traverse((o) => { if (o.name === 'sky' || o.name === 'sun disc' || o.name === 'sun glow') out.push(o); }); return out; },
    aoRadius: () => (G3.viewMode() === 'eye' ? 0.8 : 1.2),
    focus: () => focusDistance(P().scene, P().cam, host.skip()),
    begin(o = {}) {
      G3.setBusy(true);
      const { renderer, scene, overlay, labels, proxies } = P();
      pr = renderer.getPixelRatio();
      hidden = overlays(scene, [overlay, labels, proxies, scene.getObjectByName('walk-marker')]);
      for (const [o] of hidden) o.visible = false;
      const d = scene.getObjectByName('sun disc'); disc = d ? { d, c: d.material.color.clone() } : null; if (disc && o.boost !== false) disc.d.material.color.multiplyScalar(host.look.sunBoost);
    },
    end() {
      for (const [o] of hidden) o.visible = true;
      hidden = [];
      if (disc) disc.d.material.color.copy(disc.c);
      P().renderer.setPixelRatio(pr); G3.setBusy(false); G3.resize(); G3.markDirty();
    },
  };
  return host;
}
