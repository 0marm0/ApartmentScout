// Research queue: homes still in play ordered by research priority or by how many score points their unknown
// facts put at stake, with the missing facts as chips, lint findings by severity and generated questions to copy.
import { S, openDrawer, isSaved, cost, score, tierIndex, TIER_VARS, label, store } from '../app.js';
import { esc, money, ICONS, scoreColor } from '../util.js';
import { factLabel, derivedQueue } from './model.js';
import { thumb, copyText, empty, IC } from './ui.js';

const st = { saved: false, eligible: false, finalist: false, flags: false, sort: 'priority', shown: 40, open: new Set(), ...pickState(store.get('research-queue', {})) };
function pickState(o) { return o && typeof o === 'object' ? { saved: !!o.saved, eligible: !!o.eligible, finalist: !!o.finalist, flags: !!o.flags, sort: ['priority', 'impact', 'rank'].includes(o.sort) ? o.sort : 'priority' } : {}; }
const save = () => store.set('research-queue', { saved: st.saved, eligible: st.eligible, finalist: st.finalist, flags: st.flags, sort: st.sort });

const SORTS = {
  priority: (a, b) => (a.priority ?? 1e9) - (b.priority ?? 1e9) || b.impact - a.impact,
  impact: (a, b) => b.impact - a.impact || (a.priority ?? 1e9) - (b.priority ?? 1e9),
  rank: (a, b) => (a.L._rank ?? 1e9) - (b.L._rank ?? 1e9) || (score(b.L) ?? 0) - (score(a.L) ?? 0),
};
const SEV_TXT = { high: 'High', med: 'Medium', low: 'Low' };

function visible(rows) {
  return rows.filter((r) => (!st.saved || isSaved(r.L.id)) && (!st.eligible || r.L.score?.eligible) && (!st.finalist || r.finalist) && (!st.flags || r.maxSev >= 3)).sort(SORTS[st.sort]);
}

