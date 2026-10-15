// THE render-quality control of the 3D views, one module for both pages (Unit 3D and the Floor plan studio) and every shared mesh, light and
// shader. A look and a cost, never a measurement: no level changes a sun hour, a daylight number or a score.
//
// ---------------------------------------------------------------------------------------------------------------------------------------
// HOW TO USE IT (effects added by other modules sit BEHIND these levels)
//
//   import { quality } from '../room3d/quality.js';
//   quality.mode              'fast' | 'visual': the renter's choice, remembered in the browser (store key `render-quality`), the same on both pages
//   quality.level             0..5: how far the automatic step-down has lowered this device (0 = as chosen). Higher = lighter.
//   quality.has('nightLights')   true when the current mode and level allow the feature; ask it before building or switching on anything costly
//   quality.settings          the numbers: pixelRatio, shadowSize, treeFraction, texScale, tone, ... (see settingsFor)
//   quality.onChange((settings, change) => ...)    after any change of mode, level or pin; `change` = {mode, level, pinned} booleans; returns the unsubscribe
//
// FEATURES (quality.has(name)); on = the mode / level range in which it is available
//   softShadows       Visual, level 0-1      VSM soft shadows from the larger shadow map
//   environment       Visual, level 0-1      the procedural environment light
//   contactShadows    Visual (not a phone), level 0-1    contact shadows under furniture and along walls
//   fullFacades       Visual, level 0-3      the full facade shader (mullions, spandrels, glass reflection); Fast and level 4+ draw the grid and tint only
//   treeShadows       Visual, level 0-2      tree crowns cast shadows
//   waterGlint        Visual, level 0-3      the water's sky reflection and sun glint
//   grassDetail       Fast and Visual, level 0-2    metre- and blade-scale variation in the grass
//   windowGlow        Fast and Visual, level 0-3    the soft area lights each window lets in (they are real lights: they cost every lit pixel)
//   richFurniture     Visual, level 0-2      bevelled, tufted furniture with clutter (Fast: boxes and plain boards)
//   nightLights       Fast and Visual, level 0-3    NEW night-city lights: lit windows, street lamps, car lights (instanced points / emissive meshes)
//   nightGlow         Fast and Visual, level 0-1    NEW additive halos, bloom-like sprites and the sun / moon glow around the sky
//   skyDetail         Fast and Visual, level 0-2    NEW sky extras: stars, clouds, the year's sun path trail
//   finishDetail      Fast and Visual, level 0-3    NEW interior finishes: textured floors, wall relief, trim (level 4+ draws flat colours)
//   An unknown name answers false. Build the cheap version first and add the feature when `has()` says so; subscribe with onChange to add or remove it later.
//   Never put a number behind a feature: a level may take away a look, not a fact.
//
// LEVELS (automatic step-down; each includes the ones above it). Only a level that changes something on this device is used (on a 1x screen the
// pixel-ratio step is skipped), so the ladder is 0, then the next level that makes a difference.
//   1  pixel ratio capped at 1.25
//   2  shadow map 1024, plain (PCF) shadows, no environment light, no contact shadows, no glow sprites
//   3  half the trees, no tree shadows, no fine grass, simple furniture, no sky extras
//   4  simple facades, no window glow lights, no water glint, flat finishes, no night lights
//   5  small textures (the street and water maps at 1024 px), pixel ratio 1, a quarter of the trees, shadow map 512
//
// THE AUTOMATIC STEP-DOWN (createGovernor, pure and tested with simulated frame times). The engines call quality.pulse() once per animation frame
// and quality.opened() when a view opens. The first frames after a view opens (and a short probe every 45 s while it is open and idle) are timed;
// the median of the last 24 frame intervals above 40 ms steps one level down (two when it is above 90 ms). A step back up needs the median at or
// under 20 ms, a predicted cost of the lighter level's neighbour under 28 ms, 8 s since the last change, and a longer wait after every step-up that
// had to be undone (hysteresis: the thresholds are 20 ms apart and a flapping device doubles its wait). A pinned renter ("Force Visual") is never
// stepped down. The level the device settled at is remembered for 14 days as a hint, so the next visit starts there and is measured again.
//
// Pure parts (settingsFor, featuresOf, createGovernor, median) need no DOM and are tested in tests/js/quality.test.mjs.
import { TONE } from './lighting-core.js';
import { renderBudget } from './budget.js';

