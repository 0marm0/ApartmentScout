// Questions for the leasing office: the pure part. questions.json (written by `apartmentscout build`) holds each unit's open
// questions; this file expands it, picks the units of interest in a building, groups the questions into one draft and renders
// the email text. It mirrors apartmentscout/office_questions.py (assemble_units, render_text, mailto): the two are held to the
// same output by tests/test_office_questions.py and tests/js/office-model.test.mjs through tests/fixtures/office-cases.json.
// No DOM, no storage, no imports: `node --test` loads it as is. Nothing here sends anything.

export const SIGNOFF = '[Your name]';
export const SCHEMA = 'apartmentscout-office-questions/1';
export const MAILTO_SOFT_LIMIT = 1900;   // some mail apps cut a mailto: body near 2,000 characters

const TERMS_PRIORITY = 200;
const BIG = 1e6;

/** The unit entries of questions.json with their full question objects: { id: { id, building_key, building, address, unit, status,
 *  rank, interest, questions } }. The wording is stored once per merge key in `defs`. */
export function expandDoc(doc) {
  const out = {};
  if (!doc || typeof doc !== 'object' || !doc.units || !doc.defs) return out;
  for (const [uid, u] of Object.entries(doc.units)) {
    const { q, ...rest } = u;
    const questions = [];
    for (const r of q || []) {
      const d = doc.defs[r.mk]; if (!d) continue;
      questions.push({ id: `${uid}:${r.topic}`, topic: r.topic, kind: r.kind, scope: d.scope, mk: r.mk, priority: d.priority, text: d.text, evidence: r.ev || [], fields: d.fields, default_on: true });
    }
    out[uid] = { id: uid, ...rest, questions };
  }
  return out;
}

/** The standard lease-term questions as draft items (offered unchecked). */
export const standardItems = (doc) => (doc?.standard || []).map((s) => ({ id: s.id, topic: 'terms', kind: 'standard', priority: TERMS_PRIORITY, text: s.text, evidence: [], fields: [], unit_ids: [], units: [], default_on: false }));

const rankOf = (u) => u.rank || BIG;
const byRank = (a, b) => (rankOf(a) - rankOf(b)) || (a.unit < b.unit ? -1 : a.unit > b.unit ? 1 : 0);

/** Every unit of a building that has something to ask, best ranked first. */
export const buildingUnits = (entries, key) => Object.values(entries).filter((u) => u.building_key === key).sort(byRank);

/** Units of interest in a building: the ones the data marks (shortlist, touring, applied, favourite, top-ranked) plus `extra` ids
 *  (what the renter saved or put in Compare, and the unit they started from). */
export function interestUnits(entries, key, extra = []) {
  const more = new Set(extra);
  return buildingUnits(entries, key).filter((u) => (u.interest && u.interest.length) || more.has(u.id));
}

/** Group unit questions into a draft: building-wide first, then one block per unit. `units` are { id, unit, rank, ..., questions } in
 *  the order to show. A question whose merge key `mk` appears for several units, or whose scope is `building`, is asked once; ids
 *  in `answered` are left out. */
export function assemble(key, name, address, units, { answered = [], standard = [], standardOn = false } = {}) {
  const skip = new Set(answered), buckets = new Map();
  for (const u of units) {
    for (const q of u.questions) {
      if (skip.has(q.id)) continue;
      if (!buckets.has(q.mk)) buckets.set(q.mk, []);
      buckets.get(q.mk).push([u, q]);
    }
  }
  const shared = [], byUnit = new Map(units.map((u) => [u.id, []]));
  for (const items of buckets.values()) {
    const [u0, q0] = items[0];
    if (q0.scope === 'building' || items.length > 1) {
      shared.push({ id: `shared:${q0.mk}`, topic: q0.topic, kind: q0.kind, priority: q0.priority, text: q0.text, evidence: q0.evidence, fields: q0.fields,
        unit_ids: items.map(([u]) => u.id), units: q0.scope !== 'building' ? items.map(([u]) => u.unit) : [], default_on: q0.default_on });
    } else byUnit.get(u0.id).push(q0);
  }
  shared.sort((a, b) => a.priority - b.priority);   // stable: ties keep the order the units were asked in
  const draft = {
    building: name, address, building_key: key,
    units: units.map((u) => ({ id: u.id, unit: u.unit, status: u.status, rank: u.rank, interest: u.interest })),
    shared,
    by_unit: units.filter((u) => byUnit.get(u.id).length).map((u) => ({ unit_id: u.id, unit: u.unit, questions: byUnit.get(u.id) })),
    standard,
  };
  draft.selected = defaultSelection(draft, standardOn);
  return draft;
}

