// Layout option sheet: every preset written for this plan (and your current layout) drawn small, side by
// side, each with its verdict: how many pieces are clear, tight or blocked, its first problem, and the
// narrowest walk from the front door. The design idea comes from hand-drawn option sheets that argue a
// bedroom layout by showing the options together.
import { esc } from '../util.js';
import { resolve } from './catalog.js';
import { evaluate } from './checks.js';
import { accessRoutes } from './route.js';
import { staticMarkup, furnitureMarkup, routeMarkup } from './plan2d.js';

/** Verdict for one set of raw items on a plan. Pure apart from the markup helpers. */
export function verdict(model, raw) {
  const items = raw.map((x) => resolve(x)).filter(Boolean), ev = evaluate(model, items);
  const issues = Object.values(ev.items).flatMap((r) => r.issues.map((x) => ({ ...x, name: r.name }))).sort((a, b) => (a.grade === 'blocked' ? -1 : 0) - (b.grade === 'blocked' ? -1 : 0));
  const routes = accessRoutes(model, items).routes;
  const worst = routes.reduce((a, r) => (!a || (r.reachable ? r.width : -1) < (a.reachable ? a.width : -1) ? r : a), null);
  return { items, ev, issues, routes, worst };
}

/**
 * @param {HTMLElement} el container
 * @param {{model: object, layouts: {id: string, name: string, note?: string, items: object[]}[], current: object[], onPick: (id: string) => void}} o
 */
export function renderOptions(el, o) {
  const sets = [{ id: '__current', name: 'Your layout now', note: '', items: o.current }, ...o.layouts];
  const b = o.model.bounds, pad = 18, w = b.x1 - b.x0 + 2 * pad, h = b.y1 - b.y0 + 2 * pad;
  el.innerHTML = `<div class="ps-cmp-h"><div><h3 class="label">Layout options <span>every preset on this plan, checked</span></h3>
      <p class="ps-note">Each option is graded with the same rules as the studio. The route line is the narrowest walk from the front door.</p></div>
      <button class="btn" type="button" data-cmp="close">Close</button></div>
    <div class="ps-opt-grid">${sets.map((s, i) => {
      const v = verdict(o.model, s.items), c = v.ev.counts, first = v.issues.find((x) => x.grade !== 'clear');
      const tone = c.blocked ? 'bad' : c.tight ? 'warn' : 'good';
      const route = v.worst ? (v.worst.reachable ? `${Number.isFinite(v.worst.width) ? Math.round(v.worst.width) + ' in' : 'open'} walk to the ${esc(v.worst.label.toLowerCase())}` : `no way to the ${esc(v.worst.label.toLowerCase())}`) : '';
      return `<article class="ps-opt${s.id === '__current' ? ' cur' : ''}">
        <header><b>${i ? `${i}. ` : ''}${esc(s.name)}</b><span class="pill ${tone}">${c.blocked ? `${c.blocked} blocked` : c.tight ? `${c.tight} tight` : 'All clear'}</span></header>
        <svg viewBox="${b.x0 - pad} ${-b.y1 - pad} ${w} ${h}" role="img" aria-label="${esc(s.name)}">${staticMarkup(o.model, `opt${i}`)}<g>${routeMarkup(v.worst && v.worst.path.length ? [v.worst] : [])}</g>${furnitureMarkup(v.items, v.ev.items, null, false)}</svg>
        ${s.note ? `<p class="ps-note">${esc(s.note)}</p>` : ''}
        <p class="ps-opt-v">${first ? `<span class="g-${first.grade}">${esc(first.name)}: ${esc(first.text.charAt(0).toLowerCase() + first.text.slice(1))}</span>` : '<span class="g-clear">Every piece fits with its clearances.</span>'}${route ? `<br><small class="faint">${route}</small>` : ''}</p>
        ${s.id === '__current' ? '' : `<button class="btn" type="button" data-opt-pick="${esc(s.id)}">Use this layout</button>`}
      </article>`;
    }).join('')}</div>`;
  el.querySelectorAll('[data-opt-pick]').forEach((btn) => btn.addEventListener('click', () => o.onPick(btn.dataset.optPick)));
}
