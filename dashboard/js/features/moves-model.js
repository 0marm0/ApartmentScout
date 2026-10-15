// "Why did this move?": the pure part. Given the search's rank history (ranks.json, written by `apartmentscout score`; format in
// apartmentscout/rankhistory.py) it works out, for each home, how far its rank moved between two scoring runs, and which
// dimensions moved it and why, in plain words. No DOM and no imports, so `node --test` can load it; moves.js owns the screen.
//
// A rank is the action rank on the cards ("#46"): 1 is best, so a smaller number is a move up. A change is positive for a
// move up. Every sentence is built from what the runs recorded (parts, flags, weights, version, monthly cost) and, for the
// numbers inside a sentence, from the home's current reasons, so nothing here is invented.

export const MOVE_MIN = 10;     // places a home must move before its card says so,
export const TOP_SHARE = 0.25;  // and only when it is, or was, in the top quarter of the ranking (a move deep in the list is not news)
const NEUTRAL = 50;           // an unknown dimension counts as this in the overall score
const MIN_PTS = 0.4;          // a dimension must move the overall score this much to be named

// ------------------------------------------------------------------ reading the file
/** A model of ranks.json: runs oldest first, each with accessors. Returns null for anything that is not a rank history. */
export function parseRanks(doc) {
  if (!doc || doc.v !== 1 || !Array.isArray(doc.runs) || !Array.isArray(doc.ids) || !Array.isArray(doc.dims)) return null;
  const index = new Map(doc.ids.map((id, i) => [id, i]));
  const runs = doc.runs.filter((r) => r && typeof r.at === 'string' && Array.isArray(r.a)).map((r) => {
    const k = r.k || doc.dims.length;
    const w = {};
    doc.dims.forEach((d, j) => { w[d] = Number(r.w?.[j]) || 0; });
    return {
      at: r.at, date: r.at.slice(0, 10), version: r.version || '', k, w, n: r.n || 0, a: r.a, f: r.f || [], s: r.s || [], c: r.c || [], p: r.p || '', g: r.g || [],
      wtot: Object.values(w).reduce((x, y) => x + y, 0) || 1,
    };
  }).sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : 0));
  if (!runs.length) return null;
  return { ids: doc.ids, index, dims: doc.dims, vocab: doc.vocab || [], versions: doc.versions || {}, runs };
}

/** One home as a run recorded it, or null when the run does not know it. */
export function standing(model, run, id) {
  const i = model.index.get(id);
  if (i == null || i >= run.a.length) return null;
  const parts = {};
  model.dims.forEach((d, j) => {
    if (j >= run.k) { parts[d] = null; return; }
    const h = run.p.slice((i * run.k + j) * 2, (i * run.k + j) * 2 + 2);
    parts[d] = !h || h === 'ff' ? null : parseInt(h, 16);
  });
  const flags = new Set(String(run.g[i] || '').split('.').filter(Boolean).map((x) => model.vocab[+x]).filter(Boolean));
  return {
    rank: run.a[i] || 0, fit: run.f[i] || 0, score: run.s[i] >= 0 ? run.s[i] / 10 : null, cost: run.c[i] >= 0 ? run.c[i] : null, parts, flags,
  };
}

/** The overall points a dimension contributes in a run, the way the scorer sums them (unknown = neutral). */
export const contribution = (run, dim, part) => ((run.w[dim] || 0) * (part ?? NEUTRAL)) / run.wtot;
const share = (run, dim) => (100 * (run.w[dim] || 0)) / run.wtot;

// ------------------------------------------------------------------ choosing the runs to compare
const pad = (n) => String(n).padStart(2, '0');
/** 'YYYY-MM-DDTHH:MM' in the renter's own clock, from a Date or an ISO string. */
export function localStamp(d) {
  const t = d instanceof Date ? d : new Date(d);
  return Number.isNaN(+t) ? null : `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}T${pad(t.getHours())}:${pad(t.getMinutes())}`;
}
/** The last run made at or before a time ('YYYY-MM-DD' means the end of that day), or null when every run is later. */
export function runAtOrBefore(model, stamp) {
  if (!stamp) return null;
  const t = stamp.length <= 10 ? `${stamp}T23:59` : stamp;
  let best = null;
  for (const r of model.runs) if (r.at <= t) best = r;
  return best;
}
export const latestRun = (model) => model.runs[model.runs.length - 1];

/**
 * The run to compare with. `chosen` is a run time the renter picked; `visit` is when they last looked. A visit counts only
 * if a newer run exists since; otherwise (a first visit, or nothing has been scored since) the first recorded run is used,
 * so the page can still answer "what changed since this search began". Returns { run, why } or null with fewer than two runs.
 */
