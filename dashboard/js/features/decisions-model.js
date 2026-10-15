// Decision history: the pure part. A revision trail of what the renter decided about each home (stars, tiers, status,
// notes, tour times, promoted findings), each with a timestamp and an optional reason. The recorder (decision-trail.js)
// diffs the picks after every change and calls into this module; the trail is exported and imported with the picks
// backup and rides along in the decision memo and the share page. apartmentscout/tours.py reads the same entries for
// `apartmentscout share`. No DOM and no imports, so `node --test` can load it.

export const KINDS = ['star', 'tier', 'status', 'note', 'tour', 'promote', 'unpromote'];
export const STATUS_CHOICES = [['researching', 'Researching'], ['shortlist', 'Shortlist'], ['touring', 'Touring'], ['applied', 'Applied'], ['rejected', 'Rejected']];
const STATUS_LABEL = Object.fromEntries(STATUS_CHOICES);
export const MAX_ENTRIES = 600;
export const MAX_SHARE = 40;
export const MERGE_MS = 15 * 60 * 1000;   // edits of one note within 15 minutes are one revision
const TIERS = ['S', 'A', 'B', 'C', 'Pass'];

const isObj = (o) => o != null && typeof o === 'object' && !Array.isArray(o);
// eslint-disable-next-line no-control-regex
const CTRL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const str = (v, n) => { if (typeof v !== 'string') return null; const t = v.replace(CTRL, '').trim(); return t ? t.slice(0, n) : null; };
const STAMP = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z?$/;
const ID_RE = /^[A-Za-z0-9_-]{4,40}$/;
export const NOTE_EXCERPT = 200;

// ------------------------------------------------------------------ what changed in a pick
const mine = (p) => ({ saved: !!p?.saved, tier: TIERS.includes(p?.tier) ? p.tier : null, status: STATUS_LABEL[p?.status] ? p.status : null, note: String(p?.note || ''), tour: p?.tour ? String(p.tour) : null });
/** The decisions that differ between two versions of one pick: [{ kind, from, to }]. */
export function diffPick(prev, next) {
  const a = mine(prev), b = mine(next), out = [];
  if (a.saved !== b.saved) out.push({ kind: 'star', from: a.saved, to: b.saved });
  if (a.tier !== b.tier) out.push({ kind: 'tier', from: a.tier, to: b.tier });
  if (a.status !== b.status) out.push({ kind: 'status', from: a.status, to: b.status });
  if (a.note !== b.note) out.push({ kind: 'note', from: a.note.slice(0, NOTE_EXCERPT) || null, to: b.note.slice(0, NOTE_EXCERPT) || null });
  if (a.tour !== b.tour) out.push({ kind: 'tour', from: a.tour, to: b.tour });
  return out;
}
/** Changes across all picks: [{ home, kind, from, to }], homes in id order. */
export function diffPicks(prev, next) {
  const ids = [...new Set([...Object.keys(prev || {}), ...Object.keys(next || {})])].sort();
  return ids.flatMap((home) => diffPick(prev?.[home], next?.[home]).map((c) => ({ home, ...c })));
}

// ------------------------------------------------------------------ the trail
let seq = 0;
/** A short unique entry id (time-sorted, collision-safe within one browser). */
export const newId = (now = Date.now(), rand = Math.random) => `${now.toString(36)}-${(seq++ % 1296).toString(36).padStart(2, '0')}${Math.floor(rand() * 1296).toString(36).padStart(2, '0')}`;

