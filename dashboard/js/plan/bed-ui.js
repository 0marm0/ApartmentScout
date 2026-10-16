// The "Bed" control: My bed / Latitude Run storage bed / No bed, with the fit answers for the bed you may buy. One small component in the Floor
// plan studio's 2D plan and 3D view and in Unit 3D's Inside view; they all show the same choice (it is saved with the layout, plan/choices.js).
// Pure string builders plus one mount function; plan3d.js and unit3d.js supply the state and do the switching.
import { esc } from '../util.js';

const GRADE = { clear: ['good', 'Fits'], tight: ['warn', 'Tight'], blocked: ['bad', 'Blocked'] };
const SHORT = { mine: 'My bed', storage: 'Storage bed', none: 'No bed' };

/** A piece's Shown / Hidden buttons (`rig` = plan/choices.js choiceState(items, inv, 'sim' or 'chair'); `attr` the data attribute the buttons carry), or ''. */
export function rigControlHTML(rig, attr = 'data-rig-choice', fallback = 'Sim rig') {
  if (!rig?.available) return '';
  const label = rig.label || fallback;
  return `<span class="bd-l" aria-hidden="true">${esc(label)}</span>
    <div class="bd-seg" role="radiogroup" aria-label="${esc(label)}">${rig.choices.map((c) => `<button type="button" role="radio" class="${rig.current === c.id ? 'on' : ''}" aria-checked="${rig.current === c.id}" ${attr}="${esc(c.id)}" title="${esc(c.label)}">${esc(c.label)}</button>`).join('')}</div>`;
}

/** The hidden-pieces row: every piece the layout is not showing, each with a plain Show / Add back button (`off` = plan/choices.js offPieces), or ''. */
export function offControlHTML(off) {
  if (!off?.length) return '';
  const verb = { hidden: 'Show', removed: 'Add back', absent: 'Add' };
  return `<span class="bd-l" aria-hidden="true">Hidden</span>
    <div class="bd-offs" role="group" aria-label="Hidden furniture">${off.map((q) => `<button type="button" class="bd-off" data-show-piece="${esc(q.id)}" title="${esc(verb[q.why] || 'Show')} ${esc(q.name)}${q.why === 'hidden' ? ', where it was' : ''}" aria-label="${esc(verb[q.why] || 'Show')} ${esc(q.name)}"><b>${esc(verb[q.why] || 'Show')}</b> ${esc(q.name)}</button>`).join('')}</div>`;
}

/** The button row. `state` is plan/choices.js choiceState(); `fit` the fit report's grade (or null). */
export function bedControlHTML(state, { fit = null, open = false } = {}) {
  if (!state?.available) return '';
  const dot = fit ? `<i class="bd-dot g-${esc(fit)}" aria-hidden="true"></i>` : '';
  return `<span class="bd-l" aria-hidden="true">${esc(state.label || 'Bed')}</span>
    <div class="bd-seg" role="radiogroup" aria-label="Bed">${state.choices.map((c) => `<button type="button" role="radio" class="${state.current === c.id ? 'on' : ''}" aria-checked="${state.current === c.id}" data-bed-choice="${esc(c.id)}" title="${esc(c.label)}${state.current === c.id && !state.exact ? ' (closest match: a piece was shown or hidden by hand)' : ''}" aria-label="${esc(c.label)}"><span class="bd-long">${esc(c.label)}</span><span class="bd-short">${esc(SHORT[c.id] || c.label)}</span></button>`).join('')}</div>
    <button type="button" class="bd-fit" data-bed-fit aria-expanded="${open}" title="Does the Latitude Run storage bed fit this wall, the doors, the closet and the drawers?">${dot}<span>Fit</span></button>`;
}

/** The fit answers as a card: the verdict, one row per question, the alternative when it does not fit, and what the piece is. */
export function bedFitHTML(rep, piece) {
  if (!rep) return '<p class="bd-none">The storage bed is not in this layout, so there is nothing to check.</p>';
  const cand = piece?.candidate, sp = piece?.spec?.overall;
  return `<div class="bd-card-h"><b>${esc(cand?.brand ? `${cand.brand} storage bed` : 'Storage bed')}: does it fit?</b><span class="pill ${GRADE[rep.grade][0]}">${GRADE[rep.grade][1]}</span></div>
    <p class="bd-sum">${esc(rep.summary)}</p>
    <ul class="bd-rows">${rep.rows.map((r) => `<li class="g-${esc(r.grade)}" data-bed-row="${esc(r.key)}"><i aria-hidden="true"></i><span><b>${esc(r.label)}</b> ${esc(r.text)}</span></li>`).join('')}</ul>
    ${rep.alternative ? `<p class="bd-alt" data-bed-alt>${esc(rep.alternative.text)}</p>` : ''}
    <p class="bd-foot">${esc(`Placed with its headboard centred on the same wall as your bed, windows on your right as you lie in it${sp ? `, at the maker's ${sp.w} x ${sp.d} x ${sp.h} in` : ''}.`)}${cand ? ` A candidate purchase, not owned${cand.sku ? ` (SKU ${esc(cand.sku)})` : ''}; sizes read from the maker's table and drawing.${cand.url ? ` <a href="${esc(cand.url)}" target="_blank" rel="noopener noreferrer">Product page</a>` : ''}` : ''}</p>`;
}

