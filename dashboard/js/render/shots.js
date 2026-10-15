// What a video shows, frame by frame: a walk-through (render/tour.js) or the day passing outside one window. A sequence is plain data and
// functions of the frame number (`poseAt(i)`, `minuteAt(i)`), so a frame is the same whenever it is drawn. The two views then put a pose
// on their own camera (`applyUnitPose`, `applyPlanPose`). Pure except for those two, which only set numbers on the camera rigs.
import { planTour } from './tour.js';
import { windowStands } from '../plan/walkcore.js';
import { windowGroups } from '../plan/viewpoints.js';
import { dayRange } from '../city3d/timeplay.js';

const M = 0.0254;
const norm = (a) => ((a % 360) + 360) % 360;
const smooth = (t) => { const u = Math.max(0, Math.min(1, t)); return u * u * (3 - 2 * u); };
const bearing = (v) => norm((Math.atan2(v[0], v[1]) * 180) / Math.PI);

/** The walk-through as a sequence. Null when the plan has no walkable way in. */
export function tourSequence(model, space, { seconds = 16, fps = 30, fov, minSeconds } = {}) {
  const tour = planTour(model, space, { seconds, fov, minSeconds });
  if (!tour) return null;
  const n = Math.max(2, Math.round(tour.seconds * fps));
  return { kind: 'tour', tour, n, fps, seconds: n / fps, poseAt: (i) => tour.pose(Math.min(tour.seconds, i / fps)), minuteAt: () => null };
}

/** The window the day is watched from: the widest window group of the largest living room, else the widest of the plan. */
export function bestWindowStand(model, space) {
  const stands = windowStands(model, space), groups = windowGroups(model);
  if (!stands.length) return null;
  const len = (s) => groups[s.group]?.len || 0, room = (s) => (model.rooms.find((r) => r.name === s.room)?.kind === 'living' ? 1 : 0);
  return [...stands].sort((a, b) => room(b) - room(a) || len(b) - len(a))[0];
}

/**
 * The day from a window as a sequence: the camera stands back from the glass and sways a few degrees; the time runs from first light to last light.
 * @param {(min: number) => number} altAt the sun's altitude at a minute of the viewed date
 */
export function daySequence(model, space, altAt, { seconds = 14, fps = 30, from = 300, to = 1285, fov = 70 } = {}) {
  const st = bestWindowStand(model, space);
  if (!st) return null;
  const rng = dayRange(altAt, { from, to, step: 5, dawnAlt: -6, duskAlt: -6 }), n = Math.max(2, Math.round(seconds * fps)), yaw0 = bearing(st.dir);
  return {
    kind: 'day', n, fps, seconds: n / fps, range: rng, stand: st,
    poseAt: (i) => ({ at: st.at, yaw: norm(yaw0 + 4 * Math.sin((i / n) * Math.PI * 2 * 0.75)), pitch: -1 + 0.6 * Math.sin((i / n) * Math.PI), h: 63, fov }),
    minuteAt: (i) => { const u = i / (n - 1); return rng.start + (0.7 * u + 0.3 * smooth(u)) * (rng.end - rng.start); },
  };
}

/** Put a pose (plan inches, compass-style yaw, degrees) on Unit 3D's Inside camera. `frame` is the interior's {xc, yw}. */
export function applyUnitPose(stage, frame, p) {
  if (!stage.inEye) stage.setInteriorEye(0);
  const e = stage.inEye;
  e.local.set((p.at[0] - frame.xc) * M, p.h * M, -(p.at[1] - frame.yw) * M);
  e.off = norm(p.yaw); stage.look.yaw = 0; stage.look.pitch = 6 + p.pitch; stage.look.fov = p.fov;
}
/** The Inside camera as it is, to put back after a video. */
export function saveUnitCamera(stage) {
  return { eye: stage.inEye ? { local: stage.inEye.local.clone(), off: stage.inEye.off } : null, look: { ...stage.look } };
}
export function restoreUnitCamera(stage, s) {
  if (!s) return;
  stage.inEye = s.eye ? { local: s.eye.local.clone(), off: s.eye.off } : stage.inEye; Object.assign(stage.look, s.look); stage.dirty = true;
}
