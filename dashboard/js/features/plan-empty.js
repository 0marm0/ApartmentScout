// Empty states for the 3D views that start from a model file: Floor plan with no plan at all, and the notice when a
// link asks for a home that has no plan or site model (the view then shows another one, and says so).
import { byId, label } from '../app.js';
import { toast } from '../util.js';
import { emptyState } from './empty.js';

/** Show (or hide) the "No floor plans yet" card in place of the plan panes. The panes stay in the DOM so a plan
 *  imported later from the Layout menu finds everything it needs. */
export function planEmpty(show) {
  const main = document.querySelector('#view-plan .ps-main');
  if (!main) return;
  const panes = document.getElementById('psPanes'), time = document.getElementById('ptimePanel');
  const side = document.querySelector('#view-plan .ps-side'), grid = document.querySelector('#view-plan .ps-grid');
  let el = document.getElementById('psEmpty');
  if (!show) {
    if (el) el.hidden = true;
    if (panes) panes.style.display = '';
    if (time) time.style.display = '';
    if (side) side.style.display = '';
    if (grid) grid.style.gridTemplateColumns = '';
    return;
  }
  if (!el) { el = document.createElement('div'); el.id = 'psEmpty'; el.className = 'ps-empty'; main.prepend(el); }
  el.innerHTML = emptyState('plan', {
    title: 'Bring in a floor plan',
    body: 'Import a complete plan project from the Layout menu, or ask your research agent to prepare one from a dimensioned plan. Then you can place furniture at true size and watch the sun move through the room.',
    actions: '<a class="btn primary" href="#map">Back to the map</a><a class="btn" href="#research">Open Research</a>',
  });
  el.hidden = false;
  if (panes) panes.style.display = 'none';
  if (time) time.style.display = 'none';
  if (side) side.style.display = 'none';
  if (grid) grid.style.gridTemplateColumns = 'minmax(0, 1fr)';
}

/** A link asked for a home that has no `what` ("floor plan" or "site model"): say so instead of silently showing another one. */
export function missingNotice(what, id) {
  const L = id ? byId(id) : null;
  if (L) toast(`No ${what} for ${label(L)} yet: showing another home`);
}
