// The searchable keyboard cheat sheet (press ?). Rows come from shortcuts.js; this file is the dialog around them:
// focus goes to the search box, Tab stays inside, Esc or a click outside closes it and focus goes back where it was.
import { S } from '../app.js';
import { esc } from '../util.js';
import { filterShortcuts, keyLabel } from './shortcuts.js';

const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
let root = null, back = null;

export const cheatOpen = () => !!root && !root.hidden;

const kbd = (k) => `<kbd>${esc(keyLabel(k, mac))}</kbd>`;
function comboHTML(cm, row) {
  if (row.chord) return cm.map(kbd).join('<span class="cs-then">then</span>');
  return cm.map(kbd).join('<span class="cs-plus" aria-hidden="true">+</span>');
}
function keysHTML(row) {
  if (row.range) { const [a, b] = row.range.split('–'); return `${kbd(a)}<span class="cs-then">to</span>${kbd(b)}`; }
  return row.combos.map((cm) => `<span class="cs-combo">${comboHTML(cm, row)}</span>`).join('<span class="cs-or">or</span>');
}

function render(q) {
  const groups = filterShortcuts(q, S.view === 'tours' ? 'list' : S.view);
  const n = groups.reduce((a, g) => a + g.rows.length, 0);
  const body = root.querySelector('#csBody');
  body.innerHTML = groups.length ? groups.map((g) => `<section class="cs-g${g.current ? ' now' : ''}" aria-labelledby="cs-h-${g.id}">
      <h3 id="cs-h-${g.id}">${esc(g.title)}${g.current ? '<span class="cs-badge">This view</span>' : ''}</h3>
      <ul>${g.rows.map((r) => `<li class="cs-r"><span class="cs-k">${keysHTML(r)}</span><span class="cs-d">${esc(r.desc)}</span></li>`).join('')}</ul></section>`).join('')
    : `<div class="cs-empty"><b>No shortcut matches “${esc(q)}”</b><span>Try a key (z, esc, g), or a word such as compare, undo, rotate or sun.</span></div>`;
  root.querySelector('#csCount').textContent = `${n} shortcut${n === 1 ? '' : 's'}${q.trim() ? ' found' : ''}`;
}

export function openCheatSheet() {
  if (cheatOpen()) { root.querySelector('#csQ').focus(); return; }
  if (!root) {
    root = document.createElement('div');
    root.className = 'cs-scrim'; root.hidden = true;
    root.innerHTML = `<div class="cs" role="dialog" aria-modal="true" aria-labelledby="csTitle">
      <header class="cs-h"><h2 id="csTitle">Keyboard shortcuts</h2><button type="button" class="cs-x" id="csX" aria-label="Close the cheat sheet" title="Close (Esc)"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/></svg></button></header>
      <div class="cs-search"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/></svg>
        <input id="csQ" type="search" autocomplete="off" spellcheck="false" placeholder="Search shortcuts: undo, compare, rotate, sun…" aria-label="Search shortcuts" aria-controls="csBody"></div>
      <div class="cs-body" id="csBody" tabindex="0" role="region" aria-label="Shortcuts"></div>
      <footer class="cs-f"><span id="csCount" role="status" aria-live="polite"></span><span class="sp"></span><span><kbd>?</kbd> or <kbd>Esc</kbd> to close</span></footer></div>`;
    document.body.append(root);
    const q = root.querySelector('#csQ');
    q.addEventListener('input', () => render(q.value));
    root.addEventListener('mousedown', (e) => { if (e.target === root) closeCheatSheet(); });
    root.querySelector('#csX').addEventListener('click', closeCheatSheet);
    root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeCheatSheet(); return; }
      if (e.key === '?' && e.target !== q) { e.preventDefault(); e.stopPropagation(); closeCheatSheet(); return; }
      if (e.key === 'Tab') {
        const f = [root.querySelector('#csX'), q, root.querySelector('#csBody')];   // DOM order
        const i = f.indexOf(document.activeElement);
        if (i < 0) { e.preventDefault(); q.focus(); return; }
        const n = (i + (e.shiftKey ? -1 : 1) + f.length) % f.length;
        if ((e.shiftKey && i === 0) || (!e.shiftKey && i === f.length - 1)) { e.preventDefault(); f[n].focus(); }
      }
    });
  }
  back = document.activeElement;
  const q = root.querySelector('#csQ');
  q.value = '';
  render('');
  root.hidden = false;
  requestAnimationFrame(() => { root.classList.add('on'); q.focus(); });
  document.body.dataset.cheat = '';
}

export function closeCheatSheet() {
  if (!cheatOpen()) return;
  root.classList.remove('on');
  delete document.body.dataset.cheat;
  const done = () => { root.hidden = true; };
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) done(); else setTimeout(done, 140);
  if (back?.isConnected && back !== document.body) back.focus?.({ preventScroll: true });
  back = null;
}
