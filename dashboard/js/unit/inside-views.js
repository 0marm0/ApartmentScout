// The Inside camera's viewpoints: the plan's rooms (with bays and corners), the seats, and one that looks back into the
// room. They come from plan/viewpoints.js, the same list the Floor plan studio offers, expressed in the interior group's
// frame (metres from the centre of the facade windows; `off` = the direction relative to the facade in degrees clockwise)
// so Unit 3D can stand there and turn smoothly from one to the next. Pure: no DOM, no three.js.
import { allViews, windowGroups, turnBetween, dirAngle } from '../plan/viewpoints.js';

const M = 0.0254;
const DEG = Math.PI / 180;

/** Plan point (inches) -> interior-local metres [x, z] (unit/interior.js toLocal). */
const toLocal = (fr, p) => [(p[0] - fr.xc) * M, -(p[1] - fr.yw) * M];

/**
 * @param {object} plan   normalised plan
 * @param {object[]} items resolved furniture items (for the seats), or []
 * @param {{xc:number,yw:number}} fr  plan/city.js planFrame(plan)
 * @returns {{key,label,room,kind,local:number[],h:number,off:number,fov:number,pitch:number,win:number|null,seat?:string}[]}
 */
export function insideViews(plan, items, fr) {
  const groups = windowGroups(plan);
  const out = allViews(plan, items).map((v) => {
    const g = groups[v.group];
    return {
      key: v.key, label: v.label, room: v.room, kind: v.kind, seat: v.seat,
      local: toLocal(fr, v.at), h: v.h * M, off: dirAngle(v.dir), fov: v.fov, pitch: v.pitch / DEG,
      win: g ? g.panes[Math.floor(g.panes.length / 2)] : null,   // the window index the Inside state (st.inWin) stands for
    };
  });
  // looking back into the room from the main window, to see the layout and the light across it
  const main = out.find((v) => v.kind === 'room' && /living|bed/i.test(v.room)) || out.find((v) => v.kind === 'room');
  const mg = main ? groups[allViewsGroup(out, main, groups)] : null;
  if (main && mg) {   // 30 in inside the glass, facing the other way
    const at = [mg.mid[0] - mg.normal[0] * 30, mg.mid[1] - mg.normal[1] * 30];
    out.push({ key: 'into-room', label: 'Into the room', room: main.room, kind: 'inward', local: toLocal(fr, at), h: main.h, off: (dirAngle(mg.normal) + 180) % 360, fov: 78, pitch: 0, win: main.win });
  }
  return out;
}

/** Which window group a view belongs to (its `win` pane is in that group's panes). */
const allViewsGroup = (views, v, groups) => Math.max(0, groups.findIndex((g) => g.panes.includes(v.win)));

/** The view a stored window index stands for (the room view of that window's group), else the living room, else the first room. */
export function viewForWindow(views, win) {
  const rooms = views.filter((v) => v.kind === 'room');
  if (Number.isInteger(win) && win >= 0) { const hit = rooms.find((v) => v.win === win) || rooms.find((v) => v.win != null && Math.abs(v.win - win) <= 1); if (hit) return hit; }
  return rooms.find((v) => /living/i.test(v.room)) || rooms[0] || views[0] || null;
}

/** Interpolate two angles (degrees) the short way round. */
export const lerpAngle = (a, b, t) => a + turnBetween(a, b) * t;
