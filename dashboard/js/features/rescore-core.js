// Live re-scoring as pure array maths, so the same function runs in a Web Worker while a weight slider moves and,
// as the fallback, on the main thread. It reproduces rescore() in app.js exactly (same operations in the same
// order, so the numbers are bit-identical): the overall score from the dimension parts and the current weights,
// then the four rankings (fit, action, budget, building) with the same tie-breaks as score.py.
//
// scoreAll() must stay self-contained (no free variables, no helpers outside it): its source text is what the
// worker runs, built with Function.prototype.toString, so it works under http, file:// and in the standalone file,
// where a separate module-worker file could not be loaded.

/** Listing score inputs as typed arrays. NaN stands for a missing number. Call again when any listing's score object changes. */
export function packScores(listings, dimKeys) {
  const n = listings.length, k = dimKeys.length;
  const d = {
    n, k, parts: new Float64Array(n * k), hasParts: new Uint8Array(n), overall: new Float64Array(n), elig: new Uint8Array(n), conf: new Float64Array(n),
    cost: new Float64Array(n), budget: new Float64Array(n), idRank: new Int32Array(n), bkey: new Int32Array(n),
  };
  const order = listings.map((_, i) => i).sort((a, b) => (listings[a].id < listings[b].id ? -1 : listings[a].id > listings[b].id ? 1 : 0));
  const seenB = new Map();
  let rank = 0;
  for (let r = 0; r < n; r++) {
    const i = order[r];
    if (r > 0 && listings[order[r - 1]].id !== listings[i].id) rank = r;   // equal ids share a rank, like the string compare
    d.idRank[i] = rank;
  }
  for (let i = 0; i < n; i++) {
    const L = listings[i], s = L.score, p = s?.parts;
    d.hasParts[i] = p && Object.keys(p).length ? 1 : 0;
    for (let j = 0; j < k; j++) d.parts[i * k + j] = p && p[dimKeys[j]] != null ? p[dimKeys[j]] : NaN;
    d.overall[i] = s?.overall != null ? s.overall : NaN;
    d.elig[i] = s?.eligible ? 1 : 0;
    d.conf[i] = s?.confidence ?? 0;
    const cost = s?.monthly_cost;
    d.cost[i] = cost ?? 1e9;
    d.budget[i] = s?.cost?.budget_amount ?? cost ?? Infinity;
    const key = (L.building || L.address || L.id).toLowerCase();
    if (!seenB.has(key)) seenB.set(key, seenB.size + 1);
    d.bkey[i] = seenB.get(key);
  }
  return d;
}

/** The weights in dimension order and their sum, computed the way rescore() does. */
export function packWeights(weights, dimKeys) {
  const wv = new Float64Array(dimKeys.length);
  for (let j = 0; j < dimKeys.length; j++) wv[j] = weights[dimKeys[j]] || 0;
  const tot = Object.values(weights).reduce((a, b) => a + b, 0) || 1;
  return { wv, tot };
}

/**
 * Overall scores and ranks for every listing. Returns typed arrays indexed like the listings:
 * s (NaN = none), fit / action / budget / building (rank from 1, 0 = not ranked).
 * @param {object} d packScores() output
 * @param {Float64Array} wv weights in dimension order
 * @param {number} tot sum of all weights (1 when zero)
 * @param {number} cap first budget tier's maximum (Infinity when there is none)
 */
export function scoreAll(d, wv, tot, cap) {
  const n = d.n, k = d.k, parts = d.parts, s = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    if (d.hasParts[i]) {
      let a = 0;
      const o = i * k;
      for (let j = 0; j < k; j++) { const p = parts[o + j]; a = a + wv[j] * (p !== p ? 50 : p); }
      s[i] = a / tot;
    } else s[i] = d.overall[i];
  }
  const conf = d.conf, cost = d.cost, idRank = d.idRank;
  const sv = (i) => (s[i] !== s[i] ? -1 : s[i]);
  const cmp = (a, b) => sv(b) - sv(a) || conf[b] - conf[a] || cost[a] - cost[b] || (idRank[a] < idRank[b] ? -1 : 1);
  const fitIdx = [], actIdx = [];
  for (let i = 0; i < n; i++) { if (s[i] === s[i]) fitIdx.push(i); if (d.elig[i]) actIdx.push(i); }
  fitIdx.sort(cmp); actIdx.sort(cmp);
  const fit = new Int32Array(n), action = new Int32Array(n), budget = new Int32Array(n), building = new Int32Array(n);
  for (let r = 0; r < fitIdx.length; r++) fit[fitIdx[r]] = r + 1;
  let b = 0, nb = 0;
  const seen = new Int32Array(n + 2);
  for (let r = 0; r < actIdx.length; r++) {
    const i = actIdx[r];
    action[i] = r + 1;
    if (d.budget[i] <= cap) budget[i] = ++b;
    const key = d.bkey[i];
    if (!seen[key]) seen[key] = ++nb;
    building[i] = seen[key];
  }
  return { s, fit, action, budget, building };
}

/** Write scoreAll() output onto the listings the way rescore() does (_s, _ranks, _rank). */
export function applyScores(listings, hasParts, out) {
  for (let i = 0; i < listings.length; i++) {
    const L = listings[i], r = {};
    L._s = hasParts[i] ? out.s[i] : L.score?.overall;
    if (out.fit[i]) r.fit = out.fit[i];
    if (out.action[i]) r.action = out.action[i];
    if (out.budget[i]) r.budget = out.budget[i];
    if (out.building[i]) r.building = out.building[i];
    L._ranks = r;
    L._rank = r.action ?? null;
  }
}

/** Source of the worker script: scoreAll plus a message loop. Classic (not module) so a blob: URL can run it anywhere. */
export function workerSource() {
  return `const score = ${scoreAll.toString()};
let D = null;
onmessage = (e) => {
  const m = e.data;
  if (m.t === 'data') { D = m.d; postMessage({ t: 'ready', v: m.v }); return; }
  if (m.t === 'score') {
    if (!D) { postMessage({ t: 'nodata', seq: m.seq }); return; }
    const out = score(D, m.w, m.tot, m.cap);
    postMessage({ t: 'result', seq: m.seq, v: m.v, out }, [out.s.buffer, out.fit.buffer, out.action.buffer, out.budget.buffer, out.building.buffer]);
  }
};`;
}
