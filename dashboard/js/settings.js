// Search settings sheet: edit the search profile (budget, amenities, move-in window, size, commute destinations),
// preview what it changes, apply it as a browser preview, reset to criteria.yaml, or export a criteria.yaml snippet.
// Opened from the search-name button in the top bar and the search row at the top of the filter rail.
import { S, download, applyCriteria, scoreDay, TIER_VARS } from './app.js';
import { $, esc, ICONS, toast } from './util.js';
import { BASES, COMMUTE_MODES, profileOf, applyProfile, validateProfile, diffProfile, previewImpact, serverSteps, toYAML, amenityKeys } from './criteria.js';

let draft = null, root = null, lastFocus = null, previewed = null;
const GROUPS = [['must_have', 'Must'], ['strongly_prefer', 'Strong'], ['nice_to_have', 'Nice'], ['', 'Off']];
const clone = (o) => JSON.parse(JSON.stringify(o));

export function openSettings() {
  draft = clone(S.preview?.profile || profileOf(S.crit0));
  previewed = null;
  lastFocus = document.activeElement;
  document.body.classList.remove('rail-open');
  if (!root) {
    root = document.createElement('div');
    root.className = 'sheet-scrim'; root.id = 'critSheet';
    root.addEventListener('mousedown', (e) => { if (e.target === root) close(); });
    root.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } }, true);
    document.body.append(root);
  }
  root.hidden = false; root.classList.remove('picking');
  render();
  requestAnimationFrame(() => root.classList.add('on'));
  root.querySelector('.sh-close')?.focus();
}
function close() {
  if (!root) return;
  root.classList.remove('on');
  setTimeout(() => { root.hidden = true; }, 180);
  lastFocus?.focus?.();
}

