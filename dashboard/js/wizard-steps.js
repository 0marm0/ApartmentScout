// New-search wizard: the markup of each step. Pure string builders over the wizard state (no listeners); wizard.js owns
// the state, the events (everything is wired through data- attributes) and the actions. Every user-supplied value is escaped.
import { esc } from './util.js';
import { AMENITY_NAMES } from './criteria.js';
import * as M from './wizard-model.js';

export const I = {
  pin: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M8 14.5s4.5-4.2 4.5-7.8a4.5 4.5 0 10-9 0C3.5 10.3 8 14.5 8 14.5z"/><circle cx="8" cy="6.7" r="1.6"/></svg>',
  x: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
  plus: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M8 3v10M3 8h10"/></svg>',
  check: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true"><path d="M3 8.5l3 3 7-7"/></svg>',
  left: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M10 3L5 8l5 5"/></svg>',
  right: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M6 3l5 5-5 5"/></svg>',
  dl: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M8 2v8M4.5 6.5L8 10l3.5-3.5M3 13h10"/></svg>',
  copy: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.6"/><path d="M10.5 3.5v-.4a1.2 1.2 0 00-1.2-1.2H3.9a1.2 1.2 0 00-1.2 1.2v5.4a1.2 1.2 0 001.2 1.2h.6"/></svg>',
  star: '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 1.6l1.9 4 4.4.5-3.3 3 .9 4.3L8 11.2 4.1 13.4 5 9.1 1.7 6.1l4.4-.5z"/></svg>',
  term: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="1.8" y="2.8" width="12.4" height="10.4" rx="2"/><path d="M4.6 6.2l2 1.8-2 1.8M8.4 10h3"/></svg>',
  warn: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M8 2.2l6.2 11H1.8zM8 6.6v3.2M8 11.6v.1"/></svg>',
  bolt: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M9 1.8L3.6 9H8l-1 5.2L12.4 7H8z"/></svg>',
};
const TIER_VARS = ['--tier-1', '--tier-2', '--tier-3', '--tier-over'];
const usd = (x) => '$' + Math.round(+x || 0).toLocaleString('en-US');
const GROUPS = [['must_have', 'Must'], ['strongly_prefer', 'Strong'], ['nice_to_have', 'Nice'], ['', 'Off']];
const WEIGHTS = [[0.5, 'Minor'], [1, 'Normal'], [2, 'Important'], [3, 'Critical']];
const MODE_NAMES = { best: 'Fastest', subway: 'Subway', bus: 'Bus', walk: 'Walk' };

/** A labelled field with its hint and inline error slot. `code` names the field for validation and wiring. */
export function fld(X, label, code, input, { hint = '', wide = false, tag = '' } = {}) {
  const msg = X.msg(code);
  return `<div class="wz-field${wide ? ' wide' : ''}${msg ? ' bad' : ''}"><label for="f-${esc(code)}">${label}${tag ? `<em>${tag}</em>` : ''}</label>${input}${hint ? `<p class="wz-hint" id="h-${esc(code)}">${hint}</p>` : ''}<p class="wz-err" data-err="${esc(code)}" id="e-${esc(code)}" role="alert">${esc(msg)}</p></div>`;
}
const inp = (X, code, value, attrs = '') => `<input id="f-${esc(code)}" data-f="${esc(code)}" value="${esc(value ?? '')}" ${X.msg(code) ? 'aria-invalid="true"' : ''} aria-describedby="e-${esc(code)}" ${attrs}>`;
export const seg = (label, path, options, cur, cls = '') => `<div class="seg wz-seg ${cls}" role="radiogroup" aria-label="${esc(label)}">${options.map(([v, t]) => `<button type="button" role="radio" aria-checked="${String(cur) === String(v)}" class="${String(cur) === String(v) ? 'on' : ''}" tabindex="${String(cur) === String(v) ? 0 : -1}" data-set="${esc(path)}" data-v="${esc(v)}">${t}</button>`).join('')}</div>`;
const head = (step, title, lead) => `<div class="wz-sh"><p class="wz-eyebrow">${esc(step)}</p><h3 id="wzStepTitle" tabindex="-1">${title}</h3><p class="wz-lead">${lead}</p></div>`;
const card = (title, body, aside = '') => `<section class="wz-card">${title ? `<h4>${title}${aside ? `<span>${aside}</span>` : ''}</h4>` : ''}${body}</section>`;

