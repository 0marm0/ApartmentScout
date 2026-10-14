// A suggested starting layout for plans that ship without presets: a typical one-bedroom kit placed with the
// auto-placer, and a rationale written from the same checks the studio shows. Pure (no DOM).
import { resolve } from './catalog.js';
import { fitKit } from './fit.js';
import { accessRoutes } from './route.js';

/** The kit: a bed with nightstands and a dresser per bedroom, a sofa, coffee table, wall TV and a dining table. */
export function starterKit(model) {
  const kit = [], beds = model.rooms.filter((r) => r.kind === 'bedroom').sort((a, b) => b.area - a.area);
  const add = (ref, roomKind, extra = {}) => { const id = `${ref}-${kit.filter((k) => k.ref === ref).length + 1}`; kit.push({ id, ref, x: 0, y: 0, rot: 0, roomKind, ...extra }); };
  if (beds.length) beds.slice(0, 2).forEach((_, i) => { add('queen-bed', 'bedroom'); if (i === 0) { add('nightstand', 'bedroom'); add('nightstand', 'bedroom'); add('dresser', 'bedroom'); } });
  else add('futon', 'living'); // a studio: the sleeper sofa is the bed
  if (beds.length) add('sofa-3', 'living');
  add('coffee-table', 'living'); add('tv-55', 'living');
  const living = model.rooms.filter((r) => ['living', 'dining'].includes(r.kind)).reduce((a, r) => a + r.sqft, 0);
  add(living > 230 || model.rooms.some((r) => r.kind === 'dining') ? 'dining-4' : 'dining-round', model.rooms.some((r) => r.kind === 'dining') ? 'dining' : 'living');
  if (model.rooms.some((r) => r.kind === 'office') || beds.length > 1) add('desk', model.rooms.some((r) => r.kind === 'office') ? 'office' : 'bedroom');
  return kit;
}

/**
 * Place the starter kit and explain the result.
 * @returns {{id:string, name:string, note:string, reasons:string[], items:object[], counts:object}}
 */
export function suggestLayout(model, step = 8) {
  const kit = starterKit(model).map((k) => ({ ...resolve(k), roomKind: k.roomKind }));
  const res = fitKit(model, kit, step);
  const items = res.items.map((p) => { const o = { id: p.id, ref: p.ref, x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10, rot: p.rot }; if (p.variant) o.variant = p.variant; return o; });
  const reasons = [], ev = res.ev;
  for (const it of res.items) {
    const r = ev.items[it.id]; if (!r || !['bed', 'sofa', 'table', 'desk'].includes(it.kind)) continue;
    const bad = r.issues.filter((x) => x.grade !== 'clear');
    reasons.push(`${it.name} in the ${(it._room || r.room || '').toLowerCase()}: ${bad.length ? bad[0].text.charAt(0).toLowerCase() + bad[0].text.slice(1) : it.kind === 'bed' ? 'headboard on a solid wall, a free side and the foot clear' : 'its clearances respected'}`);
  }
  for (const t of ev.tv) if (t.seats.length) { const best = t.seats.reduce((a, b) => (a.dist < b.dist ? a : b)); reasons.push(`TV ${(best.dist / 12).toFixed(1)} ft from the ${best.seat.toLowerCase()} (${best.tag})`); }
  const missing = Object.entries(res.rows).filter(([, r]) => r.grade === 'none').map(([id]) => kit.find((k) => k.id === id)?.name || id);
  if (missing.length) reasons.push(`No room found for: ${missing.join(', ').toLowerCase()}`);
  const routes = accessRoutes(model, res.items).routes.filter((r) => r.itemId);
  const worst = routes.reduce((a, r) => (!a || r.width < a.width ? r : a), null);
  if (worst) reasons.push(worst.reachable ? `Narrowest walk from the door: ${Number.isFinite(worst.width) ? `${Math.round(worst.width)} in` : 'open'} (to the ${worst.label.toLowerCase()})` : `The ${worst.label.toLowerCase()} cannot be reached from the door`);
  const c = res.counts, n = items.length;
  const note = `Auto-placed starter kit: ${c.clear} of ${n + (c.none || 0)} pieces clear${c.tight ? `, ${c.tight} tight` : ''}${c.blocked ? `, ${c.blocked} blocked` : ''}${c.none ? `, ${c.none} without a spot` : ''}. ${reasons.slice(0, 2).join('; ')}.`;
  return { id: 'suggested', name: 'Suggested starting layout', note, reasons, items, counts: c, auto: true };
}
