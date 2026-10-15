// Surface reflectance -> the 3D look. A VISUAL PREVIEW: the floor, wall and ceiling colours of the studio's 3D room
// are scaled in proportion to the reflectance the renter chose (linear colour, so an albedo ratio is a colour ratio).
// Nothing is changed while the reflectances still are the model defaults, so the standard look is the standard look.

const REF = { floor: 0.25, walls: 0.55, ceiling: 0.75 };   // the reflectances the built-in colours stand for
let state = null;

/** `rho` = {floor, walls, ceiling} reflectances, or null to restore the built-in colours. */
export function setSurfaceState(rho) {
  state = rho && ['floor', 'walls', 'ceiling'].every((k) => Number.isFinite(rho[k]) && rho[k] > 0 && rho[k] < 1) && ['floor', 'walls', 'ceiling'].some((k) => Math.abs(rho[k] - REF[k]) > 1e-6) ? { ...rho } : null;
}
export const surfaceState = () => state;

const scaled = (c, k) => { const o = c.clone().multiplyScalar(k); o.r = Math.min(1, o.r); o.g = Math.min(1, o.g); o.b = Math.min(1, o.b); return o; };

/** Theme colours (scene3d.themeColors) with the reflectance scaling applied; the same object when nothing was changed. */
export function applySurfaceTint(C) {
  if (!state) return C;
  const kf = state.floor / REF.floor, kw = state.walls / REF.walls, kc = state.ceiling / REF.ceiling;
  return { ...C, wall: scaled(C.wall, kw), ceiling: scaled(C.wall, 1.04 * kc), wood: scaled(C.wood, kf), tile: scaled(C.tile, kf), carpet: scaled(C.carpet, kf) };
}
