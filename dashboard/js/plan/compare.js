// Compare plans: every floor plan in the search side by side at the same scale, with the renter's
// furniture (the current layout) auto-placed in each and an item x plan fit table.
import { esc } from '../util.js';
import { normalisePlan, fmtIn } from './model.js';
import { roomOf } from './checks.js';
import { fitOne, finish } from './fit.js';
import { staticMarkup, furnitureMarkup } from './plan2d.js';
import { render3D, view3D, dispose3D } from './compare3d.js';

let token = 0;
const PILL = { clear: ['good', 'Clear'], tight: ['warn', 'Tight'], blocked: ['bad', 'Blocked'], none: ['bad', 'No room'] };
const tick = () => new Promise((r) => setTimeout(r, 0));

/**
 * Render the comparison into `el`.
 * @param {HTMLElement} el container
 * @param {{ids: string[], current: string, model: object, items: object[], load: (id: string) => Promise<object>, labelOf: (id: string, m: object) => string}} o
 */
export async function renderCompare(el, o) {
  const my = ++token;
  const kit = o.items.filter((it) => !it.hidden).map((it) => ({ ...it, roomKind: o.model.rooms.find((r) => r.name === roomOf(o.model, [it.x, it.y]))?.kind || 'living' }));
  const plans = [];
  for (const id of o.ids) {
    let m = null, err = null;
    if (id === o.current) m = o.model;
    else { try { m = normalisePlan(await o.load(id)); } catch (e) { err = e.message || String(e); } }
    plans.push({ id, m, err, name: m ? o.labelOf(id, m) : id });
  }
  if (my !== token) return;
  const ok = plans.filter((p) => p.m);
  const pad = 24, widths = ok.map((p) => p.m.bounds.x1 - p.m.bounds.x0 + 2 * pad);
  const avail = Math.max(320, el.clientWidth - 40 - 16 * Math.max(0, ok.length - 1));
  const k = Math.max(0.5, Math.min(1.15, avail / widths.reduce((a, b) => a + b, 0)));
  el.innerHTML = `<div class="ps-cmp-h"><div><h3 class="label">Compare plans <span>same scale, ${k >= 1 ? '' : `${Math.round(k * 100)}% of `}1 px per inch</span></h3>
      <p class="ps-note">Your current layout (${kit.length} piece${kit.length === 1 ? '' : 's'}) is placed automatically in every other plan, biggest pieces first, in a room of the same kind when one fits.</p></div>
      <button class="btn" type="button" data-cmp="close">Close</button></div>
    ${ok.length > 1 ? `<div class="ps-cmp3d"><div class="canvas-stage ps-cmp3d-stage" id="psCmp3d"><div class="float ps-cmp3d-v" role="group" aria-label="Camera"><button type="button" data-v3="angle" class="on">Angle</button><button type="button" data-v3="top">Top</button></div><div class="hud"><span>Same kit, same scale · drag to orbit</span></div></div></div>` : ''}
    ${o.ids.length < 2 ? '<div class="empty"><b>Only one floor plan so far</b>Add a second plan to the search to compare how your furniture fits each apartment.</div>' : ''}
    <div class="ps-cmp-cards">${plans.map((p) => {
      if (!p.m) return `<div class="ps-cmp-card"><b>${esc(p.name)}</b><p class="ps-note">Could not read this plan: ${esc(p.err)}</p></div>`;
      const b = p.m.bounds, w = b.x1 - b.x0 + 2 * pad, h = b.y1 - b.y0 + 2 * pad;
      return `<div class="ps-cmp-card${p.id === o.current ? ' cur' : ''}" data-plan="${esc(p.id)}">
        <div class="ps-cmp-ct"><a href="#plan/${encodeURIComponent(p.id)}">${esc(p.name)}</a><span class="ps-cmp-sum" id="psCmpSum-${esc(p.id)}">${p.id === o.current ? 'your layout' : 'placing…'}</span></div>
        <small>${Math.round(p.m.area)} ft² of rooms · ${p.m.rooms.filter((r) => r.kind === 'bedroom').length} bedroom${p.m.rooms.filter((r) => r.kind === 'bedroom').length === 1 ? '' : 's'}</small>
        <svg class="ps-cmp-svg" width="${Math.round(w * k)}" height="${Math.round(h * k)}" viewBox="${b.x0 - pad} ${-b.y1 - pad} ${w} ${h}" role="img" aria-label="${esc(p.name)} plan">${staticMarkup(p.m, `cmp${plans.indexOf(p)}`)}<g class="ps-cmp-furn"></g></svg></div>`;
    }).join('')}</div>
    ${kit.length ? `<div class="scroll"><table class="mini ps-cmp-t"><thead><tr><th>Piece</th>${ok.map((p) => `<th>${esc(p.name)}</th>`).join('')}</tr></thead><tbody>
      ${[...kit].sort((a, b) => b.w * b.d - a.w * a.d).map((it) => `<tr><td><b>${esc(it.name)}</b><br><small class="faint">${fmtIn(it.w)} × ${fmtIn(it.d)}</small></td>${ok.map((p) => `<td data-cell="${esc(p.id)}|${esc(it.id)}"><span class="faint">…</span></td>`).join('')}</tr>`).join('')}
      </tbody></table></div>` : '<p class="ps-note">Add some furniture to the current plan to see how it fits the others.</p>'}`;
  el.querySelector('.ps-cmp3d-v')?.addEventListener('click', (e) => { const b = e.target.closest('[data-v3]'); if (!b) return; el.querySelectorAll('[data-v3]').forEach((x) => x.classList.toggle('on', x === b)); view3D(b.dataset.v3); });
  const done = [];
  const cell = (pid, iid, r) => { const c = el.querySelector(`[data-cell="${CSS.escape(pid)}|${CSS.escape(iid)}"]`); if (c) c.innerHTML = `<span class="pill ${PILL[r.grade][0]}">${PILL[r.grade][1]}</span>${r.room ? `<br><small class="faint">${esc(r.room)}</small>` : ''}`; };
  for (const p of ok) {
    let res;
    if (p.id === o.current) res = finish(p.m, kit.map((it) => ({ ...it, _room: roomOf(p.m, [it.x, it.y]) })));
    else {
      const placed = [], rows = {};
      for (const it of [...kit].sort((a, b) => b.w * b.d - a.w * a.d)) {
        await tick(); if (my !== token) return;
        const q = fitOne(p.m, placed, it);
        if (q) placed.push(q); else rows[it.id] = { room: null, grade: 'none' };
        cell(p.id, it.id, q ? { room: q._room, grade: q._grade } : rows[it.id]);
      }
      res = finish(p.m, placed, rows);
    }
    if (my !== token) return;
    for (const [iid, r] of Object.entries(res.rows)) cell(p.id, iid, r);
    const card = el.querySelector(`[data-plan="${CSS.escape(p.id)}"]`);
    card.querySelector('.ps-cmp-furn').innerHTML = furnitureMarkup(res.items, res.ev.items, null, false);
    const s = card.querySelector('.ps-cmp-sum'), n = kit.length;
    done.push({ name: p.name, model: p.m, items: res.items, sub: `${res.counts.clear} of ${n} clear` });
    s.innerHTML = `${p.id === o.current ? 'your layout · ' : ''}<b class="${res.counts.clear === n ? 'ok' : res.counts.blocked + res.counts.none ? 'no' : 'unk'}">${res.counts.clear} of ${n} clear</b>`;
  }
  const stage = el.querySelector('#psCmp3d');
  if (stage && done.length > 1 && my === token) { try { render3D(stage, done); } catch (e) { stage.innerHTML = `<div class="empty"><b>3D compare unavailable</b>${esc(e.message || e)}</div>`; } }
}
export const cancelCompare = () => { token++; dispose3D(); };
