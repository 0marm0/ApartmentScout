// Entry points to the New search wizard: the empty state when no data (or no listings) is loaded, and the ?new=1 / ?wizard=edit
// URL options. (New search and Edit criteria in the top-right menu call openWizard from js/app-menu.js.)
import { S } from './app.js';
import { $, esc } from './util.js';

const wizard = () => import('./wizard.js');
export const openWizard = async (o) => (await wizard()).openWizard(o);

// ------------------------------------------------------------------ empty state
const BOLT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M12 21s-6.5-5.9-6.5-11a6.5 6.5 0 0113 0c0 5.1-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.4"/></svg>';
function mountEmpty() {
  const host = $('work');
  if (!host || host.querySelector('.onb')) return;
  const hasSearch = !!S.crit0.search, name = S.crit0.search?.name;
  const el = document.createElement('div');
  el.className = 'onb'; el.setAttribute('role', 'region'); el.setAttribute('aria-label', 'Get started');
  el.innerHTML = `<div class="onb-card"><div class="mark">${BOLT}</div>
    <h2>${hasSearch ? `${esc(name || 'Your search')} has no listings yet` : 'Start an apartment search'}</h2>
    <p>${hasSearch ? 'The criteria are set. Add listings, let the tools score them, and this dashboard fills in: map, commute heat, ranking and records.' : 'Tell us what you want and the dashboard ranks every apartment against it, with door-to-door commutes, building records and the light in each unit. Set it up here, or let your AI agent interview you.'}</p>
    <ol class="onb-steps"><li><b>${hasSearch ? 'Criteria set' : 'Set your criteria'}</b><span>${hasSearch ? 'Edit them any time in the wizard.' : 'Places, budget, size, must-haves and what you care about. Two minutes in the wizard, or answer your agent\'s questions.'}</span></li>
      <li><b>Add listings</b><span>Ask your agent to search, or <code>apartmentscout import listings.csv</code>.</span></li>
      <li><b>Score and explore</b><span><code>apartmentscout all</code> builds the commute heat map and ranking, then reload.</span></li></ol>
    <div class="onb-acts">${hasSearch ? '<button type="button" class="btn primary" data-onb="edit">Edit criteria</button><button type="button" class="btn" data-onb="new">New search</button>' : '<button type="button" class="btn primary" data-onb="new">Start a new search</button>'}</div>
    <p class="onb-note">${hasSearch ? '' : 'No data is loaded. To open an existing search run <code>apartmentscout serve --search searches/&lt;name&gt;</code>. Nothing leaves your machine.'}</p></div>`;
  host.append(el);
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-onb]'); if (!b) return;
    openWizard({ mode: b.dataset.onb === 'edit' ? 'edit' : 'new' });
  });
}

/** Called once at boot: the empty state, and the ?new=1 / ?wizard=edit URL options. */
export function initOnboarding() {
  if (!S.listings.length) mountEmpty();
  const q = new URLSearchParams(location.search), w = q.get('wizard');
  if (q.get('new') === '1' || w === 'new') openWizard({ mode: 'new', step: +q.get('step') || 0 });
  else if (w === 'edit') openWizard({ mode: 'edit', step: +q.get('step') || 0 });
}