export function chooseBaseline(model, { chosen = null, visit = null } = {}) {
  if (!model || model.runs.length < 2) return null;
  const last = latestRun(model);
  if (chosen) {
    const r = model.runs.find((x) => x.at === chosen) || runAtOrBefore(model, chosen);
    if (r && r !== last) return { run: r, why: 'chosen' };
  }
  const v = runAtOrBefore(model, visit);
  if (v && v !== last) return { run: v, why: 'visit' };
  return { run: model.runs[0], why: 'first' };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "Oct 13" for a run (or a date string). */
export const dayLabel = (x) => { const s = typeof x === 'string' ? x : x.date; return `${MONTHS[+s.slice(5, 7) - 1]} ${+s.slice(8, 10)}`; };
/** "Oct 14, 8:39 pm" when two runs share a day, else "Oct 14". */
export function runLabel(model, run) {
  if (model.runs.filter((r) => r.date === run.date).length < 2) return dayLabel(run);
  const h = +run.at.slice(11, 13), m = run.at.slice(14, 16);
  return `${dayLabel(run)}, ${h % 12 || 12}:${m} ${h < 12 ? 'am' : 'pm'}`;
}

// ------------------------------------------------------------------ how far each home moved
/** The change in one home's action rank between two runs. kind: moved | entered | left | same; delta > 0 is a move up. */
export function change(model, base, now, id) {
  const a = standing(model, base, id), b = standing(model, now, id);
  if (!b) return null;
  const from = a?.rank || 0, to = b.rank || 0;
  const kind = from && to ? (from === to ? 'same' : 'moved') : to ? 'entered' : from ? 'left' : null;
  if (!kind) return null;
  return { id, kind, from, to, delta: from && to ? from - to : 0, fromScore: a?.score ?? null, toScore: b.score };
}
/** Is a move big enough to say so on a card? At least `min` places, and in the top `top` share of the newer ranking at one end. */
export const significant = (c, ranked, { min = MOVE_MIN, top = TOP_SHARE } = {}) =>
  c.kind === 'moved' && Math.abs(c.delta) >= min && Math.min(c.from, c.to) <= Math.max(min, top * ranked);
/** Every home whose move is worth saying (both runs ranked it): Map id -> change. */
export function movers(model, base, now, opt = {}) {
  const out = new Map();
  for (const id of model.ids) {
    const c = change(model, base, now, id);
    if (c && significant(c, now.n, opt)) out.set(id, c);
  }
  return out;
}
/** "↓40" / "↑12" */
export const arrowText = (delta) => `${delta > 0 ? '↑' : '↓'}${Math.abs(delta)}`;
export const cardNote = (c, base, model) => `${arrowText(c.delta)} since ${runLabel(model, base)}`;

// ------------------------------------------------------------------ the reasons
const usd = (v) => `$${Math.round(v).toLocaleString('en-US')}`;
const pts = (v) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}`;
const round = (v) => Math.round(v);
/** The part of a reason's text after "<signed points> <label>: ". */
const tail = (t) => { const s = String(t || ''); const i = s.indexOf(': '); return i < 0 ? s : s.slice(i + 2); };

/** What the home's current score says about one dimension: { sentence, items }. */
function currentReason(score, dim) {
  const r = (score?.reasons || []).find((x) => x.dim === dim);
  return { sentence: tail(r?.text), items: r?.items || [] };
}
const item = (items, re) => items.find((x) => re.test(x)) || null;

/** The sentence for one dimension's part moving, from flags that appeared or went and the current reasons. */
function partText(dim, a, b, ctx) {
  const { score, versionChanged, now } = ctx, cur = currentReason(score, dim), was = a.parts[dim], is = b.parts[dim];
  const appeared = (f) => b.flags.has(f) && !a.flags.has(f), vanished = (f) => a.flags.has(f) && !b.flags.has(f);
  switch (dim) {
    case 'cost': {
      const out = [];
      if (appeared('price_dispute')) {
        const sc = score?.cost?.scenarios;
        out.push(`two prices disagree: scoring the higher${b.cost != null ? ` (${usd(b.cost)} a month)` : ''} until you have a written quote${sc?.length === 2 ? `, not ${usd(Math.min(...sc.map((x) => x.monthly)))}` : ''}`);
      } else if (vanished('price_dispute')) out.push('the two prices that disagreed are settled');
      if (appeared('renter:price')) out.push(`you confirmed the rent${b.cost != null ? `: ${usd(b.cost)} a month with fees` : ''}`);
      if (appeared('renter:fees')) out.push('you entered the monthly fees');
      if (appeared('price_unverified')) out.push('the price now comes from a weaker source, so it is ranked on the gross rent');
      if (appeared('fees_estimated')) out.push('monthly fees are now estimated from comparable homes (no fee sheet yet)');
      if (vanished('fees_estimated') || vanished('unverified:fees')) out.push('the fee sheet is now known');
      if (a.cost != null && b.cost != null && Math.abs(a.cost - b.cost) >= 25 && !out.some((x) => x.includes('a month'))) out.push(`monthly cost ${usd(a.cost)} \u2192 ${usd(b.cost)}`);
      return out.join('; ') || null;
    }
    case 'space': {
      if (appeared('renter:size')) return `you entered the size (${cur.sentence})`;
      if (b.flags.has('size_imputed') && (was == null || appeared('size_imputed'))) {
        const mid = item(cur.items, /(\d[\d,]*) ft² middle/);
        const sq = mid && mid.match(/(\d[\d,]*) ft² middle/)[1];
        return `size now estimated at ${sq ? `~${sq}` : 'a typical'} ft² (no size listed)${was == null ? ' instead of counting as neutral' : ''}`;
      }
      if (was == null && is != null) return `size now counts: ${cur.sentence}`;
      if (was != null && is == null) return 'size is no longer counted (it is unknown)';
      if (was != null && is != null) return `size now reads ${cur.sentence}`;
      return null;
    }
    case 'light_view': {
      const out = [];
      if (appeared('renter:floor')) out.push('you entered the floor');
      const photos = item(cur.items, /^unit photos:/);
      if (photos) out.push(`the unit's own photos now count: ${photos.replace(/^unit photos:\s*/, '')}`);
      if (b.flags.has('floor_inferred') && !a.flags.has('floor_inferred')) out.push('the floor is inferred from the unit number');
      else if (b.flags.has('floor_inferred') && photos) out.push('the floor is inferred from the unit number, so it counts for less');
      if (appeared('exposure_assumed')) out.push('which way the windows face is only assumed, so it counts at half strength');
      return out.join('; ') || (cur.sentence ? `now ${cur.sentence}` : null);
    }
    case 'interior': {
      if (was == null && is != null) {
        const staged = b.flags.has('interior_staged') ? '; staged or rendered photos are pulled toward neutral' : '';
        return `${versionChanged ? `scoring ${now.version} added interior` : 'interior now counts'}: ${cur.sentence || `${is}/100`}${staged}`;
      }
      if (appeared('interior_staged')) return 'the photos look staged or rendered, so interior is pulled toward neutral';
      return cur.sentence ? `now ${cur.sentence}` : null;
    }
    case 'building': {
      if (appeared('renter_rated')) return `your own rating of the building now counts (${cur.sentence})`;
      return cur.sentence ? `now ${cur.sentence}` : null;
    }
    case 'amenities': {
      if (appeared('renter:wd')) return `you confirmed the in-unit washer/dryer (${cur.sentence})`;
      if (vanished('unverified:in_unit_wd') || was == null) return `amenities now: ${cur.sentence}`;
      return cur.sentence ? `now ${cur.sentence}` : null;
    }
    default:
      return cur.sentence ? `now ${cur.sentence}` : null;
  }
}

