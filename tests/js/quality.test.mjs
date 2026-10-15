// The shared render-quality control (dashboard/js/room3d/quality.js): the ladder of levels, the one remembered setting both 3D pages read and write,
// the pure automatic step-down driven by SIMULATED frame times (hysteresis, no flicker), and the budget reader. No browser, no three.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  settingsFor, featuresOf, FEATURES, MAX_LEVEL, LEVEL_COST, GOVERNOR, createGovernor, median, quality, cityQualityOf, sameLook,
  roomQuality, furnitureQuality, setRoomQuality, onRoomQuality, readMode, MODES, LEVELS,
} from '../../dashboard/js/room3d/quality.js';
import { renderBudget, sceneTextures, shadowBytes } from '../../dashboard/js/room3d/budget.js';
import { roomLightState } from '../../dashboard/js/room3d/lighting-core.js';

const memStore = (init = {}) => { const m = new Map(Object.entries(init)); return { get: (k, d) => (m.has(k) ? m.get(k) : d), set: (k, v) => m.set(k, v), m }; };

// ------------------------------------------------------------------ levels
test('level 0 is exactly what the mode asked for before there were levels', () => {
  const fast = settingsFor('fast', { dpr: 3 }), vis = settingsFor('visual', { maxTexture: 8192, dpr: 2 });
  assert.deepEqual([fast.pixelRatio, fast.shadowSize, fast.softShadows, fast.environment, fast.contact], [2, 2048, false, false, false]);
  assert.deepEqual([vis.pixelRatio, vis.shadowSize, vis.softShadows, vis.environment, vis.contact], [2, 4096, true, true, true]);
  assert.equal(fast.treeFraction, 1); assert.equal(vis.texScale, 1);
  assert.equal(fast.tone, 'reinhard'); assert.equal(vis.tone, 'aces'); assert.equal(fast.cityTone, 'none'); assert.equal(vis.cityTone, 'aces');
});

test('each level only takes things away: pixel ratio, shadows, trees and features never go up as the level rises', () => {
  for (const mode of ['fast', 'visual']) for (const phone of [false, true]) {
    let prev = settingsFor(mode, { phone, dpr: 3, maxTexture: 8192, level: 0 });
    for (let l = 1; l <= MAX_LEVEL; l++) {
      const s = settingsFor(mode, { phone, dpr: 3, maxTexture: 8192, level: l });
      assert.ok(s.pixelRatio <= prev.pixelRatio && s.shadowSize <= prev.shadowSize && s.treeFraction <= prev.treeFraction && s.texScale <= prev.texScale, `${mode} ${phone} L${l}`);
      const was = new Set(featuresOf(prev));
      for (const f of featuresOf(s)) assert.ok(was.has(f), `${f} appeared at level ${l} (${mode})`);
      prev = s;
    }
  }
});

test('the ladder follows the stages: pixel ratio, shadow map, trees and grass, facades and window glow, texture sizes', () => {
  const at = (l) => settingsFor('visual', { dpr: 3, maxTexture: 8192, level: l });
  assert.equal(at(1).pixelRatio, 1.25);
  assert.ok(at(2).shadowSize <= 1024 && at(2).softShadows === false && at(2).environment === false && at(2).contact === false);
  assert.ok(at(3).treeFraction === 0.5 && at(3).treeShadows === false && at(3).grassDetail === false && at(3).richFurniture === false);
  assert.ok(at(3).fullFacades && at(3).windowGlow, 'facades and window glow survive to level 3');
  assert.ok(at(4).fullFacades === false && at(4).windowGlow === false && at(4).waterGlint === false);
  assert.ok(at(5).texScale < 1 && at(5).pixelRatio === 1 && at(5).treeFraction === 0.25 && at(5).shadowSize <= 512);
  assert.equal(LEVELS.length, MAX_LEVEL + 1); assert.equal(LEVEL_COST.length, MAX_LEVEL + 1);
});

