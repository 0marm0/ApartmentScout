// Decision tray: a slim floating dock at the bottom of the stage with the Compare picks (up to four): photo, price,
// score and a remove button for each. Add a home by dragging a card, price tag, table row or tour card onto the dock
// (or with the Compare toggle that already exists), drop on a slot to put it there, drag the slots to reorder, and open
// Compare with one click. Empty, collapsed or on a phone it is a small pill. The list is S.compare, so every Compare
// toggle in the app and the Compare view itself stay in step. The list operations are in tray-model.js.
import { S, on, emit, store, byId, cost, score, label, openDrawer } from '../app.js';
import { $, esc, money, scoreColor, ICONS, imagesOf, toast } from '../util.js';
import { miniGlyph } from '../views/table-kit.js';
import { placeAt, removeId, nudge, MAX } from './tray-model.js';
import { watch, reducedMotion } from './dom.js';

const MIME = 'application/x-apartmentscout-home';
const SHOW_ON = new Set(['map', 'list', 'tours']);
const DRAG_SRC = '.card[data-id], .price-tag[data-id], tr.r[data-id]:not(.group), .tc[data-id]';
const LET = ['A', 'B', 'C', 'D'];
const COMPARE_ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="1.8" y="3" width="5" height="10" rx="1.4"/><rect x="9.2" y="3" width="5" height="10" rx="1.4"/></svg>';
const CHEV = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M4 6.5l4 4 4-4"/></svg>';

let el = null, dragId = null, dragFrom = null, collapsed = false, prevIds = [], live = null;

const ids = () => S.compare.filter((id) => byId(id));
const phone = () => matchMedia('(max-width: 760px)').matches;

// ------------------------------------------------------------------ writing the Compare list
function commit(list) {
  S.compare.splice(0, S.compare.length, ...list);
  store.set('compare', S.compare);
  emit('compare');
}
const say = (t) => { if (live) { live.textContent = ''; setTimeout(() => { live.textContent = t; }, 30); } };
const nameOf = (id) => { const L = byId(id); return L ? label(L) : id; };

/** Apply a drop or a keyboard move and tell the renter what happened. */
function place(id, index) {
  const res = placeAt(ids(), id, index, MAX);
  if (res.action === 'same') return;
  if (res.action === 'full') { toast('Compare holds four. Drop on one of them to replace it.'); say('Compare is full. Drop on a home to replace it.'); return; }
  commit(res.list);
  const n = nameOf(id);
  if (res.action === 'add') { toast(`Added to Compare · ${res.list.length} of ${MAX}`); say(`${n} added to Compare, ${res.list.length} of ${MAX}`); }
  else if (res.action === 'replace') { toast(`${n} replaced ${nameOf(res.replaced)}`); say(`${n} replaced ${nameOf(res.replaced)}`); }
  else say(`${n} moved to position ${LET[res.list.indexOf(id)]}`);
}

// ------------------------------------------------------------------ markup
function photoHTML(L) {
  const im = imagesOf(L), u = im.own[0] || im.building[0]?.url;
  return `<span class="ts-ph">${miniGlyph(L, 44, 44)}${u ? `<img src="${esc(u)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" draggable="false" onerror="this.remove()">` : ''}</span>`;
}
function slotHTML(id, i, fresh) {
  const L = byId(id), c = cost(L), sc = score(L), n = label(L);
  return `<li class="td-slot filled${fresh ? ' enter' : ''}" data-slot="${i}" data-id="${esc(id)}" draggable="true">
    <span class="ts-l" aria-hidden="true">${LET[i]}</span>
    <button type="button" class="ts-main" data-act="open" aria-label="${esc(n)}, ${esc(money(c))} a month${sc != null ? ', score ' + Math.round(sc) : ''}. Column ${LET[i]} of ${ids().length} in Compare. Press Alt with the arrow keys to move it, Delete to remove it." title="${esc(n)}">
      ${photoHTML(L)}
      <span class="ts-t"><b>${esc(L.building || L.address || id)}${L.unit ? ` <small>${esc(L.unit)}</small>` : ''}</b>
        <span class="ts-m"><i class="ts-p">${money(c)}</i><i class="ts-s" style="--c:${scoreColor(sc)}" title="Score ${sc == null ? 'unknown' : Math.round(sc)}">${sc == null ? '?' : Math.round(sc)}</i></span></span>
    </button>
    <button type="button" class="ts-x" data-act="remove" aria-label="Remove ${esc(n)} from Compare" title="Remove from Compare">${ICONS.x}</button>
  </li>`;
}
const emptySlot = (i, hint) => `<li class="td-slot blank" data-slot="${i}" aria-hidden="true"><span class="ts-l">${LET[i]}</span><span class="ts-h">${hint}</span></li>`;