/**
 * Why a home moved between two runs. Returns null when it is not in both. Lines are sorted by how many overall points each
 * dimension moved (they add up to the change in the overall score); `weights` says if the renter's weights changed;
 * `passed` counts the homes that now rank above it and did not before.
 * ctx: { labels: {dim: label}, score: the home's current score object (for the numbers inside a sentence) }
 */
export function explain(model, base, now, id, ctx = {}) {
  const a = standing(model, base, id), b = standing(model, now, id);
  if (!a || !b) return null;
  const labels = ctx.labels || {};
  const versionChanged = base.version !== now.version;
  const lines = [];
  // The overall score is sum(share x part). Split its change into what the dimensions' own scores did at today's weights
  // (one line each) and what the change of weights did (one line), so the lines add up to the change in the score.
  let total = 0, byWeights = 0;
  const shifts = [];
  for (const d of model.dims) {
    const so = share(base, d), sn = share(now, d), po = a.parts[d] ?? NEUTRAL, pn = b.parts[d] ?? NEUTRAL;
    const dp = (sn / 100) * (pn - po);
    byWeights += ((sn - so) / 100) * po;
    total += dp;
    if (Math.abs(sn - so) >= 1) shifts.push({ d, so, sn });
    const partMoved = a.parts[d] !== b.parts[d];
    const flagMoved = [...b.flags, ...a.flags].some((f) => b.flags.has(f) !== a.flags.has(f) && relevant(d, f));
    if (Math.abs(dp) < MIN_PTS && !(flagMoved && Math.abs(dp) >= 0.1)) continue;
    const text = partMoved || flagMoved ? partText(d, a, b, { ...ctx, versionChanged, now }) : null;
    lines.push({ dim: d, label: labels[d] || d.replaceAll('_', ' '), pts: dp, text: text || `scores ${b.parts[d] ?? 'unknown'} now, was ${a.parts[d] ?? 'unknown'}` });
  }
  total += byWeights;
  if (shifts.length && Math.abs(byWeights) >= MIN_PTS) {
    const top = shifts.sort((x, y) => Math.abs(y.sn - y.so) - Math.abs(x.sn - x.so)).slice(0, 3)
      .map((x) => `${labels[x.d] || x.d.replaceAll('_', ' ')} ${round(x.so)}% \u2192 ${round(x.sn)}%`).join(', ');
    lines.push({ dim: 'weights', label: 'Your weights', pts: byWeights, text: `the weights in your criteria changed (${top}${shifts.length > 3 ? ', ...' : ''})` });
  }
  lines.sort((x, y) => Math.abs(y.pts) - Math.abs(x.pts));
  const extras = [];
  if (versionChanged && model.versions[now.version]) extras.push(`Scoring changed from ${base.version} to ${now.version}: it ${model.versions[now.version]}.`);
  const passed = passedBy(model, base, now, id);
  return { id, rank: { from: a.rank, to: b.rank, delta: a.rank && b.rank ? a.rank - b.rank : 0 }, score: { from: a.score, to: b.score }, total, lines, extras, passed, versionChanged };
}