// ------------------------------------------------------------------ markup
function render() {
  const keepScroll = root.querySelector('.sh-body')?.scrollTop || 0;
  const b = draft.budget, base = profileOf(S.crit0), changes = diffProfile(base, draft);
  root.innerHTML = `<aside class="sheet" role="dialog" aria-modal="true" aria-labelledby="shTitle">
    <header class="sh-h"><div class="t"><h2 id="shTitle">Search settings</h2><p>${esc(S.crit0.search?.name || 'Your search')} · edits stay in this browser until you export them</p></div>
      <button type="button" class="icon-btn sh-close" aria-label="Close search settings">${ICONS.x}</button></header>
    <div class="sh-body">
      ${S.preview ? `<div class="sh-note pv"><b>Previewing edited criteria.</b> Rankings, gates and tiers on screen use the values below, not criteria.yaml.</div>` : ''}
      <section class="sh-sec"><h3>Budget <span>what the tiers compare</span></h3>
        <div class="seg sh-basis" role="radiogroup" aria-label="Budget basis">${BASES.map(([k, t]) => `<button type="button" role="radio" aria-checked="${b.basis === k}" class="${b.basis === k ? 'on' : ''}" data-basis="${k}">${t}</button>`).join('')}</div>
        <p class="sh-hint">${esc((BASES.find((x) => x[0] === b.basis) || BASES[0])[2])}.</p>
        <div class="sh-tiers">${b.tiers.map((t, i) => `<div class="sh-tier"><i style="background:var(${TIER_VARS[i] || '--tier-3'})"></i>
          <input type="text" value="${esc(t.name)}" data-tier-name="${i}" aria-label="Tier ${i + 1} name" maxlength="40">
          <label class="money-in"><span>≤ $</span><input type="number" inputmode="numeric" min="0" step="25" value="${esc(t.max)}" data-tier-max="${i}" aria-label="${esc(t.name)} maximum per month"></label>
          <button type="button" class="icon-btn sm" data-tier-del="${i}" aria-label="Remove ${esc(t.name)}" ${b.tiers.length < 2 ? 'disabled' : ''}>${ICONS.x}</button></div>`).join('')}</div>
        <div class="row sh-row"><button type="button" class="btn sm ghost" data-add="tier" ${b.tiers.length >= 4 ? 'disabled' : ''}>${ICONS.plus}Add tier</button>
          <label class="field sh-cap"><span class="lbl">Hard cap <span class="faint">above = over budget</span></span><span class="money-in"><span>$</span><input type="number" inputmode="numeric" min="0" step="25" value="${esc(b.hard_max ?? '')}" data-cap aria-label="Hard cap per month"></span></label></div>
      </section>
      <section class="sh-sec"><h3>Amenities <span>must-haves gate, the rest score</span></h3>
        <p class="sh-hint">A must-have marked false in the data fails the listing; one nobody has confirmed yet stays eligible as <b>unverified</b>.</p>
        <div class="sh-amen">${amenityKeys(S.listings, S.crit0).map(({ k, known, label }) => { const g = GROUPS.find(([gk]) => gk && draft[gk].includes(k))?.[0] || ''; return `<div class="sh-am"><span class="n">${esc(label)}<small>${known ? `known for ${known} of ${S.listings.length}` : 'not in the data yet'}</small></span>
          <div class="seg" role="radiogroup" aria-label="${esc(label)}">${GROUPS.map(([gk, gt]) => `<button type="button" role="radio" aria-checked="${g === gk}" class="${g === gk ? 'on' : ''}" data-am="${esc(k)}" data-grp="${gk}">${gt}</button>`).join('')}</div></div>`; }).join('')}</div>
      </section>
      <section class="sh-sec"><h3>Move-in window</h3>
        <div class="row"><label class="field"><span class="lbl">Earliest</span><input type="date" value="${esc(draft.move_in.earliest)}" data-mi="earliest"></label>
          <label class="field"><span class="lbl">Latest</span><input type="date" value="${esc(draft.move_in.latest)}" data-mi="latest"></label></div>
        <label class="tg sh-tg ${draft.move_in.hard ? 'on' : ''}" role="switch" aria-checked="${draft.move_in.hard}" tabindex="0" data-hard><span class="switch"></span><span class="lbl">Hard deadline <small>available after the window fails the listing instead of warning</small></span></label>
      </section>
      <section class="sh-sec"><h3>Size <span>scores 0 at the floor, 50 at good, 100 at great</span></h3>
        <div class="row">${[['min_beds', 'Min bedrooms', 1], ['sqft_floor', 'Floor ft²', 25], ['sqft_good', 'Good ft²', 25], ['sqft_great', 'Great ft²', 25]].map(([k, t, st]) => `<label class="field sh-num"><span class="lbl">${t}</span><input type="number" inputmode="numeric" min="0" step="${st}" value="${esc(draft.unit[k])}" data-unit="${k}"></label>`).join('')}</div>
      </section>
      <section class="sh-sec"><h3>Commute destinations <span>${draft.destinations.length} of up to 4</span></h3>
        ${draft.destinations.map((d, i) => destHTML(d, i)).join('')}
        <button type="button" class="btn sm ghost" data-add="dest" ${draft.destinations.length >= 4 ? 'disabled' : ''}>${ICONS.plus}Add destination</button>
      </section>
      <div class="sh-out" id="shOut" aria-live="polite">${previewed ? previewHTML() : ''}</div>
    </div>
    <footer class="sh-f"><div class="l"><button type="button" class="btn sm ghost" data-act="reset" ${!S.preview && !changes.length ? 'disabled' : ''}>Reset to criteria.yaml</button><button type="button" class="btn sm ghost" data-act="export">Export criteria.yaml</button></div>
      <span class="sh-count faint">${changes.length ? `${changes.length} change${changes.length === 1 ? '' : 's'}` : 'No changes'}</span>
      <button type="button" class="btn" data-act="preview">Preview</button><button type="button" class="btn primary" data-act="apply">Apply</button></footer></aside>`;
  wire();
  root.querySelector('.sh-body').scrollTop = keepScroll;
}
function destHTML(d, i) {
  const orig = (S.crit0.commute?.destinations || []).find((o) => o.name === d.name);
  const moved = !orig || orig.lat == null || Math.abs((+d.lat || 0) - orig.lat) > 5e-4 || Math.abs((+d.lon || 0) - orig.lon) > 5e-4 || (orig.arrive_by || '') !== (d.arrive_by || '');
  return `<div class="sh-dest" data-dest="${i}">
    <div class="row"><label class="field"><span class="lbl">Name</span><input type="text" value="${esc(d.name)}" data-d="name" maxlength="40" placeholder="Office"></label>
      <label class="field sh-mode"><span class="lbl">Preferred mode</span><select data-d="mode">${COMMUTE_MODES.map(([k, t]) => `<option value="${k}" ${d.mode === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <button type="button" class="icon-btn sm sh-del" data-dest-del="${i}" aria-label="Remove ${esc(d.name || 'destination')}">${ICONS.x}</button></div>
    <div class="row"><label class="field sh-wide"><span class="lbl">Address</span><input type="text" value="${esc(d.address)}" data-d="address" placeholder="Street, city"></label></div>
    <div class="row"><label class="field sh-num"><span class="lbl">Latitude</span><input type="number" step="0.000001" value="${esc(d.lat ?? '')}" data-d="lat"></label>
      <label class="field sh-num"><span class="lbl">Longitude</span><input type="number" step="0.000001" value="${esc(d.lon ?? '')}" data-d="lon"></label>
      <button type="button" class="btn sm sh-pick" data-pick="${i}">Pick on map</button></div>
    <div class="row"><label class="field sh-num"><span class="lbl">Arrive by</span><input type="time" value="${esc(d.arrive_by)}" data-d="arrive_by"></label>
      <label class="field sh-num"><span class="lbl">Max minutes</span><input type="number" min="1" step="1" value="${esc(d.max_minutes)}" data-d="max_minutes"></label>
      <label class="field sh-num"><span class="lbl">Weight</span><input type="number" min="0" step="0.1" value="${esc(d.weight)}" data-d="weight"></label></div>
    <p class="sh-hint warn" data-hint ${moved ? '' : 'hidden'}>${destHint(orig)}</p>
  </div>`;
}
const destHint = (orig) => `${orig ? 'Moved or retimed' : 'New'}: transit minutes and the map surface need <code>apartmentscout commute</code>. Walking is estimated from distance straight away.`;
function refreshHint(box, d) {
  const orig = (S.crit0.commute?.destinations || []).find((o) => o.name === d.name);
  const moved = !orig || orig.lat == null || Math.abs((+d.lat || 0) - orig.lat) > 5e-4 || Math.abs((+d.lon || 0) - orig.lon) > 5e-4 || (orig.arrive_by || '') !== (d.arrive_by || '');
  const h = box.querySelector('[data-hint]'); h.hidden = !moved; h.innerHTML = destHint(orig);
}
function previewHTML() {
  const { errors, im, steps, changes } = previewed;
  if (errors.length) return `<div class="sh-note bad"><b>Fix these first</b><ul>${errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>`;
  if (!changes.length) return `<div class="sh-note">Nothing changed from criteria.yaml.</div>`;
  const d = im.eligibleAfter - im.eligibleBefore;
  return `<div class="sh-prev"><h3>Preview <span>re-evaluated in this browser</span></h3>
    <div class="metrics">
      <div class="metric"><div class="k">Eligible</div><div class="v">${im.eligibleAfter}<small>${d === 0 ? 'no change' : (d > 0 ? '+' : '−') + Math.abs(d)}</small></div><div class="s">was ${im.eligibleBefore}</div></div>
      <div class="metric"><div class="k">Drop out</div><div class="v">${im.lost.length}</div><div class="s">${im.gained.length} come in</div></div>
      <div class="metric"><div class="k">Tier changes</div><div class="v">${im.tierChanged}</div><div class="s">${im.overBudget} over the cap</div></div>
      <div class="metric"><div class="k">Must-haves</div><div class="v">${im.failsMust}<small>fail</small></div><div class="s">${im.unverifiedMust} unverified</div></div></div>
    <ul class="sh-changes">${changes.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
    <h4>Not recomputed here</h4>
    <ul class="sh-steps">${steps.map((x) => `<li><span>${esc(x.what)}</span>${x.cmd ? `<code>${esc(x.cmd)}</code>` : ''}</li>`).join('')}</ul></div>`;
}

// ------------------------------------------------------------------ behaviour
function wire() {
  const R = root, q = (s) => R.querySelectorAll(s);
  R.querySelector('.sh-close').addEventListener('click', close);
  const touch = () => { previewed = null; const o = $('shOut'); if (o) o.innerHTML = ''; const n = diffProfile(profileOf(S.crit0), draft).length; R.querySelector('.sh-count').textContent = n ? `${n} change${n === 1 ? '' : 's'}` : 'No changes'; };
  q('[data-basis]').forEach((x) => x.addEventListener('click', () => { draft.budget.basis = x.dataset.basis; previewed = null; render(); }));
  q('[data-tier-name]').forEach((x) => x.addEventListener('input', () => { draft.budget.tiers[+x.dataset.tierName].name = x.value; touch(); }));
  q('[data-tier-max]').forEach((x) => x.addEventListener('input', () => { draft.budget.tiers[+x.dataset.tierMax].max = x.value === '' ? '' : +x.value; touch(); }));
  q('[data-tier-del]').forEach((x) => x.addEventListener('click', () => { draft.budget.tiers.splice(+x.dataset.tierDel, 1); previewed = null; render(); }));
  R.querySelector('[data-cap]').addEventListener('input', (e) => { draft.budget.hard_max = e.target.value === '' ? null : +e.target.value; touch(); });
  q('[data-am]').forEach((x) => x.addEventListener('click', () => {
    const k = x.dataset.am;
    for (const [g] of GROUPS) if (g) draft[g] = draft[g].filter((v) => v !== k);
    if (x.dataset.grp) draft[x.dataset.grp].push(k);
    previewed = null; render();
  }));
  q('[data-mi]').forEach((x) => x.addEventListener('input', () => { draft.move_in[x.dataset.mi] = x.value; touch(); }));
  const hard = R.querySelector('[data-hard]');
  const flip = () => { draft.move_in.hard = !draft.move_in.hard; previewed = null; render(); };
  hard.addEventListener('click', (e) => { e.preventDefault(); flip(); });
  hard.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); flip(); } });
  q('[data-unit]').forEach((x) => x.addEventListener('input', () => { draft.unit[x.dataset.unit] = x.value === '' ? '' : +x.value; touch(); }));
  q('.sh-dest').forEach((box) => {
    const i = +box.dataset.dest, d = draft.destinations[i];
    box.querySelectorAll('[data-d]').forEach((x) => x.addEventListener(x.tagName === 'SELECT' ? 'change' : 'input', () => {
      const k = x.dataset.d;
      d[k] = ['lat', 'lon', 'max_minutes', 'weight'].includes(k) ? (x.value === '' ? null : +x.value) : x.value;
      touch(); refreshHint(box, d);
    }));
  });
  q('[data-dest-del]').forEach((x) => x.addEventListener('click', () => { draft.destinations.splice(+x.dataset.destDel, 1); previewed = null; render(); }));
  q('[data-pick]').forEach((x) => x.addEventListener('click', () => pickOnMap(+x.dataset.pick)));
  q('[data-add]').forEach((x) => x.addEventListener('click', () => {
    if (x.dataset.add === 'tier') { const last = draft.budget.tiers[draft.budget.tiers.length - 1]; draft.budget.tiers.push({ name: `Tier ${draft.budget.tiers.length + 1}`, max: (+last?.max || 3000) + 250 }); }
    else draft.destinations.push({ name: `Place ${draft.destinations.length + 1}`, address: '', lat: null, lon: null, arrive_by: '09:00', max_minutes: 30, weight: 1, mode: 'best' });
    previewed = null; render();
    if (x.dataset.add === 'dest') R.querySelector('.sh-dest:last-of-type input')?.focus();
  }));
  q('[data-act]').forEach((x) => x.addEventListener('click', () => act(x.dataset.act)));
}
function act(k) {
  if (k === 'preview') {
    const errors = validateProfile(draft), changes = diffProfile(profileOf(S.crit0), draft);
    let im = null, steps = [];
    if (!errors.length && changes.length) {
      const crit = applyProfile(S.crit0, draft);
      im = previewImpact(S.listings, crit, scoreDay());
      steps = serverSteps(S.crit0, crit, im);
    }
    previewed = { errors, im, steps, changes };
    $('shOut').innerHTML = previewHTML();
    $('shOut').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  } else if (k === 'apply') {
    const errors = validateProfile(draft);
    if (errors.length) { previewed = { errors, changes: [] }; $('shOut').innerHTML = previewHTML(); $('shOut').scrollIntoView({ block: 'nearest' }); return; }
    applyCriteria(clone(draft)); close();
  } else if (k === 'reset') {
    draft = profileOf(S.crit0); previewed = null;
    if (S.preview) applyCriteria(null);
    render();
  } else if (k === 'export') {
    const slug = String(S.crit0.search?.name || 'search').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    download(`criteria-${slug || 'search'}.yaml`, toYAML(draft, S.crit0.search?.name || ''), 'text/yaml');
    toast('Saved a criteria.yaml snippet: paste it into criteria.yaml, then run apartmentscout score');
  }
}
async function pickOnMap(i) {
  const d = draft.destinations[i];
  root.classList.add('picking');
  if (S.view !== 'map') location.hash = '#map';
  try {
    const m = await import('./map.js');
    await m.show?.();
    const pt = await m.pickPoint(d.name || 'the destination');
    if (pt) { d.lat = +pt.lat.toFixed(6); d.lon = +pt.lon.toFixed(6); }
  } catch { toast('The map could not load, so type the coordinates instead'); }
  root.classList.remove('picking');
  render();
  root.querySelector(`.sh-dest[data-dest="${i}"]`)?.scrollIntoView({ block: 'center' });
}