/**
 * Put the control into `host` (a stage element with a `position: relative` box) and keep it in step with the state.
 * @param {HTMLElement} host
 * @param {{where?: string, state: () => object|null, report: () => object|null, piece: () => object|null, choose: (id: string) => void, rig?: {state: () => object|null, choose: (id: string) => void}, chair?: {state: () => object|null, choose: (id: string) => void}, off?: {list: () => object[], show: (id: string) => void}}} o   `rig` and `chair`: the sim rig's and the office chair's Shown / Hidden rows, when the layout holds them; `off`: the hidden-pieces row (every piece not shown, each with a Show button)
 * @returns {{el: HTMLElement, update: () => void, close: () => void}}
 */
export function mountBedControl(host, o) {
  const el = document.createElement('div');
  el.className = `float bed-ctl ${o.where || ''}`.trim(); el.setAttribute('data-bed-ctl', o.where || ''); el.setAttribute('role', 'group'); el.setAttribute('aria-label', 'Bed');
  const pop = document.createElement('div'); pop.className = 'bd-pop'; pop.hidden = true; pop.setAttribute('role', 'region'); pop.setAttribute('aria-label', 'Does the storage bed fit?');
  const bar = document.createElement('div'); bar.className = 'bd-bar';
  const rigBar = document.createElement('div'); rigBar.className = 'bd-bar bd-rig'; rigBar.setAttribute('data-rig-ctl', '');
  const chairBar = document.createElement('div'); chairBar.className = 'bd-bar bd-rig'; chairBar.setAttribute('data-chair-ctl', '');
  const offBar = document.createElement('div'); offBar.className = 'bd-bar bd-off-bar'; offBar.setAttribute('data-off-ctl', ''); offBar.hidden = true;
  el.append(bar, rigBar, chairBar, offBar, pop); host.append(el);
  let open = false, cache = null, barSig = '', offSig = '';
  const verdict = () => { try { cache = o.report(); } catch { cache = null; } return cache; };
  let rigSig = '', chairSig = '';
  function render() {
    const st = o.state(), rg = o.rig?.state?.() || null, ch = o.chair?.state?.() || null, hasBed = !!st?.available, hasRig = !!rg?.available, hasChair = !!ch?.available;
    let off = []; try { off = o.off?.list?.() || []; } catch { off = []; }
    el.hidden = !hasBed && !hasRig && !hasChair && !off.length;
    if (el.hidden) return;
    const os = JSON.stringify(off.map((q) => [q.id, q.why, q.name]));
    if (os !== offSig) { offBar.innerHTML = offControlHTML(off); offSig = os; }
    offBar.hidden = !off.length;
    const rs = hasRig ? JSON.stringify([rg.current, rg.choices.map((c) => c.id)]) : '';
    if (rs !== rigSig) { rigBar.innerHTML = rigControlHTML(rg); rigSig = rs; }
    rigBar.hidden = !hasRig;
    const cs = hasChair ? JSON.stringify([ch.current, ch.choices.map((c) => c.id)]) : '';
    if (cs !== chairSig) { chairBar.innerHTML = rigControlHTML(ch, 'data-chair-choice', 'Office chair'); chairSig = cs; }
    chairBar.hidden = !hasChair;
    if (!hasBed) { if (barSig !== '') { bar.innerHTML = ''; barSig = ''; } bar.hidden = true; pop.hidden = true; return; }
    bar.hidden = false;
    const grade = verdict()?.grade ?? null, sig = JSON.stringify([st.current, st.exact, grade, st.choices.map((c) => c.id)]);
    if (sig !== barSig) {   // redraw the buttons only when they changed, and keep the keyboard where it was
      const had = el.contains(document.activeElement) ? document.activeElement.dataset?.bedChoice || (document.activeElement.matches?.('[data-bed-fit]') ? '#fit' : '') : '';
      bar.innerHTML = bedControlHTML(st, { fit: grade, open }); barSig = sig;
      if (had) (had === '#fit' ? bar.querySelector('[data-bed-fit]') : bar.querySelector(`[data-bed-choice="${had}"]`))?.focus();
    }
    bar.querySelector('[data-bed-fit]')?.setAttribute('aria-expanded', String(open));
    pop.hidden = !open;
    if (open) pop.innerHTML = bedFitHTML(cache || verdict(), o.piece?.());
  }
  const setOpen = (v) => { open = v; render(); };
  el.addEventListener('click', (e) => {
    const sh = e.target.closest('[data-show-piece]');
    if (sh) { o.off?.show(sh.dataset.showPiece); return; }
    const r = e.target.closest('[data-rig-choice]');
    if (r) { o.rig?.choose(r.dataset.rigChoice); return; }
    const q = e.target.closest('[data-chair-choice]');
    if (q) { o.chair?.choose(q.dataset.chairChoice); return; }
    const c = e.target.closest('[data-bed-choice]'), f = e.target.closest('[data-bed-fit]');
    if (c) { o.choose(c.dataset.bedChoice); return; }
    if (f) setOpen(!open);
  });
  el.addEventListener('keydown', (e) => {   // a radio group: the arrows move the choice
    const k = e.key, b = e.target.closest?.('[data-bed-choice]');
    if (b && (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'ArrowUp' || k === 'ArrowDown')) {
      const all = [...bar.querySelectorAll('[data-bed-choice]')], at = all.indexOf(b), next = all[(at + (k === 'ArrowLeft' || k === 'ArrowUp' ? -1 : 1) + all.length) % all.length];
      e.preventDefault(); o.choose(next.dataset.bedChoice); bar.querySelector(`[data-bed-choice="${next.dataset.bedChoice}"]`)?.focus(); return;
    }
  });
  el.addEventListener('keydown', (e) => { if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false); bar.querySelector('[data-bed-fit]')?.focus(); } });
  render();
  return { el, update: render, close: () => setOpen(false) };
}
