// Tours view: your saved picks, tiers and notes, and a plan for visiting them.
import { S, on } from './app.js';

let shown = false;
export function init() {
  on('saved', () => shown && draw());
}
export function show() { shown = true; draw(); }
function draw() {
  const n = Object.values(S.picks).filter((p) => p.saved).length;
  document.getElementById('view-tours').innerHTML = `<div class="view-pad"><div class="page-h"><div class="t"><h1>Tours</h1><p>${n} saved picks.</p></div></div></div>`;
}