// ------------------------------------------------------------------ basics
function basics(W, X) {
  const d = W.draft, cities = X.ctx.cities, c = cities.find((x) => x.id === d.city);
  const generic = !cities.some((x) => x.id === d.city && x.id !== 'generic');   // [onboarding] any city without a profile
  const today = M.todayISO();
  const chips = [['Next 30 days', 0, 30], ['In 1 to 2 months', 30, 60], ['In 2 to 3 months', 60, 90]];
  return head('Step 1 of 8', 'What are we looking for?', 'Name the search and tell us where and when. Everything has a sensible default, so you can move fast and refine later.')
    + card('', fld(X, 'Search name', 'name', inp(X, 'name', d.name, 'type="text" maxlength="80" placeholder="Boston 2BR, fall 2026" autocomplete="off" required'), { tag: 'required', hint: 'Shown in the top bar and used for the folder name.', wide: true }))
    + card('City', `<div class="wz-cities" role="radiogroup" aria-label="City">${cities.map((x) => `<button type="button" role="radio" aria-checked="${x.id === d.city || (x.id === 'generic' && generic)}" class="wz-city ${x.id === d.city || (x.id === 'generic' && generic) ? 'on' : ''}" tabindex="${x.id === d.city || (x.id === 'generic' && generic) ? 0 : -1}" data-city="${esc(x.id)}"><b>${esc(x.name)}</b><small>${esc(x.id === 'nyc' ? x.note || '' : x.id === 'generic' ? x.note || '' : x.note || `City profile ${x.id}`)}</small></button>`).join('')}</div>`
      + (generic ? cityBlock(W, X) : '')
      + (generic ? `<div class="wz-places"><span class="wz-hint">Quick start</span><div class="chips">${M.PLACES.map(([n]) => `<button type="button" class="chip" data-place="${esc(n)}">${esc(n)}</button>`).join('')}</div></div>` : '')
      + `<div class="row wz-row">${fld(X, 'Time zone', 'timezone', inp(X, 'timezone', d.timezone, 'type="text" list="wzTz" placeholder="America/New_York" autocomplete="off"') + `<datalist id="wzTz">${M.TIMEZONES.map((z) => `<option value="${z}">`).join('')}</datalist>`, { hint: 'IANA name; used for sun hours and arrive-by times.' })}
        ${fld(X, 'Map opens at', 'map_center', `<div class="wz-ll"><input id="f-map_center" data-f="map.lat" type="text" inputmode="decimal" aria-label="Map latitude" placeholder="lat" value="${esc(d.map_center?.[0] ?? '')}" aria-describedby="e-map_center"><input data-f="map.lon" type="text" inputmode="decimal" aria-label="Map longitude" placeholder="lon" value="${esc(d.map_center?.[1] ?? '')}" aria-describedby="e-map_center"><button type="button" class="btn sm" data-pick="map">${I.pin}Pick</button></div>`, { hint: 'Optional. Otherwise the map centres on your first destination.' })}</div>`
      )
    + card('Move-in window', `<div class="row wz-row">${fld(X, 'Earliest start', 'move_in.earliest', inp(X, 'move_in.earliest', d.move_in.earliest, 'type="date"'))}${fld(X, 'Latest start', 'move_in.latest', inp(X, 'move_in.latest', d.move_in.latest, 'type="date"'))}</div>`
      + `<div class="chips wz-quick" aria-label="Quick windows">${chips.map(([t, a, b]) => `<button type="button" class="chip" data-window="${a},${b}">${t}</button>`).join('')}</div>`
      + `<label class="tg wz-tg ${d.move_in.hard ? 'on' : ''}" role="switch" aria-checked="${d.move_in.hard}" tabindex="0" data-toggle="move_in.hard"><span class="switch"></span><span class="lbl">Hard deadline<small>Units available after the latest date fail the gate instead of just being flagged.</small></span></label>`);
}

