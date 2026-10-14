// The active-filter chip row above the results: one chip per filter that differs from the starting state
// (budget, commute limit, each must-have or feature switch, status set, text search, saved picks only), each removed
// with one click, plus "Clear all". It reads S.filters on every 'filters' event, so it follows the rail, the
// command palette and the search box; removing a chip goes through setFilter, so the rail follows it back.
// On a phone the row scrolls sideways. Chips enter and leave with a short transition (none under reduced motion).
import { S, on, setFilter, resetFilters, TIER_VARS } from '../app.js';
import { $, esc } from '../util.js';
import { syncTrigger } from '../palette.js';
import { activeChips, removalPatch } from './filter-model.js';
import { filterContext } from './filter-ctx.js';

const X = '<svg viewBox="0 0 10 10" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M2.5 2.5l5 5M7.5 2.5l-5 5"/></svg>';
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
let row, scroller, status, clearBtn, last = '';

function chipEl(c) {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'fchip'; b.dataset.id = c.id;
  b.innerHTML = '<i class="fc-dot" aria-hidden="true"></i><span class="fc-l"></span>' + X;
  fill(b, c);
  return b;
}
function fill(b, c) {
  const dot = b.querySelector('.fc-dot');
  dot.hidden = c.tier == null;
  dot.style.background = c.tier == null ? '' : `var(${TIER_VARS[c.tier] || '--tier-3'})`;
  const l = b.querySelector('.fc-l');
  if (l.textContent !== c.label) l.textContent = c.label;
  b.title = `${c.title}. Click to remove.`;
  b.setAttribute('aria-label', `Remove filter: ${c.title}`);
  b.dataset.kind = c.kind;
}

/** Bring the row in line with S.filters. Keyed by chip id so unchanged chips never re-animate. */
export function renderChips() {
  if (!row) return;
  const chips = activeChips(filterContext());
  const sig = JSON.stringify(chips.map((c) => [c.id, c.label, c.title, c.tier]));
  if (sig === last) return;
  last = sig;
  const had = !row.classList.contains('has'), mine = new Map([...scroller.querySelectorAll('.fchip:not(.leaving)')].map((b) => [b.dataset.id, b]));
  const anim = !reduced();
  let ref = scroller.firstElementChild, added = null;
  for (const c of chips) {
    let b = mine.get(c.id);
    if (b) { fill(b, c); mine.delete(c.id); } else { b = chipEl(c); if (anim && !had) b.classList.add('enter'); added = b; }
    if (b !== ref) scroller.insertBefore(b, ref); else ref = ref.nextElementSibling;
    while (ref && ref.classList.contains('leaving')) ref = ref.nextElementSibling;
  }
  for (const b of mine.values()) {   // chips that are gone
    if (anim) { b.classList.add('leaving'); b.disabled = true; setTimeout(() => b.remove(), 190); } else b.remove();
  }
  scroller.append(clearBtn);
  row.classList.toggle('has', chips.length > 0);
  row.toggleAttribute('inert', !chips.length);
  row.setAttribute('aria-hidden', String(!chips.length));
  status.textContent = chips.length ? `${chips.length} filter${chips.length === 1 ? '' : 's'} active` : 'No filters active';
  if (added) requestAnimationFrame(() => {   // a new chip lands at the far end on a phone: scroll to it
    const r = added.getBoundingClientRect(), s = scroller.getBoundingClientRect();
    if (r.right > s.right) scroller.scrollBy({ left: r.right - s.right + 24, behavior: anim ? 'smooth' : 'auto' });
  });
}

function remove(id) {
  const ctx = filterContext(), patch = removalPatch(id, ctx), keys = Object.keys(patch);
  if (!keys.length) return;
  keys.slice(0, -1).forEach((k) => (S.filters[k] = patch[k]));   // several keys change together: one event at the end
  const k = keys[keys.length - 1];
  if (id === 'q') { const q = $('q'); if (q) q.value = ''; }
  setFilter(k, patch[k]);
  if (id === 'q') syncTrigger();
}

export function initFilterChips() {
  row = $('filterChips'); if (!row) return;
  row.innerHTML = '<div class="fchips-in"><div class="fchips-scroll" id="fchipScroll"></div><span class="sr" id="fchipStatus" role="status" aria-live="polite"></span></div>';
  scroller = $('fchipScroll'); status = $('fchipStatus');
  clearBtn = document.createElement('button');
  clearBtn.type = 'button'; clearBtn.className = 'fchip-clear'; clearBtn.textContent = 'Clear all'; clearBtn.title = 'Remove every filter and go back to the starting view';
  clearBtn.setAttribute('aria-label', 'Clear all filters');
  scroller.addEventListener('click', (e) => {
    const b = e.target.closest('.fchip, .fchip-clear'); if (!b || b.disabled) return;
    // keep keyboard focus in the row: on the next chip (or Clear all), else back on the sort control
    const sibs = [...scroller.querySelectorAll('.fchip:not(.leaving), .fchip-clear')], i = sibs.indexOf(b), nxt = sibs[i + 1] && sibs[i + 1] !== clearBtn ? sibs[i + 1] : sibs[i - 1];
    const keyboard = e.detail === 0;
    if (b === clearBtn) resetFilters(); else remove(b.dataset.id);
    if (keyboard) requestAnimationFrame(() => ((nxt?.isConnected && !nxt.classList.contains('leaving') && nxt) || $('sortSel'))?.focus());
  });
  scroller.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const all = [...scroller.querySelectorAll('.fchip:not(.leaving), .fchip-clear')], i = all.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    all[Math.max(0, Math.min(all.length - 1, i + (e.key === 'ArrowRight' ? 1 : -1)))].focus();
  });
  on('filters', renderChips); on('commute', renderChips); on('criteria', renderChips);
  renderChips();
}
