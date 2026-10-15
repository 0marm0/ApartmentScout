// The shared anchor as HTML, one wording for Unit 3D's Model panel and the Floor plan studio's Light tab: a heading per
// section (origin, north and rotation, slab datum, host facade, plan and window correspondence) and a definition list of
// facts, each marked source, measured, your setting or assumed. Pure string builders.
import { esc } from '../util.js';
import { describeAnchor } from './anchor.js';

const PILL = { source: ['Source', 'good'], measured: ['Measured', 'good'], assumed: ['Assumed', 'warn'], manual: ['Your setting', 'accent'], warn: ['Check', 'warn'] };
export const pill = (state, text) => { const [t, c] = PILL[state] || [state, '']; return `<span class="pill ${c}">${esc(text || t)}</span>`; };

/** The sections of an anchor record: <h4> + <dl> pairs (a dl may only hold dt and dd, so the headings sit outside it). */
export function anchorListHTML(rec) {
  return `<div class="mp-anchor">${describeAnchor(rec).map((s) => `<h4 class="mp-sec-t">${esc(s.title)}</h4><dl>${s.rows.map((r) => `<div><dt>${esc(r.k)}</dt><dd>${esc(r.v)} ${pill(r.state)}${r.hint ? `<small>${esc(r.hint)}</small>` : ''}</dd></div>`).join('')}</dl>`).join('')}</div>`;
}