export function defaultSelection(draft, standardOn = false) {
  const ids = draft.shared.filter((s) => s.default_on).map((s) => s.id);
  for (const b of draft.by_unit) for (const q of b.questions) if (q.default_on) ids.push(q.id);
  if (standardOn) ids.push(...draft.standard.map((s) => s.id));
  return ids;
}

// ------------------------------------------------------------------ rendering
const joinUnits = (labels) => (labels.length <= 2 ? labels.join(' and ') : `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`);
const unitsPhrase = (labels) => `${labels.length === 1 ? 'unit ' : 'units '}${joinUnits(labels)}`;

function chosen(draft, selected) {
  const sel = new Set(selected ?? draft.selected);
  const shared = [...draft.shared.filter((s) => sel.has(s.id)), ...draft.standard.filter((s) => sel.has(s.id))];
  const blocks = draft.by_unit.map((b) => [b.unit, b.questions.filter((q) => sel.has(q.id))]).filter(([, qs]) => qs.length);
  return { shared, blocks };
}
/** Units the chosen questions are about, in the draft's unit order (all units when only building questions remain). */
function askedUnits(draft, selected) {
  const { shared, blocks } = chosen(draft, selected), ids = new Set(blocks.map(([u]) => u));
  for (const s of shared) for (const u of s.units) ids.add(u);
  const labels = draft.units.map((u) => u.unit).filter((u) => ids.has(u));
  return labels.length ? labels : draft.units.map((u) => u.unit);
}

export function subject(draft, selected) {
  const labels = askedUnits(draft, selected);
  return labels.length ? `Questions about ${unitsPhrase(labels)} at ${draft.building}` : `Questions about ${draft.building}`;
}

/** The email body for the chosen questions ('' when none are chosen). */
export function renderText(draft, selected) {
  const { shared, blocks } = chosen(draft, selected);
  if (!shared.length && !blocks.length) return '';
  const labels = askedUnits(draft, selected);
  let n = 0;
  const sections = [];
  if (shared.length) {
    sections.push([labels.length === 1 ? 'About the building' : 'Across these units', shared.map((s) => `${++n}. ${s.units.length ? `For ${joinUnits(s.units)}: ` : ''}${s.text}`)]);
  }
  for (const [unit, qs] of blocks) sections.push([`Unit ${unit}`, qs.map((q) => `${++n}. ${q.text}`)]);
  const street = String(draft.address || '').split(',')[0].trim();
  const where = street && !draft.building.toLowerCase().includes(street.toLowerCase()) ? `${draft.building} (${street})` : draft.building;
  const intro = `I'm interested in ${unitsPhrase(labels)} at ${where}. Could you help with the questions below? Written answers are easiest for me to keep track of.`;
  const parts = ['Hello,', '', intro, ''];
  for (const [head, lines] of sections) parts.push(head, ...lines, '');
  parts.push('Thank you,', SIGNOFF);
  return `${parts.join('\n')}\n`;
}

/** A mailto: link with no recipient: it opens the renter's own mail app with the subject and body filled in. */
export const mailtoHref = (subj, body) => `mailto:?subject=${encodeURIComponent(subj)}&body=${encodeURIComponent(body.replace(/\r?\n/g, '\r\n'))}`;
export const tooLongForMailto = (href) => href.length > MAILTO_SOFT_LIMIT * 2;   // percent-encoding triples some characters; compare the encoded form to a generous cap

/** How many chosen questions a draft holds, and how many there are to choose from (standard ones not counted). */
export function counts(draft, selected) {
  const sel = new Set(selected ?? draft.selected);
  const all = [...draft.shared, ...draft.by_unit.flatMap((b) => b.questions)];
  return { chosen: all.filter((q) => sel.has(q.id)).length + draft.standard.filter((q) => sel.has(q.id)).length, total: all.length };
}

/** The per-unit question ids an answer covers: a shared question stands for each unit that asked it. */
export const answerIdsFor = (q) => (q.unit_ids?.length ? q.unit_ids.map((id) => `${id}:${q.topic}`) : [q.id]);
