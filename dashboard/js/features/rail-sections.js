// Collapsible filter-rail sections: search, Budget, Commute, Must-haves and features, Status and Weights.
// The rail (renderRail in app.js) rebuilds its markup on every filter change; decorateRail() runs at the end of
// each rebuild and turns every .sec into a disclosure: a heading button with aria-expanded, a one-line summary
// of the current setting that shows while collapsed, and a body that opens and closes with a height animation
// (grid rows 1fr to 0fr, no measuring). Which sections are collapsed is remembered per browser. Because the
// markup is rebuilt in its final state, a rebuild never replays the animation; only a toggle does.
import { store } from '../app.js';
import { esc } from '../util.js';
import { sectionSummaries } from './filter-model.js';
import { filterContext } from './filter-ctx.js';

const TITLES = { Budget: 'budget', Commute: 'commute', 'Must-haves and features': 'features', Status: 'status', 'Ranking weights': 'weights' };
const CHEVRON = '<svg viewBox="0 0 10 10" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 3.6l3 3 3-3"/></svg>';

let collapsed = null;
const load = () => {
  if (collapsed) return collapsed;
  const v = store.get('rail:collapsed', []);
  return (collapsed = new Set(Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []));
};

const secId = (sec) => {
  if (sec.classList.contains('search-sec')) return 'search';
  const h = sec.querySelector(':scope > .sec-h h3')?.textContent.trim();
  return TITLES[h] || (h ? h.toLowerCase().replace(/[^a-z0-9]+/g, '-') : null);
};

function setState(sec, shut) {
  const id = sec.dataset.sec, btn = sec.querySelector('.sec-tg'), body = sec.querySelector('.sec-body');
  sec.classList.toggle('collapsed', shut);
  btn?.setAttribute('aria-expanded', String(!shut));
  if (body) body.inert = shut;   // collapsed controls leave the tab order and the accessibility tree
  const sum = sec.querySelector('.sec-sum');
  if (sum) sum.setAttribute('aria-hidden', String(!shut));
  return id;
}

/** Turn each .sec of a freshly rendered rail into a collapsible section. Safe to call on every render. */
export function decorateRail(root) {
  if (!root) return;
  const shut = load(), sums = sectionSummaries(filterContext());
  for (const sec of root.querySelectorAll(':scope > .sec')) {
    const id = secId(sec); if (!id || sec.dataset.sec) continue;
    sec.dataset.sec = id;
    let head = sec.querySelector(':scope > .sec-h');
    if (!head) { head = document.createElement('div'); head.className = 'sec-h'; head.innerHTML = '<h3>Search</h3>'; sec.prepend(head); }
    const h3 = head.querySelector('h3'), title = h3.textContent.trim();
    h3.innerHTML = `<button type="button" class="sec-tg" id="sec-tg-${id}" aria-controls="sec-body-${id}" aria-expanded="true" aria-describedby="sec-sum-${id}">${CHEVRON}<span>${esc(title)}</span></button>`;
    const sum = document.createElement('span');
    sum.className = 'sec-sum'; sum.id = `sec-sum-${id}`; sum.textContent = sums[id] || '';
    head.insertBefore(sum, h3.nextSibling);
    const body = document.createElement('div'), inner = document.createElement('div');
    body.className = 'sec-body'; body.id = `sec-body-${id}`; body.setAttribute('role', 'group'); body.setAttribute('aria-labelledby', `sec-tg-${id}`);
    inner.className = 'sec-in';
    for (const c of [...sec.children]) if (c !== head) inner.append(c);   // moves nodes, so listeners already attached stay
    body.append(inner); sec.append(body);
    setState(sec, shut.has(id));
  }
}

/** Open or close one section (animated) and remember it. */
export function toggleSection(id, force) {
  const sec = document.querySelector(`#rail > .sec[data-sec="${CSS.escape(id)}"]`); if (!sec) return;
  const next = force ?? !sec.classList.contains('collapsed'), shut = load();
  next ? shut.add(id) : shut.delete(id);
  setState(sec, next);
  store.set('rail:collapsed', [...shut]);
}

/** One delegated set of listeners on the rail: click on a heading, and arrow keys between headings. */
export function initRailSections() {
  const rail = document.getElementById('rail'); if (!rail) return;
  rail.addEventListener('click', (e) => {
    const b = e.target.closest('.sec-tg'); if (!b) return;
    toggleSection(b.closest('.sec').dataset.sec);
  });
  rail.addEventListener('keydown', (e) => {
    const b = e.target.closest?.('.sec-tg'); if (!b || e.altKey || e.ctrlKey || e.metaKey) return;
    const all = [...rail.querySelectorAll('.sec-tg')], i = all.indexOf(b);
    const to = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: all.length - 1 }[e.key];
    if (to == null) return;
    e.preventDefault();
    all[Math.max(0, Math.min(all.length - 1, to))]?.focus();
  });
}

// ------------------------------------------------------------------ keep keyboard focus across a rail rebuild
// renderRail replaces the rail's markup on every filter change, which drops focus from the control that was just
// used (a switch toggled with the space bar, a slider moved with the arrow keys). Remember it, then find it again.
const KEYS = ['id', 'data-w', 'data-tg', 'data-tier', 'data-over', 'data-st', 'data-saved', 'data-reset', 'data-mode'];
export function railFocus(root) {
  const a = document.activeElement;
  if (!root || !a || a === document.body || !root.contains(a)) return null;
  for (const k of KEYS) if (a.hasAttribute?.(k)) return `[${k}="${CSS.escape(a.getAttribute(k))}"]`.replace('=""]', ']');
  return null;
}
export function restoreRailFocus(root, sel) {
  if (!sel || !root) return;
  const el = root.querySelector(sel);
  if (el && document.activeElement !== el && !el.closest('[inert]')) el.focus({ preventScroll: true });
}