/** Clean a list of entries (from storage or an import): known kinds, sane strings, no duplicates, oldest first. */
export function clean(list) {
  const seen = new Set(), out = [];
  for (const x of Array.isArray(list) ? list : []) {
    if (!isObj(x) || !KINDS.includes(x.kind) || typeof x.e !== 'string' || !ID_RE.test(x.e) || seen.has(x.e)) continue;
    const home = str(x.home, 120), at = typeof x.at === 'string' && STAMP.test(x.at) && x.at.length <= 32 ? x.at : null;
    if (!home || !at) continue;
    seen.add(x.e);
    const e = { e: x.e, home, at, kind: x.kind };
    for (const k of ['from', 'to']) {
      const v = x[k];
      if (typeof v === 'boolean') e[k] = v; else { const s = str(typeof v === 'string' ? v : v == null ? null : String(v), x.kind === 'note' ? NOTE_EXCERPT : 160); if (s != null) e[k] = s; }
    }
    const why = str(x.why, 400); if (why) e.why = why;
    out.push(e);
  }
  out.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.e < b.e ? -1 : 1));
  return out.slice(-MAX_ENTRIES);
}
/** Entries from two sources combined (an imported backup into the browser's own trail). */
export const merge = (a, b) => clean([...(a || []), ...(b || [])]);

/** Add `changes` ([{ home, kind, from, to, why? }]) at `now` (an ISO string). Edits of the same note within MERGE_MS
 *  fold into the earlier revision (keeping its `from`), and an edit that undoes itself disappears. Returns a new list. */
export function record(entries, changes, now, mkId = newId) {
  let list = clean(entries);
  for (const c of changes) {
    if (!KINDS.includes(c.kind) || !c.home) continue;
    const i = list.findLastIndex((x) => x.home === c.home && x.kind === c.kind);
    const last = i >= 0 ? list[i] : null;
    if (c.kind === 'note' && last && i === list.length - 1 && Date.parse(now) - Date.parse(last.at) <= MERGE_MS) {
      const merged = { ...last, at: now };
      if (c.to == null) delete merged.to; else merged.to = c.to;
      if ((merged.from ?? null) === (merged.to ?? null)) list = list.filter((_, j) => j !== i); else list = list.map((x, j) => (j === i ? merged : x));
      continue;
    }
    list.push({ e: mkId(Date.parse(now)), home: c.home, at: now, kind: c.kind, ...(c.from != null ? { from: c.from } : {}), ...(c.to != null ? { to: c.to } : {}), ...(c.why ? { why: c.why } : {}) });
  }
  return clean(list);
}
/** Attach the reason the renter typed to an existing entry. */
export const withReason = (entries, e, why) => clean((entries || []).map((x) => (x.e === e ? { ...x, why: str(why, 400) || undefined } : x)));
/** Entries for one home, newest first. */
export const forHome = (entries, home) => clean(entries).filter((x) => x.home === home).reverse();

// ------------------------------------------------------------------ in words
const when = (s) => String(s).replace('T', ' ').slice(0, 16);
/** One revision as a sentence. `withNotes` is false for the share page unless the renter opted in: the text of a note
 *  never travels without it. */
export function describe(x, { withNotes = true } = {}) {
  const f = x.from ?? null, t = x.to ?? null;
  switch (x.kind) {
    case 'star': return t === true ? 'Starred' : 'Removed from your picks';
    case 'tier': return t == null ? `Tier ${f} cleared` : f == null ? `Tier set to ${t}` : `Tier ${f} to ${t}`;
    case 'status': return `Status: ${STATUS_LABEL[f] || 'none'} to ${STATUS_LABEL[t] || 'none'}`;
    case 'note': return !withNotes || t == null ? (t == null ? 'Note cleared' : 'Note edited') : `Note: ${t}`;
    case 'tour': return t == null ? 'Tour time cleared' : `Tour time set to ${when(t)}`;
    case 'promote': return `Promoted to a fact: ${t} (${f == null ? 'the listing was silent' : 'the listing said ' + f})`;
    case 'unpromote': return `Promotion withdrawn: ${t}`;
    default: return String(x.kind);
  }
}
/** What the share page and memo carry for one home: oldest first, at most MAX_SHARE (the newest), reasons and the text of
 *  notes only with `notes`. */
export function trailForShare(entries, home, { notes = false } = {}) {
  const list = clean(entries).filter((x) => x.home === home).slice(-MAX_SHARE);
  return list.map((x) => ({ at: x.at, kind: x.kind, text: describe(x, { withNotes: notes }), ...(notes && x.why ? { why: x.why } : {}) }));
}
