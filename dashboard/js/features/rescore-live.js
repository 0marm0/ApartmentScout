// Live re-scoring off the main thread. While a weight slider moves, the scores and the four rankings are computed
// in a Web Worker (rescore-core.js) and applied when they come back, so dragging never waits on the sort. Results
// are identical to rescore() in app.js, which stays the fallback and the path for everything that is not a drag
// (presets, reset, edited criteria).
//
// The worker is a classic worker built from a blob: URL out of rescore-core's source text, not a module-worker file:
// that is why it also starts from file:// and inside the standalone HTML file, where a worker module could not be
// fetched. Whenever the worker is missing, still starting, out of date or broken, rescoreLive() simply runs
// rescore() on the main thread, so a drag is never left waiting. `?worker=0` forces that path.
import { S, DIMS, emit, rescore } from '../app.js';
import { packScores, packWeights, scoreAll, applyScores, workerSource } from './rescore-core.js';

const MIN_LISTINGS = 150;   // below this the main thread is as fast as a round trip

let worker = null, ready = false, off = false, seq = 0, sent = null, queued = false, version = 0, uploaded = null, hasParts = null;
const waiting = new Set();   // callbacks to run once a result has been applied (a Set, so one drag frame's worth coalesce)

/** 'worker' once the worker holds the data, else 'sync'. Mirrored on <html data-scoring> for tests. */
export const scoringMode = () => (worker && ready && !off ? 'worker' : 'sync');
/** A request is in flight or queued (tests wait on this rather than on a fixed delay). */
export const busy = () => !!sent || queued;
const publish = () => { document.documentElement.dataset.scoring = scoringMode(); };

const keys = () => DIMS.map(([k]) => k);
const capNow = () => S.crit.budget?.tiers?.[0]?.max ?? Infinity;
const sigNow = () => { const { wv, tot } = packWeights(S.weights, keys()); return `${wv.join(',')}|${tot}|${capNow()}`; };

/** Has any listing's score object been replaced since the data was sent (edited criteria apply new ones)? */
function stale() {
  const L = S.listings;
  if (!uploaded || uploaded.length !== L.length || uploaded.dims !== keys().join(',')) return true;
  for (let i = 0; i < L.length; i++) if (L[i].score !== uploaded[i]) return true;
  return false;
}
function upload() {
  const L = S.listings, d = packScores(L, keys());
  uploaded = L.map((x) => x.score); uploaded.dims = keys().join(',');
  hasParts = d.hasParts.slice();
  version++; ready = false; publish();
  worker.postMessage({ t: 'data', d, v: version }, [d.parts.buffer, d.hasParts.buffer, d.overall.buffer, d.elig.buffer, d.conf.buffer, d.cost.buffer, d.budget.buffer, d.idRank.buffer, d.bkey.buffer]);
}
function request() {
  const { wv, tot } = packWeights(S.weights, keys()), cap = capNow();
  sent = { seq: ++seq, sig: sigNow(), v: version };
  const mine = sent.seq;
  try { worker.postMessage({ t: 'score', seq: mine, v: version, w: wv, tot, cap }); } catch { fail(); return; }
  setTimeout(() => { if (sent && sent.seq === mine) fail(); }, 2000);   // a worker that never answers must not leave the slider waiting
}
function flush() {
  const fns = [...waiting]; waiting.clear();
  for (const f of fns) f();
}

function onMessage(e) {
  const m = e.data;
  if (m.t === 'ready') { if (m.v === version) { ready = true; publish(); } return; }
  if (m.t === 'nodata') { fail(); return; }
  if (m.t !== 'result' || !sent || m.seq !== sent.seq) return;
  const s = sent; sent = null;
  // apply only a result computed for exactly the current weights and data; anything else was overtaken (a preset, a
  // reset or new criteria ran rescore() meanwhile and already wrote the right numbers)
  const valid = s.v === version && s.sig === sigNow() && !stale();
  if (valid) applyScores(S.listings, hasParts, m.out);
  if (valid || !queued) flush();   // an overtaken result with a newer request behind it is not worth a render
  if (queued) {
    queued = false;
    if (ready && !stale()) request(); else { rescore(); flush(); }
  }
}

function fail() {
  off = true; ready = false; sent = null; queued = false;
  try { worker?.terminate(); } catch { /* already gone */ }
  worker = null; publish();
  rescore(); flush();   // whoever was waiting gets the main-thread result
}

/** The worker must reproduce scoreAll() on a small fixture before it is trusted (guards against a bundler rewriting the source). */
function selfTest(w) {
  const L = [
    { id: 'a', building: 'T', score: { parts: { cost: 80, space: 40 }, overall: 60, eligible: true, confidence: 90, monthly_cost: 3000 } },
    { id: 'b', building: 'T', score: { parts: { cost: 80, space: 40 }, overall: 60, eligible: true, confidence: 90, monthly_cost: 3000 } },
    { id: 'c', building: 'U', score: { parts: { cost: 20 }, overall: 30, eligible: true, confidence: 50, monthly_cost: 4000 } },
    { id: 'd', building: 'V', score: { parts: {}, overall: 50, eligible: false } },
  ];
  const dims = ['cost', 'space'], d = packScores(L, dims), { wv, tot } = packWeights({ cost: 12, space: 8 }, dims), want = scoreAll(d, wv, tot, 3500);
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(false), 3000);
    const h = (e) => {
      const m = e.data;
      if (m.t === 'ready') w.postMessage({ t: 'score', seq: -1, v: -1, w: wv, tot, cap: 3500 });
      else if (m.t === 'result' && m.seq === -1) {
        clearTimeout(t); w.removeEventListener('message', h);
        resolve(['s', 'fit', 'action', 'budget', 'building'].every((k) => m.out[k].length === want[k].length && m.out[k].every((x, i) => Object.is(x, want[k][i]))));
      }
    };
    w.addEventListener('message', h);
    w.postMessage({ t: 'data', d, v: -1 });
  });
}

/** Start the worker in the background (after the first paint) so the first drag does not wait for it. */
export async function initRescoreLive() {
  const q = new URLSearchParams(location.search).get('worker');
  if (q === '0' || typeof Worker === 'undefined' || typeof Blob === 'undefined' || !URL.createObjectURL) { off = true; publish(); return; }
  if (S.listings.length < MIN_LISTINGS && q !== '1') { publish(); return; }
  let url, w;
  try {
    url = URL.createObjectURL(new Blob([workerSource()], { type: 'text/javascript' }));
    w = new Worker(url);
    if (!(await selfTest(w))) { w.terminate(); off = true; publish(); return; }
  } catch { try { w?.terminate(); } catch { /* none */ } off = true; publish(); return; }
  finally { if (url) setTimeout(() => URL.revokeObjectURL(url), 10000); }
  worker = w;
  worker.onerror = fail;
  worker.onmessageerror = fail;
  worker.onmessage = onMessage;
  upload();
}

const emitWeights = () => emit('weights');

/**
 * A weight slider moved: re-score for the current S.weights, then emit 'weights'. With the worker that happens a
 * moment later (the newest request wins; a request made while one is running waits for it); without it, now.
 */
export function rescoreWeights() {
  if (!worker || off || !ready || S.listings.length < MIN_LISTINGS) { rescore(); emitWeights(); return; }
  if (stale()) { rescore(); emitWeights(); upload(); return; }   // criteria were edited: answer now, let the worker catch up
  waiting.add(emitWeights);
  if (sent) { queued = true; return; }
  request();
}
