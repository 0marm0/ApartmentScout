// The Sync panel (a sheet on the right on a desktop, a bottom sheet on a phone) and the status row in the menu. Opened from Menu > Data > "Sync
// across devices", the command palette, or `?sync` in the address (the link the file-sync instructions use). The panel only talks to engine.js.
import { download } from '../app.js';
import { esc, toast } from '../util.js';
import * as E from './engine.js';
import { statusLine, ago, size, mergeLine } from './sync-text.js';
import { TOKEN_PAGE, CLASSIC_TOKEN_PAGE, looksLikeToken } from './gist-client.js';
import { LIMITS } from './sync-model.js';

const $ = (id) => document.getElementById(id);
const I = {
  x: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
  sync: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13.2 6.2A5.4 5.4 0 003.3 5M2.8 9.8A5.4 5.4 0 0012.7 11"/><path d="M3.4 2.4v2.8h2.8M12.6 13.6v-2.8H9.8"/></svg>',
  ext: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M6 3H3v10h10v-3M9 3h4v4M13 3L7 9"/></svg>',
  lock: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.8"/><path d="M5.2 7V5.2a2.8 2.8 0 015.6 0V7"/></svg>',
  file: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4 1.5h5.5L12.5 4.5v10h-8.5zM9.5 1.5v3h3"/></svg>',
  check: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M3 8.5l3 3 7-7"/></svg>',
  phone: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="4.5" y="1.6" width="7" height="12.8" rx="1.8"/><path d="M7 12.2h2"/></svg>',
  mac: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="2" y="3" width="12" height="8" rx="1.6"/><path d="M5.5 13.5h5"/></svg>',
};

let pane = 'gist', root = null, opener = null, draftToken = '', draftGist = '', busy = '', note = null, prepared = null, preparing = 0, ticker = 0, unsub = null, fileWithPhotos = null;

// ------------------------------------------------------------------ the menu row
function paintMenu(s) {
  const st = statusLine(s), el = $('mnSyncSt'), btn = $('menuBtn');
  if (el) { el.textContent = s.target === 'off' ? 'Off' : st.text.replace(/^Sync file: /, ''); el.dataset.tone = st.tone; }
  if (btn) { if (s.target === 'off') btn.removeAttribute('data-sync'); else btn.dataset.sync = st.tone; }
}
export function initSyncUi() {
  E.onChange(paintMenu);
  paintMenu(E.status());
  setInterval(() => paintMenu(E.status()), 30000);
  if (new URLSearchParams(location.search).has('sync')) openSync();
}

// ------------------------------------------------------------------ the panel
export function openSync() {
  opener = document.activeElement;
  document.body.classList.remove('rail-open');
  if (!root) {
    root = document.createElement('div');
    root.className = 'sheet-scrim sync-scrim'; root.id = 'syncSheet';
    root.addEventListener('mousedown', (e) => { if (e.target === root) close(); });
    root.addEventListener('keydown', onKey, true);
    root.addEventListener('click', onClick);
    root.addEventListener('input', onInput);
    root.addEventListener('change', onChange);
    document.body.append(root);
  }
  root.hidden = false;
  note = null;
  pane = E.status().target === 'file' ? 'file' : 'gist';
  render();
  requestAnimationFrame(() => root.classList.add('on'));
  root.querySelector('.sh-close')?.focus();
  unsub = E.onChange(() => paintStatus());
  ticker = setInterval(paintStatus, 20000);
  if (pane === 'file') prepare();
}
export function close() {
  if (!root || root.hidden) return;
  root.classList.remove('on');
  unsub?.(); unsub = null; clearInterval(ticker);
  draftToken = ''; draftGist = '';
  setTimeout(() => { if (!root.classList.contains('on')) root.hidden = true; }, 180);
  opener?.focus?.();
}
export const isOpen = () => !!root && !root.hidden && root.classList.contains('on');