test('the tone mapping does not change when the level drops, so a lighter room is not a darker one', () => {
  for (let l = 0; l <= MAX_LEVEL; l++) assert.equal(settingsFor('visual', { level: l }).tone, 'aces');
  const full = roomLightState({ mood: 'day', quality: 'visual' }), stepped = roomLightState({ mood: 'day', quality: 'visual', envLight: false, tone: 'aces' });
  assert.equal(stepped.tone, 'aces'); assert.equal(stepped.exposure, full.exposure);
  assert.ok(stepped.hemiI > full.hemiI, 'without the environment light the hemisphere gives a little more');
  assert.deepEqual(roomLightState({ mood: 'day', quality: 'fast' }).tone, 'reinhard');
});

test('features: a documented list, unknown names are false, and the city takes the same settings', () => {
  for (const f of ['softShadows', 'environment', 'contactShadows', 'treeShadows', 'waterGlint', 'grassDetail', 'fullFacades', 'windowGlow', 'richFurniture', 'nightLights', 'nightGlow', 'skyDetail', 'finishDetail']) assert.ok(FEATURES.includes(f), f);
  quality._reset();
  assert.equal(quality.has('nightLights'), true); assert.equal(quality.has('softShadows'), false); assert.equal(quality.has('typo'), false);
  const c = cityQualityOf(settingsFor('visual', { level: 3 }));
  assert.deepEqual([c.visual, c.treeFraction, c.treeShadows, c.grassDetail, c.fullFacades], [true, 0.5, false, false, true]);
  assert.ok(sameLook(settingsFor('fast', { dpr: 1, level: 0 }), settingsFor('fast', { dpr: 1, level: 1 })), 'on a 1x screen level 1 changes nothing for Fast');
});

// ------------------------------------------------------------------ the pure step-down, with simulated frame times
// A device: a frame takes base x cost[level] (+ a small wobble), capped below at the 16.7 ms of a 60 Hz screen. Returns the log of changes.
function run(gov, { base, seconds = 60, t0 = 0, wobble = 0.06, device = null, onChange = () => {} }) {
  let t = t0; const log = [];
  const end = t0 + seconds * 1000;
  let i = 0;
  while (t < end) {
    const b = typeof base === 'function' ? base(t) : base;
    const cost = (device?.cost ?? LEVEL_COST)[gov.level];
    const work = b * cost * (1 + wobble * Math.sin(i * 1.7)), dt = Math.max(16.7, work);
    t += dt; i++;
    const r = gov.frame(dt, t, work);
    if (r) { log.push({ t, ...r }); onChange(r); }
  }
  return { log, t };
}

test('a fast device never steps down', () => {
  const g = createGovernor();
  const { log } = run(g, { base: 12, seconds: 120 });
  assert.equal(log.length, 0); assert.equal(g.level, 0);
});

test('a slow device steps down until frames fit under 40 ms, then stays put (no flicker)', () => {
  const g = createGovernor();
  const { log } = run(g, { base: 75, seconds: 180 });
  assert.ok(g.level >= 1, 'stepped down');
  assert.ok(log.every((c) => c.dir === 'down'), 'only down');
  assert.ok(log.length <= MAX_LEVEL, 'one step at a time, never back and forth');
  const settled = 75 * LEVEL_COST[g.level];
  assert.ok(settled <= GOVERNOR.downMs * 1.05, `settled at ${settled.toFixed(1)} ms`);
  // and a one-step-lighter level was NOT chosen when this one already fit: the previous level really was too slow
  assert.ok(75 * LEVEL_COST[g.level - 1] > GOVERNOR.downMs * 0.95);
});

test('a severe slowdown (a median over 90 ms) steps two levels at once, quickly', () => {
  const g = createGovernor();
  const { log } = run(g, { base: 160, seconds: 30 });
  assert.equal(log[0].dir, 'down'); assert.equal(log[0].to - log[0].from, 2);
  assert.ok(log[0].t < 4000, 'within a few seconds');
});

test('single long frames (a garbage collection, a shader compile) do not step down: the median decides', () => {
  const g = createGovernor();
  let t = 0, changes = 0;
  for (let i = 0; i < 400; i++) { const dt = i % 9 === 4 ? 320 : 16.7; t += dt; if (g.frame(dt, t, 8)) changes++; }
  assert.equal(changes, 0);
});

