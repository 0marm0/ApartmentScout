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
 * `hidden` = the held ones that are hidden (a Show button), `removed` = the ones the renter took out (an Add back button),
 * `hasPreset` = the plan ships a layout named "your-furniture", `active` = that preset is the current one.
 */
export function inventoryHTML(inv, { held = new Set(), hidden = new Set(), removed = new Set(), hasPreset = false, active = false } = {}) {
  if (!inv?.pieces?.length) return '';
  const own = inv.pieces.filter((p) => !p.candidate), n = own.length, placed = own.filter((p) => held.has(p.id) && !hidden.has(p.id)).length;   // a candidate purchase is listed, but it is not one of the renter's pieces
  const act = (p, on) => {   // every piece the layout does not show has a way back: hidden -> Show, removed or never placed -> Add back / Add
    if (on && hidden.has(p.id)) return `<span class="pill">${p.candidate ? 'Candidate, hidden' : 'Hidden'}</span><button type="button" class="btn iv-add" data-inv-show="${esc(p.id)}" title="Show ${esc(p.label || p.ref)} again, where it was">Show</button>`;
    if (p.candidate && !on && !removed.has(p.id)) return '<span class="pill warn" title="A bed you may buy, not one you own: switch to it with the Bed control">Candidate</span>';
    if (p.candidate && on) return '<span class="pill warn" title="A bed you may buy, not one you own: switch to it with the Bed control">Candidate</span>';
    if (on) return '<span class="pill good">In this layout</span>';
    const back = removed.has(p.id);
    return `<button type="button" class="btn ghost iv-add" data-inv-add="${esc(p.id)}" title="${back ? 'Put it back where it was' : 'Place it in the layout'}">${back ? 'Add back' : 'Add'}</button>`;
  };
  const rows = inv.pieces.map((p) => {
    const c = CATALOG[p.ref] || {}, on = held.has(p.id), lk = resolveLook(p.look), basis = lookBasis(p.look), mine = basis === 'renter';
    const looks = p.look ? ` · <span class="iv-look ${basis}" title="${mine ? 'The colour and material come from you' : basis === 'manufacturer' ? 'Read from the maker\'s pictures' : 'A stand-in look: tell us the real one'}">${esc(describeLook({ color: p.candidate ? p.candidate.colour : p.look.color, material: p.look.material }))}${mine ? '' : basis === 'manufacturer' ? ' (maker\'s pictures)' : ' (assumed)'}</span>` : '';
    return `<li class="iv-row${on ? ' on' : ''}"><span class="ps-sw" style="--c:${hex(lk?.color ?? c.color)}"></span>
      <span class="iv-t"><b>${esc(p.label || c.name || p.ref)}</b><small>${esc(sizeOf(p))}${p.assumed?.length ? ` <span class="iv-assumed" title="You did not give this size: it is a stand-in until you do">(${esc(p.assumed.map((k) => ({ w: 'width', d: 'depth', h: 'height', elev: 'height off the floor' }[k] || k)).join(', '))} assumed)</span>` : ''}${looks}${p.note ? ` · ${esc(p.note)}` : ''}</small></span>
      ${act(p, on)}</li>`;
  }).join('');
  return `<section class="iv" aria-label="Your furniture">
    <h3 class="label">${esc(inv.name || 'Your furniture')} <span>${n} piece${n === 1 ? '' : 's'}, real sizes</span></h3>
    <div class="iv-acts"><button type="button" class="btn${active ? '' : ' primary'}" data-inv-use ${active ? 'aria-pressed="true"' : ''}>${active ? 'Using your furniture' : hasPreset ? 'Use your furniture layout' : 'Fit your furniture here'}</button>
      <span class="iv-n">${placed} of ${n} placed</span></div>
    <ul class="iv-list">${rows}</ul>
    ${inv.source ? `<details class="iv-src"><summary>Where this list comes from</summary><p>${esc(inv.source)}</p></details>` : ''}
  </section>`;
}