// ------------------------------------------------------------------ modes
export const MODES = {
  fast: { label: 'Fast', note: 'The standard view: the quickest to draw and the one phones start in.' },
  visual: { label: 'Visual', note: 'Soft shadows from a larger shadow map, an environment light and contact shadows (an ambient-occlusion approximation, not screen-space AO). A look, not extra evidence.' },
};
export const MAX_LEVEL = 5;
export const LEVELS = [
  { name: 'Full', note: 'As chosen.' },
  { name: 'Reduced resolution', note: 'The picture is drawn at a lower pixel ratio.' },
  { name: 'Simpler shadows', note: 'A smaller shadow map, plain shadows, no environment light.' },
  { name: 'Fewer trees', note: 'Half the trees, no tree shadows, plain grass, simple furniture.' },
  { name: 'Simpler buildings', note: 'Plain facades, no window glow lights.' },
  { name: 'Smallest', note: 'Small ground textures, a quarter of the trees, a 1x pixel ratio.' },
];
const KEY = 'render-quality', KEY_PIN = 'render-pinned', KEY_HINT = 'render-level';
const HINT_TTL_MS = 14 * 24 * 3600 * 1000;

/** A narrow or touch-first device: Fast is the default there, and Visual is lighter. */
export function phoneClass() {
  try { return matchMedia('(max-width: 760px)').matches || (matchMedia('(pointer: coarse)').matches && matchMedia('(max-width: 1100px)').matches); } catch { return false; }
}
/** Stored choice if any, else 'fast' (everywhere: Visual is always opt-in). `store` is app.js's {get,set}. */
export function readMode(store) {
  try { const v = store?.get(KEY, 'fast'); return v === 'visual' ? 'visual' : 'fast'; } catch { return 'fast'; }
}
export function saveMode(store, mode) { try { store?.set(KEY, mode === 'visual' ? 'visual' : 'fast'); } catch { /* private window: the choice lasts for the session */ } }

const clampLevel = (l) => Math.max(0, Math.min(MAX_LEVEL, Math.round(+l || 0)));

/**
 * Everything a mode and a level ask for. Pure, so it is testable. `phone` lowers Visual; `level` (0..5) is the automatic step-down.
 * Keys: mode, level, pixelRatio, shadowSize, softShadows, environment, contact, blurSamples/radius (Visual only), treeFraction (0..1),
 * grassDetail, fullFacades, treeShadows, waterGlint, windowGlow, richFurniture, texScale (1 | 0.67), tone ('aces' | 'reinhard': the room's light),
 * cityTone ('aces' | 'none': Unit 3D's sun-study view), nightLights, nightGlow, skyDetail, finishDetail.
 */