function stackHTML(list) {
  return list.slice(0, 3).map((id) => photoHTML(byId(id))).join('');
}
function render() {
  if (!el) return;
  const list = ids(), n = list.length, armed = dragId != null;
  const fresh = new Set(list.filter((id) => !prevIds.includes(id) && !reducedMotion()));
  const focusId = el.contains(document.activeElement) ? document.activeElement.closest('[data-id]')?.dataset.id : null;
  const focusAct = focusId ? document.activeElement.dataset.act : null;
  const shown = SHOW_ON.has(S.view);
  const expanded = armed || (!collapsed && n > 0);
  el.hidden = !shown;
  el.dataset.n = n; el.dataset.state = expanded ? 'dock' : 'pill'; el.classList.toggle('armed', armed);
  document.body.classList.toggle('has-tray', shown && expanded);
  const slots = list.map((id, i) => slotHTML(id, i, fresh.has(id)));
  const blanks = [];
  for (let i = n; i < MAX; i++) if (armed || i === n) blanks.push(emptySlot(i, armed ? 'Drop here' : 'Drag a home here'));
  el.querySelector('.tray-dock').innerHTML = `<ol class="td-slots" aria-label="Homes in Compare, in column order">${slots.join('')}${blanks.join('')}</ol>
    <div class="td-act"><a class="btn primary td-go" href="#compare" ${n ? '' : 'aria-disabled="true" tabindex="-1"'} aria-label="Open Compare with ${n} home${n === 1 ? '' : 's'}">${COMPARE_ICON}<span>Compare</span>${n ? `<b>${n}</b>` : ''}</a>
      <button type="button" class="icon-btn td-fold" data-act="fold" aria-label="Collapse the decision tray" title="Collapse">${CHEV}</button></div>`;
  const pill = el.querySelector('.tray-pill');
  pill.setAttribute('aria-expanded', String(expanded));
  pill.innerHTML = n
    ? `<span class="tp-stack" aria-hidden="true">${stackHTML(list)}</span><span class="tp-t">Compare</span><b class="tp-n">${n}</b><span class="tp-go" aria-hidden="true">${CHEV}</span>`
    : `<span class="tp-ic" aria-hidden="true">${COMPARE_ICON}</span><span class="tp-t">Compare</span><span class="tp-hint">Drag homes here</span>`;
  pill.setAttribute('aria-label', n ? `Decision tray: ${n} home${n === 1 ? '' : 's'} in Compare. Show the tray.` : 'Decision tray is empty. Drag a home onto it to compare, or use the Compare button on a card.');
  prevIds = list;
  if (focusId) el.querySelector(`.td-slot[data-id="${CSS.escape(focusId)}"] [data-act="${focusAct === 'remove' ? 'remove' : 'open'}"]`)?.focus({ preventScroll: true });
  place0();
}

// ------------------------------------------------------------------ where the dock sits
/** Centre the dock on the stage, beside the open drawer, and pick a slot size that fits. */
function place0() {
  if (!el || el.hidden) return;
  const vp = $('viewport')?.getBoundingClientRect(), dw = $('drawer');
  if (!vp || phone()) { el.style.removeProperty('--tx'); el.style.removeProperty('--tw'); el.dataset.size = 'm'; return; }
  const drOpen = dw?.classList.contains('open') && S.view !== 'unit';
  const right = drOpen ? dw.getBoundingClientRect().left : vp.right;
  const left = vp.left, avail = Math.max(240, right - left - 28);
  el.style.setProperty('--tx', `${Math.round((left + right) / 2)}px`);
  el.style.setProperty('--tw', `${Math.round(avail)}px`);
  // slots on show: the picks plus one blank to drop on (all four while a drag is in the air)
  const n = dragId != null ? MAX : Math.min(MAX, ids().length + 1), act = 160;
  el.dataset.size = avail >= n * 168 + act ? 'm' : avail >= n * 126 + act ? 's' : 'xs';
}

// ------------------------------------------------------------------ drag and drop
function ghost(L) {
  const g = document.createElement('div');
  g.className = 'drag-ghost'; g.innerHTML = `${COMPARE_ICON}<b>${esc(label(L))}</b><span>${esc(money(cost(L)))}</span>`;
  document.body.append(g);
  setTimeout(() => g.remove(), 0);
  return g;
}
function arm(on2) {
  document.body.classList.toggle('dragging-home', on2);
  render();
}
function slotAt(e) {
  const s = e.target.closest?.('.td-slot'); return s ? { i: +s.dataset.slot, el: s, filled: s.classList.contains('filled') } : null;
}
function clearOver() { el.querySelectorAll('.td-slot.over, .td-slot.insert').forEach((x) => x.classList.remove('over', 'insert')); el.classList.remove('over'); }