function rowHTML(r, maxImp) {
  const L = r.L, id = esc(L.id), t = tierIndex(L), qOpen = st.open.has(L.id);
  const stale = r.stale.filter((k) => !r.missing.includes(k));
  // the biggest gaps first; the rest fold into a "+n" chip so a row never becomes a wall of chips
  const more = (list, n, cls, what) => (list.length > n ? `<span class="rs-gap ${cls} more" title="${esc(list.slice(n).map(factLabel).join(', '))}">+${list.length - n} ${what}</span>` : '');
  const gaps = r.missing.slice(0, 6).map((k) => `<span class="rs-gap"${r.gapImpact[k] ? ` title="Knowing this could move the score by up to ${r.gapImpact[k].toFixed(1)} points"` : ''}>${esc(factLabel(k))}</span>`).join('') + more(r.missing, 6, '', 'more')
    + stale.slice(0, 2).map((k) => `<span class="rs-gap stale" title="Known, but the value is old and due a recheck">${esc(factLabel(k))} · stale</span>`).join('') + more(stale, 2, 'stale', 'stale');
  const lint = [...r.lint].sort((a, b) => ({ high: 0, med: 1, low: 2 })[a.severity] - ({ high: 0, med: 1, low: 2 })[b.severity]);
  const w = maxImp ? Math.max(4, (r.impact / maxImp) * 100) : 0;
  return `<article class="rq${isSaved(L.id) ? ' saved' : ''}" data-id="${id}">
    <span class="rq-n" title="Research priority">${r.priority ?? '–'}</span>
    <span class="rq-th">${thumb(L, 64, 48)}</span>
    <div class="rq-main">
      <div class="rq-t"><button type="button" class="rq-open" data-open="${id}">${esc(L.building || L.address || L.id)} <span>${esc(L.unit || '')}</span></button>${isSaved(L.id) ? `<span class="rq-star" title="Saved pick">${ICONS.star}</span>` : ''}</div>
      ${r.reason ? `<div class="rq-why">${esc(r.reason)}</div>` : ''}<div class="rq-s"><b>${money(cost(L))}</b>${L.score?.budget_tier ? `<span class="tierpill" style="color:var(${t >= 0 ? TIER_VARS[t] : '--tier-over'})"><i></i>${esc(L.score.budget_tier)}</span>` : ''}<span>${esc(L.neighborhood || '')}</span><span class="pill">${esc(L.status || 'new')}</span>${L._rank ? `<span class="faint">#${L._rank}</span>` : ''}</div>
    </div>
    <div class="rq-gaps">
      ${gaps ? `<div class="rq-chips" aria-label="Missing facts">${gaps}</div>` : '<div class="rq-done">Every fact in the standard is known</div>'}
      ${lint.length ? `<ul class="rq-lint" aria-label="Lint findings">${lint.slice(0, 2).map((x) => `<li class="sev-${x.severity}"><span class="sev">${SEV_TXT[x.severity]}</span>${esc(x.message)}</li>`).join('')}${lint.length > 2 ? `<li class="more">+ ${lint.length - 2} more</li>` : ''}</ul>` : ''}
    </div>
    <div class="rq-imp" title="How far the overall score could move once the missing facts are known">
      <b>${r.impact ? '±' + r.impact.toFixed(1) : '0'}</b><span>pts at stake</span><i class="rq-ibar"><i style="width:${w}%"></i></i>
    </div>
    <div class="rq-score" style="color:${scoreColor(score(L))}" title="Score with your weights">${Math.round(score(L) ?? 0)}</div>
    <div class="rq-act">${r.questions.length ? `<button type="button" class="btn ghost rq-qbtn" data-q="${id}" aria-expanded="${qOpen}" aria-controls="rqq-${id}">${IC.chev}Questions <span class="n">${r.questions.length}</span></button>` : '<span class="faint rq-noq">No questions</span>'}</div>
    ${r.questions.length ? `<div class="rq-qs" id="rqq-${id}"${qOpen ? '' : ' hidden'}><ol>${r.questions.map((q) => `<li>${esc(q)}</li>`).join('')}</ol><button type="button" class="btn rq-copy1" data-copy="${id}">${IC.copy}Copy these ${r.questions.length}</button></div>` : ''}
  </article>`;
}

function questionsText(rows) {
  const day = new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
  const blocks = rows.filter((r) => r.questions.length).map((r) => `${label(r.L)}${r.L.address ? ' (' + r.L.address + ')' : ''}\n${r.questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}`);
  return `Questions for the leasing office, ${day}\n\n${blocks.join('\n\n')}\n`;
}

export function render(el, { rows }) {
  const V = visible(rows);
  const maxImp = Math.max(0, ...V.map((r) => r.impact));
  const nSaved = rows.filter((r) => isSaved(r.L.id)).length, nElig = rows.filter((r) => r.L.score?.eligible).length, nFlag = rows.filter((r) => r.maxSev >= 3).length, nFin = rows.filter((r) => r.finalist).length;
  const S1 = V.slice(0, st.shown), nQ = S1.reduce((a, r) => a + r.questions.length, 0), nH = S1.filter((r) => r.questions.length).length;
  const chip = (k, t, n) => `<button type="button" class="chip ${st[k] ? 'on' : ''}" data-f="${k}" aria-pressed="${st[k]}">${t}<span class="n">${n}</span></button>`;
  el.innerHTML = `<div class="rs-bar-row">
      <div class="chips" role="group" aria-label="Filter the queue">${chip('saved', 'Saved picks', nSaved)}${chip('eligible', 'Eligible', nElig)}${nFin ? chip('finalist', 'Finalists', nFin) : ''}${chip('flags', 'High-severity flags', nFlag)}</div>
      <span class="sp"></span>
      <div class="seg" role="group" aria-label="Order the queue">${[['priority', 'Priority'], ['impact', 'Score impact'], ['rank', 'Rank']].map(([k, t]) => `<button type="button" data-sort="${k}" class="${st.sort === k ? 'on' : ''}" aria-pressed="${st.sort === k}">${t}</button>`).join('')}</div>
      <button type="button" class="btn primary" id="rqCopy" ${nQ ? '' : 'disabled'} title="Copies the questions for the ${S1.length} homes listed below, grouped by home">${IC.copy}Copy questions<span class="rq-cn">${nQ.toLocaleString()}</span></button>
    </div>
    <p class="rs-sub">${V.length.toLocaleString()} of ${rows.length.toLocaleString()} homes · ${st.sort === 'priority' ? 'highest research priority first' : st.sort === 'impact' ? 'most score points at stake first' : 'best ranked first'}${derivedQueue() ? ' · priorities and questions estimated in the browser until coverage.json exists' : ''}</p>
    ${V.length ? `<div class="rq-list">${V.slice(0, st.shown).map((r) => rowHTML(r, maxImp)).join('')}</div>${V.length > st.shown ? `<button type="button" class="btn ghost more-btn rs-more-btn" id="rqMore">Show ${Math.min(40, V.length - st.shown)} more of ${V.length - st.shown}</button>` : ''}`
      : empty(IC.queue, rows.length ? 'Nothing matches these filters' : 'Nothing in the research queue', rows.length ? 'Turn a filter off to see the rest of the queue.' : 'Homes that are still in play appear here with the facts they are missing.')}`;

  el.querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => { st[b.dataset.f] = !st[b.dataset.f]; st.shown = 40; save(); render(el, { rows }); el.querySelector(`[data-f="${b.dataset.f}"]`)?.focus(); }));
  el.querySelectorAll('[data-sort]').forEach((b) => b.addEventListener('click', () => { st.sort = b.dataset.sort; save(); render(el, { rows }); el.querySelector(`[data-sort="${b.dataset.sort}"]`)?.focus(); }));
  el.querySelector('#rqCopy')?.addEventListener('click', () => copyText(questionsText(S1), `Copied ${nQ} questions for ${nH} home${nH === 1 ? '' : 's'}`));
  el.querySelector('#rqMore')?.addEventListener('click', () => { st.shown += 40; render(el, { rows }); });
  const list = el.querySelector('.rq-list');
  list?.addEventListener('click', (e) => {
    const q = e.target.closest('[data-q]');
    if (q) {
      const id = q.dataset.q, open = !st.open.has(id);
      open ? st.open.add(id) : st.open.delete(id);
      q.setAttribute('aria-expanded', open);
      document.getElementById('rqq-' + id).hidden = !open;
      return;
    }
    const c = e.target.closest('[data-copy]');
    if (c) { const r = rows.find((x) => x.L.id === c.dataset.copy); if (r) copyText(questionsText([r]), `Copied ${r.questions.length} questions`); return; }
    if (e.target.closest('.rq-qs, a')) return;
    const row = e.target.closest('.rq');
    if (row) openDrawer(row.dataset.id);
  });
}