export function settingsFor(mode, { phone = false, maxTexture = 4096, dpr = 1, level = 0 } = {}) {
  const visual = mode === 'visual', lv = clampLevel(level), d = dpr || 1;
  const s = visual
    ? { mode: 'visual', shadowSize: Math.min(phone ? 2048 : 4096, maxTexture), softShadows: true, environment: true, contact: !phone, pixelRatio: Math.min(d, phone ? 1.5 : 2), blurSamples: phone ? 8 : 16, radius: phone ? 3 : 4 }
    : { mode: 'fast', shadowSize: Math.min(2048, maxTexture), softShadows: false, environment: false, contact: false, pixelRatio: Math.min(d, 2) };
  Object.assign(s, {
    level: lv, phone: !!phone, treeFraction: 1, grassDetail: true, fullFacades: visual, treeShadows: visual, waterGlint: visual, windowGlow: true, richFurniture: visual,
    texScale: 1, tone: visual ? TONE.visual : TONE.fast, cityTone: visual ? 'aces' : 'none', nightLights: true, nightGlow: true, skyDetail: true, finishDetail: true,
  });
  if (lv >= 1) s.pixelRatio = Math.min(s.pixelRatio, 1.25);
  if (lv >= 2) Object.assign(s, { shadowSize: Math.min(s.shadowSize, 1024), softShadows: false, environment: false, contact: false, nightGlow: false });
  if (lv >= 3) Object.assign(s, { treeFraction: 0.5, treeShadows: false, grassDetail: false, richFurniture: false, skyDetail: false });
  if (lv >= 4) Object.assign(s, { fullFacades: false, windowGlow: false, waterGlint: false, finishDetail: false, nightLights: false });
  if (lv >= 5) Object.assign(s, { texScale: 0.67, treeFraction: 0.25, pixelRatio: Math.min(s.pixelRatio, 1), shadowSize: Math.min(s.shadowSize, 512) });
  return s;
}
/** Feature name -> settings key. */
const FEATURE_KEY = {
  softShadows: 'softShadows', environment: 'environment', contactShadows: 'contact', treeShadows: 'treeShadows', waterGlint: 'waterGlint', grassDetail: 'grassDetail',
  fullFacades: 'fullFacades', windowGlow: 'windowGlow', richFurniture: 'richFurniture', nightLights: 'nightLights', nightGlow: 'nightGlow', skyDetail: 'skyDetail', finishDetail: 'finishDetail',
};
export const FEATURES = Object.keys(FEATURE_KEY);
/** The features switched on in `settings`. */
export function featuresOf(settings) { return FEATURES.filter((f) => !!settings[FEATURE_KEY[f]]); }
/**
 * What the shared city (city3d/city.js, unit/context3d.js) is told: the settings it acts on, with `visual` and `phone` kept for the code that only knows those two.
 * {visual, phone, fullFacades, treeShadows, waterGlint, environment, treeFraction, grassDetail, texScale}
 */
export const cityQualityOf = (s) => ({ visual: s.mode === 'visual', phone: s.phone, fullFacades: s.fullFacades, treeShadows: s.treeShadows, waterGlint: s.waterGlint, environment: s.environment, treeFraction: s.treeFraction, grassDetail: s.grassDetail, texScale: s.texScale });
/** True when two settings draw the same picture at the same cost (the level number aside). */
export const sameLook = (a, b) => JSON.stringify({ ...a, level: 0 }) === JSON.stringify({ ...b, level: 0 });

// ------------------------------------------------------------------ the automatic step-down (pure)
export const GOVERNOR = {
  downMs: 40,          // a median frame interval above this steps down
  severeMs: 90,        // ... and above this, two steps at once
  upMs: 20,            // a median at or under this may step up ...
  upPredictMs: 28,     // ... if the lighter neighbour is predicted under this (well under downMs: the hysteresis gap)
  window: 24,          // frames the median is taken over
  minDown: 10,         // frames needed before a step down (severeMin for a severe one)
  severeMin: 6,
  minUp: 20,           // frames needed before a step up (within one run: the window is cleared when the view has been idle)
  warm: 3,             // frames ignored after a view opens or a level changes (shader compiles, buffer uploads)
  holdUpMs: 8000,      // the least time at a level before a step back up; doubles after a step-up that was undone within flapMs
  maxHoldMs: 300000,
  flapMs: 30000,
};
/** Relative draw cost of each level (1 = full), for predicting whether a step back up would stay under the limit. */
export const LEVEL_COST = [1, 0.82, 0.66, 0.52, 0.42, 0.3];
export const median = (a) => { const s = [...a].sort((x, y) => x - y), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0; };

/**
 * The step-down / step-up decision as a pure state machine. Feed it the interval between two consecutive drawn frames (and the time the draw
 * call itself took, when known); it answers null or {from, to, dir: 'down' | 'up', median}.
 * opts: GOVERNOR overrides, `level` (start), `maxLevel`, `cost` (per level), `stepDown(l)` / `stepUp(l)` (the next useful level or null).
 */