test('the first frames after a view opens or a level changes are ignored (shader compiles, buffer uploads)', () => {
  const g = createGovernor();
  g.reset(0);
  for (let i = 0; i < GOVERNOR.warm; i++) assert.equal(g.frame(900, i * 900, 900), null);
  assert.equal(g.samples, 0, 'warm-up frames are not samples');
  g.frame(16.7, 3000, 8); assert.equal(g.samples, 1);
});

test('it steps back up when there is headroom, but not before the hold time, and never to a level that would be too slow', () => {
  const g = createGovernor({ level: 3 }); g.reset(0);                    // a view just opened
  const dev = { base: 30 };                    // at level 3 a frame is 30 x 0.52 = 15.6 ms: plenty of room
  let { log, t } = run(g, { base: dev.base, seconds: 5, t0: 0 });
  assert.equal(log.length, 0, 'not within the 8 s hold');
  ({ log } = run(g, { base: dev.base, seconds: 60, t0: t }));
  assert.ok(log.length >= 1 && log.every((c) => c.dir === 'up'));
  // it stops where the next level up would be predicted over 28 ms
  const predictedNext = (l) => 30 * LEVEL_COST[l - 1];
  assert.ok(g.level === 0 || predictedNext(g.level) > 20, `stopped at level ${g.level}`);
});

test('a device that cannot hold the level above backs off: after an undone step-up the next one waits twice as long', () => {
  // frames are vsync-capped at 16.7 ms while light, but the level above costs 60 ms: the prediction (from the capped time) is wrong
  const cost = [1, 3.6, 3.6, 3.6, 3.6, 3.6];
  const g = createGovernor({ level: 1, cost: LEVEL_COST });
  const device = { cost: [3.6, 1, 1, 1, 1, 1] };                           // level 0 is 3.6x the cost of level 1
  const ups = [], downs = [];
  let t = 0, i = 0; const end = 600000;
  while (t < end) {
    const work = 16 * device.cost[g.level], dt = Math.max(16.7, work); t += dt; i++;
    const r = g.frame(dt, t, g.level === 0 ? work : 4);                   // at level 1 the draw call is cheap: it looks like headroom
    if (r) (r.dir === 'up' ? ups : downs).push(t);
  }
  assert.ok(ups.length >= 1 && downs.length >= 1, 'it tried');
  const gaps = ups.slice(1).map((u, k) => u - ups[k]);
  assert.ok(gaps.every((gap, k) => k === 0 || gap >= gaps[k - 1] * 1.4), `waits grow: ${gaps.map((x) => Math.round(x / 1000))} s`);
  assert.ok(ups.length <= 8, `at most a handful of attempts in ten minutes (${ups.length})`);
  assert.ok(g.hold > GOVERNOR.holdUpMs, 'the hold doubled');
});

test('thresholds are 20 ms apart: a device whose steady cost sits between them never changes level', () => {
  for (const ms of [22, 27, 33, 38]) {
    const g = createGovernor({ level: 2 });
    const { log } = run(g, { base: ms / LEVEL_COST[2], seconds: 300, wobble: 0.03 });
    assert.equal(log.length, 0, `${ms} ms`);
  }
});

test('levels that change nothing on this device are skipped via stepDown / stepUp', () => {
  const useful = [0, 2, 3, 5];                     // e.g. a 1x screen: the pixel-ratio and texture levels do nothing
  const down = (l) => useful.find((x) => x > l) ?? null, up = (l) => [...useful].reverse().find((x) => x < l) ?? null;
  const g = createGovernor({ stepDown: down, stepUp: up });
  const { log } = run(g, { base: 140, seconds: 120 });
  assert.ok(log.every((c) => useful.includes(c.to)));
  assert.equal(median([3, 1, 2]), 2); assert.equal(median([1, 2, 3, 4]), 2.5); assert.equal(median([]), 0);
});

test('the lightest level cannot go lower, and level 0 cannot go higher', () => {
  const g = createGovernor({ level: MAX_LEVEL });
  const { log } = run(g, { base: 5000, seconds: 30 });
  assert.equal(log.length, 0); assert.equal(g.level, MAX_LEVEL);
  const h = createGovernor(); run(h, { base: 5, seconds: 120 }); assert.equal(h.level, 0);
});