/** Which flags bear on which dimension (a flag that came or went there is worth a line even when the points are few). */
function relevant(dim, flag) {
  if (flag.startsWith('renter:')) return { size: 'space', fees: 'cost', price: 'cost', wd: 'amenities', floor: 'light_view' }[flag.slice(7)] === dim;
  if (dim === 'cost') return /^(price_|fees_|unverified:(fees|price)|net_conditional)/.test(flag);
  if (dim === 'space') return flag.startsWith('size_');
  if (dim === 'light_view') return flag === 'floor_inferred' || flag === 'exposure_assumed';
  if (dim === 'interior') return flag.startsWith('interior_');
  if (dim === 'building') return flag === 'renter_rated';
  return false;
}

/** Homes ranked above `id` now that were not above it before: { n, fresh } (fresh = not ranked at all before). */
export function passedBy(model, base, now, id) {
  const a = standing(model, base, id), b = standing(model, now, id);
  if (!a?.rank || !b?.rank) return { n: 0, fresh: 0 };
  let n = 0, fresh = 0;
  for (const other of model.ids) {
    if (other === id) continue;
    const o = standing(model, now, other);
    if (!o?.rank || o.rank >= b.rank) continue;
    const before = standing(model, base, other)?.rank || 0;
    if (before && before < a.rank) continue;   // it was ahead then too
    n++; if (!before) fresh++;
  }
  return { n, fresh };
}

/** The two lines above the reasons: "↓40 since Oct 13: #6 → #46" and "Score 72.8 → 67.2 (−5.6)". `e` is an explain() result. */
export function headline(model, base, e) {
  const r = e.rank;
  const head = r.from && r.to
    ? (r.delta === 0 ? `Still #${r.to} since ${runLabel(model, base)}` : `${arrowText(r.delta)} since ${runLabel(model, base)}: #${r.from} \u2192 #${r.to}`)
    : r.to ? `Ranked #${r.to} now; it was not ranked on ${runLabel(model, base)}` : `Not ranked now; it was #${r.from} on ${runLabel(model, base)}`;
  const sub = e.score.from != null && e.score.to != null ? `Score ${e.score.from.toFixed(1)} \u2192 ${e.score.to.toFixed(1)} (${pts(e.score.to - e.score.from)})` : '';
  return { head, sub };
}
/** The same explanation as a few plain sentences for the drawer: headline, one line per dimension, extras. */
export function summary(model, base, now, id, ctx = {}) {
  const e = explain(model, base, now, id, ctx);
  return e ? { ...e, ...headline(model, base, e) } : null;
}
export { pts as signedPts };
