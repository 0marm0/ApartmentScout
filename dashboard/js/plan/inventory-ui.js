// "Your furniture" in the Floor plan studio's Furniture tab: the renter's own pieces, which of them this layout holds,
// and the buttons that use or fit them. Pure string builders (no DOM access), so plan3d.js only wires the clicks.
import { esc } from '../util.js';
import { CATALOG } from './catalog.js';
import { fmtIn } from './model.js';
import { resolveLook, describeLook, lookBasis } from './looks.js';

const hex = (c) => `#${(c ?? 0x888888).toString(16).padStart(6, '0')}`;

/** Size line for a piece, e.g. `5'4" × 7' × 3'4"`. */
export const sizeOf = (p) => {
  const c = CATALOG[p.ref] || {};
  return `${fmtIn(p.w ?? c.w ?? 0)} × ${fmtIn(p.d ?? c.d ?? 0)}${p.h ?? c.h ? ` × ${fmtIn(p.h ?? c.h)}` : ''}`;
};

/**
 * The section. `inv` = a validated inventory, `held` = Set of piece ids the current layout holds,
 * `hasPreset` = the plan ships a layout named "your-furniture", `active` = that preset is the current one.
 */
export function inventoryHTML(inv, { held = new Set(), hasPreset = false, active = false } = {}) {
  if (!inv?.pieces?.length) return '';
  const n = inv.pieces.length, placed = inv.pieces.filter((p) => held.has(p.id)).length;
  const rows = inv.pieces.map((p) => {
    const c = CATALOG[p.ref] || {}, on = held.has(p.id), lk = resolveLook(p.look), mine = lookBasis(p.look) === 'renter';
    const looks = p.look ? ` · <span class="iv-look ${mine ? 'renter' : 'assumed'}" title="${mine ? 'The colour and material come from you' : 'A stand-in look: tell us the real one'}">${esc(describeLook({ color: p.look.color, material: p.look.material }))}${mine ? '' : ' (assumed)'}</span>` : '';
    return `<li class="iv-row${on ? ' on' : ''}"><span class="ps-sw" style="--c:${hex(lk?.color ?? c.color)}"></span>
      <span class="iv-t"><b>${esc(p.label || c.name || p.ref)}</b><small>${esc(sizeOf(p))}${looks}${p.note ? ` · ${esc(p.note)}` : ''}</small></span>
      ${on ? '<span class="pill good">In this layout</span>' : `<button type="button" class="btn ghost iv-add" data-inv-add="${esc(p.id)}">Add</button>`}</li>`;
  }).join('');
  return `<section class="iv" aria-label="Your furniture">
    <h3 class="label">${esc(inv.name || 'Your furniture')} <span>${n} piece${n === 1 ? '' : 's'}, real sizes</span></h3>
    <div class="iv-acts"><button type="button" class="btn${active ? '' : ' primary'}" data-inv-use ${active ? 'aria-pressed="true"' : ''}>${active ? 'Using your furniture' : hasPreset ? 'Use your furniture layout' : 'Fit your furniture here'}</button>
      <span class="iv-n">${placed} of ${n} placed</span></div>
    <ul class="iv-list">${rows}</ul>
    ${inv.source ? `<details class="iv-src"><summary>Where this list comes from</summary><p>${esc(inv.source)}</p></details>` : ''}
  </section>`;
}