function wireDrag() {
  document.addEventListener('dragstart', (e) => {
    const slot = e.target.closest?.('.td-slot[data-id]'), src = slot || e.target.closest?.(DRAG_SRC);
    const id = src?.dataset.id, L = id && byId(id);
    if (!L) return;
    dragId = id; dragFrom = slot ? +slot.dataset.slot : null;
    try {
      e.dataTransfer.setData(MIME, id); e.dataTransfer.setData('text/plain', id);
      e.dataTransfer.effectAllowed = slot ? 'move' : 'copyMove';
      e.dataTransfer.setDragImage(ghost(L), 16, 16);
    } catch { /* some browsers refuse a custom drag image */ }
    // the tray renders while the drag is in the air; a slot being dragged is not re-rendered (that would cancel the drag)
    if (dragFrom != null) document.body.classList.add('dragging-home');
    else requestAnimationFrame(() => { if (dragId) arm(true); });
  });
  document.addEventListener('dragend', () => { dragId = null; dragFrom = null; clearOver(); if (el) arm(false); });
  el.addEventListener('dragover', (e) => {
    if (!dragId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = dragFrom != null ? 'move' : 'copy';
    clearOver();
    const s = slotAt(e);
    if (!s) { el.classList.add('over'); return; }
    const full = ids().length >= MAX, member = ids().includes(dragId);
    s.el.classList.add(s.filled && full && !member ? 'over' : s.filled && !member ? 'insert' : 'over');
  });
  el.addEventListener('dragleave', (e) => { if (!el.contains(e.relatedTarget)) clearOver(); });
  el.addEventListener('drop', (e) => {
    if (!dragId) return;
    e.preventDefault();
    const id = dragId, s = slotAt(e);
    clearOver(); dragId = null; dragFrom = null;
    document.body.classList.remove('dragging-home');
    place(id, s ? s.i : null);
    render();
  });
}

/** Cards, price tags and table rows become draggable; a price tag also keeps the map from starting a pan under the drag. */
function armSources() {
  for (const [root, sel] of [['cards', '.card[data-id]'], ['map', '.price-tag[data-id]'], ['view-list', 'tr.r[data-id]:not(.group)']]) {
    $(root)?.querySelectorAll(sel).forEach((n) => {
      if (n.draggable && n.dataset.trayArmed) return;
      n.draggable = true; n.dataset.trayArmed = '1';
      if (n.classList.contains('price-tag')) for (const t of ['mousedown', 'touchstart', 'pointerdown']) n.addEventListener(t, (ev) => { if (ev.type !== 'touchstart') ev.stopPropagation(); }, { passive: true });
    });
  }
}

// ------------------------------------------------------------------ events
function wireClicks() {
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]'), slot = e.target.closest('.td-slot[data-id]');
    if (e.target.closest('.tray-pill')) {
      if (!ids().length) { toast('Drag a card, price tag or table row here, or press c with a home open'); return; }
      collapsed = false; store.set('tray-collapsed', false); render(); return;
    }
    if (!b) return;
    const id = slot?.dataset.id;
    if (b.dataset.act === 'fold') { collapsed = true; store.set('tray-collapsed', true); render(); el.querySelector('.tray-pill')?.focus(); }
    else if (b.dataset.act === 'remove' && id) { const n = nameOf(id); commit(removeId(ids(), id)); toast('Removed from Compare'); say(`${n} removed from Compare`); }
    else if (b.dataset.act === 'open' && id) openDrawer(id, { fly: true });
  });
  el.addEventListener('keydown', (e) => {
    const slot = e.target.closest('.td-slot[data-id]'); if (!slot) return;
    const id = slot.dataset.id, i = +slot.dataset.slot;
    if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      const next = nudge(ids(), i, e.key === 'ArrowLeft' ? -1 : 1);
      if (next[i] !== id) { commit(next); say(`${nameOf(id)} moved to position ${LET[next.indexOf(id)]}`); }
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault(); const rest = removeId(ids(), id); commit(rest); say(`${nameOf(id)} removed from Compare`);
      requestAnimationFrame(() => (el.querySelector(`.td-slot[data-slot="${Math.min(i, rest.length - 1)}"] .ts-main`) || el.querySelector('.tray-pill'))?.focus());
    }
  });
  // on a phone the expanded tray is a sheet: a tap anywhere else puts it away
  document.addEventListener('click', (e) => { if (phone() && el.dataset.state === 'dock' && !e.composedPath().includes(el)) { collapsed = true; render(); } });
}

export function init() {
  collapsed = store.get('tray-collapsed', null) ?? phone();
  el = document.createElement('aside');
  el.className = 'tray'; el.id = 'tray'; el.setAttribute('aria-label', 'Decision tray');
  el.innerHTML = `<div class="sr" role="status" aria-live="polite" id="trayLive"></div><button type="button" class="tray-pill" aria-controls="trayDock"></button><div class="tray-dock" id="trayDock" role="group" aria-label="Homes to compare"></div>`;
  document.body.append(el);
  live = el.querySelector('#trayLive');
  wireDrag(); wireClicks();
  for (const r of ['cards', 'map', 'view-list']) watch($(r), armSources, { subtree: true });
  on('compare', render); on('weights-settled', render); on('criteria', render); on('commute', render);
  addEventListener('hashchange', () => requestAnimationFrame(render));
  addEventListener('resize', () => render());
  const dw = $('drawer'); if (dw) new MutationObserver(place0).observe(dw, { attributes: true, attributeFilter: ['class'] });
  const vp = $('viewport'); if (vp && 'ResizeObserver' in window) new ResizeObserver(place0).observe(vp);
  render();
}

export const state = () => ({ ids: ids(), collapsed, dragId });
