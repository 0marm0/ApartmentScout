// Client for the local API that `apartmentscout serve` adds (apartmentscout/localapi.py).
// The server writes a per-run token into the page it serves (<meta name="as-token">). A hosted copy of the dashboard
// (GitHub Pages, a standalone file, any static server) has no such tag, so everything here quietly reports "not available"
// and the wizard falls back to download and copy.

let session;   // cached promise of the /api/session answer, or null when there is no API

const token = () => document.querySelector('meta[name="as-token"]')?.content || '';

async function call(method, path, body) {
  const r = await fetch(path, {
    method, cache: 'no-store',
    headers: { 'X-AS-Token': token(), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await r.json(); } catch { /* an error page without JSON */ }
  if (!r.ok) { const e = new Error(data?.error || `The server answered ${r.status}`); e.status = r.status; e.errors = data?.errors || []; e.warnings = data?.warnings || []; throw e; }
  return data;
}

/** The session description (can_save, current search, searches, cities) or null when this page has no local API. */
export function getSession(force = false) {
  if (force || session === undefined) {
    session = token() && location.protocol.startsWith('http')
      ? call('GET', '/api/session').catch(() => null)
      : Promise.resolve(null);
  }
  return session;
}
export const available = async () => !!(await getSession());
export const validate = (yaml) => call('POST', '/api/validate', { yaml });
export const saveCriteria = (yaml) => call('POST', '/api/criteria', { yaml });
export const createSearch = (folder, yaml, city) => call('POST', '/api/searches', { folder, yaml, city });
export const activate = (folder) => call('POST', '/api/searches/activate', { folder });
export const startRescore = () => call('POST', '/api/rescore', {});
// [onboarding] lookups (the server asks OpenStreetMap, the US Census or the feed's host) and saving a traced plan into the search folder
export const findCity = (q) => call('POST', '/api/city', { q });
export const findAddress = (q, city) => call('POST', '/api/geocode', { q, city });
export const checkFeed = (url) => call('POST', '/api/feeds/check', { url });
export const savePlan = (plan, overwrite = false) => call('POST', '/api/plans', { plan, overwrite });
export const job = (id) => call('GET', `/api/jobs/${encodeURIComponent(id)}`);
/** Poll a re-score job until it ends; `onTick(job)` after every poll. Resolves with the final job. */
export async function waitForJob(id, onTick = () => {}, every = 600) {
  for (;;) {
    const j = await job(id);
    onTick(j);
    if (j.state !== 'running') return j;
    await new Promise((r) => setTimeout(r, every));
  }
}