export function createGovernor(opts = {}) {
  const c = { ...GOVERNOR, ...opts }, cost = opts.cost || LEVEL_COST, maxLevel = opts.maxLevel ?? MAX_LEVEL;
  const down = opts.stepDown || ((l) => (l < maxLevel ? l + 1 : null)), up = opts.stepUp || ((l) => (l > 0 ? l - 1 : null));
  let level = clampLevel(opts.level), skip = c.warm, dts = [], works = [], lastChange = -Infinity, lastDir = null, hold = c.holdUpMs;
  const restart = (t) => { dts = []; works = []; skip = c.warm; if (t != null) lastChange = t; };
  const change = (to, dir, t, med) => { const from = level; level = to; restart(t); lastDir = dir; return { from, to, dir, median: med }; };
  return {
    get level() { return level; },
    get hold() { return hold; },
    get samples() { return dts.length; },
    get median() { return median(dts); },
    /** A view opened (or the scene was rebuilt): forget the samples and ignore the warm-up frames. The level stays. */
    reset(t) { restart(t); },
    /** The view was idle and drew again: start a fresh run of samples without touching the time of the last change. */
    newRun() { dts = []; works = []; skip = c.warm; },
    /** Set the level from outside (the renter's choice, a remembered hint). */
    setLevel(l, t) { level = clampLevel(l); restart(t); },
    frame(dt, t, workMs) {
      if (!(dt > 0)) return null;
      if (skip > 0) { skip--; return null; }
      dts.push(dt); works.push(Number.isFinite(workMs) ? workMs : dt);
      if (dts.length > c.window) { dts.shift(); works.shift(); }
      const n = dts.length, med = median(dts);
      if ((n >= c.minDown && med > c.downMs) || (n >= c.severeMin && med > c.severeMs)) {
        let to = down(level);
        if (to == null) return null;
        if (med > c.severeMs) { const to2 = down(to); if (to2 != null) to = to2; }
        if (lastDir === 'up' && t - lastChange < c.flapMs) hold = Math.min(hold * 2, c.maxHoldMs);   // the step up did not hold: wait longer next time
        return change(to, 'down', t, med);
      }
      if (n >= c.minUp && med <= c.upMs && t - lastChange >= hold) {
        const to = up(level);
        if (to == null) return null;
        const est = Math.max(median(works), 0.75 * med), predicted = est * (cost[to] ?? 1) / (cost[level] ?? 1);
        if (predicted <= c.upPredictMs) return change(to, 'up', t, med);
      }
      return null;
    },
  };
}

