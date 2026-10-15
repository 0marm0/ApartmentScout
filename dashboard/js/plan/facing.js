// One wording for "which way this unit faces": the host facade's bearing (from the shared anchor when the plan is placed
// on its site, else the plan's own top bearing), with bay or angled windows as a range around it. Never the first
// window's bearing: a bay's first pane can point 90 degrees away from the facade. Pure; used by the Floor plan header.
import { angDiff, compass } from '../sun.js';

const norm = (a) => ((Math.round(a) % 360) + 360) % 360;

/**
 * @param {{windows: {bearing: number}[]}} model normalised plan
 * @param {number|null} facade host facade bearing (anchor), or the plan's up bearing, or null when unknown
 * @returns {{facade: number|null, bays: [number, number]|null, text: string}} text is "" when nothing is known
 */
export function facingSummary(model, facade) {
  const wins = (model?.windows || []).map((w) => w.bearing).filter(Number.isFinite);
  if (!Number.isFinite(facade)) return { facade: null, bays: null, text: '' };
  const offs = wins.map((b) => angDiff(b, facade));
  const lo = offs.length ? Math.min(...offs) : 0, hi = offs.length ? Math.max(...offs) : 0;
  const bays = Math.max(Math.abs(lo), Math.abs(hi)) > 5 ? [norm(facade + lo), norm(facade + hi)] : null;
  const text = `windows face ${compass(facade)} ${norm(facade)}°${bays ? ` · bays ${bays[0]}–${bays[1]}°` : ''}`;
  return { facade: norm(facade), bays, text };
}