// ------------------------------------------------------------------ the shared setting
test('one remembered choice: the studio and Unit 3D read and write the same mode, and each hears the other', () => {
  quality._reset();
  const store = memStore({ 'render-quality': 'visual' });
  quality.bind(store);                                    // whichever page mounts first binds it
  assert.equal(quality.mode, 'visual'); assert.equal(roomQuality(), 'visual');
  const seen = [];
  const off = quality.onChange((s, ch) => seen.push([s.mode, ch.mode]));
  quality.bind(memStore());                               // the second page passes the same store: nothing changes
  assert.equal(quality.mode, 'visual'); assert.equal(seen.length, 0);
  assert.equal(quality.setMode('fast', { user: true }), true);
  assert.equal(store.get('render-quality'), 'fast');       // persisted
  assert.deepEqual(seen, [['fast', true]]);
  assert.equal(readMode(store), 'fast'); assert.equal(roomQuality(), 'fast');
  assert.equal(quality.setMode('fast'), false, 'no change, no notification');
  off();
});

test('the room-quality names the room code uses follow the mode and the furniture detail', () => {
  quality._reset(); quality.bind(memStore());
  const modes = []; const off = onRoomQuality((m) => modes.push(m));
  assert.equal(furnitureQuality(), 'fast');
  setRoomQuality('visual');
  assert.deepEqual(modes, ['visual']); assert.equal(furnitureQuality(), 'visual');
  quality.setDevice({ dpr: 3 });
  quality.setLevel(3, 'auto');                             // rich furniture goes at level 3: the furniture rebuilds simpler
  assert.equal(furnitureQuality(), 'fast'); assert.equal(modes.at(-1), 'visual'); assert.equal(modes.length, 2);
  quality.setLevel(0, 'auto'); assert.equal(furnitureQuality(), 'visual');
  off();
});

test('Force Visual pins full quality: the step-down stops, the pin is remembered, and choosing Fast turns it back on', () => {
  quality._reset();
  const store = memStore(); quality.bind(store); quality.setDevice({ dpr: 3 }); quality.setMode('visual', { user: true });
  quality.attach('unit', { renderer: () => null, scene: () => null, kick: () => {} });
  quality.setLevel(2, 'auto');
  assert.equal(quality.level, 2); assert.equal(quality.pinned, false);
  quality.forceVisual();
  assert.deepEqual([quality.mode, quality.level, quality.pinned], ['visual', 0, true]);
  assert.equal(store.get('render-pinned'), true); assert.equal(store.get('render-quality'), 'visual');
  // slow frames after the pin do nothing
  let t = 1000; for (let i = 0; i < 80; i++) { t += 120; assert.equal(quality.pulse('unit', t, true, 100), null); }
  assert.equal(quality.level, 0);
  quality._reset(); quality.bind(store);                    // a new visit
  assert.equal(quality.pinned, true); assert.equal(quality.level, 0);
  quality.setMode('fast', { user: true });
  assert.equal(quality.pinned, false); assert.equal(store.get('render-pinned'), false);
});

test('the engines drive it: slow frames step the shared level down, fast ones step it back up, and the level is remembered as a hint', () => {
  quality._reset();
  const store = memStore(); quality.bind(store); quality.setDevice({ dpr: 2 }); quality.setMode('visual', { user: true });
  let kicks = 0;
  quality.attach('plan', { renderer: () => null, scene: () => null, kick: () => { kicks++; } });
  const changes = []; quality.onChange((s, ch) => { if (ch.level) changes.push(s.level); });
  quality.opened('plan', 0);
  assert.ok(kicks >= 1, 'opening a view starts a timed burst of frames');
  let t = 100;
  const frames = (n, dt, work) => { for (let i = 0; i < n; i++) { t += dt; quality.pulse('plan', t, true, work); } };
  frames(20, 80, 20);                                       // 80 ms frames: a slow phone
  assert.ok(quality.level >= 1, `stepped down to ${quality.level}`);
  assert.deepEqual(changes[0], quality.level, 'subscribers heard it');
  assert.ok(store.get('render-level')?.level >= 1, 'remembered for the next visit');
  frames(60, 80, 20);
  const settled = quality.level; assert.ok(settled <= MAX_LEVEL);
  // a gap longer than 250 ms is idleness, not a slow frame
  const before = quality.level; t += 5000; quality.pulse('plan', t, true, 5); assert.equal(quality.level, before);
  // the device recovers: 16 ms frames for a minute
  t += 20000; frames(400, 16.7, 4);
  assert.ok(quality.level < settled, `stepped back up from ${settled} to ${quality.level}`);
  // the next visit starts from the remembered level and is measured again
  const level = quality.level; quality._reset(); quality.bind(store); quality.setDevice({ dpr: 2 });
  assert.equal(quality.level, level);
});

