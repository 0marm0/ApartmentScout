// The map's preview cards: what hovering a pin (desktop) or tapping it (touch) shows before the drawer opens,
// and the little list a building pin expands into. Markup only: map.js owns the popups and the click rules.
import { S, label, cost, commuteOf, score, MODE_LABEL } from '../app.js';
import { esc, money, scoreColor, aerialHTML, imagesOf, mediaSrc } from '../util.js';
import { hoverTrendHTML } from './price-ui.js';
import { unitsLabel, lowestCost } from './map-pins.js';

const bedText = (L) => (L.beds == null ? '' : L.beds ? `${L.beds} bd` : 'Studio');
const photoOf = (L) => { const im = imagesOf(L); return im.own[0] || im.building[0]?.url || null; };
const photoHTML = (L, w = 236, h = 118) => { const ph = photoOf(L); return ph ? `<img src="${esc(mediaSrc(ph))}" alt="" referrerpolicy="no-referrer">` : L.lat != null ? aerialHTML(L, w, h, 18) : ''; };
const chip = (L) => `<i class="hc-sc" style="--c:${scoreColor(score(L))}" title="Score">${score(L) == null ? '?' : Math.round(score(L))}</i>`;

/** One home: photo, name, rank, price, score and the facts that decide a first look. `extra` is the sun lens line.
 *  `touch` adds the button a phone needs, because a tap on the card is the second tap. */
export function unitPreviewHTML(L, { extra = '', touch = false } = {}) {
  const cm = commuteOf(L), cml = S.commuteMode === 'best' ? '' : ' ' + MODE_LABEL[S.commuteMode].toLowerCase();
  const facts = [L.neighborhood, bedText(L), L.sqft ? Math.round(L.sqft) + ' ft²' : '', L.floor ? 'floor ' + L.floor : ''].filter(Boolean).join(' · ');
  return `<div class="hovercard" data-preview="${esc(L.id)}">${photoHTML(L)}<div class="hb">
    <div class="t">${L._rank ? `<span class="hc-rank" title="Rank with your weights">#${L._rank}</span>` : ''}${esc(label(L))}</div>
    <div class="s">${esc(facts)}</div>
    <div class="p"><b>${money(cost(L))}/mo</b><span>${cm != null ? Math.round(cm) + ' min' + cml + ' · ' : ''}score ${chip(L)}</span></div>
    ${extra}${hoverTrendHTML(L)}
    ${touch ? '<button type="button" class="btn sm primary hc-open" data-open>Open details</button>' : ''}</div></div>`;
}

/** A building: its name, how many homes and the lowest cost, and the best three. */
export function buildingPreviewHTML(units, { touch = false } = {}) {
  const best = units[0], price = lowestCost(units, cost);
  const rows = units.slice(0, 3).map(rowHTML).join('');
  return `<div class="hovercard bldcard">${photoHTML(best)}<div class="hb">
    <div class="t">${esc(best.building || best.address)}</div>
    <div class="s">${esc(best.neighborhood || '')}</div>
    <div class="p"><b>${esc(unitsLabel(units.length, price))}</b></div>
    <ul class="bl">${rows}</ul>
    <div class="s hc-more">${units.length > 3 ? `and ${units.length - 3} more` : ''}${touch ? '' : (units.length > 3 ? ' · ' : '') + 'click for the list'}</div>
    ${touch ? '<button type="button" class="btn sm primary hc-open" data-list>See all units</button>' : ''}</div></div>`;
}
const rowHTML = (L) => `<li><span class="u">${esc(L.unit || label(L))}</span><span class="m">${esc([bedText(L), L.sqft ? Math.round(L.sqft) + ' ft²' : ''].filter(Boolean).join(' · '))}</span><b>${money(cost(L))}</b>${chip(L)}</li>`;

/** The list a building pin opens on click: every unit, best first, each a button that opens its drawer. */
export function buildingListHTML(units) {
  const price = lowestCost(units, cost), best = units[0];
  return `<div class="bldlist" role="dialog" aria-label="${esc(best.building || best.address)}, ${units.length} units">
    <div class="bl-h"><div><div class="t">${esc(best.building || best.address)}</div><div class="s">${esc(unitsLabel(units.length, price))}</div></div>
      <button type="button" class="icon-btn sm" data-x aria-label="Close the list" title="Close"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg></button></div>
    <ul class="bl" role="list">${units.map((L) => `<li class="${L.status === 'gone' ? 'gone' : ''}"><button type="button" data-id="${esc(L.id)}" aria-label="${esc(label(L))}, ${money(cost(L))} a month">
      ${L._rank ? `<span class="hc-rank">#${L._rank}</span>` : '<span></span>'}<span class="u">${esc(L.unit || label(L))}</span><span class="m">${esc([bedText(L), L.sqft ? Math.round(L.sqft) + ' ft²' : '', L.status === 'gone' ? 'gone' : ''].filter(Boolean).join(' · '))}</span><b>${money(cost(L))}</b>${chip(L)}</button></li>`).join('')}</ul></div>`;
}
