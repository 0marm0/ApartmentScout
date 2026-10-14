// Entry points to the New search wizard: the search switcher menu in the top bar, the empty state when no data (or no
// listings) is loaded, and the ?new=1 / ?wizard=edit URL options.
import { S, openSettings } from './app.js';
import { $, esc } from './util.js';
import * as API from './local-api.js';
import { I } from './wizard-steps.js';

const wizard = () => import('./wizard.js');
export const openWizard = async (o) => (await wizard()).openWizard(o);

// ------------------------------------------------------------------ search switcher menu
let pop = null, anchor = null;
const IC = {
  gear: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="8" cy="8" r="2.2"/><path d="M8 1.8v1.6M8 12.6v1.6M1.8 8h1.6M12.6 8h1.6M3.6 3.6l1.1 1.1M11.3 11.3l1.1 1.1M12.4 3.6l-1.1 1.1M4.7 11.3l-1.1 1.1"/></svg>',
  sliders: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M2 4.5h7M12 4.5h2M2 11.5h2M7 11.5h7"/><circle cx="10.5" cy="4.5" r="1.5"/><circle cx="5.5" cy="11.5" r="1.5"/></svg>',
  folder: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M1.8 4.2a1 1 0 011-1h3l1.5 1.7h5.9a1 1 0 011 1v6.4a1 1 0 01-1 1H2.8a1 1 0 01-1-1z"/></svg>',
};
export async function openSearchMenu(btn) {
  if (pop) return closeMenu();
  anchor = btn;
  const api = await API.getSession();
  const others = (api?.searches || []).filter((s) => !s.active);
  const cur = S.crit0.search, city = cur?.city && cur.city !== 'generic' ? cur.city.toUpperCase() : '';
  pop = document.createElement('div');
  pop.className = 'sm-pop'; pop.setAttribute('role', 'menu'); pop.setAttribute('aria-label', 'Searches');
  pop.innerHTML = `<div class="sm-head"><b>${esc(cur?.name || 'No search loaded')}</b><small>${[city, `${S.listings.length} listing${S.listings.length === 1 ? '' : 's'}`, api?.search?.folder].filter(Boolean).map(esc).join(' · ')}</small></div>
    ${others.length ? `<div class="sm-sep"></div><div class="sm-lbl">Switch to</div>${others.map((s) => `<button type="button" role="menuitem" class="sm-it" data-switch="${esc(s.folder)}"><span class="ic">${IC.folder}</span><span class="tx"><b>${esc(s.name)}</b><small>${esc(s.folder)}</small></span></button>`).join('')}` : ''}
    <div class="sm-sep"></div>
    <button type="button" role="menuitem" class="sm-it new" data-go="new"><span class="ic">${I.plus}</span><span class="tx"><b>New search…</b><small>Step-by-step wizard</small></span></button>
    ${cur ? `<button type="button" role="menuitem" class="sm-it" data-go="edit"><span class="ic">${IC.sliders}</span><span class="tx"><b>Edit all criteria…</b><small>Every setting of this search, with weights</small></span></button>
    <button type="button" role="menuitem" class="sm-it" data-go="settings"><span class="ic">${IC.gear}</span><span class="tx"><b>Search settings</b><small>Quick edits, previewed in this browser</small></span></button>` : ''}`;
  document.body.append(pop);
  const r = btn.getBoundingClientRect(), w = Math.min(330, innerWidth - 20);
  pop.style.left = `${Math.max(10, Math.min(r.left, innerWidth - w - 10))}px`; pop.style.top = `${r.bottom + 6}px`;
  btn.setAttribute('aria-expanded', 'true');
  requestAnimationFrame(() => pop?.classList.add('on'));
  pop.querySelector('.sm-it')?.focus();
  pop.addEventListener('click', (e) => {
    const b = e.target.closest('.sm-it'); if (!b) return;
    closeMenu(false);
    if (b.dataset.go === 'new') openWizard({ mode: 'new' });
    else if (b.dataset.go === 'edit') openWizard({ mode: 'edit' });
    else if (b.dataset.go === 'settings') openSettings();
    else if (b.dataset.switch) API.activate(b.dataset.switch).then(() => location.reload()).catch(() => {});
  });
  pop.addEventListener('keydown', (e) => {
    const items = [...pop.querySelectorAll('.sm-it')], i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
    else if (e.key === 'Home') { e.preventDefault(); items[0].focus(); }
    else if (e.key === 'End') { e.preventDefault(); items.at(-1).focus(); }
    else if (e.key === 'Tab') closeMenu();
  });
  setTimeout(() => { addEventListener('mousedown', outside, true); addEventListener('keydown', esc2, true); addEventListener('resize', closeMenu); }, 0);
}
const outside = (e) => { if (pop && !pop.contains(e.target) && !anchor?.contains(e.target)) closeMenu(false); };
const esc2 = (e) => { if (e.key === 'Escape' && pop) { e.stopPropagation(); closeMenu(); } };
function closeMenu(refocus = true) {
  if (!pop) return;
  removeEventListener('mousedown', outside, true); removeEventListener('keydown', esc2, true); removeEventListener('resize', closeMenu);
  pop.remove(); pop = null;
  anchor?.setAttribute('aria-expanded', 'false');
  if (refocus) anchor?.focus();
}

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