test('a remembered level older than two weeks is ignored, and a hold (a high-resolution export) pauses measuring', () => {
  quality._reset();
  const old = memStore({ 'render-level': { level: 3, at: Date.now() - 15 * 24 * 3600 * 1000 } });
  quality.bind(old); assert.equal(quality.level, 0);
  quality._reset();
  const fresh = memStore({ 'render-level': { level: 3, at: Date.now() - 3600 * 1000 } });
  quality.bind(fresh); assert.equal(quality.level, 3);
  quality.attach('unit', { renderer: () => null, scene: () => null, kick: () => {} });
  quality.hold(true);
  let t = 0; for (let i = 0; i < 80; i++) { t += 300; quality.pulse('unit', t, true, 200); }
  assert.equal(quality.level, 3, 'held: slow export frames are not a measurement');
  quality.hold(false);
});

test('bad stored values fall back safely', () => {
  quality._reset();
  quality.bind(memStore({ 'render-quality': 'weird', 'render-level': 'x', 'render-pinned': 'maybe' }));
  assert.equal(quality.mode, 'fast'); assert.equal(quality.level, 0);
  quality._reset();
  quality.bind({ get() { throw new Error('private window'); }, set() { throw new Error('private window'); } });
  assert.equal(quality.mode, 'fast');
  assert.doesNotThrow(() => quality.setMode('visual', { user: true }));
  assert.equal(MODES.visual.label, 'Visual');
});

// ------------------------------------------------------------------ the budget reader
test('renderBudget reads draw calls, triangles and an estimate of texture memory from a renderer and its scene', () => {
  const tex = (w, h, extra = {}) => ({ isTexture: true, image: { width: w, height: h }, ...extra });
  const shared = tex(1024, 1024), mask = tex(1024, 1024, { generateMipmaps: false });
  const scene = {
    environment: tex(256, 128), background: null,
    traverse(fn) {
      fn(this);
      fn({ material: [{ map: shared }, { map: shared, normalMap: tex(512, 512) }] });
      fn({ material: { uniforms: { uMask: { value: mask }, uOther: { value: 3 } } } });
      fn({ shadow: { map: { width: 2048, height: 2048 }, mapPass: {} } });
    },
  };
  const renderer = { info: { render: { calls: 321, triangles: 456789, lines: 10, points: 0 }, memory: { geometries: 40, textures: 6 } }, domElement: { width: 780, height: 1688 }, getPixelRatio: () => 2 };
  const b = renderBudget(renderer, scene);
  assert.deepEqual([b.draws, b.triangles, b.geometries, b.textures], [321, 456789, 40, 6]);
  assert.equal(sceneTextures(scene).length, 4, 'a texture used twice is counted once');
  const expected = (1024 * 1024 * 4 * 4 / 3) + 1024 * 1024 * 4 + 512 * 512 * 4 * 4 / 3 + 256 * 128 * 4 * 4 / 3;
  assert.ok(Math.abs(b.textureMB - expected / 1048576) < 0.02, `${b.textureMB} MB`);
  assert.equal(shadowBytes(scene), 2048 * 2048 * 20, 'a soft shadow map is two half-float targets and a depth buffer');
  assert.ok(b.memoryMB > b.textureMB && b.pixelRatio === 2 && b.canvas[0] === 780);
});
