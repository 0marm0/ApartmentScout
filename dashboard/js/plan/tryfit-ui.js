// "Does it fit?" in the Floor plan studio: the form on the Furniture tab (a typed piece, or a catalogue piece or product, dropped into
// a room) and the answer card under the inspector. Pure string builders (no DOM access); plan3d.js wires the clicks.
import { esc } from '../util.js';
import { CATALOG, CATEGORIES } from './catalog.js';
import { PRODUCTS } from './products.js';
import { fmtIn } from './model.js';
import { parsePiece } from './tryfit.js';

const PILL = { clear: ['good', 'Fits'], tight: ['warn', 'Tight'], blocked: ['bad', 'Does not fit'] };
const short = (s, n = 44) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** What the typed text reads as, for the line under the field. */
export function parseNote(text) {
  if (!String(text || '').trim()) return { tone: '', html: 'Width × depth × height. Inches by default; cm, m and ft work too.' };
  const p = parsePiece(text);
  if (!p.ok) return { tone: 'warn', html: esc(p.error) };
  const cat = p.ref !== 'custom-box' ? CATALOG[p.ref]?.name : null;
  return { tone: 'ok', html: `<b>${esc(p.label)}</b>: ${esc(fmtIn(p.w))} wide × ${esc(fmtIn(p.d))} deep × ${esc(fmtIn(p.h))} tall${p.heightGiven ? '' : ' <span class="warnline">(height assumed)</span>'}${cat ? ` · drawn as a ${esc(cat.toLowerCase())}` : ''}` };
}

/** The select of catalogue pieces and real products: option values are `c:<ref>` and `p:<id>`. */
export function pickOptions(selected = '') {
  const cats = CATEGORIES.map(([k, t]) => {
    const refs = Object.entries(CATALOG).filter(([, c]) => c.cat === k);
    return refs.length ? `<optgroup label="${esc(t)}">${refs.map(([r, c]) => `<option value="c:${esc(r)}"${selected === `c:${r}` ? ' selected' : ''}>${esc(c.name)} · ${esc(fmtIn(c.w))} × ${esc(fmtIn(c.d))}</option>`).join('')}</optgroup>` : '';
  }).join('');
  const prods = `<optgroup label="Real products, maker's size">${PRODUCTS.map((p) => `<option value="p:${esc(p.id)}"${selected === `p:${p.id}` ? ' selected' : ''}>${esc(p.brand)} · ${esc(short(p.name))} · ${esc(fmtIn(p.dims.w))} × ${esc(fmtIn(p.dims.d))}</option>`).join('')}</optgroup>`;
  return `<option value="">Pick a catalogue piece or product…</option>${cats}${prods}`;
}

/** The form. `rooms` = [{name}], `st` = {text, pick, room}. */
export function tryFitHTML({ rooms, st }) {
  const n = parseNote(st.text);
  return `<section class="tf" aria-label="Does it fit?">
    <h3 class="label">Does it fit? <span>try any piece in a room</span></h3>
    <div class="tf-row"><label for="tfRoom">In</label><select id="tfRoom" data-tf-field="room">${rooms.map((r) => `<option${r.name === st.room ? ' selected' : ''}>${esc(r.name)}</option>`).join('')}</select></div>
    <div class="tf-row"><input type="text" id="tfText" data-tf-field="text" class="tf-text" placeholder="Bookshelf 36 x 12 x 72 in" value="${esc(st.text)}" maxlength="120" autocomplete="off" spellcheck="false" aria-describedby="tfNote" aria-label="A piece and its size, width by depth by height">
      <button type="button" class="btn primary" data-tf="drop-text">Drop it in</button></div>
    <p class="tf-note ${n.tone}" id="tfNote" aria-live="polite">${n.html}</p>
    <div class="tf-row"><select id="tfPick" data-tf-field="pick" aria-label="A catalogue piece or product">${pickOptions(st.pick)}</select>
      <button type="button" class="btn" data-tf="drop-pick">Drop it in</button></div>
  </section>`;
}

/** The answer for the selected piece. */
export function fitCardHTML(rep, { inList = false, canAdd = true, walkPending = false } = {}) {
  if (!rep) return '';
  const [tone, word] = PILL[rep.grade];
  const sides = rep.sides.map((s) => `<li class="${s.flush ? 'flush' : s.open ? 'open' : ''}"><span>${esc(s.name)}</span><b>${s.flush ? 'against it' : s.open ? 'open' : esc(fmtIn(s.free))}</b>${!s.flush && !s.open && s.what ? `<small>to ${esc(s.what)}</small>` : s.flush && s.what ? `<small>${esc(s.what)}</small>` : ''}</li>`).join('');
  const rows = rep.rows.length ? `<ul class="tf-rows">${rep.rows.map((x) => `<li class="g-${x.grade}"><i aria-hidden="true"></i><span>${esc(x.text)}</span></li>`).join('')}</ul>` : '';
  return `<div class="tf-card g-${rep.grade}" role="region" aria-label="Does ${esc(rep.name)} fit?">
    <div class="tf-h"><span class="pill ${tone}">${word}</span><div class="t"><b>${esc(rep.name)}</b><small>${esc(fmtIn(rep.size.w))} × ${esc(fmtIn(rep.size.d))} × ${esc(fmtIn(rep.size.h))}${rep.room ? ` · ${esc(rep.room)}` : ''}</small></div></div>
    <p class="tf-verdict">${esc(rep.verdict)}</p>
    <h4 class="tf-sub">Space around it</h4><ul class="tf-sides">${sides}</ul>
    ${rows}${walkPending ? '<p class="tf-wait faint">Checking the walk from the front door…</p>' : ''}
    <div class="tf-acts">${inList ? '<span class="pill good">In your furniture list</span><button type="button" class="btn ghost" data-tf="download">Download furniture.json</button>' : canAdd ? '<button type="button" class="btn" data-tf="add">Add to my furniture list</button>' : ''}</div>
  </div>`;
}
