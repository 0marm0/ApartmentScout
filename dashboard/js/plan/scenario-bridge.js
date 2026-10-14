// Shared plan scenario: the Floor plan studio (and the plan tracer) hand one locally edited plan,
// with its furniture, to the Unit 3D Inside view. Stored per plan id in the browser:
//
//   localStorage["as:plan-scenario:<plan id>"] = {
//     "schema": 1, "kind": "apartmentscout-plan-scenario", "id": "<plan id>", "base": "<data folder>",
//     "label": "Edited door widths", "from": "studio" | "tracer" | "edit", "saved": "<ISO time>",
//     "project": { apartmentscout-project schema 1: plan (JSON v2), layout (inches), lighting } }
//
// Readers call getPlanScenario(id, {base}); it validates the project with the same strict checks as a
// project import and returns null for anything missing, malformed, or saved from another search.
// A scenario only ever applies to the plan id it was saved under (never to a sibling unit).
import { parseProject, MAX_PROJECT_BYTES } from './project.js';

export const SCENARIO_PREFIX = 'as:plan-scenario:';
export const scenarioKey = (id) => SCENARIO_PREFIX + id;
const ID = /^[A-Za-z0-9_-]{1,80}$/;
const LABEL = (s) => String(s ?? '').replace(/[<>\u0000-\u001f]/g, ' ').trim().slice(0, 80);
const defaultStorage = () => { try { return globalThis.localStorage || null; } catch { return null; } };

/** Wrap a validated project as a scenario record. Throws when the project is invalid. */
export function buildScenario({ project, base = 'data', label = '', from = 'studio', saved = new Date().toISOString() }) {
  const r = parseProject(project);
  if (!r.ok) throw new Error(r.error);
  return { schema: 1, kind: 'apartmentscout-plan-scenario', id: r.project.plan.id, base: String(base).slice(0, 80), label: LABEL(label), from: ['studio', 'tracer', 'edit'].includes(from) ? from : 'studio', saved, project: r.project };
}

/** Save a scenario for its plan id. Returns the record. Throws on invalid input or a full browser store. */
export function savePlanScenario(input, { storage = defaultStorage() } = {}) {
  const rec = buildScenario(input || {});
  const text = JSON.stringify(rec);
  if (new TextEncoder().encode(text).length > MAX_PROJECT_BYTES) throw new Error('Scenario is larger than 1 MB');
  if (!storage) throw new Error('Browser storage is not available');
  storage.setItem(scenarioKey(rec.id), text);
  return rec;
}

/**
 * Read the scenario saved for a plan id, or null. With `base`, a scenario saved from another search
 * folder is ignored. The result carries the validated plan, layout, lighting and normalised model.
 * @returns {{id: string, base: string, label: string, from: string, saved: string, plan: object, layout: object, lighting: object, model: object} | null}
 */
export function getPlanScenario(id, { base = null, storage = defaultStorage() } = {}) {
  if (!ID.test(String(id || '')) || !storage) return null;
  let rec;
  try { const text = storage.getItem(scenarioKey(id)); if (!text || text.length > MAX_PROJECT_BYTES) return null; rec = JSON.parse(text); } catch { return null; }
  if (!rec || rec.schema !== 1 || rec.kind !== 'apartmentscout-plan-scenario' || rec.id !== id) return null;
  if (base != null && rec.base !== base) return null;
  const r = parseProject(rec.project, { planId: id });
  if (!r.ok) return null;
  return { id, base: rec.base, label: LABEL(rec.label), from: rec.from, saved: String(rec.saved || ''), plan: r.project.plan, layout: r.layout, lighting: r.project.lighting || {}, model: r.model };
}

/** Remove the scenario for a plan id. */
export function removePlanScenario(id, { storage = defaultStorage() } = {}) {
  try { storage?.removeItem(scenarioKey(id)); } catch { /* storage unavailable */ }
}