function onKey(e) {
  if (e.key === 'Escape') { e.stopPropagation(); close(); return; }
  if (e.key !== 'Tab') return;
  const f = [...root.querySelectorAll('button, [href], input, select, textarea, summary, [tabindex]:not([tabindex="-1"])')].filter((x) => !x.disabled && x.offsetParent !== null);
  if (!f.length) return;
  const first = f[0], last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

// ------------------------------------------------------------------ markup
function paintStatus() {
  if (!root || root.hidden) return;
  const s = E.status(), st = statusLine(s);
  const line = root.querySelector('[data-sy-line]');
  if (line) { line.textContent = st.text; line.dataset.tone = st.tone; }
  const dot = root.querySelector('[data-sy-dot]'); if (dot) dot.dataset.tone = st.tone;
  const now = root.querySelector('[data-sy-now]'); if (now) { now.disabled = s.phase === 'syncing'; now.classList.toggle('spin', s.phase === 'syncing'); }
  const dev = root.querySelector('[data-sy-devices]'); if (dev) dev.innerHTML = devicesHTML(s);
  const hero = root.querySelector('.sy-hero'); if (hero) hero.dataset.tone = st.tone;
  if (s.target === 'gist' && s.error && root.querySelector('[data-sy-error]') == null) render();
  const err = root.querySelector('[data-sy-error]'); if (err) { err.hidden = !s.error; err.textContent = s.error?.message || ''; }
  const last = root.querySelector('[data-sy-last]'); if (last) last.innerHTML = lastHTML(s);
}
function devicesHTML(s) {
  const all = { ...s.devices, [s.deviceId]: { name: s.device, at: s.lastSync || s.devices[s.deviceId]?.at } };
  const items = Object.entries(all).sort(([a], [b]) => (b === s.deviceId) - (a === s.deviceId)).map(([id, d]) => {
    const me = id === s.deviceId, name = d.name || 'A device', ic = /iPhone|Android|iPad/.test(name) ? I.phone : I.mac;
    return `<li class="${me ? 'me' : ''}">${ic}<span><b>${esc(name)}</b>${me ? ' <i>this device</i>' : ''}</span><small>${d.at ? esc(ago(d.at)) : ''}</small></li>`;
  });
  return items.length > 1 ? `<h4>Devices that sync here</h4><ul class="sy-devs">${items.join('')}</ul>` : '';
}
function lastHTML(s) {
  const l = s.last;
  if (!l) return '';
  const parts = [];
  if (l.pulled) parts.push(`${l.pulled} item${l.pulled === 1 ? '' : 's'} from ${esc(l.from)}`);
  if (l.pushed) parts.push('sent changes to GitHub');
  if (l.photos?.stored) parts.push(`${l.photos.stored} photo${l.photos.stored === 1 ? '' : 's'} saved here`);
  if (l.photos?.added) parts.push(`${l.photos.added} photo${l.photos.added === 1 ? '' : 's'} added to the gist`);
  return parts.length ? `<span>Last check: ${parts.join(', ')}.</span>` : '<span>Last check: nothing had changed.</span>';
}

function heroHTML(s) {
  const st = statusLine(s);
  const gist = s.connected;
  return `<section class="sy-hero" data-tone="${st.tone}" aria-live="polite">
    <span class="sy-dot" data-sy-dot data-tone="${st.tone}" aria-hidden="true"></span>
    <div class="sy-hero-t"><b data-sy-line data-tone="${st.tone}">${esc(st.text)}</b>
      <small>${s.target === 'off' ? 'Your picks, notes and tour findings stay in this browser.' : s.target === 'file' ? 'Move a file between your devices by hand.' : `Between this ${esc(s.device)} and your other devices.`}</small></div>
    ${gist ? `<button type="button" class="btn sy-now" data-sy-now ${s.phase === 'syncing' ? 'disabled' : ''}>${I.sync}<span>Sync now</span></button>` : ''}
  </section>
  <p class="sy-err" data-sy-error role="alert" ${s.error ? '' : 'hidden'}>${esc(s.error?.message || '')}</p>`;
}

function targetHTML() {
  const T = [['gist', 'GitHub gist', 'Automatic · recommended'], ['file', 'Sync file', 'By hand · no account']];
  return `<section class="sh-sec"><h3>Where your data goes <span>choose one</span></h3>
    <div class="sy-targets" role="radiogroup" aria-label="Sync method">${T.map(([k, t, hint]) => `<button type="button" role="radio" aria-checked="${pane === k}" class="sy-target ${pane === k ? 'on' : ''}" data-pane="${k}"><b>${t}</b><small>${hint}</small></button>`).join('')}</div>
  </section>`;
}

function gistHTML(s) {
  if (!s.connected) {
    const bad = draftToken && !looksLikeToken(draftToken);
    return `<section class="sh-sec sy-gist"><h3>Connect a private gist <span>about two minutes</span></h3>
      <ol class="sy-steps">
        <li><a href="${TOKEN_PAGE}" target="_blank" rel="noopener noreferrer">Open GitHub's new-token page ${I.ext}</a>. Name it <em>ApartmentScout</em> and let it expire in a year.</li>
        <li>Repository access: choose <em>Public repositories</em> (nothing else).</li>
        <li>Under <em>Account permissions</em>, set <em>Gists</em> to <em>Read and write</em>. Leave everything else at No access.</li>
        <li>Press <em>Generate token</em>, copy it, and paste it here.</li>
      </ol>
      <form class="sy-form" data-sy-connect autocomplete="off">
        <label class="field"><span class="lbl">Token</span>
          <input type="password" id="syToken" name="as-sync-token" value="${esc(draftToken)}" placeholder="github_pat_…" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" data-lpignore="true" data-1p-ignore data-form-type="other" aria-describedby="syTokenHint"></label>
        <p class="sh-hint" id="syTokenHint">${bad ? 'That does not look like a GitHub token yet. Fine-grained tokens start with <code>github_pat_</code>.' : `Prefer a classic token? <a href="${CLASSIC_TOKEN_PAGE}" target="_blank" rel="noopener noreferrer">Make one with only the gist box ticked</a>.`}</p>
        <details class="sy-adv"><summary>Already have a gist from another device?</summary>
          <label class="field"><span class="lbl">Gist link or id (optional)</span><input type="text" id="syGist" value="${esc(draftGist)}" placeholder="Found automatically from your token" autocomplete="off" spellcheck="false"></label></details>
        <div class="sy-actions"><button type="submit" class="btn primary" data-sy-go ${busy === 'connect' ? 'disabled' : ''}>${busy === 'connect' ? 'Connecting…' : 'Connect and sync'}</button></div>
      </form>
      ${safetyHTML()}
    </section>`;
  }
  const n = s.last?.photos;
  return `<section class="sh-sec sy-gist"><h3>Private gist <span>${s.owner ? `@${esc(s.owner)}` : 'connected'}</span></h3>
    <div class="sy-conn">
      ${I.check}<div><b>Connected</b><small>The token is kept in this browser only. It is sent to api.github.com and nowhere else.</small></div>
    </div>
    <div data-sy-devices>${devicesHTML(s)}</div>
    <label class="tg sy-tg ${s.auto ? 'on' : ''}" role="switch" aria-checked="${s.auto}" tabindex="0" data-opt="auto"><span class="switch"></span><span class="lbl">Sync when something changes<small>Also when you open the app and when you come back to it. Turn off to sync only with the button.</small></span></label>
    <label class="tg sy-tg ${s.photos ? 'on' : ''}" role="switch" aria-checked="${s.photos}" tabindex="0" data-opt="photos"><span class="switch"></span><span class="lbl">Include small copies of tour photos<small>Up to ${LIMITS.photosMax} photos, ${size(LIMITS.photosTotal)} in all, each shrunk to ${size(LIMITS.photoBytes)}. The originals stay where you took them.</small></span></label>
    ${!s.photos ? `<div class="sy-row"><button type="button" class="btn sm ghost" data-sy-dropphotos ${busy === 'drop' ? 'disabled' : ''}>Remove photo copies already on GitHub</button></div>` : ''}
    <p class="sy-last" data-sy-last>${lastHTML(s)}</p>
    <div class="sy-actions">
      ${s.gistUrl ? `<a class="btn sm ghost" href="${esc(s.gistUrl)}" target="_blank" rel="noopener noreferrer">View the gist ${I.ext}</a>` : ''}
      <button type="button" class="btn sm ghost danger" data-sy-disconnect>Remove token and disconnect</button>
    </div>
    ${safetyHTML()}
  </section>`;
}
const safetyHTML = () => `<div class="sy-safe">${I.lock}<div><b>About the token</b><p>It lets this page read and write your gists, so anyone who can open this browser on this device can read it. Give it only the Gists permission and an expiry date, and revoke it on GitHub when you stop syncing. It is never shown again, logged, or sent anywhere but api.github.com.</p>
  <p>A <em>secret</em> gist is not listed anywhere, but anyone who has its link can read it. Do not share the link.</p></div></div>`;

function fileHTML(s) {
  const p = prepared;
  const share = canShareFiles();
  const withPhotos = fileWithPhotos ?? s.photos;
  return `<section class="sh-sec sy-file"><h3>Sync file <span>no account, no token</span></h3>
    <p class="sh-hint">A file with everything you own in this app. Save it somewhere both devices can reach (iCloud Drive works well), then merge it on the other device. Merging keeps the newest version of each note, star and number, so nothing is lost if you changed things on both.</p>
    <div class="sy-card">
      <h4>1. On this device: export</h4>
      <label class="tg sy-tg ${withPhotos ? 'on' : ''}" role="switch" aria-checked="${withPhotos}" tabindex="0" data-filephotos><span class="switch"></span><span class="lbl">Include small copies of tour photos</span></label>
      <div class="sy-actions">
        ${share ? `<button type="button" class="btn primary" data-sy-share ${p ? '' : 'disabled'}>${I.file}<span>${p ? 'Share or save to Files' : 'Preparing…'}</span></button>` : ''}
        <button type="button" class="btn ${share ? '' : 'primary'}" data-sy-download ${p ? '' : 'disabled'}>${I.file}<span>${p ? 'Download file' : 'Preparing…'}</span></button>
      </div>
      <p class="sh-hint">${p ? `${esc(p.name)} · ${size(p.bytes)} · ${p.items} items${p.photos ? `, ${p.photos} photo cop${p.photos === 1 ? 'y' : 'ies'}` : ''}` : 'Getting the file ready…'}${p?.over ? ` · ${p.over} photo${p.over === 1 ? '' : 's'} left out (over the limit)` : ''}</p>
      ${share ? '<p class="sh-hint">On iPhone, choose <em>Save to Files</em> in the share sheet.</p>' : ''}
    </div>
    <div class="sy-card">
      <h4>2. On the other device: merge</h4>
      <div class="sy-actions"><label class="btn" tabindex="0" data-sy-pick>${I.file}<span>Choose a sync file…</span><input type="file" accept=".json,application/json" data-sy-import hidden></label></div>
      <p class="sy-msg" data-sy-filemsg role="status" aria-live="polite">${note ? note : ''}</p>
      <p class="sh-hint">Also accepts the picks backups made by <em>Back up picks</em>, from any version.</p>
    </div>
  </section>`;
}
function canShareFiles() {
  try { return typeof navigator.canShare === 'function' && navigator.canShare({ files: [new File(['{}'], 'x.json', { type: 'application/json' })] }) && (navigator.maxTouchPoints > 0 || /Mac/.test(navigator.platform)); } catch { return false; }
}

function whatHTML() {
  const rows = E.summary(), s = E.status();
  const total = rows.reduce((n, r) => n + r.n, 0);
  return `<section class="sh-sec sy-what"><h3>What is synced <span>${total} item${total === 1 ? '' : 's'}</span></h3>
    <details><summary>Show exactly what</summary>
      <ul class="sy-list">${rows.map((r) => `<li><span>${esc(r.label)}</span><b>${r.n}</b></li>`).join('')}</ul>
      ${s.skipped.length ? `<p class="sh-hint warn">${s.skipped.length} item${s.skipped.length === 1 ? ' is' : 's are'} too large to sync (over ${size(LIMITS.item)}) and stay on this device.</p>` : ''}
      <p class="sh-hint"><b>Never synced:</b> theme, density, filters, map layers, panel positions, caches, this panel's settings and the token. The listings, scores and photos that come with the search are not yours to sync: every device loads them itself.</p>
      <p class="sh-hint"><b>Where it goes:</b> your own secret gist on GitHub (a gist file per ${size(LIMITS.part)} of data), or the file you choose. Nothing goes to ApartmentScout or anyone else; the app has no server and no analytics.</p>
    </details></section>`;
}

function render() {
  if (!root) return;
  const s = E.status(), keep = root.querySelector('.sh-body')?.scrollTop || 0;
  root.innerHTML = `<aside class="sheet sync-sheet" role="dialog" aria-modal="true" aria-labelledby="syTitle">
    <header class="sh-h"><div class="t"><h2 id="syTitle">Sync</h2><p>Keep your picks, notes and tour findings in step between your Mac and iPhone.</p></div>
      <button type="button" class="icon-btn sh-close" aria-label="Close sync">${I.x}</button></header>
    <div class="sh-body">
      ${heroHTML(s)}
      ${targetHTML()}
      ${pane === 'gist' ? gistHTML(s) : fileHTML(s)}
      ${whatHTML()}
    </div>
  </aside>`;
  root.querySelector('.sh-body').scrollTop = keep;
}

// ------------------------------------------------------------------ doing things
async function prepare() {
  const mine = ++preparing;
  prepared = null; refreshFile();
  try {
    const out = await E.buildExport({ photos: fileWithPhotos ?? E.status().photos });
    if (mine !== preparing) return;
    prepared = { ...out, bytes: new TextEncoder().encode(out.text).length, file: new File([out.text], out.name, { type: 'application/json' }) };
  } catch { prepared = null; }
  refreshFile();
}
function refreshFile() { if (root && !root.hidden && pane === 'file') render(); }

function failText(e) { return e?.message || 'Something went wrong. Your data on this device is safe.'; }

async function connect() {
  if (busy) return;
  const token = root.querySelector('#syToken')?.value.trim(), gist = root.querySelector('#syGist')?.value.trim() || '';
  if (!token) { setErr('Paste the token first.'); root.querySelector('#syToken')?.focus(); return; }
  busy = 'connect'; draftToken = token; draftGist = gist; render();
  try {
    await E.connect(token, gist);
    draftToken = ''; draftGist = ''; busy = '';
    toast(E.status().phase === 'error' ? 'Connected, but the first sync did not finish. The message above says why.' : 'Connected. Your data is syncing.', 3200);
  } catch (e) {
    busy = ''; render(); setErr(failText(e));
  }
  render();
}
function setErr(text) { const el = root.querySelector('[data-sy-error]'); if (el) { el.textContent = text; el.hidden = !text; } }

async function shareFile() {
  if (!prepared) return;
  try {
    await navigator.share({ files: [prepared.file], title: 'ApartmentScout sync file' });
    E.markExported(); toast('Sync file shared', 2600);
  } catch (e) {
    if (e?.name === 'AbortError') return;
    download(prepared.name, prepared.text, 'application/json'); E.markExported(); toast('Sync file downloaded', 2600);
  }
}
function downloadFile() {
  if (!prepared) return;
  download(prepared.name, prepared.text, 'application/json'); E.markExported(); toast('Sync file downloaded', 2600); paintStatus();
}
async function importFile(file) {
  try {
    const r = await E.importText(await file.text());
    const line = mergeLine(r);
    note = `<b>Merged.</b> ${line || 'Nothing in the file was newer than what is here.'}${r.kept ? ` ${r.kept} of your newer edit${r.kept === 1 ? ' was' : 's were'} kept.` : ''}${r.photos ? ` ${r.photos} photo${r.photos === 1 ? '' : 's'} added.` : ''}${r.reload ? ' <button type="button" class="linkish" data-reload>Reload</button> to apply your settings.' : ''}`;
    toast(line ? `Merged: ${line}` : 'Merged: nothing was newer', 3600);
  } catch (e) { note = `<span class="bad">${esc(failText(e))}</span>`; }
  render(); paintMenu(E.status());
}

function onClick(e) {
  const t = e.target;
  if (t.closest('.sh-close')) { close(); return; }
  if (t.closest('[data-reload]')) { location.reload(); return; }
  const tg = t.closest('[data-pane]');
  if (tg) { pane = tg.dataset.pane; note = null; render(); if (pane === 'file') prepare(); return; }
  if (t.closest('[data-sy-now]')) { E.syncNow('manual'); return; }
  if (t.closest('[data-sy-disconnect]')) { E.disconnect(); render(); toast('Disconnected. Your data stays on this device.', 3200); return; }
  if (t.closest('[data-sy-dropphotos]')) {
    busy = 'drop'; render();
    E.removePhotoCopies().then((n) => toast(n ? `Removed ${n} photo cop${n === 1 ? 'y' : 'ies'} from the gist` : 'No photo copies to remove', 3000)).catch((er) => setErr(failText(er))).finally(() => { busy = ''; render(); });
    return;
  }
  const opt = t.closest('[data-opt]');
  if (opt) { E.setOption(opt.dataset.opt, !(opt.getAttribute('aria-checked') === 'true')); render(); return; }
  if (t.closest('[data-filephotos]')) { fileWithPhotos = !(fileWithPhotos ?? E.status().photos); render(); prepare(); return; }
  if (t.closest('[data-sy-share]')) { shareFile(); return; }
  if (t.closest('[data-sy-download]')) { downloadFile(); return; }
}
function onChange(e) {
  if (e.target.matches('[data-sy-import]') && e.target.files?.[0]) { importFile(e.target.files[0]); e.target.value = ''; }
}
function onInput(e) {
  if (e.target.id === 'syToken') {
    draftToken = e.target.value.trim();
    const hint = root.querySelector('#syTokenHint');
    if (hint && draftToken && !looksLikeToken(draftToken)) hint.textContent = 'That does not look like a GitHub token yet. Fine-grained tokens start with github_pat_.';
  }
  if (e.target.id === 'syGist') draftGist = e.target.value;
}
document.addEventListener('submit', (e) => { if (e.target.matches?.('[data-sy-connect]')) { e.preventDefault(); connect(); } });
document.addEventListener('keydown', (e) => {
  const sw = e.target?.closest?.('#syncSheet [role="switch"]');
  if (sw && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); sw.click(); }
  const pick = e.target?.closest?.('#syncSheet [data-sy-pick]');
  if (pick && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); pick.querySelector('input')?.click(); }
});