// [onboarding] the city's name box, its lookup result and what the city does not have
function cityBlock(W, X) {
  const d = W.draft, L = d.lookup;
  const note = !L ? '' : L.error ? `<div class="wz-note bad" role="status"><span>${esc(L.error)}</span></div>`
    : `<div class="wz-note good wz-found" role="status"><span class="ic">${I.check}</span><div><b>${esc(L.name)}</b>${L.timezone ? ` · ${esc(L.timezone)}` : ''}${L.osm ? ` · <a href="https://www.openstreetmap.org/${esc(L.osm)}" target="_blank" rel="noopener noreferrer">OpenStreetMap area</a>` : ''}`
      + `${L.missing?.length ? `<p class="wz-hint">What this city does not have built in:</p><ul class="wz-miss">${L.missing.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>` : ''}</div></div>`;
  return `<div class="wz-citybox">${fld(X, 'Your city', 'city_name', `<span class="wz-find">${inp(X, 'city_name', d.city_name, 'type="text" maxlength="80" placeholder="Chicago, IL" autocomplete="off"')}${W.api ? `<button type="button" class="btn sm" data-act="findcity"${W.finding ? ' disabled' : ''}>${W.finding ? 'Looking…' : 'Find it'}</button>` : ''}</span>`,
    { wide: true, hint: W.api ? 'Type the city and choose Find it: the time zone and where the map opens are filled in, and the transit feeds we know of are offered in the Places step.' : 'Type the city. This page cannot look it up, so use a quick start below or fill the time zone and map centre in yourself.' })}${note}</div>`;
}

// ------------------------------------------------------------------ places
function destCard(W, X, p, i) {
  const has = p.lat != null && p.lat !== '' && p.lon != null && p.lon !== '';
  const w = +p.weight, wopts = WEIGHTS.some(([v]) => v === w) ? WEIGHTS : [...WEIGHTS, [w, `Custom ${esc(p.weight)}`]];
  const f = (k) => `dest.${i}.${k}`;
  return `<section class="wz-card wz-dest" data-dest="${i}" aria-label="Destination ${i + 1}">
    <div class="wz-dest-h"><span class="wz-num" aria-hidden="true">${i + 1}</span>
      ${fld(X, 'Name', f('name'), inp(X, f('name'), p.name, 'type="text" maxlength="40" placeholder="Office" autocomplete="off"'))}
      <button type="button" class="icon-btn sm" data-del="dest" data-i="${i}" aria-label="Remove ${esc(p.name || 'destination')}">${I.x}</button></div>
    ${fld(X, 'Address', f('address'), inp(X, f('address'), p.address, 'type="text" placeholder="Street, city" autocomplete="off"'), { wide: true, hint: has ? '' : 'No map pin yet: place one below, or <code>apartmentscout geocode</code> will find the address for you.' })}
    <div class="wz-pin ${has ? 'set' : ''}"><span class="wz-pin-i">${I.pin}</span>
      <span class="wz-pin-t">${has ? `<b>${(+p.lat).toFixed(5)}, ${(+p.lon).toFixed(5)}</b><small>Placed on the map</small>` : '<b>Not placed on the map</b><small>Click the map for the exact spot</small>'}</span>
      ${W.api ? `<button type="button" class="btn sm" data-act="findaddr" data-i="${i}" title="Look the address up and drop the pin on it">${W.finding === `dest.${i}` ? 'Looking…' : 'Find address'}</button>` : ''}
      <button type="button" class="btn sm" data-pick="dest" data-i="${i}">${I.pin}${has ? 'Move pin' : 'Place on map'}</button>
      ${has ? `<button type="button" class="btn sm ghost" data-clearpin="${i}">Clear</button>` : ''}</div>
    <details class="wz-more" ${X.msg(f('lat')) ? 'open' : ''}><summary>Enter coordinates by hand</summary><div class="row wz-row">
      ${fld(X, 'Latitude', f('lat'), inp(X, f('lat'), p.lat ?? '', 'type="number" step="0.000001" inputmode="decimal"'))}${fld(X, 'Longitude', f('lon'), inp(X, f('lon'), p.lon ?? '', 'type="number" step="0.000001" inputmode="decimal"'))}</div></details>
    <div class="row wz-row">${fld(X, 'Arrive by', f('arrive_by'), inp(X, f('arrive_by'), p.arrive_by, 'type="time"'))}
      ${fld(X, 'Longest trip, minutes', f('max_minutes'), inp(X, f('max_minutes'), p.max_minutes, 'type="number" min="1" max="180" step="1" inputmode="numeric"'), { hint: 'A trip at the limit scores 50; half of it scores 100.' })}</div>
    <div class="wz-opts"><div class="wz-opt"><span class="wz-lbl">How much it matters</span>${seg('Weight', f('weight'), wopts, w)}</div>
    <div class="wz-opt"><span class="wz-lbl">Usual way there</span>${seg('Preferred mode', f('mode'), M.COMMUTE_MODES.map(([k]) => [k, MODE_NAMES[k]]), p.mode || 'best')}</div></div>
  </section>`;
}
function places(W, X) {
  const n = W.draft.destinations.length;
  return head('Step 2 of 8', 'Where do you go?', 'Work, a partner\'s office, a gym, family. Door-to-door commute times, the heat map and the commute score are computed for each place.')
    + (n ? W.draft.destinations.map((p, i) => destCard(W, X, p, i)).join('') : card('', '<p class="wz-empty">No destinations. Commute will not be scored, and the map will centre on the point you choose in Basics. You can add places any time.</p>'))
    + `<div class="wz-add"><button type="button" class="btn" data-add="dest" ${n >= 4 ? 'disabled' : ''}>${I.plus}Add a place</button><span class="wz-hint">${n} of 4</span></div>`
    + transitCard(W, X);
}
// [onboarding] which transit timetables the commute times use
function transitCard(W, X) {
  const d = W.draft, prof = X.ctx.cities.find((x) => x.id === d.city && x.id !== 'generic');
  if (prof) return card('Transit timetables', `<p class="wz-hint">The ${esc(prof.name)} profile brings its ${(prof.feeds || []).length} timetable feed${(prof.feeds || []).length === 1 ? '' : 's'} (${esc((prof.feeds || []).map((f) => f.name).join(', '))}). Nothing to add.</p>`);
  if (W.mode === 'edit' && S.crit0.commute?.transit?.feeds?.length) return card('Transit timetables', `<p class="wz-hint">This search already uses ${esc(S.crit0.commute.transit.feeds.map((f) => f.name || f.url).join(', '))}. Edit <code>commute.transit.feeds</code> in criteria.yaml to change them.</p>`);
  const feeds = d.feeds || [], have = new Set(feeds.map((f) => f.url)), starters = (d.lookup?.starter_feeds || []).filter((f) => !have.has(f.url));
  const rows = feeds.map((f, i) => `<div class="wz-feed">${fld(X, 'Name', `feed.${i}.name`, inp(X, `feed.${i}.name`, f.name, 'type="text" maxlength="60" autocomplete="off"'))}
      ${fld(X, 'GTFS zip address', `feed.${i}.url`, inp(X, `feed.${i}.url`, f.url, 'type="text" autocomplete="off" spellcheck="false" placeholder="https://.../gtfs.zip"'), { hint: f.check ? esc(f.check) : '' })}
      <button type="button" class="icon-btn sm" data-del="feed" data-i="${i}" aria-label="Remove ${esc(f.name || 'feed')}">${I.x}</button></div>`).join('');
  const chips = starters.length ? `<div class="wz-places"><span class="wz-hint">Feeds we know for ${esc(d.lookup?.name || 'this city')}</span><div class="chips">${starters.map((f, i) => `<button type="button" class="chip" data-starter="${i}">${I.plus}${esc(f.name)}</button>`).join('')}</div></div>` : '';
  return card('Transit timetables', `<p class="wz-hint">Transit commutes (subway, bus, best of transit) come from your agency's published timetable, a GTFS zip. With none, commute times are walking only.</p>
    ${rows}${chips}
    <div class="wz-fill"><input id="wzFeedUrl" type="text" autocomplete="off" spellcheck="false" placeholder="Paste a GTFS zip address (https://.../gtfs.zip)" aria-label="GTFS zip address"><button type="button" class="btn" data-act="addfeed">${I.plus}Add feed</button></div>
    <p class="wz-hint">Find one at the <a href="https://mobilitydatabase.org/feeds" target="_blank" rel="noopener noreferrer">Mobility Database</a>, <a href="https://www.transit.land/operators" target="_blank" rel="noopener noreferrer">Transitland</a>, or your transit agency's developer page ("GTFS" or "open data").</p>
    ${feeds.length ? '' : '<p class="wz-hint wz-warnline">No feed yet: commute times will be walking only. You can add one later with <code>apartmentscout city --feed URL</code>.</p>'}`);
}

// ------------------------------------------------------------------ money
function tierBar(b) {
  const tiers = b.tiers.filter((t) => +t.max > 0), cap = +b.hard_max > 0 ? +b.hard_max : (tiers.at(-1)?.max || 1) * 1.1, top = Math.max(cap, ...tiers.map((t) => +t.max)) * 1.04;
  if (!tiers.length) return '';
  let prev = 0;
  const segs = tiers.map((t, i) => { const w = ((+t.max - prev) / top) * 100; prev = +t.max; return `<i style="width:${w}%;background:var(${TIER_VARS[Math.min(i, 2)]})" title="${esc(t.name)} up to ${usd(t.max)}"></i>`; });
  if (cap > prev) segs.push(`<i class="slack" style="width:${((cap - prev) / top) * 100}%;background:var(--tier-over)" title="Up to the cap, flagged over target"></i>`);
  return `<div class="wz-tierbar" aria-hidden="true"><div class="bar">${segs.join('')}</div><div class="lab">${tiers.map((t) => `<span>${esc(t.name)}<b>${usd(t.max)}</b></span>`).join('')}${+b.hard_max > 0 ? `<span>Cap<b>${usd(b.hard_max)}</b></span>` : ''}</div></div>`;
}
function money(W, X) {
  const b = W.draft.budget;
  return head('Step 3 of 8', 'What can you pay?', 'Every unit is judged on one monthly number. Tiers label it on the map and in reports; the cap is the most you would ever pay.')
    + card('How fees count', `<div class="wz-basis" role="radiogroup" aria-label="Budget basis">${M.BASES.map(([k, t, d]) => `<button type="button" role="radio" aria-checked="${b.basis === k}" class="wz-opt-card ${b.basis === k ? 'on' : ''}" tabindex="${b.basis === k ? 0 : -1}" data-set="budget.basis" data-v="${k}"><b>${t}</b><small>${esc(d)}</small>${k === 'monthly_cost' ? '<em>Recommended</em>' : ''}</button>`).join('')}</div>`)
    + card('Budget tiers', `${b.tiers.map((t, i) => `<div class="wz-tier"><i style="background:var(${TIER_VARS[Math.min(i, 2)]})"></i>
        ${fld(X, 'Name', `tier.${i}.name`, inp(X, `tier.${i}.name`, t.name, 'type="text" maxlength="40" autocomplete="off"'))}
        ${fld(X, 'Up to, per month', `tier.${i}.max`, `<span class="money-in"><span>$</span>${inp(X, `tier.${i}.max`, t.max, 'type="number" min="0" step="25" inputmode="numeric"')}</span>`)}
        <button type="button" class="icon-btn sm" data-del="tier" data-i="${i}" aria-label="Remove ${esc(t.name)}" ${b.tiers.length < 2 ? 'disabled' : ''}>${I.x}</button></div>`).join('')}
      <p class="wz-err" data-err="tiers" role="alert">${esc(X.msg('tiers'))}</p>
      <div class="wz-add inline"><button type="button" class="btn sm ghost" data-add="tier" ${b.tiers.length >= 4 ? 'disabled' : ''}>${I.plus}Add tier</button>
        <label class="wz-fill"><span>Quick fill from a target rent</span><span class="money-in"><span>$</span><input type="number" id="wzTarget" min="0" step="50" inputmode="numeric" placeholder="3000" aria-label="Target monthly rent"></span><button type="button" class="btn sm" data-fill="tiers">${I.bolt}Fill</button></label></div>`, `${b.tiers.length} of 4`)
    + card('Hard cap', fld(X, 'The most you would pay per month', 'hard_max', `<span class="money-in"><span>$</span>${inp(X, 'hard_max', b.hard_max ?? '', 'type="number" min="0" step="25" inputmode="numeric" placeholder="none"')}</span>`, { hint: 'Above this a unit fails the budget gate. Leave empty for no cap.' }) + tierBar(b));
}

// ------------------------------------------------------------------ home
function home(W, X) {
  const u = W.draft.unit, lo = +u.sqft_floor || 0, g = +u.sqft_good || 0, hi = +u.sqft_great || 0, span = Math.max(1, hi * 1.08 - lo * 0.85), at = (v) => Math.max(0, Math.min(100, ((v - lo * 0.85) / span) * 100));
  const beds = +u.min_beds;
  return head('Step 4 of 8', 'How much room?', 'Size scores 0 at the floor, 50 at "good" and 100 at "great". A unit with fewer bedrooms than you asked for has its space score halved.')
    + card('Bedrooms', `<div class="wz-beds">${seg('Minimum bedrooms', 'unit.min_beds', [[0, 'Studio'], [1, '1'], [2, '2'], [3, '3'], [4, '4+']], beds)}</div><p class="wz-err" data-err="min_beds" role="alert">${esc(X.msg('min_beds'))}</p>`)
    + card('Size, in square feet', `<div class="row wz-row">${[['sqft_floor', 'Feels too small', 'scores 0'], ['sqft_good', 'Feels good', 'scores 50'], ['sqft_great', 'Feels great', 'scores 100']].map(([k, t, h]) => fld(X, t, k, `<span class="money-in"><input id="f-${k}" data-f="unit.${k}" type="number" min="1" step="25" inputmode="numeric" value="${esc(u[k])}" ${X.msg(k) ? 'aria-invalid="true"' : ''} aria-describedby="e-${k}"><span>ft²</span></span>`, { hint: h })).join('')}</div>`
      + (lo > 0 && hi > lo ? `<div class="wz-scale" aria-hidden="true"><div class="bar"><i style="left:${at(lo)}%"></i><i style="left:${at(g)}%"></i><i style="left:${at(hi)}%"></i></div><div class="lab"><span style="left:${at(lo)}%">0</span><span style="left:${at(g)}%">50</span><span style="left:${at(hi)}%">100</span></div></div>` : '')
      + `<div class="chips wz-quick"><span class="wz-hint">Typical sizes</span>${M.SIZE_PRESETS.map(([b, t, a, c, e]) => `<button type="button" class="chip" data-size="${b},${a},${c},${e}">${t} · ${a}/${c}/${e}</button>`).join('')}</div>`);
}

// ------------------------------------------------------------------ amenities
function amenities(W, X) {
  const d = W.draft, known = new Set(M.AMENITIES.map((a) => a.key)), custom = [...d.must_have, ...d.strongly_prefer, ...d.nice_to_have].filter((k) => !known.has(k));
  const rows = [...M.AMENITIES, ...custom.map((key) => ({ key, label: AMENITY_NAMES[key] || key.replaceAll('_', ' ') }))];
  const grp = (k) => GROUPS.find(([g]) => g && d[g].includes(k))?.[0] || '';
  return head('Step 5 of 8', 'What must the building have?', 'A deal-breaker fails any unit confirmed without it; one nobody has confirmed yet stays eligible, flagged as unverified. Keep that list short.')
    + `<div class="wz-counts">${GROUPS.slice(0, 3).map(([g, t]) => `<span class="pill ${g === 'must_have' && d[g].length > 4 ? 'warn' : g === 'must_have' ? 'accent' : ''}">${t} ${d[g].length}</span>`).join('')}${d.must_have.length > 4 ? '<span class="wz-hint warn">More than four deal-breakers will remove most units.</span>' : ''}</div>`
    + `<div class="wz-amen">${rows.map(({ key, label }) => `<div class="wz-am"><span class="n">${esc(label)}</span>${seg(label, `am:${key}`, GROUPS.map(([g, t]) => [g || 'off', t]), grp(key) || 'off', 'sm')}</div>`).join('')}</div>`
    + `<div class="wz-add inline"><label class="wz-fill"><span>Your own amenity key</span><input type="text" id="wzCustomAm" maxlength="30" placeholder="rooftop_pool" aria-label="Your own amenity key" autocomplete="off"><button type="button" class="btn sm" data-add="amenity">${I.plus}Add</button></label></div>`
    + `<p class="wz-hint">Your own keys only count once your listings carry them.</p>`;
}

// ------------------------------------------------------------------ taste
function taste(W, X) {
  const d = W.draft, sh = M.weightShares(d.weights, X.ctx), tw = M.tasteWeights(d.taste, X.ctx), lab = (k) => (X.ctx.dims.find((x) => x[0] === k) || [k, k])[1];
  return head('Step 6 of 8', 'Finish, view, light and quiet', 'How much do these matter to you? Each answer sets how heavily its part of the score counts. Skip any you have no view on.')
    + TASTE_ROWS(d, tw, sh, lab, X)
    + card('Buildings you already know', `<p class="wz-hint">Rate a building from 1 (avoid) to 5 (love). It is kept as <code>building_ratings</code> in criteria.yaml. Add more as you go.</p>
      ${d.building_ratings.map((r, i) => `<div class="wz-rate"><div class="wz-field${X.msg(`rating.${i}.name`) ? ' bad' : ''}"><input id="f-rating.${i}.name" data-f="rating.${i}.name" type="text" value="${esc(r.name)}" placeholder="Building name" aria-label="Building ${i + 1} name" maxlength="60" autocomplete="off" ${X.msg(`rating.${i}.name`) ? 'aria-invalid="true"' : ''}><p class="wz-err" data-err="rating.${i}.name" role="alert">${esc(X.msg(`rating.${i}.name`))}</p></div>
        <div class="wz-stars" role="radiogroup" aria-label="Rating for ${esc(r.name || 'building ' + (i + 1))}">${[1, 2, 3, 4, 5].map((n) => `<button type="button" role="radio" aria-checked="${+r.rating === n}" aria-label="${n} of 5" class="${+r.rating >= n ? 'on' : ''}" tabindex="${+r.rating === n || (!r.rating && n === 1) ? 0 : -1}" data-set="rating.${i}.rating" data-v="${n}">${I.star}</button>`).join('')}</div>
        <button type="button" class="icon-btn sm" data-del="rating" data-i="${i}" aria-label="Remove ${esc(r.name || 'building')}">${I.x}</button></div>`).join('')}
      <div class="wz-add inline"><button type="button" class="btn sm ghost" data-add="rating">${I.plus}Add a building</button></div>`);
}
function TASTE_ROWS(d, tw, sh, lab, X) {
  return `<div class="wz-taste">${M.TASTE.map((t) => {
    const lv = d.taste[t.id], dim = X.ctx.dims.some((x) => x[0] === t.dimension) ? t.dimension : 'building';
    return `<div class="wz-ti"><div class="t"><b>${esc(t.label)}</b><small>${esc(t.hint)}</small></div>
      <div class="seg wz-seg" role="radiogroup" aria-label="${esc(t.label)}">${M.TASTE_LEVELS.map((n, v) => `<button type="button" role="radio" aria-checked="${lv === v}" class="${lv === v ? 'on' : ''}" tabindex="${lv === v || (lv == null && v === 1) ? 0 : -1}" data-taste="${t.id}" data-lv="${v}">${n}</button>`).join('')}</div>
      <p class="fx">${lv == null ? 'Not set: the weight stays as it is' : `Sets <b>${esc(lab(dim))}</b> to ${tw[dim] ?? d.weights[dim]} (${sh[dim]}% of the score)`}</p></div>`;
  }).join('')}</div>`;
}

// ------------------------------------------------------------------ weights
function weights(W, X) {
  const d = W.draft, sh = M.weightShares(d.weights, X.ctx), over = M.weightOverrides(d, X.ctx), n = Object.keys(over).length, P = X.ctx.presets;
  const order = X.ctx.dims.map(([k]) => k).sort((a, b) => sh[b] - sh[a]);
  return head('Step 7 of 8', 'What matters most?', 'Pick a recipe, then nudge any dimension. Only the ratios count; each slider shows its share of the whole. You can re-weight live in the dashboard later too.')
    + card('Start from', `<div class="wz-presets" role="radiogroup" aria-label="Weight preset">${Object.entries(P).map(([k, p]) => `<button type="button" role="radio" aria-checked="${d.preset === k}" class="wz-opt-card ${d.preset === k ? 'on' : ''}" tabindex="${d.preset === k ? 0 : -1}" data-preset="${esc(k)}"><b>${esc(p.label || k)}</b><small>${esc(p.description || '')}</small></button>`).join('')}</div>`
      + (n ? `<p class="wz-hint">${n} adjustment${n === 1 ? '' : 's'} on top of ${esc(P[d.preset]?.label || d.preset)}. <button type="button" class="wz-link" data-preset="${esc(d.preset)}">Reset to the preset</button></p>` : '')
      + (Object.keys(M.tasteWeights(d.taste, X.ctx)).length ? '<p class="wz-hint">Your answers in the last step are laid on top of a preset automatically.</p>' : ''))
    + card('Share of the score', `<div class="wz-share" aria-hidden="true">${order.filter((k) => sh[k]).map((k, i) => `<i style="flex:${sh[k]};opacity:${Math.max(0.28, 1 - i * 0.13)}" title="${esc(X.ctx.dims.find((x) => x[0] === k)[1])} ${sh[k]}%"></i>`).join('')}</div>
      <div class="wz-weights">${X.ctx.dims.map(([k, t]) => `<div class="wz-w"><label for="w-${esc(k)}">${esc(t)}</label><input id="w-${esc(k)}" type="range" min="0" max="${M.WEIGHT_MAX}" step="1" value="${+d.weights[k] || 0}" data-w="${esc(k)}" style="--p:${((+d.weights[k] || 0) / M.WEIGHT_MAX) * 100}%" aria-valuetext="${+d.weights[k] || 0}, ${sh[k]} percent"><b data-share="${esc(k)}">${sh[k]}%</b></div>`).join('')}</div>
      <p class="wz-err" data-err="weights" role="alert">${esc(X.msg('weights'))}</p>`);
}

// ------------------------------------------------------------------ review
function review(W, X) {
  const { errors, diff, yaml, cmds, api, result, folder, server } = X.review;
  const bad = errors.length;
  const pre = `<div class="wz-code"><button type="button" class="btn sm wz-copy" data-copy="yaml">${I.copy}Copy</button><pre tabindex="0" aria-label="criteria.yaml preview">${esc(yaml)}</pre></div>`;
  const cmdBlock = (title, lines, key) => `<div class="wz-cmd"><div class="h"><b>${title}</b><button type="button" class="btn sm ghost" data-copy="${key}">${I.copy}Copy</button></div><pre tabindex="0" aria-label="${esc(title)} commands">${esc(lines.join('\n'))}</pre></div>`;
  let body = head('Step 8 of 8', W.mode === 'edit' ? 'Check the changes, then save' : 'Almost there', W.mode === 'edit' ? 'These are the criteria for the search that is open. Saving replaces criteria.yaml and keeps a backup of the old file.' : 'This is the criteria.yaml your answers make. Create the search, or take the file to the command line.');
  if (bad) body += `<div class="wz-note bad" role="alert"><b>${bad} thing${bad === 1 ? '' : 's'} to fix before this can be saved</b><ul>${errors.map((e) => `<li><button type="button" class="wz-link" data-goto="${esc(e.step)}">${esc(M.STEPS.find((s) => s.id === e.step)?.title || 'Review')}</button> ${esc(e.msg)}</li>`).join('')}</ul></div>`;
  if (server?.length) body += `<div class="wz-note bad" role="alert"><b>The server did not accept this</b><ul>${server.map((m) => `<li>${esc(m)}</li>`).join('')}</ul></div>`;
  if (result) body += resultHTML(W, X);
  if (W.mode === 'new' && api && !result) body += card('Where it goes', fld(X, 'Folder name', 'folder', `<span class="wz-folder"><span title="${esc(api.searches_dir || 'searches')}">${esc((api.searches_dir || 'searches').split('/').filter(Boolean).slice(-1)[0])}/</span>${inp(X, 'folder', W.draft.folder || folder, 'type="text" maxlength="60" autocomplete="off" spellcheck="false"')}</span>`, { hint: 'A new folder next to your other searches. Nothing existing is touched.' }));
  if (diff !== null) body += `<details class="wz-card wz-det" ${W.mode === 'edit' || diff.length <= 6 ? 'open' : ''}><summary><h4>${W.mode === 'edit' ? 'Changes to this search' : `How it differs from ${esc(X.currentName || 'the open search')}`}<span>${diff.length ? `${diff.length} difference${diff.length === 1 ? '' : 's'}` : 'none'}</span></h4></summary>${diff.length ? `<ul class="wz-diff">${diff.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : '<p class="wz-hint">No differences from the open search.</p>'}</details>`;
  body += card('criteria.yaml', pre, 'preview');
  if (W.mode === 'new' && !result) body += card('After you create it', nextHTML(M.nextSteps(`searches/${W.draft.folder || folder || 'your-search'}`)));
  if (!result || result.kind !== 'rescore') {
    body += card('At the command line', `<p class="wz-hint">${api ? 'Prefer the terminal? ' : 'This page cannot write files, so '}these do the same thing.</p>${cmdBlock('One step', [...cmds.oneStep, ...cmds.then], 'cli1')}${cmdBlock('Or step by step', [...cmds.twoStep, ...cmds.steps], 'cli2')}`);
  }
  return body;
}
// [onboarding] the steps after the questions (config/intake.yaml, `after`): listings, commutes, the buildings around each home, floor plans
const nextHTML = (steps) => `<ol class="wz-next">${steps.map((n) => `<li><b>${esc(n.title)}</b><p class="wz-hint">${esc(n.why)}</p><code tabindex="0" aria-label="Command">${esc(n.command)}</code></li>`).join('')}</ol>`;
export function resultHTML(W, X) {
  const r = X.review.result;
  if (!r) return '';
  const lines = r.next?.length ? `<div class="wz-cmd"><div class="h"><b>Next</b><button type="button" class="btn sm ghost" data-copy="next">${I.copy}Copy</button></div><pre tabindex="0" aria-label="Next commands">${esc(r.next.join('\n'))}</pre></div>` : '';
  if (r.kind === 'saved') return `<div class="wz-note good" role="status"><span class="ic">${I.check}</span><div><b>Saved criteria.yaml</b><p>${r.backup ? `The previous file is kept as <code>${esc(r.backup)}</code>.` : 'There was no previous file.'} Scores and the dashboard data still reflect the old criteria until you re-score.</p>${r.warnings?.length ? `<ul>${r.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}</div></div>${rescoreHTML(r)}${lines}`;
  if (r.kind === 'created') return `<div class="wz-note good" role="status"><span class="ic">${I.check}</span><div><b>Created the search</b><p><code>${esc(r.path)}</code> is ready. Next, in order:</p></div></div>${nextHTML(M.nextSteps(r.path))}${lines}`;
  return '';
}
function rescoreHTML(r) {
  const j = r.job;
  if (!j) return '';
  return `<div class="wz-job" role="status" aria-live="polite">${j.steps.map((s) => `<div class="st ${s.state}"><i aria-hidden="true">${s.state === 'done' ? I.check : s.state === 'error' ? I.x : ''}</i><span>${esc(s.name)}</span></div>`).join('')}${j.state === 'error' ? `<p class="wz-err on">${esc(j.error || 'Something went wrong.')}</p>` : j.state === 'done' ? `<p class="wz-hint">Done in ${j.seconds} s. Reload to see the new ranking.</p>` : ''}</div>`;
}

export const RENDER = { basics, places, money, home, amenities, taste, weights, review };