// ------------------------------------------------------------------ the shared state
const st = {
  mode: 'fast', level: 0, pinned: false, store: null, device: null, cache: null, hold: 0,
  subs: new Set(), roomSubs: new Set(), engines: new Map(), gov: null, furn: 'fast',
};
const nowMs = () => { try { return performance.now(); } catch { return Date.now(); } };
function device() {
  if (!st.device) st.device = { phone: phoneClass(), maxTexture: 4096, dpr: (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1 };
  return st.device;
}
function settingsAt(mode, level) { const d = device(); return settingsFor(mode, { phone: d.phone, maxTexture: d.maxTexture, dpr: d.dpr, level }); }
function cur() { return st.cache || (st.cache = settingsAt(st.mode, st.level)); }
/** The next level up the ladder (dir +1) or down (-1) whose picture or cost differs from this one's on this device, or null. */
function nextLevel(level, dir) {
  const here = settingsAt(st.mode, level);
  for (let l = level + dir; l >= 0 && l <= MAX_LEVEL; l += dir) { if (!sameLook(settingsAt(st.mode, l), here)) return l; }
  return null;
}
function governor() {
  if (!st.gov) st.gov = createGovernor({ level: st.level, stepDown: (l) => nextLevel(l, 1), stepUp: (l) => nextLevel(l, -1) });
  return st.gov;
}
function emit(change) {
  st.cache = null;
  const s = cur();
  if (change.mode || change.level) {
    const f = s.richFurniture ? 'visual' : 'fast';
    if (change.mode || f !== st.furn) { st.furn = f; for (const fn of st.roomSubs) { try { fn(st.mode); } catch { /* a subscriber must not break the engine */ } } }
  }
  for (const fn of st.subs) { try { fn(s, change); } catch { /* a subscriber must not break the engine */ } }
}
const guard = (f) => { try { return f(); } catch { return undefined; } };
function saveHint() {
  guard(() => st.store?.set(KEY_HINT, st.level > 0 ? { level: st.level, at: Date.now() } : null));
}

/** Tell the store apart from "not bound yet"; the first store wins (both pages pass app.js's). */
function bind(store) {
  if (st.store || !store) return quality;
  st.store = store;
  const mode = readMode(store), pinned = !!guard(() => store.get(KEY_PIN, false));
  let level = 0;
  const hint = guard(() => store.get(KEY_HINT, null));
  if (!pinned && hint && typeof hint === 'object' && Number.isFinite(hint.level) && Date.now() - (+hint.at || 0) < HINT_TTL_MS) level = clampLevel(hint.level);
  const ch = { mode: mode !== st.mode, level: level !== st.level, pinned: pinned !== st.pinned };
  st.mode = mode; st.pinned = pinned; st.level = level; st.gov = null; st.furn = cur().richFurniture ? 'visual' : 'fast';
  emit({ ...ch, mode: true });
  // a phone turned sideways or a window dragged narrow changes what "a phone" means for the trees and textures
  guard(() => matchMedia('(max-width: 760px)').addEventListener('change', () => quality.setDevice({ phone: phoneClass() })));
  return quality;
}

function setMode(m, { persist = true, user = false } = {}) {
  const next = m === 'visual' ? 'visual' : 'fast';
  const ch = { mode: next !== st.mode, level: false, pinned: false };
  if (user && next === 'fast' && st.pinned) { st.pinned = false; ch.pinned = true; guard(() => st.store?.set(KEY_PIN, false)); }   // choosing Fast turns the automatic step-down back on
  if (persist) saveMode(st.store, next);
  if (!ch.mode && !ch.pinned) return false;
  st.mode = next; st.gov = null;
  if (user && st.level) { st.level = 0; ch.level = true; saveHint(); }   // a new choice starts from full and is measured again
  emit(ch);
  return true;
}
/** Visual at full quality, and no automatic step-down on this browser until Fast is chosen again. */
function forceVisual() {
  const ch = { mode: st.mode !== 'visual', level: st.level !== 0, pinned: !st.pinned };
  st.mode = 'visual'; st.level = 0; st.pinned = true; st.gov = null;
  saveMode(st.store, 'visual'); guard(() => st.store?.set(KEY_PIN, true)); saveHint();
  emit(ch);
}
/** Pin the current mode at full quality (the same for Fast) without changing it. */
function pin(on = true) {
  const ch = { mode: false, level: on && st.level !== 0, pinned: st.pinned !== !!on };
  st.pinned = !!on; if (on) st.level = 0; st.gov = null;
  guard(() => st.store?.set(KEY_PIN, st.pinned)); saveHint();
  if (ch.level || ch.pinned) emit(ch);
}
function setLevel(l, source = 'manual', t = nowMs()) {
  const lv = clampLevel(l);
  if (lv === st.level) return false;
  st.level = lv; const g = governor(); if (g.level !== lv) g.setLevel(lv, t);
  saveHint();
  emit({ mode: false, level: true, pinned: false, source });
  return true;
}

// ------------------------------------------------------------------ measuring: engines call attach / opened / pulse
const PROBE_FRAMES = 26, PROBE_MAX_MS = 6000, PERIOD_MS = 45000, GAP_MS = 250;
function attach(name, o) {
  const e = st.engines.get(name) || { last: 0, run: 0, probe: 0, probeEnd: 0, streamAt: 0, probeAt: 0, name };
  Object.assign(e, o); st.engines.set(name, e);
  return quality;
}
function startProbe(e, now) { e.probe = PROBE_FRAMES; e.probeEnd = now + PROBE_MAX_MS; e.probeAt = now; e.run = 0; e.kick?.(); }
/** A 3D view opened or its scene was rebuilt: time its first frames. */
function opened(name, now = nowMs()) {
  const e = st.engines.get(name); if (!e) return;
  governor().reset(now); e.run = 0; e.last = 0; e.streamAt = now;
  if (!st.pinned) startProbe(e, now);
}
/**
 * Called once per animation frame by an engine's loop while its view is visible. `drew`: a frame was drawn this time; `ms`: how long the draw call took.
 * The interval between two drawn frames less than 250 ms apart is a sample; a longer gap means the view was idle and starts a new run.
 * Returns the change when a step was taken, else null.
 */
function pulse(name, now, drew, ms) {
  const e = st.engines.get(name); if (!e) return null;
  if (st.hold > 0 || st.pinned) { e.last = drew ? now : e.last; e.run = 0; return null; }
  let res = null;
  if (drew) {
    const gap = e.last ? now - e.last : Infinity;
    e.last = now;
    if (gap < GAP_MS) {
      e.run++; e.streamAt = now;
      res = governor().frame(gap, now, ms);
      if (res) { setLevel(res.to, 'auto', now); e.run = 0; }
    } else { e.run = 0; governor().newRun(); }
    if (e.probe > 0) { e.probe--; if (e.probe > 0 && now < e.probeEnd) e.kick?.(); else e.probe = 0; }
  } else if (e.probe > 0 && now > e.probeEnd) e.probe = 0;
  else if (e.probe > 0) e.kick?.();
  else if (now - e.streamAt > PERIOD_MS && now - e.probeAt > PERIOD_MS) {
    // the view has been idle: a short timed burst, only when the page is in front
    let hidden = false; try { hidden = document.hidden; } catch { /* no document */ }
    if (!hidden) startProbe(e, now); else e.probeAt = now;
  }
  return res;
}
/** Pause measuring (a high-resolution export renders slow frames on purpose); calls nest. */
function hold(on) { st.hold = Math.max(0, st.hold + (on ? 1 : -1)); if (!st.hold) for (const e of st.engines.values()) { e.last = 0; e.run = 0; } }

export const quality = {
  get mode() { return st.mode; },
  get level() { return st.level; },
  get pinned() { return st.pinned; },
  /** The step-down is on (not pinned). */
  get auto() { return !st.pinned; },
  get settings() { return cur(); },
  get features() { return featuresOf(cur()); },
  /** The settings as the shared city takes them (cityQualityOf). */
  get city() { return cityQualityOf(cur()); },
  /** True when the current mode and level allow the feature (see the table at the top of this file). */
  has(name) { const k = FEATURE_KEY[name]; return !!k && !!cur()[k]; },
  levelName: () => LEVELS[st.level].name,
  bind, setMode, forceVisual, pin, setLevel, attach, opened, pulse, hold,
  /** Ask an attached engine to draw its next frame (the timed burst after a view opens; scripts/perf_check.py). */
  kick(name) { st.engines.get(name)?.kick?.(); },
  /** Tell the module what the GPU allows ({maxTexture, dpr, phone}); engines call it once their renderer exists. */
  setDevice(d = {}) { const o = device(); const n = { ...o, ...d }; if (JSON.stringify(n) === JSON.stringify(o)) return; st.device = n; st.cache = null; emit({ mode: false, level: false, pinned: false, device: true }); },
  /** Call fn(settings, change) after every change of mode, level or pin; returns the unsubscribe function. */
  onChange(fn) { st.subs.add(fn); return () => st.subs.delete(fn); },
  /** The draw calls, triangles and texture memory of each attached engine's last frame: the per-device budget (scripts/perf_check.py). */
  budget() {
    const out = {};
    for (const [name, e] of st.engines) { const r = e.renderer?.(), sc = e.scene?.(); if (r && sc) out[name] = { ...renderBudget(r, sc), mode: st.mode, level: st.level }; }
    return out;
  },
  /** For tests: forget everything (a new store, level 0, no engines). */
  _reset() { st.mode = 'fast'; st.level = 0; st.pinned = false; st.store = null; st.device = null; st.cache = null; st.hold = 0; st.gov = null; st.engines.clear(); st.subs.clear(); st.roomSubs.clear(); st.furn = 'fast'; },
};

// ------------------------------------------------------------------ the room's older names (the room's meshes and lights ask these)
/** 'fast' | 'visual': the chosen mode (tone, hemisphere level). Does not change when the step-down lowers the level. */
export const roomQuality = () => st.mode;
/** The furniture's detail: 'visual' only while the mode is Visual and the level still allows rich furniture. */
export const furnitureQuality = () => (cur().richFurniture ? 'visual' : 'fast');
/** Set the mode without remembering it (the engines' older entry point); true when it changed. */
export function setRoomQuality(m) { return setMode(m, { persist: false }); }
/** Call fn(mode) after the mode or the furniture's detail changes; returns the unsubscribe function. */
export function onRoomQuality(fn) { st.roomSubs.add(fn); return () => st.roomSubs.delete(fn); }

// read-only handle for headless checks (Playwright, scripts/perf_check.py): the page itself never reads it
try { if (typeof window !== 'undefined') window.__quality = quality; } catch { /* no window */ }
