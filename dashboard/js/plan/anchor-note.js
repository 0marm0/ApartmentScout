// The Floor plan studio's note about where the plan sits in the city: the shared anchor (origin, rotation, slab datum,
// host facade, which plan window sits where) with each fact labelled source, measured or assumed, and whether the plan is
// placed at the window pinned in Unit 3D or at the site file's own window. Same record, same wording as Unit 3D's Model panel
// (unit/anchor.js). Pure HTML builders; plan3d.js owns the DOM.
import { buildAnchor, getPin } from '../unit/anchor.js';
import { anchorListHTML, pill } from '../unit/anchor-view.js';
import { esc } from '../util.js';

/** Placement facts the studio can state without building the full record: for the summary line. */
export function placementSummary(onSite, pin) {
  if (!onSite) return { text: 'not placed in the city', tone: 'assumed' };
  return pin ? { text: 'at the window pinned in Unit 3D', tone: 'measured' } : { text: 'at the site file’s window', tone: 'assumed' };
}

/**
 * The anchor note. args: {onSite (plan/city.js placePlan result), model (normalised plan), site, siteId, base, floor, planSource, open}.
 * With `open` false only the summary is built (the record needs one skyline-free pass over the plan windows, so it waits for the renter to ask).
 */
export function anchorNoteHTML({ onSite, model, site, siteId, base, floor, planSource = 'file', planLabel = '', open = false }) {
  if (!onSite) return '';
  const pin = getPin(siteId, { base }), ps = placementSummary(onSite, pin);
  let inner = '';
  if (open) {
    const P = site.provenance || {}, manual = !!pin;
    const rec = buildAnchor({
      site, siteId, B: onSite.B, T: onSite.T, face: onSite.face, t: onSite.t, az: onSite.az, floor, cal: onSite.cal, panes: Array.isArray(site.window?.panes) && site.window.panes.length > 1 ? site.window.panes : null,
      prov: { exposure: manual ? 'manual' : P.exposure || 'assumed', position: manual ? 'manual' : P.window_position || 'assumed', floor: manual ? 'manual' : P.floor || 'assumed' },
      plan: { model, source: planSource, label: planLabel }, ctx: onSite,
    });
    inner = `${anchorListHTML(rec)}
      <p class="ps-note faint">${pin ? 'This placement follows the window you pinned in Unit 3D.' : 'This placement follows the site file’s window. In Unit 3D, “Use this window in the Floor plan” pins another one.'} Where the unit sits along the facade is an assumption unless a source says otherwise.</p>
      <a class="btn sm ghost" href="#unit/${esc(siteId)}">Open in Unit 3D</a>`;
  }
  return `<details class="ps-anchor"${open ? ' open' : ''}><summary><span>Where this plan sits in the city</span>${pill(ps.tone, ps.text)}</summary>${inner}</details>`;
}
